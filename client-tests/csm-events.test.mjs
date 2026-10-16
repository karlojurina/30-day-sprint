// The CSM's event hooks (src/lib/csm-events.ts) stop depending on the three
// templates migration v57 deleted (W2.2, W2.6, X.1; backend_readiness.md
// section 5, item 9):
//   - a missing template means the hook does nothing at all (no task, and no
//     task dismissed in its name) and says so once, not on every lesson;
//   - the alert type 'no_lessons_7d', which disengagement_alerts does not
//     allow (v10's CHECK), is no longer asked for;
//   - the discount task no longer tells the team to "Verify R1+R2".
// With a template present, the hooks do what they did. The module is the real
// source (build.mjs copies it untouched) on stub-server.ts's stand-in database.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { onLessonCompleted, onDiscountRequested, checkR2CompoundsShipped } from './_gen/csm-events.ts'
import { FakeDb, fakeClient } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** Runs `fn` with console.warn and console.error captured; returns the lines. */
async function captured(fn) {
  const real = [console.warn, console.error]
  const lines = []
  console.warn = console.error = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
  try { await fn() } finally { [console.warn, console.error] = real }
  return lines
}

const STUDENT = 's1'
const SHIPPED = '2026-10-10T10:00:00.000Z'
function freshDb({ templates = [], tasks = [], alerts = [] } = {}) {
  return new FakeDb({
    students: [{ id: STUDENT, name: 'Ana Horvat', membership_status: 'active' }],
    templates: templates.map((scenario_id) => ({ id: `tpl-${scenario_id}`, scenario_id })),
    tasks: tasks.map(([scenario_id, status = 'open', created_at = '2026-10-01T00:00:00.000Z']) => ({ student_id: STUDENT, scenario_id, status, created_at })),
    disengagement_alerts: alerts.map((alert_type) => ({ student_id: STUDENT, alert_type, is_dismissed: false })),
    student_lesson_completions: [
      { student_id: STUDENT, lesson_id: 'l022', completed_at: SHIPPED, action_completed_at: SHIPPED },
      { student_id: STUDENT, lesson_id: 'l024', completed_at: SHIPPED, action_completed_at: SHIPPED },
    ],
  })
}
const tasksOf = (db, scenario) => db.rows('tasks').filter((t) => t.scenario_id === scenario)
const tablesRead = (db) => [...new Set(db.log.map((q) => `${q.table}.${q.op}`))]

console.log('\n=== The templates v57 deleted are missing: the hooks do nothing ===')
{
  const db = freshDb({ tasks: [['W1.4']], alerts: ['no_login_5d'] })
  const lines = await captured(async () => {
    for (let i = 0; i < 3; i++) await onLessonCompleted(fakeClient(db), STUDENT)
  })
  ok(tasksOf(db, 'X.1').length === 0, '"came back": no X.1 task')
  ok(tasksOf(db, 'W1.4')[0].status === 'open' && tasksOf(db, 'W1.4')[0].notes === null,
     'and the open cancel-path task is left open (it was dismissed "X.1 fired" with no X.1 made)', show(tasksOf(db, 'W1.4')[0]))
  ok(show(tablesRead(db)) === show(['templates.select']), 'nothing is read but the template', show(tablesRead(db)))
  const said = lines.filter((l) => l.includes('X.1'))
  ok(said.length === 1, 'three lessons, one line in the log (it was one per lesson)', show(lines))
}
{
  const db = freshDb()
  const lines = await captured(async () => {
    await onDiscountRequested(fakeClient(db), STUDENT)
    await onDiscountRequested(fakeClient(db), STUDENT)
  })
  ok(tasksOf(db, 'W2.6').length === 0 && lines.filter((l) => l.includes('W2.6')).length === 1,
     'a discount request: no task, said once over two requests', show(lines))
  ok(show(tablesRead(db)) === show(['templates.select']), 'and nothing read but the template', show(tablesRead(db)))
}
{
  const db = freshDb()
  const lines = await captured(async () => {
    await checkR2CompoundsShipped(fakeClient(db), STUDENT, 'l022')
    await checkR2CompoundsShipped(fakeClient(db), STUDENT, 'l024')
  })
  ok(tasksOf(db, 'W2.2').length === 0 && lines.filter((l) => l.includes('W2.2')).length === 1,
     'both R2 action items shipped: no task, said once', show(lines))
}
{
  const db = freshDb({ tasks: [['W1.4']] })
  db.fail['templates.select'] = { message: 'connection reset' }
  const lines = await captured(() => onLessonCompleted(fakeClient(db), STUDENT))
  ok(tasksOf(db, 'X.1').length === 0 && tasksOf(db, 'W1.4')[0].status === 'open' && lines.some((l) => l.includes('connection reset')),
     'the template cannot be read: nothing is done either, and the failure is logged', show(lines))
}

