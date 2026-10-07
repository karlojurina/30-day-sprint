/**
 * Blocks lab: renders src/lib/world-v6/blocks.ts on the real V4 terrain,
 * without the rest of the V4 scene.
 *
 *   node world-tests/v6-blocks.mjs close   [w] [h]   # contact sheet: the 8 places close up + island wide + the steps
 *   node world-tests/v6-blocks.mjs stops   [w] [h]   # the 8 rail stops (TRAIL[i] -> LOOK[i], fov 31), progress 3.5, mist 'look' at frontier 3
 *   node world-tests/v6-blocks.mjs motion             # falls at two times + steps at three railU values: proves they move
 *   node world-tests/v6-blocks.mjs check              # numbers only: clearance, calls, triangles, idle
 *   node world-tests/v6-blocks.mjs eval '<js>'
 *   node world-tests/v6-blocks.mjs pass2 <batch 0-2> [w] [h]  # grey pass 2 close-ups, 6 per run: climb,
 *        meadow, forest, steps from behind, rope bridge, bounty isle, ship ride, Harbour Isle
 *   (pass 2: output goes to world-tests/shots/v6-pass2/blocks/)
 *
 * How: headless Chrome on a fake origin (http://lab.test); every request is
 * answered from disk: three from node_modules, the V4 TS files transpiled with
 * typescript's transpileModule. The dev server is not used.
 *
 * The light is a STAND-IN (warm sun, sky fill, haze fog, ACES) and the sea and
 * lake are flat grey-blue stand-ins. Final proof is /dev/world-v6.
 * Output: world-tests/shots/v6/blocks/*.png + report.json
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const require = createRequire(path.join(ROOT, 'package.json'))
const ts = require('typescript')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = path.join(HERE, 'shots', 'v4-pass2', 'blocks')
fs.mkdirSync(OUT, { recursive: true })

const mode = process.argv[2] || 'close'
const BATCH = mode === 'pass2' ? Number(process.argv[3]) || 0 : 0
const cellW = Number(process.argv[mode === 'pass2' ? 4 : 3]) || (mode === 'pass2' ? 960 : 640)
const cellH = Number(process.argv[mode === 'pass2' ? 5 : 4]) || (mode === 'pass2' ? 600 : 400)

const SRC = path.join(ROOT, 'src/lib/world-v6')
function transpile(file) {
  const code = fs.readFileSync(file, 'utf8')
  const out = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  }).outputText
  return out.replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (m, a, spec, b) => (/\.[a-z]+$/.test(spec) ? m : a + spec + '.js' + b))
}

const PAGE = String.raw`<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#222}</style>
<script type="importmap">{"imports":{"three":"/three.module.js","three/examples/jsm/":"/jsm/"}}</script>
</head><body><script type="module" src="/lab.js"></script></body></html>`

const LAB_JS = String.raw`
import * as THREE from 'three';
import { buildTerrainGeometry, terrainHeight } from '/src/terrain.js';
import { PLACES, TRAIL, LOOK, TRAIL_KIND, WORLD, STEPS } from '/src/layout.js';
import { install } from '/src/blocks.js';

const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const haze = lin(0.62, 0.66, 0.74);
scene.background = haze.clone();
scene.fog = new THREE.Fog(haze, 1500, 9000);
const camera = new THREE.PerspectiveCamera(31, 16 / 10, 2, 30000);
const sun = new THREE.DirectionalLight(lin(1.0, 0.88, 0.72), 2.6);
sun.position.set(0.45, 0.5, 0.74).multiplyScalar(4000);
scene.add(sun);
scene.add(new THREE.HemisphereLight(lin(0.62, 0.68, 0.8), lin(0.28, 0.25, 0.22), 1.25));
const terrain = new THREE.Mesh(buildTerrainGeometry(320), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
terrain.name = 'Terrain';
scene.add(terrain);
const water = new THREE.MeshStandardMaterial({ color: lin(0.2, 0.26, 0.32), roughness: 0.35 });
const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), water);
sea.rotation.x = -Math.PI / 2; sea.name = 'StandIn:Sea';
scene.add(sea);
const lake = new THREE.Mesh(new THREE.CircleGeometry(WORLD.lake.r, 64), water);
lake.rotation.x = -Math.PI / 2; lake.position.set(WORLD.lake.x, WORLD.lake.y, WORLD.lake.z); lake.name = 'StandIn:Lake';
scene.add(lake);

// railU: TRAIL curve parameter (WorldCtx.railU); routeU: share of the route by distance.
let railU = 0;
let routeU = 0;
const ctx = { scene, camera, railU: () => railU, routeU: () => routeU, reducedMotion: false };
const t0 = performance.now();
const mod = install(ctx);
const installMs = performance.now() - t0;
const LAB_CALLS = 3; // terrain, sea, lake

// The route as the rail builds it: centripetal Catmull-Rom through TRAIL, by distance.
const curve = new THREE.CatmullRomCurve3(TRAIL.map((q) => new THREE.Vector3(...q)), false, 'centripetal');
const lookCurve = new THREE.CatmullRomCurve3(LOOK.map((q) => new THREE.Vector3(...q)), false, 'centripetal');
const NS = 4000;
const rt = [], rp = [], ra = [0];
for (let i = 0; i <= NS; i++) { rt.push(i / NS); rp.push(curve.getPoint(i / NS)); if (i) ra.push(ra[i - 1] + rp[i].distanceTo(rp[i - 1])); }
const LEN = ra[NS];
const uOfKey = (k) => ra[Math.round(k / (TRAIL.length - 1) * NS)] / LEN;

const tOfU = (u) => { let lo = 0, hi = NS; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ra[m] / LEN < u) lo = m; else hi = m; } return rt[hi]; };
const uOfT = (t) => ra[Math.round(Math.min(1, Math.max(0, t)) * NS)] / LEN;
function frame(time, u) {
  routeU = u; railU = tOfU(u);
  camera.updateMatrixWorld();
  const changed = mod.update(time, 1 / 30);
  renderer.render(scene, camera);
  return changed;
}
function aim(pos, look) { camera.position.copy(pos); camera.lookAt(look); camera.updateMatrixWorld(); }
function hero(target, bearing, dist, elevDeg) {
  const b = bearing * Math.PI / 180, e = elevDeg * Math.PI / 180;
  const t = new THREE.Vector3(...target);
  const p = new THREE.Vector3(t.x + Math.sin(b) * Math.cos(e) * dist, t.y + Math.sin(e) * dist, t.z - Math.cos(b) * Math.cos(e) * dist);
  return [p, t];
}
const HEROES = [
  ['a1 Landing', [1322, 14, 4250], 160, 280, 13],
  ['a2 Base Camp', [478, 158, 2738], 148, 330, 15],
  ['a3 Falls', [-100, 230, 1670], 22, 760, 7],
  ['a4 Climb', [1450, 470, 1070], 172, 640, 5],
  ['a5 Mirror Lake', [1230, 582, -425], 205, 400, 11],
  ['a6 Glowing Forest', [-760, 885, -1000], 112, 560, 9],
  ['a7 Observatory', [-2120, 1692, -1650], 118, 440, 15],
  ['a8 Sky Port', [-2900, 1695, -1790], 152, 560, 12],
  ['Sky Island (wide)', [-2150, 1520, -1750], 125, 2400, 4],
  ['Floating steps', [-1330, 1180, -1130], 165, 1250, 3],
];
function sheet(shots, w, h, cols, time, label) {
  const rows = Math.ceil(shots.length / cols);
  const c = document.createElement('canvas'); c.width = w * cols; c.height = h * rows;
  const g = c.getContext('2d');
  renderer.setPixelRatio(1); renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const info = [];
  shots.forEach((s, k) => {
    aim(s.pos, s.look);
    if (s.progress != null) mod.setProgress(s.progress);
    const changed = frame(s.time ?? time, s.u ?? routeU);
    info.push({ name: s.name, calls: renderer.info.render.calls, blockCalls: renderer.info.render.calls - LAB_CALLS, tris: renderer.info.render.triangles, animating: mod.isAnimating(), changed });
    g.drawImage(renderer.domElement, (k % cols) * w, Math.floor(k / cols) * h);
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect((k % cols) * w, Math.floor(k / cols) * h, 250, 22);
    g.fillStyle = '#fff'; g.font = '14px monospace';
    g.fillText(s.name, (k % cols) * w + 6, Math.floor(k / cols) * h + 16);
  });
  if (label) { g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(c.width - 520, c.height - 24, 520, 24); g.fillStyle = '#fff'; g.fillText(label, c.width - 512, c.height - 7); }
  return { png: c.toDataURL('image/png'), info };
}

// Clearance: route samples against every block vertex and triangle centre.
function clearance() {
  scene.updateMatrixWorld(true);
  const pts = [];
  // The lift cage, its lamp and its cable ride with the camera up the shaft
  // (blocks update() moves them each frame); parked at the foot here, they
  // would read as d=0 against the camera that stands inside the cage.
  const skip = /^(PlaceMist|FallsSpray|LanternHalos|Pool|LiftCage_Block|LiftCage_Lamp|LiftCable)$/;
  const v = new THREE.Vector3(), m4 = new THREE.Matrix4();
  mod.root.traverse((o) => {
    if (!o.isMesh || skip.test(o.name)) return;
    const pos = o.geometry.getAttribute('position');
    const n = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < n; k++) {
      if (o.isInstancedMesh) { o.getMatrixAt(k, m4); m4.premultiply(o.matrixWorld); } else m4.copy(o.matrixWorld);
      const idx = o.geometry.index;
      const cnt = idx ? idx.count : pos.count;
      for (let i = 0; i < cnt; i += 3) {
        const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
        const A = new THREE.Vector3().fromBufferAttribute(pos, a).applyMatrix4(m4);
        const B = new THREE.Vector3().fromBufferAttribute(pos, b).applyMatrix4(m4);
        const C = new THREE.Vector3().fromBufferAttribute(pos, c).applyMatrix4(m4);
        pts.push([A, o.name], [B, o.name], [C, o.name], [A.clone().add(B).add(C).divideScalar(3), o.name]);
        // Long faces: a few points along the edges too.
        for (const [P, Q] of [[A, B], [B, C], [C, A]]) {
          const L = P.distanceTo(Q);
          for (let s = 20; s < L; s += 20) pts.push([P.clone().lerp(Q, s / L), o.name]);
        }
      }
    }
  });
  // Spatial hash.
  const CELL = 60, grid = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  for (const p of pts) {
    const k = key(Math.floor(p[0].x / CELL), Math.floor(p[0].y / CELL), Math.floor(p[0].z / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const worst = [];
  const kindAt = (t) => TRAIL_KIND[Math.min(TRAIL.length - 1, Math.round(t * (TRAIL.length - 1)))];
  for (let i = 0; i <= NS; i += 2) {
    const c = rp[i];
    let best = 1e9, who = '';
    const cx = Math.floor(c.x / CELL), cy = Math.floor(c.y / CELL), cz = Math.floor(c.z / CELL);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
      const arr = grid.get(key(cx + dx, cy + dy, cz + dz)); if (!arr) continue;
      for (const [p, n] of arr) { const d = p.distanceTo(c); if (d < best) { best = d; who = n; } }
    }
    worst.push({ s: Math.round(ra[i]), u: +(ra[i] / LEN).toFixed(4), d: Math.round(best), who, kind: kindAt(rt[i]), at: [c.x, c.y, c.z].map(Math.round) });
  }
  worst.sort((a, b) => a.d - b.d);
  return { points: pts.length, worst: worst.slice(0, 12) };
}

// Stop shots from the rail keys.
function stopShots() {
  return PLACES.map((p) => ({ name: p.id + ' stop: ' + p.module, pos: new THREE.Vector3(...TRAIL[p.trail]), look: new THREE.Vector3(...LOOK[p.trail]), u: uOfKey(p.trail) }));
}

// Grey pass 2 close-ups. railShot: the camera where the rail puts it at key k (fractional).
const railShot = (name, k, extra = {}) => { const t = k / (TRAIL.length - 1); return { name, pos: curve.getPoint(t), look: lookCurve.getPoint(t), u: uOfT(t), ...extra }; };
const heroShot = (name, target, b, d, e, extra = {}) => { const [pos, look] = hero(target, b, d, e); return { name, pos, look, ...extra }; };
const PASS2 = () => [
  [
    railShot('a4 stop: the Climb (N3)', 26),
    heroShot('Climb close: lift, derrick, stage', [1575, 470, 1160], 205, 420, 6),
    heroShot('Climb close: stairs, gallery, landing', [1520, 380, 1160], 160, 360, 4),
    railShot('climbing (key 28.6)', 28.6),
    railShot('over the rim to the saddle (key 30)', 30),
    railShot('walk to the lake (key 32)', 32),
  ],
  [
    railShot('walk to the lake (key 33.5, N4)', 33.5),
    heroShot('meadow and brook from above', [1450, 600, 200], 40, 1500, 38),
    railShot('a5 stop: Mirror Lake', 35),
    railShot('into the forest (key 38, N5)', 38),
    railShot('a6 stop: the Great Tree', 40),
    heroShot('the forest from above', [-560, 800, -1090], 150, 1700, 30),
  ],
  [
    railShot('behind the first step (key 41, N6)', 41),
    railShot('rising (key 42)', 42),
    railShot('on the rope bridge (key 54.5, N8)', 54.5, { progress: 8 }),
    heroShot('bridge, bounty isle, your ship moored', [-1640, 1630, -2400], 270, 520, 14, { progress: 8 }),
    railShot('the ship ride (key 62.5, N9)', 62.5, { progress: 8 }),
    railShot('the Harbour Isle ahead (key 65)', 65, { progress: 8 }),
  ],
  [
    railShot('docked (key 66.3)', 66.3, { progress: 8 }),
    railShot('a8 stop: the Guild Hall', 68, { progress: 8 }),
    heroShot('the Harbour Isle from above', [-2250, 1600, -4300], 135, 1500, 22, { progress: 8 }),
    heroShot('your ship docked, the berth', [-2010, 1620, -4010], 90, 330, 10, { progress: 8 }),
    railShot('a6 stop again (crown check)', 40),
    heroShot('the Sky Island + bridge (wide)', [-2000, 1560, -1950], 60, 1900, 6, { progress: 8 }),
  ],
];

window.__lab = {
  ready: true, installMs, stats: () => mod.stats(), run(src) { return eval(src); },
  pass2(w, h, batch) {
    mod.setProgress(3.5);
    return sheet(PASS2()[batch], w, h, 3, 12.3, 'grey pass 2, batch ' + batch);
  },
  close(w, h) {
    mod.setProgress(8);
    const shots = HEROES.map(([name, t, b, d, e]) => { const [pos, look] = hero(t, b, d, e); return { name, pos, look, u: name.startsWith('Floating') ? uOfKey(37) : 0 }; });
    return sheet(shots, w, h, 4, 12.3, 'progress 8 (all lit), steps at railU(key 37)');
  },
  stops(w, h) {
    mod.setProgress(3.5);
    mod.setMist([4, 5, 6, 7]);
    // Let the mist fade all the way in.
    for (let i = 0; i < 60; i++) mod.update(i / 30, 1 / 30);
    return sheet(stopShots(), w, h, 4, 5, 'progress 3.5, mist on a5-a8 (look mode, frontier a4)');
  },
  motion(w, h) {
    mod.setProgress(8);
    const shots = [];
    // The dive: from key 12 looking where the rail looks, at two times 0.25 s apart.
    const kd = 13;
    const dpos = new THREE.Vector3(...TRAIL[kd]), dlook = new THREE.Vector3(...LOOK[kd]);
    shots.push({ name: 'dive key 13, t=3.00', pos: dpos, look: dlook, t: 3.0 });
    shots.push({ name: 'dive key 13, t=3.25', pos: dpos, look: dlook, t: 3.25 });
    const [p3, l3] = hero([-100, 230, 1670], 22, 760, 7);
    shots.push({ name: 'falls t=3.00', pos: p3, look: l3, t: 3.0 });
    shots.push({ name: 'falls t=3.25', pos: p3, look: l3, t: 3.25 });
    const [ps, ls] = hero([-1330, 1180, -1130], 165, 1250, 3);
    for (const k of [34, 37, 40]) shots.push({ name: 'steps, railU at key ' + k, pos: ps, look: ls, t: 5, u: uOfKey(k) });
    const rows = 2, cols = 4;
    const c = document.createElement('canvas'); c.width = w * cols; c.height = h * rows;
    const g = c.getContext('2d');
    renderer.setPixelRatio(1); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const diffs = [];
    let prev = null;
    shots.forEach((s, k) => {
      aim(s.pos, s.look);
      railU = s.u ?? 0;
      mod.update(s.t, 1 / 30);
      renderer.render(scene, camera);
      const px = new Uint8Array(w * h * 4);
      const gl = renderer.getContext();
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (k % 2 === 1 && k < 4) {
        let changed = 0; for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - prev[i]) + Math.abs(px[i + 1] - prev[i + 1]) + Math.abs(px[i + 2] - prev[i + 2]) > 12) changed++;
        diffs.push({ pair: s.name, changedPx: changed, share: +(changed / (w * h)).toFixed(4) });
      }
      prev = px;
      g.drawImage(renderer.domElement, (k % cols) * w, Math.floor(k / cols) * h);
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect((k % cols) * w, Math.floor(k / cols) * h, 260, 22);
      g.fillStyle = '#fff'; g.font = '14px monospace'; g.fillText(s.name, (k % cols) * w + 6, Math.floor(k / cols) * h + 16);
    });
    return { png: c.toDataURL('image/png'), info: { diffs, settled: mod.stats().settled } };
  },
  check() {
    const out = { stats: mod.stats(), installMs: Math.round(installMs) };
    out.clearance = clearance();
    // Idle at each stop: does anything animate, and how many calls do blocks add?
    renderer.setSize(960, 600, false); camera.aspect = 1.6; camera.updateProjectionMatrix();
    mod.setMist([]); mod.setProgress(8);
    for (let i = 0; i < 60; i++) mod.update(i / 30, 1 / 30);
    out.stops = stopShots().map((s) => { aim(s.pos, s.look); frame(7, s.u); frame(7.1, s.u); return { name: s.name, animating: mod.isAnimating(), blockCalls: renderer.info.render.calls - LAB_CALLS, frameTris: renderer.info.render.triangles }; });
    // Worst case for calls: everything lit plus mist everywhere, at each stop.
    mod.setMist([0, 1, 2, 3, 4, 5, 6, 7]);
    for (let i = 0; i < 60; i++) mod.update(i / 30, 1 / 30);
    out.stopsMist = stopShots().map((s) => { aim(s.pos, s.look); frame(8, s.u); return { name: s.name, blockCalls: renderer.info.render.calls - LAB_CALLS }; });
    mod.setMist([]);
    // Every LM_* the scene will index.
    out.landmarks = PLACES.map((p) => { const o = scene.getObjectByName(p.mesh); if (!o) return { mesh: p.mesh, missing: true };
      const b = new THREE.Box3().setFromObject(o); return { mesh: p.mesh, pos: [o.position.x, o.position.y, o.position.z], min: b.min.toArray().map(Math.round), max: b.max.toArray().map(Math.round), height: Math.round(b.max.y - p.pos.y), children: o.children.map((c) => c.name) }; });
    let lmNamed = 0; scene.traverse((o) => { if (o.name.startsWith('LM_')) lmNamed++; });
    out.lmObjects = lmNamed;
    // Island stays inside r 600.
    let maxR = 0; const isl = scene.getObjectByName('Set_a7');
    const g = isl.children[0].geometry, pos = g.getAttribute('position'), v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(isl.children[0].matrixWorld); if (v.y > WORLD.island.y - 5) { const r = Math.hypot(v.x - WORLD.island.x, v.z - WORLD.island.z); if (r < 700) maxR = Math.max(maxR, r); } }
    out.islandTopMaxR = Math.round(maxR);
    return out;
  },
};
`
const FILES = {
  '/': ['text/html', () => PAGE],
  '/lab.js': ['text/javascript', () => LAB_JS],
  '/three.module.js': ['text/javascript', () => fs.readFileSync(path.join(ROOT, 'node_modules/three/build/three.module.js'))],
  '/three.core.js': ['text/javascript', () => fs.readFileSync(path.join(ROOT, 'node_modules/three/build/three.core.js'))],
}
function serve(url) {
  const p = new URL(url).pathname
  if (FILES[p]) return { contentType: FILES[p][0], body: FILES[p][1]() }
  if (p.startsWith('/jsm/')) return { contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'node_modules/three/examples/jsm', p.slice(5))) }
  if (p.startsWith('/src/')) return { contentType: 'text/javascript', body: transpile(path.join(SRC, p.slice(5).replace(/\.js$/, '.ts'))) }
  return null
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
try {
  const page = await browser.newPage()
  page.on('console', (m) => { const t = m.text(); if (!/GPU stall|WebGL|swiftshader/i.test(t)) console.log('[page]', t) })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    try {
      const r = serve(req.url())
      if (r) return req.respond({ status: 200, contentType: r.contentType, body: r.body, headers: { 'Access-Control-Allow-Origin': '*' } })
      return req.respond({ status: 404, body: 'nope' })
    } catch (e) {
      console.log('[serve]', req.url(), e.message)
      return req.respond({ status: 500, body: String(e) })
    }
  })
  await page.setViewport({ width: 800, height: 600 })
  await page.goto('http://lab.test/', { waitUntil: 'load' })
  await page.waitForFunction('window.__lab && window.__lab.ready', { timeout: 180000 })
  console.log('install ms', (await page.evaluate('window.__lab.installMs')).toFixed(1))
  console.log('stats', JSON.stringify(await page.evaluate('window.__lab.stats()')))
  const t = Date.now()
  if (mode === 'eval') {
    console.log(JSON.stringify(await page.evaluate((s) => window.__lab.run(s), process.argv[3])))
  } else if (mode === 'check') {
    const r = await page.evaluate('window.__lab.check()')
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(r, null, 1))
    console.log(JSON.stringify(r, null, 1))
  } else {
    const r = await page.evaluate((m, w, h, b) => window.__lab[m](w, h, b), mode, cellW, cellH, BATCH)
    const file = path.join(OUT, `${mode}${mode === 'pass2' ? '-' + BATCH : ''}${process.env.TAG ? '-' + process.env.TAG : ''}.png`)
    fs.writeFileSync(file, Buffer.from(r.png.split(',')[1], 'base64'))
    console.log('wrote', file)
    console.log(JSON.stringify(r.info))
  }
  console.log('ms', Date.now() - t)
} finally {
  await browser.close()
}
