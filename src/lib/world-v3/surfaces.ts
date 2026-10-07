import * as THREE from "three";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";

/**
 * V3 surfaces: how the ground and the water look.
 *
 *   Terrain  A painted MeshStandardMaterial. Colour comes from world height,
 *            slope and low-frequency noise (olive meadow in the valley, ochre
 *            dry grass higher up, warm grey rock on steep faces, pale snow on
 *            the tops, sand at the shore), then three layers of brush texture
 *            (big soft patches, directional dabs, fine grain; each fades out
 *            before it can alias) and a crease shade baked per vertex from the
 *            heightfield, so valleys and gullies go dark and ridges stay light.
 *            A small mask texture paints a dusty verge along the path and dark
 *            damp banks along the river, which is what makes both lines read.
 *   Path     The glb's Path ribbon, repainted pale warm dirt with worn edges.
 *   Water    One shader for Sea, Lake and Pond (still) and one for the River
 *            (flowing): fresnel toward the sky and haze, a broad sun sheen and
 *            a sparkle glint, slow ripples, shallow water lighter near the
 *            shore and a soft broken foam line where the water meets land. It
 *            reads the terrain height from a half-float texture to know how
 *            deep it is.
 *   River    A new ribbon mesh down the carved channel (ctx.riverXAtZ), its
 *            water level set per section from the channel's own banks. Pale
 *            and bright: the strongest line in the valley.
 *
 * Draw calls: Terrain, Path, Sea, Lake, Pond (all glb meshes, materials
 * swapped) plus the River: one new call.
 *
 * Fog: scene.ts caps fog below 1 by patching every standard material's
 * onBeforeCompile. That patch may run before or after this module installs,
 * so the terrain and path hooks CHAIN with whatever is assigned later (see
 * chainCompile) and apply the same cap themselves when nothing else did. The
 * water is a ShaderMaterial, which scene.ts skips, and caps its own fog.
 */

// ── Palette (sRGB albedo) ────────────────────────────────────────────────────
// Cool, greyed albedo on purpose. The sun is deep orange (linear 1.0, 0.46,
// 0.2), so a warm olive albedo rendered as saturated brown (saturation ~0.7
// measured, against ~0.4 on Astra's hills). A grey-green albedo lands on
// khaki olive where the sun hits and stays cool and desaturated in shade,
// which is the Firewatch split: warm light, cool shadow.

const PAL = {
  meadowDeep: "#3d4f36",
  meadow: "#637a4a",
  meadowSun: "#8a9360",
  dry: "#a09a6a",
  dryLight: "#b8ae80",
  rockDark: "#3b3b38",
  rock: "#6c6b64",
  snow: "#e8ecef",
  sand: "#bdb49a",
  wetSand: "#5f5e52",
  bank: "#2a3a26",
  verge: "#8f9068",
  path: "#d6c8a8",
  pathEdge: "#a09878",
} as const;

// Water (sRGB). The body colours are what the near sea shows when it is not
// reflecting: a dark teal, so the foreground stays the darkest part of the frame.
const WATER = {
  deep: "#1b3238",
  shallow: "#4a6c61",
  riverBody: "#6f8f8c",
  foam: "#f1e6d2",
  skyHigh: "#8fa3b8",
} as const;

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Crease sample radii (world units) and the height differences that count as fully creased. */
const CREASE_R_FINE = 12;
const CREASE_R_BROAD = 42;
const CREASE_NORM_FINE = 4.5;
const CREASE_NORM_BROAD = 16;

/** Height texture: samples per axis (twice the terrain grid, so bilinear matches the mesh). */
const HTEX_X = 385;
const HTEX_Z = 401;

/** Path/river mask: covers |x| <= MASK_HALF_X over the full z range. */
const MASK_HALF_X = 220;
const MASK_W = 256;
const MASK_H = 1024;
const PATH_VERGE = 7;
const RIVER_BANK = 26;

/** River: world fraction range of the carved channel, and the gorge where it narrows. */
const RIVER_T0 = 0.2;
const RIVER_T1 = 0.7;
const GORGE_T0 = 0.445;
const GORGE_T1 = 0.56;
/** Visible half width of the water, and how far past that the ribbon runs under the banks. */
const RIVER_HW = 13;
const RIVER_HW_GORGE = 7;
const RIVER_SKIRT = 12;
/** Painted stream: from the shore (t) up to the channel mouth, and its half width. */
const STREAM_T0 = 0.098;
const STREAM_HW = 3.6;
/** Section spacing along the river, world units. */
const RIVER_STEP = 3;
/** Fog cap for the materials this module compiles itself (scene.ts uses 0.9). */
const FOG_MAX = 0.9;

// ── Small helpers ────────────────────────────────────────────────────────────

const lin = (hex: string) => new THREE.Color(hex); // THREE.Color parses sRGB hex into linear working space

