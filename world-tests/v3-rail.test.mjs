/**
 * v3 camera rail: measured against /dev/world (ours) and /dev/world-codex (Astra).
 * A copy of v2-rail.test.mjs pointed at src/lib/world-v3/rail.ts, with two
 * changes: the pitch target is V3's 8 -> 16 degrees (was "stays 4.5..8"), and
 * a new section proves createRail({ pitch: "low" }) (?pitch=low) is V2's rail
 * exactly, sample for sample, bare and on terrain.
 *
 *   node --experimental-strip-types world-tests/v3-rail.test.mjs
 *
 * Imports src/lib/world-v3/rail.ts directly. `cameraAt`, `parallax` and the
 * velocity-step loop are copied verbatim from camera-compare.mjs; the step
 * loop's floor (`lo > 5`) is a parameter here instead of a literal, nothing
 * else changed.
 *
 * Two definitions differ from camera-compare, both because the verbatim form
 * measures something else on a camera that turns:
 *
 *   HEADING. camera-compare takes atan2(fwd.x, fwd.z). A camera travelling
 *   toward -z has fwd.z near -1, so that angle sits at +-180 and WRAPS the
 *   moment fwd.x changes sign: v2 would score ~360 degrees. Measured here from
 *   the travel axis, atan2(fwd.x, -fwd.z). Same numbers for ours and Astra.
 *
 *   LATERAL STEP. The verbatim floor (both speeds > 5 units/depth) is fine for
 *   height, which never slows below 96. Lateral speed passes through zero at
 *   every turn, and at the sample just above 5 the ratio of two neighbouring
 *   speeds is large on ANY smooth curve. That is not a step: sample 10x finer
 *   and it shrinks ~10x, while a real step (a velocity discontinuity) does
 *   not shrink at all. So lateral is judged with the floor at 10% of the
 *   rail's own peak speed, and the raw floor-5 figure is printed at both
 *   resolutions next to it to show which is which.
 */
import * as T from "three";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRail } from "../src/lib/world-v3/rail.ts";
import { createRail as createRailV2 } from "../src/lib/world-v2/rail.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const LEN_Y = 2000.0;
const LEN_X = 620.0;
const MAX_RAIL_DEPTH = 0.88;
const FOV = 31; // world-v3/scene.ts PerspectiveCamera

// ---- the two reference rails, verbatim from camera-compare.mjs ------------
function ours(depth) {
  const by = -LEN_Y * 0.615 + depth * (LEN_Y * 1.06);
  const height = 108 + depth * 96 + Math.max(0, depth - 0.45) * 210;
  const pos = new T.Vector3(0, height, -by);
  const drop = Math.tan(T.MathUtils.degToRad(5.2 + depth * 2.2)) * 900;
  return { pos, tgt: new T.Vector3(0, height - drop, -by - 900) };
}
const railPosition = new T.CatmullRomCurve3([
  [180,260,670],[260,230,390],[245,240,150],[170,285,-60],
  [80,365,-420],[130,400,-700],[220,360,-985],[-18,620,-1340],
].map(p => new T.Vector3(...p)));
const railTarget = new T.CatmullRomCurve3([
  [100,128,-280],[90,100,-570],[30,100,-700],[40,160,-970],
  [-80,215,-1150],[70,280,-1350],[70,165,-1470],[-40,460,-2290],
].map(p => new T.Vector3(...p)));
const LD = [0, 0.14, 0.27, 0.41, 0.55, 0.69, 0.83, 1];
function astra(depth) {
  let seg = LD.findIndex(d => d > depth) - 1;
  if (seg < 0) seg = depth < 1 ? 0 : 6;
  const t = (seg + clamp((depth - LD[seg]) / (LD[seg+1] - LD[seg]))) / 7;
  return { pos: railPosition.getPoint(t, new T.Vector3()),
           tgt: railTarget.getPoint(t, new T.Vector3()) };
}

// ---- v2 ----------------------------------------------------------------------
const rail = createRail();
function v2(depth) {
  const pose = { position: new T.Vector3(), target: new T.Vector3() };
  rail.sample(depth, pose);
  return { pos: pose.position, tgt: pose.target };
}

// ---- verbatim from camera-compare.mjs ----------------------------------------
function cameraAt(fn, d, fov, aspect) {
  const { pos, tgt } = fn(d);
  const c = new T.PerspectiveCamera(fov, aspect, 1, 12000);
  c.position.copy(pos); c.lookAt(tgt); c.updateMatrixWorld(); c.updateProjectionMatrix();
  return c;
}

