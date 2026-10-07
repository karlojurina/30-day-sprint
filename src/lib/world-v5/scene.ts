import * as THREE from "three";
import { createRail, type Rail, type RailPose } from "./rail";
import * as Layout from "./layout";
import { PLACES, STEPS, WORLD, ISLAND_DEPTH, BOUNTY_DEPTH, HARBOUR_DEPTH, SHIP, fallsCurtainAt, CAVE, SHAFT } from "./layout";
import { buildTerrainGeometry, terrainHeight } from "./terrain";
import type { InstallFn, LandmarkBase, LockMode, LockState, ModuleSpec, ShipPose, WorldCtx, WorldModule } from "./modules";

/**
 * The world-v5 scene: the grey version of the V4 map. V3's camera, park,
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
 *   - Grey pass 3, the mine: the terrain MESH is cut open at the mine's two
 *     portals (layout CAVE, SHAFT): the cave's mouth in the falls patch and
 *     the shaft's collar cell in the main grid. terrainHeight is unchanged.
 *     a3 and a4 are underground (RAIL_PARK): their park is the rail's own
 *     stop pose, and a flight to or from it does not arc up through the rock.
 *     setPacing takes the flight's budget as a 10th value or as flightVh.
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
/** Retina at 3x melts laptops. V3's cap. */
const MAX_PIXEL_RATIO = 1.5;
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
 * (world-tests/v5-lockpeek.mjs), so no stopping point shows "what's next"
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
const LOCK_PEEK_UNITS: readonly number[] = [380, 900, 75, 110, 457, 607, 780];
/**
 * Grey pass 3: places whose stop is underground (the cave, the mine). Their
 * park is the rail's own stop pose (the park solver stands on the terrain
 * surface, which is rock above them), and a flight to or from it does not
 * arc (the arc clears the ground under a straight line, which here would lift
 * the camera up through the cliff).
 */
const RAIL_PARK: readonly string[] = ["a3", "a4"];

/**
 * Detail pass 3: the outside world is not drawn while the camera is inside the
 * mountain (the cave, the tunnel, the shaft). Measured 2026-09-26 by hiding
 * each group alone at keys 21 to 36.5: every group here drew 0 pixels, while
 * the terrain alone is 170k triangles in every one of those frames, and the
 * shaft top (key 36.5) drew 533k with the Mirror Lake's reflection pass.
 * Underground = the camera stands UNDER_MARGIN or more below the terrain
 * surface (on the rail that is keys 21.1 to 36.53 and nowhere else; the park
 * and arc flights keep the camera above ground), and the cave mouth is not in
 * view: the a3 stop looks back out through the curtain at the gorge (43k
 * terrain pixels), so the mouth in the frustum within CAVE_PORTAL_REACH shows
 * everything. Applied inside each main-camera render (scene.onBeforeRender),
 * restored after it, so modules and harness renders never see it stick.
 */
const OUTDOOR_GROUPS: readonly string[] = [
  "Terrain", "Terrain:falls", "Terrain:mirror", "River", "Stream", "Brook", "V5Rocks", "V5Cover", "V5Shore",
  "Forest", "DressSky", "Harbour", "MirrorLake", "LightClouds", "LifeBirds", "LifeSoft", "LifeAirships",
];
const UNDER_MARGIN = 9;
const CAVE_PORTAL = new THREE.Box3(
  new THREE.Vector3(CAVE.x - CAVE.mouthHalfW - 12, CAVE.floorY - 12, CAVE.footZ - 15),
  new THREE.Vector3(CAVE.x + CAVE.mouthHalfW + 12, CAVE.floorY + CAVE.mouthH + 12, CAVE.footZ + 20),
);
const CAVE_PORTAL_REACH = 500;

/**
 * The modules installed when the page passes none: the light (sky, clouds,
 * time of day, the Mirror Lake) and the grey blocks (landmarks, sets, falls,
 * steps, lanterns, mist). Pass modules: [] for the bare grey terrain.
 */
const DEFAULT_MODULES: ReadonlyArray<ModuleSpec> = [
  ["light", () => import("./light")],
  ["surfaces", () => import("./surfaces")],
  ["blocks", () => import("./blocks")],
  ["forest", () => import("./forest")],
  ["rocks", () => import("./rocks")],
  ["cover", () => import("./cover")],
  ["dress-shore", () => import("./dress-shore")],
  ["dress-underground", () => import("./dress-underground")],
  ["dress-lakeforest", () => import("./dress-lakeforest")],
  ["dress-sky", () => import("./dress-sky")],
  ["dress-harbour", () => import("./dress-harbour")],
  ["life", () => import("./life")],
];

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
 * under FAR_MIN: underground the ramp ends in a few hundred units and a far
 * plane there would open the tunnel onto the sky dome behind it.
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
const FALLS_PATCH = { minX: -380, maxX: 180, minZ: 1130, maxZ: 1460 };
const FALLS_PATCH_SUB = 5;

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

