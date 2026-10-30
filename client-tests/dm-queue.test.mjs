// dm-queue.test.mjs: the team's DM queue (2026-10-30, the owner's calls of
// 29 October). Three things were wrong, each run here through the two crons'
// real GET:
//
//   1. Whop watchers. check-na-tasks ("never signed in") read no lessons, so a
//      student watching on Whop kept getting "where to start" DMs. Now one
//      with any finished lesson gets no stalled.* task, their open ones are
//      dismissed, and ONE whop.watcher note is queued, once ever, from day 3,
//      while their 30% is still open to them (window, no request, no coupon
//      on the stored answer). check-csm-tasks 3c dismisses an open note once
//      the window closes or they apply.
//   2. On/off (T-106). check-csm-tasks' alerts (step 1) and built-in rules
//      (step 2a) found their template by scenario, on or off, so
//      nolessons.day14 kept coming after it was turned off. check-na-tasks
//      wrote an error entry for every student on a tier that is off.
//   3. Duplicates. A task marked sent came back at the next run while the
//      rule still held (check-na-tasks read no tasks; the alert path read
//      none either), and a task a team member dismissed came back too. Now
//      one rule in src/lib/dm-queue.ts, used by both crons right before they
//      insert: no task for a message the student already had (open, sent, or
//      dismissed by a team member), where the day-3 texts of stalled.discord,
//      stalled.whop and nolessons are one message, and so are the day-7 ones.
//      A task the app or the v109 reset dismissed (dismissed_by null) does
//      not count, so the queue refills after a reset.
//
// The crons run as they are: the real routes and the libraries they import,
// copied with their import lines pointed at the copies (the same copies
// cron-failed-reads.test.mjs writes, comment lines left out of the routes),
// a real supabase-js client, and the stand-in network of _gen/stub-cron.ts
// (see engagement-alerts.test.mjs). Each route as it was at BASE (production,
// 6c07e7a) is taken from git and run on the same database where a rule
// changed, to show it failing there.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const BASE = '6c07e7a'
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const fromBase = (rel) => execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: here('..'), encoding: 'utf8' })
// As in cron-failed-reads.test.mjs: dropComments leaves out every comment
// line of a copy (some name team members, and this repository is public),
// checked to leave the code unchanged.
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

// The library copies, byte for byte those of cron-failed-reads.test.mjs and build.mjs.
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
  ['src/lib/dm-queue.ts', './_gen/dm-queue.ts', []],
  ['src/lib/world/discount.ts', './_gen/discount.ts', [['from "@/lib/constants"', 'from "./constants.ts"']]],
  ['src/lib/whop-members.ts', './_gen/whop-members.ts', [], { dropComments: true }],
  ['src/lib/whop-products.ts', './_gen/whop-products.ts', []],
  ['src/lib/first-payment.ts', './_gen/first-payment.ts', [['from "@/lib/whop-members"', 'from "./whop-members.ts"']]],
  ['src/lib/membership-discount.ts', './_gen/membership-discount.ts', [
    ['from "@/lib/world/discount"', 'from "./discount.ts"'],
    ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
    ['from "@/lib/first-payment"', 'from "./first-payment.ts"'],
    ['from "@/lib/whop-members"', 'from "./whop-members.ts"'],
    ['from "@/lib/whop-products"', 'from "./whop-products.ts"'],
  ]],
]
for (const [src, out, rw, opts] of LIBS) write(fromSrc(src), src, out, rw, opts)
const COMMON = [
  ['from "next/server"', 'from "./stub-cron.ts"'],
  ['from "@/lib/supabase-server"', 'from "./supabase-server.ts"'],
  ['from "@/lib/discord"', 'from "./discord.ts"'],
  ['from "@/lib/dm-toggles"', 'from "./dm-toggles.ts"'],
  ['from "@/lib/admin/metrics-definitions"', 'from "./metrics-definitions.ts"'],
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ['from "@/lib/cron-auth"', 'from "./cron-auth.ts"'],
]
// For each route: the rewrites both copies need, then those only the copy of now needs.
const ROUTES = {
  na: ['src/app/api/cron/check-na-tasks/route.ts', 'check-na-tasks-route', [], [
    ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
    ['from "@/lib/world/discount"', 'from "./discount.ts"'],
    ['from "@/lib/membership-discount"', 'from "./membership-discount.ts"'],
    ['from "@/lib/dm-queue"', 'from "./dm-queue.ts"'],
  ]],
  csm: ['src/app/api/cron/check-csm-tasks/route.ts', 'check-csm-tasks-route', [
    ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
    ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
    ['from "@/lib/csm-triggers"', 'from "./csm-triggers.ts"'],
    ['"@/types/database"', '"./types-erased.ts"'],
  ], [
    ['from "@/lib/world/discount"', 'from "./discount.ts"'],
    ['from "@/lib/dm-queue"', 'from "./dm-queue.ts"'],
  ]],
}
for (const [src, out, both, nowOnly] of Object.values(ROUTES)) {
  write(fromSrc(src), src, `./_gen/${out}.ts`, [...COMMON, ...both, ...nowOnly], { dropComments: true })
  write(fromBase(src), `${src}@${BASE}`, `./_gen/${out}.${BASE}.ts`, [...COMMON, ...both], { dropComments: true })
}

const SECRET = 'cron-secret-for-the-test'
process.env.CRON_SECRET = SECRET
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-the-test'
process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
process.env.DISCORD_TEAM_WEBHOOK_URL = 'https://discord.test/api/webhooks/1/stand-in'

const { StandInDb, StandInDiscord, installNetwork } = await import('./_gen/stub-cron.ts')
const QUEUE = await import('./_gen/dm-queue.ts')
const NOW_ROUTES = { na: await import('./_gen/check-na-tasks-route.ts'), csm: await import('./_gen/check-csm-tasks-route.ts') }
const BASE_ROUTES = { na: await import(`./_gen/check-na-tasks-route.${BASE}.ts`), csm: await import(`./_gen/check-csm-tasks-route.${BASE}.ts`) }

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

