// V4 light check: renders the eight stops (and the walk to the rim, the
// reveal, the rise, the star look, the bridge and the flight) with light.ts
// installed on a grey stand-in scene, and measures what the light has to prove.
//
//   node world-tests/v5-light.mjs [--only a5,k49] [--size 960x600]
//        [--light path/to/light.ts] [--out dir] [--tag name]
//
// --light renders another light.ts (a baseline) on the same stand-in; --out
// writes somewhere else (default world-tests/shots/v5-pass2/light). Grey pass
// 2: keep each run to 6 shots or fewer (--only) and run it in the background.
//
// The stand-in scene is NOT the V4 scene: it is terrain.ts's grey mesh, grey
// boxes at the landmarks, a cone for the Sky Island and slabs for the steps,
// with the camera placed exactly on TRAIL[i] looking at LOOK[i] and railU
// faked as i / (n - 1). It exists so the light can be judged before the
// camera agent's scene is ready.
//
// The V4 modules are transpiled with the project's TypeScript and served to
// headless Chrome by request interception: no dev server, no bundler.
// Writes PNGs, sheet.png and report.json to world-tests/shots/v5/light/.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};
const outDir = path.resolve(argOf("--out") || path.join(here, "shots/v5-pass2/light"));
fs.mkdirSync(outDir, { recursive: true });
const lightSrc = path.resolve(argOf("--light") || path.join(root, "src/lib/world-v5/light.ts"));
const tag = argOf("--tag") || "";
const [W, H] = (argOf("--size") || "960x600").split("x").map(Number);
const only = argOf("--only") ? new Set(argOf("--only").split(",")) : null;

// ── Transpile src/lib/world-v5/{layout,terrain,light}.ts ─────────────────────
const build = fs.mkdtempSync(path.join(os.tmpdir(), "v4-light-"));
for (const name of ["layout", "terrain", "light"]) {
  const src = fs.readFileSync(name === "light" ? lightSrc : path.join(root, "src/lib/world-v5", name + ".ts"), "utf8");
  let js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  js = js.replace(/from "\.\/([a-z-]+)"/g, 'from "./$1.js"');
  fs.writeFileSync(path.join(build, name + ".js"), js);
}

