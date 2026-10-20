// lesson-rating.test.mjs: who can rate which lesson, and what a rating may
// hold (admin rebuild 2, D10, lane WI-7).
//
// The rule is src/lib/world/lesson-rating.ts, shared by the lesson page (its
// "How was this lesson?" block shows by it) and POST /api/student/rate-lesson
// (it refuses by it). This file runs:
//   1. the rule on its own, over every kind of lesson and every state of a
//      student's completion row, against the map's own count of done
//      (isLessonComplete, progress.ts) and watched (completed_at);
//   2. the route through its own handler, with the real closed doors' gate,
//      progress.ts and the rule, on stub-server.ts's database: who may rate,
//      which lessons, what is saved, and that a failed read never reads as
//      "not found" or "not finished";
//   3. the words: every sentence a student can read from either, plain.
// The rating block itself is drawn by world-tests/lesson-rating.mjs in a
// browser, on /dev/world-app.
import * as rule from './_gen/lesson-rating.ts'
import { isLessonComplete } from './_gen/progress.ts'
import { POST } from './_gen/rate-lesson-route.ts'
import { FakeDb, NextRequest, useDb as installDb } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const BANNED = [/[—–]/, /\bunlock/i, /ecomtalent/i]
const plain = (s) => typeof s === 'string' && s.trim().length > 0 && BANNED.every((re) => !re.test(s))

