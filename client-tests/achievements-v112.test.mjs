// The badges for the new course (migration v112, the owner's decisions of
// 2026-10-21): every rule v112 changed, on the real source.
//
//   1. the eight badges, and the eight rules taken out never awarded
//   2. Triple Threat: 3 lessons really finished on one day (achievement-rules.ts,
//      finishedAt and mostFinishedInOneDay), then through the evaluator
//   3. the writers that say a lesson's time is real (completed_at_real): the
//      lesson page's player, Whop's event, the Whop catch-up with Whop's own
//      time; a login or visit sync never does; a failed mark fails nothing
//   4. Habit Builder: a 7-day streak counted from the switch's date
//      (streakDaysSinceSwitch), then through the evaluator
//   5. the share beside each badge: who it divides by (countsInShare) and how
//      it rounds (sharePercent), the rule the view of v112 is held to
//
// achievements.ts, achievement-rules.ts, the routes and the catch-up are the
// real files, copied by build.mjs; the database is stub-server.ts's stand-in,
// whose update writes any column it is given (the real column is v112's).
// Every student, id and time here is made up.
import fs from 'node:fs'
import { createHmac, randomBytes } from 'node:crypto'
import { ACHIEVEMENT_RULES, buildAchievementSnapshot, evaluateAchievements } from './_gen/achievements.ts'
import { countsInShare, finishedAt, mostFinishedInOneDay, sharePercent, streakDaysSinceSwitch } from './_gen/achievement-rules.ts'
import { POST as watched } from './_gen/lesson-watched-route.ts'
import { POST as visit } from './_gen/refresh-watch-sync-route.ts'
import { POST as webhook } from './_gen/whop-webhook-route.ts'
import { runWhopCatchup } from './_gen/whop-catchup.ts'
// useDb under another name: ESLint's React rules take a "use..." call for a hook.
import { FakeDb, fakeClient, useDb as openDb, setWhop, setCatalog, steps } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const same = (a, b) => show(a) === show(b)

/** Runs `fn` with the console quiet; returns [result or thrown error, lines]. */
async function quietly(fn) {
  const real = [console.info, console.warn, console.error]
  const lines = []
  console.info = console.warn = console.error = (...a) => { lines.push(a.join(' ')) }
  try { return [await fn(), lines] } catch (e) { return [e, lines] } finally { [console.info, console.warn, console.error] = real }
}

const RESET = '2026-10-19T18:25:00.000Z'
const KEEP =['first_lesson', 'first_action_shipped', 'streak_7', 'discount_earned', 'bounty_access_claimed', 'triple_play', 'unbroken', 'perfect_run']
const REMOVED = ['r1_clear', 'r2_clear', 'r3_clear', 'r4_clear', 'region_sweep', 'early_finisher', 'speedrun', 'streak_14']

// The new course, as far as these rules read it: plain lessons in two areas,
// a video action item and a setup action item.
const LESSONS = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `a1l0${n}`, region_id: 'a1', sort_order: n, type: 'watch', requires_action: false,
    counts_toward_progress: true, whop_lesson_id: `lesn_A${n}`, duration_seconds: 600 })),
  { id: 'a1l07', region_id: 'a1', sort_order: 7, type: 'watch', requires_action: true, counts_toward_progress: true, whop_lesson_id: 'lesn_A7', duration_seconds: 600 },
  { id: 'a1l08', region_id: 'a1', sort_order: 8, type: 'setup', requires_action: true, counts_toward_progress: true, whop_lesson_id: 'lesn_A8' },
  ...[1, 2].map((n) => ({ id: `a2l0${n}`, region_id: 'a2', sort_order: n, type: 'watch', requires_action: false,
    counts_toward_progress: true, whop_lesson_id: `lesn_B${n}`, duration_seconds: 600 })),
]

