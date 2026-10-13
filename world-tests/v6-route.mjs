/**
 * V4 route check, grey pass 3: layout.ts + terrain.ts, measured, drawn and previewed.
 *
 *   node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-route.mjs [--no-shots]
 *
 * Checks (the route is built with a centripetal Catmull-Rom through TRAIL and
 * another through LOOK at the same curve parameter, as the rail builds it;
 * scroll figures use the rail itself, rail.ts createRail):
 *   - v6: clearance by kind: walk/hike/rise/sky >= TRAIL_CLEAR over the ground
 *     (35, or 20 at and beside a stop and at the opening; islands count as
 *     ground); the ride and the turn (dive) >= 15 from any rock and >= 8 from
 *     the curtain; the gully (climb) is placed by hand; the
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
 *   - 2026-10-13, a3 TO a4 IN THE OPEN (Lovro: "the camera between Video Ads 1
 *     and Video Ads 2 goes into the cave for no reason. Just going straight
 *     from Video Ads 1 screen to Video Ads 2 and giving it a nice path"):
 *     along the a3 -> a4 move the clearance from rock, the view turning one
 *     way only (about 117 degrees, no step or scroll rate over its limit),
 *     the falls in the frame at every key and every sample, sky in every
 *     frame and no ground close up;
 *   - 2026-10-13, NO CAVE (decision 66: the cave behind the falls is gone
 *     from the world, and the mine's checks of grey pass 3 with it): no key
 *     of a kind the layout does not pace, the old marks retired, no sample of
 *     the route under the terrain's surface, the camera never through the
 *     falling water; the trail on the ground starts again on the pool's shore
 *     and reaches the log over the gorge's floor, never at a rock wall;
 *   - the scenery is pinned to places (decision 66): see the last section;
 *   - grey pass 3 leftovers: the flight takes 200-300 vh; the star look has
 *     the observatory in the lower part of the frame; the Great Tree is whole
 *     in frame at a6.
 * Writes, to world-tests/shots/v6/route/: map.svg/png (top down),
 * profile.svg/png (height along the route), views.png (ray-marched grey
 * previews of the stops and the key moments) and report.json.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import * as L from "../src/lib/world-v6/layout.ts";
import { terrainHeight } from "../src/lib/world-v6/terrain.ts";
import { createRail } from "../src/lib/world-v6/rail.ts";
import { railGround } from "../src/lib/world-v6/scene.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v6/route");
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = !process.argv.includes("--no-shots");
// v6: the Gate isle replaces the Harbour Isle (the checks below still say "harbour" for it).
const { WORLD, PLACES, TRAIL, LOOK, TRAIL_KIND, PATH, STEPS, ISLAND_DEPTH, BOUNTY_DEPTH, GATE_DEPTH: HARBOUR_DEPTH } = L;
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
// v6: the rail as the scene has it, with terrain follow (TRAIL_CLEAR), for the
// clearance check only: every other check reads distances along the bare curve.
const railG = createRail();
railG.setGround(railGround);
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
    // Within 4 units (twice the rail's table step) of a change of kind the two
    // may round differently: the rail reads its key parameter off its own
    // re-tabulated curve (v6: the a4 stop, a walk key between hike keys).
    let nearChange = false;
    for (let q = i - 1; q >= 0 && d.s - dense[q].s <= 4 && !nearChange; q--) if (dense[q].kind !== d.kind) nearChange = true;
    for (let q = i + 1; q < dense.length && dense[q].s - d.s <= 4 && !nearChange; q++) if (dense[q].kind !== d.kind) nearChange = true;
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
const H = WORLD.gateIsle;
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
// Round 1 (decision 46): the cloud bank north of the Sky Island (dress-sky
// GATE_BANK) hides the Gate isle until the flight, instead of the view looking
// up. Read from dress-sky itself (rocks first: dress-sky -> rocks -> dress-gate
// -> dress-sky is a cycle that only resolves in that order), as a solid band:
// x0..x1, depth across z, from its base up to gateBankTop(x) less 10 for the
// clusters' lumpy crown; drawn only while the camera is above showAbove.
const SKY = await import("../src/lib/world-v6/rocks.ts").then(() => import("../src/lib/world-v6/dress-sky.ts")).catch(() => null);
const GB = SKY && SKY.GATE_BANK;
const inBank = (x, y, z) => !!GB && x >= GB.x0 && x <= GB.x1 && Math.abs(z - GB.z) <= GB.depth / 2 && y >= GB.base && y <= SKY.gateBankTop(x) - 10;
/** 0 = clear, 1 = terrain, 2 = cloud layer (only if terrain did not block), 3 = another island, 4 = the Gate's cloud bank (with `bank`). */
function rayBlock(o, p, isles = false, bank = false) {
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
    if (bank && o.y > GB.showAbove && inBank(x, y, z)) return 4;
    if ((prevY - WORLD.cloudLevel) * (y - WORLD.cloudLevel) <= 0 && inCloudAt(x, z)) cloud = true;
    prevY = y;
  }
  return cloud ? 2 : 0;
}
function camOf(p, q, aspect = ASPECT, fov = FOV) {
  const cam = new THREE.PerspectiveCamera(fov, aspect, 1, 30000);
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
      // v6: and clear of the curtain it rides down in front of.
      // (Over the lip the water is below the camera: the lip's rule is height.)
      if (y <= WORLD.falls.top[1] - 5 && y >= WORLD.falls.bottom[1]) {
        const [cx, cz] = L.fallsCurtainAt(y);
        const off = Math.abs(x - cx) - WORLD.falls.width / 2;
        note("curtain", off > 0 ? Math.hypot(off, z - cz) : Math.abs(z - cz), d);
      }
    } else if (d.kind === "bridge") {
      const u = ((x - bA[0]) * (bB[0] - bA[0]) + (z - bA[2]) * (bB[2] - bA[2])) / bLen2;
      const side = Math.abs((x - bA[0]) * (bB[2] - bA[2]) - (z - bA[2]) * (bB[0] - bA[0])) / Math.sqrt(bLen2);
      bridgeSide = Math.max(bridgeSide, side);
      if (u >= 0 && u <= 1) bridgeEyeErr = Math.max(bridgeEyeErr, Math.abs(y - L.bridgeDeckAt(u) - L.BRIDGE_EYE));
    } else if (d.kind === "flight") {
      note("flight", y - terrainHeight(x, z), d);
    } else if (d.kind === "board") {
      note("board", y - groundAt(x, z), d);
    } else if (d.kind === "climb") {
      note("climb", y - groundAt(x, z), d);
    } else {
      // v6: the clearance the rail keeps here (TRAIL_CLEAR, linear between keys).
      const f = d.t * (nK - 1);
      const i0 = Math.min(nK - 2, Math.floor(f));
      const need = L.TRAIL_CLEAR[i0] + (L.TRAIL_CLEAR[i0 + 1] - L.TRAIL_CLEAR[i0]) * (f - i0);
      note("walk", y - groundAt(x, z) - need, d, { kind: d.kind, need: r1(need) });
    }
  }
  report.clearance = worst;
  const keys = TRAIL.map((p, i) => ({ i, kind: TRAIL_KIND[i], above: Math.round(p[1] - groundAt(p[0], p[2])), need: L.TRAIL_CLEAR[i] }));
  const badKeys = keys.filter((k) => ["walk", "trail", "hike", "rise", "sky"].includes(k.kind) && k.above < k.need);
  check("key clearance >= TRAIL_CLEAR (35, or 20 at and beside the stops; walk, trail, hike, rise, sky keys; islands count as ground)", badKeys.length === 0, badKeys.length ? badKeys : "ok");
  // The dense check reads the RAIL's height (terrain follow lifts the curve to
  // the clearance); the bare curve may dip between keys.
  {
    let worstRail = { v: Infinity };
    for (let s = 0; s <= railG.length; s += 4) {
      const k = railG.kindAtS(s);
      if (!["walk", "trail", "hike", "rise", "sky"].includes(k)) continue;
      railG.sampleS(s, pose);
      const { x, y, z } = pose.position;
      const f = railG.tAtS(s) * (nK - 1);
      const i0 = Math.min(nK - 2, Math.floor(f));
      const need = L.TRAIL_CLEAR[i0] + (L.TRAIL_CLEAR[i0 + 1] - L.TRAIL_CLEAR[i0]) * (f - i0);
      const v = y - groundAt(x, z) - need;
      if (v < worstRail.v) worstRail = { v: r1(v), s: Math.round(s), kind: k, p: [x, y, z].map(Math.round), need: r1(need) };
    }
    report.railClearance = worstRail;
    check("rail clearance >= TRAIL_CLEAR - 1 (dense, as the rail lifts it: walk, trail, hike, rise, sky)", worstRail.v >= -1, worstRail);
  }
  report.curveClearance = worst.walk;
  check("the ride and the turn stay >= 15 from any rock (dense)", worst.dive.v >= 15, worst.dive);
  check("the ride stays >= 8 from the curtain (dense)", !worst.curtain || worst.curtain.v >= 8, worst.curtain ?? "never beside it");
  check("the gully (climb): >= 15 over its floor (dense)", !worst.climb || worst.climb.v >= 15, worst.climb ?? "none");
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
  // v6: at the lip the camera looks down into the gorge the water pours into.
  const fallsWall = (x, y, z) => z < WORLD.falls.top[2] + 10;
  const rimAll = Math.round(100 * nearGroundShare(v3(TRAIL[rimKey]), v3(LOOK[rimKey])));
  const rimOther = Math.round(100 * nearGroundShare(v3(TRAIL[rimKey]), v3(LOOK[rimKey]), 600, 18, 32, fallsWall));
  report.nearGround = { walk: rows, rim: { key: rimKey, all: rimAll, notFallsWall: rimOther } };
  console.log(`\nN1 near ground (< 600 away) share of frame, walk keys a1..rim-1: ${rows.map((r) => `${r.key}:${r.share}%`).join(" ")}; rim key ${rimKey}: ${rimAll}% (${rimOther}% not the falls' cliff)`);
  const worst = rows.reduce((a, b) => (b.share > a.share ? b : a));
  check("N1: shore -> camp -> rim, near ground <= 45% of every walk key's frame", worst.share <= 45, `worst key ${worst.key} at ${worst.share}%`);
  check("N1: at the rim, near ground other than the falls' cliff <= 45% of the frame", rimOther <= 45, `${rimOther}% (all near ground ${rimAll}%, the rest is the cliff the falls pour down)`);
}

