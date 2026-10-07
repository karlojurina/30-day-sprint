import type * as THREE from "three";

/**
 * The v3 camera rail: where the camera stands and what it looks at, as a pure
 * function of rail depth. No DOM, no scene, no allocation per sample.
 *
 * V3 against V2 (world-tests/v3-rail.test.mjs):
 *   - Pitch climbs from 8 degrees down at the shore to 16 in the high valley
 *     (V2: 5.2 to 7.1). Astra runs 7.6 to 21.8. The climb is a smootherstep,
 *     so pitch, its rate and its acceleration are all continuous.
 *   - The height drops at the area stops are re-sized for that pitch
 *     (V3_DROP_KNOTS), and the start is lifted instead of lowered, so the
 *     opening view is shore and valley over a strip of sea, not a sea band.
 *   - createRail({ pitch: "low" }) is V2's rail exactly (V2 pitch AND V2's
 *     drops), for ?pitch=low. The test compares the two sample by sample.
 *
 * What it fixes over /dev/world (measured in world-tests/v2-rail.test.mjs):
 *   - The old camera sat at x = 0 and never turned. This one follows the
 *     walking path sideways and yaws into its bends, the aim leading the body.
 *   - The old height had a slope kink at depth 0.45 (a 3.19x step in vertical
 *     speed). The climb here is C2: value, slope and curvature all continuous.
 *   - Nothing maps depth to a curve parameter piecewise-linearly (Astra's
 *     defect: a 1.29x speed step at every knot where segment lengths differ).
 *     Every component is a smooth function of depth, tabulated finely and read
 *     back with Catmull-Rom, which keeps velocity continuous.
 *
 * Coordinates are three/glTF (Y up). World fraction t runs along the valley:
 * three z = LEN_Y/2 - t*LEN_Y, so the camera travels toward -z.
 */

export interface RailPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export interface RailOptions {
  /** "v3" (default): 8 -> 16 degrees. "low": V2's rail exactly, 5.2 -> 7.1. */
  pitch?: "v3" | "low";
  /** Override the drop knots ([depth, units down]). For the framing study only. */
  dropKnots?: ReadonlyArray<readonly [number, number]>;
}

export interface Rail {
  /** depth in 0..0.88 rail units, clamped. Writes into `out`, allocates nothing. */
  sample(depth: number, out: RailPose): void;
  /** Terrain follow once the ground is known; null removes it. Lifts the
   *  camera to >= 40 above ground with a smooth max; keeps the look target
   *  >= 5 above ground by moving it along the view ray, so the view direction
   *  and pitch never change. */
  setGround(fn: ((x: number, z: number) => number) | null): void;
  /** Rail depth whose view best frames (x, z): the depth at which (x, z) is
   *  350 units along the view, as check_geom.py placed the area depths. */
  depthNearest(x: number, z: number): number;
  /** The walking path's lateral x at a world z. */
  pathXAtZ(z: number): number;
  /** Height taken off the base climb at this depth (see DROP_KNOTS). */
  dropAt(depth: number): number;
  /** Degrees below horizontal at this depth, before terrain follow (which keeps it). */
  pitchAt(depth: number): number;
}

// --- World (MUST MATCH ridge.py) -------------------------------------------
const LEN_X = 620;
const LEN_Y = 2000;
const HALF_X = LEN_X * 0.5;
const MAX_RAIL_DEPTH = 0.88;

/** ridge.py PATH_WAYPOINTS: (t, x as a fraction of half-width). */
const PATH_WAYPOINTS: ReadonlyArray<readonly [number, number]> = [
  [0.055, 0.0],
  [0.135, -0.4],
  [0.265, 0.34],
  [0.378, 0.0],
  [0.5, 0.098],
  [0.59, -0.24],
  [0.615, -0.3],
  [0.73, -0.26],
  [0.7875, 0.12],
  [0.86, 0.1],
  [0.94, -0.1],
  [1.0, -0.1],
];

/** ridge.py path_x_at: smoothstep between waypoints, constant past the ends. */
function pathFraction(t: number): number {
  const pts = PATH_WAYPOINTS;
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const t0 = pts[i][0];
    const t1 = pts[i + 1][0];
    if (t >= t0 && t <= t1) {
      let k = (t - t0) / Math.max(1e-6, t1 - t0);
      k = k * k * (3 - 2 * k);
      return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k;
    }
  }
  return pts[pts.length - 1][1];
}

