/**
 * V4 route check, grey pass 3: layout.ts + terrain.ts, measured, drawn and previewed.
 *
 *   node --import ./world-tests/v4-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v4-route.mjs [--no-shots]
 *
 * Checks (the route is built with a centripetal Catmull-Rom through TRAIL and
 * another through LOOK at the same curve parameter, as the rail builds it;
 * scroll figures use the rail itself, rail.ts createRail):
 *   - clearance by kind: walk/climb/rise/sky >= 35 over the ground (and over
 *     an island's top when above one); the dive >= 15 from any rock; the
 *     bridge exactly BRIDGE_EYE over the deck on its centreline; the flight
 *     >= 200 over the ground; boarding >= 8 over the isle or deck;
 *   - N1: on the walk from the shore to the rim, the share of the frame that
 *     is ground nearer than 600 units (pass 1's dead frames were ~100%);
 *   - N2, the dive: the falls' curtain stays in the middle 60% of the frame
 *     width from the rim to the pool; the pitch changes <= 1.2 deg per vh at
 *     the default pacing, and the tip (pitch 10 to the peak) takes >= 40 vh;
 *   - N6: from behind the first step the step centres project in one line
 *     up the frame;
 *   - N8/N9: the bridge; the flight's length (1,500-2,500); the Harbour Isle
 *     hidden (< 1% of the frame) before the flight begins;
 *   - the Sky Island: hidden from stops 1-4 by terrain alone, never seen
 *     directly before stop 5, and at stop 5 its reflection is in the lake;
 *   - spacing between stops, the ravine floor below camp, the lake level,
 *     the falls lip, the Climb's face, the steps, the pads.
 *   - grey pass 3, THE MINE: every cave, tunnel and shaft sample is inside a
 *     void (layout mineMargin >= 3) or in open air; the terrain stays
 *     MINE_COVER over the hall and the tunnel everywhere but the mouth; the
 *     mouth is behind the curtain and the camera passes through the curtain
 *     and the arch with room; it leaves the shaft through its collar cell,
 *     levelling; the a3 stop frames the mouth from inside, the a4 stop the
 *     lift's cage; the tunnel scrolls by quickly;
 *   - grey pass 3 leftovers: the flight takes 200-300 vh; the star look has
 *     the observatory in the lower part of the frame; the Great Tree is whole
 *     in frame at a6.
 * Writes, to world-tests/shots/v4-pass3/route/: map.svg/png (top down),
 * profile.svg/png (height along the route), views.png (ray-marched grey
 * previews of the stops and the key moments) and report.json.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import * as L from "../src/lib/world-v4/layout.ts";
import { terrainHeight } from "../src/lib/world-v4/terrain.ts";
import { createRail } from "../src/lib/world-v4/rail.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v4-pass3/route");
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = !process.argv.includes("--no-shots");
const { WORLD, PLACES, TRAIL, LOOK, TRAIL_KIND, PATH, STEPS, ISLAND_DEPTH, BOUNTY_DEPTH, HARBOUR_DEPTH } = L;
const FOV = L.DESIGN_FOV;
const ASPECT = 16 / 9;
const report = { checks: {}, stops: [], notes: [] };
let failures = 0;
const check = (name, pass, value) => {
  report.checks[name] = { pass, value };
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
};
const r1 = (v) => Math.round(v * 10) / 10;

// ── The route as the rail will build it ──────────────────────────────────────
const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const posCurve = new THREE.CatmullRomCurve3(TRAIL.map(v3), false, "centripetal");
const lookCurve = new THREE.CatmullRomCurve3(LOOK.map(v3), false, "centripetal");
const nK = TRAIL.length;
const N = 8000;
const dense = [];
{
  let s = 0;
  let prev = null;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = posCurve.getPoint(t);
    const q = lookCurve.getPoint(t);
    if (prev) s += p.distanceTo(prev);
    const seg = Math.min(nK - 2, Math.floor(t * (nK - 1)));
    const a = TRAIL_KIND[seg];
    const b = TRAIL_KIND[seg + 1];
    // A segment touching the dive is the dive (its clearance rule); a segment
    // between the moored and docked keys is the flight; else the start key's kind.
    // On foot next to the bridge and the ship (either end bridge or board, as
    // the rail's NO_TERRAIN_FOLLOW reads it) the board rule applies.
    const foot = (k) => k === "bridge" || k === "board" || k === "flight";
    const kind =
      a === "dive" || b === "dive" ? "dive"
      : seg >= L.FLIGHT_KEYS.first && seg < L.FLIGHT_KEYS.last ? "flight"
      : a === "bridge" && b === "bridge" ? "bridge"
      : foot(a) || foot(b) ? "board"
      : a;
    dense.push({ t, s, p, q, kind, seg });
    prev = p;
  }
}
const sAtKey = (k) => dense[Math.round((k / (nK - 1)) * N)].s;
const total = dense[N].s;

// ── The rail (scroll figures) ────────────────────────────────────────────────
// The rail as the scene builds it: createRail() with its defaults. The layout
// frames the falls itself, so the rail's pass-1 dive helpers (an aim at the
// curtain, a pitch boost to 60) must be off by default; checked below.
const rail = createRail();
const pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
const vhAt = (r, s) => r.depthOfS(s) * r.totalVh();
{
  const bare = createRail({ diveAimDrop: 0, divePitchPeak: 0 });
  let worst = 0;
  for (let s = 0; s <= rail.length; s += 5) worst = Math.max(worst, Math.abs(rail.pitchAtS(s) - bare.pitchAtS(s)), Math.abs(rail.bearingAtS(s) - bare.bearingAtS(s)));
  check("rail.ts defaults: no pass-1 dive helpers (view = the layout's, whole route)", worst < 1e-9, `max view difference ${worst.toFixed(6)} deg (diveAimDrop ${rail.tuning.diveAimDrop}, divePitchPeak ${rail.tuning.divePitchPeak})`);
  // rail.kindAtS is what the scene, the strip and the rail test read: it must
  // name every stretch as this script does (a sample either side of a key may differ).
  let bad = 0;
  const miss = [];
  for (let i = 1; i < N; i++) {
    const d = dense[i];
    const k = rail.kindAtS(d.s);
    // Within 2 units (the rail's table step) of a change of kind the two may
    // round differently (grey pass 3's shaft entry is a 13-unit segment).
    let nearChange = false;
    for (let q = i - 1; q >= 0 && d.s - dense[q].s <= 2 && !nearChange; q--) if (dense[q].kind !== d.kind) nearChange = true;
    for (let q = i + 1; q < dense.length && dense[q].s - d.s <= 2 && !nearChange; q++) if (dense[q].kind !== d.kind) nearChange = true;
    if (k !== d.kind && !nearChange) {
      bad++;
      if (miss.length < 4) miss.push(`s ${Math.round(d.s)} ${d.kind} vs ${k}`);
    }
  }
  check("rail.kindAtS names every stretch as this script does", bad === 0, bad ? `${bad} samples differ: ${miss.join("; ")}` : "all agree");
}

// ── Spacing ──────────────────────────────────────────────────────────────────
{
  let prevS = 0;
  const rows = [];
  for (const pl of PLACES) {
    const s = sAtKey(pl.trail);
    rows.push({ id: pl.id, place: pl.place, s: Math.round(s), stretch: Math.round(s - prevS), scrollVh: pl.scrollVh });
    prevS = s;
  }
  report.stops = rows;
  console.log("\nstop   place                 route-s   stretch  scrollVh");
  for (const r of rows) console.log(`${r.id}     ${r.place.padEnd(20)} ${String(r.s).padStart(7)}   ${String(r.stretch).padStart(7)}   ${r.scrollVh}`);
  console.log(`total camera route ${Math.round(total)}; tail after a8 ${Math.round(total - sAtKey(PLACES[7].trail))}; total scroll ${PLACES.reduce((a, p) => a + p.scrollVh, 0) + L.TAIL_VH + L.FLIGHT_VH}vh (the flight ${L.FLIGHT_VH} of it)`);
  const between = rows.slice(1).map((r) => r.stretch);
  check("stop spacing (a1->a8 stretches, want ~900-4200)", between.every((d) => d >= 900 && d <= 4200), between.join(", "));
  const straight = PLACES.slice(1).map((p, i) => Math.round(Math.hypot(p.pos.x - PLACES[i].pos.x, p.pos.z - PLACES[i].pos.z)));
  report.straightSpacing = straight;
  console.log(`landmark-to-landmark straight line (xz): ${straight.join(", ")}`);
}

// ── Islands (volumes for sight lines and occlusion) ──────────────────────────
const I = WORLD.island;
const B = WORLD.bountyIsle;
const H = WORLD.harbourIsle;
const ISLES = [
  { c: I, depth: ISLAND_DEPTH },
  { c: B, depth: BOUNTY_DEPTH },
  { c: H, depth: HARBOUR_DEPTH },
];
const inIsle = (x, y, z) => {
  for (const { c, depth } of ISLES) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r && y <= c.y && y >= c.y - depth * (1 - d / c.r)) return true;
  }
  return false;
};
/** Ground under (x, z) including the islands' tops (for clearance). */
const groundAt = (x, z) => {
  let h = terrainHeight(x, z);
  const lk = WORLD.lake;
  if (Math.hypot(x - lk.x, z - lk.z) < lk.r) h = Math.max(h, lk.y);
  for (const { c } of ISLES) if (Math.hypot(x - c.x, z - c.z) < c.r) h = Math.max(h, c.y);
  return Math.max(h, WORLD.seaLevel);
};
const disc = (out, c, depth, rings, per, extra = 0) => {
  for (let ri = 0; ri <= rings; ri++) {
    const r = (ri / rings) * c.r;
    const n = ri === 0 ? 1 : per;
    for (let a = 0; a < n; a++) {
      const th = (a / n) * Math.PI * 2;
      const x = c.x + Math.cos(th) * r;
      const z = c.z + Math.sin(th) * r;
      out.push([x, c.y + extra, z]); // top (plus buildings)
      out.push([x, c.y - depth * (1 - r / c.r) - 4, z]); // underside
    }
  }
};
const obs = PLACES.find((p) => p.id === "a7");
const islandPts = [];
disc(islandPts, I, ISLAND_DEPTH, 5, 24);
const mainIslandCount = islandPts.length;
disc(islandPts, B, BOUNTY_DEPTH, 2, 10);
for (let k = 0; k <= 4; k++) islandPts.push([obs.pos.x, obs.pos.y + (obs.height * k) / 4, obs.pos.z]);
const harbourPts = [];
disc(harbourPts, H, HARBOUR_DEPTH, 4, 20, 40);
const hall = PLACES.find((p) => p.id === "a8");
harbourPts.push([hall.pos.x, hall.pos.y + hall.height, hall.pos.z]);

