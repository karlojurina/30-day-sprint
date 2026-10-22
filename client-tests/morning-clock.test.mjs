// The morning on the student's clock (2026-10-21: option B's morning over
// option D's night, _admin/prds/map-review-2026-10-15/real_time_light.md,
// after the owner saw the night and a throwaway morning probe).
//
// 1. clock.ts: the morning's window and fades beside the night's, at every
//    minute of the day: 05:00 to 06:00 the night fades out onto the morning,
//    06:00 to 09:00 the morning, 09:00 to 10:00 the morning fades into the
//    day, 10:00 to 20:00 the day exactly (both factors 0), the dusk and the
//    night as they were; ?tod=morning and ?hour=; the watcher on both factors.
// 2. light.ts's morning layer, on the real track:
//    - by day on the clock (10:00 to 20:00) every value of the light, at 4,000
//      points along the route and round every stop, is the light before the
//      night existed, bit for bit (fixtures/light-d0ebe76.ts, as
//      night-clock.test.mjs), and nothing of the morning is in it (no mist);
//    - the night unchanged: at every minute of the dusk (20:00 to 21:00) and
//      at full night, every value is the night as it stood before the morning
//      (light.ts at eab2330, the night branch's head, from git), bit for bit,
//      and at 05:00, the morning under the full night, too;
//    - the morning at the opening and the first six places (state.morning 1,
//      no star, no moon, no aurora, the lamps down, the place's own sun, the
//      day's fog ramp distances, the mist on), and from Creative Strategy on
//      the old light, bit for bit;
//    - the dawn's crossfade and the 09:00 fade, and the scratch keys reused.
//
//   node client-tests/build.mjs && node --experimental-strip-types client-tests/morning-clock.test.mjs
import { execFileSync } from 'node:child_process'
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
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

const C = await import('./_gen/clock.ts')

// ── 1. The clock ────────────────────────────────────────────────────────────
console.log('\nThe morning on the clock (MORNING_HOURS beside NIGHT_HOURS)')
const H = C.NIGHT_HOURS
const M = C.MORNING_HOURS
ok(H.duskFrom === 20 && H.duskTo === 21 && H.dawnFrom === 5 && H.dawnTo === 6, 'the night is as it was: rises 20:00 to 21:00, falls 05:00 to 06:00', JSON.stringify(H))
ok(M.fadeFrom === 9 && M.fadeTo === 10, 'the morning fades into the day from 09:00 to 10:00', JSON.stringify(M))
{
  // Every minute of the day, in its window.
  const off = { day: [], morning: [], night: [], dawn: [], fade: [], dusk: [] }
  for (let m = 0; m < 1440; m++) {
    const h = m / 60
    const l = C.lookAt(h)
    if (h >= 10 && h < 20) {
      if (l.night !== 0 || l.morning !== 0) off.day.push(hm(m))
    } else if (h >= 6 && h < 9) {
      if (l.night !== 0 || l.morning !== 1) off.morning.push(hm(m))
    } else if (h >= 21 || h < 5) {
      if (l.night !== 1 || l.morning !== 0) off.night.push(hm(m))
    } else if (h >= 5 && h < 6) {
      if (l.morning !== 1 || !(l.night <= 1 && l.night > 0) || l.night !== C.nightAt(h)) off.dawn.push(hm(m))
    } else if (h >= 9 && h < 10) {
      if (l.night !== 0 || !(l.morning <= 1 && l.morning > 0)) off.fade.push(hm(m))
    } else if (h >= 20 && h < 21) {
      if (l.morning !== 0 || l.night !== C.nightAt(h)) off.dusk.push(hm(m))
    }
  }
  ok(off.day.length === 0, '10:00 to 20:00 is the day at every minute: the night 0 and the morning 0, exactly (600 minutes)', off.day.slice(0, 4).join(' '))
  ok(off.morning.length === 0, '06:00 to 09:00 is the morning at every minute: the morning 1, the night 0 (180 minutes)', off.morning.slice(0, 4).join(' '))
  ok(off.night.length === 0, '21:00 to 05:00 is the night at every minute, with no morning under it (480 minutes)', off.night.slice(0, 4).join(' '))
  ok(off.dawn.length === 0, '05:00 to 06:00 the night falls as it did, over the whole morning (the dawn: the night going off the morning)', off.dawn.slice(0, 4).join(' '))
  ok(off.fade.length === 0, '09:00 to 10:00 the morning falls, with no night', off.fade.slice(0, 4).join(' '))
  ok(off.dusk.length === 0, '20:00 to 21:00 the night rises as it did, over the day (no morning)', off.dusk.slice(0, 4).join(' '))
}
ok(near(C.morningAt(9.5), 0.5) && C.morningAt(9) === 1 && C.morningAt(10) === 0 && C.morningAt(7.5) === 1 && C.morningAt(5) === 1 && C.morningAt(4.999) === 0 && C.morningAt(15) === 0, 'morningAt: 1 at 05:00, 07:30 and 09:00, a half at 09:30, 0 at 10:00, 15:00 and just before 05:00', [5, 7.5, 9, 9.5, 10].map((h) => C.morningAt(h)).join(' '))
{
  let down = true
  for (let i = 1; i <= 600; i++) if (C.morningAt(9 + i / 600) > C.morningAt(9 + (i - 1) / 600) + 1e-12) down = false
  ok(down, "the morning's fade only falls (600 steps)")
  ok(near(C.morningAt(9 + 1e-7), 1, 1e-6) && near(C.morningAt(10 - 1e-7), 0, 1e-6), 'no jump where its fade starts or ends')
  let worst = 0
  for (let m = 0; m < 60; m += 5) worst = Math.max(worst, Math.abs(C.morningAt(9 + (m + 5) / 60) - C.morningAt(9 + m / 60)))
  ok(worst <= 0.126, 'a five-minute step of the fade moves the factor by at most 0.126 (the watcher reads every five minutes)', worst.toFixed(4))
}
{
  // The morning's one step: 0 to 1 at 05:00, where the night is full and covers it.
  const before = C.lookAt(5 - 1 / 3600)
  const at = C.lookAt(5)
  ok(before.night === 1 && at.night === 1 && before.morning === 0 && at.morning === 1, "the morning's one step (0 to 1 at 05:00) falls under the full night", `${JSON.stringify(before)} then ${JSON.stringify(at)}`)
  ok(C.morningAt(24 + 7) === 1 && C.morningAt(-17) === 1 && C.morningAt(NaN) === 0, 'hours wrap round the clock; NaN is no morning')
}

