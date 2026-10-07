import * as THREE from "three";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { BROOK, GORGE, PATH, PLACES, RIVER, STREAM, WORLD, fallsCurtainAt } from "./layout";
import { terrainHeight } from "./terrain";
import { NO_REFLECT_LAYER, REFLECT_ONLY_LAYER } from "./light";

/**
 * V5 surfaces: how the ground and the water look (world_art_bible.md 1.8,
 * ported from V3's surfaces.ts onto the V5 terrain and rescaled to its size).
 *
 *   Terrain   The scene's grey "Terrain" and "Terrain:falls" meshes keep their
 *             geometry; their material becomes a painted Lambert. Colour comes
 *             from the place (a grass and a rock colour per vertex, blended by
 *             zone: olive coast, green valley, wet gorge, dry collar and saddle,
 *             golden lake basin, dark forest floor), then per pixel from slope
 *             and height (Carlson's plane values: flat 1.0, slope 0.86, cliff
 *             0.72), rock strata tilted per place, moss on wet ledges, sand at
 *             the sea, damp banks along the water, the trail as a worn ribbon,
 *             brush noise at 1/40 and 1/300 that fades before it aliases, and a
 *             crease, hollow and horizon AO baked into the vertices at load.
 *   Mask      One 1024x1024 RGBA texture over WORLD: R = distance to the trail,
 *             G = distance to the edge of the river, stream and brook, B = worn
 *             ground (camps, pads, the jetty foot), A = forest floor (a default
 *             guess until forest.ts hands its density in, see the contract).
 *   Water     Sea (new, one quad, long swell, a beach foam line that washes in
 *             and out), River and Stream (new flowing ribbons down the carved
 *             channels), Brook (a flowing ribbon laid over blocks.ts's grey
 *             one), the plunge pool (blocks' "Pool": churning radial foam), the
 *             Mirror Lake (light.ts's reflector keeps its reflection; this only
 *             adds a dark shallow band and a thin line at the shore).
 *   Falls     blocks.ts's "Landmark_a3_Water" and "IslandFalls" get a curtain
 *             with structure: streaks at three scales falling at free-fall
 *             speed, thin gaps showing the rock, white foam heads that fall,
 *             a bright lip over a glassy tongue, two rock teeth splitting the
 *             top into three unequal falls, a foam band at the foot, ragged
 *             edges; cream on the sun side, blue grey in shade. Seen from the
 *             cave it glows with the day beyond, strands moving across it.
 *             "FallsSpray" gets a softer two-tone mist that thins near the
 *             camera instead of whiting out the dive.
 *
 * blocks.ts installs after this module, so its meshes are adopted on the
 * first frames (update() looks them up by name until it has them). Their
 * uniforms that blocks.ts drives every frame (uTime, uBack, uFade) are shared
 * by reference, so its own clock and its "seen from behind" test keep working.
 *
 * Fog: every material here uses the stock fog chunks (fog_pars_vertex,
 * fog_vertex, fog_fragment) with `mvPosition` and `transformed` defined in
 * the vertex shader, so a fog ramp patched into ShaderChunk (bible 1.4)
 * reaches the water and the falls too.
 *
 * Contract for other modules: scene.userData.surfaces (SurfacesApi below).
 * Draw calls added: Sea, River, Stream, Brook (4, most culled at any stop).
 */

// ── Palette (display sRGB; converted to linear on load) ──────────────────────
// Low saturation on purpose (bible 1.1): colour comes from the light key, the
// fog ramp and the grade. Grass per zone, rock per place.

const PAL = {
  coast: "#687a4f", // a1 olive
  valley: "#5b7148", // a2 green meadow
  moss: "#4a5a3a", // a3 wet ledges
  dry: "#8a855e", // collar, saddle: dry grass
  gold: "#8f865a", // a5 golden grass (the sunset key makes it gold)
  forest: "#303b31", // a6 floor, near black blue green under the dusk key
  far: "#6a7156", // everything else
  rockWarm: "#7a736a", // a1, a2
  rockWet: "#45474a", // a3 gorge
  rockViolet: "#6a6570", // a5 basin
  rockGrey: "#716f6a",
  rockHigh: "#8c8a86",
  sand: "#c3b088",
  wetSand: "#6a6352",
  path: "#ad9d7e",
  pathEdge: "#8b8166",
  verge: "#8c8862",
  bank: "#303a2c",
  worn: "#8e8468",
  forestFloor: "#2c3529",
} as const;

const WATER_C = {
  sea: "#2f4656",
  seaShallow: "#4e6a66",
  river: "#4f6a70",
  foam: "#eee6d6",
  pool: "#243238",
  curtainLit: "#f0e9da",
  curtainShade: "#7d90a2",
  shore: "#2a2a22",
} as const;

const lin = (hex: string) => new THREE.Color(hex);
/** The day beyond the curtain, seen from the cave (the late-afternoon gorge), lifted above 1 to read as light. */
const GLOW_DAY = new THREE.Color("#f2c898").multiplyScalar(1.1);

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Mask texture resolution over WORLD (8.6 x 10.4 units a texel; the trail and
 *  bank channels are distance fields, so bilinear keeps their edges crisp). */
const MASK_RES = 1024;
/** Trail: distances stored up to this many units (R channel, 0.25 unit steps). */
const TRAIL_RANGE = 64;
/** Water edge: distances stored up to this many units (G channel). */
const BANK_RANGE = 128;
/** Crease radii and the height differences that count as fully creased. */
const CREASE_R = 40;
const CREASE_N = 7;
const HOLLOW_R = 150;
const HOLLOW_N = 28;
/** Horizon AO march: distances out from each vertex, 8 directions. */
const AO_STEPS = [45, 90, 160, 260, 400, 600, 850];
/** Ribbon section spacing (units). */
const RIBBON_STEP = 8;

// ── Small helpers ────────────────────────────────────────────────────────────

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));

/** Distance from (x, z) to a polyline of [x, ?, z] points; also the segment and share along it. */
function distPoly(x: number, z: number, pts: ReadonlyArray<ReadonlyArray<number>>, xi = 0, zi = 2): { d: number; i: number; u: number } {
  let best = Infinity;
  let bi = 0;
  let bu = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][xi];
    const az = pts[i][zi];
    const dx = pts[i + 1][xi] - ax;
    const dz = pts[i + 1][zi] - az;
    const L2 = dx * dx + dz * dz || 1;
    const u = clamp01(((x - ax) * dx + (z - az) * dz) / L2);
    const d = Math.hypot(x - ax - dx * u, z - az - dz * u);
    if (d < best) {
      best = d;
      bi = i;
      bu = u;
    }
  }
  return { d: best, i: bi, u: bu };
}

/** A regular height grid read back from a terrain mesh (row-major, x fastest). */
interface Grid {
  minX: number;
  minZ: number;
  sx: number;
  sz: number;
  vx: number;
  vz: number;
  h: Float32Array;
}

function gridFrom(g: THREE.BufferGeometry): Grid | null {
  const pos = g.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos || pos.count < 4) return null;
  const z0 = pos.getZ(0);
  let vx = 0;
  while (vx < pos.count && Math.abs(pos.getZ(vx) - z0) < 1e-3) vx++;
  if (vx < 2 || pos.count % vx !== 0) return null;
  const vz = pos.count / vx;
  const h = new Float32Array(pos.count);
  for (let k = 0; k < pos.count; k++) h[k] = pos.getY(k);
  return { minX: pos.getX(0), minZ: z0, sx: pos.getX(1) - pos.getX(0), sz: pos.getZ(vx) - z0, vx, vz, h };
}

function inGrid(g: Grid, x: number, z: number): boolean {
  return x >= g.minX && z >= g.minZ && x <= g.minX + g.sx * (g.vx - 1) && z <= g.minZ + g.sz * (g.vz - 1);
}

/** Bilinear height on the grid (clamped at its edges). */
function gridH(g: Grid, x: number, z: number): number {
  const fi = Math.min(g.vx - 1.000001, Math.max(0, (x - g.minX) / g.sx));
  const fj = Math.min(g.vz - 1.000001, Math.max(0, (z - g.minZ) / g.sz));
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const u = fi - i;
  const v = fj - j;
  const k = j * g.vx + i;
  const H = g.h;
  return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + g.vx] * (1 - u) + H[k + g.vx + 1] * u) * v;
}

/** The ground as the mesh DRAWS it (its two triangles a,c,b and b,c,e per cell). */
function drawnH(g: Grid, x: number, z: number): number {
  const fi = Math.min(g.vx - 1.000001, Math.max(0, (x - g.minX) / g.sx));
  const fj = Math.min(g.vz - 1.000001, Math.max(0, (z - g.minZ) / g.sz));
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const fx = fi - i;
  const fz = fj - j;
  const k = j * g.vx + i;
  const H = g.h;
  const ha = H[k];
  const hb = H[k + 1];
  const hc = H[k + g.vx];
  const he = H[k + g.vx + 1];
  return fx + fz <= 1 ? ha + (hb - ha) * fx + (hc - ha) * fz : he + (hc - he) * (1 - fx) + (hb - he) * (1 - fz);
}

// ── Zones: the place's grass and rock colour at a point ──────────────────────

const GOLD_LINE: ReadonlyArray<readonly [number, number]> = [
  [1450, 1132], // the collar's rim shelf
  [1450, 690], // the saddle
  [1450, 250], // the meadow
  [1345, -215], // the brook's mouth
  [700, -350], // the lake
];

interface ZoneOut {
  grass: THREE.Color;
  rock: THREE.Color;
  /** 0..1: wet gorge (moss on ledges, steeper strata). */
  wet: number;
}

function makeZones() {
  const C = {
    coast: lin(PAL.coast),
    valley: lin(PAL.valley),
    moss: lin(PAL.moss),
    dry: lin(PAL.dry),
    gold: lin(PAL.gold),
    forest: lin(PAL.forest),
    far: lin(PAL.far),
    rockWarm: lin(PAL.rockWarm),
    rockWet: lin(PAL.rockWet),
    rockViolet: lin(PAL.rockViolet),
    rockGrey: lin(PAL.rockGrey),
  };
  const gorgePts = GORGE.map((g) => [g[0], 0, g[1]] as const);
  const goldPts = GOLD_LINE.map((g) => [g[0], 0, g[1]] as const);
  const L = WORLD.lake;
  const F = WORLD.forest;
  const tmp = new THREE.Color();
  return function zoneAt(x: number, z: number, h: number, out: ZoneOut): ZoneOut {
    // South of the gorge: the coastal shelf (a1) grading into the valley (a2).
    const south = smooth(1450, 1800, z);
    const coast = smooth(3300, 4000, z);
    out.grass.copy(C.far);
    out.rock.copy(C.rockGrey);
    tmp.copy(C.valley).lerp(C.coast, coast);
    out.grass.lerp(tmp, south);
    out.rock.lerp(C.rockWarm, south);
    // The gorge: wet rock and moss on its walls and floor, below the rim.
    const gq = distPoly(x, z, gorgePts);
    const ga = GORGE[gq.i];
    const gb = GORGE[Math.min(GORGE.length - 1, gq.i + 1)];
    const halfW = ga[3] + (gb[3] - ga[3]) * gq.u;
    const gorge = (1 - smooth(halfW + 40, halfW + 260, gq.d)) * (1 - smooth(430, 560, h));
    out.grass.lerp(C.moss, gorge * 0.85);
    out.rock.lerp(C.rockWet, gorge);
    // The collar, the saddle, the meadow and the lake basin: dry to golden grass.
    const gd = distPoly(x, z, goldPts).d;
    const lakeD = Math.hypot(x - L.x, z - L.z);
    const basin = Math.max(1 - smooth(260, 900, gd), 1 - smooth(L.r + 150, L.r + 900, lakeD)) * (1 - south * 0.9);
    tmp.copy(C.dry).lerp(C.gold, smooth(700, 200, z));
    out.grass.lerp(tmp, basin);
    out.rock.lerp(C.rockViolet, basin * 0.8);
    // The Glowing Forest's floor.
    const fd = Math.hypot(x - F.x, z - F.z);
    const forest = 1 - smooth(F.r * 0.85, F.r * 1.25, fd);
    out.grass.lerp(C.forest, forest);
    out.wet = gorge;
    return out;
  };
}

