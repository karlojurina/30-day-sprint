/**
 * V5 look module: THE FOREST (world_art_bible.md 1.7, 3.1-3.2, 4.1-4.2, 5.2-5.4, 5.6).
 *
 * WHAT IT ADDS, under one group "Forest":
 *   - the wild kit (4.1), procedural, normalised to height 1 and scaled by the
 *     instance matrix: T1 spruce (3 tiers, zigzag skirts), T2 young spruce (2
 *     tiers, skirt to the ground), T3 spire (4 narrow tiers), T4 snag, T5 aspen
 *     (bent-normal lobes), T6 shrub, TH hero spruce (5 tiers, 10 sided, never
 *     switches LOD) where the rail passes close and low.
 *   - the Glowing Forest's understory (4.2, MAGIC define): M2 lantern willows
 *     round the clearing, M3 glowcap clusters and M4 glow ferns carpeting the
 *     floor, teal / cyan / violet, pulsing per instance.
 *
 * LOD (5.4). Three levels, LOD0 inside L1, LOD1 to L2, LOD2 past it. The
 * conifers share ONE LOD1 shape and every tree shares ONE LOD2 pyramid (species
 * width lives in the instance scale), so the wild forest is 11 draw calls at
 * most. Every LOD0 vertex carries aMorph, its place on the LOD1 envelope, and
 * LOD1 carries its place on the pyramid; the vertex shader slides toward it over
 * the last fifth before the switch, so the switch itself shows no pop. 5
 * percent hysteresis on each threshold.
 *
 * COMPACTION (5.3). One InstancedMesh per species per LOD. On frames where the
 * camera moved: trees are sorted into 250-unit cells; a cell outside the view
 * or past the far cull is skipped whole; each tree left is tested against the
 * frustum, bucketed by distance, and its 16 floats copied into that LOD's
 * instanceMatrix; count is set and only the used range uploaded. Underground
 * (cave, tunnel, the shaft below the collar) nothing is drawn.
 *
 * SHADER. MeshLambertMaterial (the scene's lights and fog apply) plus: the
 * geomorph; colour welding, instance tint -> the mass colour between 500 and
 * 1,800 away (1.7); a brown dead patch on one tier of ~15 percent of trees;
 * near sway inside 300 of the camera and a far gust band that lightens the
 * tips as it crosses the woods (5.6); a warm rim on the sun side at the tips
 * (v3). The MAGIC variant adds emissive vertex glow x magicGlow x a per
 * instance pulse. Hooks chain through onBeforeCompile (v3 chainCompileHook), so
 * a fog or grade patch assigned later still runs.
 *
 * PLACEMENT (3.1-3.2). A jittered 16-unit grid over the ground route's region,
 * each candidate kept with a probability from a density mask: clumped by low
 * frequency noise (30-40 percent of mid slopes open), densest on mid slopes,
 * zero on the sea, lake, pool, river, brook, stream, cliffs (normal y < 0.72),
 * above the treeline, the path, the shaft collar, the Glowing Forest circle
 * (its giants are blocks.ts's), and the landmark clearings; a pocket ring of
 * denser, taller trees 150-400 round each open stop's landmark. Scale falls
 * from 1.0 in a clump's core to 0.6 at its edge; young spruce and shrubs ring
 * the clumps. Nothing rises into the camera's way (a clearance grid from the
 * rail), across a stop's sight line to its landmark, or into the a5 view
 * across the lake. Zone mixes and multipliers: ZONES.
 *
 * REPLACES: the conifers and broadleaves blocks.ts's buildCamp put at "the
 *   edge of the first woods", and the conifers, broadleaves and shrub blobs of
 *   its buildMeadow. The integrator deleted those loops from blocks.ts, so
 *   the strip by vertex colour that stood in for that is gone too.
 *
 * TUNING: the constants block below.
 */
import * as THREE from "three";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import type { SurfacesApi } from "./surfaces";
import {
  BROOK,
  FOREST_KEEP_CLEAR,
  PATH,
  PLACES,
  RIVER,
  SHAFT,
  STREAM,
  TRAIL,
  TRAIL_KIND,
  WORLD,
  type TrailKind,
} from "./layout";

// ── Tunables ────────────────────────────────────────────────────────────────

/** Wild trees placed in total (all species, before the hero swap). */
const TARGET_WILD = 36000;
/** Candidate grid: one jittered candidate per CELL x CELL. */
const CELL = 16;
/** The region trees grow in: the ground route and the slopes in view of it. */
const ROI = { minX: -3000, maxX: 3600, minZ: -3000, maxZ: 5000 };
/** Clearance and distance grids: cell size. */
const G = 20;
/** LOD switch distances and far culls per species kind. */
const L1 = 1000;
const L2 = 3000;
const HYST = 0.05;
/** Culling cells for compaction. */
const CULL_CELL = 250;
/** Colour welding range (1.7). */
const WELD_FROM = 500;
const WELD_TO = 1800;
/** Near sway: full inside SWAY_FULL, none past SWAY_R; tip travel as a share of height. */
const SWAY_FULL = 150;
const SWAY_R = 300;
const SWAY_AMP = 0.02;
/** Far gust: tips lighten by this share where the band passes. */
const GUST_TINT = 0.3;
/** Warm rim strength at the tips. */
const RIM = 0.85;
/** Hero spruces: at most this many, within HERO_R of the rail where the camera rides under HERO_ABOVE. */
const HERO_MAX = 300;
const HERO_R = 250;
const HERO_ABOVE = 170;
/** Clearance: tree tops stay this far under the camera within CAM_R of the rail. */
const CAM_R = 70;
const CAM_GAP = 18;

/** Magic understory counts (3.2 Z6). */
const WILLOWS = 180;
const GLOWCAPS = 1200;
const GLOWFERNS = 3000;

// Species ids.
const T1 = 0; // spruce
const T2 = 1; // young spruce
const T3 = 2; // spire
const T4 = 3; // snag
const T5 = 4; // aspen
const T6 = 5; // shrub
const TH = 6; // hero spruce
const M2 = 7; // lantern willow
const M3 = 8; // glowcap cluster
const M4 = 9; // glow fern
const NSP = 10;
const SPECIES_NAME = ["T1", "T2", "T3", "T4", "T5", "T6", "TH", "M2", "M3", "M4"];
/** Height range per species, world units (4.1, 4.2). */
const H_RANGE: ReadonlyArray<readonly [number, number]> = [
  [34, 58],
  [14, 28],
  [44, 70],
  [28, 48],
  [20, 34],
  [5, 10],
  [40, 64],
  [40, 70],
  [4, 18],
  [6, 12],
];
/** Crown width as a multiple of height (instance xz scale / y scale); the geometry's own base radius is R0. */
const WIDTH: readonly number[] = [1.0, 1.15, 0.62, 1.0, 1.0, 1.7, 1.0, 1.0, 1.0, 1.0];
/** Per species: LOD thresholds [L1, L2] and the last LOD drawn (beyond it: culled). */
const LOD_D: ReadonlyArray<readonly [number, number, number]> = [
  [L1, L2, 2],
  [L1, L2, 2],
  [L1, L2, 2],
  [L1, L2, 1],
  [L1, L2, 2],
  [L1, 2200, 1],
  [1e9, 1e9, 0],
  [700, 2200, 2],
  [350, 900, 1],
  [250, 700, 1],
];

/** Zone mixes (3.2): [spruce, young, spire, snag, aspen]. */
interface Zone {
  name: string;
  x: number;
  z: number;
  r: number;
  mult: number;
  mix: readonly [number, number, number, number, number];
  shrub: number;
}
const ZONES: readonly Zone[] = [
  { name: "Z1", x: 1250, z: 3950, r: 1000, mult: 1.0, mix: [0.5, 0.2, 0, 0.05, 0.25], shrub: 0.3 },
  { name: "Z2", x: 520, z: 2750, r: 900, mult: 1.2, mix: [0.6, 0.2, 0, 0.05, 0.15], shrub: 0.35 },
  { name: "Z3", x: 0, z: 1750, r: 750, mult: 1.0, mix: [0.4, 0.1, 0.45, 0.05, 0], shrub: 0.2 },
  { name: "Z4", x: 1470, z: 600, r: 650, mult: 1.15, mix: [0.5, 0.1, 0.2, 0, 0.2], shrub: 0.3 },
  { name: "Z5", x: 700, z: -350, r: 1500, mult: 1.1, mix: [0.6, 0.1, 0.3, 0, 0], shrub: 0.15 },
];
const BACKDROP: Zone = { name: "BG", x: 0, z: 0, r: 1, mult: 0.75, mix: [0.55, 0.1, 0.35, 0, 0], shrub: 0 };

// ── Deterministic helpers (as v3) ───────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 144665)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
function fbm(x: number, z: number, seed: number): number {
  return 0.6 * vnoise(x, z, seed) + 0.28 * vnoise(x * 2.07, z * 2.07, seed + 7) + 0.12 * vnoise(x * 4.3, z * 4.3, seed + 13);
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));
/** Math.hypot is slow in V8's hot loops. */
const hyp = (a: number, b: number, c = 0) => Math.sqrt(a * a + b * b + c * c);

// ── Geometry kit ────────────────────────────────────────────────────────────

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const C = (hex: string) => new THREE.Color(hex);
type MorphFn = (p: THREE.Vector3) => THREE.Vector3;

