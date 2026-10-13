/**
 * v6 route layout: where the eight places are, where the camera travels and
 * what it looks at. Everything else in v6 (terrain, rail, landmarks, light,
 * interface) is built from this file and terrain.ts. Pure data, no three.js.
 *
 * Coordinates are three.js, Y up, in world units (a person is 14).
 * Bearings are compass degrees seen from above: 0 looks toward -z (north),
 * 90 toward +x (east), 180 toward +z, 270 toward -x. Pitch is degrees BELOW
 * the horizon; a negative pitch looks up.
 *
 * The map, south to north then west (world_art_bible_v6.md section 1):
 *   the sea and the Landing on the south coast; Base Camp on the coastal shelf;
 *   the stream from the Upper Falls (a cascade on the west massif's east
 *   shoulder) runs along the south shelf to the lip of the big falls, which
 *   pour NORTH off the gorge's SOUTH wall, away from the trail. The camera
 *   rides down with the water and turns round over the pool to the pool's
 *   west end, OUTSIDE the falls (a3). From there it crosses the gorge in one
 *   move: east past the falls along the gorge's north side, the view turning
 *   with them, then pulling back and rising to a rock spur on the north wall
 *   with the Trail Hut (a4), the whole falls across the gorge. The cave behind
 *   the falls, its side passage, the fallen log over the river and the
 *   switchbacks up the north wall are all still in the world (the trail on
 *   the ground, PATH, runs through them); since 2026-10-13 the camera uses
 *   none of them (Lovro: "the camera between Video Ads 1 and Video Ads 2 goes
 *   into the cave for no reason").
 *   A rising traverse east and a gully up the Climb's rim bring it to
 *   the ridge (the burst, locked), the saddle and the meadow down to the
 *   Mirror Lake (a5); west through the Glowing Forest to the Great Tree (a6);
 *   up the floating steps to the Sky Island (a7, the sky frame); over the rope
 *   bridge to the bounty isle; the airship flies north across the cloud sea
 *   to the Gate isle, where a stone arch faces the sunrise (a8), and the tail
 *   flies through it into the sun. The ridge and the west massif hide the Sky
 *   Island from stops 1-4.
 *
 * TUNING: the numbers that decide feel are all here. scrollVh (budget per
 * stretch), PACE (slower in the ride and on the rise, faster in the hike and
 * the flight), the KEYS table (camera positions, bearing, pitch, lens) and
 * LOOK_DIST. world-tests/v6-route.mjs checks clearance, sight lines, the
 * ride, the a3 to a4 move, the steps, the bridge, the flight, the Gate and the
 * lake reflection; v6-cave.mjs that the cave is still built as it was and
 * that the route stays out of it; v6-locked.mjs the locked stretches against
 * v5.
 */

/**
 * The light keys light.ts has rows for (bible 1.0, 2.6): v6 adds
 * "gorge-sunset" (the exit, the hike, a4 and the traverse) and "sunrise" (a8
 * and the tail) and retires "morning" (light.ts keeps a row under its own
 * LightName, B5-lightkeys.md).
 */
export type LightKey =
  | "afternoon-gold"
  | "afternoon"
  | "late-afternoon"
  | "gorge-sunset"
  | "sunset-cliff"
  | "sunset"
  | "dusk"
  | "night"
  | "dawn"
  | "sunrise";

export type PlaceId = "a1" | "a2" | "a3" | "a4" | "a5" | "a6" | "a7" | "a8";

/**
 * What a stretch of the camera route is doing. The rail uses it to decide
 * terrain follow (off for the kinds in NO_TERRAIN_FOLLOW, which are placed
 * by hand) and the check script uses it for the clearance rules.
 *   walk    ordinary trail flight, >= KEY_CLEAR over the ground
 *   dive    the ride down the falls and the turn at the pool: >= 15 from any
 *           rock, >= 8 from the curtain
 *   hike    up the gorge's north wall and along it: >= KEY_CLEAR over the ground
 *   climb   up the gully to the ridge and the burst (heights exact)
 *   rise    up the floating steps, looking up at the island
 *   sky     on an island top (Sky Island, Gate isle), >= KEY_CLEAR over it
 *   bridge  walking the rope bridge: BRIDGE_EYE above its deck
 *   board   on foot at the bounty isle and onto / off your airship's deck
 *   flight  riding the airship: the camera stands on its deck (SHIP)
 *   tunnel, shaft  RETIRED with the mine: no key uses them. They stay in the
 *           type only so modules that still name them compile (forest.ts);
 *           their owners drop them in phase B.
 *   cave    RETIRED 2026-10-13 (Lovro: "the camera between Video Ads 1 and
 *           Video Ads 2 goes into the cave for no reason. Just going straight
 *           from Video Ads 1 screen to Video Ads 2 and giving it a nice
 *           path"): no key uses it. It was the pass through the curtain into
 *           the cave (CAVE) and back out: inside the void (caveMargin) or,
 *           outside it, >= 15 over the pool and >= 8 from rock. The cave
 *           itself is still built and dressed. The kind stays in the type so
 *           the modules that name it compile and behave as before for a route
 *           with no such key (PACE, NO_TERRAIN_FOLLOW, UNDERGROUND and
 *           CAVE_KEYS here; rail.ts, scene.ts's underground(), forest.ts,
 *           light.ts's cave light): each of them is simply never switched on.
 */
export type TrailKind = "walk" | "dive" | "hike" | "climb" | "rise" | "sky" | "bridge" | "board" | "flight" | "cave";

/** Kinds the rail must NOT lift over the ground or the islands' keep-out domes:
 *  their heights are exact (the ride, the gully up to the burst, the bridge's
 *  deck, the bounty isle, the ship, and the cave, which ran BELOW
 *  terrainHeight by design, see CAVE; "cave" is retired, see TrailKind). */
export const NO_TERRAIN_FOLLOW: readonly TrailKind[] = ["dive", "climb", "bridge", "board", "flight", "cave"];

/** Kinds that run inside the cave's void (CAVE, CAVE_EXIT): the camera is
 *  under the terrain surface there, which is drawn front faces only, so the
 *  void's own walls are all that the camera sees.
 *  RETIRED 2026-10-13 with the "cave" kind (see TrailKind): no key is of a
 *  kind listed here, so no part of the route is underground. */
export const UNDERGROUND: readonly TrailKind[] = ["cave"];

export interface Place {
  id: PlaceId;
  /** Shown to students. */
  module: string;
  /** Internal only, never in the UI. */
  place: string;
  /** Database value (regions_next.landmark_label). */
  landmark: string;
  /** "LM_" + landmark without spaces; the landmark object's name. */
  mesh: string;
  /** Base centre of the landmark on its ground (or water, or island top). */
  pos: { x: number; y: number; z: number };
  light: LightKey;
  /** Scroll budget, in vh, of the stretch that ends at this stop. */
  scrollVh: number;
  /** Index into TRAIL / LOOK where the camera stands at this stop. */
  trail: number;
  /** Rough height of the landmark, for framing and marker placement. */
  height: number;
}

// ── The places' new props (bible 1.10, 1.17, 1.20) ─────────────────────────

/**
 * The Trail Hut (a4, LM_TrailHut): at the west end of the rock bench
 * (WORLD.hikeLedge) on the gorge's north wall, at its outer edge, so from the
 * a4 camera at the bench's east end it stands ~10 degrees right of the falls
 * across the gorge. `facing` is the compass bearing its door and bench look
 * along (the falls). Base on the bench's flat top.
 */
export const TRAIL_HUT = { x: 548, y: 300, z: 1234, facing: 234 } as const;

/**
 * The Stone Arch (a8, LM_StoneArch) on the Gate isle's north-west brow. Its
 * axis (the way through) points along `axis` (compass), the airship's docking
 * line, and the sunrise (az 322, el 4) sits inside the opening from a8.
 * `height` overall; the opening openW wide and openH tall from the threshold
 * at y; each pillar pillarW across the face and pillarD deep along the axis.
 */
export const GATE = { x: -2320, y: 1600, z: -4399, axis: 322, height: 200, openW: 110, openH: 150, pillarW: 40, pillarD: 30 } as const;

/** Past the flight: the head of the stone dock, at the docked ship's bow. */
export const GATE_DOCK = { x: -2043, y: 1600, z: -4044 } as const;

// ── Places ───────────────────────────────────────────────────────────────────

/** Scroll after the last stop: up the causeway to the arch framing the sun (bible 1.20).
 *  Final pass: 90 -> 110, so the tail is at least a screen. Final pass B:
 *  110 -> 60, a short push in that ends on the arch (the fly into the gold
 *  ended on blank sky). */
export const TAIL_VH = 60;
/**
 * Scroll budget of the flight, in vh: from the moored ship's deck to the
 * docked ship's (FLIGHT_KEYS.first to .last). The flight is its own stretch
 * with its own slider, carved out of a8's; a8's scrollVh is the rest of that
 * stretch (the walk to the bridge head, the bridge, boarding and landing).
 * The stop a8 therefore sits at the sum of all eight scrollVh plus this.
 */
export const FLIGHT_VH = 220;

/**
 * The observatory on the Sky Island's terrace (a7, LM_Observatory), beside
 * the end of the island's one path (ISLAND_PATH), never on it; its door faces
 * the path (`facing`). Base on the island's top.
 */
export const OBSERVATORY = { x: -2052, y: 1650, z: -1560, facing: 125 } as const;

/**
 * Keys are bound to places by id below; trail indices are filled in from KEYS.
 * Round 1, route stage 2 (Lovro: "some paths are way longer than others"),
 * the first evening-out pass, measured with world-tests/v6-r1-pacing.mjs and
 * a scroll strip (shots/v6/round1/route2): stop-to-stop 1.2 to 2.3 screens,
 * more where a highlight sits inside the stretch (a3 holds the ride down the
 * falls, ~1.3 screens of it; a7 the floating steps, ~1.3), the flight 2.2.
 * Was 150 / 170 / 360 / 170 / 280 / 210 / 260 / 260, flight 250, tail 90
 * (2,200 vh); now 1,970. Lovro fine-tunes with TUNE.
 * Final pass (the a3 -> a4 move rebuilt, re-measured with v6-r1-pacing): the
 * stretches are unchanged, a3 -> a4 is 2.0 screens (the dwell and the dolly to
 * the curtain 0.5, the cave 0.4, the pull back 1.1); the tail 90 -> 110 so it
 * is a screen; 1,990 vh in all (tuning.ts's storage key bumped to "final").
 * 2026-10-13 (Lovro: no cave between Video Ads 1 and 2): a3 -> a4 is one move
 * across the gorge, 1,221 units where the cave pass and the pull back were
 * 1,674, so a4's budget goes 200 -> 150: 1.5 screens, 12.3 vh per 100 units
 * stop to stop (it was 11.9; a2 -> a3 is 14.5 and a4 -> a5 13.3) and 10.2 from
 * the "crossing" mark to "wall", clear of both dwells, as the walks either
 * side of it (8.1 to 10.6). At 140 the view's fastest turn is 1.3 degrees
 * per vh (150: 1.25) and the middle 9.5; at 160 the middle is 11.0, slower
 * than those walks. 1,940 vh in all (tuning.ts's storage key bumped to
 * "direct").
 */
