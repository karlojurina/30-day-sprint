// lesson-feedback.test.mjs: the team's Lesson feedback page,
// /admin/feedback/lessons (admin rebuild 2, D10, lane WI-7), below the page:
//   1. buildLessonFeedback (src/lib/admin/lesson-feedback.ts) on made-up rows:
//      by area in route order, then lesson in course order; each lesson's
//      average, count and comments newest first; which lessons are listed;
//      nothing dropped without a word;
//   2. loadLessonFeedback on stub-server.ts's database: only ratings since
//      the switch, every page past PostgREST's 1000 rows, students read in
//      batches, and every failed read named;
//   3. GET /api/admin/lesson-feedback through its own handler, over the REAL
//      team check (admin-auth.ts): who may read it, and a failure in words;
//   4. the frame: the page wears the dark look, the csm role is kept out.
// The page itself is drawn by world-tests/admin-pages.mjs (--only feedback)
// on /dev/admin/feedback/lessons.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildLessonFeedback, loadLessonFeedback } from './_gen/lesson-feedback.ts'
import * as route from './_gen/admin-lesson-feedback-route.ts'
import { FakeDb, MAX_ROWS, NextRequest, fakeClient, useDb as installDb } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const src = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const BANNED = [/—/, /\bunlock/i, /ecomtalent/i]
const plain = (s) => typeof s === 'string' && s.trim().length > 0 && BANNED.every((re) => !re.test(s))

async function hush(fn) {
  const real = [console.info, console.warn, console.error]
  console.info = console.warn = console.error = () => {}
  try { return await fn() } finally { [console.info, console.warn, console.error] = real }
}

const SWITCH = '2026-10-19T14:33:33.972Z'
const NOW = new Date('2026-10-24T09:00:00.000Z')
const h = (n) => new Date(Date.parse(SWITCH) + n * 3_600_000).toISOString()

// Two areas listed out of order, and a lesson filed under an area the read does not have.
const AREAS = [
  { id: 'a2', name: 'Marketing Fundamentals', order_num: 2 },
  { id: 'a1', name: 'Introduction', order_num: 1 },
  { id: 'a3', name: 'Video Ads I', order_num: 3 },
]
const LESSONS = [
  { id: 'a1l02', region_id: 'a1', title: 'Second', type: 'watch', sort_order: 2, feature_key: null },
  { id: 'a1l01', region_id: 'a1', title: 'Welcome', type: 'watch', sort_order: 1, feature_key: null },
  { id: 'a1l03', region_id: 'a1', title: 'A setup step', type: 'setup', sort_order: 3, feature_key: null },
  { id: 'a2l01', region_id: 'a2', title: 'How marketing works', type: 'watch', sort_order: 4, feature_key: null },
  { id: 'a2l02', region_id: 'a2', title: 'The Ad Bounty', type: 'watch', sort_order: 5, feature_key: 'bounty_access' },
  { id: 'a2l03', region_id: 'a2', title: 'Another setup step', type: 'setup', sort_order: 6, feature_key: null },
  { id: 'a3l01', region_id: 'a3', title: 'Unrated area lesson', type: 'watch', sort_order: 7, feature_key: null },
  { id: 'a9l01', region_id: 'a9', title: 'Under an unknown area', type: 'watch', sort_order: 8, feature_key: null },
]
const STUDENTS = [
  // The username too, which the page shows after the name (the render review's fix round).
  { id: 's-1', name: 'Ana Example', email: 's-1@example.com', discord_username: 'ana.example' },
  { id: 's-2', name: null, email: 's-2@example.com', discord_username: null },
  { id: 's-3', name: '  ', email: 's-3@example.com', discord_username: null },
]
let n = 0
const rating = (lesson, student, stars, comment, hours, editedHours) => ({
  id: `r-${String(++n).padStart(3, '0')}`, student_id: student, lesson_id: lesson, stars, comment,
  created_at: h(hours), updated_at: h(editedHours ?? hours),
})
const RATINGS = [
  rating('a1l01', 's-1', 5, 'Great.', 1),
  rating('a1l01', 's-2', 2, '   ', 2),
  // Edited later: it comes first though it was made first of these three.
  rating('a1l01', 's-3', 4, '  Edited later.  ', 0.5, 30),
  rating('a1l01', 's-gone', 3, 'From a student the read did not return.', 3),
  rating('a2l01', 's-1', 1, null, 4),
  // A setup step with a rating anyway (written before the route checked): listed.
  rating('a2l03', 's-2', 5, 'Rated before the check.', 5),
  // A lesson the catalog read does not have: counted apart.
  rating('zz-gone', 's-1', 4, 'Gone lesson.', 6),
]
const data = { since: SWITCH, areas: AREAS, lessons: LESSONS, ratings: RATINGS, students: STUDENTS }

