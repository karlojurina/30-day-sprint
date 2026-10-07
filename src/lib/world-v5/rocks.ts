import * as THREE from "three";
import { BROOK, CAVE, DESIGN_FOV, GORGE, ISLAND_DEPTH, LOOK, PATH, PLACES, TRAIL, TUNNEL, WORLD } from "./layout";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { terrainHeight } from "./terrain";

/**
 * V5 look module: rocks (world_art_bible.md 1.8 "Rock", 3.3, 4.4).
 *
 * One warm grey faceted kit, flat shaded with an AO bake, tinted per place;
 * faces that look up (normal y > 0.8) take the place's moss or dry grass.
 * Colour comes from the light, fog and grade (bible 1.1), so the albedos stay
 * grey and low in saturation.
 *
 * What it adds under "V5Rocks", merged per zone (one draw call per zone, so a
 * stop draws 1 to 3):
 *   Rocks:south   a1 and a2: shore rocks, the framing groups, trail bends.
 *   Rocks:gorge   the falls: cliff sheets (R5) on the north wall on the gorge
 *                 strata (18 degrees, dipping east), the lip, the pool ring
 *                 and the cliff feet.
 *   Rocks:high    the collar: cliff sheets on the 12 degree strata round the
 *                 shaft's exit, slabs on the rim shelf; the meadow's outcrops,
 *                 the brook's stones; the Mirror Lake's shore.
 *   Rocks:sky     the Sky Island's underside (sheets flush on blocks.ts's cone,
 *                 flat strata) and edge rocks on its top.
 *
 * Groups (bible 3.3): 1 large, 1 to 2 medium (0.3 to 0.7), 3 to 6 small (0.1
 * to 0.3), random yaw, tilt under 15 degrees, sunk 20 to 40 percent.
 * Placement is procedural and seeded (stable across reloads): framing
 * corners are found by casting rays from each stop's own camera pose (TRAIL /
 * LOOK), and nothing comes within RAIL_CLEAR of the camera's route.
 *
 * Exports the ground helpers cover.ts shares (groundY, slopeAt, rnd,
 * nearTrail, nearRail, rockAnchors).
 */

// ── Shared ground helpers (cover.ts uses these too) ──────────────────────────

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
/** scene.ts FALLS_PATCH: drawn 5x finer there, so the surface is terrainHeight itself. */
const FALLS_PATCH = { minX: -380, maxX: 180, minZ: 1130, maxZ: 1460 };

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
    best = Math.min(best, Math.hypot(x - a.x - dx * u, z - a.z - dz * u));
  }
  return best;
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
    best = Math.min(best, Math.hypot(x - a[0] - dx * u, y - a[1] - dy * u, z - a[2] - dz * u));
  }
  return best;
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

// ── Tints (display sRGB; linear on use) ──────────────────────────────────────

interface Tint {
  base: number;
  top: number;
}
/** Per place (bible 1.8): a1 warm grey, a3 cool dark grey, a5 grey violet, a7 blue grey. `top` is what upward faces take. */
const TINTS = {
  shore: { base: 0x4d4944, top: 0x626150 }, // a1's black shore rocks
  a1: { base: 0x7a7269, top: 0x7f7b58 },
  a2: { base: 0x6e6b64, top: 0x56623f },
  gorge: { base: 0x8c7b66, top: 0x5e6b3a }, // Firewatch cliff: cream ochre lit faces (fix pass 3: desaturated from 0x9a6a44), moss on the ledges
  collar: { base: 0x857872, top: 0x8c7f60 },
  a5: { base: 0x746d7a, top: 0x877a5a },
  a7: { base: 0x747a86, top: 0x9a9678 },
} satisfies Record<string, Tint>;


// ── The kit: faces straight into a per-zone soup ─────────────────────────────

type P3 = [number, number, number];

