// discount.ts (where a student stands on the 30% offer) and discount-server.ts
// (what the request and approve routes do with it on the new course). Every
// branch on stand-in rows, then the real course: course_catalog.json with the
// video lengths of the development page. Both modules are the real source
// (build.mjs copies them with their import lines rewritten), and so is
// checkpointView.ts, for the rule's one line on the map's panel.
// Since 2026-10-26 the rule is 80% of the videos up to the checkpoint,
// rounded up (videosNeeded): the stand-in course counts 3, of which 80% is
// all 3, so its checks read as before with the new counts; the real course's
// 61 need 49. discount-eighty.test.mjs walks the 80% itself through the
// routes.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DISCOUNT_ELIGIBLE_FROM, DISCOUNT_LAUNCH_DATE, DISCOUNT_PERCENT, DISCOUNT_SHARED_DEADLINE, DISCOUNT_VIDEO_SHARE, DISCOUNT_WINDOW_DAYS,
  discountEndsAt, discountState, discountWindow, gateLessonId, requestCounts, requiredLessons, videosNeeded,
} from './_gen/discount.ts'
import { DISCOUNT_WINDOW_DAYS as CONSTANTS_WINDOW_DAYS } from './_gen/constants.ts'
import {
  LESSON_COLUMNS, OLD_COURSE_REQUEST_REFUSAL, REQUEST_COLUMNS, REQUEST_GRACE_MS, VIDEO_COLUMNS,
  approvalVerdict, decideDiscountRequest, discountRefusalMessage, explainOldCourseRequest, factsFromReads,
  loadDiscountReads, toDiscountLessons, videoDoneIds,
} from './_gen/discount-server.ts'
import { discountRule } from './_gen/checkpointView.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const show = (v) => JSON.stringify(v)
const DAY = 86_400_000

/** A stand-in lesson; a counting watch lesson with a 10-minute video unless told otherwise. */
const L = (id, o = {}) => ({ id, type: 'watch', counts_toward_progress: true, is_gate: false, has_video: true, duration_seconds: 600, ...o })
const PAID = '2026-10-10T12:00:00.000Z'
const ENDS = '2026-10-24T12:00:00.000Z'
const IN_WINDOW = new Date('2026-10-15T09:00:00.000Z')
const AFTER = new Date('2026-10-25T00:00:00.000Z')
const COURSE = [
  L('x01', { duration_seconds: 300 }),
  L('x02', { type: 'setup', has_video: false, duration_seconds: null }),
  L('x03', { has_video: false, duration_seconds: null }),
  L('x04', { counts_toward_progress: false }),
  L('x05', { duration_seconds: null }),
  L('x06', { duration_seconds: 900, is_gate: true }),
  L('x07'),
  L('x08'),
]
const state = (o) => discountState({ now: IN_WINDOW, firstPaidAt: PAID, lessons: COURSE, videoDoneIds: new Set(), requests: [], ...o })
const R = (id, status, created_at, o = {}) => ({ id, status, created_at, ...o })

console.log('\n=== One source for the 14 days ===')
ok(DISCOUNT_WINDOW_DAYS === 14 && DISCOUNT_WINDOW_DAYS === CONSTANTS_WINDOW_DAYS, 'DISCOUNT_WINDOW_DAYS is constants.ts\'s, re-exported', `${DISCOUNT_WINDOW_DAYS}`)
const zagreb = (t) => new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/Zagreb' })
ok(DISCOUNT_PERCENT === 30 && DISCOUNT_LAUNCH_DATE === '2026-10-08T22:00:00.000Z',
   'the offer is 30%, and the launch is 9 October 2026 at midnight in Croatia (22:00 UTC on the 8th, CEST is UTC+2)')
ok(zagreb(DISCOUNT_LAUNCH_DATE) === '09/10/2026, 00:00:00', 'the launch is 00:00 on 9 October in Zagreb', zagreb(DISCOUNT_LAUNCH_DATE))
ok(DISCOUNT_ELIGIBLE_FROM === '2026-09-30T22:00:00.000Z' && zagreb(DISCOUNT_ELIGIBLE_FROM) === '01/10/2026, 00:00:00',
   'the earliest first payment that can earn it is 00:00 on 1 October in Zagreb (22:00 UTC on 30 September; 9 September until Lovro moved it on 19 October)', zagreb(DISCOUNT_ELIGIBLE_FROM))
ok(zagreb(Date.parse(DISCOUNT_ELIGIBLE_FROM) - 1) === '30/09/2026, 23:59:59',
   'one millisecond earlier it is still 30 September in Zagreb (summer time, UTC+2)', zagreb(Date.parse(DISCOUNT_ELIGIBLE_FROM) - 1))
ok(DISCOUNT_SHARED_DEADLINE === '2026-10-23T21:59:59.999Z' && zagreb(DISCOUNT_SHARED_DEADLINE) === '23/10/2026, 23:59:59',
   'the shared deadline is the last moment of 23 October in Zagreb', zagreb(DISCOUNT_SHARED_DEADLINE))
ok(zagreb(Date.parse(DISCOUNT_SHARED_DEADLINE) + 1) === '24/10/2026, 00:00:00',
   'one millisecond later it is 24 October in Zagreb: still summer time on the 23rd (the clocks go back on the 25th)', zagreb(Date.parse(DISCOUNT_SHARED_DEADLINE) + 1))

console.log('\n=== discountEndsAt / discountWindow ===')
ok(discountEndsAt(PAID)?.toISOString() === ENDS, '14 days after the first payment, to the millisecond', discountEndsAt(PAID)?.toISOString())
ok(discountEndsAt(PAID).getTime() - Date.parse(PAID) === 14 * DAY, 'exactly 14 x 24 hours')
ok(discountEndsAt(null) === null, 'no first payment: no end')
ok(discountEndsAt('') === null, 'an empty date: no end')
ok(discountEndsAt('not a date') === null, 'a date that does not parse: no end')
ok(discountEndsAt('2026-13-45') === null, 'an impossible date: no end')
ok(discountEndsAt('2026-10-02T10:00:00.000Z')?.toISOString() === DISCOUNT_SHARED_DEADLINE, 'a first payment on 2 October: the shared deadline')
ok(discountEndsAt('2026-09-15T10:00:00.000Z') === null, 'a first payment on 15 September: no end (it had the shared deadline until the first date moved to 1 October)')
ok(discountEndsAt(DISCOUNT_ELIGIBLE_FROM)?.toISOString() === DISCOUNT_SHARED_DEADLINE, 'a first payment at 00:00 on 1 October in Croatia: the shared deadline')
ok(discountEndsAt('2026-09-30T21:59:59.999Z') === null, 'the millisecond before it: no end, the offer is not open to it')
ok(discountEndsAt('2026-06-01T00:00:00.000Z') === null, 'a June payment: no end')
ok(discountEndsAt('2026-10-08T21:59:59.999Z')?.toISOString() === DISCOUNT_SHARED_DEADLINE, 'the millisecond before the launch: the shared deadline')
ok(discountEndsAt(DISCOUNT_LAUNCH_DATE)?.toISOString() === '2026-10-22T22:00:00.000Z',
   'at the launch instant: its own 14 days, to 00:00 on 23 October in Croatia', discountEndsAt(DISCOUNT_LAUNCH_DATE)?.toISOString())
ok(same(discountWindow(null), { closed: 'no-payment' }) && same(discountWindow('garbage'), { closed: 'no-payment' }),
   'discountWindow: no first payment, or one that does not parse, is closed as no payment')
ok(same(discountWindow('2026-09-30T21:59:59.999Z'), { closed: 'before-launch' }) && same(discountWindow('2026-09-15T10:00:00.000Z'), { closed: 'before-launch' }),
   'discountWindow: before 1 October is closed as before-launch, a 15 September payment too')
ok(discountWindow('2026-10-02T10:00:00.000Z').window === 'shared' && discountWindow(DISCOUNT_LAUNCH_DATE).window === 'own' && discountWindow(PAID).window === 'own',
   'discountWindow: shared before the launch, own from it')

console.log('\n=== gateLessonId / requiredLessons ===')
ok(gateLessonId(COURSE) === 'x06', 'the gate is the lesson marked is_gate')
ok(gateLessonId(COURSE.map((l) => ({ ...l, is_gate: false }))) === null, 'no lesson marked: no gate')
{
  const ids = requiredLessons(COURSE).map((l) => l.id)
  ok(same(ids, ['x01', 'x05', 'x06']), 'asks for counting watch lessons with a video, up to and including the gate', show(ids))
  ok(!ids.includes('x07') && !ids.includes('x08'), 'stops at the gate: nothing after it is asked for')
  ok(!ids.includes('x02'), 'skips a setup lesson')
  ok(!ids.includes('x03'), 'skips a lesson without a video')
  ok(!ids.includes('x04'), 'skips a lesson that does not count')
  ok(ids.includes('x05'), 'a lesson with a video but no length is still asked for')
}
ok(requiredLessons(COURSE.map((l) => ({ ...l, is_gate: false }))).length === 0, 'no gate: nothing asked for')
ok(requiredLessons([]).length === 0, 'no lessons: nothing asked for')
ok(same(requiredLessons([L('g', { is_gate: true }), L('y')]).map((l) => l.id), ['g']), 'a gate in first place asks for itself only')
ok(requiredLessons([L('g', { is_gate: true, has_video: false })]).length === 0, 'a gate with no video is not asked for')

console.log('\n=== discountState: who cannot earn it ===')
ok(same(state({ firstPaidAt: null }), { kind: 'not-eligible', reason: 'no-payment' }), 'no first payment', show(state({ firstPaidAt: null })))
ok(same(state({ firstPaidAt: 'garbage' }), { kind: 'not-eligible', reason: 'no-payment' }), 'a first payment that does not parse counts as none')
{
  // 1 October, midnight in Croatia (UTC+2): 30 September 23:59 against 1 October 00:00.
  const ON_19_OCT = new Date('2026-10-19T08:00:00Z')
  ok(same(state({ firstPaidAt: '2026-09-30T21:59:00.000Z', now: ON_19_OCT }), { kind: 'not-eligible', reason: 'before-launch' }),
     'a first payment at 23:59 on 30 September in Croatia (21:59 UTC): never')
  ok(same(state({ firstPaidAt: '2026-09-30T21:59:59.999Z', now: ON_19_OCT }), { kind: 'not-eligible', reason: 'before-launch' }),
     'the millisecond before midnight on 1 October in Croatia: never')
  const s = state({ firstPaidAt: '2026-09-30T22:00:00.000Z', now: ON_19_OCT })
  ok(s.kind === 'locked' && s.window === 'shared' && s.endsAt === DISCOUNT_SHARED_DEADLINE,
     'a first payment at 00:00 on 1 October in Croatia (22:00 UTC on 30 September) is in, with the shared deadline', show(s))
  ok(same(state({ firstPaidAt: '2026-09-15T10:00:00.000Z', now: ON_19_OCT }), { kind: 'not-eligible', reason: 'before-launch' }),
     'a first payment on 15 September: never (it had the shared deadline while the first date was 9 September)')
  ok(same(state({ firstPaidAt: '2026-09-08T22:00:00.000Z', now: ON_19_OCT }), { kind: 'not-eligible', reason: 'before-launch' }),
     'a first payment at 00:00 on 9 September in Croatia, the old first date: never')
  ok(same(state({ firstPaidAt: '2026-06-01T00:00:00Z', now: ON_19_OCT }), { kind: 'not-eligible', reason: 'before-launch' }), 'a June student: never')
}
ok(same(state({ firstPaidAt: '2026-09-25T00:00:00Z', now: new Date('2026-09-28T00:00:00Z') }), { kind: 'not-eligible', reason: 'before-launch' }),
   'before 1 October wins even inside that payment\'s own 14 days')
