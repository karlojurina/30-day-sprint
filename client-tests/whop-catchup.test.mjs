// T-089, the Whop catch-up: POST /api/admin/whop-catchup through the route's
// own POST (the tests listed in section 7.10 of
// _admin/prds/night-2026-10-19/whop_catchup.md, in the workspace).
//
// What runs is the real source, copied by build.mjs: the route, the run
// (src/lib/whop-catchup.ts), the team login (admin-auth.ts, on the stand-in's
// auth and team_members), the pagination helper, the switch's date
// (curriculum-reset.ts) and the real Whop read (whop.ts,
// fetchCompletedLessonsAsAdmin) on a stand-in for Whop's API that answers
// course_lesson_interactions in pages of 100, as Whop's v1 does. So each
// failure the run sorts by kind is the real read's own message, with the
// member's Whop id and the course id in it. The database is stub-server.ts's
// stand-in; the streak's writer is recorded in `steps`, then run for real.
//
// The clock is the suite's: `new Date()` and `Date.now()` answer it, and
// setTimeout moves it by the time asked and fires at once. So the pace (4
// Whop requests a second, start to start), a 429's wait and the 240 s budget
// pass in milliseconds and are measured on that clock. An answer from Whop
// takes `latency` on it (0 unless a section says).
//
// Every Whop id, email, name, key, secret and course id here is made up.
import { POST as catchup, maxDuration } from './_gen/whop-catchup-route.ts'
import { syncWatchProgress } from './_gen/watch-sync.ts'
import { fetchCompletedLessonsAsAdmin as whopRead } from './_gen/whop.ts'
import { whopNoneFinishedNote } from './_gen/constants.ts'
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
import { FakeDb, useDb as installDb, setWhop, steps } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const same = (a, b) => show(a) === show(b)

// ── The clock ────────────────────────────────────────────────────────────────
const RealDate = Date
const realSetTimeout = globalThis.setTimeout
const realFetch = globalThis.fetch
const NOW = '2026-10-20T07:00:00.000Z'
let clock = RealDate.parse(NOW)
class Clock extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(clock)
    else super(...args)
  }
  static now() { return clock }
}
globalThis.Date = Clock
globalThis.setTimeout = (fn, ms = 0, ...args) => {
  clock += Math.max(0, Number(ms) || 0)
  return realSetTimeout(fn, 0, ...args)
}

// ── The deployment's values ──────────────────────────────────────────────────
const COURSE = 'cour_TESTcatchup01'
const KEY = 'apik_made_up_for_tests'
const SECRET = 'cron-secret-made-up-for-tests'
process.env.WHOP_API_KEY = KEY
process.env.WHOP_COURSE_ID = COURSE
process.env.CRON_SECRET = SECRET

// ── Whop ─────────────────────────────────────────────────────────────────────
/** What Whop holds, by Whop user id: the interactions, or a function (the nth request for that member) that answers. */
let onWhop = {}
/** Every request the run made to Whop: whose, which page, when on the suite's clock, the key and the course. */
let asked = []
let latency = 0
const answer = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const pageOf = (rows) => answer({ data: rows, page_info: { has_next_page: false, end_cursor: null } })
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  const user = u.searchParams.get('user_id')
  const after = u.searchParams.get('after')
  const page = after ? Number(after.slice(1)) : 0
  asked.push({ user, page, at: clock, key: init.headers?.Authorization, course: u.searchParams.get('course_id') })
  clock += latency
  const held = onWhop[user]
  if (typeof held === 'function') return held(asked.filter((a) => a.user === user).length)
  const rows = held ?? []
  const more = rows.length > (page + 1) * 100
  return answer({ data: rows.slice(page * 100, (page + 1) * 100), page_info: { has_next_page: more, end_cursor: more ? `p${page + 1}` : null } })
}
/** The members asked for, in order (first pages only). */
const usersAsked = () => asked.filter((a) => a.page === 0).map((a) => a.user)
/** One interaction as Whop's list gives it. `createdAt` is when the member opened the lesson. */
const opened = (user, lesson, createdAt, completed = true) => ({
  id: `int_${lesson}_${user}`, completed, created_at: createdAt,
  lesson: { id: lesson, title: `Lesson ${lesson}` }, user: { id: user },
})

// ── The database ─────────────────────────────────────────────────────────────
const sid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const W = (n) => `user_TEST${String(n).padStart(6, '0')}`
const PAYING = 'plan_4ZrwR4PmBsVsx'
const RESET = { key: 'curriculum_reset_at', value: '2026-10-19T16:34:00.000Z' }
const LESSONS = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `a1l0${n}`, whop_lesson_id: `lesn_TEST0${n}` }))
const TEAM = [
  { id: 'auth-founder', role: 'founder', email: 'founder@example.com', full_name: 'Made Up Founder' },
  { id: 'auth-csm', role: 'csm', email: 'csm@example.com', full_name: 'Made Up Csm' },
]
const USERS = { 'tok-founder': 'auth-founder', 'tok-csm': 'auth-csm' }
/** A member of the CSM pool unless `extra` says otherwise: active, paying, first paid 8 days before NOW, not exempt. */
const member = (n, extra = {}) => ({
  id: sid(n), whop_user_id: W(n), email: `member${n}@example.com`, name: `Made Up Member ${n}`,
  membership_status: 'active', csm_exempt: false, whop_plan_id: PAYING,
  first_paid_at: '2026-10-12T10:00:00.000Z', joined_at: '2026-10-12T10:00:00.000Z',
  last_active_at: '2026-10-15T00:00:00.000Z',
  ...extra,
})
function freshDb({ members = [], completions = [], sync = [], milestones = [], streaks = [], config = [RESET] } = {}) {
  const db = new FakeDb({
    students: members,
    lessons: LESSONS,
    student_lesson_completions: completions,
    student_whop_sync: sync,
    student_milestones: milestones,
    student_streaks: streaks,
    admin_config: config,
    team_members: TEAM,
  }, USERS)
  installDb(db)
  steps.length = 0
  asked = []
  latency = 0
  clock = RealDate.parse(NOW)
  return db
}
const writes = (db) => db.log.filter((q) => q.op !== 'select')
const rowsOf = (db, n) => db.rows('student_lesson_completions').filter((r) => r.student_id === sid(n))
const rowOf = (db, n, lesson) => rowsOf(db, n).find((r) => r.lesson_id === lesson)
const syncOf = (db, n) => db.rows('student_whop_sync').find((r) => r.student_id === sid(n))