const CL = WORLD.cloudClear;
const inCloudAt = (x, z) => Math.hypot(x - CL.x, z - CL.z) > CL.r;
/** 0 = clear, 1 = terrain, 2 = cloud layer (only if terrain did not block), 3 = another island. */
function rayBlock(o, p, isles = false) {
  const dx = p[0] - o.x;
  const dy = p[1] - o.y;
  const dz = p[2] - o.z;
  const len = Math.hypot(dx, dy, dz);
  const steps = Math.ceil(len / 12);
  let cloud = false;
  let prevY = o.y;
  for (let k = 2; k < steps - 2; k++) {
    const u = k / steps;
    const x = o.x + dx * u;
    const y = o.y + dy * u;
    const z = o.z + dz * u;
    if (terrainHeight(x, z) > y) return 1;
    if (isles && inIsle(x, y, z)) return 3;
    if ((prevY - WORLD.cloudLevel) * (y - WORLD.cloudLevel) <= 0 && inCloudAt(x, z)) cloud = true;
    prevY = y;
  }
  return cloud ? 2 : 0;
}
function camOf(p, q, aspect = ASPECT) {
  const cam = new THREE.PerspectiveCamera(FOV, aspect, 1, 30000);
  cam.position.copy(p);
  cam.lookAt(q);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}
const _v = new THREE.Vector3();
const proj = (cam, x, y, z) => _v.set(x, y, z).project(cam);
const inFrame = (cam, x, y, z) => {
  const v = proj(cam, x, y, z);
  return v.z < 1 && v.z > -1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
};

// ── Clearance ────────────────────────────────────────────────────────────────
/** Horizontal distance from (x, y, z) to the nearest ground that is higher than y. */
function cliffDistance(x, y, z, maxR = 80) {
  for (let r = 2; r <= maxR; r += 2) {
    for (let a = 0; a < 48; a++) {
      const th = (a / 48) * Math.PI * 2;
      if (terrainHeight(x + Math.cos(th) * r, z + Math.sin(th) * r) > y) return r;
    }
  }
  return Infinity;
}
{
  const worst = {};
  const note = (k, v, d, extra = {}) => {
    if (!worst[k] || v < worst[k].v) worst[k] = { v: r1(v), s: Math.round(d.s), p: d.p.toArray().map(Math.round), ...extra };
  };
  const bA = L.BRIDGE.a;
  const bB = L.BRIDGE.b;
  const bLen2 = (bB[0] - bA[0]) ** 2 + (bB[2] - bA[2]) ** 2;
  let bridgeEyeErr = 0;
  let bridgeSide = 0;
  for (const d of dense) {
    const { x, y, z } = d.p;
    if (d.kind === "dive") {
      const c = cliffDistance(x, y, z);
      note("dive", Math.min(c, y - terrainHeight(x, z) < 0 ? -1 : Infinity), d);
    } else if (d.kind === "bridge") {
      const u = ((x - bA[0]) * (bB[0] - bA[0]) + (z - bA[2]) * (bB[2] - bA[2])) / bLen2;
      const side = Math.abs((x - bA[0]) * (bB[2] - bA[2]) - (z - bA[2]) * (bB[0] - bA[0])) / Math.sqrt(bLen2);
      bridgeSide = Math.max(bridgeSide, side);
      if (u >= 0 && u <= 1) bridgeEyeErr = Math.max(bridgeEyeErr, Math.abs(y - L.bridgeDeckAt(u) - L.BRIDGE_EYE));
    } else if (L.UNDERGROUND.includes(d.kind)) {
      // Underground by design: checked in the mine section below.
    } else if (d.kind === "flight") {
      note("flight", y - terrainHeight(x, z), d);
    } else if (d.kind === "board") {
      note("board", y - groundAt(x, z), d);
    } else {
      note("walk", y - groundAt(x, z), d, { kind: d.kind });
    }
  }
  report.clearance = worst;
  const keys = TRAIL.map((p, i) => ({ i, kind: TRAIL_KIND[i], above: Math.round(p[1] - groundAt(p[0], p[2])) }));
  const badKeys = keys.filter((k) => ["walk", "climb", "rise", "sky"].includes(k.kind) && k.above < 35);
  check("key clearance >= 35 (walk, climb, rise, sky keys; islands count as ground)", badKeys.length === 0, badKeys.length ? badKeys : "ok");
  check("route clearance >= 35 (dense: walk, climb, rise, sky)", worst.walk.v >= 35, worst.walk);
  check("dive stays >= 15 from any rock (dense)", worst.dive.v >= 15, worst.dive);
  check("bridge: camera on the deck's centreline, BRIDGE_EYE over the deck (+/-3)", bridgeEyeErr <= 3 && bridgeSide <= 2, `eye error ${r1(bridgeEyeErr)}, off centreline ${r1(bridgeSide)}`);
  check("boarding: >= 8 over the isle or deck", worst.board.v >= 8, worst.board);
  check("flight: >= 200 over the ground", worst.flight.v >= 200, worst.flight);
  report.keyClearance = keys;
}

// ── N1: the walk up the valley looks at the valley, not at the slope ─────────
/** Share of a coarse ray grid that hits ground nearer than `near`; with
 *  `skip(x, y, z)`, hits it accepts are not counted. */
function nearGroundShare(p, q, near = 600, rowsN = 18, colsN = 32, skip = null) {
  const f = q.clone().sub(p).normalize();
  const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
  const u = new THREE.Vector3().crossVectors(r, f);
  const th = Math.tan(((FOV / 2) * Math.PI) / 180);
  let hit = 0;
  let n = 0;
  for (let j = 0; j < rowsN; j++) {
    for (let i = 0; i < colsN; i++) {
      const d = f.clone().addScaledVector(r, ((2 * (i + 0.5)) / colsN - 1) * th * ASPECT).addScaledVector(u, (1 - (2 * (j + 0.5)) / rowsN) * th).normalize();
      n++;
      for (let t = 4; t <= near; t += 6) {
        const hx = p.x + d.x * t;
        const hy = p.y + d.y * t;
        const hz = p.z + d.z * t;
        if (hy <= terrainHeight(hx, hz)) {
          if (!skip || !skip(hx, hy, hz)) hit++;
          break;
        }
      }
    }
  }
  return hit / n;
}
{
  // The walk keys, a1 to the last one before the rim; then the rim key (the
  // dive's first), which is meant to be filled by the falls on their cliff
  // (N2), so there the cliff north of the gorge's centre is not counted.
  const rimKey = L.DIVE_KEYS.first;
  const rows = [];
  for (let i = PLACES[0].trail; i < rimKey; i++) rows.push({ key: i, share: Math.round(100 * nearGroundShare(v3(TRAIL[i]), v3(LOOK[i]))) });
  const fallsWall = (x, y, z) => z < WORLD.falls.bottom[2] + 40;
  const rimAll = Math.round(100 * nearGroundShare(v3(TRAIL[rimKey]), v3(LOOK[rimKey])));
  const rimOther = Math.round(100 * nearGroundShare(v3(TRAIL[rimKey]), v3(LOOK[rimKey]), 600, 18, 32, fallsWall));
  report.nearGround = { walk: rows, rim: { key: rimKey, all: rimAll, notFallsWall: rimOther } };
  console.log(`\nN1 near ground (< 600 away) share of frame, walk keys a1..rim-1: ${rows.map((r) => `${r.key}:${r.share}%`).join(" ")}; rim key ${rimKey}: ${rimAll}% (${rimOther}% not the falls' cliff)`);
  const worst = rows.reduce((a, b) => (b.share > a.share ? b : a));
  check("N1: shore -> camp -> rim, near ground <= 45% of every walk key's frame", worst.share <= 45, `worst key ${worst.key} at ${worst.share}%`);
  check("N1: at the rim, near ground other than the falls' cliff <= 45% of the frame", rimOther <= 45, `${rimOther}% (all near ground ${rimAll}%, the rest is the cliff the falls pour down)`);
}

