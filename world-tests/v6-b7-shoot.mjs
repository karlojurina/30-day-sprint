/**
 * B7 (the gorge) renders: fractional keys on the rail and parks, at
 * 1691x1278 on the real GPU, UI hidden, one page load, plus a contact sheet.
 *
 *   node world-tests/v6-b7-shoot.mjs <tag> [keys...] [park:a4]
 *   default keys: the gorge's strip frames (the lip to the burst).
 *
 * Writes world-tests/shots/v6/B7-gorge/<tag>/k<key>.png and sheet.png, and
 * prints camera, triangles and calls per frame.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const TAG = argv[0] || "run";
const OUT = path.join(HERE, "shots/v6/B7-gorge", TAG);
fs.mkdirSync(OUT, { recursive: true });
const DEFAULT = ["13", "15", "17", "18.7", "23", "25.4", "28", "32.4", "33", "34", "35", "36", "37", "37.8", "39", "park:a4", "41", "42.5", "43.6", "44.5", "45"];
const items = argv.length > 1 ? argv.slice(1) : DEFAULT;
const W = Number(process.env.W || 1691);
const H = Number(process.env.H || 1278);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.setViewport({ width: W, height: H });
await page.goto("http://localhost:3111/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) throw new Error("world error: " + err);
if (!process.env.UI) await page.addStyleTag({ content: "body * { visibility: hidden !important; } canvas { visibility: visible !important; }" });

async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 20000 }, c0, n);
  } catch {
    /* the loop sleeps when nothing moves */
  }
}
async function depthForKey(k) {
  return page.evaluate((k) => {
    const r = window.__worldV6Debug.debugRail();
    const u = k / (r.keys ? r.keys - 1 : 85);
    let lo = 0;
    let hi = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (r.tAtS(m) < u) lo = m;
      else hi = m;
    }
    return r.depthOfS((lo + hi) / 2);
  }, k);
}
async function seed(d) {
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    sc.park(null);
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
}
async function info() {
  try {
    return await infoRaw();
  } catch {
    return { cam: ["?"], pitch: 0, tris: 0, calls: 0 };
  }
}
async function infoRaw() {
  return page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    return { cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: +c.pitch.toFixed(1), tris: f.triangles, calls: f.calls };
  });
}
const shots = [];
for (const it of items) {
  let name;
  if (it.startsWith("park:")) {
    const id = it.slice(5);
    const d = await page.evaluate((id) => window.__worldV6Debug.stopDepths()[["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"].indexOf(id)], id);
    await seed(d);
    await page.evaluate((id) => window.__worldV6Debug.park(id), id);
    await sleep(3200);
    await frames(3);
    name = `park-${id}`;
  } else {
    const k = Number(it);
    await seed(await depthForKey(k));
    await sleep(250);
    await frames(2);
    name = `k${it}`;
  }
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  const inf = await info();
  console.log(name, JSON.stringify(inf));
  shots.push({ file, caption: `${name} · cam ${inf.cam.join(",")} · pitch ${inf.pitch} · ${Math.round(inf.tris / 1000)}k / ${inf.calls}` });
}
await page.evaluate(() => window.__worldV6Debug.park(null));
try {
  const ms = await page.evaluate(() => {
    const all = window.__worldV6Debug.moduleStats();
    const pick = {};
    for (const [k, v] of Object.entries(all)) if (/gorge/i.test(k)) pick[k] = v;
    return pick;
  });
  console.log("moduleStats", JSON.stringify(ms));
} catch (e) {
  console.log("moduleStats n/a", String(e).slice(0, 120));
}

// Contact sheet.
const cols = 3;
const cellW = 560;
const cellH = Math.round((cellW * H) / W);
const html = `<html><body style="margin:0;background:#15171a;font:12px/1.3 -apple-system,Helvetica,sans-serif;color:#e8e4dc">
<div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:6px;padding:6px">
${shots.map((s) => `<div><img src="data:image/png;base64,${fs.readFileSync(s.file).toString("base64")}" style="width:${cellW}px;height:${cellH}px;display:block"><div style="padding:3px 2px">${s.caption}</div></div>`).join("")}
</div></body></html>`;
const p2 = await browser.newPage();
await p2.setViewport({ width: cols * (cellW + 6) + 6, height: Math.ceil(shots.length / cols) * (cellH + 26) + 12 });
await p2.setContent(html, { waitUntil: "load" });
await p2.screenshot({ path: path.join(OUT, "sheet.png"), fullPage: true });
await p2.close();
if (errors.length) console.log("ERRORS", errors.slice(0, 8));
await browser.close();
console.log("done", OUT);
