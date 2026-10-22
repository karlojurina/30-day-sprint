// The map's loading posters on the student's clock (2026-10-21, the night
// posters, and later the same day the morning posters; options D and B of
// _admin/prds/map-review-2026-10-15/real_time_light.md).
//
// 1. The page head's script (clock.ts CLOCK_BOOT), run the way a page runs it:
//    its exact text, in a fresh context with a stand-in Date, location and
//    document.
//    - the pick at 12:00, 20:30, 23:00, 05:30, 05:40, 07:30, 09:15 and 09:45
//      on /world;
//    - the same answer as clockSetting, lookFor and posterTod at every
//      minute of the day (1,440), on /world, under it, on a dev page, and on
//      a dev page whose address asks for the clock, night, morning, day or an
//      hour, and second by second round each of its three crossings;
//    - its numbers are clock.ts's (the JSON it carries, never a copy);
//    - the root layout puts it in the head.
// 2. The files: by day posterSrc gives the file it always gave; the night
//    and the morning twins are the opening's and the first six places' and
//    nothing else; the manifest's night and morning blocks list them at their
//    real sizes; the day posters are byte for byte the ones at BASE (git
//    show), so by day the page shows exactly what it showed.
// 3. The stylesheets: the night and morning rules name posterSrc(id, tod)'s
//    files under POSTER_TOD_ATTR; the three blurred 48 px stills are 48 x 27
//    webp files.
//
//   node client-tests/build.mjs && node --experimental-strip-types client-tests/night-posters.test.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
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

// The night branch's head before the night posters: the day posters as they were.
const BASE = 'f0fb483'
// The night branch's head before the morning: the night posters as they were.
const NIGHT_HEAD = 'eab2330'
const repo = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8')

const C = await import('./_gen/clock.ts')
const P = await import('./_gen/poster.ts')

// ── 1. The head's script ────────────────────────────────────────────────────

/** Runs the head's script on `href` with the clock at `ms`; returns what it wrote on <html> (null: nothing). */
function boot(href, ms, script = C.CLOCK_BOOT) {
  const u = new URL(href, 'https://app.example')
  const attrs = new Map()
  class StandIn extends Date {
    constructor(...a) {
      if (a.length) super(...a)
      else super(ms)
    }
    static now() {
      return ms
    }
  }
  const document = {
    documentElement: {
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    },
  }
  vm.runInNewContext(script, { location: { search: u.search, pathname: u.pathname }, document, URLSearchParams, Date: StandIn })
  return attrs.has(C.POSTER_TOD_ATTR) ? attrs.get(C.POSTER_TOD_ATTR) : null
}
/** What clock.ts says for the same page and time. */
function want(href, ms) {
  const u = new URL(href, 'https://app.example')
  const live = u.pathname === C.CLOCK_LIVE_BASE || u.pathname.startsWith(C.CLOCK_LIVE_BASE + '/')
  return C.posterTod(C.lookFor(C.clockSetting(u.search, live), new Date(ms)))
}
// A day with no clock change anywhere near it (Europe's is the 25th, America's 1 November).
const at = (h, m = 0, s = 0) => new Date(2026, 9, 21, h, m, s).getTime()

console.log("\nThe head's script picks the posters by the student's clock (/world)")
for (const [h, m, w] of [[12, 0, 'day'], [20, 30, 'night'], [23, 0, 'night'], [5, 30, 'night'], [5, 40, 'morning'], [7, 30, 'morning'], [9, 15, 'morning'], [9, 45, 'day']]) {
  const hh = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  const got = boot('/world', at(h, m))
  const l = C.lookAt(h + m / 60)
  ok(got === w, `at ${hh} the ${w} posters`, `${got}; the night factor ${l.night.toFixed(3)}, the morning ${l.morning.toFixed(3)}`)
}
ok(C.nightAt(20.5) === 0.5 && C.nightAt(5.5) === 0.5 && C.posterTod({ night: 0.5, morning: 0 }) === 'night' && C.posterTod({ night: 0.5, morning: 1 }) === 'night', "20:30 and 05:30 are halfway through the night's fades (0.5), where the live map's light is 82% night: the night poster is the nearer, over the day and over the morning")
ok(C.POSTER_NIGHT_FROM === C.POSTER_FROM.night && C.POSTER_FROM.night > 0 && C.POSTER_FROM.night < 0.5 && C.POSTER_FROM.dawn > 0 && C.POSTER_FROM.dawn < 0.5, `the night posters from a night factor of ${C.POSTER_FROM.night} over the day and ${C.POSTER_FROM.dawn} over the morning (the opening's measured crossings)`)
ok(C.POSTER_FROM.morning > 0.3 && C.POSTER_FROM.morning < 0.6 && C.posterTod({ night: 0, morning: C.POSTER_FROM.morning }) === 'morning' && C.posterTod({ night: 0, morning: C.POSTER_FROM.morning - 0.01 }) === 'day', `the morning posters from a morning factor of ${C.POSTER_FROM.morning} (the opening's measured crossing)`)
ok(C.posterTod({ night: 0, morning: 0 }) === 'day' && C.posterTod({ night: 0, morning: 1 }) === 'morning' && C.posterTod({ night: 1, morning: 0 }) === 'night' && C.posterTod({ night: 1, morning: 1 }) === 'night', 'the day, the morning and the night, and the night over the morning, each its own set')

