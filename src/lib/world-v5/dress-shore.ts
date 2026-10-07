import * as THREE from "three";
import { PATH, PLACES, STREAM } from "./layout";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { groundY, rnd, trailDist } from "./rocks";

/**
 * V5 dressing module: dress-shore (world_art_bible.md 3.5, 4.5, 6 "a1", "a2",
 * "The rim and the dive").
 *
 * Dresses the first two places and the walk between them in the bible's one
 * timber family (brown, grey brown, cream, canvas, rope, iron, plus the
 * place's accent), faceted, vertex coloured, no textures. Colour comes from
 * light.ts's key, ramp and grade (bible 1.1): every material here is stock
 * Lambert or Basic with fog on, so light.ts hooks the ramp and the grade in.
 *
 * REPLACES (blocks.ts's grey stand-ins, hidden at install, restored on dispose):
 *   Landmark_a1        the grey signpost in LM_Signpost
 *   Set_a1_Block       the grey dock, crates, shed, fire ring, log seats
 *   Landmark_a2        the grey lookout in LM_Lookout
 *   Set_a2_Block       the grey tents, cabin, fire pit
 * RE-SKINS (blocks.ts keeps driving them, only their geometry is swapped):
 *   LandingBoat_Block  your moored boat: blocks still rocks it on the swell
 *   CampfireFlame      the a1 fire: blocks still gates it on progress >= 1 and
 *                      flickers it; moved onto the new fire ring
 *   LookoutLamp        the lookout's lit cabin: blocks still gates it on
 *                      progress >= 2; moved into the new cabin's window band
 *
 * ADDS, under "V5Shore" (its visibility follows blocks' Zone_south):
 *   Shore:a1        the Landing: the dock with plank gaps, bollards and a rope
 *                   coil (story pair), the beached skiff, crates, barrels,
 *                   sacks, the net shed, a net rack with floats, the fire ring
 *                   with log seats and a cooking tripod, lantern posts;
 *                   pass 3: a dark spruce clump behind the signpost (the wall
 *                   it is lit against), the shed in bleached planks with cream
 *                   frames and a lamp over the door.
 *   Shore:a2        Base Camp: five canvas tents (pass 3: lower, sagging
 *                   ridge and slopes, cream / ochre / olive) with guy lines, the supply
 *                   cabin (log courses, porch, stone chimney, a pack and a map
 *                   on the porch: story pair), woodpile with an axe in the
 *                   stump (story pair), a fire ring, the camp gate, fences.
 *   Shore:trail     furniture from the dock to the south rim's overlook:
 *                   cairns every 90 to 120 on open ground, blazed posts at the
 *                   bends, two benches, and at the overlook a rail along the
 *                   rim's edge, a bench facing the falls and a signboard.
 *   Shore:glow      lantern glass and lit windows (lamp glow, light.ts levels it).
 *   Shore:halos     additive halos on the lanterns (one Points call).
 *   Shore:wash      the a2 washing line's three cloths (moving).
 * and inside the landmark groups (so markers and the park frame them):
 *   Shore:signpost  (LM_Signpost) stone cairn foot, tapered post, rope bands,
 *                   eight pointed boards with lettering, a shingle cap, a teal
 *                   pennant (a1's accent, landmark only) and a hung lantern.
 *   Shore:lookout   (LM_Lookout) splayed legs on footings, three storeys of
 *                   girts and X braces, stair flights, deck with railing,
 *                   cabin with a window band and mullions, a red hip roof
 *                   (a2's accent, landmark only).
 *   Shore:flag      (LM_Lookout) the red flag, moving.
 *
 * SMOKE CONTRACT for life.ts (its "SMOKE SOURCES" rule 1): two empty
 * Object3Ds under V5Shore, "SmokeSource:a1-campfire" (userData.smoke =
 * "column") just over the flame and "SmokeSource:a2-chimney" (userData.smoke
 * = "chimney") on the cabin's chimney top, world space (V5Shore sits at the
 * origin). userData.smokeSpec adds advisory numbers: { place, rate (puffs per
 * second), rise (units the column climbs), width (puff size at the source),
 * lit (() => boolean: false while the fire is out, before progress 1) }. The
 * same list is exported as SHORE_SMOKE for a module that prefers an import.
 *
 * Draw calls: at a1 about 6 (signpost, a1 set, trail, glow, halos, boat +
 * blocks' flame), at a2 about 7 (lookout, flag, a2 set, wash, trail, glow,
 * halos). Triangles: see stats(); budget 45k (brief).
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
  /** Pass 3: the net shed's sun-bleached planks (it read as a black box). */
  shedPlank: lin(0xa89a84),
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

// ── Props (bible 4.5) ────────────────────────────────────────────────────────

