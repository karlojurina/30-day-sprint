import * as THREE from "three";
import { BRIDGE, GATE_CAUSEWAY, ISLAND_PATH, PATH, PLACES, TRAIL, TRAIL_FOV, TRAIL_HUT, TRAIL_VIEW, WORLD, bridgeDeckAt, ladderSections, stopRow, type LadderSection } from "./layout";
import { CHECKPOINT } from "./checkpoint";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { blocked } from "./footprints";
import { NIGHT_LAMP_TINT, NO_REFLECT_LAYER } from "./light";
import { groundY } from "./rocks";
import { waterAt } from "./water";
import { areaShare, type WorldProgress } from "./progress";
import type { QualityTier } from "./quality";

/**
 * v6 world progress (Lovro's picks, 2026-09-28, world_overnight_log.md 46):
 * the student's progress drawn into the world. It only ever ADDS light and
 * life: a place the student has not reached looks as it does with no
 * progress at all, never asleep or in mist.
 *
 *   LESSON LANTERNS  one knee-high lantern per lesson beside the walked trail
 *                    (map review 2026-10-15, item 12): from each place's
 *                    landmark along the trail toward the next place's,
 *                    evenly spaced by distance along it, the first next to
 *                    the landmark, so watching k lessons lights the first k
 *                    from the landmark on (walks() below; the last place's
 *                    run up the causeway to the arch; round 2: Video Ads I's
 *                    last ones hang on the rock beside the ladder, and Video
 *                    Ads II's run from the ladder's top past the hut toward
 *                    the 30% cache, ending where the trail comes into the
 *                    cache's park view, round 3; round 4: a place whose single
 *                    lanterns would stand closer than PAIR_BELOW hangs them
 *                    two to a double post, AI Ads & Content today). None
 *                    stands in or over water drawn anywhere (water.ts
 *                    waterAt), on a cliff or ground steeper than STEEP (round
 *                    3), nearer its trail than its offset on the inside of a
 *                    bend (FOLD, round 4), or on another
 *                    thing's footprint; they lay none of their own (round 2: moving
 *                    them never deals the grass again). Watched: lit (warm glass, a small halo
 *                    that grows at dusk and night). The next one: a gentle
 *                    pulse. Ahead: dark glass, dark iron. They replace
 *                    blocks.ts's trail lanterns and its per-place progress
 *                    lanterns. Second Loom (2026-10-16): AI Ads & Content has
 *                    none; its lessons light THE FLOATING STEPS instead (below),
 *                    and Creative Strategy's run on from the island's path
 *                    onto the rope bridge, on posts at its railing that sway
 *                    with it. Its fix round: Static Ads' run ends where the
 *                    trail comes into AI Ads & Content's stop view, so none
 *                    stands in the Great Tree's clearing.
 *   THE FLOATING STEPS  (second Loom, 3:15 to 4:20) the steps up to the Sky
 *                    Island light from the bottom as AI Ads & Content's lessons
 *                    are watched: the lessons spread evenly over the steps
 *                    drawn (stepsLit), each lit step's runes and the rim round
 *                    its top turning the lanterns' warm glass, with a halo for
 *                    reading it from afar, the next one's runes pulsing. The
 *                    steps keep their shapes, poses and
 *                    motion (LOCKED): only their light changes. The runes are
 *                    dress-lakeforest.ts's (userData.stepRunes), drawn again on
 *                    the steps' own instance matrices.
 *   PLACES WAKE UP   each place gains light and life in steps as its share
 *                    of lessons watched passes about 25, 50 and 75 percent
 *                    (smoke, then a lamp by the landmark's door, then lamps
 *                    on its path), and its landmark's own lamp at 100
 *                    percent. Finished places stay fully lit. The
 *                    Introduction, AI Ads & Content and Creative Strategy
 *                    have none of these lamps since the second Loom (they
 *                    read as lesson lanterns bunched by the landmark). The
 *                    steps are WAKE below; existing lamps elsewhere (the signpost's
 *                    lamp, the lookout's, the Trail Hut's, the arch's
 *                    lanterns, the Landing's campfire) are found by their
 *                    userData.wake tag ({ place, at, set? }) and switched here.
 *   THE AREA-DONE MOMENT  celebrate(area): the light runs along that area's
 *                    lanterns in about a second, leaving each a little
 *                    brighter, and the landmark lamp catches at the end with
 *                    a warm bloom, a few sparks and one paper lantern that
 *                    lifts off it and drifts up for about 7 seconds. One-off
 *                    and cheap (uniforms, one extra call while it plays); the
 *                    page decides when it fires. Reduced motion: no run, no
 *                    sparks, the lamp simply turns on.
 *
 * Driven by setWorldProgress(p) (progress.ts). Until the page sends one, the
 * old setProgress(finished) is read as "the first N areas done plus a share
 * of the next", so the world looks the same either way. This module installs
 * after the dress-* modules (their tagged lamps exist) and before life.ts
 * (which finds the smoke sources this module adds).
 *
 * Draw calls: 4 in all, wherever the camera is, 5 while a done moment
 * plays, one more while a lit floating step is in view. Lantern posts (one
 * InstancedMesh, Lambert), lantern glass (one InstancedMesh, its own shader:
 * a flame core behind the glass, state per instance, the pulse and the run by
 * uniforms), halos (one Points call, additive, <= 64 CSS px; the steps' too),
 * pools of light on the ground (one InstancedMesh, additive; the next
 * lesson's is larger and pulses), the done moment's bloom, sparks and paper
 * lantern (one Points call, hidden otherwise), and the steps' lit runes (one
 * InstancedMesh on the steps' own instance matrices, hidden while none is lit
 * or next). Nothing allocates per frame; states are written to the instance
 * attributes only when progress changes. Two things follow motion owned by
 * blocks.ts, a few floats a frame: the bridge's lanterns its sway, and the
 * steps' halos the bobbing steps.
 */

// ── Tuning ───────────────────────────────────────────────────────────────────

/** The course's lesson counts per area, used until the page sends its own. */
const DEFAULT_LESSONS: readonly number[] = [8, 10, 22, 22, 25, 22, 22, 14];

/** Lantern sizes: the post's height in world units (a person is ~17, the Trail Hut's door 20). */
const LESSON_H = 8.5;
const PLACE_H = 11;
const BIG_H = 14;
/** Distance from the trail's centre line to a lantern (the trail's footprint is its line plus 4). */
const OFFSET = 10;
/**
 * A lantern stands no nearer any part of its piece's trail than its offset
 * less this (round 4). On the inside of a sharp bend both legs pull the spots
 * in, so two lanterns evenly spaced along the trail stood close: the trail's
 * new start below the falls (item 15d) turns 68 degrees round the pool's east
 * side and put Video Ads I's first two 12 apart, with 29 along the trail.
 */
const FOLD = 1;
/**
 * A place whose single lanterns would stand closer than this along its walk
 * hangs them in pairs on double posts instead, the posts evenly spaced, each
 * lantern still one lesson (round 4). Lovro called Fundamentals' lanterns
 * "basically next to each other" at 23 apart (Loom, 2:22). Round 4 paired AI
 * Ads & Content's 22 on its 372 of ground; since the second Loom it has no
 * lanterns (its lessons light the floating steps), and no place pairs.
 */
const PAIR_BELOW = 24;
/**
 * The rope bridge (second Loom, 5:06 to 5:22: "put these lanterns more spread
 * out and then some even on the railing of the bridge"): Creative Strategy's
 * walk runs on from the island's path over the bridge, its lanterns on posts
 * at the deck's edge, by the hand rope, on BRIDGE_SIDE (+1 right of the way
 * across), their arms reaching out over the rope so the lanterns hang outside
 * the railing, clear of the camera walking the deck (LOCKED). BRIDGE_RAIL from
 * the deck's centre line (the planks reach about 4.85, the hand rope 4.75),
 * none within BRIDGE_CLEAR of either end (the gate posts and beam).
 */
const BRIDGE_SIDE: 1 | -1 = -1;
const BRIDGE_RAIL = 4.4;
const BRIDGE_CLEAR = 16;
/** A bridge lantern's pool of light: on the planks this far in from its post, this wide (the deck is about 9.7). */
const BRIDGE_POOL_IN = 2.4;
const BRIDGE_POOL = 6.5;
/**
 * A lit floating step's halo (THE FLOATING STEPS): its size (lanterns: their
 * height x 1.15), set from the slab's middle this far toward the camera, so
 * the slab never hides it (the slab is about 19 from its middle to its rim).
 * It is for reading the steps from afar: it fades out as the camera comes
 * within STEP_HALO_NEAR of a step (gone at the first number, whole at the
 * second), where the step's own lit runes and rim carry it and a halo would
 * read as a bead stuck on the stone. Fix round 2: 300 to 600 (was 90 to 220,
 * which left a gold dot under each lit step's Y rune on the rise, where the
 * camera passes the steps 120 to 330 away); AI Ads & Content's stop and its
 * click-in see the steps from 738 and 790 on, so their halos stay whole there.
 */
const STEP_HALO = 24;
const STEP_HALO_PUSH = 22;
const STEP_HALO_NEAR: readonly [number, number] = [300, 600];
/** A walk is checked every this many units for where a lantern may stand. */
const WALK_STEP = 2;
/** No water drawn within this of a lantern (water.ts waterAt: what is drawn, the lake's mirror to its edge, the river, the pool). */
const DRY = 3;
/** A lantern's ground is no further than this above or below the trail's beside it: none down a cliff, none up a wall. */
const LEVEL = 8;
/**
 * The steepest ground a lantern stands on (rise over run, read off the drawn
 * grid over STEEP_E). Round 3: where the trail runs onto a face (the gully's
 * mouth on the Climb, the ground there 146 under the trail's own height) the
 * trail's ground is the face, so LEVEL alone let a lantern stand on it. The
 * steepest a lantern stood on before was 0.82; the Climb's face is 7 and more.
 */
const STEEP = 1.5;
const STEEP_E = 2;
/**
 * Degrees a lantern's top stays under the bottom edge of a view a walk stops
 * short of: the 30% cache's park view (Video Ads II's walk ends there, round
 * 3) and AI Ads & Content's stop (Static Ads' walk ends there, second Loom's
 * fix round).
 */
const PARK_EDGE = 2;
/** Room kept between a lantern and every footprint (rocks, buildings, props, bridges, the island's rills). */
const PAD = 1.6;
/** A place's first lantern stands this far along its walk from the landmark's trail point, or at the first spot after it where one may stand. */
const FIRST = 12;
/** A lantern on the ladder hangs this far beside its centre line (the rungs reach 5.5), its post set this far into the rock behind the face. */
const LADDER_SIDE = 8;
const WALL_IN = 1.1;
/** None on the ladder within this of a section's foot (the first: the gorge's floor) or top (a landing, the bench's lip). */
const WALL_FOOT = [12, 5, 5];
const WALL_TOP = 5;
/** Seconds the light takes to run along an area's lanterns. */
const RUN_S = 1.1;
/** Seconds of the pulse on the next lantern. */
const PULSE_S = 2.6;
/** Seconds the done moment's last beat (bloom, sparks, the paper lantern) plays after the lamp catches. */
const FX_S = 8.5;
/**
 * The lit look, settled on the daylight check (world-tests/shots/v6/progress/world/daylight):
 * the glass never drops under GLASS_FLOOR x the lamp colour even in the
 * bright afternoon (light.ts's lampGlow is 0.4 there, which reads as a
 * painted orange box at 200 units), and the halo is HALO_DAY in daylight,
 * growing to HALO_NIGHT once the light is down.
 */
const LOOK = {
  lamp: [2.3, 0.98, 0.26] as [number, number, number],
  glassFloor: 0.72,
  dark: [0.02, 0.018, 0.016] as [number, number, number],
  haloDay: 0.95,
  haloNight: 1.4,
  haloAlphaDay: 1.35,
  haloAlphaNight: 1.0,
  /**
   * The share of the halo's alpha the morning takes off (light.ts
   * state.morning; the morning's tune pass): at 1 the day's halo comes down
   * to the night's alpha. The morning's lamps are low, so the day's halo is
   * the one drawn, and over the morning's pale sky the floating steps' halos
   * bloomed into white suns, brighter at 07:30 than at dusk or at night.
   */
  haloMorningCut: 0.26,
  /** The pools of light on the ground (final pass): strength in daylight and once the light is down. */
  poolDay: 0.32,
  poolNight: 0.62,
};

/** The glass's night tint (light.ts NIGHT_LAMP_TINT), and a scratch colour for the blend. */
const _glassNight = new THREE.Color(...NIGHT_LAMP_TINT);
const _glassTint = new THREE.Color();

type V3 = [number, number, number];
/** What a lantern stands on: the terrain, the Sky Island's flat top, the Gate isle's, or the rope bridge's deck (it sways). */
type Ground = "land" | "island" | "gate" | "bridge";

/**
 * Where each place's lesson lanterns stand (map review 2026-10-15, item 12;
 * Lovro's Loom at 1:58, 4:45, 6:02 and 9:16): one lantern per lesson along the
 * trail the student walks from the place's landmark toward the next place's,
 * evenly spaced by distance along that trail, the first next to the landmark,
 * so watching k lessons lights the first k from the landmark on. A walk is
 * pieces in walking order; a piece with no ground (the ride down the falls,
 * the ladder, the floating steps) carries no lantern and does not count toward
 * the spacing, and each piece keeps its lanterns on one side of the trail.
 */
interface Piece {
  pts: V3[];
  /** What the lanterns stand on beside it; null: nothing (the ride down the falls, the floating steps). */
  ground: Ground | null;
  /** The side its lanterns stand on (+1 right of the walking direction), when one side is clearly better; else the side with more room. */
  side?: 1 | -1;
  /** Distance from the trail's centre line to a lantern here (default the walk's). */
  offset?: number;
  /**
   * The ladder up the north wall (map review 2026-10-15, round 2): its
   * lanterns hang on short iron arms from the rock beside it, `side` -1 its
   * west, `offset` from its centre line, their posts set in the rock. `pts`
   * is its climb, section by section (foot, top), and the climb's own length
   * counts toward the spacing, less the landings and the ends.
   */
  wall?: LadderSection[];
}
interface Walk {
  pieces: Piece[];
  /** Distance from the trail's centre line to a lantern (default OFFSET). */
  offset?: number;
  /** The last lantern stands at the walk's end (the last place, whose walk ends at its own landmark; Video Ads II and Static Ads, whose walks stop short of the next place's start); otherwise one spacing short of it. */
  toEnd?: boolean;
  /** No lanterns: the place's lessons light the floating steps (second Loom; AI Ads & Content). */
  steps?: boolean;
}

/** Plan distance from (x, z) to the nearest point of a polyline. */
function trailGap(pts: V3[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, , az] = pts[i];
    const dx = pts[i + 1][0] - ax;
    const dz = pts[i + 1][2] - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}

/** A polyline with `cut` units of plan length taken off its end. */
function shorten(pts: V3[], cut: number): V3[] {
  const out = pts.slice();
  let left = cut;
  while (out.length > 1 && left > 0) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (L > left) {
      const t = (L - left) / L;
      out[out.length - 1] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      break;
    }
    out.pop();
    left -= L;
  }
  return out;
}

/** Plan length along a polyline to its point nearest (x, z), and the polyline's whole plan length. */
function arcTo(pts: V3[], x: number, z: number): { s: number; len: number } {
  let len = 0;
  let s = 0;
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, , az] = pts[i];
    const dx = pts[i + 1][0] - ax;
    const dz = pts[i + 1][2] - az;
    const L = Math.hypot(dx, dz);
    const t = L > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (L * L))) : 0;
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) {
      best = d;
      s = len + t * L;
    }
    len += L;
  }
  return { s, len };
}

/** The point `s` (plan length) along a polyline, and the way it runs there: [x, z, tx, tz]. */
function along(pts: V3[], s: number): [number, number, number, number] {
  let left = s;
  for (let i = 0; i + 1 < pts.length; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dz = pts[i + 1][2] - pts[i][2];
    const L = Math.hypot(dx, dz);
    if (left <= L || i + 2 === pts.length) {
      const t = L > 0 ? Math.min(1, Math.max(0, left / L)) : 0;
      return [pts[i][0] + dx * t, pts[i][2] + dz * t, L > 0 ? dx / L : 1, L > 0 ? dz / L : 0];
    }
    left -= L;
  }
  return [pts[0][0], pts[0][2], 1, 0];
}

/** A camera a walk stops short of: position, compass bearing, pitch below the horizon (negative looks up), vertical lens. */
interface EdgeView {
  x: number;
  y: number;
  z: number;
  bearing: number;
  pitch: number;
  fov: number;
}

