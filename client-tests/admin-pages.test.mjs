// admin-pages.test.mjs: admin pages that showed the wrong state (fix lane
// G1, 2026-10-20).
//
//   admin-2: the drawer on /admin/journey showed the previous student's
//   discount application (status and Whop code) and streak on a student who
//   had none, and a slow answer for one student could land on the next.
//   admin-3: /admin/templates never showed which templates are off (the
//   course switch turned some off) and could not turn one back on.
//   The ads tick (2026-10-20): approving the 30% no longer needs "Ad
//   submissions verified" (Lovro), so the tick kept on the student page and
//   in the drawer may not say it is required.
//
// No browser runs here (the repo has no DOM harness), so each fix is checked
// on the real source in the ways that need none:
//   - the drawer (since admin rebuild 2, JourneyDrawer in JourneyView.tsx,
//     fed by useStudent of StudentDetailView.tsx): the board's key read from
//     the source, and useStudent itself, taken from the source with
//     TypeScript's parser, types stripped, run on a small stand-in for
//     React's hooks the way React runs it when the student changes on one
//     mounted drawer (the last run's cleanup, then the effect again), with
//     the transport's answers held back to land late;
//   - the templates page's own handler, taken from the source the same way,
//     with fetch() going to a copy of the real PUT route (its login pointed
//     at stub-admin.ts), and its markup read from the source;
//   - the tick's help text on both pages, compiled the same way, so each
//     line is the one string React renders;
//   - the pages as they were at BASE, run or read the same way, to show each
//     check fails on the old code.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

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

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
const { FakeDb, useDb: installDb } = await import('./_gen/stub-server.ts')

// ── Reading the source ──────────────────────────────────────────────────────