/** While only a module animates (nothing scrolls or flies), frames come no faster than this. */
const ANIM_FPS = 30;

// ── Copied from world-v3/scene.ts: marker and park constants ────────────────

// ── Markers ──────────────────────────────────────────────────────────────────

/** How far above its landmark's highest point a marker's pin floats, in CSS pixels. */
const MARKER_LIFT_PX = 14;
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
  /** In front of the camera and inside the frame. */
  visible: boolean;
  /** 0..1, nearer is larger. */
  proximity: number;
  /** Can be opened (park() accepts it) under the current lock. */
  enterable: boolean;
  /** Past the frontier ("look" and "locked" only): draw it in mist. */
  beyond: boolean;
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
  return {
    box,
    center,
    top: new THREE.Vector3(center.x, box.max.y, center.z),
    vis,
    visCenter: vis.getCenter(new THREE.Vector3()),
    samples: samples.subarray(0, o),
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
const FLOATING_ISLES = [WORLD.island, WORLD.bountyIsle, WORLD.harbourIsle] as const;
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
  private started = false;
  private lastTime = 0;
  private ready = false;
  private disposed = false;
  private paused = false;
  private contextLost = false;
  private dirty = true;
  private reducedMotion = false;

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
  private parkProgress = 0;
  private flightElapsed = 0;
  private flightDuration = FLIGHT_T_MIN;
  private flightToRail = false;
  private flightArc = 0;
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
  /** The current park is a RAIL_PARK place's own rail pose (no arc to or from it). */
  private parkOnRail = false;
  /**
   * Grey pass 3: a flight with either end underground (the cave, the tunnel,
   * the shaft) glides along the rail by depth instead of flying a line, which
   * would cut through the rock. Its off-rail ends (an outdoor park pose) ride
   * as offsets from the rail that fade in the first and last 30%.
   */
  private flightRail = false;
  private flightFromDepth = 0;
  private flightToDepth = 0;
  private readonly fromOff = new THREE.Vector3();
  private readonly fromOffLook = new THREE.Vector3();
  private readonly toOff = new THREE.Vector3();
  private readonly toOffLook = new THREE.Vector3();
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
  private readonly landmarks = new Map<string, Landmark>();
  private readonly markers: ProjectedMarker[] = [];
  private readonly frame: WorldFrame;
  private readonly lmRects = new Float32Array(64 * 5);
  private readonly lmList: Landmark[] = [];
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
  /** Detail pass 3: OUTDOOR_GROUPS as found after the modules installed, and those hidden for the render in flight. */
  private outdoor: THREE.Object3D[] | null = null;
  private readonly outdoorHidden: THREE.Object3D[] = [];
  private readonly zoneFrustum = new THREE.Frustum();
  private readonly zoneMat = new THREE.Matrix4();
  private readonly zoneCentre = CAVE_PORTAL.getCenter(new THREE.Vector3());
  private zoneUnder = false;

  // Observers and listeners
  private resizeObserver: ResizeObserver | null = null;
  private bodyObserver: ResizeObserver | null = null;
  private motionQuery: MediaQueryList | null = null;
  private readonly onResize = () => this.resize();
  private readonly onScroll = () => this.wake();
  private readonly onVisibility = () => {
    if (!document.hidden) this.wake();
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
    this.wake();
  };

  constructor(container: HTMLElement, opts: WorldSceneOptions = {}) {
    this.container = container;
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
    };
    this.init();
    // Anchors default to the eight layout places, so the scene runs on its own.
    this.setAnchors(PLACES.map((p, i) => ({ id: p.id, depth: this.rail.stopDepth(i), landmark: p.mesh })));
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      (window as unknown as { __worldV5Debug?: WorldScene }).__worldV5Debug = this;
    }
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  private init() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.display = "block";
    renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", this.onContextRestored);
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;

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
    if (!renderer || !camera) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || window.innerWidth));
    const h = Math.max(1, Math.round(rect.height || window.innerHeight));
    this.width = w;
    this.height = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
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
    // Detail pass 3: no outside world inside the mountain (OUTDOOR_GROUPS).
    // Runs before three builds the render list; the lake's nested reflection
    // render (another camera) is left alone.
    scene.onBeforeRender = (_r, _s, cam) => {
      if (cam === this.camera) this.hideOutdoor();
    };
    scene.onAfterRender = (_r, _s, cam) => {
      if (cam === this.camera) this.showOutdoor();
    };

    this.addTerrain(root);
    this.rail.setGround(railGround);
    this.currentS = this.rail.sOfDepth(this.currentDepth);

    await yieldToBrowser();
    if (this.disposed || !this.scene) return;
    await this.installModules(root);
    if (this.disposed || !this.scene) return;

    this.addStandIns(root);
    // The page may have set these before the modules existed.
    this.setProgress(this.progress);
    this.forwardMist();
    scene.updateMatrixWorld(true);
    this.indexLandmarks(scene);
    this.indexTrees(scene);

    this.ready = true;
    this.resolveAnchors();
    if (this.parkedId) {
      this.parkPending = false;
      this.beginPark(this.parkedId);
    }
    this.placeOnRail(this.currentDepth);
    this.dirty = true;
    this.wake();
  }

  /** The terrain from terrain.ts, grey, with the finer patch round the falls cut in. */
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
    const i0 = Math.max(0, Math.floor((FALLS_PATCH.minX - WORLD.minX) / sx));
    const i1 = Math.min(nx, Math.ceil((FALLS_PATCH.maxX - WORLD.minX) / sx));
    const j0 = Math.max(0, Math.floor((FALLS_PATCH.minZ - WORLD.minZ) / sz));
    const j1 = Math.min(nz, Math.ceil((FALLS_PATCH.maxZ - WORLD.minZ) / sz));
    // Cut the patch's cells out of the main mesh (6 indices per cell, row by row).
    const idx = main.getIndex()!.array as Uint32Array;
    const kept = new Uint32Array(idx.length - (i1 - i0) * (j1 - j0) * 6);
    let o = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (i >= i0 && i < i1 && j >= j0 && j < j1) continue;
        const b = (j * nx + i) * 6;
        for (let k = 0; k < 6; k++) kept[o++] = idx[b + k];
      }
    }
    // Grey pass 3: the shaft's collar (layout SHAFT is exactly one main-grid
    // cell) is cut out too; blocks.ts's collar and headframe frame the hole.
    const ci = Math.round((SHAFT.x0 - WORLD.minX) / sx);
    const cj = Math.round((SHAFT.z0 - WORLD.minZ) / sz);
    let cut = o;
    if (ci >= 0 && ci < nx && cj >= 0 && cj < nz && !(ci >= i0 && ci < i1 && cj >= j0 && cj < j1)) {
      // Rows before cj keep all their cells except the patch's.
      let before = 0;
      for (let j = 0; j < cj; j++) before += j >= j0 && j < j1 ? nx - (i1 - i0) : nx;
      const inRow = cj >= j0 && cj < j1 ? ci - (ci >= i1 ? i1 - i0 : 0) : ci;
      const at = (before + inRow) * 6;
      kept.copyWithin(at, at + 6, o);
      cut = o - 6;
    }
    main.setIndex(new THREE.BufferAttribute(kept.subarray(0, cut), 1));
    const mesh = new THREE.Mesh(main, mat);
    mesh.name = "Terrain";
    root.add(mesh);

    const bounds = {
      minX: WORLD.minX + i0 * sx,
      maxX: WORLD.minX + i1 * sx,
      minZ: WORLD.minZ + j0 * sz,
      maxZ: WORLD.minZ + j1 * sz,
    };
    const sub = FALLS_PATCH_SUB;
    const longer = Math.max(i1 - i0, j1 - j0);
    const patch = buildTerrainGeometry(longer * sub, bounds);
    // Patch edge vertices take the main mesh's height along its cell edges
    // (linear between main vertices), so the seam has no crack.
    const pnx = (i1 - i0) * sub;
    const pnz = (j1 - j0) * sub;
    const pos = patch.getAttribute("position") as THREE.BufferAttribute;
    if (pos.count === (pnx + 1) * (pnz + 1)) {
      const hMain = (ii: number, jj: number) => terrainHeight(WORLD.minX + ii * sx, WORLD.minZ + jj * sz);
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
      console.warn("[world-v5] falls patch grid mismatch; seam not snapped", pos.count, (pnx + 1) * (pnz + 1));
    }
    // Grey pass 3: the cave's mouth (layout CAVE) cut out of the falls cliff:
    // every steep patch triangle whose centre is inside the arch's box. The
    // gorge floor in front of it (flat, max y under the sill + 3) is kept.
    {
      const pi = patch.getIndex()!.array as Uint32Array;
      const out = new Uint32Array(pi.length);
      let n = 0;
      const P = patch.getAttribute("position") as THREE.BufferAttribute;
      for (let t = 0; t < pi.length; t += 3) {
        const a = pi[t];
        const b = pi[t + 1];
        const c = pi[t + 2];
        const cx = (P.getX(a) + P.getX(b) + P.getX(c)) / 3;
        const cy = (P.getY(a) + P.getY(b) + P.getY(c)) / 3;
        const cz = (P.getZ(a) + P.getZ(b) + P.getZ(c)) / 3;
        const top = Math.max(P.getY(a), P.getY(b), P.getY(c));
        const inMouth =
          Math.abs(cx - CAVE.x) < CAVE.mouthHalfW &&
          cy < CAVE.floorY + CAVE.mouthH &&
          top > CAVE.floorY + 3 &&
          cz > CAVE.footZ - CAVE.mouthH / 9 - 8 &&
          cz < CAVE.footZ + 8;
        if (inMouth) continue;
        out[n++] = a;
        out[n++] = b;
        out[n++] = c;
      }
      patch.setIndex(new THREE.BufferAttribute(out.slice(0, n), 1));
    }
    const pm = new THREE.Mesh(patch, mat);
    pm.name = "Terrain:falls";
    root.add(pm);
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
    };
  }

  /** Install the page's modules in order, each guarded, with a turn for the browser between. */
  private async installModules(root: THREE.Object3D) {
    const ctx = this.makeCtx(root);
    this.ctx = ctx;
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
        console.error(`[world-v5] module ${name} did not load`, mod);
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
        console.error(`[world-v5] module ${name} failed to install`, e);
      }
    }
    if (this.moduleSpecs.length) console.info("[world-v5] modules", this.moduleReport);
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
      ["Stand-in:HarbourIsle", WORLD.harbourIsle, HARBOUR_DEPTH],
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
    root.traverse((o) => {
      if (!o.name.startsWith("LM_") || !isShown(o)) return;
      // A nested LM_* object belongs to its outermost LM_ ancestor.
      for (let p = o.parent; p; p = p.parent) if (p.name.startsWith("LM_")) return;
      const meshes: THREE.Mesh[] = [];
      o.traverse((d) => {
        if ((d as THREE.Mesh).isMesh && isShown(d)) meshes.push(d as THREE.Mesh);
      });
      const lm = buildLandmark(meshes, surfaceHeight);
      if (lm) this.landmarks.set(o.name, lm);
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
        markers[i] = { id: anchors[i].id, x: 0, y: 0, visible: false, proximity: 0, enterable: true, beyond: false };
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
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      if (!out[i]) out[i] = new THREE.Vector3();
      const lm = a.landmark ? this.landmarks.get(a.landmark) : undefined;
      this.anchorLm[i] = lm ?? null;
      if (lm) out[i].copy(lm.top);
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
          console.error(`[world-v5] module ${rec.name} setProgress threw`, e);
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
          console.error(`[world-v5] module ${rec.name} setMist threw`, e);
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
      console.warn("[world-v5] park: unknown anchor", anchorId);
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
    let destLook: THREE.Vector3;
    if (toRail) {
      this.railLookPose(this.currentDepth, this.v1, this.v2);
      dest = this.v1;
      destLook = this.v2;
    } else {
      dest = this.parkPos;
      destLook = this.parkLook;
    }
    this.flightFromDepth = this.poseDepth;
    this.flightToDepth = toRail ? this.currentDepth : this.parkDepth;
    this.flightRail = this.underground(this.flightFromDepth) || this.underground(this.flightToDepth);
    if (this.flightRail) {
      this.railLookPose(this.flightFromDepth, this.v3, this.v4);
      this.fromOff.copy(this.fromPos).sub(this.v3);
      this.fromOffLook.copy(this.fromLook).sub(this.v4);
      this.railLookPose(this.flightToDepth, this.v3, this.v4);
      this.toOff.copy(dest).sub(this.v3);
      this.toOffLook.copy(destLook).sub(this.v4);
      // The glide's length is the route's, so a long one takes the long flight's time.
      const along = Math.abs(this.rail.sOfDepth(this.flightToDepth) - this.rail.sOfDepth(this.flightFromDepth));
      const dist = along + this.fromOff.length() + this.toOff.length();
      this.flightArc = 0;
      this.flightDuration = this.reducedMotion
        ? 0
        : FLIGHT_T_MIN +
          (FLIGHT_T_MAX - FLIGHT_T_MIN) * clamp01(dist / FLIGHT_FAR) +
          FLIGHT_T_EXTRA * clamp01((dist - FLIGHT_FAR) / (FLIGHT_VERY_FAR - FLIGHT_FAR));
      this.mode = "flight";
      this.dirty = true;
      this.wake();
      return;
    }
    const dist = this.fromPos.distanceTo(dest);
    // The straight line between can run through a ridge on a long flight; the
    // flight arcs up by what it takes to clear the ground under that line.
    let arc = 0;
    for (let k = 1; k < 48 && !this.parkOnRail; k++) {
      const f = k / 48;
      const x = this.fromPos.x + (dest.x - this.fromPos.x) * f;
      const z = this.fromPos.z + (dest.z - this.fromPos.z) * f;
      const y = this.fromPos.y + (dest.y - this.fromPos.y) * f;
      const need = surfaceHeight(x, z) + FLIGHT_ARC_CLEAR - y;
      // sin(pi f) is how much of the arc this point gets.
      const s = Math.sin(Math.PI * f);
      if (need > 0 && s > 0.05) arc = Math.max(arc, need / s);
    }
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

  private computeParkPose(anchorId: string) {
    const a = this.anchors.find((x) => x.id === anchorId);
    const full = a?.landmark ? this.landmarks.get(a.landmark) : undefined;
    const camera = this.camera;
    if (!a || !camera) return;
    this.parkOnRail = RAIL_PARK.includes(anchorId);
    this.parkDepth = this.depthFor(anchorId);
    if (!full || this.parkOnRail) {
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

  /** Is the rail at this depth in the cave, the tunnel or the shaft? */
  private underground(depth: number): boolean {
    return (Layout.UNDERGROUND as readonly string[]).includes(this.rail.kindAtS(this.rail.sOfDepth(depth)));
  }

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
    } else if (this.mode === "parked") {
      this.flightNow = 1;
      this.camPos.copy(this.parkPos);
      this.camLook.copy(this.parkLook);
      this.poseDepth = this.parkDepth;
    } else if (this.flightRail) {
      this.flightElapsed += dt;
      const T = this.flightDuration;
      const s = T <= 0 ? 1 : clamp01(this.flightElapsed / T);
      const q = flightEase(s);
      this.flightNow = q;
      // Closing: the rail end is wherever the scroll is now.
      const toDepth = this.flightToRail ? this.currentDepth : this.flightToDepth;
      const sa = this.rail.sOfDepth(this.flightFromDepth);
      const d = this.rail.depthOfS(sa + (this.rail.sOfDepth(toDepth) - sa) * q);
      this.poseDepth = d;
      this.railLookPose(d, this.camPos, this.camLook);
      const w0 = 1 - smoothstep01(q / 0.3);
      const w1 = this.flightToRail ? 0 : smoothstep01((q - 0.7) / 0.3);
      this.camPos.addScaledVector(this.fromOff, w0).addScaledVector(this.toOff, w1);
      this.camLook.addScaledVector(this.fromOffLook, w0).addScaledVector(this.toOffLook, w1);
      this.parkProgress = this.switchDip
        ? 1 - PARK_SWITCH_DIP * Math.sin(Math.PI * q)
        : this.progFrom + (this.progTo - this.progFrom) * q;
      if (s < 1 && (w0 > 0 || w1 > 0) && !this.underground(d)) {
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
          this.camPos.copy(this.parkPos);
          this.camLook.copy(this.parkLook);
          this.poseDepth = this.parkDepth;
        }
        this.switchDip = false;
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
    const fov = FOV + (this.rail.fovAtS(this.rail.sOfDepth(this.poseDepth)) - FOV) * (1 - this.parkProgress);
    if (Math.abs(camera.fov - fov) > 1e-4) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  /** Is the camera inside the mountain with no way out in view (see OUTDOOR_GROUPS)? */
  private insideMountain(cam: THREE.PerspectiveCamera): boolean {
    const p = cam.position;
    if (terrainHeight(p.x, p.z) - p.y < UNDER_MARGIN) return false;
    if (p.distanceTo(this.zoneCentre) < CAVE_PORTAL_REACH) {
      this.zoneMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this.zoneFrustum.setFromProjectionMatrix(this.zoneMat);
      if (this.zoneFrustum.intersectsBox(CAVE_PORTAL)) return false;
    }
    return true;
  }

  private hideOutdoor() {
    this.showOutdoor();
    const scene = this.scene;
    const camera = this.camera;
    if (!this.ready || !scene || !camera) return;
    if (!this.outdoor) {
      const found: THREE.Object3D[] = [];
      for (const pool of [this.worldRoot?.children ?? [], scene.children]) {
        for (const o of pool) if (OUTDOOR_GROUPS.includes(o.name)) found.push(o);
      }
      this.outdoor = found;
    }
    this.zoneUnder = this.insideMountain(camera);
    if (!this.zoneUnder) return;
    for (const o of this.outdoor) {
      if (!o.visible) continue;
      o.visible = false;
      this.outdoorHidden.push(o);
    }
  }

  private showOutdoor() {
    for (const o of this.outdoorHidden) o.visible = true;
    this.outdoorHidden.length = 0;
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
      p.copy(at);
      if (lm) p.set(lm.visCenter.x, lm.vis.max.y, lm.visCenter.z);
      p.applyMatrix4(camera.matrixWorldInverse);
      const ahead = p.z < -camera.near;
      const distance = lm ? lm.center.distanceTo(this.camPos) : at.distanceTo(this.camPos);
      p.applyMatrix4(camera.projectionMatrix);
      const x = (p.x * 0.5 + 0.5) * w;
      let top = (-p.y * 0.5 + 0.5) * h;
      if (lm && ahead) {
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
      m.proximity = clamp01(1 - (distance - 300) / Math.max(1, fogFar - 300));
    }
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
    if (this.disposed || !this.started || this.raf) return;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private scheduleAnimFrame() {
    if (this.animTimer !== null || this.raf || this.disposed) return;
    const wait = Math.max(0, 1000 / ANIM_FPS - (performance.now() - this.lastTime) - 2);
    this.animTimer = setTimeout(() => {
      this.animTimer = null;
      if (this.disposed || this.raf) return;
      this.raf = requestAnimationFrame(this.tick);
    }, wait);
  }

  private updateModules(dt: number): boolean {
    this.sceneTime += dt;
    let animating = false;
    for (const rec of this.modules) {
      if (rec.broken) continue;
      const m = rec.module;
      try {
        if (m.update && m.update(this.sceneTime, dt)) animating = true;
        if (m.isAnimating && m.isAnimating()) animating = true;
      } catch (e) {
        rec.broken = true;
        console.error(`[world-v5] module ${rec.name} update threw; it is no longer updated`, e);
      }
    }
    return animating;
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    if (this.paused || this.contextLost || document.hidden) return;

    let dt = (now - this.lastTime) / 1000;
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
    const animating = this.ready && this.updateModules(dt) && !this.reducedMotion;
    // After the modules: the light has blended this frame's key (v5 fog ramp).
    this.updateFog();

    const renderer = this.renderer;
    if (this.ready && renderer && this.scene && this.camera) {
      renderer.render(this.scene, this.camera);
      this.frame.triangles = renderer.info.render.triangles;
      this.frame.calls = renderer.info.render.calls;
    }
    this.projectMarkers();
    this.frame.depth = this.currentDepth;
    this.frame.railU = this.railU();
    this.frame.place = this.placeCoord();
    this.frame.parkedId = this.parkedId;
    this.frame.parkProgress = this.parkProgress;
    this.frame.flight = this.flightNow;
    this.frame.maxDepth = this.depthMax;
    this.frameCb?.(this.frame);

    const moving = !converged || this.mode === "flight" || this.parkPending;
    if (!moving && !this.dirty) {
      this.velPos.set(0, 0, 0);
      this.velLook.set(0, 0, 0);
      if (animating) this.scheduleAnimFrame();
      return;
    }
    this.dirty = false;
    this.raf = requestAnimationFrame(this.tick);
  };

  // ── Harness ────────────────────────────────────────────────────────────────

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
      zone: { underground: this.zoneUnder, outdoorGroups: this.outdoor?.map((o) => o.name) ?? null },
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
        console.error(`[world-v5] module ${rec.name} dispose threw`, e);
      }
    }
    this.modules.length = 0;
    const w = typeof window !== "undefined" ? (window as unknown as { __worldV5Debug?: WorldScene }) : null;
    if (w && w.__worldV5Debug === this) delete w.__worldV5Debug;
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("scroll", this.onScroll);
    document.removeEventListener("visibilitychange", this.onVisibility);
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