const PLACE_DEFS: ReadonlyArray<Omit<Place, "trail">> = [
  { id: "a1", module: "Introduction", place: "The Landing", landmark: "Signpost", mesh: "LM_Signpost",
    pos: { x: 1300, y: 5, z: 4170 }, light: "afternoon-gold", scrollVh: 120, height: 30 },
  // v6: the lookout on its own knoll ~100 west of the trail (bible 1.3, decision 14).
  { id: "a2", module: "Fundamentals", place: "Base Camp", landmark: "Lookout", mesh: "LM_Lookout",
    pos: { x: 340, y: 150, z: 2760 }, light: "afternoon", scrollVh: 160, height: 70 },
  // The waterfall's base: where the falling water meets the pool (WORLD.falls.bottom).
  // The stop stands OUTSIDE, at the pool's west end (A3_VIEW; round 1 and the
  // final pass moved it out of the cave). The cave behind the curtain (CAVE)
  // is still in the world; since 2026-10-13 the camera never enters it.
  { id: "a3", module: "Video Ads I", place: "The Falls, and the cave behind them", landmark: "Waterfall", mesh: "LM_Waterfall",
    pos: { x: -100, y: 61.5, z: 1689 }, light: "late-afternoon", scrollVh: 300, height: 344 },
  // v6: the Trail Hut on the rock spur halfway up the gorge's north wall.
  { id: "a4", module: "Video Ads II", place: "The Gorge Trail", landmark: "Trail Hut", mesh: "LM_TrailHut",
    pos: { x: TRAIL_HUT.x, y: TRAIL_HUT.y, z: TRAIL_HUT.z }, light: "gorge-sunset", scrollVh: 150, height: 30 },
  // The boathouse stands at the end of a jetty, on the water.
  { id: "a5", module: "Static Ads", place: "The Mirror Lake", landmark: "Boathouse", mesh: "LM_Boathouse",
    pos: { x: 1150, y: 564, z: -420 }, light: "sunset", scrollVh: 280, height: 40 },
  // The heart of the forest (WORLD.forest.clearing); the floating steps start beside it.
  { id: "a6", module: "AI Ads & Content", place: "The Glowing Forest", landmark: "Great Tree", mesh: "LM_GreatTree",
    pos: { x: -760, y: 791, z: -1190 }, light: "dusk", scrollVh: 200, height: 200 },
  // On the island's top surface (WORLD.island.y), beside the path's end.
  { id: "a7", module: "Creative Strategy", place: "The Sky Island", landmark: "Observatory", mesh: "LM_Observatory",
    pos: { x: OBSERVATORY.x, y: OBSERVATORY.y, z: OBSERVATORY.z }, light: "night", scrollVh: 250, height: 110 },
  // v6: the Stone Arch on the Gate isle (bible 1.20).
  { id: "a8", module: "Job Board", place: "The Gate of the Sun", landmark: "Stone Arch", mesh: "LM_StoneArch",
    pos: { x: GATE.x, y: GATE.y, z: GATE.z }, light: "sunrise", scrollVh: 200, height: GATE.height },
];

// ── World ────────────────────────────────────────────────────────────────────

/** The Gate isle: lone and small, where the Harbour Isle was; y is its TOP. */
const GATE_ISLE = { x: -2250, y: 1600, z: -4300, r: 330 } as const;

export const WORLD = {
  /** Terrain extent. North to -5600 so there is ground (below the cloud sea)
   *  under the flight, the Gate isle and the view past it from a8; the south
   *  stops under the opening camera, which only ever looks north. */
  minX: -4800,
  maxX: 4000,
  minZ: -5600,
  maxZ: 5000,
  seaLevel: 0,
  /** Top of the cloud layer that wraps the peaks outside the high basin. */
  cloudLevel: 1100,
  /** Top surface of the Sky Island. */
  islandLevel: 1650,
  /** No cloud inside this circle: the high basin (lake, forest, the view up to
   *  the island) stays clear. Outside it the cloud layer counts as cover. */
  cloudClear: { x: 150, z: -1150, r: 1750 },
  /** The Mirror Lake: flat water at y, shoreline on the circle. */
  lake: { x: 700, z: -350, r: 650, y: 562 },
  /**
   * v6: the waterfall on the gorge's SOUTH wall, our side. Water leaves the lip
   * heading `flow` (compass degrees: 0 = north, into the gorge, away from the
   * trail) and lands in the pool `throw` units out from the lip. The outward
   * throw grows with the square root of the drop (free fall), which keeps the
   * curtain in front of the 84 degree cliff all the way down. Use
   * fallsCurtainAt(y) for the curtain's centre at any height.
   */
  falls: {
    top: [-100, 405, 1741] as [number, number, number],
    bottom: [-100, 61.5, 1689] as [number, number, number],
    width: 100,
    flow: 0,
    throw: 52,
  },
  /** The plunge pool at the foot of the falls (78 out from the foot, north). */
  pool: { x: -100, z: 1615, r: 92, y: 61.5 },
  /**
   * The Upper Falls, the stream's source (bible 1.4, 2.4): a three step
   * cascade down the west massif's east shoulder, facing east-south-east so
   * the opening sees it whole in its upper left and the a4 ledge sees it over
   * the south rim. Each drop is [x, top y, z, width, fall]: water leaves at
   * (x, top y, z) heading `flow` and falls `fall` onto the next step (the
   * last into the tarn). terrain.ts cuts the steps and the tarn's bowl; the
   * STREAM starts at the tarn.
   */
  upperFalls: {
    flow: 110,
    drops: [
      [-1432, 935, 2032, 64, 142],
      [-1366, 790, 2008, 74, 128],
      [-1300, 660, 1985, 84, 112],
    ] as ReadonlyArray<readonly [number, number, number, number, number]>,
    tarn: { x: -1182, z: 1966, r: 60, y: 545 },
  },
  /**
   * The rock bench on the gorge's north wall (the a4 ledge, bible 1.10): flat
   * at y, from its outer `edge` (a polyline running east to west, the gorge
   * below it to the south) back `depth` into the wall, dropping away in a
   * cliff south of the edge. The edge swings out south-west toward the falls,
   * so from the a4 camera at its east end the pool's sight line leaves the
   * bench within ~95 while the Trail Hut stands ~180 along it. It sits a
   * third of the way up the wall (y 300): from there the whole falls, lip
   * (405) to pool (62), fits one frame with sky over the south rim.
   */
  hikeLedge: {
    edge: [[770, 1194], [612, 1236], [520, 1266], [418, 1262], [372, 1236]] as ReadonlyArray<readonly [number, number]>,
    depth: 62,
    y: 300,
  },
  /**
   * The gully (bible 1.11): an open notch cut down into the Climb's rim at x,
   * its floor rising from (z0, y0) at the Climb's face to (z1, y1) on the rim
   * shelf, halfW of flat floor each side of x, walls rising `wall` per unit
   * out. The camera climbs it heading north to the burst (locked).
   */
  gully: { x: 1436, z0: 1178, y0: 528, z1: 1030, y1: 622, halfW: 28, wall: 3.2 },
  /**
   * The Climb: a sheer straight face on the gorge's north wall, running east-
   * west at constant z so the terrain grid meets it square. The face runs
   * from the floor edge (footZ, y floorY) back to the rim (topZ, y rimY);
   * above it a flat shelf at rimY runs north into the saddle. The gully cuts
   * it at x 1436.
   */
  climb: { x0: 1180, x1: 1720, footZ: 1180, topZ: 1132, floorY: 51, rimY: 622 },
  /**
   * The forest of giant trees (area 6): trunks anywhere in the circle except
   * the clearing, the corridors in FOREST_KEEP_CLEAR, and under the first
   * 300 units of the floating steps. The Great Tree stands in the clearing.
   */
  forest: { x: -560, z: -1090, r: 720, clearing: { x: -720, z: -1110, r: 190 } },
  /** Meadow on the walk from the saddle down to the lake (gentle ground, the brook). */
  meadow: { x: 1450, z: 250, r: 620 },
  /** Sky Island: y is the TOP surface; the rock hangs ~350 below it. */
  island: { x: -2180, y: 1650, z: -1680, r: 600 },
  /** The Ad Bounty isle, tethered off the island's north-east by the rope bridge. */
  bountyIsle: { x: -1640, y: 1610, z: -2420, r: 110 },
  /** v6: the Gate isle, lone and small, y is the TOP surface (bible 1.20). */
  gateIsle: GATE_ISLE,
} as const;

/** How deep the Sky Island's rock hangs below its top surface (for blocks and sight lines). */
export const ISLAND_DEPTH = 350;
/** Same for the bounty isle. */
export const BOUNTY_DEPTH = 120;
/** Same for the Gate isle. */
export const GATE_DEPTH = 240;

/** The falls curtain's centre [x, z] at height y (clamped to the drop). */
export function fallsCurtainAt(y: number): [number, number] {
  const F = WORLD.falls;
  const k = Math.min(1, Math.max(0, (F.top[1] - y) / (F.top[1] - F.bottom[1])));
  const out = F.throw * Math.sqrt(k);
  const b = (F.flow * Math.PI) / 180;
  return [F.top[0] + Math.sin(b) * out, F.top[2] - Math.cos(b) * out];
}

// ── The cave behind the falls ────────────────────────────────────────────────

/**
 * HOW THE CAVE SITS IN A HEIGHTFIELD. terrain.ts is one height per (x, z), so
 * it cannot hold a cave. The cave is a VOID UNDER the terrain surface:
 * terrainHeight is left as it is (the falls cliff and the south shelf above)
 * and stays above the void by at least CAVE_COVER, except at the two portals,
 * where the void breaks the surface: the MOUTH, in the foot of the falls cliff
 * behind the curtain, and the EXIT, on the cliff face ~90 east of the
 * curtain. scene.ts cuts the terrain MESH open at both portals (terrainHeight
 * itself is unchanged). The terrain is drawn front faces only, so from inside
 * the void the surface above is invisible: the camera sees only the void's
 * own walls, which blocks.ts builds (inward-facing, closed except at the
 * portals, with rock frames that cover the cuts' jagged edges).
 */
