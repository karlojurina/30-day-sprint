/**
 * V4 grey pass 2, the camera's own shots: the views rail.ts and scene.ts
 * decide (N2 the dive and the turn, N6 behind the first step, N7 the stars,
 * N8 the bridge at eye height, N9 riding the airship, the Guild Hall stop and
 * its park, and the locked end views).
 *
 *   node world-tests/v5-camera-pass2.mjs <group> [--bare] [--w 960 --h 600]
 *     groups: ride (bridge, cast-off, flight, dock), views (steps, stars, dive,
 *     turn, a8 stop, a8 park; --park-only for the park alone), lock (the
 *     locked ends a2..a7)
 *
 * Opens /dev/world-v5/camera on the running dev server, seeds route distance
 * s (scroll + seedDepth, no glide), waits for a frame drawn after the seed and
 * screenshots. --bare installs no modules: grey terrain and the scene's
 * stand-ins, including the stand-in ship placed from rail.shipAtS. At most six
 * frames per group (SwiftShader ~0.6 s a frame). Writes PNGs and
 * <group>.json to world-tests/shots/v5-pass2/camera/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v5-pass2/camera");
fs.mkdirSync(OUT, { recursive: true });
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const GROUP = process.argv[2] || "ride";
const W = Number(arg("--w", 960));
const H = Number(arg("--h", 600));
const BARE = process.argv.includes("--bare");
const URL = `http://localhost:3111/dev/world-v5/camera${BARE ? "?bare=1" : ""}`;

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 120000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__v4Ready === true || window.__v4Error, { timeout: 80000, polling: 250 });
const err = await page.evaluate(() => window.__v4Error || null);
if (err) {
  console.error("scene failed:", err, logs.join("\n"));
  process.exit(1);
}

const R = await page.evaluate(() => {
  const r = window.__v4.debugRail();
  return { length: r.length, stopS: r.stopS, flightS: r.flightS, stats: window.__v4.moduleStats() };
});
console.log("modules", JSON.stringify(R.stats.install), "stand-ins", R.stats.standIns.length);

/** Route distance of TRAIL key k (bisection on the rail's curve parameter). */
const sKey = (k) =>
  page.evaluate((k) => {
    const r = window.__v4.debugRail();
    const n = 70;
    let lo = 0;
    let hi = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (r.tAtS(m) < k / (n - 1)) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  }, k);

async function goS(s) {
  const f0 = await page.evaluate((s) => {
    const sc = window.__v4;
    const d = sc.debugRail().depthOfS(s);
    const f = window.__v4Frames;
    window.scrollTo({ top: sc.scrollYForDepth(d), left: 0, behavior: "instant" });
    sc.seedDepth(d);
    return f;
  }, s);
  await page.waitForFunction((f0) => window.__v4Frames >= f0 + 1, { timeout: 30000, polling: 100 }, f0);
  return page.evaluate(() => {
    const sc = window.__v4;
    const p = sc.cameraPose();
    const ship = sc.shipPose();
    return {
      depth: +p.depth.toFixed(5),
      railU: +p.railU.toFixed(4),
      pitch: +p.pitch.toFixed(1),
      pos: [p.x, p.y, p.z].map((v) => +v.toFixed(1)),
      ship: { x: +ship.x.toFixed(1), y: +ship.y.toFixed(1), z: +ship.z.toFixed(1), heading: +ship.heading.toFixed(1), bank: +ship.bank.toFixed(2), throttle: +ship.throttle.toFixed(3), phase: ship.phase },
      calls: sc["frame"].calls,
      triangles: sc["frame"].triangles,
    };
  });
}

const [sF, sL] = R.flightS;
const shots = [];
if (GROUP === "ride") {
  shots.push(["bridge-mid", (await sKey(55)) - 20]);
  shots.push(["cast-off-walk", sF - 12]);
  shots.push(["flight-early", sF + 250]);
  shots.push(["flight-turn", sF + 700]);
  shots.push(["flight-late", sF + 1400]);
  shots.push(["dock", sL + 30]);
} else if (GROUP === "views") {
  if (!process.argv.includes("--park-only")) {
    shots.push(["dive-tip", await sKey(15)]);
    shots.push(["turn-gorge", await sKey(20)]);
    shots.push(["steps-behind", await sKey(41)]);
    shots.push(["stars", await sKey(49)]);
    shots.push(["a8-stop", R.stopS[7]]);
  }
  shots.push(["a8-park", R.stopS[7]]);
} else if (GROUP === "lock") {
  const peek = [380, 900, 140, 860, 457, 423, 721];
  for (let f = 1; f < 7; f++) shots.push([`lock-${f + 1}`, Math.min(R.stopS[f] + peek[f], R.stopS[f + 1] - 1)]);
}

const report = { group: GROUP, w: W, h: H, bare: BARE, flightS: R.flightS, shots: [] };
for (const [name, s] of shots) {
  const t = Date.now();
  let pose = await goS(s);
  if (name === "a8-park") {
    const landed = await page.evaluate(async () => {
      const sc = window.__v4;
      await new Promise((r) => setTimeout(r, 300));
      if (!sc.park("a8")) return "refused";
      for (let i = 0; i < 40 && sc["mode"] !== "parked"; i++) await new Promise((r) => setTimeout(r, 250));
      await new Promise((r) => setTimeout(r, 300));
      return sc["mode"];
    });
    if (landed !== "parked") console.log("a8 park did not land:", landed);
    pose = { ...pose, park: await page.evaluate(() => window.__v4.parkInfo()), cam: await page.evaluate(() => window.__v4.cameraPose()) };
  }
  const file = path.join(OUT, `${name}${BARE ? "-bare" : ""}.png`);
  await page.screenshot({ path: file });
  report.shots.push({ name, s: +s.toFixed(1), ...pose, file: path.relative(HERE, file) });
  console.log(`${name.padEnd(16)} s ${s.toFixed(0)} pitch ${pose.pitch} pos ${pose.pos.join(",")} ship ${pose.ship.phase} thr ${pose.ship.throttle} bank ${pose.ship.bank} ${pose.calls} calls ${Math.round(pose.triangles / 1000)}k tri ${((Date.now() - t) / 1000).toFixed(1)}s`);
}
report.errors = logs;
fs.writeFileSync(path.join(OUT, `${GROUP}${BARE ? "-bare" : ""}.json`), JSON.stringify(report, null, 1));
if (logs.length) console.log("console:", logs.slice(0, 8).join("\n"));
await browser.close();
