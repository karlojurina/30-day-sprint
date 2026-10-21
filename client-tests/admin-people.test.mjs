// admin-people.test.mjs: the rules of admin rebuild 2's lane WI-5 and WI-6
// (_admin/prds/admin-rebuild-2/admin_rebuild_2_prd.md, D7, D8, D9, D12).
//
//   All students   course members on one of the two $97 monthly plans
//                  (MONTHLY_97_PLAN_IDS) with a first payment on or after 1
//                  October in Croatia (DISCOUNT_ELIGIBLE_FROM), any
//                  membership status, newest first payment first; a yearly
//                  plan, an ETfB plan, no plan, no payment and a payment
//                  before 1 October left out (the owner's answers,
//                  2026-10-21); the progress read for the listed students
//                  alone; the pills Active, Payment failed and Ended
//                  (canceled and expired), Active first; a failed read says so
//   The student    a failed read says so, block by block; the Whop sync says
//                  when its numbers are from before the switch (whopPulled)
//   The journey    the same two plans, with a first payment on or after the
//                  launch (9 October); the six columns as before; a card
//                  holds the name, the day, the activity, the progress and
//                  the last activity alone (the owner's review); the two
//                  pages agree on one database; a failed read says so
//   Tasks          the tabs (Archived once the reset ran), the tiers, the
//                  closed lines; the insights count only tasks since the reset
//   The words      "Membership status" and "still a member"; no plan read as
//                  a column or shown on a row, the headers saying who is
//                  listed
//
// The readers and builders are the real modules, copied by build.mjs with
// only their import lines rewritten (run it first; `npm run test:client`
// does). The readers run on stub-server.ts's stand-in database, which
// answers as PostgREST does where they depend on it (at most 1000 rows an
// answer, a column that does not exist is an error, .maybeSingle() on no row
// is null). The outreach insights and their route are copied here, as
// outreach-cutover.test.mjs copies the module. Where the old page held the
// rule inline, the page at BASE is read as a control. The two readers as
// they were before the $97 plans came back (BEFORE_97) are copied here too,
// and run on the same database as a control.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BASE = 'ca9b5ef' // night/admin2 after WI-1, where this lane started
const BEFORE_97 = '35d44d2' // night/admin2 before the owner's answer brought the $97 plans back

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const fromBase = (rel, ref = BASE) => execFileSync('git', ['show', `${ref}:${rel}`], { cwd: here('..'), encoding: 'utf8' })