console.log('\n=== buildLessonFeedback: by area, then lesson ===')
{
  const v = buildLessonFeedback(data, NOW)
  const shape = v.areas.map((a) => [a.number, a.id, a.lessons.map((l) => l.id)])
  ok(show(shape) === show([[1, 'a1', ['a1l01', 'a1l02']], [2, 'a2', ['a2l01', 'a2l03']], [3, 'a3', ['a3l01']], [null, 'a9', ['a9l01']]]),
     'areas in route order (order_num, not the order read), lessons in course order; the setup step and the Ad Bounty lesson only when rated; an unknown area last, by its id',
     show(shape))
  ok(v.areas.at(-1).name === 'a9', 'the unknown area is named by its id, so its lesson still shows')
  const a1l01 = v.areas[0].lessons[0]
  ok(a1l01.ratings === 4 && a1l01.average === (5 + 2 + 4 + 3) / 4, 'a lesson: its count and its average, unrounded', `${a1l01.ratings}, ${a1l01.average}`)
  ok(show(a1l01.comments.map((c) => c.comment)) === show(['Edited later.', 'From a student the read did not return.', 'Great.']),
     'its comments newest first by when they were last saved (an edit moves one up), trimmed, a blank one left out', show(a1l01.comments.map((c) => c.comment)))
  ok(a1l01.comments[0].at === h(30) && a1l01.comments[1].student === null && a1l01.comments[2].student?.name === 'Ana Example',
     "each comment carries when it was saved and who wrote it, or null when the students read had no such row")
  const second = v.areas[0].lessons[1]
  ok(second.ratings === 0 && second.average === null && second.comments.length === 0 && second.rateable === true,
     'a video lesson with no rating is listed, with no average and no comments')
  const stray = v.areas[1].lessons[1]
  ok(stray.id === 'a2l03' && stray.rateable === false && stray.ratings === 1, 'the rated setup step says it is not one students can rate now', show(stray))
  ok(!v.areas.flatMap((a) => a.lessons).some((l) => l.id === 'a1l03' || l.id === 'a2l02'), 'an unrated setup step and the unrated Ad Bounty lesson are not listed')
  ok(v.areas[0].ratings === 4 && v.areas[0].average === 3.5 && v.areas[0].lessonsRated === 1 &&
     v.areas[1].ratings === 2 && v.areas[1].average === 3 && v.areas[2].ratings === 0 && v.areas[2].average === null,
     "each area: its ratings, their average and how many of its lessons are rated", show(v.areas.map((a) => [a.ratings, a.average, a.lessonsRated])))
  ok(v.unplaced === 1 && v.totals.ratings === 6 && v.totals.comments === 4 && v.totals.lessons === 6 && v.totals.lessonsRated === 3 &&
     v.totals.average === (5 + 2 + 4 + 3 + 1 + 5) / 6,
     'the totals count every rating shown, and the one for a lesson the catalog lacks is counted apart (unplaced), never dropped',
     show({ ...v.totals, unplaced: v.unplaced }))
  ok(v.since === SWITCH && v.generatedAt === NOW.toISOString(), 'the answer says since when and when it was made')
  const empty = buildLessonFeedback({ ...data, ratings: [], students: [] }, NOW)
  ok(empty.totals.ratings === 0 && empty.totals.average === null && empty.totals.lessons === 5 && empty.unplaced === 0 &&
     empty.areas.every((a) => a.ratings === 0 && a.lessons.every((l) => l.rateable)),
     'no rating at all: every video lesson listed with none, the average null, nothing invented', show(empty.totals))
}

