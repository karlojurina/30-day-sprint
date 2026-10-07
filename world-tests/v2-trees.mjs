// Tree budget measurement, in node, on the real exported world.
//
//   node --experimental-strip-types --no-warnings world-tests/v2-trees.mjs [path/to/world.glb]
//
// For each of the 12 tree prototypes: source triangles, simplified triangles at
// ratios 0.10 / 0.15 / 0.20 / 0.30 / 0.50, and the time simplifyForDistance
// takes. Then the whole-world drawn-triangle estimate for near/far ratio pairs,
// with "near" measured three ways: lateral |x - pathX(z)| to the walking path
// (bands 180 / 260 / 350), true 2D distance to the path polyline (same bands),
// and 2D distance to the nearest of the 8 landmarks (bands 60 / 100 / 150).
// Every non-tree mesh is counted at full cost. The render harness
// (v2-tree-render.mjs) confirms these totals against renderer.info.
// Writes world-tests/shots/v2/tree-budget.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { simplifyForDistance, splitByDistance } from "../src/lib/world-v2/trees.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const glbPath = process.argv[2] || path.join(here, "../public/world/world.glb");
const buf = fs.readFileSync(glbPath);
const gltf = await new Promise((res, rej) =>
  new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", res, rej));
gltf.scene.updateMatrixWorld(true);

// ridge.py path_x_at, verbatim. Three coords: x = fx * 310, z = 1000 - 2000 t.
const PATH_WAYPOINTS = [[0.055, 0.0], [0.135, -0.40], [0.265, 0.34], [0.378, 0.0], [0.5, 0.098], [0.59, -0.24],
  [0.615, -0.30], [0.73, -0.26], [0.7875, 0.12], [0.86, 0.10], [0.94, -0.10], [1.0, -0.10]];
function pathXAtT(t) {
  const pts = PATH_WAYPOINTS;
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, v0] = pts[i], [t1, v1] = pts[i + 1];
    if (t0 <= t && t <= t1) { let k = (t - t0) / Math.max(1e-6, t1 - t0); k = k * k * (3 - 2 * k); return v0 + (v1 - v0) * k; }
  }
  return pts[pts.length - 1][1];
}
const pathXAtZ = (z) => pathXAtT((1000 - z) / 2000) * 310;
const poly = [];
for (let i = 0; i <= 2000; i++) { const z = 1000 - i; poly.push([pathXAtZ(z), z]); }
function pathDist2D(x, z) {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

// Group meshes the way the scene's instancing does: by geometry.
const byGeo = new Map();
let nonTreeTris = 0;
const nonTree = [];
gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  const tris = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
  if (/Tree/.test(o.material.name)) {
    if (!byGeo.has(o.geometry.uuid)) byGeo.set(o.geometry.uuid, { name: o.material.name, geometry: o.geometry, tris, matrices: [] });
    byGeo.get(o.geometry.uuid).matrices.push(o.matrixWorld.clone());
  } else {
    nonTreeTris += tris;
    nonTree.push([o.name, tris]);
  }
});
const protos = [...byGeo.values()];
const instances = protos.reduce((s, p) => s + p.matrices.length, 0);
const fullTreeTris = protos.reduce((s, p) => s + p.tris * p.matrices.length, 0);
console.log(`world: ${instances} tree instances of ${protos.length} prototypes = ${fullTreeTris.toLocaleString()} tris; everything else ${nonTreeTris.toLocaleString()} tris; total ${(fullTreeTris + nonTreeTris).toLocaleString()}`);

const RATIOS = [0.1, 0.15, 0.2, 0.3, 0.5];
const report = { glb: path.relative(path.join(here, ".."), glbPath), nonTreeTris, fullTreeTris, instances, protos: [], estimates: [] };

// Warm the JIT on one small prototype so the first timing is not a compile.
simplifyForDistance(protos[protos.length - 1].geometry, 0.15);