/** P8: a crate, `s` across, with a darker lid band. */
function crate(k: Kit, x: number, y: number, z: number, s: number, yaw: number, g: number): void {
  k.add("box", T(x, y + s / 2, z, s, s, s, yaw), P.greyBrown, g);
  k.add("box", T(x, y + s * 0.82, z, s * 1.04, s * 0.14, s * 1.04, yaw), P.brown, null, 0.04);
  k.add("box", T(x, y + s * 0.3, z, s * 1.04, s * 0.12, s * 1.04, yaw), P.brown, g, 0.04);
}
/** P9: a barrel with two iron hoops. */
function barrel(k: Kit, x: number, y: number, z: number, r: number, h: number, g: number): void {
  k.add("cyl8", T(x, y + h / 2, z, r, h, r, rnd(x, z)), P.brown, g);
  for (const f of [0.22, 0.78]) k.add("cyl8", T(x, y + h * f, z, r * 1.06, h * 0.08, r * 1.06), P.iron, null, 0.02);
}
function sack(k: Kit, x: number, y: number, z: number, s: number, g: number): void {
  k.add("dode", T(x, y + s * 0.45, z, s * 0.8, s * 0.55, s * 0.62, rnd(z, x) * 3), P.sack, g);
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
/** R7: a trail cairn of 5 to 6 stones, falling size. */
function cairn(k: Kit, x: number, z: number, h: number, seed: number): void {
  const g = G(x, z);
  let y = g - 0.6;
  let s = h * 0.34;
  for (let i = 0; i < 6 && y < g + h; i++) {
    const ox = (rnd(seed, i) - 0.5) * s * 0.25;
    const oz = (rnd(seed, i + 9) - 0.5) * s * 0.25;
    k.add("dode", T(x + ox, y + s * 0.42, z + oz, s, s * 0.62, s * 0.9, rnd(seed, i + 3) * 3, (rnd(seed, i + 5) - 0.5) * 0.3), i % 2 ? P.stone : P.stoneDark, g, 0.14, h * 0.5);
    y += s * 0.78;
    s *= 0.8;
  }
}
/** P17: a blazed post (cream blaze near the top). */
function blazedPost(k: Kit, x: number, z: number, h: number, bearing: number): void {
  const g = G(x, z);
  k.add("box", T(x, g + h / 2, z, 1.5, h, 1.5, yawTo(bearing)), P.weathered, g);
  k.add("box", T(x, g + h * 0.78, z, 1.62, h * 0.18, 1.62, yawTo(bearing)), P.board, null, 0.04);
  k.add("cone4", T(x, g + h + 0.5, z, 1.2, 1.0, 1.2, yawTo(bearing) + 45 * DEG), P.weathered);
}
/** P24-style bench facing `bearing`. */
function bench(k: Kit, x: number, z: number, bearing: number, len = 12): void {
  const g = G(x, z);
  const yaw = yawTo(bearing + 90);
  const [dx, dz] = dirOf(bearing + 90);
  k.add("box", T(x, g + 3.4, z, len, 0.7, 3.2, yaw), P.greyBrown);
  for (const s of [-1, 1]) {
    k.add("box", T(x + dx * s * len * 0.38, g + 1.6, z + dz * s * len * 0.38, 1.0, 3.4, 2.8, yaw), P.dark, g);
  }
  const [bx, bz] = dirOf(bearing + 180);
  k.add("box", T(x + bx * 1.5, g + 6, z + bz * 1.5, len, 1.6, 0.5, yaw, 0.2), P.greyBrown);
}
/** P10: a split rail fence from a to b (world x, z), posts every ~10. */
function fence(k: Kit, ax: number, az: number, bx: number, bz: number, h = 8): void {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / 10));
  let prev: [number, number, number] | null = null;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const x = ax + (bx - ax) * f;
    const z = az + (bz - az) * f;
    const g = G(x, z);
    k.add("box", T(x, g + h / 2 - 0.5, z, 1.1, h + 1, 1.1, rnd(x, z)), P.weathered, g);
    if (prev) {
      for (const r of [0.45, 0.9]) {
        k.beam([prev[0], prev[1] + h * r, prev[2]], [x, g + h * r, z], 0.7, 0.9, P.greyBrown);
      }
    }
    prev = [x, g, z];
  }
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

/** The signpost (LM_Signpost). Built round the place's base. Returns the lantern glass. */
function buildSignpost(k: Kit, glow: Kit, x: number, z: number): V3 {
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
  // Eight pointed boards, splayed left and right so they read side on from
  // the shore (arms aimed along the view would be seen end on).
  const bearings = [80, 255, 100, 282, 62, 240, 112, 268];
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
    // Painted value (bible 1.9 local contrast): the stop sees the boards'
    // shaded side (the sun is ahead), so their cream is lifted to stay the
    // lightest thing against the dark spruce wall behind them.
    const base = i % 2 ? P.board : P.cream;
    const face: RGB = [base[0] * 1.45, base[1] * 1.45, base[2] * 1.45];
    const mBoard = T(x + dx * 1.5, ay, z + dz * 1.5, 1, 1, 1, yawTo(b), 0, tilt);
    k.slab(pts, 0.75, mBoard, face, P.weathered);
    // Lettering: a dark stroke on each face, reads as a place name at 400.
    const mid = len * 0.46;
    _a.set(mid, 0, 0).applyMatrix4(mBoard.clone());
    k.add("box", T(_a.x, _a.y, _a.z, len * 0.56, 0.62, 0.9, yawTo(b), 0, tilt), P.dark, null, 0.1);
  }
  // A shingle cap and the teal pennant (a1's accent: the landmark only).
  k.add("box", T(x, g + 46.4, z, 4.6, 0.6, 4.6, 0.2), P.dark);
  k.add("cone4", T(x, g + 48.4, z, 3.6, 3.6, 3.6, 45 * DEG + 0.2), P.shingle);
  k.add("cyl6", T(x, g + 53.5, z, 0.28, 8, 0.28), P.iron);
  const [px, pz] = dirOf(80);
  k.sheet([x, g + 57.2, z], [x + px * 7.5, g + 55.8, z + pz * 7.5], [x, g + 54.2, z], P.teal);
  // The lantern, hung on a bracket toward the shore.
  const [lx0, lz0] = dirOf(165);
  k.beam([x, g + 15.2, z], [x + lx0 * 5.4, g + 15.2, z + lz0 * 5.4], 0.6, 0.6, P.iron);
  k.beam([x, g + 11.8, z], [x + lx0 * 3.8, g + 15.1, z + lz0 * 3.8], 0.45, 0.45, P.iron);
  const lx = x + lx0 * 5.0;
  const lz = z + lz0 * 5.0;
  const ly = g + 12.2;
  k.add("box", T(lx, ly + 2.0, lz, 2.5, 0.4, 2.5), P.iron);
  k.add("cone4", T(lx, ly + 2.7, lz, 2.0, 1.2, 2.0, 45 * DEG), P.iron);
  k.add("box", T(lx, ly - 1.45, lz, 2.3, 0.35, 2.3), P.iron);
  k.beam([lx, ly + 3.3, lz], [lx, g + 15.2, lz], 0.2, 0.2, P.iron);
  glow.add("box", T(lx, ly + 0.25, lz, 2.0, 3.0, 2.0), GL.lamp, null, 0);
  return [lx, ly + 0.25, lz];
}

interface LandingOut {
  lamps: V3[];
  fire: V3;
}

