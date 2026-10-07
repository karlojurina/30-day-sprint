/**
 * The scroll journey, verified frame by frame. Adversarial: it looks for what
 * is wrong on /dev/world-v2, and records luminance for /dev/world-codex (Astra)
 * at the same scroll fractions for comparison.
 *
 *   node world-tests/v2-journey.mjs                       # v2: split, ultra, laptop
 *   node world-tests/v2-journey.mjs --vp split,ultra      # pick viewports
 *   node world-tests/v2-journey.mjs --codex --vp split,ultra   # Astra luminance only
 *   node world-tests/v2-journey.mjs --n 40                # sweep size (default 40)
 *
 * Writes into world-tests/shots/v2-verify/journey/ (OUT_DIR overrides):
 *   v2-<vp>-default.png, v2-<vp>-dNN-<depth>.jpg (sweep), v2-<vp>-stop-<id>.png,
 *   v2-<vp>-stop-<id>-mask.png (landmark silhouette + chrome rects), sheets,
 *   v2-journey-<vp>.json, codex-journey-<vp>.json.
 *
 * HOW IT READS THE SCENE. The harness hooks give depth, markers and the camera
 * pose, but not the heightfield or the landmark boxes. The live WorldScene is
 * reached READ-ONLY through the React fiber of <main> (WorldV2's sceneRef). The
 * only writes are: currentDepth := targetDepth after a scroll (the "snap", so a
 * depth costs ~3 frames instead of ~26; checked against a natural glide once),
 * and temporary visible=false toggles for hide-diff masks, always restored and
 * re-rendered inside the same task so the page never presents a modified frame.
 *
 * WORLD PIXELS come from gl.readPixels right after a synchronous render, in the
 * same task (preserveDrawingBuffer is false, so the buffer is valid until the
 * task ends). Masks are hide-diffs: render, hide X, render, diff.
 *
 * LUMINANCE is measured on a canvas-only screenshot (every DOM overlay hidden)
 * for BOTH builds, so v2 and Astra are measured the same way. Luma is
 * Y' = 0.2126 R' + 0.7152 G' + 0.0722 B' on the 8-bit sRGB values; "mid-grey"
 * is Y' < 128.
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
const OUT = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2-verify', 'journey')
const THREE_SRC = path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js')

const ALL_VP = { split: { width: 1691, height: 1278 }, ultra: { width: 3428, height: 1230 }, laptop: { width: 1440, height: 900 } }
const args = process.argv.slice(2)
const argv = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const CODEX = args.includes('--codex')
const VPS = argv('--vp', CODEX ? 'split,ultra' : 'split,ultra,laptop').split(',').map((n) => ({ name: n, ...ALL_VP[n] }))
const N = Number(argv('--n', 40))
const MAX_DEPTH = 0.88
const STUDY_DEPTH = { a1: 0.0708, a2: 0.1934, a3: 0.3, a4: 0.4151, a5: 0.5236, a6: 0.6321, a7: 0.6863, a8: 0.8302 }
const CODEX_STOPS = [0, 0.14, 0.27, 0.41, 0.55, 0.69, 0.83, 1.0]
const V2_FILES = [
  'src/lib/world-v2/scene.ts', 'src/lib/world-v2/rail.ts', 'src/lib/world-v2/heightfield.ts', 'src/lib/world-v2/trees.ts',
  'src/lib/world-v2/study.ts', 'src/components/world-v2/WorldV2.tsx', 'src/components/world-v2/labels.ts',
  'src/components/world-v2/world.module.css', 'src/app/dev/world-v2/page.tsx', 'public/world-v2/world.glb',
]

fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const fmtD = (d) => d.toFixed(4).replace('.', '_')
const hashes = () => Object.fromEntries(V2_FILES.map((f) => {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) return [f, null]
  const st = fs.statSync(p)
  return [f, { sha: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16), mtime: st.mtime.toISOString() }]
}))

// ── In-page code ─────────────────────────────────────────────────────────────

/** Luma stats, installed in every page (v2, codex, helper). */
function installStats() {
  window.__stats = (data, w, h, bottomUp) => {
    const hist = new Uint32Array(256)
    let sum = 0
    let below = 0
    const n = w * h
    // Bottom and top quarter, in screen (top-down) terms.
    const q = Math.floor(h / 4)
    let bSum = 0, bSq = 0, bN = 0, bR = 0, bG = 0, bB = 0
    let tR = 0, tG = 0, tB = 0, tN = 0
    let black = 0
    for (let row = 0; row < h; row++) {
      const y = bottomUp ? h - 1 - row : row
      const inBottom = y >= h - q
      const inTop = y < q
      let o = row * w * 4
      for (let x = 0; x < w; x++, o += 4) {
        const r = data[o], g = data[o + 1], b = data[o + 2]
        const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
        const yi = Y > 255 ? 255 : Y | 0
        hist[yi]++
        sum += Y
        if (Y < 128) below++
        if (r === 0 && g === 0 && b === 0) black++
        if (inBottom) { bSum += Y; bSq += Y * Y; bN++; bR += r; bG += g; bB += b }
        if (inTop) { tR += r; tG += g; tB += b; tN++ }
      }
    }
    const pct = (p) => {
      const target = p * n
      let acc = 0
      for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i }
      return 255
    }
    const bMean = bSum / bN
    return {
      mean: +(sum / n).toFixed(2), p5: pct(0.05), p50: pct(0.5), p95: pct(0.95),
      belowMid: +(below / n).toFixed(4), black,
      bottomQ: { mean: +bMean.toFixed(2), std: +Math.sqrt(Math.max(0, bSq / bN - bMean * bMean)).toFixed(2), rgb: [bR / bN, bG / bN, bB / bN].map((v) => Math.round(v)) },
      topQ: { rgb: [tR / tN, tG / tN, tB / tN].map((v) => Math.round(v)) },
    }
  }
}