// ── The mask texture: trail, water edge, worn ground, forest floor ───────────

interface MaskBounds {
  minX: number;
  minZ: number;
  w: number;
  d: number;
}

/** Rasterise a distance field for a set of segments into one channel (min). */
function splatSegments(
  data: Uint8Array,
  b: MaskBounds,
  ch: number,
  segs: ReadonlyArray<readonly [number, number, number, number, number]>, // ax, az, bx, bz, offset (subtracted)
  range: number,
) {
  const tx = b.w / MASK_RES;
  const tz = b.d / MASK_RES;
  for (const [ax, az, bx, bz, off] of segs) {
    const pad = range + off;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad - b.minX) / tx));
    const i1 = Math.min(MASK_RES - 1, Math.ceil((Math.max(ax, bx) + pad - b.minX) / tx));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - pad - b.minZ) / tz));
    const j1 = Math.min(MASK_RES - 1, Math.ceil((Math.max(az, bz) + pad - b.minZ) / tz));
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz || 1;
    for (let j = j0; j <= j1; j++) {
      const z = b.minZ + (j + 0.5) * tz;
      for (let i = i0; i <= i1; i++) {
        const x = b.minX + (i + 0.5) * tx;
        const u = clamp01(((x - ax) * dx + (z - az) * dz) / L2);
        const d = Math.max(0, Math.hypot(x - ax - dx * u, z - az - dz * u) - off);
        const v = Math.min(255, Math.round((d / range) * 255));
        const o = (j * MASK_RES + i) * 4 + ch;
        if (v < data[o]) data[o] = v;
      }
    }
  }
}

/** Densify a water line (Catmull-Rom through its points) into short segments with a half width each. */
function waterSegments(
  pts: ReadonlyArray<readonly [number, number, number]>,
  halfW: (along: number) => number,
): Array<[number, number, number, number, number]> {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, "centripetal");
  const n = Math.max(8, Math.round(curve.getLength() / 30));
  const p = curve.getSpacedPoints(n);
  const out: Array<[number, number, number, number, number]> = [];
  for (let i = 0; i < n; i++) out.push([p[i].x, p[i].z, p[i + 1].x, p[i + 1].z, halfW((i + 0.5) / n)]);
  return out;
}

/** Stream bed half width (terrain.ts STREAM_W0..W1, square of the way along) plus the bank's lip. */
const streamHalfW = (along: number) => 14 + (58 - 14) * along * along + 1.5;
const RIVER_HW = 16.5;
const brookHalfW = (along: number) => 4.5 + 3.5 * along;

function buildMask(b: MaskBounds, forestAt: ((x: number, z: number) => number) | null) {
  const data = new Uint8Array(MASK_RES * MASK_RES * 4);
  for (let k = 0; k < data.length; k += 4) {
    data[k] = 255;
    data[k + 1] = 255;
    data[k + 2] = 0;
    data[k + 3] = 0;
  }
  // R: the trail, on the ground only (not under it, not floating over it).
  const trail: Array<[number, number, number, number, number]> = [];
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i];
    const c = PATH[i + 1];
    if (a.under) continue;
    if (Math.abs(a.y - terrainHeight(a.x, a.z)) > 25 || Math.abs(c.y - terrainHeight(c.x, c.z)) > 25) continue;
    trail.push([a.x, a.z, c.x, c.z, 0]);
  }
  splatSegments(data, b, 0, trail, TRAIL_RANGE);
  // G: the water's edge (distance past each line's half width).
  const water = [
    ...waterSegments(RIVER, () => RIVER_HW),
    ...waterSegments(STREAM, streamHalfW),
    ...waterSegments(BROOK, brookHalfW),
  ];
  splatSegments(data, b, 1, water, BANK_RANGE);
  // B: worn ground round the camps, the pads and the jetty foot, feathered.
  const worn: Array<readonly [number, number, number, number]> = [];
  for (const p of PLACES) {
    if (p.id === "a1") worn.push([p.pos.x, p.pos.z, 38, 22]);
    if (p.id === "a2") worn.push([p.pos.x, p.pos.z, 70, 26]);
  }
  worn.push([1350, -440, 30, 18]); // jetty foot
  worn.push([PATH[0].x, PATH[0].z, 22, 14]); // dock foot
  const tx = b.w / MASK_RES;
  const tz = b.d / MASK_RES;
  for (const [cx, cz, r, f] of worn) {
    const i0 = Math.max(0, Math.floor((cx - r - f - b.minX) / tx));
    const i1 = Math.min(MASK_RES - 1, Math.ceil((cx + r + f - b.minX) / tx));
    const j0 = Math.max(0, Math.floor((cz - r - f - b.minZ) / tz));
    const j1 = Math.min(MASK_RES - 1, Math.ceil((cz + r + f - b.minZ) / tz));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = b.minX + (i + 0.5) * tx;
        const z = b.minZ + (j + 0.5) * tz;
        const v = Math.round(255 * (1 - smooth(r, r + f, Math.hypot(x - cx, z - cz))));
        const o = (j * MASK_RES + i) * 4 + 2;
        if (v > data[o]) data[o] = v;
      }
    }
  }
  fillForest(data, b, forestAt);
  return data;
}

/** A: forest floor, sampled every 4th texel and filled bilinearly (the density is smooth). */
function fillForest(data: Uint8Array, b: MaskBounds, forestAt: ((x: number, z: number) => number) | null) {
  const S = 4;
  const n = MASK_RES / S + 1;
  const coarse = new Float32Array(n * n);
  const F = WORLD.forest;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = b.minX + (i * S * b.w) / MASK_RES;
      const z = b.minZ + (j * S * b.d) / MASK_RES;
      let v: number;
      if (forestAt) v = forestAt(x, z);
      else {
        // Default guess until forest.ts hands its density in: the Glowing
        // Forest, and a soft darkening on mid slopes of the wild zones.
        const inF = 1 - smooth(F.r * 0.8, F.r * 1.1, Math.hypot(x - F.x, z - F.z));
        v = inF;
      }
      coarse[j * n + i] = clamp01(Number.isFinite(v) ? v : 0);
    }
  }
  for (let j = 0; j < MASK_RES; j++) {
    const fj = j / S;
    const j0 = Math.min(n - 2, Math.floor(fj));
    const v = fj - j0;
    for (let i = 0; i < MASK_RES; i++) {
      const fi = i / S;
      const i0 = Math.min(n - 2, Math.floor(fi));
      const u = fi - i0;
      const k = j0 * n + i0;
      const val = (coarse[k] * (1 - u) + coarse[k + 1] * u) * (1 - v) + (coarse[k + n] * (1 - u) + coarse[k + n + 1] * u) * v;
      data[(j * MASK_RES + i) * 4 + 3] = Math.round(255 * val);
    }
  }
}

// ── GLSL ─────────────────────────────────────────────────────────────────────

const NOISE_GLSL = /* glsl */ `
float sHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float sNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( sHash( i ), sHash( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( sHash( i + vec2( 0.0, 1.0 ) ), sHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float sFbm( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 3; i++ ) {
    s += a * sNoise( p );
    p = mat2( 1.6, 1.2, -1.2, 1.6 ) * p + 17.3;
    a *= 0.5;
  }
  return s / 0.875;
}
float sLuma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
`;

const TERRAIN_VERT_PARS = /* glsl */ `
attribute vec4 aRock;
attribute vec4 aSurf;
varying vec4 vRock;
varying vec4 vSurf;
varying vec3 vSW;
varying vec3 vSN;
`;

const TERRAIN_VERT_MAIN = /* glsl */ `
vRock = aRock;
vSurf = aSurf;
vSW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vSN = normalize( mat3( modelMatrix ) * objectNormal );
`;

