// done-only.test.mjs: the action items with nothing to post (the owner,
// 2026-10-22: "some action items do not need an action ... There's no need to
// post anything inside Discord ... We just have to be able to click Done, and
// then the next lesson opens up"). The four of AI Ads + Content are finished
// with a Done button and no Discord link; the other six still need theirs.
// On the real source:
//
//   1. the one list   DONE_ONLY_ACTION_ITEMS and isDoneOnly (action-items.ts),
//                     held to supabase/catalog/course_catalog.json, and no
//                     other file in src/ naming the four
//   2. the block      ActionItemBlock.tsx rendered by React's server renderer,
//                     both kinds in every state, and the lesson page choosing
//                     the kind by isDoneOnly
//   3. the route      mark-action-shipped on the new course: each of the four
//                     completes with no link; a link on its row is kept and a
//                     link in the body is not read (never written); each of
//                     the other six without a link is refused as before, with
//                     one it goes through. save-action-link still stores a
//                     link sent for one of the four (the page never sends one)
//   4. after Done     the row, the steps, the streak day, the badges and the
//                     map's next lesson, read back through isLessonComplete,
//                     the real update-streak.ts, the real badge engine
//                     (achievements.ts) and the real map (catalog.ts,
//                     map-model.ts), the same as a hand-in with a link
//   5. the drawer     buildStudentDetail's action items: "Done" and no link
//                     for the four, even a link saved before 2026-10-22;
//                     "Handed in" with it for the others; "Not yet"
//
// build.mjs copies the modules and the two routes (run it first; `npm run
// test:client` does); the block is compiled here as Next compiles it, into
// _gen/done-only-block.mjs. The database is stub-server.ts's stand-in, whose
// streak steps run the real update-streak.ts. Every student, id and link
// here is made up.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')

