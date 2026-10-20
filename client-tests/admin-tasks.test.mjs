// admin-tasks.test.mjs: the CSM's task queue, GET /api/admin/tasks and the
// page and tile that read it (fix lane G1, 2026-10-20; the reset, admin
// rebuild 2, D7).
//
//   admin-5: the queue loaded the newest 500 tasks of any status in one read.
//   Once 500 newer tasks existed, an older open task left To do (the only
//   place a task is sent or dismissed) while the dashboard still counted it,
//   and every tab count stopped at 500.
//   The admin PRD review (2026-10-19): the admin rebuild writes support
//   records into `tasks` (scenario "support.*", no template, completed or
//   dismissed). The route must filter template-less rows in the query,
//   before any limit, so they never take a slot or a count.
//   The reset (admin rebuild 2, D7): once v109 wrote
//   admin_config.tasks_reset_at, To do, Sent and Dismissed hold the tasks
//   created on or after it, and the older ones are on the read-only Archived
//   tab. A failed read of the reset is a 500, never the old queue on To do.
//
// The route runs as it is: this file copies it into _gen/ with only its
// import lines rewritten (the team's login to stub-admin.ts, which hands the
// route the stand-in below; Next to stub-server.ts; constants.ts and
// tasks-reset.ts as build.mjs copies them, so run that first;
// supabase-pagination.ts as outreach-cutover.test.mjs copies it). The route
// as it was at BASE (production, where this lane started) runs beside it on
// the same data.
//
// The stand-in database answers the calls the route makes the way PostgREST
// does where the route depends on it:
//   - a select names columns and embeds "alias:table!inner(cols)" or
//     "alias:table(cols)" over tasks.student_id and tasks.template_id. An
//     !inner embed drops the task when its row is missing or fails the
//     embed's filters; a plain one is null then. A column a table does not
//     have is an error (42703).
//   - filters on the task (eq, not(col, "is", null)) and on an embed
//     ("student.csm_exempt", "template.bucket", or() with { foreignTable }).
//   - order by several columns (nullsFirst as given, else Postgres's default:
//     last ascending, first descending), limit, range.
//   - at most 1000 rows per answer, as Supabase's max-rows cuts every one.
//   - { count: "exact", head: true }: the number of matching rows, no rows.
//   - admin_config: select, eq, in, maybeSingle, from `tables.admin_config`.
// Every query is recorded as the calls made on it (tasks in `queries`,
// admin_config in `configQueries`).
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BASE = '70c934a' // production when fix lane G1 started

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const fromBase = (rel) => execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: here('..'), encoding: 'utf8' })

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

const ROUTE = 'src/app/api/admin/tasks/route.ts'
const IMPORTS = [
  ['from "next/server"', 'from "./stub-server.ts"'],
  ['from "@/lib/admin-auth"', 'from "./stub-admin.ts"'],
  ['from "@/lib/constants"', 'from "./constants.ts"'],
]
// supabase-pagination.ts has no imports; outreach-cutover.test.mjs makes the same copy.
write(fromSrc('src/lib/supabase-pagination.ts'), 'src/lib/supabase-pagination.ts', './_gen/supabase-pagination.ts', [])
write(fromSrc(ROUTE), ROUTE, './_gen/admin-tasks-route.ts',
  [...IMPORTS, ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
   ['from "@/lib/admin/tasks-reset"', 'from "./tasks-reset.ts"']])
write(fromBase(ROUTE), `${ROUTE}@${BASE}`, './_gen/admin-tasks-route.old.ts', IMPORTS)

const route = { now: (await import('./_gen/admin-tasks-route.ts')).GET, old: (await import('./_gen/admin-tasks-route.old.ts')).GET }
const { setTeam } = await import('./_gen/stub-admin.ts')
const { TASKS_STUDENT_JOIN_CUTOFF } = await import('./_gen/constants.ts')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

// ── The stand-in database ───────────────────────────────────────────────────

