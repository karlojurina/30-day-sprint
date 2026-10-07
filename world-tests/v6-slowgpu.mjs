/**
 * v6 slow GPU run (cheap laptops, 2026-09-28). The M2 made 5, 10, 20 and 40
 * times slower by the dev simulator (?slowgpu=N, WorldScene.simulateSlowGpu:
 * a calibrated full screen load per pixel), plus a control at 1x, plus a
 * browser with no WebGL and one on SwiftShader.
 *
 *   node world-tests/v6-slowgpu.mjs [--factors=1,5,10,20,40] [--size=1920x1080] [--scroll=20] [--only=gpu|nogl|swift|cold|recheck] [--out=dir]
 *
 * Adaptation checks (2026-09-28 afternoon), each in a fresh browser context:
 *   --only=cold [--cold=80] [--coldframes=1,2]   the load probe's first N
 *       synced frames cost MS more on the GPU (?coldstall, the simulator's
 *       quad for those frames only). N=1 (only the cold frame) must NOT lower
 *       the tier; N=2 (the warm frame too) must still stop the probe early.
 *       Then 20 s at rest: the rest check must bring a lowered tier back.
 *   --only=recheck [--seedtier=3]   a remembered low tier (localStorage) on
 *       the M2: the load re-probes it and the rest check climbs while idle.
 *
 * Adapt2 (2026-09-28 evening):
 *   --only=sweep [--factors=1,3,5,...] [--sweepscroll=12]   per factor, a fresh
 *       context: the landing after the load (tier, pixel ratio, 3D or posters),
 *       a guarded wheel scroll through the whole route, a rest, the landing
 *       after it, the scene's drawn frames per second while moving, the frame
 *       pacer's skips and the governor's poster asks. Then the monotonic check,
 *       ordered by the measured opening (the simulator's base drifts, so the
 *       asked factor is not the order): no run may end on the posters while a
 *       run with a slower opening keeps the 3D.
 *   --only=try [--tryfactor=40]   a remembered poster verdict: the page opens on
 *       the posters; "Try 3D anyway" reloads with ?poster=try; the 3D must stay
 *       up after the load, and after a scroll and a rest the posters must be
 *       offered (not forced); "Switch to still views" then shows them. At 1x the
 *       same path must keep the 3D with no offer.
 * The script exits when done (it used to print its summary and hang).
 *
 * For each factor, in a fresh browser context (nothing remembered):
 *   - the load: the calibration (what the simulator achieved), the probe, the
 *     tier it landed on, whether the posters took over, the ready time;
 *   - the screen every 250 ms through the load and the handover: never blank
 *     (a frame of the page's plain background) and never a jump in brightness
 *     between two samples that is not a crossfade;
 *   - a steady wheel scroll through the whole route: the governor's steps, the
 *     pixel ratio, frame intervals, and the input delay of every wheel event
 *     (Event Timing: processingStart - startTime, the main thread's share);
 *   - a rest after it: a poster verdict is only applied at rest;
 *   - in poster mode: the posters crossfade as the page scrolls, the labels
 *     sit on the posters, and a place opens and closes.
 * At 1x it also switches tiers 0, 1, 2, 3 at three stops and checks that no
 * program is compiled after the load (the warm up covers every tier).
 *
 * Writes world-tests/shots/v6/fallback/slowgpu.json and the shots next to it.
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
const OUT_ARG = arg("out", "");
const OUT = OUT_ARG ? path.resolve(OUT_ARG) : path.join(HERE, "shots/v6/fallback/slowgpu");
const REPORT = OUT_ARG ? path.join(OUT, "slowgpu.json") : path.join(HERE, "shots/v6/fallback/slowgpu.json");
fs.mkdirSync(OUT, { recursive: true });
const FACTORS = arg("factors", "1,5,10,20,40").split(",").map(Number);
const [VW, VH] = arg("size", "1920x1080").split("x").map(Number);
const SCROLL_S = Number(arg("scroll", "20"));
const ONLY = arg("only", "");
const URL0 = "http://localhost:3111/dev/world-v6";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const GPU_ARGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const report = { size: `${VW}x${VH}@1`, runs: [] };
const save = () => fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
const COLD_MS = Number(arg("cold", "80"));
const COLD_FRAMES = arg("coldframes", "1,2").split(",").map(Number);
const SEED_TIER = Number(arg("seedtier", "3"));
const REST_S = Number(arg("rest", "22"));
const SWEEP_SCROLL_S = Number(arg("sweepscroll", "12"));
const TRY_FACTOR = Number(arg("tryfactor", "40"));
/** Adapt3: `--try=24:keep,40:accept,1`: each factor and the answer to the offer (accept, the default, or keep). */
const TRY_RUNS = arg("try", `${TRY_FACTOR}:accept,1`)
  .split(",")
  .map((x) => {
    const [f, a] = x.split(":");
    return { factor: Number(f), answer: a === "keep" ? "keep" : "accept" };
  });
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms))]);