export const CAVE_COVER = 20;

/**
 * THE MIRROR. v5's cave sat behind a falls on the gorge's NORTH wall with its
 * mouth facing south; v6's falls moved to the SOUTH wall, so the cave moved
 * with them as a mirror image across the plane z = CAVE_MIRROR_Z / 2 (the
 * gorge's centreline at the falls, z 1500): world z = CAVE_MIRROR_Z - build z,
 * bearing = 180 - build bearing. blocks.ts and dress-underground.ts build the
 * hall, its set and the exit passage in the BUILD frame (CAVE_BUILD,
 * CAVE_EXIT_BUILD: the mouth faces +z there) and hang the meshes under a
 * mirror matrix (caveMirrorMatrix in blocks.ts); three.js flips the winding
 * of a mirrored mesh itself. Everything else (the route, the tests, rocks and
 * forest keep-outs) reads the WORLD frame: CAVE, CAVE_EXIT, CAVE_VIEW.
 */
export const CAVE_MIRROR_Z = 3000;
/** A build-frame z (or world z) in the other frame. */
export const caveMirrorZ = (z: number): number => CAVE_MIRROR_Z - z;

/**
 * The cave behind the falls (area 3), in the BUILD frame: v5's numbers. The
 * MOUTH is an arched opening in the cliff's foot, straight behind the
 * curtain: sill at floorY on the cliff's foot line (footZ), mouthHalfW each
 * side of x, mouthH tall. The cliff leans back 1 in 9 (GORGE steepness 9),
 * so the arch's top is mouthH / 9 further in than its sill; the curtain lands
 * ~7 in front of the sill. The HALL behind it is a dome on an elliptical
 * floor: centre (hallX, hallZ), radii rx (x) and rz (z), floor floorY,
 * ceiling hallH at the middle falling to mouthH at the rim.
 */
export const CAVE_BUILD = {
  x: -100,
  footZ: 1300,
  floorY: 64,
  mouthHalfW: 40,
  mouthH: 62,
  hallX: -92,
  hallZ: 1212,
  rx: 88,
  rz: 86,
  hallH: 92,
} as const;

/** The cave in the WORLD frame (the mirror of CAVE_BUILD): the mouth at
 *  footZ 1700 faces north (-z) into the gorge; the hall lies south of it,
 *  inside the south wall. Inside the cave, "in" is +z. */
export const CAVE = {
  ...CAVE_BUILD,
  footZ: caveMirrorZ(CAVE_BUILD.footZ),
  hallZ: caveMirrorZ(CAVE_BUILD.hallZ),
  /** +1: the mouth faces -z and the hall is at larger z (v5: -1). */
  inward: 1,
} as const;

/**
 * The side passage out of the cave (bible 1.8), in the BUILD frame: its
 * floor's centreline [x, floor y, z] from inside the hall's east side to a
 * few units past the cliff face, CAVE_EXIT_HALF_W each side and CAVE_EXIT_H
 * tall (blocks.ts sweeps v5's tunnel arch along it). It climbs gently east
 * and opens on the falls cliff ~90 east of the curtain's east edge.
 */
export const CAVE_EXIT_BUILD: ReadonlyArray<readonly [number, number, number]> = [
  [-8, 64, 1237],
  [16, 66, 1268],
  [34, 70, 1294],
  [42, 73, 1314],
];
/** The side passage in the WORLD frame. Its last point is just outside the
 *  cliff face (the opening), over the gorge floor. */
export const CAVE_EXIT: ReadonlyArray<readonly [number, number, number]> = CAVE_EXIT_BUILD.map((p) => [p[0], p[1], caveMirrorZ(p[2])] as const);
export const CAVE_EXIT_HALF_W = 12;
export const CAVE_EXIT_H = 26;
/** Where the exit passage breaks the cliff face (world): the opening's sill
 *  centre, and the direction out (compass). */
export const CAVE_EXIT_OPENING = { x: 40, y: 72.5, z: 1690, bearing: 16 } as const;
/** How far over the passage floor the camera walks it. */
export const CAVE_EXIT_EYE = 13;

/**
 * The a3 stop: where the camera stands and looks, in the WORLD frame. v5's
 * CAVE_VIEW mirrored (x -66, y 96, build z 1160 -> 1840) and re-aimed so the
 * lit mouth sits at x ~0.55-0.6 as it did in v5 (the mirror put it at ~0.46).
 */
export const CAVE_VIEW = { x: -66, y: 96, z: 1840, bearing: 343.5, pitch: 0 } as const;

/** Signed distance from (x, y, z) to the nearest wall of the cave's voids
 *  (union of the mouth passage, the hall and the exit passage), WORLD frame:
 *  positive inside, negative outside. Cheap; for checks, not per frame. */
export function caveMargin(x: number, y: number, z: number): number {
  const C = CAVE_BUILD;
  // Into the build frame.
  const bz = caveMirrorZ(z);
  let best = -Infinity;
  // The mouth passage: the arch's box, from 14 outside the cliff's foot (past
  // the curtain) to where it opens into the hall.
  {
    const m = Math.min(C.mouthHalfW - Math.abs(x - C.x), y - C.floorY, C.floorY + C.mouthH - y, C.footZ + 14 - bz, bz - (C.footZ - 40));
    if (m > best) best = m;
  }
  // The hall: elliptical floor, dome roof.
  {
    const ex = (x - C.hallX) / C.rx;
    const ez = (bz - C.hallZ) / C.rz;
    const r = Math.hypot(ex, ez);
    const side = (1 - r) * Math.min(C.rx, C.rz);
    const roof = C.floorY + Math.max(C.mouthH, C.hallH * Math.sqrt(Math.max(0, 1 - r * r))) - y;
    const m = Math.min(side, y - C.floorY, roof);
    if (m > best) best = m;
  }
  // The exit passage: distance to its centreline in plan, floor and roof by segment.
  {
    const E = CAVE_EXIT_BUILD;
    for (let i = 0; i < E.length - 1; i++) {
      const a = E[i];
      const b = E[i + 1];
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const l2 = dx * dx + dz * dz;
      const ur = ((x - a[0]) * dx + (bz - a[2]) * dz) / l2;
      const u = ur < 0 ? 0 : ur > 1 ? 1 : ur;
      const d = Math.hypot(x - a[0] - dx * u, bz - a[2] - dz * u);
      const fy = a[1] + (b[1] - a[1]) * u;
      const m = Math.min(CAVE_EXIT_HALF_W - d, y - fy, fy + CAVE_EXIT_H - y);
      if (m > best) best = m;
    }
  }
  return best;
}

/**
 * The Great Tree (area 6, blocks.ts): its top is ~pos.y + height and its
 * crown spreads crownR. It stands on the line from the Mirror Lake to the Sky
 * Island: seen in the lake from the a5 stop, a taller crown hides the
 * island's reflection, the island's first appearance. So it is 240, and
 * every tree within 260 of it is held to half that.
 */
export const GREAT_TREE = { height: 240, crownR: 108 } as const;

// ── Water lines ──────────────────────────────────────────────────────────────

/** v6: the river from the new plunge pool down the gorge to the east sea,
 *  [x, water y, z]; v5's course from x 1000 on. */
export const RIVER: ReadonlyArray<readonly [number, number, number]> = [
  [-100, 61.5, 1615],
  [60, 61, 1572],
  [250, 60.2, 1522],
  [520, 58.8, 1478],
  [1000, 55.5, 1430],
  [1450, 50.5, 1420],
  [1800, 47, 1400],
  [2200, 39.5, 1370],
  [2800, 23.5, 1420],
  [3400, 4, 1470],
  [4100, -1, 1500],
];

/** v6: the stream that feeds the falls, on OUR side: from the Upper Falls'
 *  tarn east along the south shelf and north over the lip: [x, water y, z]. */
export const STREAM: ReadonlyArray<readonly [number, number, number]> = [
  [-1182, 545, 1966],
  [-960, 530, 1950],
  [-720, 470, 1905],
  [-500, 432, 1868],
  [-330, 414, 1850],
  [-190, 406.5, 1825],
  [-118, 405.5, 1790],
  [-100, 405, 1741],
];

/** v6: the brook down the meadow from the saddle into a reed inlet on the
 *  lake's east shore, meandering (Lovro: "the little river from the side
 *  looks super random"): [x, water y, z]. Every water y sits under the
 *  meadow's ground there (terrain.ts carves its bed). */
export const BROOK: ReadonlyArray<readonly [number, number, number]> = [
  [1600, 640, 640],
  [1548, 626, 540],
  [1600, 612, 430],
  [1538, 600, 320],
  [1580, 590, 205],
  [1512, 580, 95],
  [1500, 574, 0],
  [1440, 568, -95],
  [1390, 564, -160],
  [1345, 562, -215],
];

/**
 * The glowing stream (bible 1.15): from a spring in the Great Tree's roots
 * down through the forest to the lake's west shore, [x, water y, z]. Teal
 * where magicAt is high, plain water by the shore (water.ts's ribbon).
 */
export const GLOW_STREAM: ReadonlyArray<readonly [number, number, number]> = [
  [-728, 792, -1150],
  [-640, 783, -1040],
  [-520, 768, -965],
  [-360, 738, -900],
  [-190, 700, -850],
  [-40, 650, -760],
  [40, 590, -660],
  [72, 563, -606],
];

/**
 * The Glowing Forest's field (bible 1.15, decision 31): 0 at the lake's west
 * shore and in ordinary forest, 1 in the Great Tree's clearing, with a noisy,
 * lobed edge that follows the valley up the slope (never a circle).
 * Everything magical reads it: tree species, glow, ground, fireflies, mist.
 * Allocates nothing.
 */
