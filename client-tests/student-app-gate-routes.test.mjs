// The closed doors before the new course (T-078), on the real student routes.
//
// Each route below is the real source, copied by build.mjs with its imports
// pointed at stub-server.ts (a stand-in database that logs every call in
// order) and at the real gate (_gen/student-app-gate.ts, a copy of
// src/lib/student-app-gate.ts). Each one runs four times, on a fresh database
// each time:
//   - values unset: the route answers as it always has, and the gate reads
//     nothing (the route's own tests, which pass beside this one, check what
//     that answer is in full);
//   - closed, nobody listed: 503 with Lovro's words, and not one database call,
//     so nothing is read or written and no step after a lesson runs;
//   - closed, this student listed: the same answer as an open app, after
//     exactly one read in front (the student's Whop id);
//   - closed, someone else listed: 503 after that one read, nothing written.
// What the gate decides is tested on its own in student-app-gate.test.mjs.
import { POST as skipLesson } from './_gen/skip-lesson-route.ts'
import { POST as markActionShipped } from './_gen/mark-action-shipped-route.ts'
import { POST as refreshWatchSync } from './_gen/refresh-watch-sync-route.ts'
import { POST as discountRequest } from './_gen/discount-request-route.ts'
import { POST as discountFeedback } from './_gen/discount-submit-feedback-route.ts'
import { POST as lessonWatched } from './_gen/lesson-watched-route.ts'
import { POST as lessonVideo } from './_gen/lesson-video-route.ts'
import { GET as studentData } from './_gen/student-data-route.ts'
import { COMING_SOON_MESSAGE } from './_gen/student-app-gate.ts'
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
import { FakeDb, useDb as installDb, steps, setCatalog } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
/** Times and generated ids differ from run to run; nothing else may. */
const norm = (v) => show(v)
  .replace(/\d{4}-\d{2}-\d{2}T[0-9:.]+Z/g, '<time>')
  .replace(/00000000-0000-4000-8000-\d{12}/g, '<id>')

const KEYS = ['STUDENT_APP_CLOSED', 'STUDENT_APP_OPEN_FOR']
function env(values) {
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, values)
}

const DAY = 86_400_000
const PAID = new Date(Date.now() - 2 * DAY).toISOString()
const WHOP_ID = 'user_TEST1'

function freshDb() {
  const db = new FakeDb({
    students: [{ id: 's1', supabase_user_id: 'auth-1', whop_user_id: WHOP_ID, first_paid_at: PAID, joined_at: PAID, membership_status: 'active' }],
    lessons: [
      { id: 'a1l01', region_id: 'a1', type: 'watch', sort_order: 1, duration_seconds: 300 },
      { id: 'a1l05', region_id: 'a1', type: 'setup', sort_order: 5, requires_action: true },
    ],
    regions: [{ id: 'a1', name: 'Area 1', order_num: 1 }],
  }, { 'tok-1': 'auth-1' })
  installDb(db)
  steps.length = 0
  return db
}

function req(method, path, body) {
  return new Request(`http://app/api/${path}`, {
    method,
    headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const ROUTES = [
  ['student/data (every student page)', () => studentData(req('GET', 'student/data'))],
  ['student/lesson-video (the map\'s video address)', () => lessonVideo(req('POST', 'student/lesson-video', { lessonId: 'a1l01' }))],
  ['student/lesson-watched (the map\'s "I finished watching")', () => lessonWatched(req('POST', 'student/lesson-watched', { lessonId: 'a1l01' }))],
  ['student/refresh-watch-sync (the Whop backfill on a visit)', () => refreshWatchSync(req('POST', 'student/refresh-watch-sync', {}))],
  ['student/mark-action-shipped', () => markActionShipped(req('POST', 'student/mark-action-shipped', { lessonId: 'a1l05', shipped: true }))],
  ['student/skip-lesson', () => skipLesson(req('POST', 'student/skip-lesson', { lessonId: 'a1l01' }))],
  ['discounts/request', () => discountRequest(req('POST', 'discounts/request', {}))],
  ['discounts/submit-feedback', () => discountFeedback(req('POST', 'discounts/submit-feedback', { answers: [] }))],
]

async function run(call, values) {
  env(values)
  const db = freshDb()
  const before = show(db.tables)
  const res = await call()
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return {
    status: res.status,
    body,
    calls: db.log.map((q) => `${q.table}:${q.op}`),
    first: db.log[0],
    unchanged: show(db.tables) === before,
    steps: steps.length,
  }
}

const REFUSAL = show({ error: COMING_SOON_MESSAGE, code: 'student_app_closed' })
const refused = (r) => r.status === 503 && show(r.body) === REFUSAL

setCatalog({ v2: true })
for (const [name, call] of ROUTES) {
  console.log(`\n=== ${name} ===`)
  const open = await run(call, {})
  ok(!refused(open) && open.calls.length > 0,
     'values unset: answered as always, the route went to the database itself', `${open.status}, ${open.calls.length} calls`)

  const shut = await run(call, { STUDENT_APP_CLOSED: 'true' })
  ok(refused(shut), 'closed, nobody listed: 503 with Lovro\'s words', `${shut.status} ${show(shut.body)}`)
  ok(shut.calls.length === 0 && shut.unchanged && shut.steps === 0,
     'and not one database call, nothing written, no step after a lesson', show(shut.calls))

  const listed = await run(call, { STUDENT_APP_CLOSED: 'true', STUDENT_APP_OPEN_FOR: `user_SOMEONE, ${WHOP_ID}` })
  ok(listed.status === open.status && norm(listed.body) === norm(open.body),
     'closed, this student listed: the same answer as an open app', `${listed.status} vs ${open.status}`)
  ok(listed.calls[0] === 'students:select' && show(listed.first.filters) === show(['supabase_user_id=auth-1'])
     && show(listed.calls.slice(1)) === show(open.calls),
     'after exactly one read in front: the student\'s own row, by the session\'s user', show(listed.calls.slice(0, 3)))

  const other = await run(call, { STUDENT_APP_CLOSED: 'true', STUDENT_APP_OPEN_FOR: 'user_SOMEONE' })
  ok(refused(other) && show(other.calls) === show(['students:select']) && other.unchanged && other.steps === 0,
     'closed, someone else listed: 503 after that one read, nothing written', show(other.calls))
}

console.log('\n=== Before the token check, the gate is never reached ===')
{
  env({ STUDENT_APP_CLOSED: 'true' })
  const db = freshDb()
  const res = await lessonWatched(new Request('http://app/api/student/lesson-watched', {
    method: 'POST',
    headers: { authorization: 'Bearer not-a-session', 'content-type': 'application/json' },
    body: JSON.stringify({ lessonId: 'a1l01' }),
  }))
  ok(res.status === 401 && db.log.length === 0, 'a bad token is still a 401, not the coming-soon answer', String(res.status))
}
env({})

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
