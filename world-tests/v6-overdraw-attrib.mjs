/**
 * Overdraw attribution (fixer "overdraw", cheap laptops 2026-09-28): at each
 * stop, hides one visible renderable at a time and measures how many layers
 * and how many 5+/6+ pixels it was responsible for (perf.measureOverdraw,
 * visible mode, half scale for speed). Prints the top contributors.
 *
 *   node world-tests/v6-overdraw-attrib.mjs [stop numbers, e.g. 1,2,4] [w h dpr]
 *   TIER=3 ...   measure at a quality tier
 *   TOP=12 ...   rows per stop
 *   TWEAK=file.js  a runtime tweak applied first (see v6-overdraw-try.mjs)
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3111";
const STOPS = (process.argv[2] || "1,2,3,4,5,6,7,8").split(",").map(Number);
const W = Number(process.argv[3] || 1691), H = Number(process.argv[4] || 1278), DPR = Number(process.argv[5] || 1.5);
const TOP = Number(process.env.TOP || 12);
const TIER = process.env.TIER ? Number(process.env.TIER) : 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"];
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args, protocolTimeout: 85000 });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
await page.goto(`${BASE}/dev/world-v6`, { waitUntil: "domcontentloaded", timeout: 80000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 80000, polling: 100 });
await sleep(600);
await page.evaluate((tier) => {
  const sc = window.__worldV6Debug;
  sc.setQualityTier(tier);
  sc.paused = true;
  const stopLoop = () => {
    if (sc.raf) { cancelAnimationFrame(sc.raf); sc.raf = 0; }
    if (sc.animTimer !== null && sc.animTimer !== undefined) { clearTimeout(sc.animTimer); sc.animTimer = null; }
  };
  const frame = () => { sc.paused = false; sc.dirty = true; sc.tick(performance.now()); sc.paused = true; stopLoop(); };
  const stat = (r) => {
    let s5 = 0, s6 = 0;
    for (let k = 5; k < r.histogram.length; k++) s5 += r.histogram[k];
    for (let k = 6; k < r.histogram.length; k++) s6 += r.histogram[k];
    const n = r.width * r.height;
    return { avg: r.avg, p99: r.p99, max: r.max, s5: (100 * s5) / n, s6: (100 * s6) / n };
  };
  const pathOf = (o) => {
    const parts = [];
    let p = o;
    while (p && p.parent && parts.length < 4) { if (p.name) parts.unshift(p.name); p = p.parent; }
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    return (parts.join("/") || o.type) + (m?.name ? ` [${m.name}]` : "") + (m?.transparent ? " T" : "") + (m?.blending === 2 ? " ADD" : "") + (m?.alphaTest ? " AT" : "");
  };
  window.__oa = {
    at(stop) {
      const d = sc.stopDepths()[stop - 1];
      window.scrollTo(0, sc.scrollYForDepth(d));
      sc.seedDepth(d);
      stopLoop();
      frame();
      frame();
      const scene = sc.debugScene();
      const base = stat(sc.measureOverdraw({ scale: 0.5 }));
      const cand = [];
      scene.traverseVisible((o) => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) cand.push(o); });
      const rows = [];
      for (const o of cand) {
        o.visible = false;
        const r = stat(sc.measureOverdraw({ scale: 0.5 }));
        o.visible = true;
        const dAvg = base.avg - r.avg;
        if (dAvg > 0.004 || base.s6 - r.s6 > 0.05 || base.s5 - r.s5 > 0.05) rows.push({ name: pathOf(o), dAvg: +dAvg.toFixed(3), d5: +(base.s5 - r.s5).toFixed(2), d6: +(base.s6 - r.s6).toFixed(2), p99: r.p99 });
      }
      return { base, n: cand.length, rows };
    },
  };
}, TIER);
if (process.env.TWEAK) await page.evaluate(`(function(){ const sc = window.__worldV6Debug; const scene = sc.debugScene(); ${fs.readFileSync(process.env.TWEAK, "utf8")}\n})()`);
for (const s of STOPS) {
  const r = await page.evaluate((s) => window.__oa.at(s), s);
  console.log(`\nstop ${s} (tier ${TIER}): avg ${r.base.avg} p99 ${r.base.p99} max ${r.base.max} 5+ ${r.base.s5.toFixed(2)}% 6+ ${r.base.s6.toFixed(2)}%  (${r.n} renderables)`);
  const bySum = [...r.rows].sort((a, b) => b.dAvg - a.dAvg).slice(0, TOP);
  console.log("  by layers removed:");
  for (const x of bySum) console.log(`    -${x.dAvg.toFixed(3)} avg  -${x.d5}% 5+  -${x.d6}% 6+  p99->${x.p99}  ${x.name}`);
  const by6 = [...r.rows].sort((a, b) => b.d6 + b.d5 * 0.5 - (a.d6 + a.d5 * 0.5)).slice(0, TOP);
  console.log("  by 5+/6+ pixels removed:");
  for (const x of by6) console.log(`    -${x.d6}% 6+  -${x.d5}% 5+  -${x.dAvg.toFixed(3)} avg  p99->${x.p99}  ${x.name}`);
}
await browser.close();
