import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { createRail, type Rail, type RailPose } from "./rail";
import { buildHeightfield, type Heightfield } from "./heightfield";
import type { InstallFn, LandmarkBase, WorldCtx, WorldModule } from "./modules";

/**
 * The world-v3 scene: the same Blender landscape as /dev/world, on a rail that
 * travels sideways and turns, with a parked "zoom into the place" camera.
 *
 * V3: how the world LOOKS lives in five modules (see modules.ts), installed
 * after the glb loads in the order atmosphere, surfaces, forest, landmarks,
 * life. This file owns the camera, the rail, the park, the fog DISTANCES and
 * the frame loop. It builds the modules' WorldCtx, installs each one inside a
 * try/catch (one failing module logs and the world still renders, with V2's
 * sky and lights standing in for a failed atmosphere), then indexes the
 * landmarks and water the modules left behind. A module that animates keeps
 * the loop running at a capped 30 fps; otherwise the loop sleeps as in V2.
 *
 * Everything the interface needs goes through the Contract section below
 * (WorldScene's public methods and WorldFrame). React never sees a per-frame
 * value: onFrame() hands over one mutated frame object per rendered frame, and
 * the interface writes marker transforms straight to the DOM. When nothing
 * moves, nothing renders: the loop sleeps until a scroll, resize or park.
 *
 * THE TRAPS THIS FILE IS WRITTEN AROUND, each of which cost hours once:
 *
 *   1. glTF has no Mix Shader. ridge.py mixes a haze Emission into every
 *      material and the exporter flattens it to a flat emissiveFactor, so every
 *      surface glows full-strength peach. stripHazeEmissive() is the guard;
 *      scene.fog does the distance haze here.
 *
 *   2. PerspectiveCamera fov is VERTICAL, so a wider monitor sees MORE world.
 *      The park framing below therefore solves the yaw offset from the live
 *      aspect ratio every time it is computed, never from a constant.
 *
 *   3. three applies fog AFTER tone mapping and output conversion, and hands
 *      the shader the fog colour already in output (sRGB) space. So the haze
 *      colour set here is exactly the colour a fully hazed pixel shows, and the
 *      sky, which draws itself in sRGB too, can be matched to it by value.
 *
 *   4. The old sky ShaderMaterial wrote LINEAR values straight to an sRGB
 *      canvas, so its "0x565A8C" top displayed as near-navy (24,26,67) and its
 *      horizon as brick red. This sky includes <colorspace_fragment>, so the
 *      TIME_TABLE colours display as themselves.
 */

// ── Rail and scroll ──────────────────────────────────────────────────────────

/**
 * The page scroll maps 0..1 onto rail depth 0..MAX_RAIL_DEPTH. Past ~0.88 the
 * camera looks at empty sky over the summit, so the bottom of the page IS the
 * last place. Every stored depth (area anchors, the harness) is in this unit.
 */
const MAX_RAIL_DEPTH = 0.88;

/** Exponential smoothing on depth, per second. LOCKED by the spec: the lag IS the glide. */
const SMOOTHING = 6.0;

/** Depth difference below which the glide counts as arrived (~0.02 world units). */
const DEPTH_EPS = 1e-5;

/** A frame longer than this is treated as this long, so a stall never teleports. */
const MAX_DT = 0.05;

/** Retina at 3x melts laptops on a scene this heavy. 1.5 is Astra's cap too. */
const MAX_PIXEL_RATIO = 1.5;

/** Vertical lens, as /dev/world. The rail's framing is tuned against it. */
const FOV = 31;

/**
 * Every look point used for blending is re-projected to this distance in front
 * of its camera, so blending two look points blends two DIRECTIONS. Without
 * it, a rail target 900 units out and a park target 350 units out would swing
 * the view unevenly through the middle of a flight.
 */
const LOOK_DIST = 600;

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
 * A landmark's marker box includes a child part only when the child's world
 * XZ centre is within this radius of the parent's. The old /world/world.glb
 * put LM_LighthouseLamp 818 units from its tower (ridge.py assigned absolute
 * coordinates to parented children); the v2 export has them fixed. This one
 * rule is right on both assets.
 */
const LANDMARK_CHILD_RADIUS = 60;

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

/** Ridge cards are distant silhouettes: never less hazed than this, even when the summit camera nears the first one. */
const RIDGE_FOG_MIN = 0.72;

// ── Frame loop ───────────────────────────────────────────────────────────────

/** While only a module animates (nothing scrolls or flies), frames come no faster than this. */
const ANIM_FPS = 30;

// ── Colour (TIME_TABLE["sunset"] in ridge.py, linear RGB) ────────────────────

function linear(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
}

/**
 * These are V2's constants. In V3 the atmosphere module owns the sky, lights
 * and fog colour; they seed WorldCtx (hazeColor, sunColor) and the stand-in
 * atmosphere used only when that module fails to install.
 */
/** haze_col (1.00, 0.55, 0.34) -> #FFC49E on screen. */
const HAZE = linear(1.0, 0.55, 0.34);
/** sky_hor (1.00, 0.44, 0.20) -> #FFB17C: the glow band just above the horizon. */
const SKY_GLOW = linear(1.0, 0.44, 0.2);
/** sky_top (0.17, 0.20, 0.42) -> #737CAD: dusk violet at the top of the frame. */
const SKY_TOP = linear(0.17, 0.2, 0.42);
/** sun_col (1.00, 0.46, 0.20). */
const SUN_COLOR = linear(1.0, 0.46, 0.2);
/**
 * Fill light. The sky side is the dusk violet, so every surface the sun does
 * not reach falls into a cool plum shadow while sunlit slopes go warm. With
 * the haze as fill (tried first) sun and shadow shared one hue and the whole
 * valley measured as a single bright orange.
 */
const HEMI_SKY = SKY_TOP;
const HEMI_GROUND = new THREE.Color(0x2b2331);

/** Emissive strength for the lighthouse lamp, the one glowing thing in 3D. */
const LAMP_GLOW = 0.6;

/** WorldCtx.sunDir: front-left and low, so silhouettes along the rail are rim-lit. */
const SUN_DIR = new THREE.Vector3(-0.62, 0.3, -0.72).normalize();

const SUN_INTENSITY = 3.4;
const HEMI_INTENSITY = 1.8;
const EXPOSURE = 1.05;

/**
 * Fog near/far scheduled on rail depth: [depth, near, far]. Near sits just
 * past the area the camera is framing (~350 units ahead at every stop), so
 * the place you are in stays crisp and each place beyond it is one step
 * hazier. The valley ahead is long at the shore and short at the summit, so
 * the ramp shortens as you climb.
 */
