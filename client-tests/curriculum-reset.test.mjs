// curriculum-reset.ts: the course switch as the CSM, achievements, admin pages
// and snapshot callers see it. Every row of the cutover PRD's Work Item 1
// paths table, plus the edges around each. The module and constants.ts are the
// real source (build.mjs copies them across untouched).
import {
  CURRICULUM_RESET_KEY,
  activityLabel, clampStartToReset, courseAnchorIso, cutoverProblems,
  daysOnCourse, getCurriculumResetAt, resetDateUtc,
} from './_gen/curriculum-reset.ts'
import { sprintDayNumber } from './_gen/constants.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const show = (v) => JSON.stringify(v)
const throws = (fn) => { try { fn(); return null } catch (e) { return e instanceof Error ? e.message : String(e) } }
const rejects = async (p) => { try { await p; return null } catch (e) { return e instanceof Error ? e.message : String(e) } }
const DAY = 86_400_000

// sprintDayNumber reads the clock itself, so the clock is held still for the
// whole file and put back at the end.
const realNow = Date.now
const NOW = Date.parse('2026-10-20T18:30:00.000Z')
Date.now = () => NOW
const iso = (ms) => new Date(ms).toISOString()

const RESET = '2026-10-20T18:30:00.000Z'

console.log('\n=== The key ===')
ok(CURRICULUM_RESET_KEY === 'curriculum_reset_at', 'the admin_config key v104 writes', CURRICULUM_RESET_KEY)

console.log('\n=== No reset: anchor and days equal sprintDayNumber(firstPaidAt ?? joinedAt) ===')
{
  const JOINED = '2026-06-01T09:00:00.000Z'
  const cases = [
    ['paid this very millisecond', iso(NOW), JOINED],
    ['paid 1 ms ago', iso(NOW - 1), JOINED],
    ['paid exactly 1 day ago', iso(NOW - DAY), JOINED],
    ['paid 1 day and 1 ms ago', iso(NOW - DAY - 1), JOINED],
    ['paid 29 and a half days ago', iso(NOW - 29.5 * DAY), JOINED],
    ['no first payment, joined 141 days ago', null, iso(NOW - 141 * DAY)],
    ['no first payment, joined in an offset zone', null, '2026-10-01T01:00:00+02:00'],
    ['a first payment in the future', iso(NOW + 3 * DAY), JOINED],
  ]
  for (const [label, firstPaidAt, joinedAt] of cases) {
    const anchor = courseAnchorIso(firstPaidAt, joinedAt, null)
    const old = sprintDayNumber(firstPaidAt ?? joinedAt)
    ok(anchor === (firstPaidAt ?? joinedAt) && daysOnCourse(anchor) === old && daysOnCourse(anchor, NOW) === old,
       label, `anchor ${anchor}, day ${daysOnCourse(anchor)} = sprintDayNumber ${old}`)
  }
  ok(daysOnCourse(iso(NOW)) === 1 && daysOnCourse(iso(NOW - DAY)) === 1 && daysOnCourse(iso(NOW - DAY - 1)) === 2,
     'Day 1 runs for the first 24 hours, Day 2 starts the millisecond after')
  ok(daysOnCourse(iso(NOW + 3 * DAY)) === 1, 'an anchor in the future is Day 1, never 0 or less')
  ok(daysOnCourse(iso(NOW - 10 * DAY), NOW + 5 * DAY) === 15, 'nowMs is used when handed in')
  ok(courseAnchorIso('', iso(NOW - DAY), null) === '', 'an empty first payment is kept as the old callers keep it (?? only replaces null)')
}