const MAX_ROWS = 1000
const COLUMNS = {
  tasks: ['id', 'student_id', 'scenario_id', 'template_id', 'status', 'behavior_summary', 'created_at', 'completed_at',
    'completed_by', 'dismissed_at', 'dismissed_by', 'notes', 'outcome', 'outcome_at', 'outcome_by'],
  students: ['id', 'name', 'email', 'discord_username', 'csm_exempt', 'first_paid_at', 'joined_at', 'membership_status',
    'cancel_scheduled_at', 'avatar_url'],
  templates: ['id', 'scenario_id', 'bucket', 'week', 'title', 'body', 'is_admin_only', 'variables', 'word_count', 'is_active',
    'trigger_config'],
}
const FK = { students: 'student_id', templates: 'template_id' }

/** Splits on the commas outside parentheses. */
function topLevel(s) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}
function parseSelect(sel) {
  const cols = []
  const embeds = []
  for (const p of topLevel(sel)) {
    const m = /^(\w+):(\w+)(!inner)?\(([\s\S]*)\)$/.exec(p)
    if (m) embeds.push({ alias: m[1], table: m[2], inner: Boolean(m[3]), cols: topLevel(m[4]) })
    else cols.push(p)
  }
  return { cols, embeds }
}
const ilike = (pattern) => new RegExp(`^${pattern.split('%').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i')
function parseOr(expr) {
  const parts = topLevel(expr).map((p) => {
    const [col, op, ...rest] = p.split('.')
    if (op !== 'ilike') throw new Error(`the stand-in knows only ilike inside or(), got ${op}`)
    const re = ilike(rest.join('.'))
    return (r) => r[col] != null && re.test(String(r[col]))
  })
  return (r) => parts.some((f) => f(r))
}

function configBuilder(db) {
  const q = { table: 'admin_config', calls: [], preds: [] }
  db.configQueries.push(q)
  const answer = (single) => {
    const injected = db.failWhen(q)
    if (injected) return { data: null, error: injected }
    const rows = (db.tables.admin_config ?? []).filter((r) => q.preds.every((f) => f(r)))
    if (single) return { data: rows[0] ? { ...rows[0] } : null, error: null }
    return { data: rows.map((r) => ({ ...r })), error: null }
  }
  const b = {
    select(cols) { q.calls.push(['select', cols]); return b },
    eq(c, v) { q.calls.push(['eq', c, v]); q.preds.push((r) => r[c] === v); return b },
    in(c, vs) { q.calls.push(['in', c, vs]); q.preds.push((r) => vs.includes(r[c])); return b },
    maybeSingle() { q.calls.push(['maybeSingle']); return Promise.resolve(answer(true)) },
    then(res, rej) { return Promise.resolve(answer(false)).then(res, rej) },
  }
  return b
}

function tasksDb(tables) {
  const db = { tables, queries: [], configQueries: [], failWhen: () => null }
  db.client = {
    from(table) {
      if (table === 'admin_config') return configBuilder(db)
      if (table !== 'tasks') throw new Error(`the stand-in answers only tasks and admin_config, not ${table}`)
      const q = { select: '*', head: false, count: null, base: [], embedded: {}, orders: [], limit: null, range: null, calls: [] }
      db.queries.push(q)
      const own = (c) => !c.includes('.')
      const onEmbed = (c, f) => { const [alias, col] = c.split('.'); (q.embedded[alias] ??= []).push((r) => f(r[col])) }
      const b = {
        select(cols = '*', opts = {}) { q.select = cols; q.head = opts.head === true; q.count = opts.count ?? null; q.calls.push(['select', cols, opts]); return b },
        eq(c, v) {
          q.calls.push(['eq', c, v])
          if (own(c)) q.base.push((r) => r[c] === v); else onEmbed(c, (x) => x === v)
          return b
        },
        gte(c, v) {
          q.calls.push(['gte', c, v])
          if (own(c)) q.base.push((r) => r[c] != null && r[c] >= v); else onEmbed(c, (x) => x != null && x >= v)
          return b
        },
        lt(c, v) {
          q.calls.push(['lt', c, v])
          if (own(c)) q.base.push((r) => r[c] != null && r[c] < v); else onEmbed(c, (x) => x != null && x < v)
          return b
        },
        not(c, op, v) {
          if (op !== 'is' || v !== null || !own(c)) throw new Error(`the stand-in knows only not(col, "is", null) on the task, got ${c} ${op} ${v}`)
          q.calls.push(['not', c, op, v])
          q.base.push((r) => r[c] != null)
          return b
        },
        or(expr, opts = {}) {
          q.calls.push(['or', expr, opts])
          const alias = opts.foreignTable ?? opts.referencedTable
          const f = parseOr(expr)
          if (alias) (q.embedded[alias] ??= []).push(f); else q.base.push(f)
          return b
        },
        order(c, o = {}) { q.calls.push(['order', c, o]); q.orders.push([c, o.ascending !== false, o.nullsFirst]); return b },
        limit(n) { q.calls.push(['limit', n]); q.limit = n; return b },
        range(from, to) { q.calls.push(['range', from, to]); q.range = [from, to]; return b },
        then(res, rej) { return Promise.resolve(run(q)).then(res, rej) },
      }
      return b
    },
  }
  function run(q) {
    const injected = db.failWhen(q)
    if (injected) return { data: null, count: null, error: injected }
    const { cols, embeds } = parseSelect(q.select)
    const check = (table, names) => names.find((c) => c !== '*' && !COLUMNS[table].includes(c))
    for (const [table, names] of [['tasks', cols], ...embeds.map((e) => [e.table, e.cols])]) {
      const bad = check(table, names)
      if (bad) return { data: null, count: null, error: { code: '42703', message: `column ${table}.${bad} does not exist` } }
    }
    const pick = (row, names) => (names.includes('*') ? { ...row } : Object.fromEntries(names.map((c) => [c, row[c] ?? null])))
    const found = []
    for (const r of tables.tasks) {
      if (!q.base.every((f) => f(r))) continue
      const shaped = pick(r, cols)
      let keep = true
      for (const e of embeds) {
        const target = tables[e.table].find((x) => x.id === r[FK[e.table]]) ?? null
        const passes = target !== null && (q.embedded[e.alias] ?? []).every((f) => f(target))
        if (e.inner && !passes) { keep = false; break }
        shaped[e.alias] = passes ? pick(target, e.cols) : null
      }
      if (keep) found.push({ r, shaped })
    }
    for (const [c, asc, nullsFirst] of [...q.orders].reverse()) {
      const first = nullsFirst ?? !asc
      found.sort((x, y) => {
        const a = x.r[c] ?? null
        const z = y.r[c] ?? null
        if (a === z) return 0
        if (a === null) return first ? -1 : 1
        if (z === null) return first ? 1 : -1
        return (a < z ? -1 : 1) * (asc ? 1 : -1)
      })
    }
    const count = q.count === 'exact' ? found.length : null
    if (q.head) return { data: null, count, error: null }
    let page = found
    if (q.range) page = page.slice(q.range[0], q.range[1] + 1)
    if (q.limit !== null) page = page.slice(0, q.limit)
    return { data: page.slice(0, MAX_ROWS).map((x) => x.shaped), count, error: null }
  }
  return db
}

// ── The data ────────────────────────────────────────────────────────────────

const iso = (ms) => new Date(ms).toISOString()
const T0 = Date.parse('2026-10-19T07:00:00.000Z')
const MIN = 60_000
const after = Date.parse(TASKS_STUDENT_JOIN_CUTOFF) + 140 * 86_400_000
const student = (id, extra = {}) => ({
  id, name: `Student ${id}`, email: `${id}@example.com`, discord_username: `${id}_d`, csm_exempt: false,
  first_paid_at: iso(after), joined_at: iso(after), membership_status: 'active', cancel_scheduled_at: null, avatar_url: null, ...extra,
})
const template = (id, bucket = 'at_risk') => ({
  id, scenario_id: id.replace('tpl-', ''), bucket, week: 'D03', title: `Template ${id}`, body: 'Hey {firstName}',
  is_admin_only: false, variables: [], word_count: 3, is_active: true, trigger_config: null,
})
let seq = 0
function task(student_id, template_id, status, createdMs, extra = {}) {
  seq++
  return {
    id: `task-${String(seq).padStart(5, '0')}`, student_id, scenario_id: template_id ? template_id.replace('tpl-', '') : 'support.nostart',
    template_id, status, behavior_summary: null, created_at: iso(createdMs),
    completed_at: status === 'completed' ? iso(createdMs + 60 * MIN) : null, completed_by: null,
    dismissed_at: status === 'dismissed' ? iso(createdMs + 30 * MIN) : null, dismissed_by: null,
    notes: status === 'dismissed' ? 'not needed' : null, outcome: null, outcome_at: null, outcome_by: null, ...extra,
  }
}

/** GET /api/admin/tasks, as the page asks for it unless `query` says otherwise. */
async function ask(v, db, query = 'status=all&limit=500') {
  setTeam({ id: 'team-csm-1', role: 'csm' }, db.client)
  db.queries.length = 0
  db.configQueries.length = 0
  const res = await route[v](new Request(`http://app/api/admin/tasks?${query}`))
  return { status: res.status, body: await res.json() }
}
/** What the page at BASE showed on its tabs: counted from the rows it got. */
const pageCountsAtBase = (tasks) => ({
  open: tasks.filter((t) => t.status === 'open').length,
  completed: tasks.filter((t) => t.status === 'completed').length,
  dismissed: tasks.filter((t) => t.status === 'dismissed').length,
})