const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Give a standard material a shader hook that survives a later assignment of
 * onBeforeCompile (scene.ts's fog patch). The later hook runs first, ours
 * after it, and the program cache key stays unique to this material.
 */
function chainCompile(
  mat: THREE.Material,
  own: (shader: THREE.WebGLProgramParametersWithUniforms) => void,
  key: string,
) {
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

/** Replace fog_fragment with a capped version, unless another hook already did. */
const CAPPED_FOG = /* glsl */ `
#ifdef USE_FOG
  float sFogFactor = min( uSurfFogMax, smoothstep( fogNear, fogFar, vFogDepth ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, sFogFactor );
#endif`;

// ── GLSL shared by the terrain and path ──────────────────────────────────────

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
  float a = sHash( i );
  float b = sHash( i + vec2( 1.0, 0.0 ) );
  float c = sHash( i + vec2( 0.0, 1.0 ) );
  float d = sHash( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
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

// ── Terrain ──────────────────────────────────────────────────────────────────

const TERRAIN_VERT_PARS = /* glsl */ `
attribute vec2 aShade;
varying vec2 vShade;
varying vec3 vSW;
varying vec3 vSN;
`;

const TERRAIN_VERT_MAIN = /* glsl */ `
vShade = aShade;
vSW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vSN = normalize( mat3( modelMatrix ) * objectNormal );
`;

const TERRAIN_FRAG_PARS = /* glsl */ `
varying vec2 vShade;
varying vec3 vSW;
varying vec3 vSN;
uniform float uSurfFogMax;
uniform sampler2D uMask;
uniform vec4 uMaskB;
uniform vec3 uMeadowDeep, uMeadow, uMeadowSun, uDry, uDryLight;
uniform vec3 uRockDark, uRock, uSnow, uSand, uWetSand, uBank, uVerge;
uniform vec3 uSunDirS;
uniform vec3 uStreamCol;
uniform vec4 uStreamT;   // outflow start t, channel mouth t, source t, half width
float gStream = 0.0;
${NOISE_GLSL}

// ridge.py's river line, exactly: the stream is drawn from it per pixel so
// its edges stay crisp close to the camera (the mask is ~1.7 units a texel).
float sRiverX( float t ) { return 310.0 * ( sin( 5.2 * t ) * 0.3 + sin( 11.0 * t ) * 0.08 ); }
float sBand( float t, float a, float b, float c, float d ) {
  return smoothstep( a, b, t ) * ( 1.0 - smoothstep( c, d, t ) );
}
float streamAt( vec2 xz ) {
  float t = ( 1000.0 - xz.y ) / 2000.0;
  float outflow = sBand( t, uStreamT.x, uStreamT.x + 0.012, uStreamT.y + 0.008, uStreamT.y + 0.02 );
  float fall = sBand( t, uStreamT.z - 0.012, uStreamT.z - 0.004, uStreamT.z + 0.008, uStreamT.z + 0.016 );
  float on = max( outflow, fall );
  if ( on <= 0.0 ) return 0.0;
  // Slope of the line in x per unit z, for the perpendicular distance.
  float dxdz = -310.0 * ( 0.3 * 5.2 * cos( 5.2 * t ) + 0.08 * 11.0 * cos( 11.0 * t ) ) / 2000.0;
  float d = abs( xz.x - sRiverX( t ) ) / sqrt( 1.0 + dxdz * dxdz );
  float hw = outflow > 0.0 ? uStreamT.w * ( 0.75 + 0.25 * smoothstep( uStreamT.x, uStreamT.y, t ) ) : uStreamT.w * 0.8;
  float aa = max( fwidth( d ), 0.05 );
  return on * ( 1.0 - smoothstep( hw - aa, hw + aa, d ) );
}

vec3 paintTerrain() {
  vec2 xz = vSW.xz;
  float h = vSW.y;
  vec3 N = normalize( vSN );
  float slope = 1.0 - N.y;
  float crease = vShade.x;   // + concave, - convex
  float broad = vShade.y;    // + sits below its surroundings

  // World-units covered by one pixel: every fine layer fades before it aliases.
  float fw = length( fwidth( xz ) );

  // Low-frequency fields, domain warped so patches look brushed, not blobby.
  vec2 warp = vec2( sNoise( xz * 0.0031 + 3.1 ), sNoise( xz * 0.0031 - 7.7 ) ) * 90.0;
  float nLo = sFbm( ( xz + warp ) * 0.0045 );
  float nMid = sNoise( ( xz + warp * 0.4 ) * 0.021 );

  // Meadow: deep in hollows, sunny olive on open rises.
  float open = clamp( 0.5 + 0.5 * ( -crease ) - 0.35 * max( broad, 0.0 ), 0.0, 1.0 );
  vec3 c = mix( uMeadowDeep, uMeadow, smoothstep( 0.2, 0.8, nLo ) );
  c = mix( c, uMeadowSun, smoothstep( 0.55, 0.95, nLo * 0.6 + open * 0.55 ) * 0.7 );

  // Dry grass climbs with height, reaches down onto convex ground.
  float dryH = h + ( nLo - 0.5 ) * 110.0 + ( nMid - 0.5 ) * 30.0 - crease * 22.0;
  float dry = smoothstep( 85.0, 175.0, dryH );
  c = mix( c, mix( uDry, uDryLight, smoothstep( 0.3, 0.8, nMid ) ), dry );

  // Rock on steep faces, and more of it high up.
  float rock = smoothstep( 0.17, 0.30, slope + ( nMid - 0.5 ) * 0.10 );
  rock = max( rock, smoothstep( 235.0, 310.0, h + ( nLo - 0.5 ) * 70.0 ) * 0.85 );
  // Strata: broken bands along the height, so a cliff reads as layered stone
  // instead of a smooth pale sheet where the sun hits it.
  float strata = sNoise( vec2( h * 0.32 + nMid * 2.4, ( xz.x - xz.y ) * 0.012 ) );
  strata = mix( 0.5, smoothstep( 0.3, 0.7, strata ), 1.0 - 0.7 * smoothstep( 1.5, 5.0, fw ) );
  float steep = smoothstep( 0.15, 0.32, slope );
  strata = mix( 0.55, strata, steep );
  vec3 rc = mix( uRockDark, uRock, strata * ( 1.0 - 0.6 * clamp( crease, 0.0, 1.0 ) ) );
  rc *= 0.85 + 0.3 * smoothstep( 0.35, 0.65, nMid );
  c = mix( c, rc, rock );

  // Snow on the high, flatter tops.
  float snow = smoothstep( 250.0, 280.0, h + ( nLo - 0.5 ) * 80.0 + ( nMid - 0.5 ) * 20.0 );
  snow *= 1.0 - smoothstep( 0.18, 0.34, slope );
  c = mix( c, uSnow, snow );

  // Shore: sand above the waterline, wet and dark right at it.
  float shore = smoothstep( 520.0, 640.0, vSW.z );
  float sand = ( 1.0 - smoothstep( 1.0, 2.8, h + ( nMid - 0.5 ) * 1.5 ) ) * shore;
  c = mix( c, uSand, sand );
  c = mix( c, uWetSand, ( 1.0 - smoothstep( -0.4, 1.2, h ) ) * shore );

  // Path verge and river banks from the mask.
  vec2 muv = ( xz - uMaskB.xy ) * uMaskB.zw;
  vec3 mk = ( muv.x > 0.0 && muv.x < 1.0 && muv.y > 0.0 && muv.y < 1.0 ) ? texture2D( uMask, muv ).rgb : vec3( 0.0 );
  c = mix( c, uVerge, mk.r * 0.32 * ( 1.0 - snow ) );
  c = mix( c, uBank, mk.g * 0.75 * ( 1.0 - rock * 0.5 ) );
  // The painted stream: dark bed, bright water added as emission in main().
  gStream = streamAt( xz );
  c = mix( c, uBank * 0.6, gStream );

  // Brush texture. Patches: slow hue and value drift inside the palette.
  float patchN = sNoise( ( xz + warp * 0.7 ) * 0.012 );
  c *= mix( vec3( 0.93, 0.95, 1.0 ), vec3( 1.06, 1.02, 0.94 ), patchN );
  // Dabs: elongated across the valley, ~40 x 9 units.
  // Dabs: ~30 x 12 units, leaning across the valley.
  float dab = sNoise( vec2( xz.x * 0.045 + nMid * 1.7, xz.y * 0.075 + xz.x * 0.02 ) );
  c *= 1.0 + ( dab - 0.5 ) * 0.08 * ( 1.0 - smoothstep( 1.4, 3.2, fw ) );
  // Grain: fine directional strokes, ~12 x 2 units, near the camera only.
  float grain = sNoise( vec2( xz.x * 0.085 + dab * 2.0, xz.y * 0.5 ) );
  c *= 1.0 + ( grain - 0.5 ) * 0.06 * ( 1.0 - smoothstep( 0.35, 0.9, fw ) );

  // Crease shade: gullies and hollows dark, ridges lifted.
  c *= mix( 1.0, 0.58, clamp( crease, 0.0, 1.0 ) );
  c *= 1.0 + 0.10 * clamp( -crease, 0.0, 1.0 );
  c *= 1.0 - ( 0.28 + 0.2 * rock ) * clamp( broad, 0.0, 1.0 );

  // Faces turned from the sun lose a little saturation: shadows go cool and
  // grey instead of saturated. The light itself belongs to atmosphere.ts.
  float away = 1.0 - smoothstep( -0.35, 0.15, dot( N, uSunDirS ) );
  c = mix( c, vec3( sLuma( c ) ) * vec3( 0.96, 1.0, 1.04 ), away * 0.3 );
  return c;
}
`;

// ── Path ─────────────────────────────────────────────────────────────────────

const PATH_VERT_PARS = /* glsl */ `
attribute float aLat;
varying float vLat;
varying vec3 vPW;
`;
const PATH_VERT_MAIN = /* glsl */ `
vLat = aLat;
vPW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;
const PATH_FRAG_PARS = /* glsl */ `
varying float vLat;
varying vec3 vPW;
uniform float uSurfFogMax;
uniform vec3 uPath, uPathEdge;
${NOISE_GLSL}
vec3 paintPath() {
  float a = abs( vLat );
  float fw = length( fwidth( vPW.xz ) );
  vec3 c = mix( uPath, uPathEdge, smoothstep( 0.45, 1.0, a ) );
  // Two worn tracks and dusty grain along the direction of travel.
  float ruts = 1.0 - smoothstep( 0.0, 0.12, abs( a - 0.42 ) );
  c *= 1.0 - ruts * 0.08;
  float g = sNoise( vec2( vPW.x * 0.6, vPW.z * 0.08 ) );
  c *= 1.0 + ( g - 0.5 ) * 0.12 * ( 1.0 - smoothstep( 0.4, 1.2, fw ) );
  float p = sNoise( vPW.xz * 0.03 );
  c *= 0.94 + 0.1 * p;
  return c;
}
`;

// ── Water ────────────────────────────────────────────────────────────────────

const WATER_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec2 aFlow;
attribute vec2 aDir;
varying vec3 vW;
varying vec2 vFlow;
varying vec2 vDir;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vW = wp.xyz;
  vFlow = aFlow;
  vDir = aDir;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const WATER_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uSunDir, uSunCol, uHaze, uSkyHi, uDeep, uShallow, uFoam;
uniform sampler2D uHeight;
uniform vec4 uHB;          // minX, minZ, 1/width, 1/depth
uniform vec2 uHTex;        // texture size
uniform float uF0, uRipple, uBright, uFoamW, uFogMax, uSheen;
varying vec3 vW;
varying vec2 vFlow;
varying vec2 vDir;

float wHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float wNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wHash( i ), wHash( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( wHash( i + vec2( 0.0, 1.0 ) ), wHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
// Gradient of one travelling sine wave: direction d, wavenumber k, slope a, speed w.
vec2 wave( vec2 p, vec2 d, float k, float a, float w, float t ) {
  return d * ( a * cos( dot( d, p ) * k - t * w ) );
}
float groundAt( vec2 xz ) {
  vec2 uv = ( xz - uHB.xy ) * uHB.zw;
  if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) return -1.0e4;
  uv = ( uv * ( uHTex - 1.0 ) + 0.5 ) / uHTex;
  return texture2D( uHeight, uv ).r;
}

void main() {
  vec3 V = normalize( cameraPosition - vW );
  vec2 p = vW.xz;
  float fw = length( fwidth( p ) );
  float t = uTime;

  // Ripples: a few smooth travelling waves (no grid, so no blocky sparkle),
  // their strength drifting over the surface so the pattern never tiles.
  vec2 g = vec2( 0.0 );
#ifdef RIVER
  // Flow frame: s along the river (downstream +), u across. Crests run
  // across the flow and travel downstream.
  vec2 fp = vec2( vFlow.x * 9.0, vFlow.y );
  vec2 gf = vec2( 0.0 );
  gf += wave( fp, normalize( vec2( 0.25, 1.0 ) ), 0.21, 0.10, 1.6, t );
  gf += wave( fp, normalize( vec2( -0.35, 1.0 ) ), 0.37, 0.08, 2.4, t );
  gf += wave( fp, normalize( vec2( 0.8, 1.0 ) ), 0.63, 0.05, 3.1, t );
  vec2 tanW = normalize( vDir + vec2( 1e-5 ) );
  vec2 nrmW = vec2( tanW.y, -tanW.x );
  g = nrmW * gf.x + tanW * gf.y;
  g *= 0.6 + 0.8 * wNoise( vec2( vFlow.x * 1.5, vFlow.y * 0.02 - t * 0.2 ) );
#else
  g += wave( p, normalize( vec2( 1.0, 0.45 ) ), 0.165, 0.05, 0.55, t );
  g += wave( p, normalize( vec2( -0.6, 1.0 ) ), 0.27, 0.07, 0.80, t );
  g += wave( p, normalize( vec2( 0.2, -1.0 ) ), 0.47, 0.07, 1.10, t );
  g += wave( p, normalize( vec2( -1.0, -0.3 ) ), 0.83, 0.05, 1.50, t );
  g *= 0.45 + 1.1 * wNoise( p * 0.012 + vec2( t * 0.01, 0.0 ) );
#endif
  float rip = uRipple * ( 1.0 - 0.8 * smoothstep( 1.5, 8.0, fw ) );
  vec3 N = normalize( vec3( -g.x * rip, 1.0, -g.y * rip ) );

  float NdV = clamp( dot( N, V ), 0.0, 1.0 );
  float F = uF0 + ( 1.0 - uF0 ) * pow( 1.0 - NdV, 4.0 );
  vec3 R = reflect( -V, N );
  float e = max( R.y, 0.0 );
  vec3 sky = mix( uHaze, uSkyHi, smoothstep( 0.0, 0.6, e ) );
  float sunAmt = max( dot( R, uSunDir ), 0.0 );
  // Broad warm sheen toward the sun.
  sky += uSunCol * ( pow( sunAmt, 10.0 ) * uSheen );
  sky *= uBright;

  float ground = groundAt( p );
  float depth = vW.y - ground;
  float shallow = 1.0 - smoothstep( 0.4, 8.0, depth );
  vec3 body = mix( uDeep, uShallow, shallow );

  vec3 col = mix( body, sky, F );
  // Sun glint: a soft lobe plus a tighter one, both from the smooth normal.
  float glint = pow( sunAmt, 220.0 ) * 2.2 + pow( sunAmt, 45.0 ) * 0.22;
  col += uSunCol * glint;

  // Foam: a thin, broken pale line where the water thins out over land.
  float edge = 1.0 - smoothstep( 0.0, uFoamW, depth );
  float fn = wNoise( p * 0.28 + vec2( t * 0.15, -t * 0.11 ) );
  float foam = edge * smoothstep( 0.3, 0.7, fn * 0.6 + edge * 0.6 );
  col = mix( col, uFoam, clamp( foam, 0.0, 1.0 ) * 0.5 );

  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
#ifdef USE_FOG
  float fogFactor = min( uFogMax, smoothstep( fogNear, fogFar, vFogDepth ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
}
`;

// ── Install ──────────────────────────────────────────────────────────────────

function meshesOf(root: THREE.Object3D, name: string): THREE.Mesh[] {
  const o = root.getObjectByName(name);
  const out: THREE.Mesh[] = [];
  o?.traverse((d) => {
    if ((d as THREE.Mesh).isMesh) out.push(d as THREE.Mesh);
  });
  return out;
}

function disposeMaterial(m: THREE.Material | THREE.Material[]) {
  for (const x of Array.isArray(m) ? m : [m]) x.dispose();
}

/** Terrain bounds from the Terrain mesh (the heightfield clamps outside them). */
function terrainBounds(meshes: THREE.Mesh[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  for (const m of meshes) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(part.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld));
  }
  if (box.isEmpty()) return { minX: -868, maxX: 868, minZ: -1000, maxZ: 1000 };
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
}

/** Per-vertex crease (fine) and hollow (broad) values from the heightfield. */
function bakeShade(mesh: THREE.Mesh, heightAt: (x: number, z: number) => number) {
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  const n = pos.count;
  const out = new Float32Array(n * 2);
  const v = new THREE.Vector3();
  const dirs: Array<[number, number]> = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    dirs.push([Math.cos(a), Math.sin(a)]);
  }
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const h0 = heightAt(v.x, v.z);
    let sf = 0;
    let sb = 0;
    for (const [dx, dz] of dirs) {
      sf += heightAt(v.x + dx * CREASE_R_FINE, v.z + dz * CREASE_R_FINE);
      sb += heightAt(v.x + dx * CREASE_R_BROAD, v.z + dz * CREASE_R_BROAD);
    }
    const fine = (sf / 8 - h0) / CREASE_NORM_FINE;
    const broad = (sb / 8 - h0) / CREASE_NORM_BROAD;
    out[i * 2] = Math.max(-1, Math.min(1, fine));
    out[i * 2 + 1] = Math.max(-1, Math.min(1, broad));
  }
  g.setAttribute("aShade", new THREE.BufferAttribute(out, 2));
}