/** Non-indexed triangle soup: position, normal, colour, aMorph, aPatch, and aGlow for the magic kit. */
class Soup {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  mor: number[] = [];
  pat: number[] = [];
  glo: number[] = [];
  morph: MorphFn | null = null;
  patch = 0;
  glow: THREE.Color | null = null;
  vert(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, glow: THREE.Color | null = this.glow) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
    const m = this.morph ? this.morph(p) : p;
    this.mor.push(m.x, m.y, m.z);
    this.pat.push(this.patch);
    this.glo.push(glow ? glow.r : 0, glow ? glow.g : 0, glow ? glow.b : 0);
  }
  flat(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, col: THREE.Color | [THREE.Color, THREE.Color, THREE.Color], glow?: [THREE.Color | null, THREE.Color | null, THREE.Color | null]) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const [ca, cb, cc] = Array.isArray(col) ? col : [col, col, col];
    this.vert(a, n, ca, glow ? glow[0] : this.glow);
    this.vert(b, n, cb, glow ? glow[1] : this.glow);
    this.vert(c, n, cc, glow ? glow[2] : this.glow);
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, col: THREE.Color) {
    this.flat(a, b, c, col);
    this.flat(a, c, d, col);
  }
  /** Adds an icosahedron lobe with normals bent toward its centre (1.7 fluffy volume). */
  lobe(c: THREE.Vector3, r: THREE.Vector3, colAt: (v: THREE.Vector3, d: THREE.Vector3) => THREE.Color, detail = 0, glowAt?: (v: THREE.Vector3, d: THREE.Vector3) => THREE.Color | null) {
    const ico = new THREE.IcosahedronGeometry(1, detail);
    const p = ico.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const d = V(p.getX(i), p.getY(i), p.getZ(i));
      const v = V(c.x + d.x * r.x, c.y + d.y * r.y, c.z + d.z * r.z);
      this.vert(v, d.clone().normalize(), colAt(v, d), glowAt ? glowAt(v, d) : this.glow);
    }
    ico.dispose();
  }
  geometry(magic = false): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("aMorph", new THREE.Float32BufferAttribute(this.mor, 3));
    g.setAttribute("aPatch", new THREE.Float32BufferAttribute(this.pat, 1));
    if (magic) g.setAttribute("aGlow", new THREE.Float32BufferAttribute(this.glo, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
  get triangles() {
    return this.pos.length / 9;
  }
}

/** Conifer vertex colour (1.7): dark teal-green base, deep green middle, warm olive tips. Saturation held near 0.35. */
const CON_BASE = C("#25322b");
const CON_MID = C("#3a4c35");
const CON_TIP = C("#767b4c");
const TRUNK = C("#2d231c");
function coniferGradient(y: number): THREE.Color {
  return y < 0.5 ? CON_BASE.clone().lerp(CON_MID, smooth(0, 0.5, y)) : CON_MID.clone().lerp(CON_TIP, smooth(0.5, 1.05, y));
}

/** Base radius of every conifer's lowest tier, in height units: species width is in the instance scale. */
const R0 = 0.25;

interface Tier {
  y0: number;
  y1: number;
  r: number;
  ring: boolean;
}

/** The shared LOD1 conifer (2 tiers, 7 sides, 14 tris) and its radius envelope. */
const LOD1_TIERS: Tier[] = [
  { y0: 0.12, y1: 0.7, r: R0 * 0.95, ring: false },
  { y0: 0.45, y1: 1.0, r: R0 * 0.62, ring: false },
];
function envelope(tiers: Tier[], y: number): number {
  let r = 0;
  for (const t of tiers) {
    if (y < t.y0 - 0.03 || y > t.y1) continue;
    const k = Math.min(1, Math.max(0, (t.y1 - y) / (t.y1 - t.y0)));
    r = Math.max(r, t.r * k);
  }
  return r;
}
/** The shared LOD2 pyramid (3 sides, 3 tris) and its envelope. */
const PYR_Y0 = 0.1;
const PYR_R = R0 * 0.85;
const pyrEnvelope = (y: number) => (y < PYR_Y0 ? PYR_R : PYR_R * Math.max(0, (1 - y) / (1 - PYR_Y0)));

/** Morph a vertex onto a radius envelope at its own height and angle (5.4 geomorph). */
function toEnvelope(env: (y: number) => number): MorphFn {
  return (p) => {
    const rr = hyp(p.x, p.z);
    if (rr < 1e-5) return p.clone();
    const r = env(p.y);
    return V((p.x / rr) * r, p.y, (p.z / rr) * r);
  };
}

function addTrunk(s: Soup, r: number, top: number, col: THREE.Color, sides = 3) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const p00 = V(Math.cos(a0) * r, -0.04, Math.sin(a0) * r);
    const p10 = V(Math.cos(a1) * r, -0.04, Math.sin(a1) * r);
    const p01 = V(Math.cos(a0) * r * 0.7, top, Math.sin(a0) * r * 0.7);
    const p11 = V(Math.cos(a1) * r * 0.7, top, Math.sin(a1) * r * 0.7);
    s.quad(p00, p01, p11, p10, col);
  }
}

/**
 * One tier (v3 conifer3): a zigzag skirt of n points, an optional mid ring
 * pulled in so the profile flares, and an apex. Smooth normals around the cone.
 */
function addTier(s: Soup, t: Tier, n: number, phase: number, patchTier: boolean) {
  const h = t.y1 - t.y0;
  const ringY = t.y0 + h * 0.34;
  const ringR = t.r * 0.52;
  const skirt: THREE.Vector3[] = [];
  const skirtN: THREE.Vector3[] = [];
  const mid: THREE.Vector3[] = [];
  const midN: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const long = i % 2 === 0;
    const r = long ? t.r : t.r * 0.8;
    // Lower tiers droop at the long points.
    const y = long ? t.y0 - 0.02 : t.y0 + 0.024;
    skirt.push(V(Math.cos(a) * r, y, Math.sin(a) * r));
    skirtN.push(V(Math.cos(a), 0.55, Math.sin(a)).normalize());
    mid.push(V(Math.cos(a) * ringR, ringY, Math.sin(a) * ringR));
    midN.push(V(Math.cos(a), ringR / (t.y1 - ringY) + 0.25, Math.sin(a)).normalize());
  }
  const ySkirt = coniferGradient(t.y0).multiplyScalar(0.74);
  const yMid = coniferGradient(ringY);
  const yTip = coniferGradient(t.y1).multiplyScalar(1.1);
  const apex = V(0, t.y1, 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const aMid = phase + ((i + 0.5) / n) * Math.PI * 2;
    const apexN = V(Math.cos(aMid), 0.9, Math.sin(aMid)).normalize();
    // The dead patch: one side of one tier.
    s.patch = patchTier && Math.cos(aMid - 0.6) > 0.35 ? 1 : 0;
    if (t.ring) {
      s.vert(skirt[i], skirtN[i], ySkirt);
      s.vert(mid[j], midN[j], yMid);
      s.vert(skirt[j], skirtN[j], ySkirt);
      s.vert(skirt[i], skirtN[i], ySkirt);
      s.vert(mid[i], midN[i], yMid);
      s.vert(mid[j], midN[j], yMid);
      s.vert(mid[i], midN[i], yMid);
      s.vert(apex, apexN, yTip);
      s.vert(mid[j], midN[j], yMid);
    } else {
      s.vert(skirt[i], skirtN[i], ySkirt);
      s.vert(apex, apexN, yTip);
      s.vert(skirt[j], skirtN[j], ySkirt);
    }
  }
  s.patch = 0;
}

function conifer(tiers: Tier[], sides: number, morph: MorphFn | null, patchTier = 1): Soup {
  const s = new Soup();
  s.morph = morph;
  addTrunk(s, 0.04, tiers[0].y0 + 0.06, TRUNK);
  tiers.forEach((t, i) => addTier(s, t, sides, i * 0.4, i === patchTier));
  return s;
}

const SPRUCE: Tier[] = [
  { y0: 0.12, y1: 0.58, r: R0, ring: true },
  { y0: 0.36, y1: 0.82, r: R0 * 0.78, ring: true },
  { y0: 0.6, y1: 1.0, r: R0 * 0.5, ring: false },
];
const YOUNG: Tier[] = [
  { y0: 0.03, y1: 0.66, r: R0, ring: true },
  { y0: 0.42, y1: 1.0, r: R0 * 0.66, ring: false },
];
const SPIRE: Tier[] = [
  { y0: 0.14, y1: 0.48, r: R0, ring: true },
  { y0: 0.32, y1: 0.66, r: R0 * 0.8, ring: true },
  { y0: 0.5, y1: 0.84, r: R0 * 0.6, ring: false },
  { y0: 0.68, y1: 1.0, r: R0 * 0.4, ring: false },
];
const HERO: Tier[] = [
  { y0: 0.1, y1: 0.44, r: R0 * 1.02, ring: true },
  { y0: 0.26, y1: 0.6, r: R0 * 0.86, ring: true },
  { y0: 0.42, y1: 0.75, r: R0 * 0.7, ring: true },
  { y0: 0.58, y1: 0.89, r: R0 * 0.53, ring: true },
  { y0: 0.72, y1: 1.0, r: R0 * 0.36, ring: false },
];

function coniferLod1(): Soup {
  const s = new Soup();
  s.morph = toEnvelope(pyrEnvelope);
  LOD1_TIERS.forEach((t, i) => addTier(s, t, 7, i * 0.5, false));
  return s;
}

function pyramid(): Soup {
  const s = new Soup();
  const n = 3;
  const apex = V(0, 1, 0);
  const base = coniferGradient(0.2).multiplyScalar(0.8);
  const tip = coniferGradient(0.95);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p0 = V(Math.cos(a0) * PYR_R, PYR_Y0 - 0.06, Math.sin(a0) * PYR_R);
    const p1 = V(Math.cos(a1) * PYR_R, PYR_Y0 - 0.06, Math.sin(a1) * PYR_R);
    const am = (a0 + a1) / 2;
    const nn = V(Math.cos(am), 0.5, Math.sin(am)).normalize();
    s.vert(p0, nn, base);
    s.vert(apex, V(0, 1, 0), tip);
    s.vert(p1, nn, base);
  }
  return s;
}

/** T4 snag: a bare grey trunk and two stubs (14 tris); LOD1 a 3-sided trunk (6 tris). */
function snag(lod: 0 | 1): Soup {
  const s = new Soup();
  const low = C("#58544c");
  const high = C("#8a857a");
  const sides = lod === 0 ? 5 : 3;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const r0 = 0.035;
    const r1 = 0.008;
    s.flat(V(Math.cos(a0) * r0, -0.04, Math.sin(a0) * r0), V(Math.cos(a0) * r1, 1, Math.sin(a0) * r1), V(Math.cos(a1) * r1, 1, Math.sin(a1) * r1), [low, high, high]);
    s.flat(V(Math.cos(a0) * r0, -0.04, Math.sin(a0) * r0), V(Math.cos(a1) * r1, 1, Math.sin(a1) * r1), V(Math.cos(a1) * r0, -0.04, Math.sin(a1) * r0), [low, high, low]);
  }
  if (lod === 0) {
    for (const [y, a, l] of [
      [0.55, 0.4, 0.16],
      [0.74, 2.6, 0.12],
    ] as const) {
      const d = V(Math.cos(a), 0.35, Math.sin(a)).normalize();
      const b0 = V(0, y, 0);
      const tip = b0.clone().addScaledVector(d, l);
      const side = V(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.012);
      s.flat(b0.clone().add(side), tip, b0.clone().sub(side), high);
      s.flat(b0.clone().sub(side), tip, b0.clone().add(side), high);
    }
  }
  return s;
}

