// The map's terrain after its speed-up (2026-10-20): every number it gives is
// the old one, bit for bit.
//
// The old terrain is fixtures/terrain-70c934a.ts, byte for byte the
// src/lib/world-v6/terrain.ts of production at 70c934a. It is copied here into
// _gen/ with its layout import pointed at the same copy of layout.ts that
// build.mjs makes for the current one, and both run over the whole world:
//   1. the main mesh (buildTerrainGeometry at TERRAIN_RES over WORLD) and the
//      falls patch as scene.ts cuts it: every position, normal, colour and
//      index, and the bounds;
//   2. terrainHeight on a grid twice as fine as the mesh over WORLD, a coarse
//      grid over a box nearly three times wider, 300,000 seeded random points,
//      points across every carved line (the trail, the gorge, the river, the
//      stream, the brook) and on the edges of the new code's segment grid and
//      its table; terrainBeforeBench on most of them;
//   3. the water's shores (lakeShoreR, lakeShoreAt, lakePoints, poolShoreR,
//      poolShoreAt) and the exported constants.
// Every value is compared as the 8 bytes of a double (or the 4 of the mesh's
// float32), then all of them through SHA-256. The modules scatter their trees,
// rocks, cover and lanterns by asking terrainHeight and the shores, so the
// same answers give the same scatter.
// Last, both are timed and the speed-up is printed.
//
// When terrain.ts's output changes ON PURPOSE (a reshaped shore, a new carve),
// this fails by design: copy the new terrain.ts over a fixture of its own
// commit, point this file at it, and say so in that commit.
import crypto from 'node:crypto'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const FIXTURE = 'terrain-70c934a.ts'
{
  const src = fs.readFileSync(fileURLToPath(new URL(`./fixtures/${FIXTURE}`, import.meta.url)), 'utf8')
  const from = 'from "./layout"'
  if (!src.includes(from)) throw new Error(`fixtures/${FIXTURE} no longer holds ${from}`)
  fs.writeFileSync(fileURLToPath(new URL(`./_gen/${FIXTURE}`, import.meta.url)), src.split(from).join('from "./world-layout.ts"'))
}
const OLD = await import(`./_gen/${FIXTURE}`)
const NEW = await import('./_gen/terrain.ts')
const L = await import('./_gen/world-layout.ts')
const { WORLD, PATH, GORGE, RIVER, STREAM, BROOK, PLACES } = L

let pass = 0
const fails = []
function ok(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const shaOld = crypto.createHash('sha256')
const shaNew = crypto.createHash('sha256')
let compared = 0
const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength)
/** Two typed arrays, byte for byte; on a difference, the first one shown. */
function sameBytes(a, b, label, at = () => '') {
  shaOld.update(bytes(a))
  shaNew.update(bytes(b))
  compared += a.length
  if (a.length !== b.length) return ok(false, label, `lengths ${a.length} and ${b.length}`)
  const diff = Buffer.compare(bytes(a), bytes(b))
  if (diff === 0) return ok(true, label, `${a.length.toLocaleString('en-US')} values`)
  let i = 0
  while (i < a.length && Object.is(a[i], b[i])) i++
  ok(false, label, `value ${i} differs: old ${a[i]}, new ${b[i]} ${at(i)}`)
}
/** fn of both modules at every point of xs, zs, compared as doubles. */
function heights(name, xs, zs, label) {
  const a = new Float64Array(xs.length)
  const b = new Float64Array(xs.length)
  const fo = OLD[name]
  const fn = NEW[name]
  for (let i = 0; i < xs.length; i++) a[i] = fo(xs[i], zs[i])
  for (let i = 0; i < xs.length; i++) b[i] = fn(xs[i], zs[i])
  sameBytes(a, b, `${name}: ${label}`, (i) => `at (${xs[i]}, ${zs[i]})`)
}
function grid(x0, x1, z0, z1, step, offset = 0) {
  const xs = []
  const zs = []
  for (let z = z0 + offset; z <= z1; z += step) for (let x = x0 + offset; x <= x1; x += step) { xs.push(x); zs.push(z) }
  return [Float64Array.from(xs), Float64Array.from(zs)]
}
function seeded(seed) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
const up = (v) => { const f = new Float64Array([v]); const u = new BigInt64Array(f.buffer); u[0] += v >= 0 ? 1n : -1n; return f[0] }
const down = (v) => { const f = new Float64Array([v]); const u = new BigInt64Array(f.buffer); u[0] += v > 0 ? -1n : 1n; return f[0] }

