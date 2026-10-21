// csm-cutover.test.mjs: the CSM on both courses. Every row of the cutover
// PRD's Work Item 3 paths table.
//
// Parity: the OLD csm-triggers.ts is taken from git at BASE below (the commit
// Work Item 3 started from) and run side by side with the NEW one that
// build.mjs copied from src/. The old alert mapping lived in the cron route at
// BASE, so its function is lifted from there verbatim. Both copies get only
// their import lines rewritten, as build.mjs does.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BASE = '410e011' // HEAD when Work Item 3 started: the commit that added curriculum-reset.ts

// Admin rebuild 2 (D12) renamed one metric's words, on purpose: "Subscription
// status" became "Membership status". Every comparison with BASE puts the
// old words back first, so the parity still covers every other word.
const MEMBERSHIP_WORDS = {
  old: 'Subscription status',
  now: 'Membership status',
  back: (text) => (typeof text === 'string' ? text.split('Membership status').join('Subscription status') : text),
}
const asOldWords = (r) => (r && typeof r.summary === 'string' ? { ...r, summary: MEMBERSHIP_WORDS.back(r.summary) } : r)
// Its review fix round gave is_canceling one label: the TriggerBuilder's select took its sentence's words. Only the
// label moved (the sentences and the task summaries are BASE's), so only the label comparison puts it back.
const CANCELING_LABEL = { old: 'Is canceling (clicked cancel, still has access)', now: 'Is canceling (cancel scheduled)' }
const labelAsOld = (m, label) => (m === 'is_canceling' && label === CANCELING_LABEL.now ? CANCELING_LABEL.old : MEMBERSHIP_WORDS.back(label))

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const gitShow = (path) =>
  execFileSync('git', ['show', `${BASE}:${path}`], { cwd: here('..'), encoding: 'utf8' })

function takeOld(srcRel, outRel, rewrites) {
  let s = gitShow(srcRel)
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${srcRel}@${BASE} has no ${from}`)
    s = s.split(from).join(to)
  }
  if (s.includes('@/')) throw new Error(`an unrewritten @/ import remains in ${srcRel}@${BASE}`)
  fs.writeFileSync(here(outRel), s)
  console.log(`generated ${outRel} from ${srcRel} at ${BASE}`)
}

takeOld('src/lib/csm-triggers.ts', './_gen/csm-triggers.old.ts', [
  ['"@/types/database"', '"./types-erased.ts"'],
  ['from "@/lib/constants"', 'from "./constants.ts"'],
])
{
  const route = gitShow('src/app/api/cron/check-csm-tasks/route.ts')
  const start = route.indexOf('function pickExistingAlertScenario(')
  const end = route.indexOf('\n}\n', start)
  if (start < 0 || end < 0) throw new Error(`pickExistingAlertScenario not found in the route at ${BASE}`)
  fs.writeFileSync(here('./_gen/alert-map.old.ts'),
    `// Lifted verbatim from ${BASE}:src/app/api/cron/check-csm-tasks/route.ts\nexport ${route.slice(start, end + 3)}`)
  console.log(`generated ./_gen/alert-map.old.ts from the route at ${BASE}`)
}

const OLD = await import('./_gen/csm-triggers.old.ts')
const NEW = await import('./_gen/csm-triggers.ts')
const { pickExistingAlertScenario: oldPick } = await import('./_gen/alert-map.old.ts')
const { sprintDayNumber } = await import('./_gen/constants.ts')
const { getCurriculumResetAt, courseAnchorIso, daysOnCourse } = await import('./_gen/curriculum-reset.ts')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const DAY = 86_400_000
const HOUR = 3_600_000
const iso = (ms) => new Date(ms).toISOString()

// Canonical form for comparing values: Sets become sorted arrays, object keys
// sorted, so two snapshots compare by content.
const canon = (v) => {
  if (v instanceof Set) return [...v].sort()
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
  return v
}
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

// buildStudentSnapshot and sprintDayNumber read the clock themselves.
const realNow = Date.now
let NOW = 0
const at = (ms) => { NOW = ms; Date.now = () => NOW }

// ───────── The two catalogs ─────────

// The old course: 65 rows in r1..r4, 64 counting (l057 is not), the action
// lessons where the built-ins look for them (l018/l020 in r1, l022/l024/l049
// in r2), l078 in r4.
const OLD_LESSONS = []
{
  const push = (rid, ids) => ids.forEach((id) => OLD_LESSONS.push({
    id, region_id: rid,
    requires_action: ['l018', 'l020', 'l022', 'l024', 'l049'].includes(id),
    counts_toward_progress: id !== 'l057',
  }))
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `l${String(a + i).padStart(3, '0')}`)
  push('r1', range(1, 20).filter((id) => id !== 'l006' && id !== 'l012'))   // 18
  push('r2', [...range(21, 33), 'l046', 'l049'])                             // 15
  push('r3', [...range(50, 56), ...range(64, 72)])                           // 16
  push('r4', ['l057', ...range(73, 87)])                                     // 16
}
const OLD_REGIONS = ['r1', 'r2', 'r3', 'r4']

