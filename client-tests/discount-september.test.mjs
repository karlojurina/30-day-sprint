// T-080 end to end: a student whose first payment was on 2 October (after
// 1 October, before the launch on 9 October) has until the end of
// 23 October in Croatia, and the lessons they finish on Whop count. The file
// is named for the group as it began, from 9 September; Lovro moved the first
// date to 1 October on 2026-10-19, and a September payment is now refused
// (its own section below).
//
// What decides is the real source, copied by build.mjs: the Whop backfill a
// visit runs (watch-sync.ts), the Whop webhook, both routes that write a
// request, and approvalVerdict over the reads loadDiscountReads makes, which is what
// POST /api/discounts/approve runs on the new course (the route also needs a
// team login and Whop's promo code, neither of which is the rule; the ads tick
// it also needed went on 2026-10-20, Lovro's decision).
// Since 2026-10-17 the approve route itself runs too, in the section that says
// so (a founder's login and Whop's promo code standing in), and so does the
// data route behind every student page, for what it sends of a request.
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
import { POST as approveRoute } from './_gen/discount-approve-route.ts'
import { GET as appData } from './_gen/student-data-route.ts'
import {
  OLD_COURSE_REQUEST_REFUSAL, approvalVerdict, discountRefusalMessage, explainOldCourseRequest, loadDiscountReads,
} from './_gen/discount-server.ts'
import { discountState, requiredLessons } from './_gen/discount.ts'
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
import { FakeDb, fakeClient, promoCodes, useDb as installDb, setCatalog, setWhop, steps } from './_gen/stub-server.ts'

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

