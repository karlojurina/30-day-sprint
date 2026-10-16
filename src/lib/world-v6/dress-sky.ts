/**
 * V5 dressing module: THE SKY (world_art_bible.md 6: the rise, a7 the Sky
 * Island, the rope bridge and the bounty isle, the flight).
 *
 * WHAT IT ADDS
 *   DressSky (its own group, hidden from the southern lowlands like blocks'
 *   Zone_sky):
 *     - the Sky Island's body: the top re-cut finer (same surface as blocks'
 *       islandTop, same rim) and painted pale gold, a soil band under the lip,
 *       the underside on blocks' exact vertices (rocks.ts lays its cliff sheets
 *       flush on them) in blue grey flat strata darkening to the tip; hanging
 *       spurs, dangling roots; the four small drifting rocks
 *     - spires on the top (clumped toward the rim, a framing clump in the
 *       lower right of the a7 frame, nothing on the path or near the rail)
 *     - a flagstone path from the cove to the observatory and on to the bridge,
 *       small lanterns along it (lamp glow + halos)
 *     - the bounty isle: its body, two spires, the berth's bollards and
 *       gangway, the mooring ropes (shown only while your ship is moored), and
 *       (map review item 18) the Ad Bounty's board in its own LM_Bounty group
 *       (bounty.ts, buildBountyBoard): a stone footing, a gabled board of
 *       bounty notices with a brass seal, a lantern off each post, a writing
 *       stand, a bench; the crates and barrels behind it, off the walk
 *     - the bridge's end posts, gate beams and lantern posts (static; the deck
 *       and ropes sway with blocks' group)
 *     - cloud: a ring round the island's waist and the bounty isle's, so their
 *       bases dissolve; the flight's cloud sea, flat bottomed cumulus on top of
 *       light.ts's cloud layer, thinning with distance, peaks left as islands
 *     - v6, the stargazer's island (world_art_bible_v6.md 1.17): the spring
 *       basin by the terrace and its two rills to the rim (ISLAND_RILLS; the
 *       west one bends round the terrace), a stone slab bridge where a rill
 *       crosses the path, the cove landing with two lantern posts, the
 *       lookout bench and a cairn on the north-east tip (ISLAND_LOOKOUT);
 *       spires on the rim only. v5's stone wall, the plain's boulder groups
 *       and spire clumps, the walk to nowhere and the annex are gone.
 *   Inside blocks' own groups (so blocks keeps placing and animating them):
 *     - LM_Observatory (v6): the crafted observatory at OBSERVATORY on a
 *       raised stone terrace (TERRACE: coursed wall, cap, paving, an iron
 *       railing, steps down toward the path's end); the drum, walkway, copper
 *       dome, the telescope on TELESCOPE's axis (drawn 1.5x its length, see
 *       buildObservatory), the lit door facing the path (OBSERVATORY.facing),
 *       the porch lantern, lit windows; on the terrace a star chart table at
 *       real scale (TABLE), a bench facing where the telescope looks, a
 *       lantern on a post, a stack of notebooks. Nothing else.
 *     - RopeBridge's sway group: planks with gaps, stringers, sagging hand
 *       ropes, crossed side netting, cream pennants
 *     - Airship_yours: one long ribbed envelope with tail fins, keel and
 *       rigging to the rails; a planked hull with strakes, a rub rail and lit
 *       portholes; a deck of planks converging on the bow, railings, a low
 *       aft cabin, the helm aft of the riding camera; a dressed deck (slatted
 *       crates under a tarp, hooped barrels, a chart table, rope coils, a
 *       caged lantern on a hook); rigging kept to the riding view's edges;
 *       bowsprit and bow lamps; a hull rudder; painted engine pods whose
 *       four-blade varnished propellers turn with the ship's throttle
 *     - THE AIRSHIP KIT (pass 3): airshipKit() exports this same ship at any
 *       size with a livery band; dress-harbour.ts and life.ts build every
 *       other airship from it, and blocks' empty Airship_loop group gets it
 *       here, so every airship in the world matches
 *     - caged lanterns with flame sprites (SkyFlame, one call per group) on
 *       the berth, the bounty isle, the bridge ends, the island path, the
 *       ship and the observatory porch
 *
 * REPLACES nothing any more: blocks.ts no longer builds the grey observatory,
 *   island sets, glow, bridge or ship bodies (pass-3 integration removed the
 *   hide list). The FloatingSteps are dress-lakeforest.ts's. IslandFalls
 *   is water.ts's.
 *
 * MATERIALS: one flat vertex coloured Lambert for every solid (bible 1.8's
 *   timber / stone list, DoubleSide so thin fins and sheets read from both
 *   sides), one Lambert with bent normals for cloud (bible 1.5), one lamp glow
 *   MeshBasic tagged userData.lightGlow = "lamp" (light.ts owns its level),
 *   one additive halo sprite shader (E1) whose .color light.ts levels the same
 *   way. All fogged materials keep three's stock fog chunks: light.ts's ramp
 *   and grade reach them with no work here.
 *
 * TUNING: the constants block below.
 */
import * as THREE from "three";
import type { InstallFn, ShipPose, WorldCtx, WorldModule } from "./modules";
import { BOUNTY_DEPTH, BRIDGE, ISLAND_DEPTH, ISLAND_LOOKOUT, ISLAND_PATH, ISLAND_RILLS, ISLAND_SPRING, LOOK, OBSERVATORY, PATH, PLACES, ROUTE_MARKS, SHIP, SHIP_MOORED, STEPS_TOP, TELESCOPE, TRAIL, WORLD, bridgeDeckAt } from "./layout";
import { addFootprint, addPathLine } from "./footprints";
import { railDist, trailDistFast } from "./rocks";
import { NO_REFLECT_LAYER, type LightModule } from "./light";
import { BOUNTY } from "./bounty";

// ── Tunables ────────────────────────────────────────────────────────────────

/** Spires on the island top, on the rim only (bible 1.17: the centre open, the sky the hero). */
const ISLAND_TREES = 80;
/** Cloud sea: jittered grid cell, share of cells kept, puffs per cluster. */
const SEA_CELL = 460;
const SEA_KEEP = 0.62;
/**
 * Round 1 (decision 46): the cloud bank that hides the Gate isle from the Sky
 * Island, the bridge and the bounty isle until the flight turns toward it.
 * A floating bank of cumulus over the cloud sea, a band from x0 to x1 (world
 * x) centred on z, `depth` deep in z, from `base` up to crowns that follow
 * gateBankTop(x). The flight never sees it (it lies behind or beside every
 * flight frame), and a8 and the tail look away from it. Shown only while the
 * camera is higher than `showAbove` (the rise's top, the island, the bridge,
 * the flight), so the Mirror Lake and forest frames never draw it.
 *
 * Second Loom, 2026-10-16 (5:20 to 5:44: "these huge ass clouds ... very
 * distracting"): only as big as its job. Every sight line to the Gate isle
 * (its top, its underside, the arch, the hall) from every rail frame before
 * the flight above showAbove and from the Ad Bounty's click-in, at 16:9, 1.92
 * (Lovro's window) and 2.79 (the widest review size), that terrain, the other
 * isles and the cloud layer leave open, crosses this plane at x -2,475 to
 * -1,800 and y 1,521 to 1,773, and above 1,711 only where the arch stands, x
 * -2,375 to -2,075 (from the island's south end, keys 59.5 to 61, and at 2.79
 * to 64.4). So: a low band (crowns at 1,700, 1,730 where the click-in needs
 * it) with one heap over the arch's line (1,802), each built of clusters that
 * shrink toward its ends, and a core strip inside them that no sight line
 * gets past (world-tests/v6-route.mjs N9, and every drawn face checked
 * against those sight lines, 2026-10-16). It was a wall from -2,660 to
 * -1,650 with crowns of 1,720 to 1,805 whose clusters spilled 200 past both
 * ends (drawn from -2,847 to -1,521): the left third of the frames Lovro
 * looked at from the island's path, the bridge and the board. Coloured by the
 * live key's cloud base and top (light.ts), as clouds.ts's painted clouds are,
 * so it follows the hour; it was painted for the night.
 */
export const GATE_BANK = { x0: -2480, x1: -1790, z: -3150, depth: 200, base: 1500, showAbove: 1450 } as const;
/** The arch's sight lines through the band, x0 to x1: the bank's heap, its crown at `top`. */
const BANK_ARCH = { x0: -2390, x1: -2055, top: 1802 } as const;
/**
 * The band's crown outside the heap: 1,700, and 1,730 from x -1,995 to -1,925,
 * where the arch's top crosses the band as the Ad Bounty's click-in sees it
 * on the widest screens (at 1,709).
 */
function bankLow(x: number): number {
  return 1700 + 30 * smooth(-2015, -1995, x) * (1 - smooth(-1925, -1905, x));
}
/** The bank's crown height at world x: bankLow, and 1,802 over the arch's line. */
export function gateBankTop(x: number): number {
  const heap = smooth(BANK_ARCH.x0 - 15, BANK_ARCH.x0, x) * (1 - smooth(BANK_ARCH.x1, BANK_ARCH.x1 + 15, x));
  const low = bankLow(x);
  return low + (BANK_ARCH.top - low) * heap;
}
/** Clusters in one column at x from `floor` up to `top`, each at most wMax across. */
function bankColumn(g: Geo, x: number, floor: number, top: number, wMax: number, c: number, COL: number): number {
  const GB = GATE_BANK;
  let n = 0;
  const jx = (rnd(c, 161) - 0.5) * 16;
  for (let y = floor, lv = 0; ; lv++) {
    const k = Math.min(1, (y - floor) / Math.max(1, top - floor));
    const w = wMax * (1 - 0.3 * k) * (0.85 + 0.2 * rnd(c * 13 + lv, 163));
    const crown = y + w * 0.3 >= top;
    const yy = crown ? top - w * 0.3 : y;
    const rows = crown ? [-1, 1] : [0];
    for (const r of rows) {
      const z = GB.z + r * GB.depth * 0.3 + (rnd(c * 13 + lv, 164 + r) - 0.5) * GB.depth * 0.3;
      const xx = x + jx + r * COL * 0.45;
      cloud(g, xx, yy + (rnd(c * 13 + lv, 166 + r) - 0.5) * 12, z, w, 5 + Math.floor(rnd(c * 13 + lv, 167 + r) * 2), 900 + c * 17 + lv * 3 + r, false);
      n++;
    }
    if (crown) break;
    y += w * 0.34;
  }
  return n;
}
/**
 * The bank into g (cloud() clusters and the core strip); returns the clusters.
 * Exported so a sight line check can build exactly what is drawn. The band:
 * columns across x0 to x1, clusters stacked from the base to the low crown,
 * wider low down, two rows at the crown (front and back, offset) and one below
 * it, shrinking toward the ends so the bank stops near x0 and x1. The heap:
 * narrower columns over the arch's line from the band's crown up to its own,
 * shrinking toward its sides so it stops near BANK_ARCH's x0 and x1. The core
 * strip faces the island inside the clusters, from the base to 22 under the
 * crown, so no sight line finds a gap between two puffs.
 */
export function gateBank(g: Geo): number {
  const GB = GATE_BANK;
  const H = BANK_ARCH;
  let n = 0;
  let c = 0;
  const COL = 80;
  for (let x = GB.x0; x <= GB.x1 + 1; x += COL, c++) {
    const wMax = Math.min(230, 80 + 1.5 * Math.min(x - GB.x0, GB.x1 - x));
    n += bankColumn(g, x, GB.base - rnd(c, 162) * 30, bankLow(x), wMax, c, COL);
  }
  const HCOL = 46;
  const HW = 130;
  for (let x = H.x0 + 8; x <= H.x1 - 8 + 1; x += HCOL, c++) {
    const wMax = Math.min(HW, 50 + 1.6 * Math.min(x - H.x0, H.x1 - x));
    n += bankColumn(g, x, bankLow(x) - 60, gateBankTop(x), wMax, c, HCOL);
  }
  const nrm = g.n ?? (g.n = []);
  const zc = GB.z + 20;
  const yb = GB.base + 25;
  for (let x = GB.x0 + 15; x < GB.x1 - 15; x += 10) {
    const x2 = Math.min(GB.x1 - 15, x + 10);
    const t1 = gateBankTop(x) - 22;
    const t2 = gateBankTop(x2) - 22;
    for (const q of [[x, yb], [x2, yb], [x2, t2], [x, yb], [x2, t2], [x, t1]]) {
      g.p.push(q[0], q[1], zc);
      g.c.push(P.cloudBase[0], P.cloudBase[1], P.cloudBase[2]);
      nrm.push(0, 0.42, 0.91);
    }
  }
  return n;
}
/** Envelope: centre x, centre height over the deck, half length, radii (y, z). */
const ENV = { x: -4, y: 58, len: 74, ry: 21, rz: 24 };
/** Propeller turn rate, radians per second: idle and at full throttle. */
const PROP_IDLE = 1.4;
const PROP_FULL = 9;

// ── Palette (display sRGB hex; linear on load) ──────────────────────────────

export type RGB = [number, number, number];
export type V3 = [number, number, number];
export const lin = (hex: number, k = 1): RGB => {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
};
export const P = {
  grass: lin(0x8e8a66),
  grassDry: lin(0xaa9e78),
  grassDark: lin(0x5a5e4c),
  soil: lin(0x5a4e42),
  lip: lin(0x6a604e),
  rock: lin(0x7c8392),
  rock2: lin(0x686d79),
  rock3: lin(0x545865),
  rockDeep: lin(0x464954),
  root: lin(0x4a3c30),
  moss: lin(0x5e6c4a),
  spireBase: lin(0x243029),
  spireTip: lin(0x4a5a44),
  trunk: lin(0x3a2e26),
  stone: lin(0xb4ae9e),
  stoneLight: lin(0xc6bfad),
  stoneDark: lin(0x8c8778),
  flag: lin(0xa39d8e),
  slate: lin(0x4a505e),
  copper: lin(0xb07a4c),
  copperDark: lin(0x8e5e3c),
  brass: lin(0xc89a50),
  slit: lin(0x14161e),
  brown: lin(0x6b4e3a),
  brownDark: lin(0x4a3a2e),
  greyBrown: lin(0x7d6b5a),
  cream: lin(0xe3d6ba),
  canvas: lin(0xd8ccb0),
  canvas2: lin(0xc8bb9d),
  finCanvas: lin(0xa89a7e),
  rope: lin(0xb8a07a),
  iron: lin(0x2f2d2c),
  plank: lin(0x8c7658),
  plank2: lin(0x7a664c),
  plank3: lin(0x9a8262),
  hull: lin(0x4e3e30),
  hull2: lin(0x5c4a3a),
  paper: lin(0xe9dfc8),
  paper2: lin(0xd6c8a8),
  cloudTop: lin(0xf4f2ee),
  cloudBase: lin(0x9aa0b4),
  // Pass 3 (skyharbour): the kit's varnished blades, painted engine pods, hooped barrels, the deck's lighter wood.
  varnish: lin(0xc9a878),
  varnish2: lin(0xb08c5c),
  pod: lin(0x6f7a72),
  podDark: lin(0x55605a),
  hoop: lin(0x3c3a38),
  barrel: lin(0x8a6a48),
  barrel2: lin(0x7a5c3e),
  crate: lin(0xa48a64),
  crate2: lin(0x8e7654),
  crateEdge: lin(0x5e4a36),
  // Final pass C: the caulked seams between your deck's planks.
  seam: lin(0x4a3626),
  tarp: lin(0x9c9a86),
  chart: lin(0xe8dcbc),
  moss2: lin(0x4c5a3c),
  grassGold: lin(0xb4a26a),
  grassDeep: lin(0x46553a),
};
/**
 * The island tops' grass. Final pass B (judge: the pale gold rendered as a
 * flat pale grey plain under the moon, "underwhelming"): night grass in a
 * dark olive blue green, hollows darker, moonlit crests and knolls lighter,
 * so the observatory's lit windows and the path carry the frame.
 */
const ISLE_GRASS = lin(0x5a6c58);
const ISLE_GRASS_DRY = lin(0x98a484);
const ISLE_GRASS_DARK = lin(0x34443e);
/** Unlit glow (above 1 on purpose, as blocks' G: it reads as light after tone mapping). */
export const GL = {
  lamp: [1.25, 0.58, 0.16] as RGB,
  window: [1.1, 0.58, 0.2] as RGB,
  windowDeep: [1.3, 0.56, 0.14] as RGB, // pass 3: the drum windows, deeper amber so they read as lit
  pool: [0.24, 0.12, 0.035] as RGB,
  airLamp: [1.2, 0.66, 0.24] as RGB,
  /** Pass 3: a caged lantern's glass, deep amber (the flame sprite carries the bright core). */
  glass: [0.95, 0.4, 0.09] as RGB,
};

// ── Small helpers ───────────────────────────────────────────────────────────

export const DEG = Math.PI / 180;
/** Seeded 0..1 (blocks.ts's rnd: the island's jag must match it exactly). */
export function rnd(i: number, s = 0): number {
  const v = Math.sin(i * 127.1 + s * 311.7 + 17.3) * 43758.5453;
  return v - Math.floor(v);
}
export const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Horizontal unit vector for a compass bearing (0 = -z, 90 = +x). */
export const dirOf = (b: number): [number, number] => [Math.sin(b * DEG), -Math.cos(b * DEG)];
/** Yaw that turns local +x toward a compass bearing. */
export const yawTo = (b: number) => (90 - b) * DEG;
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
/** Cheap smooth value noise, 0..1. */
export function vnoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const h = (i: number, j: number) => rnd(i * 57 + j * 131, 7);
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  return h(xi, zi) * (1 - u) * (1 - v) + h(xi + 1, zi) * u * (1 - v) + h(xi, zi + 1) * (1 - u) * v + h(xi + 1, zi + 1) * u * v;
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
/** Transform: position, scale, then yaw / pitch / roll (Y, X, Z order). */
export function T(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  return _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)).clone();
}

/**
 * Geometry soup: non-indexed triangles with a colour per vertex. Solids are
 * drawn flat shaded and double sided, so winding never matters for them.
 */
export class Geo {
  p: number[] = [];
  c: number[] = [];
  n: number[] | null = null;
  get tris(): number {
    return this.p.length / 9;
  }
  tri(a: V3, b: V3, c: V3, ka: RGB, kb: RGB = ka, kc: RGB = ka): void {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.c.push(ka[0], ka[1], ka[2], kb[0], kb[1], kb[2], kc[0], kc[1], kc[2]);
  }
  quad(a: V3, b: V3, c: V3, d: V3, k: RGB, k2?: RGB): void {
    this.tri(a, b, c, k);
    this.tri(a, c, d, k2 ?? k);
  }
  /** A unit shape (flat xyz per triangle) through matrix m, coloured by k or by k(y of the local face centre). */
  shape(s: readonly number[], m: THREE.Matrix4, k: RGB | ((cy: number, i: number, cx: number, cz: number) => RGB)): void {
    const e = m.elements;
    const t = (i: number): V3 => {
      const x = s[i];
      const y = s[i + 1];
      const z = s[i + 2];
      return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
    };
    for (let i = 0; i < s.length; i += 9) {
      const col = typeof k === "function" ? k((s[i + 1] + s[i + 4] + s[i + 7]) / 3, i / 9, (s[i] + s[i + 3] + s[i + 6]) / 3, (s[i + 2] + s[i + 5] + s[i + 8]) / 3) : k;
      this.tri(t(i), t(i + 3), t(i + 6), col);
    }
  }
  /** An n-sided prism (a beam or rope) from a to b, radius r0 at a and r1 at b. */
  beam(a: V3, b: V3, r0: number, k: RGB, n = 4, r1 = r0, caps = false): void {
    const ax = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = ax.length();
    if (len < 1e-6) return;
    ax.divideScalar(len);
    const u = Math.abs(ax.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const s1 = new THREE.Vector3().crossVectors(ax, u).normalize();
    const s2 = new THREE.Vector3().crossVectors(ax, s1).normalize();
    const ring = (o: V3, r: number): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2 + Math.PI / n;
        const cx = Math.cos(t) * r;
        const cy = Math.sin(t) * r;
        out.push([o[0] + s1.x * cx + s2.x * cy, o[1] + s1.y * cx + s2.y * cy, o[2] + s1.z * cx + s2.z * cy]);
      }
      return out;
    };
    const A = ring(a, r0);
    const B = ring(b, r1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(A[i], A[j], B[j], B[i], k);
    }
    if (caps) {
      for (let i = 1; i < n - 1; i++) {
        this.tri(A[0], A[i], A[i + 1], k);
        this.tri(B[0], B[i + 1], B[i], k);
      }
    }
  }
  /** A rope hanging from a to b, sagging `sag` at the middle, in `seg` straight pieces. */
  rope(a: V3, b: V3, sag: number, r: number, k: RGB, seg = 4, n = 3): void {
    let prev: V3 = a;
    for (let i = 1; i <= seg; i++) {
      const t = i / seg;
      const cur: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
      this.beam(prev, cur, r, k, n);
      prev = cur;
    }
  }
  build(normals = false): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    if (this.n) g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    else if (normals) g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Unit shapes (flat xyz per triangle).
