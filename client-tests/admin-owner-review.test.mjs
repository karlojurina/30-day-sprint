// admin-owner-review.test.mjs: the owner's review of the admin on the preview
// (2026-10-21), every rule it added, run as the source has it.
//
//   dashboard   no source or explanation line under the program's and the
//               trends' tiles (the (i) buttons keep the definitions), and
//               taller charts; the Bounty Program's arrow beside its 14-day
//               number: up and green when the last 14 days beat the 14
//               before them, down and red when fewer, none when equal, the
//               earlier count in its tooltip and its words for a screen
//               reader (bountyTrend, BountyArrow drawn)
//   the 30%     "Approve anyway" for a founder or an admin on every Applied
//               row a check refuses, the coupon's too, and after the approve
//               route's refusal of a check (its code "rule": the 409 "The
//               course changed and this check cannot run" among them); its
//               confirm names what it skips; the coupons' sentence above the
//               list is gone. The route here: the rule's refusals carry code
//               "rule" and `override` passes them. A csm's override refused
//               runs in admin-discounts.test.mjs (the routes' own login), the
//               coupon override in membership-discount.test.mjs
//   apply       both routes that make a request refuse when the coupon check
//               cannot run, word for word, and write nothing (Whop down, no
//               membership and a payment's id run in
//               membership-discount.test.mjs; here, no Whop key)
//   the survey  both routes refuse an application whose required questions
//               have no answer (the forms' own rule), fail closed when the
//               questions cannot be read, and write nothing then
// All students and the journey (the population from 1 October, the pills,
// the cards) run in admin-people.test.mjs; the pages in a browser in
// world-tests/admin-pages.mjs.
//
// Run by `npm run test:client`, after client-tests/build.mjs (which copies
// dashboard-metrics.ts, thirty-view.ts, discount-feedback.ts, the discount
// routes and their libraries). The parts it renders it compiles itself,
// under names of its own (ow-*.mjs).
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
/** Words nobody reads on these pages or the map (the PRD's rule for every sentence shown). */
const BANNED = /—|\bunlock|ecomtalent/i

