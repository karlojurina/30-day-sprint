/**
 * V5 colour script (world_art_bible.md step 2): the 11 frames the bible names,
 * rendered straight from the WebGL buffer at 960x600 (no page UI), each with
 * a sky mask (a second render: every non-sky object black, the sky white), and
 * the light gates of section 7 measured on them.
 *
 *   node world-tests/v5-colour.mjs --batch 0     frames 0-5
 *   node world-tests/v5-colour.mjs --batch 1     frames 6-10
 *   node world-tests/v5-colour.mjs sheet         world-tests/shots/v5/colour-script.png + gates.json
 *   node world-tests/v5-colour.mjs --only 3,4    just those frames (debug)
 *
 * Luma is Rec. 601 on display values, 0..255.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v5/colour");
const SHEET = path.join(HERE, "shots/v5/colour-script.png");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const argv = process.argv.slice(2);
const flag = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : null;
};
const W = 960;
const H = 600;
const TRAIL_KEYS = 77;

/** [trail key, id, caption, kind]; kind: open (daytime gates), dark (glow/edge only), under. */
const FRAMES = [
  [2, "a1", "a1 Landing · afternoon-gold", "open"],
  [6, "a2", "a2 Base Camp · afternoon", "open"],
  [14, "dive", "the dive · late-afternoon", "open"],
  [23, "a3", "a3 the cave · cave", "under"],
  [31, "a4", "a4 the Mine Lift · mine", "under"],
  [37.15, "shaft", "shaft exit · sunset-cliff", "open"],
  [43, "a5", "a5 Mirror Lake · sunset", "open"],
  [47, "a6", "a6 Glowing Forest · dusk", "dark"],
  [54, "a7", "a7 Sky Island · night", "dark"],
  [70.5, "flight", "the flight · dawn", "dark"],
  [75, "a8", "a8 Harbour Isle · morning", "open"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lumaStats(px, mask) {
  const n = W * H;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  const sorted = Float32Array.from(L).sort();
  const p = (q) => sorted[Math.min(n - 1, Math.floor(q * n))];
  const hist = new Array(16).fill(0);
  for (let i = 0; i < n; i++) hist[Math.min(15, Math.floor(L[i] / 16))]++;
  const rowMean = (y0, y1) => {
    let s = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) s += L[y * W + x];
    return s / ((y1 - y0) * W);
  };
  const t3 = Math.round(H / 3);
  // Darkest 20 percent: does it touch a frame edge (share of the border that is in it)?
  const d20 = p(0.2);
  let edge = 0;
  let edgeN = 0;
  for (let x = 0; x < W; x++) {
    for (const y of [0, H - 1]) {
      edgeN++;
      if (L[y * W + x] <= d20) edge++;
    }
  }
  for (let y = 0; y < H; y++) {
    for (const x of [0, W - 1]) {
      edgeN++;
      if (L[y * W + x] <= d20) edge++;
    }
  }
  const out = {
    p5: Math.round(p(0.05)),
    p95: Math.round(p(0.95)),
    spread: Math.round(p(0.95) - p(0.05)),
    biggestBand: +((Math.max(...hist) / n) * 100).toFixed(1),
    rows: [Math.round(rowMean(0, t3)), Math.round(rowMean(t3, 2 * t3)), Math.round(rowMean(2 * t3, H))],
    darkEdge: +((edge / edgeN) * 100).toFixed(1),
  };
  if (mask) {
    // mask: 1 = sky. Per column, the skyline = first non-sky pixel from the top.
    let sky = 0;
    for (let i = 0; i < n; i++) sky += mask[i];
    out.sky = +((sky / n) * 100).toFixed(1);
    const diffs = [];
    const ridgeSteps = [];
    for (let x = 4; x < W - 4; x += 4) {
      let y = 0;
      while (y < H && mask[y * W + x]) y++;
      if (y < 8 || y > H - 40) continue;
      let sL = 0;
      let lL = 0;
      for (let k = 3; k <= 6; k++) sL += L[(y - k) * W + x];
      for (let k = 2; k <= 5; k++) lL += L[(y + k) * W + x];
      diffs.push(sL / 4 - lL / 4);
      // Land profile under the skyline: steps where the luma drops 12+ over 3 rows.
      let prev = lL / 4;
      let lastStepY = y;
      for (let yy = y + 6; yy < H - 3; yy += 3) {
        let v = 0;
        let cnt = 0;
        for (let k = 0; k < 3; k++) {
          if (!mask[(yy + k) * W + x]) {
            v += L[(yy + k) * W + x];
            cnt++;
          }
        }
        if (!cnt) continue;
        v /= cnt;
        if (prev - v >= 12 && yy - lastStepY > 6) {
          ridgeSteps.push(prev - v);
          lastStepY = yy;
        }
        prev = v;
      }
    }
    diffs.sort((a, b) => a - b);
    ridgeSteps.sort((a, b) => a - b);
    out.farRidgeVsSky = diffs.length ? Math.round(diffs[Math.floor(diffs.length / 2)]) : null;
    out.skylineCols = diffs.length;
    out.ridgeStepMedian = ridgeSteps.length ? Math.round(ridgeSteps[Math.floor(ridgeSteps.length / 2)]) : null;
    out.ridgeStepsPerCol = diffs.length ? +(ridgeSteps.length / diffs.length).toFixed(2) : 0;
  }
  return out;
}

function gates(m, kind) {
  const g = [];
  if (kind === "open") {
    g.push(["spread >= 130", m.spread >= 130, m.spread]);
    g.push(["biggest band <= 25%", m.biggestBand <= 25, m.biggestBand]);
    g.push(["rows descending", m.rows[0] > m.rows[1] && m.rows[1] > m.rows[2], m.rows.join("/")]);
    if (m.farRidgeVsSky !== null && m.farRidgeVsSky !== undefined) g.push(["far ridge 40+ under sky", m.farRidgeVsSky >= 40, m.farRidgeVsSky]);
    if (m.ridgeStepMedian !== null && m.ridgeStepMedian !== undefined) g.push(["ridge steps 15+", m.ridgeStepMedian >= 15, m.ridgeStepMedian]);
  }
  g.push(["darkest 20% on an edge", m.darkEdge > 5, m.darkEdge]);
  return g;
}

async function renderFrames(list) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
    protocolTimeout: 600000,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" || /THREE|shader|WebGL/i.test(m.text())) errors.push(m.type() + ": " + m.text().slice(0, 400));
  });
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  await page.setViewport({ width: W, height: H });
  await page.goto(BASE + "/dev/world-v5", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
  const err = await page.evaluate(() => window.__worldError || null);
  if (err) throw new Error("world error: " + err);
  for (const [key, id, caption] of list) {
    const u = key / (TRAIL_KEYS - 1);
    const t0 = Date.now();
    const res = await page.evaluate(
      async (u, W, H) => {
        const sc = window.__worldV5Debug;
        const r = sc.debugRail();
        let lo = 0;
        let hi = r.length;
        for (let i = 0; i < 60; i++) {
          const m = (lo + hi) / 2;
          if (r.tAtS(m) < u) lo = m;
          else hi = m;
        }
        const d = r.depthOfS((lo + hi) / 2);
        window.scrollTo(0, sc.scrollYForDepth(d));
        sc.seedDepth(d);
        const c0 = window.__worldFrameCount ?? 0;
        const t = performance.now();
        while ((window.__worldFrameCount ?? 0) < c0 + 3 && performance.now() - t < 20000) await new Promise((res) => setTimeout(res, 100));
        const scene = sc.debugScene();
        const renderer = sc.renderer;
        const camera = sc.camera;
        const gl = renderer.getContext();
        const read = () => {
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const px = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          // Flip to top-down.
          const out = new Uint8Array(w * h * 4);
          for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
          return { w, h, px: out };
        };
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        const img = read();
        // Sky mask: hide the sky, stars and clouds, draw everything else black on white.
        const hidden = [];
        for (const name of ["LightSky", "LightStars", "LightClouds"]) {
          const o = scene.getObjectByName(name);
          if (o && o.visible) {
            o.visible = false;
            hidden.push(o);
          }
        }
        let Basic = null;
        scene.traverse((o) => {
          if (!Basic && o.material && o.material.type === "MeshBasicMaterial") Basic = o.material.constructor;
        });
        const bg = scene.background;
        const over = scene.overrideMaterial;
        const fog = scene.fog;
        const black = Basic ? new Basic({ color: 0x000000 }) : null;
        scene.background = null;
        scene.fog = null;
        scene.overrideMaterial = black;
        renderer.setClearColor(0xffffff, 1);
        renderer.render(scene, camera);
        const mimg = read();
        scene.overrideMaterial = over;
        scene.background = bg;
        scene.fog = fog;
        renderer.setClearColor(0x000000, 1);
        for (const o of hidden) o.visible = true;
        renderer.render(scene, camera);
        const mask = new Uint8Array(mimg.w * mimg.h);
        for (let i = 0; i < mask.length; i++) mask[i] = mimg.px[i * 4] > 128 ? 1 : 0;
        const c = document.createElement("canvas");
        c.width = img.w;
        c.height = img.h;
        const ctx = c.getContext("2d");
        const id = ctx.createImageData(img.w, img.h);
        id.data.set(img.px);
        for (let i = 3; i < id.data.length; i += 4) id.data[i] = 255;
        ctx.putImageData(id, 0, 0);
        const light = scene.userData.light;
        const b64 = (u8) => {
          let str = "";
          for (let i = 0; i < u8.length; i += 0x8000) str += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
          return btoa(str);
        };
        return {
          png: c.toDataURL("image/png"),
          px: b64(img.px),
          mask: b64(mask),
          w: img.w,
          h: img.h,
          info: {
            railU: window.__worldRailU(),
            tris: window.__worldFrame.triangles,
            calls: window.__worldFrame.calls,
            fogNear: Math.round(scene.fog.near),
            fogFar: Math.round(scene.fog.far),
            camFar: Math.round(camera.far),
            light: light ? light.stats() : null,
          },
        };
      },
      u,
      W,
      H,
    );
    if (res.w !== W || res.h !== H) console.log(`  ${id}: buffer ${res.w}x${res.h} (expected ${W}x${H})`);
    fs.writeFileSync(path.join(OUT, `${id}.png`), Buffer.from(res.png.split(",")[1], "base64"));
    const m = lumaStats(new Uint8Array(Buffer.from(res.px, "base64")), new Uint8Array(Buffer.from(res.mask, "base64")));
    fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ key, id, caption, ...res.info, metrics: m }, null, 1));
    console.log(`${id} (${((Date.now() - t0) / 1000).toFixed(1)} s) tris ${res.info.tris} calls ${res.info.calls} fog ${res.info.fogNear}-${res.info.fogFar} far ${res.info.camFar}`, JSON.stringify(m));
  }
  if (errors.length) console.log("ERRORS:\n" + errors.slice(0, 12).join("\n"));
  await browser.close();
}