// ── N2 (v6, round 1): the ride down the falls and the turn at the pool ─────
{
  // Named rows (layout ROUTE_MARKS), never raw key indices.
  const s0 = sAtKey(L.ROUTE_MARKS.lip); // the lip
  const sLevel = sAtKey(L.ROUTE_MARKS.pool); // level over the pool
  const sTurn = sAtKey(PLACES[2].trail); // a3, outside, facing the falls
  let peak = -Infinity;
  for (let s = s0; s <= sLevel; s += 2) peak = Math.max(peak, rail.pitchAtS(s));
  // Round 1 (Lovro, decision 46): straight over the lip heading north and down
  // with the water, looking down the falls with no yaw: the bearing stays
  // within 20 of north from the lip to the pool (never circling the top,
  // never facing the falls). Then the turn round to face them.
  let faceBack = true;
  for (let s = s0; s <= sLevel - 20; s += 4) {
    const b = ((rail.bearingAtS(s) % 360) + 360) % 360;
    if (!(b <= 20 || b >= 340)) faceBack = false;
  }
  // The approach: from the stream's woods to the lip the view holds within 15
  // of north (v6 swung 342 -> 28 -> 52 -> 25 round the top of the falls).
  let approachSpan = 0;
  {
    let lo = Infinity;
    let hi = -Infinity;
    for (let s = sAtKey(L.ROUTE_MARKS.stream); s <= s0; s += 4) {
      const b = rail.bearingAtS(s);
      lo = Math.min(lo, b);
      hi = Math.max(hi, b);
    }
    approachSpan = hi - lo;
  }
  check("the approach to the lip: the view swings <= 15 degrees (no circling round the top of the falls)", approachSpan <= 15, `${r1(approachSpan)} degrees`);
  const endB = rail.bearingAtS(sTurn);
  const a3Key = PLACES[2].trail;
  const toFalls = (Math.atan2(WORLD.falls.top[0] - TRAIL[a3Key][0], -(WORLD.falls.bottom[2] - TRAIL[a3Key][2])) * 180) / Math.PI;
  const offFalls = Math.abs((((endB - toFalls) % 360) + 540) % 360 - 180);
  let maxRate = 0;
  let maxAt = 0;
  const ds = 3;
  for (let s = s0 - 200; s <= sTurn; s += ds) {
    const dv = vhAt(rail, s + ds) - vhAt(rail, s);
    const rate = Math.abs(rail.pitchAtS(s + ds) - rail.pitchAtS(s)) / Math.max(1e-6, dv);
    if (rate > maxRate) {
      maxRate = rate;
      maxAt = s;
    }
  }
  const rideVh = vhAt(rail, sLevel) - vhAt(rail, s0);
  const turnVh = vhAt(rail, sTurn) - vhAt(rail, sLevel);
  // How much of the turn only sees rock: rays toward the frame's centre row
  // that hit terrain within 150.
  let rockVh = 0;
  for (let s = sLevel; s < sTurn; s += 3) {
    rail.sampleS(s, pose);
    const d = pose.target.clone().sub(pose.position).normalize();
    let near = true;
    for (const sideA of [-0.35, 0, 0.35]) {
      const dd = d.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), sideA).normalize();
      let hit = false;
      for (let t = 4; t <= 150 && !hit; t += 5) if (pose.position.y + dd.y * t <= terrainHeight(pose.position.x + dd.x * t, pose.position.z + dd.z * t)) hit = true;
      if (!hit) near = false;
    }
    if (near) rockVh += vhAt(rail, s + 3) - vhAt(rail, s);
  }
  report.ride = { peakPitch: r1(peak), rideVh: r1(rideVh), turnVh: r1(turnVh), rockVh: r1(rockVh), endBearing: r1(endB), maxPitchRate: +maxRate.toFixed(2), maxRateAt: Math.round(maxAt) };
  console.log(`ride: peak pitch ${r1(peak)}, lip -> level ${r1(rideVh)} vh; the turn ${r1(turnVh)} vh (${r1(rockVh)} vh only rock), ends facing ${r1(endB)}; fastest pitch change ${maxRate.toFixed(2)} deg/vh`);
  check("the ride: looks down along the water (pitch peaks 65-80), heading north with no yaw as it falls (bearing within 20 of north, never facing the falls)", peak >= 65 && peak <= 80 && faceBack, `peak ${r1(peak)}, bearing within 20 of north ${faceBack}`);
  check("the ride: lip to level over the pool takes 100-200 vh at the default pacing", rideVh >= 100 && rideVh <= 200, `${r1(rideVh)} vh`);
  check("the turn at the pool to a3: <= 90 vh, <= 20 vh of it only rock, ending facing the falls (within 25 of the bearing to them: final pass, the falls sit right of centre with the gorge on the panel's side)", turnVh <= 90 && rockVh <= 20 && offFalls <= 25, `${r1(turnVh)} vh, rock ${r1(rockVh)} vh, bearing ${r1(endB)} (${r1(offFalls)} off the falls)`);
  check("the ride: pitch changes <= 2.5 deg per vh (lip to the falls)", maxRate <= 2.5, `max ${maxRate.toFixed(2)} deg/vh at s ${Math.round(maxAt)}`);
  // Round 1: the cave exit to a4, and a4 to the burst, each one move.
  // 2026-10-13: there is no cave exit; the way up starts at the a3 stop.
  const a3S = sAtKey(PLACES[2].trail);
  const a4S = sAtKey(PLACES[3].trail);
  const burstS = sAtKey(L.ROUTE_MARKS.burst);
  const upVh = vhAt(rail, a4S) - vhAt(rail, a3S);
  const hikeVh = vhAt(rail, burstS) - vhAt(rail, a4S);
  report.hikeVh = r1(hikeVh);
  report.upVh = r1(upVh);
  // Decision 67: a3 to a4 is the walk along the trail, 1,546 units with 400 degrees of turning: 280 vh (Version W, 120 degrees: 200).
  check("the way up: a3 to a4 <= 300 vh, a4 to the burst <= 200 vh at the default pacing", upVh <= 300 && hikeVh <= 200, `${r1(upVh)} vh / ${r1(hikeVh)} vh`);
  // Facing where it goes after a4: from just past a4 to the burst, the view
  // stays within 60 of the travel heading.
  const offTravel = (sa, sb) => {
    let worst = { v: 0 };
    for (let s = sa; s <= sb; s += 4) {
      const d = Math.abs((((rail.bearingAtS(s) - rail.headingAtS(s)) % 360) + 540) % 360 - 180);
      if (d > worst.v) worst = { v: r1(d), s: Math.round(s) };
    }
    return worst;
  };
  const w2 = offTravel(sAtKey(L.ROUTE_MARKS.traverse + 0.5), burstS);
  check("the traverse faces where it goes (view within 60 of the travel heading, a4 to the burst)", w2.v <= 60, `traverse to burst ${JSON.stringify(w2)}`);
  // Decision 67, 2026-10-13 (Lovro: "we have the path but we don't take it
  // and go in the air"): a3 to a4 TAKES THE TRAIL on the ground, facing
  // forward: down from the stop to the pool's east shore, over the log, the
  // talus fan, up the north wall, along the bench past the Trail Hut, and a
  // turn at the bench's end to the hut and the falls. It replaces the flight
  // across the gorge (decision 65), whose checks stood here: the view one way
  // only, <= 1.4 degrees per vh, the falls in every frame.
  {
    const F = WORLD.falls;
    const sa = rail.stopS[2];
    const sb = rail.stopS[3];
    const a3Key = PLACES[2].trail;
    const a4Key = PLACES[3].trail;
    /** Route distance on the rail at a (fractional) key index. */
    const railSAt = (k) => {
      let lo = 0;
      let hi = rail.length;
      for (let i = 0; i < 60; i++) {
        const m = (lo + hi) / 2;
        if (rail.tAtS(m) < k / (nK - 1)) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    };
    // 1. No cave on the route (2026-10-13: nor in the world, so "cave" is not
    //    a kind any more: every key is of a kind the layout paces).
    const unknownKinds = [...new Set(TRAIL_KIND.filter((k) => !(k in L.PACE)))];
    const oldMarks = ["cave", "camp", "exit", "back"].filter((m) => m in L.ROUTE_MARKS);
    check(
      "no cave on the route: every key of a kind the layout paces (no cave key), the marks cave / camp / exit / back retired",
      unknownKinds.length === 0 && oldMarks.length === 0,
      `kinds the layout does not pace: ${unknownKinds.join(", ") || "none"}; old marks still named: ${oldMarks.join(", ") || "none"}`,
    );
    // 2. Fifteen rows, of the kind forest.ts does not cap its trees for. The
    //    forest samples the whole route 3,600 times by key number (so a row
    //    more or fewer moves its samples everywhere) and cuts every tree within
    //    70 of a "walk" or "hike" key down to the camera's height: both would
    //    change trees, and forest.ts was not to be touched.
    const between = TRAIL_KIND.slice(a3Key + 1, a4Key);
    check(
      "a3 to a4: fifteen rows, all of the kind \"trail\" (the forest keeps every tree: it samples the route by key number and cuts trees along walk and hike keys)",
      between.length === 15 && between.every((k) => k === "trail") && TRAIL.length === 85,
      `${between.length} rows (${[...new Set(between)].join(", ")}), ${TRAIL.length} keys in all`,
    );
    // 3. On the trail. The visible trail is PATH where surfaces.ts paints it
    //    (both ends of a segment within 25 of the ground), from the pool's
    //    shore to the traverse's first leg past the bench. The camera comes down onto it at the
    //    shore and stays within 12 of it past the fan's top (x 200), 36 to 60
    //    over the ground as far as the fan (x 150; from there it lifts for the
    //    wall); leaves it up the wall (the two lower switchback legs hang off
    //    the heightfield, unpainted); is back within 12 of it over the bench;
    //    and stays within 27 to the stop, which stands 21 off it (it rounds the
    //    boulder family at the wall's foot east of the hut by the bench's outer
    //    edge). The rail with terrain follow has its own distances: its stops.
    {
      const iShore = PATH.findIndex((q) => q.under) + 1;
      const iEnd = PATH.findIndex((q) => Math.abs(q.x - 900) < 1 && Math.abs(q.z - 1090) < 1); // the traverse's first leg: the a4 stop stands beside it
      const painted = (i) => Math.abs(PATH[i].y - terrainHeight(PATH[i].x, PATH[i].z)) <= 25 && Math.abs(PATH[i + 1].y - terrainHeight(PATH[i + 1].x, PATH[i + 1].z)) <= 25;
      const strip = [];
      for (let i = iShore; i < iEnd; i++) if (painted(i)) strip.push([PATH[i], PATH[i + 1]]);
      /** Distance in plan to the painted strip. */
      const trailD = (x, z) => {
        let best = Infinity;
        for (const [a, b] of strip) {
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const u = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
          best = Math.min(best, Math.hypot(x - a.x - dx * u, z - a.z - dz * u));
        }
        return best;
      };
      let phase = 0; // 0 coming down to the shore, 1 on the floor's strip, 2 up the wall, 3 on the bench
      let on = null;
      let left = null;
      let back = null;
      let wall = { v: 0 };
      let bench = { v: 0 };
      const high = [Infinity, -Infinity];
      const ga = railG.stopS[2];
      const gb = railG.stopS[3];
      for (let s = ga; s <= gb; s += 3) {
        railG.sampleS(s, pose);
        const { x, y, z } = pose.position;
        const d = trailD(x, z);
        const at = { s: Math.round(s - ga), p: [x, y, z].map(Math.round) };
        const g = groundAt(x, z);
        if (phase === 0 && d <= 12) {
          phase = 1;
          on = at;
        }
        if (phase === 1) {
          if (d <= 12) {
            if (x <= 150) {
              high[0] = Math.min(high[0], y - g);
              high[1] = Math.max(high[1], y - g);
            }
            continue;
          }
          phase = 2;
          left = at;
        }
        if (phase === 2) {
          if (!(g > 295 && d <= 12)) {
            if (d > wall.v) wall = { v: r1(d), ...at };
            continue;
          }
          phase = 3;
          back = at;
        }
        if (phase === 3 && d > bench.v) bench = { v: r1(d), ...at };
      }
      report.a3a4Trail = { strip: strip.map(([a, b]) => [a.x, a.z, b.x, b.z]), on, left, back, wall, bench, high: high.map(Math.round) };
      check(
        "a3 to a4: on the trail (within 12 of the painted strip from the pool's shore to past the fan's top, 36 to 60 over the ground as far as the fan; off it only up the wall, for less than 340 units; back on it over the bench and within 27 to the stop)",
        phase === 3 && on.p[0] <= 20 && left.p[0] >= 200 && back.s - left.s < 340 && bench.v <= 27 && high[0] >= 36 && high[1] <= 60,
        `on the strip ${JSON.stringify(on)}; leaves it ${JSON.stringify(left)}; furthest from it up the wall ${JSON.stringify(wall)}; back on it ${JSON.stringify(back)} (${back && left ? back.s - left.s : "?"} units off it); furthest from it on the bench ${JSON.stringify(bench)}; ${Math.round(high[0])} to ${Math.round(high[1])} over the ground from the shore to the fan`,
      );
    }
    // 4. Clearance, on the rail as the scene has it (terrain follow on): over
    //    the ground by TRAIL_CLEAR all the way (the dense check above covers
    //    it; the figure is repeated here), and never nearer than 30 to ground
    //    that stands higher than the camera (the wall under the bench, on the
    //    way up: 40). This reads the heightfield only: the boulders, the hut,
    //    the posts and the trees are judged on the rendered frames.
    {
      let over = { v: Infinity };
      let rock = { v: Infinity };
      const ga = railG.stopS[2];
      for (let s = ga; s <= railG.stopS[3]; s += 3) {
        railG.sampleS(s, pose);
        const { x, y, z } = pose.position;
        const at = { s: Math.round(s - ga), p: [x, y, z].map(Math.round) };
        const f = railG.tAtS(s) * (nK - 1);
        const i0 = Math.min(nK - 2, Math.floor(f));
        const need = L.TRAIL_CLEAR[i0] + (L.TRAIL_CLEAR[i0 + 1] - L.TRAIL_CLEAR[i0]) * (f - i0);
        const o = y - groundAt(x, z) - need;
        if (o < over.v) over = { v: r1(o), need: r1(need), ...at };
        const c = cliffDistance(x, y, z, 60);
        if (c < rock.v) rock = { v: c, ...at };
      }
      report.a3a4Clear = { over, rock };
      check("a3 to a4: clear all the way (>= TRAIL_CLEAR - 1 over the ground, >= 30 from any ground higher than the camera)", over.v >= -1 && rock.v >= 30, `least over the ground ${JSON.stringify(over)}, nearest rock ${JSON.stringify(rock)}`);
    }
    // 5 and 6 judge the VIEW, and there are two views for this walk (decision
    //    67): Version F, facing forward, is in the layout; Version W, watching
    //    the falls, is a paste-ready block in the decision log with the same
    //    positions. The test tells them apart by how much the view turns (F
    //    about 400 degrees, W about 123) and holds each to its own rules, so
    //    switching is a paste and a test run. Anything in between fails both.
    let total = 0;
    let against = 0;
    let peak = -Infinity;
    let step = { v: 0 };
    let fastest = { v: 0 };
    {
      let prev = rail.bearingAtS(sa);
      for (let s = sa + 2; s <= sb; s += 2) {
        const b = rail.bearingAtS(s);
        const d = ((b - prev + 540) % 360) - 180;
        prev = b;
        total += Math.abs(d);
        if (s <= sb - 90) against = Math.max(against, -d);
        peak = Math.max(peak, b);
        if (Math.abs(d) > step.v) step = { v: +Math.abs(d).toFixed(2), s: Math.round(s - sa) };
        const dv = vhAt(rail, s) - vhAt(rail, s - 2);
        if (s - sa > 60 && sb - s > 60 && dv > 1e-6 && Math.abs(d) / dv > fastest.v) fastest = { v: +(Math.abs(d) / dv).toFixed(2), s: Math.round(s - sa), vh: r1(vhAt(rail, s)) };
      }
    }
    const version = total > 250 ? "F" : "W";
    report.a3a4 = { version, total: r1(total), step, fastest, against: +against.toFixed(3), settle: r1(peak - rail.bearingAtS(sb)) };
    // The falls in the frame: their middle, on the rail's own pose and lens.
    const mid = (F.top[1] + F.bottom[1]) / 2;
    const [mx, mz] = L.fallsCurtainAt(mid);
    const inFrame = (s) => {
      rail.sampleS(s, pose);
      const v = proj(camOf(pose.position.clone(), pose.target.clone(), 1691 / 1278, rail.fovAtS(s)), mx, mid, mz);
      return v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
    };
    // At a4 the falls are whole, lip to pool, their middle at x 0.4 to 0.6 and
    // the pool on the frame's bottom, as the stop has framed them since B9.
    const atA4 = (() => {
      rail.sampleS(sb, pose);
      const cam = camOf(pose.position.clone(), pose.target.clone(), ASPECT, rail.fovAtS(sb));
      const xy = (x, y, z) => {
        const v = proj(cam, x, y, z);
        return v.z < 1 ? [(v.x + 1) / 2, (1 - v.y) / 2] : null;
      };
      const m = xy(mx, mid, mz);
      const lip = xy(F.top[0], F.top[1], F.top[2]);
      const foot = xy(F.bottom[0], F.bottom[1], F.bottom[2]);
      return { whole: !!(m && lip && foot && m[0] >= 0.4 && m[0] <= 0.6 && lip[1] >= 0.03 && foot[1] <= 1), mid: m && m.map((v) => +v.toFixed(2)), lipY: lip && +lip[1].toFixed(2), footY: foot && +foot[1].toFixed(2) };
    })();
    // The stops stand and aim as they did. The rail blurs a stop's view with
    // its neighbours' and lifts the camera over the ground through a 70 unit
    // window, so the rows either side of a stop move it: with the flight
    // (commit 9c03225) a3 stood on its key aimed 126.2 / -11.8, and a4 stood
    // 1.6 over its key (325.6: the flight came in 24 over the bench) aimed
    // 239.8 / -7.9. The walk's first and last rows are set to give that back:
    // within 0.5 of a degree and 0.5 of a unit.
    {
      const stop = (s) => {
        railG.sampleS(s, pose);
        return [railG.bearingAtS(s), railG.pitchAtS(s), pose.position.y];
      };
      const [b3, p3, y3] = stop(railG.stopS[2]);
      const [b4, p4, y4] = stop(railG.stopS[3]);
      report.a3a4Stops = { a3: [+b3.toFixed(2), +p3.toFixed(2), +y3.toFixed(2)], a4: [+b4.toFixed(2), +p4.toFixed(2), +y4.toFixed(2)] };
      check(
        "a3 to a4: both stops stand and aim as they did before the walk (a3 at y 130.0 aimed 126.2 / -11.8, a4 at y 325.6 aimed 239.8 / -7.9; within 0.5)",
        Math.abs(b3 - 126.2) <= 0.5 && Math.abs(p3 + 11.8) <= 0.5 && Math.abs(y3 - 130) <= 0.5 && Math.abs(b4 - 239.8) <= 0.5 && Math.abs(p4 + 7.9) <= 0.5 && Math.abs(y4 - 325.6) <= 0.5,
        `a3 y ${y3.toFixed(2)} aimed ${b3.toFixed(2)} / ${p3.toFixed(2)}, a4 y ${y4.toFixed(2)} aimed ${b4.toFixed(2)} / ${p4.toFixed(2)}`,
      );
    }
    if (version === "F") {
      // 5F. The turns: three, and slow. In all under 410 degrees (left 135 down
      //     over the pool and onto the log, right 80 over the fan and up the
      //     wall, right 165 at the bench's end: the reveal; the rest is the two
      //     stops' own settling). No step of 2 units turns more than 2.4
      //     degrees (the reveal is nearly a turn on the spot, walked at a
      //     crawl), and 60 clear of the stops the view never turns faster than
      //     2.7 degrees per vh at the default pacing (it measures 2.6 in the
      //     reveal and 2.5 at the log and on the fan: the three turns are paced
      //     alike, which is what Q's paces on the rows are for).
      check("a3 to a4 (F, facing forward): the turns are few and slow (under 410 degrees in all, no step of 2 units over 2.4 degrees, <= 2.7 degrees per vh 60 clear of the stops)", total < 410 && step.v <= 2.4 && fastest.v <= 2.7, `${r1(total)} degrees in all; largest step ${JSON.stringify(step)}; fastest ${JSON.stringify(fastest)}`);
      // 6F. Facing forward, then the reveal. From the pool's shore to the Trail
      //     Hut the view stays within 50 degrees of the way the camera travels
      //     (it leads into each corner). The falls are behind it from the log
      //     on: their middle is out of the frame until the turn at the bench's
      //     end brings it in, for good, 60 to 200 units before a4.
      const sShore = railSAt(L.ROUTE_MARKS.crossing - 1);
      const sHut = railSAt(L.ROUTE_MARKS.wall + 1);
      let off = { v: 0 };
      for (let s = sShore; s <= sHut; s += 4) {
        const d = Math.abs((((rail.bearingAtS(s) - rail.headingAtS(s)) % 360) + 540) % 360 - 180);
        if (d > off.v) off = { v: r1(d), s: Math.round(s - sa) };
      }
      let hidden = true;
      for (let s = railSAt(L.ROUTE_MARKS.crossing); s <= sHut; s += 6) if (inFrame(s)) hidden = false;
      let sReveal = sb;
      while (sReveal - 2 > sHut && inFrame(sReveal - 2)) sReveal -= 2;
      report.a3a4View = { off, hidden, revealUnits: Math.round(sb - sReveal), revealVh: r1(vhAt(rail, sb) - vhAt(rail, sReveal)), a4: atA4 };
      check(
        "a3 to a4 (F): facing forward (view within 50 degrees of the travel heading from the pool's shore to the Trail Hut), the falls out of the frame from the log to the hut, revealed 60 to 200 units before a4 and whole in the a4 frame (middle at x 0.4-0.6, lip to pool)",
        off.v <= 50 && hidden && sb - sReveal >= 60 && sb - sReveal <= 200 && atA4.whole,
        `furthest off the heading ${JSON.stringify(off)}; the falls ${hidden ? "stay out of the frame" : "show"} from the log to the hut; in the frame for the last ${Math.round(sb - sReveal)} units (${r1(vhAt(rail, sb) - vhAt(rail, sReveal))} vh); at a4 (16:9) ${JSON.stringify(atA4)}`,
      );
    } else {
      // 5W. One way only: every key's bearing above the last, and on the rail
      //     the view never goes back by more than 0.05 degrees until 90 units
      //     before a4, where the stop's own settle (the traverse turns left at
      //     once, and the rail's blur lets that in) stays under 6. In all under
      //     130 degrees, no step of 2 units over 1 degree, <= 2.4 per vh.
      let keysRise = true;
      for (let k = a3Key; k < a4Key; k++) if (!(L.TRAIL_VIEW[k + 1].bearing > L.TRAIL_VIEW[k].bearing)) keysRise = false;
      const settle = peak - rail.bearingAtS(sb);
      check(
        "a3 to a4 (W, watching the falls): the view turns one way only (every key's bearing above the last; on the rail never back by more than 0.05 degrees until 90 units before a4; a4's own settle under 6), under 130 degrees in all, no step of 2 units over 1 degree, <= 2.4 degrees per vh 60 clear of the stops",
        keysRise && against <= 0.05 && settle < 6 && total < 130 && step.v <= 1 && fastest.v <= 2.4,
        `keys rising ${keysRise}; most against the turn ${against.toFixed(3)} deg; the settle onto a4 ${r1(settle)} deg; ${r1(total)} degrees in all; largest step ${JSON.stringify(step)}; fastest ${JSON.stringify(fastest)}`,
      );
      // 6W. The falls stay in the frame as much as the ground allows: their
      //     middle is in the frame from the pool's east shore to a4 except for
      //     one gap (close under them on the gorge floor they are too near and
      //     too far round to hold), and whole at a4.
      const sShore = railSAt(L.ROUTE_MARKS.crossing - 2);
      let seen = 0;
      let n = 0;
      let gaps = 0;
      let was = true;
      let gap = [null, null];
      for (let s = sShore; s <= sb; s += 4) {
        const is = inFrame(s);
        n++;
        if (is) seen++;
        if (!is && was) {
          gaps++;
          gap[0] = Math.round(s - sa);
        }
        if (is && !was) gap[1] = Math.round(s - sa);
        was = is;
      }
      report.a3a4View = { seen: r1((seen / n) * 100), gaps, gap, a4: atA4 };
      check(
        "a3 to a4 (W): the falls' middle in the frame for at least 85 percent of the way from the pool's shore to a4, out of it at most once, and whole in the a4 frame (middle at x 0.4-0.6, lip to pool)",
        seen / n >= 0.85 && gaps <= 1 && atA4.whole,
        `in the frame ${r1((seen / n) * 100)} percent of the way; out of it ${gaps} time(s) ${gaps ? JSON.stringify(gap) : ""}; at a4 (16:9) ${JSON.stringify(atA4)}`,
      );
    }
  }
  // The crest: the camera comes over the gully's top already facing north (the saddle and the lake).
  let crestSpan = 0;
  for (let s = sAtKey(L.ROUTE_MARKS.gully + 1); s <= burstS; s += 4) crestSpan = Math.max(crestSpan, Math.abs((((rail.bearingAtS(s) % 360) + 540) % 360) - 180));
  check("the gully: turned before the top, facing within 15 of north from mid gully to the burst", crestSpan <= 15, `${r1(crestSpan)} degrees off north`);
}

