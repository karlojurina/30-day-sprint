// LOOK at the tree LOD, in headless Chrome with real WebGL.
//
//   node world-tests/v2-tree-render.mjs            # uncompressed public/world/world.glb
//   GLB=v2 node world-tests/v2-tree-render.mjs     # Draco public/world-v2/world.glb
//   GALLERY_ONLY=1 node world-tests/v2-tree-render.mjs   # prototypes only, ~20 s
//
// Self-contained: serves three, the two v2 TS modules (transpiled on the fly)
// and the glb from a throwaway static server on a free port, so it depends on
// neither the Next dev server nor the v2 page other agents are still building.
// The scene lighting, fog and sky copy src/lib/world-v2/scene.ts as of
// 2026-09-24 (identical to /dev/world), so LOD differences are judged under the
// light the student will see.
//
// Measures, and writes to world-tests/shots/v2/:
//   tree-gallery-*.png   12 prototypes x ratios, at parked size and rail size
//   tree-world-*.png     the world at 5 rail stops + 3 parked close-ups per LOD mode
//   tree-render.json     silhouette IoU + coverage per prototype and ratio,
//                        drawn triangles (renderer.info) and pixel difference
//                        against full detail per world mode and depth,
//                        simplify + heightfield timings in the browser.
import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const require = createRequire(path.join(app, "package.json"));
const ts = require("typescript");
const OUT = path.join(here, "shots/v2");
fs.mkdirSync(OUT, { recursive: true });
const GLB = process.env.GLB === "v2" ? "world-v2" : "world";
const TAG = GLB === "world-v2" ? "draco" : "raw";

