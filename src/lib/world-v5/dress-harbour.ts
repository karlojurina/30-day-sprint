/**
 * V5 dressing module: dress-harbour (detail pass 2, world_art_bible.md 6 a8).
 *
 * The Harbour Isle as a warm floating harbour town at morning: pale plaster
 * houses under dusty terracotta and slate roofs, timber framing, chimneys
 * (five of them smoking), window glow; a market street with striped awnings
 * from your berth up to the square; docks on piles with five moored airships
 * of three sizes plus your berth; the floating rock underneath with its
 * strata and three satellite rocks; a lighthouse on the south-west rim; and
 * the GUILD HALL, the hero, in the square: stone ground floor, timber-framed
 * upper floor, a blue slate roof and belfry spire (the place accent), red
 * guild banners, and a huge roofed NOTICE BOARD of job notices standing
 * BESIDE the entrance (screen right from the stop), with a ladder against it
 * and one sheet going up at an angle (the story pair).
 *
 * REPLACES (hidden at install, by name, blocks.ts is not edited):
 *   Set_a8       the grey rock, piers, docked ships, quay, street, stalls,
 *                houses and beacon tower (the whole grey set)
 *   Landmark_a8  the grey Guild Hall and job board (inside LM_GuildHall)
 *   HarbourGlow  the grey harbour's lamps
 * LEAVES to others: Airship_yours (your ship, docked at SHIP_DOCKED; the pier
 * here meets its bow), Airship_loop, LanternPosts / LanternHeads / halos (the
 * progress lanterns, three of them on the market street), PlaceMist.
 *
 * CONTRACT
 *   - LM_GuildHall keeps its name and position (layout PLACES a8 pos); its
 *     shown meshes are GuildHall (solid), GuildHall_Glow (lamp glow) and
 *     GuildHall_Flag (the spire's pennant, sway material). The hall itself
 *     stands 16 toward bearing 231 of that base, with the notice board on
 *     its bearing-51 side, so the pair centres at x 0.6 in the a8 frame.
 *   - Everything else lives under one group "Harbour" in ctx.root, shown only
 *     once the camera is past the rope bridge head (z < -2100, blocks' rule).
 *   - Smoke: life.ts draws it. Four chimney tops the a8 stop frames beside
 *     the hall are empty markers "Harbour_Chimney_k" tagged
 *     userData.smoke = "chimney" (life.ts SMOKE SOURCES rule 1); the same
 *     points are exported as HARBOUR_SMOKE.
 *   - Airships: the world's one kit, dress-sky.ts airshipKit() (pass 3), at
 *     each berth's size with its own livery band; hullShip() / blimp() only
 *     place it. The moored poses are exported as HARBOUR_BERTHS.
 *   - Materials: MeshLambert / MeshBasic with the stock fog chunks (light.ts
 *     adds the ramp and grade); the one vertex hook (sway: ship bob, bunting, flag) is set at
 *     install so light.ts chains after it, with its own program cache key.
 *     Glow materials carry userData.lightGlow = "lamp".
 *   - Draw calls: 7 (town, lamps, sway, sway lamps, hall, hall glow, flag).
 */
import * as THREE from "three";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { HARBOUR_DEPTH, HARBOUR_PATH, PLACES, SHIP_DOCKED, WORLD } from "./layout";
import { airshipKit, type AirshipKitGeo } from "./dress-sky";

type V3 = [number, number, number];
type RGB = [number, number, number];

const DEG = Math.PI / 180;
const HI = WORLD.harbourIsle;
const Y = HI.y;
const A8 = PLACES[7];

// ── Palette (sRGB hex, converted to linear; albedo low in saturation, bible 1.1) ──
const lin = (hex: number, k = 1): RGB => {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
};
const K = {
  plaster: [0xe3d6ba, 0xe6dccb, 0xdccfb4, 0xd9c7a6, 0xd8cbbd, 0xd2cfc4].map((h) => lin(h, 0.92)),
  stone: lin(0xb9ae98),
  stoneDk: lin(0x7e7e7c),
  timber: lin(0x645a4a),
  timberDk: lin(0x463e32),
  greyBrown: lin(0x786e62),
  // Warm honey clay roofs (albedo hue about 40): true terracotta sits within
  // 15 degrees of the a8 accent red, and the morning grade pulls a lit warm
  // albedo about 7 degrees further toward red, so it fails the accent gate
  // (bible 7). The warm browns below are nudged the same way (hue 32 to 38).
  // Pass 3: weathered brown-grey tile (hue ~32, sat ~0.18) in place of the honey
  // clay, which graded to mustard and olive. A rose tile (hue ~24) was tried and
  // raised the accent-hue gate 1.09 -> 1.31 percent.
  roofs: [0x958878, 0x8a7e70, 0x9e917f, 0x857a6c].map((h) => lin(h)),
  // Weathered grey slate, no blue: blue belongs to the Guild Hall.
  // Pass 3: blue-grey slate (sat under 0.12, so the Guild Hall's blue stays the accent).
  slate: [0x686c74, 0x5c6068, 0x72767c].map((h) => lin(h)),
  glass: lin(0x2c3236),
  shutters: [0x6f7f6a, 0x5f7080, 0x7d6b5a, 0x8a7a5a].map((h) => lin(h)),
  // Neutral cool greys: the a8 grade warms shaded ground toward the accent hue.
  // Pass 3: warmer flags (the grey squares read as a board game).
  paving: lin(0xa09688),
  pavingB: lin(0x908678),
  pavingC: lin(0xaca294),
  cobble: lin(0x7f7d78),
  grass: lin(0x7c8a58),
  grassB: lin(0x6c7a4e),
  earth: lin(0x86785e),
  rockA: lin(0xa4988a),
  rockB: lin(0x8e8476),
  rockC: lin(0x978b7a),
  rockD: lin(0x6e665c),
  rockE: lin(0x5a544c),
  canvas: lin(0xd8ccb0),
  cream: lin(0xe3d6ba),
  rope: lin(0xb8a07a),
  iron: lin(0x2f2d2c),
  brass: lin(0xb8904a),
  deck: lin(0x9a8c74),
  hull: lin(0x6b5c48),
  envA: lin(0xe6dcc6),
  envB: lin(0xd2c6ae),
  leaf: lin(0x6b8050),
  leafB: lin(0x5a7048),
  leafLit: lin(0x8fa05c),
  bark: lin(0x5a4e40),
  paper: [0xf2ecdc, 0xe8dcc0, 0xf4f0e6, 0xece2cc].map((h) => lin(h)),
  // Muted stripes for the market (sat under 0.35, away from the accent).
  stripes: [0x8a6a74, 0x9a8656, 0x66707c, 0x7a8a6a].map((h) => lin(h)),
  // Ship bands: from everywhere, muted.
  bands: [0x6a5a78, 0x4f7470, 0xa88a55, 0x5a6a80, 0x8a6a74].map((h) => lin(h)),
  flowers: [0xc08898, 0xd0a040, 0xe6ded0].map((h) => lin(h)),
  // THE PLACE ACCENT (bible 1.2 a8): bunting and the hall only.
  red: lin(0xc9563c),
  gold: lin(0xe0b050),
  blue: lin(0x3f6a8a),
  blueDk: lin(0x34566f),
};
/** Unlit glow colours, above 1 so they read as light after tone mapping (blocks' G). */
const GL = {
  window: [2.0, 1.4, 0.7] as RGB,
  lamp: [2.4, 1.35, 0.5] as RGB,
  door: [1.8, 1.1, 0.5] as RGB,
};

// ── Small helpers ────────────────────────────────────────────────────────────

function rnd(i: number, s = 0): number {
  const v = Math.sin(i * 127.1 + s * 311.7 + 17.3) * 43758.5453;
  return v - Math.floor(v);
}
/** The a8 morning haze (peach), for the far houses' aerial perspective (pass 3). */
const HAZE_A8: RGB = lin(0xe8c4a4);
const pick = <X>(arr: readonly X[], r: number): X => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
const mulC = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const mixC = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Horizontal unit vector for a compass bearing (0 = -z, 90 = +x). */
const dirOf = (b: number): [number, number] => [Math.sin(b * DEG), -Math.cos(b * DEG)];
/** Yaw that turns local +x toward bearing b (local +z then points to b + 90). */
const yawTo = (b: number) => (90 - b) * DEG;
const bearingOf = (dx: number, dz: number) => ((Math.atan2(dx, -dz) / DEG) + 360) % 360;
const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
/** Transform: position, scale, then yaw / pitch / roll (Y, X, Z order). */
function T(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}
const mul = (a: THREE.Matrix4, b: THREE.Matrix4) => new THREE.Matrix4().multiplyMatrices(a, b);

/** Harbour Isle rim radius by angle (blocks' harbourRim, so the lanterns still stand on the top). */
function rimAt(theta: number): number {
  return HI.r - 8 - 10 * (0.5 + 0.5 * Math.sin(3 * theta + 0.9)) - 5 * (0.5 + 0.5 * Math.sin(7 * theta + 2.1));
}
const rimB = (b: number) => rimAt(b * DEG);
const at = (b: number, r: number): [number, number] => [HI.x + Math.sin(b * DEG) * r, HI.z - Math.cos(b * DEG) * r];

function distSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}
const HP = HARBOUR_PATH.map((p) => [p.x, p.z] as [number, number]);
function distPath(x: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i < HP.length - 1; i++) d = Math.min(d, distSeg(x, z, HP[i][0], HP[i][1], HP[i + 1][0], HP[i + 1][1]));
  return d;
}

// ── Templates: non-indexed unit shapes ───────────────────────────────────────