class Soup {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  tris = 0;
  private base = new THREE.Color();
  private top = new THREE.Color();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();
  private n = new THREE.Vector3();
  private e1 = new THREE.Vector3();
  private e2 = new THREE.Vector3();
  /**
   * Faces of a piece in local space (y up, base at y 0, height `h` local),
   * transformed by `m`. AO bake: the lower faces darken to 0.62 (local height
   * fraction), the piece's value jitters by `v`, faces looking up take the top
   * colour.
   */
  piece(faces: P3[][], m: THREE.Matrix4, h: number, tint: Tint, v: number, topShare = 0.72) {
    this.base.setHex(tint.base, THREE.SRGBColorSpace);
    this.top.setHex(tint.top, THREE.SRGBColorSpace);
    for (const f of faces) {
      for (let k = 1; k < f.length - 1; k++) {
        const la = f[0];
        const lb = f[k];
        const lc = f[k + 1];
        this.a.set(la[0], la[1], la[2]).applyMatrix4(m);
        this.b.set(lb[0], lb[1], lb[2]).applyMatrix4(m);
        this.c.set(lc[0], lc[1], lc[2]).applyMatrix4(m);
        // The kit winds every face counter-clockwise seen from outside: (b - a) x (c - a) points out.
        this.e1.subVectors(this.b, this.a);
        this.e2.subVectors(this.c, this.a);
        this.n.crossVectors(this.e1, this.e2).normalize();
        const up = this.n.y > 0.8 ? topShare * smooth(0.8, 0.92, this.n.y) : 0;
        for (const [p, l] of [
          [this.a, la],
          [this.b, lb],
          [this.c, lc],
        ] as const) {
          const ao = 0.62 + 0.38 * smooth(0, 0.85, l[1] / Math.max(1e-3, h));
          this.pos.push(p.x, p.y, p.z);
          this.nor.push(this.n.x, this.n.y, this.n.z);
          const r = (this.base.r + (this.top.r - this.base.r) * up) * ao * v;
          const g = (this.base.g + (this.top.g - this.base.g) * up) * ao * v;
          const bl = (this.base.b + (this.top.b - this.base.b) * up) * ao * v;
          this.col.push(r, g, bl);
        }
        this.tris++;
      }
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** A ring of n points at height y, radius r, with jitter. */
function ring(n: number, y: number, r: number, rand: () => number, rot = 0, jr = 0.18): P3[] {
  const out: P3[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + ((i + (rand() - 0.5) * 0.35) / n) * Math.PI * 2;
    const rr = r * (1 - jr / 2 + rand() * jr);
    out.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
  }
  return out;
}
/** Side quads between two rings of the same count (outward, CCW from outside). */
function band(lo: P3[], hi: P3[]): P3[][] {
  const f: P3[][] = [];
  const n = lo.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    f.push([lo[i], hi[i], hi[j]], [lo[i], hi[j], lo[j]]);
  }
  return f;
}
/** Top cap: fan over a ring (facing up). */
function cap(r: P3[]): P3[][] {
  return [[...r].reverse()];
}

/** R1 boulder: 5 or 6 sided, three rings, big facets, flat base. ~23-28 tris. Local height ~0.85. */
function boulder(rand: () => number): { faces: P3[][]; h: number } {
  const n = rand() < 0.5 ? 5 : 6;
  const rot = rand() * 6.28;
  const b0 = ring(n, 0, 1, rand, rot, 0.25);
  const hm = 0.42 + rand() * 0.16;
  const b1 = ring(n, hm, 0.84 + rand() * 0.12, rand, rot + 0.35, 0.3);
  const ht = 0.72 + rand() * 0.2;
  const b2 = ring(n, ht, 0.36 + rand() * 0.18, rand, rot + 0.1, 0.4);
  // Shift the top off-centre so the rock leans and one flat face catches the light.
  const sx = (rand() - 0.5) * 0.3;
  const sz = (rand() - 0.5) * 0.3;
  for (const p of b2) {
    p[0] += sx;
    p[2] += sz;
    p[1] += (rand() - 0.5) * 0.12;
  }
  return { faces: [...band(b0, b1), ...band(b1, b2), ...cap(b2)], h: ht };
}
/** R2 slab: two stacked plates. ~26 tris. */
function slab(rand: () => number): { faces: P3[][]; h: number } {
  const n = 5;
  const rot = rand() * 6.28;
  const t0 = 0.22 + rand() * 0.08;
  const a0 = ring(n, 0, 1, rand, rot, 0.3);
  const a1 = a0.map((p): P3 => [p[0] * 0.94, t0, p[2] * 0.94]);
  const ox = (rand() - 0.5) * 0.35;
  const oz = (rand() - 0.5) * 0.35;
  const b0 = ring(n, t0 - 0.02, 0.66, rand, rot + 0.6, 0.3).map((p): P3 => [p[0] + ox, p[1], p[2] + oz]);
  const t1 = t0 + 0.16 + rand() * 0.08;
  const b1 = b0.map((p): P3 => [p[0] * 0.92 + ox * 0.08, t1, p[2] * 0.92 + oz * 0.08]);
  return { faces: [...band(a0, a1), ...cap(a1), ...band(b0, b1), ...cap(b1)], h: t1 };
}
/** R3 shard: a slanted wedge with a sharp top. 10 tris. */
function shard(rand: () => number): { faces: P3[][]; h: number } {
  const b0 = ring(5, 0, 1, rand, rand() * 6.28, 0.3);
  const b1 = ring(5, 0.55, 0.55, rand, rand() * 6.28, 0.3);
  const lean = (rand() - 0.5) * 0.6;
  for (const p of b1) p[0] += lean * 0.5;
  const apex: P3 = [lean + (rand() - 0.5) * 0.2, 1.35 + rand() * 0.4, (rand() - 0.5) * 0.3];
  const f = band(b0, b1);
  for (let i = 0; i < 5; i++) f.push([b1[i], apex, b1[(i + 1) % 5]]);
  // band gives 10, the top 5: 15. Keep it: small ones use pebble instead.
  return { faces: f, h: apex[1] };
}
/** R4 pebble: squashed octahedron. 8 tris (4 above ground, the rest sunk). */
function pebble(rand: () => number): { faces: P3[][]; h: number } {
  const r = ring(4, 0.18, 1, rand, rand() * 6.28, 0.3);
  const top: P3 = [(rand() - 0.5) * 0.3, 0.62 + rand() * 0.2, (rand() - 0.5) * 0.3];
  const bot: P3 = [0, -0.3, 0];
  const f: P3[][] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    f.push([r[i], top, r[j]], [r[j], bot, r[i]]);
  }
  return { faces: f, h: top[1] };
}
/**
 * R5 cliff sheet: an irregular hexagonal plate in the (u, v) plane, `t` thick
 * along +w (its outward face at w = t, its back at 0). Front face 4 tris +
 * sides 12. Returned in plate space: x = u, y = w (out of the wall), z = v.
 */
function sheet(rand: () => number, L: number, H: number, t: number): P3[][] {
  const o: P3[] = [];
  const pts: [number, number][] = [
    [-L, -H * (0.3 + rand() * 0.4)],
    [-L * (0.55 + rand() * 0.2), -H],
    [L * (0.45 + rand() * 0.3), -H * (0.85 + rand() * 0.15)],
    [L, H * (rand() - 0.5) * 0.5],
    [L * (0.4 + rand() * 0.3), H],
    [-L * (0.5 + rand() * 0.35), H * (0.8 + rand() * 0.2)],
  ];
  for (const [u, v] of pts) o.push([u, t * (0.8 + rand() * 0.4), v]);
  const back = pts.map(([u, v]): P3 => [u * 0.96, 0, v * 0.96]);
  const f: P3[][] = [];
  // Front (normal +y in plate space): CCW seen from +y.
  f.push([...o].reverse());
  // Sides.
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    f.push([back[i], o[i], o[j]], [back[i], o[j], back[j]]);
  }
  return f;
}
// ── Placing ──────────────────────────────────────────────────────────────────

