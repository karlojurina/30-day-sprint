/**
 * Round 1 verify: reads the per-frame camera record of v6-r1-verify-scroll.mjs
 * and checks Lovro's camera points objectively.
 *
 *   node world-tests/v6-r1-verify-analyse.mjs
 *
 * Bearings are compass degrees (0 = -z, 90 = +x), unwrapped; pitch is degrees
 * ABOVE the horizon (positive looks up). Stretches are cut at the route's
 * named keys (layout ROUTE_MARKS) and the stops, read from info.json, so the
 * checks survive a change in the number of keys.
 *
 * Out: world-tests/shots/v6/round1/verify/scroll/analysis.json and a printout.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve((process.env.VERIFY_ROOT || "world-tests/shots/v6/round1/verify") + "/scroll");
const info = JSON.parse(fs.readFileSync(path.join(DIR, "info.json"), "utf8"));
const rec = JSON.parse(fs.readFileSync(path.join(DIR, "rec.json"), "utf8"));
const DEG = 180 / Math.PI;
const M = info.marks;
const keyS = (k) => {
  const i = Math.floor(k);
  const u = k - i;
  if (i >= info.keys - 1) return info.keyS[info.keys - 1];
  return info.keyS[i] + (info.keyS[i + 1] - info.keyS[i]) * u;
};

// Rendered frames only: drop rows where nothing moved and the frame count held.
const rows = [];
for (const r of rec.rows) {
  const p = rows[rows.length - 1];
  if (p && p.f === r.f && p.pos[0] === r.pos[0] && p.pos[1] === r.pos[1] && p.pos[2] === r.pos[2] && p.fwd[0] === r.fwd[0]) continue;
  rows.push(r);
}
let unwrap = null;
for (const r of rows) {
  const [fx, fy, fz] = r.fwd;
  let b = Math.atan2(fx, -fz) * DEG;
  if (unwrap !== null) {
    while (b - unwrap > 180) b -= 360;
    while (b - unwrap < -180) b += 360;
  }
  unwrap = b;
  r.bearing = b;
  r.pitch = Math.asin(Math.max(-1, Math.min(1, fy))) * DEG;
  // Roll: the camera's up against the world's up, about the view axis.
  const right = [fz * r.up[1] - fy * r.up[2], fx * r.up[2] - fz * r.up[0], fy * r.up[0] - fx * r.up[1]].map((v) => -v);
  r.roll = Math.asin(Math.max(-1, Math.min(1, right[1]))) * DEG;
}
for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1];
  const b = rows[i];
  const v = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]];
  b.v = v;
  b.speed = Math.hypot(...v);
  const hv = Math.hypot(v[0], v[2]);
  const hf = Math.hypot(b.fwd[0], b.fwd[2]);
  // Moving backwards: horizontal travel against the horizontal view (only when moving).
  b.along = hv > 1e-6 && hf > 1e-6 ? (v[0] * b.fwd[0] + v[2] * b.fwd[2]) / (hv * hf) : null;
  b.dYaw = b.bearing - a.bearing;
  b.dPitch = b.pitch - a.pitch;
  b.dAng = Math.acos(Math.max(-1, Math.min(1, a.fwd[0] * b.fwd[0] + a.fwd[1] * b.fwd[1] + a.fwd[2] * b.fwd[2]))) * DEG;
}

const inS = (s0, s1) => rows.filter((r) => r.s >= s0 && r.s <= s1 && r.v);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Yaw profile over a stretch: net and total swept yaw, and the swings: runs of
 * one turning direction longer than `minSwing` degrees. A back-and-forth is a
 * swing followed by one the other way. Measured on the yaw as a function of
 * route distance (smoothed over 8 units) so scroll speed does not matter.
 */