function tpl(g: THREE.BufferGeometry): Float32Array {
  const n = g.index ? g.toNonIndexed() : g;
  const a = new Float32Array(n.getAttribute("position").array as ArrayLike<number>);
  g.dispose();
  if (n !== g) n.dispose();
  return a;
}
/** Gable roof prism: base -0.5..0.5 in x and z at y 0, ridge along x at y 1. */
function gableTpl(): Float32Array {
  const p: number[] = [];
  const A: V3 = [-0.5, 0, -0.5], B: V3 = [0.5, 0, -0.5], C: V3 = [0.5, 0, 0.5], D: V3 = [-0.5, 0, 0.5];
  const R0: V3 = [-0.5, 1, 0], R1: V3 = [0.5, 1, 0];
  const t = (...v: V3[]) => v.forEach((q) => p.push(...q));
  // slopes (outward), gables, underside
  t(D, C, R1, D, R1, R0); // +z slope
  t(B, A, R0, B, R0, R1); // -z slope
  t(A, D, R0); // -x gable
  t(C, B, R1); // +x gable
  t(A, B, C, A, C, D); // underside (faces down)
  return new Float32Array(p);
}
/** Hip roof: base -0.5..0.5, ridge along x from -0.2 to 0.2 at y 1. */
function hipTpl(): Float32Array {
  const p: number[] = [];
  const A: V3 = [-0.5, 0, -0.5], B: V3 = [0.5, 0, -0.5], C: V3 = [0.5, 0, 0.5], D: V3 = [-0.5, 0, 0.5];
  const R0: V3 = [-0.22, 1, 0], R1: V3 = [0.22, 1, 0];
  const t = (...v: V3[]) => v.forEach((q) => p.push(...q));
  t(D, C, R1, D, R1, R0);
  t(B, A, R0, B, R0, R1);
  t(A, D, R0);
  t(C, B, R1);
  t(A, B, C, A, C, D);
  return new Float32Array(p);
}
let U: Record<string, Float32Array> | null = null;
function units() {
  if (U) return U;
  U = {
    box: tpl(new THREE.BoxGeometry(1, 1, 1)),
    cyl6: tpl(new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1)),
    cyl8: tpl(new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1)),
    cone4: tpl(new THREE.ConeGeometry(0.5, 1, 4, 1)),
    cone6: tpl(new THREE.ConeGeometry(0.5, 1, 6, 1)),
    cone8: tpl(new THREE.ConeGeometry(0.5, 1, 8, 1)),
    ico0: tpl(new THREE.IcosahedronGeometry(0.5, 0)),
    ico1: tpl(new THREE.IcosahedronGeometry(0.5, 1)),
    gable: gableTpl(),
    hip: hipTpl(),
    /** The gable template split: slopes and underside (tile), and the two end triangles (wall). */
    gableRoof: (() => {
      const g = gableTpl();
      return new Float32Array([...g.slice(0, 36), ...g.slice(54)]);
    })(),
    gableEnds: gableTpl().slice(36, 54),
    /** A unit square facing up at y 0 (flagstones). */
    quad: new Float32Array([-0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5]),
  };
  return U;
}

// ── Builder: flat, vertex coloured, optional per-vertex sway attribute ───────

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

class Builder {
  pos: number[] = [];
  col: number[] = [];
  sway: number[] | null;
  /** The sway written with every vertex while set: phase, bob, flutter, 0. */
  cur: [number, number, number, number] = [0, 0, 0, 0];
  private face = 0;
  constructor(withSway = false) {
    this.sway = withSway ? [] : null;
  }
  get tris() {
    return this.pos.length / 9;
  }
  private push(x: number, y: number, z: number, c: RGB) {
    this.pos.push(x, y, z);
    this.col.push(c[0], c[1], c[2]);
    if (this.sway) this.sway.push(...this.cur);
  }
  tri(a: V3, b: V3, c: V3, cl: RGB) {
    this.push(a[0], a[1], a[2], cl);
    this.push(b[0], b[1], b[2], cl);
    this.push(c[0], c[1], c[2], cl);
  }
  /** A polygon (fan), turned so its normal points along `want` when given. */
  poly(pts: V3[], cl: RGB, want?: V3) {
    if (want) {
      _a.set(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]);
      _b.set(pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]);
      _n.crossVectors(_a, _b);
      if (_n.x * want[0] + _n.y * want[1] + _n.z * want[2] < 0) pts = pts.slice().reverse();
    }
    for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0], pts[i], pts[i + 1], cl);
  }
  /**
   * A template through a matrix. shade: random per-face value jitter; grad:
   * how much darker the template's bottom is than its top (cheap baked AO).
   */
  add(t: Float32Array, m: THREE.Matrix4, cl: RGB, shade = 0.04, grad = 0) {
    for (let i = 0; i < t.length; i += 9) {
      const k = 1 + (rnd(this.face++, 7) - 0.5) * 2 * shade;
      for (let j = 0; j < 9; j += 3) {
        _v.set(t[i + j], t[i + j + 1], t[i + j + 2]);
        const g = grad ? 1 - grad * (0.5 - Math.max(-0.5, Math.min(0.5, _v.y))) : 1;
        _v.applyMatrix4(m);
        this.push(_v.x, _v.y, _v.z, [cl[0] * k * g, cl[1] * k * g, cl[2] * k * g]);
      }
    }
  }
  /** A square beam of section w x d from a to b. */
  beam(a: V3, b: V3, w: number, cl: RGB, shade = 0.04) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _a.length();
    if (len < 1e-4) return;
    _q.setFromUnitVectors(UP, _a.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new THREE.Vector3(w, len, w));
    this.add(units().box, m, cl, shade);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    if (this.sway) g.setAttribute("aSway", new THREE.Float32BufferAttribute(this.sway, 4));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Local frame for a building: origin, yaw; P() maps local to world. */
function frame(x: number, y: number, z: number, ry: number) {
  const M = T(x, y, z, 1, 1, 1, ry);
  const P = (lx: number, ly: number, lz: number): V3 => {
    _v.set(lx, ly, lz).applyMatrix4(M);
    return [_v.x, _v.y, _v.z];
  };
  const L = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, ry2 = 0, rx = 0, rz = 0) => mul(M, T(lx, ly, lz, sx, sy, sz, ry2, rx, rz));
  const N = (nx: number, nz: number): V3 => {
    _v.set(nx, 0, nz).applyAxisAngle(UP, ry);
    return [_v.x, 0, _v.z];
  };
  return { M, P, L, N };
}

/** A quad on a building face: local face centre (lx, ly, lz) on the face whose outward normal is local (nx, 0, nz). */
function faceQuad(b: Builder, F: ReturnType<typeof frame>, lx: number, ly: number, lz: number, nx: number, nz: number, w: number, h: number, cl: RGB, out = 0.25) {
  const tx = -nz;
  const tz = nx;
  const cx = lx + nx * out;
  const cz = lz + nz * out;
  b.poly(
    [F.P(cx - tx * w / 2, ly - h / 2, cz - tz * w / 2), F.P(cx + tx * w / 2, ly - h / 2, cz + tz * w / 2), F.P(cx + tx * w / 2, ly + h / 2, cz + tz * w / 2), F.P(cx - tx * w / 2, ly + h / 2, cz - tz * w / 2)],
    cl,
    F.N(nx, nz),
  );
}

// ── The floating rock ────────────────────────────────────────────────────────

function floatingRock(b: Builder, cx: number, top: number, cz: number, depth: number, rim: (th: number) => number, seg: number, seed: number, grassy = true) {
  const rings: [number, number][] = [
    [0, 1.0], [0.025, 1.012], [0.06, 0.985], [0.12, 0.955], [0.15, 0.93], [0.24, 0.875], [0.3, 0.84],
    [0.42, 0.75], [0.5, 0.68], [0.62, 0.56], [0.72, 0.44], [0.82, 0.31], [0.91, 0.18], [0.97, 0.08], [1, 0.02],
  ];
  const bandCol = [K.grass, K.earth, K.rockA, K.rockB, K.rockA, K.rockC, K.rockB, K.rockC, K.rockD, K.rockD, K.rockE, K.rockE, K.rockE, K.rockE];
  const ring = (k: number): V3[] => {
    const out: V3[] = [];
    const [dd, ff] = rings[k];
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const jag = k === 0 ? 1 : 1 + 0.12 * (rnd(i + k * 97, seed) - 0.5) + 0.07 * Math.sin(th * 5 + seed + k);
      const r = rim(th) * ff * jag;
      const dy = k === 0 ? 0 : depth * dd * (1 + 0.08 * (rnd(i * 3 + k, seed + 1) - 0.5));
      out.push([cx + Math.sin(th) * r, top - dy, cz - Math.cos(th) * r]);
    }
    return out;
  };
  const R = rings.map((_, k) => ring(k));
  for (let k = 0; k < R.length - 1; k++) {
    const A = R[k];
    const Bq = R[k + 1];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const base = k === 0 && !grassy ? K.rockA : bandCol[Math.min(k, bandCol.length - 1)];
      const v = 0.9 + 0.2 * rnd(i + k * 31, seed + 5);
      const cl = mulC(base, v);
      const mx = (A[i][0] + A[j][0]) / 2 - cx;
      const mz = (A[i][2] + A[j][2]) / 2 - cz;
      b.poly([A[i], A[j], Bq[j], Bq[i]], cl, [mx, -0.3 * (k / R.length), mz]);
    }
  }
  // The cap, coloured by where the town paints it.
  const capR = [0, 0.35, 0.62, 0.82, 0.94, 1];
  const capRing = (f: number): V3[] => R[0].map((p) => [cx + (p[0] - cx) * f, top, cz + (p[2] - cz) * f]);
  const C = capR.map(capRing);
  for (let k = 0; k < C.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const mx = (C[k][i][0] + C[k + 1][j][0]) / 2;
      const mz = (C[k][i][2] + C[k + 1][j][2]) / 2;
      const n = rnd(i * 7 + k, seed + 9);
      const back = grassy ? capPaint(mx, mz, n) : mulC(K.grassB, 0.9 + 0.2 * n);
      if (k === 0) b.poly([[cx, top, cz], C[1][j], C[1][i]], back, [0, 1, 0]);
      else b.poly([C[k][i], C[k][j], C[k + 1][j], C[k + 1][i]], back, [0, 1, 0]);
    }
  }
  // Hanging spikes under the rock.
  const n = Math.max(3, Math.round(seg / 5));
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2 + rnd(i, seed + 3);
    const f = 0.2 + 0.45 * rnd(i, seed + 4);
    const r = rim(th) * f;
    const len = depth * (0.25 + 0.3 * rnd(i, seed + 6));
    const w = rim(th) * 0.12 * (0.6 + rnd(i, seed + 8));
    const yb = top - depth * (0.55 + 0.35 * (1 - f));
    b.add(units().cone6, T(cx + Math.sin(th) * r, yb - len / 2, cz - Math.cos(th) * r, w, len, w, rnd(i, seed + 2) * 6, Math.PI), mulC(K.rockD, 0.9 + 0.2 * rnd(i, 2)), 0.08);
  }
}

/** What the rock's cap shows between the houses: cobbles near the town, grass toward the back rim. */
function capPaint(x: number, z: number, n: number): RGB {
  const r = Math.hypot(x - HI.x, z - HI.z);
  const b = bearingOf(x - HI.x, z - HI.z);
  const harbourSide = b > 40 && b < 240;
  const edge = r / rimB(b);
  if (!harbourSide && edge > 0.8) return mixC(K.grass, K.grassB, n);
  if (edge > 0.9) return mixC(K.earth, K.grassB, 0.4 + 0.3 * n);
  return mixC(K.cobble, K.pavingB, n);
}

// ── Airships: the world's one kit (dress-sky.ts airshipKit), sizes vary ─────