/** Nothing comes within this of the camera's route. */
const RAIL_CLEAR = 30;

export interface RockAnchor {
  x: number;
  z: number;
  /** Radius of the group's footprint. */
  r: number;
}
/** Every rock group placed, for cover.ts (tall grass and tufts round the anchors). */
export const rockAnchors: RockAnchor[] = [];

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

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const S3 = new THREE.Vector3();
const T3 = new THREE.Vector3();

/** One free-standing piece: base on the ground at (x, z), sunk `sink` of its height, yawed, tilted under 15 degrees. */
function stone(soup: Soup, kind: "boulder" | "slab" | "shard" | "pebble", x: number, z: number, s: number, tint: Tint, rand: () => number, strata = 0): number {
  const shape = kind === "boulder" ? boulder(rand) : kind === "slab" ? slab(rand) : kind === "shard" ? shard(rand) : pebble(rand);
  const sy = s * (kind === "slab" ? 0.9 : 0.7 + rand() * 0.35);
  const hWorld = shape.h * sy;
  // The lowest ground under the footprint, so the downhill side never floats.
  let g = Infinity;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const rr = k === 4 ? 0 : s * 0.7;
    g = Math.min(g, groundY(x + Math.cos(a) * rr, z + Math.sin(a) * rr));
  }
  if (!isFinite(g)) return 0;
  const sink = 0.2 + rand() * 0.2;
  const tilt = (rand() - 0.5) * 2 * 14 * DEG;
  E.set(strata ? strata * DEG : tilt * 0.5, rand() * Math.PI * 2, tilt, "YXZ");
  Q.setFromEuler(E);
  S3.set(s * (0.85 + rand() * 0.3), sy, s * (0.85 + rand() * 0.3));
  T3.set(x, g - hWorld * sink, z);
  M.compose(T3, Q, S3);
  const before = soup.tris;
  soup.piece(shape.faces, M, shape.h, tint, 0.9 + rand() * 0.2);
  return soup.tris - before;
}

/** A group (bible 3.3): 1 large, 1-2 medium, 3-6 small. `size` is the large one's radius. */
function group(soup: Soup, x: number, z: number, size: number, tint: Tint, seed: number, opts: { lead?: "boulder" | "slab" | "shard"; strata?: number; small?: number } = {}): void {
  const rand = mulberry(seed * 7919 + 17);
  const g = groundY(x, z);
  if (nearRail(x, g + size, z, RAIL_CLEAR + size)) return;
  const lead = opts.lead ?? (rand() < 0.7 ? "boulder" : "slab");
  stone(soup, lead, x, z, size, tint, rand, opts.strata ?? 0);
  const nm = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < nm; i++) {
    const a = rand() * Math.PI * 2;
    const d = size * (0.9 + rand() * 0.6);
    stone(soup, rand() < 0.6 ? "boulder" : "shard", x + Math.cos(a) * d, z + Math.sin(a) * d, size * (0.3 + rand() * 0.4), tint, rand, opts.strata ?? 0);
  }
  const ns = opts.small ?? 3 + Math.floor(rand() * 4);
  for (let i = 0; i < ns; i++) {
    const a = rand() * Math.PI * 2;
    const d = size * (0.8 + rand() * 1.5);
    const s = size * (0.1 + rand() * 0.2);
    stone(soup, s < 2.5 ? "pebble" : "boulder", x + Math.cos(a) * d, z + Math.sin(a) * d, s, tint, rand);
  }
  rockAnchors.push({ x, z, r: size * 2.2 });
}

/** Wall sheet at P on a surface with outward normal n, long axis dipping `dip` degrees (+ = east end lower). */
function wallSheet(soup: Soup, P: THREE.Vector3, n: THREE.Vector3, L: number, H: number, dip: number, tint: Tint, rand: () => number): boolean {
  const nn = n.clone().normalize();
  // Horizontal tangent along the wall, pointing east where possible.
  const t = new THREE.Vector3(0, 1, 0).cross(nn);
  if (t.lengthSq() < 1e-6) t.set(1, 0, 0);
  t.normalize();
  if (t.x < 0) t.negate();
  const b = new THREE.Vector3().crossVectors(nn, t).normalize(); // in-plane "up"
  if (b.y < 0) b.negate();
  const a = -dip * DEG; // east end lower
  const u = t.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
  const v = new THREE.Vector3().crossVectors(u, nn).normalize();
  // Plate space: x = u, y = n (out of the wall), z = v. Make the basis right-handed.
  const basis = new THREE.Matrix4().makeBasis(u, nn, v);
  if (basis.determinant() < 0) {
    v.negate();
    basis.makeBasis(u, nn, v);
  }
  const thick = 3 + rand() * 4;
  // The plate's back sits 5 into the rock; its corners must meet rock behind them, or it hangs in the air.
  const back = P.clone().addScaledVector(nn, -5);
  for (const [cu, cv] of [
    [-L, 0],
    [L, 0],
    [0, H],
    [0, -H],
    [-L * 0.7, H * 0.7],
    [L * 0.7, -H * 0.7],
  ]) {
    const c = back.clone().addScaledVector(u, cu).addScaledVector(v, cv);
    // Rock behind the corner within 14 units along -n?
    let hit = false;
    for (let s = -4; s <= 14 + L * 0.12; s += 3) {
      const q = c.clone().addScaledVector(nn, -s);
      if (q.y < terrainHeight(q.x, q.z)) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }
  basis.setPosition(back);
  soup.piece(sheet(rand, L, H, thick + 5), basis, thick + 5, tint, 0.72 + rand() * 0.46, 0.55);
  return true;
}

// ── Where the rocks go ───────────────────────────────────────────────────────

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

/** Distance from p to the mine tunnel's floor centreline (3D, segment by segment). */
function tunnelDist(p: THREE.Vector3): number {
  let best = Infinity;
  for (let i = 0; i < TUNNEL.length - 1; i++) {
    const [ax, ay, az] = TUNNEL[i];
    const [bx, by, bz] = TUNNEL[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.y - ay) * dy + (p.z - az) * dz) / len2));
    best = Math.min(best, Math.hypot(p.x - ax - dx * t, p.y - ay - dy * t, p.z - az - dz * t));
  }
  return best;
}

