import * as THREE from "three";
import { BROOK, GORGE, PATH, PLACES, RIVER, STREAM, WORLD } from "./layout";

/**
 * V4 terrain: a procedural heightfield shaped around the route in layout.ts.
 *
 * Built in layers, each one a plain function of (x, z):
 *   1. land: the coastal shelf rising from the south and east seas toward the
 *      gorge's south rim, and north of the high ridge the basin floor (lake
 *      plateau, forest rising west, then the drop-off below the island)
 *   2. the high ridge between the gorge and the basin (it hides the island),
 *      the west massif, the ring of peaks around the basin, coastal hills
 *   3. carves: the gorge, the river channel, the stream that feeds the falls
 *   4. the trail bench (PATH segments with carve on); it also cuts the notch
 *   5. flat pads under the landmarks, then the lake bowl and the plunge pool
 *
 * Pass 2 adds: the Climb's straight sheer face with a flat rim shelf above it
 * (WORLD.climb), a green saddle in the high ridge where the trail crosses to
 * the lake, the meadow below it with the brook (BROOK), a gentler floor
 * under the forest, and a grey-green tint on gentle ground.
 *
 * v6 (world_art_bible_v6.md 4.3 step 2): the falls moved to the gorge's SOUTH
 * wall (GORGE steepness 9 there) with the stream on the south shelf feeding
 * its lip; the Upper Falls' three steps and tarn on the west massif's east
 * shoulder (upperFalls); the north wall between x 0 and 1,150 is a talus foot
 * and stacked cliff bands (northBands) with the rock spur of the a4 ledge
 * (hikeLedge); the gully notch in the Climb's rim (gully); the a2 lookout's
 * knoll (KNOLL). Nothing north of the ridge changed except the brook's new
 * course. The opening's islet in the bay went on 2026-10-15 with its boulders
 * (Lovro's Loom).
 *
 * terrainHeight runs in about 1 microsecond in node (2026-10-20, 200k random
 * calls; 2.3 before the speed-up that day, which changed no output: see
 * client-tests/terrain-identical.test.mjs). buildTerrainGeometry(320) takes
 * about 75 ms warm and 170 ms on a page's first build, which also fills the
 * hash table and the segment grids.
 * TUNING: the tables and constants below; world-tests/v6-route.mjs re-checks.
 * Changing an output on purpose fails terrain-identical by design: its
 * header says what to do.
 */

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Height gained per unit inland on the coastal shelf. */
const SHELF_GRADE = 0.085;
/** Extra lift toward the gorge's south rim near the falls, so the lip sits at ~410.
 *  The shelf itself stays gentle (0.085): at 0.14 it ran parallel to an 8 degree
 *  view ray and the opening looked into a wall of ground with no distance. */
const RIM_LIFT = 214;
/** v6: how much the south shelf rises from the lip west to the massif's foot. */
const STREAM_SHELF = 80;
/** Basin floor around the lake, and how much the forest rises to the west. */
const BASIN_Y = 585;
const FOREST_RISE = 260;
/** How far the land falls west of the forest, below the island and the clouds. */
const WEST_DROP = 720;

/** The high ridge: [x, crest z, crest height]. Linear between rows. */
const RIDGE: ReadonlyArray<readonly [number, number, number]> = [
  [-4800, 1150, 1400],
  [-2800, 1000, 1500],
  [-2000, 900, 1500],
  [-1000, 770, 1430],
  // Detail pass 3 (sky): a col east of the falls, so the Landing looks up the
  // valley into a notch of sky. West of -450 stays full height: the island's
  // sight lines from the coast cross the ridge at x -700 to -800.
  [-450, 745, 1400],
  [-100, 728, 860],
  [500, 710, 680],
  [950, 698, 900],
  [1120, 695, 1180],
  // The saddle: the trail crosses the ridge here, a green pass, not a trench.
  [1450, 690, 860],
  [1800, 700, 1150],
  [2200, 720, 1180],
  [3000, 800, 820],
  [3800, 850, 300],
  [4200, 870, 0],
];
/** Ridge half-widths (Gaussian sigma) on the gorge side and the basin side. */
const RIDGE_SIGMA_S = 330;
const RIDGE_SIGMA_N = 420;

/** Peaks: [x, z, height, radius]. The west massif, the basin's ring, coastal hills. */
const PEAKS: ReadonlyArray<readonly [number, number, number, number]> = [
  // West massif (the stream's source; part of the wall that hides the island)
  [-1950, 1850, 1550, 560],
  [-2300, 1250, 1450, 520],
  [-1650, 2900, 1150, 480],
  [-2500, 2600, 1300, 600],
  [-3100, 3500, 900, 700],
  // North ring around the basin
  [-1300, -2450, 1300, 420],
  [-500, -2650, 1450, 480],
  [300, -2500, 1350, 450],
  [1100, -2550, 1500, 500],
  [1900, -2350, 1400, 460],
  // East ring
  [2400, -1600, 1350, 450],
  [2450, -800, 1250, 420],
  [2350, 0, 1300, 420],
  // Hills framing the coastal valley
  [2300, 3900, 380, 350],
  [-400, 3700, 450, 450],
  [-1300, 3300, 700, 550],
];

/** The Climb's rim shelf: flat at WORLD.climb.rimY this far north of the face's
 *  top edge, then blending into the ridge over CLIMB_SHELF_BLEND. */
const CLIMB_SHELF_DEPTH = 150;
const CLIMB_SHELF_BLEND = 160;
/** Meadow and forest floor: how much of the craggy noise survives there. */
const SOFT_NOISE = 0.25;
/** Brook channel: depth below the water and bank slope. */
const BROOK_DEPTH = 3;
const BROOK_BANK = 0.35;

/** Channel bank slopes. Steep, so a channel only cuts near its own line
 *  (a gentle slope here turns into a valley kilometres wide). */
const RIVER_BANK = 4;
/** The stream now runs along the ridge's flank: at pass 1's gentle 0.8 its
 *  channel cut a valley into the ridge crest, and the Sky Island showed over
 *  it from the Landing. Steep banks keep it a ravine. */
const STREAM_BANK = 3;
/** Stream bed half-width: narrow at its source, wide enough at the lip for
 *  the falls' curtain (WORLD.falls.width) to pour out of its notch. */
const STREAM_W0 = 14;
const STREAM_W1 = 58;

/** v6, the a2 lookout's knoll (bible 1.3): a dome `h` tall and `r` round
 *  under the lookout (PLACES a2), ~100 west of the trail. */
const KNOLL = { r: 95, h: 26 } as const;
/**
 * v6, the north wall's cliff bands (bible 1.9): out from the floor edge a
 * talus foot TALUS wide rising TALUS_RISE, then bands BAND_W deep: a cliff
 * over the first BAND_CLIFF of each band rising BAND_RISE, a bench over the
 * rest rising BAND_BENCH. Applied between NORTH_BANDS_X0 and _X1 (faded at
 * both ends into the plain wall); the Climb (x > 1180) stays sheer.
 */
