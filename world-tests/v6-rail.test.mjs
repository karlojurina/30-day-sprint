/**
 * V4 camera rail: src/lib/world-v6/rail.ts, measured.
 *
 *   node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings --expose-gc world-tests/v6-rail.test.mjs
 *
 * Exits 1 on any failed check. What it proves:
 *   - no speed steps: position and view direction as functions of scroll
 *     depth, the largest velocity jump between adjacent samples shrinks ~10x
 *     when sampled 10x finer (a real step does not shrink), plus the speed
 *     ratio across every stop, where the per-stretch budgets change;
 *   - the pitch profile: V3's 8-16 on the walk, the dive's peak (55-65) and
 *     its return to level at the pool, the rise looking up and levelling onto
 *     the island;
 *   - clearance, with terrain follow on the scene's own ground (railGround:
 *     ground, water, island keep-out): >= 35 over the ground everywhere but
 *     the dive, the dive >= 15 from the cliff face (world-tests/v6-route.mjs's
 *     rule, same function), and >= 35 over the Sky Island near its rim;
 *   - reversibility: depth -> distance is strictly increasing, the round trip
 *     is exact, and the scene's glide (exponential smoothing) brought forward
 *     and back lands on the same pose to the float;
 *   - every stretch spends its scroll budget, setPacing retunes live and keeps
 *     the path, the dwell slows the camera at each stop;
 *   - sample() allocates nothing (GC count over 3M samples, with --expose-gc);
 *   - grey pass 2, on foot and aboard: on the rope bridge and the isles at its
 *     ends the eye is exactly BRIDGE_EYE over what it stands on; your airship
 *     (rail.shipAtS) is exactly SHIP_MOORED before the camera boards and
 *     SHIP_DOCKED after it steps off, carries the camera at SHIP.camBack /
 *     SHIP.camUp through the flight, has no speed or turn step anywhere
 *     (cast-off and docking ease), keeps the camera standing on its deck
 *     while it eases, banks no more than shipBankMax, and allocates nothing.
 *   - grey pass 3: the cave, tunnel and shaft samples are inside the mine's
 *     voids (layout caveMargin) or in open air, with terrain follow on; the
 *     flight is its own scroll stretch (FLIGHT_VH), a8 sits after it, and it
 *     retunes on its own (setPacing's 10th value) without moving the path.
 */
import * as THREE from "three";
import { createRail } from "../src/lib/world-v6/rail.ts";
import * as L from "../src/lib/world-v6/layout.ts";
import { terrainHeight } from "../src/lib/world-v6/terrain.ts";