function buildLanding(k: Kit, glow: Kit, sign: V3): LandingOut {
  const lamps: V3[] = [];
  // The dock: blocks.ts's line (from the trail's foot, bearing 155, 135 long),
  // so your boat (blocks' LandingBoat) stays moored alongside it. Planks
  // across with gaps, two stringers, posts in pairs, bollards at the boat.
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
  for (let s = 6; s <= L; s += 13.5) {
    for (const side of [-1, 1]) {
      const px = foot.x + ddx * s + lx * side * 5.4;
      const pz = foot.z + ddz * s + lz * side * 5.4;
      const bed = Math.min(0, groundY(px, pz)) - 2;
      const top = s > L - 16 ? deck + 4.5 : deck + 0.6;
      k.add("cyl6", T(px, (bed + top) / 2, pz, 1.05, top - bed, 1.05, rnd(px, pz)), P.dark, null, 0.1);
    }
  }
  // A rope coil and a bollard by the boat (story pair: someone tied up here).
  const bs = 92;
  const bx = foot.x + ddx * bs + lx * 3.6;
  const bz = foot.z + ddz * bs + lz * 3.6;
  k.add("cyl8", T(bx, deck + 1.6, bz, 1.0, 2.6, 1.0), P.iron);
  k.add("torus", T(bx - ddx * 5, deck + 0.6, bz - ddz * 5, 1.9, 1.9, 1.9, 0, Math.PI / 2), P.rope, null, 0.04);
  k.add("torus", T(bx - ddx * 5, deck + 1.1, bz - ddz * 5, 1.5, 1.5, 1.5, 0, Math.PI / 2), P.rope, null, 0.04);
  k.beam([bx, deck + 2.2, bz], [bx + lx * 6.5, deck + 1.2, bz + lz * 6.5 + 0.1], 0.35, 0.35, P.rope);
  // Crates at the dock's end, and a lantern post each side of it.
  const ex = foot.x + ddx * (L - 6);
  const ez = foot.z + ddz * (L - 6);
  crate(k, ex - lx * 2.4, deck + 0.3, ez - lz * 2.4, 4.2, yaw + 0.2, deck);
  crate(k, ex - lx * 2.0 - ddx * 4.5, deck + 0.3, ez - lz * 2.0 - ddz * 4.5, 3.6, yaw - 0.3, deck);
  lamps.push(dockLantern(k, glow, foot.x + ddx * (L - 1) + lx * 5.4, foot.z + ddz * (L - 1) + lz * 5.4, deck, db + 90));
  lamps.push(dockLantern(k, glow, foot.x + ddx * (L - 1) - lx * 5.4, foot.z + ddz * (L - 1) - lz * 5.4, deck, db - 90));

  // At the dock's foot: a crate stack, barrels, sacks, a lantern post.
  const fx = foot.x;
  const fz = foot.z;
  const gf = G(fx - 13, fz - 12);
  crate(k, fx - 13, gf, fz - 12, 5.2, 0.3, gf);
  crate(k, fx - 18.5, gf, fz - 9, 4.6, 0.9, gf);
  crate(k, fx - 14.5, gf + 5.2, fz - 11.2, 4.2, 0.1, gf);
  barrel(k, fx - 7, G(fx - 7, fz - 17), fz - 17, 2.2, 5.6, G(fx - 7, fz - 17));
  barrel(k, fx - 3, G(fx - 3, fz - 19.5), fz - 19.5, 2.2, 5.6, G(fx - 3, fz - 19.5));
  sack(k, fx - 20, G(fx - 20, fz - 16), fz - 16, 4.4, G(fx - 20, fz - 16));
  sack(k, fx - 22.5, G(fx - 22.5, fz - 13), fz - 13, 4.0, G(fx - 22.5, fz - 13));
  lamps.push(lanternPost(k, glow, fx + 9, fz - 4, 17, 250));

  // The beached skiff, pulled up on the sand west of the dock, oars in it.
  {
    const sx = 1289;
    const sz = 4258;
    const g = G(sx, sz);
    const m = T(sx, g + 1.5, sz, 1, 1, 1, yawTo(20), 0, 0.12);
    hull(k, m, { len: 19, beam: 7, gun: 2.4, keel: 1.6, cap: P.cream, strake: P.greyBrown, side: P.weathered, bottom: P.hullDark, deck: P.brown });
    const M = m.clone();
    for (const s of [-1, 1]) {
      _a.set(-6, 2.2, s * 1.2).applyMatrix4(M);
      _b.set(7, 1.6, s * 0.8).applyMatrix4(M);
      k.beam([_a.x, _a.y, _a.z], [_b.x, _b.y, _b.z], 0.45, 0.45, P.cream);
    }
  }

  // The net shed: plank walls with battens, a gable of shingles with an
  // overhang, a door and a window toward the shore, a stovepipe.
  let shedLamp: V3 | null = null;
  {
    const sx = 1232;
    const sz = 4212;
    const g = G(sx, sz) - 0.3;
    const ry = 0.35;
    const W = 19;
    const D = 13;
    const Hh = 10;
    const m = new THREE.Matrix4().copy(T(sx, g, sz, 1, 1, 1, ry));
    const at = (u: number, v: number, w: number): V3 => {
      _a.set(u, v, w).applyMatrix4(m);
      return [_a.x, _a.y, _a.z];
    };
    k.add("box", T(sx, g + Hh / 2, sz, W, Hh, D, ry), P.shedPlank, g, 0.04, 5);
    for (let i = 0; i < 7; i++) {
      const u = -W / 2 + 1.2 + i * ((W - 2.4) / 6);
      const p = at(u, Hh / 2, D / 2 + 0.2);
      k.add("box", T(p[0], p[1], p[2], 0.7, Hh, 0.5, ry), P.weathered, g, 0.06, 5);
    }
    // Gables and roof slabs, ridge along the length.
    const rise = 6.5;
    for (const s of [-1, 1]) {
      k.triToward(at(-W / 2 - 0.05, Hh, s * D / 2), at(-W / 2 - 0.05, Hh, -s * D / 2), at(-W / 2 - 0.05, Hh + rise, 0), (() => { const a = at(-1, 0, 0); const b = at(0, 0, 0); return [a[0] - b[0], 0, a[2] - b[2]] as V3; })(), P.shedPlank);
      k.triToward(at(W / 2 + 0.05, Hh, s * D / 2), at(W / 2 + 0.05, Hh, -s * D / 2), at(W / 2 + 0.05, Hh + rise, 0), (() => { const a = at(1, 0, 0); const b = at(0, 0, 0); return [a[0] - b[0], 0, a[2] - b[2]] as V3; })(), P.shedPlank);
    }
    const slope = Math.atan2(rise, D / 2);
    const run = Math.hypot(rise, D / 2) + 1.6;
    for (const s of [-1, 1]) {
      const c = at(0, Hh + rise / 2 + 0.35, (s * D) / 4 + s * 0.35);
      k.add("box", T(c[0], c[1], c[2], W + 3, 0.7, run, ry, s * slope), P.shingle, null, 0.05);
    }
    const door = at(-4, 3.6, D / 2 + 0.35);
    k.add("box", T(door[0], door[1], door[2], 4.2, 7.2, 0.4, ry), P.dark);
    const win = at(4.5, 5.6, D / 2 + 0.3);
    k.add("box", T(win[0], win[1], win[2], 4.4, 3.4, 0.4, ry), P.dark);
    glow.add("box", T(win[0], win[1], win[2], 3.6, 2.6, 0.5, ry), GL.window, null, 0);
    // Pass 3: cream frames round the door and window, and a lamp over the door.
    for (const [fx0, fy0, fw, fh] of [[-4, 3.6, 5.2, 8.0], [4.5, 5.6, 5.4, 4.4]] as const) {
      const c = at(fx0, fy0, D / 2 + 0.28);
      k.add("box", T(c[0], c[1], c[2], fw, fh, 0.3, ry), P.cream, null, 0.04);
    }
    const lampAt = at(-4, 8.6, D / 2 + 1.1);
    k.add("box", T(lampAt[0], lampAt[1] + 1.3, lampAt[2], 1.9, 0.4, 1.9, ry), P.iron);
    glow.add("box", T(lampAt[0], lampAt[1], lampAt[2], 1.5, 2.0, 1.5, ry), GL.lamp, null, 0);
    shedLamp = [lampAt[0], lampAt[1], lampAt[2]];
    const pipe = at(W / 2 - 3.5, Hh + 5, -2);
    k.add("cyl6", T(pipe[0], pipe[1], pipe[2], 0.7, 6, 0.7), P.iron);
    // A lean-to of stacked firewood on the east end.
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 4 - r; i++) {
        const p = at(W / 2 + 1.8, 1.0 + r * 1.7, -4 + i * 2.2 + r * 1.1);
        k.add("cyl6", T(p[0], p[1], p[2], 0.95, 4.6, 0.95, ry, 0, Math.PI / 2), i % 2 ? P.brown : P.greyBrown, g, 0.1);
      }
    }
    // The net rack: two posts, a bar, a sagging net with cork floats.
    const r0 = at(W / 2 + 6, 0, 8);
    const r1 = at(W / 2 + 22, 0, 12);
    const top = 10;
    k.add("box", T(r0[0], g + top / 2, r0[2], 1.0, top, 1.0), P.weathered, g);
    k.add("box", T(r1[0], G(r1[0], r1[2]) + top / 2, r1[2], 1.0, top, 1.0), P.weathered, g);
    k.beam([r0[0], g + top, r0[2]], [r1[0], G(r1[0], r1[2]) + top, r1[2]], 0.7, 0.7, P.greyBrown);
    const cols = 5;
    for (let i = 0; i < cols; i++) {
      const f0 = i / cols;
      const f1 = (i + 1) / cols;
      const P0: V3 = [r0[0] + (r1[0] - r0[0]) * f0, g + top - 0.4, r0[2] + (r1[2] - r0[2]) * f0];
      const P1: V3 = [r0[0] + (r1[0] - r0[0]) * f1, g + top - 0.4, r0[2] + (r1[2] - r0[2]) * f1];
      const sag0 = 2.2 + 1.6 * Math.sin(f0 * Math.PI);
      const sag1 = 2.2 + 1.6 * Math.sin(f1 * Math.PI);
      const B0: V3 = [P0[0], g + sag0, P0[2] + 0.6];
      const B1: V3 = [P1[0], g + sag1, P1[2] + 0.6];
      k.sheet(P0, P1, B1, P.net);
      k.sheet(P0, B1, B0, P.net);
      k.add("ico", T(P0[0], P0[1] - 0.6, P0[2], 0.75, 0.75, 0.75), P.cream, null, 0.04);
    }
  }

  // The camp fire: ring stones, a teepee of logs, log seats, a cooking
  // tripod with a pot. Blocks' CampfireFlame is moved onto this ring.
  const fire = fireRing(k, 1340, 4206, 4.6, true);
  logSeat(k, 1328, 4210, 13, 150);
  logSeat(k, 1344, 4219, 11, 75);
  k.add("cyl8", T(1352, G(1352, 4199) + 1.8, 4199, 2.1, 3.6, 2.1), P.brown, G(1352, 4199));
  {
    const [x, g, z] = fire;
    const apex: V3 = [x, g + 10, z];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      k.beam([x + Math.cos(a) * 6.2, g, z + Math.sin(a) * 6.2], apex, 0.5, 0.5, P.dark);
    }
    k.beam(apex, [x, g + 7.2, z], 0.18, 0.18, P.iron);
    k.add("cyl8", T(x, g + 6.2, z, 1.6, 2.0, 1.6), P.iron);
  }
  // A split log pile beside the fire.
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 3 - r; i++) {
      const x = 1360 + i * 2.1 + r * 1.05;
      const z = 4214 - i * 0.6;
      k.add("cyl6", T(x, G(x, z) + 1.0 + r * 1.8, z, 0.95, 6, 0.95, yawTo(160), 0, Math.PI / 2), i % 2 ? P.brown : P.greyBrown, G(x, z), 0.1);
    }
  }
  lamps.push(lanternPost(k, glow, sign[0] + 12, sign[2] + 26, 17, 200));
  if (shedLamp) lamps.push(shedLamp);

  // Pass 3: the dark spruce wall the signpost is lit against (bible a1: "the
  // 8 arm signpost at x 0.62, lit against a dark spruce wall"). A clump behind
  // the post along the stop's view (bearing 344), biased east so the trail up
  // the valley (left of the post on screen) stays open.
  {
    const [vx, vz] = dirOf(344);
    const [sx, sz] = dirOf(74);
    const spots: [number, number, number][] = [
      [52, 6, 44], [60, 26, 52], [74, -10, 40], [70, 44, 48], [92, 16, 56],
      [88, 60, 42], [104, -2, 50], [110, 38, 58], [48, 44, 30], [128, 22, 46],
      [122, 70, 40], [60, 64, 26],
    ];
    for (let i = 0; i < spots.length; i++) {
      const [e, r, h] = spots[i];
      const x = sign[0] + vx * e + sx * r + (rnd(i, 61) - 0.5) * 6;
      const z = sign[2] + vz * e + sz * r + (rnd(i, 62) - 0.5) * 6;
      if (trailDist(x, z) < 12) continue;
      spruce(k, x, z, h * (0.92 + rnd(i, 63) * 0.16), i);
    }
  }
  return { lamps, fire };
}

