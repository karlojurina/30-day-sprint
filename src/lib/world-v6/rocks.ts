import * as THREE from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";
import {
  BROOK,
  DESIGN_FOV,
  GATE,
  GATE_CAUSEWAY,
  GORGE,
  ISLAND_DEPTH,
  ISLAND_PATH,
  LOOK,
  OBSERVATORY,
  PATH,
  PLACES,
  STREAM,
  TRAIL,
  TRAIL_HUT,
  WORLD,
} from "./layout";
import { addFootprint } from "./footprints";
import { NO_REFLECT_LAYER } from "./light";
import { gateIsleTop } from "./dress-gate";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { terrainHeight } from "./terrain";

/**
 * v6 rocks (world_art_bible_v6.md 2.2, brief 4.6).
 *
 * Every rock is a convex hull (three's ConvexHull, no new dependency) with
 * big irregular planes, and the light is painted per face at build time from
 * the owning place's fixed sun (PAL below): faces turned up take the warm top,
 * faces toward the sun a lit ochre, faces away the key's near shade in the
 * sky's colour (blue by day, violet at sunset), never black; the bottom third
 * of each rock darkens to 0.7. The material is still Lambert, so the live sun
 * adds on top of the paint and the rocks follow the grade, the fog and dusk;
 * a small emissive floor (the paint times uRockFloor) keeps shade faces off
 * black in the gorge whatever the fill does.
 *
 * The kit (bible 2.2), 5 or 6 seeded variants of each, built once and reused
 * with yaw, scale and lean:
 *   K1 medium rock    chunky, 2 to 3 big top planes, h/w 0.55 to 0.7
 *   K2 layered slab   3 or 4 stacked offset plates (strata ledges, the lip, the a4 rim)
 *   K3 big boulder    h/w 0.6 to 0.9, 1 or 2 painted V cracks
 *   K4 slanted group  3 to 6 shards leaning on the place's strata angle
 *   K5 small slanted  one shard
 *   K6 pebble         squashed hull
 *   K7 cliff module   NOT BUILT: wall-hung sheets were rendered twice (full
 *                     height hexagonal sheets read as pillows; thin strata
 *                     ledges read as planks nailed to the wall), so the big
 *                     walls carry no modules: the north wall's bands are lined
 *                     with families on their benches, the gully with slanted
 *                     groups standing on its walls. The Sky Island's underside
 *                     keeps v5's sheets unchanged (the rise is locked).
 * Hero rocks: within 150 of an eye level camera (HERO_SPOTS) the K1 and K3
 * pieces use chamfered variants (every edge bevelled ~4 percent, the bevel
 * strip painted lighter: the drybrushed edge), 150 to 400 triangles.
 *
 * Placing: families of 1 large, 2 to 4 medium and some pebbles, sunk 20 to
 * 40 percent, leaning on the place's one strata angle (STRATA), each rock's
 * footprint registered (footprints.ts) so the ground shades under it and the
 * cover never grows through it. Merged per zone into one mesh each (south,
 * gorge, high, sky, gate): a stop draws 1 to 3 calls.
 *
 * Every triangle also carries `aKind` (0 top, 1 lit, 2 shade, 3 bevel edge)
 * so world-tests/v6-b2-rocks.mjs can measure the painted planes on a render.
 *
 * Exports the ground helpers other modules share (groundY, slopeAt, rnd,
 * trailDist(Fast), nearTrail, railDist, nearRail, isWater, stopRay,
 * rockAnchors, smooth, gridSlope).
 */

// ── Shared ground helpers (cover.ts, dress-shore.ts, dress-sky.ts use these) ──

/** Seeded 0..1, stable across reloads (blocks.ts's rnd, so its shapes can be followed). */
export function rnd(i: number, s = 0): number {
  const v = Math.sin(i * 127.1 + s * 311.7 + 17.3) * 43758.5453;
  return v - Math.floor(v);
}
export const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const DEG = Math.PI / 180;

/** The drawn terrain grid (scene.ts builds it from terrain.ts at TERRAIN_RES 320). */
const GW = WORLD.maxX - WORLD.minX;
const GD = WORLD.maxZ - WORLD.minZ;
const GCELL = Math.max(GW, GD) / 320;
const GNX = Math.max(2, Math.round(GW / GCELL));
const GNZ = Math.max(2, Math.round(GD / GCELL));
const GSX = GW / GNX;
const GSZ = GD / GNZ;
/** scene.ts FALLS_PATCH (v6): drawn 4x finer there, so the surface is close to terrainHeight itself. */
const FALLS_PATCH = { minX: -380, maxX: 880, minZ: 990, maxZ: 1870 };

/** The grid's vertex heights, filled on first use (each vertex computed once). */
const VH = new Float32Array((GNX + 1) * (GNZ + 1)).fill(NaN);
function vertexH(i: number, j: number): number {
  const ii = Math.min(GNX, Math.max(0, i));
  const jj = Math.min(GNZ, Math.max(0, j));
  const k = jj * (GNX + 1) + ii;
  let h = VH[k];
  if (h !== h) {
    h = terrainHeight(WORLD.minX + ii * GSX, WORLD.minZ + jj * GSZ);
    VH[k] = h;
  }
  return h;
}
/** Slope of the drawn grid at (x, z): the cell's mean gradient (cheap, cached; for cover and gentle ground). */
export function gridSlope(x: number, z: number): number {
  const i = Math.floor((x - WORLD.minX) / GSX);
  const j = Math.floor((z - WORLD.minZ) / GSZ);
  const a = vertexH(i, j);
  const b = vertexH(i + 1, j);
  const c = vertexH(i, j + 1);
  const d = vertexH(i + 1, j + 1);
  return Math.hypot((b - a + d - c) / (2 * GSX), (c - a + d - b) / (2 * GSZ));
}

/** Height of the DRAWN terrain at (x, z): the exact triangle of the grid mesh (diagonal b-c, as buildTerrainGeometry). */
export function groundY(x: number, z: number): number {
  if (x > FALLS_PATCH.minX + 30 && x < FALLS_PATCH.maxX - 30 && z > FALLS_PATCH.minZ + 30 && z < FALLS_PATCH.maxZ - 30) return terrainHeight(x, z);
  const fi = (x - WORLD.minX) / GSX;
  const fj = (z - WORLD.minZ) / GSZ;
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const u = fi - i;
  const v = fj - j;
  const h = vertexH;
  if (u + v <= 1) {
    const ha = h(i, j);
    return ha + (h(i + 1, j) - ha) * u + (h(i, j + 1) - ha) * v;
  }
  const he = h(i + 1, j + 1);
  return he + (h(i, j + 1) - he) * (1 - u) + (h(i + 1, j) - he) * (1 - v);
}

/** Slope (rise over run) of the terrain at (x, z). */
export function slopeAt(x: number, z: number, e = 6): number {
  return Math.hypot(terrainHeight(x + e, z) - terrainHeight(x - e, z), terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
}

/** Horizontal distance from (x, z) to the walking trail (PATH), underground stretches left out. */
export function trailDist(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i];
    const b = PATH[i + 1];
    if (a.under) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const u = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    // Fix 3 (load time): squared compare, one sqrt at the end (was a hypot per segment).
    const ex = x - a.x - dx * u;
    const ez = z - a.z - dz * u;
    const d2 = ex * ex + ez * ez;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}
/** trailDist, memoised on a 12-unit grid (error under 9); exact when the coarse value is under 40. */
const TD_CELL = 12;
const tdCache = new Map<number, number>();
export function trailDistFast(x: number, z: number): number {
  const i = Math.round(x / TD_CELL);
  const j = Math.round(z / TD_CELL);
  const key = (i + 4000) * 10000 + (j + 4000);
  let c = tdCache.get(key);
  if (c === undefined) {
    c = trailDist(i * TD_CELL, j * TD_CELL);
    tdCache.set(key, c);
  }
  return c > 40 ? c : trailDist(x, z);
}
export const nearTrail = (x: number, z: number, r: number) => trailDistFast(x, z) < r;

/** 3D distance from a point to the camera's route (the TRAIL keys as straight segments). */
export function railDist(x: number, y: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < TRAIL.length - 1; i++) {
    const a = TRAIL[i];
    const b = TRAIL[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const u = Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / (dx * dx + dy * dy + dz * dz || 1)));
    const ex = x - a[0] - dx * u;
    const ey = y - a[1] - dy * u;
    const ez = z - a[2] - dz * u;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}
export const nearRail = (x: number, y: number, z: number, r: number) => railDist(x, y, z) < r;

/** Water covers (x, z): the sea below 0, the Mirror Lake, the plunge pool. */
export function isWater(x: number, z: number, g = groundY(x, z)): boolean {
  if (g < WORLD.seaLevel - 0.5) return true;
  const L = WORLD.lake;
  if (Math.hypot(x - L.x, z - L.z) < L.r && g < L.y) return true;
  const P = WORLD.pool;
  if (Math.hypot(x - P.x, z - P.z) < P.r && g < P.y) return true;
  return false;
}

/**
 * Where a ray from a stop's camera (screen point ndcX, ndcY at the design lens
 * and `aspect`) first meets the ground or the water. Null if it leaves the map.
 */
export function stopRay(trailIndex: number, ndcX: number, ndcY: number, aspect = 1.6): { x: number; y: number; z: number; water: boolean; dist: number } | null {
  const cam = new THREE.PerspectiveCamera(DESIGN_FOV, aspect, 1, 20000);
  const p = TRAIL[trailIndex];
  const l = LOOK[trailIndex];
  cam.position.set(p[0], p[1], p[2]);
  cam.lookAt(l[0], l[1], l[2]);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(cam).sub(cam.position).normalize();
  for (let t = 20; t < 6000; t += 4) {
    const x = p[0] + dir.x * t;
    const y = p[1] + dir.y * t;
    const z = p[2] + dir.z * t;
    const g = groundY(x, z);
    const L = WORLD.lake;
    const inLake = Math.hypot(x - L.x, z - L.z) < L.r && g < L.y;
    const wy = g < WORLD.seaLevel ? WORLD.seaLevel : inLake ? L.y : -Infinity;
    if (y < Math.max(g, wy)) return { x, y: Math.max(g, wy), z, water: wy > g, dist: t };
  }
  return null;
}

// ── Palettes: each place's fixed sun and its painted colours ─────────────────

/**
 * Per light key (bible 1.0 and 2.6): the sun's compass azimuth and elevation,
 * and the painted albedos (display sRGB): `top` for faces turned up, `lit`
 * for faces toward the sun, `shade` for faces away (the key's near shade in
 * the sky's hue). Saturation stays at 0.35 or under (decision 19); the colour
 * lives in the light and the grade. `floor` is the emissive floor (the paint
 * times this) that keeps shade faces off black.
 */
