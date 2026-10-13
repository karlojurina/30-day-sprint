/**
 * Phase A verify: the opening and the 8 stops at 1691x1278 on the real GPU,
 * with the measurements the phase B builders start from.
 *
 *   node world-tests/v6-averify-stops.mjs            render + measure (about 60-90 s)
 *   node world-tests/v6-averify-stops.mjs sheet      contact sheet from what is on disk
 *
 * Per frame: the page screenshot (what the student sees, UI included), an ID
 * pass as v6-gates.mjs builds it (sky = nothing drawn once the sky dome,
 * stars and clouds are hidden; the landmark = the stop's LM_ group), and
 * perf.burstProbe at pixel ratio 1.5 (the budget's ratio; 8 renders, one
 * sync, fastest of 5). Out: world-tests/shots/v6/A/stops/{id}.png, {id}-id.png,
 * report.json, sheet-stops.png.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v6/A/stops");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const W = 1691;
const H = 1278;
const argv = process.argv.slice(2);

/** [id, caption, landmark group (null for the opening), stop index (-1 = depth 0)] */
const FRAMES = [
  ["k0", "the opening (key 0)", "UpperFalls_StandIn", -1],
  ["a1", "a1 Introduction · The Landing", "LM_Signpost", 0],
  ["a2", "a2 Fundamentals · Base Camp", "LM_Lookout", 1],
  ["a3", "a3 Video Ads I · the falls", "LM_Waterfall", 2],
  ["a4", "a4 Video Ads II · The Gorge Trail", "LM_TrailHut", 3],
  ["a5", "a5 Static Ads · The Mirror Lake", "LM_Boathouse", 4],
  ["a6", "a6 AI Ads & Content · The Glowing Forest", "LM_GreatTree", 5],
  ["a7", "a7 Creative Strategy · The Sky Island", "LM_Observatory", 6],
  ["a8", "a8 Job Board · The Gate of the Sun", "LM_StoneArch", 7],
];

async function sheet(file, items, cols, cellW) {
  const cellH = Math.round((cellW * H) / W);
  const html = `<html><body style="margin:0;background:#15171a;font:13px/1.35 -apple-system,Helvetica,sans-serif;color:#e8e4dc">
  <div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:8px;padding:8px">
  ${items
    .map(
      (it) => `<div><img src="data:image/png;base64,${fs.readFileSync(it.file).toString("base64")}" style="width:${cellW}px;height:${cellH}px;display:block">
  <div style="padding:4px 2px 2px">${it.caption}</div></div>`,
    )
    .join("")}
  </div></body></html>`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
  const p = await browser.newPage();
  await p.setViewport({ width: cols * (cellW + 8) + 8, height: Math.ceil(items.length / cols) * (cellH + 60) + 16 });
  await p.setContent(html, { waitUntil: "load" });
  await p.screenshot({ path: file, fullPage: true });
  await browser.close();
}

function makeSheet() {
  const rep = JSON.parse(fs.readFileSync(path.join(OUT, "report.json"), "utf8"));
  const items = rep.frames.map((r) => ({
    file: path.join(OUT, `${r.id}.png`),
    caption: `<b>${r.caption}</b> · key ${r.key} · sky ${r.skyPct}% · ${r.lm}: ${r.lmX === null ? "not in frame" : `x ${r.lmX} (${r.lmPct}%)`} · ${r.frameMs} ms @PR1.5 · ${Math.round(r.triangles / 1000)}k / ${r.calls}`,
  }));
  return sheet(path.join(OUT, "sheet-stops.png"), items, 3, 560);
}

if (argv.includes("sheet")) {
  await makeSheet();
  console.log("sheet written");
  process.exit(0);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
const api = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warn") errors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("request", (r) => {
  if (new URL(r.url()).pathname.startsWith("/api")) api.push(r.url());
});
await page.setViewport({ width: W, height: H });
const t0 = Date.now();
await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) throw new Error("world error: " + err);
const loadS = (Date.now() - t0) / 1000;
const info = await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const L = sc.ctx?.layout ?? null;
  return {
    keys: L ? L.TRAIL.length : null,
    places: L ? L.PLACES.map((p) => [p.id, p.trail]) : null,
    quality: sc.qualityInfo ? sc.qualityInfo() : null,
    gpu: (() => {
      const gl = sc.renderer.getContext();
      const e = gl.getExtension("WEBGL_debug_renderer_info");
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null;
    })(),
  };
});
console.log(`ready in ${loadS.toFixed(1)} s, ${info.keys} keys, gpu ${info.gpu}`);

