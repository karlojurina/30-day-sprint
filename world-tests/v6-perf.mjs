/**
 * v6 performance probe on the real GPU (M2 Pro, ANGLE Metal), ported from
 * _admin/research/world-gen/v6/perf-data/v6_perf_probe.mjs to the v6 route,
 * with world_art_bible_v6.md section 3.1 as pass/fail per frame.
 *
 *   node world-tests/v6-perf.mjs route  [w h dpr]   every stop + every strip frame: burst ms at PR 1.5 and 1.0
 *                                                   (frame time, pixel cost, fixed cost), triangles and calls
 *                                                   with the lake's reflection, the reflection pass alone, JS
 *                                                   per moving frame, programs
 *   node world-tests/v6-perf.mjs bpr    [w h dpr]   burst ms against pixel ratio 0.5..2, with the fit a + b * MP
 *   node world-tests/v6-perf.mjs bgroups [w h dpr]  each group hidden in turn: its ms, triangles and calls
 *   node world-tests/v6-perf.mjs sweep  [w h dpr]   the whole route in STEPS steps, twice, on a fresh page:
 *                                                   stalls and new shader programs on the first scroll
 *   node world-tests/v6-perf.mjs static [w h dpr]   materials, geometry bytes, texture bytes, programs, install ms
 *
 * Defaults: 1691 x 1278 at device pixel ratio 1.5 (the renderer caps it at the tier's cap).
 * Positions come from the page: stopDepths() for the 8 stops, and the strip frames
 * from world-tests/v6-strip.mjs's STRIP_FRAMES table (A1's file, parsed from its
 * source, key index -> depth through the page's rail and key count), then positions
 * in vh of scroll (VH_FRAMES: 1160, the descent into the magical forest; id vh1160).
 * KEYS=stop1,k12,vh1160 picks a subset; STRIP="0,2,12.5" replaces the strip keys and
 * VH="1160,1185" the vh positions.
 *
 * Output: shots/v6/perf/<mode>-<w>x<h>@<dpr>.json and .txt (PERF_OUT overrides the directory).
 * The frames run long: start it in the background and poll the .txt
 *   nohup node world-tests/v6-perf.mjs route > /tmp/perf-route.log 2>&1 &
 * Other agents share the GPU during phase B: frame times are then indicative. Only
 * phase C runs with nothing else rendering count (bible 3.1).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.PERF_OUT ? path.resolve(process.env.PERF_OUT) : path.join(HERE, "shots/v6/perf");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:3111";
const mode = process.argv[2] || "route";
const W = Number(process.argv[3] || 1691), H = Number(process.argv[4] || 1278), DPR = Number(process.argv[5] || 1.5);
const tag = `${mode}-${W}x${H}@${DPR}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Section 3.1, as data ────────────────────────────────────────────────────
const BUDGET = {
  frameMs: { target: 5.0, cap: 6.7, unit: "ms", what: "frame time, burst, PR 1.5" },
  pixelCost: { target: 0.8, cap: 1.1, unit: "ms/MP", what: "pixel cost (fit)" },
  fixedCost: { target: 1.6, cap: 2.0, unit: "ms", what: "fixed cost (fit)" },
  tris: { target: 450000, cap: 600000, unit: "", what: "triangles, reflection included" },
  calls: { target: 60, cap: 80, unit: "", what: "draw calls, reflection included" },
  reflTris: { target: 50000, cap: 80000, unit: "", what: "lake reflection triangles" },
  reflCalls: { target: 12, cap: 16, unit: "", what: "lake reflection calls" },
  skyMs: { target: 0.2, cap: 0.35, unit: "ms", what: "sky dome at PR 1" },
  jsMs: { target: 1.5, cap: 2.5, unit: "ms", what: "JS per moving frame" },
  firstScrollMs: { target: 33, cap: 50, unit: "ms", what: "any frame on the first scroll" },
  installMs: { target: 600, cap: 800, unit: "ms", what: "module install at load" },
  geometryMB: { target: 30, cap: 40, unit: "MB", what: "geometry arrays" },
  textureMB: { target: 14.5, cap: 16, unit: "MB", what: "GPU textures (estimate)" },
};
/** Frames with their own frame time target (bible 3.1); the 6.7 cap holds everywhere. Matched on the strip label. */
const FRAME_TARGETS = [
  [/ride|over the edge|tipping|sinking|falling/i, 6.0],
  [/turn at the pool|the turn/i, 6.0],
  [/a3/i, 6.0],
  [/ledge|a4/i, 5.5],
  [/hike|switchback/i, 5.0],
  [/gate|arch|tail|a8/i, 4.0],
];
function grade(key, value, targetOverride) {
  const b = BUDGET[key];
  if (value === null || value === undefined || !Number.isFinite(value)) return { key, value: null, verdict: "n/a" };
  const target = targetOverride ?? b.target;
  const verdict = value <= target ? "PASS" : value <= b.cap ? "OVER TARGET" : "FAIL";
  return { key, value, target, cap: b.cap, verdict };
}