export function magicAt(x: number, z: number): number {
  const C = WORLD.forest.clearing;
  // The axis: from where the glowing stream enters the lake up to the clearing.
  const ax = 72;
  const az = -606;
  const dx = C.x - ax;
  const dz = C.z - az;
  const L = Math.hypot(dx, dz);
  const px = x - ax;
  const pz = z - az;
  const along = (px * dx + pz * dz) / (L * L);
  const side = Math.abs(px * dz - pz * dx) / L;
  // Lobes: three octaves of crossed sines, so the edge wanders.
  const n =
    0.5 * Math.sin(x * 0.0111 + z * 0.0073 + 0.4) +
    0.3 * Math.sin(x * 0.0231 - z * 0.0187 + 1.7) +
    0.2 * Math.sin(-x * 0.0413 + z * 0.0371 + 4.1);
  // The region widens toward the tree and reaches back up the slope past it.
  const u = along + 0.1 * n;
  const width = 430 + 330 * Math.min(1, Math.max(0, along)) + 120 * n;
  const lat = 1 - smooth01((side - width * 0.5) / (width * 0.5));
  const up = u < 1 ? smooth01(u) : 1 - smooth01((u - 1.25) / 0.5);
  let m = up * lat;
  const dc = Math.hypot(x - C.x, z - C.z);
  if (dc < C.r * 1.4) m = Math.max(m, 1 - smooth01((dc - C.r) / (C.r * 0.4)));
  return m < 0 ? 0 : m > 1 ? 1 : m;
}
function smooth01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * The gorge centreline: [x, z, floor y, floor half-width, north wall steepness,
 * south wall steepness]. Steepness is rise per unit out from the floor edge
 * (9 is ~84 degrees, the falls cliff; 12 is ~85, the Climb's face). v6: the
 * falls cliff is the SOUTH wall at x -100; the north wall between x 0 and
 * 1,150 is a talus foot and stacked cliff bands (terrain.ts NORTH_BANDS),
 * with the rock spur (WORLD.hikeLedge). Between x 1180 and 1720 the
 * centreline is straight at z 1360, so the Climb's face (WORLD.climb) is one
 * straight wall.
 */
export const GORGE: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [-380, 1480, 68, 150, 6, 6],
  [-100, 1500, 62, 200, 4.2, 9],
  [250, 1480, 61, 200, 4.4, 6],
  [600, 1455, 59, 190, 3.6, 3.4],
  [1000, 1400, 56, 180, 3.4, 3.2],
  [1180, 1360, 54, 180, 12, 3],
  [1720, 1360, 48, 180, 12, 3],
  [2200, 1360, 40, 170, 3.5, 3.5],
  [2800, 1420, 24, 180, 3.5, 3.5],
  [3400, 1470, 5, 200, 3, 3],
  [4100, 1500, -30, 230, 3, 3],
];

// ── The walking trail ────────────────────────────────────────────────────────

/**
 * The trail on the ground (and on the steps, the islands and the bridge),
 * shore to the airship's gangway: where lanterns, the post line and the
 * handrail go. `carve` flattens a bench into the terrain along the segment
 * from this point to the next (and cuts the saddle); it is off from the
 * stream's bank to the gully's top, and everything floating. The Gate isle's
 * own path is GATE_CAUSEWAY.
 */
export interface PathPoint {
  x: number;
  y: number;
  z: number;
  carve: boolean;
  /** The segment from this point to the next has NO trail on the ground: it
   *  runs underground (the cave and its side passage) or through the air (the
   *  ride down the falls). No trail, no lanterns, no cover skip. */
  under: boolean;
}
const P = (x: number, y: number, z: number, carve = true, under = false): PathPoint => ({ x, y, z, carve, under });

/** The floating steps: the foot beside the Great Tree and the top in the Sky Island's cove. */
export const STEPS_FOOT: readonly [number, number, number] = [-882, 830, -1047];
export const STEPS_TOP: readonly [number, number, number] = [-1833, 1648, -1356];

/**
 * The Sky Island's top (bible 1.17, the stargazer's island), all on the top
 * surface (y WORLD.islandLevel). ISLAND_PATH is the one path: from the cove
 * where the steps arrive, north-west up to the terrace (the observatory
 * beside its end), then on as the fork to the lookout bench on the island's
 * north-east tip and the rope bridge's head. ISLAND_LOOKOUT is the bench
 * (facing out, `facing`).
 */
export const ISLAND_PATH: ReadonlyArray<readonly [number, number, number]> = [
  [STEPS_TOP[0], 1650, STEPS_TOP[2]],
  [-1905, 1650, -1428],
  [-1980, 1650, -1508], // the terrace, the path's end; the observatory beside it
  [-1955, 1650, -1640], // the fork
  [-1840, 1650, -1860],
  [-1778, 1650, -2000], // the lookout bench on the north-east tip
  [-1848, 1650, -2154], // the rope bridge's head (BRIDGE.a)
];
export const ISLAND_LOOKOUT = { x: -1772, y: 1650, z: -2012, facing: 40 } as const;
/** The spring in a stone basin by the terrace, and its two rills to the rim:
 *  north-east and west. Each rill's last point is on the rim, where the
 *  island's falls leave (water.ts), and they cross ISLAND_PATH under slab
 *  bridges (dress-sky.ts). */
export const ISLAND_SPRING = { x: -1996, y: 1650, z: -1580 } as const;
export const ISLAND_RILLS: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [
    [-1996, 1650, -1580],
    [-1905, 1650, -1655],
    [-1800, 1650, -1760],
    [-1668, 1650, -1880],
  ],
  [
    [-1996, 1650, -1580],
    [-2110, 1650, -1590],
    [-2330, 1650, -1640],
    [-2560, 1650, -1700],
  ],
];

/**
 * The telescope (bible 1.17): its pivot on the observatory, aimed at the
 * Creative Strategy constellation (SKY_MARKS[6]): azimuth `az` (compass),
 * elevation `el` (degrees up), tube `length`. The a7 park flies along its
 * axis into the sky (scene.ts).
 */
export const TELESCOPE = { pivot: [OBSERVATORY.x, OBSERVATORY.y + 58, OBSERVATORY.z] as [number, number, number], az: 300, el: 31, length: 63 } as const;

/**
 * The eight constellations (bible 1.17): one per place, drawn as its
 * landmark; the centre of each on the sky (az compass, el degrees up) and its
 * angular size (degrees across). Spread so 4 show in the a7 frame (az ~276 to
 * 324, el ~0 to 36) and all 8 over the island's sky. Index = place index.
 */
export const SKY_MARKS: ReadonlyArray<{ id: PlaceId; shape: string; az: number; el: number; size: number }> = [
  // Fix round 3: the first three sit in the a7 frame (bearing 46, 8 up),
  // upper left of the telescope and over the dome, so the frame shows the
  // student's finished areas as drawn shapes and the current one lighting up.
  { id: "a1", shape: "signpost", az: 30, el: 8, size: 6 },
  { id: "a2", shape: "lookout", az: 43, el: 21.5, size: 6 },
  { id: "a3", shape: "waterfall", az: 65, el: 9, size: 6 },
  { id: "a4", shape: "trail hut", az: 266, el: 40, size: 9 },
  { id: "a5", shape: "boathouse", az: 283, el: 17, size: 9 },
  { id: "a6", shape: "great tree", az: 318, el: 19, size: 10 },
  { id: "a7", shape: "telescope", az: TELESCOPE.az, el: TELESCOPE.el, size: 11 },
  { id: "a8", shape: "arch", az: 336, el: 38, size: 10 },
];

/**
 * The trail, shore to the gangway. The middle is v6's: the camp, the
 * stream's bank to the lip; the ride (no trail); the pool's east shore, the
 * cave and its side passage (no trail); the log over the river; the talus;
 * switchbacks up the north wall to the spur and the hut; the traverse east;
 * the gully; then v5's from the rim shelf on.
 */
export const PATH: readonly PathPoint[] = [
  P(1335, 4, 4262), // dock foot
  P(1300, 5, 4170), // signpost
  P(1180, 28, 3900),
  P(980, 50, 3560),
  P(730, 80, 3200),
  P(520, 105, 2930),
  P(440, 128, 2720), // base camp (the lookout is on its knoll ~100 west)
  P(330, 165, 2560),
  P(170, 262, 2330),
  P(0, 352, 2130),
  P(-170, 420, 1985, false), // meets the stream (~400 before the lip)
  P(-250, 424, 1880, false), // along the stream's bank
  P(-150, 412, 1822, false),
  P(-112, 410, 1782, false, true), // the lip; the ride down has no trail
  P(-30, 63, 1580, false), // the pool's east shore
  P(-44, 63, 1676, false, true), // the cliff's foot east of the curtain; into the cave (no trail)
  P(-100, 64, 1702, false, true), // the cave's mouth, behind the curtain (CAVE)
  P(-92, 64, 1788, false, true), // the hall (the a3 stop looks back out from here)
  ...CAVE_EXIT.slice(0, CAVE_EXIT.length - 1).map((e) => P(e[0], e[1], e[2], false, true)),
  P(CAVE_EXIT_OPENING.x, CAVE_EXIT_OPENING.y, CAVE_EXIT_OPENING.z, false), // the exit, on the cliff face
  P(64, 63, 1640, false), // down to the river's bank
  P(62, 64, 1608, false), // the log's south end
  P(52, 64, 1538, false), // the log's north end
  P(130, 66, 1420, false), // the talus fan
  P(236, 72, 1290, false), // the foot of the north wall
  // Switchbacks up the banded wall (bible 1.9), a cairn at each bend.
  P(430, 150, 1258, false),
  P(290, 226, 1212, false),
  P(400, 300, 1236, false), // onto the bench's west end
  P(TRAIL_HUT.x, TRAIL_HUT.y, TRAIL_HUT.z - 18, false), // past the Trail Hut's door
  P(720, 300, 1190, false), // the bench's east end (the a4 camera stands over it)
  // The rising traverse east, cut into the wall, the handrail on posts.
  P(900, 380, 1090, false),
  P(1060, 460, 1036, false),
  P(1180, 522, 1138, false),
  P(1400, 544, 1142, false), // along the Climb's face to the gully's mouth
  P(1436, 552, 1146, false),
  P(1436, 590, 1094, false), // up the gully: rock steps and a fixed rope
  P(1436.09, 622, 1041.5625), // the gully's top on the Climb's rim shelf (a cairn, where v5's shaft collar was); into the saddle
  P(1420, 632, 920),
  P(1450, 650, 720), // the saddle
  P(1440, 632, 480),
  P(1420, 606, 240),
  P(1395, 585, 10),
  P(1372, 570, -220),
  P(1350, 566, -440), // jetty foot on the east shore
  P(1300, 572, -720),
  P(1000, 580, -1010),
  P(560, 598, -1110),
  P(150, 640, -1090),
  P(-200, 700, -1060),
  P(-480, 755, -1070),
  P(-700, 790, -1110), // in front of the Great Tree
  P(STEPS_FOOT[0], STEPS_FOOT[1], STEPS_FOOT[2], false), // foot of the floating steps
  ...ISLAND_PATH.slice(0, ISLAND_PATH.length - 1).map((p) => P(p[0], p[1], p[2], false)),
  // The rope bridge (BRIDGE), then across the bounty isle to the gangway.
  P(-1848, 1650, -2154, false),
  P(-1695, 1610, -2341, false),
  P(-1640, 1610, -2420, false),
  P(-1575, 1610, -2512, false), // the gangway: your airship's stern (SHIP_MOORED)
];