/** T5 aspen LOD0: trunk + 2 bent-normal lobes (46 tris). LOD1: one lobe (20 tris). */
const ASPEN_LOW = C("#4a5530");
const ASPEN_TOP = C("#8f8b54");
const ASPEN_C1 = V(0, 0.64, 0);
const ASPEN_R1 = V(0.32, 0.36, 0.32);
function aspenCol(v: THREE.Vector3, d: THREE.Vector3): THREE.Color {
  return ASPEN_LOW.clone().lerp(ASPEN_TOP, smooth(0.3, 0.98, v.y) * (0.7 + 0.3 * (d.y * 0.5 + 0.5)));
}
function aspen(lod: 0 | 1): Soup {
  const s = new Soup();
  if (lod === 0) {
    s.morph = (p) => {
      if (p.y < 0.36 && hyp(p.x, p.z) < 0.06) return p.clone();
      const d = p.clone().sub(ASPEN_C1);
      const len = hyp(d.x / ASPEN_R1.x, d.y / ASPEN_R1.y, d.z / ASPEN_R1.z) || 1;
      return ASPEN_C1.clone().add(d.divideScalar(len));
    };
    addTrunk(s, 0.035, 0.42, C("#8c8778"));
    s.lobe(V(0, 0.58, 0), V(0.28, 0.27, 0.28), aspenCol);
    s.lobe(V(0.07, 0.8, -0.05), V(0.19, 0.2, 0.19), aspenCol);
  } else {
    s.morph = toEnvelope(pyrEnvelope);
    s.lobe(ASPEN_C1, ASPEN_R1, aspenCol);
  }
  return s;
}

/** T6 shrub: squashed icosahedron (20 tris); LOD1 an octahedron (8 tris). */
const SHRUB_LOW = C("#34412e");
const SHRUB_TOP = C("#666b43");
function shrub(lod: 0 | 1): Soup {
  const s = new Soup();
  const c = V(0, 0.42, 0);
  const r = V(0.3, 0.46, 0.3);
  const col = (v: THREE.Vector3) => SHRUB_LOW.clone().lerp(SHRUB_TOP, smooth(0.0, 0.9, v.y));
  if (lod === 0) {
    s.morph = (p) => {
      const d = p.clone().sub(c);
      const k = Math.abs(d.x / r.x) + Math.abs(d.y / r.y) + Math.abs(d.z / r.z) || 1;
      return c.clone().add(d.divideScalar(k));
    };
    s.lobe(c, r, col);
  } else {
    const oct = new THREE.OctahedronGeometry(1, 0);
    const p = oct.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const d = V(p.getX(i), p.getY(i), p.getZ(i));
      const v = V(c.x + d.x * r.x, c.y + d.y * r.y, c.z + d.z * r.z);
      s.vert(v, d.clone().normalize(), col(v));
    }
    oct.dispose();
  }
  return s;
}

// ── The magic kit (4.2) ─────────────────────────────────────────────────────

/** Glow colours in linear, under 1.2 so the hue survives ACES (6, a6). */
const TEAL = new THREE.Color(0.25, 0.84, 0.78);
const CYAN = new THREE.Color(0.5, 0.9, 1.05);
const VIOLET = new THREE.Color(0.66, 0.42, 0.95);
const MAGIC_BARK = C("#1d1f26");
const MAGIC_LEAF_LOW = C("#141c24");
const MAGIC_LEAF_TOP = C("#27353a");

/** M2 lantern willow: bent trunk, dome crown, hanging strands with tip bulbs. LOD0 ~120, LOD1 ~40, LOD2 8. */
function willow(lod: 0 | 1 | 2): Soup {
  const s = new Soup();
  const domeC = V(0.06, 0.74, 0);
  const domeR = V(0.36, 0.2, 0.36);
  const leaf = (v: THREE.Vector3, d: THREE.Vector3) => MAGIC_LEAF_LOW.clone().lerp(MAGIC_LEAF_TOP, smooth(-0.6, 0.9, d.y));
  if (lod === 2) {
    const oct = new THREE.OctahedronGeometry(1, 0);
    const p = oct.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const d = V(p.getX(i), p.getY(i), p.getZ(i));
      s.vert(V(domeC.x + d.x * domeR.x, domeC.y + d.y * domeR.y * 1.6 - 0.1, domeC.z + d.z * domeR.z), d.clone().normalize(), leaf(d, d), d.y < -0.3 ? TEAL.clone().multiplyScalar(0.5) : null);
    }
    oct.dispose();
    return s;
  }
  // Trunk: two bent segments, 4 sides.
  const pts = [V(0, -0.04, 0), V(0.05, 0.36, 0.01), V(0.06, 0.66, 0)];
  const sides = lod === 0 ? 4 : 3;
  for (let k = 0; k < pts.length - 1; k++) {
    const r0 = 0.045 * (1 - k * 0.35);
    const r1 = 0.045 * (1 - (k + 1) * 0.35);
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const A = pts[k];
      const B = pts[k + 1];
      s.quad(
        V(A.x + Math.cos(a0) * r0, A.y, A.z + Math.sin(a0) * r0),
        V(B.x + Math.cos(a0) * r1, B.y, B.z + Math.sin(a0) * r1),
        V(B.x + Math.cos(a1) * r1, B.y, B.z + Math.sin(a1) * r1),
        V(A.x + Math.cos(a1) * r0, A.y, A.z + Math.sin(a1) * r0),
        MAGIC_BARK,
      );
    }
  }
  // Dome: underside faintly teal.
  s.lobe(domeC, domeR, leaf, 0, (_v, d) => (d.y < -0.2 ? TEAL.clone().multiplyScalar(0.28) : null));
  // Strands: a 2-tri ribbon each, from the dome's rim down; tip bulb (tetra, 4 tris) on LOD0.
  const n = lod === 0 ? 14 : 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const rr = domeR.x * (0.75 + 0.2 * ((i * 7) % 3) / 2);
    const x = domeC.x + Math.cos(a) * rr;
    const z = domeC.z + Math.sin(a) * rr;
    const top = domeC.y - 0.06;
    const len = 0.28 + 0.18 * (((i * 5) % 4) / 3);
    const bot = top - len;
    const w = 0.012;
    const sx = -Math.sin(a) * w;
    const sz = Math.cos(a) * w;
    const dark = MAGIC_LEAF_LOW;
    const glowTop = TEAL.clone().multiplyScalar(0.15);
    const glowBot = TEAL.clone().multiplyScalar(1.1);
    s.flat(V(x - sx, top, z - sz), V(x - sx * 0.3, bot, z - sz * 0.3), V(x + sx, top, z + sz), [dark, dark, dark], [glowTop, glowBot, glowTop]);
    s.flat(V(x + sx, top, z + sz), V(x - sx * 0.3, bot, z - sz * 0.3), V(x + sx * 0.3, bot, z + sz * 0.3), [dark, dark, dark], [glowTop, glowBot, glowBot]);
    if (lod === 0) {
      const b = 0.022;
      const c0 = V(x, bot - b, z);
      const bulb = [V(x, bot - b * 2.2, z), V(x + b, bot, z), V(x - b * 0.5, bot, z + b * 0.87), V(x - b * 0.5, bot, z - b * 0.87)];
      const g = new THREE.Color(0.3, 0.95, 1.0);
      s.glow = g;
      s.flat(bulb[0], bulb[2], bulb[1], g);
      s.flat(bulb[0], bulb[3], bulb[2], g);
      s.flat(bulb[0], bulb[1], bulb[3], g);
      s.flat(bulb[1], bulb[2], bulb[3], g);
      s.glow = null;
      void c0;
    }
  }
  return s;
}

/** M3 glowcap cluster: 5 mushrooms (cap 8 + stem 4 tris) at LOD0, 2 at LOD1. Undersides violet, gills teal. */
function glowcaps(lod: 0 | 1): Soup {
  const s = new Soup();
  const caps: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, 0, 1.0, 0.34],
    [0.26, 0.1, 0.62, 0.22],
    [-0.2, 0.18, 0.5, 0.18],
    [0.08, -0.28, 0.72, 0.24],
    [-0.3, -0.14, 0.38, 0.14],
  ];
  const stemC = C("#b9b2a2");
  const capTop = C("#3a3448");
  const list = lod === 0 ? caps : caps.slice(0, 2);
  for (let k = 0; k < list.length; k++) {
    const [cx, cz, h, r] = list[k];
    // Stem: two crossed quads.
    const w = r * 0.18;
    const top = h * 0.82;
    for (const [dx, dz] of [
      [w, 0],
      [0, w],
    ]) {
      s.flat(V(cx - dx, 0, cz - dz), V(cx + dx, 0, cz + dz), V(cx + dx, top, cz + dz), stemC);
      s.flat(V(cx - dx, 0, cz - dz), V(cx + dx, top, cz + dz), V(cx - dx, top, cz - dz), stemC);
    }
    // Cap: 4-sided cone top + 4 underside tris (gills).
    const apex = V(cx, h, cz);
    const under = V(cx, top + 0.02, cz);
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + k;
      ring.push(V(cx + Math.cos(a) * r, top + 0.03, cz + Math.sin(a) * r));
    }
    const vio = VIOLET.clone().multiplyScalar(k % 2 ? 1.0 : 0.75);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      s.flat(ring[i], apex, ring[j], capTop, [vio.clone().multiplyScalar(0.5), null, vio.clone().multiplyScalar(0.5)]);
      s.flat(ring[j], under, ring[i], capTop, [TEAL, TEAL.clone().multiplyScalar(1.1), TEAL]);
    }
  }
  return s;
}

/** M4 glow fern: 6 fronds of 3 tris and a fiddlehead (LOD0 ~22), 3 fronds of 2 at LOD1. Frond tips teal. */
function glowFern(lod: 0 | 1): Soup {
  const s = new Soup();
  const base = C("#1c2a26");
  const n = lod === 0 ? 6 : 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    const d = V(Math.cos(a), 0, Math.sin(a));
    const sd = V(-d.z, 0, d.x);
    const p0 = V(0, 0.05, 0);
    const p1 = d.clone().multiplyScalar(0.45).setY(0.75);
    const tip = d.clone().multiplyScalar(0.95).setY(0.55);
    const w = 0.12;
    const g0 = TEAL.clone().multiplyScalar(0.08);
    const g1 = TEAL.clone().multiplyScalar(0.45);
    const g2 = TEAL.clone().multiplyScalar(1.05);
    if (lod === 0) {
      s.flat(p0, p1.clone().addScaledVector(sd, w), p1.clone().addScaledVector(sd, -w), base, [g0, g1, g1]);
      s.flat(p1.clone().addScaledVector(sd, -w), p1.clone().addScaledVector(sd, w), tip, base, [g1, g1, g2]);
      s.flat(p1.clone().addScaledVector(sd, w), p1.clone().addScaledVector(sd, -w), tip, base, [g1, g1, g2]);
    } else {
      s.flat(p0, p1.clone().addScaledVector(sd, w), tip, base, [g0, g1, g2]);
      s.flat(p0, tip, p1.clone().addScaledVector(sd, -w), base, [g0, g2, g1]);
    }
  }
  if (lod === 0) {
    const c = V(0.05, 0.62, 0);
    s.glow = CYAN;
    s.flat(V(0, 0.05, 0.03), c, V(0, 0.05, -0.03), base);
    s.flat(V(0, 0.05, -0.03), c, V(0, 0.05, 0.03), base);
    s.glow = null;
  }
  return s;
}

