// done-only.test.mjs: the action items with nothing to post (the owner,
// 2026-10-22: "some action items do not need an action ... There's no need to
// post anything inside Discord ... We just have to be able to click Done, and
// then the next lesson opens up"; then, of Static Ads: "Action Item - Static
// Ad Brief this is the only one they have in statics that's for discord. All
// other ones in statics are for doing and not sending to coaches"). Seven of
// the course's action items are finished with a Done button and no Discord
// link: the four of AI Ads + Content and three of Static Ads. The other seven
// still need theirs: a3l17, a3l25, a5l23, and since 2026-10-23 (the owner,
// migration v114) Video Ads II's four editing breakdowns, a4l02 to a4l05.
// Two of the Done seven have a video (a5l08, a5l12): there Done is the action
// half alone, and the video's half still comes only from watching it.
// On the real source:
//
//   1. the one list   DONE_ONLY_ACTION_ITEMS and isDoneOnly (action-items.ts),
//                     held to supabase/catalog/course_catalog.json, and no
//                     other file in src/ naming the seven but dev fixtures
//   2. the block      ActionItemBlock.tsx rendered by React's server renderer,
//                     both kinds in every state, on a lesson with no video and
//                     on one with a video, and the lesson page choosing the
//                     kind by isDoneOnly
//   3. the route      mark-action-shipped on the new course: each of the seven
//                     completes with no link (on a5l08 and a5l12 the action
//                     half alone until the video is watched); a link on its
//                     row is kept and a link in the body is not read (never
//                     written); each of the other seven without a link is
//                     refused as before, with one it goes through.
//                     save-action-link still stores a link sent for one of the
//                     seven (the page never sends one)
//   4. after Done     the row, the steps, the streak day, the badges and the
//                     map's next lesson, read back through isLessonComplete,
//                     the real update-streak.ts, the real badge engine
//                     (achievements.ts) and the real map (catalog.ts,
//                     map-model.ts), the same as a hand-in with a link; and on
//                     a5l08, Done before its video counts no video anywhere a
//                     video is counted (progress, the map's watched set, the
//                     30%, Triple Threat, Perfectionist) until lesson-watched
//                     (the real route, the 95%) finishes it, in either order
//   5. the drawer     buildStudentDetail's action items: "Done" and no link
//                     for the seven, even a link saved before; "Handed in"
//                     with it for the others; "Not yet"
//   6. from Whop      a lesson finished on Whop counts in the app (the
//                     owner's rule): the Whop webhook and the backfill a
//                     login or a visit runs give each of the seven its action
//                     half too where it has none, dated so Triple Threat
//                     never counts a sync's rows on the sync's day; a Done
//                     pressed before the video is kept; the video's half comes
//                     only from what Whop reports for that lesson; the map
//                     opens the next lesson with no Done pressed; the other
//                     seven as before
//
// build.mjs copies the modules and the routes (run it first; `npm run
// test:client` does); the block is compiled here as Next compiles it, into
// _gen/done-only-block.mjs. The database is stub-server.ts's stand-in, whose
// streak steps run the real update-streak.ts. Every student, id and link
// here is made up.
import { createHmac, randomBytes } from 'node:crypto'
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
const { DONE_ONLY_ACTION_ITEMS, PASTE_LINK_FIRST, actionItemView, isDoneOnly, whopActionTime } = await import('./_gen/action-items.ts')
const { completedLessonIdsFor, isLessonComplete } = await import('./_gen/progress.ts')
const { POST: markShipped } = await import('./_gen/mark-action-shipped-route.ts')
const { POST: saveLink } = await import('./_gen/save-action-link-route.ts')
const { POST: lessonWatched } = await import('./_gen/lesson-watched-route.ts')
const { POST: whopWebhook } = await import('./_gen/whop-webhook-route.ts')
const { syncWatchProgress } = await import('./_gen/watch-sync.ts')
// useDb under another name: ESLint's React rules take a "use..." call for a hook.
const { FakeDb, fakeClient, useDb: openDb, setCatalog, setWhop, steps } = await import('./_gen/stub-server.ts')
const { evaluateAchievements } = await import('./_gen/achievements.ts')
const { finishedAt, mostFinishedInOneDay } = await import('./_gen/achievement-rules.ts')
const { requiredLessons } = await import('./_gen/discount.ts')
const { videoDoneIds } = await import('./_gen/discount-server.ts')
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

/** The seven the owner named, and the seven that keep their link: typed here, on purpose. */
const DONE_ONLY = ['a5l08', 'a5l12', 'a5l22', 'a6l03', 'a6l10', 'a6l17', 'a6l19']
/** Of the seven, the two with a video (The Backbone, Imitation): Done is their action half alone. */
const WITH_VIDEO = ['a5l08', 'a5l12']
/** And the five with none, setup lessons: Done finishes them. */
const NO_VIDEO = ['a5l22', 'a6l03', 'a6l10', 'a6l17', 'a6l19']
/**
 * The seven that keep their Discord link, each with a video: Video Ads I's two, Video Ads II's four editing
 * breakdowns (action items since 2026-10-23, migration v114) and Static Ads' Static Ad Brief.
 */
