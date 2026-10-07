/**
 * Grey pass 3: proves the mine's shells have no holes the camera can see.
 *
 *   node --import ./world-tests/v5-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v5-mine-rays.mjs
 *
 * The terrain is drawn front faces only, so from inside the cave, the tunnel
 * or the shaft the ground above is see-through: any ray from the camera that
 * finds no FRONT face of blocks.ts's mine shells before it leaves would show
 * sky. This builds the blocks in node (blocks.install on a bare scene), takes
 * the camera along the rail (the TRAIL curve at railU = key / (keys - 1)) from
 * just inside the curtain to the shaft's collar, and casts 400 rays from each
 * sample. A ray passes if its first front-facing hit comes before it crosses
 * one of the two portals (the cave's mouth, the shaft's collar), or if it
 * crosses a portal first (it then sees the world outside). It also reports
 * the nearest shell surface to each sample (the camera's near plane is 2).
 */
import * as THREE from "three";
import { install } from "../src/lib/world-v5/blocks.ts";
import { CAVE, CAVE_KEYS, SHAFT, SHAFT_KEYS, TRAIL } from "../src/lib/world-v5/layout.ts";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(31, 1.6, 2, 16000);
const blocks = install({ scene, camera });
blocks.root.updateMatrixWorld(true);

// ── Triangles of the three shells, world space ──
const tris = [];
blocks.root.traverse((o) => {
  if (!o.isMesh || !/^Mine_(Cave|Tunnel|Shaft)$/.test(o.name)) return;
  const pos = o.geometry.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    const t = [];
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, i + k).applyMatrix4(o.matrixWorld);
      t.push(v.x, v.y, v.z);
    }
    tris.push(t);
  }
});
const N = tris.length;
const T = new Float64Array(N * 9);
tris.forEach((t, i) => T.set(t, i * 9));
console.log(`shell triangles: ${N}`);

// ── Uniform grid over the mine ──
const G = { x0: -260, y0: 40, z0: 1000, cell: 12 };
const nx = Math.ceil((1520 - G.x0) / G.cell);
const ny = Math.ceil((720 - G.y0) / G.cell);
const nz = Math.ceil((1340 - G.z0) / G.cell);
const cells = new Map();
const key = (i, j, k) => (i * ny + j) * nz + k;
for (let t = 0; t < N; t++) {
  const o = t * 9;
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) {
    mn[a] = Math.min(mn[a], T[o + k * 3 + a]);
    mx[a] = Math.max(mx[a], T[o + k * 3 + a]);
  }
  const i0 = Math.max(0, Math.floor((mn[0] - G.x0) / G.cell));
  const i1 = Math.min(nx - 1, Math.floor((mx[0] - G.x0) / G.cell));
  const j0 = Math.max(0, Math.floor((mn[1] - G.y0) / G.cell));
  const j1 = Math.min(ny - 1, Math.floor((mx[1] - G.y0) / G.cell));
  const k0 = Math.max(0, Math.floor((mn[2] - G.z0) / G.cell));
  const k1 = Math.min(nz - 1, Math.floor((mx[2] - G.z0) / G.cell));
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
    const c = key(i, j, k);
    if (!cells.has(c)) cells.set(c, []);
    cells.get(c).push(t);
  }
}

/** Möller-Trumbore; returns t (>0) and whether the ray meets the front face. */
function hit(t, ox, oy, oz, dx, dy, dz) {
  const o = t * 9;
  const ax = T[o], ay = T[o + 1], az = T[o + 2];
  const e1x = T[o + 3] - ax, e1y = T[o + 4] - ay, e1z = T[o + 5] - az;
  const e2x = T[o + 6] - ax, e2y = T[o + 7] - ay, e2z = T[o + 8] - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const sx = ox - ax, sy = oy - ay, sz = oz - az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < -1e-7 || u > 1 + 1e-7) return null;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-7 || u + v > 1 + 1e-7) return null;
  const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (tt <= 1e-6) return null;
  // det = -dot(dir, e1 x e2): positive when the ray meets the face against its
  // normal, i.e. the counter-clockwise (front) side, which is what is drawn.
  return { t: tt, front: det > 0 };
}

