/**
 * The sky's frames (dress-sky.ts): the rise, a7, the star look, the bridge,
 * boarding and the flight, at 960x600 on the real page.
 *
 *   node world-tests/v6-sky.mjs a      frames 48, 51, 54, 56, 62, 65
 *   node world-tests/v6-sky.mjs b      frames 67.5, 70.5, 58, 43, 47, 72.5
 *   node world-tests/v6-sky.mjs 54 56  any keys
 *
 * Writes world-tests/shots/v6-pass2/sky/k<key>.png + .json (triangles, calls,
 * dress-sky's stats). Keys are TRAIL indices (railU = key / 76).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v6-pass2/sky");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:3111";
const argv = process.argv.slice(2);
const SETS = { a: [48, 51, 54, 56, 62, 65], b: [67.5, 70.5, 58, 43, 47, 72.5] };
const keys = argv.flatMap((a) => (SETS[a] ? SETS[a] : isFinite(+a) ? [+a] : []));
const noUi = process.env.NOUI === "1";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.setViewport({ width: 960, height: 600 });
await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) {
  console.log("world error:", err);
  process.exit(1);
}
async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 20000 }, c0, n);
  } catch {}
}
await frames(2);
const stats = await page.evaluate(() => {
  const s = window.__worldV6Debug.moduleStats();
  return s["dress-sky"] ?? s;
});
console.log("dress-sky stats", JSON.stringify(stats));
for (const key of keys) {
  const d = await page.evaluate((u) => {
    const r = window.__worldV6Debug.debugRail();
    let lo = 0;
    let hi = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (r.tAtS(m) < u) lo = m;
      else hi = m;
    }
    return r.depthOfS((lo + hi) / 2);
  }, key / 76);
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
  if (noUi) await page.evaluate(() => document.querySelectorAll("body > div *:not(canvas)").forEach((e) => { if (!e.querySelector("canvas") && e.tagName !== "CANVAS") e.style.visibility = "hidden"; }));
  const f = await page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    return { triangles: f.triangles, calls: f.calls, cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: +c.pitch.toFixed(1) };
  });
  const file = path.join(OUT, `k${key}.png`);
  await page.screenshot({ path: file });
  fs.writeFileSync(path.join(OUT, `k${key}.json`), JSON.stringify({ key, ...f }));
  console.log(`k${key} ${f.triangles} tris / ${f.calls} calls cam ${f.cam} pitch ${f.pitch}`);
}
if (errors.length) console.log("errors:", errors.slice(0, 6).join("\n"));
await browser.close();
