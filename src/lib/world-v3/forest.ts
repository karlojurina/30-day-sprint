/**
 * V3's woods, rocks and cottages.
 *
 * WHAT IT REPLACES. The glb's 1,100 kit trees (T*), 420 rocks (R*) and 5
 * houses (House4000*) are removed. V2's judge found the kit trees read as
 * mixed clutter peppered evenly (broadleaf cutouts, dead snags, pines at random
 * scales) and the rocks as purple crystal debris. Astra's frame, the one Lovro
 * rates ~8/10, has ONE stylised conifer family placed by density, and so do
 * Firewatch's hillsides.
 *
 * THE TREES. One family, generated here:
 *   - conifer3: a short trunk and 3 stacked tiers, 62 triangles. The two lower
 *     tiers have a mid ring pulled in, so each tier flares at its skirt, and a
 *     zig-zag skirt edge, so the silhouette is crisp and spiky;
 *   - conifer2: the same with 2 tiers, 38 triangles;
 *   - broadleaf: two round lobes on a trunk, 46 triangles, lowland only.
 * Geometry is normalised to height 1; the instance matrix scales it to a
 * 13-22 unit tree (the bridge is 95 long, the watchtower 50 tall, which is
 * the tree-to-landmark proportion Astra's frame has). Vertex colours carry a
 * vertical gradient over the WHOLE tree (dark base, warm olive tips) and a
 * darker skirt under each tier; instanceColor picks one of 3 shade variants.
 *
 * THE PLACEMENT. A jittered grid of candidates, each kept with a probability
 * from a density mask: clumped by low-frequency noise (real woods and real
 * meadows), densest on mid slopes, thinning with altitude to a treeline at
 * 180-280, and zero in clearings around every landmark, the path, the river,
 * the lake, the pond, the cottages and the shore. The mask is then scaled so
 * the count lands on TREE_TARGET.
 *
 * DRAW CALLS. Instances are split into SLABS_X x SLABS_Z slabs so frustum
 * culling drops what is behind or beside the camera: at most 2 conifer meshes
 * per slab plus broadleaf where it grows, 1 rock mesh, 1 cottage mesh.
 *
 * THE SHADER. MeshLambertMaterial (so the scene's lights and fog apply) with
 * two additions: a wind sway in the vertex shader that only moves trees within
 * SWAY_RADIUS of the camera, and a warm rim on edges that face the low sun,
 * strongest at the tips. scene.ts's patchFog() assigns onBeforeCompile on
 * every fog material; the hooks here are installed through a property that
 * CHAINS whatever is assigned later, so neither hook is lost whatever order
 * the scene runs in.
 *
 * COTTAGES. 5 around the windmill (a2) and 1 by the lighthouse (a1), on the
 * flattest ground found on a ring around each, clear of the path, the river,
 * the landmark and each other. Each is seated at its highest footprint corner
 * with its walls run down past the lowest, so nothing floats. Each also gets
 * a box named Cottage_* whose material is invisible (shown, never drawn), so
 * the park solver's occluder index (scene.ts indexWater, /^(House|Cottage)/i)
 * sees the new houses and not the old.
 */
import * as THREE from "three";
import type { InstallFn, LandmarkBase, WorldCtx, WorldModule } from "./modules";

// ── Tunables ────────────────────────────────────────────────────────────────

/** Trees placed in total (conifers + broadleaf). ~7,800 x ~52 triangles = ~405k. */
const TREE_TARGET = 7800;
/** Jittered-grid cell. At full density crowns (10-13 across) just touch. */
const CELL = 11;
/** Mean conifer height, world units, and the +/- fraction around it. */
const TREE_H = 17;
const TREE_H_VAR = 0.25;
/** Maximum lean from vertical, radians (~4 degrees). */
const LEAN_MAX = 0.07;
/** Share of conifers that are the 2-tier form. */
const TWO_TIER_SHARE = 0.35;

const LANDMARK_CLEAR = 70;
const LANDMARK_FADE = 28;
/**
 * The long landmarks clear around their deck, not just their centre. Offsets
 * from the base scene.ts passes (the glb box centre): the bridge deck is 95
 * long on x, the viaduct 142 on x, the jetty 49 on z.
 */
const LANDMARK_SPAN: Record<string, { ax: "x" | "z"; from: number; to: number }> = {
  LM_Bridge: { ax: "x", from: -55, to: 55 },
  LM_Viaduct: { ax: "x", from: -78, to: 78 },
  LM_Jetty: { ax: "z", from: -32, to: 32 },
};
/** Lateral distance from the path where density starts to ease, where it bottoms out, and the floor. */
const CORRIDOR_0 = 300;
const CORRIDOR_1 = 680;
const CORRIDOR_FLOOR = 0.4;
const PATH_CLEAR = 18;
const PATH_FADE = 14;
const HOUSE_CLEAR = 24;
/** Shore: no trees below this height, full density above SHORE_FULL. */
const SHORE_H = 3;
const SHORE_FULL = 8;
/** Altitude thinning and the treeline. */
const THIN_FROM = 70;
const THIN_TO = 190;
const TREELINE_0 = 180;
const TREELINE_1 = 280;

/** Water from ridge.py (LAKE/POND centre, radii, surface height), used if the glb objects are gone. */
const LAKE = { x: 80.6, z: -230, rx: 117.8, rz: 105.4, y: 34 };
const POND = { x: -62, z: -660, rx: 51, rz: 51, y: 82 };
/**
 * River half-width in world units: the CARVED channel (ridge.py: 0.16 of the
 * half-width, 0.075 in the gorge). Trees clear from 0.55 of it.
 */
const riverHalfAt = (z: number) => {
  const t = (1000 - z) / 2000;
  return t > 0.445 && t < 0.56 ? 23 : 50;
};
/** Where the bank starts: surfaces.ts draws the water 13 units each side (7 in the gorge) plus a 12-unit skirt. */
const riverBankAt = (z: number) => (riverHalfAt(z) < 30 ? 7 : 13) + 12 + 4;

const SLABS_X = 3;
const SLABS_Z = 4;
const MIN_X = -868;
const MAX_X = 868;
const MIN_Z = -1000;
const MAX_Z = 1000;

