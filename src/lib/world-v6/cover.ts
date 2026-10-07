import * as THREE from "three";
import { GATE, PLACES, STREAM, TRAIL, TRAIL_FOV, TRAIL_VIEW, WORLD, magicAt } from "./layout";
import { NO_REFLECT_LAYER } from "./light";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import type { QualityTier } from "./quality";
import { groundY, gridSlope, isWater, rnd, rockAnchors, smooth, trailDistFast as trailDist } from "./rocks";
import { all as allFootprints, blocked } from "./footprints";
import { gateIsleTop } from "./dress-gate";
import { GRASS_ATLAS_SIZE, getGrassAtlas, grassAtlasStats, grassCell, type GrassCell, type GrassKind } from "./grass-atlas";
import { chainCompile, sandLineAt, type SurfacesApi } from "./surfaces";

/**
 * v6 ground cover (world_art_bible_v6.md 2.3; Lovro: the tufts were "ugly, no
 * shadows, go over each other", the same on sand and grass, grass inside the
 * tents, flowers "rectangles and triangles" up close).
 *
 *   Clumps    2 crossed cards (4 triangles) from the painted grass atlas
 *             (grass-atlas.ts): 8 to 24 blades, dark at the root, pale at the
 *             tip; tall dry grass, dune grass, reeds, short grass, ferns and
 *             flower drifts with painted heads. No geometry flowers.
 *   Drifts    never one clump alone: 6 to 30 clumps in a Poisson disc, 10 to
 *             40 across, tallest in the middle; the ground under each drift is
 *             darkened 20 to 30% (surfaces addGroundShade), so it reads planted.
 *   Kits      one per surface: the beach (dune grass across the torn sand edge
 *             only), the coast and meadows (tall dry grass, short grass, one
 *             colour flower drifts), Base Camp (green and gold, the flower
 *             meadow), the woods and the forest floor (ferns, no bright
 *             grass), the stream banks, the gorge (ferns on the floor and wet
 *             ledges), the ledge, the collar and the saddle, the lake shore
 *             (tall golden grass and reeds), the Sky Island (pale gold drifts
 *             on the rim, the centre open), the bounty isle, the Gate isle
 *             (green gold drifts, sea pinks at the cliff), a ring round every
 *             rock family. a6's glowing floor (moss, glow ferns, glowcaps) is
 *             kept as v5's geometry, now by magicAt.
 *   Near band where the camera stops low (the opening, a1, a2, the lip, the
 *             ledge, the island walk, a8): bigger drifts where the ground first
 *             enters the frame, 10 to 25% of the frame height.
 *   Colour    each clump's root is the ground's painted colour under it
 *             (surfaces.groundColorAt, drift shade included), darker; its tip
 *             the kit's; its heads the drift's. It reads the forest's tree
 *             shadow at its root in the vertex shader, as the ground does.
 *   Nothing inside a footprint (footprints.blocked, the trail's line plus 4
 *             included), nothing on water, nothing on steep ground; nothing
 *             drawn past 900 (the fade ends at 880 x the tier's coverFade).
 *
 * Everything scatters in afterAll, after every module has registered its
 * footprints. Instances sit in 200 unit cells; when the camera moves, the
 * nearest cells in view are copied into each layer's live buffer (v5's
 * compaction), up to the layer's cap, so the cards are ONE draw call. The
 * tier's coverDensity keeps that share of each cell (instances are shuffled
 * inside their cell, so any share is an even thinning).
 *
 * Shader: MeshLambertMaterial through chainCompile (light.ts's fog and grade
 * hook it like any other material), alphaToCoverage with three's fwidth
 * sharpening plus a mip scaled alpha (Golus), wind as v5 (tips move, roots
 * stay), normals up and not flipped on back faces, so a clump lights with the
 * ground under it.
 */

// ── Card clumps ──────────────────────────────────────────────────────────────

