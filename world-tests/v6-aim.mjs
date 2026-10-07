/**
 * V5 camera pass 2: what a stop view frames, analytically (terrain only, no
 * trees, no islands): for a grid of rays through the frame, sky (no terrain
 * hit before the far plane) or the distance band of the first terrain hit.
 * Also where the landmark's centre lands on screen. Quick enough to try aims
 * before rendering them.
 *   node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-aim.mjs a5 [bearing pitch] [--aspect 1.6] [--far 6700]
 */
import * as L from "../src/lib/world-v6/layout.ts";
import { terrainHeight } from "../src/lib/world-v6/terrain.ts";
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const pos = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && argv[i - 1] !== "--map"));
const id = pos[0] || "a1";
const p = L.PLACES.find((q) => q.id === id);
const c = L.TRAIL[p.trail];
const v = L.TRAIL_VIEW[p.trail];
const bearing = pos[1] !== undefined ? Number(pos[1]) : v.bearing;
const pitch = pos[2] !== undefined ? Number(pos[2]) : v.pitch;
const aspect = flag("--aspect", 1.6);
const far = flag("--far", 6000);
// Detail pass 3: the stop's own lens (layout STOP_FOV), or --fov.
const fovV = flag("--fov", L.TRAIL_FOV?.[p.trail] ?? L.DESIGN_FOV);
const tanV = Math.tan((fovV / 2) * Math.PI / 180);
const b = bearing * Math.PI / 180, pp = pitch * Math.PI / 180;
// camera basis: forward, right, up (world, y up; bearing 0 = -z)
const f = [Math.sin(b) * Math.cos(pp), -Math.sin(pp), -Math.cos(b) * Math.cos(pp)];
const r = [Math.cos(b), 0, Math.sin(b)];
const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
const up = u[1] < 0 ? u.map((x) => -x) : u;
const W = 64, H = 40;
const bands = { sky: 0, far: 0, mid: 0, near: 0 };
const rows = [];
for (let j = 0; j < H; j++) {
  let line = "";
  const ny = 1 - (2 * (j + 0.5)) / H;
  for (let i = 0; i < W; i++) {
    const nx = (2 * (i + 0.5)) / W - 1;
    const d = [0, 1, 2].map((k) => f[k] + r[k] * nx * tanV * aspect + up[k] * ny * tanV);
    const len = Math.hypot(...d); const dn = d.map((x) => x / len);
    let hit = -1;
    for (let t = 5; t <= far; t += t < 800 ? 6 : t < 2500 ? 20 : 45) {
      const x = c[0] + dn[0] * t, y = c[1] + dn[1] * t, z = c[2] + dn[2] * t;
      if (x < L.WORLD.minX || x > L.WORLD.maxX || z < L.WORLD.minZ || z > L.WORLD.maxZ) break;
      if (y <= terrainHeight(x, z)) { hit = Math.hypot(dn[0] * t, dn[2] * t); break; }
    }
    const k = hit < 0 ? "sky" : hit >= 2000 ? "far" : hit >= 800 ? "mid" : "near";
    bands[k]++;
    line += { sky: " ", far: ".", mid: ":", near: "#" }[k];
  }
  rows.push(line);
}
// landmark centre on screen
const lm = [p.pos.x - c[0], p.pos.y + p.height / 2 - c[1], p.pos.z - c[2]];
const dot = (a, q) => a[0] * q[0] + a[1] * q[1] + a[2] * q[2];
const z = dot(lm, f);
const sx = 0.5 + 0.5 * (dot(lm, r) / z) / (tanV * aspect), sy = 0.5 - 0.5 * (dot(lm, up) / z) / tanV;
const base = [p.pos.x - c[0], p.pos.y - c[1], p.pos.z - c[2]];
const by = 0.5 - 0.5 * (dot(base, up) / dot(base, f)) / tanV;
const n = W * H;
console.log(`${id} bearing ${bearing} pitch ${pitch} fov ${fovV} aspect ${aspect}: sky ${(100 * bands.sky / n).toFixed(1)}%  far(>2000) ${(100 * bands.far / n).toFixed(1)}%  mid ${(100 * bands.mid / n).toFixed(1)}%  near(<800) ${(100 * bands.near / n).toFixed(1)}%  | sky+far ${(100 * (bands.sky + bands.far) / n).toFixed(1)}% | landmark centre x ${sx.toFixed(3)} y ${sy.toFixed(3)}, base y ${by.toFixed(3)}`);
if (argv.includes("--map")) console.log(rows.join("\n"));