// ── N2: the dive ─────────────────────────────────────────────────────────────
{
  const F = WORLD.falls;
  const sFrom = rail.stopS[1] + 0.001; // pitch rate: the whole stretch a2 -> a3
  const s0 = sAtKey(L.DIVE_KEYS.first); // the rim
  const s1 = sAtKey(L.DIVE_KEYS.last); // the pool (grey pass 3: a3 is in the cave beyond it)
  // Curtain in the middle 60% of the width, rim to pool, on the rail's own pose.
  let worstX = 0;
  let minIn = Infinity;
  let fill = 0;
  for (let s = s0; s <= s1; s += 4) {
    rail.sampleS(s, pose);
    const cam = camOf(pose.position, pose.target);
    let nIn = 0;
    for (let y = F.bottom[1] + 4; y <= F.top[1]; y += 8) {
      const [cx, cz] = L.fallsCurtainAt(y);
      const v = proj(cam, cx, y, cz);
      if (v.z >= 1 || Math.abs(v.y) > 1) continue;
      nIn++;
      worstX = Math.max(worstX, Math.abs(v.x));
      const a = proj(cam, cx - F.width / 2, y, cz).x;
      const b = proj(cam, cx + F.width / 2, y, cz).x;
      fill = Math.max(fill, Math.abs(b - a) / 2);
    }
    minIn = Math.min(minIn, nIn);
  }
  check("N2: the curtain stays in the middle 60% of the frame width, rim to pool", worstX <= 0.6 && minIn > 0, `max |x| ${worstX.toFixed(2)} (0.6 = edge of the middle 60%), curtain rows in frame >= ${minIn}, widest ${Math.round(fill * 100)}% of the frame`);
  // Pitch rate against scroll at the default pacing.
  let maxRate = 0;
  let maxAt = 0;
  let peak = -Infinity;
  let peakS = 0;
  let s10 = null;
  const ds = 3;
  for (let s = sFrom; s <= s1 + 200; s += ds) {
    const p0 = rail.pitchAtS(s);
    const p1 = rail.pitchAtS(s + ds);
    const dv = vhAt(rail, s + ds) - vhAt(rail, s);
    const rate = Math.abs(p1 - p0) / Math.max(1e-6, dv);
    if (rate > maxRate) {
      maxRate = rate;
      maxAt = s;
    }
    if (s >= s0 - 50 && s <= s1 && p0 > peak) {
      peak = p0;
      peakS = s;
    }
  }
  for (let s = s0 - 200; s <= peakS; s += 2) if (s10 === null && rail.pitchAtS(s) >= 10) s10 = s;
  const tipVh = s10 === null ? 0 : vhAt(rail, peakS) - vhAt(rail, s10);
  const diveVh = vhAt(rail, s1) - vhAt(rail, s0);
  report.dive = { peakPitch: r1(peak), tipVh: r1(tipVh), diveVh: r1(diveVh), maxRate: +maxRate.toFixed(2), maxRateAt: Math.round(maxAt) };
  check("N2: pitch changes <= 1.2 deg per vh (camp -> pool, default pacing)", maxRate <= 1.2, `max ${maxRate.toFixed(2)} deg/vh at s ${Math.round(maxAt)}; peak ${r1(peak)} deg`);
  check("N2: the tip (pitch 10 -> peak) takes >= 40 vh", tipVh >= 40, `${r1(tipVh)} vh; rim to pool ${r1(diveVh)} vh`);
  // (Pass 2's "after the pool, no long bare-rock pan" check is gone with the
  // gorge: after the pool the camera goes through the curtain into the cave.)
  // Whole route: the fastest pitch change anywhere (reported).
  let routeRate = 0;
  let routeAt = 0;
  for (let s = 0; s < rail.length - ds; s += ds) {
    const dv = vhAt(rail, s + ds) - vhAt(rail, s);
    const rate = Math.abs(rail.pitchAtS(s + ds) - rail.pitchAtS(s)) / Math.max(1e-6, dv);
    if (rate > routeRate) {
      routeRate = rate;
      routeAt = s;
    }
  }
  report.routePitchRate = { max: +routeRate.toFixed(2), at: Math.round(routeAt), kind: rail.kindAtS(routeAt) };
  console.log(`dive: peak ${r1(peak)} deg, tip ${r1(tipVh)} vh, rim->pool ${r1(diveVh)} vh; fastest pitch change on the whole route ${routeRate.toFixed(2)} deg/vh at s ${Math.round(routeAt)} (${rail.kindAtS(routeAt)})`);
}

// ── The mine (grey pass 3): the cave, the tunnel, the shaft ─────────────────
{
  const C = L.CAVE;
  const S = L.SHAFT;
  const F = WORLD.falls;
  // 1. Inside a void, or in open air.
  let inMin = { v: Infinity };
  const bad = [];
  let nMine = 0;
  for (const d of dense) {
    if (!L.UNDERGROUND.includes(d.kind)) continue;
    nMine++;
    const { x, y, z } = d.p;
    const m = L.mineMargin(x, y, z);
    if (m >= 3) {
      if (m < inMin.v) inMin = { v: r1(m), s: Math.round(d.s), kind: d.kind, p: d.p.toArray().map(Math.round) };
      continue;
    }
    const open = y > terrainHeight(x, z) && y - groundAt(x, z) >= 15 && cliffDistance(x, y, z, 10) > 8;
    if (!open) bad.push({ s: Math.round(d.s), kind: d.kind, margin: r1(m), p: d.p.toArray().map(Math.round) });
  }
  check("mine: every cave, tunnel and shaft sample is inside a void (>= 3 from its walls) or in open air (>= 15 up, >= 8 from rock)", bad.length === 0 && nMine > 100, bad.length ? `${bad.length} bad, first ${JSON.stringify(bad.slice(0, 3))}` : `${nMine} samples; closest to a wall ${JSON.stringify(inMin)}`);

  // 2. Rock cover over the hall and the tunnel, except the mouth.
  let coverMin = { v: Infinity };
  const hallTop = (r) => C.floorY + Math.max(C.mouthH, C.hallH * Math.sqrt(Math.max(0, 1 - r * r)));
  for (let x = C.hallX - C.rx; x <= C.hallX + C.rx; x += 4) {
    for (let z = C.hallZ - C.rz; z <= C.hallZ + C.rz; z += 4) {
      const r = Math.hypot((x - C.hallX) / C.rx, (z - C.hallZ) / C.rz);
      if (r > 1) continue;
      if (Math.abs(x - C.x) < C.mouthHalfW + 8 && z > C.footZ - 16) continue; // the mouth
      const v = terrainHeight(x, z) - hallTop(r);
      if (v < coverMin.v) coverMin = { v: r1(v), where: "hall", p: [x, z].map(Math.round) };
    }
  }
  const T = L.TUNNEL;
  for (let i = 0; i < T.length - 1; i++) {
    const a = T[i];
    const b = T[i + 1];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const nx = -(b[2] - a[2]) / len;
    const nz = (b[0] - a[0]) / len;
    for (let u = 0; u <= 1; u += 4 / len) {
      for (const w of [-1, 0, 1]) {
        const x = a[0] + (b[0] - a[0]) * u + nx * w * L.TUNNEL_HALF_W;
        const z = a[2] + (b[2] - a[2]) * u + nz * w * L.TUNNEL_HALF_W;
        const v = terrainHeight(x, z) - (a[1] + (b[1] - a[1]) * u + L.TUNNEL_H);
        if (v < coverMin.v) coverMin = { v: r1(v), where: `tunnel ${i}`, p: [x, z].map(Math.round) };
      }
    }
  }
  // The tunnel's walls stay >= 40 from open air on the gorge side too.
  let sideMin = { v: Infinity };
  for (let i = 0; i < T.length - 1; i++) {
    const a = T[i];
    const b = T[i + 1];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    for (let u = 0; u <= 1; u += 20 / len) {
      const x = a[0] + (b[0] - a[0]) * u;
      const z = a[2] + (b[2] - a[2]) * u;
      const roof = a[1] + (b[1] - a[1]) * u + L.TUNNEL_H;
      const c = cliffDistance(x, roof, z, 120);
      // cliffDistance finds ground ABOVE the roof; open air is where it is lower.
      let air = Infinity;
      for (let r = L.TUNNEL_HALF_W; r <= 120 && air === Infinity; r += 4) {
        for (let k = 0; k < 24; k++) {
          const th = (k / 24) * Math.PI * 2;
          if (terrainHeight(x + Math.cos(th) * r, z + Math.sin(th) * r) < roof) {
            air = r;
            break;
          }
        }
      }
      if (air - L.TUNNEL_HALF_W < sideMin.v) sideMin = { v: air - L.TUNNEL_HALF_W, p: [x, z].map(Math.round), c };
    }
  }
  check(`mine: the terrain stays >= ${L.MINE_COVER} above the hall and the tunnel everywhere but the mouth`, coverMin.v >= L.MINE_COVER, coverMin);
  check("mine: the tunnel's walls are >= 40 of rock from open air", sideMin.v >= 40, sideMin.v === Infinity ? "none within 120" : sideMin);

  // 3. The portals. The mouth: behind the curtain across its whole height,
  //    and the curtain wider than the arch.
  let hidden = true;
  for (let y = C.floorY; y <= C.floorY + C.mouthH; y += 4) {
    const [, cz] = L.fallsCurtainAt(y);
    const face = C.footZ - (y - C.floorY) / 9;
    if (!(cz > face + 3)) hidden = false;
  }
  check("mine: the mouth is behind the curtain (curtain >= 3 in front of it, wider by >= 5 each side)", hidden && F.width / 2 >= C.mouthHalfW + 5, `curtain half width ${F.width / 2}, arch ${C.mouthHalfW}`);
  // The camera goes through the curtain and the arch with room.
  let curtainX = null;
  let archAt = null;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1].p;
    const b = dense[i].p;
    const [, czA] = L.fallsCurtainAt(a.y);
    const [, czB] = L.fallsCurtainAt(b.y);
    if (curtainX === null && a.z > czA && b.z <= czB && Math.abs(b.x - F.top[0]) < F.width) curtainX = { x: r1(b.x - F.top[0]), y: r1(b.y), s: Math.round(dense[i].s) };
    const fA = C.footZ - (a.y - C.floorY) / 9;
    const fB = C.footZ - (b.y - C.floorY) / 9;
    if (archAt === null && a.z > fA && b.z <= fB && Math.abs(b.x - C.x) < 60) archAt = { side: r1(C.mouthHalfW - Math.abs(b.x - C.x)), sill: r1(b.y - C.floorY), head: r1(C.floorY + C.mouthH - b.y), s: Math.round(dense[i].s) };
  }
  check("mine: the camera goes through the curtain within its width (>= 15 from its edges)", curtainX !== null && Math.abs(curtainX.x) <= F.width / 2 - 15, curtainX);
  check("mine: the camera goes through the arch with >= 10 each side and >= 10 under its head", archAt !== null && archAt.side >= 10 && archAt.head >= 10 && archAt.sill >= 10, archAt);
  // The shaft: out through its collar cell, levelling.
  let collar = null;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1].p;
    const b = dense[i].p;
    if (a.y < S.topY && b.y >= S.topY && Math.abs(b.x - S.x) < 60 && Math.abs(b.z - S.z) < 60) {
      collar = { margin: r1(Math.min(b.x - S.x0, S.x1 - b.x, b.z - S.z0, S.z1 - b.z)), s: dense[i].s };
      break;
    }
  }
  const collarPitch = collar ? rail.pitchAtS(collar.s) : NaN;
  let lookUp = 0;
  for (let s = sAtKey(L.SHAFT_KEYS.first); s <= sAtKey(L.SHAFT_KEYS.last); s += 4) lookUp = Math.min(lookUp, rail.pitchAtS(s));
  check("mine: the ride looks up the shaft (<= -40) and levels (|pitch| <= 8) as it clears the collar, inside the cell (>= 5 from its edges)", collar && collar.margin >= 5 && Math.abs(collarPitch) <= 8 && lookUp <= -40, `${JSON.stringify(collar)}; pitch at the collar ${r1(collarPitch)}; steepest up ${r1(lookUp)}`);
  // The shaft is one main-grid cell (scene.ts cuts exactly it out) on flat ground.
  const Wd = WORLD.maxX - WORLD.minX;
  const Dd = WORLD.maxZ - WORLD.minZ;
  const cell = Math.max(Wd, Dd) / 320;
  const gsx = Wd / Math.round(Wd / cell);
  const gsz = Dd / Math.round(Dd / cell);
  const onGrid = (v, o, st) => Math.abs((v - o) / st - Math.round((v - o) / st)) < 1e-3;
  const flat = Math.max(...[-1, 0, 1, 2].flatMap((i) => [-1, 0, 1, 2].map((j) => Math.abs(terrainHeight(S.x0 + i * gsx, S.z0 + j * gsz) - S.topY))));
  check("mine: the shaft is exactly one terrain grid cell, the ground round its collar flat at topY (+/-6)", onGrid(S.x0, WORLD.minX, gsx) && onGrid(S.x1, WORLD.minX, gsx) && onGrid(S.z0, WORLD.minZ, gsz) && onGrid(S.z1, WORLD.minZ, gsz) && Math.abs(S.x1 - S.x0 - gsx) < 0.01 && flat <= 6, `cell ${r1(S.x1 - S.x0)} x ${r1(S.z1 - S.z0)} (grid ${gsx.toFixed(3)} x ${gsz.toFixed(3)}), ground off topY by <= ${r1(flat)}`);
  // 4. The stops. a3: the mouth fully in frame from inside; a4: the cage.
  const camAt = (i) => camOf(v3(TRAIL[PLACES[i].trail]), v3(LOOK[PLACES[i].trail]));
  const inF = (cam, x, y, z) => {
    const v = proj(cam, x, y, z);
    return v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
  };
  const c3 = camAt(2);
  const mouthPts = [[-1, 0], [1, 0], [-1, 1], [1, 1], [0, 1]].map(([sx, sy]) => [C.x + sx * C.mouthHalfW, C.floorY + sy * C.mouthH, C.footZ - (sy * C.mouthH) / 9]);
  const a3In = mouthPts.filter((q) => inF(c3, ...q)).length;
  const a3Stop = TRAIL[PLACES[2].trail];
  check("a3 stop: inside the hall, the whole mouth in frame (the curtain from inside)", L.mineMargin(...a3Stop) >= 10 && a3In === mouthPts.length, `margin ${r1(L.mineMargin(...a3Stop))}, ${a3In}/${mouthPts.length} mouth corners in frame`);
  const c4 = camAt(3);
  const cage = [[-1, 0, -1], [1, 0, 1], [-1, 1, 1], [1, 1, -1]].map(([a, b, c]) => [S.x + (a * L.LIFT.size) / 2, S.floorY + b * L.LIFT.height, S.z + (c * L.LIFT.size) / 2]);
  const a4In = cage.filter((q) => inF(c4, ...q)).length;
  const a4Stop = TRAIL[PLACES[3].trail];
  check("a4 stop: in the tunnel, the lift's cage whole in frame", L.mineMargin(...a4Stop) >= 5 && a4In === cage.length && PLACES[3].mesh === "LM_MineLift", `margin ${r1(L.mineMargin(...a4Stop))}, ${a4In}/${cage.length} cage corners in frame, ${PLACES[3].mesh}`);
  // 5. The tunnel is quick; the flight is long.
  const tunVh = vhAt(rail, sAtKey(L.TUNNEL_KEYS.last)) - vhAt(rail, sAtKey(L.TUNNEL_KEYS.first));
  const tunLen = sAtKey(L.TUNNEL_KEYS.last) - sAtKey(L.TUNNEL_KEYS.first);
  const rideVh = vhAt(rail, sAtKey(L.SHAFT_KEYS.last)) - vhAt(rail, sAtKey(L.SHAFT_KEYS.first));
  const caveVh = vhAt(rail, rail.stopS[2]) - vhAt(rail, sAtKey(L.CAVE_KEYS.first));
  report.mine = { caveVh: r1(caveVh), tunnelVh: r1(tunVh), tunnelUnits: Math.round(tunLen), rideVh: r1(rideVh) };
  console.log(`mine: curtain -> a3 ${r1(caveVh)} vh; tunnel ${Math.round(tunLen)} units in ${r1(tunVh)} vh; the lift ride ${r1(rideVh)} vh`);
  check("mine: the tunnel is short to scroll (<= 130 vh at the default pacing)", tunVh <= 130, `${r1(tunVh)} vh for ${Math.round(tunLen)} units`);
  const [f0, f1] = rail.flightS;
  const flightVh = vhAt(rail, f1) - vhAt(rail, f0);
  check("the flight takes 200-300 vh (2-3 screens) at the default pacing, its own budget", flightVh >= 200 && flightVh <= 300 && Math.abs(flightVh - L.FLIGHT_VH) < 0.5, `${r1(flightVh)} vh (FLIGHT_VH ${L.FLIGHT_VH})`);
}

