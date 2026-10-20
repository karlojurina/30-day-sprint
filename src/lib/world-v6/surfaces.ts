import * as THREE from "three";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { BROOK, GORGE, PATH, PLACES, RIVER, STREAM, WORLD } from "./layout";
import { terrainHeight } from "./terrain";
import { NO_REFLECT_LAYER, REFLECT_ONLY_LAYER } from "./light";
import { NOISE_SIZE, NOISE_TEX_FRAG_GLSL, NOISE_TEX_GLSL, getNoiseTexture, noiseData } from "./noise";
import { all as allFootprints } from "./footprints";

/**
 * V5 surfaces: how the ground looks (world_art_bible.md 1.8, ported from V3's
 * surfaces.ts onto the V5 terrain and rescaled to its size). v6 phase A0 moved
 * every water surface (the sea, the ribbons, the lake's shore band, the falls,
 * the pool, the spray) into water.ts with no visual change; this module keeps
 * the ground and exports what water.ts shares with it: NOISE_GLSL, the
 * water lines' half widths, lightStateOf, chainCompile, the small helpers,
 * and at run time the height texture and the grids (SurfacesApi).
 *
 *   Terrain   The scene's grey "Terrain" and "Terrain:falls" meshes keep their
 *             geometry; their material becomes a painted Lambert. Colour comes
 *             from the place (a grass and a rock colour per vertex, blended by
 *             zone: olive coast, green valley, wet gorge, dry collar and saddle,
 *             golden lake basin, dark forest floor), then per pixel from slope
 *             and height (Carlson's plane values: flat 1.0, slope 0.86, cliff
 *             0.72), rock strata tilted per place, moss on wet ledges, sand at
 *             the sea, damp banks along the water, the trail as a worn ribbon,
 *             brush noise at 1/40 and 1/300 that fades before it aliases, and a
 *             crease, hollow and horizon AO baked into the vertices at load.
 *   Mask      One 1024x1024 RGBA texture over WORLD: R = distance to the trail,
 *             G = distance to the edge of the river, stream and brook, B = worn
 *             ground (camps, pads, the jetty foot), A = forest floor (a default
 *             guess until forest.ts hands its density in, see the contract).
 *   Height    The main grid's heights as a half float texture (water depth for
 *             water.ts), with the grids themselves behind SurfacesApi.
 *   Mirror    The Mirror Lake's reflection draws every 3rd vertex of the grid.
 *
 * v6 (world_art_bible_v6.md 2.3, B3): paintTerrain reads noise.ts's texture
 * (about 11 texture reads in place of v5's per pixel fbm) and paints in flat
 * values with one pixel edges: 4 value patches (sunlit, dry knolls lighter
 * and gold, damp hollows darker and olive, the forest edge 30% darker) 40 to
 * 200 across, brush strokes at two scales (tiles of 400 and 60) fading before
 * they alias, rock strata as offset slabs, a torn sand edge at two scales with
 * wind ripples, a wrack line and a wet band that follows water.ts's swash,
 * the trail red brown, slopes toward the sun warm and away toward the key's
 * near shade, a painted bounce on the gorge's shade walls. Open ground is gold
 * and ochre, Base Camp green and gold, the gorge lifted out of near black.
 *   Contact   A second texture (R8, the mask's grid): how much darker the
 *             ground is. afterAll bakes every footprint (1.2 x its radius,
 *             its shade at the centre) and worn ground under tents and
 *             buildings; cover.ts adds its drifts (addGroundShade).
 *
 * Fog: the terrain is a built-in Lambert, so light.ts's ramp and grade reach
 * it through the stock chunks; chainCompile keeps this module's shader hook
 * alive when light.ts chains its own onto it.
 *
 * Contract for other modules: scene.userData.surfaces (SurfacesApi below).
 * Draw calls added: the mirror terrain, in the lake's reflection pass only.
 */

// ── Palette (display sRGB; converted to linear on load) ──────────────────────
// Low saturation on purpose (bible 1.1): colour comes from the light key, the
// fog ramp and the grade. Grass per zone, rock per place.

// v6 (bible 2.3, decision 21): open ground gold and ochre, Base Camp's meadow
// green and gold, the forest floor dark green brown, trails red brown, the
// gorge lifted out of near black (v5's wet rock and moss sat at albedo ~0.07,
// then AO, hollow and crease took it to ~0.02).
const PAL = {
  coast: "#a88a4c", // a1 and the opening: gold ochre open ground
  valley: "#7f8c4a", // a2 meadow: green, gold where the patches dry
  moss: "#6f7a48", // gorge ledges, lifted
  dry: "#ad9258", // collar, saddle: dry grass
  gold: "#ae955a", // a5 golden grass (the sunset key makes it gold)
  forest: "#303b31", // a6 floor, near black blue green under the dusk key
  far: "#8f8456", // everything else: ochre, olive where damp
  rockWarm: "#8d7e6c", // a1, a2
  rockWet: "#927c68", // the gorge: warm sandstone (v5 #45474a read black)
  rockViolet: "#7a717a", // a5 basin
  rockGrey: "#857d72",
  rockHigh: "#a09a90",
  sand: "#d8c396",
  wetSand: "#8e7e62",
  path: "#9c6c50", // red brown, greyed (bible #852510 rendered)
  pathEdge: "#84624c",
  verge: "#9c8c5e",
  bank: "#434a33",
  worn: "#9c8768",
  forestFloor: "#3c3c2b", // dark green brown
} as const;

/**
 * The night layer (light.ts state.night): the dry sand's colour at night 1,
 * near the wet sand's value, so the beach reads as moonlit sand and not as
 * snow; and the share of its day value the wet band keeps.
 */
const SAND_NIGHT = "#8c8270";
const NIGHT_WET_SAND = 0.8;

export const lin = (hex: string) => new THREE.Color(hex);

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Mask texture resolution over WORLD (8.6 x 10.4 units a texel; the trail and
 *  bank channels are distance fields, so bilinear keeps their edges crisp). */
const MASK_RES = 1024;
/** Trail: distances stored up to this many units (R channel, 0.25 unit steps). */
const TRAIL_RANGE = 64;
/** Water edge: distances stored up to this many units (G channel). */
const BANK_RANGE = 128;
/** Crease radii and the height differences that count as fully creased. */
const CREASE_R = 40;
const CREASE_N = 7;
const HOLLOW_R = 150;
const HOLLOW_N = 28;
/** Horizon AO march: distances out from each vertex, 8 directions. */
const AO_STEPS = [45, 90, 160, 260, 400, 600, 850];

// ── Small helpers ────────────────────────────────────────────────────────────

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));

/** A regular height grid read back from a terrain mesh (row-major, x fastest). */
interface Grid {
  minX: number;
  minZ: number;
  sx: number;
  sz: number;
  vx: number;
  vz: number;
  h: Float32Array;
}

function gridFrom(g: THREE.BufferGeometry): Grid | null {
  const pos = g.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos || pos.count < 4) return null;
  const z0 = pos.getZ(0);
  let vx = 0;
  while (vx < pos.count && Math.abs(pos.getZ(vx) - z0) < 1e-3) vx++;
  if (vx < 2 || pos.count % vx !== 0) return null;
  const vz = pos.count / vx;
  const h = new Float32Array(pos.count);
  for (let k = 0; k < pos.count; k++) h[k] = pos.getY(k);
  return { minX: pos.getX(0), minZ: z0, sx: pos.getX(1) - pos.getX(0), sz: pos.getZ(vx) - z0, vx, vz, h };
}

// ── Zones: the place's grass and rock colour at a point ──────────────────────

const GOLD_LINE: ReadonlyArray<readonly [number, number]> = [
  [1450, 1132], // the collar's rim shelf
  [1450, 690], // the saddle
  [1450, 250], // the meadow
  [1345, -215], // the brook's mouth
  [700, -350], // the lake
];

interface ZoneOut {
  grass: THREE.Color;
  rock: THREE.Color;
  /** 0..1: wet gorge (moss on ledges, steeper strata). */
  wet: number;
}

/** Everything terrainKit reads, as plain numbers (it runs from its source text in a worker). */
interface KitData {
  /** GORGE as [x, z, half width]. */
  gorge: number[][];
  /** GOLD_LINE as [x, z]. */
  gold: number[][];
  lake: number[];
  forest: number[];
  /** The zone palette, linear rgb. */
  C: Record<"coast" | "valley" | "moss" | "dry" | "gold" | "forest" | "far" | "rockWarm" | "rockWet" | "rockViolet" | "rockGrey", number[]>;
  /** CREASE_R, CREASE_N, HOLLOW_R, HOLLOW_N. */
  crease: number[];
  ao: number[];
}

function kitData(): KitData {
  const c = (hex: string) => {
    const k = lin(hex);
    return [k.r, k.g, k.b];
  };
  return {
    gorge: GORGE.map((g) => [g[0], g[1], g[3]]),
    gold: GOLD_LINE.map((g) => [g[0], g[1]]),
    lake: [WORLD.lake.x, WORLD.lake.z, WORLD.lake.r],
    forest: [WORLD.forest.x, WORLD.forest.z, WORLD.forest.r],
    C: {
      coast: c(PAL.coast),
      valley: c(PAL.valley),
      moss: c(PAL.moss),
      dry: c(PAL.dry),
      gold: c(PAL.gold),
      forest: c(PAL.forest),
      far: c(PAL.far),
      rockWarm: c(PAL.rockWarm),
      rockWet: c(PAL.rockWet),
      rockViolet: c(PAL.rockViolet),
      rockGrey: c(PAL.rockGrey),
    },
    crease: [CREASE_R, CREASE_N, HOLLOW_R, HOLLOW_N],
    ao: [...AO_STEPS],
  };
}

interface BakeOut {
  col: Float32Array;
  rock: Uint8Array;
  surf: Int8Array;
}

/**
 * Cheap laptops (load): the zone colours, the grid reads and the terrain's
 * vertex bake (zone colours, crease, hollow, horizon AO) in one function that
 * reads nothing outside its arguments (no imports, no module constants), so
 * its source text runs unchanged in a worker while the other modules install
 * (bakeInWorker). The main thread uses the same function for groundColorAt,
 * the API's heights, and the bake when no worker can start. The arithmetic is
 * v6's, in the same order, so the bake is bit for bit the same either way.
 *   zone(x, z, h, out)  out[0..2] grass rgb, out[3..5] rock rgb, out[6] wet (0..1: wet gorge)
 */