/** The landing as the sweep reads it. */
const landing = (page) =>
  withTimeout(
    page.evaluate(() => {
      const q = window.__worldV6Debug.qualityInfo();
      const r = q.report;
      return {
        tier: q.quality.tier,
        pixelRatio: q.pixelRatio,
        posters: q.poster.on,
        posterReason: q.poster.reason,
        offer: q.poster.offer ?? null,
        probe: r.probe ? { ms: r.probe.ms, first: r.probe.first, cold: r.probe.cold, capped: r.probe.capped } : null,
        refine: r.refine?.reason ?? null,
        probe3: r.probe3 ? { ms: r.probe3.ms, capped: r.probe3.capped, runs: r.probe3.runs ?? null } : null,
        probe2: r.probe2 ?? null,
        restBursts: r.restBursts ?? [],
        trying: q.poster.trying ?? false,
        sim: r.slowGpu ?? null,
        last: r.last ?? null,
        governor: q.governor,
        governorPoster: r.governorPoster ?? [],
        pacer: q.pacer,
        frames: window.__worldFrameCount ?? 0,
      };
    }),
    15000,
    "landing",
  );

/** A wheel scroll through the whole route, every call guarded; the scene's drawn frames counted. */
async function guardedScroll(page, seconds) {
  const total = await withTimeout(page.evaluate(() => document.documentElement.scrollHeight - innerHeight), 10000, "height");
  await page.mouse.move(VW / 2, VH / 2);
  const per = (total / (seconds * 1000)) * 100;
  const f0 = await withTimeout(page.evaluate(() => ({ n: window.__worldFrameCount ?? 0, t: performance.now() })), 10000, "frames");
  const t0 = Date.now();
  let y = 0;
  const stalls = [];
  let worstCall = 0;
  while (Date.now() - t0 < seconds * 1000 && y < total - 1) {
    const a = Date.now();
    try {
      await withTimeout(page.mouse.wheel({ deltaY: per }), 8000, "wheel");
    } catch {
      stalls.push(+((Date.now() - t0) / 1000).toFixed(1));
    }
    worstCall = Math.max(worstCall, Date.now() - a);
    y += per;
    await sleep(100);
  }
  const f1 = await withTimeout(page.evaluate(() => ({ n: window.__worldFrameCount ?? 0, t: performance.now() })), 15000, "frames").catch(() => null);
  const frames = f1 ? f1.n - f0.n : null;
  const ms = f1 ? f1.t - f0.t : null;
  return { frames, ms: ms && Math.round(ms), msPerFrame: frames ? +(ms / frames).toFixed(1) : null, worstWheelCallMs: worstCall, stalls };
}

