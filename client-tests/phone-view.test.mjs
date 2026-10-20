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
// Since the 2026-10-20 review the height applies to touch screens only
// ("(width < 760px), (height < 500px) and (pointer: coarse)"), so a short
// laptop window keeps its 3D (phone-view-laptops.test.mjs).
//
// This test reads the four from the source and asks each of them, through a
// small evaluator of the media features they use (media-query.mjs), about
// real screens with their pointer: phones upright and sideways get the list,
// tablets and computers get the 3D, and the twins agree with the query at
// every size, for a finger, a mouse and no pointer.
//
//   node --experimental-strip-types client-tests/phone-view.test.mjs
import { POINTERS, matches, phoneQueries } from './media-query.mjs'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

// ── The four, read from the source ──────────────────────────────────────────
const { narrow, source, posterHide, uiPhone } = phoneQueries()

console.log('\nThe four are in the source')
ok(narrow !== null, 'WorldV6.tsx NARROW_QUERY', show(narrow))
ok(source !== null, "WorldV6.tsx, the landing poster's <source media>", show(source))
ok(posterHide !== null, 'world.module.css, the poster layer hidden on a phone', show(posterHide))
ok(uiPhone !== null, "world-ui.module.css, the phone's look of the screens over the map", show(uiPhone))
// Media Queries Level 4 ranges, as the rest of the map's stylesheets write them.
for (const [name, q] of [['NARROW_QUERY', narrow], ['the poster layer', posterHide], ['the screens over the map', uiPhone]]) {
  ok(q !== null && /\(width < \d+px\)/.test(q), `${name} keeps the width rule in range syntax`, show(q))
}

// ── Real screens, CSS px, with their pointer ────────────────────────────────
const PHONES = [
  // Upright.
  [320, 568, 'coarse', 'iPhone SE (1st), upright'],
  [360, 740, 'coarse', 'a 6" Android, upright'],
  [390, 844, 'coarse', 'iPhone 14/15, upright'],
  [430, 932, 'coarse', 'iPhone Pro Max, upright'],
  // Sideways: the bug hunt's sizes (Safari's bars shown and hidden, Android Chrome).
  [844, 390, 'coarse', 'iPhone 14, sideways, bars hidden'],
  [852, 393, 'coarse', 'iPhone 15, sideways, bars hidden'],
  [852, 343, 'coarse', 'iPhone 15, sideways, in Safari'],
  [844, 340, 'coarse', 'iPhone 14, sideways, in Safari'],
  [812, 375, 'coarse', 'iPhone X to 13 mini, sideways'],
  [915, 412, 'coarse', 'a 6.7" Android, sideways'],
  [932, 430, 'coarse', 'iPhone Pro Max, sideways, bars hidden'],
  [932, 380, 'coarse', 'iPhone Pro Max, sideways, in Safari'],
  [780, 304, 'coarse', 'Android Chrome, sideways'],
  [667, 375, 'coarse', 'iPhone SE (2nd), sideways'],
]
const WORLDS = [
  [768, 1024, 'coarse', 'iPad, upright'],
  [820, 1180, 'coarse', 'iPad Air, upright'],
  [1024, 768, 'coarse', 'iPad, sideways'],
  [1180, 820, 'coarse', 'iPad Air, sideways'],
  [760, 500, 'coarse', 'the smallest 3D window on a touch screen'],
  [1024, 500, 'fine', 'a short laptop window'],
  [1280, 577, 'fine', 'a 1280x720 laptop with its browser bars'],
  [1366, 768, 'fine', 'a 1366x768 laptop'],
  [1440, 900, 'fine', 'a 1440x900 laptop'],
  [1691, 1278, 'fine', "Lovro's split screen"],
  [1920, 1080, 'fine', 'a full HD screen'],
  [3428, 1230, 'fine', "Lovro's ultrawide"],
]

if (narrow && source && posterHide && uiPhone) {
  console.log('\nPhones, upright and sideways, get the list')
  for (const [width, height, pointer, name] of PHONES) ok(matches(narrow, { width, height, pointer }), `${width}x${height}, ${name}: the list`, `matchMedia(${show(narrow)})`)

  console.log('\nTablets and computers get the 3D')
  for (const [width, height, pointer, name] of WORLDS) ok(!matches(narrow, { width, height, pointer }), `${width}x${height}, ${name}: the 3D`, `matchMedia(${show(narrow)})`)

  console.log('\nThe twins agree with NARROW_QUERY at every size (and either side of both lines), for every pointer')
  const edges = [[759, 900], [760, 900], [1200, 499], [1200, 500], [759, 499], [760, 500]]
  const all = [...PHONES, ...WORLDS].map(([w, h]) => [w, h]).concat(edges)
  const off = { posterHide: [], uiPhone: [], source: [] }
  for (const pointer of POINTERS) {
    for (const [width, height] of all) {
      const screen = { width, height, pointer }
      const phone = matches(narrow, screen)
      if (matches(posterHide, screen) !== phone) off.posterHide.push(`${width}x${height} ${pointer}`)
      if (matches(uiPhone, screen) !== phone) off.uiPhone.push(`${width}x${height} ${pointer}`)
      if (matches(source, screen) === phone) off.source.push(`${width}x${height} ${pointer}`)
    }
  }
  const n = all.length * POINTERS.length
  ok(off.posterHide.length === 0, 'world.module.css hides the poster layer exactly on a phone', off.posterHide.length ? `differs at ${off.posterHide.join(', ')}` : `${n} screens`)
  ok(off.uiPhone.length === 0, 'world-ui.module.css gives the screens over the map their phone look exactly on a phone', off.uiPhone.length ? `differs at ${off.uiPhone.join(', ')}` : `${n} screens`)
  ok(off.source.length === 0, "the landing poster's <source> loads the still exactly where the 3D draws", off.source.length ? `differs at ${off.source.join(', ')}` : `${n} screens`)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
