import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { CAVE_KEYS, FLIGHT_KEYS, PLACES, SHAFT_KEYS, TRAIL, TUNNEL_KEYS, WORLD, type LightKey } from "./layout";
import { terrainHeight } from "./terrain";

/**
 * V4 light: the time of day along the route, the sky, the clouds and the
 * Mirror Lake's reflection.
 *
 * The light follows the PLACE, not the student's progress: each place has a
 * keyframe (LIGHTS below, one row per LightKey) and the light blends between
 * the two stops the camera is between, by ctx.railU(). Golden afternoon at the
 * shore, sunset at the lake, dusk in the forest, night on the Sky Island and
 * over the rope bridge, dawn breaking DURING the flight (the sun comes up
 * ahead of the ship, just right of the Harbour Isle, and the cloud sea below
 * turns gold), morning at the Harbour Isle. The flight's dawn comes from
 * LIGHT_WAYPOINTS: keyframes placed at TRAIL keys between two stops.
 *
 * Glow: materials tagged material.userData.lightGlow = "lamp" | "magic" (and
 * any material named "V4BlockGlow", read as "lamp") have their .color set to
 * white x the live level every frame (state.lampGlow / state.magicGlow), so
 * lanterns and windows read as painted warm colour in daylight and as light
 * at dusk and night, and the forest's teal and violet only glow once the sun
 * is down. Hue stays in the vertex colours; the light owns .color.
 *
 * What it adds to the scene (4 draw calls, 3 in daylight, plus the lake's
 * reflection pass when the lake is on screen):
 *   LightSky     gradient dome pinned to the far plane: horizon, glow toward
 *                the sun, a mid band, the top; sun disc; moon disc and halo.
 *   LightStars   ~2,400 points pinned to the far plane, behind all terrain.
 *                Hidden while the keyframe has no stars.
 *   LightClouds  the cloud layer: three stacked translucent slices, one draw
 *                call, top at WORLD.cloudLevel. None inside WORLD.cloudClear
 *                (the high basin) or over the coastal shelf; a thick sea of
 *                cloud to the west under the island. Where a peak rises
 *                through a slice the slice thins out, so peaks come through
 *                softly instead of being cut by a flat plane.
 *   MirrorLake   a planar Reflector over WORLD.lake at half the screen's
 *                resolution. From stop 5 it shows the Sky Island upside down.
 *                It renders the reflection only when the camera is within
 *                REFLECT_RANGE of the lake and the lake is on screen.
 *   Lights       LightSun (directional), LightMoon (directional),
 *                LightRim (directional, placed each frame in front of the
 *                camera and above it, so at night the tops and edges of what
 *                you look at catch a cool line), LightFill (hemisphere),
 *                LightShade (ambient).
 *
 * It also sets scene.fog's colour and distances and the renderer's tone
 * mapping exposure every frame. Set handle.fogDistances = false if the scene
 * wants to schedule the fog distances itself; the colour stays owned here.
 *
 * railU: by default railU() is read as the TRAIL curve parameter t, so place i
 * sits at PLACES[i].trail / (TRAIL.length - 1). If the camera's railU means
 * something else (arc-length fraction, scroll fraction), pass ctx.placeU: the
 * railU value at each of the eight stops, in order.
 *
 * Nothing animates on its own: update() only does work when railU or the
 * camera moved, and the idle loop keeps sleeping.
 *
 * Draw calls: the reflection pass redraws whatever the mirrored camera sees.
 * Objects that should not appear in the lake (markers, tiny props) can go on
 * NO_REFLECT_LAYER; install() enables that layer on the main camera. Things
 * only the reflection should draw (a coarse terrain) go on REFLECT_ONLY_LAYER. The
 * reflection pass is counted into renderer.info for the frame (the nested
 * render no longer resets the outer frame's counters).
 */

// ── Tuning: one keyframe per LightKey ───────────────────────────────────────

/** Colours are display sRGB hex (converted to linear on load). Angles in degrees. */
export interface LightKeyframe {
  /** Compass azimuth toward the sun (0 = -z, 90 = +x) and elevation above the horizon. */
  sunAz: number;
  sunEl: number;
  sunColor: number;
  sunIntensity: number;
  /** Colour added around the sun in the sky (and the afterglow once it has set). */
  sunGlow: number;
  /** Where the moon disc is drawn. */
  moonAz: number;
  moonEl: number;
  /** Where the moonlight comes from. Kept apart from the disc on purpose: the
   *  disc sits where the camera sees it (in front, on the rise), the light
   *  comes from the side so the faces you look at are lit, not backlit. */
  moonLightAz: number;
  moonLightEl: number;
  moonColor: number;
  moonIntensity: number;
  /** 0..1: how much of the moon disc and its halo show. */
  moonVis: number;
  rimColor: number;
  rimIntensity: number;
  /** Sky: top of the dome, a band a few degrees up, the horizon away from the sun, the horizon toward it. */
  skyTop: number;
  skyMid: number;
  skyHorizon: number;
  skyGlow: number;
  /** Fog colour; the sky below the horizon. */
  haze: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambient: number;
  ambientIntensity: number;
  exposure: number;
  /** 0..1 star field brightness. */
  stars: number;
  /** Cloud colour at the lit top and at the shaded base. */
  cloudTop: number;
  cloudBase: number;
  /** The Mirror Lake's own colour under the reflection. */
  water: number;
  /** Multiplier on lamp glow (lanterns, windows, the campfire): 0.4 in daylight, where a lamp reads as warm paint, 1-1.1 at dusk and night (blocks' glow colours are already above 1). */
  lampGlow: number;
  /** Multiplier on the forest's magic glow (teal, violet): 0.15 in daylight (dark teal paint), 0.9-0.95 at dusk and night (higher bleaches the hue to white under ACES). */
  magicGlow: number;
}

/**
 * The eight places' light. The sun's direction is chosen per place for what
 * the camera sees there, not for a real sun path:
 *   a1  front-left of the view up the valley, so ridges are rim-lit
 *   a2  west-south-west. The lip view after it looks at the gorge's
 *       south-facing wall and the dive looks at the north-facing falls cliff;
 *       no one sun lights both, so the sun swings from WSW (a2) to WNW (a3)
 *       and each view on the way catches light on what it faces
 *   a3  west-north-west, low: it rakes across the falls cliff (which faces
 *       north) from the right of the frame
 *   a4  behind the camera, low: the north wall of the gorge glows
 *   a5  just left of the frame over the lake, so the reflection is a sunset
 *   a7  gone; the moon hangs over the island for the rise and the first half
 *       of the star look (MOON_AZ / MOON_EL), then the view swings past it
 *       into open stars
 *   a8  morning: the sun has come up ahead of the flight (az 338-350, just
 *       right of the Harbour Isle) and stands low ahead-right of the square
 *
 * The two afternoon keys (a1, a2) keep the fill low (hemi under 1, ambient
 * 0.1) and the sun strong and warm: the faces turned from the sun go dark,
 * so the foreground has value range instead of one flat grey (Lovro's N1).
 */
/** Moonlight from the south-west, high: side light for every night view (they face 265-318). */
const MOONLIGHT_AZ = 215;
const MOONLIGHT_EL = 38;
/**
 * The moon disc. The rise looks up along the steps at bearing 288 (pitch -14
 * to -30) and the star look starts at bearing 318, pitch -28: at 305 / 36 the
 * moon sits above the island in the one and upper left in the other, and the
 * star look's peak (bearing 0, pitch -44) has swung past it into open stars.
 */
const MOON_AZ = 305;
const MOON_EL = 36;