function terrainNormal(x: number, z: number, e = 4): THREE.Vector3 {
  const gx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
  const gz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
  return new THREE.Vector3(-gx, 1, -gz).normalize();
}

interface Built {
  soups: Record<"south" | "gorge" | "high" | "sky", Soup>;
  groups: number;
  sheets: number;
}

function place(): Built {
  const soups = { south: new Soup(), gorge: new Soup(), high: new Soup(), sky: new Soup() };
  let groups = 0;
  let sheets = 0;
  rockAnchors.length = 0;
  const G = (soup: Soup, x: number, z: number, size: number, tint: Tint, seed: number, opts?: Parameters<typeof group>[6]) => {
    const n0 = rockAnchors.length;
    group(soup, x, z, size, tint, seed, opts);
    if (rockAnchors.length > n0) groups++;
  };
  const stop = (id: string) => PLACES.find((p) => p.id === id)!;

  // ── a1, the Landing: black shore rocks lower right (framing), a few along the beach ──
  {
    const a1 = stop("a1");
    for (const [nx, ny, s, k] of [
      [0.78, -0.72, 26, 1],
      [0.92, -0.5, 20, 2],
      [0.6, -0.86, 16, 3],
      [0.95, -0.2, 16, 4],
    ] as const) {
      const hit = stopRay(a1.trail, nx, ny);
      if (!hit) continue;
      let { x, z } = hit;
      // Off the water onto the shoreline: walk on along the view until the ground is above the sea.
      if (hit.water) {
        const dx = x - TRAIL[a1.trail][0];
        const dz = z - TRAIL[a1.trail][2];
        const L = Math.hypot(dx, dz);
        // Fix pass 3: stop in the shallows (-8), not on the dry shore: walked to the
        // shoreline they sat 600+ out and read as pebbles, so a1 had no dark near frame.
        for (let t = 0; t < 900 && groundY(x, z) < -8; t += 6) {
          x += (dx / L) * 6;
          z += (dz / L) * 6;
        }
      }
      G(soups.south, x, z, s * 1.8, TINTS.shore, 100 + k, { small: 6 }); // fix pass 3: 1.8x, so they frame the lower right at 300 away
    }
    // Along the beach either side of the dock, at the waterline.
    for (let k = 0; k < 10; k++) {
      const x = 1000 + k * 70 + rnd(k, 3) * 40;
      // Find the shore (ground 0..3) by walking north from the sea.
      let z = 4700;
      while (z > 3800 && groundY(x, z) < 0.5) z -= 5;
      if (z <= 3800) continue;
      if (Math.abs(x - 1335) < 40) continue; // the dock
      if (nearTrail(x, z, 20)) continue;
      G(soups.south, x + (rnd(k, 4) - 0.5) * 20, z + 4, 8 + rnd(k, 5) * 10, TINTS.shore, 120 + k);
    }
  }

  // ── The walk to Base Camp and a2: framing lower right, groups on the trail bends ──
  {
    const a2 = stop("a2");
    for (const [nx, ny, s, k] of [
      [0.82, -0.78, 30, 1],
      [0.62, -0.55, 18, 2],
      [0.9, -0.35, 20, 3],
    ] as const) {
      const hit = stopRay(a2.trail, nx, ny);
      if (hit && !hit.water) G(soups.south, hit.x, hit.z, s, TINTS.a2, 200 + k, { lead: "boulder" });
    }
    // Trail bends from the signpost to the rim (PATH 1..11), 26-50 off the trail on the outside.
    for (let i = 1; i < 11; i++) {
      const a = PATH[i - 1];
      const b = PATH[i];
      const c = PATH[i + 1];
      const d1x = b.x - a.x;
      const d1z = b.z - a.z;
      const d2x = c.x - b.x;
      const d2z = c.z - b.z;
      const turn = Math.sign(d1x * d2z - d1z * d2x) || 1;
      const L = Math.hypot(d1x + d2x, d1z + d2z) || 1;
      // Outside of the bend = away from the turn.
      const ox = (-(d1z + d2z) / L) * -turn;
      const oz = ((d1x + d2x) / L) * -turn;
      const off = 34 + rnd(i, 7) * 22;
      const tint = b.z > 3400 ? TINTS.a1 : TINTS.a2;
      G(soups.south, b.x + ox * off, b.z + oz * off, 9 + rnd(i, 8) * 7, tint, 240 + i);
      if (rnd(i, 9) < 0.6) G(soups.south, b.x - ox * (off + 20), b.z - oz * (off + 20), 6 + rnd(i, 10) * 5, tint, 260 + i);
    }
    // Scattered outcrops on the valley sides between the shore and the rim (where the ground steepens).
    let placed = 0;
    for (let k = 0; k < 400 && placed < 26; k++) {
      const x = 150 + rnd(k, 11) * 1500;
      const z = 2150 + rnd(k, 12) * 2000;
      const sl = slopeAt(x, z);
      if (sl < 0.3 || sl > 0.9) continue;
      if (nearTrail(x, z, 60) || isWater(x, z)) continue;
      G(soups.south, x, z, 9 + rnd(k, 13) * 10, z > 3400 ? TINTS.a1 : TINTS.a2, 300 + k, { lead: rnd(k, 14) < 0.2 ? "slab" : "boulder", strata: 8 });
      placed++;
    }
  }

  // ── The falls: sheets on the north wall (18 degrees, dipping east), the lip, the pool, the cliff feet ──
  {
    const F = WORLD.falls;
    const pool = WORLD.pool;
    const rand = mulberry(311);
    const P = new THREE.Vector3();
    // Big calm plates, not a shingle: at 30 by 22 the half-length 26-64 sheets
    // overlapped into fish scales that read as one flat dark band on the dive.
    for (let x = -430; x <= 330; x += 46) {
      const gz = gorgeAt(x);
      const zFoot = gz.z - gz.hw + 6;
      for (let y = gz.y + 10; y < 560; y += 34 + rand() * 12) {
        const jx = x + (rand() - 0.5) * 18;
        let L = 44 + rand() * 50;
        let Hh = 15 + rand() * 13;
        // Keep the curtain, the cave's mouth and the lip's notch clear, by the plate's
        // whole reach: nearer the curtain the plates get smaller, never absent (bare,
        // the shaded wall there is near black).
        L = Math.min(L, Math.abs(jx - F.top[0]) - F.width / 2 - 18);
        if (L < 16) continue;
        // Find the wall at height y: from the foot northwards until the ground rises past y.
        let lo = zFoot;
        let hi = zFoot - 700;
        if (terrainHeight(jx, lo) > y || terrainHeight(jx, hi) < y) continue;
        for (let i = 0; i < 26; i++) {
          const m = (lo + hi) / 2;
          if (terrainHeight(jx, m) < y) lo = m;
          else hi = m;
        }
        const z = (lo + hi) / 2;
        if (slopeAt(jx, z, 3) < 1.15) continue;
        P.set(jx, y, z);
        if (nearRail(P.x, P.y, P.z, RAIL_CLEAR + 40)) continue;
        // A flat plate on a curved wall reaches deeper into the rock at its ends:
        // keep its whole reach off the hall behind the curtain and the tunnel.
        if (y < CAVE.floorY + CAVE.hallH + L) L = Math.min(L, Math.hypot(jx - CAVE.hallX, z - CAVE.hallZ) - Math.max(CAVE.rx, CAVE.rz) - 20);
        L = Math.min(L, tunnelDist(P) - 30);
        if (L < 16) continue;
        Hh = Math.min(Hh, L * 0.6);
        const n = terrainNormal(jx, z, 3);
        if (wallSheet(soups.gorge, P, n, L, Hh, 18, TINTS.gorge, rand)) sheets++;
      }
    }
    // The lip's west shelf (the old grey boulders), set back from the edge.
    for (const [dx, dz, s, k] of [
      [-64, -14, 12, 1],
      [-110, -12, 11, 2],
      [-88, -40, 9, 3],
      [74, -26, 9, 4],
    ] as const) G(soups.gorge, F.top[0] + dx, F.top[2] + dz, s, TINTS.gorge, 400 + k, { strata: 18 });
    // Round the pool's east and west sides, never between the dive camera and the water.
    // (Not at 20-60 either side of north: there the stones spread under the curtain's foot and show through the water on the dive.)
    for (const b of [84, 118, 150, 210, 242, 276]) {
      const x = pool.x + Math.sin(b * DEG) * (pool.r + 10);
      const z = pool.z - Math.cos(b * DEG) * (pool.r + 10);
      G(soups.gorge, x, z, 8 + rnd(b, 3) * 7, TINTS.gorge, 420 + b, { small: 4 });
    }
    // The cliff feet either side of the curtain, and further along the floor.
    for (const [dx, s, k] of [
      [-150, 18, 3],
      [165, 16, 4],
      [-240, 20, 5],
      [260, 18, 6],
    ] as const) {
      const x = F.bottom[0] + dx;
      const gz = gorgeAt(x);
      G(soups.gorge, x, gz.z - gz.hw + 16 + rnd(k, 2) * 18, s, TINTS.gorge, 440 + k, { strata: 18 });
    }
  }

  // ── The collar: sheets on the 12 degree strata round the shaft's exit, slabs on the rim shelf ──
  {
    const rand = mulberry(733);
    const P = new THREE.Vector3();
    for (let z = 560; z <= 1150; z += 26) {
      for (let x = 1100; x <= 1800; x += 26) {
        const jx = x + (rand() - 0.5) * 20;
        const jz = z + (rand() - 0.5) * 20;
        const sl = slopeAt(jx, jz, 4);
        if (sl < 0.95) continue;
        const y = terrainHeight(jx, jz);
        if (y < 560) continue; // the Climb's face down into the gorge: unseen, leave it
        P.set(jx, y, jz);
        if (rand() < 0.35) continue;
        const dr = railDist(P.x, P.y, P.z);
        // Pass 3: 95 -> 150. Plates nearer than that sat edge-on against the sky
        // top left of the shaft exit (keys 37.15, 38.6) and read as debug cubes.
        if (dr < 150 || nearTrail(jx, jz, 18)) continue;
        // Smaller near the camera's line, so the exit is framed, not walled.
        const k = smooth(150, 300, dr);
        const n = terrainNormal(jx, jz, 4);
        if (wallSheet(soups.high, P, n, (12 + rand() * 16) * (0.7 + 0.6 * k), (6 + rand() * 6) * (0.7 + 0.5 * k), 12, TINTS.collar, rand)) sheets++;
      }
    }
    // Rim shelf round the collar: low slabs on the strata, none ahead of the camera coming out.
    const sx = 1436;
    const sz = 1041;
    for (let k = 0; k < 14; k++) {
      const a = rnd(k, 21) * Math.PI * 2;
      const r = 60 + rnd(k, 22) * 170;
      const x = sx + Math.cos(a) * r;
      const z = sz + Math.sin(a) * r;
      if (z > WORLD.climb.topZ - 14) continue;
      if (Math.abs(x - sx) < 45 && z < sz) continue; // straight ahead of the exit
      if (slopeAt(x, z) > 0.6) continue;
      G(soups.high, x, z, 7 + rnd(k, 23) * 9, TINTS.collar, 500 + k, { lead: "slab", strata: 12 });
    }
    // Outcrops on the saddle's flanks and down the meadow (the old grey meadow rocks), on the strata.
    let placed = 0;
    for (let k = 0; k < 600 && placed < 30; k++) {
      const x = 1050 + rnd(k, 24) * 900;
      const z = -300 + rnd(k, 25) * 1250;
      const L = WORLD.lake;
      if (Math.hypot(x - L.x, z - L.z) < L.r + 30) continue;
      const sl = slopeAt(x, z);
      if (sl > 0.8) continue;
      if (nearTrail(x, z, 30)) continue;
      let dB = Infinity;
      for (const q of BROOK) dB = Math.min(dB, Math.hypot(x - q[0], z - q[2]));
      if (dB < 20) continue;
      G(soups.high, x, z, 8 + rnd(k, 26) * 12, TINTS.collar, 540 + k, { lead: rnd(k, 27) < 0.55 ? "slab" : "boulder", strata: 12 });
      placed++;
    }
    // Stones along the brook's banks.
    for (let i = 0; i < BROOK.length - 1; i++) {
      const a = BROOK[i];
      const b = BROOK[i + 1];
      for (let s = 0.15; s < 1; s += 0.22) {
        const x = a[0] + (b[0] - a[0]) * s;
        const z = a[2] + (b[2] - a[2]) * s;
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const L = Math.hypot(dx, dz);
        const side = rnd(i * 10 + s * 10, 28) < 0.5 ? -1 : 1;
        const off = 11 + rnd(i * 10 + s * 10, 29) * 6;
        G(soups.high, x - (dz / L) * off * side, z + (dx / L) * off * side, 3 + rnd(i + s, 30) * 3, TINTS.collar, 600 + i * 10 + Math.round(s * 10), { small: 3 });
      }
    }
  }

  // ── The Mirror Lake: the shore, black rocks lower left at a5 (framing) ──
  {
    const a5 = stop("a5");
    for (const [nx, ny, s, k] of [
      [-0.8, -0.8, 18, 1],
      [-0.6, -0.9, 14, 2],
      [-0.92, -0.55, 16, 3],
    ] as const) {
      const hit = stopRay(a5.trail, nx, ny);
      if (!hit) continue;
      let { x, z } = hit;
      // Onto the shore: pull toward the lake's rim if the ray hit water.
      if (hit.water) {
        // Out of the water toward the shore until the lake is shallow enough for the rock to stand in it.
        const L = WORLD.lake;
        const dx = x - L.x;
        const dz = z - L.z;
        const r = Math.hypot(dx, dz) || 1;
        let rr = r;
        while (rr < L.r + 10 && L.y - groundY(L.x + (dx / r) * rr, L.z + (dz / r) * rr) > s * 0.25) rr += 4;
        x = L.x + (dx / r) * rr;
        z = L.z + (dz / r) * rr;
      }
      G(soups.high, x, z, s, TINTS.a5, 700 + k, { small: 5 });
    }
    const L = WORLD.lake;
    for (let b = 0; b < 360; b += 11) {
      if (rnd(b, 31) < 0.35) continue;
      const r = L.r + 2 + rnd(b, 32) * 22;
      const x = L.x + Math.sin(b * DEG) * r;
      const z = L.z - Math.cos(b * DEG) * r;
      if (nearTrail(x, z, 22)) continue;
      // The jetty and boathouse (on the east shore, toward a5's pos).
      const B = stop("a5").pos;
      if (Math.hypot(x - B.x, z - B.z) < 90) continue;
      G(soups.high, x, z, 7 + rnd(b, 33) * 12, TINTS.a5, 740 + b, { small: 4 });
    }
  }

  // ── The Sky Island: sheets flush on the underside cone (flat strata), edge rocks on top ──
  {
    const I = WORLD.island;
    const rand = mulberry(977);
    // blocks.ts floatingRock(set, I.x, I.y, I.z, ISLAND_DEPTH, islandRim, islandTop, 64, 3), followed exactly.
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
      const kk = k - 1 + 6; // ring index in blocks' numbering (rings.length = 6)
      const [dd, ff] = low[k];
      const jag = 1 + 0.16 * (rnd(ii + kk * 97, seed) - 0.5) + 0.1 * Math.sin(th * 5 + seed);
      return new THREE.Vector3(I.x + s * r * ff * jag, I.y - ISLAND_DEPTH * dd * (1 + 0.1 * (rnd(ii * 3 + kk, seed + 1) - 0.5)), I.z + c * r * ff * jag);
    };
    for (let k = 0; k < low.length - 2; k++) {
      for (let i = 0; i < seg; i++) {
        if (rand() < 0.2) continue;
        const th = ((i + 0.5) / seg) * 360;
        let dc = th - COVE;
        dc -= 360 * Math.round(dc / 360);
        if (Math.abs(dc) < 24) continue; // the cove where the steps arrive: the rise camera passes 12 from the rock
        const a = vert(i, k);
        const b = vert(i + 1, k);
        const c = vert(i, k + 1);
        const d = vert(i + 1, k + 1);
        const f = 0.3 + rand() * 0.4;
        const g = 0.3 + rand() * 0.4;
        const top = a.clone().lerp(b, f);
        const bot = c.clone().lerp(d, f);
        const P = top.lerp(bot, g);
        // Outward normal of the quad.
        const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
        const out = new THREE.Vector3(P.x - I.x, 0, P.z - I.z).normalize();
        if (n.dot(out) < 0) n.negate();
        if (nearRail(P.x, P.y, P.z, RAIL_CLEAR + 30)) continue;
        const L = a.distanceTo(b) * (0.55 + rand() * 0.4);
        const H = Math.min(a.distanceTo(c), 60) * (0.3 + rand() * 0.25);
        // Flush: blocks' quad is planar between its corners; the sheet's back sits 5 behind it (wallSheet puts it there).
        const Pn = P.clone().addScaledVector(n, 3);
        soupSheetFlat(soups.sky, Pn, n, L, H, TINTS.a7, rand);
        sheets++;
      }
    }
    // Edge rocks on the top, lower right of the a7 frame and round the rim.
    const a7 = stop("a7");
    for (const [nx, ny, s, k] of [
      [0.8, -0.75, 14, 1],
      [0.93, -0.45, 11, 2],
    ] as const) {
      const hit = stopRay(a7.trail, nx, ny);
      if (!hit) continue;
      const r = Math.hypot(hit.x - I.x, hit.z - I.z);
      if (r > I.r - 20) continue;
      stoneOnIsland(soups.sky, hit.x, hit.z, s, 800 + k);
      groups++;
    }
    for (let b = 0; b < 360; b += 9) {
      if (rnd(b, 41) < 0.45) continue;
      let dc = b - COVE;
      dc -= 360 * Math.round(dc / 360);
      if (Math.abs(dc) < 26) continue;
      const r = rim(b * DEG) - 14 - rnd(b, 42) * 20;
      const x = I.x + Math.sin(b * DEG) * r;
      const z = I.z - Math.cos(b * DEG) * r;
      if (nearTrail(x, z, 30)) continue;
      stoneOnIsland(soups.sky, x, z, 5 + rnd(b, 43) * 8, 820 + b);
      groups++;
    }
  }

  return { soups, groups, sheets };
}