function terrainKit(D: KitData) {
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (a: number, b: number, x: number) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  /** distPoly's result, reused (the vertex bake calls it twice per vertex; no garbage). */
  const DP = { d: 0, i: 0, u: 0 };
  /** Distance from (x, z) to a polyline of [x, z] points; also the segment and share along it.
   *  Returns a shared object: read its fields before the next call. */
  function distPoly(x: number, z: number, pts: number[][]) {
    // Fix 3 (load time): compare squared distances, take the one hypot for the
    // winning segment (it was a hypot per segment per terrain vertex).
    let best2 = Infinity;
    let bi = 0;
    let bu = 0;
    let bex = 0;
    let bez = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0];
      const az = pts[i][1];
      const dx = pts[i + 1][0] - ax;
      const dz = pts[i + 1][1] - az;
      const L2 = dx * dx + dz * dz || 1;
      const u = clamp01(((x - ax) * dx + (z - az) * dz) / L2);
      const ex = x - ax - dx * u;
      const ez = z - az - dz * u;
      const d2 = ex * ex + ez * ez;
      if (d2 < best2) {
        best2 = d2;
        bi = i;
        bu = u;
        bex = ex;
        bez = ez;
      }
    }
    DP.d = best2 === Infinity ? Infinity : Math.hypot(bex, bez);
    DP.i = bi;
    DP.u = bu;
    return DP;
  }
  function inGrid(g: Grid, x: number, z: number): boolean {
    return x >= g.minX && z >= g.minZ && x <= g.minX + g.sx * (g.vx - 1) && z <= g.minZ + g.sz * (g.vz - 1);
  }
  /** Bilinear height on the grid (clamped at its edges). */
  function gridH(g: Grid, x: number, z: number): number {
    const fi = Math.min(g.vx - 1.000001, Math.max(0, (x - g.minX) / g.sx));
    const fj = Math.min(g.vz - 1.000001, Math.max(0, (z - g.minZ) / g.sz));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;
    const k = j * g.vx + i;
    const H = g.h;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + g.vx] * (1 - u) + H[k + g.vx + 1] * u) * v;
  }
  /** The ground as the mesh DRAWS it (its two triangles a,c,b and b,c,e per cell). */
  function drawnH(g: Grid, x: number, z: number): number {
    const fi = Math.min(g.vx - 1.000001, Math.max(0, (x - g.minX) / g.sx));
    const fj = Math.min(g.vz - 1.000001, Math.max(0, (z - g.minZ) / g.sz));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const fx = fi - i;
    const fz = fj - j;
    const k = j * g.vx + i;
    const H = g.h;
    const ha = H[k];
    const hb = H[k + 1];
    const hc = H[k + g.vx];
    const he = H[k + g.vx + 1];
    return fx + fz <= 1 ? ha + (hb - ha) * fx + (hc - ha) * fz : he + (hc - he) * (1 - fx) + (hb - he) * (1 - fz);
  }

  // Zones: the place's grass and rock colour at a point (THREE.Color's copy and
  // lerp written out: this.r += (c.r - this.r) * alpha).
  const C = D.C;
  const [Lx, Lz, Lr] = D.lake;
  const [Fx, Fz, Fr] = D.forest;
  const gorgePts = D.gorge;
  const goldPts = D.gold;
  function zone(x: number, z: number, h: number, out: Float64Array): Float64Array {
    // South of the gorge: the coastal shelf (a1) grading into the valley (a2).
    const south = smooth(1450, 1800, z);
    const coast = smooth(3300, 4000, z);
    let gr = C.far[0];
    let gg = C.far[1];
    let gb = C.far[2];
    let rr = C.rockGrey[0];
    let rg = C.rockGrey[1];
    let rb = C.rockGrey[2];
    let tr = C.valley[0];
    let tg = C.valley[1];
    let tb = C.valley[2];
    tr += (C.coast[0] - tr) * coast;
    tg += (C.coast[1] - tg) * coast;
    tb += (C.coast[2] - tb) * coast;
    gr += (tr - gr) * south;
    gg += (tg - gg) * south;
    gb += (tb - gb) * south;
    rr += (C.rockWarm[0] - rr) * south;
    rg += (C.rockWarm[1] - rg) * south;
    rb += (C.rockWarm[2] - rb) * south;
    // The gorge: wet rock and moss on its walls and floor, below the rim.
    const gq = distPoly(x, z, gorgePts);
    const ga = gorgePts[gq.i];
    const gbp = gorgePts[Math.min(gorgePts.length - 1, gq.i + 1)];
    const halfW = ga[2] + (gbp[2] - ga[2]) * gq.u;
    const gorge = (1 - smooth(halfW + 40, halfW + 260, gq.d)) * (1 - smooth(430, 560, h));
    const gm = gorge * 0.85;
    gr += (C.moss[0] - gr) * gm;
    gg += (C.moss[1] - gg) * gm;
    gb += (C.moss[2] - gb) * gm;
    rr += (C.rockWet[0] - rr) * gorge;
    rg += (C.rockWet[1] - rg) * gorge;
    rb += (C.rockWet[2] - rb) * gorge;
    // The collar, the saddle, the meadow and the lake basin: dry to golden grass.
    const gd = distPoly(x, z, goldPts).d;
    const lakeD = Math.hypot(x - Lx, z - Lz);
    const basin = Math.max(1 - smooth(260, 900, gd), 1 - smooth(Lr + 150, Lr + 900, lakeD)) * (1 - south * 0.9);
    const dg = smooth(700, 200, z);
    tr = C.dry[0];
    tg = C.dry[1];
    tb = C.dry[2];
    tr += (C.gold[0] - tr) * dg;
    tg += (C.gold[1] - tg) * dg;
    tb += (C.gold[2] - tb) * dg;
    gr += (tr - gr) * basin;
    gg += (tg - gg) * basin;
    gb += (tb - gb) * basin;
    const bv = basin * 0.8;
    rr += (C.rockViolet[0] - rr) * bv;
    rg += (C.rockViolet[1] - rg) * bv;
    rb += (C.rockViolet[2] - rb) * bv;
    // The Glowing Forest's floor.
    const fd = Math.hypot(x - Fx, z - Fz);
    const forest = 1 - smooth(Fr * 0.85, Fr * 1.25, fd);
    gr += (C.forest[0] - gr) * forest;
    gg += (C.forest[1] - gg) * forest;
    gb += (C.forest[2] - gb) * forest;
    out[0] = gr;
    out[1] = gg;
    out[2] = gb;
    out[3] = rr;
    out[4] = rg;
    out[5] = rb;
    out[6] = gorge;
    return out;
  }

  /**
   * The vertex bake for one terrain mesh (positions x, y, z per vertex): zone
   * colours, crease, hollow, horizon AO. `main` null = the heightfield
   * (`heightfield`, main thread only).
   */
  function bake(P: ArrayLike<number>, n: number, main: Grid | null, patch: Grid | null, heightfield?: (x: number, z: number) => number): BakeOut {
    const [CREASE_R, CREASE_N, HOLLOW_R, HOLLOW_N] = D.crease;
    const AO_STEPS = D.ao;
    const smoothH = (x: number, z: number) => (patch && inGrid(patch, x, z) ? gridH(patch, x, z) : main ? gridH(main, x, z) : heightfield!(x, z));
    const dirs: Array<[number, number]> = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      dirs.push([Math.cos(a), Math.sin(a)]);
    }
    // Fix 3 (load time): the direction offsets per radius are computed once, and
    // the main grid's bilinear read is inlined for the 64 coarse reads a vertex
    // makes. Same sample points, same arithmetic, same order: identical output.
    const NS = AO_STEPS.length;
    const crX = new Float64Array(8);
    const crZ = new Float64Array(8);
    const hoX = new Float64Array(8);
    const hoZ = new Float64Array(8);
    const aoX = new Float64Array(8 * NS);
    const aoZ = new Float64Array(8 * NS);
    for (let k = 0; k < 8; k++) {
      const [dx, dz] = dirs[k];
      crX[k] = dx * CREASE_R;
      crZ[k] = dz * CREASE_R;
      hoX[k] = dx * HOLLOW_R;
      hoZ[k] = dz * HOLLOW_R;
      for (let s = 0; s < NS; s++) {
        aoX[k * NS + s] = dx * AO_STEPS[s];
        aoZ[k * NS + s] = dz * AO_STEPS[s];
      }
    }
    const cMinX = main ? main.minX : 0;
    const cMinZ = main ? main.minZ : 0;
    const cSx = main ? main.sx : 1;
    const cSz = main ? main.sz : 1;
    const cVx = main ? main.vx : 2;
    const cFiMax = main ? main.vx - 1.000001 : 0;
    const cFjMax = main ? main.vz - 1.000001 : 0;
    const cH = main ? main.h : new Float32Array(4);
    /** coarseH, inlined gridH on the main grid (the heightfield when there is none). */
    const coarseFast = main
      ? (x: number, z: number): number => {
          const fi = Math.min(cFiMax, Math.max(0, (x - cMinX) / cSx));
          const fj = Math.min(cFjMax, Math.max(0, (z - cMinZ) / cSz));
          const i = Math.floor(fi);
          const j = Math.floor(fj);
          const u = fi - i;
          const v = fj - j;
          const k = j * cVx + i;
          return (cH[k] * (1 - u) + cH[k + 1] * u) * (1 - v) + (cH[k + cVx] * (1 - u) + cH[k + cVx + 1] * u) * v;
        }
      : heightfield!;
    const Z = new Float64Array(7);
    const col = new Float32Array(n * 3);
    const rock = new Uint8Array(n * 4);
    const surf = new Int8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3];
      const y = P[i * 3 + 1];
      const z = P[i * 3 + 2];
      zone(x, z, y, Z);
      col[i * 3] = Z[0];
      col[i * 3 + 1] = Z[1];
      col[i * 3 + 2] = Z[2];
      rock[i * 4] = Math.round(clamp01(Z[3]) * 255);
      rock[i * 4 + 1] = Math.round(clamp01(Z[4]) * 255);
      rock[i * 4 + 2] = Math.round(clamp01(Z[5]) * 255);
      rock[i * 4 + 3] = Math.round(clamp01(Z[6]) * 255);
      let sf = 0;
      let sb = 0;
      let occ = 0;
      for (let k = 0; k < 8; k++) {
        sf += smoothH(x + crX[k], z + crZ[k]);
        sb += coarseFast(x + hoX[k], z + hoZ[k]);
        let maxT = 0;
        const base = k * NS;
        for (let s = 0; s < NS; s++) {
          const t = (coarseFast(x + aoX[base + s], z + aoZ[base + s]) - y - 3) / AO_STEPS[s];
          if (t > maxT) maxT = t;
        }
        occ += maxT / Math.sqrt(1 + maxT * maxT);
      }
      const fine = (sf / 8 - y) / CREASE_N;
      const broad = (sb / 8 - y) / HOLLOW_N;
      const ao = 1 - 0.95 * (occ / 8);
      surf[i * 4] = Math.round(Math.max(-1, Math.min(1, fine)) * 127);
      surf[i * 4 + 1] = Math.round(Math.max(-1, Math.min(1, broad)) * 127);
      surf[i * 4 + 2] = Math.round(clamp01(ao) * 127);
      surf[i * 4 + 3] = 0;
    }
    return { col, rock, surf };
  }

  return { zone, inGrid, gridH, drawnH, bake };
}

/** One mesh's bake job: its positions (x, y, z per vertex) and whether it reads the falls patch. */
interface BakeJob {
  P: Float32Array;
  n: number;
}

/**
 * Cheap laptops (load): runs terrainKit's bake for every job in a worker made
 * from the kit's own source, so the ~100 ms (M2) to ~0.5 s (a slow laptop)
 * of vertex work overlaps the other modules' installs. Resolves null when no
 * worker can start or it fails; the caller then bakes on the main thread.
 */
function bakeInWorker(D: KitData, jobs: BakeJob[], main: Grid, patch: Grid | null): { done: Promise<BakeOut[] | null>; cancel: () => void } {
  let worker: Worker | null = null;
  let url: string | null = null;
  const stop = () => {
    worker?.terminate();
    worker = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
  };
  const done = new Promise<BakeOut[] | null>((resolve) => {
    try {
      if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
        resolve(null);
        return;
      }
      const src =
        `const terrainKit = ${terrainKit.toString()};\n` +
        `self.onmessage = (e) => {\n` +
        `  try {\n` +
        `    const d = e.data;\n` +
        `    const kit = terrainKit(d.D);\n` +
        `    const out = d.jobs.map((j) => kit.bake(j.P, j.n, d.main, d.patch));\n` +
        `    self.postMessage({ ok: true, out }, out.flatMap((o) => [o.col.buffer, o.rock.buffer, o.surf.buffer]));\n` +
        `  } catch (err) {\n` +
        `    self.postMessage({ ok: false, err: String(err) });\n` +
        `  }\n` +
        `};\n`;
      url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = (e: MessageEvent<{ ok: boolean; out?: BakeOut[] }>) => {
        const r = e.data;
        const ok = !!r && r.ok && Array.isArray(r.out) && r.out.length === jobs.length && r.out.every((o, i) => o.col.length === jobs[i].n * 3 && o.rock.length === jobs[i].n * 4 && o.surf.length === jobs[i].n * 4);
        stop();
        resolve(ok ? r.out! : null);
      };
      worker.onerror = () => {
        stop();
        resolve(null);
      };
      worker.postMessage({ D, jobs, main, patch });
    } catch {
      stop();
      resolve(null);
    }
  });
  return { done, cancel: stop };
}

// ── The mask texture: trail, water edge, worn ground, forest floor ───────────

interface MaskBounds {
  minX: number;
  minZ: number;
  w: number;
  d: number;
}

/** Rasterise a distance field for a set of segments into one channel (min). */
function splatSegments(
  data: Uint8Array,
  b: MaskBounds,
  ch: number,
  segs: ReadonlyArray<readonly [number, number, number, number, number]>, // ax, az, bx, bz, offset (subtracted)
  range: number,
) {
  const tx = b.w / MASK_RES;
  const tz = b.d / MASK_RES;
  for (const [ax, az, bx, bz, off] of segs) {
    const pad = range + off;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad - b.minX) / tx));
    const i1 = Math.min(MASK_RES - 1, Math.ceil((Math.max(ax, bx) + pad - b.minX) / tx));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - pad - b.minZ) / tz));
    const j1 = Math.min(MASK_RES - 1, Math.ceil((Math.max(az, bz) + pad - b.minZ) / tz));
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz || 1;
    for (let j = j0; j <= j1; j++) {
      const z = b.minZ + (j + 0.5) * tz;
      for (let i = i0; i <= i1; i++) {
        const x = b.minX + (i + 0.5) * tx;
        const u = clamp01(((x - ax) * dx + (z - az) * dz) / L2);
        const d = Math.max(0, Math.hypot(x - ax - dx * u, z - az - dz * u) - off);
        const v = Math.min(255, Math.round((d / range) * 255));
        const o = (j * MASK_RES + i) * 4 + ch;
        if (v < data[o]) data[o] = v;
      }
    }
  }
}

/** Densify a water line (Catmull-Rom through its points) into short segments with a half width each. */
function waterSegments(
  pts: ReadonlyArray<readonly [number, number, number]>,
  halfW: (along: number) => number,
): Array<[number, number, number, number, number]> {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, "centripetal");
  const n = Math.max(8, Math.round(curve.getLength() / 30));
  const p = curve.getSpacedPoints(n);
  const out: Array<[number, number, number, number, number]> = [];
  for (let i = 0; i < n; i++) out.push([p[i].x, p[i].z, p[i + 1].x, p[i + 1].z, halfW((i + 0.5) / n)]);
  return out;
}