const zOfT = (t: number) => LEN_Y * 0.5 - t * LEN_Y;

// --- Forward motion and pitch (unchanged from /dev/world) -------------------
// Camera t = -0.115 + 1.06 * depth. The look point is 900 units further on.
const CAM_T0 = -0.115;
const T_PER_DEPTH = 1.06;
const LOOK_DIST = 900;
const LOOK_T = LOOK_DIST / LEN_Y;

// --- Height: the old kink replaced by a C2 climb ---------------------------
// Below depth 0.25 the slope is 96/depth; above 0.65 it is 96 + 210. Between,
// u^3 - u^4/2 blends slope AND curvature to zero at both ends.
const CLIMB_MID = 0.45;
const CLIMB_BLEND = 0.2;
const CLIMB_RATE = 210;
function climb(d: number): number {
  const a = CLIMB_MID - CLIMB_BLEND;
  if (d <= a) return 0;
  if (d >= CLIMB_MID + CLIMB_BLEND) return CLIMB_RATE * (d - CLIMB_MID);
  const u = (d - a) / (2 * CLIMB_BLEND);
  return 2 * CLIMB_RATE * CLIMB_BLEND * (u * u * u - 0.5 * u * u * u * u);
}
const baseHeight = (d: number) => 108 + d * 96 + climb(d);

// --- Height: brought down at the area stops ---------------------------------
// Each area's stop frames its landmark ~350 units ahead (FRAME_DIST). From the
// base height (115-195 units over the ground there) at a 5-7 degree pitch, the
// landmark's base sat 19-20 degrees under the horizon, and the frame's bottom
// edge is ~21: every landmark stood in the bottom 15% of the frame, behind the
// NEXT block and the dock (a8's obelisk 27% under the dock on split, 48% on a
// laptop). Pitch is Lovro's and stays; the camera comes down instead, the
// look target with it, so the pitch is exactly unchanged. Knots are [depth,
// units down] at the area stops, sized so each landmark's base lands at or
// above ~74% of the frame height (world-tests/v2-fix-framing.mjs --need).
// The start stays high: over the sea a low camera sees a wide band of water.
// V2's knots, used unchanged by createRail({ pitch: "low" }).
const V2_DROP_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0],
  [0.068, 32], // a1 lighthouse
  [0.193, 42], // a2 windmill
  [0.301, 44], // a3 bridge
  [0.416, 42], // a4 viaduct
  [0.529, 50], // a5 watchtower
  [0.629, 46], // a6 cairn
  [0.7, 58], // a7 jetty
  [0.831, 45], // a8 obelisk
  [0.94, 45],
];
/**
 * V3's knots, sized by world-tests/v3-rail-framing.mjs on the shipped terrain
 * so each landmark's box centre sits at 55-66% of the frame height from the
 * top and its base no lower than 73% (split, ultra and laptop agree to 0.01).
 * The steeper pitch already lowers the view, so the stops need far less drop
 * than V2's 32-58 units.
 *
 * THE START IS A LIFT (-80). V2's opening camera stood 132 units over open
 * sea, 450 units out from the shore, and the bottom quarter of the frame was
 * flat water (6 of 24 rows, measured). At V3's 8 degrees that grew to 8 rows.
 * Raised 80 units, the frame's bottom edge lands just short of the shoreline:
 * 3 rows of water as a foreground strip, the shore, 15 rows of land, 5 of
 * sky. The camera then glides down onto a1 (lighthouse base at 73%).
 */
const V3_DROP_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0.0, -80], // the opening view: lifted over the bay
  [0.068, 22], // a1 lighthouse
  [0.193, 26], // a2 windmill
  [0.301, 17], // a3 bridge
  [0.416, 6], // a4 viaduct
  [0.529, 0], // a5 watchtower
  [0.629, 0], // a6 cairn
  [0.7, 15], // a7 jetty
  [0.831, 0], // a8 obelisk
  [0.94, 0],
];
/** Gaussian smoothing of the knot curve, in depth. Keeps the vertical motion free of steps. */
const DROP_SIGMA = 0.02;
function dropKnots(k: ReadonlyArray<readonly [number, number]>, d: number): number {
  if (d <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i++) {
    if (d <= k[i + 1][0]) {
      let u = (d - k[i][0]) / (k[i + 1][0] - k[i][0]);
      u = u * u * (3 - 2 * u);
      return k[i][1] + (k[i + 1][1] - k[i][1]) * u;
    }
  }
  return k[k.length - 1][1];
}
/** V2's pitch, degrees below horizontal: 5.2 at the shore to 7.1 at the top. */
const pitchLow = (d: number) => 5.2 + d * 2.2;