/** First front-facing hit along the ray, before tMax (grid march). */
function firstFront(ox, oy, oz, dx, dy, dz, tMax) {
  let i = Math.floor((ox - G.x0) / G.cell);
  let j = Math.floor((oy - G.y0) / G.cell);
  let k = Math.floor((oz - G.z0) / G.cell);
  const step = [Math.sign(dx), Math.sign(dy), Math.sign(dz)];
  const d = [dx, dy, dz];
  const o = [ox, oy, oz];
  const idx = [i, j, k];
  const g0 = [G.x0, G.y0, G.z0];
  const tNext = [0, 0, 0];
  const tDelta = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    if (d[a] === 0) {
      tNext[a] = Infinity;
      tDelta[a] = Infinity;
    } else {
      const edge = g0[a] + (idx[a] + (d[a] > 0 ? 1 : 0)) * G.cell;
      tNext[a] = (edge - o[a]) / d[a];
      tDelta[a] = G.cell / Math.abs(d[a]);
    }
  }
  const seen = new Set();
  let best = Infinity;
  for (let guard = 0; guard < 4000; guard++) {
    if (idx[0] < 0 || idx[0] >= nx || idx[1] < 0 || idx[1] >= ny || idx[2] < 0 || idx[2] >= nz) break;
    const list = cells.get(key(idx[0], idx[1], idx[2]));
    if (list) {
      for (const t of list) {
        if (seen.has(t)) continue;
        seen.add(t);
        const h = hit(t, ox, oy, oz, dx, dy, dz);
        if (h && h.front && h.t < best) best = h.t;
      }
    }
    const tExit = Math.min(tNext[0], tNext[1], tNext[2]);
    if (best <= tExit || tExit > tMax) break;
    const a = tNext[0] <= tNext[1] && tNext[0] <= tNext[2] ? 0 : tNext[1] <= tNext[2] ? 1 : 2;
    idx[a] += step[a];
    tNext[a] += tDelta[a];
  }
  return best;
}

/** Where the ray leaves through a portal (the mouth, the collar), or Infinity. */
function portalT(ox, oy, oz, dx, dy, dz) {
  let best = Infinity;
  // The mouth: the tube's outer end, the slanted plane z = footZ + 2.5 - h / 9
  // (it follows the cliff's lean), inside the arch's box. A camera already on
  // its far side counts from where it stands.
  {
    const F0 = CAVE.footZ + 2.5;
    const num = F0 - oz - (oy - CAVE.floorY) / 9;
    const den = dz + dy / 9;
    if (den > 1e-9 || num < 0) {
      const t = num < 0 ? 0 : num / den;
      const x = ox + dx * t;
      const y = oy + dy * t;
      if (t >= 0 && Math.abs(x - CAVE.x) < CAVE.mouthHalfW && y > CAVE.floorY && y < CAVE.floorY + CAVE.mouthH) best = Math.min(best, Math.max(t, 1e-6));
    }
  }
  if (dy > 1e-9) {
    const t = (SHAFT.topY - oy) / dy;
    const x = ox + dx * t;
    const z = oz + dz * t;
    if (t > 0 && x > SHAFT.x0 && x < SHAFT.x1 && z > SHAFT.z0 && z < SHAFT.z1) best = Math.min(best, t);
  }
  return best;
}

// ── Directions (Fibonacci sphere) and the camera's samples ──
const DIRS = [];
const ND = 400;
for (let i = 0; i < ND; i++) {
  const y = 1 - (2 * (i + 0.5)) / ND;
  const r = Math.sqrt(1 - y * y);
  const a = i * Math.PI * (3 - Math.sqrt(5));
  DIRS.push([Math.cos(a) * r, y, Math.sin(a) * r]);
}
const curve = new THREE.CatmullRomCurve3(TRAIL.map((q) => new THREE.Vector3(q[0], q[1], q[2])), false, "centripetal");
const n1 = TRAIL.length - 1;
const k0 = CAVE_KEYS.first + 0.7;
const k1 = SHAFT_KEYS.last - 1.2;
let leaks = 0;
let rays = 0;
let minNear = Infinity;
let minAt = null;
const leakAt = [];
const p = new THREE.Vector3();
for (let kk = k0; kk <= k1 + 1e-9; kk += 0.1) {
  curve.getPoint(kk / n1, p);
  if (p.z > CAVE.footZ + 1 || p.y > SHAFT.topY - 6) continue;
  let near = Infinity;
  let leakHere = 0;
  for (const [dx, dy, dz] of DIRS) {
    rays++;
    const tp = portalT(p.x, p.y, p.z, dx, dy, dz);
    const tf = firstFront(p.x, p.y, p.z, dx, dy, dz, Math.min(tp, 3000));
    if (tf < near) near = tf;
    if (tf === Infinity && tp === Infinity) {
      if (leaks < 6) console.log("  leak", [p.x, p.y, p.z].map((v) => +v.toFixed(1)), "dir", [dx, dy, dz].map((v) => +v.toFixed(2)));
      leaks++;
      leakHere++;
    }
  }
  if (near < minNear) {
    minNear = near;
    minAt = { key: +kk.toFixed(2), at: [p.x, p.y, p.z].map((v) => +v.toFixed(1)) };
  }
  if (leakHere) leakAt.push({ key: +kk.toFixed(2), at: [p.x, p.y, p.z].map((v) => Math.round(v)), rays: leakHere });
}
console.log(`rays ${rays}, leaks ${leaks}`);
if (leakAt.length) console.log("leaks at:", JSON.stringify(leakAt.slice(0, 12)));
console.log(`nearest shell surface to the camera: ${minNear.toFixed(2)} at key ${minAt?.key} ${JSON.stringify(minAt?.at)} (near plane 2)`);
const st = blocks.stats();
console.log(`blocks triangles ${st.triangles}, meshes ${st.meshes}, mine ${st.tris_mine}, a6 ${st.tris_a6}, magic ${st.tris_magic}`);
console.log(leaks === 0 && minNear > 2.5 ? "PASS" : "FAIL");
blocks.dispose();
