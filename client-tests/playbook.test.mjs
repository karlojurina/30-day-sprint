// The Playbook gate across the course switch: every row of the cutover PRD's
// Work Item 8 paths table that a function can answer.
//
// Parity: progress.ts as it stood at BASE is taken from git into
// _gen/progress.old.ts and its isPlaybookUnlocked is run beside the current
// one (build.mjs copies it) on old-course fixtures, each called the way its
// callers called it: the old with l078 and TOTAL_LESSONS (64) and the first
// payment standing in for joined_at, the new with the lessons and the stamp.
// They must give the same verdict on every fixture. Then the new course: the
// real 141 lessons of supabase/catalog/course_catalog.json.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// The commit WI-8 was built on: progress.ts there is the old gate.
const BASE = '3678190'

const repo = fileURLToPath(new URL('..', import.meta.url))
const old = execFileSync('git', ['show', `${BASE}:src/lib/progress.ts`], { cwd: repo, encoding: 'utf8' })
if (!old.includes('playbookUnlockLessonId: string;')) throw new Error(`progress.ts at ${BASE} is not the old gate`)
fs.writeFileSync(new URL('./_gen/progress.old.ts', import.meta.url), old)

const OLD = await import('./_gen/progress.old.ts')
const NEW = await import('./_gen/progress.ts')
const catalog = JSON.parse(fs.readFileSync(new URL('../supabase/catalog/course_catalog.json', import.meta.url), 'utf8'))

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const DAY = 86_400_000
const NOW = Date.parse('2026-10-20T12:00:00.000Z')
const ago = (days) => new Date(NOW - days * DAY).toISOString()
const realNow = Date.now

// ── The old course ───────────────────────────────────────────────────────────
// In the live table's shape after v92: 65 lessons, 64 counting (l057, the
// bounty onboarding, is not), l057 holding bounty_access and l078 holding
// playbook_unlock. l078 is not the last lesson by order (post-Playbook lessons
// follow it), so only its key can find it.
const OLD_IDS = [
  ...Array.from({ length: 56 }, (_, i) => `l${String(i + 1).padStart(3, '0')}`),
  'l057', 'l078',
  ...Array.from({ length: 7 }, (_, i) => `l${String(58 + i).padStart(3, '0')}`),
]
const OLD_COURSE = OLD_IDS.map((id, i) => ({
  id,
  sort_order: i + 1,
  counts_toward_progress: id !== 'l057',
  feature_key: id === 'l057' ? 'bounty_access' : id === 'l078' ? 'playbook_unlock' : null,
}))
const OLD_COUNTING = OLD_COURSE.filter((l) => l.counts_toward_progress).map((l) => l.id)
ok(OLD_COURSE.length === 65 && OLD_COUNTING.length === 64, 'the old course fixture: 65 lessons, 64 counting (TOTAL_LESSONS)', `${OLD_COURSE.length}, ${OLD_COUNTING.length}`)

/** n counting lessons done, never l078 (unless asked), plus any extras. */
const doneOld = (n, extra = []) => new Set([...OLD_COUNTING.filter((id) => id !== 'l078').slice(0, n), ...extra])

const oldFixtures = [
  { name: 'l078 done, day 1', done: new Set(['l078']), joined: ago(1), paid: ago(1), want: true },
  { name: '52 of 64 at day 31', done: doneOld(52), joined: ago(31), paid: ago(31), want: true },
  { name: '52 at day 20', done: doneOld(52), joined: ago(20), paid: ago(20), want: false },
  { name: '40 at day 40', done: doneOld(40), joined: ago(40), paid: ago(40), want: false },
  { name: '51 at day 31 (79.7%)', done: doneOld(51), joined: ago(31), paid: ago(31), want: false },
  { name: '51 counting + l057 at day 31 (every done lesson counts, as the page did)', done: doneOld(51, ['l057']), joined: ago(31), paid: ago(31), want: true },
  { name: '52, first payment 31 days ago, renewed 2 days ago', done: doneOld(52), joined: ago(2), paid: ago(31), want: true },
  { name: '52, no first payment on record, joined 31 days ago', done: doneOld(52), joined: ago(31), paid: null, want: true },
  { name: 'nothing done, day 100', done: new Set(), joined: ago(100), paid: ago(100), want: false },
]

console.log('\nThe old course: the old gate and the new give the same verdict')
for (const f of oldFixtures) {
  // The old gate reads the clock itself.
  Date.now = () => NOW
  const was = OLD.isPlaybookUnlocked({
    student: { joined_at: f.paid ?? f.joined },
    completedLessonIds: f.done,
    playbookUnlockLessonId: 'l078',
    totalLessons: 64,
  })
  const now = NEW.isPlaybookUnlocked({
    student: { joined_at: f.joined, first_paid_at: f.paid },
    completedLessonIds: f.done,
    lessons: OLD_COURSE,
    unlockedAt: null,
    now: NOW,
  })
  // And with no clock handed in, the new one reads it the same way.
  const nowClock = NEW.isPlaybookUnlocked({
    student: { joined_at: f.joined, first_paid_at: f.paid },
    completedLessonIds: f.done,
    lessons: OLD_COURSE,
    unlockedAt: null,
  })
  Date.now = realNow
  ok(was === now && now === nowClock && now === f.want, `${f.name}: ${f.want ? 'open' : 'closed'}`, `old ${was}, new ${now}`)
}

