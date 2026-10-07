/**
 * ZOOM VERIFIER. The checkpoint park ("zoom into the place"), measured on
 * /dev/world-v2 and on Astra's /dev/world-codex the same way, at all 8 areas.
 *
 *   node world-tests/v2-zoom-verify.mjs --vp split            # one viewport
 *   node world-tests/v2-zoom-verify.mjs --vp ultra --no-robust
 *   node world-tests/v2-zoom-verify.mjs --vp split --areas a3,a4 --skip-codex
 *   node world-tests/v2-zoom-verify.mjs --vp split --robust-only
 *   node world-tests/v2-zoom-verify.mjs --sheets-only --vp split   # rebuild contact sheets from saved PNGs
 *
 * Viewports: split 1691x1278, ultra 3428x1230, laptop 1440x900.
 * Writes into world-tests/shots/v2-verify/zoom/ (OUT_DIR overrides):
 *   <build>-<vp>-<area>-rail.png            the rail stop before the click
 *   <build>-<vp>-<area>-scene-0300ms.png    held on the scene clock (0/300/700/1600)
 *   <build>-<vp>-<area>-arrived.png         after arrival, with chrome
 *   <build>-<vp>-<area>-nochrome.png        same frame, all DOM hidden
 *   <build>-<vp>-<area>-mask-full.png       landmark alone, magenta
 *   <build>-<vp>-<area>-mask-vis.png        landmark magenta, everything else black (what is not hidden)
 *   sheet-<vp>-<area>.png                   v2 row vs Astra row at 0/300/700/1600 ms + annotated arrival
 *   zoom-<vp>.json                          every number
 *   robust-<vp>.json                        park-while-flying / unpark mid-flight / switch / park-to-park
 *
 * HOW THE MEASURING WORKS. Neither page exposes its scene object, so the
 * script walks React's fiber from the canvas up to the ref that holds it
 * (WorldScene on v2, CodexLandscape on Astra). Read-only except for the mask
 * renders, which swap materials, call the scene's own renderer with the
 * scene's own camera, read the pixels back in the same task, and restore.
 * The landmark is drawn with a magenta shader clipped to its world box:
 *   full  = landmark alone (its whole silhouette on this camera)
 *   vis   = landmark magenta, every other object black: magenta left = visible
 *   only:<cat> = landmark + one category of occluders (v2), to name the blocker
 * Astra merges all its landmark geometry into one mesh per material, so there
 * the clip box (built from src/lib/world-codex/scene.ts) is what isolates it.
 *
 * Chrome cover = pixels of the visible silhouette that change when every DOM
 * element is hidden (panel, its fade, dock, labels). Panel cover = silhouette
 * pixels left of the panel's right edge.
 *
 * The frame gate is the one from v2-render.mjs (scene clock = sum of per-frame
 * dt clamped to 0.05 s), extended to record the camera every frame.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const OUT = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2-verify', 'zoom')

const ALL_VP = { split: { width: 1691, height: 1278 }, ultra: { width: 3428, height: 1230 }, laptop: { width: 1440, height: 900 } }
// [id, rail depth, landmark mesh, Astra index]
const AREAS = [
  ['a1', 0.0708, 'LM_Lighthouse', 0],
  ['a2', 0.1934, 'LM_Windmill', 1],
  ['a3', 0.3, 'LM_Bridge', 2],
  ['a4', 0.4151, 'LM_Viaduct', 3],
  ['a5', 0.5236, 'LM_Watchtower', 4],
  ['a6', 0.6321, 'LM_Cairn', 5],
  ['a7', 0.6863, 'LM_Jetty', 6],
  ['a8', 0.8302, 'LM_Obelisk', 7],
]
// Astra's LANDMARKS[i].depth: its travel() scrolls to depth * (scrollHeight - innerHeight).
const CODEX_DEPTH = [0, 0.14, 0.27, 0.41, 0.55, 0.69, 0.83, 1]
const SHOT_MS = [0, 300, 700, 1600]

const args = process.argv.slice(2)
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null)
const VP_NAME = arg('--vp') || 'split'
const VP = { name: VP_NAME, ...ALL_VP[VP_NAME] }
const ONLY = arg('--areas') ? arg('--areas').split(',') : null
const RUN_AREAS = AREAS.filter((a) => !ONLY || ONLY.includes(a[0]))
const SKIP_CODEX = args.includes('--skip-codex')
const SKIP_V2 = args.includes('--skip-v2')
const ROBUST = args.includes('--robust-only') ? 'only' : args.includes('--no-robust') ? 'no' : VP_NAME === 'split' ? 'yes' : 'no'
const SHEETS_ONLY = args.includes('--sheets-only')
const AT_STOP = args.includes('--at-stop')
let GROUND_OK = false

fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), `[${VP_NAME}]`, ...a)
const fmtMs = (ms) => String(ms).padStart(4, '0') + 'ms'
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10)
const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000)

function sourceHashes() {
  const files = ['src/lib/world-v2/scene.ts', 'src/lib/world-v2/rail.ts', 'src/components/world-v2/WorldV2.tsx', 'src/components/world-v2/world.module.css', 'public/world-v2/world.glb']
  const out = {}
  for (const f of files) {
    const p = path.join(ROOT, f)
    out[f] = fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12) + ' ' + fs.statSync(p).mtime.toISOString() : null
  }
  return out
}

// ── In-page code ─────────────────────────────────────────────────────────────

/** Frame gate (v2-render.mjs) + a per-frame camera record through window.__camProbe. */
function installGate() {
  const real = window.requestAnimationFrame.bind(window)
  const cancelReal = window.cancelAnimationFrame.bind(window)
  const live = new Map()
  let nextId = 1
  const G = {
    held: false, queue: [], frameT: -1, frames: 0, clockOn: false, clock: 0, t0: 0, lastT: 0, holdAt: Infinity, rows: [],
    start(t0) { this.t0 = t0; this.lastT = t0; this.clock = 0; this.clockOn = true; this.rows = []; this.holdAt = Infinity },
    stop() { this.clockOn = false; this.holdAt = Infinity },
    hold() { this.held = true },
    release() {
      this.held = false
      const q = this.queue.splice(0)
      for (const [id, run] of q) if (live.has(id)) live.set(id, real(run))
    },
    mark(label) { this.rows.push({ at: -1, t: performance.now() - this.t0, clock: this.clock, event: label, cam: window.__camProbe ? window.__camProbe() : null, p: window.__worldFrame ? window.__worldFrame.parkProgress : null }) },
  }
  window.__gate = G
  window.requestAnimationFrame = function (cb) {
    const id = nextId++
    const run = (t) => {
      if (!live.has(id)) return
      if (G.held) { G.queue.push([id, run]); return }
      live.delete(id)
      if (t !== G.frameT) {
        G.frameT = t
        G.frames++
        if (G.clockOn) { G.clock += Math.min(0.05, Math.max(0, (t - G.lastT) / 1000)); G.lastT = t }
      }
      cb(t)
      if (G.clockOn) {
        const f = window.__worldFrame
        const p = f ? f.parkProgress : null
        const pid = f ? f.parkedId : null
        const cam = window.__camProbe ? window.__camProbe() : null
        const last = G.rows[G.rows.length - 1]
        if (last && last.at === t) { last.p = p; last.cam = cam; last.pid = pid }
        else G.rows.push({ at: t, t: t - G.t0, clock: G.clock, p, pid, cam })
        if (G.clock >= G.holdAt - 1e-9) { G.held = true; G.holdAt = Infinity }
      }
    }
    live.set(id, real(run))
    return id
  }
  window.cancelAnimationFrame = function (id) {
    const r = live.get(id)
    if (r !== undefined) { cancelReal(r); live.delete(id) }
  }
}

/**
 * Installs window.__zv: the scene instance (via React fiber) and the mask renderer.
 * kind: 'v2' | 'codex'.
 */