/** Trees farther than this from the camera do not sway; full sway inside SWAY_FULL. */
const SWAY_RADIUS = 260;
const SWAY_FULL = 150;
/** Sway at the tip of a normalised tree (local units, times its height). */
const SWAY_AMP = 0.022;
/** Sway visible on screen when a tip moves more than this many pixels. */
const SWAY_MIN_PX = 0.5;

const ROCK_TARGET = 120;

// ── Small deterministic helpers ─────────────────────────────────────────────

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

/** Three octaves, roughly 0..1 with most mass in 0.3..0.7. */
function fbm(x: number, z: number, seed: number): number {
  return 0.6 * vnoise(x, z, seed) + 0.28 * vnoise(x * 2.07, z * 2.07, seed + 7) + 0.12 * vnoise(x * 4.3, z * 4.3, seed + 13);
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));

// ── Geometry builders ───────────────────────────────────────────────────────

/** Non-indexed triangle soup with per-vertex position, normal and colour. */
class Soup {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  vert(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
  }
  /** A flat-shaded triangle (normal from the winding, counter-clockwise = front). */
  flat(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, col: THREE.Color | [THREE.Color, THREE.Color, THREE.Color]) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const [ca, cb, cc] = Array.isArray(col) ? col : [col, col, col];
    this.vert(a, n, ca);
    this.vert(b, n, cb);
    this.vert(c, n, cc);
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, col: THREE.Color) {
    this.flat(a, b, c, col);
    this.flat(a, c, d, col);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
  get triangles() {
    return this.pos.length / 9;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** sRGB hex to the linear colour three expects in vertex colours. */
const C = (hex: string) => new THREE.Color(hex);

/** The whole-tree gradient: dark teal-green base, deep green middle, warm olive tips. */
const CON_BASE = C("#27362d");
const CON_MID = C("#3a5033");
const CON_TIP = C("#80853f");
const TRUNK = C("#2e2119");

function coniferGradient(y: number): THREE.Color {
  return y < 0.5
    ? CON_BASE.clone().lerp(CON_MID, smooth(0, 0.5, y))
    : CON_MID.clone().lerp(CON_TIP, smooth(0.5, 1.05, y));
}

/** A thin open trunk, 3 sides, from the ground to `top`. */
function addTrunk(s: Soup, r: number, top: number, col: THREE.Color) {
  const n = 3;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p00 = V(Math.cos(a0) * r, -0.02, Math.sin(a0) * r);
    const p10 = V(Math.cos(a1) * r, -0.02, Math.sin(a1) * r);
    const p01 = V(Math.cos(a0) * r * 0.7, top, Math.sin(a0) * r * 0.7);
    const p11 = V(Math.cos(a1) * r * 0.7, top, Math.sin(a1) * r * 0.7);
    // Wound so the outside faces out.
    s.quad(p00, p01, p11, p10, col);
  }
}

interface Tier {
  y0: number;
  y1: number;
  r: number;
  /** Pull the lower third inward for a flared skirt. */
  ring: boolean;
}

/**
 * One tier: a skirt of `n` points alternating long and short (zig-zag), an
 * optional mid ring pulled in so the profile is concave, and an apex. Smooth
 * normals around the cone, each tilted up by the cone's own slope.
 */
function addTier(s: Soup, t: Tier, n: number, phase: number) {
  const h = t.y1 - t.y0;
  const ringY = t.y0 + h * 0.34;
  const ringR = t.r * 0.52;
  const skirt: THREE.Vector3[] = [];
  const skirtN: THREE.Vector3[] = [];
  const mid: THREE.Vector3[] = [];
  const midN: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const long = i % 2 === 0;
    const r = long ? t.r : t.r * 0.8;
    const y = long ? t.y0 - 0.018 : t.y0 + 0.022;
    skirt.push(V(Math.cos(a) * r, y, Math.sin(a) * r));
    // The skirt flares, so its normal is more horizontal than the cone's.
    skirtN.push(V(Math.cos(a), 0.55, Math.sin(a)).normalize());
    mid.push(V(Math.cos(a) * ringR, ringY, Math.sin(a) * ringR));
    midN.push(V(Math.cos(a), ringR / (t.y1 - ringY) + 0.25, Math.sin(a)).normalize());
  }
  const ySkirt = coniferGradient(t.y0).multiplyScalar(0.78);
  const yMid = coniferGradient(ringY);
  const yTip = coniferGradient(t.y1).multiplyScalar(1.1);
  const apex = V(0, t.y1, 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const aMid = phase + ((i + 0.5) / n) * Math.PI * 2;
    const apexN = V(Math.cos(aMid), 0.9, Math.sin(aMid)).normalize();
    if (t.ring) {
      // skirt[i] -> skirt[j] -> mid[j] -> mid[i], counter-clockwise seen from outside.
      s.vert(skirt[i], skirtN[i], ySkirt);
      s.vert(mid[j], midN[j], yMid);
      s.vert(skirt[j], skirtN[j], ySkirt);
      s.vert(skirt[i], skirtN[i], ySkirt);
      s.vert(mid[i], midN[i], yMid);
      s.vert(mid[j], midN[j], yMid);
      s.vert(mid[i], midN[i], yMid);
      s.vert(apex, apexN, yTip);
      s.vert(mid[j], midN[j], yMid);
    } else {
      s.vert(skirt[i], skirtN[i], ySkirt);
      s.vert(apex, apexN, yTip);
      s.vert(skirt[j], skirtN[j], ySkirt);
    }
  }
}

function coniferGeometry(tiers: Tier[]): { geometry: THREE.BufferGeometry; triangles: number } {
  const s = new Soup();
  addTrunk(s, 0.045, tiers[0].y0 + 0.06, TRUNK);
  tiers.forEach((t, i) => addTier(s, t, 8, i * 0.4));
  return { geometry: s.geometry(), triangles: s.triangles };
}

const CONIFER3: Tier[] = [
  { y0: 0.13, y1: 0.6, r: 0.37, ring: true },
  { y0: 0.36, y1: 0.82, r: 0.29, ring: true },
  { y0: 0.6, y1: 1.0, r: 0.19, ring: false },
];
const CONIFER2: Tier[] = [
  { y0: 0.13, y1: 0.68, r: 0.36, ring: true },
  { y0: 0.46, y1: 1.0, r: 0.25, ring: false },
];

