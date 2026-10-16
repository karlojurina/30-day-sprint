// A student's second Apply, sent with the first (T-057). From v106 on the
// database lets one pending discount request per student in, so when two
// Apply clicks both pass a route's checks before either is written, it refuses
// the second insert with 23505. The two routes that write a request
// (POST /api/discounts/request and POST /api/discounts/submit-feedback) answer
// that the way they answer a request already in review: 400, "You already
// applied for the discount. We're reviewing it.", state "pending". Never the
// database's words, and the first request stands. Any other failure is
// answered as before.
//
// The routes are the real source, copied by build.mjs with their imports
// pointed at stub-server.ts (a stand-in database that has v106's index under
// its real name and message, the catalog flags, the CSM's hook recorded) and
// at the real discount-server.ts. The feedback form's database function
// (submit_discount_with_feedback, v29) is a stand-in written here from v29's
// body. What the database itself does with two inserts is proven in the
// migration harness, section 26.
import { POST as requestRoute } from './_gen/discount-request-route.ts'
import { POST as feedbackRoute } from './_gen/discount-submit-feedback-route.ts'
import { ALREADY_APPLIED, secondPendingRequest } from './_gen/discount-server.ts'
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
import { FakeDb, useDb as installDb, steps, setCatalog } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const DAY = 86_400_000
const NOW = Date.now()
const iso = (ms) => new Date(ms).toISOString()
// Paid 2 days ago: after the new course's launch and inside the 14 days, on any day this runs.
const PAID = iso(NOW - 2 * DAY)
const WATCHED = iso(NOW - DAY)
/** What Postgres says for a second pending request (the migration harness, section 26, reads the same name). */
const INDEX_SAYS = 'duplicate key value violates unique constraint "discount_requests_one_pending_per_student"'
const IN_REVIEW = { error: ALREADY_APPLIED, state: 'pending' }
/** Never shown to a student. */
const dbWords = (body) => /duplicate key|unique constraint|discount_requests_one_pending_per_student|23505/.test(show(body))

/** A student who is ready to apply on the new course: both videos up to the gate watched, inside the 14 days. */
function newCourseDb() {
  setCatalog({ v2: true, lessonsTable: 'lessons_next' })
  const db = new FakeDb({
    students: [{ id: 's1', supabase_user_id: 'auth-1', first_paid_at: PAID, joined_at: PAID }],
    lessons_next: [
      { id: 'a1l01', type: 'watch', sort_order: 1, duration_seconds: 300 },
      { id: 'a1l02', type: 'watch', sort_order: 2, duration_seconds: 300, is_gate: true },
      { id: 'a2l01', type: 'watch', sort_order: 3, duration_seconds: 300 },
    ],
    lesson_videos: [
      { lesson_id: 'a1l01', created_at: iso(NOW - 30 * DAY) },
      { lesson_id: 'a1l02', created_at: iso(NOW - 30 * DAY) },
    ],
    student_lesson_completions: [
      { student_id: 's1', lesson_id: 'a1l01', completed_at: WATCHED },
      { student_id: 's1', lesson_id: 'a1l02', completed_at: WATCHED },
    ],
    discount_requests: [],
  }, { 'tok-1': 'auth-1' })
  installDb(db)
  steps.length = 0
  return db
}

/** The same student on the old course: every R1 + R2 lesson done inside the 14 days. */
function oldCourseDb() {
  setCatalog({ v2: false })
  const db = new FakeDb({
    students: [{ id: 's1', supabase_user_id: 'auth-1', first_paid_at: PAID, joined_at: PAID }],
    lessons: [
      { id: 'l001', region_id: 'r1', type: 'watch' },
      { id: 'l022', region_id: 'r2', type: 'watch', requires_action: true },
    ],
    student_lesson_completions: [
      { student_id: 's1', lesson_id: 'l001', completed_at: WATCHED },
      { student_id: 's1', lesson_id: 'l022', completed_at: WATCHED, action_completed_at: WATCHED },
    ],
    discount_requests: [],
  }, { 'tok-1': 'auth-1' })
  installDb(db)
  steps.length = 0
  return db
}

