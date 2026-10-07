/**
 * V5 dressing module: THE LAKE AND THE FOREST (world_art_bible.md 4.2, 4.5,
 * 6 "From the collar to the lake", a5, "The crossing", a6, "The rise").
 *
 * WHAT IT ADDS
 *   a5 The Mirror Lake
 *     - LM_Boathouse: a crafted boathouse on piles. Stained board and batten
 *       walls, a steep slate roof with a cupola and weathervane, a stone
 *       chimney through a lean-to, a porch with a hanging lantern, gold
 *       windows (lamp glow), a deck railing, a life ring, a fishing rod
 *       against the wall (story pair), barrels, crates and oars.
 *     - Set_a5: the jetty as the leading line (planks with gaps, pile pairs,
 *       four lantern posts), the white rowboat tied alongside (its own mesh,
 *       bobbing), a reed bed at the piles, the jetty foot and the lower left
 *       of the stop's frame, lily pads with a few flowers (NO_REFLECT_LAYER:
 *       flat on the water, the mirror would only draw them twice), a canoe
 *       pulled up on the shore, a supply cache and a blazed post at the
 *       jetty's foot, and lamp halos for the windows and lanterns.
 *     - LakeFrame (pass 3, NO_REFLECT_LAYER): a rock islet with reeds and a
 *       leaning spruce, the dark framing shape on the stop's lower left.
 *   The walk from the collar (Set_meadow): cairns about every 110 along the
 *     trail, a fallen log over the brook with a root plate.
 *   a6 The Glowing Forest
 *     - M1 giant elders (4.2) in two species, instanced, 3 LODs with per
 *       frame compaction (bible 5.3): the TIERED elder (twisted column trunk,
 *       buttress roots with glowing veins, 3 stacked flat disc canopies plus a
 *       side pad, cyan shelf fungi) and the WEEPING elder (leaning trunk split
 *       into two limbs, lobed crowns, glowing strands with bulbs, violet).
 *       LOD2 is one shared 14 tri shape with a teal underside, so the forest
 *       reads as teal points across the lake. The trees are culled against
 *       the view AND its mirror in the lake, so the reflection keeps them.
 *     - LM_GreatTree: the hero. A twisted 12 sided trunk, ten buttress roots,
 *       veins pulsing from the root tips up the trunk, seven limbs into a crown
 *       of 15 cloud pads (niwaki) whose undersides glow teal and violet, 36
 *       hanging light vines with bulbs, seed lights, a ring of glowcaps.
 *     - Spores rising round the Great Tree's roots (one Points call).
 *     - ForestFloorSet (pass 3): surface roots with pulsing veins from the
 *       giants near the trail, and a path of pale flat stones along it.
 *     - ForestGlowPools (pass 3): additive discs of teal and violet light on
 *       the ground under the giants, round the Great Tree and along the walk.
 *   The rise: the FloatingSteps keep blocks.ts's InstancedMesh and its
 *     animation; only their geometry and material are swapped for carved
 *     stone slabs: chamfered tops, a moss cap with tufts, a jagged rock keel,
 *     hanging roots, and small glowing runes on the sides and a rune ring on
 *     top.
 * (M2 lantern willows, M3 glowcaps and M4 glow ferns are forest.ts's; the
 * glowing moss is cover.ts's; the lake's reflection is light.ts's.)
 *
 * REPLACES (removed from their parents at install, by name, from blocks.ts):
 *   Landmark_a5 (under LM_Boathouse)  the grey boathouse
 *   Set_a5_Block (under Set_a5)       the grey jetty, its piles and rowboat
 *   Landmark_a6 (under LM_GreatTree)  the grey Great Tree
 *   Set_a6_Block (under Set_a6)       the grey giants, their mushroom stems, the fallen logs
 *   ForestMagic                       the grey forest glow (caps, ferns, seed lights, vines)
 *   FloatingSteps .geometry/.material swapped (restored on dispose)
 * The LM_* groups keep their names and positions; everything this module
 * adds for a place hangs under that place's LM_* or Set_* group, so blocks.ts's
 * zone culling (Zone_sky, Zone_meadow) still hides it from the south.
 *
 * MATERIAL: one MeshLambertMaterial, vertex colours, face normals, stock fog
 * and tone mapping (light.ts's ramp and grade apply), DoubleSide for ribbons.
 * An aGlow attribute (rgb + kind) adds emissive light: kind 0 = magic (x
 * magicGlow, per instance pulse 3-6 s), 1 = lamp (x lampGlow), 2+ = vein (x
 * magicGlow, a pulse travelling up the vein). Glow colours stay under 1.2
 * linear (bible a6: teal and violet, never white). Levels are read from
 * light.ts's live state (scene.userData.light.state). onBeforeCompile is
 * set once at creation; light.ts chains its fog hook after it.
 *
 * BUDGET (bible 4.2, 5.2): ~70k triangles at the worst frame (the grey
 * giants were ~67k). Measured numbers in stats() and world-tests/v5-lakeforest.mjs.
 */
import * as THREE from "three";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { BROOK, FOREST_KEEP_CLEAR, GREAT_TREE, PATH, PLACES, STEPS_FOOT, STEPS_TOP, TRAIL, WORLD } from "./layout";
import { NO_REFLECT_LAYER } from "./light";
import { stopRay } from "./rocks";

// ── Tunables ────────────────────────────────────────────────────────────────

/** Giant LOD switch distances (world units, camera to the tree's centre). */
const GIANT_L1 = 1250;
const GIANT_L2 = 2900;
/** The grey forest's candidate grid (kept, so the corridors and views hold). */
const GIANT_GRID = 62;
/** Share of giants that are the tiered species (the rest weep). */
const TIERED_SHARE = 0.62;
/** Spores round the Great Tree. */
const SPORES = 170;
/** Rowboat bob. */
const BOB_AMP = 0.35;

// ── Small helpers ───────────────────────────────────────────────────────────

type V = THREE.Vector3;
type Col = THREE.Color;
/** Glow: linear rgb + kind (0 magic, 1 lamp, 2+ vein parameter). */
type G4 = readonly [number, number, number, number];
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const C = (hex: number) => new THREE.Color(hex);
const DEG = Math.PI / 180;
function rnd(i: number, s = 0): number {
  const x = Math.sin(i * 127.1 + s * 311.7 + 74.7) * 43758.5453;
  return x - Math.floor(x);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Glow colours (linear, under 1.2). */
const TEAL: readonly [number, number, number] = [0.25, 0.84, 0.78];
const CYAN: readonly [number, number, number] = [0.5, 0.9, 1.05];
const VIOLET: readonly [number, number, number] = [0.66, 0.42, 0.95];
const LAMP: readonly [number, number, number] = [1.15, 0.72, 0.3];
const glow = (c: readonly [number, number, number], k: number, kind = 0): G4 => [c[0] * k, c[1] * k, c[2] * k, kind];
const vein = (c: readonly [number, number, number], k: number, s: number): G4 => [c[0] * k, c[1] * k, c[2] * k, 2 + s];

/** Non-indexed triangle soup: position, face normal, colour, aGlow (rgb + kind). */
class Soup {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  g: number[] = [];
  get verts(): number {
    return this.p.length / 3;
  }
  get tris(): number {
    return this.p.length / 9;
  }
  private e1 = V3();
  private e2 = V3();
  private nn = V3();
  private cc = V3();
  /** One triangle. With `inside`, the winding is turned so the face looks away from it. */
  tri(a: V, b: V, c: V, col: Col | readonly Col[], gl: G4 | readonly G4[] | null = null, inside: V | null = null): void {
    this.e1.subVectors(b, a);
    this.e2.subVectors(c, a);
    this.nn.crossVectors(this.e1, this.e2);
    const L = this.nn.length();
    if (L < 1e-9) return;
    this.nn.multiplyScalar(1 / L);
    const cols = Array.isArray(col) ? (col as readonly Col[]) : [col as Col, col as Col, col as Col];
    const gls: readonly (G4 | null)[] = gl && Array.isArray(gl[0]) ? (gl as readonly G4[]) : [gl as G4 | null, gl as G4 | null, gl as G4 | null];
    let order = [0, 1, 2];
    if (inside) {
      this.cc.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(inside);
      if (this.cc.dot(this.nn) < 0) {
        order = [0, 2, 1];
        this.nn.negate();
      }
    }
    const P = [a, b, c];
    for (const i of order) {
      const q = P[i];
      this.p.push(q.x, q.y, q.z);
      this.n.push(this.nn.x, this.nn.y, this.nn.z);
      const k = cols[i] ?? cols[0];
      this.c.push(k.r, k.g, k.b);
      const w = gls[i] ?? gls[0];
      if (w) this.g.push(w[0], w[1], w[2], w[3]);
      else this.g.push(0, 0, 0, 0);
    }
  }
  quad(a: V, b: V, c: V, d: V, col: Col | readonly Col[], gl: G4 | readonly G4[] | null = null, inside: V | null = null): void {
    const cs = Array.isArray(col) ? (col as readonly Col[]) : null;
    const gs = gl && Array.isArray(gl[0]) ? (gl as readonly G4[]) : null;
    this.tri(a, b, c, cs ? [cs[0], cs[1], cs[2]] : col, gs ? [gs[0], gs[1], gs[2]] : gl, inside);
    this.tri(a, c, d, cs ? [cs[0], cs[2], cs[3]] : col, gs ? [gs[0], gs[2], gs[3]] : gl, inside);
  }
  /** Transform everything from vertex `from` on. */
  xform(from: number, m: THREE.Matrix4): void {
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = V3();
    for (let i = from; i < this.verts; i++) {
      v.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]).applyMatrix4(m);
      this.p[i * 3] = v.x;
      this.p[i * 3 + 1] = v.y;
      this.p[i * 3 + 2] = v.z;
      v.set(this.n[i * 3], this.n[i * 3 + 1], this.n[i * 3 + 2]).applyMatrix3(nm).normalize();
      this.n[i * 3] = v.x;
      this.n[i * 3 + 1] = v.y;
      this.n[i * 3 + 2] = v.z;
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute("aGlow", new THREE.Float32BufferAttribute(this.g, 4));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** A ring of points round `c` in the XZ plane. */
function ring(c: V, rx: number, sides: number, rot = 0, rz = rx, jit = 0, seed = 0): V[] {
  const out: V[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const j = 1 + (rnd(seed + i, 3) - 0.5) * 2 * jit;
    out.push(V3(c.x + Math.cos(a) * rx * j, c.y, c.z + Math.sin(a) * rz * j));
  }
  return out;
}
/** Side band between two rings of the same length. `colAt(i)` picks each face's colour. */
function band(s: Soup, A: V[], B: V[], colAt: (i: number) => Col | readonly Col[], gl: ((i: number) => G4 | readonly G4[] | null) | null, inside: V): void {
  const n = A.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s.quad(A[i], A[j], B[j], B[i], colAt(i), gl ? gl(i) : null, inside);
  }
}
function fan(s: Soup, R: V[], apex: V, colAt: (i: number) => Col | readonly Col[], gl: ((i: number) => G4 | readonly G4[] | null) | null, inside: V): void {
  const n = R.length;
  for (let i = 0; i < n; i++) s.tri(R[i], R[(i + 1) % n], apex, colAt(i), gl ? gl(i) : null, inside);
}
/** An oriented box: centre, size, yaw about y. `top` colours the upward face. */
function box(s: Soup, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw: number, col: Col, top: Col | null = null, gl: G4 | null = null): void {
  const c = V3(cx, cy, cz);
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const P = (x: number, y: number, z: number) => V3(cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs);
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const q = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz)];
  s.quad(q[4], q[5], q[6], q[7], top ?? col, gl, c);
  s.quad(q[0], q[1], q[2], q[3], col, gl, c);
  s.quad(q[0], q[1], q[5], q[4], col, gl, c);
  s.quad(q[1], q[2], q[6], q[5], col, gl, c);
  s.quad(q[2], q[3], q[7], q[6], col, gl, c);
  s.quad(q[3], q[0], q[4], q[7], col, gl, c);
}
/** A tapered n sided tube from a to b (radii ra, rb), capped at b. */
function tube(s: Soup, a: V, b: V, ra: number, rb: number, sides: number, col: Col | ((i: number) => Col), cap = true, rot = 0): void {
  const d = V3().subVectors(b, a);
  const L = d.length();
  if (L < 1e-6) return;
  d.normalize();
  const up = Math.abs(d.y) > 0.95 ? V3(1, 0, 0) : V3(0, 1, 0);
  const u = V3().crossVectors(d, up).normalize();
  const w = V3().crossVectors(d, u).normalize();
  const R = (c: V, r: number) => {
    const out: V[] = [];
    for (let i = 0; i < sides; i++) {
      const t = rot + (i / sides) * Math.PI * 2;
      out.push(c.clone().addScaledVector(u, Math.cos(t) * r).addScaledVector(w, Math.sin(t) * r));
    }
    return out;
  };
  const A = R(a, ra);
  const B = R(b, rb);
  const mid = V3().addVectors(a, b).multiplyScalar(0.5);
  const cf = typeof col === "function" ? col : () => col;
  band(s, A, B, cf, null, mid);
  if (cap) fan(s, B, b.clone().addScaledVector(d, rb * 0.4), cf, null, mid);
}
/** A squashed octahedron (8 tris). */
function octa(s: Soup, c: V, rx: number, ry: number, rz: number, col: Col, gl: G4 | null = null, under: G4 | null = null): void {
  const t = V3(c.x, c.y + ry, c.z);
  const b = V3(c.x, c.y - ry, c.z);
  const R = [V3(c.x + rx, c.y, c.z), V3(c.x, c.y, c.z + rz), V3(c.x - rx, c.y, c.z), V3(c.x, c.y, c.z - rz)];
  for (let i = 0; i < 4; i++) {
    s.tri(R[i], R[(i + 1) % 4], t, col, gl, c);
    s.tri(R[i], R[(i + 1) % 4], b, col, under ?? gl, c);
  }
}
/** A flat ribbon from a down to b (2 tris), width w, facing `face`. Colours and glow top/bottom. */
function ribbon(s: Soup, a: V, b: V, w: number, face: V, ct: Col, cb: Col, gt: G4 | null, gb: G4 | null): void {
  const d = V3().subVectors(b, a).normalize();
  const side = V3().crossVectors(d, face).normalize().multiplyScalar(w / 2);
  const a0 = a.clone().sub(side);
  const a1 = a.clone().add(side);
  const b0 = b.clone().addScaledVector(side, -0.4);
  const b1 = b.clone().addScaledVector(side, 0.4);
  s.quad(a0, a1, b1, b0, [ct, ct, cb, cb], gt || gb ? [gt ?? [0, 0, 0, 0], gt ?? [0, 0, 0, 0], gb ?? [0, 0, 0, 0], gb ?? [0, 0, 0, 0]] : null);
}

