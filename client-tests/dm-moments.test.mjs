// dm-moments.test.mjs: the two DMs the owner added to the team's queue on
// 2026-10-30, run through check-csm-tasks' real GET (step 2d, its 3c paths,
// and the rule of src/lib/dm-queue.ts they obey).
//
//   Stopped watching ("Alright nice, that's good - code it and make the
//   message"): a student who signed in, has started, is under 49 of the 61
//   counted videos and has finished no lesson for 3 days on course days 1 to
//   14, or 5 days on days 15 to 30. lapse.30 while the 30% is still open, in
//   reach, not applied for and no coupon on file; lapse.plain otherwise. One
//   per break, at most 2, both versions counted together. 3c dismisses an
//   open one once the student finishes a lesson (and lapse.30 once the
//   window closes).
//   The 30% closing ("Yes"): signed in, 2 days or less before the 2 weeks
//   end, under 49, in reach (the shortest videos still needed fit in about 2
//   hours a day until the deadline), not applied, no coupon. Once ever. When
//   it is made, no stopped-watching DM that run. 3c dismisses an open one once
//   the window closed, they applied or they reached 49.
//
// The cron runs as it is, as in dm-queue.test.mjs: the real route and the
// libraries it imports, copied with their import lines pointed at the copies
// (comment lines left out of the route), a real supabase-js client, and the
// stand-in network of _gen/stub-cron.ts. Where 3c's paths are new, the route
// as it was before them (BASE, the DM queue fix) is taken from git and run on
// the same database, to show it leaving those tasks open.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const BASE = '769e5f9'
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const fromBase = (rel) => execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: here('..'), encoding: 'utf8' })
// As in dm-queue.test.mjs: dropComments leaves out every comment line of a
// copy (this repository is public), checked to leave the code unchanged.
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