const { PLACES, WORLD, TAIL_VH, FLIGHT_VH, NO_TERRAIN_FOLLOW, UNDERGROUND } = L;
const failures = [];
function check(ok, what, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail !== undefined ? "  (" + detail + ")" : ""}`);
  if (!ok) failures.push(what);
}
const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);

const rail = createRail();
// Ground and water: what the camera must clear.
const surface = (x, z) => {
  let h = terrainHeight(x, z);
  const lk = WORLD.lake;
  if (Math.hypot(x - lk.x, z - lk.z) < lk.r) h = Math.max(h, lk.y);
  return Math.max(h, WORLD.seaLevel);
};
// The rail runs on the scene's own ground function: ground, water and the
// islands' keep-out domes (scene.ts railGround).
const { railGround } = await import("../src/lib/world-v6/scene.ts");
rail.setGround(railGround);
const pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
const at = (d) => {
  rail.sample(d, pose);
  return { p: pose.position.clone(), t: pose.target.clone() };
};

console.log(`\nroute ${Math.round(rail.length)} units, scroll ${rail.totalVh()} vh, stops at s = ${rail.stopS.map(Math.round).join(", ")}`);

// ── 1. No speed steps ─────────────────────────────────────────────────────────
console.log("\n=== SPEED: no steps (depth -> position and view) ===");
function maxJump(N, fn) {
  let prev = fn(0);
  let prevV = null;
  let m = 0;
  let where = 0;
  for (let i = 1; i <= N; i++) {
    const d = i / N;
    const cur = fn(d);
    const v = cur.map((c, k) => (c - prev[k]) * N);
    if (prevV) {
      const j = Math.hypot(...v.map((c, k) => c - prevV[k]));
      if (j > m) {
        m = j;
        where = d;
      }
    }
    prevV = v;
    prev = cur;
  }
  return { m, where };
}
const posFn = (d) => {
  rail.sample(d, pose);
  return [pose.position.x, pose.position.y, pose.position.z];
};
const dirFn = (d) => {
  rail.sample(d, pose);
  const v = pose.target.clone().sub(pose.position).normalize();
  return [v.x, v.y, v.z];
};
for (const [name, fn] of [
  ["position", posFn],
  ["view direction", dirFn],
]) {
  const a = maxJump(4000, fn);
  const b = maxJump(40000, fn);
  const shrink = a.m / Math.max(1e-12, b.m);
  check(shrink >= 8, `${name}: largest velocity jump shrinks >= 8x at 10x sampling`, `${f2(shrink)}x, ${a.m.toExponential(2)} @${f2(a.where)} -> ${b.m.toExponential(2)} @${f2(b.where)}`);
}
{
  // Across each stop, where one stretch's budget hands over to the next: the
  // speed ratio h units after vs h before. The blend makes it a ramp, so the
  // ratio is not 1 at h = 2; what proves there is no step is that the gap
  // shrinks ~10x when h does (a step would stay put).
  const sp = (s0) => 1 / rail.densityAtS(s0);
  const rows = [];
  let worstShrink = Infinity;
  for (let i = 0; i < PLACES.length; i++) {
    const s = rail.stopS[i];
    const r2 = Math.abs(sp(s + 2) / sp(s - 2) - 1);
    const r02 = Math.abs(sp(s + 0.2) / sp(s - 0.2) - 1);
    const shrink = r2 / Math.max(r02, 1e-12);
    if (r2 > 1e-4) worstShrink = Math.min(worstShrink, shrink);
    rows.push(`${PLACES[i].id} ${(r2 * 100).toFixed(2)}%->${(r02 * 100).toFixed(3)}%`);
  }
  check(worstShrink >= 8, "no speed step at any stop: the speed gap across it shrinks >= 8x from +-2 to +-0.2 units", rows.join(", "));
}

// ── 2. Pitch profile ──────────────────────────────────────────────────────────
console.log("\n=== PITCH ===");
const kinds = [];
{
  const N = 13000;
  const rows = [];
  let diveMax = -1e9;
  let diveMaxS = 0;
  let riseMin = 1e9;
  let walkMax = -1e9;
  let walkMaxS = 0;
  let prevP = null;
  let worstRate = 0;
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * rail.length;
    const k = rail.kindAtS(s);
    const p = rail.pitchAtS(s);
    kinds.push(k);
    if (k === "dive") {
      if (p > diveMax) {
        diveMax = p;
        diveMaxS = s;
      }
    } else if (k === "rise") riseMin = Math.min(riseMin, p);
    else if (p > walkMax) {
      walkMax = p;
      walkMaxS = s;
    }
    if (prevP !== null) worstRate = Math.max(worstRate, Math.abs(p - prevP) / (rail.length / N));
    prevP = p;
  }
  for (let i = 0; i < PLACES.length; i++) rows.push(`${PLACES[i].id} ${f1(rail.pitchAtS(rail.stopS[i]))}`);
  console.log(`  pitch at the stops (deg below horizon): ${rows.join(", ")}`);
  const pitchAt = (s) => rail.pitchAtS(s);
  console.log(`  dive: ${[0, 0.2, 0.4, 0.6, 0.8, 1].map((u) => {
    const s0 = rail.stopS[1] + (rail.stopS[2] - rail.stopS[1]) * (0.55 + 0.45 * u);
    return `${Math.round(s0)}:${f1(pitchAt(s0))}`;
  }).join("  ")}`);
  // v6: the ride goes over the lip with the water and falls looking down along
  // it at the pool (world_art_bible_v6.md 1.5), pitch 70-78.
  check(diveMax >= 65 && diveMax <= 80, "the ride's pitch peaks at 65-80 deg down (v6: looking down along the water)", `${f1(diveMax)} at s ${Math.round(diveMaxS)}`);
  // Round 1 (decision 46): a3 stands outside the falls, looking up at the whole drop.
  check(rail.pitchAtS(rail.stopS[2]) <= 0 && rail.pitchAtS(rail.stopS[2]) >= -12, "a3 outside the falls, looking up 0-12 at the whole drop (round 1)", f1(rail.pitchAtS(rail.stopS[2])));
  check(riseMin <= -12, "the rise looks up at the island (<= -12)", f1(riseMin));
  const a7 = rail.pitchAtS(rail.stopS[6]);
  // Fix round 1 (judge 1): a7 looks up 12 so the observatory and terrace read.
  // Fix round 3: the stop orbits to the telescope's side and looks up 6, so
  // the tube is a diagonal across the sky and the terrace clears the timeline.
  // Round 1 (decision 46, "waaay too much sky"): it looks up only 0-4, so the
  // island's top reads under the sky; the telescope park is the sky moment.
  check(a7 >= -4 && a7 <= 0, "a7: the island and the observatory under the sky, looking up 0-4 (round 1)", f1(a7));
  check(walkMax <= 16.5, "outside the dive the camera never looks down more than V3's 16", `${f1(walkMax)} at s ${Math.round(walkMaxS)}`);
  // v6 (bible 1.0): the unlocked stops come down low and look level or up
  // (a1, a4, a8: -12..+3; a4 looks up 8 through a wide lens, the pool on the
  // frame's bottom); a2 looks up 8-20 from the flowers at the lookout against
  // the sky (B9: 18, the tower's cabin clears the col's skyline); a5 keeps
  // v5's locked look out over the lake (4-16 down); a6 looks up at the whole
  // Great Tree (~2x the forest) from 640 away.
  const lowStops = [0, 3, 7].map((i) => rail.pitchAtS(rail.stopS[i]));
  const a2p = rail.pitchAtS(rail.stopS[1]);
  const a5p = rail.pitchAtS(rail.stopS[4]);
  const a6p = rail.pitchAtS(rail.stopS[5]);
  check(lowStops.every((p) => p >= -12 && p <= 3) && a2p >= -20 && a2p <= -8 && a5p >= 4 && a5p <= 16.5 && a6p >= -25 && a6p <= -10, "stops: a1 a4 a8 level or up (-12..+3), a2 up 8-20, a5 at 4-16 down (locked), a6 looking up (-25..-10)", `a1 a4 a8 ${lowStops.map(f1).join(", ")} / a2 ${f1(a2p)} / a5 ${f1(a5p)}, a6 ${f1(a6p)}`);
  console.log(`  steepest pitch change: ${f2(worstRate)} deg per world unit (${f1(worstRate * 100)} deg per 100 units)`);
}

// ── 3. Clearance ─────────────────────────────────────────────────────────────
console.log("\n=== CLEARANCE (terrain follow on) ===");
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
  const N = 6000;
  let walk = { v: Infinity };
  let dive = { v: Infinity };
  let mine = { bad: 0, n: 0, first: null };
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * rail.length;
    rail.sampleS(s, pose);
    const { x, y, z } = pose.position;
    const above = y - surface(x, z);
    if (UNDERGROUND.includes(rail.kindAtS(s))) {
      // Grey pass 3: under the terrain by design. Inside a void, or in open
      // air (>= 15 up, nothing higher within 8), as v4-route.mjs rules it.
      mine.n++;
      const inside = L.caveMargin(x, y, z) >= 3;
      const open = above >= 15 && cliffDistance(x, y, z, 10) > 8;
      if (!inside && !open) {
        mine.bad++;
        if (!mine.first) mine.first = { s: Math.round(s), kind: rail.kindAtS(s), p: [x, y, z].map(Math.round) };
      }
      continue;
    }
    if (rail.kindAtS(s) === "dive") {
      const c = cliffDistance(x, y, z);
      const v = above < 0 ? -1 : c;
      if (v < dive.v) dive = { v, s: Math.round(s), p: [x, y, z].map(Math.round) };
    } else if (rail.kindAtS(s) !== "climb") {
      // v6: the clearance the rail keeps here (layout TRAIL_CLEAR); the gully (climb) is placed by hand.
      const f = rail.tAtS(s) * (L.TRAIL.length - 1);
      const i0 = Math.min(L.TRAIL.length - 2, Math.floor(f));
      const need = L.TRAIL_CLEAR[i0] + (L.TRAIL_CLEAR[i0 + 1] - L.TRAIL_CLEAR[i0]) * (f - i0);
      if (above - need < walk.v) walk = { v: above - need, s: Math.round(s), kind: rail.kindAtS(s), p: [x, y, z].map(Math.round), need: f1(need) };
    }
  }
  check(mine.bad === 0 && mine.n > 50, "the cave and its side passage: inside the void or in open air, with terrain follow on", mine.bad ? `${mine.bad} bad, first ${JSON.stringify(mine.first)}` : `${mine.n} samples`);
  check(walk.v >= -1, "every sample above ground (not the ride, the cave or the gully) >= TRAIL_CLEAR (35; 20 at and beside the stops) over the ground or water", `min margin ${f1(walk.v)} at s ${walk.s} (${walk.kind}, needs ${walk.need}) ${JSON.stringify(walk.p)}`);
  check(dive.v >= 15, "the dive stays >= 15 from the cliff face and above ground", `min ${dive.v} at s ${dive.s} ${JSON.stringify(dive.p)}`);
  // Terrain follow should be doing nothing on this layout (the route check cleared every key by hand).
  const bare = createRail();
  let maxLift = 0;
  let liftAt = 0;
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * rail.length;
    rail.sampleS(s, pose);
    const y1 = pose.position.y;
    bare.sampleS(s, pose);
    if (y1 - pose.position.y > maxLift) {
      maxLift = y1 - pose.position.y;
      liftAt = s;
    }
  }
  console.log(`  terrain follow lifts the route by at most ${f1(maxLift)} (at s ${Math.round(liftAt)}, ${rail.kindAtS(liftAt)})`);
  // The Sky Island: wherever the camera is over it or within 40 of its rim,
  // it is at least 35 above the top surface (so its side never fills the frame).
  const I = WORLD.island;
  let worstRim = { v: Infinity };
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * rail.length;
    rail.sampleS(s, pose);
    const { x, y, z } = pose.position;
    const d = Math.hypot(x - I.x, z - I.z);
    if (d > I.r + 40) continue;
    // On foot at eye height (bridge, board): layout NO_TERRAIN_FOLLOW, checked
    // by world-tests/v6-route.mjs (BRIDGE_EYE over the deck, >= 8 on the isle).
    if (NO_TERRAIN_FOLLOW.includes(rail.kindAtS(s))) continue;
    const above = y - I.y;
    if (above < worstRim.v) worstRim = { v: above, s: Math.round(s), d: Math.round(d), kind: rail.kindAtS(s) };
  }
  check(worstRim.v >= 35, "over the Sky Island or within 40 of its rim, the camera is >= 35 above its top", `min ${f1(worstRim.v)} at s ${worstRim.s}, ${worstRim.d} from centre (${worstRim.kind})`);
}

// ── 3b. The bridge and your airship (grey pass 2) ────────────────────────────
console.log("\n=== BRIDGE AND SHIP ===");
{
  const { BRIDGE, BRIDGE_EYE, BRIDGE_KEYS, FLIGHT_KEYS, SHIP, SHIP_MOORED, SHIP_DOCKED, bridgeDeckAt, shipCamera } = L;
  const nK = L.TRAIL.length;
  const sKey = (k) => {
    let lo = 0;
    let hi = rail.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (rail.tAtS(m) < k / (nK - 1)) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  const T = rail.tuning;
  const [sF, sL] = rail.flightS;
  check(Math.abs(sF - sKey(FLIGHT_KEYS.first)) < 0.5 && Math.abs(sL - sKey(FLIGHT_KEYS.last)) < 0.5, "rail.flightS sits on the first and last flight keys", `${f1(sF)} / ${f1(sL)}`);

  // The bridge: from the bridge-head key to the gangway's ramp, the eye is
  // exactly BRIDGE_EYE over the deck (and the isles' tops at its ends).
  const [ax, , az] = BRIDGE.a;
  const [bx, , bz] = BRIDGE.b;
  const L2 = (bx - ax) ** 2 + (bz - az) ** 2;
  const eyeAt = (s) => {
    rail.sampleS(s, pose);
    const { x, y, z } = pose.position;
    const u = ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2;
    return { eye: y - bridgeDeckAt(u), u };
  };
  const sHead = sKey(BRIDGE_KEYS.first - 1);
  let exact = 0;
  let anchor = 0;
  let onDeck = 0;
  const Lb = Math.sqrt(L2);
  // Within 4 sigma of an anchor (where the deck meets an isle at an angle) the
  // eye rounds the corner (rail.ts bridgeEyeSigma); everywhere else it is exact.
  const nearAnchor = (u) => Math.min(Math.abs(u), Math.abs(u - 1)) * Lb < 4 * T.bridgeEyeSigma;
  for (let s = sHead + 2; s <= sF - T.bridgeRamp; s += 1) {
    const { eye, u } = eyeAt(s);
    if (nearAnchor(u)) anchor = Math.max(anchor, Math.abs(eye - BRIDGE_EYE));
    else exact = Math.max(exact, Math.abs(eye - BRIDGE_EYE));
    if (u >= 0 && u <= 1) onDeck++;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let s = sF - T.bridgeRamp; s <= sF; s += 1) {
    const { eye } = eyeAt(s);
    lo = Math.min(lo, eye);
    hi = Math.max(hi, eye);
  }
  check(exact < 0.05 && anchor < 1.5 && onDeck > 200, "bridge head to gangway: the eye is BRIDGE_EYE over the deck and the isles' tops (no bob), rounding the two anchors", `worst ${exact.toFixed(3)} off ${BRIDGE_EYE} away from the anchors, ${f2(anchor)} at them, over ${Math.round(sF - T.bridgeRamp - sHead)} units, ${onDeck} of them on the deck`);
  check(lo >= BRIDGE_EYE - 0.1 && hi <= SHIP.camUp + 0.1, "up the gangway the eye rises from BRIDGE_EYE to SHIP.camUp, never below", `${f2(lo)}..${f2(hi)}`);

  // The ship, moored and docked.
  const sp = { x: 0, y: 0, z: 0, heading: 0, bank: 0, throttle: 0, phase: "" };
  const same = (p, q) => p.x === q.x && p.y === q.y && p.z === q.z && p.heading === q.heading;
  let mooredOk = true;
  for (const s of [0, rail.stopS[6], sF - T.shipCastOff / 2 - 0.01]) {
    rail.shipAtS(s, sp);
    if (!same(sp, SHIP_MOORED) || sp.phase !== "moored" || sp.throttle !== 0 || sp.bank !== 0) mooredOk = false;
  }
  let dockedOk = true;
  for (const s of [sL + T.shipDock / 2 + 0.01, rail.stopS[7], rail.length]) {
    rail.shipAtS(s, sp);
    if (!same(sp, SHIP_DOCKED) || sp.phase !== "docked" || sp.throttle !== 0) dockedOk = false;
  }
  check(mooredOk && dockedOk, "the ship is exactly SHIP_MOORED before the camera boards and SHIP_DOCKED after", `${mooredOk} / ${dockedOk}`);

  // No speed step and no turn step anywhere (moored -> flight -> docked):
  // the largest jump in the ship's velocity per unit of route shrinks >= 8x
  // at 10x sampling, as section 1 proves for the camera.
  const s0 = sF - 80;
  const s1 = sL + 120;
  const shipJump = (N, fn) => {
    let prev = null;
    let prevV = null;
    let m = 0;
    let where = 0;
    for (let i = 0; i <= N; i++) {
      const s = s0 + ((s1 - s0) * i) / N;
      rail.shipAtS(s, sp);
      const cur = fn(sp);
      if (prev) {
        const v = cur.map((c, k) => (c - prev[k]) * N);
        if (prevV) {
          const j = Math.hypot(...v.map((c, k) => c - prevV[k]));
          if (j > m) {
            m = j;
            where = s;
          }
        }
        prevV = v;
      }
      prev = cur;
    }
    return { m, where };
  };
  for (const [name, fn] of [
    ["position", (p) => [p.x, p.y, p.z]],
    ["heading", (p) => [100 * Math.sin((p.heading * Math.PI) / 180), 100 * Math.cos((p.heading * Math.PI) / 180)]],
  ]) {
    const a = shipJump(4000, fn);
    const b = shipJump(40000, fn);
    const shrink = a.m / Math.max(1e-12, b.m);
    check(shrink >= 8, `ship ${name}: no step from moored through the flight to docked (velocity jump shrinks >= 8x at 10x sampling)`, `${f2(shrink)}x, worst near s ${Math.round(a.where)} (${Math.round(a.where - sF)} after cast-off)`);
  }

  // Riding: between the two eases the camera stands exactly at shipCamera(ship).
  let ride = 0;
  for (let s = sF + T.shipCastOff / 2; s <= sL - T.shipDock / 2; s += 3) {
    rail.shipAtS(s, sp);
    rail.sampleS(s, pose);
    const c = shipCamera(sp);
    ride = Math.max(ride, Math.hypot(pose.position.x - c[0], pose.position.y - c[1], pose.position.z - c[2]));
  }
  check(ride < 0.2, "through the flight the camera stands at SHIP.camBack behind the ship's centre, SHIP.camUp over its deck", `worst ${ride.toFixed(3)} units off`);

  // While the ship eases, the camera is on its deck: along the centreline
  // between the stern and the bow, SHIP.camUp (+-1.5) over the deck.
  let along = [Infinity, -Infinity];
  let side = 0;
  let up = [Infinity, -Infinity];
  for (let s = sF - T.shipCastOff / 2; s <= sL + T.shipDock / 2; s += 1) {
    if (s > sF + T.shipCastOff / 2 && s < sL - T.shipDock / 2) continue;
    rail.shipAtS(s, sp);
    rail.sampleS(s, pose);
    const b = (sp.heading * Math.PI) / 180;
    const fx = Math.sin(b);
    const fz = -Math.cos(b);
    const dx = pose.position.x - sp.x;
    const dz = pose.position.z - sp.z;
    const a = dx * fx + dz * fz;
    if (Math.abs(a) > SHIP.length / 2) continue; // stepped off the bow onto the quay
    along = [Math.min(along[0], a), Math.max(along[1], a)];
    side = Math.max(side, Math.abs(-dx * fz + dz * fx));
    const h = pose.position.y - sp.y;
    up = [Math.min(up[0], h), Math.max(up[1], h)];
  }
  check(along[0] >= -SHIP.length / 2 && side < 3 && up[0] >= SHIP.camUp - 1.5 && up[1] <= SHIP.camUp + 12, "casting off and docking, the camera stands on the deck (stern to bow, on the centreline, camUp over it)", `along ${f1(along[0])}..${f1(along[1])} (stern at ${-SHIP.length / 2}), off the centreline ${f2(side)}, over the deck ${f1(up[0])}..${f1(up[1])}`);

  // Throttle: 0 -> 1 at cast-off, 1 -> 0 at the dock, monotonic; bank capped.
  let mono = true;
  let prevT = 0;
  let maxBank = 0;
  let bankS = 0;
  for (let s = sF - T.shipCastOff; s <= sL + T.shipDock; s += 1) {
    rail.shipAtS(s, sp);
    if (s <= (sF + sL) / 2 ? sp.throttle < prevT - 1e-12 : sp.throttle > prevT + 1e-12) mono = false;
    prevT = sp.throttle;
    if (Math.abs(sp.bank) > Math.abs(maxBank)) {
      maxBank = sp.bank;
      bankS = s;
    }
  }
  check(mono, "throttle eases 0 -> 1 at cast-off and 1 -> 0 at the dock, never back", "monotonic");
  check(Math.abs(maxBank) <= T.shipBankMax + 1e-9 && Math.abs(maxBank) > 0.5, `the ship banks into the flight's turns, at most ${T.shipBankMax} deg`, `peak ${f2(maxBank)} deg, ${Math.round(bankS - sF)} units into the flight`);

  // Pure function of s: scrolled forward then back, the same ship.
  const a = { ...rail.shipAtS(sF + 700, sp) };
  rail.shipAtS(sL, sp);
  rail.shipAtS(sF + 700, sp);
  check(same(a, sp) && a.bank === sp.bank, "the ship is a pure function of route distance (scroll back, same ship)", `${f1(sp.x)}, ${f1(sp.y)}, ${f1(sp.z)} heading ${f1(sp.heading)}`);
}