let db = null
installNetwork({ db: () => db, discord: () => new StandInDiscord() })
async function run(routes, name) {
  const route = name === 'na' ? routes.na : routes.csm
  const path = name === 'na' ? 'check-na-tasks' : 'check-csm-tasks'
  const res = await route.GET(new Request(`http://app.test/api/cron/${path}`, { headers: { authorization: `Bearer ${SECRET}` } }))
  return { status: res.status, body: await res.json() }
}

/**
 * One rule: `check` seeds the stand-in database, runs a route and says
 * { pass, detail }. It runs on the routes of now and must pass; with
 * `failsAtBase` it runs on BASE's too, where it must fail.
 */
async function rule(label, check, { failsAtBase = false } = {}) {
  const now = await check(NOW_ROUTES)
  ok(now.pass, label, now.detail)
  if (failsAtBase) {
    const before = await check(BASE_ROUTES)
    ok(!before.pass, `  at ${BASE} it fails: ${label}`, before.detail)
  }
}

const H = 3_600_000
const D = 24 * H
const NOW = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const PLAN = 'plan_4ZrwR4PmBsVsx'
const TEAM = '7e000000-0000-4000-8000-000000000001'
let serial = 0
const sid = (tag) => `5d000000-0000-4000-8000-${String(++serial).padStart(8, '0')}${tag.padStart(4, '0').slice(-4)}`
/** First paid so that sprintDayNumber (and the course day, the switch being 25 days ago) says `day`. */
const paidOnDay = (day) => iso(NOW - (day - 0.5) * D)
const student = (id, day, o = {}) => ({
  id, name: `Student ${id.slice(-4)}`, email: null, discord_username: null, membership_status: 'active', whop_plan_id: PLAN,
  high_churn_risk: false, csm_exempt: false, cancel_scheduled_at: null, whop_membership_id: null,
  created_at: paidOnDay(day), first_paid_at: paidOnDay(day), joined_at: paidOnDay(day), last_active_at: iso(NOW - H), ...o,
})

// The templates as they are since messages_v4.sql (2026-10-30): day 3 and 7
// on, day 5, day 10 and nolessons.day14 off, whop.watcher on.
const TEMPLATES = [
  ['stalled.discord.day3', true], ['stalled.whop.day3', true], ['stalled.discord.day5', false], ['stalled.whop.day5', false],
  ['stalled.discord.day7', true], ['stalled.whop.day7', true], ['stalled.discord.day10', false], ['stalled.whop.day10', false],
  ['nolessons.day3', true], ['nolessons.day7', true], ['nolessons.day14', false], ['whop.watcher', true],
].map(([scenario_id, is_active]) => ({
  id: `tpl-${scenario_id}`, scenario_id, is_custom: false, is_active, is_admin_only: false, trigger_config: null,
  bucket: scenario_id === 'whop.watcher' ? 'on_track' : scenario_id.startsWith('stalled.') ? 'cancel_path' : 'at_risk',
}))
const SAVE = {
  id: 'tpl-C-0a1b2c', scenario_id: 'C-0a1b2c', bucket: 'cancel_path', is_custom: true, is_active: true, is_admin_only: false,
  trigger_config: { all: [{ metric: 'is_canceling', op: 'is' }] },
}
const LESSONS = ['a1l01', 'a1l02', 'a1l03', 'a2l01'].map((id) => ({ id, region_id: id.slice(0, 2), requires_action: false, counts_toward_progress: true }))

/** A task in one of the states the rule tells apart. */
function task(studentId, scenario_id, state, o = {}) {
  const base = {
    id: `task-${++serial}`, student_id: studentId, scenario_id, template_id: `tpl-${scenario_id}`, status: 'open',
    behavior_summary: 'earlier', created_at: iso(NOW - D), completed_at: null, completed_by: null,
    dismissed_at: null, dismissed_by: null, notes: null,
  }
  const states = {
    open: {},
    sent: { status: 'completed', completed_at: iso(NOW - 2 * H), completed_by: TEAM },
    'team-dismissed': { status: 'dismissed', dismissed_at: iso(NOW - 2 * H), dismissed_by: TEAM, notes: 'Not for this student.' },
    'app-dismissed': { status: 'dismissed', dismissed_at: iso(NOW - 2 * H), notes: 'Auto-dismissed: student no longer in eligible pool.' },
    reset: { status: 'dismissed', dismissed_at: iso(NOW - 2 * H), notes: ' [reset for the new program]' },
  }
  return { ...base, ...states[state], ...o }
}

/** The stand-in database both crons read: the new course (switched 25 days ago), the templates above. */
function world({ students = [], loggedIn = [], lessons = {}, tasks = [], alerts = [], requests = [], coupons = [], templates = TEMPLATES } = {}) {
  return new StandInDb({
    admin_config: [{ key: 'dms_master_enabled', value: 'false' }, { key: 'curriculum_reset_at', value: iso(NOW - 25 * D) }],
    regions: [{ id: 'a1', order_num: 1 }, { id: 'a2', order_num: 2 }],
    lessons: LESSONS,
    templates,
    students,
    student_milestones: loggedIn.map((id) => ({ student_id: id, first_sprint_login_at: iso(NOW - 2 * H) })),
    student_lesson_completions: Object.entries(lessons).flatMap(([student_id, ids]) => ids.map((lesson_id) => ({
      student_id, lesson_id, completed_at: iso(NOW - D), action_completed_at: null, skipped_at: null,
    }))),
    tasks,
    disengagement_alerts: alerts.map(([student_id, alert_type], i) => ({
      id: `alert-${i}`, student_id, alert_type, message: 'flagged', is_dismissed: false, created_at: iso(NOW - H),
    })),
    discount_requests: requests,
    student_membership_discounts: coupons,
    cron_runs: [],
  })
}
/** A student's tasks as scenario:status, oldest first. */
const tasksOf = (id) => db.rows('tasks').filter((t) => t.student_id === id).map((t) => `${t.scenario_id}:${t.status}`)
const openOf = (id) => db.rows('tasks').filter((t) => t.student_id === id && t.status === 'open').map((t) => t.scenario_id)
/** Marks the student's open task of `scenario` sent, as Mark sent does. */
function markSent(id, scenario) {
  const t = db.rows('tasks').find((k) => k.student_id === id && k.scenario_id === scenario && k.status === 'open')
  Object.assign(t, { status: 'completed', completed_at: iso(Date.now()), completed_by: TEAM })
}
const FAILED_READ = 'stand-in: the read failed'
const failing = (match) => (r) => (r.method === 'GET' && match(r) ? { status: 500, body: JSON.stringify({ code: 'XX000', details: null, hint: null, message: FAILED_READ }) } : null)
/**
 * A team member marks these tasks sent at the moment a cron's update of them
 * arrives: the race between the cron's read and its write. The update then
 * goes on as sent.
 */