console.log('\nThe script and clock.ts agree at every minute of the day')
const PAGES = [
  ['/world', "the students' map"],
  ['/world/a3/a3l07', 'a lesson open over it'],
  ['/dev/world-app?catalog=course', 'a dev page (pinned to day)'],
  ['/dev/world-app?catalog=course&tod=clock', 'a dev page asking for the clock'],
  ['/dev/world-v6?tod=night', '?tod=night'],
  ['/dev/world-v6?tod=morning', '?tod=morning'],
  ['/world?tod=morning&hour=23', '/world with ?tod=morning and ?hour=23 (?tod wins)'],
  ['/world?tod=day', '/world with ?tod=day'],
  ['/dev/world-app?hour=20.30', '?hour=20.30'],
  ['/dev/world-app?hour=20.20', '?hour=20.20'],
  ['/dev/world-app?hour=07.30', '?hour=07.30'],
  ['/dev/world-app?hour=09.30', '?hour=09.30'],
  ['/dev/world-app?hour=05.35', '?hour=05.35'],
  ['/world?hour=99', 'an hour that does not parse (/world: the clock)'],
  ['/dev/world-app?tod=dusk&hour=23', 'an unknown ?tod, then ?hour'],
  ['/worldwide', 'a page that only starts with /world (pinned)'],
]
const crossing = { dusk: null, dawn: null, mornFrom: null, mornTo: null }
for (const [href, name] of PAGES) {
  let off = []
  const count = { day: 0, morning: 0, night: 0 }
  for (let m = 0; m < 1440; m++) {
    const ms = at(0, m)
    const got = boot(href, ms)
    const w = want(href, ms)
    if (got !== w) off.push(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} ${got} vs ${w}`)
    count[got] = (count[got] ?? 0) + 1
    if (href === '/world' && got === 'night') {
      if (m >= 12 * 60 && crossing.dusk === null) crossing.dusk = m
      if (m < 12 * 60) crossing.dawn = m
    }
    if (href === '/world' && got === 'morning') {
      if (crossing.mornFrom === null) crossing.mornFrom = m
      crossing.mornTo = m
    }
  }
  ok(off.length === 0, `${name} (${href}): 1,440 minutes, ${count.night} at night, ${count.morning} in the morning`, off.slice(0, 4).join(', '))
}
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
// The dawn's line (0.36 since the morning's tune pass; 0.38 before) puts the switch at 05:35:41.
ok(crossing.dusk === 20 * 60 + 24 && crossing.dawn === 5 * 60 + 35, `on /world the night posters from the minute ${hm(crossing.dusk)} to ${hm(crossing.dawn)}`)
// The morning's line (0.54 since the morning haze; 0.47 before) puts the day's posters back at 09:28:24 (09:31:13 before).
ok(crossing.mornFrom === 5 * 60 + 36 && crossing.mornTo === 9 * 60 + 28, `and the morning posters from the minute ${hm(crossing.mornFrom)} to ${hm(crossing.mornTo)}`)
{
  // Around each crossing, second by second (the clock reads seconds too).
  let off = []
  let seen = 0
  for (const [h0, m0] of [[20, 22], [5, 33], [9, 27]]) {
    let last = null
    for (let s = 0; s < 180; s++) {
      const ms = at(h0, m0, s)
      const got = boot('/world', ms)
      if (got !== want('/world', ms)) off.push(new Date(ms).toTimeString().slice(0, 8))
      if (last !== null && got !== last) seen++
      last = got
    }
  }
  ok(off.length === 0 && seen === 3, 'and second by second through the 3 minutes round each of the three crossings', `${seen} changes; ${off.slice(0, 4).join(', ')}`)
}
{
  const m = /\}\)\((.*)\)$/s.exec(C.CLOCK_BOOT)
  const args = m ? m[1].slice(m[1].lastIndexOf(',{') + 1) : 'null'
  let a = null
  try {
    a = JSON.parse(args)
  } catch {
    a = null
  }
  ok(!!a && a.attr === C.POSTER_TOD_ATTR && a.live === C.CLOCK_LIVE_BASE && JSON.stringify(a.from) === JSON.stringify(C.POSTER_FROM) && JSON.stringify(a.hours) === JSON.stringify(C.NIGHT_HOURS) && JSON.stringify(a.morning) === JSON.stringify(C.MORNING_HOURS), "its numbers are clock.ts's own, carried as JSON", args)
  ok(['function nightAtHours(', 'function morningAtHours(', 'function parseHour(', 'function hourOf(', 'function pickPosterTod('].every((f) => C.CLOCK_BOOT.includes(f)), "its hours, its hour reading and its pick are clock.ts's functions, as their source")
  ok(C.CLOCK_BOOT.length < 3200, `small: ${C.CLOCK_BOOT.length} characters as the tests copy it (types blanked out)`)
}
{
  // A browser where it fails (here: no URLSearchParams) writes nothing and throws nothing: the stylesheets' default, the day.
  const attrs = new Map()
  let threw = false
  try {
    vm.runInNewContext(C.CLOCK_BOOT, { location: { search: '', pathname: '/world' }, document: { documentElement: { setAttribute: (k, v) => attrs.set(k, v) } }, Date })
  } catch {
    threw = true
  }
  ok(!threw && attrs.size === 0, 'where it fails it writes nothing and throws nothing (the stylesheets then show the day posters)')
}
{
  const layout = read('src/app/layout.tsx')
  const head = /<head>([\s\S]*?)<\/head>/.exec(layout)?.[1] ?? ''
  ok(/<script dangerouslySetInnerHTML=\{\{ __html: CLOCK_BOOT \}\} \/>/.test(head) && /from "@\/lib\/world-v6\/clock"/.test(layout), "the root layout puts it in every page's head")
}

// ── 2. The files ────────────────────────────────────────────────────────────
console.log('\nThe posters by day are the files they were; the night and the morning twins sit beside them')
const DIR = path.join(repo, 'public/world-v6/posters')
ok(P.POSTER_IDS.every((id) => P.posterSrc(id) === `/world-v6/posters/${id}.webp` && P.posterSrc(id, 'day') === P.posterSrc(id)), 'by day posterSrc gives /world-v6/posters/<id>.webp, as before', P.POSTER_IDS.join(' '))
ok(JSON.stringify(P.NIGHT_POSTER_IDS) === JSON.stringify(['k0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6']), 'the night twins: the opening and the first six places', P.NIGHT_POSTER_IDS.join(' '))
ok(JSON.stringify(P.MORNING_POSTER_IDS) === JSON.stringify(P.NIGHT_POSTER_IDS), 'the morning twins: the same seven', P.MORNING_POSTER_IDS.join(' '))
ok(['night', 'morning'].every((t) => P.posterSrc('a7', t) === P.posterSrc('a7') && P.posterSrc('a8', t) === P.posterSrc('a8')), 'Creative Strategy (night already) and the arch (its sunrise) keep one poster')
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))
const baseManifest = JSON.parse(execFileSync('git', ['show', `${BASE}:public/world-v6/posters/manifest.json`], { cwd: repo, encoding: 'utf8' }))
{
  const { night, morning, ...day } = manifest
  ok(JSON.stringify(day) === JSON.stringify(baseManifest), "the manifest's day part is the one at BASE, value for value (its markers serve the twins too)")
  ok(!!night && night.factor === 1 && Array.isArray(night.posters), 'its night block, drawn at a night factor of 1 (23:00)')
  ok(!!morning && morning.factor === 1 && morning.hour === 7.5 && Array.isArray(morning.posters), 'its morning block, drawn at 07:30 (the morning factor 1)')
  const nightAtBase = JSON.parse(execFileSync('git', ['show', `${NIGHT_HEAD}:public/world-v6/posters/manifest.json`], { cwd: repo, encoding: 'utf8' })).night
  ok(JSON.stringify(night) === JSON.stringify(nightAtBase), `the night block is the one the night posters wrote (${NIGHT_HEAD}), value for value`)
  for (const [tod, block] of [['night', night], ['morning', morning]]) {
    let total = 0
    let dayTotal = 0
    for (const id of P.NIGHT_POSTER_IDS) {
      const e = block?.posters.find((p) => p.id === id)
      const file = path.join(DIR, `${id}-${tod}.webp`)
      const bytes = fs.existsSync(file) ? fs.statSync(file).size : -1
      const twin = baseManifest.posters.find((p) => p.id === id)
      total += bytes
      dayTotal += twin.bytes
      const head = bytes > 12 ? fs.readFileSync(file).subarray(0, 12) : Buffer.alloc(0)
      const webp = head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP'
      ok(!!e && e.file === path.basename(P.posterSrc(id, tod)) && e.bytes === bytes && webp, `${id}-${tod}.webp: ${(bytes / 1024).toFixed(1)} KB, a webp (its day twin ${(twin.bytes / 1024).toFixed(1)} KB)`)
      ok(bytes <= twin.bytes * 1.15, `${id}-${tod}.webp in line with its day twin (at most 15% over)`, `${(((bytes - twin.bytes) / twin.bytes) * 100).toFixed(0)}%`)
    }
    ok(total < 1024 * 1024, `the 7 ${tod} posters together under 1 MB`, `${(total / 1024).toFixed(0)} KB (their day twins ${(dayTotal / 1024).toFixed(0)} KB)`)
    const extra = fs.readdirSync(DIR).filter((f) => f.endsWith(`-${tod}.webp`) && !P.NIGHT_POSTER_IDS.includes(f.replace(`-${tod}.webp`, '')))
    ok(extra.length === 0, `no ${tod} file for a place without a ${tod}`, extra.join(' '))
  }
  for (const id of P.NIGHT_POSTER_IDS) {
    const rel = `public/world-v6/posters/${id}-night.webp`
    const now = fs.readFileSync(path.join(repo, rel))
    const was = execFileSync('git', ['show', `${NIGHT_HEAD}:${rel}`], { cwd: repo, maxBuffer: 1 << 26 })
    ok(now.equals(was), `${id}-night.webp byte for byte the file at ${NIGHT_HEAD} (the night unchanged)`, `${now.length} bytes`)
  }
}
for (const id of P.POSTER_IDS) {
  const rel = `public/world-v6/posters/${id}.webp`
  const now = fs.readFileSync(path.join(repo, rel))
  const was = execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: repo, maxBuffer: 1 << 26 })
  ok(now.equals(was), `${id}.webp byte for byte the file at ${BASE}`, `${now.length} bytes`)
}

// ── 3. The stylesheets ──────────────────────────────────────────────────────
console.log('\nThe stylesheets show the night and the morning files under the attribute, and the day files without it')
const mapCss = read('src/components/world-v6/world.module.css')
const uiCss = read('src/components/world/world-ui.module.css')
const sel = `:global(html[${C.POSTER_TOD_ATTR}="night"])`
const selM = `:global(html[${C.POSTER_TOD_ATTR}="morning"])`
const urlOf = (css, selector) => {
  const i = css.indexOf(`${selector} {`)
  if (i < 0) return null
  const body = css.slice(i, css.indexOf('}', i))
  return /url\("([^"]+)"\)/.exec(body)?.[1] ?? null
}
ok(urlOf(uiCss, '.groundPoster') === P.posterSrc('k0') && urlOf(uiCss, `${sel} .groundPoster`) === P.posterSrc('k0', 'night') && urlOf(uiCss, `${selM} .groundPoster`) === P.posterSrc('k0', 'morning'), "the loading card's ground: the opening's day file, its night and morning files under the attribute", `${urlOf(uiCss, '.groundPoster')}, ${urlOf(uiCss, `${sel} .groundPoster`)}, ${urlOf(uiCss, `${selM} .groundPoster`)}`)
ok(urlOf(mapCss, '  .posterLanding') === P.posterSrc('k0') && urlOf(mapCss, `  ${sel} .posterLanding`) === P.posterSrc('k0', 'night') && urlOf(mapCss, `  ${selM} .posterLanding`) === P.posterSrc('k0', 'morning'), "the poster layer's landing poster: the same three files", `${urlOf(mapCss, '  .posterLanding')}, ${urlOf(mapCss, `  ${sel} .posterLanding`)}, ${urlOf(mapCss, `  ${selM} .posterLanding`)}`)
/** A data: webp's frame size (lossy VP8: the 14 bit width and height after the start code). */
function webpSize(dataUri) {
  const b = Buffer.from(dataUri.replace(/^data:image\/webp;base64,/, ''), 'base64')
  const i = b.indexOf(Buffer.from([0x9d, 0x01, 0x2a]))
  if (b.subarray(0, 4).toString('latin1') !== 'RIFF' || i < 0) return null
  return { w: b.readUInt16LE(i + 3) & 0x3fff, h: b.readUInt16LE(i + 5) & 0x3fff, bytes: b.length }
}
{
  const day = urlOf(mapCss, '.poster::before')
  const night = urlOf(mapCss, `${sel} .poster::before`)
  const morning = urlOf(mapCss, `${selM} .poster::before`)
  const d = day ? webpSize(day) : null
  const n = night ? webpSize(night) : null
  const mo = morning ? webpSize(morning) : null
  ok(!!d && d.w === 48 && d.h === 27, "the poster layer's blurred still by day: 48 x 27", JSON.stringify(d))
  ok(!!n && n.w === 48 && n.h === 27 && night !== day, 'and after dark its own, from k0-night.webp', JSON.stringify(n))
  ok(!!mo && mo.w === 48 && mo.h === 27 && morning !== day && morning !== night, 'and in the morning its own, from k0-morning.webp', JSON.stringify(mo))
}

console.log(`\n${pass} passed, ${fails.length} failed`)
if (fails.length) {
  console.log(fails.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
