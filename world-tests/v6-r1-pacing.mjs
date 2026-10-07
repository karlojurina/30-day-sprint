/**
 * Round 1, route stage 2: the pacing table. Every stop-to-stop stretch and
 * the named parts inside it, as the rail spends the scroll (layout scrollVh,
 * FLIGHT_VH, TAIL_VH, PACE, the rail's dwell).
 *
 *   node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-r1-pacing.mjs [--json out.json] [--budgets a1,..,a8,tail,flight]
 *
 * Columns: vh (scroll), screens (vh / 100), units (camera travel along the
 * route), vh per 100 units. Parts are cut at the layout's ROUTE_MARKS and at
 * the kind changes (rise, bridge, flight), so the numbers survive a change in
 * the number of keys.
 */
import fs from "node:fs";
import * as L from "../src/lib/world-v6/layout.ts";
import { createRail } from "../src/lib/world-v6/rail.ts";
import { railGround } from "../src/lib/world-v6/scene.ts";

const rail = createRail();
rail.setGround(railGround);
// --budgets a1,a2,...,a8,tail,flight: try an allocation without editing layout.
const bAt = process.argv.indexOf("--budgets");
if (bAt > 0) rail.setPacing(process.argv[bAt + 1].split(",").map(Number));
const nK = L.TRAIL.length;
const total = rail.totalVh();
const vhAt = (s) => rail.depthOfS(s) * total;
/** Route distance at a fractional key index (bisection on the rail's tAtS). */
const sAtKey = (k) => {
  const u = k / (nK - 1);
  let lo = 0;
  let hi = rail.length;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (rail.tAtS(m) < u) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};
const firstOf = (kind) => L.TRAIL_KIND.indexOf(kind);
const lastOf = (kind) => L.TRAIL_KIND.lastIndexOf(kind);
const M = L.ROUTE_MARKS;
/** Named cut points: [name, key index]. Stops come from PLACES. */
const cuts = [];
for (const p of L.PLACES) cuts.push([`stop ${p.id}`, p.trail]);
for (const [n, k] of Object.entries(M)) cuts.push([n, k]);
cuts.push(["rise foot", firstOf("rise")], ["rise top", lastOf("rise")]);
cuts.push(["bridge", L.BRIDGE_KEYS.first], ["bridge end", L.BRIDGE_KEYS.last]);
cuts.push(["moored deck", L.FLIGHT_KEYS.first], ["docked deck", L.FLIGHT_KEYS.last]);
cuts.push(["end", nK - 1]);
const seen = new Set();
const pts = cuts
  .filter(([n, k]) => k >= 0 && !seen.has(n) && seen.add(n))
  .map(([n, k]) => ({ n, k, s: sAtKey(k) }))
  .sort((a, b) => a.s - b.s);
pts.unshift({ n: "start", k: 0, s: 0 });

const stopIdx = L.PLACES.map((p) => p.trail);
const rows = [];
for (let i = 0; i < pts.length - 1; i++) {
  const a = pts[i];
  const b = pts[i + 1];
  if (b.s - a.s < 1e-6) continue;
  const vh = vhAt(b.s) - vhAt(a.s);
  rows.push({ from: a.n, to: b.n, vh: +vh.toFixed(1), units: Math.round(b.s - a.s), vhPer100: +((100 * vh) / (b.s - a.s)).toFixed(1) });
}
const stops = L.PLACES.map((p, i) => ({ id: p.id, module: p.module, s: rail.stopS[i], vh: vhAt(rail.stopS[i]) }));
const stretches = stops.map((st, i) => {
  const s0 = i === 0 ? 0 : stops[i - 1].s;
  const v0 = i === 0 ? 0 : stops[i - 1].vh;
  return { to: `${st.id} ${st.module}`, vh: +(st.vh - v0).toFixed(1), units: Math.round(st.s - s0) };
});
stretches.push({ to: "tail", vh: +(total - stops[7].vh).toFixed(1), units: Math.round(rail.length - stops[7].s) });
console.log(`total ${total} vh, route ${Math.round(rail.length)} units, budgets ${JSON.stringify(rail.pacing())}`);
console.log("\nSTOP TO STOP");
for (const r of stretches) console.log(`${r.to.padEnd(26)} ${String(r.vh).padStart(6)} vh  ${(r.vh / 100).toFixed(2)} screens  ${String(r.units).padStart(5)} units`);
console.log("\nPARTS");
for (const r of rows) console.log(`${(r.from + " -> " + r.to).padEnd(34)} ${String(r.vh).padStart(6)} vh  ${String(r.units).padStart(5)} units  ${String(r.vhPer100).padStart(5)} vh/100u`);
const jsonAt = process.argv.indexOf("--json");
if (jsonAt > 0) fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify({ total, budgets: rail.pacing(), stretches, parts: rows, stopIdx }, null, 1));
