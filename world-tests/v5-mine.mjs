/**
 * Grey pass 3, blocks + light: renders the mine and the Great Tree on the real
 * page (/dev/world-v5) at 960x600, by TRAIL key (railU = key / (keys - 1)).
 *
 *   node world-tests/v5-mine.mjs [--batch N] [--keys 21,23.5] [--out DIR]
 *
 * Frames (6 per batch so no run is long): the curtain crossing, the a3 stop in
 * the cave, the tunnel, the a4 stop at the lift's foot, halfway up the shaft,
 * the burst out over the collar; then the a5 reflection and the a6 Great Tree.
 * Writes PNGs and a report.json (camera, triangles, draw calls, blocks and
 * light stats) to world-tests/shots/v5/mine/ (or --out).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : null;
};
const OUT = flag("--out") ? path.resolve(flag("--out")) : path.join(HERE, "shots/v5/mine");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";

const FRAMES = [
  [20.62, "m1-curtain", "through the curtain"],
  [23, "m2-a3-cave", "a3: in the cave, looking out"],
  [27.5, "m3-tunnel", "the tunnel"],
  [31, "m4-a4-lift", "a4: the lift at the shaft's foot"],
  [34.6, "m5-shaft", "halfway up the shaft"],
  [37.15, "m6-burst", "bursting out over the collar"],
  [43, "t1-a5-lake", "a5: the lake, the island's reflection"],
  [47, "t2-a6-tree", "a6: the Great Tree"],
  [21.6, "m7-hall", "into the hall"],
  [32, "m8-in-cage", "stepping into the cage"],
  [36.2, "m9-top", "near the top of the shaft"],
  [24.4, "m10-to-tunnel", "turning to the tunnel"],
];
const BATCH = flag("--batch") === null ? null : Number(flag("--batch"));
const KEYS = flag("--keys");
let todo = FRAMES;
if (KEYS) todo = KEYS.split(",").map((k) => [Number(k), `k${k}`, `key ${k}`]);
else if (BATCH !== null) todo = FRAMES.slice(BATCH * 6, BATCH * 6 + 6);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + " " + m.text());
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
await frames(2);
const nKeys = await page.evaluate(() => {
  const r = window.__worldV5Debug.debugRail();
  return r.trail ? r.trail.length : null;
});
const TRAIL_KEYS = nKeys ?? 77;

const report = fs.existsSync(path.join(OUT, "report.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "report.json"), "utf8")) : {};
for (const [key, name, label] of todo) {
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
  const info = await page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    const sc = window.__worldV5Debug;
    let mods = null;
    try {
      mods = typeof sc.moduleStats === "function" ? sc.moduleStats() : null;
    } catch {}
    return {
      railU: +window.__worldRailU().toFixed(4),
      cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)],
      pitch: +c.pitch.toFixed(1),
      triangles: f.triangles,
      calls: f.calls,
      mods,
    };
  });
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  report[name] = { key, label, ...info };
  console.log(`${name} key ${key} cam ${info.cam} pitch ${info.pitch} tris ${info.triangles} calls ${info.calls}`);
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
if (errors.length) console.log("console:", errors.slice(0, 8).join("\n"));
await browser.close();
