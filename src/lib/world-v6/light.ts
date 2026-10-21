import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { FLIGHT_KEYS, PLACES, ROUTE_MARKS, TAIL_KEYS, TRAIL, WORLD, type LightKey } from "./layout";
import { LAKE_PAD, lakeShoreR, terrainHeight } from "./terrain";

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
 * camera moved, and the idle loop keeps sleeping. The one exception is the
 * night layer's ease (below), 1.5 s at a time.
 *
 * The night layer (2026-10-20 night; option D of
 * _admin/prds/map-review-2026-10-15/real_time_light.md): the light still
 * follows the place, and on top of it the student's own clock (clock.ts,
 * through the scene's setClock) blends each key from the opening to the
 * forest toward a night of its own (NIGHT_ROWS). From Creative Strategy on
 * nothing changes. By day the light is the old light value for value
 * (client-tests/night-clock.test.mjs). state.night is the night's weight
 * where the camera is; the modules that darken for the night read it.
 *
 * The morning layer (2026-10-21, after the owner saw the night and a
 * throwaway morning probe): the same keys blend toward a morning of their
 * own (MORNING_ROWS) by the clock's morning factor, under the night (the
 * dawn is the night going off the morning). state.morning is the morning's
 * weight where the camera is: the lamps' halos go out by it, the lamp
 * materials turn to unlit glass (MORNING_LAMP_TINT), the grade's dew comes
 * in (MORNING_DEW), and the fog ramp lays the morning's mist (LookKey.mist).
 * With the morning at 0 the day and the night are what they were, value for
 * value (client-tests/morning-clock.test.mjs).
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
  /** Final pass B: 0..1, the finale's hero sun (a8 and the tail): a near white disc a third bigger, a quieter halo so the disc reads, painted rays around it. Default 0. */
  sunHero?: number;
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
  /** The moon disc's radius, degrees. Omitted = MOON_RADIUS_DEG (the island's big moon); the night layer's ground rows draw a smaller one (NIGHT_MOON_RADIUS_DEG). */
  moonRadius?: number;
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
  /** 0..1: how much aurora the sky may show here (nightsky.ts). Omitted = `stars`, as it always was; the night layer keeps it to the forest and the island. */
  aurora?: number;
  /** 0..1: the Milky Way's level (the sky's uBand, times STAR_BAND_GLOW). Omitted = `stars`, as it always was; the night layer keeps it to the forest and the island. */
  band?: number;
  /** 0..1: how much of this key is the night layer (NIGHT below). 0 on every authored key; 1 on a night key. Blended, it is LightState.night. */
  night?: number;
  /** 0..1: how much of this key is the morning layer (MORNING below). 0 on every authored key and every night key; 1 on a morning key. Blended, it is LightState.morning. */
  morning?: number;
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
// v6 (bible 1.17): the a7 sky frame looks at bearing 293, 18 up, lens 38: the
// moon sits in its upper right third, clear of the Creative Strategy
// constellation (az 300, el 31, 11 across).
const MOON_AZ = 312;
const MOON_EL = 28;
/** Fix round 3: the a7 frame turned to bearing 46 (layout STAR_LOOK), so the
 *  night key's moon sits in its upper left, on the moonlight's side (333);
 *  the rise's keys keep MOON_AZ (the moon is out of their frame on both). */
// Final pass: at 26 the moon sat left of the a7 view (bearing 46), so on the
// arrival, where the camera turns right from 352 to 46, it entered upper
// right and slid across the whole frame to the upper left, and the island
// frame after a7 cut it with the top edge. At 66 it is right of the a7 view:
// it comes in at the right edge as the turn ends, rests in the upper right at
// a7 (the bible's "moon in the upper right third"), and leaves at the right
// edge as the camera turns back toward the bridge; the flight never sees it.
const NIGHT_MOON_AZ = 66;
// Round 1 verify: the a7 frame looks up 3 through lens 42 (its top edge sits
// about 24 up), so at 23.5 the disc was cut by the top edge behind the
// header. 14.5 keeps it whole, clear of the header and under the aurora's
// bright lower edge (at 17.5 the curtain washed it teal); the moonlight's own direction
// (moonLightAz / moonLightEl) is unchanged.
const NIGHT_MOON_EL = 14.5;
/** Final pass C: the night key's moonlight, on the moon's side of the a7 view. */
const NIGHT_MOONLIGHT_AZ = 116;

/**
 * Every light key light.ts has a row for. layout.ts's LightKey is the set the
 * PLACES use; v6 adds "gorge-sunset" (the exit, the hike, a4) and "sunrise"
 * (a8 and the tail) and retires "morning". The rows exist here whatever the
 * union says, so a place can name them the moment layout.ts's union grows,
 * and "morning" keeps its row until the union drops it.
 */
export type LightName = LightKey | "gorge-sunset" | "sunrise" | "morning";

