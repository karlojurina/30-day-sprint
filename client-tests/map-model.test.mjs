import { buildWorldCatalog } from './_gen/catalog.ts'
import { buildMapModel, MAP_PLACES } from './_gen/map-model.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

// The staging seed's shape (supabase/migrations/2026_v94_catalog_next_staging.sql):
// 8 areas, 8/10/22/22/25/22/22/14 rows, a7l22 a non-counting setup row, nine
// action items in areas 3 to 5, no durations and no videos.
const NAMES = ['Introduction', 'Fundamentals', 'Video Ads I', 'Video Ads II', 'Static Ads', 'AI Ads & Content', 'Creative Strategy', 'Job Board']
const COUNTS = [8, 10, 22, 22, 25, 22, 22, 14]
const ACTIONS = new Set(['a3l07', 'a3l14', 'a3l21', 'a4l07', 'a4l14', 'a4l21', 'a5l08', 'a5l16', 'a5l24'])
const pad = (n) => String(n).padStart(2, '0')
const idOf = (k, n) => `a${k + 1}l${pad(n)}`

function seed(over = {}) {
  const regions = NAMES.map((name, k) => ({ id: `a${k + 1}`, order_num: k + 1, name }))
  const lessons = []
  let sort = 0
  for (let k = 0; k < 8; k++) {
    for (let n = 1; n <= COUNTS[k]; n++) {
      const id = idOf(k, n)
      const pond = id === 'a7l22'
      lessons.push({
        id, region_id: `a${k + 1}`, sort_order: ++sort,
        type: pond ? 'setup' : 'watch',
        title: pond ? 'Ad Bounty · get access' : `${NAMES[k]} · lesson ${n}`,
        description: null,
        requires_action: ACTIONS.has(id), action_brief: ACTIONS.has(id) ? 'Placeholder brief' : null,
        is_optional: false, is_gate: id === 'a5l25',
        counts_toward_progress: !pond, feature_key: pond ? 'bounty_access' : null,
        has_video: false, duration_seconds: null,
        ...(over[id] ?? {}),
      })
    }
  }
  return { regions, lessons }
}

/** The real path: the catalog boundary first, then the adapter, exactly as the host does it. */
function model(done, over = {}, pick = (x) => x) {
  const { regions, lessons } = pick(seed(over))
  const completedLessonIds = new Set(done)
  const c = buildWorldCatalog({ lessons, regions, completedLessonIds, watchProgress: new Map() })
  return buildMapModel({ areas: c.areas, lessonsByArea: c.lessonsByArea, completedLessonIds })
}
const range = (k, from, to) => Array.from({ length: to - from + 1 }, (_, i) => idOf(k, from + i))
const all = (k) => range(k, 1, k === 6 ? 21 : COUNTS[k])

console.log('\n=== the staging seed, a new student ===')
{
  const m = model([])
  ok(m.ok === true, 'eight areas is a map', JSON.stringify(m.ok))
  ok(m.areas.length === MAP_PLACES && MAP_PLACES === 8, 'eight places')
  ok(JSON.stringify(m.areas.map((a) => a.lessons.length)) === '[8,10,22,22,25,22,21,14]',
     'counting lessons per area: the pond is not one of them', JSON.stringify(m.areas.map((a) => a.lessons.length)))
  ok(m.total === 144 && m.doneTotal === 0, 'totals count lessons only', `${m.doneTotal}/${m.total}`)
  ok(m.areas[6].features.length === 1 && m.areas[6].features[0].id === 'a7l22' && m.areas[6].features[0].key === 'bounty_access',
     'the Ad Bounty row is area 7\'s feature')
  ok(m.areas.every((a, k) => k === 6 || a.features.length === 0), 'no other area has a feature')
  ok(m.place === 0 && m.placeNext === 0, 'a new student is at place 1, lesson 1', `place=${m.place} next=${m.placeNext}`)
  ok(JSON.stringify(m.areas.map((a) => a.name)) === JSON.stringify(NAMES), 'area names come from the catalog, in route order')
  ok(m.areas[2].lessons.filter((l) => l.action).length === 3 && m.areas[0].lessons.every((l) => !l.action),
     'action items come from requires_action')
}