const TALUS = 30;
const TALUS_RISE = 16;
const BAND_W = 28;
const BAND_CLIFF = 0.4;
const BAND_RISE = 70;
const BAND_BENCH = 6;
const NORTH_BANDS_X0 = -20;
const NORTH_BANDS_X1 = 1150;
/** The rock spur's (hikeLedge) cliff: how far past its half-width it falls away. */
const LEDGE_BLEND = 24;
/** The Upper Falls' channel: half-width past the drop's own, and the blend out. */
const UPPER_PAD = 16;
const UPPER_BLEND = 46;

/** Trail bench: flat half-width, and the side slopes of the cut and the fill. */
const BENCH_W = 40;
const BENCH_CUT = 1.15;
const BENCH_FILL = 0.9;
const BENCH_REACH0 = 500;
const BENCH_REACH1 = 800;
/** The fill (embankment on the downhill side) only acts this close to the
 *  trail. At the cut's reach it raised the gorge's south wall by 80 beside
 *  the rim overlook and filled 40 into the Climb's face. */
const FILL_REACH0 = 70;
const FILL_REACH1 = 140;

/** Flat pads under landmarks: [x, y, z, flat radius, blend]. The waterfall,
 *  observatory and sky port have none (pool, island). */
const PADS: ReadonlyArray<readonly [number, number, number, number, number]> = (() => {
  // a4 has none: it stands on the gorge floor, which is flat, and a pad would cut the Climb's face.
  // v6: a2's pad is the top of the lookout's knoll (KNOLL); the camp beside
  // the trail keeps its own flat ground (the pad after the loop).
  const r: Record<string, [number, number]> = { a1: [60, 90], a2: [30, 44], a6: [120, 160] };
  const out: [number, number, number, number, number][] = [];
  for (const p of PLACES) {
    const s = r[p.id];
    if (s) out.push([p.pos.x, p.pos.y, p.pos.z, s[0], s[1]]);
  }
  out.push([1350, 566, -440, 45, 70]); // jetty foot on the lake's east shore
  out.push([478, 125, 2702, 55, 60]); // Base Camp's tents and cabin, beside the trail (clear of the knoll)
  return out;
})();

/**
 * The Mirror Lake's shore (map review 2026-10-15, item 15c; Lovro, 8:58 to
 * 9:16: "it's basically a perfect circle ... It should be more of like a real
 * actual structure of water"). The water's edge is a radius from WORLD.lake's
 * centre at each angle; the locked circle (v6-locked.mjs pins WORLD.lake) is
 * only its reference now. Angles are atan2(z - lake.z, x - lake.x) in
 * degrees: 0 east, 90 south, 180 west, 270 north.
 *
 * A slow wander (LAKE_WANDER: longer east to west than north to south), then
 * the rows: [angle, change in radius, half-width before it, half-width after
 * it, in degrees], negative for land reaching into the water. rocks.ts puts
 * the lake's rocks on the points (lakePoints), cover.ts its reeds and shore
 * grass along the shore. Bounds: never past r + 15 (forest.ts plants no tree
 * within r + 22 of the centre), the trail along the east shore 22 to 37 from
 * the water (TRAIL_GAP), life.ts's fish rings on water. light.ts's mirror,
 * water.ts's waterAt and rocks.ts's isWater read this same shore.
 * world-tests/v6-route.mjs checks it; v6-course row 2 the lanterns by it.
 */
const LAKE_SHORE: ReadonlyArray<readonly [number, number, number, number]> = [
  [10, 25, 7, 3], // the brook's inlet
  [22, -30, 3.5, 5], // the rocky point south of the brook (a5's lower left)
  [95, -120, 16, 12], // the south spur, under the ridge
  [150, -30, 12, 12],
  [180, -60, 7, 8], // the west point
  [204, 40, 6, 7], // the glowing stream's bay
  [232, -90, 12, 16], // the north-west point
  [262, 40, 7, 6], // the north bay
  [286, -150, 6, 9], // the north point
  [308, 20, 6, 6],
  [330, -45, 5, 7], // the north-east point
];
/** The wander under the rows: [amplitude, waves round the lake, phase]. */
const LAKE_WANDER: ReadonlyArray<readonly [number, number, number]> = [
  [22, 2, 1.5708],
  [9, 1, 0.9],
  [6, 3, 0.4],
  [3, 5, 1.7],
];
/** Mean shore radius past WORLD.lake.r, and the most it may reach past it. */
const LAKE_SHORE_MEAN = -8;
const LAKE_SHORE_MAX = 15;
/** The water's surface: light.ts's mirror, WORLD.lake.y plus its LAKE_LIFT. */
export const LAKE_SURFACE = WORLD.lake.y + 0.5;
/** How far light.ts's mirror reaches past the shore, under the bank (never seen). */
export const LAKE_PAD = 14;
/** The farthest the shore reaches from WORLD.lake's centre (with LAKE_PAD, the mirror's bound). */
export const LAKE_OUTER = WORLD.lake.r + LAKE_SHORE_MAX;
/** The bank: the land blends down to the water's edge from LAKE_REACH past r (v5's bowl did from r). */
const LAKE_REACH = 160;
/** The bed's slope from the water's edge, and the bank's least slope beside it. */
const SHORE_SHELF = 0.15;
const SHORE_BANK = 0.12;

/** The least gap from the water to the trail's middle line (its paint is 8.5 across each side). */
const TRAIL_GAP = 22;
/** How far from the lake's centre the ray at angle t first meets the trail (PATH as drawn), or Infinity. */
function trailRay(t: number): number {
  const L = WORLD.lake;
  const dx = Math.cos(t);
  const dz = Math.sin(t);
  let best = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) {
    const ax = PATH[i].x - L.x;
    const az = PATH[i].z - L.z;
    const ex = PATH[i + 1].x - PATH[i].x;
    const ez = PATH[i + 1].z - PATH[i].z;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const s = (ax * ez - az * ex) / den;
    const u = (ax * dz - az * dx) / den;
    if (s > 0 && u >= 0 && u <= 1 && s < best) best = s;
  }
  return best;
}

