// achievements.ts + titles.ts across the course switch: every row of the
// cutover PRD's Work Item 4 paths table.
//
// Parity: the two modules as they stood at BASE are taken from git into
// _gen/*.old.ts and run side by side with the current ones (build.mjs copies
// those) on old-course fixtures with no reset key. Both run through their real
// entry points, buildAchievementSnapshot and evaluateAchievements, against the
// same stand-in Supabase client, and must agree on every rule's verdict and on
// every row they insert. Then the new course: 8 areas, the reset key set.
//
// Since v112 (the badges for the new course) the parity holds for the rules
// v112 left as they were: it took out eight (the six old-course ones, Region
// Sweep and Two Weeks Strong) and changed Triple Threat (lessons really
// finished on one day), whose own suite is achievements-v112.test.mjs. Habit
// Builder is in the parity: with no switch it is the old rule.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// Cutover WI-1, the commit WI-4 was built on. achievements.ts, titles.ts and
// constants.ts are byte-identical there and at the commit before WI-4 lands.
const BASE = '410e011'

const repo = fileURLToPath(new URL('..', import.meta.url))
const gen = (name) => new URL(`./_gen/${name}`, import.meta.url)
function oldCopy(path, out, rewrites = []) {
  let s = execFileSync('git', ['show', `${BASE}:${path}`], { cwd: repo, encoding: 'utf8' })
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${path} at ${BASE} no longer holds ${JSON.stringify(from)}`)
    s = s.split(from).join(to)
  }
  if (s.includes('@/')) throw new Error(`an unrewritten @/ import remains in ${path} at ${BASE}`)
  fs.writeFileSync(gen(out), s)
}
// The same rewrites build.mjs applies to the current copies, and nothing else.
oldCopy('src/lib/constants.ts', 'achievements-constants.old.ts')
oldCopy('src/lib/achievements.ts', 'achievements.old.ts', [
  ['from "./constants"', 'from "./achievements-constants.old.ts"'],
])
oldCopy('src/lib/titles.ts', 'titles.old.ts', [
  ['import type { StudentTitle } from "@/types/database";\n', ''],
  ['StudentTitle', 'string'],
])

const OLD = await import('./_gen/achievements.old.ts')
const NEW = await import('./_gen/achievements.ts')
const OLD_T = await import('./_gen/titles.old.ts')
const NEW_T = await import('./_gen/titles.ts')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const show = (v) => JSON.stringify(v)
const DAY = 86_400_000
const iso = (ms) => new Date(ms).toISOString()
const realNow = Date.now

// ── A stand-in Supabase client ───────────────────────────────────────────────
// Serves rows from plain arrays through the query calls achievements.ts makes.
// It hands back ONLY the columns a select names and refuses one a row does not
// have, as PostgREST does, so a column the code forgot to select reads as
// missing here too. `errors[table]` makes every read of that table fail.
function db(tables, errors = {}) {
  const inserted = []
  const reads = []
  return {
    inserted, reads,
    from(table) {
      const q = { table, cols: '*', filters: [], orderBy: null, lim: null }
      reads.push(q)
      const run = () => {
        if (errors[table]) return { data: null, error: errors[table] }
        let rows = (tables[table] ?? []).filter((r) => q.filters.every((f) => f(r)))
        if (q.orderBy) {
          const [c, asc] = q.orderBy
          rows = [...rows].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1))
        }
        if (q.lim != null) rows = rows.slice(0, q.lim)
        if (q.cols === '*') return { data: rows.map((r) => ({ ...r })), error: null }
        const cols = q.cols.split(',').map((c) => c.trim())
        for (const r of rows) {
          const missing = cols.find((c) => !(c in r))
          if (missing) return { data: null, error: { message: `column ${table}.${missing} does not exist` } }
        }
        return { data: rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), error: null }
      }
      const b = {
        select(cols = '*') { q.cols = cols; return b },
        eq(c, v) { q.filters.push((r) => r[c] === v); return b },
        in(c, vs) { q.filters.push((r) => vs.includes(r[c])); return b },
        order(c, o = {}) { q.orderBy = [c, o.ascending !== false]; return b },
        limit(n) { q.lim = n; return b },
        maybeSingle() {
          const r = run()
          if (r.error) return Promise.resolve(r)
          if (r.data.length > 1) return Promise.resolve({ data: null, error: { message: 'more than one row' } })
          return Promise.resolve({ data: r.data[0] ?? null, error: null })
        },
        then(res, rej) { return Promise.resolve(run()).then(res, rej) },
        insert(rows) {
          inserted.push(...rows.map((r) => ({ table, ...r })))
          ;(tables[table] ??= []).push(...rows)
          return Promise.resolve({ error: null })
        },
      }
      return b
    },
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(3, '0')

// The old course's shape: 4 regions, l057 (bounty onboarding, in r4) the one
// lesson that does not count (v92), every 4th lesson an action item.
const OLD_LESSONS = []
for (let n = 1; n <= 65; n++) {
  OLD_LESSONS.push({
    id: `l${pad(n)}`,
    region_id: n <= 16 ? 'r1' : n <= 32 ? 'r2' : n <= 48 ? 'r3' : 'r4',
    day: Math.ceil((n * 30) / 65),
    sort_order: n,
    requires_action: n % 4 === 0,
    counts_toward_progress: n !== 57,
  })
}

// The new course's shape: 8 areas of 5 lessons, the third of each an action
// item, plus the pond row a7l19 (bounty access), which does not count. After
// the switch `day` is null on every row.
const NEW_LESSONS = []
for (let a = 1; a <= 8; a++) {
  for (let k = 1; k <= 5; k++) {
    NEW_LESSONS.push({
      id: `a${a}l0${k}`, region_id: `a${a}`, day: null, sort_order: k,
      requires_action: k === 3, counts_toward_progress: true,
    })
  }
}
NEW_LESSONS.push({ id: 'a7l19', region_id: 'a7', day: null, sort_order: 19, requires_action: false, counts_toward_progress: false })

const ids = (lessons, pred = () => true) => lessons.filter(pred).map((l) => l.id)
const countingIds = (lessons) => ids(lessons, (l) => l.counts_toward_progress)
const inRegion = (lessons, r) => ids(lessons, (l) => l.region_id === r)

/** `list` spread over `days` days ending at `endMs`, one entry per lesson. */
const spread = (list, endMs, days, kind = 'done') =>
  list.map((id, i) => [id, iso(endMs - (days - 1 - Math.floor((i * days) / list.length)) * DAY), kind])

function tablesFor(lessons, students, resetAt = null) {
  const needsAction = new Map(lessons.map((l) => [l.id, l.requires_action]))
  return {
    students: students.filter((s) => !s.noRow).map((s) => ({ id: s.id, joined_at: s.joined_at, first_paid_at: s.first_paid_at })),
    // streak: [current, longest, last counted day]; the day is null unless a fixture names it.
    student_lesson_completions: students.flatMap((s) => (s.done ?? []).map(([lessonId, at, kind = 'done']) => ({
      student_id: s.id, lesson_id: lessonId,
      // 'done': watched, and shipped when the lesson has an action item;
      // 'watched': watched only (an action lesson stays half done); 'skip'.
      completed_at: kind === 'skip' ? null : at,
      action_completed_at: kind === 'done' && needsAction.get(lessonId) ? at : null,
      skipped_at: kind === 'skip' ? at : null,
    }))),
    lessons: lessons.map((l) => ({ ...l })),
    student_streaks: students.filter((s) => s.streak).map((s) => ({ student_id: s.id, current_streak: s.streak[0], longest_streak: s.streak[1], last_streak_date: s.streak[2] ?? null })),
    student_milestones: students.filter((s) => s.bounty).map((s) => ({ student_id: s.id, bounty_access_claimed_at: s.bounty })),
    discount_requests: students.flatMap((s) => (s.discounts ?? []).map(([status, at], i) => ({ id: `${s.id}-d${i}`, student_id: s.id, status, created_at: at }))),
    admin_config: resetAt ? [{ key: 'curriculum_reset_at', value: resetAt }] : [],
    student_achievements: students.flatMap((s) => (s.has ?? []).map((achievement_id) => ({ student_id: s.id, achievement_id, unlocked_at: '2026-09-01T00:00:00.000Z' }))),
  }
}

// v112: the rules taken out, and the ones the parity holds for (every
// current rule but Triple Threat, whose rule v112 changed).
const REMOVED = ['r1_clear', 'r2_clear', 'r3_clear', 'r4_clear', 'region_sweep', 'early_finisher', 'speedrun', 'streak_14']
const SAME = NEW.ACHIEVEMENT_RULES.map((r) => r.id).filter((id) => id !== 'triple_play')
// The snapshot's fields the SAME rules read, which both builders make.
const SHARED = ['completedLessonIds', 'shippedActionLessonIds', 'skippedLessonIds', 'lessonsByRegion', 'currentStreak',
  'longestStreak', 'bountyAccessClaimedAt', 'discountEarnedAt', 'dayNumber']

/** A snapshot's shared fields, with its Sets as sorted arrays and its empty regions dropped. */
const norm = (snap) => snap && {
  ...Object.fromEntries(SHARED.map((k) => [k, snap[k]])),
  completedLessonIds: [...snap.completedLessonIds].sort(),
  shippedActionLessonIds: [...snap.shippedActionLessonIds].sort(),
  skippedLessonIds: [...snap.skippedLessonIds].sort(),
  lessonsByRegion: Object.fromEntries(Object.entries(snap.lessonsByRegion).filter(([, v]) => v.length).sort(([a], [b]) => (a < b ? -1 : 1))),
}
/** The SAME rules' verdicts. An old builder's snapshot has no streakDaysSinceSwitch: on the old course it is null. */
const verdicts = (rules, snap) => {
  const s = snap && 'streakDaysSinceSwitch' in snap ? snap : { ...snap, streakDaysSinceSwitch: null }
  return SAME.map((id) => [id, rules.find((r) => r.id === id).evaluate(s)])
}
const earned = (rules, snap) => rules.filter((r) => r.evaluate(snap)).map((r) => r.id)

/** Runs `fn` with console.error captured; returns [result, lines]. */
async function quietly(fn) {
  const real = console.error
  const lines = []
  console.error = (...a) => { lines.push(a.join(' ')) }
  try { return [await fn(), lines] } finally { console.error = real }
}

console.log('\n=== The copies under test ===')
{
  const oldSrc = fs.readFileSync(gen('achievements.old.ts'), 'utf8')
  const newSrc = fs.readFileSync(gen('achievements.ts'), 'utf8')
  ok(oldSrc.includes('SPRINT_EXCLUDED_LESSON_IDS') && oldSrc.includes('const REGION_IDS'), `achievements.old.ts is the module at ${BASE} (fixed r1..r4, the l057 list)`)
  ok(newSrc.includes('getCurriculumResetAt') && !newSrc.includes('REGION_IDS'), 'achievements.ts is the current module (reads the switch, no fixed region list)')
  ok(fs.readFileSync(gen('titles.old.ts'), 'utf8') !== fs.readFileSync(gen('titles.ts'), 'utf8'), `titles.old.ts (${BASE}) and titles.ts differ, so the parity below compares two modules`)
  ok(same(OLD.ACHIEVEMENT_RULES.map((r) => r.id).filter((id) => !REMOVED.includes(id)), NEW.ACHIEVEMENT_RULES.map((r) => r.id)) &&
     REMOVED.every((id) => OLD.ACHIEVEMENT_RULES.some((r) => r.id === id)),
     `the rules at ${BASE} less the eight v112 took out, in the same order: ${NEW.ACHIEVEMENT_RULES.length}`, NEW.ACHIEVEMENT_RULES.map((r) => r.id).join(' '))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== Old course, no reset key: old vs new, through the real entry points ===')
const NOW_OLD = Date.parse('2026-10-10T12:00:00.000Z')
Date.now = () => NOW_OLD
{
  const paid = (days) => iso(NOW_OLD - days * DAY)
  const ALL = countingIds(OLD_LESSONS)
  const r1 = inRegion(OLD_LESSONS, 'r1'), r2 = inRegion(OLD_LESSONS, 'r2')
  const r3 = inRegion(OLD_LESSONS, 'r3'), r4 = inRegion(OLD_LESSONS, 'r4')
  const at = (daysAgo) => iso(NOW_OLD - daysAgo * DAY)
  const STUDENTS = [
    { id: 'nothing', joined_at: paid(5), first_paid_at: paid(5) },
    { id: 'first-lesson', joined_at: paid(2), first_paid_at: paid(2), streak: [1, 1], done: [['l001', at(0)]] },
    { id: 'r1-clear', joined_at: paid(7), first_paid_at: paid(7), streak: [4, 4], done: spread(r1, NOW_OLD - 3 * DAY, 4) },
    { id: 'r1-action-half-done', joined_at: paid(7), first_paid_at: paid(7), streak: [4, 4],
      done: spread(r1, NOW_OLD - 3 * DAY, 4).map((c) => (c[0] === 'l004' ? [c[0], c[1], 'watched'] : c)) },
    // Everything counting in 10 days, l057 never done, no skips, streak 10 = Day 10.
    { id: 'speedrun-day-10', joined_at: paid(9.5), first_paid_at: paid(9.5), streak: [10, 10], done: spread(ALL, NOW_OLD, 10) },
    // Everything, one lesson skipped, Day 18, streak 5.
    { id: 'one-skip-day-18', joined_at: paid(17.5), first_paid_at: paid(17.5), streak: [5, 9],
      done: [...spread(ALL.filter((id) => id !== 'l010'), NOW_OLD, 15), ['l010', at(3), 'skip']] },
    // Everything including l057, Day 25, a 30-day streak, two badges already held.
    { id: 'late-finisher-day-25', joined_at: paid(24.5), first_paid_at: paid(24.5), streak: [30, 30], has: ['first_lesson', 'r1_clear'],
      done: spread([...ALL, 'l057'], NOW_OLD, 24) },
    { id: 'six-of-r2-in-a-day', joined_at: paid(12), first_paid_at: paid(12), streak: [2, 6], done: r2.slice(0, 6).map((id) => [id, at(1)]) },
    // l057 (not counting) plus 4 r4 lessons on one day: 5 in r4 that day.
    { id: 'l057-and-four-r4-in-a-day', joined_at: paid(20), first_paid_at: paid(20), streak: [1, 3],
      done: ['l057', ...r4.filter((id) => id !== 'l057').slice(0, 4)].map((id) => [id, at(2)]) },
    { id: 'three-r1-two-r2-in-a-day', joined_at: paid(9), first_paid_at: paid(9), streak: [1, 1],
      done: [...r1.slice(0, 3), ...r2.slice(0, 2)].map((id) => [id, at(0)]) },
    // No first payment: joined_at anchors. Shipped an action, discount
    // approved after a rejected one, Bounty Access claimed, a past 14-day streak.
    { id: 'joined-only-discount-bounty', joined_at: paid(40), first_paid_at: null, streak: [2, 14], bounty: at(4),
      discounts: [['rejected', at(30)], ['approved', at(20)], ['applied', at(19)]], done: [['l004', at(6)], ['l008', at(6), 'watched']] },
    { id: 'r3-and-r4-only', joined_at: paid(28), first_paid_at: paid(28), streak: [0, 2], done: spread([...r3, ...r4], NOW_OLD - DAY, 6) },
    { id: 'no-student-row', noRow: true, done: [['l001', at(0)]] },
  ]
  const T = tablesFor(OLD_LESSONS, STUDENTS)
  const truths = new Map(SAME.map((id) => [id, { yes: 0, no: 0 }]))

  for (const s of STUDENTS) {
    const dbO = db(structuredClone(T)), dbN = db(structuredClone(T))
    const snapO = await OLD.buildAchievementSnapshot(dbO, s.id)
    const snapN = await NEW.buildAchievementSnapshot(dbN, s.id)
    if (s.noRow) {
      ok(snapO === null && snapN === null, `${s.id}: both builders answer null`)
      continue
    }
    ok(same(norm(snapO), norm(snapN)) && snapN.streakDaysSinceSwitch === null, `${s.id}: snapshot identical (the fields both builders make; no switch, so no streak days since one)`,
       `day ${snapN.dayNumber}, ${snapN.completedLessonIds.size} done, regions ${Object.keys(snapN.lessonsByRegion).join('')}`)
    ok(same(Object.entries(snapO.lessonsByRegion), Object.entries(snapN.lessonsByRegion)),
       `${s.id}: region lists identical as built, key order included`)
    const vO = verdicts(OLD.ACHIEVEMENT_RULES, snapO), vN = verdicts(NEW.ACHIEVEMENT_RULES, snapN)
    ok(same(vO, vN), `${s.id}: every rule's verdict identical`, show(earned(NEW.ACHIEVEMENT_RULES, snapN)))
    ok(same(verdicts(OLD.ACHIEVEMENT_RULES, snapN), verdicts(NEW.ACHIEVEMENT_RULES, snapN)) &&
       same(verdicts(OLD.ACHIEVEMENT_RULES, snapO), verdicts(NEW.ACHIEVEMENT_RULES, snapO)),
       `${s.id}: old and new rules agree on either builder's snapshot`)
    for (const [id, v] of vN) truths.get(id)[v ? 'yes' : 'no']++
  }

  // The parity is not vacuous: every rule is earned by some fixture and
  // refused by another, so a change to any one of them would show above.
  const oneSided = [...truths].filter(([, t]) => t.yes === 0 || t.no === 0).map(([id]) => id)
  ok(oneSided.length === 0, `every one of the ${truths.size} rules is true for some fixture and false for another`,
     oneSided.length ? `one-sided: ${oneSided.join(', ')}` : `${STUDENTS.length - 1} students`)

  // The same students through evaluateAchievements: what gets inserted, of
  // the SAME rules; and never one of the eight v112 took out.
  for (const s of STUDENTS) {
    const dbO = db(structuredClone(T)), dbN = db(structuredClone(T))
    const gotO = (await OLD.evaluateAchievements(dbO, s.id)).filter((id) => SAME.includes(id))
    const gotN = await NEW.evaluateAchievements(dbN, s.id)
    const rowsO = dbO.inserted.filter((r) => SAME.includes(r.achievement_id)).map((r) => [r.table, r.student_id, r.achievement_id])
    const rowsN = dbN.inserted.filter((r) => SAME.includes(r.achievement_id)).map((r) => [r.table, r.student_id, r.achievement_id])
    ok(same(gotO, gotN.filter((id) => SAME.includes(id))) && same(rowsO, rowsN) && !gotN.some((id) => REMOVED.includes(id)),
       `${s.id}: evaluateAchievements inserts the same rows, and none v112 took out`, `${gotN.length} new`)
  }

  // The lessons in a different row order: same verdicts (no rule reads the
  // order of the regions).
  {
    const shuffled = { ...structuredClone(T), lessons: [...T.lessons].reverse() }
    let agree = true
    for (const s of STUDENTS.filter((x) => !x.noRow)) {
      const snapO = await OLD.buildAchievementSnapshot(db(structuredClone(shuffled)), s.id)
      const snapN = await NEW.buildAchievementSnapshot(db(structuredClone(shuffled)), s.id)
      agree &&= same(norm(snapO), norm(snapN)) && same(verdicts(OLD.ACHIEVEMENT_RULES, snapO), verdicts(NEW.ACHIEVEMENT_RULES, snapN))
    }
    ok(agree, 'the catalog read in reverse order: every snapshot and verdict identical')
  }

  // A failed lessons read: the old builder keeps four empty regions, the new
  // one none. Both under-award the same way, and both log it.
  {
    const s = STUDENTS.find((x) => x.id === 'late-finisher-day-25')
    const [snapO, logO] = await quietly(() => OLD.buildAchievementSnapshot(db(structuredClone(T), { lessons: { message: 'timeout' } }), s.id))
    const [snapN, logN] = await quietly(() => NEW.buildAchievementSnapshot(db(structuredClone(T), { lessons: { message: 'timeout' } }), s.id))
    ok(same(norm(snapO), norm(snapN)) && same(verdicts(OLD.ACHIEVEMENT_RULES, snapO), verdicts(NEW.ACHIEVEMENT_RULES, snapN)),
       'lessons read fails: verdicts identical (streak badges only)', show(earned(NEW.ACHIEVEMENT_RULES, snapN)))
    ok(logO.length === 1 && logN.length === 1 && logN[0].includes('lessons read failed'), 'and both log the failed read once')
  }

  // The reads the new builder makes: the flag is selected, the switch is read.
  {
    const dbN = db(structuredClone(T))
    await NEW.buildAchievementSnapshot(dbN, 'r1-clear')
    const lessonsRead = dbN.reads.find((q) => q.table === 'lessons')
    ok(lessonsRead.cols.split(',').map((c) => c.trim()).includes('counts_toward_progress'), 'the lessons read selects counts_toward_progress', lessonsRead.cols)
    ok(dbN.reads.some((q) => q.table === 'admin_config'), 'the builder reads the switch from admin_config')
    const streakRead = dbN.reads.find((q) => q.table === 'student_streaks')
    ok(streakRead.cols.split(',').map((c) => c.trim()).includes('last_streak_date'), 'v112: the streak read selects last_streak_date (Habit Builder counts from the switch)', streakRead.cols)
  }
}

