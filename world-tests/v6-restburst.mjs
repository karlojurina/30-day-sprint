/**
 * Adapt3 (2026-09-28): how long a measurement at rest holds the page on a slow
 * GPU. Per factor, a fresh context with the 3D forced (?poster=off), tier 3 at
 * its lowest pixel ratio (the governor's last step, where it asks for the
 * posters), then at rest, 2 s apart:
 *   - the adapt2 confirm: burstProbe with maxMs 300 (what governorPoster ran);
 *   - the adapt3 confirm: quickProbe with 120 ms (POSTER_RULES.restBurstMs);
 *   - the adapt3 rest check: WorldScene.restCheckProbe (120 ms, stops after an 18 ms warm frame).
 * Each call's wall time (took), its answer (ms) and the time it ran are logged.
 *
 *   node world-tests/v6-restburst.mjs [--factors=10,20,30] [--repeats=3] [--out=dir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const OUT = path.resolve(arg("out", path.join(HERE, "shots/v6/cheap/adapt3/restburst")));
fs.mkdirSync(OUT, { recursive: true });
const FACTORS = arg("factors", "10,20,30").split(",").map(Number);
const REPEATS = Number(arg("repeats", "3"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms))]);

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 60000,
});
const report = { runs: [] };
let failed = false;
try {
  for (const f of FACTORS) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const run = { factor: f, calls: [] };
    try {
      await page.goto(`http://localhost:3111/dev/world-v6?slowgpu=${f}&poster=off`, { waitUntil: "domcontentloaded", timeout: 60000 });
      const t0 = Date.now();
      while (!(await page.evaluate(() => !!window.__worldReady).catch(() => false))) {
        if (Date.now() - t0 > 60000) throw new Error("not ready");
        await sleep(200);
      }
      await page.evaluate(() => window.__worldV6Debug.setQualityTier(3));
      await sleep(2500);
      run.pixelRatio = await page.evaluate(() => window.__worldV6Debug.qualityInfo().pixelRatio);
      for (let i = 0; i < REPEATS; i++) {
        for (const kind of ["adapt2 confirm (burst, 300)", "adapt3 confirm (quick, 120)", "adapt3 rest check (burst, 120)"]) {
          const r = await withTimeout(
            page.evaluate((k) => {
              const s = window.__worldV6Debug;
              const at = Math.round(performance.now());
              const b = k.startsWith("adapt2") ? s.burstProbe(8, 5, 250, 300) : k.includes("quick") ? s.quickProbe(120) : s.restCheckProbe();
              return { at, took: b?.took ?? null, ms: b?.ms ?? null, cold: b?.cold ?? null };
            }, kind),
            20000,
            kind,
          );
          run.calls.push({ kind, ...r });
          await sleep(2000);
        }
      }
    } catch (e) {
      run.error = String(e);
      failed = true;
    }
    const by = (k) => run.calls.filter((c) => c.kind === k);
    const worst = (k) => Math.max(...by(k).map((c) => c.took));
    const restOver = by("adapt3 rest check (burst, 120)").some((c) => c.took > 135);
    run.worst = Object.fromEntries(["adapt2 confirm (burst, 300)", "adapt3 confirm (quick, 120)", "adapt3 rest check (burst, 120)"].map((k) => [k, by(k).length ? worst(k) : null]));
    console.log(`x${f} (tier 3 @ ${run.pixelRatio}): ` + run.calls.map((c) => `[${c.kind} at ${c.at}: took ${c.took} ms, ${c.ms} ms/frame]`).join(" "));
    console.log(`x${f} worst took: ${JSON.stringify(run.worst)}`);
    if ((run.worst["adapt3 confirm (quick, 120)"] ?? 999) > 130 || restOver) failed = true;
    report.runs.push(run);
    fs.writeFileSync(path.join(OUT, "restburst.json"), JSON.stringify(report, null, 1));
    await ctx.close().catch(() => {});
  }
} finally {
  await browser.close().catch(() => {});
}
console.log("RESTBURST DONE", failed ? "with failures" : "ok");
process.exit(failed ? 1 : 0);