ok(state({ firstPaidAt: '2026-10-08T23:30:00.000Z', now: new Date('2026-10-10T00:00:00Z') }).kind === 'locked',
   'a first payment at 01:30 on 9 October in Croatia (23:30 UTC on the 8th) is in')
ok(state({ firstPaidAt: '2026-10-08T22:00:00.000Z', now: new Date('2026-10-10T00:00:00Z') }).kind === 'locked', 'a first payment at the launch instant is in')
ok(same(state({ lessons: COURSE.map((l) => ({ ...l, is_gate: false })) }), { kind: 'not-eligible', reason: 'no-gate' }), 'a catalog with no gate closes the offer')
ok(same(state({ lessons: [] }), { kind: 'not-eligible', reason: 'no-gate' }), 'an empty catalog closes the offer')
ok(same(state({ lessons: COURSE.map((l) => ({ ...l, has_video: false })) }), { kind: 'not-eligible', reason: 'no-gate' }),
   'a gate with not one video up to it closes the offer (never "ready" with nothing watched)')
ok(same(state({ lessons: COURSE.map((l) => ({ ...l, has_video: false })), now: AFTER }), { kind: 'not-eligible', reason: 'no-gate' }),
   'the same after the window')

console.log('\n=== discountState: locked, ready, expired ===')
{
  const s = state()
  ok(same(s, { kind: 'locked', endsAt: ENDS, window: 'own', lessonsLeft: 3, lessonsDone: 0, lessonsNeeded: 3, lessonsTotal: 3, secondsLeft: 1200, nextLessonId: 'x01' }),
     'nothing watched: 80% of 3 is all 3, so 3 left, 300 + 0 (no length) + 900 seconds, next is the first in course order', show(s))
}
{
  const s = state({ videoDoneIds: new Set(['x01', 'x07', 'x03']) })
  ok(s.kind === 'locked' && s.lessonsLeft === 2 && s.lessonsDone === 1 && s.lessonsTotal === 3 && s.secondsLeft === 900 && s.nextLessonId === 'x05',
     'lessons done that are not counted change nothing; the next is the first one left', show(s))
}
{
  const s = state({ videoDoneIds: new Set(['x01', 'x05']) })
  ok(s.kind === 'locked' && s.lessonsLeft === 1 && s.nextLessonId === 'x06' && s.secondsLeft === 900, 'only the gate left', show(s))
}
{
  const s = state({ videoDoneIds: new Set(['x01', 'x05', 'x06']) })
  ok(same(s, { kind: 'ready', endsAt: ENDS, window: 'own', lessonsDone: 3, lessonsNeeded: 3, lessonsTotal: 3 }), 'every counted video done inside the 14 days: ready', show(s))
}
ok(state({ videoDoneIds: new Set(['x01', 'x05', 'x06']), now: new Date(ENDS) }).kind === 'ready', 'still ready at the exact end of the window')
{
  const s = state({ now: AFTER, videoDoneIds: new Set(['x01']) })
  ok(same(s, { kind: 'expired', endsAt: ENDS, window: 'own', lessonsLeft: 2 }), 'after the window: expired, with the lessons that were left', show(s))
}
ok(same(state({ now: AFTER, videoDoneIds: new Set(['x01', 'x05', 'x06']) }), { kind: 'expired', endsAt: ENDS, window: 'own', lessonsLeft: 0 }),
   'after the window with everything done and no request: expired')
ok(state({ now: new Date(Date.parse(ENDS) + 1) }).kind === 'expired', 'one millisecond after the window: expired')

console.log('\n=== discountState: the shared deadline (a first payment from 1 October until the launch) ===')
{
  const OCT2 = '2026-10-02T10:00:00.000Z'
  const ALL = new Set(['x01', 'x05', 'x06'])
  const oct2 = (o) => state({ firstPaidAt: OCT2, ...o })
  // Croatia is UTC+2 until 25 October: 23:59 on the 23rd is 21:59 UTC, 00:00 on the 24th is 22:00 UTC.
  const OCT23_2359 = new Date('2026-10-23T21:59:00.000Z')
  const OCT24_0000 = new Date('2026-10-23T22:00:00.000Z')
  {
    const s = oct2({ now: new Date('2026-10-19T08:00:00Z') })
    ok(same(s, { kind: 'locked', endsAt: DISCOUNT_SHARED_DEADLINE, window: 'shared', lessonsLeft: 3, lessonsDone: 0, lessonsNeeded: 3, lessonsTotal: 3, secondsLeft: 1200, nextLessonId: 'x01' }),
       'paid 2 October, on 19 October: locked, until the end of 23 October', show(s))
  }
  ok(oct2({ now: new Date('2026-10-17T10:00:00Z') }).kind === 'locked',
     'on 17 October, while the app is closed: locked, never expired, though the payment is 15 days old (its own 14 days would be over)')
  ok(oct2({ now: OCT23_2359, videoDoneIds: ALL }).kind === 'ready', 'every video done, at 23:59 on 23 October in Croatia: ready')
  ok(oct2({ now: new Date(DISCOUNT_SHARED_DEADLINE), videoDoneIds: ALL }).kind === 'ready', 'and at the deadline\'s last millisecond: ready')
  {
    const s = oct2({ now: OCT24_0000, videoDoneIds: ALL })
    ok(same(s, { kind: 'expired', endsAt: DISCOUNT_SHARED_DEADLINE, window: 'shared', lessonsLeft: 0 }),
       'at 00:00 on 24 October in Croatia: expired, even with everything done', show(s))
  }
  ok(oct2({ now: OCT24_0000, videoDoneIds: new Set(['x01']) }).lessonsLeft === 2, 'expired, with the lessons that were left')
  ok(oct2({ now: OCT23_2359, requests: [R('r', 'pending', '2026-10-23T21:30:00.000Z')] }).kind === 'pending'
       && oct2({ now: OCT24_0000, requests: [R('r', 'pending', '2026-10-23T21:30:00.000Z')] }).kind === 'pending',
     'a request sent at 23:30 on 23 October still decides after the deadline')
  // The launch boundary: the shared deadline before it, the own 14 days from it.
  const NOON_23 = new Date('2026-10-23T10:00:00Z')
  const eve = state({ firstPaidAt: '2026-10-08T21:59:59.999Z', now: NOON_23 })
  ok(eve.kind === 'locked' && eve.window === 'shared' && eve.endsAt === DISCOUNT_SHARED_DEADLINE,
     'paid the millisecond before the launch: the shared deadline, so open at noon on 23 October', show(eve))
  const launch = state({ firstPaidAt: DISCOUNT_LAUNCH_DATE, now: NOON_23 })
  ok(launch.kind === 'expired' && launch.window === 'own' && launch.endsAt === '2026-10-22T22:00:00.000Z',
     'paid at the launch instant: its own 14 days, over at 00:00 on 23 October in Croatia, so closed at noon that day (as Lovro set it: 14 days from a payment after the launch)', show(launch))
}

console.log('\n=== discountState: a first payment after the launch keeps its own 14 days ===')
{
  // A buyer after the app reopens, and a buyer on 10 October whose 14 days run past the shared deadline.
  const P = '2026-10-20T15:30:00.000Z'
  const P_ENDS = '2026-11-03T15:30:00.000Z'
  const ALL = new Set(['x01', 'x05', 'x06'])
  ok(state({ firstPaidAt: P, now: new Date('2026-11-02T15:30:00Z') }).kind === 'locked', 'paid 20 October, day 13: locked')
  {
    const s = state({ firstPaidAt: P, now: new Date(P_ENDS), videoDoneIds: ALL })
    ok(same(s, { kind: 'ready', endsAt: P_ENDS, window: 'own', lessonsDone: 3, lessonsNeeded: 3, lessonsTotal: 3 }), 'day 14 to the millisecond: ready', show(s))
  }
  ok(state({ firstPaidAt: P, now: new Date(Date.parse(P_ENDS) + 1), videoDoneIds: ALL }).kind === 'expired', 'one millisecond past day 14: expired')
  const tenth = state({ now: new Date('2026-10-24T08:00:00Z') })
  ok(tenth.kind === 'locked' && tenth.endsAt === ENDS && tenth.window === 'own',
     'paid 10 October, on 24 October: still open to its own day 14, the shared deadline never shortens it', show(tenth))
}

console.log('\n=== discountState: a request decides ===')
for (const status of ['pending', 'approved', 'applied', 'rejected']) {
  const req = R('req-1', status, '2026-10-20T10:00:00.000Z', { promo_code: status === 'approved' ? 'ECOM30-ABC' : null, rejection_reason: status === 'rejected' ? 'no' : null })
  const want = { kind: status, requestId: 'req-1', at: '2026-10-20T10:00:00.000Z', promoCode: req.promo_code, rejectionReason: req.rejection_reason, madeBeforeLaunch: false }
  ok(same(state({ requests: [req] }), want), `${status}: the request decides inside the window`, show(state({ requests: [req] })))
  ok(same(state({ requests: [req], now: AFTER }), want), `${status}: and after the window`)
  ok(state({ requests: [req], firstPaidAt: null }).kind === status && state({ requests: [req], firstPaidAt: '2026-09-01T00:00:00Z' }).kind === status,
     `${status}: and without a first payment, or with one before the launch`)
  ok(state({ requests: [req], lessons: [] }).kind === status, `${status}: and with no gate`)
}
{
  const s = state({ requests: [R('r', 'pending', '2026-10-20T10:00:00Z')] })
  ok(s.promoCode === null && s.rejectionReason === null, 'a request row without promo_code or rejection_reason reads as null, never undefined', show(s))
}
{
  const reqs = [R('old', 'rejected', '2026-10-12T10:00:00Z'), R('new', 'pending', '2026-10-14T10:00:00Z'), R('mid', 'approved', '2026-10-13T10:00:00Z')]
  ok(state({ requests: reqs }).requestId === 'new', 'the newest request wins, whatever order the rows come in')
  ok(state({ requests: [...reqs].reverse() }).requestId === 'new', 'the same, rows reversed')
  ok(state({ requests: [R('a', 'pending', '2026-10-12T10:00:00Z'), R('b', 'rejected', '2026-10-14T10:00:00Z')] }).kind === 'rejected', 'a newer rejection beats an older pending one')
}

