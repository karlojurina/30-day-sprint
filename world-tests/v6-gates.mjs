/**
 * V5 acceptance gates (world_art_bible.md section 7) on the 8 stop frames at
 * 960x600, UI hidden: every frame is read straight from the WebGL buffer.
 *
 *   node world-tests/v6-gates.mjs --batch 0      stops a1-a4 (one browser, ~4 renders each)
 *   node world-tests/v6-gates.mjs --batch 1      stops a5-a8
 *   node world-tests/v6-gates.mjs --only a5      just that stop (debug)
 *   node world-tests/v6-gates.mjs sheet          gates-sheet.png + gates.json from the stops on disk
 *   node world-tests/v6-gates.mjs --night        the night rows (below), into shots/v6/gates-night
 *   node world-tests/v6-gates.mjs --night sheet  their sheet
 *   node world-tests/v6-gates.mjs --morning      the morning rows (below), into shots/v6/gates-morning
 *   node world-tests/v6-gates.mjs --morning sheet  their sheet
 *
 * The page is pinned to day unless asked (src/lib/world-v6/clock.ts: every
 * page but /world is), so these rows grade the frames they always graded
 * whatever the hour of the run.
 *
 * NIGHT ROWS (2026-10-20 night, the night layer of light.ts; option D of
 * _admin/prds/map-review-2026-10-15/real_time_light.md): the opening and the
 * stops from a1 to the forest on /dev/world-v6?tod=night. The day's gates
 * cannot hold at night (no sky over the ridges, no bright 5%), so a night
 * row has its own:
 *   readable          very dark pixels (luma under 50, the day rows' and the
 *                     doc's count) at most NIGHT_READABLE[stop]: the doc found
 *                     about 4 in 5 at the opening under the world's own night;
 *   lanterns brightest the warm light (hue 12 to 62, saturation over 0.3,
 *                     value over 0.35: the lanterns, the windows, the campfire
 *                     and their halos) outshines the moonlit land: its 95th
 *                     percentile luma at least the 99.5th of every other pixel
 *                     that is not sky or water (the moon and its path on the
 *                     sea are highlights of their own), with NIGHT_WARM_MIN
 *                     warm pixels in frame; the forest has no lanterns (its
 *                     lessons light the floating steps), so its row asks the
 *                     day's glow gate instead (NIGHT_GLOW);
 *   no white beach    where a beach is in frame (terrain under 10 high and
 *                     not steep: the ID pass writes the world height for
 *                     terrain), its 90th percentile luma at most NIGHT_BEACH
 *                     (by day the opening's beach is about 200);
 * and the day rows' landmark and edge gates.
 *
 * MORNING ROWS (2026-10-21, the morning layer of light.ts): the same seven
 * frames on /dev/world-v6?tod=morning. Each stop is drawn twice in the same
 * page, first with the light set to the day (the light module's setClock(0,
 * 0)), then to the morning (setClock(0, 1)), and the morning is graded
 * against its own day:
 *   lamps out         every lamp material (light.ts "lamp", the windows, the
 *                     lanterns' glass, the fire) at most MORNING_LAMP_MAX of
 *                     its lit colour, the Landing's halos and the lake's
 *                     lamps (the boathouse, the jetty) at 0, the star field
 *                     hidden (read from the scene);
 *   softer shadows    no more very dark pixels than the day's, and its
 *                     darkest 5% no darker;
 *   cooler            the frame's mean blue less red at least MORNING_COOLER
 *                     over the day's, and its sky no warmer than the day's
 *                     (the upper sky keeps the day's blue; at the lake, where
 *                     the frame's sky is the horizon, it turns from orange to
 *                     pink);
 *   brighter          its mean luma at least the day's;
 * and the day rows' landmark and edge gates. The day frame is saved beside
 * the morning one ({id}-day.png).
 *
 * Each stop is the page's own stop depth (stopDepths()), on the rail, not parked.
 * Per stop it renders twice:
 *   1. the frame as the student sees it (the beauty pass), with every draw
 *      attributed to the group under "World" (or the scene child) that owns it,
 *      split into the main pass and the Mirror Lake's reflection pass;
 *   2. an ID pass into a target without MSAA: every mesh gets a flat class
 *      (sky 0, terrain 1, trees 2, rocks 3, cover 4, water 5, landmark 6,
 *      other 7); the terrain also writes its world normal Y, for the planes.
 * The gates are measured on the beauty pixels with the ID pass as the mask.
 * Luma is Rec. 601 on display values, 0..255, as v5-colour.mjs.
 *
 * Out: world-tests/shots/v6/gates/{a1..a8}.png, {id}-id.png, {id}.json,
 *      gates.json, gates-sheet.png.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const NIGHT = argv.includes("--night");
const MORNING = argv.includes("--morning");
const OUT = process.env.GATES_OUT ? path.resolve(process.env.GATES_OUT) : path.join(HERE, NIGHT ? "shots/v6/gates-night" : MORNING ? "shots/v6/gates-morning" : "shots/v6/gates");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const flag = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : null;
};
const W = 960;
const H = 600;
const W_VIEW = W;
const H_VIEW = H;

/**
 * [trail key (for the record; the depth comes from stopDepths()), id, name, landmark mesh, kind, accent hex or null]
 * kind: open (every daytime gate), under (edge + landmark), dark (a6 glow /
 * a7 night: glow, landmark and edge gates only, bible section 7).
 * Accent: the landmark's colour from the colour script (1.2); nothing else in
 * frame may sit within 15 degrees of its hue at saturation over 0.35.
 */
