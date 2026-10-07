// Offline framing study for the v2 rail and park, in node, against the real
// exported world (an UNCOMPRESSED export: node has no Draco decoder).
//
//   node --experimental-strip-types --no-warnings world-tests/v2-fix-framing.mjs <raw.glb> [--vp split]
//
// Prints, for each area's own stop (rail.depthNearest of the landmark centre):
// camera height over the ground, distance to the landmark, and where the
// landmark's box lands on screen (fractions of width / height from the top).
// Also prints the ground profile under the first stretch of the rail.
import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildHeightfield } from "../src/lib/world-v2/heightfield.ts";
import { createRail } from "../src/lib/world-v2/rail.ts";

const args = process.argv.slice(2);
const glbPath = args.find((a) => a.endsWith(".glb"));
const VPS = { split: [1691, 1278], ultra: [3428, 1230], laptop: [1440, 900] };
const vpName = args.includes("--vp") ? args[args.indexOf("--vp") + 1] : "split";
const [W, H] = VPS[vpName];
const FOV = 31;

const buf = fs.readFileSync(glbPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, "", res, rej));
const root = gltf.scene;
root.updateMatrixWorld(true);
const hf = buildHeightfield(root, "Terrain");
const rail = createRail();
rail.setGround((x, z) => hf.heightAt(x, z));

// Landmark boxes, as scene.ts indexLandmarks.
const LMS = ["LM_Lighthouse", "LM_Windmill", "LM_Bridge", "LM_Viaduct", "LM_Watchtower", "LM_Cairn", "LM_Jetty", "LM_Obelisk"];
const boxes = {};
for (const name of LMS) {
  const o = root.getObjectByName(name);
  const own = new THREE.Box3();
  const part = new THREE.Box3();
  const meshBox = (m) => {
    m.geometry.computeBoundingBox();
    return part.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
  };
  if (o.isMesh) own.union(meshBox(o));
  else for (const c of o.children) if (c.isMesh && !c.name.startsWith("LM_")) own.union(meshBox(c));
  const cx = (own.min.x + own.max.x) / 2;
  const cz = (own.min.z + own.max.z) / 2;
  const box = own.clone();
  o.traverse((d) => {
    if (d === o || !d.isMesh || (d.parent === o && !o.isMesh && !d.name.startsWith("LM_"))) return;
    meshBox(d);
    const dx = (part.min.x + part.max.x) / 2 - cx;
    const dz = (part.min.z + part.max.z) / 2 - cz;
    if (Math.hypot(dx, dz) <= 60) box.union(part);
  });
  boxes[name] = box;
}
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
if (args.includes("--boxes")) {
  for (const [n, b] of Object.entries(boxes)) {
    console.log(n, "min", b.min.toArray().map(r1).join(","), "max", b.max.toArray().map(r1).join(","), "ground@c", r1(hf.heightAt((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2)));
  }
}

const cam = new THREE.PerspectiveCamera(FOV, W / H, 1, 6000);
const pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
function screenBox(box) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  // fractions: x from left, y from TOP
  return { l: (minX + 1) / 2, r: (maxX + 1) / 2, top: (1 - maxY) / 2, bot: (1 - minY) / 2 };
}
export function place(depth) {
  rail.sample(depth, pose);
  cam.position.copy(pose.position);
  cam.lookAt(pose.target);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
}

console.log(`viewport ${vpName} ${W}x${H}`);
console.log("id  stop   camH  camY  dist   top   bot   l     r    pitch");
LMS.forEach((name, i) => {
  const b = boxes[name];
  const c = b.getCenter(new THREE.Vector3());
  const d = rail.depthNearest(c.x, c.z);
  place(d);
  const s = screenBox(b);
  const g = hf.heightAt(pose.position.x, pose.position.z);
  const dist = Math.hypot(c.x - pose.position.x, c.z - pose.position.z);
  const dir = pose.target.clone().sub(pose.position);
  const pitch = (Math.atan2(-dir.y, Math.hypot(dir.x, dir.z)) * 180) / Math.PI;
  console.log(`a${i + 1}  ${d.toFixed(4)} ${r1(pose.position.y - g).toString().padStart(5)} ${r1(pose.position.y).toString().padStart(5)} ${r1(dist).toString().padStart(5)}  ${r3(s.top).toFixed(3)} ${r3(s.bot).toFixed(3)} ${r3(s.l).toFixed(3)} ${r3(s.r).toFixed(3)} ${pitch.toFixed(2)}`);
});

if (args.includes("--profile")) {
  console.log("ground along the rail start (z, x=0 ground, x=rail ground)");
  for (let z = 1250; z >= 600; z -= 25) console.log(z, r1(hf.heightAt(0, z)), "bounds", JSON.stringify(hf.bounds));
}