// ── Calling the route ────────────────────────────────────────────────────────
/** Every answer's text and every line the code logged, for the last section. */
const answers = []
const logged = []
async function quiet(fn) {
  const real = [console.log, console.info, console.warn, console.error]
  console.log = console.info = console.warn = console.error = (...a) => { logged.push(a.map(String).join(' ')) }
  try { return await fn() } finally { [console.log, console.info, console.warn, console.error] = real }
}
async function call(body, auth = `Bearer ${SECRET}`) {
  const headers = { 'content-type': 'application/json' }
  if (auth) headers.authorization = auth
  const res = await quiet(() => catchup(new Request('http://app/api/admin/whop-catchup', {
    method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body),
  })))
  const text = await res.text()
  answers.push(text)
  return { status: res.status, body: JSON.parse(text), text }
}
/** Call after call from the start of a pass, as Lovro's loop does, until nothing remains or one says ok: false. */
async function wholePass(mode) {
  const got = []
  let after = null
  for (let i = 0; i < 50; i++) {
    const r = await call({ mode, after })
    got.push(r)
    if (!r.body.ok || r.body.this_call.remaining === 0) break
    after = r.body.this_call.next_after
  }
  return got
}

// The main fixture. Ids order the members: the pool (active, paying plan,
// first paid in the last 30 days, not exempt) is B 3, C 4, A 5, D 6, I 9; the
// rest are E 1 (free plan), F 2 (past_due), H 8 (csm_exempt) and J 10 (first
// paid in August). G 7 is canceled and is never read.
const [E, F, B, C, A, D, G, H, I, J] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
function mainDb() {
  onWhop = {
    // Opened lesson 1 four days ago (the app has it from a login, at a later
    // time), lesson 2 today, lesson 3 opened and not finished.
    [W(A)]: [opened(W(A), 'lesn_TEST01', '2026-10-16T09:00:00.000Z'), opened(W(A), 'lesn_TEST02', '2026-10-20T06:30:00.000Z'),
      opened(W(A), 'lesn_TEST03', '2026-10-18T09:00:00.000Z', false)],
    // Lesson 1 eight days ago; lesson 4 seven days ago, skipped in the app.
    [W(B)]: [opened(W(B), 'lesn_TEST01', '2026-10-12T10:00:00.000Z'), opened(W(B), 'lesn_TEST04', '2026-10-13T10:00:00.000Z')],
    [W(C)]: [],
    // A time after the run's clock, and none at all.
    [W(D)]: [opened(W(D), 'lesn_TEST05', '2026-10-21T12:00:00.000Z'), opened(W(D), 'lesn_TEST06', null)],
    [W(E)]: [opened(W(E), 'lesn_TEST02', '2026-10-18T09:00:00.000Z', false)],
    // One lesson of the course, one of the old course.
    [W(F)]: [opened(W(F), 'lesn_TEST03', '2026-10-10T10:00:00.000Z'), opened(W(F), 'lesn_OLDCOURSE1', '2026-09-20T10:00:00.000Z')],
    [W(G)]: [opened(W(G), 'lesn_TEST01', '2026-10-15T10:00:00.000Z')],
    [W(I)]: [opened(W(I), 'lesn_TEST06', '2026-10-11T08:00:00.000Z')],
  }
  return freshDb({
    members: [
      member(E, { whop_plan_id: 'plan_FREEmadeup1' }), member(F, { membership_status: 'past_due' }),
      member(B), member(C), member(A), member(D), member(G, { membership_status: 'canceled' }),
      member(H, { csm_exempt: true }), member(I), member(J, { first_paid_at: '2026-08-01T10:00:00.000Z' }),
    ],
    completions: [
      { id: 'row-a1', student_id: sid(A), lesson_id: 'a1l01', completed_at: '2026-10-19T18:00:00.000Z' },
      { id: 'row-b4', student_id: sid(B), lesson_id: 'a1l04', completed_at: null, skipped_at: '2026-10-19T20:00:00.000Z' },
      { id: 'row-g2', student_id: sid(G), lesson_id: 'a1l02', completed_at: '2026-10-01T10:00:00.000Z' },
    ],
    sync: [{
      student_id: sid(F), access_token: 'whop-access-made-up', refresh_token: 'whop-refresh-made-up',
      last_sync_at: '2026-10-19T16:50:00.000Z',
      last_sync_error: `Whop lesson interactions fetch failed (500) [user_id=${W(F)}] [course_id=${COURSE}]: upstream hiccup`,
      last_sync_error_at: '2026-10-19T17:00:00.000Z', last_sync_fetched: 0, last_sync_matched: 0, last_sync_unmatched: [],
      updated_at: '2026-10-19T17:00:00.000Z',
    }],
    milestones: [
      { student_id: sid(A), first_sprint_login_at: '2026-10-19T17:00:00.000Z' },
      { student_id: sid(B), first_sprint_login_at: null },
      { student_id: sid(C), first_sprint_login_at: '2026-10-19T17:05:00.000Z' },
    ],
    streaks: [{ student_id: sid(A), current_streak: 2, longest_streak: 5, last_streak_date: '2026-10-19', updated_at: '2026-10-19T18:00:00.000Z' }],
  })
}
const POOL_ORDER = [B, C, A, D, I, E, F, H, J].map(W)