/** Two crossed quads, 0..1 up, 1 wide, roots at y 0: 8 vertices, 4 triangles. */
function cardGeometry(): THREE.BufferGeometry {
  const P = [
    [-0.5, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [-0.5, 1, 0],
    [0, 0, -0.5], [0, 0, 0.5], [0, 1, 0.5], [0, 1, -0.5],
  ];
  const UV = [
    [0, 0], [1, 0], [1, 1], [0, 1],
    [0, 0], [1, 0], [1, 1], [0, 1],
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P.flat(), 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(8).fill([0, 1, 0]).flat(), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(UV.flat(), 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  g.computeBoundingSphere();
  return g;
}

// ── a6's glowing floor, kept from v5 (geometry, glow material) ──────────────

type GlowId = "moss" | "gfern" | "gcap";

class Tri {
  pos: number[] = [];
  nor: number[] = [];
  t: number[] = [];
  head: number[] = [];
  v(x: number, y: number, z: number, t: number, head = 0, lean = 0.25) {
    this.pos.push(x, y, z);
    const l = Math.hypot(x, z) || 1;
    const nx = (x / l) * lean;
    const nz = (z / l) * lean;
    const n = Math.hypot(nx, 1, nz);
    this.nor.push(nx / n, 1 / n, nz / n);
    this.t.push(t);
    this.head.push(head);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(this.t, 1));
    g.setAttribute("aHead", new THREE.Float32BufferAttribute(this.head, 1));
    return g;
  }
}

function glowGeometry(id: GlowId): THREE.BufferGeometry {
  const g = new Tri();
  let k = 0;
  const r = () => rnd(k++, 901);
  if (id === "gfern") {
    // Fix 3: soft arching fronds (were 5 diamond shards whose outer half took
    // the full glow colour): 6 tapered strips that rise, arch and droop, dark
    // along their length, only the last segment glowing toward the tip.
    const U = [0, 0.3, 0.62, 1];
    const W = [0.035, 0.1, 0.075, 0];
    const HD = [0, 0, 0.2, 0.9];
    for (let f = 0; f < 6; f++) {
      const a = (f / 6) * Math.PI * 2 + r() * 0.6;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const len = 0.75 + r() * 0.3;
      const lift = 0.8 + r() * 0.4;
      const Y = [0.02, 0.36 * lift, 0.44 * lift, 0.2 * lift];
      const P = (k: number, side: number) => [ca * U[k] * len - sa * W[k] * side, Y[k], sa * U[k] * len + ca * W[k] * side, U[k]] as const;
      const vtx = (q: readonly number[], k: number) => g.v(q[0], q[1], q[2], q[3], HD[k], 0.4);
      for (let k = 0; k < 3; k++) {
        const l0 = P(k, -1);
        const r0 = P(k, 1);
        const l1 = P(k + 1, -1);
        const r1 = P(k + 1, 1);
        vtx(l0, k);
        vtx(r0, k);
        vtx(l1, k + 1);
        if (k < 2) {
          vtx(r0, k);
          vtx(r1, k + 1);
          vtx(l1, k + 1);
        }
      }
    }
  } else if (id === "gcap") {
    const caps: [number, number, number, number][] = [
      [0, 0, 1.0, 0.42],
      [0.42, 0.2, 0.62, 0.3],
      [-0.3, 0.36, 0.48, 0.24],
    ];
    for (const [cx, cz, h, cr] of caps) {
      const sw = cr * 0.22;
      for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * Math.PI * 2;
        const a1 = ((i + 1) / 3) * Math.PI * 2;
        g.v(cx + Math.cos(a0) * sw, 0, cz + Math.sin(a0) * sw, 0.2, 0, 0);
        g.v(cx + Math.cos(a1) * sw, 0, cz + Math.sin(a1) * sw, 0.2, 0, 0);
        g.v(cx + Math.cos(a0) * sw * 0.8, h * 0.9, cz + Math.sin(a0) * sw * 0.8, 0.6, 0.35, 0);
        g.v(cx + Math.cos(a1) * sw, 0, cz + Math.sin(a1) * sw, 0.2, 0, 0);
        g.v(cx + Math.cos(a1) * sw * 0.8, h * 0.9, cz + Math.sin(a1) * sw * 0.8, 0.6, 0.35, 0);
        g.v(cx + Math.cos(a0) * sw * 0.8, h * 0.9, cz + Math.sin(a0) * sw * 0.8, 0.6, 0.35, 0);
      }
      const rot = r() * 2;
      const rim: number[][] = [];
      for (let i = 0; i < 6; i++) {
        const a = rot + (i / 6) * Math.PI * 2;
        rim.push([cx + Math.cos(a) * cr, h * 0.86, cz + Math.sin(a) * cr]);
      }
      for (let i = 0; i < 6; i++) {
        const j = (i + 1) % 6;
        g.v(cx, h * 1.08, cz, 1, 0, 0.5);
        g.v(rim[j][0], rim[j][1], rim[j][2], 0.9, 0, 0.5);
        g.v(rim[i][0], rim[i][1], rim[i][2], 0.9, 0, 0.5);
        g.v(cx, h * 0.9, cz, 0.8, 0.7, 0);
        g.v(rim[i][0], rim[i][1] - 0.01, rim[i][2], 0.9, 1, 0);
        g.v(rim[j][0], rim[j][1] - 0.01, rim[j][2], 0.9, 1, 0);
      }
    }
  } else {
    const n = 5;
    const top = [0, 0.55, 0];
    const A: number[][] = [];
    const B: number[][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.3;
      A.push([Math.cos(a) * 0.72, 0.3, Math.sin(a) * 0.72]);
      B.push([Math.cos(a + 0.3) * 1.0, 0, Math.sin(a + 0.3) * 1.0]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      g.v(top[0], top[1], top[2], 1, 1);
      g.v(A[j][0], A[j][1], A[j][2], 0.7, 0.3);
      g.v(A[i][0], A[i][1], A[i][2], 0.7, 0.3);
      g.v(A[i][0], A[i][1], A[i][2], 0.7, 0.3);
      g.v(A[j][0], A[j][1], A[j][2], 0.7, 0.3);
      g.v(B[j][0], B[j][1], B[j][2], 0);
      g.v(A[i][0], A[i][1], A[i][2], 0.7, 0.3);
      g.v(B[j][0], B[j][1], B[j][2], 0);
      g.v(B[i][0], B[i][1], B[i][2], 0);
    }
  }
  const geo = g.geometry();
  geo.computeBoundingSphere();
  return geo;
}

// ── Colours (display sRGB; the root comes from the ground) ───────────────────

const sc = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const TIP = {
  dune: sc(0xdac993),
  coastTall: sc(0xdcb86c),
  coastShort: sc(0xc9ad66),
  meadowShort: sc(0xb2b562),
  meadowTall: sc(0xd2bb70),
  flowerLeaf: sc(0x9aa85a),
  fern: sc(0x7a9448),
  fernDark: sc(0x5a723c),
  gorgeFern: sc(0x86a04e),
  dryShort: sc(0xcbb070),
  collar: sc(0xd8b86e),
  lakeTall: sc(0xe0b46a),
  reed: sc(0x9a9258),
  a6fern: sc(0x2c4a42),
  a6cap: sc(0x4a3a66),
  // Final pass: warmer, so the island's drifts read pale gold by moonlight (0xdcd0a0 read white).
  isle: sc(0xd4b46e),
  gate: sc(0xbcc070),
};
/** The Sky Island's and the bounty isle's top under their drifts (dress-sky's gold top). */
const ISLE_ROOT = sc(0x8a7648);
/** Flower drifts: one colour each. Every hue 20 degrees or more from the lookout's red (#a8392c). */
const FLOWER = {
  orange: sc(0xec8a3c),
  cream: sc(0xf0e8cc),
  violet: sc(0x9c82d4),
  gold: sc(0xe8c55a),
  pink: sc(0xe49ab4),
};
const REED_HEAD = sc(0x4a3626);
const GLOW = [sc(0x3fd6c8), sc(0x7fe8ff), sc(0x3fd6c8), sc(0xa86cf0)];

// ── Placement records ────────────────────────────────────────────────────────

interface CardInst {
  x: number;
  y: number;
  z: number;
  h: number;
  w: number;
  yaw: number;
  cell: GrassCell;
  tip: THREE.Color;
  head: THREE.Color;
  /** Value variation, 0.86..1.1. */
  val: number;
  /** Extra root darkening (drift heart), 0..1. */
  deep: number;
}
interface GlowInst {
  kind: GlowId;
  x: number;
  y: number;
  z: number;
  s: number;
  tip: THREE.Color;
  head: THREE.Color;
}

/** A drift kit: which cells, their tip colour, heights, and the head colour where flowers. */
interface Kit {
  cells: GrassKind[];
  tip: THREE.Color;
  hMin: number;
  hMax: number;
  head?: THREE.Color;
  /** Reeds and flowers: the leaves' tip when a cell is not a flower cell. */
  leaf?: THREE.Color;
}

const CELL = 200;

/** 2D distance to the camera's route (the TRAIL keys as segments), on a 100 unit grid. */
function makeRailGrid() {
  const G = 100;
  const nx = Math.ceil((WORLD.maxX - WORLD.minX) / G) + 1;
  const nz = Math.ceil((WORLD.maxZ - WORLD.minZ) / G) + 1;
  // Fix 3 (load time): capped at CAP, each segment visits only the nodes within
  // CAP of it (was every node against every segment). railKeep reads nothing
  // past 1,100, and a 100 cell's nodes differ by at most 141, so a capped node
  // only ever sits in a cell whose value is past 1,259 either way: same output.
  const CAP = 1500;
  const d = new Float32Array(nx * nz).fill(CAP);
  for (let k = 0; k < TRAIL.length - 1; k++) {
    const a = TRAIL[k];
    const b = TRAIL[k + 1];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const L2 = dx * dx + dz * dz || 1;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - CAP - WORLD.minX) / G));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0]) + CAP - WORLD.minX) / G));
    const j0 = Math.max(0, Math.floor((Math.min(a[2], b[2]) - CAP - WORLD.minZ) / G));
    const j1 = Math.min(nz - 1, Math.ceil((Math.max(a[2], b[2]) + CAP - WORLD.minZ) / G));
    for (let j = j0; j <= j1; j++) {
      const z = WORLD.minZ + j * G;
      for (let i = i0; i <= i1; i++) {
        const x = WORLD.minX + i * G;
        const u = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[2]) * dz) / L2));
        const ex = x - a[0] - dx * u;
        const ez = z - a[2] - dz * u;
        const d2 = ex * ex + ez * ez;
        const kk = j * nx + i;
        if (d2 < d[kk] * d[kk]) d[kk] = Math.sqrt(d2);
      }
    }
  }
  return (x: number, z: number) => {
    const fi = (x - WORLD.minX) / G;
    const fj = (z - WORLD.minZ) / G;
    const i = Math.max(0, Math.min(nx - 2, Math.floor(fi)));
    const j = Math.max(0, Math.min(nz - 2, Math.floor(fj)));
    const u = Math.min(1, Math.max(0, fi - i));
    const v = Math.min(1, Math.max(0, fj - j));
    const k = j * nx + i;
    return (d[k] * (1 - u) + d[k + 1] * u) * (1 - v) + (d[k + nx] * (1 - u) + d[k + nx + 1] * u) * v;
  };
}

/** Low frequency clumping, 0..1 (v5). */
function clump(x: number, z: number): number {
  return 0.5 + 0.3 * Math.sin(x * 0.0131 + 1.7) * Math.cos(z * 0.0117 - 0.6) + 0.2 * Math.sin((x - z) * 0.029 + 4.1) * Math.sin(z * 0.021 + x * 0.004);
}

const DEG = Math.PI / 180;
/** The Sky Island's rim and top (blocks.ts and dress-sky.ts's shapes, followed exactly). */
function islandRim(theta: number): number {
  const r = WORLD.island.r;
  let d = theta / DEG - 133;
  d -= 360 * Math.round(d / 360);
  const cove = 100 * Math.exp(-((d / 14) ** 2));
  return r - 26 * (0.5 + 0.5 * Math.sin(3 * theta + 1.3)) - 12 * (0.5 + 0.5 * Math.sin(7 * theta + 0.4)) - cove;
}
const islandTopY = (x: number, z: number) => WORLD.island.y + 42 * Math.exp(-((x + 2410) ** 2 + (z + 1470) ** 2) / (150 * 150));

// ── The scatter ──────────────────────────────────────────────────────────────

interface ScatterOut {
  cards: CardInst[];
  glow: GlowInst[];
  drifts: Array<{ x: number; z: number; r: number; amount: number }>;
  rejectedByFootprints: number;
}