function boxShape(): number[] {
  const v = (x: number, y: number, z: number) => [x - 0.5, y - 0.5, z - 0.5];
  const f = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
  return [
    ...f(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)),
    ...f(v(1, 0, 0), v(0, 0, 0), v(0, 1, 0), v(1, 1, 0)),
    ...f(v(0, 1, 1), v(1, 1, 1), v(1, 1, 0), v(0, 1, 0)),
    ...f(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)),
    ...f(v(1, 0, 1), v(1, 0, 0), v(1, 1, 0), v(1, 1, 1)),
    ...f(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)),
  ];
}
/** n-sided frustum, y 0..1, radius r0 at the base and r1 at the top (0 = a cone), with caps. */
export function prismShape(n: number, r0 = 1, r1 = 1, capTop = true, capBot = true, phase = 0): number[] {
  const out: number[] = [];
  const pt = (i: number, r: number, y: number) => {
    const t = (i / n) * Math.PI * 2 + phase;
    return [Math.cos(t) * r, y, Math.sin(t) * r];
  };
  for (let i = 0; i < n; i++) {
    const a = pt(i, r0, 0);
    const b = pt(i + 1, r0, 0);
    const c = pt(i + 1, r1, 1);
    const d = pt(i, r1, 1);
    if (r1 > 0) out.push(...a, ...b, ...c, ...a, ...c, ...d);
    else out.push(...a, ...b, 0, 1, 0);
    if (capBot) out.push(0, 0, 0, ...b, ...a);
    if (capTop && r1 > 0) out.push(0, 1, 0, ...d, ...c);
  }
  return out;
}
/** Unit hemisphere (radius 1, y >= 0), n around, `rings` from the equator to the pole. */
export function domeShape(n: number, rings: number): number[] {
  const out: number[] = [];
  const pt = (i: number, j: number) => {
    const th = (j / rings) * (Math.PI / 2);
    const ph = (i / n) * Math.PI * 2;
    return [Math.cos(th) * Math.cos(ph), Math.sin(th), Math.cos(th) * Math.sin(ph)];
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < n; i++) {
      const a = pt(i, j);
      const b = pt(i + 1, j);
      const c = pt(i + 1, j + 1);
      const d = pt(i, j + 1);
      if (j === rings - 1) out.push(...a, ...b, ...c);
      else out.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  return out;
}
export const BOX = boxShape();

// ── The islands (blocks.ts's shapes, followed exactly) ──────────────────────

const COVE_BEARING = 133;
function islandRim(theta: number): number {
  const r = WORLD.island.r;
  let d = theta / DEG - COVE_BEARING;
  d -= 360 * Math.round(d / 360);
  const cove = 100 * Math.exp(-((d / 14) ** 2));
  return r - 26 * (0.5 + 0.5 * Math.sin(3 * theta + 1.3)) - 12 * (0.5 + 0.5 * Math.sin(7 * theta + 0.4)) - cove;
}
function islandTop(x: number, z: number): number {
  const d2 = (x + 2410) ** 2 + (z + 1470) ** 2;
  return 42 * Math.exp(-d2 / (150 * 150));
}
const bountyRim = (th: number) => WORLD.bountyIsle.r - 8 * (0.5 + 0.5 * Math.sin(3 * th));
export const LOW: ReadonlyArray<readonly [number, number]> = [
  [0.04, 0.985],
  [0.12, 0.93],
  [0.26, 0.8],
  [0.44, 0.62],
  [0.62, 0.43],
  [0.8, 0.24],
  [0.93, 0.09],
];

/**
 * A floating rock, painted: a fine polar top (topH over `top`) inside rim(),
 * a soil band, and the hanging cone on blocks' floatingRock vertices exactly
 * (same rings, jag and seed), in flat strata darkening toward the tip.
 */
function floatingRock(
  g: Geo,
  cx: number,
  top: number,
  cz: number,
  depth: number,
  rim: (theta: number) => number,
  topH: (x: number, z: number) => number,
  seg: number,
  seed: number,
  grass = true,
): void {
  const RINGS_TOP = 6; // blocks' rings.length: its underside ring indices start here
  const fine = [0, 0.14, 0.28, 0.42, 0.55, 0.66, 0.76, 0.84, 0.9, 0.95, 1];
  const topPt = (i: number, f: number): V3 => {
    const th = (i / seg) * Math.PI * 2;
    const r = rim(th) * f;
    const x = cx + Math.sin(th) * r;
    const z = cz - Math.cos(th) * r;
    return [x, top + topH(x, z), z];
  };
  const topCol = (p: V3, f: number): RGB => {
    if (!grass) return mix(P.rock, P.grassDark, 0.5);
    const n = vnoise(p[0] / 70, p[2] / 70);
    const n2 = vnoise(p[0] / 23 + 40, p[2] / 23);
    // Final pass: pale gold drifts in flat values (the smooth grey-olive blend
    // read as a bare grey field by moonlight): shade hollows, the grass, dry
    // gold knolls, with narrow edges.
    let c = mix(ISLE_GRASS_DARK, ISLE_GRASS, smooth(0.36, 0.44, n));
    c = mix(c, ISLE_GRASS_DRY, smooth(0.6, 0.66, n2 * 0.7 + n * 0.3) * 0.85);
    return mix(c, P.lip, smooth(0.9, 1, f));
  };
  for (let k = 0; k < fine.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = topPt(i, fine[k]);
      const b = topPt(i + 1, fine[k]);
      const c = topPt(i + 1, fine[k + 1]);
      const d = topPt(i, fine[k + 1]);
      if (k === 0) g.tri(a, c, d, topCol(a, fine[k]), topCol(c, fine[k + 1]), topCol(d, fine[k + 1]));
      else {
        g.tri(a, b, c, topCol(a, fine[k]), topCol(b, fine[k]), topCol(c, fine[k + 1]));
        g.tri(a, c, d, topCol(a, fine[k]), topCol(c, fine[k + 1]), topCol(d, fine[k + 1]));
      }
    }
  }
  // The underside: ring 0 is the rim (blocks' rings[5] = 1), then LOW.
  const under = (k: number): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const r = rim(th);
      const s = Math.sin(th);
      const c = -Math.cos(th);
      if (k === 0) {
        const x = cx + s * r;
        const z = cz + c * r;
        out.push([x, top + topH(x, z), z]);
      } else {
        const kk = k - 1 + RINGS_TOP;
        const [dd, ff] = LOW[k - 1];
        const jag = 1 + 0.16 * (rnd(i + kk * 97, seed) - 0.5) + 0.1 * Math.sin(th * 5 + seed);
        out.push([cx + s * r * ff * jag, top - depth * dd * (1 + 0.1 * (rnd(i * 3 + kk, seed + 1) - 0.5)), cz + c * r * ff * jag]);
      }
    }
    return out;
  };
  const rings: V3[][] = [];
  for (let k = 0; k <= LOW.length; k++) rings.push(under(k));
  const band = (y: number, i: number): RGB => {
    const d = (top - y) / depth;
    if (d < 0.05) return P.soil;
    const strata = Math.floor((top - y) / 34 + 0.35 * Math.sin(i * 0.9 + seed));
    const base = strata % 3 === 0 ? P.rock : strata % 3 === 1 ? P.rock2 : P.rock3;
    return scale(mix(base, P.rockDeep, smooth(0.35, 0.95, d)), 0.92 + 0.14 * rnd(i, seed + 11));
  };
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k];
    const B = rings[k + 1];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const cy1 = (A[i][1] + A[j][1] + B[i][1]) / 3;
      const cy2 = (A[j][1] + B[j][1] + B[i][1]) / 3;
      g.tri(A[i], A[j], B[i], band(cy1, i * 2 + k * 131));
      g.tri(A[j], B[j], B[i], band(cy2, i * 2 + 1 + k * 131));
    }
  }
  const last = rings[rings.length - 1];
  const tip: V3 = [cx + 18 * (rnd(seed, 9) - 0.5), top - depth, cz + 18 * (rnd(seed, 8) - 0.5)];
  for (let i = 0; i < seg; i++) g.tri(last[i], last[(i + 1) % seg], tip, P.rockDeep);
}

/** Where blocks' underside surface is at fraction ff of the rim (for spurs and roots). */
function underY(top: number, depth: number, ff: number): number {
  for (let k = 0; k < LOW.length - 1; k++) {
    const [d0, f0] = LOW[k];
    const [d1, f1] = LOW[k + 1];
    if (ff <= f0 && ff >= f1) return top - depth * (d0 + ((f0 - ff) / (f0 - f1)) * (d1 - d0));
  }
  return top - depth * 0.9;
}

/** A jagged spur hanging from (x, y, z): 6 sides, 3 rings, to a point `len` below. */
export function spur(g: Geo, x: number, y: number, z: number, r: number, len: number, seed: number): void {
  const n = 6;
  const rings = [
    [0, 1],
    [0.3, 0.72],
    [0.62, 0.42],
  ];
  const pts = rings.map(([d, f], k) => {
    const out: V3[] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + seed;
      const j = 1 + 0.25 * (rnd(i + k * 7, seed) - 0.5);
      out.push([x + Math.cos(t) * r * f * j + (k ? (rnd(seed, k) - 0.5) * r * 0.4 : 0), y - len * d, z + Math.sin(t) * r * f * j]);
    }
    return out;
  });
  const tip: V3 = [x + (rnd(seed, 5) - 0.5) * r * 0.5, y - len, z + (rnd(seed, 6) - 0.5) * r * 0.5];
  for (let k = 0; k < pts.length - 1; k++)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const col = scale(k === 0 ? P.rock2 : P.rock3, 0.9 + 0.2 * rnd(i + k * 11, seed));
      g.quad(pts[k][i], pts[k][j], pts[k + 1][j], pts[k + 1][i], col);
    }
  const L = pts[pts.length - 1];
  for (let i = 0; i < n; i++) g.tri(L[i], L[(i + 1) % n], tip, P.rockDeep);
}

/** A dangling root: 3 segments, tapering, drifting outward from (x, y, z) along (ox, oz). */
export function hangRoot(g: Geo, x: number, y: number, z: number, ox: number, oz: number, len: number, r: number, seed: number): void {
  let prev: V3 = [x, y, z];
  let rr = r;
  for (let s = 1; s <= 3; s++) {
    const t = s / 3;
    const cur: V3 = [
      x + ox * len * 0.18 * t + (rnd(seed, s) - 0.5) * len * 0.15,
      y - len * t,
      z + oz * len * 0.18 * t + (rnd(seed, s + 5) - 0.5) * len * 0.15,
    ];
    g.beam(prev, cur, rr, P.root, 3, rr * 0.6);
    rr *= 0.6;
    prev = cur;
  }
}

/** A spire (bible T3): trunk and 4 narrow tiers, dark at the base to olive at the tips. */
export function spire(g: Geo, x: number, y: number, z: number, h: number, seed: number): void {
  const r = h * 0.2;
  const yaw = rnd(seed, 1) * Math.PI;
  const n = 6;
  g.beam([x, y - 2, z], [x, y + h * 0.3, z], r * 0.11, P.trunk, 4);
  for (let t = 0; t < 4; t++) {
    const b = y + h * (0.16 + t * 0.19);
    const th = h * (0.36 - t * 0.02);
    const tr = r * (1 - t * 0.2);
    const lo = mix(P.spireBase, P.spireTip, t * 0.18);
    const hi = mix(P.spireBase, P.spireTip, 0.45 + t * 0.17);
    const apex: V3 = [x, b + th, z];
    for (let i = 0; i < n; i++) {
      const a0 = yaw + (i / n) * Math.PI * 2;
      const a1 = yaw + ((i + 1) / n) * Math.PI * 2;
      const j0 = i % 2 ? 0.86 : 1.06;
      const j1 = (i + 1) % 2 ? 0.86 : 1.06;
      const p0: V3 = [x + Math.cos(a0) * tr * j0, b - (i % 2 ? 0 : h * 0.03), z + Math.sin(a0) * tr * j0];
      const p1: V3 = [x + Math.cos(a1) * tr * j1, b - ((i + 1) % 2 ? 0 : h * 0.03), z + Math.sin(a1) * tr * j1];
      g.tri(p0, p1, apex, lo, lo, hi);
      g.tri([x, b + th * 0.18, z], p1, p0, scale(P.spireBase, 0.7));
    }
  }
}

// ── Cloud (bible 1.5: merged hemispheres, flat bottomed, bent normals, two tone) ──

/** One cumulus cluster at (x, y, z) about w across, `puffs` domes; bottoms when seen from below. */
export function cloud(g: Geo, x: number, y: number, z: number, w: number, puffs: number, seed: number, bottoms: boolean): void {
  if (!g.n) g.n = [];
  const nrm = g.n;
  const n = 7;
  const rings = 2;
  const centre = new THREE.Vector3(x, y - w * 0.1, z);
  const tmp = new THREE.Vector3();
  const pushV = (p: V3, col: RGB, nx: number, ny: number, nz: number) => {
    g.p.push(p[0], p[1], p[2]);
    g.c.push(col[0], col[1], col[2]);
    nrm.push(nx, ny, nz);
  };
  for (let k = 0; k < puffs; k++) {
    const a = rnd(k, seed) * Math.PI * 2;
    const d = (k === 0 ? 0 : 0.2 + 0.3 * rnd(k, seed + 1)) * w;
    const r = w * (k === 0 ? 0.32 : 0.16 + 0.14 * rnd(k, seed + 2));
    const px = x + Math.cos(a) * d;
    const pz = z + Math.sin(a) * d * 0.7;
    const hy = r * (0.75 + 0.35 * rnd(k, seed + 3));
    const pt = (i: number, j: number): V3 => {
      const th = (j / rings) * (Math.PI / 2);
      const ph = (i / n) * Math.PI * 2 + seed;
      return [px + Math.cos(th) * Math.cos(ph) * r, y + Math.sin(th) * hy, pz + Math.cos(th) * Math.sin(ph) * r];
    };
    const vert = (p: V3) => {
      // Normal: the dome's own, bent halfway toward the cluster centre's.
      tmp.set((p[0] - px) / r, (p[1] - y) / hy, (p[2] - pz) / r).normalize();
      const bx = p[0] - centre.x;
      const by = p[1] - centre.y;
      const bz = p[2] - centre.z;
      const bl = Math.hypot(bx, by, bz) || 1;
      tmp.set(tmp.x + bx / bl, tmp.y + by / bl, tmp.z + bz / bl).normalize();
      const t = smooth(-0.1, 0.8, (p[1] - y) / (w * 0.35));
      pushV(p, mix(P.cloudBase, P.cloudTop, t), tmp.x, tmp.y, tmp.z);
    };
    for (let j = 0; j < rings; j++)
      for (let i = 0; i < n; i++) {
        const A = pt(i, j);
        const B = pt(i + 1, j);
        const C = pt(i + 1, j + 1);
        const D = pt(i, j + 1);
        // Outward winding: lower-left, upper-right, lower-right reversed (CCW from outside).
        vert(A);
        vert(C);
        vert(B);
        if (j < rings - 1) {
          vert(A);
          vert(D);
          vert(C);
        }
      }
    if (bottoms)
      for (let i = 0; i < n; i++) {
        const A = pt(i, 0);
        const B = pt(i + 1, 0);
        pushV([px, y, pz], P.cloudBase, 0, -1, 0);
        pushV(A, P.cloudBase, 0, -1, 0);
        pushV(B, P.cloudBase, 0, -1, 0);
      }
  }
}

// ── The observatory on its terrace (local to LM_Observatory, origin at OBSERVATORY) ──

/** The telescope on layout's TELESCOPE axis (aimed at the Creative Strategy constellation). */
const TEL = { bearing: TELESCOPE.az, el: TELESCOPE.el, pivotY: TELESCOPE.pivot[1] - OBSERVATORY.y, len: TELESCOPE.length };
/** The door faces the path's end (layout OBSERVATORY.facing). */
const DOOR_BEARING = OBSERVATORY.facing;
/**
 * The raised stone terrace (bible 1.17): the observatory's drum stands on it,
 * its steps come down toward the path's end. r its radius, h its top, the
 * steps `steps` of `rise` by `run`, `stairW` wide.
 */
export const TERRACE = { r: 50, h: 12.9, steps: 6, rise: 2.15, run: 4.4, stairW: 18 };
/** A person is 14; eye level props 1.25x (bible v5 1.9): a table top 0.43 of a person, 7.4 up. */
const TABLE = { w: 16, d: 10, h: 7.4 };
/** C3: the drum's lit windows, a saturated amber (GL.windowDeep read pale cream at a7). */
const OBS_WINDOW: RGB = [0.82, 0.17, 0.02];
/** C3: the open slit's lit inside, dimmer than the windows. */
const OBS_SLIT: RGB = [0.52, 0.12, 0.018];

/** A faceted boulder sunk into the ground at (x, y, z), a moss cap on its top. */
function boulder(g: Geo, x: number, y: number, z: number, r: number, seed: number): void {
  const n = 6 + Math.floor(rnd(seed, 401) * 3);
  const base = rnd(seed, 402) < 0.5 ? P.rock : P.rock2;
  g.shape(prismShape(n, 1, 0.5 + rnd(seed, 403) * 0.25, true, false, rnd(seed, 404) * 3), T(x, y - r * 0.3, z, r, r * (0.75 + rnd(seed, 405) * 0.5), r * (0.8 + rnd(seed, 406) * 0.4), rnd(seed, 407) * 6, (rnd(seed, 408) - 0.5) * 0.25, (rnd(seed, 409) - 0.5) * 0.25), (cy, i) =>
    cy > 0.9 ? P.moss2 : scale(cy > 0.5 ? base : P.rock3, 0.9 + 0.2 * rnd(i + seed, 410)),
  );
}

