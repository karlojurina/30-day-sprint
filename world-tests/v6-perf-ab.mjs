/**
 * Is the map slower than it was? The working tree's world (src/lib/world-v6/)
 * against a commit's (default HEAD), drawn side by side in one headless Chrome
 * on the real GPU, at the same moment, measured in turn.
 *
 *   node world-tests/v6-perf-ab.mjs [--base HEAD] [--rounds 4] [--keys stop3,k20]
 *
 * WHY. Frame times measured hours apart on a busy machine (other agents'
 * browsers, a browser tab, Spotlight) drift by 0.1 to 0.3 ms per frame, the
 * size of the change a review asks about. On 2026-10-15 a rise of 0.18 ms at
 * Video Ads I's stop between two v6-perf.mjs runs, one before and one after
 * the review's items 1 to 13, came out as +0.02 ms here: the machine, not
 * the code. Measured together, both worlds share whatever the machine does.
 *
 * NO DEV SERVER. The commit's src/lib/world-v6/ comes from `git archive` (read
 * only), the working tree's is copied as it is at the start, both are turned
 * into browser modules with the repo's TypeScript (transpile only) and served
 * to Chrome by request interception from shots/v6/perf-ab/ (git-ignored),
 * three.js from node_modules. Nothing is written to the repo and nothing asks
 * localhost. The page is /dev/world-v6's scene without its React page: the same
 * constructor options, the dev tuning's progress (Introduction and
 * Fundamentals done, 4 of Video Ads I watched: the lanterns v6-perf.mjs sees
 * lit), the checkpoint closed, quality tier 0.
 *
 * HOW. Positions are v6-perf.mjs's: the 8 stops, v6-strip.mjs's strip keys and
 * the vh positions (vh1160, the descent into the magical forest), through each
 * world's own rail. At each one, R rounds, each measuring the
 * base's page then the working tree's (the other way round on odd rounds),
 * each measurement v6-perf.mjs's route burst: pixel ratio 1.5, 8 renders, 5
 * times, the fastest. A page is brought to the front and seeded again before
 * every burst (a page in the background does not take a seed). Then the whole
 * run again with the pages opened in the other order (the second page opened
 * measured about 0.02 ms slower on 2026-10-15). A position's effect is the
 * median difference of its pairs, averaged over the two runs.
 *
 * VERDICT. Slower when the mean effect over all positions is over +0.03 ms, or
 * when a position is over +0.15 ms after it is measured again with 3 times
 * the rounds. On 2026-10-15 an A/A run (the same commit on both pages, 4
 * rounds) had a spread of 0.06 ms per position and a mean of -0.007 ms.
 *
 * WHERE LOVRO MOVED THE ROUTE (MOVED below). A position on a stretch whose
 * camera path was changed on purpose, at Lovro's request, shows another view
 * in each world: there the A/B asks whether the working tree draws the SAME
 * view slower. Both worlds are drawn from the working tree's camera at that
 * position (pinned with the scene's debugPose, each world seeded at its own
 * depth for it, so its light and modules follow its own rail point), and
 * that pair is the position's effect. Each world's own view is measured too
 * and printed beside it ("own views"), so what the new view costs stays in
 * the record; v6-perf.mjs grades that against the frame budget. Second Loom,
 * 2026-10-16: k39.5, inside the turn after the Video Ads II hut, which goes
 * clockwise now (Lovro: "clockwise and not this way into the world"): the
 * old view there was the valley's haze, the new one the wall's skyline and
 * the lit spur, about 1.5 ms dearer at 1691 x 1278 @ 1.5.
 *
 * NOT IN IT: the page's interface over the canvas (measured on /dev/world-v6
 * on 2026-10-15, shown against hidden, interleaved: -0.03 to +0.05 ms over
 * 10 positions, median +0.03), the
 * lesson pages, a phone, a slower GPU. Two worlds are drawn by one GPU in
 * turn, so the numbers are a comparison; v6-perf.mjs still gives the frame
 * time against the art bible's budget (section 3.1).
 *
 * Output: shots/v6/perf-ab/ab-<base>-<w>x<h>@<dpr>.json and .txt (PERF_OUT=dir moves it
 * and the working copies). Exit 1 when slower.
 * About 7 minutes for the whole route.
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
// PERF_OUT moves the whole working folder (its copies of both worlds included), as in
// v6-perf.mjs, so two runs at once never write over each other.
const OUT = process.env.PERF_OUT ? path.resolve(process.env.PERF_OUT) : path.join(HERE, "shots", "v6", "perf-ab");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HOST = "perf-ab.test";
const W = 1691, H = 1278, DPR = 1.5;
const MEAN_MAX = 0.03;
const ONE_MAX = 0.15;
/** Positions on a stretch Lovro had the route changed on purpose: compared at the working tree's camera (see the header). */
const MOVED = {
  "k39.5": "second Loom point 3 (2026-10-16): the turn after the Video Ads II hut goes clockwise",
};