/**
 * A cloud pad (niwaki) or disc canopy: a domed top, a band with a zigzag
 * skirt, a flat underside. `under` glows the underside (brighter at the rim).
 */
function pad(s: Soup, c: V, r: number, th: number, sides: number, seed: number, top: Col, side: Col, bottom: Col, under: G4 | null, rim: G4 | null, jit = 0.12): void {
  const rot = rnd(seed, 1) * Math.PI;
  const up = ring(V3(c.x, c.y + th * 0.25, c.z), r, sides, rot, r, jit, seed);
  const lo = ring(V3(c.x, c.y - th * 0.3, c.z), r * 0.9, sides, rot, r * 0.9, jit, seed);
  for (let i = 0; i < lo.length; i++) if (i % 2) lo[i].y -= th * 0.45;
  const apex = V3(c.x + (rnd(seed, 2) - 0.5) * r * 0.2, c.y + th * 0.85, c.z + (rnd(seed, 4) - 0.5) * r * 0.2);
  const inside = V3(c.x, c.y - th * 0.05, c.z);
  // Top, light toward the apex.
  fan(s, up, apex, () => [side, side, top], null, inside);
  band(s, up, lo, () => side, rim ? () => [[0, 0, 0, 0], [0, 0, 0, 0], rim, rim] : null, inside);
  const uc = V3(c.x, c.y - th * 0.18, c.z);
  const u0: G4 | null = under ? [under[0] * 0.35, under[1] * 0.35, under[2] * 0.35, under[3]] : null;
  fan(s, lo, uc, () => bottom, under ? () => [under, under, u0 as G4] : null, V3(c.x, c.y + th, c.z));
}

// ── Palette (display sRGB, converted to linear by THREE.Color) ──────────────

const P = {
  // Forest
  bark: C(0x1f1d24),
  bark2: C(0x1a1820),
  bark3: C(0x25222a),
  barkW: C(0x221e22),
  moss: C(0x1a2e2a),
  leafTop: C(0x1c2830),
  leafSide: C(0x121a22),
  leafUnder: C(0x0b1018),
  leafTopB: C(0x191f2a),
  leafUnderB: C(0x0e0d16),
  fungus: C(0x7c8a94),
  capStem: C(0x8a8a90),
  capTop: C(0x3a2f4a),
  // Stone (steps, cairns, chimney)
  stoneTop: C(0x8a869c),
  stoneSide: C(0x747086),
  stoneKeel: C(0x4a4656),
  stoneMoss: C(0x3e5a3a),
  root: C(0x3a2e28),
  cairn: C(0x8a857e),
  cairnTop: C(0x9e988e),
  // Wood (bible 1.8: brown #6b4e3a, grey brown #7d6b5a, cream #e3d6ba, canvas, rope, iron)
  wall: C(0x5a4032),
  wall2: C(0x523a2e),
  trim: C(0xe3d6ba),
  deck: C(0x7d6b5a),
  deck2: C(0x6f5e4f),
  pile: C(0x3f322a),
  roof: C(0x3b3a40),
  roof2: C(0x34333a),
  door: C(0x4a3226),
  win: C(0x3a2a18),
  chimney: C(0x6f6a68),
  chimney2: C(0x625d5c),
  brown: C(0x6b4e3a),
  rope: C(0xb8a07a),
  iron: C(0x2f2d2c),
  ringRed: C(0xa8483a),
  hullWhite: C(0xe9e5dc),
  hullLow: C(0xcfcac0),
  hullIn: C(0x8a6a4e),
  canoe: C(0x7a4e36),
  canvas: C(0xd8ccb0),
  // Shore
  reed: C(0x4a4a30),
  reedTip: C(0x8a7a4a),
  reedHead: C(0x4a3a2a),
  lily: C(0x3d5234),
  lilyRim: C(0x55683f),
  lilyFlower: C(0xe8d6d8),
  log: C(0x5a4a3c),
  logMoss: C(0x4c5c38),
  earth: C(0x4a3a2e),
} as const;

// ── The shader (one material for everything this module draws) ─────────────

interface LfUniforms {
  uTime: { value: number };
  uMagic: { value: number };
  uLamp: { value: number };
}

const VERT_PARS = /* glsl */ `
attribute vec4 aGlow;
uniform float uTime;
uniform float uMagic;
uniform float uLamp;
varying vec3 vLfGlow;
`;
const VERT_GLOW = /* glsl */ `
#include <begin_vertex>
{
  vec3 lfP;
  #ifdef USE_INSTANCING
    lfP = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;
  #else
    lfP = ( modelMatrix * vec4( floor( position / 30.0 ) * 30.0, 1.0 ) ).xyz;
  #endif
  float lfH = fract( sin( dot( lfP.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  vec3 lfG = aGlow.rgb;
  float lfK = aGlow.w;
  if ( lfK < 0.5 ) {
    float per = mix( 3.0, 6.0, lfH );
    float amp = mix( 0.3, 0.5, fract( lfH * 7.13 ) );
    lfG *= uMagic * ( 1.0 - amp + amp * ( 0.5 + 0.5 * sin( uTime * 6.2832 / per + lfH * 40.0 ) ) );
  } else if ( lfK < 1.5 ) {
    lfG *= uLamp * ( 0.95 + 0.05 * sin( uTime * 6.0 + lfH * 30.0 ) );
  } else {
    float s = lfK - 2.0;
    float wave = smoothstep( 0.72, 1.0, 0.5 + 0.5 * sin( s * 9.0 - uTime * 1.7 + lfH * 6.0 ) );
    lfG *= uMagic * ( 0.3 + 0.95 * wave );
  }
  vLfGlow = lfG;
}
`;
const FRAG_PARS = /* glsl */ `
varying vec3 vLfGlow;
`;
const FRAG_GLOW = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += vLfGlow;
`;

function makeMaterial(u: LfUniforms): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.name = "V5LakeForest";
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + VERT_PARS).replace("#include <begin_vertex>", VERT_GLOW);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + FRAG_PARS).replace("#include <emissivemap_fragment>", FRAG_GLOW);
  };
  mat.customProgramCacheKey = () => "v5-lakeforest";
  mat.userData.lfUniforms = u;
  return mat;
}

/** Additive points: lamp halos (kind 0, steady) and spores (kind 1, rising). No fog: they fade by distance themselves. */
function pointsMaterial(u: LfUniforms, scale: { value: number }, spores: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...u, uScale: scale },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
    defines: spores ? { SPORES: 1 } : {},
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      attribute vec3 aCol;
      uniform float uTime;
      uniform float uMagic;
      uniform float uLamp;
      uniform float uScale;
      varying vec3 vCol;
      void main() {
        vec3 p = position;
        float lvl;
        #ifdef SPORES
          float h = mod( aSeed.z * 150.0 + uTime * aSeed.w, 150.0 );
          float a = aSeed.x + uTime * 0.05 + sin( uTime * 0.4 + aSeed.z * 20.0 ) * 0.2;
          p += vec3( cos( a ) * aSeed.y, h, sin( a ) * aSeed.y );
          lvl = uMagic * smoothstep( 0.0, 20.0, h ) * ( 1.0 - smoothstep( 110.0, 150.0, h ) );
        #else
          lvl = uLamp;
        #endif
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float worldSize = ${spores ? "2.6" : "aSeed.x"};
        gl_PointSize = max( 1.5, worldSize * uScale / max( d, 1.0 ) );
        vCol = aCol * lvl * ( 1.0 - smoothstep( ${spores ? "900.0, 1600.0" : "1800.0, 3200.0"}, d ) );
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r = dot( q, q );
        float a = exp( -r * ${spores ? "4.5" : "3.2"} ) * ( 1.0 - smoothstep( 0.7, 1.0, r ) );
        gl_FragColor = vec4( vCol * a, 1.0 );
      }`,
  });
}

// ── Giant elders (M1), normalised to height 1 ────────────────────────────────

/** Buttress fin: a ridge from the trunk out into the ground, triangular section, a vein on the ridge. */
function rootFin(s: Soup, a: number, r0: number, y0: number, reach: number, w: number, segs: number, seed: number, veinK: number, veinGlow: readonly [number, number, number]): void {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const tx = -sa;
  const tz = ca;
  const ridge: V[] = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    const r = r0 + (reach - r0) * Math.pow(t, 0.8);
    const y = lerp(y0, -0.02, Math.pow(t, 0.7));
    const bend = Math.sin(t * Math.PI) * (rnd(seed, 7) - 0.5) * 0.04;
    ridge.push(V3(ca * r + tx * bend, y, sa * r + tz * bend));
  }
  for (let k = 0; k < segs; k++) {
    const A = ridge[k];
    const B = ridge[k + 1];
    const wa = w * (1 - k / segs) + 0.004;
    const wb = w * (1 - (k + 1) / segs) + 0.002;
    const gA = -0.03;
    const inside = V3((A.x + B.x) / 2, -0.2, (A.z + B.z) / 2);
    for (const sd of [-1, 1]) {
      const LA = V3(A.x + tx * wa * sd, gA, A.z + tz * wa * sd);
      const LB = V3(B.x + tx * wb * sd, gA, B.z + tz * wb * sd);
      s.quad(A, B, LB, LA, [P.moss, P.moss, P.bark, P.bark], null, inside);
    }
    if (veinK > 0) {
      // The vein: a thin strip riding the ridge.
      const lift = 0.003;
      const vw = 0.0045;
      const a0 = V3(A.x + tx * vw, A.y + lift, A.z + tz * vw);
      const a1 = V3(A.x - tx * vw, A.y + lift, A.z - tz * vw);
      const b0 = V3(B.x + tx * vw, B.y + lift, B.z + tz * vw);
      const b1 = V3(B.x - tx * vw, B.y + lift, B.z - tz * vw);
      const sA = (1 - k / segs) * 1.2;
      const sB = (1 - (k + 1) / segs) * 1.2;
      s.quad(a0, a1, b1, b0, P.moss, [vein(veinGlow, veinK, sA), vein(veinGlow, veinK, sA), vein(veinGlow, veinK, sB), vein(veinGlow, veinK, sB)]);
    }
  }
}

/** Twisted trunk rings: [y, radius] pairs, a twist per unit height, a centre drift. */
function trunk(s: Soup, spec: ReadonlyArray<readonly [number, number]>, sides: number, twist: number, drift: (y: number) => [number, number], seed: number, jit: number): V[][] {
  const rings: V[][] = [];
  for (let k = 0; k < spec.length; k++) {
    const [y, r] = spec[k];
    const [dx, dz] = drift(y);
    rings.push(ring(V3(dx, y, dz), r, sides, y * twist, r, jit, seed + k * 13));
  }
  const cols = [P.bark, P.bark2, P.bark3];
  for (let k = 0; k < rings.length - 1; k++) {
    const my = (spec[k][0] + spec[k + 1][0]) / 2;
    const [mx, mz] = drift(my);
    const mid = V3(mx, my, mz);
    band(s, rings[k], rings[k + 1], (i) => (k === 0 ? (i % 2 ? P.moss : P.bark2) : cols[(i + k) % 3]), null, mid);
  }
  return rings;
}

/** A bracket fungus on a trunk: a half disc with a glowing rim. */
function shelf(s: Soup, cx: number, cy: number, cz: number, a: number, r: number): void {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const c = V3(cx, cy, cz);
  const pts: V[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = -Math.PI / 2 + (i / 4) * Math.PI;
    const dx = Math.cos(t) * r;
    const dz = Math.sin(t) * r;
    pts.push(V3(cx + ca * dx - sa * dz, cy, cz + sa * dx + ca * dz));
  }
  const top = V3(cx, cy + r * 0.25, cz);
  const rimG = glow(CYAN, 0.95);
  for (let i = 0; i < 4; i++) {
    s.tri(pts[i], pts[i + 1], top, [P.fungus, P.fungus, P.fungus], [rimG, rimG, glow(CYAN, 0.25)]);
    const lo0 = V3(pts[i].x, pts[i].y - r * 0.18, pts[i].z);
    const lo1 = V3(pts[i + 1].x, pts[i + 1].y - r * 0.18, pts[i + 1].z);
    s.quad(pts[i], pts[i + 1], lo1, lo0, P.fungus, rimG, c);
  }
}

/** Species 1, the TIERED elder: column trunk, stacked disc canopies, shelf fungi. */
function tieredElder(lod: 0 | 1): Soup {
  const s = new Soup();
  const drift = (y: number): [number, number] => [Math.sin(y * 6) * 0.012, Math.cos(y * 5) * 0.01];
  const spec: ReadonlyArray<readonly [number, number]> = lod
    ? [[-0.03, 0.07], [0.2, 0.045], [0.86, 0.026]]
    : [[-0.03, 0.078], [0.08, 0.055], [0.25, 0.046], [0.45, 0.041], [0.66, 0.034], [0.88, 0.024]];
  trunk(s, spec, lod ? 5 : 7, 1.3, drift, 11, lod ? 0 : 0.1);
  const fins = lod ? 3 : 5;
  for (let k = 0; k < fins; k++) rootFin(s, (k / fins) * Math.PI * 2 + 0.4, 0.04, 0.14, 0.2 + rnd(k, 5) * 0.06, 0.03, lod ? 1 : 2, k, lod ? 0 : 0.7, TEAL);
  const sides = lod ? 6 : 9;
  const under = glow(TEAL, 0.03);
  // Fix pass 3: 0.14 -> 0.08; the framing elders' lit rims kept a6 at 70% dark (target 75-85).
  const rim = glow(TEAL, 0.08);
  const discs: ReadonlyArray<readonly [number, number, number, number, number]> = [
    [0.03, 0.58, -0.02, 0.31, 0.075],
    [-0.04, 0.74, 0.03, 0.23, 0.065],
    [0.015, 0.89, 0.005, 0.14, 0.06],
  ];
  discs.forEach(([x, y, z, r, th], k) => pad(s, V3(x, y, z), r, th, sides, 40 + k, P.leafTop, P.leafSide, P.leafUnder, under, lod ? null : rim, lod ? 0 : 0.12));
  if (!lod) {
    // A side limb with its own pad.
    tube(s, V3(0.0, 0.44, 0.0), V3(0.2, 0.5, 0.1), 0.022, 0.012, 4, P.bark, false);
    pad(s, V3(0.22, 0.52, 0.11), 0.11, 0.05, 7, 55, P.leafTop, P.leafSide, P.leafUnder, under, rim);
    shelf(s, 0.045, 0.2, 0.0, 0.2, 0.034);
    shelf(s, -0.02, 0.31, 0.04, 2.1, 0.03);
    shelf(s, -0.02, 0.4, -0.036, 4.2, 0.026);
  } else {
    shelf(s, 0.045, 0.24, 0.0, 0.2, 0.04);
  }
  return s;
}

