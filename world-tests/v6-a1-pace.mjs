/**
 * A1: where every TRAIL key sits in the scroll at the default pacing, in vh
 * (one screen = 100 vh), and the scroll between named keys (the ride, the
 * turn, the hike from the cave exit to the burst).
 *
 *   node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-a1-pace.mjs
 */
import * as L from "../src/lib/world-v6/layout.ts";
import { createRail } from "../src/lib/world-v6/rail.ts";
import { railGround } from "../src/lib/world-v6/scene.ts";

const rail = createRail();
rail.setGround(railGround);
const n = L.TRAIL.length;
const totalVh = L.PLACES.reduce((a, p) => a + p.scrollVh, 0) + L.TAIL_VH + L.FLIGHT_VH;
/** Route distance at fractional key f. */
function sAtKey(f) {
  let lo = 0;
  let hi = rail.length;
  const u = f / (n - 1);
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (rail.tAtS(m) < u) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
const vhAt = (f) => rail.depthOfS(sAtKey(f)) * totalVh;
const rows = [];
for (let i = 0; i < n; i++) rows.push(`${String(i).padStart(3)} ${L.TRAIL_KIND[i].padEnd(6)} ${(L.PLACES.find((p) => p.trail === i)?.id ?? "").padEnd(3)} ${vhAt(i).toFixed(0).padStart(6)} vh`);
console.log(rows.join("\n"));
const stop = (id) => L.PLACES.find((p) => p.id === id).trail;
const lip = L.DIVE_KEYS.first;
const turnFrom = lip + 6;
const turnTo = lip + 10;
const exitKey = L.CAVE_KEYS.last + 1;
const burst = L.CLIMB_KEYS.first + 2;
const span = (a, b) => (vhAt(b) - vhAt(a)).toFixed(0);
console.log(`\ntotal ${totalVh} vh`);
console.log(`the ride, lip (k${lip}) to level over the pool (k${turnFrom}): ${span(lip, turnFrom)} vh`);
console.log(`the turn at the pool (k${turnFrom} to k${turnTo}): ${span(turnFrom, turnTo)} vh`);
console.log(`cave exit (k${exitKey}) to a4 (k${stop("a4")}): ${span(exitKey, stop("a4"))} vh`);
console.log(`a4 to the burst (k${burst}): ${span(stop("a4"), burst)} vh`);
console.log(`cave exit to the burst: ${span(exitKey, burst)} vh (override: at most ~250)`);
