// admin-render-second.test.mjs: admin rebuild 2's render review, its second
// round (2026-10-21): every rule the round added, as the source has it. The
// findings are the review of the render review's fix round, whose own rules
// admin-render-fixes.test.mjs holds.
//
//   the 30%      the reason a coupon row's Reject starts with is the map's
//                own sentence to the student (MEMBERSHIP_DISCOUNT_LINE): no
//                code, no third person, and the team can change it before
//                sending; the coupon's row has "Check Whop again" in
//                Approve's place, through POST /api/admin/thirty/check-coupon
//                (the route runs in membership-discount.test.mjs, the page in
//                world-tests/admin-pages.mjs)
//   the cron     every student holding a pending request is read, whatever
//                their window (the behaviour: membership-discount.test.mjs)
//   insights     Outreach insights' Saves and Success rate in the primary ink
//   dashboard    the header says "Couldn't load" when no tile could be drawn
//                (nothingLoaded); a short run of readings is dots joined by
//                their line (TrendChart, rendered)
//   names        a username on one line, cut with an ellipsis, the whole of
//                it in a title; no underline on a name nothing opens from
//   student      every block whose read failed starts with the tiles'
//                warning dot (SectionFailure), on the page and in the drawer
//   docs         CONTEXT.md's coupon cron lines; system_contracts.md's tasks
//                contract names every reader of tasks the source has
//   unchanged    /admin/not-activated, byte for byte as at d0ebe76
//
// Run by `npm run test:client`, after client-tests/build.mjs (which copies
// thirty-view.ts, discount.ts, dashboard-metrics.ts, croatia-dates.ts and
// people-common.ts). The parts it renders it compiles itself, under names of
// its own (rs-*.mjs). A control reads the files at 22e83fb, night/admin2
// before this round, where a rule is about words in a file.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const git = (...args) => execFileSync('git', args, { cwd: here('..'), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
/** world-engine when admin rebuild 2 started: the not-activated page as it was. */
const BASE = 'd0ebe76'
/** night/admin2 before this round. */
const BEFORE = '22e83fb'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
/** Words nobody reads on these pages (the PRD's rule for every sentence a page shows). */
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
/** next/link as a plain <a>, so a rendered link shows where it goes. */
const LINK = ['import Link from "next/link";', 'import { createElement as __ce } from "react"; const Link = ({ href, children, ...rest }) => __ce("a", { href, ...rest }, children);']
compile('src/components/admin/ui.tsx', 'rs-ui.mjs', [LINK])
compile('src/components/admin/student-name.tsx', 'rs-student-name.mjs', [LINK, ['from "@/lib/admin/people-common"', 'from "./people-common.ts"']])
compile('src/components/admin/dashboard/TrendChart.tsx', 'rs-trend-chart.mjs', [['from "@/lib/admin/croatia-dates"', 'from "./croatia-dates.ts"']])

const UIM = await import('./_gen/rs-ui.mjs')
const { StudentName } = await import('./_gen/rs-student-name.mjs')
const { TrendChart } = await import('./_gen/rs-trend-chart.mjs')
const TV = await import('./_gen/thirty-view.ts')
const { MEMBERSHIP_DISCOUNT_LINE } = await import('./_gen/discount.ts')
const M = await import('./_gen/dashboard-metrics.ts')

const render = (component, props, ...children) => renderToString(createElement(component, props, ...children))
/** Whether `rev:path` exists in git. */
const inGit = (rev, path) => {
  try { git('cat-file', '-e', `${rev}:${path}`); return true } catch { return false }
}