/** A dark tiered spruce (T1 look, bible 4.1): trunk and four zigzag tiers. */
function spruce(k: Kit, x: number, z: number, h: number, seed: number): void {
  const g = G(x, z) - 0.5;
  const R = h * 0.21;
  k.add("cyl6", T(x, g + h * 0.12, z, R * 0.14, h * 0.26, R * 0.14), P.dark, g);
  const tiers = 4;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const r = R * (1 - f * 0.62);
    const y0 = g + h * (0.14 + f * 0.64);
    const th = h * (0.38 - f * 0.05);
    const v = 0.88 + rnd(seed * 7 + t, 64) * 0.24;
    const col: RGB = [P.spruce[0] * v, P.spruce[1] * v, P.spruce[2] * v];
    k.add("cone6", T(x, y0 + th / 2, z, r, th, r, rnd(seed, t) * 3), col, null, 0.06);
  }
}

/** A lantern on a tall dock post (the post itself is part of the dock's end). */
function dockLantern(k: Kit, glow: Kit, x: number, z: number, deck: number, bearing: number): V3 {
  const [dx, dz] = dirOf(bearing);
  const top = deck + 12;
  k.add("box", T(x, deck + 6, z, 1.0, 12, 1.0), P.weathered);
  k.beam([x, top, z], [x + dx * 3.2, top, z + dz * 3.2], 0.5, 0.5, P.iron);
  const lx = x + dx * 3.0;
  const lz = z + dz * 3.0;
  const ly = top - 3.0;
  k.add("box", T(lx, ly + 1.7, lz, 2.1, 0.35, 2.1), P.iron);
  k.add("cone4", T(lx, ly + 2.3, lz, 1.7, 1.0, 1.7, 45 * DEG), P.iron);
  k.add("box", T(lx, ly - 1.2, lz, 1.9, 0.3, 1.9), P.iron);
  glow.add("box", T(lx, ly + 0.2, lz, 1.7, 2.6, 1.7), GL.lamp, null, 0);
  return [lx, ly + 0.2, lz];
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
  k.beam([mx, 28.5, 0], [len / 2 + 5.5, 4.4, 0], 0.18, 0.18, P.rope);
  k.beam([mx, 28.5, 0], [-len / 2 + 0.5, 4.2, 2.8], 0.16, 0.16, P.rope);
  k.beam([mx, 28.5, 0], [-len / 2 + 0.5, 4.2, -2.8], 0.16, 0.16, P.rope);
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

function buildCamp(k: Kit, glow: Kit, lm: { x: number; z: number }): CampOut {
  // Placement in the a2 stop camera's own axes (bearing 330): r to the right
  // of the lookout on screen, e away from the camera. The forest keeps a
  // clearing round (r 21, e -53), radius 108 or more (forest.ts).
  const Rv = dirOf(60);
  const Fv = dirOf(330);
  const at = (r: number, e: number): [number, number] => [lm.x + Rv[0] * r + Fv[0] * e, lm.z + Rv[1] * r + Fv[1] * e];
  const lamps: V3[] = [];

  // The supply cabin, right of the lookout, front toward the camera: log
  // courses, a porch on posts, a stone chimney, a door and a lit window.
  const [cx, cz] = at(78, 8);
  const g = G(cx, cz) - 0.3;
  const face = 150;
  const ry = yawTo(face + 90);
  const m = T(cx, g, cz, 1, 1, 1, ry).clone();
  const W = 28;
  const D = 19;
  const Hh = 13;
  const L = (u: number, v: number, w: number): V3 => {
    _a.set(u, v, w).applyMatrix4(m);
    return [_a.x, _a.y, _a.z];
  };
  for (let i = 0; i < 6; i++) {
    const p = L(0, 1.1 + i * 2.18, 0);
    k.add("box", T(p[0], p[1], p[2], W + (i % 2) * 0.8, 2.18, D + ((i + 1) % 2) * 0.8, ry), i % 2 ? P.brown : P.greyBrown, g, 0.04, 4);
  }
  // Log ends at the corners.
  for (const s of [-1, 1])
    for (const t of [-1, 1])
      for (let i = 0; i < 6; i += 2) {
        const p = L(s * (W / 2 + 0.9), 1.1 + i * 2.18, t * (D / 2 - 0.6));
        k.add("cyl6", T(p[0], p[1], p[2], 1.0, 2.2, 1.0, ry, 0, Math.PI / 2), P.cream, null, 0.04);
      }
  // Gables and the roof, ridge along the length; the front slope runs on over the porch.
  const rise = 8.5;
  for (const s of [-1, 1]) {
    const dirS = L(s, 0, 0);
    const o0 = L(0, 0, 0);
    k.triToward(L(s * (W / 2), Hh, -D / 2), L(s * (W / 2), Hh, D / 2), L(s * (W / 2), Hh + rise, 0), [dirS[0] - o0[0], 0, dirS[2] - o0[2]], P.greyBrown, null);
  }
  const slope = Math.atan2(rise, D / 2);
  const run = Math.hypot(rise, D / 2) + 1.8;
  for (const s of [-1, 1]) {
    const c = L(0, Hh + rise / 2 + 0.4, (s * D) / 4 + s * 0.45);
    k.add("box", T(c[0], c[1], c[2], W + 3.4, 0.8, run, ry, s * slope), P.shingle, null, 0.05);
  }
  // The porch: deck, three posts, a lean roof.
  const pd = 8;
  const pc = L(0, 0.7, D / 2 + pd / 2);
  k.add("box", T(pc[0], pc[1], pc[2], W, 1.2, pd, ry), P.greyBrown, g);
  for (const u of [-W / 2 + 1, 0, W / 2 - 1]) {
    const p = L(u, 6.2, D / 2 + pd - 0.8);
    k.add("box", T(p[0], p[1], p[2], 0.9, 11, 0.9, ry), P.brown);
  }
  {
    const a = L(0, Hh - 0.6, D / 2 + 0.2);
    const b = L(0, 11.2, D / 2 + pd + 0.8);
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    k.add("box", T(c[0], c[1], c[2], W + 1.5, 0.7, Math.hypot(pd + 0.6, a[1] - b[1]), ry, Math.atan2(a[1] - b[1], pd + 0.6)), P.shingle, null, 0.05);
  }
  const door = L(-5, 4.6, D / 2 + 0.45);
  k.add("box", T(door[0], door[1], door[2], 4.6, 8.4, 0.4, ry), P.dark);
  const win = L(5.5, 6.4, D / 2 + 0.45);
  k.add("box", T(win[0], win[1], win[2], 5.4, 4.0, 0.4, ry), P.dark);
  glow.add("box", T(win[0], win[1], win[2], 4.6, 3.2, 0.5, ry), GL.window, null, 0);
  // Story pair: a pack leaning by the door, a map pinned beside it.
  const pack = L(-9.5, 1.3 + 2.2, D / 2 + 1.8);
  k.add("box", T(pack[0], pack[1], pack[2], 3.0, 4.4, 2.0, ry, 0.15), P.canvasSage);
  k.add("cyl6", T(pack[0], pack[1] + 2.8, pack[2], 0.9, 3.4, 0.9, ry, 0, Math.PI / 2), P.rope);
  const map = L(1.2, 6.8, D / 2 + 0.45);
  k.add("box", T(map[0], map[1], map[2], 3.2, 2.6, 0.3, ry, 0, 0.08), P.board);
  // The chimney: a stone stack up the east gable.
  const ch = L(W / 2 + 1.8, 0, -2);
  for (let i = 0; i < 7; i++) {
    k.add("box", T(ch[0], g + 1.6 + i * 3.4, ch[2], 4.2 - i * 0.12, 3.4, 4.2 - i * 0.12, ry + (i % 2) * 0.06), i % 2 ? P.stone : P.stoneDark, g, 0.06, 6);
  }
  const chimney: V3 = [ch[0], g + 25, ch[2]];
  // Crates and a barrel on the porch's end.
  {
    const p = L(W / 2 + 4, 0, D / 2 + 3);
    crate(k, p[0], G(p[0], p[2]), p[2], 5, ry + 0.3, G(p[0], p[2]));
    const q = L(W / 2 + 4.5, 0, D / 2 - 3);
    barrel(k, q[0], G(q[0], q[2]), q[2], 2.2, 5.6, G(q[0], q[2]));
  }

  // Woodpile and the axe in the stump (story pair).
  {
    const [wx, wz] = at(46, -16);
    const gw = G(wx, wz);
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < 5 - r; i++) {
        const u = (i - (4 - r) / 2) * 2.1;
        const [dx, dz] = dirOf(60);
        const x = wx + dx * u;
        const z = wz + dz * u;
        k.add("cyl6", T(x, gw + 1.0 + r * 1.8, z, 1.0, 6.5, 1.0, yawTo(150), 0, Math.PI / 2), (i + r) % 2 ? P.brown : P.greyBrown, gw, 0.12);
      }
    const [sx, sz] = at(38, -26);
    const gs = G(sx, sz);
    k.add("cyl8", T(sx, gs + 1.9, sz, 2.4, 3.8, 2.4), P.brown, gs);
    k.add("cyl8", T(sx, gs + 3.85, sz, 2.3, 0.2, 2.3), P.cream);
    k.beam([sx + 0.3, gs + 3.6, sz], [sx - 2.4, gs + 8.4, sz + 1.2], 0.45, 0.45, P.cream);
    k.add("box", T(sx + 0.2, gs + 4.1, sz, 1.6, 1.2, 0.3, yawTo(150)), P.iron);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7;
      k.add("box", T(sx + Math.cos(a) * 4, gs + 0.5, sz + Math.sin(a) * 4, 2.2, 0.9, 1.1, a), P.cream, gs - 0.5);
    }
  }

  // Tents: a loose row left of the trail (the door glows in one of them).
  // Pass 3: lower and wider (they read as grey pyramids at 13 x 15), in
  // warm canvas colours.
  const tents: [number, number, number, number, RGB][] = [
    [-46, -26, 90, 1, P.tentCream],
    [-72, -52, 60, 0, P.tentOchre],
    [-40, -78, 40, 0, P.tentCream],
    [-86, -18, 110, 0, P.tentOlive],
    [44, -64, 250, 0, P.tentOchre],
  ];
  for (const [r, e, b, lit, col] of tents) {
    const [tx, tz] = at(r, e);
    tent(k, lit ? glow : null, tx, tz, b, 17, 11.5, 22, col);
  }
  // The fire ring between the tents, with log seats.
  {
    const [fx, fz] = at(-22, -52);
    fireRing(k, fx, fz, 4.2, true);
    const [ax, az] = at(-30, -44);
    logSeat(k, ax, az, 11, 330);
    const [bx, bz] = at(-12, -60);
    logSeat(k, bx, bz, 10, 45);
  }

  // The washing line: two posts, the rope; the cloths are their own moving mesh.
  const [w0x, w0z] = at(64, -34);
  const [w1x, w1z] = at(94, -26);
  const gw0 = G(w0x, w0z);
  const gw1 = G(w1x, w1z);
  k.add("box", T(w0x, gw0 + 6.5, w0z, 0.9, 13, 0.9), P.weathered, gw0);
  k.add("box", T(w1x, gw1 + 6.5, w1z, 0.9, 13, 0.9), P.weathered, gw1);
  k.beam([w0x, gw0 + 12.2, w0z], [w1x, gw1 + 12.2, w1z], 0.2, 0.2, P.rope);

  // The camp gate over the trail and fence wings, at the camp's front.
  {
    const e = -104;
    const rTrail = 0.16 * e;
    const [g0x, g0z] = at(rTrail - 11, e);
    const [g1x, g1z] = at(rTrail + 11, e);
    const ga = G(g0x, g0z);
    const gb = G(g1x, g1z);
    k.add("box", T(g0x, ga + 9, g0z, 1.8, 18, 1.8), P.brown, ga);
    k.add("box", T(g1x, gb + 9, g1z, 1.8, 18, 1.8), P.brown, gb);
    k.beam([g0x, ga + 17.2, g0z], [g1x, gb + 17.2, g1z], 1.4, 1.4, P.brown);
    const mid: V3 = [(g0x + g1x) / 2, (ga + gb) / 2 + 14.4, (g0z + g1z) / 2];
    k.add("box", T(mid[0], mid[1], mid[2], 14, 3.2, 0.6, yawTo(60)), P.board);
    k.add("box", T(mid[0], mid[1], mid[2], 9, 0.8, 0.8, yawTo(60)), P.dark);
    const [f0x, f0z] = at(rTrail - 44, e + 6);
    const [f1x, f1z] = at(rTrail + 44, e - 4);
    fence(k, f0x, f0z, g0x, g0z);
    fence(k, g1x, g1z, f1x, f1z);
    lamps.push(lanternPost(k, glow, g1x + Rv[0] * 3, g1z + Rv[1] * 3, 15, 150));
  }
  // A lantern post by the tents.
  {
    const [lx, lz] = at(-30, -30);
    lamps.push(lanternPost(k, glow, lx, lz, 15, 330));
  }
  return { lamps, chimney, wash: { a: [w0x, gw0 + 12.1, w0z], b: [w1x, gw1 + 12.1, w1z] } };
}