/** Species 2, the WEEPING elder: leaning trunk split into two limbs, lobed crowns, glowing strands. */
function weepingElder(lod: 0 | 1): Soup {
  const s = new Soup();
  const drift = (y: number): [number, number] => [0.12 * Math.pow(Math.max(y, 0), 1.5), Math.sin(y * 4) * 0.015];
  const spec: ReadonlyArray<readonly [number, number]> = lod
    ? [[-0.03, 0.075], [0.25, 0.048], [0.5, 0.036]]
    : [[-0.03, 0.082], [0.1, 0.058], [0.28, 0.048], [0.5, 0.038]];
  trunk(s, spec, lod ? 4 : 6, -1.6, drift, 23, lod ? 0 : 0.12);
  const fins = lod ? 3 : 4;
  for (let k = 0; k < fins; k++) rootFin(s, (k / fins) * Math.PI * 2 + 1.1, 0.045, 0.13, 0.19 + rnd(k, 9) * 0.05, 0.034, lod ? 1 : 2, k + 7, lod ? 0 : 0.6, VIOLET);
  const [tx, tz] = drift(0.5);
  const top = V3(tx, 0.5, tz);
  const ends = [V3(0.22, 0.7, 0.06), V3(-0.12, 0.78, -0.1), V3(0.05, 0.86, 0.02)];
  const lobeR: ReadonlyArray<readonly [number, number, number]> = [
    [0.2, 0.1, 0.18],
    [0.17, 0.09, 0.17],
    [0.14, 0.085, 0.14],
  ];
  for (let i = 0; i < ends.length; i++) {
    if (i < 2) tube(s, top, ends[i], lod ? 0.03 : 0.032, 0.016, lod ? 3 : 5, P.barkW, false);
    const [rx, ry, rz] = lobeR[i];
    if (lod) octa(s, ends[i], rx, ry, rz, P.leafTopB, null, glow(VIOLET, 0.05));
    else {
      const ico = new THREE.IcosahedronGeometry(1, 0);
      const pos = ico.getAttribute("position");
      const c = ends[i];
      for (let t = 0; t < pos.count; t += 3) {
        const q = [0, 1, 2].map((j) => V3(c.x + pos.getX(t + j) * rx, c.y + pos.getY(t + j) * ry, c.z + pos.getZ(t + j) * rz));
        const ys = [0, 1, 2].map((j) => pos.getY(t + j));
        const cols = ys.map((y) => (y > 0.3 ? P.leafTopB : y < -0.3 ? P.leafUnderB : P.leafSide));
        const gl = ys.map((y) => (y < -0.3 ? glow(VIOLET, 0.05) : ([0, 0, 0, 0] as G4)));
        s.tri(q[0], q[1], q[2], cols, gl, c);
      }
      ico.dispose();
    }
  }
  // Strands from under the lobes, with bulbs.
  const n = lod ? 5 : 11;
  for (let k = 0; k < n; k++) {
    const e = ends[k % 3];
    const [rx] = lobeR[k % 3];
    const a = rnd(k, 31) * Math.PI * 2;
    const rr = rx * (0.4 + rnd(k, 32) * 0.5);
    const x = e.x + Math.cos(a) * rr;
    const z = e.z + Math.sin(a) * rr;
    const y0 = e.y - 0.05;
    const len = 0.12 + rnd(k, 33) * 0.16;
    const col = k % 3 === 0 ? CYAN : k % 2 ? VIOLET : TEAL;
    ribbon(s, V3(x, y0, z), V3(x + 0.004, y0 - len, z), 0.01, V3(Math.cos(a), 0, Math.sin(a)), P.leafUnderB, P.leafUnderB, glow(col, 0.1), glow(col, 1.0));
    if (!lod) octa(s, V3(x + 0.004, y0 - len - 0.012, z), 0.012, 0.016, 0.012, P.leafUnderB, glow(col, 1.1));
  }
  return s;
}

/** LOD2, shared by both species: a trunk wedge and one squashed octahedron, its underside teal. */
function giantFar(): Soup {
  const s = new Soup();
  const base = ring(V3(0, -0.03, 0), 0.06, 3, 0.3);
  const top = V3(0, 0.6, 0);
  fan(s, base, top, () => P.bark, null, V3(0, 0.25, 0));
  octa(s, V3(0, 0.72, 0), 0.3, 0.17, 0.3, P.leafTop, null, glow(TEAL, 0.16));
  return s;
}

// ── The Great Tree (local to LM_GreatTree, base y 0) ────────────────────────

function greatTree(s: Soup, toWorld: (x: number, z: number) => [number, number], groundAt: (x: number, z: number) => number, pathDist: (x: number, z: number) => number): { spores: V[] } {
  const GH = GREAT_TREE.height;
  const GR = GREAT_TREE.crownR;
  const sc = GH / 240;
  // Trunk: 12 sides, twisting ~55 degrees, flaring at the root collar.
  const spec: ReadonlyArray<readonly [number, number]> = [
    [-8, 46],
    [8, 34],
    [26, 28],
    [48, 24.5],
    [72, 22],
    [98, 20],
    [122, 18.5],
    [142, 16.5],
    [160, 14],
  ].map(([y, r]) => [y * sc, r * sc] as const);
  const drift = (y: number): [number, number] => [Math.sin(y * 0.02) * 5 * sc, Math.cos(y * 0.017) * 4 * sc];
  const twist = 0.0065 / sc;
  const rings = trunk(s, spec, 12, twist, drift, 101, 0.07);
  void rings;
  // Buttress roots, their veins pulsing in from the tips.
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.25 + (rnd(k, 61) - 0.5) * 0.3;
    let reach = (86 + rnd(k, 62) * 34) * sc;
    // Keep the trail in front of the tree clear.
    for (let t = 0; t < 8 && reach > 55 * sc; t++) {
      const [wx, wz] = toWorld(Math.cos(a) * reach, Math.sin(a) * reach);
      if (pathDist(wx, wz) > 22) break;
      reach -= 8 * sc;
    }
    const s0 = s.verts;
    rootFin(s, a, 0.16, 0.26, reach / (GH * 0.5), 0.07, 4, 70 + k, 0.95, CYAN);
    s.xform(s0, new THREE.Matrix4().makeScale(GH * 0.5, GH * 0.5 * 0.9, GH * 0.5));
  }
  // Veins spiralling up the trunk (the pulse continues from the roots).
  for (let v = 0; v < 6; v++) {
    const a0 = (v / 6) * Math.PI * 2 + 0.25;
    const segs = 16;
    for (let k = 0; k < segs; k++) {
      const pt = (t: number) => {
        const y = lerp(0, 158 * sc, t);
        let r = 0;
        for (let i = 0; i < spec.length - 1; i++) if (y >= spec[i][0] && y <= spec[i + 1][0]) r = lerp(spec[i][1], spec[i + 1][1], (y - spec[i][0]) / (spec[i + 1][0] - spec[i][0]));
        const a = a0 + y * twist + t * 0.9;
        const [dx, dz] = drift(y);
        return { p: V3(dx + Math.cos(a) * (r + 0.7), y, dz + Math.sin(a) * (r + 0.7)), a };
      };
      const A = pt(k / segs);
      const B = pt((k + 1) / segs);
      const w = 1.3 * sc;
      const tA = V3(-Math.sin(A.a) * w, 0, Math.cos(A.a) * w);
      const tB = V3(-Math.sin(B.a) * w, 0, Math.cos(B.a) * w);
      const sA = 1.2 + (k / segs) * 4;
      const sB = 1.2 + ((k + 1) / segs) * 4;
      s.quad(A.p.clone().add(tA), A.p.clone().sub(tA), B.p.clone().sub(tB), B.p.clone().add(tB), P.moss, [vein(CYAN, 0.9, sA), vein(CYAN, 0.9, sA), vein(CYAN, 0.9, sB), vein(CYAN, 0.9, sB)]);
    }
  }
  // The crown: cloud pads (niwaki). [angle, radius out, y, pad r, thickness, glow].
  const pads: [number, number, number, number, number, number][] = [[0, 0, 214, 52, 17, 0]];
  for (let k = 0; k < 6; k++) pads.push([(k / 6) * Math.PI * 2 + 0.3, 58 + rnd(k, 81) * 10, 190 + rnd(k, 82) * 12, 38 + rnd(k, 83) * 8, 14, k % 2]);
  for (let k = 0; k < 8; k++) pads.push([(k / 8) * Math.PI * 2 + 0.05, 78 + rnd(k, 84) * 8, 162 + rnd(k, 85) * 12, 29 + rnd(k, 86) * 6, 12, (k + 1) % 2]);
  const [ttx, ttz] = drift(150 * sc);
  const trunkTop = V3(ttx, 150 * sc, ttz);
  const limbBase = (k: number) => {
    const y = (118 + rnd(k, 90) * 30) * sc;
    const [dx, dz] = drift(y);
    return V3(dx, y, dz);
  };
  const vineAnchors: { p: V; r: number; g: number }[] = [];
  pads.forEach(([a, out, y, r, th, gk], k) => {
    const c = V3(Math.cos(a) * out * sc, y * sc, Math.sin(a) * out * sc);
    const col = gk ? VIOLET : TEAL;
    const under = glow(col, k === 0 ? 0.14 : 0.19);
    const rim = glow(col, 0.46);
    pad(s, c, Math.min(r * sc, GR), th * sc, 12, 200 + k, P.leafTop, P.leafSide, P.leafUnder, under, rim, 0.14);
    // A limb from the trunk up to the pad (two segments with an elbow).
    if (k > 0) {
      const b = limbBase(k);
      const elbow = V3(lerp(b.x, c.x, 0.55), lerp(b.y, c.y, 0.35) + 6 * sc, lerp(b.z, c.z, 0.55));
      const rad = (k < 7 ? 8 : 6.5) * sc;
      tube(s, b, elbow, rad, rad * 0.75, 6, (i) => (i % 2 ? P.bark : P.bark2), false, k);
      tube(s, elbow, V3(c.x, c.y - th * sc * 0.2, c.z), rad * 0.75, rad * 0.45, 6, (i) => (i % 2 ? P.bark3 : P.bark), true, k);
    } else {
      tube(s, trunkTop, V3(c.x, c.y - th * sc * 0.3, c.z), 12 * sc, 7 * sc, 8, P.bark, true);
    }
    vineAnchors.push({ p: c, r: Math.min(r * sc, GR), g: gk });
  });
  // Hanging light vines with bulbs.
  for (let k = 0; k < 36; k++) {
    const an = vineAnchors[1 + (k % (vineAnchors.length - 1))];
    const a = rnd(k, 91) * Math.PI * 2;
    const rr = an.r * (0.35 + rnd(k, 92) * 0.55);
    const x = an.p.x + Math.cos(a) * rr;
    const z = an.p.z + Math.sin(a) * rr;
    const y0 = an.p.y - 5 * sc;
    const len = (18 + rnd(k, 93) * 42) * sc;
    const col = k % 4 === 0 ? CYAN : an.g ? VIOLET : TEAL;
    ribbon(s, V3(x, y0, z), V3(x + (rnd(k, 94) - 0.5) * 3, y0 - len, z), 1.3 * sc, V3(Math.cos(a), 0, Math.sin(a)), P.leafUnder, P.leafUnder, glow(col, 0.12), glow(col, 1.0));
    octa(s, V3(x, y0 - len - 2.2 * sc, z), 1.9 * sc, 2.6 * sc, 1.9 * sc, P.leafUnder, glow(col, 1.1));
  }
  // Seed lights drifting under the crown.
  for (let k = 0; k < 24; k++) {
    const a = rnd(k, 95) * Math.PI * 2;
    const r = (30 + rnd(k, 96) * 70) * sc;
    const y = (120 + rnd(k, 97) * 40) * sc;
    octa(s, V3(Math.cos(a) * r, y, Math.sin(a) * r), 1.8 * sc, 1.8 * sc, 1.8 * sc, P.leafUnder, glow(k % 2 ? TEAL : VIOLET, 1.0));
  }
  // Glowcaps among the roots (off the trail).
  const spores: V[] = [];
  for (let k = 0; k < 18; k++) {
    const a = rnd(k, 98) * Math.PI * 2;
    const r = (48 + rnd(k, 99) * 60) * sc;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const [wx, wz] = toWorld(x, z);
    if (pathDist(wx, wz) < 16) continue;
    const g = groundAt(x, z);
    const h = (4 + rnd(k, 100) * 5) * sc;
    tube(s, V3(x, g - 1, z), V3(x, g + h * 0.8, z), h * 0.14, h * 0.1, 4, P.capStem, false);
    const cap = ring(V3(x, g + h * 0.75, z), h * 0.55, 6, rnd(k, 101));
    const col = k % 3 ? VIOLET : TEAL;
    fan(s, cap, V3(x, g + h * 1.1, z), () => P.capTop, () => glow(col, 0.35), V3(x, g, z));
    fan(s, cap, V3(x, g + h * 0.62, z), () => P.capTop, () => glow(col, 1.0), V3(x, g + h * 2, z));
    spores.push(V3(x, g, z));
  }
  return { spores };
}