/** Runs `fn` with the route's log lines kept off the test's output. */
async function hush(fn) {
  const real = [console.info, console.warn, console.error]
  const said = []
  console.info = console.warn = console.error = (...a) => { said.push(a.map(String).join(' ')) }
  try { return { value: await fn(), said } } finally { [console.info, console.warn, console.error] = real }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. The rule
// ════════════════════════════════════════════════════════════════════════════
const WATCH = { id: 'a1l01', type: 'watch', requires_action: false, feature_key: null }
const ACTION_VIDEO = { id: 'a3l07', type: 'watch', requires_action: true, feature_key: null }
const SETUP = { id: 'a5l22', type: 'setup', requires_action: true, feature_key: null }
const BOUNTY = { id: 'a7l19', type: 'watch', requires_action: false, feature_key: 'bounty_access' }
const T = '2026-10-20T10:00:00.000Z'
const ROWS = {
  none: null,
  watched: { completed_at: T, action_completed_at: null, skipped_at: null },
  'hand-in only': { completed_at: null, action_completed_at: T, skipped_at: null },
  both: { completed_at: T, action_completed_at: T, skipped_at: null },
  'skipped only': { completed_at: null, action_completed_at: null, skipped_at: T },
  'watched and skipped': { completed_at: T, action_completed_at: null, skipped_at: T },
}
/** What the lesson page and the route both hand the rule: the map's watched and done for this row. */
const progressOf = (lesson, row) => ({
  watched: Boolean(row?.completed_at),
  done: row !== null && isLessonComplete({ lesson_id: lesson.id, ...row }, lesson),
})

console.log('\n=== The rule: which lessons, and when ===')
{
  const table = []
  for (const lesson of [WATCH, ACTION_VIDEO, SETUP, BOUNTY]) {
    for (const [name, row] of Object.entries(ROWS)) table.push([lesson, name, rule.ratingRefusal(lesson, progressOf(lesson, row))])
  }
  const pick = (lesson, name) => table.find(([l, n]) => l === lesson && n === name)[2]
  ok(pick(WATCH, 'watched') === null && pick(WATCH, 'watched and skipped') === null,
     'a video lesson whose video is watched (in the app or from Whop): it can be rated')
  ok(pick(WATCH, 'none') === 'not_finished' && pick(WATCH, 'hand-in only') === 'not_finished',
     'a video lesson not watched: not yet')
  ok(pick(WATCH, 'skipped only') === 'not_finished',
     'a video lesson only skipped: not yet. The map counts a skip as done, but nobody watched it',
     `isLessonComplete says ${isLessonComplete({ lesson_id: WATCH.id, ...ROWS['skipped only'] }, WATCH)}`)
  ok(pick(ACTION_VIDEO, 'both') === null && pick(ACTION_VIDEO, 'watched') === 'not_finished' && pick(ACTION_VIDEO, 'hand-in only') === 'not_finished',
     "an action item with a video: only once the video is watched and the hand-in is in, the map's \"Done.\"")
  ok(Object.keys(ROWS).every((n) => pick(SETUP, n) === 'not_video'), 'a setup step: never, whatever the student did')
  ok(Object.keys(ROWS).every((n) => pick(BOUNTY, n) === 'bounty'), 'the Ad Bounty lesson: never, whatever the student did')
  ok(rule.isRateableLesson(WATCH) && rule.isRateableLesson(ACTION_VIDEO) && !rule.isRateableLesson(SETUP) && !rule.isRateableLesson(BOUNTY),
     'isRateableLesson: the two video lessons yes, the setup step and the Ad Bounty lesson no')
  ok(rule.RATING_BOUNTY_KEY === 'bounty_access' && rule.RATING_COMMENT_MAX === 1000, 'the Ad Bounty key and the 1000 characters')
}

console.log('\n=== The body: what a rating may hold ===')
{
  const okIn = (body) => rule.checkRatingInput(body)
  const good = okIn({ lessonId: 'a1l01', stars: 4, comment: '  Good one.  ' })
  ok(good.ok && good.lessonId === 'a1l01' && good.stars === 4 && good.comment === 'Good one.', 'stars 4 and a comment: kept, the comment trimmed', show(good))
  for (const n of [1, 2, 3, 4, 5]) ok(okIn({ lessonId: 'x', stars: n }).ok, `${n} stars: allowed`)
  for (const bad of [0, 6, 4.5, -1, '4', null, undefined, Number.NaN, Infinity]) {
    const r = okIn({ lessonId: 'x', stars: bad })
    ok(!r.ok && r.error === rule.RATING_WORDS.stars, `stars ${show(bad) ?? 'missing'}: refused, nothing rounded`, show(r))
  }
  for (const [what, body] of [['no lessonId', { stars: 3 }], ['an empty lessonId', { lessonId: '  ', stars: 3 }], ['a number for lessonId', { lessonId: 7, stars: 3 }]]) {
    const r = okIn(body)
    ok(!r.ok && r.error === rule.RATING_WORDS.noLesson, `${what}: refused`, show(r))
  }
  for (const [what, body] of [['no body', null], ['a list', [1]], ['a string', 'stars=4']]) {
    const r = okIn(body)
    ok(!r.ok && r.error === rule.RATING_WORDS.unreadable, `${what}: refused as unreadable`, show(r))
  }
  const none = [okIn({ lessonId: 'x', stars: 3 }), okIn({ lessonId: 'x', stars: 3, comment: null }), okIn({ lessonId: 'x', stars: 3, comment: '   \n ' })]
  ok(none.every((r) => r.ok && r.comment === null), 'no comment, null or only spaces: saved as no comment', show(none))
  const max = okIn({ lessonId: 'x', stars: 3, comment: `  ${'a'.repeat(1000)}  ` })
  ok(max.ok && max.comment.length === 1000, '1000 characters once trimmed: allowed')
  const over = okIn({ lessonId: 'x', stars: 3, comment: 'a'.repeat(1001) })
  ok(!over.ok && over.error === rule.RATING_WORDS.commentTooLong && over.error === 'A comment can be up to 1000 characters.',
     '1001 characters: refused in words, never cut', show(over))
  const notText = okIn({ lessonId: 'x', stars: 3, comment: 42 })
  ok(!notText.ok && notText.error === rule.RATING_WORDS.commentNotText, 'a comment that is not text: refused', show(notText))
}

// ════════════════════════════════════════════════════════════════════════════
// 2. The route
// ════════════════════════════════════════════════════════════════════════════
const S1 = 's-1'
const S2 = 's-2'
const LESSONS = [
  { ...WATCH, region_id: 'a1', title: 'Welcome' },
  { id: 'a1l02', region_id: 'a1', type: 'watch', title: 'Second', requires_action: false, feature_key: null },
  { ...ACTION_VIDEO, region_id: 'a3', title: 'An action item with a video' },
  { ...SETUP, region_id: 'a5', title: 'A setup step' },
  { ...BOUNTY, region_id: 'a7', title: 'The Ad Bounty', counts_toward_progress: false },
]
function freshDb({ completions = [], ratings = [], next = [] } = {}) {
  const db = new FakeDb({
    students: [
      { id: S1, supabase_user_id: 'auth-1', name: 'Stu One' },
      { id: S2, supabase_user_id: 'auth-2', name: 'Stu Two' },
    ],
    lessons: LESSONS,
    // A lesson in the staging catalog only: not in the live one.
    lessons_next: next,
    student_lesson_completions: completions.map((c) => ({ student_id: S1, skipped_at: null, action_completed_at: null, ...c })),
    student_lesson_ratings: ratings,
  }, { 'tok-1': 'auth-1', 'tok-2': 'auth-2', 'tok-nobody': 'auth-nobody' })
  installDb(db)
  return db
}
const routeSentences = []
async function rate(body, token = 'tok-1', { raw = false } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const { value: res, said } = await hush(() =>
    POST(new NextRequest('http://localhost/api/student/rate-lesson', { method: 'POST', headers, body: raw ? body : JSON.stringify(body) })))
  const json = await res.json()
  if (res.status >= 400 && res.status !== 401) routeSentences.push(json.error)
  return { status: res.status, body: json, said }
}
const ratingsOf = (db) => db.rows('student_lesson_ratings').map((r) => ({ s: r.student_id, l: r.lesson_id, stars: r.stars, comment: r.comment }))
const watched = (lesson_id) => ({ lesson_id, completed_at: T })

console.log('\n=== The route: who may rate ===')
{
  const db = freshDb({ completions: [watched('a1l01')] })
  const none = await rate({ lessonId: 'a1l01', stars: 5 }, null)
  ok(none.status === 401 && ratingsOf(db).length === 0, 'no token: 401, nothing written', show(none.body))
  const nobody = await rate({ lessonId: 'a1l01', stars: 5 }, 'tok-garbage')
  ok(nobody.status === 401 && ratingsOf(db).length === 0, 'a token nobody holds: 401', show(nobody.body))
  const noStudent = await rate({ lessonId: 'a1l01', stars: 5 }, 'tok-nobody')
  ok(noStudent.status === 404 && noStudent.body.error === rule.RATING_WORDS.studentNotFound && ratingsOf(db).length === 0,
     'a login with no student: 404 in words', show(noStudent.body))
  process.env.STUDENT_APP_CLOSED = 'true'
  const closed = await rate({ lessonId: 'a1l01', stars: 5 })
  delete process.env.STUDENT_APP_CLOSED
  ok(closed.status === 503 && closed.body.code === 'student_app_closed' && ratingsOf(db).length === 0 && db.calls('student_lesson_ratings').length === 0,
     'the app closed to students (T-078): refused before any read of the ratings', show(closed.body))
}

console.log('\n=== The route: the rating is saved, and saved again ===')
{
  const db = freshDb({ completions: [watched('a1l01')] })
  const first = await rate({ lessonId: 'a1l01', stars: 4, comment: '  Clear and short.  ' })
  ok(first.status === 200 && first.body.rating?.stars === 4 && first.body.rating?.comment === 'Clear and short.' && first.body.rating?.lesson_id === 'a1l01',
     'a watched video lesson: 200, with the saved row (the comment trimmed)', show(first.body))
  ok(show(ratingsOf(db)) === show([{ s: S1, l: 'a1l01', stars: 4, comment: 'Clear and short.' }]), 'one row, the student from the token', show(ratingsOf(db)))
  ok(typeof first.body.rating?.created_at === 'string' && typeof first.body.rating?.updated_at === 'string' && first.body.rating.id === undefined && first.body.rating.student_id === undefined,
     'the answer holds the rating and its dates, not the row id or the student id', show(Object.keys(first.body.rating ?? {})))
  const again = await rate({ lessonId: 'a1l01', stars: 2, comment: '' })
  ok(again.status === 200 && show(ratingsOf(db)) === show([{ s: S1, l: 'a1l01', stars: 2, comment: null }]),
     'saving again changes the same row (upsert on student and lesson); an empty comment is no comment', show(ratingsOf(db)))
  const up = db.calls('student_lesson_ratings', 'upsert').at(-1)
  ok(up?.options?.onConflict === 'student_id,lesson_id' && show(Object.keys(up.values).sort()) === show(['comment', 'lesson_id', 'stars', 'student_id']),
     'the upsert names student and lesson as its key, and writes only those four columns', show(up))
  const other = await rate({ lessonId: 'a1l01', stars: 5, studentId: S2, student_id: S2 })
  ok(other.status === 200 && ratingsOf(db).every((r) => r.s === S1),
     'a student id in the body is ignored: the rating is always the token\'s student', show(ratingsOf(db)))
  const two = freshDb({ completions: [watched('a1l01')], ratings: [{ id: 'r-2', student_id: S2, lesson_id: 'a1l01', stars: 1, comment: 'theirs' }] })
  await rate({ lessonId: 'a1l01', stars: 5 })
  ok(show(ratingsOf(two).sort((a, b) => (a.s < b.s ? -1 : 1))) === show([{ s: S1, l: 'a1l01', stars: 5, comment: null }, { s: S2, l: 'a1l01', stars: 1, comment: 'theirs' }]),
     "another student's rating of the same lesson is left as it was", show(ratingsOf(two)))
}

console.log('\n=== The route: which lessons it refuses ===')
{
  const cases = [
    ['a lesson never watched', {}, 'a1l02', 403, 'not_finished'],
    ['a lesson only skipped', { completions: [{ lesson_id: 'a1l02', completed_at: null, skipped_at: T }] }, 'a1l02', 403, 'not_finished'],
    ['an action item with its video watched and no hand-in', { completions: [watched('a3l07')] }, 'a3l07', 403, 'not_finished'],
    ['an action item with its hand-in and no video', { completions: [{ lesson_id: 'a3l07', completed_at: null, action_completed_at: T }] }, 'a3l07', 403, 'not_finished'],
    ['a setup step, done', { completions: [{ lesson_id: 'a5l22', completed_at: T, action_completed_at: T }] }, 'a5l22', 400, 'not_video'],
    ['the Ad Bounty lesson, watched', { completions: [watched('a7l19')] }, 'a7l19', 400, 'bounty'],
  ]
  for (const [what, seed, lessonId, status, refusal] of cases) {
    const db = freshDb(seed)
    const r = await rate({ lessonId, stars: 5, comment: 'x' })
    ok(r.status === status && r.body.error === rule.RATING_WORDS[refusal] && r.body.code === rule.RATING_REFUSAL_CODE[refusal] && ratingsOf(db).length === 0,
       `${what}: ${status}, "${rule.RATING_WORDS[refusal]}", nothing written`, show(r.body))
  }
  const both = freshDb({ completions: [{ lesson_id: 'a3l07', completed_at: T, action_completed_at: T }] })
  const r = await rate({ lessonId: 'a3l07', stars: 3 })
  ok(r.status === 200 && ratingsOf(both).length === 1, 'an action item with both halves in: 200, saved', show(r.body))

  const live = freshDb({ next: [{ id: 'zz-staged', region_id: 'a1', type: 'watch', title: 'Staged' }], completions: [watched('zz-staged')] })
  const staged = await rate({ lessonId: 'zz-staged', stars: 5 })
  ok(staged.status === 404 && staged.body.error === rule.RATING_WORDS.lessonNotFound && ratingsOf(live).length === 0,
     'a lesson only in the staging catalog: 404 "That lesson isn\'t in the course.", the live catalog is `lessons`', show(staged.body))
  const lessonReads = live.calls('lessons', 'select').length
  ok(lessonReads === 1 && live.calls('lessons_next', 'select').length === 0, 'it reads `lessons`, never `lessons_next`', `${lessonReads}`)
  const missing = await rate({ lessonId: 'a9l99', stars: 5 })
  ok(missing.status === 404 && missing.body.error === rule.RATING_WORDS.lessonNotFound, 'a lesson id no catalog has: 404', show(missing.body))
}

console.log('\n=== The route: the body ===')
{
  const db = freshDb({ completions: [watched('a1l01')] })
  for (const [what, body, sentence] of [
    ['stars 0', { lessonId: 'a1l01', stars: 0 }, rule.RATING_WORDS.stars],
    ['stars 4.6 (never rounded to 5)', { lessonId: 'a1l01', stars: 4.6 }, rule.RATING_WORDS.stars],
    ['stars as text', { lessonId: 'a1l01', stars: '5' }, rule.RATING_WORDS.stars],
    ['no lesson', { stars: 5 }, rule.RATING_WORDS.noLesson],
    ['a comment of 1001 characters', { lessonId: 'a1l01', stars: 5, comment: 'b'.repeat(1001) }, rule.RATING_WORDS.commentTooLong],
    ['a comment that is a number', { lessonId: 'a1l01', stars: 5, comment: 5 }, rule.RATING_WORDS.commentNotText],
  ]) {
    const r = await rate(body)
    ok(r.status === 400 && r.body.error === sentence && ratingsOf(db).length === 0, `${what}: 400, nothing written`, show(r.body))
  }
  const garbled = await rate('{"lessonId": "a1l01", "stars": ', 'tok-1', { raw: true })
  ok(garbled.status === 400 && garbled.body.error === rule.RATING_WORDS.unreadable && ratingsOf(db).length === 0, 'a body that is not JSON: 400', show(garbled.body))
  const thousand = await rate({ lessonId: 'a1l01', stars: 5, comment: 'c'.repeat(1000) })
  ok(thousand.status === 200 && ratingsOf(db)[0]?.comment.length === 1000, 'a comment of exactly 1000 characters: saved whole')
  const reads = db.calls('student_lesson_ratings').length
  ok(reads === 1, 'and the refused bodies never reached the ratings table', `${reads} call(s)`)
}

console.log('\n=== The route: a read or the save that fails ===')
{
  const FAIL = { message: 'canceling statement due to statement timeout' }
  for (const [what, key, sentence] of [
    ['the student read', 'students.select', rule.RATING_WORDS.readFailed],
    ['the lesson read', 'lessons.select', rule.RATING_WORDS.readFailed],
    ['the completion read', 'student_lesson_completions.select', rule.RATING_WORDS.readFailed],
    ['the save', 'student_lesson_ratings.upsert', rule.RATING_WORDS.saveFailed],
  ]) {
    const db = freshDb({ completions: [watched('a1l01')] })
    db.fail[key] = FAIL
    const r = await rate({ lessonId: 'a1l01', stars: 5 })
    ok(r.status === 500 && r.body.error === sentence && !show(r.body).includes('statement timeout') && ratingsOf(db).length === 0,
       `${what} fails: 500 "${sentence}", the database's words kept out of the answer, nothing written`, show(r.body))
    ok(r.said.some((line) => line.includes('statement timeout')), `...and the server log has the database's words`, r.said.join(' | ').slice(0, 120))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3. The words
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The words a student can read ===')
{
  const all = Object.values(rule.RATING_WORDS)
  ok(all.every(plain), `the rule's ${all.length} sentences: no dash, no "unlock", no "EcomTalent"`, show(all.filter((s) => !plain(s))))
  ok(all.every((s) => !/\b(one|two|three|four|five|ten|hundred|thousand)\b/i.test(s)), 'numbers as digits', show(all))
  ok(routeSentences.length >= 15 && routeSentences.every(plain), `every error the route answered here (${routeSentences.length}) is plain`, show([...new Set(routeSentences)]))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