/** Island top height (blocks.ts islandTop), for rocks on the Sky Island. */
function islandTopY(x: number, z: number): number {
  const d2 = (x + 2410) ** 2 + (z + 1470) ** 2;
  return WORLD.island.y + 42 * Math.exp(-d2 / (150 * 150));
}
function stoneOnIsland(soup: Soup, x: number, z: number, s: number, seed: number): void {
  const rand = mulberry(seed * 131 + 7);
  const y = islandTopY(x, z);
  if (nearRail(x, y + s, z, RAIL_CLEAR + s)) return;
  const place1 = (px: number, pz: number, ps: number, kind: "boulder" | "slab" | "pebble") => {
    const shape = kind === "boulder" ? boulder(rand) : kind === "slab" ? slab(rand) : pebble(rand);
    const sy = ps * 0.8;
    E.set(0, rand() * 6.28, (rand() - 0.5) * 0.2, "YXZ");
    Q.setFromEuler(E);
    S3.set(ps, sy, ps * (0.8 + rand() * 0.3));
    T3.set(px, islandTopY(px, pz) - shape.h * sy * 0.3, pz);
    M.compose(T3, Q, S3);
    soup.piece(shape.faces, M, shape.h, TINTS.a7, 0.9 + rand() * 0.2);
  };
  place1(x, z, s, rand() < 0.5 ? "slab" : "boulder");
  for (let i = 0; i < 3; i++) {
    const a = rand() * 6.28;
    const d = s * (1 + rand());
    place1(x + Math.cos(a) * d, z + Math.sin(a) * d, s * (0.15 + rand() * 0.25), "pebble");
  }
  rockAnchors.push({ x, z, r: s * 2 });
}
/** A sheet flat on a known planar face (the island's underside): no rock test, the face is exact. */
function soupSheetFlat(soup: Soup, P: THREE.Vector3, n: THREE.Vector3, L: number, H: number, tint: Tint, rand: () => number): void {
  const nn = n.clone().normalize();
  const t = new THREE.Vector3(0, 1, 0).cross(nn);
  if (t.lengthSq() < 1e-6) t.set(1, 0, 0);
  t.normalize();
  const v = new THREE.Vector3().crossVectors(t, nn).normalize();
  const basis = new THREE.Matrix4().makeBasis(t, nn, v);
  if (basis.determinant() < 0) basis.makeBasis(t, nn, v.negate());
  basis.setPosition(P.clone().addScaledVector(nn, -5));
  soup.piece(sheet(rand, L, H, 5 + 3 + rand() * 3), basis, 8, tint, 0.8 + rand() * 0.2, 0);
}