/** TRUE PARALLAX: two points, same screen x at d0, how far apart at d1. */
function parallax(fn, d0, d1, fov) {
  const aspect = 16/9;
  const c0 = cameraAt(fn, d0, fov, aspect);
  const fwd = new T.Vector3(); c0.getWorldDirection(fwd);
  const right = new T.Vector3().crossVectors(fwd, new T.Vector3(0,1,0)).normalize();
  // near object 350 ahead, far object 1600 ahead, both pushed the same ANGLE
  // off-axis so they land on the same screen x at d0
  const off = Math.tan(T.MathUtils.degToRad(9));
  const near = c0.position.clone().add(fwd.clone().multiplyScalar(350)).add(right.clone().multiplyScalar(350*off));
  const far  = c0.position.clone().add(fwd.clone().multiplyScalar(1600)).add(right.clone().multiplyScalar(1600*off));
  const p = (cam, v) => { const q = v.clone().project(cam); return q.x; };
  const sep0 = Math.abs(p(c0, near) - p(c0, far));
  const c1 = cameraAt(fn, d1, fov, aspect);
  const sep1 = Math.abs(p(c1, near) - p(c1, far));
  return { sep0, sep1, drift: Math.abs(sep1 - sep0) };
}

/** camera-compare's worst-step loop; `floor` was the literal 5. */
function worstStep(v, S, floor = 5) {
  let worst = 1, at = 0;
  for (let i = 1; i < v.length; i++) {
    const lo = Math.min(Math.abs(v[i-1]), Math.abs(v[i]));
    const hi = Math.max(Math.abs(v[i-1]), Math.abs(v[i]));
    if (lo > floor && hi/lo > worst) { worst = hi/lo; at = S[i].d; }
  }
  return { worst, at };
}

/**
 * The direct test for a velocity STEP: the largest change in velocity between
 * adjacent samples. On a curve whose velocity is continuous it shrinks in
 * proportion to the spacing (10x finer sampling, ~10x smaller). At a real
 * step it does not shrink at all. No floor, no zero-crossing noise.
 */
function maxJump(fn, maxDepth, N, key) {
  let prevP = fn(0).pos.clone(), prevV = null, m = 0, at = 0;
  for (let i = 1; i <= N; i++) {
    const d = (i / N) * maxDepth, p = fn(d).pos, v = (p[key] - prevP[key]) / (maxDepth / N);
    if (prevV !== null && Math.abs(v - prevV) > m) { m = Math.abs(v - prevV); at = d; }
    prevV = v; prevP = p.clone();
  }
  return { m, at };
}
function jumpShrink(fn, maxDepth, key) {
  const a = maxJump(fn, maxDepth, 4000, key), b = maxJump(fn, maxDepth, 40000, key);
  return { a, b, shrink: a.m > 1e-9 ? a.m / Math.max(b.m, 1e-12) : Infinity };
}
const js = j => j.a.m < 1e-9 ? "none" : `${j.shrink.toFixed(1)}x (${j.a.m.toFixed(1)}@${j.a.at.toFixed(2)})`;

// ---- measurement ---------------------------------------------------------------
function samples(fn, maxDepth, N) {
  const S = [];
  for (let i = 0; i <= N; i++) {
    const d = (i / N) * maxDepth;
    const { pos, tgt } = fn(d);
    S.push({ d, pos, tgt });
  }
  return S;
}
function velocities(S, key) {
  const v = [];
  for (let i = 1; i < S.length; i++) v.push((S[i].pos[key] - S[i-1].pos[key]) / (S[i].d - S[i-1].d));
  return v;
}
const peak = v => Math.max(...v.map(Math.abs));
const rng = a => Math.max(...a) - Math.min(...a);

