// Offline framing study for the v3 rail and park, in node, against the real
// shipped world (public/world-v3/world.glb, Draco-decoded here with the page's
// own decoder). Nothing is rendered: it projects boxes and marches rays.
//
//   node --experimental-strip-types --no-warnings --import ./world-tests/v3-ts-resolve.mjs world-tests/v3-rail-framing.mjs [--vp split] [--low] [--knots '[[0,0],...]'] [--rows 0,0.07] [--park]
//
// Per area stop: camera height over the ground, pitch, distance, and where the
// landmark's box lands (fractions of the frame from the top / left).
// --rows d,...  what each row of the view at depth d meets first, at three
//               columns: s sky, l land, w water, e past the terrain's edge.
// --park        the park solve per landmark (scene.ts solveParkPose).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildHeightfield } from "../src/lib/world-v3/heightfield.ts";
import { createRail } from "../src/lib/world-v3/rail.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const VPS = { split: [1691, 1278], ultra: [3428, 1230], laptop: [1440, 900], small: [960, 600] };
const [W, H] = VPS[arg("--vp", "split")];
const FOV = 31;

// ── Draco, synchronously, with the decoder the page ships ────────────────────
const require = createRequire(import.meta.url);
const DracoDecoderModule = require(path.join(ROOT, "public/world-v3/draco/draco_decoder.js"));
const draco = await DracoDecoderModule();
const fakeDraco = {
  preload() {},
  decodeDracoFile(buffer, callback, attributeIDs, attributeTypes) {
    const decoder = new draco.Decoder();
    const arr = new Int8Array(buffer);
    const mesh = new draco.Mesh();
    const status = decoder.DecodeArrayToMesh(arr, arr.byteLength, mesh);
    if (!status.ok()) throw new Error("draco: " + status.error_msg());
    const g = new THREE.BufferGeometry();
    const nf = mesh.num_faces();
    const idx = new draco.DracoUInt32Array();
    const index = new Uint32Array(nf * 3);
    const face = new draco.DracoInt32Array();
    for (let i = 0; i < nf; i++) {
      decoder.GetFaceFromMesh(mesh, i, face);
      index[i * 3] = face.GetValue(0);
      index[i * 3 + 1] = face.GetValue(1);
      index[i * 3 + 2] = face.GetValue(2);
    }
    draco.destroy(face);
    draco.destroy(idx);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    for (const name in attributeIDs) {
      const att = decoder.GetAttributeByUniqueId(mesh, attributeIDs[name]);
      const n = att.num_components();
      const count = mesh.num_points() * n;
      const out = new draco.DracoFloat32Array();
      decoder.GetAttributeFloatForAllPoints(mesh, att, out);
      const a = new Float32Array(count);
      for (let i = 0; i < count; i++) a[i] = out.GetValue(i);
      draco.destroy(out);
      g.setAttribute(name, new THREE.BufferAttribute(a, n));
    }
    draco.destroy(mesh);
    draco.destroy(decoder);
    callback(g);
  },
};

const buf = fs.readFileSync(path.join(ROOT, "public/world-v3/world.glb"));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const loader = new GLTFLoader();
loader.setDRACOLoader(fakeDraco);
const gltf = await new Promise((res, rej) => loader.parse(ab, "", res, rej));
const root = gltf.scene;
root.updateMatrixWorld(true);
const hf = buildHeightfield(root, "Terrain");

// Water, as scene.ts indexWater.
const water = [];
for (const name of ["Sea", "Lake", "Pond"]) {
  const o = root.getObjectByName(name);
  const b = new THREE.Box3().setFromObject(o);
  water.push({ name, y: b.max.y, cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2, rx: (b.max.x - b.min.x) / 2, rz: (b.max.z - b.min.z) / 2, round: name !== "Sea" });
}
const surface = (x, z) => {
  let h = hf.heightAt(x, z);
  for (const w of water) {
    if (w.y <= h) continue;
    const u = (x - w.cx) / w.rx, v = (z - w.cz) / w.rz;
    if (w.round ? u * u + v * v <= 1 : Math.abs(u) <= 1 && Math.abs(v) <= 1) h = w.y;
  }
  return h;
};