const STOPS = [
  // v6 (A1): the new key indices; a4 is an open day stop on the bench (its
  // accent the hut's lit window), a8 the backlit "sunrise" frame (its accent the
  // sun in the arch; the "sunrise" kind has no gate code of its own yet).
  [2, "a1", "Introduction", "LM_Signpost", "open", "#2f6a66"],
  [7, "a2", "Fundamentals", "LM_Lookout", "open", "#a8392c"],
  [28, "a3", "Video Ads I", "LM_Waterfall", "under", null],
  [39, "a4", "Video Ads II", "LM_TrailHut", "open", "#ffb060"],
  [51, "a5", "Static Ads", "LM_Boathouse", "open", "#ffc070"],
  [55, "a6", "AI Ads & Content", "LM_GreatTree", "glow", null],
  [62, "a7", "Creative Strategy", "LM_Observatory", "dark", "#ffc070"],
  [81, "a8", "Job Board", "LM_StoneArch", "sunrise", "#ffd9a0"],
];
/**
 * The night rows: [trail key or -1 for the opening (depth 0), id, name, landmark mesh, kind, accent].
 * Accents are left out at night (the moonlit ground shares the day accents' hues).
 */
const NIGHT_STOPS = [
  [-1, "k0", "The opening", "LM_Signpost", "night", null],
  [2, "a1", "Introduction", "LM_Signpost", "night", null],
  [7, "a2", "Fundamentals", "LM_Lookout", "night", null],
  [28, "a3", "Video Ads I", "LM_Waterfall", "night", null],
  [39, "a4", "Video Ads II", "LM_TrailHut", "night", null],
  [51, "a5", "Static Ads", "LM_Boathouse", "night", null],
  [55, "a6", "AI Ads & Content", "LM_GreatTree", "night", null],
];
/** The most very dark pixels a night row may have, percent. The forest is dark by design (its day row: 75 to 85). */
const NIGHT_READABLE = { k0: 62, a1: 65, a2: 65, a3: 68, a4: 70, a5: 78, a6: 88 };
/** A night row needs at least this many warm pixels (lit lamps in view) for its lanterns gate to pass. */
const NIGHT_WARM_MIN = 30;
/**
 * A beach in frame: its 90th percentile luma at most this. Measured at night
 * on SwiftShader: 79 at the opening and 81 at a1 with the night's sand
 * (surfaces.ts SAND_NIGHT), 133 and 131 with the day's sand left on.
 */
const NIGHT_BEACH = 105;
/** The forest has no lanterns (its lessons light the floating steps): its glow carries the frame, as by day. */
const NIGHT_GLOW = new Set(["a6"]);
/** The landmark's centre is where the day row has it, except the opening's (the signpost stands right of centre, far). */
const NIGHT_NO_CX = new Set(["k0"]);
/** The morning rows: the night rows' seven frames, graded against their own day. */
const MORNING_STOPS = NIGHT_STOPS.map(([k, sid, name, lm]) => [k, sid, name, lm, "morning", null]);
/** A lamp material's colour in the morning, at most this share of its lit colour (by day the lamps sit at 0.4 to 1: paint, or light). */
const MORNING_LAMP_MAX = 0.15;
/** The morning's frame is at least this much bluer (mean blue less red, 0..255) than its day. */
const MORNING_COOLER = 8;
const ROWS = NIGHT ? NIGHT_STOPS : MORNING ? MORNING_STOPS : STOPS;
/** Walk stops, where trees and rocks must cover 40 to 55 percent of the land. */
const WALK = new Set(["a1", "a2", "a5"]);
const CLASS = ["sky", "terrain", "trees", "rocks", "cover", "water", "landmark", "other"];
const CAP_TRIS = 700000;
const CAP_CALLS = 90;
const TARGET_TRIS = 600000;
const TARGET_CALLS = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Measuring ────────────────────────────────────────────────────────────────

const luma = (px, i) => 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
function hsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, mx > 0 ? d / mx : 0, mx];
}
const hexHue = (hex) => hsv(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16))[0];
const hueDist = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
const median = (a) => {
  if (!a.length) return null;
  const s = Float32Array.from(a).sort();
  return Math.round(s[Math.floor(s.length / 2)]);
};

