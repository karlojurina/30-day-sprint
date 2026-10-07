// Heightfield check, in node, against the real exported terrain.
//
//   node --experimental-strip-types --no-warnings world-tests/v2-heightfield.mjs [path/to/world.glb]
//
// Loads the UNCOMPRESSED glb with GLTFLoader.parse (no DRACO in node), builds the
// heightfield three ways (as loaded, vertex order shuffled, positions quantised
// to Draco's 11 and 14 bit grids), times each, and compares heightAt against a
// downward raycast on the actual triangles at 6,000 random points (about 30 s).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildHeightfield } from "../src/lib/world-v2/heightfield.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const glbPath = process.argv[2] || path.join(here, "../public/world/world.glb");
const buf = fs.readFileSync(glbPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, "", res, rej));
const root = gltf.scene;
root.updateMatrixWorld(true);
const terrain = root.getObjectByName("Terrain");
console.log("terrain:", terrain?.type, "verts", terrain?.geometry?.attributes.position.count);

// Deterministic PRNG so runs are comparable.
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function variant(kind) {
  const g = terrain.geometry.clone();
  const pos = g.attributes.position;
  if (kind === "shuffled" || kind.startsWith("q")) {
    // Permute vertices and remap the index, as Draco's encoder may.
    const nv = pos.count;
    const perm = Array.from({ length: nv }, (_, i) => i);
    for (let i = nv - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const inv = new Uint32Array(nv); perm.forEach((p, i) => (inv[p] = i));
    const np = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) np[i * 3 + k] = pos.array[perm[i] * 3 + k];
    g.setAttribute("position", new THREE.BufferAttribute(np, 3));
    const idx = g.index.array; const ni = new Uint32Array(idx.length);
    for (let i = 0; i < idx.length; i++) ni[i] = inv[idx[i]];
    g.setIndex(new THREE.BufferAttribute(ni, 1));
  }
  if (kind.startsWith("q")) {
    // Draco quantises every axis to one grid sized by the largest bbox extent.
    const bits = Number(kind.slice(1));
    g.computeBoundingBox();
    const bb = g.boundingBox; const range = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    const step = range / ((1 << bits) - 1);
    const a = g.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      a[i] = bb.min.x + Math.round((a[i] - bb.min.x) / step) * step;
      a[i + 1] = bb.min.y + Math.round((a[i + 1] - bb.min.y) / step) * step;
      a[i + 2] = bb.min.z + Math.round((a[i + 2] - bb.min.z) / step) * step;
    }
    console.log(`  q${bits}: quantisation step ${step.toFixed(3)} units`);
  }
  const m = new THREE.Mesh(g, terrain.material); m.name = "Terrain";
  const holder = new THREE.Group(); holder.add(m);
  return holder;
}

// Ground truth: raycast straight down onto the ORIGINAL mesh.
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
terrain.geometry.computeBoundingBox();
function truth(x, z) {
  ray.set(new THREE.Vector3(x, 5000, z), down);
  const hit = ray.intersectObject(terrain, false)[0];
  return hit ? hit.point.y : NaN;
}

const bb = terrain.geometry.boundingBox;
const samples = [];
for (let i = 0; i < 6000; i++) {
  const x = bb.min.x + 0.5 + rnd() * (bb.max.x - bb.min.x - 1);
  const z = bb.min.z + 0.5 + rnd() * (bb.max.z - bb.min.z - 1);
  samples.push([x, z]);
}
const t0 = performance.now();
const truths = samples.map(([x, z]) => truth(x, z));
console.log(`ground truth: ${samples.length} raycasts in ${(performance.now() - t0).toFixed(0)} ms`);

// Vertex-exact check on the original grid nodes.
const tp = terrain.geometry.attributes.position;

for (const kind of ["as-loaded", "shuffled", "q14", "q11"]) {
  const holder = kind === "as-loaded" ? root : variant(kind);
  // Warm once (JIT), then time the median of 5 builds.
  buildHeightfield(holder, "Terrain");
  const times = [];
  let hf;
  for (let r = 0; r < 5; r++) { const s = performance.now(); hf = buildHeightfield(holder, "Terrain"); times.push(performance.now() - s); }
  times.sort((a, b) => a - b);
  let maxErr = 0, sumErr = 0, over1 = 0, nOk = 0, worst = null, inCompo = 0, inCompoOver = 0;
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(truths[i])) continue;
    const e = Math.abs(hf.heightAt(samples[i][0], samples[i][1]) - truths[i]);
    if (e > maxErr) { maxErr = e; worst = [samples[i][0].toFixed(0), samples[i][1].toFixed(0), truths[i].toFixed(0)]; }
    sumErr += e; nOk++; if (e > 1) over1++;
    // Inside the composition (|x| <= 310), where trees, path and landmarks live.
    if (Math.abs(samples[i][0]) <= 310) { inCompo++; if (e > 0.5) inCompoOver++; }
  }
  console.log(`  worst at x,z,ground = ${worst}; inside |x|<=310: ${inCompoOver}/${inCompo} points off by > 0.5u`);
  let maxV = 0;
  for (let i = 0; i < tp.count; i++) maxV = Math.max(maxV, Math.abs(hf.heightAt(tp.getX(i), tp.getZ(i)) - tp.getY(i)));
  // heightAt cost: 1M calls.
  let acc = 0; const s2 = performance.now();
  for (let i = 0; i < 1e6; i++) acc += hf.heightAt(-900 + (i % 1800), -1100 + ((i * 7) % 2200));
  const per = (performance.now() - s2) / 1e6 * 1e6;
  console.log(`${kind.padEnd(10)} build median ${times[2].toFixed(1)} ms (min ${times[0].toFixed(1)}, max ${times[4].toFixed(1)})` +
    ` | vs raycast: mean ${(sumErr / nOk).toFixed(3)} max ${maxErr.toFixed(3)} >1u ${over1}/${nOk}` +
    ` | at grid vertices max ${maxV.toFixed(4)} | heightAt ${per.toFixed(1)} ns/call` +
    ` | bounds ${JSON.stringify(hf.bounds)}`);
  if (!Number.isFinite(acc)) console.log("  NON-FINITE heightAt output");
}

// Clamp + NaN behaviour.
const hf = buildHeightfield(root, "Terrain");
console.log("clamp: heightAt(-5000,0) == heightAt(minX,0):", hf.heightAt(-5000, 0) === hf.heightAt(hf.bounds.minX, 0),
  " heightAt(0, 9999) == heightAt(0,maxZ):", hf.heightAt(0, 9999) === hf.heightAt(0, hf.bounds.maxZ),
  " NaN input ->", hf.heightAt(NaN, 3), " corner", hf.heightAt(-868,-1000), " centre", hf.heightAt(0,0).toFixed(2));
console.log("missing mesh ->", buildHeightfield(root, "NoSuchMesh"));