// Landmark boxes (own geometry + parts within 60 units), as scene.ts indexLandmarks.
const LMS = ["LM_Lighthouse", "LM_Windmill", "LM_Bridge", "LM_Viaduct", "LM_Watchtower", "LM_Cairn", "LM_Jetty", "LM_Obelisk"];
const AREAS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
const boxes = {};
for (const name of LMS) {
  const o = root.getObjectByName(name);
  const box = new THREE.Box3().setFromObject(o);
  // Visible part: above ground/water (scene.ts buildLandmark keeps samples above the surface).
  const vis = new THREE.Box3();
  const v = new THREE.Vector3();
  o.traverse((d) => {
    if (!d.isMesh) return;
    const p = d.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(d.matrixWorld);
      if (v.y > surface(v.x, v.z) + 0.5) vis.expandByPoint(v);
    }
  });
  boxes[name] = { box, vis: vis.isEmpty() ? box : vis };
}

const knots = args.includes("--knots") ? JSON.parse(arg("--knots")) : undefined;
const rail = createRail({ pitch: args.includes("--low") ? "low" : "v3", dropKnots: knots });
rail.setGround((x, z) => hf.heightAt(x, z));
const probe = new THREE.PerspectiveCamera(FOV, W / H, 1, 6000);
const pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
const place = (d) => {
  rail.sample(d, pose);
  probe.position.copy(pose.position);
  probe.lookAt(pose.target);
  probe.updateMatrixWorld();
  probe.updateProjectionMatrix();
};
const r2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const p = new THREE.Vector3();

console.log(`viewport ${W}x${H}, pitch ${args.includes("--low") ? "low (V2)" : "v3"}${knots ? ", knots " + JSON.stringify(knots) : ""}`);
console.log("area  depth   camOverGnd  pitch   dist   top   base  left  right  (fractions of the frame)");
const out = [];
LMS.forEach((name, k) => {
  const { vis } = boxes[name];
  const c = vis.getCenter(new THREE.Vector3());
  const d = rail.depthNearest(c.x, c.z);
  place(d);
  let top = Infinity, bot = -Infinity, l = Infinity, r = -Infinity;
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? vis.max.x : vis.min.x, i & 2 ? vis.max.y : vis.min.y, i & 4 ? vis.max.z : vis.min.z).project(probe);
    top = Math.min(top, (1 - p.y) / 2); bot = Math.max(bot, (1 - p.y) / 2);
    l = Math.min(l, (p.x + 1) / 2); r = Math.max(r, (p.x + 1) / 2);
  }
  const over = pose.position.y - hf.heightAt(pose.position.x, pose.position.z);
  const f = pose.target.clone().sub(pose.position);
  const pitch = (-Math.atan2(f.y, Math.hypot(f.x, f.z)) * 180) / Math.PI;
  out.push({ id: AREAS[k], d, over, pitch, top, bot });
  console.log(`${AREAS[k]}   ${d.toFixed(4)}  ${over.toFixed(0).padStart(6)}     ${pitch.toFixed(1).padStart(5)}  ${pose.position.distanceTo(c).toFixed(0).padStart(5)}  ${r2(top)}  ${r2(bot)}  ${r2(l)}  ${r2(r)}   drop ${rail.dropAt(d).toFixed(1)}`);
});

