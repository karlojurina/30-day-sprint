/**
 * Cheap-laptop verify (2026-09-28): poster mode, three ways, with screenshots.
 *
 *   node world-tests/v6-verify-poster.mjs [--out=dir]
 *
 *   load   1920x1080, CPU 4x (a slow laptop's load, so the window before the 3D
 *          is wide enough to see): screenshots at DOMContentLoaded, +0.6 s, +1.5 s,
 *          at __worldReady and 1.5 s after it. What shows before the 3D?
 *   tune   the same page at 1x: open Tune, press Posters, screenshot at a stop and
 *          between two stops; press 3D, screenshot. The canvas's visibility and
 *          posterState() at each step.
 *   forced ?poster=on: the page never builds the 3D; screenshot of the opening
 *          and of a1, and the notice text.
 *   verdict (2026-09-28 afternoon) a remembered poster verdict, each in a fresh
 *          context: 1 day old (posters at once, the "struggled" notice with
 *          "Try 3D anyway"), 8 days old and undated (dropped, the 3D loads and
 *          probes again), storage that throws (the page still loads), and a
 *          20x slow GPU in a tab that reports itself hidden (posters, but the
 *          verdict is not stored).
 *   --only=load|tune|forced|verdict runs one section.
 * Out: world-tests/shots/v6/cheap/verify/poster/*.png and poster.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const OUT = opt.out ? path.resolve(String(opt.out)) : path.join(HERE, "shots/v6/cheap/verify/poster");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:3111";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rep = { load: [], tune: [], forced: [], verdict: [], errors: [] };
const ONLY = opt.only ? String(opt.only) : "";
const want = (k) => !ONLY || ONLY === k;
const fails = [];
const save = () => fs.writeFileSync(path.join(OUT, "poster.json"), JSON.stringify(rep, null, 1));

const launch = () => puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 120000,
});
const state = (page) => page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const cv = document.querySelector("canvas");
  const n = document.querySelector("[data-poster-kind]");
  const notice = n ? { kind: n.getAttribute("data-poster-kind"), text: (n.firstChild?.textContent || "").trim(), button: n.querySelector("button")?.textContent.trim() ?? null, student: n.getAttribute("role") === "status" } : null;
  const pics = [...document.querySelectorAll("picture img, img")].filter((i) => /posters\//.test(i.currentSrc || i.src)).map((i) => {
    const cs = getComputedStyle(i);
    let op = 1;
    for (let e = i; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    return { src: (i.currentSrc || i.src).split("/").pop(), opacity: +op.toFixed(2), visible: cs.visibility };
  });
  return {
    t: Math.round(performance.now()),
    ready: !!window.__worldReady,
    poster: sc?.posterState ? sc.posterState() : null,
    canvas: cv ? { visibility: getComputedStyle(cv).visibility, opacity: getComputedStyle(cv).opacity } : null,
    notice,
    posters: pics,
  };
}).catch((e) => ({ err: String(e) }));

async function waitReady(page, t0, limit = 85000) {
  for (;;) {
    const s = await page.evaluate(() => (window.__worldReady ? "ok" : window.__worldError ? "err " + window.__worldError : null)).catch(() => null);
    if (s === "ok") return;
    if (s) throw new Error(s);
    if (Date.now() - t0 > limit) throw new Error("not ready");
    await sleep(150);
  }
}

// ── load ──
if (want("load")) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => rep.errors.push("load pageerror " + e.message));
    await page.setViewport({ width: 1920, height: 1080 });
    await page.emulateCPUThrottling(4);
    const t0 = Date.now();
    await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 85000 });
    const shots = [["load-1-dcl", 0], ["load-2-0.6s", 600], ["load-3-1.5s", 1500], ["load-4-3s", 3000]];
    for (const [name, at] of shots) {
      const wait = at - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      const st = await state(page);
      await page.screenshot({ path: path.join(OUT, name + ".png") });
      rep.load.push({ name, ms: Date.now() - t0, ...st });
      console.log(name, Date.now() - t0, JSON.stringify(st).slice(0, 300));
    }
    await waitReady(page, t0);
    for (const [name, extra] of [["load-5-ready", 0], ["load-6-ready+1.5s", 1500]]) {
      if (extra) await sleep(extra);
      const st = await state(page);
      await page.screenshot({ path: path.join(OUT, name + ".png") });
      rep.load.push({ name, ms: Date.now() - t0, ...st });
      console.log(name, Date.now() - t0, JSON.stringify(st).slice(0, 300));
    }
  } finally {
    save();
    await browser.close();
  }
}

// ── tune ──
if (want("tune")) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => rep.errors.push("tune pageerror " + e.message));
    await page.setViewport({ width: 1920, height: 1080 });
    const t0 = Date.now();
    await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 85000 });
    await waitReady(page, t0);
    await sleep(1500);
    const clickText = async (sel, text) => page.evaluate((sel, text) => {
      const b = [...document.querySelectorAll(sel)].find((e) => (e.textContent || "").trim().startsWith(text));
      if (!b) return false;
      b.click();
      return true;
    }, sel, text);
    rep.tune.push({ step: "open tune", ok: await clickText("button", "Tune") });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, "tune-0-panel.png") });
    rep.tune.push({ step: "press Posters", ok: await clickText("button", "Posters") });
    await sleep(1400);
    rep.tune.push({ step: "after Posters", ...(await state(page)) });
    await page.screenshot({ path: path.join(OUT, "tune-1-posters-k0.png") });
    // close the panel so the poster is seen whole, then go to a1 and between a1 and a2
    await clickText("button", "Tune");
    await sleep(300);
    const depths = await page.evaluate(() => [...window.__worldV6Debug.stopDepths()]);
    for (const [name, d] of [["tune-2-posters-a1", depths[0]], ["tune-3-posters-a1a2-mid", (depths[0] + depths[1]) / 2], ["tune-4-posters-a2", depths[1]]]) {
      await page.evaluate((d) => { const sc = window.__worldV6Debug; window.scrollTo(0, sc.scrollYForDepth(d)); sc.seedDepth(d); }, d);
      await sleep(1500);
      rep.tune.push({ step: name, ...(await state(page)) });
      await page.screenshot({ path: path.join(OUT, name + ".png") });
    }
    await clickText("button", "Tune");
    await sleep(300);
    rep.tune.push({ step: "press 3D", ok: await clickText("button", "3D") });
    await sleep(1500);
    await clickText("button", "Tune");
    await sleep(400);
    rep.tune.push({ step: "after 3D", ...(await state(page)) });
    await page.screenshot({ path: path.join(OUT, "tune-5-back-to-3d-a2.png") });
    console.log("tune", JSON.stringify(rep.tune).slice(0, 1500));
  } finally {
    save();
    await browser.close();
  }
}

// ── forced ?poster=on ──
if (want("forced")) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => rep.errors.push("forced pageerror " + e.message));
    await page.setViewport({ width: 1366, height: 768 });
    const t0 = Date.now();
    await page.goto(BASE + "/dev/world-v6?poster=on", { waitUntil: "domcontentloaded", timeout: 85000 });
    await waitReady(page, t0);
    await sleep(1500);
    rep.forced.push({ step: "k0", readyMs: Date.now() - t0, ...(await state(page)) });
    await page.screenshot({ path: path.join(OUT, "forced-k0-1366.png") });
    const depths = await page.evaluate(() => (window.__worldV6Debug?.stopDepths ? [...window.__worldV6Debug.stopDepths()] : null));
    rep.forced.push({ step: "depths", depths });
    const f0 = rep.forced[0];
    if (!f0.notice || f0.notice.student || f0.notice.kind !== "forced") fails.push("forced: expected the dev tag and no student notice, got " + JSON.stringify(f0.notice));
    console.log("forced", JSON.stringify(rep.forced).slice(0, 800));
  } finally {
    save();
    await browser.close();
  }
}
// ── verdict: expiry, storage, hidden tab ──
if (want("verdict")) {
  const browser = await launch();
  const DAY = 86400000;
  const cases = [
    { name: "verdict-1day", seed: (now) => JSON.stringify({ v: 2, kind: "slow", reason: "the opening at tier 3 takes 35 ms (over 28)", at: now - 1 * DAY }), expect: "posters" },
    { name: "verdict-8days", seed: (now) => JSON.stringify({ v: 2, kind: "slow", reason: "the opening at tier 3 takes 35 ms (over 28)", at: now - 8 * DAY }), expect: "3d" },
    { name: "verdict-undated", seed: () => "the opening at tier 3 takes 35 ms (over 28)", expect: "3d" },
    { name: "storage-throws", throws: true, expect: "3d" },
    { name: "hidden-20x", hidden: true, query: "?slowgpu=20", expect: "posters-unstored" },
  ];
  try {
    for (const c of cases) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      page.on("pageerror", (e) => rep.errors.push(c.name + " pageerror " + e.message));
      await page.setViewport({ width: 1920, height: 1080 });
      const now = Date.now();
      await page.evaluateOnNewDocument(
        (seedVal, throws, hidden) => {
          if (seedVal !== null && !sessionStorage.getItem("seeded")) {
            localStorage.setItem("world-v6-poster", seedVal);
            sessionStorage.setItem("seeded", "1");
          }
          if (throws) {
            const boom = () => {
              throw new DOMException("blocked", "SecurityError");
            };
            Storage.prototype.getItem = boom;
            Storage.prototype.setItem = boom;
            Storage.prototype.removeItem = boom;
          }
          if (hidden) {
            Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
            Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
          }
        },
        c.seed ? c.seed(now) : null,
        !!c.throws,
        !!c.hidden,
      );
      const t0 = Date.now();
      await page.goto(BASE + "/dev/world-v6" + (c.query || ""), { waitUntil: "domcontentloaded", timeout: 85000 });
      // Loaded: ready, or (hidden, where no frame is drawn) the load's own report is complete.
      let done = false;
      while (!done && Date.now() - t0 < 60000) {
        done = await page
          .evaluate(() => {
            if (window.__worldReady) return true;
            const q = window.__worldV6Debug?.qualityInfo?.();
            return !!(q && (q.report.probe || q.poster.headless) && q.report.readyMs);
          })
          .catch(() => false);
        if (!done) await sleep(200);
      }
      await sleep(1500);
      const st = await state(page);
      const extra = await page.evaluate(() => {
        const q = window.__worldV6Debug?.qualityInfo?.();
        let stored = "unreadable";
        try {
          stored = localStorage.getItem("world-v6-poster");
        } catch {}
        return { expired: q?.report.posterExpired ?? null, notRemembered: q?.report.notRemembered ?? null, posterRemembered: q?.report.posterRemembered ?? null, tier: q?.quality.tier ?? null, stored };
      });
      await page.screenshot({ path: path.join(OUT, c.name + ".png") });
      const row = { name: c.name, loadedMs: Date.now() - t0, ...st, ...extra };
      rep.verdict.push(row);
      const p = st.poster || {};
      let ok;
      if (c.expect === "posters") ok = p.on && p.headless && p.kind === "slow" && st.notice?.button === "Try 3D anyway" && /struggled/.test(st.notice?.text || "");
      else if (c.expect === "3d") ok = !p.on && !p.headless && st.canvas && (c.throws ? extra.stored === "unreadable" : extra.stored === null);
      else ok = p.on && p.kind === "slow" && extra.stored === null && /hidden/.test(extra.notRemembered || "");
      if (!ok) fails.push(`${c.name}: ${JSON.stringify(row).slice(0, 500)}`);
      console.log(c.name, ok ? "PASS" : "FAIL", JSON.stringify({ poster: p, notice: st.notice, ...extra }).slice(0, 600));
      await ctx.close();
    }
  } finally {
    save();
    await browser.close();
  }
}
rep.fails = fails;
save();
console.log("POSTERDONE errors", rep.errors.length, "fails", fails.length);
for (const f of fails) console.log("FAIL", f);
process.exit(fails.length || rep.errors.length ? 1 : 0);