// ── The star look and the Great Tree (grey pass 3) ──────────────────────────
{
  // The star look (layout STAR_KEY): the observatory's dome and telescope
  // sit in the lower part of the frame.
  const a7 = PLACES[6];
  const best = { k: L.STAR_KEY, pitch: L.TRAIL_VIEW[L.STAR_KEY].pitch };
  const cam = camOf(v3(TRAIL[best.k]), v3(LOOK[best.k]));
  // The dome's top as blocks.ts builds it (pos.y + 75.5; PLACES' height,
  // 110, is a rough figure for markers), and the telescope's tip (58 long
  // from a pivot 58 up, 42 degrees up toward bearing 218).
  const DOME_TOP = 75.5;
  const tb = (218 * Math.PI) / 180;
  const tel = [a7.pos.x + Math.sin(tb) * Math.cos(0.733) * 58, a7.pos.y + 58 + Math.sin(0.733) * 58, a7.pos.z - Math.cos(tb) * Math.cos(0.733) * 58];
  const top = proj(cam, a7.pos.x, a7.pos.y + DOME_TOP, a7.pos.z).clone();
  const tipP = proj(cam, ...tel).clone();
  const inLower = (v) => v.z < 1 && Math.abs(v.x) <= 1 && v.y >= -1 && v.y <= -0.2;
  check("star look: looking up (<= -15) with the observatory's dome top and telescope tip in the lower part of the frame (y -1..-0.2)", best.pitch <= -15 && inLower(top) && inLower(tipP), `key ${best.k} pitch ${best.pitch}; dome top x ${top.x.toFixed(2)} y ${top.y.toFixed(2)}, telescope tip x ${tipP.x.toFixed(2)} y ${tipP.y.toFixed(2)}`);
  // The Great Tree: base and top in frame at a6, the top not hidden by terrain.
  const a6 = PLACES[5];
  const c6 = camOf(v3(TRAIL[a6.trail]), v3(LOOK[a6.trail]));
  const base = proj(c6, a6.pos.x, a6.pos.y, a6.pos.z).clone();
  const tip = proj(c6, a6.pos.x, a6.pos.y + L.GREAT_TREE.height, a6.pos.z).clone();
  const side = [-1, 1].map((k) => proj(c6, a6.pos.x + k * L.GREAT_TREE.crownR * 0.8, a6.pos.y + L.GREAT_TREE.height * 0.8, a6.pos.z).clone());
  const ok = [base, tip, ...side].every((v) => v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1);
  check(`a6: the Great Tree (${L.GREAT_TREE.height} tall, ~2x the forest) whole in frame, base to crown`, ok, `base y ${base.y.toFixed(2)}, top y ${tip.y.toFixed(2)}, crown x ${side.map((v) => v.x.toFixed(2)).join("/")}`);
}

// ── N6: the steps line up from behind the first step ─────────────────────────
{
  const k0 = TRAIL_KIND.indexOf("rise");
  const cam = camOf(v3(TRAIL[k0]), v3(LOOK[k0]));
  const pts = STEPS.map((st, k) => ({ k, v: proj(cam, st[0], st[1], st[2]).clone() })).filter((o) => o.v.z < 1 && Math.abs(o.v.x) <= 1 && Math.abs(o.v.y) <= 1);
  const xs = pts.map((o) => o.v.x);
  const spread = xs.length ? Math.max(...xs) - Math.min(...xs) : Infinity;
  let rising = true;
  for (let i = 1; i < pts.length; i++) if (pts[i].v.y <= pts[i - 1].v.y) rising = false;
  report.steps = { inFrame: pts.length, of: STEPS.length, xSpread: +spread.toFixed(3), first: pts[0]?.k, last: pts[pts.length - 1]?.k };
  check("N6: from behind the first step, >= 8 step centres in frame, in one line up the middle (x spread <= 0.1), rising", pts.length >= 8 && spread <= 0.1 && rising && Math.abs(xs[0]) < 0.1, `${pts.length}/${STEPS.length} in frame (steps ${pts[0]?.k}-${pts[pts.length - 1]?.k}), x spread ${spread.toFixed(3)}, rising ${rising}`);
}

