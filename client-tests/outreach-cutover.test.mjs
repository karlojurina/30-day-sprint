// outreach-cutover.test.mjs: the outreach numbers on /admin/tasks/insights and
// the strip on /admin/templates (src/lib/outreach-insights.ts) across the
// course switch. backend_readiness.md section 5, item 25.
//
// Before the switch nothing changes: the module as it stood at BASE is taken
// from git and run beside the new one on the same stand-in database, with no
// curriculum_reset_at row, on a hand-built history and on 40 random ones at 3
// ranges each. Every number must match, the reads must be the same apart from
// the one read of the switch, and the new fields must say "no switch".
//
// After the switch: the stand-in database is turned into what v104 leaves
// (completions emptied, first-login stamps from the earliest completion), and
// the old module's regrades are shown before the new one's answer is checked.
//
// The new copy is made here rather than in build.mjs, as csm-cutover.test.mjs
// makes its old ones: only import lines are rewritten, and a copy that still
// holds an @/ import stops the run.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BASE = 'd5a7c56' // HEAD when the outreach fix started (map review wave 3)

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const gitShow = (path) =>
  execFileSync('git', ['show', `${BASE}:${path}`], { cwd: here('..'), encoding: 'utf8' })

function write(text, srcLabel, outRel, rewrites) {
  let s = text
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${srcLabel} has no ${from}`)
    s = s.split(from).join(to)
  }
  if (s.includes('@/')) throw new Error(`an unrewritten @/ import remains in ${srcLabel}`)
  fs.writeFileSync(here(outRel), s)
  console.log(`generated ${outRel} from ${srcLabel}`)
}
const fromSrc = (srcRel) => fs.readFileSync(here(`../${srcRel}`), 'utf8')

// supabase-pagination.ts and curriculum-reset.ts have no runtime imports.
write(fromSrc('src/lib/supabase-pagination.ts'), 'src/lib/supabase-pagination.ts', './_gen/supabase-pagination.ts', [])
write(fromSrc('src/lib/curriculum-reset.ts'), 'src/lib/curriculum-reset.ts', './_gen/curriculum-reset.ts', [])
// The type import names an @/ path: the line goes, and --experimental-strip-types
// erases the name where it is used.
const TYPE_LINE = 'import type { TriggerConfig } from "@/types/database";\n'
write(fromSrc('src/lib/outreach-insights.ts'), 'src/lib/outreach-insights.ts', './_gen/outreach-insights.ts', [
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  [TYPE_LINE, ''],
])
write(gitShow('src/lib/outreach-insights.ts'), `src/lib/outreach-insights.ts@${BASE}`, './_gen/outreach-insights.old.ts', [
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  [TYPE_LINE, ''],
])

const OLD = await import('./_gen/outreach-insights.old.ts')
const NEW = await import('./_gen/outreach-insights.ts')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
  return v
}
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

const H = 3_600_000
const D = 24 * H
const iso = (ms) => new Date(ms).toISOString()
const SWITCH = Date.UTC(2026, 9, 20, 18, 30) // 20 October 2026, 18:30 UTC
const RESET_ROW = { key: 'curriculum_reset_at', value: iso(SWITCH), description: 'Set by migration 2026_v104' }

// ── The stand-in database ───────────────────────────────────────────────────
// Answers the calls computeOutreachInsights and getCurriculumResetAt make, the
// way PostgREST would where the code depends on it: a select hands back only
// the columns it names (a missing one is an error), order sorts, range pages,
// in / not-is-null / eq filter, or() takes the "col.gte.value,col.gte.value"
// form the module writes, maybeSingle gives null for no row. Every query is
// recorded as the list of calls made on it.
function parseOr(expr) {
  const parts = expr.split(',').map((p) => {
    const i = p.indexOf('.')
    const j = p.indexOf('.', i + 1)
    const col = p.slice(0, i)
    const op = p.slice(i + 1, j)
    const val = p.slice(j + 1)
    if (op !== 'gte') throw new Error(`the stand-in knows only gte inside or(), got ${op}`)
    return (r) => r[col] != null && Date.parse(r[col]) >= Date.parse(val)
  })
  return (r) => parts.some((f) => f(r))
}

function db(tables, errors = {}) {
  const reads = []
  return {
    reads,
    from(table) {
      const q = { table, cols: '*', steps: [], filters: [], orderBy: null }
      reads.push(q)
      const run = () => {
        if (errors[table]) return { data: null, error: errors[table] }
        let rows = (tables[table] ?? []).filter((r) => q.filters.every((f) => f(r)))
        if (q.orderBy) {
          const c = q.orderBy
          rows = [...rows].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0))
        }
        if (q.cols === '*') return { data: rows.map((r) => ({ ...r })), error: null }
        const cols = q.cols.split(',').map((c) => c.trim())
        for (const r of rows) {
          const missing = cols.find((c) => !(c in r))
          if (missing) return { data: null, error: { message: `column ${table}.${missing} does not exist` } }
        }
        return { data: rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), error: null }
      }
      const b = {
        select(cols = '*') { q.cols = cols; q.steps.push(['select', cols]); return b },
        order(c) { q.orderBy = c; q.steps.push(['order', c]); return b },
        eq(c, v) { q.filters.push((r) => r[c] === v); q.steps.push(['eq', c, v]); return b },
        in(c, vs) { q.filters.push((r) => vs.includes(r[c])); q.steps.push(['in', c, [...vs]]); return b },
        not(c, op, v) {
          if (op !== 'is' || v !== null) throw new Error(`the stand-in knows only not(col, "is", null), got ${op} ${v}`)
          q.filters.push((r) => r[c] != null); q.steps.push(['not', c, op, v]); return b
        },
        or(expr) { q.filters.push(parseOr(expr)); q.steps.push(['or', expr]); return b },
        range(from, to) {
          q.steps.push(['range', from, to])
          const r = run()
          return Promise.resolve(r.error ? r : { data: r.data.slice(from, to + 1), error: null })
        },
        maybeSingle() {
          q.steps.push(['maybeSingle'])
          const r = run()
          if (r.error) return Promise.resolve(r)
          if (r.data.length > 1) return Promise.resolve({ data: null, error: { message: 'more than one row' } })
          return Promise.resolve({ data: r.data[0] ?? null, error: null })
        },
        then(res, rej) { return Promise.resolve(run()).then(res, rej) },
      }
      return b
    },
  }
}

// ── A hand-built history: every family, before and after the switch ────────

const TPL = [
  { id: 't-stalled', scenario_id: 'stalled.discord.d3', title: 'Stalled', bucket: 'at_risk', is_admin_only: false, trigger_config: { all: [] } },
  { id: 't-nolessons', scenario_id: 'nolessons.day3', title: 'No lessons', bucket: 'at_risk', is_admin_only: false, trigger_config: { all: [] } },
  { id: 't-noship', scenario_id: 'noship.day5', title: 'No ship', bucket: 'at_risk', is_admin_only: false, trigger_config: { all: [] } },
  { id: 't-pace', scenario_id: 'pace.behind', title: 'Behind', bucket: 'at_risk', is_admin_only: false, trigger_config: { all: [] } },
  { id: 't-save', scenario_id: 'custom.save', title: 'Save', bucket: 'cancel_path', is_admin_only: false,
    trigger_config: { all: [{ metric: 'is_canceling', op: 'is', value: true }] } },
  { id: 't-custom', scenario_id: 'custom.quiet', title: 'Quiet', bucket: 'at_risk', is_admin_only: false,
    trigger_config: { all: [{ metric: 'is_canceling', op: 'is_not', value: true }] } },
  { id: 't-welcome', scenario_id: 'welcome.day1', title: 'Welcome', bucket: 'event', is_admin_only: false, trigger_config: { all: [] } },
  { id: 't-crushing', scenario_id: 'custom.crushing', title: 'Crushing', bucket: 'crushing', is_admin_only: false, trigger_config: null },
  { id: 't-admin', scenario_id: 'W2.6', title: 'Discount review', bucket: 'admin', is_admin_only: true, trigger_config: null },
]

const P = SWITCH - 5 * D // sends before the switch
const A = SWITCH + 1 * D // sends after it
let taskSeq = 0
function sent(template_id, student_id, sendMs, extra = {}) {
  taskSeq++
  return {
    id: `task-${String(taskSeq).padStart(3, '0')}`, template_id, student_id, status: 'completed',
    created_at: iso(sendMs - 6 * H), completed_at: iso(sendMs), dismissed_at: null, notes: null, outcome: null, ...extra,
  }
}
function other(template_id, student_id, status, atMs, extra = {}) {
  taskSeq++
  return {
    id: `task-${String(taskSeq).padStart(3, '0')}`, template_id, student_id, status,
    created_at: iso(atMs), completed_at: null, dismissed_at: status === 'dismissed' ? iso(atMs + H) : null,
    notes: null, outcome: null, ...extra,
  }
}
let compSeq = 0
const comp = (student_id, completedMs, actionMs = null, skippedMs = null) => ({
  id: `c-${++compSeq}`, student_id, lesson_id: `l${compSeq}`,
  completed_at: completedMs == null ? null : iso(completedMs),
  action_completed_at: actionMs == null ? null : iso(actionMs),
  skipped_at: skippedMs == null ? null : iso(skippedMs),
})
let noteSeq = 0
const note = (student_id, createdMs, updatedMs = createdMs) => ({
  id: `n-${String(++noteSeq).padStart(3, '0')}`, student_id, created_at: iso(createdMs), updated_at: iso(updatedMs),
})

const HAND = {
  templates: TPL,
  tasks: [
    // Before the switch
    sent('t-stalled', 's1', P, { outcome: 'replied' }),           // logs in 10 h later: success
    sent('t-stalled', 's2', P),                                     // never logs in; a Whop completion 20 h later
    sent('t-nolessons', 's3', P),                                   // a lesson 30 h later: success
    sent('t-nolessons', 's4', P, { outcome: 'no_reply' }),          // nothing
    sent('t-noship', 's5', P),                                      // ships 5 h later: success
    sent('t-noship', 's6', P),                                      // watches only: no
    sent('t-pace', 's7', P),                                        // dormant, a lesson 2 h later
    sent('t-pace', 's8', P),                                        // active 10 h before: not graded
    sent('t-pace', 's9', P),                                        // dormant, a note 3 h later
    sent('t-custom', 's10', P),                                     // dormant, a lesson 50 h later
    sent('t-save', 's11', P),                                       // saved today
    sent('t-save', 's12', P),                                       // still canceling
    sent('t-welcome', 's13', P),
    sent('t-crushing', 's14', P),
    sent('t-admin', 's15', P),                                      // admin only: left out
    sent(null, 's16', P),                                           // no template
    sent('t-deleted', 's16', P),                                    // a template since deleted
    sent('t-nolessons', 's27', SWITCH - H),                         // an hour before the switch; a lesson 3 h after it
    sent('t-nolessons', 's29', P, { completed_at: iso(P - 7 * H) }), // marked sent before it was created
    other('t-nolessons', 's17', 'open', P),
    other('t-nolessons', 's18', 'dismissed', P, { notes: 'Auto-dismissed: student completed a lesson' }),
    other('t-pace', 's19', 'dismissed', P, { notes: 'Student answered in Discord' }),
    // After the switch
    sent('t-nolessons', 's20', A),                                  // a lesson 5 h later: success
    sent('t-nolessons', 's21', A),                                  // nothing
    sent('t-nolessons', 's3', A, { outcome: 'replied' }),           // s3 again: a lesson 2 h later
    sent('t-stalled', 's22', A),                                    // logs in 3 h later
    sent('t-stalled', 's28', SWITCH),                               // sent at the switch's own moment; logs in 1 h later
    sent('t-custom', 's23', A),                                     // dormant since the switch, a lesson 1 h later
    sent('t-save', 's24', A),                                       // saved
    sent('t-noship', 's25', A),                                     // ships 70 h later
    sent('t-noship', 's26', A),                                     // ships 73 h later: too late
    sent('t-welcome', 's30', A),
  ],
  student_lesson_completions: [
    comp('s2', P + 20 * H),
    comp('s3', P + 30 * H),
    comp('s5', null, P + 5 * H),
    comp('s6', P + 5 * H),
    comp('s7', P + 2 * H),
    comp('s8', P - 10 * H),
    comp('s10', P + 50 * H),
    comp('s27', SWITCH + 2 * H),
    comp('s29', P + H),
    comp('s20', A + 5 * H),
    comp('s3', A + 2 * H),
    comp('s23', A + H),
    comp('s25', null, A + 70 * H),
    comp('s26', null, A + 73 * H),
    comp('s4', null, null, P + H), // a skip only: not read as activity
  ],
  daily_notes: [note('s9', P + 3 * H), note('s8', P - 30 * H)],
  student_milestones: [
    { student_id: 's1', first_sprint_login_at: iso(P + 10 * H) },
    { student_id: 's22', first_sprint_login_at: iso(A + 3 * H) },
    { student_id: 's28', first_sprint_login_at: iso(SWITCH + H) },
    { student_id: 's2', first_sprint_login_at: null },
  ],
  students: [
    { id: 's11', membership_status: 'active', cancel_scheduled_at: null },
    { id: 's12', membership_status: 'active', cancel_scheduled_at: iso(P - D) },
    { id: 's24', membership_status: 'active', cancel_scheduled_at: null },
  ],
  admin_config: [{ key: 'program_login_link', value: 'https://example.invalid/login', description: null }],
}

// What v104 leaves: every completion in the table at the switch is archived
// (out of the app's reach), and a student with a completion there and no
// first-login stamp gets the earliest of its times as one. Rows written after
// the switch stay. The switch's row goes into admin_config.
function afterV104(tables) {
  const t = structuredClone(tables)
  const atSwitch = (c) => [c.completed_at, c.action_completed_at, c.skipped_at]
    .filter((x) => x != null).map(Date.parse)
  const wiped = t.student_lesson_completions.filter((c) => Math.min(...atSwitch(c)) < SWITCH)
  const first = new Map()
  for (const c of wiped) {
    const at = Math.min(...atSwitch(c))
    if (!first.has(c.student_id) || at < first.get(c.student_id)) first.set(c.student_id, at)
  }
  for (const [student_id, at] of first) {
    const m = t.student_milestones.find((r) => r.student_id === student_id)
    if (!m) t.student_milestones.push({ student_id, first_sprint_login_at: iso(at) })
    else if (m.first_sprint_login_at == null) m.first_sprint_login_at = iso(at)
  }
  t.student_lesson_completions = t.student_lesson_completions.filter((c) => !wiped.includes(c))
  t.admin_config = [...t.admin_config, { ...RESET_ROW }]
  return t
}

// ── Random histories, for the "nothing changes" half ────────────────────────
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let x = s
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
function randomTables(seed) {
  const r = rng(seed)
  const pick = (arr) => arr[Math.floor(r() * arr.length)]
  const students = Array.from({ length: 10 }, (_, i) => `r${seed}s${i}`)
  const T0 = SWITCH - 25 * D
  const when = () => T0 + Math.floor(r() * 40 * D)
  const maybe = (p, f) => (r() < p ? f() : null)
  const tplIds = [...TPL.map((x) => x.id), null, 't-gone']
  const notesPool = [null, 'Auto-dismissed: stale', 'Superseded by stalled.discord.d5', 'Old note [v62 auto-dismiss]', 'Student replied']
  const tasks = Array.from({ length: 45 }, (_, i) => {
    const status = pick(['open', 'completed', 'completed', 'completed', 'dismissed'])
    const created = when()
    return {
      id: `x${seed}-${String(i).padStart(3, '0')}`,
      template_id: pick(tplIds), student_id: pick(students), status,
      created_at: iso(created),
      completed_at: status === 'completed' ? iso(created + Math.floor((r() - 0.15) * 4 * D)) : null,
      dismissed_at: status === 'dismissed' ? iso(created + Math.floor(r() * 3 * D)) : null,
      notes: pick(notesPool),
      ...(r() < 0.8 ? { outcome: pick([null, 'replied', 'no_reply']) } : {}),
    }
  })
  const completions = Array.from({ length: 35 }, (_, i) => ({
    id: `c${seed}-${i}`, student_id: pick(students), lesson_id: `l${i}`,
    completed_at: maybe(0.7, () => iso(when())), action_completed_at: maybe(0.35, () => iso(when())),
    skipped_at: maybe(0.1, () => iso(when())),
  }))
  const notes = Array.from({ length: 20 }, (_, i) => {
    const c = when()
    return { id: `n${seed}-${String(i).padStart(3, '0')}`, student_id: pick(students), created_at: iso(c), updated_at: maybe(0.6, () => iso(c + Math.floor(r() * 2 * D))) }
  })
  const milestones = students.filter(() => r() < 0.6).map((student_id) => ({ student_id, first_sprint_login_at: maybe(0.7, () => iso(when())) }))
  const members = students.map((id) => ({
    id, membership_status: pick(['active', 'active', 'past_due', 'canceled']), cancel_scheduled_at: maybe(0.4, () => iso(when())),
  }))
  return {
    templates: TPL, tasks, student_lesson_completions: completions, daily_notes: notes,
    student_milestones: milestones, students: members, admin_config: [],
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
const strip = (o) => omit(o, ['computed_at'])
// The new answer with the new fields taken off, to set beside the old one.
function asOld(n) {
  const rest = omit(strip(n), ['reset_at'])
  return {
    ...rest,
    totals: omit(rest.totals, ['graded_on_old_course']),
    templates: rest.templates.map((r) => omit(r, ['graded_on_old_course'])),
  }
}
const saysNoSwitch = (n) =>
  n.reset_at === null && n.totals.graded_on_old_course === 0 && n.templates.every((r) => r.graded_on_old_course === 0)
const readsOf = (d, skipSwitch) =>
  d.reads.filter((q) => !(skipSwitch && q.table === 'admin_config')).map((q) => [q.table, q.steps])
const row = (res, id) => res.templates.find((r) => r.template_id === id)

async function parity(label, tables, sinceIso) {
  const dOld = db(tables)
  const dNew = db(tables)
  const opts = { sinceIso }
  const [o, n] = await Promise.all([OLD.computeOutreachInsights(dOld, opts), NEW.computeOutreachInsights(dNew, opts)])
  const same = eq(strip(o), asOld(n))
  const sameReads = eq(readsOf(dOld, false), readsOf(dNew, true))
  const switchReads = dNew.reads.filter((q) => q.table === 'admin_config').length
  return { same, sameReads, noSwitch: saysNoSwitch(n), switchReads, o, n, label }
}

// ═════════════ 1. Before the switch: the old and the new agree ═════════════
console.log('=== 1. No switch row: old (git ' + BASE + ') and new give the same numbers ===')
{
  for (const since of [null, iso(P - D), iso(SWITCH - 2 * H), iso(A + 2 * D)]) {
    const r = await parity('hand', HAND, since)
    ok(r.same, `hand-built history, since ${since ?? 'all time'}: every number the same`)
    ok(r.sameReads, `hand-built history, since ${since ?? 'all time'}: the same reads, in the same order`)
    ok(r.noSwitch && r.switchReads === 1, `hand-built history, since ${since ?? 'all time'}: reset_at null, graded_on_old_course 0 everywhere, the switch read once`)
  }
  // Graded at all? The parity above is only worth something if the history
  // exercises every family. Spot values from the old module itself:
  const { o } = await parity('hand', HAND, null)
  ok(row(o, 't-nolessons').success === 5 && row(o, 't-nolessons').success_eligible === 7,
    'the history grades nolessons (5 of 7: s3 twice, s20, s27, s29; s4 and s21 did nothing)',
    `${row(o, 't-nolessons').success}/${row(o, 't-nolessons').success_eligible}`)
  ok(o.totals.saves === 2 && o.totals.saves_eligible === 3, 'and saves (2 of 3)', `${o.totals.saves}/${o.totals.saves_eligible}`)
  ok(row(o, 't-pace').success_eligible === 2, 'and the pace attribution filter (s8 was active before: 2 graded of 3)', `${row(o, 't-pace').success_eligible}`)
  ok(o.info.admin_only_tasks === 1 && o.info.untemplated_tasks === 2, 'and the excluded tasks (1 admin only, 2 without a template)')

  // The same history as v104 leaves it, still with no switch row: the old and
  // the new must agree on that too (the row, not the data, turns the rule on).
  const after = afterV104(HAND)
  after.admin_config = after.admin_config.filter((x) => x.key !== 'curriculum_reset_at')
  const r2 = await parity('after-v104-without-row', after, null)
  ok(r2.same && r2.sameReads && r2.noSwitch, 'v104\'s data with the row taken away: the same numbers and reads')

  let allSame = 0
  let allReads = 0
  let allNoSwitch = 0
  let checked = 0
  const firstBad = []
  for (let seed = 1; seed <= 40; seed++) {
    const t = randomTables(seed)
    for (const since of [null, iso(SWITCH - 10 * D), iso(SWITCH + 2 * D)]) {
      const r = await parity(`seed ${seed}`, t, since)
      checked++
      if (r.same) allSame++
      else if (firstBad.length < 3) firstBad.push(`seed ${seed} since ${since}`)
      if (r.sameReads) allReads++
      if (r.noSwitch && r.switchReads === 1) allNoSwitch++
    }
  }
  ok(allSame === checked, `40 random histories at 3 ranges: every number the same (${allSame}/${checked})`, firstBad.join('; '))
  ok(allReads === checked, `and the same reads (${allReads}/${checked})`)
  ok(allNoSwitch === checked, `and the new fields say no switch (${allNoSwitch}/${checked})`)

  // A failed read is the same failure in both.
  const failing = { student_lesson_completions: { message: 'statement timeout' } }
  const eo = await OLD.computeOutreachInsights(db(HAND, failing), {}).then(() => null, (e) => e.message)
  const en = await NEW.computeOutreachInsights(db(HAND, failing), {}).then(() => null, (e) => e.message)
  ok(eo !== null && eo === en, 'a failed completions read throws the same error in both', en ?? 'no throw')
}

// ═════════════ 2. The switch row cannot be read ═════════════
console.log('=== 2. The switch row cannot be read ===')
{
  const failing = { admin_config: { message: 'permission denied for table admin_config' } }
  const en = await NEW.computeOutreachInsights(db(HAND, failing), {}).then(() => null, (e) => e.message)
  ok(en !== null && en.includes('curriculum_reset_at could not be read'),
    'a failed read of the switch throws (both routes answer 500 with it); it never grades as if there were no switch', en ?? 'no throw')
  const broken = structuredClone(HAND)
  broken.admin_config.push({ key: 'curriculum_reset_at', value: '20 October', description: null })
  const eb = await NEW.computeOutreachInsights(db(broken), {}).then(() => null, (e) => e.message)
  ok(eb !== null && eb.includes('not a date and time'), 'a switch row that is not a date throws too', eb ?? 'no throw')
}

// ═════════════ 3. After the switch ═════════════
console.log('=== 3. After the switch (v104\'s data and its row) ===')
{
  const before = await NEW.computeOutreachInsights(db(HAND), {})
  const t = afterV104(HAND)

  // What the old module does with v104's data: the regrades item 25 is about.
  const old = await OLD.computeOutreachInsights(db(t), {})
  ok(row(before, 't-nolessons').success === 5 && row(old, 't-nolessons').success === 3,
    'the old module on v104\'s data: nolessons falls from 5 to 3 (s3\'s and s29\'s lessons are archived)',
    `${row(before, 't-nolessons').success} before, ${row(old, 't-nolessons').success} after`)
  ok(row(old, 't-noship').success < row(before, 't-noship').success,
    'the old module: s5\'s ship is archived, so noship loses a success it had',
    `${row(before, 't-noship').success} before, ${row(old, 't-noship').success} after`)
  ok(row(old, 't-stalled').success > row(before, 't-stalled').success,
    'the old module: s2 never logged in, but v104\'s stamp makes the stalled DM a success',
    `${row(before, 't-stalled').success} before, ${row(old, 't-stalled').success} after`)

  const dNew = db(t)
  const n = await NEW.computeOutreachInsights(dNew, {})
  ok(n.reset_at === iso(SWITCH), 'reset_at is the switch row\'s value', n.reset_at)

  // Per family: [template, sends before the switch left out, success, graded]
  const expect = [
    ['t-stalled', 2, 2, 2],   // s1 s2 left out; s22 and s28 (at the switch's own moment) graded, both logged in
    ['t-nolessons', 4, 2, 3], // s3 s4 s27 s29 left out; s20 yes, s21 no, s3 again yes
    ['t-noship', 2, 1, 2],    // s5 s6 left out; s25 in 70 h yes, s26 in 73 h no
    ['t-pace', 3, 0, 0],      // s7 s8 s9 left out; nothing after
    ['t-custom', 1, 1, 1],    // s10 left out; s23 yes
    ['t-save', 0, 2, 3],      // saves read the membership: all three graded, s11 and s24 saved
    ['t-welcome', 0, 0, 0],   // never graded, never counted as left out
    ['t-crushing', 0, 0, 0],
  ]
  for (const [id, left, success, graded] of expect) {
    const r = row(n, id)
    ok(r.graded_on_old_course === left && r.success === success && r.success_eligible === graded,
      `${id}: ${left} left out, ${success} of ${graded} graded`,
      `${r.graded_on_old_course} left out, ${r.success}/${r.success_eligible}`)
  }
  ok(n.totals.graded_on_old_course === 12, 'the totals: 12 left out, the sum of the rows', `${n.totals.graded_on_old_course}`)
  ok(n.totals.saves === 2 && n.totals.saves_eligible === 3, 'Saves is unchanged by the switch: 2 of 3', `${n.totals.saves}/${n.totals.saves_eligible}`)
  ok(n.totals.success === 6 && n.totals.success_eligible === 8, 'Success pools only sends after the switch: 6 of 8', `${n.totals.success}/${n.totals.success_eligible}`)

  // Nothing but the grading moves: the same data without the row, through the new module.
  const noRow = structuredClone(t)
  noRow.admin_config = noRow.admin_config.filter((x) => x.key !== 'curriculum_reset_at')
  const plain = await NEW.computeOutreachInsights(db(noRow), {})
  const GRADING = ['success', 'success_eligible', 'graded_on_old_course']
  const ungraded = (res) => ({
    totals: omit(res.totals, GRADING),
    rows: res.templates.map((r) => omit(r, GRADING)),
    info: res.info, since: res.since,
  })
  ok(eq(ungraded(n), ungraded(plain)),
    'sent, created, open, dismissed, replied, unmarked, students reached and time to send are the same with and without the row')

  // The evidence reads skip the students whose only DMs were left out.
  const inLists = (table) => dNew.reads.filter((q) => q.table === table)
    .flatMap((q) => q.steps.filter((s) => s[0] === 'in').flatMap((s) => s[2]))
  const activity = new Set(inLists('student_lesson_completions'))
  const logins = new Set(inLists('student_milestones'))
  const members = new Set(inLists('students'))
  ok(['s4', 's5', 's6', 's7', 's8', 's9', 's10', 's27', 's29'].every((s) => !activity.has(s)),
    'no completion or note read for a student whose only graded-family DM was before the switch', [...activity].sort().join(','))
  ok(activity.has('s3') && activity.has('s20') && activity.has('s23'), 'and the students graded after it are read', [...activity].sort().join(','))
  ok(!logins.has('s1') && !logins.has('s2') && logins.has('s22') && logins.has('s28'),
    'the login read skips s1 and s2 and reads s22 and s28', [...logins].sort().join(','))
  ok(members.has('s11') && members.has('s12') && members.has('s24'), 'the membership read keeps every save DM', [...members].sort().join(','))

  // A range that starts after the switch has no send from before it.
  const late = await NEW.computeOutreachInsights(db(t), { sinceIso: iso(SWITCH + H) })
  ok(late.totals.graded_on_old_course === 0 && late.reset_at === iso(SWITCH),
    'a range starting after the switch: nothing left out, nothing to label', `${late.totals.graded_on_old_course}`)

  // A range reaching back before the switch still holds its sends: from 8 h
  // before P it holds all 12 (s29 was marked sent 7 h before P); from 1 h
  // before P, s29 is out of range and 11 are left.
  const wide = await NEW.computeOutreachInsights(db(t), { sinceIso: iso(P - 8 * H) })
  ok(wide.totals.graded_on_old_course === 12, 'a range from 8 h before P labels the same 12', `${wide.totals.graded_on_old_course}`)
  const narrow = await NEW.computeOutreachInsights(db(t), { sinceIso: iso(P - H) })
  ok(narrow.totals.graded_on_old_course === 11, 'a range from 1 h before P labels 11 (s29 falls outside it)', `${narrow.totals.graded_on_old_course}`)
}

console.log(`\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length > 0) {
  for (const f of fails) console.log(`  - ${f}`)
  process.exit(1)
}