/** Terrain height as a filterable half-float texture, for the water's depth. */
function buildHeightTexture(
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  heightAt: (x: number, z: number) => number,
): THREE.DataTexture {
  const data = new Uint16Array(HTEX_X * HTEX_Z);
  for (let k = 0; k < HTEX_Z; k++) {
    const z = b.minZ + ((b.maxZ - b.minZ) * k) / (HTEX_Z - 1);
    for (let i = 0; i < HTEX_X; i++) {
      const x = b.minX + ((b.maxX - b.minX) * i) / (HTEX_X - 1);
      data[k * HTEX_X + i] = THREE.DataUtils.toHalfFloat(heightAt(x, z));
    }
  }
  const tex = new THREE.DataTexture(data, HTEX_X, HTEX_Z, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** The river's lateral x at world fraction t (ridge.py river_x, in three units). */
function riverFormula(t: number): number {
  return 310 * (Math.sin(5.2 * t) * 0.3 + Math.sin(11 * t) * 0.08);
}

/**
 * Mask texture over |x| <= MASK_HALF_X: R = near the path, G = near the river
 * (its banks, and the painted stream's). Distances are perpendicular (the
 * lateral offset corrected by the local slope of the line), so a diagonal
 * stretch gets as wide a band as a straight one.
 *
 * The stream: the carved channel ends in a 28-unit wall at t = 0.20 with open
 * meadow between it and the sea, and in a 20-unit cliff at t = 0.70. A mesh
 * cannot climb either cleanly, so the river's outflow to the sea and the fall
 * at its source are painted on the ground instead, as bright water: the
 * terrain shader draws them from the river formula (streamAt); this mask
 * only darkens their banks.
 */
function buildMask(
  pathXAtZ: (z: number) => number,
  riverXAtZ: (z: number) => number,
  pathHalfWidth: number,
  inWater: (x: number, z: number) => boolean,
): THREE.DataTexture {
  const data = new Uint8Array(MASK_W * MASK_H * 4);
  const dz = 2;
  for (let k = 0; k < MASK_H; k++) {
    const z = -1000 + (2000 * (k + 0.5)) / MASK_H;
    const t = (1000 - z) / 2000;
    const px = pathXAtZ(z);
    const ps = (pathXAtZ(z + dz) - pathXAtZ(z - dz)) / (2 * dz);
    const pc = 1 / Math.sqrt(1 + ps * ps);
    const rx = riverXAtZ(z);
    const hasRiver = Number.isFinite(rx);
    let rc = 1;
    let rhw = RIVER_HW;
    let rFade = 0;
    if (hasRiver) {
      const rs = (riverXAtZ(z + dz) - riverXAtZ(z - dz)) / (2 * dz);
      rc = Number.isFinite(rs) ? 1 / Math.sqrt(1 + rs * rs) : 1;
      rhw = riverHalfWidth(t);
      rFade = smooth(RIVER_T0, RIVER_T0 + 0.02, t) * (1 - smooth(RIVER_T1 - 0.02, RIVER_T1, t));
    }
    // Stream: outflow to the sea, and the fall at the source.
    const sx = riverFormula(t);
    const ss = (riverFormula((1000 - (z + dz)) / 2000) - riverFormula((1000 - (z - dz)) / 2000)) / (2 * dz);
    const sc = 1 / Math.sqrt(1 + ss * ss);
    const outflow = smooth(STREAM_T0, STREAM_T0 + 0.012, t) * (1 - smooth(RIVER_T0 + 0.008, RIVER_T0 + 0.02, t));
    const fall = smooth(RIVER_T1 - 0.012, RIVER_T1 - 0.004, t) * (1 - smooth(RIVER_T1 + 0.008, RIVER_T1 + 0.016, t));
    const streamOn = Math.max(outflow, fall);
    const shw = outflow > 0 ? STREAM_HW * (0.75 + 0.25 * smooth(STREAM_T0, RIVER_T0, t)) : STREAM_HW * 0.8;
    for (let i = 0; i < MASK_W; i++) {
      const x = -MASK_HALF_X + (2 * MASK_HALF_X * (i + 0.5)) / MASK_W;
      const o = (k * MASK_W + i) * 4;
      const dp = Math.abs(x - px) * pc;
      data[o] = Math.round(255 * (1 - smooth(pathHalfWidth * 0.8, pathHalfWidth + PATH_VERGE, dp)));
      if (hasRiver && rFade > 0 && !inWater(x, z)) {
        const dr = Math.abs(x - rx) * rc;
        data[o + 1] = Math.round(255 * rFade * (1 - smooth(rhw * 0.5, rhw + RIVER_BANK, dr)));
      }
      if (streamOn > 0) {
        const ds = Math.abs(x - sx) * sc;
        // The stream itself is drawn analytically in the shader (streamAt);
        // the mask only darkens its banks.
        data[o + 1] = Math.max(data[o + 1], Math.round(255 * streamOn * (1 - smooth(shw, shw + 10, ds)) * 0.8));
      }
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, MASK_W, MASK_H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Visible half width of the river at world fraction t: narrow through the gorge. */
function riverHalfWidth(t: number): number {
  const gorge = smooth(GORGE_T0 - 0.02, GORGE_T0 + 0.01, t) * (1 - smooth(GORGE_T1 - 0.01, GORGE_T1 + 0.02, t));
  return RIVER_HW + (RIVER_HW_GORGE - RIVER_HW) * gorge;
}

/**
 * The ground as the MESH draws it. The heightfield is bilinear, but the mesh
 * splits each grid cell into two triangles, which can sit a unit or two above
 * or below the bilinear surface on rough ground. Not knowing the diagonal,
 * this returns the lower of the two possible triangulations, so anything put
 * at surfaceMin - e is guaranteed under the drawn ground.
 */
function makeSurfaceMin(
  terrain: THREE.Mesh[],
  heightAt: (x: number, z: number) => number,
): (x: number, z: number) => number {
  const xs: number[] = [];
  const zs: number[] = [];
  const v = new THREE.Vector3();
  for (const m of terrain) {
    const pos = m.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      xs.push(v.x);
      zs.push(v.z);
    }
  }
  const lines = (a: number[]) => {
    const s = Float64Array.from(a).sort();
    let n = s.length ? 1 : 0;
    for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > 1.5) n++;
    return { n, min: s[0], max: s[s.length - 1] };
  };
  const gx = lines(xs);
  const gz = lines(zs);
  if (gx.n < 2 || gz.n < 2 || gx.n * gz.n > xs.length * 1.5) return heightAt;
  const cx = (gx.max - gx.min) / (gx.n - 1);
  const cz = (gz.max - gz.min) / (gz.n - 1);
  return (x: number, z: number) => {
    const fx0 = (x - gx.min) / cx;
    const fz0 = (z - gz.min) / cz;
    const i = Math.max(0, Math.min(gx.n - 2, Math.floor(fx0)));
    const k = Math.max(0, Math.min(gz.n - 2, Math.floor(fz0)));
    const fx = Math.min(1, Math.max(0, fx0 - i));
    const fz = Math.min(1, Math.max(0, fz0 - k));
    const x0 = gx.min + i * cx;
    const z0 = gz.min + k * cz;
    const h00 = heightAt(x0, z0);
    const h10 = heightAt(x0 + cx, z0);
    const h01 = heightAt(x0, z0 + cz);
    const h11 = heightAt(x0 + cx, z0 + cz);
    const a = fx > fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
    const b =
      fx + fz < 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    return Math.min(a, b);
  };
}

interface WaterBody {
  y: number;
  cx: number;
  cz: number;
  rx: number;
  rz: number;
}

/**
 * The river ribbon. Each section is nine vertices across: a skirt, seven
 * across the water, a skirt. The water level is set from the channel's own
 * banks (the lower bank at the water's edge, a little under it), kept between
 * 0.8 and 7 units above the channel floor, and smoothed along the river. The
 * water sits flat at that level; the skirts drop under the drawn ground, so
 * the ribbon's edge is always hidden by the bank instead of floating. Where
 * the river crosses the lake it sinks just under the lake's surface, and at
 * its source it tapers to nothing.
 */
function buildRiver(
  heightAt: (x: number, z: number) => number,
  surfaceMin: (x: number, z: number) => number,
  riverXAtZ: (z: number) => number,
  lakes: WaterBody[],
  seaY: number | null,
  seaZ0: number,
): THREE.BufferGeometry | null {
  const zDown = 1000 - 2000 * (RIVER_T0 + 0.002); // downstream end, just inside the channel
  const zUp = 1000 - 2000 * (RIVER_T1 - 0.002); // upstream end, at the source cliff
  const count = Math.floor((zDown - zUp) / RIVER_STEP) + 1;
  interface Sec {
    x: number;
    z: number;
    tx: number;
    tz: number;
    hw: number;
    level: number;
    s: number;
    lake: number; // 0 outside, else the lake's y
    lakeD: number; // normalised ellipse radius squared
    floor: number;
  }
  const secs: Sec[] = [];
  let arc = 0;
  let px = NaN;
  let pz = NaN;
  // Walk upstream -> downstream (z increasing), so arc length grows with the flow.
  for (let j = 0; j < count; j++) {
    const z = zUp + j * RIVER_STEP;
    const t = (1000 - z) / 2000;
    let x = riverXAtZ(z);
    if (!Number.isFinite(x)) x = riverFormula(t);
    const slope = (riverFormula((1000 - (z + 1)) / 2000) - riverFormula((1000 - (z - 1)) / 2000)) / 2;
    const len = Math.hypot(slope, 1);
    // Downstream tangent (+z), and the normal to its right.
    const tx = slope / len;
    const tz = 1 / len;
    if (Number.isFinite(px)) arc += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
    // Taper over the first 45 units below the source.
    const hw = riverHalfWidth(t) * (0.25 + 0.75 * smooth(0, 45, z - zUp));
    let lake = 0;
    let lakeD = 9;
    for (const l of lakes) {
      const u = (x - l.cx) / l.rx;
      const v = (z - l.cz) / l.rz;
      const d = u * u + v * v;
      if (d < lakeD) {
        lakeD = d;
        lake = l.y;
      }
    }
    const nx = tz;
    const nz = -tx;
    const hL = heightAt(x - nx * hw, z - nz * hw);
    const hR = heightAt(x + nx * hw, z + nz * hw);
    const floor = Math.min(
      heightAt(x, z),
      heightAt(x - nx * hw * 0.4, z - nz * hw * 0.4),
      heightAt(x + nx * hw * 0.4, z + nz * hw * 0.4),
    );
    const level = Math.min(floor + 7, Math.max(Math.min(hL, hR) - 0.3, floor + 0.8));
    secs.push({ x, z, tx, tz, hw, level, s: arc, lake, lakeD, floor });
  }
  if (secs.length < 2) return null;

  // Smooth the level along the river (a moving average over ~33 units), then
  // clamp: above the sea plane where the sea shows in the channel, under the
  // lake's surface where the river runs through the lake.
  const raw = secs.map((q) => q.level);
  const R = 5;
  for (let j = 0; j < secs.length; j++) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, j - R); k <= Math.min(secs.length - 1, j + R); k++) {
      sum += raw[k];
      n++;
    }
    const q = secs[j];
    q.level = sum / n;
    if (seaY !== null && q.z >= seaZ0) q.level = Math.max(q.level, seaY + 1.0);
    // Only where the channel floor is under the lake's surface: over the
    // lake's raised rim the river keeps running and spills in.
    if (q.lakeD < 1.15 && q.floor < q.lake - 0.2) q.level = Math.min(q.level, q.lake - 0.6);
  }

  const ACROSS = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1];
  const nA = ACROSS.length + 2;
  const pos: number[] = [];
  const flow: number[] = [];
  const dir: number[] = [];
  const idx: number[] = [];
  let base = 0;
  let prevOk = false;
  for (let j = 0; j < secs.length; j++) {
    const q = secs[j];
    const nx = q.tz;
    const nz = -q.tx;
    // Through a lake the ribbon runs on just under the lake's surface: where
    // the lake plane is buried by its own shore the river still shows, and
    // where the lake shows it hides the ribbon. No cut end anywhere.
    const ok = true;
    for (let a = 0; a < nA; a++) {
      let off: number;
      let f: number;
      if (a === 0 || a === nA - 1) {
        f = a === 0 ? -1.6 : 1.6;
        off = Math.sign(f) * (q.hw + RIVER_SKIRT);
      } else {
        f = ACROSS[a - 1];
        off = f * q.hw;
      }
      const x = q.x + nx * off;
      const z = q.z + nz * off;
      let y = q.level;
      if (a === 0 || a === nA - 1) y = Math.min(q.level, surfaceMin(x, z) - 0.8);
      pos.push(x, y, z);
      flow.push(f, q.s);
      dir.push(q.tx, q.tz);
    }
    if (j > 0 && ok && prevOk) {
      const p0 = base - nA;
      for (let a = 0; a < nA - 1; a++) {
        const i0 = p0 + a;
        const i1 = p0 + a + 1;
        const i2 = base + a;
        const i3 = base + a + 1;
        idx.push(i0, i2, i1, i1, i2, i3); // faces up (+y)
      }
    }
    prevOk = ok;
    base += nA;
  }
  if (idx.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aFlow", new THREE.Float32BufferAttribute(flow, 2));
  g.setAttribute("aDir", new THREE.Float32BufferAttribute(dir, 2));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * The two sky colours the water reflects: just above the horizon, and ~25
 * degrees up. Read from atmosphere.ts's sky when it installed (it goes
 * first), looking straight up the valley so the sun's own glow is left to the
 * water's sheen term; otherwise the haze and a cool grey.
 */