// ── Experiment: drop the camera by `drop` units (target too, so pitch is kept) ──
if (args.includes("--drop")) {
  const drops = args[args.indexOf("--drop") + 1].split(",").map(Number);
  const pitchAdd = args.includes("--pitch-add") ? Number(args[args.indexOf("--pitch-add") + 1]) : 0;
  for (const [vn, [w, h]] of Object.entries(VPS)) {
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    for (const drop of drops) {
      const row = [];
      let minClr = Infinity, at = 0;
      for (let i = 0; i <= 880; i++) {
        const d = i / 1000;
        rail.sample(d, pose);
        const g = Math.max(hf.heightAt(pose.position.x, pose.position.z), 0);
        const c = pose.position.y - drop - g;
        if (c < minClr) { minClr = c; at = d; }
      }
      LMS.forEach((name, k) => {
        const b = boxes[name];
        const c = b.getCenter(new THREE.Vector3());
        const d = rail.depthNearest(c.x, c.z);
        rail.sample(d, pose);
        pose.position.y -= drop;
        pose.target.y -= drop;
        const dir = pose.target.clone().sub(pose.position);
        if (pitchAdd) {
          const hl = Math.hypot(dir.x, dir.z);
          const p = Math.atan2(-dir.y, hl) + (pitchAdd * Math.PI) / 180;
          dir.y = -Math.tan(p) * hl;
        }
        cam.position.copy(pose.position);
        cam.lookAt(pose.position.clone().add(dir));
        cam.updateMatrixWorld();
        // visible bottom: max(box.min.y, ground at the box footprint)
        const vb = b.clone();
        vb.min.y = Math.max(b.min.y, Math.min(hf.heightAt(b.min.x, b.min.z), hf.heightAt(b.max.x, b.max.z), hf.heightAt(b.min.x, b.max.z), hf.heightAt(b.max.x, b.min.z)));
        const s = screenBox(vb);
        row.push(`a${k + 1} ${s.bot.toFixed(2)}/${s.top.toFixed(2)} x${s.l.toFixed(2)}-${s.r.toFixed(2)}`);
      });
      console.log(`${vn.padEnd(6)} drop ${String(drop).padStart(3)} minClr ${minClr.toFixed(0)}@${at.toFixed(2)} | ${row.join(" | ")}`);
    }
  }
}

// ── Per-area drop needed for a target bottom fraction, and what occludes it ──
if (args.includes("--need")) {
  const target = Number(args[args.indexOf("--need") + 1]);
  cam.aspect = 1440 / 900;
  cam.updateProjectionMatrix();
  const vis = (pos, b) => {
    let seen = 0, total = 0;
    for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) for (let j = 0; j < 5; j++) {
      const x = b.min.x + (b.max.x - b.min.x) * (0.1 + 0.2 * i);
      const z = b.min.z + (b.max.z - b.min.z) * (0.1 + 0.2 * k);
      const y = b.min.y + (b.max.y - b.min.y) * (0.1 + 0.2 * j);
      if (y < hf.heightAt(x, z) + 1) continue;
      total++;
      let clear = true;
      for (let n = 1; n <= 40; n++) {
        const f = (n / 41) * 0.97;
        if (hf.heightAt(pos.x + (x - pos.x) * f, pos.z + (z - pos.z) * f) > pos.y + (y - pos.y) * f) { clear = false; break; }
      }
      if (clear) seen++;
    }
    return total ? seen / total : 1;
  };
  LMS.forEach((name, k) => {
    const b = boxes[name];
    const c = b.getCenter(new THREE.Vector3());
    const d = rail.depthNearest(c.x, c.z);
    let lo = 0, hi = 200;
    for (let it = 0; it < 30; it++) {
      const drop = (lo + hi) / 2;
      rail.sample(d, pose);
      pose.position.y -= drop; pose.target.y -= drop;
      cam.position.copy(pose.position); cam.lookAt(pose.target); cam.updateMatrixWorld();
      const vb = b.clone();
      vb.min.y = Math.max(b.min.y, Math.min(hf.heightAt(b.min.x, b.min.z), hf.heightAt(b.max.x, b.max.z), hf.heightAt(b.min.x, b.max.z), hf.heightAt(b.max.x, b.min.z)));
      if (screenBox(vb).bot > target) lo = drop; else hi = drop;
    }
    rail.sample(d, pose);
    const y0 = pose.position.y;
    pose.position.y -= hi;
    const v = vis(pose.position, b);
    rail.sample(d, pose);
    console.log(`a${k + 1} d ${d.toFixed(4)} drop ${hi.toFixed(1)} camY ${y0.toFixed(1)} -> ${(y0 - hi).toFixed(1)} ground ${hf.heightAt(pose.position.x, pose.position.z).toFixed(1)} visible ${v.toFixed(2)} (vis at drop0 ${vis(pose.position, b).toFixed(2)})`);
  });
}