/** The v2 measuring library. Everything here reads the scene; see the header for the two writes. */
function installJourney() {
  const J = (window.__J = { reacquired: 0 })
  J.acquire = () => {
    const main = document.querySelector('main')
    if (!main) return false
    const key = Object.keys(main).find((k) => k.startsWith('__reactFiber$'))
    let f = main[key]
    let sc = null
    for (let n = 0; f && n < 60 && !sc; n++, f = f.return) {
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const v = h.memoizedState
        if (v && typeof v === 'object' && v.current && typeof v.current.debugScene === 'function') { sc = v.current; break }
      }
    }
    if (sc && J.sc && sc !== J.sc) J.reacquired++
    J.sc = sc
    return !!sc
  }
  J.live = () => {
    if (!J.sc || J.sc.disposed) J.acquire()
    return J.sc
  }

  J.setup = () => {
    const sc = J.live()
    const V = sc.camPos.constructor
    const Box3 = sc.landmarks.values().next().value.box.constructor
    J.V = V
    J.Box3 = Box3
    const sea = sc.scene.getObjectByName('Sea')
    J.seaBox = sea ? new Box3().setFromObject(sea) : null
    J.seaY = J.seaBox ? J.seaBox.max.y : -Infinity
    J.hf = sc.heightfield
    J.hb = J.hf.bounds
    J.names = [...document.querySelectorAll('button[data-mode]')].map((b) => b.getAttribute('aria-label').split(',')[0])
    return {
      seaBox: J.seaBox ? { min: J.seaBox.min.toArray(), max: J.seaBox.max.toArray() } : null,
      terrainBounds: J.hb,
      shadows: sc.renderer.shadowMap.enabled,
      antialias: sc.renderer.getContextAttributes().antialias,
      near: sc.camera.near, far: sc.camera.far, fov: sc.camera.fov,
      names: J.names,
      depthFor: Object.fromEntries(sc.anchors.map((a) => [a.id, sc.depthFor(a.id)])),
    }
  }

  J.inTerrain = (x, z) => x >= J.hb.minX && x <= J.hb.maxX && z >= J.hb.minZ && z <= J.hb.maxZ
  J.terrainAt = (x, z) => (J.inTerrain(x, z) ? J.hf.heightAt(x, z) : -Infinity)
  J.inSea = (x, z) => J.seaBox && x >= J.seaBox.min.x && x <= J.seaBox.max.x && z >= J.seaBox.min.z && z <= J.seaBox.max.z
  /** The surface under (x, z): terrain inside its bounds, the sea plane where the sea is, whichever is higher. */
  J.ground = (x, z) => {
    let g = J.terrainAt(x, z)
    if (J.inSea(x, z) && J.seaY > g) g = J.seaY
    return g
  }

  const visibleChain = (o) => {
    for (let e = o; e; e = e.parent) if (!e.visible) return false
    return true
  }

  // ── Asset checks: things resting on the ground. Run once; floaters are projected per frame.
  J.assetFloat = () => {
    const sc = J.live()
    const V = J.V
    const out = { rocks: [], trees: [], houses: [], landmarks: [], rockCount: 0, treeCount: 0 }
    const M = sc.camera.matrixWorld.constructor
    const m = new M()
    const bb = new J.Box3()
    const foot = (b) => {
      const pts = [[b.min.x, b.min.z], [b.max.x, b.min.z], [b.min.x, b.max.z], [b.max.x, b.max.z], [(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2]]
      const gs = pts.map(([x, z]) => J.terrainAt(x, z)).filter((g) => Number.isFinite(g))
      return { min: Math.min(...gs), max: Math.max(...gs) }
    }
    sc.scene.traverse((o) => {
      if (!o.isInstancedMesh) return
      const isRock = o.name.startsWith('Rocks:')
      const isTree = o.name.startsWith('Trees:full:') || o.name.startsWith('Trees:far:')
      if (!isRock && !isTree) return
      const g = o.geometry
      if (!g.boundingBox) g.computeBoundingBox()
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m)
        m.premultiply(o.matrixWorld)
        bb.copy(g.boundingBox).applyMatrix4(m)
        const x = m.elements[12], z = m.elements[14]
        if (!J.inTerrain(x, z)) continue
        const g0 = J.hf.heightAt(x, z)
        const f = foot(bb)
        if (isRock) {
          out.rockCount++
          const gapCenter = bb.min.y - g0
          const gapLow = bb.min.y - f.min
          if (gapCenter > 0.3 || gapLow > 1.0) out.rocks.push({ x: +x.toFixed(1), z: +z.toFixed(1), y: +bb.min.y.toFixed(2), gapCenter: +gapCenter.toFixed(2), gapLow: +gapLow.toFixed(2), size: +(bb.max.y - bb.min.y).toFixed(2), depth: +sc.rail.depthNearest(x, z).toFixed(4) })
        } else {
          out.treeCount++
          const gap = bb.min.y - g0
          if (gap > 0.3) out.trees.push({ name: o.name, x: +x.toFixed(1), z: +z.toFixed(1), gap: +gap.toFixed(2), depth: +sc.rail.depthNearest(x, z).toFixed(4) })
        }
      }
    })
    sc.scene.traverse((o) => {
      const house = /^House/.test(o.name)
      const lm = /^LM_/.test(o.name) && !/Lamp|Blades/.test(o.name)
      if (!house && !lm) return
      if (o.parent && /^(House|LM_)/.test(o.parent.name)) return
      bb.setFromObject(o)
      const f = foot(bb)
      const rec = { name: o.name, minY: +bb.min.y.toFixed(2), groundMin: +f.min.toFixed(2), groundMax: +f.max.toFixed(2), gapLow: +(bb.min.y - f.min).toFixed(2), buriedTop: +(f.max - bb.max.y).toFixed(2) }
      ;(house ? out.houses : out.landmarks).push(rec)
    })
    J.floaters = [
      ...out.rocks.filter((r) => r.gapCenter > 0.3 || r.gapLow > 1.0).map((r) => ({ kind: 'rock', x: r.x, z: r.z, y: r.y })),
      ...out.trees.map((t) => ({ kind: 'tree', x: t.x, z: t.z, y: J.hf.heightAt(t.x, t.z) + t.gap })),
    ]
    return out
  }

  /** Piers and supports that stop short of the ground, for a bridge-like landmark. */
  J.piers = (name) => {
    const sc = J.live()
    const o = sc.scene.getObjectByName(name)
    if (!o) return null
    const V = J.V
    const v = new V()
    const bins = new Map()
    let zSum = 0, zN = 0
    o.traverse((c) => {
      if (!c.isMesh) return
      const p = c.geometry.getAttribute('position')
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(c.matrixWorld)
        const k = Math.round(v.x / 2)
        const b = bins.get(k) || { minY: Infinity, maxY: -Infinity, zMin: Infinity, zMax: -Infinity, n: 0 }
        b.minY = Math.min(b.minY, v.y); b.maxY = Math.max(b.maxY, v.y)
        b.zMin = Math.min(b.zMin, v.z); b.zMax = Math.max(b.zMax, v.z); b.n++
        bins.set(k, b)
        zSum += v.z; zN++
      }
    })
    const arr = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => ({ x: k * 2, ...b }))
    const mins = arr.map((b) => b.minY).sort((a, b) => a - b)
    const median = mins[mins.length >> 1]
    const piers = []
    for (const b of arr) {
      const gs = [b.zMin, (b.zMin + b.zMax) / 2, b.zMax].map((z) => J.terrainAt(b.x, z)).filter(Number.isFinite)
      const gMin = Math.min(...gs)
      const gMax = Math.max(...gs)
      piers.push({ x: b.x, minY: +b.minY.toFixed(2), maxY: +b.maxY.toFixed(2), groundMin: +gMin.toFixed(2), groundMax: +gMax.toFixed(2), gap: +(b.minY - gMin).toFixed(2), belowDeck: b.minY < median - 3 })
    }
    return { name, medianMinY: +median.toFixed(2), bins: piers }
  }

  /** Vertices of mesh A inside closed mesh B, by ray parity along 3 axes (majority). B's material side is doubled only for the test. */
  J.inside = (nameA, nameB, maxVerts = 4000) => {
    const sc = J.live()
    const T = window.__T3
    const A = sc.scene.getObjectByName(nameA)
    const B = sc.scene.getObjectByName(nameB)
    if (!A || !B) return null
    const own = new Set()
    A.traverse((c) => own.add(c))
    const meshesB = []
    B.traverse((c) => { if (c.isMesh && !own.has(c)) meshesB.push(c) })
    const saved = meshesB.map((c) => c.material.side)
    meshesB.forEach((c) => (c.material.side = T.DoubleSide))
    const rc = new T.Raycaster()
    const V = J.V
    const v = new V()
    const dirs = [new T.Vector3(1, 0.0013, 0.0007).normalize(), new T.Vector3(-0.0011, 1, 0.0009).normalize(), new T.Vector3(0.0007, 0.0012, 1).normalize()]
    let inside = 0, total = 0
    const worst = []
    try {
      A.traverse((c) => {
        if (!c.isMesh) return
        const p = c.geometry.getAttribute('position')
        const step = Math.max(1, Math.floor(p.count / maxVerts))
        for (let i = 0; i < p.count; i += step) {
          v.fromBufferAttribute(p, i).applyMatrix4(c.matrixWorld)
          total++
          let votes = 0
          for (const d of dirs) {
            rc.set(new T.Vector3(v.x, v.y, v.z), d)
            rc.near = 0
            rc.far = Infinity
            const hits = rc.intersectObjects(meshesB, false)
            // Distinct hits only (shared edges can double count).
            let n = 0, last = -1
            for (const h of hits) { if (h.distance - last > 1e-4) n++; last = h.distance }
            if (n % 2 === 1) votes++
          }
          if (votes >= 2) { inside++; if (worst.length < 5) worst.push([+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]) }
        }
      })
    } finally {
      meshesB.forEach((c, i) => (c.material.side = saved[i]))
    }
    return { a: nameA, b: nameB, sampled: total, inside, examples: worst }
  }

  // ── Per-frame geometry, markers, labels, chrome.
  J.chromeRects = () => {
    const vis = (el) => {
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const cs = getComputedStyle(e)
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false
      }
      return true
    }
    const header = document.querySelector('main > header')
    const cue = [...document.querySelectorAll('main > div[aria-hidden="true"]')].find((d) => d.textContent.trim() === 'Scroll')
    const els = {
      brand: header?.children[0], progress: header?.children[1],
      next: document.querySelector('section[aria-label="Next lesson"]'),
      dock: document.querySelector('nav[aria-label="Areas"]'),
      footer: document.querySelector('main > footer'),
      cue,
    }
    const out = []
    for (const [name, el] of Object.entries(els)) {
      if (!el || !vis(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      out.push({ name, l: r.left, t: r.top, r: r.right, b: r.bottom })
    }
    return out
  }

  /** Nearest terrain/sea hit along a ray, by marching the surface. */
  const marchGround = (o, d, tMax) => {
    let t = 1
    let prev = t
    while (t < tMax) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t
      if (y < J.ground(x, z)) {
        let lo = prev, hi = t
        for (let k = 0; k < 16; k++) {
          const m = (lo + hi) / 2
          if (o.y + d.y * m < J.ground(o.x + d.x * m, o.z + d.z * m)) hi = m
          else lo = m
        }
        return hi
      }
      prev = t
      t += t < 60 ? 0.5 : t < 200 ? 2 : 5
    }
    return Infinity
  }

  /** Share of a 3x3x3 lattice in the landmark box the camera can see past the ground. */
  const lineOfSight = (pos, box) => {
    let seen = 0, total = 0
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) {
      const x = box.min.x + (box.max.x - box.min.x) * (0.1 + 0.4 * i)
      const z = box.min.z + (box.max.z - box.min.z) * (0.1 + 0.4 * k)
      const y = Math.max(J.ground(x, z) + 0.5, box.min.y + (box.max.y - box.min.y) * (0.1 + 0.4 * j))
      if (y > box.max.y) continue
      total++
      let clear = true
      for (let n = 1; n <= 40; n++) {
        const f = (n / 41) * 0.97
        if (J.ground(pos.x + (x - pos.x) * f, pos.z + (z - pos.z) * f) > pos.y + (y - pos.y) * f) { clear = false; break }
      }
      if (clear) seen++
    }
    return total ? seen / total : 1
  }

  J.objects = () => {
    const sc = J.sc
    const list = []
    sc.scene.traverse((o) => {
      if (!o.isMesh || o === sc.sky || o.name === 'Terrain' || /^Ridge/.test(o.name)) return
      if (!(o.layers.mask & 1) || !visibleChain(o)) return
      list.push(o)
    })
    return list
  }

  J.measure = () => {
    const sc = J.live()
    const T = window.__T3
    const cam = sc.camera
    const V = J.V
    const W = innerWidth, H = innerHeight
    const pos = sc.camPos.clone()
    const pose = sc.cameraPose()
    const f = window.__worldFrame
    const r = {
      depth: f.depth, parkProgress: f.parkProgress, triangles: f.triangles, calls: f.calls, scrollY: scrollY,
      cam: { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2), pitchDeg: +((Math.asin(-pose.dy) * 180) / Math.PI).toFixed(2), yawDeg: +((Math.atan2(pose.dx, -pose.dz) * 180) / Math.PI).toFixed(2) },
    }
    // Clearance under the camera and at the near-plane corners.
    const inT = J.inTerrain(pos.x, pos.z)
    r.cam.overTerrain = inT
    r.cam.overSea = !!J.inSea(pos.x, pos.z)
    r.cam.clearance = +(pos.y - J.ground(pos.x, pos.z)).toFixed(2)
    r.cam.terrainClearance = inT ? +(pos.y - J.hf.heightAt(pos.x, pos.z)).toFixed(2) : null
    let nearMin = Infinity
    for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 0]]) {
      const v = new V(nx, ny, -1).unproject(cam)
      nearMin = Math.min(nearMin, v.y - J.ground(v.x, v.z))
    }
    r.cam.nearPlaneMinClearance = +nearMin.toFixed(2)
    // Terrain rays through a 32x18 grid of the frame.
    const GX = 32, GY = 18
    let tMin = Infinity, tAt = null, close = 0, bottomRow = Infinity
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      const nx = ((gx + 0.5) / GX) * 2 - 1, ny = 1 - ((gy + 0.5) / GY) * 2
      const d = new V(nx, ny, 0.5).unproject(cam).sub(pos).normalize()
      const t = marchGround(pos, d, 600)
      if (t < 30) close++
      if (gy === GY - 1) bottomRow = Math.min(bottomRow, t)
      if (t < tMin) { tMin = t; tAt = [Math.round(((gx + 0.5) / GX) * W), Math.round(((gy + 0.5) / GY) * H)] }
    }
    r.cam.groundRayMin = Number.isFinite(tMin) ? +tMin.toFixed(2) : null
    r.cam.groundRayMinAtPx = tAt
    r.cam.groundRaysUnder30 = close
    r.cam.bottomRowGroundDist = Number.isFinite(bottomRow) ? +bottomRow.toFixed(1) : null
    // Everything else (trees, rocks, houses, landmarks, path, water): real raycasts to 80 units.
    const objs = J.objects()
    const rc = new T.Raycaster()
    rc.near = cam.near
    rc.far = 80
    let oMin = Infinity, oName = null
    for (let gy = 0; gy < 14; gy++) for (let gx = 0; gx < 24; gx++) {
      const nx = ((gx + 0.5) / 24) * 2 - 1, ny = 1 - ((gy + 0.5) / 14) * 2
      const d = new V(nx, ny, 0.5).unproject(cam).sub(pos).normalize()
      rc.set(new T.Vector3(pos.x, pos.y, pos.z), new T.Vector3(d.x, d.y, d.z))
      const hits = rc.intersectObjects(objs, false)
      if (hits.length && hits[0].distance < oMin) { oMin = hits[0].distance; oName = hits[0].object.name }
    }
    r.cam.objectRayMin = Number.isFinite(oMin) ? +oMin.toFixed(2) : null
    r.cam.objectRayMinName = oName
    // Camera inside any object's box (instance level for instanced meshes).
    const inside = []
    const bb = new J.Box3()
    const M = cam.matrixWorld.constructor
    const m = new M()
    for (const o of objs) {
      const g = o.geometry
      if (!g.boundingBox) g.computeBoundingBox()
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m)
          m.premultiply(o.matrixWorld)
          bb.copy(g.boundingBox).applyMatrix4(m).expandByScalar(cam.near)
          if (bb.containsPoint(pos)) { inside.push(o.name + '#' + i); break }
        }
      } else if (o.name !== 'Path' && o.name !== 'Sea' && o.name !== 'Lake' && o.name !== 'Pond') {
        bb.copy(g.boundingBox).applyMatrix4(o.matrixWorld).expandByScalar(cam.near)
        if (bb.containsPoint(pos)) inside.push(o.name)
      }
    }
    r.cam.insideBoxes = inside

    // Landmarks, markers.
    const chrome = J.chromeRects()
    r.chrome = chrome.map((c) => ({ ...c, l: Math.round(c.l), t: Math.round(c.t), r: Math.round(c.r), b: Math.round(c.b) }))
    const buttons = [...document.querySelectorAll('button[data-mode]')]
    const markersOpacity = Number(document.querySelector('button[data-mode]')?.parentElement?.style.opacity || '1')
    r.markersOpacity = markersOpacity
    r.landmarks = sc.anchors.map((a, i) => {
      const lm = sc.landmarks.get(a.landmark)
      const mk = sc.markers[i]
      const btn = buttons[i]
      const pin = btn?.querySelector('span')
      const pr = pin?.getBoundingClientRect()
      const mode = btn?.dataset.mode
      const out = { id: a.id, name: J.names[i], landmark: a.landmark, mode, markerVisible: mk.visible, mx: +mk.x.toFixed(1), my: +mk.y.toFixed(1) }
      if (pr && mode !== 'hidden') {
        out.pin = [+((pr.left + pr.right) / 2).toFixed(1), +((pr.top + pr.bottom) / 2).toFixed(1)]
        out.pinErr = +Math.hypot(out.pin[0] - mk.x, out.pin[1] - mk.y).toFixed(2)
      }
      if (!lm) return out
      const b = lm.box
      const vs = []
      let front = 0
      for (let c = 0; c < 8; c++) {
        const v = new V(c & 1 ? b.max.x : b.min.x, c & 2 ? b.max.y : b.min.y, c & 4 ? b.max.z : b.min.z)
        const vv = v.clone().applyMatrix4(cam.matrixWorldInverse)
        if (vv.z < -cam.near) front++
        v.project(cam)
        vs.push([(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H])
      }
      out.dist = +lm.center.distanceTo(pos).toFixed(1)
      out.allInFront = front === 8
      if (front === 8) {
        const xs = vs.map((p) => p[0]), ys = vs.map((p) => p[1])
        const bx = { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) }
        out.bbox = [bx.l, bx.t, bx.r, bx.b].map((v) => Math.round(v))
        const area = Math.max(1e-6, (bx.r - bx.l) * (bx.b - bx.t))
        const cl = Math.max(0, Math.min(W, bx.r) - Math.max(0, bx.l)) * Math.max(0, Math.min(H, bx.b) - Math.max(0, bx.t))
        out.bboxInFrame = +(cl / area).toFixed(3)
        out.bboxChrome = {}
        for (const c of chrome) {
          const ov = Math.max(0, Math.min(c.r, bx.r) - Math.max(c.l, bx.l)) * Math.max(0, Math.min(c.b, bx.b) - Math.max(c.t, bx.t))
          if (ov > 0) out.bboxChrome[c.name] = +(ov / area).toFixed(3)
        }
        // Anchor: projected top centre, lifted 26 px (MARKER_LIFT_PX).
        const top = lm.top.clone().project(cam)
        out.anchorPx = [+((top.x * 0.5 + 0.5) * W).toFixed(1), +((-top.y * 0.5 + 0.5) * H).toFixed(1)]
        out.anchorErr = +Math.hypot(out.anchorPx[0] - mk.x, out.anchorPx[1] - 26 - mk.y).toFixed(2)
        out.pinInsideBboxX = mk.x >= bx.l - 2 && mk.x <= bx.r + 2
      }
      out.los = +lineOfSight(pos, b).toFixed(3)
      return out
    })

    // Labels: text boxes from the hook, dots from the DOM.
    const labels = (window.__worldLabelBoxes ? window.__worldLabelBoxes() : []).map((b) => ({ ...b, kind: 'text' }))
    buttons.forEach((btn, i) => {
      if (btn.dataset.mode !== 'dot') return
      const pr = btn.querySelector('span').getBoundingClientRect()
      labels.push({ id: sc.anchors[i].id, name: J.names[i], kind: 'dot', left: pr.left, top: pr.top, right: pr.right, bottom: pr.bottom })
    })
    r.labels = labels.map((l) => ({ id: l.id, kind: l.kind, box: [l.left, l.top, l.right, l.bottom].map((v) => Math.round(v)) }))
    r.labelOverlaps = []
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j]
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) r.labelOverlaps.push(`${a.id}:${a.kind} x ${b.id}:${b.kind}`)
    }
    r.labelsOffscreen = labels.filter((b) => b.left < 0 || b.top < 0 || b.right > W || b.bottom > H).map((b) => `${b.id}:${b.kind}`)
    r.labelsOnChrome = []
    for (const l of labels) for (const c of chrome) {
      if (l.left < c.r && c.l < l.right && l.top < c.b && c.t < l.bottom) r.labelsOnChrome.push(`${l.id}:${l.kind} on ${c.name}`)
    }
    // Floating objects from the asset check that are in this frame and near enough to see.
    r.floatersInView = []
    for (const fl of J.floaters || []) {
      const v = new V(fl.x, fl.y, fl.z)
      const dist = v.distanceTo(pos)
      if (dist > 900) continue
      const vv = v.clone().applyMatrix4(cam.matrixWorldInverse)
      if (vv.z > -cam.near) continue
      v.project(cam)
      const px = (v.x * 0.5 + 0.5) * W, py = (-v.y * 0.5 + 0.5) * H
      if (px < 0 || px > W || py < 0 || py > H) continue
      r.floatersInView.push({ kind: fl.kind, px: Math.round(px), py: Math.round(py), dist: Math.round(dist) })
    }
    r.slabs = sc.slabs.map((s) => (s.detail ? 1 : 0)).join('')
    r.fog = { near: Math.round(sc.fog.near), far: Math.round(sc.fog.far) }
    return r
  }

  // ── World pixels.
  J.render = () => {
    const sc = J.sc
    sc.renderer.render(sc.scene, sc.camera)
    const gl = sc.renderer.getContext()
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
    const buf = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    return { buf, w, h }
  }
  J.withHidden = (test, fn) => {
    const sc = J.sc
    const hidden = []
    sc.scene.traverse((o) => { if (o.visible && test(o)) { o.visible = false; hidden.push(o) } })
    try { return fn(hidden.length) } finally { for (const o of hidden) o.visible = true }
  }
  /** Diff mask between two renders. rects: chrome rects to count coverage against. */
  J.diff = (A, B, rects, thr = 4) => {
    const { w, h } = A
    const a = A.buf, b = B.buf
    const mask = new Uint8Array(w * h)
    let n = 0, minx = w, miny = h, maxx = -1, maxy = -1, sx = 0, sy = 0, bottomQ = 0, edgeSum = 0
    const covered = rects.map(() => 0)
    const q = h - Math.floor(h / 4)
    for (let row = 0; row < h; row++) {
      const y = h - 1 - row
      let o = row * w * 4
      for (let x = 0; x < w; x++, o += 4) {
        const d = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]))
        if (d <= thr) continue
        mask[y * w + x] = 1
        n++
        sx += x; sy += y
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (y < miny) miny = y
        if (y > maxy) maxy = y
        if (y >= q) bottomQ++
        for (let k = 0; k < rects.length; k++) {
          const c = rects[k]
          if (x >= c.l && x < c.r && y >= c.t && y < c.b) covered[k]++
        }
      }
    }
    let topX = null
    if (n) {
      let s = 0, c = 0
      for (let y = miny; y < Math.min(h, miny + 4); y++) for (let x = minx; x <= maxx; x++) if (mask[y * w + x]) { s += x; c++ }
      topX = c ? s / c : null
    }
    return { n, share: +(n / (w * h)).toFixed(4), bbox: n ? [minx, miny, maxx, maxy] : null, cx: n ? +(sx / n).toFixed(1) : null, cy: n ? +(sy / n).toFixed(1) : null, topX: topX === null ? null : +topX.toFixed(1), topY: n ? miny : null, bottomQShare: +(bottomQ / (w * Math.floor(h / 4))).toFixed(4), covered: Object.fromEntries(rects.map((c, k) => [c.name, covered[k]]).filter(([, v]) => v > 0)), mask }
  }

  /**
   * Composition of the current frame: sky / sea / ridge / (own landmark) masks,
   * holes, world-only luma. Leaves the canvas showing the normal frame.
   */
  J.compose = (ownPrefix) => {
    const sc = J.live()
    const rects = J.chromeRects()
    const base = J.render()
    const stats = window.__stats(base.buf, base.w, base.h, true)
    const res = { world: stats, holes: stats.black }
    const noSky = J.withHidden((o) => o === sc.sky, () => J.render())
    const sky = J.diff(base, noSky, rects, 0)
    res.skyShare = sky.share
    // Pixels that are pure clear colour in the NORMAL frame are holes (nothing drew there).
    const noSea = J.withHidden((o) => o.name === 'Sea', () => J.render())
    const sea = J.diff(base, noSea, rects, 3)
    res.seaShare = sea.share
    res.seaBottomQShare = sea.bottomQShare
    const noRidge = J.withHidden((o) => /^Ridge\d/.test(o.name), () => J.render())
    const ridge = J.diff(base, noRidge, rects, 3)
    res.ridgeShare = ridge.share
    // Water-land edge raggedness at the default view: per column, the top of the sea mask.
    if (sea.n) {
      const { w, h } = base
      const tops = []
      for (let x = 0; x < w; x += 4) {
        let y = 0
        while (y < h && !sea.mask[y * w + x]) y++
        if (y < h) tops.push(y)
      }
      tops.sort((a, b) => a - b)
      res.seaTopY = { p10: tops[Math.floor(tops.length * 0.1)], p50: tops[tops.length >> 1], p90: tops[Math.floor(tops.length * 0.9)], columns: tops.length, of: Math.ceil(w / 4) }
    }
    if (ownPrefix) {
      const noLm = J.withHidden((o) => o.name.startsWith(ownPrefix), () => J.render())
      const lm = J.diff(base, noLm, rects, 4)
      J.lastMask = { base, mask: lm.mask, sea: sea.mask, rects }
      delete lm.mask
      res.own = lm
      res.own.coveredShare = lm.n ? +(Object.values(lm.covered).reduce((s, v) => s + v, 0) / lm.n).toFixed(4) : null
    }
    J.lastBase = base
    delete sky.mask
    J.render() // leave the normal frame presented
    return res
  }

  /** Overlay: world frame, own-landmark silhouette tinted, chrome rects, marker pins. Returns a PNG data URL. */
  J.overlay = (pins) => {
    const { base, mask, rects } = J.lastMask
    const { w, h, buf } = base
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    const img = g.createImageData(w, h)
    for (let row = 0; row < h; row++) {
      const y = h - 1 - row
      for (let x = 0; x < w; x++) {
        const s = (row * w + x) * 4, d = (y * w + x) * 4
        let r = buf[s], gg = buf[s + 1], b = buf[s + 2]
        if (mask[y * w + x]) { r = (r + 255) >> 1; gg = gg >> 1; b = (b + 255) >> 1 }
        img.data[d] = r; img.data[d + 1] = gg; img.data[d + 2] = b; img.data[d + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
    g.lineWidth = 2
    g.strokeStyle = '#00e5ff'
    g.font = '14px monospace'
    g.fillStyle = '#00e5ff'
    for (const r of rects) { g.strokeRect(r.l, r.t, r.r - r.l, r.b - r.t); g.fillText(r.name, r.l + 4, r.t - 4) }
    g.strokeStyle = '#ffe600'
    for (const p of pins) { g.beginPath(); g.arc(p[0], p[1], 9, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#ffe600'; g.fillText(p[2], p[0] + 12, p[1] + 4) }
    return c.toDataURL('image/png')
  }

  /**
   * Z-fighting probe: the same frame rendered twice (determinism baseline) and
   * once with the camera moved 0.03 units, direction kept. Coplanar surfaces
   * flicker in whole patches under a sub-pixel move; ordinary edges only in
   * thin lines, which a 5x5 erosion removes.
   */
  J.zfight = () => {
    const sc = J.live()
    const cam = sc.camera
    const A = J.render()
    const A2 = J.render()
    let same = 0
    for (let i = 0; i < A.buf.length; i++) if (A.buf[i] !== A2.buf[i]) { same++; }
    cam.position.x += 0.03; cam.position.y += 0.02; cam.position.z -= 0.03
    cam.updateMatrixWorld()
    const B = J.render()
    cam.position.x -= 0.03; cam.position.y -= 0.02; cam.position.z += 0.03
    cam.updateMatrixWorld()
    J.render()
    const { w, h } = A
    const ch = new Uint8Array(w * h)
    let changed = 0
    for (let i = 0, p = 0; p < w * h; p++, i += 4) {
      const d = Math.max(Math.abs(A.buf[i] - B.buf[i]), Math.abs(A.buf[i + 1] - B.buf[i + 1]), Math.abs(A.buf[i + 2] - B.buf[i + 2]))
      if (d > 24) { ch[p] = 1; changed++ }
    }
    let core = 0, minx = w, miny = h, maxx = -1, maxy = -1
    const coreMask = new Uint8Array(w * h)
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      if (!ch[y * w + x]) continue
      let all = true
      for (let dy = -2; dy <= 2 && all; dy++) for (let dx = -2; dx <= 2; dx++) if (!ch[(y + dy) * w + x + dx]) { all = false; break }
      if (all) { core++; coreMask[y * w + x] = 1; const sy = h - 1 - y; if (x < minx) minx = x; if (x > maxx) maxx = x; if (sy < miny) miny = sy; if (sy > maxy) maxy = sy }
    }
    J.lastZ = { A, coreMask }
    return { nondeterministicBytes: same, changed, changedShare: +(changed / (w * h)).toFixed(4), core, coreBbox: core ? [minx, miny, maxx, maxy] : null }
  }
  J.zOverlay = () => {
    const { A, coreMask } = J.lastZ
    const { w, h, buf } = A
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    const img = g.createImageData(w, h)
    for (let row = 0; row < h; row++) {
      const y = h - 1 - row
      for (let x = 0; x < w; x++) {
        const s = (row * w + x) * 4, d = (y * w + x) * 4
        const hot = coreMask[row * w + x]
        img.data[d] = hot ? 255 : buf[s]; img.data[d + 1] = hot ? 0 : buf[s + 1]; img.data[d + 2] = hot ? 255 : buf[s + 2]; img.data[d + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
    return c.toDataURL('image/png')
  }

  /** LOD pop: the frame with one slab's detail flipped, against the frame as shown. */
  J.pop = (slabIndex) => {
    const sc = J.live()
    const s = sc.slabs[slabIndex]
    const A = J.render()
    const set = (detail) => { for (const m of s.full) m.layers.mask = detail ? 1 : 0; for (const m of s.nearLow) m.layers.mask = detail ? 0 : 1 }
    set(!s.detail)
    let B
    try { B = J.render() } finally { set(s.detail) }
    J.render()
    const d = J.diff(A, B, [], 8)
    J.lastPop = { A, B, mask: d.mask }
    delete d.mask
    return { slab: slabIndex, zMin: s.zMin, zMax: s.zMax, detailNow: s.detail, ...d }
  }
}

// ── Node side ────────────────────────────────────────────────────────────────

async function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 1800000,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  })
}

async function openPage(browser, vp, route) {
  const page = await browser.newPage()
  page.setDefaultTimeout(1200000)
  const errors = []
  const api = []
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback to software WebGL/i.test(t)) return
    if (m.type() === 'error') errors.push(t.slice(0, 300))
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  page.on('request', (r) => {
    if (/\/api\//.test(new URL(r.url()).pathname)) api.push(`${r.method()} ${r.url()}`)
  })
  let navs = 0
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++ })
  // A frame counter for pages that render continuously (Astra).
  await page.evaluateOnNewDocument(() => {
    const real = window.requestAnimationFrame.bind(window)
    window.__rafFrames = 0
    let lastT = -1
    window.requestAnimationFrame = (cb) => real((t) => { if (t !== lastT) { lastT = t; window.__rafFrames++ } cb(t) })
  })
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 })
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  return { page, errors, api, navs: () => navs }
}

