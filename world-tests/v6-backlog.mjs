/**
 * v6 moving-frame backlog diagnosis (cheap laptops, adapt2, 2026-09-28).
 *
 * Why do moving frames under a slow GPU average 100-166 ms when the steady
 * burst at the same tier is 18-32 ms? This instruments the live loop from the
 * page side (no source change needed): the scene's tick is wrapped, and so are
 * renderer.render and the WebGL calls that can stall the main thread.
 *
 *   node world-tests/v6-backlog.mjs [--factor=10] [--size=1920x1080] [--tiers=1,3]
 *        [--move=wheel|js] [--secs=6] [--headful] [--out=dir] [--tag=name]
 *
 * Per tier (forced with setQualityTier, so the governor stays out of it):
 *   - the steady burst at the opening (perf.burstProbe, 8 renders, 5 repeats);
 *   - a move: `wheel` = CDP wheel events every 100 ms (each guarded by a 5 s
 *     timeout), `js` = the page scrolls itself from a setInterval (no CDP input);
 *   - per scene tick: the rAF interval, the ms inside the tick, main renders
 *     (camera = the scene's) and nested renders (the lake), ms inside render,
 *     WebGL calls that can block (readPixels, finish, getError, get*Parameter,
 *     clientWaitSync, getBufferSubData, checkFramebufferStatus);
 *   - GPU backlog: a fence after every tick that rendered, polled (non-blocking)
 *     at every later tick: frames in flight, and submit-to-signalled latency.
 * Writes <out>/backlog-<tag>.json and prints a summary line per tier.
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
const has = (k) => process.argv.includes(`--${k}`);
const FACTOR = Number(arg("factor", "10"));
const [VW, VH] = arg("size", "1920x1080").split("x").map(Number);
const TIERS = arg("tiers", "1,3").split(",").map((x) => (x === "auto" ? "auto" : Number(x)));
const POLL = !has("nopoll");
const MOVE = arg("move", "wheel");
const SECS = Number(arg("secs", "6"));
const HEADFUL = has("headful");
const SHARE = Number(arg("share", "0.25"));
const QUERY = arg("query", "");
const SEED_TIER = arg("seedtier", "");
const NO_PACER = has("nopacer");
const OUT = path.resolve(arg("out", path.join(HERE, "shots/v6/cheap/adapt2/backlog")));
const TAG = arg("tag", `x${FACTOR}-${MOVE}${HEADFUL ? "-headful" : ""}-${VW}x${VH}`);
fs.mkdirSync(OUT, { recursive: true });
const URL0 = `http://localhost:3111/dev/world-v6${FACTOR > 1 ? `?slowgpu=${FACTOR}` : "?"}${QUERY ? "&" + QUERY : ""}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const GPU_ARGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms))]);

const INSTALL = () => {
  const sc = window.__worldV6Debug;
  const r = sc.renderer;
  const gl = r.getContext();
  const S = (window.__bk = { on: false, ticks: [], cur: null, fences: [], lastTs: 0 });
  const origRender = r.render.bind(r);
  r.render = function (scene, cam) {
    const t0 = performance.now();
    const out = origRender(scene, cam);
    const dt = performance.now() - t0;
    if (S.cur) {
      if (cam === sc.camera) {
        S.cur.main++;
        S.cur.mainMs += dt;
      } else S.cur.nested++;
    }
    return out;
  };
  const WATCH = ["readPixels", "finish", "flush", "getError", "getParameter", "getProgramParameter", "getShaderParameter", "getSyncParameter", "clientWaitSync", "getBufferSubData", "checkFramebufferStatus", "getQueryParameter", "fenceSync"];
  for (const k of WATCH) {
    const f = gl[k];
    if (typeof f !== "function") continue;
    gl[k] = function (...a) {
      const t0 = performance.now();
      const res = f.apply(gl, a);
      if (S.cur && !S.inFence) {
        const e = (S.cur.gl[k] ||= { n: 0, ms: 0 });
        e.n++;
        e.ms += performance.now() - t0;
      }
      return res;
    };
  }
  const origTick = sc.tick;
  sc.tick = (now) => {
    if (!S.on) return origTick(now);
    const start = performance.now();
    // Poll earlier fences (non-blocking; WebGL updates sync status between tasks).
    S.inFence = true;
    for (let i = S.fences.length - 1; i >= 0; i--) {
      const f = S.fences[i];
      if (gl.getSyncParameter(f.s, gl.SYNC_STATUS) === gl.SIGNALED) {
        S.ticks[f.idx].doneAt = start;
        S.ticks[f.idx].latency = start - f.at;
        gl.deleteSync(f.s);
        S.fences.splice(i, 1);
      }
    }
    S.inFence = false;
    S.cur = { ts: now, interval: S.lastTs ? now - S.lastTs : 0, start, main: 0, nested: 0, mainMs: 0, gl: {}, inFlightBefore: S.fences.length };
    S.lastTs = now;
    let res;
    try {
      res = origTick(now);
    } finally {
      const c = S.cur;
      c.tickMs = performance.now() - start;
      const last = String(sc.qualityReport?.last ?? "");
      if (last !== S.lastStep) {
        S.lastStep = last;
        c.step = last;
      }
      c.tier = sc.quality?.tier;
      c.pr = r.getPixelRatio();
      S.cur = null;
      const idx = S.ticks.push(c) - 1;
      if (c.main > 0) {
        S.inFence = true;
        const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        S.inFence = false;
        S.fences.push({ s, at: performance.now(), idx });
      }
    }
    return res;
  };
  return { ok: true, webgl2: typeof gl.fenceSync === "function" };
};

const SUMMARISE = () => {
  const S = window.__bk;
  const t = S.ticks.filter((x) => x.main > 0);
  const q = (arr, p) => {
    const s = arr.slice().sort((a, b) => a - b);
    return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : null;
  };
  const avg = (arr) => (arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null);
  const iv = t.map((x) => x.interval).filter((x) => x > 0);
  const glTot = {};
  for (const x of S.ticks) for (const [k, v] of Object.entries(x.gl)) {
    const e = (glTot[k] ||= { n: 0, ms: 0 });
    e.n += v.n;
    e.ms += v.ms;
  }
  for (const e of Object.values(glTot)) e.ms = +e.ms.toFixed(1);
  const lat = t.map((x) => x.latency).filter((x) => x !== undefined);
  const t0 = S.ticks.length ? S.ticks[0].start : 0;
  const win = [];
  for (const x of S.ticks) {
    const k = Math.floor((x.start - t0) / 500);
    const w = (win[k] ||= { at: k * 0.5, n: 0, iv: 0, tick: 0, inflight: 0, lat: [], steps: [], tier: x.tier, pr: x.pr });
    w.n++;
    if (x.main > 0) w.drawn = (w.drawn || 0) + 1;
    w.iv += x.interval;
    w.tick = Math.max(w.tick, +x.tickMs.toFixed(1));
    w.inflight = Math.max(w.inflight, x.inFlightBefore);
    if (x.latency !== undefined) w.lat.push(x.latency);
    if (x.step) w.steps.push(x.step);
    w.tier = x.tier;
    w.pr = x.pr;
  }
  const timeline = win.filter(Boolean).map((w) => ({ at: w.at, frames: w.n, drawn: w.drawn || 0, msPerDrawn: w.drawn ? +(500 / w.drawn).toFixed(1) : null, avgIv: +(w.iv / w.n).toFixed(1), maxTick: w.tick, maxInFlight: w.inflight, lat: w.lat.length ? +(w.lat.reduce((a, b) => a + b, 0) / w.lat.length).toFixed(0) : null, tier: w.tier, pr: w.pr, steps: w.steps }));
  return {
    ticks: S.ticks.length,
    drawn: t.length,
    interval: { avg: avg(iv), p50: q(iv, 0.5), p95: q(iv, 0.95), max: iv.length ? +Math.max(...iv).toFixed(1) : null },
    tickMs: { avg: avg(t.map((x) => x.tickMs)), p95: q(t.map((x) => x.tickMs), 0.95), max: t.length ? +Math.max(...t.map((x) => x.tickMs)).toFixed(1) : null },
    renderMs: { avg: avg(t.map((x) => x.mainMs)), p95: q(t.map((x) => x.mainMs), 0.95), max: t.length ? +Math.max(...t.map((x) => x.mainMs)).toFixed(1) : null },
    mainPerTick: { max: Math.max(0, ...S.ticks.map((x) => x.main)), multi: S.ticks.filter((x) => x.main > 1).length },
    nestedPerTick: { avg: avg(t.map((x) => x.nested)), max: Math.max(0, ...S.ticks.map((x) => x.nested)) },
    inFlight: { avg: avg(t.map((x) => x.inFlightBefore)), p95: q(t.map((x) => x.inFlightBefore), 0.95), max: Math.max(0, ...t.map((x) => x.inFlightBefore)) },
    fenceLatency: { n: lat.length, avg: avg(lat), p50: q(lat, 0.5), p95: q(lat, 0.95), max: lat.length ? +Math.max(...lat).toFixed(1) : null },
    gl: glTot,
    unsignalled: S.fences.length,
    timeline,
  };
};

async function moveWheel(page, secs) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  await page.mouse.move(VW / 2, VH / 2);
  const per = (total * SHARE) / (secs * 10);
  const t0 = Date.now();
  const timeouts = [];
  const callMs = [];
  const pollMs = [];
  while (Date.now() - t0 < secs * 1000) {
    const a = Date.now();
    try {
      await withTimeout(page.mouse.wheel({ deltaY: per }), 5000, "wheel");
    } catch {
      timeouts.push(Date.now() - t0);
    }
    callMs.push(Date.now() - a);
    if (POLL) {
      const b = Date.now();
      await withTimeout(page.evaluate(() => { const i = window.__worldV6Debug.qualityInfo(); return i.quality.tier; }), 5000, "poll").catch(() => timeouts.push("poll"));
      pollMs.push(Date.now() - b);
    }
    await sleep(100);
  }
  return { calls: callMs.length, callMsMax: Math.max(...callMs), callMsAvg: +(callMs.reduce((a, b) => a + b, 0) / callMs.length).toFixed(1), pollMsMax: pollMs.length ? Math.max(...pollMs) : 0, timeouts };
}

async function moveJs(page, secs) {
  return page.evaluate(
    (s) =>
      new Promise((res) => {
        const total = document.documentElement.scrollHeight - innerHeight;
        const per = (total * 0.25) / (s * 60);
        let n = 0;
        const id = setInterval(() => {
          window.scrollBy(0, per);
          if (++n >= s * 60) {
            clearInterval(id);
            res({ steps: n });
          }
        }, 1000 / 60);
      }),
    secs,
  );
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: HEADFUL ? false : "new", args: GPU_ARGS, protocolTimeout: 60000, defaultViewport: null });
const report = { url: URL0, size: `${VW}x${VH}@1`, factor: FACTOR, move: MOVE, headful: HEADFUL, tiers: [] };
try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 1 });
  if (SEED_TIER !== "") {
    // A remembered tier: 0 skips the load probe, so the governor walks the whole ladder while scrolling.
    await page.evaluateOnNewDocument((t) => {
      try {
        localStorage.setItem("world-v6-tier", t);
      } catch {}
    }, SEED_TIER);
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const t0 = Date.now();
  await page.goto(URL0, { waitUntil: "domcontentloaded", timeout: 60000 });
  for (;;) {
    if (await page.evaluate(() => !!window.__worldReady).catch(() => false)) break;
    if (Date.now() - t0 > 60000) throw new Error("not ready in 60 s");
    await sleep(200);
  }
  report.readyMs = Date.now() - t0;
  const q0 = await page.evaluate(() => {
    const i = window.__worldV6Debug.qualityInfo();
    return { tier: i.quality.tier, pr: i.pixelRatio, poster: i.poster.reason, sim: i.report.slowGpu ?? null, gpu: i.report.gpu ?? null };
  });
  report.load = q0;
  log("ready", report.readyMs, "ms", JSON.stringify(q0));
  report.install = await page.evaluate(INSTALL);
  if (NO_PACER) report.pacerOff = await page.evaluate(() => {
    // The frame pacer off, to see the loop alone (the fences the harness adds still measure).
    window.__worldV6Debug.pacer = null;
    return true;
  });
  if (q0.poster) {
    // Keep the 3D for the diagnosis.
    await page.evaluate(() => window.__worldV6Debug.setPoster(false));
  }
  for (const tier of TIERS) {
    await page.evaluate((t) => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      window.__worldV6Debug.seedDepth(0);
      if (t !== "auto") window.__worldV6Debug.setQualityTier(t);
    }, tier);
    await sleep(1500);
    const burst = tier === "auto" ? null : await page.evaluate(() => window.__worldV6Debug.burstProbe(8, 5, 250, 0));
    const pr = await page.evaluate(() => window.__worldV6Debug.qualityInfo().pixelRatio);
    await page.evaluate(() => {
      const S = window.__bk;
      S.ticks = [];
      S.fences = [];
      S.lastTs = 0;
      S.on = true;
    });
    const a = Date.now();
    let move;
    try {
      move = MOVE === "js" ? await withTimeout(moveJs(page, SECS), SECS * 1000 + 30000, "js move") : await moveWheel(page, SECS);
    } catch (e) {
      move = { error: String(e) };
    }
    const wall = Date.now() - a;
    await sleep(600);
    const sum = await withTimeout(
      page.evaluate(() => {
        window.__bk.on = false;
        return null;
      }).then(() => page.evaluate(SUMMARISE)),
      30000,
      "summary",
    ).catch((e) => ({ error: String(e) }));
    const row = { tier, pixelRatio: pr, burst: burst && { ms: burst.ms, med: burst.med, cold: burst.cold }, move, wallMs: wall, loop: sum };
    report.tiers.push(row);
    log(
      `tier ${tier} pr ${pr}: burst ${burst?.ms} ms; moving interval avg ${sum.interval?.avg} p50 ${sum.interval?.p50} p95 ${sum.interval?.p95} max ${sum.interval?.max}; tick ${sum.tickMs?.avg} (max ${sum.tickMs?.max}); render ${sum.renderMs?.avg}; main renders/tick max ${sum.mainPerTick?.max} (multi ${sum.mainPerTick?.multi}); nested/tick ${sum.nestedPerTick?.avg}; in flight avg ${sum.inFlight?.avg} max ${sum.inFlight?.max}; fence latency p50 ${sum.fenceLatency?.p50} p95 ${sum.fenceLatency?.p95}; gl ${JSON.stringify(sum.gl)}; move ${JSON.stringify(move)}`,
    );
    fs.writeFileSync(path.join(OUT, `backlog-${TAG}.json`), JSON.stringify(report, null, 1));
  }
  report.errors = errors;
  await ctx.close();
} catch (e) {
  report.error = String(e);
  console.error("backlog failed:", e);
} finally {
  fs.writeFileSync(path.join(OUT, `backlog-${TAG}.json`), JSON.stringify(report, null, 1));
  await browser.close().catch(() => {});
}
console.log("BACKLOG DONE", path.join(OUT, `backlog-${TAG}.json`));
process.exit(0);
