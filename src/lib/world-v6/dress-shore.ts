import * as THREE from "three";
import { addFootprint, addPathLine } from "./footprints";
import { PATH, PLACES } from "./layout";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { groundY, rnd } from "./rocks";

/**
 * v6 dressing module: dress-shore (world_art_bible_v6.md 1.1 to 1.4, 2.8;
 * the v5 bible's timber family and prop scale still hold, 3.5 and 4.5).
 *
 * Lovro on v5's Landing: "a lot of random things", "lacks personality"; on
 * Base Camp: the outpost "in the middle of the road", "grass inside the
 * tents". v6 keeps fewer, larger props, each answering "who left this, and
 * why?", nothing on a path, and registers every footprint (footprints.ts) so
 * the ground shades under it and no cover grows through it.
 *
 * Every material is stock Lambert or Basic with fog on (light.ts hooks the
 * ramp and the grade in), except the halos (their own program).
 *
 * REPLACES (blocks.ts's grey stand-ins, hidden at install, restored on dispose):
 *   Landmark_a1, Set_a1_Block, Landmark_a2, Set_a2_Block
 * RE-SKINS (blocks.ts keeps driving them, only their geometry is swapped):
 *   LandingBoat_Block  your sailboat moored at the dock: blocks rocks it
 *   CampfireFlame      the a1 fire: burns from progress 0 (log decision 51),
 *                      blocks flickers it; moved onto the new fire ring
 *   LookoutLamp        the lookout's lit cabin (progress >= 2)
 *
 * ADDS, under "V5Shore" (its visibility follows blocks' Zone_south):
 *   Shore:a1        the Landing's story. You came by the sailboat (moored at
 *                   the dock); someone landed just before you in a skiff,
 *                   pulled up on the sand with its oars shipped, and their
 *                   camp is still warm: the fire ring with two log seats, a
 *                   kettle on a tripod, two packs leaning on a log. The dock
 *                   with a bell post at its head (ring for the boat), a rope
 *                   coil, two gulls on its end posts; a driftwood log on the
 *                   tide line; one lantern post at the dock's foot.
 *   Shore:a2        Base Camp. The keeper's cabin on the knoll beside the
 *                   lookout (porch, stone chimney, a lit window), a woodpile
 *                   with an axe in the stump; at the knoll's west foot by the
 *                   woods, 3 tents in a loose row round a fire ring, a
 *                   lantern and a washing line.
 *   Shore:glow      lantern glass and lit windows (lamp glow, light.ts levels it).
 *   Shore:signLamp  the signpost's lantern under its first arm: lit once
 *                   Introduction is done (setProgress >= 1).
 *   Shore:halos     additive halos on the lanterns (one Points call, <= 64 CSS px).
 *   Shore:wash      the washing line's three cloths (moving).
 * and inside the landmark groups (so markers and the park frame them):
 *   Shore:signpost  (LM_Signpost) stone cairn foot, tapered post, rope bands,
 *                   eight arms, each a different muted colour (one per course
 *                   area), lettering strokes, a shingle cap, the teal pennant.
 *   Shore:lookout   (LM_Lookout) splayed legs, girts and X braces, stairs,
 *                   deck, cabin with a window band, the red hip roof.
 *   Shore:flag      (LM_Lookout) the red flag, moving.
 *
 * SMOKE CONTRACT for life.ts: empty Object3Ds "SmokeSource:a1-campfire"
 * (userData.smoke = "column") just over the flame and "SmokeSource:a2-chimney"
 * (userData.smoke = "chimney") on the cabin's chimney top; userData.smokeSpec
 * { place, rate, rise, width, lit }. The same list is exported as SHORE_SMOKE.
 *
 * Draw calls: at a1 about 5 (signpost, a1 set, glow, halos, boat), at a2
 * about 6 (+ lookout, flag, wash). stats() reports triangles.
 *
 * The thread (bible 2.8, decision 30: old posts with one sagging wire along
 * the trail from the Landing to the stream) was taken out on 2026-10-15
 * (Lovro's Loom: "it doesn't make sense for these to be in like a random
 * forest").
 */

// ── Palette (bible 1.8), display sRGB hex, converted to linear once ──────────