console.log('\nThe address (clockSetting, lookFor)')
const set = (search, live) => JSON.stringify(C.clockSetting(search, live))
ok(set('?tod=morning', false) === '{"kind":"morning"}' && set('?tod=morning', true) === '{"kind":"morning"}', '?tod=morning pins the morning on either page')
ok(set('?tod=morning&hour=23', true) === '{"kind":"morning"}' && set('?hour=07.30&tod=night', false) === '{"kind":"night"}', '?tod wins over ?hour')
ok(set('', false) === '{"kind":"day"}' && set('', true) === '{"kind":"clock"}', 'nothing asked: the dev pages pinned to day, the students\' map on the clock')
const at = (h, m = 0) => new Date(2026, 9, 21, h, m, 0)
const look = (s, d) => JSON.stringify(C.lookFor(s, d))
ok(look({ kind: 'morning' }, at(23)) === '{"night":0,"morning":1}' && look({ kind: 'night' }, at(8)) === '{"night":1,"morning":0}' && look({ kind: 'day' }, at(8)) === '{"night":0,"morning":0}', 'morning, night and day ignore the clock (?tod=night is the night over the day, as it was)')
ok(look({ kind: 'hour', hour: 7.5 }, at(15)) === '{"night":0,"morning":1}' && near(C.lookFor({ kind: 'hour', hour: 9.5 }, at(15)).morning, 0.5), '?hour=07.30 is the morning, ?hour=09.30 halfway out of it')
ok(look({ kind: 'clock' }, at(7, 30)) === '{"night":0,"morning":1}' && look({ kind: 'clock' }, at(15)) === '{"night":0,"morning":0}', 'the clock setting reads the date it is given')
ok(C.parseHour('07.30') === 7.5 && C.parseHour('09:45') === 9.75, '?hour reads 07.30 and 09:45')
ok(C.nightFor({ kind: 'clock' }, at(5, 30)) === C.lookFor({ kind: 'clock' }, at(5, 30)).night, 'nightFor is lookFor\'s night')