/** The Gate isle's causeway (bible 1.20): from the stone dock at the docked
 *  ship's bow, flagstones climbing north-west to the Stone Arch. */
export const GATE_CAUSEWAY: readonly PathPoint[] = [
  P(GATE_DOCK.x, GATE_DOCK.y, GATE_DOCK.z, false), // the dock's head, at the ship's bow (SHIP_DOCKED)
  P(-2110, 1600, -4130, false),
  P(-2200, 1600, -4246, false),
  P(-2270, 1600, -4335, false),
  P(GATE.x, GATE.y, GATE.z, false), // the arch's threshold
];

/**
 * The floating steps from the forest floor to the island's cove: [x, y, z]
 * of each slab's centre, evenly spaced on the straight line STEPS_FOOT ->
 * STEPS_TOP (rise 818 over 1,000 horizontal, ~39 degrees; slabs ~64 apart),
 * so from behind the first step they line up up the middle of the frame.
 */
export const STEPS: ReadonlyArray<readonly [number, number, number]> = (() => {
  const [ax, ay, az] = STEPS_FOOT;
  const [bx, by, bz] = STEPS_TOP;
  const n = Math.round(Math.hypot(bx - ax, by - ay, bz - az) / 64);
  const out: [number, number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    out.push([ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u]);
  }
  return out;
})();

/**
 * The rope bridge's deck: from `a` on the Sky Island's rim to `b` on the
 * bounty isle, planks `width` wide, sagging `sag` at the middle. Deck height
 * at u (0 at a, 1 at b) along the straight line a->b is bridgeDeckAt(u).
 * The camera walks it BRIDGE_EYE above the deck, on its centreline.
 */
export const BRIDGE = {
  a: [-1848, 1650, -2154] as [number, number, number],
  b: [-1695, 1610, -2341] as [number, number, number],
  width: 8.5,
  sag: 18,
} as const;
export const BRIDGE_EYE = 12;
export function bridgeDeckAt(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return BRIDGE.a[1] + (BRIDGE.b[1] - BRIDGE.a[1]) * t - BRIDGE.sag * 4 * t * (1 - t);
}

/**
 * Your airship. Its origin is the centre of its deck, at deck level; its
 * nose points along `heading`. The camera rides it standing SHIP.camBack
 * behind the origin and SHIP.camUp above the deck, so the bow (SHIP.length / 2
 * ahead of the origin) sits in the lower frame. Moored at the bounty isle
 * with its stern on the isle's rim, docked at the Gate isle with its bow on
 * the stone dock (GATE_DOCK). During the flight the ship's origin is
 * shipFromCamera(...) of the rail's camera position and its travel direction.
 */
export const SHIP = { length: 120, camBack: 40, camUp: 13 } as const;
export const SHIP_MOORED = { x: -1545.9, y: 1610, z: -2554.3, heading: 35 } as const;
export const SHIP_DOCKED = { x: -2004.3, y: 1600, z: -3997.6, heading: 320 } as const;

/** Where the camera stands on the ship when the ship is at `pose`. */
export function shipCamera(pose: { x: number; y: number; z: number; heading: number }): [number, number, number] {
  const b = (pose.heading * Math.PI) / 180;
  return [pose.x - Math.sin(b) * SHIP.camBack, pose.y + SHIP.camUp, pose.z + Math.cos(b) * SHIP.camBack];
}

/** The ship's pose for a camera standing on it at (x, y, z) while travelling
 *  toward compass `heading` (the rail's direction of travel, degrees). */
export function shipFromCamera(x: number, y: number, z: number, heading: number): { x: number; y: number; z: number; heading: number } {
  const b = (heading * Math.PI) / 180;
  return { x: x + Math.sin(b) * SHIP.camBack, y: y - SHIP.camUp, z: z - Math.cos(b) * SHIP.camBack, heading };
}

/**
 * Corridors the forest keeps clear of trunks, [x0, z0, x1, z1, half width]:
 * the camera's way through the trees, and the a6 camera's sight line to the
 * Great Tree. Trees stay out of these; canopies may close overhead.
 */
export const FOREST_KEEP_CLEAR: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [260, -990, -60, -1040, 60],
  [-60, -1040, -330, -1060, 60],
  [-330, -1060, -760, -1010, 70],
  [-150, -1015, -760, -1190, 60], // the a6 view to the Great Tree
  [-760, -1010, -1150, -1135, 70], // under the first steps
];

// ── The camera route ─────────────────────────────────────────────────────────

/** Look targets sit this far from the camera along its view direction. */
export const LOOK_DIST = 520;

/**
 * Scroll pace by kind: scroll spent per unit of travel, relative to a walk.
 * The rail spends each stretch's scrollVh in proportion to the integral of
 * pace over distance, so the ride, the rise and the bridge take longer to
 * scroll through than their length alone would give them, and the hike and
 * the flight go by faster.
 */
export const PACE: Readonly<Record<TrailKind, number>> = {
  walk: 1,
  dive: 5.4,
  hike: 2.6,
  climb: 3.2,
  rise: 1.8,
  sky: 1.1,
  bridge: 2.2,
  board: 1.4,
  flight: 0.5,
  // Final pass: 1.7 -> 1.2, so the two passes through the curtain (in, and
  // back out) go by in a few frames each instead of a smear of cream.
  // RETIRED 2026-10-13 with the kind (see TrailKind): no key is paced by it.
  cave: 1.2,
};

/** Clearance over the ground the rail keeps at a key (bible 1.0): 35 on the
 *  walks; 20 at a stop, the keys next to it and the opening, where the camera
 *  comes down low. Terrain follow reads it per key (rail.ts). */
export const WALK_CLEAR = 35;
export const STOP_CLEAR = 20;

interface Key {
  x: number;
  y: number;
  z: number;
  /** Compass bearing of the view, degrees. */
  bearing: number;
  /** Degrees below the horizon; negative looks up. */
  pitch: number;
  kind: TrailKind;
  stop?: PlaceId;
  /** Vertical lens at this key, degrees (KEY_FOV); default STOP_FOV / DESIGN_FOV. */
  fov?: number;
  /** Scroll pace at this key, overriding PACE[kind] (the keys that pass the falls: FALLS_PACE). */
  pace?: number;
}
const K = (x: number, y: number, z: number, bearing: number, pitch: number, kind: TrailKind = "walk", stop?: PlaceId, fov?: number): Key =>
  ({ x, y, z, bearing, pitch, kind, stop, fov });
/** Final pass D: the camp in the cave hall is walked slower than the two
 *  passes through the curtain (PACE.cave), so the camp holds the frame for a
 *  while and the view's turn toward it stays gentle.
 *  RETIRED 2026-10-13 with the cave pass (see TrailKind "cave"): no key has
 *  this pace. Kept, and exported so it is not an unused name, for whoever
 *  brings the camera back into the hall; the H(...) wrapper that put it on a
 *  row went with the rows. */
export const HALL_PACE = 3;
/** The keys either side of the curtain: quicker than PACE.cave, so the slow
 *  hall (its pace blurs ~70 units along the rail) doesn't stretch the two
 *  passes through the water.
 *  RETIRED 2026-10-13 with the cave pass, as HALL_PACE (its wrapper was F). */
export const CURTAIN_PACE = 0.7;
/**
 * 2026-10-13, the a3 -> a4 move: the keys that pass the falls (the camera
 * ~340 from the curtain, the view turning with them at ~0.15 degrees per unit)
 * are walked slower than PACE.walk, so the view turns at an even rate in
 * scroll. At a walk's pace the turn peaked at 1.5 degrees per vh abeam of the
 * falls; with this it holds 0.75 to 1.25 from a3 to the Trail Hut's bench
 * (the cave pass peaked at 1.42). The camera does 7 to 9 units per vh past the
 * falls and 12 on the pull back (the walks either side of the stretch: 9 to 12).
 */
const FALLS_PACE = 1.4;
const S = (k: Key): Key => ({ ...k, pace: FALLS_PACE });

// The rise: keys along the steps' line, `d` horizontal units past the foot, `up` above the line.
const stepLine = (d: number, up: number): [number, number, number] => {
  const [ax, ay, az] = STEPS_FOOT;
  const [bx, by, bz] = STEPS_TOP;
  const L = Math.hypot(bx - ax, bz - az);
  const u = d / L;
  return [ax + (bx - ax) * u, ay + (by - ay) * u + up, az + (bz - az) * u];
};
const STEPS_BEARING = (Math.atan2(STEPS_TOP[0] - STEPS_FOOT[0], -(STEPS_TOP[2] - STEPS_FOOT[2])) * 180) / Math.PI + 360;
// The bridge: keys on its centreline at u, BRIDGE_EYE above the deck.
const onBridge = (u: number): [number, number, number] => [
  BRIDGE.a[0] + (BRIDGE.b[0] - BRIDGE.a[0]) * u,
  bridgeDeckAt(u) + BRIDGE_EYE,
  BRIDGE.a[2] + (BRIDGE.b[2] - BRIDGE.a[2]) * u,
];
const BRIDGE_BEARING = (Math.atan2(BRIDGE.b[0] - BRIDGE.a[0], -(BRIDGE.b[2] - BRIDGE.a[2])) * 180) / Math.PI;
/** The a7 sky frame (bible 1.17): on the path ~260 from the observatory
 *  (at 160, as the bible's start values had it, the dome sat mid-frame when
 *  looking up 16-20), 40 over the island, looking up 18 at the sky with the
 *  dome and telescope in the lower third at x ~0.6. It absorbs v5's star
 *  look; STAR_KEY is its index. Fix round 1 (judge 1): at 16.5 up only the
 *  dome's top showed on the bottom edge. Now ~60 farther back, 12 higher, 12
 *  up through a 40 lens: the whole observatory with its lit windows and the
 *  terrace sit in the lower quarter at x ~0.6, the moon whole in the upper
 *  right, sky ~80% (fix-1-frame/a7-t2). Fix round 3: that pose looked
 *  along the telescope's aim, so the tube foreshortened into a stub. The
 *  stop now stands 290 south west of the observatory (bearing 235 from it,
 *  90 off the tube's aim of 300), ~20 over the island, looking up 6 at bearing
 *  46: the tube is a long diagonal reaching up left across the aurora, the
 *  Milky Way crosses behind the dome, the terrace clears the timeline
 *  (fix-3-frame/a7-*). The moon, the aurora and three constellations moved
 *  into this view (light.ts NIGHT_MOON, nightsky.ts AURORA, SKY_MARKS).
 *  Round 1 (Lovro's second walkthrough, decision 46: "waaay too much sky"):
 *  the stop looks up 3 instead of 6, from 30 higher (~58 over the island)
 *  through a 42 lens, so the island's top reads (the path, the spring's rill,
 *  the rim and the cloud sea past it) with the observatory at x ~0.65 and the
 *  aurora across the top; sky ~55% (shots/v6/round1/route2). The telescope
 *  park stays the one sky moment. */