/**
 * V3's pitch: 8 degrees at the shore, 16 from the high valley on. Held at 8
 * until PITCH_D0 so the opening view keeps its sky, then a smootherstep to
 * PITCH_D1 (a8's stop), which is C2: no step in the rate the view tilts at.
 */
const PITCH_LO = 8;
const PITCH_HI = 16;
const PITCH_D0 = 0.06;
const PITCH_D1 = 0.83;
function pitchV3(d: number): number {
  const u = Math.min(1, Math.max(0, (d - PITCH_D0) / (PITCH_D1 - PITCH_D0)));
  return PITCH_LO + (PITCH_HI - PITCH_LO) * u * u * u * (u * (u * 6 - 15) + 10);
}

// --- Lateral: follow the path, aim into the bends ---------------------------
// The path is blurred twice. ROAD is wide (sigma 0.065 in t), so the body
// makes about four long sweeps rather than chasing every wiggle; the gain
// gives back the amplitude that blur costs, so the sweeps are still big
// (174 units side to side; 120 without the gain, which misses the 150 target).
// ROAD is read 350 units AHEAD of the camera (ROAD_LEAD), which is where the
// ground first enters the bottom of the frame and where each landmark stands
// when its area is reached. That keeps the path entering the frame near the
// centre and pulls each landmark toward the middle on arrival (worst landmark
// 0.49 of half-width off centre, against 0.71 for the old straight rail).
// AIM is tighter (sigma 0.030) and read at the look point, 900 ahead, so the
// heading turns into a bend before the body slides into it (heading leads
// lateral velocity by 0.12 depth, correlation 0.80; Astra's lead is 0.095).
const ROAD_SIGMA = 0.065;
const ROAD_GAIN = 1.45;
const ROAD_LEAD = 0.175;
const AIM_SIGMA = 0.03;

const GRID_T0 = -0.3;
const GRID_T1 = 1.4;
const GRID_N = 512;
const GRID_DT = (GRID_T1 - GRID_T0) / (GRID_N - 1);

/** Path x (fraction) on the t grid, Gaussian-blurred. The path is constant
 *  past both ends, so clamping at the grid edge is exact. */
function blurredPath(sigma: number): Float64Array {
  const raw = new Float64Array(GRID_N);
  for (let i = 0; i < GRID_N; i++) raw[i] = pathFraction(GRID_T0 + i * GRID_DT);
  const r = Math.ceil((4 * sigma) / GRID_DT);
  const w = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let k = -r; k <= r; k++) {
    const v = Math.exp(-0.5 * ((k * GRID_DT) / sigma) ** 2);
    w[k + r] = v;
    sum += v;
  }
  const out = new Float64Array(GRID_N);
  for (let i = 0; i < GRID_N; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) {
      const j = Math.min(GRID_N - 1, Math.max(0, i + k));
      acc += w[k + r] * raw[j];
    }
    out[i] = acc / sum;
  }
  return out;
}

/** Uniform Catmull-Rom through samples a[i0..i3] at u in [0,1]. C1. */
function catmull(a: Float64Array, i0: number, i1: number, i2: number, i3: number, u: number): number {
  const p0 = a[i0];
  const p1 = a[i1];
  const p2 = a[i2];
  const p3 = a[i3];
  const m1 = (p2 - p0) * 0.5;
  const m2 = (p3 - p1) * 0.5;
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * p1 +
    (u3 - 2 * u2 + u) * m1 +
    (-2 * u3 + 3 * u2) * p2 +
    (u3 - u2) * m2
  );
}