const parse = (source) => ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(node, test) {
  let hit = null
  const visit = (n) => {
    if (hit) return
    if (test(n)) hit = n
    else ts.forEachChild(n, visit)
  }
  visit(node)
  return hit
}
/** `text` (a function or an arrow function) as plain JavaScript closed over `scope`. */
function closedOver(text, scope) {
  const js = ts.transpileModule(`const __f = ${text};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const names = Object.keys(scope)
  return new Function(...names, `${js}\nreturn __f;`)(...names.map((n) => scope[n]))
}
const settle = () => new Promise((r) => setImmediate(r))

// ── admin-2: the journey drawer ─────────────────────────────────────────────
//
// Since admin rebuild 2 (D8, D9) the drawer is JourneyDrawer in
// src/components/admin/journey/JourneyView.tsx, and its data comes from
// useStudent in src/components/admin/students/StudentDetailView.tsx (the
// student page's own hook), through a transport. The fix stays in two
// places: the board mounts the drawer keyed by the student's id, so each
// student opens on fresh state; and useStudent drops an answer that lands
// after it moved on. The hook is taken from the source with TypeScript's
// parser and run on a small stand-in for React's hooks (mountHook, below),
// as React runs it on one mounted drawer when the student changes: the
// worst case, which the key already prevents.

const JOURNEY_VIEW = 'src/components/admin/journey/JourneyView.tsx'
const DETAIL_VIEW = 'src/components/admin/students/StudentDetailView.tsx'
const OLD_DRAWER = 'src/app/admin/(authenticated)/journey/StudentDrawer.tsx'
const journeyView = fromSrc(JOURNEY_VIEW)
const detailView = fromSrc(DETAIL_VIEW)

/**
 * One mounted component's hooks, standing in for React's: state, refs and
 * callbacks kept by their place, and after each call the effects whose
 * dependencies changed run, the last run's cleanup first, as React runs
 * them. `makeHook` is handed these hooks and answers the hook to call.
 */
function mountHook(makeHook) {
  const slots = []
  const effects = []
  let i = 0
  const same = (a, b) => a.length === b.length && a.every((d, j) => Object.is(d, b[j]))
  const hooks = {
    useState(init) {
      const k = i++
      if (!(k in slots)) slots[k] = { v: typeof init === 'function' ? init() : init }
      const slot = slots[k]
      return [slot.v, (next) => { slot.v = typeof next === 'function' ? next(slot.v) : next }]
    },
    useRef(init) {
      const k = i++
      if (!(k in slots)) slots[k] = { current: init }
      return slots[k]
    },
    useCallback(fn, deps) {
      const k = i++
      if (slots[k] && same(deps, slots[k].deps)) return slots[k].fn
      slots[k] = { fn, deps }
      return fn
    },
    useEffect(fn, deps) {
      const k = i++
      if (effects[k] && same(deps, effects[k].deps)) return
      if (effects[k]?.cleanup) effects[k].cleanup()
      effects[k] = { deps, cleanup: fn() ?? null }
    },
  }
  const hook = makeHook(hooks)
  return (...args) => {
    i = 0
    return hook(...args)
  }
}
/** The function `name` declared in `source`, as written there. */
function functionText(source, name) {
  const sf = parse(source)
  const fn = find(sf, (n) => ts.isFunctionDeclaration(n) && n.name?.text === name)
  if (!fn) throw new Error(`no function ${name}`)
  return fn.getText(sf)
}
/** useStudent from the source, as plain JavaScript over the hooks it is handed. */
const useStudentOn = (hooks) =>
  closedOver(functionText(detailView, 'useStudent').replace(/^export function useStudent/, 'function'), hooks)

/** Student A applied (approved, with a code) and has a 5-day streak; student B has neither, as most students. */
const STUDENTS = {
  'stu-a': { id: 'stu-a', discount: { ok: true, data: { status: 'approved', text: 'Approved', code: 'ECOM30-STUAAA', askedAt: '2026-10-19T10:00:00.000Z' } },
    streak: { ok: true, data: 5 } },
  'stu-b': { id: 'stu-b', discount: { ok: true, data: null }, streak: { ok: true, data: 0 } },
}
/** What the drawer shows from useStudent's state: whose detail, their 30% request and their streak. */
const shown = ({ loaded }) => ({
  kind: loaded.kind,
  student: loaded.kind === 'ready' ? loaded.data.id : null,
  application: loaded.kind === 'ready' && loaded.data.discount.data ? `${loaded.data.discount.data.status} ${loaded.data.discount.data.code ?? ''}`.trim() : null,
  streak: loaded.kind === 'ready' ? loaded.data.streak.data : null,
})

console.log('\n=== admin-2: the journey drawer shows the clicked student only ===')
{
  ok(/\{drawer && <JourneyDrawer key=\{drawer\} studentId=\{drawer\} transport=\{transport\} onClose=\{\(\) => setDrawer\(null\)\} \/>\}/.test(journeyView)
       && /function JourneyDrawer\(\{ studentId, transport, onClose \}: \{[^}]*\}\) \{\s*const \{ loaded, busy, retry, patch \} = useStudent\(transport, studentId\);/.test(journeyView),
     'the board mounts the drawer keyed by the student\'s id, so React mounts it fresh for each one, and its state is useStudent\'s alone')
  ok(/export function StudentDrawer\(\{ studentId, onClose \}: StudentDrawerProps\) \{\s*const supabase = createClient\(\);\s*const \[student, setStudent\] = useState/.test(fromBase(OLD_DRAWER)),
     `control: at ${BASE} the exported drawer held the state itself, unkeyed, and the page keeps it mounted`)
}
{
  // A alone: A's request, its code and its streak.
  const transport = { loadStudent: async (id) => ({ ok: true, status: 200, data: STUDENTS[id] }) }
  const render = mountHook(useStudentOn)
  render(transport, 'stu-a')
  await settle()
  const a = shown(render(transport, 'stu-a'))
  ok(a.student === 'stu-a' && a.application === 'approved ECOM30-STUAAA' && a.streak === 5,
     'A: the request approved with its code, a 5-day streak', show(a))
}
{
  // A, then B, on ONE mounted hook. A's answer is slow: B's lands first, then A's.
  const asked = []
  const transport = { loadStudent: (id) => new Promise((resolve) => asked.push({ id, resolve })) }
  const answer = (id) => asked.find((x) => x.id === id).resolve({ ok: true, status: 200, data: STUDENTS[id] })
  const render = mountHook(useStudentOn)
  render(transport, 'stu-a')
  const opening = shown(render(transport, 'stu-b'))
  answer('stu-b')
  await settle()
  const before = shown(render(transport, 'stu-b'))
  answer('stu-a')
  await settle()
  await settle()
  const after = shown(render(transport, 'stu-b'))
  ok(opening.kind === 'loading' && opening.student === null, 'B opening shows loading, nothing of A\'s', show(opening))
  ok(before.student === 'stu-b' && before.application === null && before.streak === 0,
     'B, with no request and no streak: no request and 0 days, even on the same mounted hook', show(before))
  ok(show(after) === show(before), 'a slow answer for A that lands after B opened is dropped: the drawer still shows B', show(after))
  ok(show(asked.map((x) => x.id)) === show(['stu-a', 'stu-b']), 'one read for each student', show(asked.map((x) => x.id)))
}

// ── admin-3: templates on and off ───────────────────────────────────────────

const TEMPLATE_ROUTE = 'src/app/api/admin/templates/[id]/route.ts'
write(fromSrc(TEMPLATE_ROUTE), TEMPLATE_ROUTE, './_gen/admin-template-route.ts', [
  ['from "next/server"', 'from "./stub-server.ts"'],
  ['from "@/lib/admin-auth"', 'from "./stub-admin.ts"'],
])
const { PUT: putTemplate } = await import('./_gen/admin-template-route.ts')
const { setTeam } = await import('./_gen/stub-admin.ts')

const TEMPLATES = 'src/app/admin/(authenticated)/templates/page.tsx'
const templatesPage = { now: fromSrc(TEMPLATES), old: fromBase(TEMPLATES) }
/** The function `name` declared in `source`, as written there. */
function declared(source, name) {
  const sf = parse(source)
  const fn = find(sf, (n) => ts.isFunctionDeclaration(n) && n.name?.text === name)
  if (!fn) throw new Error(`no function ${name}`)
  return fn.getText(sf)
}
/** The templates page's state (recorded) and its setActive, with fetch() going to the PUT route. */
function templatesTab(rows) {
  const seen = { requests: [], errors: [], saving: [], rows }
  const scope = {
    setError: (e) => { if (e) seen.errors.push(e) },
    setSaving: (v) => { seen.saving.push(v) },
    setRows: (f) => { seen.rows = typeof f === 'function' ? f(seen.rows) : f },
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'team-token' } } }) } },
    fetch: async (url, init) => {
      const id = /^\/api\/admin\/templates\/([^/]+)$/.exec(url)?.[1]
      if (!id) throw new Error(`no route for ${url}`)
      seen.requests.push({ id, method: init.method, body: JSON.parse(init.body) })
      return putTemplate(new Request(`http://app${url}`, init), { params: Promise.resolve({ id }) })
    },
  }
  return { seen, setActive: closedOver(declared(templatesPage.now, 'setActive'), scope) }
}