export const LIGHTS: Record<LightKey, LightKeyframe> = {
  "afternoon-gold": {
    sunAz: 285, sunEl: 13, sunColor: 0xffc890, sunIntensity: 4.6, sunGlow: 0xffc080,
    moonAz: 120, moonEl: 20, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, moonColor: 0xc8d4ff, moonIntensity: 0, moonVis: 0,
    rimColor: 0xffe0c0, rimIntensity: 0,
    skyTop: 0x7f9cc4, skyMid: 0xe2cfbc, skyHorizon: 0xf0d8bc, skyGlow: 0xffd49e,
    haze: 0xd6b99c, fogNear: 1400, fogFar: 8000,
    hemiSky: 0xa4acba, hemiGround: 0x3c3228, hemiIntensity: 0.85,
    ambient: 0x8e98a8, ambientIntensity: 0.1, exposure: 1.0, stars: 0,
    cloudTop: 0xfff0dc, cloudBase: 0xb0a8aa, water: 0x3a5264,
    lampGlow: 0.4, magicGlow: 0.15,
  },
  afternoon: {
    sunAz: 245, sunEl: 14, sunColor: 0xffd6a8, sunIntensity: 4.5, sunGlow: 0xffd4a0,
    moonAz: 120, moonEl: 20, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, moonColor: 0xc8d4ff, moonIntensity: 0, moonVis: 0,
    rimColor: 0xffe0c0, rimIntensity: 0,
    skyTop: 0x7f9dc6, skyMid: 0xd2dce2, skyHorizon: 0xe6e0d6, skyGlow: 0xffe6c0,
    haze: 0xcdc6bc, fogNear: 1300, fogFar: 7500,
    hemiSky: 0xa0acbe, hemiGround: 0x3e3429, hemiIntensity: 0.9,
    ambient: 0x96a0b0, ambientIntensity: 0.1, exposure: 1.0, stars: 0,
    cloudTop: 0xffffff, cloudBase: 0xb0b4bc, water: 0x3a5468,
    lampGlow: 0.4, magicGlow: 0.15,
  },
  "late-afternoon": {
    sunAz: 290, sunEl: 13, sunColor: 0xffc88c, sunIntensity: 3.4, sunGlow: 0xffb870,
    moonAz: 120, moonEl: 20, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, moonColor: 0xc8d4ff, moonIntensity: 0, moonVis: 0,
    rimColor: 0xffe0c0, rimIntensity: 0,
    skyTop: 0x8c98b8, skyMid: 0xe8c8a8, skyHorizon: 0xf0cca4, skyGlow: 0xffcc8a,
    haze: 0xd4b294, fogNear: 600, fogFar: 5200,
    hemiSky: 0xa09aa0, hemiGround: 0x5e4a3a, hemiIntensity: 1.5,
    ambient: 0x98a0b0, ambientIntensity: 0.3, exposure: 1.02, stars: 0,
    cloudTop: 0xffe8cc, cloudBase: 0xaea2a2, water: 0x3c5060,
    lampGlow: 0.45, magicGlow: 0.2,
  },
  "sunset-cliff": {
    sunAz: 228, sunEl: 5, sunColor: 0xffbe8a, sunIntensity: 3.0, sunGlow: 0xff9e58,
    moonAz: 120, moonEl: 20, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, moonColor: 0xc8d4ff, moonIntensity: 0, moonVis: 0,
    rimColor: 0xffd0a0, rimIntensity: 0,
    skyTop: 0x727aa4, skyMid: 0xe2ae98, skyHorizon: 0xf2b088, skyGlow: 0xffac6c,
    haze: 0xcc9a80, fogNear: 700, fogFar: 6000,
    hemiSky: 0x8a86a8, hemiGround: 0x4c3c34, hemiIntensity: 1.3,
    ambient: 0x8c92ac, ambientIntensity: 0.3, exposure: 1.06, stars: 0,
    cloudTop: 0xffd2b0, cloudBase: 0x9c8894, water: 0x3a4a5c,
    lampGlow: 0.55, magicGlow: 0.3,
  },
  sunset: {
    sunAz: 262, sunEl: 1.6, sunColor: 0xff9458, sunIntensity: 3.0, sunGlow: 0xff9048,
    moonAz: MOON_AZ, moonEl: MOON_EL, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, moonColor: 0xc8d4ff, moonIntensity: 0, moonVis: 0,
    rimColor: 0xffc090, rimIntensity: 0,
    skyTop: 0x5c6296, skyMid: 0xe4a08c, skyHorizon: 0xf4a474, skyGlow: 0xffb064,
    haze: 0xc88470, fogNear: 1600, fogFar: 10000,
    hemiSky: 0x7c7898, hemiGround: 0x4c3830, hemiIntensity: 1.3,
    ambient: 0x7e84a2, ambientIntensity: 0.35, exposure: 1.1, stars: 0,
    cloudTop: 0xffb890, cloudBase: 0x7c6a84, water: 0x2e3a52,
    lampGlow: 0.7, magicGlow: 0.35,
  },
  dusk: {
    sunAz: 258, sunEl: -5, sunColor: 0xff7040, sunIntensity: 0.3, sunGlow: 0xd06038,
    moonAz: MOON_AZ, moonEl: MOON_EL, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, moonColor: 0xc8d4ff, moonIntensity: 0.35, moonVis: 0.4,
    rimColor: 0xa8b4ff, rimIntensity: 0.25,
    skyTop: 0x2e3566, skyMid: 0x74628c, skyHorizon: 0xd08070, skyGlow: 0xe88a58,
    haze: 0x6a5872, fogNear: 700, fogFar: 7000,
    hemiSky: 0x6670a0, hemiGround: 0x2c2434, hemiIntensity: 1.5,
    ambient: 0x6a70a0, ambientIntensity: 0.45, exposure: 1.2, stars: 0.3,
    cloudTop: 0xc890a0, cloudBase: 0x4a4468, water: 0x222a44,
    lampGlow: 1.0, magicGlow: 0.9,
  },
  night: {
    sunAz: 250, sunEl: -24, sunColor: 0xff7040, sunIntensity: 0, sunGlow: 0x000000,
    moonAz: MOON_AZ, moonEl: MOON_EL, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, moonColor: 0xc8d4ff, moonIntensity: 1.6, moonVis: 1,
    rimColor: 0x8fa6ff, rimIntensity: 0.8,
    skyTop: 0x0a1036, skyMid: 0x18224e, skyHorizon: 0x2e3c70, skyGlow: 0x3a4a80,
    haze: 0x202a50, fogNear: 1800, fogFar: 11000,
    hemiSky: 0x5a6ca8, hemiGround: 0x1a1e30, hemiIntensity: 2.2,
    ambient: 0x56649a, ambientIntensity: 0.9, exposure: 1.35, stars: 1,
    cloudTop: 0x7280b0, cloudBase: 0x262e50, water: 0x141a30,
    lampGlow: 1.1, magicGlow: 0.95,
  },
  /** Mid-flight (a LIGHT_WAYPOINTS key, no place): the sun just under the horizon ahead, the sky there on fire, the rest still night. */
  dawn: {
    sunAz: 338, sunEl: -1.2, sunColor: 0xff9a5a, sunIntensity: 1.4, sunGlow: 0xff8a48,
    moonAz: 300, moonEl: 26, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, moonColor: 0xc8d4ff, moonIntensity: 0.5, moonVis: 0.45,
    rimColor: 0xffb8a0, rimIntensity: 0.3,
    skyTop: 0x243268, skyMid: 0x5e5e8e, skyHorizon: 0x6e6c98, skyGlow: 0xffa860,
    haze: 0x7c6c84, fogNear: 1800, fogFar: 12000,
    hemiSky: 0x6c76a2, hemiGround: 0x2c2636, hemiIntensity: 1.7,
    ambient: 0x6c739c, ambientIntensity: 0.55, exposure: 1.22, stars: 0.35,
    cloudTop: 0xffa888, cloudBase: 0x4e4a70, water: 0x222a44,
    lampGlow: 0.95, magicGlow: 0.75,
  },
  /**
   * The Harbour Isle: a clear, low morning sun ahead-right of the square (it
   * rose ahead of the flight), the cloud sea white below. The square looks
   * toward the sun, so the moonlight slot carries the bright sky behind the
   * camera as a cool fill (az 150, the Guild Hall's front faces about 141):
   * the hall reads as a lit building, not a slab against the light.
   */
  morning: {
    sunAz: 350, sunEl: 11, sunColor: 0xffdcaa, sunIntensity: 3.8, sunGlow: 0xffd49a,
    moonAz: 296, moonEl: 14, moonLightAz: 150, moonLightEl: 28, moonColor: 0xdce6f4, moonIntensity: 1.1, moonVis: 0,
    rimColor: 0xffe0c0, rimIntensity: 0,
    skyTop: 0x6890c8, skyMid: 0xc8d6e2, skyHorizon: 0xece2d2, skyGlow: 0xffeccc,
    haze: 0xd4d0c8, fogNear: 1800, fogFar: 12000,
    hemiSky: 0xaab8cc, hemiGround: 0x5a5048, hemiIntensity: 1.4,
    ambient: 0x9ea8b8, ambientIntensity: 0.2, exposure: 1.0, stars: 0,
    cloudTop: 0xfff4e4, cloudBase: 0xaeaab6, water: 0x3a5468,
    lampGlow: 0.4, magicGlow: 0.15,
  },
};

/**
 * Keyframes that belong to no place. They shape the light between two stops
 * through LIGHT_WAYPOINTS.
 */
export const LIGHTS_BETWEEN = {
  /** Late in the flight: the sun has cleared the horizon ahead, the cloud sea below is gold. */
  sunrise: {
    sunAz: 340, sunEl: 3.5, sunColor: 0xffb070, sunIntensity: 3.0, sunGlow: 0xffa850,
    moonAz: 298, moonEl: 20, moonLightAz: 170, moonLightEl: 32, moonColor: 0xd0dcf8, moonIntensity: 0.5, moonVis: 0.15,
    rimColor: 0xffd0a8, rimIntensity: 0.2,
    skyTop: 0x4868a4, skyMid: 0xc4a8a8, skyHorizon: 0xf0c0a0, skyGlow: 0xffcc88,
    haze: 0xc8a494, fogNear: 1800, fogFar: 12000,
    hemiSky: 0x8a96bc, hemiGround: 0x3a3240, hemiIntensity: 1.5,
    ambient: 0x7e88aa, ambientIntensity: 0.4, exposure: 1.1, stars: 0.05,
    cloudTop: 0xffc878, cloudBase: 0x7a6a88, water: 0x2c3a54,
    lampGlow: 0.7, magicGlow: 0.5,
  },
} satisfies Record<string, LightKeyframe>;

export type LightWaypointKey = LightKey | keyof typeof LIGHTS_BETWEEN;