console.log('\n=== 600 support records newer than one open cron task ===')
{
  // The admin rebuild's records: no template, Messaged (completed) or Not needed (dismissed).
  const tasks = [task('s1', 'tpl-nolessons', 'open', T0)]
  for (let i = 1; i <= 600; i++) tasks.push(task('s1', null, i % 2 ? 'completed' : 'dismissed', T0 + i * MIN))
  const db = tasksDb({ tasks, students: [student('s1')], templates: [template('tpl-nolessons')] })
  const r = await ask('now', db)
  const open = r.body.tasks?.filter((t) => t.status === 'open') ?? []
  ok(r.status === 200 && open.length === 1 && open[0].id === tasks[0].id && open[0].template?.scenario_id === 'nolessons',
     'the open cron task is returned, with its template', show({ status: r.status, open: open.map((t) => t.id) }))
  ok(r.body.tasks.length === 1 && show(r.body.counts) === show({ open: 1, completed: 0, dismissed: 0, archived: 0 }),
     'and counted: To do 1; no support record is listed or counted in any tab', show(r.body.counts))
  const tasksQueries = db.queries.filter((q) => !q.head)
  ok(db.queries.length > 0 && db.queries.every((q) => q.calls.some((c) => show(c) === show(['not', 'template_id', 'is', null]))),
     'every query the route made filtered template_id is not null in the database, before its limit or range', `${db.queries.length} queries`)
  ok(tasksQueries.every((q) => q.limit === null || q.calls.findIndex((c) => c[0] === 'not') < q.calls.findIndex((c) => c[0] === 'limit')),
     'and in each capped read the filter comes before the limit')
  const old = await ask('old', db)
  ok(old.status === 200 && old.body.tasks.length === 0 && show(pageCountsAtBase(old.body.tasks)) === show({ open: 0, completed: 0, dismissed: 0 }),
     `control: at ${BASE} the 500 newest rows were support records, dropped after the limit: To do showed 0 and the task was gone`, show(old.body.tasks.length))
}

