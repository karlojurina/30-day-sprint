/**
 * B2 rocks (world_art_bible_v6.md 4.6): render TRAIL keys or stops on the real
 * GPU with the UI hidden, and measure the nearest rock family's painted planes.
 *
 *   node world-tests/v6-b2-rocks.mjs <outdir> <tag> [--w 1691 --h 1278] k0 a1 k11.5 ...
 *
 * kNN = TRAIL key NN (fractional ok, railU = NN / (keys - 1)); aN = stop N.
 * Writes <tag>-<item>.png and prints, per frame, the rendered luma of the
 * nearest rocks (within 160 of the nearest rock pixel) by face kind: the rocks'
 * `aKind` attribute (0 top, 1 lit, 2 shade, 3 chamfer edge) through a probe
 * material, then the real frame's pixels under each kind (Rec. 601, display).
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const argv = process.argv.slice(2);
let W = 1691;
let H = 1278;
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--w") W = Number(argv[++i]);
  else if (argv[i] === "--h") H = Number(argv[++i]);
  else rest.push(argv[i]);
}
const [outDir, tag, ...items] = rest;
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.setViewport({ width: W, height: H });
await page.goto((process.env.BASE_URL || "http://localhost:3111") + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) {
  console.log("WORLD ERROR", err);
  process.exit(1);
}
await page.addStyleTag({ content: "*{visibility:hidden !important} canvas{visibility:visible !important}" });
async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 30000 }, c0, n);
  } catch {}
}
const stats = await page.evaluate(() => {
  const s = window.__worldV6Debug.moduleStats?.();
  return s ? s.rocks ?? s.find?.((m) => m.name === "rocks") ?? s : null;
});
console.log("rocks stats", JSON.stringify(stats));
for (const it of items) {
  let d;
  if (it.startsWith("a")) {
    const i = Number(it.slice(1)) - 1;
    d = await page.evaluate((i) => window.__worldV6Debug.stopDepths()[i], i);
  } else {
    const key = Number(it.slice(1));
    d = await page.evaluate((key) => {
      const r = window.__worldV6Debug.debugRail();
      const n = r.keys ?? r.n ?? null;
      const u = key / ((n ?? 86) - 1);
      let lo = 0;
      let hi = r.length;
      for (let i = 0; i < 60; i++) {
        const m = (lo + hi) / 2;
        if (r.tAtS(m) < u) lo = m;
        else hi = m;
      }
      return r.depthOfS((lo + hi) / 2);
    }, key);
  }
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
  await new Promise((r) => setTimeout(r, 400));
  await frames(2);
  const file = path.join(outDir, `${tag}-${it}.png`);
  await page.screenshot({ path: file });
  // Measure: the real frame, then a probe pass of the rocks' face kinds and depth.
  const m = await page.evaluate(() => {
    const sc = window.__worldV6Debug;
    const scene = sc.debugScene();
    const renderer = sc.renderer;
    const camera = sc.camera;
    const gl = renderer.getContext();
    const read = () => {
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { w, h, px };
    };
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const real = read();
    let SM = null;
    scene.traverse((o) => {
      if (!SM && o.material && o.material.type === "ShaderMaterial") SM = o.material.constructor;
    });
    if (!SM) return { err: "no ShaderMaterial ctor" };
    const probe = new SM({
      vertexShader: "attribute float aKind; varying float vK; varying float vD; void main(){ vK = aKind; vec4 mv = modelViewMatrix * vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }",
      fragmentShader: "varying float vK; varying float vD; void main(){ gl_FragColor = vec4((vK + 1.0) / 8.0, clamp(vD / 4000.0, 0.0, 1.0), 1.0, 1.0); }",
      toneMapped: false,
      fog: false,
    });
    const black = new SM({ vertexShader: "void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }", fragmentShader: "void main(){ gl_FragColor = vec4(0.0); }", toneMapped: false, fog: false });
    const saved = [];
    scene.traverse((o) => saved.push([o, o.material, o.visible]));
    const isRock = (o) => {
      for (let e = o; e; e = e.parent) if (e.name === "V5Rocks") return true;
      return false;
    };
    scene.traverse((o) => {
      if (!o.isMesh) {
        if (o.isPoints || o.isLine || o.isSprite) o.visible = false;
        return;
      }
      if (isRock(o) && o.geometry.getAttribute("aKind")) o.material = probe;
      else {
        const m0 = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m0 && m0.transparent) o.visible = false;
        else o.material = black;
      }
    });
    const bg = scene.background;
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    const pr = read();
    for (const [o, mat, vis] of saved) {
      o.material = mat;
      o.visible = vis;
    }
    scene.background = bg;
    probe.dispose();
    black.dispose();
    let nearest = Infinity;
    let rockPx = 0;
    for (let i = 0; i < pr.px.length; i += 4) {
      if (pr.px[i] > 0) {
        rockPx++;
        nearest = Math.min(nearest, (pr.px[i + 1] / 255) * 4000);
      }
    }
    const sums = [0, 0, 0, 0];
    const counts = [0, 0, 0, 0];
    const sumsAll = [0, 0, 0, 0];
    const countsAll = [0, 0, 0, 0];
    for (let i = 0; i < pr.px.length; i += 4) {
      if (!pr.px[i]) continue;
      const k = Math.round((pr.px[i] / 255) * 8 - 1);
      if (k < 0 || k > 3) continue;
      const dd = (pr.px[i + 1] / 255) * 4000;
      const l = 0.299 * real.px[i] + 0.587 * real.px[i + 1] + 0.114 * real.px[i + 2];
      sumsAll[k] += l;
      countsAll[k]++;
      if (dd > nearest + 160) continue;
      sums[k] += l;
      counts[k]++;
    }
    const f = (s, c) => c.map((n, k) => (n ? +(s[k] / n).toFixed(1) : null));
    const info = window.__worldFrame;
    return {
      rockShare: +((rockPx / (pr.w * pr.h)) * 100).toFixed(1),
      nearest: Math.round(nearest),
      near: { top: f(sums, counts)[0], lit: f(sums, counts)[1], shade: f(sums, counts)[2], edge: f(sums, counts)[3], px: counts },
      all: { top: f(sumsAll, countsAll)[0], lit: f(sumsAll, countsAll)[1], shade: f(sumsAll, countsAll)[2], edge: f(sumsAll, countsAll)[3] },
      tris: info?.triangles,
      calls: info?.calls,
    };
  });
  console.log(it, JSON.stringify(m));
}
if (errors.length) console.log("ERRORS", errors.slice(0, 8).join("\n"));
await browser.close();