async function runSweepOne(browser, factor) {
  const tag = `sweep-x${factor}`;
  const { ctx, page, errors } = await newPage(browser);
  const run = { factor, tag };
  const t0 = Date.now();
  try {
    await page.goto(`${URL0}?slowgpu=${factor}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    run.readyMs = await waitReadyAt(page, t0);
    await sleep(800);
    run.atLoad = await landing(page);
    await page.screenshot({ path: path.join(OUT, `${tag}-load.png`) }).catch(() => {});
    run.scroll = await guardedScroll(page, SWEEP_SCROLL_S);
    await sleep(5000);
    run.after = await landing(page);
    await page.screenshot({ path: path.join(OUT, `${tag}-after.png`) }).catch(() => {});
  } catch (e) {
    run.error = String(e);
  }
  run.errors = errors;
  const L = (x) => (x ? (x.posters ? "posters" : `3D tier ${x.tier} @ ${x.pixelRatio}`) : "-");
  log(
    tag,
    `sim x${run.atLoad?.sim?.achieved ?? "-"}; opening ${run.atLoad?.probe?.ms ?? "-"} ms (${run.atLoad?.refine ?? "-"}); tier 2 ${run.atLoad?.probe2 ? JSON.stringify(run.atLoad.probe2.runs.map((x) => [x.pr, x.ms, x.runs])) : "-"}; tier 3 probe ${run.atLoad?.probe3?.ms ?? "-"} ${run.atLoad?.probe3?.runs ? JSON.stringify(run.atLoad.probe3.runs) : ""}; load: ${L(run.atLoad)}; after scroll: ${L(run.after)}; moving ${run.scroll?.msPerFrame ?? "-"} ms/frame; pacer ${JSON.stringify(run.after?.pacer ?? null)}; asks ${run.after?.governorPoster?.length ?? 0}; stalls ${JSON.stringify(run.scroll?.stalls ?? [])}`,
  );
  await ctx.close().catch(() => {});
  return run;
}

/** Order by the measured opening at the pick tier and check that the outcome only gets worse. */
function sweepVerdict(runs) {
  const rows = runs
    .filter((r) => r.atLoad && r.after)
    .map((r) => ({
      factor: r.factor,
      opening: r.atLoad.probe?.ms ?? 0,
      achieved: r.atLoad.sim?.achieved ?? 1,
      load: r.atLoad.posters ? "posters" : `tier ${r.atLoad.tier} @ ${r.atLoad.pixelRatio}`,
      final: r.after.posters ? "posters" : `tier ${r.after.tier} @ ${r.after.pixelRatio}`,
      posters: !!r.after.posters,
      tier: r.after.tier,
      pr: r.after.pixelRatio,
      msPerFrame: r.scroll?.msPerFrame ?? null,
      tier2: r.atLoad.probe2?.runs?.map((x) => `${x.pr}:${x.ms}`).join(" ") || "-",
      tier3: r.atLoad.probe3 ? `${r.atLoad.probe3.ms}${r.atLoad.probe3.runs && r.atLoad.probe3.runs.length > 1 ? ` median of ${JSON.stringify(r.atLoad.probe3.runs)}` : ""}` : "-",
      restBursts: r.after.restBursts?.length ?? 0,
    }))
    .sort((a, b) => a.opening - b.opening);
  const bad = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i].posters && !rows[j].posters) bad.push(`x${rows[i].factor} (opening ${rows[i].opening}) got the posters while x${rows[j].factor} (opening ${rows[j].opening}) kept the 3D`);
    }
  }
  // The weaker check: the pixel budget (tier 3 at 0.75 is the least) never grows with a slower opening.
  const budget = (r) => (r.posters ? -1 : r.pr * r.pr * (1 + (3 - r.tier) * 0.15));
  const tierInversions = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) if (budget(rows[j]) > budget(rows[i]) + 1e-6) tierInversions.push(`x${rows[j].factor} (${rows[j].final}) above x${rows[i].factor} (${rows[i].final})`);
  // Adapt3: the poster verdict is decided on the tier 3 measurement (a saturated
  // burst, the median of three near the line), while a probe capped at the pick
  // tier reports ONE warm frame as its opening (x15 in adapt3: cold 45, warm
  // 55). Among the rows that measured tier 3, the same check ordered by it.
  const t3rows = rows
    .map((r, i) => ({ ...r, t3: runs.find((x) => x.factor === r.factor)?.atLoad?.probe3?.ms ?? null, capped: !!runs.find((x) => x.factor === r.factor)?.atLoad?.probe?.capped, i }))
    .filter((r) => r.t3 !== null)
    .sort((a, b) => a.t3 - b.t3);
  const badT3 = [];
  for (let i = 0; i < t3rows.length; i++) {
    for (let j = i + 1; j < t3rows.length; j++) {
      if (t3rows[i].posters && !t3rows[j].posters) badT3.push(`x${t3rows[i].factor} (tier 3 ${t3rows[i].t3}) got the posters while x${t3rows[j].factor} (tier 3 ${t3rows[j].t3}) kept the 3D`);
    }
  }
  const cappedOpenings = rows.filter((r) => runs.find((x) => x.factor === r.factor)?.atLoad?.probe?.capped).map((r) => `x${r.factor}:${r.opening}`);
  return { rows, monotonic: bad.length === 0, violations: bad, tierInversions, byTier3: { rows: t3rows.map((r) => ({ factor: r.factor, t3: r.t3, final: r.final })), monotonic: badT3.length === 0, violations: badT3 }, cappedOpenings };
}

/**
 * "Try 3D anyway" from remembered posters: the reload keeps the 3D, then offers the posters if it cannot cope.
 * Adapt3: `answer` "keep" presses "Keep 3D" and scrolls the route again: no new ask, no offer, no burst.
 * Every measurement at rest (report.restBursts) and every ask is logged with its time and length.
 */
async function runTry(browser, factor, answer = "accept") {
  const tag = `try-x${factor}${answer === "keep" ? "-keep" : ""}`;
  const { ctx, page, errors } = await newPage(browser);
  const run = { factor: tag, tag, answer };
  await page.evaluateOnNewDocument(() => {
    try {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("world-v6-poster", JSON.stringify({ v: 2, kind: "slow", reason: "seeded by v6-slowgpu --only=try", at: Date.now() - 3600e3 }));
        sessionStorage.setItem("seeded", "1");
      }
    } catch {}
  });
  const t0 = Date.now();
  await page.goto(`${URL0}${factor > 1 ? `?slowgpu=${factor}` : ""}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  run.readyMs = await waitReadyAt(page, t0);
  await sleep(1000);
  run.first = await page.evaluate(() => ({ poster: window.__worldPoster?.() ?? null, url: location.search }));
  run.firstNotice = await noticeOf(page);
  await page.screenshot({ path: path.join(OUT, `${tag}-1-remembered.png`) });
  // Press "Try 3D anyway".
  const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
  await page.evaluate(() => document.querySelector("[data-poster-kind] button")?.click());
  await nav;
  const t1 = Date.now();
  run.reloadReadyMs = await waitReadyAt(page, t1);
  await sleep(1500);
  run.afterReload = { url: await page.evaluate(() => location.search), ...(await landing(page)) };
  run.afterReload.stored = await page.evaluate(() => localStorage.getItem("world-v6-poster"));
  await page.screenshot({ path: path.join(OUT, `${tag}-2-reloaded.png`) });
  run.scroll = await guardedScroll(page, SWEEP_SCROLL_S);
  // Rest: the governor's ask is answered and turned into an offer.
  await sleep(6000);
  run.afterScroll = await landing(page);
  const offerOf = () =>
    page.evaluate(() => {
      const n = document.querySelector("[data-poster-offer]");
      return n ? { text: (n.firstChild?.textContent || "").trim(), buttons: [...n.querySelectorAll("button")].map((b) => b.textContent.trim()) } : null;
    });
  run.offerNotice = await offerOf();
  await page.screenshot({ path: path.join(OUT, `${tag}-3-after-scroll.png`) });
  if (run.offerNotice && answer === "accept") {
    await page.evaluate(() => document.querySelector("[data-poster-offer] button")?.click());
    await sleep(2500);
    run.accepted = await landing(page);
    run.acceptedNotice = await noticeOf(page);
    run.acceptedStored = await page.evaluate(() => localStorage.getItem("world-v6-poster"));
    await page.screenshot({ path: path.join(OUT, `${tag}-4-accepted.png`) });
  } else if (answer === "keep") {
    if (run.offerNotice) await page.evaluate(() => document.querySelectorAll("[data-poster-offer] button")[1]?.click());
    await sleep(800);
    run.keptAt = await page.evaluate(() => Math.round(performance.now()));
    // Two more passes over the route: under adapt2 the governor asked again every 10 s.
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    await sleep(1500);
    run.scroll2 = await guardedScroll(page, SWEEP_SCROLL_S);
    await sleep(3000);
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    await sleep(1500);
    run.scroll3 = await guardedScroll(page, SWEEP_SCROLL_S);
    await sleep(6000);
    run.afterKeep = await landing(page);
    run.offerAfterKeep = await offerOf();
    await page.screenshot({ path: path.join(OUT, `${tag}-4-kept.png`) });
  }
  run.errors = errors;
  const fin = run.afterKeep ?? run.accepted ?? run.afterScroll;
  run.restBursts = fin.restBursts ?? [];
  run.asks = (fin.governorPoster ?? []).map((g) => ({ at: g.at, place: g.place, burstMs: g.burstMs, took: g.took ?? 0, answeredBy: g.answeredBy ?? "burst", line: g.line, over: g.over, waitedMs: g.waitedMs, next: g.next ?? null }));
  const longest = run.restBursts.reduce((m, b) => Math.max(m, b.took), 0);
  // What the load measured decides what is expected (the simulator drifts, the factor does not say).
  const t3 = run.afterReload.probe3?.ms ?? null;
  const slow = t3 !== null && t3 > 28;
  run.expected = slow ? `an offer (tier 3 opening ${t3} > 28)${answer === "keep" ? ", then after Keep 3D no ask" : ", then posters on accept"}` : `3D, no offer (tier 3 opening ${t3 ?? "not measured"})`;
  const baseOk = !!run.first.poster?.on && run.firstNotice?.button === "Try 3D anyway" && /poster=try/.test(run.afterReload.url) && !run.afterReload.posters;
  const burstsOk = longest <= 130;
  let pathOk;
  if (!slow) pathOk = !run.offerNotice && !run.afterScroll.posters;
  else if (answer === "accept") pathOk = !!run.offerNotice && !run.afterScroll.posters && !!run.accepted?.posters;
  else {
    const asksAfterKeep = run.asks.filter((a) => a.at > (run.keptAt ?? Infinity)).length;
    const burstsAfterKeep = run.restBursts.filter((b) => b.at > (run.keptAt ?? Infinity)).length;
    run.afterKeepCounts = { asks: asksAfterKeep, bursts: burstsAfterKeep, stopped: run.afterKeep?.governor?.posterStopped ?? null };
    pathOk = !!run.offerNotice && !run.offerAfterKeep && !run.afterKeep?.posters && asksAfterKeep === 0 && burstsAfterKeep === 0 && run.afterKeep?.governor?.posterStopped === true;
  }
  run.pass = baseOk && burstsOk && pathOk;
  run.check = `remembered posters ${!!run.first.poster?.on} (button ${run.firstNotice?.button ?? "-"}); reload ${run.afterReload.url}: ${run.afterReload.posters ? "posters" : `3D tier ${run.afterReload.tier} @ ${run.afterReload.pixelRatio}`}, tier 3 opening ${t3 ?? "-"}${run.afterReload.probe3?.runs?.length > 1 ? ` (median of ${JSON.stringify(run.afterReload.probe3.runs)})` : ""}; after scroll+rest: ${run.afterScroll.posters ? "posters" : "3D"}, offer ${run.offerNotice ? JSON.stringify(run.offerNotice.buttons) : "none"}; asks ${JSON.stringify(run.asks.map((a) => [a.at, a.place, a.answeredBy, a.burstMs, a.over]))}; rest bursts ${JSON.stringify(run.restBursts.map((b) => [b.kind, b.at, b.took]))} (longest ${longest} ms)${run.accepted ? `; accepted: ${run.accepted.posters ? "posters" : "3D"}, notice ${run.acceptedNotice?.kind ?? "-"}` : ""}${run.afterKeep ? `; after Keep 3D and two more passes: ${run.afterKeep.posters ? "posters" : "3D"}, offer ${run.offerAfterKeep ? "shown" : "none"}, ${JSON.stringify(run.afterKeepCounts)}` : ""}; expected ${run.expected}`;
  log(tag, run.pass ? "PASS" : "FAIL", run.check);
  await ctx.close().catch(() => {});
  return run;
}

// Screen statistics from a screenshot, in a helper page: mean luma, its spread,
// and the share of pixels within 6 levels of the page's background (#1d1826).
let helper = null;
async function stats(png) {
  return helper.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const w = 96;
    const h = Math.round((img.height / img.width) * w);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let sum = 0;
    let sum2 = 0;
    let bg = 0;
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const r = d[i * 4];
      const gg = d[i * 4 + 1];
      const b = d[i * 4 + 2];
      const y = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      sum += y;
      sum2 += y * y;
      if (Math.abs(r - 0x1d) < 7 && Math.abs(gg - 0x18) < 7 && Math.abs(b - 0x26) < 7) bg++;
    }
    const mean = sum / n;
    return { mean: +mean.toFixed(1), sd: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1), bg: +(bg / n).toFixed(3) };
  }, png);
}
const blank = (s) => s.bg > 0.6 || s.sd < 6;

