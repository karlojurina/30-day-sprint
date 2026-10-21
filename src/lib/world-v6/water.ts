import * as THREE from "three";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { BROOK, GLOW_STREAM, ISLAND_RILLS, PLACES, RIVER, STREAM, WORLD, fallsCurtainAt, magicAt } from "./layout";
import { LAKE_OUTER, LAKE_PAD, LAKE_SURFACE, POOL_PAD, POOL_SURFACE, lakeShoreAt, poolShoreAt, poolShoreR, terrainHeight } from "./terrain";
import { NOISE_TEX_FRAG_GLSL, NOISE_TEX_GLSL, getNoiseTexture } from "./noise";
import { addPathLine } from "./footprints";
import type { QualityTier } from "./quality";
import { NOISE_GLSL, RIVER_HW, brookHalfW, clamp01, lightStateOf, lin, smooth, streamHalfW, type SurfacesApi } from "./surfaces";

/**
 * v6 water (world_art_bible_v6.md 2.4, brief 4.8): every water surface in the
 * world, in one module.
 *
 *   Sea        one quad over the world: posterised ripple cells from the noise
 *              texture's cellular channel (two layers scrolling apart: round
 *              inside 420 of the camera, where the light shapes are the cells'
 *              borders; stretched 3:1 along the shore past 180 to 420),
 *              shallow / mid / deep bands from the height texture, foam bands
 *              that march up the beach and break into lumps as they die, glints
 *              where the two layers' borders cross in the sun's lobe (bright
 *              cells on the far mirror), a smooth sky mirror past ~1,500. The
 *              long swell stays at 20 percent, as a drift in the ripple
 *              thresholds. 3 texture reads on open water past 420, 5 inside it,
 *              3 more where the water is under 12 deep (map review 2026-10-15,
 *              item 15a; 9 everywhere before).
 *   Tarn       the Upper Falls' tarn: the sea's program on a small disc.
 *   Ribbons    "River", "Stream", "Brook", "GlowStream": posterised flow streaks
 *              lighter than the grass (they take the sky), white water where the
 *              water level drops fast (rapids, cascades: aRough per vertex), dark
 *              wet banks; the glowing stream teal by magicAt (aMagic). The river
 *              is the pool's water running out of it (POOL_LOOK, its own
 *              program; item 15b): the pool's colours and sky, starting inside
 *              the pool and fading in there (RIVER_JOIN).
 *   Lake       the Mirror Lake keeps light.ts's reflector; this patches its
 *              shader with a dark shallow band and a pale line at the shore.
 *   Falls      "Landmark_a3_Water": the curtain on WORLD.falls, falling the way
 *              water falls (CURTAIN), three unequal falls, wiggling streaks at
 *              three scales, gaps, foam heads, a glassy tongue at the lip.
 *              Nothing stands behind it but the cliff: the cave is gone
 *              (2026-10-13, layout.ts "The cave that was here"), and with it
 *              the sheet's look from behind ("CurtainBack") and the parting as
 *              the camera walked through at the mouth.
 *              water.ts owns the curtain's material in every view: if another
 *              module swaps it, update() puts it back.
 *   Pool       "Pool": a displaced polar disc, white water boiling at the impact
 *              (faceted mounds lit by the sun), foam lace carried out and
 *              thinning into drift lines, dark teal water with ripple cells, a
 *              shallow band and a shore line from the height texture, their
 *              outline wobbling round the pool (item 15b). Its rim lies under
 *              the shore terrain.ts draws (poolShoreR: points of land on the
 *              west and north, review round 1), at POOL_SURFACE.
 *   Puffs      one program (SurfPuff), three instanced meshes: "FallsSpray"
 *              (rising and fading over 2-4 s at the foot, invisible inside 30 of
 *              the camera, full from 80), "FallsPlume" (the opening's focal point:
 *              a column over the gorge, lit gold on its sun side, drifting east,
 *              plus the Upper Falls' landing mist) and "IslandMist" (the cloud
 *              puffs where the island's falls meet the cloud sea).
 *   Upper      "UpperFalls": three cream drops down the west massif (WORLD.upperFalls),
 *              replacing blocks.ts's stand-in (hidden in afterAll).
 *   Island     "IslandFalls": two sheets from ISLAND_RILLS' rim ends down to the
 *              cloud level, fading with noise over the last 15 percent.
 *
 * Zones: the pool, the spray, the plume and the Upper Falls sit in
 * "Water_south", hidden from inside the high basin; the island falls and their
 * mist in "Water_sky", hidden from anywhere south of the high ridge.
 *
 * Clocks: the sea and the ribbons move only while one is on screen; the
 * falls, the pool and the puffs run every frame (0 under reduced motion).
 *
 * Fog and grade: every material keeps the stock fog chunks and fog: true, so
 * light.ts's ramp and grade reach them. The plume and the Upper Falls take a
 * share of the fog (uFogK) so they stay the focal point at 3,000 to 4,000.
 *
 * Contract: scene.userData.water (WaterApi below).
 */

// ── Palette (display sRGB; converted to linear on load) ──────────────────────

const WATER_C = {
  sea: "#2c4a5c",
  seaShallow: "#3f8a86",
  river: "#4f6a70",
  foam: "#eee6d6",
  pool: "#1d3a3e",
  poolJade: "#6fa39a",
  poolBed: "#5a5040",
  curtainLit: "#f0e9da",
  curtainShade: "#7d90a2",
  shore: "#2a2a22",
  glow: "#39e0c8",
  upper: "#efe2c6",
  // Running water (the stream to the lip, the river): deep teal middles, jade toward the banks.
  teal: "#2a4e54",
  jade: "#58877f",
} as const;

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Ribbon section spacing (units). */
const RIBBON_STEP = 8;
/** The sea's wash: radians of phase per second (the foam line's in and out). */
const SWASH_RATE = 0.55;
/** Spray puffs at the foot (bible: at most 40 mist cards in view). */
const SPRAY_N = 16;
/**
 * Final pass D: the bloom as the camera goes through the falls (plume
 * instance 0): held `ahead` in front of the lens, `size` wide (the frame
 * sees only its smooth middle at a 50 degree lens: at 16 its noisy rim read
 * as grey smoke), peak alpha inside `near` of the sheet, none from `far`.
 */
const BLOOM = { ahead: 8, size: 40, alpha: 0.55, bright: 1.6, near: 5, far: 26 } as const;
/**
 * The plume over the gorge (the opening's focal point). veil: its alpha is
 * full from veil[1] out and falls to veil[2] at veil[0], so from the a4 ledge
 * (about 1,090 away) the column thins to a veil instead of a wall. taper: the
 * share of the column's height where its top starts to fade out.
 */
// Final pass B: the veil reaches out to 2,300 (was 1,000 to 1,800), so from
// a2 (about 1,400 away) the plume reads as mist at about a third, and the
// opening (3,800) keeps its full plume. Final pass C: the bank has about
// twice the puffs of the column, so inside the veil it thins to a tenth (was
// a third): at a4 (about 1,090) and on the stream it stays the faint veil it was.
// Final pass C: the column became a bank (PLUME_BANK); top is where its crown
// ends and taper how far below that the ragged fade starts.
// Final pass D: a quiet cue, not the focal point (the bank read as a dust
// cloud or an explosion): about half the height (top 1,050 -> 860) and a
// thin veil the far hills show through (PLUME_BANK below).
const PLUME = { top: 860, fadeNear: 620, veil: [1300, 2400, 0.1], litBias: 0.3, taper: 260 } as const;
/** The gorge's direction downstream of the pool (RIVER's first reach), unit x, z. */
const PLUME_GORGE = [0.955, -0.296] as const;
/**
 * The bank's rows (final pass C). from / to: along the gorge from the pool
 * (units, downstream positive); across: jitter across it; y, dy: base height
 * and its jitter (the rim is at about 405); size, dsize: puff width; rate > 0
 * lifts the puff by rise (drifting drift downstream) and fades it over
 * 1 / rate s; 0 holds and breathes.
 */
const PLUME_BANK: ReadonlyArray<{ n: number; from: number; to: number; across: number; y: number; dy: number; size: number; dsize: number; stretch: number; alpha: number; rate: number; rise: number; drift: number; bright: number; fogK: number }> = [
  // Final pass D: waterfall mist seen from miles away, a thin see-through veil
  // rising out of the gorge (21 puffs, was 30, about 3/4 of the area). stretch:
  // each puff is that many times taller than wide, with its noise drawn out
  // upward, so the veil rises in soft vertical wisps instead of billowing.
  // The veil's foot along the gorge, just cresting the rim (about 405).
  { n: 11, from: -140, to: 440, across: 70, y: 400, dy: 40, size: 260, dsize: 50, stretch: 1.2, alpha: 0.32, rate: 0, rise: 0, drift: 0, bright: 1.2, fogK: 0.06 },
  // Wisps lifting off it and thinning as they drift east (the spray rising).
  { n: 6, from: -40, to: 340, across: 70, y: 520, dy: 60, size: 160, dsize: 30, stretch: 1.9, alpha: 0.2, rate: 0.03, rise: 200, drift: 80, bright: 1.15, fogK: 0.1 },
  // A faint upper veil the wisps dissolve into.
  { n: 4, from: 0, to: 330, across: 50, y: 590, dy: 60, size: 240, dsize: 40, stretch: 1.4, alpha: 0.16, rate: 0, rise: 0, drift: 0, bright: 1.1, fogK: 0.12 },
];
/** Cheap laptops (overdraw): alpha cut at the plume's tapered top, seen from inside the veil (PUFF_FRAG). */
const PLUME_TOP_CUT = 0.1;
/**
 * Final pass C (verifier, overdraw): inside the veil (a4, a3, the stream) the
 * bank drew all 30 puffs at a tenth, a faint haze 10+ layers deep (a4 p99 10,
 * a3 and a1 6; hiding the plume alone gave 5, 4 and 5). There only the puffs
 * with seed under PLUME_VEIL_KEEP draw, at PLUME_VEIL_GAIN the alpha, and each
 * drops the rim of its disc under PLUME_VEIL_RIM of its own peak (rescaled, so
 * its core keeps its alpha): about a quarter of the layers. A third of the
 * puffs at 3x read as separate lumps over the a4 wall; half at 1.6x stays one
 * faint haze (shots/v6/finalC/integrate/plume).
 */
const PLUME_VEIL_KEEP = 0.5;
const PLUME_VEIL_GAIN = 1.6;
const PLUME_VEIL_RIM = 0.3;
/**
 * The full bank (a1, the opening) drops the rim of each puff under this share
 * of its peak: a1 overdraw p99 6 -> 5 for about one luma level in the bank
 * (mean absolute difference 1.0 to 1.3; shots/v6/finalC/integrate/plume/rim15).
 */
const PLUME_FAR_RIM = 0.15;
/**
 * The plume's painted light: sunlit spray is near white on its sun side and a
 * pale cool grey in its shade (fix-2: the gold body read as wildfire smoke).
 * The sun's colour only tints it (PLUME_SUN_TINT), so gold stays a rim.
 */
// Final pass D: a cooler white and a lighter shade (no cream: the bank read as dust).
const PLUME_LIT = "#edf3fb";
const PLUME_SHADE = "#c9d7ea";
const PLUME_SUN_TINT = 0.03;
/**
 * The night layer (light.ts state.night): the share of its light each water
 * surface gives up at night 1. The spray and mist at the falls' foot
 * (puffs), the opening's plume and the Upper Falls kept their day brightness
 * at night and read white; the curtain itself stays the brightest water.
 *
 * Tune pass (the critique of 2026-10-20 night):
 *   plume      0.75 -> 0.6: it keeps 40% of its light, so it is the
 *              opening's first look again once the moon is calmer;
 *   sea        0.62 -> 0.42 and seaSky 0.5 -> 0.15: the near water was luma
 *              24, one slab with the treeline (now about 31);
 *   pathPow    the moon path: the glints' lobe times pow(cos, pathPow) at
 *              night (by day the factor is exactly 1). With the sun's broad
 *              lobe the glints covered the whole sea in even white flecks;
 *              now they gather into a column under the moon's bearing (full
 *              within about 5 degrees, gone past 13), at moonGlint (0.4 over
 *              the whole sea before) and in moonPath of the moon's colour;
 *   stripes    the curtain's dark stripes go this far toward its lit colour,
 *              so the falls read as water and not a striped denim curtain
 *              (dark stripes p10 64 against highlights 155 -> 91 and 155).
 */
const NIGHT_WATER = { falls: 0.52, puffs: 0.2, plume: 0.6, upper: 0.5, sea: 0.42, seaSky: 0.15, foam: 0.78, moonPath: 0.35, moonGlint: 0.9, pathPow: 200, stripes: 0.45 } as const;

// ── Small helpers ────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
/** Seeded 0..1, stable across reloads (the same hash as blocks.ts's). */
function rnd(i: number, s = 0): number {
  const v = Math.sin(i * 127.1 + s * 311.7 + 17.3) * 43758.5453;
  return v - Math.floor(v);
}
/** Horizontal unit vector for a compass bearing (0 = -z, 90 = +x). */
function dirOf(bearing: number): [number, number] {
  return [Math.sin(bearing * DEG), -Math.cos(bearing * DEG)];
}

/**
 * The sea's wash phase, a uniform object (share it by reference). The white rim
 * at (x, z) reaches 0.5 + 1.3 * (0.5 + 0.5 * sin(swash.value + x * 0.006 +
 * z * 0.004)) units of water depth up the beach (SEA_FRAG). It moves with the
 * sea's own clock: only while the sea or a ribbon is on screen, and never under
 * reduced motion. The ground's wet sand band reads it (surfaces.ts must take it
 * from scene.userData.water at run time: a static value import of water.ts from
 * surfaces.ts is a cycle).
 */
export const swash = { value: 0 };

// ── GLSL ─────────────────────────────────────────────────────────────────────

