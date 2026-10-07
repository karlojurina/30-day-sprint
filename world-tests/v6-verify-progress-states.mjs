/**
 * Integration check (2026-09-28): the three progress states as a student
 * sees them, driven through the page's own fixture (window.__worldTune), so
 * the world and the interface get the same progress by the real hand-off.
 *
 *   node world-tests/v6-verify-progress-states.mjs [--vp 1691x1278] [--tier N] [--poster] [--tag T] <item> ...
 *
 * Items:
 *   <state>:stops        every stop resting (stopDepths), card or chip as it comes
 *   <state>:stop:aN      one stop
 *   <state>:park:aN      place N clicked in (window.__worldPark): the panel
 *   <state>:parks        every place clicked in
 * States: p0 (the cutover: nothing watched), mid (58/145, 18 of 22 into
 * Video Ads II), all (every lesson watched), atN (the student at place N+1:
 * N places done, 60% of its lessons watched).
 *
 * Prints one JSON line per shot: the card / chip / panel / done boxes and
 * their share of the frame, how much of the landmark each covers (the page's
 * own measure, data-overlap), and the frame's triangles and calls.
 * PNGs: world-tests/shots/v6/progress/verify/<tag>/<state>/<shot>.png, and
 * <tag>/results.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
let vp = [1691, 1278];
let tier = null;
let poster = false;
let tag = "states";
const items = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--vp") vp = argv[++i].split("x").map(Number);
  else if (argv[i] === "--tier") tier = Number(argv[++i]);
  else if (argv[i] === "--poster") poster = true;
  else if (argv[i] === "--tag") tag = argv[++i];
  else items.push(argv[i]);
}
const OUT = path.join(HERE, "shots", "v6", "progress", "verify", tag);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATES = {
  p0: { lock: "open", frontier: 0, finished: 0, partial: 0 },
  mid: { lock: "open", frontier: 3, finished: 3, partial: 18 },
  all: { lock: "open", frontier: 7, finished: 8, partial: 0 },
};
const IDS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 85000,
});
const errors = [];
const api = [];
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push("pageerror " + e.message + " :: " + (e.stack || "").split("\n").slice(1, 4).join(" <- ")));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" && !/GPU stall|GL Driver|WebGL-|React DevTools/i.test(t)) errors.push(t.slice(0, 240));
});
page.on("request", (r) => {
  if (new URL(r.url()).pathname.startsWith("/api")) api.push(r.url());
});
await page.setViewport({ width: vp[0], height: vp[1] });
await page.goto(`${process.env.BASE_URL || "http://localhost:3111"}/dev/world-v6?${poster ? "poster=on" : "poster=off"}`, { waitUntil: "domcontentloaded", timeout: 80000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 80000, polling: 200 });
const werr = await page.evaluate(() => window.__worldError || null);
if (werr) throw new Error("world error " + werr);
await page.evaluate(() => document.fonts.ready);
if (tier !== null) await page.evaluate((t) => window.__worldV6Debug.setQualityTier(t), tier);
await sleep(800);

async function waitFor(fn, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn)) return true;
    await sleep(120);
  }
  return false;
}
async function settle() {
  for (let i = 0; i < 120; i++) {
    const ok = await page.evaluate(() => {
      const f = window.__worldFrame;
      const t = window.__worldTuning?.();
      if (!f || !t) return false;
      const total = t.scrollVh.reduce((a, b) => a + b, 0) + t.tailVh + (t.flightVh ?? 0);
      const max = window.__worldLock?.().maxDepth ?? 1;
      const target = Math.min(max, ((scrollY / innerHeight) * 100) / total);
      return Math.abs(f.depth - target) < 2e-5 && (f.parkProgress === 0 || f.parkProgress >= 0.999) && f.flight >= 0.999;
    });
    if (ok) return;
    await sleep(200);
  }
}
async function goStop(k) {
  await page.evaluate((k) => {
    const d = window.__worldV6Debug.stopDepths()[k];
    window.scrollTo(0, Math.round(window.__worldScrollFor(d)));
  }, k);
  await settle();
}
const area = vp[0] * vp[1];
const share = (r) => (r ? +((100 * r.w * r.h) / area).toFixed(2) : null);
const results = [];
async function report(st, name, extra = {}) {
  await sleep(600);
  const file = path.join(OUT, st, `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  const ui = await page.evaluate(() => window.__worldUi?.() ?? null);
  const fr = await page.evaluate(() => ({ tris: window.__worldFrame?.triangles ?? null, calls: window.__worldFrame?.calls ?? null, wp: window.__worldProgress?.() ?? null }));
  const box = (r) => (r ? { box: [r.l, r.t, r.w, r.h], side: r.side, covers: r.overlap, sharePct: share(r) } : null);
  const o = {
    state: st,
    shot: name,
    vp: vp.join("x"),
    tier: ui?.tier,
    place: ui?.place,
    card: box(ui?.card),
    chip: ui?.chip ? { box: [ui.chip.l, ui.chip.t, ui.chip.w, ui.chip.h], dir: ui.chip.dir, sharePct: share(ui.chip) } : null,
    done: box(ui?.done),
    panel: box(ui?.panel),
    header: ui?.header ? share(ui.header) : null,
    timeline: ui?.timeline ? share(ui.timeline) : null,
    done145: fr.wp ? fr.wp.done.reduce((a, b) => a + b, 0) : null,
    tris: fr.tris,
    calls: fr.calls,
    ...extra,
    file,
  };
  results.push(o);
  console.log(JSON.stringify(o));
}

for (const it of items) {
  const [st, kind, id] = it.split(":");
  // atN: the student at place N+1 (N places done, 60% of its lessons watched), as v6-ui-progress's stop:aN.
  const at = /^at(\d)$/.exec(st);
  const LESSONS = [8, 10, 22, 22, 25, 22, 22, 14];
  const tune = at ? { lock: "open", frontier: +at[1], finished: +at[1], partial: Math.round(LESSONS[+at[1]] * 0.6) } : STATES[st];
  await page.evaluate((t) => window.__worldTune(t), tune);
  await sleep(300);
  const list = kind === "stops" ? IDS : kind === "parks" ? IDS : [id];
  const park = kind === "park" || kind === "parks";
  for (const a of list) {
    const k = IDS.indexOf(a);
    await goStop(k);
    if (park) {
      await page.evaluate((a) => window.__worldPark(a), a);
      await waitFor(() => (window.__worldFrame?.parkProgress ?? 0) >= 0.999, 12000);
      await waitFor(() => !!window.__worldUi?.().leader, 3000);
      await report(st, `park_${a}`);
      await page.evaluate(() => window.__worldPark(null));
      await waitFor(() => (window.__worldFrame?.parkProgress ?? 1) === 0 && document.body.style.overflow !== "hidden", 12000);
      await settle();
    } else {
      await waitFor(() => {
        const u = window.__worldUi?.();
        return !!(u && (u.card || u.chip || u.done));
      }, 3500);
      await report(st, `stop_${a}`);
    }
  }
}
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ results, errors: [...new Set(errors)], api }, null, 1));
console.log("END " + JSON.stringify({ errors: [...new Set(errors)].slice(0, 8), api: api.length }));
await browser.close();