console.log('\n=== Who may run it ===')
{
  ok(maxDuration === 300, 'maxDuration is 300, as every long route in the repo')
  let db = mainDb()
  let r = await call({ mode: 'dry' }, null)
  ok(r.status === 401 && r.body.error === 'Not authenticated' && asked.length === 0 && writes(db).length === 0,
     'no login: 401 from the real team login, no Whop request, nothing written', show({ status: r.status, body: r.body }))
  r = await call({ mode: 'dry' }, 'Bearer not-a-token')
  ok(r.status === 401 && r.body.error === 'Invalid token', 'a token nobody holds: 401', show(r.body))
  r = await call({ mode: 'dry' }, 'Bearer tok-csm')
  ok(r.status === 403 && r.body.error === 'Requires role: founder or admin' && asked.length === 0,
     'a CSM: 403, and Whop is never asked', show(r.body))
  r = await call({ mode: 'dry' }, 'Bearer tok-founder')
  ok(r.status === 200 && r.body.ok === true, 'a founder: in', show({ status: r.status, ok: r.body.ok }))
  db = mainDb()
  r = await call({ mode: 'dry' })
  ok(r.status === 200 && r.body.ok === true && usersAsked().length === 9, 'CRON_SECRET from a terminal: in', show({ status: r.status }))
  process.env.CRON_SECRET = `  ${SECRET}\n`
  mainDb()
  r = await call({ mode: 'dry' }, `Bearer ${SECRET}  `)
  ok(r.status === 200, 'the secret with stray spaces or a newline on either side still lets in (both sides trimmed)', show({ status: r.status }))
  process.env.CRON_SECRET = SECRET
}

console.log('\n=== What it refuses before any read ===')
{
  let db = mainDb()
  let r = await call({ mode: 'everything' })
  ok(r.status === 400 && db.log.length === 0 && asked.length === 0, 'another mode: 400, the database and Whop untouched', show(r.body))
  r = await call(undefined)
  ok(r.status === 400, 'no body: 400', show(r.body))
  for (const bad of ['start', '2:abc', '0:', 7, { id: 'x' }]) {
    r = await call({ mode: 'dry', after: bad })
    ok(r.status === 400 && asked.length === 0, `a cursor that does not read (${show(bad)}): 400`, show(r.body))
  }
  delete process.env.WHOP_API_KEY
  r = await call({ mode: 'dry' })
  ok(r.status === 500 && r.body.error === 'WHOP_API_KEY is not set on this deployment. Nothing ran.' && asked.length === 0,
     'no WHOP_API_KEY: 500, naming the variable', r.body.error)
  process.env.WHOP_API_KEY = KEY
  delete process.env.WHOP_COURSE_ID
  r = await call({ mode: 'snapshot' })
  ok(r.status === 500 && r.body.error.startsWith('WHOP_COURSE_ID is not set'), 'no WHOP_COURSE_ID: 500, the snapshot included', r.body.error)
  process.env.WHOP_COURSE_ID = COURSE

  db = mainDb()
  db.tables.admin_config = []
  r = await call({ mode: 'write' })
  ok(r.status === 409 && asked.length === 0 && writes(db).length === 0,
     'before the switch (no curriculum_reset_at): 409, no Whop request, nothing written', r.body.error)
  db = mainDb()
  db.fail['admin_config.select'] = { message: 'connection reset' }
  r = await call({ mode: 'dry' })
  ok(r.status === 500 && asked.length === 0 && !r.text.includes('connection reset'),
     'the switch\'s date unreadable: 500, never a guess, the database\'s words kept to the log', r.body.error)
  db = mainDb()
  db.fail['students.select'] = { message: 'connection reset' }
  r = await call({ mode: 'dry' })
  ok(r.status === 500 && asked.length === 0, 'the members unreadable: 500 and nothing ran', r.body.error)
  db = mainDb()
  db.fail['lessons.select'] = { message: 'connection reset' }
  r = await call({ mode: 'write' })
  ok(r.status === 500 && r.body.kind === 'lessons_read_failed' && asked.length === 0 && writes(db).length === 0,
     'the course\'s lessons unreadable: 500, lessons_read_failed, nothing asked or written', show(r.body))
}