/** A round-crowned tree: two icosahedron lobes, spherical normals from each lobe's centre. */
function broadleafGeometry(): { geometry: THREE.BufferGeometry; triangles: number } {
  const s = new Soup();
  addTrunk(s, 0.05, 0.4, TRUNK);
  const base = C("#34401f");
  const top = C("#8a8a44");
  const lobes = [
    { c: V(0, 0.56, 0), r: 0.36, sy: 0.9 },
    { c: V(0.12, 0.78, -0.06), r: 0.24, sy: 0.95 },
  ];
  // PolyhedronGeometry is already non-indexed: 20 separate triangles.
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const p = ico.getAttribute("position");
  for (const l of lobes) {
    for (let i = 0; i < p.count; i++) {
      const d = V(p.getX(i), p.getY(i), p.getZ(i));
      const v = V(l.c.x + d.x * l.r, l.c.y + d.y * l.r * l.sy, l.c.z + d.z * l.r);
      const shade = base.clone().lerp(top, smooth(0.25, 0.98, v.y) * (0.75 + 0.25 * (d.y * 0.5 + 0.5)));
      s.vert(v, d.clone().normalize(), shade);
    }
  }
  ico.dispose();
  return { geometry: s.geometry(), triangles: s.triangles };
}

/** A low faceted boulder, flat-shaded, lighter on top. */
function rockGeometry(rand: () => number): { geometry: THREE.BufferGeometry; triangles: number } {
  const ico = new THREE.IcosahedronGeometry(1, 0);
  // Jitter the 12 shared corners once, so the faces stay closed.
  const p = ico.getAttribute("position");
  const corners = new Map<string, THREE.Vector3>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!corners.has(k)) corners.set(k, V(0.82 + rand() * 0.36, 0.82 + rand() * 0.36, 0.82 + rand() * 0.36));
    const j = corners.get(k)!;
    p.setXYZ(i, p.getX(i) * j.x, p.getY(i) * j.y * 0.62, p.getZ(i) * j.z);
  }
  const soup = new Soup();
  const top = C("#a39888");
  const low = C("#5b534b");
  const nonIdx = ico.index ? ico.toNonIndexed() : ico;
  const q = nonIdx.getAttribute("position");
  for (let i = 0; i < q.count; i += 3) {
    const a = V(q.getX(i), q.getY(i), q.getZ(i));
    const b = V(q.getX(i + 1), q.getY(i + 1), q.getZ(i + 1));
    const c = V(q.getX(i + 2), q.getY(i + 2), q.getZ(i + 2));
    const k = (y: number) => low.clone().lerp(top, smooth(-0.5, 0.55, y));
    soup.flat(a, b, c, [k(a.y), k(b.y), k(c.y)]);
  }
  ico.dispose();
  if (nonIdx !== ico) nonIdx.dispose();
  return { geometry: soup.geometry(), triangles: soup.triangles };
}

interface Cottage {
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
  wallH: number;
  roofH: number;
}

const WALL = C("#e6d9c4");
const WALL_SHADE = C("#cdbba3");
const ROOF = C("#b0543a");
const ROOF_DARK = C("#8a3f2c");
const CHIMNEY = C("#8f7b6a");
const DOOR = C("#4a3326");
const WINDOW = C("#3b3431");

/** Adds one cottage in world space: walls down to `base`, gable roof, chimney, door, windows. */
function addCottage(s: Soup, h: Cottage, floorY: number, baseY: number) {
  const m = new THREE.Matrix4().makeRotationY(h.yaw).setPosition(h.x, floorY, h.z);
  const P = (x: number, y: number, z: number) => V(x, y, z).applyMatrix4(m);
  const hw = h.w / 2;
  const hd = h.d / 2;
  const y0 = baseY - floorY - 0.6;
  const yw = h.wallH;
  const yr = h.wallH + h.roofH;
  const oh = 1.1;
  // Walls (front +z, back -z, sides +-x), outward normals.
  s.quad(P(-hw, y0, hd), P(hw, y0, hd), P(hw, yw, hd), P(-hw, yw, hd), WALL);
  s.quad(P(hw, y0, -hd), P(-hw, y0, -hd), P(-hw, yw, -hd), P(hw, yw, -hd), WALL_SHADE);
  s.quad(P(hw, y0, hd), P(hw, y0, -hd), P(hw, yw, -hd), P(hw, yw, hd), WALL);
  s.quad(P(-hw, y0, -hd), P(-hw, y0, hd), P(-hw, yw, hd), P(-hw, yw, -hd), WALL_SHADE);
  // Gable ends under the ridge (ridge runs along x).
  s.flat(P(hw, yw, hd), P(hw, yw, -hd), P(hw, yr, 0), WALL);
  s.flat(P(-hw, yw, -hd), P(-hw, yw, hd), P(-hw, yr, 0), WALL_SHADE);
  // Roof, overhanging on every side.
  const ex = hw + oh;
  const ez = hd + oh;
  const eaveY = yw - oh * (h.roofH / hd);
  s.quad(P(-ex, eaveY, ez), P(ex, eaveY, ez), P(ex, yr, 0), P(-ex, yr, 0), ROOF);
  s.quad(P(ex, eaveY, -ez), P(-ex, eaveY, -ez), P(-ex, yr, 0), P(ex, yr, 0), ROOF_DARK);
  // Chimney through the back slope. life.ts (findChimney) puts the smoke at
  // (0.45 * w/2, box height + 2.2, -0.35 * d/2) in each Cottage_i box's frame:
  // change these three numbers and that formula together.
  const cx = hw * 0.45;
  const cz = -hd * 0.35;
  const cs = 0.9;
  const cy0 = yw + h.roofH * 0.35;
  const cy1 = yr + 2.2;
  s.quad(P(cx - cs, cy0, cz + cs), P(cx + cs, cy0, cz + cs), P(cx + cs, cy1, cz + cs), P(cx - cs, cy1, cz + cs), CHIMNEY);
  s.quad(P(cx + cs, cy0, cz - cs), P(cx - cs, cy0, cz - cs), P(cx - cs, cy1, cz - cs), P(cx + cs, cy1, cz - cs), CHIMNEY);
  s.quad(P(cx + cs, cy0, cz + cs), P(cx + cs, cy0, cz - cs), P(cx + cs, cy1, cz - cs), P(cx + cs, cy1, cz + cs), CHIMNEY);
  s.quad(P(cx - cs, cy0, cz - cs), P(cx - cs, cy0, cz + cs), P(cx - cs, cy1, cz + cs), P(cx - cs, cy1, cz - cs), CHIMNEY);
  s.quad(P(cx - cs, cy1, cz + cs), P(cx + cs, cy1, cz + cs), P(cx + cs, cy1, cz - cs), P(cx - cs, cy1, cz - cs), DOOR);
  // Door and two windows on the front, a hair off the wall.
  const f = hd + 0.05;
  s.quad(P(-0.9, 0, f), P(0.9, 0, f), P(0.9, 3.4, f), P(-0.9, 3.4, f), DOOR);
  for (const wx of [-hw * 0.58, hw * 0.58]) {
    s.quad(P(wx - 0.9, 3.2, f), P(wx + 0.9, 3.2, f), P(wx + 0.9, 5.0, f), P(wx - 0.9, 5.0, f), WINDOW);
  }
}