// ── The page ────────────────────────────────────────────────────────────────
const args = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars", "--disable-gpu-vsync", "--disable-frame-rate-limit"];
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args, protocolTimeout: 85000 });
const page = await browser.newPage();
const errors = [];
const api = [];
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("request", (r) => {
  if (new URL(r.url()).pathname.startsWith("/api")) api.push(r.url());
});
await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
// PERF_TUNE=p0|mid|all (2026-09-28): the dev page's progress fixture before load,
// so the lesson lanterns and waking places are measured lit (all = every halo drawn).
const PERF_TUNES = {
  p0: { lock: "open", frontier: 0, finished: 0, partial: 0 },
  mid: { lock: "open", frontier: 3, finished: 3, partial: 18 },
  all: { lock: "open", frontier: 7, finished: 8, partial: 0 },
};
if (process.env.PERF_TUNE && PERF_TUNES[process.env.PERF_TUNE]) {
  await page.evaluateOnNewDocument((t) => {
    try {
      localStorage.setItem("world-v6:tuning:trail", JSON.stringify(t)); // the current TUNE key (tuning.ts KEY)
    } catch {
      /* ignore */
    }
  }, PERF_TUNES[process.env.PERF_TUNE]);
}
const tLoad = Date.now();
await page.goto(`${BASE}/dev/world-v6`, { waitUntil: "domcontentloaded", timeout: 80000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 80000, polling: 100 });
const readyMs = Date.now() - tLoad;
await sleep(800);
const gpu = await page.evaluate(() => {
  const gl = window.__worldV6Debug.renderer.getContext();
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});