const sentMidRun = (ids) => (r) => {
  if (r.method === 'PATCH' && r.table === 'tasks') {
    const id = (r.url.searchParams.get('id') ?? '').replace(/^eq\./, '')
    const t = db.rows('tasks').find((k) => k.id === id && ids.includes(k.id) && k.status === 'open')
    if (t) Object.assign(t, { status: 'completed', completed_at: iso(Date.now()), completed_by: TEAM })
  }
  return null
}

// ═══════════════════════════ the rule itself ═══════════════════════════
console.log('\n=== src/lib/dm-queue.ts: what counts as a message already had ===')
{
  const s = 'student-1'
  const had = (state, scenario = 'stalled.whop.day3') => QUEUE.messagesHad([{ ...task(s, scenario, state) }])
  ok(had('open').has(s, 'stalled.whop.day3') && had('sent').has(s, 'stalled.whop.day3') && had('team-dismissed').has(s, 'stalled.whop.day3'),
     'open, sent and dismissed by a team member: had')
  ok(!had('app-dismissed').has(s, 'stalled.whop.day3') && !had('reset').has(s, 'stalled.whop.day3'),
     'dismissed by the app or by the reset (dismissed_by null): not had')
  ok(['stalled.discord.day3', 'nolessons.day3'].every((x) => had('sent').has(s, x)) && !had('sent').has(s, 'stalled.whop.day7')
       && ['stalled.discord.day7', 'stalled.whop.day7'].every((x) => had('sent', 'nolessons.day7').has(s, x)),
     'the day-3 texts are one message, and so are the day-7 ones; day 3 is not day 7')
  ok(!had('sent', 'stalled.whop.day5').has(s, 'stalled.discord.day5') && !had('sent', 'nolessons.day14').has(s, 'nolessons.day7')
       && !had('sent').has('student-2', 'stalled.whop.day3'),
     'every other scenario is its own message, and one student\'s tasks say nothing about another\'s')
  const h = QUEUE.messagesHad([])
  h.add(s, 'nolessons.day3')
  ok(h.has(s, 'stalled.whop.day3'), 'a task made in the run counts at once')
}

// ═══════════════════════════ check-na-tasks ═══════════════════════════
console.log('\n=== check-na-tasks: a student who has not started (0 lessons, never signed in) ===')
await rule('day 3 on Whop: stalled.whop.day3; with Discord: stalled.discord.day3', async (R) => {
  const a = sid('w3'), b = sid('d3')
  db = world({ students: [student(a, 3), student(b, 3, { discord_username: 'someone' })] })
  const r = await run(R, 'na')
  return { pass: r.status === 200 && show(openOf(a)) === show(['stalled.whop.day3']) && show(openOf(b)) === show(['stalled.discord.day3']),
    detail: show({ whop: tasksOf(a), discord: tasksOf(b) }) }
})
await rule('marked sent, then the next run on the same day: nothing new', async (R) => {
  const a = sid('ms')
  db = world({ students: [student(a, 3)] })
  await run(R, 'na')
  markSent(a, 'stalled.whop.day3')
  await run(R, 'na')
  await run(R, 'na')
  return { pass: show(tasksOf(a)) === show(['stalled.whop.day3:completed']), detail: show(tasksOf(a)) }
}, { failsAtBase: true })
await rule('day 3 sent on Whop, then they join Discord: no stalled.discord.day3 (the same text)', async (R) => {
  const a = sid('cj')
  db = world({ students: [student(a, 3, { discord_username: 'joined' })], tasks: [task(a, 'stalled.whop.day3', 'sent')] })
  await run(R, 'na')
  return { pass: show(tasksOf(a)) === show(['stalled.whop.day3:completed']), detail: show(tasksOf(a)) }
}, { failsAtBase: true })
await rule('day 3 dismissed by a team member: not queued again', async (R) => {
  const a = sid('td')
  db = world({ students: [student(a, 3)], tasks: [task(a, 'stalled.whop.day3', 'team-dismissed')] })
  await run(R, 'na')
  return { pass: show(tasksOf(a)) === show(['stalled.whop.day3:dismissed']), detail: show(tasksOf(a)) }
}, { failsAtBase: true })
await rule('day 3 dismissed by the app, or by the reset of 2026-10-30: queued again while the rule holds', async (R) => {
  const a = sid('ad'), b = sid('rs')
  db = world({ students: [student(a, 3), student(b, 3)], tasks: [task(a, 'stalled.whop.day3', 'app-dismissed'), task(b, 'stalled.whop.day3', 'reset')] })
  await run(R, 'na')
  return { pass: show(openOf(a)) === show(['stalled.whop.day3']) && show(openOf(b)) === show(['stalled.whop.day3']),
    detail: show({ app: tasksOf(a), reset: tasksOf(b) }) }
})
await rule('day 7: stalled.whop.day7 (on), beside a day 3 already sent', async (R) => {
  const a = sid('d7')
  db = world({ students: [student(a, 7)], tasks: [task(a, 'stalled.whop.day3', 'sent')] })
  await run(R, 'na')
  return { pass: show(tasksOf(a)) === show(['stalled.whop.day3:completed', 'stalled.whop.day7:open']), detail: show(tasksOf(a)) }
})
await rule('day 5 and day 11 (day 10\'s tier), both off: no task and no entry in errors', async (R) => {
  const a = sid('d5'), b = sid('d11')
  db = world({ students: [student(a, 5), student(b, 11, { discord_username: 'x' })] })
  const r = await run(R, 'na')
  return { pass: r.status === 200 && db.rows('tasks').length === 0 && r.body.errors === undefined && db.rows('cron_runs').at(-1).status === 'success',
    detail: show({ tasks: db.rows('tasks').length, errors: r.body.errors }) }
}, { failsAtBase: true })
await rule('a scenario with no template at all is still an error', async (R) => {
  const a = sid('nt')
  db = world({ students: [student(a, 3)], templates: TEMPLATES.filter((t) => t.scenario_id !== 'stalled.whop.day3') })
  const r = await run(R, 'na')
  return { pass: db.rows('tasks').length === 0 && r.body.errors?.length === 1 && r.body.errors[0].includes('stalled.whop.day3'), detail: show(r.body.errors) }
})