// The library copies, byte for byte those of dm-queue.test.mjs, cron-failed-reads.test.mjs and build.mjs.
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
  ['src/lib/world/discount-server.ts', './_gen/discount-server.ts', [['from "./discount"', 'from "./discount.ts"']]],
  ['src/lib/dm-moments.ts', './_gen/dm-moments.ts', [
    ['from "@/lib/world/discount"', 'from "./discount.ts"'],
    ['from "@/lib/dm-queue"', 'from "./dm-queue.ts"'],
  ]],
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
// The real-time evaluator a finished lesson runs (src/lib/complete-lesson.ts):
// since the review of 2026-10-30 it dismisses an open stopped-watching task.
write(fromSrc('src/lib/csm-task-evaluation.ts'), 'src/lib/csm-task-evaluation.ts', './_gen/csm-task-evaluation.ts', [
  ['from "@/lib/csm-triggers"', 'from "./csm-triggers.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/lib/dm-queue"', 'from "./dm-queue.ts"'],
  ['from "@/lib/dm-moments"', 'from "./dm-moments.ts"'],
  ['"@/types/database"', '"./types-erased.ts"'],
], { dropComments: true })
const ROUTE = 'src/app/api/cron/check-csm-tasks/route.ts'
// Both copies' rewrites, then those only the copy of now needs. The copy of
// now is the one dm-queue.test.mjs and cron-failed-reads.test.mjs write.
const BOTH = [
  ['from "next/server"', 'from "./stub-cron.ts"'],
  ['from "@/lib/supabase-server"', 'from "./supabase-server.ts"'],
  ['from "@/lib/discord"', 'from "./discord.ts"'],
  ['from "@/lib/dm-toggles"', 'from "./dm-toggles.ts"'],
  ['from "@/lib/admin/metrics-definitions"', 'from "./metrics-definitions.ts"'],
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ['from "@/lib/cron-auth"', 'from "./cron-auth.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  ['from "@/lib/csm-triggers"', 'from "./csm-triggers.ts"'],
  ['"@/types/database"', '"./types-erased.ts"'],
  ['from "@/lib/world/discount"', 'from "./discount.ts"'],
  ['from "@/lib/dm-queue"', 'from "./dm-queue.ts"'],
]
const NOW_ONLY = [
  ['from "@/lib/world/discount-server"', 'from "./discount-server.ts"'],
  ['from "@/lib/membership-discount"', 'from "./membership-discount.ts"'],
  ['from "@/lib/dm-moments"', 'from "./dm-moments.ts"'],
]
write(fromSrc(ROUTE), ROUTE, './_gen/check-csm-tasks-route.ts', [...BOTH, ...NOW_ONLY], { dropComments: true })
write(fromBase(ROUTE), `${ROUTE}@${BASE}`, `./_gen/check-csm-tasks-route.${BASE}.ts`, BOTH, { dropComments: true })

const SECRET = 'cron-secret-for-the-test'
process.env.CRON_SECRET = SECRET
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-the-test'
process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
process.env.DISCORD_TEAM_WEBHOOK_URL = 'https://discord.test/api/webhooks/1/stand-in'

const { StandInDb, StandInDiscord, installNetwork } = await import('./_gen/stub-cron.ts')
const QUEUE = await import('./_gen/dm-queue.ts')
const MOMENTS = await import('./_gen/dm-moments.ts')
const NOW_ROUTE = await import('./_gen/check-csm-tasks-route.ts')
const BASE_ROUTE = await import(`./_gen/check-csm-tasks-route.${BASE}.ts`)
const EVAL = await import('./_gen/csm-task-evaluation.ts')
const { createServiceClient } = await import('./_gen/supabase-server.ts')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

let db = null
installNetwork({ db: () => db, discord: () => new StandInDiscord() })
async function run(route = NOW_ROUTE) {
  const res = await route.GET(new Request('http://app.test/api/cron/check-csm-tasks', { headers: { authorization: `Bearer ${SECRET}` } }))
  return { status: res.status, body: await res.json() }
}

/** One rule: `check` seeds the database, runs the route it is handed and says { pass, detail }. With `failsAtBase` it also runs on BASE's route, where it must fail. */
async function rule(label, check, { failsAtBase = false } = {}) {
  const now = await check(NOW_ROUTE)
  ok(now.pass, label, now.detail)
  if (failsAtBase) {
    const before = await check(BASE_ROUTE)
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
const sid = (tag) => `5e000000-0000-4000-8000-${String(++serial).padStart(8, '0')}${tag.padStart(4, '0').slice(-4)}`
const studentPaid = (id, paidMs, o = {}) => ({
  id, name: `Student ${id.slice(-4)}`, email: null, discord_username: null, membership_status: 'active', whop_plan_id: PLAN,
  high_churn_risk: false, csm_exempt: false, cancel_scheduled_at: null, whop_membership_id: null,
  created_at: iso(paidMs), first_paid_at: iso(paidMs), joined_at: iso(paidMs), last_active_at: iso(NOW - H), ...o,
})
/** First paid so that the course day (the switch being 25 days ago) is `day`; the 30% closes 14 days after. */
const student = (id, day, o = {}) => studentPaid(id, NOW - (day - 0.5) * D, o)
/** First paid so that the 30% closes `hours` from now (negative: it closed that long ago). */
const closingIn = (id, hours, o = {}) => studentPaid(id, NOW + hours * H - 14 * D, o)

// The course: 61 counted videos (watch lessons that count, with a video, the
// 61st the gate), an action item with a video after the fifth (not counted),
// and 3 watch lessons after the gate (not counted), in 4 areas.
const COUNTED = Array.from({ length: 61 }, (_, i) => `v${String(i + 1).padStart(2, '0')}`)
const AFTER = ['x1', 'x2', 'x3']
function catalog(minutes) {
  const ids = [...COUNTED.slice(0, 5), 'act1', ...COUNTED.slice(5), ...AFTER]
  return ids.map((id, i) => ({
    id, region_id: `a${Math.min(4, 1 + Math.floor(i / 17))}`, sort_order: i + 1,
    type: id === 'act1' ? 'action' : 'watch', requires_action: id === 'act1', counts_toward_progress: true,
    is_gate: id === 'v61', duration_seconds: minutes * 60,
  }))
}
/** The first `n` counted videos (from `from` on), finished at `ms`. */
const watched = (student_id, n, ms, from = 0) => COUNTED.slice(from, from + n).map((lesson_id) => ({
  student_id, lesson_id, completed_at: iso(ms), action_completed_at: null, skipped_at: null,
}))

const MOMENTS_TEMPLATES = ['lapse.30', 'lapse.plain', 'thirty.closing']
const TEMPLATES = [
  ...[['nolessons.day3', true], ['nolessons.day7', true], ['nolessons.day14', false]],
  ...MOMENTS_TEMPLATES.map((s) => [s, true]),
].map(([scenario_id, is_active]) => ({
  id: `tpl-${scenario_id}`, scenario_id, is_custom: false, is_active, is_admin_only: false, trigger_config: null, bucket: 'at_risk',
}))
const switched = (off) => TEMPLATES.map((t) => (off.includes(t.scenario_id) ? { ...t, is_active: false } : t))

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
    'app-dismissed': { status: 'dismissed', dismissed_at: iso(NOW - 2 * H), notes: 'Auto-dismissed: x' },
  }
  return { ...base, ...states[state], ...o }
}

/** The stand-in database: the new course (switched 25 days ago), the catalog above with every video `minutes` long. */
function world({ students = [], loggedIn, completions = [], tasks = [], requests = [], coupons = [], templates = TEMPLATES, minutes = 10 } = {}) {
  const lessons = catalog(minutes)
  return new StandInDb({
    admin_config: [{ key: 'dms_master_enabled', value: 'false' }, { key: 'curriculum_reset_at', value: iso(NOW - 25 * D) }],
    regions: ['a1', 'a2', 'a3', 'a4'].map((id, i) => ({ id, order_num: i + 1 })),
    lessons,
    lesson_videos: lessons.map((l) => ({ lesson_id: l.id, tella_video_id: `vid_${l.id}stand0in`, created_at: iso(NOW - 30 * D) })),
    templates,
    students,
    // Everyone signed in unless the test says who did.
    student_milestones: (loggedIn ?? students.map((s) => s.id)).map((id) => ({ student_id: id, first_sprint_login_at: iso(NOW - 20 * D) })),
    student_lesson_completions: completions,
    tasks,
    disengagement_alerts: [],
    discount_requests: requests,
    student_membership_discounts: coupons,
    cron_runs: [],
  })
}
const tasksOf = (id) => db.rows('tasks').filter((t) => t.student_id === id).map((t) => `${t.scenario_id}:${t.status}`)
const taskOf = (id, scenario) => db.rows('tasks').find((t) => t.student_id === id && t.scenario_id === scenario)
/** Marks the student's open task of `scenario` sent, as Mark sent does (none open: nothing, and the check that follows says so). */
function markSent(id, scenario) {
  const t = db.rows('tasks').find((k) => k.student_id === id && k.scenario_id === scenario && k.status === 'open')
  if (t) Object.assign(t, { status: 'completed', completed_at: iso(Date.now()), completed_by: TEAM })
}
/** Replaces a student's finished lessons. */
function setLessons(id, rows) {
  db.tables.student_lesson_completions = [...db.rows('student_lesson_completions').filter((c) => c.student_id !== id), ...rows]
}
const FAILED_READ = 'stand-in: the read failed'
const failing = (match) => (r) => (r.method === 'GET' && match(r) ? { status: 500, body: JSON.stringify({ code: 'XX000', details: null, hint: null, message: FAILED_READ }) } : null)

// ═══════════════════════════ the rule ═══════════════════════════
console.log('\n=== src/lib/dm-queue.ts: the stopped-watching DM, once per break and at most twice ===')
{
  const s = 'student-1'
  const T = NOW - 5 * D
  const had = (tasks, lastLesson) => QUEUE.messagesHad(tasks, () => (lastLesson == null ? null : iso(lastLesson)))
  const lapse = (scenario, state, at) => task(s, scenario, state, { created_at: iso(at) })
  ok(had([lapse('lapse.30', 'sent', T)], T - D).has(s, 'lapse.plain') && had([lapse('lapse.30', 'sent', T)], T - D).has(s, 'lapse.30'),
     'a lapse.30 sent after the last lesson: either version is had (one message, the same break)')
  ok(!had([lapse('lapse.30', 'sent', T)], T + H).has(s, 'lapse.plain'), 'a lesson finished after it: a new break, not had')
  ok(had([lapse('lapse.30', 'sent', T - 3 * D), lapse('lapse.plain', 'team-dismissed', T)], T + H).has(s, 'lapse.30'),
     'two had (both versions counted together): had for good, whatever the lessons')
  ok(!had([lapse('lapse.30', 'app-dismissed', T)], T - D).has(s, 'lapse.30') && had([lapse('lapse.30', 'open', T)], T - D).has(s, 'lapse.30'),
     'dismissed by the app: not had; open: had')
  ok(had([lapse('thirty.closing', 'sent', T)], T - D).has(s, 'lapse.30') && !had([lapse('thirty.closing', 'sent', T)], T + H).has(s, 'lapse.30'),
     'a 30% closing had in the break takes its place; one before the last lesson does not')
  ok(had([lapse('thirty.closing', 'sent', T)], T + H).has(s, 'thirty.closing') && had([lapse('lapse.30', 'sent', T)], null).has(s, 'lapse.plain'),
     'thirty.closing itself goes once ever; with no lesson finished every stopped-watching DM had is in the break')
  const h = had([], T)
  h.add(s, 'thirty.closing')
  ok(h.has(s, 'lapse.plain') && !had([], T).has(s, 'lapse.plain') && !h.has(s, 'whop.watcher'),
     'a closing made in the run keeps the stopped-watching DM out of the same run')
}
console.log('\n=== src/lib/dm-moments.ts: in reach ===')
{
  const lessons = catalog(10).map((l) => ({ ...l, has_video: true }))
  const base = { now: new Date(NOW), firstPaidAt: iso(NOW - 5.5 * D), lessons, videoDone: new Set(COUNTED.slice(0, 10)), requests: [], applied: false, couponCloses: false }
  const r = MOMENTS.thirtyReach(base)
  ok(r.inReach === true && r.left === 39 && r.secondsLeft === 39 * 600, '10 of 61 on day 6, 10-minute videos: in reach, 39 left, 6.5 hours', show(r))
  // The review of 2026-10-30: a video with no length is ranked last, so one missing length no longer makes the time unknown for everyone.
  const oneUnknown = MOMENTS.thirtyReach({ ...base, lessons: lessons.map((l) => (l.id === 'v60' ? { ...l, duration_seconds: null } : l)) })
  ok(oneUnknown.inReach === true && oneUnknown.left === 39 && oneUnknown.secondsLeft === 39 * 600,
     'a counted video not watched with no length: the 39 shortest with a length decide (in reach, 6.5 hours)', show(oneUnknown))
  const noLength = new Set(COUNTED.slice(48, 61))
  const unknown = MOMENTS.thirtyReach({ ...base, lessons: lessons.map((l) => (noLength.has(l.id) ? { ...l, duration_seconds: null } : l)) })
  ok(unknown.inReach === false && unknown.why === 'too few of the counted videos left have a known length',
     '13 of the 51 left with no length (38 known for the 39 needed): not in reach', show(unknown))
  ok(MOMENTS.knownShortestSeconds([{ duration_seconds: null }, { duration_seconds: 300 }, { duration_seconds: 60 }], 2) === 360
      && MOMENTS.knownShortestSeconds([{ duration_seconds: null }, { duration_seconds: 300 }], 2) === null,
     'knownShortestSeconds: the shortest with a length; null when too few have one')
  const edge = MOMENTS.thirtyReach({ ...base, lessons: catalog(10).map((l) => ({ ...l, has_video: true, duration_seconds: Math.floor((120 * 60 * 8.5) / 39) })) })
  ok(edge.inReach === true, 'the shortest still needed take just under 120 minutes a day left: in reach', show(edge))
  const over = MOMENTS.thirtyReach({ ...base, lessons: catalog(10).map((l) => ({ ...l, has_video: true, duration_seconds: Math.ceil((120 * 60 * 8.5) / 39) + 1 })) })
  ok(over.inReach === false && over.why === 'out of reach at about 2 hours a day', 'just over: out of reach', show(over))
}

// ═══════════════════════════ stopped watching ═══════════════════════════
console.log('\n=== check-csm-tasks 2d: stopped watching ===')
await rule('day 6, 10 videos, no lesson for 3 days, the 30% in reach: lapse.30, with its summary', async (R) => {
  const a = sid('la')
  db = world({ students: [student(a, 6)], completions: watched(a, 10, NOW - 3 * D - H) })
  const r = await run(R)
  const t = taskOf(a, 'lapse.30')
  return { pass: r.status === 200 && show(tasksOf(a)) === show(['lapse.30:open']) && t?.template_id === 'tpl-lapse.30'
      && t?.behavior_summary === 'Day 6 · no lesson finished in 3 days · 10 of 49 videos for the 30%, the 39 shortest left take about 6.5 hours, 8.5 days to go.',
    detail: show({ tasks: tasksOf(a), summary: t?.behavior_summary }) }
})
await rule('the same with a coupon on file, a request pending, or day 16 after 5 days: lapse.plain, saying why; day 16 after 4 days: nothing', async (R) => {
  const coupon = sid('lc'), applied = sid('lp'), late = sid('ll'), early = sid('le')
  db = world({
    students: [student(coupon, 6, { whop_membership_id: 'mem_ccc111' }), student(applied, 6), student(late, 16), student(early, 16)],
    completions: [...watched(coupon, 10, NOW - 3 * D - H), ...watched(applied, 10, NOW - 3 * D - H), ...watched(late, 10, NOW - 5 * D - H), ...watched(early, 10, NOW - 4 * D - H)],
    coupons: [{ student_id: coupon, whop_membership_id: 'mem_ccc111', discounted: true, promo_code_id: 'promo_x', renewal_price: 67.9 }],
    requests: [{ id: 'req-1', student_id: applied, status: 'pending', created_at: iso(NOW - H) }],
  })
  await run(R)
  const got = [coupon, applied, late, early].map((id) => db.rows('tasks').filter((t) => t.student_id === id).map((t) => `${t.scenario_id}: ${t.behavior_summary}`).join(' | ') || 'none')
  return { pass: show(got) === show([
      'lapse.plain: Day 6 · no lesson finished in 3 days · 10 of 49 videos for the 30% (a coupon or no paid plan on file).',
      'lapse.plain: Day 6 · no lesson finished in 3 days · 10 of 49 videos for the 30% (applied for the 30%).',
      'lapse.plain: Day 16 · no lesson finished in 5 days · 10 of 49 videos for the 30% (the 30% is closed to them).',
      'none']),
    detail: show(got) }
})
await rule('the same not in reach (30-minute videos: 39 x 30 minutes over 8.5 days at 2 hours a day): lapse.plain', async (R) => {
  const a = sid('lr')
  db = world({ students: [student(a, 6)], completions: watched(a, 10, NOW - 3 * D - H), minutes: 30 })
  await run(R)
  const t = taskOf(a, 'lapse.plain')
  return { pass: show(tasksOf(a)) === show(['lapse.plain:open']) && t?.behavior_summary.endsWith('(out of reach at about 2 hours a day).'),
    detail: show({ tasks: tasksOf(a), summary: t?.behavior_summary }) }
})
await rule('2 days without a lesson, never signed in, or canceling: nothing', async (R) => {
  const two = sid('l2'), never = sid('ln'), cancel = sid('lx')
  db = world({
    students: [student(two, 6), student(never, 6), student(cancel, 6, { cancel_scheduled_at: iso(NOW - H) })],
    loggedIn: [two, cancel],
    completions: [...watched(two, 10, NOW - 2 * D - H), ...watched(never, 10, NOW - 3 * D - H), ...watched(cancel, 10, NOW - 3 * D - H)],
  })
  const r = await run(R)
  return { pass: r.status === 200 && db.rows('tasks').length === 0, detail: show(db.rows('tasks').map((t) => t.scenario_id)) }
})
await rule('0 lessons (day 7): only the hasn\'t-started message, nolessons.day7; 49 videos: nothing', async (R) => {
  const zero = sid('l0'), done = sid('l9')
  db = world({ students: [student(zero, 7), student(done, 6)], completions: watched(done, 49, NOW - 3 * D - H) })
  await run(R)
  return { pass: show(tasksOf(zero)) === show(['nolessons.day7:open']) && tasksOf(done).length === 0, detail: show({ zero: tasksOf(zero), done: tasksOf(done) }) }
})
await rule('an action item\'s video watched yesterday, its link not in: no break (BEFORE the later of the two moments, the last counted lesson 4 days ago made one)', async (R) => {
  const a = sid('ac')
  db = world({ students: [student(a, 6)], completions: [...watched(a, 10, NOW - 4 * D),
    { student_id: a, lesson_id: 'act1', completed_at: iso(NOW - D), action_completed_at: null, skipped_at: null }] })
  await run(R)
  return { pass: tasksOf(a).length === 0, detail: show(tasksOf(a)) }
})
await rule('one per break, at most 2, both versions counted: lapse.30, then nothing on 3 more runs (open, then sent); a lesson, a new break: lapse.plain (a coupon since); a third break: nothing', async (R) => {
  const a = sid('lb')
  db = world({ students: [student(a, 10, { whop_membership_id: 'mem_bbb111' })], completions: watched(a, 10, NOW - 3 * D - H) })
  await run(R)
  const first = tasksOf(a)
  await run(R)
  await run(R)
  markSent(a, 'lapse.30')
  await run(R)
  const sameBreak = tasksOf(a)
  // A second break: the first task 6 days old, a lesson since, 3 days ago.
  Object.assign(taskOf(a, 'lapse.30') ?? {}, { created_at: iso(NOW - 6 * D) })
  setLessons(a, [...watched(a, 10, NOW - 7 * D), ...watched(a, 1, NOW - 3 * D - H, 10)])
  db.rows('student_membership_discounts').push({ student_id: a, whop_membership_id: 'mem_bbb111', discounted: true, promo_code_id: 'promo_b', renewal_price: 67.9 })
  await run(R)
  const second = tasksOf(a)
  markSent(a, 'lapse.plain')
  // A third break: each task before a lesson finished after it.
  Object.assign(taskOf(a, 'lapse.30') ?? {}, { created_at: iso(NOW - 8 * D) })
  Object.assign(taskOf(a, 'lapse.plain') ?? {}, { created_at: iso(NOW - 6 * D) })
  setLessons(a, [...watched(a, 10, NOW - 9 * D), ...watched(a, 1, NOW - 7 * D, 10), ...watched(a, 1, NOW - 3 * D - H, 11)])
  const r = await run(R)
  return { pass: show(first) === show(['lapse.30:open']) && show(sameBreak) === show(['lapse.30:completed'])
      && show(second) === show(['lapse.30:completed', 'lapse.plain:open']) && show(tasksOf(a)) === show(['lapse.30:completed', 'lapse.plain:completed'])
      && r.body.already_had === 1,
    detail: show({ first, sameBreak, second, third: tasksOf(a), already_had: r.body.already_had }) }
})

// ═══════════════════════════ the 30% closing ═══════════════════════════
console.log('\n=== check-csm-tasks 2d: the 30% closing ===')
await rule('40 hours before the end, 45 videos, no lesson for 4 days: thirty.closing, with its summary, and no stopped-watching task that run', async (R) => {
  const a = sid('ca')
  db = world({ students: [closingIn(a, 40)], completions: watched(a, 45, NOW - 4 * D) })
  await run(R)
  const t = taskOf(a, 'thirty.closing')
  return { pass: show(tasksOf(a)) === show(['thirty.closing:open']) && t?.template_id === 'tpl-thirty.closing'
      && t?.behavior_summary === 'Day 13 · the 30% closes in 40 hours · 45 of 49 videos, the 4 shortest left take about 40 minutes.',
    detail: show({ tasks: tasksOf(a), summary: t?.behavior_summary }) }
})
await rule('not in reach (20 videos: 29 x 10 minutes in 40 hours), applied, a coupon on file, or the window closed 2 hours ago: nothing', async (R) => {
  const far = sid('cf'), applied = sid('cp'), coupon = sid('cc'), closed = sid('cw')
  db = world({
    students: [closingIn(far, 40), closingIn(applied, 40), closingIn(coupon, 40, { whop_membership_id: 'mem_ccc222' }), closingIn(closed, -2)],
    completions: [...watched(far, 20, NOW - D), ...watched(applied, 45, NOW - D), ...watched(coupon, 45, NOW - D), ...watched(closed, 45, NOW - D)],
    requests: [{ id: 'req-2', student_id: applied, status: 'approved', created_at: iso(NOW - H) }],
    coupons: [{ student_id: coupon, whop_membership_id: 'mem_ccc222', discounted: false, promo_code_id: null, renewal_price: null }],
  })
  await run(R)
  return { pass: db.rows('tasks').length === 0, detail: show(db.rows('tasks').map((t) => `${t.student_id.slice(-4)} ${t.scenario_id}`)) }
})
await rule('once ever: sent, then the next runs add nothing; dismissed by a team member: never made', async (R) => {
  const a = sid('co'), b = sid('ct')
  db = world({ students: [closingIn(a, 40), closingIn(b, 30)], completions: [...watched(a, 45, NOW - D), ...watched(b, 45, NOW - D)],
    tasks: [task(b, 'thirty.closing', 'team-dismissed')] })
  await run(R)
  markSent(a, 'thirty.closing')
  await run(R)
  await run(R)
  return { pass: show(tasksOf(a)) === show(['thirty.closing:completed']) && show(tasksOf(b)) === show(['thirty.closing:dismissed']),
    detail: show({ a: tasksOf(a), b: tasksOf(b) }) }
})
await rule('an open, unsent lapse.30 when the closing is due: superseded, the closing takes its place; once the closing is sent, no stopped-watching DM in that break', async (R) => {
  const a = sid('cs')
  db = world({ students: [closingIn(a, 40)], completions: watched(a, 45, NOW - 4 * D), tasks: [task(a, 'lapse.30', 'open', { created_at: iso(NOW - D) })] })
  await run(R)
  const first = tasksOf(a)
  const lapse = taskOf(a, 'lapse.30')
  markSent(a, 'thirty.closing')
  await run(R)
  return { pass: show(first) === show(['lapse.30:dismissed', 'thirty.closing:open']) && lapse?.notes === 'Superseded by a higher-priority CSM task.'
      && lapse?.dismissed_by === null && show(tasksOf(a)) === show(['lapse.30:dismissed', 'thirty.closing:completed']),
    detail: show({ first, note: lapse?.notes, after: tasksOf(a) }) }
})

// ═══════════════════════════ 3c ═══════════════════════════
console.log('\n=== check-csm-tasks 3c: an open stopped-watching or closing task ===')
await rule('an open lapse.30 and the student finishes a lesson: dismissed by the app; one with no lesson since: kept', async (R) => {
  const a = sid('da'), b = sid('db')
  db = world({ students: [student(a, 8), student(b, 8)],
    completions: [...watched(a, 10, NOW - 5 * D), ...watched(a, 1, NOW - 2 * H, 10), ...watched(b, 10, NOW - 5 * D)],
    tasks: [task(a, 'lapse.30', 'open', { created_at: iso(NOW - D) }), task(b, 'lapse.30', 'open', { created_at: iso(NOW - D) })] })
  await run(R)
  const t = taskOf(a, 'lapse.30')
  return { pass: t?.status === 'dismissed' && t?.dismissed_by === null && t?.notes === 'Auto-dismissed: lapse.30, the student finished a lesson since.'
      && show(tasksOf(b)) === show(['lapse.30:open']),
    detail: show({ a: `${t?.status}: ${t?.notes}`, b: tasksOf(b) }) }
}, { failsAtBase: true })
await rule('an open lapse.30 whose 30% window has closed (day 16, no lesson for 6 days): dismissed, and lapse.plain at the next run', async (R) => {
  const a = sid('dw')
  db = world({ students: [student(a, 16)], completions: watched(a, 10, NOW - 6 * D), tasks: [task(a, 'lapse.30', 'open', { created_at: iso(NOW - D) })] })
  await run(R)
  const first = tasksOf(a)
  const note = taskOf(a, 'lapse.30')?.notes
  await run(R)
  return { pass: show(first) === show(['lapse.30:dismissed']) && note === 'Auto-dismissed: lapse.30, the student\'s 30% window has closed.'
      && show(tasksOf(a)) === show(['lapse.30:dismissed', 'lapse.plain:open']),
    detail: show({ first, note, after: tasksOf(a) }) }
}, { failsAtBase: true })
await rule('an open thirty.closing: dismissed once the window closed, they applied, or they reached 49; kept otherwise', async (R) => {
  const closed = sid('dc'), applied = sid('dp'), reached = sid('dr'), open = sid('do')
  db = world({
    students: [closingIn(closed, -2), closingIn(applied, 30), closingIn(reached, 30), closingIn(open, 30)],
    completions: [...watched(closed, 45, NOW - D), ...watched(applied, 49, NOW - D), ...watched(reached, 49, NOW - 2 * H), ...watched(open, 45, NOW - D)],
    requests: [{ id: 'req-3', student_id: applied, status: 'pending', created_at: iso(NOW - H) }],
    tasks: [closed, applied, reached, open].map((id) => task(id, 'thirty.closing', 'open', { created_at: iso(NOW - 2 * D) })),
  })
  await run(R)
  const got = [closed, applied, reached, open].map((id) => { const t = taskOf(id, 'thirty.closing'); return `${t?.status}${t?.notes ? `: ${t.notes}` : ''}` })
  return { pass: show(got) === show([
      'dismissed: Auto-dismissed: thirty.closing, the student\'s 30% window has closed.',
      'dismissed: Auto-dismissed: thirty.closing, the student applied for the 30%.',
      'dismissed: Auto-dismissed: thirty.closing, the student reached the 30%\'s videos.',
      'open']) && db.rows('tasks').every((t) => t.dismissed_by === null),
    detail: show(got) }
}, { failsAtBase: true })

// ═══════════════════════════ on/off, no templates ═══════════════════════════
console.log('\n=== check-csm-tasks 2d: on/off, and the templates not pasted yet ===')
await rule('all three off: nothing; lapse.30 off with lapse.plain on, in reach: nothing (off means off); the closing off: the stopped-watching DM instead', async (R) => {
  const a = sid('o1'), b = sid('o2')
  db = world({ students: [student(a, 6), closingIn(b, 40)], completions: [...watched(a, 10, NOW - 3 * D - H), ...watched(b, 45, NOW - 4 * D)], templates: switched(MOMENTS_TEMPLATES) })
  await run(R)
  const allOff = db.rows('tasks').length
  db = world({ students: [student(a, 6)], completions: watched(a, 10, NOW - 3 * D - H), templates: switched(['lapse.30']) })
  await run(R)
  const thirtyOff = tasksOf(a)
  db = world({ students: [closingIn(b, 40)], completions: watched(b, 45, NOW - 4 * D), templates: switched(['thirty.closing']) })
  await run(R)
  return { pass: allOff === 0 && thirtyOff.length === 0 && show(tasksOf(b)) === show(['lapse.30:open']),
    detail: show({ allOff, thirtyOff, closingOff: tasksOf(b) }) }
})
await rule('the three templates not there (the paste not run yet): no task, no error, and no 30% read', async (R) => {
  const a = sid('m1'), b = sid('m2')
  db = world({ students: [student(a, 6), closingIn(b, 40)], completions: [...watched(a, 10, NOW - 3 * D - H), ...watched(b, 45, NOW - 4 * D)],
    templates: TEMPLATES.filter((t) => !MOMENTS_TEMPLATES.includes(t.scenario_id)) })
  const r = await run(R)
  return { pass: r.status === 200 && db.rows('tasks').length === 0 && db.rows('cron_runs').at(-1).status === 'success'
      && db.reads('discount_requests').length === 0 && db.reads('student_membership_discounts').length === 0,
    detail: show({ status: r.status, tasks: db.rows('tasks').length, run: db.rows('cron_runs').at(-1).status, reads: db.reads('discount_requests').length }) }
})

// ═══════════════════════════ the review of 2026-10-30 ═══════════════════════════
console.log('\n=== The review of the build (2026-10-30): each check failed on the build as it was reviewed ===')
await rule('a custom at_risk template due, an open lapse.30 and the closing due: the closing takes the slot (the lapse superseded, the custom dropped); BEFORE the lapse was dismissed and the closing dropped', async (R) => {
  const a = sid('r1'), b = sid('r2')
  const custom = { id: 'tpl-C-aaaaaa', scenario_id: 'C-aaaaaa', is_custom: true, is_active: true, is_admin_only: false, bucket: 'at_risk',
    trigger_config: { all: [{ metric: 'days_since_last_completion', op: 'at_least', value: 3 }] } }
  db = world({ students: [closingIn(a, 40), closingIn(b, 40)], completions: [...watched(a, 45, NOW - 4 * D), ...watched(b, 45, NOW - 4 * D)],
    tasks: [task(a, 'lapse.30', 'open', { created_at: iso(NOW - D) })], templates: [...TEMPLATES, custom] })
  await run(R)
  // b has no open lapse: the custom, made first in the run, keeps the empty slot and nothing is dismissed (the cap's rule, unchanged).
  return { pass: show(tasksOf(a)) === show(['lapse.30:dismissed', 'thirty.closing:open']) && taskOf(a, 'lapse.30')?.notes === 'Superseded by a higher-priority CSM task.'
      && show(tasksOf(b)) === show(['C-aaaaaa:open']),
    detail: show({ a: tasksOf(a), b: tasksOf(b) }) }
})
await rule('a coupon lands after the DM was made: an open lapse.30 and an open thirty.closing (discounted, or the unpaid answer) are dismissed; an open lapse.plain stays', async (R) => {
  const a = sid('r3'), b = sid('r4'), c = sid('r5'), d = sid('r6')
  db = world({
    students: [student(a, 6, { whop_membership_id: 'mem_aaa333' }), closingIn(b, 30, { whop_membership_id: 'mem_bbb333' }),
      closingIn(c, 30, { whop_membership_id: 'mem_ccc333' }), student(d, 6, { whop_membership_id: 'mem_ddd333' })],
    completions: [...watched(a, 10, NOW - 3 * D - H), ...watched(b, 45, NOW - D), ...watched(c, 45, NOW - D), ...watched(d, 10, NOW - 3 * D - H)],
    tasks: [task(b, 'thirty.closing', 'open', { created_at: iso(NOW - 10 * H) }), task(c, 'thirty.closing', 'open', { created_at: iso(NOW - 10 * H) }),
      task(d, 'lapse.plain', 'open', { created_at: iso(NOW - 10 * H) })],
  })
  await run(R)
  const made = tasksOf(a)
  db.rows('student_membership_discounts').push(
    { student_id: a, whop_membership_id: 'mem_aaa333', discounted: true, promo_code_id: 'promo_a', renewal_price: 67.9 },
    { student_id: b, whop_membership_id: 'mem_bbb333', discounted: true, promo_code_id: 'promo_b', renewal_price: 67.9 },
    { student_id: c, whop_membership_id: 'mem_ccc333', discounted: false, promo_code_id: null, renewal_price: null },
    { student_id: d, whop_membership_id: 'mem_ddd333', discounted: true, promo_code_id: 'promo_d', renewal_price: 67.9 },
  )
  await run(R)
  const got = [a, b, c, d].map((id) => db.rows('tasks').filter((t) => t.student_id === id).map((t) => `${t.scenario_id}:${t.status}${t.notes ? ` (${t.notes})` : ''}`).join(' | '))
  return { pass: show(made) === show(['lapse.30:open']) && show(got) === show([
      'lapse.30:dismissed (Auto-dismissed: lapse.30, a coupon or no paid plan is on file for the student.)',
      'thirty.closing:dismissed (Auto-dismissed: thirty.closing, a coupon or no paid plan is on file for the student.)',
      'thirty.closing:dismissed (Auto-dismissed: thirty.closing, a coupon or no paid plan is on file for the student.)',
      'lapse.plain:open']),
    detail: show({ made, got }) }
})
await rule('the three templates off (so 2d reads nothing): the open lapse.30 and thirty.closing are still judged on their coupon answer, read in 3c in one read', async (R) => {
  const a = sid('r7'), b = sid('r8')
  db = world({
    students: [student(a, 6, { whop_membership_id: 'mem_aaa444' }), closingIn(b, 30, { whop_membership_id: 'mem_bbb444' })],
    completions: [...watched(a, 10, NOW - 3 * D - H), ...watched(b, 45, NOW - D)],
    coupons: [{ student_id: a, whop_membership_id: 'mem_aaa444', discounted: true, promo_code_id: 'promo_a', renewal_price: 67.9 },
      { student_id: b, whop_membership_id: 'mem_bbb444', discounted: true, promo_code_id: 'promo_b', renewal_price: 67.9 }],
    tasks: [task(a, 'lapse.30', 'open', { created_at: iso(NOW - 10 * H) }), task(b, 'thirty.closing', 'open', { created_at: iso(NOW - 10 * H) })],
    templates: switched(MOMENTS_TEMPLATES),
  })
  await run(R)
  return { pass: show(tasksOf(a)) === show(['lapse.30:dismissed']) && show(tasksOf(b)) === show(['thirty.closing:dismissed'])
      && db.reads('student_membership_discounts').length === 1,
    detail: show({ a: tasksOf(a), b: tasksOf(b), reads: db.reads('student_membership_discounts').length }) }
})
await rule('one counted video with no length (the gate): day 6 with 10 videos still gets lapse.30, and 40 hours before the end with 45 still gets the closing; BEFORE both got lapse.plain', async (R) => {
  const a = sid('r9'), b = sid('ra')
  db = world({ students: [student(a, 6), closingIn(b, 40)], completions: [...watched(a, 10, NOW - 3 * D - H), ...watched(b, 45, NOW - 4 * D)] })
  db.rows('lessons').find((l) => l.id === 'v61').duration_seconds = null
  await run(R)
  return { pass: show(tasksOf(a)) === show(['lapse.30:open']) && show(tasksOf(b)) === show(['thirty.closing:open'])
      && taskOf(b, 'thirty.closing')?.behavior_summary.endsWith('the 4 shortest left take about 40 minutes.'),
    detail: show({ a: tasksOf(a), b: tasksOf(b), summary: taskOf(b, 'thirty.closing')?.behavior_summary }) }
})
await rule('lessons only skipped (5, skipped 6 days ago, day 9): lapse.30; a lesson skipped yesterday after 4 days without a video: no break; BEFORE the first never got a DM', async (R) => {
  const a = sid('rb'), b = sid('rc')
  const skipped = (student_id, ids, ms) => ids.map((lesson_id) => ({ student_id, lesson_id, completed_at: null, action_completed_at: null, skipped_at: iso(ms) }))
  db = world({ students: [student(a, 9), student(b, 9)],
    completions: [...skipped(a, COUNTED.slice(0, 5), NOW - 6 * D), ...watched(b, 10, NOW - 4 * D), ...skipped(b, ['v11'], NOW - D)] })
  await run(R)
  return { pass: show(tasksOf(a)) === show(['lapse.30:open']) && taskOf(a, 'lapse.30')?.behavior_summary.startsWith('Day 9 · no lesson finished in 6 days · 0 of 49 videos')
      && tasksOf(b).length === 0,
    detail: show({ a: tasksOf(a), summary: taskOf(a, 'lapse.30')?.behavior_summary, b: tasksOf(b) }) }
})
await rule('the lapse due a run before the closing (50 hours before the end, 44 videos, 4 days quiet): nothing, then the closing alone 4 hours later; 70 hours with 20 videos (the closing will not come) and 80 hours with 44: lapse.30; BEFORE the first got lapse.30 and then the closing', async (R) => {
  const a = sid('rd'), b = sid('re'), c = sid('rf')
  db = world({ students: [closingIn(a, 50), closingIn(b, 70), closingIn(c, 80)],
    completions: [...watched(a, 44, NOW - 4 * D), ...watched(b, 20, NOW - 4 * D), ...watched(c, 44, NOW - 4 * D)] })
  await run(R)
  const first = tasksOf(a)
  const st = db.rows('students').find((s) => s.id === a)
  st.first_paid_at = st.joined_at = st.created_at = iso(Date.parse(st.first_paid_at) - 4 * H)
  await run(R)
  return { pass: show(first) === show([]) && show(tasksOf(a)) === show(['thirty.closing:open'])
      && show(tasksOf(b)) === show(['lapse.30:open']) && show(tasksOf(c)) === show(['lapse.30:open']),
    detail: show({ first, then: tasksOf(a), b: tasksOf(b), c: tasksOf(c) }) }
})
await rule('lessons watched before the first payment (6, 8 days ago; joined 10 days ago): no lapse on day 2; on day 4 (3 days since day 1 began) lapse.30; BEFORE day 2 got one', async (R) => {
  const a = sid('rg'), b = sid('rh')
  const paidFreeFirst = (id, paidAgoDays) => studentPaid(id, NOW - paidAgoDays * D, { joined_at: iso(NOW - 10 * D), created_at: iso(NOW - 10 * D) })
  db = world({ students: [paidFreeFirst(a, 1.5), paidFreeFirst(b, 3.5)], completions: [...watched(a, 6, NOW - 8 * D), ...watched(b, 6, NOW - 8 * D)] })
  await run(R)
  return { pass: tasksOf(a).length === 0 && show(tasksOf(b)) === show(['lapse.30:open'])
      && taskOf(b, 'lapse.30')?.behavior_summary.startsWith('Day 4 · no lesson finished in 3 days'),
    detail: show({ a: tasksOf(a), b: tasksOf(b), summary: taskOf(b, 'lapse.30')?.behavior_summary }) }
})
{
  // The real-time evaluator, as a finished lesson runs it.
  const a = sid('ri'), b = sid('rj'), c = sid('rk')
  db = world({ students: [student(a, 8), student(b, 8), student(c, 8)],
    completions: [...watched(a, 10, NOW - 5 * D), ...watched(a, 1, NOW - 5 * 60_000, 10), ...watched(b, 10, NOW - 5 * D), ...watched(c, 10, NOW - 5 * D),
      { student_id: c, lesson_id: 'v11', completed_at: null, action_completed_at: null, skipped_at: iso(NOW - 60_000) }],
    tasks: [task(a, 'lapse.30', 'open', { created_at: iso(NOW - D) }), task(b, 'lapse.plain', 'open', { created_at: iso(NOW - D) }),
      task(c, 'lapse.plain', 'open', { created_at: iso(NOW - D) })] })
  const results = []
  for (const id of [a, b, c]) results.push(await EVAL.reEvaluateStudentOpenTasks(createServiceClient(), id))
  const t = taskOf(a, 'lapse.30')
  ok(t?.status === 'dismissed' && t?.notes === 'Auto-dismissed (real-time): lapse.30, the student finished a lesson since.'
      && show(tasksOf(b)) === show(['lapse.plain:open']) && show(tasksOf(c)) === show(['lapse.plain:dismissed'])
      && results.every((r) => !('error' in r)),
     'the real-time evaluator after a lesson: an open lapse.30 dismissed at once (and a lapse.plain after a skip); one with no lesson since kept; BEFORE it was left to the next cron run',
     show({ a: `${t?.status}: ${t?.notes}`, b: tasksOf(b), c: tasksOf(c), results }))
}

// ═══════════════════════════ the reads ═══════════════════════════
console.log('\n=== check-csm-tasks 2d: the reads ===')
await rule('150 students a DM may go to: their requests and coupon answers read 100 ids at a time (2 reads each, each request line under 8 KB), and every one gets lapse.30', async (R) => {
  const ids = Array.from({ length: 150 }, () => sid('bg'))
  db = world({ students: ids.map((id) => student(id, 6)), completions: ids.flatMap((id) => watched(id, 10, NOW - 3 * D - H)) })
  const r = await run(R)
  const reads = [...db.reads('discount_requests'), ...db.reads('student_membership_discounts')]
  return { pass: r.status === 200 && db.rows('tasks').filter((t) => t.scenario_id === 'lapse.30').length === 150
      && db.reads('discount_requests').length === 2 && db.reads('student_membership_discounts').length === 2
      && reads.every((q) => q.status === 200 && q.requestLine < 8192)
      && decodeURIComponent(db.reads('lesson_videos')[0]?.target ?? '').includes('select=lesson_id&'),
    detail: show({ tasks: db.rows('tasks').length, reads: reads.map((q) => q.requestLine), videos: db.reads('lesson_videos').map((q) => q.target) }) }
})
for (const [what, match] of [
  ['lesson_videos', (r) => r.table === 'lesson_videos'],
  ['the discount requests', (r) => r.table === 'discount_requests'],
  ['the stored coupon answers', (r) => r.table === 'student_membership_discounts'],
]) {
  const a = sid('fr'), b = sid('fz')
  db = world({ students: [student(a, 6), student(b, 7)], completions: watched(a, 10, NOW - 3 * D - H), tasks: [task(a, 'lapse.30', 'open', { created_at: iso(NOW - 10 * D) })] })
  db.failWhen = failing(match)
  const r = await run()
  ok(r.status === 500 && r.body.error.includes(FAILED_READ) && db.rows('cron_runs').at(-1).status === 'failed' && db.writes().length === 0,
     `${what} read failing: a 500, cron_runs failed, and nothing written (no nolessons.day7, no lapse, the stale open lapse left as it was)`,
     show({ status: r.status, error: r.body.error, writes: db.writes().map((w) => `${w.method} ${w.table}`) }))
}
{
  // 3c's read of the coupon answers (the review of 2026-10-30): the templates off, so 2d reads nothing.
  const a = sid('fc'), b = sid('fd')
  db = world({ students: [student(a, 6, { whop_membership_id: 'mem_fff111' }), student(b, 7)], completions: watched(a, 10, NOW - 3 * D - H),
    tasks: [task(a, 'lapse.30', 'open', { created_at: iso(NOW - 10 * H) })], templates: switched(MOMENTS_TEMPLATES) })
  db.failWhen = failing((r) => r.table === 'student_membership_discounts')
  const r = await run()
  ok(r.status === 500 && r.body.error === `Coupon answers fetch failed: ${FAILED_READ}` && db.rows('cron_runs').at(-1).status === 'failed' && db.writes().length === 0,
     '3c\'s coupon read failing: a 500, cron_runs failed, and nothing written (no nolessons.day7, the open lapse.30 left as it was)',
     show({ status: r.status, error: r.body.error, writes: db.writes().map((w) => `${w.method} ${w.table}`) }))
}

console.log('\n=== The copies ===')
{
  const copies = ['check-csm-tasks-route.ts', `check-csm-tasks-route.${BASE}.ts`, 'csm-task-evaluation.ts']
  const left = copies.map((f) => fs.readFileSync(here(`./_gen/${f}`), 'utf8').split('\n').filter((l) => /^(\/\/|\/\*|\*)/.test(l.trimStart())).length)
  ok(left.every((n) => n === 0), 'the two route copies and the evaluator\'s keep no comment line (each ran above)', show(left))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