// ── 4. Reversibility ──────────────────────────────────────────────────────────
console.log("\n=== REVERSIBILITY ===");
{
  const N = 100000;
  let mono = true;
  let minSlope = Infinity;
  let prev = rail.sOfDepth(0);
  let roundTrip = 0;
  for (let i = 1; i <= N; i++) {
    const d = i / N;
    const s = rail.sOfDepth(d);
    const slope = (s - prev) * N;
    if (!(s > prev)) mono = false;
    minSlope = Math.min(minSlope, slope);
    roundTrip = Math.max(roundTrip, Math.abs(rail.depthOfS(s) - d));
    prev = s;
  }
  check(mono, "depth -> route distance strictly increasing (scrolling back retraces the same path)", `min ${f1(minSlope)} units per depth`);
  check(roundTrip * rail.totalVh() < 0.1, "depth -> distance -> depth round trip within 0.1 vh", `${(roundTrip * rail.totalVh()).toFixed(3)} vh`);
  check(rail.sOfDepth(0) === 0 && Math.abs(rail.sOfDepth(1) - rail.length) < 1e-6, "depth 0 and 1 are the ends of the route", `${rail.sOfDepth(0)} / ${f1(rail.sOfDepth(1))}`);

  // The scene's glide: current += (target - current) * (1 - exp(-6 dt)). Scroll
  // from before the lip, through the dive, to the pool, then back.
  const SMOOTH = 6;
  const dt = 1 / 60;
  const start = rail.depthOfS(rail.stopS[1] + 0.5 * (rail.stopS[2] - rail.stopS[1]));
  const end = rail.stopDepth(2);
  let cur = start;
  const path = [];
  const step = (target, frames) => {
    for (let k = 0; k < frames; k++) {
      cur += (target - cur) * (1 - Math.exp(-SMOOTH * dt));
      path.push(cur);
    }
  };
  // A scroll-wheel feel: the target moves in 20 notches forward, then 20 back.
  for (let n = 1; n <= 20; n++) step(start + ((end - start) * n) / 20, 6);
  step(end, 240);
  const fwd = at(cur);
  for (let n = 19; n >= 0; n--) step(start + ((end - start) * n) / 20, 6);
  step(start, 480);
  const back = at(cur);
  const home = at(start);
  const dp = back.p.distanceTo(home.p);
  const dtg = back.t.distanceTo(home.t);
  check(dp < 0.01 && dtg < 0.01, "through the dive and back: the camera returns to its exact pose", `position off by ${dp.toExponential(1)}, target by ${dtg.toExponential(1)}`);
  const at1 = at(end);
  check(fwd.p.distanceTo(at1.p) < 0.01, "arriving at the pool from above gives the stop's own pose", fwd.p.distanceTo(at1.p).toExponential(1));
  // Reversal at the steepest point of the dive: the view is the same function of depth either way.
  let worstDiff = 0;
  for (let i = 0; i <= 200; i++) {
    const d = start + ((end - start) * i) / 200;
    const a = at(d);
    const b = at(d + 1e-9);
    worstDiff = Math.max(worstDiff, a.p.distanceTo(b.p));
  }
  check(worstDiff < 1e-3, "no hysteresis: pose is a pure function of depth", worstDiff.toExponential(1));
}

