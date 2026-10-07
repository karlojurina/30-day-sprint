/**
 * V4 route layout: where the eight places are, where the camera travels and
 * what it looks at. Everything else in V4 (terrain, rail, landmarks, light,
 * interface) is built from this file and terrain.ts. Pure data, no three.js.
 *
 * Coordinates are three.js, Y up, in world units (V3's lighthouse was 52 tall).
 * Bearings are compass degrees seen from above: 0 looks toward -z (north),
 * 90 toward +x (east), 180 toward +z, 270 toward -x. Pitch is degrees BELOW
 * the horizon; a negative pitch looks up.
 *
 * The map, south to north then west (see world-tests/shots/v4-pass3/route/):
 *   the sea and the Landing on the south coast; Base Camp on the coastal shelf;
 *   the trail climbs to the south rim of an east-west gorge. The waterfall
 *   pours off the gorge's NORTH wall, facing the trail, so the camera reaches
 *   the rim already looking at it head-on and sinks in front of the curtain
 *   to the pool. Grey pass 3: at the foot it goes on through the curtain into
 *   a cave behind it (CAVE, the a3 stop), along an old mine tunnel east inside
 *   the gorge's north wall (TUNNEL) to a lift at the foot of a vertical shaft
 *   (SHAFT, the a4 stop), and rides the lift up and out onto the Climb's rim
 *   shelf (the gorge and the Climb's face stay as unseen scenery); crosses a
 *   green saddle in the high ridge and comes down a meadow to the Mirror Lake; turns west through a forest of
 *   giant trees to the Great Tree; rises up a straight flight of floating
 *   steps to the Sky Island over the basin's west edge; crosses a rope bridge
 *   to the bounty isle; boards an airship and flies north across the cloud
 *   sea to the Harbour Isle. The ridge and the west massif hide the Sky Island
 *   from stops 1-4; the north ring and the camera's own heading hide the
 *   Harbour Isle until the ship banks toward it.
 *
 * TUNING: the numbers that decide feel are all here. scrollVh (budget per
 * stretch), PACE (slower in the dive, on the rise and on the bridge, faster in
 * the flight), the KEYS table (camera positions, bearing, pitch) and
 * LOOK_DIST. world-tests/v4-route.mjs checks clearance, sight lines, the
 * dive, the steps, the bridge, the flight and the lake reflection.
 */

export type LightKey =
  | "afternoon-gold"
  | "afternoon"
  | "late-afternoon"
  | "sunset-cliff"
  | "sunset"
  | "dusk"
  | "night"
  | "dawn"
  | "morning";

export type PlaceId = "a1" | "a2" | "a3" | "a4" | "a5" | "a6" | "a7" | "a8";

/**
 * What a stretch of the camera route is doing. The rail uses it to decide
 * terrain follow (off for the kinds in NO_TERRAIN_FOLLOW, which are placed
 * by hand) and the check script uses it for the clearance rules.
 *   walk    ordinary trail flight, >= 35 above ground
 *   dive    in front of the falls, sinking to the pool, >= 15 from any rock
 *   climb   rising up the Climb's cliff face
 *   rise    up the floating steps, looking up at the island
 *   cave    grey pass 3: at the foot of the falls, through the curtain and
 *           the mouth (CAVE) into the hall behind it; inside a void (CAVE)
 *           or, outside it, >= 15 over the pool and >= 8 from rock
 *   tunnel  the old mine tunnel (TUNNEL), TUNNEL_EYE over its floor
 *   shaft   riding the lift up the shaft (SHAFT), then out over its collar
 *   sky     on an island top (Sky Island, Harbour Isle), >= 35 above it
 *   bridge  walking the rope bridge: BRIDGE_EYE above its deck
 *   board   on foot at the bounty isle and onto / off your airship's deck
 *   flight  riding the airship: the camera stands on its deck (SHIP)
 */
export type TrailKind = "walk" | "dive" | "climb" | "rise" | "sky" | "bridge" | "board" | "flight" | "cave" | "tunnel" | "shaft";

/** Kinds the rail must NOT lift over the ground or the islands' keep-out domes:
 *  their heights are exact (in front of the falls, on the bridge's deck, on
 *  the bounty isle, on the ship, and underground: the cave, the tunnel and
 *  the shaft run BELOW terrainHeight by design, see CAVE). */
export const NO_TERRAIN_FOLLOW: readonly TrailKind[] = ["dive", "bridge", "board", "flight", "cave", "tunnel", "shaft"];

/** Kinds that run inside the mine's voids (CAVE, TUNNEL, SHAFT): the camera is
 *  under the terrain surface there, which is drawn front faces only, so the
 *  void's own walls (blocks.ts) are all that the camera sees. */
export const UNDERGROUND: readonly TrailKind[] = ["cave", "tunnel", "shaft"];

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

// ── Places ───────────────────────────────────────────────────────────────────