const CANVAS_ONLY = 'body *{visibility:hidden !important} canvas{visibility:visible !important}'
async function canvasOnlyStats(page, helper) {
  await page.evaluate((css) => {
    const s = document.createElement('style')
    s.id = '__canvasOnly'
    s.textContent = css
    document.head.appendChild(s)
  }, CANVAS_ONLY)
  await sleep(120)
  const b64 = await page.screenshot({ encoding: 'base64' })
  await page.evaluate(() => document.getElementById('__canvasOnly')?.remove())
  await sleep(120)
  return helper.evaluate(async (b64) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = new OffscreenCanvas(img.width, img.height)
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data
    return window.__stats(d, img.width, img.height, false)
  }, b64)
}

async function saveDataUrl(dataUrl, name) {
  fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'))
  return name
}

/** Compose screenshots into one grid PNG, in a browser page (no image library). */
async function sheet(browser, items, cols, scale, outName) {
  const present = items.filter((it) => fs.existsSync(path.join(OUT, it.file)))
  if (!present.length) return null
  const page = await browser.newPage()
  try {
    await page.setContent('<html><body style="margin:0;background:#111"></body></html>')
    const srcs = present.map((it) => `data:image/${it.file.endsWith('.jpg') ? 'jpeg' : 'png'};base64,` + fs.readFileSync(path.join(OUT, it.file)).toString('base64'))
    const dataUrl = await page.evaluate(async (srcs, captions, colors, cols, scale) => {
      const imgs = await Promise.all(srcs.map((s) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = s })))
      const cw = Math.round(Math.max(...imgs.map((i) => i.width)) * scale)
      const ch = Math.round(Math.max(...imgs.map((i) => i.height)) * scale)
      const cap = 22
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
        g.fillStyle = colors[k] || '#eee'
        g.font = '14px monospace'
        g.fillText(captions[k], x + 6, y + 16)
        g.drawImage(img, x, y + cap, img.width * scale, img.height * scale)
      })
      return c.toDataURL('image/png')
    }, srcs, present.map((it) => it.caption), present.map((it) => it.color), cols, scale)
    return saveDataUrl(dataUrl, outName)
  } finally {
    await page.close()
  }
}