// ── 5. Budgets, retune, dwell ────────────────────────────────────────────────
console.log("\n=== SCROLL BUDGETS ===");
{
  // a8's stretch holds the flight, which has its own budget (FLIGHT_VH).
  const budgets = [...PLACES.map((p, i) => p.scrollVh + (i === 7 ? FLIGHT_VH : 0)), TAIL_VH];
  const total = budgets.reduce((a, b) => a + b, 0);
  const d = [0, ...PLACES.map((_, i) => rail.depthOfS(rail.stopS[i])), 1];
  const spent = budgets.map((_, k) => (d[k + 1] - d[k]) * total);
  const worst = Math.max(...spent.map((v, k) => Math.abs(v - budgets[k])));
  const flightSpent = (rail.depthOfS(rail.flightS[1]) - rail.depthOfS(rail.flightS[0])) * total;
  check(worst < 0.05 && Math.abs(flightSpent - FLIGHT_VH) < 0.05 && Math.abs(rail.totalVh() - total) < 1e-9, "every stretch spends its scrollVh, the flight its FLIGHT_VH (a8's stretch holds both)", `spent ${spent.map((v) => v.toFixed(1)).join(", ")} vh; flight ${flightSpent.toFixed(2)}; worst off ${worst.toExponential(1)}`);
  // The flight retunes on its own: the 10th value. a8 moves by the change,
  // the flight spends it, the path does not move.
  {
    const rf = createRail();
    rf.setPacing([...PLACES.map((p) => p.scrollVh), TAIL_VH, FLIGHT_VH + 100]);
    const fs = (rf.depthOfS(rf.flightS[1]) - rf.depthOfS(rf.flightS[0])) * rf.totalVh();
    const a8 = rf.stopDepth(7) * rf.totalVh();
    const a8Want = PLACES.reduce((a, p) => a + p.scrollVh, 0) + FLIGHT_VH + 100;
    check(Math.abs(fs - FLIGHT_VH - 100) < 0.05 && Math.abs(a8 - a8Want) < 0.05 && rf.pacing().length === 10, "setPacing's 10th value retunes the flight alone (a8 moves with it)", `flight ${fs.toFixed(2)} vh, a8 at ${a8.toFixed(1)} vh (want ${a8Want})`);
    // No speed step at the flight's two ends either.
    const gaps = rail.flightS.map((s) => {
      const g2 = Math.abs(rail.densityAtS(s - 2) / rail.densityAtS(s + 2) - 1);
      const g02 = Math.abs(rail.densityAtS(s - 0.2) / rail.densityAtS(s + 0.2) - 1);
      return { g2, shrink: g2 / Math.max(g02, 1e-12) };
    });
    check(gaps.every((g) => g.g2 < 1e-4 || g.shrink >= 8), "no speed step where the flight's budget starts and ends (gap shrinks >= 8x from +-2 to +-0.2)", gaps.map((g) => `${(g.g2 * 100).toFixed(2)}% ${f1(g.shrink)}x`).join(", "));
  }

  // Units travelled per 100vh of scroll, per stretch, and the dwell.
  const rows = [];
  const bounds = [0, ...rail.stopS, rail.length];
  for (let k = 0; k < budgets.length; k++) rows.push(Math.round(((bounds[k + 1] - bounds[k]) / budgets[k]) * 100));
  console.log(`  mean travel per 100vh, per stretch: ${rows.join(", ")} units`);
  const dwell = [];
  for (let i = 0; i < PLACES.length; i++) {
    const s = rail.stopS[i];
    const lo = i === 0 ? 0 : rail.stopS[i - 1];
    const mid = (lo + s) / 2;
    dwell.push(rail.densityAtS(s) / rail.densityAtS(mid));
  }
  check(dwell.every((r) => r > 1.4), "the camera slows into every stop (scroll per unit at the stop vs mid-stretch)", dwell.map(f2).join(", "));
  // Where the camera is moving fastest and slowest (units per vh).
  let fast = 0;
  let fastS = 0;
  for (let s = 0; s < rail.length; s += 4) {
    const v = 1 / rail.densityAtS(s);
    if (v > fast) {
      fast = v;
      fastS = s;
    }
  }
  console.log(`  fastest: ${f1(fast * 100)} units per 100vh at s ${fastS} (${rail.kindAtS(fastS)})`);
  const diveMid = rail.stopS[1] + 0.8 * (rail.stopS[2] - rail.stopS[1]);
  console.log(`  in the dive (s ${Math.round(diveMid)}): ${f1(100 / rail.densityAtS(diveMid))} units per 100vh`);

  // Retune live: double a3's budget. Path unchanged, a3's stretch now 560vh.
  const r2 = createRail();
  const p0 = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  const p1 = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  const a3Vh = PLACES[2].scrollVh;
  r2.setPacing(PLACES.map((p, i) => (i === 2 ? 2 * a3Vh : p.scrollVh)));
  let pathOff = 0;
  for (let s = 0; s < rail.length; s += 37) {
    rail.sampleS(s, p0);
    r2.sampleS(s, p1);
    pathOff = Math.max(pathOff, p0.position.distanceTo(p1.position) - 0); // same ground follow? r2 has none
  }
  const bare = createRail();
  pathOff = 0;
  for (let s = 0; s < rail.length; s += 37) {
    bare.sampleS(s, p0);
    r2.sampleS(s, p1);
    pathOff = Math.max(pathOff, p0.position.distanceTo(p1.position));
  }
  const spent3 = (r2.stopDepth(2) - r2.stopDepth(1)) * r2.totalVh();
  check(Math.abs(spent3 - 2 * a3Vh) < 0.05 && Math.abs(r2.totalVh() - (total + a3Vh)) < 1e-9 && pathOff < 1e-9, `setPacing retunes live: a3's stretch doubled to ${2 * a3Vh}vh, path unchanged`, `a3 stretch ${spent3.toFixed(2)} vh, total ${r2.totalVh()}, path moved ${pathOff}`);
  // Same proof as section 1: the speed gap across each stop shrinks ~10x
  // when the half-window does (a step would stay put).
  let worst2 = Infinity;
  const rows2 = [];
  for (let i = 0; i < PLACES.length; i++) {
    const s = r2.stopS[i];
    const g2 = Math.abs(r2.densityAtS(s - 2) / r2.densityAtS(s + 2) - 1);
    const g02 = Math.abs(r2.densityAtS(s - 0.2) / r2.densityAtS(s + 0.2) - 1);
    if (g2 > 1e-4) worst2 = Math.min(worst2, g2 / Math.max(g02, 1e-12));
    rows2.push(`${PLACES[i].id} ${(g2 * 100).toFixed(2)}%`);
  }
  check(worst2 >= 8, "after the retune, still no speed step at any stop (gap shrinks >= 8x from +-2 to +-0.2)", `${f1(worst2)}x; gaps at +-2: ${rows2.join(", ")}`);
}