/** Scroll after the last stop, so a8 is not pinned to the very bottom. */
export const TAIL_VH = 40;
/**
 * Scroll budget of the flight, in vh: from the moored ship's deck to the
 * docked ship's (FLIGHT_KEYS.first to .last). Grey pass 3: the flight is its
 * own stretch with its own slider, carved out of a8's; a8's scrollVh is the
 * rest of that stretch (the star look, the bridge, boarding and landing).
 * The stop a8 therefore sits at the sum of all eight scrollVh plus this.
 */
export const FLIGHT_VH = 250;

/** Keys are bound to places by id below; trail indices are filled in from KEYS. */
const PLACE_DEFS: ReadonlyArray<Omit<Place, "trail">> = [
  { id: "a1", module: "Introduction", place: "The Landing", landmark: "Signpost", mesh: "LM_Signpost",
    pos: { x: 1300, y: 5, z: 4170 }, light: "afternoon-gold", scrollVh: 150, height: 30 },
  { id: "a2", module: "Fundamentals", place: "Base Camp", landmark: "Lookout", mesh: "LM_Lookout",
    pos: { x: 440, y: 128, z: 2720 }, light: "afternoon", scrollVh: 170, height: 70 },
  // The waterfall's base: where the falling water meets the pool (WORLD.falls.bottom).
  // Grey pass 3: the stop is in the cave behind the curtain (CAVE), looking
  // back out through the water; the landmark is still the falls themselves.
  { id: "a3", module: "Video Ads I", place: "The Falls, and the cave behind them", landmark: "Waterfall", mesh: "LM_Waterfall",
    pos: { x: -100, y: 61.5, z: 1307 }, light: "late-afternoon", scrollVh: 330, height: 408 },
  // Grey pass 3: the mine lift's cage at the foot of the shaft (SHAFT), where
  // the tunnel ends. Underground: the stop is in the tunnel, looking at it.
  { id: "a4", module: "Video Ads II", place: "The Mine", landmark: "Mine Lift", mesh: "LM_MineLift",
    pos: { x: 1436.09, y: 95, z: 1041.56 }, light: "sunset-cliff", scrollVh: 150, height: 30 },
  // The boathouse stands at the end of a jetty, on the water.
  { id: "a5", module: "Static Ads", place: "The Mirror Lake", landmark: "Boathouse", mesh: "LM_Boathouse",
    pos: { x: 1150, y: 564, z: -420 }, light: "sunset", scrollVh: 260, height: 40 },
  // The heart of the forest (WORLD.forest.clearing); the floating steps start beside it.
  { id: "a6", module: "AI Ads & Content", place: "The Glowing Forest", landmark: "Great Tree", mesh: "LM_GreatTree",
    pos: { x: -760, y: 791, z: -1190 }, light: "dusk", scrollVh: 210, height: 200 },
  // On the island's top surface (WORLD.island.y).
  { id: "a7", module: "Creative Strategy", place: "The Sky Island", landmark: "Observatory", mesh: "LM_Observatory",
    pos: { x: -2130, y: 1650, z: -1620 }, light: "night", scrollVh: 260, height: 110 },
  // In the Harbour Isle's square (WORLD.harbourIsle.y); the job board stands out front, facing the docks.
  { id: "a8", module: "Job Board", place: "The Harbour Isle", landmark: "Guild Hall", mesh: "LM_GuildHall",
    pos: { x: -2340, y: 1600, z: -4410 }, light: "morning", scrollVh: 260, height: 70 },
];

// ── World ────────────────────────────────────────────────────────────────────

export const WORLD = {
  /** Terrain extent. North to -5600 so there is ground (below the cloud sea)
   *  under the flight, the Harbour Isle and the view past it from a8; the
   *  south stops under the opening camera, which only ever looks north. */
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
   * The waterfall, on the gorge's NORTH wall. Water leaves the lip heading
   * `flow` (compass degrees: 180 = south, toward the trail and the camera)
   * and lands in the pool `throw` units out from the lip. The outward throw
   * grows with the square root of the drop (free fall), which keeps the
   * curtain in front of the 84 degree cliff all the way down. Use
   * fallsCurtainAt(y) for the curtain's centre at any height.
   */
  falls: {
    top: [-100, 470, 1255] as [number, number, number],
    bottom: [-100, 61.5, 1307] as [number, number, number],
    width: 100,
    flow: 180,
    throw: 52,
  },
  /** The plunge pool at the foot of the falls (78 out from the foot, toward the camera). */
  pool: { x: -100, z: 1385, r: 92, y: 61.5 },
  /**
   * The Climb: a sheer straight face on the gorge's north wall, running east-
   * west at constant z so the terrain grid meets it square. The face runs
   * from the floor edge (footZ, y floorY) back to the rim (topZ, y rimY);
   * above it a flat shelf at rimY runs north into the saddle. Stairs cut into
   * the face follow it: at height y the rock surface is at
   * z = footZ - (y - floorY) * (footZ - topZ) / (rimY - floorY).
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
  /** The Harbour Isle: a floating harbour town, y is the TOP surface. */
  harbourIsle: { x: -2300, y: 1600, z: -4350, r: 400 },
} as const;