function installZV(kind) {
  const find = (pred) => {
    for (let e = document.querySelector('canvas'); e; e = e.parentElement) {
      const k = Object.keys(e).find((x) => x.startsWith('__reactFiber$'))
      if (!k) continue
      for (let f = e[k]; f; f = f.return) {
        let h = f.memoizedState
        let guard = 0
        while (h && typeof h === 'object' && 'next' in h && guard++ < 300) {
          const v = h.memoizedState
          if (v && typeof v === 'object' && 'current' in v && v.current && pred(v.current)) return v.current
          h = h.next
        }
      }
    }
    return null
  }
  const inst = kind === 'v2' ? find((x) => typeof x.debugScene === 'function') : find((x) => typeof x.setParked === 'function')
  if (!inst) return { ok: false }
  const renderer = inst.renderer
  const scene = inst.scene
  const camera = inst.camera
  const SM = inst.sky.material.constructor
  const V3 = camera.position.constructor
  const vtx = `#include <common>
varying vec3 vW;
void main() {
#include <begin_vertex>
#include <project_vertex>
  vec4 wp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
#endif
  vW = (modelMatrix * wp).xyz;
}`
  // useGround: landmark fragments at or below the ground/water surface (the
  // scene's own surface(x, z), sampled into a float texture) are discarded, so
  // "hidden" then counts only what stands above the ground and is blocked.
  const frg = `uniform vec3 bmin; uniform vec3 bmax; uniform float discardOutside; uniform vec3 col; varying vec3 vW;
uniform float useGround; uniform sampler2D gTex; uniform vec2 gMin; uniform vec2 gSize; uniform float gMargin;
void main() {
  bool inside = all(greaterThanEqual(vW, bmin)) && all(lessThanEqual(vW, bmax));
  if (!inside) { if (discardOutside > 0.5) discard; gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  if (useGround > 0.5) {
    float g = texture2D(gTex, clamp((vW.xz - gMin) / gSize, 0.0, 1.0)).r;
    if (vW.y < g + gMargin) discard;
  }
  gl_FragColor = vec4(col, 1.0);
}`
  let TexCtor = null
  scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []
    for (const m of ms) for (const k of ['map', 'envMap', 'normalMap']) if (!TexCtor && m[k] && m[k].isTexture) TexCtor = m[k].constructor
  })
  if (!TexCtor && inst.seaEnv && inst.seaEnv.texture) TexCtor = inst.seaEnv.texture.constructor
  const groundCache = new Map()
  /** Float texture of surface(x, z) over the landmark's box, 1 unit per texel (max 512). */
  const groundFor = (t) => {
    const key = t.min.join(',')
    if (groundCache.has(key)) return groundCache.get(key)
    if (!TexCtor || typeof inst.surface !== 'function') return null
    const x0 = t.min[0] - 4, z0 = t.min[2] - 4, sx = t.max[0] - t.min[0] + 8, sz = t.max[2] - t.min[2] + 8
    const W = Math.min(512, Math.ceil(sx)), H = Math.min(512, Math.ceil(sz))
    const data = new Float32Array(W * H)
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const h = inst.surface(x0 + ((i + 0.5) / W) * sx, z0 + ((j + 0.5) / H) * sz)
      data[j * W + i] = Number.isFinite(h) ? h : -1e5
    }
    const tex = new TexCtor()
    tex.image = { data, width: W, height: H }
    tex.isDataTexture = true
    tex.format = 1028 // RedFormat
    tex.type = 1015 // FloatType
    tex.minFilter = 1003 // NearestFilter
    tex.magFilter = 1003
    tex.generateMipmaps = false
    tex.flipY = false
    tex.unpackAlignment = 1
    tex.needsUpdate = true
    const g = { tex, min: [x0, z0], size: [sx, sz], W, H, data }
    groundCache.set(key, g)
    return g
  }
  const mat = (col, bmin, bmax, disc, ground, margin) => {
    const m = new SM({
      vertexShader: vtx, fragmentShader: frg,
      uniforms: {
        bmin: { value: new V3(...bmin) }, bmax: { value: new V3(...bmax) }, discardOutside: { value: disc ? 1 : 0 }, col: { value: new V3(...col) },
        useGround: { value: ground ? 1 : 0 }, gTex: { value: ground ? ground.tex : null },
        gMin: { value: { x: ground ? ground.min[0] : 0, y: ground ? ground.min[1] : 0, isVector2: true } },
        gSize: { value: { x: ground ? ground.size[0] : 1, y: ground ? ground.size[1] : 1, isVector2: true } },
        gMargin: { value: margin ?? 1 },
      },
    })
    m.side = 2
    m.fog = false
    m.toneMapped = false
    return m
  }
  let ColorCtor = null
  scene.traverse((o) => { if (!ColorCtor && o.material && o.material.color && o.material.color.isColor) ColorCtor = o.material.color.constructor })
  const BIG = [-1e6, -1e6, -1e6]
  const BIGP = [1e6, 1e6, 1e6]
  const black = mat([0, 0, 0], BIG, BIGP, false)

  const cam = () => {
    const d = camera.getWorldDirection(new V3())
    return { x: camera.position.x, y: camera.position.y, z: camera.position.z, dx: d.x, dy: d.y, dz: d.z }
  }
  window.__camProbe = kind === 'v2' ? () => window.__worldCamera() : cam

  // Astra's landmark boxes in group-local units, read off buildLandmarks() in world-codex/scene.ts.
  // [xmin, ymin, zmin, xmax, ymax, zmax]; group y = anchor.y - lift; group x = anchor.x + dx.
  const CODEX_BOX = [
    { b: [-17.2, -0.2, -17.2, 17.2, 54.2, 17.2], lift: 56, dx: 0 },  // lighthouse (height 52 + 4)
    { b: [-24, -0.5, -12, 24, 51, 12], lift: 40, dx: 0 },           // windmill: rotor radius ~23.4 about y 27
    { b: [-67.6, -8.2, -7.3, 67.6, 26.3, 7.3], lift: 27, dx: 0 },    // bridge: deck 24, anchor deck + 3
    { b: [-112.6, -8.2, -7.3, 112.6, 56.3, 7.3], lift: 57, dx: 0 },  // viaduct: deck 54
    { b: [-11.6, -0.5, -11, 11.2, 47.6, 11.6], lift: 48, dx: 0 },    // watchtower (44 + 4)
    { b: [-10.6, -2, -10.6, 12.7, 35.6, 10.6], lift: 29, dx: 0 },    // cairn (25 + 4)
    { b: [-38.6, -7.6, -4.6, 0.8, 0.7, 4.6], lift: 4, dx: 26 },      // jetty: anchor = (a.x - 26, y + 4)
    { b: [-13.6, -0.2, -13.6, 13.6, 52.7, 13.6], lift: 56, dx: 0 },  // obelisk (52 + 4)
  ]
  const LM_COLORS = new Set(['d1bb9f', '8f665c', '484652', '776453', 'decba8', 'ffdb96'])

  /** World box [min, max] of the landmark, and the meshes that draw it. */
  const target = (key) => {
    if (kind === 'v2') {
      const lm = inst.landmarks.get(key)
      if (!lm) return null
      const meshes = new Set()
      scene.traverse((o) => {
        if (o.name && o.name.startsWith(key)) o.traverse((d) => { if (d.isMesh) meshes.add(d) })
      })
      const e = 3
      return {
        min: [lm.box.min.x - e, lm.box.min.y - e, lm.box.min.z - e], max: [lm.box.max.x + e, lm.box.max.y + e, lm.box.max.z + e],
        center: [lm.center.x, lm.center.y, lm.center.z], meshes, rawMin: lm.box.min.toArray(), rawMax: lm.box.max.toArray(),
      }
    }
    const i = key
    const a = inst.anchors[i]
    const cb = CODEX_BOX[i]
    const gx = a.x + cb.dx
    const gy = a.y - cb.lift
    const gz = a.z
    const min = [gx + cb.b[0], gy + cb.b[1], gz + cb.b[2]]
    const max = [gx + cb.b[3], gy + cb.b[4], gz + cb.b[5]]
    const meshes = new Set()
    scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return
      const c = o.material && o.material.color
      if (c && LM_COLORS.has(c.getHexString())) meshes.add(o)
    })
    return { min, max, center: min.map((v, k) => (v + max[k]) / 2), meshes, rawMin: min, rawMax: max }
  }

  const CATS = {
    terrain: (o) => o.name === 'Terrain',
    trees: (o) => /^Trees:/.test(o.name),
    rocks: (o) => /^Rocks/.test(o.name),
    houses: (o) => /^House/.test(o.name),
    otherLM: (o) => /^LM_/.test(o.name),
    rest: () => true,
  }
  const catOf = (o) => {
    for (let p = o; p; p = p.parent) {
      for (const [k, f] of Object.entries(CATS)) if (k !== 'rest' && p.name && f(p)) return k
    }
    return 'rest'
  }

  /**
   * Render one mask. mode 'full' | 'vis' | 'only:<cat>'. Returns stats; keeps the
   * top-down mask in window.__zvMask. The display shows the mask until restore().
   */
  const renderMask = (key, mode, panelRight, opts = {}) => {
    const t = target(key)
    if (!t) return null
    const ground = opts.ground ? groundFor(t) : null
    if (opts.ground && !ground) return { error: 'no ground texture (TexCtor ' + !!TexCtor + ', surface ' + typeof inst.surface + ')' }
    const lmMat = mat([1, 0, 1], t.min, t.max, mode === 'full', ground, opts.margin)
    const zoom0 = camera.zoom
    if (opts.zoom) { camera.zoom = opts.zoom; camera.updateProjectionMatrix() }
    const saved = []
    scene.traverse((o) => {
      if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return
      saved.push([o, o.material, o.visible])
      if (t.meshes.has(o)) { o.material = lmMat; return }
      if (o === inst.sky) { o.visible = false; return }
      if (mode === 'full') { o.visible = false; return }
      if (mode.startsWith('only:')) {
        const c = mode.slice(5)
        if (kind === 'v2' && catOf(o) !== c) { o.visible = false; return }
      }
      if (o.isMesh) o.material = black
      else o.visible = false
    })
    const bg = scene.background
    const fog = scene.fog
    scene.background = null
    scene.fog = null
    const autoClear = renderer.autoClear
    renderer.autoClear = true
    const cc = renderer.getClearColor(new ColorCtor())
    const ca = renderer.getClearAlpha()
    renderer.setClearColor(0x000000, 1)
    renderer.render(scene, camera)
    const gl = renderer.getContext()
    const w = gl.drawingBufferWidth
    const h = gl.drawingBufferHeight
    const buf = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    // restore state (the display keeps the mask image until the next render)
    renderer.setClearColor(cc, ca)
    renderer.autoClear = autoClear
    scene.background = bg
    scene.fog = fog
    for (const [o, m, v] of saved) { o.material = m; o.visible = v }
    lmMat.dispose()
    if (opts.zoom) { camera.zoom = zoom0; camera.updateProjectionMatrix() }

    const css = renderer.domElement.getBoundingClientRect()
    const sx = css.width / w
    const sy = css.height / h
    const mask = new Uint8Array(w * h)
    let n = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, left = 0, fade = 0
    // With opts.zoom = z the real frame is the centred (z * w) x (z * h) box.
    let inFrame = 0, offL = 0, offR = 0, offT = 0, offB = 0
    const fx0 = opts.zoom ? (w * (1 - opts.zoom)) / 2 : 0, fx1 = w - fx0
    const fy0 = opts.zoom ? (h * (1 - opts.zoom)) / 2 : 0, fy1 = h - fy0
    const pr = panelRight == null ? -1 : panelRight / sx
    for (let y = 0; y < h; y++) {
      const row = (h - 1 - y) * w
      for (let x = 0; x < w; x++) {
        const i = (row + x) * 4
        if (buf[i] > 150 && buf[i + 1] < 100 && buf[i + 2] > 150) {
          mask[y * w + x] = 1
          n++
          if (x >= fx0 && x < fx1 && y >= fy0 && y < fy1) inFrame++
          else if (x < fx0) offL++
          else if (x >= fx1) offR++
          else if (y < fy0) offT++
          else offB++
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
          if (pr >= 0 && x < pr) left++
          else if (pr >= 0 && x < pr + 200 / sx) fade++
        }
      }
    }
    window.__zvMask = { mask, w, h, sx, sy }
    return {
      mode, pixels: n, bufW: w, bufH: h, ground: !!ground, zoom: opts.zoom || null,
      offFrame: opts.zoom ? { inFrame, left: offL, right: offR, top: offT, bottom: offB, offPct: n ? (100 * (n - inFrame)) / n : 0 } : null,
      bbox: n ? { minX: minX * sx + css.left, maxX: (maxX + 1) * sx + css.left, minY: minY * sy + css.top, maxY: (maxY + 1) * sy + css.top } : null,
      heightPct: n ? ((maxY - minY + 1) / h) * 100 : 0,
      widthPct: n ? ((maxX - minX + 1) / w) * 100 : 0,
      underPanel: left, inFade: fade,
    }
  }

  /** Repaint the normal frame after masks. */
  const restore = () => renderer.render(scene, camera)

  /** Projected world box (8 corners) on the live camera, CSS px. */
  const projectBox = (key) => {
    const t = target(key)
    const css = renderer.domElement.getBoundingClientRect()
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    const p = new V3()
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? t.rawMax[0] : t.rawMin[0], i & 2 ? t.rawMax[1] : t.rawMin[1], i & 4 ? t.rawMax[2] : t.rawMin[2]).project(camera)
      const x = (p.x * 0.5 + 0.5) * css.width
      const y = (-p.y * 0.5 + 0.5) * css.height
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
    return { minX, maxX, minY, maxY, heightPct: ((maxY - minY) / css.height) * 100 }
  }

  const info = (key) => {
    const t = target(key)
    const c = camera.position
    const d = Math.hypot(c.x - t.center[0], c.y - t.center[1], c.z - t.center[2])
    const dir = camera.getWorldDirection(new V3())
    const pitch = (Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180) / Math.PI
    return { dist: d, center: t.center, cam: cam(), pitchDeg: pitch, meshCount: t.meshes.size, box: [t.rawMin, t.rawMax] }
  }

  /** Pixels of the last mask inside CSS rects (the NEXT block, the dock). */
  const maskInRects = (rects) => {
    const M = window.__zvMask
    if (!M) return null
    let n = 0, inside = 0
    for (let y = 0; y < M.h; y++) for (let x = 0; x < M.w; x++) {
      if (!M.mask[y * M.w + x]) continue
      n++
      const X = x * M.sx, Y = y * M.sy
      if (rects.some((r) => X >= r.left && X < r.right && Y >= r.top && Y < r.bottom)) inside++
    }
    return { n, inside, pct: n ? (100 * inside) / n : 0 }
  }

  window.__zv = { kind, inst, renderMask, restore, projectBox, info, maskInRects, hasGround: !!TexCtor && typeof inst.surface === 'function' }
  return { ok: true, w: renderer.domElement.width, h: renderer.domElement.height, ground: !!TexCtor && typeof inst.surface === 'function' }
}

