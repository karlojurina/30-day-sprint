/**
 * V4 camera: renders the real scene (src/lib/world-v5/scene.ts) at the eight
 * stops and through the dive, the lake reveal and the rise, plus two parks.
 *
 *   node world-tests/v5-camera-shots.mjs [--bare] [--w 960 --h 600] [--only stops|dive|lake|rise|open|park|lock]
 *
 * --only lock asserts the three locking modes and a live setPacing in the page.
 *
 * Opens /dev/world-v5/camera (the scene with no interface) on the running
 * dev server, seeds each depth (scroll + seedDepth, so no glide to wait
 * out), waits for the frame drawn after the seed and screenshots. --bare installs no
 * modules (grey terrain and stand-ins only). Writes PNGs and report.json to
 * world-tests/shots/v5/camera/. SwiftShader: ~0.6 s a frame at 960x600.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v5/camera");
fs.mkdirSync(OUT, { recursive: true });
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const W = Number(arg("--w", 960));
const H = Number(arg("--h", 600));
const BARE = process.argv.includes("--bare");
const ONLY = arg("--only", "");
const URL = `http://localhost:3111/dev/world-v5/camera${BARE ? "?bare=1" : ""}`;

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });
const t0 = Date.now();
await page.waitForFunction(() => window.__v4Ready === true || window.__v4Error, { timeout: 180000, polling: 250 });
const err = await page.evaluate(() => window.__v4Error || null);
if (err) {
  console.error("scene failed:", err, logs.join("\n"));
  process.exit(1);
}
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const info = await page.evaluate(() => {
  const s = window.__v4;
  return { stops: s.stopDepths(), stopU: s.stopU(), spacerVh: s.spacerVh(), stats: s.moduleStats(), landmarks: s.landmarkNames() };
});
console.log("stops", info.stops.map((d) => d.toFixed(4)).join(" "), "spacer", info.spacerVh, "vh");
console.log("modules", JSON.stringify(info.stats.install), "stand-ins", info.stats.standIns.join(", "));

/** Seed a depth (scroll and camera together), wait for two frames, return the pose. */
async function goDepth(d) {
  // The counter is read before the seed, so the frame waited for is one drawn after it.
  // The loop sleeps once converged, so exactly one new frame is guaranteed.
  const f0 = await page.evaluate((d) => {
    const s = window.__v4;
    const f = window.__v4Frames;
    window.scrollTo({ top: s.scrollYForDepth(d), left: 0, behavior: "instant" });
    s.seedDepth(d);
    return f;
  }, d);
  await page.waitForFunction((f0) => window.__v4Frames >= f0 + 1, { timeout: 60000, polling: 100 }, f0);
  return page.evaluate(() => {
    const s = window.__v4;
    const p = s.cameraPose();
    const fr = { d: p.depth, u: p.railU, place: p.place, pitch: p.pitch, pos: [p.x, p.y, p.z].map(Math.round) };
    return fr;
  });
}

const rail = await page.evaluate(() => {
  const r = window.__v4.debugRail();
  return { length: r.length, stopS: r.stopS };
});
const dOfS = (s) => page.evaluate((s) => window.__v4.debugRail().depthOfS(s), s);

const shots = [];
const names = ["a1-landing", "a2-camp", "a3-falls", "a4-climb", "a5-lake", "a6-forest", "a7-island", "a8-skyport"];
if (!ONLY || ONLY === "stops") for (let i = 0; i < 8; i++) shots.push({ name: `stop-${names[i]}`, d: info.stops[i] });
if (!ONLY || ONLY === "dive") {
  // The dive: from the rim to the pool, by route distance between a2 and a3.
  const s2 = rail.stopS[1];
  const s3 = rail.stopS[2];
  for (const [k, f] of [["1-rim", 0.62], ["2-lip", 0.68], ["3-over", 0.72], ["4-steep", 0.76], ["5-down", 0.8], ["6-low", 0.85], ["7-level", 0.92]]) {
    shots.push({ name: `dive-${k}`, d: await dOfS(s2 + (s3 - s2) * f) });
  }
}
if (!ONLY || ONLY === "lake") {
  const s5 = rail.stopS[4];
  const s6 = rail.stopS[5];
  for (const [k, f] of [["1-tilt", 0.2], ["2-up", 0.35], ["3-across", 0.55]]) shots.push({ name: `lake-${k}`, d: await dOfS(s5 + (s6 - s5) * f) });
}
if (!ONLY || ONLY === "rise") {
  const s6 = rail.stopS[5];
  const s7 = rail.stopS[6];
  for (const [k, f] of [["1-foot", 0.25], ["2-up", 0.45], ["3-clouds", 0.65], ["4-rim", 0.85]]) shots.push({ name: `rise-${k}`, d: await dOfS(s6 + (s7 - s6) * f) });
}
if (!ONLY || ONLY === "open") shots.push({ name: "open-0", d: 0 });

const report = { w: W, h: H, bare: BARE, info, shots: [] };
for (const sh of shots) {
  const t = Date.now();
  const pose = await goDepth(sh.d);
  const file = path.join(OUT, `${sh.name}${BARE ? "-bare" : ""}.png`);
  await page.screenshot({ path: file });
  // The scene's own frame record (private field, harness only): what the last render drew.
  const budget = await page.evaluate(() => ({ calls: window.__v4["frame"].calls, triangles: window.__v4["frame"].triangles }));
  report.shots.push({ ...sh, pose, budget, file: path.relative(HERE, file) });
  console.log(`${sh.name.padEnd(20)} d ${sh.d.toFixed(4)} u ${pose.u.toFixed(3)} place ${pose.place.toFixed(2)} pitch ${pose.pitch.toFixed(1)} pos ${pose.pos.join(",")}  ${budget.calls} calls ${Math.round(budget.triangles / 1000)}k tri  ${((Date.now() - t) / 1000).toFixed(1)}s`);
}