// ── 1. The meshes ────────────────────────────────────────────────────────────
console.log('\n=== The meshes: the main grid and the falls patch, every vertex ===')
function sameGeometry(go, gn, label) {
  for (const name of ['position', 'normal', 'color']) {
    sameBytes(go.getAttribute(name).array, gn.getAttribute(name).array, `${label}: ${name}`)
  }
  sameBytes(go.getIndex().array, gn.getIndex().array, `${label}: index`)
  const bo = [go.boundingSphere.center.x, go.boundingSphere.center.y, go.boundingSphere.center.z, go.boundingSphere.radius,
    go.boundingBox.min.x, go.boundingBox.min.y, go.boundingBox.min.z, go.boundingBox.max.x, go.boundingBox.max.y, go.boundingBox.max.z]
  const bn = [gn.boundingSphere.center.x, gn.boundingSphere.center.y, gn.boundingSphere.center.z, gn.boundingSphere.radius,
    gn.boundingBox.min.x, gn.boundingBox.min.y, gn.boundingBox.min.z, gn.boundingBox.max.x, gn.boundingBox.max.y, gn.boundingBox.max.z]
  sameBytes(Float64Array.from(bo), Float64Array.from(bn), `${label}: bounding sphere and box`)
}
sameGeometry(OLD.buildTerrainGeometry(), NEW.buildTerrainGeometry(), 'main mesh (TERRAIN_RES over WORLD)')
// scene.ts addTerrain(): FALLS_PATCH snapped out to the main grid, 4 cells per cell.
const FALLS_PATCH = { minX: -380, maxX: 880, minZ: 990, maxZ: 1870, sub: 4 }
function patchBounds(P) {
  const W = WORLD.maxX - WORLD.minX
  const D = WORLD.maxZ - WORLD.minZ
  const cell = Math.max(W, D) / 320
  const nx = Math.max(2, Math.round(W / cell))
  const nz = Math.max(2, Math.round(D / cell))
  const sx = W / nx
  const sz = D / nz
  const i0 = Math.max(0, Math.floor((P.minX - WORLD.minX) / sx))
  const i1 = Math.min(nx, Math.ceil((P.maxX - WORLD.minX) / sx))
  const j0 = Math.max(0, Math.floor((P.minZ - WORLD.minZ) / sz))
  const j1 = Math.min(nz, Math.ceil((P.maxZ - WORLD.minZ) / sz))
  return [Math.max(i1 - i0, j1 - j0) * P.sub, { minX: WORLD.minX + i0 * sx, maxX: WORLD.minX + i1 * sx, minZ: WORLD.minZ + j0 * sz, maxZ: WORLD.minZ + j1 * sz }]
}
{
  const src = fs.readFileSync(fileURLToPath(new URL('../src/lib/world-v6/scene.ts', import.meta.url)), 'utf8')
  ok(src.includes('const FALLS_PATCH = { minX: -380, maxX: 880, minZ: 990, maxZ: 1870, sub: 4 };'),
     'the falls patch here is scene.ts\'s (checked in its source)')
  const [res, bounds] = patchBounds(FALLS_PATCH)
  sameGeometry(OLD.buildTerrainGeometry(res, bounds), NEW.buildTerrainGeometry(res, bounds), 'falls patch')
  // A coarse and an odd mesh, as a module building its own would.
  sameGeometry(OLD.buildTerrainGeometry(64), NEW.buildTerrainGeometry(64), 'a 64-cell mesh over WORLD')
  const odd = { minX: 1013.7, maxX: 1891.3, minZ: -812.9, maxZ: 77.1 }
  sameGeometry(OLD.buildTerrainGeometry(97, odd), NEW.buildTerrainGeometry(97, odd), 'a 97-cell mesh over the lake and the meadow')
}

