// admin-routes.test.mjs: the admin rebuild's routes through their own
// handlers (admin rebuild PRD, _admin/prds/admin-rebuild/admin_rebuild_prd.md
// in the workspace). Work item 3 made this harness and its first route,
// GET /api/admin/thirty (the 30% page's list). Admin rebuild 2
// (_admin/prds/admin-rebuild-2/) removed Today and its routes, which work
// item 4 had added here (this file was admin-today-routes.test.mjs), and
// added PUT /api/admin/config, limited to the 6 keys of
// src/lib/admin/config-keys.ts (D6).
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
import * as configRoute from './_gen/admin-config-route.ts'
import { CONFIG_LINK_KEYS, CONFIG_SWITCH_KEYS, EDITABLE_CONFIG_KEYS, configWriteError } from './_gen/config-keys.ts'
import { loadThirtyData } from './_gen/thirty-data.ts'
import { VERDICT_TEXT, buildThirtyView } from './_gen/thirty-view.ts'
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
// PUT /api/admin/config (admin rebuild 2, D6): the 6 keys and nothing else
// ════════════════════════════════════════════════════════════════════════════

/** One call to a route's handler, as `token`; its log lines are the caller's to keep quiet (call() does). */
async function rawCall(route, method, path, token, body) {
  const headers = token === undefined ? {} : { authorization: `Bearer ${token}` }
  const init = { method, headers }
  if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); headers['content-type'] = 'application/json' }
  const res = await route[method](new NextRequest(`http://localhost${path}`, init))
  const json = await res.json()
  if (res.status >= 400) errorSentences.push(json?.error)
  return { status: res.status, body: json }
}
const call = (route, method, path, token, body) => hush(() => rawCall(route, method, path, token, body))

/** The admin_config rows as production holds them on 20 October (live_read.json), the switches all off. */
const CONFIG_ROWS = [
  { key: 'curriculum_reset_at', value: RESET },
  { key: 'discount_window_days', value: '14' },
  { key: 'program_login_link', value: 'https://example.com/login' },
  { key: 'discord_invite_link', value: '' },
  { key: 'dms_master_enabled', value: 'false' },
  { key: 'day28_dm_enabled', value: 'false' },
  { key: 'engagement_alerts_enabled', value: 'false' },
  { key: 'csm_task_summary_enabled', value: 'false' },
]
/** The same team plus an admin, who may write as a founder may. */
function freshConfigDb({ rows = CONFIG_ROWS } = {}) {
  const db = new FakeDb({
    team_members: [...TEAM, { id: 'tm-admin', email: 'admin@example.com', full_name: 'Ari Lane', role: 'admin' }],
    admin_config: rows.map((r) => ({ ...r, updated_at: null, updated_by: null })),
  }, { ...TOKENS, 'tok-admin': 'tm-admin' })
  installDb(db)
  return db
}
const putConfig = (token, body) => call(configRoute, 'PUT', '/api/admin/config', token, body)
const configSnapshot = (db) => JSON.stringify(db.rows('admin_config'))
const configValue = (db, key) => db.rows('admin_config').find((r) => r.key === key)?.value

