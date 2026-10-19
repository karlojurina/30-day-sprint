// template-on-off.test.mjs: the on/off switch on /admin/templates (fix lane
// G1, the review of admin-3, 2026-10-20).
//
//   Finding 1: the page showed "Off" and Turn on / Turn off on every template,
//   but check-csm-tasks makes the tasks of its built-in rules (nolessons.*,
//   and on the old course noship.* and pace.*) whether their template is on or
//   off, and csm-events.ts makes W2.2, W2.6 and X.1 by scenario alone. Turning
//   one of those off read "Off" and changed nothing.
//   Finding 2: Turn on waited only for unsaved changes, so a template the
//   course switch (v104) turned off could go back on with conditions that
//   still name the old course. On the new course "UGC Ad (l020) is not
//   shipped" is true for every student, so the next run makes its task for
//   each of them.
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

/** The tasks check-csm-tasks' steps 1 and 2 would make for `people` (by default the cohort above). */
function cronMakes(courseName, templates, people = cohort(courseName), alerts = ALERTS) {
  const c = COURSES[courseName]
  const rows = cronSteps1And2(
    people.map((p) => p.student), c.lessons, templates, [],
    { data: people.filter((p) => p.login).map((p) => ({ student_id: p.student.id, first_sprint_login_at: p.login })) },
    new Map(people.map((p) => [p.student.id, p.completions])), alerts,
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

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Finding 2: the live course, as the page reads it ===')
{
  const n = LIVE.new.course, o = LIVE.old.course
  ok(n.courseIsNew === true && n.regions.size === 8 && n.lessons.size === 141
       && show([...n.actionLessons].sort()) === show([...NEW_ACTIONS].sort()),
     'the new course: switched, its 8 areas, its 141 lessons and its action lessons', show([...n.actionLessons]))
  ok(o.courseIsNew === false && show([...o.regions]) === show(['r1', 'r2', 'r3', 'r4']) && o.lessons.size === 65
       && show([...o.actionLessons].sort()) === show(['l018', 'l020', 'l022', 'l024', 'l049']),
     'the old course: not switched, r1 to r4, its 65 lessons and its 5 action lessons')
  for (const [table, words] of [['regions', 'the areas could not be read: '], ['lessons', 'the lessons could not be read: '],
    ['admin_config', 'admin_config.curriculum_reset_at could not be read: ']]) {
    const db = courseDb('new')
    db.fail[`${table}.select`] = { message: 'permission denied' }
    const said = await ONOFF.readLiveCourse(fakeClient(db)).then(() => null, (e) => e.message)
    ok(said === `${words}permission denied`, `a failed read of ${table} throws, with what failed`, said)
  }
  const empty = courseDb('new')
  empty.tables.regions = []
  const said = await ONOFF.readLiveCourse(fakeClient(empty)).then(() => null, (e) => e.message)
  ok(said === 'the areas or the lessons came back empty',
     'an empty read throws too, so no lesson or area is called "not in the course" by mistake', said)
}

/** Why Turn on waits for an off template with these conditions (null: it can go on). */
const waitsFor = (all, live, scenario_id = 'C-a1b2c3') => {
  const v = ONOFF.onOffView({ scenario_id, is_active: false, trigger_config: { all } }, live, false)
  return v.kind === 'switch' ? v.turnOnWaits : `(no switch: ${v.line})`
}
const OLD_COURSE_WORDS = 'This template\'s conditions still name the old course. Rewrite them, save, then turn it on.'
const NOT_IN_COURSE_WORDS = 'This template\'s conditions name a lesson or area that is not in the course. Rewrite them, save, then turn it on.'

console.log('\n=== Finding 2: what an old-course condition does on the new course, in the real evaluator and the cron ===')
// Three students on the new course: one finished area 1 and shipped its
// action item (a1l05), one watched 2 lessons, one did nothing yet.
const THREE = (() => {
  const people = [
    student('finished-a1', 9, NEW_LESSONS.filter((l) => l.region_id === 'a1').map((l) => l.id)),
    student('two-lessons', 6, ['a1l01', 'a1l02']),
    student('nothing-yet', 4),
  ]
  people[0].completions.find((c) => c.lesson_id === 'a1l05').action_completed_at = iso(NOW - DAY)
  return people
})()
const NEW_TOTALS = {}
for (const l of NEW_LESSONS) NEW_TOTALS[l.region_id] = (NEW_TOTALS[l.region_id] ?? 0) + 1
const newSnaps = () => THREE.map((p) => CSM.buildStudentSnapshot(p.student, p.completions, NEW_LESSONS, NEW_TOTALS, [],
  { first_sprint_login_at: p.login }, { regionOrder: COURSES.new.regionOrder, resetAt: RESET_AT }))
const matching = (c) => newSnaps().filter((s) => CSM.evaluateCustomTrigger(s, { all: [c] }).match).map((s) => s.student.id)
{
  // As v104 found them: conditions on the old course's lessons, areas and 30-day pace.
  const asV104Found = [
    { metric: 'lesson_shipped', lesson_id: 'l020', op: 'is_not' },
    { metric: 'lesson_watched', lesson_id: 'l018', op: 'is_not' },
    { metric: 'region_complete', region: 'r1', op: 'is_not' },
    { metric: 'region_completion_pct', region: 'r2', op: 'less_than', value: 50 },
    { metric: 'region_lessons_watched', region: 'r1', op: 'at_most', value: 3 },
    { metric: 'lesson_shipped', lesson_id: 'l020', op: 'is' },
    { metric: 'region_complete', region: 'r1', op: 'is' },
    { metric: 'progress_ratio', op: 'less_than', value: 0.5 },
    { metric: 'progress_label', op: 'is', value: 'behind' },
    { metric: 'region_pace', op: 'is', value: 'behind' },
  ]
  const told = asV104Found.map((c) => ({ c, matches: matching(c).length, waits: waitsFor([c], LIVE.new) }))
  ok(told.every((x) => x.matches === 0 || x.matches === THREE.length),
     'on the new course each of them matches all 3 students or none: the real evaluator cannot tell them apart',
     told.map((x) => `${x.c.metric} ${x.c.lesson_id ?? x.c.region ?? x.c.value} ${x.c.op}: ${x.matches}/3`).join(', '))
  ok(told.every((x) => x.waits === OLD_COURSE_WORDS),
     'and the page will not turn on a template holding any of them, and says why', told.find((x) => x.waits !== OLD_COURSE_WORDS)?.waits ?? OLD_COURSE_WORDS)
  // A lesson of the new course with no action item: "shipped" is never true
  // for it (the editor never offers one; only data written by hand can hold it).
  const noItem = { metric: 'lesson_shipped', lesson_id: 'a1l01', op: 'is_not' }
  ok(matching(noItem).length === THREE.length && waitsFor([noItem], LIVE.new)
       === 'This template asks whether a lesson with no action item was shipped, which is never true. Rewrite it, save, then turn it on.',
     '"a1l01 is not shipped" (a lesson with no action item) also matches all 3, and Turn on waits with its own line', waitsFor([noItem], LIVE.new))
  const rewritten = [
    { metric: 'lesson_shipped', lesson_id: 'a1l05', op: 'is_not' },
    { metric: 'region_complete', region: 'a1', op: 'is_not' },
    { metric: 'lesson_watched', lesson_id: 'a1l01', op: 'is' },
    { metric: 'region_completion_pct', region: 'a1', op: 'less_than', value: 50 },
  ]
  const fresh = rewritten.map((c) => ({ c, who: matching(c), waits: waitsFor([c], LIVE.new) }))
  ok(fresh.every((x) => x.who.length > 0 && x.who.length < THREE.length && x.waits === null),
     'rewritten on the new course\'s lessons and areas, each tells the students apart, and Turn on is free',
     fresh.map((x) => `${x.c.lesson_id ?? x.c.region}: ${x.who.join('+')}`).join(', '))
}
{
  // The founder's case: a custom at_risk template v104 turned off, "UGC Ad (l020) is not shipped", turned on.
  const tpl = (scenario_id, cond) => ({ id: `tpl-${scenario_id}`, scenario_id, bucket: 'at_risk', is_custom: true,
    is_active: true, is_admin_only: false, trigger_config: { all: [cond] } })
  const studentsWith = (rows, scenario) => [...new Set(rows.filter((r) => r.scenario_id === scenario).map((r) => r.student_id))].sort()
  const old = studentsWith(cronMakes('new', [tpl('C-old020', { metric: 'lesson_shipped', lesson_id: 'l020', op: 'is_not' })], THREE, []), 'C-old020')
  ok(show(old) === show(['finished-a1', 'nothing-yet', 'two-lessons']),
     'turned on, check-csm-tasks (steps 1 and 2, lifted from the route) would make that task for every student, the one who shipped included', show(old))
  const fixed = studentsWith(cronMakes('new', [tpl('C-new105', { metric: 'lesson_shipped', lesson_id: 'a1l05', op: 'is_not' })], THREE, []), 'C-new105')
  ok(show(fixed) === show(['nothing-yet', 'two-lessons']),
     'rewritten to the new course\'s action item a1l05, it would make it only for the two who have not shipped', show(fixed))
  ok(waitsFor([{ metric: 'lesson_shipped', lesson_id: 'l020', op: 'is_not' }], LIVE.new) === OLD_COURSE_WORDS
       && waitsFor([{ metric: 'lesson_shipped', lesson_id: 'a1l05', op: 'is_not' }], LIVE.new) === null,
     'so the page refuses the first and lets the second go on')
  // The cron's auto-dismiss reads conditions from every template, on or off.
  ok(/const templateByScenario = new Map\(templates\.map\(\(t\) => \[t\.scenario_id, t\]\)\);/.test(csmRoute),
     'and turning it off again would leave those tasks open: the route\'s auto-dismiss (3c) reads the conditions of templates that are off too')
}

console.log('\n=== Finding 2: Turn on waits while the saved conditions read a course that is not live ===')
{
  const cases = [
    ['the 30-day pace on the new course', [{ metric: 'region_pace', op: 'is', value: 'ahead' }], LIVE.new, OLD_COURSE_WORDS],
    ['one old condition among good ones', [{ metric: 'day_number', op: 'at_least', value: 3 },
      { metric: 'lesson_watched', lesson_id: 'l049', op: 'is' }], LIVE.new, OLD_COURSE_WORDS],
    ['an area with no id', [{ metric: 'region_complete', region: null, op: 'is_not' }], LIVE.new, OLD_COURSE_WORDS],
    ['conditions with no lesson, area or pace', [{ metric: 'days_since_last_completion', op: 'at_least', value: 5 },
      { metric: 'has_logged_into_app', op: 'is' }, { metric: 'is_canceling', op: 'is_not' },
      { metric: 'membership_status', op: 'is', value: 'active' }, { metric: 'total_lessons_watched', op: 'at_most', value: 2 }],
      LIVE.new, null],
    ['no conditions at all', [], LIVE.new, null],
    ['the old course: its own lessons, areas and pace', [{ metric: 'lesson_shipped', lesson_id: 'l020', op: 'is_not' },
      { metric: 'region_complete', region: 'r1', op: 'is' }, { metric: 'progress_label', op: 'is', value: 'behind' }], LIVE.old, null],
    ['the old course: a lesson of the new one', [{ metric: 'lesson_shipped', lesson_id: 'a1l05', op: 'is_not' }], LIVE.old, NOT_IN_COURSE_WORDS],
    ['the course unread, conditions that need it', [{ metric: 'region_complete', region: 'a1', op: 'is' }], LIVE.unread,
      `The course could not be read, so this template cannot be turned on yet (${UNREAD}).`],
    ['the course unread, conditions that do not', [{ metric: 'day_number', op: 'at_least', value: 3 }], LIVE.unread, null],
  ]
  for (const [label, all, live, want] of cases) {
    const got = waitsFor(all, live)
    ok(got === want, `${label}: ${want === null ? 'Turn on is free' : 'Turn on waits'}`, got ?? 'free')
  }
  const old = [{ metric: 'lesson_shipped', lesson_id: 'l020', op: 'is_not' }]
  const dirty = ONOFF.onOffView({ scenario_id: 'C-a1b2c3', is_active: false, trigger_config: { all: old } }, LIVE.new, true)
  ok(dirty.turnOnWaits === 'Save your changes first, then turn it on.', 'unsaved changes still come first: the saved conditions are being replaced')
  const on = ONOFF.onOffView({ scenario_id: 'C-a1b2c3', is_active: true, trigger_config: { all: old } }, LIVE.new, false)
  ok(on.kind === 'switch' && on.on && on.turnOnWaits === null, 'a template that is on can always be turned off')
  ok(waitsFor(old, LIVE.new, 'noship.r1.day7') === OLD_COURSE_WORDS && waitsFor(old, LIVE.new, 'stalled.whop.day5') === OLD_COURSE_WORDS,
     'built-ins whose switch works wait the same way (noship.r1.day7 on the new course, stalled.whop.day5)')
}

console.log('\n=== Finding 2: v104\'s test, held against the live course ===')
{
  // Every metric, with the lessons and areas of both courses, ids no course
  // has, and none. v104 turned off a template when a condition named a lesson
  // or an area, or measured the 30-day pace.
  const lessonIds = ['l001', 'l018', 'l020', 'l022', 'l024', 'l049', 'l078', 'a1l01', 'a1l05', 'a2l07', 'a8l16', 'l999', '', null]
  const regionIds = ['r1', 'r2', 'r3', 'r4', 'a1', 'a4', 'a8', 'r9', '', null]
  const all = []
  for (const metric of ['lesson_shipped', 'lesson_watched']) for (const lesson_id of lessonIds) for (const op of ['is', 'is_not']) all.push({ metric, lesson_id, op })
  for (const region of regionIds) {
    for (const op of ['is', 'is_not']) all.push({ metric: 'region_complete', region, op })
    for (const metric of ['region_lessons_watched', 'region_completion_pct']) all.push({ metric, region, op: 'at_least', value: 1 })
  }
  for (const metric of ['day_number', 'total_lessons_watched', 'days_since_last_completion', 'days_since_last_login', 'progress_ratio'])
    all.push({ metric, op: 'at_least', value: 1 })
  for (const metric of ['progress_label', 'region_pace']) all.push({ metric, op: 'is', value: 'behind' })
  for (const metric of ['has_logged_into_app', 'is_canceling']) all.push({ metric, op: 'is' })
  all.push({ metric: 'membership_status', op: 'is', value: 'active' })
  const v104 = (c) => 'lesson_id' in c || 'region' in c || ['progress_ratio', 'progress_label', 'region_pace'].includes(c.metric)
  const wrong = []
  for (const name of ['old', 'new']) {
    const course = LIVE[name].course
    for (const c of all) {
      const waits = waitsFor([c], LIVE[name]) !== null
      const known = 'region' in c ? course.regions.has(c.region)
        : 'lesson_id' in c ? (c.metric === 'lesson_shipped' ? course.actionLessons : course.lessons).has(c.lesson_id)
          : !(course.courseIsNew && v104(c))
      if (waits && !v104(c)) wrong.push(`${name}: waits on ${show(c)}, which v104 left on`)
      if (waits === known) wrong.push(`${name}: ${show(c)} ${waits ? 'waits' : 'is free'}`)
    }
  }
  ok(wrong.length === 0,
     `${all.length} conditions on each course: Turn on waits exactly for those v104 would turn off whose lesson or area the live course does not have, or whose pace it does not keep`,
     wrong.slice(0, 6).join('; '))
}

console.log('\n=== Finding 2: the row, rendered ===')
{
  const view = ONOFF.onOffView({ scenario_id: 'C-a1b2c3', is_active: false,
    trigger_config: { all: [{ metric: 'lesson_shipped', lesson_id: 'l020', op: 'is_not' }] } }, LIVE.new, false)
  const html = renderToString(TemplateOnOff({ view, canEdit: true, busy: false, onToggle: () => {} }))
  ok(/<button type="button" disabled=""[^>]*>Turn on<\/button>/.test(html)
       && html.includes(OLD_COURSE_WORDS.replace(/'/g, '&#x27;')) && html.includes('This template is off.'),
     'an off template on l020 renders "This template is off.", Turn on not pressable, and the line beside it', html)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