function measure(px, id, stop, dims, extra) {
  const [, sid, , , kind, accent] = stop;
  // C1: the page reads the drawing buffer at its own pixel ratio (1440x900 at
  // PR 1.5), not the 960x600 viewport; every row and box below uses its size.
  const W = dims && dims.w ? dims.w : W_VIEW;
  const H = dims && dims.h ? dims.h : H_VIEW;
  const n = W * H;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = luma(px, i);
  const cls = new Uint8Array(n);
  const ny = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cls[i] = id[i * 4];
    ny[i] = id[i * 4 + 1] / 255;
  }
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
  const counts = new Array(8).fill(0);
  for (let i = 0; i < n; i++) counts[Math.min(7, cls[i])]++;
  const share = Object.fromEntries(CLASS.map((c, k) => [c, +((counts[k] / n) * 100).toFixed(1)]));

  // Darkest 20 percent: the share of the frame's border that lies in it.
  const d20 = p(0.2);
  let edge = 0;
  let edgeN = 0;
  const onEdge = (x, y) => {
    edgeN++;
    if (L[y * W + x] <= d20) edge++;
  };
  for (let x = 0; x < W; x++) {
    onEdge(x, 0);
    onEdge(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    onEdge(0, y);
    onEdge(W - 1, y);
  }

  // Skyline per column (first non-sky pixel from the top), the far ridge against
  // the sky, and the steps down the land profile under it (as v5-colour.mjs).
  const isSky = (i) => cls[i] === 0;
  const diffs = [];
  const steps = [];
  for (let x = 4; x < W - 4; x += 4) {
    let y = 0;
    while (y < H && isSky(y * W + x)) y++;
    if (y < 8 || y > H - 40) continue;
    let sL = 0;
    let lL = 0;
    for (let k = 3; k <= 6; k++) sL += L[(y - k) * W + x];
    for (let k = 2; k <= 5; k++) lL += L[(y + k) * W + x];
    diffs.push(sL / 4 - lL / 4);
    let prev = lL / 4;
    let lastY = y;
    for (let yy = y + 6; yy < H - 3; yy += 3) {
      let v = 0;
      let c = 0;
      for (let k = 0; k < 3; k++) {
        if (!isSky((yy + k) * W + x)) {
          v += L[(yy + k) * W + x];
          c++;
        }
      }
      if (!c) continue;
      v /= c;
      if (prev - v >= 12 && yy - lastY > 6) {
        steps.push(prev - v);
        lastY = yy;
      }
      prev = v;
    }
  }

  // The landmark: its visible pixels' box.
  let lmN = 0;
  let minX = W;
  let maxX = -1;
  let minY = H;
  let maxY = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (cls[y * W + x] !== 6) continue;
      lmN++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

  // Accent hue anywhere but the landmark and the sky.
  let accentPx = 0;
  if (accent) {
    const ah = hexHue(accent);
    for (let i = 0; i < n; i++) {
      if (cls[i] === 6 || cls[i] === 0) continue;
      const [h, s, v] = hsv(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      if (s > 0.35 && v > 0.2 && hueDist(h, ah) <= 15) accentPx++;
    }
  }

  // Median luma by plane: sky, flat (ny > 0.92), slope (0.70-0.92), cliff (< 0.70), trees.
  const planes = { sky: [], flat: [], slope: [], cliff: [], trees: [] };
  for (let i = 0; i < n; i++) {
    const c = cls[i];
    if (c === 0) planes.sky.push(L[i]);
    else if (c === 2) planes.trees.push(L[i]);
    else if (c === 1) {
      if (ny[i] > 0.92) planes.flat.push(L[i]);
      else if (ny[i] >= 0.7) planes.slope.push(L[i]);
      else planes.cliff.push(L[i]);
    }
  }
  const planeMed = {};
  for (const [k, a] of Object.entries(planes)) planeMed[k] = a.length >= n * 0.005 ? median(a) : null;

  // Glow (a6): dark pixels, glowing pixels and their hue.
  let dark = 0;
  let glow = 0;
  let glowTV = 0;
  for (let i = 0; i < n; i++) {
    if (L[i] < 50) dark++;
    if (cls[i] === 0) continue; // the dusk sky is not glow
    const [h, s, v] = hsv(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    if (v > 0.45 && s > 0.3) {
      glow++;
      if ((h >= 150 && h <= 205) || (h >= 250 && h <= 300)) glowTV++;
    }
  }

  // Night rows: the beach (terrain under 10 high and not steep; the ID pass
  // writes a terrain pixel's world height in blue, (y + 20) / 80), and
  // whether the lamps outshine the land: the warm light (lanterns, windows,
  // the campfire, their halos: hue 12 to 62, saturation over 0.3, value over
  // 0.35) against the rest of the land. The sky and the water are left out
  // (the moon and its path on the sea are their own highlights).
  const beach = [];
  const warm = [];
  const cool = [];
  for (let i = 0; i < n; i++) {
    const c = cls[i];
    if (c === 0 || c === 5) continue;
    if (c === 1 && ny[i] > 0.55 && (id[i * 4 + 2] / 255) * 80 - 20 < 10) beach.push(L[i]);
    const [h, s, v] = hsv(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    if (h >= 12 && h <= 62 && s > 0.3 && v > 0.35) warm.push(L[i]);
    else cool.push(L[i]);
  }
  const pct = (a, q) => {
    if (!a.length) return null;
    const s = Float32Array.from(a).sort();
    return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]);
  };
  const beachSorted = Float32Array.from(beach).sort();

  // The morning rows: the frame's mean luma, its mean blue less red, and the sky's.
  let sumL = 0;
  let sumBR = 0;
  let skyBR = 0;
  for (let i = 0; i < n; i++) {
    sumL += L[i];
    const br = px[i * 4 + 2] - px[i * 4];
    sumBR += br;
    if (cls[i] === 0) skyBR += br;
  }

  const land = n - counts[0] - counts[5];
  const m = {
    meanLuma: +(sumL / n).toFixed(1),
    cool: +(sumBR / n).toFixed(1),
    skyCool: counts[0] ? +(skyBR / counts[0]).toFixed(1) : null,
    p5: Math.round(p(0.05)),
    p95: Math.round(p(0.95)),
    spread: Math.round(p(0.95) - p(0.05)),
    biggestBand: +((Math.max(...hist) / n) * 100).toFixed(1),
    rows: [Math.round(rowMean(0, t3)), Math.round(rowMean(t3, 2 * t3)), Math.round(rowMean(2 * t3, H))],
    darkEdge: +((edge / edgeN) * 100).toFixed(1),
    share,
    farRidgeVsSky: diffs.length >= 20 ? median(diffs) : null,
    skylineCols: diffs.length,
    ridgeStepMedian: steps.length >= 10 ? median(steps) : null,
    landmark: lmN ? { px: lmN, box: [minX, minY, maxX, maxY], cx: +((minX + maxX) / 2 / W).toFixed(3) } : { px: 0 },
    accentPct: accent ? +((accentPx / n) * 100).toFixed(2) : null,
    planeMed,
    treesRocksOverLand: land > 0 ? +(((counts[2] + counts[3]) / land) * 100).toFixed(1) : null,
    darkPct: +((dark / n) * 100).toFixed(1),
    glowPct: +((glow / n) * 100).toFixed(1),
    glowTealViolet: glow ? +((glowTV / glow) * 100).toFixed(1) : null,
    warmPx: warm.length,
    warmP95: pct(warm, 0.95),
    landP995: pct(cool, 0.995),
    beachPct: +((beach.length / n) * 100).toFixed(2),
    beachP90: beach.length ? Math.round(beachSorted[Math.floor(beach.length * 0.9)]) : null,
    beachMedian: beach.length ? Math.round(beachSorted[Math.floor(beach.length / 2)]) : null,
  };
  return { m, gates: gates(m, sid, kind, extra) };
}

function gates(m, sid, kind, extra) {
  const g = [];
  const add = (name, pass, value) => g.push({ gate: name, pass, value });
  if (kind === "morning" && extra) {
    const { day, lamps } = extra;
    add(
      `morning: lamps out (every lamp at most ${MORNING_LAMP_MAX} of its lit colour, the halos 0, no stars)`,
      lamps.lamps > 0 && lamps.lampMax <= MORNING_LAMP_MAX && lamps.shoreHalo === 0 && lamps.lakeLamp === 0 && lamps.starsVisible === false && lamps.morning === 1,
      `${lamps.lamps} lamp materials, the brightest at ${lamps.lampMax.toFixed(3)} (by day ${lamps.dayLampMax.toFixed(3)}); the Landing's halos ${lamps.shoreHalo}, the lake's lamps ${lamps.lakeLamp}; stars ${lamps.starsVisible ? "shown" : "hidden"}`,
    );
    add("morning: softer shadows (no more very dark pixels than the day's, the darkest 5% no darker)", m.darkPct <= day.darkPct && m.p5 >= day.p5, `very dark ${m.darkPct}% (day ${day.darkPct}%), p5 ${m.p5} (day ${day.p5})`);
    add(
      `morning: cooler (the frame's blue less red ${MORNING_COOLER}+ over the day's, its sky no warmer)`,
      m.cool >= day.cool + MORNING_COOLER && (m.skyCool === null || day.skyCool === null || m.skyCool >= day.skyCool - 2),
      `${m.cool} (day ${day.cool}); sky ${m.skyCool} (day ${day.skyCool})`,
    );
    add("morning: brighter (mean luma at least the day's)", m.meanLuma >= day.meanLuma, `${m.meanLuma} (day ${day.meanLuma})`);
  }
  if (kind === "open") {
    add("luma spread >= 130", m.spread >= 130, m.spread);
    add("biggest 16-luma band <= 25%", m.biggestBand <= 25, m.biggestBand);
    add("row means descending", m.rows[0] > m.rows[1] && m.rows[1] > m.rows[2], m.rows.join("/"));
    add("far ridge 40+ under sky", m.farRidgeVsSky !== null && m.farRidgeVsSky >= 40, m.farRidgeVsSky ?? `no skyline (sky ${m.share.sky}%)`);
    add("ridge bands 15+ apart", m.ridgeStepMedian !== null && m.ridgeStepMedian >= 15, m.ridgeStepMedian ?? "no steps");
    // Only where at least 3 of the planes are in frame (a8's island has no terrain).
    const order = ["sky", "flat", "slope", "cliff", "trees"].filter((k) => m.planeMed[k] !== null);
    if (order.length >= 3) {
      let ok = true;
      for (let i = 1; i < order.length; i++) if (!(m.planeMed[order[i - 1]] > m.planeMed[order[i]])) ok = false;
      add("plane medians sky>flat>slope>cliff>trees", ok, order.map((k) => `${k} ${m.planeMed[k]}`).join(" > "));
    }
  }
  if (kind === "glow") {
    add("a6 75-85% dark", m.darkPct >= 75 && m.darkPct <= 85, m.darkPct);
    add("a6 glow teal or violet (60%+ of glow)", m.glowTealViolet !== null && m.glowTealViolet >= 60, `${m.glowTealViolet}% of ${m.glowPct}% glowing`);
  }
  if (kind === "night") {
    const most = NIGHT_READABLE[sid];
    add(`night: readable (very dark <= ${most}%)`, m.darkPct <= most, m.darkPct);
    if (NIGHT_GLOW.has(sid)) {
      add("night: the glow carries the frame (teal or violet, 60%+ of the glow)", m.glowTealViolet !== null && m.glowTealViolet >= 60, `${m.glowTealViolet}% of ${m.glowPct}% glowing`);
    } else {
      add(
        "night: lanterns brightest (the warm light's p95 >= the rest of the land's p99.5)",
        m.warmPx >= NIGHT_WARM_MIN && m.warmP95 !== null && m.landP995 !== null && m.warmP95 >= m.landP995,
        `warm p95 ${m.warmP95} over ${m.warmPx} px, land p99.5 ${m.landP995}`,
      );
    }
    if (m.beachPct >= 0.2) add(`night: no white beach (p90 <= ${NIGHT_BEACH})`, m.beachP90 !== null && m.beachP90 <= NIGHT_BEACH, `p90 ${m.beachP90}, median ${m.beachMedian}, ${m.beachPct}% of the frame`);
  }
  add("darkest 20% touches an edge", m.darkEdge > 5, m.darkEdge);
  if (!((kind === "night" || kind === "morning") && NIGHT_NO_CX.has(sid))) {
    add("landmark centre x 0.55-0.75", !!m.landmark.px && m.landmark.cx >= 0.55 && m.landmark.cx <= 0.75, m.landmark.px ? `${m.landmark.cx} (${m.landmark.px} px)` : "not in frame");
  } else {
    add("landmark in frame", !!m.landmark.px, m.landmark.px ? `${m.landmark.cx} (${m.landmark.px} px)` : "not in frame");
  }
  if (m.accentPct !== null) add("accent hue elsewhere < 0.5%", m.accentPct < 0.5, m.accentPct);
  if (WALK.has(sid) && kind !== "night" && kind !== "morning") add("trees + rocks 40-55% of land", m.treesRocksOverLand >= 40 && m.treesRocksOverLand <= 55, m.treesRocksOverLand);
  return g;
}

// ── Rendering ────────────────────────────────────────────────────────────────

async function renderStops(list) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
    protocolTimeout: 600000,
  });
  const page = await browser.newPage();
  const errors = [];
  const api = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api")) api.push(r.url());
  });
  await page.setViewport({ width: W, height: H });
  const tLoad = Date.now();
  // poster=off: SwiftShader is a software renderer, so since the cheap laptops'
  // poster mode (poster.ts) the page would show the posters and build no 3D.
  // The dev page is pinned to day; the night rows ask for night, the morning rows for the morning (clock.ts).
  await page.goto(BASE + "/dev/world-v6?poster=off" + (NIGHT ? "&tod=night" : MORNING ? "&tod=morning" : ""), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
  const err = await page.evaluate(() => window.__worldError || null);
  if (err) throw new Error("world error: " + err);
  console.log(`page ready in ${((Date.now() - tLoad) / 1000).toFixed(1)} s`);
  const modules = await page.evaluate(() => {
    const sc = window.__worldV6Debug;
    return sc.moduleStats ? sc.moduleStats() : null;
  });
  for (const stop of list) {
    const [key, sid, , lm] = stop;
    const t0 = Date.now();
    let res = null;
    // The stop's index in PLACES order (stopDepths()); -1 is the opening, depth 0.
    const stopIndex = key < 0 ? -1 : STOPS.findIndex((s) => s[1] === sid);
    const render = async () => {
      let r = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        r = await page.evaluate(renderInPage, stopIndex, lm);
        // SwiftShader sometimes hands back a black buffer on a long batch: once more after a pause.
        if (r.meanLuma > 3 || sid === "a4") break;
        console.log(`  ${sid}: black frame, retrying`);
        await sleep(2500);
      }
      return r;
    };
    // The morning rows: the same stop by day first (the light module set straight to it, no ease), as the reference.
    let extra = null;
    if (MORNING) {
      await page.evaluate(() => window.__worldV6Debug.debugScene().userData.light.setClock(0, 0, 0));
      const dres = await render();
      fs.writeFileSync(path.join(OUT, `${sid}-day.png`), Buffer.from(dres.png.split(",")[1], "base64"));
      const dayLamps = await page.evaluate(lampState);
      const day = measure(new Uint8Array(Buffer.from(dres.px, "base64")), new Uint8Array(Buffer.from(dres.id, "base64")), stop, { w: dres.bw, h: dres.bh }).m;
      await page.evaluate(() => window.__worldV6Debug.debugScene().userData.light.setClock(0, 1, 0));
      res = await render();
      const lamps = await page.evaluate(lampState);
      extra = { day, lamps: { ...lamps, dayLampMax: dayLamps.lampMax } };
    } else {
      res = await render();
    }
    fs.writeFileSync(path.join(OUT, `${sid}.png`), Buffer.from(res.png.split(",")[1], "base64"));
    fs.writeFileSync(path.join(OUT, `${sid}-id.png`), Buffer.from(res.idPng.split(",")[1], "base64"));
    const px = new Uint8Array(Buffer.from(res.px, "base64"));
    const id = new Uint8Array(Buffer.from(res.id, "base64"));
    const { m, gates: g } = measure(px, id, stop, { w: res.bw, h: res.bh }, extra);
    const out = { key, id: sid, railU: res.railU, frame: res.frame, attr: res.attr, attrTotals: res.attrTotals, metrics: m, gates: g, ...(extra ? { day: extra.day, lamps: extra.lamps } : {}) };
    fs.writeFileSync(path.join(OUT, `${sid}.json`), JSON.stringify(out, null, 1));
    const top = Object.entries(res.attr)
      .sort((a, b) => b[1].tris - a[1].tris)
      .slice(0, 8)
      .map(([k, v]) => `${k} ${Math.round(v.tris / 1000)}k/${v.calls}`)
      .join(", ");
    console.log(`${sid} (${((Date.now() - t0) / 1000).toFixed(1)} s) frame ${res.frame.triangles} tris / ${res.frame.calls} calls; mine ${res.attrTotals.tris}/${res.attrTotals.calls}; top: ${top}`);
    for (const x of g) console.log(`   ${x.pass ? "PASS" : "FAIL"}  ${x.gate}  (${x.value})`);
  }
  if (modules) fs.writeFileSync(path.join(OUT, `modules-${list.map((s) => s[1]).join("")}.json`), JSON.stringify(modules, null, 1));
  const errs = { errors, api };
  fs.writeFileSync(path.join(OUT, `errors-${list.map((s) => s[1]).join("")}.json`), JSON.stringify(errs, null, 1));
  console.log(`console errors: ${errors.length}, /api requests: ${api.length}`);
  if (errors.length) console.log(errors.slice(0, 8).join("\n"));
  await browser.close();
}

