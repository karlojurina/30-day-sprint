/**
 * Detail pass 2, the Harbour Isle (dress-harbour.ts): renders the approach
 * from the flight, the run-in, the dock arrival, the a8 stop and the tail at
 * 960x600, with frame triangles / calls and the module's stats.
 *
 *   node world-tests/v5-harbour.mjs [keys...]      default: 70.5 72 73 75 76
 * Output: world-tests/shots/v5-pass2/harbour/ (HARBOUR_OUT overrides).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.HARBOUR_OUT ? path.resolve(process.env.HARBOUR_OUT) : path.join(HERE, "shots/v5-pass2/harbour");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const TRAIL_KEYS = 77;
const args = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const KEYS = args.length ? args : [70.5, 72, 73, 75, 76];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
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
const stats = await page.evaluate(() => {
  const s = window.__worldV5Debug.moduleStats?.() ?? {};
  return s["dress-harbour"] ?? s;
});
console.log("dress-harbour stats", JSON.stringify(stats));
const rows = [];
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
  const f = await page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    return { cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: +c.pitch.toFixed(1), triangles: f.triangles, calls: f.calls };
  });
  const file = path.join(OUT, `h-${String(key).replace(".", "_")}.png`);
  await page.screenshot({ path: file });
  rows.push({ key, ...f, file });
  console.log(`key ${key} cam ${f.cam} pitch ${f.pitch} tris ${f.triangles} calls ${f.calls} -> ${path.basename(file)}`);
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ stats, rows, errors }, null, 1));
if (errors.length) console.log("errors:", errors.slice(0, 8).join("\n"));
await browser.close();