console.log('\n=== discountState: a request from the old course, made before the launch ===')
{
  // Everyone the old course's request means nothing to: a student the offer is closed to, and one who first paid after the launch.
  const june = R('june', 'approved', '2026-06-12T10:00:00.000Z', { promo_code: 'ECOM30-OLD' })
  const s = state({ firstPaidAt: '2026-06-01T00:00:00Z', now: new Date('2026-10-15T00:00:00Z'), requests: [june] })
  ok(same(s, { kind: 'not-eligible', reason: 'before-launch' }), 'a June student with an approved June request sees "not eligible", never "approved"', show(s))
  ok(same(state({ firstPaidAt: '2026-09-15T10:00:00Z', now: new Date('2026-10-19T08:00:00Z'), requests: [R('early', 'applied', '2026-09-25T10:00:00Z')] }),
          { kind: 'not-eligible', reason: 'before-launch' }),
     'first paid 15 September (before 1 October) with the 30% applied on 25 September: "not eligible" too (it showed as theirs while the first date was 9 September)')
  ok(same(state({ firstPaidAt: null, requests: [R('old', 'approved', '2026-09-25T10:00:00Z')] }), { kind: 'not-eligible', reason: 'no-payment' }),
     'no first payment on record, an old approved request: "no payment", as before')
  ok(state({ requests: [R('eve', 'pending', '2026-10-08T21:59:59.999Z')] }).kind === 'locked',
     'first paid after the launch: a request the millisecond before the launch is ignored, as before')
  ok(state({ requests: [R('at', 'pending', '2026-10-08T22:00:00.000Z')] }).kind === 'pending', 'a request at the launch instant counts')
  ok(state({ requests: [R('new', 'pending', '2026-10-12T00:00:00Z'), R('old', 'approved', '2026-07-01T00:00:00Z')] }).requestId === 'new',
     'next to a new request, an old one plays no part')
  ok(state({ requests: [R('old', 'rejected', '2026-09-30T00:00:00Z')], videoDoneIds: new Set(['x01', 'x05', 'x06']) }).kind === 'ready',
     'an old rejection does not stop a new student who is ready')
  ok(state({ requests: [R('bad', 'approved', 'not a date')] }).kind === 'locked', 'a request whose date does not parse is not counted')
}

console.log('\n=== discountState: an early-October joiner who already has a request from the old course (one 30% per student) ===')
{
  // First paid 2 October; requested on the old dashboard on 6 October.
  // The database refuses another request while that one is pending, approved
  // or applied (v29's function, any date; the migration harness, section 26),
  // so the map shows that request. A rejected one does not count.
  const OCT2 = '2026-10-02T10:00:00.000Z'
  const OLD = '2026-10-06T10:00:00.000Z'
  const ALL = new Set(['x01', 'x05', 'x06'])
  const oct2 = (requests, o = {}) => state({ firstPaidAt: OCT2, now: new Date('2026-10-20T10:00:00Z'), videoDoneIds: ALL, requests, ...o })
  for (const status of ['pending', 'approved', 'applied']) {
    const s = oct2([R('old', status, OLD, { promo_code: status === 'pending' ? null : 'ECOM30-OLD' })])
    ok(same(s, { kind: status, requestId: 'old', at: OLD, promoCode: status === 'pending' ? null : 'ECOM30-OLD', rejectionReason: null, madeBeforeLaunch: true }),
       `${status} on the old course: the map shows it (never "ready", with every video done), marked as made before the launch`, show(s))
    ok(oct2([R('old', status, OLD)], { now: new Date('2026-11-01T00:00:00Z') }).kind === status, `${status}: and after the shared deadline`)
  }
  {
    const s = oct2([R('old', 'rejected', OLD, { rejection_reason: 'R2 not finished in time' })])
    ok(same(s, { kind: 'ready', endsAt: DISCOUNT_SHARED_DEADLINE, window: 'shared', lessonsDone: 3, lessonsNeeded: 3, lessonsTotal: 3 }),
       'rejected on the old course: it plays no part, the new offer shows (ready, every video done)', show(s))
    ok(oct2([R('old', 'rejected', OLD)], { videoDoneIds: new Set() }).kind === 'locked', 'rejected, nothing watched yet: locked')
  }
  // The launch is the line between an old request and a new one.
  ok(oct2([R('eve', 'rejected', '2026-10-08T21:59:59.999Z')]).kind === 'ready', 'rejected the millisecond before the launch: plays no part')
  {
    const s = oct2([R('at', 'rejected', '2026-10-08T22:00:00.000Z', { rejection_reason: 'no' })])
    ok(s.kind === 'rejected' && s.madeBeforeLaunch === false,
       'rejected at the launch instant: a new-course request, it decides (D7, unchanged)', show(s))
  }
  ok(oct2([R('eve', 'pending', '2026-10-08T21:59:59.999Z')]).madeBeforeLaunch === true, 'pending the millisecond before the launch: shown, made before the launch')
  // Old and new together.
  {
    const s = oct2([R('old', 'rejected', OLD), R('new', 'pending', '2026-10-12T10:00:00.000Z')])
    ok(s.kind === 'pending' && s.requestId === 'new' && s.madeBeforeLaunch === false, 'rejected on 6 October, applied again on 12 October: the new one', show(s))
  }
  ok(oct2([R('old', 'applied', OLD), R('older', 'rejected', '2026-10-04T10:00:00.000Z')]).requestId === 'old',
     'rejected on 4 October, then applied on 6 October: the applied one')
  // The first payment boundary decides whether an old request counts at all.
  ok(state({ firstPaidAt: '2026-09-30T21:59:59.999Z', now: new Date('2026-10-20T10:00:00Z'), requests: [R('old', 'applied', OLD)] }).kind === 'not-eligible',
     'first paid the millisecond before 1 October: the old request plays no part, "not eligible"')
  ok(state({ firstPaidAt: DISCOUNT_ELIGIBLE_FROM, now: new Date('2026-10-20T10:00:00Z'), requests: [R('old', 'applied', OLD)] }).kind === 'applied',
     'first paid at 00:00 on 1 October in Croatia: the old request is shown')
}

console.log('\n=== requestCounts: the one place that says which requests count ===')
{
  const OCT2 = '2026-10-02T10:00:00.000Z'
  const rows = [
    [R('a', 'pending', '2026-10-06T10:00:00Z'), OCT2, true, 'old pending, early-October joiner'],
    [R('a', 'approved', '2026-10-06T10:00:00Z'), OCT2, true, 'old approved, early-October joiner'],
    [R('a', 'applied', '2026-10-06T10:00:00Z'), OCT2, true, 'old applied, early-October joiner'],
    [R('a', 'rejected', '2026-10-06T10:00:00Z'), OCT2, false, 'old rejected, early-October joiner'],
    [R('a', 'approved', '2026-09-25T10:00:00Z'), '2026-09-15T10:00:00.000Z', false, 'old approved, September joiner (counted while the first date was 9 September)'],
    [R('a', 'approved', '2026-06-12T10:00:00Z'), '2026-06-01T00:00:00Z', false, 'old approved, June student'],
    [R('a', 'approved', '2026-09-25T10:00:00Z'), null, false, 'old approved, no first payment'],
    [R('a', 'approved', '2026-09-25T10:00:00Z'), PAID, false, 'old approved, first paid after the launch'],
    [R('a', 'rejected', DISCOUNT_LAUNCH_DATE), '2026-06-01T00:00:00Z', true, 'any request from the launch on, whoever made it'],
    [R('a', 'approved', 'not a date'), OCT2, false, 'a date that does not parse'],
  ]
  for (const [r, paid, want, label] of rows) ok(requestCounts(r, paid) === want, `${label}: ${want ? 'counts' : 'does not count'}`)
}

console.log('\n=== discount-server: rows to lessons ===')
{
  const rows = [
    { id: 'a', type: 'watch', counts_toward_progress: true, is_gate: false, duration_seconds: 60 },
    { id: 'b', type: 'setup', counts_toward_progress: null, is_gate: null, duration_seconds: null },
    { id: 'c', type: 'watch', counts_toward_progress: false, is_gate: true, duration_seconds: undefined },
  ]
  const ls = toDiscountLessons(rows, new Set(['a', 'zz']))
  ok(same(ls, [
    { id: 'a', type: 'watch', counts_toward_progress: true, is_gate: false, has_video: true, duration_seconds: 60 },
    { id: 'b', type: 'setup', counts_toward_progress: true, is_gate: false, has_video: false, duration_seconds: null },
    { id: 'c', type: 'watch', counts_toward_progress: false, is_gate: true, has_video: false, duration_seconds: null },
  ]), 'has_video from lesson_videos; a null counting flag counts (asks for more), a null gate flag is no gate', show(ls))
}
{
  const rows = [
    { lesson_id: 'a', completed_at: '2026-10-11T00:00:00Z' },
    { lesson_id: 'b', completed_at: null },
    { lesson_id: 'c', completed_at: '2026-10-30T00:00:00Z' },
    { lesson_id: 'd', completed_at: 'nonsense' },
    { lesson_id: 'e', completed_at: '' },
  ]
  ok(same([...videoDoneIds(rows)], ['a', 'c', 'd']), 'done = completed_at set (an action item\'s link half is not read)', show([...videoDoneIds(rows)]))
  ok(same([...videoDoneIds(rows, new Date(ENDS))], ['a']), 'with a limit: only done at or before it, a date that does not parse is not done')
  ok(same([...videoDoneIds([{ lesson_id: 'a', completed_at: ENDS }], new Date(ENDS))], ['a']), 'done at the exact limit counts')
}

// Stand-in reads, shaped as supabase-js hands them back.
const catalogRows = (lessons) => lessons.map(({ id, type, counts_toward_progress, is_gate, duration_seconds }) => ({ id, type, counts_toward_progress, is_gate, duration_seconds }))
const okRead = (data) => ({ data, error: null })
const badRead = (message) => ({ data: null, error: { message } })
const reads = (o = {}) => ({
  student: okRead({ first_paid_at: PAID }),
  lessons: okRead(catalogRows(COURSE)),
  videos: okRead(COURSE.filter((l) => l.has_video).map((l) => ({ lesson_id: l.id }))),
  completions: okRead([]),
  requests: okRead([]),
  ...o,
})
const done = (ids, at = '2026-10-12T00:00:00Z') => okRead(ids.map((lesson_id) => ({ lesson_id, completed_at: at })))

