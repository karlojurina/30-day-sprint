/**
 * The Gate's cloud bank (dress-sky.ts GATE_BANK, gateBank) against its job,
 * on the faces it draws. Second Loom, 2026-10-16 (5:20 to 5:44: "these huge
 * ass clouds ... very distracting"): the bank was cut to the sight lines it
 * has to stop, so this checks those sight lines against the drawn clusters
 * and the core strip, front faces only (as three draws them), where
 * v6-route.mjs's N9 checks a solid box at 16:9.
 *
 *   node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-gate-bank.mjs
 *
 * Offline, no browser, no server. About 2 minutes.
 *
 *   1  hidden: every sight line to the Gate isle (its top 40 over the
 *      ground, its underside, the arch's face on a grid, the hall's top)
 *      from every camera before the flight that is higher than showAbove
 *      (the rail at every 3rd of 8,000 samples) and from the Ad Bounty's
 *      click-in (bounty.ts BOUNTY.park), at 16:9, 1.92 (Lovro's window) and
 *      2.79 (the widest review size), in the frame and not hidden by terrain,
 *      the other isles or the cloud layer, meets a front face of the bank.
 *   2  the flight never sees it: in no flight frame (FLIGHT_KEYS, the same
 *      three aspects) is a bank vertex in the frame and clear of terrain.
 *   3  it is no wall: in Lovro's frames at 1.92 (5:09, key 64; 5:22, key
 *      64.65; the bridge at 5:28, key 66.3) the bank's box on screen, shown;
 *      on the bridge it is out of the frame.
 *
 * Exit 1 on any FAIL.
 */
import * as THREE from "three";
import * as L from "../src/lib/world-v6/layout.ts";
import { terrainHeight } from "../src/lib/world-v6/terrain.ts";
import { BOUNTY } from "../src/lib/world-v6/bounty.ts";

// rocks first: dress-sky -> rocks -> dress-gate -> dress-sky is a cycle that only resolves in that order.
await import("../src/lib/world-v6/rocks.ts");
const SKY = await import("../src/lib/world-v6/dress-sky.ts");
const { WORLD, PLACES, TRAIL, LOOK } = L;
let failures = 0;
const check = (name, pass, value) => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
};

// ── The bank as drawn ──
const geo = new SKY.Geo();
const clusters = SKY.gateBank(geo);
const P = geo.p;
const nTri = P.length / 9;
const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (let i = 0; i < P.length; i += 3)
  for (let k = 0; k < 3; k++) {
    bb[k] = Math.min(bb[k], P[i + k]);
    bb[k + 3] = Math.max(bb[k + 3], P[i + k]);
  }
console.log(`the bank: ${clusters} clusters, ${nTri} triangles, drawn x ${bb[0].toFixed(0)} to ${bb[3].toFixed(0)}, y ${bb[1].toFixed(0)} to ${bb[4].toFixed(0)}, z ${bb[2].toFixed(0)} to ${bb[5].toFixed(0)}`);
const CELL = 20;
const grid = new Map();
const key = (i, j) => i * 100000 + j;
for (let t = 0; t < nTri; t++) {
  const o = t * 9;
  const x0 = Math.min(P[o], P[o + 3], P[o + 6]);
  const x1 = Math.max(P[o], P[o + 3], P[o + 6]);
  const y0 = Math.min(P[o + 1], P[o + 4], P[o + 7]);
  const y1 = Math.max(P[o + 1], P[o + 4], P[o + 7]);
  for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
    for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
      let a = grid.get(key(i, j));
      if (!a) grid.set(key(i, j), (a = []));
      a.push(t);
    }
}
/** Does the segment o -> p meet a front face of the bank (counter-clockwise from the side it faces)? */
function hitsBank(o, p) {
  const dx = p[0] - o.x;
  const dy = p[1] - o.y;
  const dz = p[2] - o.z;
  const u0 = Math.max(0, Math.min((bb[2] - o.z) / dz, (bb[5] - o.z) / dz));
  const u1 = Math.min(1, Math.max((bb[2] - o.z) / dz, (bb[5] - o.z) / dz));
  if (u1 <= u0) return false;
  const xa = o.x + dx * u0;
  const xb = o.x + dx * u1;
  const ya = o.y + dy * u0;
  const yb = o.y + dy * u1;
  const seen = new Set();
  for (let i = Math.floor(Math.min(xa, xb) / CELL); i <= Math.floor(Math.max(xa, xb) / CELL); i++)
    for (let j = Math.floor(Math.min(ya, yb) / CELL); j <= Math.floor(Math.max(ya, yb) / CELL); j++) {
      const a = grid.get(key(i, j));
      if (!a) continue;
      for (const t of a) {
        if (seen.has(t)) continue;
        seen.add(t);
        const q = t * 9;
        const e1x = P[q + 3] - P[q], e1y = P[q + 4] - P[q + 1], e1z = P[q + 5] - P[q + 2];
        const e2x = P[q + 6] - P[q], e2y = P[q + 7] - P[q + 1], e2z = P[q + 8] - P[q + 2];
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        if (nx * dx + ny * dy + nz * dz >= 0) continue;
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-9) continue;
        const inv = 1 / det;
        const tx = o.x - P[q], ty = o.y - P[q + 1], tz = o.z - P[q + 2];
        const uu = (tx * px + ty * py + tz * pz) * inv;
        if (uu < 0 || uu > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const vv = (dx * qx + dy * qy + dz * qz) * inv;
        if (vv < 0 || uu + vv > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt > 0 && tt < 1) return true;
      }
    }
  return false;
}