console.log('\n=== Dry: counts only, nothing written, nothing triggered ===')
let dry
{
  const db = mainDb()
  const r = await call({ mode: 'dry' })
  dry = r.body
  ok(r.status === 200 && dry.ok === true && dry.mode === 'dry' && dry.run_started_at === NOW, 'answers 200, ok, dry, and the run\'s start', show({ ok: dry.ok, at: dry.run_started_at }))
  ok(writes(db).length === 0, 'not one insert, upsert, update, delete or rpc in the database\'s log', show(writes(db).map((q) => `${q.op} ${q.table}`)))
  ok(steps.length === 0, 'no step at all: no streak, no "last active", no badges, no "came back", no task check', show(steps))
  ok(same(usersAsked(), POOL_ORDER),
     'the CSM pool first (B, C, A, D, I by id), then the rest by id; the canceled member is never asked', show(usersAsked().map((u) => Number(u.slice(-6)))))
  ok(asked.every((a) => a.key === `Bearer ${KEY}` && a.course === COURSE), 'every read carries the app\'s key and the course, as the backfill\'s does')
  ok(same(dry.members, { all: 9, pool: 5 }), 'members: 9 active or past_due, 5 of them in the pool', show(dry.members))
  ok(same(dry.this_call, { checked: 9, remaining: 0, next_after: `1:${sid(J)}`, pool_done: true, stopped_because: 'done', duration_ms: dry.this_call.duration_ms }),
     'this call: 9 checked, none left, the cursor at the last member', show(dry.this_call))
  ok(same(dry.whop, { requests: 9, retried_429: 0, failed: { rate_limited: 0, filter_ignored: 0, too_many_pages: 0, http_401_403: 0, http_other: 0, network: 0 } }),
     'Whop: 9 requests, nothing retried or failed', show(dry.whop))
  ok(same(dry.students, { finished_on_whop: 5, opened_none_finished: 1, nothing_on_whop: 3, already_all_in_app: 0, failed: 0, would_get_rows: 5 }),
     'students: 5 finished on Whop, 1 opened and finished none, 3 with nothing, 5 would get rows', show(dry.students))
  ok(same(dry.rows, { would_insert: 6, would_promote: 1, not_in_course: 1, time_missing: 1, time_later_than_run: 1, earliest_day: '2026-10-10', latest_day: '2026-10-20' }),
     'rows: 6 new, 1 skip finished, 1 old-course lesson, 1 time missing and 1 later than the run, from 10 to 20 October', show(dry.rows))
  ok(same(dry.pool, { zero_lessons_now: 4, of_them_filled: 3, logged_in_still_zero: 1, last_lesson_3_to_6_days: 1, last_lesson_7_plus_days: 1 }),
     'pool: 4 at zero now, 3 of them filled, 1 logged in and still zero, 1 last lesson 6 days ago, 1 eight days ago', show(dry.pool))
  ok(dry.streak_today === 1 && !('changes' in dry) && !('streak_ticked' in dry), 'one member would get today\'s streak day; a dry answer has no change log', show({ streak_today: dry.streak_today }))
}