/**
 * submit_discount_with_feedback (v29), standing in: its duplicate check, the
 * request, then the answers. After its check each call waits until `together`
 * calls have checked, as two sessions do: neither sees the other's row before
 * it commits, so both checks pass and v106's index decides between the
 * inserts.
 */
function feedbackFunction(db, together = 1) {
  let checked = 0
  let release
  const allChecked = new Promise((r) => { release = r })
  db.functions.submit_discount_with_feedback = async (args, client) => {
    const { data: existing } = await client.from('discount_requests').select('id')
      .eq('student_id', args.p_student_id).in('status', ['pending', 'approved', 'applied']).limit(1).maybeSingle()
    if (++checked >= together) release()
    await allChecked
    if (existing) return { data: null, error: { code: 'P0001', message: 'A discount request already exists for this student' } }
    const { data: row, error } = await client.from('discount_requests').insert({ student_id: args.p_student_id }).select('id').single()
    if (error) return { data: null, error }
    for (const a of args.p_answers) {
      await client.from('discount_feedback_responses').insert({ discount_request_id: row.id, question_id: a.question_id })
    }
    return { data: row.id, error: null }
  }
}

const ANSWERS = [{ question_id: 'q1', answer_scale: 9 }, { question_id: 'q2', answer_text: 'the hooks lesson' }]
async function call(route, path, body) {
  const res = await route(new Request(`http://app/api/discounts/${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  return { status: res.status, body: await res.json() }
}
const apply = () => call(requestRoute, 'request', { studentId: 's1' })
const submit = () => call(feedbackRoute, 'submit-feedback', { studentId: 's1', answers: ANSWERS })
const stepNames = () => steps.map((s) => s.step)
/** The two answers of a double submit, the one that went in first. */
const split = ([a, b]) => (a.status === 200 ? [a, b] : [b, a])

console.log('\n=== The words ===')
ok(same(secondPendingRequest({ code: '23505', message: INDEX_SAYS }), IN_REVIEW), 'v106\'s refusal reads as a request in review', show(secondPendingRequest({ code: '23505', message: INDEX_SAYS })))
ok(secondPendingRequest({ code: '23505', message: 'duplicate key value violates unique constraint "discount_requests_pkey"' }) === null
   && secondPendingRequest({ code: '42501', message: INDEX_SAYS }) === null
   && secondPendingRequest(null) === null && secondPendingRequest({}) === null,
   'anything else is not (another index, another code, no error)')

console.log('\n=== Apply, new course: two clicks at the same moment ===')
{
  const db = newCourseDb()
  const [won, lost] = split(await Promise.all([apply(), apply()]))
  ok(db.calls('discount_requests', 'insert').length === 2, 'both clicks passed the route\'s checks and reached the insert, as a real double submit does')
  ok(won.status === 200 && won.body.status === 'pending' && won.body.student_id === 's1', 'the first request is made', show(won))
  ok(lost.status === 400 && same(lost.body, IN_REVIEW), 'the second: 400, "You already applied for the discount. We\'re reviewing it.", state pending (it was 500 "Failed to create request")', show(lost))
  ok(!dbWords(lost.body), 'none of the database\'s words reach the student')
  ok(db.rows('discount_requests').length === 1 && same(stepNames(), ['discount-requested']), 'one request stands, and the team\'s hook ran for it alone', show(stepNames()))
  const later = await apply()
  ok(later.status === lost.status && same(later.body, lost.body), 'word for word what a later click is told once the request is pending', show(later))
  ok(db.calls('discount_requests', 'insert').length === 2, 'and that later click writes nothing')
}

console.log('\n=== Apply, old course: two clicks at the same moment ===')
{
  const db = oldCourseDb()
  const [won, lost] = split(await Promise.all([apply(), apply()]))
  ok(db.calls('discount_requests', 'insert').length === 2, 'both clicks passed the old duplicate check and reached the insert')
  ok(won.status === 200 && won.body.status === 'pending', 'the first request is made', show(won))
  ok(lost.status === 400 && same(lost.body, IN_REVIEW) && !dbWords(lost.body), 'the second: the same answer as on the new course (it was 500 "Failed to create request")', show(lost))
  ok(db.rows('discount_requests').length === 1 && same(stepNames(), ['discount-requested']), 'one request stands, one hook', show(stepNames()))
  const later = await apply()
  ok(later.status === 400 && later.body.error === 'You already have a discount request', 'a later click keeps the old route\'s own words, left as they were', show(later))
}

console.log('\n=== The questions form, new course: two submits at the same moment ===')
{
  const db = newCourseDb()
  feedbackFunction(db, 2)
  const [won, lost] = split(await Promise.all([submit(), submit()]))
  ok(db.calls('submit_discount_with_feedback', 'rpc').length === 2, 'both submits passed the route\'s check and called the database function')
  ok(won.status === 200 && typeof won.body.request_id === 'string', 'the first is made', show(won))
  ok(lost.status === 400 && same(lost.body, IN_REVIEW) && !dbWords(lost.body),
     'the second: the answer for a request in review (it showed the database\'s own "duplicate key value violates unique constraint ...")', show(lost))
  ok(db.rows('discount_requests').length === 1 && db.rows('discount_feedback_responses').length === ANSWERS.length,
     'one request, with the first submit\'s answers only', `${db.rows('discount_requests').length} request, ${db.rows('discount_feedback_responses').length} answers`)
  ok(same(stepNames(), ['discount-requested']), 'the team\'s hook ran once', show(stepNames()))
  const later = await submit()
  ok(later.status === 400 && same(later.body, lost.body) && db.calls('submit_discount_with_feedback', 'rpc').length === 2,
     'word for word what a later submit is told, and that one never reaches the function', show(later))
}

console.log('\n=== The questions form, old course: two submits at the same moment ===')
{
  const db = oldCourseDb()
  feedbackFunction(db, 2)
  const [won, lost] = split(await Promise.all([submit(), submit()]))
  ok(db.calls('submit_discount_with_feedback', 'rpc').length === 2, 'both submits called the database function')
  ok(won.status === 200 && typeof won.body.request_id === 'string', 'the first is made', show(won))
  ok(lost.status === 400 && same(lost.body, IN_REVIEW) && !dbWords(lost.body), 'the second: the answer for a request in review', show(lost))
  ok(db.rows('discount_requests').length === 1 && db.rows('discount_feedback_responses').length === ANSWERS.length, 'one request, one set of answers')
  const later = await submit()
  ok(later.status === 400 && later.body.error === 'A discount request already exists for this student',
     'a later submit is refused by the function\'s own check, in its own words, as before', show(later))
}

console.log('\n=== Any other failure is answered as before ===')
{
  const db = newCourseDb()
  db.fail['discount_requests.insert'] = { code: '42501', message: 'permission denied for table discount_requests' }
  const r = await apply()
  ok(r.status === 500 && same(r.body, { error: 'Failed to create request' }) && steps.length === 0, 'Apply, another failure: 500 "Failed to create request", no hook', show(r))
}
{
  const db = newCourseDb()
  db.fail['discount_requests.insert'] = { code: '23505', message: 'duplicate key value violates unique constraint "discount_requests_pkey"' }
  const r = await apply()
  ok(r.status === 500 && r.body.error === 'Failed to create request', 'Apply, a 23505 on another index: not taken for a second request', show(r))
}
{
  const db = newCourseDb()
  db.functions.submit_discount_with_feedback = async () => ({ data: null, error: { code: '23503', message: 'insert or update on table "discount_feedback_responses" violates foreign key constraint' } })
  const r = await submit()
  ok(r.status === 400 && r.body.error.includes('foreign key') && r.body.state === undefined && steps.length === 0,
     'the questions form, another failure: passed on as before, not read as a second request', show(r))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