// The new course: 141 rows in a1..a8, 140 counting (a7l19, the pond row, is
// not), a few action lessons.
const NEW_SIZES = { a1: 18, a2: 18, a3: 17, a4: 18, a5: 18, a6: 17, a7: 19, a8: 16 }
const NEW_ACTIONS = new Set(['a1l05', 'a2l07', 'a3l10', 'a4l17', 'a6l03'])
const NEW_LESSONS = []
for (const [rid, n] of Object.entries(NEW_SIZES)) {
  for (let i = 1; i <= n; i++) {
    const id = `${rid}l${String(i).padStart(2, '0')}`
    NEW_LESSONS.push({ id, region_id: rid, requires_action: NEW_ACTIONS.has(id), counts_toward_progress: id !== 'a7l19' })
  }
}
const NEW_REGIONS = Object.keys(NEW_SIZES)

// The cron's two ways of building region totals: the old literal start
// ({ r1: 0, ... }) and Work Item 3's empty start.
const totalsOld = (lessons) => {
  const t = { r1: 0, r2: 0, r3: 0, r4: 0 }
  for (const l of lessons) t[l.region_id] = (t[l.region_id] ?? 0) + 1
  return t
}
const totalsNew = (lessons) => {
  const t = {}
  for (const l of lessons) t[l.region_id] = (t[l.region_id] ?? 0) + 1
  return t
}

// ───────── 14 fixture students ─────────

const idsOf = (rid, { actions = false } = {}) =>
  OLD_LESSONS.filter((l) => l.region_id === rid && l.requires_action === actions).map((l) => l.id)
const row = (lesson_id, { done = null, action = null, skip = null } = {}) => ({ lesson_id, done, action, skip })
const watch = (id, daysAgo) => row(id, { done: daysAgo })
const ship = (id, daysAgo) => row(id, { done: daysAgo, action: daysAgo })
const half = (id, daysAgo) => row(id, { done: daysAgo })
const skip = (id, daysAgo) => row(id, { skip: daysAgo })

const PROFILES = [
  { id: 'zero', rows: [] },
  { id: 'zero-never-logged-in', rows: [], noLogin: true },
  { id: 'r1-partial', rows: idsOf('r1').slice(0, 5).map((id, i) => watch(id, 1 + i)),
    tasks: [{ scenario_id: 'pace.day7', status: 'completed' }] },
  { id: 'r1-12-no-ship', rows: [...idsOf('r1').slice(0, 10).map((id) => watch(id, 4)), half('l018', 4), half('l020', 5)] },
  { id: 'r1-12-shipped', rows: [...idsOf('r1').slice(0, 10).map((id) => watch(id, 3)), ship('l018', 3), half('l020', 3)] },
  { id: 'r1-done-r2-6-no-ship', rows: [
    ...idsOf('r1').map((id) => watch(id, 6)), ship('l018', 6), ship('l020', 6),
    ...idsOf('r2').slice(0, 4).map((id) => watch(id, 2)), half('l022', 2), half('l024', 2)] },
  { id: 'r2-shipped', rows: [
    ...idsOf('r1').map((id) => watch(id, 8)), ship('l018', 8), ship('l020', 8),
    ...idsOf('r2').slice(0, 4).map((id) => watch(id, 1)), ship('l022', 1), half('l024', 1)] },
  { id: 'behind', rows: idsOf('r1').slice(0, 3).map((id, i) => watch(id, 9 + i)), lastActive: 6 },
  { id: 'all-done', rows: [
    ...OLD_LESSONS.map((l) => (l.requires_action ? ship(l.id, 0) : watch(l.id, 0))),
    watch('l999', 0), watch('a1l01', 0)] },
  { id: 'skipped-only', rows: idsOf('r1').slice(0, 8).map((id) => skip(id, 2)) },
  { id: 'half-done-actions', rows: ['l018', 'l020', 'l022', 'l024', 'l049'].map((id) => half(id, 5)), lastActive: 5 },
  { id: 'canceling', rows: idsOf('r1').slice(0, 5).map((id) => watch(id, 2)), canceling: true },
  { id: 'canceling-past-due', rows: [], canceling: true, status: 'past_due' },
  { id: 'no-first-paid', noFirstPaid: true, rows: [
    ...idsOf('r3').slice(0, 4).map((id) => watch(id, 3)), ...idsOf('r4').slice(1, 4).map((id) => watch(id, 3)), watch('l057', 1)],
    tasks: [{ scenario_id: 'nolessons.day3', status: 'open' }, { scenario_id: 'pace.day7', status: 'completed' }] },
]

/** One student on tenure day `day` at `now`: anchor 5 hours into Day `day`. */
function fixture(p, day, now, { firstPaidMs = now - (day - 1) * DAY - 5 * HOUR, idMap = null } = {}) {
  const ago = (d) => (d == null ? null : iso(now - d * DAY - 2 * HOUR))
  const student = {
    id: p.id, name: p.id,
    first_paid_at: p.noFirstPaid ? null : iso(firstPaidMs),
    joined_at: p.noFirstPaid ? iso(firstPaidMs) : iso(Math.max(firstPaidMs, now - 2 * DAY)),
    membership_status: p.status ?? 'active',
    last_active_at: iso(now - (p.lastActive ?? 1) * DAY - HOUR),
    cancel_scheduled_at: p.canceling ? iso(now - DAY) : null,
  }
  const completions = p.rows.map((r) => ({
    student_id: p.id,
    lesson_id: idMap ? (idMap.get(r.lesson_id) ?? r.lesson_id) : r.lesson_id,
    completed_at: ago(r.done), action_completed_at: ago(r.action), skipped_at: ago(r.skip),
  }))
  const tasks = (p.tasks ?? []).map((t) => ({ student_id: p.id, ...t }))
  const milestones = p.noLogin ? null : { first_sprint_login_at: iso(firstPaidMs + HOUR) }
  return { student, completions, tasks, milestones }
}

