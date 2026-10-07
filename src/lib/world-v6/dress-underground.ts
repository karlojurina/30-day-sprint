import * as THREE from "three";
// v6: the cave is dressed in its BUILD frame (v5's: the mouth faces +z) and
// hung into the world under the mirror (layout CAVE_MIRROR_Z); "the tunnel"
// here is the short side passage out of the hall (CAVE_EXIT_BUILD).
import { CAVE_BUILD as CAVE, CAVE_EXIT_BUILD as TUNNEL, CAVE_EXIT_OPENING, WORLD, caveMirrorZ } from "./layout";
import type { InstallFn, WorldCtx } from "./modules";
import { terrainHeight } from "./terrain";
import type { QualityTier } from "./quality";

/**
 * v5 dressing: underground (world_art_bible.md 6: the rim and the dive, a3
 * the cave behind the falls, the mine tunnel, a4 the mine lift, the shaft).
 *
 * v6 (world_art_bible_v6.md 4.3 step 5): the mine is gone (the tunnel's
 * dressing, the shaft, the cage, their torches and light). The cave moved
 * with the falls to the gorge's south wall as a mirror image: its kits are
 * built and baked in the BUILD frame (layout CAVE_BUILD) and drawn under
 * UG_CaveMirror (z -> CAVE_MIRROR_Z - z); the wall shader reads positions
 * back in the build frame (uToBuild) for the curtain's ripples. The side
 * passage (UG_Tunnel, blocks.ts's Mine_Tunnel) leads out east to the cliff
 * face, with two torches and daylight baked in at its far end. Sprites and
 * mist cards are placed in WORLD coordinates (their shaders ignore the model
 * matrix). The text below is v5's and still describes the cave.
 *
 * What it replaces from blocks.ts (hidden at install, restored on dispose):
 *   Mine_Cave, Mine_Tunnel, Mine_Shaft  the grey shells, lit by a
 *        MeshStandardMaterial that still took the scene's fill light, so the
 *        hall read as a lit cream room. Their triangles are re-used (the
 *        holes, the arches and the rails fit the camera path) and re-coloured:
 *        wet black rock, brown timber, iron; light baked into the vertices.
 *   Mine_Flames      cone flames and lantern glass: now sprites (glow below).
 *   LiftCage, LiftCable  the grey cage: a new one rides in LM_MineLift.
 *   Landmark_a3_Water's material (water.ts's SurfCurtain, set at install,
 *        its live uniforms shared by reference so water.ts
 *        keeps driving the light, the clock and the "seen from behind" test).
 *
 * What it adds (7 draw calls, the 7 it hides are gone; most are zoned off
 * above ground):
 *   UG_Cave, UG_Tunnel, UG_Shaft  the `cavewall` program (bible 4.7): unlit,
 *        colour = albedo x baked light. Torch and lantern pools are baked per
 *        vertex into a second attribute that one shared uniform flickers
 *        (bible 0.7: no dynamic lights). In the cave: caustic ripples from the
 *        curtain (two Voronoi edge samples, min(), bible 6 a3) and a wet
 *        sheen of the lit water on rock and puddles. New dressing merged in:
 *        16 more torches (every ~60, bible 6 tunnel), a portal set, carts,
 *        spilled ore, a pickaxe and shovel, puddles, a pack and rope by the
 *        lantern, wet rock sheets, ferns and moss at the mouth, a lever post
 *        and bell at the lift, a ladder and steel guides up the shaft.
 *   UG_LiftCage (+ UG_LiftCables)  the lift as a landmark: plank floor,
 *        posts with iron corners, a top frame, slatted sides, a folded gate,
 *        chains to the hoist ring, two cables up to the sheave, a lantern.
 *   UG_Glow   one additive instanced call: flames (two-tone teardrops that
 *        flicker by scale), halos, dust motes in the pools and the shaft's
 *        light, ray cards (the shaft's daylight column; amber shafts through
 *        the gorge's mist).
 *   UG_Mist   one alpha-blended instanced call: mist lying on the pool, spray
 *        climbing the curtain's foot, a veil in the shade up the dive, a
 *        glowing haze just inside the cave mouth.
 *
 * Contract: scene.userData.dressUnderground = { stats() }. Materials keep
 * three's fog chunks (fog: true), so light.ts's ramp and grade reach them,
 * except UG_Glow: fog-mixing an additive sprite ADDS the fog colour, so the
 * glow program fades by the same ramp distances (scene.fog near / far) instead.
 */

type RGB = readonly [number, number, number];
type V3 = readonly [number, number, number];

// ── Palette (linear) ─────────────────────────────────────────────────────────
const PAL = {
  caveRock: [0.085, 0.088, 0.095] as RGB, // wet black rock
  // Detail pass 3: cool grey rock, so the torch pools and the timber are the
  // only warm things (the tunnel read as one orange-brown, the shaft as a brown wash).
  tunnelRock: [0.19, 0.145, 0.11] as RGB, // v6: the gorge's warm sandstone (was cool grey mine rock)
  shaftRock: [0.088, 0.092, 0.102] as RGB,
  timber: [0.14, 0.088, 0.058] as RGB, // #6b4e3a, a little less red under the torches
  timberDark: [0.078, 0.05, 0.034] as RGB,
  iron: [0.05, 0.048, 0.047] as RGB,
  rust: [0.1, 0.045, 0.024] as RGB, // #5a3a2a
  canvas: [0.35, 0.3, 0.22] as RGB,
  rope: [0.3, 0.22, 0.12] as RGB,
  ore: [0.07, 0.065, 0.06] as RGB,
  puddle: [0.012, 0.014, 0.018] as RGB,
  moss: [0.03, 0.05, 0.025] as RGB,
  fern: [0.045, 0.075, 0.035] as RGB,
};
/** Glow colours (linear, above 1 on purpose). */
const GLOW = {
  torch: [2.3, 0.85, 0.22] as RGB,
  torchCore: [2.6, 1.9, 1.0] as RGB,
  lantern: [2.4, 1.3, 0.5] as RGB,
  halo: [1.0, 0.42, 0.12] as RGB,
  day: [1.0, 0.72, 0.5] as RGB, // v6 (B7): the gorge-sunset daylight at the side passage's exit
};

// ── Tunables ─────────────────────────────────────────────────────────────────
/** Light the rock takes where no lamp reaches (never a full black gap, bible 6 tunnel). */
const AMBIENT = { cave: [0.045, 0.052, 0.064] as RGB, tunnel: [0.14, 0.13, 0.14] as RGB, shaft: [0.07, 0.08, 0.1] as RGB, outside: [0.5, 0.46, 0.42] as RGB };
/** Torches: strength, reach (half at this distance, bible pool radius 14-18), wrap. */
const TORCH = { i: 3.0, r: 11, wrap: 0.35, col: [1.0, 0.62, 0.34] as RGB, spacing: 62 };
/** The curtain as a light into the hall: 9 samples over the mouth. */
const CURTAIN_LIGHT = { i: 0.15, r: 42, col: [0.62, 0.74, 0.86] as RGB };
/** The shaft's daylight: strength at the collar and how fast it falls off going down. */
const DAY = { i: 2.9, fall: 220 }; // pass 3: 2.2 -> 2.9 with the longer tail below, a visible cool gradient up the ride
/** The caustics' cool colour and reach from the mouth plane. */
const CAUSTIC = { col: [0.032, 0.048, 0.064] as RGB, reach: 25 }; // pass 3: 55 -> 42, the net on the far pillar read as a spider web; fix-2: 40% strength, reach 25
const FLOOR_LIFT = 0.3; // blocks.ts: the tunnel floor sits this far over the room floors
/** Final pass D: the cave's floor light pools (glow kind 4), puddle glints and roof drips (kind 5, falling `drip`). */
const CAVE_POOL = { lamp: [0.95, 0.52, 0.2] as RGB, fire: [1.0, 0.4, 0.1] as RGB, glint: [1.4, 0.88, 0.5] as RGB, bead: [1.3, 0.9, 0.55] as RGB, drip: 38 };
/** v6, world frame: where the cave is worth drawing from, and where the camera is in it. */
const MINE_BOX = { x0: -700, x1: 900, z0: 1200, z1: 2300, y1: 950 };
const IN_MINE = { x0: -200, x1: 70, z0: 1690, z1: 1900, y1: 170 };
const REPLACED = ["Mine_Cave", "Mine_Tunnel"] as const;
/**
 * v6 (B7): v5's 50 mist cards outside the cave (lying on the pool, spray at
 * the curtain's foot, a veil up the dive, a bank in front of the pool). Off:
 * the foot's mist is water.ts's (bible 2.4, B4), and the cap is 40 mist cards
 * in view in all; two sets doubled the blended layers over the ride and the
 * turn. The cave's own haze inside the mouth stays (6 cards).
 */
const OUTDOOR_MIST = false;

// ── Small helpers ────────────────────────────────────────────────────────────
function rnd(i: number, s = 0): number {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
function T(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

interface Units {
  box: THREE.BufferGeometry;
  cyl6: THREE.BufferGeometry;
  cyl8: THREE.BufferGeometry;
  cone6: THREE.BufferGeometry;
  dode: THREE.BufferGeometry;
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
    cone6: ni(new THREE.ConeGeometry(1, 1, 6)),
    dode: ni(new THREE.DodecahedronGeometry(1, 0)),
    torus: ni(new THREE.TorusGeometry(1, 0.28, 4, 10)),
  };
}

/**
 * Collects world-space triangles with an albedo, an emission (glass and
 * embers: light of their own, flickered) and a wetness, then bakes the light.
 */
class Kit {
  p: number[] = [];
  c: number[] = [];
  e: number[] = [];
  w: number[] = [];
  private n = 0;
  constructor(private readonly u: Units) {}
  push(x: number, y: number, z: number, col: RGB, k: number, emit: RGB | null, wet: number): void {
    this.p.push(x, y, z);
    this.c.push(col[0] * k, col[1] * k, col[2] * k);
    this.e.push(emit ? emit[0] : 0, emit ? emit[1] : 0, emit ? emit[2] : 0);
    this.w.push(wet);
  }
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, col: RGB, o: { vary?: number; emit?: RGB; wet?: number } = {}): void {
    const a = geo.getAttribute("position");
    const vary = o.vary ?? 0.14;
    const k = 1 - vary / 2 + vary * rnd(this.n++, 3.7);
    for (let i = 0; i < a.count; i++) {
      _a.fromBufferAttribute(a, i).applyMatrix4(m);
      this.push(_a.x, _a.y, _a.z, col, k, o.emit ?? null, o.wet ?? 0);
    }
  }
  tri(a: V3, b: V3, c: V3, col: RGB, wet = 0): void {
    for (const v of [a, b, c]) this.push(v[0], v[1], v[2], col, 1, null, wet);
  }
  beam(a: V3, b: V3, w: number, d: number, col: RGB, o: { vary?: number; emit?: RGB; wet?: number; geo?: THREE.BufferGeometry } = {}): void {
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    const len = _a.distanceTo(_b);
    if (len < 1e-6) return;
    _p.addVectors(_a, _b).multiplyScalar(0.5);
    _q.setFromUnitVectors(UP, _b.sub(_a).divideScalar(len));
    this.add(o.geo ?? this.u.box, _m.compose(_p, _q, _s.set(w, len, d)), col, o);
  }
  /** Triangles of another non-indexed geometry (blocks.ts's shells), re-coloured by `albedo`. */
  adopt(geo: THREE.BufferGeometry, origin: THREE.Vector3, albedo: (r: number, g: number, b: number, x: number, y: number, z: number) => [RGB, number], keep?: (r: number, g: number, b: number) => boolean): void {
    const pos = geo.getAttribute("position");
    const col = geo.getAttribute("color");
    for (let i = 0; i < pos.count; i++) {
      // v6: drop whole triangles the filter refuses (the passage's timber sets).
      if (keep && i % 3 === 0 && !keep(col.getX(i), col.getY(i), col.getZ(i))) {
        i += 2;
        continue;
      }
      const x = pos.getX(i) + origin.x;
      const y = pos.getY(i) + origin.y;
      const z = pos.getZ(i) + origin.z;
      const [al, wet] = albedo(col.getX(i), col.getY(i), col.getZ(i), x, y, z);
      this.push(x, y, z, al, 1, null, wet);
    }
  }
  get tris(): number {
    return this.p.length / 9;
  }
}