/**
 * Runs in the page (the morning rows): the lamps as the scene has them. Every
 * lamp material's colour against the colour light.ts keeps as its lit base
 * (its brightest channel's share), the Landing's halos' level (their
 * onBeforeRender sets it from the light; run here, so it is the level a
 * frame would draw now), the lake's lamps (dress-lakeforest's uLamp), the
 * star field, and the light's morning.
 */
function lampState() {
  const sc = window.__worldV6Debug;
  const scene = sc.debugScene();
  const s = scene.userData.light.state;
  let lamps = 0;
  let lampMax = 0;
  scene.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      const kind = m.userData?.lightGlow ?? (m.name === "V4BlockGlow" ? "lamp" : undefined);
      const b = m.userData?.lightGlowBase;
      if (kind !== "lamp" || !m.color || !b) continue;
      lamps++;
      for (const ch of ["r", "g", "b"]) if (b[ch] > 1e-6) lampMax = Math.max(lampMax, m.color[ch] / b[ch]);
    }
  });
  const halos = scene.getObjectByName("Shore:halos");
  if (halos && typeof halos.onBeforeRender === "function") halos.onBeforeRender(sc.renderer, scene, sc.camera);
  const lake = scene.getObjectByName("LakeHalos");
  return {
    morning: s.morning,
    lamps,
    lampMax,
    shoreHalo: halos?.material?.uniforms?.uLevel?.value ?? null,
    lakeLamp: lake?.material?.uniforms?.uLamp?.value ?? null,
    starsVisible: scene.getObjectByName("LightStars")?.visible ?? null,
  };
}