/** Stream bed half width (terrain.ts STREAM_W0..W1, square of the way along) plus the bank's lip. Shared with water.ts's ribbons. */
export const streamHalfW = (along: number) => 14 + (58 - 14) * along * along + 1.5;
export const RIVER_HW = 16.5;
export const brookHalfW = (along: number) => 4.5 + 3.5 * along;

function buildMask(b: MaskBounds, forestAt: ((x: number, z: number) => number) | null) {
  const data = new Uint8Array(MASK_RES * MASK_RES * 4);
  for (let k = 0; k < data.length; k += 4) {
    data[k] = 255;
    data[k + 1] = 255;
    data[k + 2] = 0;
    data[k + 3] = 0;
  }
  // R: the trail, on the ground only (not under it, not floating over it).
  const trail: Array<[number, number, number, number, number]> = [];
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i];
    const c = PATH[i + 1];
    if (a.under) continue;
    if (Math.abs(a.y - terrainHeight(a.x, a.z)) > 25 || Math.abs(c.y - terrainHeight(c.x, c.z)) > 25) continue;
    trail.push([a.x, a.z, c.x, c.z, 0]);
  }
  splatSegments(data, b, 0, trail, TRAIL_RANGE);
  // G: the water's edge (distance past each line's half width).
  const water = [
    ...waterSegments(RIVER, () => RIVER_HW),
    ...waterSegments(STREAM, streamHalfW),
    ...waterSegments(BROOK, brookHalfW),
  ];
  splatSegments(data, b, 1, water, BANK_RANGE);
  // B: worn ground round the camps, the pads and the jetty foot, feathered.
  const worn: Array<readonly [number, number, number, number]> = [];
  for (const p of PLACES) {
    if (p.id === "a1") worn.push([p.pos.x, p.pos.z, 38, 22]);
    if (p.id === "a2") worn.push([p.pos.x, p.pos.z, 26, 14]); // v6: the lookout's footing only; tents bring their own (afterAll)
  }
  worn.push([1350, -440, 30, 18]); // jetty foot
  worn.push([PATH[0].x, PATH[0].z, 22, 14]); // dock foot
  const tx = b.w / MASK_RES;
  const tz = b.d / MASK_RES;
  for (const [cx, cz, r, f] of worn) {
    const i0 = Math.max(0, Math.floor((cx - r - f - b.minX) / tx));
    const i1 = Math.min(MASK_RES - 1, Math.ceil((cx + r + f - b.minX) / tx));
    const j0 = Math.max(0, Math.floor((cz - r - f - b.minZ) / tz));
    const j1 = Math.min(MASK_RES - 1, Math.ceil((cz + r + f - b.minZ) / tz));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = b.minX + (i + 0.5) * tx;
        const z = b.minZ + (j + 0.5) * tz;
        const v = Math.round(255 * (1 - smooth(r, r + f, Math.hypot(x - cx, z - cz))));
        const o = (j * MASK_RES + i) * 4 + 2;
        if (v > data[o]) data[o] = v;
      }
    }
  }
  // Cheap laptops (load): the A channel is filled later, by forest.ts's
  // setForestMask (every texel) or, when forest.ts never hands one in, by
  // afterAll's default guess, so the load does not paint it twice.
  if (forestAt) fillForest(data, b, forestAt);
  return data;
}

/** A: forest floor, sampled every 4th texel and filled bilinearly (the density is smooth). */
function fillForest(data: Uint8Array, b: MaskBounds, forestAt: ((x: number, z: number) => number) | null) {
  const S = 4;
  const n = MASK_RES / S + 1;
  const coarse = new Float32Array(n * n);
  const F = WORLD.forest;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = b.minX + (i * S * b.w) / MASK_RES;
      const z = b.minZ + (j * S * b.d) / MASK_RES;
      let v: number;
      if (forestAt) v = forestAt(x, z);
      else {
        // Default guess until forest.ts hands its density in: the Glowing
        // Forest, and a soft darkening on mid slopes of the wild zones.
        const inF = 1 - smooth(F.r * 0.8, F.r * 1.1, Math.hypot(x - F.x, z - F.z));
        v = inF;
      }
      coarse[j * n + i] = clamp01(Number.isFinite(v) ? v : 0);
    }
  }
  for (let j = 0; j < MASK_RES; j++) {
    const fj = j / S;
    const j0 = Math.min(n - 2, Math.floor(fj));
    const v = fj - j0;
    for (let i = 0; i < MASK_RES; i++) {
      const fi = i / S;
      const i0 = Math.min(n - 2, Math.floor(fi));
      const u = fi - i0;
      const k = j0 * n + i0;
      const val = (coarse[k] * (1 - u) + coarse[k + 1] * u) * (1 - v) + (coarse[k + n] * (1 - u) + coarse[k + n + 1] * u) * v;
      data[(j * MASK_RES + i) * 4 + 3] = Math.round(255 * val);
    }
  }
}

// ── GLSL ─────────────────────────────────────────────────────────────────────

/** Value noise, fbm and luma in GLSL (sHash, sNoise, sFbm, sLuma), shared with water.ts's shaders. */
export const NOISE_GLSL = /* glsl */ `
float sHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float sNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( sHash( i ), sHash( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( sHash( i + vec2( 0.0, 1.0 ) ), sHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float sFbm( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 3; i++ ) {
    s += a * sNoise( p );
    p = mat2( 1.6, 1.2, -1.2, 1.6 ) * p + 17.3;
    a *= 0.5;
  }
  return s / 0.875;
}
float sLuma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
`;

const TERRAIN_VERT_PARS = /* glsl */ `
attribute vec4 aRock;
attribute vec4 aSurf;
varying vec4 vRock;
varying vec4 vSurf;
varying vec3 vSW;
varying vec3 vSN;
`;

const TERRAIN_VERT_MAIN = /* glsl */ `
vRock = aRock;
vSurf = aSurf;
vSW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vSN = normalize( mat3( modelMatrix ) * objectNormal );
`;