console.log('\n=== discount-server: reads fail closed ===')
{
  const f = factsFromReads(reads())
  ok(f.ok && f.facts.firstPaidAt === PAID && f.facts.lessons.length === 8 && f.facts.lessons[5].is_gate && !f.facts.lessons[2].has_video,
     'good reads become discount.ts\'s input')
}
for (const key of ['student', 'lessons', 'videos', 'completions', 'requests']) {
  const f1 = factsFromReads(reads({ [key]: badRead('boom') }))
  ok(!f1.ok && f1.failed.length === 1 && f1.failed[0].endsWith(': boom'), `${key} errors: no facts`, show(f1.failed))
  const f2 = factsFromReads(reads({ [key]: { data: null, error: null } }))
  ok(!f2.ok, `${key} comes back with no data and no error: no facts`, show(f2.failed))
}
{
  const f = factsFromReads(reads({ lessons: okRead([]) }))
  ok(!f.ok && f.failed[0] === 'lessons: the catalog is empty', 'an empty catalog is a failed read, never "no gate"', show(f.failed))
}

console.log('\n=== decideDiscountRequest (POST /api/discounts/request on the new course) ===')
{
  const d = decideDiscountRequest(reads({ completions: done(['x01', 'x05', 'x06']) }), IN_WINDOW)
  ok(same(d, { grant: true }), 'ready: granted', show(d))
}
{
  const d = decideDiscountRequest(reads({ videos: badRead('permission denied for table lesson_videos') }), IN_WINDOW)
  ok(!d.grant && d.status === 500 && d.state === 'read-failed' && d.log.includes('lesson_videos: permission denied'),
     'lesson_videos cannot be read: 500, nothing granted, the reason in the log only', show(d))
  ok(!d.error.includes('lesson_videos'), 'the student never sees a table name', d.error)
}
ok(decideDiscountRequest(reads({ lessons: okRead([]) }), IN_WINDOW).status === 500, 'no catalog: 500, nothing granted')
ok(decideDiscountRequest(reads({ completions: badRead('x'), requests: badRead('y') }), IN_WINDOW).log.includes('student_lesson_completions: x; discount_requests: y'),
   'every failed read is named in the log')
{
  const d = decideDiscountRequest(reads({ completions: done(['x01']) }), IN_WINDOW)
  ok(!d.grant && d.status === 400 && d.state === 'locked', 'locked: 400', show(d))
  ok(d.error === 'You need 2 more videos to reach 80%, about 15 minutes of video. Watch them before your deadline and apply again.',
     'locked says how many more videos the 80% needs (it said "You have 2 videos left to watch" until 2026-10-26)', d.error)
}
{
  const d = decideDiscountRequest(reads({ completions: done(['x01', 'x05']) }), IN_WINDOW)
  ok(d.error === 'You need 1 more video to reach 80%, about 15 minutes of video. Watch it before your deadline and apply again.', 'one video more reads in the singular', d.error)
}
{
  const d = decideDiscountRequest(reads({ completions: done(['x01', 'x06']) }), IN_WINDOW)
  ok(d.error === 'You need 1 more video to reach 80%. Watch it before your deadline and apply again.', 'no length known: no time in the sentence', d.error)
}
{
  const d = decideDiscountRequest(reads({ completions: done(['x01', 'x05', 'x06']) }), AFTER)
  ok(!d.grant && d.status === 400 && d.state === 'expired' && d.error === 'Your deadline for the 30% has passed.', 'expired: 400, even with every video done', d.error)
}
{
  const d = decideDiscountRequest(reads({ student: okRead({ first_paid_at: '2026-09-15T10:00:00Z' }), completions: done(['x01', 'x05', 'x06']) }), new Date('2026-10-19T08:00:00Z'))
  ok(!d.grant && d.status === 400 && d.state === 'not-eligible'
       && d.error === 'Your 2 weeks for the 30% have passed.',
     'first payment on 15 September (before 1 October), every video done, applied on 19 October: 400, not eligible, its 2 weeks passed', d.error)
}
{
  const d = decideDiscountRequest(reads({ student: okRead({ first_paid_at: '2026-09-30T21:59:59.999Z' }), completions: done(['x01', 'x05', 'x06']) }), new Date('2026-10-19T08:00:00Z'))
  const d2 = decideDiscountRequest(reads({ student: okRead({ first_paid_at: '2026-09-30T22:00:00.000Z' }), completions: done(['x01', 'x05', 'x06']) }), new Date('2026-10-19T08:00:00Z'))
  ok(!d.grant && d.state === 'not-eligible' && d2.grant === true,
     'the route at the line: the millisecond before 00:00 on 1 October in Croatia refused, 00:00 itself granted', show({ d, d2 }))
}
{
  // East of Croatia the line falls on 1 October: 05:59 in Manila is 23:59 on 30 September in Croatia (the cutoff fix round, 2026-10-19).
  // Until 2026-10-20 the refusal named the day with "Croatia time"; it names no date now, so the Manila payment reads as any other before it.
  const d = decideDiscountRequest(reads({ student: okRead({ first_paid_at: '2026-10-01T05:59:59.999+08:00' }), completions: done(['x01', 'x05', 'x06']) }), new Date('2026-10-19T08:00:00Z'))
  ok(!d.grant && d.state === 'not-eligible' && d.error === 'Your 2 weeks for the 30% have passed.',
     'a first payment at 05:59 on 1 October in Manila (23:59 on 30 September in Croatia): refused, in the same words as any first payment before 1 October', d.error)
}
{
  const d = decideDiscountRequest(reads({ student: okRead({ first_paid_at: '2026-10-01T00:00:00Z' }), completions: done(['x01', 'x05', 'x06']) }), new Date('2026-10-19T08:00:00Z'))
  ok(d.grant === true, 'first payment on 1 October, every video done, applied on 19 October: granted (refused until T-080)', show(d))
}
{
  const d = decideDiscountRequest(reads({ student: okRead({ first_paid_at: '2026-10-02T10:00:00Z' }), completions: done(['x01']) }), new Date('2026-10-20T10:00:00Z'))
  ok(!d.grant && d.state === 'locked'
       && d.error === 'You need 2 more videos to reach 80%, about 15 minutes of video. Watch them before your deadline and apply again.',
     'an early-October joiner with videos left reads the same sentence as a student with their own 14 days: no date and never "your 14 days" (their deadline, 23 October, is the panel\'s "Apply by")', d.error)
}
{
  const d = decideDiscountRequest(reads({ student: okRead({ first_paid_at: '2026-10-02T10:00:00Z' }), completions: done(['x01', 'x05', 'x06']) }), new Date('2026-10-23T22:00:00.000Z'))
  ok(!d.grant && d.status === 400 && d.state === 'expired'
       && d.error === 'Your deadline for the 30% has passed.',
     'an early-October joiner at 00:00 on 24 October in Croatia, every video done: expired, in the same words as any other', d.error)
}
{
  const d = decideDiscountRequest(reads({ student: okRead({ first_paid_at: null }) }), IN_WINDOW)
  ok(!d.grant && d.state === 'not-eligible'
       && d.error === "We can't see your first payment yet. Tell the team and they'll sort it out.",
     'no first payment: 400, not eligible, with no length of window named (it may be 23 October, not 14 days)', d.error)
}
{
  const d = decideDiscountRequest(reads({ lessons: okRead(catalogRows(COURSE).map((l) => ({ ...l, is_gate: false }))), completions: done(['x01', 'x05', 'x06']) }), IN_WINDOW)
  ok(!d.grant && d.status === 400 && d.state === 'not-eligible' && /no gate lesson/.test(d.log ?? ''), 'no gate: 400, nothing granted, logged for the team', show(d))
}
{
  const d = decideDiscountRequest(reads({ videos: okRead([]) }), IN_WINDOW)
  ok(!d.grant && d.status === 400 && d.state === 'not-eligible' && /no lesson up to it has a video/.test(d.log ?? ''),
     'no video loaded yet (lesson_videos empty): nothing granted to a student who watched nothing', show(d))
}
for (const status of ['pending', 'approved', 'applied', 'rejected']) {
  const d = decideDiscountRequest(reads({ completions: done(['x01', 'x05', 'x06']), requests: okRead([R('r', status, '2026-10-12T00:00:00Z')]) }), IN_WINDOW)
  ok(!d.grant && d.status === 400 && d.state === status, `already requested (${status}): 400, no second request`, d.error)
}
{
  const all = [
    { kind: 'locked', lessonsLeft: 3, lessonsDone: 0, lessonsNeeded: 3, lessonsTotal: 3, secondsLeft: 7200, endsAt: ENDS, window: 'own', nextLessonId: 'x' },
    { kind: 'locked', lessonsLeft: 1, lessonsDone: 2, lessonsNeeded: 3, lessonsTotal: 3, secondsLeft: 0, endsAt: DISCOUNT_SHARED_DEADLINE, window: 'shared', nextLessonId: 'x' },
    { kind: 'expired', endsAt: ENDS, window: 'own', lessonsLeft: 0 },
    { kind: 'expired', endsAt: DISCOUNT_SHARED_DEADLINE, window: 'shared', lessonsLeft: 0 },
    ...['no-payment', 'before-launch', 'no-gate'].map((reason) => ({ kind: 'not-eligible', reason })),
    ...['pending', 'approved', 'applied', 'rejected'].map((kind) => ({ kind, requestId: 'r', at: ENDS, promoCode: null, rejectionReason: null, madeBeforeLaunch: false })),
  ]
  const msgs = all.map(discountRefusalMessage)
  ok(msgs.every((m) => m.length > 0 && !m.includes('—') && !/\bR[12]\b/.test(m) && !/unlock/i.test(m)),
     'every refusal is a plain sentence: no em dash, no region code, no "unlock"', show(msgs))
  ok(msgs[0].includes('about 2 hours of video'), 'hours read as hours', msgs[0])
  ok(msgs[1] === 'You need 1 more video to reach 80%. Watch it before your deadline and apply again.',
     'the shared deadline in the singular, with no length known', msgs[1])
  // Since 2026-10-20 the panel says the rule in one line (checkpointView.ts discountRule) and a refusal says only the
  // fact: the shared window's words are the own window's, and no refusal names a date, a clock or a length of window.
  ok(discountRefusalMessage({ ...all[1], window: 'own' }) === msgs[1] && msgs[3] === msgs[2],
     'the shared deadline reads the same as the own 14 days, locked and expired', show([msgs[1], msgs[2], msgs[3]]))
  ok(msgs.every((m) => !/Croatia|October|September|\b14\b|\d{4}/.test(m)), 'no refusal names a date, a clock or the 14 days', show(msgs))
  ok(!msgs[1].includes('14 days') && !msgs[3].includes('14 days') && !msgs[4].includes('14 days'),
     'a student who joined before the launch never reads "14 days", nor does a student whose first payment is not found yet', show([msgs[1], msgs[3], msgs[4]]))
  ok(msgs[2] === 'Your deadline for the 30% has passed.', 'expired: the deadline has passed, with no date', msgs[2])
  ok(msgs[4] === "We can't see your first payment yet. Tell the team and they'll sort it out.", 'no first payment: tell the team', msgs[4])
  ok(msgs[5] === 'Your 2 weeks for the 30% have passed.',
     'before-launch: its 2 weeks have passed, with no date (the panel says the rule)', msgs[5])
  ok(msgs[6] === "The discount can't be applied for right now. Contact support and we'll sort it out.", 'no gate: the words it had', msgs[6])

  console.log('\n=== The words a student reads about the 30%: one line on the panel, "2 weeks" is DISCOUNT_WINDOW_DAYS ===')
  // Lovro, 2026-10-20: "I see there's a lot of confusion for the 30% off. Just write complete until video ads 2
  // within 2 weeks of joining to apply. That's it." The panel's words are checkpointView.ts's, the place's name the
  // course's own (Video Ads II on the real course, CHECKPOINT.after). Since 2026-10-26 the owner's 80%: the line is
  // the one-line words with "Finish every video" become "Watch 80% of the videos", and nothing else changed.
  const rule = discountRule('Video Ads II')
  ok(rule.open === 'Watch 80% of the videos through Video Ads II within 2 weeks of joining to apply.',
     'the panel\'s line while the 30% can be earned (locked, and with no first payment on record)', rule.open)
  ok(rule.closed === 'The 30% is for watching 80% of the videos through Video Ads II within 2 weeks of joining.',
     'the same rule once the student\'s deadline has passed, after "This closed on <deadline>."', rule.closed)
  ok(rule.beforeLaunch === 'Your 2 weeks have passed. The 30% is for watching 80% of the videos through Video Ads II within 2 weeks of joining.',
     'a first payment before 1 October', rule.beforeLaunch)
  ok(rule.ready === "You've watched at least 80% of the videos through Video Ads II. Apply now and the team confirms within 48 hours.",
     'ready, above Apply ("Every video through Video Ads II is watched." until 2026-10-26)', rule.ready)
  ok(discountRule('Somewhere Else').open === 'Watch 80% of the videos through Somewhere Else within 2 weeks of joining to apply.',
     'the place is the name handed in, never written into the words')
  ok(DISCOUNT_VIDEO_SHARE === 80 && [rule.open, rule.closed, rule.ready].every((m) => m.includes(`${DISCOUNT_VIDEO_SHARE}% of the videos`)),
     'the 80% in the words is DISCOUNT_VIDEO_SHARE, the rule\'s own number')
  const twoWeeks = [rule.open, rule.closed, rule.beforeLaunch, msgs[5]]
  ok(DISCOUNT_WINDOW_DAYS === 14 && twoWeeks.every((m) => m.includes('2 weeks')),
     'the words say "2 weeks" and DISCOUNT_WINDOW_DAYS is 14: if the window ever changes, change these words with it (checkpointView.ts discountRule, discount-server.ts before-launch)',
     `${DISCOUNT_WINDOW_DAYS} days; ${show(twoWeeks)}`)
  ok([rule.open, rule.closed, rule.beforeLaunch, rule.ready, ...msgs].every((m) => !m.includes('—') && !/unlock|EcomTalent/i.test(m) && !/\btwo\b|fourteen/i.test(m)),
     'no em dash, no "unlock", no "EcomTalent", numbers as digits')
}