type RGB = readonly [number, number, number];
type V3 = readonly [number, number, number];
const lin = (hex: number): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const P = {
  brown: lin(0x6b4e3a),
  greyBrown: lin(0x7d6b5a),
  weathered: lin(0x5c4c40),
  dark: lin(0x3e3129),
  cream: lin(0xe3d6ba),
  board: lin(0xe9dcc0),
  canvas: lin(0xd8ccb0),
  canvasOchre: lin(0xc8b48a),
  canvasSage: lin(0xa9ad94),
  rope: lin(0xb8a07a),
  net: lin(0x8a7a62),
  iron: lin(0x2f2d2c),
  stone: lin(0x8c8883),
  stoneDark: lin(0x625e59),
  shingle: lin(0x4f4540),
  glass: lin(0x1c1e22),
  sack: lin(0xa89878),
  ash: lin(0x2a2624),
  concrete: lin(0x9a968e),
  /** a1 accent: the pennant on the signpost and your boat's hull (colour script 1.2). */
  teal: lin(0x2f6a66),
  hullDark: lin(0x34302c),
  /** a2 accent: the lookout's roof and its flag. */
  red: lin(0xa8392c),
  cloth1: lin(0xd9d2c2),
  cloth2: lin(0x8f9a9e),
  cloth3: lin(0xb9a27c),
  /** Pass 3: the dark spruce behind the signpost (bible 1.7 near band). */
  spruce: lin(0x24302a),
  /** Pass 3: tent canvas, warmer than the plain canvas so the tents read as cloth. */
  tentCream: lin(0xeadbb4),
  tentOchre: lin(0xd8ac66),
  tentOlive: lin(0xabae80),
  /** v6: the signpost's eight arms, one muted colour per course area (a1 .. a8). */
  arms: [0xe6d9bc, 0x9fb08f, 0xc9ae78, 0x8497ad, 0xb38f7c, 0xa3a27a, 0x86a39e, 0xa598a2].map((h) => {
    const c = lin(h);
    // Muted (a third toward their own grey), then lifted: the boards are
    // small and must stay the lightest thing on the post.
    const m = (c[0] + c[1] + c[2]) / 3;
    return [(c[0] * 0.67 + m * 0.33) * 1.18, (c[1] * 0.67 + m * 0.33) * 1.18, (c[2] * 0.67 + m * 0.33) * 1.18] as RGB;
  }),
  bedroll: lin(0x7d8a8a),
  gull: lin(0xf0ece2),
  gullBack: lin(0x9aa0a6),
  beak: lin(0xd8a040),
  /** The skiff someone else rowed in: a faded blue green, never the a2 red. */
  skiff: lin(0x5f7f7a),
  drift: lin(0xb8b0a2),
  driftDark: lin(0x8a8276),
  bell: lin(0x8a6a3a),
  kettle: lin(0x3c3a38),
};
/** Unlit glow colours, above 1 so they read as light after tone mapping (blocks.ts G). */
const GL = {
  fire: [2.6, 0.95, 0.25] as RGB,
  lamp: [2.4, 1.35, 0.5] as RGB,
  core: [2.7, 2.0, 1.1] as RGB,
  window: [2.0, 1.4, 0.7] as RGB,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
/** Horizontal unit vector for a compass bearing (0 = -z, 90 = +x). */
const dirOf = (b: number): [number, number] => [Math.sin(b * DEG), -Math.cos(b * DEG)];
/** Yaw that turns local +x toward a compass bearing. */
const yawTo = (b: number) => (90 - b) * DEG;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Transform: position, scale, then yaw / pitch / roll (Y, X, Z order). */
function T(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** Unit primitives (non-indexed, positions only), made per install. */
interface Units {
  box: THREE.BufferGeometry;
  cyl6: THREE.BufferGeometry;
  cyl8: THREE.BufferGeometry;
  taper8: THREE.BufferGeometry;
  cone4: THREE.BufferGeometry;
  cone6: THREE.BufferGeometry;
  dode: THREE.BufferGeometry;
  ico: THREE.BufferGeometry;
  torus: THREE.BufferGeometry;
}
function makeUnits(): Units {
  const ni = (g: THREE.BufferGeometry) => {
    const o = g.index ? g.toNonIndexed() : g;
    if (o !== g) g.dispose();
    o.deleteAttribute("uv");
    o.deleteAttribute("normal");
    return o;
  };
  return {
    box: ni(new THREE.BoxGeometry(1, 1, 1)),
    cyl6: ni(new THREE.CylinderGeometry(1, 1, 1, 6)),
    cyl8: ni(new THREE.CylinderGeometry(1, 1, 1, 8)),
    taper8: ni(new THREE.CylinderGeometry(0.8, 1, 1, 8)),
    cone4: ni(new THREE.ConeGeometry(1, 1, 4)),
    cone6: ni(new THREE.ConeGeometry(1, 1, 6)),
    dode: ni(new THREE.DodecahedronGeometry(1, 0)),
    ico: ni(new THREE.IcosahedronGeometry(1, 0)),
    torus: ni(new THREE.TorusGeometry(1, 0.34, 3, 9)),
  };
}

/**
 * Collects faceted, vertex coloured triangles into one non-indexed geometry.
 * Points go in as WORLD coordinates and come out local to `origin`. `ao`
 * darkens what sits near the ground it names (a baked contact shade, bible 1.8
 * "AO bake"), `vary` jitters each part's value a little so a set is not flat.
 */
class Kit {
  private p: number[] = [];
  private c: number[] = [];
  private n = 0;
  constructor(
    private readonly U: Units,
    private readonly o: { x: number; y: number; z: number },
  ) {}
  get tris(): number {
    return this.p.length / 9;
  }
  private push(x: number, y: number, z: number, col: RGB, k: number, ao: number | null, aoH: number): void {
    this.p.push(x - this.o.x, y - this.o.y, z - this.o.z);
    const a = ao === null ? 1 : 0.62 + 0.38 * clamp01((y - ao) / aoH);
    this.c.push(col[0] * k * a, col[1] * k * a, col[2] * k * a);
  }
  add(geo: keyof Units | THREE.BufferGeometry, m: THREE.Matrix4, col: RGB, ao: number | null = null, vary = 0.08, aoH = 4): void {
    const g = typeof geo === "string" ? this.U[geo] : geo;
    const a = g.getAttribute("position");
    const k = 1 - vary / 2 + vary * rnd(this.n++, 3.7);
    for (let i = 0; i < a.count; i++) {
      _a.fromBufferAttribute(a, i).applyMatrix4(m);
      this.push(_a.x, _a.y, _a.z, col, k, ao, aoH);
    }
  }
  /** One world triangle, counter-clockwise seen from its front. */
  tri(a: V3, b: V3, c: V3, col: RGB, ao: number | null = null, aoH = 4): void {
    this.push(a[0], a[1], a[2], col, 1, ao, aoH);
    this.push(b[0], b[1], b[2], col, 1, ao, aoH);
    this.push(c[0], c[1], c[2], col, 1, ao, aoH);
  }
  /** A triangle turned so its normal points along `dir`. */
  triToward(a: V3, b: V3, c: V3, dir: V3, col: RGB, ao: number | null = null): void {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_a, _b);
    if (_n.x * dir[0] + _n.y * dir[1] + _n.z * dir[2] >= 0) this.tri(a, b, c, col, ao);
    else this.tri(a, c, b, col, ao);
  }
  quadToward(a: V3, b: V3, c: V3, d: V3, dir: V3, col: RGB, ao: number | null = null): void {
    this.triToward(a, b, c, dir, col, ao);
    this.triToward(a, c, d, dir, col, ao);
  }
  /** Both faces of a thin sheet (cloth, sail, net, pennant). */
  sheet(a: V3, b: V3, c: V3, col: RGB): void {
    this.tri(a, b, c, col);
    this.tri(a, c, b, col);
  }
  /** A box or cylinder of section w x d from world point a to b. */
  beam(a: V3, b: V3, w: number, d: number, col: RGB, geo: keyof Units = "box", ao: number | null = null): void {
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    const len = _a.distanceTo(_b);
    if (len < 1e-6) return;
    _c.addVectors(_a, _b).multiplyScalar(0.5);
    _q.setFromUnitVectors(UP, _b.sub(_a).divideScalar(len));
    this.add(geo, _m.compose(_c, _q, _s.set(w, len, d)), col, ao);
  }
  /**
   * A convex polygon (local x, y) extruded `t` thick along local z, placed by
   * `m` (a copy is taken). Front and back take `face`, the rim `rim`.
   */
  slab(pts: ReadonlyArray<readonly [number, number]>, t: number, m: THREE.Matrix4, face: RGB, rim: RGB = face): void {
    const M = m.clone();
    const n = pts.length;
    const P3 = (i: number, z: number): V3 => {
      _a.set(pts[i][0], pts[i][1], z).applyMatrix4(M);
      return [_a.x, _a.y, _a.z];
    };
    const f = pts.map((_, i) => P3(i, t / 2));
    const bk = pts.map((_, i) => P3(i, -t / 2));
    for (let i = 1; i < n - 1; i++) {
      this.tri(f[0], f[i], f[i + 1], face);
      this.tri(bk[0], bk[i + 1], bk[i], face);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.tri(f[i], bk[i], bk[j], rim);
      this.tri(f[i], bk[j], f[j], rim);
    }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Ground under (x, z): the drawn terrain, never below the sea. */
const G = (x: number, z: number) => Math.max(0, groundY(x, z));

// ── Props (v5 bible 4.5, v6 2.8) ────────────────────────────────────────────

/** P9: a barrel with two iron hoops. */
function barrel(k: Kit, x: number, y: number, z: number, r: number, h: number, g: number): void {
  k.add("cyl8", T(x, y + h / 2, z, r, h, r, rnd(x, z)), P.brown, g);
  for (const f of [0.22, 0.78]) k.add("cyl8", T(x, y + h * f, z, r * 1.06, h * 0.08, r * 1.06), P.iron, null, 0.02);
}
/** P11: a lantern post with the lantern hung from an arm; returns the glass centre. */
function lanternPost(k: Kit, glow: Kit, x: number, z: number, h: number, bearing: number): V3 {
  const g = G(x, z);
  const [dx, dz] = dirOf(bearing);
  k.add("box", T(x, g + h / 2, z, 1.1, h, 1.1), P.weathered, g);
  k.beam([x, g + h - 0.6, z], [x + dx * 4.2, g + h - 0.6, z + dz * 4.2], 0.6, 0.6, P.dark);
  const lx = x + dx * 3.8;
  const lz = z + dz * 3.8;
  const ly = g + h - 3.6;
  k.add("box", T(lx, ly + 1.9, lz, 2.4, 0.4, 2.4), P.iron);
  k.add("cone4", T(lx, ly + 2.6, lz, 1.9, 1.2, 1.9, 45 * DEG), P.iron);
  k.add("box", T(lx, ly - 1.35, lz, 2.2, 0.35, 2.2), P.iron);
  glow.add("box", T(lx, ly + 0.25, lz, 1.9, 2.9, 1.9), GL.lamp, null, 0);
  return [lx, ly + 0.25, lz];
}
/** P19: the fire ring (stones, charred logs, ash); returns the centre. */
function fireRing(k: Kit, x: number, z: number, r: number, logs: boolean): V3 {
  const g = G(x, z);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(x, i) * 0.3;
    k.add("dode", T(x + Math.cos(a) * r, g + 0.5, z + Math.sin(a) * r, 1.35, 1.0, 1.25, a), i % 3 ? P.stone : P.stoneDark, g - 1, 0.12, 2);
  }
  k.add("cyl8", T(x, g + 0.15, z, r * 0.85, 0.3, r * 0.85), P.ash);
  if (logs) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      k.beam([x + Math.cos(a) * r * 0.75, g + 0.3, z + Math.sin(a) * r * 0.75], [x + Math.cos(a) * 0.4, g + 4.8, z + Math.sin(a) * 0.4], 0.9, 0.9, P.dark, "cyl6");
    }
  }
  return [x, g, z];
}
/** A log seat (6 sided log lying on the ground). */
function logSeat(k: Kit, x: number, z: number, len: number, bearing: number): void {
  const g = G(x, z);
  k.add("cyl6", T(x, g + 1.3, z, 1.4, len, 1.4, yawTo(bearing), 0, Math.PI / 2), P.brown, g - 0.5, 0.1, 3);
  const [dx, dz] = dirOf(bearing);
  for (const s of [-1, 1]) k.add("cyl6", T(x + dx * s * len * 0.5, g + 1.3, z + dz * s * len * 0.5, 1.3, 0.3, 1.3, yawTo(bearing), 0, Math.PI / 2), P.cream, null, 0.04);
}
/**
 * A pack leaning back against something at `bearing` (the way its front
 * faces): the body, a rounded lid, a rolled bedroll on top, two straps.
 */
function pack(k: Kit, x: number, z: number, bearing: number, col: RGB, lean = 0.28): void {
  const g = G(x, z);
  const yaw = yawTo(bearing + 90);
  k.add("box", T(x, g + 2.4, z, 3.2, 4.8, 2.2, yaw, -lean), col, g, 0.06);
  k.add("dode", T(x, g + 4.9, z + 0, 1.7, 0.9, 1.25, yaw, -lean), col, null, 0.06);
  const [bx, bz] = dirOf(bearing + 180);
  k.add("cyl6", T(x + bx * 0.9, g + 5.9, z + bz * 0.9, 1.0, 4.0, 1.0, yaw, -lean, Math.PI / 2), P.bedroll, null, 0.05);
  const [fx, fz] = dirOf(bearing);
  for (const s of [-0.8, 0.8]) {
    const [sx, sz] = dirOf(bearing + 90);
    k.add("box", T(x + fx * 1.15 + sx * s, g + 2.6, z + fz * 1.15 + sz * s, 0.4, 4.2, 0.25, yaw, -lean), P.dark, null, 0.02);
  }
}
/** A gull standing on a post top at (x, y, z), facing `bearing`: pale body, grey back, dark tail. */
function perchedGull(k: Kit, x: number, y: number, z: number, bearing: number): void {
  const yaw = yawTo(bearing);
  k.add("dode", T(x, y + 1.0, z, 1.35, 0.85, 0.75, yaw), P.gull, null, 0.02);
  k.add("dode", T(x + 0, y + 1.95, z, 0.55, 0.55, 0.5, yaw), P.gull, null, 0.02);
  const [fx, fz] = dirOf(bearing);
  k.add("box", T(x - fx * 0.2, y + 1.35, z - fz * 0.2, 1.9, 0.35, 1.05, yaw, 0, -0.12), P.gullBack, null, 0.02);
  k.add("cone4", T(x + fx * 0.75, y + 1.95, z + fz * 0.75, 0.16, 0.6, 0.16, yaw, 0, -Math.PI / 2), P.beak, null, 0);
  k.add("box", T(x - fx * 1.35, y + 1.2, z - fz * 1.35, 0.8, 0.25, 0.6, yaw, 0, 0.2), P.dark, null, 0);
}

/**
 * P3 / P4: a lofted hull, local +x forward, waterline y = 0, into `k` through
 * the local-to-world matrix `m`. Bands, top down: the gunwale cap, the upper
 * strake, the topsides, the bottom.
 */