const argv = process.argv.slice(2);
const flag = (n, d = null) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] ?? d : d);
const BASE = flag("--base", "HEAD");
const ROUNDS = Math.max(2, Number(flag("--rounds", 4)));
const KEYS = flag("--keys") ? flag("--keys").split(",") : null;
const git = (cmd) => execSync(`git ${cmd}`, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let baseRev;
try {
  baseRev = git(`rev-parse --short ${JSON.stringify(BASE)}`);
} catch {
  console.error(`--base ${BASE}: not a commit`);
  process.exit(2);
}
const tag = `ab-${baseRev}-${W}x${H}@${DPR}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The two worlds as browser modules ───────────────────────────────────────
const require = createRequire(path.join(REPO, "package.json"));
const ts = require("typescript");
function transpile(srcDir, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(srcDir)) {
    if (!f.endsWith(".ts")) continue;
    const r = ts.transpileModule(fs.readFileSync(path.join(srcDir, f), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, isolatedModules: true, useDefineForClassFields: true },
      fileName: f,
    });
    // The browser needs the extension: from "./x" and import("./x") get ".js".
    const js = r.outputText
      .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (m, a, p, b) => (p.endsWith(".js") ? m : `${a}${p}.js${b}`))
      .replace(/(import\(\s*["'])(\.\.?\/[^"']+?)(["']\s*\))/g, (m, a, p, b) => (p.endsWith(".js") ? m : `${a}${p}.js${b}`));
    fs.writeFileSync(path.join(outDir, f.replace(/\.ts$/, ".js")), js);
    n++;
  }
  return n;
}
fs.mkdirSync(OUT, { recursive: true });
const baseSrc = path.join(OUT, "src-base");
fs.rmSync(baseSrc, { recursive: true, force: true });
fs.mkdirSync(baseSrc, { recursive: true });
execSync(`git archive ${baseRev} src/lib/world-v6 | tar -x -C ${JSON.stringify(baseSrc)}`, { cwd: REPO, stdio: ["ignore", "ignore", "inherit"] });
const workSrc = path.join(OUT, "src-work");
fs.rmSync(workSrc, { recursive: true, force: true });
fs.cpSync(path.join(REPO, "src", "lib", "world-v6"), workSrc, { recursive: true });
const workAt = new Date().toISOString();
const nBase = transpile(path.join(baseSrc, "src", "lib", "world-v6"), path.join(OUT, "base"));
const nWork = transpile(workSrc, path.join(OUT, "work"));
// Each world's own module list, in its scene.ts's install order (DEFAULT_MODULES).
for (const v of ["base", "work"]) {
  const scene = fs.readFileSync(path.join(OUT, v, "scene.js"), "utf8");
  const list = [...scene.matchAll(/\[\s*"([\w-]+)"\s*,\s*\(\)\s*=>\s*import\(\s*"\.\/([\w-]+)\.js"\s*\)\s*\]/g)].map((m) => m[2]);
  if (list.length < 10) throw new Error(`${v}: scene.js's module list was not found (${list.length} entries)`);
  fs.writeFileSync(path.join(OUT, v, "modules.json"), JSON.stringify(["layout", ...list]));
}
const changed = git(`diff --name-only ${baseRev} -- src/lib/world-v6`).split("\n").filter(Boolean).map((f) => path.basename(f));