if (!ONLY || ONLY === "park") {
  for (const id of ["a3", "a5"]) {
    const i = Number(id.slice(1)) - 1;
    await goDepth(info.stops[i]);
    await page.evaluate((id) => window.__v4.park(id), id);
    await page.waitForFunction(() => window.__v4.cameraPose && window.__v4.parkInfo() !== null, { timeout: 30000 });
    // Let the flight finish: frames advance ~0.05 s of flight each on SwiftShader.
    await page.waitForFunction(() => {
      const s = window.__v4;
      return s["mode"] === "parked";
    }, { timeout: 120000, polling: 200 });
    const pi = await page.evaluate(() => window.__v4.parkInfo());
    const file = path.join(OUT, `park-${id}${BARE ? "-bare" : ""}.png`);
    await page.screenshot({ path: file });
    report.shots.push({ name: `park-${id}`, park: pi, file: path.relative(HERE, file) });
    console.log(`park-${id} dist ${pi.dist.toFixed(0)} (rail ${pi.railDist.toFixed(0)}) pitch ${pi.pitch} yaw ${pi.yaw} visible ${pi.visible.toFixed(2)} height ${pi.heightFrac.toFixed(2)}`);
    await page.evaluate(() => window.__v4.park(null));
    await page.waitForFunction(() => window.__v4["mode"] === "rail", { timeout: 120000, polling: 200 });
  }
}

if (ONLY === "lock") {
  // The three locking modes and a live retune, asserted in the page.
  const r = await page.evaluate(async () => {
    const s = window.__v4;
    const out = {};
    const vh = window.innerHeight / 100;
    const markers = () => s["frame"].markers.map((m) => (m.enterable ? "E" : m.beyond ? "b" : "?")).join("");
    s.setLock("open", 0);
    out.open = { spacer: s.spacerVh(), limit: s.lockLimit(), markers: markers(), parkA5: s.isEnterable("a5") };
    s.setLock("look", 2);
    out.look = { spacer: s.spacerVh(), limit: s.lockLimit(), markers: markers(), parkA5: s.isEnterable("a5"), parkA3: s.isEnterable("a3") };
    const blocks = s.moduleStats();
    out.lookMist = blocks.blocks ? JSON.stringify(blocks.blocks).match(/mist[^,]*/gi) : null;
    s.setLock("locked", 2);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.scrollTo({ top: 1e7, left: 0, behavior: "instant" });
    await new Promise((r) => setTimeout(r, 300));
    out.locked = {
      spacer: s.spacerVh(),
      spacerEl: document.querySelector("[aria-hidden=true]").style.height,
      limit: s.lockLimit(),
      stopA3: s.stopDepths()[2],
      scrollDepth: s.scrollDepth(),
      parkA5: s.park("a5"),
      markers: markers(),
    };
    s.setLock("open", 0);
    // Live retune: double a3's stretch; the camera stays at the same point on the route.
    s.seedDepth(s.stopDepths()[1] + 0.02);
    window.scrollTo({ top: s.scrollYForDepth(s.stopDepths()[1] + 0.02), left: 0, behavior: "instant" });
    await new Promise((r) => setTimeout(r, 200));
    const before = s.cameraPose();
    s.setPacing([150, 170, 560, 190, 200, 190, 280, 170], 40);
    await new Promise((r) => setTimeout(r, 400));
    const after = s.cameraPose();
    out.retune = {
      spacer: s.spacerVh(),
      moved: Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z),
      depthBefore: before.depth,
      depthAfter: after.depth,
      scrollVhAfter: window.scrollY / vh,
      a3Stretch: (s.stopDepths()[2] - s.stopDepths()[1]) * (s.spacerVh() - 100),
    };
    s.setPacing([150, 170, 280, 190, 200, 190, 280, 170], 40);
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  const ok =
    r.open.markers === "EEEEEEEE" &&
    r.look.markers === "EEEbbbbb" && r.look.limit === 1 && r.look.parkA5 === false && r.look.parkA3 === true &&
    r.locked.parkA5 === false && Math.abs(r.locked.scrollDepth - r.locked.limit) < 1e-3 && r.locked.limit > r.locked.stopA3 && r.locked.limit < r.locked.stopA3 + 0.05 &&
    r.retune.moved < 1 && Math.abs(r.retune.a3Stretch - 560) < 0.5 && r.retune.spacer === 2050;
  console.log(ok ? "LOCK + RETUNE: PASS" : "LOCK + RETUNE: FAIL");
  report.lock = r;
}

const worst = report.shots.filter((x) => x.budget).reduce((a, x) => ({ calls: Math.max(a.calls, x.budget.calls), triangles: Math.max(a.triangles, x.budget.triangles) }), { calls: 0, triangles: 0 });
report.worstBudget = worst;
console.log(`worst frame: ${worst.calls} draw calls, ${Math.round(worst.triangles / 1000)}k triangles (budget 90 / 700k)`);
report.logs = logs.filter((l) => /error|warn/i.test(l)).slice(0, 40);
fs.writeFileSync(path.join(OUT, `report${BARE ? "-bare" : ""}.json`), JSON.stringify(report, null, 1));
if (report.logs.length) console.log("console:\n  " + report.logs.join("\n  "));
await browser.close();
