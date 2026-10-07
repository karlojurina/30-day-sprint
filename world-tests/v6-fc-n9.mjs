/**
 * Frame cleanup: v6-route's N9 Gate isle check alone, fast, with the share of
 * the frame per sample printed from key 59 to the flight (same maths as
 * v6-route.mjs: box of the visible gate isle points, terrain + isle occlusion).
 *   node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-fc-n9.mjs
 */
import * as THREE from "three";
import * as L from "../src/lib/world-v6/layout.ts";
import { terrainHeight } from "../src/lib/world-v6/terrain.ts";
let { TRAIL, LOOK } = L;
const { WORLD, PLACES, ISLAND_DEPTH, BOUNTY_DEPTH, GATE_DEPTH } = L;
const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
// Optional override for trying a key: FC_KEY="index,bearing,pitch[,x,y,z]".
if (process.env.FC_KEY) {
  const [i, b, t, x, y, z] = process.env.FC_KEY.split(",").map(Number);
  const T = TRAIL.map((q) => [...q]); const Lk = LOOK.map((q) => [...q]);
  const D = Math.hypot(LOOK[i][0] - TRAIL[i][0], LOOK[i][1] - TRAIL[i][1], LOOK[i][2] - TRAIL[i][2]);
  if (x !== undefined) T[i] = [x, y, z];
  const br = (b * Math.PI) / 180, pr = (t * Math.PI) / 180;
  Lk[i] = [T[i][0] + Math.sin(br) * Math.cos(pr) * D, T[i][1] - Math.sin(pr) * D, T[i][2] - Math.cos(br) * Math.cos(pr) * D];
  TRAIL = T; LOOK = Lk;
}
const pc = new THREE.CatmullRomCurve3(TRAIL.map(v3), false, "centripetal");
const lc = new THREE.CatmullRomCurve3(LOOK.map(v3), false, "centripetal");
const nK = TRAIL.length, N = 8000;
const dense = [];
{ let s = 0, prev = null;
  for (let i = 0; i <= N; i++) { const t = i / N; const p = pc.getPoint(t); const q = lc.getPoint(t); if (prev) s += p.distanceTo(prev); dense.push({ t, s, p, q }); prev = p; } }
const I = WORLD.island, B = WORLD.bountyIsle, H = WORLD.gateIsle;
const ISLES = [{ c: I, depth: ISLAND_DEPTH }, { c: B, depth: BOUNTY_DEPTH }, { c: H, depth: GATE_DEPTH }];
const inIsle = (x, y, z) => { for (const { c, depth } of ISLES) { const d = Math.hypot(x - c.x, z - c.z); if (d < c.r && y <= c.y && y >= c.y - depth * (1 - d / c.r)) return true; } return false; };
const disc = (out, c, depth, rings, per, extra = 0) => { for (let ri = 0; ri <= rings; ri++) { const r = (ri / rings) * c.r; const n = ri === 0 ? 1 : per; for (let a = 0; a < n; a++) { const th = (a / n) * Math.PI * 2; const x = c.x + Math.cos(th) * r; const z = c.z + Math.sin(th) * r; out.push([x, c.y + extra, z]); out.push([x, c.y - depth * (1 - r / c.r) - 4, z]); } } };
const pts = []; disc(pts, H, GATE_DEPTH, 4, 20, 40);
const hall = PLACES.find((p) => p.id === "a8"); pts.push([hall.pos.x, hall.pos.y + hall.height, hall.pos.z]);
function blocked(o, p) { const dx = p[0] - o.x, dy = p[1] - o.y, dz = p[2] - o.z; const steps = Math.ceil(Math.hypot(dx, dy, dz) / 12);
  for (let k = 2; k < steps - 2; k++) { const u = k / steps; const x = o.x + dx * u, y = o.y + dy * u, z = o.z + dz * u; if (terrainHeight(x, z) > y || inIsle(x, y, z)) return true; } return false; }
const tF = L.FLIGHT_KEYS.first / (nK - 1);
let worst = { pct: 0 }; const rows = [];
for (let i = 0; i < dense.length; i += 3) {
  const d = dense[i];
  const k = d.t * (nK - 1);
  if (d.t >= tF) break;
  if (process.env.FC_FROM && k < +process.env.FC_FROM) continue;
  const cam = new THREE.PerspectiveCamera(L.fovAtKey(k), 16 / 9, 1, 30000); cam.position.copy(d.p); cam.lookAt(d.q); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, any = false;
  for (const p of pts) { const v = new THREE.Vector3(...p).project(cam); if (!(v.z < 1 && Math.abs(v.x) <= 1.3 && Math.abs(v.y) <= 1.3)) continue; if (blocked(d.p, p)) continue; any = true; x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
  if (!any) continue;
  const pct = (100 * Math.max(0, Math.min(1, x1) - Math.max(-1, x0)) * Math.max(0, Math.min(1, y1) - Math.max(-1, y0))) / 4;
  if (pct <= 0) continue;
  rows.push(`k ${k.toFixed(2)} s ${Math.round(d.s)} pct ${pct.toFixed(2)} box x ${x0.toFixed(2)}..${x1.toFixed(2)} y ${y0.toFixed(2)}..${y1.toFixed(2)}`);
  if (pct > worst.pct) worst = { pct: +pct.toFixed(2), s: Math.round(d.s), k: +k.toFixed(2) };
}
if (!process.env.FC_QUIET) console.log(rows.filter((_, i) => i % 2 === 0).join("\n"));
console.log(`N9 worst before the flight: ${JSON.stringify(worst)} -> ${worst.pct < 1 ? "PASS" : "FAIL"}`);