function yawProfile(s0, s1, minSwing = 8) {
  const R = inS(s0, s1);
  if (R.length < 3) return null;
  // Resample bearing on s every 4 units.
  const pts = [];
  for (let s = s0; s <= s1; s += 4) {
    let j = R.findIndex((r) => r.s >= s);
    if (j < 0) j = R.length - 1;
    pts.push({ s, b: R[j].bearing, p: R[j].pitch });
  }
  // Smooth over +-2 samples.
  const sm = pts.map((p, i) => {
    let a = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) {
      const q = pts[i + k];
      if (q) {
        a += q.b;
        n++;
      }
    }
    return { s: p.s, b: a / n, p: p.p };
  });
  let swept = 0;
  const swings = [];
  let cur = null;
  for (let i = 1; i < sm.length; i++) {
    const d = sm[i].b - sm[i - 1].b;
    swept += Math.abs(d);
    const dir = Math.sign(d);
    if (!dir) continue;
    if (!cur || cur.dir !== dir) {
      if (cur) swings.push(cur);
      cur = { dir, from: sm[i - 1].s, to: sm[i].s, deg: 0, b0: sm[i - 1].b };
    }
    cur.deg += Math.abs(d);
    cur.to = sm[i].s;
  }
  if (cur) swings.push(cur);
  const big = swings.filter((w) => w.deg >= minSwing).map((w) => ({ dir: w.dir > 0 ? "right" : "left", deg: r1(w.deg), s: [Math.round(w.from), Math.round(w.to)], from: r1(w.b0) }));
  let reversals = 0;
  for (let i = 1; i < big.length; i++) if (big[i].dir !== big[i - 1].dir) reversals++;
  const back = R.filter((r) => r.along !== null && r.speed > 0.05 && r.along < -0.2);
  return {
    s: [Math.round(s0), Math.round(s1)],
    frames: R.length,
    bearingStart: r1(sm[0].b),
    bearingEnd: r1(sm[sm.length - 1].b),
    net: r1(sm[sm.length - 1].b - sm[0].b),
    swept: r1(swept),
    range: [r1(Math.min(...sm.map((p) => p.b))), r1(Math.max(...sm.map((p) => p.b)))],
    pitchRange: [r1(Math.min(...sm.map((p) => p.p))), r1(Math.max(...sm.map((p) => p.p)))],
    swings: big,
    reversals,
    backwardFrames: back.length,
    backwardShare: r2(back.length / R.length),
  };
}