function skyForWater(ctx: WorldCtx): { haze: THREE.Color; skyHi: THREE.Color } {
  const atmo = ctx.scene.userData?.atmosphere as
    | { skyColorAt?: (dir: THREE.Vector3, out: THREE.Color) => THREE.Color }
    | undefined;
  if (atmo && typeof atmo.skyColorAt === "function") {
    try {
      const d = new THREE.Vector3();
      const low = new THREE.Color();
      const high = new THREE.Color();
      const el = (deg: number) => d.set(0, Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180));
      atmo.skyColorAt(el(2), low);
      atmo.skyColorAt(el(25), high);
      if ([low.r, low.g, low.b, high.r, high.g, high.b].every(Number.isFinite)) return { haze: low, skyHi: high };
    } catch {
      // fall through to the stand-in
    }
  }
  const haze = ctx.hazeColor.clone();
  return { haze, skyHi: lin(WATER.skyHigh).lerp(haze, 0.25) };
}

function makeWaterMaterial(
  ctx: WorldCtx,
  heightTex: THREE.DataTexture,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  time: { value: number },
  river: boolean,
): THREE.ShaderMaterial {
  const { haze, skyHi } = skyForWater(ctx);
  const m = new THREE.ShaderMaterial({
    name: river ? "RiverWaterMat" : "StillWaterMat",
    defines: river ? { RIVER: "" } : {},
    fog: true,
    lights: false,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSunDir: { value: ctx.sunDir.clone().normalize() },
        uSunCol: { value: ctx.sunColor.clone() },
        uHaze: { value: haze },
        uSkyHi: { value: skyHi },
        uDeep: { value: lin(river ? WATER.riverBody : WATER.deep) },
        uShallow: { value: lin(WATER.shallow) },
        uFoam: { value: lin(WATER.foam) },
        uHeight: { value: null },
        uHB: { value: new THREE.Vector4(b.minX, b.minZ, 1 / (b.maxX - b.minX), 1 / (b.maxZ - b.minZ)) },
        uHTex: { value: new THREE.Vector2(HTEX_X, HTEX_Z) },
        uF0: { value: river ? 0.62 : 0.1 },
        uRipple: { value: river ? 0.55 : 0.3 },
        uBright: { value: river ? 1.18 : 1.0 },
        uSheen: { value: river ? 0.25 : 0.55 },
        uFoamW: { value: river ? 0.5 : 0.4 },
        uFogMax: { value: FOG_MAX },
        uTime: time,
      },
    ]),
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
  });
  // merge() clones values; the texture and the clock must stay shared.
  m.uniforms.uHeight.value = heightTex;
  m.uniforms.uTime = time;
  return m;
}