console.log('\n=== admin-3: a template that is off shows it, and can be turned on and off ===')
{
  // A custom template the course switch turned off: its conditions read an area's pace.
  const OFF = {
    id: 'tpl-quiet', scenario_id: 'C-a1b2c3', is_custom: true, is_active: false, title: 'Quiet after area 2',
    bucket: 'at_risk', body: 'Hey {firstName}', trigger_config: { all: [{ metric: 'region_pace', op: 'lt', value: 1 }] },
  }
  const db = new FakeDb({ templates: [OFF] })
  installDb(db)
  setTeam({ id: 'team-founder-1', role: 'founder' })
  const t = templatesTab([{ ...OFF }])
  await t.setActive('tpl-quiet', true)
  const live = db.rows('templates')[0]
  ok(show(t.seen.requests) === show([{ id: 'tpl-quiet', method: 'PUT', body: { is_active: true } }])
       && live.is_active === true && live.title === OFF.title && show(live.trigger_config) === show(OFF.trigger_config),
     'Turn on sends PUT { is_active: true } and nothing else: the template is on, its text and conditions as saved', show(t.seen.requests))
  ok(t.seen.rows[0].is_active === true && t.seen.errors.length === 0 && show(t.seen.saving) === show(['tpl-quiet', null]),
     'the page takes the row the route answered (the Off badge goes), with no error, and the button is free again', show(t.seen.rows[0]))
  await t.setActive('tpl-quiet', false)
  ok(show(t.seen.requests[1]?.body) === show({ is_active: false }) && db.rows('templates')[0].is_active === false && t.seen.rows[0].is_active === false,
     'Turn off sends { is_active: false } and the template is off again')

  setTeam({ id: 'team-csm-1', role: 'csm' })
  const csm = templatesTab([{ ...db.rows('templates')[0] }])
  await csm.setActive('tpl-quiet', true)
  ok(db.rows('templates')[0].is_active === false && show(csm.seen.errors) === show(['Requires role: founder or admin']) && csm.seen.rows[0].is_active === false,
     'a CSM (the page shows them no button) is refused by the route, and the page shows why', show(csm.seen.errors))
}
{
  // Since the review of admin-3 the row takes on and off from
  // src/lib/template-on-off.ts and renders it with TemplateOnOff, and only
  // where the switch stops the template's tasks; template-on-off.test.mjs
  // runs both. These read that the wiring is still there.
  const src = templatesPage.now
  const row = fromSrc('src/components/admin/TemplateOnOff.tsx')
  const rule = fromSrc('src/lib/template-on-off.ts')
  ok(/\{onOff\.kind === "switch" && !onOff\.on && \(\s*<span\s+title="This template is off\."\s+style=\{\{[^}]*\}\}\s*>\s*Off\s*<\/span>/.test(src)
       && src.includes('const onOff = onOffView(t, live, dirty);'),
     'in the source, each row\'s header shows "Off" when the template is off and its switch works (every row, for every role)')
  ok(/<TemplateOnOff\s+view=\{onOff\}\s+canEdit=\{canEdit\}\s+busy=\{saving === t\.id\}\s+onToggle=\{\(\) => void setActive\(t\.id, !t\.is_active\)\}\s*\/>/.test(src)
       && /\{canEdit && \(\s*<button\s+type="button"\s+disabled=\{disabled\}\s+onClick=\{onToggle\}/.test(row)
       && row.includes('{view.on ? "Turn off" : "Turn on"}') && rule.includes('line: "This template is off."'),
     'the open row says on or off, and founders and admins get Turn on / Turn off, wired to setActive')
  ok(rule.includes('if (dirty) return "Save your changes first, then turn it on.";')
       && /const disabled = busy \|\| waits;/.test(row) && row.includes('{view.turnOnWaits}'),
     'Turn on waits while the row has unsaved changes, and says why, so a template never goes live on the conditions being replaced')
  ok(!templatesPage.old.includes('is_active'), `control: at ${BASE} the page never read or sent is_active`)
}

// ── The ads tick's help text (2026-10-20) ───────────────────────────────────

const STUDENT_PAGE = 'src/app/admin/(authenticated)/students/[id]/page.tsx'
/** The JSX text children in `source` that speak of approval, as React renders them. */
function approvalTexts(source) {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  return [...js.matchAll(/children: ("(?:[^"\\]|\\.)*")/g)].map((m) => m[1])
    .filter((literal) => /discount approval|Approving the 30%/.test(literal)).map((literal) => JSON.parse(literal))
}
console.log('\n=== The ads tick on the student page and in the drawer: approving the 30% no longer needs it ===')
{
  // Since admin rebuild 2 both are DiscountBlock in StudentDetailView.tsx: the
  // page's words, and the drawer's shorter ones (compact, from JourneyView.tsx).
  const texts = approvalTexts(detailView)
  ok(show(texts) === show([
    'Approving the 30% no longer needs it. Tick after confirming submissions in Discord.',
    'Tick this once you’ve confirmed the student submitted all action items in the Discord ad-review channel. Approving the 30% no longer needs it.',
  ]) && /<DiscountBlock student=\{loaded\.data\} transport=\{transport\} onSaved=\{\(v\) => patch\(\{ adVerified: v \}\)\} compact \/>/.test(journeyView)
     && /<DiscountBlock student=\{s\} transport=\{transport\} onSaved=\{\(v\) => patch\(\{ adVerified: v \}\)\} \/>/.test(detailView),
     'under "Ad submissions verified", the page and the drawer (compact) both say approving the 30% no longer needs the tick, and neither says it is required', show(texts))
  const old = { page: approvalTexts(fromBase(STUDENT_PAGE)), drawer: approvalTexts(fromBase(OLD_DRAWER)) }
  ok(old.page.length === 1 && old.drawer.length === 1
       && [...old.page, ...old.drawer].every((t) => /Required (for|before) discount approval/.test(t)),
     `control: at ${BASE} both said the tick was required for the approval`, show(old))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