const rows = [];
for (const [id, caption, lm, stopIndex] of FRAMES) {
  const d = stopIndex < 0 ? 0 : await page.evaluate((i) => window.__worldV6Debug.stopDepths()[i], stopIndex);
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await page.evaluate(async () => {
    const c0 = window.__worldFrameCount ?? 0;
    const t = performance.now();
    while ((window.__worldFrameCount ?? 0) < c0 + 4 && performance.now() - t < 15000) await new Promise((r) => setTimeout(r, 50));
  });
  await page.screenshot({ path: path.join(OUT, `${id}.png`) });
  const r = await page.evaluate(async (lmName) => {
    const sc = window.__worldV6Debug;
    const scene = sc.debugScene();
    const renderer = sc.renderer;
    const camera = sc.camera;
    const f = window.__worldFrame;
    const cam = window.__worldCamera();
    const frame = { triangles: f.triangles, calls: f.calls, cam: [cam.x, cam.y, cam.z].map(Math.round), pitch: +cam.pitch.toFixed(1), railU: +window.__worldRailU().toFixed(4) };
    sc.setPaused(true);
    // Frame ms at pixel ratio 1.5 (the budget's), then back.
    const pr0 = renderer.getPixelRatio();
    renderer.setPixelRatio(1.5);
    const burst = sc.burstProbe ? sc.burstProbe(8, 5, 250) : null;
    renderer.setPixelRatio(pr0);
    // ID pass (v6-gates.mjs's classes): sky 0, terrain 1, trees 2, rocks 3, cover 4, water 5, landmark 6, other 7.
    let SM = null;
    scene.traverse((o) => {
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!SM && m && m.isShaderMaterial && m.type === "ShaderMaterial") SM = m.constructor;
    });
    const vs = `void main() {
      #ifdef USE_INSTANCING
        vec4 mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
      #else
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
      #endif
      gl_Position = projectionMatrix * mv; }`;
    const fs = `uniform float uClass; void main() { gl_FragColor = vec4( uClass / 255.0, 0.0, 0.0, 1.0 ); }`;
    const mats = new Map();
    const matFor = (c, side) => {
      const k = `${c}-${side}`;
      if (!mats.has(k)) mats.set(k, new SM({ uniforms: { uClass: { value: c } }, vertexShader: vs, fragmentShader: fs, side, fog: false, toneMapped: false }));
      return mats.get(k);
    };
    const WATER = new Set(["Sea", "River", "Stream", "Brook", "MirrorLake", "Pool"]);
    const SKY = new Set(["LightSky", "LightStars", "LightClouds"]);
    const classOf = (o) => {
      for (let e = o; e; e = e.parent) {
        if (e.name === lmName) return 6;
        if (SKY.has(e.name)) return -1;
        if (WATER.has(e.name)) return 5;
        if (e.name === "Forest") return 2;
        if (e.name === "V5Rocks") return 3;
        if (e.name === "V5Cover") return 4;
        if (/^Terrain/.test(e.name)) return 1;
      }
      return 7;
    };
    const saved = [];
    scene.traverse((o) => saved.push([o, o.visible, o.material, o.onBeforeRender]));
    scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
      const c = classOf(o);
      const m0 = Array.isArray(o.material) ? o.material[0] : o.material;
      if (c < 0 || o.isPoints || o.isLine || o.isSprite || (m0 && m0.transparent && c !== 5 && c !== 6)) {
        o.visible = false;
        return;
      }
      o.material = matFor(c, m0 ? m0.side : 0);
      if (o.name === "MirrorLake") o.onBeforeRender = () => {};
    });
    const gl = renderer.getContext();
    const bw = gl.drawingBufferWidth;
    const bh = gl.drawingBufferHeight;
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    const lake = scene.getObjectByName("MirrorLake");
    let rt = sc.__averifyRT;
    if (!rt || rt.width !== bw || rt.height !== bh) {
      rt = new (lake.getRenderTarget().constructor)(bw, bh, { samples: 0, depthBuffer: true });
      sc.__averifyRT = rt;
    }
    const clearCol = fog.color.clone();
    renderer.getClearColor(clearCol);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    const id = new Uint8Array(bw * bh * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, bw, bh, id);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clearCol, clearAlpha);
    for (const [o, v, m, obr] of saved) {
      o.visible = v;
      if (m !== undefined) o.material = m;
      o.onBeforeRender = obr;
    }
    scene.background = bg;
    scene.fog = fog;
    for (const m of mats.values()) m.dispose();
    // Stats (the buffer is bottom-up: row 0 is the frame's bottom).
    const counts = new Array(8).fill(0);
    let lmN = 0;
    let x0 = Infinity;
    let x1 = -1;
    let y0 = Infinity;
    let y1 = -1;
    let sx = 0;
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const c = Math.min(7, id[(y * bw + x) * 4]);
        counts[c]++;
        if (c === 6) {
          lmN++;
          sx += x;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          const yt = bh - 1 - y;
          if (yt < y0) y0 = yt;
          if (yt > y1) y1 = yt;
        }
      }
    // A small image of the ID pass for the record.
    const PAL = [[150, 200, 255], [140, 120, 90], [30, 110, 50], [120, 120, 130], [180, 210, 90], [40, 70, 160], [255, 40, 40], [230, 150, 230]];
    const c2 = document.createElement("canvas");
    const sw = Math.round(bw / 3);
    const sh = Math.round(bh / 3);
    c2.width = sw;
    c2.height = sh;
    const cx = c2.getContext("2d");
    const img = cx.createImageData(sw, sh);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const s = ((bh - 1 - y * 3) * bw + x * 3) * 4;
        const p = PAL[Math.min(7, id[s])];
        const d2 = (y * sw + x) * 4;
        img.data[d2] = p[0];
        img.data[d2 + 1] = p[1];
        img.data[d2 + 2] = p[2];
        img.data[d2 + 3] = 255;
      }
    cx.putImageData(img, 0, 0);
    renderer.render(scene, camera);
    sc.setPaused(false);
    const total = bw * bh;
    const pct = (n) => +((100 * n) / total).toFixed(1);
    return {
      ...frame,
      buffer: [bw, bh],
      frameMs: burst ? +burst.ms.toFixed(2) : null,
      burst,
      classes: Object.fromEntries(["sky", "terrain", "trees", "rocks", "cover", "water", "landmark", "other"].map((k, i) => [k, pct(counts[i])])),
      skyPct: pct(counts[0]),
      lmPct: pct(lmN),
      lmX: lmN ? +((x0 + x1) / 2 / bw).toFixed(3) : null,
      lmCentroidX: lmN ? +(sx / lmN / bw).toFixed(3) : null,
      lmBox: lmN ? [+(x0 / bw).toFixed(3), +(y0 / bh).toFixed(3), +(x1 / bw).toFixed(3), +(y1 / bh).toFixed(3)] : null,
      idPng: c2.toDataURL("image/png"),
    };
  }, lm);
  fs.writeFileSync(path.join(OUT, `${id}-id.png`), Buffer.from(r.idPng.split(",")[1], "base64"));
  delete r.idPng;
  const key = stopIndex < 0 ? 0 : info.places[stopIndex][1];
  const row = { id, caption, key, lm, depth: +d.toFixed(5), ...r };
  rows.push(row);
  console.log(`${id} key ${key}: sky ${r.skyPct}%  ${lm} x ${r.lmX} (${r.lmPct}%, centroid ${r.lmCentroidX})  ${r.frameMs} ms @PR1.5  ${r.triangles} tris / ${r.calls} calls  cam ${r.cam} pitch ${r.pitch}`);
}
const report = { when: new Date().toISOString(), loadS, gpu: info.gpu, keys: info.keys, places: info.places, quality: info.quality, frames: rows, errors, api };
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
await browser.close();
console.log(`console errors+warnings: ${errors.length}, /api: ${api.length}`);
if (errors.length) console.log(errors.slice(0, 10).join("\n"));
await makeSheet();
console.log("sheet: " + path.join(OUT, "sheet-stops.png"));
