/**
 * Round 1, route stage 1: renders of the falls-to-ridge stretch at Lovro's size.
 *
 *   OUT=<dir> node world-tests/v6-r1-route-shoot.mjs <item> [<item> ...]
 *
 * Items:
 *   k<key>          a fractional TRAIL key (railU = key / (n - 1)), e.g. k28.5
 *   m<name>[+off]   a named frame from layout ROUTE_MARKS (plus a key offset), e.g. mlip, mcave+0.5
 *   stop:<id>       the stop's exact depth (stopDepths()), e.g. stop:a3
 *   park:<id>       the stop's click-in view, e.g. park:a3
 *   pose:x,y,z,bearing,pitch[,fov]   a free debug pose (scene.debugPose), for trying frames
 * Real GPU (bible 4.1), 1691x1278 unless W / H say otherwise. Writes <name>.png
 * and poses.json (camera, pitch, triangles, calls per shot) into OUT.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const OUT = path.resolve(process.env.OUT || "world-tests/shots/v6/round1/route1/tmp");
fs.mkdirSync(OUT, { recursive: true });
const W = Number(process.env.W || 1691);
const H = Number(process.env.H || 1278);
const items = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.setViewport({ width: W, height: H });
await page.goto((process.env.BASE_URL || "http://localhost:3111") + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) throw new Error("world error: " + err);
await sleep(1800);

async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 20000 }, c0, n);
  } catch {
    /* the loop sleeps when nothing moves */
  }
}
async function depthForKey(k) {
  return page.evaluate((k) => {
    const r = window.__worldV6Debug.debugRail();
    const n = window.__worldV6Debug.debugRailKeys ? window.__worldV6Debug.debugRailKeys() : null;
    const u = k / ((n ?? window.__r1Keys) - 1);
    let lo = 0;
    let hi = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (r.tAtS(m) < u) lo = m;
      else hi = m;
    }
    return r.depthOfS((lo + hi) / 2);
  }, k);
}
async function seed(d) {
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    sc.debugPose(null);
    sc.park(null);
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
}
// Key count and named marks, read from layout through the scene's ctx when exposed.
const meta = await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const L = sc.ctx && sc.ctx.layout;
  const n = L ? L.TRAIL.length : null;
  window.__r1Keys = n;
  return { n, marks: L && L.ROUTE_MARKS ? L.ROUTE_MARKS : null };
});
console.log("keys", meta.n, "marks", JSON.stringify(meta.marks));
const poses = {};
for (const it of items) {
  let name = it.replace(/[:,+]/g, "_");
  if (it.startsWith("park:")) {
    const id = it.slice(5);
    const d = await page.evaluate((i) => window.__worldV6Debug.stopDepths()[i], IDS.indexOf(id));
    await seed(d);
    await page.evaluate((id) => window.__worldV6Debug.park(id), id);
    await sleep(3600);
    await frames(3);
  } else if (it.startsWith("stop:")) {
    const id = it.slice(5);
    const d = await page.evaluate((i) => window.__worldV6Debug.stopDepths()[i], IDS.indexOf(id));
    await seed(d);
    await sleep(300);
  } else if (it.startsWith("pose:")) {
    const [x, y, z, bearing, pitch, fov] = it.slice(5).split(",").map(Number);
    await page.evaluate((p) => window.__worldV6Debug.debugPose(p), { x, y, z, bearing, pitch, fov: Number.isFinite(fov) ? fov : undefined });
    await sleep(300);
    await frames(3);
  } else if (it.startsWith("m")) {
    const [nm, off] = it.slice(1).split("+");
    const k = meta.marks?.[nm];
    if (k === undefined) {
      console.log("no mark", nm);
      continue;
    }
    await seed(await depthForKey(k + Number(off || 0)));
    await sleep(300);
  } else {
    await seed(await depthForKey(Number(it.slice(1))));
    await sleep(300);
  }
  await frames(2);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  const inf = await page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    return { cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: +c.pitch.toFixed(1), place: +c.place.toFixed(2), tris: f.triangles, calls: f.calls };
  });
  poses[name] = inf;
  console.log(name, JSON.stringify(inf));
}
await page.evaluate(() => window.__worldV6Debug.debugPose(null));
fs.writeFileSync(path.join(OUT, "poses.json"), JSON.stringify(poses, null, 1));
if (errors.length) console.log("errors:", errors.slice(0, 5).join(" | "));
await browser.close();
