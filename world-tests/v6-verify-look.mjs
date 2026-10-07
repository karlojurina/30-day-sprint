/**
 * Cheap-laptop verify (2026-09-28): the look after the hardening fixes.
 * Renders the opening and the 8 stops at 1691x1278 the way v6-c1-stops.mjs
 * made world-tests/shots/v6/final/ (page screenshot, live clocks, 1.8 s after
 * __worldReady), at a forced tier, so they can be diffed against final-*.png.
 *
 *   node world-tests/v6-verify-look.mjs [--tier=0] [--ids=k0,a1,...] [--out=dir] [--tag=t0]
 *
 * Writes <out>/<tag>-<id>.png and <out>/<tag>-report.json (tier, pixel ratio,
 * programs, errors, /api calls). Diffing is done by the caller.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const OUT = opt.out ? path.resolve(String(opt.out)) : path.join(HERE, "shots/v6/cheap/verify/look");
fs.mkdirSync(OUT, { recursive: true });
const TIER = Number(opt.tier ?? 0);
const TAG = String(opt.tag ?? `t${TIER}`);
const IDS = String(opt.ids ?? "k0,a1,a2,a3,a4,a5,a6,a7,a8").split(",");
const W = 1691, H = 1278;
const BASE = process.env.BASE_URL || "http://localhost:3111";
const STOP = { k0: -1, a1: 0, a2: 1, a3: 2, a4: 3, a5: 4, a6: 5, a7: 6, a8: 7 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 120000,
});
const report = { tier: TIER, frames: [], errors: [], api: [] };
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") report.errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => report.errors.push("pageerror " + e.message));
  page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/api")) report.api.push(r.url()); });
  await page.setViewport({ width: W, height: H });
  const t0 = Date.now();
  await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 85000 });
  for (;;) {
    const s = await page.evaluate(() => (window.__worldReady ? "ok" : window.__worldError ? "err " + window.__worldError : null)).catch(() => null);
    if (s === "ok") break;
    if (s) throw new Error(s);
    if (Date.now() - t0 > 85000) throw new Error("not ready in 85 s");
    await sleep(250);
  }
  await sleep(1800);
  report.ready = (Date.now() - t0) / 1000;
  await page.evaluate((t) => window.__worldV6Debug.setQualityTier(t), TIER);
  await sleep(400);
  for (const id of IDS) {
    const si = STOP[id];
    const d = si < 0 ? 0 : await page.evaluate((i) => window.__worldV6Debug.stopDepths()[i], si);
    await page.evaluate((d) => { const sc = window.__worldV6Debug; window.scrollTo(0, sc.scrollYForDepth(d)); sc.seedDepth(d); }, d);
    await page.evaluate(async () => {
      const c0 = window.__worldFrameCount ?? 0;
      const t = performance.now();
      while ((window.__worldFrameCount ?? 0) < c0 + 4 && performance.now() - t < 15000) await new Promise((r) => setTimeout(r, 50));
    });
    await page.screenshot({ path: path.join(OUT, `${TAG}-${id}.png`) });
    const q = await page.evaluate(() => {
      const sc = window.__worldV6Debug;
      const qi = sc.qualityInfo();
      return { tier: qi.quality?.tier, pr: sc.renderer.getPixelRatio(), programs: sc.renderer.info.programs.length, poster: sc.posterState ? sc.posterState() : null };
    });
    report.frames.push({ id, depth: d, ...q });
    console.log(id, JSON.stringify(q));
  }
} finally {
  fs.writeFileSync(path.join(OUT, `${TAG}-report.json`), JSON.stringify(report, null, 1));
  await browser.close();
}
