/**
 * Life proof (src/lib/world-v5/life.ts): stops at 960x600 with the life clock
 * pinned 1 s apart, so each triple shows what moves.
 *
 *   node world-tests/v5-life.mjs [a1 a5 a6 ...] [--t0 12] [--n 3] [--star]
 *   node world-tests/v5-life.mjs --reduced     prefers-reduced-motion: life holds FROZEN_T, never animates
 *
 * SwiftShader draws ~0.6 s a frame and the scene clamps dt to 0.05 s, so real
 * waiting would crawl; __worldLife.setTime pins the clock instead. --star
 * fires a shooting star before the frames (a7). Writes PNGs, per-frame JSON
 * (life stats, where each group projects, triangles and calls) and a sheet to
 * world-tests/shots/v5-pass2/life/ (LIFE_OUT overrides).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.LIFE_OUT ? path.resolve(process.env.LIFE_OUT) : path.join(HERE, "shots/v5-pass2/life");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const argv = process.argv.slice(2);
const flag = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const IDS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
const want = argv.filter((a) => IDS.includes(a));
const stops = want.length ? want : ["a1", "a5", "a6"];
const T0 = Number(flag("--t0", "12"));
const N = Number(flag("--n", "3"));
const STAR = argv.includes("--star");
const REDUCED = argv.includes("--reduced");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || /life/i.test(m.text())) errors.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.setViewport({ width: 960, height: 600 });
if (REDUCED) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await page.goto(BASE + "/dev/world-v5", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) throw new Error("world error: " + err);

async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  await page.evaluate(() => window.__worldV5Debug.setPaused?.(false));
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 30000 }, c0, n);
  } catch {
    /* the loop sleeps once nothing moves */
  }
}

async function ready() {
  await page.waitForFunction(() => window.__worldReady && typeof window.__worldLife === "function", { timeout: 180000, polling: 300 });
}
const hasLife = await page
  .waitForFunction(() => typeof window.__worldLife === "function", { timeout: 60000, polling: 300 })
  .then(() => true)
  .catch(() => false);
if (!hasLife) {
  console.log("no window.__worldLife: is life.ts installed?", errors.slice(0, 5));
  await browser.close();
  process.exit(1);
}
await ready();
const report = { stops: {}, install: await page.evaluate(() => window.__worldLife()), errors };
console.log("life at install:", JSON.stringify({ tris: report.install.triangles, plumes: report.install.plumes, buildMs: report.install.buildMs }));

if (REDUCED) {
  const rows = [];
  for (const id of ["a1", "a6"]) {
    await ready();
    const d = await page.evaluate((i) => window.__worldV5Debug.stopDepths()[i], IDS.indexOf(id));
    await page.evaluate((d) => {
      const sc = window.__worldV5Debug;
      window.scrollTo(0, sc.scrollYForDepth(d));
      sc.seedDepth(d);
    }, d);
    await frames(4);
    const a = await page.evaluate(() => window.__worldLife());
    await frames(4);
    const b = await page.evaluate(() => window.__worldLife());
    rows.push({ id, time: [a.time, b.time], animating: [a.animating, b.animating], birdsDrawn: b.birdsDrawn, soft: b.softOnScreen, glow: b.glowOnScreen });
  }
  const pass = rows.every((r) => r.time[0] === 23 && r.time[1] === 23 && r.animating[0] === 0 && r.animating[1] === 0);
  console.log(`${pass ? "PASS" : "FAIL"}  reduced motion: life pinned at 23 s and not animating`, JSON.stringify(rows));
  await browser.close();
  process.exit(pass ? 0 : 1);
}
const items = [];
/** Seeds the stop and pins the clock; a hot reload (other builders' saves) mid-shot retries it. */
async function atStop(i) {
  await ready();
  const d = await page.evaluate((i) => window.__worldV5Debug.stopDepths()[i], i);
  await page.evaluate((d) => {
    const sc = window.__worldV5Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
}
for (const id of stops) {
  const i = IDS.indexOf(id);
  report.stops[id] = [];
  for (let k = 0; k < N; k++) {
    const t = T0 + k * (STAR ? 0.35 : 1);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await atStop(i);
        if (STAR) {
          await page.evaluate((t) => window.__worldLife.setTime(t), T0);
          const ok = await page.evaluate(() => window.__worldLife.shootNow());
          if (k === 0) console.log(`  ${id} shootNow -> ${ok}`);
        }
        await page.evaluate((t) => window.__worldLife.setTime(t), t);
        await frames(2);
        const file = path.join(OUT, `life-${id}-t${String(t).replace(".", "_")}.png`);
        await page.screenshot({ path: file });
        const info = await page.evaluate(() => ({ life: window.__worldLife(), triangles: window.__worldFrame.triangles, calls: window.__worldFrame.calls }));
        report.stops[id].push({ t, file: path.basename(file), ...info });
        items.push({ file, caption: `<b>${id}</b> t=${t}s · ${Math.round(info.triangles / 1000)}k tris / ${info.calls} calls · life ${info.life.trianglesNow} tris / ${info.life.drawCallsNow} calls` });
        console.log(`  ${id} t=${t} ${info.triangles}/${info.calls} life ${info.life.trianglesNow}/${info.life.drawCallsNow} flocks=${info.life.flocksOnScreen} soft=${info.life.softOnScreen} glow=${info.life.glowOnScreen} ships=${info.life.airshipsDrawn}`);
        break;
      } catch (e) {
        console.log(`  ${id} t=${t} attempt ${attempt} failed (${String(e.message).slice(0, 80)}), retrying`);
        await sleep(3000);
      }
    }
  }
  try {
    await page.evaluate(() => window.__worldLife.setTime(null));
  } catch {}
}
fs.writeFileSync(path.join(OUT, `report-${stops.join("-")}.json`), JSON.stringify(report, null, 1));

// Contact sheet: one row per stop.
const cellW = 480;
const cellH = 300;
const html = `<html><body style="margin:0;background:#15171a;font:12px/1.3 -apple-system,Helvetica,sans-serif;color:#e8e4dc">
<div style="display:grid;grid-template-columns:repeat(${N},${cellW}px);gap:6px;padding:6px">
${items.map((it) => `<div><img src="data:image/png;base64,${fs.readFileSync(it.file).toString("base64")}" style="width:${cellW}px;height:${cellH}px;display:block"><div style="padding:3px 2px 2px">${it.caption}</div></div>`).join("")}
</div></body></html>`;
const p2 = await browser.newPage();
await p2.setViewport({ width: N * (cellW + 6) + 6, height: Math.ceil(items.length / N) * (cellH + 40) + 12 });
await p2.setContent(html, { waitUntil: "load" });
const sheetFile = path.join(OUT, `sheet-life-${stops.join("-")}${STAR ? "-star" : ""}.png`);
await p2.screenshot({ path: sheetFile, fullPage: true });
console.log("sheet", sheetFile);
if (errors.length) console.log("console:", errors.slice(0, 8).join("\n  "));
await browser.close();