// ── The cameras ──
const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const posCurve = new THREE.CatmullRomCurve3(TRAIL.map(v3), false, "centripetal");
const lookCurve = new THREE.CatmullRomCurve3(LOOK.map(v3), false, "centripetal");
const nK = TRAIL.length;
const N = 8000;
const tF = L.FLIGHT_KEYS.first / (nK - 1);
const tFe = L.FLIGHT_KEYS.last / (nK - 1);
const before = [];
const flight = [];
for (let i = 0; i <= N; i += 3) {
  const t = i / N;
  const p = posCurve.getPoint(t);
  const c = { name: `key ${(t * (nK - 1)).toFixed(2)}`, p, q: lookCurve.getPoint(t), fov: L.fovAtKey(t * (nK - 1)) };
  if (t < tF && p.y > SKY.GATE_BANK.showAbove) before.push(c);
  else if (t >= tF && t <= tFe) flight.push(c);
}
{
  const k = BOUNTY.park;
  const b = (k.bearing * Math.PI) / 180;
  const pt = (k.pitch * Math.PI) / 180;
  const p = new THREE.Vector3(k.x, k.y, k.z);
  before.push({ name: "the Ad Bounty's click-in", p, q: p.clone().add(new THREE.Vector3(Math.sin(b) * Math.cos(pt), -Math.sin(pt), -Math.cos(b) * Math.cos(pt)).multiplyScalar(500)), fov: k.fov });
}
const camOf = (c, aspect) => {
  const cam = new THREE.PerspectiveCamera(c.fov, aspect, 1, 30000);
  cam.position.copy(c.p);
  cam.lookAt(c.q);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
};