async function watchScreen(page, untilFn, maxMs, tag) {
  const out = [];
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < maxMs) {
    let png;
    try {
      png = await page.screenshot({ encoding: "base64", type: "png" });
    } catch {
      break;
    }
    const st = await stats(png);
    const state = await page.evaluate(() => ({ ready: !!window.__worldReady, poster: window.__worldPoster ? window.__worldPoster().layerShown : null })).catch(() => ({}));
    out.push({ t: Date.now() - t0, ...st, ...state, blank: blank(st) });
    if (blank(st) || i % 6 === 0) fs.writeFileSync(path.join(OUT, `${tag}-${String(i).padStart(2, "0")}.png`), Buffer.from(png, "base64"));
    i++;
    if (await untilFn().catch(() => false)) break;
    await sleep(250);
  }
  return out;
}

/** A steady wheel scroll through the route, sampling the governor. */
async function scrollRoute(page, seconds, from = 0, to = 1) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const y0 = total * from;
  const y1 = total * to;
  await page.evaluate((y) => window.scrollTo({ top: y, left: 0, behavior: "instant" }), y0);
  await page.mouse.move(VW / 2, VH / 2);
  const steps = [];
  const t0 = Date.now();
  let last = "";
  let y = y0;
  const perTick = ((y1 - y0) / (seconds * 1000)) * 100;
  while (Date.now() - t0 < seconds * 1000 && y < y1 - 1) {
    await page.mouse.wheel({ deltaY: perTick });
    y += perTick;
    const q = await page.evaluate(() => {
      const i = window.__worldV6Debug?.qualityInfo();
      return i ? { last: String(i.report.last ?? ""), tier: i.quality.tier, pr: i.pixelRatio, avg: i.governor?.avgMs ?? 0, poster: i.poster.reason } : null;
    });
    if (q && q.last !== last) {
      last = q.last;
      steps.push({ t: +((Date.now() - t0) / 1000).toFixed(1), ...q });
    }
    await sleep(100);
  }
  return steps;
}