function gridAt(a: Float64Array, t: number): number {
  const f = (t - GRID_T0) / GRID_DT;
  const i = Math.min(GRID_N - 2, Math.max(0, Math.floor(f)));
  const u = Math.min(1, Math.max(0, f - i));
  return catmull(a, Math.max(0, i - 1), i, i + 1, Math.min(GRID_N - 1, i + 2), u);
}

// --- The depth table ---------------------------------------------------------
// Runs past both ends of the usable range so terrain smoothing and the
// Catmull-Rom neighbours never touch an edge inside 0..0.88.
const TABLE_D0 = -0.06;
const TABLE_D1 = 0.94;
const TABLE_STEP = 1 / 1200; // 1.77 units of forward travel per sample
const TABLE_N = Math.round((TABLE_D1 - TABLE_D0) / TABLE_STEP) + 1;

// --- Terrain follow -----------------------------------------------------------
const CAM_CLEAR = 40;
const TGT_CLEAR = 5;
/** Ground is read at the camera and 4 points this far around it, so a steep
 *  bank beside the rail counts as well as the ground straight below. */
const FOOT_R = 24;
/** Smoothing window for the lift, in table samples (0.035 depth, ~74 units of
 *  travel each way). The lift is a running max over the window, then a
 *  Gaussian truncated to the same window: a smooth max. Because the kernel
 *  never reaches past the window the max was taken over, the result is never
 *  below the clearance it was asked for, and it has no kinks for the hard
 *  max(0, ...) or the heightfield's bilinear cells to leave behind. */
const LIFT_W = Math.round(0.035 / TABLE_STEP);
const LIFT_SIGMA = LIFT_W / 2.5;
/** The target's ray is marched in 6-unit steps (900 / 150), then bisected. */
const RAY_STEPS = 150;

/** Where a rail view "frames" a point: this far along the view, horizontally.
 *  Same 350 as check_geom.py's LOOKAHEAD, which set the eight area depths. */
const FRAME_DIST = 350;

