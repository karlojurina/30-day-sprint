import * as THREE from "three";
import { createRail, type Rail, type RailPose } from "./rail";
import * as Layout from "./layout";
import { PLACES, STEPS, WORLD, ISLAND_DEPTH, BOUNTY_DEPTH, GATE_DEPTH, SHIP, fallsCurtainAt } from "./layout";
import { buildTerrainGeometry, terrainHeight } from "./terrain";
import type { InstallFn, LandmarkBase, LockMode, LockState, ModuleSpec, ShipPose, WorldCtx, WorldModule } from "./modules";
import { Governor, PIXEL_RATIO_FLOOR, TIER2_HOLD_MS, TIER_CONTENT_STEP, WORST_TO_OPENING_RATIO, headroomCheck, median, nearLine, pickTier, recallTier, refineTier, rememberTier, tierSpec, type QualityTier } from "./quality";
import { FramePacer, IdleLadder, burstProbe, createGpuLoad, quickProbe, measureOverdraw, readGpuName, rendererOptionsForTier, screenMegapixels, warmCompile, webglAvailable, type BurstResult, type GpuLoad, type OverdrawOptions, type OverdrawResult } from "./perf";
import { POSTER_RULES, recallPosterVerdict, rememberPoster, type PosterKind, type PosterPreference } from "./poster";
import { addPathLine, footprintStats, resetFootprints } from "./footprints";
import { NO_PROGRESS, sameProgress, type WorldProgress } from "./progress";
import { CHECKPOINT, type CheckpointLook } from "./checkpoint";

/**
 * The world-v6 scene: the grey version of the V4 map. V3's camera, park,
 * markers, idle sleep and harness hooks, on V4's route (layout.ts), terrain
 * (terrain.ts) and rail (rail.ts).
 *
 * What changed from V3:
 *   - No glb. load() builds the terrain mesh from terrain.ts (plus a finer
 *     patch around the falls, where the dive runs 16 units from the cliff),
 *     installs the modules the page passes (WorldSceneOptions.modules), then
 *     puts grey stand-ins where nothing was installed: a block for every
 *     place whose LM_* object is missing, lights when no module added any,
 *     and (only when the page passes no modules at all) the water, the Sky
 *     Island, the bounty isle and the floating steps.
 *   - Depth is a share (0..1) of the WHOLE scroll budget, and the page
 *     scroll maps to it in absolute vh: scrollY of X vh is depth X / totalVh,
 *     whatever the spacer's height. The spacer only limits how far the page
 *     goes; it should be spacerVh() tall (the interface sizes it from the
 *     same budgets). The rail spends each stretch's scrollVh (rail.ts). A
 *     stop's depth is exact: stopDepths(). setPacing() retunes live.
 *   - Locking (setLock): "open" changes nothing; "look" flags the places past
 *     the frontier (markers carry enterable/beyond, park() refuses them);
 *     "locked" also ends the scroll a little past the frontier stop. The page
 *     spacer's height comes from spacerVh() (bindSpacer() keeps it in step).
 *   - railU() is the TRAIL curve parameter t (key i at i/(n-1)), the unit
 *     light.ts and blocks.ts both read; routeU() is the share of distance.
 *     placeCoord() and the stops' railU (placeU) are in WorldCtx too.
 *   - setProgress() and the "look" mist are passed on to any module that has
 *     setProgress(p) / setMist(indices) (blocks.ts does).
 *   - The park solver frames at most PARK_FOCUS_MAX_H of a landmark's height,
 *     so "zoom in" on the 348-unit falls frames the pool and the lower falls
 *     instead of backing off to fit the whole drop. Flights across the map
 *     rise over the ground between (FLIGHT_ARC_CLEAR) and take longer.
 *   - Grey pass 2: the rail places your airship (rail.shipAtS); modules read
 *     it every frame as ctx.shipPose(out), which follows the rail's scroll
 *     position (not a park), so blocks.ts draws the ship under the riding
 *     camera. The rail's keep-out covers the Harbour Isle, and the park
 *     solver stands on the floating isles' tops (parkSurface), so the Guild
 *     Hall park is solved against the Harbour Isle, not the ground 1,000 below.
 *
 *   - Grey pass 3: setPacing takes the flight's budget as a 10th value or as
 *     flightVh. (The mine of that pass went with v6; the cave behind the falls
 *     that outlived it, with the terrain mesh cut open at its two portals and
 *     the flights that glided along the rail to an underground stop, was
 *     removed on 2026-10-13, see layout.ts "The cave that was here".)
 *
 *   - v6 (world_art_bible_v6.md 4.3 step 3): the finer patch (FALLS_PATCH)
 *     covers the falls cliff, the pool and the north wall the hike climbs. The
 *     terrain mesh is whole: every place stands above ground. The Gate isle
 *     replaces the Harbour Isle. Every module's afterAll(ctx) runs after all installed, in
 *     install order. ctx.quality / onQuality carry the tier (quality.ts).
 *     The tail's progress through the arch is frame.tail (0..1) and
 *     ctx.placeCoord() - 7.
 *
 * Kept from V3 (see its header for the traps): fov is VERTICAL, so the park
 * solves its yaw offset from the live aspect every time; three applies fog
 * after tone mapping, so a fog colour is the colour a fully hazed pixel shows.
 */

// ── Rail and scroll ──────────────────────────────────────────────────────────

/** Exponential smoothing on depth, per second. V3's: the lag IS the glide. */
const SMOOTHING = 6.0;
/** Depth difference below which the glide counts as arrived. The route is ~13,000 units, so 1e-6 is ~0.01 unit. */
const DEPTH_EPS = 1e-6;
/** A frame longer than this is treated as this long, so a stall never teleports. */
const MAX_DT = 0.05;
/**
 * The governor on travel (final pass): the glide counts as programmatic travel
 * (the page's travel on load, the chip's travel, a scroll jump) while the
 * scroll target runs this many vh ahead of the camera, or the camera moves this
 * many vh in one frame. A hand on the wheel or trackpad keeps the gap under
 * ~50 vh; a travel between neighbouring stops opens ~120, the long ones ~380.
 */
const GOV_TRAVEL_GAP_VH = 60;
const GOV_TRAVEL_STEP_VH = 30;
/** Frames during travel and this long after it never count toward a step (quality.Governor.hold), ms. */
const GOV_TRAVEL_HOLD_MS = 1500;
/** Vertical lens, as V3 (layout.DESIGN_FOV). */
const FOV = Layout.DESIGN_FOV;
/** Near and far planes. From the flight and the Harbour Isle the view runs back across the whole map (~9,000 units). */
const NEAR = 2;
const FAR = 16000;
/**
 * Every look point used for blending is re-projected to this distance in front
 * of its camera, so blending two look points blends two DIRECTIONS.
 */
const LOOK_DIST = 600;

/**
 * "locked": how far past the frontier stop the scroll ends, in route units,
 * one per frontier (a1..a7). In units, so a pacing change does not move the
 * view. On this route the camera faces along the trail and the next place
 * mostly comes into view only 45-68% into the next stretch
 * (world-tests/v6-lockpeek.mjs), so no stopping point shows "what's next"
 * without most of the way there. Grey pass 2: each end is one of the route's
 * own authored views, never a wall: a1 up the valley to camp; a2 where the
 * falls' top shows over the rim ahead; a3 (grey pass 3) at the tunnel's
 * mouth, looking in along the torches; a4 in the lift's cage, looking up the
 * shaft at the daylight; a5 out over the water with the forest across it; a6
 * behind the first floating step looking up the staircase (602 from the
 * stop since pass 3 moved a6 back); a7 on foot past the bridge head with
 * your airship moored across it (the Harbour Isle stays hidden until the
 * flight). The scene alone sizes the spacer from this
 * (bindSpacer).
 */
// v6: a4's end is on the traverse just past the spur, looking down the gorge; a6's behind the
// first floating step; a7's past the bridge head (world-tests/v6-lockpeek.mjs).
const LOCK_PEEK_UNITS: readonly number[] = [380, 900, 95, 150, 457, 607, 780];
/**
 * v6 (bible 1.17): the a7 park flies through the telescope. From the rail the
 * camera rises over the dome, runs along the top of the tube past its rings,
 * drops onto the axis at the objective and flies on along it into the sky,
 * the lens narrowing to TEL_PARK_FOV, and comes to rest on the Creative
 * Strategy constellation (SKY_MARKS[6], where TELESCOPE points), a little
 * right of centre so the panel on the left leaves it clear. Leaving the park
 * retraces the same path. TEL_PARK_T seconds each way.
 */
const TEL_PARK_PLACE = "a7";
const TEL_PARK_FOV = 18;
const TEL_PARK_T = 2.4;
/** Along the axis from the pivot, and over it (units; the tube is
 *  TELESCOPE.length, 63, its objective ring 7.2 round): over the dome, along
 *  the top of the tube, over the objective and down onto the axis past it,
 *  the rest pose out in the sky. */
const TEL_PARK_PATH: ReadonlyArray<readonly [number, number]> = [
  [18, 16],
  [42, 16],
  [92, 4],
  [230, 0],
];
/** Over the tube the view dips this far below the axis (tan of ~14 degrees),
 *  so the tube and its rings run through the lower frame. */
const TEL_PARK_DIP = 0.25;
/** The rest pose's look, off the axis (degrees): left and down, so the
 *  constellation sits right of centre. */
const TEL_PARK_LOOK_OFF: readonly [number, number] = [3.5, 1];

/**
 * The modules installed when the page passes none: the light (sky, clouds,
 * time of day, the Mirror Lake) and the grey blocks (landmarks, sets, falls,
 * steps, lanterns, mist). Pass modules: [] for the bare grey terrain.
 */
// v6: the order of world_art_bible_v6.md 4.0; afterAll runs in the same order.
const DEFAULT_MODULES: ReadonlyArray<ModuleSpec> = [
  ["light", () => import("./light")],
  ["surfaces", () => import("./surfaces")],
  ["water", () => import("./water")],
  ["blocks", () => import("./blocks")],
  ["forest", () => import("./forest")],
  ["rocks", () => import("./rocks")],
  ["cover", () => import("./cover")],
  ["clouds", () => import("./clouds")],
  ["nightsky", () => import("./nightsky")],
  ["dress-shore", () => import("./dress-shore")],
  ["dress-gorge", () => import("./dress-gorge")],
  ["dress-lakeforest", () => import("./dress-lakeforest")],
  ["dress-sky", () => import("./dress-sky")],
  ["dress-gate", () => import("./dress-gate")],
  // The discount checkpoint's trail cache on the saddle (checkpoint.ts).
  ["dress-checkpoint", () => import("./dress-checkpoint")],
  // After the dressers (it switches their tagged lamps), before life (which finds its smoke).
  ["progress-world", () => import("./progress-world")],
  ["life", () => import("./life")],
];

/**
 * v6: the trail registers its line plus 4 (world_art_bible_v6.md 2.3), one
 * polyline per stretch above ground: a point flagged `under` ends its run, as
 * the segment after it runs through the rock (or the air, down the falls).
 */
function registerTrailFootprints(paths: ReadonlyArray<readonly Layout.PathPoint[]>) {
  for (const path of paths) {
    let run: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      run.push(p);
      if (p.under || i === path.length - 1) {
        if (run.length >= 2) addPathLine(run, 4);
        run = [];
      }
    }
  }
}

/**
 * v5: FOG_TABLE is retired (world_art_bible.md 1.4). The fog is the light
 * key's Firewatch ramp; its distances (rampStart / rampEnd) come from
 * light.ts's blended state (state.fogNear / fogFar) and the scene only adds the
 * park's push. The scene writes them to scene.fog.near / far AFTER the modules
 * update, every frame, and light.ts reads them from there into the ramp.
 * These are the distances when no light module is installed.
 */
const FOG_DEFAULT_NEAR = 1400;
const FOG_DEFAULT_FAR = 9000;
/**
 * camera.far = rampEnd x FAR_PER_RAMP, so the ramp is also the cull, never
 * under FAR_MIN.
 */
const FAR_PER_RAMP = 1.02;
const FAR_MIN = 4000;

/** Grey stand-in look, used only when no module adds lights or sky. */
const GREY_HAZE = new THREE.Color().setRGB(0.62, 0.66, 0.72, THREE.LinearSRGBColorSpace);
const GREY_SUN = new THREE.Color().setRGB(1.0, 0.95, 0.88, THREE.LinearSRGBColorSpace);
/** Toward the sun: afternoon, from the south-west, so the route north is side-lit. */
const SUN_DIR = new THREE.Vector3(-0.55, 0.6, 0.58).normalize();

// ── Terrain ──────────────────────────────────────────────────────────────────

/**
 * The finer patch around the falls: bounds in world units (snapped out to the
 * main grid) and how many patch cells per main cell. The main grid draws the
 * 84 degree falls cliff in 1-2 cells. Grey pass 2: the cliff is on the gorge's
 * NORTH wall (lip z 1255, foot z ~1300, layout WORLD.falls), and the dive
 * faces it head-on with the curtain up to 68% of the frame's width, so the
 * patch covers the wall across that width (x -380..180) from behind the lip
 * to the pool.
 */
// v6: the falls moved to the SOUTH wall (lip z 1745, foot ~1700, pool 1615),
// and the hike climbs the north wall's cliff bands to the spur (a4): one patch
// covers both, 4 cells per main cell (~6.9 units). One patch, because
// surfaces.ts skins "Terrain" and "Terrain:falls" and reads the patch as one
// regular grid. ~47k triangles (v5's was ~12k).
const FALLS_PATCH = { minX: -380, maxX: 880, minZ: 990, maxZ: 1870, sub: 4 };
const PATCHES = [FALLS_PATCH] as const;

// ── Park focus ───────────────────────────────────────────────────────────────

/**
 * The park frames at most this much of a landmark's height (from its base).
 * The falls are 348 tall and the pulley lift 300: fitted whole, the park
 * would back off further than the rail stop. The rest runs off the top.
 */
const PARK_FOCUS_MAX_H = 170;
/**
 * A landmark whose framed part is at least PARK_TALL_H tall is framed larger
 * on arrival. With V3's 25-40% of the frame, the falls' park ended 885 from
 * the falls against its rail stop's 633: the "zoom in" backed away.
 */
const PARK_TALL_H = 120;
const PARK_TALL_HEIGHT_MIN = 0.45;
const PARK_TALL_HEIGHT_MAX = 0.62;
/** A park ending further than this share of its rail stop's distance is re-solved in the tall band. */
const PARK_MAX_BACKOFF = 0.95;
/** Flights longer than FLIGHT_FAR take up to this much longer, at FLIGHT_VERY_FAR. */
const FLIGHT_T_EXTRA = 1.0;
const FLIGHT_VERY_FAR = 5000;
/** A flight arcs up so its middle clears the ground under the straight line by this much. */
const FLIGHT_ARC_CLEAR = 80;


// ── Copied from world-v3/scene.ts: marker and park constants ────────────────

// ── Markers ──────────────────────────────────────────────────────────────────

/** How far above its landmark's highest point a marker's pin floats, in CSS pixels. */
const MARKER_LIFT_PX = 14;
/** Final pass B: the most a pin floats over its landmark's highest sample on screen. */
const PIN_OVER_TOP_PX = 12;
/**
 * The lift when the lifted pin would land on a landmark standing BEHIND this
 * one. From the shore the stone bridge sits just under the viaduct's deck, and
 * a full lift put "Video Ads I" on the viaduct.
 */
const MARKER_LIFT_MIN_PX = 3;
/** ...which applies only while the landmark itself is shorter than this on screen. */
const MARKER_SMALL_PX = 90;
/**
 * V4: the falls, the pulley lift and the great tree run off the top of the
 * frame at their own stops. Their pin then holds this far down from the top,
 * below the header, while the landmark's base is on screen.
 */
const MARKER_EDGE_PX = 72;
/**
 * Round 1: a landmark counts as on screen while its samples' box reaches this
 * far into the frame on both axes, even when its top or middle is outside.
 */
const MARKER_PART_PX = 40;
/** Round 1: below this size on screen (both axes) a landmark's box is its hit area. */
const PICK_SMALL_PX = 56;
/** Round 1 verify: the PLACES index of the Job Board, whose isle stays hidden until the flight. */
const GATE_PLACE = PLACES.findIndex((p) => p.id === "a8");
/** Round 1: what the hovered landmark gains, added on screen (sRGB: about 12% on red, 6% on blue). */
const HOVER_LIFT_COLOR = new THREE.Color("#1e1710");


// ── Park ("zoom into the place") ─────────────────────────────────────────────

/*
 * WHAT A PARK IS. The camera ends at most PARK_DIST_RATIO of the rail stop's
 * distance from the landmark. The first solver sized the landmark to 34% of
 * the frame, but every rail stop ALREADY shows its landmark at 25-31% from
 * ~360 units, so the camera stopped at 290-340 units: the a3 "zoom" moved 52
 * units and 6.7 degrees, and the viaduct's ended FURTHER away than its stop.
 * Astra, which Lovro called "super smooth", halves the distance. So the
 * distance is now set relative to the rail stop, and size only caps it.
 */
/**
 * V3: the park ends about this share of its rail stop's distance from the
 * landmark. V2 used 0.42, which filled the frame with the landmark and cut
 * away what it stands in (the river under the bridge, the pond round the
 * jetty). The landmark's size on screen now decides within PARK_HEIGHT_MIN..MAX.
 */
const PARK_DIST_RATIO = 0.6;
/**
 * ...and no nearer than this share, nor inside 1.4x the landmark's own
 * footprint plus 20 units. Sized for height alone, the flat jetty pulled the
 * camera to 65 units with its near end 12 units from the lens.
 */
const PARK_MIN_RATIO = 0.3;
/** The landmark's visible height on arrival, as a fraction of the frame height. */
const PARK_HEIGHT_MIN = 0.25;
const PARK_HEIGHT_MAX = 0.4;
/** Screen px the panel (420) and its 200 px fade cover on the left, plus a 20 px margin. */
const PANEL_CLEAR_PX = 640;
/**
 * The landmark's box stays inside these NDC bounds: right edge, top (clear of
 * the header line), bottom (the dock and NEXT block have faded out by then).
 */
const PARK_RIGHT_NDC = 0.92;
const PARK_TOP_NDC = 0.84;
const PARK_BOTTOM_NDC = -0.92;
/**
 * Vertical centre of the landmark's projected box, NDC. Above the middle, so
 * the lower third of the frame shows what it stands in (V2: -0.04).
 */
const PARK_Y_NDC = 0.12;
/** On very wide screens the landmark would drift to the middle; it stays at least this far right. */
const PARK_X_MIN_NDC = 0.14;
/** ...and on narrow ones at most this far right. */
const PARK_X_MAX_NDC = 0.36;
/**
 * Camera pitch candidates, degrees below horizontal. V3 looks down on each
 * place from 18-22 degrees, so the ground it stands on reads under it; 25 is a
 * last resort for a view blocked lower down (the gorge rim, the jetty's bank).
 */
const PARK_PITCHES = [18, 20, 22, 25];
/** 0 = come in straight at the landmark, 1 = come in along the rail's own heading. */
const PARK_HEADING_BLEND = 0.5;
/** Approach headings, degrees off the approach line. The long landmarks need the oblique ones to come close. */
const PARK_YAWS = [0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75];
/** Share of the landmark's surface samples that must see the camera. Below it a pose is last resort. */
const PARK_MIN_VISIBLE = 0.9;
/**
 * A landmark wider than the free part of the frame may run off its RIGHT edge
 * by up to this share of its own width, anchored at the panel side. Held
 * fully in frame at the zoom distance, the 120-unit bridge could only be
 * framed end-on (75 degrees round), where it read as a slab.
 */
const PARK_MAX_OVERFLOW = 0.36;
/** Score weights: distance beyond the cap, heading off the approach (squared), pitch above the lowest, hidden share, overflow share. */
const PARK_W_DIST = 1.2;
const PARK_W_YAW = 1.2;
const PARK_W_PITCH = 0.35;
const PARK_W_HIDDEN = 3;
const PARK_W_OVER = 1.2;
/** Landmark's camera-facing side turned away from the sun: 0 fully lit .. 1 fully backlit. */
const PARK_W_SUN = 1.2;
/** Height outside PARK_HEIGHT_MIN..MAX, per 10% of frame height. */
const PARK_W_SIZE = 3;
/** Another landmark's box touching this one's on screen. */
const PARK_W_TOUCH = 6;
/** Share of the lower third's sight lines stopped by a raised foreground (a rim, a bank) before the landmark. */
const PARK_MAX_BLOCKED_LOW = 0.35;
/** A lower-third sight line that meets the ground before this share of the way to the landmark's base level is blocked. */
const PARK_LOW_REACH = 0.55;
const PARK_W_BLOCKED_LOW = 8;
/** Minimum camera height above the ground under it while parked or in flight. */
const PARK_CLEARANCE = 14;
/** Flight time range, seconds. Short hops take the low end, long flights the high end. */
const FLIGHT_T_MIN = 1.1;
const FLIGHT_T_MAX = 1.4;
/** Distance (world units) at which a flight takes FLIGHT_T_MAX. */
const FLIGHT_FAR = 900;
/** Carried-in velocity is capped so a fling of the scroll wheel cannot overshoot a park. */
const FLIGHT_MAX_V0 = 400;
/**
 * Shape of the flight: (1 - s)^N (1 + N s), a critically damped spring fitted
 * to a finite interval. The first curve was a symmetric smootherstep, which
 * sat still for the first 300 ms after a click (progress 0.10-0.17) while
 * Astra's damping is 90% there by ~350 ms. At N = 8 this one is 56% there at
 * 0.2 T, 93% at 0.4 T, and still arrives with zero velocity and acceleration.
 */
const FLIGHT_N = 8;
/** Switching from one parked place to another dips the panel this far out and back. */
const PARK_SWITCH_DIP = 0.35;

// ── Contract ─────────────────────────────────────────────────────────────────

export type { LockMode, LockState } from "./modules";

export interface AreaAnchor {
  id: string;
  /** Scroll depth 0..1. Ignored for an anchor that matches a layout place (its stop depth is exact). */
  depth: number;
  /** LM_* object name (layout.PLACES[i].mesh). */
  landmark?: string | null;
}

export interface ProjectedMarker {
  id: string;
  /** CSS px within the container, already lifted above the landmark. */
  x: number;
  y: number;
  /**
   * In front of the camera and inside the frame. Round 1: also while only
   * part of the landmark is in the frame (its top above it, its side past an
   * edge); the page's labels then slide into the visible part (rl..rb).
   */
  visible: boolean;
  /** 0..1, nearer is larger. */
  proximity: number;
  /** Can be opened (park() accepts it) under the current lock. */
  enterable: boolean;
  /** Past the frontier ("look" and "locked" only): draw it in mist. */
  beyond: boolean;
  /**
   * Round 1: the landmark's surface samples on screen, CSS px, NOT clipped to
   * the frame (left, top, right, bottom). NaN when none is in front of the
   * camera or the anchor has no landmark.
   */
  rl?: number;
  rt?: number;
  rr?: number;
  rb?: number;
}

