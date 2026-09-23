import { buildWorldCatalog } from './_gen/catalog.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

// NOTE: none of these rows has a `day` field. That is the v2 catalog shape,
// and the fact that everything below works is the proof that catalog.ts never
// reads it — which is what lets the world run against either catalog.
const L = (id, region_id, sort_order, o = {}) => ({
  id, region_id, sort_order,
  type: 'watch', title: id,
  requires_action: false, is_optional: false, is_gate: false,
  counts_toward_progress: true, feature_key: null,
  bunny_video_id: null, duration_seconds: null,
  ...o,
})
const R = (id, order_num, name, o = {}) => ({ id, order_num, name, ...o })

console.log('\n=== area ordering: order_num, never the id text ===')
{
  // THE BUG THIS PREVENTS: 'a10' sorts BEFORE 'a9' lexically. That is exactly
  // what v92 fixed in student_current_region, and the same trap lives here.
  const c = buildWorldCatalog({
    lessons: [], regions: [R('a9', 9, 'Nine'), R('a10', 10, 'Ten'), R('a1', 1, 'One')],
    completedLessonIds: new Set(), watchProgress: new Map(),
  })
  ok(JSON.stringify(c.areas.map((a) => a.id)) === JSON.stringify(['a1', 'a9', 'a10']),
     'a10 sorts AFTER a9 (order_num, not lexical)', JSON.stringify(c.areas.map((a) => a.id)))
}

console.log('\n=== the Ad Bounty pond is outside the denominator ===')
{
  const c = buildWorldCatalog({
    lessons: [
      L('a7l01', 'a7', 1), L('a7l02', 'a7', 2),
      L('a7l22', 'a7', 3, { counts_toward_progress: false, feature_key: 'bounty_access', type: 'setup' }),
    ],
    regions: [R('a7', 7, 'Creative Strategy')],
    completedLessonIds: new Set(['a7l01', 'a7l02']),
    watchProgress: new Map(),
  })
  const p = c.areaProgress('a7')
  ok(p.total === 2 && p.done === 2 && p.isComplete,
     'the pond does not count, so 2 of 2 reads COMPLETE', `${p.done}/${p.total}`)
  ok(c.lessonsByArea.get('a7').length === 3, 'but it is still IN the area and visible')
}

console.log('\n=== empty area: 0, never NaN ===')
{
  const c = buildWorldCatalog({
    lessons: [], regions: [R('a1', 1, 'One')],
    completedLessonIds: new Set(), watchProgress: new Map(),
  })
  const p = c.areaProgress('a1')
  ok(p.ratio === 0 && !Number.isNaN(p.ratio), 'ratio is 0, not NaN', `ratio=${p.ratio}`)
  ok(!p.isComplete, 'an empty area is not "complete"')
  ok(c.areaProgress('does-not-exist').total === 0, 'an unknown area is empty, not a crash')
}

console.log('\n=== currentAreaId is the FURTHEST area, not the last row ===')
{
  const c = buildWorldCatalog({
    // a8 completion listed FIRST, a2 last — array order must not decide this.
    lessons: [L('a8l01', 'a8', 80), L('a2l01', 'a2', 20), L('a1l01', 'a1', 10)],
    regions: [R('a1', 1, 'One'), R('a2', 2, 'Two'), R('a8', 8, 'Eight')],
    completedLessonIds: new Set(['a8l01', 'a2l01']),
    watchProgress: new Map(),
  })
  ok(c.currentAreaId === 'a8', 'furthest by order_num wins', c.currentAreaId)
}
{
  const c = buildWorldCatalog({
    lessons: [L('a1l01', 'a1', 1)], regions: [R('a1', 1, 'One'), R('a2', 2, 'Two')],
    completedLessonIds: new Set(), watchProgress: new Map(),
  })
  ok(c.currentAreaId === 'a1', 'a brand new student starts at the first area', c.currentAreaId)
}