// ── The falls' cliff and the trail at its foot ─────────────────────────────
// 2026-10-13 (decision 66): the cave behind the falls is gone from the world.
// Its checks (the route in or out of its void, the rock cover over the hall,
// the mouth behind the curtain) went with it. What holds now: the camera is
// above ground everywhere and never passes through the falling water, and the
// trail on the ground starts again on the pool's shore.
{
  const F = WORLD.falls;
  // 1. No sample of the route is under the terrain's surface.
  let underground = 0;
  for (const d of dense) if (d.p.y < terrainHeight(d.p.x, d.p.z)) underground++;
  check("the camera is above ground everywhere (no sample of the route under the terrain's surface)", underground === 0, `${underground} of ${dense.length} samples under the surface`);
  // 2. The trail at the pool. The ride down the falls has no trail (the lip is
  //    the only point flagged `under`); the next point is on the pool's shore,
  //    just outside the water; from there to the log's south end the trail
  //    lies on the gorge's floor, and nowhere does it start from or run into
  //    a rock wall (the ground within 25 of it never rises 8 over it).
  {
    const iLip = PATH.findIndex((q) => q.under);
    const iLog = PATH.findIndex((q) => Math.abs(q.x - 62) < 1 && Math.abs(q.z - 1608) < 1);
    const unders = PATH.filter((q) => q.under).length;
    const P0 = PATH[iLip + 1];
    const shore = Math.hypot(P0.x - WORLD.pool.x, P0.z - WORLD.pool.z) - WORLD.pool.r;
    let offGround = { v: 0 };
    let wall = { v: -Infinity };
    for (let i = iLip + 1; i < iLog; i++) {
      const a = PATH[i];
      const b = PATH[i + 1];
      const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2);
      for (let k = 0; k <= n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n;
        const z = a.z + ((b.z - a.z) * k) / n;
        const y = a.y + ((b.y - a.y) * k) / n;
        const g = terrainHeight(x, z);
        if (Math.abs(y - g) > offGround.v) offGround = { v: r1(Math.abs(y - g)), p: [x, z].map(Math.round) };
        for (let t = 0; t < 16; t++) {
          const th = (t / 16) * Math.PI * 2;
          const rise = terrainHeight(x + Math.cos(th) * 25, z + Math.sin(th) * 25) - y;
          if (rise > wall.v) wall = { v: r1(rise), p: [x, z].map(Math.round) };
        }
      }
    }
    check(
      "the trail at the pool: no trail down the ride, then from the pool's shore to the log on the gorge's floor, never at a rock wall",
      iLip >= 0 && unders === 1 && iLog > iLip + 1 && shore >= 0 && shore <= 30 && offGround.v <= 3 && wall.v < 8,
      `points flagged under: ${unders}; the first point after the ride is ${r1(shore)} outside the pool's water; ${iLog - iLip} points to the log; furthest from the ground ${JSON.stringify(offGround)}; highest ground within 25 of it ${JSON.stringify(wall)}`,
    );
  }
  // 2026-10-13: the camera used to go through the curtain and the arch with
  // room (heading south, +z), twice. Now it must never cross the curtain: no
  // step of the route goes from the gorge's side of the falling water to the
  // cliff's side within the curtain's width (the ride comes over the lip
  // above the water, then down in front of it, >= 8 away, checked with the
  // clearances; so only steps below the lip count).
  let crossed = null;
  for (let i = 1; i < dense.length && !crossed; i++) {
    const a = dense[i - 1].p;
    const b = dense[i].p;
    if (a.y > F.top[1] - 5 || b.y > F.top[1] - 5) continue;
    const [, czA] = L.fallsCurtainAt(a.y);
    const [, czB] = L.fallsCurtainAt(b.y);
    if (a.z < czA !== b.z < czB && Math.abs(b.x - F.top[0]) < F.width) crossed = { x: r1(b.x - F.top[0]), y: r1(b.y), s: Math.round(dense[i].s) };
  }
  check("the camera never crosses the falls' curtain", crossed === null, crossed ?? "no step of the route crosses the falling water");
  // 4. a3: the whole falls in frame.
  const camAt = (i) => camOf(v3(TRAIL[PLACES[i].trail]), v3(LOOK[PLACES[i].trail]), ASPECT, L.TRAIL_FOV[PLACES[i].trail]);
  const inF = (cam, x, y, z) => {
    const v = proj(cam, x, y, z);
    return v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
  };
  const c3 = camAt(2);
  // Round 1 (Lovro, decision 46): a3 stands OUTSIDE, the whole falls in frame,
  // lip to pool, the falls right of centre (the panel is on the left).
  const a3Stop = TRAIL[PLACES[2].trail];
  const fallsPts = [[F.top[0], F.top[1], F.top[2]], [F.bottom[0], F.bottom[1] + 6, F.bottom[2]], [F.top[0] - F.width / 2, F.top[1], F.top[2]], [F.top[0] + F.width / 2, F.top[1], F.top[2]]];
  const a3In = fallsPts.filter((q) => inF(c3, ...q)).length;
  const mid = proj(c3, F.bottom[0], (F.top[1] + F.bottom[1]) / 2, (F.top[2] + F.bottom[2]) / 2);
  const midX = (mid.x + 1) / 2;
  check("a3 stop: above ground, the whole falls in frame (lip corners and the foot at the pool), their middle at x 0.5-0.75", a3Stop[1] > terrainHeight(a3Stop[0], a3Stop[2]) + 20 && a3In === fallsPts.length && midX >= 0.5 && midX <= 0.75, `${r1(a3Stop[1] - terrainHeight(a3Stop[0], a3Stop[2]))} over the ground, ${a3In}/${fallsPts.length} falls points in frame, middle at x ${midX.toFixed(2)}`);
  // 5. The flight is long.
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
  const cam = camOf(v3(TRAIL[best.k]), v3(LOOK[best.k]), ASPECT, L.TRAIL_FOV[best.k]);
  // The dome's top as blocks.ts builds it (pos.y + 75.5; PLACES' height,
  // 110, is a rough figure for markers), and the telescope's tip (58 long
  // from a pivot 58 up, 42 degrees up toward bearing 218).
  const DOME_TOP = 75.5;
  // v6: the telescope on TELESCOPE's axis, aimed at the Creative Strategy constellation.
  const T = L.TELESCOPE;
  const tb = (T.az * Math.PI) / 180;
  const te = (T.el * Math.PI) / 180;
  const tel = [T.pivot[0] + Math.sin(tb) * Math.cos(te) * T.length, T.pivot[1] + Math.sin(te) * T.length, T.pivot[2] - Math.cos(tb) * Math.cos(te) * T.length];
  const top = proj(cam, a7.pos.x, a7.pos.y + DOME_TOP, a7.pos.z).clone();
  const tipP = proj(cam, ...tel).clone();
  const inLower = (v) => v.z < 1 && Math.abs(v.x) <= 1 && v.y >= -1 && v.y <= -0.2;
  // Fix round 1 (judge 1): the a7 frame looks up 12 (was 16-20, bible 1.17),
  // so the whole observatory and its terrace read; the check follows it.
  // Fix round 3: the stop orbits round to the telescope's side (its view 60 or
  // more off the tube's aim), so the tube reads as a long diagonal rising left
  // across the sky instead of a stub; it looks up 4 or more, the dome's top in
  // the right half (x 0.55-0.75), the tube's tip up and left of it, the base
  // above the timeline (y > -0.8).
  void inLower;
  const obsBase = proj(cam, a7.pos.x, a7.pos.y, a7.pos.z).clone();
  const v = L.TRAIL_VIEW[best.k];
  const off = Math.abs((((v.bearing - T.az) % 360) + 540) % 360 - 180);
  const inF = (q) => q.z < 1 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1;
  const diag = inF(top) && inF(tipP) && top.x >= 0.1 && top.x <= 0.5 && tipP.x < top.x - 0.15 && tipP.y > top.y + 0.05 && obsBase.y > -0.8;
  // Round 1 (decision 46, "waaay too much sky"): the stop looks up only 0 to
  // 4, so the island's top reads under the sky.
  check("star look: looking up 0-4 from the telescope's side (view >= 60 off the tube's aim), the tube a diagonal rising left from the dome (dome top x 0.55-0.75), the base above the timeline", best.pitch <= 0 && best.pitch >= -4 && off >= 60 && diag, `key ${best.k} pitch ${best.pitch}, ${off.toFixed(0)} off the aim; dome top x ${top.x.toFixed(2)} y ${top.y.toFixed(2)}, telescope tip x ${tipP.x.toFixed(2)} y ${tipP.y.toFixed(2)}, base y ${obsBase.y.toFixed(2)}`);
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
    const cam = camOf(d.p, d.q, ASPECT, L.fovAtKey(d.t * (nK - 1)));
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
    const cam = camOf(o, q, aspect, L.TRAIL_FOV[pl.trail]);
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
    const cam = camOf(d.p, d.q, ASPECT, L.fovAtKey(d.t * (nK - 1)));
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let any = false;
    for (const p of harbourPts) {
      const v = proj(cam, p[0], p[1], p[2]);
      if (!(v.z < 1 && Math.abs(v.x) <= 1.3 && Math.abs(v.y) <= 1.3)) continue;
      if (rayBlock(d.p, p, true, !!GB) !== 0) continue;
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
  check(`N9: Gate isle < 1% of the frame everywhere before the flight begins (terrain, islands${GB ? " and the Gate's cloud bank" : ", NO cloud bank found"})`, worst.pct < 1 && !!GB, worst.pct ? worst : "never in view");
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
      // v6: the floor runs north of the pool (the falls pour north).
      const z = Pl.z - 110 + Math.sin((a / 24) * Math.PI * 2) * r * 0.5;
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
    // v6: the gully's notch cuts the rim at WORLD.gully.x.
    if (Math.abs(x - WORLD.gully.x) < WORLD.gully.halfW + 60) continue;
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
  s += `<polyline fill="none" stroke="#000" stroke-opacity=".55" stroke-width="3" stroke-dasharray="2 3" points="${L.GATE_CAUSEWAY.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ")}"/>`;
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

// ── The scenery is pinned to places, never to the route's numbering (decision
// 66, 2026-10-13). rocks.ts read its hero rocks, and cover.ts its near band,
// from TRAIL by raw key number, and the grass was numbered in one running
// count through the whole world: rerouting the camera at the pool nearly moved
// rocks on the beach, and a clump added in one place renumbered every clump
// planted after it. Both modules are built here in node (the analytic ground,
// no meshes) and built again after an edit somewhere else; nothing may move.
{
  const R = await import("../src/lib/world-v6/rocks.ts");
  const C = await import("../src/lib/world-v6/cover.ts");
  const FP = await import("../src/lib/world-v6/footprints.ts");
  /** Rocks (every mesh's vertices, every footprint, every ring number) and clumps, as built now. `extra` runs between the two. */
  const build = (extra) => {
    FP.resetFootprints();
    const root = new THREE.Group();
    R.install({ root, camera: new THREE.PerspectiveCamera() });
    const meshes = [];
    root.traverse((o) => {
      const pos = o.isMesh && o.geometry.getAttribute("position");
      if (!pos) return;
      let h = 0;
      for (let i = 0; i < pos.array.length; i++) h = (h * 31 + Math.round(pos.array[i] * 100)) | 0;
      meshes.push(`${o.name} ${pos.count} ${h}`);
    });
    const feet = FP.all().map((f) => `${f.kind} ${f.x} ${f.z} ${f.r}`);
    const rings = R.rockRings.map((q) => `${q.place} ${q.n}`);
    if (extra) extra(FP);
    const clumps = C.scatterForTests();
    return { rocks: JSON.stringify([meshes, feet, rings]), nRocks: feet.length, clumps };
  };
  const before = build();

  // 1. Every copied camera still lies on the route (when one does not, the camera was moved there: move the copy).
  const offRoute = (x, y, z) => {
    let best = Infinity;
    for (let i = 0; i < TRAIL.length - 1; i++) {
      const a = TRAIL[i];
      const b = TRAIL[i + 1];
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const u = Math.min(1, Math.max(0, ((x - a[0]) * d[0] + (y - a[1]) * d[1] + (z - a[2]) * d[2]) / (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1)));
      best = Math.min(best, Math.hypot(x - a[0] - d[0] * u, y - a[1] - d[1] * u, z - a[2] - d[2] * u));
    }
    return best;
  };
  // Decision 67: four of the spots are the keys of the flight from a3 to a4
  // (decision 65), which the walk along the trail replaced. They stay where
  // they are: the rocks within 150 of them (the wall under the bench's west
  // end) are still the ones the camera climbs past, 31 to 71 away, and moving
  // a spot swaps plain rocks for chamfered ones or back, which is a change to
  // the scenery nobody asked for. So: those four within 75 of the route, every
  // other spot within 5.
  const RETIRED_FLIGHT = [[270, 231, 1349], [321, 251, 1346], [374, 271, 1340], [430, 290, 1330]];
  const retired = (p) => RETIRED_FLIGHT.some((q) => q[0] === p[0] && q[1] === p[1] && q[2] === p[2]);
  const heroOff = R.HERO_SPOTS.filter((p) => !retired(p)).map((p) => r1(offRoute(p[0], p[1], p[2])));
  const oldOff = R.HERO_SPOTS.filter(retired).map((p) => r1(offRoute(p[0], p[1], p[2])));
  check(
    "pinned: every hero rock spot (rocks.ts HERO_SPOTS) lies within 5 of the camera's route (the four of the retired flight up the north wall: within 75)",
    Math.max(...heroOff) <= 5 && oldOff.length === 4 && Math.max(...oldOff) <= 75,
    { spots: heroOff.length, worst: Math.max(...heroOff), retiredFlight: oldOff },
  );
  const bandOff = C.NEAR_BAND.map((c) => r1(offRoute(c.x, c.y, c.z)));
  check("pinned: every near band camera (cover.ts NEAR_BAND) lies within 5 of the camera's route", Math.max(...bandOff) <= 5, { cameras: bandOff.length, worst: Math.max(...bandOff) });

  // 2. A key added early on the route (a copy of key 1, so the route's shape
  // is the same and every later key's number is one higher) and a point added
  // to the walking trail at the log (the same way): not one rock, footprint,
  // ring number or clump may differ. A raw `TRAIL[n]` or a seed taken from a
  // trail point's index fails here.
  const routeArrays = [L.TRAIL, L.LOOK, L.TRAIL_KIND, L.TRAIL_PACE, L.TRAIL_VIEW, L.TRAIL_FOV, L.TRAIL_CLEAR];
  const iLog = PATH.findIndex((q) => Math.abs(q.x - 62) < 1 && Math.abs(q.z - 1608) < 1);
  for (const a of routeArrays) a.splice(1, 0, a[1]);
  for (const q of PLACES) q.trail += 1;
  PATH.splice(iLog, 0, PATH[iLog]);
  let after;
  try {
    after = build();
  } finally {
    for (const a of routeArrays) a.splice(1, 1);
    for (const q of PLACES) q.trail -= 1;
    PATH.splice(iLog, 1);
  }
  const sameClumps = (a, b, keep = () => true) => {
    const A = a.filter(keep);
    const B = b.filter(keep);
    let diff = Math.abs(A.length - B.length);
    for (let i = 0; i < Math.min(A.length, B.length); i++) if (A[i].some((v, j) => v !== B[i][j])) diff++;
    return { clumps: A.length, differ: diff };
  };
  check("pinned: a key added to the route and a point to the trail move no rock (meshes, footprints, ring numbers)", iLog > 0 && after.rocks === before.rocks, { rockFootprints: before.nRocks, identical: after.rocks === before.rocks });
  const moved = sameClumps(before.clumps, after.clumps);
  check("pinned: the same edit moves no grass clump (place, height, turn, number)", moved.differ === 0, moved);

  // 2b. Decision 67: the walk from a3 to a4 moved no rock. Rocks keep clear of
  // the camera's route (rocks.ts nearRail: the keys as straight segments), and
  // three of its loops deal their later rocks from one running stream, so a
  // key in the wrong place drops a family and re-deals the ones after it. The
  // walk's fifteen positions were chosen so that every verdict is what it was
  // with the flight they replaced (decision 65); put the flight's positions
  // back and not one rock mesh, footprint or ring number may differ.
  // The grass does differ, in three of its parts and no other: cover.ts thins
  // it by distance to the route (railKeep, read off a 100 unit grid), and a
  // part deals every drift after a changed one again.
  //   streamShelf  the shelf south of the gorge, rows z 1,936 to 2,050: the
  //                walk comes 280 further south (the pool's east shore) than
  //                the flight did, so a few drifts there are kept or dropped.
  //   lakeShore    ONE of the Mirror Lake's 170 shore candidates, at (138,
  //                148), reads 1,072 from the route where it read 1,101 (the
  //                line is 1,100; the true distance is 1,108 either way, to
  //                the route north of the lake: the coarse grid blends in the
  //                bench, which the walk follows 60 to 100 further north than
  //                the flight passed). It is planted now, and the 104
  //                candidates after it are numbered one on: the same drifts
  //                in the same places, their clumps dealt again.
  //   ring:lake    the rings round the lake's rocks share cells with those.
  // Pinning that would take cover.ts its own copy of the route (as decision 66
  // gave rocks.ts HERO_SPOTS); cover.ts was not to be touched for the walk.
  {
    const FLIGHT = [
      [-287, 131, 1396], [-222, 133, 1376], [-167, 136, 1366], [-111, 141, 1358], [-56, 147, 1352], [-1, 155, 1350], [54, 165, 1351], [109, 178, 1352],
      [163, 194, 1353], [217, 212, 1352], [270, 231, 1349], [321, 251, 1346], [374, 271, 1340], [430, 290, 1330], [624, 324, 1262],
    ];
    const i0 = PLACES[2].trail + 1;
    const n = PLACES[3].trail - i0;
    const walk = TRAIL.slice(i0, i0 + n);
    let flown = null;
    if (n === FLIGHT.length) {
      TRAIL.splice(i0, n, ...FLIGHT);
      try {
        flown = build();
      } finally {
        TRAIL.splice(i0, n, ...walk);
      }
    }
    check("decision 67: the walk from a3 to a4 moves no rock (built with the flight's fifteen positions instead: the same meshes, footprints and ring numbers)", !!flown && flown.rocks === before.rocks, { rows: n, rockFootprints: before.nRocks, identical: !!flown && flown.rocks === before.rocks });
    if (flown) {
      const keyOf = (c) => c.join(" ");
      const had = new Set(flown.clumps.map(keyOf));
      const has = new Set(before.clumps.map(keyOf));
      const gone = flown.clumps.filter((c) => !has.has(keyOf(c)));
      const come = before.clumps.filter((c) => !had.has(keyOf(c)));
      const byPart = {};
      for (const c of [...gone, ...come]) byPart[c[5]] = (byPart[c[5]] || 0) + 1;
      report.walkGrass = { flight: flown.clumps.length, walk: before.clumps.length, gone: gone.length, come: come.length, byPart };
      const others = Object.keys(byPart).filter((k) => !["streamShelf", "lakeShore", "ring:lake"].includes(k));
      check("decision 67: the walk changes grass in three parts only (the stream shelf's last rows, the lake's shore and the rings beside it), under 1,500 clumps of the world's", others.length === 0 && gone.length < 1500 && come.length < 1500, report.walkGrass);
    }
  }

  // 3. A crate put down on the pool's east shore (a footprint 14 across, where
  // grass grew). Clumps go where it stands; the part of the world it stands in
  // (the pool's band of the gorge) deals its later drifts again, which one
  // running count per part cannot avoid; no clump of any other part changes,
  // save the rings and near bands that reach within 150 of the crate itself.
  const crate = { x: 20, z: 1645, r: 14 };
  const withCrate = build((fp) => fp.addFootprint({ ...crate, kind: "prop" }));
  const keyOf = (c) => c.join(" ");
  const had = new Set(before.clumps.map(keyOf));
  const has = new Set(withCrate.clumps.map(keyOf));
  const changed = [...before.clumps.filter((c) => !has.has(keyOf(c))), ...withCrate.clumps.filter((c) => !had.has(keyOf(c)))];
  const elsewhere = changed.filter((c) => c[5] !== "pool" && Math.hypot(c[0] - crate.x, c[1] - crate.z) > 150);
  const byPart = {};
  for (const c of changed) byPart[c[5]] = (byPart[c[5]] || 0) + 1;
  check("pinned: a thing put down at the pool renumbers no grass of any other part of the world", changed.length > 0 && elsewhere.length === 0, { clumps: before.clumps.length, changedByPart: byPart, elsewhere: elsewhere.length });
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
