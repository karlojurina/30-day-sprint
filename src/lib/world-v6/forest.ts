/**
 * v6 look module: THE FOREST (world_art_bible_v6.md 2.1, 1.15; v6_techniques.md 1).
 *
 * WHAT IT ADDS, under one group "Forest":
 *   - the wild forest as PAINTED CARDS on one atlas (foliage-atlas.ts), seven
 *     species: S1 spruce (3 cells, 1 in 12 painted rust brown, the dying variant),
 *     S2 lodgepole pine (2 cells), S3 fir spire, S4 aspen (groves only, 2
 *     cells), S5 snag (v5's geometry near, its painted cell beyond), S6 young
 *     spruce at clump edges, S7 shrubs round the clumps. One material, the
 *     cell is an instanced attribute (aCell), so every species shares a program.
 *   - the Glowing Forest's gradient (1.15): magicAt(x, z) (layout.ts) turns the
 *     normal forest into teal tipped spruces (0.25 to 0.5), then lantern
 *     willows (M2), glowcaps (M3) and glow ferns (M4) where the field rises;
 *     past 0.8 the giant elders (dress-lakeforest.ts) own the ground. The edge
 *     follows the field's lobes, never a circle. Wave 3 (2026-10-15): the
 *     field has a wide, soft halo round its core, so the giants reach further
 *     and come down in size toward its edge and the change to normal forest
 *     runs over about 500 units (giantSpots, the halo's understory).
 *   - wave 3's rules (2026-10-15, Lovro's Loom), after the deal: no crown
 *     grows into another or into a giant (SPACE_K), aspen groves of aspens
 *     alone, fewer lodgepole pines, no trunk in the water as drawn (water.ts
 *     waterAt). Each takes its chances from the tree's spot, so a tree no
 *     rule touches stands where it always stood.
 *
 * LEVELS (2.1). Near, inside NEAR_D x tier.treeDistance: the hybrid, a 12
 * triangle dark faceted core in the tree's body colour (it fills the gaps when
 * the camera looks down steeply) plus 3 crossed cards (6 tris). Mid, to
 * MID_D: 2 crossed cards. Far: one card turning on its vertical axis. The
 * alpha cutoff falls from 0.5 near to 0.22 by 1,500 (Firewatch's far puff),
 * with alpha to coverage and fwidth sharpening under the canvas MSAA. 5
 * percent hysteresis on each switch.
 *
 * LIGHT. Bent normals from a point low in the crown (per fragment, from the
 * card's position in the crown), so each tree lights as one volume; v5's warm
 * rim on the sun side at the tips; colour welding toward the mass tint
 * between 500 and 1,800; the far gust band; near sway plus a card flutter.
 *
 * OVERDRAW (3.1). Cards write depth and draw before the terrain (negative
 * renderOrder: cores, near cards, mid, far), the near cards in near to far
 * cell order, so hidden layers fail the depth test. Nothing rises into the
 * camera's way (the clearance grid from the rail, CAM_R).
 *
 * COMPACTION (v5 5.3, kept). One InstancedMesh per level; on frames where the
 * camera moved, trees are sorted into 250 unit cells, a cell outside the view
 * or past the fog is skipped whole, each tree left is frustum tested, given
 * its level, and its matrix, tint and cell copied in; count set, only the used
 * range uploaded.
 *
 * PLACEMENT (v5 3.1, counts per v6 2.1). A jittered 16 unit grid, a density
 * mask clumped by low frequency noise, densest on mid slopes, none on water,
 * cliffs, above the treeline, on the path, in the landmark clearings; pockets
 * of taller trees round the open stops; zone mixes (ZONES); aspens only where
 * the grove field says so; about 16,500 wild trees dealt (shrubs included),
 * about 14,700 left once crowded crowns are left out (wave 3).
 *
 * TUNING: the constants block below.
 */
import * as THREE from "three";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import type { SurfacesApi } from "./surfaces";
import type { QualityTier } from "./quality";
import { foliageAtlasStats, foliageCellKeep, foliageCellRects, getFoliageAtlas } from "./foliage-atlas";
import { BROOK, FOREST_KEEP_CLEAR, GLOW_STREAM, GREAT_TREE, PATH, PLACES, RIVER, STEPS_FOOT, STEPS_TOP, STREAM, TRAIL, TRAIL_KIND, WORLD, magicAt, type TrailKind } from "./layout";
import { waterAt } from "./water";

// ── Tunables ────────────────────────────────────────────────────────────────

/** Wild trees placed in total (all species and shrubs, before the magic understory). */
const TARGET_WILD = 17000;
/** Candidate grid: one jittered candidate per CELL x CELL. */
const CELL = 16;
/** The region trees grow in: the ground route and the slopes in view of it. */
const ROI = { minX: -3000, maxX: 3600, minZ: -3000, maxZ: 5000 };
/** Clearance and distance grids: cell size. */
const G = 20;
/** Level switch distances (x tier.treeDistance). */
const NEAR_D = 700;
const MID_D = 2500;
const HYST = 0.05;
/** Culling cells for compaction. */
const CULL_CELL = 250;
/** Colour welding range (v5 1.7). */
const WELD_FROM = 500;
const WELD_TO = 1800;
/** Near sway: full inside SWAY_FULL, none past SWAY_R; tip travel as a share of height. */
const SWAY_FULL = 150;
const SWAY_R = 300;
const SWAY_AMP = 0.02;
/** Card edge flutter, share of height. */
const FLUTTER = 0.012;
/** Far gust: tips lighten by this share where the band passes. */
const GUST_TINT = 0.25;
/** Warm rim strength at the tips. */
const RIM = 0.7;
/** Alpha cutoff near and far (2.1: 0.5 falling to 0.2 by 1,500). */
const CUT_NEAR = 0.5;
const CUT_FAR = 0.22;
const CUT_FROM = 250;
const CUT_TO = 1500;
/** Far puff: cards widen by up to this share between PUFF_FROM and PUFF_TO, so far stands read as masses. */
const PUFF = 0.35;
const PUFF_FROM = 1200;
const PUFF_TO = 3500;
/** Glow gain on the atlas's glow mask (x light.ts magicGlow): teal and violet under 1.2 linear. */
const GLOW_GAIN = 1.7;
/** Clearance: tree tops stay this far under the camera within CAM_R of the rail. */
const CAM_R = 70;
const CAM_GAP = 18;

/** Magic understory counts (1.15), placed by magicAt. */
const WILLOWS = 170;
const GLOWCAPS = 1100;
const GLOWFERNS = 2600;
/** C3 round 2: the a6 camera (its KEYS row), and the radius round it where ferns are thinned by half. */
const A6_CAM = TRAIL[PLACES.find((p) => p.id === "a6")?.trail ?? 55];
const A6_FERN_THIN = 230;
/** magicAt above this: the giant elders' ground (dress-lakeforest.ts), no wild tree. */
const MAGIC_GIANTS = 0.8;
/**
 * 1dc7e10's deal, held (map review, wave 3, review round 2). The trees are
 * dealt from one random stream in row order (z, then x), each kept at its
 * weight times K, so a change to the ground, the trail or the rail used to
 * deal every tree after it again, and the grass with them: cover.ts picks
 * each drift's kit from the forest's density, and one kit that changes
 * renumbers the rest of its part. Item 15c's lake bank did that to half the
 * world's grass, Base Camp's meadow in Lovro's approved stop view included.
 * Two pins keep 1dc7e10's deal outside the rows the bank crosses:
 * - K_SUM, the sum of every candidate's weight on 1dc7e10 (the opening
 *   islet's two, which went in wave 2, included), so K no longer moves with
 *   a change, and every row before the first changed one is dealt as it was;
 * - DEAL_SYNC, the stream's place (draws taken) at row 218 (z 488), the first
 *   row past the bank: the bank changes the ground out to WORLD.lake's
 *   r + 160, read off the drawn grid, so it changes candidates in rows 118 to
 *   217 (z -1,112 to 488), and from row 218 on the stream is where 1dc7e10's
 *   stood, so every later row is dealt as it was.
 * A change from row 218 on still deals the rows after it again. When the
 * forest is dealt again on purpose (a draw of its own for each candidate,
 * Lovro's call), both go; moduleStats' wSum gives the sum to scale by.
 */
const K_SUM = 35104.52767941057;
const DEAL_SYNC = { row: 218, draws: 93328 } as const;

// ── Wave 3 (Lovro's Loom, 2026-10-15: 2:54 to 3:35, the trees; 10:09 to 11:00, the forest) ──
//
// The forest is still dealt from one random stream, as before. Every rule
// below changes a tree only AFTER its draws are taken, and takes its own
// chances from a hash of the tree's spot (spotHash), so a tree that no rule
// touches stands exactly where it stood, the same species, size, turn and
// tint. Only the trees the rules are about change.

/**
 * Spacing ("they kind of sometimes intertwine with other trees. So they
 * basically grow on top of each other"): two crowns stand at least SPACE_K of
 * their summed widths apart at the height where the pair is widest together
 * (PROFILE), so crowns may touch but no crown grows through another. The tree
 * dealt first keeps its spot and a later one that would crowd it is left
 * out, with its shrubs. The giant elders are spaced against the same way (their
 * trunk to the canopy's foot, then the canopy). Shrubs and the ground glow
 * (glowcaps, ferns) are not spaced.
 */
const SPACE_K = 0.85;
/** Crown half width per atlas cell (FOLIAGE_CELLS order), a share of the card's height: the atlas's painted crop times its keep, read off the live atlas on 2026-10-15. */
const CELL_HALF: readonly number[] = [0.248, 0.218, 0.26, 0.179, 0.214, 0.135, 0.266, 0.255, 0.274, 0.504, 0.452, 0.174, 0.099, 0.207];
/** The lantern willow's crown half width, a share of its height (willow(): the dome's radius). */
const WILLOW_HALF = 0.36;
/**
 * Crown profile per species: [height share, radius share] pairs from the
 * crown's foot to its top, from the painted silhouettes (foliage-atlas.ts) and
 * the willow's geometry. null: not spaced.
 */
const PROFILE: ReadonlyArray<readonly number[] | null> = [
  [0.04, 1, 1, 0.04], // S1 spruce: widest at the lowest whorl
  [0.5, 0.5, 0.58, 1, 0.97, 0.3], // S2 lodgepole: bare to about half way, then the crown
  [0.04, 1, 0.52, 1, 1, 0.04], // S3 fir: a column, tapering from half way
  [0.36, 0.35, 0.66, 1, 0.97, 0.3], // S4 aspen: an oval round 0.66
  [0.5, 1, 0.8, 0.6], // S5 snag: the stubs
  [0.04, 1, 1, 0.04], // dying spruce
  [0, 1, 1, 0.04], // S6 young spruce: to the ground
  null, // S7 shrub
  [0.04, 1, 1, 0.04], // teal tipped spruce
  [0.3, 0.75, 0.74, 1, 0.94, 0.3], // M2 lantern willow: the dome, its strands below
  null, // M3 glowcaps
  null, // M4 glow ferns
];
/** The spacing grid's cell. */
const SPACE_CELL = 36;

/**
 * Aspens (Lovro: "I'm not sure which one that is supposed to be", on a grove
 * with spruces and pines standing in it): a grove is aspens alone, no conifer
 * threaded through it, and groves are fewer and smaller (the grove noise over
 * ASPEN_GROVE, was 0.69). No aspen where the magic starts (magicAt over 0.25).
 */
const ASPEN_GROVE = 0.715;
/**
 * Lodgepole pines (Lovro, 2:54 to 3:17: "these trees that have this kind of
 * thing on top ... I'm not a fan of them and how they look", his cursor on
 * them): none near the walk (railD under LODGE_NEAR), and the share that
 * stays rises to LODGE_KEEP_FAR far off (railD over LODGE_FAR), where they
 * are yellow green flecks in a far stand. The rest become spruces painted as
 * the warmest of the three (spruce-b, cell 1), so the near forest keeps some
 * of their warmth, and one in four a fir.
 */
const LODGE_KEEP_NEAR = 0;
const LODGE_KEEP_FAR = 0.5;
const LODGE_NEAR = 500;
const LODGE_FAR = 1500;
/**
 * The magic halo (magicAt's wider, softer field round its core, layout.ts):
 * extra glow ferns, glowcaps and willows where it adds to the core's, at
 * this share of the core's density, from their own random stream.
 */
const HALO_UNDERSTORY = 0.55;

