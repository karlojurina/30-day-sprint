/**
 * The a3 -> a4 stretch (Video Ads I to Video Ads II) rendered on the real page
 * (/dev/world-v6, the real GPU), so the move is judged by looking at it.
 *
 *   node world-tests/v6-a3a4-shots.mjs                      14 frames at 1691x1278 -> shots/v6/a3a4/
 *   OUT=<dir> W=1366 H=768 N=12 node world-tests/v6-a3a4-shots.mjs
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

  const rows = [];
  for (let i = 0; i <= N + 1; i++) {
    const d = route.d3 + ((route.d4 - route.d3) * i) / (N + 1);
    await page.evaluate((d) => {
      const sc = window.__worldV6Debug;
      window.scrollTo(0, sc.scrollYForDepth(d));
      sc.seedDepth(d);
    }, d);
    await frames(4);
    const name = `f${String(i).padStart(2, "0")}`;
    await page.screenshot({ path: path.join(OUT, name + ".png") });
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
  fs.writeFileSync(path.join(OUT, "frames.json"), JSON.stringify({ w: W, h: H, ...route, frames: rows }, null, 1));

  // The contact sheet, in order.
  const cols = 4;
  const cellW = 560;
  const cellH = Math.round((cellW * H) / W);
  const html = `<html><body style="margin:0;background:#15171a;font:12px/1.35 -apple-system,Helvetica,sans-serif;color:#e8e4dc">
<div style="padding:8px 8px 0;font-weight:600;font-size:14px">a3 (Video Ads I) to a4 (Video Ads II), ${W}x${H}, ${rows.length} frames evenly spaced in scroll (${rows[0].vh} to ${rows[rows.length - 1].vh} vh)</div>
<div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:6px;padding:6px">
${rows
  .map(
    (r, i) => `<div><img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, r.name + ".png")).toString("base64")}" style="width:${cellW}px;height:${cellH}px;display:block">
<div style="padding:3px 2px 2px"><b>${r.name}${i === 0 ? " · the a3 stop" : i === rows.length - 1 ? " · the a4 stop" : ""}</b> · ${r.vh} vh · ${r.kind}<br>cam ${r.cam.join(", ")} · bearing ${r.bearing} · pitch ${r.pitch} · lens ${r.fov}</div></div>`,
  )
  .join("")}
</div></body></html>`;
  const p2 = await browser.newPage();
  await p2.setViewport({ width: cols * (cellW + 6) + 6, height: Math.ceil(rows.length / cols) * (cellH + 46) + 40 });
  await p2.setContent(html, { waitUntil: "load" });
  await p2.screenshot({ path: path.join(OUT, "sheet.png"), fullPage: true });
  await p2.close();
  console.log(`wrote ${rows.length} frames, frames.json and sheet.png to ${OUT}`);
  if (errors.length) console.log(`page errors: ${errors.length}, first: ${errors[0]}`);
} finally {
  await browser.close();
}
process.exit(errors.length ? 1 : 0);