function scatter(ctx: WorldCtx, surf: SurfacesApi | undefined): ScatterOut {
  const cards: CardInst[] = [];
  const glow: GlowInst[] = [];
  const drifts: ScatterOut["drifts"] = [];
  let rejected = 0;
  const railD = makeRailGrid();
  let seq = 0;
  // Fix round 1 (install budget): the ground as the terrain mesh draws it,
  // read from its grids (a few array reads). rocks.ts groundY calls the
  // analytic terrainHeight for every point inside the falls patch, and
  // slopeAt four times more: together most of this pass's ~200 ms.
  const gY: (x: number, z: number) => number = surf ? surf.drawnHeight : groundY;
  const slopeD = (x: number, z: number, e: number) => Math.hypot(gY(x + e, z) - gY(x - e, z), gY(x, z + e) - gY(x, z - e)) / (2 * e);

  /** Solid ground for a clump: no footprint (trail + 4 included), no water, gentle. */
  const free = (x: number, z: number, g: number, maxSlope: number, pad = 1.5) => {
    if (isWater(x, z, g)) return false;
    if (gridSlope(x, z) > maxSlope) return false;
    if (blocked(x, z, pad)) {
      rejected++;
      return false;
    }
    return true;
  };

  /**
   * One drift: n clumps in a Poisson disc of radius R round (cx, cz), tallest
   * in the middle; `yAt` gives the ground (groundY unless floating). Returns
   * how many it placed. The ground under it darkens by `shade`.
   */
  const drift = (
    cx: number,
    cz: number,
    R: number,
    n: number,
    kit: Kit,
    opts: { maxSlope?: number; yAt?: (x: number, z: number) => number; shade?: number; accept?: (x: number, z: number, g: number) => boolean; near?: boolean } = {},
  ): number => {
    const yAt = opts.yAt ?? gY;
    const maxSlope = opts.maxSlope ?? 0.6;
    const minD = Math.max(1.6, (R * 1.5) / Math.sqrt(n + 1));
    const pts: Array<[number, number]> = [];
    const id = seq++;
    for (let a = 0; a < n * 4 && pts.length < n; a++) {
      const q = rnd(id * 131 + a, 301);
      const ang = rnd(id * 131 + a, 302) * Math.PI * 2;
      const d = R * Math.pow(q, 0.62);
      const x = cx + Math.cos(ang) * d * 1.2;
      const z = cz + Math.sin(ang) * d;
      let ok = true;
      for (const p of pts) {
        if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < minD * minD) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const g = yAt(x, z);
      if (opts.yAt ? blocked(x, z, 1.5) : !free(x, z, g, maxSlope)) continue;
      if (opts.accept && !opts.accept(x, z, g)) continue;
      pts.push([x, z]);
      const k = seq++;
      const rel = Math.min(1, d / R);
      const cellId = kit.cells[Math.floor(rnd(k, 303) * kit.cells.length)];
      const cell = grassCell(cellId);
      const isFlower = cellId.startsWith("flower");
      const isReed = cellId === "reeds";
      const h = (kit.hMin + (kit.hMax - kit.hMin) * (0.35 + 0.65 * rnd(k, 304))) * (1 - 0.42 * rel * rel);
      cards.push({
        x,
        y: g - 0.35,
        z,
        h,
        w: h * cell.aspect * (0.9 + 0.3 * rnd(k, 305)),
        yaw: rnd(k, 306) * Math.PI,
        cell,
        tip: isFlower && kit.leaf ? kit.leaf : kit.tip,
        head: isReed ? REED_HEAD : kit.head ?? kit.tip,
        val: 0.88 + 0.22 * rnd(k, 307),
        deep: 1 - rel,
      });
    }
    if (pts.length >= 3 && (opts.shade ?? 0.24) > 0) drifts.push({ x: cx, z: cz, r: R * 1.15, amount: opts.shade ?? 0.24 });
    return pts.length;
  };

  /** Jittered grid of drift centres over a box; fn decides each (r = a hash 0..1). */
  const centres = (x0: number, x1: number, z0: number, z1: number, step: number, seed: number, fn: (x: number, z: number, r: number) => void) => {
    let i = 0;
    for (let z = z0; z < z1; z += step) {
      for (let x = x0; x < x1; x += step) {
        i++;
        const jx = x + (rnd(i, seed) - 0.5) * step * 0.9;
        const jz = z + (rnd(i, seed + 1) - 0.5) * step * 0.9;
        fn(jx, jz, rnd(i, seed + 2));
      }
    }
  };
  const pick = <T,>(arr: readonly T[], r: number): T => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
  /** Share of open ground a drift centre is kept at, falling off from the rail. */
  const railKeep = (x: number, z: number, near = 350, far = 950) => 1 - smooth(near, far, railD(x, z));
  const forestAt = (x: number, z: number) => (surf ? surf.forestAt(x, z) : 0);

  const KITS = {
    dune: { cells: ["dune", "dune", "shortDry"], tip: TIP.dune, hMin: 7, hMax: 13 } as Kit,
    coastTall: { cells: ["tallDry", "tallDry2"], tip: TIP.coastTall, hMin: 8, hMax: 14 } as Kit,
    coastShort: { cells: ["short", "short2", "shortDry"], tip: TIP.coastShort, hMin: 4, hMax: 7 } as Kit,
    meadowShort: { cells: ["short", "short2"], tip: TIP.meadowShort, hMin: 4, hMax: 7 } as Kit,
    meadowTall: { cells: ["tallDry", "tallDry2"], tip: TIP.meadowTall, hMin: 8, hMax: 13 } as Kit,
    fern: { cells: ["fern", "fern2"], tip: TIP.fern, hMin: 5, hMax: 9 } as Kit,
    fernDark: { cells: ["fern", "fern2"], tip: TIP.fernDark, hMin: 5, hMax: 9 } as Kit,
    gorgeFern: { cells: ["fern", "fern2", "short2"], tip: TIP.gorgeFern, hMin: 5, hMax: 10 } as Kit,
    dryShort: { cells: ["shortDry", "short"], tip: TIP.dryShort, hMin: 4, hMax: 7 } as Kit,
    collar: { cells: ["tallDry", "tallDry2", "shortDry"], tip: TIP.collar, hMin: 7, hMax: 12 } as Kit,
    lakeTall: { cells: ["tallDry2", "tallDry"], tip: TIP.lakeTall, hMin: 8, hMax: 13 } as Kit,
    reeds: { cells: ["reeds"], tip: TIP.reed, hMin: 11, hMax: 16 } as Kit,
    isle: { cells: ["tallDry", "tallDry2", "shortDry"], tip: TIP.isle, hMin: 6, hMax: 10 } as Kit,
    gate: { cells: ["short", "short2"], tip: TIP.gate, hMin: 4, hMax: 7 } as Kit,
  };
  const flowerKit = (col: THREE.Color, cell: GrassKind, leaf = TIP.flowerLeaf): Kit => ({ cells: [cell, cell, cell, "short"], tip: leaf, leaf, head: col, hMin: 5, hMax: 8 });
  const FLOWERS_A2: Kit[] = [
    flowerKit(FLOWER.orange, "flowerRed"),
    flowerKit(FLOWER.cream, "flowerCream"),
    flowerKit(FLOWER.violet, "flowerViolet"),
    flowerKit(FLOWER.gold, "flowerCream"),
  ];
  const FLOWERS_WILD: Kit[] = [flowerKit(FLOWER.cream, "flowerCream", TIP.meadowTall), flowerKit(FLOWER.violet, "flowerViolet", TIP.meadowTall)];

  const stops = Object.fromEntries(PLACES.map((p) => [p.id, p]));
  /** 1 within 250 of a low stop camera (the opening, a1, a2, a4), 0 past 600: drifts are densest where the camera rests. */
  const stopCams = PLACES.filter((p) => p.id === "a1" || p.id === "a2" || p.id === "a4").map((p) => TRAIL[p.trail]).concat([TRAIL[0]]);
  const nearStop = (x: number, z: number) => {
    let d = Infinity;
    for (const c of stopCams) if (c) d = Math.min(d, Math.hypot(x - c[0], z - c[2]));
    return 1 - smooth(250, 600, d);
  };

  // ── The shelf south of the gorge: the beach, the coast, Base Camp, the woods ──
  centres(-600, 2000, 1780, 4700, 46, 11, (x, z, r) => {
    const keep = railKeep(x, z, 380, 980);
    if (keep <= 0) return;
    const g = gY(x, z);
    if (isWater(x, z, g)) return;
    const sand = sandLineAt(x, z);
    const c = clump(x, z);
    const fa = forestAt(x, z);
    const a2d = Math.hypot(x - stops.a2.pos.x, z - stops.a2.pos.z);
    // The beach: dune grass only on the upper sand, crossing the torn edge.
    if (g < sand + 2.5) {
      if (g > sand - 3.2 && r < 0.75 * keep) drift(x, z, 10 + 12 * rnd(seq, 12), 8 + Math.floor(8 * r), KITS.dune, { maxSlope: 0.45, shade: 0.16 });
      return;
    }
    // Forest floor and woods: ferns, no bright grass. (The density map is
    // coarse: near a stop camera only its heart counts as forest.)
    const ns = nearStop(x, z);
    if (fa > 0.5 + 0.3 * ns) {
      if (r < 0.34 * keep) drift(x, z, 9 + 10 * c, 6 + Math.floor(8 * r), fa > 0.7 ? KITS.fernDark : KITS.fern, { maxSlope: 0.7, shade: 0.12 });
      return;
    }
    // The stream's banks: ferns and tall grass.
    const coast = z > 3300;
    const meadowA2 = a2d < 520;
    const dens = ((meadowA2 ? 0.8 : 0.58) + 0.35 * ns) * keep * (0.55 + 0.6 * c);
    if (r > dens) return;
    const u = rnd(seq, 13);
    const more = 1 + 0.6 * ns; // up to 1.6x the clumps in a drift near a stop camera (overdraw: 2x put a2's meadow at 6+ layers)
    if (meadowA2) {
      // Base Camp: green and gold, the flower meadow (one colour per drift).
      if (u < 0.34) drift(x, z, 10 + 14 * c, Math.round((12 + 12 * r) * more), pick(FLOWERS_A2, rnd(seq, 14)), { shade: 0.2 });
      else if (u < 0.66) drift(x, z, 10 + 16 * c, Math.round((10 + 14 * r) * more), KITS.meadowShort);
      else drift(x, z, 12 + 14 * c, Math.round((8 + 12 * r) * more), KITS.meadowTall);
    } else if (coast) {
      if (u < 0.5) drift(x, z, 12 + 18 * c, 10 + Math.floor(14 * r), KITS.coastTall);
      else if (u < 0.9) drift(x, z, 10 + 14 * c, 10 + Math.floor(12 * r), KITS.coastShort);
      else drift(x, z, 8 + 8 * c, 8 + Math.floor(8 * r), pick(FLOWERS_WILD, rnd(seq, 15)), { shade: 0.2 });
    } else {
      if (u < 0.42) drift(x, z, 10 + 14 * c, 10 + Math.floor(12 * r), KITS.meadowTall);
      else if (u < 0.85) drift(x, z, 10 + 14 * c, 10 + Math.floor(12 * r), KITS.meadowShort);
      else drift(x, z, 8 + 8 * c, 8 + Math.floor(8 * r), pick(FLOWERS_WILD, rnd(seq, 16)), { shade: 0.2 });
    }
  });
  // The stream's banks, all the way to the lip: ferns and tall grass drifts.
  for (let i = 0; i < STREAM.length - 1; i++) {
    const a = STREAM[i];
    const b = STREAM[i + 1];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.round(L / 42));
    for (let k = 0; k < n; k++) {
      const t = (k + rnd(i * 50 + k, 21)) / n;
      const x0 = a[0] + (b[0] - a[0]) * t;
      const z0 = a[2] + (b[2] - a[2]) * t;
      const nx = -(b[2] - a[2]) / (L || 1);
      const nz = (b[0] - a[0]) / (L || 1);
      const side = rnd(i * 50 + k, 22) < 0.5 ? -1 : 1;
      const off = 22 + 26 * i / STREAM.length + 20 * rnd(i * 50 + k, 23);
      const x = x0 + nx * off * side;
      const z = z0 + nz * off * side;
      if (railKeep(x, z) <= 0) continue;
      drift(x, z, 8 + 8 * rnd(i * 50 + k, 24), 7 + Math.floor(8 * rnd(i * 50 + k, 25)), rnd(i * 50 + k, 26) < 0.55 ? KITS.fern : KITS.meadowTall, { maxSlope: 0.7, shade: 0.18 });
    }
  }
  // ── The gorge: ferns on the floor round the pool, on the talus and wet ledges ──
  centres(-460, 1200, 1180, 1760, 34, 41, (x, z, r) => {
    const keep = railKeep(x, z, 300, 800);
    if (keep <= 0) return;
    const g = gY(x, z);
    if (isWater(x, z, g) || g > 520) return;
    const P = WORLD.pool;
    const dP = Math.hypot(x - P.x, z - P.z) - P.r;
    if (dP < 4) return;
    const sl = slopeD(x, z, 3);
    const wet = 1 - smooth(40, 320, dP);
    const floor = g < 100 && sl < 0.55;
    const ledge = !floor && sl < 0.9;
    if (floor && r < (0.35 + 0.45 * wet) * keep) drift(x, z, 8 + 10 * r, 7 + Math.floor(9 * r), KITS.gorgeFern, { maxSlope: 0.65, shade: 0.14 });
    else if (ledge && r < (0.2 + 0.3 * wet) * keep) drift(x, z, 6 + 8 * r, 5 + Math.floor(6 * r), wet > 0.4 ? KITS.gorgeFern : KITS.dryShort, { maxSlope: 0.95, shade: 0.14 });
  });
  // ── The collar, the rim shelf, the saddle and the meadow down to the lake ──
  centres(1000, 2000, -330, 1140, 50, 51, (x, z, r) => {
    const keep = railKeep(x, z, 360, 950);
    if (keep <= 0) return;
    const L = WORLD.lake;
    if (Math.hypot(x - L.x, z - L.z) < L.r + 60) return;
    const g = gY(x, z);
    if (g < 540) return;
    const c = clump(x, z);
    if (forestAt(x, z) > 0.5) {
      if (r < 0.3 * keep) drift(x, z, 8 + 8 * c, 6 + Math.floor(6 * r), KITS.fernDark, { maxSlope: 0.7, shade: 0.12 });
      return;
    }
    if (r > 0.62 * keep * (0.55 + 0.6 * c)) return;
    const u = rnd(seq, 52);
    if (u < 0.5) drift(x, z, 12 + 16 * c, 10 + Math.floor(14 * r), z > 560 ? KITS.collar : KITS.meadowTall, { maxSlope: 0.7 });
    else if (u < 0.88) drift(x, z, 10 + 14 * c, 10 + Math.floor(12 * r), z > 560 ? KITS.dryShort : KITS.meadowShort, { maxSlope: 0.7 });
    else drift(x, z, 8 + 8 * c, 8 + Math.floor(8 * r), pick(FLOWERS_WILD, rnd(seq, 53)), { shade: 0.2 });
  });
  // ── a5: tall golden grass on the shore, reeds at the water's edge ──
  {
    const L = WORLD.lake;
    const n = 170;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(i, 71) * 0.03;
      const reed = rnd(i, 72) < 0.55;
      const d = reed ? L.r - 6 + rnd(i, 73) * 12 : L.r + 14 + rnd(i, 74) * 110;
      const x = L.x + Math.cos(a) * d;
      const z = L.z + Math.sin(a) * d;
      if (railKeep(x, z, 450, 1100) <= 0) continue;
      if (clump(x, z) < 0.35 && rnd(i, 75) < 0.6) continue;
      if (reed) {
        drift(x, z, 8 + 8 * rnd(i, 76), 6 + Math.floor(8 * rnd(i, 77)), KITS.reeds, {
          maxSlope: 0.6,
          shade: 0,
          yAt: (px, pz) => Math.max(gY(px, pz), L.y - 3.5),
          accept: (px, pz, gy) => gy >= L.y - 3.6 && Math.hypot(px - L.x, pz - L.z) < L.r + 10,
        });
      } else drift(x, z, 10 + 12 * rnd(i, 78), 9 + Math.floor(12 * rnd(i, 79)), KITS.lakeTall, { maxSlope: 0.6 });
    }
  }
  // ── a6: the glowing floor by magicAt (v5's clusters), dark ferns elsewhere ──
  {
    const Fo = WORLD.forest;
    const put = (kind: GlowId, cx: number, cz: number, R: number, n: number, s0: number, s1: number, tip: THREE.Color, head: THREE.Color, seed: number) => {
      for (let j = 0; j < n; j++) {
        const b = rnd(seed * 31 + j, 240) * Math.PI * 2;
        const d = R * Math.sqrt(rnd(seed * 31 + j, 241));
        const x = cx + Math.cos(b) * d;
        const z = cz + Math.sin(b) * d;
        if (trailDist(x, z) < 9 || blocked(x, z, 1)) continue;
        glow.push({ kind, x, y: gY(x, z) - 0.25, z, s: s0 + (s1 - s0) * rnd(seed * 31 + j, 242), tip, head });
      }
    };
    let nearPath = 0;
    for (let i = 0; i < 2400; i++) {
      if (i >= 340 && nearPath >= 240) break;
      const a = rnd(i, 231) * Math.PI * 2;
      const rr = Math.sqrt(rnd(i, 232)) * (Fo.r - 20);
      const cx = Fo.x + Math.cos(a) * rr;
      const cz = Fo.z + Math.sin(a) * rr;
      const dT = trailDist(cx, cz);
      if (dT < 14) continue;
      if (i >= 340) {
        if (dT > 110 || nearPath >= 240) continue;
        nearPath++;
      }
      const m = magicAt(cx, cz);
      const hue = rnd(i, 233) < 0.68 ? 0 : 1;
      const glowA = hue ? GLOW[3] : GLOW[rnd(i, 234) < 0.3 ? 1 : 0];
      const R = 6 + rnd(i, 235) * 10;
      if (m > 0.25 && rnd(i, 236) < 0.35 + m) {
        put("moss", cx, cz, R * 0.35, 1 + Math.floor(rnd(i, 236) * 2), 3.5, 6.5, TIP.a6fern, glowA, i * 4);
        // Fix 3: fewer, in tight clusters with dark ground between (were 2 to 5 per clump, everywhere).
        if (m > 0.35 && rnd(i, 243) < 0.55) put("gfern", cx, cz, R * 0.45, 1 + Math.floor(rnd(i, 237) * 2), 6, 9, TIP.a6fern, hue ? GLOW[3] : GLOW[0], i * 4 + 1);
        if (m > 0.5 && rnd(i, 238) < 0.5) put("gcap", cx, cz, R * 0.6, 1 + Math.floor(rnd(i, 239) * 2), 5, 9, TIP.a6cap, hue ? GLOW[0] : GLOW[3], i * 4 + 2);
      }
      drift(cx, cz, R * 1.1, 3 + Math.floor(rnd(i, 249) * 4), { cells: ["fern", "fern2"], tip: TIP.a6fern, hMin: 6, hMax: 11 }, { maxSlope: 0.8, shade: 0.1 });
    }
  }
  // ── a7: pale gold drifts on the Sky Island, clustered on the rim, the centre open ──
  {
    const I = WORLD.island;
    const O = stops.a7.pos;
    // Final pass B (judge: evenly dotted tufts): fewer, bigger drifts (a
    // 96 grid, not 44), so the top reads as a few gathered swathes with open
    // grass between them.
    centres(I.x - I.r, I.x + I.r, I.z - I.r, I.z + I.r, 96, 91, (x, z, r) => {
      const d = Math.hypot(x - I.x, z - I.z);
      const rim = islandRim(Math.atan2(x - I.x, -(z - I.z)));
      if (d > rim - 30) return;
      if (Math.hypot(x - O.x, z - O.z) < 70) return;
      const edge = smooth(rim - 260, rim - 60, d);
      // Final pass: a few more drifts inward (the top read as a bare field), the centre still open.
      if (r > 0.4 + 0.55 * edge) return;
      drift(x, z, 20 + 24 * r, 16 + Math.floor(20 * r), KITS.isle, { yAt: islandTopY, accept: (px, pz) => Math.hypot(px - I.x, pz - I.z) < islandRim(Math.atan2(px - I.x, -(pz - I.z))) - 16 });
    });
  }
  // The bounty isle's top: the same pale gold.
  {
    const B = WORLD.bountyIsle;
    centres(B.x - B.r, B.x + B.r, B.z - B.r, B.z + B.r, 34, 93, (x, z, r) => {
      if (Math.hypot(x - B.x, z - B.z) > B.r - 22) return;
      if (r > 0.55) return;
      drift(x, z, 8 + 8 * r, 6 + Math.floor(8 * r), KITS.isle, { yAt: () => B.y, accept: (px, pz) => Math.hypot(px - B.x, pz - B.z) < B.r - 10 });
    });
  }
  // ── Round every rock family: a ring of grass (big to small) ──
  {
    const rocks = allFootprints().filter((f) => f.kind === "rock" && !f.line);
    const anchors = rocks.length ? rocks.map((f) => ({ x: f.x, z: f.z, r: f.r })) : rockAnchors.map((a) => ({ x: a.x, z: a.z, r: a.r }));
    for (let i = 0; i < anchors.length; i++) {
      const A = anchors[i];
      if (A.r < 4) continue;
      const g0 = gY(A.x, A.z);
      if (isWater(A.x, A.z, g0) || railKeep(A.x, A.z, 400, 1000) <= 0) continue;
      if (Math.hypot(A.x - WORLD.island.x, A.z - WORLD.island.z) < WORLD.island.r + 40) continue;
      if (g0 < sandLineAt(A.x, A.z) + 1) continue;
      const kit = A.z > 3300 ? KITS.coastTall : A.z > 1800 ? KITS.meadowTall : A.z > 1150 ? KITS.gorgeFern : A.z > 0 ? KITS.collar : KITS.lakeTall;
      const n = 3 + Math.floor(rnd(i, 30) * 3);
      for (let k = 0; k < n; k++) {
        const a = rnd(i * 13 + k, 31) * Math.PI * 2;
        const d = A.r * (1.05 + rnd(i * 13 + k, 32) * 0.35) + 3;
        drift(A.x + Math.cos(a) * d, A.z + Math.sin(a) * d, 5 + A.r * 0.18, 4 + Math.floor(rnd(i * 13 + k, 33) * 4), kit, { maxSlope: 0.8, shade: 0.12 });
      }
    }
  }
  // ── The near band: big drifts where the ground first enters a low stop's frame ──
  {
    const BAND: Array<[number, Kit[]]> = [
      // The opening's islet: full dry grass clumps (the thin dune cells read as spikes there).
      [0, [KITS.coastTall, KITS.coastShort]],
      [1, [KITS.coastTall, KITS.coastShort]],
      [2, [KITS.dune, KITS.coastTall]],
      [7, [...FLOWERS_A2, KITS.meadowTall, KITS.meadowShort]],
      [12, [KITS.meadowTall, KITS.fern]],
      [39, [KITS.dryShort, KITS.gorgeFern]],
    ];
    for (const [key, kits] of BAND) {
      if (key >= TRAIL.length) continue;
      const [cx, cy, cz] = TRAIL[key];
      const v = TRAIL_VIEW[key];
      const fov = TRAIL_FOV[key] ?? 40;
      const camH = cy - Math.max(gY(cx, cz), 0);
      // Pitch is positive DOWN in KEYS (a2's -10 looks up): the frame's bottom
      // edge sits fov/2 + pitch below level, and the ground enters it at d0.
      const below = (fov / 2 + v.pitch) * DEG;
      if (below <= 0.03) continue;
      const d0 = Math.max(18, camH / Math.tan(below));
      if (d0 > 420) continue;
      for (let k = 0; k < 30; k++) {
        const b = (v.bearing + (rnd(key * 40 + k, 81) - 0.5) * 38) * DEG;
        const d = d0 * (0.95 + 0.9 * rnd(key * 40 + k, 82));
        const x = cx + Math.sin(b) * d;
        const z = cz - Math.cos(b) * d;
        const frameH = 2 * d * Math.tan((fov / 2) * DEG);
        const kit = pick(kits, rnd(key * 40 + k, 83));
        // 10 to 18% of the frame height where it stands, never taller than a person and a bit.
        const big: Kit = { ...kit, hMin: Math.min(12, frameH * 0.1), hMax: Math.min(18, frameH * 0.18) };
        drift(x, z, 8 + Math.min(16, frameH * 0.08), 6 + Math.floor(rnd(key * 40 + k, 84) * 6), big, { maxSlope: 0.7, near: true });
      }
    }
  }
  // ── The opening's islet (bible 1.1 layer 1): big dry grass clumps along its
  // near flank, at the foot of the boulder family, on the ground as drawn (the
  // islet is a coarse mound; the heightfield under it is higher and rounder).
  if (surf) {
    const islet: Kit = { ...KITS.coastTall, hMin: 13, hMax: 18 };
    const onIslet = (x: number, z: number) => surf.drawnHeight(x, z);
    // Between and in front of the boulders' footprints (rocks.ts), where the mound is above the sea.
    for (const [x, z] of [
      [1625, 4887],
      [1636, 4886],
      [1644, 4884],
      [1652, 4881],
      [1611, 4873],
    ] as const) {
      drift(x, z, 3, 2, islet, { yAt: onIslet, shade: 0, accept: (_x, _z, g) => g > 0.5 });
    }
  }
  return { cards, glow, drifts, rejectedByFootprints: rejected };
}