console.log('\n=== check-na-tasks: a Whop watcher (never signed in, lessons finished) ===')
await rule('day 3, 2 lessons, an open stalled task: the stalled task dismissed, ONE whop.watcher; a second and third run add nothing', async (R) => {
  const a = sid('wa')
  db = world({ students: [student(a, 3)], lessons: { [a]: ['a1l01', 'a1l02'] }, tasks: [task(a, 'stalled.whop.day3', 'open')] })
  const first = await run(R, 'na')
  const after1 = tasksOf(a)
  await run(R, 'na')
  await run(R, 'na')
  const stalled = db.rows('tasks').find((t) => t.student_id === a && t.scenario_id === 'stalled.whop.day3')
  const note = db.rows('tasks').find((t) => t.student_id === a && t.scenario_id === 'whop.watcher')
  return {
    pass: show(after1) === show(['stalled.whop.day3:dismissed', 'whop.watcher:open']) && show(tasksOf(a)) === show(after1)
      && stalled.dismissed_by === null && stalled.notes === 'Auto-dismissed: the student has watched lessons on Whop, so no stalled message goes to them.'
      && note.template_id === 'tpl-whop.watcher' && note.behavior_summary === 'Day 3. Never signed in to the app, 2 lessons watched on Whop.'
      && first.body.whop_watcher === 1 && first.body.stalled_dismissed === 1,
    detail: show({ after1, after3: tasksOf(a), summary: note?.behavior_summary, answer: [first.body.whop_watcher, first.body.stalled_dismissed] }),
  }
}, { failsAtBase: true })
await rule('the stalled task\'s dismissal fails: an entry in errors and no note beside the stalled task that run; the next run dismisses it and queues the note', async (R) => {
  const a = sid('df')
  db = world({ students: [student(a, 3)], lessons: { [a]: ['a1l01'] }, tasks: [task(a, 'stalled.whop.day3', 'open')] })
  db.failWhen = (r) => (r.method === 'PATCH' && r.table === 'tasks'
    ? { status: 500, body: JSON.stringify({ code: 'XX000', details: null, hint: null, message: 'stand-in: the write failed' }) } : null)
  const first = await run(R, 'na')
  const after1 = tasksOf(a)
  db.failWhen = null
  await run(R, 'na')
  return { pass: show(after1) === show(['stalled.whop.day3:open']) && first.body.errors?.length === 1 && first.body.whop_watcher === 0
      && show(tasksOf(a)) === show(['stalled.whop.day3:dismissed', 'whop.watcher:open']),
    detail: show({ after1, errors: first.body.errors, after2: tasksOf(a) }) }
})
await rule('the team marks the stalled task sent while the run is going: it stays sent, and stalled_dismissed counts only a task the run dismissed', async (R) => {
  const a = sid('rs')
  db = world({ students: [student(a, 3)], lessons: { [a]: ['a1l01'] }, tasks: [task(a, 'stalled.whop.day3', 'open', { id: 'task-raced-na' })] })
  db.failWhen = sentMidRun(['task-raced-na'])
  const r = await run(R, 'na')
  const stalled = db.rows('tasks').find((t) => t.id === 'task-raced-na')
  return { pass: stalled.status === 'completed' && stalled.dismissed_at === null && r.body.stalled_dismissed === 0,
    detail: show({ stalled: `${stalled.status}, dismissed_at ${stalled.dismissed_at}`, stalled_dismissed: r.body.stalled_dismissed }) }
})
await rule('day 5 (a day that is off), 1 lesson: the note, and no error', async (R) => {
  const a = sid('w5')
  db = world({ students: [student(a, 5)], lessons: { [a]: ['a2l01'] } })
  const r = await run(R, 'na')
  return { pass: show(tasksOf(a)) === show(['whop.watcher:open']) && r.body.errors === undefined
      && db.rows('tasks')[0].behavior_summary === 'Day 5. Never signed in to the app, 1 lesson watched on Whop.',
    detail: show({ tasks: tasksOf(a), errors: r.body.errors }) }
}, { failsAtBase: true })
await rule('day 7 with lessons: no stalled.whop.day7 (BEFORE: "the first lesson is still here" to a student 3 lessons in)', async (R) => {
  const a = sid('w7')
  db = world({ students: [student(a, 7)], lessons: { [a]: ['a1l01', 'a1l02', 'a1l03'] }, tasks: [task(a, 'whop.watcher', 'sent')] })
  await run(R, 'na')
  return { pass: show(tasksOf(a)) === show(['whop.watcher:completed']), detail: show(tasksOf(a)) }
}, { failsAtBase: true })
await rule('a skipped lesson counts too, as the nolessons.* rules count it', async (R) => {
  const a = sid('sk')
  db = world({ students: [student(a, 3)] })
  db.rows('student_lesson_completions').push({ student_id: a, lesson_id: 'a1l01', completed_at: null, action_completed_at: null, skipped_at: iso(NOW - D) })
  db.rows('student_lesson_completions').push({ student_id: a, lesson_id: 'a1l02', completed_at: null, action_completed_at: iso(NOW - D), skipped_at: null })
  await run(R, 'na')
  return { pass: show(tasksOf(a)) === show(['whop.watcher:open']) && db.rows('tasks')[0].behavior_summary.endsWith('1 lesson watched on Whop.'),
    detail: show(db.rows('tasks').map((t) => t.behavior_summary)) }
})
for (const [state, label] of [['sent', 'sent'], ['team-dismissed', 'dismissed by a team member'], ['app-dismissed', 'dismissed by the app']]) {
  await rule(`whop.watcher ${label}: never queued again`, async (R) => {
    const a = sid('wx')
    db = world({ students: [student(a, 4)], lessons: { [a]: ['a1l01'] }, tasks: [task(a, 'whop.watcher', state)] })
    await run(R, 'na')
    await run(R, 'na')
    return { pass: tasksOf(a).length === 1 && tasksOf(a)[0].startsWith('whop.watcher:'), detail: show(tasksOf(a)) }
  })
}
for (const [scenario, state, label] of [['stalled.discord.day3', 'sent', 'sent on Discord'], ['stalled.whop.day3', 'team-dismissed', 'dismissed by a team member'], ['nolessons.day3', 'sent', 'sent as the no-lessons version']]) {
  await rule(`a student who had the day 3 message (${label}) and then watches on Whop: no whop.watcher note, no stalled task`, async (R) => {
    const a = sid('d3')
    db = world({ students: [student(a, 5)], lessons: { [a]: ['a1l01', 'a1l02'] }, tasks: [task(a, scenario, state)] })
    await run(R, 'na')
    await run(R, 'na')
    return { pass: tasksOf(a).length === 1 && tasksOf(a)[0].startsWith(`${scenario}:`), detail: show(tasksOf(a)) }
  })
}
await rule('an OPEN, unsent stalled day 3 task does not block the note: it is dismissed and the note queued', async (R) => {
  const a = sid('d3o')
  db = world({ students: [student(a, 4)], lessons: { [a]: ['a1l01'] }, tasks: [task(a, 'stalled.whop.day3', 'open')] })
  await run(R, 'na')
  return { pass: show(tasksOf(a)) === show(['stalled.whop.day3:dismissed', 'whop.watcher:open']), detail: show(tasksOf(a)) }
})
await rule('day 2: nothing yet (the note waits for day 3), and no stalled task either', async (R) => {
  const a = sid('w2')
  db = world({ students: [student(a, 2)], lessons: { [a]: ['a1l01'] } })
  await run(R, 'na')
  return { pass: tasksOf(a).length === 0, detail: show(tasksOf(a)) }
})
await rule('the 30% window closed (day 16, 14 days from the first payment): no note', async (R) => {
  const a = sid('wc')
  db = world({ students: [student(a, 16)], lessons: { [a]: ['a1l01'] } })
  await run(R, 'na')
  return { pass: tasksOf(a).length === 0, detail: show(tasksOf(a)) }
})
await rule('applied (a pending, approved or applied request): no note; a rejected one does not stop it', async (R) => {
  const ids = ['pending', 'approved', 'applied', 'rejected'].map((s) => [sid(s.slice(0, 2)), s])
  db = world({
    students: ids.map(([id]) => student(id, 5)),
    lessons: Object.fromEntries(ids.map(([id]) => [id, ['a1l01']])),
    requests: ids.map(([id, status], i) => ({ id: `req-${i}`, student_id: id, status, created_at: iso(NOW - D) })),
  })
  await run(R, 'na')
  const got = ids.map(([id, status]) => `${status}:${tasksOf(id).join(',') || 'none'}`)
  return { pass: show(got) === show(['pending:none', 'approved:none', 'applied:none', 'rejected:whop.watcher:open']), detail: show(got) }
})
await rule('the stored coupon answer: a discount on the renewal or the unpaid answer, on the membership on file, closes it; none, another membership\'s, or a no coupon with a price does not', async (R) => {
  const cases = [
    ['discounted', { whop_membership_id: 'mem_aaa111', discounted: true, promo_code_id: 'promo_x', renewal_price: 67.9 }, 'mem_aaa111'],
    ['unpaid', { whop_membership_id: 'mem_aaa222', discounted: false, promo_code_id: null, renewal_price: null }, 'mem_aaa222'],
    ['no membership on file, discounted', { whop_membership_id: 'mem_aaa333', discounted: true, promo_code_id: 'promo_y', renewal_price: 67.9 }, null],
    ['another membership', { whop_membership_id: 'mem_old999', discounted: true, promo_code_id: 'promo_z', renewal_price: 67.9 }, 'mem_new999'],
    ['no coupon, full price', { whop_membership_id: 'mem_aaa444', discounted: false, promo_code_id: null, renewal_price: 97 }, 'mem_aaa444'],
    ['no row', null, 'mem_aaa555'],
  ].map(([label, row, membership]) => ({ label, row, membership, id: sid('cp') }))
  db = world({
    students: cases.map((c) => student(c.id, 4, { whop_membership_id: c.membership })),
    lessons: Object.fromEntries(cases.map((c) => [c.id, ['a1l01']])),
    coupons: cases.filter((c) => c.row).map((c) => ({ student_id: c.id, ...c.row })),
  })
  await run(R, 'na')
  const got = cases.map((c) => `${c.label}: ${tasksOf(c.id).length ? 'note' : 'none'}`)
  return { pass: show(got) === show(['discounted: none', 'unpaid: none', 'no membership on file, discounted: none', 'another membership: note', 'no coupon, full price: note', 'no row: note']),
    detail: show(got) }
})
await rule('canceling, or the note switched off: nothing, and no error', async (R) => {
  const a = sid('cn'), b = sid('of')
  db = world({ students: [student(a, 4, { cancel_scheduled_at: iso(NOW - H) })], lessons: { [a]: ['a1l01'] } })
  await run(R, 'na')
  const canceling = tasksOf(a)
  db = world({ students: [student(b, 4)], lessons: { [b]: ['a1l01'] }, templates: TEMPLATES.map((t) => (t.scenario_id === 'whop.watcher' ? { ...t, is_active: false } : t)) })
  const r = await run(R, 'na')
  return { pass: canceling.length === 0 && tasksOf(b).length === 0 && r.body.errors === undefined, detail: show({ canceling, off: tasksOf(b), errors: r.body.errors }) }
})
await rule('100 Whop watchers, 11 lessons each (1,100 rows in one batch of ids, read in 2 pages): every one gets the note and none a stalled task', async (R) => {
  const ids = Array.from({ length: 100 }, () => sid('bg'))
  const eleven = Array.from({ length: 11 }, (_, i) => `x${i}`)
  db = world({ students: ids.map((id) => student(id, 3)), lessons: Object.fromEntries(ids.map((id) => [id, eleven])) })
  const r = await run(R, 'na')
  const reads = db.reads('student_lesson_completions')
  const notes = db.rows('tasks').filter((t) => t.scenario_id === 'whop.watcher' && t.behavior_summary.endsWith('11 lessons watched on Whop.')).length
  return { pass: r.status === 200 && notes === 100 && db.rows('tasks').length === 100 && reads.length === 2 && reads.every((q) => q.status === 200 && q.requestLine < 8192),
    detail: show({ notes, tasks: db.rows('tasks').length, reads: reads.map((q) => q.requestLine) }) }
})