/** A stand-in database for one student s1 (Whop user_1, signed in as auth-1). */
function dbFor({ completions = [], streak = null, reset = RESET, watch = [], extra = {} } = {}) {
  const db = new FakeDb({
    students: [{ id: 's1', whop_user_id: 'user_1', supabase_user_id: 'auth-1', email: 'student@example.com',
      joined_at: '2026-06-03T10:00:00.000Z', first_paid_at: '2026-06-03T10:00:00.000Z' }],
    lessons: LESSONS,
    student_lesson_completions: completions.map((c) => ({ student_id: 's1', ...c })),
    student_streaks: streak ? [{ student_id: 's1', ...streak }] : [],
    student_lesson_watch: watch.map((w) => ({ student_id: 's1', ...w })),
    admin_config: reset ? [{ key: 'curriculum_reset_at', value: reset }] : [],
    student_achievements: [],
    ...extra,
  }, { 'tok-1': 'auth-1' })
  return db
}
const snap = (db) => buildAchievementSnapshot(fakeClient(db), 's1')
const rule = (id) => ACHIEVEMENT_RULES.find((r) => r.id === id)
const rowOf = (db, lessonId) => db.rows('student_lesson_completions').find((r) => r.lesson_id === lessonId) ?? null

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 1. The eight, and the eight taken out ===')
ok(same(ACHIEVEMENT_RULES.map((r) => r.id), KEEP), 'the rules are the eight v112 keeps, in v53\'s order', ACHIEVEMENT_RULES.map((r) => r.id).join(' '))
ok(REMOVED.every((id) => !ACHIEVEMENT_RULES.some((r) => r.id === id)), 'none of the eight it took out is a rule')
{
  // A student who meets every old condition of the eight taken out: all of a1 on one day (Region Sweep
  // and r1_clear), a 20-day streak counted from the switch (Two Weeks Strong), everything done in days
  // (early_finisher, speedrun), and who already holds Region Sweep from before.
  const day = '2026-10-21'
  const all = LESSONS.filter((l) => !l.requires_action).map((l, i) => ({
    lesson_id: l.id, completed_at: `${day}T0${i}:00:00.000Z`, completed_at_real: true }))
  const db = dbFor({
    completions: all,
    streak: { current_streak: 20, longest_streak: 20, last_streak_date: '2026-11-07' },
    extra: { student_achievements: [{ student_id: 's1', achievement_id: 'region_sweep', unlocked_at: '2026-10-20T00:00:00.000Z' }] },
  })
  const [got] = await quietly(() => evaluateAchievements(fakeClient(db), 's1'))
  const inserted = db.rows('student_achievements').map((r) => r.achievement_id)
  ok(Array.isArray(got) && !got.some((id) => REMOVED.includes(id)) && inserted.filter((id) => REMOVED.includes(id)).length === 1,
     'evaluateAchievements inserts none of them, and the Region Sweep held from before is left as it is (v112 takes it away)', show(got))
  ok(got.includes('triple_play') && got.includes('streak_7') && got.includes('first_lesson'),
     'while the same student earns what the eight give: First Steps, Habit Builder, Triple Threat', show(got))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Triple Threat: the rule alone ===')
{
  const t = (iso) => Date.parse(iso)
  const W = '2026-10-20T07:00:00.000Z'
  const A = '2026-10-20T10:00:00.000Z'
  const cases = [
    ['a lesson finished on its own', { completed_at: W, action_completed_at: null, completed_at_real: true }, false, t(W)],
    ['a lesson a sync stamped (null)', { completed_at: W, action_completed_at: null, completed_at_real: null }, false, null],
    ['a lesson a sync stamped (false, judged by v112)', { completed_at: W, action_completed_at: null, completed_at_real: false }, false, null],
    ['an action item, both halves real: the later', { completed_at: W, action_completed_at: A, completed_at_real: true }, true, t(A)],
    ['an action item, the video real and after the action: the video', { completed_at: A, action_completed_at: W, completed_at_real: true }, true, t(A)],
    ['an action item, the video from a sync before the action: the action', { completed_at: W, action_completed_at: A, completed_at_real: null }, true, t(A)],
    ['an action item, the video from a sync after the action: no telling', { completed_at: A, action_completed_at: W, completed_at_real: null }, true, null],
    ['a setup action item, both halves at one press', { completed_at: A, action_completed_at: A, completed_at_real: null }, true, t(A)],
    ['an action item half done (no action)', { completed_at: W, action_completed_at: null, completed_at_real: true }, true, null],
    ['an action item handed in before its video', { completed_at: null, action_completed_at: A, completed_at_real: null }, true, null],
    ['a skip (no completed_at)', { completed_at: null, action_completed_at: null, completed_at_real: null }, false, null],
    ['a time that does not read as one', { completed_at: 'yesterday', action_completed_at: null, completed_at_real: true }, false, null],
  ]
  for (const [label, row, needsAction, want] of cases) {
    const got = finishedAt({ lesson_id: 'x', ...row }, needsAction)
    ok(got === want, `finishedAt: ${label}`, show({ got: got && new Date(got).toISOString(), want: want && new Date(want).toISOString() }))
  }
  const map = new Map(LESSONS.map((l) => [l.id, l.requires_action]))
  const real = (id, at) => ({ lesson_id: id, completed_at: at, action_completed_at: null, completed_at_real: true })
  ok(mostFinishedInOneDay([real('a1l01', '2026-10-20T08:00:00Z'), real('a1l02', '2026-10-20T09:00:00Z'), real('a1l03', '2026-10-20T23:59:59Z')], map) === 3,
     'three on one UTC day: 3')
  ok(mostFinishedInOneDay([real('a1l01', '2026-10-20T23:59:58Z'), real('a1l02', '2026-10-20T23:59:59Z'), real('a1l03', '2026-10-21T00:00:00Z')], map) === 2,
     'across midnight UTC: 2 and 1, so 2')
  ok(mostFinishedInOneDay([real('a1l01', '2026-10-20T08:00:00Z'), real('a1l01', '2026-10-20T09:00:00Z'), real('a1l02', '2026-10-20T09:00:00Z')], map) === 2,
     'a lesson counts once')
  ok(mostFinishedInOneDay([real('a1l01', '2026-10-20T08:00:00Z'), real('zz_gone', '2026-10-20T09:00:00Z'), real('a1l02', '2026-10-20T09:00:00Z')], map) === 2,
     'a row for a lesson not in the course is left out')
  ok(mostFinishedInOneDay([], map) === 0, 'no rows: 0')
}

console.log('\n=== 2. Triple Threat through the evaluator ===')
{
  const SYNC = '2026-10-20T09:00:00.123Z'
  for (const [label, completions, most, earns] of [
    ['three lessons from one sync (completed_at_real not set): no day',
      [['a1l01', SYNC], ['a1l02', SYNC], ['a1l03', SYNC]].map(([id, at]) => ({ lesson_id: id, completed_at: at })), 0, false],
    ['three finished on their own on one day',
      [['a1l01', '2026-10-20T08:00:00Z'], ['a1l02', '2026-10-20T09:00:00Z'], ['a1l03', '2026-10-20T20:00:00Z']]
        .map(([id, at]) => ({ lesson_id: id, completed_at: at, completed_at_real: true })), 3, true],
    ['two on their own and two from a sync on that day: 2',
      [{ lesson_id: 'a1l01', completed_at: '2026-10-20T08:00:00Z', completed_at_real: true },
       { lesson_id: 'a1l02', completed_at: '2026-10-20T09:00:00Z', completed_at_real: true },
       { lesson_id: 'a1l03', completed_at: SYNC }, { lesson_id: 'a1l04', completed_at: SYNC }], 2, false],
    ['two on their own and an action item whose video came from a sync before its action',
      [{ lesson_id: 'a1l01', completed_at: '2026-10-20T08:00:00Z', completed_at_real: true },
       { lesson_id: 'a1l02', completed_at: '2026-10-20T09:00:00Z', completed_at_real: true },
       { lesson_id: 'a1l07', completed_at: '2026-10-20T07:00:00Z', action_completed_at: '2026-10-20T10:00:00Z' }], 3, true],
    ['two on their own and a setup action item pressed that day',
      [{ lesson_id: 'a1l01', completed_at: '2026-10-20T08:00:00Z', completed_at_real: true },
       { lesson_id: 'a1l02', completed_at: '2026-10-20T09:00:00Z', completed_at_real: true },
       { lesson_id: 'a1l08', completed_at: '2026-10-20T11:00:00Z', action_completed_at: '2026-10-20T11:00:00Z' }], 3, true],
    ['two on their own and a skip that day',
      [{ lesson_id: 'a1l01', completed_at: '2026-10-20T08:00:00Z', completed_at_real: true },
       { lesson_id: 'a1l02', completed_at: '2026-10-20T09:00:00Z', completed_at_real: true },
       { lesson_id: 'a1l03', completed_at: null, skipped_at: '2026-10-20T10:00:00Z' }], 2, false],
  ]) {
    const db = dbFor({ completions })
    const s = await snap(db)
    const got = await evaluateAchievements(fakeClient(db), 's1')
    ok(s.maxLessonsInOneDay === most && rule('triple_play').evaluate(s) === earns && got.includes('triple_play') === earns,
       `${label}: ${most}, ${earns ? 'earned' : 'not earned'}`, show({ most: s.maxLessonsInOneDay, got }))
  }
  // A database without the column (v112 not pasted yet): the read of it fails; every other badge is
  // still judged, Triple Threat waits, and the failure is logged once.
  {
    const db = dbFor({ completions: [['a1l01', '2026-10-20T08:00:00Z'], ['a1l02', '2026-10-20T09:00:00Z'], ['a1l03', '2026-10-20T10:00:00Z']]
      .map(([id, at]) => ({ lesson_id: id, completed_at: at, completed_at_real: true })) })
    db.failWhen = (call) => (call.op === 'select' && call.filters.includes('completed_at_real=true')
      ? { code: '42703', message: 'column student_lesson_completions.completed_at_real does not exist' } : null)
    const [got, log] = await quietly(() => evaluateAchievements(fakeClient(db), 's1'))
    ok(same(got, ['first_lesson']) && log.length === 1 && log[0].includes('completed_at_real read failed'),
       'with no column: First Steps still awarded, Triple Threat not, one line logged', show({ got, log }))
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 3. The writers: who says a lesson\'s time is real ===')
setCatalog({ v2: true })
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
  try { body = JSON.parse(text) } catch { /* no body */ }
  return { status: res.status, body, log }
}
const watchRow = (lessonId) => ({ lesson_id: lessonId, max_position_seconds: 590, watched_seconds: 500, reported_duration_seconds: 600, threshold_met_at: null })
// Whop signs its webhooks (Standard Webhooks); the secret is made up here.
const KEY = randomBytes(24)
process.env.WHOP_WEBHOOK_SECRET = `ws_${KEY.toString('base64')}`
let msg = 0
function whopSends(whopLessonId) {
  const body = JSON.stringify({ type: 'course_lesson_interaction.completed', data: { user: { id: 'user_1' }, lesson: { id: whopLessonId }, completed: true } })
  const id = `msg_${++msg}`
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = createHmac('sha256', KEY).update(`${id}.${ts}.${body}`).digest('base64')
  return call(webhook, new Request('http://app/api/webhooks/whop', {
    method: 'POST', headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` }, body,
  }))
}
{
  // The lesson page's player: three lessons watched in the app today.
  const db = dbFor({ watch: ['a1l01', 'a1l02', 'a1l03'].map(watchRow) })
  openDb(db)
  const answers = []
  for (const id of ['a1l01', 'a1l02', 'a1l03']) answers.push(await call(watched, post('lesson-watched', { lessonId: id })))
  ok(answers.every((r) => r.status === 200 && r.body.completed === true), 'lesson-watched finishes the three', show(answers.map((r) => r.body)))
  ok(['a1l01', 'a1l02', 'a1l03'].every((id) => rowOf(db, id)?.completed_at_real === true),
     'and marks each row: its completed_at is the moment the student finished watching')
  const marks = db.calls('student_lesson_completions', 'update').filter((q) => q.values?.completed_at_real === true)
  const chain = steps.filter((x) => x.step === 'achievements').length
  ok(marks.length === 3 && chain === 3, 'one mark per lesson, written before the chain judges the badges', show({ marks: marks.length, chain }))
  const got = await evaluateAchievements(fakeClient(db), 's1')
  ok(got.includes('triple_play'), 'the evaluator then gives Triple Threat: 3 lessons really finished today', show(got))
  steps.length = 0
  const again = await call(watched, post('lesson-watched', { lessonId: 'a1l01' }))
  ok(again.body.completed === true && db.calls('student_lesson_completions', 'update').filter((q) => q.values?.completed_at_real === true).length === 3,
     'asked again for a finished lesson: no second mark')
}
{
  // A video action item handed in first: the watch half is stamped on the existing row, and marked.
  const db = dbFor({ completions: [{ lesson_id: 'a1l07', completed_at: null, action_completed_at: '2026-10-20T08:00:00Z', discord_message_link: 'https://discord.com/channels/1/2/3' }],
    watch: [watchRow('a1l07')] })
  openDb(db)
  const r = await call(watched, post('lesson-watched', { lessonId: 'a1l07' }))
  ok(r.body.completed === true && rowOf(db, 'a1l07').completed_at !== null && rowOf(db, 'a1l07').completed_at_real === true,
     'an action item whose action came first: its video half stamped and marked', show(rowOf(db, 'a1l07')))
}
{
  // A failed mark (a database without the column) fails nothing.
  const db = dbFor({ watch: [watchRow('a1l01')] })
  db.failWhen = (call) => (call.op === 'update' && call.values?.completed_at_real !== undefined
    ? { code: 'PGRST204', message: "Could not find the 'completed_at_real' column of 'student_lesson_completions' in the schema cache" } : null)
  openDb(db)
  const r = await call(watched, post('lesson-watched', { lessonId: 'a1l01' }))
  ok(r.status === 200 && r.body.completed === true && rowOf(db, 'a1l01')?.completed_at && rowOf(db, 'a1l01').completed_at_real === undefined &&
     r.log.some((l) => l.includes('completed_at_real not written')),
     'lesson-watched with no column: the lesson is finished all the same, the failure logged', show({ body: r.body, log: r.log.filter((l) => l.includes('completed_at_real')) }))
}
{
  // Whop's event: the webhook marks the row it finished; a retry marks nothing.
  const db = dbFor()
  openDb(db)
  const r = await whopSends('lesn_A1')
  ok(r.status === 200 && rowOf(db, 'a1l01')?.completed_at_real === true, 'the webhook marks the lesson it finished', show(rowOf(db, 'a1l01')))
  const before = show(db.rows('student_lesson_completions'))
  const again = await whopSends('lesn_A1')
  ok(again.status === 200 && db.calls('student_lesson_completions', 'update').filter((q) => q.values?.completed_at_real === true).length === 1 &&
     show(db.rows('student_lesson_completions')) === before,
     'a second delivery for the same lesson: the row as it was, no second mark')
  const db2 = dbFor()
  db2.failWhen = (call) => (call.op === 'update' && call.values?.completed_at_real !== undefined ? { code: 'PGRST204', message: 'no such column' } : null)
  openDb(db2)
  const r2 = await whopSends('lesn_A2')
  ok(r2.status === 200 && rowOf(db2, 'a1l02')?.completed_at && steps.some((x) => x.step === 'achievements'),
     'with no column: still 200 (no retry from Whop), the lesson written, the chain run', show(r2.body))
}
{
  // A visit's sync brings three lessons from Whop at once: no mark, no Triple Threat.
  const db = dbFor()
  openDb(db)
  setWhop(async () => ({ interactions: ['lesn_A1', 'lesn_A2', 'lesn_A3'].map((id) => ({ lesson: { id }, completed: true })), rawCount: 3, completedCount: 3 }))
  const r = await call(visit, post('refresh-watch-sync'))
  const rows = db.rows('student_lesson_completions')
  ok(r.status === 200 && rows.length === 3 && rows.every((x) => x.completed_at_real === undefined) && new Set(rows.map((x) => x.completed_at)).size === 1,
     'the sync adds the three with one time and marks none', show(rows.map((x) => [x.lesson_id, x.completed_at_real])))
  ok(!db.calls('student_lesson_completions', 'update').some((q) => q.values?.completed_at_real !== undefined), 'it writes no mark at all')
  const got = await evaluateAchievements(fakeClient(db), 's1')
  ok(got.includes('first_lesson') && !got.includes('triple_play'), 'First Steps, and no Triple Threat for a sync\'s three', show(got))
  setWhop(async () => ({ interactions: [], rawCount: 0, completedCount: 0 }))
}
{
  // The Whop catch-up (T-089): a row added with Whop's own time is marked, one given the run's clock is not.
  const realFetch = globalThis.fetch
  process.env.WHOP_API_KEY = 'apik_made_up_for_tests'
  process.env.WHOP_COURSE_ID = 'cour_TESTv112'
  const NOW = Date.now()
  const at = (h) => new Date(Date.UTC(2026, 9, 18, h)).toISOString()
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [
      { id: 'int_1', completed: true, created_at: at(8), lesson: { id: 'lesn_B1' }, user: { id: 'user_1' } },
      { id: 'int_2', completed: true, created_at: at(10), lesson: { id: 'lesn_B2' }, user: { id: 'user_1' } },
      { id: 'int_3', completed: true, created_at: at(12), lesson: { id: 'lesn_A1' }, user: { id: 'user_1' } },
      { id: 'int_4', completed: true, created_at: null, lesson: { id: 'lesn_A2' }, user: { id: 'user_1' } },
    ],
    page_info: { has_next_page: false, end_cursor: null },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  try {
    const db = dbFor()
    const member = { id: 's1', whop_user_id: 'user_1', membership_status: 'active', csm_exempt: false, whop_plan_id: null, first_paid_at: '2026-06-03T10:00:00.000Z' }
    const [answer, log] = await quietly(() => runWhopCatchup(fakeClient(db), [member], { mode: 'write', after: null, startedAtMs: NOW }))
    ok(answer.ok === true && answer.rows.inserted === 4, 'the catch-up adds the four rows', show({ ok: answer.ok, rows: answer.rows, log: log.slice(0, 2) }))
    ok(['a2l01', 'a2l02', 'a1l01'].every((id) => rowOf(db, id)?.completed_at_real === true) && rowOf(db, 'a1l02')?.completed_at_real === undefined,
       'the three with Whop\'s own time are marked; the one Whop gave no time (the run\'s clock) is not', show(db.rows('student_lesson_completions').map((r) => [r.lesson_id, r.completed_at, r.completed_at_real])))
    const got = await evaluateAchievements(fakeClient(db), 's1')
    ok(got.includes('triple_play'), 'so the three opened on Whop on 18 October count as 3 that day', show(got))
  } finally {
    globalThis.fetch = realFetch
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Habit Builder: the rule alone ===')
{
  const SW = '2026-10-19'
  for (const [label, streak, want] of [
    ['no streak row', null, 0],
    ['a streak of 0', { current_streak: 0, last_streak_date: '2026-10-25' }, 0],
    ['no last day', { current_streak: 9, last_streak_date: null }, 0],
    ['last counted the day before the switch', { current_streak: 40, last_streak_date: '2026-10-18' }, 0],
    ['last counted two days before the switch', { current_streak: 40, last_streak_date: '2026-10-17' }, 0],
    ['last counted a month before the switch', { current_streak: 3, last_streak_date: '2026-09-19' }, 0],
    ['last counted on the switch\'s date, a long streak behind it', { current_streak: 40, last_streak_date: '2026-10-19' }, 1],
    ['a streak of 12 across the switch, last counted on the 21st', { current_streak: 12, last_streak_date: '2026-10-21' }, 3],
    ['a streak across the switch, last counted on the 25th: the 7th day', { current_streak: 30, last_streak_date: '2026-10-25' }, 7],
    ['a streak of 3 started after it', { current_streak: 3, last_streak_date: '2026-11-02' }, 3],
    ['a date that does not read as one', { current_streak: 9, last_streak_date: 'soon' }, 0],
  ]) {
    ok(streakDaysSinceSwitch(streak, SW) === want, `streakDaysSinceSwitch: ${label}: ${want}`, String(streakDaysSinceSwitch(streak, SW)))
  }
  ok(streakDaysSinceSwitch({ current_streak: 8, last_streak_date: '2026-10-26' }, '2026-10-19T00:00:00.000Z') === 8,
     'the switch\'s date may come with a time (only the date is read)')
}

console.log('\n=== 4. Habit Builder through the evaluator ===')
{
  for (const [label, streak, reset, days, earns] of [
    ['a June student, best 40, current 12 across the switch, last counted on the 21st', { current_streak: 12, longest_streak: 40, last_streak_date: '2026-10-21' }, RESET, 3, false],
    ['the same streak on the 24th: 6 days from the switch', { current_streak: 15, longest_streak: 40, last_streak_date: '2026-10-24' }, RESET, 6, false],
    ['on the 25th: the 7th day', { current_streak: 16, longest_streak: 40, last_streak_date: '2026-10-25' }, RESET, 7, true],
    ['a 9-day streak from the 27th of October to 4 November', { current_streak: 9, longest_streak: 40, last_streak_date: '2026-11-04' }, RESET, 9, true],
    ['the old course (no switch): the old rule, the best 9 is enough', { current_streak: 3, longest_streak: 9, last_streak_date: '2026-10-10' }, null, null, true],
    ['the old course, best 6: not yet', { current_streak: 3, longest_streak: 6, last_streak_date: '2026-10-10' }, null, null, false],
  ]) {
    const db = dbFor({ streak, reset })
    const s = await snap(db)
    const got = await evaluateAchievements(fakeClient(db), 's1')
    ok(s.streakDaysSinceSwitch === days && rule('streak_7').evaluate(s) === earns && got.includes('streak_7') === earns,
       `${label}: ${days ?? 'no switch'}, ${earns ? 'earned' : 'not earned'}`, show({ days: s.streakDaysSinceSwitch, got }))
  }
  // The flame keeps its number: the evaluator writes nothing to the streak.
  const db = dbFor({ streak: { current_streak: 12, longest_streak: 40, last_streak_date: '2026-10-21' } })
  await evaluateAchievements(fakeClient(db), 's1')
  ok(same(db.rows('student_streaks')[0], { student_id: 's1', current_streak: 12, longest_streak: 40, last_streak_date: '2026-10-21', updated_at: db.rows('student_streaks')[0].updated_at }) &&
     db.calls('student_streaks').every((q) => q.op === 'select'),
     'and the streak the flame shows is only read: still 12, best 40')
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 5. The share: who it divides by, and how it rounds ===')
{
  const m = (membership_status, csm_exempt = false, is_team = false) => ({ membership_status, csm_exempt, is_team })
  for (const [label, member, want] of [
    ['an active member', m('active'), true],
    ['a past due member', m('past_due'), true],
    ['an active member who never opened the app (nothing about the app is asked)', m('active'), true],
    ['a canceled one', m('canceled'), false],
    ['an expired one', m('expired'), false],
    ['no status', m(null), false],
    ['a status Whop may add one day', m('trialing'), false],
    ['CSM exempt', m('active', true), false],
    ['exempt not set (null): counted', m('active', null), true],
    ['a team member', m('active', false, true), false],
  ]) {
    ok(countsInShare(member) === want, `countsInShare: ${label}: ${want ? 'counted' : 'not counted'}`)
  }
  for (const [h, n, want] of [[0, 0, 0], [5, 0, 0], [0, 19, 0], [13, 19, 68.4], [3, 19, 15.8], [1, 16, 6.3], [1, 3, 33.3], [2, 3, 66.7], [19, 19, 100], [1, 8, 12.5], [1, 1136, 0.1]]) {
    ok(sharePercent(h, n) === want, `sharePercent(${h}, ${n}) = ${want}`, String(sharePercent(h, n)))
  }
  // The view of v112 states the same rule; supabase/migration-tests/v112.test.mjs runs it on Postgres
  // against these two functions. Here: its WHERE names the three conditions, and nothing about the app.
  const sql = fs.readFileSync(new URL('../supabase/migrations/2026_v112_new_achievements.sql', import.meta.url), 'utf8')
  const view = sql.slice(sql.indexOf('create or replace view public.achievement_unlock_stats'), sql.indexOf('group by a.id;'))
  const eligible = view.slice(view.indexOf('with eligible as ('), view.indexOf('denom as ('))
  ok(eligible.includes("s.membership_status in ('active', 'past_due')") && eligible.includes('s.csm_exempt is not true') &&
     eligible.includes('t.id = s.supabase_user_id') && !/first_paid_at|student_milestones|student_lesson_completions|student_lesson_watch/.test(eligible),
     'v112\'s view divides by exactly these: active or past due, not exempt, not the team, and no "used the app" or "paid since" left')
  const corner = fs.readFileSync(new URL('../src/components/world/useWorldBadges.ts', import.meta.url), 'utf8')
  ok(corner.includes('supabase.from("achievement_unlock_stats").select("id, unlock_pct")'), 'and the corner reads each badge\'s share from that view')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