function buildObservatory(g: Geo, glow: Geo, lamps: number[], flames: number[]): void {
  const TH = TERRACE.h;
  // The terrace: a retaining wall of three coursed rings (a mossy footing, two
  // dressed courses), a pale cap course, a paved top.
  {
    const N = 28;
    const course = (y0: number, y1: number, r: number, c: number, kind: "foot" | "mid" | "cap") => {
      g.shape(prismShape(N, 1, 1, kind === "cap", false, (c % 2) * (Math.PI / N)), T(0, y0, 0, r, y1 - y0, r), (cy, i) => {
        const blk = Math.floor(i / 2) + c * 53;
        const v = rnd(blk, 5);
        if (kind === "cap") return cy > 0.9 ? scale(P.stoneLight, 0.97 + 0.06 * rnd(blk, 6)) : P.stoneLight;
        if (kind === "foot") return cy < 0.45 ? P.moss2 : scale(P.stoneDark, 0.9 + 0.12 * v);
        return scale(v < 0.3 ? P.stoneDark : v < 0.75 ? P.stone : P.stoneLight, 0.9 + 0.12 * rnd(blk, 7));
      });
    };
    course(-3, 3.2, TERRACE.r + 0.6, 0, "foot");
    course(3.2, 7.6, TERRACE.r, 1, "mid");
    course(7.6, 11.9, TERRACE.r - 0.2, 2, "mid");
    course(11.9, TH, TERRACE.r + 0.9, 3, "cap");
    // Mortar lines.
    for (const y of [3.2, 7.6]) g.shape(prismShape(N, 1, 1, false, false), T(0, y - 0.18, 0, TERRACE.r - 0.1, 0.36, TERRACE.r - 0.1), scale(P.stoneDark, 0.55));
    // Paving: pale flags in rings round the drum.
    for (let ring = 0; ring < 3; ring++) {
      const r0 = 25 + ring * 8.3;
      const n = 14 + ring * 5;
      for (let i = 0; i < n; i++) {
        const a0 = ((i + 0.06 + (ring % 2) * 0.5) / n) * Math.PI * 2;
        const a1 = ((i + 0.94 + (ring % 2) * 0.5) / n) * Math.PI * 2;
        const r1 = r0 + 7.7;
        const y = TH + 0.08;
        const k = scale(rnd(i + ring * 31, 8) < 0.5 ? P.flag : P.stone, 0.9 + 0.12 * rnd(i + ring * 31, 9));
        g.quad([Math.cos(a0) * r0, y, Math.sin(a0) * r0], [Math.cos(a1) * r0, y, Math.sin(a1) * r0], [Math.cos(a1) * r1, y, Math.sin(a1) * r1], [Math.cos(a0) * r1, y, Math.sin(a0) * r1], k);
      }
    }
  }
  // The steps down toward the path's end, with a low cheek wall each side.
  const [dx, dz] = dirOf(DOOR_BEARING);
  const [rx, rz] = dirOf(DOOR_BEARING + 90);
  {
    const ry = yawTo(DOOR_BEARING);
    for (let s = 0; s < TERRACE.steps; s++) {
      const top = TH - (s + 1) * TERRACE.rise;
      const d = TERRACE.r - 1 + (s + 0.5) * TERRACE.run;
      g.shape(BOX, T(dx * d, (top - 3) / 2, dz * d, TERRACE.run + 0.3, top + 3, TERRACE.stairW, ry), (cy) => (cy > 0.4 ? scale(P.stone, 0.95 + 0.08 * rnd(s, 12)) : P.stoneDark));
    }
    const len = TERRACE.steps * TERRACE.run;
    for (const sg of [-1, 1]) {
      const cx = dx * (TERRACE.r - 1 + len / 2) + rx * sg * (TERRACE.stairW / 2 + 1.4);
      const cz = dz * (TERRACE.r - 1 + len / 2) + rz * sg * (TERRACE.stairW / 2 + 1.4);
      // A sloping cheek: two boxes stepping down.
      g.shape(BOX, T(cx - dx * len * 0.25, TH * 0.62, cz - dz * len * 0.25, len * 0.5, TH * 0.95 + 3, 2.8, ry), (cy) => (cy > 0.4 ? P.stoneLight : P.stone));
      g.shape(BOX, T(cx + dx * len * 0.25, TH * 0.25, cz + dz * len * 0.25, len * 0.5, TH * 0.5 + 3, 2.8, ry), (cy) => (cy > 0.4 ? P.stoneLight : P.stone));
    }
  }
  // An iron railing round the terrace's edge, open at the steps.
  {
    const N = 36;
    const gap = ((TERRACE.stairW / 2 + 2) / TERRACE.r) * 1.05;
    const doorPhi = Math.atan2(dz, dx);
    const inGap = (t: number) => {
      let d = t - doorPhi;
      d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
      return Math.abs(d) < gap;
    };
    const R = TERRACE.r - 1.4;
    for (let i = 0; i < N; i++) {
      const t0 = (i / N) * Math.PI * 2;
      const t1 = ((i + 1) / N) * Math.PI * 2;
      if (inGap(t0) || inGap(t1)) continue;
      const p0: V3 = [Math.cos(t0) * R, TH, Math.sin(t0) * R];
      const p1: V3 = [Math.cos(t1) * R, TH, Math.sin(t1) * R];
      g.beam(p0, [p0[0], TH + 6, p0[2]], 0.3, P.iron, 4);
      g.beam([p0[0], TH + 6, p0[2]], [p1[0], TH + 6, p1[2]], 0.32, P.iron, 4);
      g.beam([p0[0], TH + 3.2, p0[2]], [p1[0], TH + 3.2, p1[2]], 0.18, P.iron, 3);
    }
  }
  // The drum: seven courses of dressed stone on the terrace, staggered joints.
  for (let c = 1; c < 8; c++) {
    const ring = prismShape(20, 1, 1, false, false, (c % 2) * (Math.PI / 20));
    const rr = 24 - (c % 2) * 0.22;
    g.shape(ring, T(0, 7.6 + c * 5.3, 0, rr, 5.3, rr), (cy, i) => {
      const blk = Math.floor(i / 2) + c * 37;
      const v = rnd(blk, 3);
      const base = c === 1 ? (cy < 0.4 ? P.moss2 : P.stoneDark) : v < 0.3 ? P.stoneDark : v < 0.7 ? P.stone : P.stoneLight;
      return scale(base, 0.9 + 0.14 * rnd(blk, 4));
    });
    if (c > 1) g.shape(prismShape(20, 1, 1, false, false), T(0, 7.6 + c * 5.3 - 0.2, 0, 23.9, 0.4, 23.9), scale(P.stoneDark, 0.6));
  }
  g.shape(prismShape(20, 1, 1, false, false), T(0, 44.6, 0, 24.5, 1.2, 24.5), P.stoneLight);
  g.shape(prismShape(16, 1, 1, true, true), T(0, 47.5, 0, 27, 2.6, 27), P.stoneDark);
  // Walkway railing on the cornice.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const b = ((i + 1) / 16) * Math.PI * 2;
    const p0: V3 = [Math.cos(a) * 26.2, 50.1, Math.sin(a) * 26.2];
    const p1: V3 = [Math.cos(b) * 26.2, 50.1, Math.sin(b) * 26.2];
    g.beam(p0, [p0[0], 55, p0[2]], 0.45, P.iron, 4);
    g.beam([p0[0], 55, p0[2]], [p1[0], 55, p1[2]], 0.4, P.iron, 4);
  }
  // The copper dome, brass ribs, the slit toward the telescope.
  const ribs = 16;
  const dome = domeShape(ribs, 6);
  const tb = TEL.bearing;
  const slitPhi = Math.atan2(dirOf(tb)[1], dirOf(tb)[0]);
  g.shape(dome, T(0, 50.1, 0, 25.5, 25.5, 25.5), (cy, _i, cx, cz) => {
    const phi = (Math.atan2(cz, cx) + Math.PI * 2) % (Math.PI * 2);
    const col = Math.floor((phi / (Math.PI * 2)) * ribs);
    let d = phi - slitPhi;
    d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
    if (Math.abs(d) < 0.22 && cy > 0.05) return P.slit;
    return col % 2 ? P.copper : P.copperDark;
  });
  for (let i = 0; i < ribs; i++) {
    const ph = (i / ribs) * Math.PI * 2;
    // C3: no rib across the open slit (it runs through the aim's meridian and over the top).
    let ds = ph - slitPhi;
    ds -= Math.PI * Math.round(ds / Math.PI);
    if (Math.abs(ds) < 0.3) continue;
    let prev: V3 = [Math.cos(ph) * 25.9, 50.1, Math.sin(ph) * 25.9];
    for (let j = 1; j <= 5; j++) {
      const th = (j / 6) * (Math.PI / 2);
      const cur: V3 = [Math.cos(th) * Math.cos(ph) * 25.9, 50.1 + Math.sin(th) * 25.9, Math.cos(th) * Math.sin(ph) * 25.9];
      g.beam(prev, cur, 0.5, P.brass, 3);
      prev = cur;
    }
  }
  // C3 (judge 1, fix 7): the slit OPEN, from the aim's horizon over the top
  // and 60 degrees down the other side, lit warm from inside, so the dome
  // reads open from any side; brass rails on both edges. p(al, be): al 0 at
  // the aim's horizon, 90 at the top; be the offset across the slit.
  {
    const R = 25.5;
    const aimH = dirOf(tb);
    const nH = dirOf(tb + 90);
    const at3 = (al: number, be: number, rr: number): V3 => {
      const ca = Math.cos(al) * Math.cos(be);
      const sb = Math.sin(be);
      return [(aimH[0] * ca + nH[0] * sb) * rr, 50.1 + Math.sin(al) * Math.cos(be) * rr, (aimH[1] * ca + nH[1] * sb) * rr];
    };
    const W = 0.19;
    const A1 = 150 * DEG;
    const N = 14;
    // C3 round 2 (judge 2, fix 3): the slit is a dark recess with a thin warm
    // rim of lamplight down its two inner edges, so it reads as an opening
    // with light inside (a flat orange strip read as a plank). Per vertex
    // colours: each edge band fades from OBS_SLIT at the jamb to the dark.
    const dark: RGB = [0.012, 0.011, 0.016];
    const rimB = W * 0.36;
    const strip = (a0: number, a1: number, b0: number, b1: number, k0: RGB, k1: RGB, rr: number) => {
      const A = at3(a0, b0, rr);
      const B = at3(a1, b0, rr);
      const C = at3(a1, b1, rr);
      const D = at3(a0, b1, rr);
      glow.tri(A, B, C, k0, k0, k1);
      glow.tri(A, C, D, k0, k1, k1);
    };
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * A1;
      const a1 = ((k + 1) / N) * A1;
      // 1.3 proud of the sphere: the faceted dome's flats sit inside it and a thinner gap z-fights at a7's range.
      strip(a0, a1, -W, -W + rimB, OBS_SLIT, dark, R + 1.3);
      strip(a0, a1, -W + rimB, W - rimB, dark, dark, R + 1.3);
      strip(a0, a1, W - rimB, W, dark, OBS_SLIT, R + 1.3);
      for (const sg of [-1, 1]) g.beam(at3(a0, sg * (W + 0.02), R + 1.5), at3(a1, sg * (W + 0.02), R + 1.5), 0.8, P.brass, 4);
    }
  }
  // The telescope on TELESCOPE's exact axis: brass tube, rings, a wider objective, an iron mount.
  const [tdx, tdz] = dirOf(tb);
  const el = TEL.el * DEG;
  const piv: V3 = [0, TEL.pivotY, 0];
  const at = (s: number): V3 => [tdx * Math.cos(el) * s, TEL.pivotY + Math.sin(el) * s, tdz * Math.cos(el) * s];
  // At least 63 long: the a7 camera looks along its aim (az 300) from behind
  // the dome, and TELESCOPE.length's 42 never clears it (B8 report: A1 to set
  // the data's length to match, so the park's fly-through leaves the objective).
  // C3 round 2 (judge 2, fix 3): 68, the longest that keeps the park's
  // fly-through (scene.ts TEL_PARK_PATH, about 8.7 over the axis there) clear
  // of the objective ring; the ring bright brass (it was iron and vanished).
  const len = Math.max(TEL.len, 68);
  g.beam(at(-7), at(len), 4.6, P.brass, 8, 5.8);
  for (const s of [0.25, 0.5, 0.75]) g.beam(at(len * s - 1), at(len * s + 1), 6 + s * 0.8, P.copperDark, 8);
  g.beam(at(len - 1.4), at(len + 2.4), 7.2, scale(P.brass, 1.45), 10);
  g.beam(at(len - 2.2), at(len - 1.4), 6.5, P.iron, 10);
  // A finder scope beside the tube (to the side, clear of the park's path over
  // the top): from behind, a second small tube is what says "telescope".
  {
    const [sx, sz] = dirOf(tb + 90);
    const off = (s: number, o: number): V3 => {
      const p = at(s);
      return [p[0] + sx * o, p[1], p[2] + sz * o];
    };
    g.beam(off(len * 0.52, 9.2), off(len * 0.88, 9.2), 1.5, P.brass, 6, 1.9);
    g.beam(off(len * 0.88 - 0.4, 9.2), off(len * 0.88 + 1.2, 9.2), 2.3, scale(P.brass, 1.45), 6);
    for (const s of [0.6, 0.8]) g.beam(off(len * s, 4.8), off(len * s, 8), 0.5, P.iron, 4);
  }
  g.beam(at(-9), at(-6), 2.2, P.iron, 6);
  g.beam([piv[0], piv[1] - 8, piv[2]], [piv[0], piv[1] + 1, piv[2]], 3, P.iron, 6);
  // The door: stone surround on the terrace, a lit opening, its light on the paving and the steps.
  const dr = 24.2;
  const doorC: V3 = [dx * dr, TH, dz * dr];
  g.shape(BOX, T(doorC[0] + dx * 0.9, TH + 11, doorC[2] + dz * 0.9, 2.2, 22, 14, yawTo(DOOR_BEARING)), P.stoneDark);
  glow.shape(BOX, T(doorC[0] + dx * 1.5, TH + 9.2, doorC[2] + dz * 1.5, 1.4, 17.6, 9.2, yawTo(DOOR_BEARING)), OBS_WINDOW);
  {
    const dim: RGB = [0.015, 0.009, 0.004];
    const band = (d: number, w: number, y: number, k0: RGB, k1: RGB, d2: number) => {
      glow.quad([dx * d + rx * w, y, dz * d + rz * w], [dx * d - rx * w, y, dz * d - rz * w], [dx * d2 - rx * w, y, dz * d2 - rz * w], [dx * d2 + rx * w, y, dz * d2 + rz * w], k0, k1);
    };
    band(25.2, 6, TH + 0.14, GL.pool, scale(GL.pool, 0.6), TERRACE.r - 1.5);
    for (let s = 0; s < TERRACE.steps; s++) {
      const d = TERRACE.r - 1 + (s + 0.5) * TERRACE.run;
      const k = scale(GL.pool, 0.5 - s * 0.07);
      band(d - TERRACE.run / 2, 7, TH - (s + 1) * TERRACE.rise + 0.06, k, k, d + TERRACE.run / 2);
    }
    void dim;
  }
  lamps.push(doorC[0] + dx * 4, TH + 15, doorC[2] + dz * 4, 26);
  // The porch: two timber posts, a slate lean-to over the door, a caged lantern by it.
  {
    const post = (sg: number): V3 => [doorC[0] + dx * 7.5 + rx * sg * 7.5, TH, doorC[2] + dz * 7.5 + rz * sg * 7.5];
    for (const sg of [-1, 1]) {
      const b = post(sg);
      g.beam(b, [b[0], TH + 17.4, b[2]], 0.6, P.brown, 4);
      g.beam([b[0], TH + 17.4, b[2]], [doorC[0] + dx * 0.5 + rx * sg * 7.5, TH + 19.8, doorC[2] + dz * 0.5 + rz * sg * 7.5], 0.45, P.brownDark, 4);
    }
    const w0: V3 = [doorC[0] + dx * 0.4 - rx * 9, TH + 20.6, doorC[2] + dz * 0.4 - rz * 9];
    const w1: V3 = [doorC[0] + dx * 0.4 + rx * 9, TH + 20.6, doorC[2] + dz * 0.4 + rz * 9];
    const e1: V3 = [doorC[0] + dx * 9 + rx * 9, TH + 17.8, doorC[2] + dz * 9 + rz * 9];
    const e0: V3 = [doorC[0] + dx * 9 - rx * 9, TH + 17.8, doorC[2] + dz * 9 - rz * 9];
    g.quad(w0, w1, e1, e0, P.slate, scale(P.slate, 0.9));
    g.beam(e0, e1, 0.5, P.brownDark, 4);
    g.beam([doorC[0] + dx * 5 + rx * 6, TH + 16.8, doorC[2] + dz * 5 + rz * 6], [doorC[0] + dx * 5 + rx * 6, TH + 15.4, doorC[2] + dz * 5 + rz * 6], 0.1, P.iron, 3);
    cagedLantern(g, glow, flames, lamps, doorC[0] + dx * 5 + rx * 6, TH + 13.6, doorC[2] + dz * 5 + rz * 6, 1, 20);
    // Final run: the open door's light on the threshold and the paving out to
    // the steps, so the lit door reads from the a7 frame (which sees the drum side on).
    lamps.push(doorC[0] + dx * 2, TH + 5, doorC[2] + dz * 2, 22);
    lamps.push(doorC[0] + dx * 12, TH + 1.5, doorC[2] + dz * 12, 15);
    lamps.push(doorC[0] + dx * 21, TH - 1.5, doorC[2] + dz * 21, 10);
  }
  // Tall arched windows round the drum, lit.
  for (const b of [96, 176, 60, 18, 250, 140]) {
    if (Math.abs(((b - DOOR_BEARING + 540) % 360) - 180) < 20) continue;
    const [wx, wz] = dirOf(b);
    // C3: taller, a deeper amber (a saturated glow stays warm through the grade), a bigger halo.
    glow.shape(BOX, T(wx * 24.3, 35, wz * 24.3, 1.2, 13, 4, yawTo(b)), OBS_WINDOW);
    g.shape(BOX, T(wx * 24.4, 42.2, wz * 24.4, 1.6, 1.4, 5.6, yawTo(b)), P.stoneDark);
    g.shape(BOX, T(wx * 24.4, 28.2, wz * 24.4, 1.8, 1.2, 5.8, yawTo(b)), P.stoneDark);
    lamps.push(wx * 26.5, 35, wz * 26.5, 19);
  }
  // On the terrace, beside the door on the path's side: the star chart table
  // at real scale, a bench facing where the telescope looks, a lantern on a
  // post, a stack of notebooks. Nothing else (bible 1.17).
  {
    // Final run: under the telescope's side of the terrace (its azimuth), the
    // side the a7 camera sees left of the drum; at DOOR_BEARING + 40 the drum hid it.
    const tb2 = TEL.bearing;
    const [ux, uz] = dirOf(tb2);
    const tx = ux * 37;
    const tz = uz * 37;
    const [ax, az] = dirOf(tb2 + 90); // along the table's long side (tangent to the terrace)
    const ry = yawTo(tb2 + 90);
    const y0 = TH;
    // Top, apron, four legs.
    g.shape(BOX, T(tx, y0 + TABLE.h - 0.4, tz, TABLE.w, 0.8, TABLE.d, ry), P.brown);
    g.shape(BOX, T(tx, y0 + TABLE.h - 1.4, tz, TABLE.w - 1.6, 1.2, TABLE.d - 1.6, ry), P.brownDark);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.shape(BOX, T(tx + ax * a * (TABLE.w / 2 - 1) + ux * b * (TABLE.d / 2 - 1), y0 + (TABLE.h - 0.8) / 2, tz + az * a * (TABLE.w / 2 - 1) + uz * b * (TABLE.d / 2 - 1), 0.8, TABLE.h - 0.8, 0.8, ry), P.brownDark);
    // The star charts: two pinned sheets and one rolled, weighed by stones; a brass sextant.
    const topY = y0 + TABLE.h + 0.02;
    g.shape(BOX, T(tx - ax * 3, topY, tz - az * 3, 7.4, 0.06, 5.6, ry + 0.08), P.chart);
    g.shape(BOX, T(tx + ax * 3.6 + ux * 1.2, topY + 0.05, tz + az * 3.6 + uz * 1.2, 5.4, 0.06, 4.2, ry - 0.2), P.paper2);
    g.beam([tx - ax * 6.5 - ux * 3.4, topY + 0.6, tz - az * 6.5 - uz * 3.4], [tx + ax * 0.5 - ux * 3.4, topY + 0.6, tz + az * 0.5 - uz * 3.4], 0.6, P.paper, 6);
    for (const [a, b] of [[-6.4, 2.4], [0.4, -2.4], [5.8, 1.8]]) boulder(g, tx + ax * a + ux * b, topY + 0.35, tz + az * a + uz * b, 0.55, 90 + a);
    g.shape(prismShape(3, 1, 0, true, true), T(tx + ax * 5.4 - ux * 2.2, topY, tz + az * 5.4 - uz * 2.2, 1.1, 1.3, 1.1), P.brass);
    // The notebooks: four, stacked askew at the table's corner.
    const books = [P.brownDark, lin(0x3f5566), lin(0x7a3e32), lin(0x5b6a44)];
    for (let i = 0; i < 4; i++) g.shape(BOX, T(tx + ax * 6 + ux * 3, topY + 0.35 + i * 0.62, tz + az * 6 + uz * 3, 3.2, 0.58, 2.4, ry + (rnd(i, 13) - 0.5) * 0.5), books[i]);
    // A lantern on an iron post by the table's end.
    const lx = tx + ax * (TABLE.w / 2 + 3.5);
    const lz = tz + az * (TABLE.w / 2 + 3.5);
    g.beam([lx, y0, lz], [lx, y0 + 9, lz], 0.35, P.iron, 4);
    g.beam([lx, y0 + 9, lz], [lx - ux * 2.4, y0 + 9, lz - uz * 2.4], 0.25, P.iron, 3);
    cagedLantern(g, glow, flames, lamps, lx - ux * 2.4, y0 + 7.4, lz - uz * 2.4, 0.9, 10);
    // C3 round 2: an oil lamp lit on the chart (someone is working), and a
    // crate of lenses by the door, the round glass catching the sky.
    {
      const ox = tx + ax * 1.2 - ux * 2.6;
      const oz = tz + az * 1.2 - uz * 2.6;
      g.shape(prismShape(8, 1, 0.7, true, false), T(ox, topY, oz, 0.9, 0.5, 0.9), P.brass);
      glow.shape(prismShape(8, 0.8, 0.55, true, true), T(ox, topY + 0.5, oz, 0.62, 1.3, 0.62), GL.glass);
      flames.push(ox, topY + 1.1, oz, 1.9);
      lamps.push(ox, topY + 1.1, oz, 8);
      const cr = DOOR_BEARING - 24;
      const [cx0, cz0] = dirOf(cr);
      const cx = cx0 * 31;
      const cz = cz0 * 31;
      const cry = yawTo(cr) + 0.3;
      crate(g, cx, y0, cz, 3.6, cry, 7);
      const lensK: RGB = [0.16, 0.22, 0.3];
      for (let i = 0; i < 4; i++) {
        const a = cry + (i - 1.5) * 0.5;
        const lx2 = cx + Math.cos(a) * 0.7 * (i % 2 ? 1 : -1);
        const lz2 = cz - Math.sin(a) * 0.7 * (i % 2 ? 1 : -1);
        glow.shape(prismShape(10, 1, 1, true, true), T(lx2, y0 + 3.7 + (i % 2) * 0.2, lz2, 1.05 - i * 0.1, 0.12, 1.05 - i * 0.1, a, 1.1 + 0.2 * rnd(i, 21), 0), lensK);
      }
    }
    // The bench: on the terrace's far side from the door, facing where the telescope looks.
    const bb = DOOR_BEARING - 62;
    const [bx0, bz0] = dirOf(bb);
    const bx = bx0 * 38;
    const bz = bz0 * 38;
    const face = TEL.bearing;
    const [fx, fz] = dirOf(face);
    const [sx, sz] = dirOf(face + 90);
    const bry = yawTo(face + 90);
    g.shape(BOX, T(bx, y0 + 4.4, bz, 14, 0.7, 4, bry), P.plank);
    g.shape(BOX, T(bx - fx * 1.8, y0 + 7.6, bz - fz * 1.8, 14, 2.2, 0.6, bry), P.plank2);
    for (const s of [-1, 1]) {
      g.shape(BOX, T(bx + sx * s * 5.8, y0 + 2.1, bz + sz * s * 5.8, 0.8, 4.2, 3.6, bry), P.iron);
      g.beam([bx + sx * s * 5.8 - fx * 1.8, y0 + 4.4, bz + sz * s * 5.8 - fz * 1.8], [bx + sx * s * 5.8 - fx * 1.9, y0 + 8.6, bz + sz * s * 5.8 - fz * 1.9], 0.3, P.iron, 4);
    }
  }
}