console.log('\n=== More than 500 tasks: every open one, exact counts ===')
{
  const tasks = [task('s1', 'tpl-nolessons', 'open', T0)] // the oldest
  for (let i = 1; i <= 650; i++) tasks.push(task('s1', 'tpl-nolessons', 'completed', T0 + i * MIN))
  for (let i = 1; i <= 120; i++) tasks.push(task('s2', 'tpl-stalled', 'dismissed', T0 + (700 + i) * MIN))
  // More open than PostgREST hands back in one answer.
  for (let i = 1; i <= 1150; i++) tasks.push(task(`s${3 + (i % 40)}`, 'tpl-stalled', 'open', T0 + (900 + i) * MIN))
  const students = Array.from({ length: 43 }, (_, i) => student(`s${i + 1}`))
  const db = tasksDb({ tasks, students, templates: [template('tpl-nolessons'), template('tpl-stalled', 'cancel_path')] })
  const r = await ask('now', db)
  const by = (s) => r.body.tasks.filter((t) => t.status === s)
  const openIds = new Set(tasks.filter((t) => t.status === 'open').map((t) => t.id))
  ok(r.status === 200 && by('open').length === 1151 && by('open').every((t) => openIds.has(t.id)) && by('open').some((t) => t.id === tasks[0].id),
     'all 1151 open tasks come back, the oldest among them, past PostgREST\'s 1000 rows', `${by('open').length}`)
  ok(show(r.body.counts) === show({ open: 1151, completed: 650, dismissed: 120, archived: 0 }),
     'the tab counts are exact: 1151 / 650 / 120 (and no reset yet, so nothing archived)', show(r.body.counts))
  const sent = by('completed')
  const newestSent = tasks.filter((t) => t.status === 'completed').sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1)).slice(0, 500).map((t) => t.id)
  ok(sent.length === 500 && show(sent.map((t) => t.id)) === show(newestSent) && by('dismissed').length === 120,
     'Sent keeps the cap: the 500 sent most recently, newest first; Dismissed holds all 120', `${sent.length} / ${by('dismissed').length}`)
  const paged = db.queries.filter((q) => q.range)
  ok(paged.length === 2 && paged.every((q) => show(q.orders) === show([['created_at', true, undefined], ['id', true, undefined]])),
     'the open read is paged (two pages) in a stable order, created_at then id', show(paged.map((q) => q.range)))
  const old = await ask('old', db)
  const oldOpen = old.body.tasks.filter((t) => t.status === 'open')
  ok(old.body.tasks.length === 500 && !oldOpen.some((t) => t.id === tasks[0].id)
       && show(pageCountsAtBase(old.body.tasks)) === show({ open: 500, completed: 0, dismissed: 0 }),
     `control: at ${BASE} the page got 500 rows: the oldest open task missing, To do 500, Sent and Dismissed 0`, show(pageCountsAtBase(old.body.tasks)))
}

