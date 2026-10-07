import * as THREE from "three";
import {
  BRIDGE,
  BRIDGE_EYE,
  BRIDGE_KEYS,
  bridgeDeckAt,
  DIVE_KEYS,
  FLIGHT_KEYS,
  FLIGHT_VH,
  fovAtKey,
  LOOK,
  NO_TERRAIN_FOLLOW,
  PLACES,
  SHIP,
  SHIP_DOCKED,
  SHIP_MOORED,
  TAIL_VH,
  TRAIL,
  TRAIL_KIND,
  TRAIL_PACE,
  WORLD,
  type TrailKind,
} from "./layout";
import type { ShipPose } from "./modules";

/**
 * The V4 camera rail: where the camera stands and where it looks, as a pure
 * function of scroll depth. No DOM, no scene, no allocation per sample.
 *
 * THE PATH is layout.ts's, built exactly as world-tests/v5-route.mjs checks
 * it: three's centripetal Catmull-Rom through TRAIL and another through LOOK,
 * both read at the same curve parameter t. Everything the route check proved
 * (clearance, the dive's distance to the cliff, the island hidden from stops
 * 1-4, the reflection at stop 5) holds for this rail.
 *
 * WHY IT IS RE-TABULATED. Read at uniform t, that curve's speed steps at every
 * key by the ratio of the neighbouring key spacings (Astra's defect). So the
 * curve is re-sampled at equal distances along it (RAIL_TUNING.ds apart) and
 * read back with Catmull-Rom, as V3's rail does: position is then C1 in
 * distance, with no speed step anywhere.
 *
 * THE VIEW is the LOOK curve's direction, as bearing and pitch, blurred along
 * the route (viewSigma) so the turn rate has no step at the keys either.
 * The dive is framed by the layout itself (grey pass 2): its keys (DIVE_KEYS)
 * face the falls head-on and ease the pitch to 27 and back, so the two pass-1
 * dive helpers are off by default. When switched on, diveAimDrop aims the
 * camera at the falling curtain that far below itself, blended in around
 * DIVE_KEYS.first and out before DIVE_KEYS.last; divePitchPeak steepens
 * every pitch above divePitchFrom smoothly up to that peak.
 *
 * SCROLL TO DISTANCE. Depth 0..1 is the page's scroll as a share of the whole
 * scroll budget (layout scrollVh per stretch + TAIL_VH). Each stretch between
 * stops spends exactly its budget. Inside a stretch, scroll per unit of
 * distance follows the layout's PACE (slower in the dive and on the rise),
 * with a dwell around each stop so the camera eases into it and holds. The
 * per-stretch rate is blended across each stop (stopBlend), so a budget that
 * changes at a stop does not make a speed step. The rates are solved by a
 * short fixed-point loop so every stretch still integrates to its budget.
 * Grey pass 3: the flight (FLIGHT_KEYS.first to .last) is its own stretch
 * with its own budget (layout FLIGHT_VH), cut out of a8's: a8's scrollVh pays
 * for the star look, the bridge, boarding and landing on either side of it.
 * The budgets are [8 stretches ending at the stops, the tail, the flight];
 * rates blend across the flight's two ends the same way as across a stop.
 *
 * THE BRIDGE (grey pass 2). From the bridge-head key to the gangway the
 * height is exact: BRIDGE_EYE over the deck (bridgeDeckAt, which is the Sky
 * Island's top before the bridge and the bounty isle's after it), blended in
 * and out over bridgeRamp. Left to the curve, the descent from the star look
 * carried on past the bridge head: the eye dipped to 10.3 and bobbed to 13.9.
 *
 * THE SHIP. shipAtS(s) is your airship at route distance s: moored until the
 * camera boards, then shipFromCamera(rail position, travel heading) so the
 * camera stands on its deck at SHIP.camBack / SHIP.camUp, then docked. It does
 * not jump to the camera's speed: the ship's own place along the route eases
 * from standing to the rail's speed over shipCastOff units, as the camera takes
 * its last steps from the stern to its spot, and back to standing over
 * shipDock units at the Harbour Isle, as the camera walks on toward the bow.
 * Either way the ship's position, heading and speed are continuous, and the
 * camera arrives at (leaves) its spot exactly when the ship reaches (drops
 * from) full speed. bank rolls the hull into the flight's turns.
 */

