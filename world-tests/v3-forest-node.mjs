// forest.ts in node against the real terrain: counts, triangles, build time,
// and a top-down placement map (BMP) of trees, rocks and cottages.
//   node --experimental-strip-types --no-warnings world-tests/v3-forest-node.mjs [out.bmp]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildHeightfield } from "../src/lib/world-v3/heightfield.ts";
import { createRail } from "../src/lib/world-v3/rail.ts";
import { install } from "../src/lib/world-v3/forest.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const buf = fs.readFileSync(path.join(here, "../public/world/world.glb"));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, "", res, rej));
const root = gltf.scene;
const scene = new THREE.Scene();
scene.add(root);
root.updateMatrixWorld(true);
const hf = buildHeightfield(root, "Terrain");
const rail = createRail();
const landmarks = {};
root.traverse((o) => {
  if (!o.name.startsWith("LM_")) return;
  // As scene.ts landmarkBases(): box centre, on the higher of box bottom and ground.
  // Own mesh only: in this OLD uncompressed asset the lamp and blades children sit
  // far from their parents (the v3 draco asset has them in place).
  const b = new THREE.Box3();
  if (o.isMesh) { o.geometry.computeBoundingBox(); b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); } else b.setFromObject(o);
  const x = (b.min.x + b.max.x) / 2, z = (b.min.z + b.max.z) / 2;
  const y = Math.max(b.min.y, hf.heightAt(x, z));
  landmarks[o.name] = { x, y, z, height: b.max.y - y };
});
const riverXAtZ = (z) => {
  const t = (1000 - z) / 2000;
  if (!(t > 0.2 && t < 0.7)) return NaN;
  return 310 * (Math.sin(5.2 * t) * 0.3 + Math.sin(11 * t) * 0.08);
};
const camera = new THREE.PerspectiveCamera(31, 1.6, 1, 6000);
const ctx = {
  scene, root, camera,
  renderer: { domElement: { height: 600 } },
  heightAt: (x, z) => hf.heightAt(x, z),
  pathXAtZ: (z) => rail.pathXAtZ(z),
  riverXAtZ,
  landmarks,
  sunDir: new THREE.Vector3(-0.5, 0.25, -0.8).normalize(),
  sunColor: new THREE.Color(1, 0.8, 0.6),
  hazeColor: new THREE.Color(0.9, 0.7, 0.6),
  reducedMotion: false,
};
const before = { T: 0, R: 0, H: 0 };
root.traverse((o) => { if (/^T\d+/.test(o.name)) before.T++; if (/^R\d+/.test(o.name)) before.R++; if (/^House4000/.test(o.name)) before.H++; });
const mod = await install(ctx);
const after = { T: 0, R: 0, H: 0, occ: 0 };
root.traverse((o) => { if (/^T\d+/.test(o.name)) after.T++; if (/^R\d+/.test(o.name)) after.R++; if (/^House4000/.test(o.name)) after.H++;  });
console.log("kit before", before, "after", after, "(occluders counted below)");
console.log(mod.stats());

// Draw calls by slab and the cottages.
const forest = scene.getObjectByName("Forest");
const names = forest.children.map((c) => `${c.name}(${c.count ?? "-"})`);
console.log("meshes", names.length, names.join(" "));
scene.traverse((o) => { if (/^Cottage_/.test(o.name)) { after.occ++; const b = new THREE.Box3().setFromObject(o); console.log(o.name, "at", o.position.x.toFixed(0), o.position.z.toFixed(0), "base", b.min.y.toFixed(1), "top", b.max.y.toFixed(1), "ground", hf.heightAt(o.position.x, o.position.z).toFixed(1)); } });