function hull(
  k: Kit,
  m: THREE.Matrix4,
  o: { len: number; beam: number; gun: number; keel: number; cap: RGB; strake: RGB; side: RGB; bottom: RGB; deck: RGB },
): void {
  const M = m.clone();
  const ts = [0, 0.12, 0.3, 0.5, 0.7, 0.86, 1];
  const hb = [0.74, 0.92, 1, 1, 0.88, 0.56, 0.03];
  const sh = [1.1, 1.02, 0.96, 0.94, 0.98, 1.08, 1.28];
  const kd = [0.5, 0.85, 1, 1, 0.9, 0.62, 0.12];
  const W = (v: readonly [number, number, number]): V3 => {
    _a.set(v[0], v[1], v[2]).applyMatrix4(M);
    return [_a.x, _a.y, _a.z];
  };
  // Per station, one side's profile (z >= 0), gunwale to keel.
  const prof = ts.map((t, i) => {
    const x = (t - 0.5) * o.len;
    const b = (o.beam / 2) * hb[i];
    const gy = o.gun * sh[i];
    const d = o.keel * kd[i];
    return [
      [x, gy, b],
      [x, gy - 0.7, b * 0.99],
      [x, gy * 0.45, b * 0.96],
      [x, -d * 0.55, b * 0.66],
      [x, -d, 0],
    ] as [number, number, number][];
  });
  const bands = [o.cap, o.strake, o.side, o.bottom];
  for (let s = 0; s < ts.length - 1; s++) {
    for (let j = 0; j < 4; j++) {
      for (const side of [1, -1]) {
        const A = prof[s][j];
        const B = prof[s + 1][j];
        const C = prof[s + 1][j + 1];
        const D = prof[s][j + 1];
        const f = (v: [number, number, number]) => W([v[0], v[1], v[2] * side]);
        // Outward: away from the hull's centreline at the same height.
        const mid = [(A[0] + C[0]) / 2, (A[1] + C[1]) / 2, ((A[2] + C[2]) / 2) * side + side * 3] as const;
        const ctr = [(A[0] + C[0]) / 2, (A[1] + C[1]) / 2 - 1, 0] as const;
        const out = W(mid);
        const inn = W(ctr);
        k.quadToward(f(A), f(B), f(C), f(D), [out[0] - inn[0], out[1] - inn[1], out[2] - inn[2]], bands[j]);
      }
    }
  }
  // Transom (stern station), facing aft.
  const st = prof[0];
  const aft = W([-o.len, 0, 0]);
  const c0 = W([st[0][0], 0, 0]);
  const aftDir: V3 = [aft[0] - c0[0], aft[1] - c0[1], aft[2] - c0[2]];
  for (let j = 0; j < 4; j++) {
    const a = st[j];
    const b = st[j + 1];
    k.quadToward(W([a[0], a[1], a[2]]), W([b[0], b[1], b[2]]), W([b[0], b[1], -b[2]]), W([a[0], a[1], -a[2]]), aftDir, j < 2 ? o.cap : o.side);
  }
  // Deck and the inside of the bulwarks.
  for (let s = 0; s < ts.length - 1; s++) {
    const a = prof[s][0];
    const b = prof[s + 1][0];
    const dy0 = a[1] - 1.3;
    const dy1 = b[1] - 1.3;
    const up = W([0, 100, 0]);
    const zero = W([0, 0, 0]);
    const upDir: V3 = [up[0] - zero[0], up[1] - zero[1], up[2] - zero[2]];
    k.quadToward(W([a[0], dy0, a[2] * 0.95]), W([b[0], dy1, b[2] * 0.95]), W([b[0], dy1, -b[2] * 0.95]), W([a[0], dy0, -a[2] * 0.95]), upDir, o.deck);
    for (const side of [1, -1]) {
      const inward = W([(a[0] + b[0]) / 2, a[1], -side * 10]);
      const at = W([(a[0] + b[0]) / 2, a[1], 0]);
      k.quadToward(
        W([a[0], a[1], a[2] * side * 0.97]),
        W([b[0], b[1], b[2] * side * 0.97]),
        W([b[0], dy1, b[2] * side * 0.95]),
        W([a[0], dy0, a[2] * side * 0.95]),
        [inward[0] - at[0], inward[1] - at[1], inward[2] - at[2]],
        o.strake,
      );
    }
  }
}

// ── a1 · The Landing ─────────────────────────────────────────────────────────

/**
 * The signpost (LM_Signpost), built round the place's base. Eight arms, one per
 * course area, each a different muted colour, splayed so their faces turn to
 * the sun side of the stop's view (sun 250, the camera to the south south
 * east): faces toward ~200 catch the light and still face the camera. The
 * first (lowest) arm carries the lantern that lights when Introduction is
 * done: its glass goes into `lamp`, its centre is returned.
 */
function buildSignpost(k: Kit, lamp: Kit, x: number, z: number): V3 {
  const g = G(x, z);
  // A cairn of beach stones round the foot.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    k.add("dode", T(x + Math.cos(a) * 4.4, g + 1.0, z + Math.sin(a) * 4.4, 2.3, 1.7, 2.1, a), i % 2 ? P.stone : P.stoneDark, g - 0.5, 0.14, 3);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.9;
    k.add("dode", T(x + Math.cos(a) * 2.6, g + 3.0, z + Math.sin(a) * 2.6, 1.7, 1.3, 1.6, a), P.stone, g - 0.5, 0.14, 5);
  }
  // The post, tapered, with two rope bands.
  k.add("taper8", T(x, g + 23, z, 1.9, 46, 1.9, 0.2), P.greyBrown, g, 0.02, 10);
  for (const hy of [11, 16.5]) k.add("cyl8", T(x, g + hy, z, 2.05, 0.8, 2.05), P.rope, null, 0.02);
  // Arms, lowest first: bearings alternate sides round the 110 / 290 axis.
  const bearings = [106, 292, 124, 276, 96, 306, 132, 284];
  let lampArm: { b: number; ay: number; len: number } | null = null;
  for (let i = 0; i < 8; i++) {
    const b = bearings[i];
    const [dx, dz] = dirOf(b);
    const len = 17.5 - (i % 3) * 1.6;
    const hgt = 2.9;
    const ay = g + 19 + i * 3.25;
    const tilt = (rnd(i, 2) - 0.5) * 6 * DEG;
    const pts: [number, number][] = [
      [0, -hgt / 2],
      [len - hgt * 0.62, -hgt / 2],
      [len, 0],
      [len - hgt * 0.62, hgt / 2],
      [0, hgt / 2],
    ];
    const mBoard = T(x + dx * 1.5, ay, z + dz * 1.5, 1, 1, 1, yawTo(b), 0, tilt);
    k.slab(pts, 0.75, mBoard, P.arms[i], P.weathered);
    // Lettering: a dark stroke on each face, reads as a place name at 400.
    _a.set(len * 0.46, 0, 0).applyMatrix4(mBoard.clone());
    k.add("box", T(_a.x, _a.y, _a.z, len * 0.56, 0.55, 0.9, yawTo(b), 0, tilt), P.dark, null, 0.1);
    if (i === 0) lampArm = { b, ay, len };
  }
  // A shingle cap and the teal pennant (a1's accent: the landmark only).
  k.add("box", T(x, g + 46.4, z, 4.6, 0.6, 4.6, 0.2), P.dark);
  k.add("cone4", T(x, g + 48.4, z, 3.6, 3.6, 3.6, 45 * DEG + 0.2), P.shingle);
  k.add("cyl6", T(x, g + 53.5, z, 0.28, 8, 0.28), P.iron);
  const [px, pz] = dirOf(80);
  k.sheet([x, g + 57.2, z], [x + px * 7.5, g + 55.8, z + pz * 7.5], [x, g + 54.2, z], P.teal);
  // The first arm's lantern, hung under it near its tip on a short chain.
  const la = lampArm ?? { b: 106, ay: g + 19, len: 17.5 };
  const [ax, az] = dirOf(la.b);
  const u = 1.5 + la.len * 0.72;
  const lx = x + ax * u;
  const lz = z + az * u;
  const ly = la.ay - 1.45 - 2.4;
  k.beam([lx, la.ay - 1.45, lz], [lx, ly + 2.2, lz], 0.18, 0.18, P.iron);
  k.add("box", T(lx, ly + 1.7, lz, 1.9, 0.35, 1.9), P.iron);
  k.add("cone4", T(lx, ly + 2.25, lz, 1.5, 0.9, 1.5, 45 * DEG), P.iron);
  k.add("box", T(lx, ly - 1.15, lz, 1.8, 0.3, 1.8), P.iron);
  lamp.add("box", T(lx, ly + 0.25, lz, 1.5, 2.5, 1.5), GL.lamp, null, 0);
  return [lx, ly + 0.25, lz];
}

interface LandingOut {
  lamps: V3[];
  fire: V3;
}

/**
 * The skiff someone pulled up on the sand, bow up the beach, oars shipped
 * (their blades out over the stern), a bailer and a painter to a stake.
 */
function skiff(k: Kit, sx: number, sz: number, heading: number): void {
  const g = G(sx, sz);
  const m = T(sx, g + 1.3, sz, 1, 1, 1, yawTo(heading), 0, 0.1);
  hull(k, m, { len: 19, beam: 7, gun: 2.4, keel: 1.6, cap: P.cream, strake: P.skiff, side: P.skiff, bottom: P.hullDark, deck: P.brown });
  const M = m.clone();
  const W = (u: number, v: number, w: number): V3 => {
    _a.set(u, v, w).applyMatrix4(M);
    return [_a.x, _a.y, _a.z];
  };
  // Two thwarts.
  for (const u of [-2.5, 3.2]) {
    const a = W(u, 1.4, -2.9);
    const b = W(u, 1.4, 2.9);
    k.beam(a, b, 0.9, 0.35, P.greyBrown);
  }
  // Oars shipped: along the boat, looms on the thwarts, blades past the stern.
  for (const s of [-1, 1]) {
    const a = W(6.5, 2.1, s * 1.5);
    const b = W(-11.5, 1.9, s * 2.2);
    k.beam(a, b, 0.42, 0.42, P.cream, "cyl6");
    const bl = W(-12.6, 1.9, s * 2.3);
    k.add("box", T(bl[0], bl[1], bl[2], 3.2, 0.25, 1.1, yawTo(heading)), P.cream, null, 0.04);
  }
  // The painter from the bow to a stake up the beach.
  const bow = W(9.4, 2.2, 0);
  const [hx, hz] = dirOf(heading);
  const sx2 = sx + hx * 21;
  const sz2 = sz + hz * 21;
  const gs = G(sx2, sz2);
  k.add("box", T(sx2, gs + 1.6, sz2, 0.7, 3.2, 0.7, 0.3, 0.2), P.weathered, gs);
  k.beam(bow, [sx2, gs + 2.6, sz2], 0.25, 0.25, P.rope);
}

/** A bleached driftwood log along `bearing`, a root knob at one end, a broken branch. */
function driftwood(k: Kit, x: number, z: number, bearing: number, len: number): void {
  const [dx, dz] = dirOf(bearing);
  const a: V3 = [x - dx * len * 0.5, G(x - dx * len * 0.5, z - dz * len * 0.5) + 1.1, z - dz * len * 0.5];
  const b: V3 = [x + dx * len * 0.5, G(x + dx * len * 0.5, z + dz * len * 0.5) + 0.8, z + dz * len * 0.5];
  k.beam(a, b, 2.1, 2.1, P.drift, "cyl6", Math.min(a[1], b[1]) - 1.2);
  k.add("dode", T(a[0] - dx * 1.2, a[1] + 0.6, a[2] - dz * 1.2, 2.6, 2.4, 2.1, rnd(x, z) * 3), P.driftDark, a[1] - 1.5, 0.08, 3);
  const [px, pz] = dirOf(bearing + 70);
  const m: V3 = [x + dx * len * 0.12, (a[1] + b[1]) / 2 + 0.6, z + dz * len * 0.12];
  k.beam(m, [m[0] + px * 5.5 + dx * 1.5, m[1] + 3.2, m[2] + pz * 5.5 + dz * 1.5], 0.7, 0.7, P.drift, "cyl6");
}