// ── Pass 3 props: one family for the ship, the berth and the islands ────────

/**
 * A caged lantern (bible P11): an iron foot, four corner bars and a bar down
 * each face, bands, a peaked cap and a ring; a deep amber glass core. The
 * bright flame is a sprite (flames: x, y, z, size), the halo an E1 sprite.
 */
export function cagedLantern(g: Geo, glow: Geo, flames: number[], halos: number[], x: number, y: number, z: number, s = 1, halo = 9): void {
  const w = 1.8 * s;
  const h = 2.6 * s;
  g.shape(BOX, T(x, y - h / 2 - 0.2 * s, z, w + 0.5 * s, 0.4 * s, w + 0.5 * s), P.iron);
  g.shape(BOX, T(x, y + h / 2 + 0.12 * s, z, w + 0.35 * s, 0.26 * s, w + 0.35 * s), P.iron);
  for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.shape(BOX, T(x + (cx * w) / 2, y, z + (cz * w) / 2, 0.26 * s, h, 0.26 * s), P.iron);
  for (const [cx, cz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) g.shape(BOX, T(x + (cx * w) / 2, y, z + (cz * w) / 2, 0.14 * s, h, 0.14 * s), P.iron);
  g.shape(prismShape(4, 1, 0, false, true, Math.PI / 4), T(x, y + h / 2 + 0.25 * s, z, w * 0.82, 1.2 * s, w * 0.82), P.iron);
  g.beam([x, y + h / 2 + 1.3 * s, z], [x, y + h / 2 + 2.1 * s, z], 0.16 * s, P.iron, 3);
  glow.shape(BOX, T(x, y - 0.05 * s, z, w * 0.8, h * 0.88, w * 0.8), GL.glass);
  flames.push(x, y - 0.1 * s, z, 2.8 * s);
  halos.push(x, y, z, halo);
}

/** A barrel with three iron hoops, standing on (x, y, z); `s` = 1 is 5.2 tall. */
function barrel(g: Geo, x: number, y: number, z: number, s = 1, seed = 0, hoop: RGB = P.hoop): void {
  const col = rnd(seed, 301) < 0.5 ? P.barrel : P.barrel2;
  const r = 2.2 * s;
  g.shape(prismShape(9, 0.86, 1, false, true, seed), T(x, y, z, r, 2.6 * s, r), col);
  g.shape(prismShape(9, 1, 0.86, true, false, seed), T(x, y + 2.6 * s, z, r, 2.6 * s, r), scale(col, 1.08));
  for (const [hy, k] of [[0.55, 0.93], [2.35, 1.02], [4.4, 0.93]] as const) g.shape(prismShape(9, 1, 1, false, false, seed), T(x, y + hy * s, z, r * k, 0.45 * s, r * k), hoop);
}

/** A slatted crate on (x, y, z): pale boards, dark corner battens and gaps between the boards. */
function crate(g: Geo, x: number, y: number, z: number, size: number, ry: number, seed = 0, fit?: RGB): void {
  const col = rnd(seed, 311) < 0.5 ? P.crate : P.crate2;
  g.shape(BOX, T(x, y + size / 2, z, size * 0.94, size * 0.94, size * 0.94, ry), (cy) => scale(col, cy > 0.45 ? 1.1 : 0.95 + 0.1 * rnd(seed, 312)));
  for (const f of [0.34, 0.66]) g.shape(BOX, T(x, y + size * f, z, size * 0.955, size * 0.05, size * 0.955, ry), P.crateEdge);
  const [cx, cz] = [Math.cos(ry), -Math.sin(ry)];
  const [sx, sz] = [Math.sin(ry), Math.cos(ry)];
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const ox = ((a * cx + b * sx) * size * 0.47);
    const oz = ((a * cz + b * sz) * size * 0.47);
    g.shape(BOX, T(x + ox, y + size / 2, z + oz, size * 0.12, size, size * 0.12, ry), P.crateEdge);
    // Final pass C: brass corner caps (your ship's cargo).
    if (fit) g.shape(BOX, T(x + ox, y + size * 0.985, z + oz, size * 0.17, size * 0.07, size * 0.17, ry), fit);
  }
}

/** A coiled rope lying on (x, y, z): three turns and a dark centre. */
function ropeCoil(g: Geo, x: number, y: number, z: number, r: number): void {
  for (let k = 0; k < 3; k++) g.shape(prismShape(10, 1, 0.9, true, false, k * 0.3), T(x, y + k * 0.55, z, r * (1 - k * 0.12), 0.6, r * (1 - k * 0.12)), k % 2 ? scale(P.rope, 0.86) : P.rope);
  g.shape(prismShape(8, 1, 1, true, false), T(x, y + 1.66, z, r * 0.36, 0.05, r * 0.36), P.brownDark);
}

/** The ship's wheel on its pedestal, facing local +x (the helmsman stands aft of it), `s` times its full size about its foot. */
function shipWheel(g: Geo, x: number, y: number, z: number, s = 1): void {
  g.shape(BOX, T(x - 0.8 * s, y + 3.2 * s, z, 2.2 * s, 6.4 * s, 2.6 * s), P.brown);
  g.shape(BOX, T(x - 0.8 * s, y + 6.6 * s, z, 2.8 * s, 0.5 * s, 3.2 * s), P.brownDark);
  const cy = y + 9.2 * s;
  const R = 3.6 * s;
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    g.beam([x + 0.6 * s, cy + Math.cos(a0) * R, z + Math.sin(a0) * R], [x + 0.6 * s, cy + Math.cos(a1) * R, z + Math.sin(a1) * R], 0.38 * s, P.varnish2, 4);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    g.beam([x + 0.6 * s, cy, z], [x + 0.6 * s, cy + Math.cos(a) * (R + 1.3 * s), z + Math.sin(a) * (R + 1.3 * s)], 0.22 * s, P.varnish, 4, 0.3 * s);
  }
  g.shape(prismShape(8, 1, 1, true, true), T(x + 1.4 * s, cy, z, 0.9 * s, 1.6 * s, 0.9 * s, 0, 0, Math.PI / 2), P.brass);
}

/** A chart table: planked top, four legs, a pale chart askew, a brass sextant, a book. */
function chartTable(g: Geo, x: number, y: number, z: number, ry: number): void {
  const [ax, az] = [Math.cos(ry), -Math.sin(ry)];
  const [bx, bz] = [Math.sin(ry), Math.cos(ry)];
  g.shape(BOX, T(x, y + 5.2, z, 7.6, 0.5, 5.2, ry), P.plank3);
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.shape(BOX, T(x + ax * a * 3.2 + bx * b * 2.1, y + 2.5, z + az * a * 3.2 + bz * b * 2.1, 0.5, 5, 0.5, ry), P.brownDark);
  g.shape(BOX, T(x, y + 5.5, z, 6.2, 0.1, 4.2, ry + 0.12), P.chart);
  g.shape(BOX, T(x + ax * 1.4 + bx * 0.6, y + 5.58, z + az * 1.4 + bz * 0.6, 2.6, 0.08, 2, ry - 0.3), P.paper2);
  g.shape(prismShape(3, 1, 0, true, true), T(x - ax * 2.2, y + 5.6, z - az * 2.2, 0.9, 1.2, 0.9), P.brass);
  g.shape(BOX, T(x + ax * 2.6 - bx * 1.2, y + 5.75, z + az * 2.6 - bz * 1.2, 1.6, 0.5, 1.2, ry + 0.4), P.slate);
}

/** The bounty notices' wax seals, and the seal at the heart of the gable's brass. */
const SEAL = lin(0x8e3b2f);

/**
 * The Ad Bounty's board (plan item 18, bounty.ts): the landmark of the
 * bounty checkpoint, at BOUNTY on the isle's top, its face toward the
 * bridge's end. A two-step stone footing; two posts carrying a framed board
 * under a gable roof whose triangle faces the bridge, with a brass seal on it
 * (a ring, a darker disc, red wax in the middle); bounty notices pinned in
 * rows round a bigger one in the middle, some sealed in red wax, some with a
 * brass reward band, one hanging by a corner; a caged lantern on an iron arm
 * off each post (their glass in `glow`, the lamp tagged one); a writing stand
 * with the sign-up ledger, an inkwell and a quill; a bench facing the board.
 * About 30 units tall to the ridge (a person is 14).
 */
function buildBountyBoard(g: Geo, glow: Geo, flames: number[], halos: number[]): void {
  const [fx, fz] = dirOf(BOUNTY.facing);
  const [rx, rz] = dirOf(BOUNTY.facing - 90);
  const y0 = BOUNTY.y;
  /** World point at f out of the face, s to the right seen from the front, h over the isle. */
  const at = (f: number, s: number, h: number): V3 => [BOUNTY.x + fx * f + rx * s, y0 + h, BOUNTY.z + fz * f + rz * s];
  /** A box's local x along s, its local z along f. */
  const ry = yawTo(BOUNTY.facing - 90);
  const box = (f: number, s: number, h: number, ws: number, hy: number, df: number, col: RGB | ((cy: number) => RGB), tilt = 0, lean = 0) => {
    const p = at(f, s, h);
    g.shape(BOX, T(p[0], p[1], p[2], ws, hy, df, ry, lean, tilt), col);
  };
  // The stone footing: two steps.
  box(3.5, 0, 0.55, 34, 1.1, 15, (cy) => (cy > 0.45 ? P.stoneLight : P.stoneDark));
  box(1.2, 0, 1.55, 30.5, 0.9, 9, (cy) => (cy > 0.45 ? P.stone : P.stoneDark));
  const base = 2;
  // The posts, up under the eaves.
  const POST_S = 14.2;
  const eave = 24.6;
  const ridge = 33;
  for (const s of [-POST_S, POST_S]) {
    box(0, s, base + (eave + 0.6 - base) / 2, 2.4, eave + 0.6 - base, 2.4, P.brown);
    box(0, s, base + 0.6, 3.1, 1.2, 3.1, P.brownDark);
  }
  // The board and its frame.
  box(-0.3, 0, 16.1, 26.2, 15, 0.9, P.greyBrown);
  box(0.1, 0, 23.9, 28.6, 1.1, 1.7, P.brownDark);
  box(0.1, 0, 8.2, 28.6, 1.1, 1.7, P.brownDark);
  // The roof: a gable whose triangle faces the bridge, slate shingles in rows.
  const span = POST_S + 1.6;
  const slope = Math.atan2(ridge - eave, span);
  const len = Math.hypot(span, ridge - eave);
  const rows = 4;
  for (const side of [-1, 1]) {
    for (let r = 0; r < rows; r++) {
      const u = (r + 0.5) / rows;
      const s = side * span * (1 - u);
      const h = eave + (ridge - eave) * u + 0.45;
      box(0.4, s, h, len / rows + 0.5, 0.8, 9.2, r % 2 ? P.slate : scale(P.slate, 0.86), side * -slope);
    }
  }
  g.beam(at(-4.4, 0, ridge + 0.9), at(5.2, 0, ridge + 0.9), 0.75, P.brownDark, 4);
  // The gable's boards, and the brass seal on them.
  const boards = 9;
  for (let i = 0; i < boards; i++) {
    const s0 = -span + (2 * span * i) / boards;
    const s1 = -span + (2 * span * (i + 1)) / boards;
    const mid = (s0 + s1) / 2;
    const h = (ridge - eave) * (1 - Math.abs(mid) / (span + 0.5));
    box(3.7, mid, eave + h / 2, s1 - s0 - 0.12, h, 0.5, i % 2 ? P.brown : P.brownDark);
  }
  {
    const disc = (r: number, t: number, col: RGB, ahead: number) => {
      const q = at(4.05 + ahead, 0, 28.6);
      g.shape(prismShape(12, 1, 1, true, true, Math.PI / 12), T(q[0], q[1], q[2], r, t, r, ry, Math.PI / 2), col);
    };
    disc(3.1, 0.5, P.brass, 0);
    disc(2.25, 0.7, P.copperDark, 0.15);
    disc(1.05, 0.9, SEAL, 0.3);
  }
  // Lanterns on iron arms off the posts, hanging in front of the board.
  for (const s of [-POST_S, POST_S]) {
    g.beam(at(1.2, s, 21.6), at(4.6, s, 21.6), 0.38, P.iron, 4);
    g.beam(at(4.4, s, 21.6), at(4.4, s, 20.6), 0.12, P.iron, 3);
    const l = at(4.4, s, 18.4);
    cagedLantern(g, glow, flames, halos, l[0], l[1], l[2], 1.05, 12);
  }
  // The notices: rows round a bigger one in the middle (the lesson's brief).
  box(0.3, 0, 16.6, 6.6, 7.8, 0.22, P.paper);
  box(0.42, 0, 19.7, 6.6, 1.1, 0.12, P.brass);
  box(0.5, 0, 14.0, 1.3, 1.3, 0.3, SEAL);
  const cols = [-10.4, -5.9, 5.9, 10.4];
  const rowY = [20.4, 16.0, 11.6];
  let n = 0;
  for (const yy of rowY) {
    for (const s of cols) {
      const k = n++;
      const w = 3.5 + rnd(k, 701) * 0.9;
      const h = 3.7 + rnd(k, 702) * 0.9;
      const tilt = k === 9 ? 0.55 : (rnd(k, 703) - 0.5) * 0.2;
      const ss = s + (rnd(k, 704) - 0.5) * 0.8;
      const hh = yy + (rnd(k, 705) - 0.5) * 0.6;
      box(0.3, ss, hh, w, h, 0.2, k % 3 === 0 ? P.paper2 : P.paper, tilt);
      if (k % 2 === 0) box(0.45, ss, hh + h / 2 - 0.7, 0.8, 0.8, 0.3, SEAL, tilt);
      else if (k % 3 === 1) box(0.4, ss, hh + h / 2 - 0.5, w * 0.9, 0.55, 0.12, P.brass, tilt);
    }
  }
  for (const s of [-2.3, 2.3]) box(0.3, s, 10.5, 2.8, 2.6, 0.2, s < 0 ? P.paper2 : P.paper, s * 0.03);
  // The writing stand: the sign-up ledger open on its slope, an inkwell, a quill.
  {
    const f = 8.6;
    const s = 7.4;
    box(f, s, 1.1 + 4.1, 1.3, 8.2, 1.3, P.brownDark);
    box(f, s, 1.1 + 0.3, 3.4, 0.6, 3.0, P.brownDark);
    box(f, s, 1.1 + 8.6, 5.8, 0.5, 4.2, P.brown, 0, 0.36);
    box(f + 0.05, s - 1.35, 1.1 + 8.95, 2.5, 0.12, 3.4, P.paper, 0.08, 0.36);
    box(f + 0.05, s + 1.35, 1.1 + 8.95, 2.5, 0.12, 3.4, P.paper2, -0.08, 0.36);
    const ink = at(f - 1.5, s + 2.4, 1.1 + 9.45);
    g.shape(BOX, T(ink[0], ink[1], ink[2], 0.8, 0.8, 0.8, ry), P.iron);
    g.beam(at(f - 1.5, s + 2.4, 1.1 + 9.6), at(f - 2.3, s + 3.1, 1.1 + 12.6), 0.12, P.cream, 3, 0.02);
  }
  // A bench facing the board.
  {
    const f = 12.5;
    const s = -6.5;
    box(f, s, 4.9, 13, 1.1, 3.8, P.brown);
    for (const d of [-4.8, 4.8]) box(f, s + d, 2.2, 1.1, 4.4, 3.2, P.brownDark);
  }
}

// ── The one airship kit (local: origin at the deck's centre, nose +x, as layout SHIP) ──

/**
 * Final pass C (the moored view read as flat blue grey boxes and barrels
 * under the moon): your ship's own lanterns baked into its vertices, warm
 * light (strength I) falling off over R (squared) and facing the lamp, as an emissive
 * term (install's shipMat). Winding is not consistent in this soup (solids
 * are double sided), so the face term uses |n.l| over a 0.35 floor.
 */