function analyse(fn, maxDepth, fov) {
  const S = samples(fn, maxDepth, 4000);
  const S10 = samples(fn, maxDepth, 40000);
  const yaw = S.map(s => { const f = s.tgt.clone().sub(s.pos); return Math.atan2(f.x, -f.z) * 180 / Math.PI; });
  const yawVerbatim = S.map(s => { const f = s.tgt.clone().sub(s.pos).normalize(); return Math.atan2(f.x, f.z) * 180 / Math.PI; });
  const pitch = S.map(s => { const f = s.tgt.clone().sub(s.pos); return -Math.atan2(f.y, Math.hypot(f.x, f.z)) * 180 / Math.PI; });
  const dy = velocities(S, "y"), dx = velocities(S, "x");
  const dx10 = velocities(S10, "x"), dy10 = velocities(S10, "y");
  // crab: angle between where the camera is going and where it is looking
  let crab = 0;
  for (let i = 1; i < S.length; i++) {
    const a = S[i-1], b = S[i];
    const travel = Math.atan2(b.pos.x - a.pos.x, -(b.pos.z - a.pos.z)) * 180 / Math.PI;
    crab = Math.max(crab, Math.abs(travel - yaw[i]));
  }
  // lead: the lag (depth) at which heading best predicts later lateral velocity
  let lead = 0, bestC = -Infinity;
  const h = yaw.slice(1), n = dx.length, mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  for (let lagI = -1200; lagI <= 1200; lagI += 10) {
    const A = [], B = [];
    for (let i = 0; i < n; i++) { const j = i + lagI; if (j >= 0 && j < n) { A.push(h[i]); B.push(dx[j]); } }
    const ma = mean(A), mb = mean(B);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < A.length; i++) { num += (A[i]-ma)*(B[i]-mb); da += (A[i]-ma)**2; db += (B[i]-mb)**2; }
    const c = num / Math.sqrt(da * db || 1);
    if (c > bestC) { bestC = c; lead = lagI * maxDepth / 4000; }
  }
  const px = parallax(fn, maxDepth*0.30, maxDepth*0.45, fov);
  return {
    lat: rng(S.map(s => s.pos.x)),
    yaw: rng(yaw),
    yawVerbatim: rng(yawVerbatim),
    pitchMin: Math.min(...pitch), pitchMax: Math.max(...pitch),
    px: px.drift * 100,
    vstep: worstStep(dy, S, 5),
    vstepRel: worstStep(dy, S, 0.1 * peak(dy)),
    vstep10: worstStep(dy10, S10, 5),
    lstepRel: worstStep(dx, S, 0.1 * peak(dx)),
    lstep4k: worstStep(dx, S, 5),
    lstep40k: worstStep(dx10, S10, 5),
    crab, lead, leadCorr: bestC,
    jx: jumpShrink(fn, maxDepth, "x"),
    jy: jumpShrink(fn, maxDepth, "y"),
  };
}

// ---- results table ---------------------------------------------------------------
const A = analyse(ours, MAX_RAIL_DEPTH, 31);
const B = analyse(astra, 1.0, 38);
const C = analyse(v2, MAX_RAIL_DEPTH, FOV);
const C38 = analyse(v2, MAX_RAIL_DEPTH, 38);

const f = (v, d = 1) => (typeof v === "number" ? v.toFixed(d) : String(v));
const st = s => `${s.worst.toFixed(3)}x @${s.at.toFixed(3)}`;
const rows = [
  ["lateral travel (units)",            f(A.lat,0), f(B.lat,0), f(C.lat,0), ">= 150"],
  ["heading change (deg, from -z)",     f(A.yaw), f(B.yaw), f(C.yaw), ">= 12"],
  ["  (verbatim atan2(x,z), wraps)",    f(A.yawVerbatim), f(B.yawVerbatim), f(C.yawVerbatim), "info"],
  ["pitch below horizon (deg)",         `${f(A.pitchMin)}..${f(A.pitchMax)}`, `${f(B.pitchMin)}..${f(B.pitchMax)}`, `${f(C.pitchMin)}..${f(C.pitchMax)}`, "low, ~5-7"],
  ["true parallax (%screen)",           f(A.px,2), f(B.px,2), f(C.px,2), "101.1..136.8"],
  ["  v2 at Astra's fov 38",            "", "", f(C38.px,2), "info"],
  ["vertical step, verbatim (floor 5)", st(A.vstep), st(B.vstep), st(C.vstep), "<= 1.15"],
  ["  same, 10x finer sampling",        st(A.vstep10), st(B.vstep10), st(C.vstep10), "info"],
  ["  floor 10% of peak",               st(A.vstepRel), st(B.vstepRel), st(C.vstepRel), "info"],
  ["lateral step (floor 10% of peak)",  st(A.lstepRel), st(B.lstepRel), st(C.lstepRel), "<= 1.15"],
  ["  raw floor 5, N=4000",             st(A.lstep4k), st(B.lstep4k), st(C.lstep4k), "info"],
  ["  raw floor 5, N=40000",            st(A.lstep40k), st(B.lstep40k), st(C.lstep40k), "info"],
  ["x velocity jump shrink at 10x N",    js(A.jx), js(B.jx), js(C.jx), "~10x = no step"],
  ["y velocity jump shrink at 10x N",    js(A.jy), js(B.jy), js(C.jy), "~10x = no step"],
  ["max crab (travel vs look, deg)",    f(A.crab), f(B.crab), f(C.crab), "info"],
  ["aim leads body by (depth)",         "n/a", `${f(B.lead,3)} r=${f(B.leadCorr,2)}`, `${f(C.lead,3)} r=${f(C.leadCorr,2)}`, "info"],
];
console.log("\n=== CAMERA RAIL: ours / Astra / v2 ===");
console.log("".padEnd(36) + "ours".padStart(18) + "Astra".padStart(18) + "v2".padStart(18) + "   target");
for (const r of rows) console.log(r[0].padEnd(36) + r[1].padStart(18) + r[2].padStart(18) + r[3].padStart(18) + "   " + r[4]);