// ── Sky Island sight lines ───────────────────────────────────────────────────
{
  console.log("");
  const rows = [];
  for (const pl of PLACES.slice(0, 4)) {
    const o = v3(TRAIL[pl.trail]);
    let terrain = 0;
    let cloud = 0;
    for (const p of islandPts) {
      const b = rayBlock(o, p);
      if (b === 1) terrain++;
      else if (b === 2) cloud++;
    }
    const n = islandPts.length;
    rows.push({ id: pl.id, terrainPct: +((100 * terrain) / n).toFixed(1), terrainOrCloudPct: +((100 * (terrain + cloud)) / n).toFixed(1) });
  }
  report.sightLines = rows;
  for (const r of rows) console.log(`sight ${r.id}: blocked by terrain ${r.terrainPct}%, by terrain or cloud ${r.terrainOrCloudPct}%`);
  check("Sky Island hidden from stops 1-4 by terrain alone (100%)", rows.every((r) => r.terrainPct === 100), rows.map((r) => `${r.id} ${r.terrainPct}%`).join(", "));

  const s5 = sAtKey(PLACES[4].trail);
  let first = null;
  for (let i = 0; i < dense.length && dense[i].s <= sAtKey(PLACES[5].trail); i += 4) {
    const d = dense[i];
    const cam = camOf(d.p, d.q);
    for (const p of islandPts) {
      if (!inFrame(cam, p[0], p[1], p[2])) continue;
      if (rayBlock(d.p, p) === 0) {
        first = { s: Math.round(d.s), sFromStop5: Math.round(d.s - s5), p: d.p.toArray().map(Math.round) };
        break;
      }
    }
    if (first) break;
  }
  report.firstDirectSight = first;
  check("Sky Island first seen directly only after stop 5", first !== null && first.s > s5, first ?? "never in view up to a6");
}

// ── Stop 5: the reflection ───────────────────────────────────────────────────
{
  const pl = PLACES[4];
  const o = v3(TRAIL[pl.trail]);
  const q = v3(LOOK[pl.trail]);
  const Lk = WORLD.lake;
  const res = {};
  const main = islandPts.slice(0, mainIslandCount);
  for (const [name, aspect] of [["16:9", 16 / 9], ["16:10", 16 / 10], ["21:9", 21 / 9]]) {
    const cam = camOf(o, q, aspect);
    let inF = 0;
    let clearPath = 0;
    let direct = 0;
    const ys = [];
    for (const p of main) {
      const my = 2 * Lk.y - p[1];
      if (inFrame(cam, p[0], p[1], p[2])) direct++;
      if (!inFrame(cam, p[0], my, p[2])) continue;
      inF++;
      ys.push((1 - proj(cam, p[0], my, p[2]).y) / 2);
      const u = (o.y - Lk.y) / (o.y - my);
      const hx = o.x + (p[0] - o.x) * u;
      const hz = o.z + (p[2] - o.z) * u;
      if (Math.hypot(hx - Lk.x, hz - Lk.z) >= Lk.r) continue;
      const hit = new THREE.Vector3(hx, Lk.y + 0.5, hz);
      if (rayBlock(o, [hx, Lk.y + 0.5, hz]) === 0 && rayBlock(hit, p) !== 1) clearPath++;
    }
    const n = main.length;
    res[name] = {
      mirrorInFramePct: +((100 * inF) / n).toFixed(1),
      reflectionVisiblePct: +((100 * clearPath) / n).toFixed(1),
      directInFramePct: +((100 * direct) / n).toFixed(1),
      reflectionFrameBand: ys.length ? [+Math.min(...ys).toFixed(2), +Math.max(...ys).toFixed(2)] : null,
    };
  }
  report.reflection = res;
  console.log("\nstop 5 reflection:", JSON.stringify(res));
  check("stop 5: island's mirror image fully in frame (16:9)", res["16:9"].mirrorInFramePct === 100, res["16:9"]);
  check("stop 5: reflection lands on the lake with a clear path (16:9, >= 90%)", res["16:9"].reflectionVisiblePct >= 90, `${res["16:9"].reflectionVisiblePct}%`);
  check("stop 5: the island itself is above the frame (0% in frame)", res["16:9"].directInFramePct === 0, `${res["16:9"].directInFramePct}%`);
}