/**
 * Gorge strata (detail pass 3): the cliff was one neutral grey, so its facets
 * read as blobs. Every face takes one of three bands (ochre, rust, purple
 * brown) by world height along an 18 degree dip, keeps its own value jitter
 * (plus or minus 15 percent a face, so the facets separate), and the rock
 * within ~30 of the curtain is wet and dark. Upward faces keep their moss.
 */
function strataGorge(soup: Soup): void {
  const F = WORLD.falls;
  const bands = [new THREE.Color(0x8c7b66), new THREE.Color(0xa08c70), new THREE.Color(0x5c5662)].map((c) => {
    const l = new THREE.Color().setHex(c.getHex(), THREE.SRGBColorSpace);
    return l;
  });
  const base = new THREE.Color().setHex(TINTS.gorge.base, THREE.SRGBColorSpace);
  const baseL = (base.r + base.g + base.b) / 3;
  const mossC = new THREE.Color().setHex(TINTS.gorge.top, THREE.SRGBColorSpace);
  const dip = Math.tan((18 * Math.PI) / 180);
  const pos = soup.pos;
  const col = soup.col;
  const nor = soup.nor;
  for (let t = 0; t < pos.length / 9; t++) {
    const i = t * 9;
    const cx = (pos[i] + pos[i + 3] + pos[i + 6]) / 3;
    const cy = (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3;
    const cz = (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3;
    if (nor[i + 1] > 0.8) continue; // moss tops stay
    const h = cy + cx * dip * 0.6 + cz * dip * 0.25;
    const bandIdx = ((Math.floor(h / 26) % 3) + 3) % 3;
    const c = bands[bandIdx];
    const jit = 0.85 + 0.3 * (((Math.sin(t * 12.9898 + cx * 0.071) * 43758.5453) % 1 + 1) % 1);
    // Wet dark band hugging the curtain (the sheet runs x -150..-50, z ~1255..1307).
    const dx = Math.max(0, Math.abs(cx - F.top[0]) - F.width * 0.5);
    const dz = Math.abs(cz - (F.top[2] + F.bottom[2]) * 0.5);
    const wet = 1 - smooth(8, 34, Math.hypot(dx, Math.max(0, dz - 30)));
    const k = jit * (1 - 0.45 * wet);
    // Fix pass 3: ledges turned half up take the moss too, so the wall reads as wet cliff.
    const moss = smooth(0.45, 0.8, nor[i + 1]) * 0.85;
    for (let v = 0; v < 3; v++) {
      const j = i + v * 3;
      // Keep the piece's AO and value (its ratio to the flat base), swap the hue.
      const ratio = (col[j] + col[j + 1] + col[j + 2]) / 3 / baseL;
      col[j] = (c.r + (mossC.r - c.r) * moss) * ratio * k;
      col[j + 1] = (c.g + (mossC.g - c.g) * moss) * ratio * k;
      col[j + 2] = (c.b + (mossC.b - c.b) * moss) * ratio * k * (1 + 0.25 * wet);
    }
  }
}

// ── Install ──────────────────────────────────────────────────────────────────

export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = performance.now();
  const root = new THREE.Group();
  root.name = "V5Rocks";
  ctx.root.add(root);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.name = "V5Stone";
  // The gorge's north wall faces away from the late-afternoon sun, so hemisphere
  // light alone left it at ~30 luma, black plates under the curtain. The bible's
  // near shade for the gorge is blue grey #3c4250 (~65 luma): lift the shade
  // toward it. The lift is scaled by the vertex colour so each plate keeps its
  // value jitter, AO and moss top (a flat emissive evened the wall into one
  // band). Its own program for that one line; still one draw call.
  const gorgeMat = mat.clone();
  gorgeMat.name = "V5StoneGorge";
  // Pass 3: a warm purple-brown shade, and a third of the old lift, so the
  // facets separate instead of evening out into one grey-blue band.
  gorgeMat.emissive.set(0x4a3440);
  gorgeMat.emissiveIntensity = 0.3;
  gorgeMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      // Faded out by 700 away: from a1 and a2 the sunlit wall needs no lift, and lifted it read as snow on the ridge.
      // Plates turned to the sky take more of the lift than those turned down (Carlson's planes, for rock), so the wall reads as big distinct planes.
      "#include <emissivemap_fragment>\n\tfloat liftUp = inverseTransformDirection( normal, viewMatrix ).y;\n\ttotalEmissiveRadiance *= diffuseColor.rgb * 3.0 * ( 0.45 + 0.9 * clamp( liftUp * 0.6 + 0.5, 0.0, 1.0 ) ) * ( 1.0 - smoothstep( 250.0, 700.0, length( vViewPosition ) ) );",
    );
  };
  gorgeMat.customProgramCacheKey = () => "v5-stone-gorge-lift";
  const built = place();
  strataGorge(built.soups.gorge);
  const meshes: THREE.Mesh[] = [];
  const tris: Record<string, number> = {};
  for (const [name, soup] of Object.entries(built.soups)) {
    tris[name] = soup.tris;
    if (!soup.tris) continue;
    const mesh = new THREE.Mesh(soup.geometry(), name === "gorge" ? gorgeMat : mat);
    mesh.name = `Rocks:${name}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
    meshes.push(mesh);
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
      mat.dispose();
      gorgeMat.dispose();
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
        groups: built.groups,
        sheets: built.sheets,
        calls: meshes.length,
        visibleTris,
        visibleCalls,
        buildMs,
      };
    },
  };
};