/** The shore's radius every half degree (filled on first use). */
const SHORE_STEPS = 720;
let shoreTab: Float32Array | null = null;
function shoreTable(): Float32Array {
  const tab = new Float32Array(SHORE_STEPS + 1);
  const top = WORLD.lake.r + LAKE_SHORE_MAX;
  for (let i = 0; i <= SHORE_STEPS; i++) {
    const deg = (i / SHORE_STEPS) * 360;
    const t = (deg * Math.PI) / 180;
    let R = WORLD.lake.r + LAKE_SHORE_MEAN;
    for (const [a, n, ph] of LAKE_WANDER) R += a * Math.sin(n * t + ph);
    for (const [at, dr, w0, w1] of LAKE_SHORE) {
      let d = deg - at;
      d -= 360 * Math.round(d / 360);
      const u = d / (d < 0 ? w0 : w1);
      R += dr * Math.exp(-u * u);
    }
    // Coves stop short of LAKE_SHORE_MAX softly (no flat ledge in the outline).
    if (R > top - 6) R = top - 6 * Math.exp(-(R - (top - 6)) / 6);
    // Clear of the trail where it runs along the shore, by a gap that wanders.
    const tr = trailRay(t);
    if (tr < Infinity) R = smin(R, tr - (TRAIL_GAP + 9 * (0.5 + 0.5 * Math.sin(7 * t + 1.3)) + 6 * (0.5 + 0.5 * Math.sin(13 * t + 0.2))), 8);
    tab[i] = R;
  }
  return tab;
}

/** The Mirror Lake's shore radius at `angle` (radians, atan2(z - lake.z, x - lake.x)). */
export function lakeShoreR(angle: number): number {
  let f = (angle / (2 * Math.PI)) * SHORE_STEPS;
  f -= SHORE_STEPS * Math.floor(f / SHORE_STEPS);
  const i = Math.floor(f);
  const u = f - i;
  const tab = shoreTab ?? (shoreTab = shoreTable());
  return tab[i] + (tab[i + 1] - tab[i]) * u;
}
/** The shore's radius on the line from the lake's centre through (x, z). */
export function lakeShoreAt(x: number, z: number): number {
  return lakeShoreR(Math.atan2(z - WORLD.lake.z, x - WORLD.lake.x));
}

/**
 * The shore's points, where land reaches into the water (rocks.ts stands its
 * lake rocks on them): each least radius that lies at least POINT_MIN under
 * the shore either side of it (the greatest radius within POINT_SPAN degrees
 * on that side). Angle in radians, the radius there, and that depth.
 */
const POINT_MIN = 25;
const POINT_SPAN = 30;
export function lakePoints(): Array<{ angle: number; r: number; depth: number }> {
  const tab = shoreTab ?? (shoreTab = shoreTable());
  const N = SHORE_STEPS;
  const at = (i: number) => tab[((i % N) + N) % N];
  const span = Math.round((POINT_SPAN / 360) * N);
  const out: Array<{ angle: number; r: number; depth: number }> = [];
  for (let i = 0; i < N; i++) {
    const v = at(i);
    if (!(v < at(i - 1) && v <= at(i + 1))) continue;
    let left = -Infinity;
    let right = -Infinity;
    for (let k = 1; k <= span; k++) {
      left = Math.max(left, at(i - k));
      right = Math.max(right, at(i + k));
    }
    const depth = Math.min(left, right) - v;
    if (depth >= POINT_MIN) out.push({ angle: (i / N) * Math.PI * 2, r: v, depth });
  }
  return out;
}

// ── The plunge pool's shore ──────────────────────────────────────────────────

/**
 * Map review 2026-10-15, item 15b, review round 1 (Lovro, 4:53 to 5:04: "we
 * have this circle and then we have running water. So it should all kind of
 * intertwine and be one"): the plunge pool's shore, the waterline as drawn, is
 * WORLD.pool's circle drawn in POOL_INSET, with points of land reaching into
 * it on the west and the north, the side the rail looks across from Video Ads
 * I to the log. The east (the trail and the falls' boulders), the falls' cliff
 * and the river's mouth keep the circle. Rows: [math angle in degrees,
 * atan2(z - pool.z, x - pool.x); how far in; width in degrees]. All of it
 * inside WORLD.pool.r and under WORLD.pool.y, so whatever keeps out of the
 * pool by its circle and its level (rocks.ts isWater, cover.ts, scene.ts
 * surfaceHeight) keeps out of it as before; the water is drawn lower
 * (POOL_SURFACE), and the ground rises out of it to POOL_LAND.
 */
const POOL_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [190, 11, 15], // the west point, under the pool ring's west boulders
  [240, 6, 11],
  [262, 4, 30], // the north-west shore, drawn in a little all along
  [284, 13, 13], // the north point, across the pool from the rail
  [318, 6, 8],
];
/** The points stay between these angles (degrees), fading in and out over the last 12 to 25. */
const POOL_POINTS_ARC = [150, 330] as const;
/**
 * The shore lies this far inside the circle everywhere, so the drawn grid
 * crosses the water's level in the middle of the ground's rise out of it (16
 * across, its middle on the shore): a smooth waterline, not the stair a step
 * draws. The bowl still ends at WORLD.pool.r; where the shore is the circle's,
 * the rise is cut there, 0.15 over the water.
 */
const POOL_INSET = 2;
/** The pool's water as water.ts draws it (the "Pool" disc): under WORLD.pool.y, half way up the rise. */
export const POOL_SURFACE = WORLD.pool.y - 0.5;
/** How far the Pool disc reaches past the shore, under the bank (never seen). */
export const POOL_PAD = 5;
/** The ground the rise reaches (the points' top): over the water as drawn, under WORLD.pool.y. */
const POOL_LAND = WORLD.pool.y - 0.04;

/** The plunge pool's shore radius (the waterline) at `angle` (radians, atan2(z - pool.z, x - pool.x)): under WORLD.pool.r. */
export function poolShoreR(angle: number): number {
  let deg = (angle * 180) / Math.PI;
  deg -= 360 * Math.floor(deg / 360);
  const [a0, a1] = POOL_POINTS_ARC;
  const m = smooth(a0 - 10, a0 + 15, deg) * (1 - smooth(a1 - 12, a1, deg));
  if (m <= 0) return WORLD.pool.r - POOL_INSET;
  let d = 0;
  for (const [at, depth, w] of POOL_POINTS) {
    const u = (deg - at) / w;
    d += depth * Math.exp(-u * u);
  }
  return WORLD.pool.r - POOL_INSET - d * m;
}
/** The shore's radius on the line from the pool's centre through (x, z). */
export function poolShoreAt(x: number, z: number): number {
  return poolShoreR(Math.atan2(z - WORLD.pool.z, x - WORLD.pool.x));
}

/** Recommended grid resolution (cells along the long side): ~29 units a cell,
 *  ~190k triangles. */
export const TERRAIN_RES = 320;

