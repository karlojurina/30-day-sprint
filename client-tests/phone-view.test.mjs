// A phone's size (bug hunt 2026-10-19, phones-1 and map-2): which screens get
// the map's phone list instead of the 3D, and the four places that must say the
// same thing.
//
// WorldV6.tsx chooses the list with NARROW_QUERY (matchMedia). Three twins
// repeat the rule where JavaScript cannot reach: the map's stylesheet hides
// the poster layer on a phone (world.module.css), the screens over the map
// take their phone look (world-ui.module.css), and the landing poster's
// <source> loads the opening's still only where the 3D draws. The query used
// to be width alone, so a phone held sideways (780 to 932 px wide, 304 to 430
// px tall) got the 3D layout, which was never measured below 700 px tall.
//
// This test reads the four from the source and asks each of them, through a
// small evaluator of the media features they use, about real screens: phones
// upright and sideways get the list, tablets and computers get the 3D, and
// the twins agree with the query at every size.
//
//   node --experimental-strip-types client-tests/phone-view.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

// ── The four, read from the source ──────────────────────────────────────────
const map = read('src/components/world-v6/WorldV6.tsx')
const mapCss = read('src/components/world-v6/world.module.css')
const uiCss = read('src/components/world/world-ui.module.css')

const narrow = /const NARROW_QUERY = "([^"]+)";/.exec(map)?.[1] ?? null
// The landing poster's still, for the opening (POSTER_IDS[0]): only where the 3D draws.
const source = /<source media="([^"]+)" srcSet=\{posterSrc\(id\)\} \/>/.exec(map)?.[1] ?? null
// The poster layer, hidden on a phone: the @media wrapping `.poster { display: none; }`.
const posterHide = /@media ([^{]+)\{\s*\.poster \{\s*display: none;\s*\}\s*\}/.exec(mapCss)?.[1]?.trim() ?? null
// The screens over the map, their phone look: the @media after its heading.
const uiPhone = /The phone view: solid surfaces, no blur[^\n]*\n\s*\n@media ([^{]+)\{/.exec(uiCss)?.[1]?.trim() ?? null

console.log('\nThe four are in the source')
ok(narrow !== null, 'WorldV6.tsx NARROW_QUERY', show(narrow))
ok(source !== null, "WorldV6.tsx, the landing poster's <source media>", show(source))
ok(posterHide !== null, 'world.module.css, the poster layer hidden on a phone', show(posterHide))
ok(uiPhone !== null, "world-ui.module.css, the phone's look of the screens over the map", show(uiPhone))
// Media Queries Level 4 ranges, as the rest of the map's stylesheets write them.
for (const [name, q] of [['NARROW_QUERY', narrow], ['the poster layer', posterHide], ['the screens over the map', uiPhone]]) {
  ok(q !== null && /\(width < \d+px\)/.test(q), `${name} keeps the width rule in range syntax`, show(q))
}

// ── A small evaluator: a list of queries joined by ",", each a list of
// features joined by " and ". The features these four use, and their
// level 3 spellings.
function feature(text, w, h) {
  const t = text.trim()
  let m = /^\((width|height) (<|<=|>|>=) (\d+(?:\.\d+)?)px\)$/.exec(t)
  if (m) {
    const v = m[1] === 'width' ? w : h
    const n = Number(m[3])
    return m[2] === '<' ? v < n : m[2] === '<=' ? v <= n : m[2] === '>' ? v > n : v >= n
  }
  m = /^\((min|max)-(width|height): (\d+(?:\.\d+)?)px\)$/.exec(t)
  if (m) {
    const v = m[2] === 'width' ? w : h
    const n = Number(m[3])
    return m[1] === 'min' ? v >= n : v <= n
  }
  throw new Error(`a media feature this test cannot read: ${t}`)
}
function matches(query, w, h) {
  return query.split(',').some((q) => q.split(/\s+and\s+/).every((f) => feature(f, w, h)))
}

// ── Real screens, CSS px ────────────────────────────────────────────────────
const PHONES = [
  // Upright.
  [320, 568, 'iPhone SE (1st), upright'],
  [360, 740, 'a 6" Android, upright'],
  [390, 844, 'iPhone 14/15, upright'],
  [430, 932, 'iPhone Pro Max, upright'],
  // Sideways: the bug hunt's sizes (Safari's bars shown and hidden, Android Chrome).
  [844, 390, 'iPhone 14, sideways, bars hidden'],
  [852, 393, 'iPhone 15, sideways, bars hidden'],
  [852, 343, 'iPhone 15, sideways, in Safari'],
  [844, 340, 'iPhone 14, sideways, in Safari'],
  [812, 375, 'iPhone X to 13 mini, sideways'],
  [915, 412, 'a 6.7" Android, sideways'],
  [932, 430, 'iPhone Pro Max, sideways, bars hidden'],
  [932, 380, 'iPhone Pro Max, sideways, in Safari'],
  [780, 304, 'Android Chrome, sideways'],
  [667, 375, 'iPhone SE (2nd), sideways'],
]
const WORLDS = [
  [768, 1024, 'iPad, upright'],
  [820, 1180, 'iPad Air, upright'],
  [1024, 768, 'iPad, sideways'],
  [1180, 820, 'iPad Air, sideways'],
  [760, 500, 'the smallest 3D window'],
  [1024, 500, 'a short laptop window'],
  [1280, 577, 'a 1280x720 laptop with its browser bars'],
  [1366, 768, 'a 1366x768 laptop'],
  [1440, 900, 'a 1440x900 laptop'],
  [1691, 1278, "Lovro's split screen"],
  [1920, 1080, 'a full HD screen'],
  [3428, 1230, "Lovro's ultrawide"],
]

if (narrow && source && posterHide && uiPhone) {
  console.log('\nPhones, upright and sideways, get the list')
  for (const [w, h, name] of PHONES) ok(matches(narrow, w, h), `${w}x${h}, ${name}: the list`, `matchMedia(${show(narrow)})`)

  console.log('\nTablets and computers get the 3D')
  for (const [w, h, name] of WORLDS) ok(!matches(narrow, w, h), `${w}x${h}, ${name}: the 3D`, `matchMedia(${show(narrow)})`)

  console.log('\nThe twins agree with NARROW_QUERY at every size (and either side of both lines)')
  const edges = [[759, 900], [760, 900], [1200, 499], [1200, 500], [759, 499], [760, 500]]
  const all = [...PHONES, ...WORLDS].map(([w, h]) => [w, h]).concat(edges)
  const off = { posterHide: [], uiPhone: [], source: [] }
  for (const [w, h] of all) {
    const phone = matches(narrow, w, h)
    if (matches(posterHide, w, h) !== phone) off.posterHide.push(`${w}x${h}`)
    if (matches(uiPhone, w, h) !== phone) off.uiPhone.push(`${w}x${h}`)
    if (matches(source, w, h) === phone) off.source.push(`${w}x${h}`)
  }
  ok(off.posterHide.length === 0, 'world.module.css hides the poster layer exactly on a phone', off.posterHide.length ? `differs at ${off.posterHide.join(', ')}` : `${all.length} sizes`)
  ok(off.uiPhone.length === 0, 'world-ui.module.css gives the screens over the map their phone look exactly on a phone', off.uiPhone.length ? `differs at ${off.uiPhone.join(', ')}` : `${all.length} sizes`)
  ok(off.source.length === 0, "the landing poster's <source> loads the still exactly where the 3D draws", off.source.length ? `differs at ${off.source.join(', ')}` : `${all.length} sizes`)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
