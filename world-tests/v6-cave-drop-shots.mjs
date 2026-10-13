/**
 * The falls before and after the cave was taken out of the world (decision
 * 66, 2026-10-13): every view the camera has of the falls and of the cliff
 * the cave's two openings were in, rendered on the real page (/dev/world-v6,
 * the real GPU) so the pairs can be looked at.
 *
 *   node world-tests/v6-cave-drop-shots.mjs before        frames into shots/v6/cave-drop/before/
 *   node world-tests/v6-cave-drop-shots.mjs after         frames into shots/v6/cave-drop/after/
 *   node world-tests/v6-cave-drop-shots.mjs pairs         before | after, side by side, from the frames on disk
 *   STILL=1 node world-tests/v6-cave-drop-shots.mjs after reduced motion (the water's clock stands still), into after-still/:
 *                                                         for a pixel difference, where nothing may move by itself
 *   HIDE=Landmark_a3_Water,FallsSpray node ... inspect    the cliff with the named objects hidden, from close in front of
 *                                                         the falls' foot and of the old side opening, into inspect/
 *
 * Frames, at 1691 x 1278 (W, H override):
 *   ride-NN   every key of the ride down the falls (layout DIVE_KEYS), and the two keys of the turn at the pool
 *   a3-stop   the Video Ads I stop
 *   a3-park   its click in view
 *   move-N    the first third of the a3 -> a4 move, five frames evenly spaced in scroll
 *   a4-stop   the Video Ads II stop
 * Each set also gets sheet.png and frames.json (the camera per frame).
 *
 * Needs the dev server on port 3111 (BASE_URL overrides) and `npm install`
 * once in world-tests/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.OUT || path.join(HERE, "shots/v6/cave-drop"));
const mode = process.argv[2] || "after";
const STILL = !!process.env.STILL;
const W = Number(process.env.W || 1691);
const H = Number(process.env.H || 1278);
const BASE = process.env.BASE_URL || "http://localhost:3111";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});

/** A grid of images with a caption under each. */
async function sheet(file, items, cols, cellW, title) {
  const html = `<html><body style="margin:0;background:#15171a;font:12px/1.35 -apple-system,Helvetica,sans-serif;color:#e8e4dc">
<div style="padding:8px 8px 0;font-weight:600;font-size:14px">${title}</div>
<div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:6px;padding:6px">
${items.map((it) => `<div><img src="data:image/png;base64,${fs.readFileSync(it.file).toString("base64")}" style="width:${cellW}px;display:block"><div style="padding:3px 2px 2px">${it.caption}</div></div>`).join("")}
</div></body></html>`;
  const p = await browser.newPage();
  await p.setViewport({ width: cols * (cellW + 6) + 6, height: 800 });
  await p.setContent(html, { waitUntil: "load" });
  await p.screenshot({ path: file, fullPage: true });
  await p.close();
}

