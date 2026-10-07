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
 *     - the bounty isle: its body, the quest board with pinned notices and a
 *       roof, a lantern on a crook post, a crate stack, a barrel, a bench, two
 *       spires, the berth's bollards and gangway, the mooring ropes (shown only
 *       while your ship is moored)
 *     - the bridge's end posts, gate beams and lantern posts (static; the deck
 *       and ropes sway with blocks' group)
 *     - cloud: a ring round the island's waist and the bounty isle's, so their
 *       bases dissolve; the flight's cloud sea, flat bottomed cumulus on top of
 *       light.ts's cloud layer, thinning with distance, peaks left as islands
 *   Inside blocks' own groups (so blocks keeps placing and animating them):
 *     - LM_Observatory: the crafted observatory (stepped octagonal plinth,
 *       coursed stone drum, walkway with a railing, copper dome with brass
 *       ribs and a dark slit, a brass telescope out of the slit on blocks'
 *       exact axis, a lit doorway with its light pool, lit windows, the annex,
 *       the low wall, a table of star charts and a bench)
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
 *   stays (surfaces.ts re-skins it).
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
import { BOUNTY_DEPTH, BRIDGE, ISLAND_DEPTH, LOOK, PATH, PLACES, SHIP, SHIP_MOORED, TRAIL, WORLD, bridgeDeckAt } from "./layout";
import { railDist, trailDistFast } from "./rocks";

// ── Tunables ────────────────────────────────────────────────────────────────

/** Spires on the island top (placed, before the framing clump). */
const ISLAND_TREES = 135;
/** Cloud sea: jittered grid cell, share of cells kept, puffs per cluster. */
const SEA_CELL = 460;
const SEA_KEEP = 0.62;
/** Envelope: centre x, centre height over the deck, half length, radii (y, z). */
const ENV = { x: -4, y: 58, len: 74, ry: 21, rz: 24 };
/** Propeller turn rate, radians per second: idle and at full throttle. */
const PROP_IDLE = 1.4;
const PROP_FULL = 9;

// ── Palette (display sRGB hex; linear on load) ──────────────────────────────

type RGB = [number, number, number];
type V3 = [number, number, number];
const lin = (hex: number, k = 1): RGB => {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
};
const P = {
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
  tarp: lin(0x9c9a86),
  chart: lin(0xe8dcbc),
  moss2: lin(0x4c5a3c),
  grassGold: lin(0xb4a26a),
  grassDeep: lin(0x46553a),
};
/** Unlit glow (above 1 on purpose, as blocks' G: it reads as light after tone mapping). */
const GL = {
  lamp: [1.25, 0.58, 0.16] as RGB,
  window: [1.1, 0.58, 0.2] as RGB,
  windowDeep: [1.3, 0.56, 0.14] as RGB, // pass 3: the drum windows, deeper amber so they read as lit
  pool: [0.24, 0.12, 0.035] as RGB,
  airLamp: [1.2, 0.66, 0.24] as RGB,
  /** Pass 3: a caged lantern's glass, deep amber (the flame sprite carries the bright core). */
  glass: [0.95, 0.4, 0.09] as RGB,
};

// ── Small helpers ───────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
/** Seeded 0..1 (blocks.ts's rnd: the island's jag must match it exactly). */
function rnd(i: number, s = 0): number {
  const v = Math.sin(i * 127.1 + s * 311.7 + 17.3) * 43758.5453;
  return v - Math.floor(v);
}
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Horizontal unit vector for a compass bearing (0 = -z, 90 = +x). */
const dirOf = (b: number): [number, number] => [Math.sin(b * DEG), -Math.cos(b * DEG)];
/** Yaw that turns local +x toward a compass bearing. */
const yawTo = (b: number) => (90 - b) * DEG;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
/** Cheap smooth value noise, 0..1. */
function vnoise(x: number, z: number): number {
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
function T(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  return _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)).clone();
}

/**
 * Geometry soup: non-indexed triangles with a colour per vertex. Solids are
 * drawn flat shaded and double sided, so winding never matters for them.
 */