// ── Trail furniture (bible 3.5) and the rim ──────────────────────────────────

function buildTrail(k: Kit, glow: Kit): V3[] {
  const lamps: V3[] = [];
  // PATH 0..11: the dock's foot to the overlook on the south rim.
  const last = 11;
  const lm = [PLACES[0].pos, PLACES[1].pos];
  const nearLm = (x: number, z: number, r: number) => lm.some((p) => Math.hypot(x - p.x, z - p.z) < r);
  let carry = 60;
  let side = 1;
  let n = 0;
  for (let i = 0; i < last; i++) {
    const a = PATH[i];
    const b = PATH[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    let s = carry;
    while (s < len) {
      const f = s / len;
      const x = a.x + (b.x - a.x) * f + nx * 10 * side;
      const z = a.z + (b.z - a.z) * f + nz * 10 * side;
      if (!nearLm(x, z, 150) && trailDist(x, z) > 6) {
        cairn(k, x, z, 9 + rnd(n, 1) * 3, n);
        n++;
      }
      side = -side;
      s += 95 + rnd(i, s) * 25;
    }
    carry = s - len;
    // A blazed post at each bend, on the outside of the turn.
    if (i > 0 && !nearLm(a.x, a.z, 120)) {
      const p = PATH[i - 1];
      const cross = (a.x - p.x) * (b.z - a.z) - (a.z - p.z) * (b.x - a.x);
      const o = cross > 0 ? -1 : 1;
      blazedPost(k, a.x + nx * 9 * o, a.z + nz * 9 * o, 13, Math.atan2(b.x - a.x, -(b.z - a.z)) / DEG);
    }
  }
  // Two benches with a view: between the Landing and Base Camp, and above it.
  bench(k, 1000, 3590, 340);
  bench(k, 225, 2375, 20);

  // The overlook on the south rim (PATH[11]): a rail along the edge, a bench
  // facing the falls, a signboard and a cairn.
  const ov = PATH[11];
  const railZ = 1782;
  fence(k, ov.x - 70, railZ + 4, ov.x - 20, railZ, 9);
  fence(k, ov.x - 20, railZ, ov.x + 40, railZ + 3, 9);
  bench(k, ov.x - 8, railZ + 16, 0, 14);
  {
    const x = ov.x - 40;
    const z = railZ + 20;
    const g = G(x, z);
    k.add("box", T(x, g + 7, z, 1.3, 14, 1.3), P.weathered, g);
    k.add("box", T(x, g + 12, z, 10, 5, 0.6, yawTo(90)), P.board);
    k.add("box", T(x, g + 12.4, z, 7, 0.7, 0.8, yawTo(90)), P.dark);
    k.add("box", T(x, g + 11.1, z, 5, 0.7, 0.8, yawTo(90)), P.dark);
  }
  cairn(k, ov.x + 28, railZ + 18, 12, 777);
  lamps.push(lanternPost(k, glow, ov.x + 12, railZ + 22, 16, 0));
  fallenLogOverStream(k);
  return lamps;
}

/**
 * The vignette at the falls' lip (bible 2.2.4, "a log over the brook"): a
 * fallen spruce across the stream 180 above the lip, root plate on the north
 * bank, a rope rail on two posts, a cairn on the north bank. The rim frame
 * (TRAIL key 12) looks up the stream's last reach toward it.
 */
function fallenLogOverStream(k: Kit): void {
  // 180 up the stream from the lip: nearer, its south bank is the gorge's
  // edge itself (probed: the ground falls 400 within 40 of the water).
  let rem = 180;
  let cx = 0;
  let cz = 0;
  let water = 0;
  let ux = 1;
  let uz = 0;
  for (let i = STREAM.length - 1; i > 0; i--) {
    const b = STREAM[i];
    const a = STREAM[i - 1];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    ux = (b[0] - a[0]) / L;
    uz = (b[2] - a[2]) / L;
    if (rem <= L) {
      const f = rem / L;
      cx = b[0] + (a[0] - b[0]) * f;
      cz = b[2] + (a[2] - b[2]) * f;
      water = b[1] + (a[1] - b[1]) * f;
      break;
    }
    rem -= L;
  }
  // Across the stream; each end rests on the first ground 6 over the water,
  // on the highest point within 8 beyond it (the south bank is a thin lip).
  const ax = -uz;
  const az = ux;
  const end = (sgn: number): V3 => {
    for (let d = 10; d < 120; d += 2) {
      const x = cx + ax * d * sgn;
      const z = cz + az * d * sgn;
      if (groundY(x, z) > water + 6) {
        let best = -Infinity;
        let bd = d;
        for (let e = d; e <= d + 8; e += 2) {
          const g = groundY(cx + ax * e * sgn, cz + az * e * sgn);
          if (g > best) {
            best = g;
            bd = e;
          }
        }
        return [cx + ax * bd * sgn, best + 2.4, cz + az * bd * sgn];
      }
    }
    return [cx + ax * 50 * sgn, water + 8, cz + az * 50 * sgn];
  };
  const p0 = end(-1);
  const p1 = end(1);
  k.beam(p0, p1, 2.7, 2.7, P.brown, "cyl8");
  // A lighter top where boots have worn the bark off.
  k.beam([p0[0], p0[1] + 2.4, p0[2]], [p1[0], p1[1] + 2.4, p1[2]], 1.6, 0.6, P.greyBrown);
  // The root plate on the north end, branch stubs along the log.
  const dx = p1[0] - p0[0];
  const dz = p1[2] - p0[2];
  const len = Math.hypot(dx, dz);
  k.add("dode", T(p0[0] - (dx / len) * 2, p0[1] + 1.5, p0[2] - (dz / len) * 2, 8, 7.5, 2.4, Math.atan2(dx, dz)), P.dark, null, 0.06);
  for (let i = 1; i <= 3; i++) {
    const f = 0.25 * i;
    const x = p0[0] + dx * f;
    const y = p0[1] + (p1[1] - p0[1]) * f;
    const z = p0[2] + dz * f;
    const s = i % 2 ? 1 : -1;
    k.beam([x, y, z], [x + ux * 5 * s, y + 4, z + uz * 5 * s], 0.9, 0.9, P.weathered, "cyl6");
  }
  // Rope rail: a post lashed to each end of the log, the rope sagging between.
  const q0: V3 = [p0[0] + (dx / len) * 5 + ux * 3.2, p0[1], p0[2] + (dz / len) * 5 + uz * 3.2];
  const q1: V3 = [p1[0] - (dx / len) * 5 + ux * 3.2, p1[1], p1[2] - (dz / len) * 5 + uz * 3.2];
  k.beam([q0[0], q0[1] - 3, q0[2]], [q0[0], q0[1] + 10, q0[2]], 1.1, 1.1, P.weathered);
  k.beam([q1[0], q1[1] - 3, q1[2]], [q1[0], q1[1] + 10, q1[2]], 1.1, 1.1, P.weathered);
  let prev: V3 = [q0[0], q0[1] + 9.5, q0[2]];
  for (let i = 1; i <= 4; i++) {
    const f = i / 4;
    const cur: V3 = [q0[0] + (q1[0] - q0[0]) * f, q0[1] + (q1[1] - q0[1]) * f + 9.5 - 3.2 * Math.sin(f * Math.PI), q0[2] + (q1[2] - q0[2]) * f];
    k.beam(prev, cur, 0.35, 0.35, P.rope);
    prev = cur;
  }
  cairn(k, p0[0] - ax * 10, p0[2] - az * 10, 11, 901);
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
    uniforms: { uScale: { value: 600 }, uLevel: { value: 0.4 }, uColor: { value: new THREE.Color(1.0, 0.62, 0.3) } },
    vertexShader: /* glsl */ `
      attribute float aSize; uniform float uScale; varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = clamp(aSize * uScale / d, 0.0, 80.0);
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
  const glow = new Kit(U, { x: 0, y: 0, z: 0 });
  const signLamp = buildSignpost(kSign, glow, a1.x, a1.z);
  addMesh(lmSign, kSign, timber, "Shore:signpost", a1);
  const kA1 = new Kit(U, a1);
  const landing = buildLanding(kA1, glow, [a1.x, a1.y, a1.z]);
  addMesh(root, kA1, timber, "Shore:a1", a1);

  // ── a2 ──
  const kLook = new Kit(U, a2);
  const look = buildLookout(kLook, a2.x, a2.z);
  addMesh(lmLook, kLook, timber, "Shore:lookout", a2);
  const kA2 = new Kit(U, a2);
  const camp = buildCamp(kA2, glow, a2);
  addMesh(root, kA2, timber, "Shore:a2", a2);

  // ── Trail ──
  const trailO = { x: 500, y: 150, z: 2900 };
  const kTrail = new Kit(U, trailO);
  const trailLamps = buildTrail(kTrail, glow);
  addMesh(root, kTrail, timber, "Shore:trail", trailO);

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
  flag.position.set(0, 0, 0);
  lmLook.add(flag);
  if (lmLook !== root) flag.position.set(a2.x - lmLook.position.x, a2.y - lmLook.position.y, a2.z - lmLook.position.z);
  else flag.position.set(a2.x, a2.y, a2.z);
  tris["Shore:flag"] = 16;
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

  // ── Halos on every lantern and on the lookout's lit windows ──
  const haloPts: [V3, number][] = [
    [signLamp, 9],
    ...landing.lamps.map((l) => [l, 8] as [V3, number]),
    ...camp.lamps.map((l) => [l, 8] as [V3, number]),
    ...trailLamps.map((l) => [l, 8] as [V3, number]),
  ];
  const haloGeo = track(new THREE.BufferGeometry());
  haloGeo.setAttribute("position", new THREE.Float32BufferAttribute(haloPts.flatMap(([p]) => [p[0], p[1], p[2]]), 3));
  haloGeo.setAttribute("aSize", new THREE.Float32BufferAttribute(haloPts.map(([, s]) => s), 1));
  haloGeo.computeBoundingSphere();
  const halos = new THREE.Points(haloGeo, haloMat);
  halos.name = "Shore:halos";
  halos.renderOrder = 4;
  const vp = new THREE.Vector2();
  halos.onBeforeRender = (renderer, _s, camera) => {
    renderer.getDrawingBufferSize(vp);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 31;
    haloMat.uniforms.uScale.value = vp.y / (2 * Math.tan((fov * DEG) / 2));
    // light.ts sets the glow material's colour to white x the lamp level.
    haloMat.uniforms.uLevel.value = Math.min(1.2, glowMat.color.r);
  };
  root.add(halos);

  // ── Smoke sources for life.ts ──
  const flameObj = find("CampfireFlame");
  const smoke: SmokeSource[] = [
    { name: "SmokeSource:a1-campfire", place: "a1", x: fire[0], y: fire[1] + 7, z: fire[2], rate: 1.2, rise: 110, width: 7 },
    { name: "SmokeSource:a2-chimney", place: "a2", x: camp.chimney[0], y: camp.chimney[1], z: camp.chimney[2], rate: 0.8, rise: 140, width: 6 },
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
    dispose() {
      for (const o of hidden) o.visible = true;
      for (const s of swapped) {
        s.mesh.geometry = s.geo;
        s.mesh.material = s.mat;
        s.mesh.position.copy(s.pos);
        s.mesh.updateMatrix();
      }
      flag.removeFromParent();
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
        meshes: meshes.length + 3,
        lamps: haloPts.length,
        hidden: hidden.map((o) => o.name).join(","),
        swapped: swapped.map((s) => s.mesh.name).join(","),
        buildMs,
      };
    },
  };
};
