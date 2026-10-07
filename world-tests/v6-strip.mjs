/**
 * V4 integration proof on the real page (/dev/world-v6): the route strip,
 * the eight stops at Lovro's size, and the checks the grey version is judged on.
 *
 *   node world-tests/v6-strip.mjs [strip] [stops] [island] [reflect] [dive] [glide] [lock] [lockviews] [panel]   (none of these = all)
 *   node world-tests/v6-strip.mjs strip --batch 0      frames 0-5 of STRIP_FRAMES (6 per run, so no run is long)
 *   node world-tests/v6-strip.mjs stops --batch 1      stops a5-a8 at 1691x1278 (4 per run)
 *   node world-tests/v6-strip.mjs sheets               contact sheets from the frames already rendered
 *   node world-tests/v6-strip.mjs compare              pass-1 vs pass-2 sheets for N1, N2, N3, N5, N6
 *
 * Seeds depth directly (scroll + seedDepth) so no glide has to be waited out,
 * except in "glide", which scrolls for real and waits for the camera to land.
 * Grey pass 3 writes to world-tests/shots/v6/strip/ (STRIP_OUT overrides);
 * pass 1's frames in shots/v6/strip/ are read for the comparisons, never written.
 * SwiftShader draws ~0.6 s a frame at 960x600, the lake about twice that.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.STRIP_OUT ? path.resolve(process.env.STRIP_OUT) : path.join(HERE, "shots/v6/strip");
const PASS1 = path.join(HERE, "shots/v6/strip");
const COMPARE = path.join(HERE, "shots/v6-pass2/compare");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const argv = process.argv.slice(2);
const flag = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : null;
};
const BATCH = flag("--batch") === null ? null : Number(flag("--batch"));
// The strip's frame size (STRIP_W / STRIP_H; phase A verify renders it at 1691x1278).
const SW = Number(process.env.STRIP_W || 960);
const SH = Number(process.env.STRIP_H || 600);
const MODES = ["strip", "stops", "island", "reflect", "dive", "glide", "lock", "lockviews", "panel"];
const named = argv.filter((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const want = (k) => (named.length === 0 && MODES.includes(k)) || named.includes(k);

/**
 * The v6 route strip (world_art_bible_v6.md 4.3 step 7): named points on the
 * TRAIL (fractional key index, railU = key / (TRAIL_KEYS - 1)). Round 1: the
 * ride down the falls (lip 13 to pool 18), the turn round the upper gorge to
 * a3 outside the falls (22), the cave pass-through (24-31), the crossing and
 * the rock up to a4 (32-38), the traverse and the gully (39-44), the burst (45);
 * from the key after the burst on, v5's rows (v6-locked.mjs). v6-perf.mjs and
 * v6-overdraw.mjs read STRIP_FRAMES from this source.
 */
// Round 1: the key count is read from the page (layout TRAIL) when the world
// opens; 86 is only the fallback. A frame's optional third field names it
// (layout ROUTE_MARKS "name+offset", or "stop:aN", or "aN+offset" from a
// stop's key): the name wins over the number, so a change in the number of
// keys does not move the frame. v6-perf.mjs and v6-overdraw.mjs parse only
// the number and the label; keep the numbers current with the names.
let TRAIL_KEYS = 86;
const STRIP_FRAMES = [
  [0, "the opening, over the bay"],
  [2, "a1 Introduction", "stop:a1"],
  [7, "a2 Fundamentals", "stop:a2"],
  // Round 1 (route stage 1): the falls to the ridge.
  [11.5, "the stream's woods, toward the lip", "stream+1.5"],
  [13, "the lip: the water's tongue over the edge", "lip"],
  [14, "the ride: tipping over", "lip+1"],
  [16, "the ride: falling with the water, looking down it", "fall+1"],
  [18, "the ride: levelling out over the pool", "pool"],
  [20, "the turn at the pool, round the upper gorge", "pool+2"],
  [22, "a3 the whole falls, from outside", "stop:a3"],
  // Final pass E (the verifier): the approach to the curtain and the rise
  // from the sheet after the exit, the two heaviest frames of round D, so
  // v6-perf measures them on every run. Both numbers match their keys today
  // (a3 is key 21, exit is key 32).
  [22.5, "the approach to the curtain", "a3+1.5"],
  [24.4, "through the curtain, into the cave", "cave+0.4"],
  [26, "the cave: past the camp", "camp"],
  [31, "out of the side passage onto the cliff face", "exit"],
  [32, "rising from the sheet after the exit"],
  [33.5, "across the gorge toward the spur", "crossing+1.5"],
  [36.5, "up the rock, turning to the falls", "wall+1.5"],
  [38, "a4 the Trail Hut", "stop:a4"],
  [39.5, "the traverse, facing ahead", "traverse+0.5"],
  [42.6, "the gully, the notch of sky", "gully+0.6"],
  [45, "bursting out on the ridge", "burst"],
  [46.6, "the rim shelf, facing the saddle", "burst+1.6"],
  [48.5, "the saddle and the meadow", "burst+3.5"],
  [51, "a5 the Mirror Lake", "stop:a5"],
  [53.5, "across the lake, into the forest"],
  [55, "a6 the Great Tree", "stop:a6"],
  [56, "behind the first step"],
  [62, "a7 the island and the observatory under the sky", "stop:a7"],
  [64, "on to the bridge, looking at it", "island+1"],
  [69, "on the rope bridge"],
  [72, "boarding the airship"],
  [74.5, "the flight: cast off", "moored+1.5"],
  [77.5, "the flight: dawn breaking", "moored+4.5"],
  [80, "the flight: docking at the Gate isle", "docked"],
  [81, "a8 the Gate of the Sun", "stop:a8"],
  // Key 83 is only 95 from the arch, whose opening already overflows the
  // frame there; key 82 (244 away) shows the pillars (phase A verify).
  [82, "the tail: up the causeway to the arch"],
  [84.6, "the tail: through the arch into the sun"],
];
const STRIP_SHEETS = [
  ["sheet-strip-1.png", 0, 12, "the opening to the side passage's exit"],
  ["sheet-strip-2.png", 12, 24, "the crossing, the hike and a4 to the Great Tree"],
  ["sheet-strip-3.png", 24, 35, "the rise, the sky island, the flight and the Gate"],
];
/**
 * Pass-1 vs pass-2 comparisons are retired: the route under them changed in
 * pass 3 (the gorge and the Climb are gone). [note, title, [[pass-1 frame, strip index], ...]].
 */