/** Push the kit's triangles through M into a builder pair (solid, glow); `dy` shifts the kit's local origin first. */
function pushKit(b: Builder, lamps: Builder, M: THREE.Matrix4, kit: AirshipKitGeo, dy = 0) {
  const pt = (a: number[], i: number): V3 => {
    _v.set(a[i], a[i + 1] + dy, a[i + 2]).applyMatrix4(M);
    return [_v.x, _v.y, _v.z];
  };
  for (let i = 0; i < kit.p.length; i += 9) b.tri(pt(kit.p, i), pt(kit.p, i + 3), pt(kit.p, i + 6), [kit.c[i], kit.c[i + 1], kit.c[i + 2]]);
  for (let i = 0; i < kit.gp.length; i += 9) lamps.tri(pt(kit.gp, i), pt(kit.gp, i + 3), pt(kit.gp, i + 6), [kit.gc[i], kit.gc[i + 1], kit.gc[i + 2]]);
}

/** A moored ship: local origin at the centre of its deck at deck level, nose +x, hull `L` long (the kit at that size). */
function hullShip(b: Builder, lamps: Builder, M: THREE.Matrix4, L: number, band: RGB) {
  pushKit(b, lamps, M, airshipKit(L, band));
}

/** A ship moored nose-in to a mast: local origin at the envelope's axis, the envelope about `L` long. */
function blimp(b: Builder, lamps: Builder, M: THREE.Matrix4, L: number, band: RGB) {
  const kit = airshipKit(L * 0.81, band);
  pushKit(b, lamps, M, kit, -kit.envY);
}

// ── Install ──────────────────────────────────────────────────────────────────

/** Chimney tops that smoke (world x, y, z); tagged for life.ts, which draws the plumes. */
export const HARBOUR_SMOKE: V3[] = [];
/** The moored airships (not yours): centre, heading, length, kind. */
export const HARBOUR_BERTHS: { x: number; y: number; z: number; heading: number; length: number; kind: "hull" | "blimp" }[] = [];