console.log('\n=== Old course: the rules alone on hand-built snapshots ===')
{
  // The old course: no switch, so no streak days since one (v112's field, null).
  const base = {
    completedLessonIds: new Set(), shippedActionLessonIds: new Set(), skippedLessonIds: new Set(),
    lessonsByRegion: { r1: ['l001', 'l002'], r2: ['l017'], r3: ['l033'], r4: ['l049'] },
    currentStreak: 0, longestStreak: 0, streakDaysSinceSwitch: null, bountyAccessClaimedAt: null, discountEarnedAt: null,
    dayNumber: 1, maxLessonsInOneDay: 0,
  }
  const all = new Set(['l001', 'l002', 'l017', 'l033', 'l049'])
  const cases = [
    ['nothing', {}],
    ['an empty map (a failed read, new builder)', { lessonsByRegion: {}, completedLessonIds: all }],
    ['four empty regions (a failed read, old builder)', { lessonsByRegion: { r1: [], r2: [], r3: [], r4: [] }, completedLessonIds: all }],
    ['everything, Day 13, streak 13', { completedLessonIds: all, dayNumber: 13, currentStreak: 13 }],
    ['everything, Day 13, streak 12', { completedLessonIds: all, dayNumber: 13, currentStreak: 12 }],
    ['everything, Day 14, a skip', { completedLessonIds: all, dayNumber: 14, skippedLessonIds: new Set(['l002']) }],
    ['everything, Day 21', { completedLessonIds: all, dayNumber: 21 }],
    ['all but one of r1', { completedLessonIds: new Set(['l001', 'l017', 'l033', 'l049']), dayNumber: 3, currentStreak: 9 }],
    ['streak edges', { currentStreak: 6, longestStreak: 14 }],
    ['streak edges, best 6', { currentStreak: 6, longestStreak: 6 }],
    ['discount and bounty', { discountEarnedAt: '2026-10-01T00:00:00Z', bountyAccessClaimedAt: '2026-10-02T00:00:00Z' }],
  ]
  for (const [label, o] of cases) {
    const snap = { ...base, ...o }
    ok(same(verdicts(OLD.ACHIEVEMENT_RULES, snap), verdicts(NEW.ACHIEVEMENT_RULES, snap)), `${label}: identical`, show(earned(NEW.ACHIEVEMENT_RULES, snap)))
  }
}