// ── The floating step: carved slab, local x along the stair, top at y 3.5 ───

function carvedStep(): Soup {
  const s = new Soup();
  const n = 8;
  // Pass 3: wider (x1.3) and a keel half as deep: from below the deep keel read as a black pod or bell.
  const hx = 18;
  const hz = 14;
  const oct = (y: number, sx: number, sz: number) => {
    const out: V[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / 8;
      out.push(V3(Math.cos(a) * sx * 1.08, y, Math.sin(a) * sz * 1.08));
    }
    return out;
  };
  const top = oct(3.5, hx - 2, hz - 2);
  const edge = oct(2.3, hx, hz);
  const bot = oct(-2.6, hx - 0.6, hz - 0.6);
  const mid = V3(0, 0, 0);
  // Top face (a few stones darker), chamfer, sides.
  fan(s, top, V3(0, 3.6, 0), (i) => (i % 3 ? P.stoneTop : P.stoneSide), null, mid);
  band(s, top, edge, () => P.stoneTop, null, mid);
  // The underside takes teal uplight from the forest below (a fake bounce: glow, no light).
  const up = () => glow(TEAL, 0.085);
  band(s, edge, bot, (i) => (i % 2 ? P.stoneSide : P.stoneKeel), up, mid);
  // The jagged keel underneath.
  const k1 = bot.map((p, i) => V3(p.x * 0.75 + (rnd(i, 11) - 0.5) * 2, -4.2 - rnd(i, 12) * 1.5, p.z * 0.75 + (rnd(i, 13) - 0.5) * 2));
  band(s, bot, k1, () => P.stoneKeel, up, V3(0, -3.4, 0));
  const k2 = k1.filter((_, i) => i % 2 === 0).map((p, i) => V3(p.x * 0.45, -6.2 - rnd(i, 14) * 1.2, p.z * 0.45));
  const k1b = k1.filter((_, i) => i % 2 === 0);
  band(s, k1b, k2, () => P.stoneKeel, up, V3(0, -6, 0));
  // Fill the gaps between the full ring and the half ring.
  for (let i = 0; i < n; i += 2) s.tri(k1[i], k1[i + 1], k1[(i + 2) % n], P.stoneKeel, glow(TEAL, 0.085), V3(0, -3.4, 0));
  fan(s, k2, V3(2, -8.6, 1), () => P.root, up, V3(0, -6, 0));
  // Moss cap: an irregular patch raised over the top, spilling over one edge.
  const moss: V[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = 0.55 + rnd(i, 15) * 0.3;
    moss.push(V3(-3 + Math.cos(a) * hx * r * 0.7, 3.75, 1 + Math.sin(a) * hz * r * 0.7));
  }
  fan(s, moss, V3(-3, 3.9, 1), () => P.stoneMoss, null, V3(-3, 0, 1));
  s.quad(V3(-hx * 0.9, 3.7, -3), V3(-hx * 0.9, 3.7, 5), V3(-hx - 0.4, -0.5, 4), V3(-hx - 0.4, 0.5, -2), P.stoneMoss, null, mid);
  // Tufts on the moss.
  for (let t = 0; t < 4; t++) {
    const x = -6 + rnd(t, 16) * 8;
    const z = -3 + rnd(t, 17) * 7;
    for (let b = 0; b < 3; b++) {
      const a = (b / 3) * Math.PI + rnd(t, 18);
      const h = 2.2 + rnd(t + b, 19) * 1.6;
      s.tri(V3(x + Math.cos(a) * 0.5, 3.8, z + Math.sin(a) * 0.5), V3(x - Math.cos(a) * 0.5, 3.8, z - Math.sin(a) * 0.5), V3(x + Math.sin(a) * 0.6, 3.8 + h, z - Math.cos(a) * 0.6), [P.stoneMoss, P.stoneMoss, P.reedTip]);
    }
  }
  // Hanging roots, two with glowing tips.
  for (let r = 0; r < 5; r++) {
    const a = rnd(r, 20) * Math.PI * 2;
    const x = Math.cos(a) * 6;
    const z = Math.sin(a) * 5;
    const y0 = -5 - rnd(r, 21) * 2;
    const len = 7 + rnd(r, 22) * 8;
    const g = r < 3 ? glow(TEAL, 0.9) : null;
    ribbon(s, V3(x, y0, z), V3(x + 0.6, y0 - len, z + 0.3), 0.9, V3(Math.cos(a), 0, Math.sin(a)), P.root, P.root, null, g);
  }
  // Runes: small glyphs on the sides (3 strokes each), a ring on the top.
  const rune = (c: V, nrm: V, size: number, seed: number) => {
    const up = V3(0, 1, 0);
    const side = V3().crossVectors(up, nrm).normalize();
    const off = nrm.clone().multiplyScalar(0.25);
    const stroke = (x0: number, y0: number, x1: number, y1: number) => {
      const a = c.clone().add(off).addScaledVector(side, x0 * size).addScaledVector(up, y0 * size);
      const b = c.clone().add(off).addScaledVector(side, x1 * size).addScaledVector(up, y1 * size);
      const d = V3().subVectors(b, a).normalize();
      const w = V3().crossVectors(d, nrm).normalize().multiplyScalar(0.28);
      s.quad(a.clone().add(w), a.clone().sub(w), b.clone().sub(w), b.clone().add(w), P.stoneSide, glow(CYAN, 0.42));
    };
    // Three glyphs: an elk rune, a chevron, a diamond.
    const k = seed % 3;
    if (k === 0) {
      stroke(0, -0.5, 0, 0.5);
      stroke(0, 0.0, 0.42, 0.48);
      stroke(0, 0.0, -0.42, 0.48);
    } else if (k === 1) {
      stroke(0.32, 0.5, -0.32, 0);
      stroke(-0.32, 0, 0.32, -0.5);
    } else {
      stroke(0, -0.5, 0.36, 0);
      stroke(0.36, 0, 0, 0.5);
      stroke(0, 0.5, -0.36, 0);
      stroke(-0.36, 0, 0, -0.5);
    }
  };
  // One rune on each of the slab's eight faces, so every step shows one from any side.
  for (let i = 0; i < n; i++) {
    const A = edge[i];
    const B = edge[(i + 1) % n];
    const c = V3((A.x + B.x) / 2 * 0.99, -0.3, (A.z + B.z) / 2 * 0.99);
    const nrm = V3(B.z - A.z, 0, -(B.x - A.x)).normalize();
    if (nrm.dot(c) < 0) nrm.negate();
    rune(c, nrm, 2.8, i);
  }
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2;
    const a1 = ((i + 0.6) / 10) * Math.PI * 2;
    const R0 = 5.2;
    const R1 = 4.4;
    s.quad(V3(4 + Math.cos(a0) * R0, 3.66, -1 + Math.sin(a0) * R0), V3(4 + Math.cos(a1) * R0, 3.66, -1 + Math.sin(a1) * R0), V3(4 + Math.cos(a1) * R1, 3.66, -1 + Math.sin(a1) * R1), V3(4 + Math.cos(a0) * R1, 3.66, -1 + Math.sin(a0) * R1), P.stoneTop, glow(TEAL, 0.7));
  }
  return s;
}

// ── a5: the boathouse (local to LM_Boathouse; lake surface at y = ly) ───────

function boathouse(s: Soup, ly: number, groundAt: (x: number, z: number) => number, halos: number[]): void {
  const deckY = ly + 4.4;
  const halo = (x: number, y: number, z: number, size: number) => halos.push(x, y, z, size);
  // Piles.
  for (const x of [-23, -8, 7, 21]) for (const z of [-16, 0, 16]) {
    const g = Math.min(ly - 2, groundAt(x, z));
    tube(s, V3(x, g, z), V3(x, deckY - 0.8, z), 1.5, 1.3, 5, P.pile, false);
  }
  // Deck: planks across, a fascia round the edge.
  const dx0 = -26;
  const dx1 = 30;
  const dz = 19;
  for (let x = dx0, k = 0; x < dx1; x += 2.4, k++) {
    const x1 = Math.min(dx1, x + 2.15);
    const z0 = x > 21 ? -8 : -dz;
    const z1 = x > 21 ? 8 : dz;
    s.quad(V3(x, deckY, z0), V3(x1, deckY, z0), V3(x1, deckY, z1), V3(x, deckY, z1), k % 3 ? P.deck : P.deck2);
  }
  box(s, (dx0 + 21) / 2, deckY - 0.9, dz, 21 - dx0, 1.8, 0.6, 0, P.pile);
  box(s, (dx0 + 21) / 2, deckY - 0.9, -dz, 21 - dx0, 1.8, 0.6, 0, P.pile);
  box(s, dx0, deckY - 0.9, 0, 0.6, 1.8, dz * 2, 0, P.pile);
  // Walls: board and batten (vertical strips), gables east and west.
  const x0 = -15;
  const x1 = 18;
  const z0 = -12;
  const z1 = 12;
  const eave = deckY + 15;
  const ridge = deckY + 28;
  const inside = V3((x0 + x1) / 2, deckY + 8, 0);
  const wallCol = (k: number) => (k % 2 ? P.wall : P.wall2);
  for (const zz of [z0, z1]) {
    for (let x = x0, k = 0; x < x1 - 0.01; x += 2.2, k++) {
      const xe = Math.min(x1, x + 2.2);
      s.quad(V3(x, deckY, zz), V3(xe, deckY, zz), V3(xe, eave, zz), V3(x, eave, zz), wallCol(k), null, inside);
    }
  }
  for (const xx of [x0, x1]) {
    for (let z = z0, k = 0; z < z1 - 0.01; z += 2.2, k++) {
      const ze = Math.min(z1, z + 2.2);
      const topAt = (zv: number) => eave + (ridge - eave) * (1 - Math.abs(zv) / z1);
      s.quad(V3(xx, deckY, z), V3(xx, deckY, ze), V3(xx, topAt(ze), ze), V3(xx, topAt(z), z), wallCol(k), null, inside);
    }
  }
  // Corner boards and a sill, cream.
  for (const [x, z] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]] as const) box(s, x, (deckY + eave) / 2, z, 1.1, eave - deckY, 1.1, 0, P.trim);
  // Roof: two slopes with shingle rows, a ridge cap, bargeboards.
  const ov = 2.6;
  for (const sd of [-1, 1]) {
    const zE = sd * (z1 + ov);
    const yE = eave - ov * ((ridge - eave) / z1);
    for (let r = 0; r < 5; r++) {
      const t0 = r / 5;
      const t1 = (r + 1) / 5;
      const za = lerp(zE, 0, t0);
      const zb = lerp(zE, 0, t1);
      const ya = lerp(yE, ridge, t0) + 0.6;
      const yb = lerp(yE, ridge, t1) + 0.6;
      s.quad(V3(x0 - ov, ya, za), V3(x1 + ov, ya, za), V3(x1 + ov, yb, zb), V3(x0 - ov, yb, zb), r % 2 ? P.roof : P.roof2, null, V3(0, deckY, 0));
    }
    // Bargeboards along the gable edges.
    for (const xx of [x0 - ov, x1 + ov]) s.quad(V3(xx, yE + 0.6, zE), V3(xx, ridge + 0.6, 0), V3(xx, ridge - 0.8, 0), V3(xx, yE - 0.8, zE), P.trim);
  }
  box(s, (x0 + x1) / 2, ridge + 0.9, 0, x1 - x0 + ov * 2 + 0.4, 1.0, 1.4, 0, P.roof2);
  // Cupola with louvres and a weathervane.
  box(s, 3, ridge + 3.2, 0, 6, 6.5, 6, 0, P.wall, P.wall);
  for (const sd of [-1, 1]) for (let l = 0; l < 3; l++) box(s, 3, ridge + 1.6 + l * 1.5, sd * 3.05, 4.2, 0.5, 0.2, 0, P.iron);
  {
    const b = [V3(-0.6, ridge + 6.4, -4), V3(6.6, ridge + 6.4, -4), V3(6.6, ridge + 6.4, 4), V3(-0.6, ridge + 6.4, 4)];
    fan(s, b, V3(3, ridge + 11.5, 0), (i) => (i % 2 ? P.roof : P.roof2), null, V3(3, ridge + 4, 0));
  }
  tube(s, V3(3, ridge + 11.5, 0), V3(3, ridge + 16, 0), 0.25, 0.2, 3, P.iron, false);
  box(s, 3.4, ridge + 15.2, 0, 5, 0.35, 0.35, 0.5, P.iron);
  box(s, 5.6, ridge + 15.2, 0.9, 1.4, 1.1, 0.2, 0.5, P.iron);
  // Lean-to on the north side, and the stone chimney through it.
  const lz = -21;
  for (let x = 1, k = 0; x < 15; x += 2.2, k++) s.quad(V3(x, deckY, lz), V3(x + 2.2, deckY, lz), V3(x + 2.2, deckY + 9, lz), V3(x, deckY + 9, lz), wallCol(k), null, V3(8, deckY + 4, -16));
  for (const xx of [1, 15.4]) s.quad(V3(xx, deckY, lz), V3(xx, deckY, z0), V3(xx, deckY + 12.5, z0), V3(xx, deckY + 9, lz), P.wall2, null, V3(8, deckY + 4, -16));
  s.quad(V3(0, deckY + 13.2, z0 + 0.2), V3(16.4, deckY + 13.2, z0 + 0.2), V3(16.4, deckY + 8.6, lz - 1.6), V3(0, deckY + 8.6, lz - 1.6), P.roof, null, V3(8, deckY, -16));
  box(s, 11.5, deckY + 17, -17, 4.4, 34, 4.4, 0, P.chimney, P.chimney2);
  for (let r = 0; r < 6; r++) box(s, 11.5, deckY + 3 + r * 5.4, -17, 4.7, 0.5, 4.7, 0, P.chimney2);
  box(s, 11.5, deckY + 34.4, -17, 5.6, 1, 5.6, 0, P.chimney2);
  // Windows (gold, lamp glow), cream frames, dark mullions.
  const win = (cx: number, cy: number, cz: number, w: number, h: number, nx: number, nz: number) => {
    const o = 0.25;
    const tx = -nz;
    const tz = nx;
    const Q = (a: number, b: number, off: number) => V3(cx + tx * a + nx * off, cy + b, cz + tz * a + nz * off);
    s.quad(Q(-w / 2, -h / 2, o), Q(w / 2, -h / 2, o), Q(w / 2, h / 2, o), Q(-w / 2, h / 2, o), P.win, glow(LAMP, 1.0, 1));
    const f = 0.7;
    for (const [a0, b0, a1, b1] of [
      [-w / 2 - f, -h / 2 - f, w / 2 + f, -h / 2],
      [-w / 2 - f, h / 2, w / 2 + f, h / 2 + f],
      [-w / 2 - f, -h / 2, -w / 2, h / 2],
      [w / 2, -h / 2, w / 2 + f, h / 2],
    ] as const)
      s.quad(Q(a0, b0, o + 0.1), Q(a1, b0, o + 0.1), Q(a1, b1, o + 0.1), Q(a0, b1, o + 0.1), P.trim);
    s.quad(Q(-0.2, -h / 2, o + 0.12), Q(0.2, -h / 2, o + 0.12), Q(0.2, h / 2, o + 0.12), Q(-0.2, h / 2, o + 0.12), P.iron);
    s.quad(Q(-w / 2, -0.2, o + 0.12), Q(w / 2, -0.2, o + 0.12), Q(w / 2, 0.2, o + 0.12), Q(-w / 2, 0.2, o + 0.12), P.iron);
    halo(cx + nx * 2, cy, cz + nz * 2, 9 + w);
  };
  win(-6, deckY + 8.5, z1, 5, 6, 0, 1);
  win(8, deckY + 8.5, z1, 5, 6, 0, 1);
  win(-6, deckY + 8.5, z0, 5, 6, 0, -1);
  win(x1, deckY + 18.5, 0, 4, 4.5, 1, 0);
  // East door under a porch roof, a hanging lantern.
  s.quad(V3(x1 + 0.25, deckY, -6.2), V3(x1 + 0.25, deckY, -1.2), V3(x1 + 0.25, deckY + 10.5, -1.2), V3(x1 + 0.25, deckY + 10.5, -6.2), P.door);
  win(x1, deckY + 7.5, 4.8, 3.6, 4.2, 1, 0);
  for (const z of [-7.5, 7.5]) tube(s, V3(x1 + 9, deckY, z), V3(x1 + 9, deckY + 11.2, z), 0.6, 0.55, 4, P.brown, false);
  s.quad(V3(x1, deckY + 14.2, -9.5), V3(x1, deckY + 14.2, 9.5), V3(x1 + 10.5, deckY + 11, 9.5), V3(x1 + 10.5, deckY + 11, -9.5), P.roof2, null, V3(x1 + 5, deckY, 0));
  tube(s, V3(x1 + 6, deckY + 12.2, 2.5), V3(x1 + 6, deckY + 9.4, 2.5), 0.15, 0.15, 3, P.iron, false);
  box(s, x1 + 6, deckY + 8, 2.5, 1.8, 2.6, 1.8, 0, P.win, null, glow(LAMP, 1.1, 1));
  box(s, x1 + 6, deckY + 9.5, 2.5, 2.3, 0.5, 2.3, 0, P.iron);
  halo(x1 + 6, deckY + 8, 2.5, 16);
  // Railing on the south edge.
  for (let x = dx0 + 1; x <= 16; x += 6.4) box(s, x, deckY + 3.4, dz - 0.6, 0.7, 6.8, 0.7, 0, P.brown);
  box(s, (dx0 + 16) / 2 + 0.5, deckY + 6.4, dz - 0.6, 16 - dx0 + 1, 0.6, 0.6, 0, P.trim);
  box(s, (dx0 + 16) / 2 + 0.5, deckY + 3.4, dz - 0.6, 16 - dx0 + 1, 0.45, 0.45, 0, P.brown);
  // Life ring on the south wall.
  {
    const cx = 1.5;
    const cy = deckY + 8.5;
    const cz = z1 + 0.35;
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2;
      const a1 = ((i + 1) / 8) * Math.PI * 2;
      const R0 = 3;
      const R1 = 1.8;
      s.quad(V3(cx + Math.cos(a0) * R0, cy + Math.sin(a0) * R0, cz), V3(cx + Math.cos(a1) * R0, cy + Math.sin(a1) * R0, cz), V3(cx + Math.cos(a1) * R1, cy + Math.sin(a1) * R1, cz), V3(cx + Math.cos(a0) * R1, cy + Math.sin(a0) * R1, cz), i % 2 ? P.hullWhite : P.ringRed);
    }
  }
  // Story pair: a fishing rod against the wall, a bucket; oars; barrels; crates.
  tube(s, V3(13.5, deckY, z1 + 1.6), V3(11, deckY + 24, z1 + 0.8), 0.35, 0.14, 3, P.brown, false);
  s.quad(V3(11, deckY + 24, z1 + 0.8), V3(11.1, deckY + 24, z1 + 0.8), V3(15.8, deckY + 1.4, z1 + 2.6), V3(15.7, deckY + 1.4, z1 + 2.6), P.trim);
  tube(s, V3(15.6, deckY, z1 + 3), V3(15.6, deckY + 2.4, z1 + 3), 1.2, 1.4, 6, P.iron, false);
  for (const k of [0, 1]) {
    const x = -10 + k * 2.2;
    tube(s, V3(x, deckY, z1 + 1.1), V3(x + 1.2, deckY + 18, z1 + 0.5), 0.3, 0.3, 3, P.brown, false);
    box(s, x + 1.1, deckY + 16, z1 + 0.6, 1.8, 5, 0.3, 0, P.trim);
  }
  for (const [x, z] of [[-20, 15], [-17.2, 16.2]] as const) {
    tube(s, V3(x, deckY, z), V3(x, deckY + 5.2, z), 1.9, 1.9, 7, P.brown, true);
    box(s, x, deckY + 3.8, z, 4.1, 0.4, 4.1, 0.2, P.iron);
  }
  box(s, -20, deckY + 2.2, -15, 4.4, 4.4, 4.4, 0.3, P.deck2, P.canvas);
  box(s, -19.7, deckY + 6.2, -14.9, 3.6, 3.6, 3.6, 0.8, P.deck, P.canvas);
}

