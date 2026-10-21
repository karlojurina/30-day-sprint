// T-079: the streak counts only real work (Lovro, 2026-10-16: "Only when they
// either watch a video/complete a task, which can be the action item, are
// those the only two cases where they get a streak", and a lesson finished on
// Whop counts as watched). A day counts when, that day, the student:
//   a. finishes a lesson by watching it (lesson-watched: 95% reached, 80% played);
//   b. has a lesson finished on Whop newly arrive (the webhook, or the backfill
//      adding a row it did not have, on a visit or at login; the Whop
//      catch-up, T-089, only for a lesson Whop says was opened that day);
//   c. finishes a task (mark-action-shipped; the old course's task box).
// Nothing else: not a login, a visit, a backfill that adds nothing, a skip,
// partial watching, a quiz or undoing. On the new course a done task can't be
// undone, so undoing and completing again can't count a day. A failed read of
// the streak writes nothing, and the login's sync finishes past its redirect.
// And the streak shown is 0 once its last counted day is before yesterday
// (UTC, the streak's own day).
//
// Every route here is the real source, copied by build.mjs with its imports
// pointed at stub-server.ts, whose streak steps run the real update-streak.ts
// on the stand-in database: each check reads the student_streaks row and
// students.last_active_at the route left behind. "Last active" is a separate
// signal (Lovro decides it apart); the checks hold it where it always moved.
import fs from 'node:fs'
import path from 'node:path'
import { createHmac, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { POST as watched } from './_gen/lesson-watched-route.ts'
import { POST as visit } from './_gen/refresh-watch-sync-route.ts'
import { POST as webhook } from './_gen/whop-webhook-route.ts'
import { POST as ship } from './_gen/mark-action-shipped-route.ts'
import { POST as skip } from './_gen/skip-lesson-route.ts'
import { POST as toggle } from './_gen/toggle-lesson-route.ts'
import { POST as quiz } from './_gen/submit-quiz-route.ts'
import { GET as appData } from './_gen/student-data-route.ts'
import { GET as login } from './_gen/whop-callback-route.ts'
import { POST as catchup } from './_gen/whop-catchup-route.ts'
import { signState } from './_gen/pkce.ts'
import { currentStreakAsOf, getTodayUtc } from './_gen/streak.ts'
// useDb under another name: ESLint's React rules take a "use..." call for a hook.
import { FakeDb, useDb as openDb, setWhop, setCatalog, steps, NextRequest, afterTasks, setAfterMissing } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => fs.readFileSync(here(rel), 'utf8')

/** Runs `fn` with the console quiet; returns [result or thrown error, lines]. */
async function quietly(fn) {
  const real = [console.info, console.warn, console.error]
  const lines = []
  console.info = console.warn = console.error = (...a) => { lines.push(a.join(' ')) }
  try { return [await fn(), lines] } catch (e) { return [e, lines] } finally { [console.info, console.warn, console.error] = real }
}

// ── The day, and the student ────────────────────────────────────────────────
const TODAY = getTodayUtc()
const daysAgo = (n) => {
  const d = new Date(`${TODAY}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
const YESTERDAY = daysAgo(1)
const YESTERDAY_AT = `${YESTERDAY}T18:00:00.000Z`
/** "Last active" before anything here ran. */
const LONG_AGO = '2026-09-01T08:00:00.000Z'
const LINK = 'https://discord.com/channels/1/2/3'

/** A streak of 3 whose last counted day was yesterday, best 5. */
const RUNNING = { current_streak: 3, longest_streak: 5, last_streak_date: YESTERDAY }
const TICKED = { current: 4, longest: 5, last: TODAY }
const KEPT = { current: 3, longest: 5, last: YESTERDAY }

// The new course: two plain lessons, a setup action item, a video action item.
const NEW_COURSE = [
  { id: 'a1l01', type: 'watch', requires_action: false, whop_lesson_id: 'lesn_01', duration_seconds: 600 },
  { id: 'a1l02', type: 'watch', requires_action: false, whop_lesson_id: 'lesn_02', duration_seconds: 600 },
  { id: 'a1l05', type: 'setup', requires_action: true, whop_lesson_id: 'lesn_05' },
  { id: 'a3l25', type: 'watch', requires_action: true, whop_lesson_id: 'lesn_25', duration_seconds: 900 },
]
// The old course: an optional lesson, an action item (a watch lesson there),
// a setup task and the discount gate's task (the task box takes those two).
const OLD_COURSE = [
  { id: 'l010', type: 'watch', requires_action: false, whop_lesson_id: 'lesn_o10', duration_seconds: 600 },
  { id: 'l022', type: 'watch', requires_action: true, whop_lesson_id: 'lesn_o22', duration_seconds: 600 },
  { id: 'l003', type: 'setup', requires_action: false },
  { id: 'l049', type: 'action', requires_action: false },
]

function freshDb({ lessons = NEW_COURSE, completions = [], streak = RUNNING, watch = [], extra = {} } = {}) {
  const db = new FakeDb({
    students: [{ id: 's1', whop_user_id: 'user_1', supabase_user_id: 'auth-1', email: 'student@example.com', last_active_at: LONG_AGO }],
    lessons,
    student_lesson_completions: completions.map((c) => ({ student_id: 's1', ...c })),
    student_streaks: streak ? [{ student_id: 's1', ...streak }] : [],
    student_lesson_watch: watch.map((w) => ({ student_id: 's1', ...w })),
    ...extra,
  }, { 'tok-1': 'auth-1' })
  // The login's password sign-in (the stub's password is a function of the Whop id).
  db.authUsers['user_1@whop.ecomtalent.com'] = { id: 'auth-1', password: 'password-for-user_1' }
  openDb(db)
  steps.length = 0
  whopHas([])
  return db
}
const streakOf = (db) => {
  const r = db.rows('student_streaks').find((x) => x.student_id === 's1')
  return r ? { current: r.current_streak, longest: r.longest_streak, last: r.last_streak_date } : null
}
const lastActive = (db) => db.rows('students').find((x) => x.id === 's1').last_active_at
const moved = (db) => lastActive(db) !== LONG_AGO
const rowOf = (db, id) => db.rows('student_lesson_completions').find((r) => r.lesson_id === id) ?? null

/** Whop's answer from now on: these lessons finished. */
function whopHas(finished) {
  setWhop(async () => ({
    interactions: finished.map((id) => ({ lesson: { id }, completed: true })),
    rawCount: finished.length,
    completedCount: finished.length,
  }))
}

// ── Calling the routes the way the app and Whop call them ───────────────────
const post = (route, body) => new Request(`http://app/api/student/${route}`, {
  method: 'POST',
  headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
  body: JSON.stringify(body ?? {}),
})
async function call(handler, req) {
  const [res, log] = await quietly(() => handler(req))
  if (res instanceof Error) return { status: 'threw', body: res.message, log }
  const text = await res.text()
  let body = text
  try { body = JSON.parse(text) } catch { /* a redirect has no body */ }
  return { status: res.status, body, log, location: res.headers.get('location') }
}
const finishWatching = (lessonId) => call(watched, post('lesson-watched', { lessonId }))
const openApp = () => call(visit, post('refresh-watch-sync'))
const loadApp = () => call(appData, new Request('http://app/api/student/data', { headers: { authorization: 'Bearer tok-1' } }))
const pressComplete = (lessonId, shipped = true) => call(ship, post('mark-action-shipped', { lessonId, shipped }))
const skipLesson = (lessonId) => call(skip, post('skip-lesson', { lessonId }))
const tickTask = (lessonId) => call(toggle, post('toggle-lesson', { lessonId }))
const sendQuiz = (quizId, selections) => call(quiz, post('submit-quiz', { quizId, selections }))

// Whop signs its webhooks (Standard Webhooks); the secret is made up here.
const KEY = randomBytes(24)
process.env.WHOP_WEBHOOK_SECRET = `ws_${KEY.toString('base64')}`
let msg = 0
function whopSends(whopLessonId) {
  const body = JSON.stringify({
    type: 'course_lesson_interaction.completed',
    data: { user: { id: 'user_1' }, lesson: { id: whopLessonId }, completed: true },
  })
  const id = `msg_${++msg}`
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = createHmac('sha256', KEY).update(`${id}.${ts}.${body}`).digest('base64')
  return call(webhook, new Request('http://app/api/webhooks/whop', {
    method: 'POST',
    headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` },
    body,
  }))
}

// The login comes back from Whop with a code and the signed state.
process.env.NEXT_PUBLIC_APP_URL = 'http://app'
process.env.PKCE_COOKIE_SECRET = 'a made-up secret for this test'
function logIn() {
  const state = signState('a-made-up-verifier', process.env.PKCE_COOKIE_SECRET)
  return call(login, new NextRequest(`http://app/api/auth/whop/callback?code=made-up-code&state=${encodeURIComponent(state)}`))
}
const loggedIn = (r) => r.status === 307 && r.location === 'http://app/auth/complete'

// A watch row as the heartbeats leave it: `pos` and `played` seconds of a 600 s lesson.
const watchRow = (lessonId, pos, played) => ({
  lesson_id: lessonId, max_position_seconds: pos, watched_seconds: played,
  reported_duration_seconds: 600, threshold_met_at: null,
})

console.log(`\n(today is ${TODAY} UTC; the student's streak is 3, last counted ${YESTERDAY}, best 5)`)

console.log('\n=== a. Finishing a lesson by watching it ===')
setCatalog({ v2: true })
{
  const db = freshDb({ watch: [watchRow('a1l01', 590, 500)] })
  const r = await finishWatching('a1l01')
  ok(r.status === 200 && r.body.completed === true, 'the server agrees the lesson is watched', show(r.body))
  ok(same(streakOf(db), TICKED), 'the streak ticks: 3 becomes 4, today counted', show(streakOf(db)))
  ok(moved(db), '"last active" moves, as it always did when a lesson finished')

  steps.length = 0
  const again = await finishWatching('a1l01')
  ok(again.body.completed === true && same(streakOf(db), TICKED) && !steps.some((s) => s.step === 'streak'),
     'asked again the same day: still 4, and no second tick is even attempted', show({ streak: streakOf(db), steps: steps.map((s) => s.step) }))
}
{
  const db = freshDb({ watch: [watchRow('a1l01', 300, 250)] })
  const r = await finishWatching('a1l01')
  ok(r.status === 200 && r.body.completed === false && r.body.reason === 'position_short', 'half a lesson: not finished', show(r.body))
  ok(same(streakOf(db), KEPT) && !moved(db), 'partial watching ticks nothing (3, yesterday), and "last active" stays', show(streakOf(db)))
}
{
  const db = freshDb({ watch: [watchRow('a1l01', 590, 300)] })
  const r = await finishWatching('a1l01')
  ok(r.body.completed === false && r.body.reason === 'played_short' && same(streakOf(db), KEPT),
     'skipping ahead to the end (95% reached, half of it played): not finished, no tick', show(r.body))
}
{
  // Finished yesterday; the player asks again today (a retry, a reopened tab).
  const db = freshDb({ watch: [watchRow('a1l01', 590, 500)], completions: [{ lesson_id: 'a1l01', completed_at: YESTERDAY_AT }] })
  const r = await finishWatching('a1l01')
  ok(r.body.completed === true && same(streakOf(db), KEPT) && !moved(db),
     'a lesson finished yesterday, asked about again today: no tick today', show(streakOf(db)))
}
{
  const db = freshDb({ streak: null, watch: [watchRow('a1l01', 590, 500)] })
  await finishWatching('a1l01')
  ok(same(streakOf(db), { current: 1, longest: 1, last: TODAY }), 'a first streak starts at 1', show(streakOf(db)))
}
{
  const db = freshDb({ streak: { current_streak: 6, longest_streak: 6, last_streak_date: daysAgo(3) }, watch: [watchRow('a1l01', 590, 500)] })
  await finishWatching('a1l01')
  ok(same(streakOf(db), { current: 1, longest: 6, last: TODAY }), 'after a broken streak it starts again at 1, the best kept', show(streakOf(db)))
}

console.log('\n=== When the streak row can\'t be read or written ===')
{
  // A long streak, and the read of it fails (a timeout, a dropped connection,
  // which supabase-js hands back as an error, never a throw). It used to count
  // from zero and write 1 over the streak and the best.
  const db = freshDb({ streak: { current_streak: 40, longest_streak: 55, last_streak_date: YESTERDAY }, watch: [watchRow('a1l01', 590, 500)] })
  db.fail['student_streaks.select'] = { message: 'canceling statement due to statement timeout' }
  const r = await finishWatching('a1l01')
  ok(r.status === 200 && r.body.completed === true, 'the lesson is finished all the same', show(r.body))
  ok(same(streakOf(db), { current: 40, longest: 55, last: YESTERDAY }), 'the streak and the best stay 40 and 55: nothing is written', show(streakOf(db)))
  ok(r.log.some((l) => l.includes('[streak] read failed')), 'and the failed read is logged', show(r.log.filter((l) => l.includes('[streak]'))))
}
{
  const db = freshDb({ watch: [watchRow('a1l01', 590, 500)] })
  db.fail['student_streaks.upsert'] = { message: 'connection reset' }
  const r = await finishWatching('a1l01')
  ok(r.status === 200 && r.body.completed === true && same(streakOf(db), KEPT), 'a failed write: the lesson is finished, the streak row as it was', show(streakOf(db)))
  ok(r.log.some((l) => l.includes('[streak] write failed')), 'and the failed write is logged (it was dropped without a word)', show(r.log.filter((l) => l.includes('[streak]'))))
}

console.log('\n=== b. A lesson finished on Whop newly arriving ===')
{
  const db = freshDb()
  const r = await whopSends('lesn_01')
  ok(r.status === 200 && rowOf(db, 'a1l01')?.completed_at, 'the webhook writes the lesson', show(r.body))
  ok(same(streakOf(db), TICKED) && moved(db), 'the webhook: the streak ticks, "last active" moves', show(streakOf(db)))
}
{
  // Whop sends it again (a retry) on a later day: the row is there since yesterday.
  const db = freshDb({ completions: [{ lesson_id: 'a1l01', completed_at: YESTERDAY_AT }] })
  const r = await whopSends('lesn_01')
  ok(r.status === 200 && same(streakOf(db), KEPT) && !moved(db), 'the same lesson sent again: no tick', show(streakOf(db)))
}
{
  const db = freshDb()
  whopHas(['lesn_01', 'lesn_02'])
  const r = await openApp()
  ok(r.status === 200 && r.body.syncedCount === 2, 'opening the app, the backfill adds 2 lessons finished on Whop', show({ synced: r.body.syncedCount }))
  ok(same(streakOf(db), TICKED) && moved(db), 'the backfill that adds rows: the streak ticks once, "last active" moves', show(streakOf(db)))
}
{
  const db = freshDb({ completions: [{ lesson_id: 'a1l02', completed_at: null, skipped_at: '2026-10-02T10:00:00.000Z' }] })
  whopHas(['lesn_02'])
  const r = await openApp()
  ok(r.body.syncedCount === 1 && rowOf(db, 'a1l02').completed_at && same(streakOf(db), TICKED),
     'a lesson skipped in the app and finished on Whop: it becomes watched, and that ticks', show(streakOf(db)))
}
{
  // The Whop catch-up (T-089, POST /api/admin/whop-catchup, write): Lovro's
  // call A, a day only for a lesson it adds that Whop says was opened today
  // (UTC), and never "last active". It reads Whop through the real whop.ts,
  // answered here by a stand-in fetch; whop-catchup.test.mjs runs the rest.
  const env = ['WHOP_API_KEY', 'WHOP_COURSE_ID', 'CRON_SECRET'].map((k) => [k, process.env[k]])
  Object.assign(process.env, { WHOP_API_KEY: 'test-key-not-real', WHOP_COURSE_ID: 'cour_test', CRON_SECRET: 'a made-up cron secret' })
  const realFetch = globalThis.fetch
  const whopOpened = (createdAt) => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      data: [{ id: 'int_1', completed: true, created_at: createdAt, lesson: { id: 'lesn_01', title: 'a1l01' }, user: { id: 'user_1' } }],
      page_info: { has_next_page: false, end_cursor: null },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const catchUp = () => call(catchup, new Request('http://app/api/admin/whop-catchup', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'write' }),
  }))
  const switched = { admin_config: [{ key: 'curriculum_reset_at', value: '2026-10-19T16:34:00.000Z' }] }
  try {
    let db = freshDb({ extra: switched })
    whopOpened(new Date().toISOString())
    let r = await catchUp()
    ok(r.status === 200 && r.body.rows.inserted === 1 && same(streakOf(db), TICKED) && !moved(db),
       'the catch-up adds a lesson Whop says was opened today: the streak ticks, "last active" stays', show({ streak: streakOf(db), inserted: r.body.rows?.inserted }))
    db = freshDb({ extra: switched })
    whopOpened(YESTERDAY_AT)
    r = await catchUp()
    ok(r.status === 200 && rowOf(db, 'a1l01')?.completed_at === YESTERDAY_AT && same(streakOf(db), KEPT) && !moved(db),
       'a lesson opened on Whop yesterday: added with that time, no tick, "last active" stays', show({ streak: streakOf(db), at: rowOf(db, 'a1l01')?.completed_at }))
  } finally {
    globalThis.fetch = realFetch
    for (const [k, v] of env) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
}

console.log('\n=== c. Finishing a task ===')
{
  const db = freshDb({ completions: [{ lesson_id: 'a1l05', completed_at: null, discord_message_link: LINK }] })
  const r = await pressComplete('a1l05')
  ok(r.status === 200 && r.body.completion?.action_completed_at, 'a setup action item, its link saved: done', show(r.status))
  ok(same(streakOf(db), TICKED) && moved(db), 'the streak ticks, "last active" moves (both halves done, as before)', show(streakOf(db)))
}
{
  const db = freshDb({ completions: [{ lesson_id: 'a3l25', completed_at: null, discord_message_link: LINK }] })
  const r = await pressComplete('a3l25')
  ok(r.status === 200 && r.body.completion?.action_completed_at && !r.body.completion?.completed_at, 'a video action item, its action done before the video', show(r.body.completion))
  ok(same(streakOf(db), TICKED), 'the task alone is a streak day (before T-079 it waited for the video)', show(streakOf(db)))
  ok(!moved(db), '"last active" stays, as before: the video half is still open')
}
{
  const db = freshDb({ completions: [{ lesson_id: 'a3l25', completed_at: YESTERDAY_AT, discord_message_link: LINK }] })
  await pressComplete('a3l25')
  ok(same(streakOf(db), TICKED) && moved(db), 'a video action item whose video was watched yesterday: today\'s task ticks today', show(streakOf(db)))
}
{
  const db = freshDb({ completions: [{ lesson_id: 'a1l05', completed_at: YESTERDAY_AT, action_completed_at: YESTERDAY_AT, discord_message_link: LINK }] })
  const r = await pressComplete('a1l05')
  ok(r.status === 200 && same(streakOf(db), KEPT), 'pressing complete again on a task done yesterday: no tick', show(streakOf(db)))
  ok(moved(db), '"last active" moves, as it did before (both halves done)')
}
{
  // The new course: a done task stays done. The lesson page has no undo, and
  // an undo followed by a new press counted a streak day with no new work.
  const db = freshDb({ completions: [{ lesson_id: 'a1l05', completed_at: YESTERDAY_AT, action_completed_at: YESTERDAY_AT, discord_message_link: LINK }] })
  const undo = await pressComplete('a1l05', false)
  const row = rowOf(db, 'a1l05')
  ok(undo.status === 400 && undo.body.error === "A completed action item can't be undone."
     && row.completed_at === YESTERDAY_AT && row.action_completed_at === YESTERDAY_AT && row.discord_message_link === LINK,
     'undoing a task is refused: both halves and the link stay', show(undo.body))
  ok(same(streakOf(db), KEPT) && !moved(db), 'nothing ticks, and "last active" stays', show(streakOf(db)))
  const again = await pressComplete('a1l05')
  ok(again.status === 200 && same(streakOf(db), KEPT), 'completing it again after that counts nothing: the task was done yesterday', show(streakOf(db)))
}
{
  const db = freshDb()
  const r = await pressComplete('a1l05')
  ok(r.status === 400 && same(streakOf(db), KEPT) && !moved(db), 'a press with no link saved is refused: nothing moves', show(r.body))
}
setCatalog({ v2: false })
{
  const db = freshDb({ lessons: OLD_COURSE })
  const r = await pressComplete('l022')
  ok(r.status === 200 && same(streakOf(db), TICKED), 'the old course: an action item\'s task ticks too', show(streakOf(db)))
}
{
  // The old dashboard keeps its undo button (no student reaches it after the switch).
  const db = freshDb({ lessons: OLD_COURSE, completions: [{ lesson_id: 'l022', completed_at: YESTERDAY_AT, action_completed_at: YESTERDAY_AT, discord_message_link: LINK }] })
  const r = await pressComplete('l022', false)
  ok(r.status === 200 && rowOf(db, 'l022').action_completed_at === null && same(streakOf(db), KEPT) && !moved(db),
     'the old course: undoing a task still works, ticks nothing, and "last active" stays, as before', show(streakOf(db)))
}
{
  const db = freshDb({ lessons: OLD_COURSE })
  const r = await tickTask('l003')
  ok(r.body.action === 'checked' && same(streakOf(db), TICKED) && moved(db), 'the old course\'s task box: ticking a task off ticks the streak', show(streakOf(db)))
  const undo = await tickTask('l003')
  ok(undo.body.action === 'unchecked' && same(streakOf(db), TICKED), 'unticking it takes nothing back and adds nothing', show(streakOf(db)))
}
{
  const db = freshDb({ lessons: OLD_COURSE, completions: [{ lesson_id: 'l049', completed_at: YESTERDAY_AT }] })
  const r = await tickTask('l049')
  ok(r.body.action === 'unchecked' && same(streakOf(db), KEPT), 'unticking a task done yesterday: no tick (it used to tick)', show(streakOf(db)))
  ok(moved(db), '"last active" moves, as it did before')
}
{
  // A task box row on a lesson with an action half is half of it, which
  // finishes nothing. The old course has no such task; the new course's are
  // refused (next).
  const db = freshDb()
  const r = await tickTask('a1l05')
  ok(r.body.action === 'checked' && same(streakOf(db), KEPT), 'the old catalog, the task box on a lesson with an action half: half a lesson, no tick', show(streakOf(db)))
  ok(moved(db), '"last active" moves, as it did before')
}
setCatalog({ v2: true })
{
  // The new course's action items are finished with their own button, and
  // the new app never calls the task box. It refuses them: its tick wrote
  // half of one, and its untick deleted the row with its saved link, so
  // completing it again counted a day.
  const db = freshDb()
  const r = await tickTask('a1l05')
  ok(r.status === 400 && rowOf(db, 'a1l05') === null && same(streakOf(db), KEPT) && !moved(db),
     'the new course, the task box on an action item: refused, nothing written', show(r.body))
}
{
  const db = freshDb({ completions: [{ lesson_id: 'a1l05', completed_at: YESTERDAY_AT, action_completed_at: YESTERDAY_AT, discord_message_link: LINK }] })
  const r = await tickTask('a1l05')
  ok(r.status === 400 && rowOf(db, 'a1l05')?.discord_message_link === LINK && rowOf(db, 'a1l05')?.action_completed_at === YESTERDAY_AT
     && same(streakOf(db), KEPT) && !moved(db),
     'and its untick on a done action item: refused, the row and its link stay', show(r.body))
}

console.log('\n=== Nothing else ticks it ===')
setCatalog({ v2: true })
{
  const db = freshDb()
  const r = await logIn()
  ok(loggedIn(r), 'the real login runs to the end and signs the student in', show({ status: r.status, location: r.location }))
  ok(same(streakOf(db), KEPT), 'logging in, with nothing new on Whop: no tick (3, yesterday)', show(streakOf(db)))
  ok(moved(db), '"last active" moves on every login, as it always did')
}
{
  const db = freshDb({ completions: [{ lesson_id: 'a1l01', completed_at: YESTERDAY_AT }] })
  whopHas(['lesn_01'])
  const r = await logIn()
  ok(loggedIn(r) && same(streakOf(db), KEPT), 'logging in, Whop\'s lessons already in the app: no tick', show(streakOf(db)))
}
{
  const db = freshDb()
  whopHas(['lesn_02'])
  const r = await logIn()
  ok(loggedIn(r) && rowOf(db, 'a1l02') && same(streakOf(db), TICKED),
     'logging in when Whop has a lesson the app did not: that lesson ticks it (b), the login does not', show(streakOf(db)))
}
{
  // Whop answers after the login's 2.5 s timer. The student is signed in
  // first, and after() keeps the rest running (on Vercel through waitUntil),
  // so the lesson's row and its streak day land together: a row written
  // without its day would never get one, the next sync finds it there.
  const db = freshDb()
  let answer
  const late = new Promise((resolve) => { answer = resolve })
  setWhop(async () => { await late; return { interactions: [{ lesson: { id: 'lesn_02' }, completed: true }], rawCount: 1, completedCount: 1 } })
  afterTasks.length = 0
  // The route's 2.5 s timer goes off at once here.
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 2500 ? 0 : ms, ...rest)
  let r
  try { r = await logIn() } finally { globalThis.setTimeout = realSetTimeout }
  ok(loggedIn(r) && rowOf(db, 'a1l02') === null && same(streakOf(db), KEPT), 'the sync runs past the timer: the student is signed in before Whop answers', show({ status: r.status, streak: streakOf(db) }))
  ok(afterTasks.length === 1, 'and the rest of the sync is handed to after()', show({ handed: afterTasks.length }))
  await quietly(async () => { answer(); await Promise.all(afterTasks) })
  ok(rowOf(db, 'a1l02')?.completed_at && same(streakOf(db), TICKED), 'when that work is done, the lesson is in and its streak day counted', show(streakOf(db)))
}
{
  // Next's after() throws where the platform has no waitUntil. A login must
  // never fail on that.
  const db = freshDb()
  whopHas(['lesn_02'])
  setAfterMissing(true)
  let r
  try { r = await logIn() } finally { setAfterMissing(false) }
  ok(loggedIn(r) && same(streakOf(db), TICKED), 'with after() unavailable the student is signed in all the same', show({ status: r.status, location: r.location }))
  ok(r.log.some((l) => l.includes('after() unavailable')), 'and that is logged', show(r.log.filter((l) => l.includes('after()'))))
}
{
  const db = freshDb({ completions: [{ lesson_id: 'a1l01', completed_at: YESTERDAY_AT }, { lesson_id: 'a1l02', completed_at: YESTERDAY_AT }] })
  whopHas(['lesn_01', 'lesn_02'])
  const r = await openApp()
  ok(r.status === 200 && r.body.syncedCount === 0, 'opening the app, Whop\'s lessons already in: the backfill adds nothing', show({ synced: r.body.syncedCount, matched: r.body.matchedCount }))
  ok(same(streakOf(db), KEPT) && !moved(db), 'no tick, and "last active" stays (both used to move on every visit)', show(streakOf(db)))
}
{
  const db = freshDb()
  const r = await openApp()
  ok(r.status === 200 && same(streakOf(db), KEPT) && !moved(db), 'opening the app with nothing on Whop: no tick', show(streakOf(db)))
}
{
  const db = freshDb()
  const r = await loadApp()
  ok(r.status === 200 && same(streakOf(db), KEPT) && !moved(db), 'loading the app\'s data: no tick, nothing written', show(streakOf(db)))
}
{
  const db = freshDb()
  const r = await skipLesson('a1l01')
  ok(r.status === 400 && same(streakOf(db), KEPT), 'the new course: a skip is refused, no tick', show(r.body))
}
setCatalog({ v2: false })
{
  const db = freshDb({ lessons: OLD_COURSE })
  const r = await skipLesson('l010')
  ok(r.body.action === 'skipped' && same(streakOf(db), KEPT) && !moved(db), 'the old course: a skip is written, and ticks nothing', show(streakOf(db)))
}
{
  const db = freshDb({
    lessons: OLD_COURSE,
    extra: {
      quizzes: [{ id: 'quiz_r1', passing_percent: 50 }],
      quiz_questions: [{ id: 'q1', quiz_id: 'quiz_r1', correct_index: 0, sort_order: 1 }],
    },
  })
  const r = await sendQuiz('quiz_r1', { q1: 0 })
  ok(r.status === 200 && r.body.passed === true, 'the old course: a quiz is passed', show({ status: r.status, passed: r.body.passed }))
  ok(same(streakOf(db), KEPT), 'a quiz ticks nothing (it used to tick)', show(streakOf(db)))
  ok(moved(db), '"last active" moves, as it did before')
}

console.log('\n=== Who can write the streak ===')
{
  // The one writer is update-streak.ts. Any other `.from("student_streaks")`
  // in the app only reads.
  const root = here('../')
  const writers = new Set()
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const s = fs.readFileSync(p, 'utf8')
        for (let i = s.indexOf('.from("student_streaks")'); i !== -1; i = s.indexOf('.from("student_streaks")', i + 1)) {
          const chain = s.slice(i, s.indexOf(';', i))
          if (/\.(insert|upsert|update|delete)\(/.test(chain)) writers.add(path.relative(root, p))
        }
      }
    }
  }
  walk(path.join(root, 'src'))
  ok(same([...writers], ['src/app/api/student/_lib/update-streak.ts']), 'in the app, only update-streak.ts writes the streak', show([...writers]))
  // In the database: only v46 (the table and its one-off copy from students)
  // names the table outside a comment, so no function (the heartbeat's
  // included) writes it.
  const dir = path.join(root, 'supabase/migrations')
  const naming = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).filter((f) =>
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').some((l) => l.includes('student_streaks') && !l.trim().startsWith('--')))
  ok(same(naming, ['2026_v46_split_student_state.sql']), 'in the database, only v46 names it in code', show(naming))
  const callers = ['src/app/api/student/_lib/update-streak.ts', 'src/lib/complete-lesson.ts', 'src/app/api/student/refresh-watch-sync/route.ts',
    'src/app/api/auth/whop/callback/route.ts', 'src/app/api/student/mark-action-shipped/route.ts', 'src/app/api/student/toggle-lesson/route.ts',
    'src/lib/whop-catchup.ts']
  const tickers = new Set()
  // Code only: comments that name the function (StudentContext's do) are dropped.
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const walk2 = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk2(p)
      else if (/\.(ts|tsx)$/.test(e.name) && /\b(updateStudentStreak|tickStudentStreak)\(/.test(code(fs.readFileSync(p, 'utf8')))) tickers.add(path.relative(root, p))
    }
  }
  walk2(path.join(root, 'src'))
  ok(same([...tickers].sort(), [...callers].sort()), 'every route that can tick it is one run above (plus the writer itself)', show([...tickers].sort()))
}