export const STAR_LOOK = { x: -2300, y: 1708, z: -1384, bearing: 46, pitch: -3, fov: 42 } as const;
const MOORED_CAM = shipCamera(SHIP_MOORED);
const DOCKED_CAM = shipCamera(SHIP_DOCKED);
/** The shaft's old centre: the burst's keys (locked) are written in it. */
const BURST = { x: 1436.09, z: 1041.5625 } as const;

/**
 * Round 1: the a3 stop stands OUTSIDE the falls (Lovro, decision 46). Final
 * pass: it moved from facing the cliff (the falls at x 0.42, 10% sky, two flat
 * walls over 70% of the frame) to looking down the gorge from the pool's west
 * end: the whole falls, lip to pool, on the right wall, the gorge running away
 * east into the low gold haze on the left with the sky over it, the pool and
 * its foam across the bottom, the lit north wall against the shaded south
 * one (shots/v6/finalA/route). From here the dolly into the curtain goes
 * straight ahead.
 */
export const A3_VIEW = { x: -325, y: 130, z: 1416, bearing: 128, pitch: -13, fov: 58 } as const;

/**
 * Hand placed click in views (the park), for the places where the park solver
 * cannot frame what matters: a3's is the falls from the same side, closer,
 * lip to foam in the lens the park uses (DESIGN_FOV), still outside (Lovro:
 * "you would see outside of the waterfall"). Final pass: it stood ~250 from
 * the curtain, so the curtain filled the frame and its streaks read smeared.
 * Position, compass bearing, pitch below the horizon.
 */
export const PARK_VIEWS: Partial<Record<PlaceId, { x: number; y: number; z: number; bearing: number; pitch: number; fov?: number }>> = {
  // Final pass B (the art and experience judges: "half a frame of flat beige
  // curtain against a wall of rectangles, no sky, pool or spray", the weakest
  // frame on the map): 170 further west on the gorge floor, 18 lower, turned
  // 27 toward the gorge, through its own 50 lens (the park's 31 could only
  // hold the curtain). The falls stand lip to foam on the right third, the
  // pool runs along the bottom, the lit wall leads away left into the haze
  // under open sky, where the panel sits (shots/v6/finalB/route).
  a3: { x: -470, y: 112, z: 1440, bearing: 110, pitch: -14, fov: 50 },
  // Final pass C (the experience judge): a1's solved click in looked down 24
  // from 80 up, a board game seen from above. Now ~25 over the sand south
  // east of the signpost, looking up 3 along the trail: the signpost at x
  // ~0.75 against the valley, the ridges and the sky (shots/v6/finalC/route/parkx).
  // Final pass D: from there the campfire (1340, 4206) stood on the line to
  // the signpost, so its smoke column rose across the post, and the falls'
  // plume sat behind it (the post landed at x ~0.47). Now ~120 due south of
  // the post, looking 352: the fire is off the right edge, the plume behind
  // the panel on the left, and the post stands at x ~0.7 against the ridges,
  // the peak and open sky, the trail curving past the tent to it
  // (shots/v6/finalD/route/park-a1, final/park_a1.png).
  a1: { x: 1290, y: 26, z: 4292, bearing: 352, pitch: -3, fov: 40 },
  // a5's solved click in stood behind the shore pines, one of them a black
  // slice through the boathouse. Now out over the water on the stop's line,
  // closer and lower: the boathouse at x ~0.68 with its jetty and boat, the
  // Great Tree over it, no pine in the frame (shots/v6/finalC/route/parkx).
  a5: { x: 1330, y: 610, z: -300, bearing: 298, pitch: 8, fov: 40 },
};

/** Named rows of KEYS (M), for tests and renders: ROUTE_MARKS name -> KEYS index. */
const MARK_OF = new Map<Key, string>();
const M = (name: string, k: Key): Key => {
  MARK_OF.set(k, name);
  return k;
};

/**
 * The camera route, one key per row. The rail runs a centripetal Catmull-Rom
 * through the positions and another through the look targets, both at the
 * same curve parameter, so LOOK[i] is exactly the target when the camera is
 * at TRAIL[i]. v6: the stops come down low (20-60 over the ground, looking
 * level or up); between them the camera rides 50-120 over the ground.
 * LOCKED rows (v6-locked.mjs checks them against v5 byte for byte): the burst
 * onward to a6, the rise, the bridge and the flight.
 */