/**
 * The bell post at the dock's head (ring for the boat): a post, a short arm
 * with a little shingle hood, the bell, its pull rope; a lantern under the
 * arm's other side. Returns the lantern glass.
 */
function bellPost(k: Kit, glow: Kit, x: number, z: number, deck: number, bearing: number): V3 {
  const [dx, dz] = dirOf(bearing);
  const top = deck + 15;
  k.add("box", T(x, (deck - 3 + top) / 2, z, 1.3, top - deck + 3, 1.3), P.weathered);
  k.beam([x - dx * 3.4, top - 0.8, z - dz * 3.4], [x + dx * 3.6, top - 0.8, z + dz * 3.6], 0.7, 0.7, P.dark);
  // The bell under a hood, out on the arm.
  const bx = x + dx * 3.0;
  const bz = z + dz * 3.0;
  k.add("cone6", T(bx, top + 0.3, bz, 1.9, 1.2, 1.9, 0.2), P.shingle);
  k.add("taper8", T(bx, top - 2.5, bz, 1.25, 2.4, 1.25), P.bell, null, 0.02);
  k.add("cyl8", T(bx, top - 3.8, bz, 1.35, 0.3, 1.35), P.bell, null, 0.02);
  k.beam([bx, top - 3.9, bz], [bx - dx * 0.4, deck + 3.5, bz - dz * 0.4], 0.16, 0.16, P.rope);
  // The lantern on the other side of the arm.
  const lx = x - dx * 3.0;
  const lz = z - dz * 3.0;
  const ly = top - 3.2;
  k.add("box", T(lx, ly + 1.7, lz, 2.0, 0.35, 2.0), P.iron);
  k.add("cone4", T(lx, ly + 2.3, lz, 1.6, 1.0, 1.6, 45 * DEG), P.iron);
  k.add("box", T(lx, ly - 1.2, lz, 1.9, 0.3, 1.9), P.iron);
  glow.add("box", T(lx, ly + 0.2, lz, 1.6, 2.5, 1.6), GL.lamp, null, 0);
  return [lx, ly + 0.2, lz];
}

function buildLanding(k: Kit, glow: Kit): LandingOut {
  const lamps: V3[] = [];
  // The dock: blocks.ts's line (from the trail's foot, bearing 155, 135 long),
  // so your sailboat (blocks' LandingBoat) stays moored alongside it. Planks
  // across with gaps, two stringers, posts in pairs.
  const foot = PATH[0];
  const db = 155;
  const [ddx, ddz] = dirOf(db);
  const [lx, lz] = dirOf(db + 90);
  const L = 135;
  const deck = 4.9;
  const yaw = yawTo(db);
  for (let s = 1.2, i = 0; s < L; s += 2.55, i++) {
    const w = 10 + (rnd(i, 4) - 0.5) * 0.9;
    const off = (rnd(i, 5) - 0.5) * 0.5;
    const col = rnd(i, 6) < 0.12 ? P.cream : rnd(i, 7) < 0.5 ? P.greyBrown : P.weathered;
    k.add("box", T(foot.x + ddx * s + lx * off, deck, foot.z + ddz * s + lz * off, 2.05, 0.55, w, yaw, 0, (rnd(i, 8) - 0.5) * 0.03), col, null, 0.06);
  }
  for (const side of [-1, 1]) {
    k.beam(
      [foot.x + lx * side * 3.4, deck - 1.1, foot.z + lz * side * 3.4],
      [foot.x + ddx * L + lx * side * 3.4, deck - 1.1, foot.z + ddz * L + lz * side * 3.4],
      1.1,
      1.4,
      P.dark,
    );
  }
  // Posts in pairs; the head's last pair stand tall (mooring posts), a gull on each.
  const headPosts: V3[] = [];
  for (let s = 6; s <= L; s += 13.5) {
    for (const side of [-1, 1]) {
      const px = foot.x + ddx * s + lx * side * 5.4;
      const pz = foot.z + ddz * s + lz * side * 5.4;
      const bed = Math.min(0, groundY(px, pz)) - 2;
      const head = s > L - 14;
      const top = head ? deck + 6.5 + (side > 0 ? 1.2 : 0) : deck + 0.6;
      k.add("cyl6", T(px, (bed + top) / 2, pz, 1.1, top - bed, 1.1, rnd(px, pz)), P.dark, null, 0.1);
      if (head) {
        k.add("cyl6", T(px, top + 0.15, pz, 1.2, 0.3, 1.2), P.weathered, null, 0.04);
        headPosts.push([px, top + 0.3, pz]);
      }
    }
  }
  if (headPosts.length >= 2) {
    perchedGull(k, headPosts[0][0], headPosts[0][1], headPosts[0][2], 250);
    perchedGull(k, headPosts[headPosts.length - 1][0], headPosts[headPosts.length - 1][1], headPosts[headPosts.length - 1][2], 205);
  }
  // A rope coil and a cleat near the head, by your sailboat (it is tied here).
  const cs = L - 22;
  const cx = foot.x + ddx * cs + lx * 3.2;
  const cz = foot.z + ddz * cs + lz * 3.2;
  k.add("box", T(cx, deck + 0.7, cz, 3.2, 0.6, 0.8, yaw), P.iron);
  k.add("torus", T(cx - lx * 2.4 - ddx * 3.5, deck + 0.55, cz - lz * 2.4 - ddz * 3.5, 1.9, 1.9, 1.9, 0, Math.PI / 2), P.rope, null, 0.04);
  k.add("torus", T(cx - lx * 2.4 - ddx * 3.5, deck + 1.05, cz - lz * 2.4 - ddz * 3.5, 1.45, 1.45, 1.45, 0, Math.PI / 2), P.rope, null, 0.04);
  k.beam([cx, deck + 1.0, cz], [cx + lx * 6.5, deck + 1.5, cz + lz * 6.5], 0.35, 0.35, P.rope);
  // The bell post at the head, on the side away from the boat.
  lamps.push(bellPost(k, glow, foot.x + ddx * (L - 3) - lx * 4.2, foot.z + ddz * (L - 3) - lz * 4.2, deck, db - 90));


  // The skiff, pulled up on the sand east of the dock, bow up the beach.
  skiff(k, 1383, 4268, 338);
  // Driftwood on the tide line west of the dock.
  driftwood(k, 1262, 4262, 76, 21);

  // The camp: the fire ring (blocks' CampfireFlame moves onto it), two log
  // seats, a kettle on a tripod over it, two packs leaning on the first log.
  const fire = fireRing(k, 1340, 4206, 4.6, true);
  logSeat(k, 1327, 4212, 13, 150);
  logSeat(k, 1347, 4219, 11, 75);
  {
    const [x, g, z] = fire;
    const apex: V3 = [x, g + 10.5, z];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      k.beam([x + Math.cos(a) * 6.2, g, z + Math.sin(a) * 6.2], apex, 0.5, 0.5, P.dark);
    }
    k.beam(apex, [x, g + 7.6, z], 0.18, 0.18, P.iron);
    // The kettle: a squat body, lid, knob, spout and handle.
    k.add("cyl8", T(x, g + 6.3, z, 1.55, 1.9, 1.55), P.kettle, null, 0.02);
    k.add("cyl8", T(x, g + 7.35, z, 1.1, 0.35, 1.1), P.kettle, null, 0.02);
    k.add("cyl6", T(x, g + 7.7, z, 0.35, 0.4, 0.35), P.dark);
    const [sx, sz] = dirOf(250);
    k.beam([x + sx * 1.2, g + 6.0, z + sz * 1.2], [x + sx * 2.7, g + 7.1, z + sz * 2.7], 0.35, 0.35, P.kettle);
  }
  // Packs leaning on the first log seat's back, facing the fire.
  {
    const [bx, bz] = dirOf(240);
    pack(k, 1327 + bx * 3.4, 4212 + bz * 3.4, 60, P.canvasSage);
    pack(k, 1327 + bx * 3.4 + 4.6 * 0.5, 4212 + bz * 3.4 - 4.6 * 0.87, 60, P.canvasOchre, 0.36);
  }
  // A split log pile beside the fire.
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 3 - r; i++) {
      const x = 1356 + i * 2.1 + r * 1.05;
      const z = 4201 - i * 0.6;
      k.add("cyl6", T(x, G(x, z) + 1.0 + r * 1.8, z, 0.95, 6, 0.95, yawTo(160), 0, Math.PI / 2), i % 2 ? P.brown : P.greyBrown, G(x, z), 0.1);
    }
  }
  // Footprints: the dock (from 12 out, so its edge stays 6 clear of the
  // trail's foot), the camp, the skiff and its stake, the driftwood.
  addPathLine(
    [
      [foot.x + ddx * 12, foot.z + ddz * 12],
      [foot.x + ddx * L, foot.z + ddz * L],
    ],
    6,
    "building",
  );
  addFootprint({ x: fire[0], z: fire[2], r: 13, kind: "prop" });
  addFootprint({ x: 1383, z: 4268, r: 10.5, kind: "prop" });
  addFootprint({ x: 1262, z: 4262, r: 11, kind: "prop" });
  return { lamps, fire };
}