const TERRAIN_FRAG_PARS = /* glsl */ `
varying vec4 vRock;
varying vec4 vSurf;
varying vec3 vSW;
varying vec3 vSN;
uniform sampler2D uMask;
uniform vec4 uMaskB;
uniform sampler2D uShadeTex;
uniform vec4 uShadeB;
uniform float uShadeOn;
uniform vec3 uSand, uWetSand, uPath, uPathEdge, uVerge, uBank, uWorn, uMoss, uRockHigh, uForestFloor, uDry;
uniform vec3 uSunDirS;
uniform vec4 uLake;
${NOISE_GLSL}

vec3 paintTerrain( vec3 grass ) {
  vec2 xz = vSW.xz;
  float h = vSW.y;
  vec3 N = normalize( vSN );
  float ny = N.y;
  float slope = 1.0 - ny;
  float crease = vSurf.x;   // + concave, - convex
  float hollow = vSurf.y;   // + sits below its surroundings
  float ao = vSurf.z;       // 1 open sky, 0 closed in
  float wet = vRock.a;

  // World units covered by one pixel: each fine layer fades before it aliases.
  float fw = length( fwidth( xz ) );

  vec2 warp = vec2( sNoise( xz * 0.0011 + 3.1 ), sNoise( xz * 0.0011 - 7.7 ) ) * 260.0;
  float nLo = sFbm( ( xz + warp ) * 0.0016 );      // big patches (~600)
  float n300 = sNoise( ( xz + warp * 0.4 ) / 300.0 );
  float n40 = sNoise( xz / 40.0 + n300 * 1.7 );

  // Grass: patches drift toward sunnier or deeper inside the zone's colour,
  // dry on convex open ground.
  vec3 c = grass * mix( 0.84, 1.1, smoothstep( 0.2, 0.85, nLo ) );
  c *= mix( vec3( 0.95, 0.99, 1.04 ), vec3( 1.06, 1.02, 0.9 ), smoothstep( 0.25, 0.75, n300 ) );
  float dryAmt = smoothstep( 0.55, 0.95, nLo * 0.7 + clamp( -crease, 0.0, 1.0 ) * 0.5 + n300 * 0.25 ) * 0.45;
  c = mix( c, uDry * ( sLuma( c ) / max( sLuma( uDry ), 1e-3 ) ) * 1.05, dryAmt * ( 1.0 - wet ) );

  // Forest floor: darker and cooler under the forest's density.
  vec2 muv = ( xz - uMaskB.xy ) * uMaskB.zw;
  vec4 mk = ( muv.x > 0.0 && muv.x < 1.0 && muv.y > 0.0 && muv.y < 1.0 ) ? texture2D( uMask, muv ) : vec4( 1.0, 1.0, 0.0, 0.0 );
  c = mix( c, uForestFloor * ( 0.85 + 0.3 * n300 ), mk.a * 0.8 );

  // Rock on steep faces, and more of it high up.
  float rock = smoothstep( 0.28, 0.42, slope + ( n300 - 0.5 ) * 0.12 + ( n40 - 0.5 ) * 0.05 );
  rock = max( rock, smoothstep( 1180.0, 1320.0, h + ( nLo - 0.5 ) * 160.0 ) * 0.8 );
  // Strata: bands along one tilted plane per place (the gorge dips east 18
  // degrees, elsewhere 12), broken by noise; ledges catch a lighter edge.
  float dip = mix( 0.21, 0.325, wet );
  float sCoord = ( h + xz.x * dip ) / 16.0 + n40 * 0.6 + n300 * 1.3;
  float band = fract( sCoord );
  float strata = smoothstep( 0.0, 0.18, band ) * ( 1.0 - smoothstep( 0.78, 1.0, band ) );
  float strataFade = 1.0 - smoothstep( 1.2, 5.0, fw );
  float steep = smoothstep( 0.2, 0.45, slope );
  vec3 rc = vRock.rgb * mix( 1.0, mix( 0.84, 1.05, strata ), strataFade * steep * ( 0.55 + 0.45 * n300 ) );
  rc *= 0.86 + 0.28 * n300;
  rc = mix( rc, uRockHigh, smoothstep( 1250.0, 1450.0, h + ( nLo - 0.5 ) * 120.0 ) * 0.6 );
  // Moss on the wet gorge's gentler ledges.
  float ledge = smoothstep( 0.35, 0.6, ny ) * wet * smoothstep( 0.35, 0.7, n40 * 0.6 + n300 * 0.5 );
  rc = mix( rc, uMoss, ledge * 0.85 );
  c = mix( c, rc, rock );

  // Shore of the sea: sand above the water, wet and dark right at it.
  float sandH = 7.0 + ( n300 - 0.5 ) * 6.0 + ( n40 - 0.5 ) * 2.0;
  float sand = ( 1.0 - smoothstep( sandH - 2.5, sandH, h ) ) * ( 1.0 - smoothstep( 0.35, 0.55, slope ) );
  c = mix( c, uSand * ( 0.92 + 0.14 * n40 ), sand );
  c = mix( c, uWetSand, ( 1.0 - smoothstep( -0.5, 1.6, h ) ) );

  // The lake's shore: a damp darker ring just above the water.
  float lakeD = length( xz - uLake.xy );
  float lakeShore = ( 1.0 - smoothstep( uLake.w + 0.5, uLake.w + 4.0 + 2.0 * n40, h ) ) * ( 1.0 - smoothstep( uLake.z - 20.0, uLake.z + 120.0, lakeD ) );
  c = mix( c, uBank, lakeShore * 0.55 );

  // Banks: damp and dark along the river, the stream and the brook.
  float bankD = mk.g * ${BANK_RANGE.toFixed(1)};
  float bank = 1.0 - smoothstep( 0.0, 20.0 + 10.0 * n40, bankD );
  c = mix( c, uBank * ( 0.9 + 0.2 * n40 ), bank * 0.7 * ( 1.0 - rock * 0.4 ) );

  // Worn ground round the camps.
  c = mix( c, uWorn * ( 0.9 + 0.2 * n40 ), mk.b * 0.75 * ( 1.0 - rock ) );

  // The trail: a worn ribbon with a dusty verge and two faint ruts; it fades
  // on steep ground, where a top-down paint would smear down the wall.
  float trailD = mk.r * ${TRAIL_RANGE.toFixed(1)} + ( n40 - 0.5 ) * 3.0;
  float hw = 6.5 + 2.0 * n300;
  float aa = max( fw * 0.75, 0.6 );
  float onPath = 1.0 - smoothstep( hw - aa, hw + aa, trailD );
  float verge = ( 1.0 - smoothstep( hw, hw + 9.0, trailD ) ) * ( 1.0 - onPath );
  float pathFade = 1.0 - smoothstep( 0.35, 0.6, slope );
  vec3 pc = mix( uPath, uPathEdge, smoothstep( hw * 0.45, hw, trailD ) );
  pc *= 1.0 - 0.07 * ( 1.0 - smoothstep( 0.0, 1.2, abs( trailD - hw * 0.45 ) ) ) * ( 1.0 - smoothstep( 0.5, 2.0, fw ) );
  c = mix( c, uVerge * ( sLuma( c ) / max( sLuma( uVerge ), 1e-3 ) * 0.5 + 0.55 ), verge * 0.4 * pathFade );
  c = mix( c, pc * ( 0.93 + 0.12 * n40 ), onPath * pathFade );

  // Brush texture: dabs at ~40 units and grain near the camera, both fading
  // before they alias.
  float dab = sNoise( vec2( xz.x * 0.03 + n300 * 1.7, xz.y * 0.05 + xz.x * 0.012 ) );
  c *= 1.0 + ( dab - 0.5 ) * 0.14 * ( 1.0 - smoothstep( 2.0, 6.0, fw ) );
  float grain = sNoise( vec2( xz.x * 0.16 + dab * 2.0, xz.y * 0.55 ) );
  c *= 1.0 + ( grain - 0.5 ) * 0.08 * ( 1.0 - smoothstep( 0.4, 1.2, fw ) );

  // Baked shade: creases dark, ridges lifted, hollows and closed-in ground darker.
  c *= mix( 1.0, 0.64, clamp( crease, 0.0, 1.0 ) );
  c *= 1.0 + 0.08 * clamp( -crease, 0.0, 1.0 );
  c *= 1.0 - ( 0.22 + 0.12 * rock ) * clamp( hollow, 0.0, 1.0 );
  c *= mix( 0.58, 1.0, ao );

  // Carlson's planes: flat 1.0, slopes ~0.86, steep and cliff ~0.72.
  c *= mix( 0.72, 1.0, smoothstep( 0.62, 0.93, ny ) );

  // Tree shadows baked by the forest module (1 = lit), when it hands them in.
  if ( uShadeOn > 0.5 ) {
    vec2 suv = ( xz - uShadeB.xy ) * uShadeB.zw;
    if ( suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0 ) {
      float lit = texture2D( uShadeTex, suv ).r;
      c *= mix( 0.65, 1.0, lit );
      c = mix( c, c * vec3( 0.92, 0.97, 1.08 ), 1.0 - lit );
    }
  }

  // Faces turned from the sun go cool and grey, not saturated.
  float away = 1.0 - smoothstep( -0.35, 0.15, dot( N, uSunDirS ) );
  c = mix( c, vec3( sLuma( c ) ) * vec3( 0.95, 1.0, 1.05 ), away * 0.3 );
  return c;
}
`;