export const LIGHTS: Record<LightName, LightKeyframe> = {
  "afternoon-gold": {
    // v6 (bible 16): the sun moves from 285 / 13 to 250 / 16, so the Landing
    // is side lit from the left instead of backlit and ground heavy.
    sunAz: 250, sunEl: 16, sunColor: 0xffc890, sunIntensity: 4.6, sunGlow: 0xffc080,
    moonAz: 120, moonEl: 20, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, moonColor: 0xc8d4ff, moonIntensity: 0, moonVis: 0,
    rimColor: 0xffe0c0, rimIntensity: 0,
    // v6: a bluer top and a warmer gold horizon (Firewatch sky saturation);
    // the fill follows the sky (hemisphere at a real intensity, blue-violet),
    // so shade is coloured and has value, not the v5 near black.
    skyTop: 0x5a8ccc, skyMid: 0xa8c0d8, skyHorizon: 0xf4d0a0, skyGlow: 0xffcc88,
    haze: 0xd8c0a4, fogNear: 1400, fogFar: 8000,
    hemiSky: 0x9cb0d8, hemiGround: 0x5a4430, hemiIntensity: 1.35,
    ambient: 0x8e98b8, ambientIntensity: 0.22, exposure: 1.08, stars: 0,
    cloudTop: 0xfff0dc, cloudBase: 0xb0a8aa, water: 0x3a5264,
    lampGlow: 0.4, magicGlow: 0.15,
  },
  afternoon: {
    sunAz: 245, sunEl: 14, sunColor: 0xffd6a8, sunIntensity: 4.5, sunGlow: 0xffd4a0,
    moonAz: 120, moonEl: 20, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, moonColor: 0xc8d4ff, moonIntensity: 0, moonVis: 0,
    rimColor: 0xffe0c0, rimIntensity: 0,
    // v6: clear blue sky over a green and gold meadow (bible 2.6); shade takes the sky.
    skyTop: 0x4f86cc, skyMid: 0x9cc0e0, skyHorizon: 0xe8e0c8, skyGlow: 0xffe0b0,
    haze: 0xdcc8a0, fogNear: 1300, fogFar: 7500,
    hemiSky: 0x98b4dc, hemiGround: 0x4e4630, hemiIntensity: 1.35,
    ambient: 0x96a4bc, ambientIntensity: 0.2, exposure: 1.08, stars: 0,
    cloudTop: 0xffffff, cloudBase: 0xb0b4bc, water: 0x3a5468,
    lampGlow: 0.4, magicGlow: 0.15,
  },
  "late-afternoon": {
    sunAz: 285, sunEl: 11, sunColor: 0xffc88c, sunIntensity: 3.4, sunGlow: 0xffb870,
    moonAz: 120, moonEl: 20, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, moonColor: 0xc8d4ff, moonIntensity: 0, moonVis: 0,
    rimColor: 0xffe0c0, rimIntensity: 0,
    skyTop: 0x6c8cc0, skyMid: 0xe0c4a8, skyHorizon: 0xf4c890, skyGlow: 0xffc478,
    haze: 0xe0b088, fogNear: 600, fogFar: 5200,
    hemiSky: 0x9aa8cc, hemiGround: 0x5e4a3a, hemiIntensity: 1.7,
    ambient: 0x98a0bc, ambientIntensity: 0.35, exposure: 1.08, stars: 0,
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
  /**
   * v6 (bible 1.0, 2.6): the log crossing, the hike and a4.
   * The sun low in the west-north-west (az 300, el 6) lights the falls and the
   * north-west planes of the gorge from the right of the a4 view; the gorge's
   * shade takes the violet of the sky (hemisphere fill from the mid sky, at a
   * real intensity) so it reads as shade, never as black. Mist lies in the
   * gorge (LOOKS hazeBase 60, falloff 180).
   */
  "gorge-sunset": {
    sunAz: 300, sunEl: 6, sunColor: 0xffb070, sunIntensity: 3.8, sunGlow: 0xffa458,
    moonAz: 120, moonEl: 20, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, moonColor: 0xc8d4ff, moonIntensity: 0, moonVis: 0,
    rimColor: 0xffd0a0, rimIntensity: 0,
    skyTop: 0x6f78a8, skyMid: 0xd8a8a0, skyHorizon: 0xf4b07a, skyGlow: 0xffb468,
    haze: 0xd89c80, fogNear: 600, fogFar: 6000,
    hemiSky: 0xb0a0bc, hemiGround: 0x5a4034, hemiIntensity: 1.7,
    ambient: 0x8c86a8, ambientIntensity: 0.4, exposure: 1.1, stars: 0,
    cloudTop: 0xffc49a, cloudBase: 0x8e7a90, water: 0x3a4a5c,
    lampGlow: 0.55, magicGlow: 0.3,
  },
  sunset: {
    sunAz: 262, sunEl: 1.6, sunColor: 0xff9458, sunIntensity: 3.0, sunGlow: 0xff9048,
    moonAz: MOON_AZ, moonEl: MOON_EL, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, moonColor: 0xc8d4ff, moonIntensity: 0, moonVis: 0,
    rimColor: 0xffc090, rimIntensity: 0,
    skyTop: 0x5c6296, skyMid: 0xe4a08c, skyHorizon: 0xf4a474, skyGlow: 0xffb064,
    haze: 0xc88470, fogNear: 1600, fogFar: 10000,
    hemiSky: 0x7c7898, hemiGround: 0x4c3830, hemiIntensity: 1.3,
    ambient: 0x7e84a2, ambientIntensity: 0.35, exposure: 1.1, stars: 0.06,
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
    // v6: moonlight from the right of the a7 view (bible 1.0: ~40 right, el 25).
    // Final pass C: 333 lit the a7 frame (bearing 44.5) from the left while the
    // moon hung upper right (66). 116 mirrors it across the view: the same
    // side light, now from the moon's side.
    moonAz: NIGHT_MOON_AZ, moonEl: NIGHT_MOON_EL, moonLightAz: NIGHT_MOONLIGHT_AZ, moonLightEl: 25, moonColor: 0xc8d4ff, moonIntensity: 1.6, moonVis: 1,
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
   * v6 a8 and the tail (bible 1.20, 2.6): the Gate of the Sun. The sun sits
   * inside the arch (az 322, el 4), backlit on purpose: a near white disc, a
   * gold glow, gold cloud tops. The moonlight slot carries the bright sky
   * behind the camera (az 150) as a cool fill, so the arch's near faces are
   * cool violet shade with value in them, not a black cut-out.
   */
  sunrise: {
    sunAz: 322, sunEl: 4, sunColor: 0xfff1c0, sunIntensity: 3.4, sunGlow: 0xffa84a, sunHero: 1,
    moonAz: 296, moonEl: 14, moonLightAz: 150, moonLightEl: 30, moonColor: 0xb8c4f0, moonIntensity: 0.7, moonVis: 0,
    rimColor: 0xffd8a8, rimIntensity: 0,
    skyTop: 0x3a4a86, skyMid: 0xc49aa0, skyHorizon: 0xffb46a, skyGlow: 0xffc070,
    haze: 0xd8a488, fogNear: 1800, fogFar: 12000,
    hemiSky: 0x9a90b8, hemiGround: 0x3a3040, hemiIntensity: 1.5,
    ambient: 0x7e80a8, ambientIntensity: 0.35, exposure: 1.1, stars: 0,
    cloudTop: 0xffd088, cloudBase: 0x7a6a88, water: 0x2c3a54,
    lampGlow: 0.6, magicGlow: 0.3,
  },
  /**
   * The Harbour Isle: a clear, low morning sun ahead-right of the square (it
   * rose ahead of the flight), the cloud sea white below. The square looks
   * toward the sun, so the moonlight slot carries the bright sky behind the
   * camera as a cool fill (az 150, the Guild Hall's front faces about 141):
   * the hall reads as a lit building, not a slab against the light.
   */
  morning: {
    // v5 camera pass 2: Firewatch morning value (pass 1 read 232/143/151 by
    // rows: a white sky over a flat grey town). A bluer, darker upper sky, a
    // warmer sun, and less of the flat fill (hemi, the cool fill from behind,
    // ambient) so the faces turned from the sun go cool and mid dark. The
    // square looks within 35 of the sun, so its whole sky is the glow side
    // (lightSky's `toward` ~1): skyGlow and skyMid set the frame's top.
    sunAz: 350, sunEl: 11, sunColor: 0xffd09a, sunIntensity: 4.0, sunGlow: 0xffc88a,
    moonAz: 296, moonEl: 14, moonLightAz: 150, moonLightEl: 28, moonColor: 0xc8d8f0, moonIntensity: 0.75, moonVis: 0,
    rimColor: 0xffe0c0, rimIntensity: 0,
    skyTop: 0x5078b8, skyMid: 0x93b0d0, skyHorizon: 0xeadcc4, skyGlow: 0xf8d8aa,
    haze: 0xcdc9c2, fogNear: 1800, fogFar: 12000,
    hemiSky: 0x9fb0c8, hemiGround: 0x4e443c, hemiIntensity: 1.0,
    ambient: 0x9ea8b8, ambientIntensity: 0.14, exposure: 0.94, stars: 0,
    cloudTop: 0xfff4e4, cloudBase: 0xa4a2b2, water: 0x3a5468,
    lampGlow: 0.4, magicGlow: 0.15,
  },
};

/**
 * Keyframes that belong to no place. They shape the light between two stops
 * through LIGHT_WAYPOINTS.
 */
export const LIGHTS_BETWEEN = {
  /** Late in the flight: the sun has cleared the horizon ahead, the cloud sea
   *  below is gold. v6: the sun is on its way to the arch (az 322 at a8). */
  "dawn-clear": {
    sunAz: 331, sunEl: 3.5, sunColor: 0xffb070, sunIntensity: 3.0, sunGlow: 0xffa850,
    moonAz: 298, moonEl: 20, moonLightAz: 170, moonLightEl: 32, moonColor: 0xd0dcf8, moonIntensity: 0.5, moonVis: 0.15,
    rimColor: 0xffd0a8, rimIntensity: 0.2,
    skyTop: 0x4868a4, skyMid: 0xc4a8a8, skyHorizon: 0xf0c0a0, skyGlow: 0xffcc88,
    haze: 0xc8a494, fogNear: 1800, fogFar: 12000,
    hemiSky: 0x8a96bc, hemiGround: 0x3a3240, hemiIntensity: 1.5,
    ambient: 0x7e88aa, ambientIntensity: 0.4, exposure: 1.1, stars: 0.05,
    cloudTop: 0xffc878, cloudBase: 0x7a6a88, water: 0x2c3a54,
    lampGlow: 0.7, magicGlow: 0.5,
  },
  /** Fix round 1 (judge 1): the opening (key 0) only. The Landing's sun and
   *  sky, so the glide into a1 changes nothing but the air (LOOKS row). */
  // Final pass (the first frame every student sees): a deeper, more saturated
  // blue behind the plume, so the cream plume and the gold massif and east
  // ridge stand against their complement (A/B in shots/v6/finalA/skyui/k0-ab2:
  // a warmer, greyer mid sky, k0-ab1 v2, took the plume's contrast away);
  // the cirrus and cumulus lit warm by the low sun instead of a grey base,
  // and a gold horizon line behind the ridges (LOOKS row). It eases into the
  // Landing's own afternoon-gold by a1.
  // Final pass D: with the plume quiet the frame's depth has to come from the
  // air. The mid sky was one blue from the ridges up (sky just above the
  // ridges 166 against far ridges 164 and the mid shelf 148: one value band).
  // A paler mid sky and horizon grade the sky toward the ridge line (191), so
  // near forest 72, mid shelf 145, far ridges 170, sky 191 step back in value
  // (A/B in shots/v6/finalD/light/cmp-opening*.jpg; a paler c8d8e8 washed
  // the clouds out).
  "opening-gold": {
    ...LIGHTS["afternoon-gold"],
    skyTop: 0x3a68b8, skyMid: 0xa8c4e4, skyHorizon: 0xf8e4c4,
    cloudTop: 0xfff6e6, cloudBase: 0xdcc2aa,
  },
} satisfies Record<string, LightKeyframe>;

export type LightWaypointKey = LightName | keyof typeof LIGHTS_BETWEEN;

// ── Tuning: the v5 look per key (world_art_bible.md 1.2-1.6) ────────────────

/**
 * What v5 adds to each light key, kept beside LIGHTS so the approved grey
 * keys stay as they were. Colours are display sRGB hex.
 *
 *   nearShade   the colour the near layer's shadows and the fog ramp's first
 *               stops lean toward (bible 1.2 "Near shade")
 *   rampStart / rampEnd   the fog ramp's distances (bible 1.4). They replace
 *               LIGHTS' fogNear / fogFar and scene.ts's FOG_TABLE; the scene
 *               sets camera.far from rampEnd, so the ramp is also the cull
 *   hazeBase / hazeFall   valleys hold more haze: the ramp's alpha is scaled
 *               from 1.15 at or under hazeBase (world y) to 0.75 high above,
 *               falling off over hazeFall. hazeOn 0 switches it off
 *   sunLobe     extra sun glow added into the fog looking toward the sun
 *   fogCap      the most the fog ever covers (0.92: the farthest ridge keeps
 *               a trace of itself against the sky)
 *   lift / gain / gamma / sat   the grade (bible 1.6), applied inside tone
 *               mapping after ACES, in display space
 *   halo / haloAmt / haloDeg / haloHalf   the horizon halo (bible 1.5): a band
 *               centred haloDeg above the horizon, haloHalf tall each way.
 *               halo null = mix(skyHorizon, white, 0.25), the daytime halo
 */
export interface LookKey {
  nearShade: number;
  rampStart: number;
  rampEnd: number;
  hazeBase: number;
  hazeFall: number;
  hazeOn: number;
  sunLobe: number;
  fogCap: number;
  lift: readonly [number, number, number];
  gain: readonly [number, number, number];
  gamma: number;
  sat: number;
  halo: number | null;
  haloAmt: number;
  haloDeg: number;
  haloHalf: number;
  /** Detail pass 3: 0..1, how much of the halo the fog's far end and the sky
   *  under the horizon carry. At 1 the farthest ridge or cloud sea melts into
   *  the halo at the horizon, so a night halo reads as a glow, not a stripe
   *  cut off by the cloud sea. Omitted = 0 (the day keys). */
  haloFog?: number;
  /** v6 (bible 2.6): the additive fog term k. Mid distance layers get lighter
   *  and take the ramp's hue (Firewatch's stylistic fog); the far end still
   *  meets the sky. Omitted = 0. */
  fogAdd?: number;
  /** The morning's mist (MORNING_LOOK): a layer of `mistColor` lying from the
   *  key's hazeBase up to mistDepth above it, coming in from mistNear to
   *  mistFar away, at most `mist` of a pixel. Omitted = 0: no mist (every
   *  authored key, every night key). */
  mist?: number;
  mistDepth?: number;
  mistNear?: number;
  mistFar?: number;
  mistColor?: number;
}

const DAY_HALO = { halo: null, haloAmt: 0.55, haloDeg: 1.6, haloHalf: 3.2 } as const;
const LOW_HALO = { halo: 0xc8603a, haloAmt: 0.4, haloDeg: 0.35, haloHalf: 0.6 } as const;

export const LOOKS: Record<LightWaypointKey, LookKey> = {
  "afternoon-gold": {
    // Pass 3: the valley wall toward the WNW sun glows (sunLobe), more saturation. rampEnd stays
    // 4400: pushed to 6000 it thinned the far haze and cut the luma spread 116 -> 102 (gates).
    nearShade: 0x3b4a5c, rampStart: 200, rampEnd: 4400, hazeBase: 0, hazeFall: 220, hazeOn: 1, sunLobe: 0.6, fogCap: 0.9,
    lift: [0.01, 0.02, 0.045], gain: [1.06, 1.01, 0.94], gamma: 0.96, sat: 1.35, ...DAY_HALO, fogAdd: 0.3,
  },
  afternoon: {
    nearShade: 0x2e4a54, rampStart: 300, rampEnd: 4400, hazeBase: 120, hazeFall: 260, hazeOn: 1, sunLobe: 0.35, fogCap: 0.9,
    lift: [0.005, 0.02, 0.035], gain: [1.04, 1.02, 0.97], gamma: 0.96, sat: 1.22, ...DAY_HALO, fogAdd: 0.3,
  },
  "late-afternoon": {
    nearShade: 0x3c4458, rampStart: 150, rampEnd: 5200, hazeBase: 60, hazeFall: 160, hazeOn: 1, sunLobe: 0.5, fogCap: 0.9,
    lift: [0.015, 0.015, 0.045], gain: [1.06, 0.99, 0.92], gamma: 0.96, sat: 1.25, ...DAY_HALO, fogAdd: 0.4,
  },
  "sunset-cliff": {
    nearShade: 0x3e3446, rampStart: 250, rampEnd: 6000, hazeBase: 560, hazeFall: 200, hazeOn: 1, sunLobe: 0.6, fogCap: 0.92,
    lift: [0.015, 0, 0.035], gain: [1.05, 0.98, 0.92], gamma: 1.0, sat: 1.02, ...DAY_HALO, haloAmt: 0.45,
  },
  "gorge-sunset": {
    nearShade: 0x3d3450, rampStart: 150, rampEnd: 5200, hazeBase: 60, hazeFall: 180, hazeOn: 1, sunLobe: 0.7, fogCap: 0.9,
    lift: [0.03, 0.012, 0.05], gain: [1.07, 0.99, 0.92], gamma: 0.94, sat: 1.3, ...DAY_HALO, haloAmt: 0.45, fogAdd: 0.5,
  },
  sunset: {
    nearShade: 0x3a3350, rampStart: 300, rampEnd: 6500, hazeBase: 562, hazeFall: 140, hazeOn: 1, sunLobe: 0.8, fogCap: 0.92,
    lift: [0.02, 0, 0.04], gain: [1.06, 0.98, 0.9], gamma: 1.0, sat: 1.15, ...DAY_HALO, haloAmt: 0.4, fogAdd: 0.55,
  },
  dusk: {
    nearShade: 0x161a2c, rampStart: 120, rampEnd: 7000, hazeBase: 790, hazeFall: 90, hazeOn: 1, sunLobe: 0.4, fogCap: 0.92,
    lift: [0, 0.01, 0.04], gain: [1.0, 1.0, 1.02], gamma: 1.0, sat: 1.1, ...LOW_HALO, fogAdd: 0.3,
  },
  night: {
    nearShade: 0x0e1226, rampStart: 400, rampEnd: 11000, hazeBase: 1100, hazeFall: 300, hazeOn: 1, sunLobe: 0, fogCap: 0.92,
    // Detail pass 3: the halo was a 1.8-degree orange band cut off by the cloud
    // sea (it read as a stripe across a7, the bridge and the cast-off). Now it
    // sits on the horizon, fades out over 8 degrees, and the fog's far end
    // carries it (haloFog), so the cloud sea melts up into it: a glow.
    lift: [0, 0.005, 0.03], gain: [0.98, 1.0, 1.05], gamma: 0.95, sat: 0.9, ...LOW_HALO, halo: 0x7a5c84, haloAmt: 0.3, haloDeg: 0, haloHalf: 8, haloFog: 1, fogAdd: 0.15,
  },
  dawn: {
    nearShade: 0x2a2640, rampStart: 400, rampEnd: 12000, hazeBase: 1100, hazeFall: 300, hazeOn: 1, sunLobe: 0.9, fogCap: 0.92,
    lift: [0.02, 0, 0.03], gain: [1.06, 0.98, 0.94], gamma: 1.0, sat: 1.0, ...LOW_HALO, haloAmt: 0.45,
  },
  "dawn-clear": {
    nearShade: 0x3a3448, rampStart: 400, rampEnd: 12000, hazeBase: 1100, hazeFall: 300, hazeOn: 1, sunLobe: 0.6, fogCap: 0.92,
    lift: [0.01, 0, 0.025], gain: [1.05, 0.99, 0.95], gamma: 1.0, sat: 1.0, ...DAY_HALO, haloAmt: 0.45,
  },
  "opening-gold": {
    // Fix round 1 (judge 1): the opening read hazy and flat, every ridge in
    // one grey band. Less additive fog and a longer ramp, so the col, the
    // massif and the east peaks step back in value; a darker near shade so
    // the islet read as the dark near shape (the islet and its boulders went
    // in the map review of 2026-10-15, item 7; the value stays). It eases
    // into afternoon-gold by a1 (a hold waypoint at key 0).
    // rampEnd stays 4400: it is also the cull, and at 6200 the far north wall
    // rose behind the plume and took the sky from 45% to 36% (fix-1-frame/k0-after).
    // Fix round 2 (judge 2): the west massif still read hazy. fogCap 0.9 -> 0.84
    // and fogAdd 0.12 -> 0.06: the massif keeps its lit and shade faces (band
    // medians massif 108-113, col 125, east peaks 131; were 112-122, 133, 137).
    // At 0.78 and 0 the whole valley went dull (fix-2-frame/k0-fog1).
    // Final pass: a gold line on the horizon behind the ridges (halo, 0.55 -> 0.7).
    // Final pass D: the haze starts later (420 -> 800) and the additive term is
    // off, so the near forest and the shelf keep their own colour and value;
    // the far end goes paler (cap 0.84 -> 0.9), the halo band reaches higher
    // (haloHalf 3 -> 5). Tried and dropped: a lower sun (el 9) with a warm rim
    // light (flattened the valley: the rim lights every top face alike), and a
    // cooler haze with more additive fog (greyed the valley).
    nearShade: 0x2c3848, rampStart: 800, rampEnd: 4400, hazeBase: 0, hazeFall: 220, hazeOn: 1, sunLobe: 0.6, fogCap: 0.9,
    lift: [0.005, 0.015, 0.04], gain: [1.06, 1.01, 0.94], gamma: 0.98, sat: 1.35, ...DAY_HALO, halo: 0xfae0b4, haloAmt: 0.7, haloHalf: 5, fogAdd: 0,
  },
  sunrise: {
    nearShade: 0x2a2440, rampStart: 400, rampEnd: 12000, hazeBase: 1100, hazeFall: 300, hazeOn: 1, sunLobe: 0.9, fogCap: 0.9,
    lift: [0.015, 0.005, 0.03], gain: [1.07, 1.0, 0.93], gamma: 1.0, sat: 1.2, ...LOW_HALO, halo: 0xffb060, haloAmt: 0.5, haloDeg: 0.6, haloHalf: 2.2, fogAdd: 0.6,
  },
  morning: {
    // v5 camera pass 2: warm highs, cool lows, the mids a touch down.
    nearShade: 0x3e4a5c, rampStart: 400, rampEnd: 12000, hazeBase: 1100, hazeFall: 300, hazeOn: 1, sunLobe: 0.35, fogCap: 0.92,
    lift: [0, 0.012, 0.03], gain: [1.06, 1.0, 0.92], gamma: 0.96, sat: 1.0, ...DAY_HALO,
  },
};

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
export interface LightWaypoint {
  key: number;
  light: LightWaypointKey;
  hold: boolean;
  /** Optional: the waypoint's key is `light` blended toward `mix.to` by `mix.k` (linear space). */
  mix?: { to: LightWaypointKey; k: number };
}

/**
 * v6 waypoints (bible 1.0's light table). Final pass: every key is read from
 * the layout by name (ROUTE_MARKS rows and PLACES), never a raw KEYS number,
 * so a change to the route (keys added or removed) moves the light with it.
 * The raw numbers these replace (11, 23, 32.5, 38, 42, 43.6, 45) had already
 * drifted after round 1: 38 fell on a4 and was dropped.
 *   stream .. a3           late-afternoon: from a third of the way from the
 *                          stream to the lip, the lip, the ride, the turn at
 *                          the pool and a3 hold one sun (285 / 11, the mist
 *                          lit ahead left)
 *   a3 .. wall             the blend to gorge-sunset, eased at both ends: it
 *                          starts as the camera leaves the a3 stop and is
 *                          done by the "wall" mark. Since decision 67 (the
 *                          camera walks the trail) that mark is the bench's
 *                          west end, at the top of the wall: the sun sinks 5
 *                          degrees and swings 15 while the camera comes down
 *                          to the pool, crosses the log and the fan and
 *                          climbs (1,140 units, three quarters of the walk),
 *                          and the bench and the hut are in a4's light
 *   wall .. gully          gorge-sunset: the sun is low in the WNW (300 / 6)
 *                          from the "wall" mark (a hold) up to a4 (hikeTo,
 *                          just before it) and along the traverse to the
 *                          gully's foot, so the last third of the move and
 *                          the arrival are in a4's light, as they were.
 *                          2026-10-13 (Lovro: the camera no longer goes into
 *                          the cave between Video Ads 1 and 2): there were
 *                          two anchors here, late-afternoon until "halfway
 *                          from a3 to the cave" (turnTo) and gorge-sunset
 *                          from "exit - 0.5" (exitOut), and the blend between
 *                          them ran out of sight under the cave's own light.
 *                          Both marks are retired. The blend runs in the
 *                          open now, so it is as long and as soft as the
 *                          move allows: turnTo is gone (the a3 stop is the
 *                          late-afternoon hold it starts from) and exitOut
 *                          became wallTo, a hold (as a pass-through the
 *                          change stopped dead at 1.8 times its mean rate:
 *                          unseen in the dark, a visible stop in the open)
 *   gully .. burst (0.53)  sunset-cliff: the sun swings to 228 inside the
 *                          gully, where its walls hide the swing
 *   burst                  half sunset-cliff, half sunset: v5's burst sat
 *                          exactly halfway between its a4 and a5
 *   flight                 night, dawn at 0.45, then "dawn-clear" at the
 *                          flight's last three keys: the sun swings from 331
 *                          toward the arch's 322 (camera untouched)
 * Keys that fall on a place or outside the route, or whose mark is missing
 * (NaN, with a warning), are dropped by buildTrack.
 */
const markKey = (name: string): number => {
  const k = ROUTE_MARKS[name];
  if (typeof k === "number") return k;
  console.warn(`[world-v6 light] no ROUTE_MARKS row "${name}"; its light waypoint is dropped`);
  return NaN;
};
const placeKey = (id: string): number => PLACES.find((p) => p.id === id)?.trail ?? NaN;
const between = (a: number, b: number, t: number) => a + (b - a) * t;
const V6_WAYPOINT_KEYS = {
  opening: 0,
  streamFrom: between(markKey("stream"), markKey("lip"), 1 / 3),
  wallTo: markKey("wall"),
  hikeTo: placeKey("a4") - 0.5,
  traverseTo: markKey("gully"),
  gully: between(markKey("gully"), markKey("burst"), 1.6 / 3),
  burst: markKey("burst"),
} as const;
export const LIGHT_WAYPOINTS: ReadonlyArray<LightWaypoint> = [
  // Fix round 1: the opening's clearer air, held at key 0, eased into a1.
  { key: V6_WAYPOINT_KEYS.opening, light: "opening-gold", hold: true },
  { key: V6_WAYPOINT_KEYS.streamFrom, light: "late-afternoon", hold: false },
  { key: V6_WAYPOINT_KEYS.wallTo, light: "gorge-sunset", hold: true },
  { key: V6_WAYPOINT_KEYS.hikeTo, light: "gorge-sunset", hold: false },
  { key: V6_WAYPOINT_KEYS.traverseTo, light: "gorge-sunset", hold: false },
  { key: V6_WAYPOINT_KEYS.gully, light: "sunset-cliff", hold: false },
  { key: V6_WAYPOINT_KEYS.burst, light: "sunset-cliff", hold: false, mix: { to: "sunset", k: 0.5 } },
  ...(FLIGHT_KEYS.first >= 0 && FLIGHT_KEYS.last > FLIGHT_KEYS.first
    ? [
        { key: FLIGHT_KEYS.first, light: "night" as const, hold: true },
        { key: FLIGHT_KEYS.first + 0.45 * (FLIGHT_KEYS.last - FLIGHT_KEYS.first), light: "dawn" as const, hold: false },
        { key: FLIGHT_KEYS.last - 2, light: "dawn-clear" as const, hold: false },
      ]
    : []),
];

/**
 * Share of each stretch, at each end, where the light holds its stop's key.
 * Between the holds the blend is a smootherstep, so the light never changes
 * speed abruptly and scrolling back retraces it exactly.
 */
export const LIGHT_HOLD = 0.08;

/**
 * Detail pass 3, the Glowing Forest (bible a6): inside the forest circle, near
 * the ground, once the sun is down, the lit world goes dark and the glow carries
 * the frame. Cutting the hemisphere fill alone moved the a6 frame only 56 -> 60%
 * dark (the fill is not what lights it), so the ambient, the moon and rim, and
 * the exposure come down with it; the materials tagged "magic" (glow ferns,
 * moss, pools) get the exposure back, so the glow, the Great Tree and the sky
 * (not tone mapped) hold. Measured at a6 on 2026-09-26: 56 -> 68% dark.
 * Each value is the share cut at full strength.
 */
const FOREST_DIM = { fill: 0.7, ambient: 0.6, moon: 0.5, exposure: 0.45 } as const;

// ── Tuning: the night layer (real_time_light.md, option D) ──────────────────

/**
 * Night on the student's clock (clock.ts, Lovro 2026-10-20 night). The light
 * still follows the PLACE: each key from the opening to the Glowing Forest
 * has a night of its own (nightKeyframe, nightLook, NIGHT_ROWS) and blends
 * toward it by the night factor (setNight) times its dial. The Sky Island is
 * night already and the arch keeps its sunrise, so no key from a7 on has a
 * row: after dark the airship flies out of the night into the morning, as the
 * design file means the arch ("walking through the door into your own
 * morning").
 *
 * A night key is its day key with:
 *   - the sun gone: under the horizon at its own azimuth, no light, no glow;
 *   - the moonlight from where the day's sun lights the view (its azimuth,
 *     a little higher), so the faces lit by day are the faces lit by the moon
 *     and the rock faces and tree shadows painted at load for the day's sun
 *     still agree with the light;
 *   - the moon's disc where the row puts it in that view's sky;
 *   - NIGHT_BASE's sky, haze, fill, clouds, water, stars and lamp levels,
 *     and NIGHT_LOOK's grade, halo and near shade;
 *   - the day's fog ramp distances and haze shape (the ramp's end is also
 *     the camera's far plane, so the night draws what the day draws);
 *   - no aurora but in the forest (the island keeps its own).
 * By day (factor 0) every key is its authored one, value for value.
 */
export interface NightRow {
  /** How far toward its night this key goes at a night factor of 1 (readability: the opening stops short). */
  dial: number;
  /** The moon's disc in this view's sky: compass azimuth and elevation. */
  moonAz: number;
  moonEl: number;
  /** Where the moonlight comes from, if not from the day sun's azimuth, NIGHT_MOONLIGHT_LIFT higher. */
  moonLightAz?: number;
  moonLightEl?: number;
  /** Row overrides on NIGHT_BASE and NIGHT_LOOK. */
  light?: Partial<LightKeyframe>;
  look?: Partial<LookKey>;
}

/**
 * The keys blend in linear light, where the day is 10 to 30 times the night:
 * a straight blend stays near day for most of the clock's fade and drops at
 * its end (at a weight of 0.8 the opening still read as blue hour, 5 percent
 * of it very dark; at 1, 51). The clock's factor f goes through
 * 1 - (1 - f)^NIGHT_EASE_POWER first, so each step of the fade looks about
 * as big as the last.
 */
export const NIGHT_EASE_POWER = 2.5;
/** The blend weight the night layer uses for a night factor f (0..1). */
export function nightWeight(f: number): number {
  const n = Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0));
  return 1 - Math.pow(1 - n, NIGHT_EASE_POWER);
}

/**
 * What a lamp material's colour is multiplied by at night 1 (linear): lit
 * windows and the campfire stay warm under the night's exposure instead of
 * going white. The lesson lanterns' glass takes it too (progress-world.ts).
 * Tune pass (the critique of 2026-10-20 night): at (1, 0.74, 0.46) a window
 * at the night's lamp level (1.1) and exposure (1.35) still sat in ACES's
 * shoulder, where every channel runs to 1: it came out cream white (sat
 * 0.06 to 0.2), the campfire a pale cone. Half the red and far less green and
 * blue put the lamps in the curve's middle, where the hue holds: a window
 * comes out about #e9b066 (hue 34, sat 0.56), the fire #eaa45c (hue 30),
 * the sand of the brand (#E8A86A) and still the brightest thing in frame.
 */