console.log('\n=== The cohort, the search and a bucket still filter, in lists and counts ===')
{
  const tasks = [
    task('s1', 'tpl-nolessons', 'open', T0),
    task('team', 'tpl-nolessons', 'open', T0 + MIN), // the team's own dummy student
    task('early', 'tpl-nolessons', 'open', T0 + 2 * MIN), // first paid before the tasks cutoff
    task('s2', 'tpl-stalled', 'completed', T0 + 3 * MIN),
  ]
  const students = [student('s1', { name: 'Alina Example' }), student('s2', { name: 'Marko Example' }),
    student('team', { csm_exempt: true }), student('early', { first_paid_at: '2026-05-01T10:00:00.000Z' })]
  const db = tasksDb({ tasks, students, templates: [template('tpl-nolessons'), template('tpl-stalled', 'cancel_path')] })
  const all = await ask('now', db)
  ok(show(all.body.tasks.map((t) => t.id).sort()) === show([tasks[0].id, tasks[3].id]) && show(all.body.counts) === show({ open: 1, completed: 1, dismissed: 0, archived: 0 }),
     'a csm_exempt student\'s task and a pre-cutoff joiner\'s are neither listed nor counted', show(all.body.counts))
  const found = await ask('now', db, 'status=all&limit=500&student=alina')
  ok(show(found.body.tasks.map((t) => t.id)) === show([tasks[0].id]) && show(found.body.counts) === show({ open: 1, completed: 0, dismissed: 0, archived: 0 }),
     'a search narrows the list and the counts alike', show(found.body.counts))
  const sentBucket = []
  for (let i = 1; i <= 8; i++) sentBucket.push(task('s1', i <= 3 ? 'tpl-nolessons' : 'tpl-stalled', 'completed', T0 + (10 + i) * MIN))
  const db2 = tasksDb({ tasks: sentBucket, students, templates: [template('tpl-nolessons'), template('tpl-stalled', 'cancel_path')] })
  const atRisk = await ask('now', db2, 'status=completed&limit=2&bucket=at_risk')
  ok(atRisk.body.tasks.length === 2 && atRisk.body.tasks.every((t) => t.template.bucket === 'at_risk') && atRisk.body.counts.completed === 3,
     'a bucket filter drops the other tasks in the query: 2 of the 3 at-risk sends under limit=2, counted 3', show(atRisk.body.counts))
  const oldAtRisk = await ask('old', db2, 'status=completed&limit=2&bucket=at_risk')
  ok(oldAtRisk.body.tasks.length === 0,
     `control: at ${BASE} the 2 newest (cancel path) took the 2 slots and were dropped after the limit: nothing listed`, show(oldAtRisk.body.tasks.length))
}