console.log("\nprototype            inst  source |   r=0.10        r=0.15        r=0.20        r=0.30        r=0.50   | ms@0.15 | cards kept/total, scale, solids kept/dropped @0.15");
for (const p of protos) {
  const row = { name: p.name, instances: p.matrices.length, sourceTris: p.tris, simplified: {}, ms: {} };
  let line = `${p.name.padEnd(19)} ${String(p.matrices.length).padStart(4)} ${String(p.tris).padStart(7)} |`;
  let detail = "";
  for (const r of RATIOS) {
    const t0 = performance.now();
    const g = simplifyForDistance(p.geometry, r);
    const ms = performance.now() - t0;
    const tris = g.index.count / 3;
    row.simplified[r] = tris; row.ms[r] = +ms.toFixed(1);
    const s = g.userData.simplify;
    if (r === 0.15) detail = `${s.cardsKept}/${s.cards}, x${s.cardScale.toFixed(2)}, ${s.solids}/${s.solidsDropped}`;
    // Attribute sanity: normals unit length, no NaN.
    const n = g.attributes.normal, pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (!Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))) throw new Error(`${p.name} r=${r}: NaN position`);
      if (n && Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) > 1e-3) throw new Error(`${p.name} r=${r}: non-unit normal`);
    }
    line += ` ${String(tris).padStart(5)} (${(100 * tris / p.tris).toFixed(1).padStart(4)}%)`;
    g.dispose();
  }
  console.log(`${line} | ${String(row.ms[0.15]).padStart(6)} | ${detail}`);
  report.protos.push(row);
}
const totalMs = Object.fromEntries(RATIOS.map((r) => [r, +report.protos.reduce((s, p) => s + p.ms[r], 0).toFixed(0)]));
console.log(`all 12 prototypes, ms per ratio: ${JSON.stringify(totalMs)}`);
report.totalMs = totalMs;

// Whole-world estimates. Every non-tree mesh at full cost; near trees at
// NEAR ratio (1 = the untouched kit mesh), far trees at FAR ratio.
const pos = new THREE.Vector3();
const lateral = (m) => { pos.setFromMatrixPosition(m); return Math.abs(pos.x - pathXAtZ(pos.z)); };
const twoD = (m) => { pos.setFromMatrixPosition(m); return pathDist2D(pos.x, pos.z); };
// ridge.py LANDMARK_SPOTS: where the parked camera zooms in.
const LANDMARKS = [[0.135, -0.40], [0.265, 0.34], [0.378, 0.0], [0.5, 0.098], [0.615, -0.30], [0.73, -0.26], [0.7875, -0.20], [0.94, -0.10]]
  .map(([t, fx]) => [fx * 310, 1000 - 2000 * t]);
const toLandmark = (m) => { pos.setFromMatrixPosition(m); let b = Infinity; for (const [x, z] of LANDMARKS) b = Math.min(b, Math.hypot(pos.x - x, pos.z - z)); return b; };
const trisAt = (p, r) => (r >= 1 ? p.tris : report.protos.find((row) => row.name === p.name).simplified[r]);
function estimate(fn, band, nearR, farR) {
  let nearN = 0, tris = nonTreeTris;
  for (const p of protos) {
    const { near, far } = splitByDistance(p.matrices, fn, band);
    nearN += near.length;
    tris += near.length * trisAt(p, nearR) + far.length * trisAt(p, farR);
  }
  return { nearN, tris };
}
const fmt = (v) => `${(v / 1e6).toFixed(2)}M${v < 1.5e6 ? "*" : " "}`;
console.log("\nwhole world, drawn triangles (* = under 1.5M). near/far ratios; 1 = full kit mesh:");
const COMBOS = [[1, 0.15], [1, 0.1], [0.5, 0.15], [0.3, 0.15], [0.3, 0.1], [0.2, 0.1]];
console.log("metric    band  near# | " + COMBOS.map(([n, f]) => `${n}/${f}`.padStart(9)).join(" "));
for (const [metric, fn, bands] of [["lateral", lateral, [180, 260, 350]], ["2D", twoD, [180, 260, 350]], ["landmark", toLandmark, [60, 100, 150]]]) {
  for (const band of bands) {
    const cells = COMBOS.map(([n, f]) => estimate(fn, band, n, f));
    console.log(`${metric.padEnd(9)} ${String(band).padStart(4)} ${String(cells[0].nearN).padStart(6)} | ` + cells.map((c) => fmt(c.tris).padStart(9)).join(" "));
    report.estimates.push({ metric, band, nearTrees: cells[0].nearN, totals: Object.fromEntries(COMBOS.map(([n, f], i) => [`${n}/${f}`, cells[i].tris])) });
  }
}
for (const r of [0.3, 0.2, 0.15, 0.1]) {
  const t = nonTreeTris + protos.reduce((s, p) => s + p.matrices.length * trisAt(p, r), 0);
  console.log(`every tree at ${r}: ${fmt(t)}`);
  report.estimates.push({ metric: "uniform", ratio: r, total: t });
}