/**
 * Keyframes placed at TRAIL keys between two stops (fractional keys allowed).
 * A `hold` waypoint is a stop for the light: it eases to rest there, as at a
 * place. Otherwise the light passes through at speed: the time of day runs on
 * a C1 curve through the waypoint, so there is no pause and no jump in how
 * fast the light changes (only in which colours change).
 *
 * Night holds from the Sky Island over the star look, the rope bridge and the
 * boarding, and starts to break as the ship casts off: the sun is just under
 * the horizon ahead when the Harbour Isle comes up (0.45 through the flight),
 * clear of it and the clouds gold just before the ship docks, and it is
 * morning in the square.
 */
export const LIGHT_WAYPOINTS: ReadonlyArray<{ key: number; light: LightWaypointKey; hold: boolean }> =
  FLIGHT_KEYS.first >= 0 && FLIGHT_KEYS.last > FLIGHT_KEYS.first
    ? [
        { key: FLIGHT_KEYS.first, light: "night", hold: true },
        { key: FLIGHT_KEYS.first + 0.45 * (FLIGHT_KEYS.last - FLIGHT_KEYS.first), light: "dawn", hold: false },
        { key: FLIGHT_KEYS.last - 0.5, light: "sunrise", hold: false },
      ]
    : [];

/**
 * Share of each stretch, at each end, where the light holds its stop's key.
 * Between the holds the blend is a smootherstep, so the light never changes
 * speed abruptly and scrolling back retraces it exactly.
 */
export const LIGHT_HOLD = 0.08;

// ── Tuning: underground (grey pass 3) ───────────────────────────────────────

/**
 * The mine: the cave behind the falls (a3), the tunnel and the lift shaft
 * (a4). The terrain casts no shadows, so above ground's sun and sky light
 * would light the rock from inside as if it were outdoors. Underground these
 * two keys take over the fill (hemisphere, ambient), the haze and fog and the
 * exposure, and the sun, the moon and the rim light go out. The light you see
 * down there is blocks.ts's own (its mine material: torches, lanterns, the
 * ripples through the curtain, the shaft's daylight).
 *   cave    daylight through the falling water: a cool, grey-blue gloom, fog
 *           far enough that the curtain (~140 from the a3 stop) stays bright.
 *   tunnel  torchlight: a warm near-black, fog close, so the tunnel ahead
 *           fades into the dark between the torches.
 * Blend, by TRAIL key k (railU x (keys - 1)), all smoothsteps (C1):
 *   in      0 -> 1 as the curtain fills the frame (CAVE_KEYS.first + 0.2 .. + 0.62)
 *   tunnel  cave -> tunnel from the hall's east side into the tunnel
 *   out     the fill and fog come back over the last part of the ride (daylight
 *           growing overhead: SHAFT_KEYS.first + 3.6 .. last - 0.7); the sun only once
 *           the camera clears the collar (last - 1.4 .. last - 0.6).
 */
export const UNDERGROUND = {
  cave: {
    ambient: 0x5e6670, ambientIntensity: 0.22, hemiSky: 0x8c98a4, hemiGround: 0x2e2824, hemiIntensity: 0.14,
    haze: 0x1c2024, fogNear: 280, fogFar: 1500, exposure: 1.1,
  },
  tunnel: {
    ambient: 0x6c5444, ambientIntensity: 0.24, hemiSky: 0x7c6452, hemiGround: 0x241a14, hemiIntensity: 0.14,
    haze: 0x110b08, fogNear: 60, fogFar: 520, exposure: 1.1,
  },
} as const;
const UNDER_COLORS = ["ambient", "hemiSky", "hemiGround", "haze"] as const;
const UNDER_NUMBERS = ["ambientIntensity", "hemiIntensity", "fogNear", "fogFar", "exposure"] as const;
const underLinear = (k: (typeof UNDERGROUND)["cave"] | (typeof UNDERGROUND)["tunnel"]) => ({
  colors: Object.fromEntries(UNDER_COLORS.map((f) => [f, new THREE.Color().setHex(k[f])])) as Record<(typeof UNDER_COLORS)[number], THREE.Color>,
  numbers: k as Record<(typeof UNDER_NUMBERS)[number], number>,
});
const UNDER_CAVE = underLinear(UNDERGROUND.cave);
const UNDER_TUNNEL = underLinear(UNDERGROUND.tunnel);
const _underCol = new THREE.Color();

/** How underground the camera is at railU u: [fill and fog weight, tunnel share, sun-out weight]. */
export function undergroundAt(u: number): [number, number, number] {
  if (CAVE_KEYS.first < 0 || SHAFT_KEYS.last < 0) return [0, 0, 0];
  const k = u * (TRAIL.length - 1);
  // Under the curtain's cover: it fills the frame from ~0.3 before the crossing (~0.55).
  const into = smoothstep(CAVE_KEYS.first + 0.2, CAVE_KEYS.first + 0.62, k);
  const w = into * (1 - smoothstep(SHAFT_KEYS.first + 3.6, SHAFT_KEYS.last - 0.7, k));
  const tunnel = smoothstep(CAVE_KEYS.last - 0.2, TUNNEL_KEYS.first + 0.6, k);
  const sunOut = into * (1 - smoothstep(SHAFT_KEYS.last - 1.4, SHAFT_KEYS.last - 0.6, k));
  return [w, tunnel, sunOut];
}

/** Lays the underground light over a blended state (in place). */
function applyUnderground(u: number, out: LightState): LightState {
  const [w, tn, sunOut] = undergroundAt(u);
  out.under = w;
  if (w <= 0 && sunOut <= 0) return out;
  for (const f of UNDER_COLORS) {
    _underCol.copy(UNDER_CAVE.colors[f]).lerp(UNDER_TUNNEL.colors[f], tn);
    (out[f] as THREE.Color).lerp(_underCol, w);
  }
  for (const f of UNDER_NUMBERS) {
    const v = UNDER_CAVE.numbers[f] + (UNDER_TUNNEL.numbers[f] - UNDER_CAVE.numbers[f]) * tn;
    out[f] += (v - out[f]) * w;
  }
  const lit = 1 - sunOut;
  out.sunIntensity *= lit;
  out.moonIntensity *= lit;
  out.rimIntensity *= lit;
  return out;
}

// ── Tuning: sky, stars, clouds, lake ────────────────────────────────────────

/** Elevation (degrees) where the mid band is fully in, and where the top starts and ends. */
const SKY_SHAPE = { midFrom: 1.2, midTo: 7, topFrom: 5, topTo: 30 };
const SUN_RADIUS_DEG = 1.35;
const MOON_RADIUS_DEG = 1.5;
/** The sun light never comes from below this elevation (a light from under the horizon lights the undersides). */
const SUN_LIGHT_MIN_EL = 3;

const STAR_COUNT = 4200;
const STAR_SEED = 7;
/** Share of the stars packed into a band across the northern sky (the star look's peak, bearing 0, 44 up, sits on it). */
const STAR_BAND_SHARE = 0.45;
/** The band's great circle passes through these two directions (azimuth, elevation). */
const STAR_BAND_THROUGH: readonly [readonly [number, number], readonly [number, number]] = [[0, 50], [100, 5]];
/** Angular half-width of the band (radians) and the faint glow it leaves in the sky (linear). */
const STAR_BAND_WIDTH = 0.075;
const STAR_BAND_GLOW = 0.045;

/** Cloud slices: heights below WORLD.cloudLevel, bottom first. */
const CLOUD_SLICES = [-70, -35, 0];
/** Half size of the cloud square around the world centre. From the island its
 *  edge sits about 1 degree below the horizon, past where the clouds have
 *  fully faded into the sky, so no edge is ever seen. */
const CLOUD_HALF = 40000;
/** Width of the soft edge outside WORLD.cloudClear. */
const CLOUD_CLEAR_FEATHER = 450;
/**
 * No cloud over the coastal shelf: the layer fades out going south, starting
 * at z CLOUD_SOUTH_FROM near the route. Out west (past CLOUD_SOUTH_WEST_X)
 * the limit moves CLOUD_SOUTH_WEST_PUSH further south, so the cloud sea seen
 * from the Sky Island has no straight edge; noise wobbles the limit too.
 */
const CLOUD_SOUTH_FROM = 1700;
const CLOUD_SOUTH_FEATHER = 900;
const CLOUD_SOUTH_WEST_X = -3200;
const CLOUD_SOUTH_WEST_PUSH = 5000;
/** Coverage: patchy wisps over the ridge, a near-solid sea far west under and past the island. */
const CLOUD_COVER_NEAR = 0.42;
const CLOUD_COVER_FAR = 0.86;
const CLOUD_COVER_FROM_X = -1300;
const CLOUD_COVER_TO_X = -3800;
/**
 * North of the Sky Island the flight crosses open sky: the cover thickens
 * toward a near-solid sea under the Harbour Isle (z from CLOUD_NORTH_FROM_Z to
 * CLOUD_NORTH_TO_Z), so the dawn has a floor of cloud to turn gold.
 */
const CLOUD_COVER_NORTH = 0.8;
const CLOUD_NORTH_FROM_Z = -2300;
const CLOUD_NORTH_TO_Z = -3700;
/** Noise scale of the big cloud shapes, world units. */
const CLOUD_SCALE = 900;
/** Clouds melt fully into the sky colour behind them between these distances. */
const CLOUD_FADE_NEAR = 3000;
const CLOUD_FADE_FAR = 14000;
/** Terrain height texture for the peaks coming through (texels per side). */
const CLOUD_HEIGHT_RES = 160;