// ── 2. Heights ───────────────────────────────────────────────────────────────
console.log('\n=== Heights: grids, random points, the carved lines, the edges ===')
{
  // Half the main mesh's spacing (~16.5), a quarter cell off its vertices.
  const [xs, zs] = grid(WORLD.minX, WORLD.maxX, WORLD.minZ, WORLD.maxZ, 16.55, 4.1)
  heights('terrainHeight', xs, zs, 'every 16.55 across WORLD')
  heights('terrainBeforeBench', xs.filter((_, i) => i % 3 === 0), zs.filter((_, i) => i % 3 === 0), 'a third of those')
}
{
  // Far outside WORLD too: the sea, the land past the edges, the table's edges and beyond.
  const [xs, zs] = grid(-12000, 12000, -14000, 14000, 61.3, 0.7)
  heights('terrainHeight', xs, zs, 'every 61.3 over x -12,000..12,000, z -14,000..14,000')
}
{
  const r = seeded(20261020)
  const n = 300000
  const xs = new Float64Array(n)
  const zs = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = WORLD.minX - 2000 + r() * (WORLD.maxX - WORLD.minX + 4000)
    zs[i] = WORLD.minZ - 2000 + r() * (WORLD.maxZ - WORLD.minZ + 4000)
  }
  heights('terrainHeight', xs, zs, `${n.toLocaleString('en-US')} seeded random points over WORLD and 2,000 past it`)
  heights('terrainBeforeBench', xs.subarray(0, 100000), zs.subarray(0, 100000), 'the first 100,000 of them')
}
{
  // Across every carved line: each segment at 41 places along it, out to each
  // side at the distances where the carves, the bench and its fill change,
  // with a hair either side of the segment and of the vertices.
  const lines = [
    ['the trail (PATH)', PATH.map((p) => [p.x, p.z])],
    ['the gorge', GORGE.map((r) => [r[0], r[1]])],
    ['the river', RIVER.map((r) => [r[0], r[2]])],
    ['the stream', STREAM.map((r) => [r[0], r[2]])],
    ['the brook', BROOK.map((r) => [r[0], r[2]])],
  ]
  const OUT = [0, 1e-9, 0.5, 6, 16, 30, 40, 70, 120, 140, 180, 230, 400, 500, 650, 799.999, 800, 800.001, 1200]
  for (const [name, pts] of lines) {
    const xs = []
    const zs = []
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az) || 1
      const nx = -(bz - az) / len
      const nz = (bx - ax) / len
      for (let k = 0; k <= 40; k++) {
        const t = k / 40
        const x = ax + (bx - ax) * t
        const z = az + (bz - az) * t
        for (const d of OUT) for (const s of d === 0 ? [1] : [1, -1]) { xs.push(x + nx * d * s); zs.push(z + nz * d * s) }
      }
      for (const v of [ax, up(ax), down(ax)]) for (const w of [az, up(az), down(az)]) { xs.push(v); zs.push(w) }
    }
    heights('terrainHeight', Float64Array.from(xs), Float64Array.from(zs), `across ${name} (${xs.length.toLocaleString('en-US')} points)`)
    heights('terrainBeforeBench', Float64Array.from(xs), Float64Array.from(zs), `across ${name}`)
  }
}
{
  // The new code's segment grid: 200-unit cells from WORLD's corner less 400.
  // Every cell edge, exactly and a hair either side, along both axes.
  const x0 = WORLD.minX - 400
  const z0 = WORLD.minZ - 400
  const nx = Math.ceil((WORLD.maxX - WORLD.minX + 800) / 200)
  const nz = Math.ceil((WORLD.maxZ - WORLD.minZ + 800) / 200)
  const xs = []
  const zs = []
  for (let i = 0; i <= nx; i++) {
    const e = x0 + i * 200
    for (let z = z0 - 50; z <= z0 + nz * 200 + 50; z += 37.3) for (const x of [e, up(e), down(e)]) { xs.push(x); zs.push(z) }
  }
  for (let j = 0; j <= nz; j++) {
    const e = z0 + j * 200
    for (let x = x0 - 50; x <= x0 + nx * 200 + 50; x += 37.3) for (const z of [e, up(e), down(e)]) { xs.push(x); zs.push(z) }
  }
  heights('terrainHeight', Float64Array.from(xs), Float64Array.from(zs), `on every edge of the segment grid (${xs.length.toLocaleString('en-US')} points)`)
}
{
  // The circles the new code tests on x and z before Math.hypot: the knoll,
  // the pads, the lake's reach, the pool, the meadow, the forest. Each at
  // its radius on x, on z and on the diagonal, exactly and a hair either side.
  const circles = [
    [PLACES[1].pos.x, PLACES[1].pos.z, 95],
    [1350, -440, 45 + 70], [478, 2702, 55 + 60],
    ...PLACES.filter((p) => ['a1', 'a2', 'a6'].includes(p.id)).map((p) => [p.pos.x, p.pos.z, { a1: 150, a2: 74, a6: 280 }[p.id]]),
    [WORLD.lake.x, WORLD.lake.z, WORLD.lake.r + 160],
    [WORLD.pool.x, WORLD.pool.z, WORLD.pool.r],
    [WORLD.meadow.x, WORLD.meadow.z, WORLD.meadow.r],
    [WORLD.forest.x, WORLD.forest.z, WORLD.forest.r],
  ]
  const xs = []
  const zs = []
  for (const [cx, cz, r] of circles) {
    for (let a = 0; a < 360; a += 0.5) {
      const t = (a * Math.PI) / 180
      for (const k of [0.999, 1, 1.001]) { xs.push(cx + Math.cos(t) * r * k); zs.push(cz + Math.sin(t) * r * k) }
    }
    for (const e of [cx + r, cx - r]) for (const x of [e, up(e), down(e)]) for (let s = -r; s <= r; s += r / 8) { xs.push(x); zs.push(cz + s) }
    for (const e of [cz + r, cz - r]) for (const z of [e, up(e), down(e)]) for (let s = -r; s <= r; s += r / 8) { xs.push(cx + s); zs.push(z) }
  }
  heights('terrainHeight', Float64Array.from(xs), Float64Array.from(zs), `around the knoll, the pads, the lake, the pool, the meadow and the forest (${xs.length.toLocaleString('en-US')} points)`)
  // The Climb's blend: 160 out from its face on x and back from its shelf.
  const C = WORLD.climb
  const cxs = []
  const czs = []
  for (let x = C.x0 - 400; x <= C.x1 + 400; x += 3.7) for (let z = C.topZ - 400; z <= C.topZ + 100; z += 3.7) { cxs.push(x); czs.push(z) }
  for (const e of [C.x0 - 160, C.x1 + 160]) for (const x of [e, up(e), down(e)]) for (let z = C.topZ - 400; z <= C.topZ + 100; z += 7.1) { cxs.push(x); czs.push(z) }
  for (const e of [C.topZ - 150 - 160]) for (const z of [e, up(e), down(e)]) for (let x = C.x0 - 400; x <= C.x1 + 400; x += 7.1) { cxs.push(x); czs.push(z) }
  heights('terrainHeight', Float64Array.from(cxs), Float64Array.from(czs), `over the Climb's shelf and its blend (${cxs.length.toLocaleString('en-US')} points)`)
}
{
  // The hash table: noise's corners at its edge. noise(x / 60) puts corner
  // 254 at x = 15,240 and corner -256 at x = -15,360: a line of points there.
  const xs = []
  const zs = []
  for (const s of [60, 25, 140]) {
    for (const c of [-257, -256, -255, 253, 254, 255, 256]) {
      for (const x of [c * s, up(c * s), down(c * s)]) for (let z = -3000; z <= 3000; z += 101.7) { xs.push(x); zs.push(z); xs.push(z); zs.push(x) }
    }
  }
  heights('terrainHeight', Float64Array.from(xs), Float64Array.from(zs), `at the hash table's edges (${xs.length.toLocaleString('en-US')} points)`)
  // Points that are not ordinary numbers. Both versions throw a TypeError on
  // NaN, infinite or astronomically large coordinates (no segment wins, and a
  // segment number left from the line asked before indexes past the stream's
  // end); nothing in the world asks for one. Each is asked right after the
  // same ordinary height in both, so the leftover state is the same.
  const odd = [[NaN, 0], [0, NaN], [Infinity, 100], [-Infinity, 100], [100, Infinity], [100, -Infinity], [1e300, 5], [-0, -0], [0, 0], [5e-324, -5e-324]]
  const outcome = (M, x, z) => {
    M.terrainHeight(100, 200)
    try { return M.terrainHeight(x, z) } catch (e) { return `throws ${e.constructor.name}` }
  }
  const got = odd.map(([x, z]) => [outcome(OLD, x, z), outcome(NEW, x, z)])
  ok(got.every(([a, b]) => Object.is(a, b)), 'NaN, infinite, huge and zero coordinates: the same answer as before',
     odd.map(([x, z], i) => `(${Object.is(x, -0) ? '-0' : x}, ${Object.is(z, -0) ? '-0' : z}) ${got[i][1]}`).join('; '))
}