/**
 * How far along `pts` (plan length, of `len`) the trail runs before a lantern
 * on it would show in the view P: the 30% cache's park view (CHECKPOINT.park,
 * the view the discount panel opens on) for Video Ads II, AI Ads & Content's
 * stop for Static Ads. From the trail point under that camera onward, the last
 * spot where a lantern's top, on the higher of the trail's two sides, stays
 * PARK_EDGE degrees under the frame's bottom edge.
 */
function viewEdge(pts: V3[], ground: (x: number, z: number) => number, P: EdgeView): { cut: number; len: number } {
  const { s: s0, len } = arcTo(pts, P.x, P.z);
  const b = (P.bearing * Math.PI) / 180;
  const edge = Math.tan(((P.pitch + P.fov / 2 + PARK_EDGE) * Math.PI) / 180);
  let cut = s0;
  for (let s = s0; s <= len; s += WALK_STEP) {
    const [x, z, tx, tz] = along(pts, s);
    const top = Math.max(ground(x - tz * OFFSET, z + tx * OFFSET), ground(x + tz * OFFSET, z - tx * OFFSET)) + LESSON_H * 1.1;
    const ahead = (x - P.x) * Math.sin(b) - (z - P.z) * Math.cos(b);
    if (ahead > 0 && P.y - top < ahead * edge) break;
    cut = s;
  }
  return { cut, len };
}

function walks(ground: (x: number, z: number) => number): Walk[] {
  const pathPts = pathSlice;
  const at = (i: number): V3 => [PATH[i].x, PATH[i].y, PATH[i].z];
  const iSign = pathIdx(1300, 4170);
  const iCamp = pathIdx(440, 2720);
  const iLip = pathIdx(-112, 1782);
  const iFallsFoot = pathIdx(18, 1662);
  const iLogN = pathIdx(52, 1538);
  const iWallFoot = pathIdx(236, 1290);
  const iBenchW = pathIdx(400, 1236);
  const iHut = pathIdx(TRAIL_HUT.x, TRAIL_HUT.z - 18);
  const iGullyFoot = pathIdx(1436, 1146);
  const iGullyTop = pathIdx(1436, 1041);
  const iCache = pathIdx(CHECKPOINT.x, CHECKPOINT.z);
  const iJetty = pathIdx(1350, -440);
  const iTree = pathIdx(-700, -1110);
  // Video Ads I climbs the north wall by the ladder (layout LADDER, decision 68):
  // the gorge's floor from the wall's foot to the ladder's foot, the ladder,
  // and over the bench's lip onto the painted trail just west of the hut.
  const secs = ladderSections(ground);
  const foot = secs[0].a;
  const top = secs[secs.length - 1].b;
  const climb: V3[] = secs.flatMap((sc) => [[sc.a[0], sc.a[1], sc.a[2]] as V3, [sc.b[0], sc.b[1], sc.b[2]] as V3]);
  const a = PATH[iBenchW];
  const b = PATH[iHut];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const u = Math.min(1, Math.max(0, ((top[0] - a.x) * dx + (top[2] - a.z) * dz) / (dx * dx + dz * dz)));
  const onBench: V3 = [a.x + dx * u, a.y, a.z + dz * u];
  // Video Ads II's walk ends where the trail comes into the cache's park view
  // (round 3: its last lantern stood 93 in front of that camera, its post cut
  // by the frame's bottom edge in the view the discount panel opens on). Its
  // last lantern stands at that end, just under the frame (toEnd: the next
  // place's first stands 1,400 on, at the jetty, so no gap is kept for it).
  const toCache = pathPts(iGullyTop, iCache);
  const park = viewEdge(toCache, ground, CHECKPOINT.park);
  // Static Ads' walk ends the same way, where the trail comes into AI Ads &
  // Content's stop view (second Loom's fix round: its last three stood in the
  // Great Tree's clearing in the foreground of that stop, dark until Static
  // Ads was done, where AI Ads & Content has no lanterns and lights the
  // floating steps). Its last lantern stands at that end, just under the frame
  // (toEnd: AI Ads & Content puts down none, so no gap is kept for it).
  const toTree = pathPts(iJetty, iTree);
  const k6 = PLACES[5].trail;
  const clearing = viewEdge(toTree, ground, { x: TRAIL[k6][0], y: TRAIL[k6][1], z: TRAIL[k6][2], bearing: TRAIL_VIEW[k6].bearing, pitch: TRAIL_VIEW[k6].pitch, fov: TRAIL_FOV[k6] });
  return [
    // Introduction: from the signpost all the way to Base Camp, on the side they stood before.
    { pieces: [{ pts: pathPts(iSign, iCamp), ground: "land", side: -1 }] },
    // Fundamentals: from Base Camp up the hillside and along the stream's bank to the lip.
    { pieces: [{ pts: pathPts(iCamp, iLip), ground: "land" }] },
    // Video Ads I: from the falls' foot, where the trail starts (item 15d), round
    // the pool's east side, along the river and over the log (on the side away
    // from the pool and the river), up the talus (on the uphill side: the
    // handrail runs on the gorge's side from there), along the floor to the
    // ladder, and up the ladder, its lanterns on the rock at its west side
    // (round 2: the bench at its top is Video Ads II's, so a student in Video
    // Ads II sees their own lanterns round the hut; Lovro's Loom, 6:27 to 6:39).
    {
      pieces: [
        { pts: pathPts(iFallsFoot, iLogN), ground: "land", side: 1 },
        { pts: pathPts(iLogN, iWallFoot), ground: "land", side: -1 },
        { pts: [at(iWallFoot), [foot[0], foot[1], foot[2]]], ground: "land" },
        { pts: climb, ground: "land", wall: secs, side: -1, offset: LADDER_SIDE },
      ],
    },
    // Video Ads II: from the ladder's top along the bench past the hut and the
    // traverse (on the wall's side: the hut and the handrail are on the
    // gorge's side), up the gully (its stone steps are a path 9 wide, so the
    // lanterns stand further out) and over the saddle toward the 30% cache, where
    // Video Ads II ends (Lovro's Loom, 6:02 to 6:15: "from here all the way up
    // to here somewhere", his pointer on the hut, then on the cache), to where
    // the trail comes into the cache's park view.
    {
      pieces: [
        { pts: [onBench, at(iHut)], ground: "land", side: -1 },
        { pts: pathPts(iHut, iGullyFoot), ground: "land", side: -1 },
        { pts: pathPts(iGullyFoot, iGullyTop), ground: "land", offset: 15 },
        { pts: shorten(toCache, park.len - park.cut), ground: "land" },
      ],
      toEnd: true,
    },
    // Static Ads: from the jetty's foot along the lake's shore and into the
    // forest toward the Great Tree, to where the trail comes into AI Ads &
    // Content's stop view (the clearing's edge, fix round).
    { pieces: [{ pts: shorten(toTree, clearing.len - clearing.cut), ground: "land" }], toEnd: true },
    // AI Ads & Content: no lanterns (second Loom, 3:15 to 4:20: "removing them
    // and making the steps light up instead"); its lessons light the floating
    // steps (THE FLOATING STEPS). The walk is kept for where it runs: from the
    // Great Tree to the steps' foot, up the steps, the island's cove to the terrace.
    {
      pieces: [
        { pts: pathPts(iTree, iTree + 1), ground: "land" },
        { pts: [at(iTree + 1), [ISLAND_PATH[0][0], ISLAND_PATH[0][1], ISLAND_PATH[0][2]]], ground: null },
        { pts: ISLAND_PATH.slice(0, 3).map((p) => [p[0], p[1], p[2]] as V3), ground: "island" },
      ],
      steps: true,
    },
    // Creative Strategy: from the terrace by the observatory along the island's
    // path past the lookout bench to the rope bridge's head, and on over the
    // bridge on posts at its railing (second Loom, 5:06 to 5:22), to its far
    // end at the bounty isle (the isle itself carries none: it is the Ad
    // Bounty's checkpoint, item 18).
    {
      pieces: [
        { pts: ISLAND_PATH.slice(2).map((p) => [p[0], p[1], p[2]] as V3), ground: "island" },
        { pts: [[...BRIDGE.a] as V3, [...BRIDGE.b] as V3], ground: "bridge", side: BRIDGE_SIDE, offset: BRIDGE_RAIL },
      ],
    },
    // How To Land Clients, the last place: up the causeway from the dock toward
    // the arch, the first by the dock where the airship sets you down, the last
    // by the arch (short of its opening, where the causeway runs through it).
    { pieces: [{ pts: shorten(GATE_CAUSEWAY.map((q) => [q.x, q.y, q.z] as V3), 60), ground: "gate" }], offset: 15, toEnd: true },
  ];
}

/**
 * Where each place's door and path lamps look for their spots (WAKE below):
 * the stretches the lesson lanterns lined until 2026-10-15, kept so the lamps
 * stand where they stood. A polyline, where along it the stretch ends (`end`,
 * arc length from its start; negative counts back from its end), how far back
 * it begins (`len`), and the side the lesson lanterns stood on (+1 = right of
 * the walking direction); the lamps take the other side, where the stretch
 * passes closest to the landmark.
 */
interface Stretch {
  pts: V3[];
  end: number;
  len: number;
  side: 1 | -1;
  ground: Ground;
  /** Distance from the trail's centre line (default OFFSET; the causeway is paved 10 each side). */
  offset?: number;
}

/** PATH index nearest (x, z). */
function pathIdx(x: number, z: number): number {
  let best = Infinity;
  let bi = 0;
  PATH.forEach((q, i) => {
    const d = (q.x - x) ** 2 + (q.z - z) ** 2;
    if (d < best) {
      best = d;
      bi = i;
    }
  });
  return bi;
}
const pathSlice = (a: number, b: number): V3[] => PATH.slice(a, b + 1).map((q) => [q.x, q.y, q.z] as V3);

function stretches(): Stretch[] {
  const iDock = 0;
  const iCamp = pathIdx(440, 2720);
  const iStream = pathIdx(170, 2330);
  const iLip = pathIdx(-112, 1782);
  const iLog = pathIdx(62, 1608);
  const iBench = pathIdx(720, 1190);
  const iGully = pathIdx(1436, 1041);
  const iJetty = pathIdx(1350, -440);
  const iTree = pathIdx(-700, -1110);
  return [
    // a1: from the dock's foot past the signpost and on up the valley.
    { pts: pathSlice(iDock, iDock + 3), end: 640, len: 625, side: -1, ground: "land" },
    // a2: out of Base Camp up the hillside (its two lamps stand at LAMP_AT).
    { pts: pathSlice(iCamp, iStream), end: -14, len: 250, side: -1, ground: "land" },
    // a3: the stream's bank to the lip.
    { pts: pathSlice(iStream, iLip), end: -8, len: 520, side: 1, ground: "land" },
    // a4: the log, the talus and up the wall to the ledge, past the hut.
    { pts: pathSlice(iLog, iBench + 1), end: -150, len: 1e9, side: 1, ground: "land" },
    // a5: the gully's top, the saddle and the meadow down to the jetty's foot.
    { pts: pathSlice(iGully, iJetty), end: -12, len: 1e9, side: -1, ground: "land" },
    // a6: the lake's south shore into the forest, to the Great Tree.
    { pts: pathSlice(iJetty, iTree), end: -6, len: 1700, side: 1, ground: "land" },
    // a7: the island's one path, the cove to the lookout bench.
    { pts: ISLAND_PATH.slice(0, 6).map((p) => [p[0], p[1], p[2]] as V3), end: -14, len: 1e9, side: -1, ground: "island" },
    // a8: the causeway from the dock up to the arch.
    { pts: GATE_CAUSEWAY.map((q) => [q.x, q.y, q.z] as V3), end: -70, len: 1e9, side: 1, ground: "gate", offset: 15 },
  ];
}

/**
 * The waking steps per place: `at` is the share of the area's lessons
 * watched. "lamp" puts a lantern by the landmark (door, then path; placed
 * where the area's trail passes closest to it, on the other side from the
 * lesson lanterns); "big" is the place's own big lamp (the old per-place
 * progress lantern's spot) where the landmark has none of its own; "smoke" a
 * plume life.ts draws. Tagged lamps in other modules come on at their own
 * `at` (userData.wake).
 */
type WakeItem = { at: number; kind: "lamp"; slot: number } | { at: number; kind: "big"; x: number; z: number } | { at: number; kind: "smoke"; x: number; z: number; rise: number; plume: "column" | "chimney" };
const WAKE: ReadonlyArray<ReadonlyArray<WakeItem>> = [
  // a1: the campfire (blocks.ts, tagged) burns from progress 0 (log decision
  // 51: every student starts at 0, and the fire is the Landing's life), the
  // signpost's lamp (dress-shore.ts) at 100%. Second Loom (0:06 to 0:35): no
  // lamps at 25, 50 and 75%. They stood round the signpost with its first
  // lesson lantern, the same lantern, so five lights read as lessons bunched
  // there, and the 75% one stood in the camp's pack (its packs have no footprint).
  [],
  // a2: smoke from the tents' fire ring, lamps, the lookout's lamp (blocks.ts) at 100%.
  [
    // Final pass B (judge: next to the fire lookout the dense grey column read
    // as a forest fire; overdraw p99 6): a short, thin, faint wisp.
    { at: 0.25, kind: "smoke", x: 270, z: 2768, rise: 18, plume: "column" },
    { at: 0.5, kind: "lamp", slot: 0 },
    { at: 0.75, kind: "lamp", slot: 1 },
  ],
  // a3: lamps at the falls' foot by the pool's east side, beside where the
  // trail starts (item 15d), the big lamp at 100% (map review 2026-10-15: at
  // 2, 1575 it stood in the river where it leaves the pool).
  [
    { at: 0.25, kind: "lamp", slot: 0 },
    { at: 0.5, kind: "lamp", slot: 1 },
    { at: 0.75, kind: "lamp", slot: 2 },
    { at: 1, kind: "big", x: 16, z: 1615 },
  ],
  // a4: lamps on the ledge, the Trail Hut's lamp (blocks.ts, moved by dress-gorge.ts) at 100%.
  [
    { at: 0.25, kind: "lamp", slot: 0 },
    { at: 0.5, kind: "lamp", slot: 1 },
    { at: 0.75, kind: "lamp", slot: 2 },
  ],
  // a5: smoke from the boathouse chimney, lamps at the jetty's foot, the big lamp.
  [
    { at: 0.25, kind: "smoke", x: 1161.5, z: -437, rise: 60, plume: "chimney" },
    { at: 0.5, kind: "lamp", slot: 0 },
    { at: 0.75, kind: "lamp", slot: 1 },
    { at: 1, kind: "big", x: 1338, z: -452 },
  ],
  // a6: none (second Loom: no lanterns at AI Ads & Content; its light is the
  // floating steps'). Its done moment starts on the Great Tree (lampOf).
  [],
  // a7: none (second Loom's fix round 2; Lovro: "of course you're doing it
  // now"). Its 25, 50 and 75% lamps and its big lamp at the foot of the
  // terrace's steps were the lesson lantern a size up, 20 to 39 from its first
  // two lesson lanterns, so from its stop they read as lanterns bunched right
  // of the terrace (two on one post at progress 0), as at the Introduction.
  // Its done moment starts on the observatory (lampOf).
  [],
  // a8: lamps on the dock and the causeway, the arch's lanterns (dress-gate.ts) at 100%.
  [
    { at: 0.25, kind: "lamp", slot: 0 },
    { at: 0.5, kind: "lamp", slot: 1 },
    { at: 0.75, kind: "lamp", slot: 2 },
  ],
];
/** Where along its trail each place's door and path lamps stand, relative to the point nearest the landmark. */
const LAMP_SLOTS = [-8, 30, -46];
/**
 * Places whose stop cannot see their trail: the door and path lamps by
 * slot, at these points instead. a2: the trail passes behind the lookout's
 * knoll, so its lamps stand by the tents' fire ring and at the camp's back,
 * west of the keeper's cabin, both in the a2 frame (final pass: the second
 * stood 105 from the stop camera and filled the foreground). a3 (map review
 * 2026-10-15): at the falls' foot by the pool's east side, where the trail
 * and Video Ads I's lanterns start (item 15d: lamp 0 stands 10 west of the
 * trail's first point, across it from the lanterns); its old stretch, the
 * stream's bank to the lip, is Fundamentals' walk now, and its last stretch
 * is under the stream's water.
 */
const LAMP_AT: Partial<Record<number, ReadonlyArray<readonly [number, number]>>> = {
  1: [
    [296, 2792],
    [300, 2735],
  ],
  // Round 2: where they stood once moved off the painted trail (its footprint is the line plus 4).
  2: [
    [8, 1662],
    [-11, 1681],
    [4, 1682],
  ],
};