export const NIGHT_LAMP_TINT: readonly [number, number, number] = [0.5, 0.15, 0.025];
const _nightLampTint = new THREE.Color(...NIGHT_LAMP_TINT);
const _lampTint = new THREE.Color();

/**
 * The moon disc on the ground rows, degrees of radius. The island's big moon
 * (MOON_RADIUS_DEG, 5 across, bible 1.17) took the opening's first look away
 * from the plume and stood over a1's card (190 px across at 1691 x 1278); the
 * sky frame at a7 keeps it.
 */
const NIGHT_MOON_RADIUS_DEG = 1.75;

/** The night's sun: this far under the horizon (nothing of it shows or lights). */
const NIGHT_SUN_EL = -24;
/** The moonlight stands this much higher than the day's sun at that view, and at least NIGHT_MOONLIGHT_MIN. */
const NIGHT_MOONLIGHT_LIFT = 8;
const NIGHT_MOONLIGHT_MIN = 18;

/** The night every row starts from: LIGHTS.night's colours, for land seen from the ground. */
export const NIGHT_BASE = {
  sunColor: 0xff7040, sunIntensity: 0, sunGlow: 0x000000, sunHero: 0,
  // Tune pass (the critique of 2026-10-20 night): more of the light from the
  // moon (1.5 -> 1.8) and less from the fill, so the faces turned to the moon
  // and the faces turned away differ in value, not in hue.
  moonColor: 0xc8d4ff, moonIntensity: 1.8, moonVis: 1, moonRadius: NIGHT_MOON_RADIUS_DEG,
  // Tune pass: a stronger rim (0.8), a silver edge on the near trees, so the
  // opening's near forest reads as trees and not one black band.
  rimColor: 0x8fa6ff, rimIntensity: 1.1,
  // A moonlit sky, a step lighter than the island's (0x0a1036 / 0x18224e /
  // 0x2e3c70 / 0x3a4a80): with the Milky Way kept off the ground skies the
  // falls' frame went to 69% very dark on SwiftShader; with this, 61.
  skyTop: 0x101848, skyMid: 0x222e64, skyHorizon: 0x38487e, skyGlow: 0x44558c,
  // Tune pass: a lighter haze (0x202a50), so the far layers step up toward
  // the sky (bible 1.3, 2.6): at Video Ads II the far range was the darkest
  // mass, under the near wall; at the opening the near forest was one black
  // band (treeline 27 -> 30).
  haze: 0x2e3866,
  // A little less fill and moonlight than the island's night (2.2, 0.9, 1.6):
  // seen from the ground the meadows read as day lit grass under it.
  // Tune pass: the fill a third less saturated and a fifth weaker (hemi
  // 0x5a6ca8 at 1.9, ambient 0x56649a at 0.75). At full blue the fill did the
  // work value should do: the shade planes of the falls' cliff went saturated
  // blue beside grey violet lit planes, the signpost's arms pastel blue.
  hemiSky: 0x727ba8, hemiGround: 0x1a1e30, hemiIntensity: 1.55,
  ambient: 0x6c749a, ambientIntensity: 0.65, exposure: 1.35, stars: 1,
  cloudTop: 0x7280b0, cloudBase: 0x262e50, water: 0x141a30,
  lampGlow: 1.1, magicGlow: 0.95,
} satisfies Partial<LightKeyframe>;

/** The night's look: LOOKS.night's grade and halo; the ramp's distances stay the day's. */
export const NIGHT_LOOK = {
  nearShade: 0x0e1226, sunLobe: 0,
  // sat 0.8 (the island's 0.9): moonlight takes the colour out of the ground.
  lift: [0, 0.005, 0.03], gain: [0.98, 1.0, 1.05], gamma: 0.95, sat: 0.8,
  // A cool halo: LOOKS.night's violet one (0x7a5c84) turned every horizon from the ground mauve.
  halo: 0x3a4c86, haloAmt: 0.4, haloDeg: 0, haloHalf: 7, haloFog: 1, fogAdd: 0.15,
} satisfies Partial<LookKey>;

/**
 * One row per light key the opening and the first six places use (the keys
 * between them included). The views (layout.ts KEYS, compass bearing, how far
 * the camera looks up, vertical lens): the opening 328 / 9 / 34, a1 333.5 /
 * 9.5 / 38, a2 359 / 18 / 42, a3 128 / 13 / 58, a4 232.6 / 8 / 48, a5 297 /
 * -9 / 31 (it looks down: its sky is in the lake), a6 281 / 12. The keys
 * between places ("sunset-cliff" for the gully and the burst) take the
 * stretch's own.
 */
export const NIGHT_ROWS: Partial<Record<LightWaypointKey, NightRow>> = {
  "opening-gold": { dial: 1, moonAz: 344, moonEl: 19 },
  // Tune pass: at 350 / 21 the disc stood right over a1's place card and was
  // the brightest thing on screen; at 345 / 22 it hangs left of the card's
  // column, and from the opening (344 / 19) it stays put in the sky as the
  // camera turns.
  "afternoon-gold": { dial: 1, moonAz: 345, moonEl: 22 },
  // Tune pass: at Base Camp the moonlight came from the day sun's side (245,
  // behind the camera's left), so the meadow facing the camera was one flat
  // lit pad, lighter than the sky (50 against 34 with the page's scrim). From
  // due west and low (270 / 14) it rakes across: the near meadow 41, the crest
  // the tower stands on 54, the tower's west faces still lit. Further round
  // (280 to 300) the meadow went darker still but the stop's readable gate
  // (65% very dark) came within a point.
  afternoon: { dial: 1, moonAz: 340, moonEl: 31, moonLightAz: 270, moonLightEl: 14 },
  "late-afternoon": { dial: 1, moonAz: 104, moonEl: 30 },
  // Tune pass: at Video Ads II the near wall stood lighter than the range
  // behind it (47 against 32), the bible's layer ladder upside down. The
  // moonlight from the south (170 / 18) leaves the near wall in shade (25)
  // and lights the far gorge wall behind the hut; the haze's lift (fogAdd)
  // brings the range up to 46, so the falls stand bright on a dark wall.
  "gorge-sunset": { dial: 1, moonAz: 214, moonEl: 20, moonLightAz: 170, moonLightEl: 18, look: { fogAdd: 0.3 } },
  "sunset-cliff": { dial: 1, moonAz: 300, moonEl: 20 },
  // The lake keeps the Milky Way: it lies in the water, most of the lake's
  // light at night (78.7% of the frame very dark without it, 69 with), and
  // costs 0.04 to 0.1 ms there (it looks down; little sky to run on).
  // Tune pass: the view's bearing is 297, so at 296 the moon's reflection
  // sat behind the island's as a grey crescent; at 278 a whole disc lies in
  // open water left of it, clear of the black firs (282 and 284 put it
  // behind the fir, 288 behind the island).
  sunset: { dial: 1, moonAz: 278, moonEl: 13, light: { band: 1 } },
  // The forest's dusk already shows the moon (MOON_AZ / MOON_EL) and lights by
  // it (MOONLIGHT_AZ / _EL): the night keeps both where they are.
  dusk: { dial: 1, moonAz: MOON_AZ, moonEl: MOON_EL, moonLightAz: MOONLIGHT_AZ, moonLightEl: MOONLIGHT_EL, light: { aurora: 1, band: 1 } },
};

/** A day key's night (NIGHT_ROWS' header). */
export function nightKeyframe(day: LightKeyframe, row: NightRow): LightKeyframe {
  return {
    ...day,
    ...NIGHT_BASE,
    sunAz: day.sunAz,
    sunEl: NIGHT_SUN_EL,
    moonAz: row.moonAz,
    moonEl: row.moonEl,
    moonLightAz: row.moonLightAz ?? day.sunAz,
    moonLightEl: row.moonLightEl ?? Math.max(NIGHT_MOONLIGHT_MIN, day.sunEl + NIGHT_MOONLIGHT_LIFT),
    // No aurora and no Milky Way where the day had none: the forest's row asks
    // for both (and the island has its own key). Seen from the ground the Milky
    // Way was a faint violet wash whose noise cost 0.45 to 0.7 ms at a1, a2
    // and a4 (2 runs, 2026-10-20 night); the stars stay.
    aurora: day.aurora ?? day.stars,
    band: day.band ?? day.stars,
    ...row.light,
    night: 1,
  };
}

/** A day look's night: NIGHT_LOOK over it, the ramp's distances and the haze's shape kept. */
export function nightLook(day: LookKey, row: NightRow): LookKey {
  return {
    ...day,
    ...NIGHT_LOOK,
    rampStart: day.rampStart,
    rampEnd: day.rampEnd,
    hazeBase: day.hazeBase,
    hazeFall: day.hazeFall,
    hazeOn: day.hazeOn,
    fogCap: day.fogCap,
    ...row.look,
  };
}

// ── Tuning: the morning layer (2026-10-21; option B's morning over option D) ──

/**
 * The morning on the student's clock (clock.ts MORNING_HOURS: full from 06:00
 * to 09:00, the night going out onto it from 05:00, fading into the day by
 * 10:00). As with the night, the light still follows the PLACE: each key from
 * the opening to the Glowing Forest has a morning of its own (morningKeyframe,
 * morningLook, MORNING_ROWS) and blends toward it by the morning factor times
 * its dial. From Creative Strategy on nothing changes: the island keeps its
 * night and the arch its sunrise, as after dark.
 *
 * A morning key is its day key with:
 *   - the place's own sun, where it stands by day (every view was lit for
 *     it), paler and a touch weaker (MORNING_LIGHT), under a cooler fill and
 *     a grade that lifts the shade toward lavender (MORNING_LOOK's lift and
 *     near shade), so the shadows are softer and lighter;
 *   - a clear sky: a cool blue top, a pale mid, a pink and peach band on the
 *     horizon, pale gold toward the sun; no stars, no moon, no aurora and no
 *     Milky Way;
 *   - a pale lilac haze, and a cool white mist lying low in the valleys
 *     (MORNING_LOOK's mist: from the key's hazeBase up, coming in with
 *     distance, so the foreground stays crisp);
 *   - the lamps out: lampGlow low, and the lamp materials turned toward unlit
 *     glass by state.morning (MORNING_LAMP_TINT); the halos off (dress-shore,
 *     dress-lakeforest); the forest's glow softer;
 *   - lighter water, and a grade that keeps the colour (the day's saturation
 *     and a little more, warm highlights over the cool lifted shade, a
 *     dew-bright green: never a faded sunset);
 *   - the day's fog ramp distances and haze shape (the ramp's end is the
 *     camera's far plane, so the morning draws what the day draws).
 * By day (factor 0) every key is its authored one, value for value, and with
 * the morning at 0 the night is what it was, value for value
 * (client-tests/night-clock.test.mjs and morning-clock.test.mjs).
 */
export interface MorningRow {
  /** How far toward its morning this key goes at a morning factor of 1. */
  dial: number;
  /** Row overrides on the morning keyframe and look. */
  light?: Partial<LightKeyframe>;
  look?: Partial<LookKey>;
}

/** The morning's light against the day key's: the sun's intensity and the hemisphere fill times these, the ambient plus, the exposure and the grade's saturation times. */
export const MORNING_LIGHT = { sun: 0.95, fill: 1.0, ambient: 0.03, exposure: 1.06, sat: 1.15 } as const;

/** The morning every row starts from (display sRGB hex). */
export const MORNING_BASE = {
  sunColor: 0xffd49c, sunGlow: 0xffdcb4, sunHero: 0,
  moonColor: 0xc8d4ff, moonIntensity: 0, moonVis: 0,
  rimColor: 0xffe8d8, rimIntensity: 0,
  skyTop: 0x5a94dc, skyMid: 0xc8cfee, skyHorizon: 0xf4cfc8, skyGlow: 0xffe0b8,
  haze: 0xd6d0e6,
  hemiSky: 0xb0c0e8, hemiGround: 0x4e5c48,
  ambient: 0xa2a8cc,
  stars: 0, aurora: 0, band: 0,
  cloudTop: 0xffefe6, cloudBase: 0xc4bed8, water: 0x6a88a8,
  lampGlow: 0.12, magicGlow: 0.15,
} satisfies Partial<LightKeyframe>;

/** The morning's look: warm highlights over a cool, lifted shade (the day's saturation times MORNING_LIGHT.sat), a pink halo, the mist. The ramp's distances and the haze's shape stay the day's. */
export const MORNING_LOOK = {
  nearShade: 0x5a6088, sunLobe: 0.3,
  lift: [0.02, 0.03, 0.07], gain: [1.02, 1.0, 0.98], gamma: 0.97,
  halo: 0xf8cfc4, haloAmt: 0.6, haloDeg: 1.2, haloHalf: 5, haloFog: 0,
  mist: 0.4, mistDepth: 60, mistNear: 300, mistFar: 1200, mistColor: 0xe8e8f4,
} satisfies Partial<LookKey>;

/** One row per light key the opening and the first six places use (the keys between them included), as NIGHT_ROWS. */
export const MORNING_ROWS: Partial<Record<LightWaypointKey, MorningRow>> = {
  // The opening (tune pass): the base's mist lay on the tree band across the
  // water (900 to 1100 units out) as a milky lilac veil, and the frame had no
  // dark anchor. A thinner mist: the band 80 luma (it was 89, 67 by day). The
  // near shade halfway back toward the day's dark one; on the 07:30 frame it
  // measures as no change (the ramp starts at 800 units here).
  "opening-gold": { dial: 1, look: { mist: 0.15, nearShade: 0x404a6c } },
  // The Landing (tune pass): the mid forest went grey and the massif's lower
  // slopes pale. A thinner mist, and less of the day's additive fog (0.3, set
  // for a gold haze, it added pale lilac on the massif under the morning's):
  // the massif's lower slopes 176 luma (186), the mid forest 145 (155).
  "afternoon-gold": { dial: 1, look: { mist: 0.15, fogAdd: 0.2 } },
  afternoon: { dial: 1 },
  // The Falls (tune pass): the cliff in shade right of the falls read as a
  // moonlit navy (the base's mossy bounce is half the fill on a vertical face,
  // then the blue lift). A warm bounce as by day (the meadows face up and keep
  // the sky's half, so the dew greens stay), less blue in the lift and the
  // gain, and half the day's additive fog, which veiled the lit cliff in mauve.
  // The shade's core now a dark violet (hue 268, sat 0.30, luma 38; it was
  // 238 / 0.39 / 43); a lift of 0.045 blue left it indigo (258 / 0.34).
  "late-afternoon": { dial: 1, light: { hemiGround: 0x5c4c40 }, look: { lift: [0.025, 0.02, 0.035], gain: [1.04, 1.0, 0.95], fogAdd: 0.2 } },
  // The gorge: a warmer sun and a pink haze, so the far range keeps the
  // morning's first light (with the base's lilac haze it went grey).
  // Tune pass: the far range was still a grey-white sheet (170 luma, sat
  // 0.08), under the day's additive fog of 0.5 (set for a coral haze); half
  // of it, a haze a step darker in the same rose, and the warm bounce, so the
  // right wall's shade turns mauve brown: the range 143 luma. The blue sky and
  // white clouds stay: they are what make this view a morning.
  "gorge-sunset": { dial: 1, light: { sunColor: 0xffcf96, skyHorizon: 0xf6cac4, haze: 0xd6b8c2, hemiGround: 0x5c4c40 }, look: { fogAdd: 0.25 } },
  "sunset-cliff": { dial: 1 },
  // The lake: its low sun kept, cooler; a pink horizon over the water; the
  // mist a thin pink white layer on the water (the day's additive haze, 0.55,
  // greyed the far shore out under the morning's pale haze).
  // Tune pass: the Mirror Lake had lost its mirror (a pale lilac sheet, 157
  // luma at sat 0.08, under a white band on the far shore). The mist only
  // from 400 units out and thinner, a thin band over the far shore and a
  // clear mirror nearer; the lake's own colour darker in the same blue (the
  // base's is 132 luma, the day's 57); and a rose violet haze (keep it
  // between hue 320 and 340: toward coral it is the day's sunset again). The
  // lake 135 luma with the forest and the hill clear in it, the far shore's
  // band 140 (164).
  sunset: {
    dial: 1,
    light: { skyMid: 0xd0c8ec, skyHorizon: 0xf6c8c0, skyGlow: 0xffd8b0, haze: 0xd6bccb, water: 0x4c6684 },
    look: { fogAdd: 0.15, mist: 0.16, mistDepth: 10, mistNear: 400, mistFar: 1100, mistColor: 0xf2e4ea },
  },
  // The forest: its dusk keeps the sun under the horizon and the floor dark
  // (FOREST_DIM), so its morning is the dawn's pink and blue over the trees,
  // the glow softer (still the brightest thing on the floor), and the mist
  // further out (nearer, it hid the trees past the clearing in white).
  dusk: {
    dial: 1,
    light: { magicGlow: 0.55, skyTop: 0x7a92d6, skyMid: 0xc8c2ea, skyHorizon: 0xf6c6c4, skyGlow: 0xffd2b4, haze: 0xcec4de },
    look: { mist: 0.45, mistNear: 600, mistFar: 2000 },
  },
};

/**
 * The morning's dew, in the grade (display space, after the saturation): a
 * pixel whose green leads its red and blue is multiplied toward `mul`, `k` of
 * the way at morning 1, so meadows and conifers come out fresher and a touch
 * brighter, where the warm golds and the pink sky are left alone. 0 by day.
 */
export const MORNING_DEW = { k: 1, mul: [0.94, 1.1, 1.02] } as const;

/**
 * What a lamp material's colour is multiplied by at morning 1 (linear): the
 * windows, the lanterns' glass and the fire read as unlit glass and metal in
 * the morning light, cool and dark, where by day a lamp at the day's level
 * reads as warm paint. Off by day (1, 1, 1).
 */
export const MORNING_LAMP_TINT: readonly [number, number, number] = [0.42, 0.56, 0.9];
const _morningLampTint = new THREE.Color(...MORNING_LAMP_TINT);