// ---- assertions ------------------------------------------------------------------
const failures = [];
function check(ok, what, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures.push(what);
}
console.log("\n=== TARGETS ===");
check(C.lat >= 150, "lateral travel >= 150 units", f(C.lat, 1));
check(C.yaw >= 12, "heading change >= 12 deg", f(C.yaw, 2));
// V3: the camera descends from the opening lift onto a1, so its vertical
// speed passes through zero near depth 0.09, exactly the case the header
// describes for lateral. Judged the same way: floor at 10% of peak speed, and
// the verbatim floor-5 figure shown to shrink at 10x sampling.
check(C.vstepRel.worst <= 1.15, "worst vertical-velocity step <= 1.15x (floor 10% of peak)", st(C.vstepRel));
check(C.vstep10.worst - 1 < 0.2 * (C.vstep.worst - 1) + 1e-3,
  "vertical floor-5 figure is a sampling artifact (10x finer sampling shrinks it >= 5x)",
  `${st(C.vstep)} -> ${st(C.vstep10)}`);
check(C.lstepRel.worst <= 1.15, "worst lateral-velocity step <= 1.15x", st(C.lstepRel));
check(C.lstep40k.worst - 1 < 0.2 * (C.lstep4k.worst - 1) + 1e-3,
  "lateral floor-5 figure is a sampling artifact (10x finer sampling shrinks it >= 5x)",
  `${st(C.lstep4k)} -> ${st(C.lstep40k)}`);
check(C.jx.shrink >= 8 && C.jy.shrink >= 8, "no velocity step anywhere: largest jump shrinks >= 8x at 10x sampling",
  `x ${C.jx.shrink.toFixed(1)}x, y ${C.jy.shrink.toFixed(1)}x; Astra x ${B.jx.shrink.toFixed(1)}x, ours y ${A.jy.shrink.toFixed(1)}x`);
check(Math.abs(C.px - B.px) <= 0.15 * B.px, "true parallax within 15% of Astra", `${f(C.px,2)} vs ${f(B.px,2)}`);
check(C.pitchMin >= 7.9 && C.pitchMin <= 8.1 && C.pitchMax >= 15.9 && C.pitchMax <= 16.1, "v3 pitch climbs 8 -> 16 deg down", `${f(C.pitchMin,2)}..${f(C.pitchMax,2)}`);
{
  // Pitch rate and its change: the climb is a smootherstep, so both are continuous.
  const P = [];
  for (let i = 0; i <= 8800; i++) P.push(rail.pitchAt(i / 10000));
  let mono = true, worstRate = 0, worstJerk = 0;
  for (let i = 1; i < P.length; i++) {
    if (P[i] < P[i - 1] - 1e-12) mono = false;
    if (i > 1) {
      const r1 = P[i] - P[i - 1], r0 = P[i - 1] - P[i - 2];
      worstRate = Math.max(worstRate, Math.abs(r1 - r0) * 10000);
    }
  }
  check(mono, "v3 pitch never tilts back up while descending the valley", "monotone over 0..0.88");
  check(worstRate < 0.05, "v3 pitch rate continuous (no kink)", `largest change of rate between samples ${worstRate.toFixed(4)} deg/depth per sample`);
  check(Math.abs(rail.pitchAt(0) - 8) < 1e-9 && Math.abs(rail.pitchAt(0.83) - 16) < 1e-9, "8 deg at the shore, 16 at a8's stop", `${rail.pitchAt(0).toFixed(2)}, ${rail.pitchAt(0.83).toFixed(2)}`);
}

// ---- the climb: C1 (and C2) ---------------------------------------------------------
console.log("\n=== CLIMB CONTINUITY ===");
const CLIMB_MID=0.45, CLIMB_BLEND=0.20, CLIMB_RATE=210;
function climb(d){ const a=CLIMB_MID-CLIMB_BLEND; if(d<=a) return 0;
  if(d>=CLIMB_MID+CLIMB_BLEND) return CLIMB_RATE*(d-CLIMB_MID);
  const u=(d-a)/(2*CLIMB_BLEND); return 2*CLIMB_RATE*CLIMB_BLEND*(u*u*u-0.5*u*u*u*u); }
