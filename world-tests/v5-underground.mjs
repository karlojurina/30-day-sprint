/**
 * dress-underground renders (detail pass 2): the rim, the dive, the cave,
 * the tunnel, the lift and the shaft, at 960x600 on the real page.
 *
 *   node world-tests/v5-underground.mjs            all frames (in batches of <= 6 per run is up to the caller)
 *   node world-tests/v5-underground.mjs 0 1 2      only these frame indices
 *   UG_OUT=dir node ...                            write somewhere else
 *
 * Writes <name>.png and <name>.json (camera, triangles, calls, module stats).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.UG_OUT ? path.resolve(process.env.UG_OUT) : path.join(HERE, "shots/v5-pass2/underground");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const TRAIL_KEYS = 77;
const FRAMES = [
  [12, "rim", "the rim: the falls head-on"],
  [14, "dive1", "the dive: tipping over"],
  [16.6, "dive2", "sinking, the pool rising"],
  [20.6, "curtain", "through the curtain"],
  [23, "a3", "a3 the cave behind the falls"],
  [27.5, "tunnel", "the mine tunnel, torches"],
  [31, "a4", "a4 the Mine Lift"],
  [35, "shaft", "halfway up the shaft"],
  [37.15, "exit", "bursting out on the ridge"],
];
const pick = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const todo = pick.length ? pick.map((i) => FRAMES[i]) : FRAMES;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || /dress-underground/.test(m.text())) errors.push(m.type() + " " + m.text());
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
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 20000 }, c0, n);
  } catch {}
}
async function depthForU(u) {
  return page.evaluate((u) => {
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
}
await frames(3);
for (const [key, name, label] of todo) {
  const d = await depthForU(key / (TRAIL_KEYS - 1));
  await page.evaluate((d) => {
    const sc = window.__worldV5Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
  const info = await page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    let ug = null;
    try {
      const scene = window.__worldV5Debug.debugScene();
      ug = scene.userData.dressUnderground ? scene.userData.dressUnderground.stats() : null;
    } catch {}
    return { cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: +c.pitch.toFixed(1), triangles: f.triangles, calls: f.calls, ug };
  });
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ key, name, label, ...info }));
  console.log(`${name} key ${key} cam ${info.cam} pitch ${info.pitch} ${info.triangles} tris ${info.calls} calls`);
}
if (errors.length) console.log("ERRORS:\n" + errors.slice(0, 12).join("\n"));
await browser.close();
