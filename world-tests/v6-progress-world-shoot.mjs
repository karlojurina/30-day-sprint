/**
 * World progress renders (the lesson lanterns, places waking up): the same
 * frames at three progress states.
 *
 *   OUT=<dir> STATES=p0,mid,all node world-tests/v6-progress-world-shoot.mjs <item> [<item> ...]
 *
 * States (lessons per area 8,10,22,22,25,22,22,14 = 145):
 *   p0   nothing watched, lesson 1 of Introduction next (the cutover state)
 *   mid  58 of 145: areas 1-3 done, 18 of 22 into Video Ads II, lesson 19 next
 *   all  every lesson watched
 * Items: stop:<id> (stopDepths), m<mark>[+off] (layout ROUTE_MARKS),
 *        celebrate:<id>@<ms> (mid state with that area completed, the run
 *        caught <ms> after celebrate(area)).
 * Real GPU (bible 4.1), 1691x1278. Writes <state>/<item>.png and poses.json.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const OUT = path.resolve(process.env.OUT || "world-tests/shots/v6/progress/world/tmp");
const STATES = (process.env.STATES || "p0,mid,all").split(",");
const W = Number(process.env.W || 1691);
const H = Number(process.env.H || 1278);
const items = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
const LESSONS = [8, 10, 22, 22, 25, 22, 22, 14];
const PROG = {
  p0: { lessons: LESSONS, done: [0, 0, 0, 0, 0, 0, 0, 0], current: 0, next: 1, finished: 0 },
  mid: { lessons: LESSONS, done: [8, 10, 22, 18, 0, 0, 0, 0], current: 3, next: 19, finished: 3 + 18 / 22 },
  all: { lessons: LESSONS, done: LESSONS.slice(), current: 8, next: 0, finished: 8 },
};

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
await sleep(1500);

async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 20000 }, c0, n);
  } catch {
    /* the loop sleeps when nothing moves */
  }
}
const meta = await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const L = sc.ctx && sc.ctx.layout;
  return { n: L ? L.TRAIL.length : null, marks: L && L.ROUTE_MARKS ? L.ROUTE_MARKS : null };
});
async function depthForKey(k) {
  return page.evaluate(
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
    meta.n,
  );
}
async function seed(d) {
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    sc.debugPose?.(null);
    sc.park(null);
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
}
async function setState(p) {
  await page.evaluate((p) => {
    const sc = window.__worldV6Debug;
    sc.setProgress(p.finished);
    if (typeof sc.setWorldProgress === "function") sc.setWorldProgress({ lessons: p.lessons, done: p.done, current: p.current, next: p.next });
  }, p);
  await frames(2);
}

const poses = {};
for (const st of STATES) {
  fs.mkdirSync(path.join(OUT, st), { recursive: true });
  await setState(PROG[st]);
  for (const it of items) {
    const name = it.replace(/[:,+@]/g, "_");
    if (it.startsWith("stop:")) {
      const d = await page.evaluate((i) => window.__worldV6Debug.stopDepths()[i], IDS.indexOf(it.slice(5)));
      await seed(d);
      await sleep(350);
    } else if (it.startsWith("celebrate:")) {
      const [id, ms] = it.slice(10).split("@");
      const k = IDS.indexOf(id);
      const d = await page.evaluate((i) => window.__worldV6Debug.stopDepths()[i], k);
      await seed(d);
      const before = PROG[st];
      const done = before.done.slice();
      done[k] = before.lessons[k] - 1;
      await setState({ ...before, done, current: k, next: before.lessons[k], finished: k + (before.lessons[k] - 1) / before.lessons[k] });
      await sleep(400);
      done[k] = before.lessons[k];
      await page.evaluate(
        (p, k) => {
          const sc = window.__worldV6Debug;
          sc.setProgress(k + 1);
          sc.setWorldProgress({ lessons: p.lessons, done: p.done, current: p.current, next: p.next });
          sc.celebrate?.(k);
        },
        { lessons: before.lessons, done, current: Math.min(7, k + 1), next: 1 },
        k,
      );
      await sleep(Number(ms || 500));
    } else if (it.startsWith("m")) {
      const [nm, off] = it.slice(1).split("+");
      const k = meta.marks?.[nm];
      if (k === undefined) {
        console.log("no mark", nm);
        continue;
      }
      await seed(await depthForKey(k + Number(off || 0)));
      await sleep(350);
    }
    // The page re-sends its own fixture progress when it re-renders: put ours back before every shot.
    if (!it.startsWith("celebrate:")) await setState(PROG[st]);
    await frames(2);
    const file = path.join(OUT, st, `${name}.png`);
    await page.screenshot({ path: file });
    const inf = await page.evaluate(() => {
      const f = window.__worldFrame;
      const c = window.__worldCamera();
      const pw = window.__worldV6Debug.getWorldProgress?.();
      return { cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], tris: f?.triangles, calls: f?.calls, done: pw ? pw.done.join(",") : null };
    });
    poses[`${st}/${name}`] = inf;
    console.log(st, name, JSON.stringify(inf));
  }
  if (items.some((i) => i.startsWith("celebrate:"))) await setState(PROG[st]);
}
const pw = await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const st = sc.moduleStats ? sc.moduleStats() : null;
  return st ? st["progress-world"] ?? st : null;
});
console.log("progress-world stats", JSON.stringify(pw));
fs.writeFileSync(path.join(OUT, "poses.json"), JSON.stringify(poses, null, 1));
if (errors.length) console.log("errors:", errors.slice(0, 5).join(" | "));
console.log("SHOOTDONE");
await browser.close();
