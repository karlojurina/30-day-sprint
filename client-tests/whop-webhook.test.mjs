// The Whop webhook's lesson completions (src/app/api/webhooks/whop/route.ts,
// backend_readiness.md section 5, item 12). A lesson whose row already exists
// (a skip, a saved Discord link, an action done before the video) is finished
// the way the backfill finishes it, and the steps the app runs after a lesson
// (src/lib/complete-lesson.ts, afterCompletionWrite: the streak, the "came
// back" check, the badges, the CSM tasks) run once, on the delivery that
// finished it. A completion carries the time it arrives (Decision 4 is
// Lovro's; this keeps today's answer).
// The route is the real source, copied by build.mjs with its imports pointed
// at stub-server.ts, and since T-079 at the real complete-lesson.ts, whose
// four steps stub-server.ts records (the streak's also runs; streak.test.mjs
// reads what it wrote). Every delivery is signed the way Whop signs it
// (Standard Webhooks), with a secret made up here.
import { createHmac, randomBytes } from 'node:crypto'
import { POST } from './_gen/whop-webhook-route.ts'
import { FakeDb, useDb, steps } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

/** Runs `fn` with the console quiet; returns [result, lines]. */
async function quietly(fn) {
  const real = [console.info, console.warn, console.error]
  const lines = []
  console.info = console.warn = console.error = (...a) => { lines.push(a.join(' ')) }
  try { return [await fn(), lines] } finally { [console.info, console.warn, console.error] = real }
}