// ── The shader additions ────────────────────────────────────────────────────

type Hook = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

interface ForestUniforms {
  uTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSwayR: { value: THREE.Vector2 };
  uSwayAmp: { value: number };
  uRim: { value: number };
}

const VERT_PARS = /* glsl */ `
uniform float uTime;
uniform vec2 uSwayR;
uniform float uSwayAmp;
varying float vFH;
`;

const VERT_SWAY = /* glsl */ `
vFH = position.y;
#if defined( FOREST_SWAY ) && defined( USE_INSTANCING )
{
  vec3 ip = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
  float d = distance( ip, cameraPosition );
  float amp = uSwayAmp * ( 1.0 - smoothstep( uSwayR.x, uSwayR.y, d ) );
  if ( amp > 0.0 ) {
    float ph = fract( sin( dot( ip.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2832;
    float gust = dot( ip.xz, vec2( 0.011, 0.007 ) );
    float w = sin( uTime * 1.6 + ph + gust ) * 0.7 + sin( uTime * 2.7 + ph * 1.7 ) * 0.3;
    float k = max( position.y - 0.1, 0.0 );
    k *= k;
    transformed.x += amp * k * w;
    transformed.z += amp * k * w * 0.55;
  }
}
#endif
`;

const FRAG_PARS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uRim;
varying float vFH;
`;

/**
 * A warm rim where a surface turns away from the camera AND toward the sun,
 * stronger when the camera looks into the sun (the scene is back-lit) and at
 * the tips. Added after lighting, before tone mapping and fog.
 */
const FRAG_RIM = /* glsl */ `
#ifdef FOREST_RIM
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
#endif
#include <opaque_fragment>
`;

function forestHook(u: ForestUniforms): Hook {
  return (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VERT_SWAY);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_PARS)
      .replace("#include <opaque_fragment>", FRAG_RIM);
  };
}

/**
 * Install `mine` so a later `material.onBeforeCompile = other` (scene.ts
 * patchFog) runs AFTER it instead of replacing it. The program cache key
 * carries both, so materials with different chains never share a program.
 */
function chainCompileHook(mat: THREE.Material, key: string, mine: Hook) {
  let extra: Hook | null = null;
  // Re-entrancy guard: a caller that wraps our getter's function and assigns
  // the wrapper back would otherwise recurse (combined -> wrapper -> combined).
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
  mat.customProgramCacheKey = () => `forest-v3|${key}|${extra ? extra.toString() : ""}`;
}

// ── Install ─────────────────────────────────────────────────────────────────

interface TreeRec {
  x: number;
  y: number;
  z: number;
  h: number;
  w: number;
  yaw: number;
  leanAx: number;
  lean: number;
  kind: 0 | 1 | 2; // conifer3, conifer2, broadleaf
  shade: number;
}

export const install: InstallFn = async (ctx: WorldCtx): Promise<WorldModule> => {
  const t0 = performance.now();
  let busy = 0;
  const lap = (from: number) => (busy += performance.now() - from);

  let from = performance.now();
  const removed = removeKitObjects(ctx);
  lap(from);

  // Water, from the glb objects when they are still there, else ridge.py's numbers.
  const water = [readWater(ctx, "Lake", LAKE), readWater(ctx, "Pond", POND)];

  from = performance.now();
  const cottages = placeCottages(ctx, water);
  const rocks = placeRocks(ctx, water, cottages);
  lap(from);
  await yieldTask();

  from = performance.now();
  const trees = placeTrees(ctx, water, cottages);
  lap(from);
  await yieldTask();

  from = performance.now();
  const uniforms: ForestUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: ctx.sunDir.clone().normalize() },
    uSunColor: { value: ctx.sunColor.clone() },
    uSwayR: { value: new THREE.Vector2(SWAY_FULL, SWAY_RADIUS) },
    uSwayAmp: { value: ctx.reducedMotion ? 0 : SWAY_AMP },
    uRim: { value: 0.9 },
  };

  const group = new THREE.Group();
  group.name = "Forest";

  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  treeMat.name = "ForestConifer";
  treeMat.defines = { FOREST_SWAY: "", FOREST_RIM: "" };
  chainCompileHook(treeMat, "tree", forestHook(uniforms));

  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  rockMat.name = "ForestRock";
  rockMat.defines = { FOREST_RIM: "" };
  chainCompileHook(rockMat, "rock", forestHook(uniforms));

  const houseMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  houseMat.name = "ForestCottage";
  houseMat.defines = { FOREST_RIM: "" };
  chainCompileHook(houseMat, "house", forestHook(uniforms));

  const protos = [coniferGeometry(CONIFER3), coniferGeometry(CONIFER2), broadleafGeometry()];
  const rand = mulberry32(99);
  const rockProto = rockGeometry(rand);

  // Shade variants: neutral, cool-dark, warm olive. Multiplied into the vertex gradient.
  const SHADES = [new THREE.Color(1, 1, 1), new THREE.Color(0.78, 0.9, 0.95), new THREE.Color(1.14, 1.06, 0.8)];

  const meshes: THREE.InstancedMesh[] = [];
  const swayMeshes: { mesh: THREE.InstancedMesh; pos: Float32Array; box: THREE.Box3 }[] = [];
  const slabW = (MAX_X - MIN_X) / SLABS_X;
  const slabD = (MAX_Z - MIN_Z) / SLABS_Z;
  const buckets = new Map<string, TreeRec[]>();
  for (const t of trees) {
    const sx = Math.min(SLABS_X - 1, Math.max(0, Math.floor((t.x - MIN_X) / slabW)));
    const sz = Math.min(SLABS_Z - 1, Math.max(0, Math.floor((t.z - MIN_Z) / slabD)));
    // Broadleaf only grows in the lowland strip: one mesh, culled once behind.
    const key = t.kind === 2 ? "2|0|0" : `${t.kind}|${sx}|${sz}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(t);
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qLean = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const p3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const col = new THREE.Color();
  let treeTris = 0;
  const kindCount = [0, 0, 0];
  for (const [key, list] of buckets) {
    const kind = Number(key.split("|")[0]) as 0 | 1 | 2;
    const proto = protos[kind];
    const im = new THREE.InstancedMesh(proto.geometry, treeMat, list.length);
    im.name = `Forest:${["conifer3", "conifer2", "broadleaf"][kind]}:${key}`;
    const pos = new Float32Array(list.length * 3);
    const box = new THREE.Box3();
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      q.setFromAxisAngle(up, t.yaw);
      axis.set(Math.cos(t.leanAx), 0, Math.sin(t.leanAx));
      qLean.setFromAxisAngle(axis, t.lean);
      q.premultiply(qLean);
      p3.set(t.x, t.y, t.z);
      s3.set(t.w * t.h, t.h, t.w * t.h);
      m4.compose(p3, q, s3);
      im.setMatrixAt(i, m4);
      col.copy(SHADES[t.shade]).multiplyScalar(0.92 + 0.16 * hash2(Math.round(t.x), Math.round(t.z), 5));
      im.setColorAt(i, col);
      pos[i * 3] = t.x;
      pos[i * 3 + 1] = t.y + t.h * 0.6;
      pos[i * 3 + 2] = t.z;
      box.expandByPoint(p3);
    }
    box.max.y += TREE_H * 1.3;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.frustumCulled = true;
    group.add(im);
    meshes.push(im);
    swayMeshes.push({ mesh: im, pos, box });
    treeTris += proto.triangles * list.length;
    kindCount[kind] += list.length;
  }

  // Rocks: one instanced mesh.
  const rockMesh = new THREE.InstancedMesh(rockProto.geometry, rockMat, Math.max(1, rocks.length));
  rockMesh.name = "Forest:rocks";
  rockMesh.count = rocks.length;
  for (let i = 0; i < rocks.length; i++) {
    const r = rocks[i];
    q.setFromEuler(new THREE.Euler(r.tilt * 0.5, r.yaw, r.tilt * 0.3));
    p3.set(r.x, r.y, r.z);
    s3.set(r.sx, r.sy, r.sz);
    m4.compose(p3, q, s3);
    rockMesh.setMatrixAt(i, m4);
  }
  rockMesh.instanceMatrix.needsUpdate = true;
  rockMesh.computeBoundingSphere();
  group.add(rockMesh);

  // Cottages: one merged mesh, plus a box per house for the park solver's
  // occluders. scene.ts indexes shown /^(House|Cottage)/i meshes, so each box
  // is a SHOWN object whose material is invisible: indexed, never drawn.
  const houseSoup = new Soup();
  const occluders: THREE.Mesh[] = [];
  const occluderMat = new THREE.MeshBasicMaterial({ visible: false });
  cottages.forEach((c, i) => {
    addCottage(houseSoup, c, c.floorY, c.baseY);
    const tall = c.floorY - c.baseY + c.wallH + c.roofH;
    const g = new THREE.BoxGeometry(c.w, tall, c.d);
    g.translate(0, tall / 2, 0);
    const occ = new THREE.Mesh(g, occluderMat);
    occ.name = `Cottage_${i}`;
    occ.position.set(c.x, c.baseY, c.z);
    occ.rotation.y = c.yaw;
    group.add(occ);
    occluders.push(occ);
  });
  const houseGeo = houseSoup.geometry();
  const houseMesh = new THREE.Mesh(houseGeo, houseMat);
  houseMesh.name = "Forest:cottages";
  group.add(houseMesh);

  ctx.scene.add(group);
  group.updateMatrixWorld(true);
  lap(from);
  const buildMs = performance.now() - t0;

  // ── Wind: is any swaying tip moving at least SWAY_MIN_PX on screen? ────────
  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  const lastCam = new Float32Array(16).fill(NaN);
  let swayVisible = false;
  const camPos = new THREE.Vector3();
  const sphere = new THREE.Sphere();

  const measureSway = () => {
    const cam = ctx.camera;
    const e = cam.matrixWorld.elements;
    let same = cam.projectionMatrix.elements[0] === lastCam[0] && cam.projectionMatrix.elements[5] === lastCam[1];
    for (let i = 0; i < 14 && same; i++) if (e[i + 2] !== lastCam[i + 2]) same = false;
    if (same) return swayVisible;
    lastCam[0] = cam.projectionMatrix.elements[0];
    lastCam[1] = cam.projectionMatrix.elements[5];
    for (let i = 0; i < 14; i++) lastCam[i + 2] = e[i + 2];

    swayVisible = false;
    if (uniforms.uSwayAmp.value <= 0) return false;
    cam.updateMatrixWorld();
    projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    camPos.setFromMatrixPosition(cam.matrixWorld);
    const hPx = ctx.renderer.domElement?.height || 1000;
    const pxPerUnitAt1 = hPx / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    for (const s of swayMeshes) {
      if (!s.mesh.visible) continue;
      if (s.box.distanceToPoint(camPos) > SWAY_RADIUS) continue;
      if (!frustum.intersectsBox(s.box)) continue;
      const p = s.pos;
      for (let i = 0; i < p.length; i += 3) {
        const dx = p[i] - camPos.x;
        const dy = p[i + 1] - camPos.y;
        const dz = p[i + 2] - camPos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= SWAY_RADIUS) continue;
        // Tip travel in world units: amplitude x (0.9^2 of height) x height, faded like the shader.
        const fade = 1 - smooth(SWAY_FULL, SWAY_RADIUS, d);
        const px = (SWAY_AMP * 0.81 * TREE_H * fade * pxPerUnitAt1) / Math.max(d, 1);
        if (px < SWAY_MIN_PX) continue;
        sphere.center.set(p[i], p[i + 1], p[i + 2]);
        sphere.radius = TREE_H * 0.5;
        if (frustum.intersectsSphere(sphere)) {
          swayVisible = true;
          return true;
        }
      }
    }
    return false;
  };

  return {
    name: "forest",
    update(time: number) {
      if (ctx.reducedMotion) return false;
      const on = measureSway();
      if (on) uniforms.uTime.value = time;
      return on;
    },
    isAnimating() {
      return !ctx.reducedMotion && swayVisible;
    },
    dispose() {
      ctx.scene.remove(group);
      for (const p of protos) p.geometry.dispose();
      rockProto.geometry.dispose();
      houseGeo.dispose();
      for (const o of occluders) {
        o.parent?.remove(o);
        o.geometry.dispose();
      }
      occluderMat.dispose();
      for (const m of meshes) m.dispose();
      rockMesh.dispose();
      treeMat.dispose();
      rockMat.dispose();
      houseMat.dispose();
    },
    stats() {
      const rockTris = rockProto.triangles * rocks.length;
      const houseTris = houseSoup.triangles;
      return {
        trees: trees.length,
        conifer3: kindCount[0],
        conifer2: kindCount[1],
        broadleaf: kindCount[2],
        rocks: rocks.length,
        cottages: cottages.length,
        treeTriangles: treeTris,
        rockTriangles: rockTris,
        cottageTriangles: houseTris,
        triangles: treeTris + rockTris + houseTris,
        meshes: meshes.length + 2,
        trisPerConifer3: protos[0].triangles,
        trisPerConifer2: protos[1].triangles,
        trisPerBroadleaf: protos[2].triangles,
        removedKitObjects: removed,
        buildMs: Math.round(buildMs),
        busyMs: Math.round(busy),
      };
    },
  };
};

