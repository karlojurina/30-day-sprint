// The student app's data layer (src/contexts/StudentContext.tsx), run by the
// real React in Node: the provider mounts, its effects run, the student's data
// is fetched and refreshed, and every request it makes is counted here.
//
// WHY IT EXISTS (2026-10-20, the night bug hunt: map-1, lessons-2, progress-2).
// refreshFromServer hands AuthContext a freshly parsed student row after every
// refresh, and the first-load effect was keyed on that object. So every
// refresh ran the whole first load again: one more /api/student/data outside
// the 5 s gate, completions replaced without the v74 guard, and when that
// extra fetch failed it set loadError, which nothing cleared: the map and an
// open lesson page were replaced by "Your course didn't load." until a reload.
//
// HOW IT RUNS. The provider is the real source, read from src/ on every run
// and turned into JavaScript by the app's own TypeScript (transpileModule, as
// world-tests/lesson-player-sim.mjs does for the lesson player), then loaded
// from a temporary folder with its import lines pointed at:
//   - React, the app's own copy;
//   - a stand-in AuthContext whose setStudent is a plain useState setter, as
//     the real AuthProvider's is (the root of the bug);
//   - a stand-in browser Supabase client (a session, and the few tables the
//     provider and the badge hook read in the browser);
//   - the real copies build.mjs makes of constants.ts, titles.ts, progress.ts,
//     and stub-call-gate.ts for the call gate (the real gate's interval logic
//     without its telemetry request).
// React DOM needs a page; the tree here renders no elements, so a few lines
// below stand in for one. `fetch` is answered from this file, and a request
// it does not know fails the suite. Date.now is this file's clock.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const require = createRequire(import.meta.url)
const ts = require('typescript')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? `: ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? `: ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

