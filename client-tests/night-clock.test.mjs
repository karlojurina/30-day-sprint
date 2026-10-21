// Night on the student's clock (Lovro, 2026-10-20 night; option D of
// _admin/prds/map-review-2026-10-15/real_time_light.md).
//
// 1. clock.ts: the night factor's hours and fades, the address overrides, and
//    the watcher (read now, every five minutes and on coming back to the tab,
//    and only when the factor changed).
// 2. light.ts's night layer, on the real track:
//    - by day (factor 0) every value of the light, at 4,001 points along the
//      route and at every stop, is the value light.ts gave before the night
//      layer existed, bit for bit. The old light.ts is fixtures/light-d0ebe76.ts,
//      byte for byte src/lib/world-v6/light.ts at world-engine d0ebe76, copied
//      into _gen/ with its two imports pointed at the same copies build.mjs makes;
//    - at night, Creative Strategy, the flight and the arch are that old light
//      too (no row: the island is night already, the arch keeps its sunrise);
//    - at night the opening and the first six places are night (state.night 1,
//      stars out, the sun gone, the moon up where the row puts it), keep the
//      day's fog ramp distances (the camera's far plane), and show no aurora
//      but in the forest;
//    - the fade's weight curve and the dial;
//    - laying the night again reuses its keys (nothing allocated per step).
//
//   node client-tests/build.mjs && node --experimental-strip-types client-tests/night-clock.test.mjs
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) {
    pass++
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    fails.push(label)
    console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e

const C = await import('./_gen/clock.ts')

// ── 1. The clock ────────────────────────────────────────────────────────────
console.log('\nThe night factor over the clock (NIGHT_HOURS)')
const H = C.NIGHT_HOURS
ok(H.duskFrom === 20 && H.duskTo === 21 && H.dawnFrom === 5 && H.dawnTo === 6, 'night rises 20:00 to 21:00 and falls 05:00 to 06:00', JSON.stringify(H))
for (const [h, want] of [[6, 0], [8, 0], [12, 0], [15, 0], [19.99, 0], [20, 0], [21, 1], [22, 1], [23, 1], [0, 1], [3, 1], [4.99, 1], [5, 1], [6.5, 0]]) {
  ok(near(C.nightAt(h), want), `nightAt(${h}) is ${want}`, String(C.nightAt(h)))
}
ok(near(C.nightAt(20.5), 0.5) && near(C.nightAt(5.5), 0.5), 'halfway through each fade the factor is one half', `${C.nightAt(20.5)}, ${C.nightAt(5.5)}`)
{
  let up = true
  let down = true
  for (let i = 1; i <= 600; i++) {
    if (C.nightAt(20 + i / 600) < C.nightAt(20 + (i - 1) / 600) - 1e-12) up = false
    if (C.nightAt(5 + i / 600) > C.nightAt(5 + (i - 1) / 600) + 1e-12) down = false
  }
  ok(up, 'the dusk fade only rises (600 steps)')
  ok(down, 'the dawn fade only falls (600 steps)')
  ok(near(C.nightAt(20 + 1e-7), 0, 1e-6) && near(C.nightAt(21 - 1e-7), 1, 1e-6) && near(C.nightAt(5 + 1e-7), 1, 1e-6) && near(C.nightAt(6 - 1e-7), 0, 1e-6), 'no jump where a fade starts or ends')
  // Read every five minutes, one step of the fade is at most a sixth of the way (a smoothstep's steepest is 1.5 x the mean).
  let worst = 0
  for (let m = 0; m < 60; m += 5) worst = Math.max(worst, Math.abs(C.nightAt(20 + (m + 5) / 60) - C.nightAt(20 + m / 60)))
  ok(worst <= 0.126, 'a five-minute step of the fade moves the factor by at most 0.126', worst.toFixed(4))
}
ok(near(C.nightAt(24), 1) && near(C.nightAt(-1), 1) && near(C.nightAt(39), 0) && C.nightAt(NaN) === 0, 'hours wrap round the clock; NaN is day')
ok(near(C.hourOf(new Date(2026, 9, 20, 23, 30, 0)), 23.5) && near(C.hourOf(new Date(2026, 9, 20, 8, 15, 36)), 8.26), 'hourOf reads the local clock with minutes and seconds')

console.log('\n?hour= values (parseHour)')
for (const [v, want] of [['23', 23], ['8', 8], ['08', 8], ['20.30', 20.5], ['05.15', 5.25], ['20:30', 20.5], ['0', 0], ['24', 0], [' 7 ', 7]]) {
  ok(near(C.parseHour(v), want), `"${v}" is ${want}`, String(C.parseHour(v)))
}
for (const v of ['25', '24.30', '20.60', '20.5', '20.300', '', 'abc', '-1', '8pm', null, undefined]) {
  ok(C.parseHour(v) === null, `${JSON.stringify(v)} is not an hour`)
}

console.log('\nWhich clock a page follows (clockSetting)')
const set = (search, live) => JSON.stringify(C.clockSetting(search, live))
ok(set('', true) === '{"kind":"clock"}', "the students' map follows the clock when its address says nothing")
ok(set('', false) === '{"kind":"day"}', 'every other page is pinned to day when its address says nothing (the dev pages, the world tests, the posters)')
ok(set('?catalog=course&p=p0&discount=locked&poster=off', false) === '{"kind":"day"}', "the poster pipeline's address pins day")
ok(set('?tod=night', false) === '{"kind":"night"}' && set('?tod=night', true) === '{"kind":"night"}', '?tod=night pins night on either page')
ok(set('?tod=day', true) === '{"kind":"day"}', '?tod=day pins day on the students\' map')
ok(set('?tod=clock', false) === '{"kind":"clock"}', '?tod=clock runs the clock on a dev page (a test that asks for it)')
ok(set('?hour=23', false) === '{"kind":"hour","hour":23}' && set('?hour=20.30', true) === '{"kind":"hour","hour":20.5}', '?hour=HH and HH.MM pin that hour')
ok(set('?tod=day&hour=23', false) === '{"kind":"day"}' && set('?hour=23&tod=night', true) === '{"kind":"night"}', '?tod wins over ?hour')
ok(set('?hour=99', false) === '{"kind":"day"}' && set('?hour=99', true) === '{"kind":"clock"}', 'an hour that does not parse is ignored')
ok(set('?tod=dusk&hour=21', false) === '{"kind":"hour","hour":21}', 'an unknown ?tod is ignored')

console.log('\nThe factor a setting gives (nightFor)')
const at = (h, m = 0) => new Date(2026, 9, 20, h, m, 0)
ok(C.nightFor({ kind: 'day' }, at(23)) === 0 && C.nightFor({ kind: 'night' }, at(12)) === 1, 'day and night ignore the clock')
ok(C.nightFor({ kind: 'hour', hour: 23 }, at(12)) === 1 && C.nightFor({ kind: 'hour', hour: 15 }, at(23)) === 0, 'a pinned hour ignores the clock')
ok(C.nightFor({ kind: 'clock' }, at(23)) === 1 && C.nightFor({ kind: 'clock' }, at(15)) === 0 && near(C.nightFor({ kind: 'clock' }, at(20, 30)), 0.5), 'the clock setting reads the date it is given')

console.log('\nThe watcher (watchClock), on a stand-in window and document')
{
  const timers = []
  const listeners = []
  globalThis.window = {
    setInterval: (fn, ms) => (timers.push({ fn, ms, live: true }), timers.length),
    clearInterval: (id) => {
      if (timers[id - 1]) timers[id - 1].live = false
    },
  }
  globalThis.document = {
    hidden: false,
    addEventListener: (t, f) => listeners.push({ t, f, live: true }),
    removeEventListener: (t, f) => {
      for (const l of listeners) if (l.t === t && l.f === f) l.live = false
    },
  }
  let now = at(19, 58)
  const got = []
  // The watcher hands a look (clock.ts ClockLook); this suite reads its night.
  const stop = C.watchClock({ kind: 'clock' }, (l) => got.push(+l.night.toFixed(4)), () => now)
  ok(got.length === 1 && got[0] === 0, 'the factor now, at once', JSON.stringify(got))
  ok(timers.length === 1 && timers[0].ms === C.CLOCK.everyMs && C.CLOCK.everyMs === 300000, 'then a check every five minutes', String(timers[0]?.ms))
  ok(listeners.length === 1 && listeners[0].t === 'visibilitychange', 'and one when the tab becomes visible again')
  timers[0].fn()
  ok(got.length === 1, 'no call while the factor is unchanged (19:58, still day)')
  now = at(20, 30)
  timers[0].fn()
  ok(got.length === 2 && got[1] === 0.5, 'a call when the fade moves it (20:30)', JSON.stringify(got))
  now = at(2, 0)
  document.hidden = true
  listeners[0].f()
  ok(got.length === 2, 'a hidden tab is not read')
  document.hidden = false
  listeners[0].f()
  ok(got.length === 3 && got[2] === 1, 'coming back to the tab at 2 am reads night at once', JSON.stringify(got))
  stop()
  ok(!timers[0].live && !listeners[0].live, 'stop() clears the timer and the listener')
  const got2 = []
  const stop2 = C.watchClock({ kind: 'hour', hour: 23 }, (l) => got2.push(l.night), () => now)
  ok(got2.length === 1 && got2[0] === 1 && timers.length === 1, 'a pinned setting is read once and sets no timer')
  stop2()
  delete globalThis.window
  delete globalThis.document
}

// ── 2. The night layer ──────────────────────────────────────────────────────
{
  const FIX = 'light-d0ebe76.ts'
  const src = fs.readFileSync(fileURLToPath(new URL(`./fixtures/${FIX}`, import.meta.url)), 'utf8')
  let s = src
  for (const [from, to] of [['from "./layout"', 'from "./world-layout.ts"'], ['from "./terrain"', 'from "./terrain.ts"']]) {
    if (!s.includes(from)) throw new Error(`fixtures/${FIX} no longer holds ${from}`)
    s = s.split(from).join(to)
  }
  fs.writeFileSync(fileURLToPath(new URL(`./_gen/${FIX}`, import.meta.url)), s)
}
const OLD = await import('./_gen/light-d0ebe76.ts')
const NEW = await import('./_gen/world-light.ts')
const LAYOUT = await import('./_gen/world-layout.ts')

const placeU = NEW.defaultPlaceU()
const oldTrack = OLD.buildTrack(placeU)
const track = NEW.buildTrack(placeU)
const a7U = placeU[6]

// blendTrack writes into the state it is handed and neither module exports
// newState: this is its shape (the old module's fields; the new adds aurora,
// band, night, rev, and since the morning the morning and its mist).
const THREE = await import('three')
function emptyState() {
  const c = () => new THREE.Color()
  const v = () => new THREE.Vector3()
  return {
    u: 0, stop: 0, blend: 0, sunDir: v(), moonDir: v(), moonLightDir: v(), sunEl: 0,
    sunColor: c(), sunHero: 0, sunIntensity: 0, sunGlow: c(), moonColor: c(), moonIntensity: 0, moonVis: 0,
    rimColor: c(), rimIntensity: 0, skyTop: c(), skyMid: c(), skyHorizon: c(), skyGlow: c(),
    haze: c(), fogNear: 0, fogFar: 0, hemiSky: c(), hemiGround: c(), hemiIntensity: 0,
    ambient: c(), ambientIntensity: 0, exposure: 1, stars: 0, cloudTop: c(), cloudBase: c(), water: c(),
    lampGlow: 1, magicGlow: 1, aurora: 0, band: 0, night: 0, rev: 0, under: 0,
    morning: 0, mist: 0, mistDepth: 1, mistNear: 0, mistFar: 1, mistColor: c(),
    nearShade: c(), halo: c(), hazeBase: 0, hazeFall: 1, hazeOn: 0, sunLobe: 0, fogCap: 0.92,
    liftR: 0, liftG: 0, liftB: 0, gainR: 1, gainG: 1, gainB: 1, gamma: 1, sat: 1, haloAmt: 0, haloDeg: 0, haloHalf: 1, haloFog: 0, fogAdd: 0,
  }
}
const OLD_FIELDS = Object.keys(emptyState()).filter((k) => !['aurora', 'band', 'night', 'rev', 'morning', 'mist', 'mistDepth', 'mistNear', 'mistFar', 'mistColor'].includes(k))
const f64 = new Float64Array(1)
const bits = (x) => {
  f64[0] = x
  return new BigUint64Array(f64.buffer)[0]
}
/** The first field where two states differ, bit for bit, or null. */
function diff(a, b) {
  for (const k of OLD_FIELDS) {
    const x = a[k]
    const y = b[k]
    if (typeof x === 'number') {
      if (bits(x) !== bits(y)) return `${k}: ${x} vs ${y}`
    } else if (x && 'r' in x) {
      for (const ch of ['r', 'g', 'b']) if (bits(x[ch]) !== bits(y[ch])) return `${k}.${ch}: ${x[ch]} vs ${y[ch]}`
    } else if (x && 'x' in x) {
      for (const ch of ['x', 'y', 'z']) if (bits(x[ch]) !== bits(y[ch])) return `${k}.${ch}: ${x[ch]} vs ${y[ch]}`
    }
  }
  return null
}
const us = []
for (let i = 0; i <= 4000; i++) us.push(i / 4000)
for (const t of track) us.push(t.u, Math.max(0, t.u - 1e-6), Math.min(1, t.u + 1e-6))

console.log('\nBy day, the light is the old light, bit for bit')
ok(track.length === oldTrack.length && track.every((t, i) => bits(t.u) === bits(oldTrack[i].u) && t.hold === oldTrack[i].hold && bits(t.rate) === bits(oldTrack[i].rate)), 'the same stops, holds and rates', `${track.length} stops`)
NEW.setTrackNight(track, 0)
ok(track.every((t) => t.key === t.day), 'at night 0 every stop blends its own authored key (the same object)')
{
  const a = emptyState()
  const b = emptyState()
  let first = null
  for (const u of us) {
    OLD.blendTrack(u, oldTrack, placeU, a)
    NEW.blendTrack(u, track, placeU, b)
    const d = diff(a, b)
    if (d) {
      first = `u ${u}: ${d}`
      break
    }
  }
  ok(first === null, `every field at ${us.length} points along the route`, first ?? 'all equal')
  NEW.blendTrack(0.3, track, placeU, b)
  ok(b.night === 0, 'and no night anywhere', String(b.night))
  let same = true
  for (const u of us) {
    NEW.blendTrack(u, track, placeU, b)
    if (bits(b.band) !== bits(b.stars) || bits(b.aurora) !== bits(b.stars)) same = false
  }
  ok(same, 'by day the Milky Way and the aurora are the star level, as the sky drew them')
}

console.log('\nAt night, Creative Strategy, the flight and the arch keep their own light, bit for bit')
NEW.setTrackNight(track, 1)
ok(track.every((t) => (t.u >= a7U - 1e-12 ? t.key === t.day && t.dial === 0 : true)), 'no stop from Creative Strategy on has a night of its own')
{
  const a = emptyState()
  const b = emptyState()
  let first = null
  let n = 0
  for (const u of us) {
    if (u < a7U) continue
    n++
    OLD.blendTrack(u, oldTrack, placeU, a)
    NEW.blendTrack(u, track, placeU, b)
    const d = diff(a, b)
    if (d || b.night !== 0) {
      first = `u ${u}: ${d ?? `night ${b.night}`}`
      break
    }
  }
  ok(first === null && n > 1000, `every field at the ${n} points from a7 to the route's end`, first ?? 'all equal')
}

console.log('\nAt night, the opening and the first six places are night')
{
  const b = emptyState()
  const day = emptyState()
  const names = ['opening', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6']
  const stopsU = [0, ...placeU.slice(0, 6)]
  const k0 = track.find((t) => t.u === 0)
  ok(!!k0 && k0.src.light === 'opening-gold', "the opening's stop is the opening-gold hold")
  for (let i = 0; i < stopsU.length; i++) {
    const u = stopsU[i]
    OLD.blendTrack(u, oldTrack, placeU, day)
    NEW.blendTrack(u, track, placeU, b)
    const row = NEW.NIGHT_ROWS[i === 0 ? 'opening-gold' : LAYOUT.PLACES[i - 1].light]
    ok(near(b.night, row.dial, 1e-9) && b.stars >= 0.99 * row.dial && b.sunIntensity === 0 && b.sunEl < -6, `${names[i]}: night ${b.night}, stars ${b.stars.toFixed(2)}, the sun down (el ${b.sunEl.toFixed(1)})`)
    ok(near(b.moonVis, row.dial) && b.moonIntensity > 1, `${names[i]}: the moon up (vis ${b.moonVis.toFixed(2)}, light ${b.moonIntensity.toFixed(2)})`)
    // The moon's disc where the row puts it (azimuth / elevation in the sky).
    const az = ((Math.atan2(b.moonDir.x, -b.moonDir.z) * 180) / Math.PI + 360) % 360
    const el = (Math.asin(b.moonDir.y) * 180) / Math.PI
    ok(Math.abs(((az - row.moonAz + 540) % 360) - 180) < 0.01 && Math.abs(el - row.moonEl) < 0.01, `${names[i]}: the disc at ${row.moonAz} / ${row.moonEl}`, `${az.toFixed(2)} / ${el.toFixed(2)}`)
    ok(bits(b.fogNear) === bits(day.fogNear) && bits(b.fogFar) === bits(day.fogFar), `${names[i]}: the day's fog ramp, so the same far plane (${day.fogNear} to ${day.fogFar})`)
    ok(b.lampGlow > day.lampGlow && b.lampGlow >= 1, `${names[i]}: the lamps up (${day.lampGlow} by day, ${b.lampGlow.toFixed(2)})`)
    if (i < 6) {
      ok(bits(b.aurora) === bits(day.stars), `${names[i]}: no aurora (its day level, ${day.stars})`, String(b.aurora))
      // The lake keeps its Milky Way (it lies in the water); everywhere else on the ground its noise was night's cost.
      if (names[i] === 'a5') ok(near(b.band, 1), 'a5: the Milky Way in the lake', String(b.band))
      else ok(bits(b.band) === bits(day.stars), `${names[i]}: no Milky Way (its day level: its noise was night's cost)`, String(b.band))
    } else {
      ok(near(b.aurora, 1) && near(b.band, 1), `${names[i]}: the forest has its aurora and its Milky Way`, `${b.aurora}, ${b.band}`)
    }
  }
  // Between the forest and the island (no row past a6): the night runs out to the island's own.
  NEW.blendTrack((placeU[5] + a7U) / 2, track, placeU, b)
  ok(b.night > 0 && b.night < 1, 'halfway from the forest to the island the night layer fades into the island\'s own night', b.night.toFixed(3))
}

console.log('\nThe fade and the dial')
ok(NEW.nightWeight(0) === 0 && NEW.nightWeight(1) === 1, 'the weight is 0 at day and 1 at night')
{
  let mono = true
  for (let i = 1; i <= 1000; i++) if (NEW.nightWeight(i / 1000) < NEW.nightWeight((i - 1) / 1000)) mono = false
  ok(mono, 'and only rises')
}
ok(NEW.nightWeight(0.5) > 0.8 && NEW.nightWeight(0.5) < 0.85, 'halfway through the clock\'s fade the light is about 82% night (linear light: the day is 10 to 30 times the night)', NEW.nightWeight(0.5).toFixed(3))
{
  const b = emptyState()
  NEW.setTrackNight(track, 0.5)
  NEW.blendTrack(placeU[0], track, placeU, b)
  ok(near(b.night, NEW.nightWeight(0.5) * NEW.NIGHT_ROWS['afternoon-gold'].dial), 'state.night is the weight times the dial', b.night.toFixed(4))
  const k1 = track.find((t) => t.u === placeU[0]).key
  NEW.setTrackNight(track, 0.6)
  const k2 = track.find((t) => t.u === placeU[0]).key
  ok(k1 === k2 && k1 !== track.find((t) => t.u === placeU[0]).day, 'laying the night again writes into the same key (nothing allocated per step of the ease)')
}
for (const [name, row] of Object.entries(NEW.NIGHT_ROWS)) ok(row.dial > 0 && row.dial <= 1, `${name}: dial ${row.dial}`)

NEW.setTrackNight(track, 0)
console.log(`\n${pass} passed, ${fails.length} failed`)
if (fails.length) {
  console.log(fails.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
