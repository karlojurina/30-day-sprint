// survey-page.test.mjs: the Survey page of admin rebuild 2 (WI-9),
// _admin/prds/admin-rebuild-2/ in the workspace.
//
//   The page sent every request id in one `.in()` (a gateway limit at about
//   200 ids), paged its answers on created_at alone (the 6 answers of one
//   application share one created_at, so a page boundary could repeat or
//   skip rows), and checked no error (a failed read showed "No survey
//   responses yet"). Its status pill said "Pending" for a request waiting
//   for a decision and "Applied" for a code on Whop, the reverse of the 30%
//   page's words.
//
// The page's read is src/lib/admin/survey-data.ts (copied by build.mjs; run
// it first, `npm run test:client` does), run here on stub-server.ts's
// database with 250 applications and 1,500 answers, its rows shuffled
// before every order (rows the order does not tell apart come back in no
// fixed order, as Postgres may hand them). The answers' component is
// compiled by TypeScript and rendered by React's server renderer. The page
// as it was at BASE is read from git for the controls.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

const BASE = 'ca9b5ef' // night/admin2 after WI-1, where this lane started

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const fromBase = (rel) => execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: here('..'), encoding: 'utf8' })

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

const SURVEY = await import('./_gen/survey-data.ts')
const { fetchAllRowsPaginated } = await import('./_gen/supabase-pagination.ts')
const { FakeDb, fakeClient, MAX_ROWS } = await import('./_gen/stub-server.ts')