// Species ids.
const SPR = 0; // S1 spruce
const LDG = 1; // S2 lodgepole
const FIR = 2; // S3 fir spire
const ASP = 3; // S4 aspen
const SNAG = 4; // S5 snag
const DYING = 5; // S5 dying spruce
const YNG = 6; // S6 young spruce
const SHR = 7; // S7 shrub
const TEALS = 8; // teal tipped spruce (magic 0.25-0.5)
const M2 = 9; // lantern willow
const M3 = 10; // glowcap cluster
const M4 = 11; // glow fern
const NSP = 12;
const SPECIES_NAME = ["S1", "S2", "S3", "S4", "S5snag", "S5dying", "S6", "S7", "Mteal", "M2", "M3", "M4"];
/** Height range per species, world units. */
const H_RANGE: ReadonlyArray<readonly [number, number]> = [
  [34, 58],
  [42, 64],
  [44, 70],
  [24, 38],
  [28, 48],
  [30, 50],
  [14, 28],
  [6, 11],
  [36, 60],
  [40, 70],
  [4, 18],
  [6, 12],
];
/** Atlas cells per species (FOLIAGE_CELLS order); the magic geometry species have none. */
const CELLS: ReadonlyArray<readonly number[]> = [[0, 1, 2], [3, 4], [5], [7, 8], [12], [11], [6], [9, 10], [13], [], [], []];
/** Species with a dark faceted core near, and the core's colour (display sRGB, the painted dark body). */
const CORE_COL: ReadonlyArray<string | null> = ["#22302a", null, "#17221d", null, null, "#4a2a18", "#29392d", null, "#17202a", null, null, null];
/** Core radius as a share of the height (inside the painted crown). */
const CORE_R: readonly number[] = [0.12, 0, 0.065, 0, 0, 0.1, 0.15, 0, 0.12, 0, 0, 0];
/** Magic geometry levels [L1, L2, last level drawn] (v5). */
const MAGIC_LOD: Readonly<Record<number, readonly [number, number, number]>> = {
  [M2]: [700, 2200, 2],
  [M3]: [350, 900, 1],
  [M4]: [250, 700, 1],
};

/** Zone mixes: [spruce, lodgepole, fir, young, snag]; the rest of 1 is spruce. aspen: groves allowed. */
interface Zone {
  name: string;
  x: number;
  z: number;
  r: number;
  mult: number;
  mix: readonly [number, number, number, number, number];
  aspen: boolean;
  shrub: number;
}
const ZONES: readonly Zone[] = [
  { name: "Z1", x: 1250, z: 3950, r: 1000, mult: 1.0, mix: [0.45, 0.25, 0.1, 0.12, 0.03], aspen: true, shrub: 0.35 },
  { name: "Z2", x: 520, z: 2750, r: 900, mult: 1.15, mix: [0.45, 0.2, 0.12, 0.12, 0.03], aspen: true, shrub: 0.35 },
  { name: "Z3", x: 0, z: 1750, r: 750, mult: 1.0, mix: [0.25, 0.4, 0.25, 0.05, 0.05], aspen: false, shrub: 0.25 },
  { name: "Z4", x: 1470, z: 600, r: 650, mult: 1.1, mix: [0.45, 0.15, 0.2, 0.12, 0.03], aspen: true, shrub: 0.3 },
  { name: "Z5", x: 700, z: -350, r: 1500, mult: 1.05, mix: [0.55, 0.1, 0.2, 0.1, 0.02], aspen: true, shrub: 0.2 },
];
/** [x, z, x, z] of the two stretches of trail the forest still keeps clear on the pool's south bank (see pathD). */
const OLD_BANK_TRAIL: ReadonlyArray<readonly [number, number, number, number]> = [
  [40, 1690, 64, 1640],
  [64, 1640, 62, 1608],
];
const BACKDROP: Zone = { name: "BG", x: 0, z: 0, r: 1, mult: 0.55, mix: [0.5, 0.1, 0.35, 0.05, 0], aspen: false, shrub: 0 };

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
/** mulberry32(seed) as it stands after n draws: its state steps by 0x6d2b79f5 a draw. */
function mulberry32After(seed: number, n: number) {
  return mulberry32((seed + Math.imul(n, 0x6d2b79f5)) >>> 0);
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

// ── The giant elders' spots (built by dress-lakeforest.ts) ─────────────────

/**
 * Where a giant elder stands. dress-lakeforest.ts builds them; the wild trees
 * keep clear of them (wave 3: SPACE_K). A pure function of layout.ts and the
 * ground, so both modules read the same list (giantSpots).
 */
export interface GiantSpot {
  /** Trunk foot. */
  x: number;
  z: number;
  /** Ground under it (terrainHeight). */
  g: number;
  /** Height before the stretch over the camera's line (sy), and the stretch. */
  h: number;
  sy: number;
  /** Crown width (the instance's x and z scale). */
  w: number;
  /** 0 tiered, 1 weeping. */
  sp: 0 | 1;
  /** The grid key its other chances hash from (dress-lakeforest's rnd(k, s)). */
  k: number;
}
/** The grid the giants are placed on (dress-lakeforest's v5 grey forest grid, kept so the corridors and views hold). */
const GIANT_GRID = 62;
/** Share of giants that are the tiered species (the rest weep). */
const TIERED_SHARE = 0.62;
/** How far past the forest's circle the grid reaches (the field's lobes reach past it). */
const GIANT_EXT = 520;
/**
 * Wave 3: a giant the halo adds (magicAt with its halo over the core) comes
 * down toward the halo's edge, to about a big willow's height where the field
 * is 0.48, so the giants thin and shrink into the willows and the teal tipped
 * spruces. The core's giants are as before.
 */
const GIANT_EDGE = 0.5;
/**
 * Review round 2: the halo's giants stood one to nearly every cell of the
 * grid, in near equal sizes (the rows of pale diamonds seen from the lake were
 * mostly the halo's willows, a willow's far level of detail; see the magic
 * understory). A halo giant now stands anywhere in its cell, is taken at the
 * square of the field's chance (so they thin toward the edge as well as
 * shrink), varies more in size, and is more often the weeping kind toward the
 * edge: the tiered share falls from TIERED_SHARE at the field's 0.72 to
 * GIANT_HALO_TIERED at 0.48.
 */
const GIANT_HALO_TIERED = 0.25;
/**
 * Review round 3: a giant the halo adds keeps its trunk this far from the
 * glowing stream's line (GLOW_STREAM; the drawn stream meanders up to 22 off
 * it and is at most about 8 wide each side). The halo now reaches down the
 * stream's valley (magicAt), and two of its giants stood in the water there.
 * The core's giants are as before (none stands this close to the line).
 */
const GIANT_STREAM = 60;
/** dress-lakeforest.ts's hash, as it places the giants. */
function giantRnd(i: number, s = 0): number {
  const x = Math.sin(i * 127.1 + s * 311.7 + 74.7) * 43758.5453;
  return x - Math.floor(x);
}
let giantMemo: { H: (x: number, z: number) => number; spots: GiantSpot[] } | null = null;
/**
 * The giants (bible 1.15): they follow the magic field, never a circle. They
 * begin where magicAt passes 0.48 and own the ground past 0.8 (forest.ts's
 * teal spruces and willows fill below that); size grows toward the tree.
 * Out of the clearing, the lake and the corridors; clear of the camera's line
 * from the lake stop into the forest (a crown over the line is raised to start
 * 14 above it, or the tree is left out) and of the floating steps.
 */
export function giantSpots(H: (x: number, z: number) => number): readonly GiantSpot[] {
  if (giantMemo && giantMemo.H === H) return giantMemo.spots;
  const Fo = WORLD.forest;
  const L = WORLD.lake;
  const A6 = PLACES[5].pos;
  const GH = GREAT_TREE.height;
  const curve = new THREE.CatmullRomCurve3(TRAIL.map((q) => new THREE.Vector3(q[0], q[1], q[2])), false, "centripetal");
  const n1 = TRAIL.length - 1;
  const cam: THREE.Vector3[] = [];
  const tA = (PLACES[4].trail + 1) / n1;
  const tB = (PLACES[5].trail + 4) / n1;
  for (let i = 0; i <= 500; i++) cam.push(curve.getPoint(tA + ((tB - tA) * i) / 500));
  // The camera's points in runs of 25, each with its box, so a spot far from a
  // run skips it (the same nearest distance and the same height over the line).
  const RUN = 25;
  const runBox: number[] = [];
  for (let i = 0; i < cam.length; i += RUN) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let j = i; j < Math.min(cam.length, i + RUN); j++) {
      a0 = Math.min(a0, cam[j].x);
      a1 = Math.max(a1, cam[j].x);
      b0 = Math.min(b0, cam[j].z);
      b1 = Math.max(b1, cam[j].z);
    }
    runBox.push(a0, a1, b0, b1);
  }
  const keepClear = (px: number, pz: number, r: number) => {
    for (const [ax, az, bx, bz, hw] of FOREST_KEEP_CLEAR) {
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(px - ax - dx * t, pz - az - dz * t) < hw + r) return false;
    }
    return true;
  };
  const sdx = STEPS_TOP[0] - STEPS_FOOT[0];
  const sdz = STEPS_TOP[2] - STEPS_FOOT[2];
  const sL = Math.hypot(sdx, sdz);
  const underSteps = (px: number, pz: number) => {
    const t = Math.min(1, Math.max(0, ((px - STEPS_FOOT[0]) * sdx + (pz - STEPS_FOOT[2]) * sdz) / (sL * sL)));
    return { d: Math.hypot(px - STEPS_FOOT[0] - sdx * t, pz - STEPS_FOOT[2] - sdz * t), y: STEPS_FOOT[1] + (STEPS_TOP[1] - STEPS_FOOT[1]) * t };
  };
  /** Distance to the glowing stream's line (GIANT_STREAM). */
  const streamD = (px: number, pz: number) => {
    let best = Infinity;
    for (let i = 0; i + 1 < GLOW_STREAM.length; i++) {
      const qx = GLOW_STREAM[i][0];
      const qz = GLOW_STREAM[i][2];
      const sx = GLOW_STREAM[i + 1][0] - qx;
      const sz = GLOW_STREAM[i + 1][2] - qz;
      const t = Math.min(1, Math.max(0, ((px - qx) * sx + (pz - qz) * sz) / (sx * sx + sz * sz)));
      best = Math.min(best, Math.hypot(px - qx - sx * t, pz - qz - sz * t));
    }
    return best;
  };
  const S = GIANT_GRID;
  const spots: GiantSpot[] = [];
  for (let gz = Fo.z - Fo.r - GIANT_EXT; gz <= Fo.z + Fo.r + GIANT_EXT; gz += S) {
    for (let gx = Fo.x - Fo.r - GIANT_EXT; gx <= Fo.x + Fo.r + GIANT_EXT; gx += S) {
      const k = gx * 3.1 + gz * 7.7;
      let tx = gx + (giantRnd(k, 101) - 0.5) * S * 0.8;
      let tz = gz + (giantRnd(k, 102) - 0.5) * S * 0.8;
      // A cell the field's core takes keeps its giant where it stood; one it
      // does not take may be the halo's (GIANT_HALO_TIERED).
      const halo = giantRnd(k, 103) > smooth(0.48, 0.8, magicAt(tx, tz, true));
      let mg: number;
      if (halo) {
        tx = gx + (giantRnd(k, 121) - 0.5) * S;
        tz = gz + (giantRnd(k, 122) - 0.5) * S;
        mg = magicAt(tx, tz);
        const take = smooth(0.48, 0.8, mg);
        if (giantRnd(k, 103) > take * take || mg <= magicAt(tx, tz, true) + 1e-6) continue;
        if (streamD(tx, tz) < GIANT_STREAM) continue;
      } else mg = magicAt(tx, tz);
      const rr = 1 - smooth(0.5, 1.0, mg);
      if (Math.hypot(tx - Fo.clearing.x, tz - Fo.clearing.z) < Fo.clearing.r + 10) continue;
      if (Math.hypot(tx - L.x, tz - L.z) < L.r + 40) continue;
      let h = (185 - 90 * rr) * (halo ? 0.68 + 0.56 * giantRnd(k, 104) : 0.82 + 0.3 * giantRnd(k, 104));
      if (mg > magicAt(tx, tz, true) + 1e-6) h *= 1 - GIANT_EDGE * (1 - smooth(0.48, 0.7, mg));
      if (tx > -220) h = Math.min(h, 125 - Math.max(0, tx + 220) * 0.12);
      const dG = Math.hypot(tx - A6.x, tz - A6.z);
      h = Math.min(h, GH / 2 - 2 + Math.max(0, dG - 260) * 0.45);
      const tiered = halo ? GIANT_HALO_TIERED + (TIERED_SHARE - GIANT_HALO_TIERED) * smooth(0.48, 0.72, mg) : TIERED_SHARE;
      const sp: 0 | 1 = giantRnd(k, 110) < tiered ? 0 : 1;
      const tr = h * 0.075;
      if (!keepClear(tx, tz, tr + 6)) continue;
      const g = H(tx, tz);
      let near = Infinity;
      let camY = -Infinity;
      const w = h * (0.92 + giantRnd(k, 111) * 0.18);
      // How far the crown reaches from the axis: the tiered discs (and the side pad), the weeping lobes.
      const cr = w * (sp === 0 ? 0.37 : 0.46);
      const reach = Math.max(tr + 30, cr + 16) + 1;
      for (let i = 0, b = 0; i < cam.length; i += RUN, b += 4) {
        const ex = Math.max(runBox[b] - tx, 0, tx - runBox[b + 1]);
        const ez = Math.max(runBox[b + 2] - tz, 0, tz - runBox[b + 3]);
        if (ex * ex + ez * ez > reach * reach) continue;
        for (let j = i; j < Math.min(cam.length, i + RUN); j++) {
          const c = cam[j];
          const d = Math.hypot(c.x - tx, c.z - tz);
          if (d < near) near = d;
          if (d < cr + 16) camY = Math.max(camY, c.y);
        }
      }
      if (near < tr + 30) continue;
      // Crowns over the camera's line start 14 above it (the weeping strands hang to 0.3 of the height).
      const low = sp === 0 ? 0.5 : 0.3;
      let sy = 1;
      if (camY > -Infinity) sy = Math.max(1, (camY + 14 - g) / (h * low));
      if (sy > 1.45) continue;
      const us = underSteps(tx, tz);
      if (us.d < cr + 30 && g + h * sy > us.y - 40) continue;
      spots.push({ x: tx, z: tz, g, h, sy, w, sp, k });
    }
  }
  giantMemo = { H, spots };
  return spots;
}

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