async function frameIntervals(page, ms) {
  return page.evaluate(
    (dur) =>
      new Promise((resolve) => {
        const out = [];
        let prev = performance.now();
        const t0 = prev;
        const step = (now) => {
          out.push(now - prev);
          prev = now;
          if (now - t0 < dur) requestAnimationFrame(step);
          else resolve(out.slice(1));
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
}
const pctl = (arr, q) => {
  const s = arr.slice().sort((a, b) => a - b);
  return s.length ? +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1) : 0;
};

async function inputDelays(page) {
  return page.evaluate(() => {
    const e = (window.__evTiming || []).slice();
    window.__evTiming = [];
    return e;
  });
}

async function posterChecks(page, tag) {
  // Scroll through three stretches in poster mode; shots mid crossfade and at stops.
  const res = { shots: [], markers: [], park: null };
  const stops = await page.evaluate(() => ["a1", "a2", "a3"].map((id) => ({ id, y: window.__worldScrollFor(window.__worldDepthFor(id)) })));
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const prevY = i ? stops[i - 1].y : 0;
    for (const [lab, y] of [
      [`mid${i}`, (prevY + s.y) / 2],
      [`at-${s.id}`, s.y],
    ]) {
      await page.evaluate((yy) => window.scrollTo({ top: yy, left: 0, behavior: "instant" }), y);
      await sleep(900);
      const png = await page.screenshot({ encoding: "base64", type: "png" });
      const st = await stats(png);
      const file = `${tag}-poster-${lab}.png`;
      fs.writeFileSync(path.join(OUT, file), Buffer.from(png, "base64"));
      const ps = await page.evaluate(() => window.__worldPoster());
      const labels = await page.evaluate(() => window.__worldLabelBoxes?.() ?? []);
      res.shots.push({ lab, file, ...st, blank: blank(st), shown: ps.shown.filter((x) => x.opacity > 0).map((x) => `${x.id}:${x.opacity.toFixed(2)}`) });
      res.markers.push({ lab, labels: labels.map((l) => l.id) });
    }
  }
  // Open a place from its label, then close it with Escape.
  const parkId = "a2";
  await page.evaluate((id) => window.__worldPark(id), parkId);
  await sleep(1800);
  const opened = await page.evaluate(() => ({ panel: !!document.querySelector('[aria-labelledby="v4-panel-title"] h2'), parked: window.__worldFrame?.parkedId ?? null, progress: window.__worldFrame?.parkProgress ?? 0 }));
  const png = await page.screenshot({ encoding: "base64", type: "png" });
  fs.writeFileSync(path.join(OUT, `${tag}-poster-park.png`), Buffer.from(png, "base64"));
  await page.keyboard.press("Escape");
  await sleep(1800);
  const closed = await page.evaluate(() => ({ panel: !!document.querySelector('[aria-labelledby="v4-panel-title"] h2'), parked: window.__worldFrame?.parkedId ?? null }));
  res.park = { opened, closed, shot: `${tag}-poster-park.png` };
  return res;
}

/** The poster notice as the student sees it: its text and whether it has a button. */
const noticeOf = (page) =>
  page.evaluate(() => {
    const n = document.querySelector("[data-poster-kind]");
    if (!n) return null;
    const b = n.querySelector("button");
    return { kind: n.getAttribute("data-poster-kind"), text: (n.firstChild?.textContent || "").trim(), button: b ? b.textContent.trim() : null, dev: !n.getAttribute("role") };
  });

async function newPage(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 300));
  });
  await page.evaluateOnNewDocument(() => {
    window.__evTiming = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__evTiming.push({ name: e.name, delay: +(e.processingStart - e.startTime).toFixed(1), dur: e.duration });
      }).observe({ type: "event", durationThreshold: 16, buffered: true });
    } catch {}
    window.__longTasks = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__longTasks.push(+e.duration.toFixed(0));
      }).observe({ type: "longtask", buffered: true });
    } catch {}
  });
  return { ctx, page, errors };
}

