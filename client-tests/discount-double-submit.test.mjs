// A student's second Apply, sent with the first (T-057). From v106 on the
// database lets one pending discount request per student in, so when two
// Apply clicks both pass a route's checks before either is written, it refuses
// the second insert with 23505. The two routes that write a request
// (POST /api/discounts/request and POST /api/discounts/submit-feedback) answer
// that the way they answer a request already in review: 400, "You already
// applied for the discount. You'll see it here once the 30% is on your Whop
// subscription." (ALREADY_APPLIED; "We're reviewing it." until the 30% applied
// itself), state "pending". Never the
// database's words, and the first request stands. Any other failure, on either
// route and either course, is answered with one plain sentence (SAVE_FAILED,
// 17 October), the status as before, and the real error goes to the server
// log. The closed doors (T-078) still answer before any of it.
//
// The routes are the real source, copied by build.mjs with their imports
// pointed at stub-server.ts (a stand-in database that has v106's index under
// its real name and message, the catalog flags, the CSM's hook recorded) and
// at the real discount-server.ts. The feedback form's database function
// (submit_discount_with_feedback) is a stand-in written here from v107's body:
// the service role only, then v29's duplicate check and inserts. The route
// calls it with its service-role client (17 October). What the database
// itself does with two inserts is proven in the migration harness, section
// 26, and the real v107 in section 27.
//
// The 30% that applies itself (T-137): on the new course the plain Apply
// writes through the same function too, with no answers (a JSON array, never
// the string "[]": the stand-in refuses anything but an array, as v107's
// jsonb_array_elements does), so the database refuses a student who already
// holds a pending, approved or applied request. A second Apply that reaches it
// after the first went through is answered with the request as it stands now,
// in the map's words. After the write the route puts the 30% on (putThirtyOn),
// which needs the course's product named (a made-up one here): with no Whop
// key the coupon check's stored answer is all there is, so the step holds the
// request for the job (coupon_stored) and it stays pending.
import { inspect } from 'node:util'
import { POST as requestRoute } from './_gen/discount-request-route.ts'
import { POST as feedbackRoute } from './_gen/discount-submit-feedback-route.ts'
import { ALREADY_APPLIED, SAVE_FAILED, discountRefusalMessage, secondPendingRequest } from './_gen/discount-server.ts'
import { COMING_SOON_MESSAGE } from './_gen/student-app-gate.ts'
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
import { FakeDb, createClient, useDb as installDb, steps, setCatalog } from './_gen/stub-server.ts'

// The keys the routes make their clients with (made up here), so the
// function's stand-in can tell the service role's client from a student's.
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.WHOP_PRODUCT_ID = 'prod_devCourse'
delete process.env.WHOP_API_KEY
/** A client made with the service role's key and no student token, as the database tells by the request's token. */
const asServiceRole = (madeWith) => madeWith?.[1] === process.env.SUPABASE_SERVICE_ROLE_KEY && !madeWith?.[2]?.global?.headers?.Authorization
/** What PostgREST answers a caller the function is not granted to (v107: everyone but the service role). */
const NOT_GRANTED = { code: '42501', message: 'permission denied for function submit_discount_with_feedback' }

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
/** What a student reads for any other failed write. */
const PLAIN = { error: SAVE_FAILED }
/** Postgres's and PostgREST's words for the other failures below, none of which may reach a student. */
const pgWords = (body) => /violates|constraint|foreign key|invalid input|syntax|uuid|integer|duplicate key|permission denied|already exists|not authorized|could not find|schema cache|fetch failed|discount_requests|discount_feedback|PGRST|P0001|23503|23505|22P02|42501/i.test(show(body))

/** Runs `fn`, keeping what it writes with console.error (the server log) off the test's output and in `log`. */
async function heard(fn) {
  const real = console.error
  const lines = []
  console.error = (...args) => { lines.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { breakLength: Infinity }))).join(' ')) }
  try { return { r: await fn(), log: lines.join('\n') } } finally { console.error = real }
}

/**
 * A student who is ready to apply on the new course: both videos up to the
 * gate watched, inside the 14 days. Their Whop membership was checked and
 * holds no discount (the stored row; no Whop key here): since the owner's
 * review of 2026-10-21 a coupon check that cannot run writes nothing, so the
 * routes reach the write only with an answer on file. The row holds its
 * source: since T-122's third fix round a stored "no coupon" answers only
 * when the rule of that round wrote it (v113's source set), and since its
 * fifth only with the rule's stamp (`source` with the rule's version,
 * `source_checked_at` its checked_at), the version r6 since the owner's paid
 * plan and payment (2026-10-26): the row holds a price, a real payer's.
 */