console.log('\n=== check-na-tasks: a failed read stops the run, nothing written ===')
for (const [what, match, seed] of [
  ['the templates', (r) => r.table === 'templates', {}],
  ['the tasks', (r) => r.table === 'tasks', {}],
  ['the completions', (r) => r.table === 'student_lesson_completions', {}],
  ['the discount requests', (r) => r.table === 'discount_requests', {}],
  ['the stored coupon answers', (r) => r.table === 'student_membership_discounts', {}],
]) {
  const a = sid('fr'), b = sid('fw')
  db = world({ students: [student(a, 3), student(b, 3)], lessons: { [b]: ['a1l01'] }, tasks: [task(b, 'stalled.whop.day3', 'open')], ...seed })
  db.failWhen = failing(match)
  const r = await run(NOW_ROUTES, 'na')
  const run_ = db.rows('cron_runs').at(-1)
  ok(r.status === 500 && r.body.error.includes(FAILED_READ) && run_.status === 'failed' && db.writes().length === 0,
     `${what} read failing: a 500, cron_runs failed, and nothing written (no stalled task for the student with 0 lessons, the watcher's stalled task left open)`,
     show({ status: r.status, error: r.body.error, writes: db.writes().map((w) => `${w.method} ${w.table}`) }))
}

// ═══════════════════════════ check-csm-tasks ═══════════════════════════
console.log('\n=== check-csm-tasks: a message already had, on every path ===')
await rule('day 3 sent on Whop before they signed in, then they sign in on day 4 with 0 lessons: no nolessons.day3 (the same text)', async (R) => {
  const a = sid('si')
  db = world({ students: [student(a, 4)], loggedIn: [a], tasks: [task(a, 'stalled.whop.day3', 'sent')] })
  const r = await run(R, 'csm')
  return { pass: r.status === 200 && show(tasksOf(a)) === show(['stalled.whop.day3:completed']), detail: show(tasksOf(a)) }
}, { failsAtBase: true })
await rule('signed in, day 3, 0 lessons, nothing had: nolessons.day3', async (R) => {
  const a = sid('n3')
  db = world({ students: [student(a, 3)], loggedIn: [a] })
  await run(R, 'csm')
  return { pass: show(tasksOf(a)) === show(['nolessons.day3:open']), detail: show(tasksOf(a)) }
})
await rule('the alert path (no_lessons_3d on day 5) no longer queues a nolessons.day3 already sent', async (R) => {
  const a = sid('al')
  db = world({ students: [student(a, 5)], loggedIn: [a], tasks: [task(a, 'nolessons.day3', 'sent')], alerts: [[a, 'no_lessons_3d']] })
  const r = await run(R, 'csm')
  return { pass: show(tasksOf(a)) === show(['nolessons.day3:completed']) && r.body.already_had === 1, detail: show({ tasks: tasksOf(a), already_had: r.body.already_had }) }
}, { failsAtBase: true })
await rule('nolessons.day3 dismissed by a team member: not queued again', async (R) => {
  const a = sid('nt')
  db = world({ students: [student(a, 3)], loggedIn: [a], tasks: [task(a, 'nolessons.day3', 'team-dismissed')] })
  await run(R, 'csm')
  return { pass: show(tasksOf(a)) === show(['nolessons.day3:dismissed']), detail: show(tasksOf(a)) }
}, { failsAtBase: true })
await rule('nolessons.day3 dismissed by the app, or by the reset: queued again while the rule holds', async (R) => {
  const a = sid('na'), b = sid('nr')
  db = world({ students: [student(a, 3), student(b, 4)], loggedIn: [a, b], tasks: [task(a, 'nolessons.day3', 'app-dismissed'), task(b, 'nolessons.day3', 'reset')] })
  await run(R, 'csm')
  return { pass: show(openOf(a)) === show(['nolessons.day3']) && show(openOf(b)) === show(['nolessons.day3']), detail: show({ app: tasksOf(a), reset: tasksOf(b) }) }
})
await rule('a template\'s own conditions (step 2b): a save task dismissed by a team member is not queued again', async (R) => {
  const a = sid('cs')
  db = world({ students: [student(a, 6, { cancel_scheduled_at: iso(NOW - H) })], loggedIn: [a], templates: [...TEMPLATES, SAVE], tasks: [task(a, 'C-0a1b2c', 'team-dismissed')] })
  await run(R, 'csm')
  return { pass: show(tasksOf(a)) === show(['C-0a1b2c:dismissed']), detail: show(tasksOf(a)) }
}, { failsAtBase: true })
await rule('a team-dismissed task past row 1,000 of the tasks read still counts (the read goes on in pages, team dismissals in the query itself)', async (R) => {
  const a = sid('pg')
  const others = Array.from({ length: 1100 }, (_, i) => task(`other-${i}`, 'nolessons.day7', 'team-dismissed', { id: `task-a${String(i).padStart(5, '0')}` }))
  db = world({ students: [student(a, 3)], loggedIn: [a], tasks: [...others, task(a, 'nolessons.day3', 'team-dismissed', { id: 'task-zzzzz' })] })
  await run(R, 'csm')
  const reads = db.reads('tasks').filter((q) => q.target.includes('dismissed_by'))
  const filter = decodeURIComponent(reads[0]?.target ?? '')
  return { pass: tasksOf(a).length === 1 && reads.length === 2 && filter.includes('or=(status.in.(open,completed),dismissed_by.not.is.null)')
      && filter.includes('select=student_id,scenario_id,status,dismissed_by'),
    detail: show({ tasks: tasksOf(a), pages: reads.length, filter: filter.slice(0, 140) }) }
})