async function runGpu(browser, factor) {
  const tag = `x${factor}`;
  const { ctx, page, errors } = await newPage(browser);
  const run = { factor, tag };
  const t0 = Date.now();
  await page.goto(`${URL0}?slowgpu=${factor}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  // The load and the handover, every 250 ms until 2.5 s after ready.
  let readyAt = 0;
  run.loadScreens = await watchScreen(
    page,
    async () => {
      const r = await page.evaluate(() => !!window.__worldReady);
      if (r && !readyAt) readyAt = Date.now();
      return readyAt && Date.now() - readyAt > 2500;
    },
    90000,
    `${tag}-load`,
  );
  run.readyMs = readyAt ? readyAt - t0 : null;
  const q = await page.evaluate(() => window.__worldV6Debug.qualityInfo());
  run.load = {
    gpu: q.report.gpu,
    pick: q.report.pick,
    slowGpu: q.report.slowGpu,
    probe: q.report.probe,
    refine: q.report.refine,
    probe3: q.report.probe3 ?? null,
    tier: q.quality.tier,
    pixelRatio: q.pixelRatio,
    poster: q.poster.reason,
    programs: q.programs,
    warm: q.report.warm,
    readyMsInPage: q.report.readyMs,
  };
  log(tag, "ready", run.readyMs, "ms; tier", q.quality.tier, "pr", q.pixelRatio, "poster", q.poster.reason, "sim", JSON.stringify(q.report.slowGpu));

  if (factor === 1) {
    // Every tier at three stops: no program may appear after the load.
    const before = q.programs;
    const seen = [];
    for (const tier of [1, 2, 3, 0]) {
      await page.evaluate((t) => window.__worldV6Debug.setQualityTier(t), tier);
      for (const id of ["a2", "a5", "a7"]) {
        await page.evaluate((i) => {
          const d = window.__worldDepthFor(i);
          window.scrollTo({ top: window.__worldScrollFor(d), left: 0, behavior: "instant" });
          window.__worldV6Debug.seedDepth(d);
        }, id);
        await sleep(700);
        const n = await page.evaluate(() => window.__worldV6Debug.qualityInfo().programs);
        seen.push({ tier, id, programs: n });
      }
    }
    await page.evaluate(() => window.__worldV6Debug.setQualityTier(null));
    run.tierSwitch = { before, seen, newPrograms: Math.max(...seen.map((x) => x.programs)) - before };
    log(tag, "tier switch: programs", before, "->", Math.max(...seen.map((x) => x.programs)));
    const lights = await page.evaluate(() => {
      let n = 0;
      let hidden = 0;
      window.__worldV6Debug.debugScene().traverse((o) => {
        if (o.isLight) {
          n++;
          if (!o.visible) hidden++;
        }
      });
      return { lights: n, hidden };
    });
    run.lights = lights;
  }

  // The route, scrolled with the wheel as a student would.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await sleep(500);
  await inputDelays(page);
  const fi = frameIntervals(page, SCROLL_S * 1000);
  run.governor = await scrollRoute(page, SCROLL_S);
  const iv = await fi;
  run.scroll = { frames: iv.length, p50: pctl(iv, 0.5), p95: pctl(iv, 0.95), p99: pctl(iv, 0.99), max: +Math.max(...iv).toFixed(1) };
  const ev = await inputDelays(page);
  const wheel = ev.filter((e) => e.name === "wheel" || e.name === "pointermove" || e.name === "mousemove");
  run.input = { events: wheel.length, delayP95: pctl(wheel.map((e) => e.delay), 0.95), delayMax: wheel.length ? Math.max(...wheel.map((e) => e.delay)) : 0, durP95: pctl(wheel.map((e) => e.dur), 0.95) };
  // Rest: a pending step (or the poster verdict) is applied now. Watch the screen through it.
  run.restScreens = await watchScreen(page, async () => false, 4000, `${tag}-rest`);
  const q2 = await page.evaluate(() => window.__worldV6Debug.qualityInfo());
  run.after = { tier: q2.quality.tier, pixelRatio: q2.pixelRatio, poster: q2.poster.reason, posterKind: q2.poster.kind, programs: q2.programs, governor: q2.governor, restCheck: q2.report.restCheck ?? null };
  run.notice = await noticeOf(page);
  log(tag, "after scroll: tier", q2.quality.tier, "pr", q2.pixelRatio, "poster", q2.poster.reason, "frames p50/p95", run.scroll.p50, run.scroll.p95, "input delay p95", run.input.delayP95);
  if (q2.poster.reason) run.posterMode = await posterChecks(page, tag);
  run.stored = await page.evaluate(() => {
    try {
      return { tier: localStorage.getItem("world-v6-tier"), poster: localStorage.getItem("world-v6-poster") };
    } catch {
      return null;
    }
  });
  run.longTasks = await page.evaluate(() => window.__longTasks.slice().sort((a, b) => b - a).slice(0, 5));
  run.blankLoad = run.loadScreens.filter((s) => s.blank).length;
  run.blankRest = run.restScreens.filter((s) => s.blank).length;
  run.errors = errors;
  await ctx.close();
  return run;
}

async function runNoGpu(kind) {
  const args =
    kind === "nogl"
      ? [...GPU_ARGS, "--disable-webgl", "--disable-3d-apis"]
      : ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--hide-scrollbars"];
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args });
  try {
    const { page, errors } = await newPage(browser);
    const run = { factor: kind, tag: kind };
    const t0 = Date.now();
    await page.goto(URL0, { waitUntil: "domcontentloaded", timeout: 60000 });
    let readyAt = 0;
    run.loadScreens = await watchScreen(
      page,
      async () => {
        const r = await page.evaluate(() => !!window.__worldReady);
        if (r && !readyAt) readyAt = Date.now();
        return readyAt && Date.now() - readyAt > 1500;
      },
      60000,
      `${kind}-load`,
    );
    run.readyMs = readyAt ? readyAt - t0 : null;
    const ps = await page.evaluate(() => (window.__worldPoster ? window.__worldPoster() : null));
    run.poster = ps;
    run.notice = await noticeOf(page);
    run.view = await page.evaluate(() => window.__worldView);
    log(kind, "ready", run.readyMs, "view", run.view, "poster", ps?.reason);
    if (ps?.on) run.posterMode = await posterChecks(page, kind);
    run.blankLoad = run.loadScreens.filter((s) => s.blank).length;
    run.errors = errors;
    return run;
  } finally {
    await browser.close();
  }
}

/** The report's quality fields that the adaptation checks read. */
const qsnap = (page) =>
  page.evaluate(() => {
    const q = window.__worldV6Debug.qualityInfo();
    const r = q.report;
    let stored = null;
    let storedPoster = null;
    try {
      stored = localStorage.getItem("world-v6-tier");
      storedPoster = localStorage.getItem("world-v6-poster");
    } catch {}
    return {
      tier: q.quality.tier,
      pixelRatio: q.pixelRatio,
      pick: r.pick,
      recalled: r.recalled,
      probe: r.probe ?? null,
      refine: r.refine ?? null,
      recheck: r.recheck ?? null,
      probe3: r.probe3 ?? null,
      probe3Check: r.probe3Check ?? null,
      coldStall: r.coldStall ?? null,
      restCheck: r.restCheck ?? null,
      notRemembered: r.notRemembered ?? null,
      last: r.last ?? null,
      poster: q.poster,
      storedTier: stored,
      storedPoster,
      programs: q.programs,
    };
  });

async function waitReadyAt(page, t0, limit = 60000) {
  for (;;) {
    if (await page.evaluate(() => !!window.__worldReady).catch(() => false)) return Date.now() - t0;
    if (Date.now() - t0 > limit) return null;
    await sleep(150);
  }
}

/** A cold first frame (or two) at load: what the probe decided, then a rest. */
async function runCold(browser, frames) {
  const tag = `cold${COLD_MS}x${frames}`;
  const { ctx, page, errors } = await newPage(browser);
  const run = { factor: tag, tag, coldMs: COLD_MS, frames };
  const t0 = Date.now();
  await page.goto(`${URL0}?coldstall=${COLD_MS}&coldframes=${frames}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  run.readyMs = await waitReadyAt(page, t0);
  run.atReady = await qsnap(page);
  await page.screenshot({ path: path.join(OUT, `${tag}-ready.png`) });
  // Rest: no input, the camera at the opening. The rest check may climb.
  await sleep(REST_S * 1000);
  run.afterRest = await qsnap(page);
  await page.screenshot({ path: path.join(OUT, `${tag}-rest.png`) });
  run.errors = errors;
  const p = run.atReady.probe || {};
  if (frames === 1) {
    run.pass = !p.capped && run.atReady.tier === run.atReady.pick && !run.atReady.poster.on;
    run.check = `only the cold frame slowed: probe cold ${p.cold} ms, warm ${p.first} ms, fastest ${p.ms} ms, capped ${p.capped}; tier ${run.atReady.pick} -> ${run.atReady.tier}; must stay at the pick`;
  } else {
    run.pass = !!p.capped && !run.atReady.poster.on && run.afterRest.tier < 3;
    run.check = `cold and warm frames slowed: probe capped ${p.capped} (cold ${p.cold}, warm ${p.first}); tier at ready ${run.atReady.tier}, after ${REST_S} s at rest ${run.afterRest.tier}; the early stop must fire and the tier must climb back`;
  }
  log(tag, run.pass ? "PASS" : "FAIL", run.check);
  await ctx.close();
  return run;
}

/** A remembered low tier on a machine with headroom: re-probed at load, then the rest check. */
async function runRecheck(browser, seed) {
  const tag = `recheck-t${seed}`;
  const { ctx, page, errors } = await newPage(browser);
  const run = { factor: tag, tag, seed };
  await page.evaluateOnNewDocument((t) => {
    try {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("world-v6-tier", String(t));
        sessionStorage.setItem("seeded", "1");
      }
    } catch {}
  }, seed);
  const t0 = Date.now();
  await page.goto(URL0, { waitUntil: "domcontentloaded", timeout: 60000 });
  run.readyMs = await waitReadyAt(page, t0);
  run.atReady = await qsnap(page);
  await sleep(REST_S * 1000);
  run.afterRest = await qsnap(page);
  await page.screenshot({ path: path.join(OUT, `${tag}-rest.png`) });
  run.errors = errors;
  run.pass = run.atReady.recalled === seed && run.afterRest.tier < seed && String(run.afterRest.tier) === run.afterRest.storedTier;
  run.check = `remembered tier ${run.atReady.recalled}; after the load ${run.atReady.tier} (${run.atReady.refine?.reason ?? "-"}); after ${REST_S} s at rest ${run.afterRest.tier}, stored ${run.afterRest.storedTier}; rest checks ${JSON.stringify(run.afterRest.restCheck?.checks?.map((c) => [c.tier, c.ms, c.predictedUpMs, c.climb]) ?? [])}`;
  log(tag, run.pass ? "PASS" : "FAIL", run.check);
  await ctx.close();
  return run;
}