// The lesson page's block, compiled as Next compiles it (types out, JSX to
// react/jsx-runtime), its two imports pointed at the copy of action-items.ts
// and at a stand-in for the CSS module that names each class by its own name.
{
  let s = ts.transpileModule(fromSrc('src/components/world/ActionItemBlock.tsx'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  for (const [from, to] of [
    ['from "@/lib/world/action-items"', 'from "./action-items.ts"'],
    ['import u from "@/components/world/world-ui.module.css";', 'const u = new Proxy({}, { get: (_, k) => (typeof k === "string" ? k : undefined) });'],
  ]) {
    if (!s.includes(from)) throw new Error(`ActionItemBlock.tsx has no ${from}`)
    s = s.split(from).join(to)
  }
  if (/(?:from|import)\s*["']@\//.test(s)) throw new Error('an unrewritten @/ import remains in ActionItemBlock.tsx')
  fs.writeFileSync(here('./_gen/done-only-block.mjs'), s)
}

const { ActionItemBlock } = await import('./_gen/done-only-block.mjs')
const { DONE_ONLY_ACTION_ITEMS, PASTE_LINK_FIRST, actionItemView, isDoneOnly } = await import('./_gen/action-items.ts')
const { completedLessonIdsFor, isLessonComplete } = await import('./_gen/progress.ts')
const { POST: markShipped } = await import('./_gen/mark-action-shipped-route.ts')
const { POST: saveLink } = await import('./_gen/save-action-link-route.ts')
// useDb under another name: ESLint's React rules take a "use..." call for a hook.
const { FakeDb, fakeClient, useDb: openDb, setCatalog, steps } = await import('./_gen/stub-server.ts')
const { evaluateAchievements } = await import('./_gen/achievements.ts')
const { getTodayUtc } = await import('./_gen/streak.ts')
const { buildWorldCatalog } = await import('./_gen/catalog.ts')
const { buildMapModel } = await import('./_gen/map-model.ts')
const D = await import('./_gen/student-detail.ts')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const same = (a, b) => show(a) === show(b)

/** Runs `fn` with the console quiet; returns [result or thrown error, lines]. */
async function quietly(fn) {
  const real = [console.info, console.warn, console.error]
  const lines = []
  console.info = console.warn = console.error = (...a) => { lines.push(a.join(' ')) }
  try { return [await fn(), lines] } catch (e) { return [e, lines] } finally { [console.info, console.warn, console.error] = real }
}

/** The four the owner named, and the six that keep their link: typed here, on purpose. */
const FOUR = ['a6l03', 'a6l10', 'a6l17', 'a6l19']
const SIX = ['a3l17', 'a3l25', 'a5l08', 'a5l12', 'a5l22', 'a5l23']
const LINK = 'https://discord.com/channels/1100000000000000001/1200000000000000002/1300000000000000003'
const EARLIER = '2026-10-20T09:00:00.000Z'
/** The course switch, as admin_config holds it after v104 (made up to the second). */
const RESET = '2026-10-19T14:33:33.972Z'

// The real course, as GET /api/student/data hands it over after v101 and the
// video load (courseCatalog.ts builds the development page's rows the same way).
const CATALOG = JSON.parse(fromSrc('supabase/catalog/course_catalog.json'))
const LENGTHS = JSON.parse(fromSrc('src/app/dev/world-app/course-lengths.fixture.json'))
const REGIONS = CATALOG.areas.map((a, i) => ({ id: a.id, order_num: i + 1, name: a.name }))
const LESSONS = CATALOG.lessons.map((l, i) => ({
  id: l.id,
  region_id: l.area,
  type: l.type,
  title: l.title,
  description: null,
  sort_order: i + 1,
  requires_action: l.action_brief !== undefined,
  action_brief: l.action_brief ?? null,
  is_optional: false,
  is_gate: l.gate === true,
  counts_toward_progress: l.counts !== false,
  feature_key: l.feature_key ?? null,
  has_video: LENGTHS[l.id] > 0 && l.type === 'watch',
  duration_seconds: LENGTHS[l.id] ?? null,
}))
const lessonOf = (id) => LESSONS.find((l) => l.id === id)

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 1. The one list ===')
ok(same([...DONE_ONLY_ACTION_ITEMS].sort(), FOUR), 'DONE_ONLY_ACTION_ITEMS is the four the owner named', show([...DONE_ONLY_ACTION_ITEMS]))
ok(FOUR.every((id) => isDoneOnly(id)) && SIX.every((id) => !isDoneOnly(id)), 'isDoneOnly: yes for the four, no for the other six action items')
{
  const old = Array.from({ length: 78 }, (_, i) => `l${String(i + 1).padStart(3, '0')}`)
  const plain = LESSONS.filter((l) => !l.requires_action).map((l) => l.id)
  ok(old.every((id) => !isDoneOnly(id)) && plain.every((id) => !isDoneOnly(id)) && [null, undefined, '', 'A6L03', ' a6l03', 42].every((v) => !isDoneOnly(v)),
     'and no for the old course\'s l001 to l078, for every other lesson of the course, and for nothing, another case, a space or a number')
}
{
  const area = CATALOG.areas.find((a) => a.name === 'AI Ads + Content')
  const actions = CATALOG.lessons.filter((l) => l.action_brief)
  const inArea = actions.filter((l) => l.area === area?.id)
  ok(!!area && same(inArea.map((l) => l.id), FOUR) && inArea.every((l) => l.type === 'setup'),
     'course_catalog.json: the action items of AI Ads + Content are exactly the four, each a setup lesson (no video)', show(inArea.map((l) => `${l.id} ${l.type}`)))
  ok(same(actions.filter((l) => !FOUR.includes(l.id)).map((l) => l.id), SIX), 'and the course\'s other action items are the six', show(actions.map((l) => l.id)))
}
{
  // One source of truth: the four ids are written in action-items.ts and nowhere else in the app's code.
  const found = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name) && /["'`]a6l(03|10|17|19)["'`]/.test(fs.readFileSync(p, 'utf8'))) found.push(path.relative(here('..'), p))
    }
  }
  walk(here('../src'))
  ok(same(found.sort(), ['src/app/dev/admin/fixtures-people.ts', 'src/lib/world/action-items.ts']),
     'no file in src/ holds the four ids in a string but action-items.ts (and the admin dev page\'s made-up student who did a6l03)', show(found))
}

console.log('\n=== 2. The block, both kinds ===')
const render = (props) => renderToString(createElement(ActionItemBlock, {
  separateWatchHalf: false,
  row: null,
  onSave: async () => null,
  onComplete: async () => null,
  ...props,
}))
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()
const buttons = (html) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1]))
const row = (completed_at, action_completed_at, discord_message_link = null) => ({ completed_at, action_completed_at, discord_message_link })
const renders = []
{
  const html = render({ doneOnly: true })
  renders.push(html)
  ok(/data-hand-in="done"/.test(html) && /data-action-item="empty"/.test(html) && /aria-label="Action item"/.test(html),
     'Done kind, nothing done: the block says which kind it is, and is named "Action item"', html.slice(0, 160))
  ok(same(buttons(html), ['Done']) && !/<input/.test(html) && !/<a /.test(html) && !/<h2/.test(html) && !/discord/i.test(html),
     'one button, "Done"; no field, no link, no label and no word of Discord', show({ buttons: buttons(html), text: text(html) }))
}
{
  // A link saved on the row before 2026-10-22, the action not done: never shown, the button is still Done.
  const html = render({ doneOnly: true, row: row(null, null, LINK) })
  renders.push(html)
  ok(/data-action-item="empty"/.test(html) && same(buttons(html), ['Done']) && !html.includes(LINK) && !/discord/i.test(html),
     'Done kind, a link saved before: not shown, and the button is still Done', show(text(html)))
}
{
  const html = render({ doneOnly: true, row: row(EARLIER, EARLIER, LINK) })
  renders.push(html)
  ok(/data-action-item="completed"/.test(html) && /^Completed on [A-Za-z0-9, ]+\.$/.test(text(html)) && /<time dateTime="2026-10-20T09:00:00.000Z">/.test(html),
     'Done kind, done: "Completed on <date>." and nothing else', show(text(html)))
  ok(buttons(html).length === 0 && !/<a /.test(html) && !/No link saved|Add a link|Edit link|discord/i.test(html),
     'no button, no link, no "No link saved", no "Add a link", no "Edit link", no word of Discord, though the row holds a link', show(buttons(html)))
}
{
  const v = actionItemView(row(null, null, LINK), false, true)
  const done = actionItemView(row(EARLIER, EARLIER, LINK), false, true)
  const plain = actionItemView(null, false, true)
  ok(v.state === 'empty' && v.link === null && v.canComplete && done.state === 'completed' && done.link === null && !done.canComplete && plain.canComplete,
     'actionItemView, Done kind: never "saved", never a link, Done until done', show({ v, done, plain }))
  const waiting = actionItemView(row(null, EARLIER), true, true)
  ok(waiting.state === 'completed' && waiting.waitingOnVideo, 'on a video lesson (none of the four is one) the action alone still waits on the video, as the other kind does', show(waiting))
}
{
  const html = render({ doneOnly: false })
  renders.push(html)
  ok(/data-hand-in="link"/.test(html) && /<h2[^>]*>Discord link<\/h2>/.test(html) && /<input[^>]*type="url"/.test(html) && buttons(html).includes('Save') && !buttons(html).includes('Done'),
     'Discord kind, nothing saved: "Discord link" over a field and Save, as before; no Done', show(buttons(html)))
  const doneKind = render({ doneOnly: false, row: row(null, null, LINK) })
  renders.push(doneKind)
  ok(/data-action-item="saved"/.test(doneKind) && doneKind.includes(`href="${LINK}"`) && buttons(doneKind).includes('Complete lesson') && !buttons(doneKind).includes('Done'),
     'Discord kind, a link saved: the link and "Complete lesson", as before', show(buttons(doneKind)))
  const completed = render({ doneOnly: false, row: row(EARLIER, EARLIER, LINK) })
  renders.push(completed)
  ok(/data-action-item="completed"/.test(completed) && /Completed on/.test(text(completed)) && completed.includes(`href="${LINK}"`) && buttons(completed).includes('Edit link'),
     'Discord kind, done: "Completed on <date>." with the link, still editable, as before', show(text(completed)))
  ok(same(render({ row: row(null, null, LINK) }), doneKind), 'with no doneOnly the block is the Discord kind: every caller that does not say so gets the block it had')
}
ok(renders.every((h) => !/—|unlock|ecomtalent/i.test(text(h))), 'no em dash, no "unlock", no "EcomTalent" in any of them')
{
  const page = fromSrc('src/components/world/LessonScreen.tsx')
  ok(/import \{ isDoneOnly \} from "@\/lib\/world\/action-items";/.test(page) && page.includes('doneOnly={isDoneOnly(lesson.id)}'),
     'the lesson page picks the kind by isDoneOnly, from the lesson\'s id')
}

