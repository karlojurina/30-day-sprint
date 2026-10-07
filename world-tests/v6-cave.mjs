/**
 * v6 cave (world_art_bible_v6.md 1.7, 1.8, 5.1): the cave behind the falls on
 * the gorge's south wall, its side passage, and the locked click-in view.
 *
 *   node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-cave.mjs
 *
 * On the rail as the scene builds it (createRail, the scene's ground):
 *   - every sample of a "cave" stretch is inside the void (caveMargin >= 3)
 *     or in open air (>= 15 over the ground or the pool, >= 8 from rock);
 *   - the mouth is behind the curtain (the curtain lands >= 3 in front of the
 *     arch at every height and is >= 5 wider each side);
 *   - the terrain stays >= CAVE_COVER over the hall and the side passage except
 *     at the two portals, and each portal breaks the surface (open air there);
 *   - the side passage is 60-100 long inside the rock, rises east, and opens
 *     on the cliff face 70-110 east of the curtain's east edge;
 *   - round 1 (decision 46): the cave's click-in view is no longer locked and
 *     a3 stands outside; the camera passes through the cave after it: the
 *     curtain, the camp's side of the hall, and out along the side passage.
 * Exit code 1 on any failure.
 */
import * as THREE from "three";
import * as L from "../src/lib/world-v6/layout.ts";
import { terrainHeight } from "../src/lib/world-v6/terrain.ts";
import { createRail } from "../src/lib/world-v6/rail.ts";
import { railGround } from "../src/lib/world-v6/scene.ts";

let failures = 0;
const check = (name, pass, value) => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
};
const r1 = (v) => Math.round(v * 10) / 10;
const C = L.CAVE;
const CB = L.CAVE_BUILD;
const F = L.WORLD.falls;
const P = L.WORLD.pool;

const rail = createRail();
rail.setGround(railGround);
const pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
const n = L.TRAIL.length;
function sAtKey(f) {
  let lo = 0;
  let hi = rail.length;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (rail.tAtS(m) < f / (n - 1)) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
function rockWithin(x, y, z, r) {
  for (let d = 2; d <= r; d += 2) {
    for (let a = 0; a < 32; a++) {
      const th = (a / 32) * Math.PI * 2;
      if (terrainHeight(x + Math.cos(th) * d, z + Math.sin(th) * d) > y) return true;
    }
  }
  return false;
}

// 1. The camera in the cave stretch.
{
  const s0 = sAtKey(L.CAVE_KEYS.first) - 10;
  const s1 = sAtKey(L.CAVE_KEYS.last) + 10;
  const bad = [];
  let inside = 0;
  let closest = { v: Infinity };
  for (let s = s0; s <= s1; s += 2) {
    rail.sampleS(s, pose);
    const { x, y, z } = pose.position;
    const m = L.caveMargin(x, y, z);
    if (m >= 3) {
      inside++;
      if (m < closest.v) closest = { v: r1(m), p: [x, y, z].map(Math.round) };
      continue;
    }
    const ground = Math.hypot(x - P.x, z - P.z) < P.r ? P.y : terrainHeight(x, z);
    const open = y - ground >= 15 && !rockWithin(x, y, z, 8);
    if (!open) bad.push({ s: Math.round(s), m: r1(m), p: [x, y, z].map(Math.round) });
  }
  check("the rail through the cave: inside the void (>= 3) or in open air (>= 15 up, >= 8 from rock)", bad.length === 0 && inside > 40, bad.length ? `${bad.length} bad, first ${JSON.stringify(bad.slice(0, 3))}` : `${inside} samples inside; closest to a wall ${JSON.stringify(closest)}`);
}
// 2. The mouth behind the curtain.
{
  let worst = Infinity;
  for (let y = C.floorY; y <= C.floorY + C.mouthH; y += 2) {
    const [, cz] = L.fallsCurtainAt(y);
    worst = Math.min(worst, C.footZ + (y - C.floorY) / 9 - cz);
  }
  check("the mouth is behind the curtain (>= 3 at every height; the curtain >= 5 wider each side)", worst >= 3 && F.width / 2 - C.mouthHalfW >= 5, `nearest ${r1(worst)}; ${F.width / 2 - C.mouthHalfW} wider each side`);
}
// 3. Rock over the voids, open at the portals.
{
  let min = { v: Infinity };
  const hallTop = (r) => CB.floorY + Math.max(CB.mouthH, CB.hallH * Math.sqrt(Math.max(0, 1 - r * r)));
  for (let x = CB.hallX - CB.rx; x <= CB.hallX + CB.rx; x += 3) {
    for (let bz = CB.hallZ - CB.rz; bz <= CB.hallZ + CB.rz; bz += 3) {
      const r = Math.hypot((x - CB.hallX) / CB.rx, (bz - CB.hallZ) / CB.rz);
      if (r > 1 || (Math.abs(x - CB.x) < CB.mouthHalfW + 8 && bz > CB.footZ - 16)) continue;
      const v = terrainHeight(x, L.caveMirrorZ(bz)) - hallTop(r);
      if (v < min.v) min = { v: r1(v), where: "hall", p: [x, L.caveMirrorZ(bz)].map(Math.round) };
    }
  }
  const E = L.CAVE_EXIT;
  let len = 0;
  for (let i = 0; i < E.length - 1; i++) {
    const a = E[i];
    const b = E[i + 1];
    for (let u = 0; u <= 1; u += 0.05) {
      const x = a[0] + (b[0] - a[0]) * u;
      const z = a[2] + (b[2] - a[2]) * u;
      const inHall = Math.hypot((x - C.hallX) / C.rx, (z - C.hallZ) / C.rz) < 1;
      const ground = terrainHeight(x, z);
      const roof = a[1] + (b[1] - a[1]) * u + L.CAVE_EXIT_H;
      if (!inHall && ground > roof) len += (Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.05);
      if (Math.hypot(x - L.CAVE_EXIT_OPENING.x, z - L.CAVE_EXIT_OPENING.z) < 30) continue;
      if (ground - roof < min.v) min = { v: r1(ground - roof), where: `exit ${i}`, p: [x, z].map(Math.round) };
    }
  }
  check(`the terrain stays >= ${L.CAVE_COVER} over the hall and the side passage, except at the portals`, min.v >= L.CAVE_COVER, min);
  const O = L.CAVE_EXIT_OPENING;
  const eastEdge = F.top[0] + F.width / 2;
  const rises = E[E.length - 1][1] > E[0][1] && E[E.length - 1][0] > E[0][0];
  const opens = terrainHeight(O.x, O.z - 10) < O.y;
  check("the side passage: 60-100 inside the rock, rising east, opening on the cliff face 70-110 east of the curtain's east edge", len >= 60 && len <= 100 && rises && opens && O.x - eastEdge >= 70 && O.x - eastEdge <= 110, `${Math.round(len)} in rock, rises ${rises}, open air in front ${opens}, ${Math.round(O.x - eastEdge)} east of the curtain`);
}
// 4. Round 1: a3 is outside the cave, and the pass-through comes after it.
{
  const a3 = L.PLACES[2];
  const p = L.TRAIL[a3.trail];
  const out = L.caveMargin(...p) < 0 && p[1] > terrainHeight(p[0], p[2]);
  const after = L.CAVE_KEYS.first > a3.trail && L.CAVE_KEYS.last > L.CAVE_KEYS.first;
  check("a3 stands outside the cave and the pass-through (the cave keys) comes after it", out && after, `a3 key ${a3.trail}, cave keys ${L.CAVE_KEYS.first}-${L.CAVE_KEYS.last}`);
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\ncave: all pass");
process.exit(failures ? 1 : 0);
