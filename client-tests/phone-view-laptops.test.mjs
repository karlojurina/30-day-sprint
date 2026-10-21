// Short laptop windows keep the 3D map (the 2026-10-20 review of phones-1).
//
// phones-1 gave a screen under 500 px tall the phone's list, for a phone held
// sideways (304 to 430 px tall). The rule did not ask what the screen is, so
// everyday laptop windows lost a 3D map that works at their size: a 1366x768
// laptop at 125% scaling with Chrome maximised is about 1093x490 inside (about
// 465 with the bookmarks bar), a 1080p laptop at 175% about 1097x470, a
// 1366x768 laptop zoomed to 150% in the browser about 911x435. The verifiers
// had measured the 3D working at 1024x450 (Continue made the trip) and 800x450.
// A window near the line also flipped between the 3D and the list as a
// browser bar or devtools came and went, rebuilding the 3D each time.
//
// Since the fix the height applies to touch screens only: NARROW_QUERY is
// "(width < 760px), (height < 500px) and (pointer: coarse)", its two
// stylesheet twins say the same, and the landing poster's stylesheet rule
// (.posterLanding, a <source> until 2026-10-21) is its exact complement. This
// test asks the four (read from the source, media-query.mjs)
// about those windows with a mouse and with a finger.
//
//   node --experimental-strip-types client-tests/phone-view-laptops.test.mjs
import { POINTERS, matches, phoneQueries } from './media-query.mjs'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

const { narrow, landing, posterHide, uiPhone } = phoneQueries()
ok(narrow !== null && landing !== null && posterHide !== null && uiPhone !== null, 'the four are in the source', show({ narrow, landing, posterHide, uiPhone }))

// The review's laptop windows (CSS px inside the browser), and the two the verifiers measured.
const LAPTOPS = [
  [1093, 490, 'a 1366x768 laptop at 125%, Chrome maximised'],
  [1093, 465, 'the same with the bookmarks bar'],
  [1097, 499, 'a 1080p laptop at 175%, the tallest of its range'],
  [1097, 470, 'a 1080p laptop at 175%'],
  [911, 435, 'a 1366x768 laptop zoomed to 150% in the browser'],
  [1024, 450, 'where the verifiers measured Continue making the trip'],
  [800, 450, 'where the verifiers measured no overlap'],
]
// Phones held sideways, and a small tablet's short screen, with a finger.
const TOUCH = [
  [844, 390, 'iPhone 14, sideways'],
  [852, 343, 'iPhone 15, sideways, in Safari'],
  [780, 304, 'Android Chrome, sideways'],
  [932, 430, 'iPhone Pro Max, sideways'],
  [962, 480, 'an 8" Android tablet, sideways, under its browser bars'],
]

if (narrow && landing && posterHide && uiPhone) {
  console.log('\nWith a mouse, the laptop windows keep the 3D')
  for (const [width, height, name] of LAPTOPS) {
    ok(!matches(narrow, { width, height, pointer: 'fine' }), `${width}x${height}, ${name}: the 3D`, `matchMedia(${show(narrow)})`)
  }

  console.log('\nThe same windows on a touch screen get the list, as phones held sideways do')
  for (const [width, height, name] of [...LAPTOPS.map(([w, h]) => [w, h, 'a touch screen of this size']), ...TOUCH]) {
    ok(matches(narrow, { width, height, pointer: 'coarse' }), `${width}x${height}, ${name}: the list`)
  }

  console.log('\nA mouse window never changes view on its height alone')
  const flips = []
  for (let height = 200; height <= 1400; height++) {
    if (matches(narrow, { width: 1100, height, pointer: 'fine' })) flips.push(height)
  }
  ok(flips.length === 0, 'at 1100 px wide, every height from 200 to 1400 px: the 3D (a browser bar or devtools opening no longer swaps it for the list)', flips.length ? `the list at ${flips.slice(0, 5).join(', ')}...` : '1201 heights')
  ok(matches(narrow, { width: 759, height: 900, pointer: 'fine' }) && !matches(narrow, { width: 760, height: 900, pointer: 'fine' }), 'the width line is unchanged for a mouse: 759 the list, 760 the 3D')

  console.log('\nThe twins agree with NARROW_QUERY for every pointer')
  const sizes = [...LAPTOPS, ...TOUCH].map(([w, h]) => [w, h]).concat([[759, 900], [760, 900], [1200, 499], [1200, 500], [759, 499], [760, 500], [760, 499]])
  const off = { posterHide: [], uiPhone: [], landing: [] }
  for (const pointer of POINTERS) {
    for (const [width, height] of sizes) {
      const screen = { width, height, pointer }
      const phone = matches(narrow, screen)
      if (matches(posterHide, screen) !== phone) off.posterHide.push(`${width}x${height} ${pointer}`)
      if (matches(uiPhone, screen) !== phone) off.uiPhone.push(`${width}x${height} ${pointer}`)
      if (matches(landing, screen) === phone) off.landing.push(`${width}x${height} ${pointer}`)
    }
  }
  const n = sizes.length * POINTERS.length
  ok(off.posterHide.length === 0, 'world.module.css hides the poster layer exactly where the list shows', off.posterHide.length ? `differs at ${off.posterHide.join(', ')}` : `${n} screens`)
  ok(off.uiPhone.length === 0, 'world-ui.module.css gives the screens over the map their phone look exactly where the list shows', off.uiPhone.length ? `differs at ${off.uiPhone.join(', ')}` : `${n} screens`)
  ok(off.landing.length === 0, "the landing poster's stylesheet rule (.posterLanding) loads the still exactly where the 3D draws", off.landing.length ? `differs at ${off.landing.join(', ')}` : `${n} screens`)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