/** A white rowboat, local +x forward, waterline y 0, `L` long. */
function rowboat(s: Soup, L: number): void {
  const W = L * 0.2;
  const D = L * 0.12;
  const us = [0, 0.1, 0.28, 0.5, 0.7, 0.86, 1];
  const secs = us.map((u) => {
    const x = (u - 0.5) * L;
    const w = u < 0.5 ? W * (0.62 + 0.38 * Math.sin(Math.PI * u)) : W * Math.pow(Math.sin(Math.PI * u), 0.75);
    const gun = D * 0.55 + D * 0.7 * Math.pow(u - 0.45, 2) * 2.2;
    const d = D * (0.85 + 0.15 * Math.sin(Math.PI * u));
    return [V3(x, gun, -w), V3(x, gun - d * 0.72, -w * 0.78), V3(x, gun - d, 0), V3(x, gun - d * 0.72, w * 0.78), V3(x, gun, w)];
  });
  const mid = V3(0, D * 0.2, 0);
  for (let k = 0; k < secs.length - 1; k++) {
    const A = secs[k];
    const B = secs[k + 1];
    for (let j = 0; j < 4; j++) s.quad(A[j], B[j], B[j + 1], A[j + 1], j === 0 || j === 3 ? P.hullWhite : P.hullLow, null, mid);
    // Gunwale rail.
    for (const j of [0, 4]) s.quad(A[j], B[j], V3(B[j].x, B[j].y + 0.35, B[j].z), V3(A[j].x, A[j].y + 0.35, A[j].z), P.brown);
  }
  // Transom.
  const T = secs[0];
  s.quad(T[0], T[1], T[3], T[4], P.hullWhite, null, V3(L, 0, 0));
  s.tri(T[1], T[2], T[3], P.hullWhite, null, V3(L, 0, 0));
  // Floor boards and thwarts.
  const fy = D * 0.55 - D * 0.62;
  s.quad(V3(-L * 0.38, fy, -W * 0.55), V3(L * 0.3, fy, -W * 0.55), V3(L * 0.3, fy, W * 0.55), V3(-L * 0.38, fy, W * 0.55), P.hullIn);
  for (const x of [-L * 0.18, L * 0.12]) box(s, x, D * 0.35, 0, 2.6, 0.5, W * 1.7, 0, P.brown, P.trim);
  box(s, -L * 0.42, D * 0.4, 0, 3.4, 0.5, W * 1.1, 0, P.brown, P.trim);
  // Oars across the thwarts.
  for (const sd of [-1, 1]) {
    tube(s, V3(-L * 0.3, D * 0.7, sd * W * 0.35), V3(L * 0.25, D * 0.7, sd * W * 0.55), 0.3, 0.3, 3, P.trim, false);
    box(s, L * 0.3, D * 0.7, sd * W * 0.58, 5, 0.25, 1.6, sd * 0.05, P.trim);
  }
  // Bow line coiled forward.
  tube(s, V3(L * 0.36, D * 0.9, 0), V3(L * 0.4, D * 0.95, 0), 1.1, 1.1, 6, P.rope, true);
}

// ── Install ─────────────────────────────────────────────────────────────────