export interface WorldFrame {
  /** Current smoothed scroll depth, 0..1 of the whole scroll budget. */
  depth: number;
  /** 0..1 along the route by distance (the light system's clock). */
  railU: number;
  /** 0 at the first stop .. 7 at the last, fractional between (see WorldCtx.placeCoord). */
  place: number;
  /** Anchor being flown to / parked at; null on the rail (and while flying back to it). */
  parkedId: string | null;
  /** 0 on the rail .. 1 fully arrived. Eased, animates both ways. */
  parkProgress: number;
  /** 0 .. 1 through the current flight; 1 when no flight is running. */
  flight: number;
  /** The SAME array and objects every frame, mutated in place. */
  markers: ProjectedMarker[];
  /** The lock state (the same object every frame). */
  lock: Readonly<LockState>;
  /** Deepest depth the scroll can reach under the lock (1 unless "locked"). */
  maxDepth: number;
  triangles: number;
  calls: number;
  /** v6: 0..1 through the tail after a8 (the fly through the arch); 0 before it. */
  tail: number;
}

export interface WorldSceneOptions {
  /** Modules to install, in order, after the terrain is built (see modules.ts). Default: light, then blocks. [] = none. */
  modules?: ReadonlyArray<ModuleSpec>;
  /** Starting lock. Default open, frontier 0. */
  lock?: { mode: LockMode; frontier: number };
  /** Starting per-stretch budgets (8 or 9 values, vh). Default: layout scrollVh + TAIL_VH. */
  pacing?: readonly number[];
  /**
   * Grey stand-ins for the water, the Sky Island, the bounty isle and the
   * steps. Default: only when no modules are passed. Landmark blocks and
   * lights are always stood in when missing.
   */
  fallbacks?: boolean;
  /**
   * Cheap laptops (poster.ts): "auto" (default) shows the posters when this
   * machine cannot draw the map; "on" never builds the 3D; "off" never
   * leaves it (the harnesses, the bench on SwiftShader).
   */
  poster?: PosterPreference;
  /** Dev only: make the GPU this many times slower from the load on (simulateSlowGpu). 1 = off. */
  slowGpu?: number;
  /**
   * Dev only (?coldstall=MS&coldframes=N): the load probe's first N synced
   * frames each cost MS more on the GPU (the simulator's quad, calibrated),
   * then nothing. Proves a cold first frame does not lower the tier.
   */
  coldStall?: { ms: number; frames: number };
}

// ── Internals ────────────────────────────────────────────────────────────────

export interface Landmark {
  /** World AABB of the landmark plus the child parts that belong to it. */
  box: THREE.Box3;
  /** Centre of the box. */
  center: THREE.Vector3;
  /** Marker anchor: box centre in XZ, box top in Y. */
  top: THREE.Vector3;
  /**
   * The part a student can see: the box of the surface samples above the
   * ground and the water. The viaduct's piers run 15 units into the gorge
   * floor and the jetty's stand in the pond, so the full box overstates both.
   */
  vis: THREE.Box3;
  visCenter: THREE.Vector3;
  /** World points spread over the landmark's visible surface, xyz packed. */
  samples: Float32Array;
  /** Final pass: the highest point over the middle of the box (its central
   *  40% across x and z), so a chimney or a mast at one end does not lift the
   *  marker off the body (ANCHOR_ON_BODY). */
  bodyTop: number;
}

/**
 * Final pass: landmarks whose marker pins to the top of their body instead of
 * the box's top. The Trail Hut's box top is its chimney at one gable end
 * (43 over the bench), so the pin floated in the smoke above the roof's middle
 * and the click in's leader ended ~100 px over the hut.
 */
const ANCHOR_ON_BODY: ReadonlySet<string> = new Set(["LM_TrailHut"]);

/**
 * Final pass C (the experience judge): landmarks whose marker pins over the
 * building at their place's own position (layout PLACES pos), at the highest
 * point within this radius of it, instead of over their box. The
 * observatory's box centre and top belong to the telescope, so its pin hung
 * ~70-150 px over the dome in the night sky; the boathouse's box takes in its
 * jetty and halos, so from the side its pin sat over open water.
 */
// Final pass D (verifier, the experience fixer's request): Base Camp's pin
// sits on the lookout's own axis (its roof rod's tip); over the box top, which
// leans toward the flagpole's corner, it hung beside the roof over the grass
// at the steep click in.
const ANCHOR_ON_PLACE: ReadonlyMap<string, number> = new Map([
  ["LM_Observatory", 10],
  ["LM_Boathouse", 8],
  ["LM_Lookout", 1],
]);

/**
 * Final pass E: how far (world units) under that highest point the pin goes.
 * The lookout's highest point on its axis is the lightning rod's tip
 * (dress-shore buildLookout: the rod's top is roofY + 14.9, the red roof's
 * apex roofY + 7.85). The rod is under 2 px wide, so at the steep a2 click in
 * the pin hung ~70 px over the roof, over the grass. 7.05 puts it on the
 * roof's apex: on the finial at the stop, on the roof's peak at the click in.
 */
const ANCHOR_DROP: ReadonlyMap<string, number> = new Map([["LM_Lookout", 7.05]]);

/**
 * Final pass C: extra click areas that count as a landmark's own (world
 * boxes, built from the place's position). Base Camp's keeper's cabin stands
 * 28 west of the lookout (dress-shore buildCamp: 16 by 12 with its porch to
 * the south), merged into the camp's mesh, so clicking it did nothing.
 */
function clickProxies(name: string, lm: Landmark): THREE.Box3[] {
  if (name !== "LM_Lookout") return [];
  const p = PLACES.find((q) => q.mesh === name);
  if (!p) return [];
  const g = lm.box.min.y;
  return [new THREE.Box3(new THREE.Vector3(p.pos.x - 39, g - 6, p.pos.z - 14), new THREE.Vector3(p.pos.x - 17, g + 24, p.pos.z + 10))];
}

/** Highest vertex of `meshes` within `r` (horizontal) of (x, z); -Infinity when none. */
function topNear(meshes: readonly THREE.Mesh[], x: number, z: number, r: number): number {
  const v = new THREE.Vector3();
  let top = -Infinity;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position");
    if (!pos || (m as THREE.InstancedMesh).isInstancedMesh) continue;
    m.updateWorldMatrix(true, false);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (v.y > top && (v.x - x) * (v.x - x) + (v.z - z) * (v.z - z) <= r * r) top = v.y;
    }
  }
  return top;
}

/** Ground height, or the water surface where a water body covers the ground. */
export type SurfaceFn = (x: number, z: number) => number;

/** Most surface samples kept per landmark. */
const LANDMARK_SAMPLES = 96;

/**
 * Build a landmark from its meshes (world matrices already updated). `surface`
 * is the ground-or-water height; samples at or below it are dropped.
 */
export function buildLandmark(meshes: THREE.Mesh[], surface: SurfaceFn | null): Landmark | null {
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const pts: number[] = [];
  const v = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const m of meshes) {
    const g = m.geometry;
    const pos = g.getAttribute("position");
    if (!pos) continue;
    if (!g.boundingBox) g.computeBoundingBox();
    box.union(part.copy(g.boundingBox!).applyMatrix4(m.matrixWorld));
    // Vertices, plus each triangle's centroid so the middle of a face counts too.
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      pts.push(v.x, v.y, v.z);
    }
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      v.copy(a).add(b).add(c).divideScalar(3).applyMatrix4(m.matrixWorld);
      pts.push(v.x, v.y, v.z);
    }
  }
  if (box.isEmpty()) return null;
  const vis = new THREE.Box3();
  const kept: number[] = [];
  for (let i = 0; i < pts.length; i += 3) {
    const y = pts[i + 1];
    if (surface && y <= surface(pts[i], pts[i + 2]) + 0.5) continue;
    kept.push(pts[i], y, pts[i + 2]);
  }
  // Nothing above ground (should not happen): fall back to every point.
  const src = kept.length ? kept : pts;
  const count = src.length / 3;
  const stride = Math.max(1, count / LANDMARK_SAMPLES);
  const samples = new Float32Array(Math.min(count, LANDMARK_SAMPLES) * 3);
  let o = 0;
  for (let f = 0; o < samples.length && Math.floor(f) < count; f += stride) {
    const i = Math.floor(f) * 3;
    samples[o++] = src[i];
    samples[o++] = src[i + 1];
    samples[o++] = src[i + 2];
  }
  for (let i = 0; i < src.length; i += 3) vis.expandByPoint(v.set(src[i], src[i + 1], src[i + 2]));
  const center = box.getCenter(new THREE.Vector3());
  const hx = (box.max.x - box.min.x) * 0.2;
  const hz = (box.max.z - box.min.z) * 0.2;
  let bodyTop = -Infinity;
  for (let i = 0; i < src.length; i += 3) {
    if (Math.abs(src[i] - center.x) <= hx && Math.abs(src[i + 2] - center.z) <= hz && src[i + 1] > bodyTop) bodyTop = src[i + 1];
  }
  return {
    box,
    center,
    top: new THREE.Vector3(center.x, box.max.y, center.z),
    vis,
    visCenter: vis.getCenter(new THREE.Vector3()),
    samples: samples.subarray(0, o),
    bodyTop: Number.isFinite(bodyTop) ? bodyTop : box.max.y,
  };
}

/** Shared by the scene and world-tests/v2-fix-framing.mjs, which runs it offline against the real terrain. */
export interface ParkInput {
  landmark: Landmark;
  /** Every landmark, the target included (for "another landmark in front"). */
  others: Iterable<Landmark>;
  /** Rail pose at the area's own stop. */
  railPos: THREE.Vector3;
  railTarget: THREE.Vector3;
  aspect: number;
  /** Viewport width in CSS px (the panel is a fixed px width). */
  widthPx: number;
  surface: SurfaceFn | null;
  /** Boxes that block sight lines besides the ground (the hamlet's houses). */
  occluders?: readonly THREE.Box3[];
  /** Unit vector toward the sun (WorldCtx.sunDir). Poses that see the lit side score better. */
  sunDir?: THREE.Vector3;
  /** Harness only: called with every candidate's numbers. */
  trace?: (c: Record<string, number | boolean>) => void;
  /** V4: the landmark's height on arrival as a share of the frame (default PARK_HEIGHT_MIN..MAX). */
  heightMin?: number;
  heightMax?: number;
  /** Trees as vertical cylinders, 5 floats each: x, z, bottom y, top y, radius. They count as foreground in the lower third. */
  trees?: Float32Array;
}

export interface ParkResult {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  /** Camera to landmark centre, 3D. */
  dist: number;
  railDist: number;
  pitch: number;
  yaw: number;
  visible: number;
  score: number;
  /** Landmark's visible height as a fraction of the frame height. */
  heightFrac: number;
  /** 0 = the camera sees the sun-lit side square on, 1 = fully backlit. */
  backlit: number;
  /** Share of the lower third's sight lines a raised foreground stops short. */
  blockedLow: number;
  /** Another landmark's box touches this one's on screen. */
  touching: boolean;
}

/**
 * Solve the camera that frames a landmark after a click: about
 * PARK_DIST_RATIO of the rail stop's distance away and PARK_HEIGHT_MIN..MAX of
 * the frame tall, looking down 18-22 degrees with the landmark above the
 * middle so the lower third shows what it stands in, clear of the panel (a
 * long one may run off the right edge), seen past the terrain, the water and
 * the houses. Every candidate heading and pitch is scored (sun-lit side,
 * straight-on, no other landmark touching it, no bank filling the lower
 * third); nothing is accepted just because it came first.
 */
export function solveParkPose(input: ParkInput): ParkResult {
  const { landmark: lm, railPos, railTarget, surface } = input;
  const hMin = input.heightMin ?? PARK_HEIGHT_MIN;
  const hMax = input.heightMax ?? PARK_HEIGHT_MAX;
  const probe = new THREE.PerspectiveCamera(FOV, input.aspect, 1, 6000);
  probe.updateProjectionMatrix();
  const railDist = railPos.distanceTo(lm.center);
  const cap = PARK_DIST_RATIO * railDist;
  const floor = Math.max(
    PARK_MIN_RATIO * railDist,
    1.4 * 0.5 * Math.hypot(lm.vis.max.x - lm.vis.min.x, lm.vis.max.z - lm.vis.min.z) + 20,
  );
  const left = -1 + (2 * PANEL_CLEAR_PX) / Math.max(1, input.widthPx);
  const cx = Math.min(PARK_X_MAX_NDC, Math.max(PARK_X_MIN_NDC, (left + PARK_RIGHT_NDC) / 2));
  const frame = { left, cx, cy: PARK_Y_NDC };
  const room = PARK_RIGHT_NDC - left;

  // The line the camera comes in on: part "toward the landmark" from the
  // rail's view of it, part the rail's own heading there. Pure "toward"
  // swung the view off the valley onto a blank hillside; pure heading
  // turned the move into a sideways slide.
  let tx = lm.center.x - railPos.x;
  let tz = lm.center.z - railPos.z;
  const tl = Math.hypot(tx, tz) || 1;
  let hx = railTarget.x - railPos.x;
  let hz = railTarget.z - railPos.z;
  const hl = Math.hypot(hx, hz) || 1;
  tx /= tl;
  tz /= tl;
  hx /= hl;
  hz /= hl;
  let ux = tx + (hx - tx) * PARK_HEADING_BLEND;
  let uz = tz + (hz - tz) * PARK_HEADING_BLEND;
  const ul = Math.hypot(ux, uz);
  if (ul < 1e-3) {
    ux = 0;
    uz = -1;
  } else {
    ux /= ul;
    uz /= ul;
  }

  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const best: ParkResult = {
    pos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    dist: 0,
    railDist,
    pitch: 0,
    yaw: 0,
    visible: 0,
    score: Infinity,
    heightFrac: 0,
    backlit: 0,
    blockedLow: 0,
    touching: false,
  };
  // The sun, flattened: which side of a landmark it lights.
  let sunX = 0;
  let sunZ = 0;
  if (input.sunDir) {
    const l = Math.hypot(input.sunDir.x, input.sunDir.z) || 1;
    sunX = input.sunDir.x / l;
    sunZ = input.sunDir.z / l;
  }
  for (const pitch of PARK_PITCHES) {
    for (const yawDeg of PARK_YAWS) {
      const yaw = THREE.MathUtils.degToRad(yawDeg);
      const cs = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const dx = ux * cs - uz * sn;
      const dz = ux * sn + uz * cs;
      // Closest distance at which the landmark still fits the free part of
      // the frame (height fully, width with PARK_MAX_OVERFLOW off the right
      // edge), and the distances at which it is PARK_HEIGHT_MAX and
      // PARK_HEIGHT_MIN of the frame tall. The park takes the cap, moved
      // into that size band, and never closer than the fit or the floor.
      const fitDist = searchDistance(lm, dx, dz, pitch, probe, frame, pos, look, (e) => !fitsLoose(e, room));
      const nearDist = searchDistance(lm, dx, dz, pitch, probe, frame, pos, look, (e) => e.maxY - e.minY > 2 * hMax);
      const farDist = searchDistance(lm, dx, dz, pitch, probe, frame, pos, look, (e) => e.maxY - e.minY > 2 * hMin);
      const dist = Math.max(fitDist, floor, Math.min(farDist, Math.max(nearDist, cap)));
      const frameHere = { cx, cy: PARK_Y_NDC };
      poseAt(lm, dx, dz, pitch, dist, probe, frameHere, pos, look);
      let e = projectedExtent(lm, probe);
      for (let k = 0; k < 2; k++) {
        // Centre the projected box, not the box's centre: seen obliquely,
        // the near end of a long landmark projects much larger than the far.
        frameHere.cy += PARK_Y_NDC - (e.maxY + e.minY) / 2;
        // Wider than the free part: pin its left end just right of the panel
        // and let the far end run off the frame.
        if (e.maxX - e.minX > room || e.minX < left) frameHere.cx += left + 0.03 - e.minX;
        poseAt(lm, dx, dz, pitch, dist, probe, frameHere, pos, look);
        e = projectedExtent(lm, probe);
      }
      const over = Math.max(0, e.maxX - PARK_RIGHT_NDC) / Math.max(1e-6, e.maxX - e.minX);
      const d3 = pos.distanceTo(lm.center);
      const heightFrac = (e.maxY - e.minY) / 2;
      // Which side the camera sees: its view across the landmark, flattened,
      // against the sun's. Facing the sun (looking into it) = backlit.
      let vx = lm.visCenter.x - pos.x;
      let vz = lm.visCenter.z - pos.z;
      const vl = Math.hypot(vx, vz) || 1;
      vx /= vl;
      vz /= vl;
      const backlit = input.sunDir ? (1 + (vx * sunX + vz * sunZ)) / 2 : 0;
      let score =
        PARK_W_DIST * Math.max(0, d3 / cap - 1) +
        PARK_W_YAW * (yawDeg / 90) ** 2 +
        (PARK_W_PITCH * (pitch - PARK_PITCHES[0])) / 15 +
        PARK_W_OVER * over +
        PARK_W_SUN * backlit +
        PARK_W_SIZE * 10 * Math.max(0, hMin - 0.01 - heightFrac, heightFrac - hMax - 0.01);
      if (e.minX < left - 0.01 || over > PARK_MAX_OVERFLOW + 0.02 || e.maxY > PARK_TOP_NDC + 0.02 || e.minY < PARK_BOTTOM_NDC - 0.02) score += 20;
      let visible = 1;
      let blockedLow = 0;
      if (surface) {
        if (pos.y < surface(pos.x, pos.z) + PARK_CLEARANCE) score += 100;
        visible = visibleShare(pos, lm, surface, input.occluders);
        score += PARK_W_HIDDEN * (1 - visible);
        if (visible < PARK_MIN_VISIBLE) score += 10;
        blockedLow = lowerThirdBlocked(lm, probe, surface, left, input.trees);
        if (blockedLow > PARK_MAX_BLOCKED_LOW) score += PARK_W_BLOCKED_LOW * blockedLow;
      }
      score += foregroundIntrusion(lm, input.others, probe, left);
      const touching = touchesOther(lm, input.others, probe, e);
      if (touching) score += PARK_W_TOUCH;
      input.trace?.({ pitch, yaw: yawDeg, dist: d3, ratio: d3 / railDist, heightFrac, backlit, blockedLow, touching, visible, over, score });
      if (score < best.score) {
        best.score = score;
        best.pos.copy(pos);
        best.look.copy(look);
        best.dist = d3;
        best.pitch = pitch;
        best.yaw = yawDeg;
        best.visible = visible;
        best.heightFrac = heightFrac;
        best.backlit = backlit;
        best.blockedLow = blockedLow;
        best.touching = touching;
      }
    }
  }
  return best;
}

interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
const extentScratch: Extent = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
const pScratch = new THREE.Vector3();

/** NDC extent of the landmark's visible box on the probe camera. */
function projectedExtent(lm: Landmark, probe: THREE.PerspectiveCamera): Extent {
  const b = lm.vis;
  const e = extentScratch;
  e.minX = e.minY = Infinity;
  e.maxX = e.maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    pScratch.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(probe);
    if (pScratch.x < e.minX) e.minX = pScratch.x;
    if (pScratch.x > e.maxX) e.maxX = pScratch.x;
    if (pScratch.y < e.minY) e.minY = pScratch.y;
    if (pScratch.y > e.maxY) e.maxY = pScratch.y;
  }
  return e;
}

/** Height fits the band (it is re-centred after), width fits the free part plus the allowed overflow. */
function fitsLoose(e: Extent, room: number): boolean {
  return e.maxY - e.minY <= PARK_TOP_NDC - PARK_BOTTOM_NDC && e.maxX - e.minX <= room / (1 - PARK_MAX_OVERFLOW);
}

/**
 * Bisect the distance along (dx, dz) at which `tooBig` flips: tooBig(near) is
 * true, tooBig(far) false. Returns the nearest distance where it is false.
 */
