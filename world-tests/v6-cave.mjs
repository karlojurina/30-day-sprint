/**
 * v6 cave (world_art_bible_v6.md 1.7, 1.8, 5.1): the cave behind the falls on
 * the gorge's south wall and its side passage.
 *
 *   node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-cave.mjs
 *
 * 2026-10-13 (Lovro: "the camera between Video Ads 1 and Video Ads 2 goes into
 * the cave for no reason. Just going straight from Video Ads 1 screen to Video
 * Ads 2 and giving it a nice path"): the camera no longer enters the cave. The
 * cave itself stays in the world, built and dressed as it was. So this test
 * turned round: it used to prove the camera's pass through the cave (every
 * sample of the "cave" stretch inside the void, and the pass coming after a3);
 * now it proves the cave is still there and that the route stays out of it.
 *
 *   - the cave still builds: blocks.ts's two shells (the hall with its mouth,
 *     and the side passage) come out with their triangles, mirrored into the
 *     world where layout CAVE and CAVE_EXIT put them. (The camp, the lamps and
 *     the lit walls are dress-underground.ts's, which needs a browser: the
 *     dev page's moduleStats() has its figures.)
 *   - the mouth is behind the curtain (the curtain lands >= 3 in front of the
 *     arch at every height and is >= 5 wider each side);
 *   - the terrain stays >= CAVE_COVER over the hall and the side passage except
 *     at the two portals, and each portal breaks the surface (open air there);
 *   - the side passage is 60-100 long inside the rock, rises east, and opens
 *     on the cliff face 70-110 east of the curtain's east edge;
 *   - the route never enters the cave: no key of kind "cave" (layout
 *     CAVE_KEYS is empty), and on the rail as the scene builds it (createRail,
 *     the scene's ground) no stretch is of an UNDERGROUND kind, every sample
 *     is outside the void (caveMargin < 0) and above the terrain's surface,
 *     and a3 stands outside.
 * Exit code 1 on any failure.
 */
import * as THREE from "three";
import * as L from "../src/lib/world-v6/layout.ts";
import { terrainHeight } from "../src/lib/world-v6/terrain.ts";
import { createRail } from "../src/lib/world-v6/rail.ts";
import { railGround } from "../src/lib/world-v6/scene.ts";
import { install as installBlocks } from "../src/lib/world-v6/blocks.ts";

let failures = 0;
const check = (name, pass, value) => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
};
const r1 = (v) => Math.round(v * 10) / 10;
const C = L.CAVE;
const CB = L.CAVE_BUILD;
const F = L.WORLD.falls;

// 1. The cave still builds.
{
  const scene = new THREE.Scene();
  const blocks = installBlocks({ scene, camera: new THREE.PerspectiveCamera(), reducedMotion: true });
  scene.add(blocks.root);
  scene.updateMatrixWorld(true);
  const shell = (name) => {
    const o = blocks.root.getObjectByName(name);
    if (!o || !o.isMesh) return null;
    const g = o.geometry;
    const box = new THREE.Box3().setFromObject(o);
    return { tris: (g.index ? g.index.count : g.getAttribute("position").count) / 3, box };
  };
  const hall = shell("Mine_Cave");
  const passage = shell("Mine_Tunnel");
  const inBox = (b, x, y, z, pad) => !!b && x >= b.min.x - pad && x <= b.max.x + pad && y >= b.min.y - pad && y <= b.max.y + pad && z >= b.min.z - pad && z <= b.max.z + pad;
  // The hall: its floor's ellipse and the top of its dome, and the mouth's sill at the cliff's foot.
  const hallPts = [
    [C.hallX - C.rx * 0.9, C.floorY + 4, C.hallZ],
    [C.hallX + C.rx * 0.9, C.floorY + 4, C.hallZ],
    [C.hallX, C.floorY + 4, C.hallZ + C.rz * 0.9],
    [C.hallX, C.floorY + C.hallH - 4, C.hallZ],
    [C.x, C.floorY + 4, C.footZ],
  ];
  const hallOk = !!hall && hall.tris >= 1000 && hallPts.every((p) => inBox(hall.box, p[0], p[1], p[2], 2));
  // The side passage: every point of its centreline, at eye height.
  const passOk = !!passage && passage.tris >= 300 && L.CAVE_EXIT.every((p) => inBox(passage.box, p[0], p[1] + L.CAVE_EXIT_EYE, p[2], 2));
  const fmt = (s) => (s ? `${s.tris} triangles, x ${Math.round(s.box.min.x)}..${Math.round(s.box.max.x)}, y ${Math.round(s.box.min.y)}..${Math.round(s.box.max.y)}, z ${Math.round(s.box.min.z)}..${Math.round(s.box.max.z)}` : "MISSING");
  check("the cave still builds: the hall's shell (with its mouth) and the side passage's, where layout CAVE and CAVE_EXIT put them", hallOk && passOk, `hall ${fmt(hall)}; passage ${fmt(passage)}`);
  blocks.dispose();
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
// 4. The route never enters the cave.
{
  const rail = createRail();
  rail.setGround(railGround);
  const pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  const caveKeys = L.TRAIL_KIND.filter((k) => k === "cave").length;
  let underKind = 0;
  let below = 0;
  let nearest = { v: -Infinity };
  let n = 0;
  for (let s = 0; s <= rail.length; s += 2) {
    n++;
    if (L.UNDERGROUND.includes(rail.kindAtS(s))) underKind++;
    rail.sampleS(s, pose);
    const { x, y, z } = pose.position;
    if (y < terrainHeight(x, z)) below++;
    const m = L.caveMargin(x, y, z);
    if (m > nearest.v) nearest = { v: r1(m), s: Math.round(s), kind: rail.kindAtS(s), p: [x, y, z].map(Math.round) };
  }
  check(
    "the route never enters the cave: no key of kind cave (CAVE_KEYS empty), no stretch of an UNDERGROUND kind, every sample of the rail outside the void and above the terrain's surface",
    caveKeys === 0 && L.CAVE_KEYS.first === -1 && L.CAVE_KEYS.last === -1 && underKind === 0 && below === 0 && nearest.v < 0,
    `${caveKeys} cave keys, CAVE_KEYS ${L.CAVE_KEYS.first}..${L.CAVE_KEYS.last}; of ${n} samples ${underKind} of an underground kind, ${below} under the surface; nearest to the void ${JSON.stringify(nearest)} (negative is outside)`,
  );
  const a3 = L.PLACES[2];
  const p = L.TRAIL[a3.trail];
  check("a3 stands outside the cave, in the open", L.caveMargin(...p) < 0 && p[1] > terrainHeight(p[0], p[2]), `a3 key ${a3.trail} at ${p.join(", ")}: ${r1(-L.caveMargin(...p))} from the void, ${Math.round(p[1] - terrainHeight(p[0], p[2]))} over the ground`);
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\ncave: all pass");
process.exit(failures ? 1 : 0);