console.log('\n=== A reset: the later of first payment and the switch ===')
{
  const before = '2026-10-02T10:00:00.000Z'
  const after = '2026-10-23T08:00:00.000Z'
  ok(courseAnchorIso(before, '2026-09-01T00:00:00Z', RESET) === RESET, 'paid before the switch: the anchor is the switch')
  ok(courseAnchorIso(after, '2026-09-01T00:00:00Z', RESET) === after, 'paid after the switch: the anchor is the first payment')
  ok(courseAnchorIso(null, '2026-05-30T00:00:00Z', RESET) === RESET, 'no first payment, joined before the switch: the switch')
  ok(courseAnchorIso(null, after, RESET) === after, 'no first payment, joined after the switch: the join')
  ok(courseAnchorIso(RESET, '2026-09-01T00:00:00Z', RESET) === RESET, 'paid at the switch\'s exact moment: either, they are the same instant')
  ok(courseAnchorIso('2026-10-20T20:30:00+02:00', '2026-09-01T00:00:00Z', RESET) === '2026-10-20T20:30:00+02:00',
     'compared as instants: 20:30+02:00 is 18:30 UTC, the same moment, so the first payment stands')
  ok(courseAnchorIso('2026-10-20T20:29:00+02:00', '2026-09-01T00:00:00Z', RESET) === RESET,
     'compared as instants: 20:29+02:00 is a minute before the switch, so the switch wins (a string compare would say otherwise)')
  ok(daysOnCourse(courseAnchorIso(before, 'x', RESET)) === 1, 'a June student on the evening of the switch is on Day 1')
  ok(daysOnCourse(courseAnchorIso(before, 'x', RESET), NOW + 2 * DAY + 1) === 3, 'and on Day 3 two days and a millisecond later')
  ok(throws(() => courseAnchorIso(before, 'x', 'yesterday')) !== null, 'a reset that does not read as a date throws, never counts as no reset')
}

console.log('\n=== activityLabel ===')
{
  const at = (days) => iso(NOW - days * DAY)
  const got = [0, 2, 3, 7, 8].map((d) => activityLabel(at(d), NOW)).concat(activityLabel(null, NOW))
  ok(same(got, ['moving', 'moving', 'slipping', 'slipping', 'stalled', 'not_started']),
     'at 0, 2, 3, 7, 8 days, and none', show(got))
  ok(activityLabel(iso(NOW - 3 * DAY + 1), NOW) === 'moving', 'a millisecond short of 3 whole days: moving')
  ok(activityLabel(iso(NOW - 8 * DAY + 1), NOW) === 'slipping', 'a millisecond short of 8 whole days: still slipping (7 whole days)')
  ok(activityLabel(iso(NOW + DAY), NOW) === 'moving', 'a lesson stamped in the future: moving')
  ok(activityLabel('not a date', NOW) === 'not_started' && activityLabel('', NOW) === 'not_started', 'a date that does not parse counts as none')
  ok(activityLabel(at(5)) === 'slipping', 'with no nowMs it reads the clock')
}

console.log('\n=== getCurriculumResetAt, against a stand-in client ===')
{
  const client = (result) => {
    const calls = []
    return {
      calls,
      from(table) {
        const q = { table, steps: [] }
        calls.push(q)
        const b = {}
        for (const m of ['select', 'eq']) b[m] = (...args) => { q.steps.push([m, ...args]); return b }
        b.maybeSingle = () => { q.steps.push(['maybeSingle']); return typeof result === 'function' ? result() : Promise.resolve(result) }
        return b
      },
    }
  }
  const c1 = client({ data: { value: RESET }, error: null })
  const v = await getCurriculumResetAt(c1)
  ok(v === RESET, 'a row: its value, as stored', v)
  ok(same(c1.calls, [{ table: 'admin_config', steps: [['select', 'value'], ['eq', 'key', 'curriculum_reset_at'], ['maybeSingle']] }]),
     'one read: admin_config, the value of the one key', show(c1.calls))
  ok(await getCurriculumResetAt(client({ data: null, error: null })) === null, 'no row: null (the old course is live)')
  {
    const m = await rejects(getCurriculumResetAt(client({ data: null, error: { message: 'permission denied for table admin_config' } })))
    ok(m !== null && m.includes('permission denied for table admin_config'), 'a read error throws, never null', m)
  }
  {
    const m = await rejects(getCurriculumResetAt(client({ data: { value: RESET }, error: { message: 'timeout' } })))
    ok(m !== null && m.includes('timeout'), 'an error next to data still throws')
  }
  {
    const m = await rejects(getCurriculumResetAt(client(() => Promise.reject(new Error('fetch failed')))))
    ok(m === 'fetch failed', 'a client that throws: the throw comes through', m)
  }
  for (const bad of ['', 'yes', '2026-10-20', '2026-10-20 18:30:00+00', '2026-10-20T18:30:00', 'October 20, 2026']) {
    const m = await rejects(getCurriculumResetAt(client({ data: { value: bad }, error: null })))
    ok(m !== null && m.includes('curriculum_reset_at'), `a row holding ${show(bad)} throws, never reads as no switch`, m)
  }
  for (const good of ['2026-10-20T18:30:00Z', '2026-10-20T18:30Z', '2026-10-20T20:30:00.000+02:00']) {
    ok(await getCurriculumResetAt(client({ data: { value: good }, error: null })) === good, `${good} is a reset moment`)
  }
}