console.log('\n=== Write: Whop\'s times on the rows, the sync rows as the backfill writes them, one streak day ===')
{
  const db = mainDb()
  const activeBefore = Object.fromEntries(db.rows('students').map((s) => [s.id, s.last_active_at]))
  const r = await call({ mode: 'write' })
  const w = r.body
  ok(r.status === 200 && w.ok === true && w.mode === 'write', 'answers 200, ok, write', show({ ok: w.ok }))
  ok(same(Object.keys(w).sort(), [...Object.keys(dry), 'changes', 'streak_ticked'].filter((k) => k !== 'streak_today').sort()),
     'the dry answer\'s shape, with streak_ticked and the change log', show(Object.keys(w)))
  ok(w.rows.inserted === 6 && w.rows.promoted === 1 && w.students.got_rows === 5 && w.streak_ticked === 1 &&
     w.rows.not_in_course === 1 && w.rows.time_missing === 1 && w.rows.time_later_than_run === 1,
     'inserted 6, promoted 1, 5 members got rows, 1 streak day, the same counts as the dry run', show({ rows: w.rows, got: w.students.got_rows }))

  ok(rowOf(db, A, 'a1l02')?.completed_at === '2026-10-20T06:30:00.000Z', 'a new row carries Whop\'s created_at', rowOf(db, A, 'a1l02')?.completed_at)
  ok(rowOf(db, A, 'a1l01')?.completed_at === '2026-10-19T18:00:00.000Z', 'a row the app had (from a login) keeps its own time', rowOf(db, A, 'a1l01')?.completed_at)
  ok(rowOf(db, B, 'a1l01')?.completed_at === '2026-10-12T10:00:00.000Z' && rowOf(db, F, 'a1l03')?.completed_at === '2026-10-10T10:00:00.000Z' &&
     rowOf(db, I, 'a1l06')?.completed_at === '2026-10-11T08:00:00.000Z', 'days-old lessons are dated the day they were opened on Whop')
  const b4 = rowOf(db, B, 'a1l04')
  ok(b4?.id === 'row-b4' && b4.completed_at === '2026-10-13T10:00:00.000Z' && b4.skipped_at === null,
     'a skipped row is finished with Whop\'s time and its skip cleared, on the same row', show(b4))
  // D is the 4th member asked (after B, C and A), so 3 paced starts after the run's own.
  const dTime = '2026-10-20T07:00:00.750Z'
  ok(rowOf(db, D, 'a1l05')?.completed_at === dTime && rowOf(db, D, 'a1l06')?.completed_at === dTime,
     'a time later than the run\'s clock, and a missing one, both become the run\'s clock', show(rowsOf(db, D).map((x) => x.completed_at)))
  ok(rowsOf(db, G).length === 1 && !syncOf(db, G), 'the canceled member: no row added, no sync row')
  ok(db.rows('student_lesson_completions').length === 3 + 6, 'nothing else was added anywhere', String(db.rows('student_lesson_completions').length))

  const inserted = w.changes.inserted
  ok(inserted.length === 6 && inserted.every(([id, student, lesson, at]) => {
    const row = db.rows('student_lesson_completions').find((x) => x.id === id)
    return row && row.student_id === student && row.lesson_id === lesson && row.completed_at === at
  }), 'the change log names each row added: [row id, student id, lesson id, completed_at], as the table holds it', show(inserted.slice(0, 2)))
  ok(same(w.changes.promoted, [['row-b4', '2026-10-19T20:00:00.000Z', '2026-10-13T10:00:00.000Z']]),
     'and each row finished: [row id, the skipped_at it had, completed_at], enough to put it back', show(w.changes.promoted))
  ok(same(w.changes.streak_ticked, [sid(A)]), 'and the members whose streak it ticked', show(w.changes.streak_ticked))

  ok(same(steps, [{ step: 'streak', studentId: sid(A) }]),
     'one step only: the streak tick for the member with a lesson opened on Whop today; nothing for older lessons, a missing time or a later one', show(steps))
  const streakA = db.rows('student_streaks').find((x) => x.student_id === sid(A))
  ok(streakA.current_streak === 3 && streakA.longest_streak === 5 && streakA.last_streak_date === '2026-10-20' && db.rows('student_streaks').length === 1,
     'the tick counted today after yesterday (2 -> 3, the best stays 5), and wrote no other streak row', show(streakA))
  ok(db.rows('students').every((s) => s.last_active_at === activeBefore[s.id]), '"last active" did not move for anyone')

  const sE = syncOf(db, E)
  ok(sE.last_sync_error === whopNoneFinishedNote(1) && sE.last_sync_error_at !== null && sE.last_sync_fetched === 1 && sE.last_sync_matched === 0 && same(sE.last_sync_unmatched, []),
     'opened and finished none: the backfill\'s note', show(sE))
  const sF = syncOf(db, F)
  ok(sF.last_sync_error === null && sF.last_sync_error_at === null && sF.last_sync_fetched === 2 && sF.last_sync_matched === 1 && same(sF.last_sync_unmatched, ['lesn_OLDCOURSE1']),
     'finished lessons: the old error cleared, fetched 2, matched 1, the old-course lesson listed as unmatched', show({ ...sF, access_token: undefined, refresh_token: undefined }))
  ok(sF.access_token === 'whop-access-made-up' && sF.refresh_token === 'whop-refresh-made-up' && sF.last_sync_at !== '2026-10-19T16:50:00.000Z',
     'the token columns are left exactly as they were, and the sync time moved')
  ok([C, H, J].every((n) => { const s = syncOf(db, n); return s.last_sync_error === null && s.last_sync_fetched === 0 && s.last_sync_matched === 0 }),
     'nothing on Whop: a plain zero, no error')
  ok(db.rows('student_whop_sync').length === 9, 'every member read got a sync row, and only they did', String(db.rows('student_whop_sync').length))

  // The backfill (watch-sync.ts, what a login runs) on a copy of the same
  // database with the same Whop: the same lessons matched, the same sync rows.
  const back = mainDb()
  setWhop((id) => whopRead(id))
  await quiet(async () => { for (const n of [A, B, C, D, E, F, H, I, J]) await syncWatchProgress({ studentId: sid(n), whopUserId: W(n) }) })
  const SYNC_COLS = ['last_sync_error', 'last_sync_fetched', 'last_sync_matched', 'last_sync_unmatched']
  const differ = [A, B, C, D, E, F, H, I, J].filter((n) => {
    const x = syncOf(db, n)
    const y = syncOf(back, n)
    return !SYNC_COLS.every((c) => same(x[c], y[c])) || (x.last_sync_error_at === null) !== (y.last_sync_error_at === null)
  })
  ok(differ.length === 0, 'each sync row holds the values the backfill writes for that member (error, its time or none, fetched, matched, unmatched)', show(differ))
  const done = (d) => d.rows('student_lesson_completions').filter((x) => x.completed_at).map((x) => `${x.student_id}/${x.lesson_id}`).sort()
  ok(same(done(db), done(back)), 'and the same lessons watched; only the times differ (the backfill stamps the moment it runs)', show(done(db).length))
  setWhop(async () => ({ interactions: [], rawCount: 0, completedCount: 0 }))

  // The second pass, as step 4 of Lovro's run: from the start again.
  installDb(db)
  steps.length = 0
  const before = show(db.rows('student_lesson_completions'))
  const again = await call({ mode: 'write' })
  ok(again.body.ok === true && again.body.rows.inserted === 0 && again.body.rows.promoted === 0 && again.body.streak_ticked === 0 &&
     again.body.students.already_all_in_app === 5 && same(again.body.changes, { inserted: [], promoted: [], streak_ticked: [] }),
     'a second full pass adds 0, finishes 0, ticks 0: all 5 members now have everything in the app', show({ rows: again.body.rows, students: again.body.students }))
  ok(show(db.rows('student_lesson_completions')) === before && steps.length === 0, 'and every row and time is as the first pass left it, with no step')
}