/** How deep the Sky Island's rock hangs below its top surface (for blocks and sight lines). */
export const ISLAND_DEPTH = 350;
/** Same for the bounty isle. */
export const BOUNTY_DEPTH = 120;
/** Same for the Harbour Isle. */
export const HARBOUR_DEPTH = 260;

/** The falls curtain's centre [x, z] at height y (clamped to the drop). */
export function fallsCurtainAt(y: number): [number, number] {
  const F = WORLD.falls;
  const k = Math.min(1, Math.max(0, (F.top[1] - y) / (F.top[1] - F.bottom[1])));
  const out = F.throw * Math.sqrt(k);
  const b = (F.flow * Math.PI) / 180;
  return [F.top[0] + Math.sin(b) * out, F.top[2] - Math.cos(b) * out];
}

// ── The mine: the cave behind the falls, the tunnel, the shaft (grey pass 3) ─

/**
 * HOW THE MINE SITS IN A HEIGHTFIELD. terrain.ts is one height per (x, z), so
 * it cannot hold a cave. The cave, the tunnel and the shaft are VOIDS UNDER
 * the terrain surface: terrainHeight is left as it is (the cliff behind the
 * falls, the gorge's north wall, the Climb's rim shelf) and stays above every
 * void by at least MINE_COVER, except at the two portals, where the void
 * breaks the surface:
 *   - the cave MOUTH, in the foot of the falls cliff behind the curtain;
 *   - the shaft's COLLAR, one terrain grid cell on the Climb's flat rim shelf.
 * scene.ts cuts the terrain MESH open at both portals (the triangles there are
 * dropped; terrainHeight itself is unchanged, so the rail, the park and the
 * tests read the same ground as before). The terrain is drawn front faces
 * only, so from inside a void the surface above is invisible: the camera sees
 * only the void's own walls, which blocks.ts builds (inward-facing, closed
 * except at the portals, with a rock frame round the mouth and a timber collar
 * round the shaft that cover the cut's jagged edge).
 * world-tests/v4-route.mjs checks the cover, the portals and that every cave,
 * tunnel and shaft sample of the camera is inside a void (mineMargin).
 */
export const MINE_COVER = 20;

/**
 * The cave behind the falls (area 3). The MOUTH is an arched opening in the
 * cliff's foot, straight behind the curtain: sill at floorY on the cliff's
 * foot line (footZ), mouthHalfW each side of x, mouthH tall. The cliff leans
 * back 1 in 9 (the gorge's north wall, GORGE steepness 9), so the arch's top is
 * mouthH / 9 further north than its sill; the curtain lands ~7 in front of the
 * sill (WORLD.falls.bottom z 1307), so from outside the mouth is hidden behind
 * the falling water. The HALL behind it is a dome on an elliptical floor:
 * centre (hallX, hallZ), radii rx (x) and rz (z), floor floorY, ceiling
 * hallH at the middle falling to mouthH at the rim (dome: hallH * sqrt(1 - r^2),
 * never lower than the mouth's arch where it meets it). The tunnel leaves the
 * hall's east side (TUNNEL[0]). The camera's a3 stop is in the hall, looking
 * back out through the mouth at the curtain from inside (CAVE_VIEW).
 * Light (spec): the falling water throws moving ripples over the hall's rock,
 * a lantern, the curtain glowing in the mouth.
 */