if (args.includes("--rows")) {
  for (const d of arg("--rows").split(",").map(Number)) {
    place(d);
    const rows = [];
    for (let k = 0; k < 24; k++) {
      const ny = 1 - (2 * (k + 0.5)) / 24;
      let row = "";
      for (const nx of [-0.6, 0, 0.6]) {
        const dir = new THREE.Vector3(nx, ny, 0.5).unproject(probe).sub(probe.position).normalize();
        let hit = "s";
        for (let t = 2; t < 4000; t += 2) {
          const x = probe.position.x + dir.x * t, y = probe.position.y + dir.y * t, z = probe.position.z + dir.z * t;
          const g = hf.heightAt(x, z), s = surface(x, z);
          if (y <= s) { hit = s > g + 0.01 ? "w" : Math.abs(x) > 868 || Math.abs(z) > 1000 ? "e" : "l"; break; }
        }
        row += hit;
      }
      rows.push(row);
    }
    const counts = { s: 0, l: 0, w: 0, e: 0 };
    for (const r of rows) counts[r[1]]++;
    console.log(`\nview at depth ${d}: cam ${pose.position.toArray().map((v) => v.toFixed(0))} over ground ${(pose.position.y - hf.heightAt(pose.position.x, pose.position.z)).toFixed(0)}`);
    console.log(`  rows top->bottom (cols -0.6, 0, +0.6): ${rows.join(" ")}`);
    console.log(`  centre column: sky ${counts.s}/24, land ${counts.l}/24, water ${counts.w}/24, off-edge ${counts.e}/24`);
  }
}

// Ground profile along the start, for the shore.
if (args.includes("--shore")) {
  for (let z = 1300; z >= 500; z -= 50) {
    const x = rail.pathXAtZ(z);
    console.log(`  z ${z}  x ${x.toFixed(0)}  ground ${hf.heightAt(x, z).toFixed(1)}  surface ${surface(x, z).toFixed(1)}`);
  }
}

if (args.includes("--park")) {
  const { buildLandmark, solveParkPose } = await import("../src/lib/world-v3/scene.ts");
  const lms = {};
  for (const name of LMS) {
    const o = root.getObjectByName(name);
    const meshes = [];
    o.traverse((d) => { if (d.isMesh) meshes.push(d); });
    lms[name] = buildLandmark(meshes, surface);
  }
  const occluders = [];
  root.traverse((o) => { if (o.isMesh && /^House/.test(o.name)) occluders.push(new THREE.Box3().setFromObject(o)); });
  const sunDir = new THREE.Vector3(-0.62, 0.3, -0.72).normalize();
  console.log(`\npark (${W}x${H}): pitch yaw  dist/rail  height%  backlit  blockedLow  touching  visible  score`);
  for (const [k, name] of LMS.entries()) {
    const lm = lms[name];
    const d = rail.depthNearest(lm.center.x, lm.center.z);
    rail.sample(d, pose);
    const t0 = performance.now();
    const trace = arg("--trace") === AREAS[k] ? [] : null;
    const r = solveParkPose({ landmark: lm, others: Object.values(lms), railPos: pose.position, railTarget: pose.target, aspect: W / H, widthPx: W, surface, occluders, sunDir, trace: trace ? (c) => trace.push(c) : undefined });
    if (trace) {
      trace.sort((a, b) => a.score - b.score);
      for (const c of trace.slice(0, 14)) console.log("   ", Object.entries(c).map(([k, v]) => `${k} ${typeof v === "number" ? v.toFixed(2) : v}`).join("  "));
    }
    const ms = performance.now() - t0;
    console.log(`${AREAS[k]} ${name.padEnd(14)} ${String(r.pitch).padStart(3)} ${String(r.yaw).padStart(4)}  ${(r.dist / r.railDist).toFixed(2)}      ${(r.heightFrac * 100).toFixed(0).padStart(3)}%    ${r.backlit.toFixed(2)}     ${r.blockedLow.toFixed(2)}       ${r.touching ? "YES" : "no "}      ${r.visible.toFixed(2)}   ${r.score.toFixed(2)}   (${ms.toFixed(0)} ms)  pos ${r.pos.toArray().map((v) => v.toFixed(0))}`);
  }
}

export { root, hf, surface, water, boxes, rail };