console.log('\n=== A 429: waited out and retried; a third ends the call before that member ===')
{
  const X = [21, 22, 23]
  const fixture = (holdX2) => {
    onWhop = Object.fromEntries(X.map((n) => [W(n), [opened(W(n), 'lesn_TEST01', '2026-10-18T10:00:00.000Z')]]))
    if (holdX2) onWhop[W(22)] = holdX2
    return freshDb({ members: X.map((n) => member(n)) })
  }
  const x2rows = [opened(W(22), 'lesn_TEST01', '2026-10-18T10:00:00.000Z')]
  const gapsFor = (user) => {
    const at = asked.filter((a) => a.user === user).map((a) => a.at)
    return at.slice(1).map((t, i) => t - at[i])
  }
  for (const [body, wait, label] of [
    ['{"error":{"message":"Too many requests. Try again in 3 seconds."}}', 3000, 'the 3 seconds Whop names'],
    ['{"error":"rate limited"}', 15000, '15 seconds when Whop names none'],
    ['{"error":{"message":"Try again in 90 seconds"}}', 30000, 'at most 30 seconds when Whop names 90'],
  ]) {
    const db = fixture((n) => (n === 1 ? answer(body, 429) : pageOf(x2rows)))
    const r = await call({ mode: 'write' })
    ok(r.body.ok === true && r.body.this_call.stopped_because === 'done' && r.body.whop.retried_429 === 1 && r.body.whop.requests === 4 &&
       rowOf(db, 22, 'a1l01') && same(gapsFor(W(22)), [wait]),
       `a 429 then a success: waits ${label}, retries, and the member's row is written`, show({ gaps: gapsFor(W(22)), whop: r.body.whop }))
  }
  {
    const db = fixture(() => answer('{"error":"rate limited"}', 429))
    const r = await call({ mode: 'write' })
    const t = r.body.this_call
    ok(r.status === 200 && r.body.ok === true && t.stopped_because === 'rate limited' && t.next_after === `0:${sid(21)}` && t.remaining === 2 && t.pool_done === false,
       'three 429s for one member: the call ends early with the cursor before that member (ok, so the loop calls again)', show(t))
    ok(r.body.whop.failed.rate_limited === 1 && r.body.whop.retried_429 === 2 && same(gapsFor(W(22)), [15000, 15000]),
       'asked 3 times, 15 s apart, and counted as rate_limited once', show(r.body.whop))
    ok(!usersAsked().includes(W(23)) && rowsOf(db, 22).length === 0 && !syncOf(db, 22) && rowOf(db, 21, 'a1l01'),
       'nothing written for that member, the sync row included; the member before it written; the one after it not asked')
    onWhop[W(22)] = x2rows
    const next = await call({ mode: 'write', after: t.next_after })
    ok(next.body.ok === true && next.body.this_call.checked === 2 && next.body.this_call.remaining === 0 && rowOf(db, 22, 'a1l01') && rowOf(db, 23, 'a1l01'),
       'the next call, from that cursor, takes the member again and goes on', show(next.body.this_call))
  }
}

console.log('\n=== Whop ignoring the member filter: the run stops and writes nothing for that member ===')
{
  const X = [31, 32, 33]
  onWhop = Object.fromEntries(X.map((n) => [W(n), [opened(W(n), 'lesn_TEST01', '2026-10-18T10:00:00.000Z')]]))
  onWhop[W(32)] = [opened(W(32), 'lesn_TEST01', '2026-10-18T10:00:00.000Z'), opened('user_TESTsomeone', 'lesn_TEST02', '2026-10-18T10:00:00.000Z')]
  const db = freshDb({ members: X.map((n) => member(n)) })
  const r = await call({ mode: 'write' })
  ok(r.status === 500 && r.body.ok === false && r.body.kind === 'filter_ignored' && r.body.this_call.stopped_because === 'filter ignored' &&
     r.body.whop.failed.filter_ignored === 1, 'answers 500, ok: false, kind filter_ignored', show({ kind: r.body.kind, stopped: r.body.this_call.stopped_because }))
  ok(rowsOf(db, 32).length === 0 && !syncOf(db, 32), 'that member: no row, no sync row')
  ok(rowOf(db, 31, 'a1l01') && !usersAsked().includes(W(33)) && r.body.this_call.next_after === `0:${sid(31)}` && r.body.this_call.remaining === 2,
     'the member before it stays written; no one after it is asked; the cursor sits before it', show(r.body.this_call))
  ok(/Tell Claude/.test(r.body.error) && !r.body.error.includes('—'), 'the answer says what happened and to tell Claude, in plain words', r.body.error)
}

console.log('\n=== 25 members whose finished lessons match no lesson: WHOP_COURSE_ID names another course ===')
{
  const N = Array.from({ length: 26 }, (_, i) => 100 + i)
  const otherCourse = () => {
    onWhop = Object.fromEntries(N.map((n) => [W(n), [opened(W(n), `lesn_OTHER${n}`, '2026-10-18T10:00:00.000Z')]]))
    return freshDb({ members: N.map((n) => member(n, { whop_plan_id: 'plan_FREEmadeup1' })) })
  }
  otherCourse()
  let r = await call({ mode: 'dry' })
  ok(r.status === 500 && r.body.ok === false && r.body.kind === 'no_lesson_matched' && r.body.this_call.checked === 25 && usersAsked().length === 25 &&
     r.body.rows.not_in_course === 25, 'the dry run stops at the 25th, before the 26th is asked', show({ checked: r.body.this_call.checked, error: r.body.error }))
  const db = otherCourse()
  r = await call({ mode: 'write' })
  ok(r.body.ok === false && db.rows('student_lesson_completions').length === 0, 'a write run stops the same way, with no completion row anywhere')
  onWhop = Object.fromEntries(N.map((n) => [W(n), [opened(W(n), `lesn_OTHER${n}`, '2026-10-18T10:00:00.000Z')]]))
  onWhop[W(110)] = [opened(W(110), 'lesn_TEST02', '2026-10-18T10:00:00.000Z')]
  onWhop[W(111)] = []
  freshDb({ members: N.map((n) => member(n, { whop_plan_id: 'plan_FREEmadeup1' })) })
  r = await call({ mode: 'dry' })
  ok(r.body.ok === true && r.body.this_call.checked === 26 && r.body.rows.not_in_course === 24, 'control: 24 such members do not stop it', show(r.body.this_call))
}