{
  // A request from the old course, on the server.
  const june = R('june', 'approved', '2026-06-12T10:00:00.000Z', { promo_code: 'ECOM30-OLD' })
  const d = decideDiscountRequest(reads({ student: okRead({ first_paid_at: '2026-06-01T00:00:00Z' }), requests: okRead([june]) }), new Date('2026-10-15T00:00:00Z'))
  ok(!d.grant && d.state === 'not-eligible', 'and the server refuses that June student as not eligible, not as already requested', d.error)
  const d2 = decideDiscountRequest(reads({ completions: done(['x01', 'x05', 'x06']), requests: okRead([R('old', 'rejected', '2026-09-30T00:00:00Z')]) }), IN_WINDOW)
  ok(d2.grant === true, 'the server grants a ready student whose only request is from the old course')
}

console.log('\n=== decideDiscountRequest: an early-October joiner who already has a request from the old course ===')
{
  // The map and the server judge the same rows the same way, and the server
  // refuses before the database would (v29 refuses another request while one
  // is pending, approved or applied, whatever its date).
  const OCT2 = okRead({ first_paid_at: '2026-10-02T10:00:00.000Z' })
  const NOW = new Date('2026-10-20T10:00:00Z')
  const ALL = ['x01', 'x05', 'x06']
  const words = {
    pending: "You already applied for the discount. We're reviewing it.",
    approved: 'Your discount is already approved.',
    applied: 'Your discount is already on your membership.',
  }
  for (const status of ['pending', 'approved', 'applied', 'rejected']) {
    const old = R('old', status, '2026-10-06T10:00:00.000Z')
    const d = decideDiscountRequest(reads({ student: OCT2, completions: done(ALL), requests: okRead([old]) }), NOW)
    const map = discountState({ now: NOW, firstPaidAt: '2026-10-02T10:00:00.000Z', lessons: COURSE, videoDoneIds: new Set(ALL), requests: [old] })
    if (status === 'rejected') {
      ok(d.grant === true && map.kind === 'ready', 'rejected on the old course, every video done: the server grants, the map shows Apply', show({ d, map: map.kind }))
    } else {
      ok(!d.grant && d.status === 400 && d.state === status && d.state === map.kind && d.error === words[status],
         `${status} on the old course, every video done: refused as ${status}, in the app's own words, as the map shows it`, show(d))
    }
  }
  // A September joiner holding one: the offer is closed to them since the first date moved to 1 October, so the map
  // and the server both say so, whatever the old request's status (it showed as theirs while the date was 9 September).
  for (const status of ['pending', 'approved', 'applied', 'rejected']) {
    const old = R('old', status, '2026-09-25T10:00:00.000Z')
    const d = decideDiscountRequest(reads({ student: okRead({ first_paid_at: '2026-09-15T10:00:00.000Z' }), completions: done(ALL), requests: okRead([old]) }), NOW)
    const map = discountState({ now: NOW, firstPaidAt: '2026-09-15T10:00:00.000Z', lessons: COURSE, videoDoneIds: new Set(ALL), requests: [old] })
    ok(!d.grant && d.status === 400 && d.state === 'not-eligible' && map.kind === 'not-eligible' && map.reason === 'before-launch' && d.error === 'Your 2 weeks for the 30% have passed.',
       `paid 15 September, ${status} on the old dashboard: the map says closed and the server refuses as not eligible`, show({ d: d.error, map }))
  }
}

console.log('\n=== approvalVerdict (POST /api/discounts/approve on the new course) ===')
ok(same(approvalVerdict(reads({ completions: done(['x01', 'x05', 'x06']) }), IN_WINDOW), { ok: true }), 'everything done inside the window: approve')
ok(approvalVerdict(reads({ completions: done(['x01', 'x05', 'x06']), requests: okRead([R('r', 'pending', '2026-10-12T00:00:00Z')]) }), IN_WINDOW).ok,
   'the pending request being approved does not decide its own approval')
ok(approvalVerdict(reads({ completions: done(['x01', 'x05', 'x06']) }), new Date('2026-12-01T00:00:00Z')).ok,
   'approved weeks after the window when the videos were done inside it')
{
  const late = okRead([
    { lesson_id: 'x01', completed_at: '2026-10-12T00:00:00Z' },
    { lesson_id: 'x05', completed_at: '2026-10-12T00:00:00Z' },
    { lesson_id: 'x06', completed_at: '2026-10-24T12:00:00.001Z' },
  ])
  const v = approvalVerdict(reads({ completions: late }), new Date('2026-11-01T00:00:00Z'))
  ok(!v.ok && v.status === 400 && v.error.endsWith('2 of 3 watched, 3 needed.'), 'a video done one millisecond after the window does not count', v.error)
}
{
  const v = approvalVerdict(reads({ completions: done(['x01']) }), IN_WINDOW)
  ok(!v.ok && v.status === 400 && v.error === 'Student has not watched 80% of the videos up to the discount checkpoint inside the 14 days: 1 of 3 watched, 3 needed.',
     'fewer than the 80% done: refused, the count and what is needed named ("2 of 3 still missing" until 2026-10-26)', v.error)
}
ok(approvalVerdict(reads({ student: okRead({ first_paid_at: null }) }), IN_WINDOW).error.startsWith('Cannot approve: student has no first_paid_at on file.'),
   'no first payment: the old route\'s words')
{
  const v = approvalVerdict(reads({ student: okRead({ first_paid_at: '2026-09-30T21:59:59.999Z' }), completions: done(['x01', 'x05', 'x06']) }), new Date('2026-10-20T00:00:00Z'))
  ok(!v.ok && v.status === 400
       && v.error === 'Cannot approve: the student\'s first payment (2026-09-30T21:59:59.999Z) is before October 1, 2026. Only a first payment from then on can earn the discount.',
     'first payment the millisecond before 1 October in Croatia: refused, the day named', v.error)
}
ok(approvalVerdict(reads({ student: okRead({ first_paid_at: '2026-09-30T22:00:00.000Z' }), completions: done(['x01', 'x05', 'x06']) }), new Date('2026-10-20T00:00:00Z')).ok,
   'first payment at 00:00 on 1 October in Croatia, every video done by the shared deadline: approved')
{
  const v = approvalVerdict(reads({ student: okRead({ first_paid_at: '2026-09-15T10:00:00.000Z' }), completions: done(['x01', 'x05', 'x06']) }), new Date('2026-10-20T00:00:00Z'))
  ok(!v.ok && v.status === 400 && v.reason === 'before-launch' && v.error.includes('is before October 1, 2026'),
     'first payment on 15 September, every video done: refused (approved while the first date was 9 September)', v.error)
}
ok(approvalVerdict(reads({ student: okRead({ first_paid_at: '2026-10-08T10:00:00Z' }), completions: done(['x01', 'x05', 'x06']) }), new Date('2026-10-20T00:00:00Z')).ok,
   'first payment on 8 October, before the launch, every video done by the shared deadline: approved (refused until T-080)')