console.log('\n=== resetDateUtc ===')
ok(resetDateUtc(null) === null, 'no reset: null')
ok(resetDateUtc(RESET) === '2026-10-20', 'the UTC date', resetDateUtc(RESET))
ok(resetDateUtc('2026-10-21T01:00:00+02:00') === '2026-10-20', '01:00 in Zagreb on the 21st is still the 20th in UTC, as the trigger reads it')
ok(resetDateUtc('2026-10-20T23:59:59.999Z') === '2026-10-20', 'the last millisecond of the day')
ok(throws(() => resetDateUtc('soon')) !== null, 'a reset that does not read as a date throws')

console.log('\n=== clampStartToReset ===')
{
  const got = [
    clampStartToReset('2026-10-19', RESET),
    clampStartToReset('2026-10-20', RESET),
    clampStartToReset('2026-10-21', RESET),
    clampStartToReset('2026-10-19', null),
  ]
  ok(same(got, ['2026-10-20', '2026-10-20', '2026-10-21', '2026-10-19']),
     'before the reset date: the reset date; on it: unchanged; after it: unchanged; no reset: unchanged', show(got))
  ok(clampStartToReset('2026-01-01', RESET) === '2026-10-20', 'a start months back is moved up to the switch')
  ok(clampStartToReset('2026-10-20', '2026-10-21T01:00:00+02:00') === '2026-10-20', 'the floor is the UTC date, as the trigger\'s')
  ok(clampStartToReset('2026-09-30', '2026-10-01T00:00:00Z') === '2026-10-01', 'across a month end')
  ok(throws(() => clampStartToReset('2026-9-30', RESET)) !== null, 'a start that is not YYYY-MM-DD throws once there is a switch (a string compare would get it wrong)')
  ok(clampStartToReset('2026-9-30', null) === '2026-9-30', 'with no switch the start is passed through unchecked, as before')
  ok(throws(() => clampStartToReset('2026-10-19', 'later')) !== null, 'a reset that does not read as a date throws')
}

