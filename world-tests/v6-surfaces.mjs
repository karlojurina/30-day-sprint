/**
 * V5 surfaces renders (surfaces.ts: terrain paint, water, the falls): named frames on the rail at
 * 960x600, with the frame's triangles and calls and the two modules' stats.
 *
 *   node world-tests/v6-surfaces.mjs a1 a2 a5 collar          (<= 6 names a run)
 *   node world-tests/v6-surfaces.mjs 37.15 40.5 --tag test    (fractional TRAIL keys)
 *   SURF_OUT=... overrides world-tests/shots/v6/surfaces/
 *
 * Seeds depth directly (no glide). SwiftShader: about 1 s a frame.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SURF_OUT ? path.resolve(process.env.SURF_OUT) : path.join(HERE, "shots/v6/surfaces");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const argv = process.argv.slice(2);
const ti = argv.indexOf("--tag");
const TAG = ti >= 0 ? argv[ti + 1] : "";
const names = argv.filter((a, i) => !a.startsWith("--") && !(ti >= 0 && i === ti + 1));
const TRAIL_KEYS = 77;
/** Named frames: [TRAIL key, label]. */
const NAMED = {
  open: [0, "the opening, over the bay"],
  a1: [2, "a1 Introduction"],
  a2: [6, "a2 Fundamentals"],
  rim: [12, "the rim: the falls head-on"],
  dive1: [14, "the dive: tipping over"],
  dive: [16.6, "sinking, the pool rising"],
  pool: [19, "level at the pool"],
  a3: [23, "a3 the cave"],
  collar: [37.15, "bursting out on the ridge"],
  shelf: [38.6, "the rim shelf, facing the saddle"],
  meadow: [40.5, "the saddle and the meadow"],
  a5: [43, "a5 the Mirror Lake"],
  a6: [47, "a6 the Great Tree"],
  a7: [54, "a7 the Observatory"],
  a8: [75, "a8 the Harbour Isle"],
};
const todo = (names.length ? names : ["a1", "a2", "rim", "dive1", "dive", "a3"]).slice(0, 6).map((n) => {
  if (NAMED[n]) return [n, ...NAMED[n]];
  const k = Number(n);
  return [`k${n}`, k, `key ${n}`];
});

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.setViewport({ width: 960, height: 600 });
await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) {
  console.log("world error:", err);
  await browser.close();
  process.exit(1);
}
const frames = async (n) => {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 20000 }, c0, n);
  } catch {}
};
const stats = await page.evaluate(() => {
  const s = window.__worldV6Debug.moduleStats();
  return { surfaces: s.surfaces, install: s.install };
});
console.log("module stats:", JSON.stringify(stats));
const rows = [];
for (const [name, key, label] of todo) {
  const u = key / (TRAIL_KEYS - 1);
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
  }, u);
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
  const f = await page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    return { cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: +c.pitch.toFixed(1), triangles: f.triangles, calls: f.calls };
  });
  const file = path.join(OUT, `${name}${TAG ? "-" + TAG : ""}.png`);
  await page.screenshot({ path: file });
  const live = await page.evaluate(() => {
    const s = window.__worldV6Debug.moduleStats();
    return { adopted: s.surfaces?.adopted ?? null };
  });
  rows.push({ name, key, label, ...f, live, file });
  console.log(`${name} (${label}) cam ${f.cam} pitch ${f.pitch}: ${f.triangles} tris / ${f.calls} calls; adopted ${live.adopted} -> ${file}`);
}
fs.writeFileSync(path.join(OUT, `report${TAG ? "-" + TAG : ""}-${todo.map((t) => t[0]).join("-")}.json`), JSON.stringify({ stats, rows, errors }, null, 1));
if (errors.length) console.log("console:", errors.slice(0, 12).join("\n  "));
await browser.close();
