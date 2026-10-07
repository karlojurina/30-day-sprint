/**
 * A0, the water split: proof that moving the water out of surfaces.ts and
 * blocks.ts into water.ts changed nothing on screen.
 *
 *   node world-tests/v6-a0-split.mjs shoot <tag>     render the six frames into shots/v6/a0/<tag>/
 *   node world-tests/v6-a0-split.mjs diff <a> <b>    mean absolute luma difference per frame, a vs b
 *
 * Frames (bible 4.2): a1, key 0, key 12, key 19, a5, a7 at 1691x1278, on the
 * real GPU (Metal), reduced motion emulated so every clock (the sea, the
 * ribbons, the falls, the wind) sits at 0 and two runs can be compared pixel
 * for pixel. Each frame is one renderer.render() with the loop paused, read
 * back with readPixels; per owning group triangles and calls are recorded the
 * way v6-gates.mjs attributes them, with the total and moduleStats().
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "shots/v6/a0");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const W = 1691;
const H = 1278;
const [mode, tagA, tagB] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** [name, how to find its depth]: a stop index, or a TRAIL key. */
const FRAMES = [
  ["a1", { stop: 0 }],
  ["key00", { key: 0 }],
  ["key12", { key: 12 }],
  ["key19", { key: 19 }],
  ["a5", { stop: 4 }],
  ["a7", { stop: 6 }],
];

// ── Minimal PNG writer (RGB, no deps) ─────────────────────────────────────────
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

async function shoot(tag) {
  const out = path.join(ROOT, tag);
  fs.mkdirSync(out, { recursive: true });
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
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api")) api.push(r.url());
  });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.setViewport({ width: W, height: H });
  const t0 = Date.now();
  await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 150000, polling: 300 });
  const err = await page.evaluate(() => window.__worldError || null);
  if (err) throw new Error("world error: " + err);
  const loadMs = Date.now() - t0;
  await sleep(1500);
  const renderer = await page.evaluate(() => {
    const gl = window.__worldV6Debug.renderer.getContext();
    const e = gl.getExtension("WEBGL_debug_renderer_info");
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
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
    return frames.map(([, f]) => (f.stop !== undefined ? stops[f.stop] : depthForU(f.key / (n - 1))));
  }, FRAMES);
  const report = { tag, renderer, loadMs, frames: {} };
  for (let i = 0; i < FRAMES.length; i++) {
    const [name] = FRAMES[i];
    const d = depths[i];
    await page.evaluate((d) => {
      const sc = window.__worldV6Debug;
      window.scrollTo(0, sc.scrollYForDepth(d));
      sc.seedDepth(d);
    }, d);
    // A few ticks so every module's update() sees the new camera (zones, adoptions, light).
    for (let k = 0; k < 4; k++) {
      await page.evaluate((d) => window.__worldV6Debug.seedDepth(d), d);
      await sleep(250);
    }
    const res = await page.evaluate(() => {
      const sc = window.__worldV6Debug;
      const scene = sc.debugScene();
      const renderer = sc.renderer;
      const camera = sc.camera;
      const gl = renderer.getContext();
      const world = scene.getObjectByName("World");
      const ownerKey = (o) => {
        let e = o;
        while (e.parent && e.parent !== world && e.parent !== scene) e = e.parent;
        return e.name || e.type;
      };
      sc.setPaused(true);
      const attr = {};
      const info = renderer.info;
      let prevT = 0;
      let prevC = 0;
      const hooked = [];
      scene.traverse((o) => {
        if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
        const base = o.onAfterRender;
        const key = ownerKey(o);
        hooked.push([o, base]);
        o.onAfterRender = function (...a) {
          base.apply(this, a);
          const t = info.render.triangles;
          const c = info.render.calls;
          const k = (renderer.getRenderTarget() ? "mirror:" : "") + key + "/" + o.name;
          const e = attr[k] || (attr[k] = { tris: 0, calls: 0 });
          e.tris += t - prevT;
          e.calls += c - prevC;
          prevT = t;
          prevC = c;
        };
      });
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
      for (const [o, base] of hooked) o.onAfterRender = base;
      sc.setPaused(false);
      let s = "";
      for (let i = 0; i < raw.length; i += 0x8000) s += String.fromCharCode.apply(null, raw.subarray(i, i + 0x8000));
      const c = sc.camera.position;
      return { bw, bh, totals, attr, b64: btoa(s), cam: [c.x, c.y, c.z].map((v) => Math.round(v * 10) / 10) };
    });
    const buf = Buffer.from(res.b64, "base64");
    // readPixels is bottom-up: flip to top-down.
    const px = Buffer.alloc(buf.length);
    const row = res.bw * 4;
    for (let y = 0; y < res.bh; y++) buf.copy(px, y * row, (res.bh - 1 - y) * row, (res.bh - y) * row);
    fs.writeFileSync(path.join(out, `${name}.rgba.gz`), zlib.gzipSync(px, { level: 1 }));
    writePng(path.join(out, `${name}.png`), px, res.bw, res.bh);
    report.frames[name] = { depth: d, w: res.bw, h: res.bh, cam: res.cam, totals: res.totals, attr: res.attr };
    console.log(`${tag} ${name} depth ${d.toFixed(3)} cam ${res.cam.join(",")} tris ${res.totals.tris} calls ${res.totals.calls}`);
  }
  report.moduleStats = await page.evaluate(() => window.__worldV6Debug.moduleStats());
  report.errors = errors;
  report.api = api;
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 1));
  console.log(`${tag}: renderer ${renderer}, load ${loadMs} ms, console errors ${errors.length}, /api calls ${api.length}`);
  if (errors.length) console.log(errors.slice(0, 8).join("\n"));
  await browser.close();
}

