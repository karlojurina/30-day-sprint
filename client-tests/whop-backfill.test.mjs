// The Whop backfill (src/app/api/student/_lib/watch-sync.ts) tells the truth
// (backend_readiness.md, section 5, items 3, 4, 6 and 7):
//   - a failed read of the lessons is an error, never "nothing matched";
//   - "Whop returned 0" is a plain zero, never an error;
//   - only rows it actually added (or a skip it turned into a watch) count as
//     new, so the CSM's "came back" check, and the streak and "last active" on
//     a visit, move only when something new arrived.
// The backfill and the visit route that runs it (refresh-watch-sync) are the
// real source, copied by build.mjs with their imports pointed at
// stub-server.ts: a stand-in database, a scripted Whop answer, and the steps
// after a lesson recorded in order. The login (auth/whop/callback) is too big
// to run here, so its one line is checked in the source, and said to be.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { syncWatchProgress } from './_gen/watch-sync.ts'
import { POST as visit } from './_gen/refresh-watch-sync-route.ts'
import { FakeDb, useDb, setWhop, steps } from './_gen/stub-server.ts'
import { whopNoneFinishedNote, isWhopNoneFinishedNote } from './_gen/constants.ts'
// The real Whop read, run on a stand-in fetch in the section that says so.
import { fetchCompletedLessonsAsAdmin as whopRead } from './_gen/whop.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const show = (v) => JSON.stringify(v)
const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** Runs `fn` with console.error and console.warn captured; returns [result or thrown error, lines]. */
async function quietly(fn) {
  const real = [console.error, console.warn]
  const lines = []
  console.error = console.warn = (...a) => { lines.push(a.join(' ')) }
  try { return [await fn(), lines] } catch (e) { return [e, lines] } finally { [console.error, console.warn] = real }
}

const STUDENT = 's1'
const WHOP_USER = 'user_1'
/** Whop answers with these lessons finished (and `opened` more only opened). */
const whop = (finished, opened = 0) => setWhop(async () => ({
  interactions: finished.map((id) => ({ lesson: { id }, completed: true })),
  rawCount: finished.length + opened,
  completedCount: finished.length,
}))
function freshDb(extra = {}) {
  const db = new FakeDb({
    students: [{ id: STUDENT, whop_user_id: WHOP_USER, supabase_user_id: 'auth-1' }],
    lessons: [
      { id: 'a1l01', whop_lesson_id: 'lesn_01' },
      { id: 'a1l02', whop_lesson_id: 'lesn_02' },
      { id: 'a1l03', whop_lesson_id: 'lesn_03' },
      { id: 'a1l04', whop_lesson_id: 'lesn_04', requires_action: true },
    ],
    ...extra,
  }, { 'tok-1': 'auth-1' })
  useDb(db)
  steps.length = 0
  return db
}
const sync = () => syncWatchProgress({ studentId: STUDENT, whopUserId: WHOP_USER })
const syncRow = (db) => db.rows('student_whop_sync').find((r) => r.student_id === STUDENT)
const rowsOf = (db) => db.rows('student_lesson_completions').filter((r) => r.student_id === STUDENT)
const stepNames = () => steps.map((s) => s.step)

