// Does forest.ts's update() report sway as visible exactly when swaying trees
// are on screen? Real rail poses from shots/v3/forest/r2-960x600.json, plus a
// high opening pose and a close park-like pose by the windmill.
//   node --experimental-strip-types --no-warnings world-tests/v3-forest-sway.mjs
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
const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", res, rej));
const root = gltf.scene, scene = new THREE.Scene();
scene.add(root); root.updateMatrixWorld(true);
const hf = buildHeightfield(root, "Terrain"), rail = createRail();
const landmarks = {};
root.traverse((o) => {
  if (!o.name.startsWith("LM_") || !o.isMesh) return;
  o.geometry.computeBoundingBox();
  const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
  const x = (b.min.x + b.max.x) / 2, z = (b.min.z + b.max.z) / 2, y = Math.max(b.min.y, hf.heightAt(x, z));
  landmarks[o.name] = { x, y, z, height: b.max.y - y };
});
const riverXAtZ = (z) => { const t = (1000 - z) / 2000; return t > 0.2 && t < 0.7 ? 310 * (Math.sin(5.2 * t) * 0.3 + Math.sin(11 * t) * 0.08) : NaN; };
const camera = new THREE.PerspectiveCamera(31, 960 / 600, 1, 6000);
const mk = (reducedMotion) => ({ scene, root, camera, renderer: { domElement: { height: 600 } }, heightAt: (x, z) => hf.heightAt(x, z), pathXAtZ: (z) => rail.pathXAtZ(z), riverXAtZ, landmarks, sunDir: new THREE.Vector3(-0.5, 0.25, -0.8).normalize(), sunColor: new THREE.Color(1, 0.8, 0.6), hazeColor: new THREE.Color(0.9, 0.7, 0.6), reducedMotion });
const poses = JSON.parse(fs.readFileSync(path.join(here, "shots/v3/forest/r2-960x600.json"), "utf8"));
const mill = landmarks.LM_Windmill;
const list = [
  ...Object.entries(poses).map(([k, v]) => [`rail ${k}`, v.cam]),
  ["opening, high over the sea", { x: 0, y: 260, z: 1150, dx: 0, dy: -0.2, dz: -0.98 }],
  ["park-like, 120 from the mill, 35 up", { x: mill.x - 20, y: mill.y + 35, z: mill.z + 120, dx: 0.15, dy: -0.25, dz: -0.95 }],
  ["looking at the sky", { x: 0, y: 400, z: 900, dx: 0, dy: 0.6, dz: -0.8 }],
];
for (const reduced of [false, true]) {
  const mod = await install(mk(reduced));
  for (const [name, c] of list) {
    camera.position.set(c.x, c.y, c.z);
    camera.lookAt(c.x + c.dx, c.y + c.dy, c.z + c.dz);
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    const changed = mod.update(12.3, 1 / 30);
    console.log(`${reduced ? "reduced" : "motion "} ${name.padEnd(40)} update() -> ${changed}  isAnimating() -> ${mod.isAnimating()}`);
  }
  mod.dispose();
}