console.log('\n=== The alert types it asks for are the table\'s own ===')
{
  const sql = read('../supabase/migrations/2026_v10_celebration_flags.sql')
  const allowed = [...(/alert_type in \(([^)]*)\)/.exec(sql)?.[1] ?? '').matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
  const db = freshDb({ templates: ['X.1'], alerts: ['no_login_5d'] })
  await captured(() => onLessonCompleted(fakeClient(db), STUDENT))
  const alertQuery = db.calls('disengagement_alerts', 'select')[0]
  const asked = [...(alertQuery?.filters.join(' ') ?? '').matchAll(/no_[a-z0-9_]+/g)].map((m) => m[0])
  ok(allowed.length === 5 && allowed.includes('no_login_5d') && !allowed.includes('no_lessons_7d'), 'v10 allows 5 types, no_lessons_7d not among them', show(allowed))
  ok(asked.length > 0 && asked.every((t) => allowed.includes(t)), 'every type the hook asks for is one the table allows', show(alertQuery?.filters))
  ok(!asked.includes('no_lessons_7d') && !read('../src/lib/csm-events.ts').includes('no_lessons_7d'), 'no_lessons_7d is gone from the query and the file')
  ok(tasksOf(db, 'X.1').length === 1 && tasksOf(db, 'X.1')[0].template_id === 'tpl-X.1', 'an open no_login_5d alert still makes the X.1 task', show(tasksOf(db, 'X.1')))
}

console.log('\n=== With a template there, the hooks do what they did ===')
{
  const db = freshDb({ templates: ['X.1'], tasks: [['W2.7']] })
  await captured(() => onLessonCompleted(fakeClient(db), STUDENT))
  const x1 = tasksOf(db, 'X.1')
  ok(x1.length === 1 && x1[0].behavior_summary.includes('W2.7'), 'a cancel-path task open: X.1 is made, naming it', show(x1[0]?.behavior_summary))
  ok(tasksOf(db, 'W2.7')[0].status === 'dismissed' && /X\.1 fired/.test(tasksOf(db, 'W2.7')[0].notes), 'and the cancel-path task is dismissed with its note')
  await captured(() => onLessonCompleted(fakeClient(db), STUDENT))
  ok(tasksOf(db, 'X.1').length === 1, 'a second lesson within 14 days makes no second X.1')
}
{
  const db = freshDb({ templates: ['X.1'] })
  await captured(() => onLessonCompleted(fakeClient(db), STUDENT))
  ok(db.rows('tasks').length === 0, 'nothing open, no alert: nothing made')
}
{
  const db = freshDb({ templates: ['W2.6'] })
  await captured(() => onDiscountRequested(fakeClient(db), STUDENT))
  const t = tasksOf(db, 'W2.6')[0]
  ok(t && t.template_id === 'tpl-W2.6' && t.behavior_summary.startsWith('Ana just applied for the 30% off.'), 'a discount request: the team task is made', show(t?.behavior_summary))
  ok(t && !/R1|R2/.test(t.behavior_summary) && /discount queue/.test(t.behavior_summary),
     'and it no longer says "Verify R1+R2" (the new course has no R1 or R2)', show(t?.behavior_summary))
}
{
  const db = freshDb({ templates: ['W2.2'] })
  await captured(() => checkR2CompoundsShipped(fakeClient(db), STUDENT, 'l024'))
  ok(tasksOf(db, 'W2.2').length === 1, 'both R2 action items shipped: the W2.2 task is made, as before')
  const db2 = freshDb({ templates: ['W2.2'] })
  await captured(() => checkR2CompoundsShipped(fakeClient(db2), STUDENT, 'a3l25'))
  ok(db2.log.length === 0, 'any other lesson: nothing is read at all, as before', show(db2.log.length))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