interface Lamp {
  x: number;
  y: number;
  z: number;
  col: RGB;
  i: number;
  r: number;
  wrap: number;
  /** Flame light flickers (baked into aFlame); steady light goes into colour. */
  flame: boolean;
}

/**
 * Bakes the light into a Kit's triangles: colour = albedo x (ambient +
 * steady lamps + daylight), aFlame.rgb = albedo x flame lamps (+ emission),
 * aFlame.w = wetness. Geometry comes out local to `origin`.
 */
/**
 * Final pass B: keeps only the triangles of a baked build-frame geometry whose
 * centre lies under the terrain (inside the rock) in the world frame.
 */
function insideRock(g: THREE.BufferGeometry, origin: THREE.Vector3): THREE.BufferGeometry {
  const pos = g.getAttribute("position");
  const n = pos.count / 3;
  const keep: number[] = [];
  for (let t = 0; t < n; t++) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let v = 0; v < 3; v++) {
      cx += pos.getX(t * 3 + v) / 3;
      cy += pos.getY(t * 3 + v) / 3;
      cz += pos.getZ(t * 3 + v) / 3;
    }
    const wx = cx + origin.x;
    const wz = caveMirrorZ(cz + origin.z);
    // And nothing in the last 40 before the opening (dress-gorge.ts's rockfall closes it).
    if (cy + origin.y < terrainHeight(wx, wz) - 0.5 && Math.hypot(wx - CAVE_EXIT_OPENING.x, wz - CAVE_EXIT_OPENING.z) > 40) keep.push(t);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const k = a.itemSize;
    const src = a.array as Float32Array;
    const dst = new Float32Array(keep.length * 3 * k);
    keep.forEach((t, i) => dst.set(src.subarray(t * 3 * k, (t + 1) * 3 * k), i * 3 * k));
    out.setAttribute(name, new THREE.BufferAttribute(dst, k));
  }
  g.dispose();
  return out;
}