const LINK_KIND = ['a3l17', 'a3l25', 'a4l02', 'a4l03', 'a4l04', 'a4l05', 'a5l23']
const LINK = 'https://discord.com/channels/1100000000000000001/1200000000000000002/1300000000000000003'
const EARLIER = '2026-10-20T09:00:00.000Z'
const LATER = '2026-10-21T09:00:00.000Z'
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
ok(same([...DONE_ONLY_ACTION_ITEMS].sort(), DONE_ONLY), 'DONE_ONLY_ACTION_ITEMS is the seven the owner named', show([...DONE_ONLY_ACTION_ITEMS]))
ok(DONE_ONLY.every((id) => isDoneOnly(id)) && LINK_KIND.every((id) => !isDoneOnly(id)), 'isDoneOnly: yes for the seven, no for the seven that keep their link (a3l17, a3l25, a4l02 to a4l05, a5l23)')
{
  const old = Array.from({ length: 78 }, (_, i) => `l${String(i + 1).padStart(3, '0')}`)
  const plain = LESSONS.filter((l) => !l.requires_action).map((l) => l.id)
  ok(old.every((id) => !isDoneOnly(id)) && plain.every((id) => !isDoneOnly(id)) && [null, undefined, '', 'A6L03', ' a6l03', 'a5l08 ', 42].every((v) => !isDoneOnly(v)),
     'and no for the old course\'s l001 to l078, for every other lesson of the course, and for nothing, another case, a space or a number')
}
{
  const actions = CATALOG.lessons.filter((l) => l.action_brief)
  const areaOf = (name) => CATALOG.areas.find((a) => a.name === name)?.id
  const of = (name) => actions.filter((l) => l.area === areaOf(name))
  const kind = (l) => `${l.id} ${l.type}${LENGTHS[l.id] > 0 ? ' video' : ''} "${l.title}"`
  ok(same(of('AI Ads + Content').map((l) => l.id), DONE_ONLY.filter((id) => id.startsWith('a6'))) && of('AI Ads + Content').every((l) => l.type === 'setup' && !(LENGTHS[l.id] > 0)),
     'course_catalog.json: the action items of AI Ads + Content are exactly its four of the seven, each a setup lesson (no video)', show(of('AI Ads + Content').map(kind)))
  // Static Ads by the titles the owner named: three for doing, the Static Ad Brief for the coaches.
  const statics = of('Static Ads')
  const want = [
    ['a5l08', 'watch', 'Action item - The Backbone', true],
    ['a5l12', 'watch', 'Action Item - Imitation', true],
    ['a5l22', 'setup', 'Action Item - Brand Deck', false],
    ['a5l23', 'watch', 'Action Item - Static Ad Brief', true],
  ]
  ok(same(statics.map((l) => [l.id, l.type, l.title, LENGTHS[l.id] > 0]), want),
     'course_catalog.json: Static Ads\' four action items, by the titles the owner named: The Backbone and Imitation (each with a video), the Brand Deck (a setup lesson) and the Static Ad Brief (a video), the one that keeps its link', show(statics.map(kind)))
  ok(same(actions.filter((l) => !DONE_ONLY.includes(l.id)).map((l) => l.id), LINK_KIND) && LINK_KIND.every((id) => lessonOf(id).type === 'watch' && LENGTHS[id] > 0),
     'and the course\'s other action items are the seven, each a watch lesson with a video: Video Ads I\'s two, Video Ads II\'s four (v114) and the Static Ad Brief', show(actions.map((l) => l.id)))
  ok(same(DONE_ONLY.filter((id) => lessonOf(id).has_video), WITH_VIDEO) && same(DONE_ONLY.filter((id) => !lessonOf(id).has_video), NO_VIDEO),
     'of the seven, a5l08 and a5l12 have a video and the other five none')
}
{
  // One source of truth: the seven ids are written in action-items.ts, and elsewhere in the app's code only
  // in development fixtures that name a lesson for something else.
  const found = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name) && /["'`](a5l(08|12|22)|a6l(03|10|17|19))["'`]/.test(fs.readFileSync(p, 'utf8'))) found.push(path.relative(here('..'), p))
    }
  }
  walk(here('../src'))
  ok(same(found.sort(), [
    'src/app/dev/admin/feedback/lesson-fixtures.ts',
    'src/app/dev/admin/fixtures-people.ts',
    'src/app/dev/world-app/FixtureStudentProvider.tsx',
    'src/lib/world/action-items.ts',
  ]),
     'no file in src/ holds the seven ids in a string but action-items.ts and three development fixtures: the admin dev page\'s made-up student who did a6l03, its made-up rating of a5l22, and the placeholder course\'s action items', show(found))
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
  // A link saved on the row before the item was on the list, the action not done: never shown, the button is still Done.
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
  const watchedFirst = actionItemView(row(EARLIER, null), true, true)
  ok(waiting.state === 'completed' && waiting.waitingOnVideo && !waiting.canComplete && watchedFirst.state === 'empty' && watchedFirst.canComplete && !watchedFirst.waitingOnVideo,
     'on a video lesson (a5l08, a5l12): the action alone waits on the video, as the other kind does; the video alone still offers Done', show({ waiting, watchedFirst }))
}
{
  // a5l08 and a5l12: a video lesson. Done is the action half alone, and the block says so until the video is watched.
  const before = render({ doneOnly: true, separateWatchHalf: true })
  const watchedOnly = render({ doneOnly: true, separateWatchHalf: true, row: row(EARLIER, null) })
  const waiting = render({ doneOnly: true, separateWatchHalf: true, row: row(null, EARLIER, LINK) })
  const both = render({ doneOnly: true, separateWatchHalf: true, row: row(LATER, EARLIER, LINK) })
  renders.push(before, watchedOnly, waiting, both)
  ok(/data-hand-in="done"/.test(before) && /data-action-item="empty"/.test(before) && same(buttons(before), ['Done']) && !/<input/.test(before) && !/discord/i.test(before),
     'Done kind on a video lesson, nothing done: one button, Done, as on a setup lesson', show(text(before)))
  ok(/data-action-item="empty"/.test(watchedOnly) && same(buttons(watchedOnly), ['Done']) && !/Watch the video/.test(text(watchedOnly)),
     'its video watched and Done not pressed: still the one button, Done, and no line about the video', show(text(watchedOnly)))
  ok(/data-action-item="completed"/.test(waiting) && /^Action completed on [A-Za-z0-9, ]+\. Watch the video to finish the lesson\.$/.test(text(waiting)) &&
     buttons(waiting).length === 0 && !waiting.includes(LINK) && !/discord/i.test(waiting),
     'Done pressed before the video: "Action completed on <date>. Watch the video to finish the lesson." and nothing else: no button, no link', show(text(waiting)))
  ok(/data-action-item="completed"/.test(both) && /^Completed on [A-Za-z0-9, ]+\.$/.test(text(both)) && buttons(both).length === 0,
     'and once the video is watched too: "Completed on <date>." and nothing else', show(text(both)))
  const linkWaiting = render({ doneOnly: false, separateWatchHalf: true, row: row(null, EARLIER, LINK) })
  ok(text(linkWaiting).includes(text(waiting)), 'the waiting line is word for word the Discord kind\'s on a video lesson whose action is done first', show(text(linkWaiting)))
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
  ok(/import \{ isDoneOnly \} from "@\/lib\/world\/action-items";/.test(page) && page.includes('doneOnly={isDoneOnly(lesson.id)}') && page.includes('separateWatchHalf={watch}'),
     'the lesson page picks the kind by isDoneOnly, from the lesson\'s id, and tells the block a watch lesson\'s video is a half of its own')
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
/** The steps after an action done before its video: the same but last active, which moves only with both halves. */
const AFTER_ACTION_ONLY = ['streak', 'r2', 'came-back', 'achievements', 'tasks']

for (const id of NO_VIDEO) {
  const db = freshDb()
  const r = await done(id)
  const got = rowOf(db, id)
  ok(r.status === 200 && !!got?.completed_at && !!got?.action_completed_at && got.discord_message_link === null && same(stepNames(), AFTER),
     `${id}, no row and no link: Done goes through, both halves set, no link, the same steps after it`, show({ status: r.status, row: got, steps: stepNames() }))
}
for (const id of WITH_VIDEO) {
  const db = freshDb()
  const r = await done(id)
  const got = rowOf(db, id)
  ok(r.status === 200 && got?.completed_at === null && !!got?.action_completed_at && got.discord_message_link === null && same(stepNames(), AFTER_ACTION_ONLY),
     `${id} (a video), no row and no link: Done goes through and writes the action half alone, the video's half left empty; the steps of an action done before its video (no "last active")`,
     show({ status: r.status, row: got, steps: stepNames() }))
}
for (const id of WITH_VIDEO) {
  // Its video watched first (the player's half), then Done: both halves, the video's time kept.
  const db = freshDb([{ lesson_id: id, completed_at: EARLIER, action_completed_at: null, discord_message_link: null }])
  const r = await done(id)
  const got = rowOf(db, id)
  ok(r.status === 200 && got.completed_at === EARLIER && !!got.action_completed_at && got.action_completed_at > EARLIER && same(stepNames(), AFTER),
     `${id}, its video watched, then Done: both halves, the video's time kept, and the steps of a lesson finished, "last active" with them`, show({ row: got, steps: stepNames() }))
}
{
  // The same press on the other kind: a5l23, its link saved and its video not watched, "Complete the action".
  const db = freshDb([{ lesson_id: 'a5l23', completed_at: null, action_completed_at: null, discord_message_link: LINK }])
  const r = await done('a5l23')
  ok(r.status === 200 && rowOf(db, 'a5l23').completed_at === null && !!rowOf(db, 'a5l23').action_completed_at && same(stepNames(), AFTER_ACTION_ONLY),
     'a5l23 (the Discord kind) handed in before its video: the same write and the same steps as Done on a5l08 before its', show({ row: rowOf(db, 'a5l23'), steps: stepNames() }))
}
for (const id of LINK_KIND) {
  const db = freshDb()
  const r = await done(id)
  ok(r.status === 400 && r.body.error === PASTE_LINK_FIRST && rowOf(db, id) === null && steps.length === 0,
     `${id}, no row and no link: refused as before ("${PASTE_LINK_FIRST}"), nothing written, no step`, show(r))
}
for (const id of LINK_KIND) {
  const db = freshDb([{ lesson_id: id, completed_at: EARLIER, action_completed_at: null, discord_message_link: null }])
  const r = await done(id)
  ok(r.status === 400 && rowOf(db, id).action_completed_at === null && steps.length === 0,
     `${id}, its video watched and no link: refused as before, the action half stays empty`, show(r.body))
}
for (const id of LINK_KIND) {
  const db = freshDb([{ lesson_id: id, completed_at: null, action_completed_at: null, discord_message_link: LINK }])
  const r = await done(id)
  ok(r.status === 200 && !!rowOf(db, id).action_completed_at && rowOf(db, id).discord_message_link === LINK,
     `${id}, its link saved: completed as before, the link kept`, show(rowOf(db, id)))
}
{
  // A link on the row (saved before the item was on the list, when the page still asked for one): Done goes through, the link stays.
  const db = freshDb([{ lesson_id: 'a6l10', completed_at: null, action_completed_at: null, discord_message_link: LINK }])
  const r = await done('a6l10')
  const got = rowOf(db, 'a6l10')
  ok(r.status === 200 && !!got.completed_at && !!got.action_completed_at && got.discord_message_link === LINK,
     'a6l10 with a link saved before: Done goes through and the row keeps its link (stored, never shown)', show(got))
  const db2 = freshDb([{ lesson_id: 'a5l12', completed_at: null, action_completed_at: null, discord_message_link: LINK }])
  const r2 = await done('a5l12')
  const got2 = rowOf(db2, 'a5l12')
  ok(r2.status === 200 && got2.completed_at === null && !!got2.action_completed_at && got2.discord_message_link === LINK,
     'a5l12 with a link saved before: Done writes the action half alone and the row keeps its link', show(got2))
}
{
  // A link sent in the body: the route takes lessonId and shipped alone, so it is never read and never written.
  const db = freshDb()
  const r = await done('a6l17', { link: LINK, discord_message_link: LINK })
  const got = rowOf(db, 'a6l17')
  const db2 = freshDb()
  const r2 = await done('a5l08', { link: LINK, discord_message_link: LINK })
  ok(r.status === 200 && !!got.action_completed_at && got.discord_message_link === null && r2.status === 200 && rowOf(db2, 'a5l08').discord_message_link === null,
     'a6l17 and a5l08 with a link in the request: Done goes through and the link is ignored (nothing written)', show([got, rowOf(db2, 'a5l08')]))
}
{
  const db = freshDb([{ lesson_id: 'a6l19', completed_at: EARLIER, action_completed_at: EARLIER }])
  const r = await call(markShipped, { lessonId: 'a6l19', shipped: false })
  ok(r.status === 400 && r.body.error === "A completed action item can't be undone." && rowOf(db, 'a6l19').action_completed_at === EARLIER && steps.length === 0,
     'a6l19 done, undo: refused, as every action item of the new course', show(r.body))
  const db2 = freshDb([{ lesson_id: 'a5l08', completed_at: null, action_completed_at: EARLIER }])
  const r2 = await call(markShipped, { lessonId: 'a5l08', shipped: false })
  ok(r2.status === 400 && rowOf(db2, 'a5l08').action_completed_at === EARLIER && steps.length === 0,
     'a5l08 with Done pressed before its video, undo: refused, the Done kept', show(r2.body))
}
{
  const db = freshDb()
  db.fail['student_lesson_completions.select'] = { message: 'connection reset' }
  const r = await done('a6l03')
  ok(r.status === 500 && r.body.error === 'connection reset' && db.rows('student_lesson_completions').length === 0 && steps.length === 0,
     'a6l03 when its row cannot be read: 500 with the reason, nothing written (never a blind insert)', show(r))
}
{
  // save-action-link is unchanged: a link sent for one of the seven is stored. The page never sends one.
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
  // The badges: the real engine, once after a link hand-in and once after Done. a5l23's video is watched, so its
  // hand-in finishes it as Done finishes a6l03.
  const handIn = freshDb([{ lesson_id: 'a5l23', completed_at: EARLIER, action_completed_at: null, discord_message_link: LINK }])
  await done('a5l23')
  const [fromLink] = await quietly(() => evaluateAchievements(fakeClient(handIn), 's1'))
  const doneDb = freshDb()
  await done('a6l03')
  const [fromDone] = await quietly(() => evaluateAchievements(fakeClient(doneDb), 's1'))
  ok(Array.isArray(fromDone) && same([...fromDone].sort(), [...fromLink].sort()) && fromDone.includes('first_action_shipped') && fromDone.includes('first_lesson'),
     'the badges: Done earns what a hand-in earns (First Steps and Took the Shot, as for any action item done)', show({ fromLink, fromDone }))
}
{
  // a5l08: Done before its video is the action and nothing else. No video is counted anywhere a video is counted.
  const db = freshDb()
  await done('a5l08')
  const rows = db.rows('student_lesson_completions')
  const got = rowOf(db, 'a5l08')
  ok(got.completed_at === null && !isLessonComplete({ lesson_id: 'a5l08', skipped_at: null, ...got }, lessonOf('a5l08')) && !completedLessonIdsFor(rows, LESSONS).has('a5l08'),
     'a5l08, Done before its video: the lesson is not complete (its video\'s half is empty), so no progress view or count has it', show(got))
  const watched = new Set(rows.filter((r) => r.completed_at).map((r) => r.lesson_id))
  ok(!watched.has('a5l08') && !videoDoneIds(rows).has('a5l08'),
     'no video counted: a5l08 is neither in the watched set the map and the lesson page read nor in videoDoneIds, what the 30% counts as videos done', show({ watched: [...watched], videoDone: [...videoDoneIds(rows)] }))
  const asked = requiredLessons(LESSONS)
  ok(asked.length > 0 && asked.at(-1).id === 'a4l17' && !asked.some((l) => WITH_VIDEO.includes(l.id)),
     'and the 30% never asks for a5l08 or a5l12: the videos it asks for run up to its gate, a4l17, the last of Video Ads II', show({ count: asked.length, last: asked.at(-1)?.id }))
  ok(finishedAt({ ...got, completed_at_real: false }, true) === null && mostFinishedInOneDay([{ ...got, completed_at_real: false }], new Map([['a5l08', true]])) === 0,
     'Triple Threat: no finish on any day')
  ok(same(streakOf(db), { current: 4, longest: 5, last: TODAY }) && lastActive(db) === LONG_AGO,
     'the streak: the day counts for the action item done (T-079), as the Discord kind\'s "Complete the action" counts it; last active stays, as for any action done before its video', show({ streak: streakOf(db), active: lastActive(db) }))
  // The badges after it, beside the Discord kind's hand-in before its video (a5l23).
  const [fromDone] = await quietly(() => evaluateAchievements(fakeClient(db), 's1'))
  const handIn = freshDb([{ lesson_id: 'a5l23', completed_at: null, action_completed_at: null, discord_message_link: LINK }])
  await done('a5l23')
  const [fromLink] = await quietly(() => evaluateAchievements(fakeClient(handIn), 's1'))
  ok(Array.isArray(fromDone) && same(fromDone, ['first_action_shipped']) && same(fromLink, fromDone),
     'the badges: Took the Shot alone (the action), never First Steps (no lesson is finished), the same as a hand-in before its video', show({ fromDone, fromLink }))
}
/** Every counting lesson of the course done but a5l08, whose Done is pressed and whose video is not watched. */
const ALL_BUT_A5L08 = LESSONS.filter((l) => l.counts_toward_progress).map((l) => ({
  lesson_id: l.id,
  completed_at: l.id === 'a5l08' ? null : EARLIER,
  action_completed_at: l.requires_action ? EARLIER : null,
  discord_message_link: l.requires_action && !isDoneOnly(l.id) ? LINK : null,
}))
/** a5l08's watch row, as the player's heartbeats leave it: played to `ratio` of its length. */
const watchRow = (ratio) => ({ student_id: 's1', lesson_id: 'a5l08', max_position_seconds: Math.round(LENGTHS.a5l08 * ratio),
  watched_seconds: Math.round(LENGTHS.a5l08 * Math.min(ratio, 0.9)), reported_duration_seconds: LENGTHS.a5l08, threshold_met_at: null })
{
  const db = freshDb(ALL_BUT_A5L08)
  const [first] = await quietly(() => evaluateAchievements(fakeClient(db), 's1'))
  ok(Array.isArray(first) && !first.includes('perfect_run') && !first.includes('unbroken') && first.includes('first_action_shipped'),
     'Perfectionist: every other lesson of the course done and a5l08\'s Done pressed, its video not watched: not earned (the course is not finished)', show(first))
  // Its video played to 80%: the watch rule refuses it, and Done does not stand in for the rest.
  db.rows('student_lesson_watch').push(watchRow(0.8))
  steps.length = 0
  const short = await call(lessonWatched, { lessonId: 'a5l08' })
  ok(short.status === 200 && short.body.completed === false && short.body.reason === 'position_short' && rowOf(db, 'a5l08').completed_at === null && steps.length === 0,
     'its video played to 80%: lesson-watched refuses it (the 95%), the video\'s half stays empty with Done pressed, no step', show(short.body))
  db.rows('student_lesson_watch').splice(0, 1, watchRow(1))
  const full = await call(lessonWatched, { lessonId: 'a5l08' })
  const got = rowOf(db, 'a5l08')
  ok(full.status === 200 && full.body.completed === true && !!got.completed_at && got.action_completed_at === EARLIER && got.completed_at_real === true && same(stepNames(), ['streak', 'came-back', 'achievements', 'tasks']),
     'played to its end: lesson-watched writes the video\'s half, the Done kept at its time, and the steps after a lesson run', show({ body: full.body, row: got, steps: stepNames() }))
  const [second] = await quietly(() => evaluateAchievements(fakeClient(db), 's1'))
  ok(Array.isArray(second) && second.includes('perfect_run') && completedLessonIdsFor(db.rows('student_lesson_completions'), LESSONS).has('a5l08'),
     'then the lesson is complete, and Perfectionist comes with the course finished', show(second))
}
/** Every lesson of places 1 to 5 done (their action items handed in), and a6l01 and a6l02 watched. */
const UP_TO_A6L03 = LESSONS
  .filter((l) => l.counts_toward_progress && (['a1', 'a2', 'a3', 'a4', 'a5'].includes(l.region_id) || ['a6l01', 'a6l02'].includes(l.id)))
  .map((l) => ({ lesson_id: l.id, completed_at: EARLIER, action_completed_at: l.requires_action ? EARLIER : null, discord_message_link: l.requires_action ? LINK : null }))
/** Every lesson of places 1 to 4 done, and Static Ads' lessons 1 to 7 watched: a5l08 is next. */
const UP_TO_A5L08 = LESSONS
  .filter((l) => l.counts_toward_progress && (['a1', 'a2', 'a3', 'a4'].includes(l.region_id) || (l.region_id === 'a5' && l.sort_order < lessonOf('a5l08').sort_order)))
  .map((l) => ({ lesson_id: l.id, completed_at: EARLIER, action_completed_at: l.requires_action ? EARLIER : null, discord_message_link: l.requires_action ? LINK : null }))
/** The map on these rows, as the student's map reads them: where they stand, the lesson next, and how many are done in place k. */
function mapOf(db, k = 5) {
  const rows = db.rows('student_lesson_completions')
  const completedLessonIds = completedLessonIdsFor(rows, LESSONS)
  const watchedLessonIds = new Set(rows.filter((r) => r.completed_at).map((r) => r.lesson_id))
  const cat = buildWorldCatalog({ lessons: LESSONS, regions: REGIONS, completedLessonIds, watchProgress: new Map() })
  const m = buildMapModel({ areas: cat.areas, lessonsByArea: cat.lessonsByArea, completedLessonIds, watchedLessonIds })
  return m.ok ? { place: m.place, next: m.areas[m.place]?.lessons[m.placeNext]?.id ?? null, done: m.areas[k].done } : m
}
{
  const db = freshDb(UP_TO_A6L03)
  const before = mapOf(db)
  ok(before.place === 5 && before.next === 'a6l03' && before.done === 2, 'the map before Done: the student in AI Ads + Content, a6l03 next (it holds them), 2 done there', show(before))
  await done('a6l03')
  const after = mapOf(db)
  ok(after.place === 5 && after.next === 'a6l04' && after.done === 3, 'after Done: a6l04 is next, 3 done there (the next lesson opens)', show(after))
}
{
  // a5l08, Done first, then its video: Done alone holds the student there, the video then opens a5l09.
  const db = freshDb(UP_TO_A5L08)
  const before = mapOf(db, 4)
  ok(before.place === 4 && before.next === 'a5l08' && before.done === 7, 'the map at a5l08: the student in Static Ads, a5l08 next, 7 done there', show(before))
  await done('a5l08')
  const afterDone = mapOf(db, 4)
  ok(same(afterDone, before), 'Done before its video: the map as it was, a5l08 still next (nothing opens on Done alone)', show(afterDone))
  db.rows('student_lesson_watch').push(watchRow(1))
  await call(lessonWatched, { lessonId: 'a5l08' })
  const afterBoth = mapOf(db, 4)
  ok(afterBoth.place === 4 && afterBoth.next === 'a5l09' && afterBoth.done === 8, 'then its video watched: a5l09 is next, 8 done there (the next lesson opens with both halves)', show(afterBoth))
}
{
  // The other order: the video, then Done. The video alone moves the map on as for any action item with a video
  // (isPassed), and Done then counts the lesson done.
  const db = freshDb(UP_TO_A5L08)
  db.rows('student_lesson_watch').push(watchRow(1))
  await call(lessonWatched, { lessonId: 'a5l08' })
  const afterVideo = mapOf(db, 4)
  ok(afterVideo.next === 'a5l09' && afterVideo.done === 7 && !isLessonComplete({ lesson_id: 'a5l08', skipped_at: null, ...rowOf(db, 'a5l08') }, lessonOf('a5l08')),
     'the video first: a5l09 next (passed, as any action item with its video watched), still 7 done (a5l08 is not complete)', show(afterVideo))
  await done('a5l08')
  const afterBoth = mapOf(db, 4)
  ok(afterBoth.next === 'a5l09' && afterBoth.done === 8 && isLessonComplete({ lesson_id: 'a5l08', skipped_at: null, ...rowOf(db, 'a5l08') }, lessonOf('a5l08')),
     'then Done: complete, 8 done there', show(afterBoth))
}

console.log('\n=== 5. The admin drawer ===')
{
  const lessons = ['a3l25', 'a5l08', 'a5l22', 'a5l23', 'a6l03', 'a6l10', 'a6l17'].map((id) => {
    const l = lessonOf(id)
    return { id, region_id: l.region_id, title: l.title, type: l.type, requires_action: true, counts_toward_progress: true }
  })
  const completions = [
    { lesson_id: 'a3l25', completed_at: EARLIER, action_completed_at: EARLIER, skipped_at: null, discord_message_link: LINK },
    // Done pressed before its video, a link saved before it was on the list.
    { lesson_id: 'a5l08', completed_at: null, action_completed_at: EARLIER, skipped_at: null, discord_message_link: LINK },
    { lesson_id: 'a5l22', completed_at: EARLIER, action_completed_at: EARLIER, skipped_at: null, discord_message_link: LINK },
    { lesson_id: 'a5l23', completed_at: EARLIER, action_completed_at: null, skipped_at: null, discord_message_link: LINK },
    // Done before the item was on the list, when the page still asked for a link.
    { lesson_id: 'a6l03', completed_at: EARLIER, action_completed_at: EARLIER, skipped_at: null, discord_message_link: LINK },
    { lesson_id: 'a6l10', completed_at: EARLIER, action_completed_at: EARLIER, skipped_at: null, discord_message_link: null },
  ]
  const ok_ = (data) => ({ ok: true, data })
  const reads = {
    student: ok_({ id: 's1', name: 'Mila Example', email: 'mila@example.com', discord_username: null, membership_status: 'active', first_paid_at: '2026-10-12T10:00:00.000Z',
      joined_at: '2026-10-12T10:00:00.000Z', last_active_at: EARLIER, cancel_scheduled_at: null, csm_exempt: false, ad_submissions_verified: false }),
    regions: ok_(REGIONS.slice(2, 6)),
    lessons: ok_(lessons),
    completions: ok_(completions),
    discount: ok_(null),
    streak: ok_(null),
    sync: ok_(null),
    programLink: ok_(null),
  }
  const d = D.buildStudentDetail(reads, { ok: true, resetAt: RESET, lastByStudent: new Map() }, '2026-10-22T10:00:00.000Z')
  const by = d.actionItems.ok ? Object.fromEntries(d.actionItems.data.map((a) => [a.id, a])) : {}
  ok(by.a6l03?.status === 'Done' && by.a6l03.link === null && by.a6l10?.status === 'Done' && by.a6l10.link === null && by.a5l22?.status === 'Done' && by.a5l22.link === null,
     'the seven, done: "Done" and no link, even a6l03\'s and a5l22\'s saved before', show([by.a6l03, by.a6l10, by.a5l22]))
  ok(by.a5l08?.status === 'Done' && by.a5l08.link === null,
     'a5l08 with Done pressed and its video not watched: "Done", the action\'s word, as the Discord kind says "Handed in" before its video; no link', show(by.a5l08))
  ok(by.a6l17?.status === 'Not yet' && by.a6l17.link === null, 'one of the seven not done: "Not yet", no link', show(by.a6l17))
  ok(by.a3l25?.status === 'Handed in' && by.a3l25.link === LINK && by.a5l23?.status === 'Not yet' && by.a5l23.link === LINK,
     'the others as before: "Handed in" with the link, "Not yet" with a link saved and the action not done', show([by.a3l25, by.a5l23]))
  ok(D.actionItemStatus(true, false) === 'Handed in' && D.actionItemStatus(true, true) === 'Done' && D.actionItemStatus(false, true) === 'Not yet' && D.actionItemStatus(false, false) === 'Not yet',
     'actionItemStatus: the three words')
  const view = fromSrc('src/components/admin/journey/JourneyView.tsx')
  ok(view.includes('>{a.status}</span>') && !view.includes('"Handed in"') && view.includes('{a.link && ('),
     'the drawer shows the builder\'s word and a link only when there is one (JourneyView.tsx)')
}

console.log('\n=== 6. Finished on Whop: done in the app, with no Done to press ===')
// The owner's standing rule: a lesson finished on Whop counts in the app as one
// finished there. The webhook and the backfill a login or a visit runs give
// each of the seven its action half too where it has none (the Whop
// catch-up's is in whop-catchup.test.mjs). Every Whop id here is made up:
// "lesn_" and the lesson's id. Whop's times are some hours before the run,
// whenever it runs.
const WHOP_KEY = randomBytes(24)
process.env.WHOP_WEBHOOK_SECRET = `ws_${WHOP_KEY.toString('base64')}`
let whopMsg = 0
/** Whop's event for the lesson finished by user_1, signed as Whop signs it; answers the status. */
async function whopEvent(lessonId) {
  const body = JSON.stringify({ type: 'course_lesson_interaction.completed', data: { user: { id: 'user_1' }, lesson: { id: `lesn_${lessonId}` }, completed: true } })
  const id = `msg_${++whopMsg}`
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = createHmac('sha256', WHOP_KEY).update(`${id}.${ts}.${body}`).digest('base64')
  const [res] = await quietly(() => whopWebhook(new Request('http://app/api/webhooks/whop', {
    method: 'POST', headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` }, body,
  })))
  return res instanceof Error ? res.message : res.status
}
/** freshDb, every lesson holding its made-up Whop id. */
function whopDb(completions = []) {
  const db = freshDb(completions)
  for (const l of db.rows('lessons')) l.whop_lesson_id = `lesn_${l.id}`
  return db
}
/** Whop lists these lessons as finished by user_1: [lesson id, when it was opened there]. */
const onWhop = (list) => setWhop(async () => ({
  interactions: list.map(([id, at]) => ({ lesson: { id: `lesn_${id}` }, completed: true, created_at: at })),
  rawCount: list.length,
  completedCount: list.length,
}))
const backfill = () => quietly(() => syncWatchProgress({ studentId: 's1', whopUserId: 'user_1' }))
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString()
/** afterCompletionWrite's four steps, in its order (the webhook runs them once a lesson is finished). */
const AFTER_LESSON = ['streak', 'came-back', 'achievements', 'tasks']
const isDone = (row, id) => !!row && isLessonComplete({ lesson_id: id, skipped_at: null, ...row }, lessonOf(id))
/** A Done the student pressed in the app before the video was watched. */
const PRESSED = '2026-10-21T08:00:00.000Z'
{
  const db = whopDb(UP_TO_A6L03)
  const status = await whopEvent('a6l03')
  const got = rowOf(db, 'a6l03')
  ok(status === 200 && !!got?.completed_at && !!got.action_completed_at && Math.abs(Date.parse(got.completed_at) - Date.parse(got.action_completed_at)) < 5000 &&
     got.completed_at_real === true && got.discord_message_link === null,
     'webhook, a6l03 finished on Whop: both halves at the moment it arrives, marked as its real finish, no link', show(got))
  ok(isDone(got, 'a6l03') && same(stepNames(), AFTER_LESSON) && same(mapOf(db), { place: 5, next: 'a6l04', done: 3 }),
     'so it is done: the steps after a lesson run once, and the map opens a6l04 with no Done pressed', show({ steps: stepNames(), map: mapOf(db) }))
  steps.length = 0
  const again = await whopEvent('a6l03')
  ok(again === 200 && steps.length === 0 && rowOf(db, 'a6l03').action_completed_at === got.action_completed_at,
     'the same event again: nothing written, no step', show(stepNames()))
}
{
  const db = whopDb([{ lesson_id: 'a6l10', completed_at: null, action_completed_at: null, discord_message_link: LINK }])
  await whopEvent('a6l10')
  const got = rowOf(db, 'a6l10')
  ok(isDone(got, 'a6l10') && got.action_completed_at === got.completed_at && got.discord_message_link === LINK && same(stepNames(), AFTER_LESSON),
     'webhook, a6l10 with a link saved before: finished with both halves at one moment, the link kept, the steps once', show(got))
}
{
  const db = whopDb()
  await whopEvent('a5l23')
  const got = rowOf(db, 'a5l23')
  ok(!!got?.completed_at && got.action_completed_at === null && !isDone(got, 'a5l23'),
     'webhook, a5l23 (it keeps its link): the watch half only, as before, so it waits for the link and the button', show(got))
}
{
  const db = whopDb([{ lesson_id: 'a6l17', completed_at: '2026-10-19T18:00:00.000Z', action_completed_at: null }])
  await whopEvent('a6l17')
  ok(rowOf(db, 'a6l17').action_completed_at === null && steps.length === 0,
     'webhook, a6l17 already holding the watch half alone: left as it is, no step (the backfill fills it, below)', show(rowOf(db, 'a6l17')))
}
{
  // a5l08, a video: finished on Whop with no row, both halves, its watch half from Whop's event as for any lesson.
  const db = whopDb()
  const status = await whopEvent('a5l08')
  const got = rowOf(db, 'a5l08')
  ok(status === 200 && isDone(got, 'a5l08') && Math.abs(Date.parse(got.completed_at) - Date.parse(got.action_completed_at)) < 5000 && got.completed_at_real === true && same(stepNames(), AFTER_LESSON),
     'webhook, a5l08 (a video) finished on Whop with no row: both halves at the moment it arrives, done, the steps once', show(got))
}
{
  // a5l12: Done pressed in the app before its video, then Whop says it is finished.
  const db = whopDb([{ lesson_id: 'a5l12', completed_at: null, action_completed_at: PRESSED, discord_message_link: LINK }])
  const status = await whopEvent('a5l12')
  const got = rowOf(db, 'a5l12')
  ok(status === 200 && isDone(got, 'a5l12') && got.action_completed_at === PRESSED && got.completed_at > PRESSED && got.completed_at_real === true &&
     got.discord_message_link === LINK && same(stepNames(), AFTER_LESSON),
     'webhook, a5l12 with Done pressed before its video: the watch half at the moment the event arrives, the student\'s Done kept at its own time, done, the steps once', show(got))
  const halves = db.calls('student_lesson_completions', 'update').filter((q) => q.values && 'action_completed_at' in q.values)
  ok(halves.length > 0 && halves.every((q) => q.filters.includes('action_completed_at is null')),
     'the webhook writes an action half only where the row has none: its every write of one asks for an empty action half', show(halves.map((q) => q.filters)))
  steps.length = 0
  const again = await whopEvent('a5l12')
  ok(again === 200 && steps.length === 0 && same(rowOf(db, 'a5l12'), got), 'the same event again: nothing written, no step', show(stepNames()))
}
{
  // a5l08 watched in the app (the player's watch half), Done not pressed, then Whop says it is finished.
  const db = whopDb([{ lesson_id: 'a5l08', completed_at: LATER, action_completed_at: null, completed_at_real: true }])
  await whopEvent('a5l08')
  ok(rowOf(db, 'a5l08').completed_at === LATER && rowOf(db, 'a5l08').action_completed_at === null && steps.length === 0,
     'webhook, a5l08 watched in the app: left as it is, as a6l17 is (the backfill fills its action half)', show(rowOf(db, 'a5l08')))
}
{
  const db = whopDb(UP_TO_A6L03)
  const opened = hoursAgo(3)
  onWhop([['a6l03', opened]])
  const [r] = await backfill()
  const got = rowOf(db, 'a6l03')
  ok(r.syncedCount === 1 && isDone(got, 'a6l03') && got.action_completed_at === opened && got.completed_at > opened,
     'backfill (a login or a visit), a6l03 finished on Whop: added with both halves, the action half at Whop\'s time, before the sync\'s own', show(got))
  ok(same(mapOf(db), { place: 5, next: 'a6l04', done: 3 }), 'and the map opens a6l04: the student is no longer held at a6l03', show(mapOf(db)))
}
{
  // Three of the four of AI Ads + Content and a5l23 arrive in one visit; a6l17's watch half came
  // in at a login before 2026-10-22, with no action half.
  const LOGIN = '2026-10-19T18:00:00.000Z'
  const db = whopDb([{ lesson_id: 'a6l17', completed_at: LOGIN, action_completed_at: null }])
  const times = { a6l03: hoursAgo(5), a6l10: hoursAgo(4), a6l17: '2026-10-16T09:00:00.000Z', a6l19: hoursAgo(3), a5l23: hoursAgo(2) }
  onWhop(Object.entries(times))
  const [r] = await backfill()
  const by = Object.fromEntries(db.rows('student_lesson_completions').map((x) => [x.lesson_id, x]))
  const FOUR = ['a6l03', 'a6l10', 'a6l17', 'a6l19']
  ok(r.syncedCount === 4, 'backfill: 4 rows added; the action half written on a6l17\'s older row is not counted as new (its watch half was)', show(r.syncedCount))
  ok(['a6l03', 'a6l10', 'a6l19'].every((id) => by[id].action_completed_at === times[id]) && FOUR.every((id) => isDone(by[id], id)),
     'each of the four is done, its action half at the time Whop gives for it', show(FOUR.map((id) => by[id].action_completed_at)))
  ok(by.a6l17.completed_at === LOGIN && by.a6l17.action_completed_at === times.a6l17,
     'a6l17\'s older row: the action half at Whop\'s time, the watch half keeps the login\'s', show(by.a6l17))
  ok(by.a5l23.action_completed_at === null && !isDone(by.a5l23, 'a5l23'), 'a5l23 still waits for its link and its button', show(by.a5l23))
  const [badges] = await quietly(() => evaluateAchievements(fakeClient(db), 's1'))
  ok(Array.isArray(badges) && badges.includes('first_action_shipped') && !badges.includes('triple_play'),
     'the badges: the four count as action items done (Took the Shot), and the lessons one sync brings in make no Triple Threat', show(badges))
  const requiresAction = new Map(LESSONS.map((l) => [l.id, l.requires_action]))
  const rows = db.rows('student_lesson_completions').map((x) => ({ ...x, completed_at_real: x.completed_at_real === true }))
  const atSyncTime = rows.map((x) => (isDoneOnly(x.lesson_id) ? { ...x, action_completed_at: x.completed_at } : x))
  ok(mostFinishedInOneDay(rows, requiresAction) === 0 && mostFinishedInOneDay(atSyncTime, requiresAction) === 3,
     'why Whop\'s time: with it no row of the sync counts toward a day, as for every lesson a sync brings in; with the sync\'s own time three would count on one day, a Triple Threat for nothing',
     show([mostFinishedInOneDay(rows, requiresAction), mostFinishedInOneDay(atSyncTime, requiresAction)]))
}
{
  // The two with a video in one visit: a5l08 with no row, a5l12 with Done pressed in the app before its video.
  const db = whopDb([{ lesson_id: 'a5l12', completed_at: null, action_completed_at: PRESSED }])
  const times = { a5l08: hoursAgo(5), a5l12: hoursAgo(4) }
  onWhop(Object.entries(times))
  const [r] = await backfill()
  const [a, b] = [rowOf(db, 'a5l08'), rowOf(db, 'a5l12')]
  ok(r.syncedCount === 2 && isDone(a, 'a5l08') && a.action_completed_at === times.a5l08 && a.completed_at > times.a5l08,
     'backfill, a5l08 finished on Whop: added with both halves, the action half at Whop\'s time, the watch half the pull\'s', show(a))
  ok(isDone(b, 'a5l12') && b.action_completed_at === PRESSED && b.completed_at > PRESSED,
     'a5l12 with Done pressed before its video: finished by the pull (its watch half from Whop\'s list), the student\'s Done kept at its own time', show(b))
}
{
  // Done pressed on a5l08; Whop lists Static Ads' lessons around it, not a5l08 itself.
  const db = whopDb([{ lesson_id: 'a5l08', completed_at: null, action_completed_at: PRESSED }])
  onWhop([['a5l07', hoursAgo(3)], ['a5l09', hoursAgo(2)], ['a5l12', hoursAgo(1)]])
  const [r] = await backfill()
  const got = rowOf(db, 'a5l08')
  ok(!(r instanceof Error) && r.syncedCount === 3 && got.completed_at === null && got.action_completed_at === PRESSED && !isDone(got, 'a5l08'),
     'backfill, Whop listing a5l07, a5l09 and a5l12 and not a5l08: a5l08 keeps its Done and gets no watch half (the video\'s half comes only from what Whop reports for that lesson)', show(got))
  steps.length = 0
  await whopEvent('a5l09')
  ok(rowOf(db, 'a5l08').completed_at === null && rowOf(db, 'a5l08').action_completed_at === PRESSED,
     'and Whop\'s event for another lesson (a5l09) leaves it as it is', show(rowOf(db, 'a5l08')))
}
{
  // a5l08 watched in the app, then listed on Whop: the backfill fills the action half the webhook left.
  const db = whopDb([{ lesson_id: 'a5l08', completed_at: LATER, action_completed_at: null, completed_at_real: true }])
  const opened = hoursAgo(30)
  onWhop([['a5l08', opened]])
  const [r] = await backfill()
  const got = rowOf(db, 'a5l08')
  ok(r.syncedCount === 0 && got.completed_at === LATER && got.action_completed_at === opened && isDone(got, 'a5l08'),
     'backfill, a5l08 watched in the app and listed on Whop: the action half at Whop\'s time, the app\'s watch half kept, nothing counted as new', show(got))
}
{
  // Whop lists a6l10 twice, an unreadable time between: the earlier time is taken.
  const db = whopDb()
  const [later, earlier] = [hoursAgo(2), hoursAgo(6)]
  onWhop([['a6l10', later], ['a6l10', 'not a time'], ['a6l10', earlier]])
  await backfill()
  ok(rowOf(db, 'a6l10')?.action_completed_at === earlier, 'backfill: a lesson Whop lists twice takes the earlier of its times', show(rowOf(db, 'a6l10')))
}
{
  // whopActionTime: Whop's time when it reads as one and is not later than now, else the row's.
  const now = Date.parse('2026-10-22T10:00:00.000Z')
  const row = '2026-10-22T09:00:00.000Z'
  ok(whopActionTime('2026-10-20T08:00:00Z', row, now) === '2026-10-20T08:00:00.000Z' && whopActionTime('2026-10-23T08:00:00Z', row, now) === row &&
     whopActionTime(null, row, now) === row && whopActionTime('not a time', row, now) === row && whopActionTime(undefined, row, now) === row,
     'whopActionTime: Whop\'s time, else the row\'s own when Whop gives none, an unreadable one or one later than now')
}
{
  const db = whopDb()
  const opened = hoursAgo(1)
  onWhop([['a6l03', opened]])
  db.failWhen = (q) => (q.table === 'student_lesson_completions' && q.op === 'select' && q.columns === 'lesson_id, completed_at, action_completed_at'
    ? { message: 'connection reset' } : null)
  const [r] = await backfill()
  const syncRow = () => db.rows('student_whop_sync').find((x) => x.student_id === 's1')
  ok(r instanceof Error && r.message === 'Done-only rows read failed: connection reset' && syncRow()?.last_sync_error === r.message,
     'backfill: the read of the seven\'s rows failing is an error, written on the sync row, never "nothing to fill"', show({ r: String(r), sync: syncRow()?.last_sync_error }))
  db.failWhen = (q) => (q.table === 'student_lesson_completions' && q.op === 'update' && q.values && 'action_completed_at' in q.values
    ? { message: 'connection reset' } : null)
  const [r2] = await backfill()
  ok(r2 instanceof Error && r2.message === 'Done-only action half failed: connection reset' && rowOf(db, 'a6l03').action_completed_at === null,
     'the write failing is an error too, and the half is not written', show(String(r2)))
  db.failWhen = null
  const [r3] = await backfill()
  ok(!(r3 instanceof Error) && rowOf(db, 'a6l03').action_completed_at === opened && isDone(rowOf(db, 'a6l03'), 'a6l03') && syncRow().last_sync_error === null,
     'and the next visit fills it, the sync row clear', show(rowOf(db, 'a6l03')))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
