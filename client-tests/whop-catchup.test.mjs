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
// setTimeout sets a timer on it. Timers fire in the order they fall due, one
// per turn of the event loop, each moving the clock to its time as it fires;
// clearTimeout drops one. So the pace (4 Whop requests a second, start to
// start), a 429's wait, the 240 s budget and the 285 s limit on one Whop read
// pass in milliseconds and are measured on that clock, and a read that
// answers late loses to the limit as it would on Vercel. An answer from Whop
// takes `latency` on it, as a timer (0 unless a section says).
//
// Every Whop id, email, name, key, secret and course id here is made up.
import { POST as catchup, maxDuration } from './_gen/whop-catchup-route.ts'
import { syncWatchProgress } from './_gen/watch-sync.ts'
import { finishedAt } from './_gen/achievement-rules.ts'
import { isLessonComplete } from './_gen/progress.ts'
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
const realClearTimeout = globalThis.clearTimeout
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
/** The timers set on the suite's clock and not fired yet. */
let timers = []
let timersSet = 0
let pumping = false
/** On the next turn of the event loop, after everything already under way has run, fire the timer due first. */
function pump() {
  if (pumping || timers.length === 0) return
  pumping = true
  realSetTimeout(() => {
    pumping = false
    timers.sort((a, b) => a.due - b.due || a.n - b.n)
    const t = timers.shift()
    if (t) {
      clock = Math.max(clock, t.due)
      t.fn(...t.args)
    }
    pump()
  }, 0)
}
globalThis.setTimeout = (fn, ms = 0, ...args) => {
  const t = { due: clock + Math.max(0, Number(ms) || 0), n: ++timersSet, fn, args, ref: () => t, unref: () => t }
  timers.push(t)
  pump()
  return t
}
globalThis.clearTimeout = (t) => { timers = timers.filter((x) => x !== t) }
/** `ms` on the suite's clock. */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  if (latency > 0) await wait(latency)
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
function freshDb({ members = [], completions = [], sync = [], milestones = [], streaks = [], config = [RESET], lessons = LESSONS } = {}) {
  const db = new FakeDb({
    students: members,
    lessons,
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
  // A read a section gave up on is never answered: its timer goes with the clock.
  timers = []
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
  ok(same(dry.rows, { would_insert: 6, would_promote: 1, would_finish_actions: 0, not_in_course: 1, time_missing: 1, time_later_than_run: 1, earliest_day: '2026-10-10', latest_day: '2026-10-20' }),
     'rows: 6 new, 1 skip finished, no Done-only action item, 1 old-course lesson, 1 time missing and 1 later than the run, from 10 to 20 October', show(dry.rows))
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
     again.body.students.already_all_in_app === 5 && same(again.body.changes, { inserted: [], promoted: [], actions_finished: [], streak_ticked: [] }),
     'a second full pass adds 0, finishes 0, ticks 0: all 5 members now have everything in the app', show({ rows: again.body.rows, students: again.body.students }))
  ok(show(db.rows('student_lesson_completions')) === before && steps.length === 0, 'and every row and time is as the first pass left it, with no step')
}

console.log('\n=== A login writing the same lesson while the run writes: the login\'s row stays as the login wrote it ===')
{
  // Both lessons were opened on Whop today, so a row the run wrongly claimed
  // would tick the streak too. 81 has no row when the run reads, and a login
  // adds one (06:59:59) just as the run's insert goes out. 82 has a skipped
  // row, and a login finishes it just as the run's update goes out.
  const LOGIN_AT = '2026-10-20T06:59:59.000Z'
  onWhop = {
    [W(81)]: [opened(W(81), 'lesn_TEST02', '2026-10-20T06:30:00.000Z')],
    [W(82)]: [opened(W(82), 'lesn_TEST04', '2026-10-20T06:30:00.000Z')],
  }
  const db = freshDb({
    members: [member(81), member(82)],
    completions: [{ id: 'row-82', student_id: sid(82), lesson_id: 'a1l04', completed_at: null, skipped_at: '2026-10-19T20:00:00.000Z' }],
  })
  /** `land` runs once, as the run's first `op` on the completions is logged: after the run read the rows, before the database applies its write. */
  const loginLands = (op, land) => {
    const push = db.log.push.bind(db.log)
    let landed = false
    db.log.push = (q) => {
      if (!landed && q.table === 'student_lesson_completions' && q.op === op) { landed = true; land() }
      return push(q)
    }
  }
  loginLands('upsert', () => db.rows('student_lesson_completions').push({ id: 'row-81', student_id: sid(81), lesson_id: 'a1l02', completed_at: LOGIN_AT, skipped_at: null }))
  loginLands('update', () => Object.assign(rowOf(db, 82, 'a1l04'), { completed_at: LOGIN_AT, skipped_at: null }))
  const r = await call({ mode: 'write' })
  ok(r.body.ok === true && same(rowsOf(db, 81).map((x) => [x.id, x.completed_at]), [['row-81', LOGIN_AT]]) && r.body.rows.inserted === 0 && same(r.body.changes.inserted, []),
     'a row a login added after the run\'s read keeps the login\'s time, and the run claims it nowhere (inserted 0, not in the change log)', show({ rows: rowsOf(db, 81), changes: r.body.changes.inserted }))
  const r82 = rowOf(db, 82, 'a1l04')
  ok(r82.completed_at === LOGIN_AT && r82.skipped_at === null && r.body.rows.promoted === 0 && same(r.body.changes.promoted, []),
     'a skipped row a login finished after the run\'s read keeps the login\'s time, and the run claims no finish (promoted 0, not in the change log)', show({ row: r82, changes: r.body.changes.promoted }))
  ok(steps.length === 0 && r.body.streak_ticked === 0 && same(r.body.changes.streak_ticked, []) && r.body.students.got_rows === 0 && r.body.students.already_all_in_app === 2,
     'no streak tick for rows the run did not write, and both members count as already having everything', show({ steps, students: r.body.students }))
}

console.log('\n=== A streak that already counts today: no tick, not counted, not in the change log ===')
{
  // Both opened a lesson on Whop at 06:30 today that the app does not have.
  // 41's streak already counts today (work in the app at 06:45); 42 has no
  // streak row yet.
  onWhop = Object.fromEntries([41, 42].map((n) => [W(n), [opened(W(n), 'lesn_TEST02', '2026-10-20T06:30:00.000Z')]]))
  const counted = { student_id: sid(41), current_streak: 4, longest_streak: 6, last_streak_date: '2026-10-20', updated_at: '2026-10-20T06:45:00.000Z' }
  let db = freshDb({ members: [member(41), member(42)], streaks: [counted] })
  const streakOf = (n) => db.rows('student_streaks').find((x) => x.student_id === sid(n))
  const d = await call({ mode: 'dry' })
  ok(d.body.streak_today === 1 && writes(db).length === 0, 'dry: one member would get today\'s day, the one whose day is not counted yet', show({ streak_today: d.body.streak_today }))
  const r = await call({ mode: 'write' })
  const s41 = streakOf(41)
  ok(s41.current_streak === 4 && s41.longest_streak === 6 && s41.last_streak_date === '2026-10-20' && s41.updated_at === counted.updated_at,
     'the streak that counts today is left exactly as it was', show(s41))
  ok(r.body.rows.inserted === 2 && r.body.streak_ticked === 1 && same(r.body.changes.streak_ticked, [sid(42)]) && same(steps, [{ step: 'streak', studentId: sid(42) }]) &&
     streakOf(42)?.current_streak === 1 && streakOf(42).last_streak_date === '2026-10-20',
     'write: both rows added, one tick, and the change log lists only the streak the run changed (42, now 1 today)', show({ ticked: r.body.streak_ticked, listed: r.body.changes.streak_ticked, steps }))
  db = freshDb({ members: [member(42)] })
  db.fail['student_streaks.select'] = { message: 'statement timeout' }
  const f = await call({ mode: 'write' })
  ok(f.body.ok === true && f.body.rows.inserted === 1 && f.body.streak_ticked === 0 && same(f.body.changes.streak_ticked, []) && steps.length === 0 && db.rows('student_streaks').length === 0,
     'a streak that cannot be read: the row is written, no tick, nothing listed', show({ ticked: f.body.streak_ticked, steps }))
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
  {
    // The first read takes 230 s; the next member, started inside the
    // budget, gets a 429 naming 30 s, a wait that would end at 260 s.
    onWhop = {
      [W(24)]: async () => { await wait(230_000); return pageOf([opened(W(24), 'lesn_TEST01', '2026-10-18T10:00:00.000Z')]) },
      [W(25)]: () => answer('{"error":{"message":"Too many requests. Try again in 30 seconds."}}', 429),
    }
    const db = freshDb({ members: [member(24), member(25)] })
    const r = await call({ mode: 'write' })
    const t = r.body.this_call
    ok(r.body.ok === true && t.stopped_because === 'time budget' && t.next_after === `0:${sid(24)}` && t.duration_ms === 230_000 &&
       asked.filter((a) => a.user === W(25)).length === 1 && r.body.whop.retried_429 === 0 && r.body.whop.failed.rate_limited === 0 &&
       rowOf(db, 24, 'a1l01') && rowsOf(db, 25).length === 0 && !syncOf(db, 25),
       'a 429 at 230 s naming 30 s: no wait past the budget and no retry; the call ends at once with the cursor before that member, nothing of theirs written',
       show({ t, whop: r.body.whop }))
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

  // A failed read keeps the pace too: a 500 is one request, Whop paging forever is 5.
  onWhop = {
    [W(66)]: () => answer('{"error":"upstream"}', 500),
    [W(67)]: (nth) => answer({ data: [], page_info: { has_next_page: true, end_cursor: `p${nth}` } }),
    [W(68)]: [],
  }
  freshDb({ members: [66, 67, 68].map((n) => member(n)) })
  const failed = await call({ mode: 'dry' })
  const failedStarts = asked.filter((a) => a.page === 0).map((a) => a.at)
  const failedGaps = failedStarts.slice(1).map((t, i) => t - failedStarts[i])
  ok(same(failedGaps, [250, 1250]) && failed.body.whop.requests === 1 + 5 + 1,
     'after a failed read the next member still waits: 250 ms after a 500, 1,250 after the 5 pages of a read that never ends', show(failedGaps))
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

console.log('\n=== A Whop read still unanswered 285 s into a call: the call answers anyway, before Vercel\'s 300 s ===')
{
  /** Whop answers member `n` after `ms` on the suite's clock. */
  const slow = (n, ms) => async () => { await wait(ms); return pageOf([opened(W(n), 'lesn_TEST01', '2026-10-18T10:00:00.000Z')]) }
  // 77's read ends 239 s into the call, so 78 is started inside the budget;
  // Whop then takes 90 s to answer for 78.
  onWhop = { [W(77)]: slow(77, 239_000), [W(78)]: slow(78, 90_000), [W(79)]: [] }
  const db = freshDb({ members: [77, 78, 79].map((n) => member(n)) })
  const r = await call({ mode: 'write' })
  const t = r.body.this_call
  ok(r.status === 200 && r.body.ok === true && t.stopped_because === 'time budget' && t.duration_ms === 285_000 && t.next_after === `0:${sid(77)}` && t.remaining === 2,
     'a member started at 239 s whose read takes 90 s: the call gives the read up at 285 s and answers, with the cursor before that member', show(t))
  ok(rowOf(db, 77, 'a1l01') && same(r.body.changes.inserted.map((x) => x[1]), [sid(77)]) && rowsOf(db, 78).length === 0 && !syncOf(db, 78),
     'the member before it is written and in the change log; nothing of that member is written, the sync row included')
  ok(!usersAsked().includes(W(79)) && r.body.whop.requests === 2 && r.body.students.failed === 0 && logged.some((l) => l.includes('no Whop answer 285 s into the call')),
     'no one after it is asked, it counts as no failure, and the log says why the call ended', show(r.body.whop))
  // The read given up on is never answered.
  timers = []
  onWhop[W(78)] = slow(78, 1_000)
  const next = await call({ mode: 'write', after: t.next_after })
  ok(next.body.ok === true && next.body.this_call.remaining === 0 && rowOf(db, 78, 'a1l01') && syncOf(db, 78),
     'the next call, from that cursor, takes that member first and writes them', show(next.body.this_call))

  // The limit is no tighter than it has to be.
  onWhop = { [W(77)]: slow(77, 239_000), [W(78)]: slow(78, 45_000) }
  const kept = freshDb({ members: [77, 78].map((n) => member(n)) })
  const k = await call({ mode: 'write' })
  ok(k.body.ok === true && k.body.this_call.stopped_because === 'done' && k.body.this_call.duration_ms === 284_000 && rowOf(kept, 78, 'a1l01'),
     'a read that answers 284 s into the call is waited for, and its member written', show(k.body.this_call))
  ok(timers.length === 0, 'and once the call has answered, none of its timers is left running', String(timers.length))
}

console.log('\n=== The action items finished with Done alone: both halves from Whop, the action half alone, the undo ===')
{
  // The four of AI Ads + Content (isDoneOnly, 2026-10-22) and a5l23, the
  // Static Ad Brief, an action item that keeps its Discord link, beside the
  // course's lessons. Every Whop id and link here is made up.
  const lessons = [...LESSONS,
    ...[['a6l03', '03'], ['a6l10', '10'], ['a6l17', '17'], ['a6l19', '19']].map(([id, n]) => ({ id, whop_lesson_id: `lesn_TESTa6${n}`, requires_action: true })),
    { id: 'a5l23', whop_lesson_id: 'lesn_TESTa523', requires_action: true }]
  const [K, L] = [11, 12]
  const LINK = 'https://discord.com/channels/1100000000000000001/1200000000000000002/1300000000000000003'
  const setup = () => {
    onWhop = {
      [W(K)]: [opened(W(K), 'lesn_TESTa603', '2026-10-18T09:00:00.000Z'), opened(W(K), 'lesn_TESTa610', '2026-10-17T09:00:00.000Z'),
        opened(W(K), 'lesn_TESTa617', '2026-10-16T09:00:00.000Z'), opened(W(K), 'lesn_TESTa619', '2026-10-15T09:00:00.000Z'),
        opened(W(K), 'lesn_TESTa523', '2026-10-14T09:00:00.000Z')],
      // Whop gives no time: the run's clock.
      [W(L)]: [opened(W(L), 'lesn_TESTa603', null)],
    }
    return freshDb({
      lessons,
      members: [member(K), member(L)],
      completions: [
        // A link saved before 2026-10-22, the lesson not finished.
        { id: 'row-k10', student_id: sid(K), lesson_id: 'a6l10', completed_at: null, action_completed_at: null, discord_message_link: LINK },
        // A login brought the watch half in before 2026-10-22, at its own time.
        { id: 'row-k17', student_id: sid(K), lesson_id: 'a6l17', completed_at: '2026-10-19T18:00:00.000Z', action_completed_at: null },
        // Done in the app.
        { id: 'row-k19', student_id: sid(K), lesson_id: 'a6l19', completed_at: '2026-10-19T18:30:00.000Z', action_completed_at: '2026-10-19T18:30:00.000Z' },
      ],
    })
  }
  let db = setup()
  let r = await call({ mode: 'dry' })
  ok(r.status === 200 && r.body.ok === true && writes(db).length === 0 &&
     same(r.body.rows, { would_insert: 3, would_promote: 1, would_finish_actions: 4, not_in_course: 0, time_missing: 1, time_later_than_run: 0, earliest_day: '2026-10-14', latest_day: '2026-10-20' }),
     'dry: 3 rows to add, 1 to finish, 4 action halves (a6l03 for both members, a6l10 finished, a6l17 alone), nothing written', show(r.body.rows))

  const before = (await call({ mode: 'snapshot' })).body.student_lesson_completions
  r = await call({ mode: 'write' })
  const w = r.body
  const k = (lesson) => rowOf(db, K, lesson)
  ok(w.ok === true && w.rows.inserted === 3 && w.rows.promoted === 1 && w.rows.actions_finished === 4 && w.streak_ticked === 0 && steps.length === 0,
     'write: the same counts; no streak day (none was opened today) and no step', show({ rows: w.rows, steps }))
  ok(k('a6l03')?.completed_at === '2026-10-18T09:00:00.000Z' && k('a6l03').action_completed_at === '2026-10-18T09:00:00.000Z' && k('a6l03').completed_at_real === true,
     'a6l03 with no row: added with both halves at Whop\'s time, marked as its real finish', show(k('a6l03')))
  ok(k('a6l10').completed_at === '2026-10-17T09:00:00.000Z' && k('a6l10').action_completed_at === '2026-10-17T09:00:00.000Z' && k('a6l10').discord_message_link === LINK,
     'a6l10 with a link saved before: finished with both halves at Whop\'s time, the link kept', show(k('a6l10')))
  ok(k('a6l17').completed_at === '2026-10-19T18:00:00.000Z' && k('a6l17').action_completed_at === '2026-10-16T09:00:00.000Z',
     'a6l17 with the watch half alone: the action half at Whop\'s time, the watch half keeps the login\'s', show(k('a6l17')))
  ok(k('a6l19').completed_at === '2026-10-19T18:30:00.000Z' && k('a6l19').action_completed_at === '2026-10-19T18:30:00.000Z',
     'a6l19, done in the app: untouched', show(k('a6l19')))
  ok(k('a5l23')?.completed_at === '2026-10-14T09:00:00.000Z' && k('a5l23').action_completed_at === null,
     'a5l23, an action item that keeps its link: the watch half only, as before', show(k('a5l23')))
  const l03 = rowOf(db, L, 'a6l03')
  ok(l03?.completed_at === l03?.action_completed_at && l03.completed_at > NOW && l03.completed_at_real !== true,
     'Whop gave no time: both halves at the run\'s clock, not marked as a real finish', show(l03))
  const lesson = (id) => ({ id, requires_action: true })
  ok(['a6l03', 'a6l10', 'a6l17', 'a6l19'].every((id) => isLessonComplete({ lesson_id: id, skipped_at: null, ...k(id) }, lesson(id))) &&
     !isLessonComplete({ lesson_id: 'a5l23', skipped_at: null, ...k('a5l23') }, lesson('a5l23')),
     'each of the four is done by isLessonComplete; a5l23 still waits for its link and its button')
  const real = (row) => ({ ...row, completed_at_real: row.completed_at_real === true })
  ok(finishedAt(real(k('a6l03')), true) === Date.parse('2026-10-18T09:00:00.000Z') && finishedAt(real(k('a6l17')), true) === null,
     'Triple Threat: a6l03 counts on the day Whop gives, a6l17 (the login\'s time on its watch half) on no day', show([finishedAt(real(k('a6l03')), true), finishedAt(real(k('a6l17')), true)]))
  ok(same(w.changes.actions_finished, [[k('a6l03').id, '2026-10-18T09:00:00.000Z'], ['row-k10', '2026-10-17T09:00:00.000Z'], ['row-k17', '2026-10-16T09:00:00.000Z'], [l03.id, l03.action_completed_at]]),
     'the change log lists every action half it wrote: [row id, action_completed_at]', show(w.changes.actions_finished))

  steps.length = 0
  const kept = show(db.rows('student_lesson_completions'))
  r = await call({ mode: 'write' })
  ok(r.body.ok === true && same(r.body.changes, { inserted: [], promoted: [], actions_finished: [], streak_ticked: [] }) && r.body.rows.actions_finished === 0 &&
     show(db.rows('student_lesson_completions')) === kept && steps.length === 0,
     'a second pass writes nothing', show(r.body.rows))

  // The undo (whop_catchup.md 7.9, with the action halves): delete the rows
  // added, put the finished rows back, and clear each action half the run
  // wrote where it still holds the run's value. The rows are then the snapshot.
  const table = db.rows('student_lesson_completions')
  for (const [id, at] of w.changes.actions_finished) {
    const x = table.find((y) => y.id === id)
    if (x && x.action_completed_at === at) x.action_completed_at = null
  }
  for (const [id, skippedAt, at] of w.changes.promoted) {
    const x = table.find((y) => y.id === id)
    if (x && x.completed_at === at) Object.assign(x, { completed_at: null, skipped_at: skippedAt })
  }
  const addedIds = new Set(w.changes.inserted.map(([id]) => id))
  db.tables.student_lesson_completions = table.filter((x) => !addedIds.has(x.id))
  const asSnapshot = db.rows('student_lesson_completions').map((x) => show(before.columns.map((c) => x[c] ?? null))).sort()
  ok(same(asSnapshot, before.rows.map(show).sort()), 'the change log is enough to undo it: after the undo every row is as the snapshot holds it', show(asSnapshot))

  // The action half alone fails to write: the member is failed (its sync row
  // left), and the next pass writes it.
  db = setup()
  db.failWhen = (q) => (q.table === 'student_lesson_completions' && q.op === 'update' && q.values &&
    'action_completed_at' in q.values && !('completed_at' in q.values) ? { message: 'connection reset' } : null)
  r = await call({ mode: 'write' })
  ok(r.body.ok === true && r.body.database.failed.write_failed === 1 && !syncOf(db, K) && rowOf(db, K, 'a6l17').action_completed_at === null && syncOf(db, L),
     'that write failing: write_failed for that member, no sync row for them, the half not written; the other member is written', show(r.body.database))
  db.failWhen = null
  r = await call({ mode: 'write' })
  ok(r.body.ok === true && r.body.rows.actions_finished === 1 && rowOf(db, K, 'a6l17').action_completed_at === '2026-10-16T09:00:00.000Z' && syncOf(db, K),
     'and the next pass writes it, with the member\'s sync row', show(r.body.rows))
  ok(r.body.rows.inserted === 0 && r.body.students.got_rows === 0 && r.body.students.already_all_in_app === 2 && r.body.streak_ticked === 0,
     'an action half written alone adds no row: no member got rows, both already had every lesson, no streak day', show(r.body.students))
}

console.log('\n=== The two with a video (The Backbone, Imitation): a Done pressed first is kept, the video\'s half only from Whop ===')
{
  // a5l08 and a5l12, Done-only since the owner's answer of 2026-10-22, have a
  // video: in the app Done is their action half alone, so a row can hold the
  // action half and no watch half. a5l23 beside them keeps its link. Every
  // Whop id and link here is made up.
  const lessons = [...LESSONS,
    { id: 'a5l08', whop_lesson_id: 'lesn_TESTa508', requires_action: true },
    { id: 'a5l12', whop_lesson_id: 'lesn_TESTa512', requires_action: true },
    { id: 'a5l23', whop_lesson_id: 'lesn_TESTa523', requires_action: true }]
  const [M, N] = [13, 14]
  const LINK = 'https://discord.com/channels/1100000000000000001/1200000000000000002/1300000000000000003'
  const PRESSED = '2026-10-19T20:00:00.000Z'
  const setup = () => {
    onWhop = {
      // M finished all three on Whop.
      [W(M)]: [opened(W(M), 'lesn_TESTa508', '2026-10-13T09:00:00.000Z'), opened(W(M), 'lesn_TESTa512', '2026-10-12T09:00:00.000Z'),
        opened(W(M), 'lesn_TESTa523', '2026-10-11T09:00:00.000Z')],
      // N finished lesson 1 there, and not a5l08.
      [W(N)]: [opened(W(N), 'lesn_TEST01', '2026-10-13T09:00:00.000Z')],
    }
    return freshDb({
      lessons,
      members: [member(M), member(N)],
      completions: [
        // Done pressed in the app before the video was watched.
        { id: 'row-m08', student_id: sid(M), lesson_id: 'a5l08', completed_at: null, action_completed_at: PRESSED },
        // The Discord kind, handed in before its video.
        { id: 'row-m23', student_id: sid(M), lesson_id: 'a5l23', completed_at: null, action_completed_at: PRESSED, discord_message_link: LINK },
        { id: 'row-n08', student_id: sid(N), lesson_id: 'a5l08', completed_at: null, action_completed_at: PRESSED },
      ],
    })
  }
  let db = setup()
  let r = await call({ mode: 'dry' })
  ok(r.body.ok === true && writes(db).length === 0 && r.body.rows.would_insert === 2 && r.body.rows.would_promote === 2 && r.body.rows.would_finish_actions === 1,
     'dry: 2 rows to add (M\'s a5l12, N\'s lesson 1), 2 to finish (M\'s a5l08 and a5l23), 1 action half (a5l12\'s): none where the student pressed Done', show(r.body.rows))
  const before = (await call({ mode: 'snapshot' })).body.student_lesson_completions
  r = await call({ mode: 'write' })
  const w = r.body
  const m = (lesson) => rowOf(db, M, lesson)
  ok(w.ok === true && w.rows.inserted === 2 && w.rows.promoted === 2 && w.rows.actions_finished === 1, 'write: the same counts', show(w.rows))
  ok(m('a5l08').completed_at === '2026-10-13T09:00:00.000Z' && m('a5l08').action_completed_at === PRESSED &&
     isLessonComplete({ lesson_id: 'a5l08', skipped_at: null, ...m('a5l08') }, { id: 'a5l08', requires_action: true }),
     'a5l08 with Done pressed: its watch half at Whop\'s time, the student\'s Done kept at its own, so it is done', show(m('a5l08')))
  ok(m('a5l12')?.completed_at === '2026-10-12T09:00:00.000Z' && m('a5l12').action_completed_at === '2026-10-12T09:00:00.000Z',
     'a5l12 with no row: added with both halves at Whop\'s time, as the four of AI Ads + Content are', show(m('a5l12')))
  ok(m('a5l23').completed_at === '2026-10-11T09:00:00.000Z' && m('a5l23').action_completed_at === PRESSED && m('a5l23').discord_message_link === LINK,
     'a5l23, the Discord kind handed in first: its watch half, its action half kept, as before', show(m('a5l23')))
  ok(rowOf(db, N, 'a5l08').completed_at === null && rowOf(db, N, 'a5l08').action_completed_at === PRESSED && !!rowOf(db, N, 'a1l01'),
     'N, whom Whop lists with lesson 1 and not a5l08: a5l08 keeps its Done and gets no watch half (the video\'s half comes only from what Whop reports for that lesson)', show(rowOf(db, N, 'a5l08')))
  ok(same(w.changes.actions_finished, [[m('a5l12').id, '2026-10-12T09:00:00.000Z']]) && w.changes.promoted.some(([id]) => id === 'row-m08'),
     'the change log: a5l08 among the rows finished, and in actions_finished only the half the run wrote (a5l12\'s), never the student\'s Done', show(w.changes))
  // The undo, as in the section above: the rows are then the snapshot, the student's Done included.
  const table = db.rows('student_lesson_completions')
  for (const [id, at] of w.changes.actions_finished) {
    const x = table.find((y) => y.id === id)
    if (x && x.action_completed_at === at) x.action_completed_at = null
  }
  for (const [id, skippedAt, at] of w.changes.promoted) {
    const x = table.find((y) => y.id === id)
    if (x && x.completed_at === at) Object.assign(x, { completed_at: null, skipped_at: skippedAt })
  }
  const addedIds = new Set(w.changes.inserted.map(([id]) => id))
  db.tables.student_lesson_completions = table.filter((x) => !addedIds.has(x.id))
  const asSnapshot = db.rows('student_lesson_completions').map((x) => show(before.columns.map((c) => x[c] ?? null))).sort()
  ok(same(asSnapshot, before.rows.map(show).sort()) && rowOf(db, M, 'a5l08').action_completed_at === PRESSED,
     'the undo from the change log puts every row back as the snapshot holds it, the student\'s Done on a5l08 still there', show(asSnapshot))

  // The student presses Done on a5l12 between the run's read and its write
  // (a row with a link saved and no halves): the finish, which would carry the
  // action half, matches nothing, and the next pass finishes the watch half alone.
  db = setup()
  db.rows('student_lesson_completions').push({ id: 'row-m12', student_id: sid(M), lesson_id: 'a5l12', completed_at: null, action_completed_at: null, skipped_at: null, discord_message_link: LINK })
  const LATE_PRESS = '2026-10-20T06:59:00.000Z'
  db.failWhen = (q) => {
    if (q.table === 'student_lesson_completions' && q.op === 'update' && q.filters.includes('id=row-m12')) {
      const x = db.rows('student_lesson_completions').find((y) => y.id === 'row-m12')
      if (x.action_completed_at === null) x.action_completed_at = LATE_PRESS
    }
    return null
  }
  r = await call({ mode: 'write' })
  ok(r.body.ok === true && rowOf(db, M, 'a5l12').action_completed_at === LATE_PRESS && rowOf(db, M, 'a5l12').completed_at === null &&
     !r.body.changes.promoted.some(([id]) => id === 'row-m12') && !r.body.changes.actions_finished.some(([id]) => id === 'row-m12'),
     'a Done pressed between the run\'s read and its write: nothing is written over it, and the row is left out of the change log', show(rowOf(db, M, 'a5l12')))
  db.failWhen = null
  r = await call({ mode: 'write' })
  ok(r.body.ok === true && rowOf(db, M, 'a5l12').completed_at === '2026-10-12T09:00:00.000Z' && rowOf(db, M, 'a5l12').action_completed_at === LATE_PRESS &&
     same(r.body.changes.actions_finished, []) && same(r.body.changes.promoted.map(([id]) => id), ['row-m12']),
     'the next pass finishes its watch half alone at Whop\'s time, the Done kept', show(rowOf(db, M, 'a5l12')))
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
  ok(same(s.student_lesson_completions.columns, ['id', 'student_id', 'lesson_id', 'completed_at', 'skipped_at', 'action_completed_at']) &&
     s.student_lesson_completions.rows.some((x) => same(x, ['row-b4', sid(B), 'a1l04', null, '2026-10-19T20:00:00.000Z', null])),
     'completions: the columns the run writes, the action half included, as compact arrays (never the Discord link)', show(s.student_lesson_completions.rows))
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
globalThis.clearTimeout = realClearTimeout
globalThis.fetch = realFetch
ok(Date === RealDate && globalThis.setTimeout === realSetTimeout && globalThis.clearTimeout === realClearTimeout && globalThis.fetch === realFetch,
   'the clock, the timers and fetch are the real ones again')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
