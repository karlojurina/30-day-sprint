/**
 * Round 1, SKY role: the night sky and the Gate's cloud bank on the real page
 * (1691x1278, GPU), plus a measurement of how your airship moves under the
 * riding camera during the flight.
 *
 *   node world-tests/v6-r1-sky.mjs <label>     (label: before, after, ...)
 *
 * Named frames only (stopDepths, the rail's flightS and kindAtS), never raw
 * KEYS indices. Out: world-tests/shots/v6/round1/sky/<label>/
 *   a7-pre.png, a7.png, a7-post.png, bridge-pre.png, bridge.png   scroll frames
 *   tel-end.png                                                    the telescope park, at rest
 *   flight-a.png, flight-b.png                                     two flight frames
 *   gate-<n>.png  debug poses on the island and the bridge aimed straight at the Gate isle
 *   ship.json     camera in the ship's frame and the bow's screen point along the flight
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.argv[2] || "run";
const ONLY = process.argv[3] || "all";
const OUT = path.join(HERE, "shots/v6/round1/sky", LABEL);
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:3111";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 120000,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
await page.setViewport({ width: 1691, height: 1278 });
await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 80000, polling: 300 });
// Six places finished, Creative Strategy half done: every constellation state shows.
await page.evaluate(() => window.__worldTune && window.__worldTune({ lock: "open", frontier: 6, finished: 6, partial: 5 }));

const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const seedS = async (s) => {
  await page.evaluate((s) => {
    const sc = window.__worldV6Debug;
    const d = sc.debugRail().depthOfS(s);
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, s);
  await frames(3);
};
const R = await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const r = sc.debugRail();
  const stopS = [...r.stopS];
  const bridge = [];
  for (let s = stopS[6]; s < r.flightS[0]; s += 4) if (r.kindAtS(s) === "bridge") bridge.push(s);
  return { stopS, flightS: [...r.flightS], bridge0: bridge[0], bridge1: bridge[bridge.length - 1], length: r.length };
});
console.log("rail", JSON.stringify(R));
const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: path.join(OUT, name + ".png") });
  const p = await page.evaluate(() => window.__worldV6Debug.cameraPose());
  console.log(`${name}: at ${[p.x, p.y, p.z].map((v) => v.toFixed(0)).join(", ")} pitch ${p.pitch.toFixed(1)}`);
};

if (ONLY === "all" || ONLY === "frames") {
  const s7 = R.stopS[6];
  await seedS(s7 - 220);
  await shot("a7-pre");
  await seedS(s7);
  await shot("a7");
  await seedS(s7 + (R.bridge0 - s7) * 0.4);
  await shot("a7-post");
  await seedS(R.bridge0 - 40);
  await shot("bridge-pre");
  await seedS((R.bridge0 + R.bridge1) / 2);
  await shot("bridge");
  const F = R.flightS;
  await seedS(F[0] + (F[1] - F[0]) * 0.3);
  await shot("flight-a");
  await seedS(F[0] + (F[1] - F[0]) * 0.72);
  await shot("flight-b");
  // The turn toward the Gate, where the flight reveals it: the bank must never be in these.
  for (const f of [0.42, 0.5, 0.58, 0.86]) {
    await seedS(F[0] + (F[1] - F[0]) * f);
    await shot("flight-" + Math.round(f * 100));
  }
  // The telescope park, at rest.
  await seedS(s7);
  await page.evaluate(() => window.__worldPark("a7"));
  for (const q of [0.5, 0.8]) {
    await page.waitForFunction((q) => window.__worldFrame.flight >= q, { polling: 16, timeout: 30000 }, q);
    await page.screenshot({ path: path.join(OUT, `tel-q${q}.png`) });
  }
  await page.waitForFunction(() => window.__worldFrame.parkProgress >= 0.999 && window.__worldFrame.flight >= 0.999, { polling: 50, timeout: 30000 });
  await shot("tel-end");
  await page.evaluate(() => window.__worldPark(null));
  await page.waitForFunction(() => window.__worldFrame.parkedId === null && window.__worldFrame.flight >= 0.999, { polling: 50, timeout: 30000 });
}

if (ONLY === "all" || ONLY === "gate") {
  // Debug poses aimed straight at the Gate isle from the island and the bridge.
  const G = { x: -2250, y: 1600, z: -4300 };
  const spots = [
    ["rise-top", -1709, 1715, -1316],
    ["a7-stop", -2290, 1676, -1394],
    ["island-mid", -2000, 1700, -1345],
    ["west-rim", -2450, 1690, -1700],
    ["lookout", -1778, 1672, -2000],
    ["bridge-head", -1848, 1662, -2154],
    ["bridge-end", -1695, 1622, -2341],
    ["bounty", -1600, 1630, -2470],
  ];
  const seen = [];
  await seedS(R.stopS[6]);
  for (const [n, x, y, z] of spots) {
    const bearing = ((Math.atan2(G.x - x, -(G.z - z)) * 180) / Math.PI + 360) % 360;
    await page.evaluate((p) => window.__worldV6Debug.debugPose(p), { x, y, z, bearing, pitch: 0, fov: 31 });
    await frames(3);
    await shot("gate-" + n);
    seen.push(n);
  }
  await page.evaluate(() => window.__worldV6Debug.debugPose(null));
}

if (ONLY === "all" || ONLY === "ship") {
  // The ship under the riding camera: camera in ship-local coordinates and the
  // bow's screen point, 360 samples across the flight.
  const F = R.flightS;
  const rows = [];
  for (let i = 0; i <= 360; i++) {
    const s = F[0] + ((F[1] - F[0]) * i) / 360;
    await seedS(s);
    const row = await page.evaluate(() => {
      const sc = window.__worldV6Debug;
      const scene = sc.debugScene();
      const cam = sc.camera;
      const g = scene.getObjectByName("Airship_yours");
      g.updateMatrixWorld(true);
      cam.updateMatrixWorld(true);
      const V = cam.position.constructor;
      const inv = g.matrixWorld.clone().invert();
      const local = cam.position.clone().applyMatrix4(inv);
      const bow = new V(60, 2, 0).applyMatrix4(g.matrixWorld).project(cam);
      const rail = new V(-10, 6, 15).applyMatrix4(g.matrixWorld).project(cam);
      // The rail's own ship pose (rail.shipAtS, smoothed heading and bank), as the stand-in draws it.
      const sp = sc.shipPose();
      const o = g.clone(false);
      o.position.set(sp.x, sp.y, sp.z);
      o.rotation.set((sp.bank * Math.PI) / 180, ((90 - sp.heading) * Math.PI) / 180, 0, "YXZ");
      o.updateMatrixWorld(true);
      const bowR = new V(60, 2, 0).applyMatrix4(o.matrixWorld).project(cam);
      return {
        bowRail: [bowR.x, bowR.y],
        railBank: sp.bank,
        local: local.toArray(),
        bow: [bow.x, bow.y],
        rail: [rail.x, rail.y],
        rot: [g.rotation.x, g.rotation.y, g.rotation.z],
        railU: sc.railU(),
      };
    });
    rows.push({ s, ...row });
  }
  fs.writeFileSync(path.join(OUT, "ship.json"), JSON.stringify(rows));
  // Jerk in screen space: second difference of the bow's screen point per sample.
  const acc = [];
  for (let i = 1; i < rows.length - 1; i++) {
    const a = rows[i - 1].bow;
    const b = rows[i].bow;
    const c = rows[i + 1].bow;
    acc.push({ i, s: rows[i].s, ax: (a[0] - 2 * b[0] + c[0]) * 845, ay: (a[1] - 2 * b[1] + c[1]) * 639 });
  }
  const accR = [];
  for (let i = 1; i < rows.length - 1; i++) {
    const a = rows[i - 1].bowRail;
    const b = rows[i].bowRail;
    const c = rows[i + 1].bowRail;
    accR.push({ i, ax: (a[0] - 2 * b[0] + c[0]) * 845, ay: (a[1] - 2 * b[1] + c[1]) * 639 });
  }
  const topR = [...accR].sort((p, q) => Math.hypot(q.ax, q.ay) - Math.hypot(p.ax, p.ay)).slice(0, 8);
  console.log("RAIL pose (rail.shipAtS) bow accel, top 8:", topR.map((t) => `i${t.i} ${Math.hypot(t.ax, t.ay).toFixed(2)}`).join(" | "));
  const bk = rows.map((r) => r.rot[0]);
  let maxStep = 0;
  for (let i = 1; i < bk.length; i++) maxStep = Math.max(maxStep, Math.abs(bk[i] - bk[i - 1]));
  const rb = rows.map((r) => (r.railBank * Math.PI) / 180);
  let maxStepR = 0;
  for (let i = 1; i < rb.length; i++) maxStepR = Math.max(maxStepR, Math.abs(rb[i] - rb[i - 1]));
  console.log(`bank step per sample (rad): blocks ${maxStep.toFixed(4)}, rail ${maxStepR.toFixed(4)}`);
  const top = [...acc].sort((p, q) => Math.hypot(q.ax, q.ay) - Math.hypot(p.ax, p.ay)).slice(0, 8);
  console.log("bow screen accel (px per sample^2), top 8:", top.map((t) => `i${t.i} ${Math.hypot(t.ax, t.ay).toFixed(2)}`).join(" | "));
  const lx = rows.map((r) => r.local);
  const span = (k) => Math.max(...lx.map((l) => l[k])) - Math.min(...lx.map((l) => l[k]));
  console.log("camera in ship frame: x span", span(0).toFixed(2), "y span", span(1).toFixed(2), "z span", span(2).toFixed(2));
}

console.log(errors.length ? "page errors: " + errors.slice(0, 3).join(" | ") : "no page errors");
await browser.close();
