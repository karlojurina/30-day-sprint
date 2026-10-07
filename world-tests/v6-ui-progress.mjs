/**
 * Progress UI (2026-09-28): the arrival card, the chip, the place panel and
 * the done card, rendered on the real GPU and measured.
 *
 *   node world-tests/v6-ui-progress.mjs <tag> [--vp 1691x1278] [--tier 3] [--poster] shot ...
 *
 * Shots (named, never raw KEYS indices; frames come from stopDepths()):
 *   stop:aN           the student at place N (N-1 places finished, 60% of N's
 *                     lessons watched), the camera resting at stop N: the card
 *   zero:a1           progress 0, resting at a1 (the launch state)
 *   chip:aN+P         the student at a4 (18 of 22), the camera P percent of
 *                     the way from stop N to stop N+1 (aN alone: at stop N)
 *   park:aN           the student at a4, place N clicked in: the panel
 *   done              the student at a4 with 21 of 22, then the last lesson
 *                     watched: the scene's moment and the done card
 *   arrive            progress 0, loaded with ?arrive=1: the auto-travel to a1
 *   move              the card up at a4, then a 12 px scroll: the card must
 *                     go and the place's plaque come back within 400 ms
 *                     (<tag>-move-mid.png is 110 ms in, mid shrink)
 *   keys              the student at a4 resting there: Tab lands on the card's
 *                     Watch, Enter plays the lesson, Esc twice comes home,
 *                     then Tab to a place's label and Enter opens that place
 *
 * Prints one JSON line per shot: the card, chip and panel boxes, their share
 * of the frame, which side the card took, how much of the landmark it covers,
 * the leader path. PNGs: world-tests/shots/v6/progress/ui/<tag>-<shot>.png
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots", "v6", "progress", "ui");
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const tag = argv.shift();
let vp = [1691, 1278];
let tier = null;
let poster = false;
const shots = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--vp") vp = argv[++i].split("x").map(Number);
  else if (argv[i] === "--tier") tier = Number(argv[++i]);
  else if (argv[i] === "--poster") poster = true;
  else if (!argv[i].startsWith("--")) shots.push(argv[i]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LESSONS = [8, 10, 22, 22, 25, 22, 22, 14];

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 120000,
});
const errors = [];

async function openPage(query = "") {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push("pageerror " + e.message + " :: " + (e.stack || "").split("\n").slice(1, 4).join(" <- ")));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !/GPU stall|GL Driver|WebGL-|React DevTools/i.test(t)) errors.push(t.slice(0, 200));
  });
  await page.setViewport({ width: vp[0], height: vp[1] });
  const base = process.env.BASE_URL || "http://localhost:3111";
  await page.goto(`${base}/dev/world-v6?${poster ? "poster=on" : "poster=off"}${query}`, { waitUntil: "domcontentloaded", timeout: 80000 });
  await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 80000, polling: 300 });
  const err = await page.evaluate(() => window.__worldError || null);
  if (err) throw new Error("world error " + err);
  await page.evaluate(() => document.fonts.ready);
  if (tier !== null) await page.evaluate((t) => window.__worldV6Debug.setQualityTier(t), tier);
  return page;
}

/** Scroll so the camera rests at a named frame: aN, or aN+P (P percent toward stop N+1). */
async function goTo(page, frame) {
  await page.evaluate((fr) => {
    const m = /^a(\d)([+-]\d+)?$/.exec(fr);
    const d = window.__worldV6Debug.stopDepths();
    const k = Number(m[1]) - 1;
    const p = m[2] ? Number(m[2]) / 100 : 0;
    const to = p >= 0 ? d[k] + (d[Math.min(7, k + 1)] - d[k]) * p : d[k] + (d[k] - d[Math.max(0, k - 1)]) * p;
    window.scrollTo(0, Math.round(window.__worldScrollFor(to)));
  }, frame);
  await settle(page);
}

async function settle(page) {
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
    await sleep(250);
  }
}

async function waitFor(page, fn, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn)) return true;
    await sleep(150);
  }
  return false;
}

async function report(page, name, extra = {}) {
  await sleep(700);
  const file = path.join(OUT, `${tag}-${name.replace(/[:+]/g, "_")}.png`);
  await page.screenshot({ path: file });
  const ui = await page.evaluate(() => window.__worldUi?.() ?? null);
  const area = vp[0] * vp[1];
  const share = (r) => (r ? +((100 * r.w * r.h) / area).toFixed(2) : null);
  const out = {
    shot: name,
    vp: vp.join("x"),
    tier: ui?.tier,
    place: ui?.place,
    card: ui?.card ? { box: [ui.card.l, ui.card.t, ui.card.w, ui.card.h], side: ui.card.side, covers: ui.card.overlap, sharePct: share(ui.card) } : null,
    done: ui?.done ? { box: [ui.done.l, ui.done.t, ui.done.w, ui.done.h], side: ui.done.side, covers: ui.done.overlap, sharePct: share(ui.done) } : null,
    chip: ui?.chip ? { box: [ui.chip.l, ui.chip.t, ui.chip.w, ui.chip.h], dir: ui.chip.dir, sharePct: share(ui.chip) } : null,
    panel: ui?.panel ? { box: [ui.panel.l, ui.panel.t, ui.panel.w, ui.panel.h], covers: ui.panel.overlap, sharePct: share(ui.panel) } : null,
    leader: ui?.leader,
    ...extra,
    file,
  };
  console.log(JSON.stringify(out));
  return out;
}

const tune = (page, patch) => page.evaluate((p) => window.__worldTune(p), patch);