// ── 6. Allocation ────────────────────────────────────────────────────────────
console.log("\n=== ALLOCATION ===");
{
  const out = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  for (let i = 0; i < 200000; i++) rail.sample((i % 1000) / 1000, out); // warm up
  // Count garbage collections during 3M samples, called from one hot function
  // so V8 can inline the call (a double passed into a call it does not inline
  // is boxed at the CALL SITE, which would count the caller, not the rail).
  // One boxed double per sample would be 48 MB and ~24 scavenges here; the
  // baseline (the same loop with no rail call) is 0-1.
  const { PerformanceObserver } = await import("node:perf_hooks");
  const depths = new Float64Array(9973);
  for (let i = 0; i < depths.length; i++) depths[i] = i / depths.length;
  function hot(r, d, o, n) {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      r.sample(d[i % 9973], o);
      acc += o.position.x;
    }
    return acc;
  }
  for (let k = 0; k < 5; k++) hot(rail, depths, out, 200000);
  let gcs = 0;
  const obs = new PerformanceObserver((list) => {
    gcs += list.getEntries().length;
  });
  obs.observe({ entryTypes: ["gc"] });
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, 50));
  gcs = 0;
  const t0 = performance.now();
  hot(rail, depths, out, 3000000);
  const ms = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  check(gcs <= 2, "3M samples: no more garbage collections than an empty loop (nothing allocated per sample)", `${gcs} GCs, ${((ms / 3e6) * 1e6).toFixed(0)} ns per sample`);

  // The ship, read every frame by blocks.ts through ctx.shipPose.
  const sp = { x: 0, y: 0, z: 0, heading: 0, bank: 0, throttle: 0, phase: "moored" };
  const ss = new Float64Array(9973);
  for (let i = 0; i < ss.length; i++) ss[i] = rail.flightS[0] - 100 + ((rail.flightS[1] - rail.flightS[0] + 250) * i) / ss.length;
  function hotShip(r, sArr, o, n) {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      r.shipAtS(sArr[i % 9973], o);
      acc += o.x;
    }
    return acc;
  }
  function hotEmpty(r, sArr, o, n) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += sArr[i % 9973] + o.x;
    return acc;
  }
  // GCs over 1M calls, measured three times; the least is what the call costs
  // (a per-call allocation of even one boxed double is 16 MB, ~16 scavenges,
  // every time; stray collections from the rest of this file are not).
  const gcsOf = async (fn) => {
    let best = Infinity;
    let ms = 0;
    for (let rep = 0; rep < 3; rep++) {
      for (let k = 0; k < 3; k++) fn(rail, ss, sp, 200000);
      let n = 0;
      const obs2 = new PerformanceObserver((list) => {
        n += list.getEntries().length;
      });
      obs2.observe({ entryTypes: ["gc"] });
      if (global.gc) global.gc();
      await new Promise((r) => setTimeout(r, 50));
      n = 0;
      const t1 = performance.now();
      fn(rail, ss, sp, 1000000);
      ms = performance.now() - t1;
      await new Promise((r) => setTimeout(r, 50));
      obs2.disconnect();
      best = Math.min(best, n);
    }
    return { gcs: best, ms };
  };
  const base = await gcsOf(hotEmpty);
  const shipRun = await gcsOf(hotShip);
  check(shipRun.gcs <= base.gcs + 2, "1M shipAtS calls: no more garbage collections than an empty loop (nothing allocated per call)", `${shipRun.gcs} GCs (empty loop ${base.gcs}), ${((shipRun.ms / 1e6) * 1e6).toFixed(0)} ns per call`);
}

console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join("; ")}` : "\nALL PASS");
process.exit(failures.length ? 1 : 0);