console.log('\nThe watcher, on both factors')
{
  const timers = []
  const listeners = []
  globalThis.window = { setInterval: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearInterval: () => {} }
  globalThis.document = { hidden: false, addEventListener: (t, f) => listeners.push({ t, f }), removeEventListener: () => {} }
  let now = at(7)
  const got = []
  const stop = C.watchClock({ kind: 'clock' }, (l) => got.push(`${+l.night.toFixed(3)}/${+l.morning.toFixed(3)}`), () => now)
  ok(got.length === 1 && got[0] === '0/1', 'the look now, at once (07:00: the morning)', got.join(' '))
  now = at(8)
  timers[0].fn()
  ok(got.length === 1, 'no call while the look is unchanged (08:00)')
  now = at(9, 30)
  timers[0].fn()
  ok(got.length === 2 && got[1] === '0/0.5', 'a call when the morning moves (09:30)', got.join(' '))
  now = at(5, 30)
  listeners[0].f()
  ok(got.length === 3 && got[2] === '0.5/1', 'and when the night moves over it (05:30 on coming back to the tab)', got.join(' '))
  stop()
  delete globalThis.window
  delete globalThis.document
}

// ── 2. The light ────────────────────────────────────────────────────────────
const repo = fileURLToPath(new URL('..', import.meta.url))
const gen = (name, src) => {
  let s = src
  for (const [from, to] of [['from "./layout"', 'from "./world-layout.ts"'], ['from "./terrain"', 'from "./terrain.ts"']]) {
    if (!s.includes(from)) throw new Error(`${name} no longer holds ${from}`)
    s = s.split(from).join(to)
  }
  fs.writeFileSync(fileURLToPath(new URL(`./_gen/${name}`, import.meta.url)), s)
}
// The light before the night (as night-clock.test.mjs), and the night as it stood before the morning: the night branch's head, eab2330.
gen('light-d0ebe76.ts', fs.readFileSync(fileURLToPath(new URL('./fixtures/light-d0ebe76.ts', import.meta.url)), 'utf8'))
const NIGHT_BASE_COMMIT = 'eab2330'
gen('light-eab2330.ts', execFileSync('git', ['show', `${NIGHT_BASE_COMMIT}:src/lib/world-v6/light.ts`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 }))
const OLD = await import('./_gen/light-d0ebe76.ts')
const NIGHTLY = await import('./_gen/light-eab2330.ts')
const NEW = await import('./_gen/world-light.ts')
const THREE = await import('three')

const placeU = NEW.defaultPlaceU()
const oldTrack = OLD.buildTrack(placeU)
const nightTrack = NIGHTLY.buildTrack(placeU)
const track = NEW.buildTrack(placeU)
const a7U = placeU[6]

