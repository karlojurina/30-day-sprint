import fs from 'node:fs'
import { buildWorldCatalog } from './_gen/catalog.ts'
import { buildMapModel, canFinishInApp, finishableIn, isPassed, MAP_PLACES } from './_gen/map-model.ts'
import { isLessonComplete } from './_gen/progress.ts'

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

/** The real path: the catalog boundary first, then the adapter, exactly as the host does it. Every done lesson's watch half is in. */
function model(done, over = {}, pick = (x) => x) {
  const { regions, lessons } = pick(seed(over))
  const completedLessonIds = new Set(done)
  const c = buildWorldCatalog({ lessons, regions, completedLessonIds, watchProgress: new Map() })
  return buildMapModel({ areas: c.areas, lessonsByArea: c.lessonsByArea, completedLessonIds, watchedLessonIds: completedLessonIds })
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

console.log('\n=== a lesson that can\'t be finished in the app never holds the student (Loom 2, 2026-10-16) ===')
{
  // As in the real course on 16 October: every watch lesson had a video but a3l11, a4l11
  // and all of area 7 (a3l11 and a4l11 got theirs on 19 October); a5l24, an action item, has none and is still finished by its hand-in.
  const vid = {}
  for (let k = 0; k < 8; k++) {
    for (let n = 1; n <= COUNTS[k]; n++) {
      const id = idOf(k, n)
      if (id === 'a3l11' || id === 'a4l11' || id === 'a5l24' || k === 6) continue
      vid[id] = { has_video: true, duration_seconds: 300 }
    }
  }
  const at = (done) => model(done, vid)
  const fresh = at([])
  ok(fresh.place === 0 && fresh.placeNext === 0, 'a new student starts at place 1, lesson 1', `place=${fresh.place} next=${fresh.placeNext}`)
  ok(fresh.areas[2].lessons[10].finishable === false && fresh.areas[2].lessons[11].finishable === true, 'a watch lesson with no video can\'t be finished, one with a video can')
  ok(fresh.areas[4].lessons[23].finishable === true, 'an action item with no video can be finished (its hand-in)')

  const ten = at([...all(0), ...all(1), ...range(2, 1, 10)])
  ok(ten.place === 2 && ten.placeNext === 11, 'lessons 1 to 10 of Video Ads I watched: next is lesson 12, past lesson 11', `place=${ten.place} next=${ten.placeNext}`)

  const allBut = at([...all(0), ...all(1), ...range(2, 1, 10), ...range(2, 12, 22)])
  ok(allBut.place === 3 && allBut.placeNext === 0, 'only lesson 11 left in Video Ads I: the student moves on to Video Ads II', `place=${allBut.place} next=${allBut.placeNext}`)
  ok(allBut.areas[2].done === 21 && allBut.areas[2].lessons.length === 22, 'Video Ads I is 21 of 22: the lesson still counts')
  ok(allBut.total === 144 && allBut.doneTotal === 8 + 10 + 21, 'the course total still counts it', `${allBut.doneTotal}/${allBut.total}`)

  const toSeven = at([...all(0), ...all(1), ...all(2), ...all(3), ...all(4), ...all(5)])
  ok(toSeven.place === 7 && toSeven.placeNext === 0, 'areas 1 to 6 done: Creative Strategy (no videos) is passed over for place 8', `place=${toSeven.place}`)
  ok(toSeven.areas[6].done === 0, 'and Creative Strategy is still 0 done')

  const finishableDone = at(NAMES.flatMap((_, k) => all(k)).filter((id) => id !== 'a3l11' && id !== 'a4l11' && !id.startsWith('a7')))
  ok(finishableDone.place === 2 && finishableDone.placeNext === 10, 'everything that can be finished is done: the first lesson left (a3l11) is next, not recorded yet', `place=${finishableDone.place} next=${finishableDone.placeNext}`)
  ok(finishableDone.areas[2].lessons[10].finishable === false, 'and the map knows it can\'t be finished')

  const done = at(NAMES.flatMap((_, k) => all(k)))
  ok(done.place === MAP_PLACES && done.placeNext === -1, 'everything done: place 8, no next lesson')

  ok(finishableIn(ten, 'a3l11') === false && finishableIn(ten, 'a3l12') === true, 'finishableIn reads the model')
  ok(finishableIn(ten, 'a7l22') === null && finishableIn(ten, 'zz') === null, 'finishableIn: null for a feature row and an unknown id')

  // The dev page's placeholder course: "Mark watched (dev)" finishes any lesson, so none is passed over.
  const { regions, lessons } = seed(vid)
  const doneTen = new Set([...all(0), ...all(1), ...range(2, 1, 10)])
  const c = buildWorldCatalog({ lessons, regions, completedLessonIds: doneTen, watchProgress: new Map() })
  const dev = buildMapModel({ areas: c.areas, lessonsByArea: c.lessonsByArea, completedLessonIds: doneTen, watchedLessonIds: doneTen, anyLessonFinishes: true })
  ok(dev.place === 2 && dev.placeNext === 10 && dev.areas[2].lessons[10].finishable === true, 'anyLessonFinishes: lesson 11 is next and can be finished', `next=${dev.placeNext}`)

  // No video anywhere (the staging seed, or a failed read of the videos): nothing is passed over.
  const none = model([...all(0), ...all(1), ...range(2, 1, 10)])
  ok(none.placeNext === 10 && none.areas.every((a) => a.lessons.every((l) => l.finishable)), 'a course with no video at all passes nothing over')
  ok(canFinishInApp({ type: 'watch', has_video: true, requires_action: false }) && canFinishInApp({ type: 'setup', has_video: false, requires_action: true }) && !canFinishInApp({ type: 'watch', has_video: false, requires_action: false }),
     'canFinishInApp: a video, or a hand-in')
}

console.log('\n=== an area with nothing to do never holds the student ===')
{
  // Area 2 loses every counting lesson: the student goes from place 1 straight to place 3.
  const m = model(all(0), {}, ({ regions, lessons }) => ({ regions, lessons: lessons.filter((l) => l.region_id !== 'a2') }))
  ok(m.ok === true && m.areas[1].lessons.length === 0, 'the empty area is still one of the eight')
  ok(m.place === 2 && m.placeNext === 0, 'and the place skips it', `place=${m.place}`)
}

console.log('\n=== an action item holds the student only until its video is watched (2026-10-19) ===')
{
  // The real course, as the development page builds it (src/app/dev/world-app/courseCatalog.ts):
  // course_catalog.json, with a video on every watch lesson the lengths file has.
  const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'))
  const file = read('../supabase/catalog/course_catalog.json')
  const lengths = read('../src/app/dev/world-app/course-lengths.fixture.json')
  const regions = file.areas.map((a, i) => ({ id: a.id, order_num: i + 1, name: a.name }))
  const lessons = file.lessons.map((l, i) => ({
    id: l.id, region_id: l.area, type: l.type, title: l.title, description: null, sort_order: i + 1,
    requires_action: l.action_brief !== undefined, action_brief: l.action_brief ?? null,
    is_optional: false, is_gate: l.gate === true, counts_toward_progress: l.counts !== false, feature_key: l.feature_key ?? null,
    has_video: lengths[l.id] !== undefined && l.type === 'watch', duration_seconds: lengths[l.id] ?? null,
  }))
  const byId = new Map(lessons.map((l) => [l.id, l]))
  const counting = lessons.filter((l) => l.counts_toward_progress).map((l) => l.id)
  /** Every counting lesson from the first to `id`, in course order. */
  const upTo = (id) => counting.slice(0, counting.indexOf(id) + 1)
  const AT = '2026-10-19T15:00:00.000Z'
  /** A row with the watch half only: the video watched in the app, or the lesson synced from Whop. */
  const watchedRow = (id) => ({ lesson_id: id, completed_at: AT, action_completed_at: null, skipped_at: null })
  /** A row with both halves on an action item (handed in), the watch half on any other lesson. */
  const doneRow = (id) => ({ lesson_id: id, completed_at: AT, action_completed_at: byId.get(id).requires_action ? AT : null, skipped_at: null })
  /** The map for these completion rows, read as StudentContext reads them: done by isLessonComplete, watched by completed_at. */
  const student = (rows) => {
    const completedLessonIds = new Set(rows.filter((c) => isLessonComplete(c, byId.get(c.lesson_id))).map((c) => c.lesson_id))
    const watchedLessonIds = new Set(rows.filter((c) => c.completed_at).map((c) => c.lesson_id))
    const c = buildWorldCatalog({ lessons, regions, completedLessonIds, watchProgress: new Map() })
    return buildMapModel({ areas: c.areas, lessonsByArea: c.lessonsByArea, completedLessonIds, watchedLessonIds })
  }
  /** The next lesson's id (the card, the chip, the panel's next row and the phone's Next block all show it), or null. */
  const nextOf = (m) => (m.place < MAP_PLACES ? m.areas[m.place].lessons[m.placeNext]?.id ?? null : null)
  const lessonIn = (m, id) => m.areas.flatMap((a) => a.lessons).find((l) => l.id === id)

  const a3l17 = byId.get('a3l17')
  const a3l25 = byId.get('a3l25')
  const a5l22 = byId.get('a5l22')
  ok(a3l17.requires_action && a3l17.type === 'watch' && a3l17.has_video && a3l17.title === 'Your First Boss Battle', 'the course: a3l17, Your First Boss Battle, is an action item with a video')
  ok(a3l25.requires_action && a3l25.type === 'watch' && a3l25.has_video, 'the course: a3l25 is an action item with a video')
  ok(a5l22.requires_action && a5l22.type === 'setup' && !a5l22.has_video, 'the course: a5l22 is an action item with no video (a setup step)')

  // a3l17's video watched in the app, its hand-in not in.
  const before = student(upTo('a3l16').map(doneRow))
  ok(nextOf(before) === 'a3l17', 'lessons up to a3l16 watched: a3l17 is next, until its video is watched', nextOf(before))
  const watched17 = student([...upTo('a3l16').map(doneRow), watchedRow('a3l17')])
  ok(nextOf(watched17) === 'a3l18' && watched17.place === 2, 'a3l17\'s video watched, its hand-in not in: a3l18 is next', `${nextOf(watched17)} at place ${watched17.place + 1}`)
  const open17 = lessonIn(watched17, 'a3l17')
  ok(open17.action && !open17.done && open17.passed, 'and a3l17 stays an open action item: not done (the panel row and its tick show it open)', JSON.stringify(open17))
  ok(watched17.areas[2].done === 16 && watched17.doneTotal === 8 + 11 + 16, 'the counts are done lessons only: 16 in Video Ads I, 35 in all', `${watched17.areas[2].done} / ${watched17.doneTotal}`)
  const actionOnly = student([...upTo('a3l16').map(doneRow), { lesson_id: 'a3l17', completed_at: null, action_completed_at: AT, skipped_at: null }])
  ok(nextOf(actionOnly) === 'a3l17', 'its hand-in in and its video not watched: a3l17 is still next', nextOf(actionOnly))

  // Day one: Whop progress up to a4l05 arrives as the watch half of every lesson.
  const whop = student(upTo('a4l05').map(watchedRow))
  ok(nextOf(whop) === 'a4l06' && whop.place === 3, 'Whop progress up to a4l05, a3l17 and a3l25 not handed in: a4l06 is next', `${nextOf(whop)} at place ${whop.place + 1}`)
  ok(['a3l17', 'a3l25'].every((id) => !lessonIn(whop, id).done && lessonIn(whop, id).passed), 'and a3l17 and a3l25 are both still open')
  ok(whop.areas[2].done === 23 && whop.areas[2].lessons.length === 25, 'Video Ads I is 23 of 25: the place is not done while a hand-in is open', `${whop.areas[2].done} of ${whop.areas[2].lessons.length}`)
  ok(whop.doneTotal === upTo('a4l05').length - 2 && whop.total === 140, 'the course count leaves the two open hand-ins out', `${whop.doneTotal}/${whop.total}`)

  // A setup action item has no watch half to pass, even when Whop sent a completion for it.
  const setup = student(upTo('a5l22').map(watchedRow))
  ok(nextOf(setup) === 'a5l22' && setup.place === 4, 'Whop progress up to a5l22, a setup action item: a5l22 is next while its hand-in is not in', nextOf(setup))
  ok(!lessonIn(setup, 'a5l22').done && !lessonIn(setup, 'a5l22').passed, 'and it is neither done nor passed')
  const handedIn = student([...upTo('a5l21').map(watchedRow), doneRow('a5l22')])
  ok(nextOf(handedIn) === 'a5l23', 'its hand-in in: a5l23 is next', nextOf(handedIn))

  // With nothing else left, the open hand-in is the next lesson, in its own place.
  const rest = counting.filter((id) => canFinishInApp(byId.get(id)))
  const last = student(rest.map((id) => (id === 'a3l17' || id === 'a3l25' ? watchedRow(id) : doneRow(id))))
  ok(last.place === 2 && nextOf(last) === 'a3l17', 'everything the app can finish done but the hand-ins of a3l17 and a3l25: a3l17 is next, in Video Ads I', `${nextOf(last)} at place ${last.place + 1}`)
  ok(last.areas[2].done === 23 && last.place < MAP_PLACES, 'and Video Ads I is 23 of 25, the course not finished')

  ok(isPassed(a3l17, false, true) && !isPassed(a3l17, false, false) && !isPassed(a5l22, false, true) && isPassed(a5l22, true, true) && !isPassed(byId.get('a3l18'), false, true),
     'isPassed: an action item with a video by its watch half, a setup action item and a plain lesson only once done')
}

console.log(`\n============================================================\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1) }
