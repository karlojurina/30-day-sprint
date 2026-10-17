// T-080 end to end: a student whose first payment was on 15 September (after
// 9 September, before the launch on 9 October) has until the end of
// 23 October in Croatia, and the lessons they finish on Whop count.
//
// What decides is the real source, copied by build.mjs: the Whop backfill a
// visit runs (watch-sync.ts), the Whop webhook, both routes that write a
// request, and approvalVerdict over the reads loadDiscountReads makes, which is what
// POST /api/discounts/approve runs on the new course (the route also needs a
// team login, the ads tick and Whop's promo code, none of which is the rule).
// The database is stub-server.ts's stand-in as the switch leaves it:
// `lessons` holds the real course (course_catalog.json, with the development
// page's video lengths standing for the videos that exist) and CATALOG_IS_V2
// is on.
//
// The clock is moved by hand. A completion carries the time the app writes
// it: the backfill and the webhook write no time and the database stamps
// now(), which the stand-in does with `new Date()`; a lesson watched to the
// end in the app is stamped by the heartbeat's database function with the
// same now(), so here it is a row inserted at that moment. The request route
// judges `new Date()`.
//
// Both ways the map's Apply goes are driven: the questions form
// (POST /api/discounts/submit-feedback, what Apply opens while any question
// is active, the default) and the plain request (no active questions). The
// form's database function, submit_discount_with_feedback (v29), stands in
// here from v29's body; the migration harness, section 26, runs the real one
// on the same four old requests.
import fs from 'node:fs'
import { createHmac, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { syncWatchProgress } from './_gen/watch-sync.ts'
import { POST as webhook } from './_gen/whop-webhook-route.ts'
import { POST as requestRoute } from './_gen/discount-request-route.ts'
import { POST as feedbackRoute } from './_gen/discount-submit-feedback-route.ts'
import {
  OLD_COURSE_REQUEST_REFUSAL, approvalVerdict, discountRefusalMessage, explainOldCourseRequest, loadDiscountReads,
} from './_gen/discount-server.ts'
import { discountState, requiredLessons } from './_gen/discount.ts'
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
import { FakeDb, fakeClient, useDb as installDb, setCatalog, setWhop, steps } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

/** Runs `fn` with the routes' log lines kept off the test's output. */
async function hush(fn) {
  const real = [console.info, console.warn, console.error]
  console.info = console.warn = console.error = () => {}
  try { return await fn() } finally { [console.info, console.warn, console.error] = real }
}

const RealDate = Date
/** Runs `fn` with the clock at `iso`: `new Date()` and `Date.now()` answer it, a date made from a value is as ever. */
async function at(iso, fn) {
  const t = RealDate.parse(iso)
  class Clock extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(t)
      else super(...args)
    }
    static now() { return t }
  }
  globalThis.Date = Clock
  try { return await fn() } finally { globalThis.Date = RealDate }
}

// The real course, as the switch leaves it in `lessons`. The Whop lesson ids
// are made up here: the rule never reads them, only the match does.
const read = (rel) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'))
const catalog = read('../supabase/catalog/course_catalog.json')
const lengths = read('../src/app/dev/world-app/course-lengths.fixture.json')
const whopId = (id) => `lesn_test_${id}`
const LESSONS = catalog.lessons.map((l, i) => ({
  id: l.id,
  type: l.type,
  sort_order: i + 1,
  counts_toward_progress: l.counts !== false,
  is_gate: l.gate === true,
  duration_seconds: lengths[l.id] ?? null,
  whop_lesson_id: whopId(l.id),
}))
const REQUIRED = requiredLessons(LESSONS.map((l) => ({ ...l, has_video: l.id in lengths }))).map((l) => l.id)
const GATE = REQUIRED.at(-1)

const SEPT_15 = '2026-09-15T10:00:00.000Z'
function freshDb(paid = SEPT_15, requests = []) {
  setCatalog({ v2: true, lessonsTable: 'lessons' })
  const db = new FakeDb({
    students: [{ id: 's1', whop_user_id: 'user_1', supabase_user_id: 'auth-1', first_paid_at: paid, joined_at: paid }],
    lessons: LESSONS,
    lesson_videos: Object.keys(lengths).map((lesson_id) => ({ lesson_id, created_at: '2026-10-12T00:00:00.000Z' })),
    student_lesson_completions: [],
    discount_requests: requests.map((r) => ({ student_id: 's1', promo_code: null, rejection_reason: null, ...r })),
  }, { 'tok-1': 'auth-1' })
  installDb(db)
  feedbackFunction(db)
  steps.length = 0
  return db
}

