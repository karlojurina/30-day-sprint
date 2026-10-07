/**
 * B1 (trees) shots on the real GPU: stops, strip keys, the painted foliage
 * atlas and a black silhouette strip of the species cells.
 *
 *   node world-tests/v6-b1-shots.mjs atlas stop1 stop2 k0 k11.5 ...   [--out dir] [--tag name] [--burst]
 *
 * stopN = PLACES[N-1]'s stop depth; kX = fractional TRAIL key X. --burst
 * times 8 renders x 5 (fastest, ms per frame) at each position.
 * Writes <out>/<tag>-<target>.png and prints the forest module's stats.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const OUT = path.resolve(flag("--out", path.join(HERE, "shots/v6/B1-trees")));
const TAG = flag("--tag", "b1");
const BURST = argv.includes("--burst");
const W = Number(process.env.SHOT_W || 1691);
const H = Number(process.env.SHOT_H || 1278);
const targets = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--out", "--tag"].includes(argv[i - 1])));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 180000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.setViewport({ width: W, height: H });
const t0 = Date.now();
await page.goto("http://localhost:3111/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) {
  console.log("world error:", err);
  await browser.close();
  process.exit(1);
}
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 20000 }, c0, n);
  } catch {
    /* the loop sleeps when nothing moves */
  }
}
async function depthFor(t) {
  return page.evaluate((t) => {
    const sc = window.__worldV6Debug;
    if (t.startsWith("stop")) return sc.stopDepths()[Number(t.slice(4)) - 1];
    const k = Number(t.slice(1));
    const n = sc.ctx?.layout?.TRAIL?.length ?? 86;
    const u = k / (n - 1);
    const r = sc.debugRail();
    let lo = 0;
    let hi = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (r.tAtS(m) < u) lo = m;
      else hi = m;
    }
    return r.depthOfS((lo + hi) / 2);
  }, t);
}

for (const t of targets) {
  if (t === "atlas") {
    const png = await page.evaluate(() => {
      const get = window.__v6FoliageAtlasData;
      if (!get) return null;
      const data = get();
      const N = 1024;
      const out = [];
      for (const mode of ["colour", "sil"]) {
        const cv = document.createElement("canvas");
        cv.width = N;
        cv.height = N;
        const g = cv.getContext("2d");
        g.fillStyle = mode === "sil" ? "#e9e4d8" : "#9fc3d8";
        g.fillRect(0, 0, N, N);
        const img = g.getImageData(0, 0, N, N);
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            const s = ((N - 1 - y) * N + x) * 4;
            const o = (y * N + x) * 4;
            const a = Math.min(1, data[s + 3] / 204);
            if (mode === "sil") {
              const v = 233 * (1 - a);
              img.data[o] = img.data[o] * (1 - a);
              img.data[o + 1] = img.data[o + 1] * (1 - a);
              img.data[o + 2] = img.data[o + 2] * (1 - a);
              void v;
            } else {
              const glow = data[s + 3] > 225;
              img.data[o] = img.data[o] * (1 - a) + (glow ? 255 : data[s]) * a;
              img.data[o + 1] = img.data[o + 1] * (1 - a) + (glow ? 80 : data[s + 1]) * a;
              img.data[o + 2] = img.data[o + 2] * (1 - a) + (glow ? 255 : data[s + 2]) * a;
            }
          }
        }
        g.putImageData(img, 0, 0);
        g.strokeStyle = "rgba(0,0,0,0.25)";
        for (let i = 1; i < 4; i++) {
          g.beginPath();
          g.moveTo(i * 256, 0);
          g.lineTo(i * 256, N);
          g.moveTo(0, i * 256);
          g.lineTo(N, i * 256);
          g.stroke();
        }
        out.push(cv.toDataURL("image/png"));
      }
      return out;
    });
    if (!png) {
      console.log("atlas: no data (forest did not paint it)");
      continue;
    }
    fs.writeFileSync(path.join(OUT, `${TAG}-atlas.png`), Buffer.from(png[0].split(",")[1], "base64"));
    fs.writeFileSync(path.join(OUT, `${TAG}-atlas-sil.png`), Buffer.from(png[1].split(",")[1], "base64"));
    console.log(`atlas -> ${TAG}-atlas.png, ${TAG}-atlas-sil.png`);
    continue;
  }
  const d = await depthFor(t);
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
  await new Promise((r) => setTimeout(r, 400));
  await frames(2);
  const file = path.join(OUT, `${TAG}-${t}.png`);
  await page.screenshot({ path: file });
  const info = await page.evaluate((burst) => {
    const sc = window.__worldV6Debug;
    const f = window.__worldFrame || {};
    let st = null;
    try {
      const all = sc.moduleStats();
      st = all.forest ?? all.find?.((m) => m.name === "forest") ?? all;
    } catch (e) {
      st = String(e);
    }
    let ms = null;
    if (burst) {
      const r = sc.renderer;
      const gl = r.getContext();
      const px = new Uint8Array(4);
      const scene = sc.debugScene();
      const cam = sc.camera;
      const t0 = performance.now();
      while (performance.now() - t0 < 250) {
        for (let i = 0; i < 8; i++) r.render(scene, cam);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      let best = 1e9;
      for (let k = 0; k < 5; k++) {
        const a = performance.now();
        for (let i = 0; i < 8; i++) r.render(scene, cam);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        best = Math.min(best, (performance.now() - a) / 8);
      }
      ms = +best.toFixed(2);
    }
    return { tris: f.triangles, calls: f.calls, pr: sc.renderer?.getPixelRatio?.(), ms, forest: st };
  }, BURST);
  const fs0 = info.forest && typeof info.forest === "object" ? info.forest : {};
  console.log(
    `${t}: ${path.basename(file)} frame ${info.tris} tris / ${info.calls} calls${info.ms !== null ? ` / ${info.ms} ms @PR${info.pr}` : ""} | forest tris ${fs0.triangles} calls ${fs0.calls} vis ${fs0.visible} lod ${fs0.lod0}/${fs0.lod1}/${fs0.lod2} slots ${fs0.slots}`,
  );
}
const st = await page.evaluate(() => {
  try {
    const all = window.__worldV6Debug.moduleStats();
    return all.forest ?? all;
  } catch (e) {
    return String(e);
  }
});
console.log("forest stats:", JSON.stringify(st).slice(0, 1500));
console.log(`errors: ${errors.length}`, errors.slice(0, 6).join(" | "));
await browser.close();