ok(/no discount gate lesson/.test(approvalVerdict(reads({ lessons: okRead(catalogRows(COURSE).map((l) => ({ ...l, is_gate: false }))) }), IN_WINDOW).error),
   'no gate: refused')
{
  const v = approvalVerdict(reads({ videos: badRead('denied') }), IN_WINDOW)
  ok(!v.ok && v.status === 500 && v.log.includes('lesson_videos: denied'), 'a failed read: 500, nothing approved', show(v))
}

console.log('\n=== approvalVerdict: an early-October joiner, judged as of the end of 23 October ===')
{
  const OCT2 = okRead({ first_paid_at: '2026-10-02T10:00:00.000Z' })
  // x01 came in from Whop at the app's first visit after the switch, x05 was
  // watched in the app, and the gate (x06) was finished at `gateAt`.
  const finished = (gateAt) => okRead([
    { lesson_id: 'x01', completed_at: '2026-10-19T07:30:00.000Z' },
    { lesson_id: 'x05', completed_at: '2026-10-21T18:00:00.000Z' },
    { lesson_id: 'x06', completed_at: gateAt },
  ])
  const ASKED = '2026-10-23T21:30:00.000Z'
  const LATER = new Date('2026-10-27T09:00:00Z')
  ok(same(approvalVerdict(reads({ student: OCT2, completions: finished('2026-10-23T21:59:00.000Z') }), LATER, ASKED), { ok: true }),
     'the gate finished at 23:59 on 23 October in Croatia, approved on 27 October: approved')
  ok(approvalVerdict(reads({ student: OCT2, completions: finished(DISCOUNT_SHARED_DEADLINE) }), LATER, ASKED).ok,
     'the gate finished at the deadline\'s last millisecond: approved')
  {
    const v = approvalVerdict(reads({ student: OCT2, completions: finished('2026-10-23T22:00:00.000Z') }), LATER, ASKED)
    ok(!v.ok && v.status === 400
         && v.error === 'Student has not watched 80% of the videos up to the discount checkpoint by the end of October 23 (Croatia time), the deadline for a first payment before the launch: 2 of 3 watched, 3 needed.',
       'the gate finished at 00:00 on 24 October in Croatia: refused, the deadline named', v.error)
  }
  ok(approvalVerdict(reads({ student: OCT2, completions: finished('2026-10-22T12:00:00.000Z') }), new Date('2026-10-22T13:00:00Z'), ASKED).ok,
     'approved before the deadline, every video done: approved')
  ok(approvalVerdict(reads({ completions: finished('2026-10-24T11:00:00.000Z') }), LATER, ASKED).ok,
     'paid 10 October (after the launch), the gate finished on 24 October inside its own 14 days: approved, the shared deadline is not theirs')
}

console.log('\n=== approvalVerdict: a video loaded after the request is not asked for ===')
{
  // The reviewer's case: x05 had no video when the student applied, its video
  // was loaded since, and the team approves days later.
  const ASKED = '2026-10-15T08:00:00.000Z'
  const LATER = '2026-10-16T00:00:00.000Z'
  const APPROVE_AT = new Date('2026-10-18T00:00:00Z')
  const videos = (x05At) => okRead(COURSE.filter((l) => l.has_video).map((l) =>
    ({ lesson_id: l.id, created_at: l.id === 'x05' ? x05At : '2026-10-01T00:00:00.000Z' })))
  const doneButX05 = done(['x01', 'x06'])
  const pending = okRead([R('q', 'pending', ASKED)])
  const withoutX05 = okRead(COURSE.filter((l) => l.has_video && l.id !== 'x05').map((l) => ({ lesson_id: l.id, created_at: '2026-10-01T00:00:00.000Z' })))
  ok(decideDiscountRequest(reads({ videos: withoutX05, completions: doneButX05 }), new Date(ASKED)).grant === true,
     'the request: granted while x05 had no video')
  {
    const v = approvalVerdict(reads({ videos: videos(LATER), completions: doneButX05, requests: pending }), APPROVE_AT, ASKED)
    ok(same(v, { ok: true }), 'the approval: x05\'s video was loaded after the request, so it is not asked for', show(v))
  }
  {
    const v = approvalVerdict(reads({ videos: videos(LATER), completions: doneButX05, requests: pending }), APPROVE_AT, null)
    ok(!v.ok && v.error.endsWith('2 of 3 watched, 3 needed.'), 'with no request date every video is counted, as before', v.error)
  }
  {
    const v = approvalVerdict(reads({ videos: videos('2026-10-14T00:00:00.000Z'), completions: doneButX05, requests: pending }), APPROVE_AT, ASKED)
    ok(!v.ok && v.status === 400 && v.error.endsWith('2 of 3 watched, 3 needed.'), 'a video loaded before the request is still counted', v.error)
  }
  ok(!approvalVerdict(reads({ videos: videos(ASKED), completions: doneButX05 }), APPROVE_AT, ASKED).ok,
     'a video loaded at the request\'s own instant is still asked for (only later ones are left out)')
  ok(!approvalVerdict(reads({ videos: videos(null), completions: doneButX05 }), APPROVE_AT, ASKED).ok
       && !approvalVerdict(reads({ videos: videos('not a date'), completions: doneButX05 }), APPROVE_AT, ASKED).ok,
     'a video with no date, or one that does not parse, is still asked for')
  ok(!approvalVerdict(reads({ videos: videos(LATER), completions: doneButX05 }), APPROVE_AT, 'not a date').ok,
     'a request date that does not parse: every video is asked for')
  {
    // A video loaded after the request, watched late, still cannot make up for one that existed.
    const v = approvalVerdict(reads({ videos: videos(LATER), completions: done(['x01']) }), APPROVE_AT, ASKED)
    ok(!v.ok && v.error.endsWith('1 of 2 watched, 2 needed.'), 'the videos that existed when the student applied are still counted (80% of 2 is both)', v.error)
  }
  {
    // What the student sees is unchanged: the map and the request route still ask for x05.
    const d = decideDiscountRequest(reads({ videos: videos(LATER), completions: doneButX05 }), APPROVE_AT)
    ok(!d.grant && d.state === 'locked', 'the student-facing state still asks for the new video', d.error)
  }
}

console.log('\n=== approvalVerdict: a request made before the switch is judged by the videos the course had at the switch (2026-10-17) ===')
{
  // The release review's case (a September joiner then, an early-October
  // one since the first date moved to 1 October): applied on the old
  // dashboard on 6 October, the new course's videos went into
  // lesson_videos on 14 October, the switch is 19 October, Approve on the 21st.
  const RESET = '2026-10-19T05:00:00.000Z'
  const OCT2 = okRead({ first_paid_at: '2026-10-02T10:00:00.000Z' })
  const OLD = '2026-10-06T10:00:00.000Z'
  const AT = new Date('2026-10-21T09:00:00Z')
  const loaded = (at, x05At = at) => okRead(COURSE.filter((l) => l.has_video).map((l) => ({ lesson_id: l.id, created_at: l.id === 'x05' ? x05At : at })))
  const OCT14 = loaded('2026-10-14T00:00:00.000Z')
  const allDone = done(['x01', 'x05', 'x06'], '2026-10-19T07:30:00Z')
  ok(same(approvalVerdict(reads({ student: OCT2, videos: OCT14, completions: allDone }), AT, OLD, 'old', RESET), { ok: true }),
     'every video done by the deadline: approved by the normal button')
  {
    const v = approvalVerdict(reads({ student: OCT2, videos: OCT14, completions: done(['x01'], '2026-10-19T07:30:00Z') }), AT, OLD, 'old', RESET)
    ok(!v.ok && v.status === 400 && v.reason === 'locked' && v.error.endsWith('1 of 3 watched, 3 needed.')
         && explainOldCourseRequest(v, OLD, RESET).error === `${OLD_COURSE_REQUEST_REFUSAL} The new rule says: ${v.error}`,
       'two short: refused with the count, after the old-course sentence', explainOldCourseRequest(v, OLD, RESET).error)
  }
  {
    // Without the switch's date, which is how the approve route judged it until this round.
    const finished = approvalVerdict(reads({ student: OCT2, videos: OCT14, completions: allDone }), AT, OLD, 'old')
    const nothing = approvalVerdict(reads({ student: OCT2, videos: OCT14, completions: okRead([]) }), AT, OLD, 'old')
    ok(finished.reason === 'no-gate' && nothing.reason === 'no-gate' && finished.error === nothing.error,
       'without it: every video counts as loaded after the request, and finished and unwatched read exactly the same (the reviewer\'s case)', finished.error)
    ok(approvalVerdict(reads({ student: OCT2, videos: OCT14, completions: allDone }), AT, OLD, 'old', null).reason === 'no-gate'
         && approvalVerdict(reads({ student: OCT2, videos: OCT14, completions: allDone }), AT, OLD, 'old', 'not a date').reason === 'no-gate',
       'no switch yet (null), or a date that does not parse: the request\'s own date, as before')
  }
  ok(approvalVerdict(reads({ student: OCT2, videos: loaded('2026-10-14T00:00:00.000Z', '2026-10-20T00:00:00.000Z'), completions: done(['x01', 'x06'], '2026-10-19T07:30:00Z') }), AT, OLD, 'old', RESET).ok,
     'a video loaded after the switch is still not asked for')
  {
    // A request made after the switch keeps its own date: x05 loaded after it is not asked for.
    const ASKED = '2026-10-20T10:00:00.000Z'
    const v = approvalVerdict(reads({ student: OCT2, videos: loaded('2026-10-14T00:00:00.000Z', '2026-10-20T12:00:00.000Z'), completions: done(['x01', 'x06'], '2026-10-19T07:30:00Z') }), AT, ASKED, 'q', RESET)
    ok(v.ok, 'a request made after the switch: its own date decides, as before', show(v))
  }
  {
    const v = approvalVerdict(reads({ student: OCT2, videos: OCT14, completions: done(['x01', 'x05', 'x06'], '2026-10-24T08:00:00Z') }), new Date('2026-10-27T09:00:00Z'), OLD, 'old', RESET)
    ok(!v.ok && v.reason === 'locked' && v.error.endsWith('0 of 3 watched, 3 needed.'), 'the deadline still holds: videos watched on 24 October do not count', v.error)
  }
  ok(!approvalVerdict(reads({ student: OCT2, videos: loaded('2026-10-20T00:00:00.000Z'), completions: done(['x01']) }), AT, 'not a date', 'old', RESET).ok,
     'a request date that does not parse: every video asked for, switch or not')
  {
    // A September joiner's old request, the case this section was written for: since the first date moved to
    // 1 October the first payment refuses it, every video done or not, and the refusal keeps its own words.
    const v = approvalVerdict(reads({ student: okRead({ first_paid_at: '2026-09-15T10:00:00.000Z' }), videos: OCT14, completions: allDone }), AT, '2026-09-25T10:00:00.000Z', 'old', RESET)
    ok(!v.ok && v.status === 400 && v.reason === 'before-launch' && explainOldCourseRequest(v, '2026-09-25T10:00:00.000Z', RESET) === v,
       'paid 15 September, applied on 25 September, every video done: refused over the first payment, in its own words (never "Judge it by hand")', v.error)
  }
}

