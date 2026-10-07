/**
 * v6 cheap-laptop bench: load phases, per-position cost and a steady full
 * scroll of /dev/world-v6, under CPU throttling, at laptop screen sizes, at a
 * forced quality tier, or on SwiftShader (the no-GPU case).
 *
 *   node world-tests/v6-bench.mjs [--cpu=1|4|6] [--size=1920x1080@1] [--tier=0|1|2|3|auto]
 *                                 [--lowgpu] [--swiftshader] [--positions=all|stops|none]
 *                                 [--scroll=60] [--tag=name] [--out=dir] [--query=poster=off]
 *   node world-tests/v6-bench.mjs --table [--out=dir]      the summary table of every run in the folder
 *
 * What one run records (fresh browser, fresh profile, so no remembered tier):
 *   load    navigation to first contentful paint (the loading screen), the WebGL
 *           context (the scene chunk arrived and ran), each module's install ms
 *           (moduleStats().install), the warm compile (ms, programs), the load
 *           probe and the tier it picked, __worldReady, and the first world frame
 *           after it. Long tasks on the main thread during load (the longest block
 *           and total blocking time). JS heap after load.
 *   scroll  the whole route at a steady pace (scroll position linear in wall
 *           time over --scroll seconds), on the page's own loop, the first scroll
 *           after load: frame intervals p50 / p95 / p99 / max from the scene's
 *           own ticks, JS ms per tick, frames over 33 and 50 ms and where they
 *           fell, shader programs before and after.
 *   positions  the 8 stops and the strip keys (v6-strip.mjs STRIP_FRAMES), the
 *           page loop paused and ticks driven from here, as v6-perf.mjs does:
 *           burst ms (8 renders, one sync, fastest of 3 after a warm up) with the
 *           CPU submit share of it, JS ms per moving frame (20 frames approaching),
 *           triangles and draw calls with the lake's reflection.
 *
 * --cpu     CDP Emulation.setCPUThrottlingRate, set before navigation, so the page's
 *           parse, module install and every tick run slowed. It slows the page's
 *           main thread only: the GPU process (ANGLE, the driver) and the GPU run at
 *           full speed, so a throttled burst is CPU bound where the CPU is the limit.
 * --tier    forced after load through __worldV6Debug.setQualityTier (the governor is
 *           off while forced). "auto" leaves the pick, the probe and the governor on.
 * --lowgpu  WEBGL_debug_renderer_info reports "Intel(R) UHD Graphics 620" so pickTier
 *           creates the canvas without MSAA, as a real tier 2 or 3 laptop does.
 *           Only the name is faked; the GPU is still the M2 Pro.
 * --swiftshader  Chrome's software WebGL (no GPU): --use-angle=swiftshader. Positions
 *           default to "stops" with one synced frame each, the scroll to 20 s.
 *
 * Output: shots/v6/cheap/baseline/<tag>.json and <tag>.txt.
 * Runs take 2 to 6 minutes: start in the background and poll the .txt.
 *   nohup node world-tests/v6-bench.mjs --cpu=4 --tier=0 > /tmp/bench.log 2>&1 &
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const opt = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const OUT = opt.out ? path.resolve(String(opt.out)) : path.join(HERE, "shots/v6/cheap/baseline");
fs.mkdirSync(OUT, { recursive: true });

// ── The table of every run ────────────────────────────────────────────────
if (opt.table) {
  const runs = fs
    .readdirSync(OUT)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")))
    .filter((r) => r && r.kind === "v6-bench")
    .sort((a, b) => (a.opts.swiftshader - b.opts.swiftshader) || a.opts.W - b.opts.W || String(a.opts.tier).localeCompare(String(b.opts.tier)) || a.opts.cpu - b.opts.cpu);
  const L = [];
  const f1 = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : (+v).toFixed(d));
  L.push("v6 cheap-laptop bench, every run in " + OUT);
  L.push("");
  L.push("LOAD (ms from navigation)");
  L.push(["run".padEnd(34), "FCP", "ctx", "install", "warm", "progs", "probe", "ready", "1st frame", "longest task", "TBT"].join("\t"));
  for (const r of runs) {
    const l = r.load || {};
    L.push([r.tag.padEnd(34), f1(l.fcp, 0), f1(l.context, 0), f1(l.installSum, 0), f1(l.warmMs, 0), l.programsAfterWarm ?? "-", f1(l.probeTook, 0), f1(l.ready, 0), f1(l.firstFrame, 0), f1(l.longestTask, 0), f1(l.tbt, 0)].join("\t"));
  }
  L.push("");
  L.push("SCROLL (the first full scroll after load, steady pace; frame interval ms)");
  L.push(["run".padEnd(34), "frames", "p50", "p95", "p99", "max", "@key", ">33ms", ">50ms", "tick p50", "tick p95", "tick max", "new progs"].join("\t"));
  for (const r of runs) {
    const s = r.scroll;
    if (!s || s.skipped) continue;
    L.push([r.tag.padEnd(34), s.frames, f1(s.interval.p50), f1(s.interval.p95), f1(s.interval.p99), f1(s.interval.max), s.worst?.[0]?.key ?? "-", s.over33, s.over50, f1(s.tick.p50, 2), f1(s.tick.p95, 2), f1(s.tick.max, 1), s.newPrograms].join("\t"));
  }
  L.push("");
  L.push("POSITIONS (burst ms per frame = max(CPU submit, GPU); worst over the route and where)");
  L.push(["run".padEnd(34), "n", "burst worst", "@", "burst k0", "worst/k0", "submit worst", "js/move worst", "@", "tris max", "calls max"].join("\t"));
  for (const r of runs) {
    const p = r.positions?.rows || [];
    if (!p.length) continue;
    const bw = p.reduce((a, b) => ((b.burst?.ms ?? -1) > (a.burst?.ms ?? -1) ? b : a), p[0]);
    const sw = p.reduce((a, b) => ((b.burst?.submit ?? -1) > (a.burst?.submit ?? -1) ? b : a), p[0]);
    const jw = p.reduce((a, b) => ((b.moving?.cpu ?? -1) > (a.moving?.cpu ?? -1) ? b : a), p[0]);
    const k0 = p.find((x) => x.id === "k0");
    L.push([r.tag.padEnd(34), p.length, f1(bw.burst?.ms, 2), bw.id, f1(k0?.burst?.ms, 2), k0 ? f1(bw.burst.ms / k0.burst.ms, 2) : "-", f1(sw.burst?.submit, 2), f1(jw.moving?.cpu, 2), jw.id, Math.max(...p.map((x) => x.counts?.tris ?? 0)), Math.max(...p.map((x) => x.counts?.calls ?? 0))].join("\t"));
  }
  fs.writeFileSync(path.join(OUT, "table.txt"), L.join("\n") + "\n");
  console.log(L.join("\n"));
  process.exit(0);
}

// ── Options ────────────────────────────────────────────────────────────────
const BASE = process.env.BASE_URL || "http://localhost:3111";
const cpu = Number(opt.cpu ?? 1);
const sizeM = String(opt.size ?? "1920x1080@1").match(/^(\d+)x(\d+)(?:@([\d.]+))?$/);
if (!sizeM) throw new Error("--size wants WxH@dpr");
const W = +sizeM[1], H = +sizeM[2], DPR = +(sizeM[3] ?? 1);
const swift = !!opt.swiftshader;
const tierOpt = opt.tier === undefined ? (swift ? "auto" : "0") : String(opt.tier);
const tier = tierOpt === "auto" ? "auto" : Math.max(0, Math.min(3, Math.round(Number(tierOpt))));
const lowgpu = !!opt.lowgpu;
const posMode = String(opt.positions ?? (swift ? "stops" : "all"));
const scrollS = Number(opt.scroll ?? (swift ? 20 : 60));
const tag = String(opt.tag ?? `${swift ? "swiftshader" : "gpu"}-cpu${cpu}x-${W}x${H}@${DPR}-tier${tier}${lowgpu ? "-lowgpu" : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Page query. SwiftShader now goes straight to the posters and never builds the 3D, so a
// --swiftshader run forces the 3D with ?poster=off to measure it like for like. --query=a=b&c=d overrides.
const QUERY = opt.query ? "?" + String(opt.query) : swift ? "?poster=off" : "";

const GPU_ARGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"];
const SWIFT_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--hide-scrollbars"];
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: swift ? SWIFT_ARGS : GPU_ARGS,
  protocolTimeout: 120000,
});
const lines = [];
const say = (s) => {
  lines.push(s);
  console.log(s);
};
const result = { kind: "v6-bench", tag, when: new Date().toISOString(), opts: { cpu, W, H, DPR, tier, lowgpu, swiftshader: swift, posMode, scrollS }, errors: [], apiCalls: [] };
const save = () => {
  fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(result, null, 1));
  fs.writeFileSync(path.join(OUT, `${tag}.txt`), lines.join("\n") + "\n");
};

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => result.errors.push("pageerror " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") result.errors.push(m.text().slice(0, 300));
  });
  page.on("request", (r) => {
    try {
      if (new URL(r.url()).pathname.startsWith("/api")) result.apiCalls.push(r.url());
    } catch {}
  });
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });

  // Hooks installed before any page script: load marks, long tasks, and (--lowgpu) the GPU name.
  await page.evaluateOnNewDocument((lowgpu) => {
    const T = (window.__bench = { t: {}, longTasks: [], realGpu: null });
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) T.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]);
      }).observe({ type: "longtask", buffered: true });
    } catch {}
    let ready;
    Object.defineProperty(window, "__worldReady", {
      configurable: true,
      get: () => ready,
      set: (v) => {
        ready = v;
        if (v && T.t.ready === undefined) {
          T.t.ready = performance.now();
          const f0 = window.__worldFrameCount ?? 0;
          const wait = () => {
            if ((window.__worldFrameCount ?? 0) > f0) T.t.firstFrame = performance.now();
            else requestAnimationFrame(wait);
          };
          requestAnimationFrame(wait);
        }
      },
    });
    const gc = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      const ctx = gc.call(this, type, attrs);
      if (ctx && /webgl/.test(String(type)) && !(this.width <= 1 && this.height <= 1) && T.t.context === undefined) {
        T.t.context = performance.now();
        T.antialias = ctx.getContextAttributes?.()?.antialias ?? null;
      }
      return ctx;
    };
    const RENDERER = 0x9246;
    for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!P) continue;
      const gp = P.prototype.getParameter;
      P.prototype.getParameter = function (p) {
        const v = gp.call(this, p);
        if (p === RENDERER) {
          if (!T.realGpu) T.realGpu = v;
          if (lowgpu) return "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)";
        }
        return v;
      };
    }
  }, lowgpu);

  if (cpu !== 1) await page.emulateCPUThrottling(cpu);
  const t0 = Date.now();
  await page.goto(`${BASE}/dev/world-v6${QUERY}`, { waitUntil: "domcontentloaded", timeout: 110000 });
  // Poll from here with short calls (a throttled or software page blocks its main thread for seconds).
  let state = null;
  while (Date.now() - t0 < 600000) {
    state = await page.evaluate(() => (window.__worldReady ? "ready" : window.__worldError ? "error: " + window.__worldError : null)).catch(() => null);
    if (state) break;
    await sleep(250);
  }
  if (state !== "ready") throw new Error("the world never got ready: " + state);
  // Let the first world frame and the loading screen's fade land.
  for (let i = 0; i < 40; i++) {
    const ff = await page.evaluate(() => window.__bench.t.firstFrame);
    if (ff !== undefined) break;
    await sleep(100);
  }
  await sleep(swift ? 1500 : 600);

  const load = await page.evaluate(() => {
    const B = window.__bench;
    const sc = window.__worldV6Debug;
    const q = sc.qualityInfo();
    const st = sc.moduleStats();
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const scripts = performance.getEntriesByType("resource").filter((e) => e.initiatorType === "script" || /\.js(\?|$)/.test(e.name));
    const installs = Object.fromEntries(Object.entries(st.install).filter(([, v]) => typeof v === "number"));
    const installSum = Object.values(installs).reduce((a, b) => a + b, 0);
    const lt = B.longTasks.filter(([s]) => s <= (B.t.firstFrame ?? B.t.ready ?? Infinity) + 50);
    const warm = q.report?.warm;
    return {
      gpuReported: q.report?.gpu ?? null,
      gpuReal: B.realGpu,
      antialias: B.antialias,
      pick: q.report?.pick,
      pickReason: q.report?.pickReason,
      probe: q.report?.probe ?? null,
      refine: q.report?.refine ?? null,
      tierAfterLoad: q.quality?.tier,
      pixelRatioAfterLoad: q.pixelRatio,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      fcp: fcp ? Math.round(fcp.startTime) : null,
      context: B.t.context !== undefined ? Math.round(B.t.context) : null,
      installs,
      installSum,
      warmMs: typeof warm === "object" && warm ? warm.ms : null,
      warm,
      programsAfterWarm: typeof warm === "object" && warm ? warm.programsAfter : null,
      probeTook: q.report?.probe?.took ?? null,
      ready: B.t.ready !== undefined ? Math.round(B.t.ready) : null,
      firstFrame: B.t.firstFrame !== undefined ? Math.round(B.t.firstFrame) : null,
      longestTask: lt.reduce((a, [, d]) => Math.max(a, d), 0),
      tbt: lt.reduce((a, [, d]) => a + Math.max(0, d - 50), 0),
      longTasksOver200: lt.filter(([, d]) => d > 200),
      jsKB: Math.round(scripts.reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0) / 1024),
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      programs: sc.renderer.info.programs.length,
      drawingBuffer: [sc.renderer.getContext().drawingBufferWidth, sc.renderer.getContext().drawingBufferHeight],
      nKeys: sc.ctx?.layout?.TRAIL?.length ?? sc.ctx?.layout?.KEYS?.length ?? null,
    };
  });
  result.load = load;
  save();
  say(`v6-bench ${tag}`);
  say(`  gpu ${load.gpuReal}${lowgpu ? `  (reported to the page as: ${load.gpuReported})` : ""}  canvas MSAA ${load.antialias}  cpu throttle ${cpu}x  ${W}x${H}@${DPR}`);
  say(`  pick tier ${load.pick} (${load.pickReason}); probe ${load.probe ? load.probe.ms + " ms, took " + load.probe.took + " ms" : "skipped"}; refine: ${load.refine ? load.refine.reason : "-"}; tier after load ${load.tierAfterLoad} at pixel ratio ${load.pixelRatioAfterLoad}, buffer ${load.drawingBuffer.join("x")}`);
  say(`  load: FCP ${load.fcp} ms, WebGL context ${load.context} ms, modules installed in ${load.installSum} ms, warm compile ${load.warmMs} ms (${load.programsAfterWarm} programs), probe ${load.probeTook ?? "-"} ms, __worldReady ${load.ready} ms, first world frame ${load.firstFrame} ms`);
  say(`  main thread during load: longest task ${load.longestTask} ms, total blocking ${load.tbt} ms, ${load.longTasksOver200.length} tasks over 200 ms; JS ${load.jsKB} KB (dev build); heap ${load.heapMB} MB`);
  say(`  installs: ${Object.entries(load.installs).map(([k, v]) => `${k} ${v}`).join(", ")}`);

  // Force the tier (governor off) or leave it on auto.
  if (tier !== "auto") {
    await page.evaluate((t) => window.__worldV6Debug.setQualityTier(t), tier);
    await sleep(400);
  }
  result.qualityStart = await page.evaluate(() => {
    const q = window.__worldV6Debug.qualityInfo();
    return { tier: q.quality.tier, pixelRatio: q.pixelRatio, override: q.override, governor: q.governor };
  });
  say(`  measuring at tier ${result.qualityStart.tier}, pixel ratio ${result.qualityStart.pixelRatio}${result.qualityStart.override === null ? " (auto: governor on)" : " (forced: governor off)"}`);
  save();

  // ── The scroll: the first full scroll after load, on the page's own loop ──
  if (scrollS > 0) {
    await page.evaluate((seconds) => {
      const sc = window.__worldV6Debug;
      const r = sc.renderer;
      const nKeys = sc.ctx?.layout?.TRAIL?.length ?? sc.ctx?.layout?.KEYS?.length ?? 86;
      const S = (window.__benchScroll = { done: false, frames: [], gov: [], programs0: r.info.programs.length, endY: sc.scrollYForDepth(sc.depthMax), longTasks0: window.__bench.longTasks.length });
      const orig = sc.tick;
      let lastNow = null;
      sc.tick = (now) => {
        // Only frames where the camera moves count: the driver is scrolling, or the
        // camera is still catching up after the last scroll. Settled frames run at the
        // idle ladder's ambient rate (30 fps at tier 0) and are not stutter.
        const catchingUp = Math.abs(sc.targetDepth - sc.currentDepth) > 1e-7;
        const a = performance.now();
        const p0 = r.info.programs.length;
        orig(now);
        const b = performance.now();
        if (S.running && (S.driving || catchingUp)) {
          S.frames.push([+(lastNow === null ? 0 : now - lastNow).toFixed(2), +(b - a).toFixed(2), +(sc.railU() * (nKeys - 1)).toFixed(2), r.info.programs.length - p0, +r.getPixelRatio().toFixed(2)]);
          lastNow = now;
        }
      };
      S.restore = () => {
        sc.tick = orig;
      };
      window.scrollTo(0, 0);
      const start = performance.now() + 300;
      const step = () => {
        const now = performance.now();
        if (now < start) return requestAnimationFrame(step);
        S.running = true;
        const u = Math.min(1, (now - start) / (seconds * 1000));
        S.driving = u < 1;
        window.scrollTo(0, Math.round(u * S.endY));
        if (u < 1) requestAnimationFrame(step);
        else
          setTimeout(() => {
            S.running = false;
            S.done = true;
            S.programs1 = r.info.programs.length;
          }, 1500);
      };
      requestAnimationFrame(step);
    }, scrollS);
    const tS = Date.now();
    while (Date.now() - tS < (scrollS + 120) * 1000) {
      await sleep(1000);
      const done = await page.evaluate(() => window.__benchScroll.done).catch(() => false);
      if (done) break;
    }
    const sc = await page.evaluate(() => {
      const S = window.__benchScroll;
      S.restore();
      const fr = S.frames.slice(1); // the first tick has no interval
      const iv = fr.map((f) => f[0]).sort((a, b) => a - b);
      const tk = fr.map((f) => f[1]).sort((a, b) => a - b);
      const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
      const worst = fr
        .slice()
        .sort((a, b) => b[0] - a[0])
        .slice(0, 8)
        .map((f) => ({ interval: f[0], tick: f[1], key: f[2], newPrograms: f[3], pr: f[4] }));
      const q = window.__worldV6Debug.qualityInfo();
      const lt = window.__bench.longTasks.slice(S.longTasks0);
      // Mean interval per key band (5 keys wide), to see where the route is slow.
      const bands = {};
      for (const f of fr) {
        const b = Math.floor(f[2] / 5) * 5;
        (bands[b] ||= []).push(f[0]);
      }
      const byBand = Object.entries(bands).map(([b, a]) => ({ keys: `${b}-${+b + 5}`, n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1), p95: pct(a.slice().sort((x, y) => x - y), 0.95) }));
      return {
        frames: fr.length,
        seconds: +(fr.reduce((a, f) => a + f[0], 0) / 1000).toFixed(1),
        interval: { p50: pct(iv, 0.5), p95: pct(iv, 0.95), p99: pct(iv, 0.99), max: iv[iv.length - 1] ?? null, mean: +(iv.reduce((a, b) => a + b, 0) / Math.max(1, iv.length)).toFixed(2) },
        tick: { p50: pct(tk, 0.5), p95: pct(tk, 0.95), p99: pct(tk, 0.99), max: tk[tk.length - 1] ?? null },
        over33: iv.filter((x) => x > 33.4).length,
        over50: iv.filter((x) => x > 50).length,
        over100: iv.filter((x) => x > 100).length,
        worst,
        byBand,
        newPrograms: (S.programs1 ?? r_programs()) - S.programs0,
        programs: [S.programs0, S.programs1],
        pixelRatioSeen: [...new Set(fr.map((f) => f[4]))],
        governorEnd: q.governor,
        tierEnd: q.quality.tier,
        lastReason: q.report?.last ?? null,
        longTasks: lt.length,
        longestTask: lt.reduce((a, [, d]) => Math.max(a, d), 0),
      };
      function r_programs() {
        return window.__worldV6Debug.renderer.info.programs.length;
      }
    });
    result.scroll = sc;
    save();
    say(`  scroll ${scrollS} s: ${sc.frames} frames in ${sc.seconds} s; interval p50 ${sc.interval.p50} p95 ${sc.interval.p95} p99 ${sc.interval.p99} max ${sc.interval.max} ms (mean ${sc.interval.mean}); tick JS p50 ${sc.tick.p50} p95 ${sc.tick.p95} max ${sc.tick.max} ms`);
    say(`    frames over 33 ms ${sc.over33}, over 50 ms ${sc.over50}, over 100 ms ${sc.over100}; programs ${sc.programs[0]} -> ${sc.programs[1]} (${sc.newPrograms} new); pixel ratios seen ${sc.pixelRatioSeen.join(",")}; tier at end ${sc.tierEnd}${sc.lastReason ? " (" + sc.lastReason + ")" : ""}; long tasks ${sc.longTasks}, longest ${sc.longestTask} ms`);
    say(`    worst frames: ${sc.worst.map((w) => `${w.interval} ms @key ${w.key} (tick ${w.tick})`).join("; ")}`);
    say(`    mean interval by key band: ${sc.byBand.map((b) => `${b.keys}: ${b.mean}`).join(", ")}`);
  } else {
    result.scroll = { skipped: true };
  }

  // ── Positions: the page loop paused, ticks driven from here ──
  if (posMode !== "none") {
    await page.evaluate((swift) => {
      const sc = window.__worldV6Debug;
      const r = sc.renderer;
      const gl = r.getContext();
      const px = new Uint8Array(4);
      const med = (a) => {
        const b = a.slice().sort((x, y) => x - y);
        return b.length ? b[Math.floor(b.length / 2)] : null;
      };
      sc.paused = true;
      const stopLoop = () => {
        if (sc.raf) {
          cancelAnimationFrame(sc.raf);
          sc.raf = 0;
        }
        if (sc.animTimer !== null && sc.animTimer !== undefined) {
          clearTimeout(sc.animTimer);
          sc.animTimer = null;
        }
      };
      stopLoop();
      const oneFrame = () => {
        sc.paused = false;
        sc.dirty = true;
        const t0 = performance.now();
        sc.tick(performance.now());
        const t1 = performance.now();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t2 = performance.now();
        sc.paused = true;
        stopLoop();
        return { cpu: t1 - t0, sync: t2 - t0 };
      };
      window.__perfB = {
        seed(d) {
          window.scrollTo(0, sc.scrollYForDepth(d));
          sc.seedDepth(d);
          stopLoop();
          oneFrame();
          oneFrame();
        },
        depthForKey(k, n) {
          const u = k / (n - 1);
          const rr = sc.debugRail();
          let lo = 0,
            hi = rr.length;
          for (let i = 0; i < 60; i++) {
            const m = (lo + hi) / 2;
            if (rr.tAtS(m) < u) lo = m;
            else hi = m;
          }
          return rr.depthOfS((lo + hi) / 2);
        },
        /** K renders then one sync, `reps` times after a warm up; the fastest kept, with its CPU submit share. */
        burst(K, reps, warmMs) {
          const scene = sc.debugScene(),
            cam = sc.camera;
          const t0 = performance.now();
          while (performance.now() - t0 < warmMs) {
            for (let i = 0; i < K; i++) r.render(scene, cam);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          }
          const per = [];
          for (let j = 0; j < reps; j++) {
            const a = performance.now();
            for (let i = 0; i < K; i++) r.render(scene, cam);
            const b = performance.now();
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            const c = performance.now();
            per.push([(c - a) / K, (b - a) / K]);
          }
          per.sort((x, y) => x[0] - y[0]);
          return { ms: +per[0][0].toFixed(3), submit: +per[0][1].toFixed(3), med: +per[Math.floor(per.length / 2)][0].toFixed(3) };
        },
        counts() {
          const scene = sc.debugScene(),
            cam = sc.camera;
          const auto = r.info.autoReset;
          r.info.autoReset = false;
          r.info.reset();
          try {
            r.render(scene, cam);
          } finally {
            r.info.autoReset = auto;
          }
          return { tris: r.info.render.triangles, calls: r.info.render.calls };
        },
        moving(d0, d1, n) {
          const cpu = [];
          for (let i = 0; i <= n; i++) {
            const d = d0 + ((d1 - d0) * i) / n;
            window.scrollTo(0, sc.scrollYForDepth(d));
            sc.seedDepth(d);
            stopLoop();
            cpu.push(oneFrame().cpu);
          }
          return { cpu: +med(cpu).toFixed(3), cpuMax: +Math.max(...cpu).toFixed(3) };
        },
        programs: () => r.info.programs.length,
        swift,
      };
    }, swift);

    const nKeys = load.nKeys;
    const stopDepths = await page.evaluate(() => window.__worldV6Debug.stopDepths());
    const NAMES = ["a1 Introduction", "a2 Fundamentals", "a3 Video Ads I", "a4 Video Ads II", "a5 Static Ads", "a6 AI Ads & Content", "a7 Creative Strategy", "a8 Job Board"];
    const positions = stopDepths.map((d, i) => ({ id: "stop" + (i + 1), label: NAMES[i] ?? `stop ${i + 1}`, depth: d }));
    if (posMode === "all" || swift) {
      const src = fs.readFileSync(path.join(HERE, "v6-strip.mjs"), "utf8");
      const m = src.match(/const STRIP_FRAMES\s*=\s*\[([\s\S]*?)\n\];/);
      let rows = m ? [...m[1].matchAll(/\[\s*(-?[\d.]+)\s*,\s*"([^"]*)"/g)].map((x) => [Number(x[1]), x[2]]) : [];
      // SwiftShader: the opening and the heaviest strip frames only.
      if (swift || posMode === "stops") rows = rows.filter(([k]) => [0, 11.5, 13, 23, 37.8].includes(k));
      for (const [k, label] of rows) positions.push({ id: "k" + k, label, key: k, depth: await page.evaluate((k, n) => window.__perfB.depthForKey(k, n), k, nKeys) });
    }
    result.positions = { rows: [] };
    say(`  positions (${positions.length}): burst ms = max(CPU submit, GPU) per frame; submit = the JS share; js/move = one tick while moving`);
    for (const p of positions) {
      await page.evaluate((d) => window.__perfB.seed(d), p.depth);
      await sleep(30);
      const counts = await page.evaluate(() => window.__perfB.counts());
      const burst = swift ? await page.evaluate(() => window.__perfB.burst(1, 2, 0)) : await page.evaluate(() => window.__perfB.burst(8, 3, 150));
      const moving = await page.evaluate((d, n) => window.__perfB.moving(Math.max(0, d - 0.006), d, n), p.depth, swift ? 3 : 20);
      const programs = await page.evaluate(() => window.__perfB.programs());
      result.positions.rows.push({ ...p, counts, burst, moving, programs });
      say(`    ${p.id.padEnd(7)} ${p.label.slice(0, 34).padEnd(34)} burst ${String(burst.ms).padStart(7)} ms (submit ${String(burst.submit).padStart(6)})  js/move ${String(moving.cpu).padStart(6)} (max ${moving.cpuMax})  tris ${String(counts.tris).padStart(7)} calls ${String(counts.calls).padStart(3)} prog ${programs}`);
      save();
    }
    const rows = result.positions.rows;
    const worst = rows.reduce((a, b) => (b.burst.ms > a.burst.ms ? b : a), rows[0]);
    const k0 = rows.find((x) => x.id === "k0");
    result.positions.worst = { id: worst.id, label: worst.label, ms: worst.burst.ms, worstToOpening: k0 ? +(worst.burst.ms / k0.burst.ms).toFixed(2) : null };
    say(`  worst position: ${worst.id} ${worst.label} ${worst.burst.ms} ms${k0 ? `, ${result.positions.worst.worstToOpening}x the opening (${k0.burst.ms} ms)` : ""}`);
  }
  result.qualityEnd = await page.evaluate(() => {
    const q = window.__worldV6Debug.qualityInfo();
    return { tier: q.quality.tier, pixelRatio: q.pixelRatio, override: q.override };
  });
} catch (e) {
  result.fatal = String(e && e.stack ? e.stack : e);
  say("FATAL " + result.fatal);
} finally {
  say(`done ${tag}: ${result.errors.length} console errors, ${result.apiCalls.length} /api calls`);
  if (result.errors.length) say("  errors: " + result.errors.slice(0, 5).join(" | "));
  save();
  await browser.close();
}
