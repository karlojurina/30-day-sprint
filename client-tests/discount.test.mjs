// discount.ts (where a student stands on the 30% offer) and discount-server.ts
// (what the request and approve routes do with it on the new course). Every
// branch on stand-in rows, then the real course: course_catalog.json with the
// video lengths of the development page. Both modules are the real source
// (build.mjs copies them with their import lines rewritten).
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DISCOUNT_LAUNCH_DATE, DISCOUNT_PERCENT, DISCOUNT_WINDOW_DAYS,
  discountEndsAt, discountState, gateLessonId, requiredLessons,
} from './_gen/discount.ts'
import { DISCOUNT_WINDOW_DAYS as CONSTANTS_WINDOW_DAYS } from './_gen/constants.ts'
import {
  LESSON_COLUMNS, REQUEST_COLUMNS,
  approvalVerdict, decideDiscountRequest, discountRefusalMessage, factsFromReads,
  loadDiscountReads, toDiscountLessons, videoDoneIds,
} from './_gen/discount-server.ts'

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
ok(DISCOUNT_PERCENT === 30 && DISCOUNT_LAUNCH_DATE === '2026-10-09T00:00:00.000Z', 'the offer is 30% for payments from 2026-10-09')

console.log('\n=== discountEndsAt ===')
ok(discountEndsAt(PAID)?.toISOString() === ENDS, '14 days after the first payment, to the millisecond', discountEndsAt(PAID)?.toISOString())
ok(discountEndsAt(PAID).getTime() - Date.parse(PAID) === 14 * DAY, 'exactly 14 x 24 hours')
ok(discountEndsAt(null) === null, 'no first payment: no end')
ok(discountEndsAt('') === null, 'an empty date: no end')
ok(discountEndsAt('not a date') === null, 'a date that does not parse: no end')
ok(discountEndsAt('2026-13-45') === null, 'an impossible date: no end')

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
ok(same(state({ firstPaidAt: '2026-10-08T23:59:59.999Z', now: new Date('2026-10-10T00:00:00Z') }), { kind: 'not-eligible', reason: 'before-launch' }),
   'a first payment the millisecond before 2026-10-09 (the old course)')
ok(same(state({ firstPaidAt: '2026-09-01T00:00:00Z', now: new Date('2026-09-05T00:00:00Z') }), { kind: 'not-eligible', reason: 'before-launch' }),
   'before launch wins even inside that payment\'s own 14 days')
ok(state({ firstPaidAt: '2026-10-09T00:00:00.000Z', now: new Date('2026-10-10T00:00:00Z') }).kind === 'locked', 'a first payment at the launch instant is in')
ok(same(state({ lessons: COURSE.map((l) => ({ ...l, is_gate: false })) }), { kind: 'not-eligible', reason: 'no-gate' }), 'a catalog with no gate closes the offer')
ok(same(state({ lessons: [] }), { kind: 'not-eligible', reason: 'no-gate' }), 'an empty catalog closes the offer')
ok(same(state({ lessons: COURSE.map((l) => ({ ...l, has_video: false })) }), { kind: 'not-eligible', reason: 'no-gate' }),
   'a gate with not one video up to it closes the offer (never "ready" with nothing watched)')
ok(same(state({ lessons: COURSE.map((l) => ({ ...l, has_video: false })), now: AFTER }), { kind: 'not-eligible', reason: 'no-gate' }),
   'the same after the window')

console.log('\n=== discountState: locked, ready, expired ===')
{
  const s = state()
  ok(same(s, { kind: 'locked', endsAt: ENDS, lessonsLeft: 3, lessonsTotal: 3, secondsLeft: 1200, nextLessonId: 'x01' }),
     'nothing watched: 3 of 3 left, 300 + 0 (no length) + 900 seconds, next is the first in course order', show(s))
}
{
  const s = state({ videoDoneIds: new Set(['x01', 'x07', 'x03']) })
  ok(s.kind === 'locked' && s.lessonsLeft === 2 && s.lessonsTotal === 3 && s.secondsLeft === 900 && s.nextLessonId === 'x05',
     'lessons done that are not asked for change nothing; the next is the first one left', show(s))
}
{
  const s = state({ videoDoneIds: new Set(['x01', 'x05']) })
  ok(s.kind === 'locked' && s.lessonsLeft === 1 && s.nextLessonId === 'x06' && s.secondsLeft === 900, 'only the gate left', show(s))
}
{
  const s = state({ videoDoneIds: new Set(['x01', 'x05', 'x06']) })
  ok(same(s, { kind: 'ready', endsAt: ENDS, lessonsTotal: 3 }), 'every asked-for video done inside the 14 days: ready', show(s))
}
ok(state({ videoDoneIds: new Set(['x01', 'x05', 'x06']), now: new Date(ENDS) }).kind === 'ready', 'still ready at the exact end of the window')
{
  const s = state({ now: AFTER, videoDoneIds: new Set(['x01']) })
  ok(same(s, { kind: 'expired', endsAt: ENDS, lessonsLeft: 2 }), 'after the window: expired, with the lessons that were left', show(s))
}
ok(same(state({ now: AFTER, videoDoneIds: new Set(['x01', 'x05', 'x06']) }), { kind: 'expired', endsAt: ENDS, lessonsLeft: 0 }),
   'after the window with everything done and no request: expired')
