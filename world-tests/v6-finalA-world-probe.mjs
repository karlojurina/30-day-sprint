/**
 * Final pass (fixer "world"): where the lesson lanterns fall in each stop's
 * frame. Sets a progress state, seeds a stop or a route mark, screenshots it,
 * then draws every lantern's projected glass position over the frame
 * (colour per area, a ring on the lit ones, a star on the next one) and
 * screenshots again. Prints the per-area counts in frame.
 *
 *   OUT=<dir> STATE=mid node world-tests/v6-finalA-world-probe.mjs stop:a2 m<mark>[+off] ...
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const OUT = path.resolve(process.env.OUT || "world-tests/shots/v6/finalA/world/probe");
const STATE = process.env.STATE || "mid";
const W = 1691;
const H = 1278;
const items = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
const LESSONS = [8, 10, 22, 22, 25, 22, 22, 14];
const PROG = {
  p0: { lessons: LESSONS, done: [0, 0, 0, 0, 0, 0, 0, 0], current: 0, next: 1, finished: 0 },
  mid: { lessons: LESSONS, done: [8, 10, 22, 18, 0, 0, 0, 0], current: 3, next: 19, finished: 3 + 18 / 22 },
  all: { lessons: LESSONS, done: LESSONS.slice(), current: 8, next: 0, finished: 8 },
};
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.goto("http://localhost:3111/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
await sleep(1500);
const frames = async (n) => {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 15000 }, c0, n);
  } catch {}
};
const setState = async (p) => {
  await page.evaluate((p) => {
    const sc = window.__worldV6Debug;
    sc.setProgress(p.finished);
    sc.setWorldProgress({ lessons: p.lessons, done: p.done, current: p.current, next: p.next });
  }, p);
  await frames(2);
};
const n = await page.evaluate(() => window.__worldV6Debug.ctx?.layout?.TRAIL.length ?? null);
const marks = await page.evaluate(() => window.__worldV6Debug.ctx?.layout?.ROUTE_MARKS ?? null);
const depthForKey = (k) =>
  page.evaluate(
    (k, n) => {
      const r = window.__worldV6Debug.debugRail();
      const u = k / (n - 1);
      let lo = 0;
      let hi = r.length;
      for (let i = 0; i < 60; i++) {
        const m = (lo + hi) / 2;
        if (r.tAtS(m) < u) lo = m;
        else hi = m;
      }
      return r.depthOfS((lo + hi) / 2);
    },
    k,
    n,
  );
const seed = async (d) => {
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    sc.debugPose?.(null);
    sc.park(null);
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
};
await setState(PROG[STATE]);
for (const it of items) {
  const name = it.replace(/[:,+@]/g, "_");
  if (it.startsWith("stop:")) {
    const d = await page.evaluate((i) => window.__worldV6Debug.stopDepths()[i], IDS.indexOf(it.slice(5)));
    await seed(d);
  } else if (it.startsWith("m")) {
    const [nm, off] = it.slice(1).split("+");
    if (marks?.[nm] === undefined) {
      console.log("no mark", nm, Object.keys(marks || {}).join(","));
      continue;
    }
    await seed(await depthForKey(marks[nm] + Number(off || 0)));
  }
  await sleep(300);
  await setState(PROG[STATE]);
  await frames(2);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const info = await page.evaluate(() => {
    const sc = window.__worldV6Debug;
    let glass = null;
    sc.scene.traverse((o) => {
      if (o.name === "ProgressLanternGlass") glass = o;
    });
    const cam = sc.camera;
    cam.updateMatrixWorld();
    const st = glass.geometry.getAttribute("aState");
    const run = glass.geometry.getAttribute("aRun");
    const out = [];
    const m = glass.instanceMatrix.array;
    const V = cam.position.constructor;
    for (let i = 0; i < glass.count; i++) {
      const e = m.slice(i * 16, i * 16 + 16);
      // GLASS = (0.26, 0.66, 0) in the lantern's frame
      const x = e[0] * 0.26 + e[4] * 0.66 + e[12];
      const y = e[1] * 0.26 + e[5] * 0.66 + e[13];
      const z = e[2] * 0.26 + e[6] * 0.66 + e[14];
      const v = new V(x, y, z);
      const dist = v.distanceTo(cam.position);
      v.project(cam);
      out.push({ i, area: run.getX(i), order: run.getY(i), state: st.getX(i), sx: ((v.x + 1) / 2) * innerWidth, sy: ((1 - v.y) / 2) * innerHeight, front: v.z < 1, dist, wx: x, wz: z });
    }
    return { cam: [cam.position.x, cam.position.y, cam.position.z].map(Math.round), l: out };
  });
  const cols = ["#ff4040", "#ffa020", "#ffff40", "#40ff40", "#40ffff", "#4080ff", "#c040ff", "#ff40c0"];
  await page.evaluate(
    (l, cols) => {
      const c = document.createElement("canvas");
      c.id = "probeov";
      c.width = innerWidth;
      c.height = innerHeight;
      c.style.cssText = "position:fixed;inset:0;z-index:99999;pointer-events:none";
      const g = c.getContext("2d");
      g.font = "11px monospace";
      for (const q of l) {
        if (!q.front || q.sx < -20 || q.sx > innerWidth + 20 || q.sy < -20 || q.sy > innerHeight + 20) continue;
        g.strokeStyle = cols[Math.round(q.area)];
        g.fillStyle = cols[Math.round(q.area)];
        g.lineWidth = 2;
        g.beginPath();
        g.arc(q.sx, q.sy, q.state > 1.5 ? 12 : q.state > 0.5 ? 7 : 4, 0, 6.3);
        if (q.state > 0.5) g.stroke();
        else g.fill();
        g.fillText(`${Math.round(q.area) + 1}${q.order > 1 ? "L" : ""}`, q.sx + 8, q.sy - 6);
      }
      document.body.appendChild(c);
    },
    info.l,
    cols,
  );
  await page.screenshot({ path: path.join(OUT, `${name}-ov.png`) });
  await page.evaluate(() => document.getElementById("probeov")?.remove());
  const inFrame = info.l.filter((q) => q.front && q.sx >= 0 && q.sx <= W && q.sy >= 0 && q.sy <= H);
  const by = {};
  for (const q of inFrame) by[Math.round(q.area) + 1] = (by[Math.round(q.area) + 1] || 0) + 1;
  console.log(name, "cam", info.cam.join(","), "inframe", JSON.stringify(by));
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(info));
}
console.log("PROBEDONE");
await browser.close();