console.log('\n=== check-csm-tasks: a template switched off (T-106) ===')
await rule('nolessons.day14 off: no task from the built-in rule (day 14) nor from an alert (day 12)', async (R) => {
  const a = sid('14'), b = sid('12')
  db = world({ students: [student(a, 14), student(b, 12)], loggedIn: [a, b], alerts: [[b, 'no_lessons_3d']] })
  await run(R, 'csm')
  return { pass: tasksOf(a).length === 0 && tasksOf(b).length === 0, detail: show({ rule: tasksOf(a), alert: tasksOf(b) }) }
}, { failsAtBase: true })
await rule('nolessons.day14 on: both made, so the switch is what stops them', async (R) => {
  const a = sid('1o'), b = sid('2o')
  db = world({ students: [student(a, 14), student(b, 12)], loggedIn: [a, b], alerts: [[b, 'no_lessons_3d']],
    templates: TEMPLATES.map((t) => (t.scenario_id === 'nolessons.day14' ? { ...t, is_active: true } : t)) })
  await run(R, 'csm')
  return { pass: show(openOf(a)) === show(['nolessons.day14']) && show(openOf(b)) === show(['nolessons.day14']), detail: show({ rule: tasksOf(a), alert: tasksOf(b) }) }
})
await rule('nolessons.day3 off, with conditions saved on it: no task (off no longer sends it back to its built-in rule)', async (R) => {
  const a = sid('3c')
  db = world({ students: [student(a, 3)], loggedIn: [a],
    templates: TEMPLATES.map((t) => (t.scenario_id === 'nolessons.day3' ? { ...t, is_active: false, trigger_config: { all: [{ metric: 'has_logged_into_app', op: 'is' }] } } : t)) })
  await run(R, 'csm')
  return { pass: tasksOf(a).length === 0, detail: show(tasksOf(a)) }
}, { failsAtBase: true })