/** Runs in the page: seed the stop, beauty pass with attribution, ID pass. */
async function renderInPage(stopIndex, lmName) {
  const sc = window.__worldV6Debug;
  // The stop's own scroll depth, as the page stops the student there (and v5-strip.mjs "stops"); -1 the opening.
  const d = stopIndex < 0 ? 0 : sc.stopDepths()[stopIndex];
  window.scrollTo(0, sc.scrollYForDepth(d));
  sc.seedDepth(d);
  const wait = async (n) => {
    const c0 = window.__worldFrameCount ?? 0;
    const t = performance.now();
    while ((window.__worldFrameCount ?? 0) < c0 + n && performance.now() - t < 20000) await new Promise((res) => setTimeout(res, 100));
  };
  await wait(3);
  const frame = { triangles: window.__worldFrame.triangles, calls: window.__worldFrame.calls };
  const scene = sc.debugScene();
  const renderer = sc.renderer;
  const camera = sc.camera;
  const gl = renderer.getContext();
  const THREEish = {
    // Constructors borrowed from objects already in the scene (the page bundles three).
    ShaderMaterial: null,
    WebGLRenderTarget: null,
  };
  scene.traverse((o) => {
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!THREEish.ShaderMaterial && m && m.isShaderMaterial && m.type === "ShaderMaterial") THREEish.ShaderMaterial = m.constructor;
  });
  const flip = (px, w, h) => {
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return out;
  };
  const b64 = (u8) => {
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const toPng = (px, w, h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    const id = ctx.createImageData(w, h);
    id.data.set(px);
    for (let i = 3; i < id.data.length; i += 4) id.data[i] = 255;
    ctx.putImageData(id, 0, 0);
    return c.toDataURL("image/png");
  };
  const world = scene.getObjectByName("World");
  const ownerKey = (o) => {
    let e = o;
    while (e.parent && e.parent !== world && e.parent !== scene) e = e.parent;
    return e.name || e.type;
  };

  sc.setPaused(true);
  // 1. Beauty pass, every draw attributed to its owning group and pass.
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
      const k = (renderer.getRenderTarget() ? "mirror:" : "") + key;
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
  const attrTotals = { tris: info.render.triangles, calls: info.render.calls };
  const bw = gl.drawingBufferWidth;
  const bh = gl.drawingBufferHeight;
  const raw = new Uint8Array(bw * bh * 4);
  gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  info.autoReset = auto;
  for (const [o, base] of hooked) o.onAfterRender = base;
  const px = flip(raw, bw, bh);
  let sumL = 0;
  for (let i = 0; i < bw * bh; i += 7) sumL += 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  const meanLuma = sumL / ((bw * bh) / 7);

  // 2. ID pass: flat classes, the terrain's world normal Y in green.
  const SM = THREEish.ShaderMaterial;
  // The terrain also writes its world normal Y (green) and, for the night rows' beach, its world height (blue, (y + 20) / 80).
  const vs = `
    varying float vNy;
    varying float vY;
    void main() {
      vec3 transformed = vec3( position );
      #ifdef USE_INSTANCING
        vec4 mv = modelViewMatrix * instanceMatrix * vec4( transformed, 1.0 );
      #else
        vec4 mv = modelViewMatrix * vec4( transformed, 1.0 );
      #endif
      #ifdef WITH_NY
        vNy = normalize( mat3( modelMatrix ) * normal ).y;
        vY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;
      #else
        vNy = 0.0;
        vY = 0.0;
      #endif
      gl_Position = projectionMatrix * mv;
    }`;
  const fs = `
    uniform float uClass;
    varying float vNy;
    varying float vY;
    void main() { gl_FragColor = vec4( uClass / 255.0, clamp( vNy, 0.0, 1.0 ), clamp( ( vY + 20.0 ) / 80.0, 0.0, 1.0 ), 1.0 ); }`;
  const mats = new Map();
  const matFor = (c, side, withNy) => {
    const k = `${c}-${side}-${withNy}`;
    if (!mats.has(k)) {
      const m = new SM({ uniforms: { uClass: { value: c } }, vertexShader: vs, fragmentShader: fs, side, fog: false, toneMapped: false, defines: withNy ? { WITH_NY: "" } : {} });
      mats.set(k, m);
    }
    return mats.get(k);
  };
  const WATER = new Set(["Sea", "River", "Stream", "Brook", "MirrorLake", "Pool"]);
  const SKY = new Set(["LightSky", "LightStars", "LightClouds", "CloudBillboards", "NightSky"]);
  const classOf = (o) => {
    for (let e = o; e; e = e.parent) {
      if (e.name === lmName) return 6;
      if (SKY.has(e.name)) return -1;
      if (WATER.has(e.name)) return 5;
      if (e.name === "Forest") return 2;
      if (e.name === "V5Rocks") return 3;
      if (e.name === "V5Cover" || e.name === "V6Cover") return 4;
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
    o.material = matFor(c, m0 ? m0.side : 0, c === 1);
    if (o.name === "MirrorLake") o.onBeforeRender = () => {};
  });
  const bg = scene.background;
  const fog = scene.fog;
  scene.background = null;
  scene.fog = null;
  let rt = sc.__gatesRT;
  if (!rt || rt.width !== bw || rt.height !== bh) {
    // Borrow the WebGLRenderTarget class from the lake's reflector, which owns one.
    const lake = scene.getObjectByName("MirrorLake");
    const Ctor = lake && lake.getRenderTarget ? lake.getRenderTarget().constructor : null;
    rt = new Ctor(bw, bh, { samples: 0, depthBuffer: true });
    sc.__gatesRT = rt;
  }
  const clearCol = new fog.color.constructor();
  renderer.getClearColor(clearCol);
  const clearAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  const idRaw = new Uint8Array(bw * bh * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, bw, bh, idRaw);
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
  const id = flip(idRaw, bw, bh);
  const PAL = [
    [150, 200, 255],
    [140, 120, 90],
    [30, 110, 50],
    [120, 120, 130],
    [180, 210, 90],
    [40, 70, 160],
    [255, 40, 40],
    [230, 150, 230],
  ];
  const vis = new Uint8Array(bw * bh * 4);
  for (let i = 0; i < bw * bh; i++) {
    const c = PAL[Math.min(7, id[i * 4])];
    const s = id[i * 4] === 1 ? 0.55 + 0.45 * (id[i * 4 + 1] / 255) : 1;
    vis[i * 4] = c[0] * s;
    vis[i * 4 + 1] = c[1] * s;
    vis[i * 4 + 2] = c[2] * s;
  }
  // Redraw the frame so the canvas is left as it was.
  renderer.render(scene, camera);
  sc.setPaused(false);
  return {
    railU: window.__worldRailU(),
    frame,
    attr,
    attrTotals,
    meanLuma,
    bw,
    bh,
    px: b64(px),
    id: b64(id),
    png: toPng(px, bw, bh),
    idPng: toPng(vis, bw, bh),
  };
}