// In-page helpers, installed once.
await page.evaluate((pinTier) => {
  const sc = window.__worldV6Debug;
  const r = sc.renderer;
  const gl = r.getContext();
  const px = new Uint8Array(4);
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
  // Pin the tier so the governor (A2's quality.ts, once A1 wires it) never moves the pixel ratio mid measure.
  if (typeof sc.setQualityTier === "function") sc.setQualityTier(pinTier);
  sc.paused = true; // the page's own loop stops; tick() is driven from here
  const stopLoop = () => {
    if (sc.raf) { cancelAnimationFrame(sc.raf); sc.raf = 0; }
    if (sc.animTimer !== null && sc.animTimer !== undefined) { clearTimeout(sc.animTimer); sc.animTimer = null; }
  };
  const oneFrame = () => {
    sc.paused = false; sc.dirty = true;
    // The frame pacer (perf.FramePacer, 2026-09-28) skips a tick while 2 frames' fences are
    // unsignalled, and WebGL updates a fence only between tasks: 21 ticks in one evaluate
    // drew 2 and skipped 19, so "JS per moving frame" read 0 (2026-10-16). The readPixels
    // below finishes every frame, so its fences are dropped before each tick.
    sc.pacer?.clear();
    const t0 = performance.now();
    sc.tick(performance.now());
    const t1 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t2 = performance.now();
    sc.paused = true;
    stopLoop();
    return { cpu: t1 - t0, sync: t2 - t0 };
  };
  const keyCount = () => sc.ctx?.layout?.TRAIL?.length ?? sc.ctx?.layout?.KEYS?.length ?? null;
  window.__perf = {
    keyCount,
    oneFrame,
    seed(d) {
      window.scrollTo(0, sc.scrollYForDepth(d));
      sc.seedDepth(d);
      stopLoop();
      oneFrame(); oneFrame(); // modules update (zones, LOD, light) at the new pose
    },
    depthForKey(k, n) {
      const u = k / (n - 1);
      const rr = sc.debugRail();
      let lo = 0, hi = rr.length;
      for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (rr.tAtS(m) < u) lo = m; else hi = m; }
      return rr.depthOfS((lo + hi) / 2);
    },
    setPR(p) { r.setPixelRatio(p); },
    pr() { return r.getPixelRatio(); },
    buf() { return [gl.drawingBufferWidth, gl.drawingBufferHeight]; },
    burst(K = 8, reps = 5, warmMs = 250) {
      const scene = sc.debugScene(), cam = sc.camera;
      const t0 = performance.now();
      while (performance.now() - t0 < warmMs) { for (let i = 0; i < K; i++) r.render(scene, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      const per = [];
      for (let j = 0; j < reps; j++) {
        const a = performance.now();
        for (let i = 0; i < K; i++) r.render(scene, cam);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        per.push((performance.now() - a) / K);
      }
      per.sort((x, y) => x - y);
      return { min: +per[0].toFixed(3), med: +per[Math.floor(per.length / 2)].toFixed(3) };
    },
    /** One render with renderer.info accumulating across the lake's nested reflection render: totals and the reflection pass alone. */
    counts() {
      // C1 (B1): a hot reload can rebuild the scene mid run; report null, never throw.
      const scene = sc.debugScene ? sc.debugScene() : null, cam = sc.camera;
      if (!scene || !cam) return null;
      const mirror = scene.getObjectByName("MirrorLake");
      const refl = { tris: 0, calls: 0, ran: false };
      let orig = null;
      if (mirror) {
        orig = mirror.onBeforeRender;
        mirror.onBeforeRender = function (...a) {
          const t = r.info.render.triangles, c = r.info.render.calls;
          orig.apply(this, a);
          refl.tris += r.info.render.triangles - t;
          refl.calls += r.info.render.calls - c;
          refl.ran = true;
        };
      }
      const auto = r.info.autoReset;
      r.info.autoReset = false;
      r.info.reset();
      try { r.render(scene, cam); } finally {
        r.info.autoReset = auto;
        if (mirror) mirror.onBeforeRender = orig;
      }
      return { tris: r.info.render.triangles, calls: r.info.render.calls, reflTris: refl.ran ? refl.tris : null, reflCalls: refl.ran ? refl.calls : null };
    },
    moving(d0, d1, n = 20) {
      const cpu = [];
      for (let i = 0; i <= n; i++) {
        const d = d0 + ((d1 - d0) * i) / n;
        window.scrollTo(0, sc.scrollYForDepth(d));
        sc.seedDepth(d);
        stopLoop();
        cpu.push(oneFrame().cpu);
      }
      return { cpu: med(cpu), cpuMax: Math.max(...cpu) };
    },
    groups() {
      const scene = sc.debugScene();
      const world = scene.getObjectByName("World");
      const list = [];
      for (const o of world.children) list.push(o);
      for (const o of scene.children) if (o !== world && (o.isMesh || o.isPoints || o.isGroup)) list.push(o);
      for (const name of ["V4Blocks", "Water_south", "Water_sky"]) {
        const g = world.getObjectByName(name);
        if (g && g.children.length > 1) for (const o of g.children) list.push(o);
      }
      return list;
    },
    programs() { return r.info.programs.length; },
    stats() { try { return sc.moduleStats(); } catch (e) { return { error: String(e) }; } },
    quality() { return typeof sc.qualityInfo === "function" ? sc.qualityInfo() : null; },
  };
}, Number(process.env.PERF_TIER || 0)); // PERF_TIER=2: measure at a quality tier (default 0)

// ── Positions: the 8 stops, the strip frames and a few vh ──────────────────
const VH_FRAMES = process.env.VH ? process.env.VH.split(",").map((v) => [Number(v), `${v} vh`]) : [[1160, "1160 vh, down to the forest"]];
function stripFrames() {
  if (process.env.STRIP) return process.env.STRIP.split(",").map((k) => [Number(k), `key ${k}`]);
  try {
    const src = fs.readFileSync(path.join(HERE, "v6-strip.mjs"), "utf8");
    const m = src.match(/const STRIP_FRAMES\s*=\s*\[([\s\S]*?)\n\];/);
    if (!m) return null;
    const rows = [...m[1].matchAll(/\[\s*(-?[\d.]+)\s*,\s*"([^"]*)"/g)].map((x) => [Number(x[1]), x[2]]);
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}
const nKeys = await page.evaluate(() => window.__perf.keyCount());
const strip = stripFrames();
const stopDepths = await page.evaluate(() => window.__worldV6Debug.stopDepths());
const PLACE_NAMES = ["a1 Introduction", "a2 Fundamentals", "a3 Video Ads I", "a4 Video Ads II", "a5 Static Ads", "a6 AI Ads & Content", "a7 Creative Strategy", "a8 Job Board"];
const positions = stopDepths.map((d, i) => ({ id: "stop" + (i + 1), label: PLACE_NAMES[i] ?? `stop ${i + 1}`, depth: d }));
if (strip && nKeys) {
  for (const [k, label] of strip) positions.push({ id: "k" + k, label, key: k, depth: await page.evaluate((k, n) => window.__perf.depthForKey(k, n), k, nKeys) });
}
// Positions in vh of scroll (scrollY / innerHeight x 100, the reviews' unit), for stretches
// no strip key covers. 1160: the descent into the magical forest, where the draw calls peak
// (66 here, 67 on the course page, 60 or more from 1145 to 1195 vh, on 2026-10-16) and no
// frame had been timed. VH="1160,1185" replaces the list.
for (const [vh, label] of VH_FRAMES) positions.push({ id: "vh" + vh, label, vh, depth: await page.evaluate((vh) => vh / window.__worldV6Debug.debugRail().totalVh(), vh) });
const want = process.env.KEYS ? process.env.KEYS.split(",") : null;
const chosen = want ? positions.filter((p) => want.includes(p.id)) : positions;

const result = {
  tag, mode, W, H, DPR, gpu, readyMs, when: new Date().toISOString(), nKeys,
  stripSource: process.env.STRIP ? "STRIP env" : strip ? "world-tests/v6-strip.mjs STRIP_FRAMES" : "none found (stops only)",
  quality: await page.evaluate(() => window.__perf.quality()),
  budget: BUDGET, rows: [], summary: {},
};
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const save = () => {
  result.errors = errors;
  result.apiCalls = api;
  fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(result, null, 1));
  fs.writeFileSync(path.join(OUT, `${tag}.txt`), lines.join("\n") + "\n");
};
say(`v6-perf ${mode} ${W}x${H}@${DPR}  gpu: ${gpu}  ready ${readyMs} ms  keys ${nKeys}  strip: ${result.stripSource} (${strip ? strip.length : 0})`);
if (!result.quality) say("  note: qualityInfo()/setQualityTier() not on __worldV6Debug yet (A2-handoff.md pastes 9): tier not pinned");
say("  other renders on this GPU make frame times indicative (bible 3.1)");

async function at(d) {
  await page.evaluate((d) => window.__perf.seed(d), d);
  await sleep(40);
}
const fmt = (g) => (g.value === null ? "  n/a" : `${g.verdict === "PASS" ? "ok" : g.verdict === "FAIL" ? "FAIL" : "over"} ${typeof g.value === "number" ? +g.value.toFixed(g.value < 10 ? 2 : 0) : g.value}`);

if (mode === "route") {
  const worst = {};
  for (const p of chosen) {
    await at(p.depth);
    const counts = (await page.evaluate(() => window.__perf.counts())) ?? { tris: null, calls: null, reflTris: null, reflCalls: null };
    const hi = await page.evaluate(() => { const pr0 = window.__perf.pr(); window.__perf.setPR(1.5); const b = window.__perf.burst(8, 5, 250); const buf = window.__perf.buf(); window.__perf.setPR(pr0); return { ...b, buf }; });
    const lo = await page.evaluate(() => { const pr0 = window.__perf.pr(); window.__perf.setPR(1.0); const b = window.__perf.burst(8, 5, 150); const buf = window.__perf.buf(); window.__perf.setPR(pr0); return { ...b, buf }; });
    const mpHi = (hi.buf[0] * hi.buf[1]) / 1e6, mpLo = (lo.buf[0] * lo.buf[1]) / 1e6;
    const pixelCost = mpHi > mpLo ? (hi.min - lo.min) / (mpHi - mpLo) : null;
    const fixedCost = pixelCost !== null ? lo.min - pixelCost * mpLo : null;
    const mv = await page.evaluate((d) => window.__perf.moving(Math.max(0, d - 0.006), d, 20), p.depth);
    await at(p.depth);
    const programs = await page.evaluate(() => window.__perf.programs());
    const own = FRAME_TARGETS.find(([re]) => re.test(p.label));
    const g = [
      grade("frameMs", hi.min, own ? own[1] : undefined),
      grade("pixelCost", pixelCost),
      grade("fixedCost", fixedCost),
      grade("tris", counts.tris),
      grade("calls", counts.calls),
      grade("reflTris", counts.reflTris),
      grade("reflCalls", counts.reflCalls),
      grade("jsMs", mv.cpu),
    ];
    const row = { ...p, ms15: hi, ms10: lo, mp15: +mpHi.toFixed(2), mp10: +mpLo.toFixed(2), pixelCost, fixedCost, counts, moving: mv, programs, grades: g };
    result.rows.push(row);
    for (const x of g) if (x.value !== null && (!worst[x.key] || x.value > worst[x.key].value)) worst[x.key] = { value: x.value, at: `${p.id} ${p.label}`, verdict: x.verdict };
    say(
      `${p.id.padEnd(7)} ${p.label.slice(0, 30).padEnd(30)} ms1.5 ${fmt(g[0]).padEnd(10)} px ${fmt(g[1]).padEnd(9)} fix ${fmt(g[2]).padEnd(9)} tris ${fmt(g[3]).padEnd(12)} calls ${fmt(g[4]).padEnd(8)} refl ${counts.reflTris ?? "-"}/${counts.reflCalls ?? "-"} js ${fmt(g[7]).padEnd(8)} prog ${programs}`,
    );
    save();
  }
  const stats = await page.evaluate(() => window.__perf.stats());
  const install = stats && stats.install ? Object.values(stats.install).filter((v) => typeof v === "number").reduce((a, b) => a + b, 0) : null;
  result.summary = { worst, install: grade("installMs", install), fails: result.rows.flatMap((r) => r.grades.filter((x) => x.verdict === "FAIL").map((x) => `${r.id} ${x.key} ${x.value}`)) };
  say("");
  say("worst per budget (bible 3.1):");
  for (const [k, w] of Object.entries(worst)) say(`  ${BUDGET[k].what.padEnd(34)} ${String(+w.value.toFixed(2)).padStart(9)} ${BUDGET[k].unit.padEnd(5)} ${w.verdict.padEnd(11)} at ${w.at}  (target ${BUDGET[k].target}, cap ${BUDGET[k].cap})`);
  say(`  module install at load (sum of moduleStats().install) ${install ?? "n/a"} ms: ${result.summary.install.verdict}`);
  say(`FAILS over the hard cap: ${result.summary.fails.length}${result.summary.fails.length ? "\n  " + result.summary.fails.join("\n  ") : ""}`);
} else if (mode === "bpr") {
  const pick = want ? chosen : chosen.filter((p) => p.id.startsWith("stop") || /ride|pool|turn|opening/i.test(p.label));
  for (const p of pick) {
    await at(p.depth);
    const per = [];
    for (const pr of [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]) {
      const m = await page.evaluate((pr) => { const pr0 = window.__perf.pr(); window.__perf.setPR(pr); const b = window.__perf.burst(6, 5, 250); const buf = window.__perf.buf(); window.__perf.setPR(pr0); return { ...b, buf }; }, pr);
      per.push({ pr, mpix: +((m.buf[0] * m.buf[1]) / 1e6).toFixed(2), ms: m.min, med: m.med });
    }
    const n = per.length, sx = per.reduce((q, x) => q + x.mpix, 0), sy = per.reduce((q, x) => q + x.ms, 0);
    const sxx = per.reduce((q, x) => q + x.mpix * x.mpix, 0), sxy = per.reduce((q, x) => q + x.mpix * x.ms, 0);
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
    const g = [grade("pixelCost", b), grade("fixedCost", a)];
    result.rows.push({ ...p, per, fit: { a: +a.toFixed(3), b: +b.toFixed(3) }, grades: g });
    say(`${p.id.padEnd(7)} ${p.label.slice(0, 30).padEnd(30)} ` + per.map((x) => `${x.pr}:${x.ms.toFixed(2)}`).join(" ") + `  fit ${a.toFixed(2)} + ${b.toFixed(2)}/MP  (${g[1].verdict} fixed, ${g[0].verdict} pixel)`);
    save();
  }
} else if (mode === "bgroups") {
  const pick = want ? chosen : chosen.filter((p) => p.id.startsWith("stop") || /opening|ride|pool|turn/i.test(p.label));
  await page.evaluate(() => window.__perf.setPR(1.0));
  for (const p of pick) {
    await at(p.depth);
    const base = await page.evaluate(() => ({ ...window.__perf.burst(8, 6, 400), ...window.__perf.counts() }));
    const names = await page.evaluate(() => window.__perf.groups().map((g, i) => [i, g.name || g.type, g.visible]));
    const rows = [];
    for (const [i, name, vis] of names) {
      if (!vis) continue;
      const m = await page.evaluate((i) => {
        const g = window.__perf.groups()[i];
        g.visible = false;
        try { return { ...window.__perf.burst(8, 4, 60), ...window.__perf.counts() }; } finally { g.visible = true; }
      }, i);
      const dT = base.tris - m.tris, dC = base.calls - m.calls, dG = base.min - m.min;
      if (dT > 0 || dC > 0) rows.push({ name, dTris: dT, dCalls: dC, dMs: +dG.toFixed(2), share: +((100 * dG) / base.min).toFixed(0) });
    }
    rows.sort((a, b) => b.dMs - a.dMs);
    const sky = rows.find((r) => r.name === "LightSky");
    result.rows.push({ ...p, base, groups: rows, sky: grade("skyMs", sky ? sky.dMs : null) });
    say(`${p.id} ${p.label}: tris ${base.tris} calls ${base.calls} ms/frame at PR 1 ${base.min}${sky ? `  sky ${sky.dMs} ms (${grade("skyMs", sky.dMs).verdict})` : ""}`);
    for (const g of rows.slice(0, 14)) say(`   ${g.name.padEnd(26)} dMs ${String(g.dMs).padStart(6)} (${String(g.share).padStart(3)}%) dTris ${String(g.dTris).padStart(7)} dCalls ${g.dCalls}`);
    save();
  }
} else if (mode === "sweep") {
  const N = Number(process.env.STEPS || 500);
  const programsAtLoad = await page.evaluate(() => window.__perf.programs());
  for (const pass of [1, 2]) {
    const rows = [];
    for (let c = 0; c < N; c += 50) {
      const chunk = await page.evaluate(async (c, N, nKeys) => {
        const sc = window.__worldV6Debug, r = sc.renderer, gl = r.getContext();
        const px = new Uint8Array(4);
        const scene = sc.debugScene();
        const L = ["LightSun", "LightMoon", "LightRim"].map((n) => scene.getObjectByName(n));
        const out = [];
        for (let i = c; i < Math.min(N, c + 50); i++) {
          const d = (i / (N - 1)) * sc.depthMax;
          window.scrollTo(0, sc.scrollYForDepth(d));
          sc.seedDepth(d);
          const p0 = r.info.programs.length;
          sc.paused = false; sc.dirty = true;
          sc.pacer?.clear(); // as in oneFrame: else the pacer skips all but 2 ticks of each 50
          const t0 = performance.now();
          sc.tick(performance.now());
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const ms = performance.now() - t0;
          sc.paused = true;
          if (sc.raf) { cancelAnimationFrame(sc.raf); sc.raf = 0; }
          if (sc.animTimer !== null && sc.animTimer !== undefined) { clearTimeout(sc.animTimer); sc.animTimer = null; }
          out.push({ i, d: +d.toFixed(4), key: nKeys ? +(sc.railU() * (nKeys - 1)).toFixed(2) : null, ms: +ms.toFixed(1), prog: r.info.programs.length, newProg: r.info.programs.length - p0, lights: L.map((l) => (l ? (l.visible ? 1 : 0) : "-")).join("") });
          await new Promise((res) => setTimeout(res, 0));
        }
        return out;
      }, c, N, nKeys);
      rows.push(...chunk);
    }
    const spikes = rows.filter((x) => x.ms > BUDGET.firstScrollMs.target);
    const worstFrame = rows.reduce((a, b) => (b.ms > a.ms ? b : a), rows[0]);
    const newPrograms = rows.reduce((a, b) => a + b.newProg, 0);
    const lightChanges = rows.filter((x, j) => j > 0 && x.lights !== rows[j - 1].lights).map((x) => `${x.key}:${x.lights}`);
    const g = [grade("firstScrollMs", worstFrame.ms)];
    const progVerdict = newPrograms === 0 ? "PASS" : "FAIL";
    result.rows.push({ pass, programsAtLoad, newPrograms, programVerdict: progVerdict, worst: worstFrame, grades: g, lightChanges, rows });
    say(`pass ${pass}: ${N} steps, programs ${programsAtLoad} at load, ${rows[0].prog} -> ${rows[rows.length - 1].prog} (${newPrograms} new after load: ${progVerdict}), worst frame ${worstFrame.ms} ms at key ${worstFrame.key} (${g[0].verdict}), frames over 33 ms: ${spikes.length}`);
    for (const s of spikes.slice(0, 20)) say(`   key ${s.key} ms ${s.ms} newProg ${s.newProg} lights ${s.lights}`);
    say(`   light visibility changes: ${lightChanges.length ? lightChanges.join(" ") : "none"}`);
    save();
  }
} else if (mode === "static") {
  const inv = await page.evaluate(() => {
    const sc = window.__worldV6Debug;
    const scene = sc.debugScene();
    const r = sc.renderer;
    const mats = new Map();
    let bytes = 0, meshes = 0, inst = 0;
    const seenGeo = new Set();
    const byGroup = {};
    const world = scene.getObjectByName("World");
    const groupOf = (o) => { let p = o; while (p.parent && p.parent !== world && p.parent !== scene) p = p.parent; return p.name || p.type; };
    const textures = new Map();
    const bpp = (t) => {
      const type = t.type, fmt = t.format;
      // three's constants: Alpha 1021, Luminance 1024, Red 1028 = 1 channel; LuminanceAlpha 1025, RG 1030 = 2; else 4.
      const ch = fmt === 1021 || fmt === 1024 || fmt === 1028 ? 1 : fmt === 1025 || fmt === 1030 ? 2 : 4;
      const per = type === 1015 ? 4 : type === 1016 ? 2 : 1; // Float 4 bytes, HalfFloat 2, else 1
      return ch * per;
    };
    const addTex = (t) => {
      if (!t || !t.isTexture || textures.has(t.uuid)) return;
      const img = t.image || {};
      const w = img.width || (t.source && t.source.data && t.source.data.width) || 0;
      const h = img.height || (t.source && t.source.data && t.source.data.height) || 0;
      const mips = t.generateMipmaps || (t.mipmaps && t.mipmaps.length > 1) ? 4 / 3 : 1;
      textures.set(t.uuid, { name: t.name || t.constructor.name, w, h, bytes: Math.round(w * h * bpp(t) * mips) });
    };
    scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
      meshes++;
      const g = o.geometry;
      const gname = groupOf(o);
      byGroup[gname] = byGroup[gname] || { meshes: 0, bytes: 0, transparent: 0, instances: 0 };
      byGroup[gname].meshes++;
      if (g && !seenGeo.has(g)) {
        seenGeo.add(g);
        for (const a of Object.values(g.attributes)) { const b = a.array ? a.array.byteLength : 0; bytes += b; byGroup[gname].bytes += b; }
        if (g.index) { bytes += g.index.array.byteLength; byGroup[gname].bytes += g.index.array.byteLength; }
      }
      if (o.isInstancedMesh) { inst += o.instanceMatrix.count; byGroup[gname].instances += o.instanceMatrix.count; bytes += o.instanceMatrix.array.byteLength; if (o.instanceColor) bytes += o.instanceColor.array.byteLength; }
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        if (!mats.has(m.uuid)) mats.set(m.uuid, { name: m.name, type: m.type, transparent: m.transparent, alphaTest: m.alphaTest, alphaToCoverage: m.alphaToCoverage, depthWrite: m.depthWrite, blending: m.blending, users: 0 });
        mats.get(m.uuid).users++;
        if (m.transparent) byGroup[gname].transparent++;
        for (const v of Object.values(m)) addTex(v);
        if (m.uniforms) for (const u of Object.values(m.uniforms)) addTex(u && u.value);
      }
    });
    const mirror = scene.getObjectByName("MirrorLake");
    const rt = mirror && mirror.getRenderTarget ? mirror.getRenderTarget() : null;
    const rtBytes = rt ? rt.width * rt.height * 4 * Math.max(1, rt.samples || 1) + rt.width * rt.height * 4 : 0;
    const texBytes = [...textures.values()].reduce((a, b) => a + b.bytes, 0);
    return {
      meshes, instances: inst, geometryMB: +(bytes / 1048576).toFixed(1),
      textures: [...textures.values()].sort((a, b) => b.bytes - a.bytes),
      textureMB: +((texBytes + rtBytes) / 1048576).toFixed(2), reflectionTargetMB: +(rtBytes / 1048576).toFixed(2),
      programs: r.info.programs.length, rendererMemory: { ...r.info.memory },
      materials: [...mats.values()], byGroup,
    };
  });
  const stats = await page.evaluate(() => window.__perf.stats());
  const install = stats && stats.install ? Object.values(stats.install).filter((v) => typeof v === "number").reduce((a, b) => a + b, 0) : null;
  const g = [grade("geometryMB", inv.geometryMB), grade("textureMB", inv.textureMB), grade("installMs", install)];
  result.inventory = inv;
  result.install = stats?.install ?? null;
  result.summary = { grades: g };
  say(`meshes ${inv.meshes}, instances ${inv.instances}, materials ${inv.materials.length}, programs ${inv.programs}`);
  say(`geometry arrays ${inv.geometryMB} MB (${g[0].verdict}); textures ${inv.textureMB} MB incl. reflection target ${inv.reflectionTargetMB} MB (${g[1].verdict}, estimate); module install ${install} ms (${g[2].verdict})`);
  for (const t of inv.textures.slice(0, 12)) say(`   ${String(t.name).padEnd(28)} ${t.w}x${t.h} ${(t.bytes / 1048576).toFixed(2)} MB`);
  for (const [k, v] of Object.entries(stats?.install ?? {})) say(`   install ${k.padEnd(28)} ${v}`);
}
result.errors = errors;
save();
say(`done ${tag}: ${errors.length} console errors, ${api.length} /api calls -> ${path.join(OUT, tag)}.json`);
save();
await browser.close();