export const CAVE = {
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
/** Where the a3 camera stands and looks (the KEYS row for a3 uses it). */
export const CAVE_VIEW = { x: -66, y: 96, z: 1160, bearing: 200, pitch: 0 } as const;

/**
 * The old mine tunnel (area 4): its floor's centreline, [x, floor y, z], from
 * the hall's east side to the shaft's west wall, TUNNEL_HALF_W each side and
 * TUNNEL_H tall (flat floor, flat or arched roof, timber props). It runs east
 * inside the gorge's north wall, >= 60 of rock from the gorge's face and
 * >= 300 under the ground above, rising 1 in 45 (a mine adit drains out).
 * The camera walks it TUNNEL_EYE over the floor, on the centreline, fast
 * (PACE.tunnel): it is ~1,450 long because the lift has to come up on the far
 * side of the gorge's north wall, straight south of the saddle, but it
 * scrolls past in about a screen: torches, props, rails.
 */
export const TUNNEL: ReadonlyArray<readonly [number, number, number]> = [
  [-8, 64, 1196],
  [150, 67, 1185],
  [420, 72, 1150],
  [720, 79, 1090],
  [1000, 86, 1058],
  [1250, 91, 1046],
  [1419.549, 95, 1041.56],
];
export const TUNNEL_HALF_W = 12;
export const TUNNEL_H = 26;
export const TUNNEL_EYE = 13;

/**
 * The vertical shaft (area 4 into 5), exactly ONE cell of the terrain's main
 * grid (scene.ts cuts that cell out of the terrain mesh for the collar): x
 * from x0 to x1, z from z0 to z1, floor at floorY (the tunnel's end) up to
 * topY, the ground at the collar (the Climb's flat rim shelf,
 * WORLD.climb.rimY). The lift's cage rides in it (LIFT). The tunnel enters
 * through the shaft's west wall (x0).
 */
export const SHAFT = {
  x: 1436.09,
  z: 1041.5625,
  x0: 1419.549,
  x1: 1452.632,
  z0: 1025,
  z1: 1058.125,
  floorY: 95,
  topY: 622,
} as const;

/**
 * The mine lift (the a4 landmark, LM_MineLift): a timber cage `size` square
 * and `height` tall on the shaft's centre, with a headframe over the collar.
 * The camera rides it standing camUp over the cage floor, so while the camera
 * is in the shaft stretch (SHAFT_KEYS) the cage floor is liftCageY(camera y);
 * before it the cage waits at the foot (SHAFT.floorY), after it at the top
 * (SHAFT.topY). Progress (spec): parked higher up the shaft the more Video
 * Ads II lessons are done, when the camera is not riding it.
 */
export const LIFT = { size: 22, height: 26, camUp: 13 } as const;
export function liftCageY(camY: number): number {
  return Math.min(SHAFT.topY, Math.max(SHAFT.floorY, camY - LIFT.camUp));
}

/** Signed distance from (x, y, z) to the nearest wall of the mine's voids
 *  (union of the mouth passage, the hall, the tunnel and the shaft):
 *  positive inside, negative outside. Cheap; for checks, not per frame. */
export function mineMargin(x: number, y: number, z: number): number {
  const C = CAVE;
  let best = -Infinity;
  // The mouth passage: the arch's box, from 14 outside the cliff's foot (past
  // the curtain) to where it opens into the hall.
  {
    const m = Math.min(C.mouthHalfW - Math.abs(x - C.x), y - C.floorY, C.floorY + C.mouthH - y, C.footZ + 14 - z, z - (C.footZ - 40));
    if (m > best) best = m;
  }
  // The hall: elliptical floor, dome roof.
  {
    const ex = (x - C.hallX) / C.rx;
    const ez = (z - C.hallZ) / C.rz;
    const r = Math.hypot(ex, ez);
    const side = (1 - r) * Math.min(C.rx, C.rz);
    const roof = C.floorY + Math.max(C.mouthH, C.hallH * Math.sqrt(Math.max(0, 1 - r * r))) - y;
    const m = Math.min(side, y - C.floorY, roof);
    if (m > best) best = m;
  }
  // The tunnel: distance to its centreline in plan, floor and roof by segment.
  {
    for (let i = 0; i < TUNNEL.length - 1; i++) {
      const a = TUNNEL[i];
      const b = TUNNEL[i + 1];
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const l2 = dx * dx + dz * dz;
      const ur = ((x - a[0]) * dx + (z - a[2]) * dz) / l2;
      // Open ends only where the tunnel meets the hall and the shaft; the
      // union with those voids covers the joins.
      const u = ur < 0 ? 0 : ur > 1 ? 1 : ur;
      const d = Math.hypot(x - a[0] - dx * u, z - a[2] - dz * u);
      const fy = a[1] + (b[1] - a[1]) * u;
      const m = Math.min(TUNNEL_HALF_W - d, y - fy, fy + TUNNEL_H - y);
      if (m > best) best = m;
    }
  }
  // The shaft: open at the top.
  {
    const S = SHAFT;
    const m = Math.min(x - S.x0, S.x1 - x, z - S.z0, S.z1 - z, y - S.floorY);
    if (m > best) best = m;
  }
  return best;
}

/**
 * The Great Tree (area 6, blocks.ts): its top is ~pos.y + height and its
 * crown spreads crownR. Grey pass 3 asked for ~2x the forest's tallest (360),
 * but the tree stands on the line from the Mirror Lake to the Sky Island:
 * seen in the lake from the a5 stop, a 360 crown hides 38% of the island's
 * reflection, the island's first appearance (22% at 300, 8% at 260, 4% at
 * 240). So it is 240, and blocks.ts holds every tree within 260 of it to half
 * that: still twice the height of everything round it. The a6 stop stands
 * ~635 back looking 12 up, base at ~-0.5 of the frame, crown top at ~0.8.
 */
export const GREAT_TREE = { height: 240, crownR: 108 } as const;

// ── Water lines ──────────────────────────────────────────────────────────────

/** The river from the plunge pool down the gorge to the east sea: [x, water y, z]. */
export const RIVER: ReadonlyArray<readonly [number, number, number]> = [
  [-100, 61.5, 1385],
  [70, 61, 1455],
  [400, 59.5, 1470],
  [1000, 55.5, 1430],
  [1450, 50.5, 1420],
  [1800, 47, 1400],
  [2200, 39.5, 1370],
  [2800, 23.5, 1420],
  [3400, 4, 1470],
  [4100, -1, 1500],
];

/** The stream that feeds the falls: down off the high ridge, along the shelf
 *  north of the gorge, over the lip: [x, water y, z]. */
export const STREAM: ReadonlyArray<readonly [number, number, number]> = [
  [-1150, 760, 1060],
  [-800, 640, 1130],
  [-480, 540, 1170],
  [-250, 490, 1205],
  [-100, 470, 1255],
];

/** The brook down the meadow from the saddle into the lake's east shore: [x, water y, z]. */
export const BROOK: ReadonlyArray<readonly [number, number, number]> = [
  [1600, 640, 640],
  [1560, 620, 420],
  [1540, 598, 180],
  [1470, 578, -40],
  [1345, 562, -215],
];

/**
 * The gorge centreline: [x, z, floor y, floor half-width, north wall steepness,
 * south wall steepness]. Steepness is rise per unit out from the floor edge
 * (9 is ~84 degrees, the falls cliff; 12 is ~85, the Climb's face). Between
 * x 1180 and 1720 the centreline is straight at z 1360, so the Climb's face
 * (WORLD.climb) is one straight wall.
 */
export const GORGE: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [-380, 1480, 68, 150, 6, 5],
  [-100, 1500, 62, 200, 9, 4.5],
  [250, 1480, 61, 200, 5, 2.4],
  [600, 1455, 59, 190, 3.6, 3],
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
 * shore to the airship's gangway: where lanterns go. `carve` flattens a bench
 * into the terrain along the segment from this point to the next (and cuts
 * the saddle); it is off down the gorge's south wall, up the Climb's face,
 * and everything floating. The Harbour Isle's own path is HARBOUR_PATH.
 */
export interface PathPoint {
  x: number;
  y: number;
  z: number;
  carve: boolean;
  /** Grey pass 3: the segment from this point to the next runs UNDERGROUND
   *  (through the cave, along the tunnel, up the shaft): no trail and no
   *  ground lanterns on it (the terrain above is not where it runs); the
   *  mine's torches and the cave's lantern are blocks.ts's own. */
  under: boolean;
}
const P = (x: number, y: number, z: number, carve = true, under = false): PathPoint => ({ x, y, z, carve, under });

/** The floating steps: the foot beside the Great Tree and the top in the Sky Island's cove. */
export const STEPS_FOOT: readonly [number, number, number] = [-882, 830, -1047];
export const STEPS_TOP: readonly [number, number, number] = [-1833, 1648, -1356];

export const PATH: readonly PathPoint[] = [
  P(1335, 4, 4262), // dock foot
  P(1300, 5, 4170), // signpost
  P(1180, 28, 3900),
  P(980, 50, 3560),
  P(730, 80, 3200),
  P(520, 105, 2930),
  P(440, 128, 2720), // base camp
  P(330, 165, 2560),
  P(200, 245, 2340),
  P(60, 340, 2080),
  P(-40, 400, 1920, false), // no bench into the rim: its fill would raise the gorge wall
  P(-90, 425, 1815, false), // the overlook on the south rim, facing the falls
  // Switchbacks cut into the gentler south wall east of the falls.
  P(130, 330, 1771, false),
  P(310, 235, 1745, false),
  P(150, 140, 1711, false),
  P(300, 66, 1678, false),
  // Along the floor to the pool, round its east side to the cliff's foot,
  // behind the curtain and in at the cave's mouth (grey pass 3).
  P(120, 62, 1510, false),
  P(-5, 62, 1455, false), // beside the pool, facing the falls
  P(-30, 63, 1318, false), // at the cliff's foot, east of the pool
  P(-100, 64, 1298, false, true), // the cave's mouth, behind the curtain (CAVE)
  P(-92, 64, 1212, false, true), // the hall (the a3 stop looks back out from here)
  // The tunnel (TUNNEL) to the lift at the shaft's foot, and up the shaft.
  ...TUNNEL.map((t) => P(t[0], t[1], t[2], false, true)),
  P(SHAFT.x, SHAFT.floorY, SHAFT.z, false, true), // the lift's cage at the foot
  P(SHAFT.x, SHAFT.topY, SHAFT.z), // the collar, on the Climb's rim shelf; into the saddle
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
  P(STEPS_TOP[0], STEPS_TOP[1], STEPS_TOP[2], false), // the island's cove
  P(-2000, 1650, -1500, false),
  P(-2090, 1650, -1580, false), // observatory steps
  P(-2040, 1650, -1880, false),
  // The rope bridge (BRIDGE), then across the bounty isle to the gangway.
  P(-1848, 1650, -2154, false),
  P(-1695, 1610, -2341, false),
  P(-1640, 1610, -2420, false),
  P(-1575, 1610, -2512, false), // the gangway: your airship's stern (SHIP_MOORED)
];

/** The Harbour Isle's own trail: from the gangway of the docked ship to the Guild Hall. */
export const HARBOUR_PATH: readonly PathPoint[] = [
  P(-2043, 1600, -4044, false), // the docked ship's bow (SHIP_DOCKED)
  P(-2110, 1600, -4130, false),
  P(-2250, 1600, -4300, false), // the square
  P(-2305, 1600, -4365, false), // the job board, in front of the Guild Hall
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
 * with its stern on the isle's rim, docked at the Harbour Isle with its bow
 * on the quay. During the flight the ship's origin is shipFromCamera(...) of
 * the rail's camera position and its travel direction.
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
  [-150, -1015, -760, -1190, 60], // the a6 view to the Great Tree (grey pass 3: from 640 back)
  [-760, -1010, -1150, -1135, 70], // under the first steps
];

// ── The camera route ─────────────────────────────────────────────────────────

/** Look targets sit this far from the camera along its view direction. */
export const LOOK_DIST = 520;

/**
 * Scroll pace by kind: scroll spent per unit of travel, relative to a walk.
 * The rail spends each stretch's scrollVh in proportion to the integral of
 * pace over distance, so the dive, the rise and the bridge take longer to
 * scroll through than their length alone would give them, and the flight
 * (about 1,800 units) goes by faster.
 */
export const PACE: Readonly<Record<TrailKind, number>> = {
  walk: 1,
  dive: 2.4,
  climb: 1.4,
  rise: 1.8,
  sky: 1.1,
  bridge: 2.2,
  board: 1.4,
  flight: 0.5,
  cave: 1.7,
  tunnel: 0.42,
  shaft: 1.25,
};

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
}
const K = (x: number, y: number, z: number, bearing: number, pitch: number, kind: TrailKind = "walk", stop?: PlaceId): Key =>
  ({ x, y, z, bearing, pitch, kind, stop });

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
/** The star look on the Sky Island (grey pass 3): 110 east-north-east of the
 *  observatory, looking back at it 18 up, so its dome (top 75 over the
 *  island) and its telescope (tip ~97, aimed south-west) anchor the lower
 *  third with the stars above. Its KEYS index is STAR_KEY. */
