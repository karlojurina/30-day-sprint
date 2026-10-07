/**
 * B8 (the sky places) shots on the real page, real GPU.
 *
 *   node world-tests/v6-B8-shoot.mjs <name>=<key>[,...] [cam:<name>=x,y,z,bearing,pitch[,fov]] [--ui] [--progress p] [--tag t]
 *
 * <key> is a fractional TRAIL key index (railU = key / (keys - 1)); cam:
 * renders a free camera pose (bearing compass degrees, pitch degrees below the
 * horizon, negative looks up) with the page's own renderer. Shots go to
 * world-tests/shots/v6/B8-sky-places/<name><tag>.png at 1691x1278, UI hidden
 * unless --ui. Prints the frame's triangles and calls and the B8 modules' stats.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v6/B8-sky-places");
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const flag = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : null;
};
const UI = argv.includes("--ui");
const PROGRESS = flag("--progress");
const TAG = flag("--tag") ?? "";
const W = Number(process.env.SHOT_W || 1691);
const H = Number(process.env.SHOT_H || 1278);
const jobs = [];
for (const a of argv) {
  if (a.startsWith("--") || a === PROGRESS || a === TAG) continue;
  if (a.startsWith("cam:")) {
    const [name, v] = a.slice(4).split("=");
    const n = v.split(",").map(Number);
    jobs.push({ name, cam: { x: n[0], y: n[1], z: n[2], bearing: n[3], pitch: n[4], fov: n[5] } });
  } else if (a.includes("=")) {
    const [name, k] = a.split("=");
    jobs.push({ name, key: Number(k) });
  }
}

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 240000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.setViewport({ width: W, height: H });
await page.goto("http://localhost:3111/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) {
  console.log("WORLD ERROR", err);
  await browser.close();
  process.exit(1);
}
if (!UI) await page.addStyleTag({ content: "body * { visibility: hidden !important; } canvas { visibility: visible !important; }" });
if (PROGRESS !== null) await page.evaluate((p) => window.__worldV6Debug.setProgress(p), Number(PROGRESS));

const frames = async (n) => {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 20000 }, c0, n);
  } catch {
    /* the loop sleeps once nothing moves */
  }
};
const nKeys = await page.evaluate(() => window.__worldV6Debug.ctx?.layout?.TRAIL?.length ?? 86);

for (const j of jobs) {
  const file = path.join(OUT, `${j.name}${TAG}.png`);
  if (j.key !== undefined) {
    const u = j.key / (nKeys - 1);
    await page.evaluate((u) => {
      const sc = window.__worldV6Debug;
      const r = sc.debugRail();
      let lo = 0;
      let hi = r.length;
      for (let i = 0; i < 60; i++) {
        const m = (lo + hi) / 2;
        if (r.tAtS(m) < u) lo = m;
        else hi = m;
      }
      const d = r.depthOfS((lo + hi) / 2);
      window.scrollTo(0, sc.scrollYForDepth(d));
      sc.seedDepth(d);
    }, u);
    await frames(3);
    await new Promise((r) => setTimeout(r, 350));
    await frames(2);
    await page.screenshot({ path: file });
    const info = await page.evaluate(() => {
      const f = window.__worldFrame ?? {};
      const c = window.__worldCamera ? window.__worldCamera() : { x: NaN, y: NaN, z: NaN, pitch: NaN };
      return { cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: +(+c.pitch).toFixed(1), tris: f.triangles, calls: f.calls };
    });
    console.log(`${j.name} key ${j.key}: cam ${info.cam.join(",")} pitch ${info.pitch} | ${info.tris} tris, ${info.calls} calls -> ${path.basename(file)}`);
  } else {
    // A free camera: move the page's camera, render with its own renderer, read the canvas.
    const url = await page.evaluate((c) => {
      const sc = window.__worldV6Debug;
      const cam = sc.camera;
      const b = (c.bearing * Math.PI) / 180;
      const p = (c.pitch * Math.PI) / 180;
      cam.position.set(c.x, c.y, c.z);
      if (c.fov) cam.fov = c.fov;
      cam.updateProjectionMatrix();
      cam.lookAt(c.x + Math.sin(b) * Math.cos(p) * 100, c.y - Math.sin(p) * 100, c.z - Math.cos(b) * Math.cos(p) * 100);
      cam.updateMatrixWorld(true);
      const scene = sc.debugScene();
      sc.renderer.setRenderTarget(null);
      sc.renderer.render(scene, cam);
      return sc.renderer.domElement.toDataURL("image/png");
    }, j.cam);
    fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
    console.log(`${j.name} cam ${JSON.stringify(j.cam)} -> ${path.basename(file)}`);
  }
}
const stats = await page.evaluate(() => {
  const s = window.__worldV6Debug.moduleStats();
  const pick = {};
  for (const k of Object.keys(s)) if (/sky|gate/i.test(k)) pick[k] = s[k];
  return pick;
});
console.log("stats", JSON.stringify(stats));
if (errors.length) console.log("console errors:", errors.slice(0, 8).join("\n  "));
await browser.close();