// ── 3. Water and constants ───────────────────────────────────────────────────
console.log('\n=== The shores and the constants ===')
{
  const n = 200001
  const angles = new Float64Array(n)
  for (let i = 0; i < n; i++) angles[i] = -4 * Math.PI + (8 * Math.PI * i) / (n - 1)
  const extra = [0, -0, Math.PI, -Math.PI, 2 * Math.PI, Math.PI / 2, 1e-300, 7, -7, 1e6]
  const all = Float64Array.from([...angles, ...extra])
  for (const name of ['lakeShoreR', 'poolShoreR']) {
    const a = new Float64Array(all.length)
    const b = new Float64Array(all.length)
    for (let i = 0; i < all.length; i++) { a[i] = OLD[name](all[i]); b[i] = NEW[name](all[i]) }
    sameBytes(a, b, `${name} at ${all.length.toLocaleString('en-US')} angles`, (i) => `at angle ${all[i]}`)
  }
  const r = seeded(7)
  const m = 100000
  const xs = new Float64Array(m)
  const zs = new Float64Array(m)
  for (let i = 0; i < m; i++) { xs[i] = -2000 + r() * 5000; zs[i] = -2500 + r() * 5000 }
  heights('lakeShoreAt', xs, zs, `${m.toLocaleString('en-US')} points around the lake`)
  heights('poolShoreAt', xs, zs, `${m.toLocaleString('en-US')} points around the pool`)
  const po = OLD.lakePoints()
  const pn = NEW.lakePoints()
  sameBytes(Float64Array.from(po.flatMap((p) => [p.angle, p.r, p.depth])), Float64Array.from(pn.flatMap((p) => [p.angle, p.r, p.depth])),
    `lakePoints (${pn.length} points, angle, radius, depth)`)
  const names = Object.keys(OLD).filter((k) => typeof OLD[k] === 'number').sort()
  const namesNew = Object.keys(NEW).filter((k) => typeof NEW[k] === 'number').sort()
  ok(names.join() === namesNew.join(), 'the same exported constants', names.join(', '))
  sameBytes(Float64Array.from(names.map((k) => OLD[k])), Float64Array.from(names.map((k) => NEW[k])), 'their values')
  const fnsOld = Object.keys(OLD).filter((k) => typeof OLD[k] === 'function').sort().join()
  const fnsNew = Object.keys(NEW).filter((k) => typeof NEW[k] === 'function').sort().join()
  ok(fnsOld === fnsNew, 'the same exported functions, all of them compared above', fnsNew)
}