console.log('\n=== Failures: counted by kind, the member passed over, 5 of one kind in a row stop the run ===')
{
  const N = [51, 52, 53, 54, 55, 56, 57]
  onWhop = Object.fromEntries(N.map((n) => [W(n), () => answer('{"error":"unauthorized"}', 401)]))
  let db = freshDb({ members: N.map((n) => member(n)) })
  let r = await call({ mode: 'write' })
  ok(r.status === 500 && r.body.ok === false && r.body.kind === 'http_401_403' && r.body.this_call.stopped_because === 'failures in a row' &&
     r.body.this_call.checked === 5 && usersAsked().length === 5 && r.body.whop.failed.http_401_403 === 5 && r.body.students.failed === 5,
     'a 401 for every member: stops after the 5th', show({ kind: r.body.kind, checked: r.body.this_call.checked }))
  ok(writes(db).length === 0 && /lost its course permissions/.test(r.body.error), 'nothing written; the answer says the key lost its permissions', r.body.error)

  onWhop = Object.fromEntries(N.slice(0, 6).map((n, i) => [W(n), () => answer('{"error":"no"}', i % 2 ? 500 : 403)]))
  freshDb({ members: N.slice(0, 6).map((n) => member(n)) })
  r = await call({ mode: 'dry' })
  ok(r.body.ok === true && r.body.this_call.checked === 6 && r.body.whop.failed.http_401_403 === 3 && r.body.whop.failed.http_other === 3,
     'kinds taking turns never make 5 in a row', show(r.body.whop.failed))

  const fine = (n) => [opened(W(n), 'lesn_TEST01', '2026-10-18T10:00:00.000Z')]
  const throwsNetwork = () => { throw new TypeError('fetch failed') }
  /** Member `m`'s own row on every page, and always one more page. */
  const endless = (m) => (nth) => answer({ data: [opened(W(m), 'lesn_TEST01', '2026-10-18T10:00:00.000Z')], page_info: { has_next_page: true, end_cursor: `p${nth}` } })
  onWhop = { [W(51)]: fine(51), [W(52)]: () => answer('bad gateway', 502), [W(53)]: throwsNetwork, [W(54)]: endless(54), [W(55)]: fine(55) }
  db = freshDb({ members: [51, 52, 53, 54, 55].map((n) => member(n)) })
  r = await call({ mode: 'write' })
  ok(r.body.ok === true && r.body.this_call.checked === 5 && r.body.this_call.remaining === 0 &&
     same(r.body.whop.failed, { rate_limited: 0, filter_ignored: 0, too_many_pages: 1, http_401_403: 0, http_other: 1, network: 1 }) && r.body.students.failed === 3,
     'a 502, a dropped connection and Whop paging forever: one of each kind, the run goes on', show(r.body.whop.failed))
  ok(r.body.whop.requests === 1 + 1 + 1 + 5 + 1, 'the endless member counts the 5 pages the read made before refusing', String(r.body.whop.requests))
  ok(rowOf(db, 51, 'a1l01') && rowOf(db, 55, 'a1l01') && [52, 53, 54].every((n) => rowsOf(db, n).length === 0 && !syncOf(db, n)),
     'the failed members: nothing written, the sync row included; the others written')
  onWhop = { [W(52)]: fine(52), [W(53)]: fine(53), [W(54)]: fine(54), [W(51)]: fine(51), [W(55)]: fine(55) }
  r = await call({ mode: 'write' })
  ok(r.body.ok === true && r.body.rows.inserted === 3 && [52, 53, 54].every((n) => rowOf(db, n, 'a1l01') && syncOf(db, n)),
     'the next pass tries them again and writes them', show(r.body.rows))

  onWhop = { [W(51)]: fine(51), [W(52)]: [] }
  db = freshDb({ members: [51, 52].map((n) => member(n)) })
  db.fail['student_lesson_completions.upsert'] = { message: 'deadlock detected' }
  r = await call({ mode: 'write' })
  ok(r.body.ok === true && r.body.database.failed.write_failed === 1 && !syncOf(db, 51) && syncOf(db, 52) && !r.text.includes('deadlock'),
     'a failed insert: write_failed, no sync row for that member; a member with nothing to add still gets theirs', show(r.body.database))
  db = freshDb({ members: [51, 52].map((n) => member(n)) })
  db.fail['student_lesson_completions.select'] = { message: 'statement timeout' }
  r = await call({ mode: 'dry' })
  ok(r.body.ok === true && r.body.database.failed.lessons_read_failed === 2, 'the members\' rows unreadable: lessons_read_failed, counted per member', show(r.body.database))
}

console.log('\n=== The pace: at most 4 Whop requests a second, start to start ===')
{
  const N = [61, 62, 63, 64, 65]
  onWhop = Object.fromEntries(N.map((n) => [W(n), [opened(W(n), 'lesn_TEST01', '2026-10-18T10:00:00.000Z')]]))
  // 150 lessons opened on another course and not finished: two pages.
  onWhop[W(62)] = Array.from({ length: 150 }, (_, i) => opened(W(62), `lesn_OPEN${i}`, '2026-10-18T10:00:00.000Z', false))
  freshDb({ members: N.map((n) => member(n)) })
  const r = await call({ mode: 'dry' })
  const starts = asked.filter((a) => a.page === 0).map((a) => a.at)
  const gaps = starts.slice(1).map((t, i) => t - starts[i])
  ok(same(gaps, [250, 500, 250, 250]), '250 ms between members, 500 after the one that took two pages', show(gaps))
  ok(asked.length === 6 && r.body.whop.requests === 6 && r.body.students.opened_none_finished === 1, '6 requests, counted as 6', show(r.body.whop))
}