const COMPARES = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
const NAMES = ["Introduction", "Fundamentals", "Video Ads I", "Video Ads II", "Static Ads", "AI Ads & Content", "Creative Strategy", "Job Board"];

const checks = [];
function check(name, pass, value) {
  checks.push({ name, pass, value });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}  (${value})`);
}
// Each run writes its own report part, so batches in parallel never clobber
// each other; "sheets" merges them into report.json.
const partName = named.join("-") || "all";
const reportPath = path.join(OUT, `report-${partName}${BATCH === null ? "" : "-b" + BATCH}.json`);
const report = {};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  // The real GPU (bible 4.1); STRIP_SWIFTSHADER=1 falls back to SwiftShader.
  args: process.env.STRIP_SWIFTSHADER
    ? ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"]
    : ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 600000,
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

async function open(w, h) {
  await page.setViewport({ width: w, height: h });
  await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
  // Fix round 3: let the intro fade finish before the first capture.
  await new Promise((r) => setTimeout(r, 1800));
  const err = await page.evaluate(() => window.__worldError || null);
  if (err) throw new Error("world error: " + err);
  await frames(2);
}

async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 30000 }, c0, n);
  } catch {
    // The loop sleeps once nothing moves; one frame is then all there is.
  }
}

/** Put the camera at a scroll depth, with the page scrolled to match. */
async function seed(d) {
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(2);
}

/** Scroll depth for a railU (the TRAIL curve parameter), by bisection on the rail. */
async function depthForU(u) {
  return page.evaluate((u) => {
    const r = window.__worldV6Debug.debugRail();
    let lo = 0;
    let hi = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (r.tAtS(m) < u) lo = m;
      else hi = m;
    }
    return r.depthOfS((lo + hi) / 2);
  }, u);
}

async function frameInfo() {
  return page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    return {
      depth: +f.depth.toFixed(5),
      railU: +window.__worldRailU().toFixed(4),
      routeU: +window.__worldRouteU().toFixed(4),
      place: +c.place.toFixed(2),
      cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)],
      pitch: +c.pitch.toFixed(1),
      triangles: f.triangles,
      calls: f.calls,
      markers: f.markers.filter((m) => m.visible).map((m) => m.id),
    };
  });
}

/** Contact sheet: images in a grid with a caption under each, via a page render. */
async function sheet(file, items, cols, cellW, header = "") {
  const cellH = Math.round((cellW * items[0].h) / items[0].w);
  const html = `<html><body style="margin:0;background:#15171a;font:12px/1.3 -apple-system,Helvetica,sans-serif;color:#e8e4dc">${header}
  <div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:6px;padding:6px">
  ${items
    .map(
      (it) => `<div><img src="data:image/png;base64,${fs.readFileSync(it.file).toString("base64")}" style="width:${cellW}px;height:${cellH}px;display:block">
  <div style="padding:3px 2px 2px">${it.caption}</div></div>`,
    )
    .join("")}
  </div></body></html>`;
  const p2 = await browser.newPage();
  const rows = Math.ceil(items.length / cols);
  await p2.setViewport({ width: cols * (cellW + 6) + 6, height: rows * (cellH + 40) + 12 });
  await p2.setContent(html, { waitUntil: "load" });
  await p2.screenshot({ path: file, fullPage: true });
  await p2.close();
}

// ── In-page helpers for the mask and diff renders ────────────────────────────
async function installHelpers() {
  await page.evaluate(() => {
    const sc = window.__worldV6Debug;
    const scene = sc.debugScene();
    const renderer = sc.renderer;
    const camera = sc.camera;
    const gl = renderer.getContext();
    let Basic = null;
    scene.traverse((o) => {
      if (!Basic && o.material && o.material.type === "MeshBasicMaterial") Basic = o.material.constructor;
    });
    // The Sky Island (Set_a7 holds its body and the bounty isle) and what hangs
    // off it. The Harbour Isle is its own set, measured the same way.
    const SETS = {
      island: new Set(["Set_a7", "LM_Observatory", "IslandFalls", "RopeBridge", "Airship_yours", "Stand-in:SkyIsland"]),
      harbour: new Set(["Set_a8", "LM_StoneArch", "Airship_loop", "DressGate", "Stand-in:GateIsle"]),
    };
    let ISLAND = SETS.island;
    const isIsland = (o) => {
      for (let e = o; e; e = e.parent) if (ISLAND.has(e.name)) return true;
      return false;
    };
    const read = () => {
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { w, h, px };
    };
    const render = () => {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    };
    const toUrl = (img, paint) => {
      const c = document.createElement("canvas");
      c.width = img.w;
      c.height = img.h;
      const ctx = c.getContext("2d");
      const id = ctx.createImageData(img.w, img.h);
      for (let y = 0; y < img.h; y++)
        for (let x = 0; x < img.w; x++) {
          const s = ((img.h - 1 - y) * img.w + x) * 4;
          const d = (y * img.w + x) * 4;
          const p = paint ? paint(s) : null;
          id.data[d] = p ? p[0] : img.px[s];
          id.data[d + 1] = p ? p[1] : img.px[s + 1];
          id.data[d + 2] = p ? p[2] : img.px[s + 2];
          id.data[d + 3] = 255;
        }
      ctx.putImageData(id, 0, 0);
      return c.toDataURL("image/png");
    };

    // Island as solid red, every other opaque thing as black (it blocks the view),
    // transparent things and points hidden. Culls that the blocks module applies
    // (the sky zone is hidden from the lower route) are switched OFF, so only
    // geometry can hide the island. terrainOnly: nothing but the island is drawn.
    window.__v4Mask = (terrainOnly, which = "island") => {
      ISLAND = SETS[which];
      sc.setPaused(true);
      const red = new Basic({ color: 0xff0000, fog: false, toneMapped: false });
      const black = new Basic({ color: 0x000000, fog: false, toneMapped: false });
      const saved = [];
      scene.traverse((o) => saved.push([o, o.visible, o.material]));
      scene.traverse((o) => {
        const island = isIsland(o);
        if (island) {
          for (let e = o; e; e = e.parent) e.visible = true;
        }
        if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
        if (island) {
          o.material = red;
          return;
        }
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (terrainOnly || o.isPoints || o.isLine || o.isSprite || (m && m.transparent) || o.name === "MirrorLake" || o.name === "LightClouds") {
          o.visible = false;
          return;
        }
        o.material = black;
      });
      render();
      const img = read();
      let n = 0;
      for (let i = 0; i < img.px.length; i += 4) if (img.px[i] > 200 && img.px[i + 1] < 60 && img.px[i + 2] < 60) n++;
      const url = toUrl(img);
      for (const [o, v, m] of saved) {
        o.visible = v;
        if (m !== undefined) o.material = m;
      }
      red.dispose();
      black.dispose();
      sc.setPaused(false);
      return { islandPx: n, total: img.w * img.h, url };
    };

    const setIsland = (vis) => {
      scene.traverse((o) => {
        if (ISLAND.has(o.name)) o.visible = vis;
      });
    };
    const diffCount = (a, b, mark) => {
      let n = 0;
      let minY = Infinity;
      let maxY = -1;
      for (let i = 0; i < a.px.length; i += 4) {
        const d = Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1]) + Math.abs(a.px[i + 2] - b.px[i + 2]);
        if (d > 12) {
          n++;
          if (mark) mark[i / 4] = 1;
          const y = a.h - 1 - Math.floor(i / 4 / a.w);
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      return { n, rows: n ? [minY, maxY] : null };
    };
    // Render as is, then with the island hidden; the difference is the island.
    // Repeated with the lake hidden: if that difference is 0, every island
    // pixel came through the mirror.
    window.__v4Reflect = () => {
      ISLAND = SETS.island;
      sc.setPaused(true);
      const saved = [];
      scene.traverse((o) => saved.push([o, o.visible]));
      const lake = scene.getObjectByName("MirrorLake");
      render();
      const a = read();
      setIsland(false);
      render();
      const b = read();
      const mark = new Uint8Array(a.w * a.h);
      const withLake = diffCount(a, b, mark);
      setIsland(true);
      lake.visible = false;
      render();
      const c = read();
      setIsland(false);
      render();
      const d = read();
      const noLake = diffCount(c, d, null);
      const url = toUrl(a, (s) => (mark[s / 4] ? [255, 40, 40] : null));
      const plain = toUrl(a);
      for (const [o, v] of saved) o.visible = v;
      sc.setPaused(false);
      return { total: a.w * a.h, withLake, noLake, url, plain };
    };
  });
}

function saveUrl(url, file) {
  fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
}

// ── Sheets and comparisons from frames already on disk (no world needed) ─────
const pad = (k) => String(k).padStart(2, "0");
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const stripCaption = (k, r) =>
  `<b>${pad(k)} ${r.label}</b><br>key ${r.key} · ${r.kind} · cam y ${r.cam[1]} · pitch ${r.pitch}° · ${Math.round(r.triangles / 1000)}k tris / ${r.calls} calls`;

if (named.includes("sheets")) {
  const merged = {};
  for (const [file, a, b, title] of STRIP_SHEETS) {
    const items = [];
    for (let k = a; k < b; k++) {
      const r = readJson(path.join(OUT, `f${pad(k)}.json`));
      if (!r) continue;
      items.push({ file: path.join(OUT, `f${pad(k)}.png`), w: r.w ?? 960, h: r.h ?? 600, caption: stripCaption(k, r) });
    }
    if (items.length) {
      await sheet(path.join(OUT, file), items, 3, 480);
      console.log(`  ${file}: ${items.length} frames (${title})`);
    }
  }
  const stops = [];
  for (let i = 0; i < 8; i++) {
    const r = readJson(path.join(OUT, `stop-${IDS[i]}-1691.json`));
    if (r) stops.push({ file: path.join(OUT, `stop-${IDS[i]}-1691.png`), w: 1691, h: 1278, caption: `<b>${IDS[i]} ${NAMES[i]}</b> · cam y ${r.cam[1]} · pitch ${r.pitch}° · ${Math.round(r.triangles / 1000)}k tris / ${r.calls} calls` });
  }
  if (stops.length) {
    await sheet(path.join(OUT, "sheet-stops-1691.png"), stops, 4, 420);
    console.log(`  sheet-stops-1691.png: ${stops.length} stops`);
  }
  merged.strip = STRIP_FRAMES.map((_, k) => readJson(path.join(OUT, `f${pad(k)}.json`))).filter(Boolean);
  merged.stops1691 = IDS.map((id) => readJson(path.join(OUT, `stop-${id}-1691.json`))).filter(Boolean);
  const all = [...merged.strip, ...merged.stops1691];
  if (all.length) {
    merged.worst = { triangles: Math.max(...all.map((r) => r.triangles)), calls: Math.max(...all.map((r) => r.calls)) };
    check("strip + stops: worst triangles / draw calls (<= 700k / 90)", merged.worst.triangles <= 700000 && merged.worst.calls <= 90, `${merged.worst.triangles} / ${merged.worst.calls}`);
  }
  merged.parts = {};
  for (const f of fs.readdirSync(OUT).filter((f) => /^report-.*\.json$/.test(f))) merged.parts[f] = readJson(path.join(OUT, f));
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(merged, null, 1));
}

if (named.includes("compare")) {
  fs.mkdirSync(COMPARE, { recursive: true });
  for (const [note, title, pairs] of COMPARES) {
    const items = [];
    for (const [p1, p2] of pairs) {
      const f1 = path.join(PASS1, `${p1}.png`);
      const isStop = typeof p2 === "string";
      const f2 = isStop ? path.join(OUT, `${p2}.png`) : path.join(OUT, `f${pad(p2)}.png`);
      if (!fs.existsSync(f1) || !fs.existsSync(f2)) {
        console.log(`  ${note}: missing ${fs.existsSync(f1) ? f2 : f1}`);
        continue;
      }
      const pass1 = readJson(path.join(PASS1, "report.json"));
      const r1 = isStop ? pass1?.stops1691?.find((r) => p1.includes(r.id)) : pass1?.strip?.find((r) => `f${pad(r.k)}` === p1);
      const r2 = isStop ? readJson(path.join(OUT, `${p2}.json`)) : readJson(path.join(OUT, `f${pad(p2)}.json`));
      const w = isStop ? 1691 : 960;
      const h = isStop ? 1278 : 600;
      items.push({ file: f1, w, h, caption: `<b>PASS 1 · ${p1}</b>${r1 ? ` · cam ${r1.cam.join(", ")} · pitch ${r1.pitch}°` : ""}` });
      items.push({ file: f2, w, h, caption: `<b>PASS 2 · ${isStop ? p2 : `f${pad(p2)} ${r2?.label ?? ""}`}</b>${r2 ? ` · cam ${r2.cam.join(", ")} · pitch ${r2.pitch}°` : ""}` });
    }
    if (!items.length) continue;
    // Stops and strip frames differ in aspect: one sheet per aspect group.
    const groups = [items.filter((it) => it.w === 960), items.filter((it) => it.w !== 960)].filter((g) => g.length);
    for (let g = 0; g < groups.length; g++) {
      const file = path.join(COMPARE, `${note}${g ? "-stop" : ""}.png`);
      const html = `<div style="padding:8px 8px 0;font:600 15px -apple-system,Helvetica,sans-serif;color:#e8e4dc">${note}: ${title}</div>`;
      await sheet(file, groups[g], 2, groups[g][0].w === 960 ? 560 : 520, html);
      console.log(`  ${path.relative(HERE, file)}: ${groups[g].length / 2} pairs`);
    }
  }
}

// ── Run on the world ─────────────────────────────────────────────────────────
const needWorld = MODES.some(want);
let stopDepths = [];
let stopU = [];
if (needWorld) {
  await open(SW, SH);
  await installHelpers();
  stopDepths = await page.evaluate(() => window.__worldV6Debug.stopDepths());
  stopU = await page.evaluate(() => window.__worldV6Debug.stopU());
  report.stopDepths = stopDepths.map((d) => +d.toFixed(5));
  report.stopU = stopU.map((u) => +u.toFixed(4));
  // Round 1: the key count comes from the page's layout (no fixed 86).
  TRAIL_KEYS = await page.evaluate(() => window.__worldV6Debug.ctx.layout.TRAIL.length);
  report.trailKeys = TRAIL_KEYS;
}

/** A strip frame's name to a fractional key: "stop:aN", "aN+off" (from the
 *  stop's key) or a layout ROUTE_MARKS "name+off". Falls back to the number. */
async function keyForName(name, fallback) {
  const r = await page.evaluate((name) => {
    const L = window.__worldV6Debug.ctx.layout;
    const [base, off] = name.replace(/^stop:/, "").split("+");
    const place = L.PLACES.find((p) => p.id === base);
    const k = place ? place.trail : L.ROUTE_MARKS ? L.ROUTE_MARKS[base] : undefined;
    return k === undefined ? null : k + Number(off || 0);
  }, name);
  if (r === null) console.log(`  (no frame named ${name}; key ${fallback})`);
  return r ?? fallback;
}

/** Extra facts for a frame: the ship's pose and what the rail calls this stretch. */
async function extraInfo(d) {
  return page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    const r = sc.debugRail();
    const s = r.sOfDepth(d);
    const ship = typeof sc.shipPose === "function" ? sc.shipPose() : null;
    return { kind: r.kindAtS(s), s: Math.round(s), ship: ship ? { phase: ship.phase, pos: [ship.x, ship.y, ship.z].map(Math.round), heading: Math.round(ship.heading) } : null };
  }, d);
}

if (want("strip")) {
  const all = STRIP_FRAMES.map((f, k) => [k, ...f]);
  const todo = BATCH === null ? all : all.slice(BATCH * 6, BATCH * 6 + 6);
  console.log(`strip: ${todo.length} frames at ${SW}x${SH}${BATCH === null ? "" : ` (batch ${BATCH})`}`);
  for (const [k, keyNum, label, name] of todo) {
    const key = name ? await keyForName(name, keyNum) : keyNum;
    const u = key / (TRAIL_KEYS - 1);
    const d = await depthForU(u);
    await seed(d);
    const f = await frameInfo();
    const x = await extraInfo(d);
    const file = path.join(OUT, `f${pad(k)}.png`);
    await page.screenshot({ path: file });
    const row = { k, key, label, u: +u.toFixed(4), w: SW, h: SH, ...x, ...f };
    fs.writeFileSync(path.join(OUT, `f${pad(k)}.json`), JSON.stringify(row));
    console.log(`  f${pad(k)} key ${key} ${x.kind} y=${f.cam[1]} pitch=${f.pitch} ${f.triangles}/${f.calls}${x.ship ? ` ship ${x.ship.phase}` : ""} markers=${f.markers.join(",")}`);
  }
}

if (want("stops")) {
  const ids = BATCH === null ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3].map((i) => BATCH * 4 + i).filter((i) => i < 8);
  console.log(`stops at 1691x1278: ${ids.map((i) => IDS[i]).join(" ")}`);
  await page.setViewport({ width: 1691, height: 1278 });
  await sleep(500);
  await frames(2);
  for (const i of ids) {
    const d = await page.evaluate((i) => window.__worldV6Debug.stopDepths()[i], i);
    await seed(d);
    const f = await frameInfo();
    const file = path.join(OUT, `stop-${IDS[i]}-1691.png`);
    await page.screenshot({ path: file });
    fs.writeFileSync(path.join(OUT, `stop-${IDS[i]}-1691.json`), JSON.stringify({ id: IDS[i], ...f }));
    console.log(`  ${IDS[i]} pitch=${f.pitch} ${f.triangles}/${f.calls} markers=${f.markers.join(",")}`);
  }
  await page.setViewport({ width: SW, height: SH });
  await sleep(500);
  await frames(2);
}

if (want("island")) {
  console.log("island mask at stops 1-4 (culls off, only geometry blocks)");
  const rows = [];
  for (let i = 0; i < 4; i++) {
    await seed(stopDepths[i]);
    const occluded = await page.evaluate(() => window.__v4Mask(false));
    const bare = await page.evaluate(() => window.__v4Mask(true));
    saveUrl(occluded.url, path.join(OUT, `mask-${IDS[i]}.png`));
    saveUrl(bare.url, path.join(OUT, `mask-${IDS[i]}-noterrain.png`));
    rows.push({ id: IDS[i], islandPx: occluded.islandPx, islandPxWithoutTerrain: bare.islandPx, total: occluded.total });
    check(`island pixels at ${IDS[i]} (terrain and blocks occlude; without them: ${bare.islandPx})`, occluded.islandPx === 0, `${occluded.islandPx} px`);
  }
  // Also points along the way before stop 5: nothing of the island, and how
  // often the island is in frame at all (so terrain, not framing, hid it).
  const uEnd = stopU[4];
  let worst = 0;
  let worstU = 0;
  const sweep = [];
  for (let k = 0; k <= 14; k++) {
    const u = (k / 14) * uEnd * 0.999;
    await seed(await depthForU(u));
    const m = await page.evaluate(() => window.__v4Mask(false));
    const bare = await page.evaluate(() => window.__v4Mask(true));
    sweep.push({ u: +u.toFixed(3), islandPx: m.islandPx, withoutTerrain: bare.islandPx });
    if (bare.islandPx > 0 && !fs.existsSync(path.join(OUT, "mask-sweep-inframe.png"))) {
      saveUrl(bare.url, path.join(OUT, "mask-sweep-inframe-noterrain.png"));
      saveUrl(m.url, path.join(OUT, "mask-sweep-inframe.png"));
    }
    if (m.islandPx > worst) {
      worst = m.islandPx;
      worstU = u;
    }
  }
  const inFrame = sweep.filter((s) => s.withoutTerrain > 0);
  check(
    "island pixels at 15 points from the shore up to stop 5",
    worst === 0,
    (worst ? `${worst} px at railU ${worstU.toFixed(3)}` : "0 px everywhere") + `; the island is in frame (terrain removed) at ${inFrame.length} of them: ${inFrame.map((s) => s.u + ":" + s.withoutTerrain).join(" ")}`,
  );
  // Positive control: the same mask must find the island where it is in view.
  await seed(stopDepths[6]);
  const ctl = await page.evaluate(() => window.__v4Mask(false));
  saveUrl(ctl.url, path.join(OUT, "mask-a7-control.png"));
  check("island mask positive control at a7 (must be > 0)", ctl.islandPx > 0, `${ctl.islandPx} px = ${((100 * ctl.islandPx) / ctl.total).toFixed(1)}%`);
  report.island = rows;
  report.islandSweep = sweep;
}

if (want("reflect")) {
  console.log("stop 5 reflection");
  await seed(stopDepths[4]);
  await frames(2);
  const r = await page.evaluate(() => window.__v4Reflect());
  saveUrl(r.url, path.join(OUT, "reflect-a5-diff.png"));
  saveUrl(r.plain, path.join(OUT, "reflect-a5.png"));
  report.reflect = { withLake: r.withLake, noLake: r.noLake, total: r.total };
  check("stop 5: island pixels with the lake (hide-island diff)", r.withLake.n > 0, `${r.withLake.n} px = ${((100 * r.withLake.n) / r.total).toFixed(2)}%, rows ${r.withLake.rows}`);
  check("stop 5: island pixels with the lake hidden (0 = all of it came through the mirror)", r.noLake.n === 0, `${r.noLake.n} px`);
}

if (want("dive")) {
  console.log("dive: pitch and smoothness from __worldCamera()");
  const d0 = stopDepths[1];
  const d1 = stopDepths[2];
  const sampleRange = async (a, b, n) =>
    page.evaluate(
      (a, b, n) => {
        const sc = window.__worldV6Debug;
        const out = [];
        for (let i = 0; i <= n; i++) {
          const d = a + ((b - a) * i) / n;
          sc.seedDepth(d);
          const c = window.__worldCamera();
          out.push([d, c.pitch, c.x, c.y, c.z, c.dx, c.dy, c.dz]);
        }
        return out;
      },
      a,
      b,
      n,
    );
  const coarse = await sampleRange(d0, d1, 800);
  let peak = -Infinity;
  let peakAt = null;
  for (const s of coarse)
    if (s[1] > peak) {
      peak = s[1];
      peakAt = s;
    }
  const totalVh = await page.evaluate(() => window.__worldV6Debug.debugRail().totalVh());
  const vhPerStep = ((d1 - d0) / 800) * totalVh;
  const jumps = (arr) => {
    let pj = 0;
    let dj = 0;
    let at = 0;
    for (let i = 1; i < arr.length; i++) {
      const p = Math.abs(arr[i][1] - arr[i - 1][1]);
      const dp = Math.hypot(arr[i][2] - arr[i - 1][2], arr[i][3] - arr[i - 1][3], arr[i][4] - arr[i - 1][4]);
      if (p > pj) {
        pj = p;
        at = i;
      }
      if (dp > dj) dj = dp;
    }
    return { pj, dj, at };
  };
  const jc = jumps(coarse);
  // Same neighbourhood 10x finer: a smooth curve's step shrinks ~10x, a kink does not.
  const i0 = Math.max(0, jc.at - 3);
  const fine = await sampleRange(coarse[i0][0], coarse[Math.min(800, jc.at + 3)][0], 60);
  const jf = jumps(fine);
  // Speed along the dive: units per vh of scroll, max vs median.
  const speeds = [];
  for (let i = 1; i < coarse.length; i++) speeds.push(Math.hypot(coarse[i][2] - coarse[i - 1][2], coarse[i][3] - coarse[i - 1][3], coarse[i][4] - coarse[i - 1][4]) / vhPerStep);
  const sorted = [...speeds].sort((a, b) => a - b);
  // Speed steps between neighbours (a jump would show as a big ratio).
  let worstRatio = 1;
  for (let i = 1; i < speeds.length; i++) {
    const r = Math.max(speeds[i], speeds[i - 1]) / Math.max(1e-6, Math.min(speeds[i], speeds[i - 1]));
    if (speeds[i] > 0.05 && r > worstRatio) worstRatio = r;
  }
  report.dive = {
    peakPitch: +peak.toFixed(1),
    peakAt: { depth: +peakAt[0].toFixed(5), cam: [peakAt[2], peakAt[3], peakAt[4]].map(Math.round) },
    maxPitchStepCoarse: +jc.pj.toFixed(3),
    maxPitchStepFine: +jf.pj.toFixed(4),
    shrink: +(jc.pj / Math.max(1e-9, jf.pj)).toFixed(2),
    pitchPerScreen: +((jc.pj / vhPerStep) * 100).toFixed(1),
    speedUnitsPerVh: { median: +sorted[sorted.length >> 1].toFixed(2), max: +sorted[sorted.length - 1].toFixed(2) },
    worstNeighbourSpeedRatio: +worstRatio.toFixed(4),
    profile: coarse.filter((_, i) => i % 40 === 0).map((s) => ({ depth: +s[0].toFixed(4), pitch: +s[1].toFixed(1), y: Math.round(s[3]) })),
  };
  // Pass 2, N2 choice A: face the falls head-on and sink alongside the water;
  // the pitch eases down to the high 20s as the pool rises, never a 60° nose-dive.
  check("dive: peak pitch in the head-on band (20-35°)", peak >= 20 && peak <= 35, `${peak.toFixed(1)}° at cam ${report.dive.peakAt.cam}`);
  check("dive: pitch has no kink (largest step shrinks ~10x when sampled 10x finer)", jc.pj / Math.max(1e-9, jf.pj) > 5, `${jc.pj.toFixed(3)}° -> ${jf.pj.toFixed(4)}°, ${report.dive.shrink}x; steepest ${report.dive.pitchPerScreen}° per screen of scroll`);
  check("dive: no speed step between neighbouring samples", worstRatio < 1.1, `worst neighbour ratio ${worstRatio.toFixed(4)}; ${report.dive.speedUnitsPerVh.median} median / ${report.dive.speedUnitsPerVh.max} max units per vh`);
  await seed(stopDepths[1]);
}

if (want("glide")) {
  console.log("glide: real scroll down through the dive, then back up (800x500; narrower drops to the list view)");
  await page.setViewport({ width: 800, height: 500 });
  await sleep(500);
  await frames(2);
  const d0 = stopDepths[1];
  const d1 = stopDepths[2];
  const cps = [];
  for (let i = 1; i <= 7; i++) cps.push(d0 + ((d1 - d0) * i) / 8);
  const land = async (d) => {
    const y = await page.evaluate((d) => Math.round(window.__worldV6Debug.scrollYForDepth(d)), d);
    await page.evaluate((y) => window.scrollTo(0, y), y);
    const trace = [];
    for (let i = 0; i < 400; i++) {
      await sleep(60);
      const s = await page.evaluate(() => {
        const f = window.__worldFrame;
        const c = window.__worldCamera();
        const sc = window.__worldV6Debug;
        return { d: f.depth, t: sc.scrollDepth(), pitch: c.pitch, x: c.x, y: c.y, z: c.z, dx: c.dx, dy: c.dy, dz: c.dz };
      });
      trace.push(s);
      if (Math.abs(s.d - s.t) < 1e-6) {
        await frames(1);
        return { y, pose: await page.evaluate(() => window.__worldCamera()), trace };
      }
    }
    throw new Error("glide did not land at depth " + d);
  };
  await seed(d0);
  const down = [];
  const traces = [];
  for (const d of cps) {
    const r = await land(d);
    down.push(r);
    traces.push(...r.trace);
  }
  await land(d1);
  const up = [];
  for (const d of [...cps].reverse()) {
    const r = await land(d);
    up.unshift(r);
    traces.push(...r.trace);
  }
  let worstPos = 0;
  let worstDir = 0;
  for (let i = 0; i < cps.length; i++) {
    const a = down[i].pose;
    const b = up[i].pose;
    worstPos = Math.max(worstPos, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    worstDir = Math.max(worstDir, (Math.acos(Math.min(1, a.dx * b.dx + a.dy * b.dy + a.dz * b.dz)) * 180) / Math.PI);
  }
  // Frame-to-frame pitch change while gliding (what the eye sees move).
  let worstFramePitch = 0;
  for (let i = 1; i < traces.length; i++) worstFramePitch = Math.max(worstFramePitch, Math.abs(traces[i].pitch - traces[i - 1].pitch));
  report.glide = { checkpoints: cps.map((d) => +d.toFixed(4)), worstPos, worstDirDeg: worstDir, worstFramePitch: +worstFramePitch.toFixed(2), samples: traces.length };
  check("glide: scrolling back up the dive lands on the same poses", worstPos < 0.01 && worstDir < 0.01, `worst ${worstPos.toExponential(2)} units / ${worstDir.toExponential(2)}° over ${cps.length} checkpoints`);
  await page.setViewport({ width: 960, height: 600 });
  await sleep(500);
  await frames(2);
}

if (want("lock")) {
  console.log("lock modes");
  const tune = (patch) => page.evaluate((p) => window.__worldTune(p), patch);
  const enterable = () => page.evaluate((ids) => ids.map((id) => window.__worldV6Debug.isEnterable(id)), IDS);
  const toBottom = async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    for (let i = 0; i < 300; i++) {
      await sleep(80);
      const s = await page.evaluate(() => ({ d: window.__worldFrame.depth, t: window.__worldV6Debug.scrollDepth() }));
      if (Math.abs(s.d - s.t) < 1e-6) break;
    }
    await frames(1);
    return page.evaluate(() => ({ depth: window.__worldFrame.depth, max: window.__worldLock().maxDepth, scrollH: document.documentElement.scrollHeight, vh: innerHeight }));
  };
  // Park, then close and wait until the flight home has landed: on SwiftShader
  // a flight takes ~20 s of real time, and a close that lands later restores
  // its saved scroll over whatever the next check seeded.
  const park = async (id) => {
    await page.evaluate((id) => window.__worldPark(id), id);
    await sleep(800);
    const r = await page.evaluate(() => ({ parked: window.__worldFrame.parkedId, p: window.__worldFrame.parkProgress }));
    if (r.parked) {
      await page.waitForFunction(() => window.__worldFrame.parkProgress >= 0.999 && window.__worldFrame.flight >= 0.999, { polling: 250, timeout: 120000 });
      r.p = 1;
    }
    await page.evaluate(() => window.__worldPark(null));
    await page.waitForFunction(() => window.__worldFrame.parkedId === null && window.__worldFrame.parkProgress === 0 && window.__worldFrame.flight >= 0.999 && getComputedStyle(document.body).overflow !== "hidden", { polling: 250, timeout: 120000 });
    return r;
  };
  const markerFlags = () =>
    page.evaluate(() => {
      const f = window.__worldV6Debug.frame ?? null;
      return f ? f.markers.map((m) => `${m.id}:${m.enterable ? "E" : "-"}${m.beyond ? "b" : ""}`) : null;
    });

  await tune({ lock: "open", frontier: 2 });
  await frames(2);
  const eo = await enterable();
  const bo = await toBottom();
  check("open: every place enterable, scroll reaches the end", eo.every(Boolean) && Math.abs(bo.depth - 1) < 1e-4, `${eo.map((e) => (e ? "E" : "-")).join("")}, end depth ${bo.depth.toFixed(4)}, page ${Math.round((bo.scrollH / bo.vh) * 100)} vh`);
  await seed(stopDepths[6]);
  const po = await park("a8");
  check("open: a place far past the frontier opens (a8)", po.parked === "a8", `parkedId ${po.parked}`);

  await tune({ lock: "look", frontier: 2 });
  await seed(stopDepths[4]);
  await sleep(1600);
  await frames(1);
  const el = await enterable();
  const fl = await markerFlags();
  const mist = await page.evaluate(() => {
    const m = window.__worldV6Debug.debugScene().getObjectByName("PlaceMist");
    return m ? { visible: m.visible } : null;
  });
  const pl = await park("a5");
  await page.screenshot({ path: path.join(OUT, "lock-look-a5.png") });
  check("look: a1-a3 enterable, a4-a8 not; a5 refuses to open", el.join() === "true,true,true,false,false,false,false,false" && pl.parked === null, `${el.map((e) => (e ? "E" : "-")).join("")}, park a5 -> ${pl.parked}, markers ${fl ? fl.join(" ") : "n/a"}, mist ${JSON.stringify(mist)}`);
  const bl = await toBottom();
  check("look: scroll still reaches the end", Math.abs(bl.depth - 1) < 1e-4, `end depth ${bl.depth.toFixed(4)}`);

  await tune({ lock: "locked", frontier: 2 });
  await frames(2);
  const bk = await toBottom();
  const ek = await enterable();
  await page.screenshot({ path: path.join(OUT, "lock-locked-end.png") });
  const endInfo = await frameInfo();
  check(
    "locked: the scroll ends past a3 and short of a4",
    bk.depth > stopDepths[2] && bk.depth < stopDepths[3] && Math.abs(bk.depth - bk.max) < 1e-4,
    `end depth ${bk.depth.toFixed(4)} (a3 ${stopDepths[2].toFixed(4)}, a4 ${stopDepths[3].toFixed(4)}), page ${Math.round((bk.scrollH / bk.vh) * 100)} vh, markers on screen ${endInfo.markers.join(",")}`,
  );
  check("locked: a4-a8 not enterable", ek.join() === "true,true,true,false,false,false,false,false", ek.map((e) => (e ? "E" : "-")).join(""));
  report.lockEnd = endInfo;
  await tune("reset");
  await frames(2);
}

if (want("lockviews")) {
  console.log("locked mode: the end of the scroll for each frontier");
  const items = [];
  const rows = [];
  for (let k = 0; k < 7; k++) {
    await page.evaluate((k) => window.__worldTune({ lock: "locked", frontier: k }), k);
    await frames(2);
    const max = await page.evaluate(() => window.__worldV6Debug.lockLimit());
    await seed(max);
    const f = await frameInfo();
    const file = path.join(OUT, `lockend-${IDS[k]}.png`);
    await page.screenshot({ path: file });
    rows.push({ frontier: IDS[k], end: +max.toFixed(4), ...f });
    items.push({ file, w: 960, h: 600, caption: `<b>frontier ${IDS[k]}</b> · end depth ${max.toFixed(3)} · next ${IDS[k + 1]} · markers ${f.markers.join(",") || "none"}` });
    console.log(`  ${IDS[k]} end=${max.toFixed(4)} markers=${f.markers.join(",")}`);
  }
  report.lockEnds = rows;
  await sheet(path.join(OUT, "sheet-lock-ends.png"), items, 3, 480);
  await page.evaluate(() => window.__worldTune("reset"));
  await frames(2);
}

if (want("panel")) {
  console.log("tuning panel: drag the Video Ads I pacing slider");
  await seed((stopDepths[2] + stopDepths[3]) / 2);
  const before = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight, cam: window.__worldCamera() }));
  await page.click("footer button[aria-expanded]");
  await sleep(400);
  const slider = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('section[aria-label="Tuning (dev only)"] label')];
    const row = rows.find((l) => /Video Ads I$/.test(l.querySelector("span")?.textContent.trim() ?? ""));
    const input = row.querySelector('input[type="range"]');
    const from = input.value;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(input, "560");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return { from, label: row.textContent.trim() };
  });
  await sleep(600);
  await frames(2);
  const after = await page.evaluate(() => ({
    h: document.documentElement.scrollHeight,
    cam: window.__worldCamera(),
    saved: JSON.parse(localStorage.getItem("world-v6:tuning") || "null"),
    total: document.querySelector('section[aria-label="Tuning (dev only)"] b')?.textContent,
  }));
  await page.screenshot({ path: path.join(OUT, "panel-open.png") });
  const grewVh = ((after.h - before.h) / before.vh) * 100;
  const moved = Math.hypot(after.cam.x - before.cam.x, after.cam.y - before.cam.y, after.cam.z - before.cam.z);
  check(
    "panel: dragging a pacing slider changes the scroll length live",
    Math.abs(grewVh - (560 - Number(slider.from))) < 1 && after.saved?.scrollVh?.[2] === 560,
    `Video Ads I ${slider.from} -> 560 vh: page grew ${grewVh.toFixed(1)} vh, panel total ${after.total}, saved ${after.saved?.scrollVh?.[2]}, camera moved ${moved.toFixed(2)} units`,
  );
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Reset everything")?.click());
  await sleep(600);
  const reset = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, saved: localStorage.getItem("world-v6:tuning") }));
  check("panel: Reset everything puts the page back", Math.abs(reset.h - before.h) <= 1, `height ${before.h} -> ${after.h} -> ${reset.h}, stored ${reset.saved === null ? "cleared" : reset.saved.slice(0, 60)}`);
  await page.click("footer button[aria-expanded]");
}

report.errors = errors;
report.apiRequests = api;
if (needWorld) {
  check("console errors", errors.length === 0, errors.length ? errors.slice(0, 5).join(" | ") : "none");
  check("/api requests", api.length === 0, api.length ? api.slice(0, 5).join(" ") : "none");
}
report.checks = Object.fromEntries(checks.map((c) => [c.name, { pass: c.pass, value: c.value }]));
if (needWorld) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(failed.length ? `${failed.length} FAILED` : "all passed");
process.exit(failed.length ? 1 : 0);