// ── N9: the flight and the Harbour Isle ──────────────────────────────────────
{
  const f0 = sAtKey(L.FLIGHT_KEYS.first);
  const f1 = sAtKey(L.FLIGHT_KEYS.last);
  check("N9: the flight is 1,500-2,500 units (moored deck to docked deck)", f1 - f0 >= 1500 && f1 - f0 <= 2500, `${Math.round(f1 - f0)} units; straight line ${Math.round(Math.hypot(TRAIL[L.FLIGHT_KEYS.last][0] - TRAIL[L.FLIGHT_KEYS.first][0], TRAIL[L.FLIGHT_KEYS.last][2] - TRAIL[L.FLIGHT_KEYS.first][2]))}`);
  // The ship's deck: the flight's first and last keys stand on the moored and docked ships.
  const m = L.shipCamera(L.SHIP_MOORED);
  const dk = L.shipCamera(L.SHIP_DOCKED);
  const e0 = Math.hypot(m[0] - TRAIL[L.FLIGHT_KEYS.first][0], m[1] - TRAIL[L.FLIGHT_KEYS.first][1], m[2] - TRAIL[L.FLIGHT_KEYS.first][2]);
  const e1 = Math.hypot(dk[0] - TRAIL[L.FLIGHT_KEYS.last][0], dk[1] - TRAIL[L.FLIGHT_KEYS.last][1], dk[2] - TRAIL[L.FLIGHT_KEYS.last][2]);
  // Direction of travel at the two ends vs the ship's heading.
  const headAt = (s) => {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    rail.sampleS(s - 3, pose);
    a.copy(pose.position);
    rail.sampleS(s + 3, pose);
    b.copy(pose.position);
    return ((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI + 360) % 360;
  };
  const rs0 = rail.stopS[6] + (f0 - sAtKey(PLACES[6].trail));
  const h0 = headAt(sAtKey(L.FLIGHT_KEYS.first) + 20);
  const h1 = headAt(sAtKey(L.FLIGHT_KEYS.last) - 20);
  const dh = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  check("N9: the camera boards the moored ship and leaves the docked one on their decks, along their headings (+/-12 deg)", e0 < 1 && e1 < 1 && dh(h0, L.SHIP_MOORED.heading) <= 12 && dh(h1, L.SHIP_DOCKED.heading) <= 12, `deck error ${r1(e0)} / ${r1(e1)}; travel ${Math.round(h0)} vs ${L.SHIP_MOORED.heading}, ${Math.round(h1)} vs ${L.SHIP_DOCKED.heading}`);
  void rs0;
  // Harbour hidden before the flight: projected box of the visible harbour points.
  let worst = { pct: 0 };
  let firstSeen = null;
  const tF = L.FLIGHT_KEYS.first / (nK - 1);
  for (let i = 0; i < dense.length; i += 3) {
    const d = dense[i];
    const cam = camOf(d.p, d.q);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let any = false;
    for (const p of harbourPts) {
      const v = proj(cam, p[0], p[1], p[2]);
      if (!(v.z < 1 && Math.abs(v.x) <= 1.3 && Math.abs(v.y) <= 1.3)) continue;
      if (rayBlock(d.p, p, true) !== 0) continue;
      any = true;
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
    }
    if (!any) continue;
    const cx = Math.max(0, Math.min(1, x1) - Math.max(-1, x0));
    const cy = Math.max(0, Math.min(1, y1) - Math.max(-1, y0));
    const pct = (100 * cx * cy) / 4;
    if (pct <= 0) continue;
    if (d.t < tF) {
      if (pct > worst.pct) worst = { pct: +pct.toFixed(2), s: Math.round(d.s), kind: d.kind, p: d.p.toArray().map(Math.round) };
    } else if (!firstSeen && pct > 0.2) firstSeen = { s: Math.round(d.s), intoFlight: Math.round(d.s - f0), pct: +pct.toFixed(2) };
  }
  report.harbour = { worstBeforeFlight: worst, firstSeenInFlight: firstSeen };
  check("N9: Harbour Isle < 1% of the frame everywhere before the flight begins", worst.pct < 1, worst.pct ? worst : "never in view");
  console.log(`harbour first seen in the flight: ${JSON.stringify(firstSeen)}`);
}

// ── Ground facts ─────────────────────────────────────────────────────────────
{
  const camp = PLACES[1].pos.y;
  let floorMax = -Infinity;
  const Pl = WORLD.pool;
  for (let a = 0; a < 24; a++) {
    for (const r of [0, 60, 120, 180]) {
      const x = Pl.x + 60 + Math.cos((a / 24) * Math.PI * 2) * r;
      const z = Pl.z + 110 + Math.sin((a / 24) * Math.PI * 2) * r * 0.5;
      floorMax = Math.max(floorMax, terrainHeight(x, z));
    }
  }
  const F = WORLD.falls;
  check("ravine floor (pool area) below Base Camp", floorMax < camp - 60, `floor max ${floorMax.toFixed(0)} vs camp ${camp}; pool water ${Pl.y}; lip ${F.top[1]}; drop ${Math.round(F.top[1] - F.bottom[1])}`);

  const Lk = WORLD.lake;
  let ringDev = 0;
  let innerMax = -Infinity;
  for (let a = 0; a < 180; a++) {
    const th = (a / 180) * Math.PI * 2;
    ringDev = Math.max(ringDev, Math.abs(terrainHeight(Lk.x + Math.cos(th) * Lk.r, Lk.z + Math.sin(th) * Lk.r) - Lk.y));
    for (const k of [0, 0.3, 0.6, 0.9, 0.97]) innerMax = Math.max(innerMax, terrainHeight(Lk.x + Math.cos(th) * Lk.r * k, Lk.z + Math.sin(th) * Lk.r * k));
  }
  check("lake shoreline level within +/-2 on its radius", ringDev <= 2, `max deviation ${ringDev.toFixed(2)}`);
  check("lake bed below the water everywhere inside 0.97r", innerMax < Lk.y, `max bed ${innerMax.toFixed(1)} vs water ${Lk.y}`);

  // The lip: 6 upstream of the falls' top (against the flow).
  const fb = (F.flow * Math.PI) / 180;
  const lipG = terrainHeight(F.top[0] - Math.sin(fb) * 6, F.top[2] + Math.cos(fb) * 6);
  check("falls lip terrain matches falls.top (+/-15)", Math.abs(lipG - F.top[1]) <= 15, `ground ${lipG.toFixed(0)} at lip, falls.top y ${F.top[1]}`);
  // The curtain stays in front of the cliff: every 10 down, the rock 4 behind the curtain is below... the curtain is in open air.
  let inRock = 0;
  for (let y = F.bottom[1] + 6; y < F.top[1] - 4; y += 10) {
    const [cx, cz] = L.fallsCurtainAt(y);
    if (terrainHeight(cx, cz) > y) inRock++;
  }
  check("falls curtain in open air in front of the cliff, lip to pool", inRock === 0, `${inRock} rows inside rock`);
  // The Climb: one straight sheer wall, floor to rim, across its span.
  const C = WORLD.climb;
  let faceErr = 0;
  for (let x = C.x0 + 20; x <= C.x1 - 20; x += 40) {
    faceErr = Math.max(faceErr, Math.abs(terrainHeight(x, C.footZ + 8) - C.floorY), Math.abs(terrainHeight(x, C.topZ - 20) - C.rimY));
  }
  check("Climb: floor at floorY in front of the face and rimY on the shelf behind it (+/-15), whole span", faceErr <= 15, `max error ${r1(faceErr)}`);
  const rise = STEPS[STEPS.length - 1][1] - STEPS[0][1];
  check("rise: floating steps climb 600-900 and end above the cloud layer", rise >= 600 && rise <= 900 && STEPS[STEPS.length - 1][1] > WORLD.cloudLevel, `${Math.round(rise)} over ${STEPS.length} steps, top ${STEPS[STEPS.length - 1][1]}, cloud ${WORLD.cloudLevel}`);
  const under = (c) => Math.max(...[0, 0.5, 1].flatMap((k) => [0, 1, 2, 3, 4, 5].map((a) => terrainHeight(c.x + Math.cos(a) * c.r * k, c.z + Math.sin(a) * c.r * k))));
  check("ground under the Sky Island and the Harbour Isle is below the cloud layer", under(I) < WORLD.cloudLevel && under(H) < WORLD.cloudLevel, `max ${under(I).toFixed(0)} / ${under(H).toFixed(0)}`);
  const lm = PLACES.map((p) => ({ id: p.id, pos: p.pos.y, ground: Math.round(terrainHeight(p.pos.x, p.pos.z)) }));
  report.landmarkGround = lm;
  // a4 is underground since grey pass 3 (its collar is checked in the mine section).
  const bad = lm.filter((r) => ["a1", "a2", "a6"].includes(r.id) && Math.abs(r.pos - r.ground) > 3);
  check("pads: a1 a2 a6 ground within 3 of pos.y", bad.length === 0, lm.map((r) => `${r.id} ${r.pos}/${r.ground}`).join(" "));
}

// ── Pitch per key (so the angles can be read off) ────────────────────────────
report.keys = TRAIL.map((p, i) => ({ i, kind: TRAIL_KIND[i], s: Math.round(sAtKey(i)), ...L.TRAIL_VIEW[i], y: p[1], ground: Math.round(terrainHeight(p[0], p[2])) }));

// ── Pictures ─────────────────────────────────────────────────────────────────
function pngEncode(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = rgb[y * w * 3 + x];
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// A height grid for pictures only (checks above use terrainHeight directly).
const GS = 10;
const GW = Math.round((WORLD.maxX - WORLD.minX) / GS) + 1;
const GH = Math.round((WORLD.maxZ - WORLD.minZ) / GS) + 1;
let grid = null;
function buildGrid() {
  grid = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) grid[j * GW + i] = terrainHeight(WORLD.minX + i * GS, WORLD.minZ + j * GS);
}
function gh(x, z) {
  const fx = Math.min(GW - 1.001, Math.max(0, (x - WORLD.minX) / GS));
  const fz = Math.min(GH - 1.001, Math.max(0, (z - WORLD.minZ) / GS));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const a = grid[j * GW + i];
  const b = grid[j * GW + i + 1];
  const c = grid[(j + 1) * GW + i];
  const d = grid[(j + 1) * GW + i + 1];
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
const TINT = [[-60, 76, 87, 102], [0, 150, 150, 138], [250, 140, 150, 128], [700, 158, 154, 146], [1100, 184, 181, 178], [1500, 226, 226, 230]];
function tint(y) {
  let t = 0;
  while (t < TINT.length - 2 && y > TINT[t + 1][0]) t++;
  const a = TINT[t];
  const b = TINT[t + 1];
  const f = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0])));
  return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
}
const SUN = new THREE.Vector3(-0.5, 0.55, 0.35).normalize();
function shadeAt(x, z) {
  const y = gh(x, z);
  const gx = (gh(x + GS, z) - gh(x - GS, z)) / (2 * GS);
  const gz = (gh(x, z + GS) - gh(x, z - GS)) / (2 * GS);
  const inv = 1 / Math.hypot(gx, 1, gz);
  const lam = Math.max(0, (-gx * SUN.x + SUN.y - gz * SUN.z) * inv);
  const c = tint(y);
  const k = 0.35 + 0.75 * lam;
  return [c[0] * k, c[1] * k, c[2] * k];
}

function topDown() {
  const S = 10; // units per pixel
  const w = Math.round((WORLD.maxX - WORLD.minX) / S);
  const h = Math.round((WORLD.maxZ - WORLD.minZ) / S);
  const rgb = new Uint8Array(w * h * 3);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = WORLD.minX + (i + 0.5) * S;
      const z = WORLD.minZ + (j + 0.5) * S;
      const y = gh(x, z);
      let c = shadeAt(x, z);
      if (y < 0) c = [70, 96, 122];
      const Lk = WORLD.lake;
      if (Math.hypot(x - Lk.x, z - Lk.z) < Lk.r) c = [96, 128, 158];
      // contour every 200
      const band = Math.floor(y / 200);
      const band2 = Math.floor(gh(x + S, z) / 200);
      const band3 = Math.floor(gh(x, z + S) / 200);
      if (band !== band2 || band !== band3) c = c.map((v) => v * 0.72);
      const o = (j * w + i) * 3;
      rgb[o] = Math.min(255, c[0]);
      rgb[o + 1] = Math.min(255, c[1]);
      rgb[o + 2] = Math.min(255, c[2]);
    }
  }
  return { w, h, S, png: pngEncode(w, h, rgb) };
}