const errors = [];
try {
  if (mode === "pairs") {
    const a = path.join(ROOT, STILL ? "before-still" : "before");
    const b = path.join(ROOT, STILL ? "after-still" : "after");
    const rows = JSON.parse(fs.readFileSync(path.join(b, "frames.json"), "utf8")).frames;
    const items = [];
    for (const r of rows) {
      if (!fs.existsSync(path.join(a, r.name + ".png"))) continue;
      items.push({ file: path.join(a, r.name + ".png"), caption: `<b>${r.name}</b> · before` });
      items.push({ file: path.join(b, r.name + ".png"), caption: `<b>${r.name}</b> · after · ${r.label}` });
    }
    // Four pairs to a sheet, so each frame is large enough to look at.
    for (let k = 0; k * 8 < items.length; k++) {
      const file = path.join(ROOT, `pairs${STILL ? "-still" : ""}-${k + 1}.png`);
      await sheet(file, items.slice(k * 8, k * 8 + 8), 2, 840, `The falls, before and after the cave was removed (${k + 1})`);
      console.log("wrote", file);
    }
  } else {
    const set = mode === "inspect" ? "inspect" : mode + (STILL ? "-still" : "");
    const OUT = path.join(ROOT, set);
    fs.mkdirSync(OUT, { recursive: true });
    const page = await browser.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push("pageerror " + e.message));
    if (STILL) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.setViewport({ width: W, height: H });
    await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
    const err = await page.evaluate(() => window.__worldError || null);
    if (err) throw new Error("world error: " + err);
    await sleep(1800);

    const frames = async (n) => {
      const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
      try {
        await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 50, timeout: 8000 }, c0, n);
      } catch {
        /* the loop sleeps once nothing moves */
      }
    };
    const seed = async (d) => {
      await page.evaluate((d) => {
        const sc = window.__worldV6Debug;
        window.scrollTo(0, sc.scrollYForDepth(d));
        sc.seedDepth(d);
      }, d);
      await frames(4);
    };
    const depthForKey = (k) =>
      page.evaluate((k) => {
        const sc = window.__worldV6Debug;
        const r = sc.debugRail();
        const u = k / (sc.ctx.layout.TRAIL.length - 1);
        let lo = 0;
        let hi = r.length;
        for (let i = 0; i < 60; i++) {
          const m = (lo + hi) / 2;
          if (r.tAtS(m) < u) lo = m;
          else hi = m;
        }
        return r.depthOfS((lo + hi) / 2);
      }, k);
    const camInfo = () =>
      page.evaluate(() => {
        const c = window.__worldCamera();
        const f = window.__worldFrame;
        return { cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: +c.pitch.toFixed(1), triangles: f.triangles, calls: f.calls };
      });
    const route = await page.evaluate(() => {
      const sc = window.__worldV6Debug;
      const L = sc.ctx.layout;
      const d = sc.stopDepths();
      return { dive: L.DIVE_KEYS, a3: L.PLACES[2].trail, d3: d[2], d4: d[3] };
    });
    const rows = [];
    const shoot = async (name, label) => {
      await page.screenshot({ path: path.join(OUT, name + ".png") });
      const info = await camInfo();
      rows.push({ name, label, ...info });
      console.log(`${name.padEnd(10)} ${label.padEnd(46)} cam ${info.cam.join(", ").padEnd(17)} pitch ${String(info.pitch).padStart(5)}  ${info.triangles} tris / ${info.calls} calls`);
    };

    if (mode === "inspect") {
      const hide = (process.env.HIDE || "").split(",").filter(Boolean);
      for (const prefix of hide) console.log(`hidden "${prefix}": ${await page.evaluate((p) => window.__worldHide(p), prefix)} objects`);
      await seed(route.d3);
      // Poses in layout KEYS units (compass bearing, pitch below the horizon).
      const poses = [
        ["foot-front", "in front of the falls' foot, square on", { x: -100, y: 96, z: 1600, bearing: 180, pitch: -2, fov: 50 }],
        ["foot-east", "the foot from the pool's east shore", { x: -20, y: 90, z: 1620, bearing: 222, pitch: -2, fov: 50 }],
        ["foot-west", "the foot from the pool's west shore", { x: -185, y: 90, z: 1620, bearing: 138, pitch: -2, fov: 50 }],
        ["side-front", "the cliff 90 east of the curtain (the old side opening), from the river", { x: 75, y: 96, z: 1585, bearing: 198, pitch: 10, fov: 50 }],
        ["side-west", "the same place from the west, along the cliff's foot", { x: -30, y: 84, z: 1640, bearing: 125, pitch: 2, fov: 50 }],
        ["wall-wide", "the falls' cliff from the gorge's middle", { x: -30, y: 110, z: 1500, bearing: 180, pitch: -4, fov: 58 }],
        ["trail-top", "the pool's east side, the bank and the log, from above the cliff", { x: 20, y: 400, z: 1760, bearing: 2, pitch: 58, fov: 50 }],
        ["trail-east", "the same from over the river, looking back at the cliff", { x: 60, y: 230, z: 1470, bearing: 195, pitch: 48, fov: 55 }],
      ];
      for (const [name, label, pose] of poses) {
        await page.evaluate((p) => window.__worldV6Debug.debugPose(p), pose);
        await frames(6);
        await shoot(name + (hide.length ? "-hidden" : ""), label + (hide.length ? ` (hidden: ${hide.join(", ")})` : ""));
      }
      await page.evaluate(() => window.__worldV6Debug.debugPose(null));
    } else {
      // The ride, key by key, and the turn at the pool.
      for (let k = route.dive.first; k < route.a3; k++) {
        await seed(await depthForKey(k));
        await shoot(`ride-${k}`, k <= route.dive.last ? `the ride down the falls, key ${k}` : `the turn at the pool, key ${k}`);
      }
      await seed(route.d3);
      await shoot("a3-stop", "the Video Ads I stop");
      // The click in view: open the place, wait for the flight to land, close it again.
      await page.evaluate(() => window.__worldPark("a3"));
      await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkedId === "a3" && window.__worldFrame.parkProgress > 0.999 && !window.__worldFrame.flight, { polling: 100, timeout: 20000 }).catch(() => {});
      await sleep(600);
      await frames(4);
      await shoot("a3-park", "the Video Ads I click in view");
      await page.evaluate(() => window.__worldPark(null));
      await page.waitForFunction(() => window.__worldFrame && !window.__worldFrame.parkedId && !window.__worldFrame.flight, { polling: 100, timeout: 20000 }).catch(() => {});
      await sleep(400);
      for (let i = 1; i <= 5; i++) {
        await seed(route.d3 + ((route.d4 - route.d3) * i) / 15);
        await shoot(`move-${i}`, `a3 to a4, ${Math.round((100 * i) / 15)}% of the scroll`);
      }
      await seed(route.d4);
      await shoot("a4-stop", "the Video Ads II stop");
    }
    fs.writeFileSync(path.join(OUT, "frames.json"), JSON.stringify({ set, w: W, h: H, still: STILL, frames: rows }, null, 1));
    await sheet(
      path.join(OUT, "sheet.png"),
      rows.map((r) => ({ file: path.join(OUT, r.name + ".png"), caption: `<b>${r.name}</b> · ${r.label}<br>cam ${r.cam.join(", ")} · ${Math.round(r.triangles / 1000)}k tris / ${r.calls} calls` })),
      4,
      560,
      `The falls: ${set}, ${W}x${H}${STILL ? ", reduced motion" : ""}`,
    );
    console.log(`wrote ${rows.length} frames, frames.json and sheet.png to ${OUT}`);
    if (errors.length) console.log(`page errors: ${errors.length}, first: ${errors[0]}`);
  }
} finally {
  await browser.close();
}
process.exit(errors.length ? 1 : 0);
