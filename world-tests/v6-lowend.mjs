/**
 * Lower-end computers (second Loom, 2026-10-16): what the real map does on a
 * slower machine. One fresh Chrome (fresh profile: no remembered tier, a cold
 * cache) loads /dev/world-app with the real course, records the load, scrolls
 * the whole route at a steady pace on the page's own loop, and records what it
 * downloaded. v6-bench.mjs measures /dev/world-v6 the same way; this is the
 * page a student gets (the stage, the header, the course's lanterns).
 *
 *   node world-tests/v6-lowend.mjs [--size=1366x768@1] [--cpu=1|4|6] [--swiftshader | --nogpu]
 *        [--net=slow] [--lowgpu | --gpu-name="..."] [--gpu-ms=N | --slowgpu=N] [--scroll=60]
 *        [--query=a=b&c=d] [--tag=name] [--out=dir] [--wait=240]
 *   node world-tests/v6-lowend.mjs --table [--out=dir]
 *
 * One run records:
 *   load     the GPU name the page read, the tier picked and why (pickTier), the
 *            load probe and what it decided (refineTier, the tier 2 and tier 3
 *            measurements, the posters), the pixel ratio; first contentful
 *            paint, the first picture (a poster on screen, never before the
 *            first paint), the WebGL context, __worldReady, the first world
 *            frame after it,
 *            the landing poster gone (the live 3D showing) or the posters on;
 *            each module's install ms and their sum (cap 800); long tasks
 *            (the longest freeze, total blocking time); the JS heap after
 *            load, before and after a forced garbage collection; the Chrome
 *            processes' resident memory.
 *   scroll   the whole route (open lock) at a steady pace, --scroll seconds,
 *            the first scroll after load: the interval between frames the
 *            scene drew while the camera moved (a display frame the frame
 *            pacer skipped is not a frame), p50 / p95 / p99 / worst, frames
 *            over 33, 50 and 100 ms and where (vh), JS per tick, the tier and
 *            pixel ratio the governor moved through, whether the posters came.
 *   network  every response by kind (JS, CSS, fonts, posters, the posters'
 *            manifest, the document, other), bytes on the wire, and any
 *            request to /api or Supabase (there must be none on a dev page).
 *
 * --cpu       CDP Emulation.setCPUThrottlingRate before navigation (the page's
 *             main thread; the GPU process and the GPU run at full speed).
 * --swiftshader  Chrome's software WebGL, v6-ui.mjs checks' launch flags.
 * --nogpu    Chrome with its GPU off (--disable-gpu): software compositing, and
 *             WebGL only where Chrome still falls back to SwiftShader by itself.
 * --net=slow  CDP Network.emulateNetworkConditions: 10 Mbit/s down, 5 up, 40 ms.
 * --lowgpu    the page reads "Intel(R) UHD Graphics 620" as the GPU's name, so
 *             pickTier starts at tier 2 with no MSAA, as on a real laptop of
 *             that class. Only the name: the GPU is still this Mac's.
 * --gpu-name="..."  the same with any name (an Iris Xe or a UHD 600 laptop's).
 * --slowgpu=N the page's own dev simulator (?slowgpu=N, perf.createGpuLoad): a
 *             full screen load per pixel, calibrated at the opening so the GPU
 *             behaves N times slower; the pixel ratio and tier steps relieve it
 *             as they relieve a weak GPU. Its own calibration overshoots on a
 *             canvas without MSAA (13 asked: 39 made at --cpu=1, 96 at --cpu=4,
 *             2026-10-16): there several renders per sync time 2 to 3 times
 *             faster each than one, and under CPU throttling the opening's
 *             burst is CPU bound and reads as GPU time. Use --gpu-ms, at
 *             --cpu=1. The simulator's load is the same per pixel
 *             everywhere, so the route's heavy frames (the falls) are not
 *             heavier than the opening as they are on a real weak GPU.
 * --gpu-ms=N  the same load, set by measurement: the scene's calibration is
 *             replaced (on the instance, from here) by a search on the load's
 *             size until the opening at the start tier and pixel ratio takes
 *             N ms, one synced frame at a time (the fastest of 3), as the load
 *             probe times a slow frame. Its time (qualityReport.slowGpu.took) is
 *             part of the load's timeline: subtract it.
 *
 * Output: shots/v6/review-2026-10-15/loom2/lowend/runs/<tag>.json, .txt,
 * <tag>-load.png and <tag>-end.png (git-ignored), and table.txt with --table. Waits for other Chromes on this machine to
 * finish first (--wait seconds), and records the machine's load average.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const opt = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const OUT = opt.out ? path.resolve(String(opt.out)) : path.join(HERE, "shots/v6/review-2026-10-15/loom2/lowend/runs");
fs.mkdirSync(OUT, { recursive: true });
const f1 = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(+v) ? "-" : (+v).toFixed(d));

// ── The table of every run ────────────────────────────────────────────────
if (opt.table) {
  const runs = fs
    .readdirSync(OUT)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")))
    .filter((r) => r && r.kind === "v6-lowend" && r.load)
    .sort((a, b) => String(a.when).localeCompare(String(b.when)));
  const L = [];
  L.push(`v6-lowend, every run in ${OUT}`);
  L.push("");
  L.push("LOAD (ms from navigation)");
  L.push(["run", "tier pick", "after load", "PR", "posters", "FCP", "first picture", "ctx", "install", "ready", "live/usable", "longest task", "TBT", "heap MB", "heap MB after GC"].join("\t"));
  for (const r of runs) {
    const l = r.load;
    L.push(
      [
        r.tag,
        `${l.pick ?? "-"} (${String(l.pickReason ?? "").slice(0, 28)})`,
        l.tier,
        l.pixelRatio,
        l.poster?.on ? `ON: ${String(l.poster.reason ?? "").slice(0, 40)}` : "off",
        f1(l.fcp, 0),
        f1(l.firstPicture, 0),
        f1(l.context, 0),
        f1(l.installSum, 0),
        f1(l.ready, 0),
        f1(l.usable, 0),
        f1(l.longestTask, 0),
        f1(l.tbt, 0),
        f1(r.heap?.usedMB, 1),
        f1(r.heap?.afterGcMB, 1),
      ].join("\t"),
    );
  }
  L.push("");
  L.push("SCROLL (the first whole-route scroll after load; interval between drawn frames while the camera moved, ms)");
  L.push(["run", "frames", "p50", "p95", "p99", "worst", "@vh", ">33", ">50", ">100", "tick p50", "tick p95", "tiers seen", "PR seen", "tier end", "posters end"].join("\t"));
  for (const r of runs) {
    const s = r.scroll;
    if (!s || s.skipped) continue;
    L.push([r.tag, s.frames, f1(s.interval.p50), f1(s.interval.p95), f1(s.interval.p99), f1(s.interval.max), s.worst?.[0]?.vh ?? "-", s.over33, s.over50, s.over100, f1(s.tick.p50, 2), f1(s.tick.p95, 2), (s.tiersSeen || []).join(","), (s.pixelRatioSeen || []).join(","), s.tierEnd, s.posterEnd ? "ON" : "off"].join("\t"));
  }
  L.push("");
  L.push("NETWORK (bytes on the wire; dev build)");
  L.push(["run", "total KB", "JS KB", "JS n", "CSS KB", "fonts KB", "posters KB", "posters n", "manifest KB", "doc KB", "other KB", "/api or supabase"].join("\t"));
  for (const r of runs) {
    const n = r.network;
    if (!n) continue;
    const k = (c) => f1((n.byKind[c]?.bytes ?? 0) / 1024, 0);
    L.push([r.tag, f1(n.totalBytes / 1024, 0), k("js"), n.byKind.js?.n ?? 0, k("css"), k("font"), k("poster"), n.byKind.poster?.n ?? 0, k("manifest"), k("document"), k("other"), n.forbidden.length].join("\t"));
  }
  fs.writeFileSync(path.join(OUT, "table.txt"), L.join("\n") + "\n");
  console.log(L.join("\n"));
  process.exit(0);
}

// ── Options ────────────────────────────────────────────────────────────────
const BASE = process.env.BASE_URL || "http://localhost:3111";
const cpu = Number(opt.cpu ?? 1);
const sizeM = String(opt.size ?? "1366x768@1").match(/^(\d+)x(\d+)(?:@([\d.]+))?$/);
if (!sizeM) throw new Error("--size wants WxH@dpr");
const W = +sizeM[1],
  H = +sizeM[2],
  DPR = +(sizeM[3] ?? 1);
const swift = !!opt.swiftshader;
// --nogpu: Chrome with its GPU off (software compositing; WebGL only if Chrome still falls back to SwiftShader on its own).
const nogpu = !!opt.nogpu;
const slowNet = opt.net === "slow";
const UHD620 = "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)";
const gpuName = opt["gpu-name"] ? String(opt["gpu-name"]) : opt.lowgpu ? UHD620 : null;
const lowgpu = !!gpuName;
const slowgpu = opt.slowgpu ? Number(opt.slowgpu) : 0;
// --gpu-ms=N: the simulator's load set by measurement instead of its own calibration:
// the opening at the start tier and pixel ratio is made to take N ms (see the header).
const gpuMs = opt["gpu-ms"] ? Number(opt["gpu-ms"]) : 0;
const scrollS = Number(opt.scroll ?? 60);
const waitS = Number(opt.wait ?? 240);
const tag = String(opt.tag ?? `${swift ? "swift" : nogpu ? "nogpu" : "gpu"}-cpu${cpu}x-${W}x${H}@${DPR}${slowNet ? "-slownet" : ""}${gpuName ? "-named" : ""}${slowgpu ? `-slowgpu${slowgpu}` : ""}${gpuMs ? `-gpu${gpuMs}ms` : ""}`);
const query = ["catalog=course", "p=partial", slowgpu ? `slowgpu=${slowgpu}` : gpuMs ? "slowgpu=2" : null, opt.query ? String(opt.query) : null].filter(Boolean).join("&");
const URL_ = `${BASE}${opt.page ?? "/dev/world-app"}?${query}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GPU_ARGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"];
// v6-ui.mjs "checks": Chrome's software renderer.
const SWIFT_ARGS = ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"];
const NOGPU_ARGS = ["--disable-gpu", "--no-sandbox", "--hide-scrollbars"];

const lines = [];
const say = (s) => {
  lines.push(s);
  console.log(s);
};
const result = { kind: "v6-lowend", tag, url: URL_.replace(BASE, ""), when: new Date().toISOString(), opts: { cpu, W, H, DPR, swift, nogpu, slowNet, gpuName, slowgpu, gpuMs, scrollS }, errors: [] };
const save = () => {
  fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(result, null, 1));
  fs.writeFileSync(path.join(OUT, `${tag}.txt`), lines.join("\n") + "\n");
};

/** Other Chromes on this machine (other agents' runs): their pids and CPU share. */
function otherChromes() {
  try {
    const out = execSync("ps -Ao pid=,pcpu=,command=", { encoding: "utf8" });
    return out
      .split("\n")
      .filter((l) => /Google Chrome\.app\/Contents\/MacOS\/Google Chrome(\s|$)/.test(l))
      .map((l) => l.trim().split(/\s+/).slice(0, 2).join(" "));
  } catch {
    return [];
  }
}
function busiest() {
  try {
    return execSync("ps -Ao pcpu=,comm= | sort -nr | head -4", { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map((l) => l.trim().replace(/\s+.*\//, " "));
  } catch {
    return [];
  }
}
/** Resident memory of a Chrome's processes, by kind, MB. */
function chromeRss(rootPid) {
  try {
    const rows = execSync("ps -Ao pid=,ppid=,rss=,command=", { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
        return m ? { pid: +m[1], ppid: +m[2], rss: +m[3], cmd: m[4] } : null;
      })
      .filter(Boolean);
    const mine = new Set([rootPid]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of rows) if (!mine.has(r.pid) && mine.has(r.ppid)) (mine.add(r.pid), (grew = true));
    }
    const by = {};
    for (const r of rows) {
      if (!mine.has(r.pid)) continue;
      const kind = /--type=gpu-process/.test(r.cmd) ? "gpu" : /--type=renderer/.test(r.cmd) ? "renderer" : /--type=/.test(r.cmd) ? "utility" : "browser";
      by[kind] = (by[kind] || 0) + r.rss / 1024;
    }
    for (const k of Object.keys(by)) by[k] = +by[k].toFixed(0);
    by.total = Object.values(by).reduce((a, b) => a + b, 0);
    return by;
  } catch {
    return null;
  }
}

// One Chrome at a time: wait for other agents' Chromes to finish.
{
  const t0 = Date.now();
  let others = otherChromes();
  while (others.length && Date.now() - t0 < waitS * 1000) {
    await sleep(5000);
    others = otherChromes();
  }
  result.machine = { loadavg: os.loadavg().map((x) => +x.toFixed(2)), otherChromesAtStart: others, waitedS: Math.round((Date.now() - t0) / 1000), busiest: busiest() };
}

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: swift ? SWIFT_ARGS : nogpu ? NOGPU_ARGS : GPU_ARGS,
  protocolTimeout: 240000,
});
const chromePid = browser.process()?.pid ?? null;

// ── Network ────────────────────────────────────────────────────────────────
const reqs = new Map();
function kindOf(url, type, mime) {
  let p = "";
  try {
    p = new URL(url).pathname;
  } catch {
    return "other";
  }
  if (/\/world-v6\/posters\/[\w-]+\.webp$/.test(p)) return "poster";
  if (/\/world-v6\/posters\/manifest\.json$/.test(p)) return "manifest";
  if (type === "Document") return "document";
  if (type === "Script" || /\.m?js$/.test(p)) return "js";
  if (type === "Stylesheet" || /\.css$/.test(p)) return "css";
  if (type === "Font" || /\.(woff2?|ttf|otf)$/.test(p)) return "font";
  if (type === "Image" || /^image\//.test(mime || "")) return "image";
  return "other";
}

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => result.errors.push("pageerror " + String(e.message).slice(0, 300)));
  page.on("console", (m) => {
    const t = m.text();
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback/i.test(t)) return;
    if (m.type() === "error") result.errors.push(t.slice(0, 300));
    if (/\[world-v6\] posters/.test(t)) result.posterLog = (result.posterLog || []).concat(t.slice(0, 300));
  });
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  if (slowNet) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: (10e6 / 8) | 0, uploadThroughput: (5e6 / 8) | 0 });
  if (cpu !== 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  let docTs = null;
  cdp.on("Network.requestWillBeSent", (e) => {
    if (e.type === "Document" && docTs === null) docTs = e.timestamp;
    reqs.set(e.requestId, { url: e.request.url, type: e.type, t0: e.timestamp });
  });
  cdp.on("Network.responseReceived", (e) => {
    const r = reqs.get(e.requestId);
    if (!r) return;
    r.status = e.response.status;
    r.mime = e.response.mimeType;
    r.cache = !!(e.response.fromDiskCache || e.response.fromServiceWorker || e.response.fromPrefetchCache);
    r.encoding = e.response.headers?.["content-encoding"] || e.response.headers?.["Content-Encoding"] || null;
  });
  cdp.on("Network.dataReceived", (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.decoded = (r.decoded || 0) + e.dataLength;
  });
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    if (r) {
      r.bytes = e.encodedDataLength;
      r.t1 = e.timestamp;
    }
  });
  cdp.on("Network.loadingFailed", (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.failed = e.errorText;
  });

  // Hooks before any page script: paints, long tasks, the ready moment, the
  // live 3D replacing the landing poster, the WebGL context, (--lowgpu, --gpu-name) the name.
  await page.evaluateOnNewDocument((spoofName, gpuMs) => {
    // --gpu-ms: the scene's slow GPU calibration replaced on the instance, the
    // moment the constructor publishes it (before load() calibrates and probes).
    if (gpuMs > 0) {
      let inst;
      Object.defineProperty(window, "__worldV6Debug", {
        configurable: true,
        get: () => inst,
        set: (sc) => {
          inst = sc;
          if (!sc || typeof sc !== "object") return;
          sc.calibrateSlowGpu = function () {
            const r = this.renderer, scene = this.scene, cam = this.camera, load = this.gpuLoad;
            if (!r || !scene || !cam || !load) return null;
            const t0 = performance.now();
            this.prepareFrame();
            const gl = r.getContext();
            const px = new Uint8Array(4);
            const burst = (k, reps) => {
              let best = Infinity;
              for (let j = 0; j < reps; j++) {
                const a = performance.now();
                for (let i = 0; i < k; i++) r.render(scene, cam);
                gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
                best = Math.min(best, (performance.now() - a) / k);
              }
              return best;
            };
            load.mesh.visible = true;
            load.setIters(0);
            // One render per sync, as the load probe measures a slow frame (K = 1): on this
            // Mac's GPU a canvas without MSAA read 2.8 times faster per render with 3 renders
            // per sync (15.7 ms) than with 1 (44 ms), and the frame loop draws 1 (2026-10-16).
            burst(1, 2);
            const base = burst(1, 3);
            let lo = 0, hi = 128, ms = base;
            if (gpuMs > base) {
              load.setIters(hi);
              ms = burst(1, 2);
              while (ms < gpuMs && hi < 65536) {
                lo = hi;
                hi = Math.min(65536, hi * 2);
                load.setIters(hi);
                ms = burst(1, 2);
              }
              for (let i = 0; i < 12 && hi - lo > 4; i++) {
                const mid = (lo + hi) >> 1;
                load.setIters(mid);
                ms = burst(1, 2);
                if (ms < gpuMs) lo = mid;
                else hi = mid;
              }
            } else hi = 0;
            load.setIters(hi);
            const check = burst(1, 3);
            const out = { mode: "gpu-ms", targetMs: gpuMs, baseMs: +base.toFixed(2), iters: hi, checkMs: +check.toFixed(2), achieved: +(check / Math.max(1e-3, base)).toFixed(2), took: Math.round(performance.now() - t0), pixelRatio: r.getPixelRatio(), tier: this.quality.tier };
            this.qualityReport.slowGpu = out;
            return out;
          };
        },
      });
    }
    const T = (window.__lowend = { t: {}, longTasks: [], lcp: [], realGpu: null, antialias: null });
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) T.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]);
      }).observe({ type: "longtask", buffered: true });
    } catch {}
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          const el = e.element;
          T.lcp.push({ t: Math.round(e.startTime), size: e.size, url: e.url || null, el: el ? `${el.tagName.toLowerCase()}${el.getAttribute?.("data-world-card") ? "[card]" : ""}` : null });
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
    // The first picture: a still of the world on screen (the loading card's
    // background or the landing poster), loaded and not faded out. The largest
    // paint does not count a full-screen image, so it is watched here.
    const visible = (el) => {
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return false;
      }
      const b = el.getBoundingClientRect();
      return b.width >= innerWidth * 0.5 && b.height >= innerHeight * 0.5;
    };
    const posterLoaded = () => performance.getEntriesByType("resource").some((e) => /\/world-v6\/posters\/[\w-]+\.webp/.test(e.name) && e.responseEnd > 0);
    const seePicture = () => {
      if (T.t.picture !== undefined || T.t.live !== undefined || performance.now() > 120000) return;
      try {
        const img = [...document.querySelectorAll('img[src*="/world-v6/posters/"]')].find((i) => i.complete && i.naturalWidth > 1 && visible(i));
        const card = document.querySelector("[data-world-card]");
        const cardPic = card && /posters\//.test(card.style.backgroundImage || "") && posterLoaded() && visible(card);
        if (img || cardPic) {
          T.t.picture = performance.now();
          T.pictureBy = img ? "landing poster" : "loading card";
          return;
        }
      } catch {}
      requestAnimationFrame(seePicture);
    };
    requestAnimationFrame(seePicture);
    const watch = () => {
      const f0 = window.__worldFrameCount ?? 0;
      const step = () => {
        const now = performance.now();
        if (T.t.firstFrame === undefined && (window.__worldFrameCount ?? 0) > f0) T.t.firstFrame = now;
        let ps = null;
        try {
          ps = window.__worldPoster ? window.__worldPoster() : null;
        } catch {}
        if (ps && ps.on && T.t.posterOn === undefined) T.t.posterOn = now;
        if (ps && !ps.on && ps.layerShown === false && T.t.live === undefined) T.t.live = now;
        if ((T.t.live === undefined && T.t.posterOn === undefined) || T.t.firstFrame === undefined) {
          if (now - T.t.ready < 60000) requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    };
    let ready;
    Object.defineProperty(window, "__worldReady", {
      configurable: true,
      get: () => ready,
      set: (v) => {
        ready = v;
        if (v && T.t.ready === undefined) {
          T.t.ready = performance.now();
          watch();
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
    const RENDERER = 0x9246; // UNMASKED_RENDERER_WEBGL
    for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!P) continue;
      const gp = P.prototype.getParameter;
      P.prototype.getParameter = function (p) {
        const v = gp.call(this, p);
        if (p === RENDERER) {
          if (!T.realGpu) T.realGpu = v;
          if (spoofName) return spoofName;
        }
        return v;
      };
    }
  }, gpuName, gpuMs);

  const t0 = Date.now();
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 180000 });
  // Short polls: a throttled or software page blocks its main thread for seconds.
  let state = null;
  while (Date.now() - t0 < 600000) {
    state = await page.evaluate(() => (window.__worldReady ? "ready" : window.__worldError ? "error: " + window.__worldError : window.__worldView === "list" ? "list" : null)).catch(() => null);
    if (state) break;
    await sleep(250);
  }
  if (state !== "ready") throw new Error("the map never got ready: " + state);
  // The live 3D replacing the landing poster, or the posters coming on.
  for (let i = 0; i < 240; i++) {
    const t = await page.evaluate(() => window.__lowend.t).catch(() => ({}));
    if ((t.live !== undefined || t.posterOn !== undefined) && t.firstFrame !== undefined) break;
    await sleep(250);
  }
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, `${tag}-load.png`), captureBeyondViewport: false });

  const load = await page.evaluate(() => {
    const L = window.__lowend;
    const sc = window.__worldV6Debug;
    const q = sc ? sc.qualityInfo() : null;
    const st = sc ? sc.moduleStats() : null;
    const r = (q && q.report) || {};
    const nav = performance.getEntriesByType("navigation")[0];
    const paints = Object.fromEntries(performance.getEntriesByType("paint").map((e) => [e.name, Math.round(e.startTime)]));
    const res = performance.getEntriesByType("resource");
    const k0 = res.find((e) => /\/world-v6\/posters\/k0\.webp/.test(e.name));
    const installs = st ? Object.fromEntries(Object.entries(st.install).filter(([, v]) => typeof v === "number")) : {};
    const installSum = Object.values(installs).reduce((a, b) => a + b, 0);
    const until = (L.t.live ?? L.t.posterOn ?? L.t.ready ?? Infinity) + 50;
    const lt = L.longTasks.filter(([s]) => s <= until);
    const lcpLast = L.lcp.length ? L.lcp[L.lcp.length - 1] : null;
    const lcpPoster = L.lcp.find((e) => /posters\/[\w-]+\.webp/.test(e.url || ""));
    const ctx = sc?.renderer?.getContext?.();
    const rail = sc?.debugRail?.();
    const pick = (o, keys) => (o && typeof o === "object" ? Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) : o ?? null);
    return {
      gpu: r.gpu ?? null,
      realGpu: L.realGpu,
      antialias: L.antialias,
      megapixels: r.megapixels ?? null,
      pick: r.pick ?? null,
      pickReason: r.pickReason ?? null,
      recalled: r.recalled ?? null,
      start: r.start ?? null,
      msaa: r.msaa ?? null,
      software: r.software ?? null,
      warm: pick(r.warm, ["ms", "programsAfter", "pending", "uploaded"]),
      probe: pick(r.probe, ["ms", "med", "first", "cold", "took", "capped", "calls", "triangles"]),
      refine: r.refine ?? null,
      probe2: r.probe2 ?? null,
      probe3: pick(r.probe3, ["ms", "runs", "first", "cold", "took", "capped"]),
      probe3Check: r.probe3Check ?? null,
      recheck: r.recheck ?? null,
      slowGpu: r.slowGpu ?? null,
      notRemembered: r.notRemembered ?? null,
      restCheck: r.restCheck ? { armed: r.restCheck.armed, why: r.restCheck.why ?? null } : null,
      last: r.last ?? null,
      tier: q?.quality?.tier ?? null,
      tierName: q?.quality?.name ?? null,
      pixelRatio: q?.pixelRatio ?? null,
      poster: q?.poster ?? null,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEvent: nav ? Math.round(nav.loadEventEnd) : null,
      fcp: paints["first-contentful-paint"] ?? null,
      lcp: lcpLast,
      lcpPoster: lcpPoster ?? null,
      lcpAll: L.lcp,
      k0: k0 ? { start: Math.round(k0.startTime), end: Math.round(k0.responseEnd), bytes: k0.transferSize } : null,
      // The first picture: a poster ready on screen (watched above), else the first world frame;
      // never before the first contentful paint (a frame is on screen only once presented: on
      // SwiftShader the poster was ready at 0.7 s and the first paint came at 3.3 s).
      pictureSeen: L.t.picture !== undefined ? Math.round(L.t.picture) : null,
      firstPicture: (() => {
        const seen = L.t.picture !== undefined ? L.t.picture : L.t.firstFrame;
        if (seen === undefined) return null;
        return Math.round(Math.max(seen, paints["first-contentful-paint"] ?? 0));
      })(),
      firstPictureBy: L.t.picture !== undefined ? L.pictureBy : "the first world frame",
      context: L.t.context !== undefined ? Math.round(L.t.context) : null,
      ready: L.t.ready !== undefined ? Math.round(L.t.ready) : null,
      sceneReady: r.readyMs ?? null,
      firstFrame: L.t.firstFrame !== undefined ? Math.round(L.t.firstFrame) : null,
      live: L.t.live !== undefined ? Math.round(L.t.live) : null,
      posterOn: L.t.posterOn !== undefined ? Math.round(L.t.posterOn) : null,
      // Usable: the 3D drawn and the landing poster gone (markers live), or the posters with their labels.
      usable: L.t.live !== undefined ? Math.round(Math.max(L.t.live, L.t.ready)) : L.t.posterOn !== undefined ? Math.round(Math.max(L.t.posterOn, L.t.ready)) : null,
      installs,
      installSum,
      longestTask: lt.reduce((a, [, d]) => Math.max(a, d), 0),
      tbt: lt.reduce((a, [, d]) => a + Math.max(0, d - 50), 0),
      longTasksOver200: lt.filter(([, d]) => d > 200),
      programs: sc?.renderer?.info?.programs?.length ?? null,
      gpuMemory: sc?.renderer?.info?.memory ? { ...sc.renderer.info.memory } : null,
      drawingBuffer: ctx ? [ctx.drawingBufferWidth, ctx.drawingBufferHeight] : null,
      totalVh: rail ? rail.totalVh() : null,
      lockLimit: sc?.lockLimit?.() ?? null,
      cores: navigator.hardwareConcurrency ?? null,
    };
  });
  result.load = load;
  const heap0 = await cdp.send("Runtime.getHeapUsage");
  await cdp.send("HeapProfiler.collectGarbage");
  const heap1 = await cdp.send("Runtime.getHeapUsage");
  result.heap = { usedMB: +(heap0.usedSize / 1048576).toFixed(1), totalMB: +(heap0.totalSize / 1048576).toFixed(1), afterGcMB: +(heap1.usedSize / 1048576).toFixed(1) };
  result.rssAfterLoad = chromePid ? chromeRss(chromePid) : null;
  save();
  const pr = (p) => (p ? `${p.ms} ms (warm ${p.first}, cold ${p.cold}, took ${p.took}${p.capped ? ", capped" : ""})` : "-");
  say(`v6-lowend ${tag}  ${result.url}`);
  say(`  machine: load ${result.machine.loadavg.join(" ")}, other Chromes at start ${result.machine.otherChromesAtStart.length} (waited ${result.machine.waitedS} s); busiest: ${result.machine.busiest.join(", ")}`);
  say(`  gpu read by the page: ${load.gpu}${lowgpu ? `  (real: ${load.realGpu})` : ""}; canvas MSAA ${load.antialias}; ${W}x${H}@${DPR}, cpu ${cpu}x${slowNet ? ", 10 Mbit/s 40 ms" : ""}${slowgpu ? `, slow GPU simulator x${slowgpu}` : ""}${gpuMs ? `, slow GPU simulator set to ${gpuMs} ms at the opening` : ""}`);
  if (load.slowGpu) say(`  simulator: ${JSON.stringify(load.slowGpu)}`);
  say(`  tier: pick ${load.pick} (${load.pickReason}); probe ${pr(load.probe)}; refine: ${load.refine ? load.refine.reason : "-"}`);
  if (load.probe2) say(`        tier 2 measured: ${JSON.stringify(load.probe2)}`);
  if (load.probe3) say(`        tier 3 measured: ${JSON.stringify(load.probe3)}`);
  say(`        after load: tier ${load.tier} (${load.tierName}) at pixel ratio ${load.pixelRatio}, buffer ${load.drawingBuffer?.join("x") ?? "-"}; last: ${load.last}`);
  say(`  posters: ${load.poster?.on ? `ON (${load.poster.kind}): ${load.poster.reason}` : "off"}`);
  say(`  load: FCP ${load.fcp} ms, first picture ${load.firstPicture} ms (${load.firstPictureBy}), WebGL context ${load.context ?? "-"}, __worldReady ${load.ready}, first world frame ${load.firstFrame}, ${load.live !== null ? `landing poster gone ${load.live}` : `posters on ${load.posterOn}`}; usable ${load.usable} ms`);
  say(`  modules installed in ${load.installSum} ms (cap 800); warm compile ${load.warm?.ms ?? "-"} ms, ${load.warm?.programsAfter ?? "-"} programs; longest task ${load.longestTask} ms, total blocking ${load.tbt} ms, ${load.longTasksOver200.length} tasks over 200 ms`);
  say(`  JS heap ${result.heap.usedMB} MB (${result.heap.afterGcMB} after GC); Chrome resident memory ${JSON.stringify(result.rssAfterLoad)} MB; GPU objects ${JSON.stringify(load.gpuMemory)}`);

  // ── The scroll ───────────────────────────────────────────────────────────
  if (scrollS > 0) {
    await page.evaluate((seconds) => {
      const sc = window.__worldV6Debug;
      const r = sc.renderer;
      const totalVh = sc.debugRail().totalVh();
      // The student map's lock is open (access.ts WORLD_LOCK_MODE); a page that locks is opened, as bench.ts does.
      if (sc.lockLimit() < 0.999) sc.setLock("open", 7);
      const S = (window.__lowScroll = { done: false, frames: [], steps: [], programs0: r ? r.info.programs.length : 0, endY: sc.scrollYForDepth(sc.lockLimit()), longTasks0: window.__lowend.longTasks.length });
      const orig = sc.tick;
      let lastDrawn = null;
      let lastLast = sc.qualityReport?.last ?? null;
      sc.tick = (now) => {
        const catchingUp = Math.abs(sc.targetDepth - sc.currentDepth) > 1e-7;
        const skipped0 = sc.pacer ? sc.pacer.skipped : 0;
        const p0 = r ? r.info.programs.length : 0;
        const a = performance.now();
        orig(now);
        const b = performance.now();
        // A display frame the pacer skipped drew nothing: the next drawn frame's interval spans it.
        if (sc.pacer && sc.pacer.skipped > skipped0) return;
        if (S.running && (S.driving || catchingUp)) {
          S.frames.push([lastDrawn === null ? 0 : +(now - lastDrawn).toFixed(2), +(b - a).toFixed(2), Math.round(sc.currentDepth * totalVh), r ? r.info.programs.length - p0 : 0, r ? +r.getPixelRatio().toFixed(2) : 0, sc.quality?.tier ?? -1, sc.frame?.calls ?? 0]);
          lastDrawn = now;
        } else lastDrawn = null;
        const last = sc.qualityReport?.last ?? null;
        if (last !== lastLast) {
          lastLast = last;
          S.steps.push([Math.round(sc.currentDepth * totalVh), String(last).slice(0, 200)]);
        }
      };
      S.restore = () => {
        sc.tick = orig;
      };
      window.scrollTo(0, 0);
      const start = performance.now() + 400;
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
            S.programs1 = r ? r.info.programs.length : 0;
          }, 2000);
      };
      requestAnimationFrame(step);
    }, scrollS);
    const tS = Date.now();
    while (Date.now() - tS < (scrollS + 180) * 1000) {
      await sleep(1000);
      const done = await page.evaluate(() => window.__lowScroll.done).catch(() => false);
      if (done) break;
    }
    const sc = await page.evaluate(() => {
      const S = window.__lowScroll;
      S.restore();
      const fr = S.frames.filter((f) => f[0] > 0);
      const iv = fr.map((f) => f[0]).sort((a, b) => a - b);
      const tk = fr.map((f) => f[1]).sort((a, b) => a - b);
      const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
      const worst = fr
        .slice()
        .sort((a, b) => b[0] - a[0])
        .slice(0, 10)
        .map((f) => ({ interval: f[0], tick: f[1], vh: f[2], newPrograms: f[3], pr: f[4], tier: f[5], calls: f[6] }));
      const bands = {};
      for (const f of fr) {
        const b = Math.floor(f[2] / 100) * 100;
        (bands[b] ||= []).push(f[0]);
      }
      const byBand = Object.entries(bands)
        .sort((a, b) => +a[0] - +b[0])
        .map(([b, a]) => {
          const s = a.slice().sort((x, y) => x - y);
          return { vh: `${b}-${+b + 100}`, n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1), p95: pct(s, 0.95), max: s[s.length - 1] };
        });
      const sc = window.__worldV6Debug;
      const q = sc.qualityInfo();
      const lt = window.__lowend.longTasks.slice(S.longTasks0);
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
        steps: S.steps,
        newPrograms: (S.programs1 ?? 0) - S.programs0,
        pixelRatioSeen: [...new Set(fr.map((f) => f[4]))],
        tiersSeen: [...new Set(fr.map((f) => f[5]))],
        callsMax: fr.reduce((a, f) => Math.max(a, f[6]), 0),
        governorEnd: q.governor,
        tierEnd: q.quality.tier,
        pixelRatioEnd: q.pixelRatio,
        posterEnd: !!q.poster?.on,
        posterReasonEnd: q.poster?.reason ?? null,
        posterOffer: q.poster?.offer ?? null,
        pacer: q.pacer,
        lastReason: q.report?.last ?? null,
        restBursts: q.report?.restBursts ?? null,
        governorPoster: q.report?.governorPoster ?? null,
        longTasks: lt.length,
        longestTask: lt.reduce((a, [, d]) => Math.max(a, d), 0),
      };
    });
    result.scroll = sc;
    save();
    say(`  scroll ${scrollS} s, whole route (${load.totalVh} vh): ${sc.frames} drawn frames while moving; interval p50 ${sc.interval.p50} p95 ${sc.interval.p95} p99 ${sc.interval.p99} worst ${sc.interval.max} ms (mean ${sc.interval.mean}); JS per tick p50 ${sc.tick.p50} p95 ${sc.tick.p95} max ${sc.tick.max} ms`);
    say(`    over 33 ms ${sc.over33}, over 50 ${sc.over50}, over 100 ${sc.over100}; programs +${sc.newPrograms}; tiers seen ${sc.tiersSeen.join(",")}, pixel ratios ${sc.pixelRatioSeen.join(",")}; end: tier ${sc.tierEnd} at ${sc.pixelRatioEnd}, posters ${sc.posterEnd ? "ON: " + sc.posterReasonEnd : "off"}${sc.posterOffer ? ", offered: " + sc.posterOffer : ""}; pacer ${JSON.stringify(sc.pacer)}; long tasks ${sc.longTasks}, longest ${sc.longestTask} ms`);
    say(`    worst frames: ${sc.worst.slice(0, 6).map((w) => `${w.interval} ms @${w.vh} vh (tick ${w.tick}, tier ${w.tier}, PR ${w.pr})`).join("; ")}`);
    say(`    mean interval per 100 vh: ${sc.byBand.map((b) => `${b.vh}: ${b.mean}`).join(", ")}`);
    if (sc.steps.length) say(`    quality steps: ${sc.steps.map(([vh, s]) => `@${vh} vh ${s}`).join(" | ")}`);
  } else result.scroll = { skipped: true };

  // ── After the scroll ─────────────────────────────────────────────────────
  const heap2 = await cdp.send("Runtime.getHeapUsage");
  result.heap.afterScrollMB = +(heap2.usedSize / 1048576).toFixed(1);
  result.rssAfterScroll = chromePid ? chromeRss(chromePid) : null;

  // ── The network summary ──────────────────────────────────────────────────
  const rows = [...reqs.values()].filter((r) => !/^data:|^blob:/.test(r.url));
  const byKind = {};
  const forbidden = [];
  for (const r of rows) {
    const k = kindOf(r.url, r.type, r.mime);
    const b = (byKind[k] ||= { n: 0, bytes: 0, decoded: 0, files: [] });
    b.n++;
    b.bytes += r.bytes || 0;
    b.decoded += r.decoded || 0;
    let p = r.url;
    try {
      const u = new URL(r.url);
      p = u.host === new URL(BASE).host ? u.pathname : u.host + u.pathname;
      if (/^\/api\//.test(u.pathname) || /supabase/.test(u.host)) forbidden.push(p);
    } catch {}
    b.files.push({ path: p.slice(0, 140), bytes: r.bytes || 0, decoded: r.decoded || 0, ms: r.t1 && docTs !== null ? Math.round((r.t1 - docTs) * 1000) : null, encoding: r.encoding ?? null, failed: r.failed ?? undefined });
  }
  for (const b of Object.values(byKind)) b.files.sort((x, y) => y.bytes - x.bytes);
  const totalBytes = rows.reduce((a, r) => a + (r.bytes || 0), 0);
  result.network = { totalBytes, requests: rows.length, byKind, forbidden };
  const kb = (k) => `${byKind[k]?.n ?? 0} files ${((byKind[k]?.bytes ?? 0) / 1024).toFixed(0)} KB`;
  say(`  downloads (dev build, on the wire): ${rows.length} requests, ${(totalBytes / 1048576).toFixed(2)} MB: JS ${kb("js")}, CSS ${kb("css")}, fonts ${kb("font")}, posters ${kb("poster")}, manifest ${kb("manifest")}, document ${kb("document")}, images ${kb("image")}, other ${kb("other")}; /api or Supabase: ${forbidden.length}`);
  say(`  JS heap after the scroll ${result.heap.afterScrollMB} MB; Chrome resident memory ${JSON.stringify(result.rssAfterScroll)} MB`);
  await page.screenshot({ path: path.join(OUT, `${tag}-end.png`), captureBeyondViewport: false });
} catch (e) {
  result.fatal = String(e && e.stack ? e.stack : e);
  say("FATAL " + result.fatal);
} finally {
  say(`done ${tag}: ${result.errors.length} console errors`);
  if (result.errors.length) say("  errors: " + [...new Set(result.errors)].slice(0, 5).join(" | "));
  save();
  await browser.close();
}
