/**
 * The a3 -> a4 stretch (Video Ads I to Video Ads II) rendered on the real page
 * (/dev/world-v6, the real GPU), so the move is judged by looking at it.
 *
 *   node world-tests/v6-a3a4-shots.mjs                      14 frames at 1691x1278 -> shots/v6/a3a4/
 *   OUT=<dir> W=1366 H=768 N=12 node world-tests/v6-a3a4-shots.mjs
 *   node world-tests/v6-a3a4-shots.mjs compare [dir]        one image from frames already on disk: for each
 *                                                           position the sets in <dir>/F, <dir>/W and <dir>/fly
 *                                                           one above the other -> <dir>/compare.png
 *                                                           (dir defaults to shots/v6/a3a4-trail)
 *   node world-tests/v6-a3a4-shots.mjs ladder before|after  the rise up the north wall (decision 68, the ladder):
 *                                                           8 frames by route key from the fan's top to the "wall"
 *                                                           mark on the bench's west end (r0..r7), the a3 and a4
 *                                                           stops (a3, a4) and, for "after", three views of the
 *                                                           ladder from off the route (i0..i2) -> shots/v6/ladder/
 *                                                           before|after/ (LADDER_DIR overrides shots/v6/ladder).
 *                                                           At another size (W, H) it writes the rise only, into
 *                                                           before|after/<W>/.
 *   node world-tests/v6-a3a4-shots.mjs ladder pairs         before | after for the 8 rise frames -> shots/v6/ladder/pairs.png
 *
 * The walk along the trail (decision 67, 2026-10-13) was rendered with N=14
 * (16 frames, both stops included) into shots/v6/a3a4-trail/F (facing forward,
 * the route), W (watching the falls, the alternative in the decision log) and
 * fly (the move it replaced, rendered from commit 9c03225), each also at
 * 1366x768 in its 1366/ folder.
 *
 * Frames: the a3 stop, N frames evenly spaced in SCROLL between the two stops
 * (what a student scrolling at a steady speed sees), and the a4 stop: N + 2
 * in all, named f00 (a3) .. f<N+1> (a4). Evenly spaced in scroll, so the dwell
 * at each stop shows as frames that sit close together.
 * Also writes sheet.png (the frames in order, captioned) and frames.json (per
 * frame: scroll vh, route distance, the camera, its bearing, pitch and lens,
 * the rail's kind, and where the falls sit in the frame).
 *
 * Needs the dev server on port 3111 (BASE_URL overrides) and `npm install`
 * once in world-tests/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.env.OUT || path.join(HERE, "shots/v6/a3a4"));
fs.mkdirSync(OUT, { recursive: true });
const W = Number(process.env.W || 1691);
const H = Number(process.env.H || 1278);
const N = Math.max(1, Number(process.env.N || 12));
const BASE = process.env.BASE_URL || "http://localhost:3111";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const LADDER = process.argv[2] === "ladder" ? process.argv[3] : null;
const LADDER_DIR = path.resolve(process.env.LADDER_DIR || path.join(HERE, "shots/v6/ladder"));
/** The ladder's three inspection views, off the route (x, y, z, bearing, pitch down, lens). */
const LADDER_VIEWS = [
  { name: "i0", label: "from the gorge floor, looking up it", x: 300, y: 82, z: 1330, bearing: 35, pitch: -32, fov: 62 },
  { name: "i1", label: "from across the gorge, the whole wall", x: 330, y: 330, z: 1640, bearing: 0, pitch: 12, fov: 50 },
  { name: "i2", label: "from over the bench's lip, looking down it", x: 414, y: 328, z: 1248, bearing: 214, pitch: 62, fov: 70 },
];
if (LADDER === "pairs") {
  // The rise before the ladder and after it, side by side, from the frames on disk.
  const sets = ["before", "after"].map((d) => ({ d, ...JSON.parse(fs.readFileSync(path.join(LADDER_DIR, d, "frames.json"), "utf8")) }));
  const rise = sets.map((q) => q.frames.filter((f) => /^r\d/.test(f.name)));
  const cellW = 760;
  const cellH = Math.round((cellW * sets[0].h) / sets[0].w);
  const png = (d, name) => `data:image/png;base64,${fs.readFileSync(path.join(LADDER_DIR, d, name + ".png")).toString("base64")}`;
  try {
    let html = `<html><body style="margin:0;background:#15171a;font:12px/1.35 -apple-system,Helvetica,sans-serif;color:#e8e4dc"><div style="padding:8px;font-weight:600;font-size:15px">The rise up the north wall, ${sets[0].w}x${sets[0].h}: before the ladder (left) and after (right), the same eight route keys</div><div style="display:grid;grid-template-columns:repeat(2,${cellW}px);gap:6px;padding:6px">`;
    for (let i = 0; i < rise[0].length; i++)
      for (let k = 0; k < 2; k++) {
        const f = rise[k][i];
        html += `<div><img src="${png(sets[k].d, f.name)}" style="width:${cellW}px;height:${cellH}px;display:block"><div style="padding:2px 2px 6px"><b>${sets[k].d} ${f.name}</b> · key ${f.key} · ${f.vh} vh · cam ${f.cam.join(", ")} · bearing ${f.bearing} · pitch ${f.pitch}</div></div>`;
      }
    html += "</div></body></html>";
    const pg = await browser.newPage();
    await pg.setViewport({ width: 2 * (cellW + 6) + 6, height: 900 });
    await pg.setContent(html, { waitUntil: "load" });
    await pg.screenshot({ path: path.join(LADDER_DIR, "pairs.png"), fullPage: true });
    console.log(`wrote ${path.join(LADDER_DIR, "pairs.png")}: ${rise[0].length} pairs`);
  } finally {
    await browser.close();
  }
  process.exit(0);
}
if (process.argv[2] === "compare") {
  // Frames already on disk, one set above the other for each position.
  const DIR = path.resolve(process.argv[3] || path.join(HERE, "shots/v6/a3a4-trail"));
  const SETS = [
    ["F", "facing forward"],
    ["W", "watching the falls"],
    ["fly", "the flying move (9c03225)"],
  ].filter(([d]) => fs.existsSync(path.join(DIR, d, "frames.json")));
  const sets = SETS.map(([d, label]) => ({ d, label, ...JSON.parse(fs.readFileSync(path.join(DIR, d, "frames.json"), "utf8")) }));
  const n = Math.min(...sets.map((q) => q.frames.length));
  const cols = 8;
  const cellW = 420;
  const cellH = Math.round((cellW * sets[0].h) / sets[0].w);
  const img = (d, name) => `data:image/jpeg;base64,${fs.readFileSync(path.join(DIR, d, name + ".jpg")).toString("base64")}`;
  try {
    // Smaller copies for the sheet (the full frames stay as they are).
    const pg = await browser.newPage();
    for (const q of sets)
      for (const f of q.frames.slice(0, n)) {
        await pg.setViewport({ width: cellW * 2, height: cellH * 2 });
        await pg.setContent(`<body style="margin:0"><img src="data:image/png;base64,${fs.readFileSync(path.join(DIR, q.d, f.name + ".png")).toString("base64")}" style="width:${cellW * 2}px;height:${cellH * 2}px;display:block">`, { waitUntil: "load" });
        await pg.screenshot({ path: path.join(DIR, q.d, f.name + ".jpg"), type: "jpeg", quality: 82 });
      }
    let html = `<html><body style="margin:0;background:#15171a;font:12px/1.35 -apple-system,Helvetica,sans-serif;color:#e8e4dc"><div style="padding:8px;font-weight:600;font-size:15px">a3 (Video Ads I) to a4 (Video Ads II): ${n} positions evenly spaced in each version's own scroll. ${sets.map((q) => `${q.label}: ${Math.round(q.frames[n - 1].vh - q.frames[0].vh)} vh`).join(" · ")}</div>`;
    for (let from = 0; from < n; from += cols) {
      html += `<div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:4px;padding:4px 4px 14px">`;
      for (const q of sets)
        for (let i = from; i < Math.min(n, from + cols); i++) {
          const f = q.frames[i];
          html += `<div><img src="${img(q.d, f.name)}" style="width:${cellW}px;height:${cellH}px;display:block"><div style="padding:2px 2px 4px"><b>${q.d} ${f.name}</b> · ${q.label} · ${Math.round(f.vh - q.frames[0].vh)} vh in · cam ${f.cam.join(", ")} · bearing ${f.bearing}</div></div>`;
        }
      html += "</div>";
    }
    html += "</body></html>";
    await pg.setViewport({ width: cols * (cellW + 4) + 4, height: 900 });
    await pg.setContent(html, { waitUntil: "load" });
    await pg.screenshot({ path: path.join(DIR, "compare.png"), fullPage: true });
    console.log(`wrote ${path.join(DIR, "compare.png")}: ${n} positions x ${sets.length} versions`);
  } finally {
    await browser.close();
  }
  process.exit(0);
}
const errors = [];
try {
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  await page.setViewport({ width: W, height: H });
  await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
  const err = await page.evaluate(() => window.__worldError || null);
  if (err) throw new Error("world error: " + err);
  // The intro fade.
  await sleep(1800);

  async function frames(n) {
    const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
    try {
      await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 50, timeout: 8000 }, c0, n);
    } catch {
      /* the loop sleeps once nothing moves */
    }
  }

  const route = await page.evaluate(() => {
    const sc = window.__worldV6Debug;
    const d = sc.stopDepths();
    const r = sc.debugRail();
    const L = sc.ctx.layout;
    return { d3: d[2], d4: d[3], total: r.totalVh(), keys: L.TRAIL.length, a3Key: L.PLACES[2].trail, a4Key: L.PLACES[3].trail, budget: L.PLACES[3].scrollVh };
  });
  console.log(`a3 at ${(route.d3 * route.total).toFixed(1)} vh, a4 at ${(route.d4 * route.total).toFixed(1)} vh (the stretch ${route.budget} vh); ${route.keys} keys, a3 key ${route.a3Key}, a4 key ${route.a4Key}; ${W}x${H}`);

  // The ladder (decision 68): the rise by route key, the two stops, and the views from off the route.
  const ladderPlan = LADDER
    ? await page.evaluate(() => {
        const sc = window.__worldV6Debug;
        const r = sc.debugRail();
        const L = sc.ctx.layout;
        const n = L.TRAIL.length;
        const dAt = (k) => {
          let lo = 0;
          let hi = r.length;
          for (let i = 0; i < 60; i++) {
            const m = (lo + hi) / 2;
            if (r.tAtS(m) < k / (n - 1)) lo = m;
            else hi = m;
          }
          return r.depthOfS((lo + hi) / 2);
        };
        const wall = L.ROUTE_MARKS.wall;
        const d = sc.stopDepths();
        const out = [];
        for (let i = 0; i < 8; i++) out.push({ name: `r${i}`, d: dAt(wall - 3 + (3 * i) / 7) });
        out.push({ name: "a3", d: d[2] }, { name: "a4", d: d[3] });
        return { out, dRise: dAt(wall - 1.5) };
      })
    : null;
  const big = W === 1691 && H === 1278;
  const OUT_L = LADDER ? path.join(LADDER_DIR, LADDER, big ? "" : String(W)) : OUT;
  if (LADDER) fs.mkdirSync(OUT_L, { recursive: true });
  const plan = LADDER ? ladderPlan.out.filter((q) => big || /^r/.test(q.name)) : Array.from({ length: N + 2 }, (_, i) => ({ name: `f${String(i).padStart(2, "0")}`, d: route.d3 + ((route.d4 - route.d3) * i) / (N + 1) }));
  const rows = [];
  for (let i = 0; i < plan.length; i++) {
    const d = plan[i].d;
    await page.evaluate((d) => {
      const sc = window.__worldV6Debug;
      window.scrollTo(0, sc.scrollYForDepth(d));
      sc.seedDepth(d);
    }, d);
    await frames(4);
    const name = plan[i].name;
    await page.screenshot({ path: path.join(OUT_L, name + ".png") });
    const info = await page.evaluate(
      (d, aspect) => {
        const sc = window.__worldV6Debug;
        const r = sc.debugRail();
        const L = sc.ctx.layout;
        const s = r.sOfDepth(d);
        const c = window.__worldCamera();
        const fov = r.fovAtS(s);
        const bearing = ((r.bearingAtS(s) % 360) + 360) % 360;
        const pitch = r.pitchAtS(s);
        // Where the falls sit in the frame (0..1, x from the left, y from the
        // top): their lip, their middle and their foot, on the camera as the
        // rail aims it (bearing, pitch, lens).
        const b = (bearing * Math.PI) / 180;
        const p = (pitch * Math.PI) / 180;
        const f = [Math.sin(b) * Math.cos(p), -Math.sin(p), -Math.cos(b) * Math.cos(p)];
        const rt = [Math.cos(b), 0, Math.sin(b)];
        const up = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]];
        const th = Math.tan((fov * Math.PI) / 360);
        const at = (x, y, z) => {
          const v = [x - c.x, y - c.y, z - c.z];
          const dz = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
          if (dz <= 1) return null;
          const dx = v[0] * rt[0] + v[1] * rt[1] + v[2] * rt[2];
          const dy = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
          return [+(0.5 + dx / dz / th / aspect / 2).toFixed(2), +(0.5 - dy / dz / th / 2).toFixed(2)];
        };
        const F = L.WORLD.falls;
        const mid = (F.top[1] + F.bottom[1]) / 2;
        const [mx, mz] = L.fallsCurtainAt(mid);
        return {
          vh: +(d * r.totalVh()).toFixed(1),
          s: Math.round(s),
          key: +(r.tAtS(s) * (L.TRAIL.length - 1)).toFixed(2),
          kind: r.kindAtS(s),
          cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)],
          bearing: +bearing.toFixed(1),
          pitch: +pitch.toFixed(1),
          fov: +fov.toFixed(1),
          falls: { lip: at(F.top[0], F.top[1], F.top[2]), mid: at(mx, mid, mz), foot: at(F.bottom[0], F.bottom[1], F.bottom[2]) },
          triangles: window.__worldFrame.triangles,
          calls: window.__worldFrame.calls,
        };
      },
      d,
      W / H,
    );
    rows.push({ name, ...info });
    console.log(`${name}  ${String(info.vh).padStart(6)} vh  s ${String(info.s).padStart(5)}  key ${String(info.key).padStart(5)}  ${info.kind.padEnd(5)} cam ${info.cam.join(", ").padEnd(16)} bearing ${String(info.bearing).padStart(5)}  pitch ${String(info.pitch).padStart(5)}  lens ${info.fov}  falls mid ${info.falls.mid ? info.falls.mid.join(" / ") : "behind"}`);
  }
  if (LADDER === "after" && big) {
    // The ladder from off the route, in the light of the middle of the rise.
    for (const v of LADDER_VIEWS) {
      await page.evaluate(
        (d, v) => {
          const sc = window.__worldV6Debug;
          window.scrollTo(0, sc.scrollYForDepth(d));
          sc.seedDepth(d);
          sc.debugPose(v);
        },
        ladderPlan.dRise,
        v,
      );
      await sleep(900);
      await page.screenshot({ path: path.join(OUT_L, v.name + ".png") });
      rows.push({ name: v.name, label: v.label, vh: +(ladderPlan.dRise * route.total).toFixed(1), s: 0, key: 0, kind: "off the route", cam: [v.x, v.y, v.z], bearing: v.bearing, pitch: v.pitch, fov: v.fov, falls: {}, triangles: 0, calls: 0 });
      console.log(`${v.name}  ${v.label}: cam ${v.x}, ${v.y}, ${v.z}  bearing ${v.bearing}  pitch ${v.pitch}  lens ${v.fov}`);
    }
    await page.evaluate(() => window.__worldV6Debug.debugPose(null));
  }
  fs.writeFileSync(path.join(OUT_L, "frames.json"), JSON.stringify({ w: W, h: H, ...route, frames: rows }, null, 1));

  // The contact sheet, in order.
  const cols = 4;
  const cellW = 560;
  const cellH = Math.round((cellW * H) / W);
  const html = `<html><body style="margin:0;background:#15171a;font:12px/1.35 -apple-system,Helvetica,sans-serif;color:#e8e4dc">
<div style="padding:8px 8px 0;font-weight:600;font-size:14px">${LADDER ? `The rise up the north wall, ${LADDER} the ladder, ${W}x${H}: r0..r7 by route key from the fan's top to the bench's west end, then the two stops${LADDER === "after" && big ? " and the ladder from off the route" : ""}` : `a3 (Video Ads I) to a4 (Video Ads II), ${W}x${H}, ${rows.length} frames evenly spaced in scroll (${rows[0].vh} to ${rows[rows.length - 1].vh} vh)`}</div>
<div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:6px;padding:6px">
${rows
  .map(
    (r, i) => `<div><img src="data:image/png;base64,${fs.readFileSync(path.join(OUT_L, r.name + ".png")).toString("base64")}" style="width:${cellW}px;height:${cellH}px;display:block">
<div style="padding:3px 2px 2px"><b>${r.name}${LADDER ? (r.label ? " · " + r.label : r.name === "a3" ? " · the a3 stop" : r.name === "a4" ? " · the a4 stop" : ` · key ${r.key}`) : i === 0 ? " · the a3 stop" : i === rows.length - 1 ? " · the a4 stop" : ""}</b> · ${r.vh} vh · ${r.kind}<br>cam ${r.cam.join(", ")} · bearing ${r.bearing} · pitch ${r.pitch} · lens ${r.fov}</div></div>`,
  )
  .join("")}
</div></body></html>`;
  const p2 = await browser.newPage();
  await p2.setViewport({ width: cols * (cellW + 6) + 6, height: Math.ceil(rows.length / cols) * (cellH + 46) + 40 });
  await p2.setContent(html, { waitUntil: "load" });
  await p2.screenshot({ path: path.join(OUT_L, "sheet.png"), fullPage: true });
  await p2.close();
  console.log(`wrote ${rows.length} frames, frames.json and sheet.png to ${OUT_L}`);
  if (errors.length) console.log(`page errors: ${errors.length}, first: ${errors[0]}`);
} finally {
  await browser.close();
}
process.exit(errors.length ? 1 : 0);
