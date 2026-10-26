// admin-review.test.mjs: admin rebuild 2's review fix round (WI-11), every
// rule the round added, run as the source has it. _admin/prds/admin-rebuild-2/
// in the workspace holds the PRD; the findings are the design critique's and
// the wiring review's of 2026-10-20.
//
//   plain words   a failed read said in plain words, the raw text behind
//                 Details (read-failure.ts, review-parts.tsx), on the
//                 Dashboard, All students, a student's page, the journey,
//                 Insights and every page's LoadError
//   Insights      Avg progress from the course switch (no cliff, its change
//                 in points, the Dashboard's deltaOf), gridlines labelled
//                 with their own values (max 1, 3 and 36.4), the Dashboard's
//                 chart and palette, Churned full width, an Updated line
//   feedback      only the rated lessons, newest rating first; the rest one
//                 line per area; no lesson id in a row
//   statuses      one map for the 30% statuses (discount-status.ts): the 30%
//                 tabs, the Survey and a student's page name and colour the
//                 4 statuses the same
//   survey        from 1 October by default, the older ones counted and one
//                 toggle away; unanswered questions hidden; the summary
//   the 30% page  every row's coupon check (not checked yet, stored, Whop
//                 now on an Approved row, could not ask), the Approved rows
//                 asked of Whop by GET /api/admin/thirty (readApprovedCoupons
//                 on a stand-in fetch), Approve on beside the coupon's
//                 verdict, Approve anyway in Approve's place, Reject ghost,
//                 "Reject the request" danger
//   the coupon    a stored id that is not a membership's is asked about
//                 through the student's Whop user (T-122; it was logged and
//                 never asked); a cron run Whop never answered is a failure
//   student page  the quick DMs in the messages draft's words, the settings
//                 at the foot
//   the frame     buttons (one ink, danger for an undoable no), "Refresh"
//                 only re-reads, the header's actions under the words on a
//                 phone, the guard's dark loading screen, the student side's
//                 one filled button
//   removals      plans.ts and the helpers only the removed pages used;
//                 "the owner" in the three new lines (the not-activated page,
//                 removed here too, is back since the render review's fix
//                 round: admin-render-fixes.test.mjs)
//
// Run by `npm run test:client`, after client-tests/build.mjs (which copies
// read-failure.ts and discount-status.ts). The views it renders it compiles
// itself (ui.tsx, review-parts.tsx, list-parts.tsx), as templates-page does,
// under names of its own (ar-*.mjs).
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const exists = (rel) => fs.existsSync(here(`../${rel}`))
const BASE = 'ff411f6' // night/admin2 after the merge, before this round
const fromBase = (rel) => execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: here('..'), encoding: 'utf8' })

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

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
const UI = [['from "@/components/admin/ui"', 'from "./ar-ui.mjs"']]
compile('src/components/admin/ui.tsx', 'ar-ui.mjs', [['import Link from "next/link";', 'const Link = (props) => props.children;']])
compile('src/components/admin/review-parts.tsx', 'ar-review-parts.mjs', [
  ['import Link from "next/link";', 'const Link = (props) => props.children;'],
  ...UI,
  ['from "@/lib/admin/read-failure"', 'from "./read-failure.ts"'],
])
compile('src/components/admin/list-parts.tsx', 'ar-list-parts.mjs', [...UI, ['from "@/components/admin/review-parts"', 'from "./ar-review-parts.mjs"']])

const RF = await import('./_gen/read-failure.ts')
const STATUS = await import('./_gen/discount-status.ts')
const SURVEY = await import('./_gen/survey-data.ts')
const INS = await import('./_gen/insights-data.ts')
const DASH = await import('./_gen/dashboard-metrics.ts')
const FB = await import('./_gen/lesson-feedback.ts')
const D = await import('./_gen/student-detail.ts')
const { loadThirtyData, readApprovedCoupons } = await import('./_gen/thirty-data.ts')
const { buildThirtyView } = await import('./_gen/thirty-view.ts')
const MD = await import('./_gen/membership-discount.ts')
const { FakeDb, fakeClient, setCatalog } = await import('./_gen/stub-server.ts')
const PARTS = await import('./_gen/ar-review-parts.mjs')
const LIST = await import('./_gen/ar-list-parts.mjs')

const render = (component, props) => renderToString(createElement(component, props))
/** The visible words of rendered HTML, entities read. */
const words = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
/** The words outside every <details>, and inside its <summary>: what shows before Details is pressed. */
const shownWords = (html) => words(html.replace(/<details[^>]*>([\s\S]*?)<\/details>/g, (_, inner) => (inner.match(/<summary[^>]*>[\s\S]*?<\/summary>/) ?? [''])[0]))
const BANNED = /—|\bunlock|ecomtalent/i

