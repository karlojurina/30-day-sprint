// B2 rocks: build rocks.ts in node, print its stats and each zone mesh's nearest approach to the camera rail.
// node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-b2-build.mjs
import * as THREE from "three";
const R = await import("../src/lib/world-v6/rocks.ts");
const FP = await import("../src/lib/world-v6/footprints.ts");
const root = new THREE.Group();
const ctx = { root, camera: new THREE.PerspectiveCamera() };
const t0 = performance.now();
const m = R.install(ctx);
console.log("install ms", Math.round(performance.now() - t0));
console.log(JSON.stringify(m.stats()));
console.log("footprints", FP.all().length);
// Min rail distance per mesh, and which keys are closest.
for (const mesh of root.children[0].children) {
  const p = mesh.geometry.getAttribute("position");
  let best = Infinity, bp = null;
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // quick reject
    const d = R.railDist(x, y, z);
    if (d < best) { best = d; bp = [x, y, z].map(Math.round); }
  }
  console.log(mesh.name, "tris", p.count / 3, "min rail dist", best.toFixed(1), "at", JSON.stringify(bp));
}