interface PalDef {
  az: number;
  el: number;
  top: number;
  lit: number;
  shade: number;
  floor: number;
}
const PAL_DEFS: Record<string, PalDef> = {
  // Opening, a1: from the left, side lit.
  gold: { az: 250, el: 16, top: 0xc4ae8c, lit: 0xb09070, shade: 0x5a667c, floor: 0.08 },
  // a2 and the valley: clear afternoon.
  day: { az: 245, el: 14, top: 0xc8b898, lit: 0xb49c7e, shade: 0x627088, floor: 0.16 },
  // The stream, the lip, the ride, the pool, the falls wall.
  late: { az: 285, el: 11, top: 0xc8ae8c, lit: 0xb89878, shade: 0x5c6274, floor: 0.16 },
  // The crossing, the hike, a4, the traverse: side lit from the right.
  gorge: { az: 300, el: 6, top: 0xc8a482, lit: 0xbc9676, shade: 0x564e5c, floor: 0.18 },
  // The gully and the burst.
  cliff: { az: 228, el: 5, top: 0xc0a080, lit: 0xb49474, shade: 0x5a546c, floor: 0.2 },
  // The saddle, the meadow, the Mirror Lake.
  sunset: { az: 262, el: 1.6, top: 0xbca08a, lit: 0xb09482, shade: 0x5e566e, floor: 0.16 },
  // The Sky Island by moonlight (the moon right of the a7 view).
  night: { az: 333, el: 25, top: 0x9ca2b0, lit: 0x8e96a8, shade: 0x565c74, floor: 0.12 },
  // Final pass: the stones on the Sky Island's top, the terrace's warm stone by
  // moonlight (the night greys read as small dark wedges on a grey field).
  isleTop: { az: 333, el: 25, top: 0xd2c6a6, lit: 0xbcae8e, shade: 0x625e70, floor: 0.12 },
  // The Gate isle at sunrise (backlit on purpose).
  sunrise: { az: 322, el: 4, top: 0xbcaa94, lit: 0xb49e8a, shade: 0x565270, floor: 0.14 },
};
interface Pal {
  sun: THREE.Vector3;
  top: THREE.Color;
  lit: THREE.Color;
  shade: THREE.Color;
  floor: number;
}
const lin = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const PAL: Record<string, Pal> = Object.fromEntries(
  Object.entries(PAL_DEFS).map(([k, d]) => {
    const az = d.az * DEG;
    const el = d.el * DEG;
    return [k, { sun: new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)), top: lin(d.top), lit: lin(d.lit), shade: lin(d.shade), floor: d.floor }];
  }),
);

/** Which place's light a rock at (x, y, z) sits in. */
function palAt(x: number, y: number, z: number): Pal {
  if (y > 1300) return z < -3200 ? PAL.sunrise : PAL.night;
  if (z > 3400) return PAL.gold;
  if (z > 2150) return PAL.day;
  if (x > 1330 && x < 1560 && z > 990 && z < 1240) return PAL.cliff;
  if (z > 1000 && x < 1800 && y < 640) return z > 1570 && x < 300 ? PAL.late : PAL.gorge;
  return PAL.sunset;
}

/** Each place's one strata angle: [compass direction the rocks lean toward, lean in degrees]. */
function strataAt(x: number, y: number, z: number): [number, number] {
  if (y > 1300) return [40, 6];
  if (z > 3400) return [250, 10];
  if (z > 2150) return [60, 8];
  if (z > 1570 && x < 300) return [0, 14]; // the stream's slabs lean toward the falls
  if (z > 1000 && y < 640) return [90, 18]; // the gorge strata, dipping east
  return [300, 12];
}

// ── The kit ──────────────────────────────────────────────────────────────────

/** A kit piece in local space: base on y 0, height h, about 1 half-width. */
interface Piece {
  /** 9 floats a triangle, wound counter-clockwise from outside. */
  tri: Float32Array;
  /** Per triangle: 0 face, 1 bevel edge (painted lighter), 2 crack (painted darker). */
  flag: Uint8Array;
  h: number;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The hull of `pts` as triangles (counter-clockwise from outside). */
function hullTris(pts: THREE.Vector3[]): number[] {
  const hull = new ConvexHull().setFromPoints(pts);
  const out: number[] = [];
  for (const f of hull.faces) {
    const loop: THREE.Vector3[] = [];
    let e = f.edge;
    do {
      loop.push(e.head().point);
      e = e.next;
    } while (e !== f.edge);
    for (let k = 1; k < loop.length - 1; k++) {
      const a = loop[0];
      const b = loop[k];
      const c = loop[k + 1];
      out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
  }
  return out;
}

/** Rescale a free piece: base at y 0, half-width 1, height `ratio` times its width. */
function normalise(tri: number[], ratio: number): number {
  let minY = Infinity;
  let maxY = -Infinity;
  let r = 0;
  for (let i = 0; i < tri.length; i += 3) {
    minY = Math.min(minY, tri[i + 1]);
    maxY = Math.max(maxY, tri[i + 1]);
    r = Math.max(r, Math.hypot(tri[i], tri[i + 2]));
  }
  const ky = (ratio * 2) / Math.max(1e-3, (maxY - minY) / r);
  for (let i = 0; i < tri.length; i += 3) {
    tri[i] /= r;
    tri[i + 2] /= r;
    tri[i + 1] = ((tri[i + 1] - minY) / r) * ky;
  }
  return ((maxY - minY) / r) * ky;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** K1 medium rock / K3 big boulder: a squashed ellipsoid's points, the top cut by 1 or 2 tilted planes (the big top planes). */
function boulderPts(rand: () => number, n: number, cuts: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const sz = 0.8 + rand() * 0.2;
  for (let i = 0; i < n; i++) {
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(1 - rand() * 1.15);
    const k = 0.84 + rand() * 0.3;
    pts.push(V(Math.sin(ph) * Math.cos(th) * k, Math.cos(ph) * k, Math.sin(ph) * Math.sin(th) * k * sz));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rand() * 0.8;
    pts.push(V(Math.cos(a) * 0.95, -0.3, Math.sin(a) * 0.95 * sz));
  }
  // The top planes: clamp every point under each plane (one or two ridged cuts).
  const planes: [number, number, number][] = [];
  for (let c = 0; c < cuts; c++) {
    const a = rand() * Math.PI * 2;
    const g = 0.25 + rand() * 0.35;
    planes.push([0.55 + rand() * 0.2, Math.cos(a) * g, Math.sin(a) * g]);
  }
  for (const p of pts) for (const [t, gx, gz] of planes) p.y = Math.min(p.y, t + gx * p.x + gz * p.z);
  return pts;
}

/** A thin zigzag crack on the biggest side face, inside that triangle, offset a hair along its normal. */
function addCrack(tri: number[], flag: number[], rand: () => number): void {
  let best = -1;
  let bestA = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (let t = 0; t < tri.length / 9; t++) {
    a.fromArray(tri, t * 9);
    b.fromArray(tri, t * 9 + 3);
    c.fromArray(tri, t * 9 + 6);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const area = n.length();
    n.normalize();
    if (n.y < -0.1 || n.y > 0.55) continue;
    const s = area * (0.8 + rand() * 0.4);
    if (s > bestA) {
      bestA = s;
      best = t;
    }
  }
  if (best < 0) return;
  a.fromArray(tri, best * 9);
  b.fromArray(tri, best * 9 + 3);
  c.fromArray(tri, best * 9 + 6);
  n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
  // From near the highest vertex down toward the opposite edge, 3 zigzag segments.
  const vs = [a.clone(), b.clone(), c.clone()].sort((p, q) => q.y - p.y);
  const top = vs[0];
  const opp = vs[1].clone().lerp(vs[2], 0.35 + rand() * 0.3);
  const cen = a.clone().add(b).add(c).multiplyScalar(1 / 3);
  const w = 0.028;
  const side = new THREE.Vector3().crossVectors(n, opp.clone().sub(top)).normalize();
  let prev = top.clone().lerp(cen, 0.3);
  for (let k = 1; k <= 3; k++) {
    const next = top.clone().lerp(opp, 0.2 + 0.22 * k).lerp(cen, 0.18).addScaledVector(side, (k % 2 ? 1 : -1) * 0.05 * (0.6 + rand()));
    const off = n.clone().multiplyScalar(0.012);
    const p0 = prev.clone().add(off).addScaledVector(side, -w);
    const p1 = prev.clone().add(off).addScaledVector(side, w);
    const q0 = next.clone().add(off).addScaledVector(side, -w * 0.6);
    const q1 = next.clone().add(off).addScaledVector(side, w * 0.6);
    // Wound so the normal matches the face's: (p1 - p0) x (q0 - p0) along n?
    const cr = new THREE.Vector3().crossVectors(p1.clone().sub(p0), q0.clone().sub(p0));
    if (cr.dot(n) >= 0) tri.push(...p0.toArray(), ...p1.toArray(), ...q0.toArray(), ...p1.toArray(), ...q1.toArray(), ...q0.toArray());
    else tri.push(...p0.toArray(), ...q0.toArray(), ...p1.toArray(), ...p1.toArray(), ...q0.toArray(), ...q1.toArray());
    flag.push(2, 2);
    prev = next;
  }
}

/**
 * Chamfer a convex piece: the hull of every face's corners pulled toward the
 * face's centre by `c` keeps each face's plane (smaller) and adds a bevel
 * strip along every edge and a facet at every corner. Triangles whose normal
 * matches none of the original faces are the bevel (flag 1).
 */
function chamfer(tri: number[], c: number): { tri: number[]; flag: number[] } {
  const pts: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let t = 0; t < tri.length / 9; t++) {
    a.fromArray(tri, t * 9);
    b.fromArray(tri, t * 9 + 3);
    d.fromArray(tri, t * 9 + 6);
    const cen = a.clone().add(b).add(d).multiplyScalar(1 / 3);
    for (const p of [a, b, d]) pts.push(p.clone().lerp(cen, c));
    normals.push(new THREE.Vector3().crossVectors(b.clone().sub(a), d.clone().sub(a)).normalize());
  }
  const out = hullTris(pts);
  const flag: number[] = [];
  const n = new THREE.Vector3();
  for (let t = 0; t < out.length / 9; t++) {
    a.fromArray(out, t * 9);
    b.fromArray(out, t * 9 + 3);
    d.fromArray(out, t * 9 + 6);
    n.crossVectors(b.clone().sub(a), d.clone().sub(a)).normalize();
    let m = -1;
    for (const q of normals) m = Math.max(m, q.dot(n));
    flag.push(m > 0.999 ? 0 : 1);
  }
  return { tri: out, flag };
}

function piece(tri: number[], flag: number[] | null, h: number): Piece {
  return { tri: new Float32Array(tri), flag: new Uint8Array(flag ?? new Array(tri.length / 9).fill(0)), h };
}

interface Kit {
  K1: Piece[];
  K1h: Piece[];
  K2: Piece[];
  K3: Piece[];
  K3h: Piece[];
  K4: Piece[];
  K5: Piece[];
  K6: Piece[];
}

let KIT: Kit | null = null;
function kit(): Kit {
  if (KIT) return KIT;
  const rand = mulberry(90210);
  const K1: Piece[] = [];
  const K1h: Piece[] = [];
  const K3: Piece[] = [];
  const K3h: Piece[] = [];
  for (let v = 0; v < 6; v++) {
    const t1 = hullTris(boulderPts(rand, 15, rand() < 0.5 ? 2 : 1));
    const h1 = normalise(t1, 0.55 + rand() * 0.15);
    K1.push(piece(t1, null, h1));
    const c1 = chamfer(t1, 0.07);
    K1h.push(piece(c1.tri, c1.flag, h1));
    const t3 = hullTris(boulderPts(rand, 19, 1));
    const h3 = normalise(t3, 0.62 + rand() * 0.24);
    const f3 = new Array(t3.length / 9).fill(0);
    K3.push(piece(t3, f3, h3));
    const c3 = chamfer(t3, 0.06);
    const nc = rand() < 0.5 ? 1 : 2;
    for (let k = 0; k < nc; k++) addCrack(c3.tri, c3.flag, rand);
    K3h.push(piece(c3.tri, c3.flag, h3));
  }
  // K2: 3 or 4 plates, each a hull of two 5-point rings, smaller and offset going up.
  const K2: Piece[] = [];
  for (let v = 0; v < 5; v++) {
    const all: number[] = [];
    const np = 3 + (rand() < 0.5 ? 1 : 0);
    let y = 0;
    let ox = 0;
    let oz = 0;
    for (let p = 0; p < np; p++) {
      const r = 1 - p * 0.2 + (rand() - 0.5) * 0.1;
      const th = 0.14 + rand() * 0.07;
      const rot = rand() * 6.28;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 5; i++) {
        const a = rot + ((i + (rand() - 0.5) * 0.5) / 5) * Math.PI * 2;
        const rr = r * (0.8 + rand() * 0.35);
        pts.push(V(ox + Math.cos(a) * rr, y, oz + Math.sin(a) * rr * 0.75));
        pts.push(V(ox + Math.cos(a) * rr * 0.9, y + th * (0.8 + rand() * 0.4), oz + Math.sin(a) * rr * 0.68));
      }
      all.push(...hullTris(pts));
      y += th * 0.85;
      ox += (rand() - 0.5) * 0.4;
      oz += (rand() - 0.5) * 0.3;
    }
    K2.push(piece(all, null, y + 0.1));
  }
  // K5 / K4: shards leaning toward +x (their strata), K4 a group of 3 to 6.
  const shard = (cx: number, cz: number, rb: number, hs: number, lean: number): number[] => {
    const pts: THREE.Vector3[] = [];
    const rot = rand() * 6.28;
    for (let i = 0; i < 5; i++) {
      const a = rot + ((i + (rand() - 0.5) * 0.4) / 5) * Math.PI * 2;
      pts.push(V(cx + Math.cos(a) * rb * (0.8 + rand() * 0.4), 0, cz + Math.sin(a) * rb * (0.6 + rand() * 0.3)));
    }
    pts.push(V(cx + rb * 0.2, hs * (0.55 + rand() * 0.15), cz + rb * (rand() - 0.5) * 0.6));
    pts.push(V(cx + (rand() - 0.5) * rb * 0.3, hs, cz + (rand() - 0.5) * rb * 0.2));
    pts.push(V(cx - rb * 0.3, hs * (0.75 + rand() * 0.15), cz + rb * (rand() - 0.5) * 0.4));
    // Lean: shear toward +x by height.
    for (const p of pts) p.x += p.y * Math.tan(lean);
    return hullTris(pts);
  };
  const K5: Piece[] = [];
  for (let v = 0; v < 5; v++) {
    const hs = 1.5 + rand() * 0.5;
    K5.push(piece(shard(0, 0, 1, hs, (22 + rand() * 12) * DEG), null, hs));
  }
  const K4: Piece[] = [];
  for (let v = 0; v < 5; v++) {
    const n = 3 + Math.floor(rand() * 4);
    const lean = (24 + rand() * 12) * DEG;
    const all: number[] = [];
    let hmax = 0;
    for (let i = 0; i < n; i++) {
      const k = i / Math.max(1, n - 1);
      const rb = 0.5 - 0.22 * k + rand() * 0.08;
      const hs = (1.7 - 0.9 * k) * (0.85 + rand() * 0.3);
      hmax = Math.max(hmax, hs);
      all.push(...shard(-0.5 + k * 1.1 + (rand() - 0.5) * 0.15, (rand() - 0.5) * 0.6, rb, hs, lean));
    }
    K4.push(piece(all, null, hmax));
  }
  const K6: Piece[] = [];
  for (let v = 0; v < 6; v++) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(1 - rand() * 2);
      pts.push(V(Math.sin(ph) * Math.cos(th), Math.cos(ph) * 0.5, Math.sin(ph) * Math.sin(th) * 0.8));
    }
    const t = hullTris(pts);
    K6.push(piece(t, null, normalise(t, 0.3 + rand() * 0.12)));
  }
  KIT = { K1, K1h, K2, K3, K3h, K4, K5, K6 };
  return KIT;
}