console.log('\n=== 3. The route, on the new course ===')
setCatalog({ v2: true })
const TODAY = getTodayUtc()
const yesterday = (() => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) })()
const LONG_AGO = '2026-09-01T08:00:00.000Z'
const RUNNING = { current_streak: 3, longest_streak: 5, last_streak_date: yesterday }

function freshDb(completions = []) {
  const db = new FakeDb({
    students: [{ id: 's1', supabase_user_id: 'auth-1', whop_user_id: 'user_1', email: 'student@example.com',
      joined_at: '2026-10-12T10:00:00.000Z', first_paid_at: '2026-10-12T10:00:00.000Z', last_active_at: LONG_AGO }],
    lessons: LESSONS.map(({ id, region_id, type, title, sort_order, requires_action, counts_toward_progress, duration_seconds }) =>
      ({ id, region_id, type, title, sort_order, requires_action, counts_toward_progress, duration_seconds })),
    student_lesson_completions: completions.map((c) => ({ student_id: 's1', ...c })),
    student_streaks: [{ student_id: 's1', ...RUNNING }],
    admin_config: [{ key: 'curriculum_reset_at', value: RESET }],
    student_achievements: [],
  }, { 'tok-1': 'auth-1' })
  openDb(db)
  steps.length = 0
  return db
}
const post = (body) => new Request('http://app/api/student/x', {
  method: 'POST',
  headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
async function call(handler, body) {
  const [res, log] = await quietly(() => handler(post(body)))
  if (res instanceof Error) return { status: 'threw', body: res.message, log }
  return { status: res.status, body: await res.json() }
}
const done = (lessonId, extra = {}) => call(markShipped, { lessonId, shipped: true, ...extra })
const rowOf = (db, id) => db.rows('student_lesson_completions').find((r) => r.lesson_id === id) ?? null
const stepNames = () => steps.map((s) => s.step)
const streakOf = (db) => { const r = db.rows('student_streaks')[0]; return { current: r.current_streak, longest: r.longest_streak, last: r.last_streak_date } }
const lastActive = (db) => db.rows('students')[0].last_active_at
/** The steps after a setup action item completed on the new course: the streak day, last active, the CSM hooks, badges, tasks. */
const AFTER = ['streak', 'active', 'r2', 'came-back', 'achievements', 'tasks']

for (const id of FOUR) {
  const db = freshDb()
  const r = await done(id)
  const got = rowOf(db, id)
  ok(r.status === 200 && !!got?.completed_at && !!got?.action_completed_at && got.discord_message_link === null && same(stepNames(), AFTER),
     `${id}, no row and no link: Done goes through, both halves set, no link, the same steps after it`, show({ status: r.status, row: got, steps: stepNames() }))
}
for (const id of SIX) {
  const db = freshDb()
  const r = await done(id)
  ok(r.status === 400 && r.body.error === PASTE_LINK_FIRST && rowOf(db, id) === null && steps.length === 0,
     `${id}, no row and no link: refused as before ("${PASTE_LINK_FIRST}"), nothing written, no step`, show(r))
}
for (const id of SIX.filter((x) => lessonOf(x).type === 'watch')) {
  const db = freshDb([{ lesson_id: id, completed_at: EARLIER, action_completed_at: null, discord_message_link: null }])
  const r = await done(id)
  ok(r.status === 400 && rowOf(db, id).action_completed_at === null && steps.length === 0,
     `${id}, its video watched and no link: refused as before, the action half stays empty`, show(r.body))
}
for (const id of SIX) {
  const db = freshDb([{ lesson_id: id, completed_at: null, action_completed_at: null, discord_message_link: LINK }])
  const r = await done(id)
  ok(r.status === 200 && !!rowOf(db, id).action_completed_at && rowOf(db, id).discord_message_link === LINK,
     `${id}, its link saved: completed as before, the link kept`, show(rowOf(db, id)))
}
{
  // A link on the row (saved before 2026-10-22, when the page still asked for one): Done goes through, the link stays.
  const db = freshDb([{ lesson_id: 'a6l10', completed_at: null, action_completed_at: null, discord_message_link: LINK }])
  const r = await done('a6l10')
  const got = rowOf(db, 'a6l10')
  ok(r.status === 200 && !!got.completed_at && !!got.action_completed_at && got.discord_message_link === LINK,
     'a6l10 with a link saved before: Done goes through and the row keeps its link (stored, never shown)', show(got))
}
{
  // A link sent in the body: the route takes lessonId and shipped alone, so it is never read and never written.
  const db = freshDb()
  const r = await done('a6l17', { link: LINK, discord_message_link: LINK })
  const got = rowOf(db, 'a6l17')
  ok(r.status === 200 && !!got.action_completed_at && got.discord_message_link === null,
     'a6l17 with a link in the request: Done goes through and the link is ignored (nothing written)', show(got))
}
{
  const db = freshDb([{ lesson_id: 'a6l19', completed_at: EARLIER, action_completed_at: EARLIER }])
  const r = await call(markShipped, { lessonId: 'a6l19', shipped: false })
  ok(r.status === 400 && r.body.error === "A completed action item can't be undone." && rowOf(db, 'a6l19').action_completed_at === EARLIER && steps.length === 0,
     'a6l19 done, undo: refused, as every action item of the new course', show(r.body))
}
{
  const db = freshDb()
  db.fail['student_lesson_completions.select'] = { message: 'connection reset' }
  const r = await done('a6l03')
  ok(r.status === 500 && r.body.error === 'connection reset' && db.rows('student_lesson_completions').length === 0 && steps.length === 0,
     'a6l03 when its row cannot be read: 500 with the reason, nothing written (never a blind insert)', show(r))
}
{
  // save-action-link is unchanged: a link sent for one of the four is stored. The page never sends one.
  const db = freshDb()
  const r = await call(saveLink, { lessonId: 'a6l03', link: LINK })
  ok(r.status === 200 && rowOf(db, 'a6l03')?.discord_message_link === LINK && !rowOf(db, 'a6l03').action_completed_at,
     'save-action-link, a link for a6l03: stored as before (the lesson page has no field for it), the action not done', show(r.body))
  const page = fromSrc('src/components/world/ActionItemBlock.tsx')
  ok(/if \(doneOnly\) \{[\s\S]*?return \([\s\S]*?<\/section>\s*\);\s*\}/.test(page) && !/if \(doneOnly\) \{[\s\S]*?onSave[\s\S]*?<\/section>\s*\);\s*\}/.test(page),
     'the Done kind never calls onSave: the save is reached only from the Discord kind')
}

console.log('\n=== 4. After Done: the same as a hand-in ===')
{
  const db = freshDb()
  const before = { streak: streakOf(db), active: lastActive(db) }
  await done('a6l03')
  const got = rowOf(db, 'a6l03')
  ok(isLessonComplete({ lesson_id: 'a6l03', skipped_at: null, ...got }, lessonOf('a6l03')) && completedLessonIdsFor(db.rows('student_lesson_completions'), LESSONS).has('a6l03'),
     'progress: the lesson is complete by isLessonComplete (both halves), so it counts everywhere progress is read', show(got))
  ok(same(streakOf(db), { current: 4, longest: 5, last: TODAY }) && lastActive(db) !== LONG_AGO,
     'the streak: a day counted (3 to 4, today), and last active moves, as a hand-in does', show({ before, after: streakOf(db) }))
  steps.length = 0
  const again = await done('a6l03')
  ok(again.status === 200 && same(streakOf(db), { current: 4, longest: 5, last: TODAY }) && !stepNames().includes('streak'),
     'a second press: no second day', show(stepNames()))
}
{
  // The badges: the real engine, once after a link hand-in and once after Done.
  const handIn = freshDb([{ lesson_id: 'a5l22', completed_at: null, action_completed_at: null, discord_message_link: LINK }])
  await done('a5l22')
  const [fromLink] = await quietly(() => evaluateAchievements(fakeClient(handIn), 's1'))
  const doneDb = freshDb()
  await done('a6l03')
  const [fromDone] = await quietly(() => evaluateAchievements(fakeClient(doneDb), 's1'))
  ok(Array.isArray(fromDone) && same([...fromDone].sort(), [...fromLink].sort()) && fromDone.includes('first_action_shipped') && fromDone.includes('first_lesson'),
     'the badges: Done earns what a hand-in earns (First Steps and Took the Shot, as for any action item done)', show({ fromLink, fromDone }))
}
{
  // The map: every lesson of places 1 to 5 done (their action items handed in) and a6l01, a6l02 watched.
  const counting = LESSONS.filter((l) => l.counts_toward_progress)
  const first = counting.filter((l) => ['a1', 'a2', 'a3', 'a4', 'a5'].includes(l.region_id) || ['a6l01', 'a6l02'].includes(l.id))
  const db = freshDb(first.map((l) => ({
    lesson_id: l.id, completed_at: EARLIER, action_completed_at: l.requires_action ? EARLIER : null, discord_message_link: l.requires_action ? LINK : null,
  })))
  const mapOf = () => {
    const rows = db.rows('student_lesson_completions')
    const completedLessonIds = completedLessonIdsFor(rows, LESSONS)
    const watchedLessonIds = new Set(rows.filter((r) => r.completed_at).map((r) => r.lesson_id))
    const cat = buildWorldCatalog({ lessons: LESSONS, regions: REGIONS, completedLessonIds, watchProgress: new Map() })
    const m = buildMapModel({ areas: cat.areas, lessonsByArea: cat.lessonsByArea, completedLessonIds, watchedLessonIds })
    return m.ok ? { place: m.place, next: m.areas[m.place]?.lessons[m.placeNext]?.id ?? null, done: m.areas[5].done } : m
  }
  const before = mapOf()
  ok(before.place === 5 && before.next === 'a6l03' && before.done === 2, 'the map before Done: the student in AI Ads + Content, a6l03 next (it holds them), 2 done there', show(before))
  await done('a6l03')
  const after = mapOf()
  ok(after.place === 5 && after.next === 'a6l04' && after.done === 3, 'after Done: a6l04 is next, 3 done there (the next lesson opens)', show(after))
}

console.log('\n=== 5. The admin drawer ===')
{
  const lessons = ['a5l22', 'a5l23', 'a6l03', 'a6l10', 'a6l17'].map((id) => {
    const l = lessonOf(id)
    return { id, region_id: l.region_id, title: l.title, type: l.type, requires_action: true, counts_toward_progress: true }
  })
  const completions = [
    { lesson_id: 'a5l22', completed_at: EARLIER, action_completed_at: EARLIER, skipped_at: null, discord_message_link: LINK },
    { lesson_id: 'a5l23', completed_at: EARLIER, action_completed_at: null, skipped_at: null, discord_message_link: LINK },
    // Done before 2026-10-22, when the page still asked for a link.
    { lesson_id: 'a6l03', completed_at: EARLIER, action_completed_at: EARLIER, skipped_at: null, discord_message_link: LINK },
    { lesson_id: 'a6l10', completed_at: EARLIER, action_completed_at: EARLIER, skipped_at: null, discord_message_link: null },
  ]
  const ok_ = (data) => ({ ok: true, data })
  const reads = {
    student: ok_({ id: 's1', name: 'Mila Example', email: 'mila@example.com', discord_username: null, membership_status: 'active', first_paid_at: '2026-10-12T10:00:00.000Z',
      joined_at: '2026-10-12T10:00:00.000Z', last_active_at: EARLIER, cancel_scheduled_at: null, csm_exempt: false, ad_submissions_verified: false }),
    regions: ok_(REGIONS.slice(4, 6)),
    lessons: ok_(lessons),
    completions: ok_(completions),
    discount: ok_(null),
    streak: ok_(null),
    sync: ok_(null),
    programLink: ok_(null),
  }
  const d = D.buildStudentDetail(reads, { ok: true, resetAt: RESET, lastByStudent: new Map() }, '2026-10-22T10:00:00.000Z')
  const by = d.actionItems.ok ? Object.fromEntries(d.actionItems.data.map((a) => [a.id, a])) : {}
  ok(by.a6l03?.status === 'Done' && by.a6l03.link === null && by.a6l10?.status === 'Done' && by.a6l10.link === null,
     'the four, done: "Done" and no link, even a6l03\'s saved before 2026-10-22', show([by.a6l03, by.a6l10]))
  ok(by.a6l17?.status === 'Not yet' && by.a6l17.link === null, 'one of the four not done: "Not yet", no link', show(by.a6l17))
  ok(by.a5l22?.status === 'Handed in' && by.a5l22.link === LINK && by.a5l23?.status === 'Not yet' && by.a5l23.link === LINK,
     'the others as before: "Handed in" with the link, "Not yet" with a link saved and the action not done', show([by.a5l22, by.a5l23]))
  ok(D.actionItemStatus(true, false) === 'Handed in' && D.actionItemStatus(true, true) === 'Done' && D.actionItemStatus(false, true) === 'Not yet' && D.actionItemStatus(false, false) === 'Not yet',
     'actionItemStatus: the three words')
  const view = fromSrc('src/components/admin/journey/JourneyView.tsx')
  ok(view.includes('>{a.status}</span>') && !view.includes('"Handed in"') && view.includes('{a.link && ('),
     'the drawer shows the builder\'s word and a link only when there is one (JourneyView.tsx)')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
