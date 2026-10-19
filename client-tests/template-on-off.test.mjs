// template-on-off.test.mjs: the on/off switch on /admin/templates (fix lane
// G1, the review of admin-3, 2026-10-20).
//
//   Finding 1: the page showed "Off" and Turn on / Turn off on every template,
//   but check-csm-tasks makes the tasks of its built-in rules (nolessons.*,
//   and on the old course noship.* and pace.*) whether their template is on or
//   off, and csm-events.ts makes W2.2, W2.6 and X.1 by scenario alone. Turning
//   one of those off read "Off" and changed nothing.
//
// No browser runs here (the repo has no DOM harness), so the fix is checked
// on the real source in the ways that need none:
//   - the module that decides, src/lib/template-on-off.ts, copied with its
//     import lines pointed at build.mjs's copies (run build.mjs first; `npm
//     run test:client` does);
//   - who makes a template's tasks while it is off, from the real code:
//     check-csm-tasks' template choice and its steps 1 and 2, lifted verbatim
//     from the route and run on the real csm-triggers.ts for students on both
//     courses; check-na-tasks' template read, lifted the same way and run on
//     stub-server.ts's database; csm-events.ts's three hooks, run as they are;
//   - every built-in rule and every alert, run on a grid of students on both
//     courses, to hold the module's list of the rules that stop on the new
//     course to the code;
//   - the row's on/off component, compiled by TypeScript (JSX to
//     react/jsx-runtime calls, as Next's compiler does) and rendered by
//     React's server renderer, then called as React calls it to press its
//     button;
//   - the page's load(), taken from the source with TypeScript's parser and
//     run on the stand-in database, and the page's markup read from the source.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { renderToString } from 'react-dom/server'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')

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

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

const DAY = 86_400_000
const HOUR = 3_600_000
const NOW = Date.now()
const iso = (ms) => new Date(ms).toISOString()

// ── The code under test ─────────────────────────────────────────────────────