// ── The page React DOM reads, for a tree that renders no elements ────────────
// Listeners are called as a browser calls them: what one returns is ignored,
// so an async listener that rejects is an unhandled rejection (Node's own
// EventTarget would throw it as an uncaught exception instead).
class Target {
  #on = new Map()
  addEventListener(type, fn) { if (!this.#on.has(type)) this.#on.set(type, new Set()); this.#on.get(type).add(fn) }
  removeEventListener(type, fn) { this.#on.get(type)?.delete(fn) }
  dispatchEvent(e) { for (const fn of [...(this.#on.get(e.type) ?? [])]) fn.call(this, e); return true }
}
const win = new Target()
globalThis.window = globalThis
globalThis.addEventListener = win.addEventListener.bind(win)
globalThis.removeEventListener = win.removeEventListener.bind(win)
globalThis.dispatchEvent = win.dispatchEvent.bind(win)
globalThis.HTMLIFrameElement = class {}
const doc = new Target()
Object.assign(doc, { visibilityState: 'visible', activeElement: null, createElement: () => ({ setAttribute() {}, style: {} }) })
globalThis.document = doc
globalThis.IS_REACT_ACT_ENVIRONMENT = false

// ── The clock: the call gate, the 30 s sync throttle and the 3 s guard read it ─
const realNow = Date.now
let clock = Date.parse('2026-10-20T10:00:00.000Z')
Date.now = () => clock
const advance = (ms) => { clock += ms }

// The focus handler awaits a refresh with no catch, so a refresh whose fetch
// fails rejects there; in a browser that is a line in the console. Kept here.
const unhandled = []
process.on('unhandledRejection', (e) => { unhandled.push(String(e?.message ?? e)) })
// The provider logs a failed first load; kept out of the output.
const logged = []
console.error = (...a) => { logged.push(a.map(String).join(' ')) }

// ── The server: /api/student/data and the routes the provider calls ──────────
const LINK = 'https://discord.com/channels/1/2/3'
const STUDENT = { id: 's1', name: 'Test Student', whop_user_id: 'user_1', first_paid_at: '2026-10-10T00:00:00.000Z', membership_status: 'active' }
const server = {
  regions: [],
  lessons: [],
  completions: [],
  streak: { current_streak: 2, longest_streak: 3 },
  /** GET /api/student/data answers, oldest first: 'ok', 'reject' (a dead connection), or a status. Empty: 'ok'. */
  dataPlan: [],
  /** When set, the next data read is taken at the moment it is asked and answered when this resolves. */
  holdData: null,
  /** Changes to every data answer while set (reads that come back short). */
  dataOver: null,
  /** The sync's status, and what it does on the server before it answers. */
  syncStatus: 200,
  onSync: null,
  holdSync: null,
  dataReads: 0,
  syncs: 0,
  unexpected: [],
}
function seed() {
  server.regions = [
    { id: 'a1', name: 'Fundamentals', order_num: 1 },
    { id: 'a2', name: 'Marketing', order_num: 2 },
  ]
  server.lessons = [
    { id: 'a1l01', region_id: 'a1', day: null, sort_order: 1, type: 'watch', requires_action: false, counts_toward_progress: true, has_video: true },
    { id: 'a1l02', region_id: 'a1', day: null, sort_order: 2, type: 'watch', requires_action: false, counts_toward_progress: true, has_video: true },
    { id: 'a1l03', region_id: 'a1', day: null, sort_order: 3, type: 'watch', requires_action: false, counts_toward_progress: true, has_video: false },
    { id: 'a1l05', region_id: 'a1', day: null, sort_order: 5, type: 'setup', requires_action: true, counts_toward_progress: true, has_video: false },
    { id: 'a2l01', region_id: 'a2', day: null, sort_order: 6, type: 'watch', requires_action: false, counts_toward_progress: true, has_video: true },
  ]
  server.completions = [
    { id: 'c1', student_id: 's1', lesson_id: 'a1l01', completed_at: '2026-10-19T18:00:00.000Z', action_completed_at: null, skipped_at: null, discord_message_link: null },
    { id: 'c5', student_id: 's1', lesson_id: 'a1l05', completed_at: '2026-10-19T18:10:00.000Z', action_completed_at: '2026-10-19T18:10:00.000Z', skipped_at: null, discord_message_link: null },
  ]
  Object.assign(server, { dataPlan: [], holdData: null, dataOver: null, syncStatus: 200, onSync: null, holdSync: null, dataReads: 0, syncs: 0 })
}
function payload() {
  return {
    student: { ...STUDENT },
    regions: server.regions,
    lessons: server.lessons,
    completions: server.completions,
    discountRequest: null,
    quizzes: [], quizQuestions: [], quizAttempts: [], monthReview: null,
    milestones: null,
    streaks: server.streak,
    whopSync: null, celebrations: null, dmLog: null,
    regionQuiz: [], lessonRatings: [], watchProgress: [],
    catalogSuffix: '', whopCourseIdMasked: null,
  }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
function deferred() {
  let resolve
  const p = new Promise((r) => { resolve = r })
  return { p, resolve }
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  const method = (init.method ?? 'GET').toUpperCase()
  if (init.headers?.Authorization !== 'Bearer tok-1') server.unexpected.push(`${method} ${url} without the token`)
  if (method === 'GET' && url === '/api/student/data') {
    server.dataReads++
    const plan = server.dataPlan.shift() ?? 'ok'
    // Read when asked: a held answer says what the database held then.
    const body = JSON.parse(JSON.stringify({ ...payload(), ...(server.dataOver ?? {}) }))
    const hold = server.holdData
    server.holdData = null
    if (hold) await hold.p
    if (plan === 'reject') throw new TypeError('Failed to fetch')
    if (typeof plan === 'number') return json({ error: 'Could not load your data. Try again.' }, plan)
    return json(body)
  }
  if (method === 'POST' && url === '/api/student/refresh-watch-sync') {
    server.syncs++
    const hold = server.holdSync
    server.holdSync = null
    if (hold) await hold.p
    const extra = server.onSync ? server.onSync() : {}
    return json({ ok: server.syncStatus === 200, newAchievements: [], ...extra }, server.syncStatus)
  }
  if (method === 'POST' && url === '/api/student/save-action-link') {
    const { lessonId, link } = JSON.parse(init.body)
    const row = server.completions.find((c) => c.lesson_id === lessonId)
    row.discord_message_link = link
    return json({ completion: { ...row } })
  }
  server.unexpected.push(`${method} ${url}`)
  return json({ error: 'not here' }, 404)
}

// ── The real provider, from src/, with its imports pointed at the above ──────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'student-context-'))
const fileUrl = (p) => pathToFileURL(p).href
const REACT = fileUrl(require.resolve('react'))
fs.writeFileSync(path.join(TMP, 'auth.mjs'), [
  `import { createContext, useContext } from ${JSON.stringify(REACT)}`,
  'export const AuthStandIn = createContext(null)',
  'export function useAuth() { return useContext(AuthStandIn) }',
].join('\n'))
fs.writeFileSync(path.join(TMP, 'supabase-browser.mjs'), [
  '// The browser client: a session for getAccessToken, and plain tables for the reads.',
  'export const tables = { discount_feedback_questions: [], achievements: [], student_achievements: [], achievement_unlock_stats: [] }',
  'export const reads = []',
  'function from(table) {',
  '  const preds = []',
  '  const b = {',
  '    select() { return b },',
  '    eq(c, v) { preds.push((r) => r[c] === v); return b },',
  '    order() { return b },',
  '    then(res, rej) {',
  '      reads.push(table)',
  '      const rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r))).map((r) => ({ ...r }))',
  '      return Promise.resolve({ data: rows, error: null }).then(res, rej)',
  '    },',
  '  }',
  '  return b',
  '}',
  'export function createClient() { return { from } }',
  "export async function getSharedSession() { return { access_token: 'tok-1' } }",
].join('\n'))
const SPEC = {
  react: REACT,
  'react/jsx-runtime': fileUrl(require.resolve('react/jsx-runtime')),
  './AuthContext': fileUrl(path.join(TMP, 'auth.mjs')),
  '@/contexts/AuthContext': fileUrl(path.join(TMP, 'auth.mjs')),
  '@/lib/supabase-browser': fileUrl(path.join(TMP, 'supabase-browser.mjs')),
  '@/lib/call-gate': fileUrl(here('./_gen/stub-call-gate.ts')),
  '@/lib/titles': fileUrl(here('./_gen/titles.ts')),
  '@/lib/constants': fileUrl(here('./_gen/constants.ts')),
  '@/lib/progress': fileUrl(here('./_gen/progress.ts')),
}
async function load(rel) {
  const src = fs.readFileSync(here(`../${rel}`), 'utf8')
  let js = ts.transpileModule(src, {
    fileName: path.basename(rel),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  js = js.replace(/from "([^"]+)"/g, (_m, spec) => {
    if (!(spec in SPEC)) throw new Error(`${rel} imports ${spec}, which has no stand-in here`)
    return `from ${JSON.stringify(SPEC[spec])}`
  })
  const out = path.join(TMP, `${path.basename(rel).replace(/\.tsx?$/, '')}.mjs`)
  fs.writeFileSync(out, js)
  return import(fileUrl(out))
}
const React = require('react')
const { createRoot } = require('react-dom/client')
const h = React.createElement
const { AuthStandIn } = await import(SPEC['./AuthContext'])
const { StudentProvider, useStudent } = await load('src/contexts/StudentContext.tsx')

// ── Mounting ─────────────────────────────────────────────────────────────────
const view = { ctx: null, setStudent: null, renders: [] }
function AuthHost({ initial, children }) {
  // A plain useState setter, as the real AuthProvider hands out.
  const [student, setStudent] = React.useState(initial)
  view.setStudent = setStudent
  return h(AuthStandIn.Provider, { value: { student, setStudent } }, children)
}
function StudentProbe() {
  const ctx = useStudent()
  view.ctx = ctx
  view.renders.push(ctx)
  return null
}
/** Lets React, the stand-in requests and their promise chains run. */
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)) }
async function mount(...extra) {
  // Past the module-level 5 s gate and the 30 s sync throttle of the last mount.
  advance(60_000)
  view.renders = []
  const container = Object.assign(new Target(), {
    nodeType: 1, nodeName: 'DIV', tagName: 'DIV', namespaceURI: null, ownerDocument: doc, childNodes: [], firstChild: null,
  })
  const root = createRoot(container)
  root.render(h(AuthHost, { initial: { ...STUDENT } }, h(StudentProvider, null, h(StudentProbe), ...extra)))
  await settle()
  return root
}
const lesson = (id) => view.ctx.lessons.find((l) => l.id === id)
const row = (id) => view.ctx.completions.find((c) => c.lesson_id === id)

console.log('\n=== A refresh no longer runs the first load again (lessons-2, progress-2) ===')
{
  seed()
  const root = await mount()
  ok(view.ctx.loading === false && view.ctx.lessons.length === 5 && view.ctx.regions.length === 2 && view.ctx.completions.length === 2,
     'the first load sets the course and the progress', `${view.ctx.lessons.length} lessons, ${view.ctx.regions.length} places, ${view.ctx.completions.length} completions`)
  ok(server.syncs === 1 && server.dataReads === 2,
     'a page load reads the data twice: the first load and the Whop sync\'s refresh (it was 3)', `${server.dataReads} reads, ${server.syncs} sync`)

  // Back to the tab after 31 s: the sync runs again and the focus refreshes.
  advance(31_000)
  const before = server.dataReads
  window.dispatchEvent(new Event('focus'))
  await settle()
  ok(server.syncs === 2 && server.dataReads - before === 2,
     'a return to the tab reads it twice: the focus refresh and the sync\'s (it was up to 4)', `${server.dataReads - before} reads`)

  // A lesson finished in the app. (This stand-in server never stores it, so
  // only the v74 guard keeps it on the page for its 3 s.)
  advance(1_000)
  const atFinish = server.dataReads
  view.ctx.markWatched('a1l02')
  await settle()
  ok(server.dataReads - atFinish === 1, 'a finished lesson reads it once (it was 2)', `${server.dataReads - atFinish} reads`)
  ok(row('a1l02')?.completed_at, 'and no read replaces the list past the v74 guard: the lesson just finished stays finished')
  root.unmount()
}

console.log('\n=== A refresh that fails leaves a loaded map alone (map-1) ===')
{
  seed()
  const root = await mount()
  // A refresh answers, and the next read dies on the network: the laptop lid, a Wi-Fi switch.
  server.dataPlan = ['ok', 'reject']
  advance(1_000)
  view.ctx.markWatched('a1l02')
  await settle()
  // Then a return to the tab whose own read dies too (the sync is inside its 30 s).
  advance(6_000)
  window.dispatchEvent(new Event('focus'))
  await settle()
  ok(view.ctx.loadError === null, 'no error is set: the map and an open lesson stay up', `loadError ${show(view.ctx.loadError)}`)
  ok(view.ctx.lessons.length === 5 && view.ctx.regions.length === 2 && row('a1l01'),
     'the course and the progress are the last good ones', `${view.ctx.lessons.length} lessons, ${view.ctx.completions.length} completions`)
  root.unmount()
}

console.log('\n=== A refresh whose catalog comes back empty leaves the map alone (map-1) ===')
{
  seed()
  const root = await mount()
  // A 200 with an empty catalog: what a failed catalog read looked like before the route answered 500.
  server.dataOver = { lessons: [], regions: [] }
  advance(6_000)
  window.dispatchEvent(new Event('focus'))
  await settle()
  server.dataOver = null
  ok(view.ctx.lessons.length === 5 && view.ctx.regions.length === 2,
     'it is not applied: the map keeps its places and lessons', `${view.ctx.lessons.length} lessons, ${view.ctx.regions.length} places`)
  root.unmount()
}

console.log('\n=== The catalog still reaches an open tab (progress-2) ===')
{
  seed()
  const root = await mount()
  ok(lesson('a1l03')?.has_video === false, 'a lesson with no video yet', show(lesson('a1l03')?.has_video))
  // The team adds its video and renames a place while the student has the map open.
  server.lessons = server.lessons.map((l) => (l.id === 'a1l03' ? { ...l, has_video: true } : l))
  server.regions = server.regions.map((r) => (r.id === 'a2' ? { ...r, name: 'Marketing Basics' } : r))
  advance(6_000)
  window.dispatchEvent(new Event('focus'))
  await settle()
  ok(lesson('a1l03')?.has_video === true, 'a refresh brings the new video in without a reload', show(lesson('a1l03')?.has_video))
  ok(view.ctx.regions.find((r) => r.id === 'a2')?.name === 'Marketing Basics', 'and the renamed place')
  root.unmount()
}

console.log('\n=== A saved Discord link is not put back by a read from before the save (progress-2) ===')
{
  seed()
  const root = await mount()
  // A return to the tab: its read is taken now (no link yet) and answered later.
  advance(6_000)
  server.holdData = deferred()
  const stale = server.holdData
  window.dispatchEvent(new Event('focus'))
  await settle()
  // The student pastes the link and saves it while that read is on its way.
  const error = await view.ctx.saveDiscordLink('a1l05', LINK)
  await settle()
  ok(error === null && row('a1l05')?.discord_message_link === LINK, 'the save is answered and shown', show(error))
  const savedAt = view.renders.length
  stale.resolve()
  await settle()
  const after = view.renders.slice(savedAt).map((c) => c.completions.find((x) => x.lesson_id === 'a1l05')?.discord_message_link ?? null)
  ok(row('a1l05')?.discord_message_link === LINK && after.every((l) => l === LINK),
     'the older read lands and the link stays: it never goes back to the empty form', `${after.length} renders after the save: ${show([...new Set(after)])}`)
  root.unmount()
}

console.log('\n=== An error from a failed load is cleared by the next good one (map-1) ===')
{
  seed()
  server.dataPlan = ['reject']
  const root = await mount()
  ok(typeof view.ctx.loadError === 'string', 'a first load that dies on the network says so', show(view.ctx.loadError))
  // Another student signs in on the same page (the load is keyed on the id).
  view.setStudent({ ...STUDENT, id: 's2' })
  await settle()
  ok(view.ctx.loadError === null && view.ctx.lessons.length === 5, 'the next good load clears it', `loadError ${show(view.ctx.loadError)}`)
  root.unmount()
}

console.log('\n=== Nothing else was asked of the server ===')
ok(server.unexpected.length === 0, 'every request was one this file answers, with the token', show(server.unexpected))

fs.rmSync(TMP, { recursive: true, force: true })
Date.now = realNow
console.log(`\n  (a focus refresh whose read failed rejected inside the focus handler ${unhandled.length} time(s), as it does in a browser's console)`)
console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
process.exit(0)