/**
 * A downward "raycast" against the meshes under `targets`, answered from a 2D
 * grid of their world triangles built once (fix 3: it was three's brute force
 * raycaster, every triangle per ray). Same rules as Raycaster + Mesh.raycast:
 * the highest triangle over (x, z) between yMin and yMax, front faces only for
 * FrontSide, back faces only for BackSide, both for DoubleSide; that hit counts
 * only when its face normal points up (y over 0.75), else null.
 */
function makeDownProbe(targets: THREE.Object3D[], yMin: number, yMax: number, cell: number) {
  const tri: number[] = []; // 9 world coords + side, per triangle
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const seen = new Set<THREE.Object3D>();
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const t of targets)
    t.traverse((o) => {
      if (seen.has(o)) return;
      seen.add(o);
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
      const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!pos) return;
      const idx = m.geometry.index;
      const side = (m.material as THREE.Material).side;
      const n = idx ? idx.count : pos.count;
      for (let k = 0; k + 2 < n; k += 3) {
        const a = idx ? idx.getX(k) : k;
        const b = idx ? idx.getX(k + 1) : k + 1;
        const c = idx ? idx.getX(k + 2) : k + 2;
        va.fromBufferAttribute(pos, a).applyMatrix4(m.matrixWorld);
        vb.fromBufferAttribute(pos, b).applyMatrix4(m.matrixWorld);
        vc.fromBufferAttribute(pos, c).applyMatrix4(m.matrixWorld);
        if (Math.max(va.y, vb.y, vc.y) < yMin || Math.min(va.y, vb.y, vc.y) > yMax) continue;
        tri.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z, side);
        minX = Math.min(minX, va.x, vb.x, vc.x);
        maxX = Math.max(maxX, va.x, vb.x, vc.x);
        minZ = Math.min(minZ, va.z, vb.z, vc.z);
        maxZ = Math.max(maxZ, va.z, vb.z, vc.z);
      }
    });
  const T = new Float64Array(tri);
  const nT = T.length / 10;
  if (!nT) return (): number | null => null;
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
  const bins: number[][] = Array.from({ length: nx * nz }, () => []);
  for (let t = 0; t < nT; t++) {
    const o = t * 10;
    const i0 = Math.floor((Math.min(T[o], T[o + 3], T[o + 6]) - minX) / cell);
    const i1 = Math.floor((Math.max(T[o], T[o + 3], T[o + 6]) - minX) / cell);
    const j0 = Math.floor((Math.min(T[o + 2], T[o + 5], T[o + 8]) - minZ) / cell);
    const j1 = Math.floor((Math.max(T[o + 2], T[o + 5], T[o + 8]) - minZ) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) bins[j * nx + i].push(t);
  }
  return (x: number, z: number): number | null => {
    const i = Math.floor((x - minX) / cell);
    const j = Math.floor((z - minZ) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return null;
    let bestY = -Infinity;
    let bestUp = 0;
    for (const t of bins[j * nx + i]) {
      const o = t * 10;
      const ax = T[o], ay = T[o + 1], az = T[o + 2];
      const e1x = T[o + 3] - ax, e1y = T[o + 4] - ay, e1z = T[o + 5] - az;
      const e2x = T[o + 6] - ax, e2y = T[o + 7] - ay, e2z = T[o + 8] - az;
      // Face normal (a, b, c winding): y is the xz area term.
      const ny = e1z * e2x - e1x * e2z;
      if (Math.abs(ny) < 1e-9) continue; // vertical: a vertical ray never meets it
      const side = T[o + 9];
      if (side === THREE.FrontSide && ny <= 0) continue;
      if (side === THREE.BackSide && ny >= 0) continue;
      // Barycentric in xz.
      const px = x - ax;
      const pz = z - az;
      const v = (px * e2z - pz * e2x) / (e1x * e2z - e1z * e2x);
      const w = (e1x * pz - e1z * px) / (e1x * e2z - e1z * e2x);
      if (v < 0 || w < 0 || v + w > 1) continue;
      const y = ay + v * e1y + w * e2y;
      if (y < yMin || y > yMax || y <= bestY) continue;
      const nx2 = e1y * e2z - e1z * e2y;
      const nz2 = e1x * e2y - e1y * e2x;
      bestY = y;
      bestUp = ny / Math.hypot(nx2, ny, nz2);
    }
    if (bestY === -Infinity) return null;
    return bestUp > 0.75 ? bestY : null;
  };
}

