/**
 * V5 camera pass 2: the terrain skyline round a stop camera. For each bearing,
 * the highest elevation angle (degrees) of the terrain along that bearing out
 * to 12,000, and the distance where it peaks. Used to aim the stop views so a
 * quarter to a third of the frame is sky and far ridges.
 *   node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-skyline.mjs a1 [from to step]
 */
import * as L from "../src/lib/world-v6/layout.ts";
import { terrainHeight } from "../src/lib/world-v6/terrain.ts";
const id = process.argv[2] || "a1";
const from = Number(process.argv[3] ?? 0), to = Number(process.argv[4] ?? 360), step = Number(process.argv[5] ?? 5);
const p = L.PLACES.find((q) => q.id === id);
const c = L.TRAIL[p.trail];
const v = L.TRAIL_VIEW[p.trail];
const lb = Math.atan2(p.pos.x - c[0], -(p.pos.z - c[2])) * 180 / Math.PI;
const ld = Math.hypot(p.pos.x - c[0], p.pos.z - c[2]);
console.log(`${id} cam ${c.map(Math.round)} view ${v.bearing}/${v.pitch}; landmark bearing ${((lb + 360) % 360).toFixed(1)} dist ${ld.toFixed(0)} depression ${(Math.atan2(c[1] - p.pos.y - p.height / 2, ld) * 180 / Math.PI).toFixed(1)}`);
const span = ((to - from) % 360 + 360) % 360 || 360;
for (let bb = 0; bb <= span; bb += step) {
  const b = (from + bb) % 360;
  const r = (b * Math.PI) / 180;
  let best = -90, bd = 0, near = -90, nd = 0;
  const DMAX = Number(process.env.DMAX || 12000);
  for (let d = 30; d <= DMAX; d += d < 1000 ? 10 : 30) {
    const x = c[0] + Math.sin(r) * d, z = c[2] - Math.cos(r) * d;
    if (x < L.WORLD.minX || x > L.WORLD.maxX || z < L.WORLD.minZ || z > L.WORLD.maxZ) break;
    const e = Math.atan2(terrainHeight(x, z) - c[1], d) * 180 / Math.PI;
    if (e > best) { best = e; bd = d; }
    if (d < 1500 && e > near) { near = e; nd = d; }
  }
  console.log(`  b ${String(b).padStart(3)}  skyline ${best.toFixed(1).padStart(5)} at ${String(Math.round(bd)).padStart(5)}   near(<1500) ${near.toFixed(1).padStart(5)} at ${nd}`);
}