console.log('\n=== approvalVerdict: a request the app\'s Apply could not have made (17 October) ===')
{
  // Until v107 a student holding a session could call the feedback form's
  // database function straight, past the request routes. Where the rule
  // would approve, the approval refuses a request made after the deadline
  // (past REQUEST_GRACE_MS) and one beside another counted request that was
  // rejected, approved or applied. PAID is 10 October: the deadline is ENDS.
  const ALL = done(['x01', 'x05', 'x06'])
  const LATE_AT = new Date('2026-11-01T00:00:00Z')
  const plus = (ms) => new Date(Date.parse(ENDS) + ms).toISOString()
  ok(REQUEST_GRACE_MS === 5 * 60_000, 'the grace for a route\'s own insert is 5 minutes, the longest Vercel lets a function run')
  ok(approvalVerdict(reads({ completions: ALL }), LATE_AT, plus(REQUEST_GRACE_MS)).ok,
     'a request stamped 5 minutes after the deadline, to the millisecond: approved (a route that decided in time can insert that late)')
  {
    const v = approvalVerdict(reads({ completions: ALL }), LATE_AT, plus(REQUEST_GRACE_MS + 1), 'q')
    ok(!v.ok && v.status === 400 && v.reason === 'late-request'
         && v.error === `Cannot approve: this request was made at ${plus(REQUEST_GRACE_MS + 1)}, after the student's deadline (${ENDS}), and the app refuses an application that late. Judge it by hand; Generate anyway skips the check.`,
       'one millisecond later: refused, the request\'s time and the deadline named', v.error)
  }
  ok(approvalVerdict(reads({ completions: ALL }), LATE_AT, null).ok && approvalVerdict(reads({ completions: ALL }), LATE_AT, 'not a date').ok,
     'no request date, or one that does not parse: the late check cannot run (the route always has one: created_at is not null)')
  const asked = '2026-10-15T08:00:00.000Z'
  const said = (status) => {
    const v = approvalVerdict(reads({ completions: ALL, requests: okRead([R('q', 'pending', asked), R('o', status, '2026-10-12T10:00:00.000Z')]) }), IN_WINDOW, asked, 'q')
    return v.ok ? 'approved' : `${v.reason}: ${v.error}`
  }
  ok(said('rejected') === "another-request: Cannot approve: this student's other request (made 2026-10-12T10:00:00.000Z) was rejected, and the app refuses a new application after a rejection. Judge it by hand; Generate anyway skips the check.",
     'another request, made after the launch and rejected: refused', said('rejected'))
  ok(said('approved').endsWith('was already approved, and the 30% is one per student. Judge it by hand; Generate anyway skips the check.')
       && said('applied').endsWith('is already on their membership, and the 30% is one per student. Judge it by hand; Generate anyway skips the check.'),
     'another request approved or applied: refused, one 30% per student', `${said('approved')} | ${said('applied')}`)
  ok(said('pending') === 'approved', 'another pending request is no reason (from v106 there is never a second one; before it, the stable Whop code refused a second approval)')
  {
    const rejectedOnly = reads({ completions: ALL, requests: okRead([R('o', 'rejected', '2026-10-12T10:00:00.000Z')]) })
    ok(approvalVerdict(rejectedOnly, IN_WINDOW, asked, 'o').ok && !approvalVerdict(rejectedOnly, IN_WINDOW, asked).ok,
       'the request being approved is never "another" (by its id); with no id given every request is')
  }
  {
    // A first payment from 1 October: a request from before the launch counts unless it was rejected (requestCounts).
    const OCT2 = okRead({ first_paid_at: '2026-10-02T10:00:00.000Z' })
    const OLD = '2026-10-06T10:00:00.000Z'
    const withOld = (status) => approvalVerdict(reads({ student: OCT2, completions: ALL, requests: okRead([R('old', status, OLD), R('q', 'pending', asked)]) }),
      new Date('2026-10-20T00:00:00Z'), asked, 'q')
    ok(withOld('rejected').ok, 'paid 2 October, rejected on the old dashboard before the launch: approved (that request does not count)')
    ok(withOld('approved').reason === 'another-request' && withOld('applied').reason === 'another-request',
       'paid 2 October, approved or applied on the old dashboard: refused, one 30% per student')
  }
  {
    const v = approvalVerdict(reads({ completions: done(['x01']), requests: okRead([R('o', 'rejected', '2026-10-12T10:00:00.000Z')]) }), IN_WINDOW, asked, 'q')
    ok(!v.ok && v.reason === 'locked' && v.error.endsWith('1 of 3 watched, 3 needed.'), 'where the rule refuses anyway, its own words stand', v.error)
  }
  {
    const late = approvalVerdict(reads({ completions: ALL }), LATE_AT, plus(REQUEST_GRACE_MS + 1), 'q')
    const other = approvalVerdict(reads({ completions: ALL, requests: okRead([R('o', 'rejected', '2026-10-12T10:00:00.000Z')]) }), IN_WINDOW, asked, 'q')
    ok(explainOldCourseRequest(late, plus(REQUEST_GRACE_MS + 1), '2026-12-01T00:00:00Z') === late
         && explainOldCourseRequest(other, asked, '2026-10-16T18:30:00.000Z') === other,
       'made before the switch, either refusal keeps its own words (it says why, and ends "Generate anyway skips the check")')
  }
}

console.log('\n=== explainOldCourseRequest: a request made before the course switch ===')
{
  const RESET = '2026-10-16T18:30:00.000Z'
  const AT = new Date('2026-10-17T10:00:00Z')
  ok(OLD_COURSE_REQUEST_REFUSAL === 'This request was made on the old course, before the switch. Judge it by hand; Generate anyway skips the check.',
     'the words', OLD_COURSE_REQUEST_REFUSAL)
  // The reviewer's case 2: paid 10 October, applied 13 October under the old
  // rule, the completions archived at the switch.
  const locked = approvalVerdict(reads({ student: okRead({ first_paid_at: '2026-10-10T10:00:00Z' }), completions: okRead([]) }), AT, '2026-10-13T10:00:00Z')
  ok(!locked.ok && locked.status === 400 && locked.error.endsWith('0 of 3 watched, 3 needed.'), 'the new rule alone refuses it as unwatched', locked.error)
  const said = explainOldCourseRequest(locked, '2026-10-13T10:00:00Z', RESET)
  ok(same(said, { ...locked, error: `${OLD_COURSE_REQUEST_REFUSAL} The new rule says: ${locked.error}` }),
     'made before the switch: the refusal says so, then the new rule\'s own words, still a 400', show(said))
  // The reviewer's case 1, since T-080: paid 1 October, which now has the
  // shared deadline, so the new rule alone refuses it as unwatched.
  const early = approvalVerdict(reads({ student: okRead({ first_paid_at: '2026-10-01T10:00:00Z' }) }), AT, '2026-10-12T10:00:00Z')
  ok(!early.ok && early.error.endsWith('0 of 3 watched, 3 needed.')
       && explainOldCourseRequest(early, '2026-10-12T10:00:00Z', RESET).error === `${OLD_COURSE_REQUEST_REFUSAL} The new rule says: ${early.error}`,
     'paid 1 October, applied on the old course on 12 October: the same words', early.error)
  // A refusal over the first payment reads the same on either course, so it
  // keeps its words. Until the release review (2026-10-17) the old-course
  // sentence replaced it, ending "Generate anyway skips the check".
  const tooEarly = approvalVerdict(reads({ student: okRead({ first_paid_at: '2026-09-15T10:00:00Z' }) }), AT, '2026-09-25T10:00:00Z')
  ok(tooEarly.error.includes('before October 1, 2026') && explainOldCourseRequest(tooEarly, '2026-09-25T10:00:00Z', RESET) === tooEarly,
     'paid 15 September, refused as before 1 October: the refusal keeps its own words', tooEarly.error)
  const noPay = approvalVerdict(reads({ student: okRead({ first_paid_at: null }) }), AT, '2026-10-13T10:00:00Z')
  ok(noPay.error.startsWith('Cannot approve: student has no first_paid_at on file.') && explainOldCourseRequest(noPay, '2026-10-13T10:00:00Z', RESET) === noPay,
     'no first payment on file: the refusal keeps its own words', noPay.error)
  // Every video loaded after the request: nothing to check it against.
  const loaded12 = okRead(COURSE.filter((l) => l.has_video).map((l) => ({ lesson_id: l.id, created_at: '2026-10-12T00:00:00Z' })))
  const noVideo = approvalVerdict(reads({ student: okRead({ first_paid_at: '2026-10-02T10:00:00Z' }), videos: loaded12 }), AT, '2026-10-06T10:00:00Z')
  const noVideoSaid = explainOldCourseRequest(noVideo, '2026-10-06T10:00:00Z', RESET)
  ok(/no discount gate lesson/.test(noVideo.error) && noVideoSaid.error === OLD_COURSE_REQUEST_REFUSAL && noVideoSaid.status === 400 && noVideoSaid.log === noVideo.log,
     'applied on the old course before any video was loaded: the old-course sentence alone, still a 400, the log line kept', noVideoSaid.error)
  ok(explainOldCourseRequest(locked, '2026-10-17T09:00:00Z', RESET) === locked, 'made after the switch: the new rule\'s own words')
  ok(explainOldCourseRequest(locked, RESET, RESET) === locked, 'made at the switch\'s instant: the new rule\'s own words')
  ok(explainOldCourseRequest(locked, '2026-10-13T10:00:00Z', null) === locked, 'no switch: unchanged')
  ok(explainOldCourseRequest(locked, 'not a date', RESET) === locked, 'a request date that does not parse: unchanged')
  ok(same(explainOldCourseRequest({ ok: true }, '2026-10-13T10:00:00Z', RESET), { ok: true }), 'an approval stays an approval')
  const failed = approvalVerdict(reads({ videos: badRead('denied') }), AT, '2026-10-13T10:00:00Z')
  ok(explainOldCourseRequest(failed, '2026-10-13T10:00:00Z', RESET) === failed, 'a failed read keeps its 500 and its words')
}