/** Lake surface sits this far above WORLD.lake.y, to win the depth test over any grey water drawn there. */
const LAKE_LIFT = 0.5;
/** How much of the reflection shows: at a steep look down, and at a grazing look. */
const LAKE_REFLECT_STEEP = 0.55;
const LAKE_REFLECT_GRAZE = 0.92;
/** Beyond this distance from the lake centre, no reflection pass: the lake shows a sky tint. */
const REFLECT_RANGE = 3200;
/** Reflection target: this share of the drawing buffer, capped. */
const REFLECT_SCALE = 0.5;
const REFLECT_MAX_W = 1024;

/** Objects on this layer are seen by the main camera but left out of the lake's reflection. */
export const NO_REFLECT_LAYER = 7;
/**
 * Objects on this layer appear ONLY in the lake's reflection. The reflection
 * pass redraws everything the mirror sees, so a heavy mesh costs twice: put
 * the full terrain on NO_REFLECT_LAYER and a coarse copy (for example
 * buildTerrainGeometry(96), 18k triangles) on REFLECT_ONLY_LAYER. Nothing
 * enables this layer on the main camera.
 */
export const REFLECT_ONLY_LAYER = 6;

// ── Contract ─────────────────────────────────────────────────────────────────

/** What light.ts needs from the scene. V4's WorldCtx satisfies it. */
export interface LightCtx {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  /** Where the camera is along the rail, 0..1. See the header for what it must mean. */
  railU(): number;
  /** railU at each of the eight stops, ascending. Omit when railU is the TRAIL curve parameter. */
  placeU?: readonly number[];
  /** If present, these are overwritten in place every frame with the live light (for other modules). */
  sunDir?: THREE.Vector3;
  sunColor?: THREE.Color;
  hazeColor?: THREE.Color;
  reducedMotion?: boolean;
}

/** The blended light at one railU. Colours are linear. */
export interface LightState {
  u: number;
  /** Index of the stop at or before u (0..7), and the share of railU from it toward the next (0..1). */
  stop: number;
  blend: number;
  /** Unit vectors toward the sun and the moon disc (the sun's may be below the horizon). */
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** Unit vector toward where the moonlight comes from. */
  moonLightDir: THREE.Vector3;
  sunEl: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  sunGlow: THREE.Color;
  moonColor: THREE.Color;
  moonIntensity: number;
  moonVis: number;
  rimColor: THREE.Color;
  rimIntensity: number;
  skyTop: THREE.Color;
  skyMid: THREE.Color;
  skyHorizon: THREE.Color;
  skyGlow: THREE.Color;
  haze: THREE.Color;
  fogNear: number;
  fogFar: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  ambient: THREE.Color;
  ambientIntensity: number;
  exposure: number;
  stars: number;
  cloudTop: THREE.Color;
  cloudBase: THREE.Color;
  water: THREE.Color;
  /** Live multipliers on the tagged glow materials (see the header). */
  lampGlow: number;
  magicGlow: number;
  /** 0..1: how far underground the light is (UNDERGROUND). */
  under: number;
}

export interface LightModule {
  name: "light";
  update(time: number, dt: number): boolean;
  isAnimating(): boolean;
  dispose(): void;
  stats(): Record<string, number | string>;
  /** The light last applied. Same object every frame, mutated in place. */
  readonly state: LightState;
  /** The blended light at any railU, without applying it. Writes into `out` if given. */
  lightAt(u: number, out?: LightState): LightState;
  /** Force the light to a railU (harness, park flights); null follows ctx.railU() again. */
  setU(u: number | null): void;
  /** railU of each stop, as used. */
  readonly placeU: readonly number[];
  /** The Mirror Lake reflector mesh. */
  readonly lake: THREE.Mesh;
  /** False: the scene schedules fog near/far itself; the colour stays owned here. */
  fogDistances: boolean;
  /** The sky's linear colour in a unit world direction (no disc), for other modules. */
  skyColorAt(dir: THREE.Vector3, out: THREE.Color): THREE.Color;
}

// ── Keyframes in linear space ────────────────────────────────────────────────

const COLOR_FIELDS = [
  "sunColor", "sunGlow", "moonColor", "rimColor", "skyTop", "skyMid", "skyHorizon", "skyGlow",
  "haze", "hemiSky", "hemiGround", "ambient", "cloudTop", "cloudBase", "water",
] as const;
const NUMBER_FIELDS = [
  "sunIntensity", "moonIntensity", "moonVis", "rimIntensity", "fogNear", "fogFar",
  "hemiIntensity", "ambientIntensity", "exposure", "stars", "lampGlow", "magicGlow",
] as const;
type ColorField = (typeof COLOR_FIELDS)[number];

export interface LinearKey {
  colors: Record<ColorField, THREE.Color>;
  numbers: Record<(typeof NUMBER_FIELDS)[number], number>;
  sunAz: number;
  sunEl: number;
  moonAz: number;
  moonEl: number;
  moonLightAz: number;
  moonLightEl: number;
}

function linearKey(k: LightKeyframe): LinearKey {
  const colors = {} as Record<ColorField, THREE.Color>;
  // Color.setHex reads sRGB and stores linear (ColorManagement is on).
  for (const f of COLOR_FIELDS) colors[f] = new THREE.Color().setHex(k[f]);
  const numbers = {} as LinearKey["numbers"];
  for (const f of NUMBER_FIELDS) numbers[f] = k[f];
  return {
    colors, numbers, sunAz: k.sunAz, sunEl: k.sunEl, moonAz: k.moonAz, moonEl: k.moonEl,
    moonLightAz: k.moonLightAz, moonLightEl: k.moonLightEl,
  };
}

function newState(): LightState {
  const c = () => new THREE.Color();
  return {
    u: 0, stop: 0, blend: 0,
    sunDir: new THREE.Vector3(0, 1, 0), moonDir: new THREE.Vector3(0, 1, 0), moonLightDir: new THREE.Vector3(0, 1, 0), sunEl: 0,
    sunColor: c(), sunIntensity: 0, sunGlow: c(), moonColor: c(), moonIntensity: 0, moonVis: 0,
    rimColor: c(), rimIntensity: 0, skyTop: c(), skyMid: c(), skyHorizon: c(), skyGlow: c(),
    haze: c(), fogNear: 0, fogFar: 0, hemiSky: c(), hemiGround: c(), hemiIntensity: 0,
    ambient: c(), ambientIntensity: 0, exposure: 1, stars: 0, cloudTop: c(), cloudBase: c(), water: c(),
    lampGlow: 1, magicGlow: 1, under: 0,
  };
}

/** Unit vector toward compass azimuth / elevation (degrees). */
function dirFromAngles(az: number, el: number, out: THREE.Vector3): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(az);
  const e = THREE.MathUtils.degToRad(el);
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

/** Shortest-arc blend of two azimuths, degrees. */
function lerpAz(a: number, b: number, k: number): number {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return a + d * k;
}