// ── Plain words ─────────────────────────────────────────────────────────────
console.log('\n=== A failed read in plain words ===')
{
  const cases = [
    ['canceling statement due to statement timeout', 'The database took too long to answer.'],
    ['the students could not be read: canceling statement due to statement timeout', 'The database took too long to answer.'],
    ['permission denied for table tasks', "This account can't read the tasks."],
    ['admin_config: permission denied for table admin_config', "This account can't read the admin settings."],
    ['permission denied for table outreach_log', "This account can't read the outreach log."],
    ['JWT expired', 'The sign-in has run out. Sign in again.'],
    ['TypeError: Failed to fetch', "Couldn't reach the server. Check the connection and try again."],
    ['relation "public.canceling_snapshots" does not exist', 'A table this page reads is missing from the database.'],
    ['column students.first_paid_at does not exist', 'The database is missing a column this page reads.'],
    ['admin_config.tasks_reset_at holds "tomorrow", which is not a date and time', 'A setting in the database holds something that is not a date and time.'],
    ["Couldn't read the date of the course switch, so the 30% list was not made. Try again.", "Couldn't read the date of the course switch, so the 30% list was not made. Try again."],
    ['No lesson counts toward progress.', 'No lesson counts toward progress.'],
    ['something odd happened', 'The read failed.'],
    ['', 'The read failed.'],
  ]
  const wrong = cases.filter(([raw, want]) => RF.plainReadError(raw) !== want).map(([raw]) => `${raw} -> ${RF.plainReadError(raw)}`)
  ok(wrong.length === 0, `${cases.length} kinds of failure, each in plain words; a sentence of ours as it is`, wrong.join(' | '))
  ok(show(RF.plainReadErrors(['timeout', 'canceling statement due to statement timeout', 'permission denied for table tasks'])) === show(['The database took too long to answer.', "This account can't read the tasks."]),
     'several reads that failed alike say it once')
  ok(RF.hasDetails('permission denied for table tasks') && !RF.hasDetails('No lesson counts toward progress.') && !RF.hasDetails(null),
     'the raw text goes behind Details only when it says more than the plain sentence')
  const one = render(PARTS.ReadFailure, { raw: 'permission denied for table tasks', lead: "Couldn't load the tasks." })
  ok(shownWords(one) === "Couldn't load the tasks. This account can't read the tasks. Details" && /<details[^>]*>(?![\s\S]*open)/.test(one) && words(one).includes('permission denied for table tasks'),
     'ReadFailure: the lead and the plain sentence; the database\'s words only inside a closed Details', shownWords(one))
  const many = render(PARTS.FailureList, {
    failures: [
      { read: 'Students', error: 'canceling statement due to statement timeout' },
      { read: 'Daily snapshots', error: 'canceling statement due to statement timeout' },
      { read: 'Open tasks', error: 'permission denied for table tasks' },
    ],
  })
  ok(shownWords(many) === "The database took too long to answer. This account can't read the tasks. Details"
       && words(many).includes('Students: canceling statement due to statement timeout') && words(many).includes('Open tasks: permission denied for table tasks'),
     'FailureList: each reason once in plain words, every read with its raw text behind one Details', shownWords(many))
  const notice = render(PARTS.ProblemNotice, { text: "Couldn't load the students' progress.", raw: 'canceling statement due to statement timeout' })
  ok(shownWords(notice) === "Couldn't load the students' progress. The database took too long to answer. Details" && words(notice).includes('canceling statement due to statement timeout'),
     'ProblemNotice: the page\'s sentence and the plain reason, the raw text behind Details', shownWords(notice))
  const plain = render(PARTS.ProblemNotice, { text: "Couldn't count the course's lessons.", raw: 'No lesson counts toward progress.' })
  ok(!plain.includes('<details') && shownWords(plain) === "Couldn't count the course's lessons. No lesson counts toward progress.",
     'no Details when the raw text says no more than the plain sentence', shownWords(plain))
  const err = render(LIST.LoadError, { title: "Couldn't load the 30% list.", detail: 'canceling statement due to statement timeout', onRetry: () => {} })
  ok(shownWords(err).startsWith("Couldn't load the 30% list. The database took too long to answer. Details") && !shownWords(err).includes('canceling statement'),
     'every page\'s LoadError says the reason plainly, the raw text behind Details', shownWords(err))

  const dash = fromSrc('src/components/admin/dashboard/DashboardView.tsx')
  ok(/function Failed\(\{ big = false \}: \{ big\?: boolean \}\)/.test(dash) && !/<Failed error=/.test(dash) && dash.includes("Couldn&apos;t load the line</p>")
       && dash.includes('<FailureList failures={model.failed} />'),
     'the Dashboard: a tile says only "Couldn\'t load", a line only "Couldn\'t load the line"; the reasons once, at the top')
  ok(!/Failed error=\{tile\.error\}/.test(dash) && /Failed error=\{tile\.error\}/.test(fromBase('src/components/admin/dashboard/DashboardView.tsx')),
     `control: at ${BASE} every tile printed the database's error under "Couldn't load"`)
  const people = ['src/components/admin/students/StudentsView.tsx', 'src/components/admin/students/StudentDetailView.tsx', 'src/components/admin/journey/JourneyView.tsx'].map(fromSrc).join('\n')
  // The render review's second round: a failed block says it through SectionFailure, ReadFailure with the tiles' warning dot.
  ok(!/\(\{(?:refreshError|sync\.error|d\.error|areas\.error|loaded\.data\.areas\.error|loaded\.data\.actionItems\.error)\}\)/.test(people)
       && (people.match(/<ProblemNotice /g) ?? []).length >= 5 && (people.match(/<ReadFailure |<SectionFailure /g) ?? []).length >= 5,
     'All students, a student\'s page and the journey put no raw error in a sentence: ProblemNotice and ReadFailure (or SectionFailure, which draws it) say it')
  const insights = fromSrc('src/components/admin/insights/InsightsView.tsx')
  ok(insights.includes('<ReadFailure raw={counts.error} lead="Couldn\'t count." />') && !insights.includes('Couldn&apos;t count: {counts.error}'),
     'Insights: the pace card\'s failed count in plain words too')
}

// ── Insights ────────────────────────────────────────────────────────────────
console.log('\n=== Insights: Avg progress from the switch, in points, on true gridlines ===')
{
  const RESET = '2026-10-19T14:33:33.972Z'
  const row = (date, avg, more = {}) => ({
    snapshot_date: date, avg_progress: avg, active_students: 900, total_completions: 1, active_count: 1031, joined_count: 1, churned_count: 0,
    avg_progress_cohort: avg, active_count_cohort: 1031, joined_count_cohort: 1, churned_count_cohort: 0, ...more,
  })
  const days = INS.snapshotDays('2026-10-06', '2026-10-20')
  const rows = days.map((d) => row(d, d < '2026-10-19' ? 36.47 : d === '2026-10-19' ? 2.66 : 2.71))
  const line = INS.metricLine(rows, 'avg_progress', '2026-10-20', RESET)
  ok(show(line.map((p) => p.date)) === show(['2026-10-19', '2026-10-20']) && line.every((p) => p.value < 3),
     'the line starts on the switch\'s date: no 36% beside the new course\'s 3%, so no cliff', show(line))
  const delta = DASH.deltaOf(line)
  ok(delta.change === 0.05 && delta.from === '2026-10-19', 'its change: 0.05 points since the switch, as the Dashboard counts it (deltaOf)', show(delta))
  const dashAvg = DASH.avgProgress(rows.map((r) => ({ ...r, created_at: null })), DASH.trendDays(Date.parse('2026-10-20T08:30:00.000Z')), RESET)
  // The render review's fix round: the Dashboard draws the line on its 14 days, the days before the switch
  // empty; its readings are Insights' line.
  ok(dashAvg.kind === 'value' && show(dashAvg.line.filter((p) => p.value !== null)) === show(line) && dashAvg.line.length === 14
       && DASH.deltaOf(dashAvg.line).change === delta.change,
     'the same rows give the Dashboard\'s tile the very same readings and change, on its 14 days', show(dashAvg.line))
  const view = fromSrc('src/components/admin/insights/InsightsView.tsx')
  ok(view.includes('const delta = deltaOf(line);') && view.includes('unit: ["pt", "pts"],') && !/def\.suffix/.test(view),
     'the change is written in points ("0.05 pts since Mon 19 Oct"), never "%" on a change of a share')
  ok(/def\.suffix\}`\} since the start of the range/.test(fromBase('src/components/admin/insights/InsightsView.tsx')),
     `control: at ${BASE} it added "%" to the change and counted it across the switch`)
  const active = INS.metricLine(rows, 'active_count', '2026-10-20', RESET)
  ok(active.length === 15 && active[0].date === '2026-10-06', 'the other lines keep the whole range')
  const gappy = INS.metricLine(rows.filter((r) => r.snapshot_date !== '2026-10-12'), 'churned_count', '2026-10-21', null)
  ok(gappy.find((p) => p.date === '2026-10-12').value === null && gappy.at(-1).date === '2026-10-21' && gappy.at(-1).value === null,
     'a day with no snapshot is a gap, never 0 (today, before 00:30 UTC, too)')
  let threw = false
  try { INS.metricLine(rows, 'avg_progress', '2026-10-20', '2026-10-19') } catch { threw = true }
  ok(threw, 'a switch date that is no moment is refused, as the Dashboard refuses it (the card says it could not draw the line)')

  const t1 = INS.axisTicks([0, 1, 0, 0], 'bars', true)
  const t3 = INS.axisTicks([0, 1, 3, 0], 'bars', true)
  const t36 = INS.axisTicks([30.2, 36.4], 'bars', false)
  ok(show(t1) === show({ domain: [0, 2], ticks: [0, 1, 2] }), 'a count with a top of 1: gridlines 0, 1 and 2, three labels, none twice', show(t1))
  ok(show(t3) === show({ domain: [0, 4], ticks: [0, 2, 4] }), 'a top of 3: 0, 2 and 4, so a 1 sits under its own height, never under a "2" drawn at 1.5', show(t3))
  ok(show(t36) === show({ domain: [0, 36.4], ticks: [0, 18.2, 36.4] }), 'a share with a top of 36.4: 0, 18.2 and 36.4, each labelled with its own value', show(t36))
  const flat = INS.axisTicks([269, 269, 269], 'line', true)
  ok(flat.ticks.every((t) => Number.isInteger(t)) && flat.ticks[1] === 269 && flat.domain[0] > 200,
     'a flat 269 is a line in the middle of its own spread, not a block filling 0 to 270', show(flat))
  const small = INS.axisTicks([2.66, 2.71], 'line', false)
  ok(small.ticks.every((t) => Math.round(t * 10) === t * 10) && small.ticks[0] <= 2.66 && small.ticks[2] >= 2.71,
     'a share\'s gridlines are whole tenths around its readings', show(small))
  const old = fromBase('src/components/admin/insights/InsightsView.tsx')
  ok(/Math\.round\(\(maxY \/ 2\) \* 10\) \/ 10/.test(old) && /\{Math\.round\(t\)\}/.test(old), `control: at ${BASE} the middle line sat at 1.5 and was labelled 2`)
  const claims = INS.claimsLine(['2026-10-18T09:00:00.000Z', '2026-10-18T22:00:00.000Z', '2026-10-20T01:00:00.000Z'], INS.snapshotDays('2026-10-18', '2026-10-20'))
  ok(show(claims.map((p) => p.value)) === show([2, 0, 1]), 'the Bounty Program claims per UTC day, 0 on a day with none', show(claims))

  ok(view.includes('import { TrendChart, pointDay } from "@/components/admin/dashboard/TrendChart";') && !/function Chart\(|function Sparkline\(/.test(view)
       && !view.includes('var(--color-success)",\n    mode') && !/color: "var\(--color-danger\)",\n\s*mode/.test(view),
     'Insights draws with the Dashboard\'s chart (Airy Blue marks, its glow, bars for a count per day, days like "Wed 7 Oct"); green and red only in the change\'s arrow')
  ok(view.includes('<div className="xl:col-span-2" style={{ minWidth: 0 }}>') && view.includes('metric="churned_count"') && /updatedAt \? \(\s*`Updated \$\{clockLabel\(updatedAt\)\}/.test(view),
     'Churned takes the whole width; the header has its Updated line')
}