/** The boat's new geometry, in the LandingBoat group's frame (+x forward, waterline 0). */
function buildBoat(U: Units): THREE.BufferGeometry {
  const k = new Kit(U, { x: 0, y: 0, z: 0 });
  const m = new THREE.Matrix4();
  const len = 30;
  hull(k, m, { len, beam: 9.4, gun: 3.4, keel: 2.6, cap: P.board, strake: P.teal, side: P.teal, bottom: P.hullDark, deck: P.brown });
  // A small cuddy aft, the mast, boom with the furled sail, stays, a bowsprit.
  k.add("box", T(-7.5, 3.4, 0, 7, 3.0, 5.6), P.cream, 1.5);
  k.add("box", T(-7.5, 5.1, 0, 7.8, 0.5, 6.4), P.brown);
  k.add("box", T(-4.0, 3.8, 0, 0.2, 1.4, 2.4), P.glass);
  const mx = 3.5;
  k.add("cyl6", T(mx, 2 + 13.5, 0, 0.42, 27, 0.42), P.greyBrown);
  k.beam([mx, 7.0, 0], [-12.5, 7.6, 0], 0.4, 0.4, P.greyBrown, "cyl6");
  // Furled sail: a long faceted roll along the boom, fattest near the mast.
  k.beam([mx - 0.8, 8.2, 0], [-11.5, 8.3, 0], 1.6, 1.3, P.canvas, "cyl6");
  k.beam([mx - 0.3, 8.6, 0], [-4, 8.8, 0], 2.1, 1.7, P.canvas, "cyl6");
  // v6: no stays. From a1 the mast stands at the frame's left edge, and its
  // stays drew a dark tripod there; a bare mast with a pennant reads as a boat.
  k.sheet([mx, 28.2, 0], [mx - 5.5, 27.4, 0], [mx, 26.4, 0], P.cream);
  k.beam([len / 2 - 1, 4.5, 0], [len / 2 + 5.5, 4.4, 0], 0.5, 0.5, P.greyBrown, "cyl6");
  // Fenders on the dock side (local -z) and two mooring lines to the dock.
  for (const x of [-6, 2, 9]) k.add("cyl6", T(x, 1.8, -4.55, 0.7, 2.4, 0.7), P.cream);
  k.beam([12, 4.2, -2.4], [16, 5.2, -7.2], 0.3, 0.3, P.rope);
  k.beam([-12, 4.4, -2.8], [-15.5, 5.2, -7.2], 0.3, 0.3, P.rope);
  // Tiller.
  k.beam([-14.5, 4.4, 0], [-10.5, 5.4, 0], 0.5, 0.5, P.brown);
  return k.build();
}

/** The camp fire's flame (blocks' CampfireFlame, which scales it on y from its base). */
function buildFlame(U: Units): THREE.BufferGeometry {
  const k = new Kit(U, { x: 0, y: 0, z: 0 });
  k.add("cone6", T(0, 3.8, 0, 2.3, 7.6, 2.3, 0.3), GL.fire, null, 0);
  k.add("cone6", T(0.4, 2.8, 0.3, 1.45, 5.4, 1.45, 0.9), GL.lamp, null, 0);
  k.add("cone4", T(-0.2, 1.8, -0.1, 0.9, 3.4, 0.9, 0.2), GL.core, null, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    k.add("cone4", T(Math.cos(a) * 1.5, 1.6, Math.sin(a) * 1.5, 0.75, 3.2, 0.75, a, Math.cos(a) * 0.35, -Math.sin(a) * 0.35), GL.fire, null, 0);
  }
  return k.build();
}

// ── a2 · Base Camp ───────────────────────────────────────────────────────────

const LOOKOUT = {
  /** Deck height over the ground, the legs' half span at the foot and at the deck. */
  deck: 52,
  foot: 11.5,
  top: 7,
  cabin: 14.4,
  cabinH: 10.5,
  /** Window band over the deck: [bottom, top]. */
  band: [4.4, 9.0] as const,
};

/** The fire lookout (LM_Lookout). Returns the cabin's centre and the flag's hoist. */
function buildLookout(k: Kit, x: number, z: number): { cabin: V3; hoist: V3 } {
  const g = G(x, z);
  const { deck, foot, top, cabin, cabinH, band } = LOOKOUT;
  const dy = g + deck;
  const corner = (s: number, t: number, h: number): V3 => {
    const f = (h - g) / deck;
    const r = foot + (top - foot) * f;
    return [x + s * r, h, z + t * r];
  };
  const cs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  // Footings and legs.
  for (const [s, t] of cs) {
    const a = corner(s, t, g);
    k.add("box", T(a[0], g + 0.8, a[2], 4.2, 2.6, 4.2), P.concrete, g - 1);
    k.beam(corner(s, t, g + 0.5), corner(s, t, dy), 2.0, 2.0, P.brown);
  }
  // Girts at three levels, X braces on every face between them.
  const levels = [g + 1.5, g + 18, g + 35, dy - 0.8];
  for (let f = 0; f < 4; f++) {
    const [s0, t0] = cs[f];
    const [s1, t1] = cs[(f + 1) % 4];
    for (let l = 0; l < levels.length - 1; l++) {
      const h0 = levels[l];
      const h1 = levels[l + 1];
      k.beam(corner(s0, t0, h0 + 0.8), corner(s1, t1, h1 - 0.4), 0.7, 0.7, P.greyBrown);
      k.beam(corner(s1, t1, h0 + 0.8), corner(s0, t0, h1 - 0.4), 0.7, 0.7, P.greyBrown);
      if (l > 0) k.beam(corner(s0, t0, h0), corner(s1, t1, h0), 0.9, 0.9, P.brown);
    }
  }
  // Stair flights zigzagging up inside the legs, with landings and a handrail.
  const flights = 5;
  for (let i = 0; i < flights; i++) {
    const h0 = g + (i * deck) / flights;
    const h1 = g + ((i + 1) * deck) / flights;
    const sgn = i % 2 ? -1 : 1;
    const zz = z + 2.2;
    k.beam([x - 4.6 * sgn, h0 + 0.4, zz], [x + 4.6 * sgn, h1 - 0.2, zz], 2.8, 0.6, P.greyBrown);
    k.beam([x - 4.6 * sgn, h0 + 3.6, zz + 1.5], [x + 4.6 * sgn, h1 + 3.2, zz + 1.5], 0.3, 0.3, P.dark);
    if (i < flights - 1) k.add("box", T(x + 5.2 * sgn, h1 - 0.1, zz, 3.4, 0.5, 3.4), P.greyBrown);
  }
  // The deck: joists, boards, a catwalk rail.
  for (let i = -2; i <= 2; i++) k.add("box", T(x + i * 4.5, dy - 1.2, z, 0.9, 1.4, 20), P.dark);
  k.add("box", T(x, dy, z, 20.5, 1.1, 20.5), P.brown);
  const R = 10;
  for (const [s, t] of cs) k.add("box", T(x + s * R, dy + 2.6, z + t * R, 0.6, 5.0, 0.6), P.brown);
  for (const [s, t] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    k.add("box", T(x + s * R, dy + 2.6, z + t * R, 0.5, 5.0, 0.5), P.brown);
    const long = s === 0;
    for (const h of [2.6, 5.0]) k.add("box", T(x + s * R, dy + h, z + t * R, long ? 20.4 : 0.45, 0.5, long ? 0.45 : 20.4), P.greyBrown);
  }
  // The cabin: a wall band under the windows, the dark glass band (the
  // LookoutLamp box lights it from progress 2), a header, mullions.
  const c = cabin / 2;
  k.add("box", T(x, dy + 0.55 + band[0] / 2, z, cabin, band[0], cabin), P.cream, dy, 0.02, 3);
  k.add("box", T(x, dy + (band[0] + band[1]) / 2, z, cabin - 0.3, band[1] - band[0], cabin - 0.3), P.glass);
  k.add("box", T(x, dy + (band[1] + cabinH) / 2, z, cabin, cabinH - band[1], cabin), P.cream);
  for (const [s, t] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    for (const u of [-0.66, -0.22, 0.22, 0.66]) {
      const px = s === 0 ? x + u * c : x + s * (c + 0.2);
      const pz = s === 0 ? z + t * (c + 0.2) : z + u * c;
      k.add("box", T(px, dy + (band[0] + band[1]) / 2, pz, s === 0 ? 0.6 : 0.5, band[1] - band[0], s === 0 ? 0.5 : 0.6), P.cream, null, 0.02);
    }
  }
  for (const [s, t] of cs) k.add("box", T(x + s * c, dy + cabinH / 2 + 0.5, z + t * c, 1.0, cabinH, 1.0), P.brown);
  // The hip roof in the accent red, over a dark fascia, with a finial.
  const roofY = dy + cabinH + 0.5;
  k.add("box", T(x, roofY + 0.2, z, 21.2, 0.9, 21.2), P.dark);
  k.add("cone4", T(x, roofY + 0.65 + 3.6, z, 15.0, 7.2, 15.0, 45 * DEG), P.red, null, 0.02);
  k.add("cyl6", T(x, roofY + 8.6, z, 0.9, 1.6, 0.9), P.dark);
  k.add("cyl6", T(x, roofY + 11.8, z, 0.18, 6.2, 0.18), P.iron);
  // The flagpole, on the rail's corner toward the camp.
  const fx = x + R + 0.4;
  const fz = z + R + 0.4;
  k.add("cyl6", T(fx, dy + 13, fz, 0.35, 26, 0.35), P.greyBrown);
  k.add("ico", T(fx, dy + 26.3, fz, 0.6, 0.6, 0.6), P.cream);
  return { cabin: [x, dy + (band[0] + band[1]) / 2, z], hoist: [fx, dy + 25.4, fz] };
}

/** P6: an A frame tent, `bearing` = the way the door faces. Door glow into `glow` if lit. */
function tent(k: Kit, glow: Kit | null, x: number, z: number, bearing: number, w: number, h: number, len: number, col: RGB): void {
  const g = G(x, z) - 0.2;
  const [fx, fz] = dirOf(bearing);
  const [sx, sz] = dirOf(bearing + 90);
  const P3 = (u: number, v: number, s: number): V3 => [x + fx * u + sx * s, g + v, z + fz * u + sz * s];
  const hl = len / 2;
  const hw = w / 2;
  // Slopes. Pass 3: the ridge sags between its poles and each slope dips
  // inward along its middle (the canvas hangs, it is not a pyramid); the
  // lower third flares out to the pegged hem, a shade darker.
  const sag = h * 0.11;
  const hem: RGB = [col[0] * 0.8, col[1] * 0.78, col[2] * 0.74];
  for (const s of [-1, 1]) {
    const out: V3 = [sx * s, 0.6, sz * s];
    const us = [-hl, -hl * 0.5, 0, hl * 0.5, hl];
    const ridge = (u: number) => P3(u, h - sag * (1 - (u / hl) ** 2), 0);
    const belly = (u: number) => P3(u, h * 0.34, s * (hw * 0.62 - 0.35 * (1 - (u / hl) ** 2)));
    const foot = (u: number) => P3(u, 0, s * hw * (1.0 + 0.04 * (1 - (u / hl) ** 2)));
    for (let i = 0; i < us.length - 1; i++) {
      const u0 = us[i];
      const u1 = us[i + 1];
      k.quadToward(belly(u0), belly(u1), ridge(u1), ridge(u0), out, col, g);
      k.quadToward(foot(u0), foot(u1), belly(u1), belly(u0), out, hem, g);
    }
  }
  // Back wall, and the front with its door flap open.
  for (const s of [-1, 1]) k.quadToward(P3(-hl, 0, s * hw), P3(-hl, h * 0.34, s * hw * 0.62), P3(-hl, h, 0), P3(-hl, 0, 0), [-fx, 0, -fz], col, g);
  k.triToward(P3(hl, 0, -hw), P3(hl, 0, -hw * 0.35), P3(hl, h, 0), [fx, 0, fz], col, g);
  k.triToward(P3(hl, 0, hw * 0.35), P3(hl, 0, hw), P3(hl, h, 0), [fx, 0, fz], col, g);
  const door: [V3, V3, V3] = [P3(hl - 0.3, 0, -hw * 0.35), P3(hl - 0.3, 0, hw * 0.35), P3(hl - 0.3, h * 0.9, 0)];
  if (glow) glow.triToward(door[0], door[1], door[2], [fx, 0, fz], [0.9, 0.55, 0.22]);
  else k.triToward(door[0], door[1], door[2], [fx, 0, fz], P.dark);
  // The flap, folded back.
  k.sheet(P3(hl, 0, hw * 0.35), P3(hl + 2.6, 0, hw * 0.8), P3(hl, h * 0.85, 0), P.canvas);
  // Ridge pole ends and guy lines to pegs.
  k.beam(P3(-hl - 1.2, h + 0.1, 0), P3(hl + 1.2, h + 0.1, 0), 0.4, 0.4, P.brown, "cyl6");
  for (const u of [-1, 1]) {
    const peg = P3(u * (hl + 5), 0, 0);
    k.beam(P3(u * (hl + 1.1), h, 0), peg, 0.15, 0.15, P.rope);
    k.add("box", T(peg[0], peg[1] + 0.4, peg[2], 0.4, 1.2, 0.4), P.dark);
  }
}