for (const k of [CLIMB_MID - CLIMB_BLEND, CLIMB_MID + CLIMB_BLEND]) {
  const e = 1e-6;
  const vL = climb(k - e), vR = climb(k + e);
  const sL = (climb(k - e) - climb(k - 2*e)) / e, sR = (climb(k + 2*e) - climb(k + e)) / e;
  const e2 = 1e-4;
  const cL = (climb(k - e2) - 2*climb(k - 2*e2) + climb(k - 3*e2)) / (e2*e2);
  const cR = (climb(k + 3*e2) - 2*climb(k + 2*e2) + climb(k + e2)) / (e2*e2);
  check(Math.abs(vR - vL) < 1e-3, `climb value continuous at ${k.toFixed(2)}`, `${vL.toFixed(6)} | ${vR.toFixed(6)}`);
  check(Math.abs(sR - sL) < 0.5, `climb slope continuous at ${k.toFixed(2)}`, `${sL.toFixed(3)} | ${sR.toFixed(3)}`);
  console.log(`        curvature either side: ${cL.toFixed(2)} | ${cR.toFixed(2)}  (continuous too, so the climb is C2)`);
}
let worstH = 0;
for (let i = 0; i <= 880; i++) {
  const d = i / 1000, { pos } = v2(d);
  worstH = Math.max(worstH, Math.abs(pos.y - (108 + d*96 + climb(d) - rail.dropAt(d))));
}
check(worstH < 0.01, "rail height = 108 + 96d + climb(d) - dropAt(d) with no ground set", `worst error ${worstH.toExponential(2)} units`);
// The drop (rail.ts DROP_KNOTS) lowers the camera at the area stops; pitch is
// checked unchanged above, so it moves the whole view down, never tilts it.
{
  let dropMax = 0, dropMin = Infinity;
  for (let i = 0; i <= 880; i++) { const x = rail.dropAt(i / 1000); dropMax = Math.max(dropMax, x); dropMin = Math.min(dropMin, x); }
  // V3: the only negative drop (a lift) is the opening view's, gone by a1.
  let liftAfterA1 = 0;
  for (let i = 60; i <= 880; i++) liftAfterA1 = Math.min(liftAfterA1, rail.dropAt(i / 1000));
  check(dropMin >= -80.01 && dropMax <= 70 && liftAfterA1 > -1, "height drop within -80..70 units, the lift only at the start (gone by depth 0.06)", `${dropMin.toFixed(1)}..${dropMax.toFixed(1)}, after 0.06: >= ${liftAfterA1.toFixed(2)}`);
}

// ---- landmark framing + depthNearest -------------------------------------------------
console.log("\n=== LANDMARKS: framing on arrival, depthNearest ===");
const LANDMARKS = [ // ridge.py LANDMARK_SPOTS, area depths from check_geom.py
  ["a1 Lighthouse", 0.135, -0.40, 0.0708], ["a2 Windmill", 0.265, 0.34, 0.1934],
  ["a3 Bridge", 0.378, 0.00, 0.3000], ["a4 Viaduct", 0.500, 0.098, 0.4151],
  ["a5 Watchtower", 0.615, -0.30, 0.5236], ["a6 Cairn", 0.730, -0.26, 0.6321],
  ["a7 Jetty", 0.7875, -0.20, 0.6863], ["a8 Obelisk", 0.940, -0.10, 0.8302],
];
let worstOurs = 0, worstV2 = 0, worstNearest = 0;
console.log("  area             depth   screen x (ours)  screen x (v2)   depthNearest");
for (const [name, t, fx, depth] of LANDMARKS) {
  const p = new T.Vector3(fx * LEN_X * 0.5, 40, LEN_Y * 0.5 - t * LEN_Y);
  const xo = p.clone().project(cameraAt(ours, depth, 31, 16/9)).x;
  const xv = p.clone().project(cameraAt(v2, depth, FOV, 16/9)).x;
  const dn = rail.depthNearest(p.x, p.z);
  worstOurs = Math.max(worstOurs, Math.abs(xo)); worstV2 = Math.max(worstV2, Math.abs(xv));
  worstNearest = Math.max(worstNearest, Math.abs(dn - depth));
  console.log(`  ${name.padEnd(15)} ${depth.toFixed(4)}   ${xo.toFixed(2).padStart(13)}  ${xv.toFixed(2).padStart(13)}   ${dn.toFixed(4)}`);
}
check(worstV2 < worstOurs, "v2 frames the landmarks nearer the centre on arrival than ours",
  `worst |screen x| ${worstV2.toFixed(2)} vs ${worstOurs.toFixed(2)} (1.0 = frame edge)`);