ok(state({ now: new Date(Date.parse(ENDS) + 1) }).kind === 'expired', 'one millisecond after the window: expired')

console.log('\n=== discountState: a request decides ===')
for (const status of ['pending', 'approved', 'applied', 'rejected']) {
  const req = R('req-1', status, '2026-10-20T10:00:00.000Z', { promo_code: status === 'approved' ? 'ECOM30-ABC' : null, rejection_reason: status === 'rejected' ? 'no' : null })
  const want = { kind: status, requestId: 'req-1', at: '2026-10-20T10:00:00.000Z', promoCode: req.promo_code, rejectionReason: req.rejection_reason }
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

console.log('\n=== discountState: a request from the old course is ignored ===')
{
  const june = R('june', 'approved', '2026-06-12T10:00:00.000Z', { promo_code: 'ECOM30-OLD' })
  const s = state({ firstPaidAt: '2026-06-01T00:00:00Z', now: new Date('2026-10-15T00:00:00Z'), requests: [june] })
  ok(same(s, { kind: 'not-eligible', reason: 'before-launch' }), 'a June student with an approved June request sees "not eligible", never "approved"', show(s))
  ok(state({ requests: [R('eve', 'pending', '2026-10-08T23:59:59.999Z')] }).kind === 'locked', 'a request the millisecond before the launch is ignored')
  ok(state({ requests: [R('at', 'pending', '2026-10-09T00:00:00.000Z')] }).kind === 'pending', 'a request at the launch instant counts')
  ok(state({ requests: [R('new', 'pending', '2026-10-12T00:00:00Z'), R('old', 'approved', '2026-07-01T00:00:00Z')] }).requestId === 'new',
     'next to a new request, an old one plays no part')
  ok(state({ requests: [R('old', 'rejected', '2026-09-30T00:00:00Z')], videoDoneIds: new Set(['x01', 'x05', 'x06']) }).kind === 'ready',
     'an old rejection does not stop a new student who is ready')
  ok(state({ requests: [R('bad', 'approved', 'not a date')] }).kind === 'locked', 'a request whose date does not parse is not counted')
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
  ok(d.error === 'You have 2 lessons left to watch before the discount checkpoint, about 15 minutes of video. Finish them within your 14 days and apply again.',
     'locked says how many lessons are left', d.error)
}
{
  const d = decideDiscountRequest(reads({ completions: done(['x01', 'x05']) }), IN_WINDOW)
  ok(d.error === 'You have 1 lesson left to watch before the discount checkpoint, about 15 minutes of video. Finish it within your 14 days and apply again.', 'one lesson left reads in the singular', d.error)
}
{
  const d = decideDiscountRequest(reads({ completions: done(['x01', 'x06']) }), IN_WINDOW)
  ok(d.error === 'You have 1 lesson left to watch before the discount checkpoint. Finish it within your 14 days and apply again.', 'no length known: no time in the sentence', d.error)
}
{
  const d = decideDiscountRequest(reads({ completions: done(['x01', 'x05', 'x06']) }), AFTER)
  ok(!d.grant && d.status === 400 && d.state === 'expired' && d.error.startsWith('Your 14 days for the discount are over.'), 'expired: 400, even with every video done', d.error)
}
{
  const d = decideDiscountRequest(reads({ student: okRead({ first_paid_at: '2026-10-01T00:00:00Z' }), completions: done(['x01', 'x05', 'x06']) }), new Date('2026-10-05T00:00:00Z'))
  ok(!d.grant && d.state === 'not-eligible' && d.error.includes('on or after October 9, 2026'), 'first payment before 2026-10-09: 400, not eligible', d.error)
}
{
  const d = decideDiscountRequest(reads({ student: okRead({ first_paid_at: null }) }), IN_WINDOW)
  ok(!d.grant && d.state === 'not-eligible' && d.error.startsWith("We can't find your first payment yet"), 'no first payment: 400, not eligible', d.error)
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
    { kind: 'locked', lessonsLeft: 3, lessonsTotal: 3, secondsLeft: 7200, endsAt: ENDS, nextLessonId: 'x' },
    { kind: 'expired', endsAt: ENDS, lessonsLeft: 0 },
    ...['no-payment', 'before-launch', 'no-gate'].map((reason) => ({ kind: 'not-eligible', reason })),
    ...['pending', 'approved', 'applied', 'rejected'].map((kind) => ({ kind, requestId: 'r', at: ENDS, promoCode: null, rejectionReason: null })),
  ]
  const msgs = all.map(discountRefusalMessage)
  ok(msgs.every((m) => m.length > 0 && !m.includes('—') && !/\bR[12]\b/.test(m)), 'every refusal is a plain sentence: no em dash, no region code', show(msgs))
  ok(msgs[0].includes('about 2 hours of video'), 'hours read as hours', msgs[0])
}