interface CampOut {
  lamps: V3[];
  chimney: V3;
  wash: { a: V3; b: V3 };
}

/**
 * A log cabin centred at (cx, cz) on ground `g`, its front (porch, door,
 * window) toward `face`: W across the front, D deep, Hh to the eaves. Log
 * courses with cream ends, a shingle roof whose front slope runs on over the
 * porch, a stone chimney up the gable on local -x. Returns the chimney top.
 */
function cabin(k: Kit, glow: Kit, cx: number, cz: number, g: number, face: number, W: number, D: number, Hh: number): V3 {
  // Local +z is the front (face), local +x runs across it toward face - 90.
  const ry = yawTo(face - 90);
  const m = T(cx, g, cz, 1, 1, 1, ry).clone();
  const L = (u: number, v: number, w: number): V3 => {
    _a.set(u, v, w).applyMatrix4(m);
    return [_a.x, _a.y, _a.z];
  };
  // A stone footing so the downhill side never floats.
  {
    const p = L(0, -2.2, 0);
    k.add("box", T(p[0], p[1], p[2], W + 1.2, 5, D + 1.2, ry), P.stoneDark, g - 3, 0.06, 4);
  }
  const courses = Math.round(Hh / 2.18);
  for (let i = 0; i < courses; i++) {
    const p = L(0, 1.1 + i * 2.18, 0);
    k.add("box", T(p[0], p[1], p[2], W + (i % 2) * 0.8, 2.18, D + ((i + 1) % 2) * 0.8, ry), i % 2 ? P.brown : P.greyBrown, g, 0.04, 4);
  }
  for (const s of [-1, 1])
    for (const t of [-1, 1])
      for (let i = 0; i < courses; i += 2) {
        const p = L(s * (W / 2 + 0.9), 1.1 + i * 2.18, t * (D / 2 - 0.6));
        k.add("cyl6", T(p[0], p[1], p[2], 1.0, 2.2, 1.0, ry, 0, Math.PI / 2), P.cream, null, 0.04);
      }
  // Gables and the roof, ridge along the width; the front slope runs on over the porch.
  const top = courses * 2.18;
  const rise = D * 0.42;
  for (const s of [-1, 1]) {
    const dirS = L(s, 0, 0);
    const o0 = L(0, 0, 0);
    k.triToward(L(s * (W / 2), top, -D / 2), L(s * (W / 2), top, D / 2), L(s * (W / 2), top + rise, 0), [dirS[0] - o0[0], 0, dirS[2] - o0[2]], P.greyBrown, null);
  }
  const slope = Math.atan2(rise, D / 2);
  const run = Math.hypot(rise, D / 2) + 1.8;
  for (const s of [-1, 1]) {
    const c = L(0, top + rise / 2 + 0.4, (s * D) / 4 + s * 0.45);
    k.add("box", T(c[0], c[1], c[2], W + 3.4, 0.8, run, ry, s * slope), P.shingle, null, 0.05);
  }
  // The porch: deck, three posts, a lean roof.
  const pd = 6.5;
  const pc = L(0, 0.7, D / 2 + pd / 2);
  k.add("box", T(pc[0], pc[1], pc[2], W, 1.2, pd, ry), P.greyBrown, g);
  for (const u of [-W / 2 + 1, 0, W / 2 - 1]) {
    const p = L(u, top * 0.42 + 0.6, D / 2 + pd - 0.8);
    k.add("box", T(p[0], p[1], p[2], 0.9, top * 0.84, 0.9, ry), P.brown);
  }
  {
    const a = L(0, top - 0.6, D / 2 + 0.2);
    const b = L(0, top * 0.84 + 0.6, D / 2 + pd + 0.8);
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    k.add("box", T(c[0], c[1], c[2], W + 1.5, 0.7, Math.hypot(pd + 0.6, a[1] - b[1]), ry, Math.atan2(a[1] - b[1], pd + 0.6)), P.shingle, null, 0.05);
  }
  const door = L(-W * 0.2, 4.6, D / 2 + 0.45);
  k.add("box", T(door[0], door[1], door[2], 4.4, 8.2, 0.4, ry), P.dark);
  const win = L(W * 0.2, 6.2, D / 2 + 0.45);
  k.add("box", T(win[0], win[1], win[2], 5.0, 3.8, 0.4, ry), P.dark);
  k.add("box", T(win[0], win[1], win[2], 5.8, 4.6, 0.3, ry), P.cream, null, 0.03);
  glow.add("box", T(win[0], win[1], win[2], 4.2, 3.0, 0.5, ry), GL.window, null, 0);
  // Story pair on the porch: a pack by the door, a water barrel at the end.
  {
    const p = L(-W * 0.2 - 4.2, 1.3, D / 2 + 1.6);
    k.add("box", T(p[0], p[1] + 2.2, p[2], 3.0, 4.4, 2.0, ry, 0.15), P.canvasSage);
    k.add("cyl6", T(p[0], p[1] + 5.0, p[2], 0.9, 3.4, 0.9, ry, 0, Math.PI / 2), P.bedroll);
    const q = L(W / 2 - 1.8, 1.3, D / 2 + 1.8);
    barrel(k, q[0], q[1], q[2], 1.9, 4.8, g);
  }
  // The chimney: a stone stack up the gable on local -x.
  const ch = L(-W / 2 - 1.8, 0, -1);
  const n = Math.ceil((top + rise + 3) / 3.4);
  for (let i = 0; i < n; i++) {
    k.add("box", T(ch[0], g + 1.6 + i * 3.4, ch[2], 3.9 - i * 0.1, 3.4, 3.9 - i * 0.1, ry + (i % 2) * 0.06), i % 2 ? P.stone : P.stoneDark, g, 0.06, 6);
  }
  return [ch[0], g + 1.6 + (n - 0.5) * 3.4, ch[2]];
}

/**
 * Base Camp. The lookout (LM_Lookout) stands on its knoll (PLACES a2), ~100
 * west of the trail. The keeper's cabin shares the knoll's flat top on the
 * tower's west side, porch to the valley (south), so the stop frame reads
 * "a fire lookout and its cabin on a hill"; its woodpile and the axe in the
 * stump beside it. The campers' tents stand in a loose row on the meadow at
 * the knoll's west foot, at the woods' edge, round their fire ring, with a
 * washing line behind them; all 245 to 290 from the stop camera (Phase A:
 * "tents crowd the lens").
 */
function buildCamp(k: Kit, glow: Kit, lm: { x: number; z: number }): CampOut {
  const lamps: V3[] = [];
  // The keeper's cabin, west of the tower's legs (they span lm.x +- 11.5).
  const cx = lm.x - 28;
  const cz = lm.z - 4;
  const cg = Math.max(G(cx - 7, cz), G(cx + 7, cz), G(cx, cz - 5), G(cx, cz + 5)) - 0.4;
  const chimney = cabin(k, glow, cx, cz, cg, 175, 16, 12, 10.5);
  addFootprint({ x: cx, z: cz + 2, r: 13, kind: "building" });
  // The woodpile south west of the porch, and the stump with the axe.
  {
    const wx = cx - 9;
    const wz = cz + 15;
    const gw = G(wx, wz);
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < 5 - r; i++) {
        const u = (i - (4 - r) / 2) * 2.1;
        const [dx, dz] = dirOf(80);
        k.add("cyl6", T(wx + dx * u, gw + 1.0 + r * 1.8, wz + dz * u, 1.0, 6.5, 1.0, yawTo(170), 0, Math.PI / 2), (i + r) % 2 ? P.brown : P.greyBrown, gw, 0.12);
      }
    const sx = cx - 1;
    const sz = cz + 22;
    const gs = G(sx, sz);
    k.add("cyl8", T(sx, gs + 1.9, sz, 2.4, 3.8, 2.4), P.brown, gs);
    k.add("cyl8", T(sx, gs + 3.85, sz, 2.3, 0.2, 2.3), P.cream);
    k.beam([sx + 0.3, gs + 3.6, sz], [sx - 2.4, gs + 8.4, sz + 1.2], 0.45, 0.45, P.cream);
    k.add("box", T(sx + 0.2, gs + 4.1, sz, 1.6, 1.2, 0.3, yawTo(150)), P.iron);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7;
      k.add("box", T(sx + Math.cos(a) * 4, gs + 0.5, sz + Math.sin(a) * 4, 2.2, 0.9, 1.1, a), P.cream, gs - 0.5);
    }
    addFootprint({ x: wx, z: wz, r: 7, kind: "prop" });
    addFootprint({ x: sx, z: sz, r: 5, kind: "prop" });
  }

  // The campers' tents: a loose row on the meadow at the knoll's west foot,
  // at the edge of the woods, doors toward their fire ring; 245 to 290 from
  // the stop camera and left of the tower (frame x ~0.17 to 0.36), so the
  // frame reads "a lookout over a camp at the edge of the woods" with no
  // tent near the lens. No fence: at this range it drew a rail across the
  // frame's lower left (Phase A's "fence across the frame").
  const tents: [number, number, number, RGB][] = [
    [262, 2722, 150, P.tentCream],
    [246, 2749, 118, P.tentOchre],
    [240, 2777, 88, P.tentOlive],
  ];
  for (const [tx, tz, b, col] of tents) {
    tent(k, b === 118 ? glow : null, tx, tz, b, 17, 11.5, 22, col);
    addFootprint({ x: tx, z: tz, r: 14, kind: "tent" });
  }
  {
    const f = fireRing(k, 270, 2768, 3.6, true);
    logSeat(k, 279, 2779, 10, 40);
    addFootprint({ x: f[0], z: f[2], r: 8, kind: "prop" });
    addFootprint({ x: 279, z: 2779, r: 6, kind: "prop" });
    lamps.push(lanternPost(k, glow, 282, 2760, 13, 250));
    addFootprint({ x: 282, z: 2760, r: 2.5, kind: "prop" });
  }
  // The washing line between two poles behind the tents.
  const w0: [number, number] = [228, 2716];
  const w1: [number, number] = [220, 2744];
  const gw0 = G(w0[0], w0[1]);
  const gw1 = G(w1[0], w1[1]);
  k.add("box", T(w0[0], gw0 + 6.5, w0[1], 0.9, 13, 0.9), P.weathered, gw0);
  k.add("box", T(w1[0], gw1 + 6.5, w1[1], 0.9, 13, 0.9), P.weathered, gw1);
  k.beam([w0[0], gw0 + 12.2, w0[1]], [w1[0], gw1 + 12.2, w1[1]], 0.2, 0.2, P.rope);
  addFootprint({ x: w0[0], z: w0[1], r: 2, kind: "prop" });
  addFootprint({ x: w1[0], z: w1[1], r: 2, kind: "prop" });
  return { lamps, chimney, wash: { a: [w0[0], gw0 + 12.1, w0[1]], b: [w1[0], gw1 + 12.1, w1[1]] } };
}