const KEYS: readonly Key[] = [
  // THE OPENING (bible 1.1): low over the bay's east side, the islet's boulders
  // reaching into the lower right, looking up the valley at the plume and the
  // Upper Falls with 40-55% sky. Wide lens (KEY_FOV). B9: 9.5 up keeps the sea
  // under a fifth of the frame (measured 44% sky, 17% sea at 1691x1278).
  // Fix round 1 (judge 1): a tighter lens (40 -> 34) so the plume, the
  // Landing and the valley grow; the camera backs off ~80 south east so the
  // islet's boulders sit inside the lower right as the dark near shape instead
  // of one face filling the edge (measured 45.6% sky, 13% sea, plume x ~0.62).
  K(1692, 30, 5030, 328, -9, "walk", undefined, 34),
  K(1420, 28, 4700, 330, -9, "walk", undefined, 39),
  // a1 (bible 1.2): low by the dock's head, ~260 from the signpost, the
  // signpost at x ~0.62, looking up 9.5 so the sky over the col shows (34%).
  // 21 over the water, just over the stop's clearance (20).
  // Final pass B (the art judge): from (1400, 4420) a dock pole cut the frame
  // top to bottom at x 0.51 and a cabin roof cropped the bottom right. 35 west
  // along the shore (bearing 331 -> 333.5 to keep the signpost at x ~0.73) the
  // pole line runs thin and far behind the signpost and the roof is out.
  K(1369, 21, 4437, 333.5, -9.5, "walk", "a1", 38),
  // Up the coastal valley to Base Camp, 70-130 over the ground.
  K(1290, 104, 4130, 336, 1),
  K(1090, 150, 3790, 334, 1),
  K(880, 196, 3440, 332, 0),
  K(560, 196, 3100, 340, -2),
  // a2 (bible 1.3): low in the flower meadow ~170 south of the lookout,
  // looking up 18 at it against the sky over the col (the col's skyline is
  // 14-16 up on bearings 355-10 from here; the high ridge west of it, 27-30
  // up, keeps hiding the Sky Island). Lens 42 (B9: 40% sky).
  K(330, 130, 2930, 359, -18, "walk", "a2", 42),
  // Past the camp and up to the stream's woods (west of the lookout).
  K(230, 300, 2650, 335, -6),
  K(95, 378, 2400, 336, -6),
  // Round 1 (Lovro's second walkthrough, decision 46): the stream straight to
  // the lip and straight over. v6 hooked west to meet the stream's bank and
  // swung the view 342 -> 28 -> 52 -> 25 round the top of the falls; now the
  // view holds 350-2 and the camera goes over the edge heading north.
  M("stream", K(-40, 440, 2170, 8, -3)),
  K(-85, 452, 1990, 12, -1),
  K(-100, 440, 1862, 15, 2),
  // THE RIDE (bible 1.5): at the lip over the glassy tongue, then over the
  // edge and down in front of the curtain with no yaw, looking down the falls:
  // the curtain's streaks run from the bottom edge of the frame to the pool.
  M("lip", K(-102, 422, 1792, 16, 2, "dive", undefined, 48)),
  K(-102, 416, 1730, 16, 40, "dive", undefined, 46),
  M("fall", K(-104, 360, 1704, 15, 64, "dive", undefined, 48)),
  K(-106, 270, 1683, 12, 71, "dive", undefined, 50),
  // Final pass B (the experience judge: "a top-down view of a flat teal
  // disc"): the last dive key looks down 52 (was 63) and the pool key 24 (was
  // 38), so the pool is seen at an angle with the gorge beyond; the ride's
  // peak (71, over the falls) is unchanged.
  K(-106, 180, 1658, 8, 52, "dive", undefined, 50),
  // THE TURN AT THE POOL (final pass): level out over the pool heading north,
  // then ONE turn to the right while drifting back west over the gorge floor:
  // past the lit downstream gorge (east, the sun behind) round to the falls
  // from the pool's west end. Round 1 banked left through the upstream end,
  // which is in its own shade at this hour (the dark turn).
  M("pool", K(-100, 125, 1614, 8, 24, "dive", undefined, 48)),
  K(-180, 124, 1566, 40, 4, "walk", undefined, 52),
  M("turn", K(-360, 126, 1500, 88, -4, "walk", undefined, 56)),
  // a3 (final pass): OUTSIDE, at the pool's west end, looking down the gorge:
  // the whole falls on the right wall at x ~0.7, the gorge and its sky on the
  // left. Its click in is the authored PARK_VIEWS.a3.
  K(A3_VIEW.x, A3_VIEW.y, A3_VIEW.z, A3_VIEW.bearing, A3_VIEW.pitch, "walk", "a3", A3_VIEW.fov),
  // a3 TO a4, ONE MOVE (2026-10-13, Lovro: "the camera between Video Ads 1 and
  // Video Ads 2 goes into the cave for no reason. Just going straight from
  // Video Ads 1 screen to Video Ads 2 and giving it a nice path"). From the a3
  // view the camera drifts east along the gorge's north side, ~340 from the
  // curtain, the falls passing on its right and kept at x 0.63 to 0.67 (0.69
  // at the stop; the panel is on the left), lip to pool in the frame through a
  // wide lens while they are close; then it pulls back and rises to the Trail
  // Hut's bench and the falls slide to the middle as the hut comes in on the
  // right. The view turns right only, 128 to 244.5, 0.75 to 1.25 degrees per
  // vh all the way to the bench (S: FALLS_PACE on the keys that pass the falls);
  // it never faces a wall with no falls or sky in it, never the ground.
  // WHAT IT WAS, from the final pass (decision 53) until then: a dolly from a3
  // straight into the curtain, ten "cave" keys (through the water, a shallow
  // loop past the camp's string lights in the hall, back out through the
  // water), the mark "back" in front of the falls, then the pull back and rise
  // across the gorge. That was Lovro's own earlier call ("go in and then
  // directly up to video ads 2 without doing any turning stuff", decision 46);
  // this one replaces it. The old rows are in git at 0ad0646 and their frames
  // in world-tests/shots/v6/a3a4/before/. The cave, its camp and its side
  // passage are still built (blocks.ts, dress-underground.ts). From outside
  // the curtain hides them: at 280 or more away the gaps in the water show
  // dark, so nothing on the route shows the camp any more.
  // 15 ROWS ON PURPOSE, as many as the cave pass had: rocks.ts (HERO_KEYS)
  // and cover.ts (BAND) read TRAIL by raw index (39, 43, 44), so a4 and every
  // key after it must keep its index or hero rocks and a grass band move to
  // other cameras. Drop rows here only together with those two tables.
  // HERO_KEYS 32 to 35 are rows of this stretch: 35 is "wall", and 32 to 34,
  // the three before it, reach no rock that "wall" does not (they were the
  // cave's exit and the pull back's first two keys).
  // Thirteen rows from a3 to "wall", 56 apart (the first 43 from the stop and
  // 68 from the second), then the last two of the old pull back where they
  // stood: "wall" keeps its place (the bench's rocks stay as they are) and
  // turns 9 less (the falls still on the right there), the row before a4 is
  // untouched, so the arrival and a4's frame are today's.
  // The first row is what aims the a3 stop: the rail blurs a stop's view with
  // its neighbours', and with this row 43 out at 137.5 / -10.5 the stop is
  // still aimed 126.1 / -11.8, as it was with the dolly's first key after it,
  // and the pitch settles to the pass's -10.7 without overshooting it.
  K(-287, 131, 1396, 137.5, -10.5, "walk", undefined, 58),
  K(-222, 133, 1376, 148, -10.6, "walk", undefined, 58),
  S(K(-167, 136, 1366, 157, -10.7, "walk", undefined, 58)),
  // Square on to the falls, due north of the curtain: the whole drop, the
  // foam and the pool, the rim's trees against the sky.
  M("crossing", S(K(-111, 141, 1358, 166, -10.7, "walk", undefined, 57.5))),
  S(K(-56, 147, 1352, 174.5, -10.6, "walk", undefined, 57.5)),
  S(K(-1, 155, 1350, 183, -10.3, "walk", undefined, 57)),
  S(K(54, 165, 1351, 190.5, -9.8, "walk", undefined, 56.5)),
  S(K(109, 178, 1352, 198, -9.2, "walk", undefined, 55.5)),
  S(K(163, 194, 1353, 204, -8.6, "walk", undefined, 54.5)),
  // The rise: 0.35 up per unit along, the falls shrinking, the massif and
  // the Upper Falls coming up over the south rim.
  K(217, 212, 1352, 209.5, -8, "walk", undefined, 53.5),
  K(270, 231, 1349, 214, -7.5, "walk", undefined, 52.5),
  K(321, 251, 1346, 218, -7.2, "walk", undefined, 51.5),
  K(374, 271, 1340, 221.5, -7, "walk", undefined, 50.5),
  M("wall", K(430, 290, 1330, 225, -7, "walk", undefined, 50)),
  K(624, 324, 1262, 240, -8, "walk", undefined, 49),
  // a4 (bible 1.10): east of the bench on the wall, 24 over it, ~280 from the
  // Trail Hut, which stands 16 right of the falls (hut x ~0.65, falls ~0.42).
  // Looking up 8 through a wide lens (48) pins the pool on the frame's bottom
  // and gives the sky over the massif 32% (B9: the massif stands 12-24 up
  // behind the falls, so a narrower lens cannot hold the pool and the sky).
  K(820, 324, 1160, 244.5, -8, "walk", "a4", 48),
  // Round 1: after a4 the view turns to the way ahead at once (left, over the
  // gorge downstream and the valley), so the traverse is walked facing forward
  // (v6 walked it backwards, looking back at the falls), and it turns north
  // into the gully at its foot, BEFORE the climb: it crests facing the saddle.
  // Final pass C (the art judge, the gully mark at ~3.5: from 850 to 906 vh
  // the view drifted east onto empty peach haze over the plain, then the
  // Climb's bare dark face and the gully's toothed rim filled the frame): the
  // traverse holds the valley instead (the Landing's hill, the woods, the
  // gorge's rim below, bearing 178 -> 150), which also softens the turn off
  // a4 (94 -> 67 degrees). Then the camera rises out over the gully rather
  // than down inside it, turning left above the rim's level, so the turn
  // sweeps the lit rim shelf and the sunset ridges and comes over the top
  // already facing the lake.
  // Final pass D (the verifier: 888-912 vh showed the east haze, then the
  // Climb's dark face close up; the gully mark ~85% dark wall): the camera
  // rises out of the gorge sooner (y 575 at the last traverse key, 650 at the
  // gully mark, ~30 over the rim) and starts the turn a little earlier (148,
  // 132, then 52 at the mark), so the turn looks over the rim's edge at the
  // lit shelf and its boulders instead of into the face below it. The far
  // massif north east (x 1700-2000, up to ~1000 high) still fills the top of
  // the frame for ~10 vh; it is too high to rise over. The gully mark looks
  // 4 down through a 40 lens, so the lit shelf takes more of the frame than
  // the massif. The fastest turn on the route drops from 38.4 to ~33 degrees
  // per 10 vh (shots/v6/finalD/route/sheet-gully-*).
  M("traverse", K(935, 385, 1182, 155, 0, "hike", undefined, 46)),
  K(1080, 470, 1196, 148, 2, "hike", undefined, 42),
  K(1262, 575, 1222, 132, 2, "hike", undefined, 40),
  // THE GULLY: over the notch heading north, the view swinging left onto
  // the lit shelf and the ridges ahead.
  // (a "hike" row, not "climb": CLIMB_KEYS stays the gully run whose third key
  // is the burst, as clouds.ts and v6-a1-pace.mjs read it.)
  M("gully", K(1400, 650, 1208, 52, 4, "hike", undefined, 40)),
  K(1433, 667, 1124, 5, 2, "climb", undefined, 38),
  K(1436, 668, 1092, 2, 0, "climb", undefined, 36),
  // THE BURST (v5's rows, no longer locked since round 1): onto the ridge
  // into the sunset, already facing north from the gully. Final pass D: 26
  // higher (642 -> 668) and 1 down, level with the gully keys above the rim,
  // so the camera doesn't dip between the gully and the ridge.
  M("burst", K(BURST.x, 668, BURST.z, 2, 1, "climb")),
  K(BURST.x + 6, 690, BURST.z - 75, 358, 4, "climb"),
  K(1450, 720, 865, 355, 5),
  K(1445, 712, 610, 350, 6),
  K(1445, 695, 330, 340, 8),
  K(1470, 688, 40, 318, 10),
  // a5 (locked). The island is above the frame; its reflection is in the lake.
  K(1470, 690, -200, 297, 9.1, "walk", "a5"),
  // The reveal (locked): out across the still water, tilting up to the real
  // island, then down into the forest, under the canopy, between the trunks.
  K(1150, 680, -520, 292, 6),
  K(700, 680, -820, 284, -4),
  K(270, 692, -995, 278, 2),
  // a6 (locked): the Great Tree across its clearing, looking up.
  K(-150, 745, -1015, 281, -12, "walk", "a6"),
  // THE RISE (locked): behind the first step, looking up the staircase; up
  // along it; over the cove's rim onto the island.
  K(stepLine(-150, 0)[0], STEPS_FOOT[1] + 32, stepLine(-150, 0)[2], STEPS_BEARING, -14, "rise"),
  K(...stepLine(150, 45), STEPS_BEARING, -22, "rise"),
  K(...stepLine(450, 45), STEPS_BEARING, -30, "rise"),
  K(...stepLine(720, 45), STEPS_BEARING + 1, -22, "rise"),
  M("risetop", K(-1709, 1715, -1316, STEPS_BEARING + 4, 0, "rise")),
  // v6, the stargazer's island (bible 1.17): up the one path from the cove.
  // Round 1 (decision 46): the Gate isle is hidden by the cloud bank north of
  // the island (dress-sky GATE_BANK, v6-route N9 counts it), not by looking up,
  // so the island is walked looking at it: the view follows the observatory
  // as the camera passes ~255 south of it (296 -> 352 -> 46), up 3 to 5. v6 looked
  // up 28 here to hide the arch while the view swung past north.
  M("arrive", K(-2030, 1710, -1305, 352, -5, "sky")),
  // a7: the observatory on its island with the night sky behind (STAR_LOOK).
  K(STAR_LOOK.x, STAR_LOOK.y, STAR_LOOK.z, STAR_LOOK.bearing, STAR_LOOK.pitch, "sky", "a7", STAR_LOOK.fov),
  // Round 1: on to the bridge's head facing where it goes, looking at the
  // bridge and the bounty isle ahead (they sit right of the panel), past the
  // observatory's west side and the fork. v6 looked up 20 at the sky here
  // ("waaay too much sky") and detoured east to the lookout tip.
  M("island", K(-2195, 1706, -1575, 34, 0, "sky")),
  K(-2100, 1704, -1745, 30, 2, "sky"),
  M("bridgehead", K(-2000, 1702, -1900, 28, 3, "sky")),
  // THE ROPE BRIDGE (locked), walked at eye height on its centreline.
  K(...onBridge(-0.45), BRIDGE_BEARING, 5, "board"),
  K(...onBridge(0), BRIDGE_BEARING, 6, "bridge"),
  K(...onBridge(0.2), BRIDGE_BEARING, 6, "bridge"),
  K(...onBridge(0.5), BRIDGE_BEARING, 6, "bridge"),
  K(...onBridge(0.8), BRIDGE_BEARING, 5, "bridge"),
  K(...onBridge(1), BRIDGE_BEARING, 5, "bridge"),
  // Across the bounty isle, past the quest board, up the gangway onto the deck.
  K((BRIDGE.b[0] + MOORED_CAM[0]) / 2, (bridgeDeckAt(1) + BRIDGE_EYE + MOORED_CAM[1]) / 2, (BRIDGE.b[2] + MOORED_CAM[2]) / 2, 36, 5, "board"),
  // THE FLIGHT (locked), from the moored ship's deck to the docked one's.
  M("moored", K(MOORED_CAM[0], MOORED_CAM[1], MOORED_CAM[2], SHIP_MOORED.heading, 4, "flight")),
  K(-1425, 1650, -2726, 35, 3, "flight"),
  K(-1294, 1690, -2915, 28, 2.5, "flight"),
  K(-1293, 1728, -3112, 345, 3, "flight"),
  K(-1400, 1740, -3278, 322, 4, "flight"),
  K(-1657, 1702, -3584, 320, 5, "flight"),
  K(-1850, 1652, -3814, 320, 5, "flight"),
  M("docked", K(DOCKED_CAM[0], DOCKED_CAM[1], DOCKED_CAM[2], SHIP_DOCKED.heading, 5, "flight")),
  // a8 (bible 1.20): off the bow at the head of the stone dock, backlit on
  // purpose, the arch at x ~0.6 with the sun inside its opening. Its position
  // is v5's first key after the flight (off the bow onto the quay): the
  // flight's last stretch of curve depends on it, so keeping it keeps the
  // locked flight exact. ~400 from the arch, so the lens is wider (42).
  K(-2075, 1642, -4082, 318, -9, "board", "a8", 42),
  // THE TAIL (final pass B, the experience judge: "the course ends on blank
  // sky", six frames of peach haze from 1,950 to 1,990 vh): the camera no
  // longer flies through the arch into the gold. It walks ~115 up the
  // causeway on the arch's axis and stops ~285 short of it, the whole arch
  // framing the sun, the notices lit on its pillars and the cloud sea through
  // the opening (shots/v6/finalB/route). Four keys after a8 still, so
  // clouds.ts's view at TAIL_KEYS.first + 3 is the last frame.
  K(GATE.x + 0.616 * 355, 1641, GATE.z + 0.788 * 355, 320, -7.5, "sky", undefined, 42),
  K(GATE.x + 0.616 * 325, 1642, GATE.z + 0.788 * 325, 321.5, -7, "sky", undefined, 42),
  K(GATE.x + 0.616 * 300, 1643, GATE.z + 0.788 * 300, 322, -6.5, "sky", undefined, 42),
  K(GATE.x + 0.616 * 285, 1644, GATE.z + 0.788 * 285, 322, -6.5, "sky", undefined, 42),
];