// Water vertex: world position and the stock fog chunk (mvPosition, transformed).
const WATER_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#ifdef FLOW
attribute vec4 aFlow; // across -1..1, along (units), rough 0..1, magic 0..1
varying vec4 vFlow;
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
uniform float uTime, uSwash, uLevel, uSkyK, uGlintK;
uniform vec2 uPath; // the night layer's moon path: its share (0 by day) and the narrowing power
uniform vec3 uSunDir, uSunCol, uSkyLo, uSkyHi, uDeep, uShallow, uFoam;
uniform sampler2D uHeight, uNoise;
uniform vec4 uHB;
varying vec3 vW;
${NOISE_TEX_GLSL}
${NOISE_TEX_FRAG_GLSL}
void main() {
  vec3 toCam = cameraPosition - vW;
  float dist = length( toCam );
  vec3 V = toCam / dist;
  vec2 p = vW.xz;
  float t = uTime;

  // Ripple cells: the cellular channel (0 at a cell's point, 0.44 its median,
  // 0.68 at the 90th percentile), two layers scrolling apart.
  // The far pair: stretched 3:1 along the shore (x), past 180 to 420 out, so the
  // ripples still read from 250 to 900 (a low camera squeezes the near cells to
  // under 2 pixels there). Read in every pixel, as before: the far look is unchanged.
  vec2 s3 = vec2( p.x * 0.3333, p.y );
  float farK = smoothstep( 180.0, 420.0, dist );
  vec2 qc = s3 / 420.0 + vec2( 0.0021, 0.0042 ) * t + 0.61;
  vec2 qd = s3 / 270.0 + vec2( -0.0039, 0.0022 ) * t + 0.13;
  float ca = texture2D( uNoise, qc ).g;
  float cb = texture2D( uNoise, qd ).g;
  // Map review 2026-10-15, item 15a (Lovro: "weird streaks over here at the
  // start"): the near pair is round, not 3:1, at the same speeds as before.
  // Stretched, its cells lay 3 times longer across the opening's view, and the
  // low camera's foreshortening drew them out into long streaks; round, they read
  // as ripples. Read only where it shows (inside 420): the gradients are taken
  // first, so the samples stay filtered right at the edge of the branch.
  vec2 qa = ( p + vec2( 2.025, 1.275 ) * t ) / 220.0;
  vec2 qb = ( p + vec2( -2.362, 0.442 ) * t ) / 140.0 + 0.37;
  vec2 qaX = dFdx( qa ), qaY = dFdy( qa );
  vec2 qbX = dFdx( qb ), qbY = dFdy( qb );
  if ( farK < 1.0 ) {
    ca = mix( textureGrad( uNoise, qa, qaX, qaY ).g, ca, farK );
    cb = mix( textureGrad( uNoise, qb, qbX, qbY ).g, cb, farK );
  }
  // Cells smaller than ~2 pixels fade to the body (no shimmer), and far water is a mirror.
  float cellPx = mix( max( abs( qaX.y ) + abs( qaY.y ), abs( qaX.x ) + abs( qaY.x ) ), max( fwidth( qc.y ), fwidth( qc.x ) ), farK ) * 16.0;
  float detail = ( 1.0 - smoothstep( 0.3, 0.7, cellPx ) ) * ( 1.0 - smoothstep( 900.0, 1500.0, dist ) );
  // The long swell, at 20 percent: it drifts the thresholds, never draws crests.
  float swell = 0.2 * sin( dot( p, vec2( -0.2425, -0.9701 ) ) * 0.0331 - t * 0.75 );
  float darkS = pStep( 0.6 + swell * 0.2, 1.0 - ca );
  // 15a: near the camera the light shapes are the second layer's cell borders
  // (about a fifth of the water), so the light falls between the dark scallops
  // as wavelets; round light cells read as polka dots there. The far pair keeps
  // its light cells.
  float lightS = mix( pStep( 0.6 + swell * 0.1, cb ), pStep( 0.7 - swell * 0.2, 1.0 - cb ), farK ) * ( 1.0 - darkS );

  // Shallow, mid, deep: posterised from the height texture.
  vec2 huv = ( p - uHB.xy ) * uHB.zw;
  float ground = ( huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0 ) ? texture2D( uHeight, huv ).r : -200.0;
  float depth = uLevel - ground;
  // 15a: the shore's three noises (the bands' jitter, the foam's lumps, the rim)
  // only where the shore is: from 12 deep on the bands are all deep and both
  // foams are off whatever the noise says, so open water skips the three reads.
  vec2 frUv = p / 61.0;
  vec2 frX = dFdx( frUv ), frY = dFdy( frUv );
  float fr = 0.5;
  float lumps = 0.0;
  float rimN = 0.0;
  if ( depth < 12.0 ) {
    fr = textureGrad( uNoise, frUv, frX, frY ).r;
    lumps = textureGrad( uNoise, p / 23.0 + vec2( t * 0.006, 0.0 ), frX * 2.652, frY * 2.652 ).r;
    rimN = textureGrad( uNoise, p / 26.0 + t * 0.015, frX * 2.346, frY * 2.346 ).g;
  }
  float band = pBands3( depth + ( fr - 0.5 ) * 2.0, 2.5, 9.0 );
  vec3 body = mix( uShallow, mix( uShallow, uDeep, 0.55 ), clamp( band * 2.0, 0.0, 1.0 ) );
  body = mix( body, uDeep, clamp( band * 2.0 - 1.0, 0.0, 1.0 ) );

  // The sky it reflects (flat water; the cells do the rest): the blue of the
  // upper sky on the near and middle water, the gold horizon on the far water.
  // uSkyK (1 but at night, NIGHT_WATER.seaSky): the sky dome is drawn as it
  // is and the sea through ACES at the key's exposure, so at night the
  // reflected navy came out brighter and bluer than the sky above it.
  vec3 R = reflect( -V, vec3( 0.0, 1.0, 0.0 ) );
  vec3 sky = mix( uSkyLo, uSkyHi * 1.08, smoothstep( 0.0, 0.16, max( R.y, 0.0 ) ) ) * uSkyK;
  float F = 0.06 + 0.94 * pow( 1.0 - clamp( V.y, 0.0, 1.0 ), 5.0 );
  vec3 base = mix( body, sky * 0.9, clamp( F * 0.85 + 0.1, 0.0, 1.0 ) );
  vec3 darkC = mix( sky * 0.6, body, 0.35 );
  vec3 lightC = mix( base, sky * 1.12, 0.55 );
  vec3 col = mix( base, darkC, darkS * detail );
  col = mix( col, lightC, lightS * detail );

  // Glints: bright, near white, inside the sun's lobe.
  vec2 dirH = normalize( -V.xz + 1e-5 );
  vec2 sunH = normalize( uSunDir.xz + 1e-5 );
  // The night layer's moon path (uPath.x 0 by day: the factor is exactly 1).
  float pathK = mix( 1.0, pow( max( dot( dirH, sunH ), 0.0 ), uPath.y ), uPath.x );
  // A low sun spreads its path wide across rippled water: a broad lobe, so the
  // glint path reaches in from the sun's side of the frame (the far mirror's: the brightest cells).
  float lobe = pow( max( dot( dirH, sunH ), 0.0 ), 1.6 ) * smoothstep( 0.0, 0.2, 1.0 - V.y ) * smoothstep( -0.05, 0.1, uSunDir.y ) * pathK;
  float glint = pStep( 0.9 - 0.42 * lobe, 1.0 - min( ca, cb * 1.15 ) ) * pStep( 0.12, lobe ) * max( detail, 0.5 );
  // On the near and middle water (detail) the glints are where both layers'
  // cell borders cross: small and many toward the sun, fewer and smaller out of
  // its path, twinkling as the layers slide past each other. (Final pass C drew
  // broken dashes stretched 520 by 55 across the sun's line here, cut at a hard
  // edge of the path; Lovro's "weird streaks", map review 2026-10-15, item 15a.)
  // The far mirror keeps the old glints.
  float lobeN = pow( max( dot( dirH, sunH ), 0.0 ), 3.0 ) * smoothstep( 0.0, 0.2, 1.0 - V.y ) * smoothstep( -0.05, 0.1, uSunDir.y ) * pathK;
  float spark = pStep( 0.66 - ( 0.04 + 0.12 * uPath.x ) * lobeN, min( ca, cb ) ) * smoothstep( 0.02, 0.3, lobeN );
  glint = mix( glint, spark, detail ) * uGlintK;
  col = mix( col, uSunCol * 1.25 + vec3( 0.25 ), glint );

  // Foam bands marching up the beach (every ~7.7 s) and breaking into lumps as they die.
  float d = depth + ( fr - 0.5 ) * 1.5;
  float wave = fract( d * 0.25 + t * 0.13 );
  float life = 1.0 - smoothstep( 0.8, 6.5, d );
  float line = pStep( 0.9, wave ) * life * step( 0.3, d ) * pStep( 0.28 + 0.4 * ( 1.0 - smoothstep( 0.5, 4.0, d ) ), lumps );
  // The white rim at the water's edge, washing in and out on the swash.
  float sw = 0.5 + 0.5 * sin( uSwash + p.x * 0.006 + p.y * 0.004 );
  float reach = 0.5 + 1.3 * sw;
  float rimF = ( 1.0 - pStep( reach, d ) ) * pStep( 0.35, rimN );
  col = mix( col, uFoam, clamp( max( line * 0.85, rimF * 0.9 ), 0.0, 1.0 ) * step( -2.0, depth ) );

  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const FLOW_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime, uSpeed, uWhite, uLook, uRoughK, uSheen, uWild, uDim;
uniform vec2 uEndFade;
uniform vec3 uSunDir, uSunCol, uSkyLo, uSkyHi, uBody, uFoam, uGlow, uTeal, uJadeC;
uniform sampler2D uNoise;
#ifdef POOL_LOOK
uniform float uDay;
uniform vec4 uJoin;
#endif
varying vec3 vW;
varying vec4 vFlow;
${NOISE_TEX_GLSL}
${NOISE_TEX_FRAG_GLSL}
void main() {
  vec3 V = normalize( cameraPosition - vW );
  float u = vFlow.x;
  float s = vFlow.y;
  float rough = vFlow.z;
  float magic = vFlow.w;
  float t = uTime * uSpeed * ( 1.0 + rough );
  float fine = 1.0 - smoothstep( 1.5, 5.0, fwidth( s ) );
#ifndef POOL_LOOK
  float fres = pow( 1.0 - clamp( V.y, 0.0, 1.0 ), 3.0 );
#endif
  float st1, st2, streak, tone;
  vec3 col;
#ifdef POOL_LOOK
  // Map review 2026-10-15, item 15b: the river is the pool's water running out
  // of it (the "River" ribbon only; the other ribbons compile without this).
  // uJoin: its water fades in over the pool from s = x to y, and its running
  // water (streaks, banks, white water) grows in from z to w.
  float join = smoothstep( uJoin.x, uJoin.y, s );
  float run = smoothstep( uJoin.z, uJoin.w, s );
  vec3 R;
  {
    // The look 1 streaks (as the stream's, below).
    st1 = texture2D( uNoise, vec2( u * 0.9 + 0.03 * sin( s * 0.02 ), ( s - t ) / 260.0 ) ).r;
    st2 = texture2D( uNoise, vec2( u * 2.1 + 0.4, ( s - t * 1.4 ) / 110.0 ) ).r;
    float st3 = texture2D( uNoise, vec2( u * 5.0 + 0.7, ( s - t * 1.9 ) / 40.0 ) ).r;
    streak = st1 * 0.5 + mix( 0.5, st2, fine ) * 0.3 + mix( 0.5, st3, fine ) * 0.2;
    float cen = 1.0 - smoothstep( 0.15, 0.8, abs( u ) );
    vec3 bodyF = mix( uJadeC, uTeal, cen );
    tone = pBands3( streak, 0.42, 0.64 );
    // The pool's shallow water, running: the pool's deep teal and jade (uTeal
    // and uJadeC carry the pool's colours here), the sky by the pool's Fresnel,
    // capped at 0.55 and tinted jade, on a surface tilted by the streaks (flat
    // while it is still the pool), then the pool's turquoise shallows over it
    // at 0.4, as POOL_FRAG mixes them. The streaks are lighter and darker water
    // (the pool's slivers), not the pale sky runs that made it grey white.
    vec3 N = normalize( vec3( ( st1 - 0.5 ) * 0.3 * run, 1.0, ( st2 - 0.5 ) * 0.3 * run ) );
    R = reflect( -V, N );
    vec3 skyP = mix( uSkyLo, uSkyHi, smoothstep( 0.0, 0.6, max( R.y, 0.0 ) ) );
    float fx = 1.0 - clamp( dot( N, V ), 0.0, 1.0 );
    fx *= fx;
    vec3 base = mix( mix( uTeal, bodyF, run ), mix( skyP, uJadeC, 0.3 ) * 0.8, min( ( 0.04 + 0.96 * fx * fx ) * 0.55, 0.55 ) );
    base = base * 0.6 + vec3( 0.04, 0.144, 0.132 );
    col = base * mix( 1.0, mix( 0.86, 1.12, tone ), run );
    col = mix( col, col * 1.08 + skyP * 0.05, step( 0.99, tone ) * run );
  }
#else
  if ( uLook > 0.5 ) {
    // The stream and the river (uLook 1): streaks at three scales, about 5:1
    // along the flow, over a deep teal middle that lightens to jade toward the
    // banks, with the sky's sheen on top (blue, never the grey horizon).
    st1 = texture2D( uNoise, vec2( u * 0.9 + 0.03 * sin( s * 0.02 ), ( s - t ) / 260.0 ) ).r;
    st2 = texture2D( uNoise, vec2( u * 2.1 + 0.4, ( s - t * 1.4 ) / 110.0 ) ).r;
    float st3 = texture2D( uNoise, vec2( u * 5.0 + 0.7, ( s - t * 1.9 ) / 40.0 ) ).r;
    streak = st1 * 0.5 + mix( 0.5, st2, fine ) * 0.3 + mix( 0.5, st3, fine ) * 0.2;
    float cen = 1.0 - smoothstep( 0.15, 0.8, abs( u ) );
    vec3 bodyF = mix( uJadeC, uTeal, cen );
    vec3 skyF = mix( uSkyHi, uSkyLo, 0.25 );
    vec3 base = mix( bodyF, skyF, ( 0.12 + 0.5 * fres ) * uSheen );
    tone = pBands3( streak, 0.42, 0.64 );
    col = base * mix( 0.8, 1.1, tone );
    // (fix-3) the pale runs softer close to the lens (they filled the lip frame as big flat blotches).
    col = mix( col, mix( base, skyF * 1.08, 0.6 ), step( 0.99, tone ) * 0.6 * mix( 0.45, 1.0, smoothstep( 40.0, 260.0, length( cameraPosition - vW ) ) ) );
  } else {
    // Posterised flow: streaks travelling downstream at two speeds, stretched along the flow.
    st1 = texture2D( uNoise, vec2( u * 0.21 + 0.03 * sin( s * 0.02 ), ( s - t ) / 190.0 ) ).r;
    st2 = texture2D( uNoise, vec2( u * 0.47 + 0.4, ( s - t * 1.4 ) / 70.0 ) ).r;
    streak = st1 * 0.6 + mix( 0.5, st2, fine ) * 0.4;
    vec3 sky = mix( uSkyLo, uSkyHi, 0.3 );
    // Lighter than the grass: the water takes the sky; three flat tones.
    vec3 base = mix( uBody, sky * 0.95, 0.35 + 0.45 * fres );
    tone = pBands3( streak, 0.4, 0.68 );
    col = base * mix( 0.72, 1.12, tone );
  }
#endif
  // (fix-3) A wild stream (uWild, the glowing stream): its water edge wanders
  // along the flow (ragged banks, never one clean ribbon), its water sits dark
  // in the ground (uDim), and wet stones break it.
  float edgeW = 0.86;
  if ( uWild > 0.5 ) {
    float wn = texture2D( uNoise, vec2( 0.77, s / 150.0 ) ).r * 0.7 + texture2D( uNoise, vec2( 0.13, s / 41.0 ) ).r * 0.3;
    edgeW = mix( 0.42, 0.86, wn ) + ( texture2D( uNoise, vec2( u * 0.5 + 0.21, s / 13.0 ) ).r - 0.5 ) * 0.12;
    col *= uDim;
  }
  // Dark wet banks: the ribbon's edges.
  float bank = smoothstep( edgeW - 0.14, edgeW + 0.12, abs( u ) );
#ifdef POOL_LOOK
  // 15b: the river's banks, and its white water at them, grow in as it leaves the pool.
  bank *= run;
#endif
  col = mix( col, uBody * 0.45 * mix( 1.0, uDim, uWild ), bank * 0.65 );
  // White water: at stones along the edges, in broken patches, and wherever the
  // level drops fast (rapids and cascades).
  // (fix-2) narrow, and gated by a slow noise that sits still along each bank,
  // so the edge foam breaks into patches instead of running as a border.
  float bankN = texture2D( uNoise, vec2( 0.31 + step( 0.0, u ) * 0.37, s / 520.0 ) ).r;
  float edge = smoothstep( 0.66, 0.9, abs( u ) ) * ( 1.0 - bank ) * smoothstep( 0.45, 0.62, bankN );
#ifdef POOL_LOOK
  edge *= run;
#endif
  float wantW = clamp( edge * 0.3 + uWhite + rough * 0.95 * uRoughK, 0.0, 1.0 );
  float white = pStep( 1.02 - wantW * 0.62, mix( 0.5, st2, fine ) * 0.55 + st1 * 0.45 + rough * 0.15 );
  // (fix-3) the wild stream: a fleck of white only, at its own water value.
  col = mix( col, uFoam * mix( 0.85, 1.05, tone ) * mix( 1.0, uDim * 1.4, uWild ), white * 0.92 * ( 1.0 - 0.8 * uWild ) );
  // The glowing stream: teal and lit from inside where the magic is (never white).
  // (fix-3) soft low down, brightening only toward the forest.
  vec3 glowC = uGlow * mix( 0.55, 1.1, tone ) * mix( 1.0, 0.2 + 0.7 * magic * magic, uWild );
  col = mix( col, glowC, magic * ( 1.0 - bank * 0.6 ) );
#ifndef POOL_LOOK
  vec3 N = normalize( vec3( ( st1 - 0.5 ) * 0.3, 1.0, ( st2 - 0.5 ) * 0.3 ) );
  vec3 R = reflect( -V, N );
#endif
  col += uSunCol * pStep( 0.975, max( dot( R, uSunDir ), 0.0 ) ) * 0.35 * ( 1.0 - magic ) * mix( 1.0, uDim, uWild );
#ifdef POOL_LOOK
  // 15b: over the pool the river's sides are soft (a current in the pool's
  // water, not a ribbon), back to the usual edge by the time it is opaque; it
  // fades in out of the pool, and takes the day's light as the pool does.
  float a = ( 1.0 - smoothstep( edgeW - 0.5 * ( 1.0 - join ), edgeW + 0.14, abs( u ) ) ) * join;
  col *= uDay;
#else
  float a = 1.0 - smoothstep( edgeW, edgeW + 0.14, abs( u ) );
#endif
  // (fix-3) the stream fades out over the curtain's approach (no seam across it).
  a *= 1.0 - smoothstep( uEndFade.x, uEndFade.y, s );
  if ( uWild > 0.5 ) {
    // Wet stones and grass tufts over the banks break the water into runs:
    // cells of the noise's cellular channel, dark, most of them at the edges.
    // G is F1 (0 at a cell's point): a stone is the round core of a cell,
    // bigger toward the banks, only in some cells (the value noise picks them).
    vec2 cuv = vec2( u * 0.094 + 0.5, s / 52.0 );
    float cell = texture2D( uNoise, cuv ).g;
    float pick = texture2D( uNoise, cuv * 0.37 + 0.11 ).r;
    float stoneR = mix( 0.1, 0.24, smoothstep( 0.2, 0.9, abs( u ) / max( edgeW, 0.01 ) ) ) * step( 0.45, pick );
    float stone = 1.0 - step( stoneR, cell );
    col = mix( col, uBody * 0.16 + uGlow * 0.05 * magic, stone );
    // Where the channel is overgrown the water hides under the bank.
    float hideN = texture2D( uNoise, vec2( 0.55, s / 95.0 ) ).b;
    a *= mix( 1.0, 0.35, step( 0.7, hideN ) * ( 1.0 - magic ) );
  }
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const POOL_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
uniform vec2 uImpact, uOutlet;
uniform vec3 uPool;
// (15b, review round 1) How far inside the shore (terrain.ts poolShoreR) the vertex lies.
attribute float aShore;
varying vec3 vW;
varying vec3 vN;
varying float vEl;
varying float vWob;
varying float vShore;
${NOISE_GLSL}
float poolH( vec2 p, float amp ) {
  return amp * ( sNoise( p * 0.075 + vec2( uTime * 0.31, -uTime * 0.47 ) ) + sNoise( p * 0.17 - vec2( 0.0, uTime * 0.83 ) ) * 0.6 - 0.8 );
}
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vec2 d = wp.xz - uImpact;
  float el = length( vec2( d.x / 60.0, d.y / 26.0 ) );
  // Mounds of white water boiling up at the impact, settling as it spreads,
  // and still from 1 past the shore out (rising over 24 into the water).
  float rim = 1.0 - smoothstep( -23.0, 1.0, -aShore );
  float amp = ( 4.2 * ( 1.0 - smoothstep( 0.4, 3.2, el ) ) + 0.45 ) * rim;
  float h0 = poolH( wp.xz, amp );
  // A smooth normal from the same field, so the mounds shade as rolling volumes.
  float hx = poolH( wp.xz + vec2( 2.0, 0.0 ), amp );
  float hz = poolH( wp.xz + vec2( 0.0, 2.0 ), amp );
  vN = normalize( vec3( h0 - hx, 2.0, h0 - hz ) );
  // Map review 2026-10-15, item 15b: the shallows do not follow the bowl's
  // round contours. A slow wobble round the pool (3 and 7 lobes) moves the
  // shallow band, the bed and the shore line in and out by up to about 7 units
  // (POOL_FRAG adds it to the water's depth), so the edge reads uneven instead
  // of as a drawn circle; not where the river leaves (uOutlet, its first
  // reach's direction), where the pool's water runs on into it. Per vertex:
  // 56 around the disc hold 7 lobes, and the pixels pay nothing.
  vec2 dc = wp.xz - uPool.xy;
  float ang = atan( dc.y, dc.x );
  float outlet = smoothstep( 0.82, 0.95, dot( dc, uOutlet ) / max( length( dc ), 1e-3 ) );
  vWob = ( 1.3 * sin( 3.0 * ang + 1.3 ) + 0.7 * sin( 7.0 * ang + 0.4 ) ) * ( 1.0 - outlet );
  // Review round 1: the shallows hug the shore, points of land included (the
  // height texture's 33 unit cells cannot draw them); none across the outlet.
  vShore = aShore + 99.0 * outlet;
  wp.y += h0;
  vW = wp.xyz;
  vEl = el;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const POOL_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime, uDay, uLevel;
uniform vec2 uImpact;
uniform vec3 uDeep, uJade, uFoam, uSky, uSkyHi, uBed, uSunDir, uSunCol, uShade;
uniform sampler2D uNoise, uHeight;
uniform vec4 uHB;
varying vec3 vW;
varying vec3 vN;
varying float vEl;
varying float vWob;
varying float vShore;
${NOISE_TEX_GLSL}
${NOISE_TEX_FRAG_GLSL}
void main() {
  vec3 N = normalize( vN );
  vec3 V = normalize( cameraPosition - vW );
  float t = uTime;
  vec2 d = vW.xz - uImpact;
  // Polar about the impact line, the seam pointing south into the cliff.
  float re = length( vec2( d.x * 0.42, d.y ) );
  float th = atan( -d.x, -d.y ) / 6.2832;
  float fr = texture2D( uNoise, vW.xz / 90.0 + vec2( t * 0.01, -t * 0.017 ) ).r;
  float el = vEl + ( fr - 0.5 ) * 0.8;

  // The water: aerated pale jade by the boil, deep teal further out (three
  // posterised bands), the sky by Fresnel, a shallow band over the bed.
  float aer = 1.0 - smoothstep( 1.0, 6.0, el );
  vec3 water = mix( uDeep, uJade, pBands3( aer, 0.3, 0.68 ) );
  float F = 0.04 + 0.96 * pow( 1.0 - clamp( dot( N, V ), 0.0, 1.0 ), 4.0 );
  vec3 R = reflect( -V, N );
  vec3 sky = mix( uSky, uSkyHi, smoothstep( 0.0, 0.6, max( R.y, 0.0 ) ) );
  // Round F (judge: from the a3 stop the pool was a flat pale fan): at the
  // stop's low angle the sky took up to 0.8 of it; now at most 0.55, tinted jade.
  water = mix( water, mix( sky, uJade, 0.3 ) * 0.8, clamp( F * 0.55, 0.0, 0.55 ) );
  // Broad slivers of lighter water drifting outward (never dots).
  float sl = texture2D( uNoise, vec2( th * 5.0, ( re - t * 5.0 ) / 110.0 ) ).r;
  water = mix( water, water * 1.12 + sky * 0.04, pStep( 0.66, sl ) );
  vec2 huv = ( vW.xz - uHB.xy ) * uHB.zw;
  float depth = uLevel - texture2D( uHeight, huv ).r;
  // Review round 1: never deeper than the shore's own slope allows (vShore),
  // so the shallows, the bed and the shore line follow the shore round its points.
  depth = min( depth, 0.3 + 0.3 * vShore );
  // 15b: the shore's wobble (POOL_VERT): the shallows' outline is uneven.
  depth += vWob;
  // Round F: lighter turquoise where it shallows, the bed showing only at the very edge.
  vec3 turq = vec3( 0.1, 0.36, 0.33 );
  water = mix( water, mix( water, turq, 0.4 ), 1.0 - pStep( 3.2 + fr * 2.0, depth ) );
  water = mix( water, mix( turq * 1.35, uBed, 0.35 ), 1.0 - pStep( 1.2 + fr * 1.0, depth ) );

  // Foam: solid at the boil, breaking into streaks carried out radially, then
  // thin drift lines. Value noise stretched along the radius makes the streaks.
  float sA = texture2D( uNoise, vec2( th * 9.0, ( re - t * 8.0 ) / 150.0 ) ).r;
  float sB = texture2D( uNoise, vec2( th * 23.0 + 0.31, ( re - t * 12.0 ) / 80.0 ) ).r;
  float lump = texture2D( uNoise, vW.xz / 48.0 + vec2( t * 0.04, -t * 0.07 ) ).r;
  float fv = sA * 0.45 + sB * 0.3 + lump * 0.25;
  // Round F: the solid boil is smaller (it filled the pool as a white fan from
  // the stop), then a torn ring of foam round it with deep teal beyond.
  float thr = mix( -0.2, 0.8, smoothstep( 1.4, 3.4, el ) );
  float foamNear = pStep( thr, fv ) * ( 1.0 - smoothstep( 2.9, 3.6, el ) );
  float ring = ( 1.0 - smoothstep( 0.25, 0.55, abs( el - 3.5 + ( lump - 0.5 ) * 1.2 ) ) ) * pStep( 0.38, sA * 0.6 + lump * 0.4 );
  foamNear = max( foamNear, ring * 0.85 );
  // Further out the foam is drift lines (a ridge of the streak noise), never floating islands.
  float sL = texture2D( uNoise, vec2( th * 40.0 + 0.7, ( re - t * 10.0 ) / 260.0 ) ).r;
  float ridgeL = 1.0 - abs( sL * 2.0 - 1.0 );
  // Final pass D (verifier): the lines end nearer the boil (were 6.5-9.0) at
  // half strength (was 0.75); from the pool mark the far ones read as rain.
  float lines = pStep( 0.94, ridgeL ) * pStep( 0.45, lump ) * smoothstep( 3.6, 4.1, el ) * ( 1.0 - smoothstep( 4.6, 6.0, el ) );
  float foam = max( foamNear, lines * 0.4 );
  float thick = pStep( thr + 0.12, fv ) * ( 1.0 - smoothstep( 2.9, 3.6, el ) );
  // Lit per rolling mound: bright cream toward the sun, cream grey, blue grey in shade.
  float lam = dot( N, uSunDir ) * 2.2 + 0.2 + ( N.y - 0.97 ) * 6.0 + ( lump - 0.5 ) * 0.3;
  vec3 foamC = mix( uShade, uFoam * 0.86, pStep( 0.25, lam ) );
  foamC = mix( foamC, uFoam * 1.18 + uSunCol * 0.06, pStep( 0.62, lam ) );
  foamC = mix( mix( foamC, water, 0.5 ), foamC, thick );
  vec3 col = mix( water, foamC, foam );
  float shoreLine = ( 1.0 - pStep( 0.45 + fr * 0.5, depth ) ) * pStep( 0.35, texture2D( uNoise, vW.xz / 30.0 + t * 0.01 ).r );
  col = mix( col, uFoam * 0.85, shoreLine * 0.7 );
  col *= uDay;
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * The curtain. sheetGeometry's attributes (uv, aDrop, aSheet: fall height,
 * fall time, fade), the free-fall clock: a feature that left the lip at time
 * t0 is at drop d when t - t0 = T (sqrt(d/H + E) - sqrt(E)), so sampling a
 * pattern at (x, t - tau(d)) makes it fall and stretch the way water does
 * (bunched at the lip, long streaks at the foot).
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
// Round E (perf): the ribs' noises that vary only down the sheet, per vertex
// (the rows are about 7 apart; linear between them is within 0.4% of the noise,
// no rendered pixel moved by more than 24 of 255 at k22.5, k32 and a3).
varying float vWob;
varying vec4 vRibN;
${NOISE_GLSL}
void main() {
  float yV = clamp( uv.y, 0.0, 1.0 );
  float dV = max( aDrop, 0.0 );
  vWob = sNoise( vec2( yV * 4.0, 1.3 ) ) - 0.5;
  vRibN = vec4( sNoise( vec2( dV * 0.022, 5.0 ) ), sNoise( vec2( dV * 0.022, 9.0 ) ), sNoise( vec2( yV * 3.4, 21.0 ) ), sNoise( vec2( yV * 3.1, 33.0 ) ) );
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
uniform float uTime, uSunSide, uSunFront, uDay, uCamD;
uniform vec2 uThru;
uniform vec3 uLit, uShade, uSky, uSkyHi, uFoamC, uTeal, uJadeC;
varying vec2 vUv;
varying float vDrop;
varying vec3 vSheet;
varying vec3 vWc;
varying float vWob;
varying vec4 vRibN;
${NOISE_GLSL}
// A crisp step whose edge follows the pixel footprint (flat painted bands, no blur).
float cStep( float edge, float v ) {
  float e = fwidth( v ) * 1.1 + 0.0015;
  return smoothstep( edge - e, edge + e, v );
}
// Round E (perf): the same value noise on an integer hash (about 0.5 ms cheaper
// at the approach to the curtain). Only for the patterns that move with the
// water's clock; the static ones (the warp, the ribs, the rock) keep sNoise,
// so the falls' composition is unchanged.
float sNoiseF( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  ivec2 ii = ivec2( i );
  uvec2 qx = uvec2( ii.x, ii.x + 1 ) * 1597334673u;
  uvec2 qy = uvec2( ii.y, ii.y + 1 ) * 3812015801u;
  uvec4 n = ( qx.xyxy ^ qy.xxyy ) * 1597334673u;
  vec4 h = vec4( n ) * ( 1.0 / 4294967295.0 );
  return mix( mix( h.x, h.y, u.x ), mix( h.z, h.w, u.x ), u.y );
}
void main() {
  float Hh = vSheet.x;
  float Tt = vSheet.y;
  float E = 0.012;
  float lipV = 2.0 * Hh * sqrt( E ) / Tt;
  float tau = vDrop < 0.0 ? vDrop / lipV : Tt * ( sqrt( vDrop / Hh + E ) - sqrt( E ) );
  float ph = uTime - tau;
  float y = clamp( vUv.y, 0.0, 1.0 );
  // The ribbons weave as they fall (bible 2.4): a slow sine of the drop and time
  // moves the pattern across before it is sampled, more the further it has fallen.
  float wig = ( 0.02 * sin( y * 9.0 + uTime * 1.3 ) + 0.01 * sin( y * 23.0 - uTime * 2.1 ) ) * smoothstep( 0.04, 0.3, y );
  // Final pass C: close up the weave calms (at 60 to 120 away it swung the
  // ribbons into wide waves, the draped satin of the exit and back marks).
  wig *= 1.0 - 0.7 * ( 1.0 - smoothstep( 90.0, 320.0, length( vWc - cameraPosition ) ) );
  float x = vUv.x + wig;
  float isMain = 1.0 - vSheet.z;
  float dist = length( vWc - cameraPosition );
  float e = min( vUv.x, 1.0 - vUv.x );

  // The front (v5's detail pass 3, which Lovro liked, plus the weave): three
  // unequal falls split by two painted rock ribs, each three flat tones in long
  // ribbons (thin strands dark teal, the body teal grey, lit ribbons cream on
  // the sun side), a thin bright lip over a glassy tongue, broken foam billows
  // where it lands.
  float D = max( vDrop, 0.0 );
  float W = mix( 106.0, 40.0, vSheet.z );
  float X = x * W + ( sNoise( vec2( D * 0.035, x * 9.0 ) ) - 0.5 ) * 7.0 * smoothstep( 0.05, 0.4, y );
  float fall = step( 0.0, vDrop );
  float near = 1.0 - smoothstep( 130.0, 380.0, dist );
  // Final pass B (judge: up close the sheet read as draped satin): full inside
  // 260, gone by 560 (the a3 stop and park are 350 to 380 away), main falls only.
  float close = ( 1.0 - smoothstep( 260.0, 560.0, dist ) ) * isMain;
  // Two rock ribs (main falls only), broken into ledges so no rib runs lip to pool.
  float wob = vWob;
  float c1 = 0.25 + wob * 0.022;
  float c2 = 0.7 - wob * 0.018;
  float spread = smoothstep( 0.0, 0.55, y );
  // Final pass D (verifier): the ribs' width and fray noises only near a rib.
  // Past 0.09 across (a rib is at most 0.032 wide, its fray 0.008) the rib and
  // its rim are off either way, so the far value only has to stay well negative.
  float ribD = min( abs( x - c1 ), abs( x - c2 ) );
  float rib = 0.016 - ribD;
  // Round F: the distance to the nearest rib that shows (the far paint's thin water at the ribs).
  float ribE = ribD;
  if ( ribD < 0.09 ) {
    float hw1 = mix( 0.025, 0.017, spread ) * ( 0.72 + 0.56 * vRibN.x );
    float hw2 = mix( 0.021, 0.014, spread ) * ( 0.72 + 0.56 * vRibN.y );
    float g1 = smoothstep( 0.3, 0.42, vRibN.z ) * isMain;
    float g2 = smoothstep( 0.3, 0.42, vRibN.w ) * isMain;
    hw1 *= g1;
    hw2 *= g2;
    ribE = min( abs( x - c1 ) + ( 1.0 - g1 ) * 0.2, abs( x - c2 ) + ( 1.0 - g2 ) * 0.2 );
    float fray = ( sNoiseF( vec2( X * 0.7, ph * 2.2 ) ) - 0.5 ) * 0.016;
    rib = max( hw1 - abs( x - c1 ) + fray, hw2 - abs( x - c2 ) - fray );
  }
  float onRib = cStep( 0.0, rib ) * fall;
  float rim = ( 1.0 - cStep( 0.011, -rib ) ) * ( 1.0 - onRib ) * fall;
  // Lanes across a fall (how thick the sheet is there), streaks falling fast down them.
  // Up close the lanes narrow (they read as wide soft folds of equal width).
  float laneF = mix( mix( 0.15, 0.2, near ), 0.34, close );
  float lane = sNoiseF( vec2( X * laneF, y * 1.5 + ph * 0.05 ) ) * 0.62 + sNoiseF( vec2( X * laneF * 2.7 + 5.0, y * 3.0 - ph * 0.08 ) ) * 0.38;
  float sF = mix( 0.35, 0.9, near );
  float s1 = sNoiseF( vec2( X * sF, ph * 1.4 ) );
  float s2 = sNoiseF( vec2( X * sF * 2.3 + 11.0, ph * 2.6 + 5.0 ) );
  // The finest streaks fade before they alias, and inside 60 of the camera.
  float fine = ( 1.0 - clamp( fwidth( X * sF * 2.3 ) * 1.4, 0.0, 1.0 ) ) * smoothstep( 45.0, 70.0, dist );
  float streak = s1 * 0.6 + mix( 0.2, s2 * 0.4, fine );
  float body = lane * mix( 0.8, 0.55, spread ) + streak * mix( 0.2, 0.45, spread );
  // The sheet tears as it falls: solid at the lip, about a third thin strands at the foot.
  float tearT = mix( 0.12, 0.47, smoothstep( 0.03, 0.6, y ) );
  float t1 = cStep( tearT, body );
  float t2 = cStep( mix( 0.63, 0.6, near ), body );
  float fh = sNoiseF( vec2( X * 0.3 + 3.0, ph * 1.1 ) );
  float heads = cStep( 0.66, fh * 0.75 + s1 * 0.25 ) * smoothstep( 0.1, 0.3, y ) * fall;
  // Billows of white water boiling up where it lands, and a torn band at the very foot.
  float fz = smoothstep( 0.9, 1.0, y ) * isMain;
  // Final pass D (verifier): the billow noise only near the foot (fz starts at
  // 0.9); above it the foam step's threshold is 1.0, so a neutral 0.5 draws the same.
  float fn = 0.5;
  if ( y > 0.8 ) fn = sNoiseF( vec2( X * 0.34, D * 0.3 + uTime * 0.5 ) ) * 0.55 + sNoiseF( vec2( X * 0.9 + 7.0, D * 0.7 + uTime * 0.9 ) ) * 0.45;
  float foam = max( cStep( 1.0 - fz * 0.8, fn - ( 1.0 - t1 ) * 0.12 ), cStep( 0.975 + ( s2 - 0.5 ) * 0.03, y ) * isMain ) * fall;

  float lit = clamp( uSunFront + uSunSide * ( x - 0.5 ) * 1.4, 0.0, 1.0 );
  vec3 midC = mix( uShade * vec3( 0.5, 0.68, 0.7 ), uLit * vec3( 0.44, 0.39, 0.33 ), lit );
  vec3 deepC = mix( mix( vec3( 0.016, 0.034, 0.04 ), vec3( 0.05, 0.04, 0.032 ), lit * 0.5 ), midC, 0.5 );
  vec3 litC = mix( mix( uShade, vec3( 0.6, 0.72, 0.72 ), 0.5 ), uLit * 0.92, lit );
  vec3 col = mix( deepC, midC, t1 );
  col = mix( col, litC, t2 );
  col = mix( col, uFoamC * mix( 0.85, 1.02, lit ), heads * 0.9 );
  // Final pass B: up close, thin long streaks at about 3x the lanes' count, lit
  // and dark (high contrast), and foam chevrons bunching and falling at the
  // water's own speed (the fall clock ph stretches them as the drop speeds up).
  float sw = sNoiseF( vec2( X * 0.62 + 50.0, ph * 0.3 + y * 0.8 ) ) * 0.7 + sNoiseF( vec2( X * 1.7 + 13.0, ph * 0.55 ) ) * 0.3;
  float fw = 1.0 - clamp( fwidth( X * 1.7 ) * 1.2, 0.0, 1.0 );
  float onS = t1 * fall * smoothstep( 0.04, 0.16, y ) * ( 1.0 - fz ) * close;
  col = mix( col, litC * 1.14, cStep( 0.67, sw ) * onS * fw * 0.8 );
  col = mix( col, deepC * 0.8, ( 1.0 - cStep( 0.31, sw ) ) * onS * fw * 0.65 );
  // Final pass C: close up (the approach, the exit and back marks) the lanes'
  // three soft bands give way to thin bright threads over dark water, so the
  // sheet reads as falling water with the dark wall behind it, not as satin.
  float thK = close * fall * smoothstep( 0.05, 0.14, y ) * ( 1.0 - fz ) * ( 1.0 - smoothstep( 150.0, 330.0, dist ) );
  // Inside about 90 the threads get finer with distance, so they stay thin on screen.
  // (uCamD: the camera's distance to the sheet on the walk through, one value per frame, so the scale never varies across the screen.)
  // Round E (perf): the threads only where they show (thK is 0 past 330, so
  // the a3 stop and the approach's upper sheet skip their two noises; same pixels).
  if ( thK > 0.0 ) {
    float thX = X * clamp( 90.0 / max( uCamD, 1.0 ), 1.0, 5.0 );
    float thF = 1.0 - clamp( fwidth( thX * 3.1 ) * 1.1, 0.0, 1.0 );
    float th = sNoiseF( vec2( thX * 1.35 + 31.0, ph * 0.38 + y * 0.6 ) ) * 0.62 + mix( 0.19, sNoiseF( vec2( thX * 3.1 + 3.0, ph * 0.7 + 17.0 ) ) * 0.38, thF );
    vec3 thC = mix( deepC * 0.7, midC * 1.05, cStep( 0.44, th ) );
    thC = mix( thC, litC * 1.16, cStep( 0.58, th ) );
    col = mix( col, thC, thK * 0.88 );
  }
  float vx = abs( fract( X * 0.035 + 0.3 ) - 0.5 );
  float chN = sNoiseF( vec2( X * 0.07 + 21.0, ph * 2.4 + vx * 1.2 ) );
  float chev = cStep( 0.7, chN ) * cStep( 0.36, sw ) * onS * smoothstep( 0.16, 0.4, y );
  col = mix( col, uFoamC * mix( 0.9, 1.05, lit ), chev * 0.85 );
  // Round F (judge: from the a3 stop and its click-in the falls were a cream
  // sheet of even streaks): from 300 to 345 away and further (the stop and the
  // park are 360 to 560 away, all of it full) the falls are painted by how
  // thick the water is (the back mark, 195 to 330, keeps its close streaks).
  // A bright white core where it is thickest (the middle of each fall, a big
  // slow lane, the sun side), pale blue grey toward the edges and ribs, cool
  // shade at the torn sides, a few long light streaks, the dark wet rock where
  // the water is thinnest, and the lower quarter dissolving into white spray.
  // Close up (the approach, the exit, the back) nothing changes.
  // Final verify F: off for the whole frame while the camera is within 140 of
  // the sheet (uCamD, one value per frame: 121 at k22.5, 67 at k32). The top of
  // the sheet is 300+ away there, and painting it cost ~0.2 ms at k22.5, the
  // tightest frame. The stops (uCamD 1e4) are unchanged.
  float farK = smoothstep( 300.0, 345.0, dist ) * fall * isMain * ( 1.0 - fz ) * smoothstep( 140.0, 200.0, uCamD );
  if ( farK > 0.0 ) {
    float prof = smoothstep( 0.008, 0.08, ribE ) * smoothstep( 0.01, 0.14, e );
    float big = sNoiseF( vec2( X * 0.055 + 3.0, y * 1.1 + ph * 0.03 ) );
    float thk = prof * ( 0.4 + 0.6 * big ) + ( lane - 0.5 ) * 0.22 + ( lit - 0.5 ) * 0.4 - smoothstep( 0.45, 1.0, y ) * 0.12;
    vec3 shC = mix( uShade * vec3( 0.6, 0.72, 0.9 ), uShade * vec3( 0.9, 0.96, 1.04 ), lit * 0.5 );
    vec3 coreC = mix( vec3( 0.9, 0.93, 0.97 ), uFoamC * 1.05, lit * 0.6 ) * 1.1;
    vec3 midP = mix( shC, coreC, 0.5 );
    vec3 paint = mix( shC, midP, cStep( 0.44, thk ) );
    paint = mix( paint, coreC, cStep( 0.7, thk ) );
    paint = mix( paint, mix( midP, coreC, 0.7 ), cStep( 0.74, lane * 0.8 + s1 * 0.2 ) * ( 1.0 - cStep( 0.7, thk ) ) * 0.85 );
    paint = mix( paint, deepC * 0.9, ( 1.0 - cStep( 0.12, thk ) ) * 0.7 );
    paint = mix( paint, coreC, heads * 0.5 );
    paint = mix( paint, mix( coreC, midP, 0.2 ), smoothstep( 0.72, 0.97, y ) * prof * 0.6 );
    col = mix( col, paint, farK );
  }
  col = mix( col, uSky * 0.95, ( 1.0 - smoothstep( 0.0, 0.35, y ) ) * 0.25 * t1 );
  // The glassy tongue curving over the edge: deep teal with the sky in it.
  float tongue = ( 1.0 - smoothstep( 0.02, 0.1, y ) ) * fall;
  vec3 glass = mix( uTeal * 1.3, uSkyHi, 0.22 + 0.2 * cStep( 0.5, s1 ) );
  // (fix-2) stronger: at 0.35 the first metres over the edge read as one pale border along the lip.
  col = mix( col, glass, tongue * 0.75 );
  // The approach (bible 2.4): the stream sliding to the lip. Deep teal in the
  // middle, lighter jade toward the banks, flow streaks at three scales
  // stretched along the flow, the sky's sheen, broken foam at the banks.
  // (C4) Only shaded where it shows (vDrop < 0); on the falling sheet it was
  // mixed in at 0. The margin keeps every 2x2 quad that holds an approach
  // pixel inside the branch, so cStep's fwidth stays valid at the lip.
  float dropW = abs( dFdx( vDrop ) ) + abs( dFdy( vDrop ) );
  if ( vDrop < 2.0 * dropW + 0.01 ) {
    // Round F (judge: the lip frame's water was a flat teal sheet with a few
    // oval blobs): the streaks are longer (0.75 of the clock), and over the
    // last 36 they stretch further and thin as the water speeds up to the
    // edge, so they read fast and converge on the brink. The stretch is in
    // the drop (tau), never a factor on the clock, so it holds still in time.
    float acc = smoothstep( -36.0, 0.0, vDrop );
    float phA = 0.75 * ( uTime - vDrop / lipV * ( 1.0 - 0.45 * acc ) );
    float a1 = sNoiseF( vec2( X * 0.35, phA ) );
    float a2 = sNoiseF( vec2( X * mix( 0.9, 1.5, acc ) + 11.0, phA * 2.1 + 5.0 ) );
    float a3 = sNoiseF( vec2( X * 2.3 + 23.0, phA * 4.1 + 9.0 ) ) * fine + 0.5 * ( 1.0 - fine );
    float fl = a1 * 0.5 + a2 * 0.32 + a3 * 0.18;
    float cen = smoothstep( 0.03, 0.4, e );
    vec3 bodyA = mix( uJadeC, uTeal, cen );
    vec3 aprC = mix( bodyA * 0.8, bodyA * 1.15, cStep( 0.44, fl ) );
    // (fix-3) pale flow in fewer, smaller runs (it read as blotches all over the slab).
    // Round F: the pale runs are thin streaks from the finer two scales (the broad one drew the oval blobs).
    aprC = mix( aprC, mix( bodyA, uSkyHi, 0.5 ), cStep( 0.71, a2 * 0.65 + a3 * 0.35 ) * 0.9 );
    // Speeding up toward the lip: the streaks thin and the sheen grows.
    aprC = mix( aprC, mix( aprC, uSkyHi, 0.25 ), smoothstep( -8.0, 0.0, vDrop ) );
    // The sky in it, more the flatter it is seen (as the stream ribbon does).
    float fresA = pow( 1.0 - clamp( abs( normalize( cameraPosition - vWc ).y ), 0.0, 1.0 ), 3.0 );
    aprC = mix( aprC, mix( uSkyHi, uSky, 0.25 ), 0.06 + 0.26 * fresA );
    // Bank foam in patches with gaps (fix-2: a constant edge term drew a pale
    // strip down both banks, a pool trough): a narrow edge, gated by a slow
    // noise that sits still along the banks, so only the flow noise makes foam.
    float bankN = sNoise( vec2( X * 0.06 + 3.0, vDrop * 0.045 + 7.0 ) );
    float bankE = ( 1.0 - smoothstep( 0.0, 0.06, e ) ) * smoothstep( 0.5, 0.68, bankN );
    float bankF = cStep( 0.62, a2 * 0.55 + a1 * 0.2 + bankE * 0.2 );
    aprC = mix( aprC, uFoamC * 0.95, bankF * 0.9 );
    col = mix( col, aprC, 1.0 - fall );
  }
  // A bright foam line at the lip, broken.
  // (fix-2) broken into runs with real gaps: at 0.3 it read as one pale border.
  // (C4) Its two noises only in the band where it can show (same margin rule as the approach).
  if ( vDrop > -2.2 - 3.0 * dropW - 0.01 && vDrop < 1.6 + 3.0 * dropW + 0.01 ) {
    float lipLine = cStep( -2.2, vDrop ) * ( 1.0 - cStep( 1.6, vDrop ) ) * cStep( 0.5, sNoiseF( vec2( X * 0.3, ph * 1.4 ) ) * 0.7 + sNoiseF( vec2( X * 0.9 + 4.0, ph * 2.2 ) ) * 0.3 );
    col = mix( col, uFoamC * 1.08, lipLine * 0.92 );
  }
  col = mix( col, litC * 1.05, rim * 0.85 );
  // The ribs: dark wet rock in flat facets (value noise, stepped), a trickle sliding down.
  // Final pass D (verifier): the rock's two noises only where a rib shows. The
  // margin (3x the rib's footprint) keeps every 2x2 quad holding a rib pixel
  // inside the branch, so cStep's fwidth stays valid there.
  float ribW = fwidth( rib );
  if ( rib > -3.0 * ribW - 0.003 ) {
    float fac = floor( sNoise( vec2( X * 0.24, D * 0.075 - X * 0.08 ) ) * 4.0 ) / 3.0;
    vec3 rockC = vec3( 0.075, 0.072, 0.08 ) * ( 0.7 + 0.7 * fac ) + mix( vec3( 0.03, 0.045, 0.05 ), litC * 0.35, lit ) * step( 0.72, fac );
    float trickle = cStep( 0.82, sNoiseF( vec2( X * 1.6, ph * 3.0 ) ) );
    rockC = mix( rockC, midC, trickle * 0.45 );
    col = mix( col, rockC, onRib );
  }
  // Overbright billows (the valley haze greys the gorge floor; ACES rolls the excess off).
  float crown = smoothstep( 0.0, 0.2, fn - ( 1.0 - fz * 0.8 ) ) + cStep( 0.975, y );
  col = mix( col, mix( uFoamC * 1.15 + midC * 0.25, uFoamC * 2.0, clamp( crown, 0.0, 1.0 ) ), foam );
  col *= uDay;
  // Opaque; ragged sides.
  float rag = cStep( 0.018 + 0.05 * s1, e );
  float a = 0.985 * rag;
  // Final pass B: the sheet's sides tear into separate falling strands with
  // the wet wall showing between them (main falls, below the lip), more gaps
  // toward the outside; each strand's inner edge catches the light.
  float sideZ = ( 1.0 - smoothstep( 0.03, 0.12 + 0.04 * s1, e ) ) * smoothstep( 0.05, 0.3, y ) * isMain * fall * ( 1.0 - fz );
  float strandN = sNoiseF( vec2( X * 0.42 + 70.0, y * 1.4 + ph * 0.05 ) );
  float sideGap = cStep( 0.0, sideZ * 0.8 - strandN );
  a *= 1.0 - sideGap;
  col = mix( col, litC * 1.08, ( cStep( 0.0, sideZ * 0.8 - strandN + 0.06 ) - sideGap ) * 0.6 );
  // Island falls: long, thinning into the clouds over the last 15 percent with noise.
  a *= 1.0 - vSheet.z * smoothstep( 0.82, 1.0, y + ( s2 - 0.5 ) * 0.12 );
#ifdef CURTAIN_CUT
  // The main falls: opaque and drawn first, cut at its torn sides, so nothing
  // behind it is shaded.
  if ( a < 0.5 ) discard;
  // Final pass D: going through the falls is a moment (the frames 20 to 110
  // in front of the sheet were wall to wall cream streaks). uThru (one value
  // per frame, set in update()): x how far the pass through has come (0 at
  // 110 in front, 1 inside 20), y the camera's distance to the sheet. The
  // sheet rips into long falling strands of bright spray with gaps that show
  // the wet cliff behind it, droplets hang in the gaps, and the spray blooms
  // white close in. zs keeps the rips one size on screen as the camera closes
  // in. (Made for the walk through the falls into the cave, which is gone;
  // the foot of the ride still comes within 75 of the sheet, where it is on
  // at up to 0.04.)
  if ( uThru.x > 0.0 ) {
    float thru = uThru.x;
    float bloom = smoothstep( 0.55, 1.0, thru );
    float zs = clamp( 90.0 / max( uThru.y, 1.0 ), 1.0, 6.0 );
    float Xs = X * zs;
    float Ds = ( D - uTime * 38.0 ) * zs;
    float sp = sNoiseF( vec2( Xs * 0.3 + 13.0, Ds * 0.02 ) ) * 0.7 + sNoiseF( vec2( Xs * 0.85 + 5.0, Ds * 0.05 + 9.0 ) ) * 0.3;
    float gapT = 0.55 * smoothstep( 0.0, 0.5, thru );
    // Droplets: short falling beads left hanging in the gaps.
    float drop = cStep( 0.82, sNoiseF( vec2( Xs * 1.9 + 7.0, ( D - uTime * 60.0 ) * zs * 0.32 + 3.0 ) ) );
    if ( sp < gapT && drop < 0.5 ) discard;
    // Brightest at the strands' torn edges (light scattering through thin
    // water), so the spray glows instead of standing as a flat wall.
    float edge = 1.0 - smoothstep( gapT, gapT + 0.12, sp );
    vec3 sprayC = vec3( 0.95, 0.97, 1.0 ) * ( 1.05 + 0.6 * edge + 1.8 * bloom ) * uDay;
    col = mix( col, sprayC, clamp( thru * 0.8 + edge * thru * 0.3, 0.0, 1.0 ) );
    col = mix( col, sprayC * 1.2, drop * step( sp, gapT ) );
  }
  gl_FragColor = vec4( col, 1.0 );
#else
  gl_FragColor = vec4( col, a );
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Far cascades (the Upper Falls): cream, two tones of falling streaks, foam where each drop lands. Cheap. */
const UPPER_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime, uFogK;
uniform vec3 uLit, uShade, uFoamC;
varying vec2 vUv;
varying float vDrop;
varying vec3 vSheet;
varying vec3 vWc;
${NOISE_GLSL}
void main() {
  float Hh = vSheet.x;
  float Tt = vSheet.y;
  float tau = vDrop < 0.0 ? 0.0 : Tt * ( sqrt( vDrop / Hh + 0.012 ) - 0.1095 );
  float ph = uTime - tau;
  float y = clamp( vUv.y, 0.0, 1.0 );
  float x = vUv.x;
  float k = sNoise( vec2( x * 9.0, ph * 0.5 ) ) * 0.7 + sNoise( vec2( x * 23.0 + 3.0, ph * 1.1 ) ) * 0.3;
  float streak = smoothstep( 0.46, 0.54, k );
  // Final pass B (judge: white card strips pasted on the massif): a thin
  // ribbon narrowing toward the top of each drop, torn at its sides into
  // separate streaks, darker than the sky (peak about 20 luma under it).
  vec3 col = mix( uShade, uLit, 0.4 + 0.45 * streak ) * 0.9;
  float foot = smoothstep( 0.8, 0.92, y + ( k - 0.5 ) * 0.1 );
  col = mix( col, uFoamC * 0.92, foot );
  float e = min( x, 1.0 - x );
  float edgeN = sNoise( vec2( x * 5.0 + 2.0, y * 3.0 + ph * 0.2 ) );
  float halfW = mix( 0.2, 0.36, y ) + ( edgeN - 0.5 ) * 0.14;
  float a = smoothstep( 0.5 - halfW, 0.5 - halfW + 0.05, e ) * ( 0.62 + 0.38 * streak ) * ( 0.8 + 0.2 * foot );
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 pre = gl_FragColor.rgb;
  #include <fog_fragment>
  gl_FragColor.rgb = mix( pre, gl_FragColor.rgb, uFogK );
}
`;

/**
 * Puffs (spray, plume, the island's cloud puffs): one program. Each instance:
 * aP base position; aD (size, seed, near fade distance, alpha); aM (rise, drift
 * x, drift z, rate: > 0 rises and fades over 1 / rate seconds, 0 = holds and
 * breathes); aK (brightness, share of fog, upward stretch). Lit on the side facing the sun on
 * screen, in two painted tones.
 */
const PUFF_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 aP;
attribute vec4 aD;
attribute vec4 aM;
attribute vec3 aK;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec4 uVeil;
uniform vec4 uHFade;
varying vec2 vQ;
varying float vA;
varying float vSeed;
varying vec2 vSun;
varying vec2 vK;
varying vec2 vH;
varying float vNear;
varying float vStretch;
varying float vSpray;
void main() {
  float seed = aD.y;
  float rate = aM.w;
  float age = rate > 0.0 ? fract( uTime * rate + seed ) : 0.5;
  vec3 c = aP + vec3( aM.y, aM.x, aM.z ) * age;
  float s = aD.x * ( rate > 0.0 ? 0.5 + 0.8 * age : 1.0 + 0.06 * sin( uTime * 0.23 + seed * 6.283 ) );
  if ( rate <= 0.0 ) c += vec3( sin( uTime * 0.11 + seed * 9.0 ), sin( uTime * 0.07 + seed * 5.0 ) * 0.6, 0.0 ) * aD.x * 0.06;
  float a = ( rate > 0.0 ? sin( age * 3.14159 ) : 1.0 ) * aD.w;
  vec4 mvPosition = viewMatrix * vec4( c, 1.0 );
  // Round F: the spray at the falls' foot (the only puffs without the plume's
  // veil whose near fade is under 100) grows and thickens from 220 to 360
  // away, so from the a3 stop and its click-in a soft mist billows at the
  // foot; from the approach and the exit (under 220) it is unchanged.
  vSpray = step( uVeil.x, 0.0 ) * step( aD.z, 100.0 );
  float sprayK = vSpray * smoothstep( 220.0, 360.0, -mvPosition.z );
  s *= 1.0 + 1.0 * sprayK;
  a *= 1.0 + 0.5 * sprayK;
  // Invisible inside 0.375 of the near distance, full from it (spray: 30 / 80).
  a *= smoothstep( aD.z * 0.375, aD.z, -mvPosition.z );
  // The far veil (the plume only; (-2, -1, 1, 0) elsewhere): alpha falls to uVeil.z at uVeil.x.
  float far = smoothstep( uVeil.x, uVeil.y, -mvPosition.z );
  a *= mix( uVeil.z, 1.0, far );
  // Final pass C: the plume (uVeil.x > 0) is out between 1,330 and 1,750 deep:
  // from a2 (about 1,400 to 1,650) the bank was a near invisible haze that
  // stacked 30 layers on the cabin's smoke (a2 overdraw p99 6). Closer (the
  // stream, a4) it is the faint veil; further (a1, the opening) the full bank.
  a *= 1.0 - step( 0.0, uVeil.x ) * smoothstep( 1200.0, 1330.0, -mvPosition.z ) * ( 1.0 - smoothstep( 1750.0, 2000.0, -mvPosition.z ) );
  // Final pass C (verifier): inside the veil only half of the bank's puffs
  // draw, a little stronger (PLUME_VEIL_KEEP, PLUME_VEIL_GAIN; the column's puffs only).
  float veilK = step( 0.0, uVeil.x ) * ( 1.0 - step( 600.0, length( aP.xz - uHFade.xy ) ) ) * ( 1.0 - far );
  a *= mix( 1.0, step( seed, ${PLUME_VEIL_KEEP.toFixed(3)} ) * ${PLUME_VEIL_GAIN.toFixed(3)}, veilK );
  // Final pass C: a puff faded to nothing (inside its near fade, between two
  // lifts) is not rasterised at all (the lip frames sit inside the bank).
  if ( a < 0.004 ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  // Inside the veil (the plume from the a4 ledge): its tapered top drops its faint layers (PUFF_FRAG).
  vNear = 1.0 - far;
  // Final pass D: aK.z stretches the puff upward (the plume's wisps; 1 elsewhere).
  mvPosition.xy += position.xy * s * vec2( 1.0, aK.z );
  vStretch = aK.z;
  gl_Position = projectionMatrix * mvPosition;
  // The plume's height fade (uHFade: column x, z, fade from y, to y): only the
  // puffs of the column itself, so the Upper Falls' mist keeps its alpha. Inside
  // the veil (the a4 ledge) the fade starts lower, so the column stops short of the sky.
  vH = vec2( c.y + position.y * s * aK.z + ( 1.0 - far ) * ( uHFade.w - uHFade.z ) * 0.8, 1.0 - step( 600.0, length( aP.xz - uHFade.xy ) ) );
  vQ = position.xy;
  vA = a;
  vSeed = seed;
  vK = aK.xy;
  vec2 sv = ( viewMatrix * vec4( uSunDir, 0.0 ) ).xy;
  vSun = sv / max( length( sv ), 1e-4 );
  #include <fog_vertex>
}
`;

const PUFF_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uLitC, uShadeC;
uniform sampler2D uNoise;
varying vec2 vQ;
varying float vA;
varying float vSeed;
varying vec2 vSun;
varying vec2 vK;
varying vec2 vH;
varying float vNear;
varying float vStretch;
varying float vSpray;
uniform vec4 uVeil;
uniform vec4 uHFade;
void main() {
  if ( vA < 0.004 ) discard;
  vec2 q = vQ;
  float r = length( q ) * 2.0;
  // Outside the disc nothing draws, whatever the noise says: no quad corners
  // (the hard rectangles at a4 and a2), and no overdraw counted there.
  if ( r > 0.98 ) discard;
  // Final pass D: a stretched puff (the plume's wisps) reads its noise drawn
  // out upward, so it tears into vertical strands; round puffs are unchanged.
  vec2 nq = mix( q, vec2( q.x * 1.1, q.y * vStretch * 0.8 ), step( 1.8, vStretch ) );
  float n = texture2D( uNoise, nq * 0.42 + vSeed * 7.31 ).r;
  float n2 = texture2D( uNoise, nq * 1.05 - vSeed * 3.13 ).r;
  float a = 1.0 - smoothstep( 0.3, 1.0, r + ( n - 0.5 ) * 0.6 + ( n2 - 0.5 ) * 0.22 );
  a *= 1.0 - smoothstep( 0.72, 0.98, r );
  a *= vA;
  // Final pass C (verifier): inside the veil each puff drops its faint rim
  // (under PLUME_VEIL_RIM of its peak; PLUME_FAR_RIM for the full bank), rescaled so its core keeps its alpha.
  float rim = ( ${PLUME_VEIL_RIM.toFixed(3)} * vNear + ${PLUME_FAR_RIM.toFixed(3)} * ( 1.0 - vNear ) ) * vH.y;
  a = ( a - rim * vA ) / ( 1.0 - rim );
  // The column's top tapers out (ragged with the noise) instead of standing as a pillar.
  float topK = vH.y * smoothstep( uHFade.z, uHFade.w, vH.x + ( n - 0.5 ) * 160.0 );
  a *= 1.0 - topK;
  // Cheap laptops (overdraw): seen from inside the veil, the tapered top is
  // 5 to 9 near invisible layers; the faintest are cut (a4 p99 6 -> 5). The
  // cut is subtracted, not a hard step, so no contour shows; 0 elsewhere.
  float cut = ${PLUME_TOP_CUT.toFixed(3)} * topK * vNear;
  a = ( a - cut ) / ( 1.0 - cut );
  if ( a < 0.01 ) discard;
  // uVeil.w: how much of the puff the sun reaches (the plume's lit side is its bigger side).
  float lit = dot( q * 2.0, vSun ) * 0.75 + 0.2 + uVeil.w + q.y * 0.5 + ( n - 0.5 ) * 0.45;
  // Final pass C: the plume's foot (its boil at the rim) is lit through, so
  // the bank is whitest where the water lands; a dark foot read as smoke.
  // Round F: the spray catches the sun (it read as a brown haze against the wall).
  lit += 0.6 * vSpray;
  lit += 0.45 * vH.y * ( 1.0 - smoothstep( uHFade.z - 350.0, uHFade.z - 120.0, vH.x ) );
  vec3 col = mix( uShadeC, uLitC, smoothstep( -0.06, 0.1, lit ) ) * vK.x;
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 pre = gl_FragColor.rgb;
  #include <fog_fragment>
  gl_FragColor.rgb = mix( pre, gl_FragColor.rgb, vK.y );
}
`;

// ── Ribbons: the river, the stream, the brook, the glowing stream ────────────

/** (fix-3) How far the curtain's approach reaches back up the stream from the lip, and how far past the channel's floor it runs into the banks. */
const APPROACH_LEN = 42;
const APPROACH_BANK = 4;
/** (fix-3) The glowing stream's water value (1 = the other ribbons'). */
const GLOW_DIM = 0.42;
/**
 * (15b, map review 2026-10-15) Where the river leaves the pool. Its ribbon
 * starts `inside` units inside the pool's rim, `lift` over the pool's water
 * (clear of the pool's swell there), fades in until `full` inside the rim, and
 * eases down to its own line over `ramp` past the rim; its running water
 * (streaks, banks, white water) grows in until `run` past the rim.
 */
const RIVER_JOIN = { inside: 16, full: 5, lift: 0.55, ramp: 26, run: 40 } as const;
/**
 * (15b, review round 1) Where the river meets the sea. RIVER runs on out to
 * (4100, -1) over open sea, so its ribbon floated up to 2.6 over the sea for
 * about 390 units past the coast, in the pool's teal over the sea's sky, and
 * ended in a straight cut (a second water at the mouth). Now it fades out from
 * `fadeIn` before the coast to `fadeOut` past it, so the sea's own water shows
 * through, and nothing is laid past `skip` (waterAt's line stops there too).
 * skip is at least fadeOut + RIBBON_STEP, so the ribbon's last section is clear.
 */
const RIVER_SEA = { fadeIn: 12, fadeOut: 24, skip: 32 } as const;
let riverCoastS: number | null = null;
/**
 * The distance along RIVER's curve (centripetal, sampled every RIBBON_STEP as
 * buildRibbon lays it) of its first point over drawn ground under the sea's
 * level, counted back from the river's end; Infinity if its end is on land.
 * `ground` is the ground as the terrain mesh draws it (the install's drawn
 * height, or waterAt's caller's rocks.ts groundY: the same grid), worked out
 * once, so the ribbon and waterAt read the same number.
 */
function riverCoast(ground: (x: number, z: number) => number): number {
  if (riverCoastS !== null) return riverCoastS;
  const curve = new THREE.CatmullRomCurve3(RIVER.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, "centripetal");
  const len = curve.getLength();
  const n = Math.max(4, Math.round(len / RIBBON_STEP));
  const v = new THREE.Vector3();
  const under = (i: number) => {
    curve.getPointAt(i / n, v);
    return ground(v.x, v.z) < WORLD.seaLevel;
  };
  let i = n;
  if (!under(i)) i = Infinity;
  else while (i > 0 && under(i - 1)) i--;
  riverCoastS = (i / n) * len;
  return riverCoastS;
}
/** Past where the river's ribbon (and waterAt's line along it) stops, out in the sea: `s` is the distance along RIVER's curve. */
function riverPastSea(s: number, ground: (x: number, z: number) => number): boolean {
  return s > riverCoast(ground) + RIVER_SEA.skip;
}
/** (fix-3) Bends laid over the glowing stream's layout line: [amplitude, wavelength] pairs, units. */
const GLOW_MEANDER: ReadonlyArray<readonly [number, number]> = [
  [16, 170],
  [6, 62],
];
/**
 * A line resampled every 12 units and pushed sideways by GLOW_MEANDER's sines,
 * the push easing to 0 at both ends (the spring and the mouth stay put).
 */
function meander(pts: ReadonlyArray<readonly [number, number, number]>): Array<[number, number, number]> {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, "centripetal");
  const len = curve.getLength();
  const n = Math.max(4, Math.round(len / 12));
  const out: Array<[number, number, number]> = [];
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t);
    const L = Math.hypot(t.x, t.z) || 1;
    const ease = smooth(0, 0.12, u) * (1 - smooth(0.9, 1, u));
    let off = 0;
    GLOW_MEANDER.forEach(([amp, wl], k) => {
      off += amp * Math.sin((u * len * 2 * Math.PI) / wl + k * 1.7);
    });
    off *= ease;
    out.push([p.x - (t.z / L) * off, p.y, p.z + (t.x / L) * off]);
  }
  return out;
}

/**
 * Map review 2026-10-15, item 15c: where the brook and the glowing stream meet
 * the Mirror Lake. A stream's line is carried on the way it last ran until
 * MOUTH_IN inside the lake's shore (terrain.ts lakeShoreR), so its ribbon
 * reaches the water wherever the shore lies; the ribbon fades out across the
 * shore (mouthFade, into the lake's own colour) and is skipped past MOUTH_SKIP
 * inside it, where only the mirror shows.
 */
const MOUTH_IN = 20;
const MOUTH_SKIP = 18;
function toLake(pts: ReadonlyArray<readonly [number, number, number]>): Array<[number, number, number]> {
  const out = pts.map((p) => [p[0], p[1], p[2]] as [number, number, number]);
  const a = out[out.length - 2];
  const b = out[out.length - 1];
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const L = Math.hypot(dx, dz) || 1;
  const lk = WORLD.lake;
  for (let t = 0; t <= 240; t += 4) {
    const x = b[0] + (dx / L) * t;
    const z = b[2] + (dz / L) * t;
    if (Math.hypot(x - lk.x, z - lk.z) < lakeShoreAt(x, z) - MOUTH_IN) {
      if (t > 0) out.push([x, b[1], z]);
      break;
    }
  }
  return out;
}
/** More than MOUTH_SKIP inside the lake's shore: a ribbon there would only lie under the mirror. */
function pastMouth(x: number, z: number): boolean {
  return Math.hypot(x - WORLD.lake.x, z - WORLD.lake.z) < lakeShoreAt(x, z) - MOUTH_SKIP;
}
/** Where a ribbon along `pts` fades into the lake, as distances along it (FLOW_FRAG's uEndFade): from 3 outside the shore to 16 inside. */
function mouthFade(pts: ReadonlyArray<readonly [number, number, number]>): [number, number] {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, "centripetal");
  const len = curve.getLength();
  const lk = WORLD.lake;
  const v = new THREE.Vector3();
  let s0 = 1e9;
  let s1 = 2e9;
  for (let i = 0; i <= 400; i++) {
    curve.getPointAt(i / 400, v);
    const e = Math.hypot(v.x - lk.x, v.z - lk.z) - lakeShoreAt(v.x, v.z);
    if (s0 > 1e8 && e < 3) s0 = (i / 400) * len;
    if (e < -16) {
      s1 = (i / 400) * len;
      break;
    }
  }
  return [s0, Math.max(s1, s0 + 1)];
}

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
  /** Glow share at a point (the glowing stream: magicAt). */
  magic?: (x: number, z: number) => number;
}

function buildRibbon(spec: RibbonSpec, drawnGround: (x: number, z: number) => number): THREE.BufferGeometry | null {
  const ground = spec.ground ?? drawnGround;
  const curve = new THREE.CatmullRomCurve3(spec.pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, "centripetal");
  const len = curve.getLength();
  const n = Math.max(4, Math.round(len / RIBBON_STEP));
  const P = curve.getSpacedPoints(n);
  // The water's level along the curve, then how fast it drops (rapids, cascades).
  const lvl: number[] = P.map((p, i) => (spec.level ? spec.level(p.x, p.y, p.z, i / n) : p.y));
  const step = len / n;
  const rough: number[] = lvl.map((_, i) => {
    const a = lvl[Math.max(0, i - 2)];
    const b = lvl[Math.min(n, i + 2)];
    const span = (Math.min(n, i + 2) - Math.max(0, i - 2)) * step || 1;
    return smooth(0.07, 0.3, Math.abs(a - b) / span);
  });
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
    const s = along * len;
    const mg = spec.magic ? clamp01(spec.magic(p.x, p.z)) : 0;
    for (const f of ACROSS) {
      const x = p.x - tz * hw * f;
      const z = p.z + tx * hw * f;
      const y = Math.max(lvl[i], ground(x, z) + spec.lift);
      pos.push(x, y, z);
      flow.push(f, s, rough[i], mg);
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
  g.setAttribute("aFlow", new THREE.Float32BufferAttribute(flow, 4));
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

// ── Where water is drawn (shared) ─────────────────────────────────────────────

/**
 * Is water drawn at (x, z), or anywhere within `margin` of it (up to 16)? The one test for
 * keeping a thing out of the water, read off what this module and light.ts
 * draw (map review 2026-10-15: the lesson lanterns use it; the Mirror Lake's
 * new shore, item 15c, should use it and change it with the lake). `ground` is
 * the ground's height as the terrain mesh draws it (rocks.ts groundY).
 *
 *   the sea      the "Sea" plane at WORLD.seaLevel, wherever the ground is under it;
 *   the lake     light.ts's mirror: the shore terrain.ts draws (lakeShoreR) plus
 *                LAKE_PAD, at LAKE_SURFACE (WORLD.lake.y + its LAKE_LIFT),
 *                wherever the ground is under it (item 15c: the same function
 *                shapes the ground, the mirror and this test);
 *   the pool     the "Pool" disc at POOL_SURFACE, to the shore terrain.ts draws
 *                (poolShoreR, with its points of land) plus POOL_PAD, wherever the
 *                ground is under it (its swell, up to half a unit, rises from
 *                nothing at the shore over the 24 inside it);
 *   the tarn     the "UpperTarn" disc, r + 14 at its y;
 *   the ribbons  as the install's addRibbon calls lay them: the river, the brook
 *                and the glowing stream over the drawn ground across their
 *                whole width (the river only to RIVER_SEA.skip past its mouth,
 *                riverCoast; the last two carried on into the lake, toLake); the stream at its own level, cut off where the
 *                banks rise over it, and on to the lip (the curtain's approach
 *                takes its last APPROACH_LEN at the same level).
 * The island's rills are dress-sky.ts's and register "water" footprints, which
 * footprints.ts's blocked() finds. Change this with any of the above.
 * Pure (no scene): the first call builds the ribbons' lines, later calls allocate nothing.
 */
export function waterAt(x: number, z: number, ground: (x: number, z: number) => number, margin = 0): boolean {
  const W = waterLines(ground);
  const m = Math.max(0, margin);
  // Nothing drawn anywhere near: the common case, answered with one read of the ground.
  const lk = WORLD.lake;
  const pl = WORLD.pool;
  const tn = WORLD.upperFalls.tarn;
  const nearDisc = (cx: number, cz: number, r: number) => (x - cx) * (x - cx) + (z - cz) * (z - cz) < (r + m) * (r + m);
  const g0 = ground(x, z);
  if (g0 > WORLD.seaLevel + 40 && !nearDisc(lk.x, lk.z, LAKE_OUTER + LAKE_PAD) && !nearDisc(pl.x, pl.z, pl.r + POOL_PAD) && !nearDisc(tn.x, tn.z, tn.r + 14) && !W.near(x, z, m)) return false;
  if (wetPoint(W, x, z, g0)) return true;
  if (m <= 0) return false;
  // Eight points round it at `margin`, each with its own ground.
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const qx = x + Math.cos(a) * m;
    const qz = z + Math.sin(a) * m;
    if (wetPoint(W, qx, qz, ground(qx, qz))) return true;
  }
  return false;
}

/** Water drawn exactly at (x, z), with the ground g there. */
function wetPoint(W: WaterLines, x: number, z: number, g: number): boolean {
  if (g < WORLD.seaLevel) return true;
  const lk = WORLD.lake;
  if (g < LAKE_SURFACE) {
    const d = Math.hypot(x - lk.x, z - lk.z);
    if (d < LAKE_OUTER + LAKE_PAD && d < lakeShoreAt(x, z) + LAKE_PAD) return true;
  }
  const pl = WORLD.pool;
  if (g < POOL_SURFACE + 0.5) {
    const d = Math.hypot(x - pl.x, z - pl.z);
    if (d < pl.r + POOL_PAD) {
      const R = poolShoreAt(x, z);
      if (d < R + POOL_PAD && g < POOL_SURFACE + 0.5 * smooth(-1, 23, R - d)) return true;
    }
  }
  const tn = WORLD.upperFalls.tarn;
  if (g < tn.y && (x - tn.x) * (x - tn.x) + (z - tn.z) * (z - tn.z) < (tn.r + 14) * (tn.r + 14)) return true;
  return W.wet(x, z, g);
}

interface WaterLines {
  /** Is (x, z) within `pad` of a ribbon's edge? */
  near(x: number, z: number, pad: number): boolean;
  /** Is a ribbon drawn at (x, z), the ground there at g? */
  wet(x: number, z: number, g: number): boolean;
}
let waterLinesCache: WaterLines | null = null;
/** The ribbons' centre lines, sampled as buildRibbon samples them, in a grid of 48 unit cells (`ground`: the drawn ground, for the river's mouth). */
function waterLines(ground: (x: number, z: number) => number): WaterLines {
  if (waterLinesCache) return waterLinesCache;
  const U = WORLD.upperFalls;
  const pl = WORLD.pool;
  // Segments: ax, az, bx, bz, half width at a and b, level at a and b (1e9: drawn over the ground).
  const seg: number[] = [];
  // `skip` gets a point and its distance along the line.
  const line = (pts: ReadonlyArray<readonly [number, number, number]>, halfW: (a: number) => number, skip: (x: number, z: number, s: number) => boolean, level: boolean) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, "centripetal");
    const len = curve.getLength();
    const n = Math.max(4, Math.round(len / RIBBON_STEP));
    const P = curve.getSpacedPoints(n);
    for (let i = 0; i < n; i++) {
      const a = P[i];
      const b = P[i + 1];
      if (skip(a.x, a.z, (i / n) * len) || skip(b.x, b.z, ((i + 1) / n) * len)) continue;
      seg.push(a.x, a.z, b.x, b.z, halfW(i / n), halfW((i + 1) / n), level ? a.y : 1e9, level ? b.y : 1e9);
    }
  };
  line(RIVER, () => RIVER_HW, (x, z, s) => Math.hypot(x - pl.x, z - pl.z) < pl.r - RIVER_JOIN.inside || riverPastSea(s, ground), false);
  line(STREAM, (a) => streamHalfW(a) + APPROACH_BANK, (x, z) => Math.hypot(x - U.tarn.x, z - U.tarn.z) < U.tarn.r - 8, true);
  line(toLake(BROOK), (a) => brookHalfW(a) + 1.5, pastMouth, false);
  line(toLake(meander(GLOW_STREAM)), (a) => (4 + 3.5 * a) * (1 - 0.25 * smooth(0.2, 0.45, a)), pastMouth, false);
  const S = 8;
  const N = seg.length / S;
  const CELL = 48;
  /** Room in the grid for a query's margin. */
  const PAD = 16;
  const cells = new Map<number, number[]>();
  const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
  for (let s = 0; s < N; s++) {
    const o = s * S;
    const r = Math.max(seg[o + 4], seg[o + 5]) + PAD;
    const i0 = Math.floor((Math.min(seg[o], seg[o + 2]) - r) / CELL);
    const i1 = Math.floor((Math.max(seg[o], seg[o + 2]) + r) / CELL);
    const j0 = Math.floor((Math.min(seg[o + 1], seg[o + 3]) - r) / CELL);
    const j1 = Math.floor((Math.max(seg[o + 1], seg[o + 3]) + r) / CELL);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = key(i, j);
        const b = cells.get(k);
        if (b) b.push(s);
        else cells.set(k, [s]);
      }
  }
  /** The segments near (x, z) for which `test` holds, given the point's place across each: t along it and its distance d. */
  const visit = (x: number, z: number, test: (o: number, t: number, d: number) => boolean): boolean => {
    const b = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!b) return false;
    for (let k = 0; k < b.length; k++) {
      const o = b[k] * S;
      const ax = seg[o];
      const az = seg[o + 1];
      const dx = seg[o + 2] - ax;
      const dz = seg[o + 3] - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (test(o, t, d)) return true;
    }
    return false;
  };
  let qPad = 0;
  let qG = 0;
  const nearTest = (o: number, t: number, d: number) => d < seg[o + 4] + (seg[o + 5] - seg[o + 4]) * t + qPad;
  const wetTest = (o: number, t: number, d: number) =>
    d < seg[o + 4] + (seg[o + 5] - seg[o + 4]) * t && qG < seg[o + 6] + (seg[o + 7] - seg[o + 6]) * t;
  waterLinesCache = {
    near(x, z, pad) {
      qPad = Math.min(pad, PAD);
      return visit(x, z, nearTest);
    },
    wet(x, z, g) {
      qG = g;
      return visit(x, z, wetTest);
    },
  };
  return waterLinesCache;
}

// ── The falls: how water falls, and its sheets ─────────────────────────────

/** v6: the falls' flow direction in plan (x, z) and the sheet's across
 *  direction (the flow turned 90 degrees clockwise seen from above). */
const FLOW_B = (WORLD.falls.flow * Math.PI) / 180;
const FLOW_DIR: readonly [number, number] = [Math.sin(FLOW_B), -Math.cos(FLOW_B)];
const FLOW_ACROSS: readonly [number, number] = [Math.cos(FLOW_B), Math.sin(FLOW_B)];
/**
 * The main falls, for anyone who needs to follow the water (the dive camera).
 * The sheet leaves the lip heading WORLD.falls.flow (v6: 0, north, away from
 * the trail) and bends outward with the square root of the drop: layout.ts
 * fallsCurtainAt.
 */
export const CURTAIN = {
  /** Seconds the water takes to fall from the lip to the pool. */
  fallSeconds: 4.2,
  /** Speed at the lip, units/s (the stream sliding over the edge). */
  lipSpeed: 2 * (WORLD.falls.top[1] - WORLD.falls.bottom[1]) * Math.sqrt(0.012) / 4.2,
  /** z of the sheet's centre at height y (fallsCurtainAt). */
  zAt(y: number): number {
    return fallsCurtainAt(y)[1];
  },
  /** Height of a water feature that left the lip `s` seconds ago (free fall, with a small lip speed). */
  yAfter(s: number): number {
    const [, ty] = WORLD.falls.top;
    const h = ty - WORLD.falls.bottom[1];
    const e = 0.012;
    const k = s / 4.2 + Math.sqrt(e);
    return ty - h * Math.max(0, k * k - e);
  },
} as const;

/** Geometry for one falling sheet. `at(d)` gives the centre at drop d; across is the horizontal unit vector across the sheet. */
interface Sheet {
  approach: number;
  height: number;
  seconds: number;
  fade: 0 | 1;
  width0: number;
  width1: number;
  at(d: number, out: THREE.Vector3): void;
  across: [number, number];
  /** (fix-3) Upstream of the lip (d < 0): the across direction and the width, when the approach follows a curve. */
  acrossAt?(d: number): [number, number];
  widthAt?(d: number): number;
}
function sheetGeometry(sheets: Sheet[], origin: THREE.Vector3, cols = 14, rowsF = 56, rowsA = 4): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const drop: number[] = [];
  const sheet: number[] = [];
  const idx: number[] = [];
  for (const s of sheets) {
    const rows: number[] = [];
    for (let i = 0; i < rowsA; i++) rows.push(-s.approach * (1 - i / rowsA));
    for (let i = 0; i <= rowsF; i++) rows.push(s.height * Math.pow(i / rowsF, 1.5));
    const base = pos.length / 3;
    const c = new THREE.Vector3();
    for (let r = 0; r < rows.length; r++) {
      const d = rows[r];
      s.at(d, c);
      const w = d < 0 && s.widthAt ? s.widthAt(d) : s.width0 + (s.width1 - s.width0) * Math.max(0, d / s.height);
      const ac = d < 0 && s.acrossAt ? s.acrossAt(d) : s.across;
      for (let k = 0; k <= cols; k++) {
        const u = k / cols;
        const off = (u - 0.5) * w;
        // A little unevenness across and down the sheet, and a bow outward so
        // the sheet has body seen from its side (the dive looks along it).
        const bulge = d > 0 ? 1.6 * Math.sin(u * 9.0 + d * 0.045) + 0.16 * w * Math.sin(Math.PI * u) * Math.min(1, d / 25) : 0;
        pos.push(c.x + ac[0] * off - origin.x + ac[1] * bulge, c.y - origin.y, c.z + ac[1] * off - origin.z - ac[0] * bulge);
        uv.push(u, Math.max(0, d / s.height));
        drop.push(d);
        sheet.push(s.height, s.seconds, s.fade);
      }
    }
    for (let r = 0; r < rows.length - 1; r++) {
      for (let k = 0; k < cols; k++) {
        const a = base + r * (cols + 1) + k;
        const b = a + cols + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aDrop", new THREE.Float32BufferAttribute(drop, 1));
  g.setAttribute("aSheet", new THREE.Float32BufferAttribute(sheet, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ── Puffs ────────────────────────────────────────────────────────────────────

interface Puff {
  p: [number, number, number];
  size: number;
  seed: number;
  near: number;
  alpha: number;
  rise: number;
  dx: number;
  dz: number;
  rate: number;
  bright: number;
  fogK: number;
  /** Final pass D: how many times taller than wide (the plume's wisps); 1 when absent. */
  stretch?: number;
}
function puffGeometry(list: Puff[]): THREE.InstancedBufferGeometry {
  const plane = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = plane.index;
  g.setAttribute("position", plane.getAttribute("position"));
  const n = list.length;
  const aP = new Float32Array(n * 3);
  const aD = new Float32Array(n * 4);
  const aM = new Float32Array(n * 4);
  const aK = new Float32Array(n * 3);
  list.forEach((q, i) => {
    aP.set(q.p, i * 3);
    aD.set([q.size, q.seed, q.near, q.alpha], i * 4);
    aM.set([q.rise, q.dx, q.dz, q.rate], i * 4);
    aK.set([q.bright, q.fogK, q.stretch ?? 1], i * 3);
  });
  g.setAttribute("aP", new THREE.InstancedBufferAttribute(aP, 3));
  g.setAttribute("aD", new THREE.InstancedBufferAttribute(aD, 4));
  g.setAttribute("aM", new THREE.InstancedBufferAttribute(aM, 4));
  g.setAttribute("aK", new THREE.InstancedBufferAttribute(aK, 3));
  g.instanceCount = n;
  // The puffs move in the shader: bounds that hold them all.
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const q of list) {
    box.expandByPoint(v.set(q.p[0], q.p[1], q.p[2]));
    box.expandByPoint(v.set(q.p[0] + q.dx, q.p[1] + q.rise, q.p[2] + q.dz));
  }
  const maxS = list.reduce((m, q) => Math.max(m, q.size * (q.stretch ?? 1)), 0);
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  g.boundingSphere.radius += maxS * 1.5;
  plane.dispose();
  return g;
}

// ── Contract ─────────────────────────────────────────────────────────────────

/**
 * scene.userData.water, for the other look modules:
 *   swash          the sea's wash phase (the same object as the `swash` export).
 */
export interface WaterApi {
  swash: { value: number };
}

// ── Install ──────────────────────────────────────────────────────────────────

export const install: InstallFn = async (ctx: WorldCtx): Promise<WorldModule> => {
  const t0 = performance.now();
  const { root, scene } = ctx;
  root.updateMatrixWorld(true);
  const stats: Record<string, number | string> = {};
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const meshes: THREE.Object3D[] = [];
  /** The sea's and the ribbons' clock: it moves only while one is on screen. */
  const time = { value: 0 };
  /** The falls' clock (curtain, island falls, pool, puffs): every frame, 0 under reduced motion. */
  const fallsTime = { value: 0 };
  swash.value = 0;
  const noise = { value: getNoiseTexture(ctx.renderer) as THREE.Texture };

  // The ground, from surfaces.ts: height as drawn (for the ribbons) and the
  // height texture (for water depth). Without it, the heightfield.
  const surf = scene.userData.surfaces as SurfacesApi | undefined;
  const heightTex = surf ? surf.heightTexture : null;
  const hbU = surf
    ? surf.heightUV
    : new THREE.Vector4(WORLD.minX, WORLD.minZ, 1 / (WORLD.maxX - WORLD.minX), 1 / (WORLD.maxZ - WORLD.minZ));
  const drawn = surf ? surf.drawnHeight : terrainHeight;
  const coarseH = surf ? surf.gridHeight : terrainHeight;

  // ── Light-driven colours, read from light.ts's live state ───────────────────
  const skyLo = new THREE.Color(0.8, 0.8, 0.8);
  const skyHi = new THREE.Color(0.5, 0.6, 0.75);
  const sunCol = ctx.sunColor.clone();
  const sunDir = ctx.sunDir.clone().normalize();
  /** The sea's and the tarn's sun: sunDir / sunCol by day; at night the moon's path (applyLight). */
  const seaSunCol = sunCol.clone();
  const seaSunDir = sunDir.clone();
  /** How much the sea's glints show: 1 by day, NIGHT_WATER.moonGlint at night 1. */
  const seaGlint = { value: 1 };
  /** The night layer's moon path: its share (0 by day) and NIGHT_WATER.pathPow. */
  const seaPath = { value: new THREE.Vector2(0, NIGHT_WATER.pathPow) };

  // ── Sea (and the tarn, the same program) ───────────────────────────────────
  const seaMatFor = (name: string, level: number): THREE.ShaderMaterial => {
    const m = new THREE.ShaderMaterial({
      name,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uLevel: { value: level },
          uDeep: { value: lin(WATER_C.sea) },
          uShallow: { value: lin(WATER_C.seaShallow) },
          uFoam: { value: lin(WATER_C.foam) },
          uSkyK: { value: 1 },
        },
      ]),
      vertexShader: WATER_VERT,
      fragmentShader: SEA_FRAG,
    });
    // Shared by reference (merge() clones values). The sea's sun is its own
    // pair (the sun's own by day): at night its glints follow the moon.
    Object.assign(m.uniforms, {
      uTime: time,
      uSwash: swash,
      uHeight: { value: heightTex },
      uNoise: noise,
      uHB: { value: hbU },
      uSunDir: { value: seaSunDir },
      uSunCol: { value: seaSunCol },
      uSkyLo: { value: skyLo },
      uSkyHi: { value: skyHi },
      uGlintK: seaGlint,
      uPath: seaPath,
    });
    mats.push(m);
    return m;
  };
  const seaMat = seaMatFor("SurfSea", WORLD.seaLevel);
  const seaGeo = new THREE.PlaneGeometry(WORLD.maxX - WORLD.minX + 12000, WORLD.maxZ - WORLD.minZ + 12000, 1, 1);
  seaGeo.rotateX(-Math.PI / 2);
  geos.push(seaGeo);
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.name = "Sea";
  sea.position.set((WORLD.minX + WORLD.maxX) / 2, WORLD.seaLevel, (WORLD.minZ + WORLD.maxZ) / 2);
  // Cheap laptops (overdraw): the sea is the backmost solid under the whole
  // world, so it draws after every other solid (the sky, light.ts, is 1000):
  // where land or an island covers it, its fragments fail the depth
  // test instead of being shaded (a3 average 2.15 -> 2.03, a7 too).
  sea.renderOrder = 900;
  root.add(sea);
  meshes.push(sea);

  // ── Flowing water: river, stream, brook, the glowing stream ────────────────
  const flowMat = (name: string, speed: number, white: number, look = 0): THREE.ShaderMaterial => {
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
          uSpeed: { value: speed },
          uWhite: { value: white },
          uLook: { value: look },
          // How much a fast drop turns to white water (the glowing stream runs
          // down an open hill, and at 1 it was one flat cream ribbon: fix-2).
          uRoughK: { value: 1 },
          // How much of the sky the look-1 body takes (a ribbon on a slope seen
          // from across the lake is all grazing angle: fix-2).
          uSheen: { value: 1 },
          // (fix-3) the glowing stream's wild banks and dark water (1 / 1: the other ribbons, unchanged).
          uWild: { value: 0 },
          uDim: { value: 1 },
          uEndFade: { value: new THREE.Vector2(1e9, 2e9) },
          uTeal: { value: lin(WATER_C.teal) },
          uJadeC: { value: lin(WATER_C.jade) },
          uBody: { value: lin(WATER_C.river) },
          uFoam: { value: lin(WATER_C.foam) },
          uGlow: { value: lin(WATER_C.glow).multiplyScalar(1.1) },
        },
      ]),
      vertexShader: WATER_VERT,
      fragmentShader: FLOW_FRAG,
    });
    Object.assign(m.uniforms, { uTime: time, uNoise: noise, uSunDir: { value: sunDir }, uSunCol: { value: sunCol }, uSkyLo: { value: skyLo }, uSkyHi: { value: skyHi } });
    mats.push(m);
    return m;
  };
  const ribbons: THREE.Mesh[] = [];
  const pool = WORLD.pool;
  const F = WORLD.falls;
  const U = WORLD.upperFalls;
  const addRibbon = (name: string, spec: RibbonSpec, mat: THREE.ShaderMaterial) => {
    const g = buildRibbon(spec, drawn);
    if (!g) return;
    geos.push(g);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    mesh.renderOrder = 1;
    root.add(mesh);
    ribbons.push(mesh);
    meshes.push(mesh);
    stats[`${name}Tris`] = (g.index ? g.index.count : 0) / 3;
  };
  const r0 = performance.now();
  // One program for the stream, the brook and the glowing stream (same defines):
  // their looks differ by uniforms. The river compiles its own (POOL_LOOK).
  // (15b) The river is the pool's water running out of it: the pool's colours
  // and sky (POOL_LOOK), starting inside the pool, just over its water, and fading
  // in there (uJoin), so the pool turns into the river with no edge between them.
  const riverMat = flowMat("SurfRiver", 26, 0.1, 1);
  riverMat.defines.POOL_LOOK = "";
  riverMat.uniforms.uTeal.value = lin(WATER_C.pool);
  riverMat.uniforms.uJadeC.value = lin(WATER_C.poolJade);
  // The river's length along its curve, as buildRibbon measures it (its skip gets a share of it).
  let riverLen = 0;
  {
    // Where the join's distances from the pool's middle fall along the curve.
    const c = new THREE.CatmullRomCurve3(RIVER.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, "centripetal");
    const L = c.getLength();
    riverLen = L;
    const v = new THREE.Vector3();
    const sAt = (dist: number) => {
      for (let i = 0; i <= 400; i++) {
        c.getPointAt(i / 400, v);
        if (Math.hypot(v.x - pool.x, v.z - pool.z) >= dist) return (i / 400) * L;
      }
      return L;
    };
    const J = RIVER_JOIN;
    riverMat.uniforms.uJoin = { value: new THREE.Vector4(sAt(pool.r - J.inside), sAt(pool.r - J.full), sAt(pool.r - J.inside), sAt(pool.r + J.run)) };
    // (review round 1) Out into the sea's own water at its mouth (RIVER_SEA).
    const sSea = riverCoast(drawn);
    if (Number.isFinite(sSea)) riverMat.uniforms.uEndFade.value.set(sSea - RIVER_SEA.fadeIn, sSea + RIVER_SEA.fadeOut);
  }
  addRibbon(
    "River",
    {
      pts: RIVER,
      halfW: () => RIVER_HW,
      lift: 0.5,
      // Flat over the pool, J.lift over its water, easing down to the river's own line past the rim.
      level: (x, y, z) => y + Math.max(0, POOL_SURFACE + RIVER_JOIN.lift - y) * (1 - smooth(pool.r, pool.r + RIVER_JOIN.ramp, Math.hypot(x - pool.x, z - pool.z))),
      // Not inside the pool, and not out at sea past its mouth (RIVER_SEA).
      skip: (x, z, along) => Math.hypot(x - pool.x, z - pool.z) < pool.r - RIVER_JOIN.inside || riverPastSea(along * riverLen, drawn),
    },
    riverMat,
  );
  const streamMat = flowMat("SurfStream", 34, 0.16, 1);
  {
    // Where the ribbon's skip round the lip starts, measured along the curve.
    const c = new THREE.CatmullRomCurve3(STREAM.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, "centripetal");
    const L = c.getLength();
    const v = new THREE.Vector3();
    let sEnd = L;
    for (let i = 200; i >= 0; i--) {
      c.getPointAt(i / 200, v);
      if (Math.hypot(v.x - F.top[0], v.z - F.top[2]) >= APPROACH_LEN - 10) {
        sEnd = (i / 200) * L;
        break;
      }
    }
    streamMat.uniforms.uEndFade.value.set(sEnd - 14, sEnd - 1);
  }
  addRibbon(
    "Stream",
    {
      pts: STREAM,
      // (fix-3) Flat across and wider than the channel's floor: the terrain's
      // banks cut the water off where they rise out of it (a shore that follows
      // the ground). At min(48, W - 1) its straight edge hung over the floor.
      halfW: (a) => streamHalfW(a) + APPROACH_BANK,
      lift: 0.5,
      ground: () => -Infinity,
      // Out of the tarn, and short of the lip: the curtain's own approach takes over there.
      skip: (x, z) => Math.hypot(x - F.top[0], z - F.top[2]) < APPROACH_LEN - 10 || Math.hypot(x - U.tarn.x, z - U.tarn.z) < U.tarn.r - 8,
    },
    streamMat,
  );
  // Item 15c: carried on into the lake and faded out across the shore, so it
  // meets the lake in the lake's colour (Lovro: "It should mesh together").
  const brookPts = toLake(BROOK);
  const brookMat = flowMat("SurfBrook", 18, 0.08);
  brookMat.uniforms.uEndFade.value.set(...mouthFade(brookPts));
  addRibbon(
    "Brook",
    {
      pts: brookPts,
      // Laid over the brook's carved bed (bilinear grid + 1.2), a little above and wider.
      halfW: (a) => brookHalfW(a) + 1.5,
      lift: 1.4,
      ground: coarseH,
      level: (x, y, z) => Math.max(y + 0.6, coarseH(x, z) + 1.4),
      skip: pastMouth,
    },
    brookMat,
  );
  // The glowing stream: the stream's three-scale look (plain water by the lake,
  // glowing teal only where magicAt rises), little white water on the hill, and
  // about 30% narrower where it runs down the open hill (fix-2: at a5 it was a
  // flat cream ribbon and the brightest thing in the frame).
  // (fix-3) Lovro: "the little river from the side looks super random"; at a5 it
  // still read as a pale road down the hill, the brightest thing in the frame.
  // Now a narrow wild stream: it meanders (GLOW_MEANDER), its water sits dark in
  // the ground, its banks are ragged and broken by stones (uWild, uDim), and
  // it glows only toward the forest.
  const glowMat = flowMat("SurfGlowStream", 14, 0.0, 1);
  glowMat.uniforms.uRoughK.value = 0.06;
  glowMat.uniforms.uSheen.value = 0.12;
  glowMat.uniforms.uWild.value = 1;
  glowMat.uniforms.uDim.value = GLOW_DIM;
  // Item 15c: down to the lake's water wherever the shore lies, faded into it.
  const glowPts = toLake(meander(GLOW_STREAM));
  glowMat.uniforms.uEndFade.value.set(...mouthFade(glowPts));
  addRibbon(
    "GlowStream",
    {
      pts: glowPts,
      halfW: (a) => (4 + 3.5 * a) * (1 - 0.25 * smooth(0.2, 0.45, a)),
      lift: 1.2,
      // Following the ground (the meander leaves the layout's line, and the
      // line's y would float it over the low side of the slope).
      level: (x, _y, z) => drawn(x, z) + 1.2,
      skip: pastMouth,
      magic: (x, z) => smooth(0.2, 0.7, magicAt(x, z)),
    },
    glowMat,
  );
  // (fix-3) No cover growing up through the water near the lip (the grass
  // stood in the channel under the approach); the banks keep theirs.
  addPathLine(
    STREAM.slice(-3).map((p) => [p[0], p[2]] as const),
    44,
    "water",
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
    // water.ts: the lake's shore. Shallow water reflects less and shows a
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

  // ── The falls: the curtain, the pool, the puffs, the island falls ─────────
  const curtainU = {
    uSunSide: { value: 0 },
    uSunFront: { value: 0.3 },
    uDay: { value: 1 },
    uLit: { value: lin(WATER_C.curtainLit) },
    uShade: { value: lin(WATER_C.curtainShade) },
    uSky: { value: skyLo },
    uSkyHi: { value: skyHi },
    uFoamC: { value: lin(WATER_C.foam) },
    uTeal: { value: lin(WATER_C.teal) },
    uJadeC: { value: lin(WATER_C.jade) },
  };
  // (15b) The river takes the day's light from the same live value as the pool.
  riverMat.uniforms.uDay = curtainU.uDay;
  /** Final pass C: the camera's distance in front of the sheet when it is low and close (1e4 elsewhere), for the close threads' scale. */
  const camDU = { value: 1e4 };
  /** Final pass D: the pass through the falls (x 0-1) and the camera's distance to the sheet (y), for the spray (CURTAIN_FRAG). */
  const thruU = { value: new THREE.Vector2(0, 1e4) };
  const fallH = F.top[1] - F.bottom[1];
  const curtainMatOf = (name: string, mode: "front" | "blend"): THREE.ShaderMaterial => {
    const m = new THREE.ShaderMaterial({
      name,
      fog: true,
      // The main falls: opaque, drawn first, so the cliff behind them is
      // never shaded. The island falls: blended, for their fade into the clouds.
      transparent: mode === "blend",
      depthWrite: true,
      side: THREE.DoubleSide,
      defines: mode === "front" ? { CURTAIN_CUT: "" } : {},
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: CURTAIN_VERT,
      fragmentShader: CURTAIN_FRAG,
    });
    // Shared by reference: applyLight() drives these.
    Object.assign(m.uniforms, curtainU, { uTime: fallsTime, uCamD: camDU, uThru: thruU });
    mats.push(m);
    return m;
  };
  const curtainMat = curtainMatOf("SurfCurtain", "front");
  const islandFallsMat = curtainMatOf("SurfIslandFalls", "blend");

  // The main sheet, built round the Falls' place (its landmark group's origin).
  const a3 = PLACES.find((p) => p.id === "a3")!;
  const a3Pos = new THREE.Vector3(a3.pos.x, a3.pos.y, a3.pos.z);
  // (fix-3) Lovro's "linear water" at the lip: the approach was a straight
  // 100 x 20 slab 5 over the channel's floor with one long straight near edge.
  // It now follows the stream's own curve back APPROACH_LEN from the lip and is
  // wider than the channel's floor, so the terrain's banks cut it off where
  // they rise out of the water (a curving shore), narrowing to the falls'
  // width over the last few units.
  const streamCurve = new THREE.CatmullRomCurve3(STREAM.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, "centripetal");
  const streamLen = streamCurve.getLength();
  const segLen = Math.hypot(STREAM[STREAM.length - 1][0] - STREAM[STREAM.length - 2][0], STREAM[STREAM.length - 1][2] - STREAM[STREAM.length - 2][2]);
  const upAt = (d: number) => clamp01(1 + d / streamLen);
  const tanV = new THREE.Vector3();
  const mainSheet: Sheet = {
    approach: APPROACH_LEN,
    height: fallH,
    seconds: CURTAIN.fallSeconds,
    fade: 0,
    width0: F.width,
    width1: F.width + 22,
    at(d, out) {
      // The stream reaches the lip from upstream along its own curve; the sheet
      // falls along the flow (v6: north, into the gorge).
      if (d < 0) {
        streamCurve.getPointAt(upAt(d), out);
        out.y = F.top[1] + 0.4;
      } else out.set(F.top[0], F.top[1] - d, CURTAIN.zAt(F.top[1] - d));
    },
    acrossAt(d) {
      streamCurve.getTangentAt(upAt(d), tanV);
      const L = Math.hypot(tanV.x, tanV.z) || 1;
      // The flow turned clockwise seen from above, as FLOW_ACROSS is.
      const tx = tanV.x / L;
      const tz = tanV.z / L;
      const k = smooth(-6, 0, d);
      const ax = -tz * (1 - k) + FLOW_ACROSS[0] * k;
      const az = tx * (1 - k) + FLOW_ACROSS[1] * k;
      const M = Math.hypot(ax, az) || 1;
      return [ax / M, az / M];
    },
    widthAt(d) {
      // The channel's floor half width there (terrain.ts's carve), plus a margin into the banks.
      const along = 1 + d / (segLen * (STREAM.length - 1));
      const bank = 2 * (streamHalfW(clamp01(along)) + APPROACH_BANK);
      return F.width + (bank - F.width) * smooth(0, -9, d);
    },
    // Across the sheet (the flow turned clockwise), so its bow bulges along the
    // flow, toward the camera riding down in front of it.
    across: [FLOW_ACROSS[0], FLOW_ACROSS[1]],
  };
  const curtainGeo = sheetGeometry([mainSheet], a3Pos, 14, 56, 10);
  geos.push(curtainGeo);
  const curtain = new THREE.Mesh(curtainGeo, curtainMat);
  curtain.name = "Landmark_a3_Water";
  curtain.renderOrder = -1;
  // Into the Falls' landmark group when it exists (it sits at the place's
  // base, unturned); until blocks.ts builds it, under the root at the place.
  const lmFalls = root.getObjectByName(a3.mesh);
  if (lmFalls) {
    curtain.position.copy(a3Pos).sub(lmFalls.position);
    lmFalls.add(curtain);
  } else {
    curtain.position.copy(a3Pos);
    root.add(curtain);
  }
  meshes.push(curtain);

  // The pool: a polar disc a little wider than the pool (the bank clips it),
  // displaced near the impact. (15b, review round 1) Its rim lies POOL_PAD past
  // the shore terrain.ts draws (poolShoreR, with its points of land), each
  // vertex moved along its radius, at POOL_SURFACE; aShore is how far inside
  // the shore a vertex lies (the swell and the shallows read it).
  const impact = new THREE.Vector2(F.bottom[0] + FLOW_DIR[0] * 4, F.bottom[2] + FLOW_DIR[1] * 4);
  const poolGeo = new THREE.RingGeometry(0.5, pool.r + POOL_PAD, 56, 18);
  poolGeo.rotateX(-Math.PI / 2);
  {
    const pos = poolGeo.getAttribute("position") as THREE.BufferAttribute;
    const shore = new Float32Array(pos.count);
    // RingGeometry lays its vertices ring by ring, 57 round each: the shore once per angle.
    const round = 56 + 1;
    const shoreAt = new Float32Array(round).fill(NaN);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const j = i % round;
      if (shoreAt[j] !== shoreAt[j]) shoreAt[j] = poolShoreR(Math.atan2(z, x));
      const R = shoreAt[j];
      const k = (R + POOL_PAD) / (pool.r + POOL_PAD);
      pos.setXYZ(i, x * k, 0, z * k);
      shore[i] = R - Math.hypot(x, z) * k;
    }
    poolGeo.setAttribute("aShore", new THREE.BufferAttribute(shore, 1));
    poolGeo.computeBoundingSphere();
  }
  geos.push(poolGeo);
  const poolU = {
    uImpact: { value: impact },
    uPool: { value: new THREE.Vector3(pool.x, pool.z, pool.r + POOL_PAD) },
    uLevel: { value: pool.y },
    uDeep: { value: lin(WATER_C.pool) },
    uJade: { value: lin(WATER_C.poolJade) },
    uBed: { value: lin(WATER_C.poolBed) },
    uFoam: { value: lin(WATER_C.foam) },
    uShade: { value: lin(WATER_C.curtainShade).multiplyScalar(0.7) },
    // (15b) the river's first reach, out of the pool: the shore's wobble stays off it.
    uOutlet: { value: new THREE.Vector2(RIVER[1][0] - RIVER[0][0], RIVER[1][2] - RIVER[0][2]).normalize() },
  };
  const poolMat = new THREE.ShaderMaterial({
    name: "SurfPool",
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    vertexShader: POOL_VERT,
    fragmentShader: POOL_FRAG,
  });
  Object.assign(poolMat.uniforms, poolU, {
    uTime: fallsTime,
    uDay: curtainU.uDay,
    uNoise: noise,
    uHeight: { value: heightTex },
    uHB: { value: hbU },
    uSky: { value: skyLo },
    uSkyHi: { value: skyHi },
    uSunDir: { value: sunDir },
    uSunCol: { value: sunCol },
  });
  mats.push(poolMat);
  const poolMesh = new THREE.Mesh(poolGeo, poolMat);
  poolMesh.name = "Pool";
  poolMesh.position.set(pool.x, POOL_SURFACE, pool.z);

  // Puffs: one program, three meshes.
  const puffU = { uLitC: { value: new THREE.Color(0.85, 0.83, 0.78) }, uShadeC: { value: new THREE.Color(0.5, 0.55, 0.6) } };
  const puffMatOf = (name: string, u: Record<string, { value: unknown }>): THREE.ShaderMaterial => {
    const m = new THREE.ShaderMaterial({
      name,
      fog: true,
      transparent: true,
      depthWrite: false,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
    });
    Object.assign(m.uniforms, u, { uTime: fallsTime, uNoise: noise, uSunDir: { value: sunDir } });
    mats.push(m);
    return m;
  };
  // Spray and the island's puffs: no far veil.
  const puffMat = puffMatOf("SurfPuff", { ...puffU, uVeil: { value: new THREE.Vector4(-2, -1, 1, 0) }, uHFade: { value: new THREE.Vector4(1e9, 1e9, 1e9, 2e9) } });
  // The plume: the same program (same source), its own white and blue grey, the veil and the top fade.
  const plumeU = {
    uLitC: { value: lin(PLUME_LIT) },
    uShadeC: { value: lin(PLUME_SHADE) },
    uVeil: { value: new THREE.Vector4(PLUME.veil[0], PLUME.veil[1], PLUME.veil[2], PLUME.litBias) },
    // The top 30% or so of the column fades out (set once the column's base is known, below).
    uHFade: { value: new THREE.Vector4(pool.x, pool.z, 1e9, 2e9) },
  };
  const plumeMat = puffMatOf("SurfPlume", plumeU);
  // Spray at the foot: rising and fading over 2-4 s (bible 2.4), invisible inside 30.
  const sprayList: Puff[] = [];
  for (let i = 0; i < SPRAY_N; i++) {
    const along = (rnd(i, 41) - 0.5) * (F.width + 30);
    sprayList.push({
      p: [F.bottom[0] + FLOW_ACROSS[0] * along + FLOW_DIR[0] * (6 + rnd(i, 42) * 26), pool.y + 3, F.bottom[2] + FLOW_ACROSS[1] * along + FLOW_DIR[1] * (6 + rnd(i, 42) * 26)],
      size: 20 + rnd(i, 43) * 16,
      seed: rnd(i, 44),
      near: 80,
      alpha: 0.24,
      rise: 30 + rnd(i, 46) * 28,
      dx: FLOW_DIR[0] * 14,
      dz: FLOW_DIR[1] * 14,
      rate: 0.25 + rnd(i, 45) * 0.22,
      bright: 1,
      fogK: 1,
    });
  }
  const sprayGeo = puffGeometry(sprayList);
  geos.push(sprayGeo);
  const spray = new THREE.Mesh(sprayGeo, puffMat);
  spray.name = "FallsSpray";
  spray.renderOrder = 3;

  // The plume: a column over the pool rising above the rim, drifting east
  // (bible 1.1, the opening's focal point), and the Upper Falls' landing mist.
  const plumeList: Puff[] = [];
  // Final pass D: instance 0 is the bloom as the camera goes through the
  // falls: one soft white puff (the plume's white) that update() holds in
  // front of the lens (alpha 0, so never rasterised, the rest of the time).
  // Seed under PLUME_VEIL_KEEP, so the veil's subset keeps it.
  plumeList.push({ p: [F.bottom[0], pool.y + 20, F.bottom[2]], size: BLOOM.size, seed: 0.37, near: 1, alpha: 0, rise: 0, dx: 0, dz: 0, rate: 0, bright: BLOOM.bright, fogK: 0 });
  // Final pass C: a broad bank of spray over the whole width of the gorge at
  // the falls, instead of one leaning column (the judges read the column as
  // wildfire smoke). Rows along the gorge from the falls' face downstream:
  // a dense white boil cresting the rim, a wider bank above it, puffs lifting
  // off the bank and fading as they drift east, and a soft crown. Whitest at
  // its foot (spray is densest where the water lands; smoke is thinnest at
  // its source), wider than tall.
  const [gx, gz] = PLUME_GORGE;
  plumeU.uHFade.value.z = PLUME.top - PLUME.taper;
  plumeU.uHFade.value.w = PLUME.top + 160;
  let seedN = 0;
  for (const row of PLUME_BANK) {
    for (let i = 0; i < row.n; i++) {
      const j = seedN++;
      const k = row.n > 1 ? i / (row.n - 1) : 0.5;
      // Along the gorge (from the falls' face, t < 0 behind the pool, downstream t > 0), and a little across it.
      const t = row.from + (row.to - row.from) * k + (rnd(j, 51) - 0.5) * 40;
      const across = (rnd(j, 52) - 0.5) * row.across;
      plumeList.push({
        p: [pool.x + gx * t - gz * across, row.y + rnd(j, 55) * row.dy, pool.z + gz * t + gx * across],
        size: row.size + rnd(j, 53) * row.dsize,
        stretch: row.stretch,
        seed: rnd(j, 54),
        near: PLUME.fadeNear,
        alpha: row.alpha,
        rise: row.rise,
        dx: gx * row.drift,
        dz: gz * row.drift,
        rate: row.rate > 0 ? row.rate * (0.8 + 0.4 * rnd(j, 56)) : 0,
        bright: row.bright,
        // A small share of the fog: at 3,300 the full ramp greys it to the haze.
        fogK: row.fogK,
      });
    }
  }
  U.drops.forEach(([x, top, z, w, fall], i) => {
    const [fx, fz] = dirOf(U.flow);
    const out = 10 * Math.sqrt(1) + 6;
    plumeList.push({
      p: [x + fx * out, top - fall + 6, z + fz * out],
      size: w * 0.9,
      seed: rnd(i, 61),
      near: 300,
      alpha: 0.45,
      rise: 0,
      dx: 0,
      dz: 0,
      rate: 0,
      bright: 1.08,
      fogK: 0.5,
    });
  });
  const plumeGeo = puffGeometry(plumeList);
  geos.push(plumeGeo);
  const plume = new THREE.Mesh(plumeGeo, plumeMat);
  plume.name = "FallsPlume";
  plume.renderOrder = 3;

  // The Upper Falls: three cream drops and the tarn (the sea's program).
  const upperU = {
    uFogK: { value: 0.55 },
    uLit: { value: lin(WATER_C.upper) },
    uShade: { value: lin(WATER_C.curtainShade) },
    uFoamC: { value: lin(WATER_C.foam) },
  };
  const upperMat = new THREE.ShaderMaterial({
    name: "SurfUpperFalls",
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    vertexShader: CURTAIN_VERT,
    fragmentShader: UPPER_FRAG,
  });
  Object.assign(upperMat.uniforms, upperU, { uTime: fallsTime });
  mats.push(upperMat);
  const upperSheets: Sheet[] = U.drops.map(([x, top, z, w, fall]) => {
    const [fx, fz] = dirOf(U.flow);
    const [ax, az] = dirOf(U.flow + 90);
    return {
      approach: 14,
      height: fall,
      seconds: 2.4,
      fade: 0 as const,
      width0: w * 0.7,
      width1: w * 0.95,
      at(d: number, o: THREE.Vector3) {
        if (d < 0) o.set(x + fx * d, top + 0.5, z + fz * d);
        else {
          const out = 10 * Math.sqrt(d / fall) + 1.5;
          o.set(x + fx * out, top - d, z + fz * out);
        }
      },
      across: [ax, az] as [number, number],
    };
  });
  const upperGeo = sheetGeometry(upperSheets, new THREE.Vector3(), 6, 12, 2);
  geos.push(upperGeo);
  const upperFalls = new THREE.Mesh(upperGeo, upperMat);
  upperFalls.name = "UpperFalls";
  upperFalls.renderOrder = 2;
  const tarnMat = seaMatFor("SurfTarn", U.tarn.y);
  const tarnGeo = new THREE.CircleGeometry(U.tarn.r + 14, 32);
  tarnGeo.rotateX(-Math.PI / 2);
  geos.push(tarnGeo);
  const tarn = new THREE.Mesh(tarnGeo, tarnMat);
  tarn.name = "UpperTarn";
  tarn.position.set(U.tarn.x, U.tarn.y, U.tarn.z);

  // The island's falls: from the rills' rim ends all the way down to the cloud
  // level, fading with noise over the last 15 percent (bible 2.4, 1.17).
  const I = WORLD.island;
  const islandDrop = I.y - WORLD.cloudLevel;
  const islandSheets: Sheet[] = ISLAND_RILLS.map((rill, k) => {
    const end = rill[rill.length - 1];
    const prev = rill[rill.length - 2];
    let dx = end[0] - prev[0];
    let dz = end[2] - prev[2];
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    const rx = end[0];
    const rz = end[2];
    const h = islandDrop + 20;
    return {
      approach: 60,
      height: h,
      seconds: 5.2,
      fade: 1 as const,
      // Final pass B (judge: from a5 and a6 these were 1 px scratches): a
      // little wider at the rim, fanning out 3x as they fall.
      width0: (24 - k * 3) * 1.4,
      width1: (46 - k * 4) * 3,
      at(d: number, out: THREE.Vector3) {
        if (d < 0) out.set(rx + dx * d, I.y + 0.5, rz + dz * d);
        else {
          const throwOut = 34 * Math.sqrt(d / h);
          out.set(rx + dx * throwOut, I.y - d, rz + dz * throwOut);
        }
      },
      across: [-dz, dx] as [number, number],
    };
  });
  const islandGeo = sheetGeometry(islandSheets, new THREE.Vector3(), 10, 48, 4);
  geos.push(islandGeo);
  const islandFalls = new THREE.Mesh(islandGeo, islandFallsMat);
  islandFalls.name = "IslandFalls";
  islandFalls.renderOrder = 2;
  // 6 to 10 cloud puffs where each fall meets the cloud sea.
  const islandPuffs: Puff[] = [];
  islandSheets.forEach((s, k) => {
    const c = new THREE.Vector3();
    s.at(s.height * 0.92, c);
    // Final pass B: a mist plume where each fall meets the cloud sea, big
    // enough to read from a5 and a6 (the falls fade into it).
    for (let i = 0; i < 6; i++) {
      islandPuffs.push({
        p: [c.x + (rnd(i + k * 7, 71) - 0.5) * 110, WORLD.cloudLevel + 10 + rnd(i + k * 7, 72) * 60, c.z + (rnd(i + k * 7, 73) - 0.5) * 110],
        size: 110 + rnd(i + k * 7, 74) * 90,
        seed: rnd(i + k * 7, 75),
        near: 160,
        alpha: 0.7,
        rise: 0,
        dx: 0,
        dz: 0,
        rate: 0,
        bright: 1,
        fogK: 1,
      });
    }
  });
  const islandMistGeo = puffGeometry(islandPuffs);
  geos.push(islandMistGeo);
  const islandMist = new THREE.Mesh(islandMistGeo, puffMat);
  islandMist.name = "IslandMist";
  islandMist.renderOrder = 3;

  // Zones the terrain hides wholesale (blocks.ts's Zone_south and Zone_sky).
  const southZone = new THREE.Group();
  southZone.name = "Water_south";
  southZone.add(poolMesh, spray, plume, upperFalls, tarn);
  const skyZone = new THREE.Group();
  skyZone.name = "Water_sky";
  skyZone.add(islandFalls, islandMist);
  root.add(southZone, skyZone);
  meshes.push(southZone, skyZone);
  root.updateMatrixWorld(true);

  // ── Quality: puff counts by tier (bible 3.2 "Particles and mist") ──────────
  const applyQuality = (q: QualityTier) => {
    const k = clamp01(q.particles);
    sprayGeo.instanceCount = Math.max(6, Math.round(sprayList.length * k));
    // The plume is the opening's focal point: it keeps its column, thinning at most by half.
    plumeGeo.instanceCount = plumeList.length;
    islandMistGeo.instanceCount = Math.max(4, Math.round(islandPuffs.length * Math.max(0.5, k)));
  };
  applyQuality(ctx.quality);

  // ── Per-frame light ────────────────────────────────────────────────────────
  const tmpC = new THREE.Color();
  const across = new THREE.Vector2(FLOW_ACROSS[0], FLOW_ACROSS[1]); // the main sheet's across direction (mainSheet above)
  let lastSig = NaN;
  /** The night the sea and the tarn were last set for (0: their day colours, untouched). */
  let seaNight = 0;
  function applyLight(): boolean {
    const s = lightStateOf(scene);
    const sd = s ? s.sunDir : ctx.sunDir;
    const sc = s ? s.sunColor : ctx.sunColor;
    const nk = s?.night ?? 0;
    // The night layer's moon path: the water's glints and lit side follow the
    // moon's disc where the night shows it (by day, and from the island on,
    // nk is 0 and this is the sun's, as it always was).
    const moonK = s && s.moonDir && s.moonColor ? nk * clamp01(s.moonVis ?? 0) : 0;
    const md = moonK > 0 ? s!.moonDir! : null;
    const sig = sd.x * 7.1 + sd.y * 3.3 + sd.z * 1.7 + sc.r * 2.9 + sc.g * 5.3 + (s ? s.skyHorizon.r * 11 + s.haze.g * 13 : 0) + nk * 17.3 + (md ? md.x * 19.1 + md.y * 23.3 + moonK * 29.7 : 0);
    if (sig === lastSig) return false;
    lastSig = sig;
    sunDir.copy(sd).normalize();
    const dayK = s ? clamp01((s.sunIntensity / 4.5) * smooth(-3, 6, s.sunEl)) : 1;
    sunCol.copy(sc).multiplyScalar(0.35 + 0.9 * dayK);
    seaSunDir.copy(sunDir);
    seaSunCol.copy(sunCol);
    seaGlint.value = 1;
    seaPath.value.x = 0;
    if (md) {
      seaSunDir.lerp(md, moonK).normalize();
      seaSunCol.lerp(tmpC.copy(s!.moonColor!).multiplyScalar(NIGHT_WATER.moonPath), moonK);
      seaGlint.value = 1 - (1 - NIGHT_WATER.moonGlint) * moonK;
      seaPath.value.x = moonK;
    }
    if (s) {
      skyLo.copy(s.skyHorizon).lerp(s.haze, 0.35);
      skyHi.copy(s.skyMid).lerp(s.skyTop, 0.5);
    } else {
      skyLo.copy(ctx.hazeColor);
      skyHi.copy(ctx.hazeColor).multiplyScalar(0.8);
    }
    // The curtain faces along the flow (v6: north); the sun side runs across it.
    const front = sunDir.x * FLOW_DIR[0] + sunDir.z * FLOW_DIR[1];
    const sideLen = Math.hypot(sunDir.x, sunDir.z) || 1;
    curtainU.uSunFront.value = 0.15 + 0.55 * smooth(-0.5, 0.6, front) * dayK;
    curtainU.uSunSide.value = ((sunDir.x * across.x + sunDir.z * across.y) / sideLen) * 0.9 * dayK;
    // The night layer (light.ts state.night; 0 by day and from the island on):
    // uDay follows the fill, which the night raises so the land reads, and the
    // falls, the mist, the plume and the spray stayed white at night as if lit
    // from inside. Each takes NIGHT_WATER's share less light at night 1; uDay
    // carries the curtain's, the river's, the pool's and the spray's.
    const nd = (k: number) => 1 - k * nk;
    curtainU.uDay.value = (0.3 + 0.7 * (s ? clamp01(0.35 * s.hemiIntensity + 0.75 * dayK) : 1)) * nd(NIGHT_WATER.falls);
    curtainU.uLit.value.copy(lin(WATER_C.curtainLit)).lerp(tmpC.copy(sc).multiplyScalar(0.95), 0.2);
    curtainU.uShade.value.copy(lin(WATER_C.curtainShade)).lerp(skyLo, 0.25);
    // The night layer: the curtain's dark stripes toward its lit colour
    // (NIGHT_WATER.stripes), or under the night's navy sky the falls read as a
    // striped curtain (dark stripes 64 against highlights 155; by day 1.4 to 1).
    if (nk > 0) curtainU.uShade.value.lerp(curtainU.uLit.value, NIGHT_WATER.stripes * nk);
    // Puffs: lit by the sun's colour, shaded in the sky's; dimmer at night.
    puffU.uLitC.value.copy(lin(WATER_C.foam)).lerp(tmpC.copy(sc), 0.35).multiplyScalar((0.25 + 0.75 * curtainU.uDay.value) * nd(NIGHT_WATER.puffs));
    puffU.uShadeC.value.copy(skyHi).lerp(skyLo, 0.5).multiplyScalar(0.72 * curtainU.uDay.value * nd(NIGHT_WATER.puffs));
    // The plume: warm white on the sun side (only a touch of the sun's colour), pale blue grey in shade.
    plumeU.uLitC.value.copy(lin(PLUME_LIT)).lerp(tmpC.copy(sc), PLUME_SUN_TINT).multiplyScalar((0.3 + 0.7 * curtainU.uDay.value) * nd(NIGHT_WATER.plume));
    plumeU.uShadeC.value.copy(lin(PLUME_SHADE)).lerp(skyHi, 0.12).multiplyScalar((0.3 + 0.7 * curtainU.uDay.value) * nd(NIGHT_WATER.plume));
    // The Upper Falls: cream, catching the sun's colour.
    upperU.uLit.value.copy(lin(WATER_C.upper)).lerp(tmpC.copy(sc), 0.2).multiplyScalar((0.4 + 0.7 * curtainU.uDay.value) * nd(NIGHT_WATER.upper));
    upperU.uShade.value.copy(skyLo).lerp(lin(WATER_C.curtainShade), 0.4).multiplyScalar(0.9 * curtainU.uDay.value * nd(NIGHT_WATER.upper));
    poolU.uShade.value.copy(skyHi).lerp(lin(WATER_C.curtainShade), 0.5).multiplyScalar(0.65);
    const sl = s ? s.water : null;
    if (sl) (seaMat.uniforms.uDeep.value as THREE.Color).copy(lin(WATER_C.sea)).lerp(sl, 0.4);
    // The sea and the tarn are unlit (their body and foam are fixed colours),
    // so the night's higher exposure lit them brighter than by day: an electric
    // blue sea with a white rim. At night 1 they keep NIGHT_WATER.sea of their
    // body and NIGHT_WATER.foam of their foam; by day they are exactly as set.
    if (nk > 0 || seaNight > 0) {
      seaNight = nk;
      for (const m of [seaMat, tarnMat]) {
        const u = m.uniforms;
        if (m !== seaMat || !sl) (u.uDeep.value as THREE.Color).copy(lin(WATER_C.sea));
        (u.uDeep.value as THREE.Color).multiplyScalar(nd(NIGHT_WATER.sea));
        (u.uShallow.value as THREE.Color).copy(lin(WATER_C.seaShallow)).multiplyScalar(nd(NIGHT_WATER.sea));
        (u.uFoam.value as THREE.Color).copy(lin(WATER_C.foam)).multiplyScalar(nd(NIGHT_WATER.foam));
        u.uSkyK.value = nd(NIGHT_WATER.seaSky);
      }
    }
    return true;
  }
  applyLight();

  // ── Water on screen: only then does a clock count as moving ────────────────
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const camPos = new THREE.Vector3();
  const fwdV = new THREE.Vector3();
  let bloomAt = 0;
  const onScreen = (m: THREE.Mesh) => {
    if (!m.visible || !m.parent) return false;
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    sphere.copy(g.boundingSphere!).applyMatrix4(m.matrixWorld);
    return frustum.intersectsSphere(sphere);
  };
  /** In the frustum AND within `reach` of the camera (blocks.ts's test). */
  const inView = (s: THREE.Sphere, reach: number) => camPos.distanceTo(s.center) - s.radius < reach && frustum.intersectsSphere(s);
  const fallsSphere = new THREE.Sphere(new THREE.Vector3(F.top[0] + FLOW_DIR[0] * 30, (F.top[1] + F.bottom[1]) / 2, (F.top[2] + F.bottom[2]) / 2 + FLOW_DIR[1] * 30), 270);
  const islandFallsSphere = islandGeo.boundingSphere!.clone();
  const plumeSphere = plumeGeo.boundingSphere!.clone();
  // ...and for the falls, not hidden by the rim: Base Camp is 1,100 away with
  // the falls in its frustum, behind 300 of rock. A few terrain rays, redone
  // only when the camera has moved.
  const FALLS_PTS = [0.02, 0.35, 0.7, 0.98].map((f) => {
    const y = F.top[1] - f * fallH;
    return new THREE.Vector3(F.top[0] + FLOW_DIR[0] * 3, y, CURTAIN.zAt(y) + FLOW_DIR[1] * 3);
  });
  const lastSeenAt = new THREE.Vector3(1e9, 0, 0);
  let fallsSeen = false;
  const fallsVisible = (): boolean => {
    if (camPos.distanceToSquared(lastSeenAt) < 25) return fallsSeen;
    lastSeenAt.copy(camPos);
    fallsSeen = FALLS_PTS.some((q) => {
      const d = camPos.distanceTo(q);
      const n = Math.max(2, Math.ceil(d / 15));
      for (let i = 1; i < n; i++) {
        const f = i / n;
        const x = camPos.x + (q.x - camPos.x) * f;
        const yy = camPos.y + (q.y - camPos.y) * f;
        const z = camPos.z + (q.z - camPos.z) * f;
        if (terrainHeight(x, z) > yy + 2) return false;
      }
      return true;
    });
    return fallsSeen;
  };
  let animating = false;

  const api: WaterApi = { swash };
  scene.userData.water = api;

  let tris = 0;
  for (const g of [seaGeo, ...ribbons.map((r) => r.geometry), curtainGeo, poolGeo, islandGeo, upperGeo, tarnGeo]) tris += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  stats.triangles = Math.round(tris + (sprayList.length + plumeList.length + islandPuffs.length) * 2);
  stats.sprayPuffs = sprayList.length;
  stats.plumePuffs = plumeList.length;
  stats.islandPuffs = islandPuffs.length;
  stats.curtainTris = (curtainGeo.index ? curtainGeo.index.count : 0) / 3;
  stats.poolTris = (poolGeo.index ? poolGeo.index.count : 0) / 3;
  stats.islandFallsTris = (islandGeo.index ? islandGeo.index.count : 0) / 3;
  stats.upperFallsTris = (upperGeo.index ? upperGeo.index.count : 0) / 3;
  // sea, ribbons, curtain (front or back), pool, spray, plume, upper falls, tarn, island falls, island mist
  stats.drawCallsAdded = 1 + ribbons.length + 9;
  stats.programs = "sea, flow, river (flow with POOL_LOOK), curtain, island falls, pool, puff, upper";
  stats.installMs = Math.round(performance.now() - t0);

  let restored = 0;
  return {
    name: "water",
    afterAll() {
      // The real Upper Falls replace blocks.ts's stand-in.
      const standIn = root.getObjectByName("UpperFalls_StandIn") ?? scene.getObjectByName("UpperFalls_StandIn");
      if (standIn) standIn.visible = false;
      stats.upperStandIn = standIn ? "hidden" : "absent";
    },
    update(t: number): boolean {
      let changed = applyLight();
      // water.ts owns the curtain's look in every view (bible 4.0, 4.8): another
      // module that swaps its material gets it back.
      if (curtain.material !== curtainMat) {
        curtain.material = curtainMat;
        restored++;
        changed = true;
      }
      const cam = ctx.camera;
      cam.updateMatrixWorld();
      camPos.setFromMatrixPosition(cam.matrixWorld);
      // Where the camera is from the sheet: `behind` against the flow (negative
      // in front of it, in the gorge), `side` across it from its middle.
      const behind = -(camPos.z - fallsCurtainAt(Math.min(camPos.y, F.top[1]))[1]) * FLOW_DIR[1] - (camPos.x - F.top[0]) * FLOW_DIR[0];
      const side = Math.abs((camPos.x - F.top[0]) * FLOW_ACROSS[0] + (camPos.z - F.top[2]) * FLOW_ACROSS[1]);
      const camD = camPos.y < 130 && side < 110 ? Math.max(Math.abs(behind), 1) : 1e4;
      // Final pass D: close in front of the falls, gated on the camera looking
      // level-ish (the ride down the falls looks 40-71 degrees down, 136+ high)
      // and below the lip's stream (405+): the foot of the ride, as it levels out.
      cam.getWorldDirection(fwdV);
      const thruD = Math.max(Math.abs(behind), 1);
      const thruGate = (1 - smooth(150, 175, camPos.y)) * (1 - smooth(0.25, 0.38, -fwdV.y)) * (1 - smooth(55, 80, side));
      const thru = thruGate * (1 - smooth(20, 110, thruD));
      if (thru !== thruU.value.x || (thru > 0 && thruD !== thruU.value.y)) {
        thruU.value.set(thru, thruD);
        changed = true;
      }
      // The bloom: plume instance 0 in front of the lens, strongest as the camera
      // crosses. Up close the plume's veil scales alpha by veil[2] x PLUME_VEIL_GAIN; undone here.
      const bloomA = (BLOOM.alpha * thruGate * (1 - smooth(BLOOM.near, BLOOM.far, thruD))) / (PLUME.veil[2] * PLUME_VEIL_GAIN);
      if (bloomA > 0 || bloomAt > 0) {
        const aP = plumeGeo.getAttribute("aP") as THREE.InstancedBufferAttribute;
        const aD = plumeGeo.getAttribute("aD") as THREE.InstancedBufferAttribute;
        aP.setXYZ(0, camPos.x + fwdV.x * BLOOM.ahead, camPos.y + fwdV.y * BLOOM.ahead, camPos.z + fwdV.z * BLOOM.ahead);
        aD.setW(0, bloomA);
        aP.needsUpdate = true;
        aD.needsUpdate = true;
        bloomAt = bloomA;
        changed = true;
      }
      if (camD !== camDU.value) {
        camDU.value = camD;
        changed = true;
      }
      // The zones (blocks.ts's rules): the ridge crest runs at z 690-1000 and
      // 1,250-1,500 high, and the first places hide from inside the high basin.
      const sky = !(camPos.z > 1000 && camPos.y < 1200);
      const south = !(camPos.z < 300 && camPos.y < 1000);
      if (sky !== skyZone.visible || south !== southZone.visible) {
        skyZone.visible = sky;
        southZone.visible = south;
        changed = true;
      }
      fallsTime.value = ctx.reducedMotion ? 0 : t;
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
      if (moving) {
        time.value = t;
        swash.value = t * SWASH_RATE;
      }
      const fallsOn = south && ((inView(fallsSphere, 3000) && fallsVisible()) || inView(plumeSphere, 6000));
      if (fallsOn || (sky && inView(islandFallsSphere, 4000))) moving = true;
      animating = moving;
      return changed || moving;
    },
    isAnimating: () => animating && !ctx.reducedMotion,
    setQuality(tier: QualityTier) {
      applyQuality(tier);
    },
    // curtainIn: the group holding the curtain now (LM_Waterfall once blocks.ts has moved it).
    stats: () => ({ ...stats, curtainIn: curtain.parent ? curtain.parent.name || curtain.parent.type : "none", curtainRestored: restored }),
    dispose() {
      if (scene.userData.water === api) delete scene.userData.water;
      for (const m of meshes) m.parent?.remove(m);
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
};