console.log('\n=== cutoverProblems ===')
{
  const AREAS = ['a3', 'a1', 'a2', 'a8', 'a4', 'a6', 'a5', 'a7']
  const after = (o = {}) => ({
    resetAt: RESET, catalogTable: 'lessons', catalogIsV2: true, studentHome: '/world', worldLive: true,
    whopCourseIdSet: true, regionIds: AREAS, lessons: 141, countingLessons: 140, lessonsWithWhopId: 141,
    discountGateId: 'a4l17', discountLessons: 59, ...o,
  })
  const before = (o = {}) => ({
    resetAt: null, catalogTable: 'lessons', catalogIsV2: false, studentHome: '/dashboard', worldLive: false,
    whopCourseIdSet: true, regionIds: ['r1', 'r2', 'r3', 'r4'], lessons: 65, countingLessons: 64, lessonsWithWhopId: 0,
    discountGateId: 'l049', discountLessons: 0, ...o,
  })
  const one = (facts, want, label) => {
    const got = cutoverProblems(facts)
    ok(same(got, [want]), label, show(got))
  }

  ok(same(cutoverProblems(after()), []), 'after the switch, everything right: no problems (areas in any order)')
  ok(same(cutoverProblems(after({ worldLive: false })), []), 'NEXT_PUBLIC_WORLD_LIVE unset is no problem once the home is /world (C14)')
  one(after({ catalogIsV2: false }), 'CATALOG_SHAPE=v2 is missing', 'shape missing, alone')
  one(after({ catalogTable: 'lessons_next' }), 'CATALOG_TABLE_SUFFIX must be empty', 'suffix still set, alone (staging forces the v2 shape)')
  one(after({ studentHome: '/dashboard' }), 'NEXT_PUBLIC_STUDENT_HOME is not /world', 'home still /dashboard, alone')
  one(after({ whopCourseIdSet: false }), 'WHOP_COURSE_ID is not set', 'no Whop course, alone')
  one(after({ regionIds: ['r1', 'r2', 'r3', 'r4'] }), 'the live areas are not a1..a8', 'the old regions still live, alone')
  one(after({ regionIds: AREAS.slice(0, 7) }), 'the live areas are not a1..a8', 'one area missing, alone')
  one(after({ regionIds: [...AREAS, 'a9'] }), 'the live areas are not a1..a8', 'an area too many, alone')
  one(after({ regionIds: [] }), 'the live areas are not a1..a8', 'no areas at all, alone')
  one(after({ lessonsWithWhopId: 138 }), '3 lessons have no Whop id', 'three lessons without a Whop id, alone')
  one(after({ lessonsWithWhopId: 140 }), '1 lesson has no Whop id', 'one lesson without a Whop id, in the singular')
  ok(same(cutoverProblems(after({ lessons: 0, lessonsWithWhopId: 0, countingLessons: 0, regionIds: [], discountGateId: null, discountLessons: 0 })),
          ['the live areas are not a1..a8', 'No lesson is the discount gate']),
     'an empty catalog is caught by its areas, and has no gate')
  one(after({ discountGateId: null, discountLessons: 0 }), 'No lesson is the discount gate', 'no lesson marked is_gate, alone')
  one(after({ discountLessons: 0 }), 'No lesson up to the discount gate has a video, so the offer is closed for everyone',
      'a gate with not one video up to it, alone')
  ok(same(cutoverProblems(after({ discountLessons: 1 })), []), 'one video up to the gate is enough to keep the offer open')
  {
    const got = cutoverProblems(after({
      catalogIsV2: false, catalogTable: 'lessons', studentHome: '/dashboard', worldLive: false,
      whopCourseIdSet: false, regionIds: ['r1'], lessonsWithWhopId: 0,
    }))
    ok(same(got, [
      'CATALOG_SHAPE=v2 is missing', 'NEXT_PUBLIC_STUDENT_HOME is not /world', 'WHOP_COURSE_ID is not set',
      'the live areas are not a1..a8', '141 lessons have no Whop id',
    ]), 'the new data under the old build: every missing value, the shape named first', show(got))
  }

  ok(same(cutoverProblems(before()), []), 'before the switch, production as it is today: no problems')
  ok(same(cutoverProblems(before({ whopCourseIdSet: false, regionIds: [], lessonsWithWhopId: 0, discountGateId: null, discountLessons: 0 })), []),
     'before the switch, the after-switch checks stay quiet (the discount gate\'s two among them)')
  ok(same(cutoverProblems(before({ catalogTable: 'lessons_next', catalogIsV2: true, regionIds: AREAS })), []),
     'before the switch, the staging catalog on a preview: no problems')
  one(before({ studentHome: '/world' }), 'NEXT_PUBLIC_STUDENT_HOME is /world, but the course switch has not run',
      'before the switch, a home of /world: the one inconsistent pair')
  one(before({ studentHome: '/world', worldLive: true, catalogIsV2: true }), 'NEXT_PUBLIC_STUDENT_HOME is /world, but the course switch has not run',
      'the evening\'s values deployed before the SQL ran: the same single line')
}

Date.now = realNow

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