for (const shot of shots) {
  const [kind, arg] = shot.split(":");
  if (kind === "arrive") {
    const page = await openPage("&arrive=1");
    await tune(page, { lock: "open", frontier: 0, finished: 0, partial: 0 });
    await page.evaluate(() => window.scrollTo(0, 0));
    // The page travels on its own; the card shows once the camera rests at a1.
    const up = await waitFor(page, () => !!window.__worldUi?.().card, 12000);
    await report(page, "arrive", { cardShown: up, scrollY: await page.evaluate(() => scrollY) });
    await page.close();
    continue;
  }
  const page = await openPage();
  if (kind === "stop" || kind === "zero") {
    const k = Number(arg.slice(1)) - 1;
    if (kind === "zero") await tune(page, { lock: "open", frontier: 0, finished: 0, partial: 0 });
    else await tune(page, { lock: "open", frontier: k, finished: k, partial: Math.round(LESSONS[k] * 0.6) });
    await goTo(page, arg);
    const up = await waitFor(page, () => !!window.__worldUi?.().card, 6000);
    await report(page, shot, { cardShown: up });
  } else if (kind === "chip") {
    await tune(page, { lock: "open", frontier: 3, finished: 3, partial: 18 });
    await goTo(page, arg);
    const up = await waitFor(page, () => !!window.__worldUi?.().chip, 4000);
    await report(page, shot, { chipShown: up });
  } else if (kind === "park") {
    await tune(page, { lock: "open", frontier: 3, finished: 3, partial: 18 });
    await goTo(page, arg);
    await page.evaluate((id) => window.__worldPark(id), arg);
    await waitFor(page, () => (window.__worldFrame?.parkProgress ?? 0) >= 0.999, 12000);
    await waitFor(page, () => !!window.__worldUi?.().leader, 3000);
    await report(page, shot);
  } else if (kind === "move") {
    await tune(page, { lock: "open", frontier: 3, finished: 3, partial: 18 });
    await goTo(page, "a4");
    const up = await waitFor(page, () => !!window.__worldUi?.().card, 6000);
    const plaque = () =>
      page.evaluate(() => {
        const b = [...document.querySelectorAll("button[data-mode]")][3];
        return { mode: b?.dataset.mode ?? null, card: b?.dataset.card !== undefined, labelOpacity: b ? getComputedStyle(b.querySelector("span:nth-child(3)")).opacity : null };
      });
    const before = await plaque();
    // A nudge (12 px): the route turns hard after a4, so a real wheel notch swings the hut out of frame.
    await page.evaluate(() => window.scrollBy(0, 12));
    await sleep(110);
    await page.screenshot({ path: path.join(OUT, `${tag}-move-mid.png`) });
    await sleep(290);
    const ui = await page.evaluate(() => window.__worldUi());
    const after = await plaque();
    await page.screenshot({ path: path.join(OUT, `${tag}-move.png`) });
    console.log(JSON.stringify({ shot: "move", cardUpFirst: up, before, cardAfterScroll: !!ui.card, after, leaderAfter: ui.leader }));
  } else if (kind === "keys") {
    await tune(page, { lock: "open", frontier: 3, finished: 3, partial: 18 });
    await goTo(page, "a4");
    await waitFor(page, () => !!window.__worldUi?.().card, 6000);
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim().slice(0, 40) || null);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Tab");
    const first = await focused();
    await page.keyboard.press("Enter");
    const parked = await waitFor(page, () => (window.__worldFrame?.parkProgress ?? 0) >= 0.999, 12000);
    await sleep(500);
    const lessonTitle = await page.evaluate(() => document.querySelector("#v4-panel-title")?.textContent ?? null);
    await report(page, "keys-lesson", { firstTab: first, parked, lessonTitle });
    await page.keyboard.press("Escape");
    await sleep(400);
    const areaTitle = await page.evaluate(() => document.querySelector("#v4-panel-title")?.textContent ?? null);
    await page.keyboard.press("Escape");
    const home = await waitFor(page, () => (window.__worldFrame?.parkProgress ?? 1) === 0 && document.body.style.overflow !== "hidden", 12000);
    const back = await focused();
    // Tab onward to a place label (a marker button) and open it with Enter.
    let label = null;
    for (let i = 0; i < 14 && !label; i++) {
      await page.keyboard.press("Tab");
      label = await page.evaluate(() => (document.activeElement?.dataset?.mode ? document.activeElement.getAttribute("aria-label") : null));
    }
    await page.keyboard.press("Enter");
    const opened = await waitFor(page, () => (window.__worldFrame?.parkProgress ?? 0) >= 0.999, 12000);
    const openedTitle = await page.evaluate(() => document.querySelector("#v4-panel-title")?.textContent ?? null);
    console.log(JSON.stringify({ shot: "keys", firstTab: first, lessonTitle, escOnce: areaTitle, escTwiceHome: home, focusAfterClose: back, tabbedLabel: label, enterOpened: opened, openedTitle }));
  } else if (kind === "done") {
    await tune(page, { lock: "open", frontier: 3, finished: 3, partial: 21 });
    await goTo(page, "a4");
    await waitFor(page, () => !!window.__worldUi?.().card, 6000);
    // The last lesson watched: the place is finished and the student moves on to a5.
    await tune(page, { frontier: 4, finished: 4, partial: 0 });
    const up = await waitFor(page, () => !!window.__worldUi?.().done, 4000);
    const celebrated = await page.evaluate(() => typeof window.__worldV6Debug?.celebrate === "function");
    await report(page, shot, { doneShown: up, sceneHasCelebrate: celebrated });
  }
  await page.close();
}
if (errors.length) console.log("ERRORS", JSON.stringify([...new Set(errors)].slice(0, 8)));
await browser.close();
