// admin-today-routes.test.mjs: the admin rebuild's routes through their own
// handlers (admin rebuild PRD, _admin/prds/admin-rebuild/admin_rebuild_prd.md
// in the workspace). Work item 3 made this harness and its first route,
// GET /api/admin/thirty (the 30% page's list); work item 4 adds Today's:
// GET /api/admin/today, and POST and DELETE /api/admin/today/mark (a mark,
// the queue task it closes, a double click, Undo and its refusals).
//
// The login is the REAL team check (src/lib/admin-auth.ts, copied by
// build.mjs), not stub-server.ts's stand-in that answers "founder" to
// everyone: the bearer token is looked up in the stand-in database's users,
// the member in its team_members, so a call with no token, a student's
// token or a team member's gets the 401, 403 or 200 it would get on Vercel.
// The database holds a founder, two csm members and a student who can sign
// in, all made up, with a token each.
//
// The route's list is the real loader and builder (thirty-data.ts,
// thirty-view.ts) on the real course (course_catalog.json, a video for each
// lesson the development page has a length for: 61 up to the checkpoint, as
// on production). thirty-view.test.mjs proves the list itself, fixture by
// fixture; here the route has to hand back exactly what the builder makes,
// to the right people, and fail in plain words.
import fs from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'
import * as thirtyRoute from './_gen/admin-thirty-route.ts'
import * as todayRoute from './_gen/admin-today-route.ts'
import * as markRoute from './_gen/admin-today-mark-route.ts'
import { loadTodayData } from './_gen/today-data.ts'
import { SUPPORT_SCENARIO, buildSupportRows } from './_gen/support-list.ts'
import { loadThirtyData } from './_gen/thirty-data.ts'
import { VERDICT_TEXT, buildThirtyView, thirtyReasonText } from './_gen/thirty-view.ts'
import { requiredLessons } from './_gen/discount.ts'
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
import { FakeDb, NextRequest, fakeClient, setCatalog, useDb as installDb } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

/** Runs `fn` with the routes' log lines kept off the test's output. */
async function hush(fn) {
  const real = [console.info, console.warn, console.error]
  console.info = console.warn = console.error = () => {}
  try { return await fn() } finally { [console.info, console.warn, console.error] = real }
}

const RealDate = Date
/** Runs `fn` with the clock at `iso`: `new Date()` and `Date.now()` answer it, a date made from a value is as ever. */
async function at(iso, fn) {
  const t = RealDate.parse(iso)
  class Clock extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(t)
      else super(...args)
    }
    static now() { return t }
  }
  globalThis.Date = Clock
  try { return await fn() } finally { globalThis.Date = RealDate }
}

/** Words the team never reads (the PRD's rule for every sentence a page shows). */
const BANNED = [/—/, /\bunlock/i, /ecomtalent/i]
const plain = (s) => typeof s === 'string' && s.trim().length > 0 && BANNED.every((re) => !re.test(s))
/** Every error sentence a route answered in this file, checked against BANNED at the end. */
const errorSentences = []

// ── The course, as the switch left it ──────────────────────────────────────
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const json = (rel) => JSON.parse(fs.readFileSync(here(rel), 'utf8'))
const catalog = json('../supabase/catalog/course_catalog.json')
const lengths = json('../src/app/dev/world-app/course-lengths.fixture.json')
const LESSONS = catalog.lessons.map((l, i) => ({
  id: l.id, region_id: l.area, type: l.type, title: l.title, sort_order: i + 1,
  requires_action: l.action_brief !== undefined, counts_toward_progress: l.counts !== false,
  is_gate: l.gate === true, duration_seconds: lengths[l.id] ?? null,
}))
const REQUIRED = requiredLessons(LESSONS.map((l) => ({ ...l, has_video: l.id in lengths }))).map((l) => l.id)

const RESET = '2026-10-19T14:33:00.000Z'
const LOADED = '2026-10-19T10:00:00.000Z'
const FROM_WHOP = '2026-10-19T16:00:00.000Z'
const NOW = '2026-10-21T09:00:00.000Z' // Wed 21 Oct, 11:00 in Croatia
const MONTHLY = 'plan_4ZrwR4PmBsVsx'

// ── The people: a founder, two csm members, a student who can sign in ──────
const TEAM = [
  { id: 'tm-founder', email: 'founder@example.com', full_name: 'Jamie Rowe', role: 'founder' },
  { id: 'tm-csm-1', email: 'csm1@example.com', full_name: 'Robin Hale', role: 'csm' },
  { id: 'tm-csm-2', email: 'csm2@example.com', full_name: 'Sam Rivers', role: 'csm' },
]
const TOKENS = {
  'tok-founder': 'tm-founder',
  'tok-csm-1': 'tm-csm-1',
  'tok-csm-2': 'tm-csm-2',
  // A real login, but a student's: no team_members row.
  'tok-student': 'auth-student',
}

function freshDb() {
  setCatalog({ v2: true, lessonsTable: 'lessons' })
  const person = (id, name, paid, more = {}) => ({
    id, name, email: `${id}@example.com`, whop_user_id: `user_${id}`, whop_plan_id: MONTHLY,
    membership_status: 'active', first_paid_at: paid, joined_at: paid, ...more,
  })
  const done = (student, ids) => ids.map((lesson_id) => ({ student_id: student, lesson_id, completed_at: FROM_WHOP }))
  const db = new FakeDb({
    team_members: TEAM,
    admin_config: [{ key: 'curriculum_reset_at', value: RESET }],
    lessons: LESSONS,
    // The Tella id is on the row; the route must never send it.
    lesson_videos: Object.keys(lengths).map((lesson_id) => ({ lesson_id, created_at: LOADED, tella_video_id: `tella-${lesson_id}` })),
    students: [
      // Every video done, a request waiting, the ads never ticked: Approve would approve it
      // (no ads check since 2026-10-20, Lovro's decision).
      person('s-yes', 'Ana Example', '2026-10-02T10:00:00.000Z', {
        ad_submissions_verified: false, discord_user_id: '100000000000000001', discord_username: 'ana.example',
      }),
      // 50 of the videos, no request: can still earn it.
      person('s-earn', 'Bo Example', '2026-10-03T10:00:00.000Z', { discord_username: 'bo.example' }),
      // A first payment before 1 October, a request waiting.
      person('s-old', 'Ed Example', '2026-09-20T10:00:00.000Z'),
      // The student who signs in: nothing watched yet.
      person('s-student', 'Stu Example', '2026-10-05T10:00:00.000Z', { supabase_user_id: 'auth-student' }),
    ],
    student_lesson_completions: [...done('s-yes', REQUIRED), ...done('s-earn', REQUIRED.slice(0, 50))],
    discount_requests: [
      { id: 'r-yes', student_id: 's-yes', status: 'pending', created_at: '2026-10-20T10:00:00.000Z', promo_code: null, rejection_reason: null },
      { id: 'r-old', student_id: 's-old', status: 'pending', created_at: '2026-10-20T11:00:00.000Z', promo_code: null, rejection_reason: null },
    ],
    discount_feedback_questions: [{ id: 'q1', order_num: 1, question_text: 'How likely are you to recommend the course?', question_type: 'scale' }],
    discount_feedback_responses: [{ id: 'a1', discount_request_id: 'r-yes', question_id: 'q1', answer_scale: 9 }],
    tasks: [{
      id: 't1', student_id: 's-earn', scenario_id: 'nolessons.day3', status: 'completed',
      created_at: '2026-10-20T08:00:00.000Z', completed_at: '2026-10-20T09:00:00.000Z', completed_by: 'tm-csm-1', outcome: null,
    }],
    student_whop_sync: [
      { student_id: 's-yes', last_sync_at: FROM_WHOP },
      // Bo's last Whop backfill ran the day before the switch: "Whop progress not pulled yet" (C14).
      { student_id: 's-earn', last_sync_at: '2026-10-18T10:00:00.000Z' },
    ],
  }, TOKENS)
  installDb(db)
  return db
}