async function injectV2(page) {
  const src = fs.readFileSync(THREE_SRC, 'utf8')
  await page.addScriptTag({ type: 'module', content: src + '\n;window.__T3 = { Raycaster, Vector3, DoubleSide };' })
  await page.waitForFunction(() => !!window.__T3, { timeout: 60000 })
  await page.evaluate(installStats)
  await page.evaluate(installJourney)
  const ok = await page.evaluate(() => window.__J.acquire())
  if (!ok) throw new Error('could not reach the WorldScene through the React fiber')
}

/** Scroll to a depth and snap the glide (see header). Resolves once the scene sleeps on that frame. */
async function v2Goto(page, d) {
  await page.evaluate((d) => window.scrollTo(0, Math.round(window.__worldScrollFor(d))), d)
  await page.evaluate(() => {
    const sc = window.__J.live()
    const t = sc.readScrollDepth(sc.targetDepth)
    sc.targetDepth = t
    sc.currentDepth = t
    sc.dirty = true
    sc.wake()
  })
  await page.waitForFunction(() => {
    const sc = window.__J.sc
    const f = window.__worldFrame
    return !!f && sc.raf === 0 && f.parkProgress === 0 && sc.currentDepth === sc.targetDepth && Math.abs(f.depth - sc.targetDepth) < 1e-12
  }, { polling: 100, timeout: 1200000 })
  await sleep(350)
}