function lookOf(k: Key): [number, number, number] {
  const b = (k.bearing * Math.PI) / 180;
  const p = (k.pitch * Math.PI) / 180;
  return [
    k.x + Math.sin(b) * Math.cos(p) * LOOK_DIST,
    k.y - Math.sin(p) * LOOK_DIST,
    k.z - Math.cos(b) * Math.cos(p) * LOOK_DIST,
  ];
}

/** Camera positions, shore to the Gate. */
export const TRAIL: ReadonlyArray<readonly [number, number, number]> = KEYS.map((k) => [k.x, k.y, k.z] as const);
/** Look targets, one per TRAIL point (see KEYS). */
export const LOOK: ReadonlyArray<readonly [number, number, number]> = KEYS.map(lookOf);
/** What each TRAIL point is doing (see TrailKind). */
export const TRAIL_KIND: readonly TrailKind[] = KEYS.map((k) => k.kind);
/** Pace at each TRAIL point (PACE by kind), for scroll weighting. */
export const TRAIL_PACE: readonly number[] = KEYS.map((k) => k.pace ?? PACE[k.kind]);
/** Bearing and pitch at each TRAIL point, as authored (degrees). */
export const TRAIL_VIEW: ReadonlyArray<{ bearing: number; pitch: number }> = KEYS.map((k) => ({ bearing: k.bearing, pitch: k.pitch }));

/**
 * The named rows of KEYS (M in the table): name -> KEYS index. Tests and
 * renders read frames by name (plus a fractional offset) so they survive a
 * change in the number of keys. Round 1 names: stream, lip, fall, pool, turn,
 * cave, camp, exit, wall, traverse, gully, burst; route stage 2: risetop,
 * arrive, island, bridgehead, moored, docked. Final pass: "crossing" is gone,
 * "back" is new (the pull back from the curtain), "exit" is the last key of
 * the cave pass (back out through the curtain) and "wall" is on the pull back
 * under the Trail Hut's bench.
 * 2026-10-13 (the camera no longer enters the cave, see KEYS): "cave", "camp",
 * "exit" and "back" are RETIRED with the rows they named; nothing may read
 * them (light.ts read "cave" and "exit": its anchor is "wall" now;
 * v6-strip.mjs's frames moved to the new stretch). "crossing" is back with a
 * new meaning: the key square on to the falls, due north of the curtain, on
 * the a3 -> a4 move. "wall" is where it was.
 */
export const ROUTE_MARKS: Readonly<Record<string, number>> = Object.fromEntries(
  KEYS.flatMap((k, i) => (MARK_OF.has(k) ? [[MARK_OF.get(k) as string, i] as [string, number]] : [])),
);

/** The KEYS (TRAIL) index of the a7 sky frame (STAR_LOOK). */
export const STAR_KEY = KEYS.findIndex((k) => k.x === STAR_LOOK.x && k.z === STAR_LOOK.z);

/** First and last TRAIL index of each hand-placed stretch (inclusive); -1 when absent. */
function rangeOf(kind: TrailKind): { first: number; last: number } {
  const first = KEYS.findIndex((k) => k.kind === kind);
  let last = first;
  while (first >= 0 && last + 1 < KEYS.length && KEYS[last + 1].kind === kind) last++;
  return { first, last };
}
/** The ride down the falls and the turn at the pool (the stop a3 follows). */
export const DIVE_KEYS = rangeOf("dive");
/** The rope bridge crossing. */
export const BRIDGE_KEYS = rangeOf("bridge");
/** The flight: the camera is on the moored ship's deck at key `first` and on
 *  the docked ship's deck at key `last`. Between those two keys (curve
 *  parameter first/(n-1) .. last/(n-1)) the ship rides with the camera
 *  (shipFromCamera); before it the ship sits at SHIP_MOORED, after it at
 *  SHIP_DOCKED. */
export const FLIGHT_KEYS = rangeOf("flight");
/** Final pass: in through the curtain, round the camp in the hall and back
 *  out through the curtain, facing in (a3 stands outside, before it). The
 *  side passage stays in the world (the trail's way out) but the camera no
 *  longer uses it.
 *  RETIRED 2026-10-13 with the "cave" kind (see TrailKind): no key is a cave
 *  key, so this is { first: -1, last: -1 }, and light.ts's cave light, which
 *  reads it, is never switched on. Kept for the modules and tests that import
 *  it. */
export const CAVE_KEYS = rangeOf("cave");
/** The first run of "hike" keys. Round 1: the traverse after a4 (the camera
 *  no longer hikes up to a4; it crosses the gorge and climbs the rock). */
export const HIKE_KEYS = rangeOf("hike");
/** Up the gully to the burst and the key after it (the burst is CLIMB_KEYS.first + 2).
 *  Round 1: the rock under the Trail Hut's spur is a "climb" run too, so this
 *  is the run that holds the burst, not the first one. */
export const CLIMB_KEYS = (() => {
  const burst = ROUTE_MARKS.burst ?? -1;
  if (burst < 0 || KEYS[burst].kind !== "climb") return rangeOf("climb");
  let first = burst;
  while (first > 0 && KEYS[first - 1].kind === "climb") first--;
  let last = burst;
  while (last + 1 < KEYS.length && KEYS[last + 1].kind === "climb") last++;
  return { first, last };
})();
/** The tail: the keys after a8, up the causeway to the arch. `last` is the
 *  route's real last key. Final pass C: light.ts's gold fade (tailFadeAt) no
 *  longer reads `last`; it sets its own end (TAIL_FADE_END), so the end frame
 *  is unchanged by this. */
export const TAIL_KEYS = { first: KEYS.findIndex((k) => k.stop === "a8"), last: KEYS.length - 1 } as const;

export const PLACES: readonly Place[] = PLACE_DEFS.map((d) => {
  const trail = KEYS.findIndex((k) => k.stop === d.id);
  if (trail < 0) throw new Error(`layout: no trail key for ${d.id}`);
  return { ...d, trail };
});

/** Clearance over the ground at each TRAIL key (WALK_CLEAR, or STOP_CLEAR at a
 *  stop, the keys either side of it and the opening). */
export const TRAIL_CLEAR: readonly number[] = KEYS.map((_, i) => {
  if (i === 0) return STOP_CLEAR;
  for (let j = Math.max(0, i - 1); j <= Math.min(KEYS.length - 1, i + 1); j++) if (KEYS[j].stop) return STOP_CLEAR;
  return WALK_CLEAR;
});

/** Vertical field of view the route was designed and checked for (V3's). */
export const DESIGN_FOV = 31;

/**
 * The lens at some stops, so the frame takes in sky and far ridges while the
 * landmark stays clear of the timeline. The walked path is unchanged; only
 * the lens moves. Vertical degrees; every other key keeps DESIGN_FOV unless
 * its row sets its own (KEY_FOV). The lens eases between keys (fovAtKey:
 * smoothstep, so it is still at every key and never reads as a zoom). The
 * park keeps DESIGN_FOV.
 */
export const STOP_FOV: Partial<Record<PlaceId, number>> = { a1: 38, a2: 42, a4: 48, a5: 35, a7: 40, a8: 39 };

/** Per key lens overrides (the opening's 40): KEYS index -> vertical degrees. */
export const KEY_FOV: Readonly<Record<number, number>> = Object.fromEntries(
  KEYS.flatMap((k, i) => (k.fov ? [[i, k.fov] as [number, number]] : [])),
);

/** Vertical fov at each TRAIL key (KEY_FOV, else STOP_FOV at its stop, else DESIGN_FOV). */
export const TRAIL_FOV: readonly number[] = KEYS.map((k) => k.fov ?? ((k.stop && STOP_FOV[k.stop]) || DESIGN_FOV));

/** Vertical fov at fractional key index f (key i at f = i): TRAIL_FOV eased
 *  between neighbouring keys with a smoothstep. Allocates nothing. */
export function fovAtKey(f: number): number {
  const n = TRAIL_FOV.length;
  if (!(f > 0)) return TRAIL_FOV[0];
  if (f >= n - 1) return TRAIL_FOV[n - 1];
  const i = Math.floor(f);
  const a = TRAIL_FOV[i];
  const b = TRAIL_FOV[i + 1];
  if (a === b) return a;
  const u = f - i;
  return a + (b - a) * u * u * (3 - 2 * u);
}
