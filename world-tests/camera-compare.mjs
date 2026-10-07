/**
 * Measure both camera rails. First version of this script used a probe point
 * defined RELATIVE to each camera, so it compared two different world points
 * and the "parallax" number was meaningless. This version measures parallax the
 * way it is actually defined: two objects at different distances that start at
 * the SAME screen position, and how far apart they drift as the camera advances.
 */
import * as T from "three";

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const LEN_Y = 2000.0;

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

function analyse(name, fn, maxDepth, fov) {
  const N = 4000;                                  // fine enough to catch a step
  const S = [];
  for (let i = 0; i <= N; i++) {
    const d = (i / N) * maxDepth;
    const { pos, tgt } = fn(d);
    const fwd = tgt.clone().sub(pos).normalize();
    S.push({ d, pos, yaw: Math.atan2(fwd.x, fwd.z) * 180 / Math.PI });
  }
  const dy = [], dlat = [];
  for (let i = 1; i < S.length; i++) {
    const h = S[i].d - S[i-1].d;
    dy.push((S[i].pos.y - S[i-1].pos.y) / h);
    dlat.push(Math.abs(S[i].pos.x - S[i-1].pos.x) / h);
  }
  // worst instantaneous ratio in vertical velocity between adjacent steps
  let worst = 1, at = 0;
  for (let i = 1; i < dy.length; i++) {
    const lo = Math.min(Math.abs(dy[i-1]), Math.abs(dy[i]));
    const hi = Math.max(Math.abs(dy[i-1]), Math.abs(dy[i]));
    if (lo > 5 && hi/lo > worst) { worst = hi/lo; at = S[i].d; }
  }
  const xs = S.map(s=>s.pos.x), yaws = S.map(s=>s.yaw);
  const rng = a => Math.max(...a) - Math.min(...a);
  const px = parallax(fn, maxDepth*0.30, maxDepth*0.45, fov);
  console.log(`\n=== ${name} ===`);
  console.log(`  lateral travel         ${rng(xs).toFixed(0).padStart(6)} units`);
  console.log(`  heading change         ${rng(yaws).toFixed(1).padStart(6)}°`);
  console.log(`  true parallax          ${(px.drift*100).toFixed(2).padStart(6)} %screen  (near/far pair drift over 15% of journey)`);
  console.log(`  worst vertical-v step  ${worst.toFixed(2).padStart(6)}x at depth ${at.toFixed(3)}`);
  return { lat: rng(xs), yaw: rng(yaws), px: px.drift*100, step: worst, at };
}

const A = analyse("OURS   /dev/world", ours, 0.88, 31);
const B = analyse("ASTRA  /dev/world-codex", astra, 1.0, 38);
console.log(`\n=== SIDE BY SIDE ===`);
console.log(`                        ours      Astra`);
console.log(`  lateral travel   ${A.lat.toFixed(0).padStart(9)} ${B.lat.toFixed(0).padStart(10)}  units`);
console.log(`  heading change   ${A.yaw.toFixed(1).padStart(9)} ${B.yaw.toFixed(1).padStart(10)}  degrees`);
console.log(`  true parallax    ${A.px.toFixed(2).padStart(9)} ${B.px.toFixed(2).padStart(10)}  %screen`);
console.log(`  worst v-step     ${A.step.toFixed(2).padStart(9)} ${B.step.toFixed(2).padStart(10)}  x`);