function newCourseDb() {
  setCatalog({ v2: true, lessonsTable: 'lessons_next' })
  const db = new FakeDb({
    students: [{ id: 's1', supabase_user_id: 'auth-1', first_paid_at: PAID, joined_at: PAID, whop_membership_id: 'mem_devClean' }],
    student_membership_discounts: [{
      student_id: 's1', whop_membership_id: 'mem_devClean', promo_code_id: null, promo_code: null,
      renewal_price: 97, plan_renewal_price: 97, discounted: false, checked_at: iso(NOW - DAY),
      source: 'r6-membership', source_checked_at: iso(NOW - DAY),
    }],
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
  // Both routes write through the function on the new course (the plain Apply since T-137).
  feedbackFunction(db)
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

/** What Postgres says when jsonb_array_elements is handed anything but an array (the string "[]" among them). */
const NOT_AN_ARRAY = { code: '22023', message: 'cannot extract elements from a scalar' }
/**
 * submit_discount_with_feedback as v107 leaves it, standing in: anyone but the
 * service role is refused before it runs, then v29's duplicate check, the
 * request, then the answers, walked as v107 walks them (jsonb_array_elements:
 * anything but an array is refused, and nothing is written). After its check
 * each call waits until `together` calls have checked, as two sessions do:
 * neither sees the other's row before it commits, so both checks pass and
 * v106's index decides between the inserts.
 */
function feedbackFunction(db, together = 1) {
  let checked = 0
  let release
  const allChecked = new Promise((r) => { release = r })
  db.functions.submit_discount_with_feedback = async (args, client, madeWith) => {
    if (!asServiceRole(madeWith)) return { data: null, error: NOT_GRANTED }
    if (!Array.isArray(args.p_answers)) return { data: null, error: NOT_AN_ARRAY }
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

console.log('\n=== The questions form calls the database function as the server (v107) ===')
{
  const db = newCourseDb()
  feedbackFunction(db)
  // A studentId in the body is ignored: the route takes the student from the token.
  const r = await call(feedbackRoute, 'submit-feedback', { studentId: 'someone-else', answers: ANSWERS })
  const calls = db.calls('submit_discount_with_feedback', 'rpc')
  const [, key, opts] = calls[0]?.options ?? []
  ok(r.status === 200 && typeof r.body.request_id === 'string' && calls.length === 1
       && key === process.env.SUPABASE_SERVICE_ROLE_KEY && opts?.global?.headers?.Authorization === undefined
       && calls[0].values.p_student_id === 's1' && calls[0].values.p_answers.length === ANSWERS.length,
     'one call, with the service-role client and the student id from the token, never the student\'s own session: the request is made',
     show({ status: r.status, key, auth: opts?.global?.headers?.Authorization ?? null, student: calls[0]?.values?.p_student_id }))
  const student = createClient('http://db.test', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: 'Bearer tok-1' } } })
  const straight = await student.rpc('submit_discount_with_feedback', { p_student_id: 's1', p_answers: [] })
  ok(same(straight.error, NOT_GRANTED) && db.rows('discount_requests').length === 1,
     'the same function called straight with a student\'s own token, as the route did before 17 October: refused, nothing written (the stand-in follows v107; the migration harness runs the real one)',
     show(straight.error))
}

console.log('\n=== The words ===')
ok(same(secondPendingRequest({ code: '23505', message: INDEX_SAYS }), IN_REVIEW), 'v106\'s refusal reads as a request in review', show(secondPendingRequest({ code: '23505', message: INDEX_SAYS })))
ok(secondPendingRequest({ code: '23505', message: 'duplicate key value violates unique constraint "discount_requests_pkey"' }) === null
   && secondPendingRequest({ code: '42501', message: INDEX_SAYS }) === null
   && secondPendingRequest(null) === null && secondPendingRequest({}) === null,
   'anything else is not (another index, another code, no error)')

console.log('\n=== Apply, new course: two clicks at the same moment ===')
{
  // Since T-137 the plain Apply writes through the database function, as the questions form does.
  const db = newCourseDb()
  feedbackFunction(db, 2)
  const [won, lost] = split(await Promise.all([apply(), apply()]))
  ok(db.calls('submit_discount_with_feedback', 'rpc').length === 2 && db.calls('discount_requests', 'insert').length === 2,
     'both clicks passed the route\'s checks and the function\'s, and reached the insert, as a real double submit does')
  ok(won.status === 200 && won.body.status === 'pending' && won.body.student_id === 's1', 'the first request is made', show(won))
  ok(lost.status === 400 && same(lost.body, IN_REVIEW), 'the second: 400, "You already applied for the discount. You\'ll see it here once the 30% is on your Whop subscription.", state pending (it was 500 "Failed to create request")', show(lost))
  ok(!dbWords(lost.body), 'none of the database\'s words reach the student')
  ok(db.rows('discount_requests').length === 1 && same(stepNames(), ['discount-requested']), 'one request stands, and the team\'s hook ran for it alone', show(stepNames()))
  const later = await apply()
  ok(later.status === lost.status && same(later.body, lost.body), 'word for word what a later click is told once the request is pending', show(later))
  ok(db.calls('discount_requests', 'insert').length === 2 && db.calls('submit_discount_with_feedback', 'rpc').length === 2, 'and that later click writes nothing, the function never called')
}

console.log('\n=== Apply, new course: the function is called with a JSON array, and refuses a request already held (T-137) ===')
{
  const db = newCourseDb()
  const r = await apply()
  const calls = db.calls('submit_discount_with_feedback', 'rpc')
  const [, key, opts] = calls[0]?.options ?? []
  ok(r.status === 200 && calls.length === 1 && Array.isArray(calls[0].values.p_answers) && calls[0].values.p_answers.length === 0
       && calls[0].values.p_student_id === 's1' && key === process.env.SUPABASE_SERVICE_ROLE_KEY && opts?.global?.headers?.Authorization === undefined,
     'the plain Apply calls the function once, as the server, with the student from the token and an empty JSON array of answers', show(calls[0]?.values))
  ok(r.body.id === db.rows('discount_requests')[0]?.id && r.body.status === 'pending'
       && ['promo_code', 'whop_promo_id', 'promo_claimed_at', 'audit_actor'].every((k) => !(k in r.body)),
     'it answers the row read again after the step, without the code, the claim\'s time or the audit columns', show(r.body))
  // The stand-in refuses anything but an array, as v107's jsonb_array_elements does: the string "[]" among them.
  const asString = await createClient('http://db.test', process.env.SUPABASE_SERVICE_ROLE_KEY).rpc('submit_discount_with_feedback', { p_student_id: 's1', p_answers: '[]' })
  ok(same(asString.error, NOT_AN_ARRAY) && db.rows('discount_requests').length === 1,
     'control: the same function handed the string "[]" refuses it, nothing written (so the route\'s 200 above proves it sent an array)', show(asString.error))
}
{
  // A second tab's Apply, whose reads came before the first request was written, reaches the function after the first
  // went through (applied in its own request, within seconds). v106 limits pending requests alone; the function refuses
  // any pending, approved or applied one, so nothing is written and the student reads the request as it stands now.
  const db = newCourseDb()
  const standIn = db.functions.submit_discount_with_feedback
  db.functions.submit_discount_with_feedback = async (args, client, madeWith) => {
    await client.from('discount_requests').insert({
      id: 'first', student_id: 's1', status: 'applied', created_at: iso(Date.now() - 60_000), promo_code: 'ECOM30-ABCDEF',
      whop_promo_id: 'promo_devFirst', reviewed_at: iso(Date.now() - 55_000), applied_at: iso(Date.now() - 50_000),
    })
    return standIn(args, client, madeWith)
  }
  const { r, log } = await heard(apply)
  ok(r.status === 400 && same(r.body, { error: discountRefusalMessage({ kind: 'applied' }), state: 'applied' })
       && db.rows('discount_requests').length === 1 && db.rows('discount_requests')[0].id === 'first' && db.calls('submit_discount_with_feedback', 'rpc').length === 1,
     'the function refuses (a request already held): 400, the applied request\'s own sentence, state applied, nothing written', show(r))
  ok(!pgWords(r.body) && !dbWords(r.body) && !log.includes('saving the request failed'), 'none of the database\'s words reach the student, and it is no failure in the log', show({ body: r.body, log }))
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
  const { r: later, log } = await heard(submit)
  ok(later.status === 400 && same(later.body, PLAIN) && log.includes('A discount request already exists for this student'),
     'a later submit is refused by the function\'s own check: the student reads the plain sentence (it showed the function\'s "A discount request already exists for this student"), and that sentence goes to the server log', show(later))
}

console.log('\n=== Any other failure: one plain sentence for the student, the real error in the server log ===')
// Each failure below is what Postgres or PostgREST hands back. Apply's
// statuses stay 500 and the questions form's 400, as they were; only the
// words change. Before 17 October Apply said "Failed to create request" and
// logged nothing, and the questions form passed the database's own sentence on.
const NO_CONNECTION = { code: '', message: 'TypeError: fetch failed', details: 'Error: connect ECONNREFUSED', hint: '' }
/** Apply's insert into discount_requests, refused. */
const INSERT_FAULTS = [
  { code: '42501', message: 'permission denied for table discount_requests' },
  { code: '23505', message: 'duplicate key value violates unique constraint "discount_requests_pkey"' },
  { code: '23503', message: 'insert or update on table "discount_requests" violates foreign key constraint "discount_requests_student_id_fkey"' },
  { code: '22P02', message: 'invalid input syntax for type uuid: "s1"' },
  NO_CONNECTION,
]
/** The questions form's database function, failing. The two P0001 sentences are v29's own (v107 keeps them); 42501 is v107 refusing a caller it is not granted to. */
const FUNCTION_FAULTS = [
  { code: '23503', message: 'insert or update on table "discount_feedback_responses" violates foreign key constraint "discount_feedback_responses_question_id_fkey"' },
  { code: '22P02', message: 'invalid input syntax for type uuid: "q1"' },
  { code: '22P02', message: 'invalid input syntax for type integer: "9.5"' },
  { code: 'P0001', message: 'Not authorized to submit feedback for this student' },
  { code: 'P0001', message: 'A discount request already exists for this student' },
  NOT_GRANTED,
  { code: '23505', message: 'duplicate key value violates unique constraint "discount_requests_pkey"' },
  { code: 'PGRST202', message: 'Could not find the function public.submit_discount_with_feedback(p_answers, p_student_id) in the schema cache' },
  NO_CONNECTION,
]
const codes = (faults) => faults.map((f) => f.code || 'no connection').join(', ')

for (const [course, fresh] of [['new course', newCourseDb], ['old course', oldCourseDb]]) {
  const wrong = []
  let sample = null
  for (const fault of INSERT_FAULTS) {
    const db = fresh()
    db.fail['discount_requests.insert'] = fault
    const { r, log } = await heard(apply)
    const name = fault.code || 'no connection'
    if (db.calls('discount_requests', 'insert').length !== 1) wrong.push(`${name}: never reached the insert`)
    if (r.status !== 500 || !same(r.body, PLAIN) || pgWords(r.body)) wrong.push(`${name}: answered ${show(r)}`)
    if (!log.includes('[discounts/request] student s1') || !log.includes(fault.message) || !log.includes(fault.code)) wrong.push(`${name}: logged ${show(log)}`)
    if (db.rows('discount_requests').length !== 0 || steps.length !== 0) wrong.push(`${name}: wrote a request or ran the team's hook`)
    if (fault.code === '23503') sample = { r, log }
  }
  ok(wrong.length === 0,
     `Apply, ${course}, ${INSERT_FAULTS.length} other failures (${codes(INSERT_FAULTS)}): 500 with the plain sentence, the real error in the server log, nothing written`,
     wrong.length ? wrong.join('; ') : `${show(sample.r)}  log: ${sample.log}`)
}

for (const [course, fresh] of [['new course', newCourseDb], ['old course', oldCourseDb]]) {
  const wrong = []
  let sample = null
  for (const fault of FUNCTION_FAULTS) {
    const db = fresh()
    db.functions.submit_discount_with_feedback = async () => ({ data: null, error: fault })
    const { r, log } = await heard(submit)
    const name = `${fault.code || 'no connection'} ${fault.message.slice(0, 24)}`
    if (db.calls('submit_discount_with_feedback', 'rpc').length !== 1) wrong.push(`${name}: never reached the function`)
    if (r.status !== 400 || !same(r.body, PLAIN) || pgWords(r.body)) wrong.push(`${name}: answered ${show(r)}`)
    if (!log.includes('[discounts/submit-feedback] student s1') || !log.includes(fault.message) || !log.includes(fault.code)) wrong.push(`${name}: logged ${show(log)}`)
    if (db.rows('discount_requests').length !== 0 || steps.length !== 0) wrong.push(`${name}: wrote a request or ran the team's hook`)
    if (fault.code === '23503') sample = { r, log }
  }
  ok(wrong.length === 0,
     `the questions form, ${course}, ${FUNCTION_FAULTS.length} other failures (${codes(FUNCTION_FAULTS)}): 400 with the plain sentence, the real error in the server log, nothing written`,
     wrong.length ? wrong.join('; ') : `${show(sample.r)}  log: ${sample.log}`)
}

console.log('\n=== The closed doors still answer first (T-078) ===')
{
  const before = process.env.STUDENT_APP_CLOSED
  process.env.STUDENT_APP_CLOSED = 'true'
  try {
    for (const [name, send, arm] of [
      ['Apply', apply, (db) => { db.fail['discount_requests.insert'] = INSERT_FAULTS[2] }],
      ['the questions form', submit, (db) => { db.functions.submit_discount_with_feedback = async () => ({ data: null, error: FUNCTION_FAULTS[0] }) }],
    ]) {
      const db = newCourseDb()
      arm(db)
      const { r, log } = await heard(send)
      ok(r.status === 503 && same(r.body, { error: COMING_SOON_MESSAGE, code: 'student_app_closed' }) && db.log.length === 0 && log === '',
         `${name}, the app closed with a failure waiting behind it: the coming-soon answer, not one database call, nothing logged`, `${r.status} ${show(r.body)}`)
    }
  } finally {
    if (before === undefined) delete process.env.STUDENT_APP_CLOSED
    else process.env.STUDENT_APP_CLOSED = before
  }
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
