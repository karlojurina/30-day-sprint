/**
 * v6 overdraw at the stops (world_art_bible_v6.md 3.1: average 1.8 layers,
 * 99th percentile 5), on the real GPU, through perf.measureOverdraw.
 *
 *   node world-tests/v6-overdraw.mjs [w h dpr]         the 8 stops
 *   KEYS=stop1,k12 node world-tests/v6-overdraw.mjs    a subset (ids as v6-perf.mjs: stopN, k<key>)
 *   MODE=raster node world-tests/v6-overdraw.mjs       every fragment rasterised (cutouts included), see perf.ts
 *   STRIP=1 node world-tests/v6-overdraw.mjs           the stops plus every strip frame of v6-strip.mjs
 *
 * Uses __worldV6Debug.measureOverdraw (A2-handoff.md paste 9). Until A1 wires
 * it, the script loads src/lib/world-v6/perf.ts itself into the page
 * (transpiled with typescript, with its own copy of three, served through
 * request interception) and calls it on the page's renderer, scene and camera;
 * the output says which one ran.
 *
 * Writes shots/v6/overdraw/overdraw-<w>x<h>@<dpr>.json and .txt, and a heat map
 * per frame (<id>.png: black 0, blue 1, green 2, yellow 3, orange 4, red 5,
 * magenta 6 to 9, white 10 or more), half size.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = process.env.OVERDRAW_OUT ? path.resolve(process.env.OVERDRAW_OUT) : path.join(HERE, "shots/v6/overdraw");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:3111";
const W = Number(process.argv[2] || 1691), H = Number(process.argv[3] || 1278), DPR = Number(process.argv[4] || 1.5);
const MODE = process.env.MODE === "raster" ? "raster" : "visible";
const tag = `overdraw-${MODE}-${W}x${H}@${DPR}`;
const TARGET = { avg: 1.8, p99: 5 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// perf.ts for the page, in case the scene hook is not there yet.
const require = createRequire(path.join(ROOT, "package.json"));
function injectedModules() {
  const ts = require("typescript");
  const js = (file) =>
    ts.transpileModule(fs.readFileSync(path.join(ROOT, "src/lib/world-v6", file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, verbatimModuleSyntax: false },
    }).outputText
      .replace(/from "three"/g, `from "${BASE}/__a2/three.module.js"`)
      .replace(/from "\.\/quality"/g, `from "${BASE}/__a2/quality.js"`);
  return {
    "/__a2/perf.js": js("perf.ts"),
    "/__a2/quality.js": js("quality.ts"),
    "/__a2/three.module.js": fs.readFileSync(path.join(ROOT, "node_modules/three/build/three.module.js"), "utf8"),
  };
}

const args = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"];
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args, protocolTimeout: 85000 });
const page = await browser.newPage();
const errors = [];
const api = [];
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const served = injectedModules();
await page.setRequestInterception(true);
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith("/api")) api.push(r.url());
  if (served[u.pathname]) return r.respond({ status: 200, contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: served[u.pathname] });
  r.continue();
});
await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
// PERF_TUNE=p0|mid|all (final pass B): the progress fixture before load, as v6-perf.mjs,
// so the lesson lanterns and their halos count (all = every halo drawn).
const PERF_TUNES = {
  p0: { lock: "open", frontier: 0, finished: 0, partial: 0 },
  mid: { lock: "open", frontier: 3, finished: 3, partial: 18 },
  all: { lock: "open", frontier: 7, finished: 8, partial: 0 },
};
if (process.env.PERF_TUNE && PERF_TUNES[process.env.PERF_TUNE]) {
  await page.evaluateOnNewDocument((t) => {
    try {
      localStorage.setItem("world-v6:tuning:trail", JSON.stringify(t)); // the current TUNE key (tuning.ts KEY)
    } catch {
      /* ignore */
    }
  }, PERF_TUNES[process.env.PERF_TUNE]);
}
await page.goto(`${BASE}/dev/world-v6`, { waitUntil: "domcontentloaded", timeout: 80000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 80000, polling: 100 });
await sleep(600);