function diff(a, b) {
  const ra = JSON.parse(fs.readFileSync(path.join(ROOT, a, "report.json"), "utf8"));
  const rb = JSON.parse(fs.readFileSync(path.join(ROOT, b, "report.json"), "utf8"));
  const rows = [];
  let pass = true;
  for (const [name] of FRAMES) {
    const A = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, a, `${name}.rgba.gz`)));
    const B = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, b, `${name}.rgba.gz`)));
    if (A.length !== B.length) {
      rows.push(`${name}: size differs`);
      pass = false;
      continue;
    }
    let sum = 0;
    let max = 0;
    let over8 = 0;
    const n = A.length / 4;
    for (let i = 0; i < A.length; i += 4) {
      const la = 0.299 * A[i] + 0.587 * A[i + 1] + 0.114 * A[i + 2];
      const lb = 0.299 * B[i] + 0.587 * B[i + 1] + 0.114 * B[i + 2];
      const d = Math.abs(la - lb);
      sum += d;
      if (d > max) max = d;
      if (d > 8) over8++;
    }
    const mean = sum / n;
    const fa = ra.frames[name];
    const fb = rb.frames[name];
    const ok = mean < 1;
    if (!ok) pass = false;
    // Per owner group (the first level under World), summed over its meshes.
    const group = (attr) => {
      const g = {};
      for (const [k, v] of Object.entries(attr)) {
        const key = k.split("/")[0];
        const e = g[key] || (g[key] = { tris: 0, calls: 0 });
        e.tris += v.tris;
        e.calls += v.calls;
      }
      return g;
    };
    const ga = group(fa.attr);
    const gb = group(fb.attr);
    const changed = [];
    for (const k of new Set([...Object.keys(ga), ...Object.keys(gb)])) {
      const x = ga[k] || { tris: 0, calls: 0 };
      const y = gb[k] || { tris: 0, calls: 0 };
      if (x.tris !== y.tris || x.calls !== y.calls) changed.push(`${k} ${x.tris}/${x.calls} -> ${y.tris}/${y.calls}`);
    }
    const top = (g) =>
      Object.entries(g)
        .sort((p, q) => q[1].tris - p[1].tris)
        .slice(0, 5)
        .map(([k, v]) => `${k} ${v.tris}`)
        .join(", ");
    rows.push(
      `${ok ? "PASS" : "FAIL"} ${name}: mean |dL| ${mean.toFixed(4)}, max ${max.toFixed(1)}, px over 8: ${over8}; ` +
        `tris ${fa.totals.tris} -> ${fb.totals.tris}, calls ${fa.totals.calls} -> ${fb.totals.calls}\n` +
        `      top groups A: ${top(ga)}\n      top groups B: ${top(gb)}\n      groups changed: ${changed.join("; ") || "none"}`,
    );
  }
  console.log(rows.join("\n"));
  console.log(pass ? "ALL UNDER 1 LUMA" : "SOME FRAMES DIFFER");
}

if (mode === "shoot" && tagA) await shoot(tagA);
else if (mode === "diff" && tagA && tagB) diff(tagA, tagB);
else {
  console.log("usage: shoot <tag> | diff <a> <b>");
  process.exit(1);
}