// ── All of it ────────────────────────────────────────────────────────────────
const dOld = shaOld.digest('hex')
const dNew = shaNew.digest('hex')
ok(dOld === dNew, `SHA-256 of all ${compared.toLocaleString('en-US')} values: old and new the same`, `${dNew.slice(0, 16)}…`)

// ── 4. Time ──────────────────────────────────────────────────────────────────
console.log('\n=== Time (this machine, now; each a fresh copy of the module, then the median of 3) ===')
{
  const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
  const r = seeded(11)
  const n = 200000
  const xs = new Float64Array(n)
  const zs = new Float64Array(n)
  for (let i = 0; i < n; i++) { xs[i] = WORLD.minX + r() * (WORLD.maxX - WORLD.minX); zs[i] = WORLD.minZ + r() * (WORLD.maxZ - WORLD.minZ) }
  const [res, bounds] = patchBounds(FALLS_PATCH)
  const t = { old: { mesh: [], patch: [], random: [] }, new: { mesh: [], patch: [], random: [] } }
  for (let round = 0; round < 3; round++) {
    for (const v of round % 2 ? ['new', 'old'] : ['old', 'new']) {
      // A fresh module: an empty table and no grids, as on a page's first build.
      const M = await import(`./_gen/${v === 'old' ? FIXTURE : 'terrain.ts'}?round=${round}`)
      let t0 = performance.now()
      M.buildTerrainGeometry()
      t[v].mesh.push(performance.now() - t0)
      t0 = performance.now()
      M.buildTerrainGeometry(res, bounds)
      t[v].patch.push(performance.now() - t0)
      t0 = performance.now()
      let s = 0
      for (let i = 0; i < n; i++) s += M.terrainHeight(xs[i], zs[i])
      t[v].random.push(performance.now() - t0)
      if (!Number.isFinite(s)) throw new Error('a random height was not a number')
    }
  }
  const row = (label, key, unit = 'ms', per = 1) => {
    const o = median(t.old[key]) / per
    const w = median(t.new[key]) / per
    console.log(`  ${label.padEnd(44)} old ${o.toFixed(unit === 'ms' ? 0 : 2).padStart(5)} ${unit}   new ${w.toFixed(unit === 'ms' ? 0 : 2).padStart(5)} ${unit}   ${(o / w).toFixed(2)}x`)
  }
  row('main mesh, first build of a fresh module', 'mesh')
  row('falls patch, right after', 'patch')
  row(`${n.toLocaleString('en-US')} random heights over WORLD, per height`, 'random', 'µs', n / 1000)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