const source = await page.evaluate(async (base) => {
  const sc = window.__worldV6Debug;
  if (typeof sc.setQualityTier === "function") sc.setQualityTier(0);
  sc.paused = true;
  const stopLoop = () => {
    if (sc.raf) { cancelAnimationFrame(sc.raf); sc.raf = 0; }
    if (sc.animTimer !== null && sc.animTimer !== undefined) { clearTimeout(sc.animTimer); sc.animTimer = null; }
  };
  const frame = () => { sc.paused = false; sc.dirty = true; sc.tick(performance.now()); sc.paused = true; stopLoop(); };
  let measure;
  let src;
  if (typeof sc.measureOverdraw === "function") {
    measure = (opts) => sc.measureOverdraw(opts);
    src = "scene hook (__worldV6Debug.measureOverdraw)";
  } else {
    const m = await import(`${base}/__a2/perf.js`);
    measure = (opts) => m.measureOverdraw(sc.renderer, sc.debugScene(), sc.camera, opts);
    src = "injected perf.ts (scene hook not wired yet)";
  }
  const colour = (k) => (k === 0 ? [0, 0, 0] : k === 1 ? [30, 60, 200] : k === 2 ? [30, 170, 60] : k === 3 ? [230, 220, 40] : k === 4 ? [245, 140, 30] : k === 5 ? [220, 30, 30] : k < 10 ? [220, 40, 220] : [255, 255, 255]);
  window.__od = {
    keyCount: () => sc.ctx?.layout?.TRAIL?.length ?? null,
    depthForKey(k, n) {
      const u = k / (n - 1);
      const rr = sc.debugRail();
      let lo = 0, hi = rr.length;
      for (let i = 0; i < 60; i++) { const mm = (lo + hi) / 2; if (rr.tAtS(mm) < u) lo = mm; else hi = mm; }
      return rr.depthOfS((lo + hi) / 2);
    },
    at(d, mode) {
      window.scrollTo(0, sc.scrollYForDepth(d));
      sc.seedDepth(d);
      stopLoop();
      frame();
      frame();
      const r = measure({ mode, keepCounts: true });
      if (!r) return null;
      // Heat map at half size, top row first.
      const w = r.width, h = r.height, hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
      const cv = document.createElement("canvas");
      cv.width = hw; cv.height = hh;
      const ctx = cv.getContext("2d");
      const img = ctx.createImageData(hw, hh);
      for (let y = 0; y < hh; y++) {
        const sy = h - 1 - Math.min(h - 1, y * 2);
        for (let x = 0; x < hw; x++) {
          const k = r.counts[sy * w + Math.min(w - 1, x * 2)];
          const c = colour(k);
          const o = (y * hw + x) * 4;
          img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const { counts, ...rest } = r;
      void counts;
      return { ...rest, png: cv.toDataURL("image/png") };
    },
  };
  return src;
}, BASE);

const stopDepths = await page.evaluate(() => window.__worldV6Debug.stopDepths());
const NAMES = ["a1 Introduction", "a2 Fundamentals", "a3 Video Ads I", "a4 Video Ads II", "a5 Static Ads", "a6 AI Ads & Content", "a7 Creative Strategy", "a8 Job Board"];
const positions = stopDepths.map((d, i) => ({ id: "stop" + (i + 1), label: NAMES[i] ?? `stop ${i + 1}`, depth: d }));
if (process.env.STRIP || process.env.KEYS) {
  const nKeys = await page.evaluate(() => window.__od.keyCount());
  const src = fs.readFileSync(path.join(HERE, "v6-strip.mjs"), "utf8");
  const m = src.match(/const STRIP_FRAMES\s*=\s*\[([\s\S]*?)\n\];/);
  const rows = m ? [...m[1].matchAll(/\[\s*(-?[\d.]+)\s*,\s*"([^"]*)"/g)].map((x) => [Number(x[1]), x[2]]) : [];
  if (nKeys) for (const [k, label] of rows) positions.push({ id: "k" + k, label, depth: await page.evaluate((k, n) => window.__od.depthForKey(k, n), k, nKeys) });
}
const want = process.env.KEYS ? process.env.KEYS.split(",") : null;
const chosen = want ? positions.filter((p) => want.includes(p.id)) : process.env.STRIP ? positions : positions.filter((p) => p.id.startsWith("stop"));

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const result = { tag, mode: MODE, W, H, DPR, source, target: TARGET, when: new Date().toISOString(), rows: [] };
say(`v6-overdraw ${MODE} ${W}x${H}@${DPR} via ${source}; target average ${TARGET.avg}, 99th percentile ${TARGET.p99}`);
for (const p of chosen) {
  const r = await page.evaluate((d, mode) => window.__od.at(d, mode), p.depth, MODE);
  if (!r) { say(`${p.id} ${p.label}: no result (scene not ready)`); continue; }
  const file = path.join(OUT, `${MODE}-${p.id}.png`);
  fs.writeFileSync(file, Buffer.from(r.png.split(",")[1], "base64"));
  const avgOk = r.avg <= TARGET.avg, p99Ok = r.p99 <= TARGET.p99;
  const verdict = p99Ok ? (avgOk ? "PASS" : "OVER TARGET (average)") : "FAIL (99th percentile)";
  const { png, ...row } = r;
  void png;
  result.rows.push({ ...p, ...row, verdict, heatmap: file });
  const share = (k) => ((100 * (r.histogram[k] ?? 0)) / (r.width * r.height)).toFixed(1);
  say(`${p.id.padEnd(7)} ${p.label.slice(0, 28).padEnd(28)} avg ${r.avg.toFixed(2)} p99 ${r.p99} max ${r.max}  0:${share(0)}% 1:${share(1)}% 2:${share(2)}% 3:${share(3)}% 4:${share(4)}% 5+:${(100 - [0, 1, 2, 3, 4].reduce((a, k) => a + Number(share(k)), 0)).toFixed(1)}%  ${verdict}  (${r.width}x${r.height}, ${r.ms} ms)`);
  fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(result, null, 1));
}
result.errors = errors;
result.apiCalls = api;
fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(OUT, `${tag}.txt`), lines.join("\n") + "\n");
say(`done: ${errors.length} console errors, ${api.length} /api calls -> ${OUT}`);
await browser.close();
