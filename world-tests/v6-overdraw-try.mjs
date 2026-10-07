/**
 * Overdraw experiments (fixer "overdraw", 2026-09-28): measures the stops,
 * applies a runtime tweak file to the live scene, measures again. Nothing in
 * src changes; a tweak that wins is then written into its module by hand.
 *
 *   node world-tests/v6-overdraw-try.mjs <tweak.js> [stops e.g. 1,2,4]
 *   TIER=3   measure at a quality tier
 *   HEAT=dir write a heat map per stop after the tweak (colours as v6-overdraw.mjs)
 *   SHOT=dir screenshot each stop before and after the tweak (life clock pinned to 23 s)
 *
 * tweak.js is the body of `(scene, sc, THREE_like) => void`, run in the page:
 * scene = the live THREE.Scene, sc = __worldV6Debug.
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3111";
const tweak = process.argv[2] ? fs.readFileSync(process.argv[2], "utf8") : "";
const STOPS = (process.argv[3] || "1,2,3,4,5,6,7,8").split(",").map(Number);
const TIER = process.env.TIER ? Number(process.env.TIER) : 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"];
async function run() {
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args, protocolTimeout: 85000 });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("console", m.text()); });
  await page.setViewport({ width: 1691, height: 1278, deviceScaleFactor: 1.5 });
  await page.goto(`${BASE}/dev/world-v6`, { waitUntil: "domcontentloaded", timeout: 80000 });
  await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 80000, polling: 100 });
  await sleep(600);
  await page.evaluate((lt, st) => { window.__LT = lt; window.__ST = st; }, Number(process.env.LT || 23), Number(process.env.ST || 40));
  await page.evaluate((tier) => {
    const sc = window.__worldV6Debug;
    sc.setQualityTier(tier);
    // One life clock for every measurement and shot (LT env, default 23 s).
    window.__worldLife?.setTime?.(window.__LT ?? 23);
    sc.paused = true;
    const stopLoop = () => {
      if (sc.raf) { cancelAnimationFrame(sc.raf); sc.raf = 0; }
      if (sc.animTimer !== null && sc.animTimer !== undefined) { clearTimeout(sc.animTimer); sc.animTimer = null; }
    };
    const frame = () => { sc.paused = false; sc.dirty = true; sc.tick(performance.now()); sc.paused = true; stopLoop(); };
    window.__ot = {
      heat(r) {
        const colour = (k) => (k === 0 ? [0, 0, 0] : k === 1 ? [30, 60, 200] : k === 2 ? [30, 170, 60] : k === 3 ? [230, 220, 40] : k === 4 ? [245, 140, 30] : k === 5 ? [220, 30, 30] : k < 10 ? [220, 40, 220] : [255, 255, 255]);
        const w = r.width, h = r.height, hw = w >> 1, hh = h >> 1;
        const cv = document.createElement("canvas");
        cv.width = hw; cv.height = hh;
        const ctx = cv.getContext("2d");
        const img = ctx.createImageData(hw, hh);
        for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
          const c = colour(r.counts[(h - 1 - y * 2) * w + x * 2]);
          const o = (y * hw + x) * 4;
          img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        return cv.toDataURL("image/png");
      },
      at(stop, heat) {
        const d = sc.stopDepths()[stop - 1];
        window.scrollTo(0, sc.scrollYForDepth(d));
        sc.seedDepth(d);
        stopLoop();
        // One scene clock too (the water's sway runs on it): ST env, default 40 s.
        sc.sceneTime = window.__ST ?? 40;
        frame();
        frame();
        if (window.__otTweaked && !sc.debugScene()?.userData.__otMark) throw new Error("STALE: the page rebuilt its scene");
        const r = sc.measureOverdraw({ keepCounts: !!heat });
        if (!r) throw new Error("STALE: scene not ready");
        let s6 = 0;
        for (let k = 6; k < r.histogram.length; k++) s6 += r.histogram[k];
        return { avg: r.avg, p99: r.p99, max: r.max, s6: +((100 * s6) / (r.width * r.height)).toFixed(2), png: heat ? this.heat(r) : null };
      },
    };
  }, TIER);
  const before = {};
  const shoot = async (s, tag) => {
    if (!process.env.SHOT) return;
    fs.mkdirSync(process.env.SHOT, { recursive: true });
    await page.evaluate((s) => window.__ot.at(s), s);
    await sleep(150);
    await page.screenshot({ path: `${process.env.SHOT}/${tag}-a${s}.png` });
  };
  for (const s of STOPS) { before[s] = await page.evaluate((s) => window.__ot.at(s), s); await shoot(s, "before"); }
  if (tweak) await page.evaluate(`(function(){ const sc = window.__worldV6Debug; const scene = sc.debugScene(); ${tweak}\n; scene.userData.__otMark = true; window.__otTweaked = true; })()`);
  for (const s of STOPS) {
    const a = await page.evaluate((s, h) => window.__ot.at(s, h), s, !!process.env.HEAT);
    if (a.png) { fs.mkdirSync(process.env.HEAT, { recursive: true }); fs.writeFileSync(`${process.env.HEAT}/a${s}.png`, Buffer.from(a.png.split(",")[1], "base64")); }
    await shoot(s, "after");
    const b = before[s];
    console.log(`a${s}  avg ${b.avg.toFixed(3)} -> ${a.avg.toFixed(3)}   p99 ${b.p99} -> ${a.p99}   6+ ${b.s6}% -> ${a.s6}%   max ${b.max} -> ${a.max}`);
  }
  await browser.close();
}
for (let tries = 0; ; tries++) {
  try { await run(); break; } catch (e) {
    if (tries < 3 && /STALE|histogram|reading 'at'|Target closed|detached|Execution context|timeout/i.test(String(e))) { console.log(`retry ${tries + 1}: ${String(e).split("\n")[0]}`); continue; }
    throw e;
  }
}