function searchDistance(
  lm: Landmark,
  dx: number,
  dz: number,
  pitch: number,
  probe: THREE.PerspectiveCamera,
  frame: { cx: number; cy: number },
  pos: THREE.Vector3,
  look: THREE.Vector3,
  tooBig: (e: Extent) => boolean,
): number {
  let lo = 20;
  let hi = 1600;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    poseAt(lm, dx, dz, pitch, mid, probe, frame, pos, look);
    if (tooBig(projectedExtent(lm, probe))) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * The camera `dist` back from the landmark along (dx, dz), pitched down,
 * turned so the landmark's visible centre lands at (frame.cx, frame.cy).
 * Solved by a few fixed-point corrections on a probe camera, because the yaw
 * offset and the pitch interact once the target is off-axis.
 */
function poseAt(
  lm: Landmark,
  dx: number,
  dz: number,
  pitchDeg: number,
  dist: number,
  probe: THREE.PerspectiveCamera,
  frame: { cx: number; cy: number },
  outPos: THREE.Vector3,
  outLook: THREE.Vector3,
) {
  const C = lm.visCenter;
  const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const tanH = tanV * probe.aspect;
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  let yawOff = Math.atan(frame.cx * tanH);
  let depress = pitch - Math.atan(frame.cy * tanV);
  const p = pScratch;
  for (let k = 0; k < 4; k++) {
    outPos.set(C.x - dx * dist, C.y + dist * Math.tan(depress), C.z - dz * dist);
    // Turn the view left of the landmark by yawOff, so the landmark sits right of centre.
    const c = Math.cos(yawOff);
    const s = Math.sin(yawOff);
    // right of (dx, dz) is (-dz, dx); forward = d*cos - right*sin
    const fx = dx * c + dz * s;
    const fz = dz * c - dx * s;
    const cp = Math.cos(pitch);
    outLook.set(outPos.x + fx * cp * LOOK_DIST, outPos.y - Math.sin(pitch) * LOOK_DIST, outPos.z + fz * cp * LOOK_DIST);
    probe.position.copy(outPos);
    probe.lookAt(outLook);
    probe.updateMatrixWorld();
    p.copy(C).project(probe);
    const ex = frame.cx - p.x;
    const ey = frame.cy - p.y;
    if (Math.abs(ex) < 1e-4 && Math.abs(ey) < 1e-4) break;
    // Turning further left moves the landmark right on screen; raising the
    // camera (more depression) moves it down.
    yawOff += Math.atan(ex * tanH) * 0.9;
    depress -= Math.atan(ey * tanV) * 0.9;
  }
}

/**
 * Share of the landmark's surface samples the camera can see past the ground
 * and the water. The first solver sampled a lattice through the landmark's
 * BOX and accepted a viaduct pose with 57% of the silhouette behind the gorge
 * rim; samples on the geometry itself are what the student would see.
 */
export function visibleShare(
  pos: THREE.Vector3,
  lm: Landmark,
  surface: SurfaceFn,
  occluders?: readonly THREE.Box3[],
): number {
  const s = lm.samples;
  const n = s.length / 3;
  if (!n) return 1;
  let seen = 0;
  for (let i = 0; i < s.length; i += 3) {
    const x = s[i];
    const y = s[i + 1];
    const z = s[i + 2];
    if (occluders && segmentHitsBoxes(pos, x, y, z, occluders)) continue;
    const len = Math.hypot(x - pos.x, z - pos.z);
    // One step per ~4 units, stopping 2 units short of the point itself.
    const steps = Math.max(8, Math.min(90, Math.ceil(len / 4)));
    const end = Math.max(0, 1 - 2 / Math.max(len, 1));
    let clear = true;
    for (let k = 1; k <= steps; k++) {
      const f = (k / steps) * end;
      if (surface(pos.x + (x - pos.x) * f, pos.z + (z - pos.z) * f) > pos.y + (y - pos.y) * f) {
        clear = false;
        break;
      }
    }
    if (clear) seen++;
  }
  return seen / n;
}

/** Slab test: does the segment from `a` to (x, y, z), stopping 2% short, pass through any box? */
function segmentHitsBoxes(a: THREE.Vector3, x: number, y: number, z: number, boxes: readonly THREE.Box3[]): boolean {
  const dx = (x - a.x) * 0.98;
  const dy = (y - a.y) * 0.98;
  const dz = (z - a.z) * 0.98;
  for (const b of boxes) {
    let t0 = 0;
    let t1 = 1;
    const axes: Array<[number, number, number, number]> = [
      [a.x, dx, b.min.x, b.max.x],
      [a.y, dy, b.min.y, b.max.y],
      [a.z, dz, b.min.z, b.max.z],
    ];
    let hit = true;
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) {
          hit = false;
          break;
        }
        continue;
      }
      let ta = (lo - o) / d;
      let tb = (hi - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

/** Is `lm` the same landmark as `other`, or one of its parts (the lamp in the lighthouse)? */
function sameLandmark(lm: Landmark, other: Landmark): boolean {
  return other === lm || lm.box.containsBox(other.box) || other.box.containsBox(lm.box);
}

/**
 * Does any other landmark's projected box touch the target's (extent `e`,
 * NDC) on the probe camera? Near or far: a lighthouse whose outline runs into
 * the windmill behind it reads as one lump.
 */
function touchesOther(target: Landmark, others: Iterable<Landmark>, probe: THREE.PerspectiveCamera, e: Extent): boolean {
  const p = pScratch;
  const m = 0.02;
  for (const other of others) {
    if (sameLandmark(target, other)) continue;
    const b = other.vis;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let ahead = 0;
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      p.applyMatrix4(probe.matrixWorldInverse);
      if (p.z > -probe.near) continue;
      ahead++;
      p.applyMatrix4(probe.projectionMatrix);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (!ahead) continue;
    if (maxX < -1 || minX > 1 || maxY < -1 || minY > 1) continue;
    if (minX <= e.maxX + m && maxX >= e.minX - m && minY <= e.maxY + m && maxY >= e.minY - m) return true;
  }
  return false;
}

const rayScratch = new THREE.Vector3();
const nearTreeScratch: number[] = [];

/** Does the ray (origin o, unit direction r) pass through any of the listed tree cylinders before `reach`? */
function rayHitsTree(o: THREE.Vector3, r: THREE.Vector3, reach: number, trees: Float32Array, list: number[]): boolean {
  const hh = r.x * r.x + r.z * r.z;
  if (hh < 1e-9) return false;
  for (const i of list) {
    // Closest approach of the ray's ground track to the trunk axis.
    const t = ((trees[i] - o.x) * r.x + (trees[i + 1] - o.z) * r.z) / hh;
    if (t <= 0 || t >= reach) continue;
    const dx = o.x + r.x * t - trees[i];
    const dz = o.z + r.z * t - trees[i + 1];
    const rad = trees[i + 4];
    if (dx * dx + dz * dz > rad * rad) continue;
    const y = o.y + r.y * t;
    if (y >= trees[i + 2] && y <= trees[i + 3]) return true;
  }
  return false;
}
/**
 * Share of sight lines through the lower third of the free frame that a
 * raised foreground cuts short. Each ray is followed to where it would meet
 * the landmark's base level (ground falling away toward the landmark reaches
 * most of the way there); a ray the ground or water stops before
 * PARK_LOW_REACH of that distance hit a bank, a rim or a hill standing up in
 * front. The first version counted any ground higher than the landmark's
 * base, which failed every pose on the jetty: the pond sits in a basin, so
 * its banks are always higher than the water. `probe` is at the pose.
 */
function lowerThirdBlocked(
  lm: Landmark,
  probe: THREE.PerspectiveCamera,
  surface: SurfaceFn,
  left: number,
  trees?: Float32Array,
): number {
  const o = probe.position;
  const baseY = lm.vis.min.y;
  if (o.y <= baseY) return 0;
  // Trees near enough to matter: within the farthest reach of any ray here.
  const near = nearTreeScratch;
  near.length = 0;
  if (trees) {
    const maxReach = (PARK_LOW_REACH * (o.y - baseY)) / Math.sin(THREE.MathUtils.degToRad(PARK_PITCHES[0] - 2));
    for (let i = 0; i < trees.length; i += 5) {
      const dx = trees[i] - o.x;
      const dz = trees[i + 1] - o.z;
      if (dx * dx + dz * dz < (maxReach + trees[i + 4]) ** 2) near.push(i);
    }
  }
  const x0 = Math.max(-0.95, left + 0.05);
  const COLS = 5;
  let blocked = 0;
  let total = 0;
  for (const ny of [-0.9, -0.62, -0.36]) {
    for (let c = 0; c < COLS; c++) {
      const nx = x0 + ((0.95 - x0) * (c + 0.5)) / COLS;
      const r = rayScratch.set(nx, ny, 0.5).unproject(probe).sub(o).normalize();
      if (r.y >= -1e-3) continue;
      total++;
      const tPlane = (o.y - baseY) / -r.y;
      const reach = PARK_LOW_REACH * tPlane;
      if (near.length && rayHitsTree(o, r, reach, trees!, near)) {
        blocked++;
        continue;
      }
      const steps = Math.max(8, Math.min(120, Math.ceil(reach / 4)));
      for (let k = 1; k <= steps; k++) {
        const t = (reach * k) / steps;
        if (o.y + r.y * t <= surface(o.x + r.x * t, o.z + r.z * t)) {
          blocked++;
          break;
        }
      }
    }
  }
  return total ? blocked / total : 0;
}

/**
 * How much of the picture ANOTHER landmark covers while standing nearer
 * than the one being framed: projected box area (NDC units) inside the part
 * of the frame the panel does not cover. 0 = a clean view. The viaduct's
 * first framing parked behind area 3's bridge, whose deck then ran across
 * the bottom of the picture. `probe` is at the candidate pose.
 */
function foregroundIntrusion(target: Landmark, others: Iterable<Landmark>, probe: THREE.PerspectiveCamera, left: number): number {
  const p = pScratch;
  const targetDist = probe.position.distanceTo(target.center);
  let area = 0;
  for (const other of others) {
    if (sameLandmark(target, other)) continue;
    if (probe.position.distanceTo(other.center) >= targetDist) continue;
    const b = other.vis;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let ahead = 0;
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      p.applyMatrix4(probe.matrixWorldInverse);
      if (p.z > -probe.near) continue;
      ahead++;
      p.applyMatrix4(probe.projectionMatrix);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (!ahead) continue;
    const w = Math.min(maxX, 1) - Math.max(minX, left);
    const h = Math.min(maxY, 1) - Math.max(minY, -1);
    if (w > 0 && h > 0) area += w * h;
  }
  return area;
}

type Mode = "rail" | "flight" | "parked";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The flight from p0 (moving at v0) to p1, at s = elapsed / duration in 0..1.
 *
 *   p(s) = p1 + (p0 - p1) a(s) + v0 duration b(s)
 *   a(s) = (1 - s)^N (1 + N s)    1 -> 0, a'(0) = 0
 *   b(s) = s (1 - s)^N            0 -> 0, b'(0) = 1
 *
 * So it starts exactly where the camera is at the velocity it already had (no
 * snap), does most of the move early (see FLIGHT_N), and arrives with zero
 * velocity and zero acceleration.
 */
function flightPoint(
  out: THREE.Vector3,
  p0: THREE.Vector3,
  v0: THREE.Vector3,
  p1: THREE.Vector3,
  s: number,
  duration: number,
): THREE.Vector3 {
  const q = 1 - s;
  const qn = Math.pow(q, FLIGHT_N);
  const a = qn * (1 + FLIGHT_N * s);
  const b = s * qn * duration;
  out.x = p1.x + (p0.x - p1.x) * a + v0.x * b;
  out.y = p1.y + (p0.y - p1.y) * a + v0.y * b;
  out.z = p1.z + (p0.z - p1.z) * a + v0.z * b;
  return out;
}

/** Progress along the flight curve: 1 - a(s). The panel rides this, so it moves with the camera. */
function flightEase(s: number): number {
  return 1 - Math.pow(1 - s, FLIGHT_N) * (1 + FLIGHT_N * s);
}

/** Hermite smoothstep on 0..1 (clamped). */
function smoothstep01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/** Polynomial smooth max, so a ground clamp never kinks the camera path. */
function smoothMax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
}

/** Give the browser a turn (input, paint) between slices of load work. Not throttled like setTimeout in a hidden tab. */
/** Cheap laptops: the 3D keeps drawing under the posters' crossfade this long, ms (world.module.css .poster transition). */
const POSTER_FADE_MS = 900;
/** The rest check (restCheckTick): no input and a still camera this long before a burst, and between climbs, ms. */
const REST_CHECK_IDLE_MS = 4000;
/** After a check that found no clear headroom (and was not hopeless), wait this long, ms. */
const REST_CHECK_RETRY_MS = 30000;
/** Rest checks per session (one per tier, plus two that find no headroom). */
const REST_CHECK_MAX = 5;
/**
 * Adapt3: a rest check whose warm frame alone is over this stops there and
 * disarms. A climb needs about 6 ms at the current tier (headroomCheck's 12 ms
 * over 1.8 and 1.15); a single synced frame reads up to 3 times high on the M2
 * at light load, so 18 ms is clearly no headroom.
 */
const REST_CHECK_STOP_MS = 18;
/** Adapt3: the longest the governor's poster ask waits at rest for the GPU's queued frames before it is measured anyway, ms. */
const POSTER_ASK_DRAIN_MS = 600;

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

/** Ground height, or the water surface where the sea, the lake or the pool covers it. */
function surfaceHeight(x: number, z: number): number {
  let h = terrainHeight(x, z);
  const lk = WORLD.lake;
  const dxl = x - lk.x;
  const dzl = z - lk.z;
  if (dxl * dxl + dzl * dzl < lk.r * lk.r && h < lk.y) h = lk.y;
  const pl = WORLD.pool;
  const dxp = x - pl.x;
  const dzp = z - pl.z;
  if (dxp * dxp + dzp * dzp < pl.r * pl.r && h < pl.y) h = pl.y;
  return h < WORLD.seaLevel ? WORLD.seaLevel : h;
}

/**
 * What the rail keeps clear of: the ground and water, and each floating
 * island's top as a soft dome reaching ISLAND_KEEP_OUT past its rim. Rendered,
 * the rise passed the Sky Island's rim 35 below its top and 22 outside it,
 * and the island's side filled the frame.
 */
const ISLAND_KEEP_OUT = 200;
/** Allowance for the bumps blocks.ts puts on the island's top. */
const ISLAND_TOP_BUMPS = 25;
/** The floating isles, for the rail's keep-out and the park's surface. */
const FLOATING_ISLES = [WORLD.island, WORLD.bountyIsle, WORLD.gateIsle] as const;
export function railGround(x: number, z: number): number {
  let h = surfaceHeight(x, z);
  for (const isl of FLOATING_ISLES) {
    const d = Math.hypot(x - isl.x, z - isl.z);
    if (d >= isl.r + ISLAND_KEEP_OUT) continue;
    let u = (isl.r + ISLAND_KEEP_OUT - d) / ISLAND_KEEP_OUT;
    u = u >= 1 ? 1 : u * u * (3 - 2 * u);
    // Below the rim the dome falls 400, well under any camera that is not near it.
    const top = isl.y + ISLAND_TOP_BUMPS - (1 - u) * 400;
    if (top > h) h = top;
  }
  return h;
}

/**
 * What the park stands on: the ground and water, or a floating isle's top
 * inside its rim. The park's clearance, its sight lines and its lower-third
 * test then treat the Sky Island and the Harbour Isle as the ground they are,
 * not the terrain far below them. The top itself, without the rail's bump
 * allowance: with it, the Guild Hall's base sat 25 under "the ground", half of
 * it counted hidden, and the park backed off to 357 (its rail stop is at 322).
 */
function parkSurface(x: number, z: number): number {
  let h = surfaceHeight(x, z);
  for (const isl of FLOATING_ISLES) {
    const dx = x - isl.x;
    const dz = z - isl.z;
    if (dx * dx + dz * dz < isl.r * isl.r && isl.y > h) h = isl.y;
  }
  return h;
}

/** Is the object drawn (itself and every ancestor visible)? */
function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/**
 * Final pass F: is `o` (or anything between it and its landmark `lm`) switched
 * by progress (userData.wake, progress-world.ts)? Those meshes show or hide
 * with the student's progress, so a landmark's box, samples and pin leave
 * them out: the a8 pin sat on the keystone's sun when the page loaded with
 * Job Board done (Gate_LanternGlass shown) and on the arch's top edge
 * otherwise. Now it sits in the same place in every state.
 */
function wakeTagged(o: THREE.Object3D, lm: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p && p !== lm; p = p.parent) if (p.userData.wake) return true;
  return false;
}

interface InstalledModule {
  name: string;
  module: WorldModule;
  /** update() or isAnimating() threw once; not called again. */
  broken: boolean;
}

/**
 * A landmark cut to the part the park frames: its lowest PARK_FOCUS_MAX_H.
 * The same object when it is already short enough.
 */
function focusOf(lm: Landmark): Landmark {
  const h = lm.vis.max.y - lm.vis.min.y;
  if (h <= PARK_FOCUS_MAX_H) return lm;
  const top = lm.vis.min.y + PARK_FOCUS_MAX_H;
  const vis = lm.vis.clone();
  vis.max.y = top;
  const kept: number[] = [];
  for (let i = 0; i < lm.samples.length; i += 3) {
    if (lm.samples[i + 1] <= top) kept.push(lm.samples[i], lm.samples[i + 1], lm.samples[i + 2]);
  }
  const box = lm.box.clone();
  box.max.y = Math.min(box.max.y, top);
  const center = box.getCenter(new THREE.Vector3());
  return {
    box,
    center,
    top: new THREE.Vector3(center.x, top, center.z),
    vis,
    visCenter: vis.getCenter(new THREE.Vector3()),
    samples: kept.length ? new Float32Array(kept) : lm.samples,
    bodyTop: Math.min(lm.bodyTop, top),
  };
}