console.log('\n=== The time budget: a cursor, and the next call starts after it ===')
{
  const N = [71, 72, 73, 74, 75, 76]
  onWhop = Object.fromEntries(N.map((n) => [W(n), [opened(W(n), 'lesn_TEST02', '2026-10-17T10:00:00.000Z')]]))
  const db = freshDb({ members: N.map((n) => member(n, { whop_plan_id: 'plan_FREEmadeup1' })) })
  latency = 70_000
  const first = await call({ mode: 'write' })
  const t = first.body.this_call
  ok(first.status === 200 && first.body.ok === true && t.stopped_because === 'time budget' && t.checked === 4 && t.remaining === 2 &&
     t.next_after === `1:${sid(74)}` && t.duration_ms === 280_000,
     'Whop taking 70 s a member: 4 started inside 240 s, then the call answers with its cursor', show(t))
  ok(rowsOf(db, 74).length === 1 && rowsOf(db, 75).length === 0, 'the 4th is written, the 5th not started')
  // A member who appears between the calls, with an id behind the cursor.
  db.rows('students').push({ ...member(70, { whop_plan_id: 'plan_FREEmadeup1' }), csm_exempt: false })
  onWhop[W(70)] = [opened(W(70), 'lesn_TEST02', '2026-10-17T10:00:00.000Z')]
  asked = []
  const second = await call({ mode: 'write', after: t.next_after })
  ok(same(usersAsked(), [W(75), W(76)]) && second.body.this_call.remaining === 0 && second.body.this_call.stopped_because === 'done',
     'the next call starts right after the cursor and finishes; the member who appeared behind it is not asked', show(usersAsked().map((u) => Number(u.slice(-6)))))
  ok(second.body.members.all === 7 && rowsOf(db, 70).length === 0, 'they are counted among the members, and left to the webhook and their login (or the next pass)')
  latency = 0
  const pass2 = await wholePass('write')
  ok(pass2.length === 1 && pass2[0].body.rows.inserted === 1 && rowOf(db, 70, 'a1l02'), 'a full pass from the start adds only that member\'s row', show(pass2[0].body.rows))
  const pass3 = await wholePass('write')
  ok(pass3.every((x) => x.body.ok && x.body.rows.inserted === 0 && x.body.rows.promoted === 0), 'and the pass after it adds 0', show(pass3.map((x) => x.body.rows.inserted)))
}

console.log('\n=== The snapshot: the rows the write can change, no token column, no Whop request ===')
{
  const db = mainDb()
  const r = await call({ mode: 'snapshot' })
  const s = r.body
  ok(r.status === 200 && s.ok === true && s.mode === 'snapshot' && s.taken_at === NOW, 'answers 200 with the time it was taken', show({ ok: s.ok, at: s.taken_at }))
  ok(asked.length === 0 && writes(db).length === 0, 'no Whop request, nothing written')
  ok(same(s.counts, { members: 9, student_lesson_completions: 2, student_whop_sync: 1, student_streaks: 1 }),
     'counts for the members only: the canceled member\'s row is not in it', show(s.counts))
  ok(same(s.student_lesson_completions.columns, ['id', 'student_id', 'lesson_id', 'completed_at', 'skipped_at']) &&
     s.student_lesson_completions.rows.some((x) => same(x, ['row-b4', sid(B), 'a1l04', null, '2026-10-19T20:00:00.000Z'])),
     'completions: the columns the run writes, as compact arrays (never the Discord link)', show(s.student_lesson_completions.rows))
  ok(same(s.student_whop_sync.columns, ['student_id', 'last_sync_at', 'last_sync_error', 'last_sync_error_at', 'last_sync_fetched', 'last_sync_matched', 'last_sync_unmatched', 'updated_at']),
     'sync rows: the diagnostics columns', show(s.student_whop_sync.columns))
  ok(!r.text.includes('access_token') && !r.text.includes('refresh_token') && !r.text.includes('whop-access-made-up') && !r.text.includes('whop-refresh-made-up'),
     'no token column, and no token value, anywhere in it')
  const named = (t) => db.calls(t, 'select').map((q) => q.columns)
  ok(named('student_whop_sync').every((c) => c !== '*' && !/token/.test(c)) &&
     named('student_lesson_completions').every((c) => c !== '*' && !c.includes('discord_message_link')),
     'and the reads name their columns: the tokens and the Discord link are never even read', show(named('student_whop_sync')))
  const err = s.student_whop_sync.rows[0][2]
  ok(err === 'Whop lesson interactions fetch failed (500) [user_id=[whop user]] [course_id=[course]]: upstream hiccup',
     'an old failure on a sync row keeps its words, with the Whop id and the course id hidden', err)
  ok(s.student_streaks.columns.includes('current_streak') && s.student_streaks.columns.includes('last_streak_date') &&
     same(s.student_streaks.rows[0].slice(0, 4), [sid(A), 2, 5, '2026-10-19']), 'streak rows: every column', show(s.student_streaks))
  ok(['student_lesson_completions', 'student_whop_sync', 'student_streaks'].every((t) => db.calls(t, 'select').every((q) => q.filters.some((f) => f.startsWith('range ')))),
     'every read of it is paged, so the 1,000-row cap cannot cut it short')
}

console.log('\n=== No answer, and no log line, holds an email, a Whop user id or the course id ===')
{
  const secrets = [COURSE, KEY, SECRET, 'user_TESTsomeone', 'whop-access-made-up', ...Array.from({ length: 130 }, (_, i) => W(i + 1))]
  const leaks = answers.filter((t) => secrets.some((x) => t.includes(x)) || t.includes('@') || t.includes('Made Up'))
  ok(answers.length > 40 && leaks.length === 0, `${answers.length} answers read: none holds one`, leaks[0]?.slice(0, 200))
  const logLeaks = logged.filter((l) => secrets.some((x) => l.includes(x)) || l.includes('@'))
  ok(logged.some((l) => l.includes('[whop-catchup]')) && logLeaks.length === 0, `${logged.length} log lines: none holds one (a failure is logged by its kind)`, logLeaks[0])
  ok(answers.every((t) => !t.includes('—')), 'and no answer holds an em dash')
}

globalThis.Date = RealDate
globalThis.setTimeout = realSetTimeout
globalThis.fetch = realFetch
ok(Date === RealDate && globalThis.fetch === realFetch, 'the clock and fetch are the real ones again')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