check(worstNearest <= 0.01, "depthNearest(landmark) lands within 0.01 of check_geom's area depth", `worst ${worstNearest.toFixed(4)}`);
const pz = LEN_Y * 0.5 - 0.5 * LEN_Y;
check(Math.abs(rail.pathXAtZ(pz) - 0.098 * LEN_X * 0.5) < 1e-6, "pathXAtZ matches ridge.py at the viaduct", f(rail.pathXAtZ(pz), 3));

// ---- ?pitch=low is V2's rail ------------------------------------------------------------
console.log("\n=== ?pitch=low == V2 ===");
{
  const lo = createRail({ pitch: "low" }), v2r = createRailV2();
  const a = { position: new T.Vector3(), target: new T.Vector3() }, b = { position: new T.Vector3(), target: new T.Vector3() };
  const worst = (g) => {
    lo.setGround(g); v2r.setGround(g);
    let w = 0;
    for (let i = 0; i <= 8800; i++) {
      const d = i / 10000;
      lo.sample(d, a); v2r.sample(d, b);
      w = Math.max(w, a.position.distanceTo(b.position), a.target.distanceTo(b.target));
    }
    return w;
  };
  const bare = worst(null);
  const hilly = worst((x, z) => 30 + 0.012 * x * x + 150 * Math.exp(-(((z - 100) / 70) ** 2)));
  check(bare === 0 && hilly === 0, "createRail({pitch:'low'}) samples exactly V2's rail (bare and on terrain)", `worst difference ${bare} / ${hilly} units`);
  let pmin = Infinity, pmax = -Infinity;
  for (let i = 0; i <= 880; i++) { const p = lo.pitchAt(i / 1000); pmin = Math.min(pmin, p); pmax = Math.max(pmax, p); }
  check(pmin >= 5.19 && pmax <= 7.2, "low pitch is V2's 5.2..7.1", `${pmin.toFixed(2)}..${pmax.toFixed(2)}`);
  let dn = 0;
  for (const [x, z] of [[-124, 730], [105, 470], [0, 244], [30, 0], [-93, -230], [-80, -460], [-62, -575], [-31, -880]]) dn = Math.max(dn, Math.abs(rail.depthNearest(x, z) - v2r.depthNearest(x, z)));
  check(dn < 1e-9, "area stops (depthNearest) identical in v3 and v2", `worst ${dn}`);
}