export interface RailPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/** Every number here decides feel. Pass overrides to createRail() to try others. */
export const RAIL_TUNING = {
  /** Table spacing along the route, world units. */
  ds: 2,
  /** Gaussian blur of bearing and pitch along the route, world units. */
  viewSigma: 30,
  /** Peak pitch of the dive, degrees below the horizon. 0 (the default) keeps
   *  the layout's pitch exactly: its dive keys peak at 27, which is the
   *  measured tip (world-tests/v5-route.mjs N2). Pass 1 lifted it to 60. */
  divePitchPeak: 0,
  /** Pitch at which the dive steepening starts (only with divePitchPeak > 0).
   *  Outside the dive the route's pitch stays under 16. */
  divePitchFrom: 16,
  /** In the dive the camera aims at the falls curtain this far below itself.
   *  0 (the default): the layout's dive keys already face the falls head-on. */
  diveAimDrop: 0,
  /** The aim blends in between these key offsets from DIVE_KEYS.first... */
  diveAimInFrom: -0.7,
  diveAimInTo: 0.2,
  /** ...and out between these offsets from DIVE_KEYS.last, before the pool. */
  diveAimOutFrom: -1.6,
  diveAimOutTo: 0,
  /** Blur of the per-key pace along the route, world units. */
  paceSigma: 70,
  /** Scroll per unit distance at a stop is (1 + dwellGain) times the stretch's.
   *  The dwell is a Gaussian around the stop, dwellSigma world units wide. */
  dwellGain: 1.4,
  dwellSigma: 120,
  /** Half-width of the blend between two stretches' scroll rates at a stop,
   *  world units (capped at 35% of the shorter stretch). */
  stopBlend: 160,
  /** Terrain follow: keep the camera this high over the ground in its footprint.
   *  Off on the kinds in layout NO_TERRAIN_FOLLOW (dive, bridge, board, flight). */
  camClear: 35,
  footR: 24,
  /** Smooth-max window of the lift, world units each way. */
  liftWindow: 70,
  /** A place is "framed" this far along the view, for sNearest. */
  frameDist: 400,
  /** The bridge's exact eye height blends in before the bridge-head key and
   *  out before the gangway over this many units. */
  bridgeRamp: 50,
  /** Blur of the eye's height along the bridge, world units (rounds the anchors). */
  bridgeEyeSigma: 6,
  /** Route units over which the ship gets under way. It starts as the camera
   *  is shipCastOff / 2 behind its spot (on the deck: the stern is 20 behind). */
  shipCastOff: 36,
  /** Route units over which the ship slows into the dock; the camera ends
   *  shipDock / 2 forward of its spot, walking on to the bow. */
  shipDock: 100,
  /** Bank per unit of turn rate (degrees of roll per degree/unit), and its cap. */
  shipBankGain: 15,
  shipBankMax: 5,
} as const;

export type RailTuning = { -readonly [K in keyof typeof RAIL_TUNING]: number };

export interface Rail {
  /** Route length, world units (TRAIL curve, key 0 to the last key). */
  readonly length: number;
  /** Route distance of each stop, PLACES order. */
  readonly stopS: readonly number[];
  /** The tuning this rail was built with. */
  readonly tuning: Readonly<RailTuning>;
  /** Pose at route distance s (clamped). Writes into `out`, allocates nothing. */
  sampleS(s: number, out: RailPose): void;
  /** Pose at scroll depth 0..1 (clamped). Writes into `out`, allocates nothing. */
  sample(depth: number, out: RailPose): void;
  /** Route distance at scroll depth 0..1. */
  sOfDepth(depth: number): number;
  /** Scroll depth 0..1 at route distance s. */
  depthOfS(s: number): number;
  /** Scroll depth of stop i (0..7). */
  stopDepth(i: number): number;
  /** Per-stretch scroll budgets in vh: 8 stretches ending at each stop, then
   *  the tail, then the flight (10 values; a8's stretch is its value plus the flight's). */
  pacing(): readonly number[];
  /** Total scroll budget in vh. */
  totalVh(): number;
  /** Live retune: 8 values (stretch ending at each stop), 9 (plus the tail)
   *  or 10 (plus the flight). Keeps the path. */
  setPacing(scrollVh: readonly number[]): void;
  /** Degrees below the horizon at route distance s (negative looks up). */
  pitchAtS(s: number): number;
  /** Compass bearing at route distance s, degrees (0 = -z, 90 = +x), unwrapped. */
  bearingAtS(s: number): number;
  /** Scroll per unit distance at s, in vh per world unit (for the harness). */
  densityAtS(s: number): number;
  /** Route distance whose view best frames (x, z): the point frameDist along the view nearest it. */
  sNearest(x: number, z: number): number;
  /** Terrain follow (see RAIL_TUNING.camClear); null removes it. */
  setGround(fn: ((x: number, z: number) => number) | null): void;
  /** What the route is doing at s (a layout TrailKind), segment by segment as
   *  world-tests/v5-route.mjs counts it: see kindAtS in createRail. */
  kindAtS(s: number): TrailKind;
  /** The TRAIL curve parameter t (0..1, key i at i / (n - 1)) at route distance s. */
  tAtS(s: number): number;
  /** Vertical fov at route distance s (layout STOP_FOV eased round its stops, fovAtKey). */
  fovAtS(s: number): number;
  /** Route distance of the first and last flight key: where the camera stands
   *  on the moored ship's deck, and on the docked ship's. */
  readonly flightS: readonly [number, number];
  /** Your airship when the camera is at route distance s (see ShipPose in
   *  modules.ts and THE SHIP above). Writes into `out`, allocates nothing. */
  shipAtS(s: number, out: ShipPose): ShipPose;
  /** Travel heading of the camera's path at s, compass degrees, unwrapped. */
  headingAtS(s: number): number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Gaussian blur of `src` with sigma in samples; edges clamp. */
function blur(src: Float64Array, sigma: number): Float64Array {
  const n = src.length;
  if (sigma < 0.5) return src.slice();
  const r = Math.ceil(3 * sigma);
  const w = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let k = -r; k <= r; k++) {
    w[k + r] = Math.exp(-0.5 * (k / sigma) ** 2);
    sum += w[k + r];
  }
  for (let k = 0; k < w.length; k++) w[k] /= sum;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += w[k + r] * src[Math.min(n - 1, Math.max(0, i + k))];
    out[i] = acc;
  }
  return out;
}