console.log('\n=== PUT /api/admin/config: the 6 keys it accepts ===')
ok(JSON.stringify(EDITABLE_CONFIG_KEYS) === JSON.stringify(['program_login_link', 'discord_invite_link', 'dms_master_enabled', 'day28_dm_enabled', 'engagement_alerts_enabled', 'csm_task_summary_enabled']),
   'exactly the 2 message links and the 4 Discord switches', show(EDITABLE_CONFIG_KEYS))
{
  // The switches are the ones the crons read: dm-toggles.ts's DmToggleKey, read from the source.
  const src = fs.readFileSync(here('../src/lib/dm-toggles.ts'), 'utf8')
  const union = src.match(/export type DmToggleKey =([^;]+);/)?.[1] ?? ''
  const toggles = [...union.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]).sort()
  ok(toggles.length === 4 && JSON.stringify([...CONFIG_SWITCH_KEYS].sort()) === JSON.stringify(toggles),
     'the 4 switches are the DmToggleKey union the crons read', show(toggles))
  ok(JSON.stringify(CONFIG_LINK_KEYS) === JSON.stringify(['program_login_link', 'discord_invite_link']),
     'the 2 links are the ones renderTemplate fills in ({programLink}, {discordInvite})', show(CONFIG_LINK_KEYS))
}
for (const [token, who, memberId] of [['tok-founder', 'a founder', 'tm-founder'], ['tok-admin', 'an admin', 'tm-admin']]) {
  const db = freshConfigDb()
  const before = Date.now()
  const writes = [
    ['program_login_link', 'https://example.com/new-login'],
    ['discord_invite_link', 'https://discord.gg/made-up-invite'],
    ['dms_master_enabled', 'true'],
    ['day28_dm_enabled', 'true'],
    ['engagement_alerts_enabled', 'true'],
    ['csm_task_summary_enabled', 'true'],
  ]
  const answers = []
  for (const [key, value] of writes) answers.push(await putConfig(token, { key, value }))
  ok(answers.every((a) => a.status === 200 && a.body.row?.key !== undefined), `${who}: each of the 6 keys is saved (200)`, show(answers.map((a) => a.status)))
  ok(writes.every(([key, value]) => configValue(db, key) === value), `${who}: each row holds the value sent`)
  const rows = db.rows('admin_config').filter((r) => writes.some(([key]) => key === r.key))
  ok(rows.length === 6 && rows.every((r) => r.updated_by === memberId && Date.parse(r.updated_at) >= before - 1000),
     `${who}: each row records who saved it and when`, show(rows.map((r) => r.updated_by)))
  const back = await putConfig(token, { key: 'dms_master_enabled', value: 'false' })
  const cleared = await putConfig(token, { key: 'discord_invite_link', value: '' })
  ok(back.status === 200 && configValue(db, 'dms_master_enabled') === 'false' && cleared.status === 200 && configValue(db, 'discord_invite_link') === '',
     `${who}: a switch goes back to "false", and the Discord link can be emptied again`)
}

console.log('\n=== PUT /api/admin/config refuses every other key, and nothing is written ===')
{
  const db = freshConfigDb()
  const before = configSnapshot(db)
  const refusals = [
    [{ key: 'curriculum_reset_at', value: '2026-11-01T00:00:00.000Z' }, 'the course switch date', /course switch date/],
    [{ key: 'discount_window_days', value: '30' }, 'the old discount window', /2 message links and the 4 Discord switches/],
    [{ key: 'booking_link', value: 'https://example.com/book' }, 'a key that is not in the table', /2 message links and the 4 Discord switches/],
    [{ key: ' program_login_link_x ', value: 'x' }, 'a key that only starts like a link', /2 message links and the 4 Discord switches/],
    [{ key: '', value: 'x' }, 'no key', /Missing key/],
    [{ value: 'x' }, 'no key at all', /Missing key/],
    [{ key: 'dms_master_enabled', value: 'yes' }, 'a switch set to "yes"', /"true" or "false"/],
    [{ key: 'engagement_alerts_enabled', value: 'True' }, 'a switch set to "True"', /"true" or "false"/],
    [{ key: 'day28_dm_enabled', value: true }, 'a switch sent as a JSON boolean', /must be text/],
    [{ key: 'program_login_link' }, 'a link with no value', /must be text/],
    [{ key: 'discord_invite_link', value: null }, 'a link set to null', /must be text/],
  ]
  for (const [body, what, said] of refusals) {
    const r = await putConfig('tok-founder', body)
    ok(r.status === 400 && said.test(r.body.error ?? '') && plain(r.body.error), `${what}: 400, "${r.body.error}"`)
  }
  const broken = await putConfig('tok-founder', '{not json')
  ok(broken.status === 400 && plain(broken.body.error), `a body that is not JSON: 400, "${broken.body.error}"`)
  ok(configSnapshot(db) === before, 'nothing in admin_config changed')
  ok(db.calls('admin_config', 'update').length === 0, 'no update was even sent')
}