// ---- terrain follow ----------------------------------------------------------------------
console.log("\n=== TERRAIN FOLLOW ===");
function groundRun(name, g) {
  rail.setGround(g);
  const S = samples(v2, MAX_RAIL_DEPTH, 4000);
  let clr = Infinity, tclr = Infinity, lift = 0, tdist = Infinity;
  for (const s of S) {
    clr = Math.min(clr, s.pos.y - g(s.pos.x, s.pos.z));
    tclr = Math.min(tclr, s.tgt.y - g(s.tgt.x, s.tgt.z));
    lift = Math.max(lift, s.pos.y - (108 + s.d*96 + climb(s.d)));
    tdist = Math.min(tdist, Math.hypot(s.tgt.x - s.pos.x, s.tgt.z - s.pos.z));
  }
  const dy = velocities(S, "y");
  const vs = worstStep(dy, S, 0.1 * peak(dy));
  const vs5 = worstStep(dy, S, 5);
  const S10 = samples(v2, MAX_RAIL_DEPTH, 40000);
  const vs5f = worstStep(velocities(S10, "y"), S10, 5);
  const pitch = S.map(s => { const f = s.tgt.clone().sub(s.pos); return -Math.atan2(f.y, Math.hypot(f.x, f.z)) * 180 / Math.PI; });
  const pitchMin = Math.min(...pitch), pitchMax = Math.max(...pitch);
  const jy = jumpShrink(v2, MAX_RAIL_DEPTH, "y");
  console.log(`  ${name}:\n      min camera clearance ${clr.toFixed(1)}, max camera lift ${lift.toFixed(1)}, ` +
    `min target clearance ${tclr.toFixed(2)}, nearest target ${tdist.toFixed(0)} units ahead (900 bare)\n` +
    `      pitch ${pitchMin.toFixed(2)}..${pitchMax.toFixed(2)} deg, vertical step ${st(vs)} (floor 10%), ${st(vs5)} (floor 5) -> ${st(vs5f)} at 10x sampling\n` +
    `      largest vertical velocity jump ${jy.a.m.toFixed(2)} -> ${jy.b.m.toFixed(3)} at 10x sampling (${jy.shrink.toFixed(1)}x smaller)`);
  return { clr, tclr, lift, vs, pitchMin, pitchMax, jy };
}
// The valley shoulder: ground rising with |x|, steep enough to lift the camera.
const shoulder = (x, z) => 30 + 0.012 * x * x;
const r1 = groundRun("shoulder 30+0.012x^2", shoulder);
check(r1.clr >= 35, "shoulder: camera never below ground + 35", f(r1.clr, 2));
check(r1.tclr >= 4.5, "shoulder: look target stays above ground + 4.5", f(r1.tclr, 2));
check(r1.lift > 5, "shoulder: terrain follow actually engaged", `max lift ${f(r1.lift, 1)}`);
check(r1.vs.worst <= 1.15 && r1.jy.shrink >= 8, "shoulder: no vertical-velocity step from the follow", `${st(r1.vs)}, jump shrinks ${r1.jy.shrink.toFixed(1)}x`);
const pitchKept = r => Math.abs(r.pitchMin - C.pitchMin) < 0.05 && Math.abs(r.pitchMax - C.pitchMax) < 0.05;
check(pitchKept(r1), "shoulder: pitch unchanged by the follow", `${f(r1.pitchMin,2)}..${f(r1.pitchMax,2)}`);
// A ridge straight across the valley: the worst case for a hard clamp.
const ridge = (x, z) => shoulder(x, z) + 150 * Math.exp(-(((z - 100) / 70) ** 2));
const r2 = groundRun("shoulder + 150-unit ridge", ridge);
check(r2.clr >= 35, "ridge: camera never below ground + 35", f(r2.clr, 2));
check(r2.vs.worst <= 1.15 && r2.jy.shrink >= 8, "ridge: no vertical-velocity step from the follow", `${st(r2.vs)}, jump shrinks ${r2.jy.shrink.toFixed(1)}x`);
check(r2.tclr >= 4.5, "ridge: look target stays above ground + 4.5", f(r2.tclr, 2));
check(pitchKept(r2), "ridge: pitch unchanged by the follow", `${f(r2.pitchMin,2)}..${f(r2.pitchMax,2)}`);

