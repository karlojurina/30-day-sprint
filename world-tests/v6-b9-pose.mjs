/**
 * B9 (camera and composition): render named frames at 1691x1278 on the real
 * GPU and measure what the composition gates read, in one page load.
 *
 *   node world-tests/v6-b9-pose.mjs jobs.json [outDir]
 *
 * jobs.json is an array of frames:
 *   { "name": "k0", "key": 0 }                 the rail at fractional KEYS index
 *   { "name": "a2", "stop": 1 }                the page's own stop depth
 *   { "name": "k0-try", "key": 0, "pose": { "x": .., "y": .., "z": .., "bearing": .., "pitch": .., "fov": .. } }
 *                                              the light and modules at that key, the camera
 *                                              pinned to the pose (scene.debugPose)
 *   optional "lm": "LM_Lookout" (landmark group for x), "W"/"H" (default 1691x1278)
 *
 * Per frame: {name}.png (the page as the student sees it), {name}-id.png (the
 * ID pass: sky blue, terrain brown, trees green, rocks grey, cover lime, water
 * navy, landmark red, the Sky Island magenta, other pink) and one JSON line:
 * sky %, landmark box / x, the Sky Island's pixels, luma mean / p5 / p50 /
 * p95, the share under 30 luma (near black), the camera and the frame ms at
 * pixel ratio 1.5 (scene.burstProbe; other builders share the GPU, so indicative).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const jobs = JSON.parse(fs.readFileSync(argv[0], "utf8"));
const OUT = argv[1] ? path.resolve(argv[1]) : path.join(HERE, "shots/v6/B9-composition");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 120000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`${m.type()}: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
let vw = jobs[0].W || 1691;
let vh = jobs[0].H || 1278;
await page.setViewport({ width: vw, height: vh });
await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 80000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) throw new Error("world error: " + err);

const frames = (n) =>
  page.evaluate(async (n) => {
    const c0 = window.__worldFrameCount ?? 0;
    const t = performance.now();
    while ((window.__worldFrameCount ?? 0) < c0 + n && performance.now() - t < 10000) await new Promise((r) => setTimeout(r, 40));
  }, n);

async function ensureReady(reload) {
  if (reload) await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => (window.__worldReady && typeof window.__worldCamera === "function" && window.__worldV6Debug) || window.__worldError, { timeout: 80000, polling: 300 });
}

for (const job of jobs) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await ensureReady(attempt > 0);
      await shoot(job);
      break;
    } catch (e) {
      console.error(`retry ${job.name}: ${String(e).slice(0, 160)}`);
    }
  }
}

async function shoot(job) {
  const W = job.W || 1691;
  const H = job.H || 1278;
  if (W !== vw || H !== vh) {
    await page.setViewport({ width: W, height: H });
    vw = W;
    vh = H;
    await frames(3);
  }
  const d = await page.evaluate((job) => {
    const sc = window.__worldV6Debug;
    let d;
    if (job.stop !== undefined) d = sc.stopDepths()[job.stop];
    else {
      const n = sc.ctx.layout.TRAIL.length;
      const u = job.key / (n - 1);
      const r = sc.debugRail();
      let lo = 0;
      let hi = r.length;
      for (let i = 0; i < 60; i++) {
        const m = (lo + hi) / 2;
        if (r.tAtS(m) < u) lo = m;
        else hi = m;
      }
      d = r.depthOfS((lo + hi) / 2);
    }
    sc.debugPose(job.pose || null);
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
    return d;
  }, job);
  await frames(4);
  await page.screenshot({ path: path.join(OUT, `${job.name}.png`) });
  const r = await page.evaluate(async (lmName) => {
    const sc = window.__worldV6Debug;
    const scene = sc.debugScene();
    const renderer = sc.renderer;
    const camera = sc.camera;
    const cam = window.__worldCamera();
    const f = window.__worldFrame;
    const out = { cam: [cam.x, cam.y, cam.z].map(Math.round), pitch: +cam.pitch.toFixed(1), fov: +camera.fov.toFixed(1), tris: f.triangles, calls: f.calls };
    sc.setPaused(true);
    // Frame ms at pixel ratio 1.5 (the budget's; 8 renders, one sync, fastest of 5).
    const pr0 = renderer.getPixelRatio();
    renderer.setPixelRatio(1.5);
    const burst = sc.burstProbe ? sc.burstProbe(8, 5, 250) : null;
    renderer.setPixelRatio(pr0);
    out.ms = burst ? +burst.ms.toFixed(2) : null;
    const gl = renderer.getContext();
    // Beauty: the default framebuffer, read before it is composited.
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const bw = gl.drawingBufferWidth;
    const bh = gl.drawingBufferHeight;
    const raw = new Uint8Array(bw * bh * 4);
    gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const L = new Float32Array(bw * bh);
    for (let i = 0; i < bw * bh; i++) L[i] = 0.299 * raw[i * 4] + 0.587 * raw[i * 4 + 1] + 0.114 * raw[i * 4 + 2];
    // ID pass (v6-gates.mjs's classes, plus 8 = the Sky Island).
    let SM = null;
    scene.traverse((o) => {
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!SM && m && m.isShaderMaterial && m.type === "ShaderMaterial") SM = m.constructor;
    });
    const vs = `void main() {
      #ifdef USE_INSTANCING
        vec4 mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
      #else
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
      #endif
      gl_Position = projectionMatrix * mv; }`;
    const fsrc = `uniform float uClass; void main() { gl_FragColor = vec4( uClass / 255.0, 0.0, 0.0, 1.0 ); }`;
    const mats = new Map();
    const matFor = (c, side) => {
      const k = `${c}-${side}`;
      if (!mats.has(k)) mats.set(k, new SM({ uniforms: { uClass: { value: c } }, vertexShader: vs, fragmentShader: fsrc, side, fog: false, toneMapped: false }));
      return mats.get(k);
    };
    const WATER = new Set(["Sea", "River", "Stream", "Brook", "MirrorLake", "Pool"]);
    const SKY = new Set(["LightSky", "LightStars", "LightClouds", "CloudBillboards", "NightSky"]);
    const ISL = new Set(["Set_a7", "LM_Observatory", "IslandFalls", "RopeBridge", "Stand-in:SkyIsland"]);
    const classOf = (o) => {
      for (let e = o; e; e = e.parent) {
        if (lmName && e.name === lmName) return 6;
        if (ISL.has(e.name)) return 8;
        if (SKY.has(e.name)) return -1;
        if (WATER.has(e.name)) return 5;
        if (e.name === "Forest") return 2;
        if (e.name === "V5Rocks") return 3;
        if (e.name === "V5Cover") return 4;
        if (/^Terrain/.test(e.name)) return 1;
      }
      return 7;
    };
    const saved = [];
    scene.traverse((o) => saved.push([o, o.visible, o.material, o.onBeforeRender]));
    scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
      const c = classOf(o);
      const m0 = Array.isArray(o.material) ? o.material[0] : o.material;
      if (c < 0 || o.isPoints || o.isLine || o.isSprite || (m0 && m0.transparent && c !== 5 && c !== 6 && c !== 8)) {
        o.visible = false;
        return;
      }
      o.material = matFor(c, m0 ? m0.side : 0);
      if (o.name === "MirrorLake") o.onBeforeRender = () => {};
    });
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    const lake = scene.getObjectByName("MirrorLake");
    let rt = sc.__b9RT;
    if (!rt || rt.width !== bw || rt.height !== bh) {
      rt = new (lake.getRenderTarget().constructor)(bw, bh, { samples: 0, depthBuffer: true });
      sc.__b9RT = rt;
    }
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    const id = new Uint8Array(bw * bh * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, bw, bh, id);
    renderer.setRenderTarget(null);
    for (const [o, v, m, obr] of saved) {
      o.visible = v;
      if (m !== undefined) o.material = m;
      o.onBeforeRender = obr;
    }
    scene.background = bg;
    scene.fog = fog;
    for (const m of mats.values()) m.dispose();
    const counts = new Array(9).fill(0);
    let lmN = 0;
    let x0 = Infinity;
    let x1 = -1;
    let y0 = Infinity;
    let y1 = -1;
    // Sky per column band (left / middle / right thirds) and the lowest sky row.
    const skyThird = [0, 0, 0];
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const c = Math.min(8, id[(y * bw + x) * 4]);
        counts[c]++;
        if (c === 0) skyThird[Math.min(2, Math.floor((3 * x) / bw))]++;
        if (c === 6) {
          lmN++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          const yt = bh - 1 - y;
          if (yt < y0) y0 = yt;
          if (yt > y1) y1 = yt;
        }
      }
    const sorted = Array.from(L).sort((a, b) => a - b);
    const q = (p) => +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(0);
    let black = 0;
    let bright = 0;
    let sum = 0;
    for (let i = 0; i < L.length; i++) {
      sum += L[i];
      if (L[i] < 30) black++;
      if (L[i] >= 178) bright++;
    }
    // Luma per horizontal half and per vertical third (display rows top down).
    const band = [0, 0, 0];
    const bandN = [0, 0, 0];
    for (let y = 0; y < bh; y++) {
      const b = Math.min(2, Math.floor((3 * (bh - 1 - y)) / bh));
      for (let x = 0; x < bw; x += 3) {
        band[b] += L[y * bw + x];
        bandN[b]++;
      }
    }
    const PAL = [[150, 200, 255], [140, 120, 90], [30, 110, 50], [120, 120, 130], [180, 210, 90], [40, 70, 160], [255, 40, 40], [230, 150, 230], [255, 0, 255]];
    const c2 = document.createElement("canvas");
    const sw = Math.round(bw / 3);
    const sh = Math.round(bh / 3);
    c2.width = sw;
    c2.height = sh;
    const cx = c2.getContext("2d");
    const img = cx.createImageData(sw, sh);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const s = ((bh - 1 - y * 3) * bw + x * 3) * 4;
        const p = PAL[Math.min(8, id[s])];
        const d2 = (y * sw + x) * 4;
        img.data[d2] = p[0];
        img.data[d2 + 1] = p[1];
        img.data[d2 + 2] = p[2];
        img.data[d2 + 3] = 255;
      }
    cx.putImageData(img, 0, 0);
    renderer.render(scene, camera);
    sc.setPaused(false);
    const total = bw * bh;
    const pct = (n) => +((100 * n) / total).toFixed(1);
    return {
      ...out,
      sky: pct(counts[0]),
      skyThirds: skyThird.map((n) => +((300 * n) / total).toFixed(0)),
      classes: Object.fromEntries(["sky", "ter", "tree", "rock", "cov", "wat", "lm", "oth", "isl"].map((k, i) => [k, pct(counts[i])])),
      islandPx: counts[8],
      lmX: lmN ? +((x0 + x1) / 2 / bw).toFixed(3) : null,
      lmBox: lmN ? [+(x0 / bw).toFixed(2), +(y0 / bh).toFixed(2), +(x1 / bw).toFixed(2), +(y1 / bh).toFixed(2)] : null,
      luma: { mean: +(sum / L.length).toFixed(0), p5: q(0.05), p50: q(0.5), p95: q(0.95), black: pct(black), bright: pct(bright), rows: band.map((s, i) => +(s / bandN[i]).toFixed(0)) },
      idPng: c2.toDataURL("image/png"),
    };
  }, job.lm || null);
  fs.writeFileSync(path.join(OUT, `${job.name}-id.png`), Buffer.from(r.idPng.split(",")[1], "base64"));
  delete r.idPng;
  console.log(JSON.stringify({ name: job.name, depth: +d.toFixed(5), ...r }));
}
await page.evaluate(() => window.__worldV6Debug.debugPose(null));
await browser.close();
if (errors.length) console.log("errors: " + errors.slice(0, 6).join(" | "));
