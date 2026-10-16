// skip-lesson (src/app/api/student/skip-lesson/route.ts) refuses the new
// course's plain watch lessons (backend_readiness.md section 5, item 26). It
// refused only action items, so one request marked any of the 132 plain watch
// lessons done (a skip counts as done in progress.ts), the last one included.
// Nothing on the map calls this route; the old dashboard does, and the old
// course is left exactly as it was.
// The route is the real source, copied by build.mjs with its imports pointed
// at stub-server.ts (a stand-in database, the catalog flag, the CSM step).
import { POST } from './_gen/skip-lesson-route.ts'
import { FakeDb, useDb, steps, setCatalog } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

const EARLIER = '2026-10-12T08:00:00.000Z'
function freshDb(completions = []) {
  const db = new FakeDb({
    students: [{ id: 's1', supabase_user_id: 'auth-1' }],
    lessons: [
      { id: 'a1l01', type: 'watch', requires_action: false },
      { id: 'a8l13', type: 'watch', requires_action: false },
      { id: 'a1l05', type: 'setup', requires_action: true },
      { id: 'l010', type: 'watch', requires_action: false },
      { id: 'l022', type: 'watch', requires_action: true },
    ],
    student_lesson_completions: completions.map((c) => ({ student_id: 's1', ...c })),
  }, { 'tok-1': 'auth-1' })
  useDb(db)
  steps.length = 0
  return db
}
async function skip(lessonId) {
  const res = await POST(new Request('http://app/api/student/skip-lesson', {
    method: 'POST',
    headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
    body: JSON.stringify({ lessonId }),
  }))
  return { status: res.status, body: await res.json() }
}
const rows = (db) => db.rows('student_lesson_completions')

console.log('\n=== New course: a watch lesson cannot be skipped ===')
setCatalog({ v2: true })
for (const id of ['a1l01', 'a8l13']) {
  const db = freshDb()
  const r = await skip(id)
  ok(r.status === 400 && typeof r.body.error === 'string' && rows(db).length === 0 && steps.length === 0,
     `${id}: refused, nothing written (it used to be marked done)`, show(r))
  ok(!/—|unlock/i.test(r.body.error ?? ''), 'the words are plain: no em dash, no "unlock"', show(r.body.error))
}
{
  const db = freshDb([{ lesson_id: 'a1l01', completed_at: EARLIER }])
  const r = await skip('a1l01')
  ok(r.status === 400 && rows(db)[0].completed_at === EARLIER, 'a watched one: refused too, and its row untouched', show(r))
}
{
  const db = freshDb()
  const r = await skip('a1l05')
  ok(r.status === 400 && /required action item/.test(r.body.error) && rows(db).length === 0, 'an action item: refused with the action item words, as before', show(r))
}

console.log('\n=== Old course: exactly as it was ===')
setCatalog({ v2: false })
{
  const db = freshDb()
  const r = await skip('l010')
  ok(r.status === 200 && r.body.action === 'skipped' && rows(db).length === 1 && rows(db)[0].skipped_at !== null && rows(db)[0].completed_at === null,
     'a plain lesson is skipped', show(r))
  ok(steps.length === 1 && steps[0].step === 'tasks', 'and the CSM tasks are looked at again, as before', show(steps))
  const again = await skip('l010')
  ok(again.status === 200 && again.body.action === 'unskipped' && rows(db).length === 0, 'skipping it again takes the skip back', show(again))
}
{
  const db = freshDb([{ lesson_id: 'l010', completed_at: EARLIER }])
  const r = await skip('l010')
  ok(r.status === 200 && r.body.action === 'noop' && rows(db)[0].completed_at === EARLIER, 'a watched one is left alone', show(r.body.action))
}
{
  const db = freshDb()
  const r = await skip('l022')
  ok(r.status === 400 && /required action item/.test(r.body.error) && rows(db).length === 0, 'an action item is refused', show(r))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