console.log('\n=== A failed read is an error, never a short queue ===')
{
  const tasks = [task('s1', 'tpl-nolessons', 'open', T0), task('s1', 'tpl-nolessons', 'completed', T0 + MIN)]
  const db = tasksDb({ tasks, students: [student('s1')], templates: [template('tpl-nolessons')] })
  db.failWhen = (q) => (q.range ? { message: 'canceling statement due to statement timeout' } : null)
  const r = await ask('now', db)
  ok(r.status === 500 && r.body.error === 'canceling statement due to statement timeout' && !('tasks' in r.body),
     'a failed page of open tasks: 500 with the reason, no list', show(r.body))
  db.failWhen = (q) => (q.head ? { message: 'permission denied for table tasks' } : null)
  const c = await ask('now', db)
  ok(c.status === 500 && c.body.error === 'permission denied for table tasks', 'a failed count: 500, never a made-up 0', show(c.body))
}

console.log('\n=== The reset (v109): To do, Sent and Dismissed from tasks_reset_at on, older tasks on Archived ===')
{
  // v109 ran at RESET: it dismissed the tasks open then (their notes end
  // " [reset for the new program]"). The crons opened new ones after it.
  const RESET = iso(T0 + 600 * MIN)
  const before = (i) => T0 + i * MIN // before the reset
  const after = (i) => T0 + (600 + i) * MIN // after it
  const reset = (t) => ({ ...t, status: 'dismissed', dismissed_at: RESET, notes: `${t.notes ?? ''} [reset for the new program]` })
  const old = [
    task('s1', 'tpl-stalled', 'completed', before(1)),
    task('s2', 'tpl-stalled', 'dismissed', before(2)),
    reset(task('s1', 'tpl-nolessons', 'open', before(3))),
    reset(task('s2', 'tpl-nolessons', 'open', before(4), { notes: 'checked twice' })),
  ]
  const fresh = [
    task('s1', 'tpl-stalled', 'open', after(1)),
    task('s2', 'tpl-stalled', 'open', after(2)),
    task('s1', 'tpl-nolessons', 'completed', after(3)),
    task('s2', 'tpl-nolessons', 'dismissed', after(4)),
  ]
  // Not listed anywhere, before or after: a support record (no template) and an exempt student's task.
  const hidden = [task('s1', null, 'completed', before(5)), task('team', 'tpl-stalled', 'completed', before(6)),
    task('s1', null, 'dismissed', after(5)), task('team', 'tpl-stalled', 'open', after(6))]
  const students = [student('s1'), student('s2'), student('team', { csm_exempt: true })]
  const templates = [template('tpl-nolessons'), template('tpl-stalled', 'cancel_path')]
  const LINKS = [{ key: 'program_login_link', value: 'https://app.example.com/login' }, { key: 'discord_invite_link', value: '' }]
  const db = tasksDb({ tasks: [...old, ...fresh, ...hidden], students, templates,
    admin_config: [{ key: 'tasks_reset_at', value: RESET }, ...LINKS, { key: 'curriculum_reset_at', value: iso(T0) }] })
  const r = await ask('now', db)
  const ids = (xs) => xs.map((t) => t.id)
  const of = (status) => r.body.tasks.filter((t) => t.status === status).map((t) => t.id)
  ok(r.status === 200 && show(of('open')) === show(ids(fresh.slice(0, 2))) && show(of('completed')) === show([fresh[2].id])
       && show(of('dismissed')) === show([fresh[3].id]),
     'To do, Sent and Dismissed hold only the tasks created on or after tasks_reset_at', show({ open: of('open'), sent: of('completed'), dismissed: of('dismissed') }))
  ok(show(ids(r.body.archived)) === show(ids([...old].reverse())) && r.body.archived.every((t) => t.template && t.student),
     'Archived holds every older task, whatever its status (the reset ones, sent, dismissed), newest first, joined like the rest',
     show(r.body.archived.map((t) => `${t.status}:${t.id.slice(-2)}`)))
  ok(show(r.body.counts) === show({ open: 2, completed: 1, dismissed: 1, archived: 4 }),
     'the counts are exact on both sides of the line: 2 / 1 / 1, and 4 archived; no support record or exempt student\'s task in either', show(r.body.counts))
  ok(r.body.resetAt === RESET && show(r.body.links) === show({ program_login_link: 'https://app.example.com/login', discord_invite_link: '' })
       && typeof r.body.generatedAt === 'string',
     'the answer carries the reset and the two links a DM prints (an empty link stays empty, for the page to flag)', show({ resetAt: r.body.resetAt, links: r.body.links }))
  const listQueries = db.queries.filter((q) => q.calls.some((c) => c[0] === 'eq' && c[1] === 'status'))
  const archivedQueries = db.queries.filter((q) => q.calls.some((c) => c[0] === 'lt'))
  ok(listQueries.length === 6 && listQueries.every((q) => q.calls.some((c) => show(c) === show(['gte', 'created_at', RESET])))
       && archivedQueries.length === 2 && archivedQueries.every((q) => q.calls.some((c) => show(c) === show(['lt', 'created_at', RESET]))
         && !q.calls.some((c) => c[0] === 'eq' && c[1] === 'status')),
     'the line is drawn in the database: every list and count asks created_at >= tasks_reset_at, the Archived read and count created_at < it, of any status',
     `${listQueries.length} list reads and counts, ${archivedQueries.length} archived`)
  ok(db.configQueries.length === 1 && show(db.configQueries[0].calls.find((c) => c[0] === 'in')) === show(['in', 'key', ['tasks_reset_at', 'program_login_link', 'discord_invite_link']]),
     'the reset and the two links come from one read of admin_config', show(db.configQueries.map((q) => q.calls)))
  const capped = await ask('now', db, 'status=archived&limit=3')
  ok(capped.status === 200 && capped.body.tasks.length === 0 && show(ids(capped.body.archived)) === show(ids([...old].reverse().slice(0, 3)))
       && capped.body.counts.archived === 4,
     '?status=archived alone: the newest 3 under limit=3, counted 4, and no list read', show(ids(capped.body.archived)))
  const oldRoute = await ask('old', db)
  ok(oldRoute.status === 200 && ids(oldRoute.body.tasks).includes(old[0].id) && ids(oldRoute.body.tasks).includes(old[2].id) && !('archived' in oldRoute.body),
     `control: at ${BASE} the route had no line: the old sent and reset tasks were on Sent and Dismissed with the new ones`, show(pageCountsAtBase(oldRoute.body.tasks)))
}
{
  // Before v109 runs: no line, nothing archived, no archived read.
  const tasks = [task('s1', 'tpl-nolessons', 'open', T0), task('s1', 'tpl-nolessons', 'completed', T0 + MIN)]
  const db = tasksDb({ tasks, students: [student('s1')], templates: [template('tpl-nolessons')], admin_config: [] })
  const r = await ask('now', db)
  ok(r.status === 200 && r.body.resetAt === null && r.body.archived.length === 0 && show(r.body.counts) === show({ open: 1, completed: 1, dismissed: 0, archived: 0 })
       && !db.queries.some((q) => q.calls.some((c) => c[0] === 'lt' || (c[0] === 'gte' && c[1] === 'created_at')))
       && show(r.body.links) === show({ program_login_link: '', discord_invite_link: '' }),
     'before v109: every task on the lists as before, Archived empty and never read, resetAt null, links unset read as ""', show(r.body.counts))
}
{
  // The reset cannot be read: a 500 with the reason, never the old queue as new.
  const tasks = [task('s1', 'tpl-nolessons', 'open', T0)]
  const db = tasksDb({ tasks, students: [student('s1')], templates: [template('tpl-nolessons')], admin_config: [{ key: 'tasks_reset_at', value: iso(T0 + MIN) }] })
  db.failWhen = (q) => (q.table === 'admin_config' ? { message: 'permission denied for table admin_config' } : null)
  const r = await ask('now', db)
  ok(r.status === 500 && r.body.error === "Couldn't read when the tasks were reset (admin_config.tasks_reset_at): permission denied for table admin_config"
       && !('tasks' in r.body) && db.queries.length === 0,
     'a failed read of tasks_reset_at: 500 with the reason, no list, and no task read', show(r.body))
  db.failWhen = () => null
  db.tables.admin_config = [{ key: 'tasks_reset_at', value: '2026-10-20 21:30' }]
  const bad = await ask('now', db)
  ok(bad.status === 500 && /^admin_config\.tasks_reset_at holds "2026-10-20 21:30", which is not a date and time with its zone/.test(bad.body.error ?? ''),
     'a tasks_reset_at that is not a date with its zone: 500 saying so, never a guess', show(bad.body))
}