// ── Removal of the glb kit objects ──────────────────────────────────────────

function removeKitObjects(ctx: WorldCtx): number {
  const doomed: THREE.Object3D[] = [];
  const kit = /^(T\d+|R\d+|House4000)/;
  ctx.root.traverse((o) => {
    if (o !== ctx.root && kit.test(o.name)) doomed.push(o);
  });
  // If the scene instanced the kit before this module ran, its InstancedMeshes
  // sit on the scene under these names.
  for (const o of ctx.scene.children) {
    if (/^(Trees|Rocks):/.test(o.name)) doomed.push(o);
  }
  for (const o of doomed) o.parent?.remove(o);
  return doomed.length;
}

// ── Water ───────────────────────────────────────────────────────────────────

interface Water {
  x: number;
  z: number;
  rx: number;
  rz: number;
  y: number;
}

function readWater(ctx: WorldCtx, name: string, fallback: Water): Water {
  const o = ctx.root.getObjectByName(name);
  if (!o) return fallback;
  const box = new THREE.Box3().setFromObject(o);
  if (box.isEmpty()) return fallback;
  return {
    x: (box.min.x + box.max.x) / 2,
    z: (box.min.z + box.max.z) / 2,
    rx: (box.max.x - box.min.x) / 2,
    rz: (box.max.z - box.min.z) / 2,
    y: box.max.y,
  };
}