// ── The sheet ────────────────────────────────────────────────────────────────

async function makeSheet() {
  const rows = [];
  const summary = [];
  for (const [, sid, name] of ROWS) {
    const f = path.join(OUT, `${sid}.json`);
    if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    rows.push({ sid, name, j });
    const mainT = Object.entries(j.attr).filter(([k]) => !k.startsWith("mirror:")).reduce((s, [, v]) => s + v.tris, 0);
    const mirT = Object.entries(j.attr).filter(([k]) => k.startsWith("mirror:")).reduce((s, [, v]) => s + v.tris, 0);
    summary.push({
      id: sid,
      name,
      triangles: j.frame.triangles,
      calls: j.frame.calls,
      mainTris: mainT,
      mirrorTris: mirT,
      budget: { tris: j.frame.triangles <= CAP_TRIS, calls: j.frame.calls <= CAP_CALLS, targetTris: j.frame.triangles <= TARGET_TRIS, targetCalls: j.frame.calls <= TARGET_CALLS },
      byGroup: Object.fromEntries(Object.entries(j.attr).sort((a, b) => b[1].tris - a[1].tris)),
      metrics: j.metrics,
      gates: j.gates,
    });
  }
  const cellW = 480;
  const cellH = 300;
  const gl = (g) => g.map((x) => `<div style="color:${x.pass ? "#8fd18f" : "#f08a7a"}">${x.pass ? "PASS" : "FAIL"} ${x.gate} <b>${x.value}</b></div>`).join("");
  const top = (attr) =>
    Object.entries(attr)
      .sort((a, b) => b[1].tris - a[1].tris)
      .slice(0, 6)
      .map(([k, v]) => `${k} ${Math.round(v.tris / 1000)}k`)
      .join(" · ");
  const html = `<html><body style="margin:0;background:#15171a;font:11px/1.35 -apple-system,Helvetica,sans-serif;color:#e8e4dc">
  <div style="padding:10px 8px 2px;font-size:15px">${NIGHT ? "night rows (?tod=night): the opening and a1 to a6" : MORNING ? "morning rows (?tod=morning): the opening and a1 to a6, each against its own day" : "v5 acceptance gates (bible section 7) · 8 stops"} at 960x600, GL buffer, no UI · ${new Date().toISOString().slice(0, 16)}</div>
  <div style="display:grid;grid-template-columns:${cellW}px ${cellW}px 330px;gap:8px;padding:8px">
  ${rows
    .map(
      ({ sid, name, j }) => `<img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, `${sid}.png`)).toString("base64")}" style="width:${cellW}px;height:${cellH}px">
  <img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, MORNING ? `${sid}-day.png` : `${sid}-id.png`)).toString("base64")}" style="width:${cellW}px;height:${cellH}px">
  <div><div style="font-size:14px"><b>${sid} ${name}</b></div>
  <div style="color:#b8b2a8">${j.frame.triangles.toLocaleString()} tris / ${j.frame.calls} calls · sky ${j.metrics.share.sky}% · trees ${j.metrics.share.trees}% · rocks ${j.metrics.share.rocks}% · cover ${j.metrics.share.cover}%</div>
  <div style="color:#b8b2a8">${top(j.attr)}</div>${gl(j.gates)}</div>`,
    )
    .join("")}
  </div>
  <div style="padding:4px 10px 10px;color:#b8b2a8">${MORNING ? "left the morning, right the same stop by day" : "ID pass: blue sky · brown terrain (darker = steeper) · green trees · grey rocks · lime cover · navy water · red landmark · pink other"}</div>
  </body></html>`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
  const p2 = await browser.newPage();
  await p2.setViewport({ width: cellW * 2 + 330 + 32, height: rows.length * (cellH + 8) + 80 });
  await p2.setContent(html, { waitUntil: "load" });
  await p2.screenshot({ path: path.join(OUT, "gates-sheet.png"), fullPage: true });
  await browser.close();
  fs.writeFileSync(path.join(OUT, "gates.json"), JSON.stringify(summary, null, 1));
  for (const s of summary) {
    const fails = s.gates.filter((g) => !g.pass).map((g) => g.gate);
    console.log(`${s.id.padEnd(3)} ${String(s.triangles).padStart(7)} tris ${String(s.calls).padStart(3)} calls (mirror ${s.mirrorTris})  ${s.gates.length - fails.length}/${s.gates.length} gates${fails.length ? "  FAIL: " + fails.join("; ") : ""}`);
  }
  console.log("sheet:", path.join(OUT, "gates-sheet.png"));
}

if (argv.includes("sheet")) {
  await makeSheet();
} else {
  let list = ROWS;
  const only = flag("--only");
  const batch = flag("--batch");
  if (only) list = ROWS.filter((s) => only.split(",").includes(s[1]));
  else if (batch !== null) list = ROWS.slice(Number(batch) * 4, Number(batch) * 4 + 4);
  await renderStops(list);
}