function smootherstep01(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** railU of each stop when railU is the TRAIL curve parameter (key i at i / (n - 1)). */
export function defaultPlaceU(): number[] {
  const n = TRAIL.length - 1;
  return PLACES.map((p) => p.trail / n);
}

/** One stop of the light's track: a place, or a LIGHT_WAYPOINTS key. */
export interface LightTrackStop {
  u: number;
  key: LinearKey;
  hold: boolean;
  /** For a pass-through stop: d(blend)/d(railU), the same on both sides. */
  rate: number;
}

/** railU of a (fractional) TRAIL key, between the stops it falls between. */
function keyToU(key: number, placeU: readonly number[]): number {
  for (let i = 0; i < PLACES.length - 1; i++) {
    const a = PLACES[i].trail;
    const b = PLACES[i + 1].trail;
    if (key >= a && key <= b) return placeU[i] + ((key - a) / Math.max(1e-9, b - a)) * (placeU[i + 1] - placeU[i]);
  }
  return NaN;
}

/**
 * The light's track: the eight places (holds) and the waypoints between them,
 * in railU order. A waypoint that falls on a place or outside the route is
 * left out.
 */
export function buildTrack(placeU: readonly number[]): LightTrackStop[] {
  const track: LightTrackStop[] = PLACES.map((p, i) => ({ u: placeU[i], key: linearKey(LIGHTS[p.light]), hold: true, rate: 0 }));
  for (const w of LIGHT_WAYPOINTS) {
    const u = keyToU(w.key, placeU);
    if (!(u > placeU[0] && u < placeU[placeU.length - 1])) continue;
    if (track.some((t) => Math.abs(t.u - u) < 1e-7)) continue;
    const kf = (LIGHTS as Record<string, LightKeyframe>)[w.light] ?? (LIGHTS_BETWEEN as Record<string, LightKeyframe>)[w.light];
    track.push({ u, key: linearKey(kf), hold: w.hold, rate: 0 });
  }
  track.sort((a, b) => a.u - b.u);
  // A pass-through stop's rate: its two stretches (less their holds) meet at
  // one speed, so the blend is C1 across it.
  const eff = (i: number) => (track[i + 1].u - track[i].u) * (1 - (track[i].hold ? LIGHT_HOLD : 0) - (track[i + 1].hold ? LIGHT_HOLD : 0));
  for (let i = 1; i < track.length - 1; i++) {
    if (track[i].hold) continue;
    track[i].rate = 2 / Math.max(1e-9, eff(i - 1) + eff(i));
  }
  return track;
}

/** Blend (0..1) across stretch i of the track at u. */
function stretchBlend(track: readonly LightTrackStop[], i: number, u: number): number {
  const A = track[i];
  const B = track[i + 1];
  const L = Math.max(1e-9, B.u - A.u);
  const f = (u - A.u) / L;
  const lo = A.hold ? LIGHT_HOLD : 0;
  const hi = B.hold ? 1 - LIGHT_HOLD : 1;
  const x = Math.min(1, Math.max(0, (f - lo) / (hi - lo)));
  if (A.hold && B.hold) return smootherstep01(x);
  // Cubic Hermite with the pass-through ends' shared rate as slope (scaled to
  // this stretch) and zero slope at a hold. Slopes stay under 2: monotone.
  const span = (hi - lo) * L;
  const m0 = A.hold ? 0 : A.rate * span;
  const m1 = B.hold ? 0 : B.rate * span;
  const x2 = x * x;
  const x3 = x2 * x;
  return (x3 - 2 * x2 + x) * m0 + (3 * x2 - 2 * x3) + (x3 - x2) * m1;
}

/** The time of day on a track at u: stretch index + blend (continuous, rising). The harness checks it is C1 at pass-through waypoints. */
export function trackTime(u: number, track: readonly LightTrackStop[]): number {
  const n = track.length;
  if (u <= track[0].u) return 0;
  if (u >= track[n - 1].u) return n - 1;
  let i = 0;
  while (i < n - 2 && u >= track[i + 1].u) i++;
  return i + stretchBlend(track, i, u);
}

/**
 * The light at `u` on a track. Pure: the harness and the continuity check
 * use it directly.
 */
export function blendTrack(u: number, track: readonly LightTrackStop[], placeU: readonly number[], out: LightState): LightState {
  const n = track.length;
  let i = 0;
  let k = 0;
  if (u <= track[0].u) {
    i = 0;
    k = 0;
  } else if (u >= track[n - 1].u) {
    i = n - 2;
    k = 1;
  } else {
    while (i < n - 2 && u >= track[i + 1].u) i++;
    k = stretchBlend(track, i, u);
  }
  const a = track[i].key;
  const b = track[i + 1].key;
  out.u = u;
  let p = 0;
  while (p < placeU.length - 1 && u >= placeU[p + 1] - 1e-7) p++;
  out.stop = p;
  out.blend = p >= placeU.length - 1 ? 0 : Math.min(1, Math.max(0, (u - placeU[p]) / Math.max(1e-9, placeU[p + 1] - placeU[p])));
  for (const f of COLOR_FIELDS) (out[f] as THREE.Color).copy(a.colors[f]).lerp(b.colors[f], k);
  for (const f of NUMBER_FIELDS) out[f] = a.numbers[f] + (b.numbers[f] - a.numbers[f]) * k;
  const sunEl = a.sunEl + (b.sunEl - a.sunEl) * k;
  out.sunEl = sunEl;
  dirFromAngles(lerpAz(a.sunAz, b.sunAz, k), sunEl, out.sunDir);
  dirFromAngles(lerpAz(a.moonAz, b.moonAz, k), a.moonEl + (b.moonEl - a.moonEl) * k, out.moonDir);
  dirFromAngles(lerpAz(a.moonLightAz, b.moonLightAz, k), a.moonLightEl + (b.moonLightEl - a.moonLightEl) * k, out.moonLightDir);
  return applyUnderground(u, out);
}

/** The light at `u` for stops at `placeU` (places and LIGHT_WAYPOINTS). */
export function blendLight(u: number, placeU: readonly number[], out: LightState): LightState {
  return blendTrack(u, buildTrack(placeU), placeU, out);
}

// ── Shared GLSL ──────────────────────────────────────────────────────────────

const SKY_GLSL = /* glsl */ `
uniform vec3 uHaze;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uMid;
uniform vec3 uTop;
uniform vec3 uSunDir;
uniform vec3 uSunGlow;
uniform vec3 uMoonDir;
uniform vec3 uMoonGlow;
uniform vec4 uSkyShape; // midFrom, midTo, topFrom, topTo (degrees)

// Linear sky colour in unit direction d, without the discs.
vec3 lightSky(vec3 d) {
  float deg = degrees(asin(clamp(d.y, -1.0, 1.0)));
  vec2 hz = d.xz;
  float hl = length(hz);
  vec2 sz = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  float toward = hl > 1e-4 ? 0.5 + 0.5 * dot(hz / hl, sz) : 0.5;
  // The horizon glows toward the sun and keeps the plain horizon colour away from it.
  vec3 low = mix(uHorizon, uGlow, toward * toward);
  vec3 c = mix(uHorizon, low, smoothstep(-0.8, 1.2, deg));
  c = mix(c, uMid, smoothstep(uSkyShape.x, uSkyShape.y, deg) * (0.55 + 0.45 * (1.0 - toward)));
  c = mix(c, uTop, smoothstep(uSkyShape.z, uSkyShape.w, deg));
  float ca = max(dot(d, uSunDir), 0.0);
  c += uSunGlow * (0.22 * pow(ca, 5.0) + 0.55 * pow(ca, 90.0));
  float cm = max(dot(d, uMoonDir), 0.0);
  c += uMoonGlow * (0.10 * pow(cm, 8.0) + 0.45 * pow(cm, 400.0));
  // Below the horizon everything is haze.
  return mix(uHaze, c, smoothstep(-2.0, 0.0, deg));
}
`;

const NOISE_GLSL = /* glsl */ `
float lh21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float lvn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lh21(i), lh21(i + vec2(1.0, 0.0)), u.x), mix(lh21(i + vec2(0.0, 1.0)), lh21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float lfbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) { s += a * lvn(p); p = r * p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
`;

// ── Install ──────────────────────────────────────────────────────────────────

export function install(ctx: LightCtx): LightModule {
  const t0 = performance.now();
  const { scene, renderer } = ctx;
  const placeU = (ctx.placeU && ctx.placeU.length === PLACES.length ? [...ctx.placeU] : defaultPlaceU()) as number[];
  const track = buildTrack(placeU);
  const state = newState();
  const owned: THREE.Object3D[] = [];
  const disposables: { dispose(): void }[] = [];
  let forcedU: number | null = null;

  const skyUniforms = {
    uHaze: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uTop: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunGlow: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonGlow: { value: new THREE.Color() },
    uSkyShape: { value: new THREE.Vector4(SKY_SHAPE.midFrom, SKY_SHAPE.midTo, SKY_SHAPE.topFrom, SKY_SHAPE.topTo) },
  };

  // ── Sky dome ──
  const skyGeo = new THREE.SphereGeometry(1000, 48, 24);
  const skyMat = new THREE.ShaderMaterial({
    name: "LightSkyMat",
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      ...skyUniforms,
      uSunDisc: { value: new THREE.Color(0xfff0cf) },
      uSunVis: { value: 1 },
      uSunRadius: { value: THREE.MathUtils.degToRad(SUN_RADIUS_DEG) },
      uMoonDisc: { value: new THREE.Color(0xeef0f6) },
      uMoonVis: { value: 0 },
      uMoonRadius: { value: THREE.MathUtils.degToRad(MOON_RADIUS_DEG) },
      uBandN: { value: starBandNormal(new THREE.Vector3()) },
      uBand: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        // Centred on the camera and pinned to the far plane: never clipped,
        // never in front of anything, whatever the camera does.
        vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      ${NOISE_GLSL}
      uniform vec3 uSunDisc;
      uniform float uSunVis;
      uniform float uSunRadius;
      uniform vec3 uMoonDisc;
      uniform float uMoonVis;
      uniform float uMoonRadius;
      uniform vec3 uBandN;
      uniform float uBand;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = lightSky(d);
        // The star band's faint glow, only once the sky is dark.
        if (uBand > 0.0) {
          float bd = dot(d, uBandN);
          float bm = exp(-bd * bd / 0.0121);
          float bn = 0.5 * (lvn(d.xy * 9.0 + 3.1) + lvn(d.zy * 9.0 + 7.7));
          c += vec3(0.62, 0.7, 1.0) * uBand * bm * (0.35 + 0.65 * bn) * smoothstep(0.0, 0.2, d.y);
        }
        float horizon = smoothstep(-0.004, 0.004, d.y);
        float sa = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
        c = mix(c, uSunDisc, (1.0 - smoothstep(uSunRadius * 0.82, uSunRadius * 1.06, sa)) * uSunVis * horizon);
        float ma = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
        float mm = (1.0 - smoothstep(uMoonRadius * 0.85, uMoonRadius * 1.04, ma)) * uMoonVis * horizon;
        if (mm > 0.0) {
          // A face: soft grey seas and a darker limb, so the disc reads as the moon.
          vec3 t1 = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
          vec3 t2 = cross(t1, uMoonDir);
          vec2 mq = vec2(dot(d, t1), dot(d, t2)) / uMoonRadius;
          float seas = smoothstep(0.42, 0.68, lfbm(mq * 1.4 + 4.0));
          float limb = sqrt(max(0.0, 1.0 - min(1.0, dot(mq, mq))));
          c = mix(c, uMoonDisc * (1.0 - 0.24 * seas) * (0.8 + 0.2 * limb), mm);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = "LightSky";
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.matrixAutoUpdate = false;
  // The sky draws first in every pass: set the glow materials' level just before.
  sky.onBeforeRender = () => applyGlow();
  scene.add(sky);
  owned.push(sky);
  disposables.push(skyGeo, skyMat);

  // ── Stars ──
  const starGeo = buildStars();
  const starMat = new THREE.ShaderMaterial({
    name: "LightStarsMat",
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uStars: { value: 0 }, uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aBright;
      attribute float aSize;
      uniform float uStars;
      uniform float uPx;
      varying float vA;
      void main() {
        vec3 d = normalize(position);
        // Pinned to the far plane like the dome; the depth test hides them behind land.
        vec4 p = projectionMatrix * viewMatrix * vec4(d * 1000.0 + cameraPosition, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
        vA = aBright * uStars * smoothstep(-0.02, 0.12, d.y);
        gl_PointSize = aSize * uPx;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float a = vA * (1.0 - smoothstep(0.35, 1.0, length(q)));
        if (a < 0.004) discard;
        gl_FragColor = vec4(0.86, 0.9, 1.0, a);
      }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.name = "LightStars";
  stars.frustumCulled = false;
  stars.renderOrder = -900;
  stars.matrixAutoUpdate = false;
  scene.add(stars);
  owned.push(stars);
  disposables.push(starGeo, starMat);

  // ── Cloud layer ──
  const heightTex = buildHeightTexture();
  const cloudGeo = buildCloudGeometry();
  const cloudIndexUp = cloudGeo.getIndex()!;
  const cloudIndexDown = reversedSliceIndex(cloudIndexUp);
  const clear = WORLD.cloudClear;
  const cloudMat = new THREE.ShaderMaterial({
    name: "LightCloudMat",
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
    uniforms: {
      ...skyUniforms,
      uCloudTop: { value: new THREE.Color() },
      uCloudBase: { value: new THREE.Color() },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) },
      uHeight: { value: heightTex },
      uHeightBox: {
        value: new THREE.Vector4(WORLD.minX, WORLD.minZ, 1 / (WORLD.maxX - WORLD.minX), 1 / (WORLD.maxZ - WORLD.minZ)),
      },
      uClear: { value: new THREE.Vector4(clear.x, clear.z, clear.r, CLOUD_CLEAR_FEATHER) },
      uSouth: { value: new THREE.Vector4(CLOUD_SOUTH_FROM, CLOUD_SOUTH_FEATHER, CLOUD_SOUTH_WEST_X, CLOUD_SOUTH_WEST_PUSH) },
      uCover: { value: new THREE.Vector4(CLOUD_COVER_NEAR, CLOUD_COVER_FAR, CLOUD_COVER_FROM_X, CLOUD_COVER_TO_X) },
      uNorth: { value: new THREE.Vector3(CLOUD_COVER_NORTH, CLOUD_NORTH_FROM_Z, CLOUD_NORTH_TO_Z) },
      uFade: { value: new THREE.Vector3(CLOUD_FADE_NEAR, CLOUD_FADE_FAR, CLOUD_SCALE) },
      uTopY: { value: WORLD.cloudLevel },
    },
    vertexShader: /* glsl */ `
      attribute float aSlice;
      varying vec3 vWorld;
      varying float vSlice;
      void main() {
        vSlice = aSlice;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      ${NOISE_GLSL}
      uniform vec3 uCloudTop;
      uniform vec3 uCloudBase;
      uniform vec3 uLightDir;
      uniform sampler2D uHeight;
      uniform vec4 uHeightBox;
      uniform vec4 uClear;
      uniform vec4 uSouth;
      uniform vec4 uCover;
      uniform vec3 uNorth;
      uniform vec3 uFade;
      uniform float uTopY;
      varying vec3 vWorld;
      varying float vSlice;
      void main() {
        vec2 p = vWorld.xz;
        // Where the layer exists at all. Noise only ever erodes the clear
        // circle's edge (the distance is shortened, never lengthened), so
        // nothing drifts inside WORLD.cloudClear.
        float edge = lvn(p / 700.0 + 3.7);
        float mask = smoothstep(uClear.z, uClear.z + uClear.w, distance(p, uClear.xy) - 320.0 * edge);
        float south = uSouth.x + uSouth.w * smoothstep(-1200.0, uSouth.z, p.x) + (edge - 0.5) * uSouth.y;
        mask *= 1.0 - smoothstep(south, south + uSouth.y, p.y);
        if (mask < 0.002) discard;
        float cover = mix(uCover.x, uCover.y, smoothstep(uCover.z, uCover.w, p.x));
        cover = max(cover, mix(uCover.x, uNorth.x, smoothstep(uNorth.y, uNorth.z, p.y)));
        vec2 q = p / uFade.z;
        float n = lfbm(q);
        // Upper slices need denser noise: the layer thins toward its top like cumulus.
        float th = 1.0 - cover + vSlice * 0.09;
        float a = smoothstep(th, th + 0.16, n) * mask;
        // Peaks rising through a slice thin it out around them, so they come through softly.
        // Outside the terrain it is sea: a clamped texture would stretch the
        // edge column (the high ridge) westward forever as a straight gap.
        vec2 huv = (p - uHeightBox.xy) * uHeightBox.zw;
        float inside = step(0.0, huv.x) * step(huv.x, 1.0) * step(0.0, huv.y) * step(huv.y, 1.0);
        float h = mix(-100.0, texture2D(uHeight, huv).r * 2550.0 - 100.0, inside);
        a *= 1.0 - smoothstep(vWorld.y - 90.0, vWorld.y + 10.0, h);
        if (a < 0.004) discard;
        // Light: brighter where the cloud rises toward the light, darker in its lee.
        vec2 ld = normalize(uLightDir.xz + vec2(1e-5, 0.0));
        float nl = lfbm(q + ld * 0.18);
        float lit = clamp(0.62 + (n - nl) * 3.0 + vSlice * 0.12, 0.0, 1.0);
        vec3 col = mix(uCloudBase, uCloudTop, lit);
        // Seen from below, the underside.
        float below = smoothstep(uTopY - 40.0, uTopY - 140.0, cameraPosition.y);
        col = mix(col, uCloudBase, below * 0.7);
        // Far away the clouds become the sky behind them.
        vec3 toP = vWorld - cameraPosition;
        float dist = length(toP);
        float fade = smoothstep(uFade.x, uFade.y, dist);
        col = mix(col, lightSky(toP / dist), fade);
        gl_FragColor = vec4(col, a * (0.62 + 0.18 * vSlice));
        #include <colorspace_fragment>
      }`,
  });
  const clouds = new THREE.Mesh(cloudGeo, cloudMat);
  clouds.name = "LightClouds";
  clouds.frustumCulled = false;
  clouds.matrixAutoUpdate = false;
  // After the stars, before anything else transparent the scene adds at order 0.
  clouds.renderOrder = -800;
  scene.add(clouds);
  owned.push(clouds);
  disposables.push(cloudGeo, cloudMat, heightTex);
  let cloudsFromBelow = false;

  // ── Mirror Lake ──
  const lakeGeo = new THREE.CircleGeometry(WORLD.lake.r + 20, 96);
  const reflector = new Reflector(lakeGeo, {
    textureWidth: 512,
    textureHeight: 320,
    clipBias: 0.002,
    multisample: 4,
    shader: LAKE_SHADER,
  });
  reflector.name = "MirrorLake";
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.set(WORLD.lake.x, WORLD.lake.y + LAKE_LIFT, WORLD.lake.z);
  reflector.updateMatrix();
  reflector.updateMatrixWorld(true);
  reflector.matrixAutoUpdate = false;
  const lakeMat = reflector.material as THREE.ShaderMaterial;
  lakeMat.fog = true;
  Object.assign(lakeMat.uniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog));
  scene.add(reflector);
  owned.push(reflector);
  disposables.push(lakeGeo, { dispose: () => reflector.dispose() });
  const reflectTarget = reflector.getRenderTarget();
  const bufSize = new THREE.Vector2();
  const lakeCentre = new THREE.Vector3(WORLD.lake.x, WORLD.lake.y, WORLD.lake.z);
  const camPos = new THREE.Vector3();
  let reflectCalls = 0;
  let reflectPasses = 0;
  const baseReflect = reflector.onBeforeRender;
  reflector.onBeforeRender = (r, s, camera, geometry, material, group) => {
    camPos.setFromMatrixPosition(camera.matrixWorld);
    const near = camPos.distanceTo(lakeCentre) < REFLECT_RANGE;
    lakeMat.uniforms.uLive.value = near ? 1 : 0;
    if (!near) return;
    // Half the drawing buffer: modest, and square pixels whatever the screen.
    r.getDrawingBufferSize(bufSize);
    const w = Math.max(256, Math.min(REFLECT_MAX_W, Math.round(bufSize.x * REFLECT_SCALE)));
    const h = Math.max(160, Math.round((w * bufSize.y) / Math.max(1, bufSize.x)));
    if (reflectTarget.width !== w || reflectTarget.height !== h) reflectTarget.setSize(w, h);
    reflector.camera.layers.mask = (camera.layers.mask & ~(1 << NO_REFLECT_LAYER)) | (1 << REFLECT_ONLY_LAYER);
    // The nested render would reset renderer.info and hide the frame's real
    // cost; count it into the frame instead.
    const auto = r.info.autoReset;
    r.info.autoReset = false;
    const c0 = r.info.render.calls;
    baseReflect.call(reflector, r, s, camera, geometry, material, group);
    reflectCalls = r.info.render.calls - c0;
    reflectPasses++;
    r.info.autoReset = auto;
  };
  ctx.camera.layers.enable(NO_REFLECT_LAYER);

  // ── Lights ──
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.name = "LightSun";
  const moon = new THREE.DirectionalLight(0xffffff, 0);
  moon.name = "LightMoon";
  const rim = new THREE.DirectionalLight(0xffffff, 0);
  rim.name = "LightRim";
  const fill = new THREE.HemisphereLight(0xffffff, 0x000000, 0);
  fill.name = "LightFill";
  const shade = new THREE.AmbientLight(0xffffff, 0);
  shade.name = "LightShade";
  for (const l of [sun, moon, rim]) {
    // A directional light shines from position toward target; both follow the camera
    // so the light stays valid over a 9,000-unit world.
    scene.add(l, l.target);
    owned.push(l, l.target);
  }
  scene.add(fill, shade);
  owned.push(fill, shade);

  // ── Fog ──
  let createdFog = false;
  let fog = scene.fog as THREE.Fog | null;
  const fogWas = fog && (fog as THREE.Fog).isFog ? { color: fog.color.clone(), near: fog.near, far: fog.far } : null;
  if (!fog || !(fog as THREE.Fog).isFog) {
    fog = new THREE.Fog(0xffffff, 1000, 8000);
    scene.fog = fog;
    createdFog = true;
  }
  const exposureWas = renderer.toneMappingExposure;

  // ── Apply ──
  const tmpDir = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const lightDir = new THREE.Vector3();
  let lastU = NaN;
  const lastCam = new THREE.Vector3(NaN, NaN, NaN);
  const lastQuat = new THREE.Quaternion();
  const pxRatio = { value: 1 };

  const handle: LightModule = {
    name: "light",
    state,
    placeU,
    lake: reflector,
    fogDistances: true,
    lightAt(u: number, out?: LightState) {
      return blendTrack(u, track, placeU, out ?? newState());
    },
    setU(u: number | null) {
      forcedU = u;
      lastU = NaN;
    },
    skyColorAt(dir: THREE.Vector3, out: THREE.Color) {
      return skyCpu(state, dir, out);
    },
    update() {
      const u = forcedU ?? ctx.railU();
      const cam = ctx.camera;
      const camMoved = !cam.position.equals(lastCam) || !cam.quaternion.equals(lastQuat);
      const uChanged = !(u === lastU);
      // Underground the fog is ours on every frame: the scene writes its own
      // schedule before the modules update, and on a still frame (the falls
      // and the torches keep the loop running) that would lift the dark.
      if (!uChanged && state.under > 0 && handle.fogDistances && fog) {
        fog.near = state.fogNear;
        fog.far = state.fogFar;
      }
      if (!uChanged && !camMoved) return false;
      if (uChanged) {
        lastU = u;
        blendTrack(u, track, placeU, state);
        applyState();
      }
      lastCam.copy(cam.position);
      lastQuat.copy(cam.quaternion);
      followCamera();
      return uChanged;
    },
    isAnimating() {
      return false;
    },
    dispose() {
      for (const o of owned) o.parent?.remove(o);
      for (const d of disposables) d.dispose();
      ctx.camera.layers.disable(NO_REFLECT_LAYER);
      if (createdFog) scene.fog = null;
      else if (fog && fogWas) {
        fog.color.copy(fogWas.color);
        fog.near = fogWas.near;
        fog.far = fogWas.far;
      }
      renderer.toneMappingExposure = exposureWas;
      if (scene.userData.light === handle) delete scene.userData.light;
    },
    stats() {
      return {
        drawCalls: 3 + (stars.visible ? 1 : 0),
        reflectionPassCalls: reflectCalls,
        reflectionPasses: reflectPasses,
        reflectionTarget: `${reflectTarget.width}x${reflectTarget.height}`,
        starCount: STAR_COUNT,
        glowMaterials,
        lampGlow: Math.round(state.lampGlow * 1e3) / 1e3,
        magicGlow: Math.round(state.magicGlow * 1e3) / 1e3,
        under: Math.round(state.under * 1e3) / 1e3,
        cloudTriangles: cloudIndexUp.count / 3,
        u: Math.round(state.u * 1e4) / 1e4,
        stop: state.stop,
        blend: Math.round(state.blend * 1e3) / 1e3,
        msToBuild: Math.round(msBuild * 10) / 10,
      };
    },
  };

  /**
   * Glow materials follow the darkness. A walk over the scene (a few hundred
   * nodes) each drawn frame, so materials added after install (the blocks)
   * are found on their first frame; a material only changes when its level does.
   */
  let glowMaterials = 0;
  function applyGlow() {
    let found = 0;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      const list = Array.isArray(m) ? m : [m];
      for (const mat of list) {
        const kind = mat.userData.lightGlow ?? (mat.name === "V4BlockGlow" ? "lamp" : undefined);
        if (kind !== "lamp" && kind !== "magic") continue;
        const colored = mat as THREE.MeshBasicMaterial;
        if (!colored.color) continue;
        found++;
        const level = kind === "magic" ? state.magicGlow : state.lampGlow;
        if (mat.userData.lightGlowLevel === level) continue;
        if (!mat.userData.lightGlowBase) mat.userData.lightGlowBase = colored.color.clone();
        colored.color.copy(mat.userData.lightGlowBase as THREE.Color).multiplyScalar(level);
        mat.userData.lightGlowLevel = level;
      }
    });
    glowMaterials = found;
  }

  function applyState() {
    const s = state;
    // Sky.
    skyUniforms.uHaze.value.copy(s.haze);
    skyUniforms.uHorizon.value.copy(s.skyHorizon);
    skyUniforms.uGlow.value.copy(s.skyGlow);
    skyUniforms.uMid.value.copy(s.skyMid);
    skyUniforms.uTop.value.copy(s.skyTop);
    skyUniforms.uSunDir.value.copy(s.sunDir);
    skyUniforms.uSunGlow.value.copy(s.sunGlow);
    skyUniforms.uMoonDir.value.copy(s.moonDir);
    skyUniforms.uMoonGlow.value.copy(s.moonColor).multiplyScalar(0.35 * s.moonVis);
    skyMat.uniforms.uSunVis.value = smoothstep(-1.5, 0.3, s.sunEl);
    skyMat.uniforms.uMoonVis.value = s.moonVis;
    // Stars: skip the draw call entirely in daylight.
    starMat.uniforms.uStars.value = s.stars;
    skyMat.uniforms.uBand.value = STAR_BAND_GLOW * s.stars;
    stars.visible = s.stars > 0.01;
    // Clouds take their light from the sun and the moon, weighted by strength.
    cloudMat.uniforms.uCloudTop.value.copy(s.cloudTop);
    cloudMat.uniforms.uCloudBase.value.copy(s.cloudBase);
    const sunW = s.sunIntensity * smoothstep(-2, 2, s.sunEl);
    // Weighted, not switched: the dawn hands the clouds from moon to sun without a pop.
    cloudMat.uniforms.uLightDir.value.copy(s.sunDir).multiplyScalar(sunW).addScaledVector(s.moonLightDir, s.moonIntensity);
    if (cloudMat.uniforms.uLightDir.value.lengthSq() < 1e-8) cloudMat.uniforms.uLightDir.value.copy(s.sunDir);
    cloudMat.uniforms.uLightDir.value.normalize();
    // Lights. The sun never lights from under the horizon.
    const lit = dirFromAngles(azOf(s.sunDir), Math.max(SUN_LIGHT_MIN_EL, s.sunEl), lightDir);
    sun.userData.dir = (sun.userData.dir ?? new THREE.Vector3()).copy(lit);
    sun.color.copy(s.sunColor);
    sun.intensity = s.sunIntensity * smoothstep(-6, 1, s.sunEl);
    moon.userData.dir = (moon.userData.dir ?? new THREE.Vector3()).copy(s.moonLightDir);
    moon.color.copy(s.moonColor);
    moon.intensity = s.moonIntensity;
    rim.color.copy(s.rimColor);
    rim.intensity = s.rimIntensity;
    fill.color.copy(s.hemiSky);
    fill.groundColor.copy(s.hemiGround);
    fill.intensity = s.hemiIntensity;
    shade.color.copy(s.ambient);
    shade.intensity = s.ambientIntensity;
    sun.visible = sun.intensity > 0.001;
    moon.visible = moon.intensity > 0.001;
    rim.visible = rim.intensity > 0.001;
    // Fog and exposure.
    if (fog) {
      fog.color.copy(s.haze);
      if (handle.fogDistances) {
        fog.near = s.fogNear;
        fog.far = s.fogFar;
      }
    }
    renderer.toneMappingExposure = s.exposure;
    lakeMat.uniforms.uDeep.value.copy(s.water);
    // The lake's colour when it is too far to reflect: the sky a little above the horizon.
    skyCpu(s, tmpDir.set(0, 0.18, -1).normalize(), lakeMat.uniforms.uSkyTint.value);
    // For other modules that captured these at install.
    ctx.sunDir?.copy(lit);
    ctx.sunColor?.copy(s.sunColor);
    ctx.hazeColor?.copy(s.haze);
  }

  /** Lights sit around the camera; the rim is placed in front of and above the view. */
  function followCamera() {
    const cam = ctx.camera;
    const p = cam.position;
    for (const l of [sun, moon]) {
      const d = l.userData.dir as THREE.Vector3 | undefined;
      if (!d) continue;
      l.position.copy(p).addScaledVector(d, 2000);
      l.target.position.copy(p);
      l.updateMatrixWorld();
      l.target.updateMatrixWorld();
    }
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    // From beyond what you look at, 35 degrees up: it catches tops and far edges.
    rim.position.copy(p).addScaledVector(fwd, 2000 * Math.cos(0.61)).add(tmpDir.set(0, 2000 * Math.sin(0.61), 0));
    rim.target.position.copy(p);
    rim.updateMatrixWorld();
    rim.target.updateMatrixWorld();
    // Clouds: draw the far slices first (bottom first from above, top first from below).
    const below = p.y < WORLD.cloudLevel + CLOUD_SLICES[1];
    if (below !== cloudsFromBelow) {
      cloudsFromBelow = below;
      cloudGeo.setIndex(below ? cloudIndexDown : cloudIndexUp);
    }
    pxRatio.value = renderer.getPixelRatio();
    starMat.uniforms.uPx.value = pxRatio.value;
  }

  scene.userData.light = handle;
  // First frame: apply the light at the current railU right away.
  handle.update(0, 0);
  const msBuild = performance.now() - t0;
  return handle;
}

function azOf(d: THREE.Vector3): number {
  return THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z));
}