async function makeSheet() {
  const items = FRAMES.filter(([, id]) => fs.existsSync(path.join(OUT, `${id}.png`))).map(([, id, caption, kind]) => {
    const j = JSON.parse(fs.readFileSync(path.join(OUT, `${id}.json`), "utf8"));
    const g = gates(j.metrics, kind);
    return { id, caption, kind, file: path.join(OUT, `${id}.png`), metrics: j.metrics, gates: g, tris: j.tris, calls: j.calls };
  });
  const cellW = 480;
  const cellH = 300;
  const cols = 3;
  const gl = (g) => g.map(([n, ok, v]) => `<span style="color:${ok ? "#8fd18f" : "#f08a7a"}">${ok ? "✓" : "✗"} ${n} <b>${v}</b></span>`).join(" · ");
  const html = `<html><body style="margin:0;background:#15171a;font:11px/1.35 -apple-system,Helvetica,sans-serif;color:#e8e4dc">
  <div style="padding:10px 8px 2px;font-size:15px">v5 colour script · fog ramp + halo + grade · ${new Date().toISOString().slice(0, 16)} · 960x600 GL buffer, no UI</div>
  <div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:8px;padding:8px">
  ${items
    .map(
      (it) => `<div><img src="data:image/png;base64,${fs.readFileSync(it.file).toString("base64")}" style="width:${cellW}px;height:${cellH}px;display:block">
  <div style="padding:3px 2px 0;font-size:13px">${it.caption}</div>
  <div style="padding:1px 2px 0;color:#b8b2a8">spread ${it.metrics.spread} · band ${it.metrics.biggestBand}% · rows ${it.metrics.rows.join("/")} · sky ${it.metrics.sky}% · ridge-sky ${it.metrics.farRidgeVsSky ?? "-"} · ${it.tris} tris ${it.calls} calls</div>
  <div style="padding:1px 2px 4px">${gl(it.gates)}</div></div>`,
    )
    .join("")}
  </div></body></html>`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
  const p2 = await browser.newPage();
  const rows = Math.ceil(items.length / cols);
  await p2.setViewport({ width: cols * (cellW + 8) + 8, height: rows * (cellH + 62) + 40 });
  await p2.setContent(html, { waitUntil: "load" });
  await p2.screenshot({ path: SHEET, fullPage: true });
  await browser.close();
  const summary = items.map((it) => ({ id: it.id, kind: it.kind, metrics: it.metrics, gates: it.gates.map(([n, ok, v]) => ({ gate: n, pass: ok, value: v })) }));
  fs.writeFileSync(path.join(OUT, "gates.json"), JSON.stringify(summary, null, 1));
  for (const it of items) console.log(it.id.padEnd(7), it.gates.map(([n, ok, v]) => `${ok ? "PASS" : "FAIL"} ${n}=${v}`).join(" | "));
  console.log("sheet:", SHEET);
}

if (argv.includes("sheet")) {
  await makeSheet();
} else {
  let list = FRAMES;
  const only = flag("--only");
  const batch = flag("--batch");
  if (only) list = only.split(",").map((i) => FRAMES[Number(i)]);
  else if (batch !== null) list = FRAMES.slice(Number(batch) * 6, Number(batch) * 6 + 6);
  await renderFrames(list);
}
await sleep(10);
