/**
 * B3 ground and cover renders (world_art_bible_v6.md 4.7): named TRAIL keys
 * at Lovro's size on the real GPU, with the frame's triangles and calls and
 * the cover and surfaces modules' stats. Optional crops and the grass atlas.
 *
 *   node world-tests/v6-B3-shoot.mjs 0 2 7 --tag t1            (fractional TRAIL keys)
 *   node world-tests/v6-B3-shoot.mjs 2 --crop 0.25,0.55,0.5,0.45 --tag sand
 *   node world-tests/v6-B3-shoot.mjs --atlas                    (the grass atlas to a PNG)
 *   B3_W / B3_H override the size (default 1691x1278).
 *
 * Writes world-tests/shots/v6/B3-ground/<tag>-k<key>.png and <tag>-stats.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v6/B3-ground");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const W = Number(process.env.B3_W || 1691);
const H = Number(process.env.B3_H || 1278);
const argv = process.argv.slice(2);
const flag = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : null;
};
const TAG = flag("--tag") || "b3";
const CROP = flag("--crop");
const ATLAS = argv.includes("--atlas");
const NOUI = argv.includes("--noui");
const BARE = argv.includes("--bare");
const skip = new Set([flag("--tag"), flag("--crop")].filter(Boolean));
const keys = argv.filter((a) => !a.startsWith("--") && !skip.has(a)).map(Number).filter((n) => Number.isFinite(n));
const TRAIL_KEYS = 86;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 240000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message.slice(0, 300)));
await page.setViewport({ width: W, height: H });
await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 200000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) {
  console.log("world error:", err);
  await browser.close();
  process.exit(1);
}

async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 20000 }, c0, n);
  } catch {}
}
async function depthForU(u) {
  return page.evaluate((u) => {
    const r = window.__worldV6Debug.debugRail();
    let lo = 0;
    let hi = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (r.tAtS(m) < u) lo = m;
      else hi = m;
    }
    return r.depthOfS((lo + hi) / 2);
  }, u);
}

const report = { errors, frames: [] };
if (NOUI) {
  await page.addStyleTag({ content: "body * { visibility: hidden !important; } canvas { visibility: visible !important; }" });
}
if (ATLAS) {
  const url = await page.evaluate(() => {
    const scene = window.__worldV6Debug.debugScene();
    let tex = null;
    scene.traverse((o) => {
      const m = o.material;
      if (!tex && m && m.name === "V6CoverCards") {
        const mesh = o;
        tex = mesh.material.userData.atlas || null;
      }
    });
    // The atlas is the cards material's uAtlas; find it through the program uniforms if not stashed.
    if (!tex) {
      scene.traverse((o) => {
        if (tex || !o.material || o.material.name !== "V6CoverCards") return;
        const props = window.__worldV6Debug.renderer.properties.get(o.material);
        const u = props && props.uniforms && props.uniforms.uAtlas;
        if (u) tex = u.value;
      });
    }
    if (!tex || !tex.image || !tex.image.data) return null;
    const { data, width, height } = tex.image;
    const c = document.createElement("canvas");
    c.width = width * 2;
    c.height = height;
    const g = c.getContext("2d");
    const a = g.createImageData(width, height);
    const b = g.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      // Left: a preview (root dark green to pale tip, heads orange, R as value) over grey.
      const R = data[i * 4] / 255;
      const G = data[i * 4 + 1] / 255;
      const B = data[i * 4 + 2] / 255;
      const A = data[i * 4 + 3] / 255;
      const v = 0.6 + 0.52 * R;
      let col = [60 + (215 - 60) * B, 70 + (190 - 70) * B, 30 + (110 - 30) * B].map((x) => x * v);
      if (G > 0.5) col = [230 * (0.5 + 0.62 * R), 120 * (0.5 + 0.62 * R), 60 * (0.5 + 0.62 * R)];
      const bg = 70;
      a.data[i * 4] = bg + (col[0] - bg) * A;
      a.data[i * 4 + 1] = bg + (col[1] - bg) * A;
      a.data[i * 4 + 2] = bg + (col[2] - bg) * A;
      a.data[i * 4 + 3] = 255;
      // Right: the raw channels (RGB) with alpha as is.
      b.data[i * 4] = data[i * 4];
      b.data[i * 4 + 1] = data[i * 4 + 1];
      b.data[i * 4 + 2] = data[i * 4 + 2];
      b.data[i * 4 + 3] = 255;
    }
    g.putImageData(a, 0, 0);
    g.putImageData(b, width, 0);
    return c.toDataURL("image/png");
  });
  if (url) {
    fs.writeFileSync(path.join(OUT, `${TAG}-atlas.png`), Buffer.from(url.split(",")[1], "base64"));
    console.log("atlas written");
  } else console.log("atlas not found");
}

async function ready() {
  await page.waitForFunction(() => window.__worldReady && window.__worldV6Debug && typeof window.__worldCamera === "function", { timeout: 200000, polling: 300 });
}
async function shoot(k) {
  await ready();
  const d = await depthForU(k / (TRAIL_KEYS - 1));
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
  await new Promise((r) => setTimeout(r, 500));
  await frames(2);
  const file = path.join(OUT, `${TAG}-k${k}.png`);
  const clip = CROP ? (() => {
    const [x, y, w, h] = CROP.split(",").map(Number);
    return { x: Math.round(x * W), y: Math.round(y * H), width: Math.round(w * W), height: Math.round(h * H) };
  })() : undefined;
  const info = await page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    const ms = window.__worldV6Debug.moduleStats();
    return {
      cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)],
      pitch: +c.pitch.toFixed(1),
      triangles: f.triangles,
      calls: f.calls,
      cover: ms.cover,
      surfaces: ms.surfaces,
      install: ms.install,
    };
  });
  await page.screenshot({ path: file, clip });
  if (BARE) {
    // Terrain in white, everything else black (cover cards count as their whole
    // quads, so this under counts bare ground a little); the largest 4-connected
    // terrain region in the lower 60% of the frame, as a share of the frame.
    info.bare = await page.evaluate(() => {
      const sc = window.__worldV6Debug;
      const scene = sc.debugScene();
      const r = sc.renderer;
      const cam = sc.camera;
      let Basic = null;
      scene.traverse((o) => {
        if (!Basic && o.material && o.material.type === "MeshBasicMaterial") Basic = o.material.constructor;
      });
      if (!Basic) return null;
      const white = new Basic({ color: 0xffffff, fog: false });
      const black = new Basic({ color: 0x000000, fog: false });
      const was = [];
      scene.traverse((o) => {
        if (!o.material) return;
        was.push([o, o.material]);
        o.material = /^Terrain/.test(o.name) ? white : black;
      });
      const bg = scene.background;
      scene.background = null;
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.render(scene, cam);
      const gl = r.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (const [o, m] of was) o.material = m;
      scene.background = bg;
      white.dispose();
      black.dispose();
      // Downsample by 4 and flood fill; rows 0..0.6h from the bottom are the lower 60%.
      const S = 4;
      const gw = Math.floor(w / S);
      const gh = Math.floor(h / S);
      const lowRows = Math.floor(gh * 0.6);
      const m = new Uint8Array(gw * lowRows);
      let terr = 0;
      for (let y = 0; y < lowRows; y++)
        for (let x = 0; x < gw; x++) {
          const v = px[((y * S) * w + x * S) * 4];
          if (v > 128) {
            m[y * gw + x] = 1;
            terr++;
          }
        }
      let best = 0;
      const stack = [];
      for (let i = 0; i < m.length; i++) {
        if (m[i] !== 1) continue;
        let n = 0;
        stack.push(i);
        m[i] = 2;
        while (stack.length) {
          const k = stack.pop();
          n++;
          const x = k % gw;
          const y = (k - x) / gw;
          const nb = [x > 0 ? k - 1 : -1, x < gw - 1 ? k + 1 : -1, y > 0 ? k - gw : -1, y < lowRows - 1 ? k + gw : -1];
          for (const q of nb) if (q >= 0 && m[q] === 1) { m[q] = 2; stack.push(q); }
        }
        if (n > best) best = n;
      }
      return { largestPct: +((best / (gw * gh)) * 100).toFixed(1), terrainLowPct: +((terr / (gw * gh)) * 100).toFixed(1) };
    });
  }
  return { file, info };
}

for (const k of keys) {
  let res = null;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try {
      res = await shoot(k);
    } catch (e) {
      console.log(`k${k}: attempt ${attempt + 1} failed (${String(e.message || e).slice(0, 120)}), retrying`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!res) continue;
  const { file, info } = res;
  report.frames.push({ key: k, file, ...info });
  const cv = info.cover || {};
  console.log(`k${k}: tris ${info.triangles} calls ${info.calls} | cover live ${cv.live} tris ${cv.visibleTris} calls ${cv.visibleCalls} beyond900 ${cv.liveBeyond900} inside ${cv.insideFootprints} cards ${cv.cards}${info.bare ? ` | bare largest ${info.bare.largestPct}% (terrain in lower 60%: ${info.bare.terrainLowPct}%)` : ""}`);
}
fs.writeFileSync(path.join(OUT, `${TAG}-stats.json`), JSON.stringify(report, null, 1));
if (errors.length) console.log("console errors:", errors.slice(0, 6));
await browser.close();