/**
 * submit_discount_with_feedback (v29), standing in: its duplicate check
 * (pending, approved or applied, whatever the date), the request, then the
 * answers. What it says when it refuses is v29's own sentence.
 */
function feedbackFunction(db) {
  db.functions.submit_discount_with_feedback = async (args, client) => {
    const { data: existing } = await client.from('discount_requests').select('id')
      .eq('student_id', args.p_student_id).in('status', ['pending', 'approved', 'applied']).limit(1).maybeSingle()
    if (existing) return { data: null, error: { code: 'P0001', message: 'A discount request already exists for this student' } }
    const { data: row, error } = await client.from('discount_requests').insert({ student_id: args.p_student_id }).select('id').single()
    if (error) return { data: null, error }
    for (const a of args.p_answers) {
      await client.from('discount_feedback_responses').insert({ discount_request_id: row.id, question_id: a.question_id })
    }
    return { data: row.id, error: null }
  }
}
/** Never shown to a student: the database's own sentence. */
const dbWords = (body) => /already exists for this student|duplicate key|unique constraint/.test(show(body))

/** Whop answers the backfill with these lessons finished. */
const onWhop = (ids) => setWhop(async () => ({
  interactions: ids.map((id) => ({ lesson: { id: whopId(id) }, completed: true })),
  rawCount: ids.length,
  completedCount: ids.length,
}))
const backfill = () => hush(() => syncWatchProgress({ studentId: 's1', whopUserId: 'user_1' }))