// The route's built-in loop: in insertion order, each match added to
// recentTaskScenarios so later triggers see it (route.ts section 2a).
const routeLoop = (mod, snap) => {
  const out = []
  for (const [id, check] of Object.entries(mod.triggers)) {
    const r = check(snap)
    if (!r) continue
    out.push([id, r])
    snap.recentTaskScenarios.add(id)
  }
  return out
}

const OPS = ['is', 'is_not', 'at_least', 'more_than', 'at_most', 'less_than']
function conditions(regionIds, lessonIds) {
  const out = []
  for (const metric of ['day_number', 'total_lessons_watched', 'days_since_last_completion', 'days_since_last_login', 'progress_ratio'])
    for (const op of OPS) for (const value of [0, 0.5, 0.85, 1, 3, 4, 5, 7, 10, 14, 30, 999]) out.push({ metric, op, value })
  for (const metric of ['region_lessons_watched', 'region_completion_pct'])
    for (const region of regionIds) for (const op of OPS) for (const value of [0, 1, 5, 10, 50, 100]) out.push({ metric, region, op, value })
  for (const region of regionIds) for (const op of ['is', 'is_not']) out.push({ metric: 'region_complete', region, op })
  for (const metric of ['lesson_shipped', 'lesson_watched'])
    for (const lesson_id of lessonIds) for (const op of ['is', 'is_not']) out.push({ metric, lesson_id, op })
  for (const value of ['active', 'canceled', 'past_due', 'expired']) for (const op of ['is', 'is_not']) out.push({ metric: 'membership_status', op, value })
  for (const metric of ['progress_label', 'region_pace'])
    for (const value of ['behind', 'on_pace', 'ahead']) for (const op of ['is', 'is_not']) out.push({ metric, op, value })
  for (const metric of ['has_logged_into_app', 'is_canceling']) for (const op of ['is', 'is_not']) out.push({ metric, op })
  return out
}
const OLD_CONDS = conditions([...OLD_REGIONS, 'r9'], ['l001', 'l018', 'l020', 'l022', 'l024', 'l049', 'l057', 'l078', 'l999'])
const configsFrom = (conds) => [
  ...conds.map((c) => ({ all: [c] })),
  { all: [] },
  {},
  { all: [{ metric: 'is_canceling', op: 'is' }, { metric: 'day_number', op: 'at_least', value: 1 }] },
  { all: [{ metric: 'region_lessons_watched', region: 'r1', op: 'at_least', value: 10 },
          { metric: 'lesson_shipped', lesson_id: 'l018', op: 'is_not' }, { metric: 'day_number', op: 'at_least', value: 7 }] },
  { all: [{ metric: 'days_since_last_completion', op: 'at_least', value: 3 }, { metric: 'has_logged_into_app', op: 'is' }] },
  { all: [{ metric: 'progress_label', op: 'is', value: 'behind' }, { metric: 'total_lessons_watched', op: 'at_least', value: 1 }] },
]
const OLD_CONFIGS = configsFrom(OLD_CONDS)
const ALERTS = [['no_lessons_3d', 'X still hasn\'t started (Day 3)'], ['no_tasks_7d', 'X has never completed any lessons'],
                ['no_login_5d', 'no platform login in 5 days'], ['no_lessons_7d', 'no lessons completed in 7 days'], ['other', 'other']]