const TERRAIN_FRAG_PARS = /* glsl */ `
varying vec4 vRock;
varying vec4 vSurf;
varying vec3 vSW;
varying vec3 vSN;
uniform sampler2D uMask;
uniform vec4 uMaskB;
uniform sampler2D uContact;
uniform sampler2D uNoiseTex;
uniform sampler2D uShadeTex;
uniform vec4 uShadeB;
uniform float uShadeOn;
uniform vec3 uSand, uWetSand, uPath, uPathEdge, uVerge, uBank, uWorn, uMoss, uRockHigh, uForestFloor, uDry;
uniform vec3 uSunDirS;
uniform vec3 uShadeHue;
uniform vec4 uLake;
uniform float uSwash;
// Final pass E: the gully mountain's flank (x strength, y lit gain, z crest
// gain); its warm light, added to the emissive after the paint.
uniform vec3 uFlank;
vec3 gFlank = vec3( 0.0 );
${NOISE_GLSL}
${NOISE_TEX_GLSL}
${NOISE_TEX_FRAG_GLSL}
vec2 tRot( vec2 p, float a ) { float c = cos( a ), s = sin( a ); return vec2( c * p.x - s * p.y, s * p.x + c * p.y ); }

// v6 (bible 2.3): the ground painted in flat values with crisp edges, read
// from the noise texture (10 texture reads replace v5's 7 noises and 28
// hashes). Order: zone colour, 4 value patches, forest edge and floor, rock
// and strata, the torn sand edge and the wet band, banks, worn ground, the
// trail, contact shade, brush strokes at two scales, baked shade, Carlson's
// planes with hue, tree shadows.
vec3 paintTerrain( vec3 grass ) {
  vec2 xz = vSW.xz;
  float h = vSW.y;
  vec3 N = normalize( vSN );
  float ny = N.y;
  float slope = 1.0 - ny;
  float crease = vSurf.x;   // + concave, - convex
  float hollow = vSurf.y;   // + sits below its surroundings
  float ao = vSurf.z;       // 1 open sky, 0 closed in
  float wet = vRock.a;

  // World units covered by one pixel: each fine layer fades before it aliases.
  float fw = length( fwidth( xz ) );
  float fineK = 1.0 - smoothstep( 0.5, 1.5, fw );
  float bigK = 1.0 - smoothstep( 3.0, 10.0, fw );

  vec4 nP = texture2D( uNoiseTex, xz / 610.0 );
  vec4 nQ = texture2D( uNoiseTex, tRot( xz, 0.61 ) / 151.0 );
  float n300 = nP.r;
  float n40 = nQ.r;

  vec2 muv = ( xz - uMaskB.xy ) * uMaskB.zw;
  float inMask = step( 0.0, muv.x ) * step( muv.x, 1.0 ) * step( 0.0, muv.y ) * step( muv.y, 1.0 );
  vec4 mk = mix( vec4( 1.0, 1.0, 0.0, 0.0 ), texture2D( uMask, muv ), inMask );
  float contact = texture2D( uContact, muv ).r * inMask;

  // Four flat values: sunlit base, dry knolls (lighter, toward gold), damp
  // hollows (darker, cooler, olive), with one pixel edges. Patches 40 to 200
  // across: value noise (features ~90) and cells (~70) at big tiles, broken
  // at the edge by the mid layer, so they survive the mips at a distance.
  vec4 nC = texture2D( uNoiseTex, tRot( xz, 1.37 ) / 1100.0 );
  float patchV = nP.r * 0.5 + ( 1.0 - nC.g ) * 0.38 + ( nQ.r - 0.5 ) * 0.2;
  vec3 c = grass;
  float dryK = pStep( 0.6, patchV + clamp( -crease, 0.0, 1.0 ) * 0.3 );
  float dampK = 1.0 - pStep( 0.36, patchV - clamp( hollow, 0.0, 1.0 ) * 0.35 );
  c *= mix( vec3( 1.0 ), vec3( 1.2, 1.12, 0.82 ), dryK );
  c *= mix( vec3( 1.0 ), vec3( 0.8, 0.86, 0.8 ), dampK );
  // The forest: its edge band in shade (30% darker), its heart the floor.
  float fEdge = pStep( 0.26, mk.a + ( nQ.r - 0.5 ) * 0.22 );
  float fCore = pStep( 0.58, mk.a + ( nQ.r - 0.5 ) * 0.22 );
  c *= mix( 1.0, 0.72, fEdge );
  c = mix( c, uForestFloor * ( 0.88 + 0.24 * nQ.b ), fCore * 0.85 );

  // Final pass: the gully (bible 1.11: rock steps up a notch). Its walls get
  // the gorge's facets below; its floor is rock and scree, never the gold
  // slope the steps sat on like pavers.
  float gdx = abs( xz.x - ${WORLD.gully.x.toFixed(1)} );
  float gullyK = ( 1.0 - smoothstep( ${(WORLD.gully.halfW + 40).toFixed(1)}, ${(WORLD.gully.halfW + 110).toFixed(1)}, gdx ) ) * smoothstep( ${(WORLD.gully.z1 - 40).toFixed(1)}, ${(WORLD.gully.z1 + 10).toFixed(1)}, xz.y ) * ( 1.0 - smoothstep( ${(WORLD.gully.z0 + 10).toFixed(1)}, ${(WORLD.gully.z0 + 60).toFixed(1)}, xz.y ) );
  float gullyFloor = gullyK * ( 1.0 - pStep( ${(WORLD.gully.halfW + 3).toFixed(1)}, gdx + ( n40 - 0.5 ) * 10.0 ) );
  // Final pass C: the Climb's sheer face either side of the notch (the gully
  // frame's big dark flat plane: its top is too high for the wet gorge) gets
  // the gorge walls' rock planes too.
  float climbK = smoothstep( ${(WORLD.climb.topZ - 60).toFixed(1)}, ${(WORLD.climb.topZ - 20).toFixed(1)}, xz.y ) * ( 1.0 - smoothstep( ${(WORLD.climb.footZ + 20).toFixed(1)}, ${(WORLD.climb.footZ + 70).toFixed(1)}, xz.y ) ) * smoothstep( ${(WORLD.climb.x0 - 40).toFixed(1)}, ${(WORLD.climb.x0 + 30).toFixed(1)}, xz.x ) * ( 1.0 - smoothstep( ${(WORLD.climb.x1 - 30).toFixed(1)}, ${(WORLD.climb.x1 + 40).toFixed(1)}, xz.x ) );

  // Rock on steep faces (a crisp edge), and more of it high up.
  float rock = pStep( 0.36, slope + ( n300 - 0.5 ) * 0.12 + ( n40 - 0.5 ) * 0.06 );
  rock = max( rock, gullyFloor * pStep( 0.28, n40 * 0.7 + nQ.g * 0.5 ) );
  rock = max( rock, smoothstep( 1180.0, 1320.0, h + ( nP.r - 0.5 ) * 160.0 ) * 0.8 );
  // Strata: bands along one tilted plane per place (the gorge dips east 18
  // degrees, elsewhere 12), broken by noise; ledges catch a lighter edge.
  // v6: slabs, not wood grain. Bands 24 high on the place's tilted plane,
  // offset in steps per column (value noise read in xz runs in vertical
  // columns up a wall, so the steps are the joints between blocks): each
  // slab a flat body, a lit strip on its ledge, a dark line under it.
  float dip = mix( 0.21, 0.325, wet );
  vec3 Nf = N;
  float facetK = 0.0;
  float facetLit = 0.0;
  float facetShade = 0.0;
  float facetCleft = 0.0;
  float facetRow = 0.0;
  float facetTone = 0.0;
  float fDist = length( vSW - cameraPosition );
  // Final pass D: close up (under ~400) one buttress plane filled a third of
  // the frame and read as a flat orange slab (the curtain's walls from the
  // cave's outside). There the 58 wide facets become a second value step,
  // the 80 high ledges come back and each plane takes its own value. Gone by
  // 420, so the a3 stop (the walls from 400 to 900) keeps its look.
  float nearF = 1.0 - smoothstep( 220.0, 420.0, fDist );
  // Final pass C (performance): the strata, ledges, facets and rock colour
  // run only where there is rock (two texture reads and the facet maths
  // saved on every grass pixel, ~0.2 ms at a1, a3 and a4); their derivatives
  // are taken before the branch (sB's from h + x dip and n300, its column
  // step being flat inside a block).
  float fwHD = fwidth( h + xz.x * dip );
  float fwN300 = fwidth( n300 );
  float fwLedgeN = fwidth( n40 * 0.6 + n300 * 0.5 );
  if ( rock > 0.001 ) {
    vec4 nJ = texture2D( uNoiseTex, tRot( xz, 0.9 ) / 230.0 );
    // Fix round 2: both layers only on faces steeper than about 50 degrees and
    // gone past ~1,500 (bible 2.3: far terrain is clean planes; fw alone never
    // fades a wall that faces the camera), the fine wobble halved.
    // Fix 3: straighter (a quarter of the wobble) and fainter, so the walls read
    // as rock ledges, not wood veneer.
    // The joints between blocks: the column offsets read at 70 unit cell
    // centres, so each block's offset is constant and its joints are straight
    // vertical cracks (noise contours made them melt into S-curves and drips).
    float nK = texture2D( uNoiseTex, tRot( ( floor( xz / 70.0 ) + 0.5 ) * 70.0, 0.9 ) / 230.0 ).r;
    float sCoord = ( h + xz.x * dip ) / 30.0 + floor( nK * 3.0 ) * 0.3 + n300 * 0.12;
    float band = fract( sCoord );
    float farS = 1.0 - smoothstep( 1100.0, 1700.0, length( vSW - cameraPosition ) );
    float strataFade = ( 1.0 - smoothstep( 1.5, 6.0, fw ) ) * farS;
    float steep = smoothstep( 0.3, 0.42, slope );
    // Final pass B: the strata and ledges only on real cliffs (on the massifs' 40 to 55 degree faces they stacked into terraces).
    float cliffK = smoothstep( 0.45, 0.58, slope );
    float slab = 1.0 + 0.07 * ( 1.0 - smoothstep( 0.1, 0.14, band ) ) - 0.09 * smoothstep( 0.86, 0.9, band );
    vec3 rc = vRock.rgb;
    // Fix round 1: the big ledges (~80 high on the same tilted plane, their own
    // column steps), each a lit ledge top and a dark undercut under it, so a
    // wall reads as stacked slabs from 1,000 away where the 24 bands have faded.
    // The column steps (nJ.r) offset each ledge, so the joints read as breaks
    // in the ledges (drawn joint lines followed the noise's contours and read
    // as a topographic map: tried and removed).
    // Fix round 2: half the wobble (the ledges read as wood grain), the dark
    // undercut a third as thick, only on faces steeper than about 50 degrees
    // (the gentle far massifs read as sand ripples), and the lit ledge top a
    // little greyer (a4's accent hue).
    float sB = ( h + xz.x * dip ) / 80.0 + floor( nK * 3.0 ) * 0.16 + n300 * 0.06;
    float bB = fract( sB );
    float fwsB = fwHD / 80.0 + 0.06 * fwN300;
    float bwB = max( fwsB * 1.2, 0.012 );

    // Final pass B: the gorge's walls painted as big rock buttresses (the 58
    // wide facets, one per 80 high ledge, read as a quilt of equal trapezoids:
    // Lovro's "rocks are rectangles"). Each primary block is 150 to 260 along
    // the wall (a hashed width per column) and 2 to 3 ledges high (staggered per
    // column), two planes meeting at a ridge turned a hashed amount, so half a
    // screen of wall breaks into 4 to 6 big lit and shade planes. The old 58
    // wide facets stay as a faint second layer on the normal only. Every 3rd
    // column joint is a dark cleft. The wall's direction is snapped to 45 degree
    // steps, so a column is a straight run along each stretch of wall.
    // Final pass C (performance): the block runs only where it paints (it cost
    // 0.5 to 0.9 ms a frame on every terrain pixel), its one derivative taken
    // before the rock branch (fwsB), and one joint hash where it took three.
    // Calmer far off (a4 sees the falls wall from ~900: half strength).
    facetK = steep * rock * farS * ( 1.0 - smoothstep( 5.0, 20.0, fw ) ) * max( smoothstep( 0.15, 0.5, wet ), max( gullyK, climbK ) ) * ( 1.0 - 0.5 * smoothstep( 450.0, 950.0, fDist ) );
    if ( facetK > 0.002 ) {
      float fta = atan( N.x, -N.z );
      float fsn = floor( fta / 0.7854 + 0.5 );
      vec2 ft = vec2( cos( fsn * 0.7854 ), sin( fsn * 0.7854 ) );
      // One joint set per wall direction: the joints lean together, as real rock does.
      float jl = ( fract( sin( fsn * 7.31 + 1.7 ) * 4375.85 ) - 0.5 ) * 0.5;
      float pu = ( dot( xz, ft ) + h * jl ) / 205.0 + fsn * 0.37;
      float pk = floor( pu + 0.5 );
      float bk = pk + 0.28 * ( fract( sin( pk * 23.17 + fsn * 3.1 ) * 43758.5453 ) - 0.5 );
      // The neighbour joint hashed once (the other one is bk): pu sits between b0 and b1.
      float lo = pu < bk ? 1.0 : 0.0;
      float pn = pk + 1.0 - 2.0 * lo;
      float bn = pn + 0.28 * ( fract( sin( pn * 23.17 + fsn * 3.1 ) * 43758.5453 ) - 0.5 );
      float pc = pk - lo;
      float b0 = mix( bk, bn, lo );
      float b1 = mix( bn, bk, lo );
      float lf = ( pu - b0 ) / max( b1 - b0, 0.1 );
      float hC = fract( sin( pc * 51.37 + fsn * 9.13 ) * 24634.6345 );
      float sP = sB / ( 2.0 + fract( hC * 7.3 ) ) + hC;
      float pRow = floor( sP );
      float pv = fract( sP );
      float bwP = max( fwsB * 1.2 / ( 2.0 + fract( hC * 7.3 ) ), 0.01 );
      float ph1 = fract( sin( pc * 12.9898 + pRow * 78.233 + fsn * 37.719 ) * 43758.5453 );
      float ph2 = fract( ph1 * 91.7 + 0.31 );
      float ph3 = fract( ph1 * 47.3 + 0.77 );
      float pSgn = ph2 < 0.5 ? -1.0 : 1.0;
      float pSide = step( 0.3 + 0.4 * ph3 + ( pv - 0.5 ) * 0.18 * pSgn, lf );
      float yawP = pSgn * mix( 0.35 + 0.45 * ph1, -( 0.3 + 0.4 * ph2 ), pSide );
      float leanP = ( ph3 - 0.5 ) * 0.3 + 0.2 * ( 1.0 - smoothstep( 0.0, 0.22, pv ) );
      // The faint second layer: the old 58 wide facets on each 80 high ledge.
      float fBand = floor( sB );
      float fh0 = fract( sin( fBand * 17.13 + fsn * 5.71 ) * 24634.6345 );
      float fuW = dot( xz, ft ) / 58.0 + nK * 0.6 + fh0 * 0.7 + bB * ( fh0 - 0.5 ) * 0.6;
      float fh1 = fract( sin( floor( fuW ) * 12.9898 + fBand * 78.233 + fsn * 37.719 ) * 43758.5453 );
      float fSgn = fract( fh1 * 91.7 + 0.31 ) < 0.5 ? -1.0 : 1.0;
      float fSide = step( 0.3 + 0.4 * fract( fh1 * 47.3 + 0.77 ), fract( fuW ) );
      float yaw2 = fSgn * mix( 0.35 + 0.5 * fh1, -( 0.3 + 0.45 * fract( fh1 * 91.7 + 0.31 ) ), fSide );
      float yaw = yawP + 0.25 * yaw2;
      float cy = cos( yaw ), sy = sin( yaw );
      vec2 nh = vec2( cy * N.x - sy * N.z, sy * N.x + cy * N.z );
      Nf = normalize( mix( N, normalize( vec3( nh.x, N.y + leanP, nh.y ) ), facetK ) );
      // The value step from the primary planes only: the half of each buttress
      // turned toward the sun's side lighter and warmer, the other darker and
      // cooler (read against the sun's azimuth, so a wall in shade still breaks).
      float cp = cos( yawP ), sp = sin( yawP );
      vec2 nhP = vec2( cp * N.x - sp * N.z, sp * N.x + cp * N.z );
      vec2 fsx = normalize( uSunDirS.xz + vec2( 1e-4, 0.0 ) );
      float fDh = dot( normalize( nhP + vec2( 1e-5 ) ), fsx ) - dot( normalize( N.xz + vec2( 1e-5 ) ), fsx );
      facetLit = facetK * step( 0.1, fDh );
      facetShade = facetK * step( fDh, -0.1 );
      float fkN = facetK * nearF;
      if ( fkN > 0.002 ) {
        float c2 = cos( yaw2 ), s2 = sin( yaw2 );
        vec2 nh2 = vec2( c2 * N.x - s2 * N.z, s2 * N.x + c2 * N.z );
        float fDh2 = dot( normalize( nh2 + vec2( 1e-5 ) ), fsx ) - dot( normalize( N.xz + vec2( 1e-5 ) ), fsx );
        facetLit += fkN * 0.45 * step( 0.08, fDh2 );
        facetShade += fkN * 0.45 * step( fDh2, -0.08 );
        facetTone = fkN * ( ph1 - 0.5 ) * 0.18;
      }
      // A dark cleft at every 3rd column joint (2.5 units, wider far off), and
      // each block's top a thin lit ledge over a shadowed undercut.
      float dl = ( pu - b0 ) * 205.0;
      float cw = 2.5 + fw * 1.5;
      facetCleft = facetK * step( fract( hC * 13.7 ), 0.34 ) * ( 1.0 - smoothstep( cw, cw + max( fw, 0.3 ), dl ) );
      facetRow = facetK * ( 0.3 * ( 1.0 - smoothstep( 0.05, 0.05 + bwP, pv ) ) - 0.35 * smoothstep( 0.93 - bwP, 0.93, pv ) );
    }
    rc *= mix( 1.0, slab * ( 0.9 + 0.2 * floor( nJ.g * 3.0 ) / 2.0 ), strataFade * cliffK * ( 1.0 - facetK ) * mix( 1.0, smoothstep( 0.1, 0.3, wet ), smoothstep( 600.0, 900.0, fDist ) ) );
    float ledgeTop = 1.0 - smoothstep( 0.075, 0.075 + bwB, bB );
    // Fix 3: a real shadowed undercut (14% of each ledge), each slab its own value.
    float undercut = smoothstep( 0.86 - bwB, 0.86, bB );
    float slabV = floor( fract( floor( sB ) * 0.618 + floor( nK * 3.0 ) * 0.21 ) * 3.0 ) / 2.0;
    // Final pass B: never on faces under about 50 degrees, and gone by ~1,300
    // (the far massifs read as layer cakes and sand dunes with them).
    float bigFade = ( 1.0 - smoothstep( 6.0, 24.0, fw ) ) * cliffK * ( 1.0 - smoothstep( 800.0, 1300.0, fDist ) ) * mix( 1.0, smoothstep( 0.1, 0.3, wet ), smoothstep( 600.0, 900.0, fDist ) ) * ( 1.0 - 0.7 * facetK * ( 1.0 - nearF ) );
    rc *= mix( 1.0, ( 1.0 + 0.35 * ledgeTop - 0.4 * undercut ) * ( 1.0 + 0.2 * ( slabV - 0.5 ) ), bigFade );
    rc = mix( rc, vec3( sLuma( rc ) ), 0.3 * ledgeTop * bigFade );
    rc *= 1.0 + facetRow;
    rc *= 0.88 + 0.22 * pBandsW( n300, 0.36, 0.66, fwN300 * 1.1 + 0.0015 );
    rc = mix( rc, uRockHigh, smoothstep( 1250.0, 1450.0, h + ( nP.r - 0.5 ) * 120.0 ) * 0.6 );
    // Moss on the wet gorge's gentler ledges.
    float ledge = smoothstep( 0.35, 0.6, ny ) * wet * pStepW( 0.55, n40 * 0.6 + n300 * 0.5, fwLedgeN * 1.1 + 0.0015 );
    rc = mix( rc, uMoss, ledge * 0.85 );
    c = mix( c, rc, rock );
  }

  // Fix 3: the far massifs painted like Firewatch's far ridges (they were
  // smooth pale sheets, "one single hill"). Past ~1,400, where the near
  // detail has faded: a dark forested foot under a ragged treeline, pale
  // scree in the hollows under the rock, rock bands with lit lips and shadowed
  // undercuts near the top, a lighter crest, posterised lit and shade planes.
  // Final pass C: branched (it cost ~0.6 ms at a3 and a4, where it paints
  // nothing); its pStep widths come from derivatives taken before the branch
  // (the noise terms' from the pixel's footprint, ~7 value steps per tile).
  float farW = smoothstep( 1400.0, 2600.0, length( vSW - cameraPosition ) );
  // Final pass B: the massifs above the valley floor get the same painting
  // from ~900 (a1's central peak and the burst's massifs were smooth tan
  // cones); never the wet gorge, never the meadows under ~450.
  farW = max( farW, smoothstep( 900.0, 1400.0, length( vSW - cameraPosition ) ) * ( 1.0 - smoothstep( 0.1, 0.3, wet ) ) * smoothstep( 440.0, 560.0, h ) );
  float fwH = fwidth( h ) * 1.1 + 0.0015;
  float fwCr = fwidth( crease );
  float fwHo = fwidth( hollow );
  float fwLk = fwidth( dot( N, uSunDirS ) ) * 1.1 + 0.0015;
  float fwSF = fwidth( h + xz.x * dip ) / 110.0;
  float fwNA = fw * 7.0 / 2300.0;
  float fwNB = fw * 7.0 / 520.0;
  if ( farW > 0.001 ) {
    vec4 fA = texture2D( uNoiseTex, tRot( xz, 0.43 ) / 2300.0 );
    vec4 fB = texture2D( uNoiseTex, tRot( xz, 1.9 ) / 520.0 );
    vec3 cF = c;
    // The massifs run ~300 to ~1,400 up: treeline ~560, rock from ~780.
    // Final pass B: the skirt reaches ~900 (the massifs were one tan hue top to toe).
    float tl = 860.0 + ( fA.r - 0.5 ) * 260.0 + ( fB.r - 0.5 ) * 90.0;
    float rl = tl + 220.0 + ( fB.b - 0.5 ) * 120.0;
    float gentle = 1.0 - smoothstep( 0.45, 0.62, slope );
    float aboveSea = smoothstep( 14.0, 40.0, h );
    // The forested foot: dark blue green masses with a ragged top, a few clearings.
    float forestF = ( 1.0 - pStepW( tl, h, fwH ) ) * gentle * aboveSea * pStepW( 0.3, fA.b * 0.7 + fB.r * 0.3, ( 0.7 * fwNA + 0.3 * fwNB ) * 1.1 + 0.0015 );
    // Tree stipple: the skirt is crowns and gaps, never a flat felt.
    float stip = texture2D( uNoiseTex, tRot( xz, 2.3 ) / 23.0 ).g;
    vec3 fCol = mix( vec3( sLuma( cF ) ), cF, 0.4 ) * vec3( 0.36, 0.45, 0.42 ) * ( 0.8 + 0.4 * step( 0.5, stip ) );
    cF = mix( cF, fCol, forestF );
    // Scree: pale grey fans in the broad hollows between treeline and rock.
    float midZone = pStepW( tl - 60.0, h, fwH ) * ( 1.0 - pStepW( rl + 80.0, h, fwH ) ) * smoothstep( 0.12, 0.25, slope );
    float scree = pStepW( 0.3, clamp( hollow, 0.0, 1.0 ) + ( fA.g - 0.5 ) * 0.35, ( fwHo + 0.35 * fwNA ) * 1.1 + 0.0015 ) * midZone;
    cF = mix( cF, vec3( sLuma( cF ) ) * vec3( 1.2, 1.14, 1.06 ) * 1.25, scree * 0.75 );
    // Rock bands: near the top, and on every steep wall (the gorge's north
    // face was a flat pale sheet from the opening). On the place's dip, so
    // they carry on the near ledges; broken into blocks by column steps.
    float wall = smoothstep( 0.5, 0.7, slope ) * aboveSea;
    // Steep faces only: on gentler domes the bands follow closed height
    // contours and read as camouflage blotches (the burst's massifs).
    float rockF = max( pStepW( rl, h, fwH ) * smoothstep( 0.4, 0.52, slope ), wall );
    float fQ = texture2D( uNoiseTex, tRot( ( floor( xz / 140.0 ) + 0.5 ) * 140.0, 1.9 ) / 520.0 ).r;
    float sF = ( h + xz.x * dip ) / 110.0 + floor( fQ * 4.0 ) * 0.27;
    float bF = fract( sF );
    float bwF = max( fwSF * 1.2, 0.02 );
    float lipF = 1.0 - smoothstep( 0.1, 0.1 + bwF, bF );
    float underF = smoothstep( 0.74 - bwF, 0.74, bF );
    float slabF = floor( fract( floor( sF ) * 0.618 + fQ * 0.35 ) * 3.0 ) / 2.0;
    cF = mix( cF, mix( cF, vRock.rgb * 1.1, 0.6 ), rockF );
    // Final pass B: the bands only on true walls (on the peaks they stacked
    // into terraces); the bare rock gets couloirs down its creases instead.
    cF *= 1.0 + wall * smoothstep( 0.1, 0.3, wet ) * ( 0.34 * lipF - 0.5 * underF + 0.16 * ( slabF - 0.5 ) );
    cF *= 1.0 - 0.14 * wall;
    float bare = pStepW( tl + 40.0, h, fwH ) * aboveSea;
    cF *= 1.0 - 0.28 * bare * pStepW( 0.1, crease + ( fB.g - 0.5 ) * 0.12, ( fwCr + 0.12 * fwNB ) * 1.1 + 0.0015 );
    // Value steps by elevation (the ridge ladder): lighter toward each crest, ridges lifted.
    float wHB = fwH + 90.0 * fwNB * 1.1;
    cF *= 1.0 + 0.1 * pStepW( rl + 120.0, h + ( fB.b - 0.5 ) * 90.0, wHB ) + 0.1 * pStepW( rl + 320.0, h + ( fB.b - 0.5 ) * 90.0, wHB ) + 0.14 * pStepW( 0.12, -crease, fwCr * 1.1 + 0.0015 );
    // Lit and shade planes, posterised.
    float lkF = dot( N, uSunDirS );
    cF *= mix( 0.66, 1.0, pStepW( 0.06, lkF, fwLk ) ) * ( 1.0 + 0.12 * pStepW( 0.5, lkF, fwLk ) );
    c = mix( c, cF, farW );
  }

  // The sea's shore: a torn sand edge at two scales (2 to 6 units of
  // feather, never a gradient), wind ripples, a darker wrack line under the
  // grass, and a wet band that follows the sea's swash.
  // Final pass C: only below the highest sand line (6.5 + 3 + 1.2), which
  // saves its three texture reads on every other pixel (~0.2 ms a frame).
  float sand = 0.0;
  if ( h < 11.0 ) {
    float eBig = texture2D( uNoiseTex, xz / 170.0 ).r;
    float eSmall = texture2D( uNoiseTex, tRot( xz, 1.1 ) / 26.0 ).g;
    float sandH = 6.5 + ( eBig - 0.5 ) * 6.0 + ( eSmall - 0.5 ) * 2.4;
    sand = ( 1.0 - smoothstep( sandH - 0.22, sandH + 0.22, h ) ) * ( 1.0 - smoothstep( 0.35, 0.55, slope ) );
    float sr = texture2D( uNoiseTex, tRot( xz, 0.2 ) / 38.0 ).b;
    vec3 sc = uSand * ( 0.93 + 0.1 * pBandsW( sr, 0.4, 0.72, fw * 7.0 / 38.0 * 1.1 + 0.0015 ) * fineK );
    sc *= 1.0 - 0.13 * smoothstep( sandH - 1.8, sandH - 0.4, h );
    float sw = 0.5 + 0.5 * sin( uSwash + xz.x * 0.006 + xz.y * 0.004 );
    float wetH = 0.9 + 1.5 * sw + ( eSmall - 0.5 ) * 0.5;
    float wetK = 1.0 - smoothstep( wetH - 0.12, wetH + 0.12, h );
    sc = mix( sc, uWetSand * ( 0.94 + 0.08 * sr ), wetK );
    sc = mix( sc, uWetSand * 0.8, 1.0 - smoothstep( -0.4, 0.6, h ) );
    c = mix( c, sc, sand );
  }

  // The lake's shore: a damp darker ring just above the water.
  float lakeD = length( xz - uLake.xy );
  float lakeShore = ( 1.0 - smoothstep( uLake.w + 0.5, uLake.w + 4.0 + 2.0 * n40, h ) ) * ( 1.0 - smoothstep( uLake.z - 20.0, uLake.z + 120.0, lakeD ) );
  c = mix( c, uBank, lakeShore * 0.55 );

  // Banks: damp and dark along the river, the stream and the brook.
  float bankD = mk.g * ${BANK_RANGE.toFixed(1)};
  float bank = 1.0 - smoothstep( 0.0, 18.0 + 10.0 * n40, bankD );
  c = mix( c, uBank * ( 0.9 + 0.2 * n40 ), bank * 0.7 * ( 1.0 - rock * 0.4 ) );

  // Worn ground round the camps and under the tents.
  c = mix( c, uWorn * ( 0.9 + 0.2 * n40 ), pStep( 0.5, mk.b + ( nQ.g - 0.5 ) * 0.3 ) * 0.8 * ( 1.0 - rock ) );

  // The trail: a red brown worn ribbon with a dusty verge and two faint ruts;
  // it fades on steep ground, where a top-down paint would smear down the wall.
  float trailD = mk.r * ${TRAIL_RANGE.toFixed(1)} + ( n40 - 0.5 ) * 3.0;
  float hw = 6.5 + 2.0 * n300;
  float aa = max( fw * 0.75, 0.6 );
  float onPath = 1.0 - smoothstep( hw - aa, hw + aa, trailD );
  float verge = ( 1.0 - smoothstep( hw, hw + 9.0, trailD ) ) * ( 1.0 - onPath );
  float pathFade = 1.0 - smoothstep( 0.35, 0.6, slope );
  vec3 pc = mix( uPath, uPathEdge, smoothstep( hw * 0.45, hw, trailD ) );
  pc *= 1.0 - 0.07 * ( 1.0 - smoothstep( 0.0, 1.2, abs( trailD - hw * 0.45 ) ) ) * ( 1.0 - smoothstep( 0.5, 2.0, fw ) );
  c = mix( c, uVerge * ( sLuma( c ) / max( sLuma( uVerge ), 1e-3 ) * 0.5 + 0.55 ), verge * 0.4 * pathFade );
  c = mix( c, pc * ( 0.93 + 0.12 * n40 ), onPath * pathFade );

  // Contact shade under every footprint and every grass drift (baked).
  c *= 1.0 - contact;

  // Brush strokes: 3 flat values at two scales (one tile per 400 and per 60
  // units), plus or minus 12 percent, each fading before it aliases.
  // Final pass C (the judges' "polka dots": round value blobs of isotropic
  // noise at the stops): strokes with direction. The big layer is stretched
  // 2.5:1 on one bearing; the fine one 4:1 along the slope's contour (two
  // reads, one stretched along x and one along z, weighted by which way the
  // ground faces), so a hillside reads as painted swaths across it.
  vec2 bq = tRot( xz, 0.35 );
  float sBig = texture2D( uNoiseTex, vec2( bq.x / 2.5, bq.y ) / 400.0 ).b;
  float sfA = texture2D( uNoiseTex, vec2( xz.x / 4.0, xz.y ) / 60.0 + vec2( 0.31, 0.17 ) ).b;
  float sfB = texture2D( uNoiseTex, vec2( xz.y / 4.0, -xz.x ) / 60.0 + vec2( 0.63, 0.41 ) ).b;
  float sFine = mix( sfB, sfA, N.z * N.z / ( N.x * N.x + N.z * N.z + 0.004 ) );
  float strokes = ( pBands3( sBig, 0.34, 0.66 ) - 0.5 ) * 0.24 * bigK + ( pBands3( sFine, 0.34, 0.66 ) - 0.5 ) * 0.22 * fineK;
  c *= 1.0 + strokes * ( 1.0 - rock * 0.5 ) * ( 1.0 - sand * 0.7 );

  // Baked shade: creases dark, ridges lifted, hollows and closed-in ground
  // darker; the wet gorge keeps more light (it was near black).
  c *= mix( 1.0, 0.66, clamp( crease, 0.0, 1.0 ) * ( 1.0 - 0.45 * wet ) );
  c *= 1.0 + 0.08 * clamp( -crease, 0.0, 1.0 );
  c *= 1.0 - ( 0.22 + 0.12 * rock ) * clamp( hollow, 0.0, 1.0 ) * ( 1.0 - 0.55 * wet );
  c *= mix( mix( 0.6, 0.84, wet ), 1.0, ao );

  // Carlson's planes: flat 1.0, slopes ~0.8, cliffs ~0.55 (fix round 1:
  // was 1.0 / 0.86 / 0.74), so a wall's planes separate like Firewatch's
  // painted cliffs; a cliff that faces the sun keeps up to 0.8.
  // Fix round 2: walls in the sun's half space floor at 0.65 (a4 went dark).
  float cliffLo = mix( 0.55, 0.65, smoothstep( -0.05, 0.1, dot( Nf, uSunDirS ) ) );
  float plane = mix( mix( cliffLo, 0.8, smoothstep( 0.2, 0.62, Nf.y ) ), 1.0, smoothstep( 0.62, 0.93, Nf.y ) );
  float sunFace = smoothstep( 0.05, 0.45, dot( Nf, uSunDirS ) );
  c *= mix( plane, max( plane, 0.8 ), sunFace );

  // Tree shadows baked by the forest module (1 = lit), when it hands them in.
  if ( uShadeOn > 0.5 ) {
    vec2 suv = ( xz - uShadeB.xy ) * uShadeB.zw;
    if ( suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0 ) {
      float lit = texture2D( uShadeTex, suv ).r;
      c *= mix( 0.65, 1.0, lit );
      c = mix( c, c * vec3( 0.92, 0.97, 1.08 ), 1.0 - lit );
    }
  }

  // Planes with hue: slopes toward the sun lean warm, slopes away lean
  // toward the key's near shade (the sky's colour), never plain grey.
  vec2 sxz = normalize( uSunDirS.xz + vec2( 1e-4, 0.0 ) );
  vec2 nxz = Nf.xz / max( length( Nf.xz ), 1e-4 );
  float tilt = smoothstep( 0.06, 0.35, slope );
  float facing = dot( nxz, sxz );
  c = mix( c, c * vec3( 1.1, 1.0, 0.84 ), tilt * smoothstep( 0.1, 0.7, facing ) * 0.55 );
  float awayK = clamp( tilt * smoothstep( 0.1, 0.7, -facing ) + ( 1.0 - smoothstep( -0.35, 0.15, dot( Nf, uSunDirS ) ) ) * 0.5, 0.0, 1.0 );
  c = mix( c, vec3( sLuma( c ) ) * uShadeHue, awayK * 0.38 );
  // The gorge's shade walls: a painted bounce from the lit wall opposite
  // (never black; bible 1.9 shade #393e40 to #431b2c).
  c *= 1.0 + 0.35 * wet * awayK * rock;
  // The gorge's facets (above): lit planes warm, shade planes toward the key's shade hue.
  // A wall in the sun's shadow gets more: its planes are what keeps it from a flat dark sheet.
  float fInShade = 1.0 - smoothstep( -0.2, 0.15, dot( N, uSunDirS ) );
  // Past ~300 the planes calm down (the far wall read as a busy quilt).
  float fFar = smoothstep( 250.0, 400.0, fDist );
  c *= 1.0 + mix( 0.34 + 0.26 * fInShade, 0.2, fFar ) * facetLit - mix( 0.3, 0.18, fFar ) * facetShade;
  c = mix( c, c * vec3( 1.08, 1.0, 0.84 ), facetLit * 0.6 );
  c = mix( c, vec3( sLuma( c ) ) * uShadeHue * 1.15, facetShade * 0.3 );
  c *= 1.0 - 0.5 * facetCleft;
  c *= 1.0 + facetTone;

  // Final pass E: the gully mountain (x 1,600 on, its south face from z 780
  // to 1,000, up to ~1,000 high; the massifs north of it, which the burst
  // frames, are left out). From 902 to 914 vh its south face fills the top half of the
  // frame, and with the sun at 300 / 6 all of it is shade: one flat dark
  // purple mass. It gets a Firewatch flank in low sun: a paint sun swung
  // south to due west, so its west-turned planes take a warm light (added to
  // the emissive, two value steps) and its south and east planes stay cool
  // shade; a ragged treeline at the foot, pale scree in the hollows, and a
  // lit crest. Only while the camera is on the traverse's end and in the
  // gully (camera x over ~1,220, z from ~1,090 to ~1,400; on the rail that is
  // 878 to 937 vh): the opening and a1 (camera z ~4,300), the burst on (z
  // 1,041 and north), a5, its click in and the lake's reflection see 0 and
  // draw exactly as before.
  float flankK = uFlank.x * smoothstep( 1220.0, 1300.0, cameraPosition.x ) * smoothstep( 1090.0, 1150.0, cameraPosition.z ) * ( 1.0 - smoothstep( 1300.0, 1400.0, cameraPosition.z ) ) * smoothstep( 1560.0, 1660.0, xz.x ) * ( 1.0 - smoothstep( 990.0, 1040.0, xz.y ) ) * smoothstep( 740.0, 800.0, xz.y ) * smoothstep( 650.0, 700.0, h );
  // The paint sun: az 265, el 10 (the key's own sun is 300 / 6).
  const vec3 fSun = vec3( -0.9812, 0.1736, 0.0859 );
  float fwFS = fwidth( dot( N, fSun ) ) * 1.1 + 0.0015;
  if ( flankK > 0.001 ) {
    float lkS = dot( N, fSun );
    float lit1 = pStepW( 0.12, lkS, fwFS );
    float lit2 = pStepW( 0.4, lkS, fwFS );
    vec4 fA = texture2D( uNoiseTex, tRot( xz, 0.43 ) / 520.0 );
    // The treeline: a slow wobble (a finer ragged edge and the 23 unit stipple
    // read as pixel noise from 400 to 700 away). Final pass F: the 60 unit
    // crown clumps (a hard step on a texel scale noise) still read as a faint
    // dot stipple at full size; the band's value now steps on the 520 unit
    // noise already read (fA), two soft edged steps, one texture read fewer.
    float stW = fw * 7.0 / 520.0 * 1.1 + 0.0015;
    float stipF = 0.5 * pStepW( 0.4, fA.b, stW ) + 0.5 * pStepW( 0.62, fA.b, stW );
    float tlF = 745.0 + ( fA.r - 0.5 ) * 50.0 + ( nQ.r - 0.5 ) * 20.0;
    float treesF = ( 1.0 - pStepW( tlF, h, fwH ) ) * ( 1.0 - smoothstep( 0.6, 0.72, slope ) );
    float scrF = pStepW( 0.22, clamp( hollow, 0.0, 1.0 ) + ( fA.g - 0.5 ) * 0.35, fwHo * 1.1 + 0.0015 ) * pStepW( tlF + 30.0, h, fwH );
    float crestF = pStepW( 0.1, -crease, fwCr * 1.1 + 0.0015 ) * pStepW( 800.0, h, fwH );
    vec3 cF = c;
    cF = mix( cF, vec3( sLuma( cF ) ) * vec3( 1.2, 1.14, 1.06 ) * 1.3, scrF * 0.6 );
    cF = mix( cF, cF * vec3( 1.1, 1.0, 0.84 ), lit1 * 0.6 );
    cF = mix( cF, vec3( sLuma( cF ) ) * uShadeHue, ( 1.0 - lit1 ) * 0.25 );
    cF *= 1.0 - 0.12 * ( 1.0 - lit1 );
    vec3 tCol = mix( vec3( sLuma( c ) ), c, 0.4 ) * vec3( 0.34, 0.46, 0.42 ) * ( 0.88 + 0.24 * stipF );
    cF = mix( cF, tCol, treesF );
    c = mix( c, cF, flankK );
    gFlank = flankK * cF * vec3( 1.0, 0.5, 0.22 ) * ( uFlank.y * ( 0.55 * lit1 + 0.45 * lit2 ) * ( 1.0 - 0.75 * treesF ) + uFlank.z * crestF );
  }
  return c;
}
`;