console.log('\n=== "Whop returned 0" is a plain zero ===')
{
  const db = freshDb({ student_whop_sync: [{ student_id: STUDENT, last_sync_error: 'an old failure', last_sync_error_at: '2026-10-01T00:00:00.000Z' }] })
  whop([])
  const r = await sync()
  const row = syncRow(db)
  ok(row.last_sync_error === null && row.last_sync_error_at === null, 'nothing on Whop: no error is written, and an old one is cleared', show({ error: row.last_sync_error }))
  ok(row.last_sync_fetched === 0 && row.last_sync_matched === 0 && same(row.last_sync_unmatched, []), 'fetched 0, matched 0, nothing unmatched')
  ok(row.last_sync_at !== null, 'the sync time is stamped')
  ok(r.syncedCount === 0 && r.fetchedCount === 0, 'the answer says 0 and 0', show(r))
  ok(stepNames().length === 0, 'and no "came back" check runs', show(stepNames()))
}
{
  // Kept as it was: lessons opened and none finished still leaves its note,
  // the one backend_readiness.md row i reads to tell this case from a wrong
  // course id (decisions.md, final pass).
  const db = freshDb()
  whop([], 2)
  await sync()
  const row = syncRow(db)
  ok(row.last_sync_error === 'Whop returned 2 interactions but 0 marked completed' && row.last_sync_fetched === 2,
     'lessons opened on Whop and none finished: the note is kept, word for word', show(row.last_sync_error))
  ok(row.last_sync_error === whopNoneFinishedNote(2) && isWhopNoneFinishedNote(row.last_sync_error),
     'written from constants.ts, whose isWhopNoneFinishedNote tells it from a failure')
}
{
  // The admin student page shows that note plainly and keeps red for failures
  // (second Loom round). The page is a client component, so its branch is
  // checked in the source; the rule it calls is run here.
  ok(!isWhopNoneFinishedNote('Lessons read failed: canceling statement due to statement timeout')
     && !isWhopNoneFinishedNote('Upsert failed: permission denied') && !isWhopNoneFinishedNote(null)
     && !isWhopNoneFinishedNote(`${whopNoneFinishedNote(2)}, and then the read failed`),
     'a real failure, or the note with more after it, is not the note')
  const page = read('../src/app/admin/(authenticated)/students/[id]/page.tsx')
  const asked = page.indexOf('isWhopNoneFinishedNote(whopSync.last_sync_error) ?')
  const note = page.indexOf('<strong>Note:</strong>', asked)
  const error = page.indexOf('<strong>Last error:</strong>', note)
  // The note's box is styled between the check and "Note:"; the error's box between "Note:" and "Last error:".
  ok(asked > 0 && note > asked && error > note
     && !page.slice(asked, note).includes('var(--color-danger)') && page.slice(note, error).includes('var(--color-danger)'),
     'the admin student page: the note under "Note:" in plain colours, every other value under "Last error:" in red, as before',
     `at ${asked}, ${note}, ${error}`)
}