// The webhook's deliveries, signed the way Whop signs them, with a secret made up here.
const KEY = randomBytes(24)
process.env.WHOP_WEBHOOK_SECRET = `ws_${KEY.toString('base64')}`
let msg = 0
async function webhookFinished(lessonId) {
  const body = JSON.stringify({
    type: 'course_lesson_interaction.completed',
    data: { user: { id: 'user_1' }, lesson: { id: whopId(lessonId) }, completed: true },
  })
  const id = `msg_${++msg}`
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = createHmac('sha256', KEY).update(`${id}.${ts}.${body}`).digest('base64')
  const res = await hush(() => webhook(new Request('http://app/api/webhooks/whop', {
    method: 'POST',
    headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` },
    body,
  })))
  return res.status
}

/** Lessons watched to the end in the app at this moment. */
async function watchedInApp(db, ids) {
  for (const lesson_id of ids) await fakeClient(db).from('student_lesson_completions').insert({ student_id: 's1', lesson_id })
}

/** The map's Apply with no active questions: POST /api/discounts/request. */
async function apply() {
  const res = await hush(() => requestRoute(new Request('http://app/api/discounts/request', {
    method: 'POST',
    headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: 's1' }),
  })))
  return { status: res.status, body: await res.json() }
}

/** The map's Apply while questions are active (the default): the questions form, POST /api/discounts/submit-feedback. */
const ANSWERS = [{ question_id: 'q1', answer_scale: 9 }, { question_id: 'q4', answer_text: 'the hooks lesson' }]
async function submit() {
  const res = await hush(() => feedbackRoute(new Request('http://app/api/discounts/submit-feedback', {
    method: 'POST',
    headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: 's1', answers: ANSWERS }),
  })))
  return { status: res.status, body: await res.json() }
}

/**
 * What the map shows (useWorldDiscount): discountState over the student's
 * first payment, the course with its videos, the lessons whose video is
 * done, and the newest request only (/api/student/data reads one).
 */
function mapSays(db, nowIso) {
  const student = db.rows('students')[0]
  const videos = new Set(db.rows('lesson_videos').map((v) => v.lesson_id))
  const lessons = [...db.rows('lessons')].sort((a, b) => a.sort_order - b.sort_order).map((l) => ({
    id: l.id, type: l.type, counts_toward_progress: l.counts_toward_progress !== false, is_gate: l.is_gate === true,
    has_video: videos.has(l.id), duration_seconds: l.duration_seconds ?? null,
  }))
  const done = new Set(db.rows('student_lesson_completions').filter((c) => c.completed_at).map((c) => c.lesson_id))
  const newest = [...db.rows('discount_requests')].sort((a, b) => RealDate.parse(b.created_at) - RealDate.parse(a.created_at))[0]
  return discountState({ now: new RealDate(nowIso), firstPaidAt: student.first_paid_at, lessons, videoDoneIds: done, requests: newest ? [newest] : [] })
}

/** The approve route's judgment, on `day`, of a request made at `asked`. */
async function approve(db, day, asked) {
  return approvalVerdict(await loadDiscountReads(fakeClient(db), 's1', 'lessons'), new RealDate(day), asked)
}

const completedAt = (db, id) => db.rows('student_lesson_completions').find((r) => r.lesson_id === id)?.completed_at ?? null

console.log('\n=== The course this runs on ===')
ok(REQUIRED.length === 59 && GATE === 'a4l17', '59 videos up to the gate, a4l17', `${REQUIRED.length}, gate ${GATE}`)

console.log('\n=== Paid 15 September, finished on Whop and in the app by 23 October: it counts ===')
{
  const db = freshDb()
  // While the app is closed the student watches on Whop. The first visit
  // after the switch (Monday 19 October, 09:30 in Croatia) brings it in.
  onWhop(REQUIRED.slice(0, 50))
  const sync = await at('2026-10-19T07:30:00.000Z', backfill)
  const rows = db.rows('student_lesson_completions')
  ok(sync.syncedCount === 50 && rows.length === 50 && rows.every((r) => r.completed_at === '2026-10-19T07:30:00.000Z'),
     'the visit on 19 October brings the 50 lessons finished on Whop in, stamped with that moment', show({ synced: sync.syncedCount, rows: rows.length }))
  // Eight more in the app on Wednesday evening.
  await at('2026-10-21T18:00:00.000Z', () => watchedInApp(db, REQUIRED.slice(50, 58)))
  ok(completedAt(db, REQUIRED[57]) === '2026-10-21T18:00:00.000Z', 'eight watched in the app on 21 October')
  // The gate on Whop on Friday at 22:00 in Croatia, reported by the webhook.
  const hook = await at('2026-10-23T20:00:00.000Z', () => webhookFinished(GATE))
  ok(hook === 200 && completedAt(db, GATE) === '2026-10-23T20:00:00.000Z',
     'the gate, finished on Whop at 22:00 on 23 October, comes in by the webhook with that moment', `${hook} ${completedAt(db, GATE)}`)
  const sent = await at('2026-10-23T21:30:00.000Z', apply)
  ok(sent.status === 200 && sent.body.status === 'pending', 'Apply at 23:30 on 23 October in Croatia: the request goes in', show(sent))
  const asked = db.rows('discount_requests')[0]?.created_at ?? null
  ok(asked === '2026-10-23T21:30:00.000Z' && steps.some((s) => s.step === 'discount-requested'), 'one request, made then, and the team\'s hook ran', asked)
  const v = await approve(db, '2026-10-27T09:00:00.000Z', asked)
  ok(v.ok === true, 'the team approves it on 27 October: approved, judged as of the end of 23 October', show(v))
}

console.log('\n=== The same student, the gate finished at 00:00:30 on 24 October: too late ===')
{
  const db = freshDb()
  onWhop(REQUIRED.slice(0, 58))
  await at('2026-10-19T07:30:00.000Z', backfill)
  const hook = await at('2026-10-23T22:00:30.000Z', () => webhookFinished(GATE))
  ok(hook === 200 && completedAt(db, GATE) === '2026-10-23T22:00:30.000Z', 'the gate comes in 30 seconds into 24 October in Croatia')
  const sent = await at('2026-10-23T22:05:00.000Z', apply)
  ok(sent.status === 400 && sent.body.state === 'expired'
       && sent.body.error === 'The discount closed at the end of October 23, Croatia time. That was the deadline for students who joined before the new course launched.',
     'Apply at 00:05 on 24 October: refused as expired, the day and the clock named', show(sent))
  ok(db.rows('discount_requests').length === 0, 'and no request is written')
  const v = await approve(db, '2026-10-27T09:00:00.000Z', null)
  ok(!v.ok && v.status === 400 && v.error.includes('by the end of October 23') && v.error.includes('1 of 59 still missing'),
     'the approval would refuse it too: 1 of 59 still missing (only Generate anyway skips the check)', v.error)
}

console.log('\n=== Everything finished on Whop in time, but the app first opened on 24 October ===')
{
  // The app counts a Whop lesson from the moment it learns of it (Decision 4,
  // as built): the backfill stamps the time it runs, and before the switch
  // the webhook finds no new-course lesson to write.
  const db = freshDb()
  onWhop(REQUIRED)
  await at('2026-10-24T07:00:00.000Z', backfill)
  ok(db.rows('student_lesson_completions').length === 59 && completedAt(db, GATE) === '2026-10-24T07:00:00.000Z',
     'the first visit, on 24 October at 09:00 in Croatia, brings all 59 in with that moment')
  const sent = await at('2026-10-24T07:05:00.000Z', apply)
  ok(sent.status === 400 && sent.body.state === 'expired', 'Apply then: refused as expired, the 23 October deadline has passed', show(sent))
}

console.log('\n=== Paid at 23:59 on 8 September in Croatia: never ===')
{
  const db = freshDb('2026-09-08T21:59:00.000Z')
  onWhop(REQUIRED)
  await at('2026-10-19T07:30:00.000Z', backfill)
  const sent = await at('2026-10-20T10:00:00.000Z', apply)
  ok(sent.status === 400 && sent.body.state === 'not-eligible'
       && sent.body.error === 'The 30% discount is for students who joined on or after September 9, 2026. Your first payment was before that.',
     'every video done, Apply on 20 October: not eligible, the day named', show(sent))
  const v = await approve(db, '2026-10-27T09:00:00.000Z', null)
  ok(!v.ok && v.error.includes('before September 9, 2026'), 'and the approval refuses it', v.error)
}

console.log('\n=== Paid at 00:00 on 9 September in Croatia: in ===')
{
  const db = freshDb('2026-09-08T22:00:00.000Z')
  onWhop(REQUIRED)
  await at('2026-10-19T07:30:00.000Z', backfill)
  const sent = await at('2026-10-20T10:00:00.000Z', apply)
  ok(sent.status === 200 && sent.body.status === 'pending', 'every video done, Apply on 20 October: the request goes in', show(sent))
  const v = await approve(db, '2026-10-21T09:00:00.000Z', db.rows('discount_requests')[0]?.created_at ?? null)
  ok(v.ok === true, 'and the team approves it', show(v))
}

console.log('\n=== Paid 15 September, already holding a request from the old course: the map, both ways to apply and the database agree ===')
{
  // The request was made on the old dashboard on 25 September. Every video
  // is done (from Whop, on 19 October), and the student opens the map on
  // 20 October.
  const OLD = '2026-09-25T10:00:00.000Z'
  const NOW = '2026-10-20T10:00:00.000Z'
  const withOld = async (status) => {
    const db = freshDb(SEPT_15, [{ id: 'old', status, created_at: OLD, promo_code: status === 'pending' || status === 'rejected' ? null : 'ECOM30-S1OLD' }])
    onWhop(REQUIRED)
    await at('2026-10-19T07:30:00.000Z', backfill)
    return db
  }
  for (const status of ['pending', 'approved', 'applied']) {
    for (const [way, send] of [['the questions form', submit], ['the plain request', apply]]) {
      const db = await withOld(status)
      const map = mapSays(db, NOW)
      const r = await at(NOW, send)
      ok(map.kind === status && map.madeBeforeLaunch === true && r.status === 400 && r.body.state === status
           && r.body.error === discountRefusalMessage(map) && !dbWords(r.body),
         `old ${status}, ${way}: the map shows "${status}" with no Apply, and a stale Apply is refused as ${status} in the app's own words, never the database's`,
         show({ map: map.kind, r }))
      ok(db.calls('submit_discount_with_feedback', 'rpc').length === 0 && db.rows('discount_requests').length === 1
           && !steps.some((s) => s.step === 'discount-requested'),
         `old ${status}, ${way}: refused before the database function, nothing written, no team task`)
    }
  }
  for (const [way, send] of [['the questions form', submit], ['the plain request', apply]]) {
    const db = await withOld('rejected')
    const before = mapSays(db, NOW)
    const r = await at(NOW, send)
    const made = db.rows('discount_requests').find((x) => x.id !== 'old')
    ok(before.kind === 'ready' && r.status === 200 && made?.status === 'pending' && made.created_at === NOW,
       `old rejected, ${way}: the map shows Apply and the request goes in`, show({ before: before.kind, r: r.status }))
    const after = mapSays(db, NOW)
    ok(after.kind === 'pending' && after.madeBeforeLaunch === false && steps.some((s) => s.step === 'discount-requested'),
       `old rejected, ${way}: the map then shows the new request in review, and the team's task is made`)
    const v = await approve(db, '2026-10-27T09:00:00.000Z', made?.created_at ?? null)
    ok(v.ok === true, `old rejected, ${way}: the team approves the new request on 27 October`, show(v))
  }
  {
    // The team then decides the old request still in review.
    const db = await withOld('pending')
    const v = await approve(db, '2026-10-21T09:00:00.000Z', OLD)
    const said = explainOldCourseRequest(v, OLD, '2026-10-19T05:00:00.000Z')
    ok(!v.ok && v.status === 400 && said.error === OLD_COURSE_REQUEST_REFUSAL,
       'the team approving that old pending request is told to judge it by hand (Generate anyway skips the check), as for any request made before the switch',
       said.error)
  }
}

ok(Date === RealDate, 'the clock is the real one again')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