console.log('\n=== check-csm-tasks 3c: an open whop.watcher note ===')
await rule('dismissed once the 30% window closed (day 16) or they applied (a pending request); kept while it is open', async (R) => {
  const closed = sid('cl'), applied = sid('ap'), open = sid('op')
  db = world({
    students: [student(closed, 16), student(applied, 5), student(open, 5)],
    lessons: { [closed]: ['a1l01'], [applied]: ['a1l01'], [open]: ['a1l01'] },
    tasks: [task(closed, 'whop.watcher', 'open'), task(applied, 'whop.watcher', 'open'), task(open, 'whop.watcher', 'open')],
    requests: [{ id: 'req-1', student_id: applied, status: 'pending', created_at: iso(NOW - H) }],
  })
  await run(R, 'csm')
  const note = (id) => db.rows('tasks').find((t) => t.student_id === id)
  const got = [closed, applied, open].map((id) => `${note(id).status}${note(id).notes ? `: ${note(id).notes}` : ''}`)
  return { pass: show(got) === show([
    'dismissed: Auto-dismissed: whop.watcher, the student\'s 30% window has closed.',
    'dismissed: Auto-dismissed: whop.watcher, the student applied for the 30%.',
    'open']) && db.rows('tasks').every((t) => t.dismissed_by === null), detail: show(got) }
}, { failsAtBase: true })
await rule('canceling: dismissed, as every task of a canceling student but the save task', async (R) => {
  const a = sid('cc')
  db = world({ students: [student(a, 5, { cancel_scheduled_at: iso(NOW - H) })], lessons: { [a]: ['a1l01'] }, tasks: [task(a, 'whop.watcher', 'open')] })
  await run(R, 'csm')
  return { pass: show(tasksOf(a)) === show(['whop.watcher:dismissed']), detail: show(tasksOf(a)) }
})
{
  const a = sid('fd')
  db = world({ students: [student(a, 5), student(sid('n3'), 3)], loggedIn: [], tasks: [task(a, 'whop.watcher', 'open')] })
  db.failWhen = failing((r) => r.table === 'discount_requests')
  const r = await run(NOW_ROUTES, 'csm')
  ok(r.status === 500 && r.body.error.includes(FAILED_READ) && db.rows('cron_runs').at(-1).status === 'failed' && db.writes().length === 0,
     'the discount requests read failing (an open note to judge): a 500, cron_runs failed, and nothing written',
     show({ status: r.status, error: r.body.error, writes: db.writes().map((w) => `${w.method} ${w.table}`) }))
}