/** The visible-silhouette mask from the world page, bit-packed as base64. */
async function pullMask(page) {
  return page.evaluate(() => {
    const M = window.__zvMask
    if (!M) return null
    const bytes = new Uint8Array(Math.ceil(M.mask.length / 8))
    for (let i = 0; i < M.mask.length; i++) if (M.mask[i]) bytes[i >> 3] |= 1 << (i & 7)
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return { b64: btoa(s), w: M.w, h: M.h, sx: M.sx, sy: M.sy }
  })
}

let HELPER = null
/** Decode two screenshots in a blank page and count mask pixels whose colour changes between them. */
async function chromeCover(worldPage, withChrome, noChrome) {
  const M = await pullMask(worldPage)
  if (!M) return null
  const res = await HELPER.evaluate(async (a, b, M) => {
    const load = (s) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + s })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data }
    const A = px(ia)
    const B = px(ib)
    const bin = atob(M.b64)
    const bit = (i) => (bin.charCodeAt(i >> 3) >> (i & 7)) & 1
    let n = 0, covered = 0
    const W = ia.width
    for (let y = 0; y < M.h; y++) for (let x = 0; x < M.w; x++) {
      if (!bit(y * M.w + x)) continue
      n++
      const X = Math.min(W - 1, Math.round(x * M.sx)), Y = Math.round(y * M.sy)
      const i = (Y * W + X) * 4
      const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])
      if (d > 30) covered++
    }
    return { maskPixels: n, coveredPixels: covered, coveredPct: n ? (100 * covered) / n : 0 }
  }, Buffer.from(withChrome).toString('base64'), Buffer.from(noChrome).toString('base64'), M)
  return res
}

/** Strict magenta pixel count of a screenshot (a mask frame with the DOM drawn over it). */
async function magentaInPng(buf) {
  return HELPER.evaluate(async (b64) => {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b64 })
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] < 100 && d[i + 2] > 150) n++
    return n
  }, Buffer.from(buf).toString('base64'))
}

/** CSS rects of the rail chrome that sits over the scene: the NEXT block and the dock. */
async function railChromeRects(page) {
  return page.evaluate(() => {
    const out = {}
    for (const [k, sel] of [['next', 'main section[aria-label="Next lesson"]'], ['dock', 'main nav[aria-label="Areas"]']]) {
      const el = document.querySelector(sel)
      if (!el) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue
      const b = el.getBoundingClientRect()
      out[k] = { left: b.left, top: b.top, right: b.right, bottom: b.bottom }
    }
    return out
  })
}