const MODULE = 'src/lib/template-on-off.ts'
write(fromSrc(MODULE), MODULE, './_gen/template-on-off.ts', [
  ['from "@/lib/csm-triggers"', 'from "./csm-triggers.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  // Only a TYPE, which --experimental-strip-types erases; the file does not exist.
  ['from "@/types/database"', 'from "./types-erased.ts"'],
])
const COMPONENT = 'src/components/admin/TemplateOnOff.tsx'
write(ts.transpileModule(fromSrc(COMPONENT), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText, COMPONENT, './_gen/template-on-off-view.mjs', [])

const ONOFF = await import('./_gen/template-on-off.ts')
const { TemplateOnOff } = await import('./_gen/template-on-off-view.mjs')
const CSM = await import('./_gen/csm-triggers.ts')
const { onLessonCompleted, onDiscountRequested, checkR2CompoundsShipped } = await import('./_gen/csm-events.ts')
const { FakeDb, fakeClient } = await import('./_gen/stub-server.ts')

/** The text of `src` from `from` up to (not including) `to`, or a throw naming what is missing. */
function between(src, from, to, label) {
  const a = src.indexOf(from)
  const b = a < 0 ? -1 : src.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error(`${label}: no ${JSON.stringify(from)} before ${JSON.stringify(to)}`)
  return src.slice(a, b)
}
const plainJs = (text) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

// check-csm-tasks: its alert labels, then everything from the region totals
// to the end of step 2 (the template choice, the snapshots, step 1's alerts,
// step 2a's built-in rules and step 2b's conditions), verbatim. What the route
// read from the database before that point is handed in.
const CSM_ROUTE = 'src/app/api/cron/check-csm-tasks/route.ts'
const csmRoute = fromSrc(CSM_ROUTE)
const CRON_INPUTS = ['students', 'lessons', 'templates', 'existingTasks', 'milestonesRes', 'completionsByStudent',
  'alerts', 'course', 'SCENARIO_BUCKET', 'alertTask', 'snapshotIsCanceling', 'buildStudentSnapshot', 'triggers',
  'evaluateCustomTrigger']
const cronSteps1And2 = new Function(...CRON_INPUTS, `${plainJs([
  between(csmRoute, 'const ALERT_LABEL', '\ninterface AlertRow', CSM_ROUTE),
  between(csmRoute, '  const regionTotals: Record<string, number> = {};', '  // ─── 3. Per-student priority cap', CSM_ROUTE),
].join('\n'))}\nreturn toInsert;`)

// check-na-tasks: its tiers, then its template read, verbatim, run on the
// stand-in database. It hands back the scenario -> template id map the route
// makes its tasks from.
const NA_ROUTE = 'src/app/api/cron/check-na-tasks/route.ts'
const naRoute = fromSrc(NA_ROUTE)
const naTemplateRead = new Function('supabase', `return (async () => {${plainJs([
  between(naRoute, 'const TIER_DAYS = ', '\ntype Tier', NA_ROUTE),
  between(naRoute, '  const allNaIds = ', '  const created: Array<{', NA_ROUTE),
].join('\n'))}\nreturn templateIdByScenario;})()`)

// ── The two courses ─────────────────────────────────────────────────────────

// The old course: 65 rows in r1..r4, the action lessons where the built-ins
// look for them (l018/l020 in r1, l022/l024/l049 in r2).
const OLD_LESSONS = []
{
  const push = (rid, ids) => ids.forEach((id) => OLD_LESSONS.push({
    id, region_id: rid,
    requires_action: ['l018', 'l020', 'l022', 'l024', 'l049'].includes(id),
    counts_toward_progress: id !== 'l057',
  }))
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `l${String(a + i).padStart(3, '0')}`)
  push('r1', range(1, 20).filter((id) => id !== 'l006' && id !== 'l012'))
  push('r2', [...range(21, 33), 'l046', 'l049'])
  push('r3', [...range(50, 56), ...range(64, 72)])
  push('r4', ['l057', ...range(73, 87)])
}
// The new course: 141 rows in a1..a8, a few action lessons.
const NEW_SIZES = { a1: 18, a2: 18, a3: 17, a4: 18, a5: 18, a6: 17, a7: 19, a8: 16 }
const NEW_ACTIONS = new Set(['a1l05', 'a2l07', 'a3l10', 'a4l17', 'a6l03'])
const NEW_LESSONS = []
for (const [rid, n] of Object.entries(NEW_SIZES)) {
  for (let i = 1; i <= n; i++) {
    const id = `${rid}l${String(i).padStart(2, '0')}`
    NEW_LESSONS.push({ id, region_id: rid, requires_action: NEW_ACTIONS.has(id), counts_toward_progress: id !== 'a7l19' })
  }
}
// The switch happened 25 days ago; every new-course student below paid after it.
const RESET_AT = iso(NOW - 25 * DAY)
const COURSES = {
  old: { lessons: OLD_LESSONS, regionOrder: ['r1', 'r2', 'r3', 'r4'], resetAt: null },
  new: { lessons: NEW_LESSONS, regionOrder: Object.keys(NEW_SIZES), resetAt: RESET_AT },
}
/** The live course as the page reads it: the real readLiveCourse on a database holding that course. */
function courseDb(name) {
  const c = COURSES[name]
  return new FakeDb({
    regions: c.regionOrder.map((id, i) => ({ id, order_num: i + 1 })),
    lessons: c.lessons,
    admin_config: c.resetAt ? [{ key: 'curriculum_reset_at', value: c.resetAt }] : [],
  })
}
const LIVE = {}
for (const name of ['old', 'new']) LIVE[name] = { course: await ONOFF.readLiveCourse(fakeClient(courseDb(name))), error: null }
const UNREAD = 'admin_config.curriculum_reset_at could not be read: permission denied for table admin_config'
LIVE.unread = { course: null, error: UNREAD }

// ── Students, on tenure day `day` (and course day `day` on the new course) ──

const nonAction = (lessons, rid) => lessons.filter((l) => l.region_id === rid && !l.requires_action).map((l) => l.id)
function student(id, day, lessonIds = [], { loggedIn = true } = {}) {
  const paid = NOW - (day - 1) * DAY - 5 * HOUR
  return {
    student: {
      id, name: id, first_paid_at: iso(paid), joined_at: iso(paid), membership_status: 'active',
      last_active_at: iso(NOW - HOUR), cancel_scheduled_at: null,
    },
    completions: lessonIds.map((lesson_id) => ({
      student_id: id, lesson_id, completed_at: iso(NOW - DAY), action_completed_at: null, skipped_at: null,
    })),
    login: loggedIn ? iso(paid + HOUR) : null,
  }
}
/** Students each built-in rule fires on, by course, and students only an alert catches. */
function cohort(name) {
  const L = COURSES[name].lessons
  const [first, second] = COURSES[name].regionOrder
  return [
    student('zero-day3', 3),
    student('zero-day7', 7),
    student('zero-day14', 14),
    student('first-10-day7', 7, nonAction(L, first).slice(0, 10)),
    student('second-5-day14', 14, nonAction(L, second).slice(0, 5)),
    student('two-day7', 7, nonAction(L, first).slice(0, 2)),
    student('two-day14', 14, nonAction(L, first).slice(0, 2)),
    student('two-day21', 21, nonAction(L, first).slice(0, 2)),
    student('alert-zero-day5', 5),
    student('alert-one-day10', 10, nonAction(L, first).slice(0, 1)),
  ]
}
const ALERTS = [
  { id: 'al-1', student_id: 'alert-zero-day5', alert_type: 'no_lessons_3d', message: 'X has not started', created_at: iso(NOW - HOUR) },
  { id: 'al-2', student_id: 'alert-one-day10', alert_type: 'no_login_5d', message: 'no login', created_at: iso(NOW - HOUR) },
]

// ── The templates: the 18 built-ins after v57, and a custom one ─────────────

const BUILT_INS = ['welcome.day1',
  ...[3, 5, 7, 10].flatMap((d) => [`stalled.discord.day${d}`, `stalled.whop.day${d}`]),
  'nolessons.day3', 'nolessons.day7', 'nolessons.day14', 'noship.r1.day7', 'noship.r2.day14',
  'pace.day7', 'pace.day14', 'pace.day21', 'month2.entry']
const EVERYONE = { all: [{ metric: 'has_logged_into_app', op: 'is' }] }
/** Every template, on; `withConditions` gives each built-in conditions every logged-in student meets. */
function templateSet(withConditions) {
  return [
    ...BUILT_INS.map((scenario_id) => ({
      id: `tpl-${scenario_id}`, scenario_id, bucket: CSM.SCENARIO_BUCKET[scenario_id], is_custom: false,
      is_active: true, is_admin_only: false, trigger_config: withConditions ? EVERYONE : null,
    })),
    { id: 'tpl-C-a1b2c3', scenario_id: 'C-a1b2c3', bucket: 'at_risk', is_custom: true, is_active: true,
      is_admin_only: false, trigger_config: EVERYONE },
  ]
}

/** The template ids check-csm-tasks' steps 1 and 2 would make tasks with. */
function cronMakes(courseName, templates) {
  const c = COURSES[courseName]
  const people = cohort(courseName)
  const rows = cronSteps1And2(
    people.map((p) => p.student), c.lessons, templates, [],
    { data: people.filter((p) => p.login).map((p) => ({ student_id: p.student.id, first_sprint_login_at: p.login })) },
    new Map(people.map((p) => [p.student.id, p.completions])), ALERTS,
    { regionOrder: c.regionOrder, resetAt: c.resetAt },
    CSM.SCENARIO_BUCKET, CSM.alertTask, CSM.snapshotIsCanceling, CSM.buildStudentSnapshot, CSM.triggers,
    CSM.evaluateCustomTrigger)
  return rows
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Finding 1: who makes a template\'s tasks while it is off ===')

/** For each course and each kind of template: whether the crons and hooks make its tasks while it alone is off. */
const madeWhileOff = { old: new Map(), new: new Map() }
for (const courseName of ['old', 'new']) {
  for (const withConditions of [false, true]) {
    const all = templateSet(withConditions)
    const onRows = cronMakes(courseName, all)
    for (const t of all) {
      const off = all.map((x) => (x.id === t.id ? { ...x, is_active: false } : x))
      const offRows = cronMakes(courseName, off).filter((r) => r.template_id === t.id)
      const key = `${t.scenario_id}${withConditions && !t.is_custom ? ' (with conditions)' : ''}`
      madeWhileOff[courseName].set(key, {
        t: { ...t, is_active: false }, off: offRows.length, on: onRows.filter((r) => r.template_id === t.id).length,
      })
    }
  }
}
{
  // The cron's own words, for the record: what it does while the template is off.
  const o = madeWhileOff.old, n = madeWhileOff.new
  ok(o.get('nolessons.day3').off > 0 && n.get('nolessons.day3').off > 0 && n.get('nolessons.day3 (with conditions)').off > 0,
     'nolessons.day3 turned off: the cron still makes its tasks, on both courses, with or without conditions (step 2a\'s built-in rule, step 1\'s alerts)',
     show({ old: o.get('nolessons.day3').off, new: n.get('nolessons.day3').off }))
  ok(o.get('noship.r1.day7').off > 0 && o.get('noship.r1.day7 (with conditions)').off > 0 && o.get('pace.day14').off > 0,
     'on the old course noship.r1.day7 and pace.day14 turned off still get tasks: with conditions, off sends it back to its built-in rule',
     show({ noship: o.get('noship.r1.day7 (with conditions)').off, pace: o.get('pace.day14').off }))
  ok(n.get('noship.r1.day7').off === 0 && n.get('noship.r1.day7 (with conditions)').off === 0
       && n.get('noship.r1.day7 (with conditions)').on > 0 && n.get('pace.day7 (with conditions)').on > 0,
     'on the new course the built-in rules noship.* and pace.* make nothing: off stops the conditions they have, on runs them')
  ok(n.get('C-a1b2c3').off === 0 && n.get('C-a1b2c3').on > 0 && o.get('C-a1b2c3').off === 0
       && n.get('welcome.day1 (with conditions)').off === 0 && n.get('welcome.day1 (with conditions)').on > 0
       && n.get('stalled.whop.day3 (with conditions)').off === 0,
     'a custom template, welcome.day1 and stalled.whop.day3 with conditions: made while on, nothing while off (step 2b reads the switch)')
}
{
  // check-na-tasks reads only templates that are on.
  const db = new FakeDb({ templates: [
    { id: 'tpl-sd3', scenario_id: 'stalled.discord.day3', is_active: true },
    { id: 'tpl-sw3', scenario_id: 'stalled.whop.day3', is_active: false },
    { id: 'tpl-sw5', scenario_id: 'stalled.whop.day5', is_active: true },
  ] })
  const map = await naTemplateRead(fakeClient(db))
  ok(show([...map.entries()].sort()) === show([['stalled.discord.day3', 'tpl-sd3'], ['stalled.whop.day5', 'tpl-sw5']]),
     'check-na-tasks\' own template read (lifted from the route, on the stand-in database) leaves out stalled.whop.day3, which is off', show([...map.entries()]))
  ok(/const templateId = templateIdByScenario\.get\(scenarioId\);\s*if \(!templateId\) \{\s*errors\.push\([^;]*\);\s*continue;\s*\}/.test(naRoute),
     'and the route makes no task for a scenario missing from that map')
}
{
  // csm-events.ts finds its three templates by scenario alone: off, they still make tasks.
  const SHIPPED = iso(NOW - DAY)
  const db = new FakeDb({
    students: [{ id: 's1', name: 'Ana Horvat', membership_status: 'active' }],
    templates: ['W2.2', 'W2.6', 'X.1'].map((scenario_id) => ({ id: `tpl-${scenario_id}`, scenario_id, is_active: false })),
    tasks: [{ student_id: 's1', scenario_id: 'W1.4', status: 'open', created_at: iso(NOW - 20 * DAY) }],
    student_lesson_completions: ['l022', 'l024'].map((lesson_id) => ({ student_id: 's1', lesson_id, completed_at: SHIPPED, action_completed_at: SHIPPED })),
  })
  await onDiscountRequested(fakeClient(db), 's1')
  await checkR2CompoundsShipped(fakeClient(db), 's1', 'l024')
  await onLessonCompleted(fakeClient(db), 's1')
  const made = db.rows('tasks').filter((t) => t.status === 'open' && t.scenario_id !== 'W1.4').map((t) => `${t.scenario_id}:${t.template_id}`).sort()
  ok(show(made) === show(['W2.2:tpl-W2.2', 'W2.6:tpl-W2.6', 'X.1:tpl-X.1']),
     'csm-events.ts\'s hooks, run as they are, make W2.2, W2.6 and X.1 with templates that are all off', show(made))
  const named = [...fromSrc('src/lib/csm-events.ts').matchAll(/getTemplateId\(supabase, "([^"]+)"\)/g)].map((m) => m[1]).sort()
  ok(show(named) === show([...ONOFF.EVENT_HOOK_SCENARIOS].sort()),
     'the module\'s EVENT_HOOK_SCENARIOS are exactly the templates csm-events.ts reads', show(named))
  // The hooks do not read the course, so the same holds on both.
  for (const s of ['W2.2', 'W2.6', 'X.1']) {
    const t = { id: `tpl-${s}`, scenario_id: s, is_custom: false, is_active: false, trigger_config: null }
    const off = db.rows('tasks').filter((k) => k.scenario_id === s && k.template_id === t.id).length
    for (const courseName of ['old', 'new']) madeWhileOff[courseName].set(s, { t, off })
  }
}

console.log('\n=== Finding 1: the page shows the switch exactly where turning it off stops the template\'s tasks ===')
for (const courseName of ['old', 'new']) {
  const wrongNow = []
  const wrongBefore = []
  let shown = 0
  for (const [key, m] of madeWhileOff[courseName]) {
    const view = ONOFF.onOffView(m.t, LIVE[courseName], false)
    const switchWorks = m.off === 0
    if ((view.kind === 'switch') !== switchWorks) wrongNow.push(`${key}: ${view.kind}, made while off ${m.off}`)
    if (view.kind === 'switch') shown++
    // admin-3's page: "Off" and Turn on / Turn off on every template.
    if (!switchWorks) wrongBefore.push(key)
    if (view.kind === 'none' && view.line !== (m.t.scenario_id.startsWith('W') || m.t.scenario_id === 'X.1' ? ONOFF.STUDENT_ACTION_LINE : ONOFF.TASK_CHECK_LINE)) {
      wrongNow.push(`${key}: says ${view.line}`)
    }
  }
  ok(wrongNow.length === 0,
     `${courseName} course: for all ${madeWhileOff[courseName].size} templates checked, the switch is shown where off stops their tasks (${shown}) and one line says the rest are made whether on or off`,
     wrongNow.join('; '))
  ok(wrongBefore.length > 0,
     `control: admin-3's page showed "Off" and Turn off on all of them, so on the ${courseName} course it said "Off" on ${wrongBefore.length} that still get tasks`,
     wrongBefore.join(', '))
}
{
  const n = (id) => ONOFF.onOffView({ scenario_id: id, is_active: false, trigger_config: null }, LIVE.new, false)
  ok(n('nolessons.day3').kind === 'none' && n('nolessons.day3').line === 'The task check that runs every 2 hours makes this template\'s tasks whether it is on or off, so it has no on/off switch here.',
     'Karlo\'s case: nolessons.day3 has no switch, and its line says the task check makes its tasks whether it is on or off', n('nolessons.day3').line)
  const u = (id) => ONOFF.onOffView({ scenario_id: id, is_active: false, trigger_config: null }, LIVE.unread, false)
  ok(u('pace.day7').kind === 'none' && u('pace.day7').line === `This template's on/off switch is hidden because the course could not be read (${UNREAD}).`
       && u('nolessons.day3').kind === 'none' && u('C-a1b2c3').kind === 'switch' && u('stalled.whop.day3').kind === 'switch',
     'the course unread: pace.* and noship.* (whose switch depends on it) show no switch and say why; the others are as before', u('pace.day7').line)
}

console.log('\n=== Finding 1: the list of rules that stop on the new course matches the code ===')
{
  // Every built-in rule and every alert, on a grid of students: tenure days 1
  // to 45, switches 1 to 30 days ago (new course), six ways through the course.
  const fired = { old: new Set(), new: new Set() }
  for (const courseName of ['old', 'new']) {
    const c = COURSES[courseName]
    const totals = {}
    for (const l of c.lessons) totals[l.region_id] = (totals[l.region_id] ?? 0) + 1
    const [first, second] = c.regionOrder
    const firstAll = c.lessons.filter((l) => l.region_id === first).map((l) => l.id)
    const ways = [[], nonAction(c.lessons, first).slice(0, 2), nonAction(c.lessons, first).slice(0, 10),
      [...nonAction(c.lessons, first).slice(0, 10), ...nonAction(c.lessons, second).slice(0, 5)], firstAll,
      c.lessons.map((l) => l.id)]
    const resets = c.resetAt ? [1, 3, 8, 15, 30].map((d) => iso(NOW - d * DAY + HOUR)) : [null]
    for (const resetAt of resets) {
      for (let day = 1; day <= 45; day++) {
        for (const lessonIds of ways) {
          const p = student('grid', day, lessonIds)
          const snap = () => CSM.buildStudentSnapshot(p.student, p.completions, c.lessons, totals, [],
            { first_sprint_login_at: p.login }, { regionOrder: c.regionOrder, resetAt })
          for (const [id, rule] of Object.entries(CSM.triggers)) if (rule(snap())) fired[courseName].add(id)
          for (const type of ['no_lessons_3d', 'no_tasks_7d', 'no_login_5d', 'no_lessons_7d']) {
            const task = CSM.alertTask(type, 'x', snap())
            if (task) fired[courseName].add(task.scenarioId)
          }
        }
      }
    }
  }
  const rules = Object.keys(CSM.triggers)
  const oldOnly = [...ONOFF.OLD_COURSE_ONLY_RULES]
  ok(rules.every((id) => fired.old.has(id)) && oldOnly.every((id) => rules.includes(id)),
     'on the old course every built-in rule fires for some student, and every rule on the list is one of them', show([...fired.old].sort()))
  ok(oldOnly.every((id) => !fired.new.has(id)),
     'on the new course no rule on the list fires, and no alert maps to one', show([...fired.new].sort()))
  ok(rules.filter((id) => !ONOFF.OLD_COURSE_ONLY_RULES.has(id)).every((id) => fired.new.has(id)),
     'and every rule left off the list (nolessons.*) does fire on the new course, so the list is exactly the rules that stop')
}

console.log('\n=== Finding 1: the row, rendered ===')
{
  const off = { kind: 'switch', on: false, line: 'This template is off.', turnOnWaits: null }
  const on = { kind: 'switch', on: true, line: 'This template is on.', turnOnWaits: null }
  const none = ONOFF.onOffView({ scenario_id: 'nolessons.day3', is_active: false, trigger_config: null }, LIVE.new, false)
  const render = (view, extra = {}) => renderToString(TemplateOnOff({ view, canEdit: true, busy: false, onToggle: () => {}, ...extra }))
  const noSwitch = render(none)
  ok(noSwitch.includes(ONOFF.TASK_CHECK_LINE.replace(/'/g, '&#x27;')) && !noSwitch.includes('<button') && !noSwitch.includes('This template is off'),
     'nolessons.day3 renders its one line, with no button and no "off"', noSwitch)
  const offHtml = render(off)
  ok(offHtml.includes('This template is off.') && /<button type="button"[^>]*>Turn on<\/button>/.test(offHtml) && !/<button[^>]*disabled/.test(offHtml),
     'a template whose switch works, off: "This template is off." and Turn on, pressable', offHtml)
  ok(/<button type="button"[^>]*>Turn off<\/button>/.test(render(on)) && !/disabled/.test(render(on)),
     'on: Turn off, pressable')
  const dirtyView = ONOFF.onOffView({ scenario_id: 'C-a1b2c3', is_active: false, trigger_config: EVERYONE }, LIVE.new, true)
  const dirtyHtml = render(dirtyView)
  ok(/<button type="button" disabled=""[^>]*>Turn on<\/button>/.test(dirtyHtml) && dirtyHtml.includes('Save your changes first, then turn it on.'),
     'with unsaved changes Turn on waits, and says why', dirtyHtml)
  const dirtyOn = ONOFF.onOffView({ scenario_id: 'C-a1b2c3', is_active: true, trigger_config: EVERYONE }, LIVE.new, true)
  ok(dirtyOn.turnOnWaits === null && !/disabled/.test(render(dirtyOn)), 'turning off never waits')
  ok(/disabled=""/.test(render(off, { busy: true })), 'while the row is saving or switching, the button is not pressable')
  const csm = render(off, { canEdit: false })
  ok(csm.includes('This template is off.') && !csm.includes('<button'), 'a CSM sees on or off and no button')
  let pressed = 0
  const tree = TemplateOnOff({ view: off, canEdit: true, busy: false, onToggle: () => { pressed++ } })
  const button = (function find(n) {
    if (!n || typeof n !== 'object') return null
    if (Array.isArray(n)) { for (const x of n) { const b = find(x); if (b) return b } return null }
    return n.type === 'button' ? n : find(n.props?.children)
  })(tree)
  button?.props.onClick()
  ok(pressed === 1, 'pressing the button calls the page\'s handler once')
}

console.log('\n=== Finding 1: the page reads the course and renders the row from the view ===')
{
  const PAGE = 'src/app/admin/(authenticated)/templates/page.tsx'
  const src = fromSrc(PAGE)
  const sf = ts.createSourceFile('page.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let load = null
  const visit = (n) => { if (!load && ts.isFunctionDeclaration(n) && n.name?.text === 'load') load = n; else ts.forEachChild(n, visit) }
  visit(sf)
  const runLoad = async (db) => {
    const seen = {}
    const scope = {
      setLoading: (v) => { seen.loading = v }, setLive: (v) => { seen.live = v }, setRows: (v) => { seen.rows = v },
      setDrafts: (v) => { seen.drafts = v }, supabase: fakeClient(db), readLiveCourse: ONOFF.readLiveCourse,
      weekRank: () => 0, EMPTY_TRIGGER: { all: [] },
    }
    const js = plainJs(`const __f = ${load.getText(sf)};`)
    await new Function(...Object.keys(scope), `${js}\nreturn __f;`)(...Object.values(scope))()
    return seen
  }
  const db = courseDb('new')
  db.tables.templates = templateSet(false)
  const fine = await runLoad(db)
  ok(fine.live?.course?.courseIsNew === true && fine.live.error === null && fine.rows?.length === 19 && fine.loading === false,
     'the page\'s load(), run on the stand-in database: the templates and the live course (new) together', show(fine.live))
  db.fail['admin_config.select'] = { message: 'permission denied for table admin_config' }
  const failed = await runLoad(db)
  ok(failed.live?.course === null && failed.live.error === UNREAD && failed.rows?.length === 19,
     'a failed course read keeps the editor and records why, for the rows that need it', show(failed.live))
  ok(src.includes('const onOff = onOffView(t, live, dirty);')
       && /\{onOff\.kind === "switch" && !onOff\.on && \(\s*<span\s+title="This template is off\."/.test(src)
       && /<TemplateOnOff\s+view=\{onOff\}\s+canEdit=\{canEdit\}\s+busy=\{saving === t\.id\}\s+onToggle=\{\(\) => void setActive\(t\.id, !t\.is_active\)\}\s*\/>/.test(src),
     'in the source, each row takes its view from onOffView: the header shows "Off" only where the switch works, and the open row renders TemplateOnOff wired to setActive')
  ok(!src.includes('turnOnWaits') && !/\{!t\.is_active && \(/.test(src),
     'and the page no longer decides on or off itself (admin-3\'s badge read !t.is_active on every row)')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
