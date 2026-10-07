/**
 * Landmark lab: renders src/lib/world-v3/landmarks.ts on the REAL terrain,
 * with the REAL park solver, without needing the rest of the V3 scene.
 *
 *   node world-tests/v3-lm-lab.mjs dump            # glb LM_* data, river, rail stops
 *   node world-tests/v3-lm-lab.mjs sheet [w] [h]   # contact sheet of the 8 parks
 *   node world-tests/v3-lm-lab.mjs rail  [w] [h]   # contact sheet of the 8 rail stops
 *   node world-tests/v3-lm-lab.mjs hero  [w] [h]   # tight 3/4 views, for detail
 *   node world-tests/v3-lm-lab.mjs eval '<js>'     # evaluate in the lab module (hf, rail, scene...)
 *
 * How: headless Chrome loads a page on a fake origin (http://lab.test). Every
 * request is answered from disk by request interception: three from
 * node_modules, the V3 TS files transpiled on the fly with typescript's
 * transpileModule, the glb and Draco decoder from public/world-v3. The dev
 * server is not used.
 *
 * The lighting is a STAND-IN for atmosphere.ts (sun front-left and low, a warm
 * fill, haze fog, ACES). The glb's old trees and rocks are hidden, as
 * forest.ts removes them. Final proof belongs in the real /dev/world-v3.
 *
 * Output: world-tests/shots/v3/lm-<mode>.png (+ lm-dump.json for dump).
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
const OUT = path.join(HERE, 'shots', 'v3')
fs.mkdirSync(OUT, { recursive: true })

const mode = process.argv[2] || 'sheet'
const cellW = Number(process.argv[3]) || 560
const cellH = Number(process.argv[4]) || Math.round(cellW * 1278 / 1691)

const SRC = path.join(ROOT, 'src/lib/world-v3')
function transpile(file) {
  const code = fs.readFileSync(file, 'utf8')
  const out = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  }).outputText
  // Extensionless relative imports -> .js on the lab origin.
  return out.replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (m, a, spec, b) => (/\.[a-z]+$/.test(spec) ? m : a + spec + '.js' + b))
}

const PAGE = String.raw`<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#222}</style>
<script type="importmap">{"imports":{"three":"/three.module.js","three/examples/jsm/":"/jsm/"}}</script>
</head><body><script type="module" src="/lab.js"></script></body></html>`

const LAB_JS = String.raw`
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { buildHeightfield } from '/src/heightfield.js';
import { createRail } from '/src/rail.js';
import { buildLandmark, solveParkPose } from '/src/scene.js';
import { install } from '/src/landmarks.js';

const NAMES = ['LM_Lighthouse','LM_Windmill','LM_Bridge','LM_Viaduct','LM_Watchtower','LM_Cairn','LM_Jetty','LM_Obelisk'];
const DEPTHS = [0.0708,0.1934,0.30,0.4151,0.5236,0.6321,0.6863,0.8302];
const lin = (r,g,b) => new THREE.Color().setRGB(r,g,b,THREE.LinearSRGBColorSpace);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const haze = lin(1.0, 0.55, 0.34);
scene.background = haze.clone();
scene.fog = new THREE.Fog(haze, 430, 2300);
const camera = new THREE.PerspectiveCamera(31, 1691/1278, 1, 6000);
const sunDir = new THREE.Vector3(-0.42, 0.26, -0.87).normalize();
const sunColor = lin(1.0, 0.62, 0.36);
const sun = new THREE.DirectionalLight(sunColor, 3.2);
sun.position.copy(sunDir).multiplyScalar(1000);
scene.add(sun);
const hemi = new THREE.HemisphereLight(lin(0.62, 0.50, 0.44), lin(0.30, 0.22, 0.17), 1.7);
scene.add(hemi);

const draco = new DRACOLoader(); draco.setDecoderPath('/draco/');
const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
const gltf = await new Promise((res, rej) => loader.load('/world.glb', res, undefined, rej));
const root = gltf.scene;
scene.add(root);
root.updateMatrixWorld(true);
// Trap 1: strip the flattened haze emissive, as scene.ts does.
root.traverse((o) => {
  if (!o.isMesh) return;
  for (const m of [].concat(o.material)) {
    if (!m || !m.emissive || /^(Pin\d|RidgeMat\d|(Lake|Pond)Mat|LM_LighthouseLampMat)$/.test(m.name)) continue;
    m.emissive.setHex(0);
  }
  if (/^(T|R)\d+$/.test(o.name) || /^House/.test(o.name)) o.visible = false;
});
const hf = buildHeightfield(root, 'Terrain');
const rail = createRail();
rail.setGround((x, z) => hf.heightAt(x, z));

function riverXAtZ(z) {
  const t = (1000 - z) / 2000;
  if (!(t > 0.2 && t < 0.7)) return NaN;
  return 310 * (Math.sin(5.2 * t) * 0.30 + Math.sin(11 * t) * 0.08);
}

// Bases as the glb had them (same rule scene.ts uses for its own box).
const landmarks = {};
const glbInfo = {};
for (const name of NAMES) {
  const o = root.getObjectByName(name);
  if (!o) continue;
  const box = new THREE.Box3().setFromObject(o);
  const c = box.getCenter(new THREE.Vector3());
  landmarks[name] = { x: c.x, y: hf.heightAt(c.x, c.z), z: c.z, height: box.max.y - box.min.y };
  const kids = [];
  o.traverse((d) => { if (d !== o) kids.push({ name: d.name, type: d.type }); });
  glbInfo[name] = { type: o.type, min: box.min.toArray().map(Math.round), max: box.max.toArray().map(Math.round),
    rot: o.rotation.toArray().slice(0,3).map((v) => +v.toFixed(3)), scale: o.scale.toArray().map((v)=>+v.toFixed(2)), kids };
}

const ctx = {
  scene, root, renderer, camera,
  heightAt: (x, z) => hf.heightAt(x, z),
  pathXAtZ: (z) => rail.pathXAtZ(z),
  riverXAtZ, landmarks, sunDir, sunColor, hazeColor: haze, reducedMotion: false,
};
const t0 = performance.now();
const mod = await install(ctx);
const installMs = performance.now() - t0;
scene.updateMatrixWorld(true);

// Ground or water, as scene.ts's surface(): Sea is a box, Lake and Pond are discs.
const waters = [];
for (const n of ['Sea', 'Lake', 'Pond']) {
  const o = root.getObjectByName(n); if (!o) continue;
  const b = new THREE.Box3().setFromObject(o); if (b.isEmpty()) continue;
  waters.push({ y: b.max.y, cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2, rx: Math.max(1e-3, (b.max.x - b.min.x) / 2), rz: Math.max(1e-3, (b.max.z - b.min.z) / 2), round: n !== 'Sea' });
}
const surface = (x, z) => {
  let h = hf.heightAt(x, z);
  for (const w of waters) {
    if (w.y <= h) continue;
    const u = (x - w.cx) / w.rx, v = (z - w.cz) / w.rz;
    if (w.round ? u * u + v * v <= 1 : Math.abs(u) <= 1 && Math.abs(v) <= 1) h = w.y;
  }
  return h;
};
function lmFor(name) {
  const o = scene.getObjectByName(name);
  if (!o) return null;
  const meshes = [];
  o.traverse((d) => { if (d.isMesh) meshes.push(d); });
  return buildLandmark(meshes, surface);
}

function stats() {
  const out = {};
  for (const name of NAMES) {
    const o = scene.getObjectByName(name);
    if (!o) { out[name] = null; continue; }
    let tris = 0, meshes = 0; const mats = new Set();
    o.traverse((d) => { if (!d.isMesh) return; meshes++; for (const m of [].concat(d.material)) mats.add(m.name || m.uuid);
      const g = d.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; });
    const box = new THREE.Box3().setFromObject(o);
    out[name] = { tris, meshes, mats: [...mats], min: box.min.toArray().map(Math.round), max: box.max.toArray().map(Math.round) };
  }
  return out;
}

window.__lab = {
  ready: true,
  run(src) { return eval(src); },
  installMs,
  modStats: mod.stats ? mod.stats() : null,
  dump() {
    const stops = DEPTHS.map((d, i) => {
      const p = { position: new THREE.Vector3(), target: new THREE.Vector3() };
      rail.sample(d, p);
      return { id: 'a' + (i + 1), pos: p.position.toArray().map(Math.round), target: p.target.toArray().map(Math.round) };
    });
    const river = [];
    for (let z = 600; z >= -400; z -= 25) river.push([z, +riverXAtZ(z).toFixed(1), +hf.heightAt(riverXAtZ(z) || 0, z).toFixed(1)]);
    return { landmarks, glbInfo, stops, river, stats: stats() };
  },
  stats,
  sheet(kind, w, h, which) {
    const list = which ? NAMES.filter((n) => which.includes(n)) : NAMES;
    const cols = Math.min(4, list.length), rows = Math.ceil(list.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = w * cols; sheet.height = h * rows;
    const g = sheet.getContext('2d');
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const info = [];
    const others = NAMES.map(lmFor).filter(Boolean);
    list.forEach((name, k) => {
      const i = NAMES.indexOf(name);
      const p = { position: new THREE.Vector3(), target: new THREE.Vector3() };
      rail.sample(DEPTHS[i], p);
      const lm = lmFor(name);
      let pos, look;
      if (kind === 'rail' || !lm) { pos = p.position; look = p.target; }
      else if (kind === 'hero') {
        const size = lm.vis.getSize(new THREE.Vector3());
        const r = Math.max(size.x, size.y, size.z);
        const dir = new THREE.Vector3().subVectors(p.position, lm.center).setY(0).normalize();
        dir.applyAxisAngle(new THREE.Vector3(0,1,0), 0.5);
        pos = lm.center.clone().addScaledVector(dir, r * 1.9); pos.y = Math.max(lm.vis.min.y + (lm.vis.max.y - lm.vis.min.y) * 0.7 + r * 0.25, surface(pos.x, pos.z) + 8);
        look = lm.visCenter.clone();
      } else {
        const res = solveParkPose({ landmark: lm, others, railPos: p.position, railTarget: p.target, aspect: 1691/1278, widthPx: 1691, surface, sunDir });
        pos = res.pos; look = res.look;
        info.push({ name, dist: Math.round(res.dist), pitch: res.pitch, yaw: res.yaw, visible: +res.visible.toFixed(2) });
      }
      camera.position.copy(pos); camera.lookAt(look);
      camera.updateMatrixWorld();
      // Share of frame height the landmark's box covers from here.
      if (lm) {
        const b = lm.box; let y0 = 1, y1 = -1;
        for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
          const v = new THREE.Vector3(x, y, z).project(camera); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
        }
        // Silhouette: only the landmark's above-ground sample points (what a student sees).
        let s0 = 1, s1 = -1;
        const sm = lm.samples;
        for (let q = 0; q < sm.length; q += 3) {
          const v = new THREE.Vector3(sm[q], sm[q + 1], sm[q + 2]).project(camera);
          if (v.z > 1) continue;
          s0 = Math.min(s0, v.y); s1 = Math.max(s1, v.y);
        }
        info.push({ name, kind, boxH: +((Math.min(1, y1) - Math.max(-1, y0)) / 2).toFixed(2), visH: +((Math.min(1, s1) - Math.max(-1, s0)) / 2).toFixed(2) });
      }
      renderer.render(scene, camera);
      g.drawImage(renderer.domElement, (k % cols) * w, Math.floor(k / cols) * h);
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect((k % cols) * w, Math.floor(k / cols) * h, 150, 20);
      g.fillStyle = '#fff'; g.font = '13px monospace';
      g.fillText(name.replace('LM_',''), (k % cols) * w + 6, Math.floor(k / cols) * h + 15);
    });
    return { png: sheet.toDataURL('image/png'), info, calls: renderer.info.render.calls };
  },
};
`

const FILES = {
  '/': ['text/html', () => PAGE],
  '/lab.js': ['text/javascript', () => LAB_JS],
  '/three.module.js': ['text/javascript', () => fs.readFileSync(path.join(ROOT, 'node_modules/three/build/three.module.js'))],
  '/world.glb': ['model/gltf-binary', () => fs.readFileSync(path.join(ROOT, 'public/world-v3/world.glb'))],
}

function serve(url) {
  const u = new URL(url)
  const p = u.pathname
  if (FILES[p]) return { contentType: FILES[p][0], body: FILES[p][1]() }
  if (p.startsWith('/jsm/')) return { contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'node_modules/three/examples/jsm', p.slice(5))) }
  if (p.startsWith('/draco/')) {
    const f = path.join(ROOT, 'public/world-v3/draco', p.slice(7))
    return { contentType: f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', body: fs.readFileSync(f) }
  }
  if (p.startsWith('/src/')) {
    const f = path.join(SRC, p.slice(5).replace(/\.js$/, '.ts'))
    if (!fs.existsSync(f)) return { contentType: 'text/javascript', body: 'export const install = () => ({ name: "stub", dispose() {} });' }
    return { contentType: 'text/javascript', body: transpile(f) }
  }
  return null
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
try {
  const page = await browser.newPage()
  page.on('console', (m) => { const t = m.text(); if (!/GPU stall|WebGL/.test(t)) console.log('[page]', t) })
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
  await page.waitForFunction('window.__lab && window.__lab.ready', { timeout: 120000 })
  const installMs = await page.evaluate('window.__lab.installMs')
  console.log('install ms', installMs.toFixed(1))
  console.log('module stats', JSON.stringify(await page.evaluate('window.__lab.modStats')))
  if (mode === 'eval') {
    console.log(JSON.stringify(await page.evaluate((s) => window.__lab.run(s), process.argv[3])))
  } else if (mode === 'dump') {
    const d = await page.evaluate('window.__lab.dump()')
    fs.writeFileSync(path.join(OUT, 'lm-dump.json'), JSON.stringify(d, null, 1))
    console.log(JSON.stringify(d, null, 1))
  } else {
    const which = process.env.ONLY ? process.env.ONLY.split(',').map((s) => 'LM_' + s) : null
    const t = Date.now()
    const r = await page.evaluate((k, w, h, wh) => window.__lab.sheet(k, w, h, wh), mode, cellW, cellH, which)
    const file = path.join(OUT, `lm-${mode}${process.env.TAG ? '-' + process.env.TAG : ''}.png`)
    fs.writeFileSync(file, Buffer.from(r.png.split(',')[1], 'base64'))
    console.log('wrote', file, 'in', Date.now() - t, 'ms')
    console.log(JSON.stringify(r.info))
    console.log(JSON.stringify(await page.evaluate('window.__lab.stats()')))
  }
} finally {
  await browser.close()
}