// ── The shader ──────────────────────────────────────────────────────────────

type Hook = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

interface SharedUniforms {
  uTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSwayR: { value: THREE.Vector2 };
  uSwayAmp: { value: number };
  uWeld: { value: THREE.Vector2 };
  uMassTint: { value: THREE.Color };
  uDead: { value: THREE.Color };
  uGustTint: { value: number };
  uRim: { value: number };
  uMagic: { value: number };
}

const VERT_PARS = /* glsl */ `
attribute vec3 aMorph;
attribute float aPatch;
#ifdef MAGIC
attribute vec3 aGlow;
varying vec3 vGlow;
uniform float uMagic;
#endif
uniform float uTime;
uniform vec2 uSwayR;
uniform float uSwayAmp;
uniform vec2 uWeld;
uniform vec3 uMassTint;
uniform vec3 uDead;
uniform float uGustTint;
uniform vec2 uLod;
varying float vFH;
`;

/** After <color_vertex>: instance position, distance, hash; welding; dead patch; the gust band. */
const VERT_COLOR = /* glsl */ `
#include <color_vertex>
vec3 fIp = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;
float fCd = distance( fIp, cameraPosition );
float fHash = fract( sin( dot( fIp.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
float fGust;
{
  float g1 = sin( dot( fIp.xz, vec2( 0.0021, 0.0013 ) ) - uTime * 0.55 );
  float g2 = sin( dot( fIp.xz, vec2( -0.0009, 0.0031 ) ) - uTime * 0.23 + 1.7 );
  fGust = smoothstep( 0.35, 1.0, 0.6 * g1 + 0.4 * g2 );
}
#if defined( USE_INSTANCING_COLOR ) && defined( USE_COLOR )
  vColor.rgb = color.rgb * mix( instanceColor.rgb, uMassTint, smoothstep( uWeld.x, uWeld.y, fCd ) );
#endif
#ifdef USE_COLOR
  vColor.rgb = mix( vColor.rgb, uDead, aPatch * step( fHash, 0.15 ) );
  vColor.rgb *= 1.0 + uGustTint * fGust * smoothstep( 0.35, 1.0, position.y );
#endif
#ifdef MAGIC
  {
    float per = mix( 3.0, 6.0, fHash );
    float amp = mix( 0.3, 0.5, fract( fHash * 7.13 ) );
    vGlow = aGlow * uMagic * ( 1.0 - amp + amp * ( 0.5 + 0.5 * sin( uTime * 6.2832 / per + fHash * 40.0 ) ) );
  }
#endif
`;

/** After <begin_vertex>: the geomorph, then the near sway (weighted by height). */
const VERT_BEGIN = /* glsl */ `
#include <begin_vertex>
transformed = mix( transformed, aMorph, smoothstep( uLod.x, uLod.y, fCd ) );
vFH = position.y;
{
  float amp = uSwayAmp * ( 1.0 - smoothstep( uSwayR.x, uSwayR.y, fCd ) );
  if ( amp > 0.0 ) {
    float k = max( position.y - 0.08, 0.0 );
    k *= k;
    float w = sin( uTime * 1.5 + fHash * 6.2832 ) * 0.65 + sin( uTime * 2.6 + fHash * 11.0 ) * 0.35 + fGust * 0.8;
    transformed.x += amp * k * w;
    transformed.z += amp * k * w * 0.55;
  }
}
`;