/** A day key's morning (MORNING_ROWS' header). */
export function morningKeyframe(day: LightKeyframe, row: MorningRow): LightKeyframe {
  return {
    ...day,
    ...MORNING_BASE,
    sunAz: day.sunAz,
    sunEl: day.sunEl,
    sunIntensity: day.sunIntensity * MORNING_LIGHT.sun,
    // No moon in the morning: the disc and its light stay where the day has them, at 0.
    moonAz: day.moonAz,
    moonEl: day.moonEl,
    moonLightAz: day.moonLightAz,
    moonLightEl: day.moonLightEl,
    hemiIntensity: day.hemiIntensity * MORNING_LIGHT.fill,
    ambientIntensity: day.ambientIntensity + MORNING_LIGHT.ambient,
    exposure: day.exposure * MORNING_LIGHT.exposure,
    ...row.light,
    night: 0,
    morning: 1,
  };
}

/** A day look's morning: MORNING_LOOK over it, the ramp's distances and the haze's shape kept. */
export function morningLook(day: LookKey, row: MorningRow): LookKey {
  return {
    ...day,
    ...MORNING_LOOK,
    sat: day.sat * MORNING_LIGHT.sat,
    rampStart: day.rampStart,
    rampEnd: day.rampEnd,
    hazeBase: day.hazeBase,
    hazeFall: day.hazeFall,
    hazeOn: day.hazeOn,
    fogCap: day.fogCap,
    ...row.look,
  };
}

// The cave behind the falls had a light of its own here (a key that took over
// the fill, the haze, the fog and the exposure inside it and put the sun out,
// blended in by the route's "cave" keys). It went with the cave on 2026-10-13
// (layout.ts "The cave that was here"); commit 0d18ea7 has it.

// ── Tuning: sky, stars, clouds, lake ────────────────────────────────────────

/** Elevation (degrees) where the mid band is fully in, and where the top starts and ends. */
const SKY_SHAPE = { midFrom: 1.2, midTo: 7, topFrom: 5, topTo: 30 };
const SUN_RADIUS_DEG = 1.35;
/** v6: a big moon, about 5 degrees across (bible 1.17). */
const MOON_RADIUS_DEG = 2.5;
/**
 * The moon disc's look, the island's (day) and the night layer's (night),
 * blended by state.night, so the island, the flight and every day key draw
 * the disc they always drew. The night layer's (the critique of 2026-10-20
 * night: a soft edged disc like an upscaled photo, the first thing the eye
 * hit at the opening): a crisp limb (a clear hero shape, bible 1.17), flat
 * painted seas, a warm ivory in the ink family (the cool white read as a
 * lamp), and a quieter tight glow so the halo stops smearing the limb.
 *   edge   the limb's smoothstep, in radii
 *   seas   the grey patches' smoothstep over the noise
 *   halo   the glow's wide, mid and tight terms (SKY_GLSL)
 */
const MOON_LOOK = {
  day: { edge: [0.85, 1.04], seas: [0.42, 0.68], disc: 0xeef0f6 },
  night: { edge: [0.97, 1.01], seas: [0.52, 0.58], disc: 0xe8e0d0 },
} as const;
const MOON_HALO = { day: [0.1, 0.3, 0.5], night: [0.1, 0.3, 0.2] } as const;
const _moonHalo = new THREE.Vector3();
/** The sun light never comes from below this elevation (a light from under the horizon lights the undersides). */
const SUN_LIGHT_MIN_EL = 3;
/** update() re-walks the scene's materials at least every this many frames. */
const WALK_EVERY = 30;

const STAR_COUNT = 4200;
/** The brightest stars, drawn as soft crosses (bible 1.17). */
const STAR_CROSSES = 60;
const STAR_SEED = 7;
/** Share of the stars packed into a band across the northern sky (the star look's peak, bearing 0, 44 up, sits on it). */
const STAR_BAND_SHARE = 0.45;
/** The band's great circle passes through these two directions (azimuth, elevation). */
// Pass 3: through the star look's opening frames (key 56 looks at bearing 244, 19 up; key 57 at 329, 26 up) and over the a7 dome.
// v6: a diagonal across the a7 frame (bearing 293, el -1 to 37): low on the left, high on the right.
const STAR_BAND_THROUGH: readonly [readonly [number, number], readonly [number, number]] = [[262, 2], [318, 44]];
/** Angular half-width of the band (radians) and the faint glow it leaves in the sky (linear). */
const STAR_BAND_WIDTH = 0.1;
const STAR_BAND_GLOW = 0.34; // v6: the coloured Milky Way (pass 3 had 0.11 in blue-white)

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
/** Tier 3's "frozen" reflection: while the camera moves, re-render it at most this often (ms). */
const FROZEN_REFRESH_MS = 400;

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
/** Fix round 3: the sky and the island alone (REFLECT_CORE_NAMES), for the
 *  reflection's "skyIsland" mode at quality tier 2 (quality.ts). */
export const REFLECT_CORE_LAYER = 5;

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
  /** v6: the quality tier at install (WorldCtx.quality); later changes come through setQuality. */
  quality?: { reflection: { scale: number; maxWidth: number } };
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
  sunHero: number;
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
  /** The aurora's level here, 0..1 (nightsky.ts): the star level by day, the forest and the island's only at night. */
  aurora: number;
  /** The Milky Way's level here, 0..1: the star level by day, the forest and the island's only at night. */
  band: number;
  /**
   * How much of the night layer is in this light, 0..1: the night factor
   * (setNight) times the place's dial. 0 by day everywhere, and always 0 from
   * Creative Strategy on. What a module darkens for the night (the smoke,
   * the mist, the gulls, the beach) it darkens by this, so by day and at the
   * island and the arch nothing it draws changes.
   */
  night: number;
  /**
   * How much of the morning layer is in this light, 0..1: the morning factor
   * times the place's dial, less what the night covers. 0 by day and at night
   * everywhere, and always 0 from Creative Strategy on. What a module changes
   * for the morning (the lamps' halos, the lamp glass) it changes by this.
   */
  morning: number;
  /** The morning's mist (LookKey.mist..mistColor): its strength, depth over hazeBase, near and far distances, and colour (linear). */
  mist: number;
  mistDepth: number;
  mistNear: number;
  mistFar: number;
  mistColor: THREE.Color;
  /** The moon disc's radius here, degrees (LightKeyframe.moonRadius). */
  moonRadius: number;
  /** Counts every time the module applies a new light (a scroll or a night change), for modules that cache what they read from it. */
  rev: number;
  /** How far underground the light is. Always 0 since the cave went (2026-10-13): no place is
   *  underground. clouds.ts, nightsky.ts and life.ts still multiply by 1 - under; it goes with their reads. */
  under: number;
  /** v5 look (LOOKS). fogNear / fogFar above are the ramp's start and end. */
  nearShade: THREE.Color;
  halo: THREE.Color;
  hazeBase: number;
  hazeFall: number;
  hazeOn: number;
  sunLobe: number;
  fogCap: number;
  liftR: number;
  liftG: number;
  liftB: number;
  gainR: number;
  gainG: number;
  gainB: number;
  gamma: number;
  sat: number;
  haloAmt: number;
  haloDeg: number;
  haloHalf: number;
  haloFog: number;
  fogAdd: number;
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
  /** v6: the quality tier changed: the lake's reflection size (bible 3.2). */
  setQuality?(tier: { reflection: { scale: number; maxWidth: number; mode?: "full" | "skyIsland" | "frozen" } }): void;
  /** C1: once every module is in, tag what the lake may reflect (REFLECT_NAMES). */
  afterAll?(): void;
  /**
   * The student's clock (clock.ts ClockLook): the night factor, 0 day .. 1
   * night, and the morning factor under it, 0 .. 1. With easeMs both ease in
   * together over that long (the scene passes 0 while it sleeps, so the one
   * frame it wakes shows the new light). The light is re-applied on the next
   * update.
   */
  setClock(night: number, morning: number, easeMs?: number): void;
  /** The night factor being shown (mid ease: between the old and the new). */
  readonly nightFactor: number;
  /** The morning factor being shown (mid ease: between the old and the new). */
  readonly morningFactor: number;
}

/**
 * C1 (bible decision 29, 3.1): the only things the Mirror Lake reflects. The
 * sky, the island with its underside, steps, cloud ring and falls (the locked
 * reveal), the far shore (surfaces' coarse Terrain:mirror, already on
 * REFLECT_ONLY_LAYER), the boathouse and its lamps, the Great Tree, and the
 * mid forest cards so the far shore keeps its treeline, plus every light (so
 * the pass compiles no new programs). Everything else stays out of the
 * reflection pass: it was 45 calls at a5 (cap 16); with the far cards and the
 * floating steps it was 84k triangles (cap 80k), so those two stay out.
 * Matched by object name after every module installed; stats() lists misses.
 */
export const REFLECT_NAMES: readonly string[] = [
  "LightSky", "LightStars", "LightClouds", "CloudBillboards", "NightSky",
  "Sky_Land", "Observatory_Art", "Sky_Clouds", "IslandFalls", "Rocks:sky",
  "Boathouse", "LakeHalos", "GreatTree", "ForestMid",
];
/** Fix round 3: what the "skyIsland" reflection keeps (quality tier 2): the
 *  sky and the island with its underside, clouds and falls (the locked reveal).
 *  Final pass C: plus the coarse far shore (Terrain:mirror, 1 call), or the
 *  lake at tier 2 mirrored bright sky right up to the dark shoreline. */
export const REFLECT_CORE_NAMES: readonly string[] = [
  "LightSky", "LightStars", "LightClouds", "CloudBillboards", "NightSky",
  "Sky_Land", "Observatory_Art", "Sky_Clouds", "IslandFalls", "Rocks:sky",
  "Terrain:mirror",
];

// ── Keyframes in linear space ────────────────────────────────────────────────

const COLOR_FIELDS = [
  "sunColor", "sunGlow", "moonColor", "rimColor", "skyTop", "skyMid", "skyHorizon", "skyGlow",
  "haze", "hemiSky", "hemiGround", "ambient", "cloudTop", "cloudBase", "water",
] as const;
const NUMBER_FIELDS = [
  "sunHero", "sunIntensity", "moonIntensity", "moonVis", "rimIntensity",
  "hemiIntensity", "ambientIntensity", "exposure", "stars", "lampGlow", "magicGlow",
  "aurora", "band", "night", "moonRadius", "morning",
] as const;
type ColorField = (typeof COLOR_FIELDS)[number];
const LOOK_COLORS = ["nearShade", "halo", "mistColor"] as const;
const LOOK_NUMBERS = [
  "fogNear", "fogFar", "hazeBase", "hazeFall", "hazeOn", "sunLobe", "fogCap",
  "liftR", "liftG", "liftB", "gainR", "gainG", "gainB", "gamma", "sat", "haloAmt", "haloDeg", "haloHalf", "haloFog", "fogAdd",
  "mist", "mistDepth", "mistNear", "mistFar",
] as const;
export interface LinearLook {
  colors: Record<(typeof LOOK_COLORS)[number], THREE.Color>;
  numbers: Record<(typeof LOOK_NUMBERS)[number], number>;
}

/** A LookKey in linear space, flattened to LightState's field names. */
function linearLook(k: LookKey, skyHorizon: number | null): LinearLook {
  const halo = new THREE.Color();
  if (k.halo !== null) halo.setHex(k.halo);
  else halo.setHex(skyHorizon ?? 0xffffff).lerp(new THREE.Color(1, 1, 1), 0.25);
  return {
    // No mist (mist 0, a key without one): its colour is white, its shape a harmless 1.
    colors: { nearShade: new THREE.Color().setHex(k.nearShade), halo, mistColor: new THREE.Color().setHex(k.mistColor ?? 0xffffff) },
    numbers: {
      fogNear: k.rampStart, fogFar: k.rampEnd, hazeBase: k.hazeBase, hazeFall: k.hazeFall, hazeOn: k.hazeOn,
      sunLobe: k.sunLobe, fogCap: k.fogCap, liftR: k.lift[0], liftG: k.lift[1], liftB: k.lift[2],
      gainR: k.gain[0], gainG: k.gain[1], gainB: k.gain[2], gamma: k.gamma, sat: k.sat,
      haloAmt: k.haloAmt, haloDeg: k.haloDeg, haloHalf: k.haloHalf, haloFog: k.haloFog ?? 0, fogAdd: k.fogAdd ?? 0,
      mist: k.mist ?? 0, mistDepth: k.mistDepth ?? 1, mistNear: k.mistNear ?? 0, mistFar: k.mistFar ?? 1,
    },
  };
}

export interface LinearKey {
  colors: Record<ColorField, THREE.Color>;
  numbers: Record<(typeof NUMBER_FIELDS)[number], number>;
  look: LinearLook;
  sunAz: number;
  sunEl: number;
  moonAz: number;
  moonEl: number;
  moonLightAz: number;
  moonLightEl: number;
}

function linearKey(k: LightKeyframe, look: LookKey): LinearKey {
  const colors = {} as Record<ColorField, THREE.Color>;
  // Color.setHex reads sRGB and stores linear (ColorManagement is on).
  for (const f of COLOR_FIELDS) colors[f] = new THREE.Color().setHex(k[f]);
  const numbers = {} as LinearKey["numbers"];
  for (const f of NUMBER_FIELDS) numbers[f] = k[f] ?? 0;
  numbers.aurora = k.aurora ?? k.stars;
  numbers.band = k.band ?? k.stars;
  numbers.moonRadius = k.moonRadius ?? MOON_RADIUS_DEG;
  return {
    colors, numbers, look: linearLook(look, k.skyHorizon), sunAz: k.sunAz, sunEl: k.sunEl, moonAz: k.moonAz, moonEl: k.moonEl,
    moonLightAz: k.moonLightAz, moonLightEl: k.moonLightEl,
  };
}

/** a blended toward b by k, in linear space (angles on the shortest arc). */
function mixLinearKey(a: LinearKey, b: LinearKey, k: number): LinearKey {
  const colors = {} as Record<ColorField, THREE.Color>;
  for (const f of COLOR_FIELDS) colors[f] = a.colors[f].clone().lerp(b.colors[f], k);
  const numbers = {} as LinearKey["numbers"];
  for (const f of NUMBER_FIELDS) numbers[f] = a.numbers[f] + (b.numbers[f] - a.numbers[f]) * k;
  const lc = {} as LinearLook["colors"];
  for (const f of LOOK_COLORS) lc[f] = a.look.colors[f].clone().lerp(b.look.colors[f], k);
  const ln = {} as LinearLook["numbers"];
  for (const f of LOOK_NUMBERS) ln[f] = a.look.numbers[f] + (b.look.numbers[f] - a.look.numbers[f]) * k;
  const m = (x: number, y: number) => x + (y - x) * k;
  return {
    colors, numbers, look: { colors: lc, numbers: ln },
    sunAz: lerpAz(a.sunAz, b.sunAz, k), sunEl: m(a.sunEl, b.sunEl), moonAz: lerpAz(a.moonAz, b.moonAz, k), moonEl: m(a.moonEl, b.moonEl),
    moonLightAz: lerpAz(a.moonLightAz, b.moonLightAz, k), moonLightEl: m(a.moonLightEl, b.moonLightEl),
  };
}

/** mixLinearKey written into `out` (a key of the same shape), so a repeated blend allocates nothing. */
function mixLinearKeyInto(out: LinearKey, a: LinearKey, b: LinearKey, k: number): LinearKey {
  for (const f of COLOR_FIELDS) out.colors[f].copy(a.colors[f]).lerp(b.colors[f], k);
  for (const f of NUMBER_FIELDS) out.numbers[f] = a.numbers[f] + (b.numbers[f] - a.numbers[f]) * k;
  for (const f of LOOK_COLORS) out.look.colors[f].copy(a.look.colors[f]).lerp(b.look.colors[f], k);
  for (const f of LOOK_NUMBERS) out.look.numbers[f] = a.look.numbers[f] + (b.look.numbers[f] - a.look.numbers[f]) * k;
  out.sunAz = lerpAz(a.sunAz, b.sunAz, k);
  out.sunEl = a.sunEl + (b.sunEl - a.sunEl) * k;
  out.moonAz = lerpAz(a.moonAz, b.moonAz, k);
  out.moonEl = a.moonEl + (b.moonEl - a.moonEl) * k;
  out.moonLightAz = lerpAz(a.moonLightAz, b.moonLightAz, k);
  out.moonLightEl = a.moonLightEl + (b.moonLightEl - a.moonLightEl) * k;
  return out;
}