console.log('\n=== The streak shown: 0 once it broke ===')
{
  const s = (current, last) => ({ current_streak: current, last_streak_date: last })
  ok(currentStreakAsOf(s(4, TODAY), TODAY) === 4, 'counted today: 4')
  ok(currentStreakAsOf(s(4, YESTERDAY), TODAY) === 4, 'counted yesterday: still 4 (today is not over)')
  ok(currentStreakAsOf(s(4, daysAgo(2)), TODAY) === 0, 'last counted the day before yesterday: 0')
  ok(currentStreakAsOf(s(9, '2026-09-30'), TODAY) === 0, 'last counted weeks ago: 0')
  ok(currentStreakAsOf(null, TODAY) === 0 && currentStreakAsOf(undefined, TODAY) === 0 && currentStreakAsOf(s(3, null), TODAY) === 0,
     'no row, or no counted day: 0')
  ok(currentStreakAsOf(s(0, TODAY), TODAY) === 0, 'a stored 0 stays 0')
  const tomorrow = (() => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()
  ok(currentStreakAsOf(s(4, tomorrow), TODAY) === 4, 'a day after today (a browser clock behind the server\'s): still running')
  ok(currentStreakAsOf(s(4, '2026-03-01'), '2026-03-02') === 4 && currentStreakAsOf(s(4, '2026-02-28'), '2026-03-02') === 0
     && currentStreakAsOf(s(4, '2025-12-31'), '2026-01-01') === 4,
     'across a month and a year: yesterday is the calendar\'s yesterday')
}
for (const [label, streak, shown] of [
  ['last counted the day before yesterday', { current_streak: 6, longest_streak: 8, last_streak_date: daysAgo(2) }, 0],
  ['last counted yesterday', { current_streak: 6, longest_streak: 8, last_streak_date: YESTERDAY }, 6],
  ['counted today', { current_streak: 6, longest_streak: 8, last_streak_date: TODAY }, 6],
]) {
  const db = freshDb({ streak })
  const r = await loadApp()
  ok(r.status === 200 && r.body.streaks?.current_streak === shown && r.body.streaks?.longest_streak === 8,
     `the app's data, ${label}: the streak it hands the corner is ${shown}, the best still 8`, show(r.body.streaks))
  ok(db.rows('student_streaks')[0].current_streak === 6, 'and the stored row is left as it was (the next counted day rewrites it)')
}
{
  freshDb({ streak: null })
  const r = await loadApp()
  ok(r.status === 200 && r.body.streaks === null, 'no streak row: none in the answer, as before (the corner shows 0)', show(r.body.streaks))
}
{
  // The corner and the old dashboard take the number from that answer; the
  // team's two student views ask the same rule of the row they read. Since
  // T-026 (2026-10-20) the first load and every refetch are one function,
  // refreshFromServer, so the line is there once (student-context.test.mjs
  // runs the first load through it).
  const ctx = read('../src/contexts/StudentContext.tsx')
  ok((ctx.match(/current: \((?:data|fresh)\.streaks as StudentStreaks \| null\)\?\.current_streak \?\? 0,/g) ?? []).length === 1,
     'StudentContext copies the answer\'s current_streak, at load and on every refetch')
  ok(/const current = streak\?\.current \?\? 0;/.test(read('../src/components/world/WorldCorner.tsx')), 'and the corner shows StudentContext\'s number')
  // Since admin rebuild 2 (D9) the student page and the Journey drawer both
  // draw StatGrid (StudentDetailView.tsx) from buildStudentDetail
  // (student-detail.ts), which asks currentStreakAsOf of the row it read, on
  // the day the page was read (admin-people.test.mjs runs it).
  const builder = read('../src/lib/admin/student-detail.ts')
  const view = read('../src/components/admin/students/StudentDetailView.tsx')
  const journey = read('../src/components/admin/journey/JourneyView.tsx')
  ok(builder.includes('currentStreakAsOf(reads.streak.data, nowIso.slice(0, 10))') && !builder.includes('.current_streak ??')
       && view.includes('<Fact label="Streak" read={s.streak} show={(d) => `${d} ${d === 1 ? "day" : "days"}`} />')
       && view.includes('<StatGrid student={s} nowMs={nowMs} />') && journey.includes('<StatGrid student={loaded.data} nowMs={Date.parse(loaded.data.generatedAt)} compact />'),
     'the student page and the Journey drawer: the team sees the same number')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
