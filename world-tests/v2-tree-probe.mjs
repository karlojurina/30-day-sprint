// Structure probe for the 12 tree prototypes: welded vertex count, connected
// components and their sizes, and how normals are split (flat vs smooth).
//   node --no-warnings world-tests/v2-tree-probe.mjs
import fs from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
const buf = fs.readFileSync(new URL("../public/world/world.glb", import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, "", res, rej));
const protos = new Map();
gltf.scene.traverse((o) => { if (o.isMesh && /Tree/.test(o.material.name)) { const k = o.geometry.uuid; if (!protos.has(k)) protos.set(k, { mesh: o, n: 0 }); protos.get(k).n++; } });
for (const { mesh, n } of protos.values()) {
  const g = mesh.geometry, p = g.attributes.position, idx = g.index.array;
  const key = (i) => `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
  const map = new Map(), remap = new Uint32Array(p.count);
  for (let i = 0; i < p.count; i++) { const k = key(i); if (!map.has(k)) map.set(k, map.size); remap[i] = map.get(k); }
  // union-find over welded verts
  const par = Int32Array.from({ length: map.size }, (_, i) => i);
  const f = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  for (let t = 0; t < idx.length; t += 3) { const a = f(remap[idx[t]]), b = f(remap[idx[t+1]]), c = f(remap[idx[t+2]]); par[b] = a; par[f(c)] = a; }
  const comp = new Map();
  for (let t = 0; t < idx.length; t += 3) { const r = f(remap[idx[t]]); comp.set(r, (comp.get(r) || 0) + 1); }
  const sizes = [...comp.values()].sort((a, b) => b - a);
  // edge manifoldness
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = remap[idx[t+e]], b = remap[idx[t+(e+1)%3]]; const k = a < b ? a+"_"+b : b+"_"+a; edges.set(k, (edges.get(k)||0)+1); }
  let border = 0, nonman = 0; for (const c of edges.values()) { if (c === 1) border++; else if (c > 2) nonman++; }
  console.log(`${mesh.material.name.padEnd(18)} x${String(n).padStart(3)} tris ${idx.length/3} verts ${p.count} welded ${map.size} comps ${sizes.length} largest ${sizes.slice(0,4).join(",")} smallest ${sizes.slice(-3).join(",")} | edges ${edges.size} border ${border} nonmanifold ${nonman}`);
}