function emptyState() {
  const c = () => new THREE.Color()
  const v = () => new THREE.Vector3()
  return {
    u: 0, stop: 0, blend: 0, sunDir: v(), moonDir: v(), moonLightDir: v(), sunEl: 0,
    sunColor: c(), sunHero: 0, sunIntensity: 0, sunGlow: c(), moonColor: c(), moonIntensity: 0, moonVis: 0,
    rimColor: c(), rimIntensity: 0, skyTop: c(), skyMid: c(), skyHorizon: c(), skyGlow: c(),
    haze: c(), fogNear: 0, fogFar: 0, hemiSky: c(), hemiGround: c(), hemiIntensity: 0,
    ambient: c(), ambientIntensity: 0, exposure: 1, stars: 0, cloudTop: c(), cloudBase: c(), water: c(),
    lampGlow: 1, magicGlow: 1, aurora: 0, band: 0, night: 0, moonRadius: 0, rev: 0, under: 0,
    morning: 0, mist: 0, mistDepth: 1, mistNear: 0, mistFar: 1, mistColor: c(),
    nearShade: c(), halo: c(), hazeBase: 0, hazeFall: 1, hazeOn: 0, sunLobe: 0, fogCap: 0.92,
    liftR: 0, liftG: 0, liftB: 0, gainR: 1, gainG: 1, gainB: 1, gamma: 1, sat: 1, haloAmt: 0, haloDeg: 0, haloHalf: 1, haloFog: 0, fogAdd: 0,
  }
}
const MORNING_ONLY = ['morning', 'mist', 'mistDepth', 'mistNear', 'mistFar', 'mistColor']
/** The fields light.ts at d0ebe76 had (as night-clock.test.mjs), and the ones the night had at eab2330. */
const OLD_FIELDS = Object.keys(emptyState()).filter((k) => !['aurora', 'band', 'night', 'rev', 'moonRadius', ...MORNING_ONLY].includes(k))
const NIGHT_FIELDS = Object.keys(emptyState()).filter((k) => !['rev', ...MORNING_ONLY].includes(k))
const f64 = new Float64Array(1)
const bits = (x) => {
  f64[0] = x
  return new BigUint64Array(f64.buffer)[0]
}
function diff(a, b, fields) {
  for (const k of fields) {
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

console.log('\nBy day on the clock (10:00 to 20:00), the light is the old light, bit for bit, with no morning in it')
{
  // Every minute of the day window gives the look (0, 0): one track laid that way.
  const looks = new Set()
  for (let m = 600; m < 1200; m++) {
    const l = C.lookAt(m / 60)
    looks.add(`${l.night}/${l.morning}`)
  }
  ok(looks.size === 1 && looks.has('0/0'), 'every minute from 10:00 to 20:00 lays the same look, night 0 and morning 0', [...looks].join(' '))
  NEW.setTrackClock(track, 0, 0)
  ok(track.every((t) => t.key === t.day), 'at (0, 0) every stop blends its own authored key (the same object)')
  const a = emptyState()
  const b = emptyState()
  let first = null
  let noMorning = true
  for (const u of us) {
    OLD.blendTrack(u, oldTrack, placeU, a)
    NEW.blendTrack(u, track, placeU, b)
    const d = diff(a, b, OLD_FIELDS)
    if (d) {
      first = `u ${u}: ${d}`
      break
    }
    if (b.morning !== 0 || b.mist !== 0 || b.night !== 0) noMorning = false
  }
  ok(first === null, `every field at ${us.length} points along the route is the light before the night`, first ?? 'all equal')
  ok(noMorning, 'and no morning, no mist and no night anywhere on it (the fog ramp and the grade skip their morning branches)')
}

console.log('\nThe night unchanged: the dusk and the night as they were before the morning, bit for bit')
{
  const fs_ = []
  for (let m = 0; m <= 60; m++) fs_.push(C.nightAt(20 + m / 60))
  fs_.push(0.05, 0.34, 0.82, 1)
  const a = emptyState()
  const b = emptyState()
  let first = null
  let n = 0
  for (const f of fs_) {
    NIGHTLY.setTrackNight(nightTrack, f)
    NEW.setTrackClock(track, f, 0)
    for (const u of us) {
      NIGHTLY.blendTrack(u, nightTrack, placeU, a)
      NEW.blendTrack(u, track, placeU, b)
      n++
      const d = diff(a, b, NIGHT_FIELDS)
      if (d || b.morning !== 0) {
        first = `f ${f}, u ${u}: ${d ?? `morning ${b.morning}`}`
        break
      }
    }
    if (first) break
  }
  ok(first === null, `every field at ${us.length} points at each of ${fs_.length} night factors (every minute of the dusk, 0.05, 0.34, 0.82, 1): ${n} blends`, first ?? 'all equal')
  // 05:00: the morning comes in under the full night, and the light is the night.
  NIGHTLY.setTrackNight(nightTrack, 1)
  const l5 = C.lookAt(5)
  NEW.setTrackClock(track, l5.night, l5.morning)
  ok(track.every((t) => t.key === t.night), '05:00 (the night 1, the morning 1 under it): every stop blends its night key')
  first = null
  for (const u of us) {
    NIGHTLY.blendTrack(u, nightTrack, placeU, a)
    NEW.blendTrack(u, track, placeU, b)
    const d = diff(a, b, NIGHT_FIELDS)
    if (d || b.morning !== 0) {
      first = `u ${u}: ${d ?? `morning ${b.morning}`}`
      break
    }
  }
  ok(first === null, '05:00 is the full night as it was, at every point', first ?? 'all equal')
}

console.log('\nThe morning (07:30): the opening and the first six places')
{
  const l = C.lookAt(7.5)
  NEW.setTrackClock(track, l.night, l.morning)
  const b = emptyState()
  const day = emptyState()
  const names = ['opening', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6']
  const stopsU = [0, ...placeU.slice(0, 6)]
  const k0 = track.find((t) => t.u === 0)
  ok(!!k0 && k0.src.light === 'opening-gold' && k0.mDial === 1, "the opening's stop has its morning (opening-gold, dial 1)")
  for (let i = 0; i < stopsU.length; i++) {
    const u = stopsU[i]
    OLD.blendTrack(u, oldTrack, placeU, day)
    NEW.blendTrack(u, track, placeU, b)
    const az = (d) => ((Math.atan2(d.x, -d.z) * 180) / Math.PI + 360) % 360
    ok(b.morning === 1 && b.night === 0, `${names[i]}: the morning 1, no night`, `${b.morning} / ${b.night}`)
    ok(b.stars === 0 && b.aurora === 0 && b.band === 0 && b.moonVis === 0 && b.moonIntensity === 0, `${names[i]}: no star, no aurora, no Milky Way, no moon`)
    ok(bits(b.sunEl) === bits(day.sunEl) && Math.abs(az(b.sunDir) - az(day.sunDir)) < 1e-9, `${names[i]}: the place's own sun (az ${az(day.sunDir).toFixed(1)}, el ${day.sunEl})`)
    ok(bits(b.fogNear) === bits(day.fogNear) && bits(b.fogFar) === bits(day.fogFar), `${names[i]}: the day's fog ramp, so the same far plane (${day.fogNear} to ${day.fogFar})`)
    ok(b.lampGlow < day.lampGlow && b.lampGlow <= 0.15, `${names[i]}: the lamps down (${day.lampGlow} by day, ${b.lampGlow.toFixed(2)})`)
    // At most 0.95 of a pixel (the haze's second round made the banks dense, 0.5 to 0.95 at the places): the ground always shows through.
    ok(b.mist > 0 && b.mist <= 0.95 && b.mistDepth > 0 && b.mistFar > b.mistNear, `${names[i]}: the mist on (${b.mist.toFixed(2)}, ${b.mistDepth} deep, ${b.mistNear} to ${b.mistFar})`)
    ok(b.skyTop.b > b.skyTop.r && b.haze.b - b.haze.r > day.haze.b - day.haze.r, `${names[i]}: a blue top and a cooler haze than the day's`)
  }
}

console.log('\nThe morning from Creative Strategy on is the old light, bit for bit')
{
  ok(track.every((t) => (t.u >= a7U - 1e-12 ? t.key === t.day && t.mDial === 0 : true)), 'no stop from Creative Strategy on has a morning of its own')
  const a = emptyState()
  const b = emptyState()
  let first = null
  let n = 0
  for (const u of us) {
    if (u < a7U) continue
    n++
    OLD.blendTrack(u, oldTrack, placeU, a)
    NEW.blendTrack(u, track, placeU, b)
    const d = diff(a, b, OLD_FIELDS)
    if (d || b.morning !== 0) {
      first = `u ${u}: ${d ?? `morning ${b.morning}`}`
      break
    }
  }
  ok(first === null && n > 1000, `every field at the ${n} points from a7 to the route's end`, first ?? 'all equal')
  NEW.blendTrack((placeU[5] + a7U) / 2, track, placeU, b)
  ok(b.morning > 0 && b.morning < 1, "halfway from the forest to the island the morning fades into the island's own night", b.morning.toFixed(3))
}

console.log('\nThe dawn (05:00 to 06:00) and the fade into the day (09:00 to 10:00)')
{
  const b = emptyState()
  const mo = emptyState()
  const ni = emptyState()
  const u1 = placeU[0]
  NEW.setTrackClock(track, 0, 1)
  NEW.blendTrack(u1, track, placeU, mo)
  NEW.setTrackClock(track, 1, 1)
  NEW.blendTrack(u1, track, placeU, ni)
  let mono = true
  let lastNight = 2
  let worstShare = 0
  for (let s = 0; s <= 3600; s += 60) {
    const l = C.lookAt(5 + s / 3600)
    NEW.setTrackClock(track, l.night, l.morning)
    NEW.blendTrack(u1, track, placeU, b)
    if (b.night > lastNight + 1e-12) mono = false
    lastNight = b.night
    // The morning's share is what the night leaves of it.
    worstShare = Math.max(worstShare, Math.abs(b.morning - (1 - NEW.nightWeight(l.night))))
  }
  ok(mono, 'at the Landing the night only goes out, minute by minute')
  ok(worstShare < 1e-12, "the morning's share is what the night leaves (1 - nightWeight): the dawn is a crossfade of the two, no day in it", worstShare.toExponential(2))
  const l530 = C.lookAt(5.5)
  NEW.setTrackClock(track, l530.night, l530.morning)
  NEW.blendTrack(u1, track, placeU, b)
  ok(near(b.night, NEW.nightWeight(0.5)) && near(b.morning, 1 - NEW.nightWeight(0.5)), "05:30: the night's weight at a half (82%) over the morning", `${b.night.toFixed(3)} / ${b.morning.toFixed(3)}`)
  ok(near(b.exposure, mo.exposure + (ni.exposure - mo.exposure) * NEW.nightWeight(0.5), 1e-9), '05:30: every value between the morning and the night by that weight (the exposure)', `${b.exposure.toFixed(4)}`)
  const l930 = C.lookAt(9.5)
  NEW.setTrackClock(track, l930.night, l930.morning)
  NEW.blendTrack(u1, track, placeU, b)
  const dy = emptyState()
  OLD.blendTrack(u1, oldTrack, placeU, dy)
  ok(near(b.morning, 0.5) && b.night === 0 && near(b.lampGlow, (dy.lampGlow + mo.lampGlow) / 2, 1e-9), '09:30: halfway from the morning to the day (the lamps between the two)', `${b.morning} / ${b.lampGlow.toFixed(3)}`)
  ok(NEW.morningWeight(0.25) === 0.25 && NEW.morningWeight(-1) === 0 && NEW.morningWeight(2) === 1 && NEW.morningWeight(NaN) === 0, 'the morning blends straight (the morning and the day are both lit)')
  NEW.setTrackClock(track, 0, 0.5)
  const k1 = track.find((t) => t.u === u1).key
  NEW.setTrackClock(track, 0, 0.6)
  const k2 = track.find((t) => t.u === u1).key
  NEW.setTrackClock(track, 0.5, 1)
  const k3 = track.find((t) => t.u === u1).key
  NEW.setTrackClock(track, 0.6, 1)
  const k4 = track.find((t) => t.u === u1).key
  ok(k1 === k2 && k3 === k4 && k1 !== track.find((t) => t.u === u1).day, 'laying the clock again writes into the same keys (nothing allocated per step of the ease)')
}

console.log('\nThe rows')
for (const name of Object.keys(NEW.NIGHT_ROWS)) {
  const row = NEW.MORNING_ROWS[name]
  ok(!!row && row.dial > 0 && row.dial <= 1, `${name}: a morning row beside its night row (dial ${row?.dial})`)
}
ok(Object.keys(NEW.MORNING_ROWS).every((k) => k in NEW.NIGHT_ROWS), 'and no morning where there is no night (Creative Strategy keeps its night, the arch its sunrise)')
ok(NEW.MORNING_LAMP_TINT[2] > NEW.MORNING_LAMP_TINT[0] && NEW.MORNING_LAMP_TINT.every((v) => v > 0 && v <= 1), 'the lamps toward unlit glass: cooler and darker', NEW.MORNING_LAMP_TINT.join(' '))
ok(NEW.MORNING_DEW.mul[1] > 1 && NEW.MORNING_DEW.mul[0] < 1, 'the dew: what is green a touch brighter and cooler', NEW.MORNING_DEW.mul.join(' '))
ok(/if \( fwMist\.a > 0\.0 \)/.test(NEW.FW_FOG_GLSL.fragment), "the fog ramp's mist sits behind its own test (skipped by day and at night)")

NEW.setTrackClock(track, 0, 0)
console.log(`\n${pass} passed, ${fails.length} failed`)
if (fails.length) {
  console.log(fails.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