/** 0 on the water and a margin around it, rising to 1 outside. */
function waterFactor(x: number, z: number, h: number, water: Water[]): number {
  let f = 1;
  for (const w of water) {
    const e = Math.hypot((x - w.x) / w.rx, (z - w.z) / w.rz);
    if (e > 1.6) continue;
    // Inside the plane's ellipse, or low ground by its shore.
    const shore = smooth(w.y + 1.5, w.y + 6, h);
    f = Math.min(f, Math.max(smooth(1.02, 1.25, e), e < 1.6 ? shore : 1));
  }
  return f;
}

// ── Clearings shared by trees and rocks ─────────────────────────────────────

/** Distance from (x, z) to a landmark's footprint (a point, or a deck segment for the long ones). */
function landmarkDist(name: string, lm: LandmarkBase, x: number, z: number): number {
  const span = LANDMARK_SPAN[name];
  if (!span) return Math.hypot(x - lm.x, z - lm.z);
  if (span.ax === "x") {
    const cx = Math.min(lm.x + span.to, Math.max(lm.x + span.from, x));
    return Math.hypot(x - cx, z - lm.z);
  }
  const cz = Math.min(lm.z + span.to, Math.max(lm.z + span.from, z));
  return Math.hypot(x - lm.x, z - cz);
}

function nearestLandmark(ctx: WorldCtx, x: number, z: number): number {
  let best = Infinity;
  for (const [name, lm] of Object.entries(ctx.landmarks)) {
    if (name === "LM_LighthouseLamp" || name === "LM_WindmillBlades") continue;
    const d = landmarkDist(name, lm, x, z);
    if (d < best) best = d;
  }
  return best;
}

function riverDist(ctx: WorldCtx, x: number, z: number): { d: number; half: number } {
  const rx = ctx.riverXAtZ(z);
  if (!(rx === rx)) return { d: Infinity, half: 50 };
  return { d: Math.abs(x - rx), half: riverHalfAt(z) };
}

function slopeAt(ctx: WorldCtx, x: number, z: number, e = 8): number {
  const gx = (ctx.heightAt(x + e, z) - ctx.heightAt(x - e, z)) / (2 * e);
  const gz = (ctx.heightAt(x, z + e) - ctx.heightAt(x, z - e)) / (2 * e);
  return Math.hypot(gx, gz);
}

// ── Cottages ────────────────────────────────────────────────────────────────

interface PlacedCottage extends Cottage {
  floorY: number;
  baseY: number;
}