function write(text, label, outRel, rewrites) {
  let s = text
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${label} has no ${from}`)
    s = s.split(from).join(to)
  }
  if (s.includes('@/')) throw new Error(`an unrewritten @/ import remains in ${label}`)
  fs.writeFileSync(here(outRel), s)
  console.log(`generated ${outRel} from ${label}`)
}

// The insights module, as outreach-cutover.test.mjs copies it, and its route.
write(fromSrc('src/lib/outreach-insights.ts'), 'src/lib/outreach-insights.ts', './_gen/outreach-insights.ts', [
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['import type { TriggerConfig } from "@/types/database";\n', ''],
])
const INSIGHTS_ROUTE = 'src/app/api/admin/tasks/insights/route.ts'
write(fromSrc(INSIGHTS_ROUTE), INSIGHTS_ROUTE, './_gen/admin-tasks-insights-route.ts', [
  ['from "next/server"', 'from "./stub-server.ts"'],
  ['from "@/lib/admin-auth"', 'from "./stub-admin.ts"'],
  ['from "@/lib/outreach-insights"', 'from "./outreach-insights.ts"'],
  ['from "@/lib/admin/tasks-reset"', 'from "./tasks-reset.ts"'],
])

// The two readers as they were before the $97 plans came back (BEFORE_97),
// with build.mjs's rewrites: run on the same database as the real ones, they
// are the control that every plan used to be listed.
const PEOPLE_REWRITES = [
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/lib/useJourneyPaceCounts"', 'from "./types-erased.ts"'],
  ['from "./people-common"', 'from "./people-common.ts"'],
]
write(fromBase('src/lib/admin/students-list.ts', BEFORE_97), `src/lib/admin/students-list.ts at ${BEFORE_97}`, './_gen/students-list.before-97.ts', PEOPLE_REWRITES)
write(fromBase('src/lib/admin/journey-board.ts', BEFORE_97), `src/lib/admin/journey-board.ts at ${BEFORE_97}`, './_gen/journey-board.before-97.ts', [
  ...PEOPLE_REWRITES,
  ['from "@/lib/world/discount"', 'from "./discount.ts"'],
  ['from "@/lib/admin/metrics-definitions"', 'from "./metrics-definitions.ts"'],
])

const { FakeDb, fakeClient } = await import('./_gen/stub-server.ts')
const { setTeam } = await import('./_gen/stub-admin.ts')
const C = await import('./_gen/constants.ts')
const L = await import('./_gen/students-list.ts')
const L0 = await import('./_gen/students-list.before-97.ts')
const D = await import('./_gen/student-detail.ts')
const J = await import('./_gen/journey-board.ts')
const J0 = await import('./_gen/journey-board.before-97.ts')
const V = await import('./_gen/tasks-view.ts')
const R = await import('./_gen/tasks-reset.ts')
const O = await import('./_gen/outreach-insights.ts')
const { METRICS } = await import('./_gen/csm-triggers.ts')
const { DISCOUNT_LAUNCH_DATE, DISCOUNT_ELIGIBLE_FROM } = await import('./_gen/discount.ts')
const insightsRoute = (await import('./_gen/admin-tasks-insights-route.ts')).GET

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

const NOW = '2026-10-21T08:30:00.000Z' // Wed 21 Oct, 10:30 in Croatia
const NOW_MS = Date.parse(NOW)
const DAY = 86_400_000
const iso = (ms) => new Date(ms).toISOString()
/** A first payment that makes today day `d`. */
const paidOnDay = (d, now = NOW_MS) => iso(now - (d - 0.5) * DAY)
const SWITCH = '2026-10-19T14:33:33.972Z'
const course = (last = {}, resetAt = SWITCH) => ({ ok: true, resetAt, lastByStudent: new Map(Object.entries(last)) })
const courseFailed = { ok: false, error: 'admin_config.curriculum_reset_at could not be read: timeout' }
/** The course's two $97 monthly plans: the visible one and the hidden one (system-docs/whop_plan_inventory_2026-09-03.md). */
const MONTHLY = 'plan_4ZrwR4PmBsVsx'
const HIDDEN_97 = 'plan_UoKS5Tjqvp0Cj'
/** Two plans that are not: the course's $700 yearly plan, and the ETfB product's visible $997 a month plan (the same inventory). */
const YEARLY = 'plan_VFDntXQf9cYMo'
const BRANDS = 'plan_uSpqAhp2cSeyy'
/** The read's plans line, as the stand-in logs it. */
const PLANS_LINE = `whop_plan_id in (${MONTHLY},${HIDDEN_97})`

// ── All students ────────────────────────────────────────────────────────────
console.log('\n=== All students: course members on a $97 monthly plan who first paid from 1 October, newest first ===')
{
  ok(show([...C.MONTHLY_97_PLAN_IDS]) === show([MONTHLY, HIDDEN_97]),
     'MONTHLY_97_PLAN_IDS holds the course\'s two $97 monthly plans: the visible one and the hidden one', show(C.MONTHLY_97_PLAN_IDS))
  ok(show([...C.PAYING_WHOP_PLAN_IDS]) === show([MONTHLY]),
     'PAYING_WHOP_PLAN_IDS, which the CSM crons, the snapshots and the Dashboard read, is left as it was: the visible plan alone (its missing hidden plan is a separate task)')
}
const allStudentsDb = () => {
  const student = (id, extra) => ({ id, name: `Student ${id}`, email: `${id}@example.com`, whop_membership_id: `mem_${id}`, membership_status: 'active', ...extra })
  return new FakeDb({
    students: [
      student('s-monthly', { whop_plan_id: MONTHLY, first_paid_at: '2026-06-01T10:00:00.000Z' }),
      student('s-hidden', { whop_plan_id: HIDDEN_97, first_paid_at: '2026-10-16T10:00:00.000Z' }),
      student('s-pastdue', { whop_plan_id: HIDDEN_97, first_paid_at: '2026-10-14T10:00:00.000Z', membership_status: 'past_due' }),
      student('s-early', { whop_plan_id: MONTHLY, first_paid_at: '2026-03-01T10:00:00.000Z', membership_status: 'canceled' }),
      student('s-expired', { whop_plan_id: MONTHLY, first_paid_at: '2026-09-01T10:00:00.000Z', membership_status: 'expired' }),
      student('s-nomembership', { whop_plan_id: MONTHLY, whop_membership_id: null, first_paid_at: '2026-10-18T10:00:00.000Z' }),
      student('s-yearly', { whop_plan_id: YEARLY, first_paid_at: '2026-10-12T10:00:00.000Z' }),
      student('s-brands', { whop_plan_id: BRANDS, first_paid_at: '2026-10-13T10:00:00.000Z' }),
      student('s-noplan', { whop_plan_id: null, first_paid_at: '2026-10-17T10:00:00.000Z' }),
      student('s-unpaid', { whop_plan_id: HIDDEN_97, first_paid_at: null }),
      student('s-free', { whop_plan_id: 'plan_free', first_paid_at: null }),
      // The owner's review (2026-10-21): the first payments from 1 October in Croatia, 30 September 22:00 UTC, on.
      student('s-oct1', { whop_plan_id: MONTHLY, first_paid_at: '2026-09-30T22:00:00.000Z', membership_status: 'canceled' }),
      student('s-sept30', { whop_plan_id: MONTHLY, first_paid_at: '2026-09-30T21:59:59.999Z' }),
      student('s-expired-oct', { whop_plan_id: HIDDEN_97, first_paid_at: '2026-10-03T10:00:00.000Z', membership_status: 'expired' }),
    ],
    student_progress_counts: [{ student_id: 's-hidden', completed_count: 14 }, { student_id: 's-yearly', completed_count: 30 }, { student_id: 's-monthly', completed_count: 50 }],
    lessons: Array.from({ length: 140 }, (_, i) => ({ id: `l${i}`, counts_toward_progress: true })).concat([{ id: 'pond', counts_toward_progress: false }]),
  })
}
{
  const db = allStudentsDb()
  const reads = await L.readStudentsList(fakeClient(db))
  const ids = reads.students.ok ? reads.students.data.map((s) => s.id).sort() : null
  ok(show(ids) === show(['s-expired-oct', 's-hidden', 's-nomembership', 's-oct1', 's-pastdue']),
     'listed: a first payment from midnight starting 1 October in Croatia on, on either $97 monthly plan (the hidden one too), active, past due, canceled or expired, with or without a Whop membership on file; not listed: a payment a millisecond before, or in March, June or September, a yearly plan, an ETfB plan, no plan on file, a $97 member with no first payment, nor a free seat', show(ids))
  const call = db.calls('students', 'select')[0]
  ok(call.columns === L.LIST_COLUMNS && !/plan|\*/.test(call.columns) && call.filters.includes(`first_paid_at>=${DISCOUNT_ELIGIBLE_FROM}`) && DISCOUNT_ELIGIBLE_FROM === '2026-09-30T22:00:00.000Z'
       && call.filters.includes(PLANS_LINE) && !call.filters.some((f) => /membership_status|whop_membership_id/.test(f)),
     'the read asks for the list\'s columns only (no plan, no *) and draws both lines in the database: a first payment from DISCOUNT_ELIGIBLE_FROM, and one of the two $97 plans; no status or membership filter', show({ columns: call.columns, filters: call.filters }))
  const progress = db.calls('student_progress_counts', 'select')
  const asked = progress.flatMap((c) => c.filters.filter((f) => f.startsWith('student_id in (')))
  ok(progress.length === 1 && asked.length === 1 && show(asked[0].slice('student_id in ('.length, -1).split(',').sort()) === show(ids)
       && !progress[0].filters.some((f) => f.startsWith('student_id>')),
     'the progress is read for the listed students alone, by id, where it read every student\'s row page by page (the owner\'s review)', show(progress.map((c) => c.filters)))
  ok(reads.progress.ok && show(reads.progress.data.map((r) => r.student_id)) === show(['s-hidden']), 'so no progress row of an unlisted student (the yearly one, a June one) comes back', show(reads.progress))
  ok(reads.countingLessons.ok && reads.countingLessons.data === 140, 'the lessons that count: 140 (the one outside progress left out)')
  const before = fromBase('src/app/admin/(authenticated)/students/page.tsx')
  ok(before.includes('.in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[])') && before.includes('.gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF)'),
     `control: at ${BASE} the page read the visible $97 plan only, from 25 May, so the hidden $97 plan and the students before 25 May were missing`)
  const was = await L0.readStudentsList(fakeClient(allStudentsDb()))
  const wasIds = was.students.ok ? was.students.data.map((s) => s.id).sort() : null
  ok(show(wasIds) === show(['s-brands', 's-early', 's-expired', 's-expired-oct', 's-hidden', 's-monthly', 's-nomembership', 's-noplan', 's-oct1', 's-pastdue', 's-sept30', 's-yearly']),
     `control: the reader at ${BEFORE_97}, on the same database, listed every plan at any date: the yearly, the ETfB and the no-plan students, and March, June and September too`, show(wasIds))

  const list = L.buildStudentsList(reads, course({ 's-hidden': iso(NOW_MS - 2 * DAY), 's-pastdue': iso(NOW_MS - 5 * DAY) }), NOW)
  ok(show(list.rows.map((r) => r.id)) === show(['s-nomembership', 's-hidden', 's-pastdue', 's-expired-oct', 's-oct1']),
     'newest first payment first', show(list.rows.map((r) => r.id)))
  const h = list.rows.find((r) => r.id === 's-hidden')
  const p = list.rows.find((r) => r.id === 's-pastdue')
  ok(h.day === 5 && h.progress === 10 && h.activity === 'moving' && p.progress === 0 && p.activity === 'slipping'
       && list.rows.find((r) => r.id === 's-oct1').activity === 'not_started',
     'day since the first payment, progress over the 140 counting lessons (14 is 10%, no row is 0%), activity from the last counted lesson',
     show({ h: [h.day, h.progress, h.activity], p: [p.progress, p.activity] }))
  ok(list.progressKnown && list.courseIsNew === true && list.problems.length === 0 && list.generatedAt === NOW, 'nothing failed, nothing to say')
}
{
  // 1,200 students: more than one answer of PostgREST holds. Read by key, all come back, and their progress in batches of 100 ids.
  const students = Array.from({ length: 1200 }, (_, i) => ({ id: `s-${String(i).padStart(4, '0')}`, whop_plan_id: i % 2 ? HIDDEN_97 : MONTHLY, first_paid_at: iso(Date.parse('2026-10-01T00:00:00.000Z') + i * 600_000) }))
  const db = new FakeDb({ students, student_progress_counts: [{ student_id: 's-1199', completed_count: 7 }], lessons: [{ id: 'l1', counts_toward_progress: true }] })
  const reads = await L.readStudentsList(fakeClient(db))
  const pages = db.calls('students', 'select').length
  ok(reads.students.ok && reads.students.data.length === 1200 && pages === 2, 'past 1000 students: all 1,200, in 2 pages read by key', `${reads.students.ok && reads.students.data.length} in ${pages}`)
  const batches = db.calls('student_progress_counts', 'select').map((c) => c.filters.find((f) => f.startsWith('student_id in (')).split(',').length)
  ok(batches.length === 12 && batches.every((n) => n === 100) && reads.progress.ok && show(reads.progress.data) === show([{ student_id: 's-1199', completed_count: 7 }]),
     'their progress: 12 reads of 100 ids each, the last student\'s row among them', show(batches))
  const failing = new FakeDb({ students, student_progress_counts: [], lessons: [{ id: 'l1', counts_toward_progress: true }] })
  failing.failWhen = (call) => (call.table === 'student_progress_counts' && call.filters.some((f) => f.includes('s-0500')) ? { message: 'canceling statement due to statement timeout' } : null)
  const one = await L.readStudentsList(fakeClient(failing))
  ok(!one.progress.ok && one.progress.error === 'canceling statement due to statement timeout', 'one batch of the 12 fails: the progress read fails, never a list with students missing', show(one.progress))
}
{
  // Each read that fails says so; the list's own read is the page's error.
  const base = { students: [{ id: 's1', name: 'Ana', email: 'ana@example.com', whop_plan_id: MONTHLY, first_paid_at: '2026-10-10T10:00:00.000Z', discord_username: '@ana.k' }],
    student_progress_counts: [{ student_id: 's1', completed_count: 3 }], lessons: [{ id: 'l1', counts_toward_progress: true }] }
  const failing = (table) => { const db = new FakeDb(base); db.fail[`${table}.select`] = { message: 'canceling statement due to statement timeout' }; return db }
  const r1 = await L.readStudentsList(fakeClient(failing('students')))
  ok(!r1.students.ok && r1.students.error === 'canceling statement due to statement timeout', 'the students read fails: an error, never an empty list', show(r1.students))
  const r2 = await L.readStudentsList(fakeClient(failing('student_progress_counts')))
  const l2 = L.buildStudentsList(r2, course(), NOW)
  // Since the review's fix round a problem is its sentence and the read's own words apart: the page says the words plainly, the raw ones behind Details.
  ok(l2.rows[0].progress === null && !l2.progressKnown && /^Couldn't load the students' progress, so Progress says so/.test(l2.problems[0]?.text ?? '')
       && l2.problems[0]?.error === 'canceling statement due to statement timeout',
     'the progress read fails: Progress unknown on every row (never 0%), a sentence says so, and the read\'s own words come with it', show(l2.problems))
  const r3 = await L.readStudentsList(fakeClient(failing('lessons')))
  const l3 = L.buildStudentsList(r3, course(), NOW)
  ok(l3.rows[0].progress === null && /^Couldn't count the course's lessons/.test(l3.problems[0]?.text ?? ''), 'the lesson count fails: the same, in its own words', show(l3.problems))
  const l4 = L.buildStudentsList(r3, courseFailed, NOW)
  ok(l4.rows[0].activity === null && l4.courseIsNew === null && l4.problems.some((p) => p.text.startsWith("Couldn't read which course is live")),
     'the course cannot be read: no activity, and a sentence says so', show(l4.problems))
  const l5 = L.buildStudentsList(r2, course({}, null), NOW)
  ok(l5.courseIsNew === false && l5.rows[0].activity === null && !l5.problems.some((p) => p.text.includes('course')), 'before the switch: no activity, and nothing failed')
  ok(l2.rows[0].username === 'ana.k' && l2.rows[0].name === 'Ana', 'the username without its "@"')
}
{
  const rows = [
    { id: 'a', name: 'Zed', email: 'zed@example.com', username: 'zz', status: 'active', firstPaidAt: '2026-10-20T00:00:00.000Z', day: 2, lastActiveAt: '2026-10-20T00:00:00.000Z', progress: 10, activity: null },
    { id: 'b', name: 'Amy', email: 'amy@example.com', username: 'amy.b', status: 'past_due', firstPaidAt: '2026-10-19T00:00:00.000Z', day: 3, lastActiveAt: null, progress: 50, activity: null },
    { id: 'c', name: 'Bo', email: 'bo@example.com', username: null, status: 'canceled', firstPaidAt: '2026-10-18T00:00:00.000Z', day: 4, lastActiveAt: '2026-10-21T00:00:00.000Z', progress: null, activity: null },
  ]
  ok(show(L.filterStudents(rows, '@AMY', 'past_due').map((r) => r.id)) === show(['b']) && show(L.filterStudents(rows, 'example', 'past_due').map((r) => r.id)) === show(['b'])
       && show(L.filterStudents(rows, '@AMY', 'active').map((r) => r.id)) === show([]),
     'the search reads name, email and username in any case, with or without "@", and the membership filter narrows it')
  ok(show(L.sortStudents(rows, 'name').map((r) => r.id)) === show(['b', 'c', 'a']) && show(L.sortStudents(rows, 'progress').map((r) => r.id)) === show(['b', 'a', 'c'])
       && show(L.sortStudents(rows, 'active').map((r) => r.id)) === show(['c', 'a', 'b']) && L.sortStudents(rows, 'paid') === rows,
     'sorting by name, progress (unknown last) and last activity (never last); by payment is the list\'s own order')
  // The owner's review (2026-10-21): three pills, Active · Payment failed · Ended (canceled and expired together), Active first.
  const more = [...rows, { ...rows[2], id: 'd', name: 'Di', email: 'di@example.com', status: 'expired' }]
  ok(show(L.STATUS_FILTERS.map((f) => `${f.value}:${f.label}`)) === show(['active:Active', 'past_due:Payment failed', 'ended:Ended']) && L.DEFAULT_STATUS_FILTER === 'active',
     'the pills: Active, Payment failed, Ended, no "All", Active the one the page opens on', show(L.STATUS_FILTERS))
  ok(show(L.filterStudents(more, '', 'active').map((r) => r.id)) === show(['a']) && show(L.filterStudents(more, '', 'past_due').map((r) => r.id)) === show(['b'])
       && show(L.filterStudents(more, '', 'ended').map((r) => r.id)) === show(['c', 'd']),
     'Active holds the active, Payment failed the past due, Ended the canceled and the expired together')
  ok(show(L.statusCounts(more)) === show({ active: 1, past_due: 1, ended: 2 }) && L.statusFilterOf('expired') === 'ended' && L.statusFilterOf('canceled') === 'ended'
       && L.statusFilterOf('active') === 'active' && L.statusFilterOf('past_due') === 'past_due' && L.statusFilterOf('') === null,
     'each pill\'s count, before any search; every one of the four statuses under exactly one pill', show(L.statusCounts(more)))
  const view = fromSrc('src/components/admin/students/StudentsView.tsx')
  ok(/useState<StatusFilter>\(DEFAULT_STATUS_FILTER\)/.test(view) && /\{counts\[f\.value\]\}/.test(view)
       && view.includes('description={`Course members on a $97 monthly plan who first paid on or after ${FROM_DAY}, newest first payment first.`}')
       && view.includes('const FROM_DAY = dayLabel(DISCOUNT_ELIGIBLE_FROM);'),
     'the page opens on Active, every pill with its count, and the header says who is listed in plain words ("who first paid on or after Thu 1 Oct")')
}

// ── One student ─────────────────────────────────────────────────────────────
console.log('\n=== The student page and the drawer: each read apart, the Whop sync marked ===')
const LESSONS = [
  { id: 'a1l01', region_id: 'a1', title: 'One', type: 'watch', requires_action: false, counts_toward_progress: true, day: null, sort_order: 1 },
  { id: 'a1l02', region_id: 'a1', title: 'Two', type: 'action', requires_action: true, counts_toward_progress: true, day: null, sort_order: 2 },
  { id: 'a2l01', region_id: 'a2', title: 'Three', type: 'watch', requires_action: false, counts_toward_progress: true, day: null, sort_order: 3 },
  { id: 'a2l02', region_id: 'a2', title: 'Four', type: 'watch', requires_action: false, counts_toward_progress: true, day: null, sort_order: 4 },
  { id: 'a2pond', region_id: 'a2', title: 'Pond', type: 'watch', requires_action: false, counts_toward_progress: false, day: null, sort_order: 5 },
]
const REGIONS = [{ id: 'a1', name: 'Foundations', order_num: 1 }, { id: 'a2', name: 'Research', order_num: 2 }]
function detailDb(extra = {}) {
  return new FakeDb({
    students: [{ id: 'stu', name: 'Mila Example', email: 'mila@example.com', discord_username: 'mila.e', membership_status: 'active',
      first_paid_at: paidOnDay(6), joined_at: paidOnDay(6), last_active_at: iso(NOW_MS - 3600_000), cancel_scheduled_at: iso(NOW_MS - DAY),
      csm_exempt: false, ad_submissions_verified: true, whop_plan_id: YEARLY }],
    regions: REGIONS,
    lessons: LESSONS,
    student_lesson_completions: [
      { student_id: 'stu', lesson_id: 'a1l01', completed_at: iso(NOW_MS - 2 * DAY) },
      { student_id: 'stu', lesson_id: 'a1l02', completed_at: iso(NOW_MS - 2 * DAY), action_completed_at: null, discord_message_link: null },
      { student_id: 'stu', lesson_id: 'a2l01', completed_at: null, skipped_at: iso(NOW_MS - DAY) },
      { student_id: 'stu', lesson_id: 'a2pond', completed_at: iso(NOW_MS - DAY) },
      { student_id: 'other', lesson_id: 'a2l02', completed_at: iso(NOW_MS - DAY) },
    ],
    discount_requests: [
      { student_id: 'stu', status: 'rejected', created_at: '2026-10-12T10:00:00.000Z' },
      { student_id: 'stu', status: 'pending', created_at: '2026-10-20T10:00:00.000Z' },
    ],
    student_streaks: [{ student_id: 'stu', current_streak: 4, longest_streak: 4, last_streak_date: '2026-10-21' }],
    student_whop_sync: [{ student_id: 'stu', last_sync_at: '2026-10-20T06:00:00.000Z', last_sync_fetched: 4, last_sync_matched: 3, last_sync_unmatched: ['les_x'],
      last_sync_error: 'Whop returned 2 interactions but 0 marked completed', last_sync_error_at: '2026-10-20T06:00:00.000Z' }],
    ...extra,
  })
}
{
  const db = detailDb()
  const reads = await D.readStudentDetail(fakeClient(db), 'stu')
  ok(reads.student.ok && reads.student.data.id === 'stu' && reads.discount.ok && reads.discount.data.status === 'pending',
     'the latest 30% request, of any date: the pending one of 20 Oct over the rejected one of 12 Oct', show(reads.discount))
  const sel = (t) => db.calls(t, 'select')[0]?.columns
  ok(sel('students') === D.DETAIL_COLUMNS && !/plan|\*/.test(sel('students')) && sel('student_whop_sync') === D.SYNC_COLUMNS && !/token/.test(D.SYNC_COLUMNS),
     'the student read names its columns (no plan, no *), and the Whop sync read never asks for the tokens', show({ students: sel('students'), sync: sel('student_whop_sync') }))
  const d = D.buildStudentDetail(reads, course({ stu: iso(NOW_MS - DAY) }), NOW)
  ok(d.progress.ok && d.progress.data === 50,
     'progress over the 4 counting lessons: a watched lesson and a skip count, a half-done action lesson and the pond do not (2 of 4)', show(d.progress))
  ok(d.day === 6 && d.username === 'mila.e' && d.canceling && d.activity === 'moving' && d.areaName === 'Research' && d.streak.ok && d.streak.data === 4,
     'day 6, the username, canceling, moving, in Research (the furthest area with a finished lesson), a 4-day streak',
     show({ day: d.day, activity: d.activity, area: d.areaName, streak: d.streak }))
  const pondOnly = D.buildStudentDetail(await D.readStudentDetail(fakeClient(detailDb({
    student_lesson_completions: [{ student_id: 'stu', lesson_id: 'a2pond', completed_at: iso(NOW_MS - DAY) }] })), 'stu'), course(), NOW)
  ok(pondOnly.areaName === 'Foundations' && pondOnly.progress.ok && pondOnly.progress.data === 0,
     'a lesson outside progress moves neither the area nor the progress: the first area, 0% (the journey\'s chip by the same rule)', show([pondOnly.areaName, pondOnly.progress]))
  // The review's fix round: one map for every page (discount-status.ts), so "Code Applied" as on the 30% tab and the Survey, and the same tone.
  ok(d.discount.ok && d.discount.data.text === 'Applied' && d.discount.data.tone === 'accent' && D.DISCOUNT_STATUS_TEXT === undefined,
     'the request in the 30% page\'s words and colour: pending reads Applied, in the accent tone, from the one map')
  ok(d.sync.ok && d.sync.data.state === 'synced' && d.sync.data.error?.note === true && d.sync.data.unmatched.length === 1,
     'a sync on 20 Oct, after the switch (19 Oct, 14:33 UTC): synced; the backfill\'s note is a note, not an error; the unmatched id listed', show(d.sync))
}
{
  // The marker, on each side of the switch.
  const at = async (lastSyncAt, c = course()) => {
    const db = detailDb({ student_whop_sync: lastSyncAt === undefined ? [] : [{ student_id: 'stu', last_sync_at: lastSyncAt, last_sync_error: 'Upsert failed: permission denied' }] })
    const r = await D.readStudentDetail(fakeClient(db), 'stu')
    return D.buildStudentDetail(r, c, NOW).sync
  }
  const after = await at('2026-10-19T14:33:33.972Z')
  const before = await at('2026-10-19T14:33:33.971Z')
  const never = await at(undefined)
  const empty = await at(null)
  const unknown = await at('2026-10-20T06:00:00.000Z', courseFailed)
  const oldCourse = await at('2026-10-01T06:00:00.000Z', course({}, null))
  ok(after.ok && after.data.state === 'synced' && before.ok && before.data.state === 'stale',
     'a sync at the switch\'s millisecond is since it; one a millisecond before is "Not synced since the switch" (whopPulled, as the 30% page marks it)',
     show([after.data?.state, before.data?.state]))
  ok(never.ok && never.data.state === 'never' && empty.ok && empty.data.state === 'never', 'no sync row, or one with no time: "Never synced"')
  ok(unknown.ok && unknown.data.state === 'unknown' && oldCourse.ok && oldCourse.data.state === 'synced',
     'the switch cannot be read: "Couldn\'t tell"; before any switch, any sync counts')
  ok(before.data.error?.note === false && before.data.error?.text === 'Upsert failed: permission denied', 'a real failure is the last error, not the note')
}
{
  // Each read that fails says so, apart.
  const failing = (...tables) => { const db = detailDb(); for (const t of tables) db.fail[`${t}.select`] = { message: `${t} timed out` }; return db }
  const r = await D.readStudentDetail(fakeClient(failing('student_lesson_completions', 'discount_requests', 'student_streaks', 'student_whop_sync', 'regions')), 'stu')
  const d = D.buildStudentDetail(r, course(), NOW)
  ok(!d.progress.ok && d.progress.error === 'student_lesson_completions timed out' && !d.areas.ok && !d.actionItems.ok,
     'the completions fail: progress, the areas and the action items are unknown, never 0%', show(d.progress))
  ok(!d.discount.ok && !d.streak.ok && !d.sync.ok && d.discount.error === 'discount_requests timed out',
     'the 30% request, the streak and the Whop sync each say they failed: never "No request", 0 days or "Never synced"', show([d.discount, d.streak, d.sync]))
  const gone = await D.readStudentDetail(fakeClient(detailDb()), 'nobody')
  ok(gone.student.ok && gone.student.data === null, 'an id with no student: no error, no student (the page says so)')
  const down = await D.readStudentDetail(fakeClient(failing('students')), 'stu')
  ok(!down.student.ok && down.student.error === 'students timed out', 'the student read fails: the page\'s error, never a spinner forever')
  const old = fromBase('src/app/admin/(authenticated)/students/[id]/page.tsx')
  ok(old.includes('if (studentRes.data) setStudent(studentRes.data);') && old.includes('.limit(1)\n          .single(),') && old.includes('if (loading || !student) {'),
     `control: at ${BASE} the page dropped every error: a failed student read left the spinner up, a failed request read read "No application submitted"`)
}

// ── The journey ─────────────────────────────────────────────────────────────
console.log('\n=== The journey: the new program\'s students on a $97 monthly plan, in the same six columns ===')
const journeyDb = () => {
  const s = (id, first_paid_at, extra = {}) => ({ id, name: id, email: `${id}@example.com`, first_paid_at, whop_membership_id: `mem_${id}`, membership_status: 'active', whop_plan_id: MONTHLY, ...extra })
  const launchMs = Date.parse(DISCOUNT_LAUNCH_DATE)
  return new FakeDb({
    students: [
      s('at-launch', DISCOUNT_LAUNCH_DATE),
      s('just-before', iso(launchMs - 1)),
      s('hidden', '2026-10-15T10:00:00.000Z', { whop_plan_id: HIDDEN_97 }),
      s('yearly', '2026-10-15T10:00:00.000Z', { whop_plan_id: YEARLY }),
      s('brands', '2026-10-16T10:00:00.000Z', { whop_plan_id: BRANDS }),
      s('no-plan', '2026-10-17T10:00:00.000Z', { whop_plan_id: null }),
      s('canceled', '2026-10-12T10:00:00.000Z', { membership_status: 'canceled', whop_plan_id: HIDDEN_97 }),
      s('past-due', '2026-10-13T10:00:00.000Z', { membership_status: 'past_due' }),
      s('expired', '2026-10-14T10:00:00.000Z', { membership_status: 'expired' }),
      s('no-membership', '2026-10-18T10:00:00.000Z', { whop_membership_id: null }),
      s('may', '2026-05-30T10:00:00.000Z'),
      s('hidden-may', '2026-05-31T10:00:00.000Z', { whop_plan_id: HIDDEN_97 }),
      s('free', null, { whop_plan_id: 'plan_free' }),
    ],
    student_progress_counts: [], student_current_region: [], regions: REGIONS, lessons: LESSONS,
  })
}
{
  const db = journeyDb()
  const reads = await J.readJourney(fakeClient(db))
  const ids = reads.students.ok ? reads.students.data.map((x) => x.id).sort() : null
  ok(show(ids) === show(['at-launch', 'canceled', 'hidden', 'past-due']),
     'on the board: either $97 monthly plan, the hidden one too, with a first payment from midnight starting 9 October (Croatia) on, active, past due or canceled; not a yearly plan, an ETfB plan or no plan on file; not a millisecond before, not expired, not without a membership, not May on either plan, not free',
     show(ids))
  const call = db.calls('students', 'select')[0]
  ok(call.columns === J.JOURNEY_COLUMNS && !/plan/.test(call.columns) && call.filters.includes(`first_paid_at>=${DISCOUNT_LAUNCH_DATE}`) && call.filters.includes(PLANS_LINE),
     'both lines are drawn in the database, the date at DISCOUNT_LAUNCH_DATE and the two $97 plans; the plan is a filter, never a column read', show(call.filters))
  // The owner's review (2026-10-21): a card shows no area and no username, so neither is read; the progress is the board's students' alone.
  const progress = db.calls('student_progress_counts', 'select')
  ok(progress.length === 1 && show(progress[0].filters[0].slice('student_id in ('.length, -1).split(',').sort()) === show(ids)
       && db.calls('student_current_region').length === 0 && db.calls('regions').length === 0 && !/discord_username|cancel_scheduled_at/.test(call.columns),
     'the progress is read for the board\'s students alone; no area is read (where each student is, the course\'s areas), nor a username or a booked cancel', show({ progress: progress.map((c) => c.filters), columns: call.columns }))
  const before = fromBase('src/app/admin/(authenticated)/journey/page.tsx')
  ok(before.includes('.in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[])') && before.includes('.gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF)'),
     `control: at ${BASE} the journey held the visible $97 plan only, from 25 May`)
  const was = await J0.readJourney(fakeClient(journeyDb()))
  const wasIds = was.students.ok ? was.students.data.map((x) => x.id).sort() : null
  ok(show(wasIds) === show(['at-launch', 'brands', 'canceled', 'hidden', 'no-plan', 'past-due', 'yearly']),
     `control: the reader at ${BEFORE_97}, on the same database, put every plan on the board: the yearly, the ETfB and the no-plan students too`, show(wasIds))
}
{
  // The two pages agree: on one database, the journey is exactly the students All students lists who paid from the launch on and hold a
  // membership that is active, past due or canceled. Nobody is on the board who is not on the list.
  const rows = [...allStudentsDb().rows('students'), ...journeyDb().rows('students').map((r) => ({ ...r, id: `j-${r.id}` }))]
  const db = new FakeDb({ students: rows, student_progress_counts: [], student_current_region: [], regions: REGIONS, lessons: [{ id: 'l1', counts_toward_progress: true }] })
  const listed = await L.readStudentsList(fakeClient(db))
  const board = await J.readJourney(fakeClient(db))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const listIds = listed.students.ok ? listed.students.data.map((x) => x.id) : []
  const boardIds = board.students.ok ? board.students.data.map((x) => x.id).sort() : null
  const fromList = listIds
    .filter((id) => { const r = byId.get(id); return r.first_paid_at >= DISCOUNT_LAUNCH_DATE && J.JOURNEY_STATUSES.includes(r.membership_status) && r.whop_membership_id })
    .sort()
  ok(listed.students.ok && board.students.ok && boardIds.length > 0 && show(boardIds) === show(fromList) && boardIds.every((id) => listIds.includes(id))
       && boardIds.every((id) => C.MONTHLY_97_PLAN_IDS.includes(byId.get(id).whop_plan_id)),
     'the two pages agree: the board is the list\'s students paid from the launch with a live or churned membership, every one on a $97 monthly plan', show({ board: boardIds, fromList }))
}
{
  const now = Date.parse('2026-11-20T10:00:00.000Z')
  const nowIso = iso(now)
  const st = (id, day, status = 'active', extra = {}) => ({ id, name: id, email: null, membership_status: status, first_paid_at: paidOnDay(day, now), last_active_at: null, cancel_scheduled_at: null, ...extra })
  const students = [st('d7', 7), st('d8', 8), st('d14', 14), st('d15', 15), st('d21', 21), st('d22', 22), st('d30', 30),
    st('d31', 31), st('d31-past-due', 31, 'past_due'), st('d3-canceled', 3, 'canceled'), st('d40-canceled', 40, 'canceled'), st('d12-canceling', 12, 'active', { cancel_scheduled_at: iso(now - DAY) })]
  const reads = {
    students: { ok: true, data: students },
    progress: { ok: true, data: [{ student_id: 'd8', completed_count: 2 }] },
    countingLessons: { ok: true, data: 4 },
  }
  const b = J.buildJourney(reads, course({ d8: iso(now - DAY), d7: iso(now - 10 * DAY), 'd3-canceled': iso(now - DAY) }), nowIso)
  const col = (id) => b.columns.find((c) => c.id === id).cards.map((c) => c.id)
  ok(show(col('week-1')) === show(['d7']) && show(col('week-2')) === show(['d8', 'd12-canceling', 'd14']) && show(col('week-3')) === show(['d15', 'd21'])
       && show(col('week-4')) === show(['d22', 'd30', 'd31-past-due']) && show(col('churned')) === show(['d3-canceled', 'd40-canceled']) && show(col('month-2')) === show(['d31']),
     'the columns as before: weeks of 7 days to day 30, Month 2+ past day 30 when active, a past-due student past day 30 in Week 4, canceled in Churned at any day',
     show(b.columns.map((c) => [c.id, c.cards.map((x) => x.id)])))
  const d8 = b.columns.find((c) => c.id === 'week-2').cards[0]
  const d7 = b.columns.find((c) => c.id === 'week-1').cards[0]
  ok(d8.progress === 50 && d8.activity === 'moving' && d8.day === 8 && d8.lastActive === 'Never' && d7.progress === 0 && d7.activity === 'stalled',
     'a card: the day, the progress and the activity', show({ d8, d7 }))
  // The owner's review (2026-10-21): the name, the day, the activity word, the progress and the last activity, nothing else.
  ok(b.columns.flatMap((c) => c.cards).every((c) => show(Object.keys(c).sort()) === show(['activity', 'day', 'id', 'lastActive', 'name', 'progress'])),
     'every card holds exactly the name (with its id, for the link), the day, the activity, the progress and the last activity: no area, username, Canceling or Payment failed', show(Object.keys(d8)))
  ok(show(b.activity) === show({ not_started: 8, moving: 1, slipping: 0, stalled: 1 }) && b.total === 12,
     'the header counts every student who has not churned by activity (the canceled ones left out)', show(b.activity))
  const failed = J.buildJourney({ ...reads, progress: { ok: false, error: 'timed out' } }, courseFailed, nowIso)
  const any = failed.columns.flatMap((c) => c.cards)
  ok(any.every((c) => c.progress === null && c.activity === null) && failed.activity === null && failed.problems.length === 2
       && failed.problems.every((p) => typeof p.text === 'string' && p.text.startsWith("Couldn't") && typeof p.error === 'string' && p.error.length > 0 && !p.text.includes(p.error)),
     'the progress and the course fail: every card says it does not know, two sentences say why, never 0%', show(failed.problems))
  const view = fromSrc('src/components/admin/journey/JourneyView.tsx')
  const card = view.slice(view.indexOf('function JourneyCardView('), view.indexOf('/** The drawer:'))
  ok(/<StudentName id=\{c\.id\} name=\{c\.name\} size=\{14\} \/>/.test(card) && card.includes('Day {c.day}') && card.includes('<ActivityPill label={c.activity} />')
       && card.includes('`${c.progress}% done`') && card.includes('Last active {') && !/AreaChip|Pill tone|<Meter|username|canceling|past_due/.test(card)
       && (view.match(/<ListPage wide>/g) ?? []).length === 3,
     'the card draws the name, the day, the activity word, the progress as a percentage and the last activity, nothing else; the page is wide (the window\'s width with the side margins)')
  ok(J.buildJourney(reads, course({}, null), nowIso).activity === null, 'before the switch: no activity counts')
}

// ── Tasks ───────────────────────────────────────────────────────────────────
console.log('\n=== Tasks: the tabs, the tiers and the closed lines ===')
{
  const counts = { open: 3, completed: 2, dismissed: 1, archived: 40 }
  ok(show(V.tabsFor({ counts, resetAt: null })) === show([{ value: 'open', label: 'To do', count: 3 }, { value: 'completed', label: 'Sent', count: 2 }, { value: 'dismissed', label: 'Dismissed', count: 1 }]),
     'before the reset: To do, Sent and Dismissed with the route\'s counts, no Archived tab')
  ok(show(V.tabsFor({ counts, resetAt: '2026-10-20T07:00:00.000Z' }).map((t) => `${t.label} ${t.count}`)) === show(['To do 3', 'Sent 2', 'Dismissed 1', 'Archived 40']),
     'after it: Archived too, with its count')
  const stu = (id, extra = {}) => ({ id, name: id, email: null, discord_username: null, membership_status: 'active', first_paid_at: null, joined_at: NOW, cancel_scheduled_at: null, ...extra })
  const tpl = (bucket) => ({ scenario_id: `x.${bucket}`, bucket, week: null, title: bucket, body: '', is_admin_only: false })
  const t = (id, bucket, created, student = stu(id), extra = {}) => ({ id, student_id: student.id, scenario_id: `x.${bucket}`, status: 'open', behavior_summary: null,
    created_at: created, completed_at: null, dismissed_at: null, dismissed_by: null, notes: null, student, template: tpl(bucket), ...extra })
  const rows = [
    t('event-old', 'event', '2026-10-19T08:00:00.000Z'), t('crushing', 'crushing', '2026-10-18T08:00:00.000Z'),
    t('risk-new', 'at_risk', '2026-10-21T07:00:00.000Z'), t('risk-old', 'at_risk', '2026-10-20T07:00:00.000Z'),
    t('cancel', 'cancel_path', '2026-10-21T08:00:00.000Z'),
    t('canceling', 'at_risk', '2026-10-21T08:10:00.000Z', stu('c', { cancel_scheduled_at: '2026-10-20T00:00:00.000Z' })),
    t('sent', 'at_risk', '2026-10-20T07:30:00.000Z', stu('s'), { status: 'completed', completed_at: '2026-10-20T22:30:00.000Z' }),
  ]
  const tiers = V.openTiers(rows)
  ok(show(V.TIER_ORDER.map((k) => tiers[k].map((r) => r.id))) === show([['canceling'], ['cancel'], ['risk-old', 'risk-new'], ['event-old', 'crushing']]),
     'To do: the canceling student first whatever the template, then cancel path, at risk (the longest wait first), then events before crushing',
     show(V.TIER_ORDER.map((k) => tiers[k].map((r) => r.id))))
  const health = V.queueHealth(rows, NOW)
  ok(health.open === 6 && health.canceling === 1 && health.sentToday === 1 && health.oldestDays === 3,
     'the queue line: 6 open, 1 canceling, the oldest 3 days, and the send at 00:30 on the 21st in Croatia counted as today (22:30 UTC on the 20th)', show(health))
  const W = V.waitingText
  ok(show([W('2026-10-21T06:00:00.000Z', NOW), W('2026-10-19T06:00:00.000Z', NOW), W('2026-10-16T06:00:00.000Z', NOW)])
       === show([{ text: 'waiting 2 h', level: 'calm' }, { text: 'waiting 2 days', level: 'warn' }, { text: 'waiting 5 days', level: 'urgent' }]),
     'the wait: hours under a day, then days, louder at 2 and at 4')
  const groups = V.historyGroups([...rows, t('sent-old', 'at_risk', '2026-10-01T07:00:00.000Z', stu('o'), { status: 'completed', completed_at: '2026-10-02T07:00:00.000Z' }),
    t('sent-week', 'at_risk', '2026-10-17T07:00:00.000Z', stu('w'), { status: 'completed', completed_at: '2026-10-18T07:00:00.000Z' })], 'completed', NOW)
  ok(show([groups.today.map((r) => r.id), groups.this_week.map((r) => r.id), groups.older.map((r) => r.id)]) === show([['sent'], ['sent-week'], ['sent-old']]),
     'Sent by when each was sent: today, this week, older')
  const closed = (extra) => V.closedLine(t('x', 'at_risk', '2026-10-18T08:00:00.000Z', stu('x'), extra))
  ok(closed({ status: 'dismissed', dismissed_at: '2026-10-20T07:00:00.000Z', notes: ' [reset for the new program]' }) === 'Dismissed Tue 20 Oct by the reset for the new program'
       && closed({ status: 'dismissed', dismissed_at: '2026-10-20T07:00:00.000Z', notes: 'checked twice [reset for the new program]' }) === 'Dismissed Tue 20 Oct by the reset for the new program. Before it: checked twice'
       && closed({ status: 'dismissed', dismissed_at: '2026-10-20T13:00:00.000Z', notes: 'Auto-dismissed: student no longer in eligible pool.' }) === 'Dismissed Tue 20 Oct automatically: Auto-dismissed: student no longer in eligible pool.'
       && closed({ status: 'dismissed', dismissed_at: '2026-10-20T13:00:00.000Z', dismissed_by: 'tm-1', notes: 'Already replied in Discord' }) === 'Dismissed Tue 20 Oct: Already replied in Discord'
       && closed({ status: 'completed', completed_at: '2026-10-19T22:30:00.000Z', outcome: 'replied' }) === 'Sent Tue 20 Oct, replied'
       && closed({}) === 'Made Sun 18 Oct, still open',
     'how each closed task says it was closed: by the reset (with the note before it), by the checks, by the team with its reason, sent with the reply; dates in Croatia')
  // The review's fix round: while the reset is under 30 days old, the last 30 days are the tasks since it, so only "Since the reset" is offered.
  const resetAt = '2026-10-20T07:00:00.000Z'
  const nowMs = Date.parse(resetAt)
  ok(show(V.insightsRanges(resetAt, nowMs + 2 * 86_400_000).map((r) => r.label)) === show(['Since the reset, Tue 20 Oct'])
       && show(V.insightsRanges(resetAt, nowMs + 29.9 * 86_400_000).map((r) => r.label)) === show(['Since the reset, Tue 20 Oct'])
       && show(V.insightsRanges(resetAt, nowMs + 30 * 86_400_000).map((r) => r.label)) === show(['Last 30 days', 'Since the reset, Tue 20 Oct'])
       && show(V.insightsRanges(null, nowMs).map((r) => r.label)) === show(['Last 30 days', 'All time']),
     'the insights\' ranges: "Since the reset" alone while the reset is under 30 days old, then the last 30 days too; with no reset, the last 30 days and all time')
  ok(R.isAfterTasksReset('2026-10-20T07:00:00.000Z', '2026-10-20T07:00:00.000Z') && !R.isAfterTasksReset('2026-10-20T06:59:59.999Z', '2026-10-20T07:00:00.000Z')
       && R.isAfterTasksReset('2020-01-01T00:00:00.000Z', null),
     'the line: a task made at the reset\'s moment is on the lists, a millisecond before is archived; with no reset every task is on the lists')
  ok(R.checkTasksResetAt('2026-10-20T21:30:00.000Z') === '2026-10-20T21:30:00.000Z' && (() => { try { R.checkTasksResetAt('2026-10-20 21:30'); return false } catch { return true } })(),
     'a reset with its zone is read; one without is refused')
}

console.log('\n=== Tasks insights: only the tasks made since the reset ===')
{
  const FLOOR = '2026-10-20T07:00:00.000Z'
  const team = 'tm-1'
  const task = (id, tpl, status, created, extra = {}) => ({ id, student_id: extra.student ?? 's1', scenario_id: tpl, template_id: tpl, status, created_at: created,
    completed_at: status === 'completed' ? (extra.sent ?? iso(Date.parse(created) + 3600_000)) : null, completed_by: status === 'completed' ? team : null,
    dismissed_at: status === 'dismissed' ? iso(Date.parse(created) + 3600_000) : null, dismissed_by: null, notes: extra.notes ?? null, outcome: extra.outcome ?? null })
  const tables = () => ({
    templates: [
      { id: 'stalled.discord.day3', scenario_id: 'stalled.discord.day3', title: 'Stalled', bucket: 'at_risk', is_admin_only: false, trigger_config: null },
      { id: 'C-cancel', scenario_id: 'C-cancel', title: 'Is cancelling', bucket: 'cancel_path', is_admin_only: false, trigger_config: { all: [{ metric: 'is_canceling', op: 'is' }] } },
    ],
    tasks: [
      // Before the reset: a send, and two dismissed by it.
      task('old-sent', 'stalled.discord.day3', 'completed', '2026-10-15T09:00:00.000Z', { outcome: 'replied' }),
      task('old-reset-1', 'stalled.discord.day3', 'dismissed', '2026-10-18T09:00:00.000Z', { notes: ' [reset for the new program]' }),
      task('old-reset-2', 'C-cancel', 'dismissed', '2026-10-19T09:00:00.000Z', { notes: ' [reset for the new program]' }),
      // After it.
      task('new-open', 'stalled.discord.day3', 'open', '2026-10-20T09:00:00.000Z'),
      task('new-sent', 'C-cancel', 'completed', '2026-10-20T10:00:00.000Z', { student: 's2', outcome: 'no_reply' }),
    ],
    student_milestones: [],
    students: [{ id: 's2', membership_status: 'active', cancel_scheduled_at: null }],
    admin_config: [{ key: 'curriculum_reset_at', value: SWITCH }, { key: 'tasks_reset_at', value: FLOOR }],
  })
  const db = new FakeDb(tables())
  const floored = await O.computeOutreachInsights(fakeClient(db), { sinceIso: null, tasksFloorIso: FLOOR })
  const all = await O.computeOutreachInsights(fakeClient(new FakeDb(tables())), { sinceIso: null })
  ok(floored.totals.created === 2 && floored.totals.sent === 1 && floored.totals.dismissed === 0 && floored.totals.replied === 0 && floored.totals.no_reply === 1
       && floored.tasks_floor === FLOOR,
     'from the reset: 2 made, 1 sent (no reply), and none of the reset\'s own dismissals', show(floored.totals))
  ok(all.totals.created === 5 && all.totals.sent === 2 && all.totals.dismissed === 2 && all.tasks_floor === null,
     'without the floor (the Templates strip) every task counts, as before', show(all.totals))
  const read = db.calls('tasks', 'select')[0]
  ok(read.filters.includes(`created_at>=${FLOOR}`), 'the floor is drawn in the database read', show(read.filters))
  const cancelRow = floored.templates.find((r) => r.template_id === 'C-cancel')
  ok(cancelRow?.success_label === 'still a member, cancel withdrawn' && O.FAMILY_SUCCESS_LABEL.canceling === 'still a member, cancel withdrawn',
     'D12: a save is "still a member, cancel withdrawn", no longer "still subscribed"', cancelRow?.success_label)

  // The route reads the floor and hands it in; a failed read is a 500.
  setTeam({ id: 'team-csm-1', role: 'csm' }, fakeClient(new FakeDb(tables())))
  const res = await insightsRoute(new Request('http://app/api/admin/tasks/insights'))
  const body = await res.json()
  ok(res.status === 200 && body.tasks_floor === FLOOR && body.totals.created === 2, 'GET /api/admin/tasks/insights reads tasks_reset_at and counts from it', show({ status: res.status, floor: body.tasks_floor }))
  const broken = new FakeDb(tables())
  broken.failWhen = (q) => (q.table === 'admin_config' && q.filters.includes('key=tasks_reset_at') ? { message: 'permission denied for table admin_config' } : null)
  setTeam({ id: 'team-csm-1', role: 'csm' }, fakeClient(broken))
  const bad = await insightsRoute(new Request('http://app/api/admin/tasks/insights'))
  const badBody = await bad.json()
  ok(bad.status === 500 && badBody.error === "Couldn't read when the tasks were reset (admin_config.tasks_reset_at): permission denied for table admin_config",
     'the floor cannot be read: 500 with the reason, never every task as if there were no reset', show(badBody))
}

console.log('\n=== The words (D12), no plan on a row, and who the headers say is listed ===')
{
  ok(METRICS.membership_status.label === 'Membership status' && METRICS.membership_status.describe({ metric: 'membership_status', op: 'is_not', value: 'canceled' }) === 'Membership status is not canceled',
     'the TriggerBuilder\'s metric and the task summaries read "Membership status"')
  const builder = fromSrc('src/components/admin/TriggerBuilder.tsx')
  ok(builder.includes(': METRICS[m].label}') && !/Subscription/i.test(builder), 'TriggerBuilder shows the metric\'s own label, and never says Subscription')
  const LANE = ['src/components/admin/tasks/TasksView.tsx', 'src/components/admin/tasks/InsightsView.tsx', 'src/components/admin/students/StudentsView.tsx',
    'src/components/admin/students/StudentDetailView.tsx', 'src/components/admin/journey/JourneyView.tsx', 'src/components/admin/people-parts.tsx',
    'src/lib/admin/student-detail.ts', 'src/lib/admin/tasks-view.ts']
  const said = LANE.filter((f) => /subscri|whop_plan_id|planLabel|PAYING_WHOP_PLAN/i.test(fromSrc(f)))
  ok(said.length === 0, 'no page of this lane, nor the student page\'s or Tasks\' reader, reads a plan column or names a subscription', said.join(', '))
  // Since the owner's answer of 2026-10-21 the two list readers filter on the $97 plans, in the database, and that is all they do with a plan.
  const READERS = ['src/lib/admin/students-list.ts', 'src/lib/admin/journey-board.ts']
  const readers = READERS.map((f) => {
    const s = fromSrc(f)
    return { f, quoted: (s.match(/"whop_plan_id"/g) ?? []).length, filter: (s.match(/\.in\("whop_plan_id", MONTHLY_97_PLAN_IDS\)/g) ?? []).length, other: /subscri|planLabel|PAYING_WHOP_PLAN/i.test(s) }
  })
  ok(readers.every((r) => r.quoted === 1 && r.filter === 1 && !r.other),
     'All students\' and the journey\'s readers name the plan once, in their one filter on MONTHLY_97_PLAN_IDS: never PAYING_WHOP_PLAN_IDS, never a subscription', show(readers))
  const sv = fromSrc('src/components/admin/students/StudentsView.tsx')
  const jv = fromSrc('src/components/admin/journey/JourneyView.tsx')
  // Since the owner's review (2026-10-21) All students says its first day too: "who first paid on or after Thu 1 Oct".
  ok(sv.includes('description={`Course members on a $97 monthly plan who first paid on or after ${FROM_DAY}, newest first payment first.`}')
       && sv.includes('`No course member on a $97 monthly plan has paid since ${FROM_DAY}.`')
       && jv.includes("description={`The new program's students: course members on a $97 monthly plan with a first payment on or after ${dayLabel(")
       && !/any plan/i.test([sv, jv, ...READERS.map(fromSrc)].join('\n')),
     'the headers say who is listed in plain words, course members on a $97 monthly plan from their first day, and so does All students\' empty list; "any plan" is gone from both pages and their readers')
  const oldInsights = fromBase('src/app/admin/(authenticated)/tasks/insights/page.tsx')
  ok(oldInsights.includes('save DMs — still subscribed'), `control: at ${BASE} the insights said "still subscribed"`)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