console.log('\n=== The queue page and the dashboard tile read the same numbers ===')
{
  // Since admin rebuild 2 the page is src/components/admin/tasks/TasksView.tsx,
  // and its tabs are tabsFor in src/lib/admin/tasks-view.ts
  // (admin-people.test.mjs runs it on the route's counts).
  const PAGE = 'src/app/admin/(authenticated)/tasks/page.tsx'
  const VIEW = 'src/components/admin/tasks/TasksView.tsx'
  const DASH = 'src/app/admin/(authenticated)/page.tsx'
  const page = { now: fromSrc(VIEW), old: fromBase(PAGE) }
  const rules = fromSrc('src/lib/admin/tasks-view.ts')
  const dash = { now: fromSrc(DASH), old: fromBase(DASH) }
  ok(/const tabs = tabsFor\(data\);/.test(page.now) && /<TabStrip label="Task lists" tabs=\{tabs\}/.test(page.now)
       && /count: answer\.counts\[t\] \?\? 0/.test(rules) && !/rows\.reduce\(/.test(page.now),
     'the tabs show the route\'s exact counts, no longer a count of the rows the page holds')
  ok(page.now.includes('Showing the newest {shown} of {data.counts[current]}.'),
     'a Sent, Dismissed or Archived list cut at 500 says so under it')
  ok(/rows\.reduce\(/.test(page.old) && !page.old.includes('setCounts'), `control: at ${BASE} the page counted its own 500 rows`)
  const tile = (src) => /\.from\("tasks"\)\s*\.select\(\s*"id, student:students!inner\(csm_exempt, joined_at\)",\s*\{ count: "exact", head: true \},?\s*\)\s*\.eq\("status", "open"\)\s*\.not\("template_id", "is", null\)/.test(src)
  ok(tile(dash.now), 'the dashboard\'s "Open tasks" counts open tasks with a template, as the queue does')
  ok(!tile(dash.old), `control: at ${BASE} it counted template-less open tasks the queue never showed`)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