// ── Helpers ──────────────────────────────────────────────────────────────────

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Smoothstep from a to b (a may be greater than b). */
function smooth(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function smin(a: number, b: number, k: number): number {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return b + (a - b) * h - k * h * (1 - h);
}
/**
 * Whether (a, b) can lie closer than r to the origin (speed, 2026-10-20).
 * Math.hypot is slow and never below either leg, so where this is false the
 * distance is r or more. The callers pass Infinity then, which every test and
 * smooth() they feed treats exactly as any distance of r or more: no height
 * changes by a bit.
 */
function near(a: number, b: number, r: number): boolean {
  return a < r && a > -r && b < r && b > -r;
}
function hash(x: number, y: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * hash() at the lattice corners noise() reads, kept once computed (speed,
 * 2026-10-20: hash was the top function of the map's load). noise() only
 * ever asks for whole-number corners, and every corner comes back many times:
 * each ground height reads about 20 noises of 4 corners. The table holds the
 * very value hash() returned, so no height changes by a bit
 * (client-tests/terrain-identical.test.mjs runs the old code beside this
 * one). Corners outside it are computed as before. 2 MB, filled as it is read.
 */
const LATTICE_HALF = 256;
const LATTICE_W = 2 * LATTICE_HALF;
let lattice: Float64Array | null = null;

function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let u = x - ix;
  let v = y - iy;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  let a: number;
  let b: number;
  let c: number;
  let d: number;
  // NaN or infinite corners fail this test and take the plain path.
  if (ix >= -LATTICE_HALF && ix < LATTICE_HALF - 1 && iy >= -LATTICE_HALF && iy < LATTICE_HALF - 1) {
    const T = lattice ?? (lattice = new Float64Array(LATTICE_W * LATTICE_W).fill(NaN));
    const k = (iy + LATTICE_HALF) * LATTICE_W + ix + LATTICE_HALF;
    // NaN marks a corner not computed yet (hash() itself never returns NaN here).
    a = T[k];
    if (a !== a) a = T[k] = hash(ix, iy);
    b = T[k + 1];
    if (b !== b) b = T[k + 1] = hash(ix + 1, iy);
    c = T[k + LATTICE_W];
    if (c !== c) c = T[k + LATTICE_W] = hash(ix, iy + 1);
    d = T[k + LATTICE_W + 1];
    if (d !== d) d = T[k + LATTICE_W + 1] = hash(ix + 1, iy + 1);
  } else {
    a = hash(ix, iy);
    b = hash(ix + 1, iy);
    c = hash(ix, iy + 1);
    d = hash(ix + 1, iy + 1);
  }
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
/** Three octaves, 0..1. */
function fbm(x: number, y: number): number {
  return 0.57 * noise(x, y) + 0.29 * noise(x * 2.03 + 17.1, y * 2.03 - 9.2) + 0.14 * noise(x * 4.1 - 31.7, y * 4.1 + 5.3);
}

function coastZ(x: number): number {
  const u = x - 1300;
  return 4280 + 120 * Math.sin(u * 0.0012) + 50 * Math.sin(u * 0.0041);
}
function coastX(z: number): number {
  return 3350 + 150 * Math.sin(z * 0.0011 + 0.5) + 60 * Math.sin(z * 0.0037);
}

// Scratch for the polyline queries (module-level, so no allocation per call).
let qD = 0; // distance to the polyline
let qI = 0; // segment index
let qU = 0; // position along that segment, 0..1
let qSide = 0; // -1 north of the line (toward -z), +1 south

/** Nearest point on a polyline of [x, ?, z]-style rows (x at 0, z at zi). */
function nearest(rows: ReadonlyArray<ReadonlyArray<number>>, zi: number, x: number, z: number): void {
  let best = Infinity;
  for (let i = 0; i < rows.length - 1; i++) {
    const ax = rows[i][0];
    const az = rows[i][zi];
    const dx = rows[i + 1][0] - ax;
    const dz = rows[i + 1][zi] - az;
    const px = x - ax;
    const pz = z - az;
    const l2 = dx * dx + dz * dz;
    const u = clamp01((px * dx + pz * dz) / l2);
    const ex = px - dx * u;
    const ez = pz - dz * u;
    const d2 = ex * ex + ez * ez;
    if (d2 < best) {
      best = d2;
      qI = i;
      qU = u;
      qSide = dx * pz - dz * px < 0 ? -1 : 1;
    }
  }
  qD = Math.sqrt(best);
}

/**
 * A polyline's segments with a grid of the ones each cell can need (speed,
 * 2026-10-20). nearest() and bench() scanned every segment for every height;
 * a point needs only the segments that can be nearest to it. For a cell with
 * centre c, half-diagonal R and nearest segment Dc away, a point inside it is
 * at most Dc + R from the line, so its nearest segment is at most Dc + 2R from
 * c: the cell keeps every segment that close, plus SEG_SLACK for rounding.
 * The kept segments are tried in the polyline's order with the same sums and
 * the same strict "<", so the pick, ties included, is the full scan's.
 * Outside the grid the full scan runs. `low` is a floor under the distance
 * from any point of the cell to the line (bench()'s reach test).
 */
interface SegGrid {
  /** Per segment, in the polyline's order: start, step and squared length. */
  ax: Float64Array;
  az: Float64Array;
  dx: Float64Array;
  dz: Float64Array;
  l2: Float64Array;
  /** Every segment the scan reads, in order (a zero-length one never wins, so it is left out). */
  all: Int32Array;
  /** Cell k's segments are ids[start[k]] to ids[start[k + 1] - 1], in order. */
  start: Int32Array;
  ids: Int32Array;
  low: Float64Array;
}
const SEG_CELL = 200;
const SEG_SLACK = 2;
const SEG_X0 = WORLD.minX - 400;
const SEG_Z0 = WORLD.minZ - 400;
const SEG_NX = Math.ceil((WORLD.maxX - WORLD.minX + 800) / SEG_CELL);
const SEG_NZ = Math.ceil((WORLD.maxZ - WORLD.minZ + 800) / SEG_CELL);

/** `pts` as [x, z]; `keep(i)` says whether the segment from point i to i + 1 counts. */
function segGrid(pts: ReadonlyArray<readonly [number, number]>, keep: (i: number) => boolean): SegGrid {
  const n = Math.max(0, pts.length - 1);
  const ax = new Float64Array(n);
  const az = new Float64Array(n);
  const dx = new Float64Array(n);
  const dz = new Float64Array(n);
  const l2 = new Float64Array(n);
  const used: number[] = [];
  for (let i = 0; i < n; i++) {
    ax[i] = pts[i][0];
    az[i] = pts[i][1];
    dx[i] = pts[i + 1][0] - ax[i];
    dz[i] = pts[i + 1][1] - az[i];
    l2[i] = dx[i] * dx[i] + dz[i] * dz[i];
    if (keep(i) && l2[i] > 0) used.push(i);
  }
  const all = Int32Array.from(used);
  const R = SEG_CELL * Math.SQRT1_2;
  const cells = SEG_NX * SEG_NZ;
  const start = new Int32Array(cells + 1);
  const low = new Float64Array(cells);
  const ids: number[] = [];
  const dist = new Float64Array(n);
  for (let j = 0; j < SEG_NZ; j++) {
    for (let i = 0; i < SEG_NX; i++) {
      const cx = SEG_X0 + (i + 0.5) * SEG_CELL;
      const cz = SEG_Z0 + (j + 0.5) * SEG_CELL;
      let dc = Infinity;
      for (let m = 0; m < all.length; m++) {
        const s = all[m];
        const px = cx - ax[s];
        const pz = cz - az[s];
        const u = clamp01((px * dx[s] + pz * dz[s]) / l2[s]);
        const ex = px - dx[s] * u;
        const ez = pz - dz[s] * u;
        dist[s] = Math.sqrt(ex * ex + ez * ez);
        if (dist[s] < dc) dc = dist[s];
      }
      const k = j * SEG_NX + i;
      start[k] = ids.length;
      for (let m = 0; m < all.length; m++) if (dist[all[m]] <= dc + 2 * R + SEG_SLACK) ids.push(all[m]);
      low[k] = dc - R - SEG_SLACK;
    }
  }
  start[cells] = ids.length;
  return { ax, az, dx, dz, l2, all, start, ids: Int32Array.from(ids), low };
}

/** The cell (x, z) falls in, or -1 outside the grid (NaN and infinities too). */
function segCell(x: number, z: number): number {
  const fi = (x - SEG_X0) / SEG_CELL;
  const fj = (z - SEG_Z0) / SEG_CELL;
  if (!(fi >= 0 && fi < SEG_NX && fj >= 0 && fj < SEG_NZ)) return -1;
  return Math.floor(fj) * SEG_NX + Math.floor(fi);
}

/** nearest() over a SegGrid: the same qD, qI, qU and qSide, bit for bit. */
function nearestOn(g: SegGrid, x: number, z: number): void {
  const k = segCell(x, z);
  const list = k < 0 ? g.all : g.ids;
  const from = k < 0 ? 0 : g.start[k];
  const to = k < 0 ? list.length : g.start[k + 1];
  let best = Infinity;
  for (let m = from; m < to; m++) {
    const i = list[m];
    const dx = g.dx[i];
    const dz = g.dz[i];
    const px = x - g.ax[i];
    const pz = z - g.az[i];
    const u = clamp01((px * dx + pz * dz) / g.l2[i]);
    const ex = px - dx * u;
    const ez = pz - dz * u;
    const d2 = ex * ex + ez * ez;
    if (d2 < best) {
      best = d2;
      qI = i;
      qU = u;
      qSide = dx * pz - dz * px < 0 ? -1 : 1;
    }
  }
  qD = Math.sqrt(best);
}

/** The grids carves() and bench() read, built on the first height asked for. */
interface SegGrids {
  gorge: SegGrid;
  river: SegGrid;
  stream: SegGrid;
  brook: SegGrid;
  /** PATH's segments with carve on, as bench() reads them. */
  bench: SegGrid;
}
let grids: SegGrids | null = null;
const xzOf = (rows: ReadonlyArray<ReadonlyArray<number>>, zi: number) => rows.map((r) => [r[0], r[zi]] as const);
function segGrids(): SegGrids {
  if (grids) return grids;
  const every = () => true;
  grids = {
    gorge: segGrid(xzOf(GORGE, 1), every),
    river: segGrid(xzOf(RIVER, 2), every),
    stream: segGrid(xzOf(STREAM, 2), every),
    brook: segGrid(xzOf(BROOK, 2), every),
    bench: segGrid(
      PATH.map((p) => [p.x, p.z] as const),
      (i) => PATH[i].carve,
    ),
  };
  return grids;
}

function ridgeAt(x: number, out: { z: number; h: number }): void {
  const r = RIDGE;
  let i = 0;
  while (i < r.length - 2 && x > r[i + 1][0]) i++;
  const t = clamp01((x - r[i][0]) / (r[i + 1][0] - r[i][0]));
  out.z = r[i][1] + (r[i + 1][1] - r[i][1]) * t;
  out.h = r[i][2] + (r[i + 1][2] - r[i][2]) * t;
}
const ridgeScratch = { z: 0, h: 0 };

// ── Layers ───────────────────────────────────────────────────────────────────

/** South of the ridge: sea floor, beach, the coastal shelf. */
function shelf(x: number, z: number): number {
  const inland = smin(coastZ(x) - z, coastX(z) - x, 350);
  if (inland < 0) return Math.max(-60, inland * 0.22);
  const n = fbm(x / 900, z / 900) - 0.5;
  return (
    SHELF_GRADE * inland +
    36 * n * smooth(0, 500, inland) +
    RIM_LIFT * smooth(2750, 1850, z) * smooth(1700, -100, x) +
    // v6: the south shelf rises west toward the massif, so the stream falls
    // along it from the Upper Falls' tarn to the lip.
    STREAM_SHELF * smooth(-60, -1000, x) * smooth(2350, 2000, z)
  );
}

/** North of the ridge: lake plateau, forest rising west, the drop-off. */
function basinFloor(x: number, z: number, shelfH: number): number {
  // The drop-off edge wanders, so it never reads as a ruled line from above.
  const edge = -1450 + 220 * Math.sin(z / 520 + 1);
  const drop = smooth(edge, edge - 1250, x);
  let h = BASIN_Y + FOREST_RISE * smooth(350, -1250, x) - WEST_DROP * drop;
  h += 30 * (fbm(x / 700 + 40, z / 700) - 0.5) + 220 * (fbm(x / 520 - 13, z / 520) - 0.5) * drop;
  // The basin's east side falls back to the coast beyond the east ring.
  return h + (shelfH - h) * smooth(2600, 3300, x);
}

/** Everything except the carves, pads and water: the land and its mountains. */
function landform(x: number, z: number): number {
  ridgeAt(x, ridgeScratch);
  const zc = ridgeScratch.z;
  const s = shelf(x, z);
  const north = smooth(zc + 300, zc - 300, z);
  // Speed (2026-10-20), here and below: work is skipped only where its result
  // could not change h. South of the ridge north is 0, and s plus a product
  // with 0 is s (unless s is 0, when the sign of the zero could change).
  let h = north === 0 && s !== 0 ? s : s + (basinFloor(x, z, s) - s) * north;

  // The ridge: a crest line with peaks along it, steeper on the gorge side.
  const dz = z - zc;
  const sig = dz > 0 ? RIDGE_SIGMA_S : RIDGE_SIGMA_N;
  const crest = ridgeScratch.h * (0.86 + 0.28 * fbm(x / 430, 3.1));
  if (crest > h) {
    const g = Math.exp(-(dz * dz) / (sig * sig)) * (0.9 + 0.2 * noise(x / 160, z / 160));
    h += (crest - h) * g;
  }

  for (let i = 0; i < PEAKS.length; i++) {
    const p = PEAKS[i];
    const ex = x - p[0];
    const ez = z - p[1];
    const r2 = (ex * ex + ez * ez) / (p[3] * p[3]);
    if (r2 > 9) continue;
    const top = p[2] * (0.86 + 0.28 * noise(x / 190 + i * 7.3, z / 190));
    if (top > h) h += (top - h) * Math.exp(-r2);
  }
  h = climbShelf(x, z, h);
  // Craggy detail that grows with height, softened on the meadow and forest floor.
  // Below 250 the growth is 0: the detail is a zero, which leaves h as it is
  // unless h is 0 (or NaN, when the growth is NaN and the sum runs).
  const grow = smooth(250, 1100, h);
  if (grow !== 0 || h === 0) {
    const soft = softness(x, z);
    h += (fbm(x / 140, z / 140) - 0.5) * 60 * grow * (1 - (1 - SOFT_NOISE) * soft);
  }
  return h;
}

/** 1 on the meadow below the saddle and on the forest floor, 0 elsewhere. */
function softness(x: number, z: number): number {
  const M = WORLD.meadow;
  const F = WORLD.forest;
  const mx = x - M.x;
  const mz = z - M.z;
  const fx = x - F.x;
  const fz = z - F.z;
  const m = 1 - smooth(M.r * 0.75, M.r, near(mx, mz, M.r) ? Math.hypot(mx, mz) : Infinity);
  const f = 1 - smooth(F.r * 0.8, F.r, near(fx, fz, F.r) ? Math.hypot(fx, fz) : Infinity);
  return m > f ? m : f;
}

/** The Climb: raise the ground behind the face to a flat shelf at rimY, so
 *  the gorge carve (steepness 12 there) leaves one sheer straight wall from
 *  the floor to the rim. */
function climbShelf(x: number, z: number, h: number): number {
  const C = WORLD.climb;
  // Distance outside the face's x span (rounded ends).
  const ex = x < C.x0 ? C.x0 - x : x > C.x1 ? x - C.x1 : 0;
  // Distance north of the face's top edge (only behind the face).
  const nz = C.topZ - z;
  if (nz < -80) return h;
  const back = nz > CLIMB_SHELF_DEPTH ? nz - CLIMB_SHELF_DEPTH : 0;
  const d = near(ex, back, CLIMB_SHELF_BLEND) ? Math.hypot(ex, back) : Infinity;
  const w = 1 - smooth(0, CLIMB_SHELF_BLEND, d);
  if (w <= 0 || h >= C.rimY) return h;
  return h + (C.rimY - h) * w;
}

/** Height of the north wall's banded profile at `e` units out from the floor
 *  edge (continuous; the average steepness is (BAND_RISE + BAND_BENCH) / BAND_W). */
function northBands(e: number): number {
  if (e < TALUS) {
    const t = e / TALUS;
    return TALUS_RISE * t * t;
  }
  const k = (e - TALUS) / BAND_W;
  const i = Math.floor(k);
  const f = k - i;
  const per = BAND_RISE + BAND_BENCH;
  const r = f < BAND_CLIFF ? BAND_RISE * smooth(0, 1, f / BAND_CLIFF) : BAND_RISE + (BAND_BENCH * (f - BAND_CLIFF)) / (1 - BAND_CLIFF);
  return TALUS_RISE + i * per + r;
}

/** The gorge, the river channel in its floor, and the stream feeding the falls. */
function carves(x: number, z: number, h: number): number {
  const lines = segGrids();
  nearestOn(lines.gorge, x, z);
  const a = GORGE[qI];
  const b = GORGE[qI + 1];
  const u = qU;
  const floor = a[2] + (b[2] - a[2]) * u;
  const halfW = a[3] + (b[3] - a[3]) * u;
  const wall = qSide < 0 ? a[4] + (b[4] - a[4]) * u : a[5] + (b[5] - a[5]) * u;
  const e = qD - halfW;
  let rise = e > 0 ? e * wall : 0;
  if (qSide < 0 && e > 0) {
    // v6: the north wall's talus foot and cliff bands.
    const w = smooth(NORTH_BANDS_X0, NORTH_BANDS_X0 + 60, x) * (1 - smooth(NORTH_BANDS_X1 - 70, NORTH_BANDS_X1, x));
    if (w > 0) rise += (northBands(e) - rise) * w;
  }
  const g = floor + rise + 3 * noise(x / 60, z / 60) * smooth(0, 30, e);
  if (g < h) h = g;

  // v6: the gully notch in the Climb's rim (WORLD.gully).
  {
    const G = WORLD.gully;
    if (z > G.z1 - 60 && z < G.z0 + 40) {
      const t = clamp01((G.z0 - z) / (G.z0 - G.z1));
      const fy = G.y0 + (G.y1 - G.y0) * t;
      const out = Math.max(0, Math.abs(x - G.x) - G.halfW);
      // The notch closes off smoothly past its top on the rim shelf.
      const c = fy + out * G.wall + Math.max(0, G.z1 - z) * 2.5 + 2 * noise(x / 25, z / 25);
      if (c < h) h = c;
    }
  }

  nearestOn(lines.river, x, z);
  // Nothing before the river's first point (the pool): its round end cap
  // would otherwise cut a notch into the falls cliff.
  if (!(qI === 0 && qU === 0)) {
    const ra = RIVER[qI];
    const rb = RIVER[qI + 1];
    const ry = ra[1] + (rb[1] - ra[1]) * qU;
    const c = ry - 3 + Math.max(0, qD - 16) * RIVER_BANK;
    if (c < h) h = c;
  }

  nearestOn(lines.stream, x, z);
  {
    const sa = STREAM[qI];
    const sb = STREAM[qI + 1];
    const sy = sa[1] + (sb[1] - sa[1]) * qU;
    const along = (qI + qU) / (STREAM.length - 1);
    const c = sy - 5 + Math.max(0, qD - (STREAM_W0 + (STREAM_W1 - STREAM_W0) * along * along)) * STREAM_BANK;
    if (c < h) h = c;
  }

  nearestOn(lines.brook, x, z);
  if (qD < 120) {
    const ba = BROOK[qI];
    const bb = BROOK[qI + 1];
    const by = ba[1] + (bb[1] - ba[1]) * qU;
    const c = by - BROOK_DEPTH + Math.max(0, qD - 6) * BROOK_BANK;
    if (c < h) h = c;
  }
  return h;
}

/** The trail bench along PATH segments with carve on. The cut cone also makes
 *  the notch through the ridge. The fill only acts beside a segment (not
 *  past its ends), so the bench never fills in the cliff beside the falls. */
function bench(x: number, z: number, h: number): number {
  // The carve segments from the grid (segGrid): the same pick as a scan of
  // every one, and a cell wholly past the reach returns h as the scan would.
  const g = segGrids().bench;
  const k = segCell(x, z);
  if (k >= 0 && g.low[k] >= BENCH_REACH1) return h;
  const list = k < 0 ? g.all : g.ids;
  const from = k < 0 ? 0 : g.start[k];
  const to = k < 0 ? list.length : g.start[k + 1];
  let best = Infinity;
  let py = 0;
  let inside = false;
  for (let m = from; m < to; m++) {
    const i = list[m];
    const A = PATH[i];
    const B = PATH[i + 1];
    const dx = g.dx[i];
    const dz = g.dz[i];
    const px = x - g.ax[i];
    const pz = z - g.az[i];
    const ur = (px * dx + pz * dz) / g.l2[i];
    const u = clamp01(ur);
    const ex = px - dx * u;
    const ez = pz - dz * u;
    const d2 = ex * ex + ez * ez;
    if (d2 < best) {
      best = d2;
      py = A.y + (B.y - A.y) * u;
      inside = ur > 0 && ur < 1;
    }
  }
  const d = Math.sqrt(best);
  if (d >= BENCH_REACH1) return h;
  const e = Math.max(0, d - BENCH_W);
  const hi = py + e * BENCH_CUT;
  if (h > hi) return h + (hi - h) * (1 - smooth(BENCH_REACH0, BENCH_REACH1, d));
  const lo = inside ? py - e * BENCH_FILL : -Infinity;
  if (h < lo) return h + (lo - h) * (1 - smooth(FILL_REACH0, FILL_REACH1, d));
  return h;
}

/** v6: the Upper Falls' stepped channel and the tarn (WORLD.upperFalls). */
function upperFalls(x: number, z: number, h: number): number {
  const U = WORLD.upperFalls;
  const D = U.drops;
  const T = U.tarn;
  // Quick reject: far from the cascade's box.
  if (x < D[0][0] - 220 || x > T.x + T.r + 120 || z < T.z - 220 || z > D[0][2] + 220) return h;
  // Each step: from drop i's lip back upstream a little (the pool under the
  // drop before it) to the next lip. The water leaves each lip heading `flow`.
  let best = h;
  let bestW = 0;
  for (let i = 0; i < D.length; i++) {
    const [lx, ly, lz, w] = D[i];
    const nx = i + 1 < D.length ? D[i + 1][0] : T.x;
    const nz = i + 1 < D.length ? D[i + 1][2] : T.z;
    const ny = i + 1 < D.length ? D[i + 1][1] : T.y;
    // Along the step from this lip (0) to the next (1), and across it.
    const sx = nx - lx;
    const sz = nz - lz;
    const L = Math.hypot(sx, sz);
    const ax = (x - lx) * (sx / L) + (z - lz) * (sz / L);
    const across = Math.abs((x - lx) * (sz / L) - (z - lz) * (sx / L));
    if (ax < -60 || ax > L + 10) continue;
    const half = w / 2 + UPPER_PAD;
    const wgt = 1 - smooth(half, half + UPPER_BLEND, across);
    if (wgt <= 0) continue;
    // Behind the lip: the ledge the water runs across before it drops (at
    // the lip's height); past the lip: the cliff (a few units), then the
    // next step's pool, a little under the next lip.
    const drop = smooth(0, 10, ax);
    const y = ly - 3 + (ny - 4 - (ly - 3)) * drop;
    if (wgt > bestW) {
      bestW = wgt;
      best = h + (y - h) * wgt;
    }
  }
  h = best;
  // The tarn's bowl.
  const dt = Math.hypot(x - T.x, z - T.z);
  if (dt < T.r + 34) {
    const k = dt / T.r;
    const bowl = dt < T.r ? T.y - 1 - 10 * (1 - k * k) : T.y - 1;
    const w = 1 - smooth(T.r, T.r + 34, dt);
    h = h + (bowl - h) * w;
  }
  return h;
}

/** v6: the rock bench of the a4 ledge (WORLD.hikeLedge): flat at y from its
 *  outer edge (a polyline running east to west) `depth` back into the wall,
 *  blending into the wall behind and dropping in a cliff south of the edge. */
function hikeLedge(x: number, z: number, h: number): number {
  const S = WORLD.hikeLedge;
  if (x < 300 || x > 840 || z < 1080 || z > 1320) return h;
  nearest(S.edge, 1, x, z);
  // The edge runs west, so a point north of it (inside the bench) has qSide +1.
  const d = qSide > 0 ? qD : -qD;
  const rag = 5 * (noise(x / 16, z / 16) - 0.5);
  let w: number;
  if (d >= 0) w = 1 - smooth(S.depth, S.depth + 44, d);
  else w = 1 - smooth(rag, rag + LEDGE_BLEND, -d);
  if (w <= 0) return h;
  const top = S.y + 0.8 * (noise(x / 9, z / 9) - 0.5);
  return h + (top - h) * w;
}

function padsAndWater(x: number, z: number, h: number): number {
  // v6: the lookout's knoll (a dome under PLACES a2; its pad flattens the top).
  {
    const A2 = PLACES[1].pos;
    const kx = x - A2.x;
    const kz = z - A2.z;
    const dk = near(kx, kz, KNOLL.r) ? Math.hypot(kx, kz) : Infinity;
    if (dk < KNOLL.r) {
      const k = dk / KNOLL.r;
      h += KNOLL.h * (1 - k * k) * (1 - k * k);
    }
  }
  h = hikeLedge(x, z, h);
  h = upperFalls(x, z, h);
  for (let i = 0; i < PADS.length; i++) {
    const p = PADS[i];
    const px = x - p[0];
    const pz = z - p[2];
    const d = near(px, pz, p[3] + p[4]) ? Math.hypot(px, pz) : Infinity;
    if (d < p[3] + p[4]) h += (p[1] - h) * (1 - smooth(p[3], p[3] + p[4], d));
  }
  // The Mirror Lake (item 15c): the bed inside the shore, the bank outside it.
  const L = WORLD.lake;
  const dxl = x - L.x;
  const dzl = z - L.z;
  const dl = near(dxl, dzl, L.r + LAKE_REACH) ? Math.hypot(dxl, dzl) : Infinity;
  if (dl < L.r + LAKE_REACH) {
    const R = lakeShoreR(Math.atan2(dzl, dxl));
    if (dl < R) {
      // v5's bowl scaled to this shore, on a shelf that rises to the water's edge.
      const k = dl / R;
      const bed = L.y - 1 - 40 * (1 - k * k);
      const shelf = LAKE_SURFACE + SHORE_SHELF * (dl - R);
      h = bed > shelf ? bed : shelf;
    } else {
      // The land blended down to the water's edge (as v5's bowl did from r),
      // and never flatter than SHORE_BANK beside it, so no ground under the
      // water's level lies past the shore. A channel cut lower (the brook's
      // mouth) is left low: the lake runs into it.
      const hb = LAKE_SURFACE + (h - LAKE_SURFACE) * smooth(R, L.r + LAKE_REACH, dl);
      const lift = Math.min(h, LAKE_SURFACE + SHORE_BANK * (dl - R));
      h = hb > lift ? hb : lift;
    }
  }
  const Pl = WORLD.pool;
  const qx = x - Pl.x;
  const qz = z - Pl.z;
  const dp = near(qx, qz, Pl.r) ? Math.hypot(qx, qz) : Infinity;
  if (dp < Pl.r) {
    // The bowl, scaled to the shore (poolShoreR), and the ground's rise out of
    // it to POOL_LAND over the 16 across the shore, which crosses the water
    // as drawn (POOL_SURFACE) on the shore itself; the points' ground runs on
    // out to the circle.
    const R = poolShoreR(Math.atan2(z - Pl.z, x - Pl.x));
    const k = Math.min(1, dp / R);
    const bed = Pl.y - 1 - 14 * (1 - k * k);
    const c = bed + (POOL_LAND - bed) * smooth(R - 8, R + 8, dp);
    if (c < h) h = c;
  }
  return h;
}

// ── Public ───────────────────────────────────────────────────────────────────

/** Ground height at (x, z). Deterministic; no allocation after the first call,
 *  which makes the segment grids and the hash table (filled as it is read). Outside WORLD it
 *  keeps going (sea to the south and east, land elsewhere). */
export function terrainHeight(x: number, z: number): number {
  let h = landform(x, z);
  h = carves(x, z, h);
  h = bench(x, z, h);
  return padsAndWater(x, z, h);
}

/** For diagnostics only: the height before the trail bench, pads and water. */
export function terrainBeforeBench(x: number, z: number): number {
  return carves(x, z, landform(x, z));
}

// Grey height tint (linear RGB): sea floor, shore, shelf, rock, high rock, peaks.
const TINT: ReadonlyArray<readonly [number, number, number, number]> = [
  [-60, 0.3, 0.34, 0.4],
  [0, 0.46, 0.46, 0.42],
  [250, 0.44, 0.47, 0.4],
  [700, 0.5, 0.49, 0.46],
  [1100, 0.6, 0.59, 0.58],
  [1500, 0.8, 0.8, 0.82],
];

/** Grey-green on gentle ground (linear RGB): grass, the meadow, the forest floor. */
const GRASS: readonly [number, number, number] = [0.34, 0.42, 0.3];
const MEADOW: readonly [number, number, number] = [0.37, 0.47, 0.29];
const FOREST_FLOOR: readonly [number, number, number] = [0.23, 0.3, 0.22];

/**
 * The terrain as a grey mesh: `res` cells along the longer side of `bounds`
 * (default WORLD), square cells, vertex colours by height with cliffs
 * darkened so the shapes read without any art. Indexed, with normals.
 */
export function buildTerrainGeometry(
  res: number = TERRAIN_RES,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } = WORLD,
): THREE.BufferGeometry {
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;
  const cell = Math.max(w, d) / Math.max(2, Math.floor(res));
  const nx = Math.max(2, Math.round(w / cell));
  const nz = Math.max(2, Math.round(d / cell));
  const sx = w / nx;
  const sz = d / nz;
  const vx = nx + 1;
  const vz = nz + 1;
  const hts = new Float32Array(vx * vz);
  for (let j = 0; j < vz; j++) {
    const z = bounds.minZ + j * sz;
    for (let i = 0; i < vx; i++) hts[j * vx + i] = terrainHeight(bounds.minX + i * sx, z);
  }
  const pos = new Float32Array(vx * vz * 3);
  const nor = new Float32Array(vx * vz * 3);
  const col = new Float32Array(vx * vz * 3);
  for (let j = 0; j < vz; j++) {
    for (let i = 0; i < vx; i++) {
      const k = j * vx + i;
      const y = hts[k];
      pos[k * 3] = bounds.minX + i * sx;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = bounds.minZ + j * sz;
      const hl = hts[j * vx + Math.max(0, i - 1)];
      const hr = hts[j * vx + Math.min(vx - 1, i + 1)];
      const hd = hts[Math.max(0, j - 1) * vx + i];
      const hu = hts[Math.min(vz - 1, j + 1) * vx + i];
      const gx = (hr - hl) / (2 * sx);
      const gz = (hu - hd) / (2 * sz);
      const inv = 1 / Math.hypot(gx, 1, gz);
      nor[k * 3] = -gx * inv;
      nor[k * 3 + 1] = inv;
      nor[k * 3 + 2] = -gz * inv;
      let t = 0;
      while (t < TINT.length - 2 && y > TINT[t + 1][0]) t++;
      const a = TINT[t];
      const b = TINT[t + 1];
      const f = clamp01((y - a[0]) / (b[0] - a[0]));
      // Steep ground darkens: slope 1 (45 deg) at 0.82, cliffs at ~0.62.
      const slope = Math.hypot(gx, gz);
      const shade = 1 - 0.38 * smooth(0.5, 2.5, slope);
      let r = a[1] + (b[1] - a[1]) * f;
      let g = a[2] + (b[2] - a[2]) * f;
      let bl = a[3] + (b[3] - a[3]) * f;
      // Gentle ground below the high rock goes grey-green: greener on the
      // meadow, dark under the forest. Rock and beach stay grey.
      const gentle = (1 - smooth(0.22, 0.65, slope)) * smooth(4, 20, y) * (1 - smooth(950, 1200, y));
      if (gentle > 0) {
        const x = pos[k * 3];
        const z = pos[k * 3 + 2];
        const M = WORLD.meadow;
        const F = WORLD.forest;
        const inM = 1 - smooth(M.r * 0.7, M.r * 1.05, Math.hypot(x - M.x, z - M.z));
        const inF = 1 - smooth(F.r * 0.85, F.r * 1.1, Math.hypot(x - F.x, z - F.z));
        let tr = GRASS[0] + (MEADOW[0] - GRASS[0]) * inM;
        let tg = GRASS[1] + (MEADOW[1] - GRASS[1]) * inM;
        let tb = GRASS[2] + (MEADOW[2] - GRASS[2]) * inM;
        tr += (FOREST_FLOOR[0] - tr) * inF;
        tg += (FOREST_FLOOR[1] - tg) * inF;
        tb += (FOREST_FLOOR[2] - tb) * inF;
        const w = gentle * (0.55 + 0.4 * Math.max(inM, inF));
        r += (tr - r) * w;
        g += (tg - g) * w;
        bl += (tb - bl) * w;
      }
      col[k * 3] = r * shade;
      col[k * 3 + 1] = g * shade;
      col[k * 3 + 2] = bl * shade;
    }
  }
  const idx = new Uint32Array(nx * nz * 6);
  let o = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * vx + i;
      const b = a + 1;
      const c = a + vx;
      const e = c + 1;
      // Counter-clockwise seen from above (+y), so the top faces are front faces.
      idx[o++] = a;
      idx[o++] = c;
      idx[o++] = b;
      idx[o++] = b;
      idx[o++] = c;
      idx[o++] = e;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
