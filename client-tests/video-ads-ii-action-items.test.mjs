// video-ads-ii-action-items.test.mjs: Video Ads II's four editing breakdowns,
// a4l02 to a4l05, as action items with a Discord link (the owner's decision
// of 2026-10-22 and 23: the coaches of Video Ads I and II named their action
// items, every one handed in on Discord). Migration v114 sets requires_action
// and the brief on the four in the live catalog, and nothing in the app's
// code changes for them. This suite proves the app as it is handles them as
// any action item with a link, on v114's rows, on the real source:
//
//   1. v114's rows    the four and their briefs read out of the migration's
//                     own text, held to course_catalog.json; the catalog as
//                     GET /api/student/data hands it over after v114 (the data
//                     file's rows) and before it (the four plain videos)
//   2. the block      the lesson page's choice (LessonScreen.tsx: the
//                     Milestone box and the block on requires_action, the
//                     kind by isDoneOnly) and ActionItemBlock rendered by
//                     React's server renderer for each of the four: the
//                     Discord kind before its video, after it, with a link
//                     saved, and handed in
//   3. the routes     save-action-link and mark-action-shipped on the new
//                     course: before v114 neither takes the four; after it
//                     the hand-in is refused without a link, and with one it
//                     goes through, the lesson done once its video is watched
//                     too, in either order
//   4. the 30%        a student who watched every video through Video Ads II
//                     and handed in none of the four: ready on the map
//                     (discountState), granted by the request route's rule
//                     (decideDiscountRequest), approved by the approve
//                     route's (approvalVerdict), the same before v114
//   5. the map        none of the four holds a student once its video is
//                     watched (buildMapModel, isPassed); Video Ads II reads
//                     done only with the four handed in
//   6. done           isLessonComplete needs the link half on the four (its
//                     SQL twin, lesson_is_complete, runs on v114's rows in
//                     supabase/migration-tests/v114.test.mjs)
//   7. the CSM        every built-in trigger of the new course, and the alert
//                     mapping, before v114 and after it, for three students
//                     on every course day from 1 to 30: none fires on the four
//   8. the drawer     buildStudentDetail lists the four among the action
//                     items: "Not yet", then "Handed in" with the link
//
// build.mjs copies the modules and the routes (run it first; `npm run
// test:client` does); the block is compiled here as Next compiles it, into
// _gen/video-ads-ii-block.mjs. Every student, id and link here is made up.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')

// The lesson page's block, compiled as Next compiles it (done-only.test.mjs does the same into its own file).
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
  fs.writeFileSync(here('./_gen/video-ads-ii-block.mjs'), s)
}

const { ActionItemBlock } = await import('./_gen/video-ads-ii-block.mjs')
const { DONE_ONLY_ACTION_ITEMS, PASTE_LINK_FIRST, isDoneOnly, takesDiscordLink, hasActionHalf } = await import('./_gen/action-items.ts')
const { completedLessonIdsFor, isLessonComplete } = await import('./_gen/progress.ts')
const { POST: markShipped } = await import('./_gen/mark-action-shipped-route.ts')
const { POST: saveLink } = await import('./_gen/save-action-link-route.ts')
const { useDb: openDb, FakeDb, setCatalog, steps } = await import('./_gen/stub-server.ts')
const { discountState, requiredLessons } = await import('./_gen/discount.ts')
const { approvalVerdict, decideDiscountRequest, toDiscountLessons, videoDoneIds } = await import('./_gen/discount-server.ts')
const { buildWorldCatalog } = await import('./_gen/catalog.ts')
const { buildMapModel, isPassed, MAP_PLACES } = await import('./_gen/map-model.ts')
const { alertTask, buildStudentSnapshot, evaluateCustomTrigger, triggers } = await import('./_gen/csm-triggers.ts')
const D = await import('./_gen/student-detail.ts')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const same = (a, b) => show(a) === show(b)
async function quietly(fn) {
  const real = [console.info, console.warn, console.error]
  console.info = console.warn = console.error = () => {}
  try { return await fn() } catch (e) { return e } finally { [console.info, console.warn, console.error] = real }
}