// ── The new course ───────────────────────────────────────────────────────────
// The real course as /api/student/data hands it over after v101: sort_order is
// the position in the file, `counts: false` is counts_toward_progress false.
const COURSE = catalog.lessons.map((l, i) => ({
  id: l.id,
  sort_order: i + 1,
  counts_toward_progress: l.counts !== false,
  feature_key: l.feature_key ?? null,
}))
const COUNTING = COURSE.filter((l) => l.counts_toward_progress)
const LAST = COUNTING[COUNTING.length - 1].id
const gate = (o) => NEW.isPlaybookUnlocked({ lessons: COURSE, unlockedAt: null, now: NOW, ...o })
const student = (joinedDays, paidDays = joinedDays) => ({ joined_at: ago(joinedDays), first_paid_at: paidDays === null ? null : ago(paidDays) })
const firstN = (n) => new Set(COUNTING.filter((l) => l.id !== LAST).slice(0, n).map((l) => l.id))

console.log('\nThe new course (the real 141 lessons)')
ok(COURSE.length === 141 && COUNTING.length === 140, 'the course: 141 lessons, 140 counting', `${COURSE.length}, ${COUNTING.length}`)
ok(!COURSE.some((l) => l.feature_key === 'playbook_unlock'), 'no lesson holds playbook_unlock today, so the last counting lesson stands in', LAST)
ok(LAST === 'a8l13', 'the last counting lesson by order is a8l13', LAST)

ok(gate({ student: student(1), completedLessonIds: new Set(), unlockedAt: ago(0) }) === true, 'stamped, nothing done: open')
ok(gate({ student: student(100), completedLessonIds: new Set() }) === false, 'not stamped, nothing done, day 100: closed')
ok(gate({ student: student(2), completedLessonIds: new Set([LAST]) }) === true, 'the last counting lesson done (day 2): open')
ok(gate({ student: student(2), completedLessonIds: new Set(['a8l12']) }) === false, 'the one before it done: closed')
const eighty = Math.ceil(0.8 * COUNTING.length)
ok(gate({ student: student(31), completedLessonIds: firstN(eighty) }) === true, `80% at day 31 (${eighty} of ${COUNTING.length}): open`)
ok(gate({ student: student(10), completedLessonIds: firstN(eighty) }) === false, `80% at day 10: closed`)
ok(gate({ student: student(31), completedLessonIds: firstN(eighty - 1) }) === false, `${eighty - 1} at day 31 (under 80%): closed`)
ok(gate({ student: student(2, 31), completedLessonIds: firstN(eighty) }) === true, '80%, first payment 31 days ago, renewed 2 days ago: open')
ok(gate({ student: student(31, null), completedLessonIds: firstN(eighty) }) === true, '80%, no first payment on record, joined 31 days ago: open')
ok(gate({ student: student(31), completedLessonIds: new Set([...firstN(eighty - 1), 'a7l19']) }) === true,
   'a7l19 (not counting) done counts in the share, outside the denominator, as on the old course')

// A lesson that holds playbook_unlock decides, wherever it is.
const KEYED = COURSE.map((l) => (l.id === 'a5l01' ? { ...l, feature_key: 'playbook_unlock' } : l))
ok(NEW.isPlaybookUnlocked({ student: student(2), completedLessonIds: new Set(['a5l01']), lessons: KEYED, unlockedAt: null, now: NOW }) === true,
   'a lesson given playbook_unlock (a5l01) done: open')
ok(NEW.isPlaybookUnlocked({ student: student(2), completedLessonIds: new Set([LAST]), lessons: KEYED, unlockedAt: null, now: NOW }) === false,
   'with it given, the last lesson alone no longer opens it')

// The last lesson by order not counting: the last counting one stands in.
const TAILED = [...COURSE, { id: 'zz-setup', sort_order: 999, counts_toward_progress: false, feature_key: null }]
ok(NEW.isPlaybookUnlocked({ student: student(2), completedLessonIds: new Set([LAST]), lessons: TAILED, unlockedAt: null, now: NOW }) === true &&
   NEW.isPlaybookUnlocked({ student: student(2), completedLessonIds: new Set(['zz-setup']), lessons: TAILED, unlockedAt: null, now: NOW }) === false,
   'a setup step after the last lesson: the last COUNTING lesson still decides')

// Loading: no lessons yet. Nothing opens it but the stamp.
ok(NEW.isPlaybookUnlocked({ student: student(100), completedLessonIds: new Set(COUNTING.map((l) => l.id)), lessons: [], unlockedAt: null, now: NOW }) === false,
   'no lessons loaded yet: closed, whatever is done')
ok(NEW.isPlaybookUnlocked({ student: student(100), completedLessonIds: new Set(), lessons: [], unlockedAt: ago(0), now: NOW }) === true,
   'no lessons loaded yet but stamped: open')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