console.log('\n=== Only rows actually added count as new ===')
{
  const db = freshDb()
  whop(['lesn_01', 'lesn_02', 'lesn_99'])
  const first = await sync()
  ok(first.syncedCount === 2 && first.matchedCount === 2 && same(first.unmatchedLessonIds, ['lesn_99']),
     'first sync: 2 lessons added, 2 matched, the unknown id listed', show(first))
  ok(same(rowsOf(db).map((r) => r.lesson_id).sort(), ['a1l01', 'a1l02']) && rowsOf(db).every((r) => r.completed_at !== null),
     'the 2 rows are written, each with its time')
  ok(same(stepNames(), ['came-back']), 'the "came back" check runs once', show(stepNames()))
  const stamps = rowsOf(db).map((r) => r.completed_at)

  steps.length = 0
  const second = await sync()
  ok(second.syncedCount === 0, 'the same answer again: 0 added (it used to say 2 on every run)', `syncedCount ${second.syncedCount}`)
  ok(second.matchedCount === 2 && syncRow(db).last_sync_matched === 2, 'still 2 matched, in the answer and on the sync row')
  ok(stepNames().length === 0, 'and the "came back" check does not run (it used to run on every sync)', show(stepNames()))
  ok(same(rowsOf(db).map((r) => r.completed_at), stamps), 'the rows keep their first times')

  steps.length = 0
  whop(['lesn_01', 'lesn_02', 'lesn_03', 'lesn_99'])
  const third = await sync()
  ok(third.syncedCount === 1 && same(stepNames(), ['came-back']), 'one more finished on Whop: 1 added, one check', show({ synced: third.syncedCount, steps: stepNames() }))
}
{
  // A lesson the student had skipped, now finished on Whop: the skip becomes a watch, once.
  const db = freshDb({ student_lesson_completions: [{ student_id: STUDENT, lesson_id: 'a1l02', completed_at: null, skipped_at: '2026-10-02T10:00:00.000Z' }] })
  whop(['lesn_02'])
  const r = await sync()
  const row = rowsOf(db)[0]
  ok(row.completed_at !== null && row.skipped_at === null, 'a skip finished on Whop becomes a watch', show(row))
  ok(r.syncedCount === 1 && same(stepNames(), ['came-back']), 'and that counts as new', show({ synced: r.syncedCount, steps: stepNames() }))
  steps.length = 0
  const again = await sync()
  ok(again.syncedCount === 0 && stepNames().length === 0, 'the next sync: nothing new', show({ synced: again.syncedCount, steps: stepNames() }))
}
{
  // An action item whose link was saved first: the video half comes from Whop, the link stays.
  const LINK = 'https://discord.com/channels/1/2/3'
  const db = freshDb({ student_lesson_completions: [{ student_id: STUDENT, lesson_id: 'a1l04', completed_at: null, discord_message_link: LINK }] })
  whop(['lesn_04'])
  const r = await sync()
  const row = rowsOf(db)[0]
  ok(row.completed_at !== null && row.discord_message_link === LINK && row.action_completed_at === null,
     'a saved link\'s row gets its video half, keeps the link, and the action half stays the student\'s', show(row))
  ok(r.syncedCount === 1, 'and that counts as new', `syncedCount ${r.syncedCount}`)
}

console.log('\n=== A failed read is an error, never "nothing matched" ===')
{
  const db = freshDb({ student_whop_sync: [{ student_id: STUDENT, last_sync_matched: 2, last_sync_fetched: 2, last_sync_error: null }] })
  whop(['lesn_01'])
  db.fail['lessons.select'] = { message: 'canceling statement due to statement timeout' }
  const [r, log] = await quietly(sync)
  ok(r instanceof Error && /lessons/i.test(r.message) && r.message.includes('statement timeout'),
     'the backfill throws, naming the read that failed (it used to answer "0 matched")', r instanceof Error ? r.message : show(r))
  const row = syncRow(db)
  ok(typeof row.last_sync_error === 'string' && row.last_sync_error.includes('statement timeout') && row.last_sync_error_at !== null,
     'the sync row holds the error and its time', show(row.last_sync_error))
  ok(row.last_sync_matched === 2, 'the last good counts are left as they were, never overwritten with 0', `matched ${row.last_sync_matched}`)
  ok(rowsOf(db).length === 0 && stepNames().length === 0, 'nothing written, no "came back" check')
  ok(log.some((l) => l.includes('[watch-sync] failed')), 'and it is logged', log[0])
}
{
  // The insert failing was already an error; it stays one.
  const db = freshDb()
  whop(['lesn_01'])
  db.fail['student_lesson_completions.upsert'] = { message: 'permission denied' }
  const [r] = await quietly(sync)
  ok(r instanceof Error && r.message.includes('permission denied') && syncRow(db).last_sync_error.includes('permission denied'),
     'a failed insert is an error, as before', r instanceof Error ? r.message : show(r))
}