const LAMP_WARM: RGB = [1.05, 0.56, 0.22];
function lampBake(g: Geo, lamps: ReadonlyArray<readonly [number, number, number, number, number]>): Float32Array {
  const P = g.p;
  const out = new Float32Array(P.length);
  for (let t = 0; t < P.length; t += 9) {
    const e1x = P[t + 3] - P[t], e1y = P[t + 4] - P[t + 1], e1z = P[t + 5] - P[t + 2];
    const e2x = P[t + 6] - P[t], e2y = P[t + 7] - P[t + 1], e2z = P[t + 8] - P[t + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    for (let v = 0; v < 9; v += 3) {
      const px = P[t + v], py = P[t + v + 1], pz = P[t + v + 2];
      let k = 0;
      for (const [lx, ly, lz, R, I] of lamps) {
        const dx = lx - px, dy = ly - py, dz = lz - pz;
        const d = Math.hypot(dx, dy, dz);
        if (d >= R) continue;
        k += I * (1 - d / R) ** 2 * (0.35 + 0.65 * Math.abs(nx * dx + ny * dy + nz * dz) / Math.max(d, 1e-3));
      }
      out[t + v] = LAMP_WARM[0] * k;
      out[t + v + 1] = LAMP_WARM[1] * k;
      out[t + v + 2] = LAMP_WARM[2] * k;
    }
  }
  return out;
}

const L2 = SHIP.length / 2;
const half = (x: number) => (x > 10 ? 15 * (1 - ((x - 10) / (L2 - 10)) ** 2) : x < -40 ? 15 - 6 * ((-40 - x) / (L2 - 40)) ** 2 : 15);
const depthOf = (x: number) => (x > 10 ? 20 * (1 - 0.6 * ((x - 10) / (L2 - 10)) ** 2) : x < -40 ? 20 - 6 * ((-40 - x) / (L2 - 40)) : 20);
const HULL_XS = [-60, -54, -47, -40, -28, -14, 0, 12, 22, 32, 40, 47, 52, 56, 58.5, 60];
const BUL = 4;
/** Where the propellers turn (local, both sides mirror in z). */
const PROP_AT: V3 = [-51.6, 6, 27];
/** Envelope radius factor at local x (1 at the widest), a little finer toward the tail. */
function envK(x: number): number {
  const t = (x - ENV.x) / ENV.len;
  if (Math.abs(t) >= 1) return 0;
  return Math.sqrt(1 - t * t) * (t < 0 ? 1 - 0.12 * t * t : 1);
}

interface KitOpts {
  /** Yours: the dressed deck, rigging kept to the frame edges of the riding camera, propellers left to spinning meshes. */
  hero?: boolean;
  /** A painted band round the envelope (the other ships' livery). */
  band?: RGB;
  /** Flame sprites for the caged lanterns (hero only; others get plain lamps). */
  flames?: number[];
}

function buildAirship(g: Geo, glow: Geo, lamps: number[], opts: KitOpts = {}): void {
  const hero = !!opts.hero;
  const flames = opts.flames ?? [];
  // Hull: strakes, a rub rail at the deck line, a darker keel.
  const outer = (x: number): V3[] => {
    const w = half(x);
    const d = depthOf(x);
    return [[x, BUL, w], [x, 0, w], [x, -0.22 * d, 0.97 * w], [x, -0.45 * d, 0.92 * w], [x, -0.66 * d, 0.76 * w], [x, -0.85 * d, 0.55 * w], [x, -d, 0]];
  };
  const strake = [P.greyBrown, P.hull2, P.hull, P.hull2, P.hull, P.brownDark];
  const mir = (p: V3): V3 => [p[0], p[1], -p[2]];
  for (let s = 0; s < HULL_XS.length - 1; s++) {
    const A = outer(HULL_XS[s]);
    const B = outer(HULL_XS[s + 1]);
    for (let k = 0; k < A.length - 1; k++) {
      const col = scale(strake[k], s % 2 ? 0.94 : 1);
      g.quad(A[k], A[k + 1], B[k + 1], B[k], col);
      g.quad(mir(A[k]), mir(B[k]), mir(B[k + 1]), mir(A[k + 1]), col);
    }
    // Bulwark inside and cap.
    const wa = half(HULL_XS[s]);
    const wb = half(HULL_XS[s + 1]);
    for (const sg of [-1, 1]) {
      const ia = Math.max(0, wa - 1.2);
      const ib = Math.max(0, wb - 1.2);
      g.quad([HULL_XS[s], 0.2, sg * ia], [HULL_XS[s + 1], 0.2, sg * ib], [HULL_XS[s + 1], BUL, sg * ib], [HULL_XS[s], BUL, sg * ia], P.brown);
      g.quad([HULL_XS[s], BUL + 0.4, sg * ia], [HULL_XS[s + 1], BUL + 0.4, sg * ib], [HULL_XS[s + 1], BUL + 0.4, sg * wb], [HULL_XS[s], BUL + 0.4, sg * wa], P.greyBrown);
    }
    // Deck: seven planked strips converging on the bow.
    const da = Math.max(0, wa - 1.2);
    const db = Math.max(0, wb - 1.2);
    for (let j = 0; j < 7; j++) {
      const za0 = -da + (2 * da * j) / 7;
      const za1 = -da + (2 * da * (j + 1)) / 7;
      const zb0 = -db + (2 * db * j) / 7;
      const zb1 = -db + (2 * db * (j + 1)) / 7;
      const col = scale(j % 3 === 0 ? P.plank : j % 3 === 1 ? P.plank2 : P.plank3, 0.96 + 0.08 * rnd(j * 17 + s, 5));
      g.quad([HULL_XS[s], 0.2, za0], [HULL_XS[s], 0.2, za1], [HULL_XS[s + 1], 0.2, zb1], [HULL_XS[s + 1], 0.2, zb0], col);
      // Final pass C: your deck's caulked seams, so the strips read as planks.
      if (hero && j > 0) {
        const sw = 0.06;
        g.quad([HULL_XS[s], 0.26, za0 - sw], [HULL_XS[s], 0.26, za0 + sw], [HULL_XS[s + 1], 0.26, zb0 + sw], [HULL_XS[s + 1], 0.26, zb0 - sw], P.seam);
      }
    }
  }
  // Transom.
  {
    const ring = [...outer(-60), ...outer(-60).reverse().map(mir)];
    const c: V3 = [-60, -6, 0];
    for (let i = 0; i < ring.length; i++) g.tri(c, ring[(i + 1) % ring.length], ring[i], P.hull);
  }
  // Railings: posts along the bulwark cap and a handrail, both sides.
  const RAIL_XS = [-56, -48, -40, -32, -24, -16, -8, 0, 8, 16, 24, 32, 40, 47, 53];
  for (const sg of [-1, 1]) {
    let prev: V3 | null = null;
    for (const x of RAIL_XS) {
      const z = sg * (half(x) - 0.6);
      g.beam([x, BUL + 0.4, z], [x, 9.4, z], 0.42, P.brown, 4);
      const top: V3 = [x, 9.4, z];
      if (prev) g.beam(prev, top, 0.5, P.greyBrown, 4);
      prev = top;
    }
  }
  // Portholes, lit, along both sides.
  for (const x of [-30, -18, -6, 6, 18, 30]) {
    const w = half(x);
    for (const sg of [-1, 1]) glow.shape(BOX, T(x, -4.6, sg * (w * 0.985 + 0.25), 2.4, 2.2, 0.5), GL.window);
  }
  // The low aft cabin (the camera boards over it at 13 above the deck), a lit stern window.
  g.shape(BOX, T(-52.5, 3.3, 0, 11, 6.2, 17), (cy) => (cy > 0.45 ? P.greyBrown : P.brown));
  g.shape(BOX, T(-52.5, 6.7, 0, 12.4, 0.7, 18.4), P.brownDark);
  glow.shape(BOX, T(-58.2, 3.6, 0, 0.5, 2.6, 5), GL.window);
  for (const sg of [-1, 1]) glow.shape(BOX, T(-52.5, 3.8, sg * 8.55, 4, 2.4, 0.3), GL.window);
  // Hatch.
  // Final pass C: on your ship the grating reads as wood (it was a black box
  // in the middle of the moored view).
  g.shape(BOX, T(12, 0.8, 0, 10, 1.2, 8), hero ? P.brown : P.brownDark);
  for (let k = 0; k < 4; k++) g.shape(BOX, T(8.4 + k * 2.4, 1.5, 0, 1, 0.3, 7), hero ? P.plank3 : P.brown);
  if (hero) {
    // The deck the riding camera sees (x 18 to 58, bible 6 the flight): the
    // centre stays open as the leading line to the bow; cargo along both
    // bulwarks. Left: a crate stack under a tarp, the chart table, a coil.
    // Right: hooped barrels, the helm, a lantern on a hook.
    crate(g, 24, 0.2, -9.6, 5.4, 0.12, 1, P.brass);
    crate(g, 29.5, 0.2, -9.8, 4.6, -0.2, 2, P.brass);
    crate(g, 25.4, 5.6, -9.4, 4, 0.5, 3, P.brass);
    g.quad([22, 9.9, -12.2], [28.2, 9.9, -12.4], [28.4, 5.2, -12.6], [21.6, 5.4, -12.2], P.tarp);
    chartTable(g, 42, 0.2, -6, 0.25);
    ropeCoil(g, 47, 0.2, -4.6, 2.6);
    ropeCoil(g, 20, 0.2, 4.2, 2.2);
    barrel(g, 26, 0.2, 10, 1, 1, P.brass);
    barrel(g, 30.6, 0.2, 9.2, 0.92, 2, P.brass);
    barrel(g, 28.2, 0.2, 5.6, 0.85, 3, P.brass);
    // The helm stands aft, behind the riding camera (seen from the gangway and from outside).
    // Map review, item 18: the camera boards along the centreline, 12.5 to 12.8
    // over the deck where the wheel stands, and at full size its spokes reached
    // 14.3, so the boarding drove through it. At 0.7 it stays where it stood and
    // its top is 10.0, 2.7 under the camera. Lovro picks (fix round 1,
    // bounty-w3/fix-r1/boarding-wheel-ABC.jpg): full size here is the ride as
    // it was, through the wheel; (-44.5, 0.2, 8) at full size is the starboard
    // side of round 1.
    shipWheel(g, -46, 0.2, 0, 0.7);
    // The lantern on a hook: a post by the port bulwark, an arm inboard, a
    // short chain; it hangs left of the view, clear of the harbour on the right third.
    // Fix pass 3: 16.4 -> 11.6 tall, so the post stays under the horizon at
    // dawn (key 70.5) instead of cutting up through the harbour town.
    g.beam([33, 0.2, -10.2], [33, 11.6, -10.2], 0.55, P.brown, 4);
    g.beam([33, 11, -10.2], [33, 11, -7.2], 0.38, P.brown, 4);
    g.beam([33, 11, -7.4], [33, 9.8, -7.4], 0.1, P.iron, 3);
    cagedLantern(g, glow, flames, lamps, 33, 8, -7.4, 0.9, 7);
    ropeCoil(g, 52, 0.2, 3, 1.6);
  } else {
    // The other ships: cargo on deck.
    crate(g, 26, 0.2, -7, 5, 0.3, 4);
    crate(g, 30, 0.2, -3.6, 4, 0.9, 5);
    barrel(g, 22, 0.2, 7.6, 0.9, 6);
    ropeCoil(g, 38, 0.2, 5, 2.8);
  }
  // Stem, bowsprit.
  g.beam([59, -6, 0], [61, 7.5, 0], 1.8, P.brown, 6);
  g.beam([57, 3, 0], [84, 6.5, 0], 1.4, P.brown, 6, 0.7);
  // Bow lanterns hung OUTBOARD on the hull's shoulders, under the bulwark cap:
  // they read from the bridge, the boarding and the flight seen from outside,
  // and the bulwark hides them from the riding camera.
  for (const sg of [-1, 1]) {
    const w = half(44);
    const z = sg * (w + 1.3);
    g.beam([44, 1.2, sg * (w - 0.2)], [44, 1.2, z], 0.35, P.iron, 4);
    g.shape(BOX, T(44, 0.9, z, 1.5, 0.4, 1.5), P.iron);
    glow.shape(BOX, T(44, -0.4, z, 1.3, 1.9, 1.3), GL.airLamp);
    lamps.push(44, -0.4, z, 8);
  }
  // Side lamps aft of the riding camera (out of its view, seen from outside), the stern lamp.
  for (const sg of [-1, 1]) {
    const z = sg * (half(-26) + 0.9);
    g.beam([-26, 4.4, sg * half(-26)], [-26, 4.4, z], 0.35, P.iron, 4);
    if (hero) cagedLantern(g, glow, flames, lamps, -26, 2.6, z + sg * 0.6, 0.8, 6);
    else {
      glow.shape(BOX, T(-26, 3.4, z, 1.1, 1.6, 0.9), GL.airLamp);
      g.shape(BOX, T(-26, 4.5, z, 1.4, 0.4, 1.2), P.iron);
      lamps.push(-26, 3.4, z, 6);
    }
  }
  glow.shape(BOX, T(-60.3, 1.5, 0, 0.6, 2.2, 2.2), GL.airLamp);
  lamps.push(-60.8, 1.5, 0, 7);
  // Hull rudder under the stern.
  g.quad([-60, -2, 0], [-60, -15, 0], [-67, -12, 0], [-67, -1, 0], P.brownDark);
  g.beam([-60.5, 2, 0], [-60.5, -15, 0], 0.6, P.iron, 4);
  // Stern flag on the port quarter.
  g.beam([-56, 0.2, -9], [-56, 18, -9], 0.35, P.brown, 4);
  g.quad([-56.2, 17.6, -9], [-56.2, 12.4, -9], [-66, 14.2, -9], [-66, 17.2, -9], opts.band ?? P.cream);

  // The envelope: gores alternating, brass ribs, a painted band on the others.
  const stations: number[] = [];
  for (const t of [-1, -0.975, -0.93, -0.86, -0.76, -0.64, -0.5, -0.36, -0.2, 0, 0.2, 0.36, 0.5, 0.64, 0.76, 0.86, 0.93, 0.975, 1]) stations.push(ENV.x + t * ENV.len);
  const RIB_T = [-0.64, -0.36, 0, 0.36, 0.64];
  for (const t of RIB_T) stations.push(ENV.x + t * ENV.len + 1.6);
  stations.sort((a, b) => a - b);
  const isRib = (x0: number) => RIB_T.some((t) => Math.abs(x0 - (ENV.x + t * ENV.len)) < 0.01);
  const bandX = [ENV.x + 0.2 * ENV.len, ENV.x + 0.36 * ENV.len];
  const NA = 16;
  const envPt = (x: number, i: number, puff = 1): V3 => {
    const k = envK(x) * puff;
    const a = (i / NA) * Math.PI * 2;
    return [x, ENV.y + Math.sin(a) * ENV.ry * k, Math.cos(a) * ENV.rz * k];
  };
  for (let s = 0; s < stations.length - 1; s++) {
    const x0 = stations[s];
    const x1 = stations[s + 1];
    const rib = isRib(x0);
    const puff = rib ? 1.012 : 1;
    const inBand = !!opts.band && x0 >= bandX[0] - 0.01 && x1 <= bandX[1] + 0.01;
    for (let i = 0; i < NA; i++) {
      const col = rib ? P.greyBrown : inBand ? scale(opts.band!, i % 2 ? 1 : 0.92) : i % 2 ? P.canvas : P.canvas2;
      const a = envPt(x0, i, puff);
      const b = envPt(x0, i + 1, puff);
      const c = envPt(x1, i + 1, puff);
      const d = envPt(x1, i, puff);
      if (envK(x0) === 0) g.tri(a, c, d, col);
      else if (envK(x1) === 0) g.tri(a, b, c, col);
      else g.quad(a, b, c, d, col);
    }
  }
  // Nose cap and a lamp at the nose.
  g.shape(prismShape(6, 1, 0.5, true, true), T(ENV.x + ENV.len - 1, ENV.y, 0, 2.4, 3, 2.4, 0, 0, -Math.PI / 2), P.brass);
  glow.shape(BOX, T(ENV.x + ENV.len + 2.6, ENV.y, 0, 1.6, 1.6, 1.6), GL.airLamp);
  lamps.push(ENV.x + ENV.len + 2.6, ENV.y, 0, 9);
  // The keel: a beam along the belly.
  const belly = (x: number) => ENV.y - ENV.ry * envK(x);
  for (let x = -58; x < 52; x += 11) g.beam([x, belly(x) - 0.6, 0], [x + 11, belly(x + 11) - 0.6, 0], 1.3, P.brownDark, 4);
  // Tail fins: top, bottom (the rudder), both sides.
  {
    const fin = (a: V3, b: V3, c: V3, d: V3) => {
      g.quad(a, b, c, d, P.finCanvas);
      g.beam(a, d, 0.5, P.brownDark, 3);
      g.beam(d, c, 0.5, P.brownDark, 3);
    };
    const xa = -60;
    const xb = -76;
    const ka = envK(xa);
    const kb = envK(xb);
    fin([xa, ENV.y + ENV.ry * ka - 1, 0], [xb, ENV.y + ENV.ry * kb - 1, 0], [-86, ENV.y + 24, 0], [-71, ENV.y + 27, 0]);
    fin([xa, ENV.y - ENV.ry * ka + 1, 0], [xb, ENV.y - ENV.ry * kb + 1, 0], [-86, ENV.y - 22, 0], [-71, ENV.y - 24, 0]);
    for (const sg of [-1, 1]) fin([xa, ENV.y, sg * (ENV.rz * ka - 1)], [xb, ENV.y, sg * (ENV.rz * kb - 1)], [-86, ENV.y, sg * 30], [-71, ENV.y, sg * 34]);
  }
  // Rigging: thin pale rope, rail to the envelope's lower flank. Yours keeps
  // only the stations at or behind the riding camera's frame edge (x <= -8:
  // the lens is 31 degrees tall, 48 wide), so no line crosses the flight's view.
  for (const x of hero ? [-52, -40, -24, -8] : [-40, -24, -8, 8, 24, 40]) {
    const xe = x * 0.9 + ENV.x * 0.1;
    const k = envK(xe);
    const fy = ENV.y - ENV.ry * k * Math.sin(48 * DEG);
    const fz = ENV.rz * k * Math.cos(48 * DEG);
    for (const sg of [-1, 1]) g.beam([x, 9.4, sg * (half(x) - 0.6)], [xe, fy, sg * fz], 0.16, P.rope, 3);
  }
  // Engine pods on outriggers, painted, with brass bands (the propellers are their own meshes on yours).
  for (const sg of [-1, 1]) {
    g.beam([-44, 0, sg * 14.4], [-44, 6, sg * 27], 1.1, P.brownDark, 4);
    g.beam([-40, 0, sg * 13], [-46, 6, sg * 26], 0.7, P.iron, 4);
    g.shape(prismShape(8, 1, 0.8, true, true), T(-37, 6, sg * 27, 3.4, 14, 3.4, 0, 0, Math.PI / 2), P.pod);
    for (const bx of [-37.4, -44, -49.6]) g.shape(prismShape(8, 1, 1, false, false), T(bx, 6, sg * 27, bx < -49 ? 2.95 : 3.55, 1.1, bx < -49 ? 2.95 : 3.55, 0, 0, Math.PI / 2), P.brass);
    g.shape(prismShape(8, 1, 0.6, false, true), T(-51, 6, sg * 27, 2.72, 0.8, 2.72, 0, 0, Math.PI / 2), P.podDark);
    if (!hero) {
      const pg = new Geo();
      buildPropeller(pg);
      g.shape(pg.p, T(PROP_AT[0], PROP_AT[1], sg * PROP_AT[2], 1, 1, 1, 0, sg * 0.7, 0), (_cy, i) => [pg.c[i * 9], pg.c[i * 9 + 1], pg.c[i * 9 + 2]]);
    }
  }
}

/**
 * A propeller about local x: a brass hub and spinner, four varnished blades
 * pitched 24 degrees so their faces catch the light, brass tip caps.
 */
function buildPropeller(g: Geo): void {
  g.shape(prismShape(8, 1, 1, true, true), T(0.4, 0, 0, 1.5, 1.6, 1.5, 0, 0, Math.PI / 2), P.brass);
  g.shape(prismShape(8, 1, 0, false, true), T(-1.2, 0, 0, 1.3, 2.2, 1.3, 0, 0, Math.PI / 2), P.brass);
  const R = [1.2, 2.6, 4.6, 6.4, 7.5, 8.3];
  const W = [0.7, 1.5, 2.0, 1.85, 1.45, 0.7];
  const pitch = 24 * DEG;
  for (let b = 0; b < 4; b++) {
    const a = (b / 4) * Math.PI * 2 + 0.3;
    const rad: V3 = [0, Math.cos(a), Math.sin(a)];
    const tan: V3 = [Math.sin(pitch), -Math.sin(a) * Math.cos(pitch), Math.cos(a) * Math.cos(pitch)];
    const pt = (r: number, w: number): V3 => [rad[0] * r + tan[0] * w - 0.2, rad[1] * r + tan[1] * w, rad[2] * r + tan[2] * w];
    for (let k = 0; k < R.length - 1; k++) {
      // Fix pass 3: one darker varnish per blade (alternating bands read as a pinwheel, a flower at boarding).
      const col = k >= R.length - 2 ? P.brass : scale(P.varnish2, b % 2 ? 0.62 : 0.7);
      g.quad(pt(R[k], -W[k] * 0.45), pt(R[k + 1], -W[k + 1] * 0.45), pt(R[k + 1], W[k + 1] * 0.55), pt(R[k], W[k] * 0.55), col);
    }
  }
}

/** The kit's raw triangles, for modules with their own builders: positions and linear colours, flat per triangle. */
export interface AirshipKitGeo {
  /** Solid: xyz per vertex, 9 floats per triangle; colour the same layout. */
  p: number[];
  c: number[];
  /** Lit windows and lamps (unlit glow). */
  gp: number[];
  gc: number[];
  /** Lamp halos: x, y, z, size per lamp. */
  lamps: number[];
  /** Height of the envelope's axis over the deck, at this size. */
  envY: number;
}

/**
 * THE airship kit (the only one in the world): the same ship as yours,
 * scaled to `length` (yours is SHIP.length = 120), local origin at the deck's
 * centre, nose +x. `band` paints a livery band round the envelope. The
 * propellers are baked in (they turn only on yours).
 */
export function airshipKit(length: number, band?: RGB): AirshipKitGeo {
  const g = new Geo();
  const gl = new Geo();
  const lamps: number[] = [];
  buildAirship(g, gl, lamps, { band });
  const k = length / SHIP.length;
  const sc = (a: number[]) => a.map((v) => v * k);
  for (let i = 0; i < lamps.length; i++) lamps[i] *= k;
  return { p: sc(g.p), c: g.c, gp: sc(gl.p), gc: gl.c, lamps, envY: ENV.y * k };
}

// ── The halo sprite (bible E1) ──────────────────────────────────────────────

export function haloMaterial(): THREE.ShaderMaterial {
  const color = new THREE.Color(1.0, 0.64, 0.32);
  const mat = new THREE.ShaderMaterial({
    name: "SkyHalo",
    uniforms: { uScale: { value: 600 }, uColor: { value: color } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      uniform float uScale;
      varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // At least 4 px far away (the look back from the island's edge), fading out past 3,500.
        gl_PointSize = clamp(aSize * uScale / -mv.z, 4.0, 90.0);
        vFade = 1.0 - smoothstep(2500.0, 3500.0, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vFade;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-r * r * 4.0) * (1.0 - smoothstep(0.75, 1.0, r)) * vFade;
        gl_FragColor = vec4(uColor * a * 0.55, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  // light.ts levels a lamp material's .color by the key's lampGlow; this IS the uniform.
  (mat as unknown as { color: THREE.Color }).color = color;
  mat.userData.lightGlow = "lamp";
  return mat;
}

/**
 * The flame sprite (bible E2, as a point sprite: one call per group): a
 * teardrop, white gold at the core, orange at the rim, baked light only.
 * light.ts levels .color with the lamps (userData.lightGlow = "lamp").
 */
export function flameMaterial(): THREE.ShaderMaterial {
  const color = new THREE.Color(1, 1, 1);
  const mat = new THREE.ShaderMaterial({
    name: "SkyFlame",
    uniforms: { uScale: { value: 600 }, uColor: { value: color } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      uniform float uScale;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uScale / -mv.z, 1.5, 48.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        q.y = -q.y + 0.14;
        float k = q.y > 0.0 ? 1.0 + q.y * 3.2 : 1.0;
        float r = length(vec2(q.x * 2.4 * k, q.y * 1.3));
        float a = 1.0 - smoothstep(0.22, 0.46, r);
        if (a < 0.01) discard;
        vec3 c = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.9, 0.62), 1.0 - smoothstep(0.02, 0.3, r));
        gl_FragColor = vec4(c * uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  (mat as unknown as { color: THREE.Color }).color = color;
  mat.userData.lightGlow = "lamp";
  return mat;
}

// ── Install ─────────────────────────────────────────────────────────────────

export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = performance.now();
  const reduced = ctx.reducedMotion;
  const disposables: { dispose(): void }[] = [];
  const track = <X extends { dispose(): void }>(x: X): X => {
    disposables.push(x);
    return x;
  };
  const solid = track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  solid.name = "SkySolid";
  // Final pass C: your ship's art, lit by its own lanterns (aLamp, lampBake's
  // warm light per vertex, added as emissive on the painted colour).
  const shipMat = track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  shipMat.name = "SkyShipArt";
  shipMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aLamp;\nvarying vec3 vLamp;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLamp = aLamp;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLamp;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vLamp;");
  };
  shipMat.customProgramCacheKey = () => "sky-ship-lamp";
  const cloudMat = track(new THREE.MeshLambertMaterial({ vertexColors: true }));
  cloudMat.name = "SkyCloud";
  const glowMat = track(new THREE.MeshBasicMaterial({ vertexColors: true }));
  glowMat.name = "SkyGlow";
  glowMat.userData.lightGlow = "lamp";
  // The spring and its rills: unlit, the night sky's silver in them (not a lamp).
  const waterMat = track(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  waterMat.name = "SkyRills";
  const haloMat = track(haloMaterial());
  const flameMat = track(flameMaterial());
  const vp = new THREE.Vector2();
  const haloScale = (renderer: THREE.WebGLRenderer, camera: THREE.Camera) => {
    renderer.getDrawingBufferSize(vp);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 31;
    haloMat.uniforms.uScale.value = vp.y / (2 * Math.tan((fov * DEG) / 2));
    flameMat.uniforms.uScale.value = haloMat.uniforms.uScale.value;
  };

  const root = new THREE.Group();
  root.name = "DressSky";
  ctx.root.add(root);
  const added: THREE.Object3D[] = [root];
  let tris = 0;
  let meshes = 0;
  const addMesh = (parent: THREE.Object3D, g: Geo, mat: THREE.Material, name: string, normals = false): THREE.Mesh => {
    const geo = track(g.build(normals));
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    parent.add(m);
    if (parent !== root) added.push(m);
    tris += g.tris;
    meshes++;
    return m;
  };
  const addHalos = (parent: THREE.Object3D, list: number[], name: string): THREE.Points | null => {
    if (!list.length) return null;
    const n = list.length / 4;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos.set([list[i * 4], list[i * 4 + 1], list[i * 4 + 2]], i * 3);
      size[i] = list[i * 4 + 3];
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.computeBoundingSphere();
    const pts = new THREE.Points(geo, haloMat);
    pts.name = name;
    pts.renderOrder = 4;
    pts.onBeforeRender = (renderer, _s, camera) => haloScale(renderer, camera);
    parent.add(pts);
    if (parent !== root) added.push(pts);
    meshes++;
    return pts;
  };

  const addFlames = (parent: THREE.Object3D, list: number[], name: string): THREE.Points | null => {
    const pts = addHalos(parent, list, name);
    if (pts) {
      pts.material = flameMat;
      pts.renderOrder = 5;
    }
    return pts;
  };


  const I = WORLD.island;
  const B = WORLD.bountyIsle;
  const a7 = PLACES[6];

  // ── The islands' bodies, roots, spurs; trees; path; bounty isle; bridge ends ──
  const land = new Geo();
  // The a7 frame's ground dressing lives in its own mesh, kept out of the Mirror Lake's reflection
  // (merged into Sky_Land it pushed the a5 reflection over its 80k triangle cap).
  const a7g = new Geo();
  const glow = new Geo();
  const halos: number[] = [];
  const flames: number[] = [];
  floatingRock(land, I.x, I.y, I.z, ISLAND_DEPTH, islandRim, islandTop, 64, 3);
  for (const [bx, by, bz, r] of [[-2700, 1560, -2150, 34], [-2500, 1500, -2330, 22], [-1880, 1580, -2240, 18], [-2880, 1470, -1400, 26]] as const)
    floatingRock(land, bx, by, bz, r * 1.6, () => r, () => 0, 12, bx, false);
  const coveOff = (b: number) => {
    let d = b - COVE_BEARING;
    d -= 360 * Math.round(d / 360);
    return Math.abs(d);
  };
  // Spurs under the island, clear of the rise.
  for (const [b, ff, r, len] of [[25, 0.5, 58, 150], [205, 0.46, 64, 175], [285, 0.55, 46, 120], [340, 0.4, 40, 110], [250, 0.3, 36, 90]] as const) {
    const rr = islandRim(b * DEG) * ff;
    const [dx, dz] = dirOf(b);
    const x = I.x + dx * rr;
    const z = I.z + dz * rr;
    const y = underY(I.y, ISLAND_DEPTH, ff) + 14;
    if (railDist(x, y - len / 2, z) < r + len / 2 + 40) continue;
    spur(land, x, y, z, r, len, b);
  }
  // Roots dangling off the lip.
  for (let k = 0; k < 96; k++) {
    const b = k < 70 ? rnd(k, 71) * 360 : COVE_BEARING - 34 + rnd(k, 71) * 68;
    const r = islandRim(b * DEG);
    const [dx, dz] = dirOf(b);
    const f = 0.93 + rnd(k, 72) * 0.04;
    if (coveOff(b) < 30 && railDist(I.x + dx * r * f, I.y - 30, I.z + dz * r * f) < 45) continue;
    hangRoot(land, I.x + dx * r * f, I.y - 10 - rnd(k, 73) * 20, I.z + dz * r * f, dx, dz, 26 + rnd(k, 74) * 60, 1 + rnd(k, 75) * 1.2, k);
  }
  // The bounty isle.
  floatingRock(land, B.x, B.y, B.z, BOUNTY_DEPTH, bountyRim, () => 0, 24, 77);
  for (let k = 0; k < 22; k++) {
    const b = rnd(k, 81) * 360;
    const r = bountyRim(b * DEG);
    const [dx, dz] = dirOf(b);
    hangRoot(land, B.x + dx * r * 0.95, B.y - 8 - rnd(k, 82) * 8, B.z + dz * r * 0.95, dx, dz, 18 + rnd(k, 83) * 36, 0.9 + rnd(k, 84) * 0.8, 200 + k);
  }
  spur(land, B.x + 10, B.y - 70, B.z - 8, 26, 70, 7);

  // Trees on the island top: clumps toward the rim, off the path, the rail and the landmark.
  const oPos = a7.pos;
  const camA7 = TRAIL[a7.trail];
  const lookA7 = LOOK[a7.trail];
  const sightOff = (x: number, z: number) => {
    // Distance from (x, z) to the a7 camera's sight line to the observatory, in plan.
    const ax = camA7[0];
    const az = camA7[2];
    const bx = oPos.x;
    const bz = oPos.z;
    const dx = bx - ax;
    const dz = bz - az;
    const u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - ax - dx * u, z - az - dz * u);
  };
  const obsBearing = Math.atan2(oPos.x - camA7[0], -(oPos.z - camA7[2]));
  const behindLandmark = (x: number, z: number) => {
    let d = Math.atan2(x - camA7[0], -(z - camA7[2])) - obsBearing;
    d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
    return Math.abs(d) < 10 * DEG;
  };
  let treeCount = 0;
  const placeTree = (x: number, z: number, h: number, seed: number, y0?: number): boolean => {
    const y = y0 ?? I.y + islandTop(x, z);
    if (railDist(x, y + h * 0.5, z) < h * 0.5 + 28) return false;
    spire(land, x, y, z, h, seed);
    treeCount++;
    return true;
  };
  for (let i = 0; treeCount < ISLAND_TREES && i < 2400; i++) {
    const b = rnd(i, 91) * 360;
    const rim = islandRim(b * DEG);
    const f = Math.sqrt(0.08 + 0.92 * rnd(i, 92));
    const r = rim * f;
    if (r > rim - 22 || f < 0.74) continue;
    if (coveOff(b) < 28 && r > rim - 140) continue;
    const [dx, dz] = dirOf(b);
    const x = I.x + dx * r;
    const z = I.z + dz * r;
    const clump = vnoise(x / 150 + 3, z / 150);
    if (rnd(i, 93) > smooth(0.2, 0.95, f) * smooth(0.3, 0.68, clump) * 1.8) continue;
    const dO = Math.hypot(x - oPos.x, z - oPos.z);
    if (dO < 115 || trailDistFast(x, z) < 38 || sightOff(x, z) < 45 || behindLandmark(x, z)) continue;
    const h = (dO < 200 ? 32 : 40) + rnd(i, 94) * (dO < 200 ? 24 : 34);
    placeTree(x, z, h, i);
  }
  // The framing clump in the lower right of the a7 frame.
  {
    const cam = new THREE.Vector3(...camA7);
    const f = new THREE.Vector3(...lookA7).sub(cam).normalize();
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, f).normalize();
    const tv = Math.tan(15.5 * DEG);
    for (const [nx, ny, k] of [[0.86, -0.62, 0], [0.97, -0.4, 1], [0.74, -0.8, 2], [0.95, -0.78, 3], [0.8, -0.35, 4]] as const) {
      const d = f.clone().addScaledVector(right, nx * tv * 1.6).addScaledVector(up, ny * tv);
      if (d.y >= -1e-3) continue;
      const t = (I.y + 4 - cam.y) / d.y;
      const x = cam.x + d.x * t;
      const z = cam.z + d.z * t;
      const b = (Math.atan2(x - I.x, -(z - I.z)) / DEG + 360) % 360;
      if (Math.hypot(x - I.x, z - I.z) > islandRim(b * DEG) - 25) continue;
      if (trailDistFast(x, z) < 20 || Math.hypot(x - oPos.x, z - oPos.z) < TERRACE.r + 40) continue;
      placeTree(x, z, 46 + rnd(k, 95) * 16, 500 + k);
    }
  }
  // The bounty isle's two spires (blocks' spots: off the walk by 64 and 75).
  placeTree(B.x + 50, B.z + 40, 40, 601, B.y - 1);
  placeTree(B.x - 60, B.z - 45, 34, 602, B.y - 1);

  // Round F: the path lanterns' positions, for the island meadow's night layer.
  const pathLamps: number[] = [];
  // The flagstone path across the island, and small lanterns along it.
  {
    const pts = PATH.filter((q) => q.y >= WORLD.islandLevel - 5 && Math.hypot(q.x - I.x, q.z - I.z) < I.r + 10);
    let n = 0;
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s];
      const b = pts[s + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      for (let d = 4; d < len; d += 7.5) {
        if (Math.hypot(a.x + ux * d - oPos.x, a.z + uz * d - oPos.z) < TERRACE.r + TERRACE.steps * TERRACE.run + 2) continue;
        for (const side of [-1, 1]) {
          const jit = (rnd(n, 101) - 0.5) * 2.5;
          const x = a.x + ux * (d + jit) - uz * side * (3.6 + rnd(n, 102) * 1.2);
          const z = a.z + uz * (d + jit) + ux * side * (3.6 + rnd(n, 102) * 1.2);
          const y = I.y + islandTop(x, z) + 0.35;
          const w = 3.2 + rnd(n, 103) * 1.4;
          const sides = 5 + Math.floor(rnd(n, 104) * 2);
          const rot = rnd(n, 105) * Math.PI;
          const c: V3 = [x, y, z];
          const col = scale(n % 3 ? P.flag : P.stone, 0.9 + rnd(n, 106) * 0.15);
          for (let i = 0; i < sides; i++) {
            const t0 = rot + (i / sides) * Math.PI * 2;
            const t1 = rot + ((i + 1) / sides) * Math.PI * 2;
            land.tri(c, [x + Math.cos(t1) * w, y, z + Math.sin(t1) * w], [x + Math.cos(t0) * w, y, z + Math.sin(t0) * w], col);
          }
          n++;
        }
      }
    }
    // C3 (judge 1, fix 7): the approach from the cove to the terrace steps is
    // lined with caged lanterns every ~34, alternating sides, 10 off the path,
    // so a line of warm points leads the eye up to the observatory.
    const foot = TERRACE.r + TERRACE.steps * TERRACE.run + 8;
    let approachEnd = 0;
    {
      let acc = 0;
      let next = 18;
      let sd = -1;
      let placed = 0;
      for (let s = 0; s < pts.length - 1 && placed < 7; s++) {
        const a = pts[s];
        const b = pts[s + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const ux = (b.x - a.x) / len;
        const uz = (b.z - a.z) / len;
        let done = false;
        while (next < acc + len && placed < 7) {
          const d = next - acc;
          const cx = a.x + ux * d;
          const cz = a.z + uz * d;
          if (Math.hypot(cx - oPos.x, cz - oPos.z) < foot) {
            done = true;
            break;
          }
          const x = cx - uz * sd * 10;
          const z = cz + ux * sd * 10;
          if (railDist(x, I.y + 8, z) > 14) {
            const y = I.y + islandTop(x, z);
            land.beam([x, y, z], [x, y + 10.4, z], 0.55, P.brownDark, 4);
            land.beam([x, y + 10.4, z], [x + uz * sd * 2.2, y + 10.4, z - ux * sd * 2.2], 0.3, P.iron, 3);
            cagedLantern(land, glow, flames, halos, x + uz * sd * 2.2, y + 8.6, z - ux * sd * 2.2, 0.9, 16);
            pathLamps.push(x + uz * sd * 2.2, y + 8.6, z - ux * sd * 2.2);
            placed++;
          }
          sd = -sd;
          approachEnd = next;
          next += 34;
        }
        if (done) break;
        acc += len;
      }
    }
    // Lanterns: every ~110 along the rest of the path, alternating sides, 11 off it.
    let carry = 50;
    let side = 1;
    let along = 0;
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s];
      const b = pts[s + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      let d = carry;
      while (d < len) {
        const x = a.x + ux * d - uz * side * 11;
        const z = a.z + uz * d + ux * side * 11;
        if (along + d > approachEnd + 20 && Math.hypot(x - oPos.x, z - oPos.z) > 95 && railDist(x, I.y + 8, z) > 16) {
          const y = I.y + islandTop(x, z);
          land.beam([x, y, z], [x, y + 10.4, z], 0.55, P.brownDark, 4);
          cagedLantern(land, glow, flames, halos, x, y + 12.2, z, 0.9, 9);
          pathLamps.push(x, y + 12.2, z);
          side = -side;
        }
        d += 110;
      }
      carry = d - len;
      along += len;
    }
  }


  // ── Final run: what the a7 frame sees of the island top (the camera ~290
  //    south west of the observatory, looking up ~6 at bearing ~46). Pale gold
  //    grass tufts over the plain, rocks on the rim framing the lower corners,
  //    a spire clump on the left rim; all clear of the lesson panel (lower
  //    left), the timeline (bottom centre), the path, the rills and the terrace. ──
  function a7Ground(rillPts: [number, number][]): void {
    // The a7 camera: TRAIL x/z, the rail riding ~19 over TRAIL y there
    // (measured: camera y 1695), lens 40, the 1691x1278 proof aspect.
    const cam = new THREE.PerspectiveCamera(40, 1691 / 1278, 1, 5000);
    cam.position.set(camA7[0], camA7[1] + 19, camA7[2]);
    cam.lookAt(lookA7[0], lookA7[1] + 19, lookA7[2]);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const inUi = (nx: number, ny: number) => (nx < -0.52 && ny < -0.58) || (nx > -0.42 && nx < 0.42 && ny < -0.72);
    const ground = (nx: number, ny: number): V3 | null => {
      const d = new THREE.Vector3(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
      if (d.y > -1e-3) return null;
      let y: number = I.y;
      let x = 0;
      let z = 0;
      for (let k = 0; k < 3; k++) {
        const t = (y - cam.position.y) / d.y;
        x = cam.position.x + d.x * t;
        z = cam.position.z + d.z * t;
        y = topY(x, z);
      }
      return [x, y, z];
    };
    const rillDist = (x: number, z: number) => {
      let m = 1e9;
      for (const q of rillPts) m = Math.min(m, Math.hypot(q[0] - x, q[1] - z));
      return m;
    };
    const [sdx, sdz] = dirOf(OBSERVATORY.facing);
    const stairC = TERRACE.r + (TERRACE.steps * TERRACE.run) / 2;
    const clear = (x: number, z: number, pad: number) => {
      const b = (Math.atan2(x - I.x, -(z - I.z)) / DEG + 360) % 360;
      if (Math.hypot(x - I.x, z - I.z) > islandRim(b * DEG) - 10 - pad) return false;
      if (trailDistFast(x, z) < 7 + pad || rillDist(x, z) < 5 + pad) return false;
      if (Math.hypot(x - oPos.x, z - oPos.z) < TERRACE.r + 4 + pad) return false;
      if (Math.hypot(x - oPos.x - sdx * stairC, z - oPos.z - sdz * stairC) < TERRACE.stairW + pad) return false;
      if (Math.hypot(x - ISLAND_SPRING.x, z - ISLAND_SPRING.z) < 14 + pad) return false;
      if (Math.hypot(x - ISLAND_LOOKOUT.x, z - ISLAND_LOOKOUT.z) < 16 + pad) return false;
      return true;
    };
    // Final pass: gold, not cream (the cream tips read white by moonlight).
    const tipC = lin(0xd8ba74);
    const midC = lin(0xae9056);
    const baseC = lin(0x5c5036);
    // Grass tufts: sampled evenly over the frame's ground, so the near ones are
    // few and big and the far ones many and small, the way a real field reads.
    let tufts = 0;
    for (let i = 0; i < 1400 && tufts < 520; i++) {
      const nx = -1 + 2 * rnd(i, 701);
      const ny = -0.78 + 0.4 * rnd(i, 702);
      // Nearer than ny -0.78 a tuft is a big dark spike; the lower right is the spires' corner.
      if (inUi(nx, ny) || (nx > 0.55 && ny < -0.55)) continue;
      const p = ground(nx, ny);
      if (!p) continue;
      const [x, y, z] = p;
      if (!clear(x, z, 0) || railDist(x, y + 2, z) < 8) continue;
      // Drifts, not an even lawn.
      if (vnoise(x / 70 + 11, z / 70 - 4) < 0.34 + 0.2 * rnd(i, 703)) continue;
      const blades = 5 + Math.floor(rnd(i, 704) * 4);
      const hk = 0.75 + rnd(i, 705) * 0.6;
      for (let k = 0; k < blades; k++) {
        const a = rnd(i * 13 + k, 706) * Math.PI * 2;
        const off = rnd(i * 13 + k, 707) * 1.4;
        const bx = x + Math.cos(a) * off;
        const bz = z + Math.sin(a) * off;
        const h = (2.2 + rnd(i * 13 + k, 708) * 2.4) * hk;
        const lean = 0.5 + rnd(i * 13 + k, 709) * 1.1;
        const w = 0.32 + rnd(i * 13 + k, 710) * 0.2;
        const px = -Math.sin(a) * w;
        const pz = Math.cos(a) * w;
        const tip = mix(midC, tipC, rnd(i * 13 + k, 711));
        a7g.tri([bx - px, y - 0.2, bz - pz], [bx + px, y - 0.2, bz + pz], [bx + Math.cos(a) * lean, y + h, bz + Math.sin(a) * lean], baseC, baseC, tip);
      }
      tufts++;
    }
    // boulder()'s blue greys went saturated blue under the moon at a7 (read as
    // tents); these are the terrace's warm stone, mossy on top, sunk half in.
    const rimRock = (x: number, y: number, z: number, r: number, seed: number) =>
      a7g.shape(prismShape(6 + Math.floor(rnd(seed, 401) * 3), 1, 0.45 + rnd(seed, 403) * 0.25, true, false, rnd(seed, 404) * 3), T(x, y - r * 0.45, z, r, r * (0.8 + rnd(seed, 405) * 0.4), r * (0.8 + rnd(seed, 406) * 0.4), rnd(seed, 407) * 6, (rnd(seed, 408) - 0.5) * 0.25, (rnd(seed, 409) - 0.5) * 0.25), (cy, i) =>
        cy > 0.9 ? P.moss : scale(cy > 0.5 ? P.stone : P.stoneDark, 0.8 + 0.2 * rnd(i + seed, 410)),
      );
    // Rocks on the rim and at the spires' feet, framing the lower corners
    // (screen spots in the proof frame: [ndc x, ndc y, radius]).
    const rocks: [number, number, number][] = [
      [0.9, -0.66, 8], [0.78, -0.8, 6], [0.97, -0.86, 10], [0.66, -0.94, 4.5],
      [-0.62, -0.5, 11], [-0.47, -0.53, 7], [-0.8, -0.49, 9], [-0.36, -0.49, 5],
      [-0.2, -0.6, 3.5], [0.08, -0.56, 3], [-0.1, -0.66, 4],
    ];
    rocks.forEach(([nx, ny, r], k) => {
      const p = ground(nx, ny);
      if (!p || !clear(p[0], p[2], r) || railDist(p[0], p[1] + r, p[2]) < r + 10) return;
      rimRock(p[0], p[1], p[2], r, 760 + k);
      if (r > 6) rimRock(p[0] + r * 0.9, p[1], p[2] + r * 0.5, r * 0.45, 780 + k);
    });
    // A spire clump on the left rim, above the lesson panel.
    for (const [nx, ny, h, k] of [[-0.55, -0.47, 52, 0], [-0.44, -0.48, 40, 1], [-0.66, -0.46, 46, 2], [-0.5, -0.5, 30, 3]] as const) {
      const p = ground(nx, ny);
      if (!p || !clear(p[0], p[2], 4)) continue;
      placeTree(p[0], p[2], h, 820 + k, p[1]);
    }
  }

  // ── The stargazer's island (bible 1.17): the spring and its rills, the slab
  //    bridge, the cove landing, the lookout bench. World coordinates. ──
  // Final run: lighter, teal, catching the aurora (the navy read as a line of
  // edging stones with nothing between them, a path to nowhere, in the a7 frame).
  const waterCol: RGB = [0.13, 0.22, 0.3];
  const waterHi: RGB = [0.28, 0.42, 0.5];
  const water = new Geo();
  const topY = (x: number, z: number) => I.y + islandTop(x, z);
  {
    // The spring: a round stone basin at the terrace's foot, water welling up.
    const S = ISLAND_SPRING;
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = S.x + Math.cos(a) * 8.2;
      const z = S.z + Math.sin(a) * 8.2;
      land.shape(BOX, T(x, topY(x, z) + 1.1, z, 4.6, 2.6 + rnd(i, 501) * 0.6, 2.6, -a + Math.PI / 2, 0, (rnd(i, 502) - 0.5) * 0.08), (cy) => (cy > 0.3 ? P.stoneLight : P.stone));
    }
    const wy = topY(S.x, S.z) + 1.7;
    for (let i = 0; i < 14; i++) {
      const a0 = (i / 14) * Math.PI * 2;
      const a1 = ((i + 1) / 14) * Math.PI * 2;
      water.tri([S.x, wy, S.z], [S.x + Math.cos(a1) * 6.8, wy, S.z + Math.sin(a1) * 6.8], [S.x + Math.cos(a0) * 6.8, wy, S.z + Math.sin(a0) * 6.8], waterHi, waterCol, waterCol);
    }
    addFootprint({ x: S.x, z: S.z, r: 10, kind: "prop" });
  }
  // The rills: from the basin to the rim (ISLAND_RILLS; their rim ends are
  // water.ts's island falls). The west rill bends round the terrace.
  const rills = ISLAND_RILLS.map((r, ri) => {
    const pts = r.map((q) => [q[0], q[2]] as [number, number]);
    if (ri === 1) {
      const keep = pts.filter((q, i) => i === 0 || i === pts.length - 1 || Math.hypot(q[0] - oPos.x, q[1] - oPos.z) > TERRACE.r + 12);
      const round: [number, number][] = [[-2010, -1622], [-2070, -1630], [-2132, -1612]];
      return [keep[0], ...round, ...keep.slice(1).filter((q) => q[0] < -2140)];
    }
    return pts;
  });
  let bridges = 0;
  const rillPts: [number, number][] = [];
  for (const pts of rills) {
    // A ribbon 3.6 wide with stone edging, sampled every ~6 along a smoothed line.
    const dense: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(L / 6));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        // A gentle meander across each segment.
        const w = Math.sin(t * Math.PI) * Math.sin(i * 2.1 + 1) * 5;
        dense.push([ax + (bx - ax) * t - ((bz - az) / L) * w, az + (bz - az) * t + ((bx - ax) / L) * w]);
      }
    }
    dense.push(pts[pts.length - 1]);
    rillPts.push(...dense);
    let crossed = false;
    for (let i = 0; i < dense.length - 1; i++) {
      const [ax, az] = dense[i];
      const [bx, bz] = dense[i + 1];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / L;
      const nz = (bx - ax) / L;
      const hw = 1.8;
      const ya = topY(ax, az) + 0.6;
      const yb = topY(bx, bz) + 0.6;
      const onPath = trailDistFast((ax + bx) / 2, (az + bz) / 2) < 7;
      const col = i % 3 === 0 ? waterHi : waterCol;
      water.quad([ax + nx * hw, ya, az + nz * hw], [bx + nx * hw, yb, bz + nz * hw], [bx - nx * hw, yb, bz - nz * hw], [ax - nx * hw, ya, az - nz * hw], col, waterCol);
      // Edging stones either side, every other step.
      if (i % 2 === 0 && !onPath)
        for (const sd of [-1, 1]) {
          const x = ax + nx * sd * (hw + 1.1);
          const z = az + nz * sd * (hw + 1.1);
          land.shape(BOX, T(x, topY(x, z) + 0.15, z, 2 + rnd(i, 511 + sd) * 1.2, 0.6, 1.6, Math.atan2(-(bz - az), bx - ax) + (rnd(i, 513) - 0.5) * 0.5), scale(P.stone, 0.85 + 0.15 * rnd(i + sd, 514)));
        }
      // The slab bridge where the rill crosses the path.
      if (onPath && !crossed) {
        crossed = true;
        bridges++;
        const cx = (ax + bx) / 2;
        const cz = (az + bz) / 2;
        const ry = Math.atan2(-(bz - az), bx - ax);
        const y = topY(cx, cz);
        land.shape(BOX, T(cx, y + 1.3, cz, 7.5, 1.2, 11, ry), (cy) => (cy > 0.3 ? P.stoneLight : P.stone));
        for (const sd of [-1, 1]) land.shape(BOX, T(cx + nx * sd * 4.2, y + 0.4, cz + nz * sd * 4.2, 3.2, 1.6, 11.6, ry), P.stoneDark);
      }
    }
    addPathLine(dense.map(([x, z]) => ({ x, z })), 4, "water");
  }
  {
    // The cove landing: a stone platform where the steps arrive, two lantern posts.
    const [cx, , cz] = STEPS_TOP;
    const y = topY(cx, cz);
    const b0 = (Math.atan2(ISLAND_PATH[1][0] - cx, -(ISLAND_PATH[1][2] - cz)) * 180) / Math.PI;
    const [px, pz] = dirOf(b0 + 90);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const r0 = 17 + rnd(i, 521) * 2;
      const r1 = 17 + rnd(i + 1, 521) * 2;
      land.tri([cx, y + 0.5, cz], [cx + Math.cos(a1) * r1, y + 0.5, cz + Math.sin(a1) * r1], [cx + Math.cos(a0) * r0, y + 0.5, cz + Math.sin(a0) * r0], scale(i % 2 ? P.flag : P.stone, 0.92 + 0.1 * rnd(i, 522)));
    }
    for (const sd of [-1, 1]) {
      const x = cx + px * sd * 13;
      const z = cz + pz * sd * 13;
      const y0 = topY(x, z);
      land.beam([x, y0, z], [x, y0 + 11, z], 0.6, P.brownDark, 4);
      land.shape(BOX, T(x, y0 + 11.2, z, 1.6, 0.4, 1.6), P.brownDark);
      cagedLantern(land, glow, flames, halos, x, y0 + 13.2, z, 0.95, 10);
    }
    addFootprint({ x: cx, z: cz, r: 19, kind: "prop", shade: 0.2 });
  }
  {
    // The lookout bench on the north-east tip, facing out (ISLAND_LOOKOUT).
    const Lk = ISLAND_LOOKOUT;
    const [fx, fz] = dirOf(Lk.facing);
    const [sx, sz] = dirOf(Lk.facing + 90);
    const ry = yawTo(Lk.facing + 90);
    const y = topY(Lk.x, Lk.z);
    land.shape(BOX, T(Lk.x, y + 4.2, Lk.z, 15, 1.4, 4.6, ry), (cy) => (cy > 0.3 ? P.stoneLight : P.stone));
    for (const sd of [-1, 1]) land.shape(BOX, T(Lk.x + sx * sd * 5.4, y + 1.8, Lk.z + sz * sd * 5.4, 2.2, 3.8, 3.8, ry), P.stoneDark);
    // A cairn beside it.
    for (let k = 0; k < 4; k++) boulder(land, Lk.x + sx * 11 - fx * 2, y + k * 2.1, Lk.z + sz * 11 - fz * 2, 2.6 - k * 0.5, 530 + k);
    addFootprint({ x: Lk.x, z: Lk.z, r: 10, kind: "prop" });
  }
  addFootprint({ x: oPos.x, z: oPos.z, r: TERRACE.r + 2, kind: "landmark" });
  {
    const [dx, dz] = dirOf(OBSERVATORY.facing);
    const d = TERRACE.r + (TERRACE.steps * TERRACE.run) / 2;
    addFootprint({ x: oPos.x + dx * d, z: oPos.z + dz * d, r: TERRACE.stairW / 2 + 3, kind: "building" });
  }
  addPathLine(ISLAND_PATH.map((q) => ({ x: q[0], z: q[2] })), 6);
  void bridges;
  a7Ground(rillPts);

  // The bounty isle's set (plan item 18). The Ad Bounty's board (bounty.ts) is
  // a landmark of its own, LM_Bounty, built here into boardG and parented
  // below; its lanterns' glass, flames and halos join the island's. Behind it
  // the supplies, which stood on the walk at the board's end until the camera
  // went through them (Lovro, 13:44: "we definitely don't want to go through
  // the crates"). Nothing stands within 30 of the walk from the bridge to the
  // gangway but the berth's posts, as before.
  const mooringRopes = new Geo();
  const boardG = new Geo();
  {
    const [wx, wz] = dirOf(BOUNTY.walk);
    const [fx, fz] = dirOf(BOUNTY.facing);
    const [rx, rz] = dirOf(BOUNTY.facing - 90);
    const ry = yawTo(BOUNTY.facing - 90);
    const y = B.y;
    buildBountyBoard(boardG, glow, flames, halos);
    /** A point of the board's frame (f out of its face, s to the right seen from the front), in plan. */
    const at = (f: number, s: number): [number, number] => [BOUNTY.x + fx * f + rx * s, BOUNTY.z + fz * f + rz * s];
    // The crate stack and the barrels, behind the board.
    {
      const [c1x, c1z] = at(-11.5, -8.5);
      const [c2x, c2z] = at(-12.5, -17);
      const [c3x, c3z] = at(-11.8, -12.2);
      const [b1x, b1z] = at(-9.5, 1.5);
      const [b2x, b2z] = at(-13.5, 4.8);
      crate(land, c1x, y, c1z, 8.4, ry + 0.2, 21);
      crate(land, c2x, y, c2z, 7.6, ry - 0.15, 22);
      crate(land, c3x, y + 8.4, c3z, 6.8, ry + 0.5, 23);
      barrel(land, b1x, y, b1z, 1.4, 24);
      barrel(land, b2x, y, b2z, 1.25, 25);
    }
    // Pale grass tufts over the top, off the walk and the board's set (cover.ts grows only the Sky Island's).
    for (let k = 0; k < 340; k++) {
      const a = rnd(k, 171) * Math.PI * 2;
      const rr = Math.sqrt(rnd(k, 172)) * (bountyRim(a) - 6);
      const x = B.x + Math.sin(a) * rr;
      const z = B.z - Math.cos(a) * rr;
      const along = (x - BRIDGE.b[0]) * wx + (z - BRIDGE.b[2]) * wz;
      const off = Math.abs((x - BRIDGE.b[0]) * -wz + (z - BRIDGE.b[2]) * wx);
      if (off < 30 && along > -10 && along < 250) continue;
      // The footing, the stand, the bench and the supplies.
      const lf = (x - BOUNTY.x) * fx + (z - BOUNTY.z) * fz;
      const ls = (x - BOUNTY.x) * rx + (z - BOUNTY.z) * rz;
      if (lf > -18 && lf < 16 && ls > -22 && ls < 20) continue;
      const hgt = 2.2 + rnd(k, 173) * 2.2;
      for (let b = 0; b < 3; b++) {
        const ba = (b / 3) * Math.PI + a;
        const w = 0.8 + rnd(k, 174) * 0.4;
        const tipC = rnd(k + b, 175) < 0.5 ? P.grassDry : P.grass;
        land.tri([x - Math.cos(ba) * w, y, z - Math.sin(ba) * w], [x + Math.cos(ba) * w, y, z + Math.sin(ba) * w], [x + Math.cos(ba + 0.7) * 0.9, y + hgt, z + Math.sin(ba + 0.7) * 0.9], P.grass, P.grass, tipC);
      }
    }
    // The berth: gangway plank, bollards, mooring ropes to the hull.
    const h = SHIP_MOORED.heading;
    const [hx, hz] = dirOf(h);
    const sx = SHIP_MOORED.x - hx * L2;
    const sz = SHIP_MOORED.z - hz * L2;
    land.shape(BOX, T(sx - hx * 7, y + 0.3, sz - hz * 7, 18, 0.9, 9, yawTo(h)), P.plank);
    const toWorld = (lx0: number, ly0: number, lz0: number): V3 => {
      const [cx0, cz0] = dirOf(h + 90);
      return [SHIP_MOORED.x + hx * lx0 + cx0 * lz0, SHIP_MOORED.y + ly0, SHIP_MOORED.z + hz * lx0 + cz0 * lz0];
    };
    for (const s of [-1, 1]) {
      const [ox, oz] = dirOf(h + 90 * s);
      const bpx = sx - hx * 12 + ox * 17;
      const bpz = sz - hz * 12 + oz * 17;
      land.shape(prismShape(8, 1, 0.8, true, false), T(bpx, y, bpz, 1.6, 5.4, 1.6), P.brownDark);
      land.shape(prismShape(8, 1, 1, true, false), T(bpx, y + 5.4, bpz, 2.1, 0.8, 2.1), P.brownDark);
      mooringRopes.rope([bpx, y + 4.8, bpz], toWorld(-50, 3, s * 13.6), 2.2, 0.35, P.rope, 5);
    }
    // Two lantern posts at the gangway.
    for (const s of [-1, 1]) {
      const [ox, oz] = dirOf(h + 90 * s);
      const lpx = sx - hx * 22 + ox * 13;
      const lpz = sz - hz * 22 + oz * 13;
      land.beam([lpx, y, lpz], [lpx, y + 8.6, lpz], 0.55, P.brownDark, 4);
      land.shape(BOX, T(lpx, y + 8.7, lpz, 1.5, 0.4, 1.5), P.brownDark);
      // Pass 3 (skyharbour): the kit's caged lantern with a flame, in place of the cream box.
      cagedLantern(land, glow, flames, halos, lpx, y + 10.6, lpz, 0.85, 8);
    }
  }

  // The bridge's ends: timber posts, a gate beam, anchor ropes, lantern posts.
  {
    const bA = new THREE.Vector3(...BRIDGE.a);
    const bB = new THREE.Vector3(...BRIDGE.b);
    const span = Math.hypot(bB.x - bA.x, bB.z - bA.z);
    const ux = (bB.x - bA.x) / span;
    const uz = (bB.z - bA.z) / span;
    const nx = -uz;
    const nz = ux;
    const HW = BRIDGE.width / 2;
    for (const [end, out] of [[0, -1], [1, 1]] as const) {
      const ex = bA.x + (bB.x - bA.x) * end;
      const ez = bA.z + (bB.z - bA.z) * end;
      const ey = bridgeDeckAt(end);
      const px = ex + ux * out * 2;
      const pz = ez + uz * out * 2;
      for (const s of [-1, 1]) {
        const x = px + nx * s * (HW + 1.3);
        const z = pz + nz * s * (HW + 1.3);
        land.shape(BOX, T(x, ey + 7, z, 2.2, 20, 2.2, Math.atan2(-uz, ux)), P.brown);
        land.shape(BOX, T(x, ey + 17.4, z, 2.8, 0.9, 2.8, Math.atan2(-uz, ux)), P.brownDark);
        // Anchor rope to a stake behind.
        const sx0 = x + ux * out * 16 + nx * s * 3;
        const sz0 = z + uz * out * 16 + nz * s * 3;
        land.rope([x, ey + 15, z], [sx0, ey + 0.8, sz0], 1, 0.38, P.rope, 3);
        land.shape(BOX, T(sx0, ey + 1, sz0, 1.2, 3, 1.2), P.brownDark);
        // Lantern posts outside the gate.
        const lx0 = px + nx * s * (HW + 5.5) + ux * out * 3;
        const lz0 = pz + nz * s * (HW + 5.5) + uz * out * 3;
        land.beam([lx0, ey - 2, lz0], [lx0, ey + 20, lz0], 0.6, P.brownDark, 4);
        land.beam([lx0, ey + 20, lz0], [lx0 - nx * s * 3, ey + 20, lz0 - nz * s * 3], 0.45, P.brownDark, 4);
        land.beam([lx0 - nx * s * 3, ey + 20, lz0 - nz * s * 3], [lx0 - nx * s * 3, ey + 19, lz0 - nz * s * 3], 0.12, P.iron, 3);
        cagedLantern(land, glow, flames, halos, lx0 - nx * s * 3, ey + 16.6, lz0 - nz * s * 3, 1, 11);
      }
      // The gate beam over the deck (the camera walks 12 over the deck: 5 clear).
      const g0: V3 = [px + nx * (HW + 2.6), ey + 17.2, pz + nz * (HW + 2.6)];
      const g1: V3 = [px - nx * (HW + 2.6), ey + 17.2, pz - nz * (HW + 2.6)];
      land.beam(g0, g1, 0.9, P.brownDark, 4);
    }
  }

  // Cloud round the islands' waists (seen from the lake, the forest, the rise).
  const clouds = new Geo();
  let cloudClusters = 0;
  for (let k = 0; k < 9; k++) {
    const b = k * 40 + rnd(k, 121) * 20;
    const [dx, dz] = dirOf(b);
    const r = 250 + rnd(k, 122) * 80;
    const y = I.y - 170 - rnd(k, 123) * 90;
    const x = I.x + dx * r;
    const z = I.z + dz * r;
    const w = 105 + rnd(k, 124) * 65;
    // Integrator: no exclusion behind the Great Tree; the a6 frame measured the same with the ring (dress-sky report).
    if (railDist(x, y + w * 0.2, z) < w * 0.6 + 40) continue;
    cloud(clouds, x, y, z, w, 6, 300 + k, true);
    cloudClusters++;
  }
  for (let k = 0; k < 3; k++) {
    const b = 60 + k * 120;
    const [dx, dz] = dirOf(b);
    const x = B.x + dx * 60;
    const z = B.z + dz * 60;
    const y = B.y - 70 - k * 12;
    if (railDist(x, y, z) < 90) continue;
    cloud(clouds, x, y, z, 90, 5, 400 + k, true);
    cloudClusters++;
  }
  // The flight's cloud sea: on top of light.ts's layer, clear of the high basin and the peaks.
  {
    const CL = WORLD.cloudLevel;
    const clear = WORLD.cloudClear;
    for (let gx = -5200; gx < 2000; gx += SEA_CELL)
      for (let gz = -7600; gz < -600; gz += SEA_CELL) {
        const i = Math.round(gx / SEA_CELL) * 131 + Math.round(gz / SEA_CELL);
        if (rnd(i, 131) > SEA_KEEP) continue;
        const x = gx + rnd(i, 132) * SEA_CELL;
        const z = gz + rnd(i, 133) * SEA_CELL;
        if (Math.hypot(x - clear.x, z - clear.z) < clear.r + 150) continue;
        if (ctx.terrainHeight(x, z) > CL - 60) continue;
        if (Math.hypot(x - I.x, z - I.z) < 380) continue;
        const w = 200 + rnd(i, 134) * 260;
        cloud(clouds, x, CL - 30 + rnd(i, 135) * 40, z, w, 5 + Math.floor(rnd(i, 136) * 3), 700 + i, false);
        cloudClusters++;
      }
  }

  // Round 1: the Gate bank (GATE_BANK, gateBank), its own mesh so it shows only from the heights.
  const bank = new Geo();
  const bankClusters = gateBank(bank);
  {
    // The bank stores light, not colour, as clouds.ts's sky clouds do: 0 is
    // the live key's cloud base, 1 its cloud top (bankMat below takes both
    // from the live light every frame). One ramp for the whole bank, by
    // height (each cluster's own base-to-top ramp stacked into stripes), a
    // little lighter where a puff faces up.
    const lo = GATE_BANK.base - 30;
    const hi = gateBankTop(BANK_ARCH.x0 + 1) + 10;
    const nb = bank.n ?? [];
    for (let i = 0; i < bank.c.length; i += 3) {
      const t = 0.8 * smooth(lo, hi, bank.p[i + 1]) + 0.2 * Math.max(0, nb[i + 1] ?? 0);
      bank.c[i] = t;
      bank.c[i + 1] = t;
      bank.c[i + 2] = t;
    }
  }

  addMesh(root, land, solid, "Sky_Land");
  // Cheap laptops (overdraw): the a7 ground and the observatory draw before the
  // world's terrain and sea (renderOrder 0 and 900), which lie far below them in
  // a7's frame (a7 p99 6 -> 5). Sky_Land stays at 0: it is also the Glowing
  // Forest's floor, where the trees must draw first (measured: a6 got worse).
  if (a7g.tris) {
    const a7m = addMesh(root, a7g, solid, "Sky_A7Ground");
    a7m.layers.set(NO_REFLECT_LAYER);
    a7m.renderOrder = -1;
  }
  addMesh(root, glow, glowMat, "Sky_Glow");
  addMesh(root, water, waterMat, "Sky_Rills");
  const cloudMesh = addMesh(root, clouds, cloudMat, "Sky_Clouds");
  cloudMesh.renderOrder = 1;
  // Second Loom: lit as day cloud by the night's moon the smaller bank read as
  // a bright blue stack, so it is coloured as the painted clouds are, by the
  // live key's cloud base and top (light.ts), whatever the hour.
  const bankU = { uBase: { value: new THREE.Color(...P.cloudBase) }, uTop: { value: new THREE.Color(...P.cloudTop) } };
  const bankMat = track(new THREE.MeshBasicMaterial({ vertexColors: true }));
  bankMat.name = "SkyGateBank";
  bankMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, bankU);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uBase;\nuniform vec3 uTop;")
      .replace("#include <color_fragment>", "diffuseColor.rgb *= mix(uBase, uTop, vColor.r);");
  };
  bankMat.customProgramCacheKey = () => "sky-gate-bank";
  const liveLight = (ctx.scene.userData.light as LightModule | undefined) ?? null;
  const bankMesh = addMesh(root, bank, bankMat, "Sky_GateBank");
  bankMesh.renderOrder = 1;
  bankMesh.visible = false;
  const ropesMesh = addMesh(root, mooringRopes, solid, "Sky_MooringRopes");
  addHalos(root, halos, "Sky_Halos");
  addFlames(root, flames, "Sky_Flames");

  // ── The Ad Bounty's board, in LM_Bounty (bounty.ts) ──
  // Its own group, so the scene makes it a landmark: the bounty checkpoint's
  // marker pins over it, a click on it opens the checkpoint, the pointer
  // lights it. One more call while the isle is in the frame. It stays out of
  // the Mirror Lake's reflection, where the isle is a few pixels.
  {
    const lmBounty = new THREE.Group();
    lmBounty.name = BOUNTY.mesh;
    root.add(lmBounty);
    addMesh(lmBounty, boardG, solid, "Bounty_Board").layers.set(NO_REFLECT_LAYER);
  }

  // ── The observatory, in LM_Observatory ──
  const lm = ctx.root.getObjectByName(a7.mesh) ?? ctx.scene.getObjectByName(a7.mesh);
  if (lm) {
    const og = new Geo();
    const ogl = new Geo();
    const ol: number[] = [];
    const ofl: number[] = [];
    buildObservatory(og, ogl, ol, ofl);
    // Blocks' LM groups sit at the place's pos; build local, parent there.
    addMesh(lm, og, solid, "Observatory_Art").renderOrder = -1;
    addMesh(lm, ogl, glowMat, "Observatory_Glow");
    addHalos(lm, ol, "Observatory_Halos");
    addFlames(lm, ofl, "Observatory_Flames");
  }

  // ── The rope bridge, in blocks' sway group (local +x along a -> b, origin at a) ──
  const sway = ctx.root.getObjectByName("RopeBridge_Sway") ?? ctx.root.getObjectByName("RopeBridge_Block")?.parent ?? null;
  if (sway) {
    const bA = new THREE.Vector3(...BRIDGE.a);
    const bB = new THREE.Vector3(...BRIDGE.b);
    const span = Math.hypot(bB.x - bA.x, bB.z - bA.z);
    const deckAt = (u: number) => bridgeDeckAt(u) - bA.y;
    const HW = BRIDGE.width / 2;
    const bg = new Geo();
    const planks = Math.round(span / 2.6);
    for (let i = 0; i <= planks; i++) {
      const u = i / planks;
      if (i > 12 && i < planks - 12 && rnd(i, 141) < 0.04) continue;
      const col = rnd(i, 142) < 0.33 ? P.plank : rnd(i, 142) < 0.66 ? P.plank2 : P.plank3;
      bg.shape(BOX, T(u * span, deckAt(u) - 0.3, (rnd(i, 143) - 0.5) * 0.6, 1.9, 0.55, BRIDGE.width + 1.2 + (rnd(i, 144) - 0.5), (rnd(i, 145) - 0.5) * 0.06), col);
    }
    const RSEG = 32;
    const handAt = (u: number) => deckAt(u) + 7 + 4.5 * (1 - 4 * u * (1 - u));
    for (const side of [-1, 1]) {
      const zr = side * (HW + 0.5);
      for (let i = 0; i < RSEG; i++) {
        const u0 = i / RSEG;
        const u1 = (i + 1) / RSEG;
        bg.beam([u0 * span, handAt(u0), zr], [u1 * span, handAt(u1), zr], 0.42, P.rope, 4);
        bg.beam([u0 * span, deckAt(u0) - 0.8, side * (HW - 0.3)], [u1 * span, deckAt(u1) - 0.8, side * (HW - 0.3)], 0.55, P.rope, 4);
        // Crossed side netting.
        bg.beam([u0 * span, handAt(u0), zr], [u1 * span, deckAt(u1) - 0.5, side * HW], 0.2, P.rope, 3);
        bg.beam([u1 * span, handAt(u1), zr], [u0 * span, deckAt(u0) - 0.5, side * HW], 0.2, P.rope, 3);
        // Pennants hanging off the hand rope, every fourth piece.
        if (i % 4 === 2) {
          const um = (u0 + u1) / 2;
          const x = um * span;
          const y = handAt(um);
          bg.tri([x - 1.6, y - 0.3, zr + side * 0.3], [x + 1.6, y - 0.3, zr + side * 0.3], [x + 0.3, y - 5.2, zr + side * 0.8], i % 8 === 2 ? P.cream : P.canvas);
        }
      }
    }
    const bm = addMesh(sway, bg, solid, "RopeBridge_Art");
    bm.frustumCulled = true;
  }

  let shipLampsLocal: number[] = [];
  // ── Your airship, in blocks' Airship_yours group ──
  const shipGroup = ctx.root.getObjectByName("Airship_yours") ?? ctx.scene.getObjectByName("Airship_yours");
  const props: THREE.Mesh[] = [];
  if (shipGroup) {
    const sg = new Geo();
    const sgl = new Geo();
    const sl: number[] = [];
    shipLampsLocal = sl;
    const sf: number[] = [];
    buildAirship(sg, sgl, sl, { hero: true, flames: sf });
    const art = addMesh(shipGroup, sg, shipMat, "Airship_Art");
    // The deck lantern on its hook (x 33) lights the cargo and the planks round
    // it; the two aft side lanterns (x -26) a little of the rail and hull; the
    // aft cabin's lamplight spills forward over the near deck (its door is
    // under the riding camera, out of frame).
    const sideZ = half(-26) + 1.5;
    const deckLamps: Array<[number, number, number, number, number]> = [
      [33, 8, -7.4, 32, 1],
      [-26, 2.6, sideZ, 12, 1],
      [-26, 2.6, -sideZ, 12, 1],
      [-44, 5, 0, 36, 0.45],
    ];
    art.geometry.setAttribute("aLamp", new THREE.Float32BufferAttribute(lampBake(sg, deckLamps), 3));
    addMesh(shipGroup, sgl, glowMat, "Airship_Glow");
    addHalos(shipGroup, sl, "Airship_Halos");
    addFlames(shipGroup, sf, "Airship_Flames");
    const pg = new Geo();
    buildPropeller(pg);
    const pgeo = track(pg.build());
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(pgeo, solid);
      m.name = `Airship_Prop${s < 0 ? "Port" : "Starboard"}`;
      m.position.set(PROP_AT[0], PROP_AT[1], s * PROP_AT[2]);
      m.rotation.x = s * 0.7;
      shipGroup.add(m);
      added.push(m);
      props.push(m);
      tris += pg.tris;
      meshes++;
    }
  }

  // ── The small ship looping over the harbour (blocks' Airship_loop group,
  //    origin at the envelope's axis, scaled 1.3 there): the kit, in place of
  //    blocks' own small ship, so every airship in the world is the same kind ──
  const loopGroup = ctx.root.getObjectByName("Airship_loop") ?? ctx.scene.getObjectByName("Airship_loop");
  if (loopGroup) {
    const kit = airshipKit(62, lin(0x5a6a80));
    const lg = new Geo();
    const lgl = new Geo();
    for (let i = 0; i < kit.p.length; i += 3) lg.p.push(kit.p[i], kit.p[i + 1] - kit.envY, kit.p[i + 2]);
    lg.c = kit.c;
    for (let i = 0; i < kit.gp.length; i += 3) lgl.p.push(kit.gp[i], kit.gp[i + 1] - kit.envY, kit.gp[i + 2]);
    lgl.c = kit.gc;
    const ll: number[] = [];
    for (let i = 0; i < kit.lamps.length; i += 4) ll.push(kit.lamps[i], kit.lamps[i + 1] - kit.envY, kit.lamps[i + 2], kit.lamps[i + 3]);
    addMesh(loopGroup, lg, solid, "Airship_loop_Art");
    addMesh(loopGroup, lgl, glowMat, "Airship_loop_Glow");
    addHalos(loopGroup, ll, "Airship_loop_Halos");
  }

  // ── Round F: the island meadow at night, from a7 to the bridge's head ──
  // After the telescope the view runs across the island top to the dock (the
  // 'island' mark): a flat dark field. This layer paints it as a night place:
  // moonlit swells in flat value steps, dark hollows with a thin mist line and
  // fireflies, warm light pooled round the path's lanterns, and the moored
  // ship's lanterns glowing. It fades in after a7 and out before the bridge's
  // head (NIGHT_FADE), so a7, its click-in, the bridge and the flight render
  // exactly as before (at weight 0 every piece is hidden). Nothing here is in
  // the lake's reflection (NO_REFLECT_LAYER). The meadow is a painted sheet
  // just over the island top (under the flagstones at +0.35) drawn with the
  // forest pools' material settings, so it adds no shader program.
  const nightGroup = new THREE.Group();
  nightGroup.name = "Sky_IslandNight";
  root.add(nightGroup);
  const meadowMat = track(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  meadowMat.name = "SkyMeadowNight";
  meadowMat.opacity = 0;
  const nightHaloMat = track(haloMaterial());
  delete nightHaloMat.userData.lightGlow;
  nightHaloMat.name = "SkyNightHalo";
  const fireflyMat = track(haloMaterial());
  delete fireflyMat.userData.lightGlow;
  fireflyMat.name = "SkyFirefly";
  const NIGHT_LAMP = new THREE.Color(1.25, 0.62, 0.26);
  const FIREFLY = new THREE.Color(1.05, 1.25, 0.45);
  {
    // The swells: bands across the 'island' view (bearing 34), warped by noise.
    const [fx, fz] = dirOf(34);
    const phase = (x: number, z: number) => ((x * fx + z * fz) / 165) * Math.PI * 2 + 3.4 * (vnoise(x / 240 + 2, z / 240 - 7) - 0.5) * 2;
    const swell = (x: number, z: number) => Math.sin(phase(x, z)) * 0.72 + (vnoise(x / 85 + 9, z / 85 + 4) - 0.5) * 0.6;
    // The moon's side (az 116, in plan (0.9, 0.44)) of a swell: the main wave's slope along it.
    const moonSlope = ((fx * 0.9 + fz * 0.44) * 0.72 * Math.PI * 2) / 165;
    const HOLLOW = lin(0x121a28);
    const BODY = lin(0x1f2c40);
    const LIT = lin(0x344a5c);
    const CREST = lin(0x4f6878);
    const MIST = lin(0x303c56);
    const WARM = lin(0xd08a44);
    const lamps = pathLamps;
    // Distance to the island's one path in plan (ISLAND_PATH: 6 segments, cheaper than trailDistFast per vertex).
    const pathDist = (x: number, z: number) => {
      let m = 1e9;
      for (let i = 0; i < ISLAND_PATH.length - 1; i++) {
        const [ax, , az] = ISLAND_PATH[i];
        const [bx, , bz] = ISLAND_PATH[i + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        m = Math.min(m, Math.hypot(x - ax - dx * u, z - az - dz * u));
      }
      return m;
    };
    const paint = (x: number, z: number): RGB => {
      const ph = phase(x, z);
      const h = Math.sin(ph) * 0.72 + (vnoise(x / 85 + 9, z / 85 + 4) - 0.5) * 0.6;
      // The moon's side of a swell a little brighter than its lee.
      const side = -Math.cos(ph) * moonSlope * 60;
      const v = h + 0.35 * Math.max(-1, Math.min(1, side));
      let c = mix(HOLLOW, BODY, smooth(-0.55, -0.4, v));
      c = mix(c, LIT, smooth(0.12, 0.26, v));
      c = mix(c, CREST, smooth(0.62, 0.74, v) * 0.7);
      // A thin mist line along the bottom of each hollow.
      c = mix(c, MIST, (1 - smooth(0.04, 0.12, Math.abs(v + 0.72))) * 0.8);
      // Lantern light pooled on the grass, and a faint warm ribbon on the path.
      let warm = 0;
      for (let i = 0; i < lamps.length; i += 3) {
        const d = Math.hypot(x - lamps[i], z - lamps[i + 2]);
        if (d < 30) warm = Math.max(warm, (1 - d / 30) ** 2);
      }
      warm = Math.max(warm, 0.22 * (1 - smooth(4, 12, pathDist(x, z))));
      return mix(c, WARM, warm * 0.75);
    };
    const mg = new Geo();
    const SEG = 160;
    const RINGS = 38;
    const at = (i: number, k: number): V3 => {
      const th = (i / SEG) * Math.PI * 2;
      const f = 0.985 * Math.sqrt(k / RINGS);
      const r = islandRim(th) * f;
      const x = I.x + Math.sin(th) * r;
      const z = I.z - Math.cos(th) * r;
      const top = islandTop(x, z);
      return [x, I.y + top + 0.15 + 3.5 * smooth(0.3, 4, top), z];
    };
    const col: RGB[][] = [];
    const pos: V3[][] = [];
    for (let k = 0; k <= RINGS; k++) {
      pos.push([]);
      col.push([]);
      for (let i = 0; i <= SEG; i++) {
        const p = at(i % SEG, k);
        pos[k].push(p);
        col[k].push(paint(p[0], p[2]));
      }
    }
    for (let k = 0; k < RINGS; k++)
      for (let i = 0; i < SEG; i++) {
        const a = pos[k][i], b = pos[k][i + 1], c = pos[k + 1][i + 1], d = pos[k + 1][i];
        if (k > 0) mg.tri(a, b, c, col[k][i], col[k][i + 1], col[k + 1][i + 1]);
        mg.tri(a, c, d, col[k][i], col[k + 1][i + 1], col[k + 1][i]);
      }
    const mm = addMesh(nightGroup, mg, meadowMat, "Sky_MeadowNight");
    mm.layers.set(NO_REFLECT_LAYER);
    // Fireflies over the hollows the 'island' view looks across.
    const ff: number[] = [];
    const cx = -2195;
    const cz = -1575;
    for (let i = 0; i < 900 && ff.length < 90 * 4; i++) {
      const b = 34 + (rnd(i, 951) - 0.5) * 62;
      const dist = 40 + 520 * rnd(i, 952) ** 0.8;
      const [dx, dz] = dirOf(b);
      const x = cx + dx * dist;
      const z = cz + dz * dist;
      const bb = (Math.atan2(x - I.x, -(z - I.z)) / DEG + 360) % 360;
      if (Math.hypot(x - I.x, z - I.z) > islandRim(bb * DEG) - 20) continue;
      if (swell(x, z) > -0.25 || trailDistFast(x, z) < 8 || Math.hypot(x - oPos.x, z - oPos.z) < TERRACE.r + 10) continue;
      ff.push(x, I.y + islandTop(x, z) + 1.5 + rnd(i, 953) * 6, z, 0.22 + rnd(i, 954) * 0.25);
    }
    const fp = addHalos(nightGroup, ff, "Sky_Fireflies");
    if (fp) {
      fp.material = fireflyMat;
      fp.layers.set(NO_REFLECT_LAYER);
      fp.onBeforeRender = (renderer, _s, camera) => {
        haloScale(renderer, camera);
        fireflyMat.uniforms.uScale.value = haloMat.uniforms.uScale.value;
      };
    }
    // Bigger warm halos on the path's lanterns.
    const lh: number[] = [];
    for (let i = 0; i < lamps.length; i += 3) lh.push(lamps[i], lamps[i + 1], lamps[i + 2], 18);
    const lp = addHalos(nightGroup, lh, "Sky_NightLampHalos");
    if (lp) {
      lp.material = nightHaloMat;
      lp.layers.set(NO_REFLECT_LAYER);
      lp.onBeforeRender = (renderer, _s, camera) => {
        haloScale(renderer, camera);
        nightHaloMat.uniforms.uScale.value = haloMat.uniforms.uScale.value;
      };
    }
  }
  // The moored ship's lanterns, glowing across the island (in the ship's group, so they ride with it).
  let shipNight: THREE.Points | null = null;
  if (shipGroup && shipLampsLocal.length) {
    const sh: number[] = [];
    for (let i = 0; i < shipLampsLocal.length; i += 4) sh.push(shipLampsLocal[i], shipLampsLocal[i + 1], shipLampsLocal[i + 2], 22);
    shipNight = addHalos(shipGroup, sh, "Airship_NightHalos");
    if (shipNight) {
      shipNight.material = nightHaloMat;
      shipNight.layers.set(NO_REFLECT_LAYER);
      shipNight.onBeforeRender = (renderer, _s, camera) => {
        haloScale(renderer, camera);
        nightHaloMat.uniforms.uScale.value = haloMat.uniforms.uScale.value;
      };
    }
  }
  const NIGHT_KEYS = TRAIL.length - 1;
  const kA7 = a7.trail;
  const kIsland = ROUTE_MARKS.island ?? kA7 + 1;
  const kBridge = ROUTE_MARKS.bridgehead ?? kIsland + 2;
  /** Round F: the layer's weight along the route: 0 at a7, 1 at the 'island' mark, 0 again just before the bridge's head. */
  const NIGHT_FADE = { inFrom: kA7 + 0.08, inTo: kIsland, outFrom: kIsland + 0.55, outTo: kBridge - 0.1 };
  const MEADOW_OPACITY = 0.92;
  let nightW = -1;
  let nightForce: number | null = null;
  nightGroup.userData.setWeight = (w: number | null) => {
    nightForce = w;
  };
  const applyNight = (w: number) => {
    nightGroup.visible = w > 0.002;
    meadowMat.opacity = MEADOW_OPACITY * w;
    nightHaloMat.uniforms.uColor.value.copy(NIGHT_LAMP).multiplyScalar(w);
    fireflyMat.uniforms.uColor.value.copy(FIREFLY).multiplyScalar(w);
    if (shipNight) shipNight.visible = nightGroup.visible && pose.phase === "moored";
  };

  // ── Frame loop ──
  const pose: ShipPose = { x: 0, y: 0, z: 0, heading: 0, bank: 0, throttle: 0, phase: "moored" };
  const camPos = new THREE.Vector3();
  const shipPos = new THREE.Vector3();
  const frustum = new THREE.Frustum();
  const pm = new THREE.Matrix4();
  const shipSphere = new THREE.Sphere(new THREE.Vector3(), 110);
  let animating = false;
  let lastSky = true;
  let lastRopes = true;
  let lastBank = false;
  const update = (_time: number, dt: number): boolean => {
    let changed = false;
    ctx.camera.getWorldPosition(camPos);
    // Hidden from the southern lowlands, where the high ridge hides the sky (blocks' Zone_sky rule).
    const sky = !(camPos.z > 1000 && camPos.y < 1200);
    if (sky !== lastSky) {
      root.visible = sky;
      lastSky = sky;
      changed = true;
    }
    const bankOn = camPos.y > GATE_BANK.showAbove;
    if (bankOn !== lastBank) {
      bankMesh.visible = bankOn;
      lastBank = bankOn;
      changed = true;
    }
    // The live light's cloud colours (light.ts updates first and asks for the frame when they change).
    if (bankOn && liveLight) {
      bankU.uBase.value.copy(liveLight.state.cloudBase);
      bankU.uTop.value.copy(liveLight.state.cloudTop);
    }
    ctx.shipPose(pose);
    const ropes = pose.phase === "moored" && (!shipGroup || shipGroup.visible);
    if (ropes !== lastRopes) {
      ropesMesh.visible = ropes;
      lastRopes = ropes;
      changed = true;
    }
    {
      const key = ctx.railU() * NIGHT_KEYS;
      const w = nightForce ?? smooth(NIGHT_FADE.inFrom, NIGHT_FADE.inTo, key) * (1 - smooth(NIGHT_FADE.outFrom, NIGHT_FADE.outTo, key));
      if (Math.abs(w - nightW) > 1e-4) {
        nightW = w;
        applyNight(w);
        changed = true;
      }
    }
    animating = false;
    if (shipGroup && shipGroup.visible && props.length && !reduced) {
      shipGroup.getWorldPosition(shipPos);
      pm.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pm);
      shipSphere.center.copy(shipPos);
      // Only while the ship is near and on screen: the loop sleeps at a8, where it is behind the camera.
      if (shipPos.distanceTo(camPos) < 1400 && frustum.intersectsSphere(shipSphere)) {
        const w = PROP_IDLE + (PROP_FULL - PROP_IDLE) * pose.throttle;
        const step = Math.min(0.1, dt) * w;
        props[0].rotation.x -= step;
        props[1].rotation.x += step;
        animating = true;
        changed = true;
      }
    }
    return changed;
  };

  const buildMs = Math.round(performance.now() - t0);
  return {
    name: "dress-sky",
    update,
    isAnimating: () => animating,
    dispose() {
      for (const o of added) o.parent?.remove(o);
      for (const d of disposables) d.dispose();
    },
    stats() {
      return {
        triangles: Math.round(tris),
        meshes,
        trees: treeCount,
        cloudClusters,
        gateBankClusters: bankClusters,
        gateBankTris: bank.tris,
        buildMs,
      };
    },
  };
};