function newState(): LightState {
  const c = () => new THREE.Color();
  return {
    u: 0, stop: 0, blend: 0,
    sunDir: new THREE.Vector3(0, 1, 0), moonDir: new THREE.Vector3(0, 1, 0), moonLightDir: new THREE.Vector3(0, 1, 0), sunEl: 0,
    sunColor: c(), sunHero: 0, sunIntensity: 0, sunGlow: c(), moonColor: c(), moonIntensity: 0, moonVis: 0,
    rimColor: c(), rimIntensity: 0, skyTop: c(), skyMid: c(), skyHorizon: c(), skyGlow: c(),
    haze: c(), fogNear: 0, fogFar: 0, hemiSky: c(), hemiGround: c(), hemiIntensity: 0,
    ambient: c(), ambientIntensity: 0, exposure: 1, stars: 0, cloudTop: c(), cloudBase: c(), water: c(),
    lampGlow: 1, magicGlow: 1, aurora: 0, band: 0, night: 0, moonRadius: MOON_RADIUS_DEG, rev: 0, under: 0,
    morning: 0, mist: 0, mistDepth: 1, mistNear: 0, mistFar: 1, mistColor: new THREE.Color(1, 1, 1),
    nearShade: c(), halo: c(), hazeBase: 0, hazeFall: 1, hazeOn: 0, sunLobe: 0, fogCap: 0.92,
    liftR: 0, liftG: 0, liftB: 0, gainR: 1, gainG: 1, gainB: 1, gamma: 1, sat: 1, haloAmt: 0, haloDeg: 0, haloHalf: 1, haloFog: 0, fogAdd: 0,
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
  /** The key the light blends: `day` at a night and a morning factor of 0, toward `morning` and `night` above them (setTrackClock). */
  key: LinearKey;
  hold: boolean;
  /** For a pass-through stop: d(blend)/d(railU), the same on both sides. */
  rate: number;
  /** The authored key, and its night (NIGHT_ROWS; the authored key itself where the light has no row). */
  day: LinearKey;
  night: LinearKey;
  /**
   * The day side of the night's blend: `day`, with the moon's disc and its
   * light where the night puts them when the day key shows neither (its moon
   * is drawn at 0 and lights at 0, so the picture is the day's). Without it
   * the hidden day moon (azimuth 120 at the opening) was blended in and the
   * disc came out of the frame at a dial under 1.
   */
  from: LinearKey;
  /** The night row's dial (0 without a row: the key never goes to night). */
  dial: number;
  /** The key's morning (MORNING_ROWS; the authored key itself where the light has no row). */
  morning: LinearKey;
  /** The morning side of the night's blend at the dawn: `morning` with the moon's disc and light where the night puts them, as `from` is the day's. */
  dawn: LinearKey;
  /** The morning row's dial (0 without a row: the key never goes to morning). */
  mDial: number;
  /** The light rows the stop was built from, so the night and the morning can be rebuilt from changed rows (harness). */
  src: { light: string; mix?: { to: string; k: number } };
}

/** railU of a (fractional) TRAIL key, between the stops it falls between. */
function keyToU(key: number, placeU: readonly number[]): number {
  // Fix round 1: a key before the first place (the opening) sits on the
  // stretch from the rail's start (u 0, key 0) to the first place.
  if (key >= 0 && key < PLACES[0].trail) return (placeU[0] * key) / Math.max(1e-9, PLACES[0].trail);
  for (let i = 0; i < PLACES.length - 1; i++) {
    const a = PLACES[i].trail;
    const b = PLACES[i + 1].trail;
    if (key >= a && key <= b) return placeU[i] + ((key - a) / Math.max(1e-9, b - a)) * (placeU[i + 1] - placeU[i]);
  }
  return NaN;
}

/**
 * A key's row by name, whatever table holds it. An unknown name (a place set
 * to a key light.ts has no row for) falls back to "afternoon" with a warning
 * instead of crashing the whole world at load.
 */
function keyframeOf(name: string): LightKeyframe {
  const kf = (LIGHTS as Record<string, LightKeyframe>)[name] ?? (LIGHTS_BETWEEN as Record<string, LightKeyframe>)[name];
  if (kf) return kf;
  console.warn(`[world-v6 light] no light row "${name}"; using "afternoon"`);
  return LIGHTS.afternoon;
}
function lookOf(name: string): LookKey {
  return (LOOKS as Record<string, LookKey>)[name] ?? LOOKS.afternoon;
}

/**
 * The light's track: the eight places (holds) and the waypoints between them,
 * in railU order. A waypoint that falls on a place or outside the route is
 * left out.
 */
/** A light row's day key, its night key and dial (NIGHT_ROWS), and its morning key and dial (MORNING_ROWS). */
function keysOf(name: string): { day: LinearKey; night: LinearKey; dial: number; morning: LinearKey; mDial: number } {
  const kf = keyframeOf(name);
  const lk = lookOf(name);
  const day = linearKey(kf, lk);
  const row = (NIGHT_ROWS as Record<string, NightRow | undefined>)[name];
  const mrow = (MORNING_ROWS as Record<string, MorningRow | undefined>)[name];
  const morning = mrow ? linearKey(morningKeyframe(kf, mrow), morningLook(lk, mrow)) : day;
  const mDial = mrow ? Math.min(1, Math.max(0, mrow.dial)) : 0;
  if (!row) return { day, night: day, dial: 0, morning, mDial };
  return { day, night: linearKey(nightKeyframe(kf, row), nightLook(lk, row)), dial: Math.min(1, Math.max(0, row.dial)), morning, mDial };
}

/** `key`, with the moon's disc and its light where `night` puts them where `key` shows neither (LightTrackStop.from). */
function moonAsNight(key: LinearKey, night: LinearKey): LinearKey {
  const hideDisc = key.numbers.moonVis <= 0;
  const hideLight = key.numbers.moonIntensity <= 0;
  if (!hideDisc && !hideLight) return key;
  return {
    ...key,
    ...(hideDisc ? { moonAz: night.moonAz, moonEl: night.moonEl, numbers: { ...key.numbers, moonRadius: night.numbers.moonRadius } } : {}),
    ...(hideLight ? { moonLightAz: night.moonLightAz, moonLightEl: night.moonLightEl } : {}),
  };
}

/** A track stop's keys and dials from its rows (a waypoint's mix blends the two rows' keys and dials). */
function stopKeys(src: LightTrackStop["src"]): Pick<LightTrackStop, "day" | "night" | "from" | "dial" | "morning" | "dawn" | "mDial"> {
  const a = keysOf(src.light);
  const b = src.mix ? keysOf(src.mix.to) : null;
  const k = src.mix ? src.mix.k : 0;
  const day = b ? mixLinearKey(a.day, b.day, k) : a.day;
  const night = b ? mixLinearKey(a.night, b.night, k) : a.night;
  const dial = b ? a.dial + (b.dial - a.dial) * k : a.dial;
  const from = night !== day ? moonAsNight(day, night) : day;
  const morning = b ? mixLinearKey(a.morning, b.morning, k) : a.morning;
  const mDial = b ? a.mDial + (b.mDial - a.mDial) * k : a.mDial;
  const dawn = night !== day && morning !== day ? moonAsNight(morning, night) : morning;
  return { day, night, from, dial, morning, dawn, mDial };
}

export function buildTrack(placeU: readonly number[]): LightTrackStop[] {
  const stop = (u: number, hold: boolean, src: LightTrackStop["src"]): LightTrackStop => {
    const k = stopKeys(src);
    return { u, key: k.day, hold, rate: 0, ...k, src };
  };
  const track: LightTrackStop[] = PLACES.map((p, i) => stop(placeU[i], true, { light: p.light }));
  for (const w of LIGHT_WAYPOINTS) {
    const u = keyToU(w.key, placeU);
    // Fix round 1: a hold before the first place (the opening) is kept too.
    const beforeFirst = w.hold && u >= 0 && u < placeU[0];
    if (!beforeFirst && !(u > placeU[0] && u < placeU[placeU.length - 1])) continue;
    if (track.some((t) => Math.abs(t.u - u) < 1e-7)) continue;
    track.push(stop(u, w.hold, w.mix ? { light: w.light, mix: { to: w.mix.to, k: w.mix.k } } : { light: w.light }));
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

/** Each stop's blended keys, kept between calls so laying the clock allocates nothing: the night's blend, the morning's over the day, the dawn's base. */
const _nightKeys = new WeakMap<LightTrackStop, LinearKey>();
const _morningKeys = new WeakMap<LightTrackStop, LinearKey>();
const _dawnKeys = new WeakMap<LightTrackStop, LinearKey>();
function scratchKey(map: WeakMap<LightTrackStop, LinearKey>, t: LightTrackStop, a: LinearKey, b: LinearKey): LinearKey {
  let out = map.get(t);
  if (!out) {
    out = mixLinearKey(a, b, 0);
    map.set(t, out);
  }
  return out;
}

/** The blend weight the morning layer uses for a morning factor m (0..1): m itself (the morning and the day are both lit, so a straight blend in linear light looks even; the clock's fade is already a smoothstep). */
export function morningWeight(m: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(m) ? m : 0));
}

/**
 * Lays the clock on a track at night factor f and morning factor m (0..1),
 * in place: each stop's key is its day key blended toward its morning by m
 * times its morning dial, then toward its night by nightWeight(f) times its
 * night dial. At m 0 this is the night layer exactly as it was before the
 * morning (the day under the night: the same keys, the same arithmetic), and
 * at f 0 and m 0 every key is its day key (the same object). At the dawn the
 * night goes off the morning (`dawn`, the morning with the night's moon
 * placement, as `from` is the day's). The stops' places, holds and rates never
 * change, so the blend along the route is the day's.
 */
export function setTrackClock(track: readonly LightTrackStop[], f: number, m: number): void {
  const n = nightWeight(f);
  const mw = morningWeight(m);
  for (const t of track) {
    const wn = n * t.dial;
    const wm = mw * t.mDial;
    if (wn >= 1) {
      t.key = t.night;
      continue;
    }
    if (wm <= 0) {
      // The day under the night (the dusk and the night): as before the morning.
      t.key = wn <= 0 ? t.day : mixLinearKeyInto(scratchKey(_nightKeys, t, t.from, t.night), t.from, t.night, wn);
      continue;
    }
    if (wn <= 0) {
      // The morning over the day (06:00 to 10:00).
      t.key = wm >= 1 ? t.morning : mixLinearKeyInto(scratchKey(_morningKeys, t, t.day, t.morning), t.day, t.morning, wm);
      continue;
    }
    // The night over the morning (the dawn, 05:00 to 06:00).
    const base = wm >= 1 ? t.dawn : mixLinearKeyInto(scratchKey(_dawnKeys, t, t.from, t.dawn), t.from, t.dawn, wm);
    t.key = mixLinearKeyInto(scratchKey(_nightKeys, t, t.from, t.night), base, t.night, wn);
  }
}

/** The night layer alone (setTrackClock with no morning): the day under the night. */
export function setTrackNight(track: readonly LightTrackStop[], f: number): void {
  setTrackClock(track, f, 0);
}

/** Rebuilds every stop's night and morning keys and dials from the rows as they are now (the harness tries rows in the page). */
export function rebuildTrackClock(track: readonly LightTrackStop[]): void {
  for (const t of track) {
    const k = stopKeys(t.src);
    t.night = k.night;
    t.from = k.from;
    t.dial = k.dial;
    t.morning = k.morning;
    t.dawn = k.dawn;
    t.mDial = k.mDial;
    _nightKeys.delete(t);
    _morningKeys.delete(t);
    _dawnKeys.delete(t);
  }
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
  for (const f of LOOK_COLORS) out[f].copy(a.look.colors[f]).lerp(b.look.colors[f], k);
  for (const f of LOOK_NUMBERS) out[f] = a.look.numbers[f] + (b.look.numbers[f] - a.look.numbers[f]) * k;
  const sunEl = a.sunEl + (b.sunEl - a.sunEl) * k;
  out.sunEl = sunEl;
  dirFromAngles(lerpAz(a.sunAz, b.sunAz, k), sunEl, out.sunDir);
  dirFromAngles(lerpAz(a.moonAz, b.moonAz, k), a.moonEl + (b.moonEl - a.moonEl) * k, out.moonDir);
  dirFromAngles(lerpAz(a.moonLightAz, b.moonLightAz, k), a.moonLightEl + (b.moonLightEl - a.moonLightEl) * k, out.moonLightDir);
  return applyTail(u, out);
}

// ── The tail: through the arch into the sun (bible 1.20, decision 10) ──────

/** The gold the tail fades to (display sRGB), and where along the tail keys it runs. */
const TAIL_GOLD = 0xffd9a0;
const TAIL_FADE_FROM = 0.45;
let _tailGold: THREE.Color | null = null;
const TAIL_SKY = ["skyTop", "skyMid", "skyHorizon", "skyGlow", "haze", "cloudTop", "cloudBase"] as const;

/**
 * Final pass C (the route fixer's clean-up): where the gold fade would
 * complete, in lengths of the real tail (a8 to the route's last key). Since
 * final pass B the tail stops on the arch framing the sun (decision 55), so
 * the fade never completes on screen: 1.5 puts its end half a tail past the
 * last frame, which gets t 0.34 of it (f = t^2, about 0.12: a first warmth,
 * no gold wash). It used to come from layout's TAIL_KEYS.last, set 2 keys
 * past the end to get this; reading the real last key here keeps the end
 * frame the same whatever TAIL_KEYS.last says.
 */
const TAIL_FADE_END = 1.5;

/** 0..1 through the tail's fade (0 until TAIL_FADE_FROM of the way from a8 to where it would complete). */
export function tailFadeAt(u: number): number {
  const last = TRAIL.length - 1;
  if (TAIL_KEYS.first < 0 || last <= TAIL_KEYS.first) return 0;
  const k = u * last;
  const span = (last - TAIL_KEYS.first) * TAIL_FADE_END;
  return smoothstep(TAIL_KEYS.first + TAIL_FADE_FROM * span, TAIL_KEYS.first + span, k);
}

/**
 * An exposure ramp and a gold fade as the camera flies through the arch into
 * the sun: the sky, the haze (so the fog ramp) and the clouds lerp to gold, the
 * exposure climbs and the grade lifts toward gold. No new render pass.
 */
function applyTail(u: number, out: LightState): LightState {
  const t = tailFadeAt(u);
  if (t <= 0) return out;
  const f = t * t;
  _tailGold ??= new THREE.Color().setHex(TAIL_GOLD);
  for (const c of TAIL_SKY) (out[c] as THREE.Color).lerp(_tailGold, 0.85 * f);
  out.exposure *= 1 + 0.7 * f;
  out.liftR += 0.3 * f;
  out.liftG += 0.22 * f;
  out.liftB += 0.08 * f;
  out.sunLobe += 0.6 * f;
  return out;
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
uniform vec3 uMoonHalo; // the moon glow's three terms: wide, mid, tight (MOON_HALO; the night layer's own tight term is quieter)
uniform vec4 uSkyShape; // midFrom, midTo, topFrom, topTo (degrees)
uniform vec4 uHalo;     // v5 horizon halo: rgb, amount
uniform vec3 uHaloBand; // its centre and half height, degrees above the horizon; how much it holds under the horizon (haloFog)

// Linear sky colour in unit direction d, without the discs.
vec3 lightSky(vec3 d) {
  float deg = degrees(asin(clamp(d.y, -1.0, 1.0)));
  vec2 hz = d.xz;
  float hl = length(hz);
  vec2 sz = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  // Toward the sun by compass bearing: the SAME test as the fog ramp's
  // (FW_FOG_FRAGMENT), so the ramp's far end is the horizon colour in every
  // direction and the farthest ridge melts into the sky above it.
  float toward = smoothstep(-0.2, 0.9, hl > 1e-4 ? dot(hz / hl, sz) : 0.0);
  vec3 c = mix(uHorizon, uGlow, toward);
  c = mix(c, uMid, smoothstep(uSkyShape.x, uSkyShape.y, deg) * (0.55 + 0.45 * (1.0 - toward)));
  c = mix(c, uTop, smoothstep(uSkyShape.z, uSkyShape.w, deg));
  // The halo: a band just over the horizon all the way round, so every ridge
  // line has a lighter sky behind it (a thin orange line at dusk and night).
  // With haloFog the halo holds its horizon value below the horizon, where the fog ramp's far end carries it too.
  float hd = mix(deg, max(deg, 0.0), uHaloBand.z);
  float hb = 1.0 - smoothstep(0.0, uHaloBand.y, abs(hd - uHaloBand.x));
  c = mix(c, uHalo.rgb, uHalo.a * hb * mix(smoothstep(-0.4, 0.1, deg), 1.0, uHaloBand.z));
  float ca = max(dot(d, uSunDir), 0.0);
  c += uSunGlow * (0.22 * pow(ca, 5.0) + 0.55 * pow(ca, 90.0));
  float cm = max(dot(d, uMoonDir), 0.0);
  c += uMoonGlow * (uMoonHalo.x * pow(cm, 8.0) + uMoonHalo.y * pow(cm, 120.0) + uMoonHalo.z * pow(cm, 900.0));
  // Below the horizon it stays the horizon colour (the ramp's far end).
  return c;
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

// ── The fog ramp and the grade (bible 1.4, 1.6) ─────────────────────────────

/**
 * Every fogged material in the world gets the Firewatch fog ramp, and every
 * tone mapped one the grade, with no work from the module that made it:
 *
 *   GLSL   While OUR renderer compiles (render / compile / compileAsync), the
 *          four fog chunks and tonemapping_pars_fragment in THREE.ShaderChunk
 *          are swapped for FW_CHUNKS and swapped back after. Any shader that
 *          includes <fog_pars_vertex> <fog_vertex> <fog_pars_fragment>
 *          <fog_fragment> (built-in materials, and ShaderMaterials with
 *          fog: true that merge UniformsLib.fog) compiles with the ramp. No
 *          other renderer and no other page ever sees the swap.
 *   uniforms  One shared set (FwUniforms), added to every material in the
 *          scene by a walk before the first draw of each frame: straight into
 *          a ShaderMaterial's uniforms, through onBeforeCompile (chained, never
 *          replacing a module's own hook) for built-ins, and re-checked on the
 *          renderer's own uniform table so a recompile can never lose them.
 *
 * Safe by construction: a program whose material somehow lacks the uniforms
 * reads fwOn = 0 and falls back to three's stock linear fog, and reads the
 * grade as zero, which is the identity (plain ACES). Nothing can go black.
 *
 * Contract for other modules: keep the stock fog includes and fog: true, do
 * not replace <fog_fragment> with your own fog, and do not assign
 * onBeforeCompile after install without chaining whatever was there. A
 * shader that must do its own fog can include FW_FOG_GLSL.pars / .fragment
 * and add rampFogUniforms(scene) to its uniforms.
 *
 * Space: three mixes fog after tone mapping and the output transform, so a
 * fully fogged pixel shows the ramp colour exactly as the sky shows its own:
 * the ramp's far end IS the sky's horizon colour in that direction, and the
 * farthest ridge melts into the sky except for fogCap's last 8 percent.
 * The grade runs inside tone mapping, so it touches lit surfaces and not the
 * painted sky or the air.
 */
export interface FwUniforms {
  fwOn: { value: number };
  fwRampSun: { value: THREE.DataTexture };
  fwRampAway: { value: THREE.DataTexture };
  /** start, end, cap, hazeOn */
  fwRamp: { value: THREE.Vector4 };
  /** haze base y, falloff */
  fwHaze: { value: THREE.Vector2 };
  /** world unit vector toward the sun */
  fwSunDir: { value: THREE.Vector3 };
  /** linear colour of the sun lobe (sunGlow x sunLobe) */
  fwLobe: { value: THREE.Color };
  /** grade: lift, gain - 1, (gamma - 1, sat - 1). Zero = identity. */
  fwLift: { value: THREE.Vector3 };
  fwGain: { value: THREE.Vector3 };
  fwGS: { value: THREE.Vector2 };
  /** v6: the additive fog term k (bible 2.6). */
  fwAdd: { value: number };
  /** The night layer's pale rule (NIGHT_PALE x state.night): how much a pale albedo comes down, how much any albedo greys. Read only by the materials nightPale() hooks. */
  fwPale: { value: THREE.Vector2 };
  /** The morning's mist: its linear colour and strength (0 but in the morning), and its shape: depth over the haze base, near, far. */
  fwMist: { value: THREE.Vector4 };
  fwMistShape: { value: THREE.Vector3 };
  /** The morning's dew (MORNING_DEW x state.morning): how much fresher the greens come out of the grade. */
  fwDew: { value: number };
}

/**
 * The night layer's pale rule (the critique of 2026-10-20 night): under the
 * moon a pale albedo reads lit from inside or frosted. The tent canvas and
 * the rock tops at Base Camp, the lookout's cream cab, the falls' boulder,
 * the dry grass at the Landing (tips at luma 105), the signpost's painted
 * arms (pastel blue and lavender plastic). At night 1 every albedo greys by
 * `grey` and the palest come down by up to `pull` (linear albedo luma 0.12
 * to 0.45, about sRGB 97 to 178), the way SAND_NIGHT does for the beach, and
 * the cream paints and canvas by `top` more (luma 0.45 to 0.7): at `pull`
 * alone the lookout's cream band and header still drew a pale frame round its
 * dark glass (p90 89 at Base Camp, the critique's target about 70). By day
 * all three are 0 and the materials draw exactly as before.
 */
export const NIGHT_PALE = { pull: 0.5, top: 0.25, grey: 0.3 } as const;
const NIGHT_PALE_PARS = /* glsl */ `uniform vec2 fwPale;`;
const NIGHT_PALE_FRAGMENT = /* glsl */ `
	{
		// The night layer's pale rule (light.ts NIGHT_PALE; fwPale is 0 by day).
		float fwPl = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( fwPl ), fwPale.y );
		diffuseColor.rgb *= 1.0 - fwPale.x * ( smoothstep( 0.12, 0.45, fwPl ) + ${(NIGHT_PALE.top / NIGHT_PALE.pull).toFixed(3)} * smoothstep( 0.45, 0.7, fwPl ) );
	}
`;
/** The pale rule's GLSL, for a module whose own hook already rewrites <color_fragment> (rocks, cover cards): `pars` after <common>, `fragment` after its albedo. */
export const NIGHT_PALE_GLSL = { pars: NIGHT_PALE_PARS, fragment: NIGHT_PALE_FRAGMENT } as const;
const nightPaleHook = (shader: THREE.WebGLProgramParametersWithUniforms) => {
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${NIGHT_PALE_PARS}`)
    .replace("#include <color_fragment>", `#include <color_fragment>\n${NIGHT_PALE_FRAGMENT}`);
};
/**
 * Gives a plain built-in lit material (no shader hook of its own) the pale
 * rule. Call it when the material is made, before light.ts's walk chains the
 * fog ramp after it; the uniform comes from that walk (FwUniforms.fwPale).
 */
export function nightPale(mat: THREE.Material): void {
  mat.onBeforeCompile = nightPaleHook;
  mat.customProgramCacheKey = () => "v6-night-pale";
}

const FW_FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFwOff;
#endif
`;
const FW_FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	// World offset from the camera (row-vector product = inverse rotation).
	vFwOff = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`;
const FW_FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFwOff;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	uniform float fwOn;
	uniform sampler2D fwRampSun;
	uniform sampler2D fwRampAway;
	uniform vec4 fwRamp;
	uniform vec2 fwHaze;
	uniform vec3 fwSunDir;
	uniform vec3 fwLobe;
	uniform float fwAdd;
	uniform vec4 fwMist;
	uniform vec3 fwMistShape;
#endif
`;
const FW_FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	#else
		if ( fwOn > 0.5 ) {
			float fwD = length( vFwOff );
			float fwU = clamp( ( fwD - fwRamp.x ) / max( fwRamp.y - fwRamp.x, 1.0 ), 0.0, 1.0 );
			// Toward or away from the sun by compass bearing, the same test the sky's horizon uses.
			float fwHl = length( vFwOff.xz );
			float fwSl = length( fwSunDir.xz );
			float fwCos = ( fwHl > 1e-3 && fwSl > 1e-4 ) ? dot( vFwOff.xz / fwHl, fwSunDir.xz / fwSl ) : 0.0;
			float fwT = smoothstep( -0.2, 0.9, fwCos );
			vec4 fwF = mix( texture2D( fwRampAway, vec2( fwU, 0.5 ) ), texture2D( fwRampSun, vec2( fwU, 0.5 ) ), fwT );
			// Valleys hold haze.
			float fwHz = exp( - max( cameraPosition.y + vFwOff.y - fwHaze.x, 0.0 ) / max( fwHaze.y, 1.0 ) );
			fwF.a = min( fwRamp.z, fwF.a * mix( 1.0, mix( 0.75, 1.15, fwHz ), fwRamp.w ) );
			fwF.rgb += fwLobe * pow( max( fwCos, 0.0 ), 8.0 ) * fwF.a;
			vec3 fwOut = linearToOutputTexel( vec4( fwF.rgb, 1.0 ) ).rgb;
			gl_FragColor.rgb = mix( gl_FragColor.rgb, fwOut, fwF.a );
			// v6 additive term: mid distance layers lighten toward the ramp's hue;
			// a * (1 - a) keeps the far end (a -> cap) meeting the sky.
			gl_FragColor.rgb = min( gl_FragColor.rgb + fwOut * ( fwAdd * 2.0 * fwF.a * ( 1.0 - fwF.a ) ), vec3( 1.0 ) );
			// The morning's mist (light.ts MORNING_LOOK; fwMist.a is 0 but in the
			// morning, and then this is skipped): a cool layer lying from the
			// haze base up to fwMistShape.x over it, coming in with distance
			// (fwMistShape.y to .z), so the valley floors and the water read
			// misty and the foreground stays crisp.
			if ( fwMist.a > 0.0 ) {
				float fwMy = cameraPosition.y + vFwOff.y - fwHaze.x;
				float fwMk = ( 1.0 - smoothstep( 0.0, fwMistShape.x, fwMy ) ) * smoothstep( fwMistShape.y, fwMistShape.z, fwD ) * fwMist.a;
				gl_FragColor.rgb = mix( gl_FragColor.rgb, linearToOutputTexel( vec4( fwMist.rgb, 1.0 ) ).rgb, fwMk );
			}
		} else {
			float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
			gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
		}
	#endif
#endif
`;
const STOCK_CUSTOM_TM = "vec3 CustomToneMapping( vec3 color ) { return color; }";
/** ACES (the palette was tuned under it), then lift, gain, gamma, saturation in display space. */
const FW_GRADE = /* glsl */ `
uniform vec3 fwLift;
uniform vec3 fwGain;
uniform vec2 fwGS;
uniform float fwDew;
vec3 CustomToneMapping( vec3 color ) {
	vec3 c = clamp( ACESFilmicToneMapping( color ), 0.0, 1.0 );
	vec3 g = pow( c, vec3( 1.0 / 2.2 ) );
	g = g * ( 1.0 + fwGain );
	g = g + fwLift * ( 1.0 - g );
	g = pow( max( g, 0.0 ), vec3( 1.0 / ( 1.0 + fwGS.x ) ) );
	float l = dot( g, vec3( 0.2126, 0.7152, 0.0722 ) );
	g = max( mix( vec3( l ), g, 1.0 + fwGS.y ), 0.0 );
	// The morning's dew (light.ts MORNING_DEW; fwDew is 0 but in the morning,
	// and then this is skipped): what is green comes out fresher, a touch
	// brighter and cooler.
	if ( fwDew > 0.0 ) {
		float gk = smoothstep( 0.0, 0.08, g.g - max( g.r, g.b ) * 0.95 );
		g = mix( g, g * vec3( ${MORNING_DEW.mul.map((v) => v.toFixed(3)).join(", ")} ), gk * fwDew );
	}
	return pow( g, vec3( 2.2 ) );
}
`;

/** For a shader that does its own fog: declarations and the mix (needs vFwOff from FW_FOG_GLSL.vertex). */
export const FW_FOG_GLSL = {
  parsVertex: FW_FOG_PARS_VERTEX,
  vertex: FW_FOG_VERTEX,
  parsFragment: FW_FOG_PARS_FRAGMENT,
  fragment: FW_FOG_FRAGMENT,
} as const;

/** The live shared ramp and grade uniforms of the scene's light module (null before it installs). */
export function rampFogUniforms(scene: THREE.Scene): FwUniforms | null {
  return (scene.userData.fwUniforms as FwUniforms | undefined) ?? null;
}

const RAMP_W = 256;
/** Ramp stops (bible 1.4): position and alpha; the last alpha is the key's cap. */
const RAMP_U = [0, 0.08, 0.25, 0.5, 0.75, 1];
const RAMP_A = [0, 0.1, 0.32, 0.58, 0.78, 0.92];

function newRampTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint16Array(RAMP_W * 4), RAMP_W, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Monotone cubic (Fritsch-Carlson) through the stops, per channel: smooth,
 * no overshoot, so a continuous slope never shows a contour stripe.
 */
function monotoneTangents(xs: readonly number[], ys: readonly number[], out: number[]): number[] {
  const n = xs.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  out.length = n;
  out[0] = d[0];
  out[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) out[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      out[i] = 0;
      out[i + 1] = 0;
      continue;
    }
    const a = out[i] / d[i];
    const b = out[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      out[i] = t * a * d[i];
      out[i + 1] = t * b * d[i];
    }
  }
  return out;
}

function hermite(xs: readonly number[], ys: readonly number[], ms: readonly number[], x: number): number {
  let i = 0;
  while (i < xs.length - 2 && x > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i];
  const t = Math.min(1, Math.max(0, (x - xs[i]) / h));
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * ms[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * ms[i + 1];
}

const _rc = new THREE.Color();
const _ra = new THREE.Color();
const _stopR: number[] = [];
const _stopG: number[] = [];
const _stopB: number[] = [];
const _stopA: number[] = [];
const _mR: number[] = [];
const _mG: number[] = [];
const _mB: number[] = [];
const _mA: number[] = [];

/**
 * v6 soft steps (bible 2.6): past u = 0.5, where the ridges sit, the ramp
 * climbs in RAMP_STEPS soft stairs (flat for most of each band, rising over
 * its last RAMP_STEP_RISE), so each far ridge takes one flat tone, layered
 * like Firewatch's painted distance. The near half stays smooth.
 */
const RAMP_STEPS = 4;
const RAMP_STEP_RISE = 0.35;
function rampStep(u: number): number {
  if (u <= 0.5) return u;
  const t = ((u - 0.5) / 0.5) * RAMP_STEPS;
  const i = Math.min(RAMP_STEPS - 1, Math.floor(t));
  const f = t - i;
  const r = f < 1 - RAMP_STEP_RISE ? 0 : smoothstep(1 - RAMP_STEP_RISE, 1, f);
  return 0.5 + ((i + r) / RAMP_STEPS) * 0.5;
}

/**
 * Writes one ramp into its texture. Stops are given in linear colour and
 * interpolated in display space (even steps to the eye); texels store linear.
 */
function writeRamp(tex: THREE.DataTexture, stops: readonly THREE.Color[], cap: number) {
  const n = stops.length;
  for (let i = 0; i < n; i++) {
    _rc.copy(stops[i]).convertLinearToSRGB();
    _stopR[i] = _rc.r;
    _stopG[i] = _rc.g;
    _stopB[i] = _rc.b;
    _stopA[i] = i === n - 1 ? cap : Math.min(cap, RAMP_A[i]);
  }
  _stopR.length = _stopG.length = _stopB.length = _stopA.length = n;
  monotoneTangents(RAMP_U, _stopR, _mR);
  monotoneTangents(RAMP_U, _stopG, _mG);
  monotoneTangents(RAMP_U, _stopB, _mB);
  monotoneTangents(RAMP_U, _stopA, _mA);
  const data = tex.image.data as unknown as Uint16Array;
  for (let x = 0; x < RAMP_W; x++) {
    const u = rampStep(x / (RAMP_W - 1));
    _rc.setRGB(
      Math.min(1, Math.max(0, hermite(RAMP_U, _stopR, _mR, u))),
      Math.min(1, Math.max(0, hermite(RAMP_U, _stopG, _mG, u))),
      Math.min(1, Math.max(0, hermite(RAMP_U, _stopB, _mB, u))),
      THREE.LinearSRGBColorSpace,
    ).convertSRGBToLinear();
    const o = x * 4;
    data[o] = THREE.DataUtils.toHalfFloat(_rc.r);
    data[o + 1] = THREE.DataUtils.toHalfFloat(_rc.g);
    data[o + 2] = THREE.DataUtils.toHalfFloat(_rc.b);
    data[o + 3] = THREE.DataUtils.toHalfFloat(Math.min(1, Math.max(0, hermite(RAMP_U, _stopA, _mA, u))));
  }
  tex.needsUpdate = true;
}

const _awayStops = [0, 1, 2, 3, 4, 5].map(() => new THREE.Color());
const _sunStops = [0, 1, 2, 3, 4, 5].map(() => new THREE.Color());
const _endAway = new THREE.Color();
const _endSun = new THREE.Color();
const _sg = new THREE.Color();

/** The two ramps for a blended state (bible 1.4's stop table), written into their textures. */
function buildRamps(s: LightState, away: THREE.DataTexture, sunTex: THREE.DataTexture) {
  const ns = s.nearShade;
  const hz = s.haze;
  // The far end is the sky at the horizon: with haloFog it carries the halo
  // (skyCpu at 0 degrees), so the farthest ridge or cloud meets the sky above
  // it in one colour.
  const hf = s.haloAmt * s.haloFog * (1 - smoothstep(0, Math.max(0.2, s.haloHalf), Math.abs(s.haloDeg)));
  _endAway.copy(s.skyHorizon).lerp(s.halo, hf);
  _endSun.copy(s.skyGlow).lerp(s.halo, hf);
  // The sun's colour only while it is up (at night the sun side is plain haze).
  const up = smoothstep(-6, 1, s.sunEl);
  _sg.copy(hz).lerp(s.sunGlow, up);
  const A = _awayStops;
  A[0].copy(ns);
  A[1].copy(ns).lerp(hz, 0.3);
  A[2].copy(ns).lerp(hz, 0.65);
  A[3].copy(hz);
  A[4].copy(hz).lerp(_endAway, 0.6);
  A[5].copy(_endAway);
  const S = _sunStops;
  S[0].copy(ns);
  S[1].copy(ns).lerp(hz, 0.35);
  S[2].copy(hz).lerp(_sg, 0.15);
  S[3].copy(hz).lerp(_sg, 0.35);
  _ra.copy(hz).lerp(_endSun, 0.6);
  S[4].copy(_ra);
  S[5].copy(_endSun);
  writeRamp(away, A, s.fogCap);
  writeRamp(sunTex, S, s.fogCap);
}

const FW_CHUNK_NAMES = ["fog_pars_vertex", "fog_vertex", "fog_pars_fragment", "fog_fragment", "tonemapping_pars_fragment"] as const;

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
  // The clock's layers (setClock): the night and morning factors shown, and the ease toward new ones (both together).
  let nightNow = 0;
  let morningNow = 0;
  const clockEase = { from: 0, to: 0, mFrom: 0, mTo: 0, t0: 0, ms: 0 };

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
    uMoonHalo: { value: new THREE.Vector3(...MOON_HALO.day) },
    uSkyShape: { value: new THREE.Vector4(SKY_SHAPE.midFrom, SKY_SHAPE.midTo, SKY_SHAPE.topFrom, SKY_SHAPE.topTo) },
    uHalo: { value: new THREE.Vector4(1, 1, 1, 0) },
    uHaloBand: { value: new THREE.Vector3(1.6, 3.2, 0) },
  };

  // ── Fog ramp and grade (see "The fog ramp and the grade") ──
  const rampSun = newRampTexture();
  const rampAway = newRampTexture();
  const fw: FwUniforms = {
    fwOn: { value: 1 },
    fwRampSun: { value: rampSun },
    fwRampAway: { value: rampAway },
    fwRamp: { value: new THREE.Vector4(300, 8000, 0.92, 1) },
    fwHaze: { value: new THREE.Vector2(0, 200) },
    fwSunDir: { value: new THREE.Vector3(0, 1, 0) },
    fwLobe: { value: new THREE.Color(0, 0, 0) },
    fwLift: { value: new THREE.Vector3() },
    fwGain: { value: new THREE.Vector3() },
    fwGS: { value: new THREE.Vector2() },
    fwAdd: { value: 0 },
    fwPale: { value: new THREE.Vector2(0, 0) },
    fwMist: { value: new THREE.Vector4(1, 1, 1, 0) },
    fwMistShape: { value: new THREE.Vector3(1, 0, 1) },
    fwDew: { value: 0 },
  };
  scene.userData.fwUniforms = fw;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  const patched: Record<string, string> = {
    fog_pars_vertex: FW_FOG_PARS_VERTEX,
    fog_vertex: FW_FOG_VERTEX,
    fog_pars_fragment: FW_FOG_PARS_FRAGMENT,
    fog_fragment: FW_FOG_FRAGMENT,
  };
  const stockTM = chunks.tonemapping_pars_fragment;
  const gradeOk = typeof stockTM === "string" && stockTM.includes(STOCK_CUSTOM_TM);
  if (gradeOk) patched.tonemapping_pars_fragment = stockTM.replace(STOCK_CUSTOM_TM, FW_GRADE);
  else console.warn("[world-v6 light] CustomToneMapping stub not found; the grade is off (plain ACES)");
  const savedChunks: Record<string, string> = {};
  let swapDepth = 0;
  const enterSwap = () => {
    if (swapDepth++ > 0) return;
    for (const k of FW_CHUNK_NAMES) {
      if (!(k in patched)) continue;
      savedChunks[k] = chunks[k];
      chunks[k] = patched[k];
    }
  };
  const leaveSwap = () => {
    if (--swapDepth > 0) return;
    for (const k of FW_CHUNK_NAMES) if (k in savedChunks) chunks[k] = savedChunks[k];
  };
  const baseRender = renderer.render;
  const baseCompile = renderer.compile;
  const fwRender: typeof renderer.render = function (this: THREE.WebGLRenderer, sc, cam) {
    enterSwap();
    try {
      return baseRender.call(this, sc, cam);
    } finally {
      leaveSwap();
    }
  };
  const fwCompile: typeof renderer.compile = function (this: THREE.WebGLRenderer, sc, cam, target) {
    // Hook every material (fog ramp and grade uniforms) BEFORE its program is
    // built: the scene's warm compile (compileAsync calls compile) then builds
    // the programs the frames will use, and none recompiles on first draw.
    if (sc === scene) walkMaterials();
    enterSwap();
    try {
      return baseCompile.call(this, sc, cam, target);
    } finally {
      leaveSwap();
    }
  };
  renderer.render = fwRender;
  renderer.compile = fwCompile;
  const toneMappingWas = renderer.toneMapping;
  if (gradeOk) renderer.toneMapping = THREE.CustomToneMapping;

  // ── Sky dome ──
  const skyGeo = new THREE.SphereGeometry(1000, 48, 24);
  const skyMat = new THREE.ShaderMaterial({
    name: "LightSkyMat",
    side: THREE.BackSide,
    // v6 (bible 2.5, perf rule 7): drawn LAST among the opaques with the depth
    // test on, pinned to the far plane, so the dome's shader runs only where
    // sky shows.
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      ...skyUniforms,
      uSunDisc: { value: new THREE.Color(0xfff0cf) },
      uSunVis: { value: 1 },
      uSunRadius: { value: THREE.MathUtils.degToRad(SUN_RADIUS_DEG) },
      uSunBands: { value: 0 },
      uSunHero: { value: 0 },
      uMoonDisc: { value: new THREE.Color(MOON_LOOK.day.disc) },
      uMoonDiscNight: { value: new THREE.Color(MOON_LOOK.night.disc) },
      uMoonVis: { value: 0 },
      uMoonRadius: { value: THREE.MathUtils.degToRad(MOON_RADIUS_DEG) },
      uMoonLook: { value: 0 },
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
      uniform float uSunBands;
      uniform float uSunHero;
      uniform vec3 uMoonDisc;
      uniform vec3 uMoonDiscNight;
      uniform float uMoonVis;
      uniform float uMoonRadius;
      uniform float uMoonLook;
      uniform vec3 uBandN;
      uniform float uBand;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = lightSky(d);
        // v6 (bible 1.17): the Milky Way, once the sky is dark: a band of teal,
        // violet and rose dust with a bright core and dark rifts along it.
        // Map review wave 3 (real_time_light.md "Cheap now"): its noise runs
        // only where the band can change the screen. most: the most the band
        // can add here (every factor below at its largest, each colour channel
        // at 1). Times the slope of the screen's sRGB curve at this sky's
        // darkest channel, that is the most it can move the pixel; under half
        // an 8-bit step (0.5 / 255) it cannot show, so the noise is skipped
        // and the sky's pixel comes out the same or 1 level off. The slope is
        // 0.4396 at 1.0 and 12.92 at most (the curve's dark end): what shows
        // at 0.4396 shows on any sky up to 1.0, what does not at 12.92 shows
        // on none, and only between them is the slope worked out. Where the
        // noise runs, the sum is the one it always was.
        if (uBand > 0.0) {
          float bd = dot(d, uBandN);
          float bm = exp(-bd * bd / 0.03);
          float core = exp(-bd * bd / 0.005);
          float fade = smoothstep(0.0, 0.2, d.y);
          float most = uBand * (1.5 * bm + 0.7 * core) * fade;
          if (most * 0.4396 > 0.5 / 255.0 || (most * 12.92 > 0.5 / 255.0 && most * 0.4396 * pow(max(min(c.r, min(c.g, c.b)), 1e-4), -0.5833) > 0.5 / 255.0)) {
            // Position along the band, for the dust's colour and clumps.
            vec3 bx = normalize(cross(uBandN, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
            vec3 by = cross(uBandN, bx);
            float along = atan(dot(d, by), dot(d, bx));
            vec2 bq = vec2(along * 3.2, bd * 14.0);
            float dust = lfbm(bq * 1.6 + 5.3);
            float clump = smoothstep(0.35, 0.8, lfbm(bq * 3.1 + 1.7));
            vec3 teal = vec3(0.16, 0.5, 0.56);
            vec3 violet = vec3(0.42, 0.26, 0.66);
            vec3 rose = vec3(0.72, 0.34, 0.5);
            float hueT = lfbm(vec2(along * 1.3, 0.7) + 9.1);
            vec3 bc = mix(mix(teal, violet, smoothstep(0.3, 0.55, hueT)), rose, smoothstep(0.55, 0.8, hueT));
            bc = mix(bc, vec3(0.95, 0.86, 0.92), core * 0.55);
            // Rifts: dark lanes off the band's centre, broken by the dust.
            float rift = 1.0 - 0.8 * exp(-(bd - 0.025) * (bd - 0.025) / 0.00045) * smoothstep(0.3, 0.62, dust)
                             - 0.4 * exp(-(bd + 0.05) * (bd + 0.05) / 0.0003) * smoothstep(0.45, 0.7, dust);
            c += bc * uBand * (bm * (0.3 + 0.7 * dust) + core * 0.7 + clump * bm * 0.5) * max(rift, 0.0) * fade;
          }
        }
        float horizon = smoothstep(-0.004, 0.004, d.y);
        float sa = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
        // v6 (bible 2.5): a halo about 4 times the disc, and at a low sun 3
        // concentric painted bands (flat steps with soft seams) out to ~11 radii.
        // Final pass B: the finale's hero sun (uSunHero, a8 and the tail). The
        // disc was 241 luma inside a 242 halo, so it did not read: a third
        // bigger and near white, the halo quieter so the disc stands 25+ over
        // it, a thin hot corona, and painted rays turning slowly round it.
        float sR = uSunRadius * (1.0 + 0.35 * uSunHero);
        float sHalo = 1.0 - smoothstep(sR, sR * 4.0, sa);
        float sf = 1.0 - smoothstep(sR, sR * 11.0, sa);
        float sb = (floor(sf * 3.0) + smoothstep(0.8, 1.0, fract(sf * 3.0))) / 3.0;
        c += uSunGlow * (0.3 * sHalo * sHalo * (1.0 - 0.45 * uSunHero) + 0.2 * sb * uSunBands * (1.0 - 0.3 * uSunHero)) * uSunVis * horizon;
        if (uSunHero > 0.0) {
          vec3 h1 = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
          vec3 h2 = cross(h1, uSunDir);
          float ang = atan(dot(d, h2), dot(d, h1));
          float rr = sa / sR;
          // Rays: wedges of unequal width, soft painted edges, fading out by ~14 radii.
          float w1 = 0.5 + 0.5 * sin(ang * 7.0 + 0.6);
          float w2 = 0.5 + 0.5 * sin(ang * 11.0 + 2.1);
          float ray = smoothstep(0.5, 0.78, w1 * 0.65 + w2 * 0.35);
          float fall = smoothstep(1.3, 2.6, rr) * (1.0 - smoothstep(4.0, 14.0, rr));
          c += uSunGlow * ray * fall * 0.16 * uSunHero * uSunVis * horizon;
          // The corona: a thin hot ring just outside the disc.
          float cor = (1.0 - smoothstep(1.0, 1.5, rr)) * smoothstep(0.9, 1.02, rr);
          c = mix(c, vec3(1.0, 0.86, 0.55), cor * 0.6 * uSunHero * uSunVis * horizon);
        }
        vec3 disc = mix(uSunDisc, vec3(1.0, 0.985, 0.93), uSunHero);
        c = mix(c, disc, (1.0 - smoothstep(sR * 0.9, sR * 1.02, sa)) * uSunVis * horizon);
        float ma = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
        // MOON_LOOK: the island's soft disc (uMoonLook 0) or the night layer's crisp one (1).
        float mm = (1.0 - smoothstep(uMoonRadius * mix(${MOON_LOOK.day.edge[0].toFixed(2)}, ${MOON_LOOK.night.edge[0].toFixed(2)}, uMoonLook), uMoonRadius * mix(${MOON_LOOK.day.edge[1].toFixed(2)}, ${MOON_LOOK.night.edge[1].toFixed(2)}, uMoonLook), ma)) * uMoonVis * horizon;
        if (mm > 0.0) {
          // A face: grey seas and a darker limb, so the disc reads as the moon.
          vec3 t1 = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
          vec3 t2 = cross(t1, uMoonDir);
          vec2 mq = vec2(dot(d, t1), dot(d, t2)) / uMoonRadius;
          float seas = smoothstep(mix(${MOON_LOOK.day.seas[0].toFixed(2)}, ${MOON_LOOK.night.seas[0].toFixed(2)}, uMoonLook), mix(${MOON_LOOK.day.seas[1].toFixed(2)}, ${MOON_LOOK.night.seas[1].toFixed(2)}, uMoonLook), lfbm(mq * 1.4 + 4.0));
          float limb = sqrt(max(0.0, 1.0 - min(1.0, dot(mq, mq))));
          c = mix(c, mix(uMoonDisc, uMoonDiscNight, uMoonLook) * (1.0 - 0.24 * seas) * (0.8 + 0.2 * limb), mm);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = "LightSky";
  sky.frustumCulled = false;
  sky.renderOrder = 1000;
  sky.matrixAutoUpdate = false;
  // The material walk (glow levels, the shared fog and grade uniforms) runs in
  // update() and before every compile (fwCompile), never inside a draw.
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
    // uMoonCut: the moon's radius (radians), how much of it shows, and the
    // night layer's share (state.night): the stars are drawn over the dome,
    // so at night they went out where they cross the disc (two of them
    // clipped it to white at the opening). 0 on the island: unchanged there.
    uniforms: { uStars: { value: 0 }, uPx: { value: 1 }, uMoonDir: skyUniforms.uMoonDir, uMoonCut: { value: new THREE.Vector3(0, 0, 0) } },
    vertexShader: /* glsl */ `
      attribute float aBright;
      attribute float aSize;
      attribute float aTint;
      uniform float uStars;
      uniform float uPx;
      uniform vec3 uMoonDir;
      uniform vec3 uMoonCut;
      varying float vA;
      varying float vTint;
      varying float vCross;
      void main() {
        vec3 d = normalize(position);
        // Pinned to the far plane like the dome; the depth test hides them behind land.
        vec4 p = projectionMatrix * viewMatrix * vec4(d * 1000.0 + cameraPosition, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
        vA = aBright * uStars * smoothstep(-0.01, 0.05, d.y); // fix pass 3: full by ~3 up (was ~7), so a7's low sky has stars
        vA *= 1.0 - uMoonCut.z * uMoonCut.y * (1.0 - smoothstep(uMoonCut.x * 1.05, uMoonCut.x * 1.7, acos(clamp(dot(d, uMoonDir), -1.0, 1.0))));
        vTint = aTint;
        // The brightest (aSize over 6) are drawn as soft crosses in a bigger sprite.
        vCross = step(6.0, aSize);
        gl_PointSize = aSize * uPx;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      varying float vTint;
      varying float vCross;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r = length(q);
        float a = vA * (1.0 - smoothstep(0.35, 1.0, r));
        if (vCross > 0.5) {
          // A small bright core and two thin soft spikes.
          float core = 1.0 - smoothstep(0.08, 0.3, r);
          float spikes = (exp(-q.x * q.x * 120.0) + exp(-q.y * q.y * 120.0)) * (1.0 - smoothstep(0.2, 1.0, r));
          a = vA * max(core, 0.65 * spikes);
        }
        if (a < 0.004) discard;
        vec3 col = mix(vec3(0.8, 0.88, 1.0), vec3(1.0, 0.88, 0.72), vTint);
        gl_FragColor = vec4(col, a);
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
  // Map review 2026-10-15, item 15c: the mirror follows the shore terrain.ts
  // draws (lakeShoreR), not a circle, and reaches LAKE_PAD past it under the
  // bank, so the edge you see is the ground's own waterline and no water lies
  // past it. The same fan as before (a centre and a rim), 180 rim points.
  const lakeGeo = new THREE.CircleGeometry(1, 180);
  {
    const p = lakeGeo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 1; i < p.count; i++) {
      // Local (x, y) is world (x, -z) once the mesh lies flat (rotation.x below).
      const R = lakeShoreR(Math.atan2(-p.getY(i), p.getX(i))) + LAKE_PAD;
      p.setXY(i, p.getX(i) * R, p.getY(i) * R);
    }
    lakeGeo.computeBoundingSphere();
  }
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
  // Detail pass 3: the reflection goes through the same pipeline as the
  // screen. three tone-maps only the canvas and XR targets, so the target was
  // filled un-graded with the fog mixed before tone mapping, and the lake then
  // tone-mapped the lot, sky included (on screen the sky and the fog colour
  // never go through ACES): the mirrored land and sky came out brighter than
  // the real ones (a5 water rows 94/107 over land 75). Flagged as XR, three
  // grades into the target (linear, half float); the lake then adds no second
  // grade. a5 water rows 88/95, the reflection the land's own colour.
  (reflectTarget as THREE.WebGLRenderTarget & { isXRRenderTarget: boolean }).isXRRenderTarget = true;
  reflectTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
  (reflector.material as THREE.ShaderMaterial).toneMapped = false;
  const bufSize = new THREE.Vector2();
  const lakeCentre = new THREE.Vector3(WORLD.lake.x, WORLD.lake.y, WORLD.lake.z);
  const camPos = new THREE.Vector3();
  let reflectCalls = 0;
  let reflectPasses = 0;
  // v6 (bible 3.2): the reflection's size per quality tier (setQuality).
  let reflectScale = REFLECT_SCALE;
  let reflectMaxW = REFLECT_MAX_W;
  // Fix round 3: the tier's mode. "skyIsland" draws REFLECT_CORE_LAYER only;
  // "frozen" renders once each time the camera comes within range, then keeps
  // that texture.
  let reflectMode: "full" | "skyIsland" | "frozen" = "full";
  let reflectFrozen = false;
  /** Final pass C: the camera at the last frozen render, last frame's camera, and when it rendered. */
  const frozenPose = new THREE.Matrix4();
  const prevPose = new THREE.Matrix4();
  let frozenMs = 0;
  // C1: set by afterAll once the allowed objects carry REFLECT_ONLY_LAYER.
  let reflectAllowList = false;
  let reflectMissing: string[] = [];
  const baseReflect = reflector.onBeforeRender;
  reflector.onBeforeRender = (r, s, camera, geometry, material, group) => {
    camPos.setFromMatrixPosition(camera.matrixWorld);
    const near = camPos.distanceTo(lakeCentre) < REFLECT_RANGE;
    lakeMat.uniforms.uLive.value = near ? 1 : 0;
    if (!near) {
      reflectFrozen = false;
      return;
    }
    // Final pass C (tier 3 lost the reveal: a5 was a flat dark lake, luma 37).
    // The one frozen render landed mid travel, before the camera arrived, and
    // was kept for good. "Frozen" now re-renders once whenever the camera comes
    // to rest somewhere new (the arrival), and refreshes at most every
    // FROZEN_REFRESH_MS while it moves, so a scroll through the reveal keeps a
    // live-enough mirror at a fraction of the pass's cost.
    if (reflectMode === "frozen" && reflectFrozen) {
      const still = camera.matrixWorld.equals(prevPose);
      prevPose.copy(camera.matrixWorld);
      const now = performance.now();
      if (camera.matrixWorld.equals(frozenPose) || (!still && now - frozenMs < FROZEN_REFRESH_MS)) {
        reflectCalls = 0;
        return;
      }
    }
    prevPose.copy(camera.matrixWorld);
    frozenPose.copy(camera.matrixWorld);
    frozenMs = performance.now();
    // Half the drawing buffer: modest, and square pixels whatever the screen.
    r.getDrawingBufferSize(bufSize);
    const w = Math.max(256, Math.min(reflectMaxW, Math.round(bufSize.x * reflectScale)));
    const h = Math.max(160, Math.round((w * bufSize.y) / Math.max(1, bufSize.x)));
    if (reflectTarget.width !== w || reflectTarget.height !== h) reflectTarget.setSize(w, h);
    reflector.camera.layers.mask = reflectAllowList
      ? 1 << (reflectMode === "skyIsland" ? REFLECT_CORE_LAYER : REFLECT_ONLY_LAYER)
      : (camera.layers.mask & ~(1 << NO_REFLECT_LAYER)) | (1 << REFLECT_ONLY_LAYER);
    // The nested render would reset renderer.info and hide the frame's real
    // cost; count it into the frame instead.
    const auto = r.info.autoReset;
    r.info.autoReset = false;
    const c0 = r.info.render.calls;
    baseReflect.call(reflector, r, s, camera, geometry, material, group);
    reflectCalls = r.info.render.calls - c0;
    reflectPasses++;
    reflectFrozen = true;
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
  let walkTick = 0;
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
    setQuality(tier) {
      reflectScale = tier.reflection.scale;
      reflectMaxW = tier.reflection.maxWidth;
      const mode = tier.reflection.mode ?? "full";
      if (mode !== reflectMode) reflectFrozen = false;
      reflectMode = mode;
    },
    setClock(night: number, morning: number, easeMs = 0) {
      const to = Math.min(1, Math.max(0, Number.isFinite(night) ? night : 0));
      const mTo = Math.min(1, Math.max(0, Number.isFinite(morning) ? morning : 0));
      if (!(easeMs > 0)) {
        clockEase.ms = 0;
        clockEase.to = to;
        clockEase.mTo = mTo;
        layClock(to, mTo);
        return;
      }
      if (clockEase.ms > 0 && clockEase.to === to && clockEase.mTo === mTo) return;
      if (clockEase.ms <= 0 && to === nightNow && mTo === morningNow) return;
      clockEase.from = nightNow;
      clockEase.to = to;
      clockEase.mFrom = morningNow;
      clockEase.mTo = mTo;
      clockEase.t0 = performance.now();
      clockEase.ms = easeMs;
    },
    get nightFactor() {
      return nightNow;
    },
    get morningFactor() {
      return morningNow;
    },
    update() {
      // The clock's ease, by the wall clock: a frame drawn late (the map woke
      // after a sleep) lands on the light the ease would have reached.
      if (clockEase.ms > 0) {
        const t = Math.min(1, (performance.now() - clockEase.t0) / clockEase.ms);
        const e = t * t * (3 - 2 * t);
        const f = clockEase.from + (clockEase.to - clockEase.from) * e;
        const m = clockEase.mFrom + (clockEase.mTo - clockEase.mFrom) * e;
        if (t >= 1) clockEase.ms = 0;
        layClock(t >= 1 ? clockEase.to : f, t >= 1 ? clockEase.mTo : m, t >= 1);
      }
      const u = forcedU ?? ctx.railU();
      const cam = ctx.camera;
      const camMoved = !cam.position.equals(lastCam) || !cam.quaternion.equals(lastQuat);
      const uChanged = !(u === lastU);
      // New materials (a module adding objects late) get the fog and grade
      // uniforms within a few frames; the glow levels follow u.
      if (!uChanged && ++walkTick >= WALK_EVERY) {
        walkTick = 0;
        walkMaterials();
      }
      syncFogDistances();
      if (!uChanged && !camMoved) return false;
      if (uChanged) {
        lastU = u;
        blendTrack(u, track, placeU, state);
        state.rev++;
        applyState();
        walkMaterials();
      }
      lastCam.copy(cam.position);
      lastQuat.copy(cam.quaternion);
      followCamera();
      applyForestDim();
      return uChanged;
    },
    isAnimating() {
      // Only while the clock's layers ease in: nothing in the light moves on its own.
      return clockEase.ms > 0;
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
      if (renderer.render === fwRender) renderer.render = baseRender;
      if (renderer.compile === fwCompile) renderer.compile = baseCompile;
      if (gradeOk && renderer.toneMapping === THREE.CustomToneMapping) renderer.toneMapping = toneMappingWas;
      rampSun.dispose();
      rampAway.dispose();
      if (scene.userData.fwUniforms === fw) delete scene.userData.fwUniforms;
      if (scene.userData.light === handle) delete scene.userData.light;
    },
    afterAll() {
      const found = new Set<string>();
      scene.traverse((o) => {
        // Lights too: a pass that sees no light compiles a new program for every material.
        if ((o as THREE.Light).isLight) {
          o.layers.enable(REFLECT_ONLY_LAYER);
          o.layers.enable(REFLECT_CORE_LAYER);
        }
        if (REFLECT_CORE_NAMES.includes(o.name)) o.traverse((c) => c.layers.enable(REFLECT_CORE_LAYER));
        if (!REFLECT_NAMES.includes(o.name)) return;
        found.add(o.name);
        o.traverse((c) => c.layers.enable(REFLECT_ONLY_LAYER));
      });
      reflectMissing = REFLECT_NAMES.filter((n) => !found.has(n));
      // The island must be in before the pass narrows, or the locked reveal loses it.
      reflectAllowList = found.has("Sky_Land");
    },
    stats() {
      return {
        drawCalls: 3 + (stars.visible ? 1 : 0),
        reflectionAllowList: reflectAllowList ? "on" : "off",
        reflectionMode: reflectMode,
        reflectionMissing: reflectMissing.join(",") || "none",
        reflectionPassCalls: reflectCalls,
        reflectionPasses: reflectPasses,
        reflectionTarget: `${reflectTarget.width}x${reflectTarget.height}`,
        starCount: STAR_COUNT,
        glowMaterials,
        fwMaterials,
        grade: gradeOk ? "custom" : "aces",
        rampStart: Math.round(fw.fwRamp.value.x),
        rampEnd: Math.round(fw.fwRamp.value.y),
        lampGlow: Math.round(state.lampGlow * 1e3) / 1e3,
        magicGlow: Math.round(state.magicGlow * 1e3) / 1e3,
        // The clock's layers: the factors (mid ease: the ones shown), and how much of each is here.
        night: Math.round(nightNow * 1e3) / 1e3,
        nightHere: Math.round(state.night * 1e3) / 1e3,
        nightEasing: clockEase.ms > 0 ? 1 : 0,
        morning: Math.round(morningNow * 1e3) / 1e3,
        morningHere: Math.round(state.morning * 1e3) / 1e3,
        aurora: Math.round(state.aurora * 1e3) / 1e3,
        forestDim: Math.round(forestNow * 1e3) / 1e3,
        cloudTriangles: cloudIndexUp.count / 3,
        u: Math.round(state.u * 1e4) / 1e4,
        stop: state.stop,
        blend: Math.round(state.blend * 1e3) / 1e3,
        msToBuild: Math.round(msBuild * 10) / 10,
      };
    },
  };

  /**
   * The clock's layers at night factor f and morning factor m: the track's
   * keys blended (setTrackClock), the light re-applied on the next update (as
   * a scroll would), and the lowest tier's kept reflection drawn again, or a
   * student parked at the lake would see the old sky in the water.
   */
  function layClock(f: number, m: number, redrawFrozen = true) {
    if (f === nightNow && m === morningNow) {
      if (redrawFrozen) reflectFrozen = false;
      return;
    }
    nightNow = f;
    morningNow = m;
    setTrackClock(track, f, m);
    lastU = NaN;
    // Mid ease the kept reflection waits for the ease to land (one redraw, not one a frame on the slowest machines).
    if (redrawFrozen) reflectFrozen = false;
  }

  /**
   * Glow materials follow the darkness. A walk over the scene (a few hundred
   * nodes) each drawn frame, so materials added after install (the blocks)
   * are found on their first frame; a material only changes when its level does.
   */
  let glowMaterials = 0;
  let fwMaterials = 0;
  /** The level the "magic" glow materials get: state.magicGlow, raised in the dark forest by what the exposure lost. */
  let magicLevel = 1;
  let forestNow = 0;
  const proto = THREE.Material.prototype;
  const fwHook = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, fw);
  };
  /**
   * Gives a material the shared fog ramp and grade uniforms (idempotent).
   * ShaderMaterials take them straight into their uniforms; built-ins through
   * onBeforeCompile, chained after any hook a module installed (a hook that
   * chains on assignment, v3 style, gets ours through its setter). The
   * program cache key keeps the module's own key, so two materials with
   * different module hooks never share a program. Last, three's own table
   * for the material is checked: a recompile clones built-in uniforms afresh.
   */
  function ensureFw(mat: THREE.Material) {
    if (mat.userData.fwHooked !== fw) {
      mat.userData.fwHooked = fw;
      const sm = mat as THREE.ShaderMaterial;
      if (sm.isShaderMaterial) {
        sm.uniforms = sm.uniforms ?? {};
        Object.assign(sm.uniforms, fw);
      } else {
        const chains = !!Object.getOwnPropertyDescriptor(mat, "onBeforeCompile")?.set;
        const prev = mat.onBeforeCompile;
        if (chains) {
          mat.onBeforeCompile = fwHook;
        } else if (prev !== proto.onBeforeCompile) {
          const prevKey = mat.customProgramCacheKey !== proto.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
          const prevKeyText = prev.toString();
          mat.onBeforeCompile = function (this: THREE.Material, shader, r) {
            prev.call(this, shader, r);
            fwHook(shader);
          };
          mat.customProgramCacheKey = () => `${prevKey ? prevKey() : prevKeyText}|fw`;
        } else {
          mat.onBeforeCompile = fwHook;
        }
      }
    }
    const props = renderer.properties.get(mat) as { uniforms?: Record<string, unknown>; uniformsList?: unknown };
    if (props.uniforms && props.uniforms.fwOn !== fw.fwOn) {
      Object.assign(props.uniforms, fw);
      props.uniformsList = null;
    }
  }

  function walkMaterials() {
    let found = 0;
    let fwFound = 0;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      const list = Array.isArray(m) ? m : [m];
      for (const mat of list) {
        if (!mat) continue;
        if ((mat as THREE.MeshLambertMaterial).fog || mat.toneMapped) {
          ensureFw(mat);
          fwFound++;
        }
        const kind = mat.userData.lightGlow ?? (mat.name === "V4BlockGlow" ? "lamp" : undefined);
        if (kind !== "lamp" && kind !== "magic") continue;
        const colored = mat as THREE.MeshBasicMaterial;
        if (!colored.color) continue;
        found++;
        // The forest's magic species (read back through forest.ts's probe) dim
        // with the forest: in a6 only the floor glow and the Great Tree carry light.
        const level = kind === "magic" ? (o.name === "ForestMagicProbe" ? state.magicGlow : magicLevel) : state.lampGlow;
        // The night layer: a lamp warms toward NIGHT_LAMP_TINT (at 1.1 under the
        // night's exposure ACES took a lit window to white). Magic keeps its hue.
        const warm = kind === "lamp" ? state.night : 0;
        // The morning layer: a lamp turns toward unlit glass (MORNING_LAMP_TINT); 0 by day and at night.
        const cool = kind === "lamp" ? state.morning : 0;
        if (mat.userData.lightGlowLevel === level && (mat.userData.lightGlowWarm ?? 0) === warm && (mat.userData.lightGlowCool ?? 0) === cool) continue;
        if (!mat.userData.lightGlowBase) mat.userData.lightGlowBase = colored.color.clone();
        colored.color.copy(mat.userData.lightGlowBase as THREE.Color).multiplyScalar(level);
        if (warm > 0) colored.color.multiply(_lampTint.setRGB(1, 1, 1).lerp(_nightLampTint, warm));
        if (cool > 0) colored.color.multiply(_lampTint.setRGB(1, 1, 1).lerp(_morningLampTint, cool));
        mat.userData.lightGlowLevel = level;
        mat.userData.lightGlowWarm = warm;
        mat.userData.lightGlowCool = cool;
      }
    });
    glowMaterials = found;
    fwMaterials = fwFound;
  }

  /** The ramp's distances are scene.fog's near / far (the scene schedules them, with the park's push). */
  function syncFogDistances() {
    const f = scene.fog as THREE.Fog | null;
    if (!f || !(f as THREE.Fog).isFog) return;
    const r = fw.fwRamp.value;
    if (r.x !== f.near || r.y !== f.far) {
      r.x = f.near;
      r.y = f.far;
      // Clouds melt fully into the sky before the far plane (camera.far follows the ramp).
      cloudMat.uniforms.uFade.value.x = Math.min(CLOUD_FADE_NEAR, f.far * 0.35);
      cloudMat.uniforms.uFade.value.y = Math.min(CLOUD_FADE_FAR, f.far * 0.95);
    }
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
    skyMat.uniforms.uSunBands.value = smoothstep(16, 5, s.sunEl);
    skyMat.uniforms.uSunHero.value = s.sunHero;
    skyMat.uniforms.uMoonVis.value = s.moonVis;
    // The moon's size and look (MOON_LOOK, MOON_HALO): the night layer's crisp ivory disc where state.night is.
    const moonR = THREE.MathUtils.degToRad(s.moonRadius);
    skyMat.uniforms.uMoonRadius.value = moonR;
    skyMat.uniforms.uMoonLook.value = s.night;
    skyUniforms.uMoonHalo.value.set(...MOON_HALO.day).lerp(_moonHalo.set(...MOON_HALO.night), s.night);
    starMat.uniforms.uMoonCut.value.set(moonR, s.moonVis, s.night);
    // Stars: skip the draw call entirely in daylight. The Milky Way follows its
    // own level (the star level, but at night only the forest and the island
    // have one: where it shows, its noise was nearly all of night's cost).
    starMat.uniforms.uStars.value = s.stars;
    skyMat.uniforms.uBand.value = STAR_BAND_GLOW * s.band;
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
    // v6 (bible 41): the lights stay visible at intensity 0 when off, so the
    // directional light count never changes and no program recompiles mid scroll.
    // Fog and exposure.
    if (fog) {
      fog.color.copy(s.haze);
      if (handle.fogDistances) {
        fog.near = s.fogNear;
        fog.far = s.fogFar;
      }
    }
    renderer.toneMappingExposure = s.exposure;
    // The v5 look: halo, fog ramp, grade.
    skyUniforms.uHalo.value.set(s.halo.r, s.halo.g, s.halo.b, s.haloAmt);
    skyUniforms.uHaloBand.value.set(s.haloDeg, Math.max(0.2, s.haloHalf), s.haloFog);
    buildRamps(s, rampAway, rampSun);
    fw.fwRamp.value.z = s.fogCap;
    fw.fwRamp.value.w = s.hazeOn;
    fw.fwHaze.value.set(s.hazeBase, s.hazeFall);
    fw.fwSunDir.value.copy(s.sunDir);
    fw.fwLobe.value.copy(s.sunGlow).multiplyScalar(s.sunLobe * smoothstep(-6, 1, s.sunEl));
    fw.fwLift.value.set(s.liftR, s.liftG, s.liftB);
    fw.fwGain.value.set(s.gainR - 1, s.gainG - 1, s.gainB - 1);
    fw.fwGS.value.set(s.gamma - 1, s.sat - 1);
    fw.fwAdd.value = s.fogAdd;
    fw.fwPale.value.set(NIGHT_PALE.pull * s.night, NIGHT_PALE.grey * s.night);
    // The morning's mist (0 but in the morning: the fog's mist branch is skipped).
    fw.fwMist.value.set(s.mistColor.r, s.mistColor.g, s.mistColor.b, s.mist);
    fw.fwMistShape.value.set(Math.max(1, s.mistDepth), s.mistNear, Math.max(s.mistNear + 1, s.mistFar));
    fw.fwDew.value = MORNING_DEW.k * s.morning;
    lakeMat.uniforms.uDeep.value.copy(s.water);
    // The lake's colour when it is too far to reflect: the sky a little above the horizon.
    skyCpu(s, tmpDir.set(0, 0.18, -1).normalize(), lakeMat.uniforms.uSkyTint.value);
    // For other modules that captured these at install.
    ctx.sunDir?.copy(lit);
    ctx.sunColor?.copy(s.sunColor);
    ctx.hazeColor?.copy(s.haze);
  }

  /** How deep in the dark forest the camera is, 0..1 (FOREST_DIM). */
  function forestShade(): number {
    const p = ctx.camera.position;
    const F = WORLD.forest;
    const inside = 1 - smoothstep(F.r - 120, F.r + 120, Math.hypot(p.x - F.x, p.z - F.z));
    if (inside <= 0) return 0;
    const low = 1 - smoothstep(220, 450, p.y - terrainHeight(p.x, p.z));
    const night = 1 - smoothstep(-3, 3, state.sunEl);
    return inside * low * night;
  }

  /** Lays FOREST_DIM over the lights applyState() set (runs on every moved frame). */
  function applyForestDim() {
    const f = forestShade();
    forestNow = f;
    const s = state;
    fill.intensity = s.hemiIntensity * (1 - FOREST_DIM.fill * f);
    shade.intensity = s.ambientIntensity * (1 - FOREST_DIM.ambient * f);
    moon.intensity = s.moonIntensity * (1 - FOREST_DIM.moon * f);
    rim.intensity = s.rimIntensity * (1 - FOREST_DIM.moon * f);
    const e = 1 - FOREST_DIM.exposure * f;
    renderer.toneMappingExposure = s.exposure * e;
    magicLevel = s.magicGlow / e;
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
  // Harness only: the built track, so a render can try a key's values in the
  // page (edit track[i].key, then setU(null)) without a rebuild.
  (handle as LightModule & { debugTrack?: LightTrackStop[] }).debugTrack = track;
  // Harness only: build a track key from raw rows (debugKey), so a render can
  // A/B values in one page load.
  Object.assign(handle, {
    debugKey: (k: LightKeyframe, look: LookKey) => linearKey(k, look),
    debugRows: () => ({ LIGHTS, LIGHTS_BETWEEN, LOOKS }),
    // Harness only: the clock's rows, live. Change NIGHT_ROWS, NIGHT_BASE,
    // NIGHT_LOOK, MORNING_ROWS, MORNING_BASE, MORNING_LOOK or MORNING_LIGHT in
    // the page, then debugNight().rebuild() lays them.
    debugNight: () => ({
      NIGHT_ROWS,
      NIGHT_BASE,
      NIGHT_LOOK,
      MORNING_ROWS,
      MORNING_BASE,
      MORNING_LOOK,
      MORNING_LIGHT,
      rebuild() {
        rebuildTrackClock(track);
        const f = nightNow;
        nightNow = -1;
        layClock(f, morningNow);
      },
    }),
  });
  if (ctx.quality) handle.setQuality?.(ctx.quality);
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
      // Fix pass 3: a mirror gives back a little less than it gets (a5's reflection
      // read brighter than the land it doubles; the bible's 'black glass').
      refl *= 0.8;
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
  const tint = new Float32Array(STAR_COUNT);
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
      // Fix pass 3: even over the dome's area (the sqrt piled them overhead, leaving the low sky a7 frames bare).
      const y = -0.02 + 1.02 * hash1(i, STAR_SEED);
      const a = hash1(i, STAR_SEED + 1) * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(a) * r;
      bright[i] = 0.55 + 0.45 * m * m;
      size[i] = 1.7 + 2.8 * m * m * m;
    }
  }
  // v6 (bible 1.17, 2.5): three sizes (small, medium, large), two tints (a
  // quarter warm), the brightest STAR_CROSSES as soft crosses.
  const order: number[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const m = hash1(i, STAR_SEED + 9);
    size[i] = m < 0.72 ? 1.5 : m < 0.95 ? 2.4 : 3.6;
    bright[i] = Math.min(1, bright[i] * (m < 0.72 ? 0.8 : m < 0.95 ? 1.0 : 1.2));
    tint[i] = hash1(i, STAR_SEED + 11) < 0.25 ? 1 : 0;
    order.push(i);
  }
  order.sort((a, b) => hash1(a, STAR_SEED + 13) - hash1(b, STAR_SEED + 13));
  for (let k = 0; k < STAR_CROSSES; k++) {
    const i = order[k];
    if (pos[i * 3 + 1] < 0.05) continue;
    size[i] = 9 + 4 * hash1(i, STAR_SEED + 15);
    bright[i] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aBright", new THREE.BufferAttribute(bright, 1));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  g.setAttribute("aTint", new THREE.BufferAttribute(tint, 1));
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

/** lightSky() in TypeScript: linear colour in a unit direction, no discs. */
function skyCpu(s: LightState, d: THREE.Vector3, out: THREE.Color): THREE.Color {
  const deg = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, d.y))));
  const hl = Math.hypot(d.x, d.z);
  const sl = Math.hypot(s.sunDir.x, s.sunDir.z) || 1;
  const toward = smoothstep(-0.2, 0.9, hl > 1e-4 ? (d.x / hl) * (s.sunDir.x / sl) + (d.z / hl) * (s.sunDir.z / sl) : 0);
  out.copy(s.skyHorizon).lerp(s.skyGlow, toward);
  out.lerp(s.skyMid, smoothstep(SKY_SHAPE.midFrom, SKY_SHAPE.midTo, deg) * (0.55 + 0.45 * (1 - toward)));
  out.lerp(s.skyTop, smoothstep(SKY_SHAPE.topFrom, SKY_SHAPE.topTo, deg));
  const hd = deg + (Math.max(deg, 0) - deg) * s.haloFog;
  const hb = 1 - smoothstep(0, Math.max(0.2, s.haloHalf), Math.abs(hd - s.haloDeg));
  const cut = smoothstep(-0.4, 0.1, deg);
  out.lerp(s.halo, s.haloAmt * hb * (cut + (1 - cut) * s.haloFog));
  const ca = Math.max(d.dot(s.sunDir), 0);
  const g = 0.22 * Math.pow(ca, 5) + 0.55 * Math.pow(ca, 90);
  out.r += s.sunGlow.r * g;
  out.g += s.sunGlow.g * g;
  out.b += s.sunGlow.b * g;
  return out;
}