console.log('\n=== The visit: the streak and "last active" move only when something new arrived ===')
{
  const req = () => new Request('http://app/api/student/refresh-watch-sync', { method: 'POST', headers: { authorization: 'Bearer tok-1' } })
  const db = freshDb()
  whop(['lesn_01', 'lesn_02'])
  let res = await visit(req())
  let body = await res.json()
  ok(res.status === 200 && body.syncedCount === 2, 'first visit: 2 added', show({ status: res.status, synced: body.syncedCount }))
  ok(same(stepNames(), ['came-back', 'streak', 'achievements']), 'the streak ticks (with "last active"), then the badges', show(stepNames()))

  steps.length = 0
  res = await visit(req())
  body = await res.json()
  ok(res.status === 200 && body.syncedCount === 0, 'next visit, nothing new: 0 added', `syncedCount ${body.syncedCount}`)
  ok(same(stepNames(), ['achievements']), 'no streak tick, no "last active", no "came back" (all three used to move on every visit)', show(stepNames()))

  steps.length = 0
  whop([])
  res = await visit(req())
  body = await res.json()
  ok(res.status === 200 && body.ok === true && body.fetchedCount === 0 && same(stepNames(), ['achievements']), 'Whop returns 0: an ordinary answer, no tick', show({ status: res.status, steps: stepNames() }))

  steps.length = 0
  whop(['lesn_01'])
  db.fail['lessons.select'] = { message: 'connection reset' }
  const [r] = await quietly(() => visit(req()))
  body = await r.json()
  ok(r.status === 500 && body.error.includes('connection reset') && stepNames().length === 0,
     'a failed lessons read answers 500 with the reason, and nothing moves (it used to answer "ok, 0 matched")', show({ status: r.status, body }))
}

