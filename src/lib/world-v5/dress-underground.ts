import * as THREE from "three";
import { CAVE, LIFT, SHAFT, SHAFT_KEYS, TRAIL, TUNNEL, WORLD, liftCageY } from "./layout";
import { LIGHTS } from "./light";
import type { InstallFn, WorldCtx } from "./modules";

/**
 * v5 dressing: underground (world_art_bible.md 6: the rim and the dive, a3
 * the cave behind the falls, the mine tunnel, a4 the mine lift, the shaft).
 *
 * What it replaces from blocks.ts (hidden at install, restored on dispose):
 *   Mine_Cave, Mine_Tunnel, Mine_Shaft  the grey shells, lit by a
 *        MeshStandardMaterial that still took the scene's fill light, so the
 *        hall read as a lit cream room. Their triangles are re-used (the
 *        holes, the arches and the rails fit the camera path) and re-coloured:
 *        wet black rock, brown timber, iron; light baked into the vertices.
 *   Mine_Flames      cone flames and lantern glass: now sprites (glow below).
 *   LiftCage, LiftCable  the grey cage: a new one rides in LM_MineLift.
 *   Landmark_a3_Water's material (surfaces.ts's SurfCurtain, adopted on the
 *        first frame, its live uniforms shared by reference so surfaces.ts
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
  tunnelRock: [0.078, 0.082, 0.092] as RGB,
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
  day: [0.74, 0.82, 0.96] as RGB, // pass 3: cool, against the warm torches
};

// ── Tunables ─────────────────────────────────────────────────────────────────
/** Light the rock takes where no lamp reaches (never a full black gap, bible 6 tunnel). */
const AMBIENT = { cave: [0.045, 0.052, 0.064] as RGB, tunnel: [0.075, 0.085, 0.11] as RGB, shaft: [0.07, 0.08, 0.1] as RGB, outside: [0.5, 0.46, 0.42] as RGB };
/** Torches: strength, reach (half at this distance, bible pool radius 14-18), wrap. */
const TORCH = { i: 3.0, r: 11, wrap: 0.35, col: [1.0, 0.62, 0.34] as RGB, spacing: 62 };
/** The curtain as a light into the hall: 9 samples over the mouth. */
const CURTAIN_LIGHT = { i: 0.15, r: 42, col: [0.62, 0.74, 0.86] as RGB };
/** The shaft's daylight: strength at the collar and how fast it falls off going down. */
const DAY = { i: 2.9, fall: 220 }; // pass 3: 2.2 -> 2.9 with the longer tail below, a visible cool gradient up the ride
/** The caustics' cool colour and reach from the mouth plane. */
const CAUSTIC = { col: [0.08, 0.12, 0.16] as RGB, reach: 42 }; // pass 3: 55 -> 42, the net on the far pillar read as a spider web
const FLOOR_LIFT = 0.3; // blocks.ts: the tunnel floor sits this far over the room floors
const MINE_BOX = { x0: -600, x1: 1900, z0: 800, z1: 2700, y1: 950 };
const IN_MINE = { x0: -260, x1: 1500, z0: 980, z1: 1480, y1: 660 };
const REPLACED = ["Mine_Cave", "Mine_Tunnel", "Mine_Shaft"] as const;

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
  adopt(geo: THREE.BufferGeometry, origin: THREE.Vector3, albedo: (r: number, g: number, b: number, x: number, y: number, z: number) => [RGB, number]): void {
    const pos = geo.getAttribute("position");
    const col = geo.getAttribute("color");
    for (let i = 0; i < pos.count; i++) {
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
varying vec3 vCol;
varying vec4 vFlame;
varying vec3 vW;
varying vec3 vN;
void main() {
  vCol = color;
  vFlame = aFlame;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
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
${NOISE_GLSL}
${CELL_GLSL}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
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
      // Patchy: the ripples come and go in pools of light, never as an even net.
      float c = (1.0 - smoothstep(0.02, 0.14, min(e1, e2))) * smoothstep(0.45, 0.9, ugNoise(q * 0.22 + uTime * 0.06)) * 0.8;
      vec3 L = normalize(uCaus.xyz - vW);
      float face = 0.3 + 0.7 * max(0.0, dot(N, L));
      col += uCausCol * uCaus.w * m * face * c * c;
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

/** The curtain (bible 6 the dive): same attributes and free-fall clock as blocks.ts's sheet. */
const CURTAIN_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute float aDrop;
attribute vec3 aSheet;
varying vec2 vUv;
varying float vDrop;
varying vec3 vSheet;
varying vec3 vWc;
void main() {
  vUv = uv;
  vDrop = aDrop;
  vSheet = aSheet;
  vWc = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

// Detail pass 3 (water): three unequal falls split by two painted rock ribs,
// each one three flat tones in long ribbons (thin strands dark teal, the body
// teal grey, lit ribbons cream on the sun side), a thin bright lip over a
// glassy tongue, broken foam only where it lands. Seen from the cave: a
// luminous sheet, the gorge and sky dim through the thin strands, the ribs black.
const CURTAIN_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime, uBack, uSunSide, uSunFront, uDay;
uniform vec3 uLit, uShade, uSky, uFoamC, uGlow;
varying vec2 vUv;
varying float vDrop;
varying vec3 vSheet;
varying vec3 vWc;
${NOISE_GLSL}
// A crisp step whose edge follows the pixel footprint (flat painted bands, no blur).
float cStep( float edge, float v ) {
  float e = fwidth( v ) * 1.1 + 0.0015;
  return smoothstep( edge - e, edge + e, v );
}
// Flat faceted rock: one tone per cell of a jittered grid (the low poly stone, painted in).
float wfFacet( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  float best = 8.0;
  float id = 0.0;
  for ( int yy = -1; yy <= 1; yy++ ) for ( int xx = -1; xx <= 1; xx++ ) {
    vec2 g = vec2( float( xx ), float( yy ) );
    vec2 r = g + ugHash2( i + g ) * 0.8 + 0.1 - f;
    float d = dot( r, r );
    if ( d < best ) { best = d; id = ugHash( i + g + 17.0 ); }
  }
  return id;
}
void main() {
  float Hh = vSheet.x;
  float Tt = vSheet.y;
  float E = 0.012;
  float lipV = 2.0 * Hh * sqrt( E ) / Tt;
  float tau = vDrop < 0.0 ? vDrop / lipV : Tt * ( sqrt( vDrop / Hh + E ) - sqrt( E ) );
  float ph = uTime - tau;
  float x = vUv.x;
  float y = clamp( vUv.y, 0.0, 1.0 );
  float isMain = 1.0 - vSheet.z;
  float D = max( vDrop, 0.0 );
  // Fix pass 3: the strands wander a little as they fall (dead straight, close up they read as birch trunks).
  float X = x * 106.0 + ( ugNoise( vec2( D * 0.035, x * 9.0 ) ) - 0.5 ) * 7.0 * smoothstep( 0.05, 0.4, y ); // across in world units (100 wide at the lip, 112 at the foot)
  float fall = step( 0.0, vDrop );
  float dist = length( vWc - cameraPosition );
  // Close up (the pool, the cave) the ribbons get finer, so the frame holds 20-30 of them.
  float near = 1.0 - smoothstep( 130.0, 380.0, dist );

  // ── Two rock ribs split the sheet into three unequal falls, lip to pool ──
  float wob = ugNoise( vec2( y * 4.0, 1.3 ) ) - 0.5;
  float c1 = 0.25 + wob * 0.022;
  float c2 = 0.7 - wob * 0.018;
  float spread = smoothstep( 0.0, 0.55, y );
  // Ledges: each rib swells and pinches down the drop.
  // Fix pass 3: half as wide, and broken into 2-3 ledges down the drop (water
  // pours over the gaps), so no rib runs lip to pool as one black pillar.
  float hw1 = mix( 0.025, 0.017, spread ) * ( 0.72 + 0.56 * ugNoise( vec2( D * 0.022, 5.0 ) ) );
  float hw2 = mix( 0.021, 0.014, spread ) * ( 0.72 + 0.56 * ugNoise( vec2( D * 0.022, 9.0 ) ) );
  hw1 *= smoothstep( 0.3, 0.42, ugNoise( vec2( y * 3.4, 21.0 ) ) );
  hw2 *= smoothstep( 0.3, 0.42, ugNoise( vec2( y * 3.1, 33.0 ) ) );
  // Their edges fray: strands of the falling water flick over them.
  float fray = ( ugNoise( vec2( X * 0.7, ph * 2.2 ) ) - 0.5 ) * 0.016;
  float rib = max( hw1 - abs( x - c1 ) + fray, hw2 - abs( x - c2 ) - fray );
  float onRib = cStep( 0.0, rib ) * fall;
  // A lit edge down each fall where the water rolls off the rock.
  float rim = ( 1.0 - cStep( 0.011, -rib ) ) * ( 1.0 - onRib ) * fall;

  // ── The water: three flat tones in long ribbons ──
  // Lanes across a fall (how thick the sheet is there), wandering slowly.
  float laneF = mix( 0.15, 0.2, near );
  float lane = ugNoise( vec2( X * laneF, y * 1.5 + ph * 0.05 ) ) * 0.62 + ugNoise( vec2( X * laneF * 2.7 + 5.0, y * 3.0 - ph * 0.08 ) ) * 0.38;
  // Streaks falling fast down the lanes; the free-fall clock stretches them toward the foot.
  float sF = mix( 0.35, 0.9, near );
  float s1 = ugNoise( vec2( X * sF, ph * 1.4 ) );
  float s2 = ugNoise( vec2( X * sF * 2.3 + 11.0, ph * 2.6 + 5.0 ) );
  float fine = 1.0 - clamp( fwidth( X * sF * 2.3 ) * 1.4, 0.0, 1.0 );
  float streak = s1 * 0.6 + mix( 0.2, s2 * 0.4, fine );
  // Near the lip the lanes carry it (long glassy ribbons); lower down the streaks join in.
  float body = lane * mix( 0.8, 0.55, spread ) + streak * mix( 0.2, 0.45, spread );
  // The sheet tears as it falls: solid at the lip, about a third thin strands at the foot.
  float tearT = mix( 0.12, 0.47, smoothstep( 0.03, 0.6, y ) );
  float t1 = cStep( tearT, body ); // 0 = a thin strand (dark teal)
  float t2 = cStep( mix( 0.63, 0.6, near ), body ); // 1 = a lit ribbon
  // Bright clots riding the fall.
  float fh = ugNoise( vec2( X * 0.3 + 3.0, ph * 1.1 ) );
  float heads = cStep( 0.66, fh * 0.75 + s1 * 0.25 ) * smoothstep( 0.1, 0.3, y ) * fall;
  // Broken white water only where it lands.
  // Billows of white water boiling up off the pool (round tops, rising slowly), broken
  // by the dark streaks still falling into them; a solid torn band at the very foot.
  float fz = smoothstep( 0.9, 1.0, y );
  float fn = ugNoise( vec2( X * 0.34, D * 0.3 + uTime * 0.5 ) ) * 0.55 + ugNoise( vec2( X * 0.9 + 7.0, D * 0.7 + uTime * 0.9 ) ) * 0.45;
  float foam = max( cStep( 1.0 - fz * 0.8, fn - ( 1.0 - t1 ) * 0.12 ), cStep( 0.975 + ( s2 - 0.5 ) * 0.03, y ) ) * fall;

  // Light: the sun side warm cream, the shade side cool teal grey.
  float lit = clamp( uSunFront + uSunSide * ( x - 0.5 ) * 1.4, 0.0, 1.0 );
  vec3 midC = mix( uShade * vec3( 0.5, 0.68, 0.7 ), uLit * vec3( 0.44, 0.39, 0.33 ), lit );
  // Fix pass 3: the gaps are thin water, half way to the body (at 0.016 they read as black bark).
  vec3 deepC = mix( mix( vec3( 0.016, 0.034, 0.04 ), vec3( 0.05, 0.04, 0.032 ), lit * 0.5 ), midC, 0.5 );
  vec3 litC = mix( mix( uShade, vec3( 0.6, 0.72, 0.72 ), 0.5 ), uLit * 0.92, lit );
  vec3 col = mix( deepC, midC, t1 );
  col = mix( col, litC, t2 );
  col = mix( col, uFoamC * mix( 0.85, 1.02, lit ), heads * 0.9 );
  // Up high the water takes the sky.
  col = mix( col, uSky * 0.95, ( 1.0 - smoothstep( 0.0, 0.35, y ) ) * 0.25 * t1 );
  // The glassy tongue, and a thin bright lip catching the sky.
  float tongue = ( 1.0 - smoothstep( 0.02, 0.1, y ) ) * fall + ( 1.0 - fall );
  vec3 glass = mix( midC * 0.85, uSky, 0.3 + 0.3 * cStep( 0.5, s1 ) );
  col = mix( col, glass, tongue * 0.7 );
  float lipLine = cStep( -1.4, vDrop ) * ( 1.0 - cStep( 1.6, vDrop ) );
  col = mix( col, uSky * 1.1 + 0.14, lipLine * 0.9 );
  col = mix( col, litC * 1.05, rim * 0.85 );
  // The ribs: dark wet faceted rock, a trickle or two sliding down them.
  float fac = wfFacet( vec2( X * 0.24, D * 0.075 - X * 0.08 ) );
  // Fix pass 3: wet rock values (0.08-0.12), a lit facet catching the spray.
  vec3 rockC = vec3( 0.075, 0.072, 0.08 ) * ( 0.7 + 0.7 * fac ) + mix( vec3( 0.03, 0.045, 0.05 ), litC * 0.35, lit ) * step( 0.72, fac );
  float trickle = cStep( 0.82, ugNoise( vec2( X * 1.6, ph * 3.0 ) ) );
  rockC = mix( rockC, midC, trickle * 0.45 );
  col = mix( col, rockC, onRib );
  // Overbright: light.ts's valley haze (fog thickens toward the gorge floor) greys it by
  // the time it reaches the eye; ACES rolls the excess off into white.
  // Fix pass 3: soft billows, grey where they thin, lit cream at their crowns.
  float crown = smoothstep( 0.0, 0.2, fn - ( 1.0 - fz * 0.8 ) ) + cStep( 0.975, y );
  col = mix( col, mix( uFoamC * 1.15 + midC * 0.25, uFoamC * 2.0, clamp( crown, 0.0, 1.0 ) ), foam );
  col *= uDay;

  // Opaque: the lit cave is right behind the sheet at the pool (see-through read as a cream wall).
  float e = min( x, 1.0 - x );
  float rag = cStep( 0.018 + 0.05 * s1, e );
  float a = 0.985 * rag;
  // Island falls thin out into the clouds.
  a *= 1.0 - vSheet.z * smoothstep( 0.35, 1.0, y ) * ( 0.75 + 0.25 * body );

  // Seen from behind (the cave): a luminous sheet. The day beyond is painted
  // in (a peach sky over a dark jagged gorge and tree line), seen dimly through
  // the thin strands; the lit ribbons glow; the ribs stand black.
  if ( uBack > 0.001 ) {
    vec3 dir = normalize( vWc - cameraPosition );
    float az = atan( dir.x, dir.z );
    float el = dir.y / max( length( dir.xz ), 0.001 );
    el += ( streak - 0.5 ) * 0.008;
    float ridge = 0.075 + 0.03 * ugNoise( vec2( az * 4.0, 1.0 ) ) + 0.012 * ugNoise( vec2( az * 11.0, 4.0 ) );
    float tip = 1.0 - abs( fract( az * 70.0 + 0.3 * ugNoise( vec2( az * 6.0, 7.0 ) ) ) - 0.5 ) * 2.0;
    ridge += max( 0.0, tip * 1.7 - 0.7 ) * 0.018 * step( 0.4, ugNoise( vec2( az * 3.0, 11.0 ) ) );
    float skyK = cStep( ridge, el );
    vec3 sky = mix( vec3( 1.45, 0.86, 0.5 ), vec3( 1.2, 1.0, 0.82 ), smoothstep( ridge, ridge + 0.3, el ) );
    float band2 = cStep( ridge - 0.07 + 0.03 * ugNoise( vec2( az * 7.0, 17.0 ) ), el );
    vec3 gorge = mix( vec3( 0.03, 0.026, 0.04 ), vec3( 0.085, 0.07, 0.1 ), band2 );
    vec3 world = mix( gorge, sky, skyK );
    vec3 strandC = vec3( 0.78, 0.92, 1.1 );
    // Thin strands: the world beyond, dimmed by a film of water. Body: cool glow. Lit ribbons: bright.
    vec3 water = mix( world * 0.6 + strandC * 0.1, strandC * mix( 0.5, 1.25, t2 ), t1 * mix( 1.0, 0.75, skyK ) );
    water = mix( water, strandC * 1.35, heads * 0.45 );
    water = mix( water, strandC * 1.2, foam * 0.5 );
    vec3 ribC = rockC * 0.8 + strandC * 0.45 * ( 1.0 - cStep( 0.01, rib ) );
    vec3 glow = mix( water, ribC, onRib );
    col = mix( col, glow, uBack );
    a = mix( a, 0.97 * rag, uBack );
  }
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

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
  const glowInst: { p: V3; ax: V3; size: number; kind: number; seed: number; i: number; c: RGB }[] = [];
  const sprite = (p: V3, kind: number, size: number, c: RGB, i = 1, ax: V3 = [0, 0, 0]) => glowInst.push({ p, ax, size, kind, seed: rnd(glowInst.length, 17), i, c });
  const cave = new Kit(u);
  const tunnel = new Kit(u);
  const shaft = new Kit(u);
  const cage = new Kit(u);

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

  // Tunnel torches: blocks.ts's six (their brackets are gone with its shell) and fill-ins every ~62.
  const blockTorches = [26, L * 0.23, L * 0.43, L * 0.62, L * 0.8, L - 24];
  const torchAt: [number, number][] = [[6, 1]];
  blockTorches.forEach((a, k) => {
    const sg = k % 2 ? -1 : 1;
    if (k > 0) {
      const a0 = blockTorches[k - 1];
      const n = Math.max(0, Math.round((a - a0) / TORCH.spacing) - 1);
      for (let j = 1; j <= n; j++) torchAt.push([a0 + ((a - a0) * j) / (n + 1), j % 2 ? sg : -sg]);
    }
    torchAt.push([a, sg]);
  });
  // A torch either side of the shaft (a4).
  torchAt.push([L - 7, 1], [L - 7, -1]);
  for (const [a, sg] of torchAt) {
    const f = at(a);
    torch(tunnel, f.x + f.rx * sg * 11.6, f.y + 15, f.z + f.rz * sg * 11.6, -f.rx * sg, -f.rz * sg);
  }
  stats.torches = torchAt.length;
  // Pass 3: break the tunnel's flat brown walls into rock facets (value and hue
  // +-15 percent a face, tilted so each takes its own torch light), clear of the torches.
  {
    const torchA = torchAt.map(([a]) => a);
    const tints: RGB[] = [
      [0.085, 0.088, 0.098],
      [0.07, 0.076, 0.088],
      [0.1, 0.092, 0.088],
    ];
    let seed = 500;
    for (let a = 14; a < L - 30; a += 8.5) {
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
          tunnel.add(u.box, T(f.x + f.rx * sg * 12.6, f.y + yy + (rnd(seed, 66) - 0.5) * 2, f.z + f.rz * sg * 12.6, w, hgt, 2.6, yaw + (rnd(seed, 67) - 0.5) * 0.35, (rnd(seed, 68) - 0.5) * 0.5, (rnd(seed, 69) - 0.5) * 0.4), c, { vary: 0.15 });
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

  // Shaft lamps at blocks.ts's three brackets.
  [230, 360, 490].forEach((y, k) => {
    const onEast = k % 2 === 0;
    const x = onEast ? SHAFT.x1 - 1.4 : SHAFT.x0 + 1.4;
    const z = SHAFT.z + (k - 1) * 7;
    lanternHead(shaft, x, y, z, 1.4, 2.2);
    sprite([x, y, z], 1, 12, [1.0, 0.55, 0.22], 0.6);
    lamps.push({ x: x + (onEast ? -2 : 2), y, z, col: [1.0, 0.62, 0.3], i: 1.6, r: 18, wrap: 0.3, flame: true });
  });
  // Detail pass 3: four more on the north and south walls, on iron arms, so
  // looking up the shaft is a rhythm of warm pools climbing into the cool
  // daylight (the ride read as one brown wash). The top one sits in the
  // key-36.5 frame, just under the collar.
  const shaftLamps = [[165, 1, 1446], [295, -1, 1434], [425, 1, 1430], [560, -1, 1445]] as const;
  shaftLamps.forEach(([y, sz, x]) => {
    const wz = sz > 0 ? SHAFT.z1 : SHAFT.z0;
    const z = wz - sz * 2.6;
    shaft.beam([x, y + 3.2, wz - sz * 0.2], [x, y + 3.2, z], 0.35, 0.35, PAL.iron, { vary: 0 });
    shaft.add(u.box, T(x, y + 2, wz - sz * 0.4, 1.2, 4.4, 0.6), PAL.timberDark, { vary: 0 });
    lanternHead(shaft, x, y + 1.2, z, 1.0, 1.6);
    sprite([x, y + 1.2, z], 1, 11, [1.0, 0.55, 0.22], 0.55);
    lamps.push({ x, y: y + 1, z: z - sz * 1.5, col: [1.0, 0.62, 0.3], i: 1.5, r: 15, wrap: 0.3, flame: true });
  });

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
    ray.set(_a.set(x, fy + 30, z), _b.set(0, -1, 0));
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
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = r * (0.65 + 0.5 * rnd(k, seed));
      const px = x + Math.cos(a) * rr * 1.3;
      const pz = z + Math.sin(a) * rr;
      pts.push([px, 0, pz]);
      top = Math.max(top, yAt(px, pz));
    }
    top = Math.max(top, yAt(x, z)) + 0.14;
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
          lamps.push({ x: p[0], y: p[1] - 2, z: p[2], col: [1.0, 0.64, 0.32], i: 0.9, r: 7, wrap: 0.3, flame: true });
          li++;
        }
        prev = p;
      }
    }
    stats.festoon = li;
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
  // The portal: a heavier timber set at the hall's east side. Detail pass 3:
  // the cap raised under the arch's crown (its ends run into the rock): at
  // 20.3 it sat 1.3 over the eye 14 in front of the key-24.4 camera and filled
  // the top of the frame as one brown box. Now it frames the mouth from the
  // hall and clears the frame as the camera ducks in.
  {
    const f = at(3.5);
    for (const s of [-10.8, 10.8]) tunnel.beam([f.x + f.rx * s, f.y, f.z + f.rz * s], [f.x + f.rx * s, f.y + 22.4, f.z + f.rz * s], 2.2, 2.2, PAL.timber);
    tunnel.beam([f.x - f.rx * 12, f.y + 23.3, f.z - f.rz * 12], [f.x + f.rx * 12, f.y + 23.3, f.z + f.rz * 12], 2.0, 2.6, PAL.timberDark);
  }
  /** An ore cart (P15) on the rails at arc a, or tipped over beside them. */
  const cart = (a: number, tipped: boolean, side = 0) => {
    const f = at(a);
    const yaw = Math.atan2(-f.dz, f.dx);
    const cx = f.x + f.rx * side;
    const cz = f.z + f.rz * side;
    if (!tipped) {
      tunnel.add(u.box, T(cx, f.y + 5.4, cz, 10.5, 5, 7.4, yaw), PAL.rust);
      tunnel.add(u.box, T(cx, f.y + 8.1, cz, 11.1, 0.7, 8, yaw), PAL.iron);
      for (const ax of [-3.4, 3.4]) for (const sg of [-1, 1]) tunnel.add(u.cyl8, T(cx + f.dx * ax + f.rx * sg * 3.3, f.y + 2.1, cz + f.dz * ax + f.rz * sg * 3.3, 1.8, 0.9, 1.8, yaw + Math.PI / 2, Math.PI / 2), PAL.iron, { wet: 0.4 });
      for (let k = 0; k < 5; k++) tunnel.add(u.dode, T(cx + (rnd(k, a) - 0.5) * 6 * f.dx, f.y + 8.6 + rnd(k, a + 1) * 1.2, cz + (rnd(k, a + 2) - 0.5) * 4, 2.2 + rnd(k, a + 3) * 1.5, 1.7, 2.2, k), PAL.ore);
    } else {
      tunnel.add(u.box, T(cx, f.y + 3.9, cz, 10.5, 5, 7.4, yaw, 0, 1.25), PAL.rust);
      tunnel.add(u.cyl8, T(cx - f.rx * 1.5, f.y + 7.2, cz - f.rz * 1.5, 1.8, 0.9, 1.8, yaw + Math.PI / 2, Math.PI / 2), PAL.iron);
      for (let k = 0; k < 14; k++) {
        const s = side - Math.sign(side || 1) * (5 + rnd(k, 31) * 7);
        const d = (rnd(k, 32) - 0.5) * 12;
        tunnel.add(u.dode, T(f.x + f.rx * s + f.dx * d, f.y + 0.9, f.z + f.rz * s + f.dz * d, 1.3 + rnd(k, 33) * 1.6, 1 + rnd(k, 34), 1.4 + rnd(k, 35) * 1.4, k), PAL.ore);
      }
    }
  };
  cart(L * 0.5, false);
  // Pass 3: one parked where the key-27.5 view (arc ~584) meets it ~45 ahead, off the rails' centre.
  cart(630, false, -6);
  // Fix pass 3: L - 58 -> L - 110: at 58 it filled a4's lower left, 32 away, as one plain brown box.
  cart(L - 110, true, 7.5);
  // Fix pass 3: the tunnel's first stretch of south wall is what key 24.4 looks
  // straight at (bare, 25 away): stores stacked against it, a barrel, a pick.
  {
    for (const [a, w, hgt, dy, yaw, col] of [
      [4, 6, 6, 0, 0.2, PAL.timber],
      [10, 5, 5, 0, -0.15, PAL.timberDark],
      [5.5, 4.4, 4.4, 6, 0.5, PAL.timber],
      [22, 5.5, 5.5, 0, 0.35, PAL.timber],
    ] as const) {
      const f = at(a);
      const sd = f.rz > 0 ? 1 : -1;
      tunnel.add(u.box, T(f.x + f.rx * sd * 7.8, f.y + dy + hgt / 2, f.z + f.rz * sd * 7.8, w, hgt, w, yaw), col, { vary: 0.2 });
    }
    const g = at(15.5);
    const sg = g.rz > 0 ? 1 : -1;
    const bx = g.x + g.rx * sg * 8.4;
    const bz = g.z + g.rz * sg * 8.4;
    tunnel.add(u.cyl8, T(bx, g.y + 3.2, bz, 2.5, 6.4, 2.5), PAL.timber, { vary: 0.1 });
    for (const hy of [1, 5.4]) tunnel.add(u.cyl8, T(bx, g.y + hy, bz, 2.6, 0.35, 2.6), PAL.iron, { vary: 0 });
    // A store shelf at eye height (the bare part of the wall is 13-18 up, in the frame's middle).
    for (const pa of [1, 17]) {
      const q = at(pa);
      tunnel.beam([q.x + q.rx * 9.6, q.y, q.z + q.rz * 9.6], [q.x + q.rx * 9.6, q.y + 21, q.z + q.rz * 9.6], 1.1, 1.1, PAL.timberDark);
    }
    for (const sy of [11.5, 17]) {
      const q0 = at(0);
      const q1 = at(18);
      tunnel.beam([q0.x + q0.rx * 9.2, q0.y + sy, q0.z + q0.rz * 9.2], [q1.x + q1.rx * 9.2, q1.y + sy, q1.z + q1.rz * 9.2], 0.5, 3.2, PAL.timber);
    }
    for (const [pa, sy, w, hh2, cl] of [[3.5, 11.9, 3.2, 3, PAL.timber], [7.5, 11.9, 2.6, 2.4, PAL.canvas], [13, 11.9, 3, 3.4, PAL.timberDark], [5, 17.4, 2.4, 2.2, PAL.timberDark], [11.5, 17.4, 2.2, 2.8, PAL.canvas]] as const) {
      const q = at(pa);
      tunnel.add(u.box, T(q.x + q.rx * 9.3, q.y + sy + hh2 / 2, q.z + q.rz * 9.3, w, hh2, 2.4, rnd(pa, 51) * 0.6 - 0.3), cl, { vary: 0.2 });
    }
    {
      const q = at(9.5);
      tunnel.add(u.cyl8, T(q.x + q.rx * 9.1, q.y + 19.2, q.z + q.rz * 9.1, 2.2, 1.3, 2.2), PAL.rope, { vary: 0.1 });
    }
    const h = at(27);
    const sh = h.rz > 0 ? 1 : -1;
    tunnel.beam([h.x + h.rx * sh * 6, h.y + 0.3, h.z + h.rz * sh * 6], [h.x + h.rx * sh * 9.5, h.y + 10, h.z + h.rz * sh * 9.5], 0.5, 0.5, PAL.timber);
    tunnel.beam([h.x + h.rx * sh * 9.5 - h.dx * 2.8, h.y + 9.8, h.z + h.rz * sh * 9.5 - h.dz * 2.8], [h.x + h.rx * sh * 9.5 + h.dx * 2.8, h.y + 10.4, h.z + h.rz * sh * 9.5 + h.dz * 2.8], 0.6, 0.8, PAL.iron, { wet: 0.5 });
  }
  // Pickaxe (P16) against a timber post; a shovel further on.
  {
    const f = at(L * 0.35 - 1);
    const s = 9.6;
    const bx = f.x + f.rx * s;
    const bz = f.z + f.rz * s;
    tunnel.beam([bx - f.rx * 0.6, f.y + 0.4, bz - f.rz * 0.6], [bx + f.rx * 0.6, f.y + 11, bz + f.rz * 0.6], 0.6, 0.6, PAL.timber);
    tunnel.beam([bx - f.dx * 3.2, f.y + 10.6, bz - f.dz * 3.2], [bx + f.dx * 3.2, f.y + 11.4, bz + f.dz * 3.2], 0.7, 0.9, PAL.iron, { wet: 0.5 });
    const g = at(L * 0.7 + 4);
    const sx = g.x - g.rx * 9.6;
    const sz = g.z - g.rz * 9.6;
    tunnel.beam([sx, g.y + 3, sz], [sx - g.rx * 0.5, g.y + 13, sz - g.rz * 0.5], 0.5, 0.5, PAL.timber);
    tunnel.add(u.box, T(sx + g.rx * 0.3, g.y + 1.6, sz + g.rz * 0.3, 2.4, 3.2, 0.3, Math.atan2(-g.dz, g.dx) + Math.PI / 2), PAL.iron, { wet: 0.5 });
  }
  // Crates by the lift (P8, always stacked).
  {
    const f = at(L - 30);
    const s = -8.4;
    const cx = f.x + f.rx * s;
    const cz = f.z + f.rz * s;
    const yaw = Math.atan2(-f.dz, f.dx);
    // Fix pass 3: each crate gets dark corner battens and two bands, so at 32
    // from the a4 stop they read as crates, not one plain brown box.
    const crate = (x: number, y: number, z: number, w: number, ry: number, col: RGB) => {
      tunnel.add(u.box, T(x, y, z, w, w, w, ry), col, { vary: 0.25 });
      for (const by of [-0.28, 0.28]) tunnel.add(u.box, T(x, y + by * w, z, w + 0.2, 0.42, w + 0.2, ry), PAL.timberDark, { vary: 0 });
      const c = Math.cos(ry);
      const sn = Math.sin(ry);
      for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ox = (ax * c + az * sn) * w * 0.5;
        const oz = (-ax * sn + az * c) * w * 0.5;
        tunnel.add(u.box, T(x + ox, y, z + oz, 0.55, w + 0.1, 0.55, ry), PAL.iron, { vary: 0 });
      }
    };
    crate(cx, f.y + 2.7, cz, 5.4, yaw + 0.2, PAL.timber);
    crate(cx + f.dx * 5.8, f.y + 2.4, cz + f.dz * 5.8, 4.8, yaw - 0.1, PAL.timber);
    crate(cx + f.dx * 2.6, f.y + 7.5, cz + f.dz * 2.6, 4.4, yaw + 0.5, PAL.timberDark);
    // A barrel and a coil of rope beside them.
    tunnel.add(u.cyl8, T(cx - f.dx * 5.2 + f.rx * 1.2, f.y + 3.2, cz - f.dz * 5.2 + f.rz * 1.2, 2.5, 6.4, 2.5), PAL.timber, { vary: 0.1 });
    for (const hy of [1, 5.4]) tunnel.add(u.cyl8, T(cx - f.dx * 5.2 + f.rx * 1.2, f.y + hy, cz - f.dz * 5.2 + f.rz * 1.2, 2.6, 0.35, 2.6), PAL.iron, { vary: 0 });
  }
  // The lift's lever post and bell, left of the shaft as the a4 stop sees it.
  {
    const f = at(L - 3);
    const s = -9.8;
    const px = f.x + f.rx * s;
    const pz = f.z + f.rz * s;
    tunnel.add(u.box, T(px, f.y + 6, pz, 1.6, 12, 1.6), PAL.timber);
    tunnel.add(u.box, T(px, f.y + 9.5, pz, 2.4, 1.4, 2.4), PAL.iron);
    tunnel.beam([px, f.y + 9.5, pz], [px + f.dx * 3 + f.rx * 1.5, f.y + 16.5, pz + f.dz * 3 + f.rz * 1.5], 0.5, 0.5, PAL.iron, { wet: 0.5 });
    tunnel.add(u.cyl8, T(px + f.dx * 3 + f.rx * 1.5, f.y + 16.8, pz + f.dz * 3 + f.rz * 1.5, 0.55, 0.7, 0.55), PAL.iron);
    // The bell on a bracket from the wall.
    const wx = f.x + f.rx * -11.6 - f.dx * 4;
    const wz = f.z + f.rz * -11.6 - f.dz * 4;
    tunnel.beam([wx, f.y + 19, wz], [wx + f.rx * 3.2, f.y + 19, wz + f.rz * 3.2], 0.7, 0.7, PAL.iron);
    // Pass 3: a bell shape (waist, flared lip, crown) in dark bronze; the shiny cone read as a gold party hat.
    {
      const bx = wx + f.rx * 3.2;
      const bz = wz + f.rz * 3.2;
      const bronze: RGB = [0.075, 0.05, 0.028];
      tunnel.add(u.cyl8, T(bx, f.y + 17.6, bz, 0.75, 1.5, 0.75), bronze, { wet: 0.3 });
      tunnel.add(u.cyl8, T(bx, f.y + 16.7, bz, 1.05, 0.45, 1.05), bronze, { wet: 0.3 });
      tunnel.add(u.cyl8, T(bx, f.y + 18.5, bz, 0.35, 0.4, 0.35), PAL.iron, { vary: 0 });
    }
    tunnel.beam([wx + f.rx * 3.2, f.y + 16, wz + f.rz * 3.2], [px + f.dx * 0.5, f.y + 11, pz + f.dz * 0.5], 0.18, 0.18, PAL.rope);
  }
  // Puddles beside the rails.
  for (const [a, s] of [[180, 6.5], [470, -7], [640, 7], [1020, -6.5], [1240, 6.8]] as const) {
    const f = at(a);
    puddle(tunnel, f.x + f.rx * s, f.z + f.rz * s, 2.8, a, () => f.y);
  }

  // ── Shaft dressing ──
  const S = SHAFT;
  // A ladder up the north wall (P28), clear of the cage.
  {
    const lx = S.x0 + 6;
    const lz = S.z0 + 1.6;
    for (const dx of [-2, 2]) shaft.add(u.box, T(lx + dx, (S.floorY + S.topY) / 2, lz, 0.6, S.topY - S.floorY, 0.6), PAL.timber, { vary: 0 });
    for (let y = S.floorY + 3; y < S.topY; y += 4.6) shaft.add(u.box, T(lx, y, lz, 4.4, 0.35, 0.35), PAL.timberDark, { vary: 0.2 });
  }
  // Steel guides along the east wall: lines that run up to the sky.
  for (const dz of [-6, 6]) shaft.add(u.box, T(S.x1 - 2.2, (S.floorY + S.topY) / 2, S.z + dz, 0.35, S.topY - S.floorY, 0.35), PAL.iron, { vary: 0 });
  // Pass 3: the shaft walls (bible 6 the shaft). Rock sheets tilted off the
  // wall so every face takes its own light, in three strata bands; a timber
  // cribbing set every 40; a bright lip at the collar with grass hanging in.
  {
    // Detail pass 3: cool greys with one warmer band, darker, a wide value
    // spread (the sheets read as beige panels under the daylight).
    const strata: RGB[] = [
      [0.085, 0.09, 0.1],
      [0.105, 0.092, 0.082],
      [0.07, 0.076, 0.088],
    ];
    /** Clear of the lamps on the north and south walls. */
    const byLamp = (axis: number, out: number, along: number, y: number) =>
      axis === 1 && shaftLamps.some(([ly, sz, lx]) => sz === -out && Math.abs(along - lx) < 4.5 && Math.abs(y - ly) < 5);
    const walls: [number, number, number, number, number][] = [
      // [fixed coord, axis (0 = x fixed, 1 = z fixed), along0, along1, outward sign]
      [S.x0, 0, S.z0, S.z1, 1],
      [S.x1, 0, S.z0, S.z1, -1],
      [S.z0, 1, S.x0, S.x1, 1],
      [S.z1, 1, S.x0, S.x1, -1],
    ];
    let seed = 0;
    for (const [fix, axis, a0, a1, out] of walls) {
      for (let y = S.floorY + 5; y < S.topY - 3; y += 8.5) {
        const band = strata[Math.floor((y - S.floorY) / 26) % 3];
        for (let k = 0; k < 3; k++, seed++) {
          const along = a0 + ((k + 0.5 + (rnd(seed, 71) - 0.5) * 0.5) / 3) * (a1 - a0);
          // Clear of the ladder (north wall, west end) and the steel guides (east wall).
          if (axis === 1 && out === 1 && along < S.x0 + 12) continue;
          if (axis === 0 && out === -1 && Math.abs(along - S.z) < 9) continue;
          // The tunnel comes in through the west wall at the foot: keep its mouth open.
          if (axis === 0 && out === 1 && y < S.floorY + 48) continue;
          if (byLamp(axis, out, along, y)) continue;
          const w = 9 + rnd(seed, 72) * 5;
          const hgt = 6.5 + rnd(seed, 73) * 4;
          const d = 2.2 + rnd(seed, 74) * 1.4;
          const tiltA = (rnd(seed, 75) - 0.5) * 0.5;
          const tiltB = (rnd(seed, 76) - 0.35) * 0.6;
          const yy = y + (rnd(seed, 77) - 0.5) * 3;
          const v = 0.6 + rnd(seed, 78) * 0.7;
          const c: RGB = [band[0] * v, band[1] * v, band[2] * v];
          if (axis === 0) shaft.add(u.box, T(fix + out * 0.4, yy, along, d, hgt, w, tiltA * 0.4, tiltA, tiltB * out), c, { vary: 0.15 });
          else shaft.add(u.box, T(along, yy, fix + out * 0.4, w, hgt, d, tiltA * 0.4, tiltB * out, tiltA), c, { vary: 0.15 });
        }
      }
    }
    // The top 60 (key 36.5 sees this wall at ~16 away): smaller, steeper-tilted
    // facets with a wider value spread, so the daylight breaks into many planes.
    for (const [fix, axis, a0, a1, out] of walls) {
      for (let y = S.topY - 62; y < S.topY - 2; y += 4.2) {
        for (let k = 0; k < 6; k++, seed++) {
          const along = a0 + ((k + 0.5 + (rnd(seed, 91) - 0.5) * 0.6) / 6) * (a1 - a0);
          if (axis === 1 && out === 1 && along < S.x0 + 12) continue;
          if (axis === 0 && out === -1 && Math.abs(along - S.z) < 9) continue;
          if (byLamp(axis, out, along, y)) continue;
          const w = 3.5 + rnd(seed, 92) * 3.5;
          const hgt = 2.6 + rnd(seed, 93) * 2.4;
          const d = 1.6 + rnd(seed, 94) * 1.2;
          const tiltA = (rnd(seed, 95) - 0.5) * 0.9;
          const tiltB = (rnd(seed, 96) - 0.3) * 1.0;
          const band = strata[Math.floor((y - S.floorY) / 9) % 3];
          const v = 0.55 + rnd(seed, 97) * 0.7;
          const mossy = rnd(seed, 98) < 0.18;
          const c: RGB = mossy ? [0.05 * v, 0.07 * v, 0.03 * v] : [band[0] * v * 0.85, band[1] * v * 0.85, band[2] * v * 0.85];
          const yy = y + (rnd(seed, 99) - 0.5) * 2;
          if (axis === 0) shaft.add(u.box, T(fix + out * 1.3, yy, along, d, hgt, w, tiltA * 0.5, tiltA, tiltB * out), c, { vary: 0.15 });
          else shaft.add(u.box, T(along, yy, fix + out * 1.3, w, hgt, d, tiltA * 0.5, tiltB * out, tiltA), c, { vary: 0.15 });
        }
      }
    }
    // Cribbing: a timber set every 40 (four wall plates and the corner posts' blocks).
    for (let y = S.floorY + 40; y < S.topY - 10; y += 40) {
      shaft.add(u.box, T(S.x0 + 1.1, y, S.z, 2.2, 2.4, S.z1 - S.z0), PAL.timberDark, { vary: 0.2 });
      shaft.add(u.box, T(S.x1 - 1.1, y, S.z, 2.2, 2.4, S.z1 - S.z0), PAL.timberDark, { vary: 0.2 });
      shaft.add(u.box, T(S.x, y, S.z0 + 1.1, S.x1 - S.x0, 2.4, 2.2), PAL.timber, { vary: 0.2 });
      shaft.add(u.box, T(S.x, y, S.z1 - 1.1, S.x1 - S.x0, 2.4, 2.2), PAL.timber, { vary: 0.2 });
      for (const cx of [S.x0 + 1.4, S.x1 - 1.4]) for (const cz of [S.z0 + 1.4, S.z1 - 1.4]) shaft.add(u.box, T(cx, y - 5, cz, 2, 10, 2), PAL.timberDark, { vary: 0 });
    }
    // The collar's lip: a hard bright line of turf and rock at y 622, with
    // grass and a few stones hanging over into the shaft.
    const turf: RGB = [0.1, 0.11, 0.05];
    for (const [fix, axis, a0, a1, out] of walls) {
      for (let k = 0; k < 6; k++, seed++) {
        const along = a0 + ((k + 0.5) / 6) * (a1 - a0);
        const w = (a1 - a0) / 6 + 1.5;
        if (axis === 0) shaft.add(u.box, T(fix + out * 1.2, S.topY - 0.6, along, 3.4, 1.6, w, 0, 0, out * -0.12), turf, { vary: 0.2 });
        else shaft.add(u.box, T(along, S.topY - 0.6, fix + out * 1.2, w, 1.6, 3.4, 0, out * 0.12, 0), turf, { vary: 0.2 });
        // Grass tufts hanging over the edge.
        for (let g = 0; g < 3; g++) {
          const ga = along + (rnd(seed * 3 + g, 81) - 0.5) * w;
          const gl = 2.5 + rnd(seed * 3 + g, 82) * 4;
          const gc: RGB = [0.07 + rnd(seed * 3 + g, 83) * 0.05, 0.09, 0.035];
          if (axis === 0) shaft.add(u.box, T(fix + out * 2.2, S.topY - 1.2 - gl / 2, ga, 0.3, gl, 0.5, 0, 0, out * -0.35), gc, { vary: 0.2 });
          else shaft.add(u.box, T(ga, S.topY - 1.2 - gl / 2, fix + out * 2.2, 0.5, gl, 0.3, 0, out * 0.35, 0), gc, { vary: 0.2 });
        }
        if (k % 2 === 0) {
          const ra = along + (rnd(seed, 84) - 0.5) * w * 0.6;
          const rs = 2 + rnd(seed, 85) * 1.8;
          if (axis === 0) shaft.add(u.box, T(fix + out * 1.6, S.topY - 2.2, ra, rs, rs * 0.8, rs * 1.2, rnd(seed, 86), 0.3, 0.4), [0.2, 0.17, 0.14], { vary: 0.2 });
          else shaft.add(u.box, T(ra, S.topY - 2.2, fix + out * 1.6, rs * 1.2, rs * 0.8, rs, rnd(seed, 86), 0.4, 0.3), [0.2, 0.17, 0.14], { vary: 0.2 });
        }
      }
    }
    // Detail pass 3: roots hanging down the top of each wall from the turf
    // (two kinked segments, dark against the cold-lit rock) and ferns in the
    // cracks, so the last seconds of the ride (key 36.5) read as the top of
    // a real shaft, not a wall of panels.
    const rootC: RGB = [0.05, 0.035, 0.025];
    for (const [fix, axis, a0, a1, out] of walls) {
      for (let k = 0; k < 9; k++, seed++) {
        const along = a0 + ((k + 0.3 + rnd(seed, 101) * 0.4) / 9) * (a1 - a0);
        if (axis === 1 && out === 1 && along < S.x0 + 9) continue;
        if (axis === 0 && out === -1 && Math.abs(along - S.z) < 7) continue;
        const len = 3 + rnd(seed, 102) * 7; // short: longer ones crossed the whole key-36.5 frame like poles
        const off = 2.4 + rnd(seed, 103) * 0.8;
        const kink = (rnd(seed, 104) - 0.5) * 2.4;
        const p = (d: number, y: number, a: number): V3 => (axis === 0 ? [fix + out * d, y, a] : [a, y, fix + out * d]);
        const top = p(off, S.topY - 0.8, along);
        const mid = p(off + 0.4, S.topY - 0.8 - len * 0.55, along + kink);
        const end = p(off - 0.2, S.topY - 0.8 - len, along + kink * 1.6);
        shaft.beam(top, mid, 0.2, 0.2, rootC, { vary: 0.3 });
        shaft.beam(mid, end, 0.12, 0.12, rootC, { vary: 0.3 });
      }
      for (let k = 0; k < 5; k++, seed++) {
        const along = a0 + ((k + 0.5) / 5) * (a1 - a0) + (rnd(seed, 105) - 0.5) * 3;
        if (axis === 1 && out === 1 && along < S.x0 + 9) continue;
        if (axis === 0 && out === -1 && Math.abs(along - S.z) < 7) continue;
        const y = S.topY - 4 - rnd(seed, 106) * 14;
        if (byLamp(axis, out, along, y)) continue;
        const s = 1.6 + rnd(seed, 107) * 1.4;
        const base: V3 = axis === 0 ? [fix + out * 2.6, y, along] : [along, y, fix + out * 2.6];
        const fern: RGB = [0.035 + rnd(seed, 108) * 0.02, 0.05, 0.028];
        for (let f = 0; f < 5; f++) {
          const a = -1.1 + (f / 4) * 2.2;
          const dx = Math.sin(a) * s * 1.6;
          const dy = Math.cos(a) * s * 0.9 - 0.4;
          const tip: V3 = axis === 0 ? [base[0] + out * s * 1.2, y + dy, along + dx] : [along + dx, y + dy, base[2] + out * s * 1.2];
          const l: V3 = axis === 0 ? [base[0], y, along - 0.4] : [along - 0.4, y, base[2]];
          const r: V3 = axis === 0 ? [base[0], y, along + 0.4] : [along + 0.4, y, base[2]];
          shaft.tri(l, tip, r, fern);
          shaft.tri(r, tip, l, fern);
        }
      }
    }
  }
  // Cool daylight pooled at the foot, so the cage stands in it (steady, not a
  // flame). Pass 3: blue-white, so the cage is the coolest, brightest thing at a4
  // against the warm torches (bible 6 a4).
  // Pass 3: 2.6 -> 2.0, the shaft's back wall read as beige panels as bright as the cage.
  lamps.push({ x: S.x, y: S.floorY + 34, z: S.z, col: [0.6, 0.74, 0.95], i: 2.0, r: 26, wrap: 0.4, flame: false });
  sprite([S.x, S.floorY + 110, S.z], 3, 22, [0.62, 0.72, 0.84], 1.15, [0, -108, 0]);
  // The column of daylight (E9) and its dust (E6).
  sprite([S.x, S.topY + 6, S.z], 3, 24, [0.46, 0.54, 0.66], 1.2, [0, -(S.topY - S.floorY), 0]);
  sprite([S.x + 3, S.topY, S.z - 2], 3, 12, [0.56, 0.64, 0.76], 0.9, [0, -(S.topY - S.floorY - 20), 0]);
  for (let k = 0; k < 40; k++) sprite([S.x + (rnd(k, 51) - 0.5) * 20, S.floorY + 4 + rnd(k, 52) * 70, S.z + (rnd(k, 53) - 0.5) * 20], 2, 0.4, [1.1, 1.0, 0.9], 0.9, [3, 5, 3]);
  for (let k = 0; k < 30; k++) sprite([S.x + (rnd(k, 54) - 0.5) * 26, S.floorY + 80 + rnd(k, 55) * (S.topY - S.floorY - 90), S.z + (rnd(k, 56) - 0.5) * 26], 2, 0.5, [1.0, 0.9, 0.8], 0.8, [4, 8, 4]);

  // ── The cage (the a4 landmark): built at the foot, local to (S.x, S.floorY, S.z) ──
  const h = LIFT.height;
  const q = LIFT.size / 2 - 0.9;
  {
    const X = S.x;
    const Y = S.floorY;
    const Z = S.z;
    for (let k = 0; k < 6; k++) cage.add(u.box, T(X, Y - 0.7, Z - LIFT.size / 2 + (k + 0.5) * (LIFT.size / 6), LIFT.size, 1.4, LIFT.size / 6 - 0.25), PAL.timber, { vary: 0.25 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      cage.add(u.box, T(X + sx * q, Y + h / 2, Z + sz * q, 1.8, h, 1.8), PAL.timberDark, { vary: 0 });
      for (const cy of [1.5, h * 0.5, h - 1.5]) cage.add(u.box, T(X + sx * q, Y + cy, Z + sz * q, 2.3, 1.3, 2.3), PAL.iron, { vary: 0 });
      // Pass 3: thinner and near black: lit grey by the baked foot daylight they slashed the ride frames.
      cage.beam([X + sx * q, Y + h, Z + sz * q], [X, Y + h + 15, Z], 0.12, 0.12, [0.012, 0.011, 0.011], { vary: 0 });
    }
    // Top frame round the edges (the middle stays open: the camera rides looking up).
    for (const s of [-1, 1]) {
      // Fix pass 3: thin iron bars (the 1.4 timbers crossed the whole frame as a brown beam near the collar, key 36.5).
      cage.add(u.box, T(X, Y + h, Z + s * q, LIFT.size - 1, 0.55, 0.55), PAL.iron, { vary: 0 });
      cage.add(u.box, T(X + s * q, Y + h, Z, 0.55, 0.55, LIFT.size - 1), PAL.iron, { vary: 0 });
    }
    // The hoist ring and its yoke.
    // Pass 3: smaller (1.4 -> 0.85): from inside the ride it sat over the square of sky as a big grey octagon.
    cage.add(u.torus, T(X, Y + h + 15.4, Z, 0.85, 0.85, 0.85, 0, Math.PI / 2), [0.015, 0.014, 0.014], { vary: 0 });
    cage.add(u.box, T(X, Y + h + 16.4, Z, 2.2, 0.8, 0.8), [0.015, 0.014, 0.014], { vary: 0 });
    // Slatted sides east and south, a gate rail north; the west (the way in) has its gate folded back.
    // Pass 3: an open frame you see through (the wall of slats read as a jail
    // cell): two thick rails, a mid post and one diagonal brace a side, iron shoes.
    for (const ry of [h * 0.36, h * 0.7]) {
      cage.add(u.box, T(X + q, Y + ry, Z, 1.5, 1.5, LIFT.size - 1.5), PAL.timber, { vary: 0.2 });
      cage.add(u.box, T(X, Y + ry, Z + q, LIFT.size - 1.5, 1.5, 1.5), PAL.timber, { vary: 0.2 });
    }
    cage.add(u.box, T(X + q, Y + h / 2, Z, 1.3, h - 2, 1.3), PAL.timberDark, { vary: 0 });
    cage.add(u.box, T(X, Y + h / 2, Z + q, 1.3, h - 2, 1.3), PAL.timberDark, { vary: 0 });
    cage.beam([X + q, Y + 1, Z - q], [X + q, Y + h * 0.7, Z], 0.9, 0.9, PAL.timberDark);
    cage.beam([X - q, Y + 1, Z + q], [X, Y + h * 0.7, Z + q], 0.9, 0.9, PAL.timberDark);
    for (const [sx, sz] of [[1, 0], [0, 1]]) cage.add(u.box, T(X + sx * q, Y + h * 0.36, Z + sz * q, 2.1, 2.1, 2.1), PAL.iron, { vary: 0 });
    for (const gy of [5, 10.5]) cage.add(u.box, T(X, Y + gy, Z - q, LIFT.size - 2, 0.9, 0.9), PAL.timber);
    cage.beam([X - q, Y + 1, Z - q], [X + q, Y + 10.5, Z - q], 0.7, 0.7, PAL.timberDark);
    for (let k = 0; k < 4; k++) cage.add(u.box, T(X - q - 0.2, Y + h * 0.42, Z + q - 1.4 - k * 0.9, 0.3, h * 0.8, 0.3), PAL.iron, { vary: 0 });
    for (let k = 0; k < 3; k++) cage.beam([X - q - 0.3, Y + 2 + k * 6, Z + q - 1.4], [X - q - 0.3, Y + 8 + k * 6, Z + q - 4.1], 0.25, 0.25, PAL.iron);
    // The lantern on the front-left post, facing the tunnel.
    const lx = X - q - 1.6;
    const lz = Z - q + 2.2;
    cage.beam([X - q, Y + 19.5, Z - q + 1], [lx, Y + 19.5, lz], 0.4, 0.4, PAL.iron);
    // Pass 3: a caged lantern (the glowing box under a cone read as a party hat).
    lanternHead(cage, lx, Y + 17.6, lz, 1.6, 2.4, 10);
    sprite([lx, Y + 16.4, lz], 10, 2.2, GLOW.lantern, 0.9);
    sprite([lx, Y + 17.6, lz], 11, 14, [1.0, 0.55, 0.22], 0.6);
    lamps.push({ x: lx + 1, y: Y + 17.6, z: lz + 1, col: [1.0, 0.64, 0.34], i: 1.6, r: 16, wrap: 0.3, flame: true });
  }

  // ── Bake ──
  const ambientAt = (x: number, y: number, z: number): RGB => {
    if (z > CAVE.footZ + 1) return AMBIENT.outside;
    if (x < -6) return AMBIENT.cave;
    if (x < S.x0 - 1) return AMBIENT.tunnel;
    return y > S.floorY + 40 ? AMBIENT.shaft : AMBIENT.tunnel;
  };
  const dayAt = (x: number, y: number, z: number, ny: number): number => {
    const inX = x > S.x0 - 30 && x < S.x1 + 2 && z > S.z0 - 2 && z < S.z1 + 2;
    if (!inX) return 0;
    const spill = x < S.x0 ? Math.exp(-(S.x0 - x) / 14) : 1;
    // Pass 3: cool daylight held to the top ~60 (a hard bright collar), a faint
    // long tail below, so the walls run dark warm to a lit lip, not one flat wash.
    const down = Math.max(0, S.topY - y);
    // Detail pass 3: a longer cool tail, so looking up the walls run dark to
    // cold-lit toward the square of sky (a gradient, not a lit lip on black).
    return DAY.i * (0.7 * Math.exp(-down / 45) + 0.42 * Math.exp(-down / 200)) * (0.45 + 0.55 * Math.max(0, ny)) * spill;
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
    const [al, w] = recolour(PAL.caveRock)(r, g, b);
    // Wetter toward the mouth.
    return [al, Math.max(w, 0.5 * smooth(1200, 1296, z))];
  });
  if (shells.Mine_Tunnel) tunnel.adopt(shells.Mine_Tunnel.geometry, shellOrigin(shells.Mine_Tunnel), recolour(PAL.tunnelRock));
  if (shells.Mine_Shaft) shaft.adopt(shells.Mine_Shaft.geometry, shellOrigin(shells.Mine_Shaft), recolour(PAL.shaftRock));
  const caveO = new THREE.Vector3(CAVE.hallX, CAVE.floorY, CAVE.hallZ);
  const tunO = new THREE.Vector3(700, 80, 1110);
  const shaftO = new THREE.Vector3(S.x, (S.floorY + S.topY) / 2, S.z);
  const cageO = new THREE.Vector3(S.x, S.floorY, S.z);
  const gCave = track(bake(cave, caveO, lamps, ambientAt, dayAt));
  const gTunnel = track(bake(tunnel, tunO, lamps, ambientAt, dayAt));
  const gShaft = track(bake(shaft, shaftO, lamps, ambientAt, dayAt));
  // The cage takes the tunnel's torches as flame light (faded as it rises) and its own lantern.
  const gCage = track(bake(cage, cageO, lamps, () => [0.16, 0.13, 0.11], () => 0));
  stats.bakeMs = Math.round(performance.now() - tb0);

  // ── Materials ──
  const wallU = {
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
  const cageGain = { value: 1 };
  const cageFlameK = { value: 1 };
  const cageMat = wallMat("UgLiftCage", { uCaus: { value: new THREE.Vector4(0, 0, 0, 0) }, uGain: cageGain, uFlameK: cageFlameK });

  // ── Meshes ──
  const root = new THREE.Group();
  root.name = "UG_Mine";
  (ctx.root ?? scene).add(root);
  const mk = (g: THREE.BufferGeometry, m: THREE.Material, name: string, o: THREE.Vector3, parent: THREE.Object3D = root) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    mesh.position.copy(o);
    parent.add(mesh);
    return mesh;
  };
  mk(gCave, caveMat, "UG_Cave", caveO);
  mk(gTunnel, mineMat, "UG_Tunnel", tunO);
  mk(gShaft, mineMat, "UG_Shaft", shaftO);

  // The cage and its cables ride in LM_MineLift.
  const lm = find("LM_MineLift") ?? root;
  const lmPos = new THREE.Vector3();
  lm.getWorldPosition(lmPos);
  if (lm === root) lmPos.set(0, 0, 0);
  const cageGroup = new THREE.Group();
  cageGroup.name = "UG_LiftCageGroup";
  lm.add(cageGroup);
  mk(gCage, cageMat, "UG_LiftCage", new THREE.Vector3(), cageGroup);
  const cableKit = new Kit(u);
  for (const dx of [-0.7, 0.7]) cableKit.add(u.box, T(dx, 0.5, 0, 0.4, 1, 0.4), PAL.iron, { vary: 0 });
  const gCable = track(bake(cableKit, new THREE.Vector3(), [], () => [0.5, 0.45, 0.4], () => 0));
  const cables = mk(gCable, cageMat, "UG_LiftCables", new THREE.Vector3(), lm);
  cables.frustumCulled = false;
  const SHEAVE_Y = S.topY + 60;
  const nKeys = TRAIL.length - 1;
  const tShaft0 = SHAFT_KEYS.first / nKeys;
  const tShaft1 = SHAFT_KEYS.last / nKeys;
  let cageY = NaN;
  const placeCage = (y: number) => {
    cageY = y;
    cageGroup.position.set(S.x - lmPos.x, y - S.floorY + (S.floorY - lmPos.y), S.z - lmPos.z);
    const top = y + h + 17.6;
    cables.position.set(S.x - lmPos.x, top - lmPos.y, S.z - lmPos.z);
    cables.scale.set(1, Math.max(0.1, SHEAVE_Y - top), 1);
    // Daylight on the cage as it rises; the tunnel's torches fade behind it.
    cageGain.value = 1 + 5 * Math.exp(-(S.topY - y) / DAY.fall);
    cageFlameK.value = 1 - smooth(0, 60, y - S.floorY);
  };
  placeCage(S.floorY);

  // ── Glow sprites (one instanced additive call) ──
  // Amber shafts where the late-afternoon sun cuts the gorge's mist (bible 6 the dive).
  {
    const k = LIGHTS["late-afternoon"];
    const az = (k.sunAz * Math.PI) / 180;
    const el = (k.sunEl * Math.PI) / 180;
    const dir: V3 = [-Math.sin(az) * Math.cos(el), -Math.sin(el), Math.cos(az) * Math.cos(el)];
    const F = WORLD.falls;
    for (let r = 0; r < 3; r++) {
      const len = 260 + r * 60;
      const mid: V3 = [F.bottom[0] - 10 + r * 30, 150 + r * 55, F.bottom[2] + 40 + r * 20];
      const p: V3 = [mid[0] - dir[0] * len * 0.5, mid[1] - dir[1] * len * 0.5, mid[2] - dir[2] * len * 0.5];
      // Pass 3: half as strong (with the mist they whited out the pool shot, key 19).
      sprite(p, 3, 34 + r * 10, [1.0, 0.6, 0.3], 0.18 - r * 0.04, [dir[0] * len, dir[1] * len, dir[2] * len]);
    }
  }
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
    glowGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(650, 300, 1180), 1100);
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
    // Lying on the pool.
    for (let k = 0; k < 16; k++, s++) mistInst.push({ p: [pool.x + (rnd(s, 61) - 0.5) * 170, pool.y + 8 + rnd(s, 62) * 14, pool.z - 50 + rnd(s, 63) * 110], size: 46 + rnd(s, 64) * 34, seed: rnd(s, 65), rate: 0.03 + rnd(s, 66) * 0.03, a: 0.13, sun: 0.35 + rnd(s, 67) * 0.4, glow: 0, rise: 0.25 });
    // Spray climbing the curtain's foot.
    for (let k = 0; k < 12; k++, s++) mistInst.push({ p: [F.bottom[0] + (rnd(s, 61) - 0.5) * 120, F.bottom[1] + 10 + rnd(s, 62) * 40, F.bottom[2] + 14 + rnd(s, 63) * 16], size: 30 + rnd(s, 64) * 26, seed: rnd(s, 65), rate: 0.08 + rnd(s, 66) * 0.06, a: 0.16, sun: 0.6, glow: 0, rise: 1.4 });
    // A veil in the shade up the dive, along the walls.
    for (let k = 0; k < 8; k++, s++) {
      const side = k % 2 ? -1 : 1;
      mistInst.push({ p: [F.bottom[0] + side * (70 + rnd(s, 61) * 30), 150 + rnd(s, 62) * 220, F.bottom[2] + 10 + rnd(s, 63) * 30], size: 60 + rnd(s, 64) * 40, seed: rnd(s, 65), rate: 0.02 + rnd(s, 66) * 0.02, a: 0.07, sun: 0.1, glow: 0, rise: 0.4 });
    }
    // Fix pass 3: a bank of spray across the foot, in front of the key-19 camera
    // (it sits at z 1400, 104 up), so the pool's lower third dissolves into mist.
    for (let k = 0; k < 14; k++, s++) mistInst.push({ p: [F.bottom[0] + (rnd(s, 61) - 0.5) * 130, F.bottom[1] + 4 + rnd(s, 62) * 22, F.bottom[2] + 20 + rnd(s, 63) * 45], size: 38 + rnd(s, 64) * 30, seed: rnd(s, 65), rate: 0.05 + rnd(s, 66) * 0.05, a: 0.24, sun: 0.55, glow: 0, rise: 0.7 });
    // Just inside the cave mouth: haze lit by the curtain from behind.
    for (let k = 0; k < 9; k++, s++) mistInst.push({ p: [CAVE.x + (rnd(s, 61) - 0.5) * 70, CAVE.floorY + 6 + rnd(s, 62) * 40, CAVE.footZ - 8 - rnd(s, 63) * 22], size: 22 + rnd(s, 64) * 18, seed: rnd(s, 65), rate: 0.04 + rnd(s, 66) * 0.03, a: 0.18, sun: 0, glow: 1, rise: 0.3 });
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
    mistGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(WORLD.falls.bottom[0], 180, WORLD.falls.bottom[2] + 30), 320);
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
  const mistMesh = new THREE.Mesh(mistGeo, mistMat);
  mistMesh.name = "UG_Mist";
  mistMesh.renderOrder = 3;
  (ctx.root ?? scene).add(mistMesh);

  // ── The curtain: adopted on the first frame (after surfaces.ts has its own) ──
  let curtainMat: THREE.ShaderMaterial | null = null;
  let curtainMesh: THREE.Mesh | null = null;
  let curtainWas: THREE.Material | THREE.Material[] | null = null;
  const ownCurtainU = {
    uTime: { value: 0 },
    uBack: { value: 0 },
    uSunSide: { value: 0 },
    uSunFront: { value: 0.3 },
    uDay: { value: 1 },
    uLit: { value: new THREE.Color("#f0e9da") },
    uShade: { value: new THREE.Color("#7d90a2") },
    uSky: { value: new THREE.Color(0.8, 0.7, 0.6) },
    uFoamC: { value: new THREE.Color("#eee6d6") },
    uGlow: { value: new THREE.Color("#f2c898").multiplyScalar(1.1) },
  };
  let curtainTries = 0;
  const adoptCurtain = (): boolean => {
    const mesh = find("Landmark_a3_Water") as THREE.Mesh | null;
    if (!mesh || !mesh.isMesh) return false;
    if (mesh.material === curtainMat) return false;
    const was = mesh.material as THREE.ShaderMaterial;
    // Wait a few frames for surfaces.ts to adopt blocks.ts's; then take whatever is there.
    if (was.name !== "SurfCurtain" && curtainTries++ < 20) return false;
    if (!mesh.geometry.getAttribute("aDrop") || !mesh.geometry.getAttribute("aSheet")) return false;
    const shared: Record<string, { value: unknown }> = {};
    for (const [k, v] of Object.entries(ownCurtainU)) shared[k] = was.uniforms && was.uniforms[k] ? was.uniforms[k] : v;
    curtainMat = track(
      new THREE.ShaderMaterial({
        name: "UgCurtain",
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
        vertexShader: CURTAIN_VERT,
        fragmentShader: CURTAIN_FRAG,
        transparent: true,
        depthWrite: true,
        side: THREE.DoubleSide,
        fog: true,
      }),
    );
    Object.assign(curtainMat.uniforms, shared);
    curtainMesh = mesh;
    curtainWas = mesh.material;
    mesh.material = curtainMat;
    stats.curtainFrom = was.name || "?";
    // Its sheen on the cave's wet rock takes the same glow.
    const g = shared.uGlow.value as THREE.Color;
    if (g && g.isColor) wallU.uSheen.value = g;
    return true;
  };

  // ── Stats ──
  const tris = (g: THREE.BufferGeometry) => g.getAttribute("position").count / 3;
  stats.trianglesTotal = Math.round(tris(gCave) + tris(gTunnel) + tris(gShaft) + tris(gCage) + tris(gCable) + glowInst.length * 2 + mistInst.length * 2);
  stats.trianglesCave = Math.round(tris(gCave));
  stats.trianglesTunnel = Math.round(tris(gTunnel));
  stats.trianglesShaft = Math.round(tris(gShaft));
  stats.trianglesCage = Math.round(tris(gCage) + tris(gCable));
  stats.sprites = glowInst.length;
  stats.mistCards = mistInst.length;
  stats.drawCalls = 7;
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
      if (!curtainMat && adoptCurtain()) changed = true;
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
      const fallsNear = camPos.distanceTo(_a.set(WORLD.falls.bottom[0], 200, WORLD.falls.bottom[2])) < 3200;
      if (fallsNear !== mistMesh.visible) {
        mistMesh.visible = fallsNear;
        changed = true;
      }
      // The lift: waits at the foot, rides with the camera up the shaft, stays at the top.
      const tt = ctx.railU();
      const y = tt < tShaft0 ? S.floorY : tt > tShaft1 ? S.topY : liftCageY(camPos.y);
      if (Math.abs(y - cageY) > 1e-4 || Number.isNaN(cageY)) {
        placeCage(y);
        glowU.uCage.value = y - S.floorY;
        changed = true;
      }
      // Fade distances for the glow follow the fog ramp.
      const fog = scene.fog as THREE.Fog | null;
      if (fog && (fog as THREE.Fog).isFog) glowU.uFade.value.set(Math.max(40, fog.near * 0.6 + 60), Math.max(160, fog.far * 0.9));
      // The mist takes the sun and haze of the moment.
      mistU.uLit.value.copy(ctx.sunColor).multiplyScalar(0.75).lerp(ctx.hazeColor, 0.25);
      mistU.uShade.value.copy(ctx.hazeColor).multiplyScalar(0.62);
      if (curtainMat) mistU.uGlowC.value.copy(curtainMat.uniforms.uGlow.value as THREE.Color).multiplyScalar(0.8);
      const inMine = mineOn && camPos.x > IN_MINE.x0 && camPos.x < IN_MINE.x1 && camPos.z > IN_MINE.z0 && camPos.z < IN_MINE.z1 && camPos.y < IN_MINE.y1;
      let mistSeen = false;
      if (fallsNear) {
        pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        frustum.setFromProjectionMatrix(pm);
        mistSeen = frustum.intersectsSphere(sph.copy(mistGeo.boundingSphere!));
      }
      animating = !reduced && (inMine || mistSeen);
      if (animating || changed) {
        wallU.uTime.value = t;
        glowU.uTime.value = t;
        mistU.uTime.value = t;
        if (!curtainMat) ownCurtainU.uTime.value = t;
      }
      return changed || animating;
    },
    isAnimating: () => animating,
    stats: () => ({ ...stats }),
    dispose() {
      for (const o of hidden) o.visible = true;
      if (curtainMesh && curtainWas) curtainMesh.material = curtainWas;
      root.removeFromParent();
      mistMesh.removeFromParent();
      cageGroup.removeFromParent();
      cables.removeFromParent();
      for (const d of disposables) d.dispose();
      if (scene.userData.dressUnderground === api) delete scene.userData.dressUnderground;
    },
  };
};