const FOG_TABLE: ReadonlyArray<readonly [number, number, number]> = [
  [0.0, 430, 2300],
  [0.45, 400, 2050],
  [0.88, 340, 1700],
];
/** The fog never quite reaches the sky colour, so the far ridges keep a silhouette. */
const FOG_MAX = 0.9;

// ── Contract ─────────────────────────────────────────────────────────────────

export interface AreaAnchor {
  id: string;
  depth: number;
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
}

export interface WorldFrame {
  /** Current smoothed rail depth. */
  depth: number;
  /** Anchor being flown to / parked at; null on the rail (and while flying back to it). */
  parkedId: string | null;
  /**
   * 0 on the rail .. 1 fully arrived. Eased, frame-rate independent, animates
   * both ways. Switching between two parked places dips it and brings it back.
   */
  parkProgress: number;
  /** 0 .. 1 through the current flight, on the same curve as the camera; 1 when no flight is running. */
  flight: number;
  /** The SAME array and objects every frame, mutated in place. */
  markers: ProjectedMarker[];
  triangles: number;
  calls: number;
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
      const nearDist = searchDistance(lm, dx, dz, pitch, probe, frame, pos, look, (e) => e.maxY - e.minY > 2 * PARK_HEIGHT_MAX);
      const farDist = searchDistance(lm, dx, dz, pitch, probe, frame, pos, look, (e) => e.maxY - e.minY > 2 * PARK_HEIGHT_MIN);
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
        PARK_W_SIZE * 10 * Math.max(0, PARK_HEIGHT_MIN - 0.01 - heightFrac, heightFrac - PARK_HEIGHT_MAX - 0.01);
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

function fogTable(depth: number, out: { near: number; far: number }) {
  const t = FOG_TABLE;
  if (depth <= t[0][0]) {
    out.near = t[0][1];
    out.far = t[0][2];
    return;
  }
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i];
    const b = t[i + 1];
    if (depth <= b[0]) {
      const k = (depth - a[0]) / (b[0] - a[0]);
      out.near = a[1] + (b[1] - a[1]) * k;
      out.far = a[2] + (b[2] - a[2]) * k;
      return;
    }
  }
  const last = t[t.length - 1];
  out.near = last[1];
  out.far = last[2];
}

export interface WorldSceneOptions {
  /** "low" = V2's rail exactly (5-7 degrees), for ?pitch=low. Default "v3" (8 -> 16). */
  pitch?: "v3" | "low";
}

/** ridge.py's river: centre x for 0.20 < t < 0.70, NaN elsewhere. */
function riverXAtZ(z: number): number {
  const t = (1000 - z) / 2000;
  if (!(t > 0.2 && t < 0.7)) return NaN;
  return 310 * (Math.sin(5.2 * t) * 0.3 + Math.sin(11 * t) * 0.08);
}

/** Look modules, installed in this order (modules.ts). Imported in parallel, installed one at a time. */
const MODULES: ReadonlyArray<readonly [string, () => Promise<{ install: InstallFn }>]> = [
  ["atmosphere", () => import("./atmosphere")],
  ["surfaces", () => import("./surfaces")],
  ["forest", () => import("./forest")],
  ["landmarks", () => import("./landmarks")],
  ["life", () => import("./life")],
];

interface InstalledModule {
  name: string;
  module: WorldModule;
  /** update() or isAnimating() threw once; not called again. */
  broken: boolean;
}