// ── Moving cloth (flag, washing) ─────────────────────────────────────────────

/**
 * A strip of cloth as a grid (cols x 2 rows) hung from a line; animate() moves
 * its free edge with a travelling wave. Double sided (its own material).
 */
class Cloth {
  readonly geo = new THREE.BufferGeometry();
  private base: Float32Array;
  private info: Float32Array;
  constructor(pieces: { a: V3; b: V3; drop: V3; cols: number; col: RGB; phase: number; amp: number; flag: boolean }[], origin: V3) {
    const pos: number[] = [];
    const col: number[] = [];
    const inf: number[] = [];
    for (const pc of pieces) {
      const { a, b, drop, cols } = pc;
      const grid: V3[][] = [];
      for (let r = 0; r <= 1; r++) {
        const row: V3[] = [];
        for (let c = 0; c <= cols; c++) {
          const f = c / cols;
          row.push([a[0] + (b[0] - a[0]) * f + drop[0] * r - origin[0], a[1] + (b[1] - a[1]) * f + drop[1] * r - origin[1], a[2] + (b[2] - a[2]) * f + drop[2] * r - origin[2]]);
        }
        grid.push(row);
      }
      // Weight for the wave: 0 at the hoist or the line, 1 at the free edge.
      const w = (r: number, c: number) => (pc.flag ? c / cols : r);
      const push = (r: number, c: number, shade: number) => {
        const v = grid[r][c];
        pos.push(v[0], v[1], v[2]);
        col.push(pc.col[0] * shade, pc.col[1] * shade, pc.col[2] * shade);
        inf.push(w(r, c), pc.phase + c * 0.8, pc.amp);
      };
      for (let c = 0; c < cols; c++) {
        const sh = 0.9 + 0.1 * (c % 2);
        const q: [number, number][] = [
          [0, c],
          [1, c],
          [1, c + 1],
          [0, c],
          [1, c + 1],
          [0, c + 1],
        ];
        for (const [r, cc] of q) push(r, cc, sh);
      }
    }
    this.base = new Float32Array(pos);
    this.info = new Float32Array(inf);
    this.geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    if (this.geo.boundingSphere) this.geo.boundingSphere.radius += 4;
  }
  animate(t: number, wind: [number, number]): void {
    const p = this.geo.getAttribute("position") as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    const b = this.base;
    for (let i = 0; i < p.count; i++) {
      const w = this.info[i * 3];
      if (w <= 0) continue;
      const ph = this.info[i * 3 + 1];
      const amp = this.info[i * 3 + 2];
      const s = Math.sin(t * 2.3 - ph) * 0.7 + Math.sin(t * 3.7 - ph * 1.3) * 0.3;
      arr[i * 3] = b[i * 3] + wind[0] * amp * w * (0.6 + 0.4 * s);
      arr[i * 3 + 1] = b[i * 3 + 1] + amp * w * 0.35 * s;
      arr[i * 3 + 2] = b[i * 3 + 2] + wind[1] * amp * w * (0.6 + 0.4 * s);
    }
    p.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

// ── Halos (bible 4.6 E1) ─────────────────────────────────────────────────────

/**
 * Additive lamp halos. Own program (bible 4.7 "glow"): it cannot take the fog
 * chunk, because mixing an additive sprite toward the fog colour ADDS the fog
 * colour; it fades with distance instead, and scales with light.ts's lamp
 * level (read off the glow material, whose colour light.ts sets).
 */
function haloMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "V5ShoreHalo",
    uniforms: { uScale: { value: 600 }, uMaxPx: { value: 64 }, uLevel: { value: 0.4 }, uColor: { value: new THREE.Color(1.0, 0.62, 0.3) } },
    vertexShader: /* glsl */ `
      attribute float aSize; uniform float uScale; uniform float uMaxPx; varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = clamp(aSize * uScale / d, 0.0, uMaxPx);
        vFade = 1.0 - smoothstep(900.0, 3200.0, d);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uLevel; varying float vFade;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-r * r * 4.0) * (1.0 - smoothstep(0.75, 1.0, r)) * vFade * uLevel;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ── Smoke sources (for life.ts) ──────────────────────────────────────────────

export interface SmokeSource {
  name: string;
  place: "a1" | "a2";
  x: number;
  y: number;
  z: number;
  rate: number;
  rise: number;
  width: number;
}
/** Filled at install (the positions follow the ground); see the header's SMOKE CONTRACT. */
export const SHORE_SMOKE: SmokeSource[] = [];

// ── Install ──────────────────────────────────────────────────────────────────

export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = performance.now();
  const U = makeUnits();
  const root = new THREE.Group();
  root.name = "V5Shore";
  ctx.root.add(root);
  const disposables: { dispose(): void }[] = [];
  const track = <X extends { dispose(): void }>(x: X): X => {
    disposables.push(x);
    return x;
  };
  const scene = ctx.scene;
  const find = (name: string) => scene.getObjectByName(name) ?? null;

  // Materials: the timber family (Lambert, flat), lamp glow (Basic, levelled
  // by light.ts), cloth (double sided), halos.
  const timber = track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  timber.name = "V5Timber";
  const cloth = track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  cloth.name = "V5Cloth";
  const glowMat = track(new THREE.MeshBasicMaterial({ vertexColors: true }));
  glowMat.name = "V5ShoreGlow";
  glowMat.userData.lightGlow = "lamp";
  const haloMat = track(haloMaterial());

  const tris: Record<string, number> = {};
  const meshes: THREE.Mesh[] = [];
  const addMesh = (parent: THREE.Object3D, k: Kit, mat: THREE.Material, name: string, at: { x: number; y: number; z: number }) => {
    tris[name] = Math.round(k.tris);
    const mesh = new THREE.Mesh(track(k.build()), mat);
    mesh.name = name;
    mesh.position.set(at.x, at.y, at.z);
    mesh.matrixAutoUpdate = false;
    // The parent may itself sit at the place's base (the LM_* groups do).
    parent.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
    mesh.matrix.compose(mesh.position, mesh.quaternion, mesh.scale).premultiply(inv);
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  // ── Hide the grey stand-ins ──
  const hidden: THREE.Object3D[] = [];
  for (const name of ["Landmark_a1", "Set_a1_Block", "Landmark_a2", "Set_a2_Block"]) {
    const o = find(name);
    if (o && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  }

  const a1 = PLACES[0].pos;
  const a2 = PLACES[1].pos;
  const lmSign = find(PLACES[0].mesh) ?? root;
  const lmLook = find(PLACES[1].mesh) ?? root;

  // ── a1 ──
  const kSign = new Kit(U, a1);
  const kSignLamp = new Kit(U, a1);
  const glow = new Kit(U, { x: 0, y: 0, z: 0 });
  const signLamp = buildSignpost(kSign, kSignLamp, a1.x, a1.z);
  addMesh(lmSign, kSign, timber, "Shore:signpost", a1);
  const signLampMesh = addMesh(root, kSignLamp, glowMat, "Shore:signLamp", a1);
  addFootprint({ x: a1.x, z: a1.z, r: 6.5, kind: "landmark" });
  const kA1 = new Kit(U, a1);
  const landing = buildLanding(kA1, glow);
  // Cheap laptops (overdraw): the landing, the lookout and the camp are the
  // nearest solids at a1 and a2, so they draw first (before forest.ts's cards
  // at -6) and what stands behind them fails the depth test (a2 average -0.1).
  addMesh(root, kA1, timber, "Shore:a1", a1).renderOrder = -7;

  // ── a2 ──
  const kLook = new Kit(U, a2);
  const look = buildLookout(kLook, a2.x, a2.z);
  addMesh(lmLook, kLook, timber, "Shore:lookout", a2).renderOrder = -7;
  addFootprint({ x: a2.x, z: a2.z, r: 16, kind: "landmark" });
  const kA2 = new Kit(U, a2);
  const camp = buildCamp(kA2, glow, a2);
  addMesh(root, kA2, timber, "Shore:a2", a2).renderOrder = -7;

  addMesh(root, glow, glowMat, "Shore:glow", { x: 0, y: 0, z: 0 });

  // ── Re-skins of blocks' moving and progress-gated parts ──
  const swapped: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[]; pos: THREE.Vector3 }[] = [];
  const swap = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material | null, pos: V3 | null) => {
    const mesh = find(name) as THREE.Mesh | null;
    if (!mesh || !mesh.isMesh) {
      geo.dispose();
      return null;
    }
    swapped.push({ mesh, geo: mesh.geometry, mat: mesh.material, pos: mesh.position.clone() });
    mesh.geometry = track(geo);
    if (mat) mesh.material = mat;
    if (pos) {
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.updateMatrix();
    }
    tris[name] = Math.round(geo.getAttribute("position").count / 3);
    return mesh;
  };
  swap("LandingBoat_Block", buildBoat(U), timber, null);
  const fire = landing.fire;
  swap("CampfireFlame", buildFlame(U), null, [fire[0], fire[1] + 0.8, fire[2]]);
  {
    const kl = new Kit(U, { x: 0, y: 0, z: 0 });
    const w = LOOKOUT.cabin - 0.1;
    kl.add("box", T(0, 0, 0, w, LOOKOUT.band[1] - LOOKOUT.band[0] - 0.2, w), GL.window, null, 0);
    swap("LookoutLamp", kl.build(), null, look.cabin);
  }

  // ── Cloth: the lookout's flag (in LM_Lookout, it is the accent), the washing ──
  const [wx, wz] = dirOf(75); // the wind blows toward ENE (away from the WSW sun)
  const flagCloth = new Cloth(
    [{ a: look.hoist, b: [look.hoist[0] + wx * 10, look.hoist[1] - 0.3, look.hoist[2] + wz * 10], drop: [0, -6, 0], cols: 8, col: P.red, phase: 0, amp: 1.6, flag: true }],
    [a2.x, a2.y, a2.z],
  );
  track(flagCloth.geo);
  const flag = new THREE.Mesh(flagCloth.geo, cloth);
  flag.name = "Shore:flag";
  lmLook.add(flag);
  if (lmLook !== root) flag.position.set(a2.x - lmLook.position.x, a2.y - lmLook.position.y, a2.z - lmLook.position.z);
  else flag.position.set(a2.x, a2.y, a2.z);
  tris["Shore:flag"] = 16;
  // Final pass B integrate (judge: a click in the middle of the lookout went
  // through the open lattice to the sky): an invisible box filling the tower
  // from the legs to the cab, for scene.pickAnchor() only, as dress-gate's
  // Gate_PickProxy. Layer 31 is never drawn and Mesh.raycast ignores layers;
  // it stays inside the tower's own bounds, so the landmark box and pin hold.
  let pickProxy: THREE.Mesh | null = null;
  if (lmLook !== root) {
    const gl = G(a2.x, a2.z);
    const h0 = gl + 2;
    const h1 = gl + LOOKOUT.deck + LOOKOUT.cabinH - 0.5;
    const pw = LOOKOUT.cabin - 0.4;
    const pg = track(new THREE.BoxGeometry(pw, h1 - h0, pw));
    const pm = track(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false }));
    const proxy = new THREE.Mesh(pg, pm);
    proxy.name = "Lookout_PickProxy";
    proxy.layers.set(31);
    lmLook.updateMatrixWorld(true);
    proxy.position.copy(lmLook.worldToLocal(new THREE.Vector3(a2.x, (h0 + h1) / 2, a2.z)));
    lmLook.add(proxy);
    pickProxy = proxy;
  }
  const { a: la, b: lb } = camp.wash;
  const along = (f: number): V3 => [la[0] + (lb[0] - la[0]) * f, la[1] + (lb[1] - la[1]) * f - 1.2 * Math.sin(f * Math.PI), la[2] + (lb[2] - la[2]) * f];
  const washCloth = new Cloth(
    [
      { a: along(0.12), b: along(0.3), drop: [0, -6.5, 0], cols: 2, col: P.cloth1, phase: 0.3, amp: 1.1, flag: false },
      { a: along(0.4), b: along(0.58), drop: [0, -5.2, 0], cols: 2, col: P.cloth2, phase: 1.7, amp: 1.0, flag: false },
      { a: along(0.68), b: along(0.88), drop: [0, -7.2, 0], cols: 2, col: P.cloth3, phase: 2.9, amp: 1.2, flag: false },
    ],
    [a2.x, a2.y, a2.z],
  );
  track(washCloth.geo);
  const wash = new THREE.Mesh(washCloth.geo, cloth);
  wash.name = "Shore:wash";
  wash.position.set(a2.x, a2.y, a2.z);
  root.add(wash);
  tris["Shore:wash"] = 12;

  // ── Halos on every lantern (the sign lamp's first, gated by progress) ──
  const haloPts: [V3, number][] = [
    [signLamp, 8],
    ...landing.lamps.map((l) => [l, 8] as [V3, number]),
    ...camp.lamps.map((l) => [l, 8] as [V3, number]),
  ];
  const haloGeo = track(new THREE.BufferGeometry());
  haloGeo.setAttribute("position", new THREE.Float32BufferAttribute(haloPts.flatMap(([p]) => [p[0], p[1], p[2]]), 3));
  const haloSize = new THREE.Float32BufferAttribute(haloPts.map(([, s]) => s), 1);
  haloGeo.setAttribute("aSize", haloSize);
  haloGeo.computeBoundingSphere();
  const halos = new THREE.Points(haloGeo, haloMat);
  halos.name = "Shore:halos";
  halos.renderOrder = 4;
  const vp = new THREE.Vector2();
  halos.onBeforeRender = (renderer, _s, camera) => {
    renderer.getDrawingBufferSize(vp);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 31;
    haloMat.uniforms.uScale.value = vp.y / (2 * Math.tan((fov * DEG) / 2));
    // Additive sprites: at most 64 CSS px across (bible 3.1 overdraw rules).
    haloMat.uniforms.uMaxPx.value = 64 * renderer.getPixelRatio();
    // light.ts sets the glow material's colour to white x the lamp level.
    haloMat.uniforms.uLevel.value = Math.min(1.2, glowMat.color.r);
  };
  root.add(halos);

  // ── Progress: the signpost's lamp lights when Introduction is done ──
  let progress = 0;
  const setSignLamp = (on: boolean) => {
    signLampMesh.visible = on;
    haloSize.setX(0, on ? 8 : 0);
    haloSize.needsUpdate = true;
  };
  const applyProgress = () => setSignLamp(Math.floor(progress + 1e-6) >= 1);
  applyProgress();
  // progress-world.ts switches it by the share of Introduction watched (its landmark lamp, at 100%).
  signLampMesh.userData.wake = { place: 0, at: 1, set: setSignLamp };

  // ── Smoke sources for life.ts ──
  const flameObj = find("CampfireFlame");
  const smoke: SmokeSource[] = [
    // Sized for the stops, 200 to 250 away: a campfire's column and a cabin's
    // chimney, not a forest fire (v5's 110 and 140 filled a2's sky at stop range).
    { name: "SmokeSource:a1-campfire", place: "a1", x: fire[0], y: fire[1] + 7, z: fire[2], rate: 1.2, rise: 78, width: 5 },
    { name: "SmokeSource:a2-chimney", place: "a2", x: camp.chimney[0], y: camp.chimney[1] + 1, z: camp.chimney[2], rate: 0.9, rise: 52, width: 4 },
  ];
  SHORE_SMOKE.length = 0;
  for (const s of smoke) {
    SHORE_SMOKE.push(s);
    const o = new THREE.Object3D();
    o.name = s.name;
    o.position.set(s.x, s.y, s.z);
    // life.ts reads userData.smoke as the plume's kind; the rest is advisory.
    o.userData.smoke = s.place === "a1" ? "column" : "chimney";
    o.userData.smokeSpec = {
      place: s.place,
      rate: s.rate,
      rise: s.rise,
      width: s.width,
      lit: s.place === "a1" ? () => !flameObj || flameObj.visible : () => true,
    };
    root.add(o);
  }
  root.updateMatrixWorld(true);
  for (const m of Object.values(U)) m.dispose();

  // ── Frame loop: follow blocks' south zone; wave the flag and the washing ──
  const zone = find("Zone_south");
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const sph = new THREE.Sphere();
  const flagSphere = new THREE.Sphere(new THREE.Vector3(look.hoist[0], look.hoist[1], look.hoist[2]), 14);
  const washSphere = new THREE.Sphere(new THREE.Vector3((la[0] + lb[0]) / 2, la[1], (la[2] + lb[2]) / 2), 22);
  const camPos = new THREE.Vector3();
  let animating = false;
  const wind: [number, number] = [wx, wz];
  const buildMs = Math.round(performance.now() - t0);
  // The added meshes, plus the flag, the washing and the halos.
  const calls = meshes.length + 3;

  return {
    name: "dress-shore",
    update(time: number) {
      let changed = false;
      if (zone && root.visible !== zone.visible) {
        root.visible = zone.visible;
        changed = true;
      }
      animating = false;
      if (!root.visible || ctx.reducedMotion) return changed;
      const cam = ctx.camera;
      cam.updateMatrixWorld();
      pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      camPos.setFromMatrixPosition(cam.matrixWorld);
      const near = (s: THREE.Sphere) => camPos.distanceTo(s.center) < 1500 && frustum.intersectsSphere(sph.copy(s));
      if (near(flagSphere)) {
        flagCloth.animate(time, wind);
        animating = true;
      }
      if (near(washSphere)) {
        washCloth.animate(time * 0.8, wind);
        animating = true;
      }
      return changed || animating;
    },
    isAnimating: () => animating,
    setProgress(p: number) {
      progress = Number.isFinite(p) ? p : 0;
      applyProgress();
    },
    dispose() {
      for (const o of hidden) o.visible = true;
      for (const s of swapped) {
        s.mesh.geometry = s.geo;
        s.mesh.material = s.mat;
        s.mesh.position.copy(s.pos);
        s.mesh.updateMatrix();
      }
      flag.removeFromParent();
      pickProxy?.removeFromParent();
      for (const m of meshes) m.removeFromParent();
      root.removeFromParent();
      for (const d of disposables) d.dispose();
      SHORE_SMOKE.length = 0;
    },
    stats() {
      const total = Object.values(tris).reduce((a, b) => a + b, 0);
      return {
        triangles: total,
        ...Object.fromEntries(Object.entries(tris).map(([k, v]) => [`tris_${k}`, v])),
        calls,
        meshes: meshes.length + 3,
        lamps: haloPts.length,
        hidden: hidden.map((o) => o.name).join(","),
        swapped: swapped.map((s) => s.mesh.name).join(","),
        buildMs,
      };
    },
  } as WorldModule & { setProgress(p: number): void };
};