const FOUR = ['a4l02', 'a4l03', 'a4l04', 'a4l05']
const LINK = 'https://discord.com/channels/1100000000000000001/1200000000000000002/1300000000000000003'
const EARLIER = '2026-10-20T09:00:00.000Z'
const LATER = '2026-10-21T09:00:00.000Z'
/** The course switch, as admin_config holds it after v104 (made up to the second). */
const RESET = '2026-10-19T14:33:33.972Z'

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== 1. v114\'s rows ===')
const V114 = fromSrc('supabase/migrations/2026_v114_video_ads_ii_action_items.sql')
const sqlText = (s) => s.slice(1, -1).replaceAll("''", "'")
const ids = (/c_ids\s+constant text\[\] := array\[([^\]]*)\];/.exec(V114)?.[1].match(/'[^']*'/g) ?? []).map(sqlText)
const briefs = ([.../c_briefs constant text\[\] := array\[([\s\S]*?)\n {2}\];/.exec(V114)?.[1].matchAll(/'(?:[^']|'')*'/g) ?? []]).map((m) => sqlText(m[0]))
const V114_BRIEF = Object.fromEntries(ids.map((id, i) => [id, briefs[i]]))
const CATALOG = JSON.parse(fromSrc('supabase/catalog/course_catalog.json'))
const LENGTHS = JSON.parse(fromSrc('src/app/dev/world-app/course-lengths.fixture.json'))
ok(same(ids, FOUR) && briefs.length === 4, 'v114 holds the four, a4l02 to a4l05, each with one brief', show(ids))
ok(FOUR.every((id) => CATALOG.lessons.find((l) => l.id === id)?.action_brief === V114_BRIEF[id]),
   'course_catalog.json holds the same four briefs, word for word: a catalog rebuilt from it agrees with v114', show(briefs))
ok(Object.values(V114_BRIEF).every((b) => !/—|unlock|ecomtalent|http|www\./i.test(b)), 'no em dash, no "unlock", no "EcomTalent" and no link in what students read')

/** The catalog's rows as GET /api/student/data hands them to the app after v101, the video load and the switch. */
const rowsOf = (withFour) => CATALOG.lessons.map((l, i) => {
  const brief = FOUR.includes(l.id) && !withFour ? undefined : l.action_brief
  return {
    id: l.id, region_id: l.area, type: l.type, title: l.title, description: null, sort_order: i + 1,
    requires_action: brief !== undefined, action_brief: brief ?? null,
    is_optional: false, is_gate: l.gate === true, counts_toward_progress: l.counts !== false, feature_key: l.feature_key ?? null,
    has_video: LENGTHS[l.id] > 0 && l.type === 'watch', duration_seconds: LENGTHS[l.id] ?? null,
  }
})
/** Production's catalog after v114, and as it was before. */
const AFTER = rowsOf(true)
const BEFORE = rowsOf(false)
const lessonIn = (rows, id) => rows.find((l) => l.id === id)
const REGIONS = CATALOG.areas.map((a, i) => ({ id: a.id, order_num: i + 1, name: a.name }))
ok(FOUR.every((id) => { const l = lessonIn(AFTER, id); return l.region_id === 'a4' && l.type === 'watch' && l.has_video && l.requires_action && l.action_brief === V114_BRIEF[id] }),
   'after v114 the four are Video Ads II\'s watch lessons, each with a video and an action item with its brief', show(FOUR.map((id) => `${id} ${lessonIn(AFTER, id).duration_seconds}s`)))
ok(FOUR.every((id) => !lessonIn(BEFORE, id).requires_action && lessonIn(BEFORE, id).action_brief === null) &&
   AFTER.filter((l) => l.requires_action).length === 14 && BEFORE.filter((l) => l.requires_action).length === 10,
   'before it they are plain videos: 10 action items then, 14 now')
ok(FOUR.every((id) => !isDoneOnly(id)) && [...DONE_ONLY_ACTION_ITEMS].every((id) => !FOUR.includes(id)),
   'none of the four is on the Done-only list (DONE_ONLY_ACTION_ITEMS), so the page and the route give them the Discord kind')
ok(FOUR.every((id) => takesDiscordLink(lessonIn(AFTER, id)) && hasActionHalf(lessonIn(AFTER, id)) && !takesDiscordLink(lessonIn(BEFORE, id)) && !hasActionHalf(lessonIn(BEFORE, id))),
   'the routes\' two rules (takesDiscordLink, hasActionHalf) take the four from v114\'s rows alone, and did not before')

console.log('\n=== 2. The block: the Discord kind on each of the four ===')
const render = (props) => renderToString(createElement(ActionItemBlock, { separateWatchHalf: true, row: null, onSave: async () => null, onComplete: async () => null, ...props }))
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()
const buttons = (html) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1]))
const row = (completed_at, action_completed_at, discord_message_link = null) => ({ completed_at, action_completed_at, discord_message_link })
const renders = []
{
  const page = fromSrc('src/components/world/LessonScreen.tsx')
  ok(/\{lesson\.requires_action && \(\s*<div className=\{u\.milestone\}>[\s\S]*?\{lesson\.action_brief\}/.test(page) &&
     /\{lesson\.requires_action && \(\s*<ActionItemBlock[\s\S]*?doneOnly=\{isDoneOnly\(lesson\.id\)\}[\s\S]*?separateWatchHalf=\{watch\}/.test(page),
     'the lesson page (LessonScreen.tsx) puts the Milestone box with the brief and the block on any lesson with requires_action, its kind by isDoneOnly, a watch lesson\'s video a half of its own')
}
for (const id of FOUR) {
  const props = { doneOnly: isDoneOnly(id), separateWatchHalf: lessonIn(AFTER, id).type === 'watch' }
  const empty = render(props)
  const watched = render({ ...props, row: row(EARLIER, null) })
  const saved = render({ ...props, row: row(null, null, LINK) })
  const savedWatched = render({ ...props, row: row(EARLIER, null, LINK) })
  const handedIn = render({ ...props, row: row(EARLIER, LATER, LINK) })
  renders.push(empty, watched, saved, savedWatched, handedIn)
  ok(/data-hand-in="link"/.test(empty) && /data-action-item="empty"/.test(empty) && /<h2[^>]*>Discord link<\/h2>/.test(empty) && /<input[^>]*type="url"/.test(empty) &&
     same(buttons(empty), ['How do I get the link?', 'Save']) && text(empty).includes('Post your work in Discord, then paste the link to your message here.'),
     `${id}, nothing done: the Discord kind, "Discord link" over a field and Save, no Done and no complete button`, show(buttons(empty)))
  ok(/data-action-item="empty"/.test(watched) && /<input/.test(watched) && same(buttons(watched), buttons(empty)),
     `${id}, its video watched: still the field and Save, no complete button until a link is saved`)
  ok(/data-action-item="saved"/.test(saved) && saved.includes(`href="${LINK}"`) && buttons(saved).includes('Complete the action') &&
     /data-action-item="saved"/.test(savedWatched) && buttons(savedWatched).includes('Complete lesson'),
     `${id}, a link saved: the link, then "Complete the action" before its video, "Complete lesson" after`, show([buttons(saved), buttons(savedWatched)]))
  ok(/data-action-item="completed"/.test(handedIn) && /Completed on/.test(text(handedIn)) && handedIn.includes(`href="${LINK}"`) && buttons(handedIn).includes('Edit link') && !buttons(handedIn).includes('Done'),
     `${id}, handed in: "Completed on <date>." with the link, still editable`)
}
ok(renders.every((h) => !/—|unlock|ecomtalent/i.test(text(h))), 'no em dash, no "unlock", no "EcomTalent" in any of them')

console.log('\n=== 3. The routes, on the new course ===')
setCatalog({ v2: true })
function freshDb(lessons, completions = []) {
  const db = new FakeDb({
    students: [{ id: 's1', supabase_user_id: 'auth-1', whop_user_id: 'user_1', email: 'student@example.com',
      joined_at: '2026-10-12T10:00:00.000Z', first_paid_at: '2026-10-12T10:00:00.000Z', last_active_at: '2026-09-01T08:00:00.000Z' }],
    lessons: lessons.map(({ id, region_id, type, title, sort_order, requires_action, counts_toward_progress, duration_seconds }) =>
      ({ id, region_id, type, title, sort_order, requires_action, counts_toward_progress, duration_seconds })),
    student_lesson_completions: completions.map((c) => ({ student_id: 's1', ...c })),
    student_streaks: [{ student_id: 's1', current_streak: 0, longest_streak: 0, last_streak_date: null }],
    admin_config: [{ key: 'curriculum_reset_at', value: RESET }],
    student_achievements: [],
  }, { 'tok-1': 'auth-1' })
  openDb(db)
  steps.length = 0
  return db
}
const post = (body) => new Request('http://app/api/student/x', {
  method: 'POST', headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' }, body: JSON.stringify(body),
})
async function call(handler, body) {
  const res = await quietly(() => handler(post(body)))
  if (res instanceof Error) return { status: 'threw', body: res.message }
  return { status: res.status, body: await res.json() }
}
const rowOf = (db, id) => db.rows('student_lesson_completions').find((r) => r.lesson_id === id) ?? null
const isDone = (r, id, lessons = AFTER) => !!r && isLessonComplete({ lesson_id: id, skipped_at: null, ...r }, lessonIn(lessons, id))
for (const id of FOUR) {
  const db = freshDb(BEFORE, [{ lesson_id: id, completed_at: EARLIER, action_completed_at: null, discord_message_link: null }])
  const link = await call(saveLink, { lessonId: id, link: LINK })
  const hand = await call(markShipped, { lessonId: id, shipped: true })
  const got = rowOf(db, id)
  ok(link.status === 400 && link.body.error === 'Only action-item lessons can have a Discord link' && hand.status === 400 && hand.body.error === 'Not a compound lesson' &&
     db.rows('student_lesson_completions').length === 1 && got.completed_at === EARLIER && got.action_completed_at === null && got.discord_message_link === null && steps.length === 0,
     `${id} before v114: a plain video, so neither route takes it (nothing written)`, show([link.body, hand.body]))
}
for (const id of FOUR) {
  const db = freshDb(AFTER)
  const r = await call(markShipped, { lessonId: id, shipped: true })
  ok(r.status === 400 && r.body.error === PASTE_LINK_FIRST && rowOf(db, id) === null && steps.length === 0,
     `${id} after v114, no row and no link: the hand-in is refused ("${PASTE_LINK_FIRST}"), nothing written, no step`, show(r))
}
for (const id of FOUR) {
  const db = freshDb(AFTER, [{ lesson_id: id, completed_at: EARLIER, action_completed_at: null, discord_message_link: null }])
  const r = await call(markShipped, { lessonId: id, shipped: true })
  ok(r.status === 400 && r.body.error === PASTE_LINK_FIRST && rowOf(db, id).action_completed_at === null && !isDone(rowOf(db, id), id) && steps.length === 0,
     `${id}, its video watched and no link: refused, the action half stays empty, the lesson not done`, show(r.body))
}
for (const id of FOUR) {
  // The video, then the link, then the button: the lesson page's order.
  const db = freshDb(AFTER, [{ lesson_id: id, completed_at: EARLIER, action_completed_at: null, discord_message_link: null }])
  const saved = await call(saveLink, { lessonId: id, link: LINK })
  const r = await call(markShipped, { lessonId: id, shipped: true })
  const got = rowOf(db, id)
  ok(saved.status === 200 && r.status === 200 && got.discord_message_link === LINK && got.completed_at === EARLIER && !!got.action_completed_at && isDone(got, id) &&
     same(steps.map((s) => s.step), ['streak', 'active', 'r2', 'came-back', 'achievements', 'tasks']),
     `${id}, watched, link saved, handed in: both halves, the link kept, done, the steps of a lesson finished`, show({ row: got, steps: steps.map((s) => s.step) }))
}
{
  // The other order: the link and the button first, the video after. Not done until the video is watched.
  const db = freshDb(AFTER)
  await call(saveLink, { lessonId: 'a4l05', link: LINK })
  const r = await call(markShipped, { lessonId: 'a4l05', shipped: true })
  const got = rowOf(db, 'a4l05')
  ok(r.status === 200 && got.completed_at === null && !!got.action_completed_at && !isDone(got, 'a4l05') &&
     same(steps.map((s) => s.step), ['streak', 'r2', 'came-back', 'achievements', 'tasks']),
     'a4l05 handed in before its video: the action half alone, not done, the steps of an action done before its video (no "last active")', show({ row: got, steps: steps.map((s) => s.step) }))
  ok(isDone({ ...got, completed_at: LATER }, 'a4l05'), 'and done once the video is watched too')
}

console.log('\n=== 4. The 30%: every video through Video Ads II, none of the four handed in ===')
const NOW = new Date('2026-10-23T10:00:00.000Z')
const FIRST_PAID = '2026-10-12T10:00:00.000Z'
const REQUEST_AT = '2026-10-23T09:00:00.000Z'
/** The server's reads (loadDiscountReads), from these rows: a video on every watch lesson the lengths file has, loaded on 14 October. */
const readsOf = (lessons, completions, requests = []) => ({
  student: { data: { first_paid_at: FIRST_PAID }, error: null },
  lessons: { data: lessons.map(({ id, type, counts_toward_progress, is_gate, duration_seconds }) => ({ id, type, counts_toward_progress, is_gate, duration_seconds })), error: null },
  videos: { data: lessons.filter((l) => l.has_video).map((l) => ({ lesson_id: l.id, created_at: '2026-10-14T00:00:00.000Z' })), error: null },
  completions: { data: completions, error: null },
  requests: { data: requests, error: null },
})
{
  const asked = requiredLessons(toDiscountLessons(readsOf(AFTER, []).lessons.data, new Set(AFTER.filter((l) => l.has_video).map((l) => l.id))))
  const gate = AFTER.findIndex((l) => l.is_gate)
  ok(asked.at(-1)?.id === 'a4l17' && AFTER[gate].id === 'a4l17' && FOUR.every((id) => asked.some((l) => l.id === id)),
     `the 30% asks for ${asked.length} videos, up to its gate a4l17 (the last of Video Ads II), the four's videos among them`, show({ n: asked.length, last: asked.at(-1)?.id }))
  // Every video it asks for watched (the watch half alone: completed_at), no action half anywhere.
  const watchedAll = asked.map((l) => ({ lesson_id: l.id, completed_at: EARLIER }))
  const state = (lessons, completions) => discountState({
    now: NOW, firstPaidAt: FIRST_PAID, requests: [], membershipDiscounted: false,
    lessons: toDiscountLessons(readsOf(lessons, []).lessons.data, new Set(lessons.filter((l) => l.has_video).map((l) => l.id))),
    videoDoneIds: videoDoneIds(completions),
  })
  const mine = state(AFTER, watchedAll)
  ok(mine.kind === 'ready' && mine.lessonsTotal === asked.length && same(mine, state(BEFORE, watchedAll)),
     'the map\'s panel (discountState): ready, with none of the four handed in, exactly as before v114', show(mine))
  ok(same(decideDiscountRequest(readsOf(AFTER, watchedAll), NOW), { grant: true }),
     'the request route\'s rule (decideDiscountRequest): granted')
  const verdict = approvalVerdict(readsOf(AFTER, watchedAll, [{ id: 'req-1', status: 'pending', created_at: REQUEST_AT }]), NOW, REQUEST_AT, 'req-1', RESET)
  ok(same(verdict, { ok: true }), 'the approve route\'s rule (approvalVerdict): approved', show(verdict))
  // The four's videos are still asked for: without them the 30% is locked on them.
  const noFour = watchedAll.filter((c) => !FOUR.includes(c.lesson_id))
  const locked = state(AFTER, noFour)
  ok(locked.kind === 'locked' && locked.lessonsLeft === 4 && locked.nextLessonId === 'a4l02',
     'their videos are still asked for: with the four not watched it is locked, 4 left, a4l02 next', show({ kind: locked.kind, left: locked.lessonsLeft, next: locked.nextLessonId }))
}

console.log('\n=== 5. The map: none of the four holds a student once its video is watched ===')
const counting = AFTER.filter((l) => l.counts_toward_progress).map((l) => l.id)
const upTo = (id) => counting.slice(0, counting.indexOf(id) + 1)
/** Watched and handed in where the lesson has an action item (both halves), the watch half on the others. */
const doneRow = (lessons) => (id) => ({ lesson_id: id, completed_at: EARLIER, action_completed_at: lessonIn(lessons, id).requires_action ? EARLIER : null, skipped_at: null })
const watchedRow = (id) => ({ lesson_id: id, completed_at: EARLIER, action_completed_at: null, skipped_at: null })
/** The map on these rows, read as StudentContext reads them: done by isLessonComplete, watched by completed_at. */
function mapOf(lessons, rows) {
  const completedLessonIds = completedLessonIdsFor(rows, lessons)
  const watchedLessonIds = new Set(rows.filter((r) => r.completed_at).map((r) => r.lesson_id))
  const cat = buildWorldCatalog({ lessons, regions: REGIONS, completedLessonIds, watchProgress: new Map() })
  const m = buildMapModel({ areas: cat.areas, lessonsByArea: cat.lessonsByArea, completedLessonIds, watchedLessonIds })
  const next = m.ok && m.place < MAP_PLACES ? m.areas[m.place].lessons[m.placeNext]?.id ?? null : null
  return { m, next, lesson: (id) => m.areas.flatMap((a) => a.lessons).find((l) => l.id === id) }
}
{
  const base = upTo('a4l01').map(doneRow(AFTER))
  for (let k = 0; k < FOUR.length; k++) {
    const watched = FOUR.slice(0, k + 1)
    const after = mapOf(AFTER, [...base, ...watched.map(watchedRow)])
    const before = mapOf(BEFORE, [...base, ...watched.map(watchedRow)])
    const nextWant = FOUR[k + 1] ?? 'a4l06'
    ok(after.next === nextWant && after.m.place === 3 && before.next === nextWant &&
       watched.every((id) => after.lesson(id).action && !after.lesson(id).done && after.lesson(id).passed && before.lesson(id).done),
       `${watched.join(', ')} watched: ${nextWant} is next, as before v114; ${watched.length === 1 ? 'it is an open action item' : 'they are open action items'}, passed, not done (before: done)`,
       show({ next: after.next, done: after.m.areas[3].done, before: before.m.areas[3].done }))
  }
  for (const id of FOUR) {
    ok(isPassed(lessonIn(AFTER, id), false, true) && !isPassed(lessonIn(AFTER, id), false, false),
       `${id}: the lesson page's "Next lesson" (isPassed) is lit by its watched video alone, never by nothing`)
  }
  // Every lesson of places 1 to 4 finished, but the four only watched: the student is in Static Ads.
  const a1to4 = counting.filter((id) => ['a1', 'a2', 'a3', 'a4'].includes(lessonIn(AFTER, id).region_id))
  const rows = a1to4.map((id) => (FOUR.includes(id) ? watchedRow(id) : doneRow(AFTER)(id)))
  const after = mapOf(AFTER, rows)
  const before = mapOf(BEFORE, rows)
  ok(after.m.place === 4 && after.next === 'a5l01' && before.m.place === 4 && before.next === 'a5l01',
     'places 1 to 4 finished but the four only watched: the student is in Static Ads, a5l01 next, as before v114', show({ place: after.m.place + 1, next: after.next }))
  ok(after.m.areas[3].done === 13 && after.m.areas[3].lessons.length === 17 && before.m.areas[3].done === 17 && after.m.doneTotal === before.m.doneTotal - 4,
     'and Video Ads II is 13 of 17 (17 before v114): the four count open until handed in', `${after.m.areas[3].done} of ${after.m.areas[3].lessons.length}`)
  const handed = mapOf(AFTER, a1to4.map(doneRow(AFTER)))
  ok(handed.m.areas[3].done === 17 && handed.next === 'a5l01', 'with the four handed in, 17 of 17')
}

console.log('\n=== 6. Done needs the link half on the four ===')
for (const id of FOUR) {
  const watchOnly = { lesson_id: id, completed_at: EARLIER, action_completed_at: null, skipped_at: null }
  const actionOnly = { lesson_id: id, completed_at: null, action_completed_at: EARLIER, skipped_at: null }
  const both = { lesson_id: id, completed_at: EARLIER, action_completed_at: LATER, skipped_at: null }
  ok(!isLessonComplete(watchOnly, lessonIn(AFTER, id)) && !isLessonComplete(actionOnly, lessonIn(AFTER, id)) && isLessonComplete(both, lessonIn(AFTER, id)) &&
     isLessonComplete(watchOnly, lessonIn(BEFORE, id)),
     `${id}: isLessonComplete, the video alone not done and the hand-in alone not done, both done (before v114 the video alone was)`)
}

console.log('\n=== 7. The CSM: no trigger of the new course fires on the four ===')
{
  const DAY = 86_400_000
  const now = Date.now()
  const lessonsCsm = (lessons) => lessons.map(({ id, region_id, requires_action, counts_toward_progress }) => ({ id, region_id, requires_action, counts_toward_progress }))
  const totals = (lessons) => lessons.reduce((t, l) => ({ ...t, [l.region_id]: (t[l.region_id] ?? 0) + 1 }), {})
  // The switch well before every first payment below, so a student's course day counts from their payment.
  const course = { regionOrder: REGIONS.map((r) => r.id), resetAt: new Date(now - 60 * DAY).toISOString() }
  const snapOn = (lessons, completions, day) => {
    const paid = new Date(now - (day - 1) * DAY - 3_600_000).toISOString()
    const student = { id: 's1', name: 'Mila Example', joined_at: paid, first_paid_at: paid, membership_status: 'active', last_active_at: paid, cancel_scheduled_at: null }
    return buildStudentSnapshot(student, completions.map((c) => ({ student_id: 's1', skipped_at: null, ...c })), lessonsCsm(lessons), totals(lessons), [], { first_sprint_login_at: paid }, course)
  }
  const at = new Date(now - 4 * DAY).toISOString()
  const through = upTo('a4l17').map((id) => ({ lesson_id: id, completed_at: at, action_completed_at: lessonIn(AFTER, id).requires_action && !FOUR.includes(id) ? at : null }))
  const students = {
    'watched everything through Video Ads II, none of the four handed in': through,
    'watched the four alone': FOUR.map((id) => ({ lesson_id: id, completed_at: at, action_completed_at: null })),
    'nothing yet': [],
  }
  const fired = (lessons, completions) => {
    const out = []
    for (let day = 1; day <= 30; day++) {
      const s = snapOn(lessons, completions, day)
      for (const [scenario, check] of Object.entries(triggers)) if (check(s)) out.push(`${scenario}@${day}`)
    }
    return out
  }
  for (const [who, completions] of Object.entries(students)) {
    const after = fired(AFTER, completions)
    const before = fired(BEFORE, completions)
    ok(same(after, before) && (who === 'nothing yet' ? after.length > 0 && after.every((f) => f.startsWith('nolessons.')) : after.length === 0),
       `${who}: every built-in trigger on every course day 1 to 30 fires exactly as before v114 (${after.length ? after.join(' ') : 'none'})`)
  }
  const s = snapOn(AFTER, through, 10)
  ok(s.courseIsNew && FOUR.every((id) => s.watched[id] === true && s.shipped[id] === false) && s.shipped.a3l17 === true,
     'the snapshot after v114 knows the four as action items watched and not handed in (shipped false), beside a3l17 handed in')
  ok(['noship.r1.day7', 'noship.r2.day14', 'pace.day7', 'pace.day14', 'pace.day21'].every((id) => triggers[id](snapOn(AFTER, through, Number(id.match(/\d+$/)[0]))) === null),
     'the old course\'s noship and pace rules, the only ones about hand-ins and pace, are off on the new course')
  // The one reader of the lessons done: the alert mapping's "0 counted lessons" gate (alertTask, no_lessons_3d).
  const alerts = (lessons, completions) => [3, 7, 14].map((day) => alertTask('no_lessons_3d', 'No lesson in 3 days', snapOn(lessons, completions, day))?.scenarioId ?? null)
  ok(same(alerts(AFTER, through), [null, null, null]) && same(alerts(BEFORE, through), [null, null, null]),
     'the alert mapping, for a student with lessons done: no task before v114 or after it')
  const fourAlone = students['watched the four alone']
  const a3l17Alone = [{ lesson_id: 'a3l17', completed_at: at, action_completed_at: null }]
  ok(same(alerts(BEFORE, fourAlone), [null, null, null]) && same(alerts(AFTER, fourAlone), ['nolessons.day3', 'nolessons.day7', 'nolessons.day14']) &&
     same(alerts(AFTER, a3l17Alone), ['nolessons.day3', 'nolessons.day7', 'nolessons.day14']) &&
     triggers['nolessons.day3'](snapOn(AFTER, fourAlone, 3)) === null,
     'the one change: a student whose only lessons are among the four, watched and not handed in, has 0 lessons done, so a no_lessons_3d alert maps to a nolessons task, as it already does for a student who watched a3l17 alone; the nolessons rule itself does not match them (they watched lessons), so the cron\'s re-check dismisses it')
  // Custom templates: only one the team writes can name the four.
  const shippedNot = { all: [{ metric: 'lesson_shipped', lesson_id: 'a4l02', op: 'is_not' }] }
  ok(evaluateCustomTrigger(snapOn(AFTER, through, 10), shippedNot).match === evaluateCustomTrigger(snapOn(BEFORE, through, 10), shippedNot).match,
     'a template asking "a4l02 not shipped" matches before v114 and after it alike (a lesson with no action item was never shipped)')
  const a4complete = { all: [{ metric: 'region_complete', region: 'a4', op: 'is' }] }
  ok(evaluateCustomTrigger(snapOn(BEFORE, through, 10), a4complete).match === true && evaluateCustomTrigger(snapOn(AFTER, through, 10), a4complete).match === false,
     'a template on Video Ads II complete (region_complete a4) reads the four open until handed in, as every count does')
}

console.log('\n=== 8. The admin drawer ===')
{
  const lessons = AFTER.filter((l) => ['a3', 'a4'].includes(l.region_id)).map(({ id, region_id, title, type, requires_action, counts_toward_progress }) => ({ id, region_id, title, type, requires_action, counts_toward_progress }))
  const completions = [
    { lesson_id: 'a4l02', completed_at: EARLIER, action_completed_at: null, skipped_at: null, discord_message_link: null },
    { lesson_id: 'a4l03', completed_at: EARLIER, action_completed_at: LATER, skipped_at: null, discord_message_link: LINK },
  ]
  const ok_ = (data) => ({ ok: true, data })
  const reads = {
    student: ok_({ id: 's1', name: 'Mila Example', email: 'mila@example.com', discord_username: null, membership_status: 'active', first_paid_at: '2026-10-12T10:00:00.000Z',
      joined_at: '2026-10-12T10:00:00.000Z', last_active_at: EARLIER, cancel_scheduled_at: null, csm_exempt: false, ad_submissions_verified: false }),
    regions: ok_(REGIONS.slice(2, 4)), lessons: ok_(lessons), completions: ok_(completions),
    discount: ok_(null), streak: ok_(null), sync: ok_(null), programLink: ok_(null),
  }
  const d = D.buildStudentDetail(reads, { ok: true, resetAt: RESET, lastByStudent: new Map() }, '2026-10-22T10:00:00.000Z')
  const items = d.actionItems.ok ? d.actionItems.data : []
  const by = Object.fromEntries(items.map((a) => [a.id, a]))
  ok(same(items.map((a) => a.id), ['a3l17', 'a3l25', ...FOUR]), 'Video Ads I and II\'s action items in the drawer: a3l17, a3l25 and the four', show(items.map((a) => a.id)))
  ok(by.a4l02?.status === 'Not yet' && by.a4l02.link === null && by.a4l03?.status === 'Handed in' && by.a4l03.link === LINK && by.a4l04?.status === 'Not yet',
     'a4l02 watched only: "Not yet"; a4l03 handed in: "Handed in" with its link; a4l04 not started: "Not yet"', show([by.a4l02, by.a4l03, by.a4l04]))
  const a4 = d.areas.ok ? d.areas.data.find((a) => a.id === 'a4') : null
  ok(a4?.done === 1 && a4.total === 17, 'and Video Ads II counts 1 of 17 done: a4l02, its video watched, is open', show({ done: a4?.done, total: a4?.total }))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