function bake(kit: Kit, origin: THREE.Vector3, lamps: readonly Lamp[], ambientAt: (x: number, y: number, z: number) => RGB, dayAt: (x: number, y: number, z: number, ny: number) => number): THREE.BufferGeometry {
  const n = kit.p.length / 3;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const fl = new Float32Array(n * 4);
  const P = kit.p;
  for (let t = 0; t < n; t += 3) {
    const i0 = t * 3;
    const ux = P[i0 + 3] - P[i0];
    const uy = P[i0 + 4] - P[i0 + 1];
    const uz = P[i0 + 5] - P[i0 + 2];
    const vx = P[i0 + 6] - P[i0];
    const vy = P[i0 + 7] - P[i0 + 1];
    const vz = P[i0 + 8] - P[i0 + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    for (let v = 0; v < 3; v++) {
      const j = t + v;
      const x = P[j * 3];
      const y = P[j * 3 + 1];
      const z = P[j * 3 + 2];
      pos[j * 3] = x - origin.x;
      pos[j * 3 + 1] = y - origin.y;
      pos[j * 3 + 2] = z - origin.z;
      nor[j * 3] = nx;
      nor[j * 3 + 1] = ny;
      nor[j * 3 + 2] = nz;
      const amb = ambientAt(x, y, z);
      let sr = amb[0];
      let sg = amb[1];
      let sb = amb[2];
      let fr = 0;
      let fg = 0;
      let fb = 0;
      for (const L of lamps) {
        const dx = L.x - x;
        const dy = L.y - y;
        const dz = L.z - z;
        const far = L.r * 5;
        if (Math.abs(dx) > far || Math.abs(dy) > far || Math.abs(dz) > far) continue;
        const d = Math.max(0.5, Math.hypot(dx, dy, dz));
        if (d > far) continue;
        const face = L.wrap + (1 - L.wrap) * Math.max(0, (nx * dx + ny * dy + nz * dz) / d);
        const q = d / L.r;
        const k = (L.i * face * (1 - smooth(L.r * 3, far, d))) / (1 + q * q);
        if (L.flame) {
          fr += L.col[0] * k;
          fg += L.col[1] * k;
          fb += L.col[2] * k;
        } else {
          sr += L.col[0] * k;
          sg += L.col[1] * k;
          sb += L.col[2] * k;
        }
      }
      const day = dayAt(x, y, z, ny);
      sr += GLOW.day[0] * day;
      sg += GLOW.day[1] * day;
      sb += GLOW.day[2] * day;
      const ar = kit.c[j * 3];
      const ag = kit.c[j * 3 + 1];
      const ab = kit.c[j * 3 + 2];
      const wet = kit.w[j];
      // Wet faces take more of the flame light (a shine, read as wet), see the shader's fresnel.
      const fa = 1 + wet * 1.6;
      col[j * 3] = ar * sr;
      col[j * 3 + 1] = ag * sg;
      col[j * 3 + 2] = ab * sb;
      fl[j * 4] = ar * fr * fa + kit.e[j * 3];
      fl[j * 4 + 1] = ag * fg * fa + kit.e[j * 3 + 1];
      fl[j * 4 + 2] = ab * fb * fa + kit.e[j * 3 + 2];
      fl[j * 4 + 3] = wet;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aFlame", new THREE.BufferAttribute(fl, 4));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ── Shaders ──────────────────────────────────────────────────────────────────

const NOISE_GLSL = /* glsl */ `
float ugHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 ugHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float ugNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = ugHash(i), b = ugHash(i + vec2(1.0, 0.0)), c = ugHash(i + vec2(0.0, 1.0)), d = ugHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`;

const CELL_GLSL = /* glsl */ `
// Voronoi edge distance (F2 - F1), the cells' points turning with t.
float ugCell(vec2 p, float t) {
  vec2 i = floor(p); vec2 f = fract(p);
  float d1 = 8.0; float d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = ugHash2(i + g);
    o = 0.5 + 0.42 * sin(t + 6.2831 * o);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(d2) - sqrt(d1);
}`;

const WALL_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aFlame;
uniform mat4 uToBuild;
varying vec3 vCol;
varying vec4 vFlame;
varying vec3 vW;
varying vec3 vN;
varying vec3 vCamB;
void main() {
  vCol = color;
  vFlame = aFlame;
  vec4 w = modelMatrix * vec4(position, 1.0);
  // v6: position, normal and eye in the cave's BUILD frame (the ripples are authored there).
  vW = (uToBuild * w).xyz;
  vN = normalize(mat3(uToBuild) * mat3(modelMatrix) * normal);
  vCamB = (uToBuild * vec4(cameraPosition, 1.0)).xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WALL_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform float uGain;
uniform float uFlameK;
uniform vec4 uCaus;
uniform vec3 uCausCol;
uniform vec3 uSheen;
varying vec3 vCol;
varying vec4 vFlame;
varying vec3 vW;
varying vec3 vN;
varying vec3 vCamB;
${NOISE_GLSL}
${CELL_GLSL}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vCamB - vW);
  // One shared flicker; each torch's pool gets its own phase from where it is.
  float ph = floor(vW.x / 31.0) * 1.7 + floor(vW.z / 31.0) * 2.3 + floor(vW.y / 40.0) * 0.9;
  float fl = 0.86 + 0.09 * sin(uTime * 7.3 + ph) + 0.05 * sin(uTime * 17.9 + ph * 2.1);
  vec3 flame = vFlame.rgb * fl * uFlameK;
  vec3 col = vCol * uGain + flame;
  // Wet faces shine with the pool they sit in at a grazing look.
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += flame * fres * vFlame.w * 1.8;
  // The cave: cold ripples thrown by the curtain, and the lit water's sheen on wet rock.
  if (uCaus.w > 0.0) {
    float dz = uCaus.z - vW.z;
    float m = 1.0 - smoothstep(0.0, ${CAUSTIC.reach.toFixed(1)}, dz);
    m = m * m * step(-8.0, dz) * (1.0 - smoothstep(50.0, 90.0, abs(vW.x - uCaus.x))) * (1.0 - smoothstep(40.0, 85.0, vW.y - uCaus.y + 34.0));
    if (m > 0.002) {
      vec2 q = abs(N.y) > 0.6 ? vW.xz : (abs(N.x) > abs(N.z) ? vW.zy : vW.xy);
      q *= 0.11;
      q += 0.45 * vec2(ugNoise(q * 0.45 + uTime * 0.12), ugNoise(q * 0.45 + 5.0 - uTime * 0.1));
      float e1 = ugCell(q + vec2(0.0, uTime * 0.32), uTime * 1.3);
      float e2 = ugCell(q * 1.37 + vec2(uTime * 0.19, -uTime * 0.15) + 3.1, uTime * 1.05 + 2.0);
      // Patchy: the ripples come and go in broad soft pools of light, never as
      // a net of thin lines (fix-2: the thin network read as a pale spider web).
      float c = (1.0 - smoothstep(0.04, 0.42, min(e1, e2))) * smoothstep(0.45, 0.9, ugNoise(q * 0.22 + uTime * 0.06)) * 0.8;
      vec3 L = normalize(uCaus.xyz - vW);
      float face = 0.3 + 0.7 * max(0.0, dot(N, L));
      col += uCausCol * uCaus.w * m * face * c;
      vec3 R = reflect(-V, N);
      float s = pow(max(0.0, dot(R, L)), mix(6.0, 24.0, vFlame.w));
      col += uSheen * s * m * (0.12 + 0.9 * vFlame.w);
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** Additive glow sprites (bible 4.6 E1 halo, E2 flame, E6 dust, E9 ray card). */
const GLOW_VERT = /* glsl */ `
#include <common>
attribute vec3 aP;
attribute vec3 aAx;
attribute vec4 aD; // size, kind (+10 = rides the cage), seed, intensity
attribute vec3 aC;
uniform float uTime;
uniform float uCage;
uniform vec2 uFade;
varying vec2 vUv;
varying float vKind;
varying vec3 vC;
varying float vA;
void main() {
  float size = aD.x;
  float ride = step(9.5, aD.y);
  float kind = aD.y - 10.0 * ride;
  float seed = aD.z;
  vec3 P = aP;
  P.y += uCage * ride;
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec2 q = position.xy;
  vec3 W;
  float a = aD.w;
  float dist;
  if (kind < 0.5) {
    // Flame: rises from its base and flickers by scale, leaning a little.
    float fl = 0.84 + 0.12 * sin(uTime * 13.0 + seed * 6.3) + 0.08 * sin(uTime * 29.0 + seed * 3.1);
    vec3 toC = normalize(cameraPosition - P);
    vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), toC) + vec3(1e-4, 0.0, 0.0));
    float h = q.y + 0.5;
    W = P + r * q.x * size * 0.55 + vec3(0.0, 1.0, 0.0) * h * size * fl;
    W += r * 0.1 * size * sin(uTime * 9.0 + seed * 4.0) * h;
    dist = length(cameraPosition - P);
  } else if (kind < 1.5) {
    float fl = 0.9 + 0.08 * sin(uTime * 11.0 + seed * 6.3) + 0.04 * sin(uTime * 23.0 + seed);
    W = P + (camR * q.x + camU * q.y) * size;
    dist = length(cameraPosition - P);
    a *= fl * smoothstep(size * 0.25, size * 0.9, dist);
  } else if (kind < 2.5) {
    // Dust mote: drifts in its little volume (aAx) and turns in and out of the light.
    P += vec3(sin(uTime * 0.13 + seed * 6.3), sin(uTime * 0.09 + seed * 3.7), cos(uTime * 0.11 + seed * 5.1)) * aAx;
    W = P + (camR * q.x + camU * q.y) * size;
    dist = length(cameraPosition - P);
    a *= (0.45 + 0.55 * sin(uTime * 0.7 + seed * 9.0)) * smoothstep(3.0, 10.0, dist);
  } else if (kind > 3.5 && kind < 4.5) {
    // Final pass D: a pool of lamp light lying flat on the floor (a disc in
    // the ground plane), so the hall reads as lit places and dark rock.
    // (-q.y: the quad faces up; the glow draws front faces only.)
    W = P + vec3(q.x, 0.0, -q.y) * size;
    dist = length(cameraPosition - P);
    a *= 0.94 + 0.06 * sin(uTime * 7.3 + seed * 6.3);
  } else if (kind > 4.5) {
    // Final pass D: a drip falling from the roof (aAx.y: the drop), a short
    // bright bead catching the lamps, then a pause before the next.
    float cyc = fract(uTime * 0.23 + seed * 7.1);
    float fallT = clamp(cyc * 2.2, 0.0, 1.0);
    P.y -= aAx.y * fallT * fallT;
    vec3 toC = normalize(cameraPosition - P);
    vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), toC) + vec3(1e-4, 0.0, 0.0));
    W = P + r * q.x * size + vec3(0.0, 1.0, 0.0) * q.y * size * (1.0 + 4.0 * fallT);
    dist = length(cameraPosition - P);
    a *= step(cyc, 0.46) * smoothstep(0.0, 0.05, cyc);
  } else {
    // Ray card along aAx, turned about its own axis to face the camera.
    float len = length(aAx);
    vec3 axn = aAx / len;
    vec3 rel = cameraPosition - P;
    float along = dot(rel, axn);
    vec3 perpV = rel - axn * along;
    float perp = length(perpV);
    vec3 r = normalize(cross(axn, perpV / max(perp, 1e-3)) + vec3(0.0, 1e-4, 0.0));
    W = P + aAx * (q.y + 0.5) + r * q.x * size;
    dist = length(rel - axn * clamp(along, 0.0, len));
    // Fades out when the camera stands in the beam.
    a *= smoothstep(size * 0.5, size * 1.5, perp);
  }
  a *= 1.0 - smoothstep(uFade.x, uFade.y, dist);
  vUv = q + 0.5;
  vKind = kind;
  vC = aC;
  vA = a;
  vec4 mvPosition = viewMatrix * vec4(W, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}`;

const GLOW_FRAG = /* glsl */ `
#include <common>
varying vec2 vUv;
varying float vKind;
varying vec3 vC;
varying float vA;
void main() {
  vec2 q = vUv - 0.5;
  vec3 col = vC;
  float a;
  if (vKind < 0.5) {
    float y = vUv.y;
    float w = 0.46 * sin(3.14159 * pow(clamp(y, 0.0, 1.0), 0.55)) * (1.0 - 0.35 * y);
    a = 1.0 - smoothstep(w * 0.55, w + 0.02, abs(q.x));
    float core = (1.0 - smoothstep(0.0, w * 0.6, abs(q.x))) * (1.0 - smoothstep(0.25, 0.7, y));
    col = mix(vC, vec3(${GLOW.torchCore.map((v) => v.toFixed(2)).join(", ")}), core);
    a *= smoothstep(0.0, 0.08, y);
  } else if (vKind < 1.5) {
    float r = length(q) * 2.0;
    a = exp(-r * r * 4.0) * (1.0 - smoothstep(0.75, 1.0, r));
  } else if (vKind < 2.5) {
    float r = length(q) * 2.0;
    a = 1.0 - smoothstep(0.15, 1.0, r);
  } else if (vKind > 3.5 && vKind < 4.5) {
    // A painted pool: a bright core and a wider soft rim.
    float r = length(q) * 2.0;
    a = (1.0 - smoothstep(0.0, 0.55, r)) * 0.5 + (1.0 - smoothstep(0.35, 1.0, r)) * 0.5;
  } else if (vKind > 4.5) {
    float r = length(q * vec2(2.0, 1.0)) * 2.0;
    a = 1.0 - smoothstep(0.2, 1.0, r);
  } else {
    float across = abs(q.x) * 2.0;
    float along = vUv.y;
    a = (1.0 - smoothstep(0.1, 1.0, across)) * smoothstep(0.0, 0.05, along) * (0.3 + 0.7 * pow(1.0 - along, 1.3)) * (1.0 - smoothstep(0.93, 1.0, along));
  }
  a *= vA;
  if (a < 0.002) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Mist cards (bible 4.6 E7): soft lit puffs, alpha blended, fogged. */
const MIST_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 aP;
attribute vec4 aD; // size, seed, rate, alpha
attribute vec3 aC; // sun share, glow share, rise
uniform float uTime;
varying vec2 vUv;
varying float vA;
varying float vSeed;
varying vec3 vK;
void main() {
  float size = aD.x;
  float seed = aD.y;
  float age = fract(uTime * aD.z + seed);
  vec3 P = aP + vec3(sin(seed * 40.0) * 0.5, aC.z, cos(seed * 40.0) * 0.5) * age * size * 0.7;
  float s = size * (0.75 + 0.5 * age);
  float a = sin(age * 3.14159) * aD.w;
  vec4 mvPosition = viewMatrix * vec4(P, 1.0);
  mvPosition.xy += position.xy * s;
  // A card the camera is in or near would fill the screen: it thins out first.
  a *= smoothstep(s * 0.35, s * 1.4, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  // Pass 3: outdoor spray keeps to the lower fifth of the frame (a puff in the
  // middle of the view whited out the pool shot); the cave's glow haze is exempt.
  a *= mix(1.0 - smoothstep(-0.62, -0.2, gl_Position.y / max(gl_Position.w, 0.001)), 1.0, aC.y);
  vUv = position.xy + 0.5;
  vA = a;
  vSeed = seed;
  vK = aC;
  #include <fog_vertex>
}`;

const MIST_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uGlowC;
varying vec2 vUv;
varying float vA;
varying float vSeed;
varying vec3 vK;
${NOISE_GLSL}
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;
  float n = ugNoise(q * 3.5 + vSeed * 17.0 + uTime * 0.04) * 0.65 + ugNoise(q * 8.0 - vSeed * 5.0) * 0.35;
  float a = 1.0 - smoothstep(0.1, 1.0, r + (n - 0.5) * 0.55);
  a = a * a * vA;
  if (a < 0.003) discard;
  vec3 col = mix(uShade, uLit, vK.x * (0.7 + 0.3 * (0.5 - q.y)));
  col = mix(col, uGlowC, vK.y);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// ── Install ──────────────────────────────────────────────────────────────────

export const install: InstallFn = (ctx: WorldCtx) => {
  const t0 = performance.now();
  const reduced = !!ctx.reducedMotion;
  const scene = ctx.scene;
  const u = makeUnits();
  const disposables: { dispose(): void }[] = [];
  const track = <X extends { dispose(): void }>(x: X): X => {
    disposables.push(x);
    return x;
  };
  const stats: Record<string, number | string> = {};

  // ── Find what we replace ──
  const find = (name: string) => scene.getObjectByName(name) ?? null;
  const shells: Record<string, THREE.Mesh | null> = {};
  for (const n of ["Mine_Cave", "Mine_Tunnel", "Mine_Shaft"]) {
    const o = find(n) as THREE.Mesh | null;
    shells[n] = o && o.isMesh ? o : null;
  }
  const hidden: THREE.Object3D[] = [];
  for (const n of REPLACED) {
    const o = find(n);
    if (o && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  }
  stats.replaced = hidden.map((o) => o.name).join(",");

  // ── The tunnel's path (blocks.ts's `at`, without the mitres) ──
  const segLen: number[] = [];
  let L = 0;
  for (let i = 0; i < TUNNEL.length - 1; i++) {
    const l = Math.hypot(TUNNEL[i + 1][0] - TUNNEL[i][0], TUNNEL[i + 1][2] - TUNNEL[i][2]);
    segLen.push(l);
    L += l;
  }
  const at = (a: number) => {
    let i = 0;
    let acc = 0;
    while (i < segLen.length - 1 && a > acc + segLen[i]) acc += segLen[i++];
    const p = TUNNEL[i];
    const q = TUNNEL[i + 1];
    const t = (a - acc) / segLen[i];
    const dx = (q[0] - p[0]) / segLen[i];
    const dz = (q[2] - p[2]) / segLen[i];
    return { x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t + FLOOR_LIFT, z: p[2] + (q[2] - p[2]) * t, dx, dz, rx: -dz, rz: dx };
  };

  // ── Lamps ──
  const lamps: Lamp[] = [];
  // v6: sprites are given in the cave's build frame and moved into the world
  // below, except those flagged `world` (the amber shafts in the gorge).
  const glowInst: { p: V3; ax: V3; size: number; kind: number; seed: number; i: number; c: RGB; world?: boolean }[] = [];
  const sprite = (p: V3, kind: number, size: number, c: RGB, i = 1, ax: V3 = [0, 0, 0], world = false) =>
    glowInst.push({ p, ax, size, kind, seed: rnd(glowInst.length, 17), i, c, world });
  const cave = new Kit(u);
  const tunnel = new Kit(u);

  /** A wall torch (P12 + E2 + E1): bracket and cup into `kit`, flame and halo sprites, a baked pool. */
  const torch = (kit: Kit, x: number, y: number, z: number, ox: number, oz: number) => {
    kit.beam([x - ox * 1.3, y - 2.75, z - oz * 1.3], [x + ox * 0.65, y + 0.45, z + oz * 0.65], 0.8, 0.8, PAL.iron);
    kit.add(u.cyl6, T(x + ox * 0.7, y + 0.62, z + oz * 0.7, 0.85, 1.26, 0.85), PAL.iron, { vary: 0 });
    kit.add(u.cyl6, T(x + ox * 0.7, y + 1.15, z + oz * 0.7, 0.55, 0.3, 0.55), PAL.iron, { emit: [1.4, 0.45, 0.1], vary: 0 });
    const fx = x + ox * 0.7;
    const fz = z + oz * 0.7;
    sprite([fx, y + 1.0, fz], 0, 4.6, GLOW.torch, 1);
    sprite([fx, y + 2.6, fz], 1, 13, GLOW.halo, 0.55);
    for (let k = 0; k < 3; k++) sprite([fx + ox * (4 + k * 3), y - 2 - k * 3, fz + oz * (4 + k * 3)], 2, 0.35, [1.6, 0.9, 0.45], 0.8, [4, 3, 4]);
    lamps.push({ x: x + ox * 2.2, y: y + 3, z: z + oz * 2.2, col: TORCH.col, i: TORCH.i, r: TORCH.r, wrap: TORCH.wrap, flame: true });
  };

  /**
   * Pass 3: a caged lantern (the cream cubes read as street lamps): amber glass
   * a little smaller than the housing, iron corner bars and bands over it, a cap
   * and a flame sprite inside, so it reads as a lantern at thumbnail size.
   */
  const lanternHead = (kit: Kit, x: number, y: number, z: number, w: number, hh: number, flameKind = 0) => {
    kit.add(u.box, T(x, y, z, w, hh, w), PAL.iron, { emit: [1.25, 0.52, 0.14], vary: 0 });
    const e = w / 2 + 0.12;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) kit.add(u.box, T(x + sx * e, y, z + sz * e, 0.36, hh + 0.3, 0.36), PAL.iron, { vary: 0 });
    for (const by of [-hh / 2, 0, hh / 2]) kit.add(u.box, T(x, y + by, z, w + 0.5, 0.3, w + 0.5), PAL.iron, { vary: 0 });
    kit.add(u.cone6, T(x, y + hh / 2 + 0.7, z, w * 0.6, 1.2, w * 0.6), PAL.iron, { vary: 0 });
    sprite([x, y - hh * 0.15, z], flameKind, Math.max(1.6, w * 0.8), GLOW.torch, 0.9);
  };

  // v6: the side passage's torches, blocks.ts's two (their brackets are gone with its shell).
  // v6 (B7): no wall torches in the side passage: torches on brackets read as
  // the mine Lovro rejected. Daylight from the exit lights it (dayAt below).
  const blockTorches: number[] = [];
  const torchAt: [number, number][] = [];
  blockTorches.forEach((a, k) => {
    const sg = k % 2 ? -1 : 1;
    if (k > 0) {
      const a0 = blockTorches[k - 1];
      const n = Math.max(0, Math.round((a - a0) / TORCH.spacing) - 1);
      for (let j = 1; j <= n; j++) torchAt.push([a0 + ((a - a0) * j) / (n + 1), j % 2 ? sg : -sg]);
    }
    torchAt.push([a, sg]);
  });
  for (const [a, sg] of torchAt) {
    const f = at(a);
    torch(tunnel, f.x + f.rx * sg * 11.6, f.y + 15, f.z + f.rz * sg * 11.6, -f.rx * sg, -f.rz * sg);
  }
  stats.torches = torchAt.length;
  // Pass 3: break the tunnel's flat brown walls into rock facets (value and hue
  // +-15 percent a face, tilted so each takes its own torch light), clear of the torches.
  {
    const torchA = torchAt.map(([a]) => a);
    // v6: warm grey-brown sandstone (the gorge's own rock), lit by the exit's daylight.
    const tints: RGB[] = [
      [0.2, 0.15, 0.115],
      [0.16, 0.125, 0.1],
      [0.24, 0.18, 0.13],
    ];
    let seed = 500;
    for (let a = 14; a < L - 16; a += 8.5) {
      for (const sg of [-1, 1]) {
        for (const yy of [4.5, 12.5]) {
          seed++;
          if (yy > 10 && torchA.some((t) => Math.abs(t - a) < 6)) continue;
          const f = at(a + (rnd(seed, 61) - 0.5) * 3);
          const w = 6 + rnd(seed, 62) * 4;
          const hgt = 5.5 + rnd(seed, 63) * 3.5;
          const v = 0.65 + rnd(seed, 64) * 0.7;
          const t = tints[Math.floor(rnd(seed, 65) * 3)];
          const c: RGB = [t[0] * v, t[1] * v, t[2] * v];
          const yaw = Math.atan2(-f.dz, f.dx);
          tunnel.add(u.dode, T(f.x + f.rx * sg * 11.8, f.y + yy + (rnd(seed, 66) - 0.5) * 2.5, f.z + f.rz * sg * 11.8, w * 0.75, hgt * 0.8, 3.4, yaw + (rnd(seed, 67) - 0.5) * 0.6, (rnd(seed, 68) - 0.5) * 0.6, (rnd(seed, 69) - 0.5) * 0.5), c, { vary: 0.18 });
        }
      }
    }
  }

  // The cave's lantern (blocks.ts's post stays in the shell; its glass was in Mine_Flames).
  const LX = -132;
  const LY = CAVE.floorY + 18.6;
  const LZ = 1266;
  // Glass panes just outside blocks.ts's housing box (which is solid), its cap and base left showing.
  lanternHead(cave, LX, LY, LZ, 3.05, 2.7);
  sprite([LX, LY, LZ], 1, 20, [1.0, 0.55, 0.22], 1.0);
  sprite([LX, CAVE.floorY + 1, LZ], 1, 30, [0.5, 0.26, 0.1], 0.5);
  lamps.push({ x: LX + 0.5, y: LY, z: LZ - 1, col: [1.0, 0.64, 0.32], i: 2.6, r: 24, wrap: 0.3, flame: true });
  // The curtain as a light: 9 samples over the mouth.
  for (const sx of [-32, 0, 32]) for (const sy of [8, 30, 52]) lamps.push({ x: CAVE.x + sx, y: CAVE.floorY + sy, z: CAVE.footZ - 3, col: CURTAIN_LIGHT.col, i: CURTAIN_LIGHT.i, r: CURTAIN_LIGHT.r, wrap: 0.1, flame: false });
  // Where that light lands: a broad cool patch on the far wall and floor, so crossing the curtain never goes to black.
  lamps.push({ x: CAVE.x + 10, y: CAVE.floorY + 34, z: CAVE.hallZ - 30, col: CURTAIN_LIGHT.col, i: 0.5, r: 70, wrap: 0.25, flame: false });

  // ── Cave dressing ──
  const fy = CAVE.floorY;
  // A pack and a coil of rope by the lantern post.
  cave.add(u.box, T(LX + 7, fy + 2.6, LZ + 4, 4.2, 5.2, 3, 0.5), PAL.canvas);
  cave.add(u.cyl8, T(LX + 7, fy + 5.9, LZ + 4, 1.3, 4.6, 1.3, 0.5, 0, Math.PI / 2), [0.22, 0.12, 0.07]);
  for (let k = 0; k < 3; k++) cave.add(u.torus, T(LX - 4, fy + 0.5 + k * 0.55, LZ + 8, 2.6 - k * 0.2, 2.6 - k * 0.2, 2.6 - k * 0.2, k, Math.PI / 2), PAL.rope, { vary: 0.05 });
  // Wet rock sheets on the gorge strata (18 degrees, dipping east) round the mouth.
  for (let k = 0; k < 8; k++) {
    const th = (k < 4 ? 0.95 - k * 0.14 : 2.19 + (k - 4) * 0.14) * 1;
    const r = 1.0;
    const x = CAVE.hallX + CAVE.rx * r * Math.cos(th);
    const z = CAVE.hallZ + CAVE.rz * r * Math.sin(th);
    const y = fy + 10 + rnd(k, 5) * 30;
    cave.add(u.dode, T(x, y, z, 8 + rnd(k, 6) * 4, 3, 5 + rnd(k, 7) * 3, -th + Math.PI / 2, 0, 18 * (Math.PI / 180)), PAL.caveRock, { wet: 0.6 });
  }
  // Ferns and moss only near the mouth.
  for (let k = 0; k < 16; k++) {
    const side = k % 2 ? -1 : 1;
    const x = CAVE.x + side * (22 + rnd(k, 11) * 18);
    const z = CAVE.footZ - 4 - rnd(k, 12) * 18;
    const s = 2.5 + rnd(k, 13) * 3;
    for (let f = 0; f < 5; f++) {
      const a = (f / 5) * Math.PI * 2 + rnd(k, 14);
      const tip: V3 = [x + Math.cos(a) * s * 1.6, fy + s * 0.9, z + Math.sin(a) * s * 1.6];
      const l: V3 = [x + Math.cos(a + 0.35) * s * 0.4, fy + 0.3, z + Math.sin(a + 0.35) * s * 0.4];
      const r: V3 = [x + Math.cos(a - 0.35) * s * 0.4, fy + 0.3, z + Math.sin(a - 0.35) * s * 0.4];
      cave.tri(l, tip, r, PAL.fern, 0.3);
      cave.tri(r, tip, l, PAL.fern, 0.3);
    }
  }
  // Puddles catching the curtain's glow (a dark glossy plane, bible 6 a3). Heights found on the shell.
  const caveShell = shells.Mine_Cave;
  const ray = new THREE.Raycaster();
  const floorAt = (x: number, z: number, fallback: number) => {
    if (!caveShell) return fallback;
    caveShell.updateMatrixWorld(true);
    // The shell hangs under the mirror: cast in the world, at the mirrored z.
    ray.set(_a.set(x, fy + 30, caveMirrorZ(z)), _b.set(0, -1, 0));
    ray.far = 60;
    const was = caveShell.visible;
    caveShell.visible = true;
    const hit = ray.intersectObject(caveShell, false)[0];
    caveShell.visible = was;
    return hit ? hit.point.y : fallback;
  };
  const puddle = (kit: Kit, x: number, z: number, r: number, seed: number, yAt: (x: number, z: number) => number) => {
    const n = 9;
    const pts: V3[] = [];
    let top = -Infinity;
    let low = Infinity;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = r * (0.65 + 0.5 * rnd(k, seed));
      const px = x + Math.cos(a) * rr * 1.3;
      const pz = z + Math.sin(a) * rr;
      pts.push([px, 0, pz]);
      const h = yAt(px, pz);
      top = Math.max(top, h);
      low = Math.min(low, h);
    }
    const hc = yAt(x, z);
    top = Math.max(top, hc);
    low = Math.min(low, hc);
    // fix-2: a puddle over a step in the floor took the step's top and hung in
    // mid air over the lower side (seen edge on at a3 as a dark "grass blade").
    // Only flat floor gets one.
    if (top - low > 1.5) return;
    top += 0.14;
    const c: V3 = [x, top, z];
    for (let k = 0; k < n; k++) {
      const p0: V3 = [pts[k][0], top, pts[k][2]];
      const p1: V3 = [pts[(k + 1) % n][0], top, pts[(k + 1) % n][2]];
      kit.tri(c, p1, p0, PAL.puddle, 1);
    }
  };
  for (const [x, z, r] of [[-78, 1268, 9], [-116, 1248, 6.5], [-58, 1286, 5], [-96, 1232, 4.5], [-128, 1284, 5]] as const) puddle(cave, x, z, r, x + z, (px, pz) => floorAt(px, pz, fy + 1));
  // A miners' corner at the hall's north-west end: the walk in from the curtain
  // (keys 20-22, looking north) meets two warm lantern pools instead of black.
  // Both stand 55+ off the camera's way (the a3 camera looks south, away from them).
  for (const [hx, hz, k] of [[-130, 1146, 0], [-150, 1190, 1]] as const) {
    const gy = floorAt(hx, hz, fy);
    cave.add(u.box, T(hx, gy + 11, hz, 1.5, 22, 1.5), PAL.timber);
    cave.add(u.box, T(hx + 2.6, gy + 21.5, hz, 6.4, 0.9, 0.9), PAL.timber);
    lanternHead(cave, hx + 5, gy + 18.6, hz, 2.4, 2.8);
    sprite([hx + 5, gy + 18.6, hz], 1, 20, [1.0, 0.55, 0.22], 1.0);
    sprite([hx + 5, gy + 1, hz], 1, 30, [0.5, 0.26, 0.1], 0.5);
    lamps.push({ x: hx + 5, y: gy + 17, z: hz + 2, col: [1.0, 0.64, 0.32], i: 2.4, r: 13, wrap: 0.3, flame: true });
    cave.add(u.box, T(hx - 5, gy + 2.2, hz + 4, 4.4, 4.4, 4.4, 0.3 + k), PAL.timber);
    cave.add(u.box, T(hx - 6, gy + 5.9, hz + 3.5, 3, 3, 3, 0.9 + k), PAL.timber);
    cave.add(u.box, T(hx + 7, gy + 0.6, hz + 6, 9, 1.2, 3.4, 0.2 + k), PAL.canvas);
  }
  // Final pass: the hall's east side was one dark wall where the camera turns
  // for the side passage. Two more post lanterns there, either side of the
  // passage's mouth, 28+ off the camera's way, their pools baked like the rest.
  for (const [hx, hz] of [[-36, 1170], [-30, 1255]] as const) {
    const gy = floorAt(hx, hz, fy);
    cave.add(u.box, T(hx, gy + 11, hz, 1.5, 22, 1.5), PAL.timber);
    cave.add(u.box, T(hx - 2.6, gy + 21.5, hz, 6.4, 0.9, 0.9), PAL.timber);
    lanternHead(cave, hx - 5, gy + 18.6, hz, 2.4, 2.8);
    sprite([hx - 5, gy + 18.6, hz], 1, 20, [1.0, 0.55, 0.22], 1.0);
    sprite([hx - 5, gy + 1, hz], 1, 30, [0.5, 0.26, 0.1], 0.5);
    lamps.push({ x: hx - 5, y: gy + 17, z: hz, col: [1.0, 0.64, 0.32], i: 2.6, r: 16, wrap: 0.3, flame: true });
  }
  // Detail pass 3: a hidden camp between the two lanterns (keys 20.6 and 21.6
  // walk in on it): an A-frame tent, a fire pit with embers under a pot, a
  // bedroll and blanket, a barrel, a pickaxe, rope, and puddles catching the
  // glow. All 40+ off the camera's way; the a3 camera looks the other way.
  {
    const wool: RGB = [0.16, 0.045, 0.03];
    const stone: RGB = [0.1, 0.1, 0.105];
    // The tent: two sloped canvas sheets, a ridge pole, poles at each end.
    const tx = -166;
    const tz = 1166;
    const tg = floorAt(tx, tz, fy);
    const tLen = 17;
    const tHalf = 7.5;
    const tH = 10;
    const tyaw = 0.55; // ridge runs roughly north-south, the open end toward the fire
    const ca = Math.cos(tyaw);
    const sa = Math.sin(tyaw);
    const P = (along: number, across: number, up: number): V3 => [tx + along * sa + across * ca, tg + up, tz + along * ca - across * sa];
    for (const s of [-1, 1]) {
      const a0 = P(-tLen / 2, 0, tH);
      const a1 = P(tLen / 2, 0, tH);
      const b0 = P(-tLen / 2, s * tHalf, 0.2);
      const b1 = P(tLen / 2, s * tHalf, 0.2);
      cave.tri(a0, b0, b1, PAL.canvas);
      cave.tri(a0, b1, a1, PAL.canvas);
      cave.tri(b1, b0, a0, [PAL.canvas[0] * 0.7, PAL.canvas[1] * 0.7, PAL.canvas[2] * 0.7]);
      cave.tri(a1, b1, a0, [PAL.canvas[0] * 0.7, PAL.canvas[1] * 0.7, PAL.canvas[2] * 0.7]);
    }
    // The back end closed, the front open (a dark mouth reads as a tent).
    {
      const r0 = P(-tLen / 2, 0, tH);
      const l = P(-tLen / 2, -tHalf, 0.2);
      const r = P(-tLen / 2, tHalf, 0.2);
      cave.tri(r0, l, r, [0.2, 0.17, 0.12]);
      cave.tri(r0, r, l, [0.2, 0.17, 0.12]);
    }
    cave.beam(P(-tLen / 2 - 1, 0, tH + 0.3), P(tLen / 2 + 1.2, 0, tH + 0.3), 0.5, 0.5, PAL.timber);
    for (const e of [-tLen / 2 - 0.6, tLen / 2 + 0.8]) cave.beam(P(e, 0, 0), P(e, 0, tH + 0.9), 0.45, 0.45, PAL.timber);
    // Guy ropes to pegs.
    for (const s of [-1, 1]) cave.beam(P(tLen / 2 + 0.8, 0, tH + 0.2), P(tLen / 2 + 5, s * 3, 0.2), 0.12, 0.12, PAL.rope);
    // The bedroll in the mouth and a wool blanket spilling out.
    cave.add(u.cyl8, T(...P(tLen / 2 - 3, -2.4, 0.9), 1.1, 5.5, 1.1, tyaw + Math.PI / 2, 0, Math.PI / 2), [0.26, 0.2, 0.13]);
    cave.add(u.box, T(...P(tLen / 2 + 2.2, 1.5, 0.35), 6.5, 0.5, 4.2, tyaw + 0.25, 0, 0.06), wool, { vary: 0.1 });
    // The fire pit: a ring of stones, crossed logs, embers, a pot on a tripod.
    const fx = -140;
    const fz = 1170;
    const fg = floorAt(fx, fz, fy);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      cave.add(u.dode, T(fx + Math.cos(a) * 3.6, fg + 0.5, fz + Math.sin(a) * 3.6, 1.2 + rnd(k, 71) * 0.5, 0.85, 1.1, k), stone, { vary: 0.25 });
    }
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + 0.4;
      cave.beam([fx - Math.cos(a) * 2.6, fg + 0.35, fz - Math.sin(a) * 2.6], [fx + Math.cos(a) * 2.6, fg + 1.1, fz + Math.sin(a) * 2.6], 0.65, 0.65, PAL.timberDark, { emit: [0.9, 0.22, 0.04] });
    }
    for (let k = 0; k < 5; k++) cave.add(u.dode, T(fx + (rnd(k, 72) - 0.5) * 2.6, fg + 0.3, fz + (rnd(k, 73) - 0.5) * 2.6, 0.55, 0.3, 0.55, k), [0.05, 0.02, 0.01], { emit: [2.2, 0.7, 0.12], vary: 0.3 });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3;
      cave.beam([fx + Math.cos(a) * 3.4, fg, fz + Math.sin(a) * 3.4], [fx, fg + 7.6, fz], 0.3, 0.3, PAL.timber);
    }
    cave.beam([fx, fg + 7.4, fz], [fx, fg + 5.4, fz], 0.1, 0.1, PAL.iron);
    cave.add(u.cyl8, T(fx, fg + 4.3, fz, 1.3, 2.2, 1.3), PAL.iron, { wet: 0.3 });
    sprite([fx, fg + 1.6, fz], 0, 3.4, GLOW.torch, 1);
    sprite([fx + 0.6, fg + 1.2, fz - 0.4], 0, 2.4, GLOW.torch, 0.8);
    sprite([fx, fg + 2.5, fz], 1, 16, GLOW.halo, 0.6);
    for (let k = 0; k < 4; k++) sprite([fx + (rnd(k, 74) - 0.5) * 2, fg + 4 + k * 2.2, fz + (rnd(k, 75) - 0.5) * 2], 2, 0.3, [1.6, 0.7, 0.2], 0.9, [1.5, 4, 1.5]);
    lamps.push({ x: fx, y: fg + 3, z: fz, col: [1.0, 0.55, 0.24], i: 2.6, r: 9, wrap: 0.3, flame: true });
    // A barrel and a sack by the tent, a pickaxe against the barrel, a coil of rope.
    const bx = -154;
    const bz = 1186;
    const bg = floorAt(bx, bz, fy);
    cave.add(u.cyl8, T(bx, bg + 3, bz, 2.4, 6, 2.4), PAL.timber, { vary: 0.1 });
    for (const hy of [0.9, 5.1]) cave.add(u.cyl8, T(bx, bg + hy, bz, 2.5, 0.35, 2.5), PAL.iron, { vary: 0 });
    cave.add(u.dode, T(bx + 3.8, bg + 1.8, bz - 1.5, 2, 2.2, 1.8, 0.4), PAL.canvas, { vary: 0.1 });
    cave.beam([bx + 2.6, bg + 0.2, bz + 2.5], [bx + 1.8, bg + 7.4, bz + 1.2], 0.45, 0.45, PAL.timber);
    cave.beam([bx + 0.6, bg + 7.2, bz + 1.4], [bx + 3.2, bg + 7.6, bz + 0.9], 0.55, 0.75, PAL.iron, { wet: 0.5 });
    for (let k = 0; k < 3; k++) cave.add(u.torus, T(-128, floorAt(-128, 1180, fy) + 0.4 + k * 0.5, 1180, 2.1 - k * 0.2, 2.1 - k * 0.2, 2.1 - k * 0.2, k, Math.PI / 2), PAL.rope, { vary: 0.05 });
    // Puddles catching the fire and the lanterns.
    for (const [x, z, r] of [[-126, 1160, 3.6], [-147, 1154, 2.6], [-120, 1188, 2.4]] as const) puddle(cave, x, z, r, x * 3 + z, (px, pz) => floorAt(px, pz, fy + 1));
    // The supply cache against the north wall: the right half of the key-20.6
    // frame (the panel covers the left), 31+ off the camera's way, behind the a3 camera.
    const nx = -84;
    const nz = 1136;
    const ng = floorAt(nx, nz, fy);
    cave.add(u.box, T(nx, ng + 10, nz, 1.3, 20, 1.3), PAL.timber);
    cave.add(u.box, T(nx + 2.4, ng + 19.4, nz, 5.8, 0.8, 0.8), PAL.timber);
    lanternHead(cave, nx + 4.6, ng + 16.8, nz, 2.2, 2.6);
    sprite([nx + 4.6, ng + 16.8, nz], 1, 18, [1.0, 0.55, 0.22], 0.9);
    lamps.push({ x: nx + 4.6, y: ng + 15, z: nz + 2, col: [1.0, 0.64, 0.32], i: 2.2, r: 12, wrap: 0.3, flame: true });
    cave.add(u.box, T(nx - 6, ng + 2.5, nz - 1, 5, 5, 5, 0.25), PAL.timber, { vary: 0.2 });
    cave.add(u.box, T(nx - 10.5, ng + 2.2, nz + 1.5, 4.4, 4.4, 4.4, -0.2), PAL.timberDark, { vary: 0.2 });
    cave.add(u.box, T(nx - 7.8, ng + 6.9, nz, 4, 4, 4, 0.6), PAL.timber, { vary: 0.2 });
    cave.add(u.cyl8, T(nx + 9, ng + 3, nz + 1, 2.3, 6, 2.3), PAL.timber, { vary: 0.1 });
    for (const hy of [0.9, 5.1]) cave.add(u.cyl8, T(nx + 9, ng + hy, nz + 1, 2.4, 0.35, 2.4), PAL.iron, { vary: 0 });
    cave.add(u.dode, T(nx + 4.5, ng + 1.6, nz + 4, 2.2, 2, 1.8, 1.1), PAL.canvas, { vary: 0.1 });
    // A shovel and a pickaxe against the crates.
    cave.beam([nx - 3.2, ng + 0.3, nz + 3.2], [nx - 4.2, ng + 9, nz + 1.4], 0.4, 0.4, PAL.timber);
    cave.add(u.box, T(nx - 3.1, ng + 1.2, nz + 3.3, 2, 2.6, 0.3, 0.4, 0.2), PAL.iron, { wet: 0.4 });
    cave.beam([nx + 6.6, ng + 0.3, nz + 3.6], [nx + 7.2, ng + 7.4, nz + 1.8], 0.42, 0.42, PAL.timber);
    cave.beam([nx + 5.6, ng + 7.2, nz + 2], [nx + 8.8, ng + 7.6, nz + 1.6], 0.55, 0.75, PAL.iron, { wet: 0.5 });
    puddle(cave, nx + 1, nz + 10, 3.2, 777, (px, pz) => floorAt(px, pz, fy + 1));
    // A line of small lanterns strung along the west and north walls at eye
    // height: the camp's glow across the far wall in the walk-in frames (the
    // floor is below a level 31-degree frame until ~95 out). 40+ off the path.
    const line: V3[] = [
      [-166, fy + 36, 1236],
      [-150, fy + 34, 1160],
      [-100, fy + 35, 1140],
    ];
    let li = 0;
    for (let sgm = 0; sgm < line.length - 1; sgm++) {
      const [a, b] = [line[sgm], line[sgm + 1]];
      const n = 5;
      let prev: V3 = a;
      for (let k = 1; k <= n * 2; k++) {
        const t = k / (n * 2);
        const sag = 7 * 4 * t * (1 - t);
        const p: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag, a[2] + (b[2] - a[2]) * t];
        cave.beam(prev, p, 0.16, 0.16, PAL.rope, { vary: 0 });
        if (k % 2 === 1) {
          // Fix pass 3: round warm glass bulbs on a thin iron collar (the caged heads with cone caps read as tiny houses on a wire).
          cave.add(u.box, T(p[0], p[1] - 0.45, p[2], 0.45, 0.5, 0.45), PAL.iron, { vary: 0 });
          cave.add(u.dode, T(p[0], p[1] - 1.5, p[2], 1.25, 1.4, 1.25), PAL.iron, { emit: [1.25, 0.62, 0.22], vary: 0 });
          sprite([p[0], p[1] - 1.5, p[2]], 1, 8, [1.0, 0.55, 0.22], 0.6);
          // Final pass B (judge: the camp mark was near black): the bulbs' light
          // reaches the wall and floor round them (r 7 -> 18).
          lamps.push({ x: p[0], y: p[1] - 2, z: p[2], col: [1.0, 0.64, 0.32], i: 1.15, r: 18, wrap: 0.35, flame: true });
          li++;
        }
        prev = p;
      }
    }
    stats.festoon = li;
    // Final pass B: a broad warm bounce off the floor and back wall, under the
    // string lights and over the camp, so the tent, bedroll and crates read.
    // Final pass D: halved (0.85, 0.6), so the rock between the pools goes darker
    // and the hall reads as lit places (CAVE_POOLS) instead of a hazy flat room.
    lamps.push({ x: -128, y: fy + 26, z: 1168, col: [1.0, 0.62, 0.34], i: 0.42, r: 75, wrap: 0.5, flame: false });
    lamps.push({ x: -100, y: fy + 30, z: 1150, col: [1.0, 0.6, 0.32], i: 0.3, r: 55, wrap: 0.5, flame: false });
    // The camp's things catching the light: the fire reaches the tent's mouth,
    // the bedroll and the barrel (baked per vertex; the props are small faces).
    lamps.push({ x: -150, y: fy + 5, z: 1176, col: [1.0, 0.55, 0.26], i: 1.6, r: 10, wrap: 0.35, flame: true });
  }
  // Final pass D (the camp mark read as a hazy flat room): pools of lamp light
  // on the floor under every lamp (glow kind 4, flat, additive), a glint on
  // each wet puddle near them, and drips falling from the roof round the camp.
  // With the hall's broad bounce halved, the rock between the pools goes dark.
  {
    const poolAt = (x: number, z: number, r: number) => {
      // Three rays, not five (install time: each ray walks the whole shell).
      const hs = [floorAt(x, z, fy), floorAt(x + r * 0.6, z - r * 0.3, fy), floorAt(x - r * 0.6, z + r * 0.3, fy)];
      const top = Math.max(...hs);
      // Over a step the disc would float: keep it on the centre's floor instead.
      return (top - Math.min(...hs) > 4 ? hs[0] : top) + 0.3;
    };
    const pool = (x: number, z: number, r: number, i: number, c: RGB = CAVE_POOL.lamp) => sprite([x, poolAt(x, z, r), z], 4, r * 2, c, i);
    pool(LX, LZ, 16, 0.72);
    pool(-125, 1146, 15, 0.72);
    pool(-145, 1190, 15, 0.72);
    pool(-41, 1170, 15, 0.65);
    pool(-35, 1255, 15, 0.65);
    pool(-79.4, 1136, 13, 0.65);
    pool(-121, CAVE.footZ - 22, 12, 0.5);
    // The fire: smaller, hotter, redder.
    pool(-140, 1170, 13, 1.0, CAVE_POOL.fire);
    // Under the string lights: softer pools along the line.
    for (const [a, b] of [[[-166, 1236], [-150, 1160]], [[-150, 1160], [-100, 1140]]] as const) {
      for (const t of [0.25, 0.5, 0.75]) pool(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 10, 0.34);
    }
    // Glints: the wet puddles near the lamps catch them.
    for (const [x, z] of [[-78, 1268], [-116, 1248], [-96, 1232], [-128, 1284], [-126, 1160], [-147, 1154], [-120, 1188], [-83, 1146]] as const) {
      sprite([x + 1.2, floorAt(x, z, fy + 1) + 0.5, z - 0.8], 1, 1.5, CAVE_POOL.glint, 0.9);
    }
    // Drips from the roof round the camp.
    for (let k = 0; k < 9; k++) {
      const x = -168 + rnd(k, 81) * 110;
      const z = 1140 + rnd(k, 82) * 110;
      const g = floorAt(x, z, fy);
      sprite([x, g + CAVE_POOL.drip, z], 5, 0.35, CAVE_POOL.bead, 1, [0, CAVE_POOL.drip - 1, 0]);
    }
  }
  // Pass 3: break the near-rectangular mouth (it read as a doorway): stalactites
  // hanging over the curtain's top edge and rock teeth jutting in from its sides,
  // dark against the lit water. Plus a hanging lantern where the a3 frame holds it.
  {
    const topY = CAVE.floorY + CAVE.mouthH;
    const zM = CAVE.footZ - 5;
    const stal: [number, number, number][] = [
      [-134, 17, 3.2],
      [-121, 9, 2.2],
      [-104, 13, 2.8],
      [-86, 7, 1.8],
      [-73, 15, 3],
      [-63, 10, 2.4],
    ];
    // Detail pass 3: the boxes read as black blocks. Stalactites now hang in
    // clusters (a long one with two short ones round it) from lumpy rock
    // (dodecahedra), and small rim lamps just behind the curtain plane edge
    // every tooth in cold light: dark masses, lit rims.
    stal.forEach(([x, len, r], k) => {
      const z = zM + (k % 2) * 3;
      cave.add(u.cone6, T(x, topY - len / 2 + 1, z, r, len, r, k * 0.7, Math.PI, 0), PAL.caveRock, { wet: 0.7, vary: 0.2 });
      for (let j = 0; j < 2; j++) {
        const l2 = len * (0.3 + 0.25 * rnd(k * 3 + j, 41));
        const ox = (j ? 1 : -1) * (r * 1.1 + rnd(k, 42 + j) * 1.5);
        cave.add(u.cone6, T(x + ox, topY - l2 / 2 + 0.6, z + (rnd(k, 44 + j) - 0.5) * 3, r * 0.55, l2, r * 0.55, k + j, Math.PI, (rnd(k, 46 + j) - 0.5) * 0.25), PAL.caveRock, { wet: 0.7, vary: 0.25 });
      }
      cave.add(u.dode, T(x + 1.5, topY + 1.6, z, r * 1.7, 2.6, r * 1.5, k * 0.9, 0.3, 0.2), PAL.caveRock, { wet: 0.4, vary: 0.25 });
      lamps.push({ x: x + 2, y: topY - len * 0.5, z: CAVE.footZ + 3, col: [0.62, 0.76, 0.92], i: 0.9, r: 4.5, wrap: 0.05, flame: false });
    });
    const teeth: [number, number, number, number][] = [
      // [side (-1 = west, x -140), y above floor, reach in, height]
      [-1, 10, 7, 12],
      [-1, 34, 5, 9],
      [-1, 50, 8, 10],
      [1, 18, 6, 14],
      [1, 42, 9, 8],
    ];
    teeth.forEach(([side, yy, reach, hh], k) => {
      const x = CAVE.x + side * (CAVE.mouthHalfW - reach / 2 + 1);
      const y = CAVE.floorY + yy;
      // Broken rock: one big lump and two smaller ones stacked along the strata.
      cave.add(u.dode, T(x, y, zM + 1, (reach + 3) * 0.6, hh * 0.55, 3.6, 0.3 * side + k, 0.15 * k, side * (0.3 + 0.08 * k)), PAL.caveRock, { wet: 0.5, vary: 0.25 });
      cave.add(u.dode, T(x + side * 2, y + hh * 0.42, zM + 2, reach * 0.4, hh * 0.3, 2.6, k * 1.3, 0.4, side * 0.3), PAL.caveRock, { wet: 0.5, vary: 0.3 });
      cave.add(u.dode, T(x - side * reach * 0.35, y - hh * 0.38, zM + 0.5, reach * 0.35, hh * 0.25, 2.4, k * 2.1, 0.2, 0), PAL.caveRock, { wet: 0.5, vary: 0.3 });
      // A drip line of short spikes under each overhang.
      cave.add(u.cone6, T(x - side * 1, y - hh * 0.55 - 1.5, zM + 1, 0.9, 3.2, 0.9, k, Math.PI, 0), PAL.caveRock, { wet: 0.7 });
      lamps.push({ x: x - side * reach * 0.4, y, z: CAVE.footZ + 3, col: [0.62, 0.76, 0.92], i: 1.1, r: 5.5, wrap: 0.05, flame: false });
    });
    // A lantern hung from the mouth's east shoulder, inside the a3 frame.
    const hx = -121;
    const hy = CAVE.floorY + 30;
    const hz = CAVE.footZ - 22;
    cave.beam([hx, topY + 2, hz + 6], [hx, hy + 2.2, hz], 0.18, 0.18, PAL.iron);
    lanternHead(cave, hx, hy, hz, 1.9, 2.4);
    sprite([hx, hy, hz], 1, 14, [1.0, 0.55, 0.22], 0.9);
    lamps.push({ x: hx, y: hy - 2, z: hz - 2, col: [1.0, 0.64, 0.32], i: 2.0, r: 14, wrap: 0.3, flame: true });
  }
  // Moss patches at the mouth.
  for (let k = 0; k < 6; k++) {
    const x = CAVE.x + (k % 2 ? -1 : 1) * (8 + rnd(k, 21) * 28);
    const z = CAVE.footZ - 6 - rnd(k, 22) * 10;
    puddle(cave, x, z, 3 + rnd(k, 23) * 3, 40 + k, (px, pz) => floorAt(px, pz, fy + 1) - 0.02);
  }
  // Recolour the moss patches (the last 6 x 9 triangles) green.
  for (let k = cave.c.length - 6 * 9 * 9; k < cave.c.length; k += 3) {
    cave.c[k] = PAL.moss[0];
    cave.c[k + 1] = PAL.moss[1];
    cave.c[k + 2] = PAL.moss[2];
    cave.w[k / 3] = 0.4;
  }

  // ── Tunnel dressing ──
  // v6 (B7): no timber portal set at the passage's mouth (it read as a mine adit).
  stats.tunnel = "v6: the side passage, natural rock, no timber, lit from its exit";

  // ── Bake ──
  /** v6 (B7): 0 in the hall, 1 at the side passage's entrance (the hall's east
   *  wall there took the cold cave ambient and read as a flat navy panel from
   *  the walk in); kept back from the mouth (build z < 1245) so a3's dark
   *  right edge is unchanged. */
  const nearPassage = (x: number, z: number) => smooth(-44, -8, x) * (1 - smooth(1225, 1245, z));
  const ambientAt = (x: number, y: number, z: number): RGB => {
    void y;
    if (z > CAVE.footZ + 1) return AMBIENT.outside;
    if (x < -6) {
      const t = nearPassage(x, z);
      if (t <= 0) return AMBIENT.cave;
      const A = AMBIENT.cave;
      const B = AMBIENT.tunnel;
      return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    }
    return AMBIENT.tunnel;
  };
  // v6: daylight spilling in at the side passage's far end (build frame), so
  // the walk out is short and bright at that end.
  const exitEnd = TUNNEL[TUNNEL.length - 1];
  const dayAt = (x: number, y: number, z: number, ny: number): number => {
    void y;
    const d = Math.hypot(x - exitEnd[0], z - exitEnd[2]);
    if (d > 110) return 0;
    // v6 (B7): the far half of the passage glows with the gorge's sunset.
    return DAY.i * 0.8 * Math.exp(-d / 38) * (0.55 + 0.45 * Math.max(0, ny));
  };
  /** blocks.ts's colours -> ours: rock to wet black (cave) or dark umber (tunnel), wood to timber, metal to iron. */
  const recolour = (rock: RGB) => (r: number, g: number, b: number): [RGB, number] => {
    // Iron is the only bluish colour blocks.ts uses; timber is the only warm one.
    if (b > r && Math.min(r, g, b) > 0.45) return [PAL.iron, 0.5];
    if ((r - b) / Math.max(r, 1e-3) > 0.2) {
      const k = r / 0.34;
      return [[PAL.timber[0] * k, PAL.timber[1] * k, PAL.timber[2] * k], 0];
    }
    const k = (r + g + b) / 3 / 0.33;
    return [[rock[0] * k, rock[1] * k, rock[2] * k], 0];
  };
  const shellOrigin = (m: THREE.Mesh | null) => (m ? m.position.clone() : new THREE.Vector3());
  const tb0 = performance.now();
  if (shells.Mine_Cave) cave.adopt(shells.Mine_Cave.geometry, shellOrigin(shells.Mine_Cave), (r, g, b, x, y, z) => {
    const shellRc = recolour(PAL.caveRock)(r, g, b);
    let al = shellRc[0];
    const w = shellRc[1];
    // fix-2: blocks' shell shades each wall quad on its own, which the lamps
    // turned into a square checker on the left wall at a3. Keep 30% of that
    // step and add a value drift that is smooth across quads (shared corners
    // get the same value), so the wall still varies without tiles.
    if (al[0] !== PAL.iron[0] && (r - b) / Math.max(r, 1e-3) <= 0.2) {
      const k = (r + g + b) / 3 / 0.33;
      const drift = 0.5 + 0.25 * Math.sin(x * 0.071 + z * 0.047) + 0.25 * Math.sin(y * 0.093 - x * 0.038 + z * 0.021 + 1.3);
      const ks = 1 + (k - 1) * 0.3 + (drift - 0.5) * 0.36;
      al = [PAL.caveRock[0] * ks, PAL.caveRock[1] * ks, PAL.caveRock[2] * ks];
    }
    // v6 (B7): the hall's rock warms toward the side passage's entrance.
    const k = nearPassage(x, z);
    const warm: RGB = [al[0] + (al[0] / PAL.caveRock[0]) * (PAL.tunnelRock[0] - PAL.caveRock[0]) * k, al[1] + (al[1] / PAL.caveRock[1]) * (PAL.tunnelRock[1] - PAL.caveRock[1]) * k, al[2] + (al[2] / PAL.caveRock[2]) * (PAL.tunnelRock[2] - PAL.caveRock[2]) * k];
    // Wetter toward the mouth.
    return [k > 0 && w === 0 ? warm : al, Math.max(w, 0.5 * smooth(1200, 1296, z))];
  });
  // v6: the passage keeps only its rock (blocks' timber sets and iron are dropped).
  const isRock = (r: number, g: number, b: number) => !(b > r && Math.min(r, g, b) > 0.45) && !((r - b) / Math.max(r, 1e-3) > 0.2);
  if (shells.Mine_Tunnel) tunnel.adopt(shells.Mine_Tunnel.geometry, shellOrigin(shells.Mine_Tunnel), recolour(PAL.tunnelRock), isRock);
  const caveO = new THREE.Vector3(CAVE.hallX, CAVE.floorY, CAVE.hallZ);
  const tunO = shells.Mine_Tunnel ? shellOrigin(shells.Mine_Tunnel) : new THREE.Vector3(16, 70, 1275);
  const gCave = track(bake(cave, caveO, lamps, ambientAt, dayAt));
  // Final pass B (judge, decision 53): the camera no longer uses the side
  // passage, and its far end stood out of the gorge wall beside the falls as
  // a beige pillar (a3 stop and park). Every triangle of it that sits out in
  // the open air (over the terrain) is dropped; what is left inside the rock
  // closes the terrain's opening there (without it the sea showed through).
  const gTunnel = track(insideRock(bake(tunnel, tunO, lamps, ambientAt, dayAt), tunO));
  stats.bakeMs = Math.round(performance.now() - tb0);

  // ── Materials ──
  /** The cave's mirror (world <-> build frame; its own inverse). */
  const mirror = new THREE.Matrix4().makeScale(1, 1, -1).setPosition(0, 0, caveMirrorZ(0));
  const wallU = {
    uToBuild: { value: mirror.clone() },
    uTime: { value: 0 },
    uGain: { value: 1 },
    uFlameK: { value: 1 },
    uCaus: { value: new THREE.Vector4(CAVE.x, CAVE.floorY + 34, CAVE.footZ - 2, 0.85) },
    uCausCol: { value: new THREE.Color().setRGB(CAUSTIC.col[0], CAUSTIC.col[1], CAUSTIC.col[2]) },
    uSheen: { value: new THREE.Color(0.55, 0.42, 0.28) },
  };
  const wallMat = (name: string, own?: Partial<typeof wallU>) => {
    const m = new THREE.ShaderMaterial({
      name,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: WALL_VERT,
      fragmentShader: WALL_FRAG,
      vertexColors: true,
      fog: true,
    });
    Object.assign(m.uniforms, wallU, own ?? {});
    return track(m);
  };
  const caveMat = wallMat("UgCaveWall");
  const mineMat = wallMat("UgMineWall", { uCaus: { value: new THREE.Vector4(0, 0, 0, 0) } });

  // ── Meshes ──
  // UG_Mine (world, toggled by MINE_BOX) holds UG_CaveMirror (the kits, under
  // the mirror) and the glow sprites (their shader places them in the world).
  const root = new THREE.Group();
  root.name = "UG_Mine";
  (ctx.root ?? scene).add(root);
  const caveRoot = new THREE.Group();
  caveRoot.name = "UG_CaveMirror";
  caveRoot.matrixAutoUpdate = false;
  caveRoot.matrix.copy(mirror);
  root.add(caveRoot);
  const mk = (g: THREE.BufferGeometry, m: THREE.Material, name: string, o: THREE.Vector3, parent: THREE.Object3D = caveRoot) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    mesh.position.copy(o);
    parent.add(mesh);
    return mesh;
  };
  mk(gCave, caveMat, "UG_Cave", caveO);
  mk(gTunnel, mineMat, "UG_Tunnel", tunO);
  // Build-frame sprites into the world (the glow shader ignores the model matrix).
  for (const g of glowInst) {
    if (g.world) continue;
    g.p = [g.p[0], g.p[1], caveMirrorZ(g.p[2])];
    g.ax = [g.ax[0], g.ax[1], -g.ax[2]];
  }

  // ── Glow sprites (one instanced additive call) ──
  // v6 (B7): v5's three amber ray cards across the gorge are gone: aimed for
  // the old late-afternoon sun, they read as grey smudged bars over every
  // hike frame (keys 36 to 38). The glow is the cave's lamps and embers only.
  const glowGeo = track(new THREE.InstancedBufferGeometry());
  {
    const plane = new THREE.PlaneGeometry(1, 1);
    glowGeo.index = plane.index;
    glowGeo.setAttribute("position", plane.getAttribute("position"));
    const n = glowInst.length;
    const aP = new Float32Array(n * 3);
    const aAx = new Float32Array(n * 3);
    const aD = new Float32Array(n * 4);
    const aC = new Float32Array(n * 3);
    glowInst.forEach((g, i) => {
      aP.set(g.p, i * 3);
      aAx.set(g.ax, i * 3);
      aD.set([g.size, g.kind, g.seed, g.i], i * 4);
      aC.set(g.c, i * 3);
    });
    glowGeo.setAttribute("aP", new THREE.InstancedBufferAttribute(aP, 3));
    glowGeo.setAttribute("aAx", new THREE.InstancedBufferAttribute(aAx, 3));
    glowGeo.setAttribute("aD", new THREE.InstancedBufferAttribute(aD, 4));
    glowGeo.setAttribute("aC", new THREE.InstancedBufferAttribute(aC, 3));
    glowGeo.instanceCount = n;
    glowGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(-60, 200, 1700), 450);
  }
  const glowU = { uTime: { value: 0 }, uCage: { value: 0 }, uFade: { value: new THREE.Vector2(120, 400) } };
  const glowMat = track(
    new THREE.ShaderMaterial({
      name: "UgGlow",
      uniforms: glowU,
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);
  glowMesh.name = "UG_Glow";
  glowMesh.renderOrder = 4;
  root.add(glowMesh);

  // ── Mist cards (one instanced alpha call) ──
  const mistInst: { p: V3; size: number; seed: number; rate: number; a: number; sun: number; glow: number; rise: number }[] = [];
  {
    const F = WORLD.falls;
    const pool = WORLD.pool;
    let s = 0;
    if (OUTDOOR_MIST) {
    // Lying on the pool.
    for (let k = 0; k < 16; k++, s++) mistInst.push({ p: [pool.x + (rnd(s, 61) - 0.5) * 170, pool.y + 8 + rnd(s, 62) * 14, pool.z - 50 + rnd(s, 63) * 110], size: 46 + rnd(s, 64) * 34, seed: rnd(s, 65), rate: 0.03 + rnd(s, 66) * 0.03, a: 0.13, sun: 0.35 + rnd(s, 67) * 0.4, glow: 0, rise: 0.25 });
    // Spray climbing the curtain's foot.
    for (let k = 0; k < 12; k++, s++) mistInst.push({ p: [F.bottom[0] + (rnd(s, 61) - 0.5) * 120, F.bottom[1] + 10 + rnd(s, 62) * 40, F.bottom[2] - 14 - rnd(s, 63) * 16], size: 30 + rnd(s, 64) * 26, seed: rnd(s, 65), rate: 0.08 + rnd(s, 66) * 0.06, a: 0.16, sun: 0.6, glow: 0, rise: 1.4 });
    // A veil in the shade up the dive, along the walls.
    for (let k = 0; k < 8; k++, s++) {
      const side = k % 2 ? -1 : 1;
      mistInst.push({ p: [F.bottom[0] + side * (70 + rnd(s, 61) * 30), 150 + rnd(s, 62) * 220, F.bottom[2] - 10 - rnd(s, 63) * 30], size: 60 + rnd(s, 64) * 40, seed: rnd(s, 65), rate: 0.02 + rnd(s, 66) * 0.02, a: 0.07, sun: 0.1, glow: 0, rise: 0.4 });
    }
    // Fix pass 3: a bank of spray across the foot, in front of the key-19 camera
    // (it sits at z 1400, 104 up), so the pool's lower third dissolves into mist.
    for (let k = 0; k < 14; k++, s++) mistInst.push({ p: [F.bottom[0] + (rnd(s, 61) - 0.5) * 130, F.bottom[1] + 4 + rnd(s, 62) * 22, F.bottom[2] - 20 - rnd(s, 63) * 45], size: 38 + rnd(s, 64) * 30, seed: rnd(s, 65), rate: 0.05 + rnd(s, 66) * 0.05, a: 0.24, sun: 0.55, glow: 0, rise: 0.7 });
    }
    // Just inside the cave mouth: haze lit by the curtain from behind.
    for (let k = 0; k < 6; k++, s++) mistInst.push({ p: [CAVE.x + (rnd(s, 61) - 0.5) * 70, CAVE.floorY + 6 + rnd(s, 62) * 40, caveMirrorZ(CAVE.footZ - 8 - rnd(s, 63) * 22)], size: 22 + rnd(s, 64) * 18, seed: rnd(s, 65), rate: 0.04 + rnd(s, 66) * 0.03, a: 0.18, sun: 0, glow: 1, rise: 0.3 });
  }
  const mistGeo = track(new THREE.InstancedBufferGeometry());
  {
    const plane = new THREE.PlaneGeometry(1, 1);
    mistGeo.index = plane.index;
    mistGeo.setAttribute("position", plane.getAttribute("position"));
    const n = mistInst.length;
    const aP = new Float32Array(n * 3);
    const aD = new Float32Array(n * 4);
    const aC = new Float32Array(n * 3);
    mistInst.forEach((m, i) => {
      aP.set(m.p, i * 3);
      aD.set([m.size, m.seed, m.rate, m.a], i * 4);
      aC.set([m.sun, m.glow, m.rise], i * 3);
    });
    mistGeo.setAttribute("aP", new THREE.InstancedBufferAttribute(aP, 3));
    mistGeo.setAttribute("aD", new THREE.InstancedBufferAttribute(aD, 4));
    mistGeo.setAttribute("aC", new THREE.InstancedBufferAttribute(aC, 3));
    mistGeo.instanceCount = n;
    mistGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(WORLD.falls.bottom[0], 180, WORLD.falls.bottom[2] - 30), 320);
  }
  const mistU = {
    uTime: { value: 0 },
    uLit: { value: new THREE.Color(0.9, 0.7, 0.5) },
    uShade: { value: new THREE.Color(0.35, 0.4, 0.46) },
    uGlowC: { value: new THREE.Color(0.95, 0.66, 0.36) },
  };
  const mistMat = track(
    new THREE.ShaderMaterial({
      name: "UgMist",
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    }),
  );
  Object.assign(mistMat.uniforms, mistU);
  if (ctx.quality) mistGeo.instanceCount = Math.max(1, Math.round(mistInst.length * ctx.quality.particles));
  const mistMesh = new THREE.Mesh(mistGeo, mistMat);
  mistMesh.name = "UG_Mist";
  mistMesh.renderOrder = 3;
  (ctx.root ?? scene).add(mistMesh);

  // ── The curtain's glow (C1: water.ts owns the curtain on both sides) ──
  // The wet sheen on the cave's rock and its haze take the curtain's live glow.
  const waterApi = scene.userData.water as { curtainUniforms?: Record<string, { value: unknown }> } | undefined;
  const curtainGlow = waterApi?.curtainUniforms?.uGlow?.value as THREE.Color | undefined;
  if (curtainGlow && curtainGlow.isColor) wallU.uSheen.value = curtainGlow;

  // ── Stats ──
  const tris = (g: THREE.BufferGeometry) => (g.getAttribute("position")?.count ?? 0) / 3;
  stats.trianglesTotal = Math.round(tris(gCave) + tris(gTunnel) + glowInst.length * 2 + mistInst.length * 2);
  stats.trianglesCave = Math.round(tris(gCave));
  stats.trianglesTunnel = Math.round(tris(gTunnel));
  stats.sprites = glowInst.length;
  stats.mistCards = mistInst.length;
  stats.drawCalls = 4;
  stats.lamps = lamps.length;
  stats.installMs = Math.round(performance.now() - t0);
  for (const g of Object.values(u)) g.dispose();
  const api = { stats: () => ({ ...stats }) };
  scene.userData.dressUnderground = api;

  // ── Frame loop ──
  const camPos = new THREE.Vector3();
  const frustum = new THREE.Frustum();
  const pm = new THREE.Matrix4();
  const sph = new THREE.Sphere();
  let animating = false;
  return {
    name: "dress-underground",
    update(time: number): boolean {
      let changed = false;
      const t = reduced ? 0 : time;
      const cam = ctx.camera;
      cam.updateMatrixWorld();
      camPos.setFromMatrixPosition(cam.matrixWorld);
      const mineOn = camPos.x > MINE_BOX.x0 && camPos.x < MINE_BOX.x1 && camPos.z > MINE_BOX.z0 && camPos.z < MINE_BOX.z1 && camPos.y < MINE_BOX.y1;
      if (mineOn !== root.visible) {
        root.visible = mineOn;
        changed = true;
      }
      // Keep blocks.ts's grey mine hidden (nothing there turns it back on, but be sure).
      for (const o of hidden) if (o.visible) o.visible = false;
      // v6: with the outdoor mist off, the cards left are the cave's haze: drawn with the cave.
      const fallsNear = OUTDOOR_MIST ? camPos.distanceTo(_a.set(WORLD.falls.bottom[0], 200, WORLD.falls.bottom[2])) < 3200 : mineOn;
      if (fallsNear !== mistMesh.visible) {
        mistMesh.visible = fallsNear;
        changed = true;
      }
      // Fade distances for the glow follow the fog ramp.
      const fog = scene.fog as THREE.Fog | null;
      if (fog && (fog as THREE.Fog).isFog) glowU.uFade.value.set(Math.max(40, fog.near * 0.6 + 60), Math.max(160, fog.far * 0.9));
      // The mist takes the sun and haze of the moment.
      mistU.uLit.value.copy(ctx.sunColor).multiplyScalar(0.75).lerp(ctx.hazeColor, 0.25);
      mistU.uShade.value.copy(ctx.hazeColor).multiplyScalar(0.62);
      if (curtainGlow && curtainGlow.isColor) mistU.uGlowC.value.copy(curtainGlow).multiplyScalar(0.8);
      const inMine = mineOn && camPos.x > IN_MINE.x0 && camPos.x < IN_MINE.x1 && camPos.z > IN_MINE.z0 && camPos.z < IN_MINE.z1 && camPos.y < IN_MINE.y1;
      let mistSeen = false;
      if (fallsNear) {
        pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        frustum.setFromProjectionMatrix(pm);
        mistSeen = frustum.intersectsSphere(sph.copy(mistGeo.boundingSphere!));
      }
      animating = !reduced && (inMine || (OUTDOOR_MIST && mistSeen));
      if (animating || changed) {
        wallU.uTime.value = t;
        glowU.uTime.value = t;
        mistU.uTime.value = t;
      }
      return changed || animating;
    },
    isAnimating: () => animating,
    stats: () => ({ ...stats }),
    /** v6 (bible 3.2): mist cards by the tier's particle share (at least one). */
    setQuality(tier: QualityTier) {
      mistGeo.instanceCount = Math.max(1, Math.round(mistInst.length * tier.particles));
      stats.mistDrawn = mistGeo.instanceCount;
    },
    dispose() {
      for (const o of hidden) o.visible = true;
      root.removeFromParent();
      mistMesh.removeFromParent();
      for (const d of disposables) d.dispose();
      if (scene.userData.dressUnderground === api) delete scene.userData.dressUnderground;
    },
  };
};