class Geo {
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
function prismShape(n: number, r0 = 1, r1 = 1, capTop = true, capBot = true, phase = 0): number[] {
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
function domeShape(n: number, rings: number): number[] {
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
const BOX = boxShape();

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
const LOW: ReadonlyArray<readonly [number, number]> = [
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
    let c = mix(P.grassDark, P.grass, smooth(0.25, 0.7, n));
    c = mix(c, P.grassDry, smooth(0.6, 0.85, n2) * 0.7);
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
function spur(g: Geo, x: number, y: number, z: number, r: number, len: number, seed: number): void {
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
function hangRoot(g: Geo, x: number, y: number, z: number, ox: number, oz: number, len: number, r: number, seed: number): void {
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
function spire(g: Geo, x: number, y: number, z: number, h: number, seed: number): void {
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
function cloud(g: Geo, x: number, y: number, z: number, w: number, puffs: number, seed: number, bottoms: boolean): void {
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

// ── The observatory (local to LM_Observatory, origin at PLACES[6].pos) ──────

/** Telescope axis, as blocks.ts: bearing 218, elevation 42, pivot 58 up, 58 long. */
const TEL = { bearing: 218, el: 42, pivotY: 58, len: 58 };
/** The door and the camera side: the a7 stop camera sits at bearing ~131 from the observatory. */
const DOOR_BEARING = 136;

/** A faceted boulder sunk into the ground at (x, y, z), a moss cap on its top. */
function boulder(g: Geo, x: number, y: number, z: number, r: number, seed: number): void {
  const n = 6 + Math.floor(rnd(seed, 401) * 3);
  const base = rnd(seed, 402) < 0.5 ? P.rock : P.rock2;
  g.shape(prismShape(n, 1, 0.5 + rnd(seed, 403) * 0.25, true, false, rnd(seed, 404) * 3), T(x, y - r * 0.3, z, r, r * (0.75 + rnd(seed, 405) * 0.5), r * (0.8 + rnd(seed, 406) * 0.4), rnd(seed, 407) * 6, (rnd(seed, 408) - 0.5) * 0.25, (rnd(seed, 409) - 0.5) * 0.25), (cy, i) =>
    cy > 0.9 ? P.moss2 : scale(cy > 0.5 ? base : P.rock3, 0.9 + 0.2 * rnd(i + seed, 410)),
  );
}

function buildObservatory(g: Geo, glow: Geo, lamps: number[], flames: number[]): void {
  // Stepped octagonal plinth.
  const oct = prismShape(8, 1, 1, true, false, Math.PI / 8);
  g.shape(oct, T(0, -2, 0, 38, 5, 38), P.stoneDark);
  g.shape(oct, T(0, 3, 0, 33, 4.6, 33), P.stone);
  // Steps up to the door.
  const [dx, dz] = dirOf(DOOR_BEARING);
  for (let s = 0; s < 3; s++) g.shape(BOX, T(dx * (32 + s * 3.2), 1.2 + (2 - s) * 2.1 - 1, dz * (32 + s * 3.2), 3.4, 2.2 + (2 - s) * 2.1, 16, yawTo(DOOR_BEARING)), P.stoneDark);
  // The drum (pass 3): eight real courses of dressed stone, each its own
  // ring, alternate courses set back a hair and turned half a block so the
  // joints stagger; blocks vary light to dark, the footing course is dark
  // and mossy, a pale string course under the cornice.
  for (let c = 0; c < 8; c++) {
    const ring = prismShape(20, 1, 1, false, false, (c % 2) * (Math.PI / 20));
    const rr = 24 - (c % 2) * 0.22;
    g.shape(ring, T(0, 7.6 + c * 5.3, 0, rr, 5.3, rr), (cy, i) => {
      const blk = Math.floor(i / 2) + c * 37;
      const v = rnd(blk, 3);
      const base = c === 0 ? (cy < 0.5 ? P.moss2 : P.stoneDark) : v < 0.3 ? P.stoneDark : v < 0.7 ? P.stone : P.stoneLight;
      return scale(base, 0.9 + 0.14 * rnd(blk, 4));
    });
    // A dark mortar line under each course.
    if (c > 0) g.shape(prismShape(20, 1, 1, false, false), T(0, 7.6 + c * 5.3 - 0.2, 0, 23.9, 0.4, 23.9), scale(P.stoneDark, 0.6));
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
  // An iron railing round the plinth's edge, open at the steps.
  for (let i = 1; i < 8; i++) {
    const t0 = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const t1 = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8;
    const p0: V3 = [Math.cos(t0) * 32, 7.6, Math.sin(t0) * 32];
    const p1: V3 = [Math.cos(t1) * 32, 7.6, Math.sin(t1) * 32];
    for (const u of [0, 0.5]) {
      const q: V3 = [p0[0] + (p1[0] - p0[0]) * u, 7.6, p0[2] + (p1[2] - p0[2]) * u];
      g.beam(q, [q[0], 12.2, q[2]], 0.28, P.iron, 4);
    }
    g.beam([p0[0], 12.2, p0[2]], [p1[0], 12.2, p1[2]], 0.3, P.iron, 4);
    g.beam([p0[0], 10, p0[2]], [p1[0], 10, p1[2]], 0.18, P.iron, 3);
  }

  // The copper dome, brass ribs, the slit toward the telescope.
  const ribs = 16;
  const dome = domeShape(ribs, 6);
  const tb = TEL.bearing;
  // domeShape's phi is atan2(z, x) in local space; a bearing b points along (sin b, -cos b).
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
    let prev: V3 = [Math.cos(ph) * 25.9, 50.1, Math.sin(ph) * 25.9];
    for (let j = 1; j <= 5; j++) {
      const th = (j / 6) * (Math.PI / 2);
      const cur: V3 = [Math.cos(th) * Math.cos(ph) * 25.9, 50.1 + Math.sin(th) * 25.9, Math.cos(th) * Math.sin(ph) * 25.9];
      g.beam(prev, cur, 0.5, P.brass, 3);
      prev = cur;
    }
  }
  g.shape(prismShape(6, 1, 0, false, true), T(0, 74.6, 0, 1.6, 6, 1.6), P.brass);
  // The telescope: brass tube on blocks' axis, rings, a wider objective, an iron mount.
  const [tdx, tdz] = dirOf(tb);
  const el = TEL.el * DEG;
  const piv: V3 = [0, TEL.pivotY, 0];
  const at = (s: number): V3 => [tdx * Math.cos(el) * s, TEL.pivotY + Math.sin(el) * s, tdz * Math.cos(el) * s];
  g.beam(at(-7), at(TEL.len), 4.4, P.brass, 8, 5.4);
  for (const s of [8, 26, 44]) g.beam(at(s - 1), at(s + 1), 5.6 + s * 0.02, P.copperDark, 8);
  g.beam(at(TEL.len - 1), at(TEL.len + 2.2), 6.9, P.iron, 8);
  g.beam(at(-9), at(-6), 2.2, P.iron, 6);
  g.beam([piv[0], piv[1] - 8, piv[2]], [piv[0], piv[1] + 1, piv[2]], 3, P.iron, 6);
  // The door: stone surround, a lit opening, the light pool on the flagstones.
  const [rx, rz] = dirOf(DOOR_BEARING + 90);
  const dr = 24.2;
  const doorC: V3 = [dx * dr, 7.6, dz * dr];
  g.shape(BOX, T(doorC[0] + dx * 0.9, 18, doorC[2] + dz * 0.9, 2.2, 22, 14, yawTo(DOOR_BEARING)), P.stoneDark);
  glow.shape(BOX, T(doorC[0] + dx * 1.5, 16.4, doorC[2] + dz * 1.5, 1.4, 17.6, 9.2, yawTo(DOOR_BEARING)), GL.window);
  // The light pool: on the plinth top, down the steps, then a fan on the ground (world islandTop under it).
  {
    const dim: RGB = [0.015, 0.009, 0.004];
    const onTop = (d: number, w: number, y: number, k0: RGB, k1: RGB, d2: number) => {
      glow.quad([dx * d + rx * w, y, dz * d + rz * w], [dx * d - rx * w, y, dz * d - rz * w], [dx * d2 - rx * w, y, dz * d2 - rz * w], [dx * d2 + rx * w, y, dz * d2 + rz * w], k0, k1);
    };
    onTop(25.2, 6, 7.66, GL.pool, GL.pool, 30.4);
    for (let s = 0; s < 3; s++) {
      const d = 32 + s * 3.2;
      const y = 1.2 + (2 - s) * 2.1 - 1 + (2.2 + (2 - s) * 2.1) / 2 + 0.06;
      const k = scale(GL.pool, 0.85 - s * 0.18);
      onTop(d - 1.7, 7, y, k, k, d + 1.7);
    }
    const ox = PLACES[6].pos.x;
    const oz = PLACES[6].pos.z;
    const gy = (lx: number, lz: number) => islandTop(ox + lx, oz + lz) + 0.35;
    const c0: V3 = [dx * 42, gy(dx * 42, dz * 42), dz * 42];
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const [px, pz] = dirOf(DOOR_BEARING - 30 + (i / 6) * 60);
      const x = dx * 36 + px * 34;
      const z = dz * 36 + pz * 34;
      pts.push([x, gy(x, z), z]);
    }
    for (let i = 0; i < 6; i++) glow.tri(c0, pts[i + 1], pts[i], scale(GL.pool, 0.7), dim, dim);
  }
  lamps.push(doorC[0] + dx * 4, 22, doorC[2] + dz * 4, 26);
  // The porch (pass 3): two timber posts, a slate lean-to over the door, a caged lantern by it.
  {
    const post = (sg: number): V3 => [doorC[0] + dx * 7.5 + rx * sg * 7.5, 7.6, doorC[2] + dz * 7.5 + rz * sg * 7.5];
    for (const sg of [-1, 1]) {
      const b = post(sg);
      g.beam(b, [b[0], 25, b[2]], 0.6, P.brown, 4);
      g.beam([b[0], 25, b[2]], [doorC[0] + dx * 0.5 + rx * sg * 7.5, 27.4, doorC[2] + dz * 0.5 + rz * sg * 7.5], 0.45, P.brownDark, 4);
    }
    const w0: V3 = [doorC[0] + dx * 0.4 - rx * 9, 28.2, doorC[2] + dz * 0.4 - rz * 9];
    const w1: V3 = [doorC[0] + dx * 0.4 + rx * 9, 28.2, doorC[2] + dz * 0.4 + rz * 9];
    const e1: V3 = [doorC[0] + dx * 9 + rx * 9, 25.4, doorC[2] + dz * 9 + rz * 9];
    const e0: V3 = [doorC[0] + dx * 9 - rx * 9, 25.4, doorC[2] + dz * 9 - rz * 9];
    g.quad(w0, w1, e1, e0, P.slate, scale(P.slate, 0.9));
    g.beam(e0, e1, 0.5, P.brownDark, 4);
    g.beam([doorC[0] + dx * 5 + rx * 6, 24.4, doorC[2] + dz * 5 + rz * 6], [doorC[0] + dx * 5 + rx * 6, 23, doorC[2] + dz * 5 + rz * 6], 0.1, P.iron, 3);
    cagedLantern(g, glow, flames, lamps, doorC[0] + dx * 5 + rx * 6, 21.2, doorC[2] + dz * 5 + rz * 6, 1, 12);
    // Props on the plinth by the door: barrels, a crate pair, a coil.
    barrel(g, doorC[0] + dx * 5 - rx * 12, 7.6, doorC[2] + dz * 5 - rz * 12, 0.9, 11);
    barrel(g, doorC[0] + dx * 8 - rx * 15, 7.6, doorC[2] + dz * 8 - rz * 15, 0.8, 12);
    crate(g, doorC[0] + dx * 4 + rx * 14, 7.6, doorC[2] + dz * 4 + rz * 14, 4.4, 0.4, 13);
    crate(g, doorC[0] + dx * 2 + rx * 17.5, 7.6, doorC[2] + dz * 2 + rz * 17.5, 3.6, -0.3, 14);
    ropeCoil(g, doorC[0] + dx * 9 + rx * 16, 7.6, doorC[2] + dz * 9 + rz * 16, 1.8);
  }
  // Tall arched windows round the drum, lit (toward the camera and the star look).
  for (const b of [96, 176, 60, 18, 250]) {
    const [wx, wz] = dirOf(b);
    glow.shape(BOX, T(wx * 24.3, 33, wz * 24.3, 1.2, 9, 3.6, yawTo(b)), GL.windowDeep);
    g.shape(BOX, T(wx * 24.4, 38.2, wz * 24.4, 1.6, 1.4, 5.2, yawTo(b)), P.stoneDark);
    g.shape(BOX, T(wx * 24.4, 28.2, wz * 24.4, 1.8, 1.2, 5.4, yawTo(b)), P.stoneDark);
    // Pass 3: a warm halo on each window, so they glow (they read as cream boxes).
    lamps.push(wx * 26, 33, wz * 26, 13);
  }
  // Pass 3 (bible 6 a7): a flagstone walk off the plinth out across the plain
  // the a7 camera looks over (bearing 282: it recedes left of the dome, a
  // leading line of small lanterns), a bench and a star-chart table beside it.
  {
    const WALK = 282;
    const ox = PLACES[6].pos.x;
    const oz = PLACES[6].pos.z;
    const gy = (lx: number, lz: number) => islandTop(ox + lx, oz + lz);
    const [px, pz] = dirOf(WALK);
    const [qx, qz] = dirOf(WALK + 90);
    const ry = yawTo(WALK);
    for (let k = 0; k < 30; k++) {
      const d = 40 + k * 5.2;
      const off = (rnd(k, 201) - 0.5) * 2.2;
      const x = px * d + qx * off;
      const z = pz * d + qz * off;
      const c = rnd(k, 202) < 0.5 ? P.stone : P.stoneLight;
      g.shape(BOX, T(x, gy(x, z) + 0.15, z, 4.2 + rnd(k, 203) * 1.2, 0.7, 6.5 + rnd(k, 204) * 2, ry + (rnd(k, 205) - 0.5) * 0.25), scale(c, 0.92 + 0.1 * rnd(k, 206)));
      if (k % 2 === 0 && rnd(k, 207) < 0.8) {
        const x2 = px * (d + 2.6) - qx * (4.5 + rnd(k, 208) * 1.5);
        const z2 = pz * (d + 2.6) - qz * (4.5 + rnd(k, 208) * 1.5);
        g.shape(BOX, T(x2, gy(x2, z2) + 0.1, z2, 2.8, 0.5, 3.2, ry + rnd(k, 209)), P.stoneDark);
      }
    }
    // Lanterns: a short iron post, a lit head, a halo; alternating sides.
    for (let k = 0; k < 5; k++) {
      const d = 56 + k * 28;
      const side = k % 2 ? 1 : -1;
      const x = px * d + qx * side * 7.5;
      const z = pz * d + qz * side * 7.5;
      const y0 = gy(x, z);
      g.beam([x, y0, z], [x, y0 + 6.2, z], 0.35, P.iron, 4);
      g.shape(BOX, T(x, y0 + 7.8, z, 1.5, 0.4, 1.5), P.iron);
      glow.shape(BOX, T(x, y0 + 6.9, z, 1.1, 1.5, 1.1), GL.lamp);
      lamps.push(x, y0 + 7, z, 9);
      // Its light on the flags.
      const r = 6;
      const yy = y0 + 0.62;
      glow.tri([x - r, yy, z], [x + r, yy, z], [x, yy, z + r], scale(GL.pool, 0.5), [0.01, 0.006, 0.002], [0.01, 0.006, 0.002]);
      glow.tri([x - r, yy, z], [x, yy, z - r], [x + r, yy, z], [0.01, 0.006, 0.002], [0.01, 0.006, 0.002], scale(GL.pool, 0.5));
    }
    // A bench facing out over the cloud sea, right of the walk.
    {
      const d = 92;
      const x = px * d + qx * 15;
      const z = pz * d + qz * 15;
      const y0 = gy(x, z);
      g.shape(BOX, T(x, y0 + 2.6, z, 9, 0.6, 2.6, ry + Math.PI / 2), P.plank);
      g.shape(BOX, T(x - px * 1.2, y0 + 4.6, z - pz * 1.2, 9, 2, 0.5, ry + Math.PI / 2), P.plank2);
      for (const sg of [-1, 1]) g.shape(BOX, T(x + qx * sg * 3.6, y0 + 1.2, z + qz * sg * 3.6, 0.7, 2.6, 2.2, ry + Math.PI / 2), P.iron);
    }
    // The star-chart table, left of the walk: a lamp on it, the chart pinned by stones.
    {
      const d = 68;
      const x = px * d - qx * 16;
      const z = pz * d - qz * 16;
      const y0 = gy(x, z);
      g.shape(BOX, T(x, y0 + 4.2, z, 7.5, 0.5, 5, ry + 0.2), P.plank);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.shape(BOX, T(x + qx * a * 3 + px * b * 2, y0 + 2, z + qz * a * 3 + pz * b * 2, 0.5, 4, 0.5), P.plank2);
      g.shape(BOX, T(x, y0 + 4.52, z, 5.8, 0.08, 3.6, ry + 0.26), P.paper);
      glow.shape(BOX, T(x + qx * 2.6, y0 + 5.4, z + qz * 2.6, 0.7, 1.3, 0.7), GL.lamp);
      lamps.push(x + qx * 2.6, y0 + 5.6, z + qz * 2.6, 8);
    }
  }
  // The annex (blocks: bearing 70, 44 out): stone, a slate roof, lit windows, a chimney.
  {
    const ab = 70;
    const [ax, az] = dirOf(ab);
    const hx = ax * 46;
    const hz = az * 46;
    const ry = yawTo(ab);
    g.shape(BOX, T(hx, 7, hz, 24, 15, 17, ry), (cy) => (cy < -0.35 ? P.stoneDark : P.stone));
    // Roof: two slopes, ridge along the annex's length (bearing ab).
    const L = 13.5;
    const W = 10.2;
    const [px, pz] = dirOf(ab + 90);
    const e0: V3 = [hx - ax * L, 14.5, hz - az * L];
    const e1: V3 = [hx + ax * L, 14.5, hz + az * L];
    const r0: V3 = [e0[0], 21, e0[2]];
    const r1: V3 = [e1[0], 21, e1[2]];
    for (const s of [-1, 1]) {
      const a: V3 = [e0[0] + px * W * s, 13.5, e0[2] + pz * W * s];
      const b: V3 = [e1[0] + px * W * s, 13.5, e1[2] + pz * W * s];
      g.quad(a, b, r1, r0, P.slate, scale(P.slate, 0.9));
    }
    for (const e of [e0, e1]) {
      const sgn = e === e0 ? -1 : 1;
      g.tri([e[0] + px * 8.5 - ax * 0.4 * sgn, 14.5, e[2] + pz * 8.5 - az * 0.4 * sgn], [e[0] - px * 8.5 - ax * 0.4 * sgn, 14.5, e[2] - pz * 8.5 - az * 0.4 * sgn], [e[0] - ax * 0.4 * sgn, 20.6, e[2] - az * 0.4 * sgn], P.stone);
    }
    g.shape(BOX, T(hx + ax * 7 + px * 4, 21.5, hz + az * 7 + pz * 4, 3.2, 8, 3.2, ry), P.stoneDark);
    for (const s of [-6, 5]) {
      const wx = hx + ax * s + px * 8.7;
      const wz = hz + az * s + pz * 8.7;
      glow.shape(BOX, T(wx, 8.2, wz, 3.4, 4.6, 0.8, ry), GL.window);
    }
    const wx = hx - px * 8.7;
    const wz = hz - pz * 8.7;
    glow.shape(BOX, T(wx, 8.2, wz, 3.4, 4.6, 0.8, ry), GL.window);
  }
  // The low wall (blocks: bearings 150-238 at 70).
  for (let k = 0; k < 12; k++) {
    const a = (150 + k * 8) * DEG;
    g.shape(BOX, T(Math.sin(a) * 70, 2.2, -Math.cos(a) * 70, 10.6, 4.6 + 0.8 * rnd(k, 9), 3.2, -a, 0, (rnd(k, 8) - 0.5) * 0.06), (cy) => (cy > 0.3 ? P.stoneLight : P.stone));
  }
  // A table of star charts and a bench, beside the door facing the camera.
  {
    const tb2 = DOOR_BEARING + 34;
    const [tx0, tz0] = dirOf(tb2);
    const tx = tx0 * 50;
    const tz = tz0 * 50;
    const ry = yawTo(tb2 + 90);
    g.shape(BOX, T(tx, 10.3, tz, 16, 1.2, 10, ry), P.brown);
    const [ux, uz] = dirOf(tb2 + 90);
    for (const [a, b] of [[-6.8, -4], [6.8, -4], [-6.8, 4], [6.8, 4]]) g.shape(BOX, T(tx + ux * a + tx0 * b, 5, tz + uz * a + tz0 * b, 1, 10, 1, ry), P.brownDark);
    for (let i = 0; i < 4; i++) {
      const a = -4.5 + i * 3.2;
      const b = (rnd(i, 21) - 0.5) * 3;
      g.shape(BOX, T(tx + ux * a + tx0 * b, 11.05, tz + uz * a + tz0 * b, 4.6, 0.2, 3.6, ry + (rnd(i, 22) - 0.5) * 0.5), i % 2 ? P.paper : P.paper2);
    }
    g.shape(prismShape(8, 1, 0.8, true, true), T(tx + ux * 5 - tx0 * 2, 11, tz + uz * 5 - tz0 * 2, 1.2, 2.2, 1.2), P.brass);
    const bx = tx + tx0 * 11;
    const bz = tz + tz0 * 11;
    g.shape(BOX, T(bx, 6, bz, 18, 1.2, 4.4, ry), P.brown);
    for (const a of [-7, 7]) g.shape(BOX, T(bx + ux * a, 2.8, bz + uz * a, 1.2, 5.6, 3.6, ry), P.brownDark);
  }
}

// ── Pass 3 props: one family for the ship, the berth and the islands ────────

/**
 * A caged lantern (bible P11): an iron foot, four corner bars and a bar down
 * each face, bands, a peaked cap and a ring; a deep amber glass core. The
 * bright flame is a sprite (flames: x, y, z, size), the halo an E1 sprite.
 */
function cagedLantern(g: Geo, glow: Geo, flames: number[], halos: number[], x: number, y: number, z: number, s = 1, halo = 9): void {
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
function barrel(g: Geo, x: number, y: number, z: number, s = 1, seed = 0): void {
  const col = rnd(seed, 301) < 0.5 ? P.barrel : P.barrel2;
  const r = 2.2 * s;
  g.shape(prismShape(9, 0.86, 1, false, true, seed), T(x, y, z, r, 2.6 * s, r), col);
  g.shape(prismShape(9, 1, 0.86, true, false, seed), T(x, y + 2.6 * s, z, r, 2.6 * s, r), scale(col, 1.08));
  for (const [hy, k] of [[0.55, 0.93], [2.35, 1.02], [4.4, 0.93]] as const) g.shape(prismShape(9, 1, 1, false, false, seed), T(x, y + hy * s, z, r * k, 0.45 * s, r * k), P.hoop);
}

/** A slatted crate on (x, y, z): pale boards, dark corner battens and gaps between the boards. */
function crate(g: Geo, x: number, y: number, z: number, size: number, ry: number, seed = 0): void {
  const col = rnd(seed, 311) < 0.5 ? P.crate : P.crate2;
  g.shape(BOX, T(x, y + size / 2, z, size * 0.94, size * 0.94, size * 0.94, ry), (cy) => scale(col, cy > 0.45 ? 1.1 : 0.95 + 0.1 * rnd(seed, 312)));
  for (const f of [0.34, 0.66]) g.shape(BOX, T(x, y + size * f, z, size * 0.955, size * 0.05, size * 0.955, ry), P.crateEdge);
  const [cx, cz] = [Math.cos(ry), -Math.sin(ry)];
  const [sx, sz] = [Math.sin(ry), Math.cos(ry)];
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const ox = ((a * cx + b * sx) * size * 0.47);
    const oz = ((a * cz + b * sz) * size * 0.47);
    g.shape(BOX, T(x + ox, y + size / 2, z + oz, size * 0.12, size, size * 0.12, ry), P.crateEdge);
  }
}

/** A coiled rope lying on (x, y, z): three turns and a dark centre. */
function ropeCoil(g: Geo, x: number, y: number, z: number, r: number): void {
  for (let k = 0; k < 3; k++) g.shape(prismShape(10, 1, 0.9, true, false, k * 0.3), T(x, y + k * 0.55, z, r * (1 - k * 0.12), 0.6, r * (1 - k * 0.12)), k % 2 ? scale(P.rope, 0.86) : P.rope);
  g.shape(prismShape(8, 1, 1, true, false), T(x, y + 1.66, z, r * 0.36, 0.05, r * 0.36), P.brownDark);
}

/** The ship's wheel on its pedestal, facing local +x (the helmsman stands aft of it). */
function shipWheel(g: Geo, x: number, y: number, z: number): void {
  g.shape(BOX, T(x - 0.8, y + 3.2, z, 2.2, 6.4, 2.6), P.brown);
  g.shape(BOX, T(x - 0.8, y + 6.6, z, 2.8, 0.5, 3.2), P.brownDark);
  const cy = y + 9.2;
  const R = 3.6;
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    g.beam([x + 0.6, cy + Math.cos(a0) * R, z + Math.sin(a0) * R], [x + 0.6, cy + Math.cos(a1) * R, z + Math.sin(a1) * R], 0.38, P.varnish2, 4);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    g.beam([x + 0.6, cy, z], [x + 0.6, cy + Math.cos(a) * (R + 1.3), z + Math.sin(a) * (R + 1.3)], 0.22, P.varnish, 4, 0.3);
  }
  g.shape(prismShape(8, 1, 1, true, true), T(x + 1.4, cy, z, 0.9, 1.6, 0.9, 0, 0, Math.PI / 2), P.brass);
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

// ── The one airship kit (local: origin at the deck's centre, nose +x, as layout SHIP) ──

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
  g.shape(BOX, T(12, 0.8, 0, 10, 1.2, 8), P.brownDark);
  for (let k = 0; k < 4; k++) g.shape(BOX, T(8.4 + k * 2.4, 1.5, 0, 1, 0.3, 7), P.brown);
  if (hero) {
    // The deck the riding camera sees (x 18 to 58, bible 6 the flight): the
    // centre stays open as the leading line to the bow; cargo along both
    // bulwarks. Left: a crate stack under a tarp, the chart table, a coil.
    // Right: hooped barrels, the helm, a lantern on a hook.
    crate(g, 24, 0.2, -9.6, 5.4, 0.12, 1);
    crate(g, 29.5, 0.2, -9.8, 4.6, -0.2, 2);
    crate(g, 25.4, 5.6, -9.4, 4, 0.5, 3);
    g.quad([22, 9.9, -12.2], [28.2, 9.9, -12.4], [28.4, 5.2, -12.6], [21.6, 5.4, -12.2], P.tarp);
    chartTable(g, 42, 0.2, -6, 0.25);
    ropeCoil(g, 47, 0.2, -4.6, 2.6);
    ropeCoil(g, 20, 0.2, 4.2, 2.2);
    barrel(g, 26, 0.2, 10, 1, 1);
    barrel(g, 30.6, 0.2, 9.2, 0.92, 2);
    barrel(g, 28.2, 0.2, 5.6, 0.85, 3);
    // The helm stands aft, behind the riding camera (seen from the gangway and from outside).
    shipWheel(g, -46, 0.2, 0);
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

function haloMaterial(): THREE.ShaderMaterial {
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
function flameMaterial(): THREE.ShaderMaterial {
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
  const cloudMat = track(new THREE.MeshLambertMaterial({ vertexColors: true }));
  cloudMat.name = "SkyCloud";
  const glowMat = track(new THREE.MeshBasicMaterial({ vertexColors: true }));
  glowMat.name = "SkyGlow";
  glowMat.userData.lightGlow = "lamp";
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
    if (r > rim - 22) continue;
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
      if (trailDistFast(x, z) < 20) continue;
      placeTree(x, z, 46 + rnd(k, 95) * 16, 500 + k);
    }
  }
  // The a7 plain's middle ground (pass 3, bible 2.2 rule 2 and 6 a7): rock
  // groups, spire clumps and a low dry-stone wall in the left and the back of
  // the stop frame. Cast from the stop camera as it stands on the page
  // (measured: (-1935, 1765, -1448), heading 306, 8.6 degrees down); the
  // sight line to the observatory, its walk and the rail stay open.
  {
    const cam = new THREE.Vector3(-1935, 1765, -1448);
    const hb = 306 * DEG;
    const pd = 8.6 * DEG;
    const f = new THREE.Vector3(Math.sin(hb) * Math.cos(pd), -Math.sin(pd), -Math.cos(hb) * Math.cos(pd));
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, f).normalize();
    const tv = Math.tan(15.5 * DEG);
    const hit = (nx: number, ny: number): [number, number] | null => {
      const d = f.clone().addScaledVector(right, nx * tv * 1.6).addScaledVector(up, ny * tv);
      if (d.y >= -1e-3) return null;
      let t = (I.y + 10 - cam.y) / d.y;
      for (let k = 0; k < 3; k++) t = (I.y + islandTop(cam.x + d.x * t, cam.z + d.z * t) - cam.y) / d.y;
      const x = cam.x + d.x * t;
      const z = cam.z + d.z * t;
      const b = (Math.atan2(x - I.x, -(z - I.z)) / DEG + 360) % 360;
      if (Math.hypot(x - I.x, z - I.z) > islandRim(b * DEG) - 30) return null;
      return [x, z];
    };
    const [wdx, wdz] = dirOf(282);
    const walkOff = (x: number, z: number) => {
      const u = Math.min(200, Math.max(40, (x - oPos.x) * wdx + (z - oPos.z) * wdz));
      return Math.hypot(x - oPos.x - wdx * u, z - oPos.z - wdz * u);
    };
    const clear = (x: number, z: number, r: number) =>
      trailDistFast(x, z) > r + 16 && Math.hypot(x - oPos.x, z - oPos.z) > 95 + r && sightOff(x, z) > 28 + r && walkOff(x, z) > 14 + r;
    let n = 0;
    for (const [nx, ny] of [[-0.55, -0.3], [-0.22, -0.1], [-0.86, -0.14], [-0.72, -0.58], [0.9, -0.12], [-0.42, -0.72], [-0.05, 0.02]] as const) {
      const h = hit(nx, ny);
      if (!h) continue;
      const [x, z] = h;
      const big = 7 + rnd(n, 421) * 4;
      if (clear(x, z, big)) boulder(land, x, I.y + islandTop(x, z), z, big, 900 + n);
      for (let q = 0; q < 6; q++) {
        const a = rnd(n * 7 + q, 422) * Math.PI * 2;
        const rr = big + 3 + rnd(n * 7 + q, 423) * 12;
        const qx = x + Math.cos(a) * rr;
        const qz = z + Math.sin(a) * rr;
        const r = q < 2 ? 3 + rnd(q + n, 424) * 2.5 : 1 + rnd(q + n, 425) * 1.4;
        if (clear(qx, qz, r)) boulder(land, qx, I.y + islandTop(qx, qz), qz, r, 950 + n * 7 + q);
      }
      n++;
    }
    for (const [nx, ny, cnt] of [[-0.46, 0.04, 4], [-0.97, 0.0, 5], [0.62, 0.06, 3]] as const) {
      const h = hit(nx, ny);
      if (!h) continue;
      for (let q = 0; q < cnt; q++) {
        const a = rnd(q + nx * 10, 431) * Math.PI * 2;
        const rr = rnd(q + nx * 10, 432) * 22;
        const x = h[0] + Math.cos(a) * rr;
        const z = h[1] + Math.sin(a) * rr;
        if (!clear(x, z, 8) || behindLandmark(x, z)) continue;
        placeTree(x, z, 30 + rnd(q + nx * 10, 433) * 20, 700 + q + Math.round(nx * 100));
      }
    }
    // The low wall: dry stones along a gentle curve across the left of the plain, one gap.
    const w0 = hit(-1.05, -0.46);
    const w1 = hit(-0.34, -0.2);
    if (w0 && w1) {
      const len = Math.hypot(w1[0] - w0[0], w1[1] - w0[1]);
      const ux = (w1[0] - w0[0]) / len;
      const uz = (w1[1] - w0[1]) / len;
      const ry = Math.atan2(-uz, ux);
      for (let d = 0; d < len; d += 5.2) {
        const t = d / len;
        if (t > 0.46 && t < 0.56) continue;
        const bow = Math.sin(t * Math.PI) * 14;
        const x = w0[0] + ux * d - uz * bow;
        const z = w0[1] + uz * d + ux * bow;
        if (!clear(x, z, 3)) continue;
        const y0 = I.y + islandTop(x, z);
        // Fix pass 3: two courses of varied stones, not one cube per step (the wall read as a chain of cubes).
        const sd = Math.round(d * 7.3);
        const stoneC = (cy: number) => (cy > 0.35 ? scale(P.stoneLight, 0.92) : cy > -0.2 ? P.stone : P.moss2);
        let off = -2.6;
        for (let k = 0; k < 3 && off < 2.6; k++) {
          const w = 1.7 + rnd(sd + k, 441) * 1.5;
          const hb = 1.9 + rnd(sd + k, 444) * 1.1;
          const cx = off + w / 2;
          land.shape(BOX, T(x + ux * cx, y0 + hb / 2 - 0.3, z + uz * cx, w, hb, 3.2 + rnd(sd + k, 445) * 0.8, ry + (rnd(sd + k, 442) - 0.5) * 0.35, (rnd(sd + k, 446) - 0.5) * 0.12, (rnd(sd + k, 443) - 0.5) * 0.18), stoneC);
          off += w + 0.15;
        }
        for (let k = 0; k < 2; k++) {
          const w = 1.9 + rnd(sd + k, 447) * 1.3;
          const ht = 1.2 + rnd(sd + k, 448) * 0.9;
          const cx = -1.4 + k * 2.6 + (rnd(sd + k, 449) - 0.5) * 0.8;
          land.shape(BOX, T(x + ux * cx, y0 + 2.2 + ht / 2, z + uz * cx, w, ht, 2.6 + rnd(sd + k, 450) * 0.6, ry + (rnd(sd + k, 451) - 0.5) * 0.4, (rnd(sd + k, 452) - 0.5) * 0.15, (rnd(sd + k, 453) - 0.5) * 0.25), stoneC);
        }
      }
    }
  }

  // The bounty isle's two spires (blocks' spots: off the walk by 64 and 75).
  placeTree(B.x + 50, B.z + 40, 40, 601, B.y - 1);
  placeTree(B.x - 60, B.z - 45, 34, 602, B.y - 1);

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
        if (Math.hypot(a.x + ux * d - oPos.x, a.z + uz * d - oPos.z) < 40) continue;
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
    // Lanterns: every ~110 along the path, alternating sides, 11 off it.
    let carry = 50;
    let side = 1;
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
        if (Math.hypot(x - oPos.x, z - oPos.z) > 70 && railDist(x, I.y + 8, z) > 16) {
          const y = I.y + islandTop(x, z);
          land.beam([x, y, z], [x, y + 10.4, z], 0.55, P.brownDark, 4);
          cagedLantern(land, glow, flames, halos, x, y + 12.2, z, 0.9, 9);
          side = -side;
        }
        d += 110;
      }
      carry = d - len;
    }
  }

  // The bounty isle's set (blocks' board spot: 60 along the walk, 24 left).
  const mooringRopes = new Geo();
  {
    const wb = (Math.atan2(SHIP_MOORED.x - BRIDGE.b[0], -(SHIP_MOORED.z - BRIDGE.b[2])) * 180) / Math.PI;
    const [wx, wz] = dirOf(wb);
    const [lx, lz] = dirOf(wb - 90);
    const qx = BRIDGE.b[0] + wx * 60 + lx * 24;
    const qz = BRIDGE.b[2] + wz * 60 + lz * 24;
    const face = (Math.atan2(BRIDGE.b[0] - qx, -(BRIDGE.b[2] - qz)) * 180) / Math.PI;
    const ry = yawTo(face + 90);
    const [ax, az] = dirOf(face + 90);
    const [fx, fz] = dirOf(face);
    const y = B.y;
    // Posts, the backing board, a little roof.
    for (const s of [-1, 1]) land.shape(BOX, T(qx + ax * s * 10, y + 10.5, qz + az * s * 10, 1.9, 21, 1.9, ry), P.brown);
    land.shape(BOX, T(qx, y + 12.2, qz, 19, 12, 0.9, ry), P.greyBrown);
    land.shape(BOX, T(qx, y + 18.6, qz, 20.5, 0.9, 1.4, ry), P.brownDark);
    land.shape(BOX, T(qx, y + 5.8, qz, 20.5, 0.9, 1.4, ry), P.brownDark);
    {
      const e0: V3 = [qx - ax * 12, y + 22.4, qz - az * 12];
      const e1: V3 = [qx + ax * 12, y + 22.4, qz + az * 12];
      for (const s of [-1, 1]) {
        const a: V3 = [e0[0] + fx * 3.6 * s, y + 19.6, e0[2] + fz * 3.6 * s];
        const b: V3 = [e1[0] + fx * 3.6 * s, y + 19.6, e1[2] + fz * 3.6 * s];
        land.quad(a, b, e1, e0, P.slate);
      }
    }
    // Pinned notices: rows of pale sheets, a few askew, one hanging by a corner.
    for (let i = 0; i < 11; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const u = -6.9 + col * 4.6 + (rnd(i, 161) - 0.5) * 1.2;
      const v = y + 16 - row * 3.9 + (rnd(i, 162) - 0.5) * 0.8;
      const tilt = i === 6 ? 0.55 : (rnd(i, 163) - 0.5) * 0.22;
      land.shape(BOX, T(qx + ax * u + fx * 0.6, v, qz + az * u + fz * 0.6, 3.6, 3, 0.2, ry, 0, tilt), i % 3 === 0 ? P.paper2 : P.paper);
    }
    // The lantern on a crook post at the board's right end.
    const px = qx + ax * 16;
    const pz = qz + az * 16;
    land.shape(BOX, T(px, y + 10, pz, 1.3, 20, 1.3), P.brown);
    land.beam([px, y + 19.5, pz], [px + fx * 5.5, y + 19.5, pz + fz * 5.5], 0.6, P.brown, 4);
    land.beam([px + fx * 5.5, y + 19.5, pz + fz * 5.5], [px + fx * 5.5, y + 18.2, pz + fz * 5.5], 0.12, P.iron, 3);
    cagedLantern(land, glow, flames, halos, px + fx * 5.5, y + 15.6, pz + fz * 5.5, 1, 12);
    // A crate stack, a barrel and a bench at the board's left end.
    const cx = qx - ax * 17 + fx * 3;
    const cz = qz - az * 17 + fz * 3;
    crate(land, cx, y, cz, 9, ry + 0.2, 21);
    crate(land, cx - ax * 9.5, y, cz - az * 9.5, 8, ry - 0.15, 22);
    crate(land, cx - ax * 4, y + 9, cz - az * 4, 7.4, ry + 0.5, 23);
    barrel(land, cx + fx * 9, y, cz + fz * 9, 1.45, 24);
    barrel(land, cx + fx * 13 - ax * 3, y, cz + fz * 13 - az * 3, 1.3, 25);
    const bx = qx + fx * 14;
    const bz = qz + fz * 14;
    land.shape(BOX, T(bx, y + 5.4, bz, 16, 1.2, 4, ry), P.brown);
    for (const s of [-6, 6]) land.shape(BOX, T(bx + ax * s, y + 2.6, bz + az * s, 1.2, 5.2, 3.4, ry), P.brownDark);
    // Pale grass tufts over the top, off the walk and the props (cover.ts grows only the Sky Island's).
    for (let k = 0; k < 340; k++) {
      const a = rnd(k, 171) * Math.PI * 2;
      const rr = Math.sqrt(rnd(k, 172)) * (bountyRim(a) - 6);
      const x = B.x + Math.sin(a) * rr;
      const z = B.z - Math.cos(a) * rr;
      const along = (x - BRIDGE.b[0]) * wx + (z - BRIDGE.b[2]) * wz;
      const off = Math.abs((x - BRIDGE.b[0]) * -wz + (z - BRIDGE.b[2]) * wx);
      if (off < 30 && along > -10 && along < 250) continue;
      if (Math.hypot(x - qx, z - qz) < 16 || Math.hypot(x - cx, z - cz) < 13 || Math.hypot(x - bx, z - bz) < 10) continue;
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

  addMesh(root, land, solid, "Sky_Land");
  addMesh(root, glow, glowMat, "Sky_Glow");
  const cloudMesh = addMesh(root, clouds, cloudMat, "Sky_Clouds");
  cloudMesh.renderOrder = 1;
  const ropesMesh = addMesh(root, mooringRopes, solid, "Sky_MooringRopes");
  addHalos(root, halos, "Sky_Halos");
  addFlames(root, flames, "Sky_Flames");

  // ── The observatory, in LM_Observatory ──
  const lm = ctx.root.getObjectByName(a7.mesh) ?? ctx.scene.getObjectByName(a7.mesh);
  if (lm) {
    const og = new Geo();
    const ogl = new Geo();
    const ol: number[] = [];
    const ofl: number[] = [];
    buildObservatory(og, ogl, ol, ofl);
    // Blocks' LM groups sit at the place's pos; build local, parent there.
    addMesh(lm, og, solid, "Observatory_Art");
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

  // ── Your airship, in blocks' Airship_yours group ──
  const shipGroup = ctx.root.getObjectByName("Airship_yours") ?? ctx.scene.getObjectByName("Airship_yours");
  const props: THREE.Mesh[] = [];
  if (shipGroup) {
    const sg = new Geo();
    const sgl = new Geo();
    const sl: number[] = [];
    const sf: number[] = [];
    buildAirship(sg, sgl, sl, { hero: true, flames: sf });
    addMesh(shipGroup, sg, solid, "Airship_Art");
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
    ctx.shipPose(pose);
    const ropes = pose.phase === "moored" && (!shipGroup || shipGroup.visible);
    if (ropes !== lastRopes) {
      ropesMesh.visible = ropes;
      lastRopes = ropes;
      changed = true;
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
        buildMs,
      };
    },
  };
};