// The real terrain, read-only, from the shipped uncompressed glb.
const GLB = path.join(HERE, "..", "public", "world", "world.glb");
function terrainFromGlb(file) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString());
  const bin = 20 + jl + 8;
  const node = j.nodes.find(n => n.name === "Terrain");
  if (!node || node.mesh === undefined || node.translation || node.rotation || node.scale || node.matrix) return null;
  const prim = j.meshes[node.mesh].primitives[0];
  const read = (ai, Ctor, comps) => {
    const acc = j.accessors[ai], bv = j.bufferViews[acc.bufferView];
    const off = bin + (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = bv.byteStride || Ctor.BYTES_PER_ELEMENT * comps;
    const out = new Ctor(acc.count * comps);
    for (let i = 0; i < acc.count; i++) for (let c = 0; c < comps; c++) {
      const o = off + i * stride + c * Ctor.BYTES_PER_ELEMENT;
      out[i * comps + c] = Ctor === Float32Array ? b.readFloatLE(o) : Ctor === Uint16Array ? b.readUInt16LE(o) : b.readUInt32LE(o);
    }
    return out;
  };
  const P = read(prim.attributes.POSITION, Float32Array, 3);
  const I = read(prim.indices, j.accessors[prim.indices].componentType === 5125 ? Uint32Array : Uint16Array, 1);
  const CELL = 4, x0 = -868, z0 = -1000, nx = Math.round(1736 / CELL) + 1, nz = Math.round(2000 / CELL) + 1;
  const H = new Float32Array(nx * nz).fill(NaN);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]*3, b2 = I[t+1]*3, c = I[t+2]*3;
    const ax = P[a], az = P[a+2], bx = P[b2], bz = P[b2+2], cx = P[c], cz = P[c+2];
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-9) continue;
    const i0 = Math.max(0, Math.ceil((Math.min(ax,bx,cx) - x0) / CELL)), i1 = Math.min(nx-1, Math.floor((Math.max(ax,bx,cx) - x0) / CELL));
    const k0 = Math.max(0, Math.ceil((Math.min(az,bz,cz) - z0) / CELL)), k1 = Math.min(nz-1, Math.floor((Math.max(az,bz,cz) - z0) / CELL));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const x = x0 + i * CELL, z = z0 + k * CELL;
      const w1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
      const w2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
      const w3 = 1 - w1 - w2;
      if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
      const y = w1 * P[a+1] + w2 * P[b2+1] + w3 * P[c+1];
      const idx = k * nx + i;
      if (!(H[idx] >= y)) H[idx] = y;
    }
  }
  return (x, z) => { // bilinear, clamped to the edge (as heightfield.ts does)
    const fx = clamp((x - x0) / CELL, 0, nx - 1.000001), fz = clamp((z - z0) / CELL, 0, nz - 1.000001);
    const i = Math.floor(fx), k = Math.floor(fz), u = fx - i, w = fz - k;
    const h = (ii, kk) => { const v = H[kk * nx + ii]; return v === v ? v : 0; };
    return (h(i,k)*(1-u) + h(i+1,k)*u) * (1-w) + (h(i,k+1)*(1-u) + h(i+1,k+1)*u) * w;
  };
}
if (fs.existsSync(GLB)) {
  const terrain = terrainFromGlb(GLB);
  if (terrain) {
    const r3 = groundRun("REAL terrain (public/world/world.glb)", terrain);
    check(r3.clr >= 35, "real terrain: camera never below ground + 35", f(r3.clr, 2));
    check(r3.tclr >= 4.5, "real terrain: look target stays above ground + 4.5", f(r3.tclr, 2));
    check(r3.vs.worst <= 1.15 && r3.jy.shrink >= 8, "real terrain: no vertical-velocity step", `${st(r3.vs)}, jump shrinks ${r3.jy.shrink.toFixed(1)}x`);
    check(pitchKept(r3), "real terrain: pitch unchanged (Lovro's ~5 degree camera)", `${f(r3.pitchMin,2)}..${f(r3.pitchMax,2)}`);
    // How close would the camera come with no follow at all?
    rail.setGround(null);
    let bare = Infinity, at = 0;
    for (const s of samples(v2, MAX_RAIL_DEPTH, 4000)) {
      const c = s.pos.y - terrain(s.pos.x, s.pos.z);
      if (c < bare) { bare = c; at = s.d; }
    }
    console.log(`        without terrain follow the closest pass is ${bare.toFixed(1)} units at depth ${at.toFixed(3)}`);
  } else console.log("  Terrain node missing or transformed; real-terrain check skipped.");
} else console.log("  public/world/world.glb not found; real-terrain check skipped.");
rail.setGround(null);
let reset = 0;
for (let i = 0; i <= 88; i++) { const d = i / 100; reset = Math.max(reset, Math.abs(v2(d).pos.y - (108 + d*96 + climb(d) - rail.dropAt(d)))); }
check(reset < 0.01, "setGround(null) restores the bare rail", `worst ${reset.toExponential(2)}`);

// ---- sample() allocates nothing ----------------------------------------------------------
// Depths come from a generic-elements array, so each one is already a boxed
// number and the CALL does not allocate. (Passing a freshly computed double
// to any non-inlined function makes V8 box it: one 16-byte number per frame
// in the scene, which is the caller's, and printed below for scale.)
console.log("\n=== ALLOCATION ===");
const { PerformanceObserver } = await import("node:perf_hooks");
const pose = { position: new T.Vector3(), target: new T.Vector3() };
const boxed = [];
for (let i = 0; i < 8800; i++) boxed.push(i / 10000 + 1e-9);
boxed.push("generic"); boxed.pop();
function preBoxed(n) { for (let i = 0; i < n; i++) rail.sample(boxed[i % 8800], pose); }
function freshDouble(n) { for (let i = 0; i < n; i++) rail.sample((i % 8800) / 10000, pose); }
async function gcsDuring(fn, n) {
  fn(300000); fn(300000);
  let count = 0;
  const obs = new PerformanceObserver(list => { count += list.getEntries().length; });
  obs.observe({ entryTypes: ["gc"] });
  fn(n);
  await new Promise(r => setTimeout(r, 50));
  obs.disconnect();
  return count;
}
const g3 = await gcsDuring(preBoxed, 3_000_000);
const g30 = await gcsDuring(preBoxed, 30_000_000);
const gf = await gcsDuring(freshDouble, 3_000_000);
check(g30 <= 2 && g30 <= g3 + 1, "sample() allocates nothing (GC count does not grow with calls)",
  `${g3} GCs over 3M calls, ${g30} over 30M; caller boxing a fresh double: ${gf} over 3M`);

console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join("; ")}` : "\nALL PASS");
process.exit(failures.length ? 1 : 0);
