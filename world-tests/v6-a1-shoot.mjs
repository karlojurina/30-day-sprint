/**
 * A1's render harness: frames of the v6 route on the real GPU (Metal).
 *
 *   node world-tests/v6-a1-shoot.mjs <tag> <frame,frame,...> [--w 1691 --h 1278] [--reduced]
 *
 * A frame is a stop ("a1".."a8"), a TRAIL key ("k12", fractional "k12.5"),
 * or a depth ("d0.345"); "k13~A~B" also hides the objects named A and B for
 * that frame (diagnosis). Each is one renderer.render() with the loop paused,
 * read back with readPixels (so no page UI), written to
 * world-tests/shots/v6/A1/<tag>/<frame>.png plus a half-size <frame>_s.png.
 * report.json holds each frame's depth, camera, triangles and calls, the
 * console errors and any /api calls.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const tag = argv[0];
const frames = (argv[1] || "a1").split(",").filter(Boolean);
const W = +flag("--w", 1691);
const H = +flag("--h", 1278);
const reduced = argv.includes("--reduced");
const OUT = path.join(HERE, "shots/v6/A1", tag);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePng(file, rgba, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = y * (w * 3 + 1) + 1 + x * 3;
      raw[d] = rgba[s];
      raw[d + 1] = rgba[s + 1];
      raw[d + 2] = rgba[s + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]));
}
function half(px, w, h) {
  const w2 = Math.floor(w / 2);
  const h2 = Math.floor(h / 2);
  const o = Buffer.alloc(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      for (let c = 0; c < 4; c++) {
        const a = ((2 * y) * w + 2 * x) * 4 + c;
        o[(y * w2 + x) * 4 + c] = (px[a] + px[a + 4] + px[a + w * 4] + px[a + w * 4 + 4]) >> 2;
      }
    }
  }
  return { o, w2, h2 };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 180000,
});
const page = await browser.newPage();
const errors = [];
const api = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + ": " + m.text());
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("request", (r) => {
  if (new URL(r.url()).pathname.startsWith("/api")) api.push(r.url());
});
if (reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await page.setViewport({ width: W, height: H });
const t0 = Date.now();
await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 150000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) {
  console.log("world error: " + err);
  await browser.close();
  process.exit(1);
}
const loadMs = Date.now() - t0;
await sleep(1200);
const depths = await page.evaluate((frames) => {
  const sc = window.__worldV6Debug;
  const stops = sc.stopDepths();
  const r = sc.debugRail();
  const n = sc.ctx.layout.TRAIL.length;
  const depthForU = (u) => {
    let lo = 0;
    let hi = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (r.tAtS(m) < u) lo = m;
      else hi = m;
    }
    return r.depthOfS((lo + hi) / 2);
  };
  return frames.map((f0) => {
    const f = f0.split("~")[0];
    if (/^a[1-8]$/.test(f)) return stops[+f[1] - 1];
    if (f[0] === "k") return depthForU(+f.slice(1) / (n - 1));
    if (f[0] === "d") return +f.slice(1);
    return 0;
  });
}, frames);
const report = { tag, loadMs, frames: {} };
for (let i = 0; i < frames.length; i++) {
  const name = frames[i];
  const d = depths[i];
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  for (let k = 0; k < 4; k++) {
    await page.evaluate((d) => window.__worldV6Debug.seedDepth(d), d);
    await sleep(220);
  }
  const hide = name.split("~").slice(1);
  const res = await page.evaluate((hide) => {
    const sc = window.__worldV6Debug;
    const scene = sc.debugScene();
    const hidden = [];
    for (const n of hide) {
      scene.traverse((o) => {
        if (o.name === n && o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      });
    }
    const renderer = sc.renderer;
    const camera = sc.camera;
    const gl = renderer.getContext();
    sc.setPaused(true);
    const info = renderer.info;
    const auto = info.autoReset;
    info.autoReset = false;
    info.reset();
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const totals = { tris: info.render.triangles, calls: info.render.calls };
    const bw = gl.drawingBufferWidth;
    const bh = gl.drawingBufferHeight;
    const raw = new Uint8Array(bw * bh * 4);
    gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    info.autoReset = auto;
    for (const o of hidden) o.visible = true;
    sc.setPaused(false);
    let s = "";
    for (let i = 0; i < raw.length; i += 0x8000) s += String.fromCharCode.apply(null, raw.subarray(i, i + 0x8000));
    const c = camera.position;
    const dir = camera.getWorldDirection(new camera.position.constructor());
    const bearing = ((Math.atan2(dir.x, -dir.z) * 180) / Math.PI + 360) % 360;
    const pitch = (-Math.asin(dir.y) * 180) / Math.PI;
    return { hidden: hidden.length, bw, bh, totals, b64: btoa(s), cam: [c.x, c.y, c.z].map((v) => Math.round(v * 10) / 10), bearing: Math.round(bearing * 10) / 10, pitch: Math.round(pitch * 10) / 10, fov: Math.round(camera.fov * 10) / 10 };
  }, hide);
  const buf = Buffer.from(res.b64, "base64");
  const px = Buffer.alloc(buf.length);
  const row = res.bw * 4;
  for (let y = 0; y < res.bh; y++) buf.copy(px, y * row, (res.bh - 1 - y) * row, (res.bh - y) * row);
  const fname = name.replace(/~/g, "-");
  writePng(path.join(OUT, `${fname}.png`), px, res.bw, res.bh);
  const s = half(px, res.bw, res.bh);
  writePng(path.join(OUT, `${fname}_s.png`), s.o, s.w2, s.h2);
  report.frames[name] = { depth: d, cam: res.cam, bearing: res.bearing, pitch: res.pitch, fov: res.fov, totals: res.totals };
  console.log(`${name} (hid ${res.hidden}) depth ${d.toFixed(4)} cam ${res.cam.join(",")} brg ${res.bearing} pitch ${res.pitch} fov ${res.fov} tris ${res.totals.tris} calls ${res.totals.calls}`);
}
report.moduleStats = await page.evaluate(() => window.__worldV6Debug.moduleStats());
report.errors = errors;
report.api = api;
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
console.log(`load ${loadMs} ms, console errors/warnings ${errors.length}, /api calls ${api.length}`);
if (errors.length) console.log(errors.slice(0, 10).join("\n"));
await browser.close();