if (args.includes("--a7")) {
  cam.aspect = 1440 / 900; cam.updateProjectionMatrix();
  const b = boxes.LM_Jetty.clone();
  b.min.y = 82; // pond surface: the piers below it are underwater
  const c = b.getCenter(new THREE.Vector3());
  for (const d of [0.66, 0.68, 0.6863, 0.70, 0.7016]) for (const drop of [0, 20, 40, 60]) {
    rail.sample(d, pose);
    pose.position.y -= drop; pose.target.y -= drop;
    cam.position.copy(pose.position); cam.lookAt(pose.target); cam.updateMatrixWorld();
    const s = screenBox(b);
    // visible fraction of the deck top surface points
    let seen = 0, tot = 0;
    for (let i = 0; i <= 10; i++) for (let k = 0; k <= 4; k++) {
      const x = b.min.x + (b.max.x - b.min.x) * (k / 4), z = b.min.z + (b.max.z - b.min.z) * (i / 10), y = 88.6;
      tot++;
      let clear = true;
      for (let n = 1; n <= 60; n++) { const f = (n / 61) * 0.98; if (hf.heightAt(pose.position.x + (x - pose.position.x) * f, pose.position.z + (z - pose.position.z) * f) > pose.position.y + (y - pose.position.y) * f) { clear = false; break; } }
      if (clear) seen++;
    }
    console.log(`d ${d} drop ${drop}: camY ${pose.position.y.toFixed(0)} dist ${Math.hypot(c.x - pose.position.x, c.z - pose.position.z).toFixed(0)} top ${s.top.toFixed(2)} bot ${s.bot.toFixed(2)} x ${s.l.toFixed(2)}-${s.r.toFixed(2)} deckVisible ${(seen / tot).toFixed(2)}`);
  }
}

// ── Offline park solve with scene.ts's own solver ──
if (args.includes("--park")) {
  const { buildLandmark, solveParkPose, visibleShare } = await import("../src/lib/world-v2/scene.ts");
  const water = [];
  for (const n of ["Sea", "Lake", "Pond"]) {
    const o = root.getObjectByName(n);
    if (!o) continue;
    const b = new THREE.Box3().setFromObject(o);
    water.push({ y: b.max.y, cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2, rx: (b.max.x - b.min.x) / 2, rz: (b.max.z - b.min.z) / 2, round: n !== "Sea" });
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
  const lms = {};
  for (const name of LMS) {
    const o = root.getObjectByName(name);
    const meshes = [];
    o.traverse((d) => d.isMesh && meshes.push(d));
    lms[name] = buildLandmark(meshes, surface);
  }
  const FIX = [0.0708, 0.1934, 0.3, 0.4151, 0.5236, 0.6321, 0.6863, 0.8302];
  for (const [vn, [w, h]] of Object.entries(VPS)) {
    LMS.forEach((name, k) => {
      const lm = lms[name];
      const stop = rail.depthNearest(lm.center.x, lm.center.z);
      rail.sample(stop, pose);
      const t0 = performance.now();
      const occluders = [];
      root.traverse((o) => o.isMesh && /^House/.test(o.name) && occluders.push(new THREE.Box3().setFromObject(o)));
      const r = solveParkPose({ landmark: lm, others: Object.values(lms), railPos: pose.position.clone(), railTarget: pose.target.clone(), aspect: w / h, widthPx: w, surface, occluders });
      const ms = performance.now() - t0;
      rail.sample(FIX[k], pose);
      const fixDist = pose.position.distanceTo(lm.center);
      cam.aspect = w / h; cam.updateProjectionMatrix();
      cam.position.copy(r.pos); cam.lookAt(r.look); cam.updateMatrixWorld();
      const s = screenBox(lm.vis);
      console.log(`${vn.padEnd(6)} a${k + 1} dist ${r.dist.toFixed(0)} rail ${r.railDist.toFixed(0)} fix ${fixDist.toFixed(0)} cut ${(100 * (1 - r.dist / fixDist)).toFixed(1)}% pitch ${r.pitch} yaw ${r.yaw} vis ${r.visible.toFixed(2)} score ${r.score.toFixed(2)} | box y ${s.top.toFixed(2)}-${s.bot.toFixed(2)} (h ${(s.bot - s.top).toFixed(2)}) x ${s.l.toFixed(2)}-${s.r.toFixed(2)} | ${ms.toFixed(0)} ms | railVis ${visibleShare(pose.position, lm, surface).toFixed(2)}`);
    });
  }
}