async function runV2(browser, helper, vp) {
  const R = { viewport: vp, base: BASE, start: new Date().toISOString(), hashesStart: hashes(), frames: [], stops: {}, pops: [] }
  const { page, errors, api, navs } = await openPage(browser, vp, '/dev/world-v2')
  R.errors = errors
  R.api = api
  try {
    const t0 = Date.now()
    await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string' || window.__worldView === 'list', { timeout: 300000, polling: 250 })
    R.loadMs = Date.now() - t0
    const boot = await page.evaluate(() => ({ ready: window.__worldReady, error: window.__worldError ?? null, asset: window.__worldAsset, view: window.__worldView }))
    R.boot = boot
    if (!boot.ready) throw new Error(`v2 did not load: ${boot.error ?? boot.view}`)
    await injectV2(page)
    R.setup = await page.evaluate(() => window.__J.setup())
    R.asset = await page.evaluate(() => window.__J.assetFloat())
    log(`[v2 ${vp.name}] ready ${R.loadMs} ms; rocks floating ${R.asset.rocks.length}/${R.asset.rockCount}, trees floating ${R.asset.trees.length}/${R.asset.treeCount}`)

    // ── Default view: no scroll, no snap, as a student first sees it.
    await page.evaluate(() => document.fonts.ready)
    await sleep(3000)
    await page.waitForFunction(() => window.__J.sc.raf === 0, { polling: 100, timeout: 600000 })
    const def = await page.evaluate(() => window.__J.measure())
    def.compose = await page.evaluate(() => { const r = window.__J.compose('LM_Lighthouse'); return r })
    await page.screenshot({ path: path.join(OUT, `v2-${vp.name}-default.png`) })
    def.overlay = await saveDataUrl(await page.evaluate(() => window.__J.overlay([])), `v2-${vp.name}-default-mask-a1.png`)
    def.lum = await canvasOnlyStats(page, helper)
    def.file = `v2-${vp.name}-default.png`
    R.default = def
    log(`[v2 ${vp.name}] default: cam z ${def.cam.z} overTerrain ${def.cam.overTerrain}, sea ${def.compose.seaShare} (bottomQ ${def.compose.seaBottomQShare}), sky ${def.compose.skyShare}`)

    // ── The sweep: N evenly spaced depths plus every area's own stop.
    const stopDepth = R.setup.depthFor
    const list = []
    for (let i = 0; i < N; i++) list.push({ d: (MAX_DEPTH * i) / (N - 1), idx: i, stop: null })
    for (const [id, d] of Object.entries(stopDepth)) list.push({ d, idx: null, stop: id })
    list.sort((a, b) => a.d - b.d)
    let prevSlabs = null
    for (const it of list) {
      const t = Date.now()
      await v2Goto(page, it.d)
      const fr = await page.evaluate(() => window.__J.measure())
      fr.target = it.d
      fr.stop = it.stop
      fr.idx = it.idx
      const own = it.stop ? (await page.evaluate((id) => window.__J.sc.anchors.find((a) => a.id === id).landmark, it.stop)) : null
      fr.compose = await page.evaluate((p) => window.__J.compose(p), own)
      // LOD pop where a slab changed detail since the previous frame.
      if (prevSlabs !== null && fr.slabs !== prevSlabs) {
        for (let s = 0; s < fr.slabs.length; s++) {
          if (fr.slabs[s] === prevSlabs[s]) continue
          const p = await page.evaluate((s) => window.__J.pop(s), s)
          p.depth = fr.depth
          p.vp = vp.name
          R.pops.push(p)
        }
      }
      prevSlabs = fr.slabs
      const tag = it.stop ? `stop-${it.stop}` : `d${String(it.idx).padStart(2, '0')}-${fmtD(it.d)}`
      if (it.stop) {
        fr.file = `v2-${vp.name}-${tag}.png`
        await page.screenshot({ path: path.join(OUT, fr.file) })
        const pins = fr.landmarks.filter((l) => l.pin).map((l) => [...l.pin, l.id + ':' + l.mode])
        fr.maskFile = await saveDataUrl(await page.evaluate((pins) => window.__J.overlay(pins), pins), `v2-${vp.name}-${tag}-mask.png`)
        fr.zfight = await page.evaluate(() => window.__J.zfight())
        if (fr.zfight.core > 150) fr.zfight.file = await saveDataUrl(await page.evaluate(() => window.__J.zOverlay()), `v2-${vp.name}-${tag}-zfight.png`)
        R.stops[it.stop] = fr
      } else {
        fr.file = `v2-${vp.name}-${tag}.jpg`
        await page.screenshot({ path: path.join(OUT, fr.file), type: 'jpeg', quality: 88 })
      }
      fr.lum = await canvasOnlyStats(page, helper)
      fr.ms = Date.now() - t
      R.frames.push(fr)
      const own2 = fr.compose.own ? ` own ${fr.compose.own.n}px covered ${fr.compose.own.coveredShare}` : ''
      log(`[v2 ${vp.name}] ${tag} d=${fr.depth.toFixed(4)} clr ${fr.cam.clearance} gnd ${fr.cam.groundRayMin} obj ${fr.cam.objectRayMin} sky ${fr.compose.skyShare} sea ${fr.compose.seaShare}${own2} lum ${fr.lum.mean} ${fr.ms} ms`)
    }

    // ── Asset-level extras, once (split).
    if (vp.name === 'split') {
      R.piers = await page.evaluate(() => ({ viaduct: window.__J.piers('LM_Viaduct'), bridge: window.__J.piers('LM_Bridge') }))
      R.inside = await page.evaluate(() => {
        const J = window.__J
        const out = [J.inside('LM_WindmillBlades', 'LM_Windmill')]
        const houses = []
        J.sc.scene.traverse((o) => { if (/^House\d+$/.test(o.name) && !/^House/.test(o.parent?.name || '')) houses.push(o.name) })
        for (const h of houses) out.push(J.inside(h, 'LM_Lighthouse'))
        return out
      })
      // Snap equivalence: glide naturally to 0.30 from 0.25 and compare with the snapped frame.
      await v2Goto(page, 0.3)
      const snapped = await page.evaluate(() => { const J = window.__J; const b = J.render(); J.snapBuf = b; return J.sc.cameraPose() })
      await v2Goto(page, 0.25)
      await page.evaluate((d) => window.scrollTo(0, Math.round(window.__worldScrollFor(d))), 0.3)
      await page.waitForFunction((a) => { const sc = window.__J.sc; return Math.abs(sc.targetDepth - 0.3) < 2e-4 && sc.raf === 0 && sc.currentDepth === sc.targetDepth && window.__worldFrame.parkProgress === 0 }, { polling: 200, timeout: 1200000 })
      await sleep(300)
      R.snapCheck = await page.evaluate((a) => {
        const J = window.__J
        const b = J.sc.cameraPose()
        const B = J.render()
        const d = J.diff(J.snapBuf, B, [], 2)
        return { snapped: a, glided: b, posDelta: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), dirDelta: Math.hypot(a.dx - b.dx, a.dy - b.dy, a.dz - b.dz), pixelsDiffering: d.n }
      }, snapped)
      log(`[v2 ${vp.name}] snap check: pos delta ${R.snapCheck.posDelta}, pixels differing ${R.snapCheck.pixelsDiffering}`)
    }
    R.reacquired = await page.evaluate(() => window.__J?.reacquired ?? -1)
    R.navigations = navs()
  } finally {
    await page.close()
  }
  R.hashesEnd = hashes()
  R.end = new Date().toISOString()
  fs.writeFileSync(path.join(OUT, `v2-journey-${vp.name}.json`), JSON.stringify(R, null, 1))

  // Contact sheet of the sweep (evenly spaced frames only), flagged captions in red.
  const items = R.frames.filter((f) => f.idx !== null).map((f) => {
    const bad = f.labelOverlaps.length || f.labelsOffscreen.length || f.cam.clearance < 8 || (f.cam.groundRayMin ?? 999) < 20 || (f.cam.objectRayMin ?? 999) < 15 || f.compose.holes > 0
    return { file: f.file, caption: `${f.idx} d${f.depth.toFixed(3)} lum${Math.round(f.lum.mean)} sky${Math.round(f.compose.skyShare * 100)}%${bad ? ' FLAG' : ''}`, color: bad ? '#ff6b6b' : '#eee' }
  })
  const cols = vp.name === 'ultra' ? 4 : 8
  const scale = vp.name === 'ultra' ? 0.14 : vp.name === 'laptop' ? 0.22 : 0.2
  R.sheet = await sheet(browser, items, cols, scale, `v2-${vp.name}-sweep-sheet.png`)
  const stops = Object.keys(STUDY_DEPTH).map((id) => ({ file: `v2-${vp.name}-stop-${id}-mask.png`, caption: `${id} own-stop silhouette (magenta) + chrome rects (cyan)` }))
  R.stopSheet = await sheet(browser, stops, vp.name === 'ultra' ? 2 : 4, vp.name === 'ultra' ? 0.25 : 0.3, `v2-${vp.name}-stops-mask-sheet.png`)
  fs.writeFileSync(path.join(OUT, `v2-journey-${vp.name}.json`), JSON.stringify(R, null, 1))
  return R
}