const RESPONSES = 'src/components/admin/DiscountFeedbackResponses.tsx'
fs.writeFileSync(here('./_gen/a2-feedback-responses.mjs'), ts.transpileModule(fromSrc(RESPONSES), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText)
const { DiscountFeedbackResponses } = await import('./_gen/a2-feedback-responses.mjs')

// ── 250 applications, 6 answers each, every answer of one application at its moment ──

const QUESTIONS = [
  { id: 'q1', order_num: 1, question_text: 'How likely are you to recommend the course, from 1 to 10?', question_type: 'scale', scale_min: 1, scale_max: 10 },
  { id: 'q2', order_num: 2, question_text: 'Has the pace felt right?', question_type: 'multi_choice' },
  { id: 'q3', order_num: 3, question_text: 'Biggest win?', question_type: 'open_text' },
  { id: 'q4', order_num: 4, question_text: 'Most frustrating part?', question_type: 'open_text' },
  { id: 'q5', order_num: 5, question_text: 'One thing to change?', question_type: 'open_text' },
  { id: 'q6', order_num: 6, question_text: 'Anything else?', question_type: 'open_text', is_active: false },
]
const STATUSES = ['pending', 'approved', 'applied', 'rejected']
const N = 250
const pad = (n) => String(n).padStart(4, '0')
function bigDb(seed) {
  const students = []
  const requests = []
  const answers = []
  for (let i = 1; i <= N; i++) {
    const at = new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString()
    students.push({ id: `s-${pad(i)}`, name: `Student ${pad(i)}`, email: `s${pad(i)}@example.com` })
    requests.push({ id: `r-${pad(i)}`, student_id: `s-${pad(i)}`, status: STATUSES[i % 4], created_at: at })
    for (const q of QUESTIONS) {
      answers.push({
        id: `a-${pad(i)}-${q.id}`, discount_request_id: `r-${pad(i)}`, question_id: q.id, created_at: at,
        answer_scale: q.question_type === 'scale' ? 1 + (i % 10) : null,
        answer_choice: q.question_type === 'multi_choice' ? 'Just right' : null,
        answer_text: q.question_type === 'open_text' ? `Answer ${i} to ${q.id}` : null,
      })
    }
  }
  const db = new FakeDb({ discount_feedback_questions: QUESTIONS, discount_feedback_responses: answers, discount_requests: requests, students })
  db.shuffle = seed
  return db
}

console.log(`\n=== The read: ${N} applications, ${N * 6} answers (over PostgREST's ${MAX_ROWS} rows), shuffled ties ===`)
{
  let right = 0
  let oldWrong = 0
  const bad = []
  for (let seed = 1; seed <= 12; seed++) {
    const db = bigDb(seed)
    const r = await SURVEY.loadSurveyData(fakeClient(db))
    const apps = r.ok ? r.data.applications : []
    const ids = apps.flatMap((a) => a.answers.map((x) => x.id))
    const whole = r.ok && apps.length === N && ids.length === N * 6 && new Set(ids).size === N * 6
      && apps.every((a) => a.answers.length === 6 && show(a.answers.map((x) => x.question_id)) === show(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']))
    if (whole) right++
    else bad.push(seed)
    // The old page's read of the answers: pages of 1000 ordered on created_at alone.
    const old = await fetchAllRowsPaginated(() => fakeClient(db).from('discount_feedback_responses').select('*').order('created_at', { ascending: false }))
    const oldIds = old.data.map((x) => x.id)
    if (new Set(oldIds).size !== N * 6) oldWrong++
  }
  ok(right === 12, `on 12 shuffles, every application comes back once with its 6 answers in question order, ${N * 6} answers, none twice`, `wrong on seeds ${bad.join(', ')}`)
  ok(oldWrong > 0, `control: the old read (pages ordered on created_at alone) repeats or skips answers on ${oldWrong} of the 12 shuffles`)

  const db = bigDb(3)
  const r = await SURVEY.loadSurveyData(fakeClient(db))
  const sizes = (table) => db.calls(table, 'select').map((c) => c.filters.find((f) => f.startsWith('id in ('))).filter(Boolean)
    .map((f) => f.slice('id in ('.length, -1).split(',').length)
  const reqSizes = sizes('discount_requests')
  const stuSizes = sizes('students')
  ok(reqSizes.length === 3 && Math.max(...reqSizes) <= SURVEY.SURVEY_BATCH && reqSizes.reduce((a, b) => a + b, 0) === N,
     `the applications are read by id in batches of at most ${SURVEY.SURVEY_BATCH} per .in()`, show(reqSizes))
  ok(stuSizes.length === 3 && Math.max(...stuSizes) <= SURVEY.SURVEY_BATCH && stuSizes.reduce((a, b) => a + b, 0) === N,
     'and so are their students', show(stuSizes))
  const old = fromBase('src/app/admin/(authenticated)/feedback/survey/page.tsx')
  ok(/\.in\("id", requestIds\)/.test(old) && /\.order\("created_at", \{ ascending: false \}\)/.test(old),
     `control: at ${BASE} the page sent every id in one .in() and paged the answers on created_at`)
  ok(r.ok && r.data.applications[0].id === `r-${pad(N)}` && r.data.applications.at(-1).id === 'r-0001',
     'newest application first')
  ok(r.ok && show(r.data.questions.map((q) => q.id)) === show(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) && r.data.questions[5].is_active === false,
     'the questions in their order, an inactive one kept (old answers keep their question)')
  ok(r.ok && r.data.applications.every((a) => a.student?.name === `Student ${a.id.slice(2)}`), 'each application carries its own student')
}

console.log('\n=== A read that fails says what failed ===')
{
  const cases = [
    ['discount_feedback_questions', 'The questions could not be read: permission denied'],
    ['discount_feedback_responses', 'The answers could not be read: permission denied'],
  ]
  for (const [table, want] of cases) {
    const db = bigDb(1)
    db.fail[`${table}.select`] = { message: 'permission denied' }
    const r = await SURVEY.loadSurveyData(fakeClient(db))
    ok(!r.ok && r.error === want, `${table} fails: the page shows "${want}", never "no answers yet"`, show(r))
  }
  for (const [table, word] of [['discount_requests', 'The applications'], ['students', 'The students']]) {
    const db = bigDb(1)
    // Only the second batch of ids fails: a batch is a read of its own.
    db.failWhen = (call) => (call.table === table && call.op === 'select' && call.filters.some((f) => f.includes('0150')) ? { message: 'statement timeout' } : null)
    const r = await SURVEY.loadSurveyData(fakeClient(db))
    ok(!r.ok && r.error === `${word} could not be read: statement timeout`,
       `one batch of ${table} fails: the whole read fails with what failed, never a list with applications missing`, show(r))
  }
  const old = fromBase('src/app/admin/(authenticated)/feedback/survey/page.tsx')
  ok(!/error/.test(old.slice(old.indexOf('useEffect'), old.indexOf('const { npsAvg'))), `control: at ${BASE} the page's read checked no error`)
}

console.log('\n=== Odd rows ===')
{
  const db = new FakeDb({
    discount_feedback_questions: QUESTIONS,
    discount_requests: [
      { id: 'r-1', student_id: 's-gone', status: 'applied', created_at: '2026-10-05T10:00:00.000Z' },
      { id: 'r-2', student_id: 's-2', status: 'pending', created_at: '2026-10-19T10:00:00.000Z' },
    ],
    students: [{ id: 's-2', name: '  ', email: null }],
    discount_feedback_responses: [
      { id: 'a1', discount_request_id: 'r-1', question_id: 'q1', answer_scale: 9, created_at: '2026-10-05T10:00:00.000Z' },
      { id: 'a2', discount_request_id: 'r-2', question_id: 'q1', answer_scale: 6, created_at: '2026-10-19T10:00:00.000Z' },
      { id: 'a3', discount_request_id: 'r-deleted', question_id: 'q1', answer_scale: 1, created_at: '2026-10-01T10:00:00.000Z' },
    ],
  })
  const r = await SURVEY.loadSurveyData(fakeClient(db))
  ok(r.ok && show(r.data.applications.map((a) => a.id)) === show(['r-2', 'r-1']) && r.data.applications[1].student === null,
     'a student row that is gone: the application stays, with no student (the page says "Unknown student"); an answer whose application is gone is left out', show(r.ok && r.data.applications.map((a) => [a.id, a.student])))
  const avg = r.ok ? SURVEY.recommendAverage(r.data) : null
  ok(avg && avg.value === 7.5 && avg.count === 2 && avg.scale === '1 to 10', 'the recommend average: a plain mean of the scale answers, with its scale', show(avg))
}

console.log('\n=== The status words are the 30% page\'s ===')
{
  const words = Object.fromEntries(['pending', 'approved', 'rejected', 'applied'].map((s) => [s, SURVEY.statusWords(s).label]))
  ok(show(words) === show({ pending: 'Applied', approved: 'Approved', rejected: 'Rejected', applied: 'Code Applied' }),
     'pending reads "Applied" (asked, waiting for a decision) and applied reads "Code Applied" (the code is on Whop)', show(words))
  ok(SURVEY.statusWords('weird').label === 'Unknown status (weird)' && SURVEY.statusWords('').label === 'No status', 'a status no one knows is named as it is')
  const apps = ['pending', 'pending', 'applied', 'rejected', 'approved', 'applied', 'applied'].map((status, i) => ({ id: `r${i}`, status, created_at: '', student: null, answers: [] }))
  ok(show(SURVEY.statusCounts(apps)) === show([{ label: 'Applied', count: 2 }, { label: 'Approved', count: 1 }, { label: 'Code Applied', count: 3 }, { label: 'Rejected', count: 1 }]),
     'the header\'s counts, in the 30% page\'s order')
  const old = fromBase('src/app/admin/(authenticated)/feedback/survey/page.tsx')
  ok(/textTransform: "capitalize"/.test(old) && /\{status\}/.test(old), `control: at ${BASE} the pill printed the database's word, "Pending" and "Applied"`)
}

console.log('\n=== The answers, rendered ===')
{
  const html = renderToString(createElement(DiscountFeedbackResponses, {
    questions: QUESTIONS,
    responses: [
      { question_id: 'q1', answer_scale: 8, answer_choice: null, answer_text: null },
      { question_id: 'q2', answer_scale: null, answer_choice: 'A bit too fast', answer_text: null },
      { question_id: 'q3', answer_scale: null, answer_choice: null, answer_text: '  ' },
      { question_id: 'q4', answer_scale: null, answer_choice: null, answer_text: 'Shorter videos' },
    ],
  }))
  const text = html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  ok(text.includes('How likely are you to recommend the course, from 1 to 10? 8') && text.includes('A bit too fast')
       && text.includes('Biggest win? No answer') && text.includes('“Shorter videos”') && !text.includes('One thing to change?'),
     'each question over its answer, in order: the scale as a number, the choice, "No answer" for a blank, the text in quotes; an unanswered question is left out', text)
}

console.log('\n=== The words the team reads ===')
{
  const files = ['src/components/admin/survey/SurveyView.tsx', 'src/lib/admin/survey-data.ts', RESPONSES,
    'src/app/admin/(authenticated)/feedback/survey/SurveyPage.tsx', 'src/app/dev/admin/survey-fixtures.ts']
  const bad = files.filter((f) => /—|\bunlock|ecomtalent/i.test(fromSrc(f)))
  ok(bad.length === 0, 'no em dash, "unlock" or "EcomTalent" in the Survey page\'s files', bad.join(', '))
  ok(/<RestrictedPage\s+title="Survey"\s+reason="[^"—]+"/.test(fromSrc('src/app/admin/(authenticated)/feedback/survey/SurveyPage.tsx')),
     'the csm role gets the restricted page with its own reason (the default one has an em dash)')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
