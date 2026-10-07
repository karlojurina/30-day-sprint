/**
 * v6 locked stretches (world_art_bible_v6.md 1.0 "Locked, never touched", 5.1):
 * the camera rows Lovro approved stay exactly as v5 has them.
 *
 *   node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-locked.mjs
 *
 * Compares v5's and v6's layout.ts TRAIL (x, y, z), TRAIL_VIEW (bearing,
 * pitch) and stop ids, row by row, for:
 *   - the ridge onward to a6 (the saddle, the meadow, a5, the Mirror Lake
 *     reveal, the crossing to the forest, a6): from v5's row at (1450, 720,
 *     865), the key after the burst. Round 1 (decision 46): the burst and the
 *     cave's click-in view are no longer locked (Lovro's call), so neither is
 *     compared; a3 stands outside the falls now (v6-route.mjs checks it);
 *   - the rise up the floating steps (every "rise" row);
 *   - the rope bridge: from the bridge-head "board" row to the gangway;
 *   - the flight (every "flight" row) and the ship's poses;
 *   - the floating steps' slabs (STEPS) and the bridge's deck (BRIDGE);
 * and the cave's build frame (the hall and mouth are v5's, mirrored).
 * Kinds may differ (v5 "shaft" rows read "climb" in v6). Exit code 1 on any
 * difference.
 */
import * as V5 from "../src/lib/world-v5/layout.ts";
import * as V6 from "../src/lib/world-v6/layout.ts";

let failures = 0;
const check = (name, pass, value) => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
};
const row = (L, i) => ({ p: L.TRAIL[i], b: L.TRAIL_VIEW[i].bearing, t: L.TRAIL_VIEW[i].pitch, stop: L.PLACES.find((q) => q.trail === i)?.id ?? null });
const same = (a, b) => a.p[0] === b.p[0] && a.p[1] === b.p[1] && a.p[2] === b.p[2] && a.b === b.b && a.t === b.t && a.stop === b.stop;

/** Compare the rows [a5From..a5To] of v5 with v6 starting at b6From, same length. */
function compareRun(name, a5From, a5To, b6From) {
  const diffs = [];
  if (a5From < 0 || b6From < 0) {
    check(name, false, `run not found (v5 ${a5From}, v6 ${b6From})`);
    return;
  }
  for (let k = 0; a5From + k <= a5To; k++) {
    const a = row(V5, a5From + k);
    const b = row(V6, b6From + k);
    if (b6From + k >= V6.TRAIL.length || !same(a, b)) diffs.push({ v5: a5From + k, v6: b6From + k, a, b });
  }
  check(`${name} (v5 rows ${a5From}-${a5To} = v6 rows ${b6From}-${b6From + a5To - a5From})`, diffs.length === 0, diffs.length ? `${diffs.length} rows differ, first ${JSON.stringify(diffs[0])}` : "identical");
}
const find = (L, pred) => L.TRAIL.findIndex((p, i) => pred(p, i));

// The ridge after the burst, onward to a6 (round 1: the burst itself is no longer locked).
{
  const at = (L) => find(L, (p) => p[0] === 1450 && p[1] === 720 && p[2] === 865);
  const a6v5 = V5.PLACES[5].trail;
  compareRun("the ridge after the burst, the saddle, the meadow, a5, the lake reveal, the crossing, a6", at(V5), a6v5, at(V6));
}
// The rise.
{
  const r5 = V5.TRAIL_KIND.indexOf("rise");
  let r5e = r5;
  while (V5.TRAIL_KIND[r5e + 1] === "rise") r5e++;
  compareRun("the rise up the floating steps", r5, r5e, V6.TRAIL_KIND.indexOf("rise"));
}
// The rope bridge: from the bridge-head board row to the last board row before the flight.
{
  const b5 = V5.BRIDGE_KEYS.first - 1;
  const b5e = V5.FLIGHT_KEYS.first - 1;
  compareRun("the rope bridge, the bounty isle and the gangway", b5, b5e, V6.BRIDGE_KEYS.first - 1);
}
// The flight, and the first key after it (its position shapes the flight's
// last stretch of curve; v6's a8 stands there with its own view).
compareRun("the airship flight", V5.FLIGHT_KEYS.first, V5.FLIGHT_KEYS.last, V6.FLIGHT_KEYS.first);
{
  const a = V5.TRAIL[V5.FLIGHT_KEYS.last + 1];
  const b = V6.TRAIL[V6.FLIGHT_KEYS.last + 1];
  check("the first key after the flight stands where v5's does (the flight's curve ends as v5's)", a.every((v, i) => v === b[i]), `v5 ${a.join(", ")} / v6 ${b.join(", ")}`);
}
{
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check("the ship: SHIP, SHIP_MOORED, SHIP_DOCKED identical", eq(V5.SHIP, V6.SHIP) && eq(V5.SHIP_MOORED, V6.SHIP_MOORED) && eq(V5.SHIP_DOCKED, V6.SHIP_DOCKED), "compared");
  check("the floating steps: STEPS_FOOT, STEPS_TOP and every slab identical", eq(V5.STEPS, V6.STEPS) && eq(V5.STEPS_FOOT, V6.STEPS_FOOT) && eq(V5.STEPS_TOP, V6.STEPS_TOP), `${V6.STEPS.length} slabs`);
  check("the rope bridge: BRIDGE and BRIDGE_EYE identical", eq(V5.BRIDGE, V6.BRIDGE) && V5.BRIDGE_EYE === V6.BRIDGE_EYE, "compared");
  check("the lake, the island and the forest: WORLD.lake, .island, .forest, .bountyIsle identical", eq(V5.WORLD.lake, V6.WORLD.lake) && eq(V5.WORLD.island, V6.WORLD.island) && eq(V5.WORLD.forest, V6.WORLD.forest) && eq(V5.WORLD.bountyIsle, V6.WORLD.bountyIsle), "compared");
  check("the pace of the locked kinds (rise, bridge, board, flight, sky) unchanged", ["rise", "bridge", "board", "flight", "sky"].every((k) => V5.PACE[k] === V6.PACE[k]), ["rise", "bridge", "board", "flight", "sky"].map((k) => `${k} ${V6.PACE[k]}`).join(", "));
}
// The cave's build frame is still v5's cave (the hall, the mouth): the
// pass-through after a3 runs through it. Its click-in view is no longer locked.
{
  const cb = V6.CAVE_BUILD;
  const c5 = V5.CAVE;
  check("the cave's build frame is v5's cave (the hall, the mouth)", ["x", "footZ", "floorY", "mouthHalfW", "mouthH", "hallX", "hallZ", "rx", "rz", "hallH"].every((k) => cb[k] === c5[k]), "compared");
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall locked stretches identical");
process.exit(failures ? 1 : 0);