// The modules are evaluated one at a time in scene.ts's install order (each
// world's modules.json), as the page's bundle does: started all at once, the
// rocks / dress-gate / dress-sky import cycle can evaluate dress-gate before
// dress-sky (a TDZ error on `lin`).
fs.writeFileSync(
  path.join(OUT, "harness.html"),
  `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#0b0b0b}#stage{position:fixed;inset:0;z-index:0;background:#0b0b0b}#spacer{width:1px}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/examples/jsm/":"/node_modules/three/examples/jsm/"}}</script>
</head><body><div id="stage" aria-hidden="true"></div><div id="spacer"></div>
<script>window.process = { env: { NODE_ENV: "development" } };</script>
<script type="module">
const v = new URLSearchParams(location.search).get("v");
try {
  for (const m of await (await fetch("/" + v + "/modules.json")).json()) await import("/" + v + "/" + m + ".js");
  const mod = await import("/" + v + "/scene.js");
  const L = await import("/" + v + "/layout.js");
  const pacing = [...L.PLACES.map((p) => p.scrollVh), L.TAIL_VH, L.FLIGHT_VH];
  const sc = new mod.WorldScene(document.getElementById("stage"), { lock: { mode: "open", frontier: 2 }, pacing, poster: "off" });
  // The dev tuning's student (tuning.ts DEFAULT_TUNING, study.ts studyFor): 2 places done, 4 of the third watched.
  const lessons = [8, 10, 22, 22, 25, 22, 22, 14];
  const done = [8, 10, 4, 0, 0, 0, 0, 0];
  const progress = 2 + 4 / 22;
  sc.setProgress(progress);
  sc.setWorldProgress({ lessons, done, current: 2, next: 5 });
  sc.setCheckpoint("closed");
  sc.bindSpacer(document.getElementById("spacer"));
  sc.onFrame(() => {});
  sc.setPaused(false);
  sc.start();
  await sc.load();
  sc.setLock("open", 2);
  sc.setProgress(progress);
  window.__worldReady = true;
} catch (e) {
  window.__worldError = String((e && e.stack) || e);
}
</script></body></html>`,
);

function fileFor(u) {
  const p = decodeURIComponent(u.pathname);
  if (p === "/harness.html") return path.join(OUT, "harness.html");
  if (p.startsWith("/node_modules/three/")) return path.join(REPO, p);
  const m = p.match(/^\/(base|work)\/([\w.-]+\.js(?:on)?)$/);
  return m ? path.join(OUT, m[1], m[2]) : null;
}

// ── One browser, two pages ──────────────────────────────────────────────────
const BURST = () => {
  window.__ab = (() => {
    const sc = window.__worldV6Debug;
    const r = sc.renderer;
    const gl = r.getContext();
    const px = new Uint8Array(4);
    if (typeof sc.setQualityTier === "function") sc.setQualityTier(0);
    sc.paused = true;
    const stopLoop = () => {
      if (sc.raf) { cancelAnimationFrame(sc.raf); sc.raf = 0; }
      if (sc.animTimer !== null && sc.animTimer !== undefined) { clearTimeout(sc.animTimer); sc.animTimer = null; }
    };
    const oneFrame = () => {
      sc.paused = false; sc.dirty = true;
      sc.tick(performance.now());
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      sc.paused = true;
      stopLoop();
    };
    return {
      keyCount: () => sc.ctx?.layout?.TRAIL?.length ?? null,
      stops: () => sc.stopDepths(),
      depthForKey(k, n) {
        const u = k / (n - 1);
        const rr = sc.debugRail();
        let lo = 0, hi = rr.length;
        for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (rr.tAtS(m) < u) lo = m; else hi = m; }
        return rr.depthOfS((lo + hi) / 2);
      },
      seed(d) {
        window.scrollTo(0, sc.scrollYForDepth(d));
        sc.seedDepth(d);
        stopLoop();
        oneFrame(); oneFrame();
      },
      // The camera where the seeded depth puts it, in debugPose's terms (MOVED positions).
      pose() {
        const c = sc.cameraPose();
        return { x: c.x, y: c.y, z: c.z, bearing: (Math.atan2(c.dx, -c.dz) * 180) / Math.PI, pitch: c.pitch, fov: sc.camera.fov };
      },
      // Pin the camera there (null releases it), then draw as seed() does. The
      // frame pacer skips a tick while earlier frames are in flight, and a
      // skipped tick leaves the camera where it was, so it is cleared first;
      // a pin that did not take throws rather than measure the wrong view.
      pin(p) {
        sc.debugPose(p);
        stopLoop();
        for (let i = 0; i < 2; i++) { sc.pacer?.clear?.(); oneFrame(); }
        if (!p) return;
        const c = sc.cameraPose();
        if (Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z) > 0.01) throw new Error(`debugPose did not take: camera at ${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)}`);
      },
      counts() {
        const auto = r.info.autoReset;
        r.info.autoReset = false;
        r.info.reset();
        try { r.render(sc.debugScene(), sc.camera); } finally { r.info.autoReset = auto; }
        return { tris: r.info.render.triangles, calls: r.info.render.calls };
      },
      // v6-perf.mjs's route burst at pixel ratio 1.5: 8 renders, 5 times, the fastest per frame.
      burst(K = 8, reps = 5, warmMs = 250) {
        const pr0 = r.getPixelRatio();
        r.setPixelRatio(1.5);
        const scene = sc.debugScene(), cam = sc.camera;
        const t0 = performance.now();
        while (performance.now() - t0 < warmMs) { for (let i = 0; i < K; i++) r.render(scene, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
        let best = Infinity;
        for (let j = 0; j < reps; j++) {
          const a = performance.now();
          for (let i = 0; i < K; i++) r.render(scene, cam);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          best = Math.min(best, (performance.now() - a) / K);
        }
        r.setPixelRatio(pr0);
        return best;
      },
    };
  })();
};