const PAGE = String.raw`<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#111;overflow:hidden}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/examples/jsm/":"/three/examples/jsm/"}}</script>
</head><body><script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { simplifyForDistance, splitByDistance } from "/lib/trees.js";
import { buildHeightfield } from "/lib/heightfield.js";

// ---- copied from src/lib/world-v2/scene.ts (2026-09-24) ----
const LEN_Y = 2000, SKY_TOP = 0x565a8c, SKY_HOR = 0xe8905c, HAZE = 0xc9795a;
const GLOWS = /^(Pin\d|RidgeMat\d|(Lake|Pond)Mat|LM_LighthouseLampMat)$/;
function addLights(scene) {
  const sun = new THREE.DirectionalLight(0xffa25c, 2.4); sun.position.set(320, 190, -3000); scene.add(sun);
  scene.add(new THREE.HemisphereLight(SKY_HOR, 0x241c22, 0.44));
  scene.add(new THREE.AmbientLight(0xffd8bb, 0.15));
}
function skyMesh() {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(SKY_TOP) }, hor: { value: new THREE.Color(SKY_HOR) } },
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 2.6 + 0.30, 0.0, 1.0); h = h*h*(3.0-2.0*h); gl_FragColor = vec4(mix(hor, top, h), 1.0); }",
  }));
  sky.frustumCulled = false; return sky;
}
function railPose(depth, cam) {
  const by = -LEN_Y * 0.615 + depth * (LEN_Y * 1.06);
  const height = 108 + depth * 96 + Math.max(0, depth - 0.45) * 210;
  cam.position.set(0, height, -by);
  const drop = Math.tan(THREE.MathUtils.degToRad(5.2 + depth * 2.2)) * 900;
  cam.lookAt(0, height - drop, -by - 900);
}
// ---- ridge.py path + landmarks ----
const PATH_WAYPOINTS = [[0.055,0],[0.135,-0.40],[0.265,0.34],[0.378,0],[0.5,0.098],[0.59,-0.24],[0.615,-0.30],[0.73,-0.26],[0.7875,0.12],[0.86,0.10],[0.94,-0.10],[1,-0.10]];
function pathXAtT(t){const p=PATH_WAYPOINTS;if(t<=p[0][0])return p[0][1];for(let i=0;i<p.length-1;i++){const[t0,v0]=p[i],[t1,v1]=p[i+1];if(t0<=t&&t<=t1){let k=(t-t0)/Math.max(1e-6,t1-t0);k=k*k*(3-2*k);return v0+(v1-v0)*k;}}return p[p.length-1][1];}
const pathXAtZ = (z) => pathXAtT((1000 - z) / 2000) * 310;
const LANDMARK_SPOTS = [[0.135,-0.40],[0.265,0.34],[0.378,0],[0.5,0.098],[0.615,-0.30],[0.73,-0.26],[0.7875,-0.20],[0.94,-0.10]]
  .map(([t, fx]) => [fx * 310, 1000 - 2000 * t]);

const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.06;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const gl = renderer.getContext();
function readPixels(x = 0, y = 0, w = W, h = H) { const px = new Uint8Array(w * h * 4); gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; }

let world = null;   // { scene, protos: [{name, geometry, material, matrices, lod: Map(ratio->geo)}], instanced: [] }

window.setup = async (url, draco) => {
  const loader = new GLTFLoader();
  if (draco) { const d = new DRACOLoader(); d.setDecoderPath("/draco/"); loader.setDRACOLoader(d); }
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene; root.updateMatrixWorld(true);
  const t0 = performance.now(); const hf = buildHeightfield(root, "Terrain"); const hfMs = performance.now() - t0;
  const t1 = performance.now(); buildHeightfield(root, "Terrain"); const hfMs2 = performance.now() - t1;
  // heightAt vs a downward raycast on the decoded mesh, 1500 points inside the composition + 500 anywhere.
  const terrain = root.getObjectByName("Terrain"); const ray = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let maxErr = 0, sumErr = 0, n = 0, over05 = 0;
  for (let i = 0; i < 2000; i++) {
    const x = i < 1500 ? (rnd() - 0.5) * 620 : (rnd() - 0.5) * 1730; const z = (rnd() - 0.5) * 1990;
    ray.set(new THREE.Vector3(x, 5000, z), down); const hit = ray.intersectObject(terrain, false)[0]; if (!hit) continue;
    const e = Math.abs(hf.heightAt(x, z) - hit.point.y); maxErr = Math.max(maxErr, e); sumErr += e; n++; if (e > 0.5) over05++;
  }
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(HAZE, 760, 3000); scene.add(skyMesh()); addLights(scene);
  scene.add(root);
  root.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material)) if (m && m.emissive && !GLOWS.test(m.name) && m.emissive.getHex() !== 0) m.emissive.setHex(0); });
  // Collect repeats (>= 12) by geometry, like scene.ts instanceRepeats; trees handled per mode, the rest instanced once.
  const byGeo = new Map();
  root.traverse((o) => { if (o.isMesh) { const k = o.geometry.uuid; if (!byGeo.has(k)) byGeo.set(k, []); byGeo.get(k).push(o); } });
  const protos = [];
  for (const group of byGeo.values()) {
    if (group.length < 12) continue;
    const src = group[0]; const matrices = group.map((m) => m.matrixWorld.clone());
    group.forEach((m) => m.parent.remove(m));
    if (/Tree/.test(src.material.name)) protos.push({ name: src.material.name, geometry: src.geometry, material: src.material, matrices, lod: new Map() });
    else { const inst = new THREE.InstancedMesh(src.geometry, src.material, matrices.length); matrices.forEach((m, i) => inst.setMatrixAt(i, m)); inst.frustumCulled = false; scene.add(inst); }
  }
  const camera = new THREE.PerspectiveCamera(31, W / H, 1, 6000);
  world = { scene, protos, instanced: [], camera, root, hf, parked: null };
  // Simplify timings in the browser.
  const timing = {};
  for (const ratio of [0.1, 0.15, 0.2, 0.3]) {
    let total = 0;
    for (const p of protos) { const s = performance.now(); p.lod.set(ratio, simplifyForDistance(p.geometry, ratio)); total += performance.now() - s; }
    timing[ratio] = +total.toFixed(1);
  }
  return { protos: protos.map((p) => ({ name: p.name, n: p.matrices.length, tris: p.geometry.index.count / 3 })),
    heightfield: { firstBuildMs: +hfMs.toFixed(1), secondBuildMs: +hfMs2.toFixed(1), bounds: hf.bounds, meanErr: +(sumErr / n).toFixed(3), maxErr: +maxErr.toFixed(3), over05, n },
    simplifyMsAll12: timing };
};

const lateral = (m) => { const x = m.elements[12], z = m.elements[14]; return Math.abs(x - pathXAtZ(z)); };
const toLandmark = (m) => { const x = m.elements[12], z = m.elements[14]; let b = Infinity; for (const [lx, lz] of LANDMARK_SPOTS) b = Math.min(b, Math.hypot(x - lx, z - lz)); return b; };

// mode: { near: ratio|1, far: ratio, band, metric: "lateral"|"landmark"|"none" }
window.setMode = (mode) => {
  for (const m of world.instanced) { world.scene.remove(m); m.dispose(); }
  world.instanced = [];
  const fn = mode.metric === "landmark" ? toLandmark : lateral;
  let trees = 0;
  for (const p of world.protos) {
    const split = mode.metric === "none" ? { near: [], far: p.matrices.map((_, i) => i) } : splitByDistance(p.matrices, fn, mode.band);
    for (const [ids, ratio] of [[split.near, mode.near], [split.far, mode.far]]) {
      if (!ids.length) continue;
      const geo = ratio >= 1 ? p.geometry : p.lod.get(ratio) || (p.lod.set(ratio, simplifyForDistance(p.geometry, ratio)), p.lod.get(ratio));
      const inst = new THREE.InstancedMesh(geo, p.material, ids.length);
      ids.forEach((id, i) => inst.setMatrixAt(i, p.matrices[id]));
      inst.frustumCulled = false; world.scene.add(inst); world.instanced.push(inst);
      trees += ids.length * (geo.index.count / 3);
    }
  }
  return trees;
};

// Parked-style view: the camera pulled in toward landmark i on the rail side,
// low pitch, the way the v2 scene zooms "into the place on the main map".
window.parkPose = (i, dist, lift) => {
  const [lx, lz] = LANDMARK_SPOTS[i];
  world.parked = { lx, lz, dist, lift };
};
function applyPark(cam) {
  const { lx, lz, dist, lift } = world.parked;
  const ground = world.hf.heightAt(lx, lz);
  cam.position.set(lx + dist * 0.25, ground + lift, lz + dist);
  cam.lookAt(lx, ground + lift * 0.35, lz);
}
window.renderWorld = (depth) => {
  if (depth === "park") applyPark(world.camera); else railPose(depth, world.camera);
  world.camera.aspect = W / H; world.camera.updateProjectionMatrix();
  renderer.setViewport(0, 0, W, H); renderer.setScissorTest(false);
  renderer.render(world.scene, world.camera);
  return { triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
};
window.snapshot = () => { window.__ref = readPixels(); return true; };
window.compareToSnapshot = () => {
  const a = window.__ref, b = readPixels(); let sum = 0, over = 0;
  for (let i = 0; i < a.length; i += 4) { const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2])) / 3; sum += d; if (d > 12) over++; }
  return { meanDiff: +(sum / (a.length / 4)).toFixed(3), pctOver12: +(100 * over / (a.length / 4)).toFixed(3) };
};

// ---- gallery: each prototype alone in a tile, rows = ratios ----
window.gallery = (ratios, ppu, mask) => {
  const cols = world.protos.length, tileW = Math.round(8 * ppu), tileH = Math.round(10 * ppu);
  const scene = new THREE.Scene(); addLights(scene);
  scene.background = new THREE.Color(mask ? 0xffffff : 0xb07a62);
  if (mask) scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
  const cam = new THREE.OrthographicCamera(-4, 4, 7.6, -2.4, -100, 100);
  // 20 degrees above horizontal, looking toward -z like the rail (trees backlit by the sunset).
  cam.position.set(0, Math.sin(THREE.MathUtils.degToRad(20)) * 50, Math.cos(THREE.MathUtils.degToRad(20)) * 50); cam.lookAt(0, 0, 0);
  const holder = new THREE.Group(); scene.add(holder);
  renderer.setScissorTest(true);
  renderer.setClearColor(mask ? 0xffffff : 0xb07a62, 1);
  renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H); renderer.clear();
  const stats = [];
  ratios.forEach((ratio, row) => {
    world.protos.forEach((p, col) => {
      holder.clear();
      const geo = ratio >= 1 ? p.geometry : p.lod.get(ratio) || (p.lod.set(ratio, simplifyForDistance(p.geometry, ratio)), p.lod.get(ratio));
      const mesh = new THREE.Mesh(geo, p.material); mesh.position.y = 0; holder.add(mesh);
      const x = col * tileW, y = H - (row + 1) * tileH;
      renderer.setViewport(x, y, tileW, tileH); renderer.setScissor(x, y, tileW, tileH);
      renderer.render(scene, cam);
      if (mask) { const px = readPixels(x, y, tileW, tileH); const m = new Uint8Array(tileW * tileH); for (let i = 0; i < m.length; i++) m[i] = px[i * 4] < 128 ? 1 : 0; stats.push({ ratio, name: p.name, mask: m, tris: geo.index.count / 3 }); }
    });
  });
  renderer.setScissorTest(false);
  if (!mask) return null;
  const out = [];
  for (const s of stats) {
    if (s.ratio >= 1) continue;
    const full = stats.find((f) => f.ratio >= 1 && f.name === s.name);
    let inter = 0, uni = 0, a = 0, b = 0;
    for (let i = 0; i < s.mask.length; i++) { const x = full.mask[i], y = s.mask[i]; if (x & y) inter++; if (x | y) uni++; a += x; b += y; }
    out.push({ name: s.name, ratio: s.ratio, tris: s.tris, iou: +(inter / uni).toFixed(3), coverage: +(b / a).toFixed(3), fullPx: a });
  }
  return out;
};
window.__ready = true;
</script></body></html>`;