const hb = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
helper = await hb.newPage();
let failed = false;
try {
  if (ONLY === "sweep") {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: GPU_ARGS, protocolTimeout: 60000 });
    try {
      for (const f of FACTORS) {
        report.runs.push(await runSweepOne(browser, f));
        save();
      }
    } finally {
      await browser.close().catch(() => {});
    }
    report.sweep = sweepVerdict(report.runs);
    save();
    console.log("factor | opening ms | sim x | tier 2 (pr:ms) | tier 3 ms | after load | after scroll+rest | moving ms/frame | rest bursts");
    for (const r of report.sweep.rows) console.log(`x${r.factor} | ${r.opening} | ${r.achieved} | ${r.tier2} | ${r.tier3} | ${r.load} | ${r.final} | ${r.msPerFrame} | ${r.restBursts}`);
    console.log("MONOTONIC", report.sweep.monotonic ? "yes" : "NO", JSON.stringify(report.sweep.violations), "tier inversions", JSON.stringify(report.sweep.tierInversions));
    console.log("openings that are one capped warm frame:", report.sweep.cappedOpenings.join(" "));
    console.log("MONOTONIC BY TIER 3", report.sweep.byTier3.monotonic ? "yes" : "NO", JSON.stringify(report.sweep.byTier3.violations), report.sweep.byTier3.rows.map((r) => `x${r.factor}:${r.t3}=${r.final}`).join(" "));
    if (!report.sweep.monotonic) failed = true;
  }
  if (ONLY === "verdict") {
    // Adapt3: the sweep verdict again from a saved sweep (--out=dir holding its slowgpu.json), no browser run.
    const saved = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    const v = sweepVerdict(saved.runs);
    console.log("MONOTONIC", v.monotonic ? "yes" : "NO", JSON.stringify(v.violations), "tier inversions", JSON.stringify(v.tierInversions));
    console.log("openings that are one capped warm frame:", v.cappedOpenings.join(" "));
    console.log("MONOTONIC BY TIER 3", v.byTier3.monotonic ? "yes" : "NO", JSON.stringify(v.byTier3.violations), v.byTier3.rows.map((r) => `x${r.factor}:${r.t3}=${r.final}`).join(" "));
  }
  if (ONLY === "try") {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: GPU_ARGS, protocolTimeout: 60000 });
    try {
      for (const { factor: f, answer } of TRY_RUNS) {
        report.runs.push(await runTry(browser, f, answer));
        save();
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }
  if (ONLY === "cold" || ONLY === "recheck") {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: GPU_ARGS });
    try {
      if (ONLY === "cold") for (const n of COLD_FRAMES) report.runs.push(await runCold(browser, n));
      else report.runs.push(await runRecheck(browser, SEED_TIER));
      save();
    } finally {
      await browser.close();
    }
  }
  if (!ONLY || ONLY === "gpu") {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: GPU_ARGS });
    try {
      for (const f of FACTORS) {
        const r = await runGpu(browser, f);
        report.runs.push(r);
        save();
      }
    } finally {
      await browser.close();
    }
  }
  if (!ONLY || ONLY === "nogl") {
    report.runs.push(await runNoGpu("nogl"));
    save();
  }
  if (!ONLY || ONLY === "swift") {
    report.runs.push(await runNoGpu("swift"));
    save();
  }
} catch (e) {
  failed = true;
  console.error("v6-slowgpu failed:", e);
} finally {
  await hb.close().catch(() => {});
}
// Summary
for (const r of report.runs) {
  if (ONLY === "sweep") break;
  if (r.check) {
    console.log(`${r.tag}: ${r.pass ? "PASS" : "FAIL"} ${r.check}; ready ${r.readyMs} ms; errors ${r.errors.length}`);
    if (!r.pass) failed = true;
    continue;
  }
  console.log(
    `${r.tag}: ready ${r.readyMs} ms; load tier ${r.load?.tier ?? "-"} (probe ${r.load?.probe?.ms ?? "-"} ms, cold ${r.load?.probe?.cold ?? "-"}, warm ${r.load?.probe?.first ?? "-"}, sim x${r.load?.slowGpu?.achieved ?? "-"}); after scroll tier ${r.after?.tier ?? "-"} pr ${r.after?.pixelRatio ?? "-"}; posters: ${r.after?.poster ?? r.load?.poster ?? r.poster?.reason ?? "no"} (${r.after?.posterKind ?? r.poster?.kind ?? "-"}, try button ${r.notice?.button ?? "-"}); blank frames ${r.blankLoad}/${r.blankRest ?? 0}; input delay p95 ${r.input?.delayP95 ?? "-"} ms; errors ${r.errors.length}`,
  );
}
console.log("SLOWGPU DONE", failed ? "with failures" : "ok");
// Puppeteer leaves a handle open after the browsers close (the script used to
// print this summary and never exit): end the process explicitly.
process.exit(failed ? 1 : 0);