// ════════════════════════════════════════════════════════════════════
console.log(`\n=== Old course, no reset: parity with ${BASE} (14 students × days 1 to 30) ===`)
{
  const BASE_NOW = Date.parse('2026-10-14T21:40:00.000Z')
  let cases = 0, comparisons = 0
  const diffs = []
  const note = (what) => { if (diffs.length < 12) diffs.push(what) }
  for (const p of PROFILES) {
    for (let day = 1; day <= 30; day++) {
      const now = BASE_NOW + day * 7 * HOUR // walk the clock too, so every case sits at another hour
      at(now)
      const f = fixture(p, day, now)
      const build = (mod, totals, ...course) => mod.buildStudentSnapshot(
        f.student, f.completions, OLD_LESSONS, totals, f.tasks, f.milestones, ...course)
      const oldSnap = build(OLD, totalsOld(OLD_LESSONS))
      // The default course (no argument), and the route's way: regions read
      // as r1..r4, totals from an empty start, the reset read as null.
      const variants = [
        ['no course argument', () => build(NEW, totalsOld(OLD_LESSONS))],
        ['the cron\'s course', () => build(NEW, totalsNew(OLD_LESSONS), { regionOrder: OLD_REGIONS, resetAt: null })],
      ]
      cases++
      for (const [vlabel, mk] of variants) {
        const newSnap = mk()
        // every old snapshot field
        for (const k of Object.keys(oldSnap)) {
          comparisons++
          if (!eq(oldSnap[k], newSnap[k])) note(`${p.id} day ${day} ${vlabel}: field ${k} ${JSON.stringify(canon(oldSnap[k]))} vs ${JSON.stringify(canon(newSnap[k]))}`)
        }
        comparisons++
        if (Object.keys(newSnap.regions).join() !== Object.keys(oldSnap.regions).join()) note(`${p.id} day ${day}: region key order`)
        // the new fields hold the old values on the old course
        comparisons++
        if (newSnap.courseIsNew !== false || newSnap.dayOnCourse !== oldSnap.day) note(`${p.id} day ${day}: dayOnCourse ${newSnap.dayOnCourse} vs day ${oldSnap.day}`)
        // every trigger, alone
        for (const id of Object.keys(OLD.triggers)) {
          comparisons++
          const a = OLD.triggers[id](oldSnap), b = NEW.triggers[id](newSnap)
          if (a !== b) note(`${p.id} day ${day} ${vlabel}: ${id} ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
        }
        // every DSL condition over every metric, and its words (admin rebuild
        // 2's one rename, MEMBERSHIP_WORDS below, put back for the comparison)
        for (const cfg of OLD_CONFIGS) {
          comparisons++
          const a = OLD.evaluateCustomTrigger(oldSnap, cfg), b = asOldWords(NEW.evaluateCustomTrigger(newSnap, cfg))
          if (!eq(a, b)) note(`${p.id} day ${day} ${vlabel}: ${JSON.stringify(cfg)} ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
        }
        // the alert mapping: old = the route at BASE (pickExistingAlertScenario
        // lifted verbatim, then its lines 436-445: the 0.6 progress gate and
        // the summary), new = alertTask
        for (const [type, label] of ALERTS) {
          comparisons++
          const day0 = sprintDayNumber(f.student.first_paid_at ?? f.student.joined_at)
          const sid = oldPick(type, day0)
          const a = !sid || oldSnap.progressRatio >= 0.6 ? null
            : { scenarioId: sid, summary: `Day ${day0} · ${label} · pace ${oldSnap.progressRatio.toFixed(2)}.` }
          const b = NEW.alertTask(type, label, newSnap)
          if (!eq(a, b)) note(`${p.id} day ${day} ${vlabel}: alert ${type} ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
          comparisons++
          if (NEW.pickExistingAlertScenario(type, newSnap) !== sid) note(`${p.id} day ${day}: pick ${type}`)
        }
        comparisons++
        if (OLD.snapshotIsCanceling(oldSnap) !== NEW.snapshotIsCanceling(newSnap)) note(`${p.id} day ${day}: canceling`)
      }
      // the route's chained loop, on fresh snapshots (it mutates them)
      comparisons++
      const a = routeLoop(OLD, build(OLD, totalsOld(OLD_LESSONS)))
      const b = routeLoop(NEW, build(NEW, totalsNew(OLD_LESSONS), { regionOrder: OLD_REGIONS, resetAt: null }))
      if (!eq(a, b)) note(`${p.id} day ${day}: route loop ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
    }
  }
  ok(PROFILES.length === 14, '14 fixture students', PROFILES.map((p) => p.id).join(', '))
  ok(diffs.length === 0, `old and new identical on every case`, `${cases} student-days, ${comparisons} comparisons, ${diffs.length} differences`)
  diffs.forEach((d) => console.log('        ' + d))

  // The fixtures exercise every built-in on the old course (or the parity
  // above proves nothing about it).
  const fired = new Set()
  for (const p of PROFILES) for (let day = 1; day <= 30; day++) {
    const now = BASE_NOW + day * 7 * HOUR; at(now)
    const f = fixture(p, day, now)
    const s = OLD.buildStudentSnapshot(f.student, f.completions, OLD_LESSONS, totalsOld(OLD_LESSONS), [], f.milestones)
    for (const [id, check] of Object.entries(OLD.triggers)) if (check(s)) fired.add(id)
  }
  ok(Object.keys(OLD.triggers).every((id) => fired.has(id)), 'every built-in fires for some fixture on the old course', [...fired].sort().join(', '))

  // Shared tables and the UI summary are untouched.
  ok(eq(OLD.SCENARIO_BUCKET, NEW.SCENARIO_BUCKET) && eq(OLD.REGION_LABEL, NEW.REGION_LABEL) && eq(OLD.ACTION_LESSONS, NEW.ACTION_LESSONS),
     'SCENARIO_BUCKET, REGION_LABEL, ACTION_LESSONS identical')
  ok(Object.keys(OLD.METRICS).join() === Object.keys(NEW.METRICS).join() &&
     Object.keys(OLD.METRICS).every((m) => OLD.METRICS[m].label === labelAsOld(m, NEW.METRICS[m].label) && OLD.METRICS[m].input === NEW.METRICS[m].input),
     'METRICS: same ids, labels and inputs (with membership_status renamed, and is_canceling\'s label in its sentence\'s words)')
  ok(OLD.METRICS.is_canceling.label === CANCELING_LABEL.old && NEW.METRICS.is_canceling.label === CANCELING_LABEL.now
       && NEW.METRICS.is_canceling.describe({ metric: 'is_canceling', op: 'is' }) === CANCELING_LABEL.now,
     'the review\'s fix round: is_canceling has one label, the select\'s words the same as its sentence\'s')
  ok(OLD.METRICS.membership_status.label === MEMBERSHIP_WORDS.old && NEW.METRICS.membership_status.label === MEMBERSHIP_WORDS.now
       && NEW.METRICS.membership_status.describe({ metric: 'membership_status', op: 'is', value: 'active' }) === 'Membership status is active',
     'admin rebuild 2 (D12): the membership_status metric reads "Membership status", in the TriggerBuilder and in the summaries, where it read "Subscription status"')
  let describeDiffs = 0
  for (const c of OLD_CONDS) if (OLD.METRICS[c.metric].describe(c) !== MEMBERSHIP_WORDS.back(NEW.METRICS[c.metric].describe(c))) describeDiffs++
  ok(describeDiffs === 0, 'every condition is described in the same words (with membership_status renamed)', `${OLD_CONDS.length} conditions (r1..r4 and an unknown r9)`)
  let paceDiffs = 0, paceCases = 0
  for (let d = 0; d < 40; d++) for (const done of [0, 1, 10, 32, 64]) for (const r of OLD_REGIONS) {
    paceCases++
    at(BASE_NOW)
    if (!eq(OLD.buildPaceSummary(iso(BASE_NOW - d * DAY - HOUR), done, 64, r), NEW.buildPaceSummary(iso(BASE_NOW - d * DAY - HOUR), done, 64, r))) paceDiffs++
  }
  ok(paceDiffs === 0, 'buildPaceSummary identical (the admin pages\' pills)', `${paceCases} cases`)

  // check-engagement: the day the two "never completed" branches use. Old =
  // the inline formula at BASE (check-engagement/route.ts:143-148).
  let engDiffs = 0
  for (const p of PROFILES) for (let day = 1; day <= 30; day++) {
    const now = BASE_NOW + day * 7 * HOUR
    const s = fixture(p, day, now).student
    const old = Math.max(1, Math.ceil((now - new Date(s.first_paid_at ?? s.joined_at).getTime()) / 86400000))
    if (daysOnCourse(courseAnchorIso(s.first_paid_at ?? null, s.joined_at, null), now) !== old) engDiffs++
  }
  ok(engDiffs === 0, 'check-engagement: the day is the old formula when there is no reset', `${PROFILES.length * 30} student-days`)
}

// ════════════════════════════════════════════════════════════════════
const RESET = '2026-10-20T18:30:00.000Z'
const RESET_MS = Date.parse(RESET)
const NEW_COURSE = { regionOrder: NEW_REGIONS, resetAt: RESET }
const ID_MAP = new Map(OLD_LESSONS.map((l, i) => [l.id, NEW_LESSONS[i].id]))
const buildNew = (f, lessons = NEW_LESSONS, course = NEW_COURSE) =>
  NEW.buildStudentSnapshot(f.student, f.completions, lessons, totalsNew(lessons), f.tasks, f.milestones, course)
const CLOCK = ['noship.r1.day7', 'noship.r2.day14', 'pace.day7', 'pace.day14', 'pace.day21']

console.log('\n=== New course, no crash: a1..a8, reset set ===')
{
  const NEW_CONDS = conditions([...NEW_REGIONS, ...OLD_REGIONS], ['a1l05', 'a4l17', 'a7l19', 'l018', 'l078'])
  const NEW_CONFIGS = configsFrom(NEW_CONDS)
  let runs = 0, crashes = 0, clockFired = 0
  const firstCrash = []
  // tenure days 1..30 at three places around the reset: paid long before it,
  // paid just before it, paid after it.
  for (const p of PROFILES) for (let day = 1; day <= 30; day++) for (const shift of [-25, -2, +3]) {
    const now = RESET_MS + Math.max(0, shift) * DAY + day * DAY + 4 * HOUR
    const firstPaidMs = shift < 0 ? RESET_MS + shift * DAY : now - (day - 1) * DAY - 5 * HOUR
    at(now)
    // completions on the new ids (the old ids mapped by position), plus the
    // raw old ids a stale row could still carry
    for (const idMap of [ID_MAP, null]) {
      try {
        const f = fixture(p, day, now, { firstPaidMs, idMap })
        const snap = buildNew(f)
        for (const id of Object.keys(NEW.triggers)) {
          const r = NEW.triggers[id](snap)
          if (CLOCK.includes(id) && r !== null) clockFired++
        }
        for (const cfg of NEW_CONFIGS) NEW.evaluateCustomTrigger(snap, cfg)
        for (const [type, label] of ALERTS) NEW.alertTask(type, label, snap)
        routeLoop(NEW, buildNew(f))
        runs++
      } catch (e) {
        crashes++
        if (!firstCrash.length) firstCrash.push(`${p.id} day ${day}: ${e.message}`)
      }
    }
  }
  ok(crashes === 0, 'snapshot, every trigger, every DSL condition and every alert run without a throw',
     `${runs} runs, ${NEW_CONFIGS.length} configs each${firstCrash.length ? `; first: ${firstCrash[0]}` : ''}`)

  console.log('\n=== Clock built-ins on the new course ===')
  ok(clockFired === 0, 'noship.r1.day7, noship.r2.day14, pace.day7/14/21 return null for every fixture', `${runs} runs`)
  // The guard is the reset, not the missing r1: with the reset set and the
  // OLD catalog still in place, the five stay null where the old code fires.
  let firedWithoutReset = 0, firedWithReset = 0
  for (const p of PROFILES) for (let day = 1; day <= 30; day++) {
    const now = RESET_MS + day * DAY; at(now)
    const f = fixture(p, day, now)
    const before = NEW.buildStudentSnapshot(f.student, f.completions, OLD_LESSONS, totalsNew(OLD_LESSONS), [], f.milestones)
    const after = NEW.buildStudentSnapshot(f.student, f.completions, OLD_LESSONS, totalsNew(OLD_LESSONS), [], f.milestones,
      { regionOrder: OLD_REGIONS, resetAt: iso(now - 40 * DAY) })
    for (const id of CLOCK) { if (NEW.triggers[id](before)) firedWithoutReset++; if (NEW.triggers[id](after)) firedWithReset++ }
  }
  ok(firedWithoutReset > 0 && firedWithReset === 0, 'the reset alone silences them (old regions kept)',
     `${firedWithoutReset} fire with no reset, ${firedWithReset} with one`)
}

console.log('\n=== nolessons on course days: paid 20 days before the reset, logged in, 0 new lessons ===')
{
  const p = { id: 'paid-before', rows: [] }
  const firstPaidMs = RESET_MS - 20 * DAY
  const expect = {
    1: {},
    3: { 'nolessons.day3': 'Day 3 · 0 lessons watched, 0 actions shipped.' },
    4: { 'nolessons.day3': 'Day 4 · 0 lessons watched, 0 actions shipped.' },
    5: {},
    7: { 'nolessons.day7': 'Day 7 · full week in, still 0 lessons watched.' },
  }
  for (const [k, want] of Object.entries(expect)) {
    const now = RESET_MS + (Number(k) - 0.5) * DAY
    at(now)
    const snap = buildNew(fixture(p, 1, now, { firstPaidMs }))
    const got = Object.fromEntries(routeLoop(NEW, snap))
    ok(eq(got, want) && snap.dayOnCourse === Number(k) && snap.day === sprintDayNumber(iso(firstPaidMs)),
       `course day ${k} (tenure day ${snap.day})`, JSON.stringify(got))
  }
  // A completion since the switch stops it, as on the old course.
  const now = RESET_MS + 2.5 * DAY; at(now)
  const snap = buildNew(fixture({ id: 'x', rows: [watch('l001', 1)] }, 1, now, { firstPaidMs, idMap: ID_MAP }))
  ok(NEW.triggers['nolessons.day3'](snap) === null, 'course day 3 with 1 lesson since the switch: none')
}

console.log('\n=== day_number on course days after the reset ===')
{
  const firstPaidMs = RESET_MS - 20 * DAY
  const dn = (s, op, value) => NEW.evaluateCustomTrigger(s, { all: [{ metric: 'day_number', op, value }] })
  // The template the morning review's Q1 names: day at least 5 and 0 lessons.
  const q1 = { all: [{ metric: 'day_number', op: 'at_least', value: 5 }, { metric: 'total_lessons_watched', op: 'is', value: 0 }] }
  {
    const now = RESET_MS + 0.5 * DAY; at(now)
    const s = buildNew(fixture({ id: 'paid-20-before', rows: [] }, 1, now, { firstPaidMs }))
    ok(s.day === 21 && dn(s, 'is', 1).match && !dn(s, 'at_least', 2).match && dn(s, 'is', 1).summary === 'Day in the program is 1',
       'paid 20 days before the switch, on its evening: day_number is 1 (tenure day 21)', `day ${s.day}, course day ${s.dayOnCourse}`)
    ok(!NEW.evaluateCustomTrigger(s, q1).match, 'day at least 5 with 0 lessons does not fire for that student on the evening')
  }
  {
    const now = RESET_MS + 4.5 * DAY; at(now)
    const s = buildNew(fixture({ id: 'paid-20-before', rows: [] }, 1, now, { firstPaidMs }))
    ok(s.dayOnCourse === 5 && dn(s, 'is', 5).match && NEW.evaluateCustomTrigger(s, q1).match,
       '...and fires on course day 5 with no lesson since the switch', NEW.evaluateCustomTrigger(s, q1).summary)
  }
  {
    const paidAfter = RESET_MS + 2 * DAY + 3 * HOUR
    const now = paidAfter + 6.5 * DAY; at(now)
    const s = buildNew(fixture({ id: 'paid-after', rows: [] }, 7, now, { firstPaidMs: paidAfter }))
    ok(s.day === 7 && dn(s, 'is', 7).match, 'paid after the switch: day_number is the day since payment, as before', `day ${s.day}`)
  }
}

console.log('\n=== A student who paid after the reset: the old rule ===')
{
  const p = { id: 'paid-after', rows: [] }
  const firstPaidMs = RESET_MS + 2 * DAY + 3 * HOUR
  for (const d of [3, 7]) {
    const now = firstPaidMs + (d - 0.5) * DAY
    at(now)
    const f = fixture(p, d, now, { firstPaidMs })
    const fresh = buildNew(f)
    const old = OLD.buildStudentSnapshot(f.student, f.completions, OLD_LESSONS, totalsOld(OLD_LESSONS), f.tasks, f.milestones)
    const got = routeLoop(NEW, fresh), want = routeLoop(OLD, old)
    ok(eq(got, want) && got.length === 1 && got[0][0] === `nolessons.day${d}` && fresh.dayOnCourse === d,
       `day ${d}`, JSON.stringify(got))
  }
}

console.log('\n=== DSL on the new course ===')
{
  const firstPaidMs = RESET_MS - 20 * DAY
  const now = RESET_MS + 4.5 * DAY; at(now)
  const a3 = NEW_LESSONS.filter((l) => l.region_id === 'a3')
  const allA3 = { id: 'a3-done', rows: a3.map((l) => (l.requires_action ? ship(l.id, 1) : watch(l.id, 1))) }
  const snaps = [buildNew(fixture({ id: 'none', rows: [] }, 1, now, { firstPaidMs })), buildNew(fixture(allA3, 1, now, { firstPaidMs }))]
  let matched = 0, checked = 0
  for (const s of snaps) for (const metric of ['progress_ratio', 'progress_label', 'region_pace']) {
    for (const c of conditions(NEW_REGIONS, []).filter((c) => c.metric === metric)) {
      checked++
      if (NEW.evaluateCustomTrigger(s, { all: [c] }).match) matched++
    }
  }
  ok(checked > 0 && matched === 0, 'progress_ratio, progress_label, region_pace: no match for any op or value', `${checked} conditions`)
  // On the old course the same conditions do match somewhere (else the line above proves nothing).
  at(now)
  const oldS = NEW.buildStudentSnapshot(fixture({ id: 'none', rows: [] }, 9, now).student, [], OLD_LESSONS, totalsNew(OLD_LESSONS), [],
    { first_sprint_login_at: iso(now - DAY) })
  ok(['progress_ratio', 'progress_label', 'region_pace'].every((m) =>
    conditions(OLD_REGIONS, []).some((c) => c.metric === m && NEW.evaluateCustomTrigger(oldS, { all: [c] }).match)),
     'control: on the old course each of the three matches some condition')

  const none = snaps[0]
  const dslc = (s, op, value) => NEW.evaluateCustomTrigger(s, { all: [{ metric: 'days_since_last_completion', op, value }] }).match
  ok(none.daysSinceLastCompletion === null && none.daysSinceCourseStart === 4 && dslc(none, 'is', 4) && !dslc(none, 'is', 999),
     'days_since_last_completion with nothing since the reset: days since the anchor (the reset)', `${none.daysSinceCourseStart}`)
  {
    const paidAfter = RESET_MS + 1 * DAY
    const s = buildNew(fixture({ id: 'after', rows: [] }, 1, now, { firstPaidMs: paidAfter }))
    ok(s.daysSinceCourseStart === 3 && dslc(s, 'is', 3), 'the same for a student who paid after the reset: days since first payment', `${s.daysSinceCourseStart}`)
  }
  {
    at(now)
    const s = NEW.buildStudentSnapshot(fixture({ id: 'none', rows: [] }, 9, now).student, [], OLD_LESSONS, totalsNew(OLD_LESSONS), [], null)
    ok(dslc(s, 'is', 999), 'with no reset, no lesson still reads 999, as before')
  }
  {
    const s = buildNew(fixture({ id: 'one', rows: [watch('a1l01', 2)] }, 1, now, { firstPaidMs }))
    ok(dslc(s, 'is', 2), 'a lesson since the reset: days since it', `${s.daysSinceLastCompletion}`)
  }

  const rc = (s, op) => NEW.evaluateCustomTrigger(s, { all: [{ metric: 'region_complete', region: 'a3', op }] })
  ok(rc(snaps[1], 'is').match && !rc(snaps[1], 'is_not').match && rc(snaps[1], 'is').summary === 'Area 3 is complete',
     'region_complete on a3 when every a3 lesson is done: true, described as Area 3', rc(snaps[1], 'is').summary)
  {
    const missing = buildNew(fixture({ id: 'a3-but-one', rows: allA3.rows.slice(1) }, 1, now, { firstPaidMs }))
    ok(!rc(missing, 'is').match && !rc(snaps[0], 'is').match && rc(snaps[0], 'is_not').match, 'one a3 lesson missing, or none done: false')
  }
  ok(NEW.regionLabel('r2') === 'Region 2 (Production)' && NEW.regionLabel('a8') === 'Area 8' && NEW.regionLabel('x1') === 'x1',
     'regionLabel: the old label, Area N, else the id')
}

console.log('\n=== Activity ===')
{
  const now = RESET_MS + 30 * DAY; at(now)
  const firstPaidMs = RESET_MS - 5 * DAY
  const snapWith = (completions) => {
    const f = fixture({ id: 'act', rows: [] }, 1, now, { firstPaidMs })
    return NEW.buildStudentSnapshot(f.student, completions, NEW_LESSONS, totalsNew(NEW_LESSONS), [], f.milestones, NEW_COURSE)
  }
  const c = (lesson_id, { done = null, action = null, skip = null } = {}) =>
    ({ student_id: 'act', lesson_id, completed_at: done, action_completed_at: action, skipped_at: skip })
  const agoD = (d) => iso(now - d * DAY)
  const got = [0, 2, 3, 8].map((d) => snapWith([c('a2l01', { done: agoD(d) })]).activity)
  got.push(snapWith([]).activity)
  ok(eq(got, ['moving', 'moving', 'slipping', 'stalled', 'not_started']), '0, 2, 3, 8 days, none', got.join(', '))

  const s1 = snapWith([c('a1l05', { done: agoD(1) }), c('a7l19', { done: agoD(0) }), c('a2l02', { skip: agoD(0) }), c('a2l03', { done: agoD(9) })])
  ok(s1.lastCountedCompletionAt === agoD(9) && s1.activity === 'stalled',
     'the view\'s rule: a half-done action lesson (1 day), the pond row and a skip without completed_at (today) do not count; the plain lesson 9 days ago is the last: stalled',
     `last counted ${s1.lastCountedCompletionAt}`)
  ok(snapWith([c('a1l05', { done: agoD(1), action: agoD(1) })]).activity === 'moving', 'an action lesson counts once shipped')
  {
    const shippedLater = snapWith([c('a1l05', { done: agoD(9), action: agoD(1) })])
    ok(shippedLater.lastCountedCompletionAt === agoD(1) && shippedLater.activity === 'moving',
       'watched 9 days ago, shipped yesterday: the shipping is the last activity (the view takes the later of the two, F5)',
       `last counted ${shippedLater.lastCountedCompletionAt}`)
  }
  ok(snapWith([c('a2l04', { done: agoD(1), skip: agoD(1) })]).activity === 'moving', 'a skipped row that also has completed_at counts (lesson_is_complete)')
  ok(snapWith([c('a7l19', { done: agoD(0) })]).activity === 'not_started', 'only the pond row: not started')
  at(now)
  const oldCourse = NEW.buildStudentSnapshot(fixture({ id: 'o', rows: [] }, 5, now).student,
    [c('l057', { done: agoD(0) }), c('l002', { done: agoD(4) })], OLD_LESSONS, totalsNew(OLD_LESSONS), [], null)
  ok(oldCourse.lastCountedCompletionAt === agoD(4) && oldCourse.activity === 'slipping', 'old course: l057 does not count either')
}

console.log('\n=== Alert mapping on the new course ===')
{
  const firstPaidMs = RESET_MS - 20 * DAY
  const five = NEW_LESSONS.filter((l) => !l.requires_action && l.counts_toward_progress).slice(0, 5)
  const at3 = RESET_MS + 2.5 * DAY; at(at3)
  const zero = buildNew(fixture({ id: 'z', rows: [] }, 1, at3, { firstPaidMs }))
  const fiveDone = buildNew(fixture({ id: 'f', rows: five.map((l) => watch(l.id, 1)) }, 1, at3, { firstPaidMs }))
  const halfOnly = buildNew(fixture({ id: 'h', rows: [half('a1l05', 1)] }, 1, at3, { firstPaidMs }))
  const t = (type, s) => NEW.alertTask(type, 'L', s)
  ok(eq(t('no_lessons_3d', zero), { scenarioId: 'nolessons.day3', summary: 'Day 3 · L.' }),
     'no_lessons_3d with 0 counted lessons: nolessons.day3, no pace in the summary', JSON.stringify(t('no_lessons_3d', zero)))
  ok(fiveDone.completedLessons === 5 && t('no_lessons_3d', fiveDone) === null, 'no_lessons_3d with 5 counted lessons: none')
  ok(t('no_tasks_7d', zero) === null && t('no_tasks_7d', fiveDone) === null, 'no_tasks_7d: none')
  ok(t('no_login_5d', zero) === null && t('no_login_5d', fiveDone) === null, 'no_login_5d: none')
  ok(halfOnly.completedLessons === 0 && t('no_lessons_3d', halfOnly)?.scenarioId === 'nolessons.day3',
     'a half-done action lesson is 0 counted lessons: still nolessons.day3')
  const tiers = [8, 15, 18].map((k) => {
    const now = RESET_MS + (k - 0.5) * DAY; at(now)
    return t('no_lessons_3d', buildNew(fixture({ id: 'z', rows: [] }, 1, now, { firstPaidMs })))?.scenarioId ?? null
  })
  ok(eq(tiers, ['nolessons.day7', 'nolessons.day14', null]), 'the tiers count course days: day 8, 15, 18', tiers.join(', '))
}

console.log('\n=== The reset read fails ===')
{
  const stub = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'connection reset' } }) }) }) }) }
  let threw = null
  try { await getCurriculumResetAt(stub) } catch (e) { threw = e.message }
  ok(threw !== null, 'getCurriculumResetAt throws; the crons catch it into cron_runs as failed (by review)', threw ?? 'returned')
}

Date.now = realNow

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