/** Kinds on foot next to the bridge and the ship (kindAtS's board rule). */
const ON_FOOT: readonly TrailKind[] = ["bridge", "board", "flight"];

const smoother = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (u * 6 - 15) + 10));

/** Uniform Catmull-Rom read of a table at fractional index f. C1. */
function readTable(a: Float64Array, f: number): number {
  const n = a.length;
  const i1 = Math.min(n - 2, Math.max(0, Math.floor(f)));
  const u = Math.min(1, Math.max(0, f - i1));
  // Past either end the phantom neighbour continues the last slope, so the
  // speed at the very start and end is right (a clamped one halves it).
  const p1 = a[i1];
  const p2 = a[i1 + 1];
  const p0 = i1 > 0 ? a[i1 - 1] : 2 * p1 - p2;
  const p3 = i1 + 2 < n ? a[i1 + 2] : 2 * p2 - p1;
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * p1 +
    (u3 - 2 * u2 + u) * ((p2 - p0) * 0.5) +
    (-2 * u3 + 3 * u2) * p2 +
    (u3 - u2) * ((p3 - p1) * 0.5)
  );
}

// ── The rail ────────────────────────────────────────────────────────────────

export function createRail(overrides: Partial<RailTuning> = {}): Rail {
  const T: RailTuning = { ...RAIL_TUNING, ...overrides };
  const nKeys = TRAIL.length;

  // 1. The layout's curves, and distance along the camera curve by fine t steps.
  const v = (p: readonly [number, number, number]) => new THREE.Vector3(p[0], p[1], p[2]);
  const posCurve = new THREE.CatmullRomCurve3(TRAIL.map(v), false, "centripetal");
  const lookCurve = new THREE.CatmullRomCurve3(LOOK.map(v), false, "centripetal");
  const SUB = 400; // fine samples per key segment
  const NT = (nKeys - 1) * SUB + 1;
  const sT = new Float64Array(NT);
  {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    posCurve.getPoint(0, a);
    for (let i = 1; i < NT; i++) {
      posCurve.getPoint(i / (NT - 1), b);
      sT[i] = sT[i - 1] + a.distanceTo(b);
      a.copy(b);
    }
  }
  const length = sT[NT - 1];
  const stopS = PLACES.map((p) => sT[p.trail * SUB]);
  /** Route distance of the first and last flight key. */
  const flightS = [sT[FLIGHT_KEYS.first * SUB], sT[FLIGHT_KEYS.last * SUB]] as const;

  // 2. Re-sample at equal distances.
  const N = Math.max(8, Math.ceil(length / T.ds) + 1);
  const ds = length / (N - 1);
  const px = new Float64Array(N);
  const basePy = new Float64Array(N);
  const pz = new Float64Array(N);
  const keyF = new Float64Array(N); // fractional key index at each sample
  const bearRaw = new Float64Array(N);
  const pitchRaw = new Float64Array(N);
  {
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    let k = 0;
    let prevB = NaN;
    for (let j = 0; j < N; j++) {
      const s = j * ds;
      while (k < NT - 2 && sT[k + 1] < s) k++;
      const seg = sT[k + 1] - sT[k];
      const u = seg > 1e-9 ? Math.min(1, Math.max(0, (s - sT[k]) / seg)) : 0;
      const t = (k + u) / (NT - 1);
      posCurve.getPoint(t, p);
      lookCurve.getPoint(t, q);
      px[j] = p.x;
      basePy[j] = p.y;
      pz[j] = p.z;
      keyF[j] = t * (nKeys - 1);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const dz = q.z - p.z;
      let b = (Math.atan2(dx, -dz) * 180) / Math.PI;
      // Unwrap, so a blur across north never averages 359 and 1 to 180.
      if (prevB === prevB) b += 360 * Math.round((prevB - b) / 360);
      prevB = b;
      bearRaw[j] = b;
      pitchRaw[j] = (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
    }
  }

  // Route distance of the first sample at or past a (fractional) key index.
  const sAtKey = (k: number) => {
    let j = 0;
    while (j < N - 1 && keyF[j] < k) j++;
    return j * ds;
  };

  // 2b. The bridge at eye height: exact from the bridge-head key (the one
  //     before BRIDGE_KEYS.first) to the gangway (FLIGHT_KEYS.first), blended
  //     in and out over bridgeRamp. Heights only; the view is untouched.
  {
    const [ax, , az] = BRIDGE.a;
    const [bx, , bz] = BRIDGE.b;
    const L2 = (bx - ax) ** 2 + (bz - az) ** 2;
    const sIn = sAtKey(BRIDGE_KEYS.first - 1);
    const sOut = sAtKey(FLIGHT_KEYS.first);
    const R = Math.max(ds, T.bridgeRamp);
    const j0 = Math.max(0, Math.floor((sIn - R) / ds));
    const j1 = Math.min(N - 1, Math.ceil(sOut / ds));
    // The deck meets each isle at an angle (it leaves the Sky Island's top
    // dropping ~0.46 per unit), so the eye's target is blurred over
    // bridgeEyeSigma along the route: a head rounds the anchor, and the
    // camera's vertical speed has no step there.
    const target = new Float64Array(j1 - j0 + 1);
    for (let j = j0; j <= j1; j++) {
      const u = ((px[j] - ax) * (bx - ax) + (pz[j] - az) * (bz - az)) / L2;
      target[j - j0] = bridgeDeckAt(u) + BRIDGE_EYE;
    }
    const eye = blur(target, T.bridgeEyeSigma / ds);
    for (let j = j0; j <= j1; j++) {
      const s = j * ds;
      if (s <= sIn - R || s >= sOut) continue;
      const w = smoother((s - (sIn - R)) / R) * (1 - smoother((s - (sOut - R)) / R));
      basePy[j] += (eye[j - j0] - basePy[j]) * w;
    }
  }

  // 2c. Travel heading (compass, unwrapped) and turn rate along the path, for
  //     the ship. The position tables are C1, so a central difference is smooth.
  const headRaw = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const a = Math.max(0, j - 1);
    const b = Math.min(N - 1, j + 1);
    let h = (Math.atan2(px[b] - px[a], -(pz[b] - pz[a])) * 180) / Math.PI;
    if (j > 0) h += 360 * Math.round((headRaw[j - 1] - h) / 360);
    headRaw[j] = h;
  }
  // A light blur (a steady turn passes through unchanged) so the turn rate is
  // smooth between table samples too: unblurred, the ship's turn "no step"
  // proof sat exactly at its 8x bar.
  const headT = blur(headRaw, 6 / ds);
  const turnT = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const a = Math.max(0, j - 1);
    const b = Math.min(N - 1, j + 1);
    turnT[j] = b > a ? (headT[b] - headT[a]) / ((b - a) * ds) : 0;
  }
  const turnSm = blur(turnT, 40 / ds);

  // 3. The view: the dive's aim at the falling water blended in, blurred,
  //    then the dive steepened.
  if (T.diveAimDrop > 0) {
    const F = WORLD.falls;
    const [fx, fTop, fz] = F.top;
    const fBot = F.bottom[1];
    const drop = fTop - fBot;
    const a0 = sAtKey(DIVE_KEYS.first + T.diveAimInFrom);
    const a1 = sAtKey(DIVE_KEYS.first + T.diveAimInTo);
    const b0 = sAtKey(DIVE_KEYS.last + T.diveAimOutFrom);
    const b1 = sAtKey(DIVE_KEYS.last + T.diveAimOutTo);
    for (let j = 0; j < N; j++) {
      const s = j * ds;
      const w = smoother((s - a0) / Math.max(1, a1 - a0)) * (1 - smoother((s - b0) / Math.max(1, b1 - b0)));
      if (w <= 0) continue;
      const ya = Math.max(fBot + 10, basePy[j] - T.diveAimDrop);
      const za = fz - 52 * Math.sqrt(Math.max(0, fTop - ya) / drop);
      const dx = fx - px[j];
      const dz = za - pz[j];
      let b = (Math.atan2(dx, -dz) * 180) / Math.PI;
      b += 360 * Math.round((bearRaw[j] - b) / 360);
      const p = (Math.atan2(basePy[j] - ya, Math.hypot(dx, dz)) * 180) / Math.PI;
      bearRaw[j] += (b - bearRaw[j]) * w;
      pitchRaw[j] += (p - pitchRaw[j]) * w;
    }
  }
  const bear = blur(bearRaw, T.viewSigma / ds);
  const pitch = blur(pitchRaw, T.viewSigma / ds);
  if (T.divePitchPeak > 0) {
    let pMax = -Infinity;
    for (let j = 0; j < N; j++) if (pitch[j] > pMax) pMax = pitch[j];
    const from = T.divePitchFrom;
    if (pMax > from + 1 && T.divePitchPeak > pMax) {
      const add = T.divePitchPeak - pMax;
      for (let j = 0; j < N; j++) {
        if (pitch[j] > from) pitch[j] += add * smoother((pitch[j] - from) / (pMax - from));
      }
    }
  }
  // Unit view direction per sample, for a cheap read-back.
  const dxT = new Float64Array(N);
  const dyT = new Float64Array(N);
  const dzT = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const b = (bear[j] * Math.PI) / 180;
    const pr = (pitch[j] * Math.PI) / 180;
    dxT[j] = Math.sin(b) * Math.cos(pr);
    dyT[j] = -Math.sin(pr);
    dzT[j] = -Math.cos(b) * Math.cos(pr);
  }

  // 4. Pace along the route (per key, linear between keys, then blurred).
  const paceRaw = new Float64Array(N);
  const followRaw = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const f = keyF[j];
    const i = Math.min(nKeys - 2, Math.floor(f));
    const u = f - i;
    paceRaw[j] = TRAIL_PACE[i] + (TRAIL_PACE[i + 1] - TRAIL_PACE[i]) * u;
    // Terrain follow is off where either end of the segment is a kind whose
    // height is exact (layout NO_TERRAIN_FOLLOW): the dive runs 16 units from
    // the cliff by design; the bridge, the bounty isle and the ship carry the
    // camera at eye height, under the islands' keep-out domes. On the rise it
    // stays on, so the island's rim (in the scene's ground function) lifts
    // the camera.
    const off = (x: TrailKind) => NO_TERRAIN_FOLLOW.includes(x);
    followRaw[j] = off(TRAIL_KIND[i]) || off(TRAIL_KIND[i + 1]) ? 0 : 1;
  }
  const pace = blur(paceRaw, T.paceSigma / ds);
  // Follow fades in over FOLLOW_RAMP units after a dive or rise ends (and out
  // before one starts): smootherstep of the distance to the nearest "off"
  // sample, so switching it on never kinks the height.
  const follow = new Float64Array(N);
  {
    const FOLLOW_RAMP = 80;
    const dist = new Float64Array(N).fill(Infinity);
    let last = -Infinity;
    for (let j = 0; j < N; j++) {
      if (followRaw[j] === 0) last = j;
      dist[j] = (j - last) * ds;
    }
    last = Infinity;
    for (let j = N - 1; j >= 0; j--) {
      if (followRaw[j] === 0) last = j;
      dist[j] = Math.min(dist[j], (last - j) * ds);
    }
    for (let j = 0; j < N; j++) follow[j] = smoother(dist[j] / FOLLOW_RAMP);
  }

  // 5. Scroll density. dwell and pace are fixed; the per-stretch rate is solved.
  const base = new Float64Array(N); // pace * dwell
  for (let j = 0; j < N; j++) {
    const s = j * ds;
    let dw = 1;
    for (const st of stopS) dw += T.dwellGain * Math.exp(-0.5 * ((s - st) / T.dwellSigma) ** 2);
    base[j] = pace[j] * dw;
  }
  // Segment k runs from bounds[k] to bounds[k+1] and spends budget group
  // segGroup[k]: the 7 stretches up to a7, a8's stretch split round the
  // flight (both halves group 7), the flight (group 9), then the tail (8).
  const breaks = [...stopS.slice(0, 7), flightS[0], flightS[1], stopS[7]];
  const bounds = [0, ...breaks, length];
  const segGroup = [0, 1, 2, 3, 4, 5, 6, 7, 9, 7, 8];
  const nSeg = bounds.length - 1;
  const nGroup = 10;
  const blendHalf = breaks.map((st, m) =>
    Math.min(T.stopBlend, 0.35 * (st - bounds[m]), 0.35 * (bounds[m + 2] - st)),
  );
  /** Budget group on each side of the blend and the weight toward the later one, per sample. */
  const groupA = new Int32Array(N);
  const groupB = new Int32Array(N);
  const blendW = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const s = j * ds;
    let k = 0;
    while (k < nSeg - 1 && s >= bounds[k + 1]) k++;
    // Blend across the nearest break, if inside its window. The window is
    // centred on the break: before it we are in segment m, after it in m+1.
    let m = -1;
    for (let q = 0; q < breaks.length; q++) if (Math.abs(s - breaks[q]) < blendHalf[q]) m = q;
    if (m >= 0) {
      groupA[j] = segGroup[m];
      groupB[j] = segGroup[m + 1];
      blendW[j] = smoother((s - (breaks[m] - blendHalf[m])) / (2 * blendHalf[m]));
    } else {
      groupA[j] = segGroup[k];
      groupB[j] = segGroup[k];
      blendW[j] = 0;
    }
  }
  const logC = new Float64Array(nGroup);
  const density = new Float64Array(N);
  const cum = new Float64Array(N); // scroll vh from the start to sample j
  let budgets: number[] = [...PLACES.map((p) => p.scrollVh), TAIL_VH, FLIGHT_VH];
  let total = 0;

  /** Cumulative at a route distance (linear between samples; for the solver). */
  const cumAt = (s: number) => {
    const f = Math.min(N - 1, Math.max(0, s / ds));
    const i = Math.min(N - 2, Math.floor(f));
    return cum[i] + (cum[i + 1] - cum[i]) * (f - i);
  };

  // depth -> s table, rebuilt by solvePacing.
  const NV = N;
  const sOfV = new Float64Array(NV);

  function solvePacing() {
    total = budgets.reduce((a, b) => a + b, 0);
    logC.fill(0);
    for (let it = 0; it < 60; it++) {
      for (let j = 0; j < N; j++) {
        const a = logC[groupA[j]];
        const w = blendW[j];
        const lc = w > 0 ? a + (logC[groupB[j]] - a) * w : a;
        density[j] = Math.exp(lc) * base[j];
      }
      cum[0] = 0;
      for (let j = 1; j < N; j++) cum[j] = cum[j - 1] + 0.5 * (density[j - 1] + density[j]) * ds;
      let worst = 0;
      const got = new Float64Array(nGroup);
      for (let k = 0; k < nSeg; k++) got[segGroup[k]] += cumAt(bounds[k + 1]) - cumAt(bounds[k]);
      for (let g = 0; g < nGroup; g++) {
        const r = budgets[g] / Math.max(1e-9, got[g]);
        worst = Math.max(worst, Math.abs(r - 1));
        logC[g] += Math.log(r);
      }
      if (worst < 1e-7) break;
    }
    // Invert cum on a uniform depth grid.
    let j = 0;
    for (let m = 0; m < NV; m++) {
      const target = (m / (NV - 1)) * cum[N - 1];
      while (j < N - 2 && cum[j + 1] < target) j++;
      const span = cum[j + 1] - cum[j];
      const u = span > 1e-12 ? Math.min(1, Math.max(0, (target - cum[j]) / span)) : 0;
      sOfV[m] = (j + u) * ds;
    }
  }
  solvePacing();

  // 6. Terrain follow.
  const py = new Float64Array(basePy);
  const need = new Float64Array(N);
  const dil = new Float64Array(N);
  const liftW = Math.max(1, Math.round(T.liftWindow / ds));
  const kernel = new Float64Array(2 * liftW + 1);
  {
    const sg = liftW / 2.5;
    let sum = 0;
    for (let k = -liftW; k <= liftW; k++) {
      kernel[k + liftW] = Math.exp(-0.5 * (k / sg) ** 2);
      sum += kernel[k + liftW];
    }
    for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
  }

  const clampS = (s: number) => (s === s ? Math.min(length, Math.max(0, s)) : 0);

  // Padded copies for sampleS: one phantom sample at each end continuing the
  // last slope, so the hot read needs no end checks.
  const pad = (src: Float64Array, dst: Float64Array) => {
    dst.set(src, 1);
    dst[0] = 2 * src[0] - src[1];
    dst[N + 1] = 2 * src[N - 1] - src[N - 2];
  };
  const qx = new Float64Array(N + 2);
  const qy = new Float64Array(N + 2);
  const qz = new Float64Array(N + 2);
  const qdx = new Float64Array(N + 2);
  const qdy = new Float64Array(N + 2);
  const qdz = new Float64Array(N + 2);
  pad(px, qx);
  pad(py, qy);
  pad(pz, qz);
  pad(dxT, qdx);
  pad(dyT, qdy);
  pad(dzT, qdz);

  /**
   * The pose at sArg[0]. The distance goes through a one-slot array rather
   * than an argument: this read is too big for V8 to inline, and a double
   * passed into a call that is not inlined is boxed, one allocation per
   * frame. Measured: 24 GCs per 3M samples as an argument, 0 this way.
   */
  const sArg = new Float64Array(1);
  const writePose = (out: RailPose) => {
    const f = clampS(sArg[0]) / ds;
    const i1 = Math.min(N - 2, Math.floor(f));
    const u = f - i1;
    // Tables carry one extra sample at each end (index 0 and N+1 of the
    // padded arrays) that continues the last slope; see pad().
    const i0 = i1;
    const i2 = i1 + 2;
    const i3 = i1 + 3;
    const j1 = i1 + 1;
    // Catmull-Rom as four weights shared by all six components (V3's rail:
    // one inlined read instead of six calls, so no boxed doubles).
    const u2 = u * u;
    const u3 = u2 * u;
    const h10 = u3 - 2 * u2 + u;
    const h11 = u3 - u2;
    const w0 = -0.5 * h10;
    const w1 = 2 * u3 - 3 * u2 + 1 - 0.5 * h11;
    const w2 = -2 * u3 + 3 * u2 + 0.5 * h10;
    const w3 = 0.5 * h11;
    const x = w0 * qx[i0] + w1 * qx[j1] + w2 * qx[i2] + w3 * qx[i3];
    const y = w0 * qy[i0] + w1 * qy[j1] + w2 * qy[i2] + w3 * qy[i3];
    const z = w0 * qz[i0] + w1 * qz[j1] + w2 * qz[i2] + w3 * qz[i3];
    const dx = w0 * qdx[i0] + w1 * qdx[j1] + w2 * qdx[i2] + w3 * qdx[i3];
    const dy = w0 * qdy[i0] + w1 * qdy[j1] + w2 * qdy[i2] + w3 * qdy[i3];
    const dz = w0 * qdz[i0] + w1 * qdz[j1] + w2 * qdz[i2] + w3 * qdz[i3];
    out.position.set(x, y, z);
    out.target.set(x + dx * 520, y + dy * 520, z + dz * 520);
  };

  // 7. The ship (see THE SHIP in the header). The raw pose is layout
  //    shipFromCamera(rail position, travel heading), inlined so a frame
  //    allocates nothing; a correction, blended linearly along the flight,
  //    makes it exactly SHIP_MOORED at the first flight key and SHIP_DOCKED at
  //    the last (the curve passes 0.12 units and 0.04 degrees off them).
  const shipCast = Math.max(2 * ds, T.shipCastOff);
  const shipDock = Math.max(2 * ds, T.shipDock);
  const qh = new Float64Array(N + 2);
  const qt = new Float64Array(N + 2);
  pad(headT, qh);
  pad(turnSm, qt);
  /** shipArg: [s of the camera, the ship's own s (sig), throttle]. As sArg, a
   *  slot instead of arguments, so no double is boxed per frame. */
  const shipArg = new Float64Array(3);
  /** raw: [x, y, z, heading, turn rate] of shipFromCamera at the rail point shipArg[1]. */
  const raw = new Float64Array(5);
  const corr = new Float64Array(8);
  const wrap180 = (a: number) => a - 360 * Math.round(a / 360);
  const shipRaw = () => {
    const f = Math.min(length, Math.max(0, shipArg[1])) / ds;
    const i1 = Math.min(N - 2, Math.floor(f));
    const u = f - i1;
    const u2 = u * u;
    const u3 = u2 * u;
    const h10 = u3 - 2 * u2 + u;
    const h11 = u3 - u2;
    const w0 = -0.5 * h10;
    const w1 = 2 * u3 - 3 * u2 + 1 - 0.5 * h11;
    const w2 = -2 * u3 + 3 * u2 + 0.5 * h10;
    const w3 = 0.5 * h11;
    const j1 = i1 + 1;
    const i2 = i1 + 2;
    const i3 = i1 + 3;
    const h = w0 * qh[i1] + w1 * qh[j1] + w2 * qh[i2] + w3 * qh[i3];
    const b = (h * Math.PI) / 180;
    raw[0] = w0 * qx[i1] + w1 * qx[j1] + w2 * qx[i2] + w3 * qx[i3] + Math.sin(b) * SHIP.camBack;
    raw[1] = w0 * qy[i1] + w1 * qy[j1] + w2 * qy[i2] + w3 * qy[i3] - SHIP.camUp;
    raw[2] = w0 * qz[i1] + w1 * qz[j1] + w2 * qz[i2] + w3 * qz[i3] - Math.cos(b) * SHIP.camBack;
    raw[3] = h;
    raw[4] = w0 * qt[i1] + w1 * qt[j1] + w2 * qt[i2] + w3 * qt[i3];
  };
  const shipEnds = () => {
    shipArg[1] = flightS[0];
    shipRaw();
    corr[0] = SHIP_MOORED.x - raw[0];
    corr[1] = SHIP_MOORED.y - raw[1];
    corr[2] = SHIP_MOORED.z - raw[2];
    corr[3] = wrap180(SHIP_MOORED.heading - raw[3]);
    shipArg[1] = flightS[1];
    shipRaw();
    corr[4] = SHIP_DOCKED.x - raw[0];
    corr[5] = SHIP_DOCKED.y - raw[1];
    corr[6] = SHIP_DOCKED.z - raw[2];
    corr[7] = wrap180(SHIP_DOCKED.heading - raw[3]);
  };
  shipEnds();
  const sF = flightS[0];
  const sL = flightS[1];
  const setShip = (out: ShipPose, p: { x: number; y: number; z: number; heading: number }, phase: ShipPose["phase"]) => {
    out.x = p.x;
    out.y = p.y;
    out.z = p.z;
    out.heading = p.heading;
    out.bank = 0;
    out.throttle = 0;
    out.phase = phase;
    return out;
  };
  /** The scalars writeShip reads, in a typed array: read from the closure,
   *  they boxed a double per call once a second rail existed (measured,
   *  world-tests/v5-rail.test.mjs builds three). */
  const SC = Float64Array.of(length, sF, sL, shipCast, shipDock, T.shipBankGain, T.shipBankMax);
  /** The ship for the camera at shipArg[0] (see shipAtS). */
  const writeShip = (out: ShipPose): ShipPose => {
    const len = SC[0];
    const sF = SC[1];
    const sL = SC[2];
    const shipCast = SC[3];
    const shipDock = SC[4];
    const s0 = shipArg[0];
    const s = s0 === s0 ? (s0 < 0 ? 0 : s0 > len ? len : s0) : 0;
    if (s <= sF - shipCast / 2) return setShip(out, SHIP_MOORED, "moored");
    if (s >= sL + shipDock / 2) return setShip(out, SHIP_DOCKED, "docked");
    // The ship's own place along the route (sig) and its share of the rail's
    // speed: smoother(u) and its integral u^6 - 3u^5 + 2.5u^4 (0.5 at u = 1),
    // written out here so no double crosses a call.
    if (s < sF + shipCast / 2) {
      const u = (s - (sF - shipCast / 2)) / shipCast;
      const u3 = u * u * u;
      shipArg[1] = sF + shipCast * u3 * u * (u * (u - 3) + 2.5);
      shipArg[2] = u3 * (u * (u * 6 - 15) + 10);
    } else if (s <= sL - shipDock / 2) {
      shipArg[1] = s;
      shipArg[2] = 1;
    } else {
      const u = (s - (sL - shipDock / 2)) / shipDock;
      const u3 = u * u * u;
      shipArg[1] = sL - shipDock / 2 + shipDock * (u - u3 * u * (u * (u - 3) + 2.5));
      shipArg[2] = 1 - u3 * (u * (u * 6 - 15) + 10);
    }
    shipRaw();
    const k = Math.min(1, Math.max(0, (shipArg[1] - sF) / (sL - sF)));
    out.x = raw[0] + corr[0] * (1 - k) + corr[4] * k;
    out.y = raw[1] + corr[1] * (1 - k) + corr[5] * k;
    out.z = raw[2] + corr[2] * (1 - k) + corr[6] * k;
    const h = raw[3] + corr[3] * (1 - k) + corr[7] * k;
    out.heading = h - 360 * Math.floor(h / 360);
    const thr = shipArg[2];
    const bankMax = SC[6];
    const bank = SC[5] * raw[4] * thr;
    out.bank = bank > bankMax ? bankMax : bank < -bankMax ? -bankMax : bank;
    out.throttle = thr;
    out.phase = "flight";
    return out;
  };

  const rail: Rail = {
    length,
    stopS,
    tuning: T,
    flightS,

    sampleS(s: number, out: RailPose): void {
      sArg[0] = s;
      writePose(out);
    },

    sample(depth: number, out: RailPose): void {
      const d = depth === depth ? Math.min(1, Math.max(0, depth)) : 0;
      sArg[0] = readTable(sOfV, d * (NV - 1));
      writePose(out);
    },

    sOfDepth(depth: number): number {
      const d = depth === depth ? Math.min(1, Math.max(0, depth)) : 0;
      return clampS(readTable(sOfV, d * (NV - 1)));
    },

    depthOfS(s: number): number {
      const c = readTable(cum, clampS(s) / ds);
      return Math.min(1, Math.max(0, c / cum[N - 1]));
    },

    stopDepth(i: number): number {
      const last = Math.min(7, Math.max(0, i));
      let acc = last === 7 ? budgets[9] : 0; // a8's stretch holds the flight
      for (let k = 0; k <= last; k++) acc += budgets[k];
      return acc / total;
    },

    pacing: () => budgets.slice(),
    totalVh: () => total,

    setPacing(scrollVh: readonly number[]): void {
      const next = budgets.slice();
      for (let k = 0; k < Math.min(nGroup, scrollVh.length); k++) {
        const b = scrollVh[k];
        if (Number.isFinite(b) && b > 1) next[k] = b;
      }
      budgets = next;
      solvePacing();
    },

    pitchAtS(s: number): number {
      const f = clampS(s) / ds;
      const dy = readTable(dyT, f);
      const h = Math.hypot(readTable(dxT, f), readTable(dzT, f));
      return (-Math.atan2(dy, h) * 180) / Math.PI;
    },

    bearingAtS(s: number): number {
      return readTable(bear, clampS(s) / ds);
    },

    densityAtS(s: number): number {
      return readTable(density, clampS(s) / ds);
    },

    sNearest(x: number, z: number): number {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < N; j++) {
        const hl = Math.hypot(dxT[j], dzT[j]) || 1;
        const fx = px[j] + (dxT[j] / hl) * T.frameDist - x;
        const fz = pz[j] + (dzT[j] / hl) * T.frameDist - z;
        const d2 = fx * fx + fz * fz;
        if (d2 < bestD) {
          bestD = d2;
          best = j;
        }
      }
      return best * ds;
    },

    setGround(fn: ((x: number, z: number) => number) | null): void {
      if (!fn) {
        py.set(basePy);
        pad(py, qy);
        shipEnds();
        return;
      }
      const r = T.footR;
      for (let j = 0; j < N; j++) {
        if (follow[j] <= 0) {
          need[j] = 0;
          continue;
        }
        const x = px[j];
        const z = pz[j];
        const g = Math.max(fn(x, z), fn(x + r, z), fn(x - r, z), fn(x, z + r), fn(x, z - r));
        need[j] = Number.isFinite(g) ? Math.max(0, g + T.camClear - basePy[j]) : 0;
      }
      // Running max over the window, then a Gaussian truncated to it: a smooth
      // max that never dips under what was asked for (V3's envelope).
      for (let j = 0; j < N; j++) {
        let m = 0;
        for (let k = Math.max(0, j - liftW); k <= Math.min(N - 1, j + liftW); k++) if (need[k] > m) m = need[k];
        dil[j] = m;
      }
      for (let j = 0; j < N; j++) {
        let acc = 0;
        for (let k = -liftW; k <= liftW; k++) acc += kernel[k + liftW] * dil[Math.min(N - 1, Math.max(0, j + k))];
        py[j] = basePy[j] + acc * follow[j];
      }
      pad(py, qy);
      shipEnds();
    },

    shipAtS(s: number, out: ShipPose): ShipPose {
      shipArg[0] = s;
      return writeShip(out);
    },

    headingAtS(s: number): number {
      return readTable(headT, clampS(s) / ds);
    },

    tAtS(s: number): number {
      const f = readTable(keyF, clampS(s) / ds) / (nKeys - 1);
      return f < 0 ? 0 : f > 1 ? 1 : f;
    },

    fovAtS(s: number): number {
      return fovAtKey(readTable(keyF, clampS(s) / ds));
    },

    kindAtS(s: number): TrailKind {
      const f = keyF[Math.round(clampS(s) / ds)];
      const i = Math.min(nKeys - 2, Math.floor(f));
      const a = TRAIL_KIND[i];
      const b = TRAIL_KIND[i + 1];
      // As world-tests/v5-route.mjs counts it: a segment touching the dive is
      // the dive; between the moored and docked keys it is the flight; both
      // ends on the bridge is the bridge; next to the bridge or the ship it
      // is on foot (board); else the segment's start key's kind (so the step
      // from the a4 stop into the cage is tunnel, and the last one out over
      // the shaft's collar is shaft).
      if (a === "dive" || b === "dive") return "dive";
      if (i >= FLIGHT_KEYS.first && i < FLIGHT_KEYS.last) return "flight";
      if (a === "bridge" && b === "bridge") return "bridge";
      if (ON_FOOT.includes(a) || ON_FOOT.includes(b)) return "board";
      return a;
    },
  };
  return rail;
}