const OCT_2 = '2026-10-02T10:00:00.000Z'
function freshDb(paid = OCT_2, requests = []) {
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

/** The approve route's judgment, on `day`, of a request made at `asked` (with its id, `id`; `resetAt` the switch, as the route reads it). */
async function approve(db, day, asked, id, resetAt) {
  return approvalVerdict(await loadDiscountReads(fakeClient(db), 's1', 'lessons'), new RealDate(day), asked, id, resetAt)
}

const completedAt = (db, id) => db.rows('student_lesson_completions').find((r) => r.lesson_id === id)?.completed_at ?? null

console.log('\n=== The course this runs on ===')
ok(REQUIRED.length === 61 && GATE === 'a4l17', '61 videos up to the gate, a4l17', `${REQUIRED.length}, gate ${GATE}`)

console.log('\n=== Paid 2 October, finished on Whop and in the app by 23 October: it counts ===')
{
  const db = freshDb()
  // While the app is closed the student watches on Whop. The first visit
  // after the switch (Monday 19 October, 09:30 in Croatia) brings it in.
  onWhop(REQUIRED.slice(0, 50))
  const sync = await at('2026-10-19T07:30:00.000Z', backfill)
  const rows = db.rows('student_lesson_completions')
  ok(sync.syncedCount === 50 && rows.length === 50 && rows.every((r) => r.completed_at === '2026-10-19T07:30:00.000Z'),
     'the visit on 19 October brings the 50 lessons finished on Whop in, stamped with that moment', show({ synced: sync.syncedCount, rows: rows.length }))
  // The rest but the gate in the app on Wednesday evening.
  await at('2026-10-21T18:00:00.000Z', () => watchedInApp(db, REQUIRED.slice(50, -1)))
  ok(completedAt(db, REQUIRED.at(-2)) === '2026-10-21T18:00:00.000Z', 'the rest but the gate watched in the app on 21 October')
  // The gate on Whop on Friday at 22:00 in Croatia, reported by the webhook.
  const hook = await at('2026-10-23T20:00:00.000Z', () => webhookFinished(GATE))
  ok(hook === 200 && completedAt(db, GATE) === '2026-10-23T20:00:00.000Z',
     'the gate, finished on Whop at 22:00 on 23 October, comes in by the webhook with that moment', `${hook} ${completedAt(db, GATE)}`)
  const sent = await at('2026-10-23T21:30:00.000Z', apply)
  ok(sent.status === 200 && sent.body.status === 'pending', 'Apply at 23:30 on 23 October in Croatia: the request goes in', show(sent))
  const asked = db.rows('discount_requests')[0]?.created_at ?? null
  ok(asked === '2026-10-23T21:30:00.000Z' && steps.some((s) => s.step === 'discount-requested'), 'one request, made then, and the team\'s hook ran', asked)
  const v = await approve(db, '2026-10-27T09:00:00.000Z', asked, db.rows('discount_requests')[0]?.id)
  ok(v.ok === true, 'the team approves it on 27 October: approved, judged as of the end of 23 October', show(v))
}

console.log('\n=== The same student, the gate finished at 00:00:30 on 24 October: too late ===')
{
  const db = freshDb()
  onWhop(REQUIRED.slice(0, -1))
  await at('2026-10-19T07:30:00.000Z', backfill)
  const hook = await at('2026-10-23T22:00:30.000Z', () => webhookFinished(GATE))
  ok(hook === 200 && completedAt(db, GATE) === '2026-10-23T22:00:30.000Z', 'the gate comes in 30 seconds into 24 October in Croatia')
  const sent = await at('2026-10-23T22:05:00.000Z', apply)
  ok(sent.status === 400 && sent.body.state === 'expired'
       && sent.body.error === 'The discount closed at the end of October 23, Croatia time. That was the deadline for students who joined from October 1 until the new course launched.',
     'Apply at 00:05 on 24 October: refused as expired, the day and the clock named', show(sent))
  ok(db.rows('discount_requests').length === 0, 'and no request is written')
  const v = await approve(db, '2026-10-27T09:00:00.000Z', null)
  ok(!v.ok && v.status === 400 && v.error.includes('by the end of October 23') && v.error.includes('1 of 61 still missing'),
     'the approval would refuse it too: 1 of 61 still missing (only Generate anyway skips the check)', v.error)
}

console.log('\n=== Everything finished on Whop in time, but the app first opened on 24 October ===')
{
  // The app counts a Whop lesson from the moment it learns of it (Decision 4,
  // as built): the backfill stamps the time it runs, and before the switch
  // the webhook finds no new-course lesson to write.
  const db = freshDb()
  onWhop(REQUIRED)
  await at('2026-10-24T07:00:00.000Z', backfill)
  ok(db.rows('student_lesson_completions').length === 61 && completedAt(db, GATE) === '2026-10-24T07:00:00.000Z',
     'the first visit, on 24 October at 09:00 in Croatia, brings all 61 in with that moment')
  const sent = await at('2026-10-24T07:05:00.000Z', apply)
  ok(sent.status === 400 && sent.body.state === 'expired', 'Apply then: refused as expired, the 23 October deadline has passed', show(sent))
}

console.log('\n=== Paid at 23:59 on 30 September in Croatia: never ===')
{
  const db = freshDb('2026-09-30T21:59:00.000Z')
  onWhop(REQUIRED)
  await at('2026-10-19T07:30:00.000Z', backfill)
  const sent = await at('2026-10-20T10:00:00.000Z', apply)
  ok(sent.status === 400 && sent.body.state === 'not-eligible'
       && sent.body.error === 'The 30% discount is for students who joined on or after October 1, 2026, Croatia time. Your first payment was before that.',
     'every video done, Apply on 20 October: not eligible, the day named', show(sent))
  const v = await approve(db, '2026-10-27T09:00:00.000Z', null)
  ok(!v.ok && v.error.includes('before October 1, 2026'), 'and the approval refuses it', v.error)
}

console.log('\n=== Paid 15 September: in while the first date was 9 September, never since it moved to 1 October ===')
{
  const db = freshDb('2026-09-15T10:00:00.000Z')
  onWhop(REQUIRED)
  await at('2026-10-19T07:30:00.000Z', backfill)
  const map = mapSays(db, '2026-10-20T10:00:00.000Z')
  const sent = await at('2026-10-20T10:00:00.000Z', apply)
  const form = await at('2026-10-20T10:00:00.000Z', submit)
  ok(map.kind === 'not-eligible' && map.reason === 'before-launch' && sent.status === 400 && sent.body.state === 'not-eligible'
       && sent.body.error === 'The 30% discount is for students who joined on or after October 1, 2026, Croatia time. Your first payment was before that.'
       && form.status === 400 && form.body.state === 'not-eligible' && db.rows('discount_requests').length === 0,
     'every video in from Whop, on 20 October: the map says closed, and both ways to apply refuse with the day named, nothing written', show({ map, sent: sent.body, form: form.body }))
}

console.log('\n=== Paid at 00:00 on 1 October in Croatia: in ===')
{
  const db = freshDb('2026-09-30T22:00:00.000Z')
  onWhop(REQUIRED)
  await at('2026-10-19T07:30:00.000Z', backfill)
  const sent = await at('2026-10-20T10:00:00.000Z', apply)
  ok(sent.status === 200 && sent.body.status === 'pending', 'every video done, Apply on 20 October: the request goes in', show(sent))
  const v = await approve(db, '2026-10-21T09:00:00.000Z', db.rows('discount_requests')[0]?.created_at ?? null)
  ok(v.ok === true, 'and the team approves it', show(v))
}

console.log('\n=== Paid 2 October, already holding a request from the old course: the map, both ways to apply and the database agree ===')
{
  // The request was made on the old dashboard on 6 October. Every video
  // is done (from Whop, on 19 October), and the student opens the map on
  // 20 October.
  const OLD = '2026-10-06T10:00:00.000Z'
  const NOW = '2026-10-20T10:00:00.000Z'
  const withOld = async (status) => {
    const db = freshDb(OCT_2, [{ id: 'old', status, created_at: OLD, promo_code: status === 'pending' || status === 'rejected' ? null : 'ECOM30-S1OLD' }])
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
    // The team then decides the old request still in review, as the route
    // does since 2026-10-17: judged by the videos the new course had at the
    // switch. Until then every new-course video counted as loaded after the
    // request, and the team read "Judge it by hand" whether or not the
    // student had finished (the release review's case, the third check).
    const RESET = '2026-10-19T05:00:00.000Z'
    const db = await withOld('pending')
    const v = await approve(db, '2026-10-21T09:00:00.000Z', OLD, 'old', RESET)
    ok(v.ok === true, 'the team approving that old pending request, every video in from Whop on 19 October: approved', show(v))
    const unwatched = freshDb(OCT_2, [{ id: 'old', status: 'pending', created_at: OLD }])
    const refused = await approve(unwatched, '2026-10-21T09:00:00.000Z', OLD, 'old', RESET)
    const said = explainOldCourseRequest(refused, OLD, RESET)
    ok(!said.ok && said.status === 400 && said.error === `${OLD_COURSE_REQUEST_REFUSAL} The new rule says: ${refused.error}`
         && refused.error.endsWith('61 of 61 still missing.'),
       'the same request with nothing watched: the old-course sentence, then the new rule\'s count', said.error)
    const before = [db, unwatched].map(async (d) => explainOldCourseRequest(await approve(d, '2026-10-21T09:00:00.000Z', OLD, 'old'), OLD, RESET).error)
    const [a, b] = await Promise.all(before)
    ok(a === OLD_COURSE_REQUEST_REFUSAL && b === OLD_COURSE_REQUEST_REFUSAL,
       'without the switch\'s date both read exactly the same, "Judge it by hand" (how the route judged them before)')
  }
}

console.log('\n=== A request the database function wrote on the closed weekend, decided after the switch ===')
{
  // While the doors are closed the app's routes refuse every student (a
  // listed test account aside), but one still holding a session can call
  // submit_discount_with_feedback (v29) directly, and it checks only who is
  // asking and whether a request is already there. The request is dated
  // before the switch, so the approve route hands its refusal to
  // explainOldCourseRequest. A refusal over the first payment must keep its
  // words: the old-course sentence ends "Generate anyway skips the check".
  const WEEKEND = '2026-10-17T10:00:00.000Z'
  const RESET = '2026-10-19T05:00:00.000Z'
  const madeOnWeekend = async (paid) => {
    const db = freshDb(paid)
    const r = await at(WEEKEND, () => fakeClient(db).rpc('submit_discount_with_feedback', { p_student_id: 's1', p_answers: ANSWERS }))
    return { db, made: !r.error && db.rows('discount_requests').length === 1, asked: db.rows('discount_requests')[0]?.created_at ?? null }
  }
  const team = async (db, asked) => explainOldCourseRequest(await approve(db, '2026-10-20T09:00:00.000Z', asked, undefined, RESET), asked, RESET)
  {
    const { db, made, asked } = await madeOnWeekend('2026-08-15T10:00:00.000Z')
    const said = await team(db, asked)
    ok(made && asked === WEEKEND && !said.ok && said.status === 400
         && said.error === "Cannot approve: the student's first payment (2026-08-15T10:00:00.000Z) is before October 1, 2026. Only a first payment from then on can earn the discount.",
       'paid 15 August: the team reads the refusal over the first payment, never "Judge it by hand"', said.error)
  }
  {
    const { db, made, asked } = await madeOnWeekend(null)
    const said = await team(db, asked)
    ok(made && asked === WEEKEND && !said.ok && said.status === 400 && said.error.startsWith('Cannot approve: student has no first_paid_at on file.'),
       'no first payment on file: the team reads that refusal in its own words', said.error)
  }
  {
    const { db, made, asked } = await madeOnWeekend(OCT_2)
    const said = await team(db, asked)
    ok(made && !said.ok && said.status === 400 && said.error.startsWith(`${OLD_COURSE_REQUEST_REFUSAL} The new rule says: `)
         && said.error.endsWith('61 of 61 still missing.'),
       'paid 2 October, nothing watched yet: the old-course sentence, then the new rule\'s count', said.error)
    // Monday morning: the first visit after the switch brings every video in from Whop.
    onWhop(REQUIRED)
    await at('2026-10-19T07:30:00.000Z', backfill)
    const later = await team(db, asked)
    ok(later.ok === true, 'the same request once every video came in from Whop on 19 October: approved, nothing left to judge by hand', show(later))
  }
}

console.log('\n=== A request the app\'s Apply could not have made: Approve refuses it (17 October) ===')
{
  // Until v107 a student holding a session can call the feedback form's
  // database function straight (the stand-in here, like v29, writes for any
  // caller). v29 checks only who is asking and whether a pending, approved or
  // applied request is there: never the first payment, the deadline or the
  // videos. Paid 3 October, every video in from Whop on 20 October.
  const OCT_3 = '2026-10-03T10:00:00.000Z'
  const straight = (db, iso) => at(iso, () => fakeClient(db).rpc('submit_discount_with_feedback', { p_student_id: 's1', p_answers: ANSWERS }))
  const everyVideo = async () => {
    const db = freshDb(OCT_3)
    onWhop(REQUIRED)
    await at('2026-10-20T07:30:00.000Z', backfill)
    return db
  }
  {
    const db = await everyVideo()
    const sent = await at('2026-10-25T09:00:00.000Z', apply)
    ok(sent.status === 400 && sent.body.state === 'expired' && db.rows('discount_requests').length === 0,
       'on 25 October the app\'s Apply refuses: the discount closed at the end of 23 October', show(sent.body))
    const r = await straight(db, '2026-10-25T09:00:00.000Z')
    const req = db.rows('discount_requests')[0]
    ok(!r.error && req?.status === 'pending' && req.created_at === '2026-10-25T09:00:00.000Z',
       'the same morning, straight through the function: a pending request dated 25 October', show(r))
    const v = await approve(db, '2026-10-26T09:00:00.000Z', req?.created_at ?? null, req?.id)
    ok(!v.ok && v.status === 400 && v.reason === 'late-request'
         && v.error === "Cannot approve: this request was made at 2026-10-25T09:00:00.000Z, after the student's deadline (2026-10-23T21:59:59.999Z), and the app refuses an application that late. Judge it by hand; Generate anyway skips the check.",
       'Approve on 26 October refuses it as made after the deadline (before this check it was approved: every video was done by 20 October)', v.error)
  }
  {
    const db = await everyVideo()
    const first = await at('2026-10-20T10:00:00.000Z', apply)
    // The team rejects it, as POST /api/discounts/reject writes it.
    await fakeClient(db).from('discount_requests').update({ status: 'rejected', rejection_reason: 'ads not verified' }).eq('id', first.body.id)
    const again = await at('2026-10-21T10:00:00.000Z', apply)
    const form = await at('2026-10-21T10:00:00.000Z', submit)
    ok(first.status === 200 && again.status === 400 && again.body.state === 'rejected'
         && again.body.error === "Your discount request was already reviewed, and it wasn't approved."
         && form.status === 400 && form.body.state === 'rejected' && db.rows('discount_requests').length === 1,
       'rejected by the team on 20 October: both ways the app applies refuse a second request the next day', show({ again: again.body, form: form.body }))
    const r = await straight(db, '2026-10-21T10:00:00.000Z')
    const req = db.rows('discount_requests').find((x) => x.status === 'pending')
    ok(!r.error && req?.created_at === '2026-10-21T10:00:00.000Z',
       'straight through the function the same day: a fresh pending request (the function refuses only beside a pending, approved or applied one)', show(r))
    const v = await approve(db, '2026-10-22T09:00:00.000Z', req?.created_at ?? null, req?.id)
    ok(!v.ok && v.status === 400 && v.reason === 'another-request'
         && v.error === `Cannot approve: this student's other request (made ${first.body.created_at}) was rejected, and the app refuses a new application after a rejection. Judge it by hand; Generate anyway skips the check.`,
       'Approve refuses it: the request of 20 October was rejected (before this check it was approved)', v.error)
    const rejected = db.rows('discount_requests').find((x) => x.status === 'rejected')
    ok((await approve(db, '2026-10-22T09:00:00.000Z', rejected.created_at, rejected.id)).ok === true,
       'control: judged as the rejected request\'s own approval, the pending one is no reason and every video passes, so the refusal above is about the rejection alone')
  }
}

console.log('\n=== The approve button itself, POST /api/discounts/approve (2026-10-17) ===')
{
  // The real route on the stand-in database: a founder's login, the switch's
  // date read from admin_config, the rule, then Whop's promo code (a stand-in
  // that records what it is asked for) and the row's update. Since 2026-10-20
  // no ads tick: `switched` still sets students.ad_submissions_verified, to
  // show it decides nothing.
  const RESET = '2026-10-19T05:00:00.000Z'
  const OLD = '2026-10-06T10:00:00.000Z'
  const switched = (db, adsVerified) => {
    db.rows('admin_config').push({ key: 'curriculum_reset_at', value: RESET })
    db.rows('students')[0].ad_submissions_verified = adsVerified
    return db
  }
  /** The team presses Approve (or Generate anyway, `override`) on request `id` at `iso`. */
  const press = (db, id, iso, override = false) => at(iso, async () => {
    const codesBefore = promoCodes.length
    const res = await hush(() => approveRoute(new Request('http://app/api/discounts/approve', {
      method: 'POST',
      headers: { authorization: 'Bearer team', 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: id, reviewerId: 'team-1', override }),
    })))
    return { status: res.status, body: await res.json(), codes: promoCodes.length - codesBefore, row: db.rows('discount_requests').find((r) => r.id === id) }
  })
  const OLD_UNWATCHED = `${OLD_COURSE_REQUEST_REFUSAL} The new rule says: Student has not watched every video up to the discount checkpoint by the end of October 23 (Croatia time), the deadline for a first payment before the launch: 61 of 61 still missing.`
  {
    // The release review's case: an early-October joiner's request from the old dashboard, decided after the switch.
    const db = switched(freshDb(OCT_2, [{ id: 'old', status: 'pending', created_at: OLD }]), true)
    onWhop(REQUIRED)
    await at('2026-10-19T07:30:00.000Z', backfill)
    const r = await press(db, 'old', '2026-10-21T09:00:00.000Z')
    ok(r.status === 200 && r.body.success === true && r.codes === 1 && r.row.status === 'approved' && r.row.promo_code === r.body.promoCode,
       'paid 2 October, applied on the old dashboard on 6 October, every video in from Whop on 19 October: Approve approves it and makes the code (it said "Judge it by hand")',
       show({ status: r.status, body: r.body }))
  }
  {
    // The same for a September joiner, the release review's own case: since the first date moved to 1 October the
    // rule refuses it over the first payment, in those words (Generate anyway still skips every check).
    const db = switched(freshDb('2026-09-15T10:00:00.000Z', [{ id: 'old', status: 'pending', created_at: '2026-09-25T10:00:00.000Z' }]), true)
    onWhop(REQUIRED)
    await at('2026-10-19T07:30:00.000Z', backfill)
    const r = await press(db, 'old', '2026-10-21T09:00:00.000Z')
    ok(r.status === 400 && r.body.error === "Cannot approve: the student's first payment (2026-09-15T10:00:00.000Z) is before October 1, 2026. Only a first payment from then on can earn the discount."
         && r.codes === 0 && r.row.status === 'pending',
       'paid 15 September, applied on the old dashboard on 25 September, every video in from Whop: Approve refuses it over the first payment, no code, still pending', r.body.error)
  }
  {
    const db = switched(freshDb(OCT_2, [{ id: 'old', status: 'pending', created_at: OLD }]), true)
    const r = await press(db, 'old', '2026-10-21T09:00:00.000Z')
    ok(r.status === 400 && r.body.error === OLD_UNWATCHED && r.codes === 0 && r.row.status === 'pending',
       'the same request with nothing watched: refused, the old-course sentence and then "61 of 61 still missing", no code, still pending', r.body.error)
    onWhop(REQUIRED.slice(0, 51))
    await at('2026-10-19T07:30:00.000Z', backfill)
    const part = await press(db, 'old', '2026-10-21T09:00:00.000Z')
    ok(part.status === 400 && part.body.error.endsWith('10 of 61 still missing.') && part.codes === 0,
       '51 of them in from Whop: the count says 10 still missing', part.body.error)
  }
  {
    // A first payment before 1 October with the ads not ticked: the rule
    // refuses it over the first payment (the ads refusal that once came first
    // is gone since 2026-10-20), and Generate anyway still skips every check.
    const WEEKEND = '2026-10-17T10:00:00.000Z'
    const db = switched(freshDb('2026-08-15T10:00:00.000Z', [{ id: 'wk', status: 'pending', created_at: WEEKEND }]), false)
    const r = await press(db, 'wk', '2026-10-20T09:00:00.000Z')
    ok(r.status === 400 && r.body.error === "Cannot approve: the student's first payment (2026-08-15T10:00:00.000Z) is before October 1, 2026. Only a first payment from then on can earn the discount."
         && r.codes === 0 && r.row.status === 'pending',
       'paid 15 August, the ads never ticked: the rule says no, so Approve refuses it over the first payment, no code, still pending', r.body.error)
    const anyway = await press(db, 'wk', '2026-10-20T09:05:00.000Z', true)
    ok(anyway.status === 200 && anyway.codes === 1 && anyway.row.status === 'approved',
       'Generate anyway still skips every check, as it always did (MORNING.md step 4 tells the team not to press it there)', show(anyway.body))
  }
  {
    // Lovro, 2026-10-20: no ads check. Ready on the new map, the ads never
    // ticked: the normal button approves it (it refused over the ads before).
    const db = switched(freshDb(OCT_2), false)
    onWhop(REQUIRED)
    await at('2026-10-19T07:30:00.000Z', backfill)
    const sent = await at('2026-10-20T10:00:00.000Z', apply)
    const r = await press(db, sent.body.id, '2026-10-21T09:00:00.000Z')
    ok(sent.status === 200 && r.status === 200 && r.body.success === true && r.codes === 1 && r.row.status === 'approved'
         && r.row.promo_code === r.body.promoCode && db.rows('students')[0].ad_submissions_verified === false,
       'ready on the new map, the ads never ticked: Approve approves it and makes one code', show(r.body))
  }
  {
    // And the rule still decides: 60 of the 61 videos in, the ads never ticked,
    // a request made after the switch (straight in the table: the map's Apply
    // would not offer it). Refused over the videos, no code, still pending.
    const db = switched(freshDb(OCT_2, [{ id: 'part', status: 'pending', created_at: '2026-10-20T10:00:00.000Z' }]), false)
    onWhop(REQUIRED.slice(0, 60))
    await at('2026-10-19T07:30:00.000Z', backfill)
    const r = await press(db, 'part', '2026-10-21T09:00:00.000Z')
    ok(r.status === 400 && r.body.error.startsWith('Student has not watched every video up to the discount checkpoint')
         && r.body.error.endsWith('1 of 61 still missing.') && r.codes === 0 && r.row.status === 'pending',
       '60 of 61 videos, the ads never ticked: the rule says no, so Approve refuses it, no code, still pending', r.body.error)
    db.rows('students')[0].ad_submissions_verified = true
    const ticked = await press(db, 'part', '2026-10-21T09:05:00.000Z')
    ok(ticked.status === 400 && ticked.body.error === r.body.error && ticked.codes === 0 && ticked.row.status === 'pending',
       'the same with the ads ticked: the same refusal, word for word (the tick decides nothing)', ticked.body.error)
  }
  {
    const db = switched(freshDb(OCT_2, [{ id: 'old', status: 'pending', created_at: OLD }]), true)
    onWhop(REQUIRED)
    await at('2026-10-19T07:30:00.000Z', backfill)
    db.fail['admin_config.select'] = { message: 'permission denied for table admin_config' }
    const r = await press(db, 'old', '2026-10-21T09:00:00.000Z')
    ok(r.status === 500 && r.body.error === "Couldn't read the course switch date, so nothing was approved. Try again." && r.codes === 0 && r.row.status === 'pending',
       'the switch\'s date cannot be read: 500, nothing approved, no code (the date can change the verdict now)', r.body.error)
  }
}