// ── The v6 kit: cores and cards ─────────────────────────────────────────────

/**
 * The near core: a dark faceted cone in two tiers of 6 sides (12 tris), radius
 * 1 at its base (the instance scales it to the species' CORE_R), white
 * vertex colour darkening toward the ground (the instance colour is the
 * painted body colour).
 */
function coreCone(): Soup {
  const s = new Soup();
  const tiers: ReadonlyArray<readonly [number, number, number]> = [
    [0.08, 0.72, 1.0],
    [0.42, 1.0, 0.6],
  ];
  const n = 6;
  tiers.forEach(([y0, y1, r], ti) => {
    const ph = ti * 0.5;
    const apex = V(0, y1, 0);
    for (let i = 0; i < n; i++) {
      const a0 = ph + (i / n) * Math.PI * 2;
      const a1 = ph + ((i + 1) / n) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const p0 = V(Math.cos(a0) * r, y0, Math.sin(a0) * r);
      const p1 = V(Math.cos(a1) * r, y0, Math.sin(a1) * r);
      const nn = V(Math.cos(am), 0.45, Math.sin(am)).normalize();
      const lo = new THREE.Color(0.8, 0.8, 0.8);
      const hi = new THREE.Color(1, 1, 1);
      s.vert(p0, V(Math.cos(a0), 0.45, Math.sin(a0)).normalize(), lo);
      s.vert(apex, nn, hi);
      s.vert(p1, V(Math.cos(a1), 0.45, Math.sin(a1)).normalize(), lo);
    }
  });
  return s;
}

/**
 * n crossed vertical cards through the trunk (2 tris each), for the card
 * shader: uv is the corner (0..1 across, 0..1 up), aDir the card's plane
 * direction in the tree's xz. The shader sizes each card from the instance's
 * atlas cell (foliageCellRects), so one geometry serves every species.
 * Positions are a nominal crown (radius 0.2) for bounds and the park's tree index.
 */