/** A .tsx file compiled as Next compiles it (types out, JSX to react/jsx-runtime), its imports rewritten. */
function compile(rel, out, rewrites = []) {
  let s = ts.transpileModule(fromSrc(rel), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${rel} has no ${from}`)
    s = s.split(from).join(to)
  }
  if (/(?:from|import)\s*["']@\//.test(s)) throw new Error(`an unrewritten @/ import remains in ${rel}`)
  fs.writeFileSync(here(`./_gen/${out}`), s)
}
const LINK = ['import Link from "next/link";', 'import { createElement as __ce } from "react"; const Link = ({ href, children, ...rest }) => __ce("a", { href, ...rest }, children);']
const UI = [['from "@/components/admin/ui"', 'from "./ow-ui.mjs"']]
compile('src/components/admin/ui.tsx', 'ow-ui.mjs', [LINK])
compile('src/components/admin/review-parts.tsx', 'ow-review-parts.mjs', [LINK, ...UI, ['from "@/lib/admin/read-failure"', 'from "./read-failure.ts"']])
compile('src/components/admin/list-parts.tsx', 'ow-list-parts.mjs', [...UI, ['from "@/components/admin/review-parts"', 'from "./ow-review-parts.mjs"']])
compile('src/components/admin/dashboard/TrendChart.tsx', 'ow-trend-chart.mjs', [['from "@/lib/admin/croatia-dates"', 'from "./croatia-dates.ts"']])
compile('src/components/admin/dashboard/DashboardView.tsx', 'ow-dashboard-view.mjs', [
  LINK,
  ['import tokens from "@/components/admin/admin-tokens.module.css";', 'const tokens = {};'],
  ['from "@/components/admin/list-parts"', 'from "./ow-list-parts.mjs"'],
  ['from "@/components/admin/review-parts"', 'from "./ow-review-parts.mjs"'],
  ...UI,
  ['from "@/lib/admin/croatia-dates"', 'from "./croatia-dates.ts"'],
  ['from "@/lib/admin/dashboard-metrics"', 'from "./dashboard-metrics.ts"'],
  ['from "@/lib/world/discount"', 'from "./discount.ts"'],
  ['from "./TrendChart"', 'from "./ow-trend-chart.mjs"'],
])

const M = await import('./_gen/dashboard-metrics.ts')
const { BountyArrow } = await import('./_gen/ow-dashboard-view.mjs')
const TV = await import('./_gen/thirty-view.ts')
const F = await import('./_gen/discount-feedback.ts')
const DS = await import('./_gen/discount-server.ts')
const { PAYING_WHOP_PLAN_IDS_ARRAY } = await import('./_gen/metrics-definitions.ts')
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
const { FakeDb, useDb: installDb, setCatalog } = await import('./_gen/stub-server.ts')
// The codes asked of Whop: stub-admin.ts's list, the one every copy shares (thirty-apply.ts's included, T-137).
const { promoCodes } = await import('./_gen/stub-admin.ts')
const { POST: approveRoute } = await import('./_gen/discount-approve-route.ts')
const { POST: requestRoute } = await import('./_gen/discount-request-route.ts')
const { POST: feedbackRoute } = await import('./_gen/discount-submit-feedback-route.ts')

const render = (component, props) => renderToString(createElement(component, props))
/** Runs `fn` with the server log kept off the output, and hands it back. */
async function quiet(fn) {
  const real = [console.info, console.warn, console.error]
  const lines = []
  console.info = console.warn = console.error = (...a) => { lines.push(a.map(String).join(' ')) }
  try { return { value: await fn(), lines } } finally { [console.info, console.warn, console.error] = real }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The Dashboard: the Bounty Program\'s arrow ===')
{
  const NOW = Date.parse('2026-10-21T08:30:00.000Z')
  const days = M.trendDays(NOW)
  ok(days[0] === '2026-10-08' && days[13] === '2026-10-21', 'the window: 8 to 21 October (UTC), so the 14 days before it are 24 September to 7 October', show([days[0], days[13]]))
  const student = (id) => ({ id, membership_status: 'active', whop_plan_id: PAYING_WHOP_PLAN_IDS_ARRAY[0], first_paid_at: '2026-06-01T00:00:00.000Z', canceled_at: null, cancel_scheduled_at: null })
  const stamp = (student_id, at) => ({ student_id, bounty_access_claimed_at: at })
  const students = ['a', 'b', 'c', 'd'].map(student)
  const stamps = [
    stamp('a', '2026-10-08T00:00:00.000Z'), // the window's first moment: the last 14 days
    stamp('b', '2026-10-07T23:59:59.999Z'), // the moment before it: the 14 days before
    stamp('c', '2026-09-24T00:00:00.000Z'), // the first moment of the 14 days before
    stamp('d', '2026-09-23T23:59:59.999Z'), // the moment before that: all time only
    stamp('outside', '2026-10-01T09:00:00.000Z'), // a stamp outside the population: nowhere
  ]
  const b = M.bounty(students, stamps, days)
  ok(b.last14 === 1 && b.previous14 === 2 && b.allTime === 4,
     'the 14 days before the window count their stamps to the millisecond at both ends; a stamp outside the population counts nowhere', show({ last14: b.last14, previous14: b.previous14, allTime: b.allTime }))
  ok(M.bountyTrend(b) === 'down', '1 in the last 14 days against 2 before: down')
  const cases = [[3, 2, 'up'], [2, 3, 'down'], [2, 2, null], [0, 0, null], [1, 0, 'up'], [0, 1, 'down'], [64, 63, 'up']]
  const got = cases.map(([last14, previous14]) => M.bountyTrend({ last14, previous14 }))
  ok(show(got) === show(cases.map((c) => c[2])), 'up when the last 14 days beat the 14 before, down when they hold fewer, no arrow when equal (0 and 0 too)', show(got))
  const dash = M.buildDashboard({
    students: { ok: true, data: students }, bounty: { ok: true, data: stamps }, openTasks: { ok: true, data: 0 }, tasksResetAt: { ok: true, data: null },
    needsHand: { ok: true, data: 0 }, thirtyApplied: { ok: true, data: 0 }, snapshots: { ok: true, data: [] }, canceling: { ok: true, data: [] }, resetAt: { ok: true, data: null },
  }, NOW)
  ok(dash.bounty.ok && dash.bounty.value.previous14 === 2, 'the Dashboard\'s Bounty tile carries the earlier count', show(dash.bounty.ok && dash.bounty.value.previous14))

  const up = render(BountyArrow, { b: { last14: 12, previous14: 9 } })
  const down = render(BountyArrow, { b: { last14: 5, previous14: 9 } })
  const level = render(BountyArrow, { b: { last14: 9, previous14: 9 } })
  ok(/data-bounty-arrow="up"/.test(up) && /title="9 in the 14 days before"/.test(up) && /color:var\(--color-success\)/.test(up)
       && /<span aria-hidden="true">↑<\/span>/.test(up) && /<span class="sr-only">Up from 9 in the 14 days before<\/span>/.test(up),
     'drawn up: a green ↑, hidden from a screen reader, "Up from 9 in the 14 days before" for one, the earlier count in its tooltip', up)
  ok(/data-bounty-arrow="down"/.test(down) && /title="9 in the 14 days before"/.test(down) && /color:var\(--color-danger\)/.test(down)
       && /<span aria-hidden="true">↓<\/span>/.test(down) && /<span class="sr-only">Down from 9 in the 14 days before<\/span>/.test(down),
     'drawn down: a red ↓ and "Down from 9 in the 14 days before"', down)
  ok(level === '', 'equal: no arrow at all', level)
  const big = render(BountyArrow, { b: { last14: 1400, previous14: 1234 } })
  ok(big.includes('title="1,234 in the 14 days before"') && !BANNED.test(big), 'a count in the thousands as every number on the page: 1,234')

  const view = fromSrc('src/components/admin/dashboard/DashboardView.tsx')
  // Canceling's "pressed cancel" was the words beside its number; its (i) keeps "who pressed cancel in Whop".
  // "Joined per day" over the Bounty Program's bars is the same kind of line as Churned's "Access ended, per day".
  const gone = ['Whop status now, the line from the nightly snapshot', 'unit="pressed cancel"', 'Access ended, per day', 'The nightly snapshot',
    'Students on the monthly plan who first paid from', 'who joined on the bounty site', 'SourceLine', 'Whop now, the line from', '"Joined per day"']
  ok(gone.every((w) => !view.includes(w)), 'no source or explanation line under a tile: the owner\'s list, word for word, is gone from the page, and "Joined per day" with it', gone.filter((w) => view.includes(w)).join(' | '))
  ok(/\{tile\.value\.last14 === 0 && \(\s*<p[^>]*>\s*Nobody joined in these 14 days\.\s*<\/p>\s*\)\}/.test(view),
     'a 14 days with nobody still says so under the number')
  const how = view.slice(view.indexOf('function ActiveTile('), view.indexOf('// ── Loading'))
  ok((how.match(/how=\{/g) ?? []).length === 4 && how.includes('whose Whop status is active') && how.includes('who pressed cancel in Whop') && how.includes('whose access ended, per day')
       && how.includes('One number for the tile and its line'),
     'the (i) buttons keep the definitions: every trend tile\'s "How it\'s counted" as it was')
  const n = (name) => Number((view.match(new RegExp(`const ${name} = (\\d+);`)) ?? [])[1])
  ok(n('TREND_CHART') > 44 && n('BOUNTY_CHART') > 124 && n('MONTH2_CHART') > 112 && /height=\{TREND_CHART\}/.test(view) && /height=\{BOUNTY_CHART\}/.test(view) && /height=\{MONTH2_CHART\}/.test(view),
     `the room goes to taller charts: the trend lines ${n('TREND_CHART')}px (44), the Bounty Program\'s bars ${n('BOUNTY_CHART')}px (124), Month 2\'s line ${n('MONTH2_CHART')}px (112)`)
  ok(/<BigNumber size=\{56\}>\{int\(tile\.value\.last14\)\}<\/BigNumber>\s*<BountyArrow b=\{tile\.value\} \/>/.test(view),
     'the arrow sits beside the big 14-day number')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The 30%: Approve anyway wherever a check refuses, for a founder or an admin ===')
{
  const COURSE = 'The course changed and this check cannot run. Nothing was approved.'
  ok(TV.anywaySkip({ ok: false, reason: 'has-discount' }, null) === 'coupon' && TV.anywaySkip({ ok: false, reason: 'has-discount' }, COURSE) === 'coupon',
     'the coupon\'s row: Approve anyway skips the coupon check (and the rule)')
  ok(['locked', 'before-launch', 'no-payment', 'no-gate', 'late-request', 'another-request', 'read-failed', 'unknown'].every((reason) => TV.anywaySkip({ ok: false, reason }, null) === 'rule'),
     'every refusal of the rule, and a rule that could not judge: Approve anyway skips the rule')
  ok(TV.anywaySkip({ ok: true, reason: null }, COURSE) === 'check' && TV.anywaySkip({ ok: true, reason: null }, null) === null,
     'the verdict says yes but the approve route refused (its code "rule", the 409 among them): Approve anyway; nothing refused: none')
  const coupon = TV.approveAnywayText('coupon', 'This student already has a discount on their membership (evolve10).', null)
  // The verdict sentences the page shows (the 80% rule's since 2026-10-26).
  const rule = TV.approveAnywayText('rule', TV.VERDICT_TEXT.lockedOpen, null)
  const check = TV.approveAnywayText('check', TV.VERDICT_TEXT.yes, COURSE)
  ok(coupon === "Approve anyway skips the coupon check and the 30% rule, and creates the student's Whop code now. This student already has a discount on their membership (evolve10).",
     'the coupon\'s confirm names the code it skips, and claims nothing about what Whop does with two codes (nobody has checked it)', coupon)
  ok(rule === "Approve anyway skips the 30% rule, and creates the student's Whop code now. The rule says: Fewer than 80% of the videos up to the checkpoint are watched so far. A discount already on the membership is still checked first.",
     'the rule\'s confirm names the rule and why it said no', rule)
  ok(check === `Approve anyway skips the check that refused this approval, and creates the student's Whop code now. The check said: ${COURSE} A discount already on the membership is still checked first.`,
     'after the route\'s refusal: the confirm names the check and what it said', check)
  ok(![coupon, rule, check].some((s) => BANNED.test(s)), 'no em dash, "unlock" or "EcomTalent" in any of them')

  const page = fromSrc('src/components/admin/thirty/ThirtyView.tsx')
  const pending = page.slice(page.indexOf('function PendingRow('), page.indexOf('/** The 30% code, and a button that copies it. */'))
  ok(/canApproveAnyway = false,/.test(page) && /const canOverride = canApproveAnyway && skip !== null;/.test(pending) && /const skip = anywaySkip\(verdict, refusal\);/.test(pending),
     'Approve anyway shows only for a founder or an admin (canApproveAnyway, off unless the page says so), wherever anywaySkip finds a refusal')
  ok(/\{approveAnywayText\(skip, verdict\.text, refusal\)\}/.test(pending) && /onApprove\(row, skip === "coupon" \? "coupon" : "rule"\)/.test(pending)
       && /aria-expanded=\{confirm === "override"\}/.test(pending) && /Yes, create the code/.test(pending),
     'it asks once, inline, naming what it skips, then sends the override: the coupon\'s too on the coupon\'s row')
  ok(/if \(!r\.ok && r\.code === "rule"\) \{\s*const text = decisionError\("approve", r\);\s*setRefusals\(\(cur\) => new Map\(cur\)\.set\(row\.id, text\)\);/.test(page)
       && /const r = await transport\.approve\(row\.id, how !== "plain", how === "coupon"\);/.test(page),
     'a refusal of a check from the approve route stays on the row and is remembered, so Approve anyway is offered there (the 409 used to read the list again and leave Approve to be refused again)')
  ok(!page.includes("Couldn&apos;t read the membership coupons") && !page.includes('data.couponsUnread'),
     'the sentence above the list when the coupons cannot be read is gone: the rows simply show no coupon')
  const wrapper = fromSrc('src/app/admin/(authenticated)/discounts/ThirtyPage.tsx')
  ok(/const canApproveAnyway = teamMember\?\.role === "founder" \|\| teamMember\?\.role === "admin";/.test(wrapper) && /<ThirtyView canApproveAnyway=\{canApproveAnyway\} \/>/.test(wrapper)
       && fromSrc('src/app/admin/(authenticated)/discounts/page.tsx').includes('<ThirtyPage />'),
     'the real page hands the signed-in member\'s role: a founder or an admin')
  ok(/overrideCoupon,\s*reviewerId: me,/.test(fromSrc('src/lib/admin/admin-transport.ts')), 'the transport sends overrideCoupon with override')
}

// ── The approve route: the rule's refusals carry code "rule", and override passes them ──
console.log('\n=== The approve route: code "rule" on a check\'s refusal, override past it ===')
delete process.env.WHOP_API_KEY
// The 30% that applies itself (T-137): after the checks the route puts the 30% on (putThirtyOn), which needs the course's
// product named (a made-up one). With no Whop key here the code is made and the request left approved, Whop not asked.
process.env.WHOP_PRODUCT_ID = 'prod_devCourse'
delete process.env.STUDENT_APP_CLOSED
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
const PAID = new Date(Date.now() - 2 * 86_400_000).toISOString()
async function approve(body) {
  const res = await approveRoute(new Request('http://app/api/discounts/approve', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { status: res.status, body: await res.json() }
}
{
  // The new course: one video up to the gate, not watched.
  const newCourse = () => {
    setCatalog({ v2: true, lessonsTable: 'lessons' })
    const db = new FakeDb({
      students: [{ id: 's1', first_paid_at: PAID, joined_at: PAID }],
      lessons: [{ id: 'a1l01', type: 'watch', sort_order: 1, duration_seconds: 300, is_gate: true }],
      lesson_videos: [{ lesson_id: 'a1l01', created_at: '2026-10-01T00:00:00.000Z' }],
      student_lesson_completions: [],
      discount_requests: [{ id: 'r1', student_id: 's1', status: 'pending', created_at: new Date(Date.now() - 3_600_000).toISOString() }],
    })
    installDb(db)
    return db
  }
  let db = newCourse()
  let r = await quiet(() => approve({ requestId: 'r1' }))
  ok(r.value.status === 400 && r.value.body.code === 'rule' && db.rows('discount_requests')[0].status === 'pending',
     'the new course, a video not watched: 400 with code "rule" (the page offers Approve anyway on it)', show(r.value))
  db = newCourse()
  const made = promoCodes.length
  r = await quiet(() => approve({ requestId: 'r1', override: true }))
  ok(r.value.status === 200 && db.rows('discount_requests')[0].status === 'approved' && promoCodes.length === made + 1,
     'override (a founder here: the stand-in\'s login) passes it: approved, the code made', show(r.value.body))

  // The old course's shape on the new course's data, as the preview runs: the check cannot run.
  const oldShape = () => {
    setCatalog({ v2: false })
    const db = new FakeDb({
      students: [{ id: 's1', first_paid_at: PAID, joined_at: PAID }],
      lessons: [{ id: 'a1l01', region_id: 'a1' }],
      discount_requests: [{ id: 'r1', student_id: 's1', status: 'pending', created_at: new Date(Date.now() - 3_600_000).toISOString() }],
    })
    installDb(db)
    return db
  }
  db = oldShape()
  r = await quiet(() => approve({ requestId: 'r1' }))
  ok(r.value.status === 409 && r.value.body.error === 'The course changed and this check cannot run. Nothing was approved.' && r.value.body.code === 'rule',
     'no lesson in r1 or r2: the 409 "The course changed and this check cannot run", with code "rule" (it had no code, and the page read the list again)', show(r.value))
  db = oldShape()
  r = await quiet(() => approve({ requestId: 'r1', override: true }))
  ok(r.value.status === 200 && db.rows('discount_requests')[0].status === 'approved', 'Approve anyway past it: approved, the code made', show(r.value.body))
  db = oldShape()
  db.rows('discount_requests')[0].status = 'rejected'
  r = await quiet(() => approve({ requestId: 'r1', override: true }))
  ok(r.value.status === 400 && r.value.body.code === undefined && r.value.body.error === 'Request already processed',
     'a request already decided is no check\'s refusal: no code "rule", so no Approve anyway after it', show(r.value))
  const route = fromSrc('src/app/api/discounts/approve/route.ts')
  ok(/if \(\(override \|\| overrideCoupon\) && auth\.teamMember\.role !== "founder" && auth\.teamMember\.role !== "admin"\) \{\s*return NextResponse\.json\(\{ error: "Only a founder or an admin can approve past a check\." \}, \{ status: 403 \}\);/.test(route)
       && route.indexOf('auth.teamMember.role !== "founder"') < route.indexOf('.from("discount_requests")'),
     'a csm\'s override is refused before anything is read (the routes\' real login runs it in admin-discounts.test.mjs)')
  // Since T-122's fourth fix round the coupon check that gave no answer refuses the normal Approve with the code too,
  // and since 2026-10-26 Whop showing no real payment from the student. Since the 30% that applies itself (T-137) the
  // checks live in thirty-apply.ts (thirtyApprovalChecks), which the route and the job both run.
  const checks = fromSrc('src/lib/thirty-apply.ts')
  ok((checks.match(/\.\.\.RULE/g) ?? []).length === 8, 'every refusal the override skips carries the code (thirtyApprovalChecks): the switch date unread, the new rule, the old rule\'s four, the coupon check that gave no answer, and Whop showing no real payment', String((checks.match(/\.\.\.RULE/g) ?? []).length))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Apply: the coupon check that cannot run writes nothing ===')
{
  ok(DS.MEMBERSHIP_UNCHECKED === "We couldn't check your membership just now. Try again in a minute." && show(DS.membershipUncheckedRefusal()) === show({ grant: false, status: 503, state: 'read-failed', error: DS.MEMBERSHIP_UNCHECKED }),
     'the sentence, word for word, as a 503 the student can try again after')
}

// ── The survey, and both apply routes ───────────────────────────────────────
/**
 * A student ready to apply on the new course, the coupon `coupon` ('clean' stored, or none), and the team's
 * questions. The clean row holds its source: since T-122's third fix round a stored "no coupon" answers only when the
 * rule of that round wrote it (v113's source set), and since its fifth only with the rule's stamp (`source` with the
 * rule's version, `source_checked_at` its checked_at), the version r6 since the owner's paid plan and payment
 * (2026-10-26).
 */
function applyDb({ coupon = 'clean', questions = [] } = {}) {
  setCatalog({ v2: true, lessonsTable: 'lessons_next' })
  const db = new FakeDb({
    students: [{ id: 's1', supabase_user_id: 'auth-1', first_paid_at: PAID, joined_at: PAID, whop_membership_id: 'mem_devClean' }],
    lessons_next: [
      { id: 'a1l01', type: 'watch', sort_order: 1, duration_seconds: 300 },
      { id: 'a1l02', type: 'watch', sort_order: 2, duration_seconds: 300, is_gate: true },
    ],
    lesson_videos: [{ lesson_id: 'a1l01', created_at: '2026-10-01T00:00:00.000Z' }, { lesson_id: 'a1l02', created_at: '2026-10-01T00:00:00.000Z' }],
    student_lesson_completions: [
      { student_id: 's1', lesson_id: 'a1l01', completed_at: PAID },
      { student_id: 's1', lesson_id: 'a1l02', completed_at: PAID },
    ],
    discount_requests: [],
    discount_feedback_questions: questions,
    student_membership_discounts: coupon === 'clean'
      ? [{ student_id: 's1', whop_membership_id: 'mem_devClean', promo_code_id: null, promo_code: null, renewal_price: 97, plan_renewal_price: 97, discounted: false, checked_at: PAID, source: 'r6-membership', source_checked_at: PAID }]
      : [],
  }, { 'tok-1': 'auth-1' })
  db.functions.submit_discount_with_feedback = async (args, client) => {
    const { data: row, error } = await client.from('discount_requests').insert({ student_id: args.p_student_id }).select('id').single()
    if (error) return { data: null, error }
    for (const a of args.p_answers) await client.from('discount_feedback_responses').insert({ discount_request_id: row.id, question_id: a.question_id })
    return { data: row.id, error: null }
  }
  installDb(db)
  return db
}
async function post(route, path, body) {
  const res = await route(new Request(`http://app/api/discounts/${path}`, {
    method: 'POST', headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { status: res.status, body: await res.json() }
}
const written = (db) => db.rows('discount_requests').length + db.calls('submit_discount_with_feedback', 'rpc').length
{
  for (const [name, route, path, body] of [['the plain request', requestRoute, 'request', { studentId: 's1' }], ['the questions form', feedbackRoute, 'submit-feedback', { answers: [] }]]) {
    const db = applyDb({ coupon: 'none' })
    const r = await quiet(() => post(route, path, body))
    ok(r.value.status === 503 && r.value.body.error === DS.MEMBERSHIP_UNCHECKED && written(db) === 0,
       `${name}, no Whop key and nothing stored for the membership: refused with the sentence, nothing written`, show(r.value))
    const clean = applyDb()
    const r2 = await quiet(() => post(route, path, body))
    ok(r2.value.status === 200 && clean.rows('discount_requests').length === 1, `${name}, the stored answer says no discount: the request goes in`, show(r2.value))
  }
}

console.log('\n=== The survey: every required question answered, or nothing is written ===')
const Q = (id, question_type, is_required, is_active = true) => ({ id, order_num: 1, question_text: `Question ${id}`, question_type, is_required, is_active })
const QUESTIONS = [
  Q('q-scale', 'scale', true), Q('q-choice', 'multi_choice', true), Q('q-text', 'open_text', true),
  Q('q-optional', 'open_text', false), Q('q-retired', 'open_text', true, false),
]
const ALL = [
  { question_id: 'q-scale', answer_scale: 9 },
  { question_id: 'q-choice', answer_choice: 'Just right' },
  { question_id: 'q-text', answer_text: 'The hooks lesson.' },
]
{
  const required = QUESTIONS.filter((q) => q.is_required && q.is_active)
  ok(show(F.unansweredRequired(required, ALL)) === show([]), 'every required question answered: nothing missing')
  ok(show(F.unansweredRequired(required, ALL.filter((a) => a.question_id !== 'q-text'))) === show(['q-text']), 'an open question left out: missing')
  ok(show(F.unansweredRequired(required, [ALL[0], ALL[1], { question_id: 'q-text', answer_text: '   ' }])) === show(['q-text']), 'words that are only spaces are no answer, as the form has it')
  ok(show(F.unansweredRequired(required, [{ question_id: 'q-scale', answer_scale: '9' }, ALL[1], ALL[2]])) === show(['q-scale']), 'a scale takes a number: "9" as words is no answer')
  ok(show(F.unansweredRequired(required, [{ question_id: 'q-scale', answer_text: '9' }, ALL[1], ALL[2]])) === show(['q-scale']), 'an answer in the wrong field for its type is no answer')
  ok(show(F.unansweredRequired(required, [ALL[0], { question_id: 'q-choice', answer_choice: '' }, ALL[2]])) === show(['q-choice']), 'an empty choice is no answer')
  ok(show(F.unansweredRequired(required, [ALL[0], ALL[1], { question_id: 'q-text', answer_text: null }, { question_id: 'q-text', answer_text: 'Second try.' }])) === show([]),
     'two answers to one question: one with words is enough')
  ok(show(F.unansweredRequired(required, [])) === show(['q-scale', 'q-choice', 'q-text']), 'no answers at all: every required question missing')
  ok(F.UNANSWERED_REQUIRED === 'Answer every question that is not marked Optional, then send it again.'
       && F.ANSWERS_UNCHECKED === "We couldn't check your answers just now, so nothing was sent. Try again in a minute."
       && ![F.UNANSWERED_REQUIRED, F.ANSWERS_UNCHECKED].some((s) => BANNED.test(s)),
     'the student reads plain sentences: no em dash, "unlock" or "EcomTalent"')
  const form = fromSrc('src/components/world/WorldDiscountForm.tsx')
  ok(form.includes('{!q.is_required && <span className={f.optional}>Optional</span>}'), 'the map\'s form marks the questions that are not required "Optional", as the sentence says')

  let db = applyDb({ questions: QUESTIONS })
  let r = await quiet(() => post(feedbackRoute, 'submit-feedback', { answers: ALL }))
  ok(r.value.status === 200 && db.rows('discount_requests').length === 1 && db.rows('discount_feedback_responses').length === 3,
     'the form with every required question answered (the optional and the retired ones left empty): the request goes in, with its answers', show(r.value))
  for (const [why, answers] of [
    ['an open question left out', ALL.filter((a) => a.question_id !== 'q-text')],
    ['words that are only spaces', [ALL[0], ALL[1], { question_id: 'q-text', answer_text: '   ' }]],
    ['a scale with no number', [{ question_id: 'q-scale' }, ALL[1], ALL[2]]],
    ['no answers at all', []],
  ]) {
    db = applyDb({ questions: QUESTIONS })
    r = await quiet(() => post(feedbackRoute, 'submit-feedback', { answers }))
    ok(r.value.status === 400 && r.value.body.error === F.UNANSWERED_REQUIRED && written(db) === 0 && r.lines.some((l) => l.includes('required question')),
       `the form, ${why}: 400, the plain sentence, nothing written and the database function never called; the log names the questions`, show(r.value))
  }
  db = applyDb({ questions: QUESTIONS })
  db.fail['discount_feedback_questions.select'] = { message: 'canceling statement due to statement timeout' }
  r = await quiet(() => post(feedbackRoute, 'submit-feedback', { answers: ALL }))
  ok(r.value.status === 503 && r.value.body.error === F.ANSWERS_UNCHECKED && written(db) === 0 && !/canceling statement/.test(show(r.value.body)),
     'the questions cannot be read: 503, fails closed (never "no questions"), nothing written, the database\'s words in the log only', show(r.value))

  db = applyDb({ questions: QUESTIONS })
  r = await quiet(() => post(requestRoute, 'request', { studentId: 's1' }))
  ok(r.value.status === 400 && r.value.body.error === F.UNANSWERED_REQUIRED && db.rows('discount_requests').length === 0,
     'a plain request while the team has required questions: refused the same way, nothing written (the map sends one only when it finds no question)', show(r.value))
  db = applyDb({ questions: [Q('q-optional', 'open_text', false), Q('q-retired', 'open_text', true, false)] })
  r = await quiet(() => post(requestRoute, 'request', { studentId: 's1' }))
  ok(r.value.status === 200 && db.rows('discount_requests').length === 1, 'with no active required question, the plain request goes in as before', show(r.value))
  const feedback = fromSrc('src/app/api/discounts/submit-feedback/route.ts')
  ok(feedback.indexOf('requiredAnswersRefusal(supabase,') < feedback.indexOf('supabase.rpc(') && feedback.indexOf('requiredAnswersRefusal(supabase,') < feedback.indexOf('if (CATALOG_IS_V2)'),
     'the form route asks before the rule and long before the database function, on either course')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