// ── Lesson feedback ─────────────────────────────────────────────────────────
console.log('\n=== Lesson feedback: the rated lessons, newest first; the rest one line ===')
{
  const lesson = (id, sort, regionId = 'a1') => ({ id, region_id: regionId, title: `Lesson ${id}`, type: 'watch', sort_order: sort, feature_key: null })
  const rating = (id, lessonId, stars, at) => ({ id, student_id: 's1', lesson_id: lessonId, stars, comment: null, created_at: at, updated_at: at })
  const data = {
    since: '2026-10-19T14:33:33.972Z',
    areas: [{ id: 'a1', name: 'Introduction', order_num: 1 }],
    lessons: [lesson('l1', 1), lesson('l2', 2), lesson('l3', 3), lesson('l4', 4), lesson('l5', 5)],
    ratings: [rating('r1', 'l2', 4, '2026-10-20T08:00:00.000Z'), rating('r2', 'l4', 2, '2026-10-20T12:00:00.000Z'), rating('r3', 'l2', 5, '2026-10-20T09:00:00.000Z')],
    students: [{ id: 's1', name: 'Ana', email: 'ana@example.com' }],
  }
  const built = FB.buildLessonFeedback(data, new Date('2026-10-20T13:00:00.000Z'))
  const area = built.areas[0]
  ok(area.lessons.find((l) => l.id === 'l2').latestAt === '2026-10-20T09:00:00.000Z' && area.lessons.find((l) => l.id === 'l1').latestAt === null,
     'each lesson carries when its newest rating was saved')
  const { rated, unrated } = FB.splitRated(area.lessons)
  ok(show(rated.map((l) => l.id)) === show(['l4', 'l2']) && show(unrated.map((l) => l.id)) === show(['l1', 'l3', 'l5']),
     'listed: only the rated ones, the newest rating first; the 3 with none, in course order, go into one line', show({ rated: rated.map((l) => l.id), unrated: unrated.map((l) => l.id) }))
  const src = fromSrc('src/components/admin/feedback/LessonFeedbackView.tsx')
  ok(src.includes('{plural(lessons.length, "lesson")} with no rating yet') && /aria-expanded=\{open\}/.test(src) && !src.includes('No ratings yet.</p>')
       && !/function LessonId\(/.test(src) && src.includes('title={lesson.id}') && src.includes('title={l.id}'),
     'the page: "N lessons with no rating yet", which lists them when pressed; no "No ratings yet." row; a lesson\'s id in its title attribute only')
  ok(/No ratings yet\.<\/p>/.test(fromBase('src/components/admin/feedback/LessonFeedbackView.tsx')), `control: at ${BASE} an unrated lesson was a row of "No ratings yet."`)
}

// ── The 30% statuses ────────────────────────────────────────────────────────
console.log('\n=== One name and one colour for each 30% status, on every page ===')
{
  const four = ['pending', 'approved', 'rejected', 'applied']
  const map = Object.fromEntries(four.map((s) => [s, STATUS.discountStatusWords(s)]))
  ok(show(map) === show({
    pending: { label: 'Applied', tone: 'accent' }, approved: { label: 'Approved', tone: 'success' },
    rejected: { label: 'Rejected', tone: 'danger' }, applied: { label: 'Code Applied', tone: 'neutral' },
  }), 'the map: Applied, Approved, Rejected, Code Applied', show(map))
  ok(four.every((s) => show(SURVEY.statusWords(s)) === show(map[s])), 'the Survey names and colours them from it')
  const detail = (status) => D.buildStudentDetail({
    student: { ok: true, data: { id: 's', name: 'Ana Example', email: 'a@example.com', discord_username: null, membership_status: 'active', first_paid_at: '2026-10-10T08:00:00.000Z', joined_at: '2026-10-10T08:00:00.000Z', last_active_at: null, cancel_scheduled_at: null, csm_exempt: false, ad_submissions_verified: false } },
    regions: { ok: true, data: [] }, lessons: { ok: true, data: [] }, completions: { ok: true, data: [] },
    discount: { ok: true, data: { status, promo_code: null, created_at: '2026-10-12T08:00:00.000Z' } },
    streak: { ok: true, data: null }, sync: { ok: true, data: null }, programLink: { ok: true, data: { value: 'https://sprint.ecomuniversity.com/login' } },
  }, { ok: true, resetAt: null, lastByStudent: new Map() }, '2026-10-20T08:00:00.000Z')
  ok(four.every((s) => { const d = detail(s).discount.data; return d.text === map[s].label && d.tone === map[s].tone }),
     'a student\'s page and the journey\'s drawer: the same words and tones', show(four.map((s) => detail(s).discount.data.text)))
  const thirty = fromSrc('src/components/admin/thirty/ThirtyView.tsx')
  ok(thirty.includes('TAB_ORDER.map((t) => [t, DISCOUNT_STATUS[TAB_STATUS[t]].label])') && !/"Code Applied"/.test(thirty),
     'the 30% page\'s tabs are named from it')
  const page = fromSrc('src/components/admin/students/StudentDetailView.tsx')
  ok(!/DISCOUNT_TONE|DISCOUNT_STATUS_TEXT/.test(page + fromSrc('src/lib/admin/student-detail.ts')) && page.includes('<Pill tone={d.data.tone as PillTone}>{d.data.text}</Pill>'),
     'the student page\'s own map and words are gone')
  ok(show(SURVEY.statusCounts(four.map((status, i) => ({ id: `r${i}`, status, created_at: '', student: null, answers: [] }))).map((c) => c.label)) === show(['Applied', 'Approved', 'Rejected', 'Code Applied']),
     'every list of them in the 30% page\'s tab order')
  ok(/applied: "Code applied"/.test(fromBase('src/lib/admin/student-detail.ts')) && /pending: "warning"/.test(fromBase('src/components/admin/students/StudentDetailView.tsx')),
     `control: at ${BASE} the student page said "Code applied" and coloured Applied amber`)
}

// ── The Survey ──────────────────────────────────────────────────────────────
console.log('\n=== The Survey: from 1 October, the questions answered, the summary ===')
{
  const questions = [
    { id: 'q1', order_num: 1, question_text: 'How likely are you to recommend Ecom University, from 1 to 10?', question_type: 'scale', scale_min: 1, scale_max: 10, is_active: true },
    { id: 'q2', order_num: 2, question_text: 'Has the pace of the program felt right?', question_type: 'multi_choice', options: ['Way too fast', 'A bit too fast', 'Just right', 'A bit too slow', 'Way too slow'], scale_min: null, scale_max: null, is_active: true },
    { id: 'q3', order_num: 3, question_text: 'Biggest win?', question_type: 'open_text', scale_min: null, scale_max: null, is_active: true },
  ]
  const app = (id, created_at, score, pace, text) => ({
    id, status: 'pending', created_at, student: null,
    answers: [
      { id: `${id}1`, discount_request_id: id, question_id: 'q1', answer_scale: score, answer_choice: null, answer_text: null, created_at },
      { id: `${id}2`, discount_request_id: id, question_id: 'q2', answer_scale: null, answer_choice: pace, answer_text: null, created_at },
      { id: `${id}3`, discount_request_id: id, question_id: 'q3', answer_scale: null, answer_choice: null, answer_text: text, created_at },
    ],
  })
  const apps = [
    app('n1', '2026-10-20T08:00:00.000Z', 9, 'Just right', 'An ad approved'),
    app('n2', '2026-09-30T22:30:00.000Z', 7, 'A bit too fast', '   '),
    app('o1', '2026-09-30T21:59:00.000Z', 2, 'Way too fast', null),
  ]
  const { listed, older } = SURVEY.splitByListedFrom(apps)
  ok(show(listed.map((a) => a.id)) === show(['n1', 'n2']) && show(older.map((a) => a.id)) === show(['o1']) && SURVEY.SURVEY_LISTED_FROM === '2026-09-30T22:00:00.000Z',
     'from 1 October in Croatia (22:00 UTC the day before), as the 30% page lists them; the older ones apart', show({ listed: listed.map((a) => a.id) }))
  const avg = SURVEY.recommendAverage({ questions, applications: apps }, listed)
  ok(avg.value === 8 && avg.count === 2, 'the average over the applications shown: the old course\'s 2 left out', show(avg))
  const spread = SURVEY.scoreSpread(questions, listed)
  ok(spread.counts.length === 10 && spread.counts[0].score === 1 && spread.counts.find((c) => c.score === 9).count === 1 && spread.counts.find((c) => c.score === 2).count === 0,
     'the scores\' spread, 1 to 10, over the applications shown', show(spread.counts.filter((c) => c.count > 0)))
  const pace = SURVEY.paceTally(questions, listed)
  ok(show(pace.counts) === show([{ choice: 'Way too fast', count: 0 }, { choice: 'A bit too fast', count: 1 }, { choice: 'Just right', count: 1 }, { choice: 'A bit too slow', count: 0 }, { choice: 'Way too slow', count: 0 }]),
     'how many picked each pace answer, in the form\'s order', show(pace.counts))
  ok(show(apps[1].answers.filter(SURVEY.isAnswered).map((a) => a.question_id)) === show(['q1', 'q2']), 'a blank answer is no answer: its question is hidden in the card')
  const view = fromSrc('src/components/admin/survey/SurveyView.tsx')
  ok(view.includes('responses={app.answers.filter(isAnswered)}') && /Show them/.test(view) && /not shown\./.test(view) && view.includes('<Spread counts={spread.counts} />') && view.includes('<PaceTally counts={pace.counts} />'),
     'the page: the older applications counted in one line with "Show them"; the summary; cards with the answered questions only')
}

// ── The 30% page and the coupon ─────────────────────────────────────────────
console.log("\n=== The 30% page: every row's coupon check ===")
{
  setCatalog({ v2: true, lessonsTable: 'lessons' })
  const NOW = '2026-10-21T09:00:00.000Z'
  const RESET = '2026-10-19T14:33:00.000Z'
  const person = (id, membership = `mem_${id}`) => ({ id, name: `Name ${id}`, email: `${id}@example.com`, discord_username: null, membership_status: 'active', first_paid_at: '2026-10-10T08:00:00.000Z', whop_membership_id: membership })
  const coupon = (student, membership, discounted, code = 'evolve10') => ({
    student_id: student, whop_membership_id: membership, promo_code_id: `promo_${code}`, promo_code: code,
    renewal_price: discounted ? 87.3 : 97, plan_renewal_price: 97, discounted, checked_at: '2026-10-20T07:00:00.000Z',
  })
  const ask = (id, student, status) => ({ id, student_id: student, status, created_at: '2026-10-15T08:00:00.000Z', promo_code: status === 'pending' ? null : `ECOM30-${id}`, rejection_reason: null, reviewed_at: null, reviewed_by: null, applied_at: null, applied_by: null })
  const db = () => new FakeDb({
    students: ['p1', 'p2', 'p3', 'a1', 'a2', 'a3', 'a4'].map((id) => person(id)),
    lessons: [{ id: 'g1', region_id: 'a1', type: 'watch', title: 'Gate', sort_order: 1, requires_action: false, counts_toward_progress: true, is_gate: true, duration_seconds: 300 }],
    lesson_videos: [{ lesson_id: 'g1', created_at: '2026-10-19T10:00:00.000Z' }],
    student_lesson_completions: [],
    discount_requests: [ask('r-p1', 'p1', 'pending'), ask('r-p2', 'p2', 'pending'), ask('r-p3', 'p3', 'pending'), ask('r-a1', 'a1', 'approved'), ask('r-a2', 'a2', 'approved'), ask('r-a3', 'a3', 'approved'), ask('r-a4', 'a4', 'approved')],
    team_members: [],
    student_whop_sync: [],
    student_membership_discounts: [coupon('p1', 'mem_p1', false, 'welcome50'), coupon('p3', 'mem_old', true), coupon('a2', 'mem_a2', true)],
  })
  const load = await loadThirtyData(fakeClient(db()))
  const live = new Map([
    ['a1', { ok: true, row: coupon('a1', 'mem_a1', true) }],
    ['a2', { ok: false, fail: 'time_budget' }],
    ['a3', { ok: false, fail: 'http_other' }],
    ['a4', { ok: true, row: coupon('a4', 'mem_a4', false, 'welcome50') }],
  ])
  const view = buildThirtyView(load.data, new Date(NOW), RESET, live)
  const row = (id) => view.requests.find((r) => r.id === id)
  ok(row('r-p1').couponCheck === 'stored' && row('r-p2').couponCheck === 'not-checked' && row('r-p3').couponCheck === 'not-checked',
     'Applied: a stored row for the membership the student has now is "stored"; none, or one of another membership, is "not checked yet"', show(['r-p1', 'r-p2', 'r-p3'].map((id) => row(id).couponCheck)))
  ok(row('r-a1').couponCheck === 'live' && row('r-a1').coupon.discounted && row('r-a1').coupon.code === 'evolve10',
     'Approved before the coupon rule with nothing stored: Whop\'s answer now shows its discount (the warning to check Whop can show at last)')
  ok(row('r-a2').couponCheck === 'stored' && row('r-a2').coupon.discounted && row('r-a3').couponCheck === 'failed' && row('r-a3').coupon === null
       && row('r-a4').couponCheck === 'live' && row('r-a4').coupon.discounted === false,
     'Whop gives no answer: the stored row stands in, or the row says it could not check; a clean answer is shown as clean', show(['r-a2', 'r-a3', 'r-a4'].map((id) => row(id).couponCheck)))
  const unread = db()
  unread.fail['student_membership_discounts.select'] = { message: 'timeout' }
  const v2 = buildThirtyView((await loadThirtyData(fakeClient(unread))).data, new Date(NOW), RESET, live)
  ok(v2.couponsUnread && v2.requests.filter((r) => r.status === 'pending').every((r) => r.couponCheck === 'unread'), 'stored coupons that cannot be read: "unread" on every Applied row')
  const noLive = buildThirtyView(load.data, new Date(NOW), RESET)
  ok(noLive.requests.find((r) => r.id === 'r-a1').couponCheck === 'not-checked', 'with no live answers handed in, an Approved row falls back to what is stored')

  // A stored Whop id that is a payment's (the webhook has written one there), or none. Since T-122 Approve asks
  // Whop through the student's Whop user, so an Applied row says "not checked yet, Approve asks Whop first" as for
  // any other; the Approved rows' own read asks by membership id alone, so such a row still says it could not ask.
  const odd = new FakeDb({
    students: [person('p4', 'pay_p4'), person('p5', null), person('a5', 'pay_a5'), person('p6')],
    lessons: [{ id: 'g1', region_id: 'a1', type: 'watch', title: 'Gate', sort_order: 1, requires_action: false, counts_toward_progress: true, is_gate: true, duration_seconds: 300 }],
    lesson_videos: [{ lesson_id: 'g1', created_at: '2026-10-19T10:00:00.000Z' }],
    student_lesson_completions: [],
    discount_requests: [ask('r-p4', 'p4', 'pending'), ask('r-p5', 'p5', 'pending'), ask('r-a5', 'a5', 'approved'), ask('r-p6', 'p6', 'pending')],
    team_members: [],
    student_whop_sync: [],
    student_membership_discounts: [],
  })
  const oddLoad = await loadThirtyData(fakeClient(odd))
  const oddView = buildThirtyView(oddLoad.data, new Date(NOW), RESET, await readApprovedCoupons(oddLoad.data, null))
  const oddRow = (id) => oddView.requests.find((r) => r.id === id)
  ok(oddRow('r-p4').couponCheck === 'not-checked' && oddRow('r-p5').couponCheck === 'not-checked' && oddRow('r-a5').couponCheck === 'no-membership'
       && oddRow('r-p6').couponCheck === 'not-checked',
     'a payment\'s id or no id in whop_membership_id: "not checked yet" on an Applied row (Approve asks through the Whop user, T-122), "no-membership" on an Approved one; a membership id with nothing stored "not checked yet"',
     show(['r-p4', 'r-p5', 'r-a5', 'r-p6'].map((id) => oddRow(id).couponCheck)))
  // And a row stored for such a student (the cron found the membership through the Whop user) counts on their row.
  const oddStored = new FakeDb({
    students: [person('p4', 'pay_p4'), person('p5', null)],
    lessons: [{ id: 'g1', region_id: 'a1', type: 'watch', title: 'Gate', sort_order: 1, requires_action: false, counts_toward_progress: true, is_gate: true, duration_seconds: 300 }],
    lesson_videos: [{ lesson_id: 'g1', created_at: '2026-10-19T10:00:00.000Z' }],
    student_lesson_completions: [],
    discount_requests: [ask('r-p4', 'p4', 'pending'), ask('r-p5', 'p5', 'pending')],
    team_members: [],
    student_whop_sync: [],
    student_membership_discounts: [coupon('p4', 'mem_found4', true), { ...coupon('p5', null, false), source: 'payment' }],
  })
  const oddStoredView = buildThirtyView((await loadThirtyData(fakeClient(oddStored))).data, new Date(NOW), RESET)
  const storedRow = (id) => oddStoredView.requests.find((r) => r.id === id)
  ok(storedRow('r-p4').couponCheck === 'stored' && storedRow('r-p4').verdict.reason === 'has-discount' && storedRow('r-p5').couponCheck === 'stored' && storedRow('r-p5').coupon.discounted === false,
     'with a payment\'s id or no id on file, the row stored through the Whop user or a payment counts: the coupon\'s verdict, or a clean coupon',
     show(['r-p4', 'r-p5'].map((id) => [storedRow(id).couponCheck, storedRow(id).verdict?.reason])))

  const nokey = await readApprovedCoupons(load.data, null)
  ok(show([...nokey.keys()].sort()) === show(['a1', 'a2', 'a3', 'a4']) && [...nokey.values()].every((c) => !c.ok && c.fail === 'no_api_key'),
     'readApprovedCoupons asks only about the students holding an approved request; with no key, it says so for each', show([...nokey.entries()]))
  const realFetch = globalThis.fetch
  const asked = []
  globalThis.fetch = async (url, init) => {
    asked.push(String(url).replace('https://api.whop.com/api/v1', ''))
    const path = String(url)
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (init?.headers?.['Api-Version-Date'] !== '2026-10-15-1') return new Response('{}', { status: 400 })
    if (path.includes('/memberships/mem_a1')) return json({ id: 'mem_a1', promo_code_id: 'promo_e10', plan_id: 'plan_m', renewal_price: '87.30' })
    if (path.includes('/memberships/mem_a2')) return new Response('boom', { status: 500 })
    // Whop answers the membership asked for (an answer of another id is no answer since T-122's fifth fix round).
    if (path.includes('/memberships/')) return json({ id: decodeURIComponent(path.split('/memberships/')[1]), promo_code_id: null, plan_id: 'plan_m', renewal_price: '97.00' })
    if (path.includes('/plans/plan_m')) return json({ id: 'plan_m', renewal_price: '97.00' })
    if (path.includes('/promo_codes/promo_e10')) return json({ id: 'promo_e10', code: 'evolve10' })
    return new Response('{}', { status: 404 })
  }
  try {
    const got = await readApprovedCoupons(load.data, 'test-key')
    ok(got.get('a1').ok && got.get('a1').row.discounted && got.get('a1').row.promo_code === 'evolve10' && got.get('a1').row.whop_membership_id === 'mem_a1',
       'Whop now, pinned: a forever code under the plan\'s price is a discount, by its name', show(got.get('a1')))
    ok(!got.get('a2').ok && got.get('a2').fail === 'http_other' && got.get('a3').ok && got.get('a3').row.discounted === false,
       'a Whop error is that student\'s failure only; a membership with no code is clean')
    ok(asked.filter((p) => p.startsWith('/plans/')).length === 1 && !asked.some((p) => /mem_p\d/.test(p)),
       'the plan is read once for all of them, and no Applied student is asked about', show(asked))
  } finally {
    globalThis.fetch = realFetch
  }
  const route = fromSrc('src/app/api/admin/thirty/route.ts')
  ok(route.includes('const live = await readApprovedCoupons(load.data, process.env.WHOP_API_KEY ?? null);') && route.includes('buildThirtyView(load.data, new Date(), resetAt, live)')
       && /console\.warn\(`\[admin thirty\] Whop gave no answer/.test(route),
     'GET /api/admin/thirty asks Whop about the Approved rows, hands the answers to the page, and logs a read that gave none')

  const page = fromSrc('src/components/admin/thirty/ThirtyView.tsx')
  // The render review's fix round: a row the coupon refuses has no Approve, so no "Approve asks Whop again first"
  // (admin-render-fixes.test.mjs renders it).
  ok(page.includes('Coupon not checked yet. Approve asks Whop first.') && page.includes('"Couldn\'t ask Whop about a coupon on this membership."')
       && page.includes('Check Whop before you add the 30% code.') && !page.includes(' Approve asks Whop again first.'),
     'the rows say it: "Coupon not checked yet" on an Applied row, "Couldn\'t ask Whop" on an Approved one; no "Approve asks Whop again" since a coupon row has no Approve')
  ok(!page.includes('so Approve can&apos;t ask Whop') && !page.includes('data-coupon="no-membership"')
       && page.includes('"Couldn\'t ask Whop about a coupon: the student\'s Whop membership is not on file."')
       && /const unchecked = approved && !row\.coupon && \(row\.couponCheck === "failed" \|\| row\.couponCheck === "no-membership"\);/.test(page),
     'an Applied row no longer says Approve can\'t ask Whop (since T-122 it asks through the Whop user); an Approved row still says its own read could not ask')
  const pending = page.slice(page.indexOf('function PendingRow('), page.indexOf('/** The 30% code, and a button that copies it. */'))
  // The render review's fix round changed the coupon's row: no Approve at all beside the coupon's verdict (it
  // was kept on, for the route to refuse), and Reject is that row's one action, raised.
  // Since the render review's second round "Check Whop again" stands on the coupon's row. Since the owner's review
  // (2026-10-21) a founder's or an admin's Approve anyway stands in Approve's place wherever a check refuses, the
  // coupon's row too (admin-owner-review.test.mjs holds that round's rules). Since the review of 2026-10-26 Check Whop
  // again stands on the no-real-payment row as well (`recheck`).
  ok(/disabled=\{locked \|\| \(busy !== null && busy !== "approve"\)\}/.test(pending) && !/disabled=\{!verdict\.ok/.test(pending)
       && /const recheck = coupon \|\| verdict\.reason === "no-real-payment";/.test(pending)
       && /\{recheck && \(\s*<button[\s\S]*?"Check Whop again"\}\s*<\/button>\s*\)\}/.test(pending)
       && /\{!coupon && verdict\.ok && !canOverride && \(\s*<Button/.test(pending),
     'Approve is on wherever it can approve, and gone beside the coupon\'s verdict')
  ok(/\{canOverride && \(\s*<button[\s\S]*?Approve anyway\s*<\/button>\s*\)\}\s*\{!coupon && verdict\.ok && !canOverride && \(\s*<Button[\s\S]*?Approve\s*<\/Button>/.test(pending),
     'Approve anyway takes Approve\'s place in the row, as tall as Reject, never a disabled Approve beside a link')
  ok(/<Button\s+variant=\{coupon \? "raised" : "ghost"\}\s+size="md"\s+disabled=\{off\}\s+expanded=\{confirm === "reject"\}/.test(pending)
       && /variant="danger"[\s\S]{0,400}Reject the request/.test(pending),
     'Reject is ghost, the row\'s "no", as Dismiss is on Tasks (raised on the coupon\'s row, its one action); "Reject the request", which the student cannot ask again after, is the danger button')
  ok(page.includes('max-[399px]:flex-nowrap max-[399px]:overflow-x-auto max-[399px]:gap-1 max-[399px]:[--tab-pad:8px] max-[399px]:[--tab-gap:4px] max-[399px]:[--tab-font:12px]') && page.includes('padding: "0 var(--tab-pad, 12px)"'),
     'under 400px the tabs narrow to one line, and scroll sideways rather than wrap')
  ok(/\{header\("Loading", <RefreshButton onPress=\{\(\) => \{\}\} busy disabled \/>\)\}\s*\{blankTabs\}/.test(page)
       && page.includes('{header(<FailedMeta />, <RefreshButton onPress={() => void retry()} busy={retrying} />)}') && /count: null/.test(page),
     'while it loads or failed, the header keeps Refresh and the tabs stay, with no counts (failed, the header says so: the render review\'s fix round)')
}

console.log('\n=== The coupon rule: a stored id that is not a membership, and a cron Whop never answered ===')
{
  // Until T-122 (2026-10-21) a payment's id where the membership's belongs meant Whop was never asked, and a line
  // said so. Now the membership is found through the student's Whop user. Whop stands in here: no request leaves
  // the machine (membership-discount.test.mjs holds every path).
  const db = () => new FakeDb({
    students: [{ id: 's-pay', whop_membership_id: 'pay_123', whop_user_id: 'user_devPay', first_paid_at: '2026-10-10T08:00:00.000Z', membership_status: 'active' }],
    student_membership_discounts: [],
  })
  const realFetch = globalThis.fetch
  const realProducts = process.env.WHOP_PRODUCT_ID
  process.env.WHOP_PRODUCT_ID = 'prod_devCourse'
  const asked = []
  let down = false
  globalThis.fetch = async (url) => {
    const u = new URL(String(url))
    if (u.hostname !== 'api.whop.com') throw new Error(`the suite let a request go to ${u.hostname}`)
    asked.push(u.pathname)
    if (down) throw new TypeError('fetch failed')
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u.pathname === '/api/v2/memberships') return json({ data: [{ id: 'mem_devPay', user: 'user_devPay', product: 'prod_devCourse', status: 'active', valid: true }], pagination: { current_page: 1, total_page: 1 } })
    if (u.pathname === '/api/v1/memberships/mem_devPay') return json({ id: 'mem_devPay', promo_code_id: null, plan_id: 'plan_m', renewal_price: '97.00' })
    if (u.pathname === '/api/v1/plans/plan_m') return json({ id: 'plan_m', renewal_price: '97.00' })
    // Since T-122's second fix round a membership with no discount is followed by the user's real payments: none here.
    if (u.pathname === '/api/v1/payments') return json({ data: [], page_info: { has_next_page: false, end_cursor: null } })
    return new Response('{}', { status: 404 })
  }
  const warned = []
  const realWarn = console.warn
  console.warn = (...a) => warned.push(a.join(' '))
  let answer
  let downAnswer
  const found = db()
  const empty = db()
  try {
    answer = await MD.checkMembershipDiscount(fakeClient(found), 's-pay', { apiKey: 'test-key' })
    down = true
    downAnswer = await MD.checkMembershipDiscount(fakeClient(empty), 's-pay', { apiKey: 'test-key' })
  } finally {
    console.warn = realWarn
    globalThis.fetch = realFetch
    if (realProducts === undefined) delete process.env.WHOP_PRODUCT_ID
    else process.env.WHOP_PRODUCT_ID = realProducts
  }
  // Since T-122's fourth fix round the user's list and the payments are read at the same time, and a membership naming
  // no code has its plan read no more (the list, the membership and its plan, in a row, until then).
  ok(answer.source === 'live' && answer.via === 'user' && !answer.discounted && answer.saved && found.rows('student_membership_discounts')[0]?.whop_membership_id === 'mem_devPay'
       && show(asked.slice(0, 3)) === show(['/api/v2/memberships', '/api/v1/payments', '/api/v1/memberships/mem_devPay']),
     'a payment id where the membership id belongs: the course membership is found through the Whop user and read (T-122), its answer stored', show({ answer, asked }))
  ok(downAnswer.source === 'none' && downAnswer.liveFail === 'network' && warned.some((w) => w.includes('student s-pay: Whop gave no answer (network), so no answer is on file')),
     'Whop down for it: no answer on file (the request routes refuse, and since T-122\'s fourth fix round the normal Approve too), and a line says so', warned.join(' | '))

  // The run starts 10 minutes ago, and the three first paid 3 days before that, so their 30% window is open at its
  // start whatever day the suite runs. A fixed date (10 October) left the window shut from 24 October on, the run
  // then had nobody to read and answered ok: true, and this check failed on every branch.
  const startedAtMs = Date.now() - 10 * 60_000
  const paid = new Date(startedAtMs - 3 * 86_400_000).toISOString()
  const members = Array.from({ length: 3 }, (_, i) => ({ id: `s-${i}`, whop_membership_id: `mem_${i}`, first_paid_at: paid, membership_status: 'active' }))
  // The course named, as on production: since T-122's fifth fix round a check with no course product named stops before
  // any read (no_course_product), where it read the membership on file first.
  const productsBefore = process.env.WHOP_PRODUCT_ID
  process.env.WHOP_PRODUCT_ID = 'prod_devCourse'
  const hung = await MD.refreshMembershipDiscounts(fakeClient(new FakeDb({ students: members, discount_requests: [], student_membership_discounts: [] })), {
    mode: 'dry', startedAtMs, apiKey: 'test-key',
  })
  if (productsBefore === undefined) delete process.env.WHOP_PRODUCT_ID
  else process.env.WHOP_PRODUCT_ID = productsBefore
  ok(!hung.ok && hung.checked === 0 && hung.left === 3 && /no membership read before the time ran out/.test(hung.error ?? ''),
     'a run in which Whop answered nothing before the time ran out is a failure (it answered ok: true)', show({ ok: hung.ok, checked: hung.checked, left: hung.left, error: hung.error }))
}

// ── A student's page ────────────────────────────────────────────────────────
console.log("\n=== A student's page: the quick DMs in the draft's words, the settings at the foot ===")
{
  const base = { nameOnFile: 'Mila Example', programLink: 'https://sprint.ecomuniversity.com/login', areaName: 'Research', lessonsDone: { ok: true, data: 12 } }
  const dms = D.quickDms(base)
  ok(show(dms.map((d) => d.label)) === show(['Welcome', 'Check-in', 'Encouragement'])
       && dms[0].text === "Hey Mila! Welcome to Ecom University 🙌 Have you opened the app yet? Sign in with your Whop account here: https://sprint.ecomuniversity.com/login and start with the first lesson on the map. Let me know if you have any questions!"
       && dms[1].text === "Hey Mila! Just checking in, how's the course going? I can see you're in Research now. Anything I can help with?"
       && dms[2].text === "Hey Mila! Saw you've finished 12 lessons so far, nice 💪 When you hit an action item, do it even if it feels scary. That's where things actually click.",
     'the 3 DMs in the messages draft\'s words, with the first name, the live link, the area and the lessons finished', show(dms.map((d) => d.text)))
  const bare = D.quickDms({ nameOnFile: null, programLink: null, areaName: null, lessonsDone: { ok: false, error: 'timeout' } })
  ok(bare[0].text.includes('Hey there!') && bare[0].text.includes('Sign in with your Whop account and start with the first lesson on the map.')
       && bare[1].text === "Hey there! Just checking in, how's the course going? Anything I can help with?"
       && bare[2].text.startsWith("Hey there! Saw you're working through the lessons, nice"),
     'a part not known leaves its sentence out in words: no link, no area, and no dash where the count would be', show(bare.map((d) => d.text)))
  ok(D.quickDms({ ...base, lessonsDone: { ok: true, data: 1 } })[2].text.includes('finished 1 lesson so far'), 'one lesson is "1 lesson"')
  ok([...dms, ...bare].every((d) => !BANNED.test(d.text) && !/expedition|region|30 days|Day \d/i.test(d.text)),
     'none holds an em dash, "unlock" or the old brand, nor the old course\'s words (expedition, region, 30 days, Day N)')
  const page = fromSrc('src/components/admin/students/StudentDetailView.tsx')
  ok(page.includes('const dmTemplates = quickDms(s);') && !/EcomTalent|expedition/.test(page), 'the page copies these, and holds no old words of its own')
  ok(/<QuickDms student=\{s\} \/>\s*<\/Block>\s*<SettingsRow student=\{s\} transport=\{transport\} onSaved=\{patch\} \/>\s*<\/ListPage>/.test(page)
       && page.indexOf('<StatGrid student={s} nowMs={nowMs} />') < page.indexOf('<Block title="Whop sync">') && !page.includes('<ExemptCard'),
     '"Leave out of the tasks" is a quiet row at the foot, after the quick DMs; the numbers and Whop sync come first')
  ok(/<details data-more="">[\s\S]{0,200}?<summary style=\{\{ display: "list-item", padding: "12px 0", lineHeight: "20px",[\s\S]{0,140}?\}\}>\s*More\s*<\/summary>/.test(page),
     'More keeps the browser\'s triangle (a list item), 44px tall with its padding, so it reads as something to press')
  ok(page.includes('className="grid items-center grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1fr)_auto_96px_auto] py-3 sm:py-0"')
       && page.includes('col-span-3 col-start-1 row-start-2') && !/\{open \? "Hide" : "Show"\}<\/span>/.test(page),
     'a lesson area on a phone: name and count with a chevron, then the bar across the row, 12px of air; no "Show" word')
}

// ── The frame ───────────────────────────────────────────────────────────────
console.log('\n=== Buttons, "Refresh", the header, the guard, the student side ===')
{
  const ui = fromSrc('src/components/admin/ui.tsx')
  const tokens = fromSrc('src/components/admin/admin-tokens.module.css')
  ok(ui.includes('color: "var(--admin-danger-label, #FFFFFF)",') && tokens.includes('--admin-danger-label: #18181a;'),
     'the danger button\'s label is Gunpowder in the dark look (5.2:1 on the red, where white measures 3.4:1), white on the light pages')
  const contrast = (a, b) => {
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
    const lum = ([r, g, bl]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl)
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }
  ok(contrast([0x18, 0x18, 0x1a], [0xff, 0x45, 0x3a]) >= 4.5 && contrast([255, 255, 255], [0xff, 0x45, 0x3a]) < 4.5,
     `measured: ${contrast([0x18, 0x18, 0x1a], [0xff, 0x45, 0x3a]).toFixed(2)}:1 against white's ${contrast([255, 255, 255], [0xff, 0x45, 0x3a]).toFixed(2)}:1`)
  const templates = fromSrc('src/components/admin/templates/TemplatesView.tsx')
  const team = fromSrc('src/components/admin/team/TeamView.tsx')
  const tasks = fromSrc('src/components/admin/tasks/TasksView.tsx')
  const row = fromSrc('src/components/admin/templates/TemplateRow.tsx')
  ok(/variant="ink" size="md" disabled=\{!ready\} onClick=\{\(\) => setCreating\(true\)\}>\s*New template/.test(templates) && /variant="ink" size="md" type="submit"/.test(team),
     'one ink button: New template on Templates, Send invite on Team')
  ok(/variant="danger"[\s\S]{0,300}Yes, remove/.test(team) && /variant="danger"[\s\S]{0,300}Yes, delete it/.test(row) && /variant="danger"[\s\S]{0,400}Dismiss the task/.test(tasks),
     'the confirms of a step not undone with a click are danger: Yes, remove; Yes, delete it; Dismiss the task')
  ok(/\{deletable && !asking && \(\s*<Button variant="danger"[\s\S]{0,120}?\}>\s*Delete template/.test(row) && row.indexOf('Delete template') < row.indexOf('{preview ? "Hide preview" : "Show preview"}'),
     'Delete template is red, at the start of the row, away from Show preview and Save at its end')
  const dash = fromSrc('src/components/admin/dashboard/DashboardView.tsx')
  ok(dash.includes('{refreshing ? "Syncing, about 2 minutes" : "Sync Whop and rebuild"}') && /<Button key="reload"[\s\S]{0,200}?\}>\s*Refresh\s*<\/Button>/.test(dash)
       && dash.includes('actions={[failed ? null : reloadButton, syncButton]'),
     'the Dashboard: Refresh reads again; "Sync Whop and rebuild" runs the 2 minutes; while a read failed, Retry is the reload')
  ok(tasks.includes('"Run task checks"') && !/\{checking \? "Refreshing" : "Refresh"\}/.test(tasks) && tasks.includes('Takes about 2 minutes.'),
     'Tasks: "Run task checks", its duration in its sentence')
  ok(tasks.includes('"New tasks land here when the task checks run: every 2 hours, or on Run task checks."') && !tasks.includes('or on Refresh.'),
     'Tasks: an empty To do names the button by its new name')
  ok(/\{checking \? "Refreshing" : "Refresh"\}/.test(fromBase('src/components/admin/tasks/TasksView.tsx')) && /\{refreshing \? "Refreshing" : "Refresh"\}/.test(fromBase('src/components/admin/dashboard/DashboardView.tsx')),
     `control: at ${BASE} both called a 2 minute sync "Refresh"`)
  ok(tasks.includes('<TextLink key="insights" href="/admin/tasks/insights">') && !tasks.includes('PillLinks')
       && fromSrc('src/components/admin/tasks/InsightsView.tsx').includes('<TextLink href="/admin/tasks">'),
     'Tasks links to its outreach insights in words, and the insights back to the queue; no pill row that looked like the tabs')
  const tasksInsights = fromSrc('src/components/admin/tasks/InsightsView.tsx')
  ok(/<details style=\{\{ marginTop: 8 \}\}>\s*<FoldSummary>How these numbers work<\/FoldSummary>/.test(tasksInsights) && tasksInsights.includes('<ul className="sm:hidden" aria-label="Templates">')
       && tasksInsights.includes('label="Time to send"') && tasksInsights.includes('graded sends did what the DM asked'),
     'outreach insights: the notes folded, a card per template on a phone, "Time to send", "did what the DM asked"')
  ok(/if \(tier === "canceling"\) return "var\(--color-danger\)";/.test(tasks) && !tasks.includes('New program since'), 'the canceling tier\'s edge is red; the meta no longer says "New program since"')

  const header = render(LIST.ListHeader, { title: 'Templates', description: 'The messages.', actions: [createElement('button', { key: 'a' }, 'Refresh'), createElement('button', { key: 'b' }, 'New template')] })
  ok(header.includes('data-header-actions="many"') && header.includes('max-[479px]:order-last') && header.includes('max-[479px]:col-span-2') && /min-height:44px/.test(header),
     'two actions share the title\'s 44px line from 480px wide and go under the words below it')
  const single = render(LIST.ListHeader, { title: 'Survey', description: 'Answers.', action: createElement('button', null, 'Refresh') })
  ok(single.includes('data-header-actions="one"') && !single.includes('max-[479px]'), 'one action stays beside the title on every width')
  const guard = fromSrc('src/components/auth/TeamGuard.tsx')
  ok(/<div className="admin-shell">\s*<div className=\{tokens\.tokens\}/.test(guard) && guard.includes('height: 60') && !guard.includes('border-accent'),
     'the sign-in check\'s loading screen is the dark ground with an empty 60px bar, inside .admin-shell')
  const rating = fromSrc('src/components/world/LessonRating.tsx')
  const lesson = fromSrc('src/components/world/LessonScreen.tsx')
  const css = fromSrc('src/components/world/world-ui.module.css')
  ok(rating.includes('const formOpen = showForm && stars > 0;') && lesson.includes('onFormOpen={setRatingOpen}') && lesson.includes('data-quiet={ratingOpen && nextOn ? "" : undefined}')
       && css.includes('.primary[data-quiet]:not([aria-disabled="true"]) {'),
     'the lesson page: while the rating\'s form is open, Save is the one filled button and Next lesson is outlined')
  ok(/\.view\[data-cp\] \.desc,\s*\.view\[data-cp\] \.cpReason \{\s*text-wrap: pretty;/.test(fromSrc('src/components/world-v6/world.module.css')),
     'the 30% checkpoint panel\'s sentences break evenly (text-wrap: pretty)')
  const settings = fromSrc('src/components/admin/templates/MessageSettings.tsx')
  ok(settings.includes('const [open, setOpen] = useState(false);') && !templates.includes('You can read the templates and the message settings.'),
     'Templates: Message settings opens folded for every role, its warnings above the fold; one sentence about who can change it, the panel\'s')
  const trigger = fromSrc('src/components/admin/TriggerBuilder.tsx')
  ok(trigger.includes('{ value: "is", label: "is yes" }') && trigger.includes('inputType === "boolean" ? BOOLEAN_OPS : BINARY_OPS'),
     'a yes-or-no condition is one select, "is yes" or "is no"')
  const form = fromSrc('src/components/admin/templates/form-parts.tsx')
  ok(form.includes('fontSize: "var(--admin-field-size, 16px)",') && /@media \(min-width: 640px\) and \(pointer: fine\) \{\s*:where\(\.tokens\) \{\s*--admin-field-size: 14px;/.test(tokens)
       && /data-role-locked[\s\S]{0,80}<Pill tone="neutral">\{roleLabel\(m\.role\)\}<\/Pill>/.test(team),
     'Team: fields 16px on a phone, 14px with a mouse on a wide window; a founder\'s own role a pill, not a dead select')
}

// ── Removals ────────────────────────────────────────────────────────────────
console.log('\n=== What the round removed ===')
{
  // The render review's fix round put the not-activated page back, exactly as at d0ebe76 (it was not one of D2's
  // removals): admin-render-fixes.test.mjs checks it byte for byte. plans.ts and the helpers stay gone.
  ok(exists('src/app/admin/(authenticated)/not-activated/page.tsx') && !exists('src/lib/admin/plans.ts'), 'plans.ts is gone; the not-activated page is back (the render review\'s fix round)')
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))
  const gone = /from "@\/lib\/admin\/plans"|\b(planLabel|timeLeftText|DiscordReach|WhopNotPulled|lastContactText|PillLinks|thirtyReasonText|aboutHoursWords|PacePill|IconButton)\b/
  const src = walk(here('../src')).filter((f) => /\.(ts|tsx)$/.test(f) && gone.test(fs.readFileSync(f, 'utf8'))).map((f) => f.slice(f.indexOf('/src/') + 1))
  ok(src.length === 0, 'nothing in src/ imports plans.ts or keeps the helpers only the removed pages used', src.slice(0, 4).join(' | '))
  ok(fromSrc('supabase/migrations/2026_v109_tasks_reset.sql').includes('The owner pastes it in the SQL editor.')
       && fromSrc('client-tests/admin-routes.test.mjs').includes("the owner's decision")
       && fromSrc('system_contracts.md').includes('not on production; the owner pastes it):**'),
     'the three lines the branch added with the owner\'s first name say "the owner"')
  const contracts = fromSrc('system_contracts.md')
  const section = (title) => contracts.slice(contracts.indexOf(title), contracts.indexOf('\n---', contracts.indexOf(title)))
  ok(/No reader or writer since admin rebuild 2/.test(section('### `etfb_seat_decisions` (v87)')) && /No reader since admin rebuild 2/.test(section('### Whop Stats API')),
     'system_contracts.md says the two removed surfaces\' sections have no reader now')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