console.log('\n=== nextLesson walks global sort_order and skips optional ===')
{
  const c = buildWorldCatalog({
    lessons: [
      L('a1l01', 'a1', 1), L('a1l02', 'a1', 2, { is_optional: true }), L('a1l03', 'a1', 3),
    ],
    regions: [R('a1', 1, 'One')],
    completedLessonIds: new Set(['a1l01']), watchProgress: new Map(),
  })
  ok(c.nextLesson?.id === 'a1l03', 'skips the optional one', c.nextLesson?.id)
}
{
  const c = buildWorldCatalog({
    lessons: [L('a1l01', 'a1', 1), L('a1l02', 'a1', 2, { is_optional: true })],
    regions: [R('a1', 1, 'One')],
    completedLessonIds: new Set(['a1l01']), watchProgress: new Map(),
  })
  ok(c.nextLesson?.id === 'a1l02',
     'but falls back to it when nothing required is left', c.nextLesson?.id)
}
{
  const c = buildWorldCatalog({
    lessons: [L('a1l01', 'a1', 1)], regions: [R('a1', 1, 'One')],
    completedLessonIds: new Set(['a1l01']), watchProgress: new Map(),
  })
  ok(c.nextLesson === null, 'null when the course is finished')
}

console.log('\n=== in-progress = opened but not finished ===')
{
  const c = buildWorldCatalog({
    lessons: [L('a1l01', 'a1', 1), L('a1l02', 'a1', 2), L('a1l03', 'a1', 3)],
    regions: [R('a1', 1, 'One')],
    completedLessonIds: new Set(['a1l01']),
    watchProgress: new Map([['a1l02', {}], ['a1l01', {}]]),
  })
  const p = c.areaProgress('a1')
  ok(p.inProgress === 1, 'a watched-but-unfinished lesson counts once', `inProgress=${p.inProgress}`)
}

console.log('\n=== video lookups + a lesson whose area is missing ===')
{
  const c = buildWorldCatalog({
    lessons: [
      L('a1l01', 'a1', 1, { bunny_video_id: 'guid-1' }),
      L('a1l02', 'a1', 2),
      L('orphan', 'a99', 3),        // region_id with no matching region row
    ],
    regions: [R('a1', 1, 'One')],
    completedLessonIds: new Set(), watchProgress: new Map(),
  })
  ok(c.hasVideo('a1l01') && c.videoIdFor('a1l01') === 'guid-1', 'videoIdFor finds the GUID')
  ok(!c.hasVideo('a1l02') && c.videoIdFor('a1l02') === null, 'no GUID reads as no video')
  ok(c.videoIdFor('nope') === null, 'an unknown lesson is null, not a crash')
  ok(c.areaOf('a1l01')?.id === 'a1', 'areaOf resolves')
  ok(c.areaOf('orphan') === null, 'an orphan lesson has no area...')
  ok(c.lessonsByArea.get('a99')?.length === 1,
     '...but still gets a bucket, so a catalog mismatch is VISIBLE as a count')
}

console.log('\n=== isEmpty distinguishes "no data" from "empty course" ===')
{
  const empty = buildWorldCatalog({ lessons: [], regions: [], completedLessonIds: new Set(), watchProgress: new Map() })
  ok(empty.isEmpty, 'no lessons and no regions -> isEmpty')
  const partial = buildWorldCatalog({ lessons: [], regions: [R('a1', 1, 'One')], completedLessonIds: new Set(), watchProgress: new Map() })
  ok(partial.isEmpty, 'regions but no lessons -> still isEmpty')
}

console.log('\n=== the gate ===')
{
  const c = buildWorldCatalog({
    lessons: [L('a5l25', 'a5', 87, { is_gate: true }), L('a1l01', 'a1', 1)],
    regions: [R('a1', 1, 'One'), R('a5', 5, 'Five')],
    completedLessonIds: new Set(), watchProgress: new Map(),
  })
  ok(c.gateLesson?.id === 'a5l25', 'gateLesson found', c.gateLesson?.id)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
