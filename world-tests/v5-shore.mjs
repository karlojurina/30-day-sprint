/**
 * dress-shore check (detail pass 2): renders the Landing, Base Camp and the rim
 * at 960x600 on the real page, with the UI (as the student sees it) and clean
 * (the WebGL buffer only), plus close shots of the props, and prints the frame's
 * triangles and calls and the module's stats.
 *
 *   node world-tests/v5-shore.mjs [names...]     names from SHOTS (default: a1 a2 rim)
 *
 * Out: world-tests/shots/v5-pass2/shore/{name}.png, {name}-clean.png, report.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v5-pass2/shore");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:3111";
const TRAIL_KEYS = 77;
// [name, trail key] on the rail; or [name, null, {pos, look}] a free close shot.
const SHOTS = {
  open: [0],
  a1: [2],
  a2: [6],
  approach: [9],
  rimnear: [10.5],
  rim: [12],
  closeA1: [null, { pos: [1395, 40, 4330], look: [1300, 18, 4185] }],
  closeDock: [null, { pos: [1470, 40, 4470], look: [1360, 6, 4330] }],
  closeA2: [null, { pos: [600, 190, 2930], look: [460, 150, 2730] }],
  closeRim: [null, { pos: [-60, 470, 1900], look: [-90, 425, 1790] }],
};
const argv = process.argv.slice(2);
const names = argv.length ? argv : ["a1", "a2", "rim"];

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.setViewport({ width: 960, height: 600 });
await page.goto(BASE + "/dev/world-v5", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const werr = await page.evaluate(() => window.__worldError || null);
if (werr) { console.log("world error", werr); process.exit(1); }
const frames = async (n) => {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try { await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 20000 }, c0, n); } catch {}
};
// HIDE=name,name hides those objects first (diagnosis: whose is this?).
if (process.env.HIDE) await page.evaluate((names) => { const sc = window.__worldV5Debug.debugScene(); for (const n of names) { const o = sc.getObjectByName(n); if (o) o.visible = false; } }, process.env.HIDE.split(","));
const report = { modules: await page.evaluate(() => { const s = window.__worldV5Debug.moduleStats(); return { shore: s["dress-shore"] ?? s }; }) };
console.log(JSON.stringify(report.modules).slice(0, 1500));
for (const name of names) {
  const [key, free] = SHOTS[name];
  const u = key === null ? 0.0263 : key / (TRAIL_KEYS - 1);
  const d = await page.evaluate((u) => {
    const r = window.__worldV5Debug.debugRail();
    let lo = 0, hi = r.length;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (r.tAtS(m) < u) lo = m; else hi = m; }
    return r.depthOfS((lo + hi) / 2);
  }, u);
  await page.evaluate((d) => { const sc = window.__worldV5Debug; window.scrollTo(0, sc.scrollYForDepth(d)); sc.seedDepth(d); }, d);
  await frames(3);
  let info;
  if (free) {
    info = await page.evaluate((free) => {
      const sc = window.__worldV5Debug;
      const cam = sc.camera;
      sc.setPaused(true);
      cam.position.set(...free.pos);
      cam.lookAt(...free.look);
      cam.updateMatrixWorld();
      const scene = sc.debugScene();
      const r = sc.renderer;
      for (let i = 0; i < 2; i++) { scene.traverse(() => {}); }
      r.info.autoReset = true;
      r.render(scene, cam);
      return { tris: r.info.render.triangles, calls: r.info.render.calls };
    }, free);
  } else {
    info = await page.evaluate(() => { const f = window.__worldFrame; const c = window.__worldCamera(); return { tris: f.triangles, calls: f.calls, cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: c.pitch }; });
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  }
  const url = await page.evaluate(() => {
    const sc = window.__worldV5Debug;
    const r = sc.renderer;
    r.setRenderTarget(null);
    r.render(sc.debugScene(), sc.camera);
    const gl = r.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); const id = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((h - 1 - y) * w + x) * 4, t = (y * w + x) * 4; id.data[t] = px[s]; id.data[t+1] = px[s+1]; id.data[t+2] = px[s+2]; id.data[t+3] = 255; }
    ctx.putImageData(id, 0, 0);
    return c.toDataURL("image/png");
  });
  fs.writeFileSync(path.join(OUT, `${name}-clean.png`), Buffer.from(url.split(",")[1], "base64"));
  if (free) await page.evaluate(() => window.__worldV5Debug.setPaused(false));
  report[name] = info;
  console.log(name, JSON.stringify(info));
}
report.errors = errors.slice(0, 10);
console.log("errors", errors.length, errors.slice(0, 5).join("\n"));
fs.writeFileSync(path.join(OUT, `report-${names.join("-")}.json`), JSON.stringify(report, null, 1));
await browser.close();