{
  // A request from the old course, on the server.
  const june = R('june', 'approved', '2026-06-12T10:00:00.000Z', { promo_code: 'ECOM30-OLD' })
  const d = decideDiscountRequest(reads({ student: okRead({ first_paid_at: '2026-06-01T00:00:00Z' }), requests: okRead([june]) }), new Date('2026-10-15T00:00:00Z'))
  ok(!d.grant && d.state === 'not-eligible', 'and the server refuses that June student as not eligible, not as already requested', d.error)
  const d2 = decideDiscountRequest(reads({ completions: done(['x01', 'x05', 'x06']), requests: okRead([R('old', 'rejected', '2026-09-30T00:00:00Z')]) }), IN_WINDOW)
  ok(d2.grant === true, 'the server grants a ready student whose only request is from the old course')
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
  ok(!v.ok && v.status === 400 && v.error.includes('1 of 3 still missing'), 'a video done one millisecond after the window does not count', v.error)
}
{
  const v = approvalVerdict(reads({ completions: done(['x01']) }), IN_WINDOW)
  ok(!v.ok && v.status === 400 && v.error.includes('2 of 3 still missing'), 'not every video done: refused', v.error)
}
ok(approvalVerdict(reads({ student: okRead({ first_paid_at: null }) }), IN_WINDOW).error.startsWith('Cannot approve: student has no first_paid_at on file.'),
   'no first payment: the old route\'s words')
ok(approvalVerdict(reads({ student: okRead({ first_paid_at: '2026-10-08T10:00:00Z' }), completions: done(['x01', 'x05', 'x06']) }), new Date('2026-10-10T00:00:00Z')).error.includes('before October 9, 2026'),
   'first payment before the launch: refused')
ok(/no discount gate lesson/.test(approvalVerdict(reads({ lessons: okRead(catalogRows(COURSE).map((l) => ({ ...l, is_gate: false }))) }), IN_WINDOW).error),
   'no gate: refused')
{
  const v = approvalVerdict(reads({ videos: badRead('denied') }), IN_WINDOW)
  ok(!v.ok && v.status === 500 && v.log.includes('lesson_videos: denied'), 'a failed read: 500, nothing approved', show(v))
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
  ok(same(by.lesson_videos, [['select', 'lesson_id']]), 'lesson_videos: the lesson id and nothing else (never the Tella id)', show(by.lesson_videos))
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
  ok(req.length === 59, '59 lessons are required', `${req.length}`)
  ok(seconds === 69959 && hours === 19.43, '69,959 seconds of video, 19.43 hours', `${seconds}`)
  ok(same(lessons.slice(0, gateAt).filter((l) => !req.includes(l)).map((l) => l.id), ['a3l11', 'a4l11']),
     'the 2 lessons before the gate with no video ("Your Editing Software", "Music Leverage") are not asked for')
  ok(req.some((l) => l.id === 'a3l25'), 'the action item before the gate (a3l25) is asked for by its video')
  ok(req.every((l) => /^a[1-4]l/.test(l.id)), 'nothing past Video Ads II is asked for')

  const r = (o = {}) => ({ student: okRead({ first_paid_at: PAID }), lessons: okRead(rows), videos: okRead(Object.keys(lengths).map((lesson_id) => ({ lesson_id }))), completions: okRead([]), requests: okRead([]), ...o })
  const s = discountState({ now: IN_WINDOW, firstPaidAt: PAID, lessons, videoDoneIds: new Set(), requests: [] })
  ok(s.kind === 'locked' && s.lessonsLeft === 59 && s.lessonsTotal === 59 && s.secondsLeft === 69959 && s.nextLessonId === 'a1l01',
     'a new student: locked, 59 left, 69,959 seconds, next a1l01', show(s))
  const d0 = decideDiscountRequest(r(), IN_WINDOW)
  ok(!d0.grant && d0.error === 'You have 59 lessons left to watch before the discount checkpoint, about 19.4 hours of video. Finish them within your 14 days and apply again.',
     'and the route tells them so', d0.error)
  const allIds = req.map((l) => l.id)
  ok(decideDiscountRequest(r({ completions: done(allIds) }), IN_WINDOW).grant === true, 'every required video done: the route grants')
  ok(decideDiscountRequest(r({ completions: done(allIds.filter((id) => id !== 'a4l17')) }), IN_WINDOW).grant === false, 'all but the gate: not granted')
  ok(decideDiscountRequest(r({ completions: done(allIds.filter((id) => id !== 'a1l01').concat(catalog.lessons.slice(gateAt).map((l) => l.id))) }), IN_WINDOW).grant === false,
     'the whole rest of the course watched but a1l01 missing: not granted')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