// ── What hides the isle besides the bank ──
const ISLES = [
  { c: WORLD.island, depth: L.ISLAND_DEPTH },
  { c: WORLD.bountyIsle, depth: L.BOUNTY_DEPTH },
  { c: WORLD.gateIsle, depth: L.GATE_DEPTH },
];
const inIsle = (x, y, z) => {
  for (const { c, depth } of ISLES) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r && y <= c.y && y >= c.y - depth * (1 - d / c.r)) return true;
  }
  return false;
};
const CL = WORLD.cloudClear;
const inCloudAt = (x, z) => Math.hypot(x - CL.x, z - CL.z) > CL.r;
function hidden(o, p, isles) {
  const dx = p[0] - o.x;
  const dy = p[1] - o.y;
  const dz = p[2] - o.z;
  const steps = Math.ceil(Math.hypot(dx, dy, dz) / 12);
  let prevY = o.y;
  for (let k = 2; k < steps - 2; k++) {
    const u = k / steps;
    const x = o.x + dx * u;
    const y = o.y + dy * u;
    const z = o.z + dz * u;
    if (terrainHeight(x, z) > y) return true;
    if (isles && inIsle(x, y, z)) return true;
    if ((prevY - WORLD.cloudLevel) * (y - WORLD.cloudLevel) <= 0 && inCloudAt(x, z)) return true;
    prevY = y;
  }
  return false;
}
const target = [];
{
  const H = WORLD.gateIsle;
  for (let ri = 0; ri <= 6; ri++) {
    const r = (ri / 6) * H.r;
    const n = ri === 0 ? 1 : 28;
    for (let a = 0; a < n; a++) {
      const th = (a / n) * Math.PI * 2;
      const x = H.x + Math.cos(th) * r;
      const z = H.z + Math.sin(th) * r;
      target.push([x, H.y + 40, z]);
      target.push([x, H.y - L.GATE_DEPTH * (1 - r / H.r) - 4, z]);
    }
  }
  const G = L.GATE;
  const ax = Math.sin((G.axis * Math.PI) / 180);
  const az = -Math.cos((G.axis * Math.PI) / 180);
  for (let u = -0.5; u <= 0.5; u += 0.05)
    for (let h = 0; h <= 1.0001; h += 0.05) target.push([G.x - az * (G.openW + 2 * G.pillarW) * u, G.y + G.height * h, G.z + ax * (G.openW + 2 * G.pillarW) * u]);
  const hall = PLACES.find((p) => p.id === "a8");
  target.push([hall.pos.x, hall.pos.y + hall.height, hall.pos.z]);
}

// ── 1 and 2 ──
for (const [name, aspect] of [["16:9", 16 / 9], ["1.92", 1.92], ["2.79", 2.79]]) {
  let rays = 0;
  let leaks = 0;
  let worst = null;
  for (const c of before) {
    const cam = camOf(c, aspect);
    let n = 0;
    for (const p of target) {
      const v = new THREE.Vector3(p[0], p[1], p[2]).project(cam);
      if (!(v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1)) continue;
      if (hidden(c.p, p, true)) continue;
      rays++;
      if (hitsBank(c.p, p)) continue;
      leaks++;
      n++;
    }
    if (n && (!worst || n > worst.n)) worst = { camera: c.name, n };
  }
  check(`1 hidden at ${name}: every open sight line to the Gate isle before the flight meets the bank`, leaks === 0, `${rays} sight lines, ${leaks} get past${worst ? `, most from ${worst.camera} (${worst.n})` : ""}`);
  let seen = 0;
  let first = null;
  for (const c of flight) {
    const cam = camOf(c, aspect);
    let here = 0;
    for (let i = 0; i < P.length; i += 36) {
      const p = [P[i], P[i + 1], P[i + 2]];
      const v = new THREE.Vector3(p[0], p[1], p[2]).project(cam);
      if (!(v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1)) continue;
      if (hidden(c.p, p, false)) continue;
      here++;
    }
    if (here) {
      seen++;
      if (!first) first = c.name;
    }
  }
  check(`2 the flight never sees it at ${name}`, seen === 0, `${seen} of ${flight.length} flight frames${first ? `, first at ${first}` : ""}`);
}

// ── 3 ──
const box = (at) => {
  const t = at / (nK - 1);
  const cam = camOf({ p: posCurve.getPoint(t), q: lookCurve.getPoint(t), fov: L.fovAtKey(at) }, 1.92);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0;
  for (let i = 0; i < P.length; i += 3) {
    const v = new THREE.Vector3(P[i], P[i + 1], P[i + 2]).project(cam);
    if (!(v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1)) continue;
    n++;
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
    y0 = Math.min(y0, v.y);
    y1 = Math.max(y1, v.y);
  }
  return n ? `x ${((x0 + 1) * 50).toFixed(0)} to ${((x1 + 1) * 50).toFixed(0)}% of the width, y ${((1 - y1) * 50).toFixed(0)} to ${((1 - y0) * 50).toFixed(0)}% from the top` : "out of the frame";
};
console.log(`3 Lovro's frames at 1.92: 5:09 (key 64) ${box(64)}; 5:22 (key 64.65) ${box(64.65)}`);
check("3 it is no wall: on the rope bridge at 5:28 (key 66.3) the bank is out of the frame", box(66.3) === "out of the frame", box(66.3));

console.log(failures ? `\n${failures} FAILED` : "\nall pass");
process.exit(failures ? 1 : 0);