const KEY = randomBytes(24)
process.env.WHOP_WEBHOOK_SECRET = `ws_${KEY.toString('base64')}`
let msg = 0
function delivery(payload, { sign = true } = {}) {
  const body = JSON.stringify(payload)
  const id = `msg_${++msg}`
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = createHmac('sha256', sign ? KEY : randomBytes(24)).update(`${id}.${ts}.${body}`).digest('base64')
  return new Request('http://app/api/webhooks/whop', {
    method: 'POST',
    headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` },
    body,
  })
}
const finished = (lessonId, user = 'user_1', extra = {}) => ({
  type: 'course_lesson_interaction.completed',
  data: { user: { id: user }, lesson: { id: lessonId }, completed: true, ...extra },
})
async function send(payload, opts) {
  const [res, log] = await quietly(() => POST(delivery(payload, opts)))
  return { status: res.status, body: await res.json(), log }
}

const LINK = 'https://discord.com/channels/1/2/3'
const EARLIER = '2026-10-12T08:00:00.000Z'
function freshDb(completions = []) {
  const db = new FakeDb({
    students: [{ id: 's1', whop_user_id: 'user_1', email: 'student@example.com' }],
    lessons: [
      { id: 'a1l01', whop_lesson_id: 'lesn_01' },
      { id: 'a1l02', whop_lesson_id: 'lesn_02' },
      { id: 'a3l25', whop_lesson_id: 'lesn_25', requires_action: true },
    ],
    student_lesson_completions: completions.map((c) => ({ student_id: 's1', ...c })),
  })
  useDb(db)
  steps.length = 0
  return db
}
const row = (db, lessonId) => db.rows('student_lesson_completions').find((r) => r.student_id === 's1' && r.lesson_id === lessonId)
const stepNames = () => steps.map((s) => s.step)
/** afterCompletionWrite's four steps, in its order. */
const AFTER_LESSON = ['streak', 'came-back', 'achievements', 'tasks']

console.log('\n=== A lesson with no row yet ===')
{
  const db = freshDb()
  const before = new Date().toISOString()
  const r = await send(finished('lesn_01', 'user_1', { completed_at: '2026-10-01T00:00:00.000Z' }))
  const got = row(db, 'a1l01')
  ok(r.status === 200 && got && got.completed_at !== null, 'the row is written', show({ status: r.status, row: got }))
  ok(got.completed_at >= before && got.completed_at !== '2026-10-01T00:00:00.000Z',
     'it carries the time it arrived, not a time from the payload (Decision 4, kept as today)', got.completed_at)
  ok(same(stepNames(), AFTER_LESSON) && steps.every((s) => s.studentId === 's1'),
     'the after-lesson steps run once, for that student (they never ran here)', show(steps))

  steps.length = 0
  const again = await send(finished('lesn_01'))
  ok(again.status === 200 && row(db, 'a1l01').completed_at === got.completed_at && steps.length === 0,
     'the same delivery again (a Whop retry): nothing changes and nothing runs again', show({ status: again.status, steps: stepNames() }))
}

console.log('\n=== A lesson whose row already exists ===')
{
  const db = freshDb([{ lesson_id: 'a1l02', completed_at: null, skipped_at: '2026-10-11T09:00:00.000Z' }])
  const r = await send(finished('lesn_02'))
  const got = row(db, 'a1l02')
  ok(r.status === 200 && got.completed_at !== null && got.skipped_at === null,
     'a skipped lesson finished on Whop becomes a watch, as the backfill does it (it was left as a skip)', show(got))
  ok(db.rows('student_lesson_completions').length === 1, 'still one row')
  ok(same(stepNames(), AFTER_LESSON), 'and the after-lesson steps run once', show(stepNames()))
}
{
  const db = freshDb([{ lesson_id: 'a3l25', completed_at: null, discord_message_link: LINK }])
  const r = await send(finished('lesn_25'))
  const got = row(db, 'a3l25')
  ok(r.status === 200 && got.completed_at !== null && got.discord_message_link === LINK && got.action_completed_at === null,
     'an action item with its link saved: the video half is finished, the link kept, the action half stays the student\'s', show(got))
  ok(same(stepNames(), AFTER_LESSON), 'the after-lesson steps run once', show(stepNames()))
}
{
  const db = freshDb([{ lesson_id: 'a3l25', completed_at: null, action_completed_at: EARLIER, discord_message_link: LINK }])
  await send(finished('lesn_25'))
  const got = row(db, 'a3l25')
  ok(got.completed_at !== null && got.action_completed_at === EARLIER,
     'an action done before its video: the video half is finished, the action\'s time kept', show(got))
  ok(same(stepNames(), AFTER_LESSON), 'the after-lesson steps run once (the lesson is now done)', show(stepNames()))
}
{
  const db = freshDb([{ lesson_id: 'a1l01', completed_at: EARLIER }])
  const r = await send(finished('lesn_01'))
  ok(r.status === 200 && row(db, 'a1l01').completed_at === EARLIER && steps.length === 0,
     'a lesson already watched: its time is kept and nothing runs', show({ row: row(db, 'a1l01'), steps: stepNames() }))
}

console.log('\n=== Failures make Whop send it again ===')
{
  const db = freshDb([{ lesson_id: 'a1l02', completed_at: null, skipped_at: EARLIER }])
  db.fail['student_lesson_completions.update'] = { message: 'deadlock detected' }
  const r = await send(finished('lesn_02'))
  ok(r.status === 500 && row(db, 'a1l02').skipped_at === EARLIER && steps.length === 0,
     'finishing an existing row fails: 500, so Whop retries, and nothing ran', show({ status: r.status, body: r.body, steps: stepNames() }))
  ok(r.log.some((l) => l.includes('deadlock detected')), 'and the reason is logged')
}
{
  const db = freshDb()
  db.fail['student_lesson_completions.upsert'] = { message: 'connection reset' }
  const r = await send(finished('lesn_01'))
  ok(r.status === 500 && !row(db, 'a1l01') && steps.length === 0, 'the insert fails: 500, as before', show({ status: r.status }))
}

console.log('\n=== Unchanged ===')
{
  const db = freshDb()
  const unknownStudent = await send(finished('lesn_01', 'user_nobody'))
  const unknownLesson = await send(finished('lesn_nothing'))
  ok(unknownStudent.status === 200 && unknownLesson.status === 200 && db.rows('student_lesson_completions').length === 0 && steps.length === 0,
     'a student or a lesson the app does not know: 200 and nothing written, as before')
  ok(unknownLesson.log.some((l) => l.includes('no lesson mapped to whop_lesson_id=lesn_nothing')), 'the "no lesson mapped" line the Whop proof looks for is still logged')
  const forged = await send(finished('lesn_01'), { sign: false })
  ok(forged.status === 401 && db.rows('student_lesson_completions').length === 0, 'a wrong signature: 401, nothing written')
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