function placeCottages(ctx: WorldCtx, water: Water[]): PlacedCottage[] {
  const out: PlacedCottage[] = [];
  const rand = mulberry32(4242);
  const groups: { lm: string; count: number; rMin: number; rMax: number }[] = [
    { lm: "LM_Windmill", count: 5, rMin: 48, rMax: 150 },
    { lm: "LM_Lighthouse", count: 1, rMin: 42, rMax: 95 },
  ];
  for (const g of groups) {
    const lm = ctx.landmarks[g.lm];
    if (!lm) continue;
    interface Cand { x: number; z: number; score: number }
    const cands: Cand[] = [];
    for (let r = g.rMin; r <= g.rMax; r += 8) {
      for (let a = 0; a < 360; a += 7) {
        const x = lm.x + Math.cos((a * Math.PI) / 180) * r;
        const z = lm.z + Math.sin((a * Math.PI) / 180) * r;
        const h = ctx.heightAt(x, z);
        if (h < SHORE_FULL) continue;
        if (Math.abs(x - ctx.pathXAtZ(z)) < 17) continue;
        const rv = riverDist(ctx, x, z);
        if (rv.d < rv.half * 0.75 + 8) continue;
        if (waterFactor(x, z, h, water) < 1) continue;
        if (nearestLandmark(ctx, x, z) < 40) continue;
        const s = slopeAt(ctx, x, z, 7);
        if (s > 0.28) continue;
        // Flat, not too far out, a little randomness so it is not a ring.
        cands.push({ x, z, score: s * 2 + (r - g.rMin) / 400 + rand() * 0.08 });
      }
    }
    const start = out.length;
    for (let n = 0; n < g.count; n++) {
      // The first house takes the best spot; the rest gather round it, so the
      // houses read as a village rather than a line along the ring.
      const first = out[start];
      let c: Cand | null = null;
      let best = Infinity;
      for (const k of cands) {
        if (out.some((o) => Math.hypot(o.x - k.x, o.z - k.z) < 27)) continue;
        const s = k.score + (first ? Math.hypot(first.x - k.x, first.z - k.z) / 160 : 0);
        if (s < best) {
          best = s;
          c = k;
        }
      }
      if (!c) break;
      const w = 12 + rand() * 4;
      const d = 9 + rand() * 2;
      // Face roughly toward the landmark, so the village gathers round it.
      const yaw = Math.atan2(lm.x - c.x, lm.z - c.z) + (rand() - 0.5) * 0.6;
      const m = new THREE.Matrix4().makeRotationY(yaw);
      let hMin = Infinity;
      let hMax = -Infinity;
      for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
        const v = new THREE.Vector3((cx * w) / 2, 0, (cz * d) / 2).applyMatrix4(m);
        const hh = ctx.heightAt(c.x + v.x, c.z + v.z);
        hMin = Math.min(hMin, hh);
        hMax = Math.max(hMax, hh);
      }
      out.push({
        x: c.x,
        z: c.z,
        yaw,
        w,
        d,
        wallH: 7 + rand() * 1.5,
        roofH: 5 + rand() * 1.2,
        floorY: hMax + 0.3,
        baseY: hMin,
      });
    }
  }
  return out;
}

// ── Rocks ───────────────────────────────────────────────────────────────────

interface RockRec {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  tilt: number;
}