const out = {};
const S = (k) => keyS(k);
// 1. The top of the falls: from the stream to the pool.
out.fallsTop = {
  approach: yawProfile(S(M.stream), S(M.lip)),
  overLip: yawProfile(S(M.lip), S(M.fall)),
  ride: yawProfile(S(M.fall), S(M.pool)),
};
// Horizontal travel heading from the stream to the lip: does the PATH circle?
{
  const R = inS(S(M.stream), S(M.fall));
  const hs = R.filter((r) => Math.hypot(r.v[0], r.v[2]) > 0.2).map((r) => Math.atan2(r.v[0], -r.v[2]) * DEG);
  out.fallsTop.pathHeading = { min: r1(Math.min(...hs)), max: r1(Math.max(...hs)) };
}
// 2. Video Ads I to II.
out.a3toA4 = {
  whole: yawProfile(info.stopS[2], info.stopS[3]),
  // 2026-10-13: the marks "cave" and "exit" went with the camera's pass through the cave; the move is cut at "crossing" and "wall".
  a3ToCrossing: yawProfile(info.stopS[2], S(M.crossing)),
  crossingToWall: yawProfile(S(M.crossing), S(M.wall)),
  wallToA4: yawProfile(S(M.wall), info.stopS[3]),
};
// 3. After Video Ads II: the turn before the ridge top (the burst).
out.a4toRidge = {
  a4ToTraverse: yawProfile(info.stopS[3], S(M.traverse)),
  traverseToGully: yawProfile(S(M.traverse), S(M.gully)),
  gullyToCrest: yawProfile(S(M.gully), S(M.burst)),
  crestToA5: yawProfile(S(M.burst), info.stopS[4]),
  lastTurnBeforeCrest: null,
};
{
  const R = inS(S(M.gully) - 400, S(M.burst) + 300);
  // Heading at the crest vs 300 units after: how much turning is left after the top.
  const at = (s) => R.reduce((a, r) => (Math.abs(r.s - s) < Math.abs(a.s - s) ? r : a), R[0]);
  const c = at(S(M.burst));
  out.a4toRidge.atCrest = { bearing: r1(c.bearing), pitch: r1(c.pitch) };
  out.a4toRidge.after300 = { bearing: r1(at(S(M.burst) + 300).bearing), pitch: r1(at(S(M.burst) + 300).pitch) };
  const rising = R.filter((r) => r.s > S(M.burst) && r.v[1] > 0.05 && r.along !== null && r.along < -0.2);
  out.a4toRidge.backwardAndUpAfterCrest = rising.length;
}
// 4. The flight: smoothness per frame (steady scroll, so steady time steps).
{
  const [f0, f1] = info.flightS;
  const R = inS(f0, f1).filter((r) => r.speed > 1e-4);
  const sd = (a) => {
    const m = a.reduce((x, y) => x + y, 0) / a.length;
    return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
  };
  // Direction change per frame (deg), its sign reversals on yaw and pitch, the
  // high-pass residue (value minus a centred 9-frame mean), per frame.
  const hp = (key) => {
    let worst = 0;
    let rms = 0;
    let n = 0;
    for (let i = 4; i < R.length - 4; i++) {
      let a = 0;
      for (let k = -4; k <= 4; k++) a += R[i + k][key];
      const h = R[i][key] - a / 9;
      worst = Math.max(worst, Math.abs(h));
      rms += h * h;
      n++;
    }
    return { worst: +worst.toFixed(4), rms: +Math.sqrt(rms / Math.max(1, n)).toFixed(4) };
  };
  // Yaw rate reversals: sign flips of the 9-frame smoothed yaw rate where the
  // swing on each side is over 0.5 degrees (a wobble you would see).
  const smRate = R.map((r, i) => {
    let a = 0;
    let n = 0;
    for (let k = -4; k <= 4; k++) {
      const q = R[i + k];
      if (q) {
        a += q.dYaw;
        n++;
      }
    }
    return a / n;
  });
  let flips = 0;
  let acc = 0;
  let lastSign = 0;
  let accPrev = 0;
  for (const v of smRate) {
    const sg = Math.sign(v);
    if (sg && sg !== lastSign) {
      if (lastSign && Math.abs(acc) > 0.5 && Math.abs(accPrev) > 0.5) flips++;
      accPrev = acc;
      acc = 0;
      lastSign = sg;
    }
    acc += v;
  }
  // Ship in the camera frame (what the eye sees): position relative to the eye.
  const rel = [];
  for (const r of R) {
    if (!r.ship || !r.ship[9]) continue;
    const d = [r.ship[0] - r.pos[0], r.ship[1] - r.pos[1], r.ship[2] - r.pos[2]];
    const f = r.fwd;
    const u = r.up;
    const rt = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
    rel.push({ s: r.s, x: d[0] * rt[0] + d[1] * rt[1] + d[2] * rt[2], y: d[0] * u[0] + d[1] * u[1] + d[2] * u[2], z: d[0] * f[0] + d[1] * f[1] + d[2] * f[2], shipUpX: r.ship[6] * rt[0] + r.ship[7] * rt[1] + r.ship[8] * rt[2] });
  }
  let relStep = 0;
  let relRollStep = 0;
  for (let i = 1; i < rel.length; i++) {
    relStep = Math.max(relStep, Math.hypot(rel[i].x - rel[i - 1].x, rel[i].y - rel[i - 1].y, rel[i].z - rel[i - 1].z));
    const l0 = Math.hypot(rel[i - 1].shipUpX);
    void l0;
    relRollStep = Math.max(relRollStep, Math.abs(Math.asin(Math.max(-1, Math.min(1, rel[i].shipUpX))) - Math.asin(Math.max(-1, Math.min(1, rel[i - 1].shipUpX)))) * DEG);
  }
  const speeds = R.map((r) => r.speed);
  let speedJump = 0;
  for (let i = 1; i < speeds.length; i++) speedJump = Math.max(speedJump, Math.abs(speeds[i] - speeds[i - 1]) / Math.max(1e-6, (speeds[i] + speeds[i - 1]) / 2));
  let backStep = 0;
  for (const r of R) if (r.along !== null && r.along < 0) backStep++;
  out.flight = {
    s: [Math.round(f0), Math.round(f1)],
    frames: R.length,
    dirChangePerFrame: { max: r2(Math.max(...R.map((r) => r.dAng))), mean: r2(R.reduce((a, r) => a + r.dAng, 0) / R.length) },
    yawHighPass: hp("dYaw"),
    pitchHighPass: hp("dPitch"),
    rollHighPass: hp("roll"),
    maxRollStep: r2(Math.max(...R.slice(1).map((r, i) => Math.abs(r.roll - R[i].roll)))),
    yawRateReversals: flips,
    speedPerFrame: { mean: r2(speeds.reduce((a, b) => a + b, 0) / speeds.length), sd: r2(sd(speeds)), worstRelJump: r2(speedJump) },
    framesMovingBackwards: backStep,
    shipInView: { frames: rel.length, maxStepUnits: r2(relStep), maxRollStepDeg: r2(relRollStep) },
  };
}
// 5. The way from a7 to the bridge: pitch (looking up is positive).
out.a7toBridge = yawProfile(info.stopS[6], keyS(M.bridgehead));
// Frame-to-frame smoothness over the whole route (not the flight): worst view
// change per frame and where.
{
  const R = rows.filter((r) => r.v && r.dAng !== undefined);
  const worst = R.reduce((a, r) => (r.dAng > a.dAng ? r : a), R[0]);
  out.whole = { frames: R.length, worstViewStepDeg: r2(worst.dAng), atS: Math.round(worst.s), fps: r1((R.length / (R[R.length - 1].t - R[0].t)) * 1000) };
}
fs.writeFileSync(path.join(DIR, "analysis.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
