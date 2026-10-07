// Worst-case drawn triangles for the tree LOD config scene.ts actually ships
// (2026-09-24: TREE_LOW_RATIO 0.15, TREE_NEAR_BAND 70 lateral to the path,
// TREE_SLAB 250, TREE_DETAIL_DIST 650), swept over camera z along the rail.
//
//   node --experimental-strip-types --no-warnings world-tests/v2-tree-slabs.mjs
//
// Two numbers per camera z: every slab counted (the upper bound, no culling),
// and slabs wholly behind the camera dropped (camera looks toward -z), which
// is roughly what frustum culling of the slab InstancedMeshes removes.
// Constants are read out of scene.ts so this cannot silently drift from it;
// BAND=.. DETAIL=.. override two of them to try a fix.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { simplifyForDistance } from "../src/lib/world-v2/trees.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../src/lib/world-v2/scene.ts"), "utf8");
const constant = (name) => { const m = src.match(new RegExp(`const ${name} = ([0-9.]+);`)); if (!m) throw new Error(`${name} not in scene.ts`); return Number(m[1]); };
// Env overrides (BAND, DETAIL) let the sweep try a fix without editing scene.ts.
const LOW = constant("TREE_LOW_RATIO"), SLAB = constant("TREE_SLAB");
const BAND = Number(process.env.BAND ?? constant("TREE_NEAR_BAND")), DETAIL = Number(process.env.DETAIL ?? constant("TREE_DETAIL_DIST"));
console.log(`${process.env.BAND || process.env.DETAIL ? "OVERRIDDEN" : "scene.ts"}: low ratio ${LOW}, near band ${BAND}, slab ${SLAB}, detail distance ${DETAIL}`);

const buf = fs.readFileSync(path.join(here, "../public/world/world.glb"));
const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", res, rej));
gltf.scene.updateMatrixWorld(true);
const PATH = [[0.055, 0], [0.135, -0.40], [0.265, 0.34], [0.378, 0], [0.5, 0.098], [0.59, -0.24], [0.615, -0.30], [0.73, -0.26], [0.7875, 0.12], [0.86, 0.10], [0.94, -0.10], [1, -0.10]];
const pathXAtT = (t) => { if (t <= PATH[0][0]) return PATH[0][1]; for (let i = 0; i < PATH.length - 1; i++) { const [t0, v0] = PATH[i], [t1, v1] = PATH[i + 1]; if (t0 <= t && t <= t1) { let k = (t - t0) / Math.max(1e-6, t1 - t0); k = k * k * (3 - 2 * k); return v0 + (v1 - v0) * k; } } return PATH[PATH.length - 1][1]; };
const pathXAtZ = (z) => pathXAtT((1000 - z) / 2000) * 310;

const byGeo = new Map(); let other = 0;
gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  const tris = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
  if (/Tree/.test(o.material.name)) { if (!byGeo.has(o.geometry.uuid)) byGeo.set(o.geometry.uuid, { g: o.geometry, tris, at: [] }); byGeo.get(o.geometry.uuid).at.push([o.matrixWorld.elements[12], o.matrixWorld.elements[14]]); }
  else other += tris;
});
const trees = [];
for (const p of byGeo.values()) {
  const low = simplifyForDistance(p.g, LOW).index.count / 3;
  for (const [x, z] of p.at) trees.push({ z, near: Math.abs(x - pathXAtZ(z)) <= BAND, full: p.tris, low, slab: Math.min(7, Math.max(0, Math.floor((z + 1000) / SLAB))) });
}
console.log(`near-path trees (lateral <= ${BAND}): ${trees.filter((t) => t.near).length} of ${trees.length}`);
let worst = { all: 0, ahead: 0 };
for (let camZ = 1250; camZ >= -1000; camZ -= 25) {
  let all = other, ahead = other;
  for (const t of trees) {
    const zMin = -1000 + t.slab * SLAB, zMax = zMin + SLAB;
    const dz = camZ < zMin ? zMin - camZ : camZ > zMax ? camZ - zMax : 0;
    const tris = t.near && dz < DETAIL ? t.full : t.low;
    all += tris;
    if (zMin <= camZ) ahead += tris; // slab not wholly behind the camera
  }
  if (all > worst.all) { worst.all = all; worst.allZ = camZ; }
  if (ahead > worst.ahead) { worst.ahead = ahead; worst.aheadZ = camZ; }
}
console.log(`worst case, every slab drawn:        ${(worst.all / 1e6).toFixed(2)}M at camera z ${worst.allZ}`);
console.log(`worst case, slabs behind camera cut: ${(worst.ahead / 1e6).toFixed(2)}M at camera z ${worst.aheadZ}`);