// ---- throwaway static server ----
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".html": "text/html" };
const transpile = (file) => ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let body = null, type = "text/javascript";
  try {
    if (url === "/") { body = PAGE; type = "text/html"; }
    else if (url === "/lib/trees.js") body = transpile(path.join(app, "src/lib/world-v2/trees.ts"));
    else if (url === "/lib/heightfield.js") body = transpile(path.join(app, "src/lib/world-v2/heightfield.ts"));
    else if (url.startsWith("/three/")) { const f = path.join(app, "node_modules", url); body = fs.readFileSync(f); type = TYPES[path.extname(f)] || "application/octet-stream"; }
    else if (url.startsWith("/draco/")) { const f = path.join(app, "public/world-v2", url); body = fs.readFileSync(f); type = TYPES[path.extname(f)] || "application/octet-stream"; }
    else if (url === "/glb/world.glb") { body = fs.readFileSync(path.join(app, "public/world/world.glb")); type = TYPES[".glb"]; }
    else if (url === "/glb/world-v2.glb") { body = fs.readFileSync(path.join(app, "public/world-v2/world.glb")); type = TYPES[".glb"]; }
  } catch { body = null; }
  if (body === null) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": type }); res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 600000,
});
const report = { glb: GLB };
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (!/No next vertex/.test(m.text())) console.log("  [page]", m.text()); });
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

  // 1. Gallery canvases (sized per scale), then the world at Lovro's split-screen size.
  const RATIOS = [1, 0.3, 0.15, 0.1];
  for (const [label, ppu] of [["parked", 20], ["rail", 6]]) {
    const w = 12 * Math.round(8 * ppu), h = RATIOS.length * Math.round(10 * ppu);
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(BASE + "/", { waitUntil: "load" });
    await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });
    const setup = await page.evaluate((u, d) => window.setup(u, d), `/glb/${GLB}.glb`, GLB === "world-v2");
    if (label === "parked") { report.setup = setup; console.log("setup:", JSON.stringify(setup.heightfield), "simplify ms (all 12):", JSON.stringify(setup.simplifyMsAll12)); }
    const iou = await page.evaluate((r, p) => window.gallery(r, p, true), RATIOS, ppu);
    report[`silhouette_${label}`] = iou;
    await page.evaluate((r, p) => window.gallery(r, p, false), RATIOS, ppu);
    if (label === "rail") {
      // 3x nearest-neighbour upscale so the rail-size trees can be seen, pixels intact.
      await page.evaluate((w, h) => { const c = document.querySelector("canvas"); c.style.width = w * 3 + "px"; c.style.height = h * 3 + "px"; c.style.imageRendering = "pixelated"; }, w, h);
      await page.setViewport({ width: w * 3, height: h * 3, deviceScaleFactor: 1 });
    }
    await page.screenshot({ path: path.join(OUT, `tree-gallery-${label}-${TAG}.png`) });
    console.log(`\nsilhouette vs full, ${label} size (${ppu} px/unit; a 6-unit tree is ${6 * ppu} px tall): IoU / coverage`);
    for (const name of [...new Set(iou.map((r) => r.name))]) {
      console.log("  " + name.padEnd(18) + iou.filter((r) => r.name === name).map((r) => `r${r.ratio}: ${r.iou.toFixed(2)}/${r.coverage.toFixed(2)}`).join("   "));
    }
    const mean = (r) => { const s = iou.filter((x) => x.ratio === r); return (s.reduce((a, x) => a + x.iou, 0) / s.length).toFixed(3); };
    console.log(`  mean IoU: r0.3 ${mean(0.3)}  r0.15 ${mean(0.15)}  r0.1 ${mean(0.1)}`);
  }

  // 2. World at the split-screen viewport, 5 rail depths, several LOD modes.
  if (process.env.GALLERY_ONLY) throw Object.assign(new Error("gallery only"), { quiet: true });
  await page.setViewport({ width: 1691, height: 1278, deviceScaleFactor: 1 });
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });
  await page.evaluate((u, d) => window.setup(u, d), `/glb/${GLB}.glb`, GLB === "world-v2");
  const MODES = [
    { key: "full", near: 1, far: 1, metric: "none" },
    { key: "all-0.15", near: 1, far: 0.15, metric: "none" },
    { key: "all-0.10", near: 1, far: 0.1, metric: "none" },
    { key: "lateral180-full+0.15", near: 1, far: 0.15, band: 180, metric: "lateral" },
    { key: "lateral180-0.3+0.15", near: 0.3, far: 0.15, band: 180, metric: "lateral" },
    { key: "landmark60-full+0.15", near: 1, far: 0.15, band: 60, metric: "landmark" },
  ];
  // Rail stops of areas 1, 3, 5, 7, 8, then three parked close-ups:
  // windmill (a2), viaduct (a4), cairn (a6), 140 units out and 45 up.
  const DEPTHS = [0.0708, 0.3, 0.5236, 0.6863, 0.8302, "park1", "park3", "park5"];
  const SHOT = new Set(["full", "all-0.15", "lateral180-0.3+0.15", "landmark60-full+0.15"]);
  report.world = [];
  for (const d of DEPTHS) {
    const isPark = typeof d === "string";
    if (isPark) await page.evaluate((i) => window.parkPose(i, 140, 45), Number(d.slice(4)));
    for (const mode of MODES) {
      const treeTris = await page.evaluate((m) => window.setMode(m), mode);
      const info = await page.evaluate((dd) => window.renderWorld(dd), isPark ? "park" : d);
      const cmp = mode.key === "full" ? (await page.evaluate(() => window.snapshot()), { meanDiff: 0, pctOver12: 0 }) : await page.evaluate(() => window.compareToSnapshot());
      const row = { depth: d, mode: mode.key, drawnTriangles: info.triangles, calls: info.calls, treeTris, ...cmp };
      report.world.push(row);
      const label = isPark ? d.padEnd(6) : d.toFixed(4);
      console.log(`depth ${label} ${mode.key.padEnd(22)} drawn ${(info.triangles / 1e6).toFixed(3)}M  calls ${info.calls}  diff vs full: mean ${cmp.meanDiff}/255, ${cmp.pctOver12}% px > 12`);
      if (SHOT.has(mode.key)) await page.screenshot({ path: path.join(OUT, `tree-world-${mode.key}-${isPark ? d : "d" + d.toFixed(4)}-${TAG}.png`) });
    }
  }
} catch (e) {
  if (!e.quiet) throw e;
} finally {
  fs.writeFileSync(path.join(OUT, `tree-render-${TAG}.json`), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
console.log(`\nwrote shots/v2/tree-render-${TAG}.json and tree-*.png`);