// Lateral distance distribution of the trees, so the band choice is informed.
const d = protos.flatMap((p) => p.matrices.map(lateral)).sort((a, b) => a - b);
const q = (f) => d[Math.min(d.length - 1, Math.floor(f * d.length))].toFixed(0);
console.log(`\ntree lateral distance to path: min ${d[0].toFixed(0)}, p10 ${q(0.1)}, p25 ${q(0.25)}, median ${q(0.5)}, p75 ${q(0.75)}, p90 ${q(0.9)}, max ${d[d.length - 1].toFixed(0)}`);
report.lateralQuantiles = { p10: +q(0.1), p25: +q(0.25), p50: +q(0.5), p75: +q(0.75), p90: +q(0.9), max: +d[d.length - 1].toFixed(0) };

fs.mkdirSync(path.join(here, "shots/v2"), { recursive: true });
fs.writeFileSync(path.join(here, "shots/v2/tree-budget.json"), JSON.stringify(report, null, 2));
console.log("\nwrote shots/v2/tree-budget.json");

// ---- Edge cases the scene can hit ----
console.log("\nedge cases:");
const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
const check = (label, ok, extra = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  (" + extra + ")" : ""}`); if (!ok) process.exitCode = 1; };
{
  // Vertex colours: the house prototype carries COLOR_0.
  let house = null;
  gltf.scene.traverse((o) => { if (!house && o.isMesh && o.geometry.attributes.color && o.name !== "Terrain" && !/Terrain/.test(o.material.name)) house = o; });
  if (house) {
    const t0 = performance.now();
    const g = simplifyForDistance(house.geometry, 0.15);
    const ms = performance.now() - t0;
    const src = house.geometry.index.count / 3, out = g.index.count / 3;
    const c = g.attributes.color;
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < c.count; i++) { lo = Math.min(lo, c.getX(i)); hi = Math.max(hi, c.getX(i)); }
    check(`colour kept on ${house.material.name}`, !!c && c.count === g.attributes.position.count && hi > lo,
      `${src} -> ${out} tris in ${ms.toFixed(0)} ms, red channel ${lo.toFixed(2)}..${hi.toFixed(2)}, pieces ${g.userData.simplify.solids}`);
  } else check("found a coloured non-terrain mesh", false);
}
{
  const pine = protos.find((p) => p.name === "PineTree_1_flat").geometry;
  const flat = pine.toNonIndexed();
  const a = simplifyForDistance(pine, 0.15).index.count / 3, b = simplifyForDistance(flat, 0.15).index.count / 3;
  check("non-indexed input gives the same result as indexed", a === b, `${a} vs ${b}`);
  const one = simplifyForDistance(pine, 1), nan = simplifyForDistance(pine, NaN);
  check("ratio 1 and ratio NaN return an untouched copy", one !== pine && one.index.count === pine.index.count && nan.index.count === pine.index.count);
}
{
  const leafy = protos.find((p) => p.name === "NormalTree_3_flat").geometry;
  const pine = protos.find((p) => p.name === "PineTree_1_flat").geometry;
  const strip = (g) => { const c = g.clone(); for (const k of Object.keys(c.attributes)) if (!["position", "normal"].includes(k)) c.deleteAttribute(k); return c; };
  const merged = mergeGeometries([strip(leafy), strip(pine)], true);
  const g = simplifyForDistance(merged, 0.15);
  const ok = g.groups.length === 2 && g.groups.every((gr) => gr.count > 0) && g.groups[0].start === 0 && g.groups[1].start === g.groups[0].count && g.groups[1].start + g.groups[1].count === g.index.count;
  check("material groups preserved and contiguous", ok, JSON.stringify(g.groups));
}
{
  const ms = [0, 5, 10, NaN].map((x) => new THREE.Matrix4().makeTranslation(x, 0, 0));
  const r = splitByDistance(ms, (m) => m.elements[12], 5);
  check("splitByDistance: <= band is near, NaN is far", JSON.stringify(r) === JSON.stringify({ near: [0, 1], far: [2, 3] }), JSON.stringify(r));
}