export class WorldScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  /** Everything the world adds (terrain, stand-ins, modules' objects). */
  private worldRoot: THREE.Group | null = null;
  private fog: THREE.Fog | null = null;

  private readonly rail: Rail;
  private readonly moduleSpecs: ReadonlyArray<ModuleSpec>;
  private readonly wantFallbacks: boolean;
  private ctx: WorldCtx | null = null;

  // Modules
  private readonly modules: InstalledModule[] = [];
  private readonly moduleReport: Record<string, number | string> = {};
  private readonly standIns: string[] = [];
  private sceneTime = 0;
  private animTimer: ReturnType<typeof setTimeout> | null = null;
  private loading: Promise<void> | null = null;

  // Loop state
  private raf = 0;
  /**
   * Adapt2: true while tick() runs. tick clears `raf` on entry, so a wake()
   * from inside it (applyQuality on a governor step or a rest check climb,
   * enterPoster, a park from the frame callback) used to start a second
   * requestAnimationFrame chain next to the one tick schedules at its end.
   * Every governor step added a chain: after three steps the scene ticked and
   * rendered four times per display frame, and a slow GPU's queue grew from 3
   * frames to 15 (world-tests/v6-backlog.mjs). Inside a tick, wake() only marks
   * the frame dirty; tick's own end schedules the next one.
   */
  private inTick = false;
  private started = false;
  private lastTime = 0;
  /** The governor on travel: the depth the last frame drew (NaN before the first). */
  private govLastDepth = NaN;
  private ready = false;
  private disposed = false;
  private paused = false;
  private contextLost = false;
  private dirty = true;
  private reducedMotion = false;
  // v6 quality and idle (quality.ts, perf.ts; world_art_bible_v6.md 3.1, 3.2)
  private quality: QualityTier = tierSpec(0);
  /** The tier forced from the tuning panel, or null for automatic. */
  private tierOverride: number | null = null;
  private governor: Governor | null = null;
  private readonly idle = new IdleLadder(typeof performance !== "undefined" ? performance.now() : 0);
  private readonly qualityCbs = new Set<(t: QualityTier) => void>();
  private readonly qualityReport: Record<string, unknown> = {};
  // Cheap laptops: poster mode (poster.ts) and the slow GPU simulator.
  private posterPref: PosterPreference = "auto";
  /** Why the posters replace the 3D, or null while the 3D draws. */
  private posterReason: string | null = null;
  /** When the posters went on: the 3D keeps drawing under their crossfade for POSTER_FADE_MS. */
  private posterSince = -1e9;
  /** Why, as a kind (poster.ts PosterKind): the notice and "Try 3D anyway" follow it. */
  private posterKind: PosterKind | null = null;
  /** No renderer at all (no WebGL, a software renderer, or ?poster=on): the posters are the map. */
  private headless = false;
  /** When the page last became visible (Infinity while hidden): a measurement only counts when the page was visible all through it. */
  private visibleSince = 0;
  /** Dev: the cold stall for the load probe (WorldSceneOptions.coldStall). */
  private coldStall: { ms: number; frames: number } | null = null;
  /**
   * The rest check (quality.headroomCheck): while armed, a short burst at rest
   * may climb one tier. Off after the governor steps down, after a hopeless
   * check, or after `left` checks.
   */
  private restCheck = { armed: false, left: 0, nextAt: 0, climbs: 0, log: [] as Array<Record<string, unknown>> };
  private readonly posterCbs = new Set<(reason: string | null) => void>();
  private gpuLoad: GpuLoad | null = null;
  private slowGpuFactor = 1;
  /** Cheap laptops (adapt2): fences, so the loop never queues more than 2 frames on a slow GPU (perf.FramePacer). */
  private pacer: FramePacer | null = null;
  /**
   * The student pressed "Try 3D anyway" (this visit, or ?poster=try on the
   * reload): nothing puts the posters back by itself; the governor's measured
   * last step offers them instead (posterOffer).
   */
  private tryingLive = false;
  /** Why the posters are offered (not forced), or null. */
  private posterOfferReason: string | null = null;
  /** Adapt3: this visit's load measurement of the opening at tier 3 (the median near the line), ms, or null when the load did not measure it. */
  private loadTier3Ms: number | null = null;
  /**
   * Adapt3: the governor's poster ask, held at rest until the GPU has
   * finished the frames already queued (perf.FramePacer), so the measurement
   * never blocks the page on them (two queued 45 ms frames were 90 ms more).
   */
  private posterAsk: { reason: string; at: number } | null = null;
  private readonly offerCbs = new Set<(reason: string | null) => void>();
  /** Any input: the idle ladder restarts; when it was asleep, one ambient frame restarts the loop. */
  private readonly onInput = () => {
    const now = performance.now();
    const asleep = this.idle.phase(now) === "asleep";
    this.idle.poke(now);
    if (asleep) this.scheduleAnimFrame();
  };

  // Depth (scroll share of the whole budget) and route distance
  private targetDepth = 0;
  private currentDepth = 0;
  private currentS = 0;
  private maxScroll = 0;
  /** CSS px per vh (innerHeight / 100), cached on resize. */
  private vhPx = 1;

  // Lock
  private readonly lockState: LockState = { mode: "open", frontier: 0 };
  private progress = 0;
  /** Per-lesson progress (progress.ts), passed to modules with setWorldProgress. */
  private worldProgress: WorldProgress = NO_PROGRESS;
  /** The discount checkpoint's look (checkpoint.ts), passed to modules with setCheckpoint. */
  private checkpointLook: CheckpointLook = "closed";
  private depthMax = 1;
  private spacerEl: HTMLElement | null = null;

  // Size, cached so nothing in the frame loop reads layout.
  private width = 1;
  private height = 1;

  // Camera pose actually applied last frame
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly prevPos = new THREE.Vector3();
  private readonly prevLook = new THREE.Vector3();
  private readonly velPos = new THREE.Vector3();
  private readonly velLook = new THREE.Vector3();
  private hasPose = false;

  // Park / flight
  private mode: Mode = "rail";
  private parkedId: string | null = null;
  /** Dev harness (debugPose): a pose that replaces the rail's while set. */
  private poseOverride: { x: number; y: number; z: number; bearing: number; pitch: number; fov?: number } | null = null;
  /** The current park is the telescope's (TEL_PARK_PLACE): its own path and lens. */
  private parkTelescope = false;
  /** The flight in progress runs the telescope's path (forward, or back to the rail). */
  private flightTelescope = false;
  private telCurve: THREE.CatmullRomCurve3 | null = null;
  private readonly telDir0 = new THREE.Vector3();
  private readonly telAxis = new THREE.Vector3();
  private readonly telUp = new THREE.Vector3();
  private readonly telDip = new THREE.Vector3();
  private readonly telEndDir = new THREE.Vector3();
  private parkProgress = 0;
  private flightElapsed = 0;
  private flightDuration = FLIGHT_T_MIN;
  private flightToRail = false;
  private flightArc = 0;
  /** The lens when parked: FOV, or a hand placed view's own (layout PARK_VIEWS fov). */
  private parkFov = FOV;
  private progFrom = 0;
  private progTo = 0;
  private switchDip = false;
  private flightNow = 1;
  private readonly fromPos = new THREE.Vector3();
  private readonly fromLook = new THREE.Vector3();
  private readonly v0Pos = new THREE.Vector3();
  private readonly v0Look = new THREE.Vector3();
  private readonly parkPos = new THREE.Vector3();
  private readonly parkLook = new THREE.Vector3();
  private parkDistance = 0;
  private parkPending = false;
  private lastPark: ParkResult | null = null;
  private flightFromDepth = 0;
  private flightToDepth = 0;
  /** The rail depth the camera's pose belongs to (rail, parked, or mid-flight). */
  private poseDepth = 0;
  /** The depth of the anchor the camera is parked at. */
  private parkDepth = 0;

  // Anchors, landmarks, markers
  private anchors: AreaAnchor[] = [];
  /** Each anchor's index into layout.PLACES, or -1. */
  private anchorPlace: number[] = [];
  private readonly anchorPos: THREE.Vector3[] = [];
  private readonly anchorLm: Array<Landmark | null> = [];
  /** Final pass: the anchor pins to the landmark's body (ANCHOR_ON_BODY), not its box's top. */
  private readonly anchorBody: boolean[] = [];
  private readonly landmarks = new Map<string, Landmark>();
  private readonly markers: ProjectedMarker[] = [];
  private readonly frame: WorldFrame;
  private readonly lmRects = new Float32Array(64 * 5);
  private readonly lmList: Landmark[] = [];
  /** Round 1 UI: each LM_* object's shown meshes, for pickAnchor(). */
  private readonly lmMeshes = new Map<string, THREE.Mesh[]>();
  private readonly pickRay = new THREE.Raycaster();
  private readonly pickNdc = new THREE.Vector2();
  private readonly pickHits: THREE.Intersection[] = [];
  private readonly markerMat = new THREE.Matrix4();
  /** Round 1 UI: the hovered anchor and its lift meshes (setHoverAnchor). */
  private hoverId: string | null = null;
  private readonly hoverLift: THREE.Mesh[] = [];
  private readonly liftCache = new Map<THREE.Mesh, THREE.Mesh>();
  private readonly liftMats = new Map<THREE.Side, THREE.MeshBasicMaterial>();
  private liftWarm = false;
  private readonly occluders: THREE.Box3[] = [];
  private trees: Float32Array | undefined;
  /** The grey ship, only when the fallbacks are on. */
  private shipStandIn: THREE.Group | null = null;
  private readonly shipScratch: ShipPose = { x: 0, y: 0, z: 0, heading: 0, bank: 0, throttle: 0, phase: "moored" };

  private scrollArmed = false;
  private lastMaxScroll = -1;
  private frameCb: ((f: WorldFrame) => void) | null = null;

  // Scratch, allocated once
  private readonly railPose: RailPose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly fogRange = { near: 0, far: 0 };

  // Observers and listeners
  private resizeObserver: ResizeObserver | null = null;
  private bodyObserver: ResizeObserver | null = null;
  private motionQuery: MediaQueryList | null = null;
  private readonly onResize = () => this.resize();
  private readonly onScroll = () => {
    this.idle.poke(performance.now());
    this.wake();
  };
  private readonly onVisibility = () => {
    if (document.hidden) this.visibleSince = Infinity;
    else {
      this.visibleSince = performance.now();
      this.wake();
    }
  };
  private readonly onMotionChange = () => {
    this.reducedMotion = !!this.motionQuery?.matches;
  };
  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
  };
  private readonly onContextRestored = () => {
    this.contextLost = false;
    this.pacer?.clear();
    this.wake();
  };

  constructor(container: HTMLElement, opts: WorldSceneOptions = {}) {
    this.container = container;
    this.posterPref = opts.poster ?? "auto";
    this.tryingLive = this.posterPref === "try";
    this.slowGpuFactor = Math.max(1, opts.slowGpu ?? 1);
    if (process.env.NODE_ENV !== "production" && opts.coldStall && opts.coldStall.ms > 0) {
      this.coldStall = { ms: Math.min(2000, opts.coldStall.ms), frames: Math.max(1, Math.min(8, Math.round(opts.coldStall.frames || 1))) };
    }
    this.visibleSince = typeof document !== "undefined" && document.hidden ? Infinity : 0;
    this.rail = createRail();
    if (opts.pacing) this.rail.setPacing(opts.pacing);
    this.moduleSpecs = opts.modules ?? DEFAULT_MODULES;
    this.wantFallbacks = opts.fallbacks ?? this.moduleSpecs.length === 0;
    if (opts.lock) {
      this.lockState.mode = opts.lock.mode;
      this.lockState.frontier = Math.min(7, Math.max(0, Math.round(opts.lock.frontier)));
    }
    this.depthMax = this.lockDepth();
    this.frame = {
      depth: 0,
      railU: 0,
      place: 0,
      parkedId: null,
      parkProgress: 0,
      flight: 1,
      markers: this.markers,
      lock: this.lockState,
      maxDepth: this.depthMax,
      triangles: 0,
      calls: 0,
      tail: 0,
    };
    this.init();
    // Anchors default to the eight layout places, so the scene runs on its own.
    this.setAnchors(PLACES.map((p, i) => ({ id: p.id, depth: this.rail.stopDepth(i), landmark: p.mesh })));
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      (window as unknown as { __worldV6Debug?: WorldScene }).__worldV6Debug = this;
    }
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  private init() {
    // v6: the tier before the renderer exists (world_art_bible_v6.md 3.2 "Pick").
    // MSAA follows the GPU guess only, so no later tier change needs a new canvas.
    const gpuName = readGpuName();
    const mp = screenMegapixels();
    const pick = pickTier(gpuName, mp);
    const recalled = recallTier();
    const startTier = recalled ?? pick.tier;
    this.quality = tierSpec(startTier, mp > 5 ? 1 : 0);
    const ro = rendererOptionsForTier(pick.spec);
    Object.assign(this.qualityReport, { gpu: gpuName, megapixels: +mp.toFixed(2), pick: pick.tier, pickReason: pick.reason, recalled, start: startTier, msaa: ro.antialias, software: pick.software });
    // Cheap laptops: no renderer at all when the posters are the map anyway
    // (a software renderer, ?poster=on, or a verdict a previous visit
    // remembered), so a Celeron does not spend seconds building a world it
    // cannot draw. Without WebGL the renderer throws and the same path runs.
    // A remembered verdict holds 7 days (POSTER_RULES.verdictTtlMs); after
    // that it is dropped and this visit loads and probes like a first one.
    const recall = this.posterPref === "auto" ? recallPosterVerdict() : { verdict: null, expired: null };
    const remembered = recall.verdict;
    if (recall.expired) this.qualityReport.posterExpired = recall.expired;
    let headless: string | null = null;
    let kind: PosterKind | null = null;
    if (this.posterPref === "on") {
      headless = "forced (?poster=on)";
      kind = "forced";
    } else if ((this.posterPref === "auto" || this.posterPref === "try") && pick.software) {
      headless = `software renderer (${gpuName})`;
      kind = "software";
    } else if (remembered) {
      headless = `remembered from a previous visit (${new Date(remembered.at).toISOString().slice(0, 10)}): ${remembered.reason}`;
      kind = remembered.kind;
    }
    let renderer: THREE.WebGLRenderer | null = null;
    if (!headless && !gpuName && !webglAvailable()) {
      headless = "no WebGL (this browser has it off or cannot make a context)";
      kind = "nowebgl";
    }
    if (!headless) {
      try {
        renderer = new THREE.WebGLRenderer({ antialias: ro.antialias, powerPreference: ro.powerPreference });
      } catch (e) {
        headless = `no WebGL (${e instanceof Error ? e.message : String(e)})`;
        kind = "nowebgl";
        renderer = null;
      }
    }
    if (renderer) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.style.display = "block";
      renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
      renderer.domElement.addEventListener("webglcontextrestored", this.onContextRestored);
      this.container.appendChild(renderer.domElement);
      this.renderer = renderer;
      this.pacer = new FramePacer(renderer.getContext());
    } else {
      this.headless = true;
      this.posterReason = headless;
      this.posterKind = kind ?? "nowebgl";
      this.qualityReport.poster = headless;
      this.qualityReport.posterKind = this.posterKind;
    }

    const scene = new THREE.Scene();
    this.fog = new THREE.Fog(GREY_HAZE.clone(), FOG_DEFAULT_NEAR, FOG_DEFAULT_FAR);
    scene.fog = this.fog;
    scene.background = GREY_HAZE.clone();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(FOV, 1, NEAR, FAR);

    this.motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    this.reducedMotion = !!this.motionQuery?.matches;
    this.motionQuery?.addEventListener?.("change", this.onMotionChange);

    window.addEventListener("resize", this.onResize, { passive: true });
    window.addEventListener("scroll", this.onScroll, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    for (const ev of ["pointermove", "pointerdown", "wheel", "keydown", "touchstart"] as const) {
      window.addEventListener(ev, this.onInput, { passive: true });
    }
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.container);
      this.bodyObserver = new ResizeObserver(() => {
        this.cacheScroll();
        this.holdDepthAcrossRescale();
        this.wake();
      });
      this.bodyObserver.observe(document.body);
    }
    this.resize();

    this.targetDepth = this.readScrollDepth(this.targetDepth);
    this.currentDepth = this.targetDepth;
    this.currentS = this.rail.sOfDepth(this.currentDepth);
    this.placeOnRail(this.currentDepth);
    this.lastMaxScroll = this.maxScroll;
    this.scrollArmed = true;
  }

  private cacheScroll() {
    const doc = document.documentElement;
    const h = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
    this.maxScroll = Math.max(0, h - window.innerHeight);
    this.vhPx = Math.max(1e-3, window.innerHeight / 100);
  }

  /** Page scroll (px) for a depth, under the current budgets. */
  private yForDepth(depth: number): number {
    return Math.min(this.maxScroll, Math.max(0, depth) * this.rail.totalVh() * this.vhPx);
  }

  private resize() {
    const renderer = this.renderer;
    const camera = this.camera;
    if (!camera) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || window.innerWidth));
    const h = Math.max(1, Math.round(rect.height || window.innerHeight));
    this.width = w;
    this.height = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer?.setSize(w, h);
    this.cacheScroll();
    this.holdDepthAcrossRescale();
    if (this.parkedId && this.ready) {
      this.computeParkPose(this.parkedId);
      if (this.mode === "parked") {
        this.camPos.copy(this.parkPos);
        this.camLook.copy(this.parkLook);
      } else if (this.mode === "flight" && !this.flightToRail) {
        this.startFlight(false);
      }
    }
    this.wake();
  }

  /**
   * After the page's height changes the same scrollY is a different depth.
   * On the rail, the scroll is put back on the depth the camera is at.
   */
  private holdDepthAcrossRescale() {
    const prev = this.lastMaxScroll;
    this.lastMaxScroll = this.maxScroll;
    if (!this.scrollArmed || prev < 0 || Math.abs(prev - this.maxScroll) < 0.5) return;
    if (this.parkedId !== null || this.mode !== "rail" || this.maxScroll <= 0) return;
    const y = Math.round(this.yForDepth(this.targetDepth));
    if (Math.abs(window.scrollY - y) >= 1) window.scrollTo({ top: y, left: 0, behavior: "instant" });
  }

  // ── Building the world ─────────────────────────────────────────────────────

  /** Build the grey world and install the modules. V4 has no asset to fetch; safe to call twice. */
  load(): Promise<void> {
    if (!this.loading) this.loading = this.build();
    return this.loading;
  }

  private async build() {
    const scene = this.scene;
    if (!scene) return;
    const root = new THREE.Group();
    root.name = "World";
    scene.add(root);
    this.worldRoot = root;
    this.rail.setGround(railGround);
    this.currentS = this.rail.sOfDepth(this.currentDepth);
    if (this.headless) {
      // Poster mode with no renderer: the camera, the rail, the markers' anchors
      // and the parks still run (the page's interface needs them); nothing is built.
      this.ready = true;
      this.resolveAnchors();
      if (this.parkedId) {
        this.parkPending = false;
        this.beginPark(this.parkedId);
      }
      this.placeOnRail(this.currentDepth);
      this.qualityReport.readyMs = Math.round(performance.now());
      this.dirty = true;
      this.wake();
      return;
    }
    this.addTerrain(root);

    await yieldToBrowser();
    if (this.disposed || !this.scene) return;
    await this.installModules(root);
    if (this.disposed || !this.scene) return;

    this.addStandIns(root);
    // The page may have set these before the modules existed.
    this.setProgress(this.progress);
    this.forwardWorldProgress();
    this.forwardMist();
    this.forwardCheckpoint();
    scene.updateMatrixWorld(true);
    this.indexLandmarks(scene);
    this.indexTrees(scene);
    // v6: compile every program and upload every buffer behind the loading
    // screen, then confirm the tier (world_art_bible_v6.md 3.1 "Load", 3.2 "Confirm").
    await this.warmUpAndProbe();
    if (this.disposed || !this.scene) return;

    this.ready = true;
    this.qualityReport.readyMs = Math.round(performance.now());
    this.resolveAnchors();
    if (this.parkedId) {
      this.parkPending = false;
      this.beginPark(this.parkedId);
    }
    this.placeOnRail(this.currentDepth);
    this.dirty = true;
    this.wake();
  }

  /** One frame's preparation without the render: the camera posed, modules updated, the fog set. */
  private prepareFrame() {
    this.updateCamera(0);
    this.updateModules(0);
    this.updateFog();
  }

  /**
   * v6 load: warm compile (perf.warmCompile, with the lake's reflection target),
   * then a short burst at the camera's pose (the opening on a fresh load) and
   * one tier step from it (quality.refineTier). A remembered tier 0 skips the
   * probe (the governor corrects it while scrolling); a remembered lower tier
   * is probed again, and climbs one step when the probe shows clear headroom
   * (quality.headroomCheck), so one slow visit does not hold a laptop low.
   *
   * Cheap laptops (poster.ts POSTER_RULES):
   *   - the compile wait gives up at 15 s, not 4; if programs are still
   *     compiling then, the posters take over (the 3D keeps loading behind);
   *   - the probe takes about 0.4 s at most; its first synced frame is a cold
   *     warm up that decides nothing, and a warm frame over 50 ms ends it
   *     (tier 3 at once);
   *   - when the probe lands on tier 3, or predicts the route's worst over
   *     28 ms (ladderDirectMs), tier 2 is measured first when the opening
   *     could hold it (at its cap, then 0.85; kept at TIER2_HOLD_MS or less),
   *     else the opening is measured at tier 3: over 28 ms, posters (adapt3);
   *   - a measurement within 10% of its line is taken twice more and the
   *     median decides (adapt3);
   *   - nothing is remembered (tier or posters) when programs were still
   *     compiling, compiled inside the probe, or spilled into its cold frame,
   *     or when the page was hidden during the measurement.
   * Afterwards the rest check (restCheckTick) may climb a low tier while the
   * student rests.
   */
  private async warmUpAndProbe() {
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.camera;
    if (!renderer || !scene || !camera) return;
    this.prepareFrame();
    const mirror = scene.getObjectByName("MirrorLake") as (THREE.Object3D & { getRenderTarget?: () => THREE.WebGLRenderTarget }) | undefined;
    if ((this.slowGpuFactor > 1 || this.coldStall) && !this.gpuLoad) {
      // Dev: the simulator's quad compiles with everything else.
      this.gpuLoad = createGpuLoad();
      scene.add(this.gpuLoad.mesh);
    }
    let pending = 0;
    const t0 = performance.now();
    try {
      const warm = await warmCompile(renderer, scene, camera, [mirror?.getRenderTarget?.()], { maxMs: POSTER_RULES.compileGiveUpMs });
      this.qualityReport.warm = warm;
      pending = warm.pending;
    } catch (e) {
      this.qualityReport.warm = `warmCompile threw: ${e instanceof Error ? e.message : String(e)}`;
      console.error("[world-v6] warm compile threw", e);
    }
    if (this.disposed) return;
    if (pending > 0 && this.posterPref === "auto") {
      this.enterPoster(`shaders still compiling after ${((performance.now() - t0) / 1000).toFixed(1)} s (${pending} left)`, "compile", false, true);
    }
    if (this.slowGpuFactor > 1) this.calibrateSlowGpu(this.slowGpuFactor);
    else if (this.gpuLoad) {
      this.gpuLoad.setIters(0);
      this.gpuLoad.mesh.visible = false;
    }
    if (this.coldStall) this.armColdStall(this.coldStall);
    // Why a measurement now may not be this machine's own: then it is applied
    // for this visit and not remembered.
    const untrusted: string[] = [];
    if (pending > 0) untrusted.push("programs were still compiling");
    const programs = () => renderer.info.programs?.length ?? 0;
    const inspect = (p: BurstResult, progs0: number, tag: string) => {
      const grew = programs() - progs0;
      if (grew > 0) untrusted.push(`${grew} programs compiled inside the ${tag}`);
      if (p.cold - p.first > POSTER_RULES.compileSpillMs) untrusted.push(`the ${tag}'s cold frame took ${p.cold.toFixed(0)} ms against ${p.first.toFixed(0)} warm (compile or upload)`);
    };
    const trusted = () => untrusted.length === 0 && this.visibleThrough(t0);
    const prSteps = screenMegapixels() > 5 ? 1 : 0;
    const dpr = window.devicePixelRatio || 1;
    const recalled = this.qualityReport.recalled as number | null;
    /** The rest check's start: a clean burst at the tier the load ends on (ms), "unknown", or null (the tier above was measured and failed). */
    let restHint: number | "unknown" | null = "unknown";
    if (this.tierOverride === null && (recalled === null || recalled > 0)) {
      this.prepareFrame();
      let progs0 = programs();
      const prProbe = renderer.getPixelRatio();
      const probe = burstProbe(renderer, scene, camera, { maxMs: 400, stopOverMs: POSTER_RULES.probeFirstFrameMs });
      inspect(probe, progs0, "probe");
      const t = this.quality.tier;
      let refine: { tier: number; predictedMs: number; changed: boolean; reason: string };
      if (probe.capped) {
        refine = {
          tier: 3,
          predictedMs: probe.ms * WORST_TO_OPENING_RATIO,
          changed: t !== 3,
          reason: `warm frame ${probe.first.toFixed(0)} ms (cold ${probe.cold.toFixed(0)}) > ${POSTER_RULES.probeFirstFrameMs}: tier 3`,
        };
      } else {
        refine = refineTier(t, probe.ms);
        if (recalled !== null && refine.tier <= t) {
          // A remembered tier: the same step down as a first visit, or one up with clear headroom.
          const h = headroomCheck(t, probe.ms, renderer.getPixelRatio(), dpr, prSteps);
          this.qualityReport.recheck = h;
          if (h.climb) refine = { tier: h.tier, predictedMs: refine.predictedMs, changed: true, reason: "remembered tier re-checked: " + h.reason };
        }
      }
      Object.assign(this.qualityReport, { probe, refine });
      if (refine.changed) this.applyQuality(refine.tier, "load probe: " + refine.reason);
      restHint = !refine.changed ? probe.ms : refine.tier < t ? "unknown" : null;
      // Cheap laptops (adapt2): a step down that predicts the route's worst
      // over ladderDirectMs cannot be fixed by one tier (the next still misses
      // 16.7 ms), so tier 3 is measured now and decides, as for a probe over
      // 50 ms. Before, 25 to 28 ms openings stepped to tier 1 and the governor
      // walked the rest, and could end on the posters, while a slower machine
      // measured tier 3 here and kept the 3D. Every outcome now comes from a
      // measurement at load, so a slower GPU never lands on a better one.
      const direct = refine.tier > t && refine.predictedMs > POSTER_RULES.ladderDirectMs;
      // ?poster=off (a dev measurement of the 3D, v6-bench's SwiftShader row) keeps the old one-step path.
      if (!this.posterReason && (this.posterPref === "auto" || this.posterPref === "try") && (this.quality.tier === 3 || refine.predictedMs > 50 || direct)) {
        /**
         * Adapt3: the opening at `tier` and pixel ratio `pr`, measured; within
         * NEAR_LINE_SHARE of `line` it is measured up to twice more and the
         * median decides (one burst near the poster line decided alone before).
         */
        const measure = (tier: 2 | 3, pr: number, line: number, stopOverMs: number, tag: string) => {
          this.applyQuality(tier, `load: measuring tier ${tier} at pixel ratio ${pr}`, pr);
          this.prepareFrame();
          progs0 = programs();
          const first = burstProbe(renderer, scene, camera, { maxMs: 400, stopOverMs });
          inspect(first, progs0, tag);
          const runs = [first.ms];
          if (!first.capped && nearLine(first.ms, line)) {
            for (let i = 0; i < 2; i++) {
              progs0 = programs();
              const again = burstProbe(renderer, scene, camera, { maxMs: 250 });
              inspect(again, progs0, tag);
              runs.push(again.ms);
            }
          }
          const ms = +median(runs).toFixed(3);
          return { ms, runs, capped: first.capped, pixelRatio: renderer.getPixelRatio(), first };
        };
        // Tier 2 first (adapt3), at its cap and then at its floor (0.85), when
        // the opening could hold TIER2_HOLD_MS there: the measured pixel ratio
        // scaled to the floor, less a content step per tier (optimistic, so
        // the measurement is what decides). A warm frame over 50 ms skips it.
        const pr2Cap = Math.min(dpr, tierSpec(2, prSteps).pixelRatioCap);
        const pr2Floor = Math.min(pr2Cap, PIXEL_RATIO_FLOOR[2]);
        const tier2Guess = probe.ms * (pr2Floor / prProbe) ** 2 / TIER_CONTENT_STEP ** Math.max(0, 2 - t);
        const probe2: Array<Record<string, unknown>> = [];
        let landed: { tier: 2; pr: number; ms: number } | null = null;
        if (!probe.capped && tier2Guess <= TIER2_HOLD_MS) {
          for (const pr of pr2Floor < pr2Cap - 1e-6 ? [pr2Cap, pr2Floor] : [pr2Cap]) {
            const m = measure(2, pr, TIER2_HOLD_MS, TIER2_HOLD_MS * 2, "tier 2 probe");
            probe2.push({ pr: m.pixelRatio, ms: m.ms, runs: m.runs, capped: m.capped, took: m.first.took });
            if (m.ms <= TIER2_HOLD_MS) {
              landed = { tier: 2, pr: m.pixelRatio, ms: m.ms };
              break;
            }
            // The floor is only worth measuring when the pixels alone could bring it under the line.
            if (m.capped || m.ms * (pr2Floor / m.pixelRatio) ** 2 > TIER2_HOLD_MS * 1.1) break;
          }
        }
        this.qualityReport.probe2 = { guess: +tier2Guess.toFixed(2), line: TIER2_HOLD_MS, runs: probe2, kept: landed ? landed.pr : null };
        if (landed) {
          this.applyQuality(2, `load: tier 2 at pixel ratio ${landed.pr} measured ${landed.ms.toFixed(1)} ms (<= ${TIER2_HOLD_MS})`, landed.pr);
          restHint = landed.ms;
        } else {
          const p3m = measure(3, Math.min(dpr, tierSpec(3, prSteps).pixelRatioCap), POSTER_RULES.probeTier3Ms, 80, "tier 3 probe");
          const p3 = p3m.first;
          this.qualityReport.probe3 = { ...p3, ms: p3m.ms, runs: p3m.runs, firstMs: p3.ms };
          this.loadTier3Ms = p3m.ms;
          // Tier 2 measured and failed this load: the rest check does not try it again.
          restHint = p3.capped || probe2.length ? null : p3m.ms;
          if (p3m.ms > POSTER_RULES.probeTier3Ms) {
            // Only automatic mode goes to the posters on its own: after "Try 3D anyway" the 3D stays, at tier 3.
            if (this.posterPref === "auto") this.enterPoster(`the opening at tier 3 takes ${p3m.ms.toFixed(0)} ms (over ${POSTER_RULES.probeTier3Ms})`, "slow", trusted(), true);
          } else if (!p3.capped && !probe2.length) {
            // Tier 3 measured clean: a stall that capped the first probe shows up here as headroom.
            const h = headroomCheck(3, p3m.ms, renderer.getPixelRatio(), dpr, prSteps);
            this.qualityReport.probe3Check = h;
            if (h.climb) {
              this.applyQuality(h.tier, "load probe at tier 3: " + h.reason);
              restHint = "unknown";
            }
          }
        }
      }
      if (trusted()) rememberTier(this.quality.tier);
      else this.qualityReport.notRemembered = untrusted.length ? untrusted.join("; ") : "the page was hidden during the load";
    } else if (recalled === 0) restHint = null;
    if (this.posterReason && !this.qualityReport.notRemembered && !trusted()) {
      this.qualityReport.notRemembered = untrusted.length ? untrusted.join("; ") : "the page was hidden during the load";
    }
    this.governor = new Governor(this.quality.tier, renderer.getPixelRatio(), window.devicePixelRatio || 1, {
      posterMs: this.tryingLive ? POSTER_RULES.tryGovernorMs : POSTER_RULES.governorMs,
      posterForMs: POSTER_RULES.governorForMs,
    });
    this.armRestCheck(restHint);
  }

  /** True when the page is visible now and was all the time since `since` (performance.now() ms). */
  private visibleThrough(since: number): boolean {
    return typeof document !== "undefined" && !document.hidden && this.visibleSince <= since;
  }

  // ── The rest check (quality.headroomCheck) ────────────────────────────────

  /**
   * Arm the rest check after the load. `hint`: a clean burst at the tier the
   * load ended on (armed unless it is hopeless), "unknown" (armed), or null
   * (the tier above was measured this load and failed: not armed).
   */
  private armRestCheck(hint: number | "unknown" | null) {
    const rc = this.restCheck;
    rc.armed = false;
    rc.log.length = 0;
    const renderer = this.renderer;
    if (!renderer || this.quality.tier === 0 || this.tierOverride !== null || this.posterReason || hint === null) {
      this.qualityReport.restCheck = { armed: false, why: this.quality.tier === 0 ? "tier 0" : hint === null ? "the tier above failed at load" : "off" };
      return;
    }
    if (typeof hint === "number") {
      const h = headroomCheck(this.quality.tier, hint, renderer.getPixelRatio(), window.devicePixelRatio || 1, screenMegapixels() > 5 ? 1 : 0);
      if (h.hopeless) {
        this.qualityReport.restCheck = { armed: false, why: "no headroom at load: " + h.reason };
        return;
      }
    }
    rc.armed = true;
    rc.left = REST_CHECK_MAX;
    rc.climbs = 0;
    rc.nextAt = performance.now() + REST_CHECK_IDLE_MS;
    this.qualityReport.restCheck = { armed: true, checks: rc.log, climbs: 0 };
  }

  /**
   * One frame at rest: when armed, the camera still, no input for
   * REST_CHECK_IDLE_MS and the camera before a7 (a7, a8 and the tail cost 0.35
   * to 0.6 of the opening on the M2, so a burst there would promise headroom
   * the falls do not have), a short saturated burst (0.12 s at most since
   * adapt3, the same image redrawn) at the current tier. With clear headroom the tier climbs one
   * step; the governor starts over from it and steps back down if the route
   * disagrees. Returns true when the tier changed.
   */
  private restCheckTick(now: number): boolean {
    const rc = this.restCheck;
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.camera;
    if (!rc.armed || !renderer || !scene || !camera) return false;
    if (this.tierOverride !== null || this.posterReason || this.quality.tier === 0 || rc.left <= 0) {
      rc.armed = false;
      return false;
    }
    if (now < rc.nextAt || document.hidden || this.idle.idleFor(now) < REST_CHECK_IDLE_MS) return false;
    if (this.parkedId || this.parkPending || this.mode === "flight") return false;
    const place = this.placeCoord();
    if (place > 5.5) return false;
    const pr = renderer.getPixelRatio();
    const b = this.restCheckProbe()!;
    this.logRestBurst("rest check", now, b);
    rc.left--;
    const tier = this.quality.tier;
    const h = headroomCheck(tier, b.ms, pr, window.devicePixelRatio || 1, screenMegapixels() > 5 ? 1 : 0);
    rc.log.push({ at: Math.round(now), place: +place.toFixed(2), tier, ms: b.ms, cold: b.cold, took: b.took, predictedUpMs: +h.predictedUpMs.toFixed(1), climb: h.climb });
    let changed = false;
    if (b.capped) {
      // One warm frame over REST_CHECK_STOP_MS: no tier above can hold here.
      rc.armed = false;
    } else if (h.climb) {
      rc.climbs++;
      this.applyQuality(h.tier, "rest check: " + h.reason);
      this.governor?.reset(h.tier, renderer.getPixelRatio(), now);
      if (this.visibleThrough(now - REST_CHECK_IDLE_MS)) rememberTier(h.tier);
      rc.nextAt = now + REST_CHECK_IDLE_MS;
      changed = true;
    } else {
      rc.nextAt = now + REST_CHECK_RETRY_MS;
      if (h.hopeless) rc.armed = false;
    }
    // applyQuality may have moved the tier above: read it again.
    const tierNow: number = this.quality.tier;
    if (rc.left <= 0 || tierNow === 0) rc.armed = false;
    this.qualityReport.restCheck = { armed: rc.armed, checks: rc.log, climbs: rc.climbs };
    return changed;
  }

  /** Adapt3: every measurement made at rest after the load, with when it ran and how long it held the page (qualityReport.restBursts). */
  private logRestBurst(kind: string, now: number, b: BurstResult) {
    const log = (this.qualityReport.restBursts as Array<Record<string, unknown>> | undefined) ?? [];
    log.push({ kind, at: Math.round(now), took: b.took, ms: b.ms, tier: this.quality.tier, pr: this.renderer?.getPixelRatio() ?? null });
    this.qualityReport.restBursts = log;
  }

  /**
   * Dev (?coldstall): the next `frames` synced frames on the scene's camera
   * each cost `ms` more on the GPU, through the simulator's quad, calibrated
   * here at the current pose (the lake's reflection pass is left alone). Then
   * the quad goes back to what the simulator had it doing.
   */
  private armColdStall(cs: { ms: number; frames: number }) {
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.camera;
    const load = this.gpuLoad;
    if (!renderer || !scene || !camera || !load) return;
    const steady = load.iters();
    const steadyVisible = load.mesh.visible;
    this.prepareFrame();
    const opts = { renders: 6, repeats: 3, warmMs: 120 };
    load.mesh.visible = true;
    const base = burstProbe(renderer, scene, camera, opts);
    const N0 = 2048;
    load.setIters(steady + N0);
    const loaded = burstProbe(renderer, scene, camera, opts);
    load.setIters(steady);
    const perIter = Math.max(1e-5, (loaded.ms - base.ms) / N0);
    const extra = Math.max(0, Math.min(65536 - steady, Math.round(cs.ms / perIter)));
    let left = cs.frames;
    const mesh = load.mesh;
    const noop = () => {};
    mesh.onBeforeRender = (_r, _s, c) => {
      if (left > 0 && c === camera) load.setIters(steady + extra);
    };
    mesh.onAfterRender = (_r, _s, c) => {
      if (c !== camera || left <= 0) return;
      load.setIters(steady);
      left--;
      if (left === 0) {
        mesh.visible = steadyVisible;
        mesh.onBeforeRender = noop;
        mesh.onAfterRender = noop;
      }
    };
    this.qualityReport.coldStall = { ms: cs.ms, frames: cs.frames, iters: extra, perIterUs: +(perIter * 1000).toFixed(3), baseMs: base.ms, expectedMs: +(extra * perIter).toFixed(1) };
  }

  // ── Posters (cheap laptops, poster.ts) ─────────────────────────────────────

  /**
   * The posters replace the 3D. `kind` decides the notice (poster.ts
   * posterNotice). `instant`: no crossfade over live frames (at load, where the
   * posters are already up). `remember`: the next visit starts on the posters
   * without building the 3D, for 7 days (the probe's and the governor's
   * verdicts when the measurement was clean; a slow first compile is never
   * remembered, the driver caches it).
   */
  private enterPoster(reason: string, kind: PosterKind, remember: boolean, instant = false) {
    if (this.posterReason) return;
    this.posterReason = reason;
    this.posterKind = kind;
    this.posterSince = instant ? -1e9 : performance.now();
    this.qualityReport.poster = reason;
    this.qualityReport.posterKind = kind;
    this.qualityReport.posterRemembered = remember;
    if (remember) rememberPoster({ kind, reason });
    console.info("[world-v6] posters:", reason);
    this.notifyPoster();
    this.wake();
  }

  /**
   * The governor's last step asked for the posters (moving frames averaged
   * over POSTER_RULES.governorMs for governorForMs at tier 3, lowest pixel
   * ratio). The camera is at rest: a short burst here decides. Over
   * governorConfirmMs the route cannot be held: the posters (offered, not
   * forced, after "Try 3D anyway"). Under it the slow average was not this
   * GPU's frame (a queue, a stall, another tab): the 3D stays and the governor
   * may ask again later. ?poster=off never leaves the 3D.
   *
   * Adapt3: the burst is perf.quickProbe (120 ms at most, after the queued
   * frames are done); after "Try 3D anyway" the line is the load's 28 ms and
   * the load's own tier 3 measurement can answer with no burst; the asks back
   * off (quality.Governor.posterDeclined) and stop after "Keep 3D".
   */
  private governorPoster(reason: string, now: number, waitedMs = 0) {
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.camera;
    if (!renderer || !scene || !camera || this.posterPref === "off" || this.posterPref === "on") return;
    const at = +this.placeCoord().toFixed(2);
    const log = (this.qualityReport.governorPoster as Array<Record<string, unknown>> | undefined) ?? [];
    this.qualityReport.governorPoster = log;
    // Adapt3: after "Try 3D anyway" the line is the load's own (28 ms at tier
    // 3). When this visit's load already measured the opening at tier 3 over
    // it, the frames and the load agree: offered with no burst at rest.
    const line = this.tryingLive ? POSTER_RULES.probeTier3Ms : POSTER_RULES.governorConfirmMs;
    let verdict: string;
    let over: boolean;
    if (this.tryingLive && this.loadTier3Ms !== null && this.loadTier3Ms > line) {
      over = true;
      verdict = `${reason}; the load measured the opening at tier 3 at ${this.loadTier3Ms.toFixed(0)} ms (over ${line})`;
      log.push({ at: Math.round(now), place: at, reason, burstMs: null, answeredBy: "load tier 3", loadTier3Ms: this.loadTier3Ms, line, over, trying: true, waitedMs });
    } else {
      const b = quickProbe(renderer, scene, camera, POSTER_RULES.restBurstMs);
      this.logRestBurst("governor confirm", now, b);
      over = b.ms > line;
      log.push({ at: Math.round(now), place: at, reason, burstMs: b.ms, cold: b.cold, took: b.took, line, over, trying: this.tryingLive, waitedMs });
      verdict = `${reason}; a burst at rest here (place ${at}) takes ${b.ms.toFixed(0)} ms`;
    }
    if (!over) {
      const quiet = this.governor?.posterDeclined(now) ?? -1;
      log[log.length - 1].next = quiet < 0 ? "no more asks this session" : `quiet ${quiet / 1000} s`;
      this.qualityReport.last = `governor asked for the posters; ${verdict} (not over ${line}): kept the 3D`;
      return;
    }
    if (this.tryingLive) this.offerPoster(verdict);
    // Remembered only when the page was visible through the whole window it averaged.
    else this.enterPoster("governor: " + verdict, "slow", this.visibleThrough(now - POSTER_RULES.governorForMs - 1000));
  }

  /** After "Try 3D anyway": the posters are offered (the page shows POSTER_OFFER), never forced. */
  private offerPoster(reason: string) {
    if (this.posterReason || this.posterOfferReason) return;
    this.posterOfferReason = reason;
    this.qualityReport.posterOffer = reason;
    console.info("[world-v6] posters offered:", reason);
    this.notifyOffer();
  }

  private notifyOffer() {
    for (const cb of this.offerCbs) {
      try {
        cb(this.posterOfferReason);
      } catch (e) {
        console.error("[world-v6] onPosterOffer callback threw", e);
      }
    }
  }

  /** Called with the reason when the posters are offered, and with null when the offer goes away. */
  onPosterOffer(cb: (reason: string | null) => void): () => void {
    this.offerCbs.add(cb);
    return () => this.offerCbs.delete(cb);
  }

  /** The student's answer to the offer: true switches to the posters (remembered), false keeps the 3D. */
  answerPosterOffer(accept: boolean): void {
    const reason = this.posterOfferReason;
    if (!reason) return;
    this.posterOfferReason = null;
    this.qualityReport.posterOffer = null;
    if (accept) {
      this.enterPoster("chosen from the offer: " + reason, "slow", true);
    } else {
      this.qualityReport.posterOfferDeclined = ((this.qualityReport.posterOfferDeclined as number) || 0) + 1;
      // Adapt3: "Keep 3D" ends the asks for the session (no more offers, no more bursts at rest).
      this.governor?.posterStop();
    }
    this.notifyOffer();
  }

  private notifyPoster() {
    for (const cb of this.posterCbs) {
      try {
        cb(this.posterReason);
      } catch (e) {
        console.error("[world-v6] onPoster callback threw", e);
      }
    }
  }

  /** Called with the reason whenever the posters go on, or null when the 3D comes back. */
  onPoster(cb: (reason: string | null) => void): () => void {
    this.posterCbs.add(cb);
    return () => this.posterCbs.delete(cb);
  }

  /**
   * Where poster mode stands. `headless`: there is no 3D to go back to without
   * a reload. `canTry`: "Try 3D anyway" is worth offering (not on a software
   * renderer or without WebGL; ?poster=off still forces the 3D for testing).
   */
  posterState(): { on: boolean; reason: string | null; kind: PosterKind | null; headless: boolean; preference: PosterPreference; canTry: boolean; offer: string | null; trying: boolean } {
    const on = this.posterReason !== null;
    const kind = on ? this.posterKind : null;
    return {
      on,
      reason: this.posterReason,
      kind,
      headless: this.headless,
      preference: this.posterPref,
      canTry: on && kind !== "software" && kind !== "nowebgl",
      offer: this.posterOfferReason,
      trying: this.tryingLive,
    };
  }

  /**
   * The tuning panel and the page's "Try the 3D map": true forces the posters,
   * false brings the 3D back (and forgets a remembered verdict). Returns false
   * when there is no 3D to bring back (headless: the page must reload).
   */
  setPoster(on: boolean, reason = "forced from the tuning panel"): boolean {
    if (on) {
      if (this.posterOfferReason) {
        this.posterOfferReason = null;
        this.qualityReport.posterOffer = null;
        this.notifyOffer();
      }
      this.enterPoster(reason, "forced", false);
      return true;
    }
    rememberPoster(null);
    if (this.headless) return false;
    if (!this.posterReason) return true;
    // "Try 3D anyway" (or Tune's 3D): from now on the posters are offered, not
    // forced, and the governor may ask again (it asks once otherwise).
    if (this.posterKind !== "forced") this.tryingLive = true;
    this.qualityReport.trying = this.tryingLive;
    this.governor?.posterRearm(performance.now());
    if (this.tryingLive) this.governor?.setPosterMs(POSTER_RULES.tryGovernorMs);
    this.posterReason = null;
    this.posterKind = null;
    this.qualityReport.poster = null;
    this.qualityReport.posterKind = null;
    if (this.renderer) this.renderer.domElement.style.visibility = "";
    this.notifyPoster();
    this.dirty = true;
    this.wake();
    return true;
  }

  /** False once the posters have covered the 3D: nothing is drawn or animated then. */
  private drawing(now: number): boolean {
    return !this.posterReason || now - this.posterSince < POSTER_FADE_MS;
  }

  // ── Slow GPU simulator (dev only) ──────────────────────────────────────────

  /**
   * Dev only: make this GPU behave like one `factor` times slower. A full
   * screen quad (perf.createGpuLoad) adds GPU time per pixel, calibrated at the
   * current pose and pixel ratio so the frame costs `factor` times what it did.
   * Because the load is per pixel, the governor's pixel ratio steps and tier 3
   * relieve it the way they relieve a real weak GPU (which is mostly pixels).
   * 1 turns it off. Also `?slowgpu=N` on the page, applied before the probe.
   */
  simulateSlowGpu(factor: number): Record<string, unknown> | null {
    if (process.env.NODE_ENV === "production") return null;
    const scene = this.scene;
    if (!this.renderer || !scene) return null;
    this.slowGpuFactor = Math.max(1, factor);
    if (!this.gpuLoad) {
      this.gpuLoad = createGpuLoad();
      scene.add(this.gpuLoad.mesh);
    }
    if (this.slowGpuFactor <= 1) {
      this.gpuLoad.setIters(0);
      this.gpuLoad.mesh.visible = false;
      this.qualityReport.slowGpu = { factor: 1 };
      this.wake();
      return { factor: 1 };
    }
    const r = this.calibrateSlowGpu(this.slowGpuFactor);
    this.wake();
    return r;
  }

  private calibrateSlowGpu(factor: number): Record<string, unknown> | null {
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.camera;
    const load = this.gpuLoad;
    if (!renderer || !scene || !camera || !load) return null;
    this.prepareFrame();
    const opts = { renders: 6, repeats: 3, warmMs: 120 };
    load.mesh.visible = false;
    const base = burstProbe(renderer, scene, camera, opts);
    const N0 = 512;
    load.mesh.visible = true;
    load.setIters(N0);
    const loaded = burstProbe(renderer, scene, camera, opts);
    const perIter = Math.max(1e-5, (loaded.ms - base.ms) / N0);
    const iters = Math.round(((factor - 1) * base.ms) / perIter);
    load.setIters(iters);
    const check = burstProbe(renderer, scene, camera, { renders: 2, repeats: 2, warmMs: 0 });
    const out = {
      factor,
      baseMs: base.ms,
      perIterUs: +(perIter * 1000).toFixed(3),
      iters: load.iters(),
      checkMs: check.ms,
      achieved: +(check.ms / Math.max(1e-3, base.ms)).toFixed(2),
      pixelRatio: renderer.getPixelRatio(),
      tier: this.quality.tier,
    };
    this.qualityReport.slowGpu = out;
    return out;
  }

  /**
   * Set the content tier (and the pixel ratio: the tier's cap unless given).
   * Calls setQuality on every module and every onQuality callback when the tier
   * or its cap changed. MSAA never changes here.
   */
  private applyQuality(tier: number, reason: string, pixelRatio?: number) {
    const spec = tierSpec(tier, screenMegapixels() > 5 ? 1 : 0);
    const changed = spec.tier !== this.quality.tier || spec.pixelRatioCap !== this.quality.pixelRatioCap;
    this.quality = spec;
    if (this.ctx) this.ctx.quality = spec;
    const pr = Math.min(window.devicePixelRatio || 1, pixelRatio ?? spec.pixelRatioCap);
    if (this.renderer && Math.abs(this.renderer.getPixelRatio() - pr) > 1e-3) this.renderer.setPixelRatio(pr);
    if (changed) {
      for (const rec of this.modules) {
        if (rec.broken || !rec.module.setQuality) continue;
        try {
          rec.module.setQuality(spec);
        } catch (e) {
          console.error(`[world-v6] module ${rec.name} setQuality threw`, e);
        }
      }
      for (const cb of this.qualityCbs) {
        try {
          cb(spec);
        } catch (e) {
          console.error("[world-v6] onQuality callback threw", e);
        }
      }
    }
    Object.assign(this.qualityReport, { tier: spec.tier, pixelRatio: pr, last: reason });
    this.wake();
  }

  /** The terrain from terrain.ts, grey, with the finer patches (PATCHES) cut in. */
  private addTerrain(root: THREE.Object3D) {
    const main = buildTerrainGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, name: "TerrainGrey" });
    // Main grid, as buildTerrainGeometry lays it out.
    const W = WORLD.maxX - WORLD.minX;
    const D = WORLD.maxZ - WORLD.minZ;
    const cell = Math.max(W, D) / 320;
    const nx = Math.max(2, Math.round(W / cell));
    const nz = Math.max(2, Math.round(D / cell));
    const sx = W / nx;
    const sz = D / nz;
    // Each patch's main-grid cell range.
    const ranges = PATCHES.map((P) => ({
      i0: Math.max(0, Math.floor((P.minX - WORLD.minX) / sx)),
      i1: Math.min(nx, Math.ceil((P.maxX - WORLD.minX) / sx)),
      j0: Math.max(0, Math.floor((P.minZ - WORLD.minZ) / sz)),
      j1: Math.min(nz, Math.ceil((P.maxZ - WORLD.minZ) / sz)),
      sub: P.sub,
    }));
    const inPatch = (i: number, j: number) => ranges.some((r) => i >= r.i0 && i < r.i1 && j >= r.j0 && j < r.j1);
    // Cut the patches' cells out of the main mesh (6 indices per cell, row by row).
    const idx = main.getIndex()!.array as Uint32Array;
    const kept = new Uint32Array(idx.length);
    let o = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (inPatch(i, j)) continue;
        const b = (j * nx + i) * 6;
        for (let k = 0; k < 6; k++) kept[o++] = idx[b + k];
      }
    }
    main.setIndex(new THREE.BufferAttribute(kept.slice(0, o), 1));
    const mesh = new THREE.Mesh(main, mat);
    mesh.name = "Terrain";
    root.add(mesh);

    const hMain = (ii: number, jj: number) => terrainHeight(WORLD.minX + ii * sx, WORLD.minZ + jj * sz);
    ranges.forEach(({ i0, i1, j0, j1, sub }, pi) => {
      const bounds = {
        minX: WORLD.minX + i0 * sx,
        maxX: WORLD.minX + i1 * sx,
        minZ: WORLD.minZ + j0 * sz,
        maxZ: WORLD.minZ + j1 * sz,
      };
      const longer = Math.max(i1 - i0, j1 - j0);
      const patch = buildTerrainGeometry(longer * sub, bounds);
      // Patch edge vertices take the main mesh's height along its cell edges
      // (linear between main vertices), so the seam has no crack.
      const pnx = (i1 - i0) * sub;
      const pnz = (j1 - j0) * sub;
      const pos = patch.getAttribute("position") as THREE.BufferAttribute;
      if (pos.count === (pnx + 1) * (pnz + 1)) {
        for (let j = 0; j <= pnz; j++) {
          for (let i = 0; i <= pnx; i++) {
            if (i !== 0 && i !== pnx && j !== 0 && j !== pnz) continue;
            const k = j * (pnx + 1) + i;
            const gi = i0 + i / sub;
            const gj = j0 + j / sub;
            let y: number;
            if (i === 0 || i === pnx) {
              const a = Math.floor(gj);
              const f = gj - a;
              y = f === 0 ? hMain(gi, a) : hMain(gi, a) * (1 - f) + hMain(gi, a + 1) * f;
            } else {
              const a = Math.floor(gi);
              const f = gi - a;
              y = f === 0 ? hMain(a, gj) : hMain(a, gj) * (1 - f) + hMain(a + 1, gj) * f;
            }
            pos.setY(k, y);
          }
        }
        pos.needsUpdate = true;
        patch.computeBoundingSphere();
      } else {
        console.warn("[world-v6] terrain patch grid mismatch; seam not snapped", pi, pos.count, (pnx + 1) * (pnz + 1));
      }
      const pm = new THREE.Mesh(patch, mat);
      pm.name = pi === 0 ? "Terrain:falls" : `Terrain:patch${pi}`;
      root.add(pm);
    });
  }

  private makeCtx(root: THREE.Object3D): WorldCtx {
    const lms: Record<string, LandmarkBase> = {};
    for (const p of PLACES) lms[p.mesh] = { x: p.pos.x, y: p.pos.y, z: p.pos.z, height: p.height };
    const stopU = this.stopU();
    return {
      scene: this.scene!,
      root,
      renderer: this.renderer!,
      camera: this.camera!,
      layout: Layout,
      terrainHeight,
      heightAt: surfaceHeight,
      railU: () => this.railU(),
      routeU: () => this.routeU(),
      stopU,
      placeU: stopU,
      placeCoord: () => this.placeCoord(),
      shipPose: (out: ShipPose) => this.rail.shipAtS(this.currentS, out),
      landmarks: lms,
      sunDir: SUN_DIR.clone(),
      sunColor: GREY_SUN.clone(),
      hazeColor: GREY_HAZE.clone(),
      lock: this.lockState,
      reducedMotion: this.reducedMotion,
      quality: this.quality,
      onQuality: (cb: (tier: QualityTier) => void) => {
        this.qualityCbs.add(cb);
        return () => this.qualityCbs.delete(cb);
      },
    };
  }


  /** Install the page's modules in order, each guarded, with a turn for the browser between. */
  private async installModules(root: THREE.Object3D) {
    const ctx = this.makeCtx(root);
    this.ctx = ctx;
    // v6: footprints start empty for this mount; the trail registers first.
    resetFootprints();
    registerTrailFootprints([Layout.PATH, Layout.GATE_CAUSEWAY]);
    const imports = this.moduleSpecs.map(([, load]) => load().catch((e: unknown) => e));
    for (let i = 0; i < this.moduleSpecs.length; i++) {
      const name = this.moduleSpecs[i][0];
      await yieldToBrowser();
      if (this.disposed || !this.scene) return;
      const mod = await imports[i];
      if (this.disposed || !this.scene) return;
      const install = (mod as { install?: InstallFn } | null)?.install;
      if (typeof install !== "function") {
        this.moduleReport[name] = `import failed: ${mod instanceof Error ? mod.message : String(mod)}`;
        console.error(`[world-v6] module ${name} did not load`, mod);
        continue;
      }
      const t0 = performance.now();
      try {
        const m = await install(ctx);
        if (this.disposed || !this.scene) {
          try {
            m.dispose();
          } catch {}
          return;
        }
        this.modules.push({ name, module: m, broken: false });
        this.moduleReport[name] = Math.round(performance.now() - t0);
      } catch (e) {
        this.moduleReport[name] = `install threw: ${e instanceof Error ? e.message : String(e)}`;
        console.error(`[world-v6] module ${name} failed to install`, e);
      }
    }
    // v6: every module's afterAll, in install order, once all have installed
    // (footprints are registered by then; the ground and cover bake them).
    for (const m of this.modules) {
      const after = m.module.afterAll;
      if (typeof after !== "function") continue;
      const t0 = performance.now();
      try {
        await after.call(m.module, ctx);
        this.moduleReport[`${m.name}:afterAll`] = Math.round(performance.now() - t0);
      } catch (e) {
        this.moduleReport[`${m.name}:afterAll`] = `threw: ${e instanceof Error ? e.message : String(e)}`;
        console.error(`[world-v6] module ${m.name} afterAll failed`, e);
      }
      if (this.disposed || !this.scene) return;
    }
    if (this.moduleSpecs.length) console.info("[world-v6] modules", this.moduleReport);
  }

  /** Grey stand-ins for whatever the modules did not provide (see WorldSceneOptions.fallbacks). */
  private addStandIns(root: THREE.Object3D) {
    const scene = this.scene!;
    const grey = (hex: number) => new THREE.MeshLambertMaterial({ color: hex });
    const add = (o: THREE.Object3D) => {
      root.add(o);
      this.standIns.push(o.name);
    };

    // Lights: when no module added any.
    let lit = false;
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) lit = true;
    });
    if (!lit) {
      const sun = new THREE.DirectionalLight(GREY_SUN, 1.5);
      sun.name = "Stand-in:Sun";
      sun.position.copy(this.ctx?.sunDir ?? SUN_DIR).multiplyScalar(4000);
      add(sun);
      const hemi = new THREE.HemisphereLight(0xb8c4d6, 0x4a4640, 0.7);
      hemi.name = "Stand-in:Sky";
      add(hemi);
    }

    // Landmarks: a block for every place whose LM_* object is missing.
    const lmMat = grey(0xd8d2c8);
    for (const p of PLACES) {
      if (scene.getObjectByName(p.mesh)) continue;
      const g = new THREE.Group();
      g.name = p.mesh;
      if (p.landmark === "Waterfall") {
        g.add(this.fallsCurtain());
      } else {
        const w = Math.min(90, Math.max(10, p.height * 0.45));
        const box = new THREE.Mesh(new THREE.BoxGeometry(w, p.height, w), lmMat);
        box.position.set(p.pos.x, p.pos.y + p.height / 2, p.pos.z);
        g.add(box);
      }
      add(g);
    }

    const water = new THREE.MeshLambertMaterial({ color: 0x7f93a6 });
    // The sea, whenever no module drew one: the terrain runs below sea level
    // off the south and east coasts, and past its edges (the sea continues).
    if (!scene.getObjectByName("Sea")) {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.maxX - WORLD.minX + 12000, WORLD.maxZ - WORLD.minZ + 12000), water);
      sea.rotation.x = -Math.PI / 2;
      sea.position.set((WORLD.minX + WORLD.maxX) / 2, WORLD.seaLevel, (WORLD.minZ + WORLD.maxZ) / 2);
      sea.name = "Sea";
      add(sea);
    }
    const discs: Array<readonly [string, { x: number; y: number; z: number; r: number }]> = [];
    if (!scene.getObjectByName("MirrorLake") && !scene.getObjectByName("Lake")) discs.push(["Lake", WORLD.lake]);
    if (this.wantFallbacks) discs.push(["Stand-in:Pool", WORLD.pool]);
    for (const [name, w] of discs) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(w.r, 64), water);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(w.x, w.y, w.z);
      disc.name = name;
      add(disc);
    }
    if (!this.wantFallbacks) return;
    // The Sky Island and the bounty isle: a flat top and rock hanging below as a cone.
    const rock = grey(0x9a948c);
    for (const [name, isl, depth] of [
      ["Stand-in:SkyIsland", WORLD.island, ISLAND_DEPTH],
      ["Stand-in:BountyIsle", WORLD.bountyIsle, BOUNTY_DEPTH],
      ["Stand-in:GateIsle", WORLD.gateIsle, GATE_DEPTH],
    ] as const) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(isl.r, depth, 48, 1), rock);
      cone.rotation.x = Math.PI; // point down
      cone.position.set(isl.x, isl.y - depth / 2, isl.z);
      cone.name = name;
      add(cone);
    }
    // The floating steps.
    const stepGeo = new THREE.BoxGeometry(34, 8, 34);
    const steps = new THREE.InstancedMesh(stepGeo, rock, STEPS.length);
    const m = new THREE.Matrix4();
    STEPS.forEach((s, i) => steps.setMatrixAt(i, m.makeTranslation(s[0], s[1] - 4, s[2])));
    steps.name = "Stand-in:Steps";
    add(steps);
    // Your airship: a deck and a bow, placed from the rail every frame (updateShipStandIn).
    const ship = new THREE.Group();
    ship.name = "Stand-in:Ship";
    const hull = new THREE.Mesh(new THREE.BoxGeometry(SHIP.length - 20, 10, 24), grey(0x8a7a66));
    hull.position.set(-10, -5, 0); // nose along local +x; deck top at y 0
    ship.add(hull);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(12, 20, 4, 1), grey(0x8a7a66));
    bow.rotation.z = -Math.PI / 2;
    bow.position.set(SHIP.length / 2 - 10, -5, 0);
    ship.add(bow);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(2, 40, 2), grey(0x6b5d4e));
    mast.position.set(20, 20, 0);
    ship.add(mast);
    ship.rotation.order = "YXZ";
    add(ship);
    this.shipStandIn = ship;
    this.updateShipStandIn();
  }

  /** Put the fallback ship where the rail says your airship is. */
  private updateShipStandIn() {
    const g = this.shipStandIn;
    if (!g) return;
    const p = this.rail.shipAtS(this.currentS, this.shipScratch);
    g.position.set(p.x, p.y, p.z);
    // Nose along local +x: yaw 90 - heading turns it to the compass heading.
    g.rotation.set((p.bank * Math.PI) / 180, ((90 - p.heading) * Math.PI) / 180, 0);
  }

  /** The falls as a grey-blue curtain on layout's free-fall arc (WORLD.falls). */
  private fallsCurtain(): THREE.Mesh {
    const f = WORLD.falls;
    const ty = f.top[1];
    const by = f.bottom[1];
    const drop = ty - by;
    const ROWS = 16;
    const pos: number[] = [];
    const ix: number[] = [];
    for (let r = 0; r <= ROWS; r++) {
      const y = ty - (drop * r) / ROWS;
      const [cx, cz] = fallsCurtainAt(y);
      pos.push(cx - f.width / 2, y, cz, cx + f.width / 2, y, cz);
      if (r < ROWS) {
        const a = r * 2;
        ix.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(ix);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xc9d6e2, side: THREE.DoubleSide }));
    mesh.name = "Stand-in:FallsCurtain";
    return mesh;
  }

  /** Trees (InstancedMeshes named Forest:*) as cylinders, for the park's foreground test. As V3. */
  private indexTrees(root: THREE.Object3D) {
    const out: number[] = [];
    const m = new THREE.Matrix4();
    root.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (!im.isInstancedMesh || !/^Forest:/.test(im.name) || !isShown(im)) return;
      const g = im.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox!;
      const half = 0.4 * Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        m.premultiply(im.matrixWorld);
        const e = m.elements;
        const sx = Math.hypot(e[0], e[1], e[2]);
        const sy = Math.hypot(e[4], e[5], e[6]);
        out.push(e[12], e[14], e[13] + b.min.y * sy, e[13] + b.max.y * sy, half * sx);
      }
    });
    this.trees = out.length ? new Float32Array(out) : undefined;
  }

  /**
   * Each LM_* object's box and surface samples: all of its shown meshes.
   * (V3 had to filter child parts ridge.py placed 800 units away; V4's
   * landmarks are built in code and own everything under them.)
   */
  private indexLandmarks(root: THREE.Object3D) {
    this.landmarks.clear();
    this.lmMeshes.clear();
    root.traverse((o) => {
      if (!o.name.startsWith("LM_") || !isShown(o)) return;
      // A nested LM_* object belongs to its outermost LM_ ancestor.
      for (let p = o.parent; p; p = p.parent) if (p.name.startsWith("LM_")) return;
      const meshes: THREE.Mesh[] = [];
      o.traverse((d) => {
        if ((d as THREE.Mesh).isMesh && isShown(d) && !wakeTagged(d, o)) meshes.push(d as THREE.Mesh);
      });
      const lm = buildLandmark(meshes, surfaceHeight);
      if (lm) {
        this.landmarks.set(o.name, lm);
        this.lmMeshes.set(o.name, meshes);
      }
    });
    this.lmList.length = 0;
    for (const lm of this.landmarks.values()) this.lmList.push(lm);
  }

  // ── Anchors ────────────────────────────────────────────────────────────────

  setAnchors(anchors: AreaAnchor[]): void {
    this.anchors = anchors.slice();
    this.anchorPlace = this.anchors.map((a, i) => {
      let k = PLACES.findIndex((p) => p.mesh === a.landmark);
      if (k < 0) k = PLACES.findIndex((p) => p.id === a.id);
      return k >= 0 ? k : i < PLACES.length ? i : -1;
    });
    const markers = this.markers;
    markers.length = Math.min(markers.length, anchors.length);
    for (let i = 0; i < anchors.length; i++) {
      if (!markers[i]) {
        markers[i] = { id: anchors[i].id, x: 0, y: 0, visible: false, proximity: 0, enterable: true, beyond: false, rl: NaN, rt: NaN, rr: NaN, rb: NaN };
      } else markers[i].id = anchors[i].id;
    }
    this.applyLockToMarkers();
    this.resolveAnchors();
    if (this.parkedId && !this.anchors.some((a) => a.id === this.parkedId)) this.park(null);
    this.dirty = true;
    this.wake();
  }

  private resolveAnchors() {
    const out = this.anchorPos;
    out.length = Math.min(out.length, this.anchors.length);
    this.anchorLm.length = this.anchors.length;
    this.anchorBody.length = this.anchors.length;
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      if (!out[i]) out[i] = new THREE.Vector3();
      const lm = a.landmark ? this.landmarks.get(a.landmark) : undefined;
      this.anchorLm[i] = lm ?? null;
      this.anchorBody[i] = !!(lm && a.landmark && ANCHOR_ON_BODY.has(a.landmark));
      const placeR = a.landmark ? ANCHOR_ON_PLACE.get(a.landmark) : undefined;
      const place = placeR ? PLACES.find((q) => q.mesh === a.landmark) : undefined;
      const placeTop = lm && place && placeR ? topNear(this.lmMeshes.get(a.landmark!) ?? [], place.pos.x, place.pos.z, placeR) : -Infinity;
      if (lm && place && Number.isFinite(placeTop)) {
        this.anchorBody[i] = true;
        out[i].set(place.pos.x, placeTop - (ANCHOR_DROP.get(a.landmark!) ?? 0), place.pos.z);
      } else if (lm && this.anchorBody[i]) out[i].set(lm.top.x, lm.bodyTop, lm.top.z);
      else if (lm) out[i].copy(lm.top);
      else {
        this.rail.sample(this.depthFor(a.id), this.railPose);
        out[i].copy(this.railPose.target);
      }
    }
  }

  landmarkNames(): string[] {
    return [...this.landmarks.keys()].sort();
  }

  /** Scroll depth of an anchor's stop. Exact for the layout places; changes with setPacing. */
  depthFor(anchorId: string): number {
    const i = this.anchors.findIndex((x) => x.id === anchorId);
    if (i < 0) return this.currentDepth;
    const k = this.anchorPlace[i];
    if (k >= 0) return this.rail.stopDepth(k);
    const a = this.anchors[i];
    const lm = a.landmark ? this.landmarks.get(a.landmark) : undefined;
    if (lm) return this.rail.depthOfS(this.rail.sNearest(lm.center.x, lm.center.z));
    return clamp01(a.depth);
  }

  /** The eight stops' scroll depths, PLACES order. */
  stopDepths(): number[] {
    return PLACES.map((_, i) => this.rail.stopDepth(i));
  }

  // ── Scroll, pacing, lock ───────────────────────────────────────────────────

  scrollDepth(): number {
    this.cacheScroll();
    return this.readScrollDepth(this.targetDepth);
  }

  seedDepth(depth: number): void {
    const d = Math.min(this.depthMax, Math.max(0, depth));
    this.targetDepth = d;
    this.currentDepth = d;
    this.currentS = this.rail.sOfDepth(d);
    if (this.mode === "rail") this.placeOnRail(d);
    this.wake();
  }

  isContextLost(): boolean {
    return this.contextLost;
  }

  scrollYForDepth(depth: number): number {
    this.cacheScroll();
    if (this.maxScroll <= 0) return 0;
    return this.yForDepth(Math.min(depth, this.depthMax));
  }

  /** Scroll position as depth, in absolute vh. `fallback` when the page cannot scroll (spacer collapsed or locked). */
  private readScrollDepth(fallback: number): number {
    if (this.maxScroll <= 0) return fallback;
    const d = window.scrollY / this.vhPx / this.rail.totalVh();
    return d < 0 ? 0 : d > this.depthMax ? this.depthMax : d;
  }

  /** The end of the route in depth units: always 1 (the lock's limit is lockLimit()). */
  maxDepth(): number {
    return 1;
  }

  /** Deepest depth the scroll reaches under the current lock. */
  lockLimit(): number {
    return this.depthMax;
  }

  /**
   * Where the camera's rail point is, as the TRAIL curve parameter t in 0..1
   * (key i at i / (n - 1), layout.ts): the unit light.ts and blocks.ts read.
   */
  railU(): number {
    return this.rail.tAtS(this.currentS);
  }

  /** Where the camera's rail point is as a share of the route's length. */
  routeU(): number {
    return this.currentS / this.rail.length;
  }

  /** railU of each stop, PLACES order (exactly PLACES[i].trail / (n - 1)). */
  stopU(): number[] {
    return this.rail.stopS.map((s) => this.rail.tAtS(s));
  }

  /** 0 at the first stop .. 7 at the last, by distance between them; below 0 before, above 7 in the tail. */
  placeCoord(): number {
    const s = this.currentS;
    const st = this.rail.stopS;
    if (s <= st[0]) return st[0] > 0 ? (s - st[0]) / st[0] : 0;
    for (let k = 0; k < st.length - 1; k++) {
      if (s <= st[k + 1]) return k + (s - st[k]) / (st[k + 1] - st[k]);
    }
    const tail = this.rail.length - st[st.length - 1];
    return st.length - 1 + (tail > 0 ? (s - st[st.length - 1]) / tail : 0);
  }

  /** Per-stretch budgets in vh (8 stretches ending at the stops, then the tail). */
  pacing(): number[] {
    return this.rail.pacing().slice();
  }

  /** The page spacer's height in vh: the scroll budget under the current lock, plus one screen. */
  spacerVh(): number {
    return 100 + this.rail.totalVh() * this.depthMax;
  }

  /** The scene keeps this element's height at spacerVh() (pacing and lock change it). */
  bindSpacer(el: HTMLElement | null): void {
    this.spacerEl = el;
    this.applySpacer();
  }

  /**
   * Live retune of the per-stretch scroll budgets: 8 values (the stretch
   * ending at each stop), the tail as a 9th value or as tailVh, and the
   * flight (layout FLIGHT_VH) as a 10th value or as flightVh. The camera
   * stays where it is on the route.
   */
  setPacing(scrollVh: readonly number[], tailVh?: number, flightVh?: number): void {
    const sCur = this.rail.sOfDepth(this.currentDepth);
    const sTgt = this.rail.sOfDepth(this.targetDepth);
    const next = this.rail.pacing().slice();
    for (let k = 0; k < Math.min(10, scrollVh.length); k++) next[k] = scrollVh[k];
    if (tailVh !== undefined) next[8] = tailVh;
    if (flightVh !== undefined) next[9] = flightVh;
    this.rail.setPacing(next);
    this.depthMax = this.lockDepth();
    this.currentDepth = Math.min(this.depthMax, this.rail.depthOfS(sCur));
    this.targetDepth = Math.min(this.depthMax, this.rail.depthOfS(sTgt));
    this.currentS = this.rail.sOfDepth(this.currentDepth);
    this.resolveAnchors();
    this.applyLockToMarkers();
    this.applySpacer();
    this.putScrollOnDepth();
  }

  /** Locking mode and the current place (0..7). See the file header. */
  setLock(mode: LockMode, frontier: number): void {
    this.lockState.mode = mode === "look" || mode === "locked" ? mode : "open";
    this.lockState.frontier = Math.min(7, Math.max(0, Math.round(Number.isFinite(frontier) ? frontier : 0)));
    this.depthMax = this.lockDepth();
    if (this.targetDepth > this.depthMax) this.targetDepth = this.depthMax;
    this.applyLockToMarkers();
    this.applySpacer();
    this.putScrollOnDepth();
    if (this.parkedId !== null && !this.isEnterable(this.parkedId)) this.park(null);
    this.forwardMist();
    this.dirty = true;
    this.wake();
  }

  /** Places finished, 0..8 (fraction = share of the next place done). Passed to modules with setProgress. */
  setProgress(finished: number): void {
    this.progress = Number.isFinite(finished) ? Math.min(8, Math.max(0, finished)) : 0;
    for (const rec of this.modules) {
      const m = rec.module as WorldModule & { setProgress?: (p: number) => void };
      if (typeof m.setProgress === "function") {
        try {
          m.setProgress(this.progress);
        } catch (e) {
          console.error(`[world-v6] module ${rec.name} setProgress threw`, e);
        }
      }
    }
    this.dirty = true;
    this.wake();
  }

  /**
   * Per-lesson progress (progress.ts): the lesson lanterns, the places waking
   * up, the arrival card. Passed to every module with setWorldProgress(p).
   * setProgress(finished) above stays for modules that only need whole places.
   */
  setWorldProgress(p: WorldProgress): void {
    if (sameProgress(p, this.worldProgress)) return;
    this.worldProgress = p;
    this.forwardWorldProgress();
  }

  /** The progress the scene last received (NO_PROGRESS before the page sets one). */
  getWorldProgress(): WorldProgress {
    return this.worldProgress;
  }

  /**
   * The area-done moment (progress-world.ts): the light runs along area k's
   * lesson lanterns (about 1 s) and its landmark lamp catches at the end.
   * One-off; the page calls it when an area reaches 100% while it is open,
   * after setWorldProgress. Reduced motion: the lamp just turns on.
   */
  celebrate(area: number): void {
    for (const rec of this.modules) {
      const m = rec.module as WorldModule & { celebrate?: (area: number) => void };
      if (typeof m.celebrate === "function") {
        try {
          m.celebrate(area);
        } catch (e) {
          console.error(`[world-v6] module ${rec.name} celebrate threw`, e);
        }
      }
    }
    this.dirty = true;
    this.wake();
  }

  /**
   * The discount checkpoint's look (checkpoint.ts): the trail cache on the
   * saddle closed, near, ready or claimed. The page sets it from the
   * student's discount state; modules with setCheckpoint(look) draw it.
   */
  setCheckpoint(look: CheckpointLook): void {
    if (look === this.checkpointLook) return;
    this.checkpointLook = look;
    this.forwardCheckpoint();
  }

  private forwardCheckpoint() {
    for (const rec of this.modules) {
      const m = rec.module as WorldModule & { setCheckpoint?: (look: CheckpointLook) => void };
      if (typeof m.setCheckpoint === "function") {
        try {
          m.setCheckpoint(this.checkpointLook);
        } catch (e) {
          console.error(`[world-v6] module ${rec.name} setCheckpoint threw`, e);
        }
      }
    }
    this.dirty = true;
    this.wake();
  }

  private forwardWorldProgress() {
    for (const rec of this.modules) {
      const m = rec.module as WorldModule & { setWorldProgress?: (p: WorldProgress) => void };
      if (typeof m.setWorldProgress === "function") {
        try {
          m.setWorldProgress(this.worldProgress);
        } catch (e) {
          console.error(`[world-v6] module ${rec.name} setWorldProgress threw`, e);
        }
      }
    }
    this.dirty = true;
    this.wake();
  }

  /** "look": the places past the frontier go into mist (modules with setMist). Otherwise none. */
  private forwardMist() {
    const { mode, frontier } = this.lockState;
    const idx: number[] = [];
    if (mode === "look") for (let k = frontier + 1; k < PLACES.length; k++) idx.push(k);
    for (const rec of this.modules) {
      const m = rec.module as WorldModule & { setMist?: (indices: readonly number[]) => void };
      if (typeof m.setMist === "function") {
        try {
          m.setMist(idx);
        } catch (e) {
          console.error(`[world-v6] module ${rec.name} setMist threw`, e);
        }
      }
    }
  }

  lock(): Readonly<LockState> {
    return this.lockState;
  }

  /** Can this anchor be opened under the current lock? */
  isEnterable(anchorId: string): boolean {
    if (this.lockState.mode === "open") return true;
    const i = this.anchors.findIndex((a) => a.id === anchorId);
    if (i < 0) return false;
    const k = this.anchorPlace[i];
    return k < 0 || k <= this.lockState.frontier;
  }

  /** Deepest scroll depth under the lock: 1, or a little past the frontier stop. */
  private lockDepth(): number {
    if (this.lockState.mode !== "locked") return 1;
    const f = this.lockState.frontier;
    if (f >= PLACES.length - 1) return 1;
    const s = Math.min(this.rail.stopS[f] + LOCK_PEEK_UNITS[f], this.rail.stopS[f + 1] - 1);
    return Math.min(1, this.rail.depthOfS(s));
  }

  private applyLockToMarkers() {
    const { mode, frontier } = this.lockState;
    for (let i = 0; i < this.markers.length; i++) {
      const k = this.anchorPlace[i] ?? -1;
      const beyond = mode !== "open" && k > frontier;
      this.markers[i].beyond = beyond;
      this.markers[i].enterable = !beyond;
    }
    this.frame.maxDepth = this.depthMax;
  }

  private applySpacer() {
    if (this.spacerEl) this.spacerEl.style.height = `${this.spacerVh().toFixed(3)}vh`;
  }

  /**
   * After the budgets or the lock changed: put the page scroll on the target
   * depth (on the rail only). Only when the scene sizes the spacer
   * (bindSpacer); a page that sizes its own spacer also scrolls itself.
   */
  private putScrollOnDepth() {
    if (!this.spacerEl) return;
    this.cacheScroll();
    this.lastMaxScroll = this.maxScroll;
    if (this.parkedId !== null || this.mode !== "rail" || this.maxScroll <= 0) return;
    const y = Math.round(this.yForDepth(this.targetDepth));
    if (Math.abs(window.scrollY - y) >= 1) window.scrollTo({ top: y, left: 0, behavior: "instant" });
    this.wake();
  }

  // ── Park ───────────────────────────────────────────────────────────────────

  /** Fly in to a place (null: back to the rail). Returns false when the lock refuses it. */
  park(anchorId: string | null): boolean {
    if (anchorId === this.parkedId) return true;
    if (anchorId !== null && !this.anchors.some((a) => a.id === anchorId)) {
      console.warn("[world-v6] park: unknown anchor", anchorId);
      return false;
    }
    if (anchorId !== null && !this.isEnterable(anchorId)) return false;
    if (anchorId === null) {
      this.parkedId = null;
      this.parkPending = false;
      if (this.mode === "rail") return true;
      this.startFlight(true);
      return true;
    }
    this.parkedId = anchorId;
    if (!this.ready) {
      this.parkPending = true;
      return true;
    }
    this.beginPark(anchorId);
    return true;
  }

  private beginPark(anchorId: string) {
    this.computeParkPose(anchorId);
    this.startFlight(false);
  }

  private startFlight(toRail: boolean) {
    this.fromPos.copy(this.camPos);
    this.fromLook.copy(this.camLook);
    this.v0Pos.copy(this.velPos);
    this.v0Look.copy(this.velLook);
    if (this.v0Pos.length() > FLIGHT_MAX_V0) this.v0Pos.setLength(FLIGHT_MAX_V0);
    if (this.v0Look.length() > FLIGHT_MAX_V0) this.v0Look.setLength(FLIGHT_MAX_V0);
    this.flightToRail = toRail;
    this.flightElapsed = 0;
    this.progFrom = this.parkProgress;
    this.progTo = toRail ? 0 : 1;
    this.switchDip = !toRail && this.parkProgress >= 0.999;
    let dest: THREE.Vector3;
    if (toRail) {
      this.railLookPose(this.currentDepth, this.v1, this.v2);
      dest = this.v1;
    } else {
      dest = this.parkPos;
    }
    this.flightFromDepth = this.poseDepth;
    this.flightToDepth = toRail ? this.currentDepth : this.parkDepth;
    this.flightTelescope = false;
    if (this.parkTelescope) {
      // Out along the telescope's path, or back along it to the rail's pose now.
      this.telescopeFrame();
      this.railLookPose(this.currentDepth, this.v1, this.v2);
      this.telDir0.copy(this.v2).sub(this.v1).normalize();
      const pts = [this.v1.clone()];
      for (const [along, over] of TEL_PARK_PATH) pts.push(this.telPoint(along, over, new THREE.Vector3()));
      if (toRail) pts[pts.length - 1].copy(this.camPos);
      // Final pass (a page error in the a7 click-in: three's getPointAt read
      // an undefined point): a non-finite pose (the camera caught mid-switch)
      // would make the curve's arc-length table NaN, and getPointAt then
      // indexes points[NaN]. Never build the path from one.
      for (const q of pts) if (!Number.isFinite(q.x + q.y + q.z)) q.copy(this.parkPos);
      this.telCurve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
      this.flightTelescope = true;
      this.flightArc = 0;
      this.flightDuration = this.reducedMotion ? 0 : TEL_PARK_T;
      this.mode = "flight";
      this.dirty = true;
      this.wake();
      return;
    }
    const dist = this.fromPos.distanceTo(dest);
    // The straight line between can run through a ridge on a long flight; the
    // flight arcs up by what it takes to clear the ground under that line.
    // Final pass B (the experience judge: the a1 click in rose 24 -> 894 for a
    // 136 unit move, a4 325 -> 1157, a3 130 -> 409 for 25 units): the old test
    // asked every sample for the full 80 over the ground and divided by
    // sin(pi f), so a camera that stands 20 over the ground at either end
    // (every stop does) asked for 60 / sin(pi / 48) ~ 900 at the first sample.
    // Now the clearance asked for grows with the arc itself (clear * sin(pi f)),
    // so the ends ask only for what the line already has, the mid clearance is
    // at most 0.25 of the hop, and the apex never passes 80 over the highest
    // ground under the line, nor 0.35 of a hop under 300.
    let arc = 0;
    const hd = Math.hypot(dest.x - this.fromPos.x, dest.z - this.fromPos.z);
    const clear = Math.min(FLIGHT_ARC_CLEAR, 0.25 * hd);
    let topGround = -Infinity;
    for (let k = 1; k < 48; k++) {
      const f = k / 48;
      const x = this.fromPos.x + (dest.x - this.fromPos.x) * f;
      const z = this.fromPos.z + (dest.z - this.fromPos.z) * f;
      const y = this.fromPos.y + (dest.y - this.fromPos.y) * f;
      const g = surfaceHeight(x, z);
      topGround = Math.max(topGround, g);
      // sin(pi f) is how much of the arc this point gets.
      const s = Math.sin(Math.PI * f);
      const need = g + clear * s - y;
      if (need > 0 && s > 0.2) arc = Math.max(arc, need / s);
    }
    const midY = (this.fromPos.y + dest.y) / 2;
    arc = Math.min(arc, Math.max(0, topGround + FLIGHT_ARC_CLEAR - midY));
    if (hd < 300) arc = Math.min(arc, 0.35 * hd);
    this.flightArc = arc;
    this.flightDuration = this.reducedMotion
      ? 0
      : FLIGHT_T_MIN +
        (FLIGHT_T_MAX - FLIGHT_T_MIN) * clamp01(dist / FLIGHT_FAR) +
        FLIGHT_T_EXTRA * clamp01((dist - FLIGHT_FAR) / (FLIGHT_VERY_FAR - FLIGHT_FAR));
    this.mode = "flight";
    this.dirty = true;
    this.wake();
  }

  /** The telescope's axis, the rest pose's look (telAxis, telEndDir) from layout TELESCOPE. */
  private telescopeFrame() {
    const T = Layout.TELESCOPE;
    const dir = (az: number, el: number, out: THREE.Vector3) => {
      const a = (az * Math.PI) / 180;
      const e = (el * Math.PI) / 180;
      return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    };
    dir(T.az, T.el, this.telAxis);
    dir(T.az - TEL_PARK_LOOK_OFF[0], T.el - TEL_PARK_LOOK_OFF[1], this.telEndDir);
    const a = this.telAxis;
    this.telUp.set(-a.x * a.y, 1 - a.y * a.y, -a.z * a.y).normalize();
    this.telDip.copy(a).addScaledVector(this.telUp, -TEL_PARK_DIP).normalize();
  }

  /** A point `along` the telescope's axis from its pivot and `over` it,
   *  square to the axis (units). */
  private telPoint(along: number, over: number, out: THREE.Vector3): THREE.Vector3 {
    const T = Layout.TELESCOPE;
    return out.set(T.pivot[0], T.pivot[1], T.pivot[2]).addScaledVector(this.telAxis, along).addScaledVector(this.telUp, over);
  }

  private computeParkPose(anchorId: string) {
    const a = this.anchors.find((x) => x.id === anchorId);
    const full = a?.landmark ? this.landmarks.get(a.landmark) : undefined;
    const camera = this.camera;
    if (!a || !camera) return;
    this.parkDepth = this.depthFor(anchorId);
    this.parkFov = FOV;
    const pi = this.anchors.findIndex((x) => x.id === anchorId);
    this.parkTelescope = PLACES[this.anchorPlace[pi] ?? -1]?.id === TEL_PARK_PLACE;
    if (this.parkTelescope) {
      this.telescopeFrame();
      const end = TEL_PARK_PATH[TEL_PARK_PATH.length - 1];
      this.telPoint(end[0], end[1], this.parkPos);
      this.parkLook.copy(this.parkPos).addScaledVector(this.telEndDir, LOOK_DIST);
      this.parkDistance = LOOK_DIST;
      this.lastPark = null;
      return;
    }
    // Round 1: a hand placed click in view (layout PARK_VIEWS), where the
    // solver cannot frame what matters (a3: the lower falls and the pool).
    // The discount checkpoint is no place and has its own (checkpoint.ts).
    const authored = Layout.PARK_VIEWS[PLACES[this.anchorPlace[pi] ?? -1]?.id as Layout.PlaceId] ?? (anchorId === CHECKPOINT.id ? CHECKPOINT.park : undefined);
    if (authored) {
      const b = (authored.bearing * Math.PI) / 180;
      const p = (authored.pitch * Math.PI) / 180;
      this.parkPos.set(authored.x, authored.y, authored.z);
      this.parkFov = authored.fov ?? FOV;
      this.parkLook.set(Math.sin(b) * Math.cos(p), -Math.sin(p), -Math.cos(b) * Math.cos(p)).multiplyScalar(LOOK_DIST).add(this.parkPos);
      this.parkDistance = LOOK_DIST;
      this.lastPark = null;
      return;
    }
    if (!full) {
      this.railLookPose(this.depthFor(anchorId), this.parkPos, this.parkLook);
      this.parkDistance = LOOK_DIST;
      this.lastPark = null;
      return;
    }
    const lm = focusOf(full);
    this.rail.sample(this.depthFor(anchorId), this.railPose);
    const input: ParkInput = {
      landmark: lm,
      others: this.lmList.map((x) => (x === full ? lm : x)),
      railPos: this.railPose.position,
      railTarget: this.railPose.target,
      aspect: camera.aspect,
      widthPx: this.width,
      surface: parkSurface,
      occluders: this.occluders,
      sunDir: this.ctx?.sunDir ?? SUN_DIR,
      trees: this.trees,
    };
    const tall = lm.vis.max.y - lm.vis.min.y >= PARK_TALL_H;
    let r = solveParkPose(tall ? { ...input, heightMin: PARK_TALL_HEIGHT_MIN, heightMax: PARK_TALL_HEIGHT_MAX } : input);
    // A landmark its rail stop already shows at the top of the size band (the
    // Guild Hall, 322 from the a8 stop) was parked FURTHER out than the stop
    // (357): "zoom in" backed away. Such a park takes the tall band too.
    if (!tall && r.dist > r.railDist * PARK_MAX_BACKOFF) {
      r = solveParkPose({ ...input, heightMin: PARK_TALL_HEIGHT_MIN, heightMax: PARK_TALL_HEIGHT_MAX });
    }
    const pos = r.pos;
    const look = r.look;
    const g = parkSurface(pos.x, pos.z) + PARK_CLEARANCE;
    if (pos.y < g) {
      look.y += g - pos.y;
      pos.y = g;
    }
    this.parkPos.copy(pos);
    this.parkLook.copy(look);
    this.parkDistance = r.dist;
    this.lastPark = r;
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  private railLookPose(depth: number, outPos: THREE.Vector3, outLook: THREE.Vector3) {
    this.rail.sample(depth, this.railPose);
    outPos.copy(this.railPose.position);
    outLook.copy(this.railPose.target).sub(outPos);
    const l = outLook.length();
    if (l < 1e-6) outLook.set(0, 0, -LOOK_DIST);
    else outLook.multiplyScalar(LOOK_DIST / l);
    outLook.add(outPos);
  }

  private placeOnRail(depth: number) {
    this.railLookPose(depth, this.camPos, this.camLook);
    if (!this.hasPose) {
      this.prevPos.copy(this.camPos);
      this.prevLook.copy(this.camLook);
      this.hasPose = true;
    }
  }

  private updateCamera(dt: number) {
    if (this.mode === "rail") {
      this.flightNow = 1;
      this.placeOnRail(this.currentDepth);
      this.poseDepth = this.currentDepth;
      const o = this.poseOverride;
      if (o) {
        const br = (o.bearing * Math.PI) / 180;
        const pr = (o.pitch * Math.PI) / 180;
        this.camPos.set(o.x, o.y, o.z);
        this.camLook.set(o.x + Math.sin(br) * Math.cos(pr) * LOOK_DIST, o.y - Math.sin(pr) * LOOK_DIST, o.z - Math.cos(br) * Math.cos(pr) * LOOK_DIST);
      }
    } else if (this.mode === "parked") {
      this.flightNow = 1;
      this.camPos.copy(this.parkPos);
      this.camLook.copy(this.parkLook);
      this.poseDepth = this.parkDepth;
    } else if (this.flightTelescope && this.telCurve) {
      this.flightElapsed += dt;
      const T = this.flightDuration;
      const s = T <= 0 ? 1 : clamp01(this.flightElapsed / T);
      // Ease in and out (a smootherstep): the path starts and ends at rest.
      const q = s * s * s * (s * (s * 6 - 15) + 10);
      this.flightNow = q;
      const uRaw = this.flightToRail ? 1 - q : q;
      const u = uRaw >= 0 && uRaw <= 1 ? uRaw : uRaw > 1 ? 1 : 0;
      this.telCurve.getPointAt(u, this.camPos);
      // The look: the rail's, turning onto the axis dipped toward the tube over
      // the first 30% of the path, held along the tube, then up onto the rest
      // pose's look (the constellation) between 55% and 85%.
      const w1 = smoothstep01(u / 0.3);
      const w2 = smoothstep01((u - 0.55) / 0.3);
      this.v3.copy(this.telDir0).lerp(this.telDip, w1).lerp(this.telEndDir, w2).normalize();
      this.camLook.copy(this.camPos).addScaledVector(this.v3, LOOK_DIST);
      const sa = this.rail.sOfDepth(this.flightFromDepth);
      const toDepth = this.flightToRail ? this.currentDepth : this.flightToDepth;
      this.poseDepth = this.rail.depthOfS(sa + (this.rail.sOfDepth(toDepth) - sa) * q);
      this.parkProgress = this.progFrom + (this.progTo - this.progFrom) * q;
      if (s >= 1) {
        this.flightTelescope = false;
        this.telCurve = null;
        if (this.flightToRail) {
          this.mode = "rail";
          this.parkProgress = 0;
          this.parkTelescope = false;
          this.placeOnRail(this.currentDepth);
          this.poseDepth = this.currentDepth;
        } else {
          this.mode = "parked";
          this.parkProgress = 1;
          this.camPos.copy(this.parkPos);
          this.camLook.copy(this.parkLook);
          this.poseDepth = this.parkDepth;
        }
        this.flightNow = 1;
      }
    } else {
      this.flightElapsed += dt;
      const T = this.flightDuration;
      const s = T <= 0 ? 1 : clamp01(this.flightElapsed / T);
      if (this.flightToRail) this.railLookPose(this.currentDepth, this.v1, this.v2);
      const toPos = this.flightToRail ? this.v1 : this.parkPos;
      const toLook = this.flightToRail ? this.v2 : this.parkLook;
      flightPoint(this.camPos, this.fromPos, this.v0Pos, toPos, s, T);
      flightPoint(this.camLook, this.fromLook, this.v0Look, toLook, s, T);
      const q = flightEase(s);
      this.flightNow = q;
      {
        const toDepth = this.flightToRail ? this.currentDepth : this.flightToDepth;
        const sa = this.rail.sOfDepth(this.flightFromDepth);
        this.poseDepth = this.rail.depthOfS(sa + (this.rail.sOfDepth(toDepth) - sa) * q);
      }
      if (this.flightArc > 0) {
        // Zero rate at both ends (q has zero slope there), so it adds no snap.
        const lift = this.flightArc * Math.sin(Math.PI * q);
        this.camPos.y += lift;
        this.camLook.y += lift;
      }
      this.parkProgress = this.switchDip
        ? 1 - PARK_SWITCH_DIP * Math.sin(Math.PI * q)
        : this.progFrom + (this.progTo - this.progFrom) * q;
      if (s < 1) {
        const g = terrainHeight(this.camPos.x, this.camPos.z) + PARK_CLEARANCE;
        const y = smoothMax(this.camPos.y, g, 20);
        this.camLook.y += y - this.camPos.y;
        this.camPos.y = y;
      }
      if (s >= 1) {
        if (this.flightToRail) {
          this.mode = "rail";
          this.parkProgress = 0;
          this.placeOnRail(this.currentDepth);
          this.poseDepth = this.currentDepth;
        } else {
          this.mode = "parked";
          this.parkProgress = 1;
          this.poseDepth = this.parkDepth;
        }
        this.switchDip = false;
        this.flightNow = 1;
      }
    }

    if (dt > 0) {
      this.velPos.copy(this.camPos).sub(this.prevPos).divideScalar(dt);
      this.velLook.copy(this.camLook).sub(this.prevLook).divideScalar(dt);
    }
    this.prevPos.copy(this.camPos);
    this.prevLook.copy(this.camLook);

    const camera = this.camera!;
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
    camera.updateMatrixWorld();
    // Detail pass 3 (sky): the rail's lens (layout STOP_FOV, eased round its stops); FOV when parked.
    const railFov = this.rail.fovAtS(this.rail.sOfDepth(this.poseDepth));
    const fov =
      this.poseOverride?.fov ??
      (this.parkTelescope
        ? railFov + (TEL_PARK_FOV - railFov) * smoothstep01((this.parkProgress - 0.45) / 0.55)
        : this.parkFov + (railFov - this.parkFov) * (1 - this.parkProgress));
    if (Math.abs(camera.fov - fov) > 1e-4) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  private updateFog() {
    const sf = this.scene?.fog as THREE.Fog | null | undefined;
    const fog = sf && (sf as THREE.Fog).isFog ? sf : null;
    if (!fog) return;
    // The light key's ramp (v5); the light module leaves the distances to us.
    const light = this.scene?.userData.light as { state?: { fogNear: number; fogFar: number }; fogDistances?: boolean } | undefined;
    if (light?.state && Number.isFinite(light.state.fogNear) && light.state.fogFar > light.state.fogNear) {
      light.fogDistances = false;
      this.fogRange.near = light.state.fogNear;
      this.fogRange.far = light.state.fogFar;
    } else {
      this.fogRange.near = FOG_DEFAULT_NEAR;
      this.fogRange.far = FOG_DEFAULT_FAR;
    }
    let near = this.fogRange.near;
    let far = this.fogRange.far;
    const p = this.parkProgress;
    if (p > 0) {
      const pushed = Math.max(near, this.parkDistance * 1.15 + 40);
      const span = far - near;
      near += (pushed - near) * p;
      far = near + span;
    }
    fog.near = near;
    fog.far = far;
    const camera = this.camera;
    if (camera) {
      const f = Math.min(FAR, Math.max(FAR_MIN, far * FAR_PER_RAMP));
      if (Math.abs(camera.far - f) > 0.5) {
        camera.far = f;
        camera.updateProjectionMatrix();
      }
    }
  }

  private projectLandmarkRects() {
    const camera = this.camera!;
    const w = this.width;
    const h = this.height;
    const p = this.v3;
    const r = this.lmRects;
    for (let k = 0; k < this.lmList.length && k < 64; k++) {
      const b = this.lmList[k].vis;
      let l = Infinity;
      let t = Infinity;
      let rr = -Infinity;
      let bb = -Infinity;
      for (let i = 0; i < 8; i++) {
        p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
        p.applyMatrix4(camera.matrixWorldInverse);
        if (p.z > -camera.near) continue;
        p.applyMatrix4(camera.projectionMatrix);
        const x = (p.x * 0.5 + 0.5) * w;
        const y = (-p.y * 0.5 + 0.5) * h;
        if (x < l) l = x;
        if (x > rr) rr = x;
        if (y < t) t = y;
        if (y > bb) bb = y;
      }
      const o = k * 5;
      r[o] = l;
      r[o + 1] = t;
      r[o + 2] = rr;
      r[o + 3] = bb;
      r[o + 4] = this.lmList[k].center.distanceTo(this.camPos);
    }
  }

  private projectMarkers() {
    const camera = this.camera!;
    const w = this.width;
    const h = this.height;
    const sf = this.scene?.fog as THREE.Fog | null | undefined;
    const fogFar = sf && sf.isFog ? sf.far : 6000;
    const p = this.v3;
    this.projectLandmarkRects();
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i];
      const at = this.anchorPos[i];
      if (!at) {
        m.visible = false;
        continue;
      }
      const lm = this.anchorLm[i];
      // Final pass: a body-anchored landmark (the Trail Hut) pins over its
      // roof's middle; the box's top corners are its chimney's height, so from
      // above (the a4 click in) the pin sat ~120 px over the hut, in the smoke.
      const body = !!lm && this.anchorBody[i] === true;
      p.copy(at);
      if (lm && !body) p.set(lm.visCenter.x, lm.vis.max.y, lm.visCenter.z);
      p.applyMatrix4(camera.matrixWorldInverse);
      const ahead = p.z < -camera.near;
      const distance = lm ? lm.center.distanceTo(this.camPos) : at.distanceTo(this.camPos);
      p.applyMatrix4(camera.projectionMatrix);
      const x = (p.x * 0.5 + 0.5) * w;
      let top = (-p.y * 0.5 + 0.5) * h;
      if (lm && ahead && !body) {
        const b = lm.vis;
        for (let c = 0; c < 4; c++) {
          p.set(c & 1 ? b.max.x : b.min.x, b.max.y, c & 2 ? b.max.z : b.min.z);
          p.applyMatrix4(camera.matrixWorldInverse);
          if (p.z > -camera.near) continue;
          p.applyMatrix4(camera.projectionMatrix);
          const y = (-p.y * 0.5 + 0.5) * h;
          if (y < top) top = y;
        }
      }
      let y = top - MARKER_LIFT_PX;
      if (lm && this.pinOnLandmarkBehind(lm, x, y, distance)) y = top - MARKER_LIFT_MIN_PX;
      if (lm && ahead && y < MARKER_EDGE_PX) {
        p.set(lm.visCenter.x, lm.vis.min.y, lm.visCenter.z).applyMatrix4(camera.matrixWorldInverse);
        if (p.z < -camera.near) {
          p.applyMatrix4(camera.projectionMatrix);
          if ((-p.y * 0.5 + 0.5) * h > MARKER_EDGE_PX + 40) y = MARKER_EDGE_PX;
        }
      }
      m.x = x;
      m.y = y;
      m.visible = ahead && x >= 0 && x <= w && y >= 0 && y <= h;
      // Round 1: the landmark's surface samples on screen. A place whose top
      // has left the frame (the Great Tree as you walk in) or whose middle is
      // past an edge still counts as on screen while MARKER_PART_PX of it is
      // in the frame; the page's labels slide into that part.
      this.projectSamplesRect(lm, m);
      const rl = m.rl!;
      const rr = m.rr!;
      const rt = m.rt!;
      const rb = m.rb!;
      // Final pass B integrate (judge: pins floated 45 px over the a1 flag and
      // 85 px over the telescope's tip, lifted by the box's near top corners):
      // the pin sits at most PIN_OVER_TOP_PX over the highest sample on screen.
      if (m.visible && ahead && !body && Number.isFinite(rt) && rt - PIN_OVER_TOP_PX <= h && m.y < rt - PIN_OVER_TOP_PX) m.y = rt - PIN_OVER_TOP_PX;
      if (!m.visible && rl < w - MARKER_PART_PX && rr > MARKER_PART_PX && rt < h - MARKER_PART_PX && rb > MARKER_PART_PX) {
        m.visible = true;
        if (!ahead) {
          m.x = (Math.max(rl, 0) + Math.min(rr, w)) / 2;
          m.y = rt - MARKER_LIFT_PX;
        }
      }
      // V4's places sit behind ridges and rims, unlike V3's single valley:
      // no marker for a landmark the terrain hides, top and middle (it would
      // also give away where the Sky Island is before the Mirror Lake). The
      // middle counts because the falls' top sits on the lip itself.
      if (
        m.visible &&
        lm &&
        this.terrainHides(lm.visCenter.x, lm.vis.max.y, lm.visCenter.z) &&
        this.terrainHides(lm.visCenter.x, lm.visCenter.y, lm.visCenter.z)
      )
        m.visible = false;
      // Round 1 verify: before the flight the Gate isle is hidden by the
      // Gate's cloud bank (dress-sky GATE_BANK, v6-route N9), which
      // terrainHides cannot see, so the Job Board's label floated over the
      // bank as you came onto the Sky Island and gave the final island away.
      // Its marker waits for the flight, as the isle does.
      if (m.visible && this.anchorPlace[i] === GATE_PLACE && this.currentS < this.rail.flightS[0]) m.visible = false;
      m.proximity = clamp01(1 - (distance - 300) / Math.max(1, fogFar - 300));
    }
  }

  /** Round 1: the box of a landmark's surface samples on screen, into m.rl..rb (NaN when none is in front). */
  private projectSamplesRect(lm: Landmark | null, m: ProjectedMarker) {
    let l = Infinity;
    let t = Infinity;
    let r = -Infinity;
    let b = -Infinity;
    const camera = this.camera;
    if (lm && camera) {
      const e = this.markerMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
      const s = lm.samples;
      const w = this.width;
      const h = this.height;
      const near = camera.near;
      for (let i = 0; i + 2 < s.length; i += 3) {
        const sx = s[i];
        const sy = s[i + 1];
        const sz = s[i + 2];
        // Perspective: clip w is the distance in front of the camera.
        const cw = e[3] * sx + e[7] * sy + e[11] * sz + e[15];
        if (cw <= near) continue;
        const px = ((e[0] * sx + e[4] * sy + e[8] * sz + e[12]) / cw) * 0.5 * w + 0.5 * w;
        const py = 0.5 * h - ((e[1] * sx + e[5] * sy + e[9] * sz + e[13]) / cw) * 0.5 * h;
        if (px < l) l = px;
        if (px > r) r = px;
        if (py < t) t = py;
        if (py > b) b = py;
      }
    }
    const none = l === Infinity;
    m.rl = none ? NaN : l;
    m.rt = none ? NaN : t;
    m.rr = none ? NaN : r;
    m.rb = none ? NaN : b;
  }

  // ── Picking (round 1 UI) ───────────────────────────────────────────────────

  /**
   * Which place's landmark is under a point (CSS px within the container), or
   * null. The page calls it on pointer events only, never per frame. Only a
   * place whose marker is showing can be picked, so nothing the terrain hides
   * and nothing past the frame. A ray through the landmark's own meshes
   * counts; so does its box while the landmark is under PICK_SMALL_PX on
   * screen (a far signpost is a few pixels of poles). The nearest hit wins,
   * and a hit the ground stands in front of does not count.
   */
  pickAnchor(x: number, y: number): string | null {
    const camera = this.camera;
    if (!camera || !this.ready || this.mode !== "rail" || this.width <= 0 || this.height <= 0) return null;
    const ray = this.pickRay;
    this.pickNdc.set((x / this.width) * 2 - 1, 1 - (y / this.height) * 2);
    ray.setFromCamera(this.pickNdc, camera);
    const hits = this.pickHits;
    const at = this.v4;
    let best = Infinity;
    let bestId: string | null = null;
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i];
      const lm = this.anchorLm[i];
      const name = this.anchors[i]?.landmark;
      if (!m.visible || !lm || !name) continue;
      // Final pass C: a proxy box (the keeper's cabin at Base Camp) counts as the landmark's own.
      let d = Infinity;
      for (const box of clickProxies(name, lm)) if (ray.ray.intersectBox(box, at)) d = Math.min(d, at.distanceTo(ray.ray.origin));
      if (d === Infinity && !ray.ray.intersectBox(lm.box, at)) continue;
      const meshes = this.lmMeshes.get(name);
      if (meshes) {
        for (const mesh of meshes) {
          if (!isShown(mesh)) continue;
          hits.length = 0;
          mesh.raycast(ray, hits);
          for (const hit of hits) if (hit.distance < d) d = hit.distance;
        }
      }
      if (d === Infinity) {
        const small = (m.rr ?? 0) - (m.rl ?? 0) < PICK_SMALL_PX && (m.rb ?? 0) - (m.rt ?? 0) < PICK_SMALL_PX;
        if (!small || !ray.ray.intersectBox(lm.vis, at)) continue;
        d = at.distanceTo(ray.ray.origin);
      }
      if (d >= best) continue;
      ray.ray.at(d, at);
      if (this.terrainHides(at.x, at.y, at.z)) continue;
      best = d;
      bestId = this.anchors[i].id;
    }
    hits.length = 0;
    if (!this.liftWarm) this.warmHoverLift();
    return bestId;
  }

  /**
   * Round 1: light the landmark under the pointer a little (anchor id, or
   * null). Its opaque meshes are drawn once more with a faint additive warm
   * material, only while it is hovered: a few extra draws in the same pass,
   * nothing while nothing is hovered, and the scene's own materials (shared
   * with the rest of the world) are never touched. Water, glass, glows and
   * card crowns are left alone (their shaders move or cut their geometry).
   */
  setHoverAnchor(id: string | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    for (const o of this.hoverLift) o.removeFromParent();
    this.hoverLift.length = 0;
    const i = id ? this.anchors.findIndex((a) => a.id === id) : -1;
    const name = i >= 0 ? this.anchors[i].landmark : null;
    const meshes = name ? this.lmMeshes.get(name) : undefined;
    if (meshes) {
      for (const src of meshes) {
        const mat = src.material;
        if (Array.isArray(mat) || !isShown(src)) continue;
        if ((mat as THREE.ShaderMaterial).isShaderMaterial || (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) continue;
        if (mat.transparent || mat.alphaTest > 0 || !mat.depthWrite) continue;
        let lift = this.liftCache.get(src);
        if (!lift) {
          lift = new THREE.Mesh(src.geometry, this.liftMaterial(mat.side));
          lift.name = "HoverLift";
          lift.matrixAutoUpdate = false;
          lift.renderOrder = src.renderOrder;
          lift.frustumCulled = src.frustumCulled;
          this.liftCache.set(src, lift);
        }
        src.add(lift);
        lift.updateMatrixWorld(true);
        this.hoverLift.push(lift);
      }
    }
    this.dirty = true;
    this.wake();
  }

  private liftMaterial(side: THREE.Side): THREE.MeshBasicMaterial {
    let m = this.liftMats.get(side);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color: HOVER_LIFT_COLOR,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        // The same geometry through the same transform lands on the same depth:
        // LessEqual passes it exactly where the landmark is the nearest thing. A
        // polygon offset let thin blocks' back faces through in stripes.
        depthFunc: THREE.LessEqualDepth,
        fog: false,
        toneMapped: false,
        side,
      });
      m.name = "HoverLift";
      this.liftMats.set(side, m);
    }
    return m;
  }

  /** Compile the lift's program off the main thread the first time the pointer looks, so the first hover has no hitch. */
  private warmHoverLift() {
    this.liftWarm = true;
    const renderer = this.renderer;
    const camera = this.camera;
    const scene = this.scene;
    if (!renderer || !camera || !scene) return;
    const probe = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.liftMaterial(THREE.FrontSide));
    const probe2 = new THREE.Mesh(probe.geometry, this.liftMaterial(THREE.DoubleSide));
    probe.add(probe2);
    renderer
      .compileAsync(probe, camera, scene)
      .catch(() => {})
      .finally(() => probe.geometry.dispose());
  }

  /** True when the ground rises above the straight line from the camera to (x, y, z). */
  private terrainHides(x: number, y: number, z: number): boolean {
    const c = this.camPos;
    const dx = x - c.x;
    const dy = y - c.y;
    const dz = z - c.z;
    // Ridges here are hundreds of units wide, so 80-unit steps cannot miss one.
    const n = Math.min(64, Math.max(6, Math.ceil(Math.hypot(dx, dz) / 80)));
    for (let i = 1; i < n; i++) {
      // Stop short of the landmark: its own footing is on the ground.
      const f = (i / n) * 0.96;
      if (terrainHeight(c.x + dx * f, c.z + dz * f) > c.y + dy * f + 2) return true;
    }
    return false;
  }

  private pinOnLandmarkBehind(own: Landmark, x: number, y: number, dist: number): boolean {
    const r = this.lmRects;
    const ownK = this.lmList.indexOf(own);
    if (ownK < 0 || ownK >= 64 || r[ownK * 5 + 3] - r[ownK * 5 + 1] >= MARKER_SMALL_PX) return false;
    for (let k = 0; k < this.lmList.length && k < 64; k++) {
      if (k === ownK) continue;
      const o = k * 5;
      if (r[o + 4] <= dist) continue;
      if (x >= r[o] && x <= r[o + 2] && y >= r[o + 1] && y <= r[o + 3]) return true;
    }
    return false;
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  onFrame(cb: ((f: WorldFrame) => void) | null): void {
    this.frameCb = cb;
    this.dirty = true;
    this.wake();
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.wake();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.wake();
  }

  private wake() {
    this.dirty = true;
    if (this.animTimer !== null) {
      clearTimeout(this.animTimer);
      this.animTimer = null;
    }
    if (this.disposed || !this.started || this.raf || this.inTick) return;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private scheduleAnimFrame() {
    if (this.animTimer !== null || this.raf || this.disposed) return;
    // v6 idle ladder (world_art_bible_v6.md 3.1 "Idle"): the tier's ambient rate
    // for 10 s after input, 15 fps to 45 s, then nothing until the next input.
    const wait = this.idle.waitMs(performance.now(), this.lastTime, this.quality.ambientFps);
    if (wait < 0) return;
    this.animTimer = setTimeout(() => {
      this.animTimer = null;
      if (this.disposed || this.raf) return;
      this.raf = requestAnimationFrame(this.tick);
    }, Math.max(0, wait - 2));
  }


  private updateModules(dt: number): boolean {
    this.sceneTime += dt;
    let animating = false;
    // Fix round 2 (judge 2): how far into the telescope park the camera is
    // (0 on the rail, 1 parked), so nightsky.ts draws the aimed constellation's
    // faint lines only through the telescope, never at the a7 rail frame.
    if (this.scene) this.scene.userData.telescopeK = this.parkTelescope ? this.parkProgress : 0;
    for (const rec of this.modules) {
      if (rec.broken) continue;
      const m = rec.module;
      try {
        if (m.update && m.update(this.sceneTime, dt)) animating = true;
        if (m.isAnimating && m.isAnimating()) animating = true;
      } catch (e) {
        rec.broken = true;
        console.error(`[world-v6] module ${rec.name} update threw; it is no longer updated`, e);
      }
    }
    return animating;
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    if (this.paused || this.contextLost || document.hidden) return;
    this.inTick = true;
    try {
      this.tickBody(now);
    } finally {
      this.inTick = false;
    }
  };

  private tickBody(now: number) {
    // Cheap laptops (adapt2): the GPU still owes 2 frames. Skip this display
    // frame whole (camera, labels and 3D stay in step, and the next frame's
    // interval spans the skip, so the governor sees the GPU's real rate).
    if (this.pacer && this.ready && !this.pacer.ready(now)) {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }

    const intervalMs = now - this.lastTime;
    let dt = intervalMs / 1000;
    dt = dt < 0 ? 0 : dt > MAX_DT ? MAX_DT : dt;
    this.lastTime = now;

    const scrollLocked = this.parkedId !== null;
    if (!scrollLocked) this.targetDepth = this.readScrollDepth(this.targetDepth);
    if (this.targetDepth > this.depthMax) this.targetDepth = this.depthMax;
    if (this.reducedMotion) this.currentDepth = this.targetDepth;
    this.currentDepth += (this.targetDepth - this.currentDepth) * (1 - Math.exp(-SMOOTHING * dt));
    const converged = Math.abs(this.targetDepth - this.currentDepth) < DEPTH_EPS;
    if (converged) this.currentDepth = this.targetDepth;
    this.currentS = this.rail.sOfDepth(this.currentDepth);

    if (this.parkPending && this.ready && this.parkedId) {
      this.parkPending = false;
      this.beginPark(this.parkedId);
    }

    this.updateCamera(dt);
    this.updateShipStandIn();
    // Cheap laptops: once the posters cover the 3D, nothing is animated or drawn.
    const drawing = this.drawing(now);
    const animating = this.ready && drawing && this.updateModules(dt) && !this.reducedMotion;
    // After the modules: the light has blended this frame's key (v5 fog ramp).
    if (drawing) this.updateFog();

    const renderer = this.renderer;
    // v6 governor (world_art_bible_v6.md 3.2): learns from moving frames, applies
    // a step when the camera rests (or at once over 33 ms), never during a park.
    // Adapt2: decided before this frame's render, so a new pixel ratio or tier
    // is drawn by the one render below (it used to draw the frame a second time).
    const movingNow = !converged || this.mode === "flight" || this.parkPending;
    // Final pass: frames of a programmatic travel (a long glide behind the
    // scroll, a jump, a park flight) and GOV_TRAVEL_HOLD_MS after it never
    // count toward a step: they sweep through places still uploading.
    if (this.governor) {
      const totalVh = this.rail.totalVh();
      const gapVh = Math.abs(this.targetDepth - this.currentDepth) * totalVh;
      const stepVh = Number.isFinite(this.govLastDepth) ? Math.abs(this.currentDepth - this.govLastDepth) * totalVh : 0;
      if (this.mode === "flight" || this.parkPending || gapVh > GOV_TRAVEL_GAP_VH || stepVh > GOV_TRAVEL_STEP_VH) this.governor.hold(now + GOV_TRAVEL_HOLD_MS);
    }
    this.govLastDepth = this.currentDepth;
    if (this.governor && this.tierOverride === null && this.ready && !this.posterReason) {
      const act = this.governor.sample(intervalMs, now, movingNow, this.mode === "flight" || this.parkPending);
      if (act?.poster) {
        this.posterAsk = { reason: act.reason, at: now };
      } else if (act) {
        this.applyQuality(act.tier, "governor: " + act.reason, act.pixelRatio);
        rememberTier(act.tier);
        // The route disagreed with this tier: no more climbs this session.
        if (act.direction === "down") this.restCheck.armed = false;
      }
    }
    // Adapt3: the governor's poster ask, answered at rest once the GPU has
    // finished the frames it owes (no render is queued while it waits, so the
    // wait is at most two frames), or dropped when the camera moves again.
    let holdRender = false;
    if (this.posterAsk) {
      if (movingNow || !drawing || !this.ready || this.posterReason || this.tierOverride !== null) {
        this.posterAsk = null;
        this.governor?.posterPostpone(now);
      } else if (!this.pacer || this.pacer.inFlight() === 0 || now - this.posterAsk.at > POSTER_ASK_DRAIN_MS) {
        const ask = this.posterAsk;
        this.posterAsk = null;
        this.governorPoster(ask.reason, now, Math.round(now - ask.at));
      } else {
        holdRender = true;
        this.dirty = true;
      }
    }
    // The rest check: a low tier climbs one step when a burst at rest shows clear headroom.
    if (!holdRender && !movingNow && drawing && this.ready && this.restCheck.armed && this.governor && this.restCheckTick(now)) {
      this.dirty = true;
    }
    // While the ask waits nothing is rendered: the last frame stays on the canvas.
    if (!holdRender && this.ready && renderer && this.scene && this.camera && drawing) {
      if (renderer.domElement.style.visibility) renderer.domElement.style.visibility = "";
      renderer.render(this.scene, this.camera);
      this.pacer?.submitted();
      this.frame.triangles = renderer.info.render.triangles;
      this.frame.calls = renderer.info.render.calls;
    } else if (renderer && !drawing && renderer.domElement.style.visibility !== "hidden") {
      renderer.domElement.style.visibility = "hidden";
      this.frame.triangles = 0;
      this.frame.calls = 0;
    }
    this.projectMarkers();
    this.frame.depth = this.currentDepth;
    this.frame.railU = this.railU();
    this.frame.place = this.placeCoord();
    this.frame.tail = Math.min(1, Math.max(0, this.frame.place - (PLACES.length - 1)));
    this.frame.parkedId = this.parkedId;
    this.frame.parkProgress = this.parkProgress;
    this.frame.flight = this.flightNow;
    this.frame.maxDepth = this.depthMax;
    this.frameCb?.(this.frame);

    const moving = !converged || this.mode === "flight" || this.parkPending;
    // Keep drawing through the posters' crossfade, then stop.
    if (this.posterReason && !this.headless && drawing && !this.raf) {
      this.dirty = true;
    }
    if (!moving && !this.dirty) {
      this.velPos.set(0, 0, 0);
      this.velLook.set(0, 0, 0);
      if (animating) this.scheduleAnimFrame();
      return;
    }
    this.dirty = false;
    this.raf = requestAnimationFrame(this.tick);
  }

  // ── Harness ────────────────────────────────────────────────────────────────

  /** v6 harness: layers shaded per pixel at the camera as the last frame posed it (perf.measureOverdraw). */
  measureOverdraw(opts?: OverdrawOptions): OverdrawResult | null {
    if (!this.ready || !this.renderer || !this.scene || !this.camera) return null;
    return measureOverdraw(this.renderer, this.scene, this.camera, opts);
  }

  /** v6 harness: GPU ms per frame at the current pose (perf.burstProbe). */
  burstProbe(renders = 8, repeats = 5, warmMs = 250, maxMs = 0) {
    if (!this.ready || !this.renderer || !this.scene || !this.camera) return null;
    return burstProbe(this.renderer, this.scene, this.camera, { renders, repeats, warmMs, maxMs });
  }

  /**
   * The rest check's burst (restCheckTick), also the harness's. Adapt3: 120 ms
   * at most (it was 200), and it stops after the warm frame when that frame
   * alone is over REST_CHECK_STOP_MS, so a slow GPU is held for two frames.
   */
  restCheckProbe(): BurstResult | null {
    if (!this.ready || !this.renderer || !this.scene || !this.camera) return null;
    // A fast warm frame (under 12 ms) gets 200 ms, the pre-adapt3 budget: 120 ms read the M2 about 2x high at tier 2 and it never climbed back.
    return burstProbe(this.renderer, this.scene, this.camera, { maxMs: POSTER_RULES.restBurstMs, stopOverMs: REST_CHECK_STOP_MS, fastUnderMs: 12, fastMaxMs: 200 });
  }

  /** Adapt3 harness: the governor's confirm measurement at the current pose (perf.quickProbe). */
  quickProbe(budgetMs: number = POSTER_RULES.restBurstMs) {
    if (!this.ready || !this.renderer || !this.scene || !this.camera) return null;
    return quickProbe(this.renderer, this.scene, this.camera, budgetMs);
  }

  /** v6: the tier, the governor, the idle ladder, the load report and the footprints. */
  qualityInfo(): Record<string, unknown> {
    const now = performance.now();
    return {
      quality: this.quality,
      override: this.tierOverride,
      pixelRatio: this.renderer?.getPixelRatio() ?? null,
      governor: this.governor?.state() ?? null,
      idle: { phase: this.idle.phase(now), idleMs: Math.round(this.idle.idleFor(now)) },
      report: { ...this.qualityReport },
      footprints: footprintStats(),
      poster: this.posterState(),
      programs: this.renderer?.info.programs?.length ?? 0,
      pacer: this.pacer ? { skipped: this.pacer.skipped, peak: this.pacer.peak, forced: this.pacer.forced } : null,
    };
  }

  /** v6 tuning panel: force a tier (0..3), or null for automatic. MSAA stays as the canvas was made. */
  setQualityTier(tier: number | null): void {
    this.tierOverride = tier === null ? null : Math.max(0, Math.min(3, Math.round(tier)));
    const t = this.tierOverride ?? this.governor?.state().tier ?? this.quality.tier;
    this.applyQuality(t, tier === null ? "override cleared" : "tuning panel override");
    this.governor?.reset(t, this.renderer?.getPixelRatio() ?? 1, performance.now());
  }

  /**
   * The page's view of the content tier (0 full .. 3 rescue): called once now
   * and again on every change. The interface drops its translucent surfaces
   * at tiers 2 and 3 (world-v6 progress UI, 2026-09-28). Returns the unsubscribe.
   */
  onQualityTier(cb: (tier: number) => void): () => void {
    const f = (t: QualityTier) => cb(t.tier);
    this.qualityCbs.add(f);
    cb(this.quality.tier);
    return () => {
      this.qualityCbs.delete(f);
    };
  }

  /** The raw scene graph. For the render harness only. */
  debugScene(): THREE.Scene | null {
    return this.scene;
  }

  /** Camera position and unit forward direction, plus where it is on the route. */
  cameraPose(): { x: number; y: number; z: number; dx: number; dy: number; dz: number; depth: number; railU: number; place: number; pitch: number } {
    const d = this.v1.copy(this.camLook).sub(this.camPos).normalize();
    return {
      x: this.camPos.x,
      y: this.camPos.y,
      z: this.camPos.z,
      dx: d.x,
      dy: d.y,
      dz: d.z,
      depth: this.currentDepth,
      railU: this.railU(),
      place: this.placeCoord(),
      pitch: (-Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI,
    };
  }

  /** Your airship where the rail has it now (see ctx.shipPose). For the harness. */
  shipPose(): ShipPose {
    return { ...this.rail.shipAtS(this.currentS, this.shipScratch) };
  }

  /** The rail itself (read-only use). For the harness and the tuning panel. */
  /** Dev harness: pin the camera to a pose on the rail (layout KEYS units:
   *  compass bearing, pitch below the horizon, vertical fov), the light and
   *  modules still keyed to the seeded depth; null releases it. */
  debugPose(p: { x: number; y: number; z: number; bearing: number; pitch: number; fov?: number } | null): void {
    this.poseOverride = p;
    this.dirty = true;
    this.wake();
  }

  debugRail(): Rail {
    return this.rail;
  }

  parkInfo(): Record<string, number | boolean> | null {
    const r = this.lastPark;
    return r
      ? {
          dist: r.dist,
          railDist: r.railDist,
          pitch: r.pitch,
          yaw: r.yaw,
          visible: r.visible,
          score: r.score,
          heightFrac: r.heightFrac,
          backlit: r.backlit,
          blockedLow: r.blockedLow,
          touching: r.touching,
        }
      : null;
  }

  /** Install time or failure per module, each module's stats(), and the stand-ins used. */
  moduleStats(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      install: { ...this.moduleReport },
      standIns: this.standIns.slice(),
      quality: this.qualityInfo(),
    };
    for (const rec of this.modules) {
      try {
        out[rec.name] = rec.module.stats ? rec.module.stats() : {};
      } catch (e) {
        out[rec.name] = `stats threw: ${String(e)}`;
      }
    }
    return out;
  }

  // ── Teardown ───────────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.animTimer !== null) clearTimeout(this.animTimer);
    this.animTimer = null;
    this.frameCb = null;
    for (const rec of this.modules) {
      try {
        rec.module.dispose();
      } catch (e) {
        console.error(`[world-v6] module ${rec.name} dispose threw`, e);
      }
    }
    this.modules.length = 0;
    // Round 1 UI: the hover lift's two materials (the meshes share the landmarks' geometry).
    for (const o of this.hoverLift) o.removeFromParent();
    this.hoverLift.length = 0;
    this.liftCache.clear();
    for (const m of this.liftMats.values()) m.dispose();
    this.liftMats.clear();
    const w = typeof window !== "undefined" ? (window as unknown as { __worldV6Debug?: WorldScene }) : null;
    if (w && w.__worldV6Debug === this) delete w.__worldV6Debug;
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("scroll", this.onScroll);
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const ev of ["pointermove", "pointerdown", "wheel", "keydown", "touchstart"] as const) {
      window.removeEventListener(ev, this.onInput);
    }
    this.qualityCbs.clear();
    this.posterCbs.clear();
    this.offerCbs.clear();
    this.pacer?.clear();
    this.gpuLoad?.dispose();
    this.gpuLoad = null;
    this.motionQuery?.removeEventListener?.("change", this.onMotionChange);
    this.resizeObserver?.disconnect();
    this.bodyObserver?.disconnect();
    this.resizeObserver = null;
    this.bodyObserver = null;
    this.spacerEl = null;

    this.scene?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        for (const value of Object.values(m)) {
          if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
        }
        m.dispose();
      }
    });
    this.scene?.clear();
    const canvas = this.renderer?.domElement;
    canvas?.removeEventListener("webglcontextlost", this.onContextLost);
    canvas?.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.fog = null;
    this.worldRoot = null;
  }
}