// ── The page ──────────────────────────────────────────────────────────────────
const LAB = String.raw`
import * as THREE from "three";
import { PLACES, TRAIL, LOOK, WORLD, STEPS, ISLAND_DEPTH, BOUNTY_DEPTH, HARBOUR_DEPTH, DESIGN_FOV, BRIDGE, SHIP, SHIP_MOORED, SHIP_DOCKED, FLIGHT_KEYS, TRAIL_VIEW, FOREST_KEEP_CLEAR, shipFromCamera } from "./v4/layout.js";
import { buildTerrainGeometry, terrainHeight } from "./v4/terrain.js";
import * as L from "./v4/light.js";
const { install, NO_REFLECT_LAYER, REFLECT_ONLY_LAYER } = L;

const W = ${W}, H = ${H};
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(DESIGN_FOV, W / H, 2, 40000);
scene.add(camera);

const grey = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, metalness: 0 });
const terrain = new THREE.Mesh(buildTerrainGeometry(320), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
terrain.name = "Terrain";
scene.add(terrain);
// --hide-terrain: to tell terrain shapes from light artefacts.
terrain.visible = ${!args.includes("--hide-terrain")};
// The recommended split: the full terrain stays out of the lake's reflection
// pass, a coarse copy is drawn only there.
if (${!args.includes("--no-lod")}) {
  terrain.layers.set(NO_REFLECT_LAYER);
  const coarse = new THREE.Mesh(buildTerrainGeometry(128), terrain.material);
  coarse.layers.set(REFLECT_ONLY_LAYER);
  scene.add(coarse);
}
const sea = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), grey(0x5f6f7a));
sea.rotation.x = -Math.PI / 2;
sea.position.y = 0;
scene.add(sea);
const pool = new THREE.Mesh(new THREE.CircleGeometry(WORLD.pool.r, 48), grey(0x6f8290));
pool.rotation.x = -Math.PI / 2;
pool.position.set(WORLD.pool.x, WORLD.pool.y + 0.4, WORLD.pool.z);
scene.add(pool);

// Landmarks: plain boxes, sized by their rough height.
const blocks = new THREE.Group();
for (const p of PLACES) {
  if (p.id === "a3") continue;
  const w = Math.max(16, Math.min(90, p.height * 0.4));
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, p.height, w), grey(0xc8c8c8));
  m.position.set(p.pos.x, p.pos.y + p.height / 2, p.pos.z);
  m.name = p.mesh;
  blocks.add(m);
}
scene.add(blocks);
// The falls: a pale curtain from the lip to the pool.
{
  const [tx, ty, tz] = WORLD.falls.top;
  const [, by, bz] = WORLD.falls.bottom;
  const g = new THREE.PlaneGeometry(WORLD.falls.width, ty - by, 1, 12);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + (ty + by) / 2;
    const f = (ty - y) / (ty - by);
    pos.setXYZ(i, pos.getX(i) + tx, y, tz - 52 * Math.sqrt(Math.max(0, f)));
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xdfe8ee, roughness: 1, side: THREE.DoubleSide }));
  m.name = "LM_Waterfall";
  scene.add(m);
}
// Sky Island and the bounty isle: inverted cones, flat top.
function isle(c, depth, name) {
  const g = new THREE.ConeGeometry(c.r, depth, 48, 1);
  g.rotateX(Math.PI);
  const m = new THREE.Mesh(g, grey(0x9a9a9a));
  m.position.set(c.x, c.y - depth / 2, c.z);
  m.name = name;
  scene.add(m);
  return m;
}
const island = isle(WORLD.island, ISLAND_DEPTH, "Island");
const bounty = isle(WORLD.bountyIsle, BOUNTY_DEPTH, "BountyIsle");
const harbour = isle(WORLD.harbourIsle, HARBOUR_DEPTH, "HarbourIsle");
const islandBlocks = blocks.children.filter((b) => b.name === "LM_Observatory");
// The rope bridge: a plank strip from a to b.
{
  const [ax, ay, az] = BRIDGE.a, [bx, by, bz] = BRIDGE.b;
  const len = Math.hypot(bx - ax, bz - az);
  const m = new THREE.Mesh(new THREE.BoxGeometry(BRIDGE.width, 1.5, len), grey(0xa89c8c));
  m.position.set((ax + bx) / 2, (ay + by) / 2 - BRIDGE.sag * 0.6, (az + bz) / 2);
  m.rotation.y = -Math.atan2(bx - ax, -(bz - az));
  scene.add(m);
}
// Ships: a hull and an envelope above it, nose along the heading.
function ship(pose) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(26, 14, SHIP.length), grey(0x8c8278));
  hull.position.y = -7;
  const env = new THREE.Mesh(new THREE.CapsuleGeometry(24, SHIP.length * 0.7, 6, 16), grey(0xd8d2c8));
  env.rotation.x = Math.PI / 2;
  env.position.y = 70;
  g.add(hull, env);
  g.position.set(pose.x, pose.y, pose.z);
  g.rotation.y = -(pose.heading * Math.PI) / 180;
  scene.add(g);
  return g;
}
const riding = ship(SHIP_MOORED);
ship(SHIP_DOCKED);
// Four more moored along the Harbour Isle's edge.
for (let k = 0; k < 4; k++) {
  const a = -0.2 + k * 0.45;
  const r = WORLD.harbourIsle.r + 40;
  ship({ x: WORLD.harbourIsle.x + Math.sin(a) * r, y: WORLD.harbourIsle.y, z: WORLD.harbourIsle.z + Math.cos(a) * r, heading: (a * 180) / Math.PI + 90 });
}
// The forest: trunks and crowns (two instanced draws) out of the keep-clear corridors.
const segD = (x, z, s) => {
  const [x0, z0, x1, z1] = s;
  const dx = x1 - x0, dz = z1 - z0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - x0 - dx * t, z - z0 - dz * t);
};
const F = WORLD.forest;
let seed = 12345;
const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const treeAt = [];
for (let i = 0; treeAt.length < 140 && i < 4000; i++) {
  const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * F.r;
  const x = F.x + Math.cos(a) * r, z = F.z + Math.sin(a) * r;
  if (Math.hypot(x - F.clearing.x, z - F.clearing.z) < F.clearing.r) continue;
  if (FOREST_KEEP_CLEAR.some((s) => segD(x, z, s) < s[4] + 12)) continue;
  treeAt.push([x, terrainHeight(x, z), z, 130 + rand() * 90]);
}
const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(7, 11, 1, 8), grey(0x5a5048), treeAt.length);
const crownMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(48, 1, 10), grey(0x5c6a58), treeAt.length);
const mtx = new THREE.Matrix4();
treeAt.forEach(([x, y, z, h], i) => {
  trunkMesh.setMatrixAt(i, mtx.compose(new THREE.Vector3(x, y + h * 0.3, z), new THREE.Quaternion(), new THREE.Vector3(1, h * 0.6, 1)));
  crownMesh.setMatrixAt(i, mtx.compose(new THREE.Vector3(x, y + h * 0.7, z), new THREE.Quaternion(), new THREE.Vector3(1, h * 0.6, 1)));
});
scene.add(trunkMesh, crownMesh);
// Glow stand-ins, tagged the way blocks.ts must tag its own (light.ts header).
// Base colours: blocks.ts's G.lamp and G.teal.
const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.35, 0.5) });
lampMat.name = "V4BlockGlow";
const magicMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.9, 1.7) });
magicMat.userData.lightGlow = "magic";
for (const p of PLACES) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 4), lampMat);
  m.position.set(p.pos.x + 30, p.pos.y + 4, p.pos.z + 30);
  scene.add(m);
}
{
  const n = 90;
  const glows = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(6, 0), magicMat, n);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = treeAt[i % treeAt.length];
    const a = i * 2.4, r = 16 + (i % 5) * 5;
    glows.setMatrixAt(i, mtx.compose(new THREE.Vector3(x + Math.cos(a) * r, y + 3 + (i % 7) * 11, z + Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
  }
  scene.add(glows);
}
// Floating steps.
const stepGeo = new THREE.BoxGeometry(46, 10, 30);
const stepMat = grey(0xb0b0b0);
for (const [x, y, z] of STEPS) {
  const m = new THREE.Mesh(stepGeo, stepMat);
  m.position.set(x, y - 5, z);
  scene.add(m);
}

let U = 0;
const light = install({ scene, renderer, camera, railU: () => U, reducedMotion: false });
const n = TRAIL.length - 1;

function pose(i) {
  camera.position.set(...TRAIL[i]);
  camera.lookAt(...LOOK[i]);
  camera.updateMatrixWorld();
  // On the flight the ship rides under the camera (layout.ts shipFromCamera).
  const onShip = i >= FLIGHT_KEYS.first && i <= FLIGHT_KEYS.last;
  const sp = onShip ? shipFromCamera(...TRAIL[i], TRAIL_VIEW[i].bearing) : SHIP_MOORED;
  riding.position.set(sp.x, sp.y, sp.z);
  riding.rotation.y = -(sp.heading * Math.PI) / 180;
}

function frame() {
  renderer.info.reset();
  renderer.render(scene, camera);
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
}

function readLuma() {
  const gl = renderer.getContext();
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

window.lab = {
  n,
  places: PLACES.map((p) => ({ id: p.id, trail: p.trail, light: p.light, module: p.module })),
  shoot(i) {
    pose(i);
    U = i / n;
    light.update(0, 0);
    const f = frame();
    const px = readLuma();
    const ls = [];
    for (let k = 0; k < px.length; k += 4) ls.push((0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2]) / 255);
    ls.sort((a, b) => a - b);
    const mean = ls.reduce((a, b) => a + b, 0) / ls.length;
    const s = light.state;
    // Foreground: the bottom 40% of the frame (readPixels rows run bottom-up).
    let fg = 0, fgN = 0;
    for (let y = 0; y < Math.floor(H * 0.4); y++) for (let x = 0; x < W; x += 2) {
      const k = (y * W + x) * 4;
      fg += (0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2]) / 255;
      fgN++;
    }
    return {
      ...f,
      fg: +(fg / fgN).toFixed(3),
      spread: +(ls[Math.floor(ls.length * 0.95)] - ls[Math.floor(ls.length * 0.05)]).toFixed(3),
      lampGlow: s.lampGlow === undefined ? null : +s.lampGlow.toFixed(3),
      magicGlow: s.magicGlow === undefined ? null : +s.magicGlow.toFixed(3),
      lampColor: +lampMat.color.r.toFixed(3),
      magicColor: +magicMat.color.g.toFixed(3),
      stats: light.stats(),
      luma: { mean: +mean.toFixed(3), p05: +ls[Math.floor(ls.length * 0.05)].toFixed(3), p50: +ls[Math.floor(ls.length * 0.5)].toFixed(3), p95: +ls[Math.floor(ls.length * 0.95)].toFixed(3) },
      sunEl: +s.sunEl.toFixed(2),
      sunAz: +((Math.atan2(s.sunDir.x, -s.sunDir.z) * 180) / Math.PI + 360).toFixed(1) % 360,
      exposure: +s.exposure.toFixed(3),
      stars: +s.stars.toFixed(3),
      fog: [Math.round(scene.fog.near), Math.round(scene.fog.far)],
    };
  },
  // Any camera, with the light of a given key.
  shootAt(pos, look, key) {
    camera.position.set(...pos);
    camera.lookAt(...look);
    camera.updateMatrixWorld();
    U = key / n;
    light.update(0, 0);
    return frame();
  },
  // Pixels that change when the Sky Island (and its blocks) are hidden.
  islandDiff(i, hideLake) {
    light.lake.visible = !hideLake;
    pose(i);
    U = i / n;
    light.update(0, 0);
    frame();
    const a = readLuma();
    for (const o of [island, bounty, ...islandBlocks]) o.visible = false;
    frame();
    const b = readLuma();
    for (const o of [island, bounty, ...islandBlocks]) o.visible = true;
    light.lake.visible = true;
    frame();
    let changed = 0, minY = H, maxY = -1, minX = W, maxX = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const d = Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]);
      if (d > 24) {
        changed++;
        // readPixels rows run bottom-up.
        const sy = H - 1 - y;
        if (sy < minY) minY = sy; if (sy > maxY) maxY = sy; if (x < minX) minX = x; if (x > maxX) maxX = x;
      }
    }
    return { changed, share: +(changed / (W * H)).toFixed(4), box: changed ? [minX, minY, maxX, maxY] : null, reflectionPasses: light.stats().reflectionPasses };
  },
  // Max change of every light channel between neighbouring railU samples.
  continuity(samples) {
    const st = light.lightAt(0);
    const prev = {};
    const range = {};
    const maxStep = {};
    const flat = (s) => {
      const o = {};
      for (const [k, v] of Object.entries(s)) {
        if (k === "u" || k === "stop" || k === "blend") continue;
        if (typeof v === "number") o[k] = v;
        else if (v && v.isColor) { o[k + ".r"] = v.r; o[k + ".g"] = v.g; o[k + ".b"] = v.b; }
        else if (v && v.isVector3) { o[k + ".x"] = v.x; o[k + ".y"] = v.y; o[k + ".z"] = v.z; }
      }
      return o;
    };
    let first = true;
    for (let j = 0; j <= samples; j++) {
      light.lightAt(j / samples, st);
      const f = flat(st);
      for (const [k, v] of Object.entries(f)) {
        range[k] = range[k] ? [Math.min(range[k][0], v), Math.max(range[k][1], v)] : [v, v];
        if (!first) maxStep[k] = Math.max(maxStep[k] || 0, Math.abs(v - prev[k]));
        prev[k] = v;
      }
      first = false;
    }
    // Worst channel: its largest single step as a share of its full range.
    let worst = { key: null, share: 0 };
    for (const k of Object.keys(maxStep)) {
      const r = range[k][1] - range[k][0];
      if (r <= 1e-9) continue;
      const share = maxStep[k] / r;
      if (share > worst.share) worst = { key: k, share: +share.toFixed(5) };
    }
    // Reversal: sampling downward gives the same states as upward.
    const a = flat(light.lightAt(0.4321));
    light.lightAt(0.9, st);
    const b = flat(light.lightAt(0.4321));
    let revDiff = 0;
    for (const k of Object.keys(a)) revDiff = Math.max(revDiff, Math.abs(a[k] - b[k]));
    return { samples, worst, reverseMaxDiff: revDiff };
  },
  // The time of day must be C1 at every pass-through waypoint and never run backwards.
  track() {
    if (!L.buildTrack || !L.trackTime) return null;
    const tr = L.buildTrack(light.placeU);
    const h = 1e-6;
    const joins = [];
    for (let i = 1; i < tr.length - 1; i++) {
      if (tr[i].hold) continue;
      const u = tr[i].u;
      const left = (L.trackTime(u, tr) - L.trackTime(u - h, tr)) / h;
      const right = (L.trackTime(u + h, tr) - L.trackTime(u, tr)) / h;
      joins.push({ key: +(u * n).toFixed(2), left: +left.toFixed(2), right: +right.toFixed(2), ratio: +(right / left).toFixed(3) });
    }
    let backwards = 0, prev = -1;
    for (let j = 0; j <= 20000; j++) { const t = L.trackTime(j / 20000, tr); if (t < prev - 1e-12) backwards++; prev = t; }
    // Sun elevation along the flight, and the key where it clears the horizon.
    const st = light.lightAt(0);
    const sun = [];
    let rises = null, last = null;
    for (let k = FLIGHT_KEYS.first - 1; k <= n; k += 0.25) {
      light.lightAt(k / n, st);
      if (Number.isInteger(k)) sun.push([k, +st.sunEl.toFixed(2), +st.stars.toFixed(2), +st.lampGlow.toFixed(2)]);
      if (last !== null && last < 0 && st.sunEl >= 0 && rises === null) rises = k;
      last = st.sunEl;
    }
    return { stops: tr.map((t) => ({ key: +(t.u * n).toFixed(2), hold: t.hold })), joins, backwards, sunRisesAtKey: rises, flightKeys: FLIGHT_KEYS, sun };
  },
  idle() {
    // Same railU, same camera: update() must report nothing changed.
    light.update(0, 0);
    return light.update(0, 0);
  },
};
window.labReady = true;
`;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#111;overflow:hidden}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/examples/jsm/":"/three/examples/jsm/"}}</script>
</head><body><script type="module" src="/lab.js"></script></body></html>`;

function serve(url) {
  const u = new URL(url);
  const p = u.pathname;
  if (p === "/" || p === "/index.html") return { body: HTML, type: "text/html" };
  if (p === "/lab.js") return { body: LAB, type: "text/javascript" };
  if (p === "/favicon.ico") return { body: "", type: "image/x-icon" };
  if (p.startsWith("/v4/")) return { body: fs.readFileSync(path.join(build, p.slice(4))), type: "text/javascript" };
  if (p.startsWith("/three/")) return { body: fs.readFileSync(path.join(root, "node_modules", p.slice(1))), type: "text/javascript" };
  return null;
}

// ── Shots ─────────────────────────────────────────────────────────────────────
// Key indices (grey pass 2 layout): the eight stops plus the walk to the rim,
// the reveal, the rise, the star look, the bridge and the flight.
const EXTRA = [
  { key: 4, label: "past camp (N1)" },
  { key: 9, label: "toward the rim (N1)" },
  { key: 38, label: "the reveal: tilt up" },
  { key: 43, label: "rise: tilting up to the island" },
  { key: 48, label: "star look: moon" },
  { key: 49, label: "star look: straight up" },
  { key: 55, label: "rope bridge" },
  { key: 59, label: "flight: cast off (night)" },
  { key: 61, label: "flight: first light" },
  { key: 62, label: "flight: dawn, isle ahead" },
  { key: 64, label: "flight: sunrise" },
  { key: 66, label: "flight: docked" },
];

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const report = { light: path.relative(root, lightSrc), lodReflect: !args.includes("--no-lod"), size: `${W}x${H}`, note: "grey stand-in scene, railU faked as key / (n - 1)", shots: [] };
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const r = serve(req.url());
    if (r) req.respond({ status: 200, contentType: r.type, body: r.body });
    else req.respond({ status: 404, body: "" });
  });
  await page.goto("http://lab.test/", { waitUntil: "load" });
  await page.waitForFunction("window.labReady === true || null", { timeout: 120000 }).catch(async () => {
    throw new Error("lab did not start: " + errors.join(" | "));
  });
  const meta = await page.evaluate(() => ({ n: window.lab.n, places: window.lab.places }));
  const list = [
    ...meta.places.map((p) => ({ key: p.trail, label: `${p.id} ${p.module} (${p.light})`, id: p.id })),
    ...EXTRA,
  ].sort((a, b) => a.key - b.key);
  for (const s of list) {
    if (only && !only.has(s.id ?? `k${s.key}`)) continue;
    const t0 = Date.now();
    const r = await page.evaluate((k) => window.lab.shoot(k), s.key);
    const file = path.join(outDir, `${tag}k${String(s.key).padStart(2, "0")}${s.id ? "-" + s.id : ""}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
    report.shots.push({ ...s, file: path.relative(here, file), ms: Date.now() - t0, ...r });
    if (r.stats.reflectionPassCalls && s.id === "a5") console.log(`  a5 light stats: ${JSON.stringify(r.stats)}`);
    console.log(`${s.label.padEnd(40)} calls ${r.calls} luma ${r.luma.mean} fg ${r.fg} spread ${r.spread} p05 ${r.luma.p05} sunEl ${r.sunEl} az ${r.sunAz} stars ${r.stars} lamp ${r.lampGlow}/${r.lampColor} magic ${r.magicGlow}/${r.magicColor} (${Date.now() - t0} ms)`);
  }
  // Views off the route, to judge the cloud layer.
  const OFF = [
    { name: "off-island-lookback", label: "off-route: island looking back SE (night)", pos: [-1900, 1800, -1400], look: [-600, 1500, 0], key: 47 },
    { name: "off-lake-to-peaks", label: "off-route: lake to the west peaks (sunset)", pos: [1300, 700, -300], look: [-1000, 900, -1200], key: 35 },
    { name: "off-flight-clouds", label: "off-route: cloud sea below the flight (sunrise)", pos: [-1500, 1760, -3300], look: [-1900, 1250, -4200], key: 65 },
    { name: "off-forest-dusk", label: "off-route: in the forest looking in (dusk)", pos: [-150, 760, -1000], look: [-700, 800, -1150], key: 40 },
  ];
  for (const o of OFF) {
    if (!only || !only.has(o.name)) continue;
    const r = await page.evaluate((o) => window.lab.shootAt(o.pos, o.look, o.key), o);
    const file = path.join(outDir, `${o.name}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
    report.shots.push({ key: o.key, label: o.label, file: path.relative(here, file), ...r, luma: { mean: "-" } });
    console.log(`${o.label.padEnd(44)} calls ${r.calls} tris ${r.triangles}`);
  }
  if (!only || only.has("a5")) {
    const a5 = meta.places.find((p) => p.id === "a5");
    report.reflection = await page.evaluate((k) => window.lab.islandDiff(k), a5.trail);
    console.log("a5 island-in-reflection diff:", JSON.stringify(report.reflection));
    report.reflectionLakeHidden = await page.evaluate((k) => window.lab.islandDiff(k, true), a5.trail);
    console.log("a5 island diff with the lake hidden (should be 0):", JSON.stringify(report.reflectionLakeHidden));
    const a4 = meta.places.find((p) => p.id === "a4");
    report.islandAtA4 = await page.evaluate((k) => window.lab.islandDiff(k), a4.trail);
    console.log("a4 island diff (should be 0):", JSON.stringify(report.islandAtA4));
  }
  report.track = await page.evaluate(() => window.lab.track());
  console.log("track:", JSON.stringify(report.track && { joins: report.track.joins, backwards: report.track.backwards, sunRisesAtKey: report.track.sunRisesAtKey }));
  report.continuity = await page.evaluate(() => window.lab.continuity(20000));
  console.log("continuity:", JSON.stringify(report.continuity));
  report.idleReturnsFalse = (await page.evaluate(() => window.lab.idle())) === false;
  console.log("idle update() returns false:", report.idleReturnsFalse);
  report.errors = errors;
  if (errors.length) console.log("page errors:", errors);

  // Contact sheet.
  const shots = report.shots;
  const cols = 4;
  const tw = 320, th = Math.round((tw * H) / W);
  const cells = shots.map((s) => {
    const b64 = fs.readFileSync(path.join(here, s.file)).toString("base64");
    return `<div class="c"><img src="data:image/png;base64,${b64}"><p><b>${s.label}</b> · calls ${s.calls} · luma ${s.luma.mean}</p></div>`;
  }).join("");
  const sheet = `<html><body style="margin:0;background:#1d1826;font:12px monospace;color:#f6efe6"><style>.g{display:grid;grid-template-columns:repeat(${cols},${tw}px);gap:6px;padding:6px}.c img{width:${tw}px;height:${th}px;display:block}.c p{margin:3px 0 0}</style><div class="g">${cells}</div></body></html>`;
  const sp = await browser.newPage();
  const rows = Math.ceil(shots.length / cols);
  await sp.setViewport({ width: cols * (tw + 6) + 6, height: rows * (th + 26) + 6, deviceScaleFactor: 1 });
  await sp.setContent(sheet);
  await sp.screenshot({ path: path.join(outDir, `${tag}sheet${only ? "-" + [...only].join("_") : ""}.png`), fullPage: true });
} finally {
  await browser.close();
  fs.rmSync(build, { recursive: true, force: true });
}
fs.writeFileSync(path.join(outDir, `${tag}report${only ? "-" + [...only].join("_") : ""}.json`), JSON.stringify(report, null, 1));
console.log("wrote", path.relative(root, outDir));