/** Is the object drawn (itself and every ancestor visible)? */
function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export class WorldScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  /** V2's sky, only when the atmosphere module failed to install. */
  private sky: THREE.Mesh | null = null;
  private fog: THREE.Fog | null = null;
  private readonly fogMax = { value: FOG_MAX };

  private readonly pitchMode: "v3" | "low";
  private readonly rail: Rail;
  private heightfield: Heightfield | null = null;

  // Look modules
  private readonly modules: InstalledModule[] = [];
  /** Per module: install ms (wall, including its own yields) or the error it threw. */
  private readonly moduleReport: Record<string, number | string> = {};
  /** Scene clock for the modules: the sum of clamped frame dts, so a hidden tab or a stall never jumps it. */
  private sceneTime = 0;
  private animTimer: ReturnType<typeof setTimeout> | null = null;

  // Loop state
  private raf = 0;
  private started = false;
  private lastTime = 0;
  private ready = false;
  private disposed = false;
  private paused = false;
  private contextLost = false;
  /** Something changed that needs at least one more frame rendered. */
  private dirty = true;
  private reducedMotion = false;

  // Depth
  private targetDepth = 0;
  private currentDepth = 0;
  private maxScroll = 0;

  // Size, cached so nothing in the frame loop reads layout.
  private width = 1;
  private height = 1;

  // Camera pose actually applied last frame: position + a look point LOOK_DIST out.
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
  private progFrom = 0;
  private progTo = 0;
  /** This flight goes from one parked place to another: parkProgress dips instead of holding at 1. */
  private switchDip = false;
  private flightNow = 1;
  private readonly fromPos = new THREE.Vector3();
  private readonly fromLook = new THREE.Vector3();
  private readonly v0Pos = new THREE.Vector3();
  private readonly v0Look = new THREE.Vector3();
  private readonly parkPos = new THREE.Vector3();
  private readonly parkLook = new THREE.Vector3();
  /** Camera-to-landmark distance of the current park framing; the fog pushes out past it. */
  private parkDistance = 0;
  private parkPending = false;
  /** The last park solve, for the harness. */
  private lastPark: ParkResult | null = null;

  // Anchors, landmarks, markers
  private anchors: AreaAnchor[] = [];
  private readonly anchorPos: THREE.Vector3[] = [];
  /** Each anchor's landmark, or null when it has none (its marker then hangs from anchorPos). */
  private readonly anchorLm: Array<Landmark | null> = [];
  private readonly landmarks = new Map<string, Landmark>();
  private readonly depthCache = new Map<string, number>();
  private readonly markers: ProjectedMarker[] = [];
  private readonly frame: WorldFrame = {
    depth: 0,
    parkedId: null,
    parkProgress: 0,
    flight: 1,
    markers: this.markers,
    triangles: 0,
    calls: 0,
  };
  /** Per landmark, this frame: screen rect of its visible box (l, t, r, b) and camera distance. */
  private readonly lmRects = new Float32Array(64 * 5);
  private readonly lmList: Landmark[] = [];

  /** Water surfaces (Sea, Lake, Pond), as boxes or ellipses in XZ. */
  private readonly water: Array<{ y: number; cx: number; cz: number; rx: number; rz: number; round: boolean }> = [];
  /** Ground or water height: what a sight line cannot pass. */
  private readonly surface: SurfaceFn = (x, z) => {
    const hf = this.heightfield;
    let h = hf ? hf.heightAt(x, z) : -Infinity;
    for (const w of this.water) {
      if (w.y <= h) continue;
      const u = (x - w.cx) / w.rx;
      const v = (z - w.cz) / w.rz;
      if (w.round ? u * u + v * v <= 1 : Math.abs(u) <= 1 && Math.abs(v) <= 1) h = w.y;
    }
    return h;
  };
  private seaEnv: THREE.WebGLRenderTarget | null = null;
  /** The hamlet's houses: they stand between the rail and the lighthouse. */
  private readonly occluders: THREE.Box3[] = [];
  /** The forest's trees as cylinders (x, z, bottom, top, radius), for the park's foreground test. */
  private trees: Float32Array | undefined;

  /** The scroll range the page had when the depth was last read from it. */
  private scrollArmed = false;
  private lastMaxScroll = -1;
  private frameCb: ((f: WorldFrame) => void) | null = null;

  // Scratch, allocated once
  private readonly railPose: RailPose = {
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
  };
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly fogRange = { near: 0, far: 0 };

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
    let pitch = opts.pitch;
    if (!pitch && typeof window !== "undefined") {
      // The page passes it; reading the URL here too keeps ?pitch=low working
      // on any page that mounts the scene without the option.
      pitch = new URLSearchParams(window.location.search).get("pitch") === "low" ? "low" : "v3";
    }
    this.pitchMode = pitch === "low" ? "low" : "v3";
    this.rail = createRail({ pitch: this.pitchMode });
    this.init();
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      (window as unknown as { __worldV3Debug?: WorldScene }).__worldV3Debug = this;
    }
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  private init() {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = EXPOSURE;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.display = "block";
    renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", this.onContextRestored);
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.fog = new THREE.Fog(HAZE.clone(), FOG_TABLE[0][1], FOG_TABLE[0][2]);
    scene.fog = this.fog;
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 6000);

    // Sky, sun and fill belong to the atmosphere module (installed after the
    // glb loads); installFallbackAtmosphere() puts V2's back if it fails.

    this.motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    this.reducedMotion = !!this.motionQuery?.matches;
    this.motionQuery?.addEventListener?.("change", this.onMotionChange);

    window.addEventListener("resize", this.onResize, { passive: true });
    window.addEventListener("scroll", this.onScroll, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.container);
      // The scroll range changes when the page's content does (the spacer
      // collapsing, a panel mounting), not only on window resize.
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
    this.placeOnRail(this.currentDepth);
    this.lastMaxScroll = this.maxScroll;
    this.scrollArmed = true;
  }

  private cacheScroll() {
    const doc = document.documentElement;
    const h = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
    this.maxScroll = Math.max(0, h - window.innerHeight);
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
    // The park framing depends on the aspect ratio (trap 2).
    if (this.parkedId && this.ready) {
      this.computeParkPose(this.parkedId);
      if (this.mode === "parked") {
        this.camPos.copy(this.parkPos);
        this.camLook.copy(this.parkLook);
      } else if (this.mode === "flight" && !this.flightToRail) {
        // Re-aim the running flight from where the camera is, at the speed it
        // has. Moving parkPos under the running curve jumped the camera 54
        // units in one frame (1084 u/s against a 344 u/s peak).
        this.startFlight(false);
      }
    }
    this.wake();
  }

  /**
   * The spacer is 640vh, so after the window's height changes the same scrollY
   * is a different depth: moving between Lovro's two screens drifted it 0.012,
   * a laptop-sized window 0.126. On the rail, the scroll is put back on the
   * depth the camera is at. Parked or flying home, the page is locked and
   * WorldV3 restores it from the depth it saved.
   */
  private holdDepthAcrossRescale() {
    const prev = this.lastMaxScroll;
    this.lastMaxScroll = this.maxScroll;
    if (!this.scrollArmed || prev < 0 || Math.abs(prev - this.maxScroll) < 0.5) return;
    if (this.parkedId !== null || this.mode !== "rail" || this.maxScroll <= 0) return;
    const y = Math.round(clamp01(this.targetDepth / MAX_RAIL_DEPTH) * this.maxScroll);
    if (Math.abs(window.scrollY - y) >= 1) window.scrollTo({ top: y, left: 0, behavior: "instant" });
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  load(url: string, opts?: { dracoPath?: string }): Promise<void> {
    const draco = new DRACOLoader();
    draco.setDecoderPath(opts?.dracoPath ?? "/world-v3/draco/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    return new Promise<void>((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          draco.dispose();
          if (this.disposed || !this.scene) return resolve();
          this.adopt(gltf.scene).then(resolve, reject);
        },
        undefined,
        (err) => {
          draco.dispose();
          reject(err);
        },
      );
    });
  }

  /**
   * Take the loaded world in: terrain follow, the landmark bases and water as
   * the glb has them, then the look modules, then the landmarks and water the
   * modules left. Nothing renders until `ready`, so the half-built scene is
   * never seen.
   */
  private async adopt(root: THREE.Group) {
    const scene = this.scene!;
    scene.add(root);
    root.updateMatrixWorld(true);

    // Terrain follow for the rail and clearance for the park camera.
    this.heightfield = buildHeightfield(root, "Terrain");
    if (this.heightfield) {
      const hf = this.heightfield;
      this.rail.setGround((x, z) => hf.heightAt(x, z));
    } else {
      console.warn("[world-v3] no Terrain mesh: rail runs without terrain follow");
    }
    // Water levels as exported; the modules restyle the water, not its level.
    this.indexWater(root, false);

    const stripped = this.stripHazeEmissive(root);
    if (stripped) {
      console.warn(
        "[world-v3] stripped haze emissive from",
        stripped,
        "materials; the .glb was exported without export_web.py's patch",
      );
    }

    // The bases BEFORE the landmarks module replaces the primitives.
    const bases = this.landmarkBases(root);
    await this.installModules(root, bases);
    if (this.disposed || !this.scene) return;

    // What the modules left: new landmarks under the LM_* names, maybe new water.
    scene.updateMatrixWorld(true);
    this.indexWater(scene, true);
    this.indexLandmarks(scene);
    this.indexTrees(scene);
    this.patchFog(scene);

    this.ready = true;
    this.depthCache.clear();
    this.resolveAnchors();
    const missing = this.anchors
      .filter((a) => a.landmark && !this.landmarks.has(a.landmark))
      .map((a) => a.landmark);
    if (missing.length) {
      console.warn("[world-v3] landmarks not in the glb:", missing.join(", "));
    }
    if (this.parkedId) {
      // park() was called before the world arrived.
      this.parkPending = false;
      this.beginPark(this.parkedId);
    }
    this.placeOnRail(this.currentDepth);
    this.dirty = true;
    this.wake();
  }

  /**
   * The forest module's trees (InstancedMeshes named Forest:conifer* /
   * Forest:broadleaf*) as upright cylinders: the park counts a wall of near
   * trees in the lower third the way it counts a bank. 80% of the crown's
   * half width, so a sight line through the sparse tip of a cone passes.
   */
  private indexTrees(root: THREE.Object3D) {
    const out: number[] = [];
    const m = new THREE.Matrix4();
    root.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (!im.isInstancedMesh || !/^Forest:(conifer|broadleaf)/.test(im.name) || !isShown(im)) return;
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

  /** Each LM_* object's base (box centre on the ground) and height, from the glb. */
  private landmarkBases(root: THREE.Object3D): Record<string, LandmarkBase> {
    const out: Record<string, LandmarkBase> = {};
    const box = new THREE.Box3();
    const hf = this.heightfield;
    root.traverse((o) => {
      if (!o.name.startsWith("LM_")) return;
      box.setFromObject(o);
      if (box.isEmpty()) return;
      const x = (box.min.x + box.max.x) / 2;
      const z = (box.min.z + box.max.z) / 2;
      // Piers run into the gorge floor and the jetty's piles into the pond
      // bed, so the base is the higher of the box bottom and the ground.
      const y = hf ? Math.max(box.min.y, hf.heightAt(x, z)) : box.min.y;
      out[o.name] = { x, y, z, height: Math.max(0, box.max.y - y) };
    });
    return out;
  }

  /**
   * Install the look modules in order. Each import starts at once (they are
   * separate chunks); each install runs alone, guarded, with a turn for the
   * browser between them. A module that fails is logged and skipped, and
   * the scene stands in for the parts the world cannot do without.
   */
  private async installModules(root: THREE.Object3D, bases: Record<string, LandmarkBase>) {
    const scene = this.scene!;
    const hf = this.heightfield;
    const ctx: WorldCtx = {
      scene,
      root,
      renderer: this.renderer!,
      camera: this.camera!,
      heightAt: (x, z) => (hf ? hf.heightAt(x, z) : 0),
      pathXAtZ: (z) => this.rail.pathXAtZ(z),
      riverXAtZ,
      landmarks: bases,
      sunDir: SUN_DIR.clone(),
      sunColor: SUN_COLOR.clone(),
      hazeColor: HAZE.clone(),
      reducedMotion: this.reducedMotion,
    };
    const imports = MODULES.map(([, load]) => load().catch((e: unknown) => e));
    const failed = new Set<string>();
    for (let i = 0; i < MODULES.length; i++) {
      const name = MODULES[i][0];
      await yieldToBrowser();
      if (this.disposed || !this.scene) return;
      const mod = await imports[i];
      if (this.disposed || !this.scene) return;
      const install = (mod as { install?: InstallFn } | null)?.install;
      if (typeof install !== "function") {
        failed.add(name);
        this.moduleReport[name] = `import failed: ${mod instanceof Error ? mod.message : String(mod)}`;
        console.error(`[world-v3] module ${name} did not load`, mod);
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
        failed.add(name);
        this.moduleReport[name] = `install threw: ${e instanceof Error ? e.message : String(e)}`;
        console.error(`[world-v3] module ${name} failed to install`, e);
      }
    }
    if (failed.has("atmosphere")) this.installFallbackAtmosphere();
    if (failed.has("surfaces")) this.giveSeaTheSky(root);
    if (failed.has("forest")) {
      // V2 instanced and simplified the kit trees; V3 does not, so 1,100 kit
      // trees (5.7M triangles, 1,520 draws with the rocks) would stall every
      // frame. Without the forest the valley goes bare instead.
      const drop: THREE.Object3D[] = [];
      root.traverse((o) => {
        if (/^[TR]\d+$/.test(o.name)) drop.push(o);
      });
      for (const o of drop) o.parent?.remove(o);
      console.warn(`[world-v3] forest failed: removed ${drop.length} kit trees and rocks`);
    }
    console.info("[world-v3] modules", this.moduleReport);
  }

  /** V2's sky dome, sun and hemisphere fill. Only when the atmosphere module failed. */
  private installFallbackAtmosphere() {
    const scene = this.scene;
    if (!scene) return;
    // Gradient sky on an inverted sphere that follows the camera (a fixed sky
    // got clipped by the far plane once the rail lengthened; the black wedge
    // it left read as a mountain). Horizon = the haze, so hazed land meets it.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(5000, 32, 16),
      new THREE.ShaderMaterial({
        name: "SkyMat",
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        uniforms: {
          haze: { value: HAZE.clone() },
          glow: { value: SKY_GLOW.clone() },
          top: { value: SKY_TOP.clone() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 haze; uniform vec3 glow; uniform vec3 top;
          varying vec3 vDir;
          void main() {
            float e = normalize(vDir).y;               // sin(elevation)
            vec3 c = mix(haze, glow, smoothstep(0.0, 0.05, e));
            c = mix(c, top, smoothstep(0.03, 0.24, e));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    sky.name = "Sky";
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    scene.add(sky);
    this.sky = sky;
    const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
    sun.name = "Sun";
    sun.position.copy(SUN_DIR).multiplyScalar(2000);
    scene.add(sun);
    const hemi = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY);
    hemi.name = "Hemisphere";
    scene.add(hemi);
  }

  /**
   * Record each LM_* landmark's world box and the point its marker hangs from.
   *
   * The box is the landmark's own geometry plus only those descendant parts
   * whose world XZ centre lies within LANDMARK_CHILD_RADIUS of it. On the old
   * asset box.setFromObject() swallowed a lamp 818 units away and put area 1's
   * marker 367 units off its lighthouse; on the v2 asset the same rule keeps
   * the lamp and the windmill blades, which sit where they belong.
   */
  private indexLandmarks(root: THREE.Object3D) {
    const own = new THREE.Box3();
    const part = new THREE.Box3();
    const isPrimitiveOf = (child: THREE.Object3D, parent: THREE.Object3D) =>
      child.parent === parent &&
      !(parent as THREE.Mesh).isMesh &&
      (child as THREE.Mesh).isMesh &&
      !child.name.startsWith("LM_");
    const meshBox = (m: THREE.Mesh, out: THREE.Box3) => {
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      return out.copy(g.boundingBox!).applyMatrix4(m.matrixWorld);
    };

    this.landmarks.clear();
    root.traverse((o) => {
      if (!o.name.startsWith("LM_") || !isShown(o)) return;
      own.makeEmpty();
      // Its own geometry: the mesh itself, or, for a multi-primitive glTF
      // mesh that arrives as a Group, its direct primitive children.
      if ((o as THREE.Mesh).isMesh) {
        own.union(meshBox(o as THREE.Mesh, part));
      } else {
        for (const c of o.children) {
          if (isPrimitiveOf(c, o)) own.union(meshBox(c as THREE.Mesh, part));
        }
      }
      // A rebuilt landmark may nest its meshes a level down: then all of them are its own.
      if (own.isEmpty()) {
        o.traverse((d) => {
          if (d !== o && (d as THREE.Mesh).isMesh && isShown(d)) own.union(meshBox(d as THREE.Mesh, part));
        });
      }
      if (own.isEmpty()) return;
      const cx = (own.min.x + own.max.x) / 2;
      const cz = (own.min.z + own.max.z) / 2;
      const meshes: THREE.Mesh[] = [];
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
      o.traverse((d) => {
        if (d === o || !(d as THREE.Mesh).isMesh || !isShown(d)) return;
        if (isPrimitiveOf(d, o)) {
          meshes.push(d as THREE.Mesh);
          return;
        }
        meshBox(d as THREE.Mesh, part);
        const dx = (part.min.x + part.max.x) / 2 - cx;
        const dz = (part.min.z + part.max.z) / 2 - cz;
        if (Math.hypot(dx, dz) <= LANDMARK_CHILD_RADIUS) meshes.push(d as THREE.Mesh);
      });
      const lm = buildLandmark(meshes, this.heightfield ? this.surface : null);
      if (lm) this.landmarks.set(o.name, lm);
    });
    this.lmList.length = 0;
    for (const lm of this.landmarks.values()) this.lmList.push(lm);
  }

  /**
   * The three water bodies ridge.py builds: a rectangle (Sea) and two discs
   * (Lake, Pond); and the houses, which block sight lines. With `keep`, a
   * list that comes back empty (a module renamed or merged them) keeps the
   * one found in the glb.
   */
  private indexWater(root: THREE.Object3D, keep: boolean) {
    const occ: THREE.Box3[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && /^(House|Cottage)/i.test(o.name) && isShown(o)) occ.push(new THREE.Box3().setFromObject(o));
    });
    if (occ.length || !keep) {
      this.occluders.length = 0;
      this.occluders.push(...occ);
    }
    const found: typeof this.water = [];
    const box = new THREE.Box3();
    for (const name of ["Sea", "Lake", "Pond"]) {
      const o = root.getObjectByName(name);
      if (!o || !isShown(o)) continue;
      box.setFromObject(o);
      if (box.isEmpty()) continue;
      found.push({
        y: box.max.y,
        cx: (box.min.x + box.max.x) / 2,
        cz: (box.min.z + box.max.z) / 2,
        rx: Math.max(1e-3, (box.max.x - box.min.x) / 2),
        rz: Math.max(1e-3, (box.max.z - box.min.z) / 2),
        round: name !== "Sea",
      });
    }
    if (found.length || !keep) {
      this.water.length = 0;
      this.water.push(...found);
    }
  }

  /**
   * The sea is a smooth, glossy surface: nearly all reflection. There is no
   * environment in this scene to reflect, so three.js returned the dark base
   * colour and the bottom quarter of the opening view was a flat plum band
   * that read as the edge of the world (ridge.py's own note: "WATER NEEDS A
   * FLOOR OR THE BROWSER RENDERS IT BLACK"). It gets the sky it sits under:
   * the same gradient the sky dome draws, as a small prefiltered map on this
   * one material. Grazing angles then pick up the haze and near water the
   * dusk violet, which is what a sea at sunset does.
   */
  private giveSeaTheSky(root: THREE.Object3D) {
    const renderer = this.renderer;
    const sea = root.getObjectByName("Sea") as THREE.Mesh | undefined;
    if (!renderer || !sea?.isMesh || Array.isArray(sea.material)) return;
    const mat = sea.material as THREE.MeshStandardMaterial;
    if (!mat.isMeshStandardMaterial) return;
    const W = 64;
    const H = 128;
    const data = new Float32Array(W * H * 4);
    const c = new THREE.Color();
    const sstep = (a: number, b: number, x: number) => {
      const t = clamp01((x - a) / (b - a));
      return t * t * (3 - 2 * t);
    };
    for (let row = 0; row < H; row++) {
      // Equirect v runs bottom (0) to top (1); row 0 is v = 0.
      const e = Math.sin(((row + 0.5) / H - 0.5) * Math.PI);
      c.copy(HAZE).lerp(SKY_GLOW, sstep(0, 0.05, e));
      c.lerp(SKY_TOP, sstep(0.03, 0.24, e));
      for (let col = 0; col < W; col++) {
        const o = (row * W + col) * 4;
        data[o] = c.r;
        data[o + 1] = c.g;
        data[o + 2] = c.b;
        data[o + 3] = 1;
      }
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(renderer);
    try {
      this.seaEnv = pmrem.fromEquirectangular(tex);
      mat.envMap = this.seaEnv.texture;
      mat.needsUpdate = true;
    } finally {
      pmrem.dispose();
      tex.dispose();
    }
  }

  /** See trap 1. Only the pins, the ridges' own silhouettes, water and the lighthouse lamp keep emission. */
  private stripHazeEmissive(root: THREE.Object3D): number {
    const GLOWS = /^(Pin\d|RidgeMat\d|(Lake|Pond)Mat|LM_LighthouseLampMat)$/;
    let cleaned = 0;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats as THREE.MeshStandardMaterial[]) {
        // The lamp is exported at emissive strength 14, which ACES clips to a
        // flat white block. At LAMP_GLOW it still reads as a lit lantern.
        if (m && m.name === "LM_LighthouseLampMat" && m.emissiveIntensity > LAMP_GLOW) {
          m.emissiveIntensity = LAMP_GLOW;
        }
        if (!m || !m.emissive || GLOWS.test(m.name)) continue;
        if (m.emissive.getHex() === 0) continue;
        m.emissive.setHex(0x000000);
        cleaned++;
      }
    });
    return cleaned;
  }

  /**
   * Cap the fog below 1, so the farthest ridges keep a faint silhouette
   * against a sky whose horizon is the haze itself. Scoped to this scene's
   * own materials: patching THREE.ShaderChunk would restyle every other
   * three.js page in the same session, /dev/world-codex included.
   */
  private patchFog(root: THREE.Object3D) {
    const fogMax = this.fogMax;
    const patched = new Set<THREE.Material>();
    // One shader text for every material (so they share programs); the floor
    // is a per-material uniform. The ridge cards get RIDGE_FOG_MIN: they are
    // flat far silhouettes, and at the summit the camera comes within 870
    // units of Ridge0, where the ramp left it 32% hazed and it showed as a
    // hard dark card (a 51-luma step at its top edge against 15 for Ridge1).
    const noFloor = { value: 0 };
    const ridgeFloor = { value: RIDGE_FOG_MIN };
    const makeHook = (fogMin: { value: number }) => (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.fogMax = fogMax;
      shader.uniforms.fogMin = fogMin;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <fog_pars_fragment>", "#include <fog_pars_fragment>\nuniform float fogMax;\nuniform float fogMin;")
        .replace(
          "#include <fog_fragment>",
          `#ifdef USE_FOG
             float fogFactor = max( fogMin, fogMax * smoothstep( fogNear, fogFar, vFogDepth ) );
             gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
           #endif`,
        );
    };
    // A module may already hook a material's shader (the terrain's brush
    // texture, say). Its hook runs first and ours after, and the program
    // cache key carries both, so two materials with different module hooks
    // never share a program.
    const proto = THREE.Material.prototype;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh === this.sky) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m || patched.has(m) || (m as THREE.ShaderMaterial).isShaderMaterial) continue;
        if (!(m as THREE.MeshStandardMaterial).fog) continue;
        const ridge = /^RidgeMat\d$/.test(m.name);
        const hook = makeHook(ridge ? ridgeFloor : noFloor);
        // surfaces.ts and forest.ts install onBeforeCompile as a getter/setter
        // that chains whatever is assigned to it. Wrapping their getter's
        // function and assigning the wrapper back through their setter makes
        // their hook call ours call theirs: infinite recursion at compile.
        // So a material that chains gets our plain hook and does the rest.
        const chains = !!Object.getOwnPropertyDescriptor(m, "onBeforeCompile")?.set;
        const prev = !chains && m.onBeforeCompile !== proto.onBeforeCompile ? m.onBeforeCompile : null;
        const prevKey = m.customProgramCacheKey !== proto.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
        const prevKeyText = prev ? prev.toString() : "";
        m.onBeforeCompile = prev
          ? (shader, renderer) => {
              prev.call(m, shader, renderer);
              hook(shader);
            }
          : hook;
        m.customProgramCacheKey = () => `${prevKey ? prevKey() : prevKeyText}|v3fog${ridge ? "R" : ""}`;
        m.needsUpdate = true;
        patched.add(m);
      }
    });
  }

  // ── Anchors and landmarks ──────────────────────────────────────────────────

  setAnchors(anchors: AreaAnchor[]): void {
    this.anchors = anchors.slice();
    this.depthCache.clear();
    // One array for the lifetime of the scene; objects reused by slot.
    const markers = this.markers;
    markers.length = Math.min(markers.length, anchors.length);
    for (let i = 0; i < anchors.length; i++) {
      if (!markers[i]) markers[i] = { id: anchors[i].id, x: 0, y: 0, visible: false, proximity: 0 };
      else markers[i].id = anchors[i].id;
    }
    this.resolveAnchors();
    if (this.parkedId && !this.anchors.some((a) => a.id === this.parkedId)) this.park(null);
    this.dirty = true;
    this.wake();
  }

  /** Where each anchor's marker hangs: its landmark's top, else the rail's look point at its depth. */
  private resolveAnchors() {
    const out = this.anchorPos;
    out.length = Math.min(out.length, this.anchors.length);
    this.anchorLm.length = this.anchors.length;
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      if (!out[i]) out[i] = new THREE.Vector3();
      const lm = a.landmark ? this.landmarks.get(a.landmark) : undefined;
      this.anchorLm[i] = lm ?? null;
      if (lm) {
        out[i].copy(lm.top);
      } else {
        this.rail.sample(Math.min(MAX_RAIL_DEPTH, Math.max(0, a.depth)), this.railPose);
        out[i].copy(this.railPose.target);
      }
    }
  }

  landmarkNames(): string[] {
    return [...this.landmarks.keys()].sort();
  }

  depthFor(anchorId: string): number {
    const cached = this.depthCache.get(anchorId);
    if (cached !== undefined) return cached;
    const a = this.anchors.find((x) => x.id === anchorId);
    if (!a) return this.currentDepth;
    const lm = a.landmark ? this.landmarks.get(a.landmark) : undefined;
    let d = a.depth;
    if (lm) {
      const nearest = this.rail.depthNearest(lm.center.x, lm.center.z);
      if (Number.isFinite(nearest)) d = nearest;
    }
    d = Math.min(MAX_RAIL_DEPTH, Math.max(0, d));
    // Cache only once the landmarks are known, so a pre-load answer is not kept.
    if (this.ready) this.depthCache.set(anchorId, d);
    return d;
  }

  // ── Scroll ─────────────────────────────────────────────────────────────────

  /** Rail depth the page scroll maps to right now (fresh layout read; event handlers only). */
  scrollDepth(): number {
    this.cacheScroll();
    return this.readScrollDepth(this.targetDepth);
  }

  /**
   * Put the rail at a depth without reading the page scroll. For a scene
   * created while a place is open (the page is scroll-locked, and after the
   * list view it may be clamped to 0): without it, the camera flew home to
   * the shore and then glided back.
   */
  seedDepth(depth: number): void {
    const d = Math.min(MAX_RAIL_DEPTH, Math.max(0, depth));
    this.targetDepth = d;
    this.currentDepth = d;
    if (this.mode === "rail") this.placeOnRail(d);
    this.wake();
  }

  /** True while the WebGL context is lost: no frames will come until it is restored. */
  isContextLost(): boolean {
    return this.contextLost;
  }

  scrollYForDepth(depth: number): number {
    // Called from event handlers, never from the frame loop, so a fresh
    // layout read here is fine and keeps the answer exact.
    this.cacheScroll();
    if (this.maxScroll <= 0) return 0;
    return clamp01(depth / MAX_RAIL_DEPTH) * this.maxScroll;
  }

  /** Scroll position as rail depth. `fallback` when the page cannot scroll (spacer collapsed or locked). */
  private readScrollDepth(fallback: number): number {
    if (this.maxScroll <= 0) return fallback;
    return clamp01(window.scrollY / this.maxScroll) * MAX_RAIL_DEPTH;
  }

  // ── Park ───────────────────────────────────────────────────────────────────

  park(anchorId: string | null): void {
    if (anchorId === this.parkedId) {
      // Same place twice is a no-op; so is "back to the rail" when already there or on the way.
      return;
    }
    if (anchorId !== null && !this.anchors.some((a) => a.id === anchorId)) {
      console.warn("[world-v3] park: unknown anchor", anchorId);
      return;
    }
    if (anchorId === null) {
      this.parkedId = null;
      this.parkPending = false;
      if (this.mode === "rail") return;
      this.startFlight(true);
      return;
    }
    this.parkedId = anchorId;
    if (!this.ready) {
      this.parkPending = true;
      return;
    }
    this.beginPark(anchorId);
  }

  private beginPark(anchorId: string) {
    this.computeParkPose(anchorId);
    this.startFlight(false);
  }

  /** Start a flight from wherever the camera is now, carrying its current velocity so nothing snaps. */
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
    // Parked at one place and sent to another: progress was held at 1 for
    // the whole flight, so nothing tied to it moved. It dips instead.
    this.switchDip = !toRail && this.parkProgress >= 0.999;
    let dest: THREE.Vector3;
    if (toRail) {
      this.railLookPose(this.currentDepth, this.v1, this.v2);
      dest = this.v1;
    } else {
      dest = this.parkPos;
    }
    const dist = this.fromPos.distanceTo(dest);
    this.flightDuration = this.reducedMotion
      ? 0
      : FLIGHT_T_MIN + (FLIGHT_T_MAX - FLIGHT_T_MIN) * clamp01(dist / FLIGHT_FAR);
    this.mode = "flight";
    this.dirty = true;
    this.wake();
  }

  /** Solve the park camera for an anchor (see solveParkPose) and store it as the flight's destination. */
  private computeParkPose(anchorId: string) {
    const a = this.anchors.find((x) => x.id === anchorId);
    const lm = a?.landmark ? this.landmarks.get(a.landmark) : undefined;
    const camera = this.camera;
    if (!a || !camera) return;
    if (!lm) {
      // No landmark in this glb: park on the rail at the area's own stop.
      this.railLookPose(Math.min(MAX_RAIL_DEPTH, Math.max(0, a.depth)), this.parkPos, this.parkLook);
      this.parkDistance = LOOK_DIST;
      this.lastPark = null;
      return;
    }
    this.rail.sample(this.depthFor(anchorId), this.railPose);
    const r = solveParkPose({
      landmark: lm,
      others: this.lmList,
      railPos: this.railPose.position,
      railTarget: this.railPose.target,
      aspect: camera.aspect,
      widthPx: this.width,
      surface: this.heightfield ? this.surface : null,
      occluders: this.occluders,
      sunDir: SUN_DIR,
      trees: this.trees,
    });
    const pos = r.pos;
    const look = r.look;
    // Never below the ground under the camera.
    if (this.heightfield) {
      const g = this.heightfield.heightAt(pos.x, pos.z) + PARK_CLEARANCE;
      if (pos.y < g) {
        look.y += g - pos.y;
        pos.y = g;
      }
    }
    this.parkPos.copy(pos);
    this.parkLook.copy(look);
    this.parkDistance = r.dist;
    this.lastPark = r;
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  /** Rail pose at a depth, with the look point re-projected to LOOK_DIST. */
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

  /** Advance the camera one frame. dt is already clamped. */
  private updateCamera(dt: number) {
    if (this.mode === "rail") {
      this.flightNow = 1;
      this.placeOnRail(this.currentDepth);
    } else if (this.mode === "parked") {
      this.flightNow = 1;
      this.camPos.copy(this.parkPos);
      this.camLook.copy(this.parkLook);
    } else {
      this.flightElapsed += dt;
      const T = this.flightDuration;
      const s = T <= 0 ? 1 : clamp01(this.flightElapsed / T);
      // The destination is live when returning: the rail pose at the depth
      // the page is scrolled to, which may still be gliding.
      if (this.flightToRail) this.railLookPose(this.currentDepth, this.v1, this.v2);
      const toPos = this.flightToRail ? this.v1 : this.parkPos;
      const toLook = this.flightToRail ? this.v2 : this.parkLook;
      flightPoint(this.camPos, this.fromPos, this.v0Pos, toPos, s, T);
      flightPoint(this.camLook, this.fromLook, this.v0Look, toLook, s, T);
      const q = flightEase(s);
      this.flightNow = q;
      this.parkProgress = this.switchDip
        ? 1 - PARK_SWITCH_DIP * Math.sin(Math.PI * q)
        : this.progFrom + (this.progTo - this.progFrom) * q;
      if (s < 1 && this.heightfield) {
        // A straight flight can graze a hill between rail and landmark. The
        // clamp is a smooth max, so engaging it never kinks the motion.
        const g = this.heightfield.heightAt(this.camPos.x, this.camPos.z) + PARK_CLEARANCE;
        const y = smoothMax(this.camPos.y, g, 20);
        this.camLook.y += y - this.camPos.y;
        this.camPos.y = y;
      }
      if (s >= 1) {
        if (this.flightToRail) {
          this.mode = "rail";
          this.parkProgress = 0;
          this.placeOnRail(this.currentDepth);
        } else {
          this.mode = "parked";
          this.parkProgress = 1;
        }
        this.switchDip = false;
        this.flightNow = 1;
      }
    }

    // Velocity of what was actually shown, carried into the next flight.
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
    this.sky?.position.copy(this.camPos);
  }

  private updateFog() {
    // The atmosphere module sets the colour, and may swap the Fog object; the
    // distances are scheduled here on whatever linear fog the scene has.
    const sf = this.scene?.fog as THREE.Fog | null | undefined;
    const fog = sf && (sf as THREE.Fog).isFog ? sf : null;
    if (!fog) return;
    fogTable(this.currentDepth, this.fogRange);
    let near = this.fogRange.near;
    let far = this.fogRange.far;
    const p = this.parkProgress;
    if (p > 0) {
      // Parked, the landmark can sit further out than the rail's stop; push
      // the clear zone past it so the place you flew to is never hazed.
      const pushed = Math.max(near, this.parkDistance * 1.15 + 40);
      const span = far - near;
      near += (pushed - near) * p;
      far = near + span;
    }
    fog.near = near;
    fog.far = far;
  }

  /** Screen rect (CSS px) of every landmark's visible box and its camera distance, into lmRects. */
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
    const fogFar = sf && sf.isFog ? sf.far : 3000;
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
      // View space first: project() mirrors points behind the camera onto the screen.
      p.copy(at);
      if (lm) p.set(lm.visCenter.x, lm.vis.max.y, lm.visCenter.z);
      p.applyMatrix4(camera.matrixWorldInverse);
      const ahead = p.z < -camera.near;
      const distance = lm ? lm.center.distanceTo(this.camPos) : at.distanceTo(this.camPos);
      p.applyMatrix4(camera.projectionMatrix);
      const x = (p.x * 0.5 + 0.5) * w;
      let top = (-p.y * 0.5 + 0.5) * h;
      if (lm && ahead) {
        // The pin hangs over the landmark's HIGHEST point on screen. The top
        // centre was right for the towers, but the jetty runs 106 units away
        // from the camera, its far end projected above the pin, and the pin
        // sat on the deck.
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
      // Lift in SCREEN pixels: a fixed world offset is ~170px up close and ~8px in the haze.
      let y = top - MARKER_LIFT_PX;
      if (lm && this.pinOnLandmarkBehind(lm, x, y, distance)) y = top - MARKER_LIFT_MIN_PX;
      m.x = x;
      m.y = y;
      m.visible = ahead && x >= 0 && x <= w && y >= 0 && y <= h;
      m.proximity = clamp01(1 - (distance - 300) / Math.max(1, fogFar - 300));
    }
  }

  /**
   * Does (x, y) fall on the screen rect of a landmark standing further away
   * than `dist`? Only asked while `own` is small on screen: up close the pin
   * is plainly its own landmark's, and the short lift left the watchtower's
   * pin touching its roof.
   */
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

  /** Resume the loop if it is asleep. Cheap to call from any event. */
  private wake() {
    this.dirty = true;
    if (this.animTimer !== null) {
      // An animation frame was waiting out the 30 fps cap; this one goes now.
      clearTimeout(this.animTimer);
      this.animTimer = null;
    }
    if (this.disposed || !this.started || this.raf) return;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  /**
   * Only a module animates: the next frame, no sooner than 1/ANIM_FPS after
   * this one. A timer, so the page is not woken 60 times a second to skip
   * half the frames. Stops with the loop (hidden tab, pause, dispose).
   */
  private scheduleAnimFrame() {
    if (this.animTimer !== null || this.raf || this.disposed) return;
    const wait = Math.max(0, 1000 / ANIM_FPS - (performance.now() - this.lastTime) - 2);
    this.animTimer = setTimeout(() => {
      this.animTimer = null;
      if (this.disposed || this.raf) return;
      this.raf = requestAnimationFrame(this.tick);
    }, wait);
  }

  /** Advance every module; true if any of them has something moving on screen. */
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
        console.error(`[world-v3] module ${rec.name} update threw; it is no longer updated`, e);
      }
    }
    return animating;
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    // Paused, hidden or without a context: stop. wake() restarts it.
    if (this.paused || this.contextLost || document.hidden) return;

    let dt = (now - this.lastTime) / 1000;
    dt = dt < 0 ? 0 : dt > MAX_DT ? MAX_DT : dt;
    this.lastTime = now;

    // While parked, or flying in to park, the page scroll is locked by the
    // interface and ignored here. Flying back, the destination follows it.
    const scrollLocked = this.parkedId !== null;
    if (!scrollLocked) this.targetDepth = this.readScrollDepth(this.targetDepth);
    // Reduced motion: the scroll already jumps (dock travel is instant), so
    // the camera does too instead of gliding 1.8 s after it.
    if (this.reducedMotion) this.currentDepth = this.targetDepth;
    this.currentDepth += (this.targetDepth - this.currentDepth) * (1 - Math.exp(-SMOOTHING * dt));
    const converged = Math.abs(this.targetDepth - this.currentDepth) < DEPTH_EPS;
    if (converged) this.currentDepth = this.targetDepth;

    if (this.parkPending && this.ready && this.parkedId) {
      this.parkPending = false;
      this.beginPark(this.parkedId);
    }

    this.updateCamera(dt);
    this.updateFog();
    // After the camera, so a module that follows it (the sky dome) sees this frame's pose.
    const animating = this.ready && this.updateModules(dt) && !this.reducedMotion;

    const renderer = this.renderer;
    if (this.ready && renderer && this.scene && this.camera) {
      renderer.render(this.scene, this.camera);
      this.frame.triangles = renderer.info.render.triangles;
      this.frame.calls = renderer.info.render.calls;
    }
    this.projectMarkers();
    this.frame.depth = this.currentDepth;
    this.frame.parkedId = this.parkedId;
    this.frame.parkProgress = this.parkProgress;
    this.frame.flight = this.flightNow;
    this.frameCb?.(this.frame);

    // Idle sleep: nothing moving, nothing pending. A scroll, resize, park or
    // new callback wakes it.
    const moving = !converged || this.mode === "flight" || this.parkPending;
    if (!moving && !this.dirty) {
      this.velPos.set(0, 0, 0);
      this.velLook.set(0, 0, 0);
      // Something on screen animates by itself: keep drawing, at ANIM_FPS.
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

  /** Camera position and unit forward direction. For the render harness only. */
  cameraPose(): { x: number; y: number; z: number; dx: number; dy: number; dz: number } {
    const d = this.v1.copy(this.camLook).sub(this.camPos).normalize();
    return { x: this.camPos.x, y: this.camPos.y, z: this.camPos.z, dx: d.x, dy: d.y, dz: d.z };
  }

  /** What the last park solve chose. For the render harness only. */
  parkInfo(): {
    dist: number;
    railDist: number;
    pitch: number;
    yaw: number;
    visible: number;
    score: number;
    heightFrac: number;
    backlit: number;
    blockedLow: number;
    touching: boolean;
  } | null {
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

  /** The lower-third test at the camera's current pose, with and without the trees. For the harness. */
  debugLowerThird(): { withTrees: number; withoutTrees: number; trees: number } | null {
    const a = this.anchors.find((x) => x.id === this.parkedId);
    const lm = a?.landmark ? this.landmarks.get(a.landmark) : undefined;
    if (!lm || !this.camera || !this.heightfield) return null;
    const left = -1 + (2 * PANEL_CLEAR_PX) / Math.max(1, this.width);
    return {
      withTrees: lowerThirdBlocked(lm, this.camera, this.surface, left, this.trees),
      withoutTrees: lowerThirdBlocked(lm, this.camera, this.surface, left),
      trees: this.trees ? this.trees.length / 5 : 0,
    };
  }

  /** Install time or failure per look module, and each module's own stats(). For the harness. */
  moduleStats(): Record<string, unknown> {
    const out: Record<string, unknown> = { install: { ...this.moduleReport }, pitch: this.pitchMode };
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
        console.error(`[world-v3] module ${rec.name} dispose threw`, e);
      }
    }
    this.modules.length = 0;
    const w = typeof window !== "undefined" ? (window as unknown as { __worldV3Debug?: WorldScene }) : null;
    if (w && w.__worldV3Debug === this) delete w.__worldV3Debug;
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("scroll", this.onScroll);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.motionQuery?.removeEventListener?.("change", this.onMotionChange);
    this.resizeObserver?.disconnect();
    this.bodyObserver?.disconnect();
    this.resizeObserver = null;
    this.bodyObserver = null;

    // GPU resources are not garbage collected. Without this, every remount
    // of the page leaks a whole world.
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
    this.seaEnv?.dispose();
    this.seaEnv = null;
    this.scene?.clear();
    const canvas = this.renderer?.domElement;
    canvas?.removeEventListener("webglcontextlost", this.onContextLost);
    canvas?.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.renderer?.dispose();
    // dispose() frees three's objects but leaves the WebGL context alive until
    // GC; each list/world crossing made a new one. Release it now.
    this.renderer?.forceContextLoss();
    if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.sky = null;
    this.fog = null;
  }
}