/** The Gate isle's top (B8's mesh, probed from above), on a 30 unit grid; clumps drift there. */
function gateIsleCards(ctx: WorldCtx, surf: SurfacesApi | undefined, into: CardInst[]): number {
  const G = WORLD.gateIsle;
  const targets: THREE.Object3D[] = [];
  ctx.root.traverse((o) => {
    if (/^(DressGate|Set_a8|Stand-in:GateIsle|GateIsle)/.test(o.name)) targets.push(o);
  });
  if (!targets.length) return 0;
  // The old ray started at G.y + 400 and reached 700 down.
  const hitY = makeDownProbe(targets, G.y - 300, G.y + 400, 24);
  let placed = 0;
  let i = 0;
  const archAx = Math.sin(GATE.axis * DEG);
  const archAz = -Math.cos(GATE.axis * DEG);
  for (let z = G.z - G.r; z < G.z + G.r; z += 30) {
    for (let x = G.x - G.r; x < G.x + G.r; x += 30) {
      i++;
      const jx = x + (rnd(i, 95) - 0.5) * 26;
      const jz = z + (rnd(i, 96) - 0.5) * 26;
      const d = Math.hypot(jx - G.x, jz - G.z);
      if (d > G.r - 20 || rnd(i, 97) > 0.5) continue;
      // Keep the arch's axis clear (the causeway and the fly through).
      const along = (jx - GATE.x) * archAx + (jz - GATE.z) * archAz;
      const side = Math.abs((jx - GATE.x) * archAz - (jz - GATE.z) * archAx);
      if (side < 70 && along > -520 && along < 60) continue;
      if (blocked(jx, jz, 3)) continue;
      const y = hitY(jx, jz);
      if (y === null) continue;
      const cliff = smooth(G.r - 110, G.r - 30, d);
      const n = 6 + Math.floor(rnd(i, 98) * 8);
      for (let k = 0; k < n; k++) {
        const a = rnd(i * 17 + k, 99) * Math.PI * 2;
        const rr = 12 * Math.sqrt(rnd(i * 17 + k, 100));
        const px = jx + Math.cos(a) * rr;
        const pz = jz + Math.sin(a) * rr;
        if (blocked(px, pz, 1.5)) continue;
        // C1 (B8): nothing past the cut-short rim behind the arch.
        if (gateIsleTop(px, pz) === null) continue;
        const pink = cliff > 0.5 && rnd(i * 17 + k, 101) < 0.6;
        const cell = grassCell(pink ? "flowerRed" : rnd(i * 17 + k, 102) < 0.5 ? "short" : "short2");
        const h = (pink ? 4.5 : 4) + 3 * rnd(i * 17 + k, 103);
        into.push({ x: px, y: y - 0.3, z: pz, h, w: h * cell.aspect, yaw: rnd(i * 17 + k, 104) * Math.PI, cell, tip: TIP.gate, head: FLOWER.pink, val: 0.9 + 0.2 * rnd(i, 105), deep: 0.3 });
        placed++;
      }
    }
  }
  void surf;
  return placed;
}