export function createRail(opts: RailOptions = {}): Rail {
  const low = opts.pitch === "low";
  const pitchDeg = low ? pitchLow : pitchV3;
  const knots = opts.dropKnots ?? (low ? V2_DROP_KNOTS : V3_DROP_KNOTS);
  const N = TABLE_N;
  const road = blurredPath(ROAD_SIGMA);
  const aim = blurredPath(AIM_SIGMA);

  const px = new Float64Array(N);
  const pz = new Float64Array(N);
  const baseTx = new Float64Array(N);
  const baseTz = new Float64Array(N);
  const tx = new Float64Array(N);
  const tz = new Float64Array(N);
  const basePy = new Float64Array(N);
  const baseTy = new Float64Array(N);
  const py = new Float64Array(N);
  const ty = new Float64Array(N);
  const fx = new Float64Array(N); // framing point, for depthNearest
  const fz = new Float64Array(N);

  // The drop, blurred on the table's own grid (clamped at its ends, where the
  // knot curve is flat).
  const drop = new Float64Array(N);
  {
    const raw = new Float64Array(N);
    for (let j = 0; j < N; j++) raw[j] = dropKnots(knots, TABLE_D0 + j * TABLE_STEP);
    const r = Math.ceil((3 * DROP_SIGMA) / TABLE_STEP);
    let wsum = 0;
    const w = new Float64Array(2 * r + 1);
    for (let k = -r; k <= r; k++) {
      w[k + r] = Math.exp(-0.5 * ((k * TABLE_STEP) / DROP_SIGMA) ** 2);
      wsum += w[k + r];
    }
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += w[k + r] * raw[Math.min(N - 1, Math.max(0, j + k))];
      drop[j] = acc / wsum;
    }
  }

  for (let j = 0; j < N; j++) {
    const d = TABLE_D0 + j * TABLE_STEP;
    const tc = CAM_T0 + T_PER_DEPTH * d;
    const h = baseHeight(d) - drop[j];
    px[j] = gridAt(road, tc + ROAD_LEAD) * HALF_X * ROAD_GAIN;
    pz[j] = zOfT(tc);
    basePy[j] = h;
    baseTx[j] = gridAt(aim, tc + LOOK_T) * HALF_X;
    baseTz[j] = pz[j] - LOOK_DIST;
    baseTy[j] = h - Math.tan((pitchDeg(d) * Math.PI) / 180) * LOOK_DIST;
    const hx = baseTx[j] - px[j];
    const hz = baseTz[j] - pz[j];
    const hl = Math.hypot(hx, hz);
    fx[j] = px[j] + (hx / hl) * FRAME_DIST;
    fz[j] = pz[j] + (hz / hl) * FRAME_DIST;
  }
  py.set(basePy);
  tx.set(baseTx);
  ty.set(baseTy);
  tz.set(baseTz);

  // Scratch for setGround, allocated once.
  const need = new Float64Array(N);
  const dil = new Float64Array(N);
  const lift = new Float64Array(N);
  const kernel = new Float64Array(2 * LIFT_W + 1);
  {
    let s = 0;
    for (let k = -LIFT_W; k <= LIFT_W; k++) {
      const v = Math.exp(-0.5 * (k / LIFT_SIGMA) ** 2);
      kernel[k + LIFT_W] = v;
      s += v;
    }
    for (let k = 0; k < kernel.length; k++) kernel[k] /= s;
  }

  /** need -> lift: running max over +-LIFT_W, then the truncated Gaussian. */
  function envelope() {
    for (let j = 0; j < N; j++) {
      let m = 0;
      const lo = Math.max(0, j - LIFT_W);
      const hi = Math.min(N - 1, j + LIFT_W);
      for (let k = lo; k <= hi; k++) if (need[k] > m) m = need[k];
      dil[j] = m;
    }
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let k = -LIFT_W; k <= LIFT_W; k++) {
        const i = Math.min(N - 1, Math.max(0, j + k));
        acc += kernel[k + LIFT_W] * dil[i];
      }
      lift[j] = acc;
    }
  }

  const finiteOr = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);

  return {
    sample(depth: number, out: RailPose): void {
      const d = depth === depth ? Math.min(MAX_RAIL_DEPTH, Math.max(0, depth)) : 0;
      const f = (d - TABLE_D0) / TABLE_STEP;
      const i1 = Math.min(N - 3, Math.max(1, Math.floor(f)));
      const u = f - i1;
      const i0 = i1 - 1;
      const i2 = i1 + 1;
      const i3 = i1 + 2;
      // Catmull-Rom as four weights shared by all six components. Written out
      // rather than calling catmull() six times: a call that V8 does not
      // inline returns a boxed double, and that was 94 GCs per 3M samples.
      const u2 = u * u;
      const u3 = u2 * u;
      const h10 = u3 - 2 * u2 + u;
      const h11 = u3 - u2;
      const w0 = -0.5 * h10;
      const w1 = 2 * u3 - 3 * u2 + 1 - 0.5 * h11;
      const w2 = -2 * u3 + 3 * u2 + 0.5 * h10;
      const w3 = 0.5 * h11;
      out.position.set(
        w0 * px[i0] + w1 * px[i1] + w2 * px[i2] + w3 * px[i3],
        w0 * py[i0] + w1 * py[i1] + w2 * py[i2] + w3 * py[i3],
        w0 * pz[i0] + w1 * pz[i1] + w2 * pz[i2] + w3 * pz[i3],
      );
      out.target.set(
        w0 * tx[i0] + w1 * tx[i1] + w2 * tx[i2] + w3 * tx[i3],
        w0 * ty[i0] + w1 * ty[i1] + w2 * ty[i2] + w3 * ty[i3],
        w0 * tz[i0] + w1 * tz[i1] + w2 * tz[i2] + w3 * tz[i3],
      );
    },

    setGround(fn: ((x: number, z: number) => number) | null): void {
      if (!fn) {
        py.set(basePy);
        tx.set(baseTx);
        ty.set(baseTy);
        tz.set(baseTz);
        return;
      }
      // Camera: clear the highest ground in its footprint by CAM_CLEAR.
      for (let j = 0; j < N; j++) {
        const x = px[j];
        const z = pz[j];
        let g = -Infinity;
        g = Math.max(g, finiteOr(fn(x, z), -Infinity));
        g = Math.max(g, finiteOr(fn(x + FOOT_R, z), -Infinity));
        g = Math.max(g, finiteOr(fn(x - FOOT_R, z), -Infinity));
        g = Math.max(g, finiteOr(fn(x, z + FOOT_R), -Infinity));
        g = Math.max(g, finiteOr(fn(x, z - FOOT_R), -Infinity));
        need[j] = g === -Infinity ? 0 : Math.max(0, g + CAM_CLEAR - basePy[j]);
      }
      envelope();
      // The target rises with the camera, so pitch (and the horizon's place on
      // screen) does not bob when the ground lifts the camera.
      for (let j = 0; j < N; j++) {
        py[j] = basePy[j] + lift[j];
        ty[j] = baseTy[j] + lift[j];
      }
      // Target: clear the ground by TGT_CLEAR WITHOUT changing where the camera
      // looks. The valley climbs toward the summit, so on the real terrain the
      // point 900 ahead is underground from depth 0.12 on; lifting it would
      // flatten the pitch to 2 degrees (measured), well off the ~5 degree
      // camera Lovro chose. Instead the target slides back along the same view
      // ray to before the ray first comes within TGT_CLEAR of the ground.
      // Every point before that crossing is clear, so the smoothed (shorter)
      // distance is clear too.
      for (let j = 0; j < N; j++) {
        const cx = px[j];
        const cy = py[j];
        const cz = pz[j];
        const dx = baseTx[j] - cx;
        const dy = ty[j] - cy;
        const dz = baseTz[j] - cz;
        let hit = 1;
        let prev = 0;
        for (let k = 1; k <= RAY_STEPS; k++) {
          const s = k / RAY_STEPS;
          const g = fn(cx + dx * s, cz + dz * s);
          if (Number.isFinite(g) && cy + dy * s - g < TGT_CLEAR) {
            let lo = prev;
            let hi = s;
            for (let b = 0; b < 12; b++) {
              const m = (lo + hi) * 0.5;
              const gm = fn(cx + dx * m, cz + dz * m);
              if (Number.isFinite(gm) && cy + dy * m - gm < TGT_CLEAR) hi = m;
              else lo = m;
            }
            hit = lo;
            break;
          }
          prev = s;
        }
        need[j] = 1 - hit;
      }
      envelope();
      for (let j = 0; j < N; j++) {
        const s = Math.max(0.05, 1 - lift[j]);
        const cy = py[j];
        tx[j] = px[j] + (baseTx[j] - px[j]) * s;
        ty[j] = cy + (ty[j] - cy) * s;
        tz[j] = pz[j] + (baseTz[j] - pz[j]) * s;
      }
    },

    depthNearest(x: number, z: number): number {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
      const jLo = Math.round((0 - TABLE_D0) / TABLE_STEP);
      const jHi = Math.round((MAX_RAIL_DEPTH - TABLE_D0) / TABLE_STEP);
      let best = jLo;
      let bestD = Infinity;
      for (let j = jLo; j <= jHi; j++) {
        const dx = fx[j] - x;
        const dz = fz[j] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          best = j;
        }
      }
      // Parabola through the best sample and its neighbours for sub-sample depth.
      let off = 0;
      if (best > 0 && best < N - 1) {
        const e0 = (fx[best - 1] - x) ** 2 + (fz[best - 1] - z) ** 2;
        const e2 = (fx[best + 1] - x) ** 2 + (fz[best + 1] - z) ** 2;
        const den = e0 - 2 * bestD + e2;
        if (den > 1e-9) off = Math.max(-0.5, Math.min(0.5, (0.5 * (e0 - e2)) / den));
      }
      const d = TABLE_D0 + (best + off) * TABLE_STEP;
      return Math.min(MAX_RAIL_DEPTH, Math.max(0, d));
    },

    pathXAtZ(z: number): number {
      return pathFraction((LEN_Y * 0.5 - z) / LEN_Y) * HALF_X;
    },

    dropAt(depth: number): number {
      const d = depth === depth ? Math.min(MAX_RAIL_DEPTH, Math.max(0, depth)) : 0;
      const f = (d - TABLE_D0) / TABLE_STEP;
      const i1 = Math.min(N - 3, Math.max(1, Math.floor(f)));
      return catmull(drop, i1 - 1, i1, i1 + 1, i1 + 2, f - i1);
    },

    pitchAt(depth: number): number {
      const d = depth === depth ? Math.min(MAX_RAIL_DEPTH, Math.max(0, depth)) : 0;
      return pitchDeg(d);
    },
  };
}
