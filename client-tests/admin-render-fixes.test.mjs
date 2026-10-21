// admin-render-fixes.test.mjs: admin rebuild 2's render review fix round
// (2026-10-21), every rule the round added, as the source has it. The PRD is
// _admin/prds/admin-rebuild-2/admin_rebuild_2_prd.md in the workspace; the
// findings are the render review of the pages through their /dev/admin
// harness.
//
//   headers      a failed read says so in the header too (FailedMeta), never
//                "Loading", on every page that has a header
//   the journey  the board in the page's column, scrolling inside itself
//   dashboard    the program row: Bounty left, Month 2 right, as tall as
//                each other; the sections the same distance apart; Today's
//                links named after their pages; Month 2's bar with no knob
//                (Avg progress on the 14 days: dashboard.test.mjs)
//   rows         the 30% page's and Tasks' actions on the right from 768px
//                (RowSplit); pill rows on one scrolling line on a phone
//   student      the four numbers on one line, a failed read plainly not a
//                value; the Whop sync in one line, the rest folded
//   names        one name part on every page (student-name.tsx)
//   folds        a marker on every "how it's counted" fold; Show settings
//                says it is open or closed
//   cutover      in the dark look, its words unchanged
//   nits         Airy Blue numbers only on links; All students' empty
//                username; the New template dialog's ink button; the
//                Survey's answers in their card; the not-found page in the
//                admin's frame
//   the 30%      the team's own ECOM30 code never warned about (an ECOM30
//                code, or the request's own whop_promo_id); a coupon row
//                offers Reject alone, its reason filled in; "Coupon not
//                checked yet" only beside the rule's yes
//   the cron     its population (the behaviour on a moved clock:
//                membership-discount.test.mjs)
//   restored     /admin/not-activated, byte for byte as at d0ebe76, dark,
//                no entry in the bar
//   removed      readAllDmToggles; system_contracts.md's stale tasks lines
//
// Run by `npm run test:client`, after client-tests/build.mjs (which copies
// thirty-view.ts, admin-frame.ts, people-common.ts, read-failure.ts and
// templates-data.ts). The views it renders it compiles itself, as
// admin-review does, under names of its own (rf-*.mjs).
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const exists = (rel) => fs.existsSync(here(`../${rel}`))
const git = (...args) => execFileSync('git', args, { cwd: here('..'), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
/** world-engine when admin rebuild 2 started: the not-activated page as it was. */
const BASE = 'd0ebe76'
/** night/admin2 before this round. */
const BEFORE = '8d0f2ff'

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
/** next/link as a plain <a>, so a rendered link shows where it goes. */
const LINK = ['import Link from "next/link";', 'import { createElement as __ce } from "react"; const Link = ({ href, children, ...rest }) => __ce("a", { href, ...rest }, children);']
const UI = [['from "@/components/admin/ui"', 'from "./rf-ui.mjs"']]
compile('src/components/admin/ui.tsx', 'rf-ui.mjs', [LINK])
compile('src/components/admin/review-parts.tsx', 'rf-review-parts.mjs', [LINK, ...UI, ['from "@/lib/admin/read-failure"', 'from "./read-failure.ts"']])
compile('src/components/admin/list-parts.tsx', 'rf-list-parts.mjs', [...UI, ['from "@/components/admin/review-parts"', 'from "./rf-review-parts.mjs"']])
const LIST = [['from "@/components/admin/list-parts"', 'from "./rf-list-parts.mjs"']]
compile('src/components/admin/student-name.tsx', 'rf-student-name.mjs', [LINK, ['from "@/lib/admin/people-common"', 'from "./people-common.ts"']])
compile('src/components/admin/DiscountFeedbackResponses.tsx', 'rf-feedback-responses.mjs')
compile('src/components/admin/templates/form-parts.tsx', 'rf-form-parts.mjs', [...UI, ...LIST])
compile('src/components/admin/templates/MessageSettings.tsx', 'rf-message-settings.mjs', [
  ...UI,
  ['from "@/components/admin/review-parts"', 'from "./rf-review-parts.mjs"'],
  ['from "@/lib/admin/templates-data"', 'from "./templates-data.ts"'],
  ['from "./form-parts"', 'from "./rf-form-parts.mjs"'],
])
compile('src/components/admin/not-found/AdminNotFound.tsx', 'rf-not-found.mjs', [...UI, ...LIST])
compile('src/components/admin/cutover/CutoverView.tsx', 'rf-cutover-view.mjs', [...UI, ...LIST])

const LISTP = await import('./_gen/rf-list-parts.mjs')
const PARTS = await import('./_gen/rf-review-parts.mjs')
const UIM = await import('./_gen/rf-ui.mjs')
const { StudentName } = await import('./_gen/rf-student-name.mjs')
const { DiscountFeedbackResponses } = await import('./_gen/rf-feedback-responses.mjs')
const { MessageSettings } = await import('./_gen/rf-message-settings.mjs')
const { AdminNotFound } = await import('./_gen/rf-not-found.mjs')
const { CutoverView } = await import('./_gen/rf-cutover-view.mjs')
const TV = await import('./_gen/thirty-view.ts')
const FRAME = await import('./_gen/admin-frame.ts')

const render = (component, props, ...children) => renderToString(createElement(component, props, ...children))
/** The visible words of rendered HTML, entities read. */
const words = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

// ── Headers ─────────────────────────────────────────────────────────────────
console.log('\n=== A failed read says so in the header too ===')
{
  const html = render(LISTP.FailedMeta, {})
  ok(words(html) === "Couldn't load" && html.includes('data-meta-failed') && html.includes('background:var(--color-warning)'),
     'FailedMeta: a warning dot and "Couldn\'t load" where "Loading" stood', words(html))
  const header = render(LISTP.ListHeader, { title: 'Tasks', description: 'Copy a DM.', meta: createElement(LISTP.FailedMeta) })
  ok(words(header).includes("Couldn't load") && !words(header).includes('Loading'), 'in the header\'s meta line', words(header))
  const views = {
    Tasks: 'src/components/admin/tasks/TasksView.tsx',
    'All students': 'src/components/admin/students/StudentsView.tsx',
    'Student journey': 'src/components/admin/journey/JourneyView.tsx',
    Insights: 'src/components/admin/insights/InsightsView.tsx',
    'Outreach insights': 'src/components/admin/tasks/InsightsView.tsx',
    Team: 'src/components/admin/team/TeamView.tsx',
    '30% off': 'src/components/admin/thirty/ThirtyView.tsx',
    Survey: 'src/components/admin/survey/SurveyView.tsx',
    'Lesson feedback': 'src/components/admin/feedback/LessonFeedbackView.tsx',
    Templates: 'src/components/admin/templates/TemplatesView.tsx',
  }
  const missing = Object.entries(views).filter(([, f]) => !/<FailedMeta(?: text="[^"]+")? \/>/.test(fromSrc(f))).map(([n]) => n)
  ok(missing.length === 0, 'each page\'s header draws it on a failed read: Tasks, All students, the journey, Insights, Outreach insights, Team, 30% off, Survey, Lesson feedback, Templates', missing.join(', '))
  for (const [name, f] of [['Tasks', views.Tasks], ['All students', views['All students']], ['Student journey', views['Student journey']], ['Team', views.Team]]) {
    ok(/loaded\.kind === "error" \? \(\s*<FailedMeta \/>\s*\) : \(\s*"Loading"\s*\)/.test(fromSrc(f)), `${name}: "Loading" only while it loads, the failure once it failed`)
  }
  ok(/snapshots\.kind === "error" \? \(\s*<FailedMeta text="Couldn't load the snapshots" \/>/.test(fromSrc(views.Insights)), 'Insights: its header says the snapshots could not load')
  const before = git('show', `${BEFORE}:src/components/admin/team/TeamView.tsx`)
  ok(/: "Loading"\)\}/.test(before) && !before.includes('FailedMeta'), `control: at ${BEFORE} Team's header said "Loading" over a failed read`)
}

// ── The journey ─────────────────────────────────────────────────────────────
console.log('\n=== The journey: the board in the page\'s column ===')
{
  const view = fromSrc('src/components/admin/journey/JourneyView.tsx')
  ok(!/maxWidth: wide \? 1584/.test(view) && !view.includes('function BoardPage') && !view.includes('function BoardColumn') && (view.match(/<ListPage>/g) ?? []).length === 3,
     'no board breaking out to 1584px: the page, loading, failed and loaded, is ListPage\'s column')
  ok(view.includes('className="grid grid-cols-[repeat(6,minmax(232px,1fr))] lg:grid-cols-[repeat(6,minmax(164px,1fr))]"')
       && /data-board=""[\s\S]{0,200}overflowX: "auto"/.test(view),
     'six columns of 164px at least from 1024px (they fit in the 1084px column from 1120px wide), 232px under that, the board scrolling sideways inside itself')
  ok(/data-journey-card=\{c\.id\}[\s\S]{0,700}<button[\s\S]{0,200}position: "absolute",\s*inset: 0/.test(view) && /pointerEvents: "none"/.test(view)
       && /<StudentName id=\{c\.id\} name=\{c\.name\} username=\{c\.username\} size=\{14\} \/>/.test(view),
     'a card: one button under it opens the drawer, the name over it is the student\'s link')
  ok(view.includes('<span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{numeral}</span>') && !view.includes('color: "var(--color-accent-dark)", fontWeight: 600 }}>{numeral}'),
     'the area\'s numeral in the primary ink, not Airy Blue')
  const old = git('show', `${BEFORE}:src/components/admin/journey/JourneyView.tsx`)
  ok(/maxWidth: wide \? 1584 : 1084/.test(old), `control: at ${BEFORE} the board broke out to 1584px`)
}

// ── The Dashboard ───────────────────────────────────────────────────────────
console.log('\n=== The Dashboard: the program row, the gaps, the words ===')
{
  const view = fromSrc('src/components/admin/dashboard/DashboardView.tsx')
  const program = view.slice(view.indexOf('aria-labelledby="dash-program"'), view.indexOf('aria-labelledby="dash-trends"'))
  ok(program.indexOf('data-program-slot="bounty"') > 0 && program.indexOf('data-program-slot="bounty"') < program.indexOf('data-program-slot="month2"')
       && (program.match(/<BountyCard /g) ?? []).length === 1 && /data-program-slot="month2"[\s\S]{0,200}\{waiting \? <MonthTwoCompact[\s\S]{0,100}: <MonthTwoCard/.test(program),
     'one row in every state: the Bounty Program in the left slot, Month 2 (compact or full) in the right')
  ok(!/items-start/.test(program) && /className=\{waiting \? "flex md:col-span-2" : "flex"\}/.test(program)
       && /function HeroCard[\s\S]{0,300}flex: "1 1 auto", display: "flex", flexDirection: "column"/.test(view),
     'the grid stretches both slots to the row\'s height, and each card fills its slot: as tall as each other')
  ok(/<SourceLine foot>Students on the monthly plan since Mon 25 May who joined on the bounty site\.<\/SourceLine>/.test(view) && (view.match(/<SourceLine foot>/g) ?? []).length === 3,
     'the hero cards\' source lines sit at their feet')
  ok(/const SECTION_GAP = 40;/.test(view) && (view.match(/marginTop: SECTION_GAP/g) ?? []).length >= 2 && /minHeight: 20, marginBottom: 12/.test(view)
       && /margin: "-12px 0"/.test(view) && !/flush/.test(view),
     'the three sections the same distance apart: every title row 20px, the Insights link\'s 44px hanging over its row')
  ok(view.includes('go="Go to Tasks"') && view.includes('go="Go to 30% off"') && view.includes('"Every task still to do"') && !view.includes('Open the queue') && !view.includes('Every open task'),
     'Today\'s tiles: "Open tasks" once, the links named after their pages')
  const waiting = view.slice(view.indexOf('function MonthTwoWaiting('), view.indexOf('function BountyCard('))
  ok(!waiting.includes('boxShadow: "0 0 0 2px var(--color-bg-card)"') && !/position: "absolute"/.test(waiting) && /role="meter"/.test(waiting),
     'Month 2\'s countdown: a meter with no knob, so it does not read as a slider')
  ok(/<Spark line=\{\{ ok: true, value: v\.line \}\} label="Avg progress" format=\{pct2\} from=\{v\.from\} \/>/.test(view) && /From \{pointDay\(from\)\}/.test(view)
       && /date < from \? "Before the switch" : "No snapshot"/.test(view),
     'Avg progress: its line on the 14 days, "From Mon 19 Oct" over its readings, the days before the switch read "Before the switch"')
  const old = git('show', `${BEFORE}:src/components/admin/dashboard/DashboardView.tsx`)
  ok(/<MonthTwoCard tile=\{model\.monthTwo\} \/>\s*<BountyCard/.test(old) && /items-start/.test(old), `control: at ${BEFORE} Month 2 took the left once it had a rate, and the compact one stopped short`)
}

// ── Rows ────────────────────────────────────────────────────────────────────
console.log('\n=== Rows: the actions on the right; the pill rows on one line on a phone ===')
{
  const split = render(LISTP.RowSplit, { main: createElement('p', null, 'Words'), actions: createElement('button', null, 'Approve') })
  ok(split.includes('md:grid-cols-[minmax(0,1fr)_auto]') && split.includes('md:justify-end') && split.includes('data-row-actions'),
     'RowSplit: the words, then the actions in a column of their own from 768px, right-aligned; under the words below it')
  const thirty = fromSrc('src/components/admin/thirty/ThirtyView.tsx')
  const tasks = fromSrc('src/components/admin/tasks/TasksView.tsx')
  ok((thirty.match(/<RowSplit/g) ?? []).length === 2 && (tasks.match(/<RowSplit/g) ?? []).length === 1, 'the 30% page\'s two kinds of row and the task row use it')
  ok(LISTP.PILL_ROW.includes('max-sm:flex-nowrap') && LISTP.PILL_ROW.includes('max-sm:overflow-x-auto') && LISTP.PILL_ROW.includes('flex-wrap'),
     'PILL_ROW: wrapping when wide, one line that scrolls sideways under 640px', LISTP.PILL_ROW)
  const rows = {
    'Tasks\' tabs (TabStrip)': ['src/components/admin/people-parts.tsx', /role="tablist" aria-label=\{label\} className=\{PILL_ROW\}/],
    'All students\' membership filter': ['src/components/admin/students/StudentsView.tsx', /aria-label="Membership" className=\{PILL_ROW\}/],
    'All students\' sorts': ['src/components/admin/students/StudentsView.tsx', /aria-label="Sort" className=\{`\$\{PILL_ROW\} items-center`\}/],
    'Insights\' ranges': ['src/components/admin/insights/InsightsView.tsx', /aria-label="Range" className=\{`\$\{PILL_ROW\}/],
    'Outreach insights\' ranges': ['src/components/admin/tasks/InsightsView.tsx', /aria-label="Range" className=\{PILL_ROW\}/],
  }
  const not = Object.entries(rows).filter(([, [f, re]]) => !re.test(fromSrc(f))).map(([n]) => n)
  ok(not.length === 0, 'every tab, filter and range row: Tasks\' tabs, All students\' filters and sorts, both insights\' ranges', not.join(', '))
}

// ── A student ───────────────────────────────────────────────────────────────
console.log('\n=== A student: the numbers, a failed read, the Whop sync ===')
{
  const view = fromSrc('src/components/admin/students/StudentDetailView.tsx')
  ok(/className="stat-value text-\[20px\] sm:text-\[28px\]"[\s\S]{0,400}whiteSpace: "nowrap"/.test(view),
     'the four numbers: 20px on a phone, 28px from 640px, on one line')
  ok(/data-failed=""[\s\S]{0,300}background: "var\(--color-warning\)"[\s\S]{0,100}\{COULD_NOT_LOAD\}/.test(view) && !/<Stat /.test(view),
     'a failed read: a warning dot and "Couldn\'t load" at the body\'s size, never a 28px value')
  ok(!/tone=\{s\.progress\.ok \? "accent"/.test(view), 'Progress in the primary ink (Airy Blue is for links)')
  const sync = view.slice(view.indexOf('function SyncBlock('), view.indexOf('function SyncNumber('))
  ok(/data-sync-line=""/.test(sync) && /Last synced \{dayTimeLabel\(v\.lastSyncAt\)\}/.test(sync) && /lessons" \} brought in`|brought in`/.test(sync)
       && /<details data-sync-details=""[\s\S]{0,100}<FoldSummary>Sync details<\/FoldSummary>/.test(sync),
     'the Whop sync: one line (synced since the switch or not, when, the lessons it brought in), then "Sync details" folded')
  const fold = sync.slice(sync.indexOf('<details data-sync-details'))
  ok(/SyncNumber label="Fetched"/.test(fold) && /Last error: /.test(fold) && /Whop lessons with no lesson here/.test(fold),
     'the counts, the note or the last error and the Whop lessons with no lesson here are all behind the fold')
}

// ── Names ───────────────────────────────────────────────────────────────────
console.log('\n=== One name part on every page ===')
{
  const html = render('div', null, createElement(StudentName, { id: 's-1', name: 'Ana Example', username: '@ana.ex' }))
  ok(/<a href="\/admin\/students\/s-1"[^>]*>Ana Example<\/a>/.test(html) && words(html) === 'Ana Example @ana.ex' && /font-weight:600/.test(html),
     'a link to the student\'s page, 600 weight, "@username" after it (a stored "@" not doubled)', html)
  const text = render('div', null, createElement(StudentName, { id: 's-1', name: 'Ana Example', asText: true }))
  ok(!text.includes('<a ') && words(text) === 'Ana Example' && /text-decoration:underline/.test(text), 'asText: the same look with no link, inside a row that is one')
  const none = render('div', null, createElement(StudentName, { id: null, name: 'A student no longer on file' }))
  ok(!none.includes('<a ') && words(none) === 'A student no longer on file', 'no student id: the name with no link')
  const users = {
    '30% off': 'src/components/admin/thirty/ThirtyView.tsx',
    Tasks: 'src/components/admin/tasks/TasksView.tsx',
    'All students': 'src/components/admin/students/StudentsView.tsx',
    'Student journey': 'src/components/admin/journey/JourneyView.tsx',
    Survey: 'src/components/admin/survey/SurveyView.tsx',
    'Lesson feedback': 'src/components/admin/feedback/LessonFeedbackView.tsx',
  }
  const without = Object.entries(users).filter(([, f]) => !fromSrc(f).includes('import { StudentName } from "@/components/admin/student-name";') || !/<StudentName /.test(fromSrc(f))).map(([n]) => n)
  ok(without.length === 0, 'the 30% page, Tasks (its rows and its detail), All students, the journey (its cards and its drawer), the Survey and Lesson feedback draw it', without.join(', '))
  const tasks = fromSrc('src/components/admin/tasks/TasksView.tsx')
  ok(/<button type="button" onClick=\{onOpen\} style=\{DETAILS_BUTTON\}>\s*Details\s*<\/button>/.test(tasks) && !/onClick=\{onOpen\}\s*style=\{\{\s*minHeight: TAP/.test(tasks),
     'Tasks: the name goes to the student\'s page, and "Details" opens the task (the name used to)')
  ok((fromSrc('src/components/admin/tasks/TasksView.tsx').match(/<StudentName /g) ?? []).length === 2 && (fromSrc('src/components/admin/journey/JourneyView.tsx').match(/<StudentName /g) ?? []).length === 2,
     'the task\'s detail and the journey\'s drawer name the student the same way')
  const feedback = fromSrc('src/components/admin/feedback/LessonFeedbackView.tsx')
  ok(!feedback.includes('import Link from "next/link"') && /<StudentName id=\{who\?\.id\} name=\{name\} username=\{who\?\.discord_username\} size=\{13\} \/>/.test(feedback),
     'Lesson feedback: the writer as the name part (it was a small Airy Blue link)')
  ok(fromSrc('src/lib/admin/lesson-feedback.ts').includes('.select("id, name, email, discord_username")') && fromSrc('src/lib/admin/survey-data.ts').includes('.select("id, name, email, discord_username")')
       && fromSrc('src/lib/admin/journey-board.ts').includes('"id, name, email, discord_username, membership_status'),
     'the reads behind them carry the username')
}

// ── The All students cell, the dialog, the Survey, the folds ────────────────
console.log('\n=== The nits ===')
{
  const students = fromSrc('src/components/admin/students/StudentsView.tsx')
  ok(students.includes('<span className="sr-only">No username</span>') && !students.includes(': "None"}'), 'All students: no username is an empty cell that says "No username" to a screen reader, never "None"')
  ok(/<Button variant="ink" size="md" busy=\{busy\} onClick=\{\(\) => void create\(\)\}>\s*\{busy \? "Creating" : "Create template"\}/.test(fromSrc('src/components/admin/templates/NewTemplateDialog.tsx')),
     'the New template dialog\'s confirm is the ink (primary) button')
  const answers = render(DiscountFeedbackResponses, {
    questions: [{ id: 'q1', order_num: 1, question_text: 'How likely are you to recommend Ecom University to a friend?', question_type: 'scale' }],
    responses: [{ question_id: 'q1', answer_scale: 9, answer_choice: null, answer_text: null }],
  })
  ok(!answers.includes('background:var(--color-bg-elevated)') && answers.includes('border-top:1px solid var(--color-border)') && words(answers).endsWith('9'),
     'the Survey\'s answers sit in their card under a hairline, no card inside the card', answers.slice(0, 120))
  const insights = fromSrc('src/components/admin/insights/InsightsView.tsx')
  ok(!insights.includes('tone="accent"') && !insights.includes('accent: { dot: null, number: "var(--color-accent-dark)" }'), 'Insights: Mean progress in the primary ink; no number in Airy Blue that is not a link')
  const summary = render(PARTS.FoldSummary, null, 'How these numbers work')
  ok(/^<summary/.test(summary) && summary.includes('display:list-item'), 'FoldSummary: the browser\'s own triangle, right when closed, down when open', summary)
  const folds = {
    Insights: ['src/components/admin/insights/InsightsView.tsx', '<FoldSummary>How these are worked out</FoldSummary>'],
    'Outreach insights': ['src/components/admin/tasks/InsightsView.tsx', '<FoldSummary>How these numbers work</FoldSummary>'],
    Templates: ['src/components/admin/templates/TemplatesView.tsx', '<FoldSummary>What the buckets mean</FoldSummary>'],
  }
  const unmarked = Object.entries(folds).filter(([, [f, s]]) => !fromSrc(f).includes(s)).map(([n]) => n)
  ok(unmarked.length === 0, 'Insights\', Outreach insights\' and Templates\' "how it\'s counted" folds have the marker', unmarked.join(', '))
  const button = render(UIM.Button, { expanded: false, controls: 'panel-1', variant: 'raised' }, 'Show settings')
  ok(button.includes('aria-expanded="false"') && button.includes('aria-controls="panel-1"'), 'ui.tsx\'s Button carries aria-expanded and aria-controls')
  const settings = render(MessageSettings, {
    settings: { ok: true, values: { program_login_link: 'https://sprint.ecomuniversity.com/login', discord_invite_link: 'https://discord.gg/made-up', dms_master_enabled: 'false', day28_dm_enabled: 'false', engagement_alerts_enabled: 'false', csm_task_summary_enabled: 'false' } },
    templates: [], live: { ok: true, data: new Set() }, canEdit: true, onSave: async () => null,
  })
  ok(/<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"[^>]*>Show settings/.test(settings), 'Message settings: "Show settings" says it is closed, and which panel it opens', (settings.match(/<button[^>]*>Show settings/) ?? [''])[0])
}

// ── The not-found page, the cutover page ───────────────────────────────────
console.log('\n=== An address with no page; the course switch page ===')
{
  const html = render(AdminNotFound, {})
  ok(words(html).startsWith('Page not found There is no admin page at this address.') && /<a href="\/admin"[^>]*>Go to the Dashboard<\/a>/.test(html)
       && words(html).includes('Today, Brand Owners, Stats, Settings and Discord test were taken out of the admin.'),
     'a small not-found page: what happened, why an old link lands here, and a link to the Dashboard', words(html))
  ok(/notFound\(\);/.test(fromSrc('src/app/admin/(authenticated)/[...missing]/page.tsx')) && /<AdminNotFound \/>/.test(fromSrc('src/app/admin/(authenticated)/not-found.tsx')),
     'every admin address with no page is the catch-all, whose 404 the group\'s not-found draws inside the admin\'s frame (the team guard, the top bar)')
  const layout = fromSrc('src/app/admin/(authenticated)/layout.tsx')
  ok(/const missing = params\?\.missing !== undefined;/.test(layout) && /missing \|\| isRebuiltPage\(pathname, REBUILT_PAGES\)/.test(layout),
     'and the frame gives it the dark look (it has no address of its own to list)')
  const listed = layout.match(/const REBUILT_PAGES[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? ''
  const pages = [...listed.matchAll(/^\s*"([^"]+)",?\s*$/gm)].map((m) => m[1])
  ok(pages.includes('/admin/cutover') && pages.includes('/admin/not-activated'), 'the course switch page and Not activated are in the dark look', show(pages))
  ok(FRAME.isRebuiltPage('/admin/cutover', pages) && FRAME.isRebuiltPage('/admin/not-activated', pages), 'isRebuiltPage says so')

  // The course switch page: its words as they were, in the dark look.
  const old = git('show', `${BASE}:src/app/admin/(authenticated)/cutover/page.tsx`)
  const view = fromSrc('src/components/admin/cutover/CutoverView.tsx')
  const sentences = [
    'Course switch', 'What the running build and the database hold right now. Look again after every redeploy.', 'Check again',
    'The status could not be checked', 'All good', 'After the switch', 'Before the switch',
    'The build and the database agree on the new course. The Whop course is not checked here (below).',
    'The old course is live. The values the switch needs are checked once it has run. The Whop course is not checked here (below).',
    'Running build', 'Database', 'Student home', 'World open to everyone', 'Catalog shape', 'v2 (the new course)', 'v1 (the old course)',
    'Catalog table', 'Whop course', 'Not set', 'Deployment', 'Not reported', 'Not run', 'Areas', 'Lessons', 'Counting toward progress',
    'With a Whop lesson id', 'Not checked here', 'Which course the Whop course id names',
    "Before the switch, production's value must still be the old course: the old dashboard's Whop sync reads it.",
  ]
  const lost = sentences.filter((t) => !old.includes(t) || !view.includes(t))
  ok(lost.length === 0, `every sentence of the page at ${BASE} is the view's, word for word`, lost.join(' | '))
  const status = {
    ok: true, phase: 'after', problems: [],
    build: { studentHome: '/world', worldLive: true, catalogIsV2: true, catalogTable: 'lessons', tableSuffix: '', whopCourseIdSet: true, whopCourseIdTail: 'Q7x2', deploymentId: null, commit: 'abc1234' },
    db: { resetAt: '2026-10-19T14:33:00.000Z', regionIds: ['a1', 'a2'], lessons: 141, countingLessons: 140, lessonsWithWhopId: 141 },
  }
  const shown = render(CutoverView, { status, error: null, loading: false, checkedAt: null, onCheck: () => {} })
  ok(words(shown).includes('All good After the switch') && words(shown).includes('With a Whop lesson id 141 of 141') && !/—/.test(words(shown)),
     'the view draws the status as the page did', words(shown).slice(0, 120))
  const failed = render(CutoverView, { status: null, error: 'The status could not be read (HTTP 500).', loading: false, checkedAt: null, onCheck: () => {} })
  ok(/<p role="alert" style="[^"]*"><span aria-hidden="true" style="[^"]*background:var\(--color-danger\)/.test(failed) && !/<p[^>]*color:var\(--color-danger\)[^>]*>The status could not be checked/.test(failed),
     'a failed check: its title in the readable ink with a red dot (red words measure 3.9:1 on the dark card)')
  ok(/<RestrictedPage title="Course switch" reason="Ask a founder or an admin if you need this page\." \/>/.test(fromSrc('src/app/admin/(authenticated)/cutover/page.tsx')),
     'the csm role\'s notice has its own reason: the default one holds an em dash')
}

// ── The 30% page ────────────────────────────────────────────────────────────
console.log('\n=== The 30%: the team\'s own code, the coupon\'s row ===')
{
  ok(TV.isThirtyCode({ code: 'ECOM30-AB12CD', promoCodeId: 'promo_1' }, {}) && TV.isThirtyCode({ code: 'ecom30-ab12cd', promoCodeId: null }, {})
       && TV.isThirtyCode({ code: 'promo_own', promoCodeId: 'promo_own' }, { whop_promo_id: 'promo_own' })
       && !TV.isThirtyCode({ code: 'evolve10', promoCodeId: 'promo_e10' }, { whop_promo_id: 'promo_own', promo_code: 'ECOM30-AB12CD' })
       && !TV.isThirtyCode({ code: null, promoCodeId: 'promo_other' }, { whop_promo_id: 'promo_own' }),
     'the team\'s own code: an ECOM30 code by its name (any case), or the request\'s own Whop promo id; evolve10 or another id is not')
  ok(TV.couponRejectReason('evolve10') === 'Already has a discount on their membership (evolve10)' && TV.couponRejectReason(null) === 'Already has a discount on their membership',
     'the reason a coupon row\'s Reject starts with, naming the code; no em dash')

  const NOW = new Date('2026-10-20T08:30:00.000Z')
  const student = (id) => ({ id, name: `Student ${id}`, email: `${id}@example.com`, discord_username: null, membership_status: 'active', first_paid_at: '2026-10-10T09:00:00.000Z', whop_membership_id: `mem_dev${id}` })
  const req = (id, sid, status, more = {}) => ({
    id, student_id: sid, status, created_at: '2026-10-15T09:00:00.000Z', promo_code: `ECOM30-${sid.toUpperCase()}`, rejection_reason: null,
    reviewed_at: '2026-10-16T09:00:00.000Z', reviewed_by: null, applied_at: status === 'applied' ? '2026-10-17T09:00:00.000Z' : null, applied_by: null,
    whop_promo_id: `promo_${sid}`, ...more,
  })
  const coupon = (sid, code, promoId, discounted = true) => ({
    student_id: sid, whop_membership_id: `mem_dev${sid}`, promo_code_id: promoId, promo_code: code,
    renewal_price: discounted ? '67.90' : '97.00', plan_renewal_price: '97.00', discounted, checked_at: '2026-10-19T08:40:00.000Z',
  })
  const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']
  const data = {
    catalog: { data: [], error: null },
    videos: { data: [], error: null },
    students: ids.map(student),
    reads: new Map(),
    requests: [
      req('r1', 'a1', 'approved'),
      req('r2', 'a2', 'approved'),
      req('r3', 'a3', 'approved'),
      req('r4', 'a4', 'applied'),
      req('r5', 'a5', 'approved'),
      req('r6', 'a6', 'approved'),
    ],
    team: new Map(),
    lastSyncAt: new Map(),
    coupons: { data: new Map([
      ['a4', coupon('a4', 'ECOM30-A4', 'promo_a4')],
      ['a5', coupon('a5', 'evolve10', 'promo_e10')],
      ['a6', coupon('a6', null, 'promo_a6')],
    ]), error: null },
  }
  const live = new Map([
    // Whop now: the team added the request's own code in Whop, before Mark code applied.
    ['a1', { ok: true, row: coupon('a1', 'ECOM30-A1', 'promo_a1') }],
    // The same, its name not read: only the request's own promo id says it is theirs.
    ['a2', { ok: true, row: coupon('a2', null, 'promo_a2') }],
    // A partner's forever code: the one to check before adding the 30% code.
    ['a3', { ok: true, row: coupon('a3', 'evolve10', 'promo_e10') }],
    // Whop says nothing now: the stored rows stand in.
    ['a5', { ok: false, fail: 'http_other' }],
    ['a6', { ok: false, fail: 'http_other' }],
  ])
  const view = TV.buildThirtyView(data, NOW, '2026-10-19T14:33:00.000Z', live)
  const row = (id) => view.requests.find((r) => r.id === id)
  const said = (id) => ({ ours: row(id).coupon?.ours ?? null, warns: TV.couponWarns(row(id)), check: row(id).couponCheck })
  ok(row('r1').coupon.ours && !TV.couponWarns(row('r1')) && row('r1').couponCheck === 'live', 'Approved, Whop showing the team\'s ECOM30 code: theirs, no warning', show(said('r1')))
  ok(row('r2').coupon.ours && !TV.couponWarns(row('r2')) && row('r2').coupon.code === 'promo_a2', 'Approved, the code\'s name not read but its id the request\'s own: theirs, no warning', show(said('r2')))
  ok(!row('r3').coupon.ours && TV.couponWarns(row('r3')), 'Approved, evolve10 on the membership: the warning stays', show(said('r3')))
  ok(row('r4').coupon.ours && !TV.couponWarns(row('r4')), 'Code Applied, its ECOM30 code stored: theirs, and no tab but Approved warns anyway', show(said('r4')))
  ok(!row('r5').coupon.ours && TV.couponWarns(row('r5')) && row('r5').couponCheck === 'stored', 'Approved, Whop silent, evolve10 stored: the warning, from the stored row', show(said('r5')))
  ok(row('r6').coupon.ours && !TV.couponWarns(row('r6')) && row('r6').couponCheck === 'stored', 'Approved, Whop silent, the request\'s own id stored: no warning', show(said('r6')))
  const loader = fromSrc('src/lib/admin/thirty-data.ts')
  ok(/LISTED_REQUEST_COLUMNS = `\$\{REQUEST_COLUMNS\}, student_id, reviewed_at, reviewed_by, applied_at, applied_by, whop_promo_id`/.test(loader),
     'the 30% page reads each request\'s whop_promo_id, which the approve route stores beside the code')
  const tv = fromSrc('src/lib/admin/thirty-view.ts')
  ok(/if \(coupon && \(r\.status === "approved" \|\| r\.status === "applied"\) && isThirtyCode\(coupon, r\)\)/.test(tv),
     'only a decided row\'s coupon can be the team\'s own: an Applied row\'s coupon still decides as the approve route decides')

  const page = fromSrc('src/components/admin/thirty/ThirtyView.tsx')
  const pending = page.slice(page.indexOf('function PendingRow('), page.indexOf('/** The 30% code, and a button that copies it. */'))
  ok(/\) : coupon \? null : \(\s*<Button[\s\S]*?Approve\s*<\/Button>/.test(pending) && /const canOverride = !verdict\.ok && !coupon;/.test(pending),
     'Applied, the coupon\'s verdict: no Approve and no Approve anyway')
  ok(/variant=\{coupon \? "raised" : "ghost"\}/.test(pending) && /if \(opening && coupon && !reason\.trim\(\)\) setReason\(couponRejectReason\(row\.coupon\?\.code \?\? null\)\);/.test(pending),
     'Reject is that row\'s one action, raised, its reason filled in when it opens ("Already has a discount on their membership (evolve10)")')
  ok(/row\.couponCheck === "not-checked" && verdict\.ok && \(/.test(pending) && !pending.includes('Approve asks Whop again first.'),
     '"Coupon not checked yet" only beside the rule\'s yes: never on a row refused for another reason')
  ok(/const coupon = couponWarns\(row\) \? row\.coupon : null;/.test(page), 'the Approved row warns through couponWarns: never about the team\'s own code')
}

// ── The cron's population ───────────────────────────────────────────────────
console.log('\n=== The coupon cron: only the windows still open ===')
{
  const md = fromSrc('src/lib/membership-discount.ts')
  ok(/\.gte\("first_paid_at", earliestOpenFirstPayment\(startedAtMs\)\)/.test(md) && /inWindow\.data\.filter\(\(s\) => discountWindowOpen\(s\.first_paid_at, startedAtMs\)\)/.test(md)
       && !md.includes('.gte("first_paid_at", DISCOUNT_ELIGIBLE_FROM)'),
     'the cron reads from the earliest first payment still open, and keeps the students whose window is open at its start (membership-discount.test.mjs runs it past the deadline)')
}

// ── Restored, removed ───────────────────────────────────────────────────────
console.log('\n=== Not activated restored; readAllDmToggles and the stale lines removed ===')
{
  const page = 'src/app/admin/(authenticated)/not-activated/page.tsx'
  ok(exists(page) && fromSrc(page) === git('show', `${BASE}:${page}`), `/admin/not-activated is the page of ${BASE}, byte for byte`)
  const leaves = FRAME.ADMIN_NAV.flatMap((e) => (e.type === 'leaf' ? [e] : e.children))
  ok(!leaves.some((l) => l.href === '/admin/not-activated') && !/not-activated/.test(git('show', `${BASE}:src/components/admin/AdminTopNav.tsx`)),
     `no entry in the bar, as at ${BASE}, where it had none`)
  const sql = 'supabase/diagnostics/admin-after-switch.sql'
  ok(fromSrc(sql) === git('show', `${BEFORE}^:${sql}`) && !fromSrc(sql).includes('the page is gone'), 'the switch evening\'s diagnostic no longer calls the page gone')
  let callers = ''
  try { callers = git('grep', '-l', 'readAllDmToggles(', '--', 'src') } catch { callers = '' } // git grep answers 1 when nothing matches
  ok(!/readAllDmToggles|ALL_KEYS/.test(fromSrc('src/lib/dm-toggles.ts').replace(/\/\*[\s\S]*?\*\//g, '')) && !callers.trim().length,
     'readAllDmToggles is gone: nothing called it since the Discord test page went')
  const contracts = fromSrc('system_contracts.md')
  const tasks = contracts.slice(contracts.indexOf('### `tasks` (CSM task queue)'), contracts.indexOf('### `daily_progress_snapshots`'))
  ok(!tasks.includes('the 30% loader still reads') && !tasks.includes('recentTaskScenarios') && !tasks.includes("The 30% loader's last contact")
       && !tasks.includes('Merge G1 before this branch') && tasks.includes('`first_paid_at >= csmSprintWindowCutoffIso()`') && tasks.includes('`src/lib/csm-task-evaluation.ts`'),
     'system_contracts.md\'s tasks contract: its readers as the source has them, the crons\' first_paid_at, no 30% last contact, no lane G1 to merge')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