console.log('\n=== What a student\'s browser gets of their request: never the promo code (2026-10-17) ===')
{
  // GET /api/student/data, behind every student page. The code works on every
  // plan of the company while WHOP_DISCOUNT_PLAN_IDS is unset (T-084), and the
  // student's screens read only the status, the dates and the team's reason.
  const db = freshDb(OCT_2, [{ id: 'ok1', status: 'approved', created_at: '2026-10-20T10:00:00.000Z', promo_code: 'ECOM30-S1', whop_promo_id: 'promo_9' }])
  const res = await hush(() => appData(new Request('http://app/api/student/data', { headers: { authorization: 'Bearer tok-1' } })))
  const body = await res.json()
  const got = body.discountRequest
  ok(res.status === 200 && show(Object.keys(got ?? {}).sort()) === show(['created_at', 'id', 'rejection_reason', 'status']) && got.status === 'approved',
     'the request comes with its id, status, date and the team\'s reason, and nothing else', show(got))
  ok(db.rows('discount_requests')[0].promo_code === 'ECOM30-S1' && !show(body).includes('ECOM30-S1') && !show(body).includes('promo_9'),
     'the code and its Whop id are on the row, and nowhere in the answer')
  const lessons = LESSONS.map((l) => ({ ...l, has_video: l.id in lengths }))
  const st = discountState({ now: new RealDate('2026-10-21T10:00:00.000Z'), firstPaidAt: OCT_2, lessons, videoDoneIds: new Set(), requests: [got] })
  ok(st.kind === 'approved' && st.requestId === 'ok1' && st.madeBeforeLaunch === false, 'and the map still reads it as approved', show({ kind: st.kind, id: st.requestId }))
  const journal = fs.readFileSync(fileURLToPath(new URL('../src/app/journal/[studentId]/page.tsx', import.meta.url)), 'utf8')
  ok(/from\("discount_requests"\)\s*\.select\("status"\)/.test(journal) && !journal.includes('promo_code'),
     'the Field Journal reads the status alone: its view is a client component, so whatever it reads reaches the browser (checked in the source)')
}

ok(Date === RealDate, 'the clock is the real one again')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