export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = performance.now();
  const scene = ctx.scene;
  const H = ctx.terrainHeight;
  const disposables: { dispose(): void }[] = [];
  const track = <X extends { dispose(): void }>(x: X): X => {
    disposables.push(x);
    return x;
  };
  const stats: Record<string, number | string> = {};
  const replaced: string[] = [];
  const restores: (() => void)[] = [];
  const removeByName = (name: string) => {
    const o = scene.getObjectByName(name);
    if (!o || !o.parent) return;
    const parent = o.parent;
    parent.remove(o);
    replaced.push(name);
    restores.push(() => parent.add(o));
  };

  const u: LfUniforms = { uTime: { value: 0 }, uMagic: { value: 0.9 }, uLamp: { value: 1 } };
  const mat = track(makeMaterial(u));
  const pxScale = { value: 600 };
  const haloMat = track(pointsMaterial(u, pxScale, false));
  const sporeMat = track(pointsMaterial(u, pxScale, true));
  const addMesh = (parent: THREE.Object3D, soup: Soup, name: string): THREE.Mesh => {
    const g = track(soup.geometry());
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    parent.add(m);
    stats[`tris:${name}`] = soup.tris;
    return m;
  };

  const A5 = PLACES[4].pos;
  const A6 = PLACES[5].pos;
  const L = WORLD.lake;
  const ly = L.y;

  // PATH as a polyline (for keeping the trail clear).
  const pathPts = PATH.map((p) => [p.x, p.z] as const);
  const pathDist = (x: number, z: number): number => {
    let best = Infinity;
    for (let i = 0; i < pathPts.length - 1; i++) {
      const [ax, az] = pathPts[i];
      const [bx, bz] = pathPts[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  };

  // ── a5: the boathouse ──
  const lmBoat = scene.getObjectByName("LM_Boathouse");
  const setA5 = scene.getObjectByName("Set_a5");
  const halosA5: number[] = [];
  if (lmBoat) {
    removeByName("Landmark_a5");
    const s = new Soup();
    boathouse(s, ly - A5.y, (x, z) => H(A5.x + x, A5.z + z) - A5.y, halosA5);
    addMesh(lmBoat, s, "Boathouse");
  }
  let rowboatMesh: THREE.Mesh | null = null;
  let rowboatBase = V3();
  let lilies: THREE.Mesh | null = null;
  if (setA5) {
    removeByName("Set_a5_Block");
    const s = new Soup();
    const toL = (x: number, y: number, z: number) => V3(x - A5.x, y - A5.y, z - A5.z);
    // The jetty: from the east shore to the boathouse porch.
    const j0 = { x: 1350, z: -440 };
    const j1 = { x: A5.x + 30, z: A5.z - 2 };
    const len = Math.hypot(j1.x - j0.x, j1.z - j0.z);
    const dirx = (j1.x - j0.x) / len;
    const dirz = (j1.z - j0.z) / len;
    const nx = -dirz;
    const nz = dirx;
    const jy = ly + 4.2;
    const at = (d: number, off: number, y: number) => toL(j0.x + dirx * d + nx * off, y, j0.z + dirz * d + nz * off);
    // The side of the jetty the a5 camera stands on.
    const camK = TRAIL[PLACES[4].trail];
    const side = Math.sign((camK[0] - (j0.x + j1.x) / 2) * nx + (camK[2] - (j0.z + j1.z) / 2) * nz) || 1;
    for (let d = -6, k = 0; d < len; d += 2.3, k++) {
      const e = Math.min(len, d + 2.0);
      s.quad(at(d, -4.6, jy), at(e, -4.6, jy), at(e, 4.6, jy), at(d, 4.6, jy), k % 4 === 0 ? P.deck2 : P.deck);
    }
    for (const sd of [-1, 1]) s.quad(at(-6, sd * 4.7, jy), at(len, sd * 4.7, jy), at(len, sd * 4.7, jy - 1.6), at(-6, sd * 4.7, jy - 1.6), P.pile);
    for (let d = 4; d < len; d += 15) {
      for (const sd of [-1, 1]) {
        const w = at(d, sd * 4.4, 0);
        const g = Math.min(ly - 1.5, H(w.x + A5.x, w.z + A5.z)) - A5.y;
        tube(s, V3(w.x, g, w.z), V3(w.x, jy - A5.y + 1.2, w.z), 0.95, 0.85, 5, P.pile, true);
      }
    }
    // Lantern posts on alternate sides.
    const halos = halosA5;
    for (let k = 0; k < 4; k++) {
      const d = 20 + k * ((len - 30) / 3);
      const sd = k % 2 ? -1 : 1;
      const b = at(d, sd * 4.1, jy);
      box(s, b.x, b.y + 6, b.z, 0.9, 12, 0.9, 0, P.brown);
      box(s, b.x, b.y + 13.2, b.z, 1.9, 2.6, 1.9, 0, P.win, null, glow(LAMP, 1.1, 1));
      const cap = [V3(b.x - 1.4, b.y + 14.6, b.z - 1.4), V3(b.x + 1.4, b.y + 14.6, b.z - 1.4), V3(b.x + 1.4, b.y + 14.6, b.z + 1.4), V3(b.x - 1.4, b.y + 14.6, b.z + 1.4)];
      fan(s, cap, V3(b.x, b.y + 16.2, b.z), () => P.iron, null, V3(b.x, b.y + 12, b.z));
      halos.push(b.x, b.y + 13.2, b.z, 14);
    }
    // Cleats and a mooring post where the rowboat is tied.
    const tieD = len - 42;
    const tie = at(tieD, 4.5 * side, jy);
    box(s, tie.x, tie.y + 1.4, tie.z, 1.2, 2.8, 1.2, 0, P.pile);
    // The rowboat: its own mesh (it bobs), alongside the jetty on the camera's side.
    {
      const rb = new Soup();
      rowboat(rb, 34);
      const g = track(rb.geometry());
      rowboatMesh = new THREE.Mesh(g, mat);
      rowboatMesh.name = "LakeRowboat";
      const c = at(tieD - 4, 12.5 * side, ly + 0.3);
      rowboatMesh.position.copy(c);
      rowboatMesh.rotation.y = Math.atan2(-dirz, dirx) + Math.PI + 0.12;
      rowboatBase = c.clone();
      setA5.add(rowboatMesh);
      stats["tris:LakeRowboat"] = rb.tris;
      // The line from its bow to the cleat.
      const bow = V3(17 * Math.cos(rowboatMesh.rotation.y), 0, -17 * Math.sin(rowboatMesh.rotation.y)).add(c);
      tube(s, V3(bow.x, bow.y + 3.5, bow.z), V3(tie.x, tie.y + 2.6, tie.z), 0.18, 0.18, 3, P.rope, false);
    }
    // The jetty's foot: steps down, a blazed post with a signboard, a supply cache, a canoe on the shore.
    {
      const f = at(-8, 0, 0);
      const gf = H(f.x + A5.x, f.z + A5.z) - A5.y;
      box(s, f.x, Math.max(gf, jy - A5.y - 2) , f.z, 7, 1.2, 10, Math.atan2(-dirz, dirx), P.deck2);
      const bp = at(-14, -9, 0);
      const gb = H(bp.x + A5.x, bp.z + A5.z) - A5.y;
      box(s, bp.x, gb + 7, bp.z, 1.3, 14, 1.3, 0.3, P.brown);
      box(s, bp.x, gb + 10.5, bp.z + 0.7, 0.9, 2.2, 0.3, 0.3, P.trim);
      box(s, bp.x + 2.2, gb + 12.3, bp.z, 5.6, 1.8, 0.4, 0.35, P.deck, P.trim);
      const cache = at(-18, 10, 0);
      const gc = H(cache.x + A5.x, cache.z + A5.z) - A5.y;
      box(s, cache.x, gc + 2.2, cache.z, 4.6, 4.4, 4.6, 0.2, P.deck2, P.canvas);
      box(s, cache.x + 4.8, gc + 2.2, cache.z + 0.6, 4.6, 4.4, 4.6, 0.5, P.deck, P.canvas);
      box(s, cache.x + 2.4, gc + 6.4, cache.z + 0.2, 4.2, 4, 4.2, 0.9, P.deck2, P.canvas);
      box(s, cache.x - 3.6, gc + 2.6, cache.z - 2.2, 3.2, 5.2, 2.4, 0.6, P.canvas);
      // Canoe, upturned on the grass south of the jetty.
      const cn = at(-4, 26 * side, 0);
      const gcn = H(cn.x + A5.x, cn.z + A5.z) - A5.y;
      const cs = new Soup();
      const CL = 26;
      const secs = [0, 0.2, 0.5, 0.8, 1].map((t) => {
        const x = (t - 0.5) * CL;
        const w = 2.6 * Math.pow(Math.sin(Math.PI * t), 0.6);
        return [V3(x, 0, -w), V3(x, 2.2 * Math.pow(Math.sin(Math.PI * t), 0.3) + 0.3, 0), V3(x, 0, w)];
      });
      for (let k = 0; k < secs.length - 1; k++) for (let j = 0; j < 2; j++) cs.quad(secs[k][j], secs[k + 1][j], secs[k + 1][j + 1], secs[k][j + 1], P.canoe, null, V3(0, -1, 0));
      const m = new THREE.Matrix4().makeRotationY(Math.atan2(-dirz, dirx) + 0.7).setPosition(cn.x, gcn + 0.2, cn.z);
      cs.xform(0, m);
      for (let i = 0; i < cs.p.length; i++) s.p.push(cs.p[i]);
      for (let i = 0; i < cs.n.length; i++) s.n.push(cs.n[i]);
      for (let i = 0; i < cs.c.length; i++) s.c.push(cs.c[i]);
      for (let i = 0; i < cs.g.length; i++) s.g.push(cs.g[i]);
      tube(s, V3(cn.x - 3, gcn + 0.3, cn.z + 3), V3(cn.x + 7, gcn + 0.6, cn.z + 6), 0.3, 0.3, 3, P.brown, false);
    }
    // Reed beds: the boathouse piles, the jetty foot, the stop's lower left.
    const reedBed = (cx: number, cz: number, r: number, n: number, seed: number) => {
      for (let i = 0; i < n; i++) {
        const a = rnd(seed + i, 41) * Math.PI * 2;
        const rr = Math.sqrt(rnd(seed + i, 42)) * r;
        const x = cx + Math.cos(a) * rr;
        const z = cz + Math.sin(a) * rr;
        const g = H(x, z);
        if (g > ly + 4 || g < ly - 5) continue;
        const base = toL(x, Math.max(g, ly - 0.5), z);
        const h = 9 + rnd(seed + i, 43) * 6;
        for (let b = 0; b < 5; b++) {
          const ba = rnd(seed + i + b, 44) * Math.PI * 2;
          const lean = 0.18 * rnd(seed + i + b, 45);
          const top = V3(base.x + Math.cos(ba) * h * lean, base.y + h * (0.8 + 0.3 * rnd(b, 46)), base.z + Math.sin(ba) * h * lean);
          const w = 0.55;
          s.tri(V3(base.x - Math.sin(ba) * w, base.y, base.z + Math.cos(ba) * w), V3(base.x + Math.sin(ba) * w, base.y, base.z - Math.cos(ba) * w), top, [P.reed, P.reed, P.reedTip]);
        }
        if (rnd(seed + i, 47) < 0.55) {
          const hx = base.x + 0.4;
          const hz = base.z;
          box(s, hx, base.y + h * 0.95, hz, 0.8, 2.6, 0.8, 0, P.reedHead);
        }
      }
    };
    reedBed(A5.x - 26, A5.z + 20, 16, 40, 100);
    reedBed(A5.x - 18, A5.z - 26, 14, 30, 200);
    reedBed(j0.x - 6, j0.z + 14, 16, 34, 300);
    reedBed(j0.x - 4, j0.z - 16, 14, 26, 400);
    // The lower left of the a5 frame: find the shore where the stop camera looks.
    for (const [nxs, nys] of [[-0.78, -0.62], [-0.55, -0.8], [-0.9, -0.35]] as const) {
      const hit = stopRay(PLACES[4].trail, nxs, nys);
      if (!hit) continue;
      let hx = hit.x;
      let hz = hit.z;
      // Walk toward the shore if the ray met water.
      for (let t = 0; t < 30 && H(hx, hz) < ly - 3; t++) {
        const dx = hx - L.x;
        const dz = hz - L.z;
        const d = Math.hypot(dx, dz) || 1;
        hx += (dx / d) * 8;
        hz += (dz / d) * 8;
      }
      reedBed(hx, hz, 24, 46, 500 + Math.round(nxs * 100));
    }
    stats.reedBeds = 7;
    addMesh(setA5, s, "LakeSet");
    // Pass 3: the dark framing shape on the lower left (bible a5 "Front"): a
    // rock islet in the shallows 292 out from the stop, black boulders with
    // reeds at the waterline and a leaning spruce, a silhouette against the
    // bright reflection. Its own mesh on NO_REFLECT_LAYER: at this stop its
    // mirror image falls below the frame, so the reflection pass never pays
    // for it (a5 is the heaviest frame).
    {
      const fr = new Soup();
      const cam = TRAIL[PLACES[4].trail];
      const bearing = 280 * DEG;
      const cx = cam[0] + Math.sin(bearing) * 292;
      const cz = cam[2] - Math.cos(bearing) * 292;
      const rockA = C(0x221f27);
      const rockB = C(0x2c2832);
      const rockTop = C(0x3a3440);
      const needle = C(0x1a211f);
      const needle2 = C(0x222a26);
      const bark = C(0x2a211d);
      const boulder = (bx: number, bz: number, rx: number, ry: number, rz: number, seed: number) => {
        const geo = new THREE.IcosahedronGeometry(1, 0);
        const pos = geo.getAttribute("position");
        const idx = geo.index;
        const vs: V[] = [];
        for (let i = 0; i < pos.count; i++) {
          const j = 0.82 + 0.36 * rnd(seed * 31 + i, 61);
          const y = pos.getY(i);
          vs.push(toL(bx + pos.getX(i) * rx * j, ly - 3 + (y + 0.35) * ry * j, bz + pos.getZ(i) * rz * j));
        }
        const centre = toL(bx, ly - 3 + 0.35 * ry, bz);
        const tri = (a: number, b: number, c: number) => {
          const up = (vs[a].y + vs[b].y + vs[c].y) / 3 > centre.y + ry * 0.45;
          fr.tri(vs[a], vs[b], vs[c], up ? rockTop : rnd(a + b + c, seed) < 0.5 ? rockA : rockB, null, centre);
        };
        if (idx) for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
        else for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
        geo.dispose();
      };
      // Boulders: one large, two medium, small ones (bible 3.3 groups).
      const rocks: [number, number, number, number, number][] = [
        [0, 0, 19, 17, 15], [-15, 9, 12, 11, 11], [14, 7, 11, 8, 10], [-26, -4, 6, 5, 6], [24, -6, 5, 4, 5], [6, 16, 7, 5, 6], [-6, -15, 5, 4, 5],
      ];
      rocks.forEach(([dx, dz, rx, ry, rz], i) => boulder(cx + dx, cz + dz, rx, ry, rz, 11 + i));
      // A leaning spruce rooted in the big boulder's crack, leaning into the
      // frame (screen right is bearing 28) and a little over the water.
      const spruceAt = (bx: number, bz: number, h: number, leanB: number, lean: number, seed: number) => {
        const base = toL(bx, ly + 9, bz);
        const lx = Math.sin(leanB * DEG) * Math.sin(lean);
        const lz = -Math.cos(leanB * DEG) * Math.sin(lean);
        const ax = V3(lx, Math.cos(lean), lz);
        const at = (t: number) => base.clone().addScaledVector(ax, h * t);
        tube(fr, at(-0.05), at(0.35), h * 0.035, h * 0.022, 5, bark, true);
        const tiers = 5;
        for (let t = 0; t < tiers; t++) {
          const f = t / tiers;
          const y0 = 0.2 + f * 0.66;
          const r = h * 0.26 * (1 - f * 0.7);
          const c0 = at(y0);
          const apex = at(y0 + 0.3 - f * 0.05);
          // Zigzag skirt: a jittered ring, drooping a little.
          const R = ring(c0, r, 7, rnd(seed + t, 62) * 6, r, 0.18, seed * 13 + t);
          for (const q of R) q.y -= r * 0.18;
          const col = t % 2 ? needle2 : needle;
          fan(fr, R, apex, () => col, null, c0.clone().addScaledVector(ax, -h * 0.1));
          for (let k = 0; k < R.length; k++) fr.tri(R[(k + 1) % R.length], R[k], c0, col);
        }
      };
      spruceAt(cx - 4, cz + 2, 58, 28, 0.2, 5);
      spruceAt(cx - 16, cz + 10, 30, 350, 0.08, 9);
      // Reeds in the shallows round the islet.
      for (let i = 0; i < 70; i++) {
        const a = rnd(i, 63) * Math.PI * 2;
        const rr = 20 + rnd(i, 64) * 16;
        const bx = cx + Math.cos(a) * rr * 1.2;
        const bz = cz + Math.sin(a) * rr * 0.8;
        const base = toL(bx, ly - 0.4, bz);
        const hh = 8 + rnd(i, 65) * 7;
        for (let b = 0; b < 4; b++) {
          const ba = rnd(i * 5 + b, 66) * Math.PI * 2;
          const top = V3(base.x + Math.cos(ba) * hh * 0.15, base.y + hh * (0.8 + 0.3 * rnd(b + i, 67)), base.z + Math.sin(ba) * hh * 0.15);
          fr.tri(V3(base.x - Math.sin(ba) * 0.6, base.y, base.z + Math.cos(ba) * 0.6), V3(base.x + Math.sin(ba) * 0.6, base.y, base.z - Math.cos(ba) * 0.6), top, [P.reed, P.reed, P.reedTip]);
        }
      }
      const frame = addMesh(setA5, fr, "LakeFrame");
      frame.layers.set(NO_REFLECT_LAYER);
    }
    // Lily pads (flat on the water: not drawn in the reflection).
    const ls = new Soup();
    const lilyPatch = (cx: number, cz: number, r: number, n: number, seed: number) => {
      for (let i = 0; i < n; i++) {
        const a = rnd(seed + i, 51) * Math.PI * 2;
        const rr = Math.sqrt(rnd(seed + i, 52)) * r;
        const x = cx + Math.cos(a) * rr;
        const z = cz + Math.sin(a) * rr;
        const g = H(x, z);
        if (g > ly - 1.2) continue;
        const c = toL(x, ly + 0.35, z);
        const pr = 2.2 + rnd(seed + i, 53) * 2.4;
        const rot = rnd(seed + i, 54) * Math.PI * 2;
        const pts: V[] = [];
        for (let k = 0; k < 7; k++) {
          const t = rot + 0.45 + (k / 7) * (Math.PI * 2 - 0.9);
          pts.push(V3(c.x + Math.cos(t) * pr, c.y, c.z + Math.sin(t) * pr));
        }
        for (let k = 0; k < pts.length - 1; k++) ls.tri(pts[k], pts[k + 1], c, [P.lilyRim, P.lilyRim, P.lily]);
        if (rnd(seed + i, 55) < 0.14) {
          const f = V3(c.x + 0.6, c.y + 0.3, c.z);
          octa(ls, V3(f.x, f.y + 0.5, f.z), 0.9, 0.6, 0.9, P.lilyFlower);
        }
      }
    };
    lilyPatch(A5.x - 34, A5.z + 34, 26, 60, 700);
    lilyPatch(j0.x - 30, j0.z + 22, 22, 42, 800);
    lilyPatch(A5.x - 40, A5.z - 30, 20, 34, 900);
    lilyPatch(j0.x - 60, j0.z - 20, 16, 26, 1000);
    lilies = addMesh(setA5, ls, "LakeLilies");
    lilies.layers.set(NO_REFLECT_LAYER);
    // Lamp halos (windows, the porch lantern, the jetty lanterns).
    {
      const hs = new THREE.BufferGeometry();
      const pos: number[] = [];
      const seed: number[] = [];
      const col: number[] = [];
      // The boathouse's halos are in LM_Boathouse's frame, the jetty's in Set_a5's: both groups sit at A5.
      for (let i = 0; i < halosA5.length; i += 4) {
        pos.push(halosA5[i], halosA5[i + 1], halosA5[i + 2]);
        seed.push(halosA5[i + 3], 0, 0, 0);
        col.push(1.0, 0.62, 0.26);
      }
      hs.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      hs.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 4));
      hs.setAttribute("aCol", new THREE.Float32BufferAttribute(col, 3));
      hs.computeBoundingSphere();
      track(hs);
      const pts = new THREE.Points(hs, haloMat);
      pts.name = "LakeHalos";
      pts.renderOrder = 6;
      setA5.add(pts);
    }
  }

  // ── The walk from the collar: cairns and a log over the brook ──
  const meadowSet = scene.getObjectByName("Set_meadow");
  if (meadowSet) {
    const s = new Soup();
    const o = meadowSet.position;
    const toL = (x: number, y: number, z: number) => V3(x - o.x, y - o.y, z - o.z);
    const brookDist = (x: number, z: number) => {
      let best = Infinity;
      for (let i = 0; i < BROOK.length - 1; i++) {
        const [ax, , az] = BROOK[i];
        const [bx, , bz] = BROOK[i + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
      }
      return best;
    };
    const walk = PATH.filter((p) => p.x > 1300 && p.z <= 950 && p.z >= -430 && p.y > 500);
    let acc = 60;
    let cairns = 0;
    for (let i = 0; i < walk.length - 1; i++) {
      const a = walk[i];
      const b = walk[i + 1];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      while (acc < seg) {
        const t = acc / seg;
        const dx = (b.x - a.x) / seg;
        const dz = (b.z - a.z) / seg;
        const side = cairns % 2 ? -1 : 1;
        const x = a.x + (b.x - a.x) * t - dz * 12 * side;
        const z = a.z + (b.z - a.z) * t + dx * 12 * side;
        if (brookDist(x, z) > 22) {
          const g = H(x, z);
          let y = g - 0.6;
          for (let k = 0; k < 5; k++) {
            const r = 3.4 - k * 0.55;
            const hh = 1.5 - k * 0.12;
            const c = toL(x + (rnd(cairns + k, 61) - 0.5) * 0.8, y + hh, z + (rnd(cairns + k, 62) - 0.5) * 0.8);
            octa(s, c, r, hh, r * 0.85, k === 4 ? P.cairnTop : P.cairn);
            y += hh * 1.7;
          }
          cairns++;
        }
        acc += 110;
      }
      acc -= seg;
    }
    stats.cairns = cairns;
    // The fallen log over the brook, a root plate at one end.
    {
      const [ax, ay, az] = BROOK[1];
      const [bx, by, bz] = BROOK[2];
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const bdx = bx - ax;
      const bdz = bz - az;
      const bl = Math.hypot(bdx, bdz);
      const px = -bdz / bl;
      const pz = bdx / bl;
      const e0 = [cx - px * 19, cz - pz * 19] as const;
      const e1 = [cx + px * 19, cz + pz * 19] as const;
      const y0 = H(e0[0], e0[1]) + 2;
      const y1 = H(e1[0], e1[1]) + 2;
      const wy = Math.max((ay + by) / 2 + 3, Math.min(y0, y1));
      const A = toL(e0[0], Math.max(wy, y0), e0[1]);
      const B = toL(e1[0], Math.max(wy, y1), e1[1]);
      tube(s, A, B, 2.8, 2.3, 7, (i) => (i === 2 || i === 3 ? P.logMoss : P.log), true, 0.3);
      // The root plate stands across the log's axis (px, pz) at its end A.
      const plate: V[] = [];
      for (let k = 0; k < 8; k++) {
        const t = (k / 8) * Math.PI * 2;
        const r = 5.5 + rnd(k, 63) * 2.5;
        plate.push(V3(A.x - pz * Math.cos(t) * r, A.y + Math.sin(t) * r, A.z + px * Math.cos(t) * r));
      }
      fan(s, plate, V3(A.x - px * 1.2, A.y, A.z - pz * 1.2), () => P.earth, null, V3(A.x + px * 4, A.y, A.z + pz * 4));
      for (let k = 0; k < 3; k++) {
        const t = 0.3 + k * 0.22;
        const q = V3(lerp(A.x, B.x, t), lerp(A.y, B.y, t) + 1.5, lerp(A.z, B.z, t));
        tube(s, q, V3(q.x + (rnd(k, 64) - 0.5) * 4, q.y + 4 + rnd(k, 65) * 3, q.z + (rnd(k, 66) - 0.5) * 4), 0.7, 0.4, 3, P.log, false);
      }
      void ay;
    }
    addMesh(meadowSet, s, "MeadowVignettes");
  }

  // ── a6: the Great Tree ──
  const lmTree = scene.getObjectByName("LM_GreatTree");
  let sporePts: THREE.Points | null = null;
  const setA6 = scene.getObjectByName("Set_a6");
  if (lmTree) {
    removeByName("Landmark_a6");
    const s = new Soup();
    const { spores } = greatTree(
      s,
      (x, z) => [A6.x + x, A6.z + z],
      (x, z) => H(A6.x + x, A6.z + z) - A6.y,
      pathDist,
    );
    addMesh(lmTree, s, "GreatTree");
    // Spores rising from the roots.
    if (setA6) {
      const g = new THREE.BufferGeometry();
      const pos: number[] = [];
      const seed: number[] = [];
      const col: number[] = [];
      for (let i = 0; i < SPORES; i++) {
        const base = spores.length ? spores[i % spores.length] : V3();
        const near = i % 3 === 0;
        pos.push(near ? base.x : 0, near ? base.y : 0, near ? base.z : 0);
        seed.push(rnd(i, 71) * Math.PI * 2, near ? rnd(i, 72) * 14 : 30 + rnd(i, 72) * 80, rnd(i, 73), 4 + rnd(i, 74) * 8);
        const c = i % 3 === 1 ? VIOLET : i % 5 === 0 ? CYAN : TEAL;
        col.push(c[0] * 0.9, c[1] * 0.9, c[2] * 0.9);
      }
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 4));
      g.setAttribute("aCol", new THREE.Float32BufferAttribute(col, 3));
      g.boundingSphere = new THREE.Sphere(V3(0, 80, 0), 220);
      track(g);
      sporePts = new THREE.Points(g, sporeMat);
      sporePts.name = "GreatTreeSpores";
      sporePts.renderOrder = 6;
      // Set_a6 sits at A6 too; the spores are in the tree's local frame.
      sporePts.position.set(A6.x - setA6.position.x, A6.y - setA6.position.y, A6.z - setA6.position.z);
      setA6.add(sporePts);
    }
  }

  // ── a6: the giant elders ──
  interface Giant {
    cx: number;
    cy: number;
    cz: number;
    r: number;
    sp: 0 | 1;
    m: Float32Array;
  }
  const giants: Giant[] = [];
  /** Pass 3 floor meshes: drawn only while the camera is near the forest (not from the lake, not in its mirror). */
  const floorNear: THREE.Object3D[] = [];
  let floorShown: boolean | null = null;
  const giantMeshes: THREE.InstancedMesh[][] = [];
  let giantFarMesh: THREE.InstancedMesh | null = null;
  if (setA6) {
    removeByName("Set_a6_Block");
    removeByName("ForestMagic");
    const Fo = WORLD.forest;
    const GH = GREAT_TREE.height;
    const curve = new THREE.CatmullRomCurve3(TRAIL.map((q) => new THREE.Vector3(q[0], q[1], q[2])), false, "centripetal");
    const n1 = TRAIL.length - 1;
    const cam: THREE.Vector3[] = [];
    const tA = (PLACES[4].trail + 1) / n1;
    const tB = (PLACES[5].trail + 4) / n1;
    for (let i = 0; i <= 500; i++) cam.push(curve.getPoint(tA + ((tB - tA) * i) / 500));
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
    const S = GIANT_GRID;
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const so = setA6.position;
    for (let gz = Fo.z - Fo.r; gz <= Fo.z + Fo.r; gz += S) {
      for (let gx = Fo.x - Fo.r; gx <= Fo.x + Fo.r; gx += S) {
        const k = gx * 3.1 + gz * 7.7;
        const tx = gx + (rnd(k, 101) - 0.5) * S * 0.8;
        const tz = gz + (rnd(k, 102) - 0.5) * S * 0.8;
        const rr = Math.hypot(tx - Fo.x, tz - Fo.z) / Fo.r;
        if (rr > 1 - rnd(k, 103) * 0.12) continue;
        if (Math.hypot(tx - Fo.clearing.x, tz - Fo.clearing.z) < Fo.clearing.r + 10) continue;
        if (Math.hypot(tx - L.x, tz - L.z) < L.r + 40) continue;
        let h = (185 - 90 * rr) * (0.82 + 0.3 * rnd(k, 104));
        if (tx > -220) h = Math.min(h, 125 - Math.max(0, tx + 220) * 0.12);
        const dG = Math.hypot(tx - A6.x, tz - A6.z);
        h = Math.min(h, GH / 2 - 2 + Math.max(0, dG - 260) * 0.45);
        const sp: 0 | 1 = rnd(k, 110) < TIERED_SHARE ? 0 : 1;
        const tr = h * 0.075;
        if (!keepClear(tx, tz, tr + 6)) continue;
        const g = H(tx, tz);
        let near = Infinity;
        let camY = -Infinity;
        const w = h * (0.92 + rnd(k, 111) * 0.18);
        // How far the crown reaches from the axis: the tiered discs (and the side pad), the weeping lobes.
        const cr = w * (sp === 0 ? 0.37 : 0.46);
        for (const c of cam) {
          const d = Math.hypot(c.x - tx, c.z - tz);
          if (d < near) near = d;
          if (d < cr + 16) camY = Math.max(camY, c.y);
        }
        if (near < tr + 30) continue;
        // Crowns over the camera's line start 14 above it (the weeping strands hang to 0.3 of the height).
        const low = sp === 0 ? 0.5 : 0.3;
        let sy = 1;
        if (camY > -Infinity) sy = Math.max(1, (camY + 14 - g) / (h * low));
        if (sy > 1.45) continue;
        const us = underSteps(tx, tz);
        if (us.d < cr + 30 && g + h * sy > us.y - 40) continue;
        e.set((rnd(k, 112) - 0.5) * 3 * DEG, rnd(k, 113) * Math.PI * 2, (rnd(k, 114) - 0.5) * 3 * DEG);
        q.setFromEuler(e);
        mtx.compose(V3(tx - so.x, g - 1 - so.y, tz - so.z), q, V3(w, h * sy, w));
        giants.push({ cx: tx, cy: g + h * sy * 0.55, cz: tz, r: Math.max(h * sy * 0.55, w * 0.34), sp, m: Float32Array.from(mtx.elements) });
      }
    }
    stats.giants = giants.length;
    const counts = [0, 0];
    for (const t of giants) counts[t.sp]++;
    stats.giantsTiered = counts[0];
    stats.giantsWeeping = counts[1];
    const mk = (soup: Soup, cap: number, name: string) => {
      const g = track(soup.geometry());
      const m = new THREE.InstancedMesh(g, mat, Math.max(1, cap));
      m.name = name;
      m.frustumCulled = false;
      m.count = 0;
      m.visible = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      setA6.add(m);
      stats[`tris:${name}`] = soup.tris;
      return m;
    };
    giantMeshes.push([mk(tieredElder(0), counts[0], "GiantTiered_L0"), mk(tieredElder(1), counts[0], "GiantTiered_L1")]);
    giantMeshes.push([mk(weepingElder(0), counts[1], "GiantWeeping_L0"), mk(weepingElder(1), counts[1], "GiantWeeping_L1")]);
    giantFarMesh = mk(giantFar(), giants.length, "Giant_L2");

    // ── Pass 3: the forest floor (bible a6 "Front", the crossing) ──
    // Pass 2's floor was an empty navy plain. Near the walk: surface roots
    // running out from the giants with a vein pulsing along each, a path of
    // pale flat stones along the trail to the Great Tree (the leading line),
    // and soft pools of teal and violet light on the ground under the giants
    // and round the Great Tree's roots.
    {
      const fl = new Soup();
      const toL6 = (x: number, y: number, z: number) => V3(x - so.x, y - so.y, z - so.z);
      const forestPath = pathPts.filter(([x, z]) => Math.hypot(x - Fo.x, z - Fo.z) < Fo.r + 60);
      const rootBark = C(0x2b2530);
      const rootBark2 = C(0x221e28);
      const nearWalk = (x: number, z: number, r: number) => pathDist(x, z) < r;
      let nRoots = 0;
      const pools: [number, number, number, number, number][] = []; // x, z, radius, hue (0 teal, 1 violet), strength
      for (let gi = 0; gi < giants.length; gi++) {
        const t = giants[gi];
        const w = Math.hypot(t.m[0], t.m[1], t.m[2]);
        if (nearWalk(t.cx, t.cz, 320)) pools.push([t.cx, t.cz, w * 0.42, rnd(gi, 301) < 0.7 ? 0 : 1, 0.8 + rnd(gi, 302) * 0.4]);
        if (!nearWalk(t.cx, t.cz, 280)) continue;
        const nr = 3 + Math.floor(rnd(gi, 303) * 3);
        const trunkR = w * 0.07;
        for (let k = 0; k < nr; k++) {
          const a = rnd(gi * 7 + k, 304) * Math.PI * 2;
          const len = w * (0.22 + rnd(gi * 7 + k, 305) * 0.24);
          const bend = (rnd(gi * 7 + k, 306) - 0.5) * 0.9;
          const pts: V[] = [];
          const segs = 4;
          for (let sI = 0; sI <= segs; sI++) {
            const f = sI / segs;
            const aa = a + bend * f * f;
            const d = trunkR * 0.8 + len * f;
            const x = t.cx + Math.cos(aa) * d;
            const z = t.cz + Math.sin(aa) * d;
            if (sI > 0 && pathDist(x, z) < 5) break;
            const rr = (1 - f * 0.8) * trunkR * 0.42;
            pts.push(toL6(x, H(x, z) + rr * 0.35 - 0.4, z));
          }
          for (let sI = 0; sI < pts.length - 1; sI++) {
            const f0 = sI / segs;
            const f1 = (sI + 1) / segs;
            const r0 = (1 - f0 * 0.8) * trunkR * 0.42;
            const r1 = (1 - f1 * 0.8) * trunkR * 0.42;
            tube(fl, pts[sI], pts[sI + 1], r0, r1, 5, sI % 2 ? rootBark : rootBark2, sI === pts.length - 2);
            // The vein along the top, pulsing outward from the trunk.
            const a0 = pts[sI].clone();
            a0.y += r0 * 0.95;
            const b0 = pts[sI + 1].clone();
            b0.y += r1 * 0.95;
            ribbon(fl, a0, b0, Math.max(0.5, r0 * 0.35), V3(0, 1, 0), rootBark, rootBark, vein(TEAL, 0.75, f0 * 3), vein(TEAL, 0.75, f1 * 3));
          }
          nRoots++;
        }
      }
      // The path: flat stones along the trail through the forest, alternating
      // either side of the line, every ~8; one in five carries a rune.
      let nStones = 0;
      for (let i = 0; i < forestPath.length - 1; i++) {
        const [ax, az] = forestPath[i];
        const [bx, bz] = forestPath[i + 1];
        const segL = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / segL;
        const uz = (bz - az) / segL;
        for (let d = 0; d < segL; d += 7.5 + rnd(i * 97 + d, 311) * 2) {
          const side = (nStones % 2 ? 1 : -1) * (1.2 + rnd(nStones, 312) * 1.6);
          const x = ax + ux * d - uz * side;
          const z = az + uz * d + ux * side;
          if (Math.hypot(x - Fo.x, z - Fo.z) > Fo.r + 40) continue;
          const r = 2.6 + rnd(nStones, 313) * 1.6;
          const y = H(x, z) + 0.35;
          const rot = rnd(nStones, 314) * Math.PI;
          const R = ring(toL6(x, y, z), r * 1.25, 6, rot, r, 0.2, nStones * 3);
          const c = toL6(x, y + 0.35, z);
          const lit = nStones % 5 === 2;
          fan(fl, R, c, () => [P.stoneSide, P.stoneSide, P.stoneTop], lit ? () => [[0, 0, 0, 0], [0, 0, 0, 0], glow(TEAL, 0.55)] : null, toL6(x, y - 2, z));
          const Rl = R.map((q) => V3(q.x, q.y - 1.1, q.z));
          band(fl, R, Rl, () => P.stoneKeel, null, toL6(x, y - 0.5, z));
          nStones++;
        }
      }
      stats.floorRoots = nRoots;
      stats.floorStones = nStones;
      const floorMesh = addMesh(setA6, fl, "ForestFloorSet");
      floorMesh.layers.set(NO_REFLECT_LAYER);
      floorNear.push(floorMesh);

      // Glow pools: additive discs draped on the ground (a centre and two
      // rings following the terrain), the centre lit, the rim black so it
      // adds nothing. A MeshBasicMaterial with additive blending: the lamp
      // halos' reason (light, not paint) without a point sprite, because a
      // pool lies flat on the ground. No fog on it: it lives only inside the
      // forest (Set_a6 is culled from the south), close to the camera.
      pools.push([A6.x, A6.z, 150, 0, 1.1], [A6.x + 40, A6.z - 30, 90, 1, 0.8]);
      // And along the walk: patches of light either side of the trail, so the
      // lanes the camera looks down are lit floor, not an empty dark strip.
      for (let i = 0; i < forestPath.length - 1; i++) {
        const [ax, az] = forestPath[i];
        const [bx, bz] = forestPath[i + 1];
        const segL = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / segL;
        const uz = (bz - az) / segL;
        for (let d = 20, n = 0; d < segL; d += 60 + rnd(i * 13 + n, 321) * 36, n++) {
          const side = (n % 2 ? 1 : -1) * (18 + rnd(i * 13 + n, 322) * 40);
          const x = ax + ux * d - uz * side;
          const z = az + uz * d + ux * side;
          if (Math.hypot(x - Fo.x, z - Fo.z) > Fo.r) continue;
          pools.push([x, z, 26 + rnd(i * 13 + n, 323) * 22, rnd(i * 13 + n, 324) < 0.65 ? 0 : 1, 0.5 + rnd(i * 13 + n, 325) * 0.3]);
        }
      }
      const pp: number[] = [];
      const pc: number[] = [];
      // Soft: at the crossing the camera sees these at a grazing angle, where
      // overlapping discs stack into bright bands (pass 3 first cut, r5-k45.5).
      const TEALP = [0.055, 0.2, 0.185];
      const VIOLP = [0.15, 0.085, 0.23];
      for (const [x, z, r, hue, k] of pools) {
        const col = hue ? VIOLP : TEALP;
        const sides = 12;
        const ringAt = (f: number) => {
          const out: [number, number, number][] = [];
          for (let i = 0; i < sides; i++) {
            const a = (i / sides) * Math.PI * 2;
            const px = x + Math.cos(a) * r * f * (1 + 0.12 * Math.sin(a * 3 + x));
            const pz = z + Math.sin(a) * r * f;
            const q = toL6(px, H(px, pz) + 1.2, pz);
            out.push([q.x, q.y, q.z]);
          }
          return out;
        };
        const c0 = toL6(x, H(x, z) + 1.2, z);
        // Three rings so the disc follows the ground (two cut through banks
        // and the terrain sliced them into hard edged wedges); a pool on a
        // steep bank is dimmer, since there it faces the camera edge on.
        const slope = Math.abs(H(x + 8, z) - H(x - 8, z)) / 16 + Math.abs(H(x, z + 8) - H(x, z - 8)) / 16;
        const kk = k * (slope > 0.35 ? 0.45 : slope > 0.2 ? 0.7 : 1);
        const rings = [ringAt(0.34), ringAt(0.67), ringAt(1)];
        const lv = [kk * 0.8, kk * 0.4, 0];
        const push = (p: readonly number[], s: number) => {
          pp.push(p[0], p[1], p[2]);
          pc.push(col[0] * s, col[1] * s, col[2] * s);
        };
        for (let i = 0; i < sides; i++) {
          const j = (i + 1) % sides;
          push([c0.x, c0.y, c0.z], kk);
          push(rings[0][i], lv[0]);
          push(rings[0][j], lv[0]);
          for (let r = 0; r < 2; r++) {
            push(rings[r][i], lv[r]);
            push(rings[r + 1][i], lv[r + 1]);
            push(rings[r + 1][j], lv[r + 1]);
            push(rings[r][i], lv[r]);
            push(rings[r + 1][j], lv[r + 1]);
            push(rings[r][j], lv[r]);
          }
        }
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.Float32BufferAttribute(pp, 3));
      pg.setAttribute("color", new THREE.Float32BufferAttribute(pc, 3));
      pg.computeBoundingSphere();
      track(pg);
      const poolMat = track(new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, side: THREE.DoubleSide }));
      poolMat.name = "V5ForestPools";
      poolMat.userData.lightGlow = "magic";
      const poolMesh = new THREE.Mesh(pg, poolMat);
      poolMesh.name = "ForestGlowPools";
      poolMesh.renderOrder = 2;
      poolMesh.layers.set(NO_REFLECT_LAYER);
      setA6.add(poolMesh);
      floorNear.push(poolMesh);
      stats.floorPools = pools.length;
      stats["tris:ForestGlowPools"] = pp.length / 9;
    }
  }

  // ── The rise: carved steps on blocks' animated InstancedMesh ──
  const steps = scene.getObjectByName("FloatingSteps") as THREE.InstancedMesh | undefined;
  if (steps && (steps as THREE.InstancedMesh).isInstancedMesh) {
    const oldGeo = steps.geometry;
    const oldMat = steps.material;
    const soup = carvedStep();
    steps.geometry = track(soup.geometry());
    steps.material = mat;
    stats["tris:step"] = soup.tris;
    replaced.push("FloatingSteps.geometry+material");
    restores.push(() => {
      steps.geometry = oldGeo;
      steps.material = oldMat;
    });
  }

  // ── Frame loop ──
  const light = () => (scene.userData.light as { state?: { magicGlow: number; lampGlow: number } } | undefined)?.state;
  const camPos = V3();
  const lastPos = V3(1e9, 0, 0);
  const lastQuat = new THREE.Quaternion();
  const frustum = new THREE.Frustum();
  const pm = new THREE.Matrix4();
  const sph = new THREE.Sphere();
  const isShown = (o: THREE.Object3D | null | undefined) => {
    for (let p: THREE.Object3D | null | undefined = o; p; p = p.parent) if (!p.visible) return false;
    return !!o;
  };
  const drawSize = new THREE.Vector2();
  let lastTrisLog = 0;
  const compact = () => {
    if (!giantFarMesh || !setA6) return;
    const nearForest = Math.hypot(camPos.x - WORLD.forest.x, camPos.z - WORLD.forest.z) < WORLD.forest.r + 520;
    if (nearForest !== floorShown) {
      floorShown = nearForest;
      for (const o of floorNear) o.visible = nearForest;
    }
    const cam = ctx.camera;
    pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    const reflecting = Math.hypot(camPos.x - L.x, camPos.z - L.z) < 3200;
    const far = cam.far;
    const cnt = [
      [0, 0],
      [0, 0],
    ];
    let cFar = 0;
    const arr = giantMeshes.map((row) => row.map((m) => m.instanceMatrix.array as Float32Array));
    const farArr = giantFarMesh.instanceMatrix.array as Float32Array;
    let tris = 0;
    for (const t of giants) {
      const d = Math.hypot(t.cx - camPos.x, t.cy - camPos.y, t.cz - camPos.z);
      if (d - t.r > far) continue;
      sph.center.set(t.cx, t.cy, t.cz);
      sph.radius = t.r;
      let vis = frustum.intersectsSphere(sph);
      if (!vis && reflecting) {
        sph.center.y = 2 * L.y - t.cy;
        vis = frustum.intersectsSphere(sph);
      }
      if (!vis) continue;
      if (d < GIANT_L1) {
        arr[t.sp][0].set(t.m, cnt[t.sp][0] * 16);
        cnt[t.sp][0]++;
      } else if (d < GIANT_L2) {
        arr[t.sp][1].set(t.m, cnt[t.sp][1] * 16);
        cnt[t.sp][1]++;
      } else {
        farArr.set(t.m, cFar * 16);
        cFar++;
      }
    }
    for (let s = 0; s < 2; s++)
      for (let l = 0; l < 2; l++) {
        const m = giantMeshes[s][l];
        m.count = cnt[s][l];
        m.visible = m.count > 0;
        m.instanceMatrix.needsUpdate = true;
        tris += m.count * ((m.geometry.getAttribute("position").count / 3) | 0);
      }
    giantFarMesh.count = cFar;
    giantFarMesh.visible = cFar > 0;
    giantFarMesh.instanceMatrix.needsUpdate = true;
    tris += cFar * ((giantFarMesh.geometry.getAttribute("position").count / 3) | 0);
    lastTrisLog = tris;
  };

  const rowboatWorld = V3(rowboatBase.x + A5.x, rowboatBase.y + A5.y, rowboatBase.z + A5.z);
  let first = true;
  const reduced = ctx.reducedMotion;
  stats.version = "lf-4";
  stats.buildMs = Math.round(performance.now() - t0);
  stats.replaced = replaced.join(", ");

  return {
    name: "dress-lakeforest",
    update(time: number): boolean {
      const t = reduced ? 0 : time;
      u.uTime.value = t;
      const st = light();
      if (st) {
        u.uMagic.value = Math.min(st.magicGlow, 0.95);
        u.uLamp.value = st.lampGlow;
      }
      ctx.renderer.getDrawingBufferSize(drawSize);
      pxScale.value = drawSize.y / (2 * Math.tan((ctx.camera.fov * DEG) / 2));
      const cam = ctx.camera;
      cam.getWorldPosition(camPos);
      const moved = first || camPos.distanceToSquared(lastPos) > 1e-4 || Math.abs(cam.quaternion.dot(lastQuat)) < 0.9999999;
      let changed = false;
      if (moved && isShown(setA6)) {
        compact();
        changed = true;
      }
      if (moved) {
        lastPos.copy(camPos);
        lastQuat.copy(cam.quaternion);
        first = false;
      }
      let animating = false;
      // The rowboat bobs while the lake is near.
      if (rowboatMesh && isShown(setA5) && camPos.distanceTo(rowboatWorld) < 1400 && !reduced) {
        rowboatMesh.position.y = rowboatBase.y + Math.sin(t * 0.9) * BOB_AMP;
        rowboatMesh.rotation.x = Math.sin(t * 0.7 + 1) * 0.025;
        rowboatMesh.rotation.z = Math.sin(t * 0.55) * 0.015;
        animating = true;
      }
      // The forest glows and the spores rise while it is near.
      if (!reduced && isShown(setA6) && Math.hypot(camPos.x - WORLD.forest.x, camPos.z - WORLD.forest.z) < WORLD.forest.r + 900) animating = true;
      if (sporePts) sporePts.visible = Math.hypot(camPos.x - A6.x, camPos.z - A6.z) < 1700;
      return changed || animating;
    },
    isAnimating: () => false,
    dispose() {
      for (const r of restores) r();
      for (const d of disposables) d.dispose();
    },
    stats() {
      return { ...stats, giantTrisInView: lastTrisLog };
    },
  };
};