function cards(n: number, phase: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const dir: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * Math.PI;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const b = pos.length / 3;
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      pos.push(dx * (u - 0.5) * 0.4, v, dz * (u - 0.5) * 0.4);
      uv.push(u, v);
      dir.push(dx, dz);
      nor.push(0, 1, 0);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aDir", new THREE.Float32BufferAttribute(dir, 2));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** S5 snag near: a bare grey trunk and two stubs (14 tris), as v5. */
function snag(): Soup {
  const s = new Soup();
  const low = C("#6a655b");
  const high = C("#9c968a");
  const sides = 5;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const r0 = 0.035;
    const r1 = 0.008;
    s.flat(V(Math.cos(a0) * r0, -0.04, Math.sin(a0) * r0), V(Math.cos(a0) * r1, 1, Math.sin(a0) * r1), V(Math.cos(a1) * r1, 1, Math.sin(a1) * r1), [low, high, high]);
    s.flat(V(Math.cos(a0) * r0, -0.04, Math.sin(a0) * r0), V(Math.cos(a1) * r1, 1, Math.sin(a1) * r1), V(Math.cos(a1) * r0, -0.04, Math.sin(a1) * r0), [low, high, low]);
  }
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
    // Review round 3: a low cap, the near dome's shape. The lower point hung
    // 0.32 under the rim and carried the teal underside, so far willows read
    // as pale diamonds from the lake; now it is 0.06 under (the same 8
    // triangles, colours and normals).
    const oct = new THREE.OctahedronGeometry(1, 0);
    const p = oct.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const d = V(p.getX(i), p.getY(i), p.getZ(i));
      s.vert(V(domeC.x + d.x * domeR.x, domeC.y + (d.y < 0 ? d.y * 0.06 : d.y * domeR.y * 1.6) - 0.1, domeC.z + d.z * domeR.z), d.clone().normalize(), leaf(d, d), d.y < -0.3 ? TEAL.clone().multiplyScalar(0.5) : null);
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

// Cheap laptops (load): one program for the core and the magic kit. The magic
// glow is gated by uIsMagic (per material) in place of a MAGIC define, so the
// two materials share a program; the core's vGlow is 0 and adds nothing.
const VERT_PARS = /* glsl */ `
attribute vec3 aMorph;
attribute float aPatch;
attribute vec3 aGlow;
varying vec3 vGlow;
uniform float uMagic;
uniform float uIsMagic;
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
vGlow = vec3( 0.0 );
if ( uIsMagic > 0.5 ) {
  float per = mix( 3.0, 6.0, fHash );
  float amp = mix( 0.3, 0.5, fract( fHash * 7.13 ) );
  vGlow = aGlow * uMagic * ( 1.0 - amp + amp * ( 0.5 + 0.5 * sin( uTime * 6.2832 / per + fHash * 40.0 ) ) );
}
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
varying vec3 vGlow;
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += vGlow;
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

function foliageHook(u: SharedUniforms, lod: { value: THREE.Vector2 }, magic: boolean): Hook {
  return (shader) => {
    Object.assign(shader.uniforms, u, { uLod: lod, uIsMagic: { value: magic ? 1 : 0 } });
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

// ── The card shader (one program for near, mid and far; uFarCard per material) ──

interface CardUniforms {
  uCellRect: { value: THREE.Vector4[] };
  uCut: { value: THREE.Vector4 };
  uFlutter: { value: number };
  uGlowGain: { value: number };
  uPuff: { value: THREE.Vector3 };
}

const CARD_VERT_PARS = /* glsl */ `
attribute float aCell;
attribute vec2 aDir;
uniform vec4 uCellRect[16];
uniform float uTime;
uniform vec2 uSwayR;
uniform float uSwayAmp;
uniform float uFlutter;
uniform vec2 uWeld;
uniform vec3 uMassTint;
uniform float uGustTint;
uniform vec4 uCut;
uniform vec3 uPuff;
uniform float uFarCard;
varying float vFH;
varying float vCut;
varying vec3 vBend;
`;

/** After <uv_vertex>: the instance's cell, its uv and the card's local x (units of height). */
const CARD_VERT_UV = /* glsl */ `
#include <uv_vertex>
vec4 fCr = uCellRect[ int( aCell + 0.5 ) ];
float fCu = mix( fCr.x, fCr.y, uv.x );
vMapUv = vec2( fCu, mix( fCr.z, fCr.w, uv.y ) );
float fCh = max( fCr.w - fCr.z, 1e-4 );
float fXl = ( fCu - 0.5 * ( fCr.x + fCr.y ) ) / fCh;
float fHalf = max( 0.5 * ( fCr.y - fCr.x ) / fCh, 0.06 );
`;

/** After <color_vertex>: instance position, distance, hash; tint welding; the gust band; the cutoff. */
const CARD_VERT_COLOR = /* glsl */ `
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
#ifdef USE_INSTANCING_COLOR
  vColor.rgb = mix( instanceColor.rgb, uMassTint, smoothstep( uWeld.x, uWeld.y, fCd ) );
  vColor.rgb *= 1.0 + uGustTint * fGust * smoothstep( 0.35, 1.0, uv.y );
#endif
vCut = mix( uCut.x, uCut.y, smoothstep( uCut.z, uCut.w, fCd ) );
vFH = uv.y;
`;

/** Replaces <begin_vertex>: the card in the tree's space, sway and flutter, the bent normal. */
const CARD_VERT_BEGIN = /* glsl */ `
fXl *= 1.0 + uPuff.x * smoothstep( uPuff.y, uPuff.z, fCd );
vec3 transformed = vec3( aDir.x * fXl, uv.y, aDir.y * fXl );
vec3 fBo = vec3( transformed.x / fHalf, ( uv.y - 0.4 ) * 1.2, transformed.z / fHalf );
{
  float amp = uSwayAmp * ( 1.0 - smoothstep( uSwayR.x, uSwayR.y, fCd ) );
  if ( amp > 0.0 ) {
    float k = max( uv.y - 0.08, 0.0 );
    k *= k;
    float w = sin( uTime * 1.5 + fHash * 6.2832 ) * 0.65 + sin( uTime * 2.6 + fHash * 11.0 ) * 0.35 + fGust * 0.8;
    transformed.x += amp * k * w;
    transformed.z += amp * k * w * 0.55;
    float fl = uFlutter * ( amp / max( uSwayAmp, 1e-5 ) ) * abs( uv.x - 0.5 ) * 2.0 * sin( uTime * 3.1 + fHash * 20.0 + uv.y * 5.0 );
    transformed.xz += vec2( -aDir.y, aDir.x ) * fl;
  }
}
vec3 fRight = vec3( 0.0 );
if ( uFarCard > 0.5 ) {
  vec3 f = cameraPosition - fIp;
  f.y = 0.0;
  f = normalize( f + vec3( 1e-5, 0.0, 0.0 ) );
  fRight = vec3( f.z, 0.0, -f.x );
  vBend = mat3( viewMatrix ) * vec3( fRight * ( fXl / fHalf ) + vec3( 0.0, ( uv.y - 0.4 ) * 1.2, 0.0 ) );
} else {
  vBend = normalMatrix * ( mat3( instanceMatrix ) * fBo );
}
`;

/** After <project_vertex>, far cards only: one card turning on its vertical axis. */
const CARD_VERT_PROJECT_FAR = /* glsl */ `
#include <project_vertex>
if ( uFarCard > 0.5 ) {
  float fSx = length( vec3( instanceMatrix[ 0 ] ) );
  float fSy = length( vec3( instanceMatrix[ 1 ] ) );
  mvPosition = viewMatrix * vec4( fIp + fRight * fXl * fSx + vec3( 0.0, uv.y * fSy, 0.0 ), 1.0 );
  gl_Position = projectionMatrix * mvPosition;
}
`;

const CARD_FRAG_PARS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uRim;
uniform float uMagic;
uniform float uGlowGain;
varying float vFH;
varying float vCut;
varying vec3 vBend;
float fGlowM = 0.0;
`;

/** Replaces <map_fragment>: the painted texel; coverage from a / 0.8, the glow mask from a above 0.86. */
const CARD_FRAG_MAP = /* glsl */ `
{
  vec4 tx = texture2D( map, vMapUv );
  fGlowM = smoothstep( 0.86, 0.96, tx.a );
  diffuseColor.rgb *= tx.rgb;
  diffuseColor.a = min( tx.a * 1.25, 1.0 );
}
`;

/** Replaces <alphatest_fragment>: the distance cutoff, sharpened to one pixel (Golus) for alpha to coverage. */
const CARD_FRAG_ALPHA = /* glsl */ `
#ifdef ALPHA_TO_COVERAGE
  diffuseColor.a = clamp( ( diffuseColor.a - vCut ) / max( fwidth( diffuseColor.a ), 1e-4 ) + 0.5, 0.0, 1.0 );
  if ( diffuseColor.a < 0.004 ) discard;
#else
  if ( diffuseColor.a < vCut ) discard;
  diffuseColor.a = 1.0;
#endif
`;

/** Replaces <normal_fragment_begin>: the bent normal, the same from both faces. */
const CARD_FRAG_NORMAL = /* glsl */ `
float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
vec3 normal = normalize( vBend );
vec3 nonPerturbedNormal = normal;
`;

const CARD_FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * fGlowM * uMagic * uGlowGain;
`;

function cardHook(u: SharedUniforms, cu: CardUniforms, far: boolean): Hook {
  return (shader) => {
    Object.assign(shader.uniforms, u, cu, { uFarCard: { value: far ? 1 : 0 } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + CARD_VERT_PARS)
      .replace("#include <uv_vertex>", CARD_VERT_UV)
      .replace("#include <color_vertex>", CARD_VERT_COLOR)
      .replace("#include <begin_vertex>", CARD_VERT_BEGIN)
      .replace("#include <project_vertex>", CARD_VERT_PROJECT_FAR);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + CARD_FRAG_PARS)
      .replace("#include <map_fragment>", CARD_FRAG_MAP)
      .replace("#include <alphatest_fragment>", CARD_FRAG_ALPHA)
      .replace("#include <normal_fragment_begin>", CARD_FRAG_NORMAL)
      .replace("#include <emissivemap_fragment>", CARD_FRAG_EMISSIVE)
      .replace("#include <opaque_fragment>", FRAG_RIM);
  };
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
  cell: Float32Array | null;
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
  // The trail's old line on the pool's south bank, from the cliff's foot to
  // the log (it came out of the cave's side passage there until the cave was
  // removed, 2026-10-13; the trail now reaches the log from the pool's shore).
  // The trees are dealt below in ONE random sequence for the whole world and
  // scaled by ONE sum of every candidate's weight, so a corridor that moves
  // here by 30 units deals every tree south of the gorge again. Until the
  // forest is dealt again on purpose it keeps this corridor clear as it was;
  // no tree stands or falls because of it (v6-cave-drop: every tree is where
  // it stood).
  for (const [ax, az, bx, bz] of OLD_BANK_TRAIL) pathD.segment(ax, az, bx, bz, 60);
  const brookD = new Grid(999);
  brookD.polyline(BROOK, 60);
  brookD.polyline(STREAM, 60);
  const riverD = new Grid(999);
  riverD.polyline(RIVER, 120);
  // Wave 3: where water is drawn near enough to ask water.ts's waterAt, which
  // is exact but not cheap: round the streams' and the river's lines out past
  // their widest ribbons (the stream is about 64 wide each side at the lip, the
  // glowing stream meanders up to 22 off its line), the lake's shore, the pool
  // and the tarn. Anywhere else no water is drawn.
  const wetNear = new Grid(999);
  wetNear.polyline(STREAM, 100);
  wetNear.polyline(GLOW_STREAM, 60);
  wetNear.polyline(BROOK, 50);
  wetNear.polyline(RIVER, 60);
  const tarn = WORLD.upperFalls.tarn;
  const inWater = (x: number, z: number, margin: number): boolean => {
    const near =
      wetNear.get(x, z, 999) < 999 ||
      hyp(x - WORLD.lake.x, z - WORLD.lake.z) < WORLD.lake.r + 60 ||
      hyp(x - WORLD.pool.x, z - WORLD.pool.z) < WORLD.pool.r + 40 ||
      hyp(x - tarn.x, z - tarn.z) < tarn.r + 40;
    return near && waterAt(x, z, hAt, margin);
  };

  // The rail: the camera's lowest height near each cell, and the distance to it.
  const camMinY = new Grid(1e9);
  const railD = new Grid(999);
  const curve = new THREE.CatmullRomCurve3(TRAIL.map((q) => new THREE.Vector3(q[0], q[1], q[2])), false, "centripetal");
  const nK = TRAIL.length - 1;
  const GROUND_KINDS: readonly TrailKind[] = ["walk", "dive", "rise", "climb", "hike"];
  const NS = 3600;
  const p = new THREE.Vector3();
  const RR = 250;
  for (let s = 0; s <= NS; s++) {
    const t = s / NS;
    const kind = TRAIL_KIND[Math.min(nK - 1, Math.floor(t * nK))];
    if (!GROUND_KINDS.includes(kind)) continue;
    curve.getPoint(t, p);
    if (p.x < ROI.minX || p.x > ROI.maxX || p.z < ROI.minZ || p.z > ROI.maxZ) continue;
    const i0 = Math.max(0, Math.floor((p.x - RR - ROI.minX) / G));
    const i1 = Math.min(railD.nx - 1, Math.floor((p.x + RR - ROI.minX) / G));
    const j0 = Math.max(0, Math.floor((p.z - RR - ROI.minZ) / G));
    const j1 = Math.min(railD.nz - 1, Math.floor((p.z + RR - ROI.minZ) / G));
    for (let j = j0; j <= j1; j++) {
      const z = ROI.minZ + (j + 0.5) * G;
      for (let i = i0; i <= i1; i++) {
        const x = ROI.minX + (i + 0.5) * G;
        const d = hyp(x - p.x, z - p.z);
        const k = j * railD.nx + i;
        if (d < railD.a[k]) railD.a[k] = d;
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
  const pockets = [PLACES[0].pos, PLACES[1].pos, PLACES[4].pos];
  /** The pockets' x and z as plain numbers, for the candidates' loops (load, review round 2). */
  const PKX = pockets.map((p) => p.x);
  const PKZ = pockets.map((p) => p.z);
  const keepClear = (px: number, pz: number, r: number) => {
    for (const [ax, az, bx, bz, hw] of FOREST_KEEP_CLEAR) {
      const dx = bx - ax;
      const dz = bz - az;
      const u = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
      if (hyp(px - ax - dx * u, pz - az - dz * u) < hw + r) return false;
    }
    return true;
  };

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

  const inA5View = (x: number, z: number) => {
    const dx = x - a5cam[0];
    const dz = z - a5cam[2];
    if (dx * dx + dz * dz > 720 * 720) return false;
    let a = (Math.atan2(dx, -dz) * 180) / Math.PI - 297;
    a -= 360 * Math.round(a / 360);
    return Math.abs(a) < 22;
  };

  // The magic field, sampled (wave 3). It matters only over 0.25 (teal tips,
  // willows, the thinning into the giants' ground), so the deal reads its
  // core only inside the box where the core passes 0.2 (cx0..cz1, padded by
  // 80) and the halo is read only inside its own box (mx0..mz1), for the trees
  // that stand; elsewhere both are 0. The core is sampled on the lattice and in
  // the window it was always sampled in (every 40), which holds all of it, and
  // gives the understory's box as before (over 0.28). The halo is sampled every
  // 80 over a wider window: how much understory it adds (haloShare) and where
  // (haloPick: each lattice point weighted by what it adds, the willows by
  // their ring, 0.48 to 0.88).
  let fx0 = Infinity, fx1 = -Infinity, fz0 = Infinity, fz1 = -Infinity;
  let cx0 = Infinity, cx1 = -Infinity, cz0 = Infinity, cz1 = -Infinity;
  let mx0 = Infinity, mx1 = -Infinity, mz0 = Infinity, mz1 = -Infinity;
  const coreSum = [0, 0, 0];
  const haloSum = [0, 0, 0];
  const pickPts: number[][] = [[], [], [], []]; // x, z, running weight
  const pickSum = [0, 0, 0, 0];
  const addPick = (u: number, x: number, z: number, wgt: number) => {
    if (wgt <= 0) return;
    pickSum[u] += wgt;
    pickPts[u].push(x, z, pickSum[u]);
  };
  for (let z = Fo.z - 1400; z <= Fo.z + 1400; z += 40) {
    for (let x = Fo.x - 1400; x <= Fo.x + 1600; x += 40) {
      const mc = magicAt(x, z, true);
      if (mc > 0.28) {
        fx0 = Math.min(fx0, x);
        fx1 = Math.max(fx1, x);
        fz0 = Math.min(fz0, z);
        fz1 = Math.max(fz1, z);
      }
      if (mc > 0.2) {
        cx0 = Math.min(cx0, x - 80);
        cx1 = Math.max(cx1, x + 80);
        cz0 = Math.min(cz0, z - 80);
        cz1 = Math.max(cz1, z + 80);
      }
      // The core's understory weight, every other point (the halo's 80 spacing), for haloShare.
      if ((x - Fo.x) % 80 === 0 && (z - Fo.z) % 80 === 0) {
        coreSum[0] += smooth(0.5, 0.8, mc);
        coreSum[1] += smooth(0.45, 0.85, mc);
        coreSum[2] += smooth(0.28, 0.7, mc);
      }
      // Review round 2: the core's willows, planted again (pick list 3).
      addPick(3, x, z, smooth(0.5, 0.8, mc));
    }
  }
  for (let z = Fo.z - 2000; z <= Fo.z + 2000; z += 80) {
    for (let x = Fo.x - 2200; x <= Fo.x + 2200; x += 80) {
      const mn = magicAt(x, z);
      if (mn <= 0.2) continue;
      mx0 = Math.min(mx0, x - 160);
      mx1 = Math.max(mx1, x + 160);
      mz0 = Math.min(mz0, z - 160);
      mz1 = Math.max(mz1, z + 160);
      const mc = magicAt(x, z, true);
      if (mn <= mc) continue;
      const e1 = smooth(0.45, 0.85, mn) - smooth(0.45, 0.85, mc);
      const e2 = smooth(0.28, 0.7, mn) - smooth(0.28, 0.7, mc);
      haloSum[0] += smooth(0.5, 0.8, mn) - smooth(0.5, 0.8, mc);
      haloSum[1] += e1;
      haloSum[2] += e2;
      // Review round 2: the willows thin toward the halo's outer edge.
      addPick(0, x, z, smooth(0.48, 0.62, mn) * (1 - smooth(0.75, 0.88, mn)) * smooth(0.48, 0.88, mn));
      addPick(1, x, z, e1);
      addPick(2, x, z, e2);
    }
  }
  const haloShare = (u: number) => (coreSum[u] > 0 ? (haloSum[u] / coreSum[u]) * HALO_UNDERSTORY : 0);
  /**
   * A spot for the halo's understory u: a lattice point by its weight,
   * anywhere in its 80 square (u 3, the core's willows again: its 40 square).
   * pickW is the picked point's weight.
   */
  let pickW = 0;
  const haloPick = (u: number, R: () => number): [number, number] => {
    const P = pickPts[u];
    const r = R() * pickSum[u];
    let lo = 0;
    let hi = P.length / 3 - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (P[mid * 3 + 2] < r) lo = mid + 1;
      else hi = mid;
    }
    pickW = P[lo * 3 + 2] - (lo > 0 ? P[lo * 3 - 1] : 0);
    const step = u === 3 ? 40 : 80;
    return [P[lo * 3] + (R() - 0.5) * step, P[lo * 3 + 1] + (R() - 0.5) * step];
  };

  // Candidates.
  const nxC = Math.floor((ROI.maxX - ROI.minX) / CELL);
  const nzC = Math.floor((ROI.maxZ - ROI.minZ) / CELL);
  const cand: number[] = []; // x, z, g, weight, clump, zone, capH, ledge, magic (the field's core: the deal)
  const CS = 9;
  let wSum = 0;
  /** Where DEAL_SYNC's row starts in the candidates. */
  let syncAt = -1;
  for (let j = 0; j < nzC; j++) {
    if (j === DEAL_SYNC.row) syncAt = cand.length;
    for (let i = 0; i < nxC; i++) {
      const x = ROI.minX + (i + 0.5 + (hash2(i, j, 1) - 0.5) * 0.9) * CELL;
      const z = ROI.minZ + (j + 0.5 + (hash2(i, j, 2) - 0.5) * 0.9) * CELL;
      const pd = pathD.get(x, z, 999);
      if (pd < 15) continue;
      const g = hAt(x, z);
      if (g < 6 || g > 1060) continue;
      const dl = hyp(x - lake.x, z - lake.z);
      if (dl < lake.r + 22) continue;
      // The Glowing Forest: the giants own the field's heart; the corridors stay clear.
      // The deal reads the field's core, as it always did (wave 3: the halo's changes come after it).
      const mg = x >= cx0 && x <= cx1 && z >= cz0 && z <= cz1 ? magicAt(x, z, true) : 0;
      if (mg > MAGIC_GIANTS) continue;
      const dF = hyp(x - Fo.x, z - Fo.z);
      if (dF < Fo.r + 400 && !keepClear(x, z, 10)) continue;
      if (hyp(x - pool.x, z - pool.z) < pool.r + 90) continue;
      if (hyp(x - WORLD.falls.top[0], z - WORLD.falls.top[2]) < 90) continue;
      const bd = brookD.get(x, z, 999);
      if (bd < 18) continue;
      const rd = riverD.get(x, z, 999);
      if (rd < 50) continue;
      if (inA5View(x, z)) continue;
      const clump = fbm(x / 300, z / 300, 11);
      let pkRing = 0;
      for (let q = 0; q < PKX.length; q++) {
        // Wave 3 (load, the same values): the ring is 0 inside 130 and past 520.
        const ex = x - PKX[q];
        const ez = z - PKZ[q];
        const d2 = ex * ex + ez * ez;
        if (d2 <= 16900 || d2 >= 270400) continue;
        const d = hyp(ex, ez);
        pkRing = Math.max(pkRing, smooth(130, 190, d) * (1 - smooth(420, 520, d)));
      }
      const clumpCut = 0.38 - 0.1 * pkRing;
      if (clump < clumpCut) continue;
      const ny = normalY(x, z);
      // Ledges in the gorge and on the rim (Z3) keep fir spires on steeper ground.
      const ledge = ny < 0.72 && ny >= 0.55 && hyp(x - ZONES[2].x, z - ZONES[2].z) < ZONES[2].r;
      if (ny < 0.72 && !ledge) continue;
      const fine = fbm(x / 70, z / 70, 23);
      let m = smooth(6, 18, g) * (1 - smooth(880, 1060, g)) * (ledge ? 0.55 : smooth(0.72, 0.84, ny));
      m *= smooth(15, 34, pd) * smooth(18, 38, bd) * smooth(50, 90, rd) * smooth(lake.r + 22, lake.r + 70, dl);
      m *= 0.85 + 0.35 * smooth(0.99, 0.9, ny);
      m *= Math.min(1.25, 0.7 + 0.6 * fine);
      // Thinning into the giants' ground.
      m *= 1 - 0.7 * smooth(0.55, MAGIC_GIANTS, mg);
      const dS = hyp(x - signpost.x, z - signpost.z);
      if (dS < 70) continue;
      const dJ = hyp(x - jettyFoot.x, z - jettyFoot.z);
      if (dJ < 50) continue;
      const dCamp = hyp(x - (lookout.x + 45), z - (lookout.z + 35));
      if (dCamp < 135 * (0.8 + 0.4 * fine)) continue;
      m *= smooth(135, 190, dCamp);
      // C1 (B6): the campers' tents at the knoll's west foot, (238..262, 2722..2777).
      const dTents = hyp(x - 250, z - 2750);
      if (dTents < 55) continue;
      m *= smooth(55, 95, dTents);
      for (let q = 0; q < PKX.length; q++) {
        // The factor is 1 inside 120 and past 480.
        const ex = x - PKX[q];
        const ez = z - PKZ[q];
        const d2 = ex * ex + ez * ez;
        if (d2 <= 14400 || d2 >= 230400) continue;
        const d = hyp(ex, ez);
        m *= 1 + 0.6 * smooth(120, 200, d) * (1 - smooth(380, 480, d));
      }
      if (m <= 0.01) continue;
      let zi = -1;
      let best = 1;
      for (let q = 0; q < ZONES.length; q++) {
        const Z = ZONES[q];
        // Past its radius a zone can never be the nearest (best starts at 1).
        const ex = x - Z.x;
        const ez = z - Z.z;
        if (ex * ex + ez * ez >= Z.r * Z.r) continue;
        const dd = hyp(ex, ez) / Z.r;
        if (dd < best) {
          best = dd;
          zi = q;
        }
      }
      const Z = zi >= 0 ? ZONES[zi] : BACKDROP;
      const far = zi >= 0 ? 1 : 1 - 0.5 * smooth(1500, 3500, railD.get(x, z, 3500));
      const clumpK = smooth(clumpCut, clumpCut + 0.18, clump);
      const w = m * Z.mult * far * clumpK;
      let capH = maxTreeH(x, z, g);
      const CC = WORLD.cloudClear;
      if (hyp(x - CC.x, z - CC.z) > CC.r - 150) capH = Math.min(capH, WORLD.cloudLevel - 40 - g);
      if (dS < 170) capH = Math.min(capH, 12);
      const dLook = hyp(x - lookout.x, z - lookout.z);
      if (dLook < 180) capH = Math.min(capH, 43);
      if (w > 0.005) {
        cand.push(x, z, g, w, clump, zi, capH, ledge ? 1 : 0, mg);
        wSum += w;
      }
    }
  }
  lap("candidates");
  await yieldTask();

  // Sample: scale so the kept count lands on TARGET_WILD (shrubs included), by
  // 1dc7e10's weight sum (K_SUM; it holds the weight of the opening islet's 2
  // candidates, the ISLET_W of 2026-10-15). wSum is today's, for moduleStats.
  const K = (TARGET_WILD * 0.8) / K_SUM;
  let rand = mulberry32(7);
  const REC = 11;
  const recs: number[] = []; // species, x, y, z, h, w, yaw, leanAx, lean, tint, cell
  /** Wave 3: every tree as dealt (x, z, h, w), standing or not, for the density map (bakeMaps). */
  const dealt: number[] = [];
  const TINTS = [
    [1, 1, 1],
    [0.92, 0.97, 0.99],
    [1.06, 1.03, 0.93],
    [0.95, 0.94, 1.0],
    [1.1, 1.07, 0.95],
  ];
  const counts = new Array(NSP).fill(0);
  const zoneCounts: Record<string, number> = {};
  const pickCell = (sp: number) => {
    const cs = CELLS[sp];
    return cs.length ? cs[Math.floor(rand() * cs.length) % cs.length] : 0;
  };
  const record = (sp: number, x: number, y: number, z: number, h: number, w: number, yaw: number, leanAx: number, lean: number, tint: number, cell: number, zn: string) => {
    recs.push(sp, x, y, z, h, w, yaw, leanAx, lean, tint, cell);
    counts[sp]++;
    zoneCounts[zn] = (zoneCounts[zn] ?? 0) + 1;
  };

  // ── Wave 3: crowns keep apart (SPACE_K) ──
  // The trees kept so far, on a grid of SPACE_CELL, each with its crown as
  // [y, radius] pairs in world units (PROFILE), and the giants on their own.
  const SNX = Math.ceil((ROI.maxX - ROI.minX) / SPACE_CELL);
  const SNZ = Math.ceil((ROI.maxZ - ROI.minZ) / SPACE_CELL);
  const sHead = new Int32Array(SNX * SNZ).fill(-1);
  let sCap = 1 << 15;
  let sNext = new Int32Array(sCap);
  let sXZ = new Float64Array(sCap * 2);
  let sProf = new Float64Array(sCap * 6);
  let sN = new Uint8Array(sCap);
  let sR = new Float64Array(sCap);
  let sCount = 0;
  const cProf = new Float64Array(6);
  /** The crown of a tree as [y, r] pairs into out at o; returns the pair count (0: a species not spaced). */
  const crownOf = (out: Float64Array, o: number, sp: number, y: number, h: number, wd: number, cell: number): number => {
    const pr = PROFILE[sp];
    if (!pr) return 0;
    const R = (sp === M2 ? WILLOW_HALF : CELL_HALF[cell] ?? 0.25) * h * wd;
    const n = pr.length >> 1;
    for (let i = 0; i < n; i++) {
      out[o + 2 * i] = y + pr[2 * i] * h;
      out[o + 2 * i + 1] = pr[2 * i + 1] * R;
    }
    return n;
  };
  /** A crown's radius at height y (0 outside it). */
  const rAt = (P: Float64Array, o: number, n: number, y: number): number => {
    if (y < P[o] || y > P[o + 2 * (n - 1)]) return 0;
    for (let i = 0; i < n - 1; i++) {
      const y0 = P[o + 2 * i];
      const y1 = P[o + 2 * i + 2];
      if (y <= y1) {
        const r0 = P[o + 2 * i + 1];
        const r1 = P[o + 2 * i + 3];
        return y1 > y0 ? r0 + ((r1 - r0) * (y - y0)) / (y1 - y0) : Math.max(r0, r1);
      }
    }
    return P[o + 2 * (n - 1) + 1];
  };
  /** The two crowns' summed radius at the height where it is greatest (profiles are piecewise linear, so at a break). */
  const pairWidth = (A: Float64Array, ao: number, an: number, B: Float64Array, bo: number, bn: number): number => {
    const lo = Math.max(A[ao], B[bo]);
    const hi = Math.min(A[ao + 2 * (an - 1)], B[bo + 2 * (bn - 1)]);
    if (hi < lo) return 0;
    let m = rAt(A, ao, an, lo) + rAt(B, bo, bn, lo);
    const t = rAt(A, ao, an, hi) + rAt(B, bo, bn, hi);
    if (t > m) m = t;
    for (let i = 0; i < an; i++) {
      const y = A[ao + 2 * i];
      if (y > lo && y < hi) {
        const s = A[ao + 2 * i + 1] + rAt(B, bo, bn, y);
        if (s > m) m = s;
      }
    }
    for (let i = 0; i < bn; i++) {
      const y = B[bo + 2 * i];
      if (y > lo && y < hi) {
        const s = rAt(A, ao, an, y) + B[bo + 2 * i + 1];
        if (s > m) m = s;
      }
    }
    return m;
  };
  // The giants: trunk and root fins to the canopy's foot, then the canopy.
  const giants = giantSpots(ctx.terrainHeight);
  const GCELL = 128;
  const GNX = Math.ceil((ROI.maxX - ROI.minX) / GCELL);
  const GNZ = Math.ceil((ROI.maxZ - ROI.minZ) / GCELL);
  const gHead = new Int32Array(GNX * GNZ).fill(-1);
  const gNext = new Int32Array(Math.max(1, giants.length));
  const gProf = new Float64Array(Math.max(1, giants.length) * 10);
  const gR = new Float64Array(Math.max(1, giants.length));
  giants.forEach((G, i) => {
    const hs = G.h * G.sy;
    const low = (G.sp === 0 ? 0.48 : 0.3) * hs;
    const cr = G.w * (G.sp === 0 ? 0.37 : 0.46);
    gProf.set([G.g, 0.12 * G.w, G.g + 0.1 * hs, 0.06 * G.w, G.g + low, 0.045 * G.w, G.g + low + 0.5, cr, G.g + hs, 0.6 * cr], i * 10);
    gR[i] = Math.max(cr, 0.12 * G.w);
    const ci = Math.min(GNX - 1, Math.max(0, Math.floor((G.x - ROI.minX) / GCELL)));
    const cj = Math.min(GNZ - 1, Math.max(0, Math.floor((G.z - ROI.minZ) / GCELL)));
    gNext[i] = gHead[cj * GNX + ci];
    gHead[cj * GNX + ci] = i;
  });
  /** The widest crown kept so far (how far a search must reach). */
  let sRmax = 0;
  /** Would a crown (cProf, n pairs, widest R) at (x, z) grow into a kept tree's or a giant's? */
  const crowded = (x: number, z: number, n: number, R: number): boolean => {
    const ci = Math.floor((x - ROI.minX) / SPACE_CELL);
    const cj = Math.floor((z - ROI.minZ) / SPACE_CELL);
    const k = Math.ceil((SPACE_K * (R + sRmax)) / SPACE_CELL);
    for (let j = Math.max(0, cj - k); j <= Math.min(SNZ - 1, cj + k); j++) {
      for (let i = Math.max(0, ci - k); i <= Math.min(SNX - 1, ci + k); i++) {
        for (let t = sHead[j * SNX + i]; t >= 0; t = sNext[t]) {
          const dx = sXZ[2 * t] - x;
          const dz = sXZ[2 * t + 1] - z;
          const d2 = dx * dx + dz * dz;
          const far = SPACE_K * (R + sR[t]);
          if (d2 >= far * far) continue;
          const need = SPACE_K * pairWidth(cProf, 0, n, sProf, 6 * t, sN[t]);
          if (d2 < need * need) return true;
        }
      }
    }
    const gi = Math.floor((x - ROI.minX) / GCELL);
    const gj = Math.floor((z - ROI.minZ) / GCELL);
    for (let j = Math.max(0, gj - 1); j <= Math.min(GNZ - 1, gj + 1); j++) {
      for (let i = Math.max(0, gi - 1); i <= Math.min(GNX - 1, gi + 1); i++) {
        for (let t = gHead[j * GNX + i]; t >= 0; t = gNext[t]) {
          const G = giants[t];
          const dx = G.x - x;
          const dz = G.z - z;
          const d2 = dx * dx + dz * dz;
          const far = SPACE_K * (R + gR[t]);
          if (d2 >= far * far) continue;
          const need = SPACE_K * pairWidth(cProf, 0, n, gProf, 10 * t, 5);
          if (d2 < need * need) return true;
        }
      }
    }
    return false;
  };
  /** Keep a spaced tree's crown (cProf, n pairs) at (x, z). */
  const keepCrown = (x: number, z: number, n: number, R: number) => {
    if (sCount >= sCap) {
      sCap *= 2;
      const nx = new Int32Array(sCap);
      nx.set(sNext);
      sNext = nx;
      const xz = new Float64Array(sCap * 2);
      xz.set(sXZ);
      sXZ = xz;
      const pf = new Float64Array(sCap * 6);
      pf.set(sProf);
      sProf = pf;
      const nn = new Uint8Array(sCap);
      nn.set(sN);
      sN = nn;
      const rr = new Float64Array(sCap);
      rr.set(sR);
      sR = rr;
    }
    const ci = Math.min(SNX - 1, Math.max(0, Math.floor((x - ROI.minX) / SPACE_CELL)));
    const cj = Math.min(SNZ - 1, Math.max(0, Math.floor((z - ROI.minZ) / SPACE_CELL)));
    const t = sCount++;
    sXZ[2 * t] = x;
    sXZ[2 * t + 1] = z;
    for (let i = 0; i < 2 * n; i++) sProf[6 * t + i] = cProf[i];
    sN[t] = n;
    sR[t] = R;
    if (R > sRmax) sRmax = R;
    sNext[t] = sHead[cj * SNX + ci];
    sHead[cj * SNX + ci] = t;
  };
  /** Spaced: true when the tree may stand (and its crown is kept); species not spaced always may. */
  const spaced = (sp: number, x: number, y: number, z: number, h: number, wd: number, cell: number): boolean => {
    const n = crownOf(cProf, 0, sp, y, h, wd, cell);
    if (n === 0) return true;
    let R = 0;
    for (let i = 0; i < n; i++) R = Math.max(R, cProf[2 * i + 1]);
    if (crowded(x, z, n, R)) return false;
    keepCrown(x, z, n, R);
    return true;
  };
  /** A tree spot's own chances for the wave 3 rules (never the deal's stream). */
  const spotHash = (x: number, z: number, s: number) => hash2(Math.floor(x * 4), Math.floor(z * 4), 900 + s);
  const cellFor = (sp: number, u: number) => {
    const cs = CELLS[sp];
    return cs.length ? cs[Math.floor(u * cs.length) % cs.length] : 0;
  };
  let nCrowded = 0;
  let nWet = 0;
  let nLodgeSwap = 0;
  let nGroveSwap = 0;
  let nHaloSwap = 0;

  for (let c = 0; c < cand.length; c += CS) {
    // DEAL_SYNC: from this row on, the stream is where 1dc7e10's stood.
    if (c === syncAt) rand = mulberry32After(7, DEAL_SYNC.draws);
    const x = cand[c];
    const z = cand[c + 1];
    const g = cand[c + 2];
    const w = cand[c + 3];
    const clump = cand[c + 4];
    const zi = cand[c + 5];
    const capH = cand[c + 6];
    const isLedge = cand[c + 7];
    const mg = cand[c + 8];
    const Z = zi >= 0 ? ZONES[zi] : BACKDROP;
    if (rand() > Math.min(1, w * K)) continue;
    // The field with its halo (wave 3), for the trees dealt.
    const mgN = x >= mx0 && x <= mx1 && z >= mz0 && z <= mz1 ? magicAt(x, z) : mg;
    let sp: number;
    // Wave 3 reads these: the species before the grove made it an aspen, and the grove.
    let spPre = -1;
    let grove = -1;
    if (isLedge) sp = FIR;
    else {
      const edge = 1 - smooth(0.45, 0.62, clump);
      const r = rand();
      const mx = Z.mix;
      if (rand() < edge * 0.3) sp = YNG;
      else if (r < mx[0]) sp = SPR;
      else if (r < mx[0] + mx[1]) sp = LDG;
      else if (r < mx[0] + mx[1] + mx[2]) sp = FIR;
      else if (r < mx[0] + mx[1] + mx[2] + mx[3]) sp = YNG;
      else if (r < mx[0] + mx[1] + mx[2] + mx[3] + mx[4]) sp = SNAG;
      else sp = SPR;
      // Aspens stand in groves of 15 to 40, never one by one (2.1).
      if (Z.aspen && g < 760 && sp !== SNAG) {
        grove = fbm(x / 170 + 31.7, z / 170 - 12.3, 41);
        spPre = sp;
        if (grove > 0.69) sp = rand() < 0.88 ? ASP : sp;
      }
      // About 1 spruce in 12 is dying (rust brown, never the landmark's red).
      if (sp === SPR && rand() < 0.08) sp = DYING;
    }
    // The magic field (1.15): teal tips from 0.25, willows from 0.5.
    if (mg > 0.25 && sp !== ASP) {
      if (mg > 0.5 && rand() < 0.45 * smooth(0.5, 0.75, mg)) sp = M2;
      else if (rand() < smooth(0.22, 0.5, mg)) sp = sp === SNAG ? SNAG : TEALS;
    }
    const core = 0.6 + 0.4 * smooth(0.42, 0.72, clump);
    const [h0, h1] = H_RANGE[sp];
    const hr0 = rand();
    const hr1 = rand();
    let h = (h0 + (h1 - h0) * hr0) * core * (0.9 + 0.2 * hr1);
    let pocketMul = 1;
    for (const pk of pockets) {
      const d = hyp(x - pk.x, z - pk.z);
      if (d > 150 && d < 420) {
        h *= 1.1;
        pocketMul *= 1.1;
      }
    }
    if (zi === 4 && hyp(x - a5cam[0], z - a5cam[2]) > 950) {
      h *= 0.75;
      pocketMul *= 0.75;
    }
    if (h > capH) {
      if (capH < h0 * 0.7) {
        if (capH < H_RANGE[SHR][0]) continue;
        sp = SHR;
        h = Math.min(capH, H_RANGE[SHR][0] + rand() * 4);
      } else h = Math.max(4, capH);
    }
    const width = 0.88 + 0.24 * rand();
    const yaw = rand() * Math.PI * 2;
    const leanAx = rand() * Math.PI * 2;
    const lean = sp === SHR ? 0 : rand() * 0.06;
    const tint = Math.floor(rand() * TINTS.length);
    const cell = pickCell(sp);
    if (sp !== SHR) dealt.push(x, z, h, width);

    // ── Wave 3: the rules, after the deal ──
    let spF = sp;
    if (sp !== SHR && !isLedge) {
      // Aspen groves of aspens alone, fewer and smaller; none in the magic.
      const inGrove = grove > ASPEN_GROVE && mgN <= 0.25;
      if (sp === ASP && !inGrove) spF = spPre;
      else if (inGrove && sp !== SNAG && sp !== ASP && sp !== M2 && sp !== TEALS) spF = ASP;
      // Fewer lodgepole pines, none near the walk.
      if (spF === LDG) {
        const keepShare = LODGE_KEEP_NEAR + (LODGE_KEEP_FAR - LODGE_KEEP_NEAR) * smooth(LODGE_NEAR, LODGE_FAR, railD.get(x, z, 3500));
        if (spotHash(x, z, 1) >= keepShare) spF = spotHash(x, z, 2) < 0.75 ? SPR : FIR;
      }
      // The halo (and an aspen the grove gave back inside the magic): the
      // magic's own rules at the field with its halo, on the spot's chances.
      if ((mgN > mg + 1e-6 || (sp === ASP && spF !== ASP)) && mgN > 0.25 && spF !== M2 && spF !== TEALS && spF !== ASP) {
        if (mgN > 0.5 && spotHash(x, z, 3) < 0.45 * smooth(0.5, 0.75, mgN)) spF = M2;
        else if (spotHash(x, z, 4) < smooth(0.22, 0.5, mgN)) spF = spF === SNAG ? SNAG : TEALS;
      }
    }
    let hF = h;
    let cellF = cell;
    if (spF !== sp) {
      // The new species' size from the same draws; where the camera's clearance
      // would make it a shrub, the tree stays as dealt.
      const [a0, a1] = H_RANGE[spF];
      let hn = (a0 + (a1 - a0) * hr0) * core * (0.9 + 0.2 * hr1) * pocketMul;
      if (hn > capH) hn = capH < a0 * 0.7 ? -1 : Math.max(4, capH);
      if (hn < 0) spF = sp;
      else {
        hF = hn;
        cellF = sp === LDG && spF === SPR ? 1 : cellFor(spF, spotHash(x, z, 5));
        if (spF === ASP || sp === ASP) nGroveSwap++;
        else if (sp === LDG) nLodgeSwap++;
        else nHaloSwap++;
      }
    }
    // The halo thins the wild trees toward the giants' ground as the core does.
    let keepTree = true;
    if (mgN > mg + 1e-6 && mgN > 0.55) {
      const f = (1 - 0.7 * smooth(0.55, MAGIC_GIANTS, mgN)) / (1 - 0.7 * smooth(0.55, MAGIC_GIANTS, mg));
      if (spotHash(x, z, 6) > f) keepTree = false;
    }
    // No trunk in the water as drawn (the glowing stream and its meander are not in brookD).
    if (keepTree && inWater(x, z, 2)) {
      keepTree = false;
      nWet++;
    }
    if (keepTree && !spaced(spF, x, g - 0.03 * hF, z, hF, width, cellF)) {
      keepTree = false;
      nCrowded++;
    }
    // A lodgepole made a spruce keeps a warm, light tint (TINTS 2 or 4), so the near forest keeps some of their light.
    const tintF = sp === LDG && spF === SPR ? (spotHash(x, z, 7) < 0.5 ? 2 : 4) : tint;
    if (keepTree) record(spF, x, g - 0.03 * hF, z, hF, width, yaw, leanAx, lean, tintF, cellF, Z.name);
    // Understory (v5 3.1.5): 2 to 4 shrubs round trees at a clump's edge
    // (dealt as before; kept round a tree that stands, and not round a willow or a snag).
    if (sp !== SNAG && sp !== M2 && clump < 0.56 && rand() < Z.shrub) {
      const shrubs = keepTree && spF !== M2 && spF !== SNAG;
      const n = 2 + Math.floor(rand() * 3);
      const cr = h * 0.2;
      for (let k = 0; k < n; k++) {
        const a = rand() * Math.PI * 2;
        const d = cr * (0.8 + 1.0 * rand());
        const sx = x + Math.cos(a) * d;
        const sz = z + Math.sin(a) * d;
        if (pathD.get(sx, sz, 999) < 14 || brookD.get(sx, sz, 999) < 16) continue;
        const sg = hAt(sx, sz);
        const sh = H_RANGE[SHR][0] + (H_RANGE[SHR][1] - H_RANGE[SHR][0]) * rand();
        if (sh > capH + g - sg) continue;
        const sw = 0.85 + 0.3 * rand();
        const syaw = rand() * Math.PI * 2;
        const sAx = rand() * Math.PI * 2;
        const sTint = Math.floor(rand() * TINTS.length);
        const sCell = pickCell(SHR);
        if (shrubs && !inWater(sx, sz, 1)) record(SHR, sx, sg - 0.08 * sh, sz, sh, sw, syaw, sAx, 0, sTint, sCell, Z.name);
      }
    }
  }
  // Fix 3 (k0, a1, a2: the far massifs read as smooth planes): forest on the
  // massifs' lower slopes, the steep band (normal y 0.46 to 0.72) the pass
  // above leaves bare, far from the route only (every one of these trees is
  // a mid or far card), thinning up into the rock by 780. Its own random
  // stream, appended after the wild forest, so no tree above moves.
  {
    const mr = mulberry32(53);
    const STEP = 30;
    let nMassif = 0;
    for (let z = ROI.minZ; z < ROI.maxZ; z += STEP) {
      for (let x = ROI.minX; x < ROI.maxX; x += STEP) {
        const jx = x + (mr() - 0.5) * STEP * 0.9;
        const jz = z + (mr() - 0.5) * STEP * 0.9;
        const pick = mr();
        // Cheap laptops (load): the tests are pure, so the cheapest run first
        // (the same cells pass). m below is at most 1, so pick > 0.85 never
        // passes, and the grid lookups reject most cells before the heights.
        if (pick > 0.85) continue;
        if (railD.get(jx, jz, 3500) < 1400) continue;
        if (pathD.get(jx, jz, 999) < 40 || riverD.get(jx, jz, 999) < 80 || brookD.get(jx, jz, 999) < 60) continue;
        if (hyp(jx - lake.x, jz - lake.z) < lake.r + 80) continue;
        const g = hAt(jx, jz);
        if (g < 120 || g > 780) continue;
        if (magicAt(jx, jz, true) > 0.2 || inA5View(jx, jz)) continue;
        const ny = normalY(jx, jz);
        if (ny < 0.46 || ny >= 0.72) continue;
        const cl = fbm(jx / 260, jz / 260, 41);
        const m = smooth(0.4, 0.52, cl) * (1 - smooth(560, 780, g)) * smooth(0.46, 0.56, ny);
        if (pick > m * 0.85) continue;
        const capH = maxTreeH(jx, jz, g);
        const r = mr();
        let sp = r < 0.58 ? SPR : r < 0.9 ? FIR : YNG;
        const [h0, h1] = H_RANGE[sp];
        const h = Math.min(capH, h0 + (h1 - h0) * mr());
        if (h < h0 * 0.7) continue;
        const cs = CELLS[sp];
        const wd = 0.88 + 0.24 * mr();
        const yaw = mr() * Math.PI * 2;
        const leanAx = mr() * Math.PI * 2;
        const lean = mr() * 0.06;
        const tint = Math.floor(mr() * TINTS.length);
        let cell = cs[Math.floor(mr() * cs.length) % cs.length];
        dealt.push(jx, jz, h, wd);
        // Wave 3: teal tips where the halo reaches these slopes; spaced.
        const mgN = jx >= mx0 && jx <= mx1 && jz >= mz0 && jz <= mz1 ? magicAt(jx, jz) : 0;
        if (mgN > 0.25 && spotHash(jx, jz, 4) < smooth(0.22, 0.5, mgN)) {
          sp = TEALS;
          cell = cellFor(TEALS, 0);
        }
        if (inWater(jx, jz, 2)) {
          nWet++;
          continue;
        }
        if (!spaced(sp, jx, g - 0.03 * h, jz, h, wd, cell)) {
          nCrowded++;
          continue;
        }
        recs.push(sp, jx, g - 0.03 * h, jz, h, wd, yaw, leanAx, lean, tint, cell);
        counts[sp]++;
        nMassif++;
      }
    }
    zoneCounts.MS = nMassif;
  }
  const nWild = recs.length / REC;
  lap("wild");
  await yieldTask();

  // The magic understory, by the field: glow ferns from 0.3, glowcaps from 0.5, willows 0.5 to 0.9.
  // Dealt as before over the field's core (fx0..fz1, from the samples above).
  // Wave 3: a willow that would grow into a tree or a giant, or stand in the
  // water, is left out; it still counts as placed, so the glowcaps and ferns
  // after it stay where they were (a glowcap or a fern in the water is left
  // out the same way). Then, from streams of their own: those willows again,
  // in the core where they were dealt, as many as find room (review round 2:
  // planted in the halo's ring, they made its outer edge the brightest teal
  // in the lake's views), and the halo's own willows, glowcaps and ferns,
  // where it outruns the core, at HALO_UNDERSTORY of the core's density.
  const mrand = mulberry32(31);
  const cl = Fo.clearing;
  let nWillowCrowded = 0;
  /**
   * u: the halo's pick list (0 willows, 1 glowcaps, 2 ferns), -1 for the
   * core as dealt before, or -2 for the core again (only what stands counts
   * toward n). The halo's glowcaps and ferns grow in patches of 3 to 6 round
   * a picked spot (scattered one by one at its lower density they read as
   * dots on bare ground).
   */
  const placeMagic = (sp: number, n: number, lo: number, hi: number, tries: number, R: () => number, u: number) => {
    let made = 0;
    let left = 0;
    let px = 0;
    let pz = 0;
    for (let t = 0; t < tries && made < n; t++) {
      let x: number;
      let z: number;
      let mg: number;
      if (u < 0) {
        // Again (-2): from the core's lattice by its willow weight, kept at
        // the field's share of that weight, so the willows spread as the first
        // pass's do and few tries go where none may stand.
        if (u === -1) {
          x = fx0 + (fx1 - fx0) * R();
          z = fz0 + (fz1 - fz0) * R();
        } else [x, z] = haloPick(3, R);
        mg = magicAt(x, z, true);
        if (R() * (u === -1 ? 1 : pickW) > smooth(lo, hi, mg)) continue;
      } else {
        if (u === 0) [x, z] = haloPick(u, R);
        else {
          if (left <= 0) {
            [px, pz] = haloPick(u, R);
            left = 3 + Math.floor(R() * 4);
          }
          left--;
          const a = R() * Math.PI * 2;
          const d = (sp === M3 ? 7 : 12) * Math.sqrt(R());
          x = px + Math.cos(a) * d;
          z = pz + Math.sin(a) * d;
        }
        mg = magicAt(x, z);
        // Still what the halo adds here (the spot moved off its lattice point).
        if (u === 0 ? mg < 0.48 || mg > 0.88 : smooth(lo, hi, mg) <= smooth(lo, hi, magicAt(x, z, true))) continue;
      }
      if (sp === M2 && mg > 0.93) continue;
      if (hyp(x - cl.x, z - cl.z) < cl.r * 0.55) continue;
      if (hyp(x - lake.x, z - lake.z) < lake.r + 10) continue;
      if (!keepClear(x, z, sp === M2 ? 22 : 4)) continue;
      if (pathD.get(x, z, 999) < (sp === M2 ? 20 : 5)) continue;
      const g = hAt(x, z);
      const [h0, h1] = H_RANGE[sp];
      const h = h0 + (h1 - h0) * R();
      if (camMinY.get(x, z, 1e9) - CAM_GAP - g < h) continue;
      // C3 round 2 (judge 2, fix 6): half the ferns in the a6 frame's lower 40%.
      if (sp === M4 && hyp(x - A6_CAM[0], z - A6_CAM[2]) < A6_FERN_THIN && hash2(Math.floor(x * 4), Math.floor(z * 4), 97) < 0.5) continue;
      const wd = 0.85 + 0.3 * R();
      const yaw = R() * Math.PI * 2;
      const leanAx = R() * Math.PI * 2;
      const lean = R() * 0.05;
      const tint = Math.floor(R() * 3);
      if (u === -1) made++;
      if (u === -1 && sp === M2) dealt.push(x, z, h, wd);
      if (inWater(x, z, sp === M2 ? 2 : 1)) {
        if (u === -1 && sp === M2) nWillowCrowded++;
        nWet++;
        continue;
      }
      if (!spaced(sp, x, g - 0.03 * h, z, h, wd, 0)) {
        if (u === -1) nWillowCrowded++;
        continue;
      }
      if (u !== -1) made++;
      recs.push(sp, x, g - 0.03 * h, z, h, wd, yaw, leanAx, lean, tint, 0);
      counts[sp]++;
    }
  };
  if (fx1 > fx0) {
    placeMagic(M2, WILLOWS, 0.5, 0.8, WILLOWS * 30, mrand, -1);
    placeMagic(M3, GLOWCAPS, 0.45, 0.85, GLOWCAPS * 12, mrand, -1);
    placeMagic(M4, GLOWFERNS, 0.28, 0.7, GLOWFERNS * 10, mrand, -1);
  }
  const coreMade = counts[M2];
  if (pickSum[3] > 0 && nWillowCrowded > 0) placeMagic(M2, nWillowCrowded, 0.5, 0.8, nWillowCrowded * 60, mulberry32(97), -2);
  const willowsAgain = counts[M2] - coreMade;
  const haloMade = [counts[M2], counts[M3], counts[M4]];
  const nW = Math.round(WILLOWS * haloShare(0));
  const nC = Math.round(GLOWCAPS * haloShare(1));
  const nF = Math.round(GLOWFERNS * haloShare(2));
  if (pickSum[0] > 0) placeMagic(M2, nW, 0.5, 0.8, nW * 30, mulberry32(89), 0);
  const hrand = mulberry32(83);
  if (pickSum[1] > 0) placeMagic(M3, nC, 0.45, 0.85, nC * 6, hrand, 1);
  if (pickSum[2] > 0) placeMagic(M4, nF, 0.28, 0.7, nF * 6, hrand, 2);
  const haloAdded = [counts[M2] - haloMade[0], counts[M3] - haloMade[1], counts[M4] - haloMade[2]];
  lap("magic");
  await yieldTask();

  // ── Materials ──
  const atlas = getFoliageAtlas(ctx.renderer);
  const rectArr = foliageCellRects();
  const rectU: THREE.Vector4[] = [];
  for (let i = 0; i < 16; i++) rectU.push(new THREE.Vector4(rectArr[i * 4], rectArr[i * 4 + 1], rectArr[i * 4 + 2], rectArr[i * 4 + 3]));
  lap("atlas");
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
  const cardU: CardUniforms = {
    uCellRect: { value: rectU },
    uCut: { value: new THREE.Vector4(CUT_NEAR, CUT_FAR, CUT_FROM, CUT_TO) },
    uFlutter: { value: ctx.reducedMotion ? 0 : FLUTTER },
    uGlowGain: { value: GLOW_GAIN },
    uPuff: { value: new THREE.Vector3(PUFF, PUFF_FROM, PUFF_TO) },
  };
  const msaa = !!ctx.renderer.getContext().getContextAttributes()?.antialias;
  const makeCardMat = (name: string, far: boolean) => {
    const mat = new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5, alphaToCoverage: msaa, side: THREE.DoubleSide });
    mat.name = name;
    chainCompileHook(mat, "card", cardHook(shared, cardU, far));
    return mat;
  };
  const makeGeoMat = (name: string, key: string, magic: boolean) => {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.name = name;
    chainCompileHook(mat, key, foliageHook(shared, { value: new THREE.Vector2(1e9, 1e9 + 1) }, magic));
    return mat;
  };
  const matCard = makeCardMat("ForestCards", false);
  const matFar = makeCardMat("ForestCardsFar", true);
  const matCore = makeGeoMat("ForestCore", "core", false);
  const matMagic = makeGeoMat("ForestMagicKit", "core", true);

  // ── Meshes: one per level ──
  const group = new THREE.Group();
  group.name = "Forest";
  const N = recs.length / REC;
  const slots: Slot[] = [];
  const addSlot = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, tris: number, withCell: boolean, order: number) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cap));
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    let cell: Float32Array | null = null;
    if (withCell) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap)), 1);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("aCell", a);
      cell = a.array as Float32Array;
    }
    mesh.count = 0;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = order;
    group.add(mesh);
    slots.push({ mesh, mat: mesh.instanceMatrix.array as Float32Array, col: mesh.instanceColor.array as Float32Array, cell, cap: Math.max(1, cap), count: 0, tris });
    return slots.length - 1;
  };
  const coreSoup = coreCone();
  const snagSoup = snag();
  const nCardTrees = nWild;
  // The near cards are named Forest:* so scene.indexTrees finds them (install fills them with every tree once).
  const S_CORE = addSlot("ForestCore", coreSoup.geometry(), matCore, nCardTrees, coreSoup.triangles, false, -6);
  const S_SNAG = addSlot("ForestSnag", snagSoup.geometry(), matCore, counts[SNAG], snagSoup.triangles, false, -6);
  const S_NEAR = addSlot("Forest:Trees", cards(3, 0.3), matCard, nCardTrees, 6, true, -5);
  const S_MID = addSlot("ForestMid", cards(2, 0.3 + Math.PI / 4), matCard, nCardTrees, 4, true, -4);
  const S_FAR = addSlot("ForestFar", cards(1, 0), matFar, nCardTrees, 2, true, -3);
  const magicSlots: Record<number, number[]> = {};
  const geoms: Array<[number, Soup[]]> = [
    [M2, [willow(0), willow(1), willow(2)]],
    [M3, [glowcaps(0), glowcaps(1)]],
    [M4, [glowFern(0), glowFern(1)]],
  ];
  for (const [sp, soups] of geoms) {
    // Final pass C (a6 overdraw): the understory (willows, glowcaps, ferns) is
    // drawn before the tree cores and cards (-6 to -3): it stands in front of
    // them along the forest floor, so the cards behind it fail the depth test.
    magicSlots[sp] = soups.map((sp0, l) => addSlot(`ForestMagic:${SPECIES_NAME[sp]}:${l}`, sp0.geometry(true), matMagic, counts[sp], sp0.triangles, false, -6.2));
  }

  // ── Per-tree arrays, sorted into culling cells ──
  const cnx = Math.ceil((ROI.maxX - ROI.minX) / CULL_CELL);
  const cnz = Math.ceil((ROI.maxZ - ROI.minZ) / CULL_CELL);
  const cellOfTree = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const x = recs[i * REC + 1];
    const z = recs[i * REC + 3];
    const ci = Math.min(cnx - 1, Math.max(0, Math.floor((x - ROI.minX) / CULL_CELL)));
    const cj = Math.min(cnz - 1, Math.max(0, Math.floor((z - ROI.minZ) / CULL_CELL)));
    cellOfTree[i] = cj * cnx + ci;
  }
  // By cell, each cell's trees in their dealt order: the order a stable sort
  // gives, as a counting sort (load, review round 2: 4 ms to 0.3).
  const byCell = new Int32Array(cnx * cnz + 1);
  for (let i = 0; i < N; i++) byCell[cellOfTree[i] + 1]++;
  for (let c = 1; c <= cnx * cnz; c++) byCell[c] += byCell[c - 1];
  const order = new Int32Array(N);
  for (let i = 0; i < N; i++) order[byCell[cellOfTree[i]]++] = i;
  const MAT = new Float32Array(N * 16);
  const CMAT = new Float32Array(N * 16);
  const COL = new Float32Array(N * 3);
  const CCOL = new Float32Array(N * 3);
  const CELLV = new Float32Array(N);
  const SPH = new Float32Array(N * 4);
  const SP = new Uint8Array(N);
  const LODS = new Uint8Array(N);
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
  const coreCol = CORE_COL.map((h) => (h ? C(h) : null));
  const cellKeep = foliageCellKeep();
  let curCell = -1;
  let bx0 = 0, bx1 = 0, by0 = 0, by1 = 0, bz0 = 0, bz1 = 0;
  const closeCell = () => {
    if (curCell < 0) return;
    cellSph.push((bx0 + bx1) / 2, (by0 + by1) / 2, (bz0 + bz1) / 2, hyp(bx1 - bx0, by1 - by0, bz1 - bz0) / 2 + 5);
  };
  for (let o = 0; o < N; o++) {
    const i = order[o];
    const r = i * REC;
    const sp = recs[r];
    const x = recs[r + 1];
    const y = recs[r + 2];
    const z = recs[r + 3];
    const h = recs[r + 4];
    const w = recs[r + 5];
    qLean.setFromAxisAngle(axis.set(Math.cos(recs[r + 7]), 0, Math.sin(recs[r + 7])), recs[r + 8]);
    q.setFromAxisAngle(UPV, recs[r + 6]).premultiply(qLean);
    // Round 1: the cell's crop is tight now; the card scales by its keep so the painted tree stays the size it was (foliage-atlas foliageCellKeep).
    const kc = sp < M2 ? cellKeep[recs[r + 10]] : 1;
    m4.compose(p3.set(x, y, z), q, s3.set(h * w * kc, h * kc, h * w * kc));
    MAT.set(m4.elements, o * 16);
    const cr = CORE_R[sp];
    if (cr > 0) {
      m4.compose(p3, q, s3.set(h * w * cr, h, h * w * cr));
      CMAT.set(m4.elements, o * 16);
    }
    const t = TINTS[recs[r + 9] % TINTS.length];
    COL[o * 3] = t[0];
    COL[o * 3 + 1] = t[1];
    COL[o * 3 + 2] = t[2];
    const cc = coreCol[sp];
    if (cc) {
      CCOL[o * 3] = cc.r * t[0];
      CCOL[o * 3 + 1] = cc.g * t[1];
      CCOL[o * 3 + 2] = cc.b * t[2];
    }
    CELLV[o] = recs[r + 10];
    SPH[o * 4] = x;
    SPH[o * 4 + 1] = y + h * 0.5;
    SPH[o * 4 + 2] = z;
    SPH[o * 4 + 3] = h * (sp === SHR ? 1.0 : 0.6);
    SP[o] = sp;
    LODS[o] = 0;
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

  // Install fill: every card tree into the near mesh, so the scene's tree index (run once after install) sees them all.
  {
    const s = slots[S_NEAR];
    s.count = 0;
    for (let o = 0; o < N; o++) {
      if (SP[o] >= M2) continue;
      s.mat.set(MAT.subarray(o * 16, o * 16 + 16), s.count * 16);
      s.col.set(COL.subarray(o * 3, o * 3 + 3), s.count * 3);
      s.cell![s.count] = CELLV[o];
      s.count++;
    }
    s.mesh.count = s.count;
    s.mesh.instanceMatrix.needsUpdate = true;
    s.mesh.instanceColor!.needsUpdate = true;
    (s.mesh.geometry.getAttribute("aCell") as THREE.InstancedBufferAttribute).needsUpdate = true;
    for (const o of slots) o.mesh.visible = o.count > 0;
  }
  ctx.root.add(group);
  group.updateMatrixWorld(true);

  // The shade and density maps bake in the next task, off the install path.
  let maps: ForestMaps | null = null;
  let mapsMs = -1;
  let disposed = false;
  setTimeout(() => {
    if (disposed) return;
    const t0 = performance.now();
    maps = bakeMaps(recs, REC, (x, z) => railD.get(x, z, 9999) < 2600, dealt);
    dealt.length = 0;
    ctx.scene.userData.forestMaps = maps;
    const surf = ctx.scene.userData.surfaces as SurfacesApi | undefined;
    if (surf) {
      const m = maps;
      surf.setShadeTexture(m.shade, { minX: m.origin[0], minZ: m.origin[1], maxX: m.origin[0] + m.size, maxZ: m.origin[1] + m.size });
      surf.setForestMask(densitySampler(m));
    }
    mapsMs = Math.round(performance.now() - t0);
  }, 0);

  // light.ts levels glow materials by userData.lightGlow; this probe reads its magic level back each frame.
  // Cheap laptops (load): a plain Object3D carrying the material, not a Mesh, so
  // the warm compile (which shows every hidden mesh) builds no program for it;
  // light.ts's walk reads any object's .material.
  const probeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  probeMat.userData.lightGlow = "magic";
  const probe = new THREE.Object3D() as THREE.Object3D & { material: THREE.MeshBasicMaterial };
  probe.material = probeMat;
  probe.name = "ForestMagicProbe";
  probe.visible = false;
  group.add(probe);
  lap("meshes");

  // ── Quality (3.2) ──
  let tier: QualityTier = ctx.quality;
  let nearD = NEAR_D * tier.treeDistance;
  let midD = MID_D * tier.treeDistance;
  const applyTier = (t: QualityTier) => {
    tier = t;
    nearD = NEAR_D * t.treeDistance;
    midD = MID_D * t.treeDistance;
  };
  applyTier(tier);

  // ── The frame loop: compaction ──
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const lastCam = new Float32Array(32).fill(NaN);
  const camPos = new THREE.Vector3();
  let firstFrame = true;
  let lastCompactMs = 0;
  let visibleTrees = 0;
  let nearTrees = 0;
  const lodCounts = [0, 0, 0];
  const planes = new Float32Array(24);
  const visCells = new Int32Array(Math.max(1, NC));
  const visDist = new Float32Array(Math.max(1, NC));

  const put = (si: number, o: number, core: boolean) => {
    const s = slots[si];
    const n = s.count;
    if (n >= s.cap) return;
    s.mat.set((core ? CMAT : MAT).subarray(o * 16, o * 16 + 16), n * 16);
    const cs = core ? CCOL : COL;
    s.col[n * 3] = cs[o * 3];
    s.col[n * 3 + 1] = cs[o * 3 + 1];
    s.col[n * 3 + 2] = cs[o * 3 + 2];
    if (s.cell) s.cell[n] = CELLV[o];
    s.count = n + 1;
  };

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
    // Visible cells, nearest first, so the near cards draw front to back (hidden layers fail the depth test).
    let nv = 0;
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
      visCells[nv] = c;
      visDist[nv] = dc;
      nv++;
    }
    // Insertion sort by distance (a few hundred cells, mostly ordered frame to frame).
    for (let a = 1; a < nv; a++) {
      const c = visCells[a];
      const d = visDist[a];
      let b = a - 1;
      while (b >= 0 && visDist[b] > d) {
        visCells[b + 1] = visCells[b];
        visDist[b + 1] = visDist[b];
        b--;
      }
      visCells[b + 1] = c;
      visDist[b + 1] = d;
    }
    const nCards = tier.nearTreeCards;
    const coreOnlyR = tier.nearCoreOnlyR;
    for (let vi = 0; vi < nv; vi++) {
      const c = visCells[vi];
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
        const prev = LODS[o];
        if (sp >= M2) {
          const ld = MAGIC_LOD[sp];
          const t1 = ld[0] * (prev >= 1 ? 1 - HYST : 1 + HYST);
          const t2 = ld[1] * (prev >= 2 ? 1 - HYST : 1 + HYST);
          const lod = d < t1 ? 0 : d < t2 ? 1 : 2;
          LODS[o] = lod;
          if (lod > ld[2]) continue;
          put(magicSlots[sp][lod], o, false);
          visibleTrees++;
          lodCounts[lod]++;
          continue;
        }
        const t1 = nearD * (prev >= 1 ? 1 - HYST : 1 + HYST);
        const t2 = midD * (prev >= 2 ? 1 - HYST : 1 + HYST);
        const lod = d < t1 ? 0 : d < t2 ? 1 : 2;
        LODS[o] = lod;
        visibleTrees++;
        lodCounts[lod]++;
        if (d < SWAY_R) nearTrees++;
        if (lod === 0) {
          if (sp === SNAG) {
            put(S_SNAG, o, false);
            continue;
          }
          const hasCore = CORE_R[sp] > 0;
          if (hasCore) put(S_CORE, o, true);
          if (coreOnlyR > 0 && d < coreOnlyR && hasCore) continue;
          put(sp === SHR || nCards < 3 ? S_MID : S_NEAR, o, false);
        } else if (lod === 1) put(S_MID, o, false);
        else put(S_FAR, o, false);
      }
    }
    for (const s of slots) {
      const m = s.mesh;
      m.count = s.count;
      m.visible = s.count > 0;
      if (s.count > 0) {
        const im = m.instanceMatrix;
        im.clearUpdateRanges();
        im.addUpdateRange(0, s.count * 16);
        im.needsUpdate = true;
        const ic = m.instanceColor!;
        ic.clearUpdateRanges();
        ic.addUpdateRange(0, s.count * 3);
        ic.needsUpdate = true;
        if (s.cell) {
          const ca = m.geometry.getAttribute("aCell") as THREE.InstancedBufferAttribute;
          ca.clearUpdateRanges();
          ca.addUpdateRange(0, s.count);
          ca.needsUpdate = true;
        }
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
      let changed = false;
      if (firstFrame || camChanged()) {
        firstFrame = false;
        compact();
        changed = true;
      }
      return changed || (!ctx.reducedMotion && visibleTrees > 0);
    },
    isAnimating() {
      return !ctx.reducedMotion && visibleTrees > 0;
    },
    setQuality(t: QualityTier) {
      applyTier(t);
      firstFrame = true;
    },
    dispose() {
      ctx.root.remove(group);
      for (const s of slots) {
        s.mesh.geometry.dispose();
        s.mesh.dispose();
      }
      for (const m of [matCard, matFar, matCore, matMagic, probeMat]) m.dispose();
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
        wild: nWild,
        // Wave 3: trees left out for crowding (willows apart), species swapped, the halo's understory.
        crowded: nCrowded,
        willowsCrowded: nWillowCrowded,
        inWater: nWet,
        lodgeSwap: nLodgeSwap,
        groveSwap: nGroveSwap,
        haloSwap: nHaloSwap,
        haloUnderstory: JSON.stringify(haloAdded),
        willowsAgain,
        // Today's weight sum (K_SUM holds 1dc7e10's).
        wSum,
        giantSpots: giants.length,
        buildMs: times.total,
        build: JSON.stringify(times),
        mapsMs,
        compactMs: Math.round(lastCompactMs * 100) / 100,
        visible: visibleTrees,
        lod0: lodCounts[0],
        lod1: lodCounts[1],
        lod2: lodCounts[2],
        near: nearTrees,
        triangles: drawnTris(),
        calls: drawnCalls(),
        instances: slots.reduce((s, sl) => s + (sl.mesh.visible ? sl.count : 0), 0),
        cells: NC,
        slots: JSON.stringify(Object.fromEntries(slots.map((s) => [s.mesh.name, s.mesh.visible ? s.count : 0]))),
        zones: JSON.stringify(zoneCounts),
        atlas: JSON.stringify(foliageAtlasStats()),
        tier: tier.tier,
        msaa: msaa ? 1 : 0,
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

function bakeMaps(recs: number[], REC: number, casts: (x: number, z: number) => boolean, dealt: number[]): ForestMaps {
  const size = Math.max(ROI.maxX - ROI.minX, ROI.maxZ - ROI.minZ);
  const ox = ROI.minX;
  const oz = ROI.minZ;
  const SN = 1024;
  const DN = 512;
  const shade = new Uint8Array(SN * SN);
  const dens = new Float32Array(DN * DN);
  const sT = size / SN;
  const dT = size / DN;
  // Density: a soft disc per tree as dealt (wave 3: [x, z, h, w], in the deal's
  // order, the trees its rules left out or changed as they were dealt), so the
  // forest floor's paint and the grass that reads it stay as they were.
  for (let r = 0; r < dealt.length; r += 4) {
    const x = dealt[r];
    const z = dealt[r + 1];
    const cr = Math.max(4, dealt[r + 2] * 0.2 * dealt[r + 3]);
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
  // Shade: the trees that stand.
  for (let r = 0; r < recs.length; r += REC) {
    const sp = recs[r];
    if (sp === SHR || sp === M3 || sp === M4) continue;
    const x = recs[r + 1];
    const z = recs[r + 3];
    const h = recs[r + 4];
    const cr = Math.max(4, h * 0.2 * recs[r + 5]);
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