// ── Material hooks ───────────────────────────────────────────────────────────

/**
 * Give a built-in material a shader hook that survives a later assignment of
 * onBeforeCompile (another module's patch): the later hook runs first, ours
 * after it, and the program cache key stays unique to this material.
 */
export function chainCompile(mat: THREE.Material, own: (shader: THREE.WebGLProgramParametersWithUniforms) => void, key: string) {
  let extra: ((s: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => void) | null = null;
  const run = (s: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => {
    if (extra) extra(s, r);
    own(s);
  };
  Object.defineProperty(mat, "onBeforeCompile", {
    configurable: true,
    enumerable: true,
    get: () => run,
    set: (fn) => {
      extra = typeof fn === "function" && fn !== run ? fn : null;
    },
  });
  mat.customProgramCacheKey = () => key + (extra ? "+ext" : "");
}

// ── Contract ─────────────────────────────────────────────────────────────────

/**
 * scene.userData.surfaces, for the other look modules:
 *   groundColorAt(x, z, out)  the terrain's painted albedo there (linear),
 *                             without light: grass or rock by slope, for
 *                             cover blades and rock tints that must sit in it.
 *   setForestMask(fn)         forest.ts hands its density (0..1 at x, z) in;
 *                             the floor under it paints darker and cooler.
 *                             Re-bakes the mask's A channel (~60k calls).
 *   setShadeTexture(tex, b)   forest.ts's baked tree shadows (R8, 1 = lit)
 *                             over bounds b; the terrain darkens up to 35%.
 *   heightTexture / heightBounds   terrain height (half float, the main grid)
 *                             for anything that needs water depth.
 *   heightUV                  world (x, z) to the height texture's uv:
 *                             uv = (xz - heightUV.xy) * heightUV.zw, texel
 *                             centres on the grid's vertices.
 *   drawnHeight(x, z)         the ground as the terrain mesh DRAWS it (the
 *                             falls patch where it has one, else the main
 *                             grid's triangles, else the heightfield).
 *   gridHeight(x, z)          bilinear on the main grid (else the heightfield).
 * v6:
 *   groundColorAt             now mirrors the painted patches, the forest
 *                             floor, the sand and the contact shade (the
 *                             noise texture read on the CPU), so a clump's
 *                             root matches the ground it grows out of.
 *   addGroundShade(discs)     darken the ground in soft discs (cover.ts's
 *                             drifts, 20 to 30%); combined with the footprint
 *                             contact shade baked in afterAll.
 *   shadeUniforms             the forest's tree shadow uniforms (uShadeTex,
 *                             uShadeB, uShadeOn), live, for cover.ts's vertex
 *                             shader: grass in a tree's shadow darkens the same.
 */
export interface SurfacesApi {
  groundColorAt(x: number, z: number, out: THREE.Color): THREE.Color;
  setForestMask(fn: ((x: number, z: number) => number) | null): void;
  setShadeTexture(tex: THREE.Texture | null, bounds?: { minX: number; minZ: number; maxX: number; maxZ: number }): void;
  heightTexture: THREE.DataTexture | null;
  heightBounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  heightUV: THREE.Vector4;
  drawnHeight(x: number, z: number): number;
  gridHeight(x: number, z: number): number;
  addGroundShade(discs: ReadonlyArray<{ x: number; z: number; r: number; amount: number }>): void;
  shadeUniforms: { uShadeTex: { value: THREE.Texture }; uShadeB: { value: THREE.Vector4 }; uShadeOn: { value: number } };
  /** Forest density there (0..1), as forest.ts handed it in (0 without it). */
  forestAt(x: number, z: number): number;
}

/** The height of the torn sand line at (x, z): sand below it, grass above (paintTerrain's sandH, on the CPU). */
export function sandLineAt(x: number, z: number): number {
  return 6.5 + (noiseCPU(0, x, z, 170) - 0.5) * 6 + (noiseCPU(1, x, z, 26, 1.1) - 0.5) * 2.4;
}

// ── The noise texture on the CPU (the same bytes the shader reads) ───────────

/** Bilinear, wrapped sample of one channel of noise.ts's texture at world (x, z), one tile per `tile` units, rotated by `a`. */
function noiseCPU(ch: number, x: number, z: number, tile: number, a = 0): number {
  const { data } = noiseData();
  let px = x;
  let pz = z;
  if (a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    px = c * x - s * z;
    pz = s * x + c * z;
  }
  const n = NOISE_SIZE;
  const u = (px / tile) * n - 0.5;
  const v = (pz / tile) * n - 0.5;
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const fu = u - i0;
  const fv = v - j0;
  const w = (k: number) => ((k % n) + n) % n;
  const a0 = w(i0);
  const a1 = w(i0 + 1);
  const b0 = w(j0) * n;
  const b1 = w(j0 + 1) * n;
  const t00 = data[(b0 + a0) * 4 + ch];
  const t10 = data[(b0 + a1) * 4 + ch];
  const t01 = data[(b1 + a0) * 4 + ch];
  const t11 = data[(b1 + a1) * 4 + ch];
  return ((t00 * (1 - fu) + t10 * fu) * (1 - fv) + (t01 * (1 - fu) + t11 * fu) * fv) / 255;
}


/** The part of light.ts's live state (scene.userData.light.state) the looks read. */
export interface LightStateLike {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  sunEl: number;
  skyHorizon: THREE.Color;
  skyMid: THREE.Color;
  skyTop: THREE.Color;
  haze: THREE.Color;
  hemiIntensity: number;
  water: THREE.Color;
  /** The night layer here, 0..1 (light.ts state.night): 0 by day and from the Sky Island on. */
  night?: number;
  /** The moon's disc (direction, colour, how much of it shows), for the water's moon path at night. */
  moonDir?: THREE.Vector3;
  moonColor?: THREE.Color;
  moonVis?: number;
}

/** light.ts's live state, or null before it has one (or without light.ts). */
export function lightStateOf(scene: THREE.Scene): LightStateLike | null {
  const l = scene.userData.light as { state?: LightStateLike } | undefined;
  return l && l.state && l.state.skyHorizon ? l.state : null;
}

// ── Install ──────────────────────────────────────────────────────────────────

export const install: InstallFn = async (ctx: WorldCtx): Promise<WorldModule> => {
  const t0 = performance.now();
  const { root, scene } = ctx;
  root.updateMatrixWorld(true);
  const stats: Record<string, number | string> = {};
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];

  // ── Terrain ────────────────────────────────────────────────────────────────
  const terrainMeshes: THREE.Mesh[] = [];
  for (const name of ["Terrain", "Terrain:falls"]) {
    const o = root.getObjectByName(name) as THREE.Mesh | undefined;
    if (o && o.isMesh) terrainMeshes.push(o);
  }
  const mainMesh = terrainMeshes.find((m) => m.name === "Terrain");
  const patchMesh = terrainMeshes.find((m) => m.name === "Terrain:falls");
  const mainGrid = mainMesh ? gridFrom(mainMesh.geometry) : null;
  const patchGrid = patchMesh ? gridFrom(patchMesh.geometry) : null;
  stats.grid = mainGrid ? `${mainGrid.vx}x${mainGrid.vz}` : "none";
  stats.patchGrid = patchGrid ? `${patchGrid.vx}x${patchGrid.vz}` : "none";
  const kitD = kitData();
  const kit = terrainKit(kitD);
  /** Height as drawn: the falls patch where it has one, the main grid elsewhere, else the heightfield. */
  const drawn = (x: number, z: number) =>
    patchGrid && kit.inGrid(patchGrid, x, z) ? kit.drawnH(patchGrid, x, z) : mainGrid ? kit.drawnH(mainGrid, x, z) : terrainHeight(x, z);
  const coarseH = (x: number, z: number) => (mainGrid ? kit.gridH(mainGrid, x, z) : terrainHeight(x, z));

  // Zones (groundColorAt) read the kit's zone colours.
  const zb = new Float64Array(7);
  const zoneAt = (x: number, z: number, h: number, out: ZoneOut): ZoneOut => {
    kit.zone(x, z, h, zb);
    out.grass.r = zb[0];
    out.grass.g = zb[1];
    out.grass.b = zb[2];
    out.rock.r = zb[3];
    out.rock.g = zb[4];
    out.rock.b = zb[5];
    out.wet = zb[6];
    return out;
  };
  const zo: ZoneOut = { grass: new THREE.Color(), rock: new THREE.Color(), wet: 0 };

  // Vertex bakes: zone colours, crease, hollow, horizon AO (terrainKit's
  // bake). Cheap laptops (load): the attributes go on now, zero filled, and
  // the bake runs in a worker while the other modules install; afterAll waits
  // for it and fills them in (the main thread bakes when no worker starts).
  const jobs: BakeJob[] = [];
  const bakeAttrs: Array<{ col: THREE.BufferAttribute; rock: THREE.BufferAttribute; surf: THREE.BufferAttribute }> = [];
  const colorWas = new Map<THREE.BufferGeometry, THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined>();
  for (const m of terrainMeshes) {
    const g = m.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const n = pos.count;
    const P = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      P[i * 3] = pos.getX(i);
      P[i * 3 + 1] = pos.getY(i);
      P[i * 3 + 2] = pos.getZ(i);
    }
    jobs.push({ P, n });
    const col = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    const rock = new THREE.BufferAttribute(new Uint8Array(n * 4), 4, true);
    const surf = new THREE.BufferAttribute(new Int8Array(n * 4), 4, true);
    colorWas.set(g, g.getAttribute("color"));
    g.setAttribute("color", col);
    g.setAttribute("aRock", rock);
    g.setAttribute("aSurf", surf);
    bakeAttrs.push({ col, rock, surf });
  }
  const bakeT0 = performance.now();
  const worker = mainGrid && jobs.length ? bakeInWorker(kitD, jobs, mainGrid, patchGrid) : null;
  let bakeMs = 0;
  /** The bake on this thread (no worker, or it failed), one mesh per task. */
  const bakeHere = async () => {
    for (let k = 0; k < jobs.length; k++) {
      const a0 = performance.now();
      const o = kit.bake(jobs[k].P, jobs[k].n, mainGrid, patchGrid, terrainHeight);
      fillBake(k, o);
      bakeMs += performance.now() - a0;
      await yieldTask();
    }
  };
  const fillBake = (k: number, o: BakeOut) => {
    const a = bakeAttrs[k];
    (a.col.array as Float32Array).set(o.col);
    (a.rock.array as Uint8Array).set(o.rock);
    (a.surf.array as Int8Array).set(o.surf);
    a.col.needsUpdate = a.rock.needsUpdate = a.surf.needsUpdate = true;
  };
  /** Resolves once every terrain mesh carries its bake. */
  const baked: Promise<void> = (async () => {
    const out = worker ? await worker.done : null;
    if (out) {
      const a0 = performance.now();
      out.forEach((o, k) => fillBake(k, o));
      bakeMs += performance.now() - a0;
      stats.vertexBake = "worker";
      stats.vertexBakeWorkerMs = Math.round(performance.now() - bakeT0);
    } else {
      stats.vertexBake = worker ? "main (worker failed)" : "main";
      await bakeHere();
    }
    stats.vertexBakeMs = Math.round(bakeMs);
  })();

  // The mask texture.
  const MB: MaskBounds = { minX: WORLD.minX, minZ: WORLD.minZ, w: WORLD.maxX - WORLD.minX, d: WORLD.maxZ - WORLD.minZ };
  const m0 = performance.now();
  const maskData = buildMask(MB, null);
  const maskTex = new THREE.DataTexture(maskData, MASK_RES, MASK_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
  maskTex.minFilter = THREE.LinearFilter;
  maskTex.magFilter = THREE.LinearFilter;
  maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
  maskTex.generateMipmaps = false;
  maskTex.colorSpace = THREE.NoColorSpace;
  maskTex.needsUpdate = true;
  texs.push(maskTex);
  stats.maskMs = Math.round(performance.now() - m0);
  await yieldTask();

  // Height texture from the main grid (for water depth).
  let heightTex: THREE.DataTexture | null = null;
  const hb = mainGrid
    ? { minX: mainGrid.minX, minZ: mainGrid.minZ, maxX: mainGrid.minX + mainGrid.sx * (mainGrid.vx - 1), maxZ: mainGrid.minZ + mainGrid.sz * (mainGrid.vz - 1) }
    : { minX: WORLD.minX, minZ: WORLD.minZ, maxX: WORLD.maxX, maxZ: WORLD.maxZ };
  if (mainGrid) {
    const hd = new Uint16Array(mainGrid.h.length);
    for (let k = 0; k < hd.length; k++) hd[k] = THREE.DataUtils.toHalfFloat(mainGrid.h[k]);
    heightTex = new THREE.DataTexture(hd, mainGrid.vx, mainGrid.vz, THREE.RedFormat, THREE.HalfFloatType);
    heightTex.minFilter = THREE.LinearFilter;
    heightTex.magFilter = THREE.LinearFilter;
    heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
    heightTex.generateMipmaps = false;
    heightTex.colorSpace = THREE.NoColorSpace;
    heightTex.needsUpdate = true;
    texs.push(heightTex);
  }
  // Texel centres sit on the grid vertices: map world -> uv with a half-texel inset.
  const hbU = new THREE.Vector4();
  if (mainGrid) {
    const W = hb.maxX - hb.minX;
    const D = hb.maxZ - hb.minZ;
    // uv = ((x - minX) / W * (vx - 1) + 0.5) / vx  =  (x - (minX - 0.5 * W / (vx - 1))) * ((vx - 1) / (W * vx))
    const ox = hb.minX - (0.5 * W) / (mainGrid.vx - 1);
    const oz = hb.minZ - (0.5 * D) / (mainGrid.vz - 1);
    hbU.set(ox, oz, (mainGrid.vx - 1) / (W * mainGrid.vx), (mainGrid.vz - 1) / (D * mainGrid.vz));
  } else {
    hbU.set(hb.minX, hb.minZ, 1 / (hb.maxX - hb.minX), 1 / (hb.maxZ - hb.minZ));
  }

  // v6: contact shade (R8 over WORLD, the mask's grid): how much darker the
  // ground is there, 0..1. Footprints bake in afterAll; cover.ts's drifts add
  // theirs through addGroundShade.
  const contactData = new Uint8Array(MASK_RES * MASK_RES);
  const contactTex = new THREE.DataTexture(contactData, MASK_RES, MASK_RES, THREE.RedFormat, THREE.UnsignedByteType);
  contactTex.minFilter = THREE.LinearFilter;
  contactTex.magFilter = THREE.LinearFilter;
  contactTex.wrapS = contactTex.wrapT = THREE.ClampToEdgeWrapping;
  contactTex.generateMipmaps = false;
  contactTex.colorSpace = THREE.NoColorSpace;
  contactTex.unpackAlignment = 1;
  contactTex.needsUpdate = true;
  texs.push(contactTex);
  /** Darken the ground in a soft disc (multiplicative with what is there). */
  const splatShade = (cx: number, cz: number, R: number, amount: number, into: Uint8Array, stride: number, ch: number, mode: "shade" | "max") => {
    if (!(R > 0) || !(amount > 0)) return;
    const tx = MB.w / MASK_RES;
    const tz = MB.d / MASK_RES;
    const i0 = Math.max(0, Math.floor((cx - R - MB.minX) / tx));
    const i1 = Math.min(MASK_RES - 1, Math.ceil((cx + R - MB.minX) / tx));
    const j0 = Math.max(0, Math.floor((cz - R - MB.minZ) / tz));
    const j1 = Math.min(MASK_RES - 1, Math.ceil((cz + R - MB.minZ) / tz));
    for (let j = j0; j <= j1; j++) {
      const z = MB.minZ + (j + 0.5) * tz;
      for (let i = i0; i <= i1; i++) {
        const x = MB.minX + (i + 0.5) * tx;
        const d = Math.hypot(x - cx, z - cz) / R;
        if (d >= 1) continue;
        const f = amount * Math.pow(1 - d * d, 1.4);
        const o = (j * MASK_RES + i) * stride + ch;
        if (mode === "max") into[o] = Math.max(into[o], Math.round(255 * f));
        else {
          const was = into[o] / 255;
          into[o] = Math.round(255 * Math.min(0.85, 1 - (1 - was) * (1 - f)));
        }
      }
    }
  };
  const contactAt = (x: number, z: number) => {
    const i = Math.floor(((x - MB.minX) / MB.w) * MASK_RES);
    const j = Math.floor(((z - MB.minZ) / MB.d) * MASK_RES);
    if (i < 0 || j < 0 || i >= MASK_RES || j >= MASK_RES) return 0;
    return contactData[j * MASK_RES + i] / 255;
  };

  const sunDirS = ctx.sunDir.clone().normalize();
  const whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  whiteTex.needsUpdate = true;
  texs.push(whiteTex);
  const shadeUniforms = {
    uShadeTex: { value: whiteTex as THREE.Texture },
    uShadeB: { value: new THREE.Vector4(0, 0, 1, 1) },
    uShadeOn: { value: 0 },
  };
  const tU = {
    uMask: { value: maskTex },
    uMaskB: { value: new THREE.Vector4(MB.minX, MB.minZ, 1 / MB.w, 1 / MB.d) },
    uContact: { value: contactTex },
    uNoiseTex: { value: getNoiseTexture(ctx.renderer) as THREE.Texture },
    uShadeHue: { value: new THREE.Color(0.86, 0.98, 1.3) },
    uSwash: { value: 0 },
    uFlank: { value: new THREE.Vector3(1, 1.6, 1.4) },
    ...shadeUniforms,
    uSand: { value: lin(PAL.sand) },
    uWetSand: { value: lin(PAL.wetSand) },
    uPath: { value: lin(PAL.path) },
    uPathEdge: { value: lin(PAL.pathEdge) },
    uVerge: { value: lin(PAL.verge) },
    uBank: { value: lin(PAL.bank) },
    uWorn: { value: lin(PAL.worn) },
    uMoss: { value: lin(PAL.moss) },
    uRockHigh: { value: lin(PAL.rockHigh) },
    uForestFloor: { value: lin(PAL.forestFloor) },
    uDry: { value: lin(PAL.dry) },
    uSunDirS: { value: sunDirS },
    uLake: { value: new THREE.Vector4(WORLD.lake.x, WORLD.lake.z, WORLD.lake.r, WORLD.lake.y) },
  };
  const terrainMat = new THREE.MeshLambertMaterial({ name: "SurfTerrain", vertexColors: true });
  chainCompile(
    terrainMat,
    (shader) => {
      Object.assign(shader.uniforms, tU);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\n" + TERRAIN_VERT_PARS)
        .replace("#include <fog_vertex>", "#include <fog_vertex>\n" + TERRAIN_VERT_MAIN);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\n" + TERRAIN_FRAG_PARS)
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = paintTerrain( diffuseColor.rgb );\ntotalEmissiveRadiance += gFlank;");
    },
    "surf-terrain-v6",
  );
  // Harness only: the flank uniform, so a render can A/B the gully mountain in one page load.
  terrainMat.userData.flank = tU.uFlank;
  mats.push(terrainMat);
  const terrainWas = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  for (const m of terrainMeshes) {
    terrainWas.set(m, m.material);
    m.material = terrainMat;
  }

  // ── The Mirror Lake's terrain (light.ts REFLECT_ONLY_LAYER) ────────────────
  // The lake's reflection pass redraws everything it sees, and the full grid is
  // 170k triangles, so a5 drew it twice and sat at the 700k cap. The mirror
  // draws every 3rd vertex of the same grid instead: the same vertex buffers
  // and material with only a new index, about 19k triangles. The full grid
  // goes on NO_REFLECT_LAYER. The falls patch is 1.5 km from the lake and
  // never in the mirror, so it keeps its layer. Only when light.ts is installed
  // (its lake exists and the main camera sees NO_REFLECT_LAYER).
  let mirrorTerrain: THREE.Mesh | null = null;
  const mainLayersWas = mainMesh ? mainMesh.layers.mask : 0;
  if (mainMesh && mainGrid && mainMesh.parent && scene.getObjectByName("MirrorLake") && ctx.camera.layers.isEnabled(NO_REFLECT_LAYER)) {
    const S = 3;
    const { vx, vz } = mainGrid;
    const pick = (n: number) => {
      const out: number[] = [];
      for (let i = 0; i < n - 1; i += S) out.push(i);
      out.push(n - 1);
      return out;
    };
    const cols = pick(vx);
    const rows = pick(vz);
    const idx = new Uint32Array((cols.length - 1) * (rows.length - 1) * 6);
    let o = 0;
    for (let r = 0; r < rows.length - 1; r++) {
      for (let c = 0; c < cols.length - 1; c++) {
        const a = rows[r] * vx + cols[c];
        const b = rows[r] * vx + cols[c + 1];
        const cc = rows[r + 1] * vx + cols[c];
        const d = rows[r + 1] * vx + cols[c + 1];
        idx[o++] = a;
        idx[o++] = cc;
        idx[o++] = b;
        idx[o++] = b;
        idx[o++] = cc;
        idx[o++] = d;
      }
    }
    const src = mainMesh.geometry;
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    if (!src.boundingSphere) src.computeBoundingSphere();
    g.boundingSphere = src.boundingSphere!.clone();
    mirrorTerrain = new THREE.Mesh(g, terrainMat);
    mirrorTerrain.name = "Terrain:mirror";
    mirrorTerrain.position.copy(mainMesh.position);
    mirrorTerrain.quaternion.copy(mainMesh.quaternion);
    mirrorTerrain.scale.copy(mainMesh.scale);
    mirrorTerrain.layers.set(REFLECT_ONLY_LAYER);
    mainMesh.layers.set(NO_REFLECT_LAYER);
    mainMesh.parent.add(mirrorTerrain);
    stats.mirrorTerrainTris = idx.length / 3;
  }

  // ── Light: slopes away from the sun lean to the key's near shade ───────────
  const sunDirNow = new THREE.Vector3();
  const hueNow = new THREE.Color();
  // The night layer (light.ts state.night): the sand is the palest ground, and
  // under the night's raised fill and exposure the beach read as snow. At
  // night 1 the dry sand is SAND_NIGHT and the wet band NIGHT_WET_SAND of its
  // day value; by day and from the island on (night 0) both are PAL's.
  const sandDay = lin(PAL.sand);
  const wetSandDay = lin(PAL.wetSand);
  const sandNight = lin(SAND_NIGHT);
  let sandAt = 0;
  function applyLight(): boolean {
    const s = lightStateOf(scene);
    let changed = false;
    const nk = s?.night ?? 0;
    if (nk !== sandAt) {
      sandAt = nk;
      tU.uSand.value.copy(sandDay).lerp(sandNight, nk);
      tU.uWetSand.value.copy(wetSandDay).multiplyScalar(1 - (1 - NIGHT_WET_SAND) * nk);
      changed = true;
    }
    if (s) {
      // The key's mid sky, normalised to luma 1 and softened: blue by day,
      // violet at sunset, so shade takes the sky's colour (bible 2.3, 2.6).
      const m = s.skyMid;
      const l = Math.max(1e-3, 0.2126 * m.r + 0.7152 * m.g + 0.0722 * m.b);
      const k = (v: number) => 1 + (Math.min(1.7, Math.max(0.55, v / l)) - 1) * 0.75;
      hueNow.setRGB(k(m.r), k(m.g), k(m.b));
      if (!hueNow.equals(tU.uShadeHue.value)) {
        tU.uShadeHue.value.copy(hueNow);
        changed = true;
      }
    }
    sunDirNow.copy(s ? s.sunDir : ctx.sunDir).normalize();
    if (!sunDirNow.equals(sunDirS)) {
      sunDirS.copy(sunDirNow);
      changed = true;
    }
    return changed;
  }
  applyLight();

  // ── Contract ───────────────────────────────────────────────────────────────
  let forestFn: ((x: number, z: number) => number) | null = null;
  const tmpC = new THREE.Color();
  const forestFloorC = lin(PAL.forestFloor);
  const sandC = lin(PAL.sand);
  // Set when another module hands in a map, so the next frame redraws the terrain.
  let apiDirty = false;
  const api: SurfacesApi = {
    groundColorAt(x, z, out) {
      // The CPU mirror of paintTerrain's big layers (no crease, AO or strokes):
      // zone colour, the 4 value patches, the forest edge and floor, rock by
      // slope, the sand, contact shade, Carlson's planes.
      const h = drawn(x, z);
      zoneAt(x, z, h, zo);
      const e = 4;
      const gx = (drawn(x + e, z) - drawn(x - e, z)) / (2 * e);
      const gz = (drawn(x, z + e) - drawn(x, z - e)) / (2 * e);
      const ny = 1 / Math.hypot(gx, 1, gz);
      const nPr = noiseCPU(0, x, z, 610);
      const nQr = noiseCPU(0, x, z, 151, 0.61);
      const nCg = noiseCPU(1, x, z, 1100, 1.37);
      const patchV = nPr * 0.5 + (1 - nCg) * 0.38 + (nQr - 0.5) * 0.2;
      out.copy(zo.grass);
      if (patchV > 0.6) out.setRGB(out.r * 1.2, out.g * 1.12, out.b * 0.82);
      if (patchV < 0.36) out.setRGB(out.r * 0.8, out.g * 0.86, out.b * 0.8);
      const fa = api.forestAt(x, z) + (nQr - 0.5) * 0.22;
      if (fa > 0.26) out.multiplyScalar(0.72);
      if (fa > 0.58) out.lerp(tmpC.copy(forestFloorC).multiplyScalar(0.88 + 0.24 * noiseCPU(2, x, z, 151, 0.61)), 0.85);
      const rock = 1 - ny + (nPr - 0.5) * 0.12 + (nQr - 0.5) * 0.06 > 0.36 ? 1 : 0;
      if (rock) out.copy(zo.rock);
      if (h < sandLineAt(x, z) && 1 - ny < 0.45) out.copy(sandC);
      out.multiplyScalar(1 - contactAt(x, z));
      // Carlson's planes as the shader paints them (without its sun term).
      out.multiplyScalar(0.55 + 0.25 * smooth(0.2, 0.62, ny) + 0.2 * smooth(0.62, 0.93, ny));
      return out;
    },
    forestAt(x, z) {
      if (forestFn) return clamp01(forestFn(x, z));
      const F = WORLD.forest;
      return 1 - smooth(F.r * 0.8, F.r * 1.1, Math.hypot(x - F.x, z - F.z));
    },
    addGroundShade(discs) {
      for (const d of discs) splatShade(d.x, d.z, d.r, d.amount, contactData, 1, 0, "shade");
      contactTex.needsUpdate = true;
      apiDirty = true;
    },
    shadeUniforms,
    setForestMask(fn) {
      forestFn = fn;
      fillForest(maskData, MB, fn);
      maskTex.needsUpdate = true;
      apiDirty = true;
    },
    setShadeTexture(tex, b) {
      tU.uShadeTex.value = tex ?? whiteTex;
      tU.uShadeOn.value = tex ? 1 : 0;
      if (b) tU.uShadeB.value.set(b.minX, b.minZ, 1 / (b.maxX - b.minX), 1 / (b.maxZ - b.minZ));
      apiDirty = true;
    },
    heightTexture: heightTex,
    heightBounds: hb,
    heightUV: hbU,
    drawnHeight: drawn,
    gridHeight: coarseH,
  };
  scene.userData.surfaces = api;

  stats.installMs = Math.round(performance.now() - t0);
  stats.drawCallsAdded = mirrorTerrain ? 1 : 0; // the lake's reflection pass only
  stats.textureKB = Math.round((MASK_RES * MASK_RES * 5 + (mainGrid ? mainGrid.h.length * 2 : 0)) / 1024);

  /** The sea's wash phase (water.ts, scene.userData.water.swash), read each frame for the wet band. */
  let swashRef: { value: number } | null = null;

  return {
    name: "surfaces",
    update(): boolean {
      let changed = apiDirty;
      apiDirty = false;
      if (applyLight()) changed = true;
      if (swashRef) tU.uSwash.value = swashRef.value;
      return changed;
    },
    async afterAll() {
      // Cheap laptops (load): the terrain's vertex bake, started at install.
      await baked;
      // Footprints (every module has registered by now): contact shade under
      // every solid thing (1.2 x its radius, 0.6 at the centre by default) and
      // flat worn ground under tents and buildings, so nothing looks pasted on.
      const a0 = performance.now();
      if (!forestFn) {
        fillForest(maskData, MB, null);
        maskTex.needsUpdate = true;
      }
      const w = (scene.userData.water as { swash?: { value: number } } | undefined)?.swash;
      swashRef = w && typeof w.value === "number" ? w : null;
      let n = 0;
      let worn = 0;
      for (const f of allFootprints()) {
        if (f.line || f.kind === "path" || f.kind === "water") continue;
        if (f.shade > 0) {
          splatShade(f.x, f.z, f.r * 1.2, f.shade, contactData, 1, 0, "shade");
          n++;
        }
        if (f.kind === "tent" || f.kind === "building") {
          splatShade(f.x, f.z, f.r * 1.6 + 6, 1, maskData, 4, 2, "max");
          worn++;
        }
      }
      contactTex.needsUpdate = true;
      if (worn) maskTex.needsUpdate = true;
      apiDirty = true;
      stats.contactDiscs = n;
      stats.wornDiscs = worn;
      stats.afterAllMs = Math.round(performance.now() - a0);
    },
    stats: () => ({ ...stats }),
    dispose() {
      worker?.cancel();
      if (scene.userData.surfaces === api) delete scene.userData.surfaces;
      if (mirrorTerrain) {
        mirrorTerrain.parent?.remove(mirrorTerrain);
        // Its vertex buffers are the main grid's: drop them from the mirror's
        // geometry first, so disposing it frees only its own index.
        const g = mirrorTerrain.geometry;
        for (const name of Object.keys(g.attributes)) g.deleteAttribute(name);
        g.dispose();
        if (mainMesh) mainMesh.layers.mask = mainLayersWas;
      }
      for (const [m, was] of terrainWas) m.material = was;
      for (const m of terrainMeshes) {
        m.geometry.deleteAttribute("aRock");
        m.geometry.deleteAttribute("aSurf");
        const was = colorWas.get(m.geometry);
        if (was) m.geometry.setAttribute("color", was);
      }
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
};