function placeRocks(ctx: WorldCtx, water: Water[], cottages: PlacedCottage[]): RockRec[] {
  const rand = mulberry32(777);
  interface Cand { x: number; z: number; score: number }
  const cands: Cand[] = [];
  const step = 16;
  // Every rock, seed or cluster member, passes the same test: dry land, off
  // the path, out of the river's water and skirt, clear of landmarks and houses.
  const allowed = (x: number, z: number, h: number, pad: number) => {
    if (h < SHORE_H + 1 || h > TREELINE_1 + 40) return false;
    if (Math.abs(x - ctx.pathXAtZ(z)) < 10 + pad) return false;
    const rv = riverDist(ctx, x, z);
    if (rv.d < riverBankAt(z) + pad) return false;
    if (nearestLandmark(ctx, x, z) < 45) return false;
    if (waterFactor(x, z, h, water) < 0.9) return false;
    return !cottages.some((c) => Math.hypot(c.x - x, c.z - z) < 22);
  };
  for (let z = MAX_Z - 40; z > MIN_Z + 20; z -= step) {
    for (let x = -560; x <= 560; x += step) {
      const jx = x + (rand() - 0.5) * step;
      const jz = z + (rand() - 0.5) * step;
      const h = ctx.heightAt(jx, jz);
      if (!allowed(jx, jz, h, 4)) continue;
      const e = 14;
      const lapl =
        (ctx.heightAt(jx + e, jz) + ctx.heightAt(jx - e, jz) + ctx.heightAt(jx, jz + e) + ctx.heightAt(jx, jz - e) - 4 * h) / (e * e);
      const s = slopeAt(ctx, jx, jz);
      // Slope break: the ground bends sharply while it is still walkable.
      let score = Math.min(1, Math.abs(lapl) * 25) * smooth(0.12, 0.35, s) * (1 - smooth(1.0, 1.5, s));
      // River bank: just outside the water's edge.
      const rv = riverDist(ctx, jx, jz);
      if (rv.d < Infinity) {
        const edge = riverBankAt(jz) + 5;
        score = Math.max(score, 0.9 * (1 - smooth(3, 12, Math.abs(rv.d - edge))) * (rv.d > edge - 4 ? 1 : 0));
      }
      if (score > 0.15) cands.push({ x: jx, z: jz, score: score * (0.6 + 0.4 * rand()) });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const seeds: Cand[] = [];
  for (const c of cands) {
    if (seeds.length >= 56) break;
    if (seeds.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 42)) continue;
    seeds.push(c);
  }
  const out: RockRec[] = [];
  for (const s of seeds) {
    const n = 1 + Math.floor(rand() * 3.6);
    for (let k = 0; k < n && out.length < ROCK_TARGET; k++) {
      const a = rand() * Math.PI * 2;
      const r = k === 0 ? 0 : 5 + rand() * 9;
      const x = s.x + Math.cos(a) * r;
      const z = s.z + Math.sin(a) * r;
      const size = (k === 0 ? 5.5 : 2.5) + rand() * (k === 0 ? 4 : 3);
      if (k > 0 && !allowed(x, z, ctx.heightAt(x, z), size * 0.5)) continue;
      const sy = size * (0.55 + rand() * 0.35);
      const h = Math.min(ctx.heightAt(x, z), ctx.heightAt(x + size * 0.5, z), ctx.heightAt(x - size * 0.5, z), ctx.heightAt(x, z + size * 0.5), ctx.heightAt(x, z - size * 0.5));
      // The geometry spans y -0.62..0.62 of its scale; sink 25% of its height.
      const height = 1.24 * sy;
      out.push({
        x,
        y: h + 0.62 * sy - 0.25 * height,
        z,
        sx: size * (0.8 + rand() * 0.4),
        sy,
        sz: size * (0.8 + rand() * 0.4),
        yaw: rand() * Math.PI * 2,
        tilt: (rand() - 0.5) * 0.5,
      });
    }
  }
  return out;
}

// ── Trees ───────────────────────────────────────────────────────────────────

function placeTrees(ctx: WorldCtx, water: Water[], cottages: PlacedCottage[]): TreeRec[] {
  const rand = mulberry32(20260925);
  const nx = Math.floor((MAX_X - MIN_X) / CELL);
  const nz = Math.floor((MAX_Z - MIN_Z) / CELL);
  const cx = new Float32Array(nx * nz);
  const cz = new Float32Array(nx * nz);
  const dens = new Float32Array(nx * nz);
  const hs = new Float32Array(nx * nz);
  const lms = Object.entries(ctx.landmarks).filter(([n]) => n !== "LM_LighthouseLamp" && n !== "LM_WindmillBlades");
  let total = 0;
  for (let k = 0; k < nz; k++) {
    const z0 = MIN_Z + k * CELL;
    const pathX = ctx.pathXAtZ(z0 + CELL / 2);
    for (let i = 0; i < nx; i++) {
      const c = k * nx + i;
      const x = MIN_X + (i + 0.15 + rand() * 0.7) * CELL;
      const z = z0 + (0.15 + rand() * 0.7) * CELL;
      cx[c] = x;
      cz[c] = z;
      const h = ctx.heightAt(x, z);
      hs[c] = h;
      if (h < SHORE_H) continue;
      let d = smooth(SHORE_H, SHORE_FULL, h);
      // Altitude: thin out, then the treeline.
      d *= 1 - 0.45 * smooth(THIN_FROM, THIN_TO, h);
      d *= 1 - smooth(TREELINE_0, TREELINE_1, h + (vnoise(x / 60, z / 60, 3) - 0.5) * 50);
      if (d <= 0) continue;
      // Clearings: path, landmarks, river, water, cottages.
      d *= smooth(PATH_CLEAR, PATH_CLEAR + PATH_FADE, Math.abs(x - pathX));
      if (d <= 0) continue;
      let lmD = Infinity;
      for (const [name, lm] of lms) lmD = Math.min(lmD, landmarkDist(name, lm, x, z));
      d *= smooth(LANDMARK_CLEAR, LANDMARK_CLEAR + LANDMARK_FADE, lmD);
      if (d <= 0) continue;
      const rv = riverDist(ctx, x, z);
      if (rv.d < Infinity) d *= smooth(rv.half * 0.55, rv.half * 0.9, rv.d);
      d *= waterFactor(x, z, h, water);
      for (const ho of cottages) d *= smooth(HOUSE_CLEAR, HOUSE_CLEAR + 12, Math.hypot(ho.x - x, ho.z - z));
      if (d <= 0) continue;
      // Slope: meadows on the flats, dense on mid slopes, thin on cliffs.
      const s = slopeAt(ctx, x, z);
      d *= (0.3 + 0.7 * smooth(0.08, 0.38, s)) * (1 - 0.85 * smooth(1.0, 1.6, s));
      // Clumping: woods and meadows at ~250 units, ragged edges at ~60.
      const woods = smooth(0.4, 0.6, fbm(x / 250, z / 250, 11) + (vnoise(x / 60, z / 60, 17) - 0.5) * 0.18);
      d *= 0.06 + 0.94 * woods;
      // Spend the budget where the rail looks: full within CORRIDOR_0 of the
      // path, easing to CORRIDOR_FLOOR on the far flanks.
      d *= CORRIDOR_FLOOR + (1 - CORRIDOR_FLOOR) * (1 - smooth(CORRIDOR_0, CORRIDOR_1, Math.abs(x - pathX)));
      dens[c] = d;
      total += d;
    }
  }
  // Scale the mask so the expected count is the target (capped at probability 1).
  let scale = TREE_TARGET / Math.max(total, 1e-6);
  for (let iter = 0; iter < 6; iter++) {
    let exp = 0;
    for (let c = 0; c < dens.length; c++) exp += Math.min(1, dens[c] * scale);
    scale *= TREE_TARGET / Math.max(exp, 1e-6);
  }
  const out: TreeRec[] = [];
  for (let c = 0; c < dens.length; c++) {
    if (dens[c] <= 0 || rand() >= dens[c] * scale) continue;
    const x = cx[c];
    const z = cz[c];
    const h = hs[c];
    const hN = smooth(THIN_FROM, TREELINE_1, h);
    // Broadleaf in the lowland near the shore and the village.
    // A few round broadleaf trees, only on the low shore land (a1-a2).
    const broad = h < 42 && z > 250 && rand() < 0.3 * (1 - smooth(18, 42, h));
    const two = !broad && rand() < TWO_TIER_SHARE + 0.3 * hN;
    const kind: 0 | 1 | 2 = broad ? 2 : two ? 1 : 0;
    let height = TREE_H * (1 + (rand() * 2 - 1) * TREE_H_VAR) * (1 - 0.28 * hN);
    if (broad) height *= 0.78;
    const width = (broad ? 1.2 : 1) * (0.78 + rand() * 0.24);
    // Seat on the lowest ground under the crown's middle so the trunk never floats.
    const r = 1.2;
    const ground = Math.min(h, ctx.heightAt(x + r, z), ctx.heightAt(x - r, z), ctx.heightAt(x, z + r), ctx.heightAt(x, z - r));
    // Shade: mostly neutral, cool on shaded high ground, warm olive in the lowland.
    const u = rand();
    const shade = u < 0.5 ? 0 : u < 0.5 + 0.25 + 0.2 * hN ? 1 : 2;
    out.push({
      x,
      y: ground - 0.02 * height,
      z,
      h: height,
      w: width,
      yaw: rand() * Math.PI * 2,
      leanAx: rand() * Math.PI * 2,
      lean: rand() * LEAN_MAX,
      kind,
      shade,
    });
  }
  return out;
}