// Water vertex: world position and the stock fog chunk (mvPosition, transformed).
const WATER_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#ifdef FLOW
attribute vec2 aFlow;
varying vec2 vFlow;
#endif
varying vec3 vW;
void main() {
  vec3 transformed = position;
  vec4 wp = modelMatrix * vec4( transformed, 1.0 );
  vW = wp.xyz;
#ifdef FLOW
  vFlow = aFlow;
#endif
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SEA_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uSunDir, uSunCol, uSkyLo, uSkyHi, uDeep, uShallow, uFoam;
uniform sampler2D uHeight;
uniform vec4 uHB;
uniform float uLevel;
varying vec3 vW;
${NOISE_GLSL}
vec2 wave( vec2 p, vec2 d, float k, float a, float w, float t ) {
  return d * ( a * cos( dot( d, p ) * k - t * w ) );
}
void main() {
  vec3 V = normalize( cameraPosition - vW );
  vec2 p = vW.xz;
  float fw = length( fwidth( p ) );
  float t = uTime;
  // The long swell rolls in from the south-south-east toward the shore;
  // shorter chop on top fades out before it aliases.
  vec2 g = vec2( 0.0 );
  g += wave( p, normalize( vec2( -0.25, -1.0 ) ), 6.2832 / 190.0, 0.09, 0.75, t );
  g += wave( p, normalize( vec2( 0.35, -1.0 ) ), 6.2832 / 110.0, 0.07, 1.05, t );
  float chop = 1.0 - smoothstep( 3.0, 12.0, fw );
  g += wave( p, normalize( vec2( 1.0, -0.4 ) ), 6.2832 / 46.0, 0.06, 1.7, t ) * chop;
  g += wave( p, normalize( vec2( -1.0, -0.2 ) ), 6.2832 / 23.0, 0.05, 2.5, t ) * chop * ( 1.0 - smoothstep( 1.0, 4.0, fw ) );
  g *= 0.55 + 0.9 * sNoise( p * 0.0025 + vec2( t * 0.01, 0.0 ) );
  vec3 N = normalize( vec3( -g.x, 1.0, -g.y ) );

  float NdV = clamp( dot( N, V ), 0.0, 1.0 );
  float F = 0.06 + 0.94 * pow( 1.0 - NdV, 5.0 );
  vec3 R = reflect( -V, N );
  vec3 sky = mix( uSkyLo, uSkyHi, smoothstep( 0.0, 0.5, max( R.y, 0.0 ) ) );
  float sunAmt = max( dot( R, uSunDir ), 0.0 );
  sky += uSunCol * pow( sunAmt, 12.0 ) * 0.45;

  vec2 huv = ( p - uHB.xy ) * uHB.zw;
  float ground = ( huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0 ) ? texture2D( uHeight, huv ).r : -200.0;
  float depth = uLevel - ground;
  float shallow = 1.0 - smoothstep( 0.5, 16.0, depth );
  vec3 body = mix( uDeep, uShallow, shallow * 0.55 );
  vec3 col = mix( body, sky * 0.78, F * 0.6 );
  // Sparkle toward the sun.
  col += uSunCol * ( pow( sunAmt, 260.0 ) * 1.6 + pow( sunAmt, 50.0 ) * 0.18 );

  // Foam: a broken line where the water thins over the beach, washing in and out.
  float swash = 0.5 + 0.5 * sin( t * 0.55 + p.x * 0.006 + p.y * 0.004 );
  float reach = 0.5 + 1.3 * swash;
  float fn = sNoise( p * 0.12 + vec2( t * 0.12, -t * 0.09 ) );
  float fn2 = sNoise( p * 0.035 - vec2( t * 0.03, 0.0 ) );
  float edge = 1.0 - smoothstep( 0.0, reach, depth );
  float foam = edge * smoothstep( 0.35, 0.7, fn * 0.55 + fn2 * 0.25 + edge * 0.5 );
  // A second, fainter line further out: the last wave's trace.
  float line2 = ( 1.0 - smoothstep( 0.0, 0.5, abs( depth - reach - 2.0 ) ) ) * smoothstep( 0.55, 0.8, fn2 ) * 0.3;
  col = mix( col, uFoam, clamp( foam * 0.75 + line2, 0.0, 1.0 ) * step( -2.0, depth ) );

  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const FLOW_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime, uSpeed, uWhite;
uniform vec3 uSunDir, uSunCol, uSkyLo, uSkyHi, uBody, uFoam;
varying vec3 vW;
varying vec2 vFlow;
${NOISE_GLSL}
void main() {
  vec3 V = normalize( cameraPosition - vW );
  float u = vFlow.x;
  float s = vFlow.y;
  float fs = fwidth( s );
  float t = uTime * uSpeed;
  // Streaks along the flow, travelling downstream at two speeds.
  float st1 = sNoise( vec2( u * 2.6 + 0.4 * sin( s * 0.03 ), ( s - t ) * 0.03 ) );
  float st2 = sNoise( vec2( u * 6.5 + 5.0, ( s - t * 1.35 ) * 0.08 ) );
  float fine = 1.0 - smoothstep( 1.5, 5.0, fs );
  float streak = st1 * 0.62 + mix( 0.5, st2, fine ) * 0.38;
  float fres = pow( 1.0 - clamp( V.y, 0.0, 1.0 ), 3.0 );
  vec3 sky = mix( uSkyLo, uSkyHi, 0.35 );
  vec3 col = mix( uBody, sky * 0.8, 0.12 + 0.4 * fres );
  col *= 0.8 + 0.4 * smoothstep( 0.35, 0.8, streak );
  // White water at the edges (stones) and in broken patches.
  float edge = smoothstep( 0.6, 1.0, abs( u ) );
  float white = ( edge * 0.6 + uWhite ) * smoothstep( 0.5, 0.78, mix( 0.5, st2, fine ) * 0.6 + st1 * 0.4 );
  col = mix( col, uFoam, clamp( white, 0.0, 0.85 ) );
  vec3 N = normalize( vec3( ( st1 - 0.5 ) * 0.3, 1.0, ( st2 - 0.5 ) * 0.3 ) );
  vec3 R = reflect( -V, N );
  col += uSunCol * pow( max( dot( R, uSunDir ), 0.0 ), 70.0 ) * 0.5;
  float a = 1.0 - smoothstep( 0.8, 1.0, abs( u ) );
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const POOL_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec2 uImpact;
uniform vec3 uPool;
uniform vec3 uDeep, uFoam, uSky;
varying vec3 vW;
${NOISE_GLSL}
float pStep( float edge, float v ) {
  float e = fwidth( v ) * 1.1 + 0.0015;
  return smoothstep( edge - e, edge + e, v );
}
void main() {
  vec2 d = vW.xz - uImpact;
  float r = length( d );
  float th = atan( d.y, d.x );
  float t = uTime;
  float n = sNoise( vW.xz * 0.05 + t * 0.25 );
  // Detail pass 3 (water): flat painted tones, crisp edges. A white boil along
  // the line where the curtain lands, torn at its edge; foam streaks carried
  // out from it; broken rings; dark teal water between, lighter at the rim.
  float st1 = sNoise( vec2( th * 9.0, r * 0.05 - t * 0.9 ) );
  float st2 = sNoise( vec2( th * 23.0 + 4.0, r * 0.12 - t * 1.7 ) );
  vec2 el = vec2( d.x / 60.0, d.y / 20.0 );
  float boil = length( el ) + ( n - 0.5 ) * 0.5 + ( sNoise( vec2( th * 6.0, r * 0.09 - t * 1.4 ) ) - 0.5 ) * 0.4;
  // Broken: dark water shows through the boil in torn holes.
  float holes = pStep( 0.7, sNoise( vW.xz * vec2( 0.09, 0.16 ) + vec2( 0.0, -t * 0.7 ) ) * 0.7 + st2 * 0.3 );
  float core = ( 1.0 - pStep( 1.0, boil ) ) * ( 1.0 - holes * pStep( 0.35, boil ) );
  float spread = 1.0 - smoothstep( 20.0, 100.0, r + ( n - 0.5 ) * 40.0 );
  float streaks = pStep( 0.66, st1 * 0.6 + st2 * 0.4 + spread * 0.22 ) * pStep( 0.12, spread );
  float rings = pStep( 0.78, ( sin( r * 0.26 - t * 2.4 + n * 3.0 ) * 0.5 + 0.5 ) * exp( -r * 0.01 ) + ( st2 - 0.5 ) * 0.35 );
  float rim = smoothstep( uPool.z - 26.0, uPool.z, length( vW.xz - uPool.xy ) );
  vec3 col = mix( uDeep * 0.8, uSky * 0.5, 0.08 + 0.18 * pStep( 0.5, rim + ( n - 0.5 ) * 0.4 ) );
  col = mix( col, mix( uDeep, uFoam, 0.5 ), rings * 0.8 );
  col = mix( col, uFoam * 1.3, streaks );
  // Overbright for the same reason as the curtain's foot: the valley haze greys the gorge floor.
  col = mix( col, uFoam * 1.8, core );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * The curtain. Same attributes as blocks.ts's sheetGeometry (uv, aDrop,
 * aSheet: fall height, fall time, fade), same free-fall clock: a feature that
 * left the lip at time t0 is at drop d when t - t0 = T (sqrt(d/H + E) -
 * sqrt(E)), so sampling a pattern at (x, t - tau(d)) makes it fall and
 * stretch the way water does (bunched at the lip, long streaks at the foot).
 */
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
  vec3 transformed = position;
  vWc = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

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
  // Close up (the dive, the pool, the cave) the ribbons get finer, so the
  // frame holds 15-25 of them and never 7 huge bands.
  float dist = length( vWc - cameraPosition );
  float near = 1.0 - smoothstep( 110.0, 320.0, dist );

  // Ribbons at three scales, every one a flat band with a crisp edge (Firewatch
  // water: posterized, no soft gradients). The finest fade before they alias.
  float k1 = sNoise( vec2( x * 7.0, ph * 0.42 ) );
  float k1n = sNoise( vec2( x * 17.0 + 5.0, ph * 0.5 + 9.0 ) );
  float k2 = sNoise( vec2( x * mix( 23.0, 41.0, near ) + 7.0, ph * 0.9 + 3.0 ) );
  float k3 = sNoise( vec2( x * mix( 71.0, 97.0, near ) + 19.0, ph * 1.8 + 11.0 ) );
  float f3 = 1.0 - clamp( fwidth( x * 80.0 ) * 1.3, 0.0, 1.0 );
  float st2 = cStep( 0.5, k2 );
  float st3 = cStep( 0.56, k3 ) * f3;
  float bodyN = mix( cStep( 0.5, k1 ), cStep( 0.5, k1n ), near );
  float n = clamp( bodyN * 0.42 + st2 * 0.36 + st3 * 0.22, 0.0, 1.0 );
  // Three flat tones: shade, mid, lit.
  float tone = cStep( 0.3, n ) * 0.5 + cStep( 0.64, n ) * 0.5;
  // The water breaks up as it falls: a glassy tongue at the lip, strands below.
  float brk = smoothstep( 0.0, 0.14, y );
  float thick = mix( 0.62, tone, 0.3 + 0.7 * brk );
  // Foam heads: bright clots that fall and stretch.
  float fhN = sNoise( vec2( x * 6.5 + 3.0, ph * 0.75 ) ) * 0.8 + k2 * 0.2;
  float heads = cStep( 0.66, fhN ) * brk;
  // Two rock teeth on the lip split the top into three unequal falls; the
  // gaps close as the sheets spread, their edges torn by the strands.
  float torn = ( k2 - 0.5 ) * 0.03 + ( sNoise( vec2( ph * 1.3, 2.0 ) ) - 0.5 ) * 0.015;
  float g1w = 0.042 * ( 1.0 - smoothstep( 0.0, 0.3, y ) );
  float g2w = 0.028 * ( 1.0 - smoothstep( 0.0, 0.2, y ) );
  float g1 = ( 1.0 - smoothstep( g1w * 0.4, g1w + 0.006, abs( x - 0.34 + torn ) ) ) * smoothstep( 0.0, 0.012, g1w );
  float g2 = ( 1.0 - smoothstep( g2w * 0.4, g2w + 0.006, abs( x - 0.66 - torn ) ) ) * smoothstep( 0.0, 0.012, g2w );
  // Below the lip the sheet thins into ribbons with dark rock between them
  // (about a sixth of it): long slots that hold still while the water moves.
  float slotN = sNoise( vec2( x * 13.0 + 41.0, y * 1.6 + 3.0 ) ) + ( k2 - 0.5 ) * 0.1 + ( k3 - 0.5 ) * 0.05;
  float slots = cStep( 0.68, slotN ) * smoothstep( 0.08, 0.2, y ) * ( 1.0 - smoothstep( 0.86, 0.95, y ) );
  float onSheet = isMain * step( 0.0, vDrop ) * ( 1.0 - heads );
  float lipGaps = max( g1, g2 ) * onSheet;
  float slotGaps = slots * onSheet;
  float gaps = max( lipGaps, slotGaps );
  float s1 = k1;
  float s2 = k2;

  // Light: cream on the sun side, blue grey in shade.
  float lit = clamp( uSunFront + uSunSide * ( x - 0.5 ) * 1.4, 0.0, 1.0 );
  vec3 base = mix( uShade, uLit, lit );
  vec3 col = base * mix( 0.3, 1.06, thick );
  col = mix( col, uFoamC * mix( 0.85, 1.08, lit ), heads * 0.85 );
  // The glassy tongue, and a bright lip catching the sky.
  col = mix( col, mix( uShade * 0.75, uSky, 0.3 + 0.35 * cStep( 0.5, s1 ) ), ( 1.0 - brk ) * 0.5 );
  float lip = smoothstep( -8.0, -1.0, vDrop ) * ( 1.0 - smoothstep( 0.0, 7.0, vDrop ) );
  col = mix( col, uSky * 1.08 + 0.1, lip * 0.75 );
  col = mix( col, uSky, ( 1.0 - smoothstep( 0.0, 0.3, y ) ) * 0.18 );
  // White water where it lands.
  // Kept to the last few percent and streaked: seen level from the pool the
  // old 16 percent band of flat foam filled the frame as one cream wall.
  // A torn, crisp edged foam band where it lands (a soft ramp read as haze).
  float foot = cStep( 0.94, y + ( k2 - 0.5 ) * 0.05 + ( k1 - 0.5 ) * 0.03 ) * isMain;
  col = mix( col, uFoamC * mix( 0.82, 1.04, cStep( 0.5, s1 ) ), foot * ( 0.25 + 0.75 * max( st2, heads ) ) );
  col *= uDay;

  // Seen from the front the slots show dark wet rock, painted in and opaque:
  // left see-through they showed the cave behind, fogged cream (a white-out at key 19).
  col = mix( col, vec3( 0.045, 0.04, 0.042 ) * uDay, slotGaps * 0.92 );
  float a = max( mix( 0.8, 0.99, thick ), heads );
  a = max( a, foot * ( 0.6 + 0.3 * st2 ) );
  a = max( a, slotGaps * 0.96 );
  a *= 1.0 - lipGaps * 0.93;
  float e = min( x, 1.0 - x );
  float rag = smoothstep( 0.0, 0.03 + 0.09 * s1 + 0.03 * s2, e );
  a *= rag;
  // Island falls thin out into the clouds.
  a *= 1.0 - vSheet.z * smoothstep( 0.35, 1.0, y ) * ( 0.75 + 0.25 * n );

  // Seen from behind (the cave): a window of backlit water. The day beyond is
  // painted in (a peach sky over a dark jagged gorge and tree line), bent by
  // the ribbons and seen clearest where the water is thin or split.
  if ( uBack > 0.001 ) {
    vec3 dir = normalize( vWc - cameraPosition );
    float az = atan( dir.x, dir.z );
    float el = dir.y / max( length( dir.xz ), 0.001 );
    // Bent a little by the ribbons (a lot bent read as drips).
    el += ( st2 - 0.5 ) * 0.008;
    // The far side of the gorge: a ridge a little above eye level, spruce tips on it.
    // Pass 3b: a lower ridge and short, fine spruce tips (tall close tips left the sky
    // between them reading as white fangs hanging off the lip).
    float ridge = 0.075 + 0.03 * sNoise( vec2( az * 4.0, 1.0 ) ) + 0.012 * sNoise( vec2( az * 11.0, 4.0 ) );
    float tip = 1.0 - abs( fract( az * 70.0 + 0.3 * sNoise( vec2( az * 6.0, 7.0 ) ) ) - 0.5 ) * 2.0;
    ridge += max( 0.0, tip * 1.7 - 0.7 ) * 0.018 * step( 0.4, sNoise( vec2( az * 3.0, 11.0 ) ) );
    float skyK = cStep( ridge, el );
    // Peach at the ridge, paler gold above (linear, over 1 on purpose: it is the light source).
    vec3 sky = mix( vec3( 1.45, 0.86, 0.5 ), vec3( 1.2, 1.0, 0.82 ), smoothstep( ridge, ridge + 0.3, el ) );
    // The gorge beyond: a dark cool band, a nearer darker one under it.
    float band2 = cStep( ridge - 0.07 + 0.03 * sNoise( vec2( az * 7.0, 17.0 ) ), el );
    vec3 gorge = mix( vec3( 0.03, 0.026, 0.04 ), vec3( 0.085, 0.07, 0.1 ), band2 );
    vec3 world = mix( gorge, sky, skyK );
    // Water over it: thin ribbons let the world through; thick ones glow cool
    // white, the day's light caught in the falling water.
    float strands = st2 * 0.6 + st3 * 0.4;
    vec3 strandC = vec3( 0.78, 0.92, 1.1 ) * mix( 0.45, 1.25, strands );
    vec3 water = mix( world, strandC, 0.15 + 0.6 * tone );
    water = mix( water, vec3( 0.08, 0.08, 0.1 ), heads * 0.4 );
    // Slots show the gorge through the water; over the sky they stay mostly water
    // (open, they read as white fangs hanging off the top of the frame).
    vec3 glow = mix( water, world, gaps * mix( 1.0, 0.2, skyK ) );
    col = mix( col, glow, uBack );
    a = mix( a, 0.97 * rag, uBack );
  }
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** FallsSpray, softer: the same drift as blocks.ts's spray, two-tone, thinning near the camera. */
const MIST_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 aOffset;
attribute vec4 aData; // size, place, seed, rate
uniform float uTime;
varying vec2 vUv;
varying float vA;
varying float vSeed;
void main() {
  float size = aData.x;
  float seed = aData.z;
  vec3 c = aOffset;
  float age = fract( uTime * aData.w + seed );
  float ang = seed * 43.0;
  c += vec3( cos( ang ), 0.0, sin( ang ) ) * age * size * 1.1 + vec3( 0.0, age * size * 1.6, 0.0 );
  size *= 0.45 + age * 0.9;
  float a = sin( age * 3.14159 );
  vec3 transformed = c;
  vec4 mvPosition = viewMatrix * vec4( transformed, 1.0 );
  mvPosition.xy += position.xy * size;
  // A puff the camera is in or near would fill the screen: it thins out first.
  a *= smoothstep( size * 0.8, size * 3.0, -mvPosition.z );
  gl_Position = projectionMatrix * mvPosition;
  // Mist stays a low band (the lower fifth of the frame): a puff that rises
  // into the middle of the view whites it out, so it fades there.
  a *= 1.0 - smoothstep( -0.62, -0.2, gl_Position.y / max( gl_Position.w, 0.001 ) );
  vA = a;
  vUv = position.xy + 0.5;
  vSeed = seed;
  #include <fog_vertex>
}
`;

const MIST_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uLitC, uShadeC;
uniform float uAlpha;
varying vec2 vUv;
varying float vA;
varying float vSeed;
${NOISE_GLSL}
void main() {
  vec2 q = vUv - 0.5;
  float r = length( q ) * 2.0;
  float n = sNoise( q * 4.0 + vSeed * 17.0 );
  float n2 = sNoise( q * 9.0 - vSeed * 11.0 );
  float a = 1.0 - smoothstep( 0.1, 1.0, r + ( n - 0.5 ) * 0.45 + ( n2 - 0.5 ) * 0.15 );
  a = a * a * vA * uAlpha;
  if ( a < 0.004 ) discard;
  vec3 col = mix( uShadeC, uLitC, smoothstep( -0.35, 0.45, q.y + ( n - 0.5 ) * 0.3 ) );
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ── Material hooks ───────────────────────────────────────────────────────────

/**
 * Give a built-in material a shader hook that survives a later assignment of
 * onBeforeCompile (another module's patch): the later hook runs first, ours
 * after it, and the program cache key stays unique to this material.
 */
function chainCompile(mat: THREE.Material, own: (shader: THREE.WebGLProgramParametersWithUniforms) => void, key: string) {
  let extra: ((s: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => void) | null = null;
  const run = (s: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => {
    if (extra) extra(s, r);
    own(s);
  };
  Object.defineProperty(mat, "onBeforeCompile", {
    configurable: true,
    enumerable: true,
    get: () => run,
    set: (fn) => {
      extra = typeof fn === "function" && fn !== run ? fn : null;
    },
  });
  mat.customProgramCacheKey = () => key + (extra ? "+ext" : "");
}

// ── Ribbons: the river, the stream, the brook ────────────────────────────────

interface RibbonSpec {
  pts: ReadonlyArray<readonly [number, number, number]>;
  halfW: (along: number) => number;
  /** Water level at a point on the curve (default: the curve's own y). */
  level?: (x: number, y: number, z: number, along: number) => number;
  /** Skip sections where this returns true (inside the pool, at the lip). */
  skip?: (x: number, z: number, along: number) => boolean;
  lift: number;
  /** Ground the ribbon must stay above (default: the terrain as drawn). */
  ground?: (x: number, z: number) => number;
}

function buildRibbon(spec: RibbonSpec, drawnGround: (x: number, z: number) => number): THREE.BufferGeometry | null {
  const ground = spec.ground ?? drawnGround;
  const curve = new THREE.CatmullRomCurve3(spec.pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, "centripetal");
  const len = curve.getLength();
  const n = Math.max(4, Math.round(len / RIBBON_STEP));
  const P = curve.getSpacedPoints(n);
  const ACROSS = [-1, -0.5, 0, 0.5, 1];
  const pos: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];
  let prev = -1;
  let base = 0;
  for (let i = 0; i <= n; i++) {
    const along = i / n;
    const p = P[i];
    const a = P[Math.max(0, i - 1)];
    const c = P[Math.min(n, i + 1)];
    let tx = c.x - a.x;
    let tz = c.z - a.z;
    const L = Math.hypot(tx, tz) || 1;
    tx /= L;
    tz /= L;
    if (spec.skip && spec.skip(p.x, p.z, along)) {
      prev = -1;
      continue;
    }
    const hw = spec.halfW(along);
    const lvl = spec.level ? spec.level(p.x, p.y, p.z, along) : p.y;
    const s = along * len;
    for (const f of ACROSS) {
      const x = p.x - tz * hw * f;
      const z = p.z + tx * hw * f;
      const y = Math.max(lvl, ground(x, z) + spec.lift);
      pos.push(x, y, z);
      flow.push(f, s);
    }
    if (prev >= 0) {
      for (let k = 0; k < ACROSS.length - 1; k++) {
        const i0 = prev + k;
        const i1 = prev + k + 1;
        const i2 = base + k;
        const i3 = base + k + 1;
        idx.push(i0, i2, i1, i1, i2, i3);
      }
    }
    prev = base;
    base += ACROSS.length;
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aFlow", new THREE.Float32BufferAttribute(flow, 2));
  g.setIndex(idx);
  // Make sure every triangle faces up.
  const tri = g.getIndex()!.array as Uint16Array | Uint32Array;
  for (let t = 0; t < tri.length; t += 3) {
    const ia = tri[t] * 3;
    const ib = tri[t + 1] * 3;
    const ic = tri[t + 2] * 3;
    const cy = (pos[ib + 2] - pos[ia + 2]) * (pos[ic] - pos[ia]) - (pos[ib] - pos[ia]) * (pos[ic + 2] - pos[ia + 2]);
    if (cy < 0) {
      const k = tri[t + 1];
      tri[t + 1] = tri[t + 2];
      tri[t + 2] = k;
    }
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ── Contract ─────────────────────────────────────────────────────────────────

/**
 * scene.userData.surfaces, for the other look modules:
 *   groundColorAt(x, z, out)  the terrain's painted albedo there (linear),
 *                             without light: grass or rock by slope, for
 *                             cover blades and rock tints that must sit in it.
 *   setForestMask(fn)         forest.ts hands its density (0..1 at x, z) in;
 *                             the floor under it paints darker and cooler.
 *                             Re-bakes the mask's A channel (~60k calls).
 *   setShadeTexture(tex, b)   forest.ts's baked tree shadows (R8, 1 = lit)
 *                             over bounds b; the terrain darkens up to 35%.
 *   heightTexture / heightBounds   terrain height (half float, the main grid)
 *                             for anything that needs water depth.
 */
export interface SurfacesApi {
  groundColorAt(x: number, z: number, out: THREE.Color): THREE.Color;
  setForestMask(fn: ((x: number, z: number) => number) | null): void;
  setShadeTexture(tex: THREE.Texture | null, bounds?: { minX: number; minZ: number; maxX: number; maxZ: number }): void;
  heightTexture: THREE.DataTexture | null;
  heightBounds: { minX: number; minZ: number; maxX: number; maxZ: number };
}

interface LightStateLike {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  sunEl: number;
  skyHorizon: THREE.Color;
  skyMid: THREE.Color;
  skyTop: THREE.Color;
  haze: THREE.Color;
  hemiIntensity: number;
  water: THREE.Color;
}

// ── Install ──────────────────────────────────────────────────────────────────

export const install: InstallFn = async (ctx: WorldCtx): Promise<WorldModule> => {
  const t0 = performance.now();
  const { root, scene } = ctx;
  root.updateMatrixWorld(true);
  const stats: Record<string, number | string> = {};
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const time = { value: 0 };

  // ── Terrain ────────────────────────────────────────────────────────────────
  const terrainMeshes: THREE.Mesh[] = [];
  for (const name of ["Terrain", "Terrain:falls"]) {
    const o = root.getObjectByName(name) as THREE.Mesh | undefined;
    if (o && o.isMesh) terrainMeshes.push(o);
  }
  const mainMesh = terrainMeshes.find((m) => m.name === "Terrain");
  const patchMesh = terrainMeshes.find((m) => m.name === "Terrain:falls");
  const mainGrid = mainMesh ? gridFrom(mainMesh.geometry) : null;
  const patchGrid = patchMesh ? gridFrom(patchMesh.geometry) : null;
  stats.grid = mainGrid ? `${mainGrid.vx}x${mainGrid.vz}` : "none";
  stats.patchGrid = patchGrid ? `${patchGrid.vx}x${patchGrid.vz}` : "none";
  /** Height as drawn: the falls patch where it has one, the main grid elsewhere, else the heightfield. */
  const drawn = (x: number, z: number) =>
    patchGrid && inGrid(patchGrid, x, z) ? drawnH(patchGrid, x, z) : mainGrid ? drawnH(mainGrid, x, z) : terrainHeight(x, z);
  const smoothH = (x: number, z: number) =>
    patchGrid && inGrid(patchGrid, x, z) ? gridH(patchGrid, x, z) : mainGrid ? gridH(mainGrid, x, z) : terrainHeight(x, z);
  const coarseH = (x: number, z: number) => (mainGrid ? gridH(mainGrid, x, z) : terrainHeight(x, z));

  // Vertex bakes: zone colours, crease, hollow, horizon AO.
  const zoneAt = makeZones();
  const zo: ZoneOut = { grass: new THREE.Color(), rock: new THREE.Color(), wet: 0 };
  const dirs: Array<[number, number]> = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    dirs.push([Math.cos(a), Math.sin(a)]);
  }
  let bakeMs = 0;
  const colorWas = new Map<THREE.BufferGeometry, THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined>();
  for (const m of terrainMeshes) {
    const a0 = performance.now();
    const g = m.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const n = pos.count;
    const col = new Float32Array(n * 3);
    const rock = new Uint8Array(n * 4);
    const surf = new Int8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      zoneAt(x, z, y, zo);
      col[i * 3] = zo.grass.r;
      col[i * 3 + 1] = zo.grass.g;
      col[i * 3 + 2] = zo.grass.b;
      rock[i * 4] = Math.round(clamp01(zo.rock.r) * 255);
      rock[i * 4 + 1] = Math.round(clamp01(zo.rock.g) * 255);
      rock[i * 4 + 2] = Math.round(clamp01(zo.rock.b) * 255);
      rock[i * 4 + 3] = Math.round(clamp01(zo.wet) * 255);
      let sf = 0;
      let sb = 0;
      let occ = 0;
      for (const [dx, dz] of dirs) {
        sf += smoothH(x + dx * CREASE_R, z + dz * CREASE_R);
        sb += coarseH(x + dx * HOLLOW_R, z + dz * HOLLOW_R);
        let maxT = 0;
        for (const r of AO_STEPS) {
          const t = (coarseH(x + dx * r, z + dz * r) - y - 3) / r;
          if (t > maxT) maxT = t;
        }
        occ += maxT / Math.sqrt(1 + maxT * maxT);
      }
      const fine = (sf / 8 - y) / CREASE_N;
      const broad = (sb / 8 - y) / HOLLOW_N;
      const ao = 1 - 0.95 * (occ / 8);
      surf[i * 4] = Math.round(Math.max(-1, Math.min(1, fine)) * 127);
      surf[i * 4 + 1] = Math.round(Math.max(-1, Math.min(1, broad)) * 127);
      surf[i * 4 + 2] = Math.round(clamp01(ao) * 127);
      surf[i * 4 + 3] = 0;
    }
    colorWas.set(g, g.getAttribute("color"));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aRock", new THREE.BufferAttribute(rock, 4, true));
    g.setAttribute("aSurf", new THREE.BufferAttribute(surf, 4, true));
    bakeMs += performance.now() - a0;
    await yieldTask();
  }
  stats.vertexBakeMs = Math.round(bakeMs);

  // The mask texture.
  const MB: MaskBounds = { minX: WORLD.minX, minZ: WORLD.minZ, w: WORLD.maxX - WORLD.minX, d: WORLD.maxZ - WORLD.minZ };
  const m0 = performance.now();
  const maskData = buildMask(MB, null);
  const maskTex = new THREE.DataTexture(maskData, MASK_RES, MASK_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
  maskTex.minFilter = THREE.LinearFilter;
  maskTex.magFilter = THREE.LinearFilter;
  maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
  maskTex.generateMipmaps = false;
  maskTex.colorSpace = THREE.NoColorSpace;
  maskTex.needsUpdate = true;
  texs.push(maskTex);
  stats.maskMs = Math.round(performance.now() - m0);
  await yieldTask();

  // Height texture from the main grid (for water depth).
  let heightTex: THREE.DataTexture | null = null;
  const hb = mainGrid
    ? { minX: mainGrid.minX, minZ: mainGrid.minZ, maxX: mainGrid.minX + mainGrid.sx * (mainGrid.vx - 1), maxZ: mainGrid.minZ + mainGrid.sz * (mainGrid.vz - 1) }
    : { minX: WORLD.minX, minZ: WORLD.minZ, maxX: WORLD.maxX, maxZ: WORLD.maxZ };
  if (mainGrid) {
    const hd = new Uint16Array(mainGrid.h.length);
    for (let k = 0; k < hd.length; k++) hd[k] = THREE.DataUtils.toHalfFloat(mainGrid.h[k]);
    heightTex = new THREE.DataTexture(hd, mainGrid.vx, mainGrid.vz, THREE.RedFormat, THREE.HalfFloatType);
    heightTex.minFilter = THREE.LinearFilter;
    heightTex.magFilter = THREE.LinearFilter;
    heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
    heightTex.generateMipmaps = false;
    heightTex.colorSpace = THREE.NoColorSpace;
    heightTex.needsUpdate = true;
    texs.push(heightTex);
  }
  // Texel centres sit on the grid vertices: map world -> uv with a half-texel inset.
  const hbU = new THREE.Vector4();
  if (mainGrid) {
    const W = hb.maxX - hb.minX;
    const D = hb.maxZ - hb.minZ;
    // uv = ((x - minX) / W * (vx - 1) + 0.5) / vx  =  (x - (minX - 0.5 * W / (vx - 1))) * ((vx - 1) / (W * vx))
    const ox = hb.minX - (0.5 * W) / (mainGrid.vx - 1);
    const oz = hb.minZ - (0.5 * D) / (mainGrid.vz - 1);
    hbU.set(ox, oz, (mainGrid.vx - 1) / (W * mainGrid.vx), (mainGrid.vz - 1) / (D * mainGrid.vz));
  } else {
    hbU.set(hb.minX, hb.minZ, 1 / (hb.maxX - hb.minX), 1 / (hb.maxZ - hb.minZ));
  }

  const sunDirS = ctx.sunDir.clone().normalize();
  const whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  whiteTex.needsUpdate = true;
  texs.push(whiteTex);
  const tU = {
    uMask: { value: maskTex },
    uMaskB: { value: new THREE.Vector4(MB.minX, MB.minZ, 1 / MB.w, 1 / MB.d) },
    uShadeTex: { value: whiteTex as THREE.Texture },
    uShadeB: { value: new THREE.Vector4(0, 0, 1, 1) },
    uShadeOn: { value: 0 },
    uSand: { value: lin(PAL.sand) },
    uWetSand: { value: lin(PAL.wetSand) },
    uPath: { value: lin(PAL.path) },
    uPathEdge: { value: lin(PAL.pathEdge) },
    uVerge: { value: lin(PAL.verge) },
    uBank: { value: lin(PAL.bank) },
    uWorn: { value: lin(PAL.worn) },
    uMoss: { value: lin(PAL.moss) },
    uRockHigh: { value: lin(PAL.rockHigh) },
    uForestFloor: { value: lin(PAL.forestFloor) },
    uDry: { value: lin(PAL.dry) },
    uSunDirS: { value: sunDirS },
    uLake: { value: new THREE.Vector4(WORLD.lake.x, WORLD.lake.z, WORLD.lake.r, WORLD.lake.y) },
  };
  const terrainMat = new THREE.MeshLambertMaterial({ name: "SurfTerrain", vertexColors: true });
  chainCompile(
    terrainMat,
    (shader) => {
      Object.assign(shader.uniforms, tU);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\n" + TERRAIN_VERT_PARS)
        .replace("#include <fog_vertex>", "#include <fog_vertex>\n" + TERRAIN_VERT_MAIN);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\n" + TERRAIN_FRAG_PARS)
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = paintTerrain( diffuseColor.rgb );");
    },
    "surf-terrain-v5",
  );
  mats.push(terrainMat);
  const terrainWas = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  for (const m of terrainMeshes) {
    terrainWas.set(m, m.material);
    m.material = terrainMat;
  }

  // ── The Mirror Lake's terrain (light.ts REFLECT_ONLY_LAYER) ────────────────
  // The lake's reflection pass redraws everything it sees, and the full grid is
  // 170k triangles, so a5 drew it twice and sat at the 700k cap. The mirror
  // draws every 3rd vertex of the same grid instead: the same vertex buffers
  // and material with only a new index, about 19k triangles. The full grid
  // goes on NO_REFLECT_LAYER. The falls patch is 1.5 km from the lake and
  // never in the mirror, so it keeps its layer. Only when light.ts is installed
  // (its lake exists and the main camera sees NO_REFLECT_LAYER).
  let mirrorTerrain: THREE.Mesh | null = null;
  const mainLayersWas = mainMesh ? mainMesh.layers.mask : 0;
  if (mainMesh && mainGrid && mainMesh.parent && scene.getObjectByName("MirrorLake") && ctx.camera.layers.isEnabled(NO_REFLECT_LAYER)) {
    const S = 3;
    const { vx, vz } = mainGrid;
    const pick = (n: number) => {
      const out: number[] = [];
      for (let i = 0; i < n - 1; i += S) out.push(i);
      out.push(n - 1);
      return out;
    };
    const cols = pick(vx);
    const rows = pick(vz);
    const idx = new Uint32Array((cols.length - 1) * (rows.length - 1) * 6);
    let o = 0;
    for (let r = 0; r < rows.length - 1; r++) {
      for (let c = 0; c < cols.length - 1; c++) {
        const a = rows[r] * vx + cols[c];
        const b = rows[r] * vx + cols[c + 1];
        const cc = rows[r + 1] * vx + cols[c];
        const d = rows[r + 1] * vx + cols[c + 1];
        idx[o++] = a;
        idx[o++] = cc;
        idx[o++] = b;
        idx[o++] = b;
        idx[o++] = cc;
        idx[o++] = d;
      }
    }
    const src = mainMesh.geometry;
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    if (!src.boundingSphere) src.computeBoundingSphere();
    g.boundingSphere = src.boundingSphere!.clone();
    mirrorTerrain = new THREE.Mesh(g, terrainMat);
    mirrorTerrain.name = "Terrain:mirror";
    mirrorTerrain.position.copy(mainMesh.position);
    mirrorTerrain.quaternion.copy(mainMesh.quaternion);
    mirrorTerrain.scale.copy(mainMesh.scale);
    mirrorTerrain.layers.set(REFLECT_ONLY_LAYER);
    mainMesh.layers.set(NO_REFLECT_LAYER);
    mainMesh.parent.add(mirrorTerrain);
    stats.mirrorTerrainTris = idx.length / 3;
  }

  // ── Light-driven colours, read from light.ts's live state ───────────────────
  const lightState = (): LightStateLike | null => {
    const l = scene.userData.light as { state?: LightStateLike } | undefined;
    return l && l.state && l.state.skyHorizon ? l.state : null;
  };
  const skyLo = new THREE.Color(0.8, 0.8, 0.8);
  const skyHi = new THREE.Color(0.5, 0.6, 0.75);
  const sunCol = ctx.sunColor.clone();
  const sunDir = ctx.sunDir.clone().normalize();

  // ── Sea ────────────────────────────────────────────────────────────────────
  const seaMat = new THREE.ShaderMaterial({
    name: "SurfSea",
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSunDir: { value: sunDir },
        uSunCol: { value: sunCol },
        uSkyLo: { value: skyLo },
        uSkyHi: { value: skyHi },
        uDeep: { value: lin(WATER_C.sea) },
        uShallow: { value: lin(WATER_C.seaShallow) },
        uFoam: { value: lin(WATER_C.foam) },
        uHeight: { value: null },
        uHB: { value: hbU },
        uLevel: { value: WORLD.seaLevel },
      },
    ]),
    vertexShader: WATER_VERT,
    fragmentShader: SEA_FRAG,
  });
  // merge() clones values: the shared ones are put back by reference.
  seaMat.uniforms.uTime = time;
  seaMat.uniforms.uHeight.value = heightTex;
  seaMat.uniforms.uSunDir.value = sunDir;
  seaMat.uniforms.uSunCol.value = sunCol;
  seaMat.uniforms.uSkyLo.value = skyLo;
  seaMat.uniforms.uSkyHi.value = skyHi;
  mats.push(seaMat);
  const seaGeo = new THREE.PlaneGeometry(WORLD.maxX - WORLD.minX + 12000, WORLD.maxZ - WORLD.minZ + 12000, 1, 1);
  seaGeo.rotateX(-Math.PI / 2);
  geos.push(seaGeo);
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.name = "Sea";
  sea.position.set((WORLD.minX + WORLD.maxX) / 2, WORLD.seaLevel, (WORLD.minZ + WORLD.maxZ) / 2);
  root.add(sea);

  // ── Flowing water: river, stream, brook ────────────────────────────────────
  const flowMat = (name: string, speed: number, white: number): THREE.ShaderMaterial => {
    const m = new THREE.ShaderMaterial({
      name,
      fog: true,
      transparent: true,
      depthWrite: false,
      defines: { FLOW: "" },
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uSpeed: { value: speed },
          uWhite: { value: white },
          uSunDir: { value: sunDir },
          uSunCol: { value: sunCol },
          uSkyLo: { value: skyLo },
          uSkyHi: { value: skyHi },
          uBody: { value: lin(WATER_C.river) },
          uFoam: { value: lin(WATER_C.foam) },
        },
      ]),
      vertexShader: WATER_VERT,
      fragmentShader: FLOW_FRAG,
    });
    m.uniforms.uTime = time;
    m.uniforms.uSunDir.value = sunDir;
    m.uniforms.uSunCol.value = sunCol;
    m.uniforms.uSkyLo.value = skyLo;
    m.uniforms.uSkyHi.value = skyHi;
    mats.push(m);
    return m;
  };
  const ribbons: THREE.Mesh[] = [];
  const pool = WORLD.pool;
  const F = WORLD.falls;
  const addRibbon = (name: string, spec: RibbonSpec, mat: THREE.ShaderMaterial) => {
    const g = buildRibbon(spec, drawn);
    if (!g) return;
    geos.push(g);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    mesh.renderOrder = 1;
    root.add(mesh);
    ribbons.push(mesh);
    stats[`${name}Tris`] = (g.index ? g.index.count : 0) / 3;
  };
  const r0 = performance.now();
  addRibbon(
    "River",
    {
      pts: RIVER,
      halfW: () => RIVER_HW,
      lift: 0.5,
      skip: (x, z) => Math.hypot(x - pool.x, z - pool.z) < pool.r - 6,
    },
    flowMat("SurfRiver", 26, 0.12),
  );
  addRibbon(
    "Stream",
    {
      pts: STREAM,
      halfW: (a) => Math.min(48, streamHalfW(a) - 1),
      lift: 0.5,
      // Stop short of the lip: the curtain's own approach takes over there.
      skip: (x, z) => Math.hypot(x - F.top[0], z - F.top[2]) < 26,
    },
    flowMat("SurfStream", 34, 0.22),
  );
  addRibbon(
    "Brook",
    {
      pts: BROOK,
      // Laid over blocks.ts's grey brook (bilinear grid + 1.2), a little above and wider.
      halfW: (a) => brookHalfW(a) + 1.5,
      lift: 1.4,
      ground: coarseH,
      level: (x, y, z) => Math.max(y + 0.6, coarseH(x, z) + 1.4),
      skip: (x, z) => Math.hypot(x - WORLD.lake.x, z - WORLD.lake.z) < WORLD.lake.r - 4,
    },
    flowMat("SurfBrook", 18, 0.1),
  );
  stats.ribbonMs = Math.round(performance.now() - r0);

  // ── The Mirror Lake: a shore band (the reflection stays light.ts's) ────────
  let lakePatched = false;
  const lakeMesh = scene.getObjectByName("MirrorLake") as THREE.Mesh | undefined;
  const lakeMat = lakeMesh?.material as THREE.ShaderMaterial | undefined;
  if (lakeMat && (lakeMat as THREE.ShaderMaterial).isShaderMaterial && heightTex) {
    const fs = lakeMat.fragmentShader;
    const anchor = "#include <tonemapping_fragment>";
    if (fs.includes(anchor) && /varying\s+vec3\s+vWorld\s*;/.test(fs) && !fs.includes("uSurfLakeY")) {
      lakeMat.uniforms.uSurfHeight = { value: heightTex };
      lakeMat.uniforms.uSurfHB = { value: hbU };
      lakeMat.uniforms.uSurfLakeY = { value: WORLD.lake.y };
      lakeMat.uniforms.uSurfShore = { value: lin(WATER_C.shore) };
      lakeMat.uniforms.uSurfLine = { value: skyLo };
      const pars = `
uniform sampler2D uSurfHeight;
uniform vec4 uSurfHB;
uniform float uSurfLakeY;
uniform vec3 uSurfShore;
uniform vec3 uSurfLine;
float surfHash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float surfNoise( vec2 p ) { vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( surfHash( i ), surfHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( surfHash( i + vec2( 0.0, 1.0 ) ), surfHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y ); }
`;
      const body = `
  {
    // surfaces.ts: the lake's shore. Shallow water reflects less and shows a
    // dark bed; a thin pale line where the grass meets the water.
    vec2 surfUv = ( vWorld.xz - uSurfHB.xy ) * uSurfHB.zw;
    float surfG = texture2D( uSurfHeight, surfUv ).r;
    float surfDep = uSurfLakeY - surfG;
    float surfN = surfNoise( vWorld.xz * 0.045 );
    float surfSh = 1.0 - smoothstep( 0.0, 5.0 + 4.0 * surfN, surfDep );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, uSurfShore, surfSh * 0.45 );
    float surfLine = ( 1.0 - smoothstep( 0.0, 0.9 + 0.8 * surfN, abs( surfDep - 0.6 ) ) ) * smoothstep( 0.35, 0.7, surfNoise( vWorld.xz * 0.12 ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, uSurfLine, surfLine * 0.3 );
  }
  `;
      lakeMat.fragmentShader = fs
        .replace("void main()", pars + "\nvoid main()")
        .replace(anchor, body + anchor);
      lakeMat.needsUpdate = true;
      lakePatched = true;
    }
  }
  stats.lakeShore = lakePatched ? "patched" : "untouched";

  // ── The falls, the pool and the spray: adopted from blocks.ts ─────────────
  const curtainU = {
    uSunSide: { value: 0 },
    uSunFront: { value: 0.3 },
    uDay: { value: 1 },
    uLit: { value: lin(WATER_C.curtainLit) },
    uShade: { value: lin(WATER_C.curtainShade) },
    uSky: { value: skyLo },
    uFoamC: { value: lin(WATER_C.foam) },
    uGlow: { value: GLOW_DAY.clone() },
  };
  const mistU = { uLitC: { value: new THREE.Color(0.85, 0.83, 0.78) }, uShadeC: { value: new THREE.Color(0.5, 0.55, 0.6) }, uAlpha: { value: 0.11 } };
  const poolU = {
    uDeep: { value: lin(WATER_C.pool) },
    uFoam: { value: lin(WATER_C.foam) },
    uSky: { value: skyLo },
    uPool: { value: new THREE.Vector3(pool.x, pool.z, pool.r) },
  };
  const adopted = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const backU = { value: 0 };
  const fallsMeshes: THREE.Mesh[] = [];
  let curtainMat: THREE.ShaderMaterial | null = null;
  let adoptTries = 0;
  const adoptDone = { curtain: false, island: false, pool: false, spray: false };

  const shareUniform = (from: THREE.Material | THREE.Material[], name: string, fallback: { value: unknown }) => {
    const m = from as THREE.ShaderMaterial;
    return m && m.uniforms && m.uniforms[name] ? m.uniforms[name] : fallback;
  };

  function adopt() {
    if (adoptDone.curtain && adoptDone.island && adoptDone.pool && adoptDone.spray) return;
    adoptTries++;
    const find = (name: string) => {
      const o = root.getObjectByName(name) as THREE.Mesh | undefined;
      return o && o.isMesh ? o : undefined;
    };
    for (const [key, name] of [
      ["curtain", "Landmark_a3_Water"],
      ["island", "IslandFalls"],
    ] as const) {
      if (adoptDone[key]) continue;
      const mesh = find(name);
      if (!mesh || !mesh.geometry.getAttribute("aDrop") || !mesh.geometry.getAttribute("aSheet")) continue;
      if (!curtainMat) {
        const was = mesh.material;
        curtainMat = new THREE.ShaderMaterial({
          name: "SurfCurtain",
          fog: true,
          transparent: true,
          // Nearly opaque: it writes depth, so the spray beyond it (seen from
          // the cave) does not blend over it as a grey veil.
          depthWrite: true,
          side: THREE.DoubleSide,
          uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, curtainU]),
          vertexShader: CURTAIN_VERT,
          fragmentShader: CURTAIN_FRAG,
        });
        Object.assign(curtainMat.uniforms, curtainU);
        // blocks.ts keeps driving these every frame (its clock, its "behind" test).
        // blocks.ts keeps driving the clock; "seen from behind" is computed here (update()).
        curtainMat.uniforms.uTime = shareUniform(was, "uTime", { value: 0 }) as { value: number };
        curtainMat.uniforms.uBack = backU;
        mats.push(curtainMat);
      }
      adopted.set(mesh, mesh.material);
      mesh.material = curtainMat;
      fallsMeshes.push(mesh);
      adoptDone[key] = true;
    }
    if (!adoptDone.pool) {
      const mesh = find("Pool");
      if (mesh) {
        const was = mesh.material;
        const m = new THREE.ShaderMaterial({
          name: "SurfPool",
          fog: true,
          uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uImpact: { value: new THREE.Vector2(F.bottom[0], F.bottom[2] + 4) } }, poolU]),
          vertexShader: WATER_VERT,
          fragmentShader: POOL_FRAG,
        });
        Object.assign(m.uniforms, poolU);
        m.uniforms.uTime = shareUniform(was, "uTime", time) as { value: number };
        const imp = shareUniform(was, "uImpact", { value: null }) as { value: THREE.Vector2 | null };
        if (imp.value) m.uniforms.uImpact = imp;
        mats.push(m);
        adopted.set(mesh, was);
        mesh.material = m;
        adoptDone.pool = true;
      }
    }
    if (!adoptDone.spray) {
      const mesh = find("FallsSpray");
      if (mesh && mesh.geometry.getAttribute("aOffset") && mesh.geometry.getAttribute("aData")) {
        const was = mesh.material;
        const m = new THREE.ShaderMaterial({
          name: "SurfMist",
          fog: true,
          transparent: true,
          depthWrite: false,
          uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }, mistU]),
          vertexShader: MIST_VERT,
          fragmentShader: MIST_FRAG,
        });
        Object.assign(m.uniforms, mistU);
        m.uniforms.uTime = shareUniform(was, "uTime", time) as { value: number };
        mats.push(m);
        adopted.set(mesh, was);
        mesh.material = m;
        adoptDone.spray = true;
      }
    }
    // blocks.ts installs right after this module; stop looking after a while.
    if (adoptTries > 600) adoptDone.curtain = adoptDone.island = adoptDone.pool = adoptDone.spray = true;
  }

  // ── Per-frame light ────────────────────────────────────────────────────────
  const tmpC = new THREE.Color();
  const across = new THREE.Vector2(-1, 0); // the main sheet's across direction (blocks.ts mainSheet)
  let lastSig = NaN;
  function applyLight(): boolean {
    const s = lightState();
    const sd = s ? s.sunDir : ctx.sunDir;
    const sc = s ? s.sunColor : ctx.sunColor;
    const sig = sd.x * 7.1 + sd.y * 3.3 + sd.z * 1.7 + sc.r * 2.9 + sc.g * 5.3 + (s ? s.skyHorizon.r * 11 + s.haze.g * 13 : 0);
    if (sig === lastSig) return false;
    lastSig = sig;
    sunDir.copy(sd).normalize();
    sunDirS.copy(sunDir);
    const dayK = s ? clamp01((s.sunIntensity / 4.5) * smooth(-3, 6, s.sunEl)) : 1;
    sunCol.copy(sc).multiplyScalar(0.35 + 0.9 * dayK);
    if (s) {
      skyLo.copy(s.skyHorizon).lerp(s.haze, 0.35);
      skyHi.copy(s.skyMid).lerp(s.skyTop, 0.5);
    } else {
      skyLo.copy(ctx.hazeColor);
      skyHi.copy(ctx.hazeColor).multiplyScalar(0.8);
    }
    // The curtain: faces south (+z); the sun side runs across it.
    const front = sunDir.z;
    const sideLen = Math.hypot(sunDir.x, sunDir.z) || 1;
    curtainU.uSunFront.value = 0.15 + 0.55 * smooth(-0.5, 0.6, front) * dayK;
    curtainU.uSunSide.value = ((sunDir.x * across.x + sunDir.z * across.y) / sideLen) * 0.9 * dayK;
    curtainU.uDay.value = 0.3 + 0.7 * (s ? clamp01(0.35 * s.hemiIntensity + 0.75 * dayK) : 1);
    curtainU.uLit.value.copy(lin(WATER_C.curtainLit)).lerp(tmpC.copy(sc).multiplyScalar(0.95), 0.2);
    curtainU.uShade.value.copy(lin(WATER_C.curtainShade)).lerp(skyLo, 0.25);
    // The day beyond the curtain, seen from the cave: the sky's own colour, lifted to read as light.
    curtainU.uGlow.value.copy(GLOW_DAY);
    mistU.uLitC.value.copy(curtainU.uLit.value).multiplyScalar(0.9 * curtainU.uDay.value);
    mistU.uShadeC.value.copy(curtainU.uShade.value).multiplyScalar(0.85 * curtainU.uDay.value);
    const sl = s ? s.water : null;
    if (sl) (seaMat.uniforms.uDeep.value as THREE.Color).copy(lin(WATER_C.sea)).lerp(sl, 0.4);
    return true;
  }
  applyLight();

  // ── Water on screen: only then does the clock move ─────────────────────────
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const camPos = new THREE.Vector3();
  const onScreen = (m: THREE.Mesh) => {
    if (!m.visible || !m.parent) return false;
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    sphere.copy(g.boundingSphere!).applyMatrix4(m.matrixWorld);
    return frustum.intersectsSphere(sphere);
  };
  let animating = false;

  // ── Contract ───────────────────────────────────────────────────────────────
  let forestFn: ((x: number, z: number) => number) | null = null;
  // Set when another module hands in a map, so the next frame redraws the terrain.
  let apiDirty = false;
  const api: SurfacesApi = {
    groundColorAt(x, z, out) {
      const h = terrainHeight(x, z);
      zoneAt(x, z, h, zo);
      const e = 4;
      const gx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
      const gz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
      const ny = 1 / Math.hypot(gx, 1, gz);
      const rock = smooth(0.28, 0.42, 1 - ny);
      out.copy(zo.grass).lerp(zo.rock, rock);
      if (forestFn) out.lerp(lin(PAL.forestFloor), clamp01(forestFn(x, z)) * 0.8);
      out.multiplyScalar(0.72 + 0.28 * smooth(0.62, 0.93, ny));
      return out;
    },
    setForestMask(fn) {
      forestFn = fn;
      fillForest(maskData, MB, fn);
      maskTex.needsUpdate = true;
      apiDirty = true;
    },
    setShadeTexture(tex, b) {
      tU.uShadeTex.value = tex ?? whiteTex;
      tU.uShadeOn.value = tex ? 1 : 0;
      if (b) tU.uShadeB.value.set(b.minX, b.minZ, 1 / (b.maxX - b.minX), 1 / (b.maxZ - b.minZ));
      apiDirty = true;
    },
    heightTexture: heightTex,
    heightBounds: hb,
  };
  scene.userData.surfaces = api;

  stats.installMs = Math.round(performance.now() - t0);
  stats.drawCallsAdded = 1 + ribbons.length;
  stats.textureKB = Math.round((MASK_RES * MASK_RES * 4 + (mainGrid ? mainGrid.h.length * 2 : 0)) / 1024);

  return {
    name: "surfaces",
    update(t: number): boolean {
      let changed = apiDirty;
      apiDirty = false;
      if (!(adoptDone.curtain && adoptDone.island && adoptDone.pool && adoptDone.spray)) {
        const n0 = adopted.size;
        adopt();
        if (adopted.size !== n0) changed = true;
      }
      if (applyLight()) changed = true;
      const cam = ctx.camera;
      cam.updateMatrixWorld();
      camPos.setFromMatrixPosition(cam.matrixWorld);
      // Behind the curtain (in the cave, looking out) it glows with the day beyond.
      const behind = fallsCurtainAt(Math.min(camPos.y, F.top[1]))[1] - camPos.z;
      const back = Math.abs(camPos.x - F.top[0]) < 220 && camPos.y < 260 ? smooth(-2, 14, behind) : 0;
      if (back !== backU.value) {
        backU.value = back;
        changed = true;
      }
      if (ctx.reducedMotion) {
        animating = false;
        return changed;
      }
      pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      // The sea only near the coast (its quad spans the world); ribbons when in view.
      let moving = camPos.z > 1500 && camPos.y < 900 && onScreen(sea);
      for (const r of ribbons) {
        if (moving) break;
        if (!onScreen(r)) continue; // leaves `sphere` as the ribbon's world bounds
        if (camPos.distanceTo(sphere.center) < sphere.radius + 2500) moving = true;
      }
      animating = moving;
      if (moving) time.value = t;
      return changed || moving;
    },
    isAnimating: () => animating && !ctx.reducedMotion,
    stats: () => ({
      ...stats,
      adopted: [...adopted.keys()].map((m) => m.name).join(",") || "none",
      adoptTries,
    }),
    dispose() {
      if (scene.userData.surfaces === api) delete scene.userData.surfaces;
      if (mirrorTerrain) {
        mirrorTerrain.parent?.remove(mirrorTerrain);
        // Its vertex buffers are the main grid's: drop them from the mirror's
        // geometry first, so disposing it frees only its own index.
        const g = mirrorTerrain.geometry;
        for (const name of Object.keys(g.attributes)) g.deleteAttribute(name);
        g.dispose();
        if (mainMesh) mainMesh.layers.mask = mainLayersWas;
      }
      for (const [m, was] of terrainWas) m.material = was;
      for (const [m, was] of adopted) m.material = was;
      for (const m of terrainMeshes) {
        m.geometry.deleteAttribute("aRock");
        m.geometry.deleteAttribute("aSurf");
        const was = colorWas.get(m.geometry);
        if (was) m.geometry.setAttribute("color", was);
      }
      sea.parent?.remove(sea);
      for (const r of ribbons) r.parent?.remove(r);
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
};
