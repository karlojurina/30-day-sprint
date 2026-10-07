/**
 * Round 1, route stage 2: the airship jiggle. Records, every animation frame,
 * the camera and your airship (the Airship_yours group, as drawn) through the
 * flight, and the ship's pose in the camera's frame, which is what the eye
 * sees: any wobble there is the jiggle.
 *
 *   node world-tests/v6-r1-ship-record.mjs <label> [wheel|seed]
 *
 *   wheel  real mouse wheel ticks (deltaY 100 every 110 ms) from just before
 *          boarding to past the dock, as a person scrolls (the default)
 *   seed   fine seeded depth steps with no scroll smoothing (a function of
 *          route distance only, no time)
 *
 * Out: world-tests/shots/v6/round1/route2/<label>/ship-<mode>.json, one row
 * per frame: t (ms), depth, s, the camera, the ship, the ship in the camera's
 * frame (right, up, back from the eye; yaw, pitch, roll relative), the rail's
 * shipAtS for comparison, and the summary of the high-pass wobble.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const LABEL = process.argv[2] || "run";
const MODE = process.argv[3] || "wheel";
const OUT = path.resolve("world-tests/shots/v6/round1/route2", LABEL);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 600 });
await page.goto((process.env.BASE_URL || "http://localhost:3111") + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
await page.evaluate(() => window.__worldTune && window.__worldTune({ lock: "open", frontier: 7, finished: 7, partial: 0 }));
await sleep(1200);

const range = await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const r = sc.debugRail();
  const [f0, f1] = r.flightS;
  return { d0: r.depthOfS(f0 - 120), d1: r.depthOfS(f1 + 160), f0, f1, total: r.totalVh() };
});
// The recorder: every rAF, the camera and the ship as last drawn.
await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const THREE_ = null;
  void THREE_;
  const scene = sc.debugScene();
  const ship = scene.getObjectByName("Airship_yours");
  const cam = sc.camera;
  window.__rec = [];
  window.__recOn = true;
  const loop = (t) => {
    if (!window.__recOn) return;
    ship.updateWorldMatrix(true, false);
    const cm = cam.matrixWorld.elements.slice();
    const sm = ship.matrixWorld.elements.slice();
    const rp = sc.shipPose();
    window.__rec.push({ t, depth: sc.cameraPose().depth, s: sc.currentS, cm, sm, vis: ship.visible, rail: [rp.x, rp.y, rp.z, rp.heading, rp.bank, rp.throttle, rp.phase] });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
if (MODE === "seed") {
  const N = 900;
  for (let i = 0; i <= N; i++) {
    const d = range.d0 + ((range.d1 - range.d0) * i) / N;
    await page.evaluate((d) => {
      const sc = window.__worldV6Debug;
      window.scrollTo(0, sc.scrollYForDepth(d));
      sc.seedDepth(d);
    }, d);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
} else {
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, range.d0);
  await sleep(600);
  await page.mouse.move(700, 300);
  const t0 = Date.now();
  for (;;) {
    const d = await page.evaluate(() => window.__worldV6Debug.cameraPose().depth);
    if (d >= range.d1 || Date.now() - t0 > 80000) break;
    await page.mouse.wheel({ deltaY: 100 });
    await sleep(110);
  }
  await sleep(800);
}
const rec = await page.evaluate(() => {
  window.__recOn = false;
  return window.__rec;
});
await browser.close();

// Ship in the camera's frame: R^T (p_ship - p_cam), and the relative rotation.
const col = (m, c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rows = [];
for (const r of rec) {
  if (r.s < range.f0 - 120 || r.s > range.f1 + 160) continue;
  const cx = col(r.cm, 0);
  const cy = col(r.cm, 1);
  const cz = col(r.cm, 2);
  const cp = col(r.cm, 3);
  const sx = col(r.sm, 0).map((v) => v);
  const sy = col(r.sm, 1);
  const sp = col(r.sm, 3);
  const d = [sp[0] - cp[0], sp[1] - cp[1], sp[2] - cp[2]];
  const rel = [dot(d, cx), dot(d, cy), dot(d, cz)];
  // The ship's nose (local +x) and up (local +y) in camera axes.
  const nL = Math.hypot(...sx);
  const nose = [dot(sx, cx) / nL, dot(sx, cy) / nL, dot(sx, cz) / nL];
  const uL = Math.hypot(...sy);
  const up = [dot(sy, cx) / uL, dot(sy, cy) / uL, dot(sy, cz) / uL];
  const yaw = (Math.atan2(nose[0], -nose[2]) * 180) / Math.PI;
  const pitch = (Math.asin(Math.max(-1, Math.min(1, nose[1]))) * 180) / Math.PI;
  const roll = (Math.atan2(up[0], up[1]) * 180) / Math.PI;
  rows.push({ t: +r.t.toFixed(1), depth: r.depth, s: +r.s.toFixed(2), u: +(r.s - range.f0).toFixed(2), cam: cp.map((v) => +v.toFixed(2)), ship: sp.map((v) => +v.toFixed(2)), rel: rel.map((v) => +v.toFixed(3)), yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3), roll: +roll.toFixed(3), vis: r.vis, rail: r.rail });
}
// Wobble: each channel minus its centred moving average over +/- 6 frames (the
// eye's "jiggle" is what survives a short smoothing), and per frame changes.
const ch = ["rel0", "rel1", "rel2", "yaw", "pitch", "roll"];
const val = (r, c) => (c.startsWith("rel") ? r.rel[+c[3]] : r[c]);
const summary = {};
for (const c of ch) {
  let worst = { v: 0 };
  let rms = 0;
  let n = 0;
  for (let i = 6; i < rows.length - 6; i++) {
    let a = 0;
    for (let k = -6; k <= 6; k++) a += val(rows[i + k], c);
    const hp = val(rows[i], c) - a / 13;
    rms += hp * hp;
    n++;
    if (Math.abs(hp) > Math.abs(worst.v)) worst = { v: +hp.toFixed(3), u: rows[i].u, t: rows[i].t };
  }
  // Largest single frame step.
  let step = { v: 0 };
  for (let i = 1; i < rows.length; i++) {
    const dv = val(rows[i], c) - val(rows[i - 1], c);
    if (Math.abs(dv) > Math.abs(step.v)) step = { v: +dv.toFixed(3), u: rows[i].u };
  }
  summary[c] = { hpRms: +Math.sqrt(rms / Math.max(1, n)).toFixed(4), hpWorst: worst, maxStep: step };
}
fs.writeFileSync(path.join(OUT, `ship-${MODE}.json`), JSON.stringify({ range, frames: rows.length, summary, rows }, null, 0));
console.log(`${rows.length} frames; flight ${Math.round(range.f0)}-${Math.round(range.f1)}`);
console.log(JSON.stringify(summary, null, 1));