// ── Lake shader ──────────────────────────────────────────────────────────────

const LAKE_SHADER = {
  name: "MirrorLakeShader",
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uDeep: { value: new THREE.Color() },
    uSkyTint: { value: new THREE.Color() },
    uLive: { value: 0 },
    uReflect: { value: new THREE.Vector2(LAKE_REFLECT_STEEP, LAKE_REFLECT_GRAZE) },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <fog_pars_vertex>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vec4 mvPosition = viewMatrix * w;
      gl_Position = projectionMatrix * mvPosition;
      #include <logdepthbuf_vertex>
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uDeep;
    uniform vec3 uSkyTint;
    uniform float uLive;
    uniform vec2 uReflect;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <fog_pars_fragment>
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec3 v = normalize(cameraPosition - vWorld);
      // Still water: a strong mirror at a grazing look, more of the water's own colour looking down.
      float fres = pow(1.0 - clamp(v.y, 0.0, 1.0), 5.0);
      float k = mix(uReflect.x, uReflect.y, fres);
      vec3 refl = uLive > 0.5 ? texture2DProj(tDiffuse, vUv).rgb : uSkyTint;
      gl_FragColor = vec4(mix(uDeep, refl, k), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
};

// ── Geometry ─────────────────────────────────────────────────────────────────

function hash1(i: number, seed: number): number {
  let h = (i * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Unit normal of the star band's great circle (STAR_BAND_THROUGH). */
function starBandNormal(out: THREE.Vector3): THREE.Vector3 {
  const [[a0, e0], [a1, e1]] = STAR_BAND_THROUGH;
  const p = dirFromAngles(a0, e0, new THREE.Vector3());
  const q = dirFromAngles(a1, e1, new THREE.Vector3());
  return out.crossVectors(p, q).normalize();
}

/**
 * Stars on the upper sky (a little below the horizon too, for the view down
 * from the island), and a share of them packed into a band across the north.
 * Most are faint and small, a few are bright: a clear night, not a sparkle.
 */
function buildStars(): THREE.BufferGeometry {
  const pos = new Float32Array(STAR_COUNT * 3);
  const bright = new Float32Array(STAR_COUNT);
  const size = new Float32Array(STAR_COUNT);
  const bandN = starBandNormal(new THREE.Vector3());
  const b1 = new THREE.Vector3().crossVectors(bandN, new THREE.Vector3(0, 1, 0)).normalize();
  const b2 = new THREE.Vector3().crossVectors(bandN, b1).normalize();
  const v = new THREE.Vector3();
  const nBand = Math.round(STAR_COUNT * STAR_BAND_SHARE);
  for (let i = 0; i < STAR_COUNT; i++) {
    const m = hash1(i, STAR_SEED + 2);
    if (i < nBand) {
      // On the band's circle, spread across it by a rough gaussian.
      let y = -1;
      for (let tries = 0; tries < 8 && y < -0.02; tries++) {
        const th = hash1(i * 8 + tries, STAR_SEED + 3) * Math.PI * 2;
        const g = (hash1(i * 8 + tries, STAR_SEED + 4) + hash1(i * 8 + tries, STAR_SEED + 5) + hash1(i * 8 + tries, STAR_SEED + 6) - 1.5) * 2;
        v.copy(b1).multiplyScalar(Math.cos(th)).addScaledVector(b2, Math.sin(th)).addScaledVector(bandN, g * STAR_BAND_WIDTH).normalize();
        y = v.y;
      }
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = Math.max(-0.02, v.y);
      pos[i * 3 + 2] = v.z;
      bright[i] = 0.4 + 0.6 * m * m * m;
      size[i] = 1.3 + 1.8 * m * m;
    } else {
      const y = -0.05 + 1.05 * Math.sqrt(hash1(i, STAR_SEED));
      const a = hash1(i, STAR_SEED + 1) * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(a) * r;
      bright[i] = 0.55 + 0.45 * m * m;
      size[i] = 1.7 + 2.8 * m * m * m;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aBright", new THREE.BufferAttribute(bright, 1));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  return g;
}

/** Three horizontal squares, bottom first; each carries its slice number (0 = bottom). */
function buildCloudGeometry(): THREE.BufferGeometry {
  const cx = (WORLD.minX + WORLD.maxX) / 2;
  const cz = (WORLD.minZ + WORLD.maxZ) / 2;
  const pos: number[] = [];
  const slice: number[] = [];
  const index: number[] = [];
  CLOUD_SLICES.forEach((dy, k) => {
    const y = WORLD.cloudLevel + dy;
    const b = pos.length / 3;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(cx + sx * CLOUD_HALF, y, cz + sz * CLOUD_HALF);
      slice.push(k);
    }
    index.push(b, b + 2, b + 1, b, b + 3, b + 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aSlice", new THREE.Float32BufferAttribute(slice, 1));
  g.setIndex(index);
  return g;
}

/** The same slices in the opposite order (top first), for a camera below the layer. */
function reversedSliceIndex(up: THREE.BufferAttribute): THREE.BufferAttribute {
  const src = up.array as ArrayLike<number>;
  const per = 6;
  const n = src.length / per;
  const out = new (src instanceof Uint32Array ? Uint32Array : Uint16Array)(src.length);
  for (let k = 0; k < n; k++) for (let j = 0; j < per; j++) out[k * per + j] = src[(n - 1 - k) * per + j];
  return new THREE.BufferAttribute(out, 1);
}

/** Terrain height over WORLD in a small texture, (h + 100) / 10 in the red channel. */
function buildHeightTexture(): THREE.DataTexture {
  const N = CLOUD_HEIGHT_RES;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    const z = WORLD.minZ + ((j + 0.5) / N) * (WORLD.maxZ - WORLD.minZ);
    for (let i = 0; i < N; i++) {
      const x = WORLD.minX + ((i + 0.5) / N) * (WORLD.maxX - WORLD.minX);
      const h = terrainHeight(x, z);
      const o = (j * N + i) * 4;
      data[o] = Math.max(0, Math.min(255, Math.round((h + 100) / 10)));
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ── CPU sky ──────────────────────────────────────────────────────────────────

const _low = new THREE.Color();
const _tmp = new THREE.Color();
/** lightSky() in TypeScript: linear colour in a unit direction, no discs. */
function skyCpu(s: LightState, d: THREE.Vector3, out: THREE.Color): THREE.Color {
  const deg = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, d.y))));
  const hl = Math.hypot(d.x, d.z);
  const sl = Math.hypot(s.sunDir.x, s.sunDir.z) || 1;
  const toward = hl > 1e-4 ? 0.5 + 0.5 * ((d.x / hl) * (s.sunDir.x / sl) + (d.z / hl) * (s.sunDir.z / sl)) : 0.5;
  _low.copy(s.skyHorizon).lerp(s.skyGlow, toward * toward);
  out.copy(s.skyHorizon).lerp(_low, smoothstep(-0.8, 1.2, deg));
  out.lerp(s.skyMid, smoothstep(SKY_SHAPE.midFrom, SKY_SHAPE.midTo, deg) * (0.55 + 0.45 * (1 - toward)));
  out.lerp(s.skyTop, smoothstep(SKY_SHAPE.topFrom, SKY_SHAPE.topTo, deg));
  const ca = Math.max(d.dot(s.sunDir), 0);
  const g = 0.22 * Math.pow(ca, 5) + 0.55 * Math.pow(ca, 90);
  out.r += s.sunGlow.r * g;
  out.g += s.sunGlow.g * g;
  out.b += s.sunGlow.b * g;
  _tmp.copy(s.haze).lerp(out, smoothstep(-2, 0, deg));
  return out.copy(_tmp);
}