console.log('\n=== Whop answering with other students\' lessons: nothing is written (2026-10-17) ===')
{
  // The real read (whop.ts, fetchCompletedLessonsAsAdmin) on a stand-in fetch
  // that answers course_lesson_interactions in pages, as Whop's v1 API does:
  // `data`, and `page_info` with `has_next_page` and `end_cursor`. The key and
  // the course id are made up. Whop has always honoured the user_id filter on
  // the old course; these are the answers it would give if it ignored it.
  process.env.WHOP_API_KEY = 'test-key-not-real'
  process.env.WHOP_COURSE_ID = 'cour_test'
  const realFetch = globalThis.fetch
  const asked = []
  /** Whop answers with these pages in order; `endless` says there are more after every one. */
  const pagesOnWhop = (pages, { endless = false } = {}) => {
    globalThis.fetch = async (url) => {
      asked.push(String(url))
      const after = new URL(String(url)).searchParams.get('after')
      const page = after ? Number(after.slice(1)) : 0
      const more = endless || page < pages.length - 1
      return new Response(JSON.stringify({
        data: pages[page] ?? [],
        page_info: { has_next_page: more, end_cursor: more ? `p${page + 1}` : null },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  }
  const row = (lessonId, userId, completed = true) => ({
    id: `int_${lessonId}_${userId}`, completed, created_at: '2026-10-15T10:00:00.000Z',
    lesson: { id: lessonId, title: lessonId }, user: { id: userId },
  })
  const IGNORED = `Whop user_id filter ignored for ${WHOP_USER}, refusing to write`
  const req = () => new Request('http://app/api/student/refresh-watch-sync', { method: 'POST', headers: { authorization: 'Bearer tok-1' } })
  try {
    pagesOnWhop([[row('lesn_01', WHOP_USER), row('lesn_02', WHOP_USER, false)]])
    const own = await whopRead(WHOP_USER)
    ok(own.rawCount === 2 && own.completedCount === 1 && own.interactions[0]?.lesson.id === 'lesn_01',
       'control: the student\'s own rows, one finished: 2 read, 1 kept', show({ raw: own.rawCount, kept: own.completedCount }))
    const q = new URL(asked.at(-1)).searchParams
    ok(q.get('user_id') === WHOP_USER && q.get('course_id') === 'cour_test', 'asked for this student, on the course named')

    pagesOnWhop([[{ ...row('lesn_01', WHOP_USER), user: undefined }]])
    ok((await whopRead(WHOP_USER)).completedCount === 1, 'a row with no user on it: kept, as before (nothing says whose it is)')

    pagesOnWhop([[row('lesn_01', WHOP_USER), row('lesn_02', 'user_2')]])
    const [other] = await quietly(() => whopRead(WHOP_USER))
    ok(other instanceof Error && other.message === IGNORED,
       'one row for another student: the read throws (it used to hand both rows on as this student\'s)', other instanceof Error ? other.message : show(other))

    pagesOnWhop([[row('lesn_01', WHOP_USER)], [row('lesn_02', WHOP_USER)], [row('lesn_03', WHOP_USER)], [row('lesn_04', WHOP_USER)], [row('lesn_05', WHOP_USER)]])
    ok((await whopRead(WHOP_USER)).rawCount === 5, 'five pages, the fifth the last: all 5 read, no refusal')
    pagesOnWhop([[row('lesn_01', WHOP_USER)]], { endless: true })
    const before = asked.length
    const [cap] = await quietly(() => whopRead(WHOP_USER))
    ok(cap instanceof Error && cap.message.includes('more than 5 pages') && cap.message.endsWith('refusing to write') && asked.length - before === 5,
       'Whop still says there is more after 5 pages: the read throws (it used to stop there quietly and keep what it had read)', cap instanceof Error ? cap.message : show(cap))

    // Through the visit, as a student's app runs it: the real read behind the backfill.
    const db = freshDb()
    setWhop((id) => whopRead(id))
    pagesOnWhop([[row('lesn_01', WHOP_USER), row('lesn_02', 'user_2'), row('lesn_03', 'user_3')]])
    const [res] = await quietly(() => visit(req()))
    const body = await res.json()
    ok(res.status === 500 && body.error === `Sync failed: ${IGNORED}`, 'the visit answers 500 with the reason', show({ status: res.status, body }))
    ok(rowsOf(db).length === 0 && stepNames().length === 0,
       'no lesson written for this student, no streak tick, no "last active", no "came back"', show({ rows: rowsOf(db).length, steps: stepNames() }))
    ok(syncRow(db).last_sync_error === IGNORED && syncRow(db).last_sync_error_at !== null,
       'the sentence is on the student\'s sync row, where the admin student page shows it as the last error', show(syncRow(db).last_sync_error))

    steps.length = 0
    pagesOnWhop([[row('lesn_01', WHOP_USER), row('lesn_02', WHOP_USER)]])
    const okRes = await visit(req())
    const okBody = await okRes.json()
    ok(okRes.status === 200 && okBody.syncedCount === 2 && same(stepNames(), ['came-back', 'streak', 'achievements']),
       'control: the same visit with only the student\'s own rows writes both and ticks the streak once', show({ status: okRes.status, synced: okBody.syncedCount, steps: stepNames() }))
  } finally {
    globalThis.fetch = realFetch
    whop([])
  }
}

console.log('\n=== The login: the same rule, checked in the source ===')
{
  // The callback route makes OAuth calls, a session and a redirect, so it is
  // not run here. Its streak call is the line to hold: it must sit under the
  // sync's count of rows added, as the visit's does.
  const src = read('../src/app/api/auth/whop/callback/route.ts')
  const block = src.slice(src.indexOf('syncWatchProgress({'), src.indexOf('const timeoutPromise'))
  const guarded = /if\s*\(\s*syncResult\.syncedCount\s*>\s*0\s*\)\s*\{?\s*await updateStudentStreak\(/.test(block)
  ok(block.length > 0 && guarded, 'the login ticks the streak only when its sync added something (it ticked on every login)',
     guarded ? 'if (syncResult.syncedCount > 0) await updateStudentStreak(...)' : 'unguarded')
  ok(/await evaluateAchievements\(supabase, upsertedStudent\.id\)/.test(block), 'and still judges the badges after every login sync')
  ok(/if \(result\.syncedCount > 0\) \{\s*await updateStudentStreak/.test(read('../src/app/api/student/refresh-watch-sync/route.ts')),
     'the visit route\'s guard is the one run above, unchanged')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