// ── The soup: painted faces straight into one merged buffer per zone ────────

class Soup {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  kind: number[] = [];
  tris = 0;
  /**
   * The running count that seeds each face's value jitter in put(): every
   * triangle put or laid flat counts, as `tris` does. place() may pin it where
   * a place's rocks start, so rocks taken out before them deal none of their
   * faces again (2026-10-15).
   */
  seq = 0;
  rocks = 0;
  heroes = 0;
  /** Final pass B: skip ground rocks on faces steeper than 0.8 (the gorge's walls, where they hung mid air). */
  wallGuard = false;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();
  private n = new THREE.Vector3();
  private e1 = new THREE.Vector3();
  private e2 = new THREE.Vector3();
  private col3 = new THREE.Color();
  /**
   * A piece transformed by `m`, each face painted from `pal` by its world
   * normal: shade to lit by the sun's side, then toward the warm top by how
   * much it faces up; the bottom third darker (local y from 0 to h); bevels
   * lighter, cracks darker. `v` is the rock's value jitter.
   */
  put(p: Piece, m: THREE.Matrix4, pal: Pal, v: number, hard = false): void {
    const t = p.tri;
    const nt = t.length / 9;
    for (let i = 0; i < nt; i++) {
      const o = i * 9;
      this.a.set(t[o], t[o + 1], t[o + 2]).applyMatrix4(m);
      this.b.set(t[o + 3], t[o + 4], t[o + 5]).applyMatrix4(m);
      this.c.set(t[o + 6], t[o + 7], t[o + 8]).applyMatrix4(m);
      this.n.crossVectors(this.e1.subVectors(this.b, this.a), this.e2.subVectors(this.c, this.a));
      if (this.n.lengthSq() < 1e-12) continue;
      this.n.normalize();
      const sd = this.n.dot(pal.sun);
      // `hard`: three flat values (top, lit, shade) with no blend between facets, so a
      // boulder near the lens reads as lit planes against a blue shade side.
      const up = hard ? (this.n.y > 0.62 ? 1 : 0) : smooth(0.5, 0.9, this.n.y);
      const lit = hard ? (sd > 0.02 ? 1 : 0) : smooth(-0.2, 0.5, sd);
      this.col3.copy(pal.shade).lerp(pal.lit, lit).lerp(pal.top, up * 0.85);
      const lc = (t[o + 1] + t[o + 4] + t[o + 7]) / 3 / Math.max(1e-3, p.h);
      let k = v * (0.7 + 0.3 * smooth(0.02, 0.36, lc)) * (0.96 + 0.08 * rnd(i, this.seq));
      const f = p.flag[i];
      if (f === 1) k *= 1.22;
      else if (f === 2) k *= 0.55;
      const kd = f === 1 ? 3 : up > 0.5 ? 0 : sd > 0.1 ? 1 : 2;
      const r = Math.min(1, this.col3.r * k);
      const g = Math.min(1, this.col3.g * k);
      const bl = Math.min(1, this.col3.b * k);
      // `hard`: a top (and a top's bevel) takes a normal bent toward the sun, so
      // under a low sun it lights like the sun side (the light painted per face,
      // bible 2.2), not at the sin(elevation) a flat top gets.
      if (hard && (up > 0.5 || (f === 1 && this.n.y > 0.3))) this.n.addScaledVector(pal.sun, 1.3).normalize();
      for (const q of [this.a, this.b, this.c]) {
        this.pos.push(q.x, q.y, q.z);
        this.nor.push(this.n.x, this.n.y, this.n.z);
        this.col.push(r, g, bl);
        this.kind.push(kd);
      }
      this.tris++;
      this.seq++;
    }
  }
  /** v5's sheet painting (the Sky Island's underside, as it was: the rise is locked). */
  flat(faces: number[][][], m: THREE.Matrix4, h: number, base: THREE.Color, v: number): void {
    for (const f of faces) {
      for (let k = 1; k < f.length - 1; k++) {
        this.a.fromArray(f[0]).applyMatrix4(m);
        this.b.fromArray(f[k]).applyMatrix4(m);
        this.c.fromArray(f[k + 1]).applyMatrix4(m);
        this.n.crossVectors(this.e1.subVectors(this.b, this.a), this.e2.subVectors(this.c, this.a)).normalize();
        for (const [q, l] of [
          [this.a, f[0]],
          [this.b, f[k]],
          [this.c, f[k + 1]],
        ] as const) {
          const ao = (0.62 + 0.38 * smooth(0, 0.85, l[1] / Math.max(1e-3, h))) * v;
          this.pos.push(q.x, q.y, q.z);
          this.nor.push(this.n.x, this.n.y, this.n.z);
          this.col.push(base.r * ao, base.g * ao, base.b * ao);
          this.kind.push(2);
        }
        this.tris++;
        this.seq++;
      }
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("aKind", new THREE.Float32BufferAttribute(this.kind, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ── Placing ──────────────────────────────────────────────────────────────────

/** Nothing comes within this of the camera's route (plus the rock's own size). */
const RAIL_CLEAR = 30;
/**
 * Where the camera passes at eye level (bible 2.2 hero rocks), as points in
 * the world: [x, y, z] of the camera there. They are copies of the route's
 * keys (layout KEYS) and on purpose not read from it by number: the rocks
 * belong to these places, and a key added or removed anywhere else on the
 * route must not hand the hero rocks to whichever key takes the old number
 * (2026-10-13: the a3 to a4 reroute nearly did). world-tests/v6-route.mjs
 * fails if a spot no longer lies on the route, which is when to move it.
 */
export const HERO_SPOTS: ReadonlyArray<readonly [number, number, number]> = [
  [1692, 30, 5030], // the opening
  [1420, 28, 4700], // the glide in over the bay
  [1369, 21, 4437], // a1, the Landing
  [-85, 452, 1990], // down the stream
  [-100, 440, 1862],
  [-102, 422, 1792], // the lip
  [270, 231, 1349], // the climb to the north wall, past the ledge's west end
  [321, 251, 1346],
  [374, 271, 1340],
  [430, 290, 1330],
  [1080, 470, 1196], // the traverse east of the ledge
  [1436, 668, 1092], // the gully
  [1436.09, 668, 1041.5625], // the gully's top
];
const HERO_R = 150;
function heroAt(x: number, y: number, z: number): boolean {
  for (const p of HERO_SPOTS) {
    if (Math.hypot(p[0] - x, p[1] - y, p[2] - z) < HERO_R) return true;
  }
  return false;
}

export interface RockAnchor {
  x: number;
  z: number;
  /** Radius of the group's footprint. */
  r: number;
}
/** Every rock family placed, for cover.ts (tall grass and a shrub round the anchors). */
export const rockAnchors: RockAnchor[] = [];

/**
 * cover.ts plants a ring of grass round every rock that has a footprint and
 * seeds each ring with the rock's number. A rock's number is its count within
 * its own place, from that place's fixed start, so a rock added or removed in
 * one place never renumbers the rings of another. Until 2026-10-13 the number
 * was the rock's index in the whole footprint list; the starts below are what
 * that index was at each place then, so pinning it moved no blade of grass. A
 * place that grows past the next one's start only gives two rings far apart
 * the same number, which nobody can see.
 */
const RING_START = {
  opening: 0,
  landing: 3,
  valley: 20,
  stream: 129,
  northWall: 201,
  gully: 243,
  pool: 267,
  hike: 359,
  saddle: 416,
  lake: 584,
  island: 642,
  gate: 684,
} as const;
export type RockPlace = keyof typeof RING_START;
/** One entry per rock footprint this module registered, in the same order (cover.ts lines the two lists up by that). */
export const rockRings: Array<{ place: RockPlace; n: number }> = [];
let ringPlace: RockPlace = "opening";
let ringNo = 0;
/** The rocks placed from here on belong to `place`. */
function ringsFrom(place: RockPlace): void {
  ringPlace = place;
  ringNo = RING_START[place];
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const S3 = new THREE.Vector3();
const T3 = new THREE.Vector3();

type KitKey = "K1" | "K2" | "K3" | "K4" | "K5" | "K6";
interface RockOpts {
  /** Compass direction the rock leans toward, and the lean in degrees. */
  dir: number;
  lean: number;
  /** Share of the height sunk under the lowest ground (0.2 to 0.4). */
  sink?: number;
  /** Cap the top at this world y (scales the height down). */
  maxTop?: number;
  /** Base on this y instead of the ground (water rocks, islands). */
  baseY?: number;
  hero?: boolean;
  /** Register a footprint (default true for anything over 3 across). */
  foot?: boolean;
  /** Stretch the height by this (the lip's teeth). */
  tall?: number;
  /** Paint in three flat values, no blend (Soup.put). */
  hard?: boolean;
}
/** One rock: piece `key` (a seeded variant), half-width `hw`, standing on the lowest ground under it. Returns its top y, or NaN. */
function rock(soup: Soup, key: KitKey, x: number, z: number, hw: number, pal: Pal, rand: () => number, o: RockOpts): number {
  const K = kit();
  const hero = !!o.hero && (key === "K1" || key === "K3");
  const list = hero ? (key === "K1" ? K.K1h : K.K3h) : K[key];
  const p = list[Math.floor(rand() * list.length) % list.length];
  let g = o.baseY ?? Infinity;
  let gHi = -Infinity;
  if (o.baseY === undefined) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const rr = k === 4 ? 0 : hw * 0.7;
      const gy = groundY(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
      g = Math.min(g, gy);
      gHi = Math.max(gHi, gy);
    }
  }
  if (!isFinite(g)) return NaN;
  // Final pass B (judge: boulders hung on the falls wall at a3): a rock whose
  // ground rises more than 0.8 across it is on a wall face, not a bench. Only
  // round the falls and the pool (z > 1450): the gully's stair and its wall
  // groups stand on steep ground on purpose.
  if (soup.wallGuard && o.baseY === undefined && z > 1450 && (gHi - g) / Math.max(1.4 * hw, 1) > 0.8) return NaN;
  const sink = o.sink ?? 0.2 + rand() * 0.2;
  let sy = hw * (0.9 + rand() * 0.2) * (o.tall ?? 1);
  if (o.maxTop !== undefined) {
    const room = (o.maxTop - g) / Math.max(0.1, 1 - sink);
    sy = Math.min(sy, Math.max(hw * 0.35, room / p.h));
  }
  const hWorld = p.h * sy;
  // Lean on the strata: yaw so local +x (K4/K5's lean) and the tilt point along `dir`, a little jitter.
  const yaw = -(o.dir - 90) * DEG + (rand() - 0.5) * 0.5;
  const tilt = o.lean * DEG * (key === "K4" || key === "K5" ? 0.25 : 0.6);
  E.set(0, yaw, -tilt, "YXZ");
  Q.setFromEuler(E);
  S3.set(hw * (0.9 + rand() * 0.2), sy, hw * (0.85 + rand() * 0.25));
  T3.set(x, g - hWorld * sink, z);
  M.compose(T3, Q, S3);
  soup.put(p, M, pal, 0.94 + rand() * 0.12, o.hard);
  soup.rocks++;
  if (hero) soup.heroes++;
  if (o.foot ?? hw > 1.5) {
    addFootprint({ x, z, r: hw * 1.05, kind: "rock" });
    rockRings.push({ place: ringPlace, n: ringNo++ });
  }
  return g - hWorld * sink + hWorld;
}

interface FamilyOpts {
  lead?: KitKey;
  mediums?: number;
  pebbles?: number;
  /** Clearance from the rail to the family's reach (default RAIL_CLEAR). */
  clear?: number;
  maxTop?: number;
  baseY?: number;
  hero?: boolean;
  pal?: Pal;
  strata?: [number, number];
}
/** A family (bible 2.2): 1 large, 2 to 4 medium, some pebbles, all on one strata. `size` is the lead's half-width. Returns false if it was skipped. */
/** dress-gorge.ts's own hash (no offset), so the gully's stones land on its step positions. */
function rndDG(i: number, s = 0): number {
  const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * One step of a rock stair (the gully, fix round 2): a chamfered hull stone
 * on a `w` by `d` footprint turned `yaw`, seated on the downhill ground and
 * standing 2 to 3.5 proud of the ground at its centre, in three flat values
 * (the `hard` mode: lit top about 1.8x the shade side); a wide step
 * gets a small second stone beside it. No footprint: the stones are the path.
 */
export function addStepStones(soup: Soup, x: number, z: number, w: number, d: number, yaw: number, seed = 1): void {
  const rand = mulberry(seed);
  const pal = PAL.cliff;
  const put = (sx: number, sz: number, hw: number) => {
    const g = terrainHeight(sx, sz);
    if (!isFinite(g) || nearRail(sx, g + 2, sz, 10)) return;
    // The lowest ground under it (the floor climbs north), so no edge floats.
    let lo = g;
    for (let k = 0; k < 4; k++) lo = Math.min(lo, terrainHeight(sx + Math.cos(k * 1.571) * hw, sz + Math.sin(k * 1.571) * hw));
    // Final pass: taller risers (3 to 5 proud), so a flight of rock steps reads, not pavers.
    rock(soup, rand() < 0.6 ? "K3" : "K1", sx, sz, hw, pal, rand, { dir: 90 - yaw / DEG, lean: 6, baseY: lo - 0.2, sink: 0.2, maxTop: g + 3 + rand() * 2, tall: 1.9, hero: true, hard: true, foot: false });
  };
  const hw = (w + d) / 4;
  put(x, z, hw);
  if (w > 8) put(x + Math.cos(yaw) * (hw + 1.6), z - Math.sin(yaw) * (hw + 1.6), hw * 0.45);
}

function family(soup: Soup, x: number, z: number, size: number, seed: number, o: FamilyOpts = {}): boolean {
  const rand = mulberry(seed * 7919 + 17);
  const g = o.baseY ?? groundY(x, z);
  if (!isFinite(g)) return false;
  if (nearRail(x, g + size * 0.6, z, (o.clear ?? RAIL_CLEAR) + size * 1.2)) return false;
  if (nearTrail(x, z, size * 0.9 + 4)) return false;
  const pal = o.pal ?? palAt(x, g, z);
  const [dir, lean] = o.strata ?? strataAt(x, g, z);
  const hero = o.hero ?? heroAt(x, g, z);
  const lead = o.lead ?? (rand() < 0.45 ? "K3" : "K1");
  rock(soup, lead, x, z, size, pal, rand, { dir, lean, hero, maxTop: o.maxTop, baseY: o.baseY });
  const nm = o.mediums ?? 2 + Math.floor(rand() * 3);
  for (let i = 0; i < nm; i++) {
    const a = rand() * Math.PI * 2;
    const d = size * (0.95 + rand() * 0.55);
    const hw = size * (0.3 + rand() * 0.28);
    const mx = x + Math.cos(a) * d;
    const mz = z + Math.sin(a) * d;
    if (nearTrail(mx, mz, hw + 4)) continue;
    rock(soup, rand() < 0.62 ? "K1" : "K5", mx, mz, hw, pal, rand, { dir, lean, hero: hero && hw > 7, baseY: o.baseY !== undefined ? o.baseY + (rand() - 0.5) * 2 : undefined });
  }
  const np = o.pebbles ?? 3 + Math.floor(rand() * 4);
  for (let i = 0; i < np; i++) {
    const a = rand() * Math.PI * 2;
    const d = size * (1 + rand() * 1.3);
    rock(soup, "K6", x + Math.cos(a) * d, z + Math.sin(a) * d, Math.max(0.8, size * (0.07 + rand() * 0.1)), pal, rand, { dir, lean, sink: 0.3, foot: false, baseY: o.baseY });
  }
  rockAnchors.push({ x, z, r: size * 2.2 });
  return true;
}

/** GORGE's centreline z, floor y and half width at x (linear between its points). */
function gorgeAt(x: number): { z: number; y: number; hw: number } {
  const G = GORGE;
  if (x <= G[0][0]) return { z: G[0][1], y: G[0][2], hw: G[0][3] };
  for (let i = 0; i < G.length - 1; i++) {
    const a = G[i];
    const b = G[i + 1];
    if (x <= b[0]) {
      const f = (x - a[0]) / (b[0] - a[0]);
      return { z: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f, hw: a[3] + (b[3] - a[3]) * f };
    }
  }
  const l = G[G.length - 1];
  return { z: l[1], y: l[2], hw: l[3] };
}

interface Built {
  soups: Record<"south" | "gorge" | "high" | "sky" | "gate", Soup>;
  families: number;
  modules: number;
}

function place(): Built {
  const soups = { south: new Soup(), gorge: new Soup(), high: new Soup(), sky: new Soup(), gate: new Soup() };
  soups.gorge.wallGuard = true;
  let families = 0;
  let modules = 0;
  rockAnchors.length = 0;
  rockRings.length = 0;
  const F = (soup: Soup, x: number, z: number, size: number, seed: number, o?: FamilyOpts) => {
    if (family(soup, x, z, size, seed, o)) families++;
  };
  const stop = (id: string) => PLACES.find((p) => p.id === id)!;

  // The opening (bible 1.1) has no rocks: the islet's three boulders and the
  // 9 rocks round its rim went with the islet on 2026-10-15 (Lovro's Loom:
  // "this boulder which is kind of annoying ... let's remove that"). They were
  // the south soup's first 104 triangles; the Landing starts its value jitter
  // count there still, so its faces and the valley's keep their colours.
  ringsFrom("landing");
  soups.south.seq = 104;
  // ── a1, the Landing (bible 1.2): the tide line: pebbles and a few warm families, no black rocks ──
  {
    const a1 = stop("a1");
    // Framing families left of the a1 frame and beyond the dock on the right, on the beach.
    for (const [nx, ny, s, k] of [
      [-0.88, -0.62, 17, 1],
      [-0.62, -0.86, 12, 2],
      [0.97, -0.28, 15, 3],
    ] as const) {
      const hit = stopRay(a1.trail, nx, ny, 1691 / 1278);
      if (!hit) continue;
      let { x, z } = hit;
      if (hit.water) {
        // Walk on along the view to the shallows.
        const dx = x - TRAIL[a1.trail][0];
        const dz = z - TRAIL[a1.trail][2];
        const L = Math.hypot(dx, dz);
        for (let t = 0; t < 600 && groundY(x, z) < -3; t += 6) {
          x += (dx / L) * 6;
          z += (dz / L) * 6;
        }
      }
      if (Math.hypot(x - PATH[0].x, z - PATH[0].z) < 40) continue;
      F(soups.south, x, z, s, 100 + k, { mediums: 2, pebbles: 6 });
    }
    // The tide line either side of the dock: pebble scatters and a few mediums, at the water's edge.
    const rand = mulberry(1777);
    for (let k = 0; k < 22; k++) {
      const x = 950 + k * 36 + rand() * 20;
      let z = 4700;
      while (z > 3800 && groundY(x, z) < 0.3) z -= 5;
      if (z <= 3800) continue;
      if (Math.abs(x - PATH[0].x) < 45) continue; // the dock
      if (nearTrail(x, z, 16)) continue;
      const zz = z + 2 + rand() * 10;
      if (nearRail(x, 4, zz, 34)) continue;
      const pal = palAt(x, 0, zz);
      if (k % 5 === 2) F(soups.south, x, zz, 6 + rand() * 5, 140 + k, { mediums: 1, pebbles: 5 });
      else
        for (let i = 0; i < 4; i++)
          rock(soups.south, "K6", x + (rand() - 0.5) * 30, zz + (rand() - 0.5) * 12, 1 + rand() * 2.2, pal, rand, { dir: 250, lean: 10, sink: 0.35, foot: false });
    }
  }

  ringsFrom("valley");
  // ── The valley and a2 (bible 1.3): a near family lower right at a2, families on the trail bends, outcrops ──
  {
    const a2 = stop("a2");
    const L2 = a2.pos;
    for (const [nx, ny, s, k] of [
      [0.9, -0.75, 16, 1],
      [0.72, -0.9, 10, 2],
    ] as const) {
      const hit = stopRay(a2.trail, nx, ny, 1691 / 1278);
      if (!hit || hit.water) continue;
      if (Math.hypot(hit.x - L2.x, hit.z - L2.z) < 110) continue;
      F(soups.south, hit.x, hit.z, s, 200 + k, { lead: "K3" });
    }
    // Trail bends from the signpost to the stream (PATH 2..9), 30-50 off on the outside.
    // The bend at the signpost (PATH 1) had a family 44 east of the post until
    // 2026-10-15 (Lovro's Loom: "the stone over here is kind of annoying"). The
    // bends after it keep the ring numbers and the value jitter count they had
    // with it (its 4 footprints were the valley's rings 23 to 26, its faces the
    // south soup's triangles 2,194 to 2,329), so no rock or ring of theirs moves.
    ringNo = RING_START.valley + 7;
    soups.south.seq = 2330;
    for (let i = 2; i < 10; i++) {
      const a = PATH[i - 1];
      const b = PATH[i];
      const c = PATH[i + 1];
      const d1x = b.x - a.x;
      const d1z = b.z - a.z;
      const d2x = c.x - b.x;
      const d2z = c.z - b.z;
      const turn = Math.sign(d1x * d2z - d1z * d2x) || 1;
      const L = Math.hypot(d1x + d2x, d1z + d2z) || 1;
      const ox = (-(d1z + d2z) / L) * -turn;
      const oz = ((d1x + d2x) / L) * -turn;
      const off = 38 + rnd(i, 7) * 22;
      const x = b.x + ox * off;
      const z = b.z + oz * off;
      if (Math.hypot(x - L2.x, z - L2.z) < 110) continue; // the lookout's knoll and the camp
      F(soups.south, x, z, 11 + rnd(i, 8) * 7, 240 + i);
    }
    // Outcrops on the valley sides between the shore and the rim, where the ground steepens.
    let placed = 0;
    for (let k = 0; k < 400 && placed < 16; k++) {
      const x = 150 + rnd(k, 11) * 1500;
      const z = 2200 + rnd(k, 12) * 1900;
      const sl = slopeAt(x, z);
      if (sl < 0.3 || sl > 0.9) continue;
      if (nearTrail(x, z, 60) || isWater(x, z)) continue;
      if (Math.hypot(x - L2.x, z - L2.z) < 140) continue;
      F(soups.south, x, z, 12 + rnd(k, 13) * 10, 300 + k, { lead: rnd(k, 14) < 0.3 ? "K4" : undefined });
      placed++;
    }
  }

  ringsFrom("stream");
  // ── The stream to the lip (bible 1.4): boulders in the rapids, slabs on the banks, the lip's teeth ──
  {
    const rand = mulberry(3301);
    // Walk the stream from the tarn to ~40 before the lip.
    for (let i = 0; i < STREAM.length - 1; i++) {
      const a = STREAM[i];
      const b = STREAM[i + 1];
      const segL = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const nx = -(b[2] - a[2]) / segL;
      const nz = (b[0] - a[0]) / segL;
      const steps = Math.max(1, Math.round(segL / 70));
      for (let s = 0; s < steps; s++) {
        const u = (s + 0.3 + rand() * 0.4) / steps;
        const x = a[0] + (b[0] - a[0]) * u;
        const z = a[2] + (b[2] - a[2]) * u;
        if (Math.hypot(x - WORLD.falls.top[0], z - WORLD.falls.top[2]) < 70) continue;
        const along = (i + u) / (STREAM.length - 1);
        const wBed = 14 + 44 * along * along;
        // A boulder in the rapids (lit top, foam breaks round it), off centre.
        if (rand() < 0.7) {
          const off = (rand() - 0.5) * wBed * 0.9;
          const bx = x + nx * off;
          const bz = z + nz * off;
          const wy = a[1] + (b[1] - a[1]) * u;
          if (!nearRail(bx, wy + 8, bz, RAIL_CLEAR + 8)) rock(soups.gorge, rand() < 0.5 ? "K3" : "K1", bx, bz, 5 + rand() * 5, PAL.late, rand, { dir: 0, lean: 14, hero: heroAt(bx, wy, bz), sink: 0.35, baseY: wy - 3 });
        }
        // Slabs and a family on each bank (the woods thin to bare rock near the lip).
        for (const sd of [-1, 1]) {
          if (rand() < 0.45) continue;
          const off = sd * (wBed + 14 + rand() * 30);
          const fx = x + nx * off;
          const fz = z + nz * off;
          if (nearTrail(fx, fz, 18)) continue;
          if (along > 0.55 && rand() < 0.5) {
            const g = groundY(fx, fz);
            if (!nearRail(fx, g + 6, fz, RAIL_CLEAR + 10)) rock(soups.gorge, "K2", fx, fz, 10 + rand() * 8, PAL.late, rand, { dir: 0, lean: 14, sink: 0.25 });
          } else F(soups.gorge, fx, fz, 7 + rand() * 7, 3400 + i * 10 + s * 2 + (sd > 0 ? 1 : 0), { pal: PAL.late, strata: [0, 14] });
        }
      }
    }
    // The lip (bible 1.4, water.ts): two rock teeth split the top into three
    // unequal falls; the curtain's lip gaps sit at 0.34 and 0.66 of its width.
    const Fa = WORLD.falls;
    for (const [fx, hw, tall] of [
      [Fa.top[0] - Fa.width * 0.17, 5.5, 1.0],
      [Fa.top[0] + Fa.width * 0.17, 4.5, 0.9],
    ] as const) {
      const z = Fa.top[2] + 6;
      const r2 = mulberry(Math.round(Math.abs(fx) * 13));
      rock(soups.gorge, "K3", fx, z, hw, PAL.late, r2, { dir: 0, lean: 14, baseY: Fa.top[1] - 4, sink: 0.25, tall, foot: false, hero: true });
    }
    // Fix round 2 (judge: the lip is a straight edged slab, "linear water"):
    // chamfered boulders half sunk along both banks of the last 30 before the
    // lip, every one a different size, two standing in the water near the
    // edge so the flow parts round them and the bank's straight line breaks.
    // Three flat values (lit tops about 1.8x the shade side), clear of the dive.
    {
      const a = STREAM[STREAM.length - 2];
      const b = STREAM[STREAM.length - 1];
      const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const ux = (b[0] - a[0]) / L;
      const uz = (b[2] - a[2]) / L;
      const r3 = mulberry(3377);
      // [back from the lip, across (+ east), half width, piece]
      for (const [back, side, hw, key] of [
        [10, -52, 11, "K3"],
        [24, -49, 7, "K1"],
        [13, 51, 11, "K3"],
        [9, -34, 5.5, "K3"],
        [5, 29, 4.5, "K1"],
      ] as const) {
        const x = b[0] - ux * back - uz * side;
        const z = b[2] - uz * back + ux * side;
        const inWater = Math.abs(side) < 45;
        // A bank rock stands up through the water's level where the bank dips under it.
        const base = inWater ? b[1] - 2.5 : Math.max(b[1], groundY(x, z)) - 0.5;
        // In the water the camera passes 12 to 16 over them: a closer clearance.
        if (nearRail(x, base + hw * 0.5, z, (inWater ? 18 : RAIL_CLEAR) + hw)) continue;
        if (!inWater && nearTrail(x, z, hw + 4)) continue;
        rock(soups.gorge, key, x, z, hw, PAL.late, r3, { dir: 0, lean: 14, baseY: base, sink: inWater ? 0.3 : 0.35, foot: !inWater, hero: true, hard: true });
      }
    }
    // Bare slabs on the shelf either side of the lip, set back from the edge, clear of the ride.
    for (const [dx, dz, s, key] of [
      [-78, 24, 14, "K2"],
      [-120, 50, 11, "K2"],
      [70, 30, 13, "K2"],
      [108, 58, 10, "K1"],
      [-150, 16, 9, "K4"],
    ] as const) {
      const x = Fa.top[0] + dx;
      const z = Fa.top[2] + dz;
      const g = groundY(x, z);
      if (nearRail(x, g + s * 0.5, z, RAIL_CLEAR + s)) continue;
      if (key === "K1") F(soups.gorge, x, z, s, 3900 + Math.round(dx), { pal: PAL.late, strata: [0, 14] });
      else rock(soups.gorge, key, x, z, s, PAL.late, rand, { dir: 0, lean: 14, hero: heroAt(x, g, z), sink: 0.25 });
    }
  }

  ringsFrom("northWall");
  // ── The north wall's bands (terrain.ts NORTH_BANDS: a talus foot 30 out
  // rising 16, then bands 28 deep, each a 70 cliff over its first 40 percent
  // and a bench behind): rock families along each bench just behind the cliff's
  // top edge, lit tops lining the band, so the wall reads as stacked ledges.
  // (Wall-hung sheets were tried twice on the walls tonight: full height they
  // read as pillows, as thin ledges as planks nailed to the wall; see the report.)
  // Fix round 2 (judge: single small rocks on the thin ledges read as floating
  // pebbles): a third as many, each a talus cluster of 3 to 5 along the bench,
  // the lead 1.5x the old size, all seated on the bench's own height (never
  // dropped to the cliff foot under an overhanging edge), no pebbles.
  {
    const rand = mulberry(5501);
    for (let i = 0; i < 8; i++) {
      let x = -10 + rand() * 50;
      while (x < 1150) {
        x += 150 + rand() * 180;
        const w = smooth(-20, 40, x) * (1 - smooth(1080, 1150, x));
        if (w < 0.6 || rand() < 0.3) continue;
        const gz = gorgeAt(x);
        const e0 = 30 + i * 28;
        const z = gz.z - gz.hw - (e0 + 18 + rand() * 3);
        const g = groundY(x, z);
        if (g > 640 || slopeAt(x, z, 3) > 0.7) continue;
        if (Math.hypot(x - TRAIL_HUT.x, z - TRAIL_HUT.z) < 60) continue;
        const lead = 9 + rand() * 5;
        if (nearRail(x, g + lead * 0.6, z, RAIL_CLEAR + lead * 2.5)) continue;
        const hero = heroAt(x, g, z);
        const n = 3 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
          const hw = k === 0 ? lead : lead * (0.35 + rand() * 0.3);
          const side = k % 2 ? 1 : -1;
          const cx = k === 0 ? x : x + side * (lead * 0.8 + Math.floor((k + 1) / 2) * lead * 0.7 + rand() * lead * 0.3);
          const cz = k === 0 ? z : z + (rand() - 0.3) * 6;
          const cg = groundY(cx, cz);
          if (!isFinite(cg) || Math.abs(cg - g) > 8 || nearTrail(cx, cz, hw + 4)) continue;
          const key: KitKey = k === 0 ? (rand() < 0.4 ? "K2" : "K3") : rand() < 0.6 ? "K1" : "K5";
          rock(soups.gorge, key, cx, cz, hw, PAL.gorge, rand, { dir: 90, lean: 18, hero: hero && hw > 7, baseY: cg - 0.5, sink: 0.3 });
        }
        rockAnchors.push({ x, z, r: lead * 2.2 });
        families++;
      }
    }
  }

  ringsFrom("gully");
  // ── The gully (bible 1.11): slanted groups standing on both walls, leaning in, a notch of sky between ──
  {
    const G = WORLD.gully;
    const rand = mulberry(6601);
    for (let z = G.z1 + 6; z <= G.z0 + 24; z += 26 + rand() * 12) {
      for (const sd of [-1, 1]) {
        for (const up of [18, 52]) {
          const x = G.x + sd * (G.halfW + (up + (rand() - 0.5) * 10) / G.wall + 8);
          const g = groundY(x, z);
          const hw = up < 30 ? 9 + rand() * 5 : 14 + rand() * 8;
          if (nearRail(x, g + hw, z, 14 + hw)) continue;
          // Lean in over the notch: the west wall's rocks toward the east, the east wall's toward the west.
          // Final pass C: the rim row (up 52) stands on the skyline, where K4's
          // shard clusters read as shark teeth: blocky plates and slabs there.
          // The same one rand() per rock, so every later rock keeps its place.
          const kr = rand();
          const kind = up < 30 ? (kr < 0.65 ? "K4" : "K3") : kr < 0.5 ? "K2" : "K3";
          rock(soups.gorge, kind, x, z, hw, PAL.cliff, rand, { dir: sd < 0 ? 90 : 270, lean: 16, hero: heroAt(x, g, z), sink: 0.2 });
        }
      }
    }
  }

  // ── The gully's step stones (fix round 2: dress-gorge's dodecahedron steps
  // read as crates): the same step positions as dress-gorge.ts ("stone steps
  // up its floor", its own rnd), each step 1 to 3 chamfered hulls ──
  {
    const G0 = WORLD.gully;
    let z = 1138;
    for (let i = 0; z >= 1050; i++) {
      if (rndDG(i, 60) > 0.18) {
        const n = 1 + Math.floor(rndDG(i, 65) * 3);
        for (let j = 0; j < n; j++) {
          const q = i * 5 + j;
          const x = G0.x + (rndDG(q, 61) - 0.5) * 14 + (j - (n - 1) / 2) * 7;
          const zz = z + (rndDG(q, 66) - 0.5) * 3;
          addStepStones(soups.gorge, x, zz, 5 + rndDG(q, 62) * 4.5, 4 + rndDG(q, 67) * 2.2, (rndDG(q, 63) - 0.5) * 0.9, 9100 + q);
        }
      }
      // Final pass: a riser stone in each gap, so the stair is continuous up the notch.
      const gap = 8 + rndDG(i, 70) * 5;
      if (z - gap >= 1050) {
        const q = 400 + i;
        addStepStones(soups.gorge, G0.x + (rndDG(q, 61) - 0.5) * 12, z - gap / 2, 7 + rndDG(q, 62) * 5, 4 + rndDG(q, 67) * 2, (rndDG(q, 63) - 0.5) * 0.7, 9600 + i);
      }
      z -= gap;
    }
  }

  ringsFrom("pool");
  // ── The pool, the south bank, the crossing's talus fan (bible 1.8) ──
  {
    const pool = WORLD.pool;
    // Round the pool's east and west sides, never between the ride and the water.
    for (const b of [84, 118, 150, 210, 242, 276]) {
      const x = pool.x + Math.sin(b * DEG) * (pool.r + 12);
      const z = pool.z - Math.cos(b * DEG) * (pool.r + 12);
      F(soups.gorge, x, z, 8 + rnd(b, 3) * 7, 420 + b, { pebbles: 4 });
    }
    // The talus fan: from the river's north bank to the foot of the north wall, both sides of the trail.
    const rand = mulberry(7701);
    let placed = 0;
    for (let k = 0; k < 200 && placed < 16; k++) {
      const x = 20 + rand() * 360;
      const z = 1270 + rand() * 260;
      const gz = gorgeAt(x);
      if (z < gz.z - gz.hw + 6) continue; // the wall itself
      if (nearTrail(x, z, 16)) continue;
      let dR = Infinity;
      for (let i = 0; i < 4; i++) dR = Math.min(dR, Math.hypot(x - [60, 250, 520, -100][i], z - [1572, 1522, 1478, 1615][i]));
      if (dR < 40) continue;
      if (slopeAt(x, z) > 1.1) continue;
      F(soups.gorge, x, z, 10 + rand() * 10, 7800 + k, { lead: rand() < 0.3 ? "K4" : undefined });
      placed++;
    }
    // On the falls side of the river between the pool and the cliff's foot, off the trail.
    for (const [x, z, s, k] of [
      [100, 1668, 11, 1],
      [128, 1610, 9, 2],
      [-6, 1612, 8, 3],
    ] as const) F(soups.gorge, x, z, s, 7900 + k);
  }

  ringsFrom("hike");
  // ── The hike and the a4 ledge (bible 1.9, 1.10) ──
  {
    const rand = mulberry(8801);
    // Families beside the switchback bends (the cairns are dress-gorge.ts's).
    // Seeded by the bend's own count: the first bend was the trail's point 26
    // when these were placed, hence 8826, and a point added to or taken from
    // the trail anywhere before the bends must not re-deal them.
    let bend = 0;
    for (let i = 0; i < PATH.length - 1; i++) {
      const b = PATH[i];
      if (!(b.x > 200 && b.x < 460 && b.z > 1200 && b.z < 1300 && b.y > 70 && b.y < 310)) continue;
      const a = rand() * Math.PI * 2;
      F(soups.gorge, b.x + Math.cos(a) * 42, b.z + Math.sin(a) * 42, 8 + rand() * 5, 8826 + bend++);
    }
    // The ledge's rock lip: slabs and rocks along the bench's outer edge, the
    // near side of the a4 frame, dark across the bottom; clear of the hut and
    // the trail.
    const E2 = WORLD.hikeLedge.edge;
    for (let i = 0; i < E2.length - 1; i++) {
      const a = E2[i];
      const b = E2[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = -(b[1] - a[1]) / L;
      const nz = (b[0] - a[0]) / L;
      // Inward (north, into the bench): the edge runs west, so the bench is to its right.
      const inx = -nx;
      const inz = -nz;
      for (let s = 8; s < L; s += 20 + rand() * 12) {
        const x = a[0] + ((b[0] - a[0]) * s) / L + inx * (5 + rand() * 4);
        const z = a[1] + ((b[1] - a[1]) * s) / L + inz * (5 + rand() * 4);
        if (Math.hypot(x - TRAIL_HUT.x, z - TRAIL_HUT.z) < 44) continue;
        if (nearTrail(x, z, 9)) continue;
        const g = groundY(x, z);
        const hw = 7 + rand() * 6;
        if (nearRail(x, g + hw, z, 16 + hw)) continue;
        rock(soups.gorge, rand() < 0.5 ? "K2" : rand() < 0.5 ? "K1" : "K3", x, z, hw, PAL.gorge, rand, { dir: 90, lean: 18, hero: heroAt(x, g, z), sink: 0.25 });
      }
    }
    // A few boulders on the band benches (the talus that fell and stayed).
    let placed = 0;
    for (let k = 0; k < 300 && placed < 14; k++) {
      const x = 40 + rand() * 1060;
      const gz = gorgeAt(x);
      const z = gz.z - gz.hw - 40 - rand() * 300;
      const sl = slopeAt(x, z, 3);
      if (sl > 0.5) continue;
      const g = groundY(x, z);
      if (g < gz.y + 60 || g > 620) continue;
      if (nearTrail(x, z, 14)) continue;
      if (Math.hypot(x - TRAIL_HUT.x, z - TRAIL_HUT.z) < 60) continue;
      F(soups.gorge, x, z, 7 + rand() * 6, 8900 + k, { mediums: 2, pebbles: 3 });
      placed++;
    }
  }

  ringsFrom("saddle");
  // ── The rim shelf round the gully's top, the saddle and the meadow (bible 1.12) ──
  {
    const sx = WORLD.gully.x;
    const sz = WORLD.gully.z1;
    for (let k = 0; k < 12; k++) {
      const a = rnd(k, 21) * Math.PI * 2;
      const r = 70 + rnd(k, 22) * 170;
      const x = sx + Math.cos(a) * r;
      const z = sz + Math.sin(a) * r;
      if (z > WORLD.climb.topZ - 14) continue;
      if (Math.abs(x - sx) < 55 && z < sz) continue; // straight ahead of the burst
      if (slopeAt(x, z) > 0.6) continue;
      F(soups.high, x, z, 9 + rnd(k, 23) * 8, 500 + k, { lead: rnd(k, 24) < 0.4 ? "K4" : undefined, pal: PAL.cliff });
    }
    let placed = 0;
    for (let k = 0; k < 600 && placed < 24; k++) {
      const x = 1050 + rnd(k, 24) * 900;
      const z = -300 + rnd(k, 25) * 1250;
      const L = WORLD.lake;
      if (Math.hypot(x - L.x, z - L.z) < L.r + 30) continue;
      if (slopeAt(x, z) > 0.8) continue;
      if (nearTrail(x, z, 30)) continue;
      let dB = Infinity;
      for (const q of BROOK) dB = Math.min(dB, Math.hypot(x - q[0], z - q[2]));
      if (dB < 24) continue;
      F(soups.high, x, z, 10 + rnd(k, 26) * 10, 540 + k, { lead: rnd(k, 27) < 0.3 ? "K4" : undefined });
      placed++;
    }
    // Stones along the brook's banks and at its little cascade.
    for (let i = 0; i < BROOK.length - 1; i++) {
      const a = BROOK[i];
      const b = BROOK[i + 1];
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const L = Math.hypot(dx, dz);
      for (let s = 0.2; s < 1; s += 0.35) {
        const x = a[0] + dx * s;
        const z = a[2] + dz * s;
        const side = rnd(i * 10 + s * 10, 28) < 0.5 ? -1 : 1;
        const off = 12 + rnd(i * 10 + s * 10, 29) * 6;
        F(soups.high, x - (dz / L) * off * side, z + (dx / L) * off * side, 4 + rnd(i + s, 30) * 3, 600 + i * 10 + Math.round(s * 10), { mediums: 1, pebbles: 3 });
      }
    }
  }

  ringsFrom("lake");
  // ── The Mirror Lake (locked composition): framing lower left at a5, the shore, the rock islet with a bush (still 2) ──
  {
    const a5 = stop("a5");
    const L = WORLD.lake;
    for (const [nx, ny, s, k] of [
      [-0.8, -0.8, 18, 1],
      [-0.6, -0.9, 14, 2],
      [-0.92, -0.55, 16, 3],
    ] as const) {
      const hit = stopRay(a5.trail, nx, ny);
      if (!hit) continue;
      let { x, z } = hit;
      if (hit.water) {
        const dx = x - L.x;
        const dz = z - L.z;
        const r = Math.hypot(dx, dz) || 1;
        let rr = r;
        while (rr < L.r + 10 && L.y - groundY(L.x + (dx / r) * rr, L.z + (dz / r) * rr) > s * 0.25) rr += 4;
        x = L.x + (dx / r) * rr;
        z = L.z + (dz / r) * rr;
      }
      F(soups.high, x, z, s, 700 + k, { pebbles: 5 });
    }
    // The rock islet in the water, left of the a5 frame, clear of the island's reflection.
    F(soups.high, 1030, -262, 17, 777, { lead: "K3", mediums: 3, pebbles: 4, baseY: L.y - 4 });
    for (let b = 0; b < 360; b += 13) {
      if (rnd(b, 31) < 0.4) continue;
      const r = L.r + 4 + rnd(b, 32) * 22;
      const x = L.x + Math.sin(b * DEG) * r;
      const z = L.z - Math.cos(b * DEG) * r;
      if (nearTrail(x, z, 22)) continue;
      const B = a5.pos;
      if (Math.hypot(x - B.x, z - B.z) < 90) continue; // the jetty and boathouse
      F(soups.high, x, z, 8 + rnd(b, 33) * 10, 740 + b, { pebbles: 4 });
    }
  }

  ringsFrom("island");
  // ── The Sky Island: v5's underside sheets (the rise is locked), rim families by moonlight ──
  {
    const I = WORLD.island;
    const rand = mulberry(977);
    const COVE = 133;
    const rim = (th: number) => {
      let d = th / DEG - COVE;
      d -= 360 * Math.round(d / 360);
      const cove = 100 * Math.exp(-((d / 14) ** 2));
      return I.r - 26 * (0.5 + 0.5 * Math.sin(3 * th + 1.3)) - 12 * (0.5 + 0.5 * Math.sin(7 * th + 0.4)) - cove;
    };
    const low = [
      [0, 1],
      [0.04, 0.985],
      [0.12, 0.93],
      [0.26, 0.8],
      [0.44, 0.62],
      [0.62, 0.43],
      [0.8, 0.24],
      [0.93, 0.09],
    ];
    const seg = 64;
    const seed = 3;
    const vert = (i: number, k: number): THREE.Vector3 => {
      const ii = ((i % seg) + seg) % seg;
      const th = (ii / seg) * Math.PI * 2;
      const r = rim(th);
      const s = Math.sin(th);
      const c = -Math.cos(th);
      if (k === 0) return new THREE.Vector3(I.x + s * r, I.y, I.z + c * r);
      const kk = k - 1 + 6;
      const [dd, ff] = low[k];
      const jag = 1 + 0.16 * (rnd(ii + kk * 97, seed) - 0.5) + 0.1 * Math.sin(th * 5 + seed);
      return new THREE.Vector3(I.x + s * r * ff * jag, I.y - ISLAND_DEPTH * dd * (1 + 0.1 * (rnd(ii * 3 + kk, seed + 1) - 0.5)), I.z + c * r * ff * jag);
    };
    const base = lin(0x747a86);
    for (let k = 0; k < low.length - 2; k++) {
      for (let i = 0; i < seg; i++) {
        if (rand() < 0.2) continue;
        const th = ((i + 0.5) / seg) * 360;
        let dc = th - COVE;
        dc -= 360 * Math.round(dc / 360);
        if (Math.abs(dc) < 24) continue;
        const a = vert(i, k);
        const b = vert(i + 1, k);
        const c = vert(i, k + 1);
        const d = vert(i + 1, k + 1);
        const f = 0.3 + rand() * 0.4;
        const g = 0.3 + rand() * 0.4;
        const P = a.clone().lerp(b, f).lerp(c.clone().lerp(d, f), g);
        const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
        const out = new THREE.Vector3(P.x - I.x, 0, P.z - I.z).normalize();
        if (n.dot(out) < 0) n.negate();
        if (nearRail(P.x, P.y, P.z, RAIL_CLEAR + 30)) continue;
        const L = a.distanceTo(b) * (0.55 + rand() * 0.4);
        const H = Math.min(a.distanceTo(c), 60) * (0.3 + rand() * 0.25);
        const Pn = P.clone().addScaledVector(n, 3);
        underSheet(soups.sky, Pn, n, L, H, base, rand);
        modules++;
      }
    }
    // Rim families on the top, off the path, the terrace and the cove.
    const onIsland = (x: number, z: number) => WORLD.islandLevel + islandTop(x, z);
    const pathD = (x: number, z: number) => {
      let best = Infinity;
      for (let i = 0; i < ISLAND_PATH.length - 1; i++) {
        const a = ISLAND_PATH[i];
        const b = ISLAND_PATH[i + 1];
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const u = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz)));
        best = Math.min(best, Math.hypot(x - a[0] - dx * u, z - a[2] - dz * u));
      }
      return best;
    };
    for (let b = 0; b < 360; b += 10) {
      if (rnd(b, 41) < 0.5) continue;
      let dc = b - COVE;
      dc -= 360 * Math.round(dc / 360);
      if (Math.abs(dc) < 26) continue;
      const r = rim(b * DEG) - 18 - rnd(b, 42) * 22;
      const x = I.x + Math.sin(b * DEG) * r;
      const z = I.z - Math.cos(b * DEG) * r;
      if (pathD(x, z) < 34) continue;
      if (Math.hypot(x - OBSERVATORY.x, z - OBSERVATORY.z) < 110) continue;
      F(soups.sky, x, z, 7 + rnd(b, 43) * 8, 820 + b, { baseY: onIsland(x, z), pal: PAL.isleTop, strata: [40, 6], mediums: 2, pebbles: 3 });
    }
  }

  ringsFrom("gate");
  // ── The Gate isle's brow (bible 1.20): a few families near the rim, clear of the arch, the dock and the causeway ──
  {
    const I = WORLD.gateIsle;
    const causeD = (x: number, z: number) => {
      let best = Infinity;
      for (let i = 0; i < GATE_CAUSEWAY.length - 1; i++) {
        const a = GATE_CAUSEWAY[i];
        const b = GATE_CAUSEWAY[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const u = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
        best = Math.min(best, Math.hypot(x - a.x - dx * u, z - a.z - dz * u));
      }
      return best;
    };
    for (let b = 0; b < 360; b += 17) {
      if (rnd(b, 51) < 0.45) continue;
      const r = I.r - 30 - rnd(b, 52) * 30;
      const x = I.x + Math.sin(b * DEG) * r;
      const z = I.z - Math.cos(b * DEG) * r;
      if (Math.hypot(x - GATE.x, z - GATE.z) < 150) continue;
      if (causeD(x, z) < 50) continue;
      // C1 (B8): the isle's rim is cut short behind the arch; no family past the cliff.
      if (gateIsleTop(x + Math.sin(b * DEG) * 20, z - Math.cos(b * DEG) * 20) === null) continue;
      F(soups.gate, x, z, 8 + rnd(b, 53) * 8, 960 + b, { baseY: I.y, pal: PAL.sunrise, strata: [322, 8], mediums: 2, pebbles: 3 });
    }
  }

  return { soups, families, modules };
}

/** Island top height at (x, z) relative to islandLevel (blocks.ts islandTop). */
function islandTop(x: number, z: number): number {
  const d2 = (x + 2410) ** 2 + (z + 1470) ** 2;
  return 42 * Math.exp(-d2 / (150 * 150));
}

/** v5's R5 sheet, flush on the island's underside cone (the rise is locked, so it keeps v5's look). */
function underSheet(soup: Soup, P: THREE.Vector3, n: THREE.Vector3, L: number, H: number, base: THREE.Color, rand: () => number): void {
  const nn = n.clone().normalize();
  const t = new THREE.Vector3(0, 1, 0).cross(nn);
  if (t.lengthSq() < 1e-6) t.set(1, 0, 0);
  t.normalize();
  const v = new THREE.Vector3().crossVectors(t, nn).normalize();
  const basis = new THREE.Matrix4().makeBasis(t, nn, v);
  if (basis.determinant() < 0) basis.makeBasis(t, nn, v.negate());
  basis.setPosition(P.clone().addScaledVector(nn, -5));
  const th = 5 + 3 + rand() * 3;
  const pts: [number, number][] = [
    [-L, -H * (0.3 + rand() * 0.4)],
    [-L * (0.55 + rand() * 0.2), -H],
    [L * (0.45 + rand() * 0.3), -H * (0.85 + rand() * 0.15)],
    [L, H * (rand() - 0.5) * 0.5],
    [L * (0.4 + rand() * 0.3), H],
    [-L * (0.5 + rand() * 0.35), H * (0.8 + rand() * 0.2)],
  ];
  const o = pts.map(([u, w]) => [u, th * (0.8 + rand() * 0.4), w]);
  const back = pts.map(([u, w]) => [u * 0.96, 0, w * 0.96]);
  const f: number[][][] = [[...o].reverse()];
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    f.push([back[i], o[i], o[j]], [back[i], o[j], back[j]]);
  }
  soup.flat(f, basis, 8, base, 0.8 + rand() * 0.2);
}

/**
 * Final pass D: the far range across the east sea. From the traverse and the
 * gully turn (850 to 910 vh) the camera looks east over the coast, and the
 * frame was empty peach haze over a flat sea horizon. Two ridge lines stand
 * across the sea, arcs round the turn's camera (FAR_RANGE_C): a low coastal
 * range at ~4,000 and taller peaks behind it at ~5,400, so the turn sweeps a
 * skyline. Each is a folded curtain (peaks set back, saddles forward, a
 * shoulder row), faceted so the low sun splits every peak into a lit and a
 * shade plane; the stock fog ramp gives them the far ridges' aerial values
 * (the far line a step paler than the near). Bearings 56 to 154 only: north
 * of that is the east ring, south of it the bay behind the opening camera.
 * ~470 triangles, one call, on NO_REFLECT_LAYER (the lake never sees east).
 */
const FAR_RANGE_C = { x: 1330, z: 1220 } as const;
const FAR_RANGE_LINES = [
  // R, bearing from/to, crest samples, crest height min/max, seed, [foot, rock, crest] (linear albedo)
  { R: 4000, b0: 62, b1: 154, n: 44, h0: 90, h1: 340, seed: 5151, col: [[0.03, 0.035, 0.048], [0.066, 0.054, 0.074], [0.092, 0.072, 0.086]] },
  { R: 5400, b0: 56, b1: 148, n: 34, h0: 200, h1: 640, seed: 6262, col: [[0.045, 0.045, 0.068], [0.075, 0.062, 0.092], [0.1, 0.082, 0.104]] },
] as const;

function farRange(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const p = (b: number, r: number, y: number) => {
    const a = (b * Math.PI) / 180;
    return new THREE.Vector3(FAR_RANGE_C.x + r * Math.sin(a), y, FAR_RANGE_C.z - r * Math.cos(a));
  };
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const m = new THREE.Vector3();
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, hTop: number, L: (typeof FAR_RANGE_LINES)[number]) => {
    // Face the turn's camera (the arc's centre).
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    m.addVectors(a, b).add(c).multiplyScalar(1 / 3);
    const [v0, v1, v2] = n.x * (FAR_RANGE_C.x - m.x) + n.z * (FAR_RANGE_C.z - m.z) >= 0 ? [a, b, c] : [a, c, b];
    pos.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
    // One flat value per face: a dark forested foot, rock above, the crest lighter.
    const t = m.y / Math.max(hTop, 1);
    const k = t < 0.3 ? 0 : t < 0.62 ? 1 : 2;
    const cc = L.col[k];
    for (let q = 0; q < 3; q++) col.push(cc[0], cc[1], cc[2]);
  };
  for (const L of FAR_RANGE_LINES) {
    const rand = mulberry(L.seed);
    // The crest: two octaves of value noise along the bearing, peaked (a
    // ridged fold) so summits stand out of long shoulders; the ends drop to
    // the sea.
    const knots = Array.from({ length: 10 }, () => rand());
    const fine = Array.from({ length: 24 }, () => rand());
    const vn = (arr: number[], u: number) => {
      const x = u * (arr.length - 1);
      const i = Math.min(arr.length - 2, Math.floor(x));
      const f = x - i;
      const s = f * f * (3 - 2 * f);
      return arr[i] + (arr[i + 1] - arr[i]) * s;
    };
    const crest: number[] = [];
    const jit: number[] = [];
    for (let i = 0; i <= L.n; i++) {
      const u = i / L.n;
      const big = vn(knots, u);
      const ridged = 1 - Math.abs(vn(fine, u) * 2 - 1);
      // Both ends sink into the sea over the last 18% (a hard end read as a wall).
      const e = Math.min(1, u / 0.18, (1 - u) / 0.18);
      const end = e * e * (3 - 2 * e);
      crest.push((L.h0 + (L.h1 - L.h0) * (0.55 * big + 0.45 * big * ridged)) * end * (0.9 + 0.2 * rand()));
      jit.push((rand() - 0.5) * 0.35);
    }
    // Rows back from the sea: the waterline, the foothills, the crest, the
    // back slope (so the crest's faces turn with it), each row's height a
    // share of the crest's.
    const rows = [
      { dr: -700, k: 0, y: -40 },
      { dr: -300, k: 0.38, y: 0 },
      { dr: 0, k: 1, y: 0 },
      { dr: 320, k: 0.45, y: 0 },
    ];
    const at = (i: number, j: number) => {
      const b = L.b0 + ((L.b1 - L.b0) * (i + (i > 0 && i < L.n ? jit[i] : 0))) / L.n;
      const R = rows[j];
      const y = R.k === 0 ? R.y : crest[i] * R.k * (j === 1 ? 0.8 + 0.4 * ((i * 7) % 5) / 4 : 1);
      return p(b, L.R + R.dr + (j === 2 ? jit[i] * 120 : 0), y);
    };
    for (let i = 0; i < L.n; i++) {
      for (let j = 0; j + 1 < rows.length; j++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i + 1, j + 1);
        const d = at(i, j + 1);
        // Split each cell along its shorter diagonal's high side, so a
        // summit's two flanks are separate planes.
        if ((i + j) % 2 === 0) {
          tri(a, b, c, L.h1, L);
          tri(a, c, d, L.h1, L);
        } else {
          tri(a, b, d, L.h1, L);
          tri(b, c, d, L.h1, L);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ── Install ──────────────────────────────────────────────────────────────────

/** The rock material: Lambert over the painted faces, plus an emissive floor (the paint times uRockFloor) so shade never goes black. */
function rockMaterial(floor: number, name: string): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.name = name;
  const u = { value: floor };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRockFloor = u;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uRockFloor;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uRockFloor;");
  };
  mat.customProgramCacheKey = () => "v6-rock-floor";
  mat.userData.floor = u;
  return mat;
}

export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = performance.now();
  const root = new THREE.Group();
  // The name the gates and the overdraw probe classify rocks by (v6-gates.mjs).
  root.name = "V5Rocks";
  ctx.root.add(root);
  const tk = performance.now();
  kit();
  const kitMs = performance.now() - tk;
  const built = place();
  // The sky soup holds v5's underside sheets (the rise is locked): no floor there, as v5.
  const FLOOR: Record<string, number> = { south: PAL.gold.floor, gorge: PAL.gorge.floor, high: PAL.sunset.floor, sky: 0, gate: PAL.sunrise.floor };
  const mats: THREE.MeshLambertMaterial[] = [];
  const meshes: THREE.Mesh[] = [];
  const tris: Record<string, number> = {};
  let rocks = 0;
  let heroes = 0;
  for (const [name, soup] of Object.entries(built.soups)) {
    tris[name] = soup.tris;
    rocks += soup.rocks;
    heroes += soup.heroes;
    if (!soup.tris) continue;
    const mat = rockMaterial(FLOOR[name] ?? 0.16, `V6Rock:${name}`);
    mats.push(mat);
    const mesh = new THREE.Mesh(soup.geometry(), mat);
    mesh.name = `Rocks:${name}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
    meshes.push(mesh);
  }
  // Final pass D: the far range across the east sea (farRange). The rock
  // program (same cache key), so no new shader.
  {
    const g = farRange();
    const mat = rockMaterial(PAL.sunset.floor, "V6Rock:farRange");
    mats.push(mat);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = "Rocks:farRange";
    mesh.layers.set(NO_REFLECT_LAYER);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
    meshes.push(mesh);
    tris.farRange = g.getAttribute("position").count / 3;
  }
  root.updateMatrixWorld(true);
  const buildMs = Math.round(performance.now() - t0);
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const sphere = new THREE.Sphere();

  return {
    name: "rocks",
    dispose() {
      root.removeFromParent();
      for (const m of meshes) m.geometry.dispose();
      for (const m of mats) m.dispose();
    },
    stats() {
      const cam = ctx.camera;
      cam.updateMatrixWorld();
      pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      let visibleTris = 0;
      let visibleCalls = 0;
      for (const m of meshes) {
        sphere.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld);
        if (frustum.intersectsSphere(sphere)) {
          visibleTris += m.geometry.getAttribute("position").count / 3;
          visibleCalls++;
        }
      }
      return {
        triangles: Object.values(tris).reduce((a, b) => a + b, 0),
        ...Object.fromEntries(Object.entries(tris).map(([k, v]) => [`tris_${k}`, v])),
        rocks,
        heroes,
        families: built.families,
        modules: built.modules,
        calls: meshes.length,
        visibleTris,
        visibleCalls,
        kitMs: Math.round(kitMs),
        buildMs,
      };
    },
  };
};