// ── The 30%: the reason a coupon row's Reject starts with ──────────────────
console.log('\n=== The 30%: the reason the student reads, and Check Whop again ===')
const page = fromSrc('src/components/admin/thirty/ThirtyView.tsx')
const pending = page.slice(page.indexOf('function PendingRow('), page.indexOf('/** The 30% code, and a button that copies it. */'))
{
  const LINE = "You can't apply for this discount because you already have a discount applied to your account."
  ok(TV.COUPON_REJECT_REASON === LINE && MEMBERSHIP_DISCOUNT_LINE === LINE,
     'a coupon row\'s Reject starts with the map\'s own sentence to the student, word for word (MEMBERSHIP_DISCOUNT_LINE, the owner\'s words)', TV.COUPON_REJECT_REASON)
  ok(/\byou\b/i.test(LINE) && !/\b(their|they|them|this student|has a discount)\b/i.test(LINE) && !/evolve|ECOM30|promo|\(/i.test(LINE) && !BANNED.test(LINE),
     'it speaks to the student, names no code and nobody in the third person; no em dash, "unlock" or "EcomTalent"')
  ok(/if \(opening && coupon && !reason\.trim\(\)\) setReason\(COUPON_REJECT_REASON\);/.test(pending)
       && /value=\{reason\}\s*onChange=\{\(e\) => setReason\(e\.target\.value\)\}/.test(pending)
       && /onReject\(row, reason\.trim\(\) \|\| null\)/.test(pending),
     'filled in when Reject opens on a coupon row; the field stays the team\'s to change, and what is sent is what it holds')
  ok(!page.includes('couponRejectReason') && !fromSrc('src/lib/admin/thirty-view.ts').includes('couponRejectReason'), 'the old words\' function is gone')
  const old = git('show', `${BEFORE}:src/lib/admin/thirty-view.ts`)
  ok(old.includes('Already has a discount on their membership (${code})'), `control: at ${BEFORE} the reason named the code and spoke of the student as "their"`)
}

// ── The 30%: Check Whop again ───────────────────────────────────────────────
{
  // Since the owner's review (2026-10-21) a founder's or an admin's Approve anyway stands beside it (admin-owner-review.test.mjs).
  ok(/\{coupon && \(\s*<button[\s\S]*?data-check-whop=""[\s\S]*?onCheck\(row\)[\s\S]*?\{busy === "check" \? "Checking Whop" : "Check Whop again"\}\s*<\/button>\s*\)\}/.test(pending)
       && /\{!coupon && verdict\.ok && !canOverride && \(\s*<Button/.test(pending),
     'the coupon\'s row: "Check Whop again" in Approve\'s place ("Checking Whop" while Whop is asked), and still no Approve')
  ok(/data-check-whop=""\s*style=\{\{ \.\.\.SMALL_LINK, padding: "0 6px"/.test(pending), 'a small link, as Approve anyway is (SMALL_LINK: 13px words, a 44px target)')
  ok(/if \(!e\) setReason\(\(cur\) => \(cur === COUPON_REJECT_REASON \? "" : cur\)\);/.test(pending),
     'after Whop answers, the filled-in reason goes with the answer it was for (a row whose coupon is gone never starts Reject with it); a reason the team wrote stays')
  const check = page.slice(page.indexOf('async function checkCoupon('), page.indexOf('function closeNotice('))
  ok(/const r = await transport\.checkCoupon\(row\.id\);/.test(check) && /if \(!r\.ok\) return refused\("check", row, r\);/.test(check) && /await reload\(\);/.test(check) && !/lock\(row\.id\)/.test(check),
     'the page: the check, then the list read again, which judges the row by what was stored; nothing was decided, so the row is not locked')
  ok(/function listIsStale\(kind: RowCall, status: number\): boolean \{\s*return status === 409 \|\| status === 404 \|\| \(status === 400 && \(kind === "approve" \|\| kind === "applied"\)\);/.test(page),
     'a request decided meanwhile (409) or gone (404) reads the list again; any other refusal stays on the row')
  ok(/send<[^>]*>\("POST", "\/api\/admin\/thirty\/check-coupon", \(\) => \(\{ requestId \}\)\)/.test(fromSrc('src/lib/admin/admin-transport.ts')),
     'the transport posts the request\'s id to POST /api/admin/thirty/check-coupon')
  const route = fromSrc('src/app/api/admin/thirty/check-coupon/route.ts')
  ok(/requireTeam\(request, \["founder", "admin", "csm"\]\)/.test(route) && /\.eq\("id", requestId\)/.test(route) && /if \(row\.status !== "pending"\)/.test(route)
       && /checkMembershipDiscount\(supabase, row\.student_id\)/.test(route) && /if \(!coupon\.saved\)/.test(route),
     'the route: any team role; a pending request\'s student only; the approve route\'s own reader; a 200 only when Whop\'s answer was stored')
  ok(!/createWhopPromoCode|\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(route), 'it makes no Whop code and writes nothing itself (the reader stores Whop\'s answer)')
  const fixtures = fromSrc('src/app/dev/admin/fixtures.ts')
  ok(/checkCoupon\(id\) \{/.test(fixtures) && /"stalecoupon"/.test(fixtures) && /whopDown/.test(fixtures),
     'the dev page answers it too: ?state=stalecoupon (the code gone from Tara\'s membership in Whop) and ?whop=down')
  ok(!inGit(BEFORE, 'src/app/api/admin/thirty/check-coupon/route.ts') && !git('show', `${BEFORE}:src/components/admin/thirty/ThirtyView.tsx`).includes('Check Whop again'),
     `control: at ${BEFORE} a coupon row had nothing but Reject, and no route to ask Whop again`)
}

// ── The cron's population ───────────────────────────────────────────────────
console.log('\n=== The coupon cron: every pending request, whatever its window ===')
{
  const md = fromSrc('src/lib/membership-discount.ts')
  ok(/db\.from\("discount_requests"\)\.select\("student_id"\)\.eq\("status", "pending"\)\.order\("id"\)/.test(md)
       && /answer\.pending_requests = pendingIds\.filter\(\(id\) => byId\.has\(id\)\)\.length;/.test(md),
     'the cron reads every pending request\'s student beside the open windows (the behaviour on a moved clock: membership-discount.test.mjs)')
  ok(/\.gte\("first_paid_at", earliestOpenFirstPayment\(startedAtMs\)\)/.test(md) && /\.in\("status", \["approved", "applied"\]\)/.test(md),
     'the open windows still read from the earliest first payment that can be open, and a student with the 30% already is still left out')
  const old = git('show', `${BEFORE}:src/lib/membership-discount.ts`)
  ok(!old.includes('.eq("status", "pending")') && old.includes('a pending one is decided by the approve\n * route\'s own live read'),
     `control: at ${BEFORE} a pending request was left out once its window closed, on the reading that the approve route would read Whop for it (a coupon row has no Approve)`)
}

// ── Outreach insights ───────────────────────────────────────────────────────
console.log('\n=== Outreach insights: no number in Airy Blue that is not a link ===')
{
  const view = fromSrc('src/components/admin/tasks/InsightsView.tsx')
  const stats = [...view.matchAll(/<Stat\b[\s\S]*?\/>/g)].map((m) => m[0])
  ok(stats.length === 5 && stats.every((s) => !/\btone=/.test(s)) && stats.some((s) => s.includes('label="Saves"')) && stats.some((s) => s.includes('label="Success rate"')),
     'its 5 numbers, Saves and Success rate among them, in the primary ink: no tone', show(stats.length))
  const drawn = render(UIM.Stat, { label: 'Saves', value: '50%', sublabel: '1 of 2 save DMs: still a member' })
  ok(/class="stat-value"[^>]*color:var\(--color-text-primary\)/.test(drawn) && !drawn.includes('--color-accent-dark'), 'a Stat with no tone draws its number in the primary ink', drawn.slice(0, 140))
  const old = git('show', `${BEFORE}:src/components/admin/tasks/InsightsView.tsx`)
  ok((old.match(/tone=\{totals\.(saves|success)_eligible > 0 \? "accent" : "default"\}/g) ?? []).length === 2, `control: at ${BEFORE} Saves and Success rate were Airy Blue`)
}

// ── The Dashboard ───────────────────────────────────────────────────────────
console.log('\n=== The Dashboard: its header when nothing loaded; a short line\'s dots ===')
{
  const NOW = Date.parse('2026-10-20T08:30:00.000Z')
  const read = (data) => ({ ok: true, data })
  const no = (error) => ({ ok: false, error })
  const reads = (over = {}) => ({
    students: read([]), bounty: read([]), openTasks: read(0), tasksResetAt: read(null), toDecide: read(0),
    snapshots: read([]), canceling: read([]), resetAt: read('2026-10-19T14:33:33.972Z'), ...over,
  })
  const TIMEOUT = 'canceling statement due to statement timeout'
  ok(M.nothingLoaded(M.buildDashboard(M.allFailed('Failed to fetch'), NOW)), 'the loader threw (every read failed): nothing loaded')
  const everyRead = reads({
    students: no(TIMEOUT), bounty: no('permission denied for table student_milestones'), tasksResetAt: no('admin_config: x'), resetAt: no('admin_config: x'),
    openTasks: no('admin_config: x'), toDecide: no('permission denied for table discount_requests'), snapshots: no(TIMEOUT), canceling: no('x'),
  })
  ok(M.nothingLoaded(M.buildDashboard(everyRead, NOW)), 'every read failed on its own (the dev page\'s ?state=error): nothing loaded')
  const tilesDown = reads({ students: no(TIMEOUT), snapshots: no(TIMEOUT), toDecide: no(TIMEOUT), tasksResetAt: no(TIMEOUT) })
  ok(M.nothingLoaded(M.buildDashboard(tilesDown, NOW)),
     'the reads every tile needs failed, the bounty stamps, the canceling rows and the switch read: still no tile to draw, so nothing loaded')
  ok(!M.nothingLoaded(M.buildDashboard(reads({ openTasks: no(TIMEOUT), snapshots: no(TIMEOUT) }), NOW)) && !M.nothingLoaded(M.buildDashboard(reads(), NOW))
       && !M.nothingLoaded(M.buildDashboard(reads({ students: no(TIMEOUT), snapshots: no(TIMEOUT), tasksResetAt: no(TIMEOUT) }), NOW)),
     'one tile drawn (30% to decide alone, or most of the page): the header keeps its time')
  const view = fromSrc('src/components/admin/dashboard/DashboardView.tsx')
  ok(/const meta = nothingLoaded\(model\) \? \(\s*<FailedMeta text=\{busyNote \? `Couldn't load · \$\{busyNote\}` : "Couldn't load"\} \/>\s*\) : \(\s*\[`Updated \$\{clockLabel\(model\.generatedAt\)\}`, busyNote\]\.filter\(Boolean\)\.join\(" · "\)\s*\);/.test(view),
     'the header: "Couldn\'t load" with the warning dot (FailedMeta, as every page\'s) when no tile could be drawn, "Updated 10:30" otherwise')
  ok(/const meta = \[\s*`Updated \$\{clockLabel\(model\.generatedAt\)\}`/.test(git('show', `${BEFORE}:src/components/admin/dashboard/DashboardView.tsx`)),
     `control: at ${BEFORE} the header said "Updated" over a page where every read had failed`)
}
{
  // The 14 days of the trend tiles, oldest first; null is a day with no reading.
  const days = Array.from({ length: 14 }, (_, i) => `2026-10-${String(7 + i).padStart(2, '0')}`)
  const draw = (values) => render(TrendChart, { points: days.map((date, i) => ({ date, value: values[i] ?? null })), kind: 'line', height: 44, label: 'Avg progress', format: (v) => `${v.toFixed(2)}%` })
  const dots = (html) => (html.match(/data-reading-dot=""/g) ?? []).length
  const marks = (html) => [...html.matchAll(/<div aria-hidden="true" data-reading-dot="" style="([^"]*)"/g)].map((m) => m[1])
  /** The last reading's 8px dot with the surface ring, which every line ends on. */
  const ringDots = (html) => (html.match(/width:8px;height:8px;margin-left:-4px;margin-top:-4px;border-radius:999px;background:var\(--color-accent-dark\);box-shadow/g) ?? []).length
  const line = (html) => html.includes('vector-effect="non-scaling-stroke"')
  const empty = (n) => Array(n).fill(null)
  const two = draw([...empty(12), 2.66, 2.71])
  ok(dots(two) === 2 && line(two) && two.includes('left:calc(6px + (100% - 12px) * 0.923') && two.includes('left:calc(6px + (100% - 12px) * 1)'),
     'Avg progress the day after the switch: its 2 readings each a dot, joined by their short line, at the right end of the 14 days', show({ dots: dots(two), line: line(two) }))
  ok(marks(two).every((s) => s.includes('width:6px;height:6px') && !s.includes('box-shadow')) && ringDots(two) === 0,
     'each a 6px dot with no ring, and no 8px ringed dot over the last: on a phone the days are 10px apart, and two 8px ringed dots touch and hide the line', show(marks(two)))
  const one = draw([...empty(13), 2.71])
  ok(dots(one) === 1 && !line(one) && ringDots(one) === 0, 'one reading: a dot, and no line')
  ok(dots(draw([...empty(11), 2.6, 2.66, 2.71])) === 3, 'three readings in a run: still a dot on each (2 days of line, about 34px at 1280 wide)')
  const four = draw([...empty(10), 2.5, 2.6, 2.66, 2.71])
  ok(dots(four) === 0 && line(four) && ringDots(four) === 1, 'four or more: the line alone, ending on the last reading\'s ringed dot as every line does')
  ok(dots(draw(days.map((_, i) => 1000 + i))) === 0, 'the 14 days read (Active): no reading dots')
  ok(dots(draw([1, 2, 3, 4, 5, 6, null, 8, 9, null, 11, 12, 13, 14])) === 2, 'a run of 2 between two gaps: its 2 readings get dots; the long runs do not')
  ok(/const SHORT_RUN = 3;/.test(fromSrc('src/components/admin/dashboard/TrendChart.tsx')), 'SHORT_RUN is 3 readings')
  ok(/const lone = segments\.filter\(\(s\) => s\.length === 1\)/.test(git('show', `${BEFORE}:src/components/admin/dashboard/TrendChart.tsx`)),
     `control: at ${BEFORE} only a reading alone had a dot, so 2 readings were a 20px stroke and one dot`)
}

// ── Names ───────────────────────────────────────────────────────────────────
console.log('\n=== The name part: a long username, a name nothing opens from ===')
{
  const html = render('div', null, createElement(StudentName, { id: 's-1', name: 'Maximilian Featherstonehaugh-Smythe', username: '@max.featherstonehaugh' }))
  const user = (html.match(/<span data-student-username=""[^>]*>/) ?? [''])[0]
  ok(/title="@max\.featherstonehaugh"/.test(user) && /white-space:nowrap/.test(user) && /overflow:hidden/.test(user) && /text-overflow:ellipsis/.test(user)
       && /max-width:100%/.test(user) && /min-width:0/.test(user) && !/overflow-wrap:anywhere/.test(user),
     'a username on one line: in the row\'s wrapping line it goes under the name, and past the line\'s width it ends in an ellipsis, the whole username in its title; it never breaks between characters', user)
  const none = render('div', null, createElement(StudentName, { id: null, name: 'A student no longer on file' }))
  const link = render('div', null, createElement(StudentName, { id: 's-1', name: 'Ana Example' }))
  const asText = render('div', null, createElement(StudentName, { id: 's-1', name: 'Ana Example', asText: true }))
  ok(!none.includes('<a ') && !/text-decoration/.test(none) && /text-decoration:underline/.test(link) && /<a href="\/admin\/students\/s-1"/.test(link) && /text-decoration:underline/.test(asText),
     'no student behind the name ("A student no longer on file"): no link and no underline; a link, or a name inside a row that is one, keeps it')
  const old = git('show', `${BEFORE}:src/components/admin/student-name.tsx`)
  ok(/data-student-username="" style=\{\{ fontSize: 13, color: "var\(--color-text-secondary\)", overflowWrap: "anywhere"/.test(old) && /textDecoration: "underline",\s*textDecorationColor/.test(old),
     `control: at ${BEFORE} the username broke anywhere, and every name was underlined`)
  // Every row that draws a username is a wrapping flex line, which the username's ellipsis needs.
  const files = git('grep', '-l', '<StudentName ', '--', 'src/components').trim().split('\n').filter(Boolean)
  const unwrapped = []
  let uses = 0
  for (const f of files) {
    const src = fromSrc(f)
    for (const m of src.matchAll(/<StudentName [^>]*username=/g)) {
      uses++
      if (!/className="flex flex-wrap/.test(src.slice(Math.max(0, m.index - 320), m.index))) unwrapped.push(`${f}@${m.index}`)
    }
  }
  // 7 since the owner's review (2026-10-21): a journey card names the student with no username.
  ok(uses >= 7 && unwrapped.length === 0, `every StudentName with a username sits in a wrapping flex line (${uses} of them in ${files.length} files)`, unwrapped.join(', '))
  const students = fromSrc('src/components/admin/students/StudentsView.tsx')
  ok(/<p title=\{row\.name\} style=\{\{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" \}\}>/.test(students)
       && /title=\{row\.username \? `@\$\{row\.username\}` : undefined\}/.test(students),
     'All students\' wide row: the name and the username it cuts with an ellipsis carry their whole text in a title')
}

// ── A student's page ────────────────────────────────────────────────────────
console.log('\n=== A student: every failed block starts with the tiles\' warning dot ===')
{
  const detail = fromSrc('src/components/admin/students/StudentDetailView.tsx')
  const section = detail.slice(detail.indexOf('export function SectionFailure('), detail.indexOf('/** Progress, streak, first payment'))
  ok(/data-section-failed=""/.test(section) && /<Dot color="var\(--color-warning\)" \/>/.test(section) && /<ReadFailure lead=\{lead\} raw=\{raw\}/.test(section),
     'SectionFailure: the warning dot, then what could not load and why in plain words (ReadFailure, the database\'s words behind Details)')
  const tileDot = detail.slice(detail.indexOf('<p data-failed=""'), detail.indexOf('{COULD_NOT_LOAD}'))
  const dotPart = fromSrc('src/components/admin/people-parts.tsx')
  const shared = dotPart.slice(dotPart.indexOf('export function Dot('), dotPart.indexOf('/** A lasting problem'))
  ok(/width: 8, height: 8, borderRadius: 999, background: "var\(--color-warning\)"/.test(tileDot) && /width: 8, height: 8, marginTop: 6, borderRadius: 999, background: color/.test(shared),
     'the same dot as a failed number\'s: 8px, round, the warning colour (set 6px down, on the first line of words)')
  const blocks = ['the Whop sync', 'the 30% request', 'the lessons']
  ok(blocks.every((w) => detail.includes('<SectionFailure lead={`${COULD_NOT_LOAD} ' + w + '.`}')) && !/<ReadFailure lead=\{`\$\{COULD_NOT_LOAD\}/.test(detail),
     'the student page: the Whop sync, the 30% request and the lessons each start with it when their read failed')
  const journey = fromSrc('src/components/admin/journey/JourneyView.tsx')
  ok(journey.includes('<SectionFailure lead="Couldn\'t load the lessons."') && journey.includes('<SectionFailure lead="Couldn\'t load the action items."') && !journey.includes('<ReadFailure'),
     'the journey\'s drawer, which shows the same blocks, draws its failed ones the same way')
  ok(!git('show', `${BEFORE}:src/components/admin/students/StudentDetailView.tsx`).includes('SectionFailure'), `control: at ${BEFORE} a failed block had no dot`)
}

// ── The docs ────────────────────────────────────────────────────────────────
console.log('\n=== CONTEXT.md\'s coupon cron; system_contracts.md\'s readers of tasks ===')
{
  const context = fromSrc('CONTEXT.md')
  ok(!context.includes('since the render review\'s fix round, 2026-10-21, it read every student who first paid from 1 October')
       && !context.includes('a pending one is decided by the approve route\'s own live read'),
     'CONTEXT.md no longer says the cron read every student since the render review\'s fix round (it was until), nor that the approve route reads Whop for a pending request (a coupon row has no Approve)')
  const lines = context.split('\n')
  const routeLine = lines.find((l) => l.startsWith('- `GET /api/cron/refresh-membership-discounts`')) ?? ''
  const cronRow = lines.find((l) => l.startsWith('| `refresh-membership-discounts` |')) ?? ''
  const libRow = lines.find((l) => l.startsWith('| `membership-discount.ts`')) ?? ''
  ok([routeLine, cronRow, libRow].every((l) => /pending request/.test(l)) && /until the render review's fix round/.test(routeLine),
     'its route line, its cron row and its library row name the pending requests the cron reads; the route line dates the window read correctly', show([routeLine.length, cronRow.length, libRow.length]))
  ok(/Whop answered no read before the time ran out/.test(cronRow), 'the cron row lists every way a run fails, the run Whop never answered too')

  const contracts = fromSrc('system_contracts.md')
  const tasks = contracts.slice(contracts.indexOf('### `tasks` (CSM task queue)'), contracts.indexOf('### `daily_progress_snapshots`'))
  const dependedOn = tasks.slice(tasks.indexOf('**Depended on by**'), tasks.indexOf('Nothing'))
  // Every file of the source that reads tasks, and every route that reads it through computeOutreachInsights, by the name the contract gives it.
  const NAMES = {
    'src/app/admin/(authenticated)/page.tsx': '`src/app/admin/(authenticated)/page.tsx`',
    'src/app/api/admin/tasks/route.ts': '`GET /api/admin/tasks`',
    'src/app/api/admin/tasks/[id]/': '`/api/admin/tasks/[id]` routes',
    'src/app/api/cron/check-csm-tasks/route.ts': '`check-csm-tasks`',
    'src/app/api/cron/check-na-tasks/route.ts': '`check-na-tasks`',
    'src/lib/csm-events.ts': '`src/lib/csm-events.ts`',
    'src/lib/csm-task-evaluation.ts': '`src/lib/csm-task-evaluation.ts`',
    'src/lib/outreach-insights.ts': '`src/lib/outreach-insights.ts`',
    'src/app/api/admin/tasks/insights/route.ts': '`GET /api/admin/tasks/insights`',
    'src/app/api/admin/templates/stats/route.ts': '`GET /api/admin/templates/stats`',
  }
  const readers = [
    ...git('grep', '-l', 'from("tasks")', '--', 'src').trim().split('\n'),
    ...git('grep', '-l', 'computeOutreachInsights(', '--', 'src/app').trim().split('\n'),
  ].filter(Boolean)
  const unnamed = readers.filter((f) => {
    const key = Object.keys(NAMES).find((k) => (k.endsWith('/') ? f.startsWith(k) : f === k))
    return !key || !dependedOn.includes(NAMES[key])
  })
  ok(readers.length >= 12 && unnamed.length === 0, `the tasks contract names every reader the source has (${readers.length} files), before "Nothing else reads it"`, unnamed.join(', '))
  ok(/`GET \/api\/admin\/templates\/stats`[^.]*every task/.test(dependedOn) && fromSrc('src/app/api/admin/templates/stats/route.ts').includes('computeOutreachInsights(auth.supabase, {})'),
     'among them GET /api/admin/templates/stats, the Templates page\'s numbers: computeOutreachInsights with no floor, every task of any date')
  const oldTasks = git('show', `${BEFORE}:system_contracts.md`)
  const oldDepended = oldTasks.slice(oldTasks.indexOf('### `tasks` (CSM task queue)'), oldTasks.indexOf('### `daily_progress_snapshots`'))
  ok(!oldDepended.slice(oldDepended.indexOf('**Depended on by**'), oldDepended.indexOf('Nothing')).includes('templates/stats'),
     `control: at ${BEFORE} the readers left GET /api/admin/templates/stats out, then said "Nothing else reads it"`)
}

// ── Unchanged ───────────────────────────────────────────────────────────────
console.log('\n=== /admin/not-activated, left as restored ===')
{
  const rel = 'src/app/admin/(authenticated)/not-activated/page.tsx'
  ok(fromSrc(rel) === git('show', `${BASE}:${rel}`), `/admin/not-activated is still the page of ${BASE}, byte for byte (the owner decides)`)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
