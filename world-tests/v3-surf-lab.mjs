/**
 * Surfaces lab: renders src/lib/world-v3/surfaces.ts on the REAL terrain from
 * the REAL rail poses, with atmosphere.ts (and optionally forest.ts) installed
 * first, without needing the rest of the V3 scene.
 *
 *   node world-tests/v3-surf-lab.mjs shots [w] [h] [--stops default,a3,a5] [--forest] [--tag name]
 *   node world-tests/v3-surf-lab.mjs eval '<js>'   # evaluate in the lab module (hf, rail, scene, mod...)
 *
 * How: headless Chrome loads a page on a fake origin (http://lab.test). Every
 * request is answered from disk by request interception: three from
 * node_modules, the V3 TS files transpiled with typescript's transpileModule,
 * the glb and Draco decoder from public/world-v3. The dev server is not used.
 *
 * scene.ts's fog patch (patchFog) is replayed AFTER the modules install, as
 * the real scene does, so the lab also proves surfaces.ts's shader hooks
 * survive it. Final proof belongs in the real /dev/world-v3.
 *
 * Output: world-tests/shots/v3/surfaces/<tag>-<stop>.png, plus measurements.
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
const OUT = path.join(HERE, 'shots', 'v3', 'surfaces')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const flag = (k) => argv.includes(k)
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const mode = argv[0] || 'shots'
const W = Number(argv[1]) || 960
const H = Number(argv[2]) || 600
const STOPS = opt('--stops', 'default,a3,a5').split(',')
const TAG = opt('--tag', 'lab')
const FOREST = flag('--forest')

const SRC = path.join(ROOT, 'src/lib/world-v3')
function transpile(file) {
  const code = fs.readFileSync(file, 'utf8')
  const out = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
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
import { install as installSurfaces } from '/src/surfaces.js';

const FOREST = ${FOREST};
const DEPTH = { default: 0, a1: 0.0708, a2: 0.1934, a3: 0.30, a4: 0.4151, a5: 0.5236, a6: 0.6321, a7: 0.6863, a8: 0.8302 };
const FOG_TABLE = [[0.0, 430, 2300], [0.45, 400, 2050], [0.88, 340, 1700]];
const lin = (r,g,b) => new THREE.Color().setRGB(r,g,b,THREE.LinearSRGBColorSpace);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const haze = lin(1.0, 0.55, 0.34);
scene.background = haze.clone();
const fog = new THREE.Fog(haze.clone(), 430, 2300);
scene.fog = fog;
const camera = new THREE.PerspectiveCamera(31, 960/600, 1, 6000);
const sunDir = new THREE.Vector3(-0.62, 0.3, -0.72).normalize();
const sunColor = lin(1.0, 0.46, 0.2);

const draco = new DRACOLoader(); draco.setDecoderPath('/draco/');
const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
const gltf = await new Promise((res, rej) => loader.load('/world.glb', res, undefined, rej));
const root = gltf.scene;
scene.add(root);
root.updateMatrixWorld(true);
root.traverse((o) => {
  if (!o.isMesh) return;
  for (const m of [].concat(o.material)) {
    if (!m || !m.emissive || /^(Pin\d|RidgeMat\d|(Lake|Pond)Mat|LM_LighthouseLampMat)$/.test(m.name)) continue;
    m.emissive.setHex(0);
  }
});
const hf = buildHeightfield(root, 'Terrain');
const rail = createRail();
rail.setGround((x, z) => hf.heightAt(x, z));
function riverXAtZ(z) {
  const t = (1000 - z) / 2000;
  if (!(t > 0.2 && t < 0.7)) return NaN;
  return 310 * (Math.sin(5.2 * t) * 0.30 + Math.sin(11 * t) * 0.08);
}
const landmarks = {};
root.traverse((o) => {
  if (!o.name.startsWith('LM_')) return;
  const box = new THREE.Box3().setFromObject(o);
  if (box.isEmpty()) return;
  const x = (box.min.x + box.max.x) / 2, z = (box.min.z + box.max.z) / 2;
  const y = Math.max(box.min.y, hf.heightAt(x, z));
  landmarks[o.name] = { x, y, z, height: Math.max(0, box.max.y - y) };
});
const ctx = {
  scene, root, renderer, camera,
  heightAt: (x, z) => hf.heightAt(x, z),
  pathXAtZ: (z) => rail.pathXAtZ(z),
  riverXAtZ, landmarks, sunDir: sunDir.clone(), sunColor: sunColor.clone(), hazeColor: haze.clone(), reducedMotion: false,
};

const report = {};
async function tryInstall(name, url) {
  try {
    const mod = await import(url);
    const t0 = performance.now();
    const m = await mod.install(ctx);
    report[name] = { ms: Math.round(performance.now() - t0), stats: m.stats ? m.stats() : null };
    return m;
  } catch (e) {
    report[name] = { error: String(e && e.stack || e) };
    return null;
  }
}
const atmo = await tryInstall('atmosphere', '/src/atmosphere.js');
if (!atmo) {
  const sun = new THREE.DirectionalLight(sunColor, 3.2); sun.position.copy(sunDir).multiplyScalar(1000); scene.add(sun);
  scene.add(new THREE.HemisphereLight(lin(0.33, 0.29, 0.26), lin(0.14, 0.08, 0.05), 1.35));
}
const t0 = performance.now();
const surf = await installSurfaces(ctx);
report.surfaces = { ms: Math.round(performance.now() - t0), stats: surf.stats ? surf.stats() : null };
let forest = null;
if (FOREST) forest = await tryInstall('forest', '/src/forest.js');
if (!forest) root.traverse((o) => { if (/^(T|R)\d+$/.test(o.name) || /^House/.test(o.name)) o.visible = false; });

// Replay scene.ts patchFog: every fog-taking standard material gets a capped-fog hook, AFTER install.
const fogMax = { value: 0.9 };
const noFloor = { value: 0 };
const patched = new Set();
scene.traverse((o) => {
  if (!o.isMesh) return;
  for (const m of [].concat(o.material)) {
    if (!m || patched.has(m) || m.isShaderMaterial || !m.fog) continue;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.fogMax = fogMax; shader.uniforms.fogMin = noFloor;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\nuniform float fogMax;\nuniform float fogMin;')
        .replace('#include <fog_fragment>', '#ifdef USE_FOG\n float fogFactor = max( fogMin, fogMax * smoothstep( fogNear, fogFar, vFogDepth ) );\n gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );\n#endif');
    };
    m.needsUpdate = true;
    patched.add(m);
  }
});

function fogAt(d) {
  let i = 0; while (i < FOG_TABLE.length - 2 && d > FOG_TABLE[i + 1][0]) i++;
  const [d0, n0, f0] = FOG_TABLE[i], [d1, n1, f1] = FOG_TABLE[i + 1];
  const k = Math.min(1, Math.max(0, (d - d0) / (d1 - d0)));
  return [n0 + (n1 - n0) * k, f0 + (f1 - f0) * k];
}

function measure(canvas) {
  const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
  const g = c.getContext('2d'); g.drawImage(canvas, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const lum = [], fg = [], hues = []; let violet = 0, n = 0;
  for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
    const i = (y * c.width + x) * 4, r = d[i], gg = d[i+1], b = d[i+2];
    const L = 0.2126*r + 0.7152*gg + 0.0722*b; lum.push(L); n++;
    if (y > c.height * 0.6) fg.push(L);
    const mx = Math.max(r,gg,b), mn = Math.min(r,gg,b);
    if (mx - mn > 12) {
      let h; if (mx === r) h = ((gg-b)/(mx-mn)) % 6; else if (mx === gg) h = (b-r)/(mx-mn) + 2; else h = (r-gg)/(mx-mn) + 4;
      h = (h*60 + 360) % 360;
      if (y > c.height * 0.3) hues.push(h);
      if (h > 235 && h < 320) violet++;
    }
  }
  lum.sort((a,b)=>a-b); fg.sort((a,b)=>a-b);
  const p = (a, q) => Math.round(a[Math.floor(q * (a.length - 1))]);
  let sx = 0, sy = 0; for (const h of hues) { sx += Math.cos(h*Math.PI/180); sy += Math.sin(h*Math.PI/180) }
  const mean = Math.atan2(sy, sx) * 180 / Math.PI;
  const dev = hues.map((h) => ((h - mean + 540) % 360) - 180).sort((a,b)=>a-b);
  const iqr = dev.length ? dev[Math.floor(dev.length*0.75)] - dev[Math.floor(dev.length*0.25)] : 0;
  return { luma: { p5: p(lum,.05), p25: p(lum,.25), p50: p(lum,.5), p75: p(lum,.75), p95: p(lum,.95) },
    fgLuma: { p5: p(fg,.05), p50: p(fg,.5) }, landHueMean: Math.round((mean+360)%360), landHueIQR: Math.round(iqr), violetShare: +(violet/n).toFixed(3) };
}

const pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
window.__lab = {
  ready: true, report,
  run(src) { return eval(src); },
  shot(stop, w, h, t) {
    renderer.setPixelRatio(1); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const d = DEPTH[stop];
    rail.sample(d, pose);
    camera.position.copy(pose.position); camera.lookAt(pose.target); camera.updateMatrixWorld();
    const [near, far] = fogAt(d); fog.near = near; fog.far = far;
    for (const m of [atmo, surf, forest]) if (m && m.update) m.update(t ?? 3.0, 0.033);
    renderer.info.reset();
    const t0 = performance.now();
    renderer.render(scene, camera);
    const ms = performance.now() - t0;
    const dir = pose.target.clone().sub(pose.position).normalize();
    return { stop, depth: d, cam: pose.position.toArray().map((v)=>+v.toFixed(1)), pitchDeg: +(Math.asin(-dir.y)*180/Math.PI).toFixed(2),
      calls: renderer.info.render.calls, tris: renderer.info.render.triangles, renderMs: Math.round(ms),
      animating: surf.isAnimating ? surf.isAnimating() : null, m: measure(renderer.domElement), png: renderer.domElement.toDataURL('image/png') };
  },
};
`

const MIME = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.html': 'text/html' }
function serve(url) {
  const u = new URL(url)
  const p = u.pathname
  if (p === '/' || p === '/index.html') return { body: PAGE, type: 'text/html' }
  if (p === '/lab.js') return { body: LAB_JS, type: 'text/javascript' }
  if (p === '/three.module.js') return { body: fs.readFileSync(path.join(ROOT, 'node_modules/three/build/three.module.js')), type: 'text/javascript' }
  if (p.startsWith('/jsm/')) return { body: fs.readFileSync(path.join(ROOT, 'node_modules/three/examples/jsm', p.slice(5))), type: 'text/javascript' }
  if (p.startsWith('/src/')) {
    const f = path.join(SRC, p.slice(5).replace(/\.js$/, '.ts'))
    if (!fs.existsSync(f)) return { status: 404, body: 'missing', type: 'text/plain' }
    return { body: transpile(f), type: 'text/javascript' }
  }
  if (p === '/world.glb') return { body: fs.readFileSync(path.join(ROOT, 'public/world-v3/world.glb')), type: MIME['.glb'] }
  if (p.startsWith('/draco/')) {
    const f = path.join(ROOT, 'public/world-v3/draco', p.slice(7))
    return { body: fs.readFileSync(f), type: MIME[path.extname(f)] || 'application/octet-stream' }
  }
  return { status: 404, body: 'not found', type: 'text/plain' }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  const logs = []
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|swiftshader|Automatic fallback/i.test(t)) return
    logs.push(`${m.type()}: ${t}`)
  })
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    try {
      const r = serve(req.url())
      req.respond({ status: r.status || 200, contentType: r.type, body: r.body, headers: { 'Access-Control-Allow-Origin': '*' } })
    } catch (e) {
      req.respond({ status: 500, contentType: 'text/plain', body: String(e) })
    }
  })
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  await page.goto('http://lab.test/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__lab?.ready === true || document.title === 'x', { polling: 250, timeout: 300000 }).catch(() => {})
  const ok = await page.evaluate(() => !!window.__lab?.ready)
  if (!ok) {
    console.log(logs.join('\n'))
    throw new Error('lab did not start')
  }
  const report = await page.evaluate(() => window.__lab.report)
  console.log('install report', JSON.stringify(report))
  if (mode === 'eval') {
    const r = await page.evaluate((src) => window.__lab.run(src), argv[1])
    console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1))
  } else {
    for (const stop of STOPS) {
      const r = await page.evaluate((s, w, h) => window.__lab.shot(s, w, h), stop, W, H)
      const file = path.join(OUT, `${TAG}-${stop}-${W}x${H}.png`)
      fs.writeFileSync(file, Buffer.from(r.png.split(',')[1], 'base64'))
      delete r.png
      console.log(JSON.stringify(r), '->', path.relative(ROOT, file))
    }
  }
  const errs = logs.filter((l) => /error|warn|THREE/i.test(l))
  if (errs.length) console.log('console:\n' + errs.slice(0, 30).join('\n'))
} finally {
  await browser.close()
}
