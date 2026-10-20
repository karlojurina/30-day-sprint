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
// AND THE BADGES (progress-3, streak-1). Badges awarded on the server for
// lessons finished on Whop (the visit's sync, Whop's webhook) never reached an
// open map: the corner reads the student's unlocks again only on the window
// event `et:achievements-changed`, and the Whop sync never sent it. The last
// sections run the corner's real hook (src/components/world/useWorldBadges.ts)
// beside the provider and watch its count and its toast queue.
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
  /** student_milestones: null, or a row (a graduate has playbook_unlocked_at). */
  milestones: null,
  /** POST /api/discounts/request: applications sent with no answers. */
  plainRequests: 0,
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
  /** student_lesson_ratings for the student, as GET /api/student/data hands them over. */
  ratings: [],
  /** POST /api/student/rate-lesson answers, oldest first: 'ok', 'reject' (a dead connection), or { status, error }. Empty: 'ok'. */
  ratePlan: [],
  /** Every rating the provider sent. */
  rateCalls: [],
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
  Object.assign(server, { milestones: null, plainRequests: 0, dataPlan: [], holdData: null, dataOver: null, syncStatus: 200, onSync: null, holdSync: null, dataReads: 0, syncs: 0 })
  Object.assign(server, { ratings: [], ratePlan: [], rateCalls: [] })
}
function payload() {
  return {
    student: { ...STUDENT },
    regions: server.regions,
    lessons: server.lessons,
    completions: server.completions,
    discountRequest: null,
    quizzes: [], quizQuestions: [], quizAttempts: [], monthReview: null,
    milestones: server.milestones,
    streaks: server.streak,
    whopSync: null, celebrations: null, dmLog: null,
    regionQuiz: [], lessonRatings: server.ratings, watchProgress: [],
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
  if (method === 'POST' && url === '/api/student/rate-lesson') {
    // The rating route (admin rebuild 2, D10): it saves and answers the row, or refuses in its words.
    const { lessonId, stars, comment } = JSON.parse(init.body)
    server.rateCalls.push({ lessonId, stars, comment })
    const plan = server.ratePlan.shift() ?? 'ok'
    if (plan === 'reject') throw new TypeError('Failed to fetch')
    if (typeof plan === 'object') return json(plan.error === null ? {} : { error: plan.error }, plan.status)
    const at = new Date(clock).toISOString()
    const saved = { lesson_id: lessonId, stars, comment, created_at: at, updated_at: at }
    server.ratings = [...server.ratings.filter((r) => r.lesson_id !== lessonId), saved]
    return json({ rating: saved })
  }
  if (method === 'POST' && url === '/api/discounts/request') {
    // The plain 30% request: an application with no answers for the team.
    server.plainRequests++
    return json({ id: 'r1', status: 'pending', created_at: new Date(clock).toISOString(), rejection_reason: null })
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
  '/** table -> how many of its next reads fail, as postgrest-js reports one: no data, an error. */',
  'export const failing = new Map()',
  'function from(table) {',
  '  const preds = []',
  '  const b = {',
  '    select() { return b },',
  '    eq(c, v) { preds.push((r) => r[c] === v); return b },',
  '    order() { return b },',
  '    then(res, rej) {',
  '      reads.push(table)',
  '      if (failing.get(table) > 0) {',
  '        failing.set(table, failing.get(table) - 1)',
  "        return Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout' } }).then(res, rej)",
  '      }',
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
const browserDb = await import(SPEC['@/lib/supabase-browser'])
const { StudentProvider, useStudent } = await load('src/contexts/StudentContext.tsx')
const { useWorldBadges } = await load('src/components/world/useWorldBadges.ts')
// The map's own reading of the provider (which card /world shows) and the
// 30% panel's hook, from src/, over the same provider: their imports go to
// the copy of StudentContext loaded above and to build.mjs's real copies.
Object.assign(SPEC, {
  '@/contexts/StudentContext': fileUrl(path.join(TMP, 'StudentContext.mjs')),
  '@/lib/world/catalog': fileUrl(here('./_gen/catalog.ts')),
  '@/lib/world/map-model': fileUrl(here('./_gen/map-model.ts')),
  '@/lib/world/discount': fileUrl(here('./_gen/discount.ts')),
  '@/lib/discount-feedback': fileUrl(here('./_gen/discount-feedback.ts')),
})
SPEC['@/lib/world/useWorldCatalog'] = fileUrl(path.join(TMP, 'useWorldCatalog.mjs'))
await load('src/lib/world/useWorldCatalog.ts')
const { useMapModel } = await load('src/components/world/useMapModel.ts')
const { useWorldDiscount } = await load('src/components/world/useWorldDiscount.ts')

// ── Mounting ─────────────────────────────────────────────────────────────────
const view = { ctx: null, setStudent: null, renders: [], map: null, mapStatuses: [], discount: null }
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
function BadgeProbe() {
  view.badges = useWorldBadges()
  return null
}
/** Which card /world shows, every render: loading, error, empty, shape or ready. */
function MapProbe() {
  const { status } = useMapModel()
  view.map = status
  view.mapStatuses.push(status)
  return null
}
function DiscountProbe() {
  view.discount = useWorldDiscount()
  return null
}
/** Lets React, the stand-in requests and their promise chains run. */
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)) }
/** Real time, for the first load's retry timers (FIRST_LOAD_RETRY_MS: 1 s, then 3 s). */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function mount(...extra) {
  // Past the module-level 5 s gate and the 30 s sync throttle of the last mount.
  advance(60_000)
  view.renders = []
  view.mapStatuses = []
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

console.log('\n=== A refresh whose read of the videos failed leaves an open map\'s videos alone (map-1) ===')
{
  seed()
  const root = await mount()
  ok(lesson('a1l01')?.has_video === true && lesson('a2l01')?.has_video === true, 'two lessons with a video on the map', show([lesson('a1l01')?.has_video, lesson('a2l01')?.has_video]))
  // The route could not read lesson_videos: every has_video in its answer is
  // false, and it says so. A lesson's title changed in the same answer.
  server.lessons = server.lessons.map((l) => (l.id === 'a1l02' ? { ...l, title: 'Renamed' } : l))
  server.dataOver = { lessons: server.lessons.map((l) => ({ ...l, has_video: false })), lessonVideosFailed: true }
  advance(6_000)
  window.dispatchEvent(new Event('focus'))
  await settle()
  server.dataOver = null
  ok(lesson('a1l01')?.has_video === true && lesson('a2l01')?.has_video === true && lesson('a1l03')?.has_video === false,
     'each lesson keeps the has_video it had: none turns into "Not recorded yet"', show(view.ctx.lessons.map((l) => l.has_video)))
  ok(lesson('a1l02')?.title === 'Renamed', '  while the rest of the answer is applied (a renamed lesson)', show(lesson('a1l02')?.title))
  // The next answer that read the videos is taken as it is: a video added since, one taken down.
  server.lessons = server.lessons.map((l) => (l.id === 'a1l03' ? { ...l, has_video: true } : l.id === 'a2l01' ? { ...l, has_video: false } : l))
  advance(6_000)
  window.dispatchEvent(new Event('focus'))
  await settle()
  ok(lesson('a1l03')?.has_video === true && lesson('a2l01')?.has_video === false, 'and a refresh that read them applies them as they are', show(view.ctx.lessons.map((l) => l.has_video)))
  root.unmount()
}
{
  // A first load has none to keep: the lessons show as not recorded until a refresh reads them.
  seed()
  server.dataPlan = ['ok']
  server.dataOver = { lessons: server.lessons.map((l) => ({ ...l, has_video: false })), lessonVideosFailed: true }
  server.holdSync = deferred()
  const sync = server.holdSync
  const root = await mount()
  ok(view.ctx.lessons.length === 5 && view.ctx.lessons.every((l) => l.has_video === false), 'a first load whose read of the videos failed: none to keep, every lesson without one')
  server.dataOver = null
  sync.resolve()
  await settle()
  ok(lesson('a1l01')?.has_video === true && lesson('a1l03')?.has_video === false, 'the sync\'s refresh reads them and brings them in', show(view.ctx.lessons.map((l) => l.has_video)))
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

// ── A first load that fails (T-026, review findings 1 and 2) ─────────────────
const QUESTIONS = [
  { id: 'q2', question_text: 'How did the course go?', question_type: 'open_text', order_num: 2, is_active: true, is_required: true },
  { id: 'q1', question_text: 'How sure are you?', question_type: 'scale', scale_min: 1, scale_max: 10, order_num: 1, is_active: true, is_required: true },
]
const GRADUATE = { student_id: 's1', playbook_unlocked_at: '2026-10-19T18:00:00.000Z' }
/** The Playbook page's redirect fires on a render with loading false, no loadError and playbookUnlocked false. */
const bounced = () => view.renders.filter((c) => !c.loading && !c.loadError && !c.playbookUnlocked).length
const questionReads = () => browserDb.reads.filter((t) => t === 'discount_feedback_questions').length

console.log('\n=== A first load answered 500 is asked again: the map never shows an empty course (T-026) ===')
{
  seed()
  browserDb.tables.discount_feedback_questions = QUESTIONS
  server.syncStatus = 502 // no sync refresh: the retry alone
  server.dataPlan = [500]
  const root = await mount(h(MapProbe))
  ok(view.ctx.loading === true && view.ctx.loadError === null && view.map === 'loading',
     'after the 500 the map still says it is loading while the retry waits', `loading ${view.ctx.loading}, map ${view.map}`)
  await sleep(1_100)
  await settle()
  ok(server.dataReads === 2 && view.ctx.loading === false && view.ctx.loadError === null && view.ctx.lessons.length === 5 && view.ctx.completions.length === 2,
     'the retry 1 s later loads it', `${server.dataReads} reads, ${view.ctx.lessons.length} lessons, loadError ${show(view.ctx.loadError)}`)
  ok(view.ctx.discountFeedbackQuestions.length === 2, 'the 30% questions with it', `${view.ctx.discountFeedbackQuestions.length} questions`)
  ok(!view.mapStatuses.includes('empty') && !view.mapStatuses.includes('error'),
     'and no render showed "There are no lessons here yet." or the error card', show([...new Set(view.mapStatuses)]))
  root.unmount()
}

console.log('\n=== A first load that keeps failing says so, and a refresh answered later loads everything (T-026) ===')
{
  seed()
  browserDb.tables.discount_feedback_questions = QUESTIONS
  server.milestones = GRADUATE
  server.syncStatus = 502
  server.dataPlan = [500, 'reject', 500]
  const root = await mount(h(MapProbe))
  await sleep(1_100)
  await settle()
  ok(server.dataReads === 2 && view.ctx.loading === true && view.ctx.loadError === null, 'asked again after 1 s, still loading', `${server.dataReads} reads`)
  await sleep(3_100)
  await settle()
  ok(server.dataReads === 3 && view.ctx.loading === false && typeof view.ctx.loadError === 'string',
     'asked a third time after 3 s more, then loadError is set', `${server.dataReads} reads, loadError ${show(view.ctx.loadError)}`)
  ok(view.map === 'error' && !view.mapStatuses.includes('empty'),
     '/world shows "Your course didn\'t load." with Try again, never "There are no lessons here yet."', `map ${view.map}, ${show([...new Set(view.mapStatuses)])}`)
  ok(view.ctx.playbookUnlocked === false && bounced() === 0,
     'a graduate on the Playbook page is not sent away: no render has loading false with no error and no Playbook', `${bounced()} such renders`)
  // Back to the tab later: the sync fails again, the focus refresh is answered.
  advance(31_000)
  window.dispatchEvent(new Event('focus'))
  await settle()
  ok(view.ctx.loadError === null && view.ctx.loading === false && view.ctx.lessons.length === 5 && view.ctx.regions.length === 2 && view.ctx.completions.length === 2 && view.ctx.streak.current === 2,
     'the refresh loads everything and clears the error', `loadError ${show(view.ctx.loadError)}, ${view.ctx.lessons.length} lessons, streak ${view.ctx.streak.current}`)
  ok(view.ctx.playbookUnlocked === true && view.ctx.discountFeedbackQuestions.length === 2 && view.map === 'shape',
     'the graduate has the Playbook, the 30% has its questions, the map has its places', `playbook ${view.ctx.playbookUnlocked}, ${view.ctx.discountFeedbackQuestions.length} questions, map ${view.map}`)
  ok(bounced() === 0, 'and at no render on the way was the graduate sent away', `${bounced()} such renders`)
  root.unmount()
}

console.log('\n=== The review\'s case: first load 500, then the sync\'s refresh is answered (map-1) ===')
{
  seed()
  browserDb.tables.discount_feedback_questions = QUESTIONS
  server.dataPlan = [500]
  const root = await mount(h(MapProbe))
  ok(server.dataReads === 2 && view.ctx.lessons.length === 5 && view.ctx.regions.length === 2 && view.ctx.discountFeedbackQuestions.length === 2,
     'the sync\'s refresh is a whole first load: lessons, places and the 30% questions (they stayed 0 for the visit)', `${view.ctx.lessons.length} lessons, ${view.ctx.regions.length} places, ${view.ctx.discountFeedbackQuestions.length} questions`)
  ok(view.ctx.loading === false && view.ctx.loadError === null && !view.mapStatuses.includes('empty'), 'loaded, with no empty card on the way', show([...new Set(view.mapStatuses)]))
  await sleep(1_100)
  await settle()
  ok(server.dataReads === 2, 'the retry it had waiting asks nothing: the data is in', `${server.dataReads} reads`)
  const before = questionReads()
  advance(31_000)
  window.dispatchEvent(new Event('focus'))
  await settle()
  ok(view.ctx.discountFeedbackQuestions.length === 2 && questionReads() === before,
     'still there after a return to the tab 31 s later, and not read again while held', `${view.ctx.discountFeedbackQuestions.length} questions, ${questionReads() - before} reads`)
  root.unmount()
}

console.log('\n=== The questions\' own read fails once: the next refresh reads them again (map-1) ===')
{
  seed()
  browserDb.tables.discount_feedback_questions = QUESTIONS
  browserDb.failing.set('discount_feedback_questions', 1)
  server.syncStatus = 502
  const root = await mount()
  ok(view.ctx.loading === false && view.ctx.lessons.length === 5 && view.ctx.discountFeedbackQuestions.length === 0,
     'the course loads, the questions do not', `${view.ctx.discountFeedbackQuestions.length} questions`)
  advance(6_000)
  window.dispatchEvent(new Event('focus'))
  await settle()
  ok(view.ctx.discountFeedbackQuestions.length === 2, 'the next refresh brings them', `${view.ctx.discountFeedbackQuestions.length} questions`)
  root.unmount()
}

console.log('\n=== Apply reads the questions before it would send an application without the form (map-1) ===')
{
  // A student whose 30% is open: paid 2 days ago, every video up to the gate watched.
  const ready = () => {
    seed()
    STUDENT.first_paid_at = new Date(clock - 2 * 86_400_000).toISOString()
    server.lessons = server.lessons.map((l) => (l.id === 'a1l02' ? { ...l, is_gate: true } : l))
    server.completions.push({ id: 'c2', student_id: 's1', lesson_id: 'a1l02', completed_at: '2026-10-19T18:05:00.000Z', action_completed_at: null, skipped_at: null, discord_message_link: null })
    browserDb.tables.discount_feedback_questions = QUESTIONS
    browserDb.failing.set('discount_feedback_questions', 1)
    server.syncStatus = 502
  }
  const paidAt = STUDENT.first_paid_at
  ready()
  let root = await mount(h(DiscountProbe))
  ok(view.discount.state.kind === 'ready' && view.ctx.discountFeedbackQuestions.length === 0,
     'the 30% is open to apply for, and the visit\'s read of the questions failed', `${view.discount.state.kind}, ${view.ctx.discountFeedbackQuestions.length} questions`)
  let said = await view.discount.apply()
  await settle()
  ok(said === null && view.discount.form.open === true && view.discount.form.questions.length === 2 && server.plainRequests === 0,
     'Apply reads them, finds 2 and opens the form: no application goes in without the answers', `said ${show(said)}, form ${view.discount.form.open}, ${view.discount.form.questions.length} questions, ${server.plainRequests} plain requests`)
  root.unmount()

  ready()
  root = await mount(h(DiscountProbe))
  browserDb.failing.set('discount_feedback_questions', 1)
  said = await view.discount.apply()
  await settle()
  ok(typeof said === 'string' && /reach the server/.test(said) && view.discount.form.open === false && server.plainRequests === 0,
     'a read that fails again sends nothing and says so', show(said))
  root.unmount()

  ready()
  browserDb.tables.discount_feedback_questions = []
  root = await mount(h(DiscountProbe))
  said = await view.discount.apply()
  await settle()
  ok(said === null && view.discount.form.open === false && server.plainRequests === 1,
     'with no active questions at all, Apply sends the plain request, as before', `${server.plainRequests} plain requests`)
  root.unmount()
  STUDENT.first_paid_at = paidAt
}

// ── The badges (progress-3, streak-1) ────────────────────────────────────────
let badgeEvents = 0
window.addEventListener('et:achievements-changed', () => { badgeEvents++ })
const CATALOG = [
  { id: 'first_lesson', name: 'First Steps', sort_order: 1 },
  { id: 'triple_threat', name: 'Triple Threat', sort_order: 2 },
  { id: 'habit_builder', name: 'Habit Builder', sort_order: 3 },
]
/** A badge the server awards: a student_achievements row the browser can read. */
const award = (id) => browserDb.tables.student_achievements.push({ student_id: 's1', achievement_id: id, unlocked_at: new Date(clock).toISOString() })
const held = () => [...view.badges.book.mine.keys()].sort()
const toasts = () => view.badges.fresh.map((a) => a.name)

console.log('\n=== The Whop sync tells the corner to read the badges again (progress-3, streak-1) ===')
{
  seed()
  browserDb.tables.achievements = CATALOG
  browserDb.tables.student_achievements = []
  // The visit's sync is slow (it pages through Whop), so the corner reads the badges first.
  server.holdSync = deferred()
  const sync = server.holdSync
  // On the server the sync backfills the lessons finished on Whop and awards a badge for them.
  server.onSync = () => { award('first_lesson'); return { newAchievements: ['first_lesson'] } }
  badgeEvents = 0
  const root = await mount(h(BadgeProbe))
  ok(view.badges.status === 'ready' && held().length === 0, 'the corner has read the badges before the sync answers: none held', `${view.badges.status}, ${show(held())}`)
  sync.resolve()
  await settle()
  ok(badgeEvents === 1, 'the sync\'s answer sends et:achievements-changed once', `${badgeEvents} events`)
  ok(show(held()) === show(['first_lesson']), 'so the count in the pill goes up without a reload', show(held()))
  ok(show(toasts()) === show(['First Steps']) && view.badges.newIds.has('first_lesson'), 'and the toast plays it, marked New in the list', show(toasts()))

  // Whop's webhook awards one while the map is open; the sync on the return to the tab lists none.
  view.badges.announced()
  award('triple_threat')
  server.onSync = () => ({ newAchievements: [] })
  advance(31_000)
  window.dispatchEvent(new Event('focus'))
  await settle()
  ok(badgeEvents === 2 && show(held()) === show(['first_lesson', 'triple_threat']) && show(toasts()) === show(['Triple Threat']),
     'a badge the webhook awarded is picked up at the next sync, whose answer lists none', `${badgeEvents} events, ${show(held())}, toasts ${show(toasts())}`)
  root.unmount()
}
{
  seed()
  browserDb.tables.student_achievements = []
  server.syncStatus = 502
  badgeEvents = 0
  const root = await mount(h(BadgeProbe))
  ok(badgeEvents === 0, 'a sync that fails sends nothing', `${badgeEvents} events`)
  // The debug panel's forced sync: once when it works, not when it fails.
  advance(1_000)
  const failed = await view.ctx.forceSync()
  server.syncStatus = 200
  advance(1_000)
  const worked = await view.ctx.forceSync()
  await settle()
  ok(failed.ok === false && worked.ok === true && badgeEvents === 1, 'a forced sync sends it when it works, and not when it fails', `${badgeEvents} events`)
  root.unmount()
}

console.log('\n=== A lesson rating: saved only when the server says so, and not put back by an older read (admin rebuild 2, D10) ===')
{
  seed()
  server.ratings = [{ lesson_id: 'a1l02', stars: 2, comment: 'Old one.', created_at: '2026-10-19T18:00:00.000Z', updated_at: '2026-10-19T18:00:00.000Z' }]
  const root = await mount()
  const rating = (id) => view.ctx.lessonRatings.get(id) ?? null
  ok(show(rating('a1l02')) === show({ stars: 2, comment: 'Old one.' }), 'the first load brings the saved ratings in', show(rating('a1l02')))

  const saved = await view.ctx.rateLesson('a1l01', 4, '  Clear and short.  ')
  await settle()
  ok(saved === null && show(rating('a1l01')) === show({ stars: 4, comment: 'Clear and short.' }),
     'a rating the route saves: null, and the saved row is shown (the comment as the route kept it)', show([saved, rating('a1l01')]))
  ok(show(server.rateCalls.at(-1)) === show({ lessonId: 'a1l01', stars: 4, comment: 'Clear and short.' }),
     'what was sent: the lesson, the stars as picked, the comment trimmed', show(server.rateCalls.at(-1)))

  server.ratePlan.push({ status: 403, error: 'Finish this lesson first, then rate it.' })
  const refused = await view.ctx.rateLesson('a1l03', 5, null)
  await settle()
  ok(refused === 'Finish this lesson first, then rate it.' && rating('a1l03') === null,
     "a refusal: the route's own sentence, and nothing shown as saved (it is not optimistic any more)", show(refused))

  server.ratePlan.push({ status: 403, error: 'Finish this lesson first, then rate it.' })
  const edit = await view.ctx.rateLesson('a1l02', 5, 'New one.')
  await settle()
  ok(edit === 'Finish this lesson first, then rate it.' && show(rating('a1l02')) === show({ stars: 2, comment: 'Old one.' }),
     'a refused edit leaves the saved rating as it was', show(rating('a1l02')))

  server.ratePlan.push('reject')
  const offline = await view.ctx.rateLesson('a1l03', 5, null)
  ok(offline === "Couldn't reach the server. Nothing was saved, so try again." && rating('a1l03') === null, 'no answer: its own sentence', show(offline))
  server.ratePlan.push({ status: 502, error: null })
  const bare = await view.ctx.rateLesson('a1l03', 5, null)
  ok(bare === "Couldn't save your rating (502). Try again." && rating('a1l03') === null, 'an answer with no sentence: one with the status', show(bare))

  // A return to the tab: its read is taken now (before the save) and answered after it.
  advance(6_000)
  server.holdData = deferred()
  const stale = server.holdData
  window.dispatchEvent(new Event('focus'))
  await settle()
  server.ratings = server.ratings.filter((r) => r.lesson_id !== 'a2l01')
  const late = await view.ctx.rateLesson('a2l01', 3, null)
  await settle()
  ok(late === null && show(rating('a2l01')) === show({ stars: 3, comment: null }), 'a rating saved while an older read is on its way', show(rating('a2l01')))
  const savedAt = view.renders.length
  stale.resolve()
  await settle()
  const after = view.renders.slice(savedAt).map((c) => c.lessonRatings.get('a2l01')?.stars ?? null)
  ok(rating('a2l01')?.stars === 3 && after.every((n) => n === 3),
     'the older read lands and the rating stays: the block never goes back to empty', `${after.length} renders after the save: ${show([...new Set(after)])}`)
  ok(show(rating('a1l01')) === show({ stars: 4, comment: 'Clear and short.' }) && show(rating('a1l02')) === show({ stars: 2, comment: 'Old one.' }),
     '...and the read still brings every other rating as the server has it')

  // Past the guard's 3 seconds, a read is taken as it is.
  advance(6_000)
  server.ratings = server.ratings.filter((r) => r.lesson_id !== 'a2l01')
  window.dispatchEvent(new Event('focus'))
  await settle()
  ok(rating('a2l01') === null, 'past the guard\'s 3 seconds a read is taken as it is (a rating the server no longer has goes)', show(rating('a2l01')))
  root.unmount()
}

console.log('\n=== Nothing else was asked of the server ===')
ok(server.unexpected.length === 0, 'every request was one this file answers, with the token', show(server.unexpected))
// A refresh whose request dies resolves to its reason now (the first load needs
// it); it used to reject inside the focus handler, a line in the console.
ok(unhandled.length === 0, 'no refresh rejected anywhere', show(unhandled))

fs.rmSync(TMP, { recursive: true, force: true })
Date.now = realNow
console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
process.exit(0)