function mapSvg(td) {
  const { w, h, S } = td;
  const X = (x) => ((x - WORLD.minX) / S).toFixed(1);
  const Z = (z) => ((z - WORLD.minZ) / S).toFixed(1);
  const kindCol = { walk: "#ffd27a", dive: "#ff5a5a", climb: "#ff9a3d", rise: "#b58bff", sky: "#7fd6ff", bridge: "#ff7fd0", board: "#9aff9a", flight: "#ffffff" };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + 40}" viewBox="0 0 ${w} ${h + 40}" font-family="monospace">`;
  s += `<rect width="${w}" height="${h + 40}" fill="#1d1826"/>`;
  s += `<image href="data:image/png;base64,${td.png.toString("base64")}" x="0" y="0" width="${w}" height="${h}"/>`;
  const C = WORLD.cloudClear;
  s += `<circle cx="${X(C.x)}" cy="${Z(C.z)}" r="${C.r / S}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-dasharray="6 5"/>`;
  s += `<text x="${X(C.x - C.r * 0.7)}" y="${Z(C.z - C.r * 0.75)}" fill="#fff" fill-opacity=".7" font-size="11">no cloud inside</text>`;
  // walking path
  s += `<polyline fill="none" stroke="#000" stroke-opacity=".55" stroke-width="3" stroke-dasharray="2 3" points="${PATH.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ")}"/>`;
  // island + bounty
  s += `<circle cx="${X(I.x)}" cy="${Z(I.z)}" r="${I.r / S}" fill="#e8a86a" fill-opacity=".35" stroke="#e8a86a" stroke-width="2"/>`;
  s += `<circle cx="${X(B.x)}" cy="${Z(B.z)}" r="${B.r / S}" fill="#e8a86a" fill-opacity=".35" stroke="#e8a86a" stroke-width="2"/>`;
  s += `<circle cx="${X(H.x)}" cy="${Z(H.z)}" r="${H.r / S}" fill="#9fd0ff" fill-opacity=".3" stroke="#9fd0ff" stroke-width="2"/>`;
  s += `<text x="${X(I.x - 300)}" y="${Z(I.z + I.r + 60)}" fill="#e8a86a" font-size="12">SKY ISLAND ${I.y}</text>`;
  s += `<text x="${X(H.x + H.r + 30)}" y="${Z(H.z)}" fill="#9fd0ff" font-size="12">HARBOUR ISLE ${H.y}</text>`;
  const Fo = WORLD.forest;
  s += `<circle cx="${X(Fo.x)}" cy="${Z(Fo.z)}" r="${Fo.r / S}" fill="#3c6a3c" fill-opacity=".28" stroke="#6fbf6f" stroke-dasharray="4 3"/>`;
  s += `<circle cx="${X(Fo.clearing.x)}" cy="${Z(Fo.clearing.z)}" r="${Fo.clearing.r / S}" fill="none" stroke="#9fff9f" stroke-dasharray="2 2"/>`;
  const Me = WORLD.meadow;
  s += `<circle cx="${X(Me.x)}" cy="${Z(Me.z)}" r="${Me.r / S}" fill="none" stroke="#bfe39a" stroke-dasharray="4 3"/><text x="${X(Me.x + Me.r * 0.72)}" y="${Z(Me.z - Me.r * 0.72)}" fill="#bfe39a" font-size="11">meadow</text>`;
  for (const c of L.FOREST_KEEP_CLEAR) s += `<line x1="${X(c[0])}" y1="${Z(c[1])}" x2="${X(c[2])}" y2="${Z(c[3])}" stroke="#9fff9f" stroke-opacity=".5" stroke-width="${(2 * c[4]) / S}" stroke-linecap="round"/>`;
  for (const [arr, col] of [[L.STREAM, "#7fd6ff"], [L.BROOK, "#7fd6ff"], [L.RIVER, "#6aa0d0"]]) s += `<polyline fill="none" stroke="${col}" stroke-width="2" points="${arr.map((p) => `${X(p[0])},${Z(p[2])}`).join(" ")}"/>`;
  const Cl = WORLD.climb;
  s += `<line x1="${X(Cl.x0)}" y1="${Z(Cl.footZ)}" x2="${X(Cl.x1)}" y2="${Z(Cl.footZ)}" stroke="#ff9a3d" stroke-width="4"/>`;
  s += `<line x1="${X(L.BRIDGE.a[0])}" y1="${Z(L.BRIDGE.a[2])}" x2="${X(L.BRIDGE.b[0])}" y2="${Z(L.BRIDGE.b[2])}" stroke="#ff7fd0" stroke-width="3"/>`;
  s += `<polyline fill="none" stroke="#000" stroke-opacity=".55" stroke-width="3" stroke-dasharray="2 3" points="${L.HARBOUR_PATH.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ")}"/>`;
  for (const sp of [L.SHIP_MOORED, L.SHIP_DOCKED]) {
    const b = (sp.heading * Math.PI) / 180;
    const hl = L.SHIP.length / 2;
    s += `<line x1="${X(sp.x - Math.sin(b) * hl)}" y1="${Z(sp.z + Math.cos(b) * hl)}" x2="${X(sp.x + Math.sin(b) * hl)}" y2="${Z(sp.z - Math.cos(b) * hl)}" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`;
  }
  for (const st of STEPS) s += `<rect x="${(+X(st[0]) - 1.5).toFixed(1)}" y="${(+Z(st[2]) - 1.5).toFixed(1)}" width="3" height="3" fill="#b58bff"/>`;
  // falls
  const F = WORLD.falls;
  s += `<line x1="${X(F.top[0] - F.width / 2)}" y1="${Z(F.top[2])}" x2="${X(F.top[0] + F.width / 2)}" y2="${Z(F.top[2])}" stroke="#7fd6ff" stroke-width="4"/>`;
  { const Pl = WORLD.pool; s += `<circle cx="${X(Pl.x)}" cy="${Z(Pl.z)}" r="${Pl.r / S}" fill="#6aa0d0"/>`; }
  // dense camera route coloured by kind
  let cur = null;
  let pts = [];
  const flush = () => {
    if (pts.length > 1) s += `<polyline fill="none" stroke="${kindCol[cur]}" stroke-width="2.5" points="${pts.join(" ")}"/>`;
  };
  for (let i = 0; i < dense.length; i += 3) {
    const d = dense[i];
    const k = d.kind;
    if (k !== cur) {
      flush();
      pts = pts.length ? [pts[pts.length - 1]] : [];
      cur = k;
    }
    pts.push(`${X(d.p.x)},${Z(d.p.z)}`);
  }
  flush();
  // view ticks at keys
  TRAIL.forEach((p, i) => {
    const q = LOOK[i];
    const dx = q[0] - p[0];
    const dz = q[2] - p[2];
    const l = Math.hypot(dx, dz) || 1;
    s += `<line x1="${X(p[0])}" y1="${Z(p[2])}" x2="${X(p[0] + (dx / l) * 220)}" y2="${Z(p[2] + (dz / l) * 220)}" stroke="#fff" stroke-opacity=".6" stroke-width="1"/>`;
    s += `<circle cx="${X(p[0])}" cy="${Z(p[2])}" r="2" fill="#fff"/>`;
  });
  for (const pl of PLACES) {
    s += `<circle cx="${X(pl.pos.x)}" cy="${Z(pl.pos.z)}" r="6" fill="#1d1826" stroke="#e8a86a" stroke-width="2.5"/>`;
    s += `<text x="${+X(pl.pos.x) + 9}" y="${+Z(pl.pos.z) + 4}" fill="#fff" font-size="13" font-weight="bold" stroke="#1d1826" stroke-width="3" paint-order="stroke">${pl.id.slice(1)} ${pl.landmark}</text>`;
    const c = TRAIL[pl.trail];
    s += `<line x1="${X(c[0])}" y1="${Z(c[2])}" x2="${X(pl.pos.x)}" y2="${Z(pl.pos.z)}" stroke="#e8a86a" stroke-dasharray="3 3"/>`;
  }
  // legend + scale
  const leg = Object.entries(kindCol).map(([k, c], i) => `<rect x="${10 + i * 90}" y="${h + 14}" width="14" height="6" fill="${c}"/><text x="${28 + i * 90}" y="${h + 21}" fill="#ddd" font-size="11">${k}</text>`).join("");
  s += leg + `<line x1="${w - 160}" y1="${h + 18}" x2="${w - 160 + 1000 / S}" y2="${h + 18}" stroke="#fff" stroke-width="2"/><text x="${w - 160}" y="${h + 34}" fill="#ddd" font-size="11">1000 units</text>`;
  s += `<text x="10" y="${h + 36}" fill="#aaa" font-size="11">north is up (-z). grey = height, contours every 200. white ticks = view direction at each key. dashed = walking trail.</text>`;
  s += `</svg>`;
  return s;
}