console.log('\n=== loadDiscountReads, against a stand-in client ===')
{
  const calls = []
  const results = {
    students: okRead({ first_paid_at: PAID }),
    lessons_next: okRead(catalogRows(COURSE)),
    lesson_videos: okRead([{ lesson_id: 'x01' }]),
    student_lesson_completions: okRead([]),
    discount_requests: okRead([]),
  }
  const db = {
    from(table) {
      const q = { table, steps: [] }
      calls.push(q)
      const b = {
        then(res, rej) { return (table === 'boom' ? Promise.reject(new Error('socket hang up')) : Promise.resolve(results[table])).then(res, rej) },
      }
      for (const m of ['select', 'eq', 'order', 'single']) b[m] = (...args) => { q.steps.push([m, ...args]); return b }
      return b
    },
  }
  const r = await loadDiscountReads(db, 'stu-1', 'lessons_next')
  const by = Object.fromEntries(calls.map((c) => [c.table, c.steps]))
  ok(same(Object.keys(by).sort(), ['discount_requests', 'lesson_videos', 'lessons_next', 'student_lesson_completions', 'students']), 'five reads, the catalog from the table it is handed', show(Object.keys(by)))
  ok(same(by.lessons_next, [['select', LESSON_COLUMNS], ['order', 'sort_order']]), 'lessons: the five columns, in course order', show(by.lessons_next))
  ok(same(by.lesson_videos, [['select', 'lesson_id, created_at']]) && VIDEO_COLUMNS === 'lesson_id, created_at',
     'lesson_videos: the lesson id and when it was loaded, nothing else (never the Tella id)', show(by.lesson_videos))
  ok(same(by.students, [['select', 'first_paid_at'], ['eq', 'id', 'stu-1'], ['single']]), 'students: the one row\'s first payment', show(by.students))
  ok(same(by.student_lesson_completions, [['select', 'lesson_id, completed_at'], ['eq', 'student_id', 'stu-1']]), 'completions: this student\'s only', show(by.student_lesson_completions))
  ok(same(by.discount_requests, [['select', REQUEST_COLUMNS], ['eq', 'student_id', 'stu-1']]), 'requests: this student\'s only, every status', show(by.discount_requests))
  ok(same(r.videos, okRead([{ lesson_id: 'x01' }])) && r.student.data.first_paid_at === PAID, 'the results come back as read')
  const thrown = await loadDiscountReads(db, 'stu-1', 'boom')
  ok(thrown.lessons.data === null && thrown.lessons.error.message === 'socket hang up' && thrown.student.error === null,
     'a read that throws becomes a failed read, never an exception', show(thrown.lessons))
  ok(decideDiscountRequest(thrown, IN_WINDOW).status === 500, 'and a thrown read grants nothing')
}

console.log('\n=== The real course: course_catalog.json + the development page\'s video lengths ===')
{
  const read = (rel) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'))
  const catalog = read('../supabase/catalog/course_catalog.json')
  const lengths = read('../src/app/dev/world-app/course-lengths.fixture.json')
  // The rows v101 writes (sort_order = place in the file) and lesson_videos's rows (a lesson in the lengths file has a video).
  const rows = catalog.lessons.map((l) => ({ id: l.id, type: l.type, counts_toward_progress: l.counts !== false, is_gate: l.gate === true, duration_seconds: lengths[l.id] ?? null }))
  const lessons = toDiscountLessons(rows, new Set(Object.keys(lengths)))
  const req = requiredLessons(lessons)
  const seconds = req.reduce((s, l) => s + (l.duration_seconds ?? 0), 0)
  const hours = Math.round(seconds / 36) / 100
  const gateAt = lessons.findIndex((l) => l.is_gate) + 1
  console.log(`  -> gate ${gateLessonId(lessons)} ("${catalog.lessons[gateAt - 1].title}"), lesson ${gateAt} of ${lessons.length}`)
  console.log(`  -> ${req.length} lessons required, ${seconds} seconds = ${hours} hours of video`)
  console.log(`  -> not asked for before the gate: ${lessons.slice(0, gateAt).filter((l) => !req.includes(l)).map((l) => l.id).join(', ')}`)
  ok(gateLessonId(lessons) === 'a4l17' && catalog.lessons[gateAt - 1].title === "The Editor's Teardown" && catalog.lessons[gateAt - 1].area === 'a4',
     'the gate is a4l17, the last lesson of Video Ads II')
  ok(catalog.lessons.filter((l) => l.gate === true).length === 1, 'one gate in the data file')
  ok(catalog.lessons.findIndex((l) => l.area === 'a5') === gateAt, 'the next lesson opens Static Ads')
  ok(gateAt === 61, 'the gate is lesson 61 of 141', `${gateAt}`)
  ok(req.length === 61, '61 lessons are counted', `${req.length}`)
  ok(seconds === 75575 && hours === 20.99, '75,575 seconds of video, 20.99 hours', `${seconds}`)
  ok(same(lessons.slice(0, gateAt).filter((l) => !req.includes(l)).map((l) => l.id), []) && req.some((l) => l.id === 'a3l11'),
     'every lesson up to the gate has a video and is counted, "Your Editing Software" (a3l11) too since its video came on 2026-10-19')
  ok(req.some((l) => l.id === 'a3l25'), 'the action item before the gate (a3l25) is counted by its video')
  ok(req.every((l) => /^a[1-4]l/.test(l.id)), 'nothing past Video Ads II is counted')
  ok(videosNeeded(req.length) === 49, 'the 80% of the 61 is 49 (48.8 rounded up)', `${videosNeeded(req.length)}`)

  const r = (o = {}) => ({ student: okRead({ first_paid_at: PAID }), lessons: okRead(rows), videos: okRead(Object.keys(lengths).map((lesson_id) => ({ lesson_id }))), completions: okRead([]), requests: okRead([]), ...o })
  const s = discountState({ now: IN_WINDOW, firstPaidAt: PAID, lessons, videoDoneIds: new Set(), requests: [] })
  const first49 = req.slice(0, 49).reduce((sum, l) => sum + (l.duration_seconds ?? 0), 0)
  ok(s.kind === 'locked' && s.lessonsLeft === 49 && s.lessonsDone === 0 && s.lessonsNeeded === 49 && s.lessonsTotal === 61 && s.secondsLeft === first49 && first49 === 55253 && s.nextLessonId === 'a1l01',
     'a new student: locked, 49 of the 61 needed, the first 49 in course order 55,253 seconds long, next a1l01 (61 left and 75,575 seconds until 2026-10-26)', show(s))
  const d0 = decideDiscountRequest(r(), IN_WINDOW)
  ok(!d0.grant && d0.error === 'You need 49 more videos to reach 80%, about 15.3 hours of video. Watch them before your deadline and apply again.',
     'and the route tells them so', d0.error)
  const allIds = req.map((l) => l.id)
  ok(decideDiscountRequest(r({ completions: done(allIds) }), IN_WINDOW).grant === true, 'every counted video done: the route grants')
  ok(decideDiscountRequest(r({ completions: done(allIds.slice(0, 48)) }), IN_WINDOW).grant === false, '48 of the 61: not granted, 1 more needed')
  ok(decideDiscountRequest(r({ completions: done(allIds.slice(0, 49)) }), IN_WINDOW).grant === true, '49 of the 61: granted')
  ok(decideDiscountRequest(r({ completions: done(allIds.filter((id) => id !== 'a4l17')) }), IN_WINDOW).grant === true,
     'all but the gate, 60 of 61: granted, the gate is one video among the 61 (refused until 2026-10-26)')
  ok(decideDiscountRequest(r({ completions: done(allIds.slice(12)) }), IN_WINDOW).grant === true,
     'the last 49 in course order, the first 12 never opened: granted, any 49 count')
  ok(decideDiscountRequest(r({ completions: done(allIds.slice(13).concat(catalog.lessons.slice(gateAt).map((l) => l.id))) }), IN_WINDOW).grant === false,
     'the last 48 up to the gate and the whole rest of the course: not granted, nothing past the gate counts')

  // T-080 over the real course: paid 2 October, every required video
  // finished after the app is back and before the end of 23 October.
  const OCT2 = okRead({ first_paid_at: '2026-10-02T10:00:00.000Z' })
  const oct2 = discountState({ now: new Date('2026-10-19T08:00:00Z'), firstPaidAt: '2026-10-02T10:00:00.000Z', lessons, videoDoneIds: new Set(), requests: [] })
  ok(oct2.kind === 'locked' && oct2.lessonsLeft === 49 && oct2.lessonsTotal === 61 && oct2.window === 'shared' && oct2.endsAt === DISCOUNT_SHARED_DEADLINE,
     'paid 2 October, on 19 October: 49 of the 61 needed, until the end of 23 October', show(oct2))
  const by21st = done(allIds, '2026-10-21T10:00:00.000Z')
  ok(decideDiscountRequest(r({ student: OCT2, completions: by21st }), new Date('2026-10-22T10:00:00Z')).grant === true,
     'all 61 finished by 21 October, applied on 22 October: granted')
  ok(approvalVerdict(r({ student: OCT2, completions: by21st }), new Date('2026-10-28T10:00:00Z'), '2026-10-22T10:00:00.000Z').ok,
     'and approved on 28 October: approved, judged as of the end of 23 October')
  const gateOn24th = okRead(allIds.map((lesson_id) => ({ lesson_id, completed_at: lesson_id === 'a4l17' ? '2026-10-23T22:00:00.000Z' : '2026-10-21T10:00:00.000Z' })))
  ok(decideDiscountRequest(r({ student: OCT2, completions: gateOn24th }), new Date('2026-10-23T22:00:00.000Z')).state === 'expired',
     'the gate (a4l17) finished at 00:00 on 24 October in Croatia: a request then is refused as expired')
  ok(approvalVerdict(r({ student: OCT2, completions: gateOn24th }), new Date('2026-10-28T10:00:00Z'), '2026-10-23T21:00:00.000Z').ok,
     'a request made at 23:00 that night, the other 60 done by the 21st: approved, 60 of 61 by the deadline is past the 80% (refused until 2026-10-26, "1 of 61 still missing")')
  // The 49th video after the deadline: 48 by it, one short.
  const ninthOn24th = okRead(allIds.slice(0, 49).map((lesson_id, i) => ({ lesson_id, completed_at: i === 48 ? '2026-10-23T22:00:00.000Z' : '2026-10-21T10:00:00.000Z' })))
  const late = approvalVerdict(r({ student: OCT2, completions: ninthOn24th }), new Date('2026-10-28T10:00:00Z'), '2026-10-23T21:00:00.000Z')
  ok(!late.ok && late.error.endsWith('48 of 61 watched, 49 needed.'), 'the 49th video finished at 00:00 on 24 October: an approval refuses it, 48 of 61 by the deadline', late.error)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