console.log('\n=== where the student is ===')
{
  const mid = model([...all(0), ...all(1), ...all(2), ...range(3, 1, 18)])
  ok(mid.place === 3 && mid.placeNext === 18, 'mid course: place 4, next is lesson 19', `place=${mid.place} next=${mid.placeNext}`)
  ok(mid.areas[3].done === 18 && mid.doneTotal === 58, '18 of 22 there, 58 in all', `${mid.areas[3].done} / ${mid.doneTotal}`)

  // Watched out of order: area 1 done, area 2 has lessons 1, 2, 3 and 7.
  const ooo = model([...all(0), 'a2l01', 'a2l02', 'a2l03', 'a2l07'])
  ok(ooo.place === 1 && ooo.areas[1].done === 4, 'out of order: the count is the truth', `done=${ooo.areas[1].done}`)
  ok(ooo.placeNext === 3, 'out of order: next is the first lesson not done (lesson 4)', `next=${ooo.placeNext}`)
  ok(ooo.areas[1].lessons[6].done && !ooo.areas[1].lessons[3].done, 'each row keeps its own state')

  // A later area touched while an earlier one is unfinished does not move the place.
  const ahead = model([...range(0, 1, 3), 'a4l01'])
  ok(ahead.place === 0 && ahead.placeNext === 3, 'a lesson watched ahead does not move the student\'s place', `place=${ahead.place}`)

  const done = model(NAMES.flatMap((_, k) => all(k)))
  ok(done.place === MAP_PLACES && done.placeNext === -1, 'everything done: place 8, no next lesson', `place=${done.place} next=${done.placeNext}`)
  ok(done.doneTotal === 144 && done.total === 144, '144 of 144')
}

console.log('\n=== a lesson that does not count never changes a total ===')
{
  const without = model(all(6))
  const withPond = model([...all(6), 'a7l22'])
  ok(without.areas[6].done === 21 && withPond.areas[6].done === 21, 'area 7 is 21 of 21 with or without the pond done')
  ok(withPond.doneTotal === without.doneTotal && withPond.total === without.total, 'course totals unchanged')
  ok(withPond.areas[6].features[0].done === true && without.areas[6].features[0].done === false, 'the feature row still knows it is done')
  const onlyPond = model(['a7l22'])
  ok(onlyPond.place === 0 && onlyPond.doneTotal === 0, 'the pond alone is not progress')
}

console.log('\n=== minutes and videos ===')
{
  const m = model([], {
    a1l01: { duration_seconds: 753, has_video: true },
    a1l02: { duration_seconds: 20 },
    a1l03: { duration_seconds: 0 },
    a1l04: { duration_seconds: 89, has_video: true, type: 'setup' },
  })
  const L = m.areas[0].lessons
  ok(L[0].minutes === 13, '753 s is 13 minutes', String(L[0].minutes))
  ok(L[1].minutes === 1, 'never under 1 minute', String(L[1].minutes))
  ok(L[2].minutes === null && L[4].minutes === null, 'no duration means no minutes, not a guess')
  ok(L[3].minutes === 1, '89 s rounds to 1', String(L[3].minutes))
  ok(L[0].hasVideo === true, 'a watch lesson with has_video has a video')
  ok(L[1].hasVideo === false, 'a duration alone is not a video')
  ok(L[3].hasVideo === false, 'has_video on a non-watch lesson is not playable')
}

console.log('\n=== catalogs the map cannot draw ===')
{
  const four = model([], {}, ({ regions, lessons }) => ({
    regions: regions.slice(0, 4), lessons: lessons.filter((l) => ['a1', 'a2', 'a3', 'a4'].includes(l.region_id)),
  }))
  ok(four.ok === false && four.reason === 'shape', 'four areas (the live catalog today) is refused', JSON.stringify(four))
  const nine = model([], {}, ({ regions, lessons }) => ({
    regions: [...regions, { id: 'a9', order_num: 9, name: 'Nine' }],
    lessons: [...lessons, { ...lessons[0], id: 'a9l01', region_id: 'a9', sort_order: 999 }],
  }))
  ok(nine.ok === false && nine.reason === 'shape', 'nine areas is refused')
  const none = model([], {}, () => ({ regions: [], lessons: [] }))
  ok(none.ok === false && none.reason === 'empty', 'no catalog at all is empty, not a shape error', JSON.stringify(none))
  const noLessons = model([], {}, ({ regions }) => ({ regions, lessons: [] }))
  ok(noLessons.ok === false && noLessons.reason === 'empty', 'eight areas with no lessons is empty')
}

console.log('\n=== an area with nothing to do never holds the student ===')
{
  // Area 2 loses every counting lesson: the student goes from place 1 straight to place 3.
  const m = model(all(0), {}, ({ regions, lessons }) => ({ regions, lessons: lessons.filter((l) => l.region_id !== 'a2') }))
  ok(m.ok === true && m.areas[1].lessons.length === 0, 'the empty area is still one of the eight')
  ok(m.place === 2 && m.placeNext === 0, 'and the place skips it', `place=${m.place}`)
}

console.log(`\n============================================================\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1) }