/** Seeded 0..1, stable across reloads. */
function rnd(i: number, s = 0): number {
  const v = Math.sin(i * 127.1 + s * 311.7 + 17.3) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * THE FLOATING STEPS (second Loom, 4:09 to 4:16: "22 lessons... I don't know
 * how many steps. So every two lessons, this can light up"): how many steps
 * are lit, from the bottom, with `done` of the place's `n` lessons watched.
 * The steps are fewer than the lessons and more than half of them (20 drawn
 * for 22 lessons), so the lessons spread evenly over the steps: step i lights
 * once done reaches (i + 1) x n / steps, rounded up, and the last step lights
 * with the last lesson. For 22 on 20, every lesson but the 1st and the 12th
 * lights one more.
 */
export function stepsLit(done: number, n: number, steps: number): number {
  if (!(n > 0) || !(steps > 0)) return 0;
  return Math.min(steps, Math.max(0, Math.floor((done * steps) / n + 1e-9)));
}

/** The step 0..4 a place has woken to (4 = every lesson watched). */
export function wakeStep(p: WorldProgress, k: number): number {
  const s = areaShare(p, k);
  return s >= 1 ? 4 : s >= 0.75 ? 3 : s >= 0.5 ? 2 : s >= 0.25 ? 1 : 0;
}

/**
 * The tag a module puts on something this module switches: userData.wake.
 * `place` 0..7, `at` the share of that area watched at which it comes on;
 * `set(on)` when switching it is more than its visibility.
 */
export interface WakeTag {
  place: number;
  at: number;
  set?: (on: boolean) => void;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * One lantern in its own frame (base at the origin, the lantern hanging off
 * +x): a slightly tapered post, a short arm with a hook, an iron cap and
 * base; the glass is a separate geometry at GLASS. Unit height 1 (scaled by
 * the lantern's height). Linear vertex colours, flat shaded.
 */
const GLASS = { x: 0.26, y: 0.66, w: 0.13, h: 0.18 };
function lanternGeometry(): { post: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const pos: number[] = [];
  const col: number[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Matrix4, c: readonly number[]) => {
    const src = g.index ? g.toNonIndexed() : g;
    const a = src.getAttribute("position");
    const v = new THREE.Vector3();
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      col.push(c[0], c[1], c[2]);
    }
    if (src !== g) src.dispose();
    g.dispose();
  };
  const M = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));
  const wood = [0.13, 0.09, 0.065];
  const iron = [0.035, 0.032, 0.03];
  // The post: a tapered square timber, 0.075 wide at the foot.
  add(new THREE.CylinderGeometry(0.03, 0.04, 0.84, 4, 1), M(0, 0.42, 0, 1, 1, 1, Math.PI / 4), wood);
  // The arm and its brace.
  add(new THREE.BoxGeometry(0.3, 0.035, 0.035), M(0.13, 0.82, 0, 1, 1, 1), wood);
  add(new THREE.BoxGeometry(0.14, 0.025, 0.025), M(0.06, 0.75, 0, 1, 1, 1).multiply(new THREE.Matrix4().makeRotationZ(0.75)), wood);
  // The hook, the lantern's cap (a little roof) and its base.
  add(new THREE.BoxGeometry(0.012, 0.05, 0.012), M(GLASS.x, 0.79, 0, 1, 1, 1), iron);
  add(new THREE.ConeGeometry(1, 1, 4), M(GLASS.x, GLASS.y + GLASS.h / 2 + 0.03, 0, GLASS.w * 0.95, 0.07, GLASS.w * 0.95, Math.PI / 4), iron);
  add(new THREE.BoxGeometry(1, 1, 1), M(GLASS.x, GLASS.y - GLASS.h / 2 - 0.012, 0, GLASS.w * 1.1, 0.025, GLASS.w * 1.1), iron);
  // Corner bars over the glass, so a dark lantern still reads as a lantern.
  // Final pass: 0.012 -> 0.022, so a lit lantern keeps a dark frame round its light up close.
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) add(new THREE.BoxGeometry(0.022, GLASS.h, 0.022), M(GLASS.x + (a * GLASS.w) / 2, GLASS.y, (b * GLASS.w) / 2, 1, 1, 1), iron);
  const post = new THREE.BufferGeometry();
  post.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  post.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  post.computeVertexNormals();
  const glass = new THREE.BoxGeometry(GLASS.w * 0.9, GLASS.h * 0.96, GLASS.w * 0.9);
  glass.translate(GLASS.x, GLASS.y, 0);
  glass.deleteAttribute("uv");
  glass.deleteAttribute("normal");
  return { post, glass };
}

// ── Shaders ──────────────────────────────────────────────────────────────────

/** Shared by the glass and the halos: how lit an instance is right now, and the run's flare. */
const STATE_GLSL = /* glsl */ `
  attribute float aState;  // 0 dark, 1 lit, 2 the next lesson (pulses)
  attribute vec2 aRun;     // area, order along it (0..1; the place lamps 1.05)
  uniform float uTime;
  uniform float uPulse;    // 1 = pulse, 0 = steady (reduced motion)
  uniform float uRunArea;  // the area the light is running along, -1 for none
  uniform float uRunT;     // 0..1 through the run, > 1 after it
  float litNow(out float flare) {
    flare = 0.0;
    // The next lesson breathes past the lit ones at its peak (final pass: 0.4-1.0 read as a dim lit lantern).
    float on = aState > 1.5 ? mix(0.8, 0.35 + 0.95 * (0.5 + 0.5 * sin(uTime * ${((2 * Math.PI) / PULSE_S).toFixed(4)})), uPulse) : aState;
    if (abs(aRun.x - uRunArea) < 0.5) {
      // Lesson lanterns: the front passes each in turn. Place lamps (order > 1): they catch as the run ends.
      float d = aRun.y > 1.0 ? (uRunT - 1.05) / 0.22 : (uRunT * 1.2 - aRun.y) / 0.11;
      // Final pass: behind the front each lantern keeps an afterglow, so the
      // run reads as a light travelling and leaving the line brighter.
      float f = d < 0.0 ? exp(-d * d) : max(exp(-d * d), 0.4 * exp(-d * 0.1));
      flare = f * (1.0 - smoothstep(1.3, 1.65, uRunT));
    }
    return on;
  }
`;

function glassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "ProgressLanternGlass",
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uPulse: { value: 1 },
        uRunArea: { value: -1 },
        uRunT: { value: 2 },
        uLit: { value: new THREE.Color(...LOOK.lamp) },
        uDark: { value: new THREE.Color(...LOOK.dark) },
        uLevel: { value: 1 },
      },
    ]),
    vertexShader: /* glsl */ `
      ${STATE_GLSL}
      varying float vOn; varying float vFlare; varying vec3 vLocal;
      #include <fog_pars_vertex>
      void main() {
        float flare;
        vOn = litNow(flare);
        vFlare = flare;
        vLocal = position;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLit; uniform vec3 uDark; uniform float uLevel;
      varying float vOn; varying float vFlare; varying vec3 vLocal;
      #include <fog_pars_fragment>
      void main() {
        // Final pass: a flame behind glass, so a lit lantern reads as a LIGHT
        // in the bright afternoon (it read as a cream box): a hot core low in
        // the middle of each face, falling off to deep amber at the frame.
        vec3 q = (vLocal - vec3(${GLASS.x.toFixed(3)}, ${GLASS.y.toFixed(3)}, 0.0)) / vec3(${(GLASS.w * 0.45).toFixed(4)}, ${(GLASS.h * 0.48).toFixed(4)}, ${(GLASS.w * 0.45).toFixed(4)});
        float hz = min(abs(q.x), abs(q.z));
        float vy = q.y + 0.18;
        float core = exp(-(hz * hz * 2.6 + vy * vy * 2.2));
        vec3 edge = uLit * vec3(0.46, 0.36, 0.3);
        vec3 hot = uLit * vec3(1.18, 1.62, 2.5);
        vec3 lit = mix(edge, hot, core) * uLevel * (1.0 + 1.6 * vFlare);
        gl_FragColor = vec4(mix(uDark, lit, clamp(vOn + vFlare, 0.0, 1.5)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
  });
}

function haloMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "ProgressLanternHalo",
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uPulse: { value: 1 },
        uRunArea: { value: -1 },
        uRunT: { value: 2 },
        uScale: { value: 600 },
        uMaxPx: { value: 96 },
        uMinPx: { value: 20 },
        uSize: { value: LOOK.haloDay },
        uAlpha: { value: LOOK.haloAlphaDay },
        uColor: { value: new THREE.Color(1.0, 0.6, 0.27) },
      },
    ]),
    vertexShader: /* glsl */ `
      ${STATE_GLSL}
      attribute float aSize;
      uniform float uScale; uniform float uMaxPx; uniform float uMinPx; uniform float uSize;
      varying float vA;
      #include <fog_pars_vertex>
      void main() {
        float flare;
        float on = litNow(flare);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float s = aSize * uSize * (0.75 + 0.25 * on) * (1.0 + 1.3 * flare) * (aState > 1.5 ? 1.4 : 1.0);
        // Final pass: a light seen from afar keeps a glow of at least uMinPx
        // (it shrank to a few pixels at 400+ and the lit trail vanished).
        gl_PointSize = on + flare > 0.01 ? clamp(max(s * uScale / -mvPosition.z, uMinPx * min(1.0, on + flare)), 0.0, uMaxPx) : 0.0;
        vA = clamp(on + flare, 0.0, 1.6);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha;
      varying float vA;
      #include <fog_pars_fragment>
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = (exp(-r * r * 4.0) * 0.75 + exp(-r * r * 20.0) * 0.8) * (1.0 - smoothstep(0.75, 1.0, r)) * vA * uAlpha;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a, a);
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
          #else
            float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
          #endif
          // A light shows through haze better than a surface does.
          gl_FragColor *= 1.0 - fogFactor * 0.6;
        #endif
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
}

/**
 * Final pass: a pool of warm light on the ground under every lit lantern (the
 * lit trail reads along the route, not only as dots of glass), and a larger
 * pulsing pool under the next lesson's lantern, the one the eye should find.
 * One instanced quad per lantern, sharing the glass's state attributes.
 */
function poolMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "ProgressLanternPool",
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uPulse: { value: 1 },
        uRunArea: { value: -1 },
        uRunT: { value: 2 },
        uAlpha: { value: 0.35 },
        uNext: { value: 1 },
        uColor: { value: new THREE.Color(1.0, 0.55, 0.22) },
      },
    ]),
    vertexShader: /* glsl */ `
      ${STATE_GLSL}
      uniform float uNext;
      varying vec2 vUv; varying float vA;
      #include <fog_pars_vertex>
      void main() {
        float flare;
        float on = litNow(flare);
        float next = aState > 1.5 ? 1.0 : 0.0;
        float show = on + flare > 0.01 ? 1.0 : 0.0;
        float beat = 0.5 + 0.5 * sin(uTime * ${((2 * Math.PI) / PULSE_S).toFixed(4)});
        float grow = 1.0 + next * (0.55 + 0.35 * beat * uPulse) + 0.45 * flare;
        vUv = uv;
        vA = clamp(on + flare, 0.0, 1.6) * (1.0 + next * uNext * (0.8 + 0.6 * beat * uPulse));
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position * grow * show, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha;
      varying vec2 vUv; varying float vA;
      #include <fog_pars_fragment>
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = (exp(-r * r * 3.2) * 0.75 + exp(-r * r * 14.0) * 0.35) * (1.0 - smoothstep(0.7, 1.0, r)) * vA * uAlpha;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a, a);
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
          #else
            float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
          #endif
          gl_FragColor *= 1.0 - fogFactor;
        #endif
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
}

/**
 * Second Loom, THE FLOATING STEPS: a lit step's runes and the chamfer round
 * its top (its rim), laid over the carved ones (dress-lakeforest.ts) on the
 * steps' own instance matrices. A lit step's runes take the lanterns' warm
 * gold and its rim their amber, brightest at the top edge, at the lamp
 * level; the next step's runes pulse between their carved glow and that
 * warm (its rim stays stone); the done moment's run flares them in turn up
 * the stair; all by the glass's state (STATE_GLSL). A dark step draws nothing
 * here, so its carved runes show as they always did. Opaque and pulled toward
 * the camera (polygonOffset), so it wins over the carved faces it lies on
 * whichever draws first.
 * Fix round (the light rule): the pulse's dark end is each part's carved glow
 * (CARVED_GLOW) at the live magic level, as dress-lakeforest.ts drives the
 * carved runes (uMagic, light.ts's magicGlow up to 0.95), so the next step
 * matches its neighbours at every hour. It was one fixed teal, right at a6's.
 */
const CARVED_GLOW = {
  /** The glyphs on the slab's sides: glow(CYAN, 0.42). */
  side: [0.21, 0.378, 0.441],
  /** The ring on its top: glow(TEAL, 0.7). */
  top: [0.175, 0.588, 0.546],
} as const;
function runeMaterial(): THREE.ShaderMaterial {
  const vec = (c: readonly number[]) => `vec3(${c.map((v) => v.toFixed(3)).join(", ")})`;
  return new THREE.ShaderMaterial({
    name: "ProgressStepRunes",
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uPulse: { value: 1 },
        uRunArea: { value: -1 },
        uRunT: { value: 2 },
        uLit: { value: new THREE.Color(...LOOK.lamp) },
        uMagic: { value: 0.9 },
        uLevel: { value: 1 },
      },
    ]),
    vertexShader: /* glsl */ `
      ${STATE_GLSL}
      attribute float aKind;   // 0 a rune, 1 the rim
      varying float vOn; varying float vFlare; varying float vRim; varying float vTop;
      #include <fog_pars_vertex>
      void main() {
        float flare;
        vOn = litNow(flare);
        vFlare = flare;
        // The rim: 1 at the top's edge (y 3.5), 0 where the chamfer meets the sides (y 2.3).
        vRim = aKind > 0.5 ? clamp((position.y - 2.3) / 1.2, 0.0, 1.0) : -1.0;
        // The ring on the top (y 3.66); the glyphs on the sides stand under y 1.2.
        vTop = aKind < 0.5 && position.y > 3.0 ? 1.0 : 0.0;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        // A dark step (and the next one's rim): every vertex off the far plane, so nothing is drawn.
        if (vOn + vFlare < 0.004 || (aKind > 0.5 && aState > 1.5 && flare < 0.004)) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLit; uniform float uMagic; uniform float uLevel;
      varying float vOn; varying float vFlare; varying float vRim; varying float vTop;
      #include <fog_pars_fragment>
      void main() {
        // Runes: the glass's warm gold, short of its hot core (which reads white on the teal). The rim: its amber, fading down the chamfer.
        vec3 lit = vRim < 0.0 ? uLit * vec3(0.92, 1.05, 1.25) : uLit * vec3(0.78, 0.74, 0.8) * (0.4 + 0.6 * vRim);
        lit *= uLevel * (1.0 + 1.6 * vFlare);
        // The dark end: the part's carved glow at the live magic level.
        vec3 dark = mix(${vec(CARVED_GLOW.side)}, ${vec(CARVED_GLOW.top)}, vTop) * uMagic;
        gl_FragColor = vec4(mix(dark, lit, clamp(vOn + vFlare, 0.0, 1.5)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
}

/**
 * Final pass, the area-done moment's last beat (one Points call, drawn only
 * while it plays): the landmark lamp catches with a warm bloom, a few sparks
 * jump off it, and one paper lantern lifts from it and drifts up into the
 * sky over about 7 seconds. Point 0 the bloom, 1 the paper lantern, the rest
 * sparks. uT is seconds since the lamp caught; sizes scale with uK (the
 * camera's distance at the moment, so it reads the same at every stop).
 */
const FX_SPARKS = 18;
/**
 * Final pass B (judge: the done moment was too small to read at the stop, the
 * one paper lantern a 6 px dot): five paper lanterns, about 3x bigger, lift off
 * one after another and rise through the frame over about 5 seconds.
 */
const FX_LANTERNS = 5;
/** The side of the stop's frame the lanterns drift to (-1 left, +1 right): away from the done card (cardPlace.ts CARD_HINTS). a8: 0, its old rise in the arch. */
const FX_SIDE: readonly number[] = [-1, -1, -1, -1, -1, 1, -1, 0];
/** No lantern starts nearer the stop camera than this (world units). */
const FX_NEAR = 90;
/** A place with no lamp of its own: its done moment starts this far in front of its landmark's face (lampOf). */
const FX_FRONT = 3;
/** cos 12 degrees: a lamp further off the stop's line of sight hands the lanterns' start to its landmark. */
const FX_OFF_AXIS = Math.cos((12 * Math.PI) / 180);
/**
 * Final pass F (judge: near the camera the lanterns read as big blank cream
 * boxes; additive paper over a bright sky adds up to cream). Each is now a
 * paper sky lantern: a darker paper top, an orange-amber body lit from the
 * flame at its open foot (brightest there), a soft warm halo and a gentle
 * sway. The paper is laid OVER the scene (premultiplied: colour, alpha) and
 * the halo, the bloom and the sparks still ADD (alpha 0), so one blend mode
 * serves all three. The bloom and the sparks write exactly what the additive
 * blend wrote before (colour times alpha squared).
 * Where they fly is set per place in celebrate(): from the place's stop
 * camera, behind the landmark, drifting away from the done card's side.
 */
function fxMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "ProgressDoneFx",
    uniforms: {
      uOrigin: { value: new THREE.Vector3() },
      uT: { value: -1 },
      uK: { value: 1 },
      uScale: { value: 600 },
      uMaxPx: { value: 120 },
      // The lanterns' flight (in uK units; celebrate() sets them): the spawn's
      // centre off the lamp, the side they drift to (and spread along), the
      // ring round the centre, the drift per second, and the size (base, extra).
      uSpawn: { value: new THREE.Vector3() },
      uSide: { value: new THREE.Vector3() },
      uSpread: { value: 0 },
      uRing: { value: 8 },
      uDrift: { value: new THREE.Vector3(1.3, 0, 0.4) },
      uSize: { value: new THREE.Vector2(7, 3) },
    },
    vertexShader: /* glsl */ `
      attribute float aKind; attribute float aSeed;
      uniform vec3 uOrigin; uniform float uT; uniform float uK; uniform float uScale; uniform float uMaxPx;
      uniform vec3 uSpawn; uniform vec3 uSide; uniform float uSpread; uniform float uRing; uniform vec3 uDrift; uniform vec2 uSize;
      varying float vA; varying float vKind; varying float vRot; varying float vFlick;
      void main() {
        vec3 p = uOrigin;
        float size = 0.0;
        float a = 0.0;
        vRot = 0.0;
        vFlick = 1.0;
        if (uT >= 0.0) {
          if (aKind < 0.5) {
            // The bloom: swells as the lamp catches, settles to a glow, gone by 3.4 s.
            a = smoothstep(0.0, 0.16, uT) * (0.3 + 0.7 * exp(-uT * 1.5)) * (1.0 - smoothstep(2.4, 3.4, uT));
            size = uK * (20.0 + 16.0 * exp(-uT * 2.2));
          } else if (aKind < 1.5) {
            // The paper lanterns: each lifts off in turn from behind the landmark, drifts away from the card.
            float t = max(0.0, uT - 0.35 - fract(aSeed * 5.3) * 1.8);
            float ang = aSeed * 6.2832;
            float lane = fract(aSeed * 7.7) - 0.5;
            vec3 o = uSpawn + uSide * (lane * uSpread) + vec3(cos(ang) * uRing, 0.5 + fract(aSeed * 9.1) * 3.0, sin(ang) * uRing);
            vec3 sway = vec3(sin(t * 0.9 + ang) * 1.8, 0.0, cos(t * 0.7 + ang) * 1.3);
            p += uK * (o + sway + uDrift * t + vec3(0.0, t * 7.5 + 0.35 * t * t, 0.0));
            a = smoothstep(0.0, 0.5, t) * (1.0 - smoothstep(4.5, 6.5, t));
            size = uK * (uSize.x + fract(aSeed * 3.3) * uSize.y);
            // A gentle rock with the sway, and the flame's flicker.
            vRot = sin(t * 0.9 + ang + 1.2) * 0.14;
            vFlick = 0.9 + 0.1 * sin(uT * 11.0 + aSeed * 40.0) * sin(uT * 7.3 + aSeed * 13.0);
          } else {
            // Sparks: jump up and out, fall back a little, gone in about 1.5 s.
            float t = uT - fract(aSeed * 3.7) * 0.2;
            float ang = aSeed * 6.2832;
            float spd = 0.55 + fract(aSeed * 7.31);
            p += uK * vec3(cos(ang) * t * 2.6 * spd, t * 11.0 * spd - 4.0 * t * t, sin(ang) * t * 2.6 * spd);
            a = step(0.0, t) * (1.0 - smoothstep(0.5, 1.5, t));
            size = uK * 1.3;
          }
        }
        vA = a;
        vKind = aKind;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // A lantern is never more than about 70 css px across (the sprite; its body is half that).
        float cap = aKind > 0.5 && aKind < 1.5 ? uMaxPx * 0.58 : uMaxPx;
        gl_PointSize = a > 0.003 ? clamp(size * uScale / -mv.z, aKind > 1.5 ? 2.5 : 0.0, cap) : 0.0;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA; varying float vKind; varying float vRot; varying float vFlick;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (vKind > 0.5 && vKind < 1.5) {
          // A paper sky lantern, in its own frame (rocked by vRot). gl_PointCoord's y
          // runs down: the top at q.y -0.30, the open foot at 0.22. Wider at the
          // shoulders, round on top, square at the foot's wire hoop.
          float cr = cos(vRot);
          float sr = sin(vRot);
          vec2 q = vec2(cr * c.x - sr * c.y, sr * c.x + cr * c.y);
          float g = clamp((q.y + 0.30) / 0.52, 0.0, 1.0);
          float hw = mix(0.18, 0.13, g);
          float rad = mix(0.1, 0.02, step(0.5, g));
          vec2 b = vec2(abs(q.x) - (hw - rad), abs(q.y + 0.04) - (0.26 - rad));
          float sd = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - rad;
          float aa = max(fwidth(sd), 0.004);
          float body = 1.0 - smoothstep(-aa, aa, sd);
          // The paper: darker at the top, amber toward the foot, lit from the flame inside it.
          float u = clamp(q.x / hw, -1.0, 1.0);
          float cyl = 0.74 + 0.26 * (1.0 - u * u);
          float seam = 1.0 - 0.16 * exp(-pow((abs(u) - 0.5) * 8.0, 2.0));
          vec2 fq = q - vec2(0.0, 0.16);
          float core = exp(-dot(fq, fq) * 36.0);
          vec3 paper = mix(vec3(0.56, 0.18, 0.06), vec3(1.0, 0.5, 0.13), pow(g, 1.3)) * cyl * seam;
          paper = paper * (0.8 + 0.2 * vFlick) + vec3(1.0, 0.74, 0.36) * core * 0.8 * vFlick;
          // The wire hoop round the open foot.
          paper = mix(paper, vec3(0.24, 0.08, 0.03), smoothstep(0.19, 0.215, q.y) * 0.75);
          // A soft warm halo round it, strongest at the foot, gone before the sprite's edge.
          vec2 hq = q - vec2(0.0, 0.07);
          float halo = exp(-dot(hq, hq) * 9.0) * 0.4 * vFlick * (1.0 - smoothstep(0.34, 0.5, length(c)));
          vec3 col = paper * body + vec3(1.0, 0.45, 0.12) * halo * (1.0 - body);
          if (max(body, halo) * vA < 0.003) discard;
          gl_FragColor = vec4(col * vA, body * vA);
          return;
        }
        vec3 col;
        float a;
        if (vKind < 0.5) {
          a = min(1.0, exp(-r * r * 3.0) * 1.35) * (1.0 - smoothstep(0.8, 1.0, r));
          col = mix(vec3(1.0, 0.46, 0.16), vec3(1.0, 0.8, 0.5), exp(-r * r * 12.0));
        } else {
          a = exp(-r * r * 4.0);
          col = vec3(1.0, 0.66, 0.3) * 1.4;
        }
        a *= vA;
        if (a < 0.003) discard;
        // Added: what the additive blend (source alpha, one) wrote before.
        gl_FragColor = vec4(col * a * a, 0.0);
      }`,
    transparent: true,
    depthWrite: false,
    // Premultiplied over: the paper covers, alpha 0 adds. The target's alpha is left as it was.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

// ── Install ──────────────────────────────────────────────────────────────────

interface Lantern {
  x: number;
  y: number;
  z: number;
  h: number;
  yaw: number;
  area: number;
  /** Lesson lanterns: 0-based lesson index; place lamps: -1. */
  lesson: number;
  /** Place lamps: the share at which they come on. */
  at: number;
  /** 0..1 along the area, for the run (place lamps 1.05). */
  order: number;
  /** Hung on the rock beside the ladder: where its pool of light lies on the face, and the face's normal. */
  face?: [number, number, number, number, number, number];
  /** A lamp set by hand (LAMP_AT, WAKE's big lamps): the spot as written. */
  set?: [number, number];
  /** A lesson lantern on a double post (PAIR_BELOW): the post's number in its place; both its lanterns stand true on it. */
  post?: number;
  /**
   * On the rope bridge: its foot and turn in the bridge's own frame (blocks.ts
   * RopeBridge_Sway: x along a -> b in plan from a, y up from a's height, z to
   * the right of the way across), so it sways with the deck; and where its
   * pool lies on the planks, with the deck's up there. x, y, z and yaw above
   * are the same with the bridge at rest.
   */
  bridge?: { x: number; y: number; z: number; yaw: number; pool: [number, number, number, number, number, number] };
}

export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = performance.now();
  const reduced = !!ctx.reducedMotion;
  const scene = ctx.scene;
  const root = new THREE.Group();
  root.name = "ProgressWorld";
  (ctx.root ?? scene).add(root);
  const disposables: { dispose(): void }[] = [];
  const track = <X extends { dispose(): void }>(x: X): X => {
    disposables.push(x);
    return x;
  };

  const groundAt = (ground: Ground, x: number, z: number) => {
    if (ground === "island") return WORLD.islandLevel;
    if (ground === "gate") return WORLD.gateIsle.y;
    if (ground !== "bridge") return groundY(x, z);
    // The bridge's deck at rest, where (x, z) is along it.
    const dx = BRIDGE.b[0] - BRIDGE.a[0];
    const dz = BRIDGE.b[2] - BRIDGE.a[2];
    return bridgeDeckAt(((x - BRIDGE.a[0]) * dx + (z - BRIDGE.a[2]) * dz) / (dx * dx + dz * dz));
  };
  /**
   * May a lantern stand at (x, z)? Clear of every footprint by `pad`; on land
   * also its ground within `level` of the trail's beside it (`ref`), no
   * water drawn within `dry` of it (water.ts waterAt: what is drawn, the lake's
   * mirror to its edge, the river, the stream, the pool, the sea), and its
   * ground no steeper than `steep` (round 3: none on a face).
   */
  const spotOk = (ground: Ground, x: number, z: number, ref: number, level = LEVEL, dry = DRY, pad = PAD, steep = STEEP): boolean => {
    if (blocked(x, z, pad)) return false;
    if (ground !== "land") return true;
    const g = groundY(x, z);
    if (Math.abs(g - ref) > level) return false;
    if (waterAt(x, z, groundY, dry)) return false;
    return Math.hypot(groundY(x + STEEP_E, z) - g, groundY(x, z + STEEP_E) - g) <= steep * STEEP_E;
  };

  // ── The walks, checked once: where along each a lantern may stand ──
  const WALKS = walks(groundY);
  /** A ground piece of a walk: its line, its length, where it starts along the walk's ground, its side, and the stretches of it a lantern may stand beside. */
  interface CheckedPiece {
    pts: V3[];
    arcs: number[];
    len: number;
    /** Length of the walk's ground pieces before this one. */
    base: number;
    ground: Ground;
    /** 1: right of the walking direction, -1: left. */
    side: 1 | -1;
    /** Distance from the trail's centre line to its lanterns. */
    offset: number;
    /** Where along it (from its start) a lantern may stand, as [from, to] runs. */
    runs: [number, number][];
    /** The ladder: its sections (pts is its climb, foot and top of each, and arcs run along it in 3D). */
    wall?: LadderSection[];
  }
  /**
   * The rock as drawn round the ladder: the falls patch's own grid, read off
   * its mesh ("Terrain:falls", scene.ts; the terrain is in before any module
   * installs), each cell cut on the b-c diagonal as buildTerrainGeometry cuts
   * it. groundY reads terrainHeight inside the patch, and on the near vertical
   * face beside the ladder the drawn grid (8.3 apart) stood up to 36 units of
   * height off it, enough to bury a lantern's glass. groundY outside it.
   */
  const fallsGrid = (() => {
    const m = (ctx.root ?? scene).getObjectByName("Terrain:falls") as THREE.Mesh | undefined;
    const pos = m?.geometry.getAttribute("position");
    if (!pos || pos.count < 9) return null;
    const x0 = pos.getX(0);
    const z0 = pos.getZ(0);
    let vx = 1;
    while (vx < pos.count && Math.abs(pos.getZ(vx) - z0) < 1e-6) vx++;
    const vz = pos.count / vx;
    if (vx < 3 || !Number.isInteger(vz) || vz < 3) return null;
    return { pos, x0, z0, vx, vz, sx: (pos.getX(vx - 1) - x0) / (vx - 1), sz: (pos.getZ(pos.count - 1) - z0) / (vz - 1) };
  })();
  const rockY = (x: number, z: number): number => {
    const g = fallsGrid;
    if (!g) return groundY(x, z);
    const fi = (x - g.x0) / g.sx;
    const fj = (z - g.z0) / g.sz;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= g.vx - 1 || j >= g.vz - 1) return groundY(x, z);
    const u = fi - i;
    const v = fj - j;
    const h = (ii: number, jj: number) => g.pos.getY(jj * g.vx + ii);
    if (u + v <= 1) {
      const ha = h(i, j);
      return ha + (h(i + 1, j) - ha) * u + (h(i, j + 1) - ha) * v;
    }
    const he = h(i + 1, j + 1);
    return he + (h(i, j + 1) - he) * (1 - u) + (h(i + 1, j) - he) * (1 - v);
  };
  /**
   * A lantern hung from the rock beside the ladder, s along its climb (map
   * review 2026-10-15, round 2): its glass at the climb's height there,
   * `lateral` to the `side` of the ladder's centre line, its post set WALL_IN
   * into the rock behind the face and its arm reaching out over the face.
   * Null on a landing or where no face is found; `ok` false where the rock
   * cannot take one (the post would show, or the glass would touch the rock).
   */
  const bracketAt = (pc: { pts: V3[]; arcs: number[]; wall?: LadderSection[] }, s: number, side: number, lateral: number, h: number) => {
    if (!pc.wall) return null;
    let i = 0;
    while (i < pc.arcs.length - 2 && pc.arcs[i + 1] < s) i++;
    if (i % 2) return null;
    const sec = pc.wall[i / 2];
    const a = pc.pts[i];
    const b = pc.pts[i + 1];
    const t = Math.min(1, Math.max(0, (s - pc.arcs[i]) / (pc.arcs[i + 1] - pc.arcs[i] || 1)));
    const [ex, ez] = sec.east;
    const [ox, oz] = sec.out;
    const px = a[0] + (b[0] - a[0]) * t + ex * side * lateral;
    const pz = a[2] + (b[2] - a[2]) * t + ez * side * lateral;
    const yc = a[1] + (b[1] - a[1]) * t;
    // The face at the glass's height, as drawn: how far behind (px, pz) the rock rises past it.
    const rock = (d: number) => rockY(px - ox * d, pz - oz * d) - yc;
    let lo = -20;
    let hi = 30;
    if (rock(lo) >= 0 || rock(hi) <= 0) return null;
    for (let it = 0; it < 32; it++) {
      const m = (lo + hi) / 2;
      if (rock(m) < 0) lo = m;
      else hi = m;
    }
    const face = (lo + hi) / 2;
    const fx = px - ox * (face + WALL_IN);
    const fz = pz - oz * (face + WALL_IN);
    const footY = yc - GLASS.y * h;
    // The post in the rock to above its top; the glass's back clear of the rock to below its foot.
    const back = (GLASS.x - (GLASS.w * 1.1) / 2) * h;
    const ok = rockY(fx, fz) >= footY + 0.88 * h && rockY(fx + ox * back, fz + oz * back) <= yc - (GLASS.h * h) / 2 - 0.3;
    // The face's normal, square to the ladder (dress-gorge.ts stands the rails off it the same way): east x up the ladder.
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    let nx = -ez * dy;
    let ny = ez * dx - ex * dz;
    let nz = ex * dy;
    const nl = Math.hypot(nx, ny, nz) || 1;
    const sg = nx * ox + nz * oz < 0 ? -1 : 1;
    nx = (nx / nl) * sg;
    ny = (ny / nl) * sg;
    nz = (nz / nl) * sg;
    const wx = px - ox * face;
    const wz = pz - oz * face;
    return {
      ok,
      x: fx,
      y: footY,
      z: fz,
      // The arm reaches out of the face.
      yaw: Math.atan2(-oz, ox),
      // The pool of light lies on the rock behind the glass.
      face: [wx + nx * 0.6, yc - 1 + ny * 0.6, wz + nz * 0.6, nx, ny, nz] as [number, number, number, number, number, number],
    };
  };
  /** Where along piece `pc` (from its start) the trail is, and the way it goes (smoothed over a few units, so a lantern at a bend still faces the trail). */
  const frameAt = (pts: V3[], arcs: number[], len: number, s: number) => {
    const pos = (t: number): [number, number] => {
      const c = Math.min(len, Math.max(0, t));
      let i = 0;
      while (i < arcs.length - 2 && arcs[i + 1] < c) i++;
      const L = arcs[i + 1] - arcs[i] || 1;
      const u = (c - arcs[i]) / L;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][2] + (pts[i + 1][2] - pts[i][2]) * u];
    };
    const [x, z] = pos(s);
    const [ax, az] = pos(s - 4);
    const [bx, bz] = pos(s + 4);
    const tl = Math.hypot(bx - ax, bz - az) || 1;
    return { x, z, tx: (bx - ax) / tl, tz: (bz - az) / tl };
  };
  /** The spot `side` of the trail at s along a piece. Right of the walking direction (y up): walking (tx, tz) x up = (-tz, tx). */
  const spotAt = (pc: { pts: V3[]; arcs: number[]; len: number }, s: number, side: number, off: number) => {
    const f = frameAt(pc.pts, pc.arcs, pc.len, s);
    return { x: f.x - f.tz * off * side, z: f.z + f.tx * off * side, tx: f.tx, tz: f.tz };
  };
  /** A walk's ground pieces, each checked every WALK_STEP on both sides; strict, or relaxed for a walk with too little room. */
  const checkWalk = (w: Walk, relaxed: boolean): CheckedPiece[] => {
    const out: CheckedPiece[] = [];
    let base = 0;
    for (const p of w.pieces) {
      if (!p.ground) continue;
      const ground = p.ground;
      const off = p.offset ?? w.offset ?? OFFSET;
      if (ground === "bridge") {
        // The rope bridge: its deck is clear from end to end; none by the gate posts at either end.
        const arcs = [0];
        for (let i = 1; i < p.pts.length; i++) arcs.push(arcs[i - 1] + Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][2] - p.pts[i - 1][2]));
        const len = arcs[arcs.length - 1];
        const runs: [number, number][] = len > 2 * BRIDGE_CLEAR ? [[BRIDGE_CLEAR, len - BRIDGE_CLEAR]] : [];
        out.push({ pts: p.pts, arcs, len, base, ground, side: p.side ?? 1, offset: off, runs });
        base += len;
        continue;
      }
      if (p.wall) {
        // The ladder: along its climb in 3D, on its sections only, clear of each section's foot and top.
        const arcs = [0];
        for (let i = 1; i < p.pts.length; i++) arcs.push(arcs[i - 1] + Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1], p.pts[i][2] - p.pts[i - 1][2]));
        const len = arcs[arcs.length - 1];
        const side = p.side ?? -1;
        const pc = { pts: p.pts, arcs, wall: p.wall };
        const runs: [number, number][] = [];
        for (let i = 0; i + 1 < p.pts.length; i += 2) {
          const from = arcs[i] + WALL_FOOT[Math.min(i / 2, WALL_FOOT.length - 1)];
          const to = arcs[i + 1] - WALL_TOP;
          let open: number | null = null;
          let last = from;
          for (let s = from; ; s += WALK_STEP / 4) {
            const sc = Math.min(s, to);
            if (bracketAt(pc, sc, side, off, LESSON_H)?.ok) {
              if (open === null) open = sc;
              last = sc;
            } else if (open !== null) {
              runs.push([open, last]);
              open = null;
            }
            if (sc >= to) break;
          }
          if (open !== null) runs.push([open, last]);
        }
        out.push({ pts: p.pts, arcs, len, base, ground, side, offset: off, runs: runs.filter(([a, b]) => b > a), wall: p.wall });
        base += len;
        continue;
      }
      const arcs = [0];
      for (let i = 1; i < p.pts.length; i++) arcs.push(arcs[i - 1] + Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][2] - p.pts[i - 1][2]));
      const len = arcs[arcs.length - 1];
      const runsOf: [number, number][][] = [[], []];
      const open: (number | null)[] = [null, null];
      const last = [0, 0];
      for (let s = 0; ; s += WALK_STEP) {
        const sc = Math.min(s, len);
        const f = frameAt(p.pts, arcs, len, sc);
        const ref = ground === "land" ? groundY(f.x, f.z) : 0;
        for (let k = 0; k < 2; k++) {
          const side = k === 0 ? 1 : -1;
          const x = f.x - f.tz * off * side;
          const z = f.z + f.tx * off * side;
          // Round 4: and no nearer the piece's trail than its offset (none pulled in on the inside of a bend).
          const ok = (relaxed ? spotOk(ground, x, z, ref, LEVEL * 2.5, 0, 0.4) : spotOk(ground, x, z, ref)) && trailGap(p.pts, x, z) >= off - FOLD;
          if (ok) {
            if (open[k] === null) open[k] = sc;
            last[k] = sc;
          } else if (open[k] !== null) {
            runsOf[k].push([open[k] as number, last[k]]);
            open[k] = null;
          }
        }
        if (sc >= len) break;
      }
      for (let k = 0; k < 2; k++) if (open[k] !== null) runsOf[k].push([open[k] as number, last[k]]);
      const room = runsOf.map((r) => r.reduce((m, [a, b]) => m + (b - a), 0));
      // The piece's own side when it has room on it, else the side with more room.
      const k = p.side !== undefined && room[p.side === 1 ? 0 : 1] > 0 ? (p.side === 1 ? 0 : 1) : room[0] >= room[1] ? 0 : 1;
      out.push({ pts: p.pts, arcs, len, base, ground, side: k === 0 ? 1 : -1, offset: off, runs: runsOf[k].filter(([a, b]) => b > a) });
      base += len;
    }
    return out;
  };
  const CHECKED: CheckedPiece[][] = WALKS.map((w) => {
    const strict = checkWalk(w, false);
    const room = strict.reduce((m, pc) => m + pc.runs.reduce((r, [a, b]) => r + (b - a), 0), 0);
    return room >= 120 ? strict : checkWalk(w, true);
  });

  /** What each place's layout came to (lanternLayout() reports it). */
  const placed: { room: number; spacing: number; first: number; sides: number[]; per: number }[] = [];
  /** Per lesson lantern: how far along its walk's room (u) and its ground (s) it stands, and on which piece. */
  const along = new Map<Lantern, { u: number; s: number; piece: number }>();

  /** The rope bridge's own frame (blocks.ts RopeBridge: at BRIDGE.a, turned so +x runs along a -> b in plan). */
  const BR = (() => {
    const dx = BRIDGE.b[0] - BRIDGE.a[0];
    const dz = BRIDGE.b[2] - BRIDGE.a[2];
    const yaw = Math.atan2(-dz, dx);
    return { x: BRIDGE.a[0], y: BRIDGE.a[1], z: BRIDGE.a[2], span: Math.hypot(dx, dz), yaw, c: Math.cos(yaw), s: Math.sin(yaw) };
  })();
  /**
   * A lesson lantern at s along the bridge (plan units from its head) on
   * `side` of the way across: its post on the deck's edge, `off` from the
   * centre line, its arm reaching out over the hand rope so the lantern hangs
   * outside the railing, and its pool on the planks in from the post. Posed in
   * the bridge's frame (it sways with the deck, place() and update()) and at rest.
   */
  const bridgeLantern = (s: number, side: number, off: number, h: number, area: number, lesson: number): Lantern => {
    const u = Math.min(1, Math.max(0, s / BR.span));
    const deck = bridgeDeckAt(u) - BR.y;
    const lx = s;
    const ly = deck - 0.3;
    const lz = side * off;
    const lyaw = (-side * Math.PI) / 2;
    // The deck's slope along the bridge there (it sags 18 at the middle), for the pool's tilt.
    const u0 = Math.max(0, u - 0.01);
    const u1 = Math.min(1, u + 0.01);
    const slope = (bridgeDeckAt(u1) - bridgeDeckAt(u0)) / ((u1 - u0) * BR.span || 1);
    const nl = Math.hypot(slope, 1);
    return {
      x: BR.x + lx * BR.c + lz * BR.s,
      y: BR.y + ly,
      z: BR.z - lx * BR.s + lz * BR.c,
      h,
      yaw: BR.yaw + lyaw,
      area,
      lesson,
      at: 0,
      order: 0,
      bridge: { x: lx, y: ly, z: lz, yaw: lyaw, pool: [lx, deck + 0.05, side * (off - BRIDGE_POOL_IN), -slope / nl, 1 / nl, 0] },
    };
  };

  /**
   * Place k's n lesson lanterns: evenly spaced over the room its walk has (the
   * stretches beside it where a lantern may stand, end to end), the first at
   * FIRST along the walk (or at the first spot after it with room), the last
   * one spacing short of the walk's end (at the end for the last place).
   */
  const placeLessons = (k: number, n: number): Lantern[] => {
    const w = WALKS[k];
    const pcs = CHECKED[k];
    // Second Loom: a place whose lessons light the floating steps puts down no lanterns.
    if (w.steps) {
      placed[k] = { room: 0, spacing: 0, first: 0, sides: [], per: 1 };
      return [];
    }
    const runs: { pc: number; a: number; b: number; u: number }[] = [];
    let room = 0;
    pcs.forEach((pc, i) => {
      for (const [a, b] of pc.runs) {
        runs.push({ pc: i, a, b, u: room });
        room += b - a;
      }
    });
    // Never a lantern short: a walk with no room at all (none so far) gets its first piece's line.
    if (!runs.length && pcs.length) {
      runs.push({ pc: 0, a: 0, b: pcs[0].len, u: 0 });
      room = pcs[0].len;
    }
    let first = 0;
    for (const r of runs) {
      const s0 = pcs[r.pc].base + r.a;
      const s1 = pcs[r.pc].base + r.b;
      first += Math.max(0, Math.min(s1, FIRST) - s0);
    }
    const evenly = (m: number) => (m > 0 ? (room - first) / (w.toEnd ? Math.max(1, m - 1) : m) : 0);
    // Round 4: closer than PAIR_BELOW one by one, two to a post (never beside the ladder, whose
    // brackets hold one lantern on the rock, nor on the rope bridge, whose posts hold one each).
    // The posts are evenly spaced; lesson 2p hangs toward the trail on post p, lesson 2p + 1 away from it.
    const per = n >= 2 && evenly(n) < PAIR_BELOW && !pcs.some((pc) => pc.wall || pc.ground === "bridge") ? 2 : 1;
    const spacing = evenly(Math.ceil(n / per));
    placed[k] = { room, spacing, first, sides: pcs.map((pc) => pc.side), per };
    const out: Lantern[] = [];
    for (let j = 0; j < n; j++) {
      // The post it hangs on: its own lesson's number when one lantern stands to a post.
      const p = Math.floor(j / per);
      const u = Math.min(room, first + p * spacing);
      let r = runs.length - 1;
      while (r > 0 && runs[r].u > u) r--;
      const run = runs[r];
      const pc = pcs[run.pc];
      const s = Math.min(run.b, run.a + (u - run.u));
      const hj = LESSON_H * (0.92 + 0.16 * rnd(p, k * 7 + 3));
      // Beside the ladder: one size, as fittings are (the rock was checked for it every half unit).
      const br = pc.wall ? bracketAt(pc, s, pc.side, pc.offset, LESSON_H) : null;
      if (br) {
        const l: Lantern = { x: br.x, y: br.y, z: br.z, h: LESSON_H, yaw: br.yaw, area: k, lesson: j, at: 0, order: 0, face: br.face };
        along.set(l, { u, s: pc.base + s, piece: run.pc });
        out.push(l);
        continue;
      }
      // On the rope bridge: a post at its railing (second Loom), one to a post.
      if (pc.ground === "bridge") {
        const l = bridgeLantern(s, pc.side, pc.offset, hj, k, j);
        along.set(l, { u, s: pc.base + s, piece: run.pc });
        out.push(l);
        continue;
      }
      const q = spotAt(pc, s, pc.side, pc.offset);
      // The lantern hangs toward the trail; on a double post the second hangs away from it (one height and one turn to a post).
      const yaw = Math.atan2(-q.tz, q.tx) + (pc.side > 0 ? Math.PI / 2 : -Math.PI / 2) + (rnd(p, k * 7 + 2) - 0.5) * 0.12 + (j % per) * Math.PI;
      const l: Lantern = { x: q.x, y: groundAt(pc.ground, q.x, q.z) - 0.3, z: q.z, h: hj, yaw, area: k, lesson: j, at: 0, order: 0, ...(per > 1 ? { post: p } : {}) };
      along.set(l, { u, s: pc.base + s, piece: run.pc });
      out.push(l);
    }
    return out;
  };

  // ── The place lamps: by each landmark, where its old stretch passes closest ──
  const STR = stretches();
  interface Cand {
    s: number;
    x: number;
    z: number;
    yaw: number;
    ok: [boolean, boolean];
    pts: [[number, number], [number, number]];
  }
  /** Spots every 2 units along a stretch, both sides, within 160 of where it passes closest to the landmark. */
  const lampCands = (st: Stretch, lm: { x: number; z: number }): Cand[] => {
    const arcs: number[] = [0];
    for (let i = 1; i < st.pts.length; i++) arcs.push(arcs[i - 1] + Math.hypot(st.pts[i][0] - st.pts[i - 1][0], st.pts[i][2] - st.pts[i - 1][2]));
    const total = arcs[arcs.length - 1];
    const to = st.end < 0 ? total + st.end : Math.min(total, st.end);
    const from = Math.max(0, to - st.len);
    // Where along it the landmark is closest, kept inside [from, to].
    let near = from;
    let bd = Infinity;
    for (let i = 0; i < st.pts.length - 1; i++) {
      const [ax, , az] = st.pts[i];
      const dx = st.pts[i + 1][0] - ax;
      const dz = st.pts[i + 1][2] - az;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((lm.x - ax) * dx + (lm.z - az) * dz) / L2));
      const d = Math.hypot(ax + dx * t - lm.x, az + dz * t - lm.z);
      if (d < bd) {
        bd = d;
        near = Math.min(to, Math.max(from, arcs[i] + t * Math.sqrt(L2)));
      }
    }
    const cands: Cand[] = [];
    const off = st.offset ?? OFFSET;
    for (let s = Math.max(from, near - 160); s <= Math.min(to, near + 160); s += 2) {
      const f = frameAt(st.pts, arcs, total, s);
      const ref = st.ground === "land" ? groundY(f.x, f.z) : 0;
      const rx = f.x - f.tz * off;
      const rz = f.z + f.tx * off;
      const lx = f.x + f.tz * off;
      const lz = f.z - f.tx * off;
      cands.push({
        s,
        x: f.x,
        z: f.z,
        yaw: Math.atan2(-f.tz, f.tx),
        ok: [spotOk(st.ground, rx, rz, ref), spotOk(st.ground, lx, lz, ref)],
        pts: [
          [rx, rz],
          [lx, lz],
        ],
      });
    }
    return cands;
  };
  const LAMP_CANDS = STR.map((st, k) => lampCands(st, PLACES[k].pos));
  /**
   * A lamp set by hand (LAMP_AT, WAKE's big lamps): there, or at the nearest
   * spot where a lantern may stand (rings 2 apart, out to 60) when that is in
   * the water or on something (a3's big lamp stood in the river, a5's in the
   * lake's visible water by the jetty's foot).
   */
  const nearestOk = (ground: Ground, x: number, z: number, clear: (x: number, z: number) => boolean): [number, number] => {
    // The spot as set: kept unless water drawn is within DRY of it, it stands
    // inside something, or a lesson lantern is within 12 (round 2: no pad and
    // no level test for a spot set by hand; the pad moved lamps 4 to 14 aside).
    if (!blocked(x, z, 0) && (ground !== "land" || !waterAt(x, z, groundY, DRY)) && clear(x, z)) return [x, z];
    const ok = (px: number, pz: number) => spotOk(ground, px, pz, ground === "land" ? groundY(px, pz) : 0) && clear(px, pz);
    for (let r = 2; r <= 60; r += 2) {
      const n = Math.max(8, Math.round((Math.PI * r) / 2));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        if (ok(x + Math.cos(a) * r, z + Math.sin(a) * r)) return [x + Math.cos(a) * r, z + Math.sin(a) * r];
      }
    }
    return [x, z];
  };

  /** Door and path lamps: where the area's old stretch passes closest to the landmark, across the trail from the place's lesson lanterns there, clear of every lesson lantern. */
  const placeLamps = (k: number, lessons: readonly Lantern[]): Lantern[] => {
    const st = STR[k];
    const lm = PLACES[k].pos;
    const cands = LAMP_CANDS[k];
    const out: Lantern[] = [];
    let ci = -1;
    let bd = Infinity;
    cands.forEach((c, i) => {
      const d = Math.hypot(c.x - lm.x, c.z - lm.z);
      if (d < bd) {
        bd = d;
        ci = i;
      }
    });
    // The other side from the place's first lesson lanterns (its old stretch runs the same way as its walk).
    const far = (CHECKED[k][0]?.side ?? st.side) === 1 ? 1 : 0;
    const clear = (x: number, z: number) => !lessons.some((l) => Math.hypot(l.x - x, l.z - z) < 12) && !out.some((o) => Math.hypot(o.x - x, o.z - z) < 14);
    for (const it of WAKE[k]) {
      if (it.kind !== "lamp") continue;
      const fixed = LAMP_AT[k]?.[it.slot];
      if (fixed) {
        const [fx, fz] = nearestOk(st.ground, fixed[0], fixed[1], clear);
        out.push({ x: fx, y: groundAt(st.ground, fx, fz) - 0.3, z: fz, h: PLACE_H, yaw: rnd(it.slot, k * 5 + 3) * Math.PI * 2, area: k, lesson: -1, at: it.at, order: 1.05, set: [fixed[0], fixed[1]] });
        continue;
      }
      if (ci < 0) continue;
      const target = cands[ci].s + LAMP_SLOTS[it.slot];
      let best: { c: Cand; side: number } | null = null;
      let d0 = Infinity;
      for (const c of cands) {
        for (const sd of [far, 1 - far]) {
          if (!c.ok[sd] || !clear(c.pts[sd][0], c.pts[sd][1])) continue;
          const d = Math.abs(c.s - target) + (sd === far ? 0 : 25);
          if (d < d0) {
            d0 = d;
            best = { c, side: sd };
          }
        }
      }
      if (!best) continue;
      const [lx, lz] = best.c.pts[best.side];
      const sd = best.side === 0 ? 1 : -1;
      out.push({ x: lx, y: groundAt(st.ground, lx, lz) - 0.3, z: lz, h: PLACE_H, yaw: best.c.yaw + (sd > 0 ? Math.PI / 2 : -Math.PI / 2), area: k, lesson: -1, at: it.at, order: 1.05 });
    }
    for (const it of WAKE[k]) {
      if (it.kind !== "big") continue;
      const [bx, bz] = nearestOk(st.ground, it.x, it.z, clear);
      out.push({ x: bx, y: groundAt(st.ground, bx, bz) - 0.3, z: bz, h: BIG_H, yaw: rnd(k, 97) * Math.PI * 2, area: k, lesson: -1, at: it.at, order: 1.05, set: [it.x, it.z] });
    }
    return out;
  };

  // ── Layout for a set of lesson counts (rebuilt only if the counts change) ──
  let counts: number[] = [];
  let lanterns: Lantern[] = [];
  const layoutFor = (lessons: readonly number[]) => {
    along.clear();
    const out: Lantern[] = [];
    for (let k = 0; k < WALKS.length; k++) {
      const area = placeLessons(k, Math.max(0, Math.round(lessons[k] ?? 0)));
      area.forEach((l, j) => (l.order = area.length > 1 ? j / (area.length - 1) : 1));
      out.push(...area);
    }
    const lamps: Lantern[] = [];
    for (let k = 0; k < STR.length; k++) lamps.push(...placeLamps(k, out));
    counts = lessons.map((n) => Math.max(0, Math.round(n)));
    lanterns = [...out, ...lamps];
  };
  layoutFor(DEFAULT_LESSONS);
  // No footprints for the lanterns (map review 2026-10-15, round 2). They were
  // laid here for DEFAULT_LESSONS, before the page sends the course's counts,
  // so most stood where no lantern does; every move of a lantern dealt the
  // grass of its part again (cover.ts counts a part's clumps in one run); and
  // a hand-set lamp found its own footprint when the layout was redone and
  // stepped 4 aside. Grass may touch a lantern's foot; cover.ts is sparse there.

  // ── The floating steps (second Loom): the place whose lessons light them, and the steps drawn ──
  const STEP_AREA = WALKS.findIndex((w) => w.steps);
  const stepsMesh = (ctx.root ?? scene).getObjectByName("FloatingSteps") as THREE.InstancedMesh | undefined;
  const nSteps = STEP_AREA >= 0 && stepsMesh?.isInstancedMesh ? Math.max(0, stepsMesh.count) : 0;
  // The rope bridge's sway group (blocks.ts), which its lanterns follow.
  const swayObj = (ctx.root ?? scene).getObjectByName("RopeBridge_Sway") ?? null;

  // ── Meshes: posts, glass, halos ──
  const { post: postGeo, glass: glassGeo } = lanternGeometry();
  track(postGeo);
  track(glassGeo);
  const CAP = 420;
  /** The lanterns and lamps fit under this; the steps' halos follow them in the halo arrays. */
  const LCAP = CAP - nSteps;
  const postMat = track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  postMat.name = "ProgressLanternPost";
  const glassMat = track(glassMaterial());
  const posts = new THREE.InstancedMesh(postGeo, postMat, CAP);
  posts.name = "ProgressLanternPosts";
  const glassState = new Float32Array(CAP);
  const glassRun = new Float32Array(CAP * 2);
  const glassStateAttr = new THREE.InstancedBufferAttribute(glassState, 1);
  const glassRunAttr = new THREE.InstancedBufferAttribute(glassRun, 2);
  glassGeo.setAttribute("aState", glassStateAttr);
  glassGeo.setAttribute("aRun", glassRunAttr);
  const glass = new THREE.InstancedMesh(glassGeo, glassMat, CAP);
  glass.name = "ProgressLanternGlass";
  const haloGeo = track(new THREE.BufferGeometry());
  const haloPos = new Float32Array(CAP * 3);
  const haloSize = new Float32Array(CAP);
  const haloState = new Float32Array(CAP);
  const haloRun = new Float32Array(CAP * 2);
  const haloPosAttr = new THREE.BufferAttribute(haloPos, 3);
  const haloSizeAttr = new THREE.BufferAttribute(haloSize, 1);
  const haloStateAttr = new THREE.BufferAttribute(haloState, 1);
  const haloRunAttr = new THREE.BufferAttribute(haloRun, 2);
  haloGeo.setAttribute("position", haloPosAttr);
  haloGeo.setAttribute("aSize", haloSizeAttr);
  haloGeo.setAttribute("aState", haloStateAttr);
  haloGeo.setAttribute("aRun", haloRunAttr);
  const haloMat = track(haloMaterial());
  const halos = new THREE.Points(haloGeo, haloMat);
  halos.name = "ProgressLanternHalos";
  halos.renderOrder = 4;
  halos.frustumCulled = false;
  // The pools of light on the ground (final pass), sharing the glass's state.
  const poolGeo = track(new THREE.PlaneGeometry(1, 1));
  poolGeo.rotateX(-Math.PI / 2);
  poolGeo.deleteAttribute("normal");
  poolGeo.setAttribute("aState", glassStateAttr);
  poolGeo.setAttribute("aRun", glassRunAttr);
  const poolMat = track(poolMaterial());
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, CAP);
  pools.name = "ProgressLanternPools";
  pools.renderOrder = 3;
  // The done moment's bloom, sparks and paper lantern (final pass), drawn only while it plays.
  const fxGeo = track(new THREE.BufferGeometry());
  const fxN = FX_SPARKS + 1 + FX_LANTERNS;
  fxGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(fxN * 3), 3));
  fxGeo.setAttribute("aKind", new THREE.Float32BufferAttribute(Array.from({ length: fxN }, (_, i) => (i === 0 ? 0 : i <= FX_LANTERNS ? 1 : 2)), 1));
  fxGeo.setAttribute("aSeed", new THREE.Float32BufferAttribute(Array.from({ length: fxN }, (_, i) => rnd(i, 211)), 1));
  const fxMat = track(fxMaterial());
  const fx = new THREE.Points(fxGeo, fxMat);
  fx.name = "ProgressDoneFx";
  fx.frustumCulled = false;
  fx.renderOrder = 6;
  fx.visible = false;
  for (const o of [posts, glass, halos, pools, fx]) o.layers.set(NO_REFLECT_LAYER);
  root.add(posts, glass, halos, pools, fx);
  fx.onBeforeRender = (renderer, _s, camera) => {
    renderer.getDrawingBufferSize(vp);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 31;
    fxMat.uniforms.uScale.value = vp.y / (2 * Math.tan((fov * Math.PI) / 360));
    fxMat.uniforms.uMaxPx.value = 120 * renderer.getPixelRatio();
  };
  // The floating steps' lit runes: one InstancedMesh on the steps' own
  // instance matrices (the same buffer: blocks.ts settles and bobs the steps,
  // the runes go with them for nothing), hung under the steps' mesh so the sky
  // zone hides both together. Its own state per step, the glass's way.
  const stepState = new Float32Array(Math.max(1, nSteps));
  const stepRun = new Float32Array(Math.max(1, nSteps) * 2);
  const stepStateAttr = new THREE.InstancedBufferAttribute(stepState, 1);
  const stepRunAttr = new THREE.InstancedBufferAttribute(stepRun, 2);
  let runes: THREE.InstancedMesh | null = null;
  let runeMat: THREE.ShaderMaterial | null = null;
  const carved = stepsMesh?.userData.stepRunes as { runes?: Float32Array; rim?: Float32Array } | undefined;
  const runeData = carved?.runes instanceof Float32Array && carved.rim instanceof Float32Array ? { runes: carved.runes, rim: carved.rim, tris: (carved.runes.length + carved.rim.length) / 9 } : null;
  if (stepsMesh && nSteps > 0 && runeData && runeData.tris >= 1) {
    const rg = track(new THREE.BufferGeometry());
    const pos = new Float32Array(runeData.runes.length + runeData.rim.length);
    pos.set(runeData.runes, 0);
    pos.set(runeData.rim, runeData.runes.length);
    rg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    // 0 a rune, 1 the chamfer round the top (the rim).
    const kind = new Float32Array(pos.length / 3);
    kind.fill(1, runeData.runes.length / 3);
    rg.setAttribute("aKind", new THREE.Float32BufferAttribute(kind, 1));
    rg.setAttribute("aState", stepStateAttr);
    rg.setAttribute("aRun", stepRunAttr);
    runeMat = track(runeMaterial());
    runes = new THREE.InstancedMesh(rg, runeMat, nSteps);
    runes.instanceMatrix = stepsMesh.instanceMatrix;
    runes.count = nSteps;
    runes.name = "ProgressStepRunes";
    if (stepsMesh.boundingSphere) runes.boundingSphere = stepsMesh.boundingSphere.clone();
    else runes.frustumCulled = false;
    runes.layers.set(NO_REFLECT_LAYER);
    runes.visible = false;
    stepsMesh.add(runes);
  }
  /** The ground's up direction at (x, z), for laying a pool on a slope. */
  const upAt = (ground: Ground, x: number, z: number, out: THREE.Vector3): THREE.Vector3 => {
    if (ground !== "land") return out.set(0, 1, 0);
    const e = 3;
    const dx = groundY(x + e, z) - groundY(x - e, z);
    const dz = groundY(x, z + e) - groundY(x, z - e);
    out.set(-dx, 2 * e, -dz).normalize();
    // Past ~40 degrees the pool would stand up like a wall: tilt it at most that far.
    if (out.y < 0.77) {
      const hl = Math.hypot(out.x, out.z) || 1;
      out.set((out.x / hl) * 0.64, 0.77, (out.z / hl) * 0.64);
    }
    return out;
  };
  const vp = new THREE.Vector2();
  let maxCss = 64;
  let minCss = 24;
  halos.onBeforeRender = (renderer, _s, camera) => {
    renderer.getDrawingBufferSize(vp);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 31;
    haloMat.uniforms.uScale.value = vp.y / (2 * Math.tan((fov * Math.PI) / 360));
    haloMat.uniforms.uMaxPx.value = maxCss * renderer.getPixelRatio();
    haloMat.uniforms.uMinPx.value = minCss * renderer.getPixelRatio();
  };

  // ── The rope bridge's lanterns follow its sway (blocks.ts turns RopeBridge_Sway every frame it is in view) ──
  /** Indices of the lanterns on the bridge (Creative Strategy's last few), refreshed by place(). */
  let bridgeIdx: number[] = [];
  const swayQ = new THREE.Quaternion(NaN, 0, 0, 1);
  const swayM = new THREE.Matrix4();
  const _bm = new THREE.Matrix4();
  const _bp = new THREE.Vector3();
  const _bq = new THREE.Quaternion();
  const _bs = new THREE.Vector3();
  const _bn = new THREE.Vector3();
  const _bY = new THREE.Vector3(0, 1, 0);
  /** The bridge's frame now: its sway group's world matrix, or the frame at rest without blocks. */
  const bridgeFrame = (): THREE.Matrix4 => {
    if (swayObj) {
      swayObj.updateWorldMatrix(true, false);
      return swayM.copy(swayObj.matrixWorld);
    }
    return swayM.compose(_bp.set(BR.x, BR.y, BR.z), _bq.setFromAxisAngle(_bY, BR.yaw), _bs.set(1, 1, 1));
  };
  /** Lantern i on the bridge, posed in `frame`: its post and glass, its halo, its pool on the planks. */
  const placeOnBridge = (i: number, l: Lantern, frame: THREE.Matrix4) => {
    const b = l.bridge;
    if (!b) return;
    _bm.compose(_bp.set(b.x, b.y, b.z), _bq.setFromAxisAngle(_bY, b.yaw), _bs.setScalar(l.h)).premultiply(frame);
    posts.setMatrixAt(i, _bm);
    glass.setMatrixAt(i, _bm);
    _bp.set(GLASS.x, GLASS.y, 0).applyMatrix4(_bm);
    haloPos[i * 3] = _bp.x;
    haloPos[i * 3 + 1] = _bp.y;
    haloPos[i * 3 + 2] = _bp.z;
    _bn.set(b.pool[3], b.pool[4], b.pool[5]);
    _bm.compose(_bp.set(b.pool[0], b.pool[1], b.pool[2]), _bq.setFromUnitVectors(_bY, _bn), _bs.setScalar(BRIDGE_POOL)).premultiply(frame);
    pools.setMatrixAt(i, _bm);
  };

  // ── The steps' halos: in the halo arrays after the lanterns, from the bobbing steps' poses ──
  /** Where the steps' halos start in the halo arrays (place() sets it). */
  let stepBase = 0;
  /** Some step is lit or next (apply() sets it): only then do the steps' halos follow them. */
  let stepsShowing = false;
  let stepsVer = -1;
  const stepCam = new THREE.Vector3(Infinity, 0, 0);
  const _sm = new THREE.Matrix4();
  const _sp = new THREE.Vector3();
  const _sc = new THREE.Vector3();
  /**
   * Each step's halo: the slab's middle, as blocks.ts poses it now, brought
   * STEP_HALO_PUSH toward the camera so the slab never hides it. Only when a
   * step has a light to show and the steps or the camera moved (or `force`).
   */
  const placeStepHalos = (force: boolean): boolean => {
    if (!stepsMesh || nSteps === 0) return false;
    ctx.camera.getWorldPosition(_sc);
    const ver = stepsMesh.instanceMatrix.version;
    if (!force && ver === stepsVer && _sc.distanceToSquared(stepCam) < 1e-6) return false;
    stepsVer = ver;
    stepCam.copy(_sc);
    const a = stepsMesh.instanceMatrix.array as Float32Array;
    const [n0, n1] = STEP_HALO_NEAR;
    for (let i = 0; i < nSteps; i++) {
      _sm.fromArray(a, i * 16).premultiply(stepsMesh.matrixWorld);
      _sp.set(0, 0.5, 0).applyMatrix4(_sm);
      const dx = _sc.x - _sp.x;
      const dy = _sc.y - _sp.y;
      const dz = _sc.z - _sp.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const k = Math.min(STEP_HALO_PUSH, d * 0.5) / d;
      const j = (stepBase + i) * 3;
      haloPos[j] = _sp.x + dx * k;
      haloPos[j + 1] = _sp.y + dy * k;
      haloPos[j + 2] = _sp.z + dz * k;
      // Near the camera the halo fades: a lit one by distance, the next one's pulse off inside the first number.
      const f = Math.min(1, Math.max(0, (d - n0) / (n1 - n0)));
      const st = stepState[i];
      haloState[stepBase + i] = st > 1.5 ? (d < n0 ? 0 : 2) : st * f * f * (3 - 2 * f);
    }
    return true;
  };

  /** place() wrote whole buffers this frame: update() then adds no partial ranges, which would cut that upload short. */
  let wholeUpload = true;
  // Second Loom's fix round: the last place's lanterns and lamps stand on the
  // Gate isle, which waits for the flight (scene.ts updateGate,
  // scene.userData.gateShown). While it waits they are folded away (no size
  // at their spot, the halo far below); place() puts them back.
  const GATE_AREA = PLACES.length - 1;
  let gateOff = false;
  const foldGate = () => {
    const m = new THREE.Matrix4();
    const n = Math.min(LCAP, lanterns.length);
    for (let i = 0; i < n; i++) {
      if (lanterns[i].area !== GATE_AREA) continue;
      for (const mesh of [posts, glass, pools]) {
        mesh.getMatrixAt(i, m);
        for (const e of [0, 1, 2, 4, 5, 6, 8, 9, 10]) m.elements[e] = 0;
        mesh.setMatrixAt(i, m);
      }
      haloPos[i * 3 + 1] = -1e5;
    }
    wholeUpload = true;
    for (const a of [posts.instanceMatrix, glass.instanceMatrix, pools.instanceMatrix, haloPosAttr]) {
      a.clearUpdateRanges();
      a.needsUpdate = true;
    }
  };
  const place = () => {
    const o = new THREE.Object3D();
    const po = new THREE.Object3D();
    const up = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    const n = Math.min(LCAP, lanterns.length);
    const frame = bridgeFrame();
    bridgeIdx = [];
    for (let i = 0; i < n; i++) {
      const l = lanterns[i];
      glassRun[i * 2] = haloRun[i * 2] = l.area;
      glassRun[i * 2 + 1] = haloRun[i * 2 + 1] = l.order;
      haloSize[i] = l.h * (l.lesson >= 0 ? 1.15 : 1.3);
      if (l.bridge) {
        // On the rope bridge: posed in its frame as it sways now (true on the deck, no lean).
        bridgeIdx.push(i);
        placeOnBridge(i, l, frame);
        continue;
      }
      o.position.set(l.x, l.y, l.z);
      // A slight lean, as old posts have (one set in the rock beside the ladder hangs true, and so
      // does a double post, round 4: its two lanterns share one post, which two leans would split).
      const lean = l.face || l.post !== undefined ? 0 : 0.07;
      o.rotation.set((rnd(i, 81) - 0.5) * lean, l.yaw, (rnd(i, 82) - 0.5) * lean, "YXZ");
      o.scale.setScalar(l.h);
      o.updateMatrix();
      posts.setMatrixAt(i, o.matrix);
      glass.setMatrixAt(i, o.matrix);
      const gp = new THREE.Vector3(GLASS.x, GLASS.y, 0).applyMatrix4(o.matrix);
      haloPos[i * 3] = gp.x;
      haloPos[i * 3 + 1] = gp.y;
      haloPos[i * 3 + 2] = gp.z;
      // The pool: on the ground under the glass, tilted to the slope, about a
      // lantern's height across; for one beside the ladder, on the rock behind it.
      if (l.face) {
        po.position.set(l.face[0], l.face[1], l.face[2]);
        up.set(l.face[3], l.face[4], l.face[5]);
      } else {
        const gnd = STR[l.area]?.ground ?? "land";
        const gy = gnd === "land" ? groundY(gp.x, gp.z) : groundAt(gnd, gp.x, gp.z);
        upAt(gnd, gp.x, gp.z, up);
        po.position.set(gp.x, gy + 0.35, gp.z);
      }
      po.quaternion.setFromUnitVectors(Y, up);
      po.scale.setScalar(l.h * (l.lesson >= 0 ? 2.1 : 2.5));
      po.updateMatrix();
      pools.setMatrixAt(i, po.matrix);
    }
    swayQ.copy(swayObj?.quaternion ?? _bq.identity());
    // The steps' halos follow the lanterns: their size, and their order up the stair for the done moment's run.
    stepBase = n;
    for (let i = 0; i < nSteps; i++) {
      haloSize[n + i] = STEP_HALO;
      haloRun[(n + i) * 2] = stepRun[i * 2] = STEP_AREA;
      haloRun[(n + i) * 2 + 1] = stepRun[i * 2 + 1] = nSteps > 1 ? i / (nSteps - 1) : 1;
    }
    placeStepHalos(true);
    stepRunAttr.needsUpdate = true;
    posts.count = glass.count = pools.count = n;
    haloGeo.setDrawRange(0, n + nSteps);
    // Whole buffers this time: no part range left from a frame before may cut the upload short.
    wholeUpload = true;
    for (const a of [posts.instanceMatrix, glass.instanceMatrix, pools.instanceMatrix, haloPosAttr]) a.clearUpdateRanges();
    posts.instanceMatrix.needsUpdate = true;
    glass.instanceMatrix.needsUpdate = true;
    pools.instanceMatrix.needsUpdate = true;
    glassRunAttr.needsUpdate = true;
    haloPosAttr.needsUpdate = true;
    haloSizeAttr.needsUpdate = true;
    haloRunAttr.needsUpdate = true;
    posts.computeBoundingSphere();
    glass.computeBoundingSphere();
    pools.computeBoundingSphere();
    if (gateOff) foldGate();
  };
  place();

  // ── Smoke for life.ts (userData.smoke, life installs after this module) ──
  const smokes: { o: THREE.Object3D; area: number; at: number }[] = [];
  WAKE.forEach((items, k) => {
    for (const it of items) {
      if (it.kind !== "smoke") continue;
      const o = new THREE.Object3D();
      o.name = `SmokeSource:progress-a${k + 1}`;
      let g = it.plume === "chimney" ? WORLD.lake.y + 39.3 : groundY(it.x, it.z) + 3;
      if (it.plume === "chimney") {
        // The chimney's real top, measured on the landmark's own mesh (dress-lakeforest.ts's boathouse).
        const lm = scene.getObjectByName(PLACES[k].mesh);
        if (lm) {
          lm.updateMatrixWorld(true);
          const ray = new THREE.Raycaster(new THREE.Vector3(it.x, g + 80, it.z), new THREE.Vector3(0, -1, 0), 0, 120);
          const hit = ray.intersectObject(lm, true)[0];
          if (hit) g = hit.point.y + 0.6;
        }
        // Final pass: seated down in the chimney's mouth. A puff fades in and
        // softens against the depth over its first metres, so from the top
        // itself the plume began ~4 visibly above the chimney
        // (world-tests/shots/v6/finalA/world/crop_a5_smoke_before.png; -2.8
        // was not enough). The first puffs now rise out of the flue.
        g -= 7;
      }
      o.position.set(it.x, g, it.z);
      o.userData.smoke = it.plume;
      o.userData.smokeSpec = it.plume === "chimney" ? { place: PLACES[k].id, rate: 0.9, rise: it.rise, width: 4 } : { place: PLACES[k].id, rate: 0.3, rise: it.rise, width: 1.4, op: 0.26 };
      o.visible = false;
      root.add(o);
      smokes.push({ o, area: k, at: it.at });
    }
  });

  // ── Tagged lamps in other modules (collected once every module installed) ──
  let tagged: { o: THREE.Object3D; tag: WakeTag }[] = [];
  const collectTags = () => {
    tagged = [];
    scene.traverse((o) => {
      const tag = o.userData?.wake as WakeTag | undefined;
      if (tag && typeof tag.place === "number" && typeof tag.at === "number") tagged.push({ o, tag });
    });
  };

  // ── Progress ──
  let world: WorldProgress | null = null;
  let legacy = 0;
  /** What the world shows: the page's per-lesson progress, or the old whole-places value read as one. */
  const effective = (): WorldProgress => {
    if (world && world.lessons.length) return world;
    const lessons = counts.length ? counts : DEFAULT_LESSONS;
    const f = Math.floor(legacy + 1e-6);
    const done = lessons.map((n, k) => (k < f ? n : k === f ? Math.floor((legacy - f) * n + 1e-6) : 0));
    return { lessons, done, current: Math.min(8, f), next: f < 8 ? done[f] + 1 : 0 };
  };
  // The celebration: which area, when it started (seconds of the module clock).
  let runArea = -1;
  let runStart = -1;
  let clock = 0;
  const runT = () => (runArea < 0 ? 2 : (clock - runStart) / RUN_S);
  /** The done moment's last beat: when the lamp catches (module clock), -1 when idle. */
  let fxStart = -1;
  const fxBox = new THREE.Box3();
  const fxRay = new THREE.Raycaster();
  const fxRayO = new THREE.Vector3();
  const fxRayD = new THREE.Vector3();
  /**
   * Where an area's landmark lamp is: its big lamp, else its tagged lamp (at
   * 100%), else on the landmark itself. A place with no lamp of its own (AI
   * Ads & Content and Creative Strategy since the second Loom): where the line
   * from the place's stop camera (layout stopRow) to the landmark's middle at
   * 0.6 of its height meets the landmark's meshes, FX_FRONT in front of them.
   * At the middle itself the bloom and the sparks were inside the Great Tree's
   * trunk and the observatory's dome, and the depth test hid them (fix round
   * 2). Read once per done moment, a few thousand triangles.
   */
  const lampOf = (k: number, out: THREE.Vector3): THREE.Vector3 => {
    const i = lanterns.findIndex((l) => l.area === k && l.lesson < 0 && l.at >= 1);
    if (i >= 0 && i < CAP) return out.set(haloPos[i * 3], haloPos[i * 3 + 1], haloPos[i * 3 + 2]);
    const tg = tagged.find((x) => x.tag.place === k && x.tag.at >= 1);
    if (tg) {
      fxBox.setFromObject(tg.o);
      if (!fxBox.isEmpty()) return fxBox.getCenter(out);
    }
    const P = PLACES[k];
    out.set(P.pos.x, P.pos.y + P.height * 0.6, P.pos.z);
    const lm = scene.getObjectByName(P.mesh);
    if (!lm) return out;
    const row = stopRow(k);
    fxRayO.set(row.x, row.y, row.z);
    fxRayD.subVectors(out, fxRayO);
    fxRay.far = fxRayD.length();
    fxRay.set(fxRayO, fxRayD.normalize());
    lm.updateMatrixWorld(true);
    const meshes: THREE.Object3D[] = [];
    lm.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o);
    });
    const hit = fxRay.intersectObjects(meshes, false)[0];
    if (hit) out.copy(hit.point).addScaledVector(fxRayD, -FX_FRONT);
    return out;
  };
  /**
   * Final pass F: where the done moment's paper lanterns fly, seen from the
   * place's stop camera (layout stopRow: its KEYS row, or the row it had where
   * the row was re-aimed since, STOP_ROW_PINS). They lift off
   * behind the landmark (the lamp's far side, at least FX_NEAR from that
   * camera, so the landmark hides their start and none comes near the lens),
   * spread across and drift up and away toward the side the done card is
   * NOT on (FX_SIDE, from cardPlace.ts CARD_HINTS). a8 keeps its rise in the
   * arch as Lovro liked it: the old ring, drift and size.
   */
  const fxCam = new THREE.Vector3();
  const fxBack = new THREE.Vector3();
  const fxRight = new THREE.Vector3();
  const fxLayout = (k: number) => {
    const u = fxMat.uniforms;
    const o = lampOf(k, u.uOrigin.value as THREE.Vector3);
    // The stop's row as its scenery reads it (layout stopRow): a4's keeps the
    // row it had before the turn after the hut went clockwise (STOP_ROW_PINS).
    const row = stopRow(k);
    fxCam.set(row.x, row.y, row.z);
    const d0 = fxCam.distanceTo(o);
    const side = FX_SIDE[k];
    if (side === 0) {
      u.uK.value = Math.min(2.5, Math.max(0.5, d0 / 300));
      (u.uSpawn.value as THREE.Vector3).set(0, 0, 0);
      (u.uSide.value as THREE.Vector3).set(0, 0, 0);
      u.uSpread.value = 0;
      u.uRing.value = 8;
      (u.uDrift.value as THREE.Vector3).set(1.3, 0, 0.4);
      (u.uSize.value as THREE.Vector2).set(7, 3);
      return;
    }
    fxBack.set(o.x - fxCam.x, 0, o.z - fxCam.z);
    if (fxBack.lengthSq() < 1e-6) fxBack.set(0, 0, -1);
    fxBack.normalize();
    // The stop camera's right, level: forward x up.
    fxRight.set(-fxBack.z, 0, fxBack.x).multiplyScalar(side);
    const back = Math.max(12, d0 * 0.1, FX_NEAR - d0);
    const k1 = Math.min(2.5, Math.max(0.25, (d0 + back) / 300));
    u.uK.value = k1;
    (u.uSpawn.value as THREE.Vector3).copy(fxBack).multiplyScalar(back / k1).addScaledVector(fxRight, 3);
    const look = row.look;
    const sp = u.uSpawn.value as THREE.Vector3;
    // A lamp more than 12 degrees off the stop's line of sight (a5's sits on the
    // frame's right edge): the lanterns start behind the landmark itself instead
    // (the bloom and the sparks stay on the lamp), from 0.7 of its height, so a
    // round landmark (a7's dome) does not hide them.
    const lx = look[0] - fxCam.x;
    const lz = look[2] - fxCam.z;
    const ox = o.x - fxCam.x;
    const oz = o.z - fxCam.z;
    if ((lx * ox + lz * oz) / ((Math.hypot(lx, lz) * Math.hypot(ox, oz)) || 1) < FX_OFF_AXIS) {
      const P = PLACES[k];
      sp.x += (P.pos.x - o.x) / k1;
      sp.z += (P.pos.z - o.z) / k1;
      sp.y += Math.max(0, P.pos.y + P.height * 0.7 - o.y) / k1;
    }
    // They start no higher than a little over the stop's line of sight (a2's lamp
    // sits near the frame's top edge: its lanterns rose straight out of frame; a3's
    // landmark, the falls, is 344 tall).
    const lookSlope = (look[1] - fxCam.y) / (Math.hypot(lx, lz) || 1);
    const sx = o.x + sp.x * k1;
    const sz = o.z + sp.z * k1;
    const sy = o.y + sp.y * k1;
    const over = sy - (fxCam.y + Math.hypot(sx - fxCam.x, sz - fxCam.z) * (lookSlope + 0.1));
    if (over > 0) sp.y -= over / k1;
    (u.uSide.value as THREE.Vector3).copy(fxRight);
    u.uSpread.value = 12;
    u.uRing.value = 2.5;
    // A faster rise (the lamps sit low, and the lanterns should reach the sky before they fade).
    (u.uDrift.value as THREE.Vector3).copy(fxRight).multiplyScalar(1.7).addScaledVector(fxBack, 1.1).setY(4);
    (u.uSize.value as THREE.Vector2).set(7.5, 2.5);
  };
  /** Is a landmark lamp of area k held back while its run is still going? */
  const held = (k: number) => k === runArea && runT() < 1;

  let pulseIdx = -1;
  /** Something changed outside the frame loop (the scene also wakes itself after progress calls). */
  let dirty = true;
  const pulseSphere = new THREE.Sphere();
  const apply = () => {
    const p = effective();
    const lessons = p.lessons.length === 8 ? p.lessons : DEFAULT_LESSONS;
    if (lessons.some((n, k) => Math.max(0, Math.round(n)) !== counts[k])) {
      layoutFor(lessons);
      place();
    }
    pulseIdx = -1;
    const n = Math.min(LCAP, lanterns.length);
    for (let i = 0; i < n; i++) {
      const l = lanterns[i];
      let st = 0;
      if (l.lesson >= 0) {
        const done = Math.min(counts[l.area], Math.max(0, Math.round(p.done[l.area] ?? 0)));
        if (l.lesson < done) st = 1;
        else if (l.area === p.current && l.lesson === done) {
          st = 2;
          pulseIdx = i;
        }
      } else {
        st = areaShare(p, l.area) >= l.at && !(l.at >= 1 && held(l.area)) ? 1 : 0;
      }
      glassState[i] = haloState[i] = st;
    }
    // The floating steps: lit from the bottom (stepsLit), the next one pulsing while the student is in that place.
    if (nSteps > 0) {
      const total = counts[STEP_AREA] ?? 0;
      const done = Math.min(total, Math.max(0, Math.round(p.done[STEP_AREA] ?? 0)));
      const lit = stepsLit(done, total, nSteps);
      let any = false;
      for (let i = 0; i < nSteps; i++) {
        let st = i < lit ? 1 : 0;
        if (!st && i === lit && STEP_AREA === p.current && done < total) {
          st = 2;
          pulseIdx = stepBase + i;
        }
        stepState[i] = st;
        if (st) any = true;
      }
      stepStateAttr.needsUpdate = true;
      if (runes) runes.visible = any;
      stepsShowing = any;
      // Their halos (state faded by distance, and where they are), for the steps and the camera as they are now: whole buffers.
      placeStepHalos(true);
      haloPosAttr.clearUpdateRanges();
      haloPosAttr.needsUpdate = true;
      wholeUpload = true;
    }
    glassStateAttr.needsUpdate = true;
    haloStateAttr.clearUpdateRanges();
    haloStateAttr.needsUpdate = true;
    if (pulseIdx >= 0) pulseSphere.set(new THREE.Vector3(haloPos[pulseIdx * 3], haloPos[pulseIdx * 3 + 1], haloPos[pulseIdx * 3 + 2]), 12);
    for (const s of smokes) s.o.visible = areaShare(p, s.area) >= s.at;
    for (const { o, tag } of tagged) {
      const on = areaShare(p, tag.place) >= tag.at && !(tag.at >= 1 && held(tag.place));
      if (tag.set) tag.set(on);
      else o.visible = on;
    }
    dirty = true;
  };
  apply();

  // ── Frame loop ──
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const camPos = new THREE.Vector3();
  let running = false;
  let animating = false;
  let lastLevel = -1;
  let lastMagic = -1;
  let lastNight = -1;
  let lastMorning = -1;
  const lightState = () => (scene.userData.light as { state?: { lampGlow: number; magicGlow?: number; night?: number; morning?: number } } | undefined)?.state;
  const update = (time: number): boolean => {
    clock = time;
    let changed = dirty;
    dirty = false;
    // The Gate isle's lanterns wait for the flight with it (foldGate above).
    if ((scene.userData.gateShown === false) !== gateOff) {
      gateOff = !gateOff;
      if (gateOff) foldGate();
      else place();
      changed = true;
    }
    // The lamp level: light.ts's lampGlow (0.4 in the afternoon, 1.1 at night), floored so a lit lantern reads in daylight.
    const lg = lightState()?.lampGlow ?? 0.7;
    const night = Math.min(1, Math.max(0, (lg - 0.45) / 0.55));
    const level = Math.max(LOOK.glassFloor, lg);
    // The morning's share of the light (0 by day and at night). The glass
    // sits at its floor both by day and in the morning, so the level alone
    // would not notice the morning coming or going.
    const mk = Math.min(1, Math.max(0, lightState()?.morning ?? 0));
    if (Math.abs(level - lastLevel) > 1e-3 || Math.abs(mk - lastMorning) > 1e-3) {
      lastLevel = level;
      lastMorning = mk;
      glassMat.uniforms.uLevel.value = level;
      if (runeMat) runeMat.uniforms.uLevel.value = level;
      haloMat.uniforms.uSize.value = LOOK.haloDay + (LOOK.haloNight - LOOK.haloDay) * night;
      haloMat.uniforms.uAlpha.value = (LOOK.haloAlphaDay + (LOOK.haloAlphaNight - LOOK.haloAlphaDay) * night) * (1 - LOOK.haloMorningCut * mk);
      poolMat.uniforms.uAlpha.value = LOOK.poolDay + (LOOK.poolNight - LOOK.poolDay) * night;
      // The next lesson's pool is boosted most in daylight, where the plain pools barely show.
      poolMat.uniforms.uNext.value = 1.6 - 0.8 * night;
      changed = true;
    }
    // The night layer (light.ts state.night): the glass warms by light.ts's
    // NIGHT_LAMP_TINT, as the windows and the campfire do. At the night's lamp
    // level and exposure it read white (sat 0.02 at a1) beside its warm halo,
    // like an LED; tinted, its core is sand and its frame deep amber.
    const nk = Math.min(1, Math.max(0, lightState()?.night ?? 0));
    if (Math.abs(nk - lastNight) > 1e-3) {
      lastNight = nk;
      const lit = glassMat.uniforms.uLit.value as THREE.Color;
      lit.setRGB(...LOOK.lamp);
      if (nk > 0) lit.multiply(_glassTint.setRGB(1, 1, 1).lerp(_glassNight, nk));
      changed = true;
    }
    // The carved runes' magic level (dress-lakeforest.ts uMagic), for the next step's pulse.
    const magic = Math.min(lightState()?.magicGlow ?? 0.9, 0.95);
    if (runeMat && Math.abs(magic - lastMagic) > 1e-3) {
      lastMagic = magic;
      runeMat.uniforms.uMagic.value = magic;
      changed = true;
    }
    const t = reduced ? 0 : time;
    glassMat.uniforms.uTime.value = haloMat.uniforms.uTime.value = poolMat.uniforms.uTime.value = t;
    if (runeMat) runeMat.uniforms.uTime.value = t;
    // The run along an area's lanterns, and the landmark lamp catching at its end.
    if (runArea >= 0) {
      const rt = runT();
      glassMat.uniforms.uRunT.value = haloMat.uniforms.uRunT.value = poolMat.uniforms.uRunT.value = rt;
      glassMat.uniforms.uRunArea.value = haloMat.uniforms.uRunArea.value = poolMat.uniforms.uRunArea.value = runArea;
      if (runeMat) {
        runeMat.uniforms.uRunT.value = rt;
        runeMat.uniforms.uRunArea.value = runArea;
      }
      if (running && rt >= 1) {
        running = false;
        apply();
      }
      if (rt > 1.7) {
        runArea = -1;
        glassMat.uniforms.uRunArea.value = haloMat.uniforms.uRunArea.value = poolMat.uniforms.uRunArea.value = -1;
        if (runeMat) runeMat.uniforms.uRunArea.value = -1;
      }
      changed = true;
    }
    // The rope bridge's lanterns go with its sway (blocks.ts turns it every frame it is in view): only theirs is written.
    if (bridgeIdx.length && swayObj && !swayObj.quaternion.equals(swayQ)) {
      swayQ.copy(swayObj.quaternion);
      const frame = bridgeFrame();
      for (const i of bridgeIdx) placeOnBridge(i, lanterns[i], frame);
      const i0 = bridgeIdx[0];
      const nb = bridgeIdx[bridgeIdx.length - 1] - i0 + 1;
      for (const m of [posts, glass, pools]) {
        if (!wholeUpload) m.instanceMatrix.addUpdateRange(i0 * 16, nb * 16);
        m.instanceMatrix.needsUpdate = true;
      }
      if (!wholeUpload) haloPosAttr.addUpdateRange(i0 * 3, nb * 3);
      haloPosAttr.needsUpdate = true;
      changed = true;
    }
    // The steps' halos go with the bobbing steps and stay toward the camera, fading near it, while a step shows a light.
    if (stepsShowing && stepsMesh?.parent?.visible !== false && placeStepHalos(false)) {
      if (!wholeUpload) {
        haloPosAttr.addUpdateRange(stepBase * 3, nSteps * 3);
        haloStateAttr.addUpdateRange(stepBase, nSteps);
      }
      haloPosAttr.needsUpdate = true;
      haloStateAttr.needsUpdate = true;
      if (pulseIdx >= stepBase) pulseSphere.center.set(haloPos[pulseIdx * 3], haloPos[pulseIdx * 3 + 1], haloPos[pulseIdx * 3 + 2]);
      changed = true;
    }
    wholeUpload = false;
    // The bloom, the sparks and the paper lantern, from the moment the lamp catches.
    if (fxStart >= 0) {
      const ft = clock - fxStart;
      fxMat.uniforms.uT.value = ft;
      fx.visible = ft >= 0;
      if (ft > FX_S) {
        fxStart = -1;
        fx.visible = false;
        fxMat.uniforms.uT.value = -1;
      }
      changed = true;
    }
    animating = runArea >= 0 || fxStart >= 0;
    if (!reduced && pulseIdx >= 0) {
      const cam = ctx.camera;
      cam.updateMatrixWorld();
      camPos.setFromMatrixPosition(cam.matrixWorld);
      pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      if (camPos.distanceTo(pulseSphere.center) < 2200 && frustum.intersectsSphere(pulseSphere)) animating = true;
    }
    return changed || animating;
  };

  const buildMs = Math.round(performance.now() - t0);
  const mod: WorldModule & {
    setWorldProgress(p: WorldProgress): void;
    setProgress(p: number): void;
    celebrate(area: number): void;
    setLook(look: Partial<typeof LOOK>): void;
    lanternLayout(): unknown;
  } = {
    name: "progress-world",
    update,
    isAnimating: () => animating,
    afterAll() {
      collectTags();
      apply();
    },
    setWorldProgress(p: WorldProgress) {
      world = p;
      apply();
    },
    setProgress(p: number) {
      legacy = Number.isFinite(p) ? Math.min(8, Math.max(0, p)) : 0;
      // Other modules' own setProgress may have just switched a tagged lamp: put the world's state back.
      apply();
    },
    celebrate(area: number) {
      if (!(area >= 0 && area < 8)) return;
      if (reduced) {
        runArea = -1;
        apply();
        return;
      }
      runArea = Math.round(area);
      runStart = clock;
      running = true;
      glassMat.uniforms.uRunT.value = haloMat.uniforms.uRunT.value = poolMat.uniforms.uRunT.value = 0;
      glassMat.uniforms.uRunArea.value = haloMat.uniforms.uRunArea.value = poolMat.uniforms.uRunArea.value = runArea;
      if (runeMat) {
        runeMat.uniforms.uRunT.value = 0;
        runeMat.uniforms.uRunArea.value = runArea;
      }
      // The last beat starts as the lamp catches. Final pass F: sized and placed
      // from the place's STOP camera, never the camera of the moment (a place
      // finished while the camera was far away made 20 unit lanterns that
      // filled the frame once the camera reached the stop).
      fxLayout(runArea);
      fxMat.uniforms.uT.value = -1;
      fxStart = clock + RUN_S * 1.05;
      apply();
    },
    setLook(look: Partial<typeof LOOK>) {
      Object.assign(LOOK, look);
      (glassMat.uniforms.uLit.value as THREE.Color).setRGB(...LOOK.lamp);
      if (runeMat) (runeMat.uniforms.uLit.value as THREE.Color).setRGB(...LOOK.lamp);
      lastLevel = -1;
      lastNight = -1;
      dirty = true;
    },
    setQuality(tier: QualityTier) {
      // Cheap laptops: smaller halos (overdraw), the same lanterns.
      maxCss = tier.tier >= 2 ? 40 : 64;
      minCss = tier.tier >= 2 ? 16 : 24;
    },
    dispose() {
      root.removeFromParent();
      posts.dispose();
      glass.dispose();
      pools.dispose();
      if (runes) {
        runes.removeFromParent();
        // The steps' instance matrices are blocks.ts's: three drops an InstancedMesh's
        // instanceMatrix buffer when the mesh is disposed, so hand it a stand-in first.
        runes.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(16), 16);
        runes.dispose();
      }
      for (const d of disposables) d.dispose();
    },
    stats() {
      const lesson = lanterns.filter((l) => l.lesson >= 0);
      const perArea = counts.map((_, k) => lesson.filter((l) => l.area === k).length);
      return {
        triangles: Math.round((postGeo.getAttribute("position").count / 3 + 12) * Math.min(LCAP, lanterns.length) + (runes && runeData ? runeData.tris * nSteps : 0)),
        instances: Math.min(LCAP, lanterns.length),
        lessonLanterns: lesson.length,
        placeLamps: lanterns.length - lesson.length,
        perArea: perArea.join(","),
        wanted: counts.join(","),
        // Second Loom: the place whose lessons light the floating steps (1-based, 0 for none), how many steps, how many lit.
        stepsPlace: STEP_AREA + 1,
        steps: nSteps,
        stepsLit: stepState.slice(0, nSteps).reduce((m, s) => m + (s === 1 ? 1 : 0), 0),
        bridgeLanterns: bridgeIdx.length,
        calls: 4 + (fx.visible ? 1 : 0) + (runes?.visible ? 1 : 0),
        tagged: tagged.map((t) => `${t.o.name}@a${t.tag.place + 1}:${t.tag.at}`).join(","),
        smokes: smokes.length,
        pulse: pulseIdx,
        buildMs,
      };
    },
    /**
     * For the tests (v6-course.mjs row 2): each place's walk (its room, the even
     * spacing, how far along its room the first lantern stands, each ground
     * piece's side, where the walk starts) and every lesson lantern: its
     * instance index, where along its walk's room (u) and ground (s) it
     * stands, and how far it is from the trail's centre line there (beside the
     * ladder: from its centre line, measured across the face, with where its
     * post's top and its glass are, for the test's rock check). And every
     * place lamp, with the spot it was set at by hand, if it was. Second Loom:
     * a lantern on the rope bridge says so (bridge: its post's height over the
     * deck there and the hand rope's), and `steps` is the floating steps: the
     * place whose lessons light them (0-based), how many are drawn, its
     * lesson count, and the mesh whose aState holds each step's light.
     */
    lanternLayout() {
      /** Across the face from the ladder's centre line, at the section the lantern's glass is level with. */
      const beside = (secs: LadderSection[], l: Lantern) => {
        const gy = l.y + GLASS.y * l.h;
        const sec = secs.find((sc) => gy <= sc.b[1] + 1) ?? secs[secs.length - 1];
        return Math.abs((l.x - sec.a[0]) * sec.east[0] + (l.z - sec.a[2]) * sec.east[1]);
      };
      const r2 = (v: number) => Math.round(v * 100) / 100;
      return {
        places: placed.map((p, k) => ({
          room: r2(p.room),
          spacing: r2(p.spacing),
          first: r2(p.first),
          // Lanterns to a post (round 4: 2 where single ones would stand closer than PAIR_BELOW); spacing is between posts.
          per: p.per,
          sides: p.sides,
          offsets: CHECKED[k].map((pc) => pc.offset),
          toEnd: !!WALKS[k].toEnd,
          start: CHECKED[k][0] ? [CHECKED[k][0].pts[0][0], CHECKED[k][0].pts[0][2]] : null,
          // Each ground piece: where it starts along the walk, its length, what it stands on, side, offset, and the runs beside it where a lantern may stand.
          pieces: CHECKED[k].map((pc) => ({ base: r2(pc.base), len: r2(pc.len), ground: pc.ground, side: pc.side, offset: pc.offset, wall: !!pc.wall, runs: pc.runs.map(([a, b]) => [r2(a), r2(b)]), from: [r2(pc.pts[0][0]), r2(pc.pts[0][2])], to: [r2(pc.pts[pc.pts.length - 1][0]), r2(pc.pts[pc.pts.length - 1][2])] })),
        })),
        lanterns: lanterns.flatMap((l, i) => {
          const a = along.get(l);
          if (l.lesson < 0 || !a) return [];
          const pc = CHECKED[l.area][a.piece];
          if (pc.wall) {
            const c = Math.cos(l.yaw);
            const sn = -Math.sin(l.yaw);
            const wall = { post: [r2(l.x), r2(l.y + 0.84 * l.h), r2(l.z)], glass: [r2(l.x + c * GLASS.x * l.h), r2(l.y + GLASS.y * l.h), r2(l.z + sn * GLASS.x * l.h)], back: [r2(l.x + c * (GLASS.x - GLASS.w * 0.55) * l.h), r2(l.y + (GLASS.y - GLASS.h / 2) * l.h), r2(l.z + sn * (GLASS.x - GLASS.w * 0.55) * l.h)] };
            return [{ i, area: l.area, lesson: l.lesson, x: r2(l.x), y: r2(l.y), z: r2(l.z), u: r2(a.u), s: r2(a.s), piece: a.piece, trail: r2(beside(pc.wall, l)), glass: wall.glass, wall, post: l.post ?? null, bridge: null }];
          }
          // Round 3: where its glass hangs (the tests look for it from the place's views).
          const glass = [r2(l.x + Math.cos(l.yaw) * GLASS.x * l.h), r2(l.y + GLASS.y * l.h), r2(l.z - Math.sin(l.yaw) * GLASS.x * l.h)];
          // On the rope bridge (at rest): the post's top over the deck, and the hand rope's height there (dress-sky.ts handAt).
          const bu = l.bridge ? Math.min(1, Math.max(0, l.bridge.x / BR.span)) : 0;
          const bridge = l.bridge ? { postTop: r2(0.84 * l.h - 0.3), handRope: r2(7 + 4.5 * (1 - 4 * bu * (1 - bu))), outside: r2(Math.abs(l.bridge.z) + GLASS.x * l.h) } : null;
          return [{ i, area: l.area, lesson: l.lesson, x: r2(l.x), y: r2(l.y), z: r2(l.z), u: r2(a.u), s: r2(a.s), piece: a.piece, trail: r2(trailGap(pc.pts, l.x, l.z)), glass, post: l.post ?? null, bridge }];
        }),
        lamps: lanterns.flatMap((l, i) => (l.lesson >= 0 ? [] : [{ i, area: l.area, at: l.at, x: r2(l.x), z: r2(l.z), set: l.set ?? null }])),
        steps: { place: STEP_AREA, count: nSteps, lessons: STEP_AREA >= 0 ? (counts[STEP_AREA] ?? 0) : 0, mesh: runes ? runes.name : null },
      };
    },
  };
  return mod;
};