console.log('\n=== check-csm-tasks 3c: a stalled task still open when the student signs in ===')
await rule('signed in on day 3 with 0 lessons, and on day 7 with 0 lessons: the stalled task dismissed by the app, then nolessons.day3 / nolessons.day7 (the same text) at the next run; signed in with lessons: dismissed and nothing after; not signed in: kept', async (R) => {
  const d3 = sid('s3'), d7 = sid('s7'), withLessons = sid('sl'), notYet = sid('sn')
  db = world({
    students: [student(d3, 3), student(d7, 7, { discord_username: 'x' }), student(withLessons, 3), student(notYet, 3)],
    loggedIn: [d3, d7, withLessons],
    lessons: { [withLessons]: ['a1l01'] },
    tasks: [task(d3, 'stalled.whop.day3', 'open'), task(d7, 'stalled.discord.day7', 'open'), task(withLessons, 'stalled.whop.day3', 'open'), task(notYet, 'stalled.whop.day3', 'open')],
  })
  await run(R, 'csm')
  const first = db.rows('tasks').filter((t) => t.status === 'dismissed').map((t) => `${t.scenario_id}|${t.dismissed_by}|${t.notes}`)
  await run(R, 'csm')
  const got = [d3, d7, withLessons, notYet].map((id) => tasksOf(id).join(','))
  const note = 'Auto-dismissed: the student signed in to the app, so a never-signed-in message no longer fits.'
  return { pass: show(got) === show([
      'stalled.whop.day3:dismissed,nolessons.day3:open',
      'stalled.discord.day7:dismissed,nolessons.day7:open',
      'stalled.whop.day3:dismissed',
      'stalled.whop.day3:open'])
      && show(first) === show([`stalled.whop.day3|null|${note}`, `stalled.discord.day7|null|${note}`, `stalled.whop.day3|null|${note}`]),
    detail: show({ got, first }) }
}, { failsAtBase: true })

console.log('\n=== check-csm-tasks: a task the team marks sent while the run is going stays sent ===')
await rule('the dismissals of the cap (3), the family (3b) and 3c (a stale stalled task, a whop.watcher past its window) leave a task sent mid-run as sent', async (R) => {
  // The cap: a canceling student's save task takes the slot of an open nolessons.day3.
  const capped = sid('r3')
  db = world({ students: [student(capped, 3, { cancel_scheduled_at: iso(NOW - H) })], loggedIn: [capped], templates: [...TEMPLATES, SAVE],
    tasks: [task(capped, 'nolessons.day3', 'open', { id: 'task-raced-cap' })] })
  db.failWhen = sentMidRun(['task-raced-cap'])
  await run(R, 'csm')
  const cap = db.rows('tasks').find((t) => t.id === 'task-raced-cap')
  // The family: a later stage of a template's own conditions (bucket event, so the cap lets it through) supersedes the open earlier one.
  const fam = sid('rf')
  const stage = (day) => ({ id: `tpl-C-1f2e3d.day${day}`, scenario_id: `C-1f2e3d.day${day}`, bucket: 'event', is_custom: true, is_active: true, is_admin_only: false,
    trigger_config: { all: [{ metric: 'is_canceling', op: 'is' }] } })
  db = world({ students: [student(fam, 5, { cancel_scheduled_at: iso(NOW - H) })], loggedIn: [fam], templates: [...TEMPLATES, stage(3), stage(7)],
    tasks: [task(fam, 'C-1f2e3d.day3', 'open', { id: 'task-raced-family' })] })
  db.failWhen = sentMidRun(['task-raced-family'])
  await run(R, 'csm')
  const family = db.rows('tasks').find((t) => t.id === 'task-raced-family')
  const familyStaged = tasksOf(fam)
  // 3c: a stalled task gone stale (day 8) and a whop.watcher whose window closed (day 16).
  const stale = sid('rc'), late = sid('rw')
  db = world({ students: [student(stale, 8), student(late, 16)], lessons: { [late]: ['a1l01'] },
    tasks: [task(stale, 'stalled.whop.day3', 'open', { id: 'task-raced-stale' }), task(late, 'whop.watcher', 'open', { id: 'task-raced-note' })] })
  db.failWhen = sentMidRun(['task-raced-stale', 'task-raced-note'])
  await run(R, 'csm')
  const raced = [cap, family, ...['task-raced-stale', 'task-raced-note'].map((id) => db.rows('tasks').find((t) => t.id === id))]
  const got = raced.map((t) => `${t.scenario_id}:${t.status}${t.dismissed_at ? ' (dismissed_at set)' : ''}`)
  return { pass: raced.every((t) => t.status === 'completed' && t.dismissed_at === null && t.completed_by === TEAM)
      && show(familyStaged) === show(['C-1f2e3d.day3:completed', 'C-1f2e3d.day7:open']),
    detail: show({ got, familyStaged }) }
}, { failsAtBase: true })

console.log('\n=== Both crons, one after the other, as Vercel runs them (:15 then :20) ===')
await rule('a student who never signed in and has not started: day 3 once, day 7 once, whichever cron, through a week of runs with each task marked sent', async (R) => {
  const a = sid('wk')
  const s = student(a, 3)
  db = world({ students: [s] })
  const made = []
  for (const day of [3, 3, 4, 5, 6, 7, 7, 8]) {
    Object.assign(db.rows('students')[0], { first_paid_at: paidOnDay(day), joined_at: paidOnDay(day), created_at: paidOnDay(day) })
    // Signs in on day 4: from then on check-csm-tasks owns them.
    if (day === 4 && !db.rows('student_milestones').length) db.rows('student_milestones').push({ student_id: a, first_sprint_login_at: iso(NOW - H) })
    await run(R, 'csm')
    await run(R, 'na')
    for (const t of db.rows('tasks').filter((k) => k.student_id === a && k.status === 'open')) {
      made.push(`day ${day}: ${t.scenario_id}`)
      markSent(a, t.scenario_id)
    }
  }
  return { pass: show(made) === show(['day 3: stalled.whop.day3', 'day 7: nolessons.day7']), detail: show(made) }
}, { failsAtBase: true })

console.log('\n=== The copies ===')
{
  const copies = [`check-na-tasks-route.${BASE}.ts`, `check-csm-tasks-route.${BASE}.ts`, 'check-na-tasks-route.ts', 'check-csm-tasks-route.ts']
  const left = copies.map((f) => fs.readFileSync(here(`./_gen/${f}`), 'utf8').split('\n').filter((l) => /^(\/\/|\/\*|\*)/.test(l.trimStart())).length)
  ok(left.every((n) => n === 0), 'the four route copies keep no comment line (each ran above)', show(left))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