// Top-down map, 2 units/pixel over x -868..868, z -1000..1000 (north = -z at top).
const W = 868, H = 1000, S = 2;
const out = process.argv[2] || path.join(here, "shots/v3/forest-topdown.bmp");
const iw = W, ih = H;
const px = new Uint8Array(iw * ih * 3);
for (let j = 0; j < ih; j++) for (let i = 0; i < iw; i++) {
  const x = -868 + i * S, z = -1000 + j * S;
  const h = hf.heightAt(x, z);
  const k = (j * iw + i) * 3;
  if (h < 0.5) { px[k] = 70; px[k + 1] = 90; px[k + 2] = 140; continue; }
  const g = Math.min(255, 90 + h * 0.4);
  px[k] = g; px[k + 1] = g * 0.95; px[k + 2] = g * 0.8;
  const pz = Math.abs(x - rail.pathXAtZ(z)) < 4.5;
  if (pz) { px[k] = 230; px[k + 1] = 220; px[k + 2] = 180; }
  const rx = riverXAtZ(z);
  if (rx === rx && Math.abs(x - rx) < 12) { px[k] = 90; px[k + 1] = 140; px[k + 2] = 200; }
}
const dot = (x, z, r, c) => {
  const ci = Math.round((x + 868) / S), cj = Math.round((z + 1000) / S);
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (di * di + dj * dj > r * r) continue;
    const i = ci + di, j = cj + dj;
    if (i < 0 || j < 0 || i >= iw || j >= ih) continue;
    const k = (j * iw + i) * 3; px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2];
  }
};
const m = new THREE.Matrix4(), p = new THREE.Vector3();
for (const im of forest.children) {
  if (!im.isInstancedMesh) continue;
  const c = im.name.includes("rocks") ? [140, 130, 120] : im.name.includes("broadleaf") ? [120, 150, 40] : im.name.includes("conifer2") ? [30, 90, 60] : [20, 60, 35];
  for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); p.setFromMatrixPosition(m); dot(p.x, p.z, im.name.includes("rocks") ? 2 : 2, c); }
}
scene.traverse((o) => { if (/^Cottage_/.test(o.name)) dot(o.position.x, o.position.z, 5, [200, 60, 40]); });
for (const [n, l] of Object.entries(landmarks)) dot(l.x, l.z, 6, [255, 200, 0]);
// BMP (bottom-up rows)
const rowBytes = Math.ceil((iw * 3) / 4) * 4;
const bmp = Buffer.alloc(54 + rowBytes * ih);
bmp.write("BM"); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
bmp.writeInt32LE(iw, 18); bmp.writeInt32LE(ih, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(rowBytes * ih, 34);
for (let j = 0; j < ih; j++) {
  const row = 54 + (ih - 1 - j) * rowBytes;
  for (let i = 0; i < iw; i++) { const k = (j * iw + i) * 3; bmp[row + i * 3] = px[k + 2]; bmp[row + i * 3 + 1] = px[k + 1]; bmp[row + i * 3 + 2] = px[k]; }
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bmp);
console.log("map", out);

// ── Violations: things the brief says must not happen. ──────────────────────
{
  const bank = (z) => { const t = (1000 - z) / 2000; return (t > 0.445 && t < 0.56 ? 7 : 13) + 12; };
  const lmPts = Object.entries(landmarks).filter(([n]) => !/Lamp|Blades/.test(n));
  const v = { rockInRiverWater: 0, rockOnPath: 0, treeOnPath: 0, treeInRiverWater: 0, treeWithin50OfLandmarkCentre: 0, treeBelowSea: 0, cottageFloating: 0, cottageNearLandmark: 0, cottagesOverlapping: 0 };
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  for (const im of forest.children) {
    if (!im.isInstancedMesh) continue;
    const rock = im.name.includes("rocks");
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      const rx = riverXAtZ(p.z), dRiver = rx === rx ? Math.abs(p.x - rx) : Infinity;
      const dPath = Math.abs(p.x - rail.pathXAtZ(p.z));
      if (rock) {
        if (dRiver < bank(p.z)) v.rockInRiverWater++;
        if (dPath < 8) v.rockOnPath++;
      } else {
        if (dPath < 12) v.treeOnPath++;
        if (dRiver < bank(p.z) - 10) v.treeInRiverWater++;
        if (hf.heightAt(p.x, p.z) < 1) v.treeBelowSea++;
        for (const [, l] of lmPts) if (Math.hypot(p.x - l.x, p.z - l.z) < 50) { v.treeWithin50OfLandmarkCentre++; break; }
      }
    }
  }
  const houses = [];
  scene.traverse((o) => { if (/^Cottage_/.test(o.name)) houses.push(o); });
  for (const o of houses) {
    const g = o.geometry.parameters;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3((a * g.width) / 2, 0, (b * g.depth) / 2).applyMatrix4(o.matrixWorld));
    // Floating: the wall bottom above the ground at any corner.
    if (corners.some((c) => c.y > hf.heightAt(c.x, c.z) + 0.01)) v.cottageFloating++;
    for (const [, l] of lmPts) if (Math.hypot(o.position.x - l.x, o.position.z - l.z) < 35) v.cottageNearLandmark++;
  }
  for (let i = 0; i < houses.length; i++) for (let j = i + 1; j < houses.length; j++) if (houses[i].position.distanceTo(houses[j].position) < 20) v.cottagesOverlapping++;
  console.log("violations", v);
}