console.log('\n=== Old course: titles ===')
{
  const counts = [-1, 0, 1, 2, 3, 4, 5, 2.5, 100]
  const key = (t) => t && t.key
  ok(same(counts.map((c) => key(OLD_T.getTitleForRegions(c))), counts.map((c) => key(NEW_T.getTitleForRegions(c)))) &&
     same(counts.map((c) => key(OLD_T.getTitleForRegions(c))), counts.map((c) => key(NEW_T.getTitleForRegions(c, 4)))),
     'getTitleForRegions for 0 to 4 (and -1, 5, 2.5, 100): identical, with and without the 4', show(counts.map((c) => key(NEW_T.getTitleForRegions(c)))))
  ok(same(counts.map((c) => key(OLD_T.getNextTitle(c))), counts.map((c) => key(NEW_T.getNextTitle(c)))) &&
     same(counts.map((c) => key(OLD_T.getNextTitle(c))), counts.map((c) => key(NEW_T.getNextTitle(c, 4)))),
     'getNextTitle: identical', show(counts.map((c) => key(NEW_T.getNextTitle(c)))))
  ok(same(OLD_T.TITLES, NEW_T.TITLES), 'the five titles and their labels unchanged')
  ok(NEW_T.TITLES.every((t) => OLD_T.getTitleLabel(t.key) === NEW_T.getTitleLabel(t.key)) && NEW_T.getTitleLabel('nope') === 'nope', 'getTitleLabel unchanged')
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== New course: 8 areas, the reset key set ===')
const RESET = '2026-10-20T18:30:00.000Z'
const NOW_NEW = Date.parse(RESET) + 12 * DAY
Date.now = () => NOW_NEW
{
  const JUNE = '2026-06-01T09:00:00.000Z'
  const ALL = countingIds(NEW_LESSONS)
  const after = (days) => iso(Date.parse(RESET) + days * DAY)
  const area = (n) => inRegion(NEW_LESSONS, `a${n}`).filter((id) => id !== 'a7l19')
  const STUDENTS = [
    // Paid in June, every counting lesson of all 8 areas since the switch,
    // never a7l19, no skip, a streak of 12 on Day 12 (kept from before, C2).
    { id: 'all-8-unbroken', joined_at: JUNE, first_paid_at: JUNE, streak: [12, 40], done: spread(ALL, NOW_NEW - DAY, 11) },
    { id: 'seven-of-eight', joined_at: JUNE, first_paid_at: JUNE, streak: [12, 40], done: spread(ALL.filter((id) => !id.startsWith('a8')), NOW_NEW - DAY, 11) },
    { id: 'everything-incl-pond', joined_at: JUNE, first_paid_at: JUNE, streak: [50, 50], done: spread([...ALL, 'a7l19'], NOW_NEW - DAY, 3) },
    { id: 'all-8-streak-broken', joined_at: JUNE, first_paid_at: JUNE, streak: [4, 40], done: spread(ALL, NOW_NEW - DAY, 11) },
    { id: 'all-8-one-skip', joined_at: JUNE, first_paid_at: JUNE, streak: [12, 12], done: [...spread(ALL.slice(1), NOW_NEW - DAY, 11), [ALL[0], after(1), 'skip']] },
    { id: 'five-of-a3-in-a-day', joined_at: JUNE, first_paid_at: JUNE, streak: [1, 1], done: area(3).map((id) => [id, after(4)]) },
    { id: 'four-of-a7-and-the-pond-in-a-day', joined_at: JUNE, first_paid_at: JUNE, streak: [1, 1], done: [...area(7).slice(0, 4), 'a7l19'].map((id) => [id, after(4)]) },
    { id: 'paid-after-the-switch', joined_at: after(5), first_paid_at: after(5), streak: [7, 7], done: spread(ALL, NOW_NEW - DAY, 6) },
  ]
  const T = tablesFor(NEW_LESSONS, STUDENTS, RESET)
  const snaps = {}
  for (const s of STUDENTS) snaps[s.id] = await NEW.buildAchievementSnapshot(db(structuredClone(T)), s.id)
  const has = (id, rule) => NEW.ACHIEVEMENT_RULES.find((r) => r.id === rule).evaluate(snaps[id])

  const S1 = snaps['all-8-unbroken']
  ok(same(Object.keys(S1.lessonsByRegion).sort(), ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']), 'the map has the 8 areas', Object.keys(S1.lessonsByRegion).join(','))
  ok(S1.lessonsByRegion.a7.length === 5 && !S1.lessonsByRegion.a7.includes('a7l19'), 'a7 holds its 5 counting lessons, the pond row left out by the flag')
  ok(S1.dayNumber === 12, 'a June student is on Day 12, twelve days after the switch', `day ${S1.dayNumber}`)
  ok(snaps['paid-after-the-switch'].dayNumber === 7, 'a student who paid 5 days after the switch counts from the payment: Day 7', `day ${snaps['paid-after-the-switch'].dayNumber}`)

  ok(has('all-8-unbroken', 'unbroken') && has('all-8-unbroken', 'perfect_run'),
     'finished all 8 areas, no skips, unbroken streak since the switch: unbroken and perfect_run', show(earned(NEW.ACHIEVEMENT_RULES, S1)))
  ok(!has('seven-of-eight', 'unbroken') && !has('seven-of-eight', 'perfect_run'), '7 of 8 areas: neither', show(earned(NEW.ACHIEVEMENT_RULES, snaps['seven-of-eight'])))
  ok(!has('all-8-streak-broken', 'unbroken') && has('all-8-streak-broken', 'perfect_run'), 'all 8, a streak of 4 on Day 12: perfect_run, not unbroken')
  ok(!has('all-8-one-skip', 'perfect_run') && has('all-8-one-skip', 'unbroken'), 'all 8 with one skip: unbroken, not perfect_run')
  ok(has('paid-after-the-switch', 'unbroken'), 'paid after the switch, all 8 in 7 days, streak 7 on Day 7: unbroken')
  {
    // The six were false on the new course; since v112 they, Region Sweep and
    // Two Weeks Strong are no rules at all.
    const S = snaps['everything-incl-pond']
    const left = REMOVED.filter((r) => NEW.ACHIEVEMENT_RULES.some((x) => x.id === r))
    ok(left.length === 0, 'r1_clear..r4_clear, early_finisher, speedrun, region_sweep, streak_14: none is a rule any more', show(left))
    ok(has('everything-incl-pond', 'unbroken') && has('everything-incl-pond', 'perfect_run') && S.completedLessonIds.size === 41,
       'the same student holds unbroken and perfect_run: the course can still be finished')
  }
  {
    // Region Sweep's old cases: 5 lessons of a3 on one day, 4 of a7 and the pond row. Nothing named
    // region_sweep is inserted (its catalog row is gone, and an insert of it would fail the whole insert).
    for (const id of ['five-of-a3-in-a-day', 'four-of-a7-and-the-pond-in-a-day']) {
      const d = db(structuredClone(T))
      const got = await NEW.evaluateAchievements(d, id)
      ok(!got.includes('region_sweep') && !d.inserted.some((r) => r.achievement_id === 'region_sweep'),
         `${id}: no Region Sweep inserted`, show(got))
    }
  }

  // Control: the module at BASE on the same new-course data. It knows r1..r4
  // only, so nobody could earn the two finishing badges. This is why WI-4 exists.
  {
    const snapO = await OLD.buildAchievementSnapshot(db(structuredClone(T)), 'all-8-unbroken')
    const both = ['unbroken', 'perfect_run'].map((r) => OLD.ACHIEVEMENT_RULES.find((x) => x.id === r).evaluate(snapO))
    ok(same(both, [false, false]) && snapO.dayNumber > 100,
       `control: the module at ${BASE} gives the same student neither, and counts Day ${snapO.dayNumber} from June`)
  }

  // Through evaluateAchievements: the badges are inserted.
  {
    const d = db(structuredClone(T))
    const got = await NEW.evaluateAchievements(d, 'all-8-unbroken')
    ok(got.includes('unbroken') && got.includes('perfect_run') && !got.some((r) => /^r\d_clear$|early_finisher|speedrun/.test(r)) &&
       same(d.inserted.map((r) => r.achievement_id), got),
       'evaluateAchievements inserts them, and none of the six', show(got))
  }

  // The switch cannot be read: nothing is evaluated, nothing inserted, the
  // failure is logged. Guessing "no switch" would count the days from June.
  {
    const d = db(structuredClone(T), { admin_config: { message: 'permission denied for table admin_config' } })
    const [snap, log1] = await quietly(() => NEW.buildAchievementSnapshot(d, 'all-8-unbroken'))
    ok(snap === null, 'the switch read fails: the builder answers null')
    ok(log1.length === 1 && log1[0].includes('course switch read failed') && log1[0].includes('permission denied'), 'and logs why', log1[0])
    const d2 = db(structuredClone(T), { admin_config: { message: 'timeout' } })
    const [got] = await quietly(() => NEW.evaluateAchievements(d2, 'all-8-unbroken'))
    ok(same(got, []) && d2.inserted.length === 0, 'evaluateAchievements then inserts nothing and does not throw (callers treat it as best-effort)')
  }
  {
    const bad = structuredClone(T)
    bad.admin_config = [{ key: 'curriculum_reset_at', value: 'yesterday' }]
    const [snap] = await quietly(() => NEW.buildAchievementSnapshot(db(bad), 'all-8-unbroken'))
    ok(snap === null, 'a reset row that is not a date: the same, never read as no switch')
  }
}

console.log('\n=== New course: titles of 8 ===')
{
  const counts = [0, 1, 2, 4, 6, 8]
  const got = counts.map((c) => NEW_T.getTitleForRegions(c, 8).label)
  ok(same(got, ['Recruit', 'Recruit', 'Explorer', 'Ad Creator', 'Strategist', 'EcomTalent Pro']),
     'counts 0, 1, 2, 4, 6, 8 of 8', show(got))
  const odd = [3, 5, 7].map((c) => NEW_T.getTitleForRegions(c, 8).key)
  ok(same(odd, ['explorer', 'ad_creator', 'strategist']), 'counts 3, 5, 7 keep the rung below', show(odd))
  const next = [0, 1, 2, 7, 8].map((c) => NEW_T.getNextTitle(c, 8)?.key ?? null)
  ok(same(next, ['explorer', 'explorer', 'ad_creator', 'et_pro', null]), 'getNextTitle of 8: 0, 1, 2, 7, 8', show(next))
  for (const total of [0, -1, NaN, Infinity]) {
    ok(NEW_T.getTitleForRegions(0, total).key === 'recruit' && NEW_T.getTitleForRegions(8, total).key === 'recruit' &&
       NEW_T.getNextTitle(0, total)?.key === 'explorer',
       `areas not loaded (total ${total}): Recruit, never EcomTalent Pro for nothing; next is Explorer`)
  }
}

Date.now = realNow

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