/** DOM elements whose boxes intersect a rect (for naming what covers the landmark). */
async function domOver(page, rect) {
  return page.evaluate((r) => {
    const out = []
    for (const el of document.querySelectorAll('body *')) {
      if (el.tagName === 'CANVAS' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue
      const b = el.getBoundingClientRect()
      if (b.width < 2 || b.height < 2) continue
      if (b.width > innerWidth * 0.9 && b.height > innerHeight * 0.9) continue
      if (b.left < r.maxX && b.right > r.minX && b.top < r.maxY && b.bottom > r.minY) {
        const txt = (el.innerText || '').trim().split('\n')[0].slice(0, 30)
        if (!el.children.length || txt) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0].slice(0, 30)} "${txt}" [${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}]`)
      }
    }
    return out.slice(0, 12)
  }, rect)
}

// ── Analysis ─────────────────────────────────────────────────────────────────

function invSmoother(p) {
  let lo = 0, hi = 1
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; const v = m * m * m * (m * (m * 6 - 15) + 10); if (v < p) lo = m; else hi = m }
  return (lo + hi) / 2
}
function camDelta(a, b) {
  const dp = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  const la = Math.hypot(a.dx, a.dy, a.dz), lb = Math.hypot(b.dx, b.dy, b.dz)
  const dot = Math.max(-1, Math.min(1, (a.dx * b.dx + a.dy * b.dy + a.dz * b.dz) / (la * lb)))
  return { units: dp, deg: (Math.acos(dot) * 180) / Math.PI }
}

/**
 * Motion smoothness on the scene clock. A snap is a single frame whose
 * displacement is > 2.5x both neighbours and > 4 units (or turn > 2.5x and
 * > 1 deg), or a velocity change in one frame > 3x the largest change in
 * the 3 frames either side and > 150 units/s.
 */
function motion(rows) {
  const fr = rows.filter((r) => r.cam && r.at !== -1)
  const out = { frames: fr.length, snaps: [], maxStep: 0, maxTurnDeg: 0, maxDv: 0, pJumps: [], maxDp: 0, pReversals: 0, steps: [] }
  const d = [], a = [], v = []
  for (let i = 1; i < fr.length; i++) {
    const A = fr[i - 1].cam, B = fr[i].cam
    const dt = fr[i].clock - fr[i - 1].clock
    const dd = camDelta(A, B)
    d.push(dd.units); a.push(dd.deg)
    v.push(dt > 0 ? { x: (B.x - A.x) / dt, y: (B.y - A.y) / dt, z: (B.z - A.z) / dt } : null)
    out.steps.push({ clock: r3(fr[i].clock), step: r3(dd.units), turn: r3(dd.deg), p: fr[i].p == null ? null : r3(fr[i].p), pid: fr[i].pid ?? null })
  }
  out.maxStep = Math.max(0, ...d)
  out.maxTurnDeg = Math.max(0, ...a)
  const dv = v.map((x, i) => (i && x && v[i - 1] ? Math.hypot(x.x - v[i - 1].x, x.y - v[i - 1].y, x.z - v[i - 1].z) : 0))
  out.maxDv = Math.max(0, ...dv)
  for (let i = 0; i < d.length; i++) {
    const nb = Math.max(i ? d[i - 1] : 0, i + 1 < d.length ? d[i + 1] : 0)
    const nbA = Math.max(i ? a[i - 1] : 0, i + 1 < a.length ? a[i + 1] : 0)
    if ((d[i] > 4 && d[i] > 2.5 * nb) || (a[i] > 1 && a[i] > 2.5 * nbA)) out.snaps.push({ kind: 'spike', clock: r3(fr[i + 1].clock), step: r1(d[i]), neighbours: r1(nb), turn: r1(a[i]), turnNeighbours: r1(nbA) })
    const win = dv.slice(Math.max(0, i - 3), i).concat(dv.slice(i + 1, i + 4))
    const wm = Math.max(0, ...win)
    if (dv[i] > 150 && dv[i] > 3 * wm) out.snaps.push({ kind: 'velocity-jump', clock: r3(fr[i + 1].clock), dv: r1(dv[i]), window: r1(wm) })
  }
  let lastSign = 0
  for (let i = 1; i < fr.length; i++) {
    if (fr[i].p == null || fr[i - 1].p == null) continue
    const dp = fr[i].p - fr[i - 1].p
    out.maxDp = Math.max(out.maxDp, Math.abs(dp))
    if (Math.abs(dp) > 0.12) out.pJumps.push({ clock: r3(fr[i].clock), from: r3(fr[i - 1].p), to: r3(fr[i].p) })
    const s = Math.sign(dp)
    if (s && lastSign && s !== lastSign) out.pReversals++
    if (s) lastSign = s
  }
  return out
}

// ── Sheets ───────────────────────────────────────────────────────────────────

async function sheet(browser, items, cols, scale, outName) {
  const present = items.filter((it) => it && fs.existsSync(path.join(OUT, it.file)))
  if (!present.length) return null
  const page = await browser.newPage()
  try {
    const srcs = present.map((it) => 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, it.file)).toString('base64'))
    await page.setContent('<html><body style="margin:0;background:#111"></body></html>')
    const dataUrl = await page.evaluate(async (srcs, meta, cols, scale) => {
      const imgs = await Promise.all(srcs.map((s) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = s })))
      const cw = Math.round(Math.max(...imgs.map((i) => i.width)) * scale)
      const ch = Math.round(Math.max(...imgs.map((i) => i.height)) * scale)
      const cap = 28
      const rows = Math.ceil(imgs.length / cols)
      const c = document.createElement('canvas')
      c.width = cw * cols
      c.height = (ch + cap) * rows
      const g = c.getContext('2d')
      g.fillStyle = '#111'
      g.fillRect(0, 0, c.width, c.height)
      imgs.forEach((img, k) => {
        const x = (k % cols) * cw
        const y = Math.floor(k / cols) * (ch + cap)
        g.fillStyle = '#eee'
        g.font = '16px monospace'
        g.fillText(meta[k].caption, x + 8, y + 19)
        g.drawImage(img, x, y + cap, img.width * scale, img.height * scale)
        const o = meta[k].overlay
        if (o) {
          g.lineWidth = 2
          if (o.rect) { g.strokeStyle = '#ff00ff'; g.strokeRect(x + o.rect[0] * scale, y + cap + o.rect[1] * scale, (o.rect[2] - o.rect[0]) * scale, (o.rect[3] - o.rect[1]) * scale) }
          if (o.vline != null) { g.strokeStyle = '#00ffff'; g.beginPath(); g.moveTo(x + o.vline * scale, y + cap); g.lineTo(x + o.vline * scale, y + cap + ch); g.stroke() }
        }
      })
      return c.toDataURL('image/png')
    }, srcs, present.map((it) => ({ caption: it.caption, overlay: it.overlay || null })), cols, scale)
    const out = path.join(OUT, outName)
    fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'))
    return out
  } finally {
    await page.close()
  }
}

// ── Page helpers ─────────────────────────────────────────────────────────────

async function openPage(browser, route) {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  const errors = []
  const api = []
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback/i.test(t)) return
    if (m.type() === 'error') errors.push(t)
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  page.on('request', (r) => { try { if (/\/api\//.test(new URL(r.url()).pathname)) api.push(r.url()) } catch {} })
  await page.evaluateOnNewDocument(installGate)
  await page.setViewport({ width: VP.width, height: VP.height, deviceScaleFactor: 1 })
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.bringToFront()
  return { page, errors, api }
}

const NOCHROME_CSS = 'body *{visibility:hidden !important} canvas{visibility:visible !important}'
async function screenshotNoChrome(page, file) {
  const handle = await page.addStyleTag({ content: NOCHROME_CSS })
  await sleep(150)
  const buf = await page.screenshot({ path: file })
  await handle.evaluate((el) => el.remove())
  await sleep(100)
  return buf
}

async function holdAtScene(page, s, doneFn) {
  await page.evaluate((s) => { window.__gate.holdAt = s; window.__gate.release() }, s)
  await page.waitForFunction(doneFn || (() => window.__gate.held), { timeout: 900000, polling: 50 })
  await sleep(250)
  await page.evaluate(() => window.__gate.hold())
}

/** Masks + chrome cover on the frame currently displayed. Gate must be held. */
async function measureArrived(page, key, prefix, panelRight, withChromeBuf) {
  const full = await page.evaluate((k, pr) => window.__zv.renderMask(k, 'full', pr), key, panelRight)
  await sleep(120)
  await page.screenshot({ path: path.join(OUT, `${prefix}-mask-full.png`) })
  const vis = await page.evaluate((k, pr) => window.__zv.renderMask(k, 'vis', pr), key, panelRight)
  await sleep(120)
  await page.screenshot({ path: path.join(OUT, `${prefix}-mask-vis.png`) })
  // __zvMask now holds the VISIBLE silhouette: chrome cover is measured on what could be seen.
  await page.evaluate(() => window.__zv.restore())
  await sleep(150)
  const noChrome = await screenshotNoChrome(page, path.join(OUT, `${prefix}-nochrome.png`))
  const cover = await chromeCover(page, withChromeBuf, noChrome)
  return { full, vis, cover }
}

// ── v2 ───────────────────────────────────────────────────────────────────────

async function v2Settle(page, depth) {
  await page.evaluate((d) => window.scrollTo(0, Math.round(window.__worldScrollFor(d))), depth)
  await page.waitForFunction(() => {
    const f = window.__worldFrame
    if (!f || !window.__worldScrollFor) return false
    const max = window.__worldScrollFor(0.88)
    const target = max > 0 ? Math.min(1, window.scrollY / max) * 0.88 : 0
    return f.parkProgress === 0 && Math.abs(f.depth - target) < 1e-9 && !document.querySelector('main[data-open]')
  }, { timeout: 900000, polling: 200 })
  await sleep(300)
}
async function v2WaitClosed(page) {
  await page.waitForFunction(() => !document.querySelector('main[data-open]') && window.__worldFrame && window.__worldFrame.parkProgress === 0 && document.body.style.overflow !== 'hidden', { timeout: 900000, polling: 150 })
  await sleep(300)
}
async function v2Panel(page) {
  return page.evaluate(() => {
    const el = document.querySelector('section[aria-labelledby="v2-panel-title"]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right, opacity: getComputedStyle(el).opacity }
  })
}

async function v2Boot(browser) {
  const P = await openPage(browser, '/dev/world-v2')
  const t = Date.now()
  await P.page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string' || window.__worldView === 'list', { timeout: 300000, polling: 250 })
  const boot = await P.page.evaluate(() => ({ ready: window.__worldReady, error: window.__worldError ?? null, view: window.__worldView }))
  if (!boot.ready) throw new Error('v2 not ready: ' + JSON.stringify(boot))
  const z = await P.page.evaluate(installZV, 'v2')
  if (!z.ok) throw new Error('v2 scene instance not found through React fiber')
  GROUND_OK = z.ground
  log(`v2 ready in ${Date.now() - t} ms, canvas ${z.w}x${z.h}, ground masks ${z.ground}`)
  return P
}

async function runV2Area(page, [id, fixtureDepth, mesh], R) {
  const pre = `v2-${VP.name}-${id}`
  const depthFor = await page.evaluate((id) => window.__zv.inst.depthFor(id), id)
  // --at-stop: start from the stop the dock and NEXT travel to (the one the park solver measures from).
  const depth = AT_STOP ? depthFor : fixtureDepth
  await v2Settle(page, depth)
  const before = await page.evaluate((k) => window.__zv.info(k), mesh)
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await page.evaluate(() => window.__gate.hold())
  const railFull = await page.evaluate((k) => window.__zv.renderMask(k, 'full', null), mesh)
  const railVis = await page.evaluate((k) => window.__zv.renderMask(k, 'vis', null), mesh)
  // Rail-stop chrome: the visible silhouette with the DOM drawn over it.
  await sleep(120)
  const railMaskBuf = await page.screenshot({ path: path.join(OUT, `${pre}-rail-mask-vis.png`) })
  const railRects = await railChromeRects(page)
  const railInNextDock = await page.evaluate((r) => window.__zv.maskInRects(Object.values(r)), railRects)
  const railInNext = railRects.next ? await page.evaluate((r) => window.__zv.maskInRects([r]), railRects.next) : null
  const railInDock = railRects.dock ? await page.evaluate((r) => window.__zv.maskInRects([r]), railRects.dock) : null
  const railShown = await magentaInPng(railMaskBuf)
  const railOver = railVis.bbox ? await domOver(page, railVis.bbox) : []
  await page.evaluate(() => window.__zv.restore())
  await sleep(150)
  await page.screenshot({ path: path.join(OUT, `${pre}-rail.png`) })
  const railProj = await page.evaluate((k) => window.__zv.projectBox(k), mesh)

  // Park on the scene clock with held frames.
  await page.evaluate((pid) => {
    window.__gate.start(performance.now())
    window.__gate.mark('park')
    window.__worldPark(pid)
  }, id)
  await sleep(400)
  const shots = []
  for (const ms of SHOT_MS) {
    if (ms > 0) await holdAtScene(page, ms / 1000, () => window.__gate.held || (window.__worldFrame && window.__worldFrame.parkProgress === 1))
    const st = await page.evaluate(() => ({ p: window.__worldFrame.parkProgress, sceneMs: Math.round(window.__gate.clock * 1000) }))
    const file = `${pre}-scene-${fmtMs(ms)}.png`
    await page.screenshot({ path: path.join(OUT, file) })
    shots.push({ targetMs: ms, ...st, file })
  }
  await page.evaluate(() => window.__gate.release())
  await page.waitForFunction(() => window.__worldFrame.parkProgress === 1, { timeout: 900000, polling: 100 })
  await sleep(400)
  await page.evaluate(() => window.__gate.hold())
  const rowsIn = await page.evaluate(() => window.__gate.rows.slice())
  const arriveRow = rowsIn.find((r) => r.p === 1 && r.at !== -1)
  const after = await page.evaluate((k) => window.__zv.info(k), mesh)
  const panel = await v2Panel(page)
  const panelRight = panel ? panel.right : null
  const arrivedBuf = await page.screenshot({ path: path.join(OUT, `${pre}-arrived.png`) })
  const proj = await page.evaluate((k) => window.__zv.projectBox(k), mesh)
  const m = await measureArrived(page, mesh, pre, panelRight, arrivedBuf)

  // Occluder attribution when something other than chrome hides it.
  const hiddenPct = m.full.pixels ? 100 * (1 - m.vis.pixels / m.full.pixels) : null
  const blockers = {}
  if (hiddenPct != null && hiddenPct > 1) {
    for (const c of ['terrain', 'trees', 'rocks', 'houses', 'otherLM', 'rest']) {
      const s = await page.evaluate((k, mode) => window.__zv.renderMask(k, mode, null), mesh, 'only:' + c)
      blockers[c] = r1(100 * (1 - s.pixels / m.full.pixels))
    }
    await page.evaluate(() => window.__zv.restore())
    await sleep(100)
  }
  const overChrome = m.cover && m.cover.coveredPct > 1 && m.vis.bbox ? await domOver(page, m.vis.bbox) : []
  const Ts = rowsIn.filter((r) => r.p > 0.02 && r.p < 0.98 && r.at !== -1).map((r) => r.clock / invSmoother(r.p)).sort((a, b) => a - b)

  // Above-ground occlusion: the same masks with the landmark's buried and
  // underwater fragments discarded (1 unit margin over the scene's surface).
  const ag = {}
  if (GROUND_OK) {
    const fullG = await page.evaluate((k) => window.__zv.renderMask(k, 'full', null, { ground: true, margin: 1 }), mesh)
    await sleep(100)
    await page.screenshot({ path: path.join(OUT, `${pre}-mask-full-ag.png`) })
    const visG = await page.evaluate((k) => window.__zv.renderMask(k, 'vis', null, { ground: true, margin: 1 }), mesh)
    await sleep(100)
    await page.screenshot({ path: path.join(OUT, `${pre}-mask-vis-ag.png`) })
    ag.fullPixels = fullG.pixels
    ag.visPixels = visG.pixels
    ag.buriedPct = m.full.pixels ? r1(100 * (1 - fullG.pixels / m.full.pixels)) : null
    ag.hiddenPct = fullG.pixels ? r1(100 * (1 - visG.pixels / fullG.pixels)) : null
    ag.visHeightPct = r1(visG.heightPct)
    ag.visBBox = visG.bbox && { minX: Math.round(visG.bbox.minX), maxX: Math.round(visG.bbox.maxX), minY: Math.round(visG.bbox.minY), maxY: Math.round(visG.bbox.maxY) }
    ag.blockers = {}
    if (ag.hiddenPct > 1) {
      for (const c of ['terrain', 'trees', 'rocks', 'houses', 'otherLM', 'rest']) {
        const s = await page.evaluate((k, mode) => window.__zv.renderMask(k, mode, null, { ground: true, margin: 1 }), mesh, 'only:' + c)
        ag.blockers[c] = r1(100 * (1 - s.pixels / fullG.pixels))
      }
    }
    // Off-frame share: the above-ground silhouette rendered at zoom 0.5, where the real frame is the centred half.
    const wide = await page.evaluate((k) => window.__zv.renderMask(k, 'full', null, { ground: true, margin: 1, zoom: 0.5 }), mesh)
    await sleep(100)
    await page.screenshot({ path: path.join(OUT, `${pre}-mask-wide-ag.png`) })
    ag.offFrame = wide.offFrame && { ...wide.offFrame, offPct: r1(wide.offFrame.offPct) }
    await page.evaluate(() => window.__zv.restore())
    await sleep(100)
  }

  // Settle on the scene clock (distance to the landmark centre within 10% / 1% of the move), like Astra's.
  const cen = after.center
  const dOf = (r) => Math.hypot(r.cam.x - cen[0], r.cam.y - cen[1], r.cam.z - cen[2])
  const frIn = rowsIn.filter((r) => r.cam && r.at !== -1)
  const s90 = frIn.find((r) => Math.abs(dOf(r) - after.dist) <= 0.1 * Math.abs(before.dist - after.dist))
  const s99 = frIn.find((r) => Math.abs(dOf(r) - after.dist) <= 0.01 * Math.abs(before.dist - after.dist))
  const distAt = (ms) => { const r = frIn.find((x) => x.clock >= ms / 1000 - 1e-6); return r ? r1(100 * (before.dist - dOf(r)) / (before.dist - after.dist)) : null }

  // Unpark.
  await page.evaluate(() => {
    window.__gate.release()
    window.__gate.start(performance.now())
    window.__gate.mark('unpark')
    window.__worldPark(null)
  })
  await v2WaitClosed(page)
  const rowsOut = await page.evaluate(() => window.__gate.rows.slice())
  await page.evaluate(() => window.__gate.stop())
  const back = await page.evaluate((k) => window.__zv.info(k), mesh)
  const scrollAfter = await page.evaluate(() => window.scrollY)
  await page.screenshot({ path: path.join(OUT, `${pre}-returned.png`) })

  const res = {
    id, mesh, depth, fixtureDepth, atStop: AT_STOP,
    distBefore: r1(before.dist), distAfter: r1(after.dist), distCutPct: r1(100 * (1 - after.dist / before.dist)),
    rail: {
      visPixels: railVis.pixels, shownWithChrome: railShown,
      chromeHiddenPct: railVis.pixels ? r1(100 * (1 - railShown / railVis.pixels)) : null,
      inNextOrDockPct: railInNextDock ? r1(railInNextDock.pct) : null,
      inNextPct: railInNext ? r1(railInNext.pct) : null, inDockPct: railInDock ? r1(railInDock.pct) : null,
      rects: railRects, over: railOver,
      visBBox: railVis.bbox && { minX: Math.round(railVis.bbox.minX), maxX: Math.round(railVis.bbox.maxX), minY: Math.round(railVis.bbox.minY), maxY: Math.round(railVis.bbox.maxY) },
    },
    aboveGround: ag,
    settle: { s90SceneMs: s90 ? Math.round(s90.clock * 1000) : null, s99SceneMs: s99 ? Math.round(s99.clock * 1000) : null, distDonePctAt300: distAt(300), distDonePctAt700: distAt(700) },
    camMove: r1(camDelta(before.cam, after.cam).units), camTurnDeg: r1(camDelta(before.cam, after.cam).deg),
    pitchBeforeDeg: r1(before.pitchDeg), pitchAfterDeg: r1(after.pitchDeg),
    depthFor: r3(depthFor),
    visHeightPctBefore: r1(railVis.heightPct), visHeightPctAfter: r1(m.vis.heightPct), visWidthPctAfter: r1(m.vis.widthPct),
    visibleAtRailPct: railFull.pixels ? r1((100 * railVis.pixels) / railFull.pixels) : null,
    heightPctBefore: r1(railFull.heightPct), heightPctAfter: r1(m.full.heightPct), widthPctAfter: r1(m.full.widthPct),
    projBoxHeightPctBefore: r1(railProj.heightPct), projBoxHeightPctAfter: r1(proj.heightPct),
    visSilhouette: m.vis.bbox && { minX: Math.round(m.vis.bbox.minX), maxX: Math.round(m.vis.bbox.maxX), minY: Math.round(m.vis.bbox.minY), maxY: Math.round(m.vis.bbox.maxY) },
    silhouette: m.full.bbox && { minX: Math.round(m.full.bbox.minX), maxX: Math.round(m.full.bbox.maxX), minY: Math.round(m.full.bbox.minY), maxY: Math.round(m.full.bbox.maxY) },
    centerXPct: m.full.bbox ? r1((100 * (m.full.bbox.minX + m.full.bbox.maxX)) / 2 / VP.width) : null,
    panel, panelRight,
    underPanelPct: m.full.pixels ? r1((100 * m.full.underPanel) / m.full.pixels) : null,
    inPanelFadePct: m.full.pixels ? r1((100 * m.full.inFade) / m.full.pixels) : null,
    fullPixels: m.full.pixels, visPixels: m.vis.pixels,
    hiddenBy3DPct: hiddenPct == null ? null : r1(hiddenPct), blockers,
    chromeCoverPct: m.cover ? r1(m.cover.coveredPct) : null, chromeOver: overChrome,
    flight: {
      arrivalSceneMs: arriveRow ? Math.round(arriveRow.clock * 1000) : null,
      TmedianS: Ts.length ? r3(Ts[Ts.length >> 1]) : null, TminS: Ts.length ? r3(Ts[0]) : null, TmaxS: Ts.length ? r3(Ts[Ts.length - 1]) : null,
      motionIn: motion(rowsIn), motionOut: motion(rowsOut),
    },
    unpark: {
      scrollBefore, scrollAfter, scrollExact: scrollBefore === scrollAfter,
      cameraReturn: { units: camDelta(before.cam, back.cam).units, deg: camDelta(before.cam, back.cam).deg },
      backSceneMs: (() => { const r = rowsOut.find((x) => x.p === 0 && x.at !== -1); return r ? Math.round(r.clock * 1000) : null })(),
    },
    shots,
  }
  // Slim the step logs for the per-area JSON (kept whole in the motion object).
  R.v2.areas.push(res)
  log(`v2 ${id}: rail chrome ${res.rail.chromeHiddenPct}% (next/dock ${res.rail.inNextOrDockPct}%), AG hidden ${ag.hiddenPct}% buried ${ag.buriedPct}% off-frame ${ag.offFrame?.offPct}%, settle90 ${res.settle.s90SceneMs} ms, done@300 ${res.settle.distDonePctAt300}%`)
  log(`v2 ${id}: dist ${res.distBefore} -> ${res.distAfter} (-${res.distCutPct}%), move ${res.camMove}u/${res.camTurnDeg}deg, visH ${res.visHeightPctBefore}% -> ${res.visHeightPctAfter}%, fullH ${res.heightPctBefore}% -> ${res.heightPctAfter}% (box ${res.projBoxHeightPctAfter}%), x ${res.silhouette?.minX}-${res.silhouette?.maxX} (panel ${Math.round(panelRight ?? -1)}), hidden3D ${res.hiddenBy3DPct}%, chrome ${res.chromeCoverPct}%, snaps ${res.flight.motionIn.snaps.length}/${res.flight.motionOut.snaps.length}, scroll ${scrollBefore}->${scrollAfter}, camReturn ${res.unpark.cameraReturn.units.toExponential(2)}`)
}

// ── Robustness (v2) ──────────────────────────────────────────────────────────

async function runRobust(page, R) {
  const out = R
  const d = Object.fromEntries(AREAS.map((a) => [a[0], a[1]]))
  const rowsNow = () => page.evaluate(() => window.__gate.rows.slice())
  const cam = () => page.evaluate(() => window.__worldCamera())
  const fin = async (name, extra) => {
    const rows = await rowsNow()
    await page.evaluate(() => window.__gate.stop())
    const mo = motion(rows)
    out[name] = { ...extra, motion: mo, events: rows.filter((r) => r.at === -1).map((r) => ({ event: r.event, clock: r3(r.clock), p: r.p == null ? null : r3(r.p) })) }
    log(`robust ${name}: snaps ${mo.snaps.length}, maxStep ${r1(mo.maxStep)}, pJumps ${mo.pJumps.length}, pReversals ${mo.pReversals}, ${JSON.stringify(extra).slice(0, 220)}`)
  }
  // Run fn on the frame that crosses scene time s. Waits on the hold ONLY: an
  // earlier version also accepted "already arrived" from __worldFrame, which is
  // stale while frames are held, so R6 fired its re-park at t=0 and the still
  // pending hold then froze the page. Every at() target here is < 1.1 s, inside
  // the shortest flight, so the hold always comes.
  const at = async (s, fn, argv) => {
    await page.evaluate((s) => { window.__gate.holdAt = s; window.__gate.release() }, s)
    await page.waitForFunction(() => window.__gate.held, { timeout: 900000, polling: 50 })
    await page.evaluate(fn, argv)
    await page.evaluate(() => { window.__gate.holdAt = Infinity })
  }
  const arrive = () => page.waitForFunction(() => window.__zv.inst.mode === 'parked' && window.__worldFrame.parkProgress === 1, { timeout: 900000, polling: 100 })

  // R1: park while the rail glide is still moving the camera.
  await v2Settle(page, d.a2)
  const railA3 = await page.evaluate((dd) => Math.round(window.__worldScrollFor(dd)), d.a3)
  await page.evaluate((y) => { window.__gate.start(performance.now()); window.__gate.mark('scroll'); window.scrollTo(0, y) }, railA3)
  await page.waitForFunction(() => window.__gate.rows.filter((r) => r.at !== -1).length >= 5, { timeout: 900000, polling: 50 })
  await page.evaluate(() => { window.__gate.mark('park a3 mid-glide'); window.__worldPark('a3') })
  await arrive(); await sleep(300)
  await page.evaluate(() => { window.__gate.mark('unpark'); window.__worldPark(null) })
  await v2WaitClosed(page)
  const s1 = await page.evaluate(() => window.scrollY)
  await fin('parkDuringRailGlide', { scrollTarget: railA3, scrollAfter: s1, scrollExact: s1 === railA3 })

  // R2: same area clicked again mid-flight.
  await v2Settle(page, d.a3)
  let c0 = await cam(); let y0 = await page.evaluate(() => window.scrollY)
  await page.evaluate(() => { window.__gate.hold(); window.__gate.start(performance.now()); window.__gate.mark('park a3'); window.__worldPark('a3') })
  await at(0.3, () => { window.__gate.mark('park a3 again'); window.__worldPark('a3') })
  await page.evaluate(() => window.__gate.release()); await arrive(); await sleep(300)
  await page.evaluate(() => { window.__gate.mark('unpark'); window.__worldPark(null) })
  await v2WaitClosed(page)
  let c1 = await cam(); let y1 = await page.evaluate(() => window.scrollY)
  await fin('reparkSameMidFlight', { scrollExact: y0 === y1, camReturn: camDelta(c0, c1) })

  // R3: unpark mid-flight (0.5 s into a ~1.1 s flight).
  await v2Settle(page, d.a3)
  c0 = await cam(); y0 = await page.evaluate(() => window.scrollY)
  await page.evaluate(() => { window.__gate.hold(); window.__gate.start(performance.now()); window.__gate.mark('park a3'); window.__worldPark('a3') })
  await at(0.5, () => { window.__gate.mark('unpark mid-flight'); window.__worldPark(null) })
  await page.evaluate(() => window.__gate.release())
  await v2WaitClosed(page)
  c1 = await cam(); y1 = await page.evaluate(() => window.scrollY)
  await fin('unparkMidFlight', { scrollBefore: y0, scrollAfter: y1, scrollExact: y0 === y1, camReturn: camDelta(c0, c1) })

  // R4: a different area clicked mid-flight.
  await v2Settle(page, d.a3)
  c0 = await cam(); y0 = await page.evaluate(() => window.scrollY)
  await page.evaluate(() => { window.__gate.hold(); window.__gate.start(performance.now()); window.__gate.mark('park a3'); window.__worldPark('a3') })
  await at(0.5, () => { window.__gate.mark('park a4 mid-flight'); window.__worldPark('a4') })
  await page.evaluate(() => window.__gate.release()); await arrive(); await sleep(300)
  const p4 = await page.evaluate(() => window.__worldFrame.parkedId)
  await page.evaluate(() => { window.__gate.mark('unpark'); window.__worldPark(null) })
  await v2WaitClosed(page)
  c1 = await cam(); y1 = await page.evaluate(() => window.scrollY)
  await fin('switchAreaMidFlight', { parkedAtEnd: p4, scrollBefore: y0, scrollAfter: y1, scrollExact: y0 === y1, camReturn: camDelta(c0, c1) })

  // R5: park-to-park after arrival (a3 -> a5), then back to the rail.
  await v2Settle(page, d.a3)
  c0 = await cam(); y0 = await page.evaluate(() => window.scrollY)
  await page.evaluate(() => { window.__gate.start(performance.now()); window.__gate.mark('park a3'); window.__worldPark('a3') })
  await arrive(); await sleep(300)
  await page.evaluate(() => { window.__gate.mark('park a5 after arrival'); window.__worldPark('a5') })
  // parkProgress is 1 through this whole flight (reported defect 8), so read the scene's own mode.
  await page.waitForFunction(() => window.__zv.inst.mode === 'parked' && window.__zv.inst.parkedId === 'a5', { timeout: 900000, polling: 100 })
  await sleep(400)
  await page.screenshot({ path: path.join(OUT, `v2-${VP.name}-robust-a3-to-a5-arrived.png`) })
  const a5 = await page.evaluate(() => window.__zv.info('LM_Watchtower'))
  await page.evaluate(() => { window.__gate.mark('unpark'); window.__worldPark(null) })
  await v2WaitClosed(page)
  c1 = await cam(); y1 = await page.evaluate(() => window.scrollY)
  const rows5 = await rowsNow()
  const i5 = rows5.findIndex((r) => r.event === 'park a5 after arrival')
  const iU = rows5.findIndex((r) => r.event === 'unpark')
  const pDuring = rows5.slice(i5 + 1, iU).filter((r) => r.at !== -1).map((r) => r.p)
  await fin('parkToParkAfterArrival', {
    pDuringA3toA5: { min: Math.min(...pDuring), max: Math.max(...pDuring), frames: pDuring.length, distinct: [...new Set(pDuring.map((p) => r3(p)))].slice(0, 12) },
    a5DistAfter: r1(a5.dist), scrollBefore: y0, scrollAfter: y1, scrollExact: y0 === y1, camReturn: camDelta(c0, c1),
  })

  // R6: re-park while flying back.
  await v2Settle(page, d.a3)
  c0 = await cam(); y0 = await page.evaluate(() => window.scrollY)
  await page.evaluate(() => { window.__gate.start(performance.now()); window.__gate.mark('park a3'); window.__worldPark('a3') })
  await arrive(); await sleep(300)
  await page.evaluate(() => { window.__gate.hold(); window.__gate.start(performance.now()); window.__gate.mark('unpark'); window.__worldPark(null) })
  await at(0.4, () => { window.__gate.mark('park a3 while returning'); window.__worldPark('a3') })
  await page.evaluate(() => window.__gate.release()); await arrive(); await sleep(300)
  const open6 = await page.evaluate(() => ({ open: !!document.querySelector('main[data-open]'), overflow: document.body.style.overflow, panel: !!document.querySelector('section[aria-labelledby="v2-panel-title"]') }))
  await page.evaluate(() => { window.__gate.mark('unpark'); window.__worldPark(null) })
  await v2WaitClosed(page)
  c1 = await cam(); y1 = await page.evaluate(() => window.scrollY)
  await fin('reparkWhileReturning', { uiAfterRepark: open6, scrollBefore: y0, scrollAfter: y1, scrollExact: y0 === y1, camReturn: camDelta(c0, c1) })
}

// ── Astra ────────────────────────────────────────────────────────────────────

async function codexSettle(page, frac) {
  await page.evaluate((f) => window.scrollTo(0, Math.round(f * (document.documentElement.scrollHeight - innerHeight))), frac)
  await page.waitForFunction((f) => {
    const d = Number(document.documentElement.dataset.codexDepth)
    const max = document.documentElement.scrollHeight - innerHeight
    const t = Math.min(1, Math.max(0, window.scrollY / Math.max(1, max)))
    return Number.isFinite(d) && Math.abs(d - t) <= 0.0005 && Math.abs(t - f) < 0.01
  }, { timeout: 900000, polling: 200 }, frac)
  const n0 = await page.evaluate(() => window.__gate.frames)
  await page.waitForFunction((n) => window.__gate.frames >= n + 45, { timeout: 900000, polling: 200 }, n0)
  await sleep(250)
}

async function codexBoot(browser) {
  const P = await openPage(browser, '/dev/world-codex')
  const t = Date.now()
  await P.page.waitForSelector('main[data-ready="true"]', { timeout: 300000 })
  const z = await P.page.evaluate(installZV, 'codex')
  if (!z.ok) throw new Error('Astra scene instance not found')
  log(`Astra ready in ${Date.now() - t} ms`)
  return P
}

async function runCodexArea(page, [id, , , idx], R) {
  const pre = `codex-${VP.name}-${id}`
  await codexSettle(page, CODEX_DEPTH[idx])
  await page.evaluate(() => window.__gate.hold())
  await sleep(200)
  const before = await page.evaluate((k) => window.__zv.info(k), idx)
  const railFull = await page.evaluate((k) => window.__zv.renderMask(k, 'full', null), idx)
  const railVis = await page.evaluate((k) => window.__zv.renderMask(k, 'vis', null), idx)
  await page.evaluate(() => window.__zv.restore())
  await sleep(150)
  await page.screenshot({ path: path.join(OUT, `${pre}-rail.png`) })
  const scrollBefore = await page.evaluate(() => window.scrollY)

  await page.evaluate((i) => {
    window.__gate.start(performance.now())
    window.__gate.mark('park')
    document.getElementById(`codex-area-${i}`).click()
  }, idx)
  await sleep(400)
  const shots = []
  for (const ms of SHOT_MS) {
    if (ms > 0) await holdAtScene(page, ms / 1000)
    const sceneMs = await page.evaluate(() => Math.round(window.__gate.clock * 1000))
    const file = `${pre}-scene-${fmtMs(ms)}.png`
    await page.screenshot({ path: path.join(OUT, file) })
    shots.push({ targetMs: ms, sceneMs, file })
  }
  // Exponential damping at 6/s never snaps: 3.5 s of scene time leaves e^-21.
  await holdAtScene(page, 3.5)
  const rowsIn = await page.evaluate(() => window.__gate.rows.slice())
  const after = await page.evaluate((k) => window.__zv.info(k), idx)
  const panel = await page.evaluate(() => {
    const el = document.querySelector('section[aria-labelledby="codex-area-title"]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right }
  })
  const arrivedBuf = await page.screenshot({ path: path.join(OUT, `${pre}-arrived.png`) })
  const proj = await page.evaluate((k) => window.__zv.projectBox(k), idx)
  const m = await measureArrived(page, idx, pre, panel ? panel.right : null, arrivedBuf)
  // Time to within 1% of the final distance, on the scene clock.
  const c = after.center
  const dist = (r) => Math.hypot(r.cam.x - c[0], r.cam.y - c[1], r.cam.z - c[2])
  const fr = rowsIn.filter((r) => r.cam && r.at !== -1)
  const d0 = before.dist, d1 = after.dist
  const settle = fr.find((r) => Math.abs(dist(r) - d1) <= 0.01 * Math.abs(d0 - d1))
  const scene90 = fr.find((r) => Math.abs(dist(r) - d1) <= 0.1 * Math.abs(d0 - d1))

  await page.evaluate(() => { window.__gate.stop(); window.__gate.release() })
  await page.keyboard.press('Escape')
  const n0 = await page.evaluate(() => window.__gate.frames)
  await page.waitForFunction((n) => window.__gate.frames >= n + 60, { timeout: 900000, polling: 200 }, n0)
  const back = await page.evaluate((k) => window.__zv.info(k), idx)
  const scrollAfter = await page.evaluate(() => window.scrollY)

  const res = {
    id, index: idx, depth: CODEX_DEPTH[idx],
    distBefore: r1(before.dist), distAfter: r1(after.dist), distCutPct: r1(100 * (1 - after.dist / before.dist)),
    camMove: r1(camDelta(before.cam, after.cam).units), camTurnDeg: r1(camDelta(before.cam, after.cam).deg),
    pitchBeforeDeg: r1(before.pitchDeg), pitchAfterDeg: r1(after.pitchDeg),
    visHeightPctBefore: r1(railVis.heightPct), visHeightPctAfter: r1(m.vis.heightPct), visWidthPctAfter: r1(m.vis.widthPct),
    visibleAtRailPct: railFull.pixels ? r1((100 * railVis.pixels) / railFull.pixels) : null,
    heightPctBefore: r1(railFull.heightPct), heightPctAfter: r1(m.full.heightPct), widthPctAfter: r1(m.full.widthPct),
    projBoxHeightPctAfter: r1(proj.heightPct),
    visSilhouette: m.vis.bbox && { minX: Math.round(m.vis.bbox.minX), maxX: Math.round(m.vis.bbox.maxX), minY: Math.round(m.vis.bbox.minY), maxY: Math.round(m.vis.bbox.maxY) },
    silhouette: m.full.bbox && { minX: Math.round(m.full.bbox.minX), maxX: Math.round(m.full.bbox.maxX), minY: Math.round(m.full.bbox.minY), maxY: Math.round(m.full.bbox.maxY) },
    centerXPct: m.full.bbox ? r1((100 * (m.full.bbox.minX + m.full.bbox.maxX)) / 2 / VP.width) : null,
    panel, underPanelPct: m.full.pixels ? r1((100 * m.full.underPanel) / m.full.pixels) : null,
    fullPixels: m.full.pixels, visPixels: m.vis.pixels,
    hiddenBy3DPct: m.full.pixels ? r1(100 * (1 - m.vis.pixels / m.full.pixels)) : null,
    chromeCoverPct: m.cover ? r1(m.cover.coveredPct) : null,
    settle1pctSceneMs: settle ? Math.round(settle.clock * 1000) : null, settle10pctSceneMs: scene90 ? Math.round(scene90.clock * 1000) : null,
    motionIn: motion(rowsIn),
    unpark: { scrollBefore, scrollAfter, scrollExact: scrollBefore === scrollAfter, cameraReturn: camDelta(before.cam, back.cam) },
    shots,
  }
  R.codex.areas.push(res)
  log(`Astra ${id}: dist ${res.distBefore} -> ${res.distAfter} (-${res.distCutPct}%), move ${res.camMove}u, visH ${res.visHeightPctBefore}% -> ${res.visHeightPctAfter}%, fullH ${res.heightPctBefore}% -> ${res.heightPctAfter}%, x ${res.silhouette?.minX}-${res.silhouette?.maxX} (panel ${Math.round(panel?.right ?? -1)}), hidden3D ${res.hiddenBy3DPct}%, chrome ${res.chromeCoverPct}%, 90% at ${res.settle10pctSceneMs} ms`)
}

// ── Sheets per area ──────────────────────────────────────────────────────────

async function makeSheets(browser, R) {
  const cols = 5
  const scale = VP.name === 'ultra' ? 0.16 : VP.name === 'laptop' ? 0.3 : 0.24
  const made = []
  for (const [id] of RUN_AREAS) {
    const v = R?.v2?.areas?.find((a) => a.id === id)
    const c = R?.codex?.areas?.find((a) => a.id === id)
    const ov = (x) => (x && x.visSilhouette ? { rect: [x.visSilhouette.minX, x.visSilhouette.minY, x.visSilhouette.maxX, x.visSilhouette.maxY], vline: x.panelRight ?? x.panel?.right ?? null } : null)
    const items = [
      ...SHOT_MS.map((ms) => ({ file: `v2-${VP.name}-${id}-scene-${fmtMs(ms)}.png`, caption: `v2 ${id} ${ms} ms` })),
      { file: `v2-${VP.name}-${id}-arrived.png`, caption: v ? `v2 arrived visH ${v.visHeightPctAfter}% dist -${v.distCutPct}%` : 'v2 arrived', overlay: ov(v) },
      ...SHOT_MS.map((ms) => ({ file: `codex-${VP.name}-${id}-scene-${fmtMs(ms)}.png`, caption: `Astra ${id} ${ms} ms` })),
      { file: `codex-${VP.name}-${id}-arrived.png`, caption: c ? `Astra arrived visH ${c.visHeightPctAfter}% dist -${c.distCutPct}%` : 'Astra arrived', overlay: ov(c) },
    ]
    const out = await sheet(browser, items, cols, scale, `sheet-${VP.name}-${id}.png`)
    if (out) made.push(path.basename(out))
  }
  return made
}

// ── Main ─────────────────────────────────────────────────────────────────────

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 1800000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const jsonPath = path.join(OUT, `zoom-${VP.name}.json`)
// A partial run (one build, some areas, sheets only) merges into the existing results.
const R = fs.existsSync(jsonPath) && (SHEETS_ONLY || ONLY || SKIP_V2 || SKIP_CODEX) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : {}
delete R.fatal
R.viewport = VP
R.sourceAtStart = sourceHashes()
R.v2 = R.v2 || { areas: [] }
R.codex = R.codex || { areas: [] }
let failed = false
// The pixel-diff helper tab is opened FIRST: a tab opened later backgrounds the world tab and stops its frames.
HELPER = await browser.newPage()
await HELPER.setContent('<html><body></body></html>')
try {
  if (!SHEETS_ONLY) {
    if (!SKIP_V2 && ROBUST !== 'only') {
      R.v2.areas = R.v2.areas.filter((a) => !RUN_AREAS.some((x) => x[0] === a.id))
      const P = await v2Boot(browser)
      try {
        for (const a of RUN_AREAS) await runV2Area(P.page, a, R)
        R.v2.errors = P.errors
        R.v2.api = P.api
      } finally { await P.page.close() }
      R.v2.areas.sort((a, b) => a.id.localeCompare(b.id))
    }
    if (!SKIP_V2 && ROBUST !== 'no') {
      const P = await v2Boot(browser)
      const Rr = {}
      try {
        await runRobust(P.page, Rr)
      } catch (e) {
        Rr.fatal = String(e && e.stack ? e.stack : e)
        Rr.stateAtFailure = await P.page.evaluate(() => { const s = window.__zv && window.__zv.inst; return s ? { mode: s.mode, parkedId: s.parkedId, p: s.parkProgress, el: s.flightElapsed, T: s.flightDuration, toRail: s.flightToRail, held: window.__gate.held, holdAt: window.__gate.holdAt, clock: window.__gate.clock } : null }).catch(() => null)
        log('robust FAILED', Rr.fatal.split('\n')[0], JSON.stringify(Rr.stateAtFailure))
      } finally {
        Rr.errors = P.errors
        fs.writeFileSync(path.join(OUT, `robust-${VP.name}.json`), JSON.stringify({ viewport: VP, source: sourceHashes(), ...Rr }, null, 2))
        await P.page.close()
      }
    }
    if (!SKIP_CODEX && ROBUST !== 'only') {
      R.codex.areas = R.codex.areas.filter((a) => !RUN_AREAS.some((x) => x[0] === a.id))
      const P = await codexBoot(browser)
      try {
        for (const a of RUN_AREAS) await runCodexArea(P.page, a, R)
        R.codex.errors = P.errors
      } finally { await P.page.close() }
      R.codex.areas.sort((a, b) => a.id.localeCompare(b.id))
    }
  }
  if (ROBUST !== 'only') R.sheets = await makeSheets(browser, R)
} catch (e) {
  failed = true
  R.fatal = String(e && e.stack ? e.stack : e)
  log('FAILED', R.fatal)
} finally {
  R.sourceAtEnd = sourceHashes()
  if (ROBUST !== 'only') fs.writeFileSync(jsonPath, JSON.stringify(R, null, 2))
  await browser.close()
}
log('done', failed ? 'WITH ERRORS' : 'ok')
process.exit(failed ? 1 : 0)