const FRAG_PARS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uRim;
varying float vFH;
#ifdef MAGIC
varying vec3 vGlow;
#endif
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
#ifdef MAGIC
totalEmissiveRadiance += vGlow;
#endif
`;

/** v3's warm rim: edges turned from the camera toward the sun, strongest back-lit and at the tips. */
const FRAG_RIM = /* glsl */ `
{
  vec3 Vv = normalize( vViewPosition );
  vec3 Nn = normalize( normal );
  vec3 Sv = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
  float back = max( dot( -Vv, Sv ), 0.0 );
  float edge = pow( 1.0 - clamp( abs( dot( Nn, Vv ) ), 0.0, 1.0 ), 2.2 );
  float toSun = smoothstep( -0.15, 0.7, dot( Nn, Sv ) );
  float tip = 0.3 + 0.7 * smoothstep( 0.2, 1.0, vFH );
  outgoingLight += uSunColor * uRim * edge * toSun * ( 0.3 + 0.7 * back ) * tip * ( diffuseColor.rgb * 2.2 + 0.03 );
}
#include <opaque_fragment>
`;

function foliageHook(u: SharedUniforms, lod: { value: THREE.Vector2 }): Hook {
  return (shader) => {
    Object.assign(shader.uniforms, u, { uLod: lod });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      .replace("#include <color_vertex>", VERT_COLOR)
      .replace("#include <begin_vertex>", VERT_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_PARS)
      .replace("#include <emissivemap_fragment>", FRAG_EMISSIVE)
      .replace("#include <opaque_fragment>", FRAG_RIM);
  };
}

/** v3: install `mine` so a later onBeforeCompile assignment (a fog or grade patch) runs after it instead of replacing it. */
function chainCompileHook(mat: THREE.Material, key: string, mine: Hook) {
  let extra: Hook | null = null;
  let inside = false;
  const combined: Hook = (shader, renderer) => {
    if (inside) return;
    inside = true;
    try {
      mine(shader, renderer);
      if (extra) extra(shader, renderer);
    } finally {
      inside = false;
    }
  };
  Object.defineProperty(mat, "onBeforeCompile", {
    configurable: true,
    enumerable: true,
    get: () => combined,
    set: (fn: Hook) => {
      if (fn !== combined) extra = fn;
    },
  });
  mat.customProgramCacheKey = () => `forest-v5|${key}|${extra ? extra.toString() : ""}`;
}

// ── Terrain sampling ────────────────────────────────────────────────────────

/** Height on the scene's main terrain grid, triangle-exact to its index winding (scene.addTerrain). */
function makeHeight(ctx: WorldCtx): (x: number, z: number) => number {
  const W = WORLD.maxX - WORLD.minX;
  const D = WORLD.maxZ - WORLD.minZ;
  const cell = Math.max(W, D) / 320;
  const nx = Math.max(2, Math.round(W / cell));
  const nz = Math.max(2, Math.round(D / cell));
  const sx = W / nx;
  const sz = D / nz;
  const vx = nx + 1;
  const vz = nz + 1;
  let hts: Float32Array | null = null;
  const mesh = ctx.root.getObjectByName("Terrain") as THREE.Mesh | undefined;
  const pos = mesh?.geometry?.getAttribute("position");
  if (pos && pos.count === vx * vz) {
    hts = new Float32Array(vx * vz);
    for (let k = 0; k < vx * vz; k++) hts[k] = pos.getY(k);
  }
  if (!hts) return (x, z) => ctx.terrainHeight(x, z);
  const H = hts;
  return (x, z) => {
    const fi = (x - WORLD.minX) / sx;
    const fj = (z - WORLD.minZ) / sz;
    if (fi < 0 || fj < 0 || fi >= nx || fj >= nz) return ctx.terrainHeight(x, z);
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;
    const a = H[j * vx + i];
    const b = H[j * vx + i + 1];
    const c = H[(j + 1) * vx + i];
    const e = H[(j + 1) * vx + i + 1];
    // Triangles (a, c, b) and (b, c, e), diagonal b-c.
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : e + (c - e) * (1 - u) + (b - e) * (1 - v);
  };
}

// ── Grids of distance and clearance ─────────────────────────────────────────

class Grid {
  nx: number;
  nz: number;
  a: Float32Array;
  constructor(fill: number) {
    this.nx = Math.ceil((ROI.maxX - ROI.minX) / G);
    this.nz = Math.ceil((ROI.maxZ - ROI.minZ) / G);
    this.a = new Float32Array(this.nx * this.nz).fill(fill);
  }
  idx(x: number, z: number): number {
    const i = Math.floor((x - ROI.minX) / G);
    const j = Math.floor((z - ROI.minZ) / G);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }
  get(x: number, z: number, dflt: number): number {
    const k = this.idx(x, z);
    return k < 0 ? dflt : this.a[k];
  }
  /** Min distance to segment a-b, written into cells within R. */
  segment(ax: number, az: number, bx: number, bz: number, R: number) {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - ROI.minX) / G));
    const i1 = Math.min(this.nx - 1, Math.floor((Math.max(ax, bx) + R - ROI.minX) / G));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R - ROI.minZ) / G));
    const j1 = Math.min(this.nz - 1, Math.floor((Math.max(az, bz) + R - ROI.minZ) / G));
    const dx = bx - ax;
    const dz = bz - az;
    const L2s = dx * dx + dz * dz || 1;
    for (let j = j0; j <= j1; j++) {
      const z = ROI.minZ + (j + 0.5) * G;
      for (let i = i0; i <= i1; i++) {
        const x = ROI.minX + (i + 0.5) * G;
        const u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2s));
        const d = hyp(x - ax - dx * u, z - az - dz * u);
        const k = j * this.nx + i;
        if (d < this.a[k]) this.a[k] = d;
      }
    }
  }
  polyline(pts: ReadonlyArray<readonly [number, number, number]>, R: number) {
    for (let i = 0; i < pts.length - 1; i++) this.segment(pts[i][0], pts[i][2], pts[i + 1][0], pts[i + 1][2], R);
  }
}

// ── Install ─────────────────────────────────────────────────────────────────

interface Slot {
  mesh: THREE.InstancedMesh;
  mat: Float32Array;
  col: Float32Array;
  cap: number;
  count: number;
  tris: number;
}

export const install: InstallFn = async (ctx: WorldCtx): Promise<WorldModule> => {
  const tStart = performance.now();
  const times: Record<string, number> = {};
  let lapT = performance.now();
  const lap = (name: string) => {
    const now = performance.now();
    times[name] = Math.round(now - lapT);
    lapT = now;
  };

  const hAt = makeHeight(ctx);
  const normalY = (x: number, z: number) => {
    const e = 14;
    const gx = (hAt(x + e, z) - hAt(x - e, z)) / (2 * e);
    const gz = (hAt(x, z + e) - hAt(x, z - e)) / (2 * e);
    return 1 / Math.sqrt(1 + gx * gx + gz * gz);
  };

  // Distance grids: the path on the ground, the water lines.
  const pathD = new Grid(999);
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i];
    const b = PATH[i + 1];
    if (a.under || a.y > 1000 || b.y > 1000) continue;
    pathD.segment(a.x, a.z, b.x, b.z, 60);
  }
  const brookD = new Grid(999);
  brookD.polyline(BROOK, 60);
  brookD.polyline(STREAM, 60);
  const riverD = new Grid(999);
  riverD.polyline(RIVER, 120);

  // The rail: the camera's lowest height near each cell, and the distance to it with the camera's height over the ground there.
  const camMinY = new Grid(1e9);
  const railD = new Grid(999);
  const railAbove = new Grid(1e9);
  const curve = new THREE.CatmullRomCurve3(TRAIL.map((q) => new THREE.Vector3(q[0], q[1], q[2])), false, "centripetal");
  const nK = TRAIL.length - 1;
  const GROUND_KINDS: readonly TrailKind[] = ["walk", "dive", "rise", "climb"];
  const NS = 3200;
  const p = new THREE.Vector3();
  for (let s = 0; s <= NS; s++) {
    const t = s / NS;
    const kind = TRAIL_KIND[Math.min(nK - 1, Math.floor(t * nK))];
    if (!GROUND_KINDS.includes(kind)) continue;
    curve.getPoint(t, p);
    if (p.x < ROI.minX || p.x > ROI.maxX || p.z < ROI.minZ || p.z > ROI.maxZ) continue;
    const above = p.y - hAt(p.x, p.z);
    const i0 = Math.max(0, Math.floor((p.x - HERO_R - ROI.minX) / G));
    const i1 = Math.min(railD.nx - 1, Math.floor((p.x + HERO_R - ROI.minX) / G));
    const j0 = Math.max(0, Math.floor((p.z - HERO_R - ROI.minZ) / G));
    const j1 = Math.min(railD.nz - 1, Math.floor((p.z + HERO_R - ROI.minZ) / G));
    for (let j = j0; j <= j1; j++) {
      const z = ROI.minZ + (j + 0.5) * G;
      for (let i = i0; i <= i1; i++) {
        const x = ROI.minX + (i + 0.5) * G;
        const d = hyp(x - p.x, z - p.z);
        const k = j * railD.nx + i;
        if (d < railD.a[k]) {
          railD.a[k] = d;
          railAbove.a[k] = above;
        }
        if (d < CAM_R && p.y < camMinY.a[k]) camMinY.a[k] = p.y;
      }
    }
  }
  lap("grids");
  await yieldTask();

  // Stop sight lines (walk stops on the ground): camera -> landmark base.
  const sights: { cx: number; cy: number; cz: number; lx: number; ly: number; lz: number }[] = [];
  for (const i of [0, 1, 4]) {
    const pl = PLACES[i];
    const c = TRAIL[pl.trail];
    sights.push({ cx: c[0], cy: c[1], cz: c[2], lx: pl.pos.x, ly: pl.pos.y + pl.height * 0.25, lz: pl.pos.z });
  }
  const a5cam = TRAIL[PLACES[4].trail];
  const lookout = PLACES[1].pos;
  const signpost = PLACES[0].pos;
  const Fo = WORLD.forest;
  const lake = WORLD.lake;
  const pool = WORLD.pool;
  const jettyFoot = PATH.find((q) => Math.abs(q.x - 1350) < 1 && Math.abs(q.z + 440) < 1) ?? { x: 1350, z: -440 };
  // The open stops' pockets (2.1.6): denser, taller trees 150-400 round the landmark.
  const pockets = [PLACES[0].pos, PLACES[1].pos, PLACES[4].pos];

  /** Tallest tree allowed at (x, z) on ground g, from the rail clearance and the stops' sight lines. */
  const maxTreeH = (x: number, z: number, g: number): number => {
    let m = camMinY.get(x, z, 1e9) - CAM_GAP - g;
    for (const s of sights) {
      const dx = s.lx - s.cx;
      const dz = s.lz - s.cz;
      const L = hyp(dx, dz);
      const u = ((x - s.cx) * dx + (z - s.cz) * dz) / (L * L);
      if (u < 0 || u > 1.05) continue;
      const lat = Math.abs((x - s.cx) * dz - (z - s.cz) * dx) / L;
      if (lat > 14 + u * 45) continue;
      const lineY = s.cy + (s.ly - s.cy) * Math.min(1, u);
      m = Math.min(m, lineY - 6 - g);
    }
    return m;
  };

  /** Density mask 0..1 before zone multipliers, and the clump value. */
  const inA5View = (x: number, z: number) => {
    const dx = x - a5cam[0];
    const dz = z - a5cam[2];
    if (dx * dx + dz * dz > 720 * 720) return false;
    let a = (Math.atan2(dx, -dz) * 180) / Math.PI - 297;
    a -= 360 * Math.round(a / 360);
    return Math.abs(a) < 22;
  };

  // Candidates.
  const nxC = Math.floor((ROI.maxX - ROI.minX) / CELL);
  const nzC = Math.floor((ROI.maxZ - ROI.minZ) / CELL);
  const cand: number[] = []; // x, z, g, weight, clump, zone, capH, ledge
  let wSum = 0;
  for (let j = 0; j < nzC; j++) {
    for (let i = 0; i < nxC; i++) {
      const x = ROI.minX + (i + 0.5 + (hash2(i, j, 1) - 0.5) * 0.9) * CELL;
      const z = ROI.minZ + (j + 0.5 + (hash2(i, j, 2) - 0.5) * 0.9) * CELL;
      const pd = pathD.get(x, z, 999);
      if (pd < 15) continue;
      const g = hAt(x, z);
      if (g < 6 || g > 1060) continue;
      const dl = hyp(x - lake.x, z - lake.z);
      if (dl < lake.r + 22) continue;
      const dF = hyp(x - Fo.x, z - Fo.z);
      if (dF < Fo.r + 30) continue;
      if (hyp(x - pool.x, z - pool.z) < pool.r + 90) continue;
      if (hyp(x - SHAFT.x, z - SHAFT.z) < 70) continue;
      if (hyp(x - WORLD.falls.top[0], z - WORLD.falls.top[2]) < 90) continue;
      const bd = brookD.get(x, z, 999);
      if (bd < 18) continue;
      const rd = riverD.get(x, z, 999);
      if (rd < 50) continue;
      if (inA5View(x, z)) continue;
      const clump = fbm(x / 300, z / 300, 11);
      // In the open stops' pockets (below) the clump gaps close by a third, so
      // the ring round a1's signpost and a2's lookout reads as a wall of trees:
      // with the plain cut a1's right half was one empty meadow (27% trees + rocks).
      let pkRing = 0;
      for (const pk of pockets) {
        const d = hyp(x - pk.x, z - pk.z);
        pkRing = Math.max(pkRing, smooth(130, 190, d) * (1 - smooth(420, 520, d)));
      }
      const clumpCut = 0.38 - 0.1 * pkRing;
      if (clump < clumpCut) continue;
      const ny = normalY(x, z);
      // Ledges in the gorge and on the rim (Z3) keep spires on steeper ground.
      const ledge = ny < 0.72 && ny >= 0.6 && hyp(x - ZONES[2].x, z - ZONES[2].z) < ZONES[2].r;
      if (ny < 0.72 && !ledge) continue;
      const fine = fbm(x / 70, z / 70, 23);
      let m = smooth(6, 18, g) * (1 - smooth(880, 1060, g)) * (ledge ? 0.55 : smooth(0.72, 0.84, ny));
      m *= smooth(15, 34, pd) * smooth(18, 38, bd) * smooth(50, 90, rd) * smooth(lake.r + 22, lake.r + 70, dl);
      // Densest on mid slopes.
      m *= 0.85 + 0.35 * smooth(0.99, 0.9, ny);
      m *= Math.min(1.25, 0.7 + 0.6 * fine);
      // Landmark clearings.
      const dS = hyp(x - signpost.x, z - signpost.z);
      if (dS < 70) continue;
      const dJ = hyp(x - jettyFoot.x, z - jettyFoot.z);
      if (dJ < 50) continue;
      const dCamp = hyp(x - (lookout.x + 45), z - (lookout.z + 35));
      if (dCamp < 135 * (0.8 + 0.4 * fine)) continue;
      m *= smooth(135, 190, dCamp);
      // Pockets: a ring of denser trees round the open stops' landmarks.
      for (const pk of pockets) {
        const d = hyp(x - pk.x, z - pk.z);
        m *= 1 + 0.6 * smooth(120, 200, d) * (1 - smooth(380, 480, d));
      }
      if (m <= 0.01) continue;
      // Zone.
      let zi = -1;
      let best = 1;
      for (let q = 0; q < ZONES.length; q++) {
        const Z = ZONES[q];
        const dd = hyp(x - Z.x, z - Z.z) / Z.r;
        if (dd < best) {
          best = dd;
          zi = q;
        }
      }
      const Z = zi >= 0 ? ZONES[zi] : BACKDROP;
      // The backdrop thins with distance from the rail.
      const far = zi >= 0 ? 1 : 1 - 0.5 * smooth(1500, 3500, railD.get(x, z, 3500));
      const clumpK = smooth(clumpCut, clumpCut + 0.18, clump);
      const w = m * Z.mult * far * clumpK;
      let capH = maxTreeH(x, z, g);
      // Outside the clear basin the cloud sheet sits at cloudLevel: no tip may poke through it.
      const CC = WORLD.cloudClear;
      if (hyp(x - CC.x, z - CC.z) > CC.r - 150) capH = Math.min(capH, WORLD.cloudLevel - 40 - g);
      if (dS < 170) capH = Math.min(capH, 12);
      const dLook = hyp(x - lookout.x, z - lookout.z);
      if (dLook < 180) capH = Math.min(capH, 43);
      if (w > 0.005) {
        cand.push(x, z, g, w, clump, zi, capH, ledge ? 1 : 0);
        wSum += w;
      }
    }
  }
  lap("candidates");
  await yieldTask();

  // Sample: scale so the kept count lands on TARGET_WILD.
  const K = TARGET_WILD / Math.max(1, wSum);
  const rand = mulberry32(7);
  const recs: number[] = []; // species, x, y, z, h, w, yaw, leanAx, lean, tint
  const TINTS = [
    [1, 1, 1],
    [0.92, 0.97, 0.99],
    [1.05, 1.03, 0.94],
    [0.95, 0.94, 1.0],
    [1.08, 1.06, 0.95],
  ];
  const heroCand: number[] = [];
  const counts = new Array(NSP).fill(0);
  const zoneCounts: Record<string, number> = {};
  for (let c = 0; c < cand.length; c += 8) {
    const [x, z, g, w, clump, zi, capH, isLedge] = [cand[c], cand[c + 1], cand[c + 2], cand[c + 3], cand[c + 4], cand[c + 5], cand[c + 6], cand[c + 7]];
    const Z = zi >= 0 ? ZONES[zi] : BACKDROP;
    let sp: number;
    if (isLedge) {
      // A ledge: spires only.
      if (rand() > Math.min(1, w * K)) continue;
      sp = T3;
    } else {
      if (rand() > Math.min(1, w * K)) continue;
      // Species by the zone's mix; young spruce and shrubs lean to the clump's edge.
      const edge = 1 - smooth(0.45, 0.62, clump);
      const r = rand();
      const mix = Z.mix;
      if (rand() < edge * 0.35) sp = T2;
      else if (r < mix[0]) sp = T1;
      else if (r < mix[0] + mix[1]) sp = T2;
      else if (r < mix[0] + mix[1] + mix[2]) sp = T3;
      else if (r < mix[0] + mix[1] + mix[2] + mix[3]) sp = T4;
      else sp = mix[4] > 0 ? T5 : T1;
      // Aspens stay in the lowlands.
      if (sp === T5 && g > 750) sp = T1;
    }
    // Scale: 1.0 in a clump's core, 0.6 at its edge; plus variety.
    const core = 0.6 + 0.4 * smooth(0.42, 0.72, clump);
    const [h0, h1] = H_RANGE[sp];
    let h = (h0 + (h1 - h0) * rand()) * (sp === T6 ? 1 : core * (0.9 + 0.2 * rand()));
    // Pocket trees round the stops are the tallest.
    for (const pk of pockets) {
      const d = hyp(x - pk.x, z - pk.z);
      if (d > 150 && d < 420 && sp !== T6) h *= 1.1;
    }
    // Forced perspective: the far lake shore at 0.75 (a5).
    if (zi === 4 && hyp(x - a5cam[0], z - a5cam[2]) > 950) h *= 0.75;
    if (h > capH) {
      if (capH < h0 * 0.7 && sp !== T6) {
        if (capH < H_RANGE[T6][0]) continue;
        sp = T6;
        h = Math.min(capH, H_RANGE[T6][0] + rand() * 4);
      } else h = Math.max(4, capH);
    }
    const idx = recs.length / 10;
    const width = WIDTH[sp] * (0.88 + 0.24 * rand());
    recs.push(sp, x, g - 0.035 * h, z, h, width, rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * 0.07, Math.floor(rand() * TINTS.length));
    counts[sp]++;
    const zn = Z.name;
    zoneCounts[zn] = (zoneCounts[zn] ?? 0) + 1;
    if ((sp === T1 || sp === T3) && railD.get(x, z, 999) < HERO_R && railAbove.get(x, z, 1e9) < HERO_ABOVE) heroCand.push(idx, railD.get(x, z, 999));
    // Understory (3.1.5): 2 to 4 shrubs round trees at a clump's edge, as one group.
    if (sp !== T6 && sp !== T4 && clump < 0.56 && rand() < Z.shrub) {
      const n = 2 + Math.floor(rand() * 3);
      const cr = h * R0 * width;
      for (let k = 0; k < n; k++) {
        const a = rand() * Math.PI * 2;
        const d = cr * (0.7 + 0.9 * rand());
        const sx = x + Math.cos(a) * d;
        const sz = z + Math.sin(a) * d;
        if (pathD.get(sx, sz, 999) < 14 || brookD.get(sx, sz, 999) < 16) continue;
        const sg = hAt(sx, sz);
        const sh = H_RANGE[T6][0] + (H_RANGE[T6][1] - H_RANGE[T6][0]) * rand();
        if (sh > capH + g - sg) continue;
        recs.push(T6, sx, sg - 0.1 * sh, sz, sh, WIDTH[T6] * (0.85 + 0.3 * rand()), rand() * Math.PI * 2, 0, 0, Math.floor(rand() * TINTS.length));
        counts[T6]++;
        zoneCounts[zn] = (zoneCounts[zn] ?? 0) + 1;
      }
    }
  }
  // Hero groves: the nearest HERO_MAX spruces and spires to the low rail.
  const heroOrder: [number, number][] = [];
  for (let i = 0; i < heroCand.length; i += 2) heroOrder.push([heroCand[i], heroCand[i + 1]]);
  heroOrder.sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < Math.min(HERO_MAX, heroOrder.length); i++) {
    const r = heroOrder[i][0] * 10;
    counts[recs[r]]--;
    recs[r] = TH;
    counts[TH]++;
  }
  lap("wild");
  await yieldTask();

  // The magic understory in the Glowing Forest.
  const keepClear = (px: number, pz: number, r: number) => {
    for (const [ax, az, bx, bz, hw] of FOREST_KEEP_CLEAR) {
      const dx = bx - ax;
      const dz = bz - az;
      const u = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
      if (hyp(px - ax - dx * u, pz - az - dz * u) < hw + r) return false;
    }
    return true;
  };
  const cl = Fo.clearing;
  const mrand = mulberry32(31);
  const magicTints = [
    [1, 1, 1],
    [0.9, 1.0, 1.1],
    [1.1, 0.95, 1.05],
  ];
  const placeMagic = (sp: number, n: number, pick: () => [number, number] | null, tries: number) => {
    let made = 0;
    for (let t = 0; t < tries && made < n; t++) {
      const q = pick();
      if (!q) continue;
      const [x, z] = q;
      const g = hAt(x, z);
      const [h0, h1] = H_RANGE[sp];
      const h = h0 + (h1 - h0) * mrand();
      if (camMinY.get(x, z, 1e9) - CAM_GAP - g < h) continue;
      recs.push(sp, x, g - 0.03 * h, z, h, WIDTH[sp] * (0.85 + 0.3 * mrand()), mrand() * Math.PI * 2, mrand() * Math.PI * 2, mrand() * 0.05, Math.floor(mrand() * magicTints.length));
      counts[sp]++;
      made++;
    }
  };
  // Willows round the clearing's rim and along the corridors' edges.
  placeMagic(
    M2,
    WILLOWS,
    () => {
      const a = mrand() * Math.PI * 2;
      const ring = mrand() < 0.55;
      const r = ring ? cl.r + 20 + mrand() * 110 : Math.sqrt(mrand()) * Fo.r * 0.95;
      const x = (ring ? cl.x : Fo.x) + Math.cos(a) * r;
      const z = (ring ? cl.z : Fo.z) + Math.sin(a) * r;
      if (hyp(x - Fo.x, z - Fo.z) > Fo.r) return null;
      if (!keepClear(x, z, 22)) return null;
      return [x, z];
    },
    WILLOWS * 12,
  );
  // Glowcaps and ferns carpet the floor, thickest round the clearing and the corridors' edges.
  const floorPick = (edgeBias: number) => (): [number, number] | null => {
    const a = mrand() * Math.PI * 2;
    const r = Math.sqrt(mrand()) * Fo.r;
    const x = Fo.x + Math.cos(a) * r;
    const z = Fo.z + Math.sin(a) * r;
    const dc = hyp(x - cl.x, z - cl.z);
    if (dc < cl.r * 0.55) return null;
    if (!keepClear(x, z, 4)) return null;
    // Favour the clearing's rim and the corridor edges (where the camera looks).
    const nearCorr = keepClear(x, z, 60) ? 0 : 1;
    const nearRim = 1 - smooth(cl.r, cl.r + 260, dc);
    if (mrand() > 0.35 + edgeBias * Math.max(nearCorr, nearRim)) return null;
    return [x, z];
  };
  placeMagic(M3, GLOWCAPS, floorPick(0.65), GLOWCAPS * 8);
  placeMagic(M4, GLOWFERNS, floorPick(0.5), GLOWFERNS * 8);
  lap("magic");
  await yieldTask();

  // ── Build the instanced meshes ──
  const shared: SharedUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: ctx.sunDir.clone().normalize() },
    uSunColor: { value: ctx.sunColor.clone() },
    uSwayR: { value: new THREE.Vector2(SWAY_FULL, SWAY_R) },
    uSwayAmp: { value: ctx.reducedMotion ? 0 : SWAY_AMP },
    uWeld: { value: new THREE.Vector2(WELD_FROM, WELD_TO) },
    uMassTint: { value: new THREE.Color(1, 1, 1) },
    uDead: { value: C("#6a5238") },
    uGustTint: { value: ctx.reducedMotion ? 0 : GUST_TINT },
    uRim: { value: RIM },
    uMagic: { value: 0.9 },
  };
  const makeMat = (name: string, key: string, lodRange: [number, number], magic: boolean) => {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.name = name;
    if (magic) mat.defines = { MAGIC: "" };
    chainCompileHook(mat, key, foliageHook(shared, { value: new THREE.Vector2(lodRange[0], lodRange[1]) }));
    return mat;
  };
  const NO_MORPH: [number, number] = [1e9, 1e9 + 1];
  const matL0 = makeMat("ForestFoliage0", "wild", [0.75 * L1, 0.95 * L1], false);
  const matL1 = makeMat("ForestFoliage1", "wild", [0.75 * L2, 0.95 * L2], false);
  const matL2 = makeMat("ForestFoliage2", "wild", NO_MORPH, false);
  const matMagic = makeMat("ForestMagicKit", "magic", NO_MORPH, true);

  // Geometry per species per LOD; the conifers share LOD1 and everything shares LOD2.
  const coniferMorph = toEnvelope((y) => envelope(LOD1_TIERS, y));
  const geo = {
    spruce0: conifer(SPRUCE, 8, coniferMorph),
    young0: conifer(YOUNG, 8, coniferMorph, 0),
    spire0: conifer(SPIRE, 6, coniferMorph),
    hero0: conifer(HERO, 10, null, 2),
    con1: coniferLod1(),
    pyr: pyramid(),
    snag0: snag(0),
    snag1: snag(1),
    aspen0: aspen(0),
    aspen1: aspen(1),
    shrub0: shrub(0),
    shrub1: shrub(1),
    willow0: willow(0),
    willow1: willow(1),
    willow2: willow(2),
    caps0: glowcaps(0),
    caps1: glowcaps(1),
    fern0: glowFern(0),
    fern1: glowFern(1),
  };
  const kitTris: Record<string, number> = {};
  for (const [k, s] of Object.entries(geo)) kitTris[k] = s.triangles;

  const group = new THREE.Group();
  group.name = "Forest";
  const slots: Slot[] = [];
  const slotOf = new Int16Array(NSP * 3).fill(-1);
  const addSlot = (name: string, soup: Soup, mat: THREE.Material, species: number[], lod: number, magic: boolean) => {
    const cap = Math.max(1, species.reduce((s, sp) => s + counts[sp], 0));
    const g = soup.geometry(magic);
    const mesh = new THREE.InstancedMesh(g, mat, cap);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    const si = slots.length;
    slots.push({ mesh, mat: mesh.instanceMatrix.array as Float32Array, col: mesh.instanceColor.array as Float32Array, cap, count: 0, tris: soup.triangles });
    for (const sp of species) slotOf[sp * 3 + lod] = si;
  };
  // LOD0 meshes are named Forest:* so scene.indexTrees finds them (install fills them with every tree once).
  addSlot("Forest:T1", geo.spruce0, matL0, [T1], 0, false);
  addSlot("Forest:T2", geo.young0, matL0, [T2], 0, false);
  addSlot("Forest:T3", geo.spire0, matL0, [T3], 0, false);
  addSlot("Forest:T4", geo.snag0, matL0, [T4], 0, false);
  addSlot("Forest:T5", geo.aspen0, matL0, [T5], 0, false);
  addSlot("Forest:T6", geo.shrub0, matL0, [T6], 0, false);
  addSlot("Forest:TH", geo.hero0, matL2, [TH], 0, false);
  addSlot("ForestLod1:Conifer", geo.con1, matL1, [T1, T2, T3], 1, false);
  addSlot("ForestLod1:T4", geo.snag1, matL2, [T4], 1, false);
  addSlot("ForestLod1:T5", geo.aspen1, matL1, [T5], 1, false);
  addSlot("ForestLod1:T6", geo.shrub1, matL2, [T6], 1, false);
  addSlot("ForestLod2:All", geo.pyr, matL2, [T1, T2, T3, T5], 2, false);
  addSlot("Forest:M2", geo.willow0, matMagic, [M2], 0, true);
  addSlot("ForestLod1:M2", geo.willow1, matMagic, [M2], 1, true);
  addSlot("ForestLod2:M2", geo.willow2, matMagic, [M2], 2, true);
  addSlot("ForestFloor:M3", geo.caps0, matMagic, [M3], 0, true);
  addSlot("ForestFloorLod1:M3", geo.caps1, matMagic, [M3], 1, true);
  addSlot("ForestFloor:M4", geo.fern0, matMagic, [M4], 0, true);
  addSlot("ForestFloorLod1:M4", geo.fern1, matMagic, [M4], 1, true);

  // ── Per-tree arrays, sorted into culling cells ──
  const N = recs.length / 10;
  const cnx = Math.ceil((ROI.maxX - ROI.minX) / CULL_CELL);
  const cnz = Math.ceil((ROI.maxZ - ROI.minZ) / CULL_CELL);
  const cellOfTree = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const x = recs[i * 10 + 1];
    const z = recs[i * 10 + 3];
    const ci = Math.min(cnx - 1, Math.max(0, Math.floor((x - ROI.minX) / CULL_CELL)));
    const cj = Math.min(cnz - 1, Math.max(0, Math.floor((z - ROI.minZ) / CULL_CELL)));
    cellOfTree[i] = cj * cnx + ci;
  }
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => cellOfTree[a] - cellOfTree[b]);
  const MAT = new Float32Array(N * 16);
  const COL = new Float32Array(N * 3);
  const SPH = new Float32Array(N * 4);
  const SP = new Uint8Array(N);
  const LOD = new Uint8Array(N);
  const cellStart: number[] = [];
  const cellEnd: number[] = [];
  const cellSph: number[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qLean = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const UPV = new THREE.Vector3(0, 1, 0);
  const p3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  let curCell = -1;
  let bx0 = 0, bx1 = 0, by0 = 0, by1 = 0, bz0 = 0, bz1 = 0;
  const closeCell = () => {
    if (curCell < 0) return;
    const cx = (bx0 + bx1) / 2;
    const cy = (by0 + by1) / 2;
    const cz = (bz0 + bz1) / 2;
    cellSph.push(cx, cy, cz, hyp(bx1 - bx0, by1 - by0, bz1 - bz0) / 2 + 5);
  };
  for (let o = 0; o < N; o++) {
    const i = order[o];
    const r = i * 10;
    const sp = recs[r];
    const x = recs[r + 1];
    const y = recs[r + 2];
    const z = recs[r + 3];
    const h = recs[r + 4];
    const w = recs[r + 5];
    qLean.setFromAxisAngle(axis.set(Math.cos(recs[r + 7]), 0, Math.sin(recs[r + 7])), recs[r + 8]);
    q.setFromAxisAngle(UPV, recs[r + 6]).premultiply(qLean);
    m4.compose(p3.set(x, y, z), q, s3.set(h * w, h, h * w));
    MAT.set(m4.elements, o * 16);
    const magic = sp >= M2;
    const t = (magic ? magicTints : TINTS)[recs[r + 9] % (magic ? magicTints.length : TINTS.length)];
    COL[o * 3] = t[0];
    COL[o * 3 + 1] = t[1];
    COL[o * 3 + 2] = t[2];
    SPH[o * 4] = x;
    SPH[o * 4 + 1] = y + h * 0.5;
    SPH[o * 4 + 2] = z;
    SPH[o * 4 + 3] = h * Math.max(0.55, w * R0 * 1.2);
    SP[o] = sp;
    LOD[o] = 0;
    const c = cellOfTree[i];
    if (c !== curCell) {
      if (curCell >= 0) cellEnd.push(o);
      closeCell();
      curCell = c;
      cellStart.push(o);
      bx0 = bx1 = x;
      by0 = y;
      by1 = y + h;
      bz0 = bz1 = z;
    }
    bx0 = Math.min(bx0, x);
    bx1 = Math.max(bx1, x);
    by0 = Math.min(by0, y);
    by1 = Math.max(by1, y + h);
    bz0 = Math.min(bz0, z);
    bz1 = Math.max(bz1, z);
  }
  if (curCell >= 0) {
    cellEnd.push(N);
    closeCell();
  }
  const NC = cellStart.length;

  // Install fill: every tree into its species' LOD0 mesh, so the scene's tree index (run once after install) sees them all.
  for (const s of slots) s.count = 0;
  for (let o = 0; o < N; o++) {
    const si = slotOf[SP[o] * 3];
    if (si < 0) continue;
    const s = slots[si];
    s.mat.set(MAT.subarray(o * 16, o * 16 + 16), s.count * 16);
    s.col.set(COL.subarray(o * 3, o * 3 + 3), s.count * 3);
    s.count++;
  }
  for (const s of slots) {
    s.mesh.count = s.count;
    s.mesh.instanceMatrix.needsUpdate = true;
    if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
    s.mesh.visible = s.count > 0;
  }
  ctx.root.add(group);
  group.updateMatrixWorld(true);

  // The shade and density maps bake in the next task, off the install path; scene.userData.forestMaps appears then.
  let maps: ForestMaps | null = null;
  let mapsMs = -1;
  let disposed = false;
  setTimeout(() => {
    if (disposed) return;
    const t0 = performance.now();
    maps = bakeMaps(recs, (x, z) => railD.get(x, z, 9999) < 2600);
    ctx.scene.userData.forestMaps = maps;
    // Hand both maps to the terrain (surfaces.ts): the baked shade, and the
    // density as the forest floor paint.
    const surf = ctx.scene.userData.surfaces as SurfacesApi | undefined;
    if (surf) {
      const m = maps;
      surf.setShadeTexture(m.shade, { minX: m.origin[0], minZ: m.origin[1], maxX: m.origin[0] + m.size, maxZ: m.origin[1] + m.size });
      surf.setForestMask(densitySampler(m));
    }
    mapsMs = Math.round(performance.now() - t0);
  }, 0);

  // light.ts levels glow materials by userData.lightGlow; this probe reads its magic level back each frame.
  const probeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  probeMat.userData.lightGlow = "magic";
  const probe = new THREE.Mesh(new THREE.BufferGeometry(), probeMat);
  probe.name = "ForestMagicProbe";
  probe.visible = false;
  group.add(probe);
  lap("meshes");

  // ── The frame loop: compaction ──
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const lastCam = new Float32Array(32).fill(NaN);
  const camPos = new THREE.Vector3();
  let firstFrame = true;
  let hidden = false;
  let lastCompactMs = 0;
  let visibleTrees = 0;
  let nearTrees = 0;
  const lodCounts = [0, 0, 0];
  const planes = new Float32Array(24);

  const kindAt = (u: number): TrailKind => TRAIL_KIND[Math.min(nK - 1, Math.max(0, Math.floor(u * nK)))];

  const compact = () => {
    const t0 = performance.now();
    const cam = ctx.camera;
    cam.getWorldPosition(camPos);
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    for (let k = 0; k < 6; k++) {
      const pl = frustum.planes[k];
      planes[k * 4] = pl.normal.x;
      planes[k * 4 + 1] = pl.normal.y;
      planes[k * 4 + 2] = pl.normal.z;
      planes[k * 4 + 3] = pl.constant;
    }
    const fog = ctx.scene.fog as THREE.Fog | null;
    let far = cam.far;
    if (fog && (fog as THREE.Fog).isFog) far = Math.min(far, fog.far);
    const far2 = far * far;
    for (const s of slots) s.count = 0;
    visibleTrees = 0;
    nearTrees = 0;
    lodCounts[0] = lodCounts[1] = lodCounts[2] = 0;
    const cx = camPos.x;
    const cy = camPos.y;
    const cz = camPos.z;
    // Over the Mirror Lake the reflection shows what is above the frame: drop the top plane there.
    const mirror = cy > WORLD.lake.y && hyp(cx - WORLD.lake.x, cz - WORLD.lake.z) < WORLD.lake.r + 2500;
    const topPlane = 12;
    for (let c = 0; c < NC; c++) {
      const sx = cellSph[c * 4];
      const sy = cellSph[c * 4 + 1];
      const sz = cellSph[c * 4 + 2];
      const sr = cellSph[c * 4 + 3];
      const dc = hyp(sx - cx, sy - cy, sz - cz);
      if (dc - sr > far) continue;
      let cellIn = true;
      for (let k = 0; k < 24; k += 4) {
        if (mirror && k === topPlane) continue;
        if (planes[k] * sx + planes[k + 1] * sy + planes[k + 2] * sz + planes[k + 3] < -sr) {
          cellIn = false;
          break;
        }
      }
      if (!cellIn) continue;
      const e = cellEnd[c];
      for (let o = cellStart[c]; o < e; o++) {
        const px = SPH[o * 4];
        const py = SPH[o * 4 + 1];
        const pz = SPH[o * 4 + 2];
        const pr = SPH[o * 4 + 3];
        let inside = true;
        for (let k = 0; k < 24; k += 4) {
          if (mirror && k === topPlane) continue;
          if (planes[k] * px + planes[k + 1] * py + planes[k + 2] * pz + planes[k + 3] < -pr) {
            inside = false;
            break;
          }
        }
        if (!inside) continue;
        const dx = px - cx;
        const dy = py - cy;
        const dz = pz - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > far2) continue;
        const d = Math.sqrt(d2);
        const sp = SP[o];
        const ld = LOD_D[sp];
        const prev = LOD[o];
        const t1 = ld[0] * (prev >= 1 ? 1 - HYST : 1 + HYST);
        const t2 = ld[1] * (prev >= 2 ? 1 - HYST : 1 + HYST);
        const lod = d < t1 ? 0 : d < t2 ? 1 : 2;
        if (lod > ld[2]) {
          LOD[o] = lod;
          continue;
        }
        LOD[o] = lod;
        const si = slotOf[sp * 3 + lod];
        if (si < 0) continue;
        const s = slots[si];
        const n = s.count;
        s.mat.set(MAT.subarray(o * 16, o * 16 + 16), n * 16);
        s.col[n * 3] = COL[o * 3];
        s.col[n * 3 + 1] = COL[o * 3 + 1];
        s.col[n * 3 + 2] = COL[o * 3 + 2];
        s.count = n + 1;
        visibleTrees++;
        lodCounts[lod]++;
        if (d < SWAY_R) nearTrees++;
      }
    }
    for (const s of slots) {
      const m = s.mesh;
      m.count = s.count;
      m.visible = s.count > 0 && !hidden;
      if (s.count > 0) {
        const im = m.instanceMatrix;
        im.clearUpdateRanges();
        im.addUpdateRange(0, s.count * 16);
        im.needsUpdate = true;
        const ic = m.instanceColor!;
        ic.clearUpdateRanges();
        ic.addUpdateRange(0, s.count * 3);
        ic.needsUpdate = true;
      }
    }
    lastCompactMs = performance.now() - t0;
  };

  const camChanged = (): boolean => {
    const cam = ctx.camera;
    const a = cam.matrixWorld.elements;
    const b = cam.projectionMatrix.elements;
    let changed = false;
    for (let i = 0; i < 16; i++) {
      if (lastCam[i] !== a[i]) {
        changed = true;
        lastCam[i] = a[i];
      }
      if (lastCam[16 + i] !== b[i]) {
        changed = true;
        lastCam[16 + i] = b[i];
      }
    }
    return changed;
  };

  const drawnTris = () => slots.reduce((s, sl) => s + (sl.mesh.visible ? sl.count * sl.tris : 0), 0);
  const drawnCalls = () => slots.reduce((s, sl) => s + (sl.mesh.visible ? 1 : 0), 0);

  times.total = Math.round(performance.now() - tStart);

  return {
    name: "forest",
    update(time: number) {
      shared.uTime.value = ctx.reducedMotion ? 0 : time;
      shared.uSunDir.value.copy(ctx.sunDir).normalize();
      shared.uSunColor.value.copy(ctx.sunColor);
      shared.uMagic.value = probeMat.color.r;
      const kind = kindAt(ctx.railU());
      const under = kind === "cave" || kind === "tunnel" || (kind === "shaft" && ctx.camera.position.y < SHAFT.topY - 40);
      let changed = false;
      if (under !== hidden) {
        hidden = under;
        group.visible = !hidden;
        changed = true;
      }
      if (!hidden && (firstFrame || camChanged())) {
        firstFrame = false;
        compact();
        changed = true;
      }
      return changed || (!hidden && !ctx.reducedMotion && visibleTrees > 0);
    },
    isAnimating() {
      return !hidden && !ctx.reducedMotion && visibleTrees > 0;
    },
    dispose() {
      ctx.root.remove(group);
      for (const s of slots) {
        s.mesh.geometry.dispose();
        s.mesh.dispose();
      }
      for (const m of [matL0, matL1, matL2, matMagic, probeMat]) m.dispose();
      probe.geometry.dispose();
      disposed = true;
      if (maps) {
        const surf = ctx.scene.userData.surfaces as SurfacesApi | undefined;
        if (surf) {
          surf.setShadeTexture(null);
          surf.setForestMask(null);
        }
        maps.shade.dispose();
        maps.density.dispose();
        if (ctx.scene.userData.forestMaps === maps) delete ctx.scene.userData.forestMaps;
      }
    },
    stats() {
      const out: Record<string, number | string> = {
        trees: N,
        buildMs: times.total,
        build: JSON.stringify(times),
        mapsMs,
        compactMs: Math.round(lastCompactMs * 100) / 100,
        visible: visibleTrees,
        lod0: lodCounts[0],
        lod1: lodCounts[1],
        lod2: lodCounts[2],
        near: nearTrees,
        triangles: hidden ? 0 : drawnTris(),
        calls: hidden ? 0 : drawnCalls(),
        cells: NC,
        kit: JSON.stringify(kitTris),
        zones: JSON.stringify(zoneCounts),
      };
      for (let s = 0; s < NSP; s++) out[`n_${SPECIES_NAME[s]}`] = counts[s];
      return out;
    },
  };
};

// ── Baked tree shade and forest density, for the terrain shader (1.8) ───────

/**
 * What the forest hands the terrain (scene.userData.forestMaps), world XZ to UV:
 *   u = (x - origin[0]) / size, v = (z - origin[1]) / size.
 * shade: 1024 R8 (7.8 units a texel), 1 = lit, down to 0 under a tree's shadow (surfaces.ts
 *   reads it that way), each shadow stretched away from the sun of the
 *   place that owns that zone, length min(h / tan(sunEl), 4h) (a2: a 45 spruce
 *   throws ~180). Darken toward near shade by up to 35 percent.
 * density: 512 R8, how wooded the ground is (a soft disc per tree): the forest
 *   floor paint, so a hill reads forested where its trees are culled.
 */
export interface ForestMaps {
  shade: THREE.DataTexture;
  density: THREE.DataTexture;
  origin: [number, number];
  size: number;
}
/** Sun [azimuth, elevation] per zone, from the colour script (1.2). */
const ZONE_SUN: Record<string, readonly [number, number]> = {
  Z1: [285, 13],
  Z2: [245, 14],
  Z3: [290, 13],
  Z4: [228, 5],
  Z5: [262, 1.6],
};

function bakeMaps(recs: number[], casts: (x: number, z: number) => boolean): ForestMaps {
  const size = Math.max(ROI.maxX - ROI.minX, ROI.maxZ - ROI.minZ);
  const ox = ROI.minX;
  const oz = ROI.minZ;
  const SN = 1024;
  const DN = 512;
  const shade = new Uint8Array(SN * SN);
  const dens = new Float32Array(DN * DN);
  const sT = size / SN;
  const dT = size / DN;
  for (let r = 0; r < recs.length; r += 10) {
    const sp = recs[r];
    if (sp === T6 || sp === M3 || sp === M4) continue;
    const x = recs[r + 1];
    const z = recs[r + 3];
    const h = recs[r + 4];
    const cr = Math.max(4, h * R0 * recs[r + 5]);
    // Density: a soft disc.
    {
      const R = (cr + 14) / dT;
      const ci = (x - ox) / dT;
      const cj = (z - oz) / dT;
      for (let j = Math.max(0, Math.floor(cj - R)); j <= Math.min(DN - 1, Math.ceil(cj + R)); j++) {
        for (let i = Math.max(0, Math.floor(ci - R)); i <= Math.min(DN - 1, Math.ceil(ci + R)); i++) {
          const d = hyp(i + 0.5 - ci, j + 0.5 - cj) / R;
          if (d < 1) dens[j * DN + i] += 0.45 * (1 - d * d);
        }
      }
    }
    if (sp >= M2 || !casts(x, z)) continue;
    // Shade: a stripe away from the owning zone's sun.
    let best = "";
    let bd = 1;
    for (const Z of ZONES) {
      const dd = hyp(x - Z.x, z - Z.z) / Z.r;
      if (dd < bd) {
        bd = dd;
        best = Z.name;
      }
    }
    const [az, el] = ZONE_SUN[best] ?? (z > 1100 ? ZONE_SUN.Z2 : ZONE_SUN.Z5);
    const L = Math.min(4 * h, h / Math.tan((el * Math.PI) / 180));
    const dx = -Math.sin((az * Math.PI) / 180);
    const dz = Math.cos((az * Math.PI) / 180);
    const steps = Math.max(2, Math.ceil(L / Math.max(sT, cr * 0.8)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      // The crown's shadow: widest a fifth of the way out, a point at the tip.
      const wt = cr * (t < 0.2 ? 0.5 + 2.5 * t : 1.25 * (1 - t));
      const px = (x + dx * L * t - ox) / sT;
      const pz = (z + dz * L * t - oz) / sT;
      const W = Math.max(0.6, wt / sT);
      for (let j = Math.max(0, Math.floor(pz - W)); j <= Math.min(SN - 1, Math.ceil(pz + W)); j++) {
        for (let i = Math.max(0, Math.floor(px - W)); i <= Math.min(SN - 1, Math.ceil(px + W)); i++) {
          const ex = i + 0.5 - px;
          const ez = j + 0.5 - pz;
          const d2 = (ex * ex + ez * ez) / (W * W);
          if (d2 >= 1) continue;
          const v = (255 * (1 - d2) * (0.75 + 0.25 * (1 - t))) | 0;
          const q = j * SN + i;
          if (v > shade[q]) shade[q] = v;
        }
      }
    }
  }
  // Baked as "how shadowed"; handed over as "how lit", the terrain shader's convention.
  for (let q = 0; q < SN * SN; q++) shade[q] = 255 - shade[q];
  const dens8 = new Uint8Array(DN * DN);
  for (let q = 0; q < DN * DN; q++) dens8[q] = Math.min(255, Math.round(255 * Math.min(1, dens[q])));
  const mk = (data: Uint8Array<ArrayBuffer>, n: number, name: string) => {
    const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    t.name = name;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  return { shade: mk(shade, SN, "ForestShade"), density: mk(dens8, DN, "ForestDensity"), origin: [ox, oz], size };
}

/** The density map as a function of world (x, z), 0..1, bilinear, for surfaces.setForestMask. */
function densitySampler(m: ForestMaps): (x: number, z: number) => number {
  const img = m.density.image as { data: Uint8Array; width: number };
  const data = img.data;
  const n = img.width;
  return (x, z) => {
    const fi = ((x - m.origin[0]) / m.size) * n - 0.5;
    const fj = ((z - m.origin[1]) / m.size) * n - 0.5;
    if (fi < 0 || fj < 0 || fi >= n - 1 || fj >= n - 1) return 0;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;
    const k = j * n + i;
    const a = data[k] * (1 - u) + data[k + 1] * u;
    const b = data[k + n] * (1 - u) + data[k + n + 1] * u;
    return (a * (1 - v) + b * v) / 255;
  };
}
