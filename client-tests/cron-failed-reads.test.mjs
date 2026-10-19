// cron-failed-reads.test.mjs: in the three CSM crons, a failed read of the
// student pool, the milestones or the completions ends the run with an error
// and writes nothing (bug hunt of 19 October, cron-2).
//
// check-na-tasks never read the error of its student_milestones read, so a
// failed read left the pool unfiltered: every logged-in student on day 3, 5,
// 7 or 10 to 13 got "No dashboard login since signup.", and the day-10 ones
// high_churn_risk for good. check-engagement did the same with its read of
// the open alerts (every live alert inserted and posted again) and with each
// student's completions (a student who watched lessons alerted as never
// having started); check-csm-tasks with each student's completions (a
// nolessons task for a student with lessons) and with the past-due canceling
// students (their save task dismissed for good). The likeliest failure is
// not a fault at all: one .in() list for the whole pool makes a request URL
// past a gateway's limit at about 200 students, so both pool-wide reads are
// now read 100 ids at a time, as outreach-insights.ts reads them. Since the
// review of 20 October (cron-1) check-engagement also reads the two
// /admin/discord toggles with their error, before the insert: a failed read
// taken as "off" inserted the new alerts unposted, and an open alert is never
// posted again.
//
// Each cron runs as it is: the real route and the libraries it imports,
// copied here with their import lines pointed at the copies, and a real
// supabase-js client. Only the network is stood in (_gen/stub-cron.ts, see
// engagement-alerts.test.mjs): `failWhen` makes the chosen read fail, and a
// request line past 8 KB is refused with 414. Each route as it stood at BASE
// (production on 19 October) is taken from git and run on the same
// failure, to show the wrong writes it made.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const BASE = '70c934a'
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const fromBase = (rel) => execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: here('..'), encoding: 'utf8' })
// dropComments leaves out every comment line of a copy (a line that starts
// with //, /* or *): some name team members, and this repository is public.
// The code must stay the same, so the app's own TypeScript prints the source
// and the copy without comments and the two must match, or the test stops.
const ts = createRequire(import.meta.url)('typescript')
const codeOf = (text) => ts.createPrinter({ removeComments: true })
  .printFile(ts.createSourceFile('copy.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS))
function write(text, label, outRel, rewrites = [], { dropComments = false } = {}) {
  let s = text
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${label} has no ${from}`)
    s = s.split(from).join(to)
  }
  if (dropComments) {
    const kept = s.split('\n').filter((l) => !/^(\/\/|\/\*|\*)/.test(l.trimStart())).join('\n')
    if (codeOf(kept) !== codeOf(s)) throw new Error(`leaving out the comment lines of ${label} would change its code`)
    s = kept
  }
  if (s.includes('@/')) throw new Error(`an unrewritten @/ import remains in ${label}`)
  fs.writeFileSync(here(outRel), s)
  console.log(`generated ${outRel} from ${label}`)
}

// The same library copies engagement-alerts.test.mjs, build.mjs and
// outreach-cutover.test.mjs make, so this file runs on its own. The copies of
// dm-toggles.ts and of check-na-tasks and check-csm-tasks (now and at BASE)
// have no comment lines (dropComments, above).
const LIBS = [
  ['src/lib/constants.ts', './_gen/constants.ts', []],
  ['src/lib/curriculum-reset.ts', './_gen/curriculum-reset.ts', []],
  ['src/lib/supabase-pagination.ts', './_gen/supabase-pagination.ts', []],
  ['src/lib/admin/metrics-definitions.ts', './_gen/metrics-definitions.ts', [['from "@/lib/constants"', 'from "./constants.ts"']]],
  ['src/lib/dm-toggles.ts', './_gen/dm-toggles.ts', [], { dropComments: true }],
  ['src/lib/supabase-server.ts', './_gen/supabase-server.ts', []],
  ['src/lib/cron-auth.ts', './_gen/cron-auth.ts', [['from "@/lib/supabase-server"', 'from "./supabase-server.ts"']]],
  ['src/lib/discord.ts', './_gen/discord.ts', []],
  ['src/lib/csm-triggers.ts', './_gen/csm-triggers.ts', [
    ['"@/types/database"', '"./types-erased.ts"'],
    ['from "@/lib/constants"', 'from "./constants.ts"'],
    ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ]],
]
for (const [src, out, rw, opts] of LIBS) write(fromSrc(src), src, out, rw, opts)
write(fromBase('src/lib/discord.ts'), `src/lib/discord.ts@${BASE}`, './_gen/discord.old.ts')
const rewrites = (discord) => [
  ['from "next/server"', 'from "./stub-cron.ts"'],
  ['from "@/lib/supabase-server"', 'from "./supabase-server.ts"'],
  ['from "@/lib/discord"', `from "${discord}"`],
  ['from "@/lib/dm-toggles"', 'from "./dm-toggles.ts"'],
  ['from "@/lib/admin/metrics-definitions"', 'from "./metrics-definitions.ts"'],
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ['from "@/lib/cron-auth"', 'from "./cron-auth.ts"'],
]
// check-engagement's copies are engagement-alerts.test.mjs's too, written
// there the same way, comments and all.
const ROUTES = {
  na: ['src/app/api/cron/check-na-tasks/route.ts', 'check-na-tasks-route', [], { dropComments: true }],
  engagement: ['src/app/api/cron/check-engagement/route.ts', 'check-engagement-route', [
    ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"']]],
  csm: ['src/app/api/cron/check-csm-tasks/route.ts', 'check-csm-tasks-route', [
    ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
    ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
    ['from "@/lib/csm-triggers"', 'from "./csm-triggers.ts"'],
    ['"@/types/database"', '"./types-erased.ts"']], { dropComments: true }],
}
for (const [src, out, extra, opts] of Object.values(ROUTES)) {
  write(fromSrc(src), src, `./_gen/${out}.ts`, [...rewrites('./discord.ts'), ...extra], opts)
  write(fromBase(src), `${src}@${BASE}`, `./_gen/${out}.old.ts`, [...rewrites('./discord.old.ts'), ...extra], opts)
}

const SECRET = 'cron-secret-for-the-test'
process.env.CRON_SECRET = SECRET
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-the-test'
process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
process.env.DISCORD_TEAM_WEBHOOK_URL = 'https://discord.test/api/webhooks/1/stand-in'

const { StandInDb, StandInDiscord, installNetwork } = await import('./_gen/stub-cron.ts')
const NA = { now: await import('./_gen/check-na-tasks-route.ts'), before: await import('./_gen/check-na-tasks-route.old.ts') }
const ENG = { now: await import('./_gen/check-engagement-route.ts'), before: await import('./_gen/check-engagement-route.old.ts') }
const CSM = { now: await import('./_gen/check-csm-tasks-route.ts'), before: await import('./_gen/check-csm-tasks-route.old.ts') }

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

let db = null
installNetwork({ db: () => db, discord: () => new StandInDiscord() })
async function run(route, name) {
  const res = await route.GET(new Request(`http://app.test/api/cron/${name}`, { headers: { authorization: `Bearer ${SECRET}` } }))
  return { status: res.status, body: await res.json() }
}
const theRun = () => db.rows('cron_runs').at(-1)
const FAILED_READ = 'stand-in: the read failed'
const failing = (match) => (r) => (r.method === 'GET' && match(r) ? { status: 500, body: JSON.stringify({ code: 'XX000', details: null, hint: null, message: FAILED_READ }) } : null)
const param = (r, k) => r.url.searchParams.get(k)
// The run stopped: a 500 that says what failed, cron_runs failed with it,
// and no request but the run's own audit row wrote anything.
const stoppedClean = (r, says) => r.status === 500 && r.body.error.includes(says) && theRun().status === 'failed'
  && theRun().error_message.includes(says) && db.writes().length === 0
const told = (r) => show({ status: r.status, error: r.body.error, run: theRun().status, writes: db.writes().map((w) => `${w.method} ${w.table}`) })

const H = 3_600_000
const D = 24 * H
const NOW = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const uuid = (tag, i) => `${tag}000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const PLAN = 'plan_4ZrwR4PmBsVsx'
const student = (id, o = {}) => ({
  id, name: `Student ${id.slice(-3)}`, email: null, discord_username: null, membership_status: 'active', whop_plan_id: PLAN,
  high_churn_risk: false, csm_exempt: false, cancel_scheduled_at: null, created_at: iso(NOW - 2.5 * D),
  first_paid_at: iso(NOW - 2.5 * D), joined_at: iso(NOW - 2.5 * D), last_active_at: iso(NOW - H), ...o,
})
const OFF = [{ key: 'dms_master_enabled', value: 'false' }]

// ════════════════════════════ check-na-tasks ════════════════════════════
console.log('\n=== check-na-tasks: the milestones read ===')
const NA_A = uuid('a1', 1) // logged in, Day 3
const NA_B = uuid('a1', 2) // never logged in, Day 3
const NA_C = uuid('a1', 3) // logged in, Day 11 (the day-10 tier)
const NA_TEMPLATES = [3, 5, 7, 10].flatMap((d) => ['discord', 'whop'].map((c) => ({ id: `t-${c}-${d}`, scenario_id: `stalled.${c}.day${d}`, is_active: true })))
const naDb = () => new StandInDb({
  students: [student(NA_A, { discord_username: 'a' }), student(NA_B), student(NA_C, { discord_username: 'c', first_paid_at: iso(NOW - 10.5 * D) })],
  student_milestones: [{ student_id: NA_A, first_sprint_login_at: iso(NOW - 2 * D) }, { student_id: NA_C, first_sprint_login_at: iso(NOW - 9 * D) }],
  templates: NA_TEMPLATES, tasks: [], admin_config: OFF, cron_runs: [],
})
const tasksOf = () => db.rows('tasks').map((t) => `${t.student_id.slice(-1)}:${t.scenario_id}`).sort()
const flagged = () => db.rows('students').filter((s) => s.high_churn_risk).map((s) => s.id.slice(-1))
{
  db = naDb()
  const r = await run(NA.now, 'check-na-tasks')
  ok(r.status === 200 && show(tasksOf()) === show(['2:stalled.whop.day3']) && flagged().length === 0 && theRun().status === 'success',
     'the read answers: only the student who never logged in gets a task, nobody is flagged', show(tasksOf()))
}
{
  db = naDb()
  db.failWhen = failing((r) => r.table === 'student_milestones')
  const r = await run(NA.before, 'check-na-tasks')
  ok(r.status === 200 && show(tasksOf()) === show(['1:stalled.discord.day3', '2:stalled.whop.day3', '3:stalled.discord.day10'])
     && show(flagged()) === show(['3']) && theRun().status === 'success',
     'BEFORE, the read failing: both logged-in students get "No dashboard login since signup", the day-11 one is flagged high_churn_risk, and the run says success',
     show({ tasks: tasksOf(), flagged: flagged() }))
}
{
  db = naDb()
  db.failWhen = failing((r) => r.table === 'student_milestones')
  const r = await run(NA.now, 'check-na-tasks')
  ok(stoppedClean(r, FAILED_READ) && db.rows('tasks').length === 0 && flagged().length === 0,
     'NOW, the read failing: a 500, cron_runs failed with the reason, and nothing written', told(r))
}
{
  db = naDb()
  db.failWhen = failing((r) => r.table === 'students')
  const r = await run(NA.now, 'check-na-tasks')
  ok(stoppedClean(r, FAILED_READ), 'NOW, the student pool read failing: the same (as it already was)', told(r))
}

console.log('\n=== check-na-tasks: a pool of 250, read 100 ids at a time ===')
{
  // Even ids logged in, odd ones never did; every one on Day 3.
  const ids = Array.from({ length: 250 }, (_, i) => uuid('b2', i))
  const big = () => new StandInDb({
    students: ids.map((id) => student(id)),
    student_milestones: ids.filter((_, i) => i % 2 === 0).map((id) => ({ student_id: id, first_sprint_login_at: iso(NOW - 2 * D) })),
    templates: NA_TEMPLATES, tasks: [], admin_config: OFF, cron_runs: [],
  })
  const neverLoggedIn = ids.filter((_, i) => i % 2 === 1).sort()
  db = big()
  await run(NA.before, 'check-na-tasks')
  const oldRead = db.reads('student_milestones')
  ok(oldRead.length === 1 && oldRead[0].status === 414 && db.rows('tasks').length === 250,
     'BEFORE: one request for all 250 ids, its request line past 8 KB, refused (414), and all 250 get a "never logged in" task',
     `${oldRead[0]?.requestLine} characters, ${db.rows('tasks').length} tasks`)
  db = big()
  const r = await run(NA.now, 'check-na-tasks')
  const reads = db.reads('student_milestones')
  const longest = Math.max(...reads.map((q) => q.requestLine))
  ok(reads.length === 3 && reads.every((q) => q.status === 200) && longest < 4500,
     'NOW: 3 requests (100, 100, 50 ids), each request line under 4,500 characters', `longest ${longest}`)
  ok(r.status === 200 && show(db.rows('tasks').map((t) => t.student_id).sort()) === show(neverLoggedIn),
     'and exactly the 125 students who never logged in get a task', `${db.rows('tasks').length} tasks`)
}

// ════════════════════════════ check-engagement ════════════════════════════
console.log('\n=== check-engagement: the completions and the open alerts ===')
const E_W = uuid('c3', 1) // watched two lessons yesterday
const E_Z = uuid('c3', 2) // nothing yet, Day 3
const E_O = uuid('c3', 3) // nothing yet, Day 3, alert already open
const engDb = () => new StandInDb({
  students: [student(E_W), student(E_Z), student(E_O)],
  student_lesson_completions: ['l1', 'l2'].map((l) => ({ student_id: E_W, lesson_id: l, completed_at: iso(NOW - D), skipped_at: null })),
  disengagement_alerts: [{ id: 'open-1', student_id: E_O, alert_type: 'no_lessons_3d', message: 'earlier', is_dismissed: false }],
  admin_config: OFF, cron_runs: [],
})
const alertsOf = () => db.rows('disengagement_alerts').map((a) => `${a.student_id.slice(-1)}:${a.alert_type}`).sort()
const OPEN_ONLY = ['3:no_lessons_3d']
{
  db = engDb()
  const r = await run(ENG.now, 'check-engagement')
  ok(r.status === 200 && show(alertsOf()) === show(['2:no_lessons_3d', '3:no_lessons_3d']) && theRun().status === 'success',
     'the reads answer: one new alert, for the student with nothing watched and no open alert', show(alertsOf()))
}
{
  db = engDb()
  db.failWhen = failing((r) => r.table === 'student_lesson_completions' && param(r, 'student_id') === `eq.${E_W}`)
  await run(ENG.before, 'check-engagement')
  ok(alertsOf().includes('1:no_lessons_3d') && theRun().status === 'success',
     'BEFORE, one student\'s completions read failing: the student who watched two lessons is alerted as never having started, and the run says success', show(alertsOf()))
  db = engDb()
  db.failWhen = failing((r) => r.table === 'student_lesson_completions' && param(r, 'student_id') === `eq.${E_W}`)
  const r = await run(ENG.now, 'check-engagement')
  ok(stoppedClean(r, FAILED_READ) && show(alertsOf()) === show(OPEN_ONLY),
     'NOW: a 500, cron_runs failed with the reason, and no alert written', told(r))
}
{
  db = engDb()
  db.failWhen = failing((r) => r.table === 'disengagement_alerts')
  await run(ENG.before, 'check-engagement')
  ok(show(alertsOf()) === show(['2:no_lessons_3d', '3:no_lessons_3d', '3:no_lessons_3d']),
     'BEFORE, the open alerts read failing: the open alert is inserted (and posted) a second time', show(alertsOf()))
  db = engDb()
  db.failWhen = failing((r) => r.table === 'disengagement_alerts')
  const r = await run(ENG.now, 'check-engagement')
  ok(stoppedClean(r, FAILED_READ) && show(alertsOf()) === show(OPEN_ONLY), 'NOW: a 500, cron_runs failed, and nothing written', told(r))
}
{
  db = engDb()
  db.failWhen = failing((r) => r.table === 'students')
  const r = await run(ENG.now, 'check-engagement')
  ok(stoppedClean(r, FAILED_READ), 'NOW, the student pool read failing: the same (as it already was)', told(r))
}
{
  // The /admin/discord toggles (cron-1, review of 20 October): both switches
  // in one request, key=in.(dms_master_enabled,engagement_alerts_enabled).
  // The course switch's row is its own request (key=eq.curriculum_reset_at).
  const toggles = (r) => r.table === 'admin_config' && (param(r, 'key') ?? '').startsWith('in.')
  db = engDb()
  db.failWhen = failing(toggles)
  const before = await run(ENG.before, 'check-engagement')
  ok(show(alertsOf()) === show(['2:no_lessons_3d', '3:no_lessons_3d']) && before.body.discord_reason === 'paused-by-toggle' && theRun().status === 'success',
     'BEFORE, the toggles read failing: the new alert is inserted, taken as paused, never posted (an open alert is never posted again), and the run says success',
     show({ alerts: alertsOf(), reason: before.body.discord_reason, run: theRun().status }))
  db = engDb()
  db.failWhen = failing(toggles)
  const r = await run(ENG.now, 'check-engagement')
  ok(stoppedClean(r, FAILED_READ) && r.body.error.startsWith('Discord toggles fetch failed') && show(alertsOf()) === show(OPEN_ONLY),
     'NOW: the toggles are read before the insert, so the run stops with a 500, cron_runs failed with the reason, and nothing written', told(r))
  db.failWhen = null
  const next = await run(ENG.now, 'check-engagement')
  ok(next.status === 200 && show(alertsOf()) === show(['2:no_lessons_3d', '3:no_lessons_3d']) && theRun().status === 'success',
     'the next run, the read answering: the same alert is found and inserted', show(alertsOf()))
}
{
  // The other callers (day28-dm, and the summary posts of check-csm-tasks and
  // check-na-tasks) keep isDmEnabled, which answers a failed read with "off".
  const { isDmEnabled, readDmEnabled } = await import('./_gen/dm-toggles.ts')
  const { createServiceClient } = await import('./_gen/supabase-server.ts')
  db = new StandInDb({ admin_config: [{ key: 'dms_master_enabled', value: 'true' }, { key: 'csm_task_summary_enabled', value: 'true' }] })
  const sb = createServiceClient()
  const on = [await isDmEnabled(sb, 'csm_task_summary_enabled'), await readDmEnabled(sb, 'csm_task_summary_enabled')]
  db.failWhen = failing((r) => r.table === 'admin_config')
  const failed = [await isDmEnabled(sb, 'csm_task_summary_enabled'), await readDmEnabled(sb, 'csm_task_summary_enabled')]
  ok(on[0] === true && show(on[1]) === show({ enabled: true, error: null }) && failed[0] === false && show(failed[1]) === show({ enabled: false, error: FAILED_READ }),
     'isDmEnabled as before: on when both switches are on, off on a failed read; readDmEnabled gives the same answer and the error',
     show({ on, failed }))
}
{
  // 250 students, each with an alert already open: no new one is due.
  const ids = Array.from({ length: 250 }, (_, i) => uuid('d4', i))
  const big = () => new StandInDb({
    students: ids.map((id) => student(id)),
    student_lesson_completions: [],
    disengagement_alerts: ids.map((id, i) => ({ id: `open-${i}`, student_id: id, alert_type: 'no_lessons_3d', message: 'earlier', is_dismissed: false })),
    admin_config: OFF, cron_runs: [],
  })
  db = big()
  await run(ENG.before, 'check-engagement')
  const oldRead = db.reads('disengagement_alerts')
  ok(oldRead.length === 1 && oldRead[0].status === 414 && db.rows('disengagement_alerts').length === 500,
     'BEFORE, 250 students: the open alerts read is refused (414, past 8 KB), and all 250 alerts are inserted again',
     `${oldRead[0]?.requestLine} characters`)
  db = big()
  const r = await run(ENG.now, 'check-engagement')
  const reads = db.reads('disengagement_alerts')
  ok(r.status === 200 && reads.length === 3 && Math.max(...reads.map((q) => q.requestLine)) < 4500
     && r.body.alerts === 0 && db.rows('disengagement_alerts').length === 250,
     'NOW: 3 requests, each under 4,500 characters, and no alert twice', `${reads.length} reads, ${r.body.alerts} new`)
}

// ════════════════════════════ check-csm-tasks ════════════════════════════
console.log('\n=== check-csm-tasks: the completions and the past-due canceling students ===')
const C_W = uuid('e5', 1) // logged in, watched two lessons, Day 3
const C_Z = uuid('e5', 2) // logged in, nothing watched, Day 3
const C_P = uuid('e5', 3) // past_due and canceling, holding a save task
const SAVE = { id: 't-save', scenario_id: 'save.canceling', bucket: 'cancel_path', is_custom: true, is_active: true, is_admin_only: false, trigger_config: { all: [{ metric: 'is_canceling', op: 'is' }] } }
const csmDb = () => new StandInDb({
  admin_config: [...OFF, { key: 'curriculum_reset_at', value: iso(NOW - 20 * D) }],
  regions: [{ id: 'a1', order_num: 1 }, { id: 'a2', order_num: 2 }],
  lessons: ['a1l01', 'a1l02', 'a2l01'].map((id) => ({ id, region_id: id.slice(0, 2), requires_action: false, counts_toward_progress: true })),
  templates: [{ id: 't-nl3', scenario_id: 'nolessons.day3', bucket: 'at_risk', is_custom: false, is_active: true, is_admin_only: false, trigger_config: null }, SAVE],
  students: [student(C_W), student(C_Z), student(C_P, { membership_status: 'past_due', cancel_scheduled_at: iso(NOW - D) })],
  student_milestones: [C_W, C_Z].map((id) => ({ student_id: id, first_sprint_login_at: iso(NOW - 2 * D) })),
  student_lesson_completions: ['a1l01', 'a1l02'].map((l) => ({ student_id: C_W, lesson_id: l, completed_at: iso(NOW - D), action_completed_at: null, skipped_at: null })),
  tasks: [{ id: 'task-save', student_id: C_P, scenario_id: 'save.canceling', template_id: 't-save', status: 'open', created_at: iso(NOW - D), dismissed_at: null, notes: null }],
  disengagement_alerts: [], cron_runs: [],
})
const csmTasks = () => db.rows('tasks').map((t) => `${t.student_id.slice(-1)}:${t.scenario_id}:${t.status}`).sort()
const CSM_RIGHT = ['2:nolessons.day3:open', '3:save.canceling:open']
{
  db = csmDb()
  const r = await run(CSM.now, 'check-csm-tasks')
  ok(r.status === 200 && show(csmTasks()) === show(CSM_RIGHT) && theRun().status === 'success',
     'the reads answer: a nolessons task for the student with 0 lessons, the save task kept', show(csmTasks()))
}
{
  db = csmDb()
  db.failWhen = failing((r) => r.table === 'student_lesson_completions' && param(r, 'student_id') === `eq.${C_W}`)
  await run(CSM.before, 'check-csm-tasks')
  ok(csmTasks().includes('1:nolessons.day3:open') && theRun().status === 'success',
     'BEFORE, one student\'s completions read failing: the student who watched two lessons gets a nolessons task, and the run says success', show(csmTasks()))
  db = csmDb()
  db.failWhen = failing((r) => r.table === 'student_lesson_completions' && param(r, 'student_id') === `eq.${C_W}`)
  const r = await run(CSM.now, 'check-csm-tasks')
  ok(stoppedClean(r, FAILED_READ) && show(csmTasks()) === show(['3:save.canceling:open']),
     'NOW: a 500, cron_runs failed with the reason, and nothing written', told(r))
}
{
  const pastDue = (r) => r.table === 'students' && param(r, 'membership_status') === 'eq.past_due'
  db = csmDb()
  db.failWhen = failing(pastDue)
  await run(CSM.before, 'check-csm-tasks')
  const save = db.rows('tasks').find((t) => t.id === 'task-save')
  ok(save.status === 'dismissed' && save.notes === 'Auto-dismissed: student no longer in eligible pool.' && theRun().status === 'success',
     'BEFORE, the past-due canceling read failing: the save task is dismissed for good, and the run says success', show({ status: save.status, notes: save.notes }))
  db = csmDb()
  db.failWhen = failing(pastDue)
  const r = await run(CSM.now, 'check-csm-tasks')
  ok(stoppedClean(r, FAILED_READ) && show(csmTasks()) === show(['3:save.canceling:open']),
     'NOW: read before section 3 writes anything, so the run stops with a 500, cron_runs failed, and nothing written', told(r))
}
for (const [what, match] of [
  ['the student pool read', (r) => r.table === 'students' && param(r, 'membership_status') === 'eq.active'],
  ['the milestones read', (r) => r.table === 'student_milestones'],
]) {
  db = csmDb()
  db.failWhen = failing(match)
  const r = await run(CSM.now, 'check-csm-tasks')
  ok(stoppedClean(r, FAILED_READ), `NOW, ${what} failing: the same (as it already was)`, told(r))
}

console.log('\n=== The copies made with dropComments ===')
{
  const copies = ['check-na-tasks-route.ts', 'check-na-tasks-route.old.ts', 'check-csm-tasks-route.ts', 'check-csm-tasks-route.old.ts', 'dm-toggles.ts']
  const left = copies.map((f) => fs.readFileSync(here(`./_gen/${f}`), 'utf8').split('\n').filter((l) => /^(\/\/|\/\*|\*)/.test(l.trimStart())).length)
  ok(left.every((n) => n === 0), 'the five copies keep no comment line (each ran above, so their code works)', show(left))
  // "* 2" starts like a comment line but is code: the source says 1 * 2.
  let refused = ''
  try { write('export const a = 1\n  * 2\n', 'a made-up source', './_gen/never-written.ts', [], { dropComments: true }) } catch (e) { refused = e.message }
  ok(/would change its code/.test(refused) && !fs.existsSync(here('./_gen/never-written.ts')),
     'a code line that starts with * is never left out: the copy is refused and not written', refused)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