export const install: InstallFn = async (ctx: WorldCtx): Promise<WorldModule> => {
  const t0 = performance.now();
  let busy = 0;
  const lap = (f: () => void) => {
    const a = performance.now();
    f();
    busy += performance.now() - a;
  };
  const { root, scene } = ctx;
  root.updateMatrixWorld(true);

  const made: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; textures: THREE.Texture[] } = {
    geometries: [],
    materials: [],
    textures: [],
  };
  const stats: Record<string, number | string> = {};

  // ── Terrain ────────────────────────────────────────────────────────────────
  const terrainMeshes = meshesOf(root, "Terrain");
  const bounds = terrainBounds(terrainMeshes);
  lap(() => {
    for (const m of terrainMeshes) bakeShade(m, ctx.heightAt);
  });
  await yieldTask();

  let heightTex: THREE.DataTexture | null = null;
  lap(() => {
    heightTex = buildHeightTexture(bounds, ctx.heightAt);
    made.textures.push(heightTex);
  });
  await yieldTask();

  // Water bodies from the glb (for keeping river banks out of lakes).
  const bodies: WaterBody[] = [];
  let seaY: number | null = null;
  let seaZ0 = Infinity;
  for (const name of ["Sea", "Lake", "Pond"]) {
    const o = root.getObjectByName(name);
    if (!o) continue;
    const box = new THREE.Box3().setFromObject(o);
    if (box.isEmpty()) continue;
    if (name === "Sea") {
      seaY = box.max.y;
      seaZ0 = box.min.z;
      continue;
    }
    bodies.push({
      y: box.max.y,
      cx: (box.min.x + box.max.x) / 2,
      cz: (box.min.z + box.max.z) / 2,
      rx: (box.max.x - box.min.x) / 2,
      rz: (box.max.z - box.min.z) / 2,
    });
  }
  const inLake = (x: number, z: number) => {
    for (const l of bodies) {
      const u = (x - l.cx) / l.rx;
      const v = (z - l.cz) / l.rz;
      if (u * u + v * v < 1) return true;
    }
    return false;
  };

  // ── Path: measure its half width, give it a lateral coordinate ─────────────
  const pathMeshes = meshesOf(root, "Path");
  let pathHalfWidth = 5;
  lap(() => {
    const lats: number[] = [];
    const v = new THREE.Vector3();
    for (const m of pathMeshes) {
      const pos = m.geometry.getAttribute("position");
      const lat = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        lat[i] = v.x - ctx.pathXAtZ(v.z);
        lats.push(Math.abs(lat[i]));
      }
      m.geometry.setAttribute("aLat", new THREE.BufferAttribute(lat, 1));
    }
    if (lats.length) {
      lats.sort((a, b) => a - b);
      pathHalfWidth = Math.max(2, lats[Math.floor(lats.length * 0.9)]);
      for (const m of pathMeshes) {
        const a = m.geometry.getAttribute("aLat") as THREE.BufferAttribute;
        for (let i = 0; i < a.count; i++) a.setX(i, Math.max(-1, Math.min(1, a.getX(i) / pathHalfWidth)));
        a.needsUpdate = true;
      }
    }
  });
  stats.pathHalfWidth = +pathHalfWidth.toFixed(2);

  let maskTex: THREE.DataTexture | null = null;
  lap(() => {
    maskTex = buildMask(ctx.pathXAtZ, ctx.riverXAtZ, pathHalfWidth, inLake);
    made.textures.push(maskTex);
  });
  await yieldTask();

  const sunDirS = ctx.sunDir.clone().normalize();
  // The painted stream glows the colour the river reflects.
  const streamCol = skyForWater(ctx).haze.multiplyScalar(0.9);
  const fogMaxU = { value: FOG_MAX };

  // Terrain material.
  const terrainMat = new THREE.MeshStandardMaterial({
    name: "SurfTerrainMat",
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const tU = {
    uSurfFogMax: fogMaxU,
    uMask: { value: maskTex },
    uMaskB: { value: new THREE.Vector4(-MASK_HALF_X, -1000, 1 / (2 * MASK_HALF_X), 1 / 2000) },
    uMeadowDeep: { value: lin(PAL.meadowDeep) },
    uMeadow: { value: lin(PAL.meadow) },
    uMeadowSun: { value: lin(PAL.meadowSun) },
    uDry: { value: lin(PAL.dry) },
    uDryLight: { value: lin(PAL.dryLight) },
    uRockDark: { value: lin(PAL.rockDark) },
    uRock: { value: lin(PAL.rock) },
    uSnow: { value: lin(PAL.snow) },
    uSand: { value: lin(PAL.sand) },
    uWetSand: { value: lin(PAL.wetSand) },
    uBank: { value: lin(PAL.bank) },
    uVerge: { value: lin(PAL.verge) },
    uSunDirS: { value: sunDirS },
    uStreamCol: { value: streamCol },
    uStreamT: { value: new THREE.Vector4(STREAM_T0, RIVER_T0, RIVER_T1, STREAM_HW) },
  };
  chainCompile(
    terrainMat,
    (shader) => {
      Object.assign(shader.uniforms, tU);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\n" + TERRAIN_VERT_PARS)
        .replace("#include <fog_vertex>", "#include <fog_vertex>\n" + TERRAIN_VERT_MAIN);
      let fs = shader.fragmentShader
        .replace("#include <common>", "#include <common>\n" + TERRAIN_FRAG_PARS)
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = paintTerrain();")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uStreamCol * gStream;");
      if (fs.includes("#include <fog_fragment>")) fs = fs.replace("#include <fog_fragment>", CAPPED_FOG);
      shader.fragmentShader = fs;
    },
    "surf-terrain-v1",
  );
  made.materials.push(terrainMat);
  for (const m of terrainMeshes) {
    disposeMaterial(m.material);
    m.material = terrainMat;
  }

  // Path material.
  const pathMat = new THREE.MeshStandardMaterial({
    name: "SurfPathMat",
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const pU = { uSurfFogMax: fogMaxU, uPath: { value: lin(PAL.path) }, uPathEdge: { value: lin(PAL.pathEdge) } };
  chainCompile(
    pathMat,
    (shader) => {
      Object.assign(shader.uniforms, pU);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\n" + PATH_VERT_PARS)
        .replace("#include <fog_vertex>", "#include <fog_vertex>\n" + PATH_VERT_MAIN);
      let fs = shader.fragmentShader
        .replace("#include <common>", "#include <common>\n" + PATH_FRAG_PARS)
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = paintPath();");
      if (fs.includes("#include <fog_fragment>")) fs = fs.replace("#include <fog_fragment>", CAPPED_FOG);
      shader.fragmentShader = fs;
    },
    "surf-path-v1",
  );
  made.materials.push(pathMat);
  for (const m of pathMeshes) {
    disposeMaterial(m.material);
    m.material = pathMat;
  }

  // ── Water ──────────────────────────────────────────────────────────────────
  const time = { value: 0 };
  const stillMat = makeWaterMaterial(ctx, heightTex!, bounds, time, false);
  const riverMat = makeWaterMaterial(ctx, heightTex!, bounds, time, true);
  made.materials.push(stillMat, riverMat);
  const waterMeshes: THREE.Mesh[] = [];
  for (const name of ["Sea", "Lake", "Pond"]) {
    for (const m of meshesOf(root, name)) {
      disposeMaterial(m.material);
      m.material = stillMat;
      waterMeshes.push(m);
    }
  }

  let river: THREE.Mesh | null = null;
  lap(() => {
    const surfaceMin = makeSurfaceMin(terrainMeshes, ctx.heightAt);
    const g = buildRiver(ctx.heightAt, surfaceMin, ctx.riverXAtZ, bodies, seaY, Number.isFinite(seaZ0) ? seaZ0 : Infinity);
    if (!g) return;
    made.geometries.push(g);
    river = new THREE.Mesh(g, riverMat);
    river.name = "River";
    river.renderOrder = 1;
    scene.add(river);
    waterMeshes.push(river);
    stats.riverTris = (g.index ? g.index.count : 0) / 3;
    stats.riverVerts = g.getAttribute("position").count;
  });

  // ── Frame loop: animate only while some water is in view ──────────────────
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const waterOnScreen = () => {
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    for (const m of waterMeshes) {
      if (!m.visible || !m.parent) continue;
      const g = m.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      sphere.copy(g.boundingSphere!).applyMatrix4(m.matrixWorld);
      if (frustum.intersectsSphere(sphere)) return true;
    }
    return false;
  };
  let animating = false;

  stats.buildMs = +busy.toFixed(1);
  stats.installMs = +(performance.now() - t0).toFixed(1);
  let tris = 0;
  for (const m of terrainMeshes) {
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  }
  stats.terrainTris = tris;
  stats.drawCallsAdded = river ? 1 : 0;

  return {
    name: "surfaces",
    update(t: number): boolean {
      if (ctx.reducedMotion) {
        animating = false;
        return false;
      }
      animating = waterOnScreen();
      if (animating) time.value = t;
      return animating;
    },
    isAnimating: () => animating && !ctx.reducedMotion,
    stats: () => ({ ...stats }),
    dispose() {
      if (river) {
        river.parent?.remove(river);
        river = null;
      }
      for (const g of made.geometries) g.dispose();
      for (const m of made.materials) m.dispose();
      for (const t of made.textures) t.dispose();
      for (const m of terrainMeshes) m.geometry.deleteAttribute("aShade");
      for (const m of pathMeshes) m.geometry.deleteAttribute("aLat");
    },
  };
};
