// Terrain facts for forest.ts tuning: height and slope distribution over land,
// by z band. node --experimental-strip-types --no-warnings world-tests/v3-forest-terrain.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildHeightfield } from "../src/lib/world-v3/heightfield.ts";
const here = path.dirname(fileURLToPath(import.meta.url));
const buf = fs.readFileSync(path.join(here, "../public/world/world.glb"));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, "", res, rej));
const hf = buildHeightfield(gltf.scene, "Terrain");
const q = (a, p) => a[Math.floor(p * (a.length - 1))];
for (let z0 = 1000; z0 > -1000; z0 -= 250) {
  const hs = [], ss = [];
  for (let z = z0; z > z0 - 250; z -= 10) for (let x = -860; x <= 860; x += 10) {
    const h = hf.heightAt(x, z); if (h < 2) continue;
    const e = 8, gx = (hf.heightAt(x + e, z) - hf.heightAt(x - e, z)) / (2 * e), gz = (hf.heightAt(x, z + e) - hf.heightAt(x, z - e)) / (2 * e);
    hs.push(h); ss.push(Math.hypot(gx, gz));
  }
  hs.sort((a, b) => a - b); ss.sort((a, b) => a - b);
  console.log(`z ${z0}..${z0 - 250} land ${hs.length}  h p10 ${q(hs,.1).toFixed(0)} p50 ${q(hs,.5).toFixed(0)} p90 ${q(hs,.9).toFixed(0)} max ${hs[hs.length-1].toFixed(0)}  slope p10 ${q(ss,.1).toFixed(2)} p50 ${q(ss,.5).toFixed(2)} p90 ${q(ss,.9).toFixed(2)}`);
}
// centre line (x=0) and |x|=300,600 profiles
for (const z of [900, 700, 470, 244, 0, -230, -460, -660, -880]) {
  console.log("z", z, [-800,-600,-400,-300,-200,-100,0,100,200,300,400,600,800].map(x => hf.heightAt(x, z).toFixed(0)).join(" "));
}