/** GET /api/admin/thirty through the route's own handler, as `token` (or with no Authorization header). */
async function getThirty(token) {
  const headers = token === undefined ? {} : { authorization: `Bearer ${token}` }
  const res = await hush(() => thirtyRoute.GET(new NextRequest('http://localhost/api/admin/thirty', { headers })))
  const body = await res.json()
  if (res.status >= 400) errorSentences.push(body?.error)
  return { status: res.status, body }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== GET /api/admin/thirty: who may read it ===')
{
  freshDb()
  const none = await at(NOW, () => getThirty(undefined))
  ok(none.status === 401 && typeof none.body.error === 'string', 'no token: 401', show(none))
  ok(none.body.requests === undefined && none.body.canStillEarn === undefined, 'and no list in the answer')

  const unknown = await at(NOW, () => getThirty('tok-nobody'))
  ok(unknown.status === 401, 'a token nobody holds: 401', show(unknown))

  const student = await at(NOW, () => getThirty('tok-student'))
  ok(student.status === 403 && student.body.requests === undefined, 'a student signed in: 403, and no list', show(student))

  for (const [token, who] of [['tok-csm-1', 'a csm'], ['tok-csm-2', 'the other csm'], ['tok-founder', 'a founder']]) {
    const r = await at(NOW, () => getThirty(token))
    ok(r.status === 200 && Array.isArray(r.body.requests) && Array.isArray(r.body.canStillEarn), `${who}: 200 with the list`, `status ${r.status}`)
  }
}

console.log('\n=== The answer is the builder\'s, at the same moment ===')
{
  const db = freshDb()
  const r = await at(NOW, () => getThirty('tok-csm-1'))
  const body = r.body
  ok(r.status === 200, 'as a csm: 200')
  ok(['generatedAt', 'sharedDeadline', 'requiredCount', 'questions', 'requests', 'canStillEarn', 'unchecked'].every((k) => k in body),
     'section 8\'s fields are all there', Object.keys(body).join(', '))
  ok(body.generatedAt === NOW, 'generatedAt is the moment of the call', body.generatedAt)
  ok(body.requiredCount === 61, 'the 61 videos up to the checkpoint', String(body.requiredCount))

  const yes = body.requests.find((x) => x.id === 'r-yes')
  ok(yes?.verdict?.ok === true && yes.verdict.text === VERDICT_TEXT.yes, 'every video done, the ads never ticked: the verdict says yes', show(yes?.verdict))
  ok(yes?.facts.videosDone === 61 && yes?.facts.videosTotal === 61, 'with its count, 61 of 61', `${yes?.facts.videosDone} of ${yes?.facts.videosTotal}`)
  ok(yes?.student.discord.userId === '100000000000000001' && yes?.student.plan === 'Monthly' && yes !== undefined && !('adsVerified' in yes.student),
     'the student brief: Discord id, plan, and no ads tick (2026-10-20)', show(yes?.student))
  ok(isDeepStrictEqual(yes?.answers, [{ questionId: 'q1', answer: 9 }]), 'the survey answer is on the row', show(yes?.answers))
  const old = body.requests.find((x) => x.id === 'r-old')
  ok(old?.verdict?.ok === false && old.verdict.reason === 'before-launch', 'a first payment before 1 October: the verdict says no, and why', show(old?.verdict))

  const earn = body.canStillEarn.map((e) => e.student.id)
  ok(earn.includes('s-earn') && earn.includes('s-student') && !earn.includes('s-yes') && !earn.includes('s-old'),
     'Can still earn: the two members still in time, neither the one who asked nor the one before 1 October', earn.join(', '))
  const bo = body.canStillEarn.find((e) => e.student.id === 's-earn')
  ok(bo?.state === 'locked' && bo.facts.videosDone === 50 && bo.lastContact?.by?.name === 'Robin Hale',
     'with the count and the last message the team marked sent', show({ state: bo?.state, done: bo?.facts.videosDone, last: bo?.lastContact }))
  ok(bo?.student.whopPulled === false && yes?.student.whopPulled === true,
     'the switch is read from admin_config: a Whop backfill before it is "not pulled yet", one after it is', show({ bo: bo?.student.whopPulled, ana: yes?.student.whopPulled }))

  // The route's answer, against loadThirtyData and buildThirtyView run on the same database at the same moment.
  const load = await at(NOW, () => loadThirtyData(fakeClient(db)))
  const built = load.ok ? JSON.parse(JSON.stringify(buildThirtyView(load.data, new RealDate(NOW), RESET))) : null
  ok(isDeepStrictEqual(body, built), 'the answer is exactly buildThirtyView over loadThirtyData, with the switch from admin_config')

  ok(!JSON.stringify(body).toLowerCase().includes('tella'), 'no Tella id anywhere in the answer')
}

console.log('\n=== It reads and never writes ===')
{
  const db = freshDb()
  await at(NOW, () => getThirty('tok-csm-1'))
  const writes = db.log.filter((q) => q.op !== 'select')
  ok(writes.length === 0, 'no insert, update, upsert, delete or rpc', show(writes.map((q) => `${q.table}.${q.op}`)))
  const videoReads = db.calls('lesson_videos', 'select')
  ok(videoReads.length > 0, 'it reads lesson_videos with the service-role client requireTeam hands it')
}

console.log('\n=== A read that fails is an error in plain words, never a short list ===')
{
  const db = freshDb()
  db.fail['admin_config.select'] = { message: 'canceling statement due to statement timeout' }
  const r = await at(NOW, () => getThirty('tok-csm-1'))
  ok(r.status === 500 && r.body.requests === undefined, 'the course switch cannot be read: 500, and no list', show(r))
  ok(plain(r.body.error) && /course switch/.test(r.body.error) && !/statement timeout/.test(r.body.error),
     'the sentence names what failed, in the team\'s words, without the database\'s', r.body.error)
}
{
  const db = freshDb()
  db.fail['discount_feedback_questions.select'] = { message: 'permission denied for table discount_feedback_questions' }
  const r = await at(NOW, () => getThirty('tok-csm-1'))
  ok(r.status === 500 && r.body.requests === undefined, 'a read the whole list needs fails: 500, and no list', show(r.body.error))
  ok(plain(r.body.error), 'in plain words', r.body.error)
  ok(Array.isArray(r.body.failed) && r.body.failed.some((f) => f.startsWith('discount_feedback_questions')),
     'with the failed read named for whoever looks into it', show(r.body.failed))
}
{
  // One student's progress cannot be read: the list still comes, and that student's verdict says so.
  const db = freshDb()
  db.failWhen = (q) => q.table === 'student_lesson_completions' ? { message: 'canceling statement due to statement timeout' } : null
  const r = await at(NOW, () => getThirty('tok-csm-1'))
  const yes = r.body.requests?.find((x) => x.id === 'r-yes')
  ok(r.status === 200 && yes?.verdict?.reason === 'read-failed' && yes.verdict.text === VERDICT_TEXT.readFailed,
     'the completions read fails: 200, and the pending row says there is no verdict', show(yes?.verdict))
  // The three members in the offer (one of them holds the pending request, which only their reads could show).
  ok(r.body.canStillEarn?.length === 0 && r.body.unchecked === 3,
     'nobody is put on Can still earn unchecked; the three who could be are counted instead', `canStillEarn ${r.body.canStillEarn?.length}, unchecked ${r.body.unchecked}`)
}

// ════════════════════════════════════════════════════════════════════════════
// TODAY (work item 4)
// ════════════════════════════════════════════════════════════════════════════

// Fri 23 Oct, 11:00 in Croatia: course day 4 for anyone who paid before the
// switch, 3 days and more since a lesson on the switch's evening, and the
// shared 30% deadline closing tonight.
const T_NOW = '2026-10-23T09:00:00.000Z'
const later = (minutes) => new Date(Date.parse(T_NOW) + minutes * 60_000).toISOString()
const YEARLY = 'plan_VFDntXQf9cYMo'

/**
 * Today's made-up database, on the same course and team as the 30% one:
 *   d-nostart  opened the app, no lesson, the queue's nolessons.day3 open
 *   d-stop     no lesson since the switch's evening, messaged on Wed 21 Oct
 *   d-cancel   clicked cancel yesterday (yearly), a welcome task open
 *   d-thirty   50 of the 61 videos, the shared deadline tonight
 *   d-task     only an open task in the queue (the welcome)
 *   d-other    another plan, stopped, no Whop backfill: the folded group
 *   never listed: d-exempt, d-canceled, d-nomember (all stopped)
 * `extra` adds that many more stopped members, to read past 1000 rows.
 */
function freshTodayDb({ extra = 0 } = {}) {
  setCatalog({ v2: true, lessonsTable: 'lessons' })
  const PAID = '2026-09-25T09:00:00.000Z'
  const member = (id, name, more = {}) => ({
    id, name, email: `${id}@example.com`, whop_user_id: `user_${id}`, whop_plan_id: MONTHLY, whop_membership_id: `mem_${id}`,
    membership_status: 'active', first_paid_at: PAID, joined_at: PAID, ...more,
  })
  const stopped = '2026-10-19T16:00:00.000Z'
  const recent = '2026-10-22T18:00:00.000Z'
  const ids = ['d-nostart', 'd-stop', 'd-cancel', 'd-thirty', 'd-task', 'd-other', 'd-exempt', 'd-canceled', 'd-nomember']
  const extras = Array.from({ length: extra }, (_, i) => `x-${String(i).padStart(4, '0')}`)
  const last = {
    'd-stop': stopped, 'd-cancel': recent, 'd-thirty': recent, 'd-task': recent, 'd-other': stopped,
    'd-exempt': stopped, 'd-canceled': stopped, 'd-nomember': stopped, ...Object.fromEntries(extras.map((x) => [x, stopped])),
  }
  const db = new FakeDb({
    team_members: TEAM,
    admin_config: [
      { key: 'curriculum_reset_at', value: RESET },
      { key: 'program_login_link', value: 'https://example.com/start' },
    ],
    lessons: LESSONS,
    lesson_videos: Object.keys(lengths).map((lesson_id) => ({ lesson_id, created_at: LOADED, tella_video_id: `tella-${lesson_id}` })),
    regions: [{ id: 'a1', name: 'First steps', order_num: 1 }, { id: 'a2', name: 'Ad basics', order_num: 2 }],
    students: [
      member('d-nostart', 'Dee Example', { discord_username: 'dee.example' }),
      member('d-stop', 'Rae Example', { discord_user_id: '100000000000000301' }),
      member('d-cancel', 'Cal Example', { whop_plan_id: YEARLY, cancel_scheduled_at: '2026-10-22T08:00:00.000Z' }),
      member('d-thirty', 'Tia Example', { first_paid_at: '2026-10-03T10:00:00.000Z', joined_at: '2026-10-03T10:00:00.000Z' }),
      member('d-task', 'Ty Example'),
      member('d-other', 'Oz Example', { whop_plan_id: 'plan_made_up_free' }),
      member('d-exempt', 'Ex Example', { csm_exempt: true }),
      member('d-canceled', 'Can Example', { membership_status: 'canceled' }),
      member('d-nomember', 'Nom Example', { whop_membership_id: null }),
      // The student who signs in (403 everywhere): no Whop membership, so never on the list either.
      { id: 's-student', name: 'Stu Example', email: 's-student@example.com', whop_user_id: 'user_s-student', supabase_user_id: 'auth-student', first_paid_at: PAID },
      ...extras.map((x) => member(x, `Extra ${x}`)),
    ],
    student_milestones: [...ids, ...extras].map((student_id) => ({ student_id, first_sprint_login_at: PAID })),
    student_progress_counts: Object.keys(last).map((student_id) => ({ student_id, completed_count: 3 })),
    student_last_counted_completion: Object.entries(last).map(([student_id, last_completed_at]) => ({ student_id, last_completed_at })),
    student_current_region: [{ student_id: 'd-stop', current_region: 'a1' }],
    // The tokens are on the row as on production: the route must never read them.
    student_whop_sync: [...ids, ...extras].filter((id) => id !== 'd-other').map((student_id) => ({
      student_id, last_sync_at: FROM_WHOP, access_token: `secret-access-${student_id}`, refresh_token: `secret-refresh-${student_id}`,
    })),
    // A heartbeat 4 days old holds nothing back (and is not even read).
    student_lesson_watch: [{ student_id: 'd-stop', lesson_id: REQUIRED[0], last_heartbeat_at: '2026-10-19T08:00:00.000Z' }],
    student_lesson_completions: REQUIRED.slice(0, 50).map((lesson_id) => ({ student_id: 'd-thirty', lesson_id, completed_at: FROM_WHOP })),
    templates: [
      { id: 'tpl-nl3', scenario_id: 'nolessons.day3', title: 'No lesson yet', body: 'Hi {firstName}, the first lesson is short. Start here: {programLink}', is_active: true },
      { id: 'tpl-welcome', scenario_id: 'welcome.day1', title: 'Welcome', body: 'Welcome, {firstName}!', is_active: true },
      { id: 'tpl-sup-cancel', scenario_id: 'support.cancel', title: 'Clicked cancel', body: 'Hey {firstName}, I saw you clicked cancel. Can I help?', is_active: true },
    ],
    tasks: [
      { id: 'q-dee', student_id: 'd-nostart', scenario_id: 'nolessons.day3', template_id: 'tpl-nl3', status: 'open',
        behavior_summary: 'Logged in, no lesson on the new course yet (Day 3)', created_at: '2026-10-22T10:15:00.000Z' },
      { id: 'q-cal', student_id: 'd-cancel', scenario_id: 'welcome.day1', template_id: 'tpl-welcome', status: 'open',
        behavior_summary: 'Welcome message', created_at: '2026-10-22T10:20:00.000Z' },
      { id: 'q-ty', student_id: 'd-task', scenario_id: 'welcome.day1', template_id: 'tpl-welcome', status: 'open',
        behavior_summary: 'Joined yesterday: send the welcome message', created_at: '2026-10-22T11:00:00.000Z' },
      { id: 'c-rae', student_id: 'd-stop', scenario_id: 'support.pastdue', template_id: null, status: 'completed',
        behavior_summary: 'Payment failed', created_at: '2026-10-21T08:00:00.000Z', completed_at: '2026-10-21T08:00:00.000Z', completed_by: 'tm-csm-2' },
      // Sent more than 30 days ago: not read.
      { id: 'c-old', student_id: 'd-stop', scenario_id: 'welcome.day1', template_id: 'tpl-welcome', status: 'completed',
        created_at: '2026-09-10T08:00:00.000Z', completed_at: '2026-09-10T08:00:00.000Z', completed_by: 'tm-founder' },
    ],
  }, TOKENS)
  installDb(db)
  return db
}

/** One call to a route's handler, as `token`; its log lines are the caller's to keep quiet (call() does). */
async function rawCall(route, method, path, token, body) {
  const headers = token === undefined ? {} : { authorization: `Bearer ${token}` }
  const init = { method, headers }
  if (body !== undefined) { init.body = JSON.stringify(body); headers['content-type'] = 'application/json' }
  const res = await route[method](new NextRequest(`http://localhost${path}`, init))
  const json = await res.json()
  if (res.status >= 400) errorSentences.push(json?.error)
  for (const r of json?.results ?? []) if (!r.ok) errorSentences.push(r.error)
  return { status: res.status, body: json }
}
const call = (route, method, path, token, body) => hush(() => rawCall(route, method, path, token, body))
/** Marks sent at once, as two tabs or a request sent again would: one hush around all of them. */
const marksAtOnce = (...sends) => hush(() => Promise.all(sends.map(([token, body]) => rawCall(markRoute, 'POST', '/api/admin/today/mark', token, body))))
const getToday = (token) => call(todayRoute, 'GET', '/api/admin/today', token)
const postMark = (token, body) => call(markRoute, 'POST', '/api/admin/today/mark', token, body)
const deleteMark = (token, body) => call(markRoute, 'DELETE', '/api/admin/today/mark', token, body)
const taskById = (db, id) => db.rows('tasks').find((t) => t.id === id)
const supportRows = (db, studentId) => db.rows('tasks').filter((t) => t.student_id === studentId && String(t.scenario_id).startsWith('support.'))
const tasksSnapshot = (db) => JSON.stringify(db.rows('tasks'))
const MARK_DEE = {
  studentId: 'd-nostart', action: 'messaged', headlineKind: 'not_started',
  reasonsText: 'No lesson on the new course yet (course day 4)', openTaskIds: ['q-dee'],
}

console.log('\n=== GET /api/admin/today: who may read it ===')
{
  freshTodayDb()
  const none = await at(T_NOW, () => getToday(undefined))
  ok(none.status === 401 && none.body.rows === undefined, 'no token: 401, and no list', show(none.body))
  ok((await at(T_NOW, () => getToday('tok-nobody'))).status === 401, 'a token nobody holds: 401')
  const student = await at(T_NOW, () => getToday('tok-student'))
  ok(student.status === 403 && student.body.rows === undefined, 'a student signed in: 403, and no list')
  for (const [token, who] of [['tok-csm-1', 'a csm'], ['tok-csm-2', 'the other csm'], ['tok-founder', 'a founder']]) {
    const r = await at(T_NOW, () => getToday(token))
    ok(r.status === 200 && Array.isArray(r.body.rows) && Array.isArray(r.body.handled), `${who}: 200 with the list`, `status ${r.status}`)
  }
}

console.log('\n=== The answer is the builder\'s over the loader, at the same moment, for the caller ===')
{
  const db = freshTodayDb()
  const r = await at(T_NOW, () => getToday('tok-csm-1'))
  const body = r.body
  ok(r.status === 200 && ['generatedAt', 'resetAt', 'lessonsTotal', 'rows', 'handled'].every((k) => k in body), 'section 8\'s fields', Object.keys(body).join(', '))
  ok(body.generatedAt === T_NOW && body.resetAt === RESET && body.lessonsTotal === 140,
     'the moment, the switch, and the 140 lessons that count (a head count, not a row read)', show({ g: body.generatedAt, l: body.lessonsTotal }))
  const load = await at(T_NOW, () => loadTodayData(fakeClient(db), new RealDate(T_NOW)))
  const built = load.ok ? JSON.parse(JSON.stringify(buildSupportRows({ ...load.data, callerId: 'tm-csm-1' }, new RealDate(T_NOW)))) : null
  ok(isDeepStrictEqual(body.rows, built?.rows) && isDeepStrictEqual(body.handled, built?.handled),
     'the rows and Handled are exactly buildSupportRows over loadTodayData, with the caller')

  const ids = body.rows.map((x) => x.studentId)
  // Most urgent first, the longest wait first, then by name: the two stopped rows wait 3 days each,
  // so Oz (the folded group's, which the page shows apart) comes before Rae.
  ok(isDeepStrictEqual(ids, ['d-cancel', 'd-thirty', 'd-other', 'd-stop', 'd-nostart', 'd-task']),
     'the members who need a message, most urgent first; exempt, canceled and membership-less ones left out', ids.join(', '))
  const row = (id) => body.rows.find((x) => x.studentId === id)
  ok(row('d-cancel').reasons[0].text === 'Clicked cancel 1 day ago' && row('d-cancel').plan === 'Yearly'
     && row('d-cancel').openTasks[0]?.id === 'q-cal' && row('d-cancel').openTasks[0].message === 'Welcome, Cal!',
     'Cancelling (yearly): with its open welcome task\'s message', show(row('d-cancel').reasons))
  ok(row('d-thirty').reasons[0].kind === 'thirty_closing' && row('d-thirty').reasons[0].text.startsWith('30% closes Fri 23 Oct, 23:59: 11 videos left (about ')
     && row('d-thirty').thirty?.videosDone === 50 && row('d-thirty').thirty?.videosTotal === 61,
     'the 30% closing tonight, from the student app\'s rule over lesson_videos', row('d-thirty').reasons[0].text)
  ok(row('d-stop').reasons[0].text === 'No lesson for 3 days' && row('d-stop').area?.name === 'First steps'
     && row('d-stop').lastContact?.by?.name === 'Sam Rivers' && row('d-stop').discord.userId === '100000000000000301',
     'Stopped, with the area, the last message (Sam\'s) and the Discord id', show(row('d-stop').lastContact))
  ok(row('d-nostart').reasons[0].text === 'No lesson on the new course yet (course day 4)'
     && row('d-nostart').openTasks[0]?.message === 'Hi Dee, the first lesson is short. Start here: https://example.com/start',
     'Not started, with the queue task\'s message filled in from admin_config')
  ok(row('d-task').reasons[0].kind === 'open_task' && row('d-task').reasons[0].text === 'Joined yesterday: send the welcome message', 'only an open task')
  ok(row('d-other').group === 'whop-not-pulled' && row('d-other').plan === 'Other plan' && row('d-other').whopPulled === false,
     'another plan, no Whop backfill: listed, in the folded group')
  ok(!JSON.stringify(body).includes('secret-') && !JSON.stringify(body).toLowerCase().includes('tella'), 'no Whop token and no Tella id in the answer')

  const writes = db.log.filter((q) => q.op !== 'select')
  ok(writes.length === 0, 'it reads and never writes', show(writes.map((q) => `${q.table}.${q.op}`)))
  const people = db.calls('students', 'select').find((q) => q.filters.some((f) => f.startsWith('membership_status in')))
  ok(people && people.filters.includes('membership_status in (active,past_due)') && people.filters.includes('whop_membership_id not is null')
     && people.filters.includes('csm_exempt=false'), 'C3 in the query: active or past due, a Whop membership, not exempt', show(people?.filters))
  const syncReads = db.calls('student_whop_sync', 'select')
  ok(syncReads.length > 0, 'it reads the Whop backfill dates')
  ok(db.calls('student_lesson_watch', 'select').every((q) => q.filters.some((f) => f.startsWith('last_heartbeat_at>=2026-10-20T09:00'))),
     'heartbeats from 3 days ago only', show(db.calls('student_lesson_watch', 'select').map((q) => q.filters)))
  // Today's own reads of closed tasks (the 30% loader's last-contact read, by student, is its own).
  const closedReads = db.calls('tasks', 'select').filter((q) =>
    q.filters.some((f) => f === 'status=completed' || f === 'status=dismissed') && !q.filters.some((f) => f.startsWith('student_id in')))
  ok(closedReads.some((q) => q.filters.includes('status=completed')) && closedReads.some((q) => q.filters.includes('status=dismissed'))
     && closedReads.every((q) => q.filters.some((f) => /^(completed|dismissed)_at>=2026-09-23T09:00/.test(f))),
     'completed and dismissed tasks from 30 days ago only', show(closedReads.map((q) => q.filters)))
}
{
  // The tokens: no read of student_whop_sync ever names them. The stand-in logs a select's
  // filters, not its columns, so the select is caught at the source: the route's reads go
  // through the builder's select(), wrapped here to record what it was asked for.
  const db = freshTodayDb()
  const asked = []
  const client = fakeClient(db)
  const from = client.from.bind(client)
  client.from = (table) => {
    const b = from(table)
    const select = b.select.bind(b)
    b.select = (cols, o) => { asked.push(`${table}: ${cols}`); return select(cols, o) }
    return b
  }
  await at(T_NOW, () => loadTodayData(client, new RealDate(T_NOW)))
  const sync = asked.filter((a) => a.startsWith('student_whop_sync'))
  ok(sync.length > 0 && sync.every((a) => a === 'student_whop_sync: student_id, last_sync_at'),
     'student_whop_sync is read for last_sync_at only, never its tokens', show(sync))
}

console.log('\n=== Past 1000 rows: every read is paged ===')
{
  freshTodayDb({ extra: 1100 })
  const r = await at(T_NOW, () => getToday('tok-csm-1'))
  const extras = r.body.rows?.filter((x) => x.studentId.startsWith('x-')) ?? []
  ok(r.status === 200 && extras.length === 1100 && extras.every((x) => x.reasons[0].kind === 'stopped'),
     '1,100 more stopped members (students, milestones, the views and the Whop dates all past 1000 rows): every one listed', `${extras.length}`)
}

console.log('\n=== A task reopened while the closed tasks are read: no other task is dropped ===')
{
  // 1,100 tasks sent in the last 30 days (two pages), then, while the second page is asked for,
  // one task of the first page is opened again (an Undo, say). Pages read by offset would shift
  // and skip a task of another student; pages read by key never do.
  const db = freshTodayDb()
  const sent = Array.from({ length: 1100 }, (_, i) => `t-${String(i).padStart(4, '0')}`)
  for (const [i, id] of sent.entries()) {
    db.rows('tasks').push({
      id, student_id: `gone-${i % 50}`, scenario_id: 'nolessons.day3', template_id: 'tpl-nl3', status: 'completed', behavior_summary: null,
      created_at: '2026-10-20T08:00:00.000Z', completed_at: '2026-10-20T09:00:00.000Z', completed_by: 'tm-csm-1',
      dismissed_at: null, dismissed_by: null, notes: null, outcome: null,
    })
  }
  let completedReads = 0
  db.failWhen = (q) => {
    if (q.table === 'tasks' && q.op === 'select' && q.filters.includes('status=completed') && !q.filters.some((f) => f.startsWith('student_id')) && ++completedReads === 2) {
      Object.assign(taskById(db, 't-0000'), { status: 'open', completed_at: null, completed_by: null })
    }
    return null
  }
  const load = await at(T_NOW, () => loadTodayData(fakeClient(db), new RealDate(T_NOW)))
  const read = new Set(load.ok ? load.data.tasks.map((t) => t.id) : [])
  const missing = sent.filter((id) => !read.has(id))
  ok(load.ok && completedReads === 2 && missing.length === 0,
     'every one of the 1,100 is read (the one reopened meanwhile as the first page saw it), none skipped', `missing ${missing.slice(0, 3).join(', ')}`)
}
{
  // Dee's queue task is sent from the Tasks page between the read of the open tasks and the read of
  // the completed ones: both reads hand it back. It counts once, as sent, so Today does not list her
  // with a task that is closed already (the second message pre-mortem 2 is about).
  const db = freshTodayDb()
  db.failWhen = (q) => {
    if (q.table === 'tasks' && q.op === 'select' && q.filters.includes('status=completed') && !q.filters.some((f) => f.startsWith('student_id'))) {
      Object.assign(taskById(db, 'q-dee'), { status: 'completed', completed_at: '2026-10-23T08:59:00.000Z', completed_by: 'tm-csm-2' })
    }
    return null
  }
  const r = await at(T_NOW, () => getToday('tok-csm-1'))
  const handled = r.body.handled?.filter((h) => h.taskId === 'q-dee') ?? []
  ok(r.status === 200 && !r.body.rows.some((x) => x.studentId === 'd-nostart') && handled.length === 1 && handled[0].status === 'completed',
     'a task closed between the reads is kept once, closed: the row is not listed with it as open, and Handled shows it once', show({ handled: handled.length }))
}

console.log('\n=== A read that fails is an error in plain words, never a short list ===')
{
  const db = freshTodayDb()
  db.fail['admin_config.select'] = { message: 'canceling statement due to statement timeout' }
  const r = await at(T_NOW, () => getToday('tok-csm-1'))
  ok(r.status === 500 && r.body.rows === undefined && /course switch/.test(r.body.error) && !/timeout/.test(r.body.error),
     'the course switch cannot be read: 500, a plain sentence, no list', r.body.error)
}
{
  const db = freshTodayDb()
  db.fail['student_milestones.select'] = { message: 'permission denied for table student_milestones' }
  const r = await at(T_NOW, () => getToday('tok-csm-1'))
  ok(r.status === 500 && r.body.rows === undefined && plain(r.body.error) && r.body.failed?.some((f) => f.startsWith('student_milestones')),
     'a read the list needs fails: 500, and the read named', show(r.body))
}
{
  const db = freshTodayDb()
  db.failWhen = (q) => (q.table === 'tasks' && q.filters.includes('status=open') ? { message: 'timeout' } : null)
  const r = await at(T_NOW, () => getToday('tok-csm-1'))
  ok(r.status === 500 && r.body.failed?.some((f) => f.startsWith('tasks (open)')), 'the open tasks cannot be read: 500, never a list without the queue', show(r.body.failed))
}
{
  // A member who can still earn the 30% (d-thirty) and whose progress cannot be read: no list without its 30% reasons.
  const db = freshTodayDb()
  db.failWhen = (q) => (q.table === 'student_lesson_completions' ? { message: 'canceling statement due to statement timeout' } : null)
  const r = await at(T_NOW, () => getToday('tok-csm-1'))
  ok(r.status === 500 && r.body.rows === undefined && r.body.failed?.some((f) => f.startsWith('30%')),
     'the 30% of a member who can earn it cannot be read: 500', show(r.body.failed))
}

console.log('\n=== POST /api/admin/today/mark: Mark messaged on a row with a computed headline and an open queue task ===')
{
  const db = freshTodayDb()
  const r = await at(T_NOW, () => postMark('tok-csm-1', { ...MARK_DEE, actor: 'tm-founder' }))
  ok(r.status === 201 && typeof r.body.supportId === 'string' && isDeepStrictEqual(r.body.movedIds, ['q-dee']) && r.body.at === T_NOW,
     '201 with the record, the queue task it closed and the moment', show(r.body))
  const recs = supportRows(db, 'd-nostart')
  const rec = recs[0]
  ok(recs.length === 1 && rec.id === r.body.supportId && rec.scenario_id === SUPPORT_SCENARIO.not_started && rec.template_id === null
     && rec.status === 'completed' && rec.completed_by === 'tm-csm-1' && rec.completed_at === T_NOW && rec.created_at === T_NOW
     && rec.behavior_summary === MARK_DEE.reasonsText && rec.dismissed_at === null,
     'one support record: support.nostart, no template, completed by the login (not the body\'s "actor"), created when completed, the reasons as its summary', show(rec))
  const q = taskById(db, 'q-dee')
  ok(q.status === 'completed' && q.completed_by === 'tm-csm-1' && q.completed_at === T_NOW && q.template_id === 'tpl-nl3',
     'the queue task completed with the same actor and the same moment, its template kept (the Tasks page shows it under Sent)', show(q))

  // The row leaves the list; Handled holds the mark, undoable by its author only.
  const after = await at(later(1), () => getToday('tok-csm-1'))
  ok(!after.body.rows.some((x) => x.studentId === 'd-nostart'), 'the row is gone from the list (C5)')
  const mine = after.body.handled.filter((h) => h.studentId === 'd-nostart')
  ok(mine.length === 2 && mine.every((h) => h.undoable && h.groupKey === `tm-csm-1|${T_NOW}` && h.by?.name === 'Robin Hale'),
     'Handled: the record and the task under one group key, undoable by the author', show(mine))
  const other = await at(later(1), () => getToday('tok-csm-2'))
  ok(other.body.handled.filter((h) => h.studentId === 'd-nostart').every((h) => !h.undoable), 'and not by another member')
}

console.log('\n=== Mark refused: Not needed without a reason, an unknown reason, another student\'s task ===')
{
  const db = freshTodayDb()
  const before = tasksSnapshot(db)
  const noNote = await at(T_NOW, () => postMark('tok-csm-1', { ...MARK_DEE, action: 'not_needed' }))
  ok(noNote.status === 400 && plain(noNote.body.error) && /reason/.test(noNote.body.error), 'Not needed without a note: 400', noNote.body.error)
  const blank = await at(T_NOW, () => postMark('tok-csm-1', { ...MARK_DEE, action: 'not_needed', note: '   ' }))
  ok(blank.status === 400, 'a note of spaces is no note: 400')
  const kind = await at(T_NOW, () => postMark('tok-csm-1', { ...MARK_DEE, headlineKind: 'went_to_the_moon' }))
  ok(kind.status === 400 && plain(kind.body.error), 'an unknown kind: 400', kind.body.error)
  const theirs = await at(T_NOW, () => postMark('tok-csm-1', { ...MARK_DEE, openTaskIds: ['q-dee', 'q-cal'] }))
  ok(theirs.status === 400 && plain(theirs.body.error), 'a task id of another student: 400', theirs.body.error)
  const missing = await at(T_NOW, () => postMark('tok-csm-1', { ...MARK_DEE, openTaskIds: ['no-such-task'] }))
  ok(missing.status === 400, 'a task id nobody has: 400')
  // The student's own task, closed in September: not open, so not this mark's to close.
  const closed = await at(T_NOW, () => postMark('tok-csm-1', {
    studentId: 'd-stop', action: 'messaged', headlineKind: 'stopped', reasonsText: 'No lesson for 3 days', openTaskIds: ['c-old'],
  }))
  ok(closed.status === 400, 'the student\'s own task, already closed: 400')
  const record = await at(T_NOW, () => postMark('tok-csm-1', {
    studentId: 'd-stop', action: 'messaged', headlineKind: 'stopped', reasonsText: 'No lesson for 3 days', openTaskIds: ['c-rae'],
  }))
  ok(record.status === 400, 'a support record passed as a queue task: 400')
  const nobody = await at(T_NOW, () => postMark('tok-csm-1', { ...MARK_DEE, studentId: 'no-such-student', openTaskIds: [] }))
  ok(nobody.status === 404 && plain(nobody.body.error), 'a student who is not there: 404', nobody.body.error)
  ok(tasksSnapshot(db) === before, 'nothing was written by any of them')
}

console.log('\n=== A double click within 2 minutes returns the first ===')
{
  const db = freshTodayDb()
  const first = await at(T_NOW, () => postMark('tok-csm-1', MARK_DEE))
  const second = await at(later(1), () => postMark('tok-csm-1', MARK_DEE))
  ok(second.status === 200 && second.body.supportId === first.body.supportId && second.body.at === T_NOW
     && isDeepStrictEqual(second.body.movedIds, ['q-dee']), 'the second answers 200 with the first record, its moment and its task', show(second.body))
  ok(supportRows(db, 'd-nostart').length === 1, 'one row in the table')
  // Another member's click is a mark of their own (the queue task is closed by then, so only a record).
  const theirs = await at(later(1), () => postMark('tok-csm-2', { ...MARK_DEE, openTaskIds: [] }))
  ok(theirs.status === 201 && supportRows(db, 'd-nostart').length === 2, 'another member within 2 minutes: their own record (the duplicate is per author)')
  // An open task row (no computed reason): no record, and a second click is the first too.
  const t1 = await at(T_NOW, () => postMark('tok-csm-1', { studentId: 'd-task', action: 'messaged', headlineKind: 'open_task', reasonsText: 'Joined yesterday', openTaskIds: ['q-ty'] }))
  const t2 = await at(later(1), () => postMark('tok-csm-1', { studentId: 'd-task', action: 'messaged', headlineKind: 'open_task', reasonsText: 'Joined yesterday', openTaskIds: ['q-ty'] }))
  ok(t1.status === 201 && t1.body.supportId === null && isDeepStrictEqual(t1.body.movedIds, ['q-ty']) && supportRows(db, 'd-task').length === 0,
     'an open task headline: the task closed, no support record', show(t1.body))
  ok(t2.status === 200 && t2.body.supportId === null && isDeepStrictEqual(t2.body.movedIds, ['q-ty']) && t2.body.at === T_NOW, 'and its double click answers the first', show(t2.body))
}

console.log('\n=== A second mark within 2 minutes that says the other thing: 409, nothing written, nothing lost ===')
{
  const db = freshTodayDb()
  const first = await at(T_NOW, () => postMark('tok-csm-1', MARK_DEE))
  const afterFirst = tasksSnapshot(db)
  const other = await at(later(1), () => postMark('tok-csm-1', { ...MARK_DEE, action: 'not_needed', note: 'Spoke on a call.', openTaskIds: [] }))
  ok(first.status === 201 && other.status === 409 && other.body.code === 'marked-otherwise' && plain(other.body.error)
     && /marked this student as messaged/.test(other.body.error),
     'Messaged, then Not needed with a reason a minute later: 409 "marked-otherwise" in plain words, never the first mark answered as if it were the second', show(other.body))
  ok(tasksSnapshot(db) === afterFirst && supportRows(db, 'd-nostart').every((r) => r.notes === null),
     'nothing written: one record, completed, and the reason was not saved silently on it')
  // The other way round, and on an open task headline (no record, the queue task closed).
  const db2 = freshTodayDb()
  await at(T_NOW, () => postMark('tok-csm-1', { ...MARK_DEE, action: 'not_needed', note: 'Away this week.' }))
  const back = await at(later(1), () => postMark('tok-csm-1', MARK_DEE))
  ok(back.status === 409 && back.body.code === 'marked-otherwise' && /marked this student as not needed/.test(back.body.error) && supportRows(db2, 'd-nostart').length === 1,
     'Not needed, then Messaged: 409, the record stays the dismissed one', show(back.body))
  await at(T_NOW, () => postMark('tok-csm-1', { studentId: 'd-task', action: 'messaged', headlineKind: 'open_task', reasonsText: 'Joined yesterday', openTaskIds: ['q-ty'] }))
  const taskOther = await at(later(1), () => postMark('tok-csm-1', {
    studentId: 'd-task', action: 'not_needed', note: 'Already welcomed.', headlineKind: 'open_task', reasonsText: 'Joined yesterday', openTaskIds: ['q-ty'],
  }))
  ok(taskOther.status === 409 && taskOther.body.code === 'marked-otherwise' && taskById(db2, 'q-ty').status === 'completed' && taskById(db2, 'q-ty').notes === null,
     'an open task headline marked Messaged, then Not needed: 409, the task stays completed, no note', show(taskOther.body))
}

console.log('\n=== Marks sent at once (two tabs, a request sent again): one record, whatever the order ===')
{
  const db = freshTodayDb()
  const answers = await at(T_NOW, () => marksAtOnce(['tok-csm-1', MARK_DEE], ['tok-csm-1', MARK_DEE]))
  const statuses = answers.map((a) => a.status).sort()
  const recs = supportRows(db, 'd-nostart')
  ok(isDeepStrictEqual(statuses, [200, 201]) && recs.length === 1 && answers.every((a) => a.body.supportId === recs[0].id),
     'two identical marks at once: one 201 and one 200, both naming the one record left', show(answers.map((a) => [a.status, a.body.supportId])))
  ok(taskById(db, 'q-dee').status === 'completed' && taskById(db, 'q-dee').completed_by === 'tm-csm-1' && taskById(db, 'q-dee').completed_at === T_NOW,
     'the queue task closed once, by the login, at the moment')
}
{
  const db = freshTodayDb()
  const [messaged, notNeeded] = await at(T_NOW, () => marksAtOnce(
    ['tok-csm-1', MARK_DEE],
    ['tok-csm-1', { ...MARK_DEE, action: 'not_needed', note: 'Spoke on a call.' }],
  ))
  const recs = supportRows(db, 'd-nostart')
  ok(messaged.status === 201 && notNeeded.status === 409 && notNeeded.body.code === 'marked-otherwise' && recs.length === 1 && recs[0].status === 'completed',
     'Messaged and Not needed at once: the first record stands, the other call answers 409 and leaves nothing behind', show([messaged.status, notNeeded.status, recs.map((r) => r.status)]))
  ok(taskById(db, 'q-dee').status === 'completed' && taskById(db, 'q-dee').notes === null, 'the queue task completed, with no note from the Not needed')
}
{
  // An open task headline (no record): two at once close the task once; the other call answers as a second click.
  const db = freshTodayDb()
  const TY = { studentId: 'd-task', action: 'messaged', headlineKind: 'open_task', reasonsText: 'Joined yesterday', openTaskIds: ['q-ty'] }
  const answers = await at(T_NOW, () => marksAtOnce(['tok-csm-1', TY], ['tok-csm-1', TY]))
  ok(isDeepStrictEqual(answers.map((a) => a.status).sort(), [200, 201]) && answers.every((a) => a.body.supportId === null && isDeepStrictEqual(a.body.movedIds, ['q-ty']))
     && taskById(db, 'q-ty').status === 'completed' && supportRows(db, 'd-task').length === 0,
     'an open task marked twice at once: closed once, one 201 and one 200 (never "someone closed it")', show(answers.map((a) => [a.status, a.body])))
}
{
  // The rarer order: a newer record by the same member lands while this call writes (that call read
  // before this one wrote, so it kept its own). This call's record is the older, so it stands, and
  // the newer one is taken back: one record either way.
  const db = freshTodayDb()
  let reads = 0
  db.failWhen = (q) => {
    if (q.table === 'tasks' && q.op === 'select' && q.filters.includes('student_id=d-nostart') && ++reads === 2) {
      db.rows('tasks').push({
        id: 'sup-newer', student_id: 'd-nostart', scenario_id: 'support.nostart', template_id: null, status: 'completed',
        behavior_summary: 'No lesson on the new course yet (course day 4)', created_at: '2026-10-23T09:00:01.000Z',
        completed_at: '2026-10-23T09:00:01.000Z', completed_by: 'tm-csm-1', dismissed_at: null, dismissed_by: null, notes: null, outcome: null,
      })
    }
    return null
  }
  const r = await at(T_NOW, () => postMark('tok-csm-1', MARK_DEE))
  const recs = supportRows(db, 'd-nostart')
  ok(reads >= 2 && r.status === 201 && recs.length === 1 && recs[0].id === r.body.supportId && !recs.some((x) => x.id === 'sup-newer'),
     'a newer record that landed meanwhile is taken back; the older stands', show({ status: r.status, recs: recs.map((x) => x.id) }))
}

console.log('\n=== Mark messaged on the 30% page closes the student\'s open task in the Tasks queue ===')
{
  // Tia (d-thirty) can still earn the 30% (50 of 61, the shared deadline tonight) and has an open
  // queue task: whoever works the queue must see the contact, and Today must not list her again.
  const db = freshTodayDb()
  db.rows('tasks').push({
    id: 'q-tia', student_id: 'd-thirty', scenario_id: 'stalled.discord.day3', template_id: 'tpl-welcome', status: 'open',
    behavior_summary: 'Paid 3 days ago, never logged in', created_at: '2026-10-22T07:00:00.000Z',
    completed_at: null, completed_by: null, dismissed_at: null, dismissed_by: null, notes: null, outcome: null,
  })
  const thirty = await at(T_NOW, () => getThirty('tok-csm-1'))
  const tia = thirty.body.canStillEarn?.find((e) => e.student.id === 'd-thirty')
  ok(tia?.state === 'locked' && isDeepStrictEqual(tia.openTasks, [{ id: 'q-tia', scenarioId: 'stalled.discord.day3', summary: 'Paid 3 days ago, never logged in', createdAt: '2026-10-22T07:00:00.000Z' }]),
     'the 30% page\'s row carries her open queue task', show(tia?.openTasks))
  const before = await at(T_NOW, () => getToday('tok-csm-1'))
  ok(before.body.rows.find((x) => x.studentId === 'd-thirty')?.openTasks.some((t) => t.id === 'q-tia'), 'Today lists her with the same task')
  const r = await at(T_NOW, () => postMark('tok-csm-1', {
    studentId: 'd-thirty', action: 'messaged', headlineKind: tia.state === 'ready' ? 'thirty_ready' : 'thirty_closing',
    reasonsText: thirtyReasonText('thirty_closing', tia.facts), openTaskIds: tia.openTasks.map((t) => t.id),
  }))
  const rec = supportRows(db, 'd-thirty')[0]
  const q = taskById(db, 'q-tia')
  ok(r.status === 201 && isDeepStrictEqual(r.body.movedIds, ['q-tia']) && rec?.scenario_id === 'support.30close' && rec.completed_by === 'tm-csm-1'
     && q.status === 'completed' && q.completed_by === rec.completed_by && q.completed_at === rec.completed_at && q.completed_at === T_NOW,
     'one 30% record and the queue task completed with the same actor and the same moment', show({ rec, q }))
  const after = await at(later(60), () => getToday('tok-csm-1'))
  ok(!after.body.rows.some((x) => x.studentId === 'd-thirty'), 'an hour later Today does not list her: the 2-day wait holds, with no open task to show her')
}

console.log('\n=== Not needed: a dismissed record and the queue task dismissed, with the same note ===')
{
  const db = freshTodayDb()
  const r = await at(T_NOW, () => postMark('tok-founder', { ...MARK_DEE, action: 'not_needed', note: 'We spoke on a call today.' }))
  const rec = supportRows(db, 'd-nostart')[0]
  const q = taskById(db, 'q-dee')
  ok(r.status === 201 && rec.status === 'dismissed' && rec.dismissed_by === 'tm-founder' && rec.dismissed_at === T_NOW && rec.notes === 'We spoke on a call today.'
     && rec.completed_at === null, 'the record: dismissed, by the login, with the note', show(rec))
  ok(q.status === 'dismissed' && q.dismissed_by === 'tm-founder' && q.dismissed_at === T_NOW && q.notes === 'We spoke on a call today.',
     'the queue task: dismissed with the same actor, moment and note', show(q))
}

console.log('\n=== DELETE /api/admin/today/mark: Undo ===')
{
  // By the author within 15 minutes: the record deleted, the task open again.
  const db = freshTodayDb()
  const m = await at(T_NOW, () => postMark('tok-csm-1', MARK_DEE))
  const u = await at(later(14), () => deleteMark('tok-csm-1', { ids: [m.body.supportId, 'q-dee'] }))
  ok(u.status === 200 && u.body.results.length === 2 && u.body.results.every((x) => x.ok && x.status === 200), 'by the author after 14 minutes: both undone', show(u.body))
  const q = taskById(db, 'q-dee')
  ok(supportRows(db, 'd-nostart').length === 0 && q.status === 'open' && q.completed_at === null && q.completed_by === null && q.notes === null,
     'the record deleted, the queue task open again with its stamps cleared', show(q))
  const back = await at(later(15), () => getToday('tok-csm-1'))
  ok(back.body.rows.some((x) => x.studentId === 'd-nostart') && !back.body.handled.some((h) => h.studentId === 'd-nostart'),
     'the student is back on the list, and out of Handled')
}
{
  // By another member: 403 for each, nothing changed.
  const db = freshTodayDb()
  const m = await at(T_NOW, () => postMark('tok-csm-1', MARK_DEE))
  const before = tasksSnapshot(db)
  const u = await at(later(1), () => deleteMark('tok-csm-2', { ids: [m.body.supportId, 'q-dee'] }))
  ok(u.status === 200 && u.body.results.every((x) => !x.ok && x.status === 403 && plain(x.error)), 'another member: 403 for that record and that task', show(u.body))
  ok(tasksSnapshot(db) === before, 'nothing changed')
}
{
  // After 15 minutes: 409.
  const db = freshTodayDb()
  const m = await at(T_NOW, () => postMark('tok-csm-1', MARK_DEE))
  const before = tasksSnapshot(db)
  const u = await at(later(16), () => deleteMark('tok-csm-1', { ids: [m.body.supportId, 'q-dee'] }))
  ok(u.body.results.every((x) => !x.ok && x.status === 409 && /15 minutes/.test(x.error)), 'after 16 minutes: 409', show(u.body))
  ok(tasksSnapshot(db) === before, 'nothing changed')
}
{
  // A non-support id with nothing to undo (an open task), and an id nobody has: 404.
  const db = freshTodayDb()
  const before = tasksSnapshot(db)
  const u = await at(T_NOW, () => deleteMark('tok-csm-1', { ids: ['q-cal', 'no-such-task'] }))
  ok(u.body.results.every((x) => !x.ok && x.status === 404 && plain(x.error)), 'an open queue task and an unknown id: 404', show(u.body))
  ok(tasksSnapshot(db) === before && taskById(db, 'q-cal').status === 'open', 'the open task is untouched')
}
{
  // The queue opened a newer task of the same scenario since: the record goes, that task stays closed (409).
  const db = freshTodayDb()
  const m = await at(T_NOW, () => postMark('tok-csm-1', MARK_DEE))
  db.rows('tasks').push({
    id: 'q-dee-2', student_id: 'd-nostart', scenario_id: 'nolessons.day3', template_id: 'tpl-nl3', status: 'open', behavior_summary: 'Again',
    created_at: later(2), completed_at: null, completed_by: null, dismissed_at: null, dismissed_by: null, notes: null, outcome: null,
  })
  const u = await at(later(3), () => deleteMark('tok-csm-1', { ids: [m.body.supportId, 'q-dee'] }))
  const [rec, task] = u.body.results
  ok(rec.ok && !task.ok && task.status === 409 && /newer open task/.test(task.error), 'a newer open task of the scenario: 409 for that task, the record undone', show(u.body))
  ok(supportRows(db, 'd-nostart').length === 0 && taskById(db, 'q-dee').status === 'completed' && taskById(db, 'q-dee-2').status === 'open',
     'the queue keeps one open task: the newer one')
}
{
  // The queue opens a newer task between the route's check and its update: the database's
  // one-open-task index (idx_tasks_unique_open) refuses the reopening, and the route says 409, not 500.
  const db = freshTodayDb()
  await at(T_NOW, () => postMark('tok-csm-1', MARK_DEE))
  let opened = false
  db.failWhen = (q) => {
    if (q.table === 'tasks' && q.op === 'update' && !opened) {
      opened = true
      db.rows('tasks').push({
        id: 'q-dee-3', student_id: 'd-nostart', scenario_id: 'nolessons.day3', template_id: 'tpl-nl3', status: 'open', behavior_summary: 'Again',
        created_at: later(2), completed_at: null, completed_by: null, dismissed_at: null, dismissed_by: null, notes: null, outcome: null,
      })
    }
    return null
  }
  const u = await at(later(2), () => deleteMark('tok-csm-1', { ids: ['q-dee'] }))
  ok(opened && u.body.results[0].ok === false && u.body.results[0].status === 409 && /newer open task/.test(u.body.results[0].error),
     'a newer task opened in between: the index refuses, 409 for that task', show(u.body))
  ok(taskById(db, 'q-dee').status === 'completed', 'and the task stays closed')
}

console.log('\n=== Mark and Undo as a student, or with no token ===')
{
  const db = freshTodayDb()
  const before = tasksSnapshot(db)
  const s1 = await at(T_NOW, () => postMark('tok-student', MARK_DEE))
  const s2 = await at(T_NOW, () => postMark(undefined, MARK_DEE))
  const s3 = await at(T_NOW, () => deleteMark('tok-student', { ids: ['q-dee'] }))
  const s4 = await at(T_NOW, () => deleteMark(undefined, { ids: ['q-dee'] }))
  ok(s1.status === 403 && s2.status === 401 && s3.status === 403 && s4.status === 401, 'mark: 403 / 401; undo: 403 / 401', [s1, s2, s3, s4].map((x) => x.status).join(' '))
  ok(tasksSnapshot(db) === before, 'nothing written')
  const bad = await at(T_NOW, () => deleteMark('tok-csm-1', { ids: [] }))
  ok(bad.status === 400 && plain(bad.body.error), 'undo with no ids: 400', bad.body.error)
}

console.log('\n=== Route settings ===')
ok(thirtyRoute.maxDuration === 60, 'maxDuration is 60 seconds', String(thirtyRoute.maxDuration))
ok(thirtyRoute.dynamic === 'force-dynamic', 'never cached: force-dynamic', String(thirtyRoute.dynamic))
ok(todayRoute.maxDuration === 60 && todayRoute.dynamic === 'force-dynamic', 'Today: maxDuration 60, force-dynamic')
ok(markRoute.dynamic === 'force-dynamic' && typeof markRoute.POST === 'function' && typeof markRoute.DELETE === 'function',
   'the mark route: POST and DELETE, never cached')

console.log('\n=== Every error sentence the routes answered ===')
ok(errorSentences.length >= 5 && errorSentences.every(plain),
   'no em dash, no "unlock", no "EcomTalent", none empty', show(errorSentences))
// world-tests/admin-pages.mjs runs this file with ADMIN_ROUTE_ERRORS_OUT set
// and holds every one of these sentences to the same words (work item 5).
if (process.env.ADMIN_ROUTE_ERRORS_OUT) fs.writeFileSync(process.env.ADMIN_ROUTE_ERRORS_OUT, JSON.stringify(errorSentences))

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
