/**
 * Round 1 verify: a scripted scroll of the WHOLE route at a steady pace, as a
 * video plus per-frame camera data.
 *
 *   node world-tests/v6-r1-verify-scroll.mjs [seconds=80]
 *
 * The page is opened at 1280x720, the whole route unlocked (TUNE lock open),
 * and window.scrollTo is driven every animation frame at a constant rate from
 * the top to the end of the route (the scene's own scroll smoothing runs as
 * for a person). A CDP screencast grabs every compositor frame; an in-page
 * recorder logs, every animation frame, the camera (position, forward, up,
 * fov), the depth, the route distance s and your airship's matrix.
 *
 * Out: world-tests/shots/v6/round1/verify/scroll/{frames/*.jpg, rec.json,
 * info.json, console.json}; then ffmpeg builds verify/scroll.mp4 (30 fps,
 * each captured frame held for its real duration).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const SECONDS = Number(process.argv[2] || 80);
// VERIFY_ROOT: where to write (default round 1's folder); TUNE_STATE: the page fixture as JSON (default 7 places done).
const ROOT = path.resolve(process.env.VERIFY_ROOT || "world-tests/shots/v6/round1/verify");
const TUNE_STATE = process.env.TUNE_STATE ? JSON.parse(process.env.TUNE_STATE) : { lock: "open", frontier: 7, finished: 7, partial: 0 };
const OUT = path.join(ROOT, "scroll");
const FR = path.join(OUT, "frames");
fs.rmSync(FR, { recursive: true, force: true });
fs.mkdirSync(FR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
const api = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warn") errors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("request", (r) => {
  if (new URL(r.url()).pathname.startsWith("/api")) api.push(r.url());
});
await page.setViewport({ width: 1280, height: 720 });
await page.goto((process.env.BASE_URL || "http://localhost:3111") + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const werr = await page.evaluate(() => window.__worldError || null);
if (werr) throw new Error("world error " + werr);
await page.evaluate((t) => window.__worldTune && window.__worldTune(t), TUNE_STATE);
await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  window.scrollTo(0, 0);
  sc.seedDepth(0);
});
await sleep(2500);

const info = await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const r = sc.debugRail();
  const L = sc.ctx.layout;
  const n = L.TRAIL.length;
  // s of each key: invert tAtS by bisection.
  const sOfKey = (k) => {
    const t = k / (n - 1);
    let a = 0;
    let b = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (a + b) / 2;
      if (r.tAtS(m) < t) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  const keyS = [];
  for (let k = 0; k < n; k++) keyS.push(+sOfKey(k).toFixed(2));
  const kinds = [];
  for (let k = 0; k < n; k++) kinds.push(L.TRAIL[k].kind ?? null);
  return {
    keys: n,
    length: r.length,
    totalVh: r.totalVh(),
    pacing: r.pacing(),
    stopS: r.stopS,
    stopDepths: sc.stopDepths(),
    flightS: r.flightS,
    marks: L.ROUTE_MARKS,
    places: L.PLACES.map((p) => [p.id, p.trail, p.name ?? p.title ?? ""]),
    keyS,
    kinds,
    lockLimit: sc.lockLimit(),
    maxY: sc.scrollYForDepth(sc.lockLimit()),
    innerH: window.innerHeight,
  };
});
fs.writeFileSync(path.join(OUT, "info.json"), JSON.stringify(info, null, 1));
console.log(`route ${info.keys} keys, ${Math.round(info.length)} units, ${Math.round(info.totalVh)} vh, maxY ${Math.round(info.maxY)} px`);

// The recorder.
await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const scene = sc.debugScene();
  const ship = scene.getObjectByName("Airship_yours");
  const cam = sc.camera;
  window.__rec = [];
  window.__recOn = true;
  const loop = (t) => {
    if (!window.__recOn) return;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    let sh = null;
    if (ship) {
      ship.updateWorldMatrix(true, false);
      const m = ship.matrixWorld.elements;
      sh = [m[12], m[13], m[14], m[0], m[1], m[2], m[4], m[5], m[6], ship.visible ? 1 : 0];
    }
    const p = sc.cameraPose();
    window.__rec.push({
      t: +t.toFixed(2),
      f: window.__worldFrameCount ?? 0,
      y: window.scrollY,
      d: p.depth,
      s: sc.currentS,
      pos: [e[12], e[13], e[14]],
      fwd: [-e[8], -e[9], -e[10]],
      up: [e[4], e[5], e[6]],
      fov: cam.fov,
      mode: sc.mode ?? null,
      ship: sh,
    });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

// The screencast.
const cdp = await page.createCDPSession();
const shots = [];
cdp.on("Page.screencastFrame", async (fr) => {
  const i = shots.length;
  const file = `f${String(i).padStart(5, "0")}.jpg`;
  shots.push({ file, ts: fr.metadata.timestamp });
  fs.writeFileSync(path.join(FR, file), Buffer.from(fr.data, "base64"));
  try {
    await cdp.send("Page.screencastFrameAck", { sessionId: fr.sessionId });
  } catch {
    /* closing */
  }
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 75, maxWidth: 1280, maxHeight: 720, everyNthFrame: 2 });
await sleep(2000);

// Steady scroll: constant px per ms, driven in the page.
const wallT0 = Date.now() / 1000;
await page.evaluate(
  (ms, maxY) => {
    window.__scrollDone = false;
    const t0 = performance.now();
    window.__scrollT0 = t0;
    const step = (t) => {
      const u = Math.min(1, (t - t0) / ms);
      window.scrollTo(0, Math.round(maxY * u));
      if (u < 1) requestAnimationFrame(step);
      else window.__scrollDone = true;
    };
    requestAnimationFrame(step);
  },
  SECONDS * 1000,
  info.maxY,
);
for (;;) {
  await sleep(2000);
  const done = await page.evaluate(() => window.__scrollDone);
  if (done) break;
}
await sleep(4000);
await cdp.send("Page.stopScreencast");
const rec = await page.evaluate(() => {
  window.__recOn = false;
  return { rows: window.__rec, scrollT0: window.__scrollT0, perfNow: performance.now(), timeOrigin: performance.timeOrigin };
});
await browser.close();
fs.writeFileSync(path.join(OUT, "rec.json"), JSON.stringify(rec));
fs.writeFileSync(path.join(OUT, "shots.json"), JSON.stringify({ wallT0, shots }));
fs.writeFileSync(path.join(OUT, "console.json"), JSON.stringify({ errors, api }, null, 1));
console.log(`${rec.rows.length} rec rows, ${shots.length} screencast frames, console errors+warnings ${errors.length}, /api ${api.length}`);
if (errors.length) console.log(errors.slice(0, 10).join("\n"));

// Video: each frame held until the next one's timestamp, resampled to 30 fps.
const list = [];
for (let i = 0; i < shots.length; i++) {
  const dur = i + 1 < shots.length ? Math.max(0.001, shots[i + 1].ts - shots[i].ts) : 0.5;
  list.push(`file 'frames/${shots[i].file}'`, `duration ${dur.toFixed(4)}`);
}
list.push(`file 'frames/${shots[shots.length - 1].file}'`);
fs.writeFileSync(path.join(OUT, "concat.txt"), list.join("\n") + "\n");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(OUT, "concat.txt"), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "22", "-preset", "veryfast", path.join(ROOT, "scroll.mp4")]);
console.log("video: " + path.join(ROOT, "scroll.mp4"));
