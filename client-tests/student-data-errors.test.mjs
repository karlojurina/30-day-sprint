// GET /api/student/data when one of its reads fails (2026-10-20, the night bug
// hunt: progress-1, map-1).
//
// The route reads about 17 things at once and used to answer 200 whatever came
// back: a failed read of the student's completions arrived as "no progress"
// (every lantern out, all 61 videos left for the 30%), a failed streak read as
// a streak of 0, a failed lessons read as "There are no lessons here yet.".
// postgrest-js retries a GET only after a network error or a 503/520, so a
// pool timeout (PGRST003, 504) or a 500 comes back as an error with no data.
// Now the route answers 500 when a read of the catalog or of the student's own
// rows fails, and both callers in StudentContext keep what they already show
// on a non-OK answer (student-context.test.mjs runs that side).
//
// The route is the real source, copied by build.mjs into
// _gen/student-data-route.ts; the database is stub-server.ts's FakeDb, whose
// `fail['table.select']` makes every read of that table fail.
import { GET as appData } from './_gen/student-data-route.ts'
import { FakeDb, useDb as openDb } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? `: ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? `: ${detail}` : ''}`) }
}

/** Runs the route with the console kept; returns the status, the body and what it logged. */
async function load(db) {
  openDb(db)
  const real = console.error
  const logged = []
  console.error = (...a) => { logged.push(a.map(String).join(' ')) }
  try {
    const res = await appData(new Request('http://app/api/student/data', { headers: { authorization: 'Bearer tok-1' } }))
    return { status: res.status, body: await res.json(), logged }
  } finally {
    console.error = real
  }
}

function freshDb({ discount = false } = {}) {
  return new FakeDb({
    students: [{ id: 's1', whop_user_id: 'user_1', supabase_user_id: 'auth-1' }],
    regions: [{ id: 'a1', order_num: 1 }, { id: 'a2', order_num: 2 }],
    lessons: [
      { id: 'a1l01', region_id: 'a1', sort_order: 1 },
      { id: 'a1l02', region_id: 'a1', sort_order: 2 },
      { id: 'a2l01', region_id: 'a2', sort_order: 3 },
    ],
    student_lesson_completions: [{ student_id: 's1', lesson_id: 'a1l01', completed_at: '2026-10-19T18:00:00.000Z' }],
    student_streaks: [{ student_id: 's1', current_streak: 3, longest_streak: 5, last_streak_date: '2099-01-01' }],
    student_milestones: [{ student_id: 's1', playbook_unlocked_at: '2026-10-19T18:00:00.000Z' }],
    discount_requests: discount ? [{ student_id: 's1', status: 'pending', created_at: '2026-10-19T18:00:00.000Z' }] : [],
  }, { 'tok-1': 'auth-1' })
}
const failing = (message = 'canceling statement due to statement timeout', code = '57014') => ({ message, code })

console.log('\n=== A healthy read answers 200, as before ===')
{
  const r = await load(freshDb())
  ok(r.status === 200 && r.body.completions.length === 1 && r.body.streaks?.longest_streak === 5 && r.body.milestones?.playbook_unlocked_at,
     'the course, the completions, the streak and the milestones', `status ${r.status}`)
  ok(r.body.discountRequest === null && r.logged.length === 0,
     'a student who never applied for the 30% (no row: PGRST116 from .single()) is not a failure', `discountRequest ${JSON.stringify(r.body.discountRequest)}`)
  ok(r.body.lessonVideosFailed === false, 'and the answer says the read of which lessons have a video worked', `lessonVideosFailed ${r.body.lessonVideosFailed}`)
  const withRequest = await load(freshDb({ discount: true }))
  ok(withRequest.status === 200 && withRequest.body.discountRequest?.status === 'pending', 'and one who did gets the request')
}

console.log('\n=== A failed read of the student\'s own rows answers 500 (progress-1) ===')
for (const [table, what] of [
  ['student_lesson_completions', 'the completions (every lantern out, all videos left for the 30%)'],
  ['student_streaks', 'the streak (a streak of 0)'],
  ['student_milestones', 'the milestones (a graduate\'s Playbook link gone)'],
  ['discount_requests', 'the 30% request (an in-review request back to Apply)'],
]) {
  const db = freshDb({ discount: true })
  db.fail[`${table}.select`] = failing()
  const r = await load(db)
  ok(r.status === 500 && !('completions' in r.body), `${what}: no 200 with a believable empty value`, `status ${r.status}`)
  ok(r.logged.some((l) => l.includes(`${table}: canceling statement`)), '  and the server log names the read', r.logged.join(' | '))
}

console.log('\n=== A failed catalog read answers 500 (map-1) ===')
for (const table of ['regions', 'lessons']) {
  const db = freshDb()
  db.fail[`${table}.select`] = failing('upstream request timeout', 'PGRST003')
  const r = await load(db)
  ok(r.status === 500, `${table}: no 200 that reads as "There are no lessons here yet."`, `status ${r.status}`)
  ok(r.logged.some((l) => l.includes(`${table}: upstream request timeout`)), '  and the server log names it', r.logged.join(' | '))
}

console.log('\n=== A failed read of which lessons have a video is answered, and says so (map-1) ===')
{
  // Logged and answered, as the route chose before (a database without v100
  // has no lesson_videos), and now marked: every has_video in this answer is
  // false whatever the truth, so StudentContext's refresh keeps its own
  // (student-context.test.mjs runs that side).
  const db = freshDb()
  db.fail['lesson_videos.select'] = failing()
  const r = await load(db)
  ok(r.status === 200 && r.body.lessons.every((l) => l.has_video === false) && r.logged.some((l) => l.includes('lesson_videos read failed')),
     'a failed read of which lessons have a video is still logged and answered', `status ${r.status}`)
  ok(r.body.lessonVideosFailed === true, '  and the answer says the read failed', `lessonVideosFailed ${r.body.lessonVideosFailed}`)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