const SWAY_VERT_PARS = /* glsl */ `
attribute vec4 aSway;
uniform float uHarbourT;
`;
const SWAY_VERT = /* glsl */ `
#include <begin_vertex>
{
  float hT = uHarbourT;
  transformed.y += sin(hT * 0.7 + aSway.x) * aSway.y;
  float fl = aSway.z;
  transformed.y += sin(hT * 3.1 + aSway.x * 1.7 + position.x * 0.13) * fl;
  transformed.x += sin(hT * 2.3 + aSway.x + position.z * 0.17) * fl * 0.7;
  transformed.z += cos(hT * 2.7 + aSway.x + position.x * 0.17) * fl * 0.7;
}
`;
export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const u = units();
  const scene = ctx.scene;
  const disposables: { dispose(): void }[] = [];
  const track = <X extends { dispose(): void }>(x: X): X => {
    disposables.push(x);
    return x;
  };

  // ── Replace the grey stand-ins ──
  const replaced: string[] = [];
  for (const name of ["Set_a8", "Landmark_a8", "HarbourGlow"]) {
    const o = scene.getObjectByName(name);
    if (o) {
      o.visible = false;
      replaced.push(name);
    }
  }

  const town = new Builder();
  const glow = new Builder();
  const anim = new Builder(true);
  const animGlow = new Builder(true);
  const hall = new Builder();
  const hallGlow = new Builder();
  /** The guild's flag on the spire: the landmark's, and it flutters (sway material). */
  const hallFlag = new Builder(true);
  HARBOUR_SMOKE.length = 0;
  HARBOUR_BERTHS.length = 0;

  // ── The rock and its satellites ──
  floatingRock(town, HI.x, Y, HI.z, HARBOUR_DEPTH, rimAt, 64, 11);
  const bits: [number, number, number, number][] = [[-2790, 1515, -4190, 34], [-2660, 1460, -4770, 26], [-1860, 1528, -4540, 22], [-2020, 1440, -4760, 15]];
  bits.forEach(([bx, by, bz, r], i) => floatingRock(town, bx, by, bz, r * 1.9, (th) => r * (1 + 0.1 * Math.sin(th * 3 + i)), 14, 40 + i, true));
  // A spruce on the biggest satellite.
  town.add(u.cone6, T(-2790, 1515 + 20, -4190, 14, 34, 14), K.leafB, 0.08);
  town.add(u.cone6, T(-2783, 1515 + 14, -4200, 10, 22, 10), K.leaf, 0.08);

  // ── Key geometry of the town ──
  const SB = bearingOf(HP[2][0] - HP[0][0], HP[2][1] - HP[0][1]); // the street's bearing, berth to square (~321)
  const SQ = { x: -2262, z: -4318, r: 74 };
  // The hall sits 16 toward frame LEFT of the place's base: with the board
  // standing on its right, the pair (the landmark's box) then centres near
  // x 0.63 in the a8 stop frame (bearing 321, the panel on the left) and the
  // board stays inside the frame.
  const HO: [number, number] = [A8.pos.x - dirOf(51)[0] * 16, A8.pos.z - dirOf(51)[1] * 16];
  const hallF = frame(HO[0], Y, HO[1], yawTo(51)); // local +z = the front (bearing 141), +x = bearing 51
  const HALL = { w: 96, d: 54 };
  const boardLocal = { x: 46, z: 40 };
  const [bdx, bdz] = [hallF.P(boardLocal.x, 0, boardLocal.z)[0], hallF.P(boardLocal.x, 0, boardLocal.z)[2]];
  const yoursB = bearingOf(SHIP_DOCKED.x - HI.x, SHIP_DOCKED.z - HI.z);
  const LIGHTHOUSE_B = 246;

  // ── Berths: your pier plus five moored ships ──
  type Berth = { b: number; kind: "hull" | "blimp"; L: number; band: number; out: number; along: 1 | -1 };
  const berths: Berth[] = [
    { b: 100, kind: "hull", L: 132, band: 0, out: 30, along: 1 },
    { b: 176, kind: "hull", L: 104, band: 1, out: 26, along: -1 },
    { b: 208, kind: "blimp", L: 96, band: 2, out: 0, along: 1 },
    { b: 62, kind: "blimp", L: 78, band: 3, out: 0, along: 1 },
    { b: 293, kind: "hull", L: 150, band: 4, out: 34, along: -1 },
    { b: 356, kind: "hull", L: 116, band: 2, out: 28, along: 1 },
  ];
  const pier = (b: number, r0: number, r1: number, wide: number) => {
    const [ax, az] = at(b, r0);
    const [bx, bz] = at(b, r1);
    const len = Math.hypot(bx - ax, bz - az);
    const F = frame((ax + bx) / 2, Y, (az + bz) / 2, yawTo(b));
    // Planks across the pier, alternating shade.
    const n = Math.max(2, Math.round(len / 4));
    for (let k = 0; k < n; k++) {
      const x = -len / 2 + (k + 0.5) * (len / n);
      town.add(u.box, F.L(x, -0.5, 0, len / n - 0.35, 1.2, wide), mulC(K.deck, 0.9 + 0.18 * rnd(k, b)), 0.02);
    }
    // Stringers, piles and braces down into the rock / hanging below.
    for (const s of [-1, 1]) {
      town.add(u.box, F.L(0, -2, s * (wide / 2 - 1), len, 2.2, 1.6), K.timberDk, 0.03);
      for (let k = 0; k <= Math.floor(len / 22); k++) {
        const x = -len / 2 + 6 + k * 22;
        if (x > len / 2) break;
        const rHere = r0 + ((x + len / 2) / len) * (r1 - r0);
        const beyond = rHere > rimB(b) - 4;
        const pl = beyond ? 26 : 8;
        town.add(u.box, F.L(x, -pl / 2 - 1, s * (wide / 2 - 1), 1.8, pl, 1.8), K.timberDk, 0.04);
        if (beyond) town.beam(F.P(x, -pl, s * (wide / 2 - 1)), F.P(x - 18, -pl - 22, s * (wide / 2 - 4)), 1.3, K.timberDk);
      }
      // Rail posts and rope.
      for (let x = -len / 2 + 14; x < len / 2 - 2; x += 12) town.add(u.box, F.L(x, 3.5, s * (wide / 2 - 0.6), 0.9, 7, 0.9), K.timber, 0.04);
      town.beam(F.P(-len / 2 + 14, 6.5, s * (wide / 2 - 0.6)), F.P(len / 2 - 2, 6.5, s * (wide / 2 - 0.6)), 0.5, K.rope);
      // Bollards at the head.
      town.add(u.cyl6, F.L(len / 2 - 3, 2.2, s * (wide / 2 - 2.5), 2.4, 4.4, 2.4), K.iron, 0.05);
    }
    return F;
  };
  // Your berth: a pier out to the docked ship's bow (HARBOUR_PATH[0]).
  {
    const rr = rimB(yoursB);
    const bowR = Math.hypot(HP[0][0] - HI.x, HP[0][1] - HI.z);
    const F = pier(yoursB, rr - 10, bowR + 3, 24);
    const len = bowR + 13 - rr;
    // Lamp posts at the pier head, crates and a rope coil.
    // Lamps at the pier's root on the quay, well off the line up the street.
    for (const s of [-1, 1]) {
      town.add(u.box, F.L(-len / 2 + 4, 11, s * 30, 1.2, 22, 1.2), K.iron, 0.03);
      glow.add(u.box, F.L(-len / 2 + 4, 22.6, s * 30, 2.4, 3.2, 2.4), GL.lamp, 0);
      town.add(u.cone4, F.L(-len / 2 + 4, 25.4, s * 30, 3.6, 2.4, 3.6, Math.PI / 4), K.iron, 0.03);
    }
    town.add(u.cyl8, F.L(-len / 2 + 16, 0.8, 8, 5, 1.4, 5), K.rope, 0.05);
  }
  berths.forEach((d, i) => {
    const rr = rimB(d.b);
    if (d.kind === "hull") {
      // A short pier; the ship lies across its head, parallel to the rim.
      const hw = 0.13 * d.L;
      const reach = d.out;
      pier(d.b, rr - 10, rr + reach, 16);
      const [px, pz] = at(d.b, rr + reach + hw + 4);
      const heading = d.b + 90 * d.along;
      anim.cur = [i * 1.7, 1.6, 0, 0];
      animGlow.cur = anim.cur;
      hullShip(anim, animGlow, T(px, Y + 1, pz, 1, 1, 1, yawTo(heading)), d.L, K.bands[d.band]);
      HARBOUR_BERTHS.push({ x: px, y: Y + 1, z: pz, heading, length: d.L, kind: "hull" });
      // Mooring ropes from the pier head to the bow and the stern, and a gangplank.
      const [hdx, hdz] = dirOf(heading);
      const [hx, hz] = at(d.b, rr + reach - 3);
      town.beam([hx, Y + 3, hz], [px + hdx * d.L * 0.4, Y + 4, pz + hdz * d.L * 0.4], 0.5, K.rope);
      town.beam([hx, Y + 3, hz], [px - hdx * d.L * 0.4, Y + 4, pz - hdz * d.L * 0.4], 0.5, K.rope);
      const [gx, gz] = at(d.b, rr + reach + 5);
      town.add(u.box, T(gx, Y + 0.6, gz, 12, 0.8, 6, yawTo(d.b)), K.deck, 0.03);
    } else {
      // A blimp nose-in to a mooring mast at the pier head.
      const reach = 34;
      pier(d.b, rr - 10, rr + reach, 12);
      const [mx, mz] = at(d.b, rr + reach - 3);
      const mastH = 0.17 * d.L + 30;
      for (const [a, c] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) town.beam([mx + a * 3.5, Y, mz + c * 3.5], [mx + a * 1.2, Y + mastH, mz + c * 1.2], 1.1, K.iron);
      for (let k = 1; k < 4; k++) town.add(u.box, T(mx, Y + (mastH * k) / 4, mz, 6.4 - k, 0.8, 6.4 - k), K.iron, 0.03);
      town.add(u.cyl8, T(mx, Y + mastH + 1.2, mz, 4, 2.4, 4), K.brass, 0.04);
      glow.add(u.box, T(mx, Y + mastH + 3.6, mz, 1.6, 2.2, 1.6), GL.lamp, 0);
      const heading = d.b + 180;
      const [fx, fz] = dirOf(d.b);
      const cxs = mx + fx * d.L * 0.52;
      const czs = mz + fz * d.L * 0.52;
      anim.cur = [i * 1.7, 1.2, 0, 0];
      animGlow.cur = anim.cur;
      blimp(anim, animGlow, T(cxs, Y + mastH, czs, 1, 1, 1, yawTo(heading)), d.L, K.bands[d.band]);
      HARBOUR_BERTHS.push({ x: cxs, y: Y + mastH, z: czs, heading, length: d.L, kind: "blimp" });
    }
  });
  anim.cur = [0, 0, 0, 0];
  animGlow.cur = anim.cur;

  const berthNear = (b: number, w: number) => berths.some((d) => angDiff(b, d.b) < w) || angDiff(b, yoursB) < w;

  // ── Quay: paved band round the harbour side, iron railing; a stone parapet elsewhere ──
  for (let b = 0; b < 360; b += 5) {
    const rr = rimB(b + 2.5);
    const harbourSide = b >= 40 && b < 240;
    const [qpx, qpz] = at(b + 2.5, rr - 2);
    const F = frame(qpx, Y, qpz, yawTo(b + 2.5 + 90));
    const seg = rr * 5 * DEG + 0.6;
    if (harbourSide) {
      // Flagstones, 3 rows.
      for (let row = 0; row < 3; row++) {
        const [qx, qz] = at(b + 2.5, rr - 6 - row * 11);
        const c = pick([K.paving, K.pavingB, K.pavingC], rnd(b * 3 + row, 5));
        town.add(u.quad, T(qx, Y + 0.3, qz, seg * (1 - row * 0.03) - 0.5, 1, 10.4, yawTo(b + 2.5 + 90)), c, 0.02);
      }
      if (!berthNear(b + 2.5, 4)) {
        town.add(u.box, F.L(0, 4, 0, seg, 1, 0.6), K.iron, 0.02);
        town.add(u.box, F.L(-seg / 2, 2.2, 0, 0.9, 4.4, 0.9), K.iron, 0.02);
      }
    } else {
      town.add(u.box, F.L(0, 2.4, 0, seg, 4.8, 3), K.stone, 0.06, 0.2);
    }
  }

  // ── Street and square: flagstones ──
  const tileRun = (ax: number, az: number, bx: number, bz: number, wide: number, tile: number, seed: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const b = bearingOf(bx - ax, bz - az);
    const F = frame(ax, Y, az, yawTo(b));
    const nx = Math.max(1, Math.round(len / tile));
    const nz = Math.max(1, Math.round(wide / tile));
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const c = pick([K.paving, K.pavingB, K.pavingC, K.paving], rnd(i * 13 + j, seed));
        town.add(u.quad, F.L((i + 0.5) * (len / nx), 0.45, -wide / 2 + (j + 0.5) * (wide / nz), len / nx - 0.6, 1, wide / nz - 0.6), c, 0.02);
      }
  };
  for (let i = 0; i < HP.length - 1; i++) tileRun(HP[i][0], HP[i][1], HP[i + 1][0], HP[i + 1][1], 38, 9.5, 20 + i);
  {
    const n = 14;
    const step = (SQ.r * 2) / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = SQ.x - SQ.r + (i + 0.5) * step;
        const z = SQ.z - SQ.r + (j + 0.5) * step;
        const r = Math.hypot(x - SQ.x, z - SQ.z);
        if (r > SQ.r) continue;
        const ring = Math.floor(r / 14) % 2;
        const c = ring ? K.pavingC : pick([K.paving, K.pavingB], rnd(i * 17 + j, 31));
        town.add(u.quad, T(x, Y + 0.6, z, step - 0.6, 1, step - 0.6, yawTo(SB)), c, 0.02);
      }
    // A forecourt from the square to the hall's steps and the board.
    const [fx0, , fz0] = hallF.P(0, 0, 40);
    const [fx1, , fz1] = hallF.P(0, 0, 90);
    tileRun(fx0, fz0, fx1, fz1, 120, 10, 44);
  }

  // ── Market stalls along the street (muted striped awnings) ──
  const stallAt: [number, number][] = [];
  {
    const [ax, az] = HP[0];
    const [bx, bz] = HP[2];
    const len = Math.hypot(bx - ax, bz - az);
    const [dx, dz] = [(bx - ax) / len, (bz - az) / len];
    let n = 0;
    for (let s = 52; s < len - 30; s += 27) {
      for (const side of [-1, 1]) {
        if (rnd(s, side + 3) < 0.12) continue;
        const [nx, nz] = [-dz * side, dx * side];
        const cx = ax + dx * s + nx * 27;
        const cz = az + dz * s + nz * 27;
        stallAt.push([cx, cz]);
        const F = frame(cx, Y, cz, yawTo(SB));
        // local +x along the street; local +z toward... pick the side facing the street
        const face = side > 0 ? -1 : 1; // local z toward the street centre
        const W = 16;
        const D = 10;
        town.add(u.box, F.L(0, 3, face * -1, W, 6, D - 3), K.timber, 0.05, 0.25);
        town.add(u.box, F.L(0, 6.3, face * 1, W + 0.6, 0.6, 4), K.greyBrown, 0.03);
        for (const [px, pz] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) town.add(u.box, F.L(px, 7, pz, 0.8, 14, 0.8), K.timberDk, 0.03);
        // Awning: stripes sloping down toward the street.
        const stripe = pick(K.stripes, rnd(n, 51));
        const ns = 6;
        for (let k = 0; k < ns; k++) {
          const x0 = -W / 2 - 1 + (k * (W + 2)) / ns;
          const x1 = x0 + (W + 2) / ns;
          const c = k % 2 ? stripe : K.canvas;
          const hiZ = -face * (D / 2 + 1);
          const loZ = face * (D / 2 + 3);
          const quad: V3[] = [F.P(x0, 15.5, hiZ), F.P(x1, 15.5, hiZ), F.P(x1, 12, loZ), F.P(x0, 12, loZ)];
          town.poly(quad, c, [0, 1, 0]);
          town.poly(quad, mulC(c, 0.75), [0, -1, 0]);
          // Scalloped valance.
          town.poly([F.P(x0, 12, loZ), F.P(x1, 12, loZ), F.P((x0 + x1) / 2, 9.8, loZ)], c, F.N(0, face));
          town.poly([F.P(x0, 12, loZ), F.P(x1, 12, loZ), F.P((x0 + x1) / 2, 9.8, loZ)], c, F.N(0, -face));
        }
        // Goods on the counter and crates by it.
        for (let g = 0; g < 3; g++) town.add(u.box, F.L(-4 + g * 4, 7.8, face * 1, 3, 2.2, 3, rnd(n + g, 3)), pick([K.flowers[1], K.leafLit, K.canvas, K.flowers[0]], rnd(n * 3 + g, 52)), 0.05);
        town.add(u.box, F.L(W / 2 + 4, 2.5, 0, 5, 5, 5, 0.3), K.timber, 0.05, 0.2);
        if (rnd(n, 53) > 0.4) town.add(u.box, F.L(W / 2 + 4, 6.6, 0.5, 4, 3.2, 4, 0.8), K.greyBrown, 0.05);
        n++;
      }
    }
  }

  // ── Houses ──
  const e1 = dirOf(SB); // along the street
  const e2 = dirOf(SB + 90);
  const camA8: [number, number] = [-2140, -4160];
  const hallBear = bearingOf(HO[0] + dirOf(51)[0] * 14 - camA8[0], HO[1] + dirOf(51)[1] * 14 - camA8[1]);
  const hallDist = Math.hypot(HO[0] - camA8[0], HO[1] - camA8[1]);
  const seeDir = dirOf(141);
  let houseN = 0;
  let chimneys: V3[] = [];
  const house = (cx: number, cz: number, ry: number, w: number, d: number, floors: number, seed: number, kind: "house" | "warehouse") => {
    const F = frame(cx, Y, cz, ry);
    const FH = kind === "warehouse" ? 22 : 15;
    const h = floors * FH + 2;
    // Pass 3: aerial perspective. Houses far from the a8 camera lose saturation
    // and lift toward the peach sky, so the town has depth instead of one flat board.
    const far = Math.min(1, Math.max(0, (Math.hypot(cx - camA8[0], cz - camA8[1]) - 220) / 520));
    const air = (c: RGB): RGB => {
      const l = (c[0] + c[1] + c[2]) / 3;
      const t = far * 0.45;
      return [c[0] + (l * 0.9 + 0.1 * HAZE_A8[0] - c[0]) * t * 0.6 + (HAZE_A8[0] - c[0]) * t * 0.4, c[1] + (l * 0.9 + 0.1 * HAZE_A8[1] - c[1]) * t * 0.6 + (HAZE_A8[1] - c[1]) * t * 0.4, c[2] + (l * 0.9 + 0.1 * HAZE_A8[2] - c[2]) * t * 0.6 + (HAZE_A8[2] - c[2]) * t * 0.4];
    };
    const wall = air(kind === "warehouse" ? mulC(pick(K.plaster, rnd(seed, 1)), 0.9) : pick(K.plaster, rnd(seed, 1)));
    const slate = rnd(seed, 2) < (kind === "warehouse" ? 0.8 : 0.6);
    const roof = air(slate ? pick(K.slate, rnd(seed, 3)) : pick(K.roofs, rnd(seed, 3)));
    const timbered = kind === "house" && floors >= 2 && rnd(seed, 4) < 0.45;
    town.add(u.box, F.L(0, h / 2, 0, w, h, d), wall, 0.03, 0.16);
    town.add(u.box, F.L(0, 1.6, 0, w + 0.8, 3.2, d + 0.8), K.stoneDk, 0.04);
    if (timbered) {
      const tc = K.timber;
      for (let f = 1; f <= floors - 1; f++) town.add(u.box, F.L(0, f * FH + 1, 0, w + 0.5, 1.3, d + 0.5), tc, 0.03);
      for (const [px, pz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) town.add(u.box, F.L(px, FH + (h - FH) / 2, pz, 1.4, h - FH, 1.4), tc, 0.03);
      // Braces on the two long faces of the upper floor.
      for (const s of [-1, 1]) {
        const z = s * (d / 2 + 0.3);
        town.beam(F.P(-w / 2 + 1, FH + 1.5, z), F.P(-w / 2 + FH * 0.8, h - 1, z), 0.9, tc);
        town.beam(F.P(w / 2 - 1, FH + 1.5, z), F.P(w / 2 - FH * 0.8, h - 1, z), 0.9, tc);
      }
    }
    // Roof: gable (most), hip (some); ridge beam; overhang.
    const rh = 0.45 * d + 3;
    const hip = !slate && rnd(seed, 5) < 0.3;
    if (hip) town.add(u.hip, F.L(0, h, 0, w + 3.2, rh, d + 3.4), roof, 0.05);
    else {
      town.add(u.gableRoof, F.L(0, h, 0, w + 3.2, rh, d + 3.4), roof, 0.05);
      // The gable ends are wall, not tile.
      town.add(u.gableEnds, F.L(0, h - 0.05, 0, w + 0.4, rh - 0.6, d), wall, 0.02);
    }
    if (!hip) town.add(u.box, F.L(0, h + rh, 0, w + 3.6, 1.1, 1.1), mulC(roof, 0.75), 0.03);
    // Chimney.
    if (rnd(seed, 6) < (kind === "warehouse" ? 0.2 : 0.55)) {
      const px = (rnd(seed, 7) - 0.5) * w * 0.6;
      const pz = (rnd(seed, 8) - 0.5) * d * 0.4;
      const ch = rh + 7;
      town.add(u.box, F.L(px, h + ch / 2, pz, 3.4, ch, 3.4), K.stone, 0.05, 0.2);
      town.add(u.box, F.L(px, h + ch + 0.5, pz, 4.4, 1, 4.4), K.stoneDk, 0.03);
      chimneys.push(F.P(px, h + ch + 1.5, pz));
    }
    // Windows and doors on the faces the route sees (the approach and the square look north-west).
    const faces: [number, number, number][] = [[0, 1, w], [0, -1, w], [1, 0, d], [-1, 0, d]];
    for (const [nx, nz, span] of faces) {
      const nw = F.N(nx, nz);
      const facing = nw[0] * seeDir[0] + nw[2] * seeDir[1];
      if (facing < -0.25) continue;
      const along = nx === 0 ? d / 2 : w / 2;
      const nWin = Math.max(1, Math.floor(span / (kind === "warehouse" ? 12 : 9)));
      const lit = rnd(seed, 9) < 0.45;
      const shut = pick(K.shutters, rnd(seed, 10));
      const withShutters = kind === "house" && rnd(seed, 11) < 0.5;
      for (let f = 0; f < floors; f++) {
        for (let k = 0; k < nWin; k++) {
          const t = -span / 2 + ((k + 0.5) * span) / nWin;
          const lx = nx === 0 ? t : nx * along;
          const lz = nz === 0 ? t : nz * along;
          const wy = f * FH + (kind === "warehouse" ? FH * 0.5 : FH * 0.58) + 1;
          const isDoor = f === 0 && k === Math.floor(nWin / 2) && nz === 1;
          if (isDoor) {
            faceQuad(town, F, lx, 7.5, lz, nx, nz, kind === "warehouse" ? 12 : 6.5, kind === "warehouse" ? 15 : 11, K.timberDk);
            continue;
          }
          const bright = lit && rnd(seed * 7 + f * 5 + k, 12) < 0.5;
          const ww = kind === "warehouse" ? 5 : 4.2;
          const wh = kind === "warehouse" ? 5 : 6.2;
          faceQuad(bright ? glow : town, F, lx, wy, lz, nx, nz, ww, wh, bright ? GL.window : K.glass, 0.3);
          if (withShutters && !bright) {
            const tx = -nz;
            const tz = nx;
            faceQuad(town, F, lx + tx * (ww / 2 + 1.3), wy, lz + tz * (ww / 2 + 1.3), nx, nz, 2.4, wh, shut, 0.35);
            faceQuad(town, F, lx - tx * (ww / 2 + 1.3), wy, lz - tz * (ww / 2 + 1.3), nx, nz, 2.4, wh, shut, 0.35);
          }
          // Flower boxes on some upper windows.
          if (f >= 1 && rnd(seed * 3 + k, 13) < 0.25) {
            const bx = lx + nx * 1.4;
            const bz = lz + nz * 1.4;
            town.add(u.box, F.L(bx, wy - wh / 2 - 0.8, bz, nx === 0 ? ww + 1 : 2, 1.6, nz === 0 ? ww + 1 : 2), K.timber, 0.03);
            town.add(u.box, F.L(bx, wy - wh / 2 + 0.4, bz, nx === 0 ? ww + 0.6 : 1.8, 1.2, nz === 0 ? ww + 0.6 : 1.8), pick(K.flowers, rnd(seed + k, 14)), 0.1);
          }
        }
      }
    }
    // Warehouses: a hoist beam over the loading door.
    if (kind === "warehouse") {
      town.beam(F.P(0, h - 3, d / 2), F.P(0, h - 3, d / 2 + 8), 1.4, K.timberDk);
      town.beam(F.P(0, h - 3, d / 2 + 7.5), F.P(0, h - 14, d / 2 + 7.5), 0.3, K.rope);
    }
    houseN++;
  };

  // Warehouses along the inner edge of the quay, facing out to the docks.
  const whPlaced: [number, number][] = [];
  for (const b of [76, 122, 158, 192, 222]) {
    if (berthNear(b, 7)) continue;
    const r = rimB(b) - 62;
    const [x, z] = at(b, r);
    if (distPath(x, z) < 44) continue;
    house(x, z, yawTo(b - 90), 44, 26, 2, b * 13, "warehouse");
    whPlaced.push([x, z]);
  }
  // The lighthouse on the south-west rim: the isle's silhouette from the flight.
  {
    const [lx, lz] = at(LIGHTHOUSE_B, rimB(LIGHTHOUSE_B) - 26);
    town.add(u.cyl8, T(lx, Y + 5, lz, 26, 10, 26), K.stoneDk, 0.05);
    town.add(u.cyl8, T(lx, Y + 48, lz, 16, 80, 16), K.cream, 0.04, 0.2);
    for (const hy of [30, 58]) town.add(u.cyl8, T(lx, Y + hy, lz, 16.6, 5, 16.6), lin(0x5a6a80), 0.03);
    town.add(u.cyl8, T(lx, Y + 90, lz, 22, 3, 22), K.iron, 0.03);
    glow.add(u.cyl8, T(lx, Y + 97, lz, 11, 11, 11), GL.lamp, 0);
    town.add(u.cone8, T(lx, Y + 109, lz, 16, 14, 16), K.iron, 0.03);
    whPlaced.push([lx, lz]);
  }
  // The town: lots on a grid laid along the street.
  const LOT1 = 42;
  const LOT2 = 38;
  for (let i = -12; i <= 12; i++) {
    for (let j = -12; j <= 12; j++) {
      const k = i * 31 + j * 7 + 400;
      const cx = HI.x + e1[0] * i * LOT1 + e2[0] * j * LOT2 + (rnd(k, 1) - 0.5) * 6;
      const cz = HI.z + e1[1] * i * LOT1 + e2[1] * j * LOT2 + (rnd(k, 2) - 0.5) * 6;
      const r = Math.hypot(cx - HI.x, cz - HI.z);
      const b = bearingOf(cx - HI.x, cz - HI.z);
      const rim = rimB(b);
      const harbourSide = b > 40 && b < 240;
      if (r > rim - (harbourSide ? 58 : 30)) continue;
      if (distPath(cx, cz) < 48) continue;
      if (Math.hypot(cx - SQ.x, cz - SQ.z) < SQ.r + 24) continue;
      // The hall, its forecourt and the board.
      if (Math.hypot(cx - HO[0], cz - HO[1]) < 92) continue;
      if (Math.hypot(cx - bdx, cz - bdz) < 48) continue;
      const [fcx, , fcz] = hallF.P(0, 0, 70);
      if (Math.hypot(cx - fcx, cz - fcz) < 60) continue;
      if (whPlaced.some(([x, z]) => Math.hypot(cx - x, cz - z) < 44)) continue;
      if (berthNear(b, 9) && r > rim - 80) continue;
      if (stallAt.some(([x, z]) => Math.hypot(cx - x, cz - z) < 30)) continue;
      if (rnd(k, 3) < 0.1) {
        // A garden: a planted tree on grass.
        town.add(u.box, T(cx, Y + 0.4, cz, 26, 0.8, 26, yawTo(SB)), mixC(K.grass, K.grassB, rnd(k, 4)), 0.04);
        tree(town, cx, cz, 0.9 + 0.3 * rnd(k, 5), k);
        continue;
      }
      // Height: two floors round the square and in the a8 sight line behind the hall; up to three elsewhere.
      const bc = bearingOf(cx - camA8[0], cz - camA8[1]);
      const dc = Math.hypot(cx - camA8[0], cz - camA8[1]);
      const behindHall = angDiff(bc, hallBear) < 14 && dc > hallDist - 40;
      const nearSq = Math.hypot(cx - SQ.x, cz - SQ.z) < 150;
      const back = Math.max(0, -((cx - HI.x) * seeDir[0] + (cz - HI.z) * seeDir[1]) / HI.r);
      let floors = 2;
      if (!behindHall && !nearSq && rnd(k, 6) < 0.35 + back * 0.5) floors = 3;
      if (behindHall) floors = rnd(k, 6) < 0.5 ? 1 : 2;
      const w = 22 + rnd(k, 7) * 12;
      const d = 18 + rnd(k, 8) * 8;
      const turn = rnd(k, 9) < 0.3 ? Math.PI / 2 : 0;
      house(cx, cz, yawTo(SB) + turn + (rnd(k, 10) - 0.5) * 0.08, turn ? Math.min(w, LOT2 - 6) : Math.min(w, LOT1 - 6), turn ? Math.min(d, LOT1 - 8) : Math.min(d, LOT2 - 8), floors, k, "house");
    }
  }

  // Smoke from four chimneys the a8 stop frames beside the hall (life.ts caps a stop at 4).
  chimneys.sort((p, q) => rnd(Math.round(p[0] + p[2]), 3) - rnd(Math.round(q[0] + q[2]), 3));
  const smokers: V3[] = [];
  for (const c of chimneys) {
    if (smokers.length >= 4) break;
    if (smokers.some((s) => Math.hypot(s[0] - c[0], s[2] - c[2]) < 140)) continue;
    const bc = bearingOf(c[0] - camA8[0], c[2] - camA8[1]);
    if (angDiff(bc, hallBear) < 9 || angDiff(bc, hallBear) > 30) continue; // in the stop's frame, not straight up behind the hall
    smokers.push(c);
  }
  chimneys = [];
  for (const s of smokers) HARBOUR_SMOKE.push(s);

  // ── Trees in the square and yards; lamp posts; crates; a fountain ──
  function tree(b: Builder, x: number, z: number, s: number, seed: number) {
    b.add(u.cyl6, T(x, Y + 6 * s, z, 2.2 * s, 12 * s, 2.2 * s), K.bark, 0.05);
    const blobs = 3;
    for (let k = 0; k < blobs; k++) {
      const a = (k / blobs) * Math.PI * 2 + rnd(seed, k);
      const r = k === 0 ? 0 : 4.5 * s;
      const cy = Y + (15 + (k === 0 ? 5 : rnd(seed + k, 3) * 3)) * s;
      const sz = (k === 0 ? 17 : 12 + rnd(seed + k, 4) * 3) * s;
      b.add(u.ico0, T(x + Math.cos(a) * r, cy, z + Math.sin(a) * r, sz, sz * 0.9, sz, rnd(seed, k + 9) * 3), k === 0 ? K.leaf : rnd(seed + k, 5) < 0.5 ? K.leafLit : K.leafB, 0.1);
    }
  }
  const lampPost = (x: number, z: number, h = 22) => {
    town.add(u.box, T(x, Y + 1, z, 3, 2, 3), K.stoneDk, 0.03);
    town.add(u.box, T(x, Y + h / 2, z, 1.1, h, 1.1), K.iron, 0.02);
    glow.add(u.box, T(x, Y + h + 1.4, z, 2.6, 3.2, 2.6), GL.lamp, 0);
    town.add(u.cone4, T(x, Y + h + 4.1, z, 4, 2.4, 4, Math.PI / 4), K.iron, 0.02);
  };
  const crates = (x: number, z: number, ry: number, seed: number, mark?: RGB) => {
    const F = frame(x, Y, z, ry);
    town.add(u.box, F.L(0, 3.5, 0, 7, 7, 7), K.timber, 0.06, 0.2);
    town.add(u.box, F.L(7.6, 3.5, 0.6, 7, 7, 7, 0.1), mulC(K.timber, 1.12), 0.06, 0.2);
    town.add(u.box, F.L(3.6, 10.5, 0.2, 7, 7, 7, 0.25), mulC(K.timber, 0.95), 0.06, 0.2);
    // Stencils: a mark for the island they are bound for.
    const m = mark ?? pick(K.stripes, rnd(seed, 1));
    faceQuad(town, F, 0, 3.5, 3.5, 0, 1, 3.2, 2.2, m, 0.05);
    faceQuad(town, F, 7.6, 3.5, 4.1, 0, 1, 3.2, 2.2, pick(K.stripes, rnd(seed, 2)), 0.05);
    if (rnd(seed, 3) < 0.6) town.add(u.cyl8, F.L(-6, 4, 2, 5.5, 8, 5.5), K.greyBrown, 0.05, 0.2);
  };
  // Square: trees, a fountain, lamp posts, benches.
  const sqPts: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * 360 + 30;
    const [dx, dz] = dirOf(a);
    sqPts.push([SQ.x + dx * (SQ.r - 8), SQ.z + dz * (SQ.r - 8)]);
  }
  sqPts.forEach(([x, z]) => lampPost(x, z));
  tree(town, SQ.x + e2[0] * 64 - e1[0] * 40, SQ.z + e2[1] * 64 - e1[1] * 40, 1.3, 901);
  tree(town, SQ.x - e2[0] * 68 - e1[0] * 14, SQ.z - e2[1] * 68 - e1[1] * 14, 1.2, 902);
  {
    // Fountain, off the line from the stop to the hall's door.
    const fx = SQ.x + e2[0] * 38;
    const fz = SQ.z + e2[1] * 38;
    town.add(u.cyl8, T(fx, Y + 2, fz, 26, 4, 26), K.stone, 0.05);
    town.add(u.cyl8, T(fx, Y + 4.2, fz, 22, 0.6, 22), lin(0x5f7a88), 0.02);
    town.add(u.cyl8, T(fx, Y + 8, fz, 3.4, 12, 3.4), K.stone, 0.04);
    town.add(u.cyl8, T(fx, Y + 14, fz, 9, 1.4, 9), K.stoneDk, 0.04);
  }
  for (const [x, z, ry] of [[SQ.x - e2[0] * 44 - e1[0] * 20, SQ.z - e2[1] * 44 - e1[1] * 20, yawTo(SB)], [SQ.x + e2[0] * 20 - e1[0] * 50, SQ.z + e2[1] * 20 - e1[1] * 50, yawTo(SB + 90)]] as [number, number, number][]) {
    const F = frame(x, Y, z, ry);
    town.add(u.box, F.L(0, 3.4, 0, 14, 1, 4), K.timber, 0.03);
    for (const s of [-1, 1]) town.add(u.box, F.L(s * 6, 1.6, 0, 1, 3.2, 3.6), K.iron, 0.03);
  }
  // Quay: lamp posts and crates by the berths.
  for (let b = 48; b < 236; b += 22) {
    if (berthNear(b, 5)) continue;
    const [x, z] = at(b, rimB(b) - 8);
    lampPost(x, z, 20);
  }
  [[yoursB - 9, 30], [yoursB + 10, 34], [100 - 10, 28], [176 + 9, 30], [62 + 9, 26]].forEach(([b, back], i) => {
    const [x, z] = at(b, rimB(b) - back);
    crates(x, z, yawTo(b + 90) + rnd(i, 4) * 0.5, 700 + i);
  });

  // ── The Guild Hall (the landmark) ──
  {
    const F = hallF;
    const W = HALL.w;
    const D = HALL.d;
    const G0 = 21; // ground floor height
    const G1 = 19; // upper floor
    const EAVES = 4 + G0 + G1;
    const face = (lx: number, ly: number, lz: number, nx: number, nz: number, w: number, h: number, c: RGB, b: Builder = hall, out = 0.3) => faceQuad(b, F, lx, ly, lz, nx, nz, w, h, c, out);
    // Plinth and steps.
    hall.add(u.box, F.L(0, 2, 0, W + 10, 4, D + 10), K.stoneDk, 0.03);
    for (let k = 0; k < 3; k++) hall.add(u.box, F.L(0, 3.4 - k * 1.3, D / 2 + 6 + k * 3.2, 40, 1.3, 3.4), K.stone, 0.03);
    // Ground floor: cream stone. Upper floor: plaster with timber framing.
    hall.add(u.box, F.L(0, 4 + G0 / 2, 0, W, G0, D), K.stone, 0.03, 0.2);
    hall.add(u.box, F.L(0, 4 + G0 + 0.8, 0, W + 2, 1.6, D + 2), K.stoneDk, 0.03);
    hall.add(u.box, F.L(0, 4 + G0 + G1 / 2, 0, W - 1, G1, D - 1), K.cream, 0.03);
    for (let k = 0; k <= 8; k++) {
      const x = -W / 2 + 0.5 + (k * (W - 1)) / 8;
      for (const s of [-1, 1]) hall.add(u.box, F.L(x, 4 + G0 + G1 / 2, s * (D / 2 - 0.2), 1.6, G1, 1.2), K.timberDk, 0.03);
    }
    for (const s of [-1, 1]) {
      hall.add(u.box, F.L(0, EAVES - 0.8, s * (D / 2 - 0.2), W, 1.6, 1.4), K.timberDk, 0.03);
      for (let k = 0; k <= 5; k++) hall.add(u.box, F.L(s * (W / 2 - 0.2), 4 + G0 + G1 / 2, -D / 2 + 0.5 + (k * (D - 1)) / 5, 1.2, G1, 1.6), K.timberDk, 0.03);
    }
    // Upper windows, the front and the sides; tall arched windows below.
    for (let k = 0; k < 8; k++) {
      const x = -W / 2 + 0.5 + ((k + 0.5) * (W - 1)) / 8;
      if (Math.abs(x) < 14) continue;
      face(x, 4 + G0 + G1 * 0.52, D / 2 - 0.5, 0, 1, 5, 8, GL.window, hallGlow, 0.9);
      if (x < 18) face(x, 4 + G0 * 0.48, D / 2, 0, 1, 5.5, 11, GL.window, hallGlow, 0.35);
      face(x, 4 + G0 * 0.48 + 6.2, D / 2, 0, 1, 5.5, 1.4, K.stoneDk, hall, 0.4);
    }
    for (const s of [-1, 1]) for (const z of [-14, 0, 14]) {
      face(s * W / 2, 4 + G0 * 0.48, z, s, 0, 5.5, 11, GL.window, hallGlow, 0.35);
      face(s * (W / 2 - 0.5), 4 + G0 + G1 * 0.52, z, s, 0, 5, 8, GL.window, hallGlow, 0.9);
    }
    // The entrance bay: projects forward, rises through the eaves to its own gable.
    const BW = 30;
    const BD = 10;
    const BZ = D / 2 + BD / 2 - 1;
    hall.add(u.box, F.L(0, 4 + (EAVES + 6 - 4) / 2, BZ, BW, EAVES + 6 - 4, BD), K.stone, 0.03, 0.18);
    const z0 = D / 2 - 14;
    const z1 = BZ + BD / 2 + 0.4;
    hall.add(u.gable, F.L(0, EAVES + 6, (z0 + z1) / 2, z1 - z0, 16, BW + 3, Math.PI / 2), K.blue, 0.03);
    // Its gable face: a cream pediment just proud of the roof's end.
    hall.poly([F.P(-BW / 2 - 0.5, EAVES + 6, z1 + 0.25), F.P(BW / 2 + 0.5, EAVES + 6, z1 + 0.25), F.P(0, EAVES + 21.5, z1 + 0.25)], K.cream, F.N(0, 1));
    hall.add(u.box, F.L(0, EAVES + 5.4, z1 + 0.4, BW + 2, 1.6, 1.2), K.stoneDk, 0.02);
    // Clock (gold) in the pediment.
    hall.add(u.cyl8, F.L(0, EAVES + 12, z1 + 0.6, 8, 1, 8, 0, Math.PI / 2, 0), K.gold, 0.02);
    hall.add(u.box, F.L(0, EAVES + 13, z1 + 1.2, 0.8, 3.6, 0.4), K.iron, 0.02);
    // Quoins on the front corners of the ground floor and the entrance bay.
    for (let k = 0; k < 5; k++) {
      const y = 4 + 2.2 + k * 4.1;
      const wide = k % 2 ? 4.2 : 6.4;
      for (const s of [-1, 1]) {
        hall.add(u.box, F.L(s * (W / 2 - wide / 2 + 0.6), y, D / 2 + 0.3, wide, 3.6, 1.2), K.cream, 0.03);
        hall.add(u.box, F.L(s * (BW / 2 - wide / 2 + 0.6), y, BZ + BD / 2 + 0.3, wide, 3.6, 1.2), K.cream, 0.03);
      }
    }
    // A balcony and a tall lit window over the door.
    {
      const zb = BZ + BD / 2;
      hall.add(u.box, F.L(0, 4 + G0 + 2.2, zb + 2.2, 18, 1.4, 5), K.stoneDk, 0.03);
      hall.add(u.box, F.L(0, 4 + G0 + 5.4, zb + 4.4, 18, 0.8, 0.8), K.iron, 0.02);
      for (let k = 0; k < 7; k++) hall.add(u.box, F.L(-8.5 + k * (17 / 6), 4 + G0 + 4, zb + 4.4, 0.5, 3, 0.5), K.iron, 0.02);
      face(0, 4 + G0 + 9.5, zb, 0, 1, 7, 12, GL.window, hallGlow, 0.3);
      hall.poly([F.P(-3.5, 4 + G0 + 15.5, zb + 0.3), F.P(3.5, 4 + G0 + 15.5, zb + 0.3), F.P(0, 4 + G0 + 19, zb + 0.3)], mulC(GL.window, 0.35), F.N(0, 1));
    }
    // The door: a tall warm opening with an arch top, doors swung open.
    const DZ = BZ + BD / 2;
    face(0, 4 + 9.5, DZ, 0, 1, 12, 19, GL.door, hallGlow, 0.3);
    hall.poly([F.P(-6, 4 + 19, DZ + 0.3), F.P(6, 4 + 19, DZ + 0.3), F.P(4, 4 + 22.5, DZ + 0.3), F.P(-4, 4 + 22.5, DZ + 0.3)], mulC(GL.door, 0.3), F.N(0, 1));
    for (const s of [-1, 1]) {
      hall.add(u.box, F.L(s * 7.8, 4 + 11, DZ + 0.8, 1.8, 22, 1.8), K.stoneDk, 0.03);
      hall.add(u.box, F.L(s * 8.6, 4 + 9.5, DZ + 3.6, 1, 19, 6, s * 0.4), K.timber, 0.03);
      // Guild banners either side of the door.
      const bx = s * 23.8;
      const bz = D / 2 + 1.5;
      hall.add(u.box, F.L(bx, EAVES - 1, bz - 0.2, 7.5, 1, 1), K.iron, 0.02);
      hall.poly([F.P(bx - 3.2, EAVES - 1.5, bz), F.P(bx + 3.2, EAVES - 1.5, bz), F.P(bx + 3.2, EAVES - 22, bz), F.P(bx, EAVES - 25, bz), F.P(bx - 3.2, EAVES - 22, bz)], K.red, F.N(0, 1));
      hall.poly([F.P(bx - 2, EAVES - 6, bz + 0.1), F.P(bx + 2, EAVES - 6, bz + 0.1), F.P(bx, EAVES - 11, bz + 0.1)], K.gold, F.N(0, 1));
      // Lamps on brackets by the door.
      hall.beam(F.P(s * 10.5, 4 + 19, DZ), F.P(s * 10.5, 4 + 19, DZ + 3), 0.8, K.iron);
      hallGlow.add(u.box, F.L(s * 10.5, 4 + 17.4, DZ + 3, 2.4, 3.2, 2.4), GL.lamp, 0);
    }
    // The main roof: a big blue slate hip with dormers.
    const RH = 30;
    hall.add(u.hip, F.L(0, EAVES, 0, W + 6, RH, D + 6), K.blue, 0.04);
    hall.add(u.box, F.L(0, EAVES + RH, 0, (W + 6) * 0.44, 1.4, 1.4), K.blueDk, 0.02);
    for (const x of [-32, 32]) {
      const z = D / 2 - 7;
      const y = EAVES + 7;
      hall.add(u.box, F.L(x, y + 3.5, z, 9, 7, 8), K.cream, 0.03);
      hall.add(u.gable, F.L(x, y + 7, z, 8.4, 5, 10, Math.PI / 2), K.blueDk, 0.03);
      face(x, y + 3.5, z + 4, 0, 1, 4.2, 5, GL.window, hallGlow, 0.3);
    }
    // The belfry tower, rear right: the one tall shape over the town.
    {
      const tx = 30;
      const tz = -10;
      const TW = 22;
      const TOP = EAVES + RH;
      hall.add(u.box, F.L(tx, 4 + (TOP - 4) / 2, tz, TW, TOP - 4, TW), K.stone, 0.03, 0.2);
      hall.add(u.box, F.L(tx, TOP + 0.8, tz, TW + 2.4, 1.6, TW + 2.4), K.stoneDk, 0.03);
      // Open belfry: corner piers, a bell, a cornice.
      const BH = 16;
      for (const [a, c] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) hall.add(u.box, F.L(tx + a * (TW / 2 - 2), TOP + 1.6 + BH / 2, tz + c * (TW / 2 - 2), 4, BH, 4), K.cream, 0.03);
      hall.add(u.cone8, F.L(tx, TOP + 1.6 + BH * 0.55, tz, 8, 8, 8), K.brass, 0.04);
      hall.add(u.box, F.L(tx, TOP + 1.6 + BH + 1, tz, TW + 1.6, 2, TW + 1.6), K.stoneDk, 0.03);
      // Clock faces on the shaft.
      for (const [nx, nz] of [[0, 1], [1, 0]]) {
        hall.add(u.cyl8, F.L(tx + nx * (TW / 2 + 0.4), TOP - 9, tz + nz * (TW / 2 + 0.4), 10, 0.8, 10, 0, nz ? Math.PI / 2 : 0, nx ? Math.PI / 2 : 0), K.gold, 0.02);
      }
      // Spire, gold finial, the guild's flag (it flutters: in the sway mesh).
      const SY = TOP + 1.6 + BH + 2;
      hall.add(u.cone4, F.L(tx, SY + 12, tz, TW + 2, 24, TW + 2, Math.PI / 4), K.blue, 0.04);
      hall.add(u.ico0, F.L(tx, SY + 24.5, tz, 2.6, 2.6, 2.6), K.gold, 0.02);
      hall.beam(F.P(tx, SY + 24, tz), F.P(tx, SY + 33, tz), 0.6, K.iron);
      const fl = [F.P(tx, SY + 32.5, tz), F.P(tx, SY + 27, tz)];
      const tip = F.P(tx - 11, SY + 30.5, tz + 3);
      const mid0: V3 = [(fl[0][0] + tip[0]) / 2, (fl[0][1] + tip[1]) / 2, (fl[0][2] + tip[2]) / 2];
      const mid1: V3 = [(fl[1][0] + tip[0]) / 2, (fl[1][1] + tip[1]) / 2, (fl[1][2] + tip[2]) / 2];
      // Two segments: pole edge still, middle flutters a little, tip more.
      const flagTri = (a: V3, fa: number, b: V3, fb: number, c: V3, fc: number) => {
        hallFlag.cur = [3.3, 0, fa, 0];
        hallFlag.pos.push(...a);
        hallFlag.col.push(...K.red);
        hallFlag.sway!.push(...hallFlag.cur);
        hallFlag.cur = [3.3, 0, fb, 0];
        hallFlag.pos.push(...b);
        hallFlag.col.push(...K.red);
        hallFlag.sway!.push(...hallFlag.cur);
        hallFlag.cur = [3.3, 0, fc, 0];
        hallFlag.pos.push(...c);
        hallFlag.col.push(...K.red);
        hallFlag.sway!.push(...hallFlag.cur);
      };
      flagTri(fl[0], 0, fl[1], 0, mid1, 0.8);
      flagTri(fl[0], 0, mid1, 0.8, mid0, 0.8);
      flagTri(mid0, 0.8, mid1, 0.8, tip, 1.6);
    }
    // THE NOTICE BOARD, beside the entrance (screen right from the stop):
    // roofed, on posts, covered in job notices in rows (each sheet >= 7 wide).
    {
      const bx = boardLocal.x;
      const bz = boardLocal.z;
      const Bw = 56;
      const Bh = 30;
      const B0 = 7;
      const byaw = -0.32; // turned a little toward the square
      const BF = frame(...(hallF.P(bx, 0, bz) as V3), yawTo(51) + byaw);
      for (const s of [-1, 1]) {
        hall.add(u.box, BF.L(s * (Bw / 2 + 1.6), (B0 + Bh + 8) / 2, 0, 2.6, B0 + Bh + 8, 2.6), K.timberDk, 0.03);
        hall.add(u.box, BF.L(s * (Bw / 2 + 1.6), 1, 0, 5, 2, 5), K.stoneDk, 0.03);
      }
      hall.add(u.box, BF.L(0, B0 + Bh / 2, -0.6, Bw + 2, Bh + 2, 1.6), K.timber, 0.03);
      hall.add(u.box, BF.L(0, B0 - 0.8, 0.4, Bw + 4, 1.6, 3), K.timberDk, 0.03);
      hall.add(u.gable, BF.L(0, B0 + Bh + 3, -0.6, Bw + 10, 6.5, 9), K.blue, 0.03);
      // The gold header plaque.
      faceQuad(hall, BF, 0, B0 + Bh + 1.6, 0.4, 0, 1, 26, 3.4, K.gold, 0.3);
      // Sheets in rows, pinned slightly askew; some with a coloured header.
      const cols = 7;
      const rows = 3;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const seed = r * 11 + c;
          const w = 6.2 + rnd(seed, 1) * 1.8;
          const h = 7.5 + rnd(seed, 2) * 1.6;
          const x = -Bw / 2 + ((c + 0.5) * Bw) / cols + (rnd(seed, 3) - 0.5) * 1.2;
          const y = B0 + 1.4 + ((r + 0.5) * (Bh - 2)) / rows + (rnd(seed, 4) - 0.5) * 1.2;
          const tilt = (rnd(seed, 5) - 0.5) * 0.16;
          const S = mul(BF.M, T(x, y, 0.35 + rnd(seed, 6) * 0.1, 1, 1, 1, 0, 0, tilt));
          const P = (lx: number, ly: number): V3 => {
            _v.set(lx, ly, 0).applyMatrix4(S);
            return [_v.x, _v.y, _v.z];
          };
          hall.poly([P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, h / 2), P(-w / 2, h / 2)], pick(K.paper, rnd(seed, 7)), BF.N(0, 1));
          if (rnd(seed, 8) < 0.45) hall.poly([P(-w / 2 + 0.6, h / 2 - 2.2), P(w / 2 - 0.6, h / 2 - 2.2), P(w / 2 - 0.6, h / 2 - 0.8), P(-w / 2 + 0.6, h / 2 - 0.8)], pick([K.red, K.gold, K.blue], rnd(seed, 9)), BF.N(0, 1));
          // Text lines, faint.
          for (let l = 0; l < 3; l++) hall.poly([P(-w / 2 + 1, -h / 2 + 1.4 + l * 1.5), P(w / 2 - 1 - rnd(seed + l, 10) * 2, -h / 2 + 1.4 + l * 1.5), P(w / 2 - 1 - rnd(seed + l, 10) * 2, -h / 2 + 2 + l * 1.5), P(-w / 2 + 1, -h / 2 + 2 + l * 1.5)], mulC(K.greyBrown, 1.1), BF.N(0, 1));
        }
      }
      // The story pair: a ladder against the board, one sheet going up at an angle.
      const lx = Bw / 2 - 8;
      for (const s of [-1, 1]) hall.beam(BF.P(lx + s * 2.6, 0, 9), BF.P(lx + s * 2.6, B0 + Bh - 2, 1.4), 0.7, K.timber);
      for (let k = 1; k < 7; k++) {
        const t = k / 7;
        hall.beam(BF.P(lx - 2.6, t * (B0 + Bh - 2), 9 - t * 7.6), BF.P(lx + 2.6, t * (B0 + Bh - 2), 9 - t * 7.6), 0.5, K.timber);
      }
      {
        const S = mul(BF.M, T(lx - 7, B0 + Bh - 4, 1.8, 1, 1, 1, 0.25, 0, 0.35));
        const P = (a: number, b2: number): V3 => {
          _v.set(a, b2, 0).applyMatrix4(S);
          return [_v.x, _v.y, _v.z];
        };
        hall.poly([P(-3.6, -4.4), P(3.6, -4.4), P(3.6, 4.4), P(-3.6, 4.4)], K.paper[2], BF.N(0, 1));
        hall.poly([P(-3.6, -4.4), P(3.6, -4.4), P(3.6, 4.4), P(-3.6, 4.4)], K.paper[1], BF.N(0, -1));
      }
      // A paste bucket and a crate of fresh notices at the foot.
      hall.add(u.cyl8, BF.L(-Bw / 2 + 6, 2.4, 6, 4, 4.8, 4), K.greyBrown, 0.04);
      hall.add(u.box, BF.L(-Bw / 2 + 13, 3, 7, 7, 6, 6, 0.3), K.timber, 0.04, 0.2);
      hall.add(u.box, BF.L(-Bw / 2 + 13, 6.2, 7, 5.6, 0.6, 4.6, 0.3), K.paper[0], 0.02);
      // Two lamps on the board's posts.
      for (const s of [-1, 1]) {
        hall.beam(BF.P(s * (Bw / 2 + 1.6), B0 + Bh + 6, 0), BF.P(s * (Bw / 2 + 1.6), B0 + Bh + 6, 3.4), 0.6, K.iron);
        hallGlow.add(u.box, BF.L(s * (Bw / 2 + 1.6), B0 + Bh + 4.4, 3.4, 2.2, 3, 2.2), GL.lamp, 0);
      }
    }
    // Crates for other islands beside the hall's steps (the second story pair).
    const [cx1, , cz1] = F.P(-36, 0, D / 2 + 14);
    crates(cx1, cz1, yawTo(51) + 0.2, 811, K.blue);
  }

  // ── Bunting across the square and the top of the street (the accent, moving) ──
  const bunt = (a: V3, b: V3, sag: number, seed: number) => {
    const n = Math.max(6, Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / 8.5));
    const pt = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
    for (let k = 0; k < n; k++) {
      const p0 = pt(k / n);
      const p1 = pt((k + 1) / n);
      anim.cur = [seed + k * 0.4, 0, 0, 0];
      anim.beam(p0, p1, 0.35, K.rope, 0);
      const c = [K.canvas, K.gold, K.blue][(k + Math.floor(seed)) % 3]; // red stays on the hall (the accent gate)
      const m0 = pt((k + 0.2) / n);
      const m1 = pt((k + 0.8) / n);
      const tip: V3 = [(m0[0] + m1[0]) / 2, (m0[1] + m1[1]) / 2 - 4.2, (m0[2] + m1[2]) / 2];
      const ph = seed + k * 0.7;
      const push = (p: V3, f: number) => {
        anim.pos.push(...p);
        anim.col.push(...c);
        anim.sway!.push(ph, 0, f, 0);
      };
      push(m0, 0.1);
      push(m1, 0.1);
      push(tip, 1.0);
    }
  };
  {
    const H = 26;
    // Between the square's lamp posts, crossing the square.
    const P6 = sqPts.map(([x, z]) => [x, Y + H, z] as V3);
    bunt(P6[1], P6[4], 5, 2);
    bunt(P6[2], P6[5], 5, 3);
    // Across the top of the street, stall to stall.
    const [ax, az] = HP[1];
    const [bx, bz] = HP[2];
    for (const t of [0.35, 0.8]) {
      const cx = ax + (bx - ax) * t;
      const cz = az + (bz - az) * t;
      const [nx, nz] = e2;
      bunt([cx - nx * 22, Y + 22, cz - nz * 22], [cx + nx * 22, Y + 22, cz + nz * 22], 3, 4 + t * 10);
    }
  }
  // Masts for the street bunting (poles on the stall line).
  {
    const [ax, az] = HP[1];
    const [bx, bz] = HP[2];
    for (const t of [0.35, 0.8]) {
      const cx = ax + (bx - ax) * t;
      const cz = az + (bz - az) * t;
      for (const s of [-1, 1]) town.add(u.box, T(cx + s * e2[0] * 22, Y + 12, cz + s * e2[1] * 22, 1, 24, 1), K.timberDk, 0.03);
    }
  }

  // ── Meshes and materials ──
  const group = new THREE.Group();
  group.name = "Harbour";
  const tU = { value: 0 };
  const solid = track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  solid.name = "HarbourSolid";
  const glowMat = track(new THREE.MeshBasicMaterial({ vertexColors: true }));
  glowMat.name = "HarbourGlow";
  glowMat.userData.lightGlow = "lamp";
  const swayHook = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uHarbourT = tU;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\n" + SWAY_VERT_PARS).replace("#include <begin_vertex>", SWAY_VERT);
  };
  const swayMat = track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  swayMat.name = "HarbourSway";
  swayMat.onBeforeCompile = swayHook;
  swayMat.customProgramCacheKey = () => "harbour-sway";
  const swayGlowMat = track(new THREE.MeshBasicMaterial({ vertexColors: true }));
  swayGlowMat.name = "HarbourSwayGlow";
  swayGlowMat.userData.lightGlow = "lamp";
  swayGlowMat.onBeforeCompile = swayHook;
  swayGlowMat.customProgramCacheKey = () => "harbour-sway-glow";
  const meshes: THREE.Mesh[] = [];
  const addMesh = (parent: THREE.Object3D, b: Builder, m: THREE.Material, name: string, pad = 0) => {
    if (b.tris === 0) return null;
    const g = track(b.build());
    if (pad && g.boundingSphere) g.boundingSphere.radius += pad;
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  addMesh(group, town, solid, "Harbour_Town");
  addMesh(group, glow, glowMat, "Harbour_Lamps");
  addMesh(group, anim, swayMat, "Harbour_Sway", 8);
  addMesh(group, animGlow, swayGlowMat, "Harbour_SwayLamps", 8);
  HARBOUR_SMOKE.forEach((p, k) => {
    const o = new THREE.Object3D();
    o.name = `Harbour_Chimney_${k}`;
    o.position.set(p[0], p[1], p[2]);
    o.userData.smoke = "chimney";
    group.add(o);
  });
  (ctx.root ?? scene).add(group);

  // The landmark: inside LM_GuildHall (group at A8.pos), geometry moved to its local frame.
  let lmGroup = scene.getObjectByName(A8.mesh);
  if (!lmGroup) {
    lmGroup = new THREE.Group();
    lmGroup.name = A8.mesh;
    lmGroup.position.set(A8.pos.x, A8.pos.y, A8.pos.z);
    (ctx.root ?? scene).add(lmGroup);
  }
  lmGroup.updateMatrixWorld(true);
  const hallMeshes: THREE.Mesh[] = [];
  const toLocal = new THREE.Matrix4().copy(lmGroup.matrixWorld).invert();
  for (const [b, m, name] of [[hall, solid, "GuildHall"], [hallGlow, glowMat, "GuildHall_Glow"], [hallFlag, swayMat, "GuildHall_Flag"]] as [Builder, THREE.Material, string][]) {
    if (!b.tris) continue;
    const g = track(b.build());
    g.applyMatrix4(toLocal);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    lmGroup.add(mesh);
    meshes.push(mesh);
    hallMeshes.push(mesh);
  }

  const tris = Math.round(town.tris + glow.tris + anim.tris + animGlow.tris + hall.tris + hallGlow.tris + hallFlag.tris);
  const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
  U = null;

  // ── Frame loop ──
  const camPos = new THREE.Vector3();
  let visible = true;
  let animating = false;
  return {
    name: "dress-harbour",
    update(time: number) {
      ctx.camera.getWorldPosition(camPos);
      const show = camPos.z < -2100;
      let changed = false;
      if (show !== visible) {
        group.visible = show;
        for (const m of hallMeshes) m.visible = show;
        visible = show;
        changed = true;
      }
      const near = show && Math.hypot(camPos.x - HI.x, camPos.z - HI.z) < 2600;
      animating = near && !ctx.reducedMotion;
      if (animating) {
        tU.value = time;
        changed = true;
      }
      return changed;
    },
    isAnimating: () => animating,
    dispose() {
      for (const m of meshes) m.parent?.remove(m);
      group.parent?.remove(group);
      for (const d of disposables) d.dispose();
      for (const name of replaced) {
        const o = scene.getObjectByName(name);
        if (o) o.visible = true;
      }
    },
    stats: () => ({
      triangles: tris,
      town: Math.round(town.tris),
      hall: Math.round(hall.tris + hallGlow.tris),
      ships: HARBOUR_BERTHS.length,
      sway: Math.round(anim.tris + animGlow.tris),
      houses: houseN,
      smokers: HARBOUR_SMOKE.length,
      ms: Math.round(ms),
      replaced: replaced.join(","),
    }),
  };
};