async function runCodex(browser, helper, vp) {
  const R = { viewport: vp, start: new Date().toISOString(), frames: [] }
  const { page, errors, api } = await openPage(browser, vp, '/dev/world-codex')
  R.errors = errors
  R.api = api
  try {
    const t0 = Date.now()
    await page.waitForSelector('main[data-ready="true"]', { timeout: 300000 })
    R.loadMs = Date.now() - t0
    await page.evaluate(installStats)
    const list = []
    for (let i = 0; i < N; i++) list.push({ f: i / (N - 1), idx: i, stop: null })
    CODEX_STOPS.forEach((f, k) => list.push({ f, idx: null, stop: `a${k + 1}` }))
    list.sort((a, b) => a.f - b.f)
    for (const it of list) {
      const t = Date.now()
      await page.evaluate((f) => window.scrollTo(0, Math.round(f * (document.documentElement.scrollHeight - innerHeight))), it.f)
      await page.waitForFunction(() => {
        const d = Number(document.documentElement.dataset.codexDepth)
        const max = document.documentElement.scrollHeight - innerHeight
        const target = Math.min(1, Math.max(0, window.scrollY / Math.max(1, max)))
        return Number.isFinite(d) && Math.abs(d - target) <= 0.0005
      }, { polling: 200, timeout: 1200000 })
      const n0 = await page.evaluate(() => window.__rafFrames)
      const until = Date.now() + 15000
      while (Date.now() < until) {
        const n = await page.evaluate(() => window.__rafFrames)
        if (n >= n0 + 20) break
        await sleep(200)
      }
      await sleep(250)
      const st = await page.evaluate(() => ({ depth: Number(document.documentElement.dataset.codexDepth), triangles: Number(document.documentElement.dataset.codexTriangles), calls: Number(document.documentElement.dataset.codexDrawCalls), scrollY }))
      const tag = it.stop ? `stop-${it.stop}` : `d${String(it.idx).padStart(2, '0')}-${fmtD(it.f)}`
      const file = `codex-${vp.name}-${tag}.jpg`
      await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 85 })
      const lum = await canvasOnlyStats(page, helper)
      R.frames.push({ ...it, ...st, file, lum, ms: Date.now() - t })
      log(`[codex ${vp.name}] ${tag} depth ${st.depth} lum ${lum.mean} p5 ${lum.p5} p95 ${lum.p95} below ${lum.belowMid} ${Date.now() - t} ms`)
    }
  } finally {
    await page.close()
  }
  R.end = new Date().toISOString()
  fs.writeFileSync(path.join(OUT, `codex-journey-${vp.name}.json`), JSON.stringify(R, null, 1))
  const items = R.frames.filter((f) => f.idx !== null).map((f) => ({ file: f.file, caption: `${f.idx} f${f.f.toFixed(3)} lum${Math.round(f.lum.mean)}` }))
  await sheet(browser, items, vp.name === 'ultra' ? 4 : 8, vp.name === 'ultra' ? 0.14 : 0.2, `codex-${vp.name}-sweep-sheet.png`)
  return R
}

const browser = await launch()
let failed = false
try {
  const helper = await browser.newPage()
  await helper.setContent('<html><body></body></html>')
  await helper.evaluate(installStats)
  for (const vp of VPS) {
    try {
      if (CODEX) await runCodex(browser, helper, vp)
      else await runV2(browser, helper, vp)
    } catch (e) {
      failed = true
      log(`[${vp.name}] FAILED: ${e && e.stack ? e.stack : e}`)
      fs.writeFileSync(path.join(OUT, `${CODEX ? 'codex' : 'v2'}-journey-${vp.name}.error.txt`), String(e && e.stack ? e.stack : e))
    }
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
