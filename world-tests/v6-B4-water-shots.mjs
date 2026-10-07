/**
 * B4 water: renders the water's frames on the real GPU and times them.
 *
 *   node world-tests/v6-B4-water-shots.mjs shots <tag> [keys]   screenshots at 1691x1278 (DPR 1)
 *   node world-tests/v6-B4-water-shots.mjs perf  <tag> [keys]   burst ms at pixel ratio 1.5 (indicative: the GPU is shared)
 *
 * keys: comma list of fractional TRAIL key indices (default: the water frames),
 * or "a3" style stop ids (the page's stopDepths()). Output:
 * world-tests/shots/v6/B4-water/<tag>-<key>.png and <tag>-perf.json.
 * Keep each run short (the harness stall rule): 4 to 6 frames a run.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v6/B4-water");
fs.mkdirSync(OUT, { recursive: true });
const mode = process.argv[2] || "shots";
const tag = process.argv[3] || "t";
const DEFAULT = "0,15,17,18.7,23,a3";
const keys = (process.argv[4] || DEFAULT).split(",").map((s) => s.trim()).filter(Boolean);
const W = Number(process.env.W || 1691), H = Number(process.env.H || 1278);
const DPR = mode === "perf" ? 1.5 : 1;
const WAIT = Number(process.env.WAIT || 900);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STOP_IDS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 120000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
await page.goto("http://localhost:3111/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 80000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 80000, polling: 200 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) { console.log("world error", err); await browser.close(); process.exit(1); }

async function depthFor(k) {
  return page.evaluate((k, ids) => {
    const sc = window.__worldV6Debug;
    const si = ids.indexOf(k);
    if (si >= 0) return sc.stopDepths()[si];
    const n = sc.ctx?.layout?.TRAIL?.length ?? sc.ctx?.layout?.KEYS?.length ?? 86;
    const u = Number(k) / (n - 1);
    const rr = sc.debugRail();
    let lo = 0, hi = rr.length;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (rr.tAtS(m) < u) lo = m; else hi = m; }
    return rr.depthOfS((lo + hi) / 2);
  }, k, STOP_IDS);
}

const result = [];
for (const k of keys) {
  const d = await depthFor(k);
  await page.evaluate((d) => { const sc = window.__worldV6Debug; window.scrollTo(0, sc.scrollYForDepth(d)); sc.seedDepth(d); }, d);
  await sleep(WAIT);
  const info = await page.evaluate(() => {
    try {
      const f = window.__worldFrame; const c = window.__worldCamera();
      return { cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: +c.pitch.toFixed(1), tris: f.triangles, calls: f.calls };
    } catch (e) { return { cam: null, err: String(e) }; }
  });
  if (mode === "perf") {
    const b = await page.evaluate(() => {
      const sc = window.__worldV6Debug; const r = sc.renderer; const gl = r.getContext(); const px = new Uint8Array(4);
      r.setPixelRatio(1.5);
      const scene = sc.debugScene(), cam = sc.camera;
      const t0 = performance.now();
      while (performance.now() - t0 < 250) { for (let i = 0; i < 8; i++) r.render(scene, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      const per = [];
      for (let j = 0; j < 5; j++) { const a = performance.now(); for (let i = 0; i < 8; i++) r.render(scene, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); per.push((performance.now() - a) / 8); }
      per.sort((x, y) => x - y);
      return { min: +per[0].toFixed(2), med: +per[2].toFixed(2), buf: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
    });
    result.push({ key: k, ...info, ...b });
    console.log(`key ${k}: ${b.min} ms min, ${b.med} med @${b.buf.join("x")}  cam ${info.cam} pitch ${info.pitch}  ${info.tris} tris ${info.calls} calls`);
  } else {
    const file = path.join(OUT, `${tag}-${k}.png`);
    await page.screenshot({ path: file });
    result.push({ key: k, file, ...info });
    console.log(`key ${k}: ${file}  cam ${info.cam} pitch ${info.pitch}  ${info.tris} tris ${info.calls} calls`);
  }
}
if (mode === "perf") fs.writeFileSync(path.join(OUT, `${tag}-perf.json`), JSON.stringify(result, null, 2));
const ws = await page.evaluate(() => { try { return window.__worldV6Debug.moduleStats().water; } catch (e) { return String(e); } });
console.log("water stats", JSON.stringify(ws));
if (errors.length) console.log("errors:", errors.slice(0, 6).join("\n"));
await browser.close();
