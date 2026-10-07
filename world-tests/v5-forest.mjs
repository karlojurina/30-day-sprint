/**
 * V5 forest proof: renders named rail keys at 960x600 on /dev/world-v5 and
 * writes each frame's triangles, calls and the forest module's stats.
 *
 *   node world-tests/v5-forest.mjs [key ...]      default: 6 43 47 48
 *   FOREST_OUT=dir  FOREST_TAG=name  FOREST_HIDE=Forest  (hide objects by name prefix, for A/B)
 *
 * Keys are fractional TRAIL indices (railU = key / 76), as v5-strip.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FOREST_OUT ? path.resolve(process.env.FOREST_OUT) : path.join(HERE, "shots/v5/forest");
const TAG = process.env.FOREST_TAG || "f";
const HIDE = process.env.FOREST_HIDE || "";
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const TRAIL_KEYS = 77;
const keys = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const KEYS = keys.length ? keys.slice(0, 6) : [6, 43, 47, 48];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || /forest/i.test(m.text())) errors.push(m.type() + ": " + m.text());
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.setViewport({ width: 960, height: 600 });
await page.goto(BASE + "/dev/world-v5", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) throw new Error("world error: " + err);

async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 30000 }, c0, n);
  } catch {}
}
if (HIDE) await page.evaluate((p) => window.__worldHide && window.__worldHide(p), HIDE);

const report = [];
for (const key of KEYS) {
  const u = key / (TRAIL_KEYS - 1);
  const d = await page.evaluate((u) => {
    const r = window.__worldV5Debug.debugRail();
    let lo = 0;
    let hi = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (r.tAtS(m) < u) lo = m;
      else hi = m;
    }
    return r.depthOfS((lo + hi) / 2);
  }, u);
  await page.evaluate((d) => {
    const sc = window.__worldV5Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
  const file = path.join(OUT, `${TAG}-k${key}.png`);
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    const ms = window.__worldV5Debug.moduleStats();
    return { cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], triangles: f.triangles, calls: f.calls, forest: ms.forest, install: ms.install };
  });
  report.push({ key, file: path.relative(HERE, file), ...info });
  console.log(`k${key}  tris ${info.triangles}  calls ${info.calls}  forest ${JSON.stringify(info.forest && { visible: info.forest.visible, lod0: info.forest.lod0, lod1: info.forest.lod1, lod2: info.forest.lod2, tris: info.forest.triangles, calls: info.forest.calls, ms: info.forest.compactMs })}`);
}
fs.writeFileSync(path.join(OUT, `${TAG}-report.json`), JSON.stringify({ report, errors }, null, 2));
if (errors.length) console.log("errors:\n" + errors.slice(0, 10).join("\n"));
await browser.close();
