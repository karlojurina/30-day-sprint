// B2 rocks: print drawn (grid) vs exact terrain heights at points, and rail distance.
// node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-b2-probe.mjs x,z x,z ...
const R = await import("../src/lib/world-v6/rocks.ts");
const T = await import("../src/lib/world-v6/terrain.ts");
for (const a of process.argv.slice(2)) {
  const [x, z] = a.split(",").map(Number);
  console.log(a, "grid", R.groundY(x, z).toFixed(1), "exact", T.terrainHeight(x, z).toFixed(1), "rail@g+20", R.railDist(x, R.groundY(x, z) + 20, z).toFixed(1));
}
