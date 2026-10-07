/**
 * Integration probe for /dev/world-v5 (pass 2): loads the page once, reports
 * console errors, /api requests, each module's install result and stats, the
 * standing grey stand-ins, and the triangles / draw calls at every stop and
 * at the strip's frames (no screenshots unless --shots DIR).
 *
 *   node world-tests/v5-integrate.mjs                 stops only
 *   node world-tests/v5-integrate.mjs --keys 0,12,20.6  extra TRAIL keys
 *   node world-tests/v5-integrate.mjs --shots DIR     also save each frame
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const argv = process.argv.slice(2);
const flag = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : null;
};
const KEYS = (flag("--keys") || "").split(",").filter(Boolean).map(Number);
const SHOTS = flag("--shots");
const W = Number(flag("--w") || 960);
const H = Number(flag("--h") || 600);
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const TRAIL_KEYS = 77;

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
const warns = [];
const api = [];
const infos = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
  else if (m.type() === "warning" || m.type() === "warn") warns.push(m.text());
  else if (m.text().includes("[world-v5]")) infos.push(m.text());
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("request", (r) => {
  if (new URL(r.url()).pathname.startsWith("/api")) api.push(r.url());
});
await page.setViewport({ width: W, height: H });
const t0 = Date.now();
await page.goto((process.env.BASE_URL || "http://localhost:3111") + "/dev/world-v5", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const ready = Date.now() - t0;
const err = await page.evaluate(() => window.__worldError || null);
const frames = async (n) => {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 30000 }, c0, n).catch(() => {});
};
const seed = async (d) => {
  await page.evaluate((d) => {
    const sc = window.__worldV5Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(2);
};
const depthForU = (u) =>
  page.evaluate((u) => {
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
const info = () =>
  page.evaluate(() => {
    const f = window.__worldFrame;
    return { tris: f.triangles, calls: f.calls };
  });
await frames(2);
const stats = await page.evaluate(() => {
  const s = window.__worldV5Debug.moduleStats();
  return JSON.parse(JSON.stringify(s, (k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v)));
});
const out = { readyMs: ready, worldError: err, stats, rows: [] };
const IDS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
const depths = await page.evaluate(() => window.__worldV5Debug.stopDepths());
const todo = [...IDS.map((id, i) => [id, depths[i]])];
for (const k of KEYS) todo.push([`k${k}`, await depthForU(k / (TRAIL_KEYS - 1))]);
for (const [id, d] of todo) {
  await seed(d);
  const r = await info();
  out.rows.push({ id, ...r });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${id}.png`) });
  console.log(`${id}\t${r.tris}\t${r.calls}`);
}
out.errors = errors;
out.warns = warns.slice(0, 20);
out.api = api;
out.infos = infos;
console.log(JSON.stringify({ readyMs: ready, worldError: err, install: stats.install, standIns: stats.standIns, errors, api, warnCount: warns.length }, null, 1));
fs.writeFileSync(process.env.OUTJSON || "/tmp/v5-integrate.json", JSON.stringify(out, null, 1));
await browser.close();