async function openWorld(browser, v, errors) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(`${v}: ${String(e.message).slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${v}: ${m.text().slice(0, 200)}`); });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    let u;
    try { u = new URL(req.url()); } catch { return req.abort(); }
    if (u.hostname !== HOST) return req.abort();
    if (u.pathname === "/favicon.ico") return req.respond({ status: 204, body: "" });
    const f = fileFor(u);
    if (!f || !fs.existsSync(f)) return req.respond({ status: 404, contentType: "text/plain", body: "" });
    req.respond({ status: 200, contentType: f.endsWith(".html") ? "text/html" : f.endsWith(".json") ? "application/json" : "text/javascript", body: fs.readFileSync(f) });
  });
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
  await page.goto(`http://${HOST}/harness.html?v=${v}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 150000, polling: 200 });
  const err = await page.evaluate(() => window.__worldError ?? null);
  if (err) throw new Error(`the ${v} world did not build: ${err}`);
  await sleep(800);
  await page.evaluate(BURST);
  return page;
}

/** v6-perf.mjs's positions in vh of scroll: 1160, the descent into the magical forest (second Loom, 2026-10-16). */
const VH_FRAMES = [[1160, "1160 vh, down to the forest"]];

async function positionsOf(page) {
  const n = await page.evaluate(() => window.__ab.keyCount());
  const stops = await page.evaluate(() => window.__ab.stops());
  const out = stops.map((d, i) => ({ id: `stop${i + 1}`, depth: d }));
  const src = fs.readFileSync(path.join(HERE, "v6-strip.mjs"), "utf8");
  const m = src.match(/const STRIP_FRAMES\s*=\s*\[([\s\S]*?)\n\];/);
  for (const [, k, label] of m ? m[1].matchAll(/\[\s*(-?[\d.]+)\s*,\s*"([^"]*)"/g) : []) {
    out.push({ id: `k${k}`, label, depth: await page.evaluate((k, n) => window.__ab.depthForKey(k, n), Number(k), n) });
  }
  // v6-perf.mjs's vh positions, through each world's own scroll budget.
  for (const [vh, label] of VH_FRAMES) out.push({ id: `vh${vh}`, label, depth: await page.evaluate((vh) => vh / window.__worldV6Debug.debugRail().totalVh(), vh) });
  return out;
}

async function measure(page, depth, pose = null) {
  await page.bringToFront();
  return page.evaluate((d, p) => {
    window.__ab.seed(d);
    if (!p) return window.__ab.burst();
    window.__ab.pin(p);
    try { return window.__ab.burst(); } finally { window.__ab.pin(null); }
  }, depth, pose);
}
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };

/** One pass: a fresh browser, the two pages opened in `order`, each position of `ids` (null: all, or --keys) R rounds. */
async function pass(order, ids, rounds, errors) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
    protocolTimeout: 180000,
  });
  try {
    const pages = {};
    for (const v of order) pages[v] = await openWorld(browser, v, errors);
    const pos = { base: await positionsOf(pages.base), work: await positionsOf(pages.work) };
    const out = {};
    for (const id of ids ?? pos.work.map((p) => p.id).filter((id) => !KEYS || KEYS.includes(id))) {
      const pb = pos.base.find((p) => p.id === id);
      const pw = pos.work.find((p) => p.id === id);
      if (!pb || !pw) continue;
      // A MOVED position: both worlds drawn from the working tree's camera there.
      await pages.work.bringToFront();
      const pin = MOVED[id] ? await pages.work.evaluate((d) => { window.__ab.seed(d); return window.__ab.pose(); }, pw.depth) : null;
      const countsAt = (page, d, p) => page.evaluate((d, p) => {
        window.__ab.seed(d);
        if (!p) return window.__ab.counts();
        window.__ab.pin(p);
        try { return window.__ab.counts(); } finally { window.__ab.pin(null); }
      }, d, p);
      await pages.base.bringToFront();
      const cBase = await countsAt(pages.base, pb.depth, pin);
      await pages.work.bringToFront();
      const cWork = await countsAt(pages.work, pw.depth, pin);
      const base = [], work = [], ownBase = [], ownWork = [];
      for (let r = 0; r < rounds; r++) {
        for (const v of r % 2 ? ["work", "base"] : ["base", "work"]) (v === "base" ? base : work).push(await measure(pages[v], v === "base" ? pb.depth : pw.depth, pin));
        if (pin) for (const v of r % 2 ? ["work", "base"] : ["base", "work"]) (v === "base" ? ownBase : ownWork).push(await measure(pages[v], v === "base" ? pb.depth : pw.depth));
      }
      out[id] = { label: pb.label ?? "", base, work, d: median(work.map((x, i) => x - base[i])), counts: { base: cBase, work: cWork } };
      if (pin) out[id].own = { base: ownBase, work: ownWork, d: median(ownWork.map((x, i) => x - ownBase[i])), pose: pin, why: MOVED[id] };
    }
    return out;
  } finally {
    await browser.close();
  }
}

const errors = [];
const t0 = Date.now();
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
say(`v6-perf-ab ${W}x${H}@${DPR}: the working tree's src/lib/world-v6 (copied ${workAt}; changed against ${baseRev}: ${changed.join(", ") || "nothing"}) against ${baseRev}'s, ${nWork} and ${nBase} modules; ${ROUNDS} rounds, 2 passes`);
const p1 = await pass(["base", "work"], null, ROUNDS, errors);
const ids = Object.keys(p1);
const p2 = await pass(["work", "base"], ids, ROUNDS, errors);
const rows = ids.filter((id) => p1[id] && p2[id]).map((id) => ({ id, label: p1[id].label, effect: (p1[id].d + p2[id].d) / 2, pass1: p1[id], pass2: p2[id], baseMin: Math.min(...p1[id].base, ...p2[id].base), workMin: Math.min(...p1[id].work, ...p2[id].work) }));
// A position over the line is measured again, with 3 times the rounds, both orders.
const again = rows.filter((r) => r.effect > ONE_MAX).map((r) => r.id);
if (again.length) {
  say(`measured again with ${ROUNDS * 3} rounds: ${again.join(", ")}`);
  const q1 = await pass(["base", "work"], again, ROUNDS * 3, errors);
  const q2 = await pass(["work", "base"], again, ROUNDS * 3, errors);
  for (const r of rows) if (q1[r.id] && q2[r.id]) { r.first = r.effect; r.effect = (q1[r.id].d + q2[r.id].d) / 2; r.again = { pass1: q1[r.id], pass2: q2[r.id] }; }
}
const f2 = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}`;
for (const r of rows) {
  const c = r.pass1.counts;
  say(`${r.id.padEnd(7)} ${(r.label || "").slice(0, 30).padEnd(30)} ${baseRev} ${r.baseMin.toFixed(2)}  work ${r.workMin.toFixed(2)} ms  effect ${f2(r.effect)}${r.first !== undefined ? ` (first ${f2(r.first)})` : ""}  tris ${c.base.tris}->${c.work.tris}  calls ${c.base.calls}->${c.work.calls}`);
  const own = [r.pass1.own, r.pass2.own].filter(Boolean);
  if (own.length) {
    r.own = { base: Math.min(...own.flatMap((o) => o.base)), work: Math.min(...own.flatMap((o) => o.work)), effect: own.reduce((s, o) => s + o.d, 0) / own.length, why: own[0].why };
    say(`        the same view in both worlds (the working tree's camera; ${r.own.why}); own views ${r.own.base.toFixed(2)} -> ${r.own.work.toFixed(2)} ms, ${f2(r.own.effect)}: the new view's own cost, graded by v6-perf.mjs`);
  }
}
const effects = rows.map((r) => r.effect);
const mean = effects.reduce((s, x) => s + x, 0) / Math.max(1, effects.length);
const over = rows.filter((r) => r.effect > ONE_MAX);
const slower = mean > MEAN_MAX || over.length > 0;
say("");
say(`mean effect ${f2(mean)} ms (line ${MEAN_MAX}), median ${f2(median(effects))}, the working tree slower at ${effects.filter((x) => x > 0).length} of ${effects.length}, over ${ONE_MAX} at ${over.length}${over.length ? `: ${over.map((r) => r.id).join(", ")}` : ""}`);
say(`${slower ? "SLOWER" : "NOT SLOWER"} than ${baseRev}. ${errors.length} page errors. ${((Date.now() - t0) / 60000).toFixed(1)} min`);
if (errors.length) say(`  ${errors.slice(0, 5).join("\n  ")}`);
fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify({ base: baseRev, workAt, changed, W, H, DPR, rounds: ROUNDS, meanMax: MEAN_MAX, oneMax: ONE_MAX, mean, slower, rows, errors, when: new Date().toISOString() }, null, 1));
fs.writeFileSync(path.join(OUT, `${tag}.txt`), lines.join("\n") + "\n");
process.exit(slower || errors.length ? 1 : 0);
