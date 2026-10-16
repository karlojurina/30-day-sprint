// mark-action-shipped (src/app/api/student/mark-action-shipped/route.ts) wants
// a saved Discord link before it completes an action item on the new course
// (backend_readiness.md section 5, item 15; morning review A3). The page has
// asked for the link first since the old dashboard; the route did not, so one
// request completed any of the 5 setup action items, and the action half of
// the 4 video ones, with no link. The old course is left as it was.
// The route is the real source, copied by build.mjs with its imports pointed
// at stub-server.ts (a stand-in database, the catalog flags, the steps after a
// lesson recorded) and at the real action-items.ts.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { POST } from './_gen/mark-action-shipped-route.ts'
import { PASTE_LINK_FIRST } from './_gen/action-items.ts'
import { FakeDb, useDb, steps, setCatalog } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const LINK = 'https://discord.com/channels/1100000000000000001/1200000000000000002/1300000000000000003'
const WATCHED = '2026-10-14T09:00:00.000Z'
// The words for "no link yet", one constant in action-items.ts (PASTE_LINK_FIRST)
// that the lesson page (ActionItemBlock.tsx) and the route both show.
const PASTE_FIRST = PASTE_LINK_FIRST

function freshDb(completions = []) {
  const db = new FakeDb({
    students: [{ id: 's1', supabase_user_id: 'auth-1' }],
    lessons: [
      // The new course: a setup action item, a video action item, a plain lesson.
      { id: 'a1l05', type: 'setup', requires_action: true },
      { id: 'a3l25', type: 'watch', requires_action: true },
      { id: 'a1l01', type: 'watch', requires_action: false },
      // The old course: an action item (every one there is a watch lesson).
      { id: 'l022', type: 'watch', requires_action: true },
    ],
    student_lesson_completions: completions.map((c) => ({ student_id: 's1', ...c })),
  }, { 'tok-1': 'auth-1' })
  useDb(db)
  steps.length = 0
  return db
}
async function ship(lessonId, shipped = true) {
  const res = await POST(new Request('http://app/api/student/mark-action-shipped', {
    method: 'POST',
    headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
    body: JSON.stringify({ lessonId, shipped }),
  }))
  return { status: res.status, body: await res.json() }
}
const row = (db, id) => db.rows('student_lesson_completions').find((r) => r.lesson_id === id) ?? null
const stepNames = () => steps.map((s) => s.step)

ok(typeof PASTE_FIRST === 'string' && PASTE_FIRST.length > 0, 'the words for "no link yet" are exported by action-items.ts', show(PASTE_FIRST))
{
  // Both places show the one constant, and neither keeps a copy of the sentence.
  const fromLib = /import \{[^}]*\bPASTE_LINK_FIRST\b[^}]*\} from "@\/lib\/world\/action-items";/
  const page = read('../src/components/world/ActionItemBlock.tsx')
  const route = read('../src/app/api/student/mark-action-shipped/route.ts')
  ok(fromLib.test(page) && page.includes('setError(PASTE_LINK_FIRST)') && !page.includes(PASTE_FIRST),
     'the lesson page imports it and shows it when Save is pressed with nothing in the field')
  ok(fromLib.test(route) && route.includes('{ error: PASTE_LINK_FIRST }') && !route.includes(PASTE_FIRST),
     'the route imports it, and answers with it')
}

console.log('\n=== New course: no link saved, nothing completed ===')
setCatalog({ v2: true })
{
  const db = freshDb()
  const r = await ship('a1l05')
  ok(r.status === 400 && r.body.error === PASTE_FIRST, 'a setup action item with no row: refused, in the page\'s own words (it used to complete the lesson)', show(r))
  ok(row(db, 'a1l05') === null && steps.length === 0, 'no row written, no streak, no badges, no CSM step', show({ row: row(db, 'a1l05'), steps: stepNames() }))
}
{
  const db = freshDb([{ lesson_id: 'a3l25', completed_at: WATCHED }])
  const r = await ship('a3l25')
  ok(r.status === 400 && r.body.error === PASTE_FIRST, 'a video action item, video watched, no link: refused (it used to complete it)', show(r))
  ok(row(db, 'a3l25').action_completed_at === null && steps.length === 0, 'the action half stays empty', show(row(db, 'a3l25')))
}
{
  const db = freshDb([{ lesson_id: 'a1l05', completed_at: null, discord_message_link: null }])
  const r = await ship('a1l05')
  ok(r.status === 400 && row(db, 'a1l05').completed_at === null, 'a row with its link cleared: refused too', show(r))
}
{
  // The row cannot be read: a failure, never "no link".
  const db = freshDb([{ lesson_id: 'a1l05', completed_at: null, discord_message_link: LINK }])
  db.fail['student_lesson_completions.select'] = { message: 'connection reset' }
  const r = await ship('a1l05')
  ok(r.status === 500 && r.body.error === 'connection reset' && row(db, 'a1l05').action_completed_at === null && steps.length === 0,
     'the row cannot be read: 500 with the reason, not "paste the link", and nothing written', show(r))
}

console.log('\n=== New course: with the link saved, as the page does it ===')
{
  const db = freshDb([{ lesson_id: 'a1l05', completed_at: null, discord_message_link: LINK }])
  const r = await ship('a1l05')
  const got = row(db, 'a1l05')
  ok(r.status === 200 && got.completed_at !== null && got.action_completed_at !== null && got.discord_message_link === LINK,
     'a setup action item: both halves set, the link kept', show(got))
  ok(same(stepNames(), ['streak', 'r2', 'came-back', 'achievements', 'tasks']), 'and the steps after it run, as before', show(stepNames()))
}
{
  const db = freshDb([{ lesson_id: 'a3l25', completed_at: null, discord_message_link: LINK }])
  const r = await ship('a3l25')
  const got = row(db, 'a3l25')
  ok(r.status === 200 && got.action_completed_at !== null && got.completed_at === null,
     'a video action item before its video: the action half only, as before', show(got))
}
{
  // Undoing needs no link: a student can always take a completion back.
  const db = freshDb([{ lesson_id: 'a1l05', completed_at: WATCHED, action_completed_at: WATCHED, discord_message_link: null }])
  const r = await ship('a1l05', false)
  const got = row(db, 'a1l05')
  ok(r.status === 200 && got.completed_at === null && got.action_completed_at === null, 'undoing with no link saved: allowed, both halves cleared', show(got))
}
{
  const db = freshDb()
  const r = await ship('a1l01')
  ok(r.status === 400 && r.body.error === 'Not a compound lesson' && row(db, 'a1l01') === null, 'a plain lesson: refused as before', show(r))
}

console.log('\n=== Old course: exactly as it was ===')
setCatalog({ v2: false })
{
  const db = freshDb()
  const r = await ship('l022')
  const got = row(db, 'l022')
  ok(r.status === 200 && got && got.action_completed_at !== null && got.completed_at === null,
     'an old-course action item with no link: the action half is recorded, as it always was', show(got))
  ok(same(stepNames(), ['r2', 'came-back', 'achievements', 'tasks']), 'with the same steps after it', show(stepNames()))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