export const STAR_LOOK = { x: -2035, y: 1714, z: -1675, bearing: 240, pitch: -18 } as const;
/** Compass bearing along the tunnel at vertex i (the mean of its two segments). */
function tunnelBearing(i: number): number {
  const a = TUNNEL[Math.max(0, i - 1)];
  const b = TUNNEL[Math.min(TUNNEL.length - 1, i + 1)];
  return (Math.atan2(b[0] - a[0], -(b[2] - a[2])) * 180) / Math.PI;
}
const MOORED_CAM = shipCamera(SHIP_MOORED);
const DOCKED_CAM = shipCamera(SHIP_DOCKED);

/**
 * The camera route, one key per row. The rail runs a centripetal Catmull-Rom
 * through the positions and another through the look targets, both at the
 * same curve parameter, so LOOK[i] is exactly the target when the camera is
 * at TRAIL[i]. On the walks the camera rides 150-230 over the ground with the
 * pitch at 4-8, so the upper half of the frame is always the place ahead and
 * the land beyond it, never the slope in front of the camera.
 */
const KEYS: readonly Key[] = [
  // The opening view: lifted over the bay, looking up the valley.
  K(1480, 290, 5250, 350, 6),
  K(1440, 205, 4890, 350, 6.5),
  K(1375, 104, 4562, 348, 6.5, "walk", "a1"),
  // Up the coastal valley to Base Camp: high, pitch 5-6, the valley and
  // the gorge rim ahead in the upper frame.
  K(1270, 185, 4160, 340, 5.5),
  K(1080, 245, 3810, 336, 5),
  K(900, 290, 3490, 332, 5.5),
  K(745, 320, 3230, 330, 7.5, "walk", "a2"),
  // Past the camp and up to the south rim. From about z 2500 the top of
  // the falls shows over the rim, straight ahead.
  K(560, 355, 2900, 336, 5),
  K(390, 415, 2600, 342, 4.5),
  K(220, 475, 2300, 349, 4),
  K(60, 525, 2050, 355, 4.5),
  K(-60, 540, 1900, 359, 5.5),
  // THE DIVE. At the rim, square to the falls 540 away. Out over the edge,
  // sinking in front of the curtain as it closes to ~150 and fills the
  // frame, the pitch easing down to 27 as the pool rises into view, then
  // levelling out at the foot.
  K(-100, 530, 1800, 0, 7, "dive"),
  K(-100, 495, 1712, 0, 11, "dive"),
  K(-100, 432, 1630, 0, 17, "dive"),
  K(-100, 350, 1565, 0, 23, "dive"),
  K(-100, 262, 1518, 0, 27, "dive"),
  K(-100, 185, 1488, 0, 25, "dive"),
  K(-100, 135, 1470, 0, 17, "dive"),
  // At the foot: level with the pool, the curtain filling the frame.
  K(-100, 104, 1400, 0, 6, "dive"),
  // BEHIND THE CURTAIN (grey pass 3): straight on through the falling water
  // and the cave's mouth behind it (CAVE), then one slow turn to the left
  // round the hall: the west wall, then back out at the curtain from inside.
  K(-100, 92, 1338, 0, 2, "cave"),
  K(-100, 90, 1282, 354, 0, "cave"),
  K(-108, 92, 1226, 318, 0, "cave"),
  // a3: at the back of the hall, the mouth and the lit curtain ahead, the
  // rippling rock round it.
  K(CAVE_VIEW.x, CAVE_VIEW.y, CAVE_VIEW.z, CAVE_VIEW.bearing, CAVE_VIEW.pitch, "cave", "a3"),
  // On round to the tunnel's mouth on the hall's east side.
  K(-24, 86, 1197, 104, 0, "cave"),
  // THE TUNNEL: TUNNEL_EYE over its floor on the centreline, quick, the
  // torches going by.
  ...TUNNEL.slice(0, 6).map((t, i) => K(t[0], t[1] + TUNNEL_EYE, t[2], tunnelBearing(i), -0.5, "tunnel")),
  // a4: 60 back from the shaft's wall, the lift's cage ahead in the shaft.
  K(1359.57, 93.6 + TUNNEL_EYE, 1043.13, 88.5, 0, "tunnel", "a4"),
  // THE LIFT: into the cage, then up the shaft looking up at the daylight,
  // the bearing turning to the saddle, levelling as the head clears the
  // collar; out over the Climb's rim shelf into the sunset.
  // (The step in is a rounded corner, radius ~15: tighter than the rail's
  // 2-unit table, its turn read as a speed step in world-tests/v4-rail.test.mjs.)
  K(SHAFT.x - 5, SHAFT.floorY + LIFT.camUp, SHAFT.z, 88, -10, "shaft"),
  // Mid-shaft the camera looks nearly straight up: the vertical field is 31
  // degrees and the daylight square is 2-5 degrees across from down here, so
  // at 55 up (pass-3 first cut) it was never in frame and a still read as
  // abstract rock (blocks/m5-shaft). At 82 it sits just above the centre.
  K(SHAFT.x, SHAFT.floorY + LIFT.camUp + 40, SHAFT.z, 84, -50, "shaft"),
  K(SHAFT.x, 240, SHAFT.z, 70, -82, "shaft"),
  K(SHAFT.x, 420, SHAFT.z, 40, -78, "shaft"),
  K(SHAFT.x, 570, SHAFT.z, 12, -24, "shaft"),
  K(SHAFT.x, SHAFT.topY + 20, SHAFT.z, 2, 0, "shaft"),
  K(SHAFT.x + 6, 690, SHAFT.z - 75, 358, 4, "shaft"),
  K(1450, 720, 865, 355, 5),
  K(1445, 712, 610, 350, 6),
  K(1445, 695, 330, 340, 8),
  K(1470, 688, 40, 318, 10),
  // The Mirror Lake. The island is above the frame; its reflection is in it.
  K(1470, 690, -200, 297, 13, "walk", "a5"),
  // The reveal: out across the still water, tilting up to the real island,
  // then down into the forest, under the canopy, between the trunks.
  K(1150, 680, -520, 292, 6),
  K(700, 680, -820, 284, -4),
  K(270, 692, -995, 278, 2),
  // The Great Tree across its clearing, 640 away and looking up so the whole
  // tree (GREAT_TREE, ~2x the forest) is in frame, the steps rising beside it.
  // 12 up, not 18: at 18 the Sky Island's dark underside filled the top half
  // and merged with the crown (pass-3 render mine/k47).
  K(-150, 745, -1015, 286, -12, "walk", "a6"),
  // THE RISE. Behind the first step, looking up the staircase, the stones
  // lining up ahead; up along them 45 above the line, tilting up to the
  // island hanging above; over the cove's rim onto the island.
  K(stepLine(-150, 0)[0], STEPS_FOOT[1] + 32, stepLine(-150, 0)[2], STEPS_BEARING, -14, "rise"),
  K(...stepLine(150, 45), STEPS_BEARING, -22, "rise"),
  K(...stepLine(450, 45), STEPS_BEARING, -30, "rise"),
  K(...stepLine(720, 45), STEPS_BEARING + 1, -22, "rise"),
  K(-1709, 1715, -1316, STEPS_BEARING + 4, 0, "rise"),
  K(-1850, 1745, -1385, 300, 7, "sky"),
  // The observatory, its telescope aimed at the stars.
  K(-1935, 1765, -1448, 310, 10, "sky", "a7"),
  // The star look (grey pass 3): past the observatory's east side, looking up
  // along its dome and telescope, so they anchor the lower third with the
  // stars above; then swinging right, down again at the head of the bridge.
  // (The dome's top is 75 over the island, the telescope's tip ~97, aimed
  // south-west; from 110 east-north-east of it, 64 up, looking 18 up, both
  // sit in the lower third.)
  // Then the swing right to the bridge stays looking up (26) while the view
  // passes north: lower, the Harbour Isle shows before the flight (N9).
  K(-1978, 1742, -1562, 282, -10, "sky"),
  K(STAR_LOOK.x, STAR_LOOK.y, STAR_LOOK.z, STAR_LOOK.bearing, STAR_LOOK.pitch, "sky"),
  K(-1996, 1728, -1838, 330, -26, "sky"),
  K(-1972, 1700, -1972, BRIDGE_BEARING, -8, "sky"),
  // THE ROPE BRIDGE, walked at eye height on its centreline: on foot to its
  // head, across, and on along the same line over the bounty isle.
  K(...onBridge(-0.45), BRIDGE_BEARING, 5, "board"),
  K(...onBridge(0), BRIDGE_BEARING, 6, "bridge"),
  K(...onBridge(0.2), BRIDGE_BEARING, 6, "bridge"),
  K(...onBridge(0.5), BRIDGE_BEARING, 6, "bridge"),
  K(...onBridge(0.8), BRIDGE_BEARING, 5, "bridge"),
  K(...onBridge(1), BRIDGE_BEARING, 5, "bridge"),
  // Across the bounty isle, past the quest board, up the gangway onto the deck.
  K((BRIDGE.b[0] + MOORED_CAM[0]) / 2, (bridgeDeckAt(1) + BRIDGE_EYE + MOORED_CAM[1]) / 2, (BRIDGE.b[2] + MOORED_CAM[2]) / 2, 36, 5, "board"),
  // THE FLIGHT, from the deck of the moored ship (first flight key) to the
  // deck of the docked one (last flight key). The ship casts off north-east
  // past the ring's last peak, climbs, banks left, and the Harbour Isle comes
  // up ahead as dawn breaks; it runs in on the dock's line.
  K(MOORED_CAM[0], MOORED_CAM[1], MOORED_CAM[2], SHIP_MOORED.heading, 4, "flight"),
  K(-1425, 1650, -2726, 35, 3, "flight"),
  K(-1294, 1690, -2915, 28, 2.5, "flight"),
  K(-1293, 1728, -3112, 345, 3, "flight"),
  K(-1400, 1740, -3278, 322, 4, "flight"),
  K(-1657, 1702, -3584, 320, 5, "flight"),
  K(-1850, 1652, -3814, 320, 5, "flight"),
  K(DOCKED_CAM[0], DOCKED_CAM[1], DOCKED_CAM[2], SHIP_DOCKED.heading, 5, "flight"),
  // Off the ship's bow onto the quay, up into the square.
  K(-2075, 1642, -4082, 321, 5, "board"),
  K(-2140, 1668, -4160, 321, 5, "sky", "a8"),
  // The tail: closer to the board of job notices.
  K(-2195, 1666, -4228, 321, 6, "sky"),
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

/** Camera positions, shore to the Harbour Isle. */
export const TRAIL: ReadonlyArray<readonly [number, number, number]> = KEYS.map((k) => [k.x, k.y, k.z] as const);
/** Look targets, one per TRAIL point (see KEYS). */
export const LOOK: ReadonlyArray<readonly [number, number, number]> = KEYS.map(lookOf);
/** What each TRAIL point is doing (see TrailKind). */
export const TRAIL_KIND: readonly TrailKind[] = KEYS.map((k) => k.kind);
/** Pace at each TRAIL point (PACE by kind), for scroll weighting. */
export const TRAIL_PACE: readonly number[] = KEYS.map((k) => PACE[k.kind]);
/** Bearing and pitch at each TRAIL point, as authored (degrees). */
export const TRAIL_VIEW: ReadonlyArray<{ bearing: number; pitch: number }> = KEYS.map((k) => ({ bearing: k.bearing, pitch: k.pitch }));

/** The KEYS (TRAIL) index of the star look (STAR_LOOK). */
export const STAR_KEY = KEYS.findIndex((k) => k.x === STAR_LOOK.x && k.z === STAR_LOOK.z);

/** First and last TRAIL index of each hand-placed stretch (inclusive). */
function rangeOf(kind: TrailKind): { first: number; last: number } {
  const first = KEYS.findIndex((k) => k.kind === kind);
  let last = first;
  while (last + 1 < KEYS.length && KEYS[last + 1].kind === kind) last++;
  return { first, last };
}
/** The dive: keys where the camera faces the falls and sinks (the stop a3 follows). */
export const DIVE_KEYS = rangeOf("dive");
/** The rope bridge crossing. */
export const BRIDGE_KEYS = rangeOf("bridge");
/** The flight: the camera is on the moored ship's deck at key `first` and on
 *  the docked ship's deck at key `last`. Between those two keys (curve
 *  parameter first/(n-1) .. last/(n-1)) the ship rides with the camera
 *  (shipFromCamera); before it the ship sits at SHIP_MOORED, after it at
 *  SHIP_DOCKED. */
export const FLIGHT_KEYS = rangeOf("flight");
/** Grey pass 3, the mine: through the curtain and round the hall (the a3
 *  stop is inside); the tunnel (the a4 stop is its last key); the lift ride
 *  up the shaft and out over the collar. While the camera is between
 *  SHAFT_KEYS.first and .last it rides the cage (liftCageY). */
export const CAVE_KEYS = rangeOf("cave");
export const TUNNEL_KEYS = rangeOf("tunnel");
export const SHAFT_KEYS = rangeOf("shaft");

export const PLACES: readonly Place[] = PLACE_DEFS.map((d) => {
  const trail = KEYS.findIndex((k) => k.stop === d.id);
  if (trail < 0) throw new Error(`layout: no trail key for ${d.id}`);
  return { ...d, trail };
});

/** Vertical field of view the route was designed and checked for (V3's). */
export const DESIGN_FOV = 31;