function profileSvg() {
  const W = 1500;
  const H = 520;
  const pad = 50;
  const yMin = -100;
  const yMax = 2000;
  const X = (s) => (pad + (s / total) * (W - 2 * pad)).toFixed(1);
  const Y = (y) => (H - pad - ((y - yMin) / (yMax - yMin)) * (H - 2 * pad)).toFixed(1);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="monospace">`;
  s += `<rect width="${W}" height="${H}" fill="#1d1826"/>`;
  for (let y = 0; y <= 1800; y += 200) s += `<line x1="${pad}" x2="${W - pad}" y1="${Y(y)}" y2="${Y(y)}" stroke="#fff" stroke-opacity=".08"/><text x="6" y="${+Y(y) + 4}" fill="#888" font-size="11">${y}</text>`;
  // ground under the camera, filled
  const g = dense.filter((_, i) => i % 3 === 0).map((d) => `${X(d.s)},${Y(Math.max(yMin, terrainHeight(d.p.x, d.p.z)))}`);
  s += `<polygon points="${X(0)},${Y(yMin)} ${g.join(" ")} ${X(total)},${Y(yMin)}" fill="#6d6873"/>`;
  s += `<line x1="${pad}" x2="${W - pad}" y1="${Y(WORLD.cloudLevel)}" y2="${Y(WORLD.cloudLevel)}" stroke="#fff" stroke-dasharray="8 6" stroke-opacity=".7"/><text x="${W - pad - 110}" y="${+Y(WORLD.cloudLevel) - 6}" fill="#fff" font-size="12">cloud layer ${WORLD.cloudLevel}</text>`;
  s += `<line x1="${pad}" x2="${W - pad}" y1="${Y(0)}" y2="${Y(0)}" stroke="#6aa0d0" stroke-opacity=".7"/><text x="${pad + 4}" y="${+Y(0) + 14}" fill="#6aa0d0" font-size="11">sea</text>`;
  const kindCol = { walk: "#ffd27a", dive: "#ff5a5a", climb: "#ff9a3d", rise: "#b58bff", sky: "#7fd6ff", bridge: "#ff7fd0", board: "#9aff9a", flight: "#ffffff" };
  for (let i = 3; i < dense.length; i += 3) {
    const a = dense[i - 3];
    const b = dense[i];
    s += `<line x1="${X(a.s)}" y1="${Y(a.p.y)}" x2="${X(b.s)}" y2="${Y(b.p.y)}" stroke="${kindCol[b.kind]}" stroke-width="2.5"/>`;
  }
  for (const pl of PLACES) {
    const sx = X(sAtKey(pl.trail));
    const c = TRAIL[pl.trail];
    s += `<line x1="${sx}" x2="${sx}" y1="${Y(yMax)}" y2="${Y(yMin)}" stroke="#e8a86a" stroke-opacity=".35"/>`;
    s += `<circle cx="${sx}" cy="${Y(c[1])}" r="5" fill="#e8a86a"/>`;
    s += `<text x="${+sx + 4}" y="${pad - 14}" fill="#e8a86a" font-size="12">${pl.id.slice(1)} ${pl.landmark}</text>`;
    s += `<text x="${+sx + 4}" y="${pad}" fill="#aaa" font-size="10">${pl.light}</text>`;
  }
  for (let d = 0; d <= total; d += 1000) s += `<text x="${X(d)}" y="${H - pad + 18}" fill="#888" font-size="11">${d}</text>`;
  s += `<text x="${pad}" y="${H - 10}" fill="#aaa" font-size="11">camera height (coloured by kind) and ground under the camera, against distance along the camera route. total ${Math.round(total)} units.</text>`;
  s += `</svg>`;
  return s;
}

/** A small ray-marched grey view from a route sample. Island orange, landmarks white, falls blue. */
function renderView(p, q, W = 320, H = 180) {
  const f = q.clone().sub(p).normalize();
  const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
  const u = new THREE.Vector3().crossVectors(r, f);
  const th = Math.tan(((FOV / 2) * Math.PI) / 180);
  const rgb = new Uint8Array(W * H * 3);
  const Lk = WORLD.lake;
  const F = WORLD.falls;
  const boxes = PLACES.filter((pl) => pl.id !== "a3" && pl.id !== "a4").map((pl) => ({ x: pl.pos.x, y0: pl.pos.y, y1: pl.pos.y + pl.height, hw: Math.max(14, Math.min(60, pl.height * 0.3)), z: pl.pos.z }));
  const haze = [205, 190, 185];
  function march(ox, oy, oz, dx, dy, dz, bounce) {
    let t = 1;
    let prevAbove = oy - WORLD.cloudLevel;
    let cloudA = 0;
    while (t < 14000) {
      const x = ox + dx * t;
      const y = oy + dy * t;
      const z = oz + dz * t;
      // cloud sheet outside the clear basin
      const ca = y - WORLD.cloudLevel;
      if (ca * prevAbove <= 0 && inCloudAt(x, z) && cloudA === 0) cloudA = 0.8;
      prevAbove = ca;
      // island volumes
      for (const { c, depth } of ISLES) {
        const dd = Math.hypot(x - c.x, z - c.z);
        if (dd < c.r && y <= c.y && y >= c.y - depth * (1 - dd / c.r)) return mix(c === H ? [120, 170, 230] : [232, 150, 80], haze, t, cloudA);
      }
      // the bridge deck
      {
        const bA = L.BRIDGE.a;
        const bB = L.BRIDGE.b;
        const ex = bB[0] - bA[0];
        const ez = bB[2] - bA[2];
        const l2 = ex * ex + ez * ez;
        const u = ((x - bA[0]) * ex + (z - bA[2]) * ez) / l2;
        if (u >= 0 && u <= 1) {
          const side = Math.abs((x - bA[0]) * ez - (z - bA[2]) * ex) / Math.sqrt(l2);
          const dy = y - L.bridgeDeckAt(u);
          if ((side < L.BRIDGE.width / 2 && dy <= 0 && dy > -1.5) || (Math.abs(side - 4.4) < 0.6 && dy > 0 && dy < 8)) return mix([150, 110, 80], haze, t, cloudA);
        }
      }
      for (const bx of boxes) if (Math.abs(x - bx.x) < bx.hw && Math.abs(z - bx.z) < bx.hw && y >= bx.y0 && y <= bx.y1) return mix([245, 245, 240], haze, t, cloudA);
      for (const st of STEPS) if (Math.abs(x - st[0]) < 16 && Math.abs(z - st[2]) < 16 && y <= st[1] && y >= st[1] - 8) return mix([200, 170, 255], haze, t, cloudA);
      // falls sheet
      if (Math.abs(x - F.top[0]) < F.width / 2 && y <= F.top[1] && y >= F.bottom[1]) {
        const fz = L.fallsCurtainAt(y)[1];
        if (Math.abs(z - fz) < 6) return mix([150, 205, 240], haze, t, cloudA);
      }
      const g = gh(x, z);
      // water planes
      if (y <= Lk.y && Math.hypot(x - Lk.x, z - Lk.z) < Lk.r && g < Lk.y) {
        const tt = (oy - Lk.y) / -dy;
        const hx = ox + dx * tt;
        const hz = oz + dz * tt;
        if (!bounce) return mix([88, 120, 150], haze, t, cloudA);
        const refl = march(hx, Lk.y + 0.01, hz, dx, -dy, dz, false);
        return mix(refl.map((v, i) => v * 0.78 + [60, 90, 120][i] * 0.22), haze, t, cloudA);
      }
      if (y <= 0 && g < 0) return mix([70, 100, 130], haze, t, cloudA);
      if (y <= g) return mix(shadeAt(x, z), haze, t, cloudA);
      const above = y - g;
      t += Math.max(1.2, Math.min(60, above * 0.45, t * 0.02 + 1));
    }
    // sky
    const e = Math.max(0, dy);
    return mix([230 - 120 * e, 190 - 60 * e, 170 + 30 * e], haze, 0, cloudA);
  }
  function mix(c, hz, t, cloudA) {
    const k = 1 - Math.exp(-t / 6500);
    let o = c.map((v, i) => v * (1 - k) + hz[i] * k);
    if (cloudA) o = o.map((v) => v * (1 - cloudA) + 238 * cloudA);
    return o;
  }
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const sx = ((2 * (i + 0.5)) / W - 1) * th * ASPECT;
      const sy = (1 - (2 * (j + 0.5)) / H) * th;
      const d = f.clone().addScaledVector(r, sx).addScaledVector(u, sy).normalize();
      const c = march(p.x, p.y, p.z, d.x, d.y, d.z, true);
      const o = (j * W + i) * 3;
      rgb[o] = Math.min(255, Math.max(0, c[0]));
      rgb[o + 1] = Math.min(255, Math.max(0, c[1]));
      rgb[o + 2] = Math.min(255, Math.max(0, c[2]));
    }
  }
  return pngEncode(W, H, rgb);
}

async function shoot(html, file, w, h) {
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: file });
  } finally {
    await browser.close();
  }
}

fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
if (SHOTS) {
  const t0 = performance.now();
  buildGrid();
  const td = topDown();
  const map = mapSvg(td);
  fs.writeFileSync(path.join(OUT, "map.svg"), map);
  const prof = profileSvg();
  fs.writeFileSync(path.join(OUT, "profile.svg"), prof);
  await shoot(`<body style="margin:0;background:#1d1826">${map}</body>`, path.join(OUT, "map.png"), td.w, td.h + 40);
  await shoot(`<body style="margin:0;background:#1d1826">${prof}</body>`, path.join(OUT, "profile.png"), 1500, 520);
  // Views: every stop plus the moments that matter.
  const at = (k, frac = 0) => {
    const t = Math.min(1, (k + frac) / (nK - 1));
    return { p: posCurve.getPoint(t), q: lookCurve.getPoint(t) };
  };
  const D = L.DIVE_KEYS;
  const riseStart = TRAIL_KIND.indexOf("rise");
  const Fk = L.FLIGHT_KEYS;
  const views = [
    ["opening", at(0)],
    ["1 Signpost", at(PLACES[0].trail)],
    ["to camp (pass-1 f02)", at(PLACES[0].trail + 2)],
    ["2 Lookout", at(PLACES[1].trail)],
    ["past camp (pass-1 f04)", at(PLACES[1].trail + 2)],
    ["near the rim (pass-1 f05)", at(D.first - 1)],
    ["at the rim, head-on", at(D.first)],
    ["dive: over the edge", at(D.first + 1, 0.5)],
    ["dive: halfway down", at(D.first + 3, 0.5)],
    ["dive: the pool rising", at(D.first + 5)],
    ["3 Waterfall (foot)", at(PLACES[2].trail)],
    ["the turn down the gorge", at(PLACES[2].trail + 1)],
    ["down the gorge", at(PLACES[2].trail + 3)],
    ["4 Pulley Lift", at(PLACES[3].trail)],
    ["climb: at the face", at(PLACES[3].trail + 2)],
    ["over the rim, the saddle", at(PLACES[3].trail + 4)],
    ["the meadow to the lake", at(PLACES[3].trail + 6)],
    ["5 Boathouse (reflection)", at(PLACES[4].trail)],
    ["the reveal: tilt up", at(PLACES[4].trail + 2)],
    ["into the forest", at(PLACES[5].trail - 1)],
    ["6 Great Tree", at(PLACES[5].trail)],
    ["behind the first step", at(riseStart)],
    ["rise: island above", at(riseStart + 2)],
    ["7 Observatory", at(PLACES[6].trail)],
    ["the stars", at(PLACES[6].trail + 2)],
    ["the bridge", at(L.BRIDGE_KEYS.first + 1)],
    ["aboard, moored", at(Fk.first)],
    ["flight: out past the peak", at(Fk.first + 1, 0.5)],
    ["flight: the harbour ahead", at(Fk.first + 3)],
    ["flight: approach", at(Fk.first + 4, 0.5)],
    ["8 Guild Hall", at(PLACES[7].trail)],
    ["tail", at(nK - 1)],
  ];
  let cells = "";
  for (const [name, v] of views) {
    const png = renderView(v.p, v.q);
    const pitch = (Math.asin((v.p.y - v.q.y) / v.p.distanceTo(v.q)) * 180) / Math.PI;
    cells += `<figure style="margin:0"><img src="data:image/png;base64,${png.toString("base64")}" width="320" height="180" style="display:block"><figcaption style="font:12px monospace;color:#ddd;padding:3px 2px 6px">${name} <span style="color:#999">y ${Math.round(v.p.y)}, pitch ${pitch.toFixed(0)}</span></figcaption></figure>`;
  }
  await shoot(`<body style="margin:0;background:#1d1826;padding:6px"><div style="display:grid;grid-template-columns:repeat(4,320px);gap:6px">${cells}</div></body>`, path.join(OUT, "views.png"), 4 * 320 + 3 * 6 + 12, Math.ceil(views.length / 4) * 210 + 12);
  console.log(`\npictures in ${Math.round(performance.now() - t0)} ms -> ${OUT}`);
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks pass");
process.exitCode = failures ? 1 : 0;