// ── Shaders ──────────────────────────────────────────────────────────────────

const CARD_VERT_PARS = /* glsl */ `
attribute vec4 iCell;
attribute vec3 iRoot;
attribute vec4 iTip;
attribute vec3 iHead;
uniform float uTime;
uniform vec2 uWind;
uniform float uWindAmp;
uniform vec2 uFade;
uniform sampler2D uShadeTex;
uniform vec4 uShadeB;
uniform float uShadeOn;
varying vec2 vCellUv;
varying vec3 vRootC;
varying vec3 vTipC;
varying vec3 vHeadC;
varying float vLit;
`;
const CARD_VERT_BODY = /* glsl */ `
{
  vec3 ip = vec3( instanceMatrix[ 3 ] );
  float dCam = distance( ip, cameraPosition );
  float fade = 1.0 - smoothstep( uFade.x, uFade.y, dCam );
  vec3 bx = vec3( instanceMatrix[ 0 ] );
  vec3 by = vec3( instanceMatrix[ 1 ] );
  vec3 bz = vec3( instanceMatrix[ 2 ] );
  float h = clamp( position.y, 0.0, 1.0 );
  float hy = length( by );
  float gust = 0.6 * sin( dot( ip.xz, vec2( 0.021, 0.013 ) ) + uTime * 1.7 ) + 0.4 * sin( dot( ip.xz, vec2( -0.006, 0.011 ) ) + uTime * 0.45 );
  // A world offset (units) weighted to the tip, into the instance's frame.
  vec3 w = vec3( uWind.x, 0.0, uWind.y ) * ( uWindAmp * hy * h * h * ( 0.55 + 0.45 * gust ) );
  transformed += vec3( dot( bx, w ) / dot( bx, bx ), dot( by, w ) / dot( by, by ), dot( bz, w ) / dot( bz, bz ) );
  transformed *= fade;
  vCellUv = vec2( mix( iCell.x, iCell.z, uv.x ), mix( iCell.y, iCell.w, uv.y ) );
  vRootC = iRoot;
  vTipC = iTip.rgb * iTip.a * ( 1.0 + 0.08 * gust * h );
  vHeadC = iHead;
  float lit = 1.0;
  if ( uShadeOn > 0.5 ) {
    vec2 suv = ( ip.xz - uShadeB.xy ) * uShadeB.zw;
    if ( suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0 ) lit = texture2D( uShadeTex, suv ).r;
  }
  vLit = mix( 0.62, 1.0, lit );
}
`;
const CARD_FRAG_PARS = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vCellUv;
varying vec3 vRootC;
varying vec3 vTipC;
varying vec3 vHeadC;
varying float vLit;
`;
const CARD_FRAG_COLOR = /* glsl */ `
{
  vec4 at = texture2D( uAtlas, vCellUv );
  // Golus: keep coverage as the mips average the alpha down.
  vec2 dxy = max( abs( dFdx( vCellUv ) ), abs( dFdy( vCellUv ) ) ) * ${GRASS_ATLAS_SIZE.toFixed(1)};
  float mip = max( 0.0, log2( max( max( dxy.x, dxy.y ), 1e-4 ) ) );
  float t = at.b;
  vec3 col = mix( vRootC, vTipC, smoothstep( 0.0, 0.9, t ) ) * ( 0.6 + 0.52 * at.r );
  col = mix( col, vHeadC * ( 0.5 + 0.62 * at.r ), step( 0.5, at.g ) );
  diffuseColor.rgb = col * vLit;
  diffuseColor.a = at.a * ( 1.0 + mip * 0.28 );
}
`;

const GLOW_VERT_PARS = /* glsl */ `
attribute float aT;
attribute float aHead;
attribute vec4 iTip;
attribute vec3 iHead;
uniform float uTime;
uniform vec2 uWind;
uniform float uWindAmp;
uniform vec2 uFade;
varying vec3 vCoverCol;
varying vec3 vCoverGlow;
`;
const GLOW_VERT_BODY = /* glsl */ `
{
  vec3 ip = vec3( instanceMatrix[ 3 ] );
  float dCam = distance( ip, cameraPosition );
  float fade = 1.0 - smoothstep( uFade.x, uFade.y, dCam );
  vec3 bx = vec3( instanceMatrix[ 0 ] );
  vec3 by = vec3( instanceMatrix[ 1 ] );
  vec3 bz = vec3( instanceMatrix[ 2 ] );
  float s2 = dot( bx, bx );
  float h = clamp( position.y, 0.0, 1.0 );
  float gust = 0.6 * sin( dot( ip.xz, vec2( 0.021, 0.013 ) ) + uTime * 1.7 ) + 0.4 * sin( dot( ip.xz, vec2( -0.006, 0.011 ) ) + uTime * 0.45 );
  vec3 w = vec3( uWind.x, 0.0, uWind.y ) * ( uWindAmp * sqrt( s2 ) * h * h * ( 0.55 + 0.45 * gust ) );
  transformed += vec3( dot( bx, w ), dot( by, w ), dot( bz, w ) ) / s2;
  transformed *= fade;
  vec3 root = iTip.rgb * vec3( 0.34, 0.37, 0.41 );
  vec3 col = mix( root, iTip.rgb, smoothstep( 0.0, 1.0, aT ) ) * iTip.a;
  vCoverCol = mix( col, iHead, step( 0.5, aHead ) );
  vCoverGlow = iHead * aHead;
}
`;

// ── Live layers (cells, compaction, quality) ─────────────────────────────────

interface CellRec {
  cx: number;
  cy: number;
  cz: number;
  start: number;
  count: number;
}
interface Layer {
  name: string;
  mesh: THREE.InstancedMesh;
  /** Per instance source arrays, in cell order, and their live attributes (instanceMatrix first). */
  src: Float32Array[];
  live: Array<THREE.InstancedBufferAttribute | THREE.InstancedBufferAttribute>;
  sizes: number[];
  cells: CellRec[];
  fade: THREE.Vector2;
  baseFade: [number, number];
  total: number;
  tris: number;
  shown: string;
  positions: Float32Array;
}

export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = performance.now();
  const root = new THREE.Group();
  root.name = "V6Cover";
  ctx.root.add(root);
  const time = { value: 0 };
  const wind = { value: new THREE.Vector2(0.8, 0.6).normalize() };
  const windAmp = { value: 0.13 };
  const atlas = getGrassAtlas(ctx.renderer);
  const stats: Record<string, number | string> = {};
  const layers: Layer[] = [];
  const materials: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  let tier: QualityTier = ctx.quality;
  const shadeFallback = {
    uShadeTex: { value: atlas as THREE.Texture },
    uShadeB: { value: new THREE.Vector4(0, 0, 1, 1) },
    uShadeOn: { value: 0 },
  };

  /** Build one layer from records sorted into cells and shuffled inside each (so a density share thins evenly). */
  function makeLayer<T extends { x: number; y: number; z: number }>(
    name: string,
    recs: T[],
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    cap: number,
    fade: [number, number],
    attrs: Array<{ name: string; size: number; fill: (r: T, out: Float32Array, o: number) => void }>,
    matrix: (r: T, m: THREE.Matrix4) => void,
  ): Layer | null {
    if (!recs.length) return null;
    const key = (p: T) => Math.floor(p.x / CELL) * 100000 + Math.floor(p.z / CELL);
    const sorted = recs
      .map((r, i) => ({ r, k: key(r), s: rnd(i, 777) }))
      .sort((a, b) => a.k - b.k || a.s - b.s)
      .map((o) => o.r);
    const N = sorted.length;
    const m = new THREE.Matrix4();
    const mats = new Float32Array(N * 16);
    const src: Float32Array[] = [mats];
    const sizes = [16];
    for (const a of attrs) {
      src.push(new Float32Array(N * a.size));
      sizes.push(a.size);
    }
    const positions = new Float32Array(N * 3);
    const cells: CellRec[] = [];
    let cur: CellRec | null = null;
    let curKey = NaN;
    sorted.forEach((p, i) => {
      matrix(p, m);
      m.toArray(mats, i * 16);
      attrs.forEach((a, j) => a.fill(p, src[j + 1], i * a.size));
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      const k = key(p);
      if (k !== curKey) {
        cur = { cx: (Math.floor(p.x / CELL) + 0.5) * CELL, cy: p.y, cz: (Math.floor(p.z / CELL) + 0.5) * CELL, start: i, count: 0 };
        cells.push(cur);
        curKey = k;
      }
      cur!.count++;
      cur!.cy = Math.max(cur!.cy, p.y);
    });
    const capN = Math.min(cap, N);
    const live: THREE.InstancedBufferAttribute[] = [];
    for (let j = 0; j < attrs.length; j++) {
      const at = new THREE.InstancedBufferAttribute(new Float32Array(capN * attrs[j].size), attrs[j].size);
      at.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(attrs[j].name, at);
      live.push(at);
    }
    const mesh = new THREE.InstancedMesh(geo, mat, capN);
    mesh.name = `Cover:${name}`;
    mesh.count = 0;
    mesh.frustumCulled = false; // culled here, by cell
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.visible = false;
    // Too small for the Mirror Lake: kept out of its reflection pass.
    mesh.layers.set(NO_REFLECT_LAYER);
    // Final pass C (overdraw): the cover is the nearest layer at every stop's
    // feet, so it fills depth first (before the giants at -7 and the forest
    // at -6 to -3) and the terrain and trunks behind it fail the depth test
    // (a6 average 1.96 -> 1.88 layers, 6+ 1.84% -> 1.47%). Opaque cutouts,
    // so the picture does not depend on the order.
    mesh.renderOrder = -8;
    root.add(mesh);
    const fadeV = new THREE.Vector2(fade[0] * tier.coverFade, fade[1] * tier.coverFade);
    const index = geo.getIndex();
    const tris = (index ? index.count : geo.getAttribute("position").count) / 3;
    return { name, mesh, src, live: [mesh.instanceMatrix as THREE.InstancedBufferAttribute, ...live], sizes, cells, fade: fadeV, baseFade: fade, total: N, tris, shown: "", positions };
  }

  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const sph = new THREE.Sphere();
  const camPos = new THREE.Vector3();
  const lastPos = new THREE.Vector3(Infinity, 0, 0);
  const lastQ = new THREE.Quaternion();
  const R = CELL * 0.75 + 20;
  const order: Array<{ c: number; d: number }> = [];

  /** Copy the nearest cells in view into each layer's live buffers. True when anything changed. */
  function compact(force = false): boolean {
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    const p = cam.getWorldPosition(camPos);
    if (!force && p.distanceToSquared(lastPos) < 16 && cam.quaternion.angleTo(lastQ) < 0.02) return false;
    lastPos.copy(p);
    lastQ.copy(cam.quaternion);
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    let changed = false;
    const dens = Math.max(0.05, Math.min(1, tier.coverDensity));
    for (const L of layers) {
      const far = L.fade.y + R;
      order.length = 0;
      for (let c = 0; c < L.cells.length; c++) {
        const C = L.cells[c];
        const dx = C.cx - p.x;
        const dz = C.cz - p.z;
        const dy = C.cy - p.y;
        const d2 = dx * dx + dz * dz + dy * dy;
        if (d2 > far * far) continue;
        sph.center.set(C.cx, C.cy, C.cz);
        sph.radius = R + 30;
        if (!frustum.intersectsSphere(sph)) continue;
        order.push({ c, d: d2 });
      }
      order.sort((a, b) => a.d - b.d);
      const cap = L.mesh.instanceMatrix.count;
      let n = 0;
      const pick: number[] = [];
      for (const o of order) {
        const take = Math.ceil(L.cells[o.c].count * dens);
        if (n + take > cap) break;
        pick.push(o.c);
        n += take;
      }
      const sig = pick.join(",") + "|" + dens;
      if (sig === L.shown) continue;
      L.shown = sig;
      changed = true;
      let o = 0;
      for (const c of pick) {
        const C = L.cells[c];
        const take = Math.ceil(C.count * dens);
        for (let a = 0; a < L.src.length; a++) {
          const s = L.sizes[a];
          (L.live[a].array as Float32Array).set(L.src[a].subarray(C.start * s, (C.start + take) * s), o * s);
        }
        o += take;
      }
      L.mesh.count = o;
      L.mesh.visible = o > 0;
      if (o > 0) {
        for (let a = 0; a < L.live.length; a++) {
          L.live[a].clearUpdateRanges();
          L.live[a].addUpdateRange(0, o * L.sizes[a]);
          L.live[a].needsUpdate = true;
        }
      }
    }
    return changed;
  }

  const live = () => layers.reduce((a, L) => a + (L.mesh.visible ? L.mesh.count : 0), 0);
  const installMs = Math.round(performance.now() - t0);

  return {
    name: "cover",
    afterAll() {
      const a0 = performance.now();
      const surf = ctx.scene.userData.surfaces as SurfacesApi | undefined;
      const sc0 = performance.now();
      const out = scatter(ctx, surf);
      const gt0 = performance.now();
      const nBefore = out.cards.length;
      stats.gateCards = gateIsleCards(ctx, surf, out.cards);
      stats.gateMs = Math.round(performance.now() - gt0);
      let gateYSum = 0;
      for (let k = nBefore; k < out.cards.length; k++) gateYSum += out.cards[k].y;
      stats.gateYSum = Math.round(gateYSum);
      stats.scatterMs = Math.round(performance.now() - sc0);
      // The ground darkens under every drift, then each clump takes its root
      // colour from that ground (so it grows out of it and sits in its shade).
      if (surf) surf.addGroundShade(out.drifts);
      // Planted: the root darker than the ground, darker still in a drift's heart.
      const rc0 = performance.now();
      const g = new THREE.Color();
      const roots = new Map<CardInst, THREE.Color>();
      for (const c of out.cards) {
        // The floating islands' drifts root in their own gold top, never the ground far below.
        if (c.tip === TIP.isle) g.copy(ISLE_ROOT);
        else if (surf) surf.groundColorAt(c.x, c.z, g);
        else g.setRGB(0.2, 0.18, 0.1);
        roots.set(c, g.clone().multiplyScalar(0.62 - 0.12 * c.deep));
      }
      const rootOf = (c: CardInst) => roots.get(c)!;
      stats.rootColourMs = Math.round(performance.now() - rc0);

      // Cards: one layer, one call.
      const cardMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, alphaTest: 0.42 });
      cardMat.alphaToCoverage = true;
      cardMat.name = "V6CoverCards";
      cardMat.userData.atlas = atlas;
      const shadeU = surf ? surf.shadeUniforms : shadeFallback;
      const cardU: Record<string, THREE.IUniform> = { uTime: time, uWind: wind, uWindAmp: windAmp, uAtlas: { value: atlas }, ...shadeU };
      chainCompile(
        cardMat,
        (shader) => {
          Object.assign(shader.uniforms, cardU);
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\n" + CARD_VERT_PARS)
            .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + CARD_VERT_BODY);
          shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\n" + CARD_FRAG_PARS)
            .replace("#include <color_fragment>", "#include <color_fragment>\n" + CARD_FRAG_COLOR)
            .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize( vNormal );");
        },
        "v6cover|cards",
      );
      materials.push(cardMat);
      const cardGeo = cardGeometry();
      geos.push(cardGeo);
      const cardLayer = makeLayer(
        "cards",
        out.cards,
        cardGeo,
        cardMat,
        5000,
        [560, 880],
        [
          { name: "iCell", size: 4, fill: (c, o, i) => o.set([c.cell.u0, c.cell.v0, c.cell.u1, c.cell.v1], i) },
          {
            name: "iRoot",
            size: 3,
            fill: (c, o, i) => {
              const r = rootOf(c);
              o[i] = r.r;
              o[i + 1] = r.g;
              o[i + 2] = r.b;
            },
          },
          {
            name: "iTip",
            size: 4,
            fill: (c, o, i) => {
              // The tip leans a little toward the ground's hue, so it belongs to it.
              const r = rootOf(c);
              const l = Math.max(1e-3, (r.r + r.g + r.b) / 3);
              o[i] = c.tip.r * (0.86 + 0.14 * (r.r / l));
              o[i + 1] = c.tip.g * (0.86 + 0.14 * (r.g / l));
              o[i + 2] = c.tip.b * (0.86 + 0.14 * (r.b / l));
              o[i + 3] = c.val;
            },
          },
          { name: "iHead", size: 3, fill: (c, o, i) => o.set([c.head.r, c.head.g, c.head.b], i) },
        ],
        (c, m) => {
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw);
          m.compose(new THREE.Vector3(c.x, c.y, c.z), q, new THREE.Vector3(c.w, c.h, c.w));
        },
      );
      if (cardLayer) {
        cardU.uFade = { value: cardLayer.fade };
        layers.push(cardLayer);
      }

      // a6's glowing floor: v5's geometry kinds, one layer each.
      const glowDefs: Array<{ id: GlowId; fade: [number, number]; cap: number }> = [
        { id: "moss", fade: [600, 880], cap: 1400 },
        { id: "gfern", fade: [420, 880], cap: 1800 },
        { id: "gcap", fade: [320, 640], cap: 500 },
      ];
      for (const d of glowDefs) {
        const recs = out.glow.filter((g2) => g2.kind === d.id);
        const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
        mat.name = "V6CoverGlow";
        mat.userData.lightGlow = "magic";
        const fadeV = { value: new THREE.Vector2() };
        const u: Record<string, THREE.IUniform> = { uTime: time, uWind: wind, uWindAmp: windAmp, uFade: fadeV };
        chainCompile(
          mat,
          (shader) => {
            Object.assign(shader.uniforms, u);
            shader.vertexShader = shader.vertexShader
              .replace("#include <common>", "#include <common>\n" + GLOW_VERT_PARS)
              .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + GLOW_VERT_BODY);
            shader.fragmentShader = shader.fragmentShader
              .replace("#include <common>", "#include <common>\nvarying vec3 vCoverCol;\nvarying vec3 vCoverGlow;")
              .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = vCoverCol;")
              .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize( vNormal );")
              .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vCoverGlow * diffuse.r * 1.1;");
          },
          "v6cover|glow",
        );
        materials.push(mat);
        const geo = glowGeometry(d.id);
        geos.push(geo);
        const L = makeLayer(
          d.id,
          recs,
          geo,
          mat,
          d.cap,
          d.fade,
          [
            {
              name: "iTip",
              size: 4,
              fill: (r2, o, i) => {
                o[i] = r2.tip.r;
                o[i + 1] = r2.tip.g;
                o[i + 2] = r2.tip.b;
                o[i + 3] = 0.9 + 0.2 * rnd(i, 72);
              },
            },
            { name: "iHead", size: 3, fill: (r2, o, i) => o.set([r2.head.r, r2.head.g, r2.head.b], i) },
          ],
          (r2, m) => {
            const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd(Math.round(r2.x * 7 + r2.z), 71) * Math.PI * 2);
            m.compose(new THREE.Vector3(r2.x, r2.y, r2.z), q, new THREE.Vector3(r2.s, r2.s, r2.s));
          },
        );
        if (L) {
          fadeV.value = L.fade;
          layers.push(L);
        }
      }
      root.updateMatrixWorld(true);

      // Checks (bible 2.3 gates): clumps inside footprints, drawn past 900.
      let inside = 0;
      for (const c of out.cards) if (blocked(c.x, c.z, 0)) inside++;
      stats.cards = out.cards.length;
      stats.glow = out.glow.length;
      stats.drifts = out.drifts.length;
      stats.insideFootprints = inside;
      stats.rejectedByFootprints = out.rejectedByFootprints;
      stats.atlas = JSON.stringify(grassAtlasStats());
      compact(true);
      stats.afterAllMs = Math.round(performance.now() - a0);
      // Harness probe (scene.userData.coverProbe): why a spot has no grass.
      ctx.scene.userData.coverProbe = (x: number, z: number) => {
        const g = groundY(x, z);
        let near = 0;
        for (const c of out.cards) if ((c.x - x) ** 2 + (c.z - z) ** 2 < 900) near++;
        return { g, water: isWater(x, z, g), slope: gridSlope(x, z), blocked: blocked(x, z, 1.5), forest: surf ? surf.forestAt(x, z) : -1, cardsWithin30: near, sand: sandLineAt(x, z) };
      };
    },
    update(t: number) {
      const changed = compact();
      if (!ctx.reducedMotion) time.value = t;
      return changed || (!ctx.reducedMotion && live() > 0);
    },
    isAnimating() {
      return !ctx.reducedMotion && live() > 0;
    },
    setQuality(next: QualityTier) {
      tier = next;
      for (const L of layers) L.fade.set(L.baseFade[0] * tier.coverFade, L.baseFade[1] * tier.coverFade);
      compact(true);
    },
    dispose() {
      root.removeFromParent();
      for (const L of layers) L.mesh.dispose();
      for (const g of geos) g.dispose();
      for (const m of materials) m.dispose();
    },
    stats() {
      compact();
      const out: Record<string, number | string> = { ...stats, installMs: installMs };
      let visibleTris = 0;
      let visibleCalls = 0;
      let beyond900 = 0;
      const p = ctx.camera.getWorldPosition(camPos);
      for (const L of layers) {
        out[`n_${L.name}`] = L.total;
        const n = L.mesh.visible ? L.mesh.count : 0;
        out[`live_${L.name}`] = n;
        if (n > 0) {
          visibleTris += n * L.tris;
          visibleCalls++;
          const arr = L.mesh.instanceMatrix.array as Float32Array;
          for (let i = 0; i < n; i++) {
            const dx = arr[i * 16 + 12] - p.x;
            const dy = arr[i * 16 + 13] - p.y;
            const dz = arr[i * 16 + 14] - p.z;
            if (dx * dx + dy * dy + dz * dz > 900 * 900) beyond900++;
          }
        }
      }
      out.live = live();
      out.visibleTris = visibleTris;
      out.visibleCalls = visibleCalls;
      // Live past 900 are in the buffer but shrunk to nothing by the fade (it ends at 880).
      out.liveBeyond900 = beyond900;
      out.fadeEnd = layers.length ? Math.round(layers[0].fade.y) : 0;
      return out;
    },
  };
};