console.log('\n=== PUT /api/admin/config: who may write ===')
{
  const db = freshConfigDb()
  const before = configSnapshot(db)
  const body = { key: 'dms_master_enabled', value: 'true' }
  const csm = await putConfig('tok-csm-1', body)
  const student = await putConfig('tok-student', body)
  const none = await putConfig(undefined, body)
  const nobody = await putConfig('tok-nobody', body)
  ok(csm.status === 403 && student.status === 403 && none.status === 401 && nobody.status === 401,
     'a csm 403, a student 403, no token 401, a token nobody holds 401', [csm, student, none, nobody].map((x) => x.status).join(' '))
  ok(configSnapshot(db) === before, 'nothing written')
}

console.log('\n=== PUT /api/admin/config: a missing row and a failed write, in plain words ===')
{
  const db = freshConfigDb({ rows: CONFIG_ROWS.filter((r) => r.key !== 'day28_dm_enabled') })
  const r = await putConfig('tok-founder', { key: 'day28_dm_enabled', value: 'true' })
  ok(r.status === 404 && plain(r.body.error) && /no row/.test(r.body.error), `one of the 6 with no row: 404, "${r.body.error}"`)
  ok(!db.rows('admin_config').some((x) => x.key === 'day28_dm_enabled'), 'and no row is made')
}
{
  const db = freshConfigDb()
  db.fail['admin_config.update'] = { message: 'canceling statement due to statement timeout' }
  const r = await putConfig('tok-founder', { key: 'program_login_link', value: 'https://example.com/other' })
  ok(r.status === 500 && plain(r.body.error) && !/statement timeout/.test(r.body.error),
     `the write fails: 500 in the team's words, without the database's, "${r.body.error}"`)
  ok(configValue(db, 'program_login_link') === 'https://example.com/login', 'the old value stays')
}

console.log('\n=== GET /api/admin/config still lists every row, for any team member ===')
{
  freshConfigDb()
  const csm = await call(configRoute, 'GET', '/api/admin/config', 'tok-csm-1')
  ok(csm.status === 200 && csm.body.config?.length === CONFIG_ROWS.length, 'a csm: 200 with the rows', `${csm.status}, ${csm.body.config?.length}`)
  const student = await call(configRoute, 'GET', '/api/admin/config', 'tok-student')
  ok(student.status === 403 && student.body.config === undefined, 'a student: 403, and no rows')
}

console.log('\n=== configWriteError on its own ===')
ok(configWriteError('program_login_link', 'https://example.com') === null && configWriteError('dms_master_enabled', 'false') === null,
   'a link as text and a switch as "false": allowed')
ok(configWriteError('curriculum_reset_at', '2026-11-01') !== null && configWriteError('stats_owner', 'x') !== null,
   'any other key: refused')

console.log('\n=== Route settings ===')
ok(thirtyRoute.maxDuration === 60, 'maxDuration is 60 seconds', String(thirtyRoute.maxDuration))
ok(thirtyRoute.dynamic === 'force-dynamic', 'never cached: force-dynamic', String(thirtyRoute.dynamic))
ok(typeof configRoute.GET === 'function' && typeof configRoute.PUT === 'function' && configRoute.POST === undefined && configRoute.DELETE === undefined,
   'the config route: GET and PUT only')

console.log('\n=== Every error sentence the routes answered ===')
ok(errorSentences.length >= 5 && errorSentences.every(plain),
   'no em dash, no "unlock", no "EcomTalent", none empty', show(errorSentences))
// world-tests/admin-pages.mjs runs this file with ADMIN_ROUTE_ERRORS_OUT set
// and holds every one of these sentences to the same words (work item 5).
if (process.env.ADMIN_ROUTE_ERRORS_OUT) fs.writeFileSync(process.env.ADMIN_ROUTE_ERRORS_OUT, JSON.stringify(errorSentences))

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