// ════════════════════════════════════════════════════════════════════════════
const TEAM = [
  { id: 'tm-founder', email: 'founder@example.com', full_name: 'Jamie Rowe', role: 'founder' },
  { id: 'tm-admin', email: 'admin@example.com', full_name: 'Sam Rivers', role: 'admin' },
  { id: 'tm-csm', email: 'csm@example.com', full_name: 'Robin Hale', role: 'csm' },
]
const TOKENS = { 'tok-founder': 'tm-founder', 'tok-admin': 'tm-admin', 'tok-csm': 'tm-csm', 'tok-student': 'auth-student' }
function freshDb({ ratings = RATINGS, students = STUDENTS, reset = SWITCH } = {}) {
  const db = new FakeDb({
    team_members: TEAM,
    admin_config: reset === null ? [] : [{ key: 'curriculum_reset_at', value: reset }],
    regions: AREAS,
    lessons: LESSONS,
    student_lesson_ratings: ratings,
    students: students.map((s) => ({ ...s })),
  }, TOKENS)
  installDb(db)
  return db
}

console.log('\n=== loadLessonFeedback: what it reads ===')
{
  // One rating from before the switch, which v104 archived: never read again.
  const before = rating('a1l02', 's-1', 1, 'From the old course.', -30)
  const db = freshDb({ ratings: [...RATINGS, before] })
  const load = await loadLessonFeedback(fakeClient(db))
  ok(load.ok && load.data.since === SWITCH && !load.data.ratings.some((r) => r.id === before.id) && load.data.ratings.length === RATINGS.length,
     'the ratings since the switch (created_at on or after curriculum_reset_at), and none from before it', load.ok ? `${load.data.ratings.length}` : show(load))
  const q = db.calls('student_lesson_ratings', 'select')[0]
  ok(q.filters.includes(`created_at>=${SWITCH}`) && q.columns === 'id, student_id, lesson_id, stars, comment, created_at, updated_at',
     'the floor is in the query, and it names its columns', show(q))
  ok(db.calls('lessons', 'select').length === 1 && db.calls('regions', 'select').length === 1 && db.calls('lessons_next').length === 0,
     'the live catalog: lessons and regions, never the staging tables')
  const none = freshDb({ reset: null })
  const all = await loadLessonFeedback(fakeClient(none))
  ok(all.ok && all.data.since === null && !none.calls('student_lesson_ratings', 'select')[0].filters.some((f) => f.startsWith('created_at')),
     'with no switch (the old course live): every rating, no floor')
}
{
  // 2,350 ratings by 250 students: past PostgREST's 1000 rows, and 3 batches of names.
  const many = []
  const people = []
  for (let i = 0; i < 250; i++) people.push({ id: `p-${String(i).padStart(3, '0')}`, name: `Person ${i}`, email: `p${i}@example.com` })
  for (let i = 0; i < 2350; i++) {
    many.push({ id: `m-${String(i).padStart(4, '0')}`, student_id: people[i % 250].id, lesson_id: i % 2 ? 'a1l01' : 'a2l01', stars: 1 + (i % 5),
      comment: null, created_at: h(1), updated_at: h(1 + (i % 7)) })
  }
  const db = freshDb({ ratings: many, students: people })
  const load = await loadLessonFeedback(fakeClient(db))
  const pages = db.calls('student_lesson_ratings', 'select').length
  const batches = db.calls('students', 'select').map((c) => c.filters[0].split(',').length)
  ok(load.ok && load.data.ratings.length === 2350 && new Set(load.data.ratings.map((r) => r.id)).size === 2350 && pages === 3 && MAX_ROWS === 1000,
     `every rating past the ${MAX_ROWS}-row cap, in ${pages} pages, none twice`, load.ok ? `${load.data.ratings.length}` : show(load))
  ok(load.ok && load.data.students.length === 250 && show(batches) === show([100, 100, 50]), 'the students who rated, in batches of 100 ids', show(batches))
  const view = buildLessonFeedback(load.data, NOW)
  ok(view.totals.ratings === 2350 && view.areas[0].lessons[0].ratings === 1175, 'and the page counts every one of them', show(view.totals))
}
{
  const FAIL = { message: 'canceling statement due to statement timeout' }
  for (const [what, key, named] of [
    ['the ratings', 'student_lesson_ratings.select', 'student_lesson_ratings'],
    ['the lessons', 'lessons.select', 'lessons'],
    ['the areas', 'regions.select', 'regions'],
    ['the students', 'students.select', 'students'],
    ['the switch', 'admin_config.select', 'curriculum_reset_at'],
  ]) {
    const db = freshDb()
    db.fail[key] = FAIL
    const load = await loadLessonFeedback(fakeClient(db))
    ok(!load.ok && load.failed.some((f) => f.includes(named) && f.includes('statement timeout')),
       `a failed read of ${what}: the load fails and names it, never an empty page`, show(load.failed ?? load))
  }
  const broken = freshDb({ reset: 'yesterday' })
  const bad = await loadLessonFeedback(fakeClient(broken))
  ok(!bad.ok && bad.failed[0].includes('not a date'), 'a switch row that is not a date: the load fails and says so', show(bad.failed ?? bad))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== GET /api/admin/lesson-feedback: who may read it ===')
const sentences = []
async function get(token) {
  const headers = token === undefined ? {} : { authorization: `Bearer ${token}` }
  const res = await hush(() => route.GET(new NextRequest('http://localhost/api/admin/lesson-feedback', { headers })))
  const body = await res.json()
  if (res.status >= 400) sentences.push(body?.error)
  return { status: res.status, body }
}
{
  freshDb()
  const none = await get(undefined)
  ok(none.status === 401 && none.body.areas === undefined, 'no token: 401, and nothing of the page', show(none.body))
  const nobody = await get('tok-nobody')
  ok(nobody.status === 401 && nobody.body.areas === undefined, 'a token nobody holds: 401')
  const student = await get('tok-student')
  ok(student.status === 403 && student.body.areas === undefined, "a student's login: 403", show(student.body))
  const csm = await get('tok-csm')
  ok(csm.status === 403 && csm.body.areas === undefined, 'the csm role: 403, as the top bar keeps the page from it', show(csm.body))
  for (const who of ['tok-founder', 'tok-admin']) {
    const r = await get(who)
    const want = JSON.parse(JSON.stringify(buildLessonFeedback(data, new Date(r.body.generatedAt))))
    ok(r.status === 200 && show(r.body) === show(want), `${who.slice(4)}: 200, exactly what the builder makes of the database`,
       `${r.status} ${r.body.totals ? show(r.body.totals) : show(r.body)}`)
  }
  ok(route.dynamic === 'force-dynamic' && typeof route.GET === 'function' && route.POST === undefined, 'never cached, and GET only')
}
{
  const db = freshDb()
  db.fail['student_lesson_ratings.select'] = { message: 'canceling statement due to statement timeout' }
  const r = await get('tok-founder')
  ok(r.status === 500 && r.body.error === "Couldn't read the lesson ratings, so nothing is shown. Try again." && r.body.areas === undefined
     && show(r.body.failed).includes('student_lesson_ratings'),
     'a failed read: 500 in words, the failed read named, no page', show(r.body))
}
ok(sentences.length >= 5 && sentences.every(plain), `every error sentence it answered is plain (${sentences.length})`, show([...new Set(sentences)]))

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The frame ===')
{
  const layout = src('src/app/admin/(authenticated)/layout.tsx')
  const listed = layout.match(/const REBUILT_PAGES[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? ''
  ok(/\/\/ WI-7, Lesson feedback:\s*\n\s*"\/admin\/feedback\/lessons",/.test(listed), 'layout.tsx lists /admin/feedback/lessons under WI-7: it wears the dark look')
  const page = src('src/app/admin/(authenticated)/feedback/lessons/page.tsx')
  const gate = src('src/components/admin/feedback/LessonFeedbackGate.tsx')
  ok(page.includes('<LessonFeedbackGate />') && !page.includes('"use client"') && /title: "Lesson feedback · Ecom University"/.test(page),
     'the page is a server wrapper with its tab title, around the gate')
  ok(/teamMember\?\.role === "csm"/.test(gate) && gate.includes('<RestrictedPage') && gate.includes('<LessonFeedbackView />'),
     'the gate keeps the csm role out and shows everyone else the view')
  const view = src('src/components/admin/feedback/LessonFeedbackView.tsx')
  ok(!view.includes('createClient') && view.includes('transport.loadLessonFeedback()'),
     'the view reads only through its transport: no database call from the browser')
  const strings = [...view.matchAll(/"([^"\n]{3,})"|`([^`\n]{3,})`|>([^<>{}\n]{3,})</g)].map((m) => (m[1] ?? m[2] ?? m[3]).trim()).filter(Boolean)
  ok(strings.length > 20 && strings.every((s) => BANNED.every((re) => !re.test(s))), `the view's ${strings.length} strings: no em dash, no "unlock", no "EcomTalent"`)
  ok(fs.existsSync(here('../src/app/dev/admin/feedback/lessons/page.tsx')) && src('src/app/dev/admin/layout.tsx').includes('notFound()'),
     'the dev page exists, under the dev admin layout that answers 404 outside development')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
