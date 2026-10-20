// insights-page.test.mjs: the Insights page of admin rebuild 2 (WI-9),
// _admin/prds/admin-rebuild-2/ in the workspace. The task was the brand
// look; splitting the page into a view and its reads (so the view renders
// in /dev/admin/insights) moved the three reads out of the page's hooks into
// src/lib/admin/insights-data.ts (copied by build.mjs), and two things
// changed with the move, checked here on stub-server.ts's database:
//
//   - a read that fails says so: the Bounty Program card and the current
//     sprinters card read their students and their claims with no error
//     check, so a failed read showed 0;
//   - the long reads page on a unique key: the claims were paged on their
//     claim time, which two rows can share, so a page boundary could repeat
//     or skip one (shown with the rows shuffled before every order).
//
// The numbers a read that works gives are the page's own: the same
// filters, run against the old hook's arithmetic on the same rows.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BASE = 'ca9b5ef' // night/admin2 after WI-1, where this lane started

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const fromBase = (rel) => execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: here('..'), encoding: 'utf8' })

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

const INSIGHTS = await import('./_gen/insights-data.ts')
const { PAYING_WHOP_PLAN_IDS_ARRAY } = await import('./_gen/metrics-definitions.ts')
const { ADMIN_STUDENT_JOIN_CUTOFF } = await import('./_gen/constants.ts')
const { fetchAllRowsPaginated } = await import('./_gen/supabase-pagination.ts')
const { FakeDb, fakeClient } = await import('./_gen/stub-server.ts')

const PAID = PAYING_WHOP_PLAN_IDS_ARRAY[0]
const NOW = Date.parse('2026-10-20T08:30:00.000Z')
const DAY = 86_400_000
const iso = (ms) => new Date(ms).toISOString()

console.log('\n=== The snapshots ===')
{
  const rows = [
    { snapshot_date: '2026-10-17', avg_progress: '36.1', active_students: '210', total_completions: '9000', active_count: 210, joined_count: 3, churned_count: 1,
      avg_progress_cohort: '36.1', active_count_cohort: 205, joined_count_cohort: 3, churned_count_cohort: 1 },
    { snapshot_date: '2026-10-19', avg_progress: '2.66', active_students: '212', total_completions: '120', active_count: 212, joined_count: null, churned_count: null,
      avg_progress_cohort: null, active_count_cohort: null, joined_count_cohort: null, churned_count_cohort: null },
    { snapshot_date: '2026-09-01', avg_progress: '20', active_students: '150', total_completions: '4000', active_count: 150, joined_count: 1, churned_count: 0,
      avg_progress_cohort: '20', active_count_cohort: 150, joined_count_cohort: 1, churned_count_cohort: 0 },
  ]
  const db = new FakeDb({ daily_progress_snapshots: rows })
  const r = await INSIGHTS.loadSnapshots(fakeClient(db), '2026-10-06', '2026-10-20')
  ok(r.ok && show(r.data.map((x) => x.snapshot_date)) === show(['2026-10-17', '2026-10-19']), 'the rows in the range, oldest first', show(r.ok && r.data.map((x) => x.snapshot_date)))
  ok(r.ok && r.data[0].avg_progress === 36.1 && r.data[1].avg_progress === 2.66 && r.data[1].avg_progress_cohort === null && r.data[0].active_count_cohort === 205,
     'numbers as numbers, an empty cohort column as null (the view falls back to the old one)')
  db.fail['daily_progress_snapshots.select'] = { message: 'permission denied' }
  const failed = await INSIGHTS.loadSnapshots(fakeClient(db), '2026-10-06', '2026-10-20')
  ok(!failed.ok && failed.error === 'permission denied', 'a failed read says so (the page shows it with Retry)', show(failed))
}

/** The launch cohort's paying students, a few outside it, and their claims. */
function claimsDb({ claims = 1200, seed = null } = {}) {
  const students = []
  const milestones = []
  for (let i = 1; i <= claims; i++) {
    const id = `s-${String(i).padStart(5, '0')}`
    const inCohort = i % 7 !== 0
    students.push({ id, whop_plan_id: inCohort ? PAID : 'plan_free', first_paid_at: iso(Date.parse(ADMIN_STUDENT_JOIN_CUTOFF) + i * 60_000), membership_status: 'active' })
    // Many share one claim moment, as a batch from the webhook does.
    milestones.push({ student_id: id, bounty_access_claimed_at: iso(NOW - (i % 3) * DAY) })
  }
  students.push({ id: 's-early', whop_plan_id: PAID, first_paid_at: '2026-04-01T00:00:00.000Z', membership_status: 'active' })
  milestones.push({ student_id: 's-early', bounty_access_claimed_at: iso(NOW) }, { student_id: 's-none', bounty_access_claimed_at: null })
  const db = new FakeDb({ students, student_milestones: milestones })
  db.shuffle = seed
  return db
}

console.log('\n=== The Bounty Program claims ===')
{
  const want = 1200 - Math.floor(1200 / 7)
  let right = 0
  let oldWrong = 0
  for (let seed = 1; seed <= 8; seed++) {
    const db = claimsDb({ seed })
    const r = await INSIGHTS.loadBountyClaims(fakeClient(db))
    if (r.ok && r.data.length === want && r.data.every((t, i) => i === 0 || r.data[i - 1] <= t)) right++
    // The old hook's read of the claims: pages ordered on the claim time.
    const old = await fetchAllRowsPaginated(() => fakeClient(db).from('student_milestones').select('student_id, bounty_access_claimed_at')
      .not('bounty_access_claimed_at', 'is', null).order('bounty_access_claimed_at', { ascending: true }))
    if (new Set(old.data.map((m) => m.student_id)).size !== 1202 - 1) oldWrong++
  }
  ok(right === 8, `on 8 shuffles, every claim of the launch cohort's paying students is counted once (${want}), oldest first: not the free plan, not before the cutoff, not an empty claim`)
  ok(oldWrong > 0, `control: the old read (pages ordered on the claim time) repeats or skips claims on ${oldWrong} of the 8 shuffles`)
  for (const [table, word] of [['students', 'the students could not be read: timeout'], ['student_milestones', 'the Bounty Program claims could not be read: timeout']]) {
    const db = claimsDb({ claims: 20 })
    db.fail[`${table}.select`] = { message: 'timeout' }
    const r = await INSIGHTS.loadBountyClaims(fakeClient(db))
    ok(!r.ok && r.error === word, `a failed read of ${table} says so; the card showed 0`, show(r))
  }
  const old = fromBase('src/app/admin/(authenticated)/insights/progress/page.tsx')
  const hook = old.slice(old.indexOf('function useBountyInsights'), old.indexOf('/** Bucket enrollments'))
  ok(!/\.error/.test(hook) && /\.order\("bounty_access_claimed_at"/.test(hook), `control: at ${BASE} the hook checked no error and paged on the claim time`)
}

console.log('\n=== The current sprinters ===')
{
  const students = [
    { id: 'a', whop_plan_id: PAID, membership_status: 'active', first_paid_at: iso(NOW - 3 * DAY) },
    { id: 'b', whop_plan_id: PAID, membership_status: 'past_due', first_paid_at: iso(NOW - 10 * DAY) },
    { id: 'c', whop_plan_id: PAID, membership_status: 'active', first_paid_at: iso(NOW - 20 * DAY) },
    { id: 'd', whop_plan_id: PAID, membership_status: 'active', first_paid_at: iso(NOW - 40 * DAY) },
    { id: 'e', whop_plan_id: 'plan_free', membership_status: 'active', first_paid_at: iso(NOW - 2 * DAY) },
    { id: 'f', whop_plan_id: PAID, membership_status: 'canceled', first_paid_at: iso(NOW - 2 * DAY) },
  ]
  const lessons = Array.from({ length: 141 }, (_, i) => ({ id: `l${i}`, counts_toward_progress: i < 140 }))
  const counts = [{ student_id: 'a', completed_count: 14 }, { student_id: 'b', completed_count: 70 }, { student_id: 'c', completed_count: 0 }, { student_id: 'd', completed_count: 140 }]
  const db = new FakeDb({ students, lessons, student_progress_counts: counts })
  const r = await INSIGHTS.loadSprinters(fakeClient(db), NOW)
  // a 10%, b 50%, c 0%: mean 20, median 10 (d is past 30 days, e is free, f canceled).
  ok(r.ok && show(r.data) === show({ count: 3, avgProgress: 20, medianProgress: 10 }),
     'active and failed-payment paying members within 30 days of their first payment, over the 140 lessons that count', show(r))
  const noLessons = new FakeDb({ students, lessons: [], student_progress_counts: counts })
  const r2 = await INSIGHTS.loadSprinters(fakeClient(noLessons), NOW)
  ok(r2.ok && r2.data.count === 3 && r2.data.avgProgress === null && r2.data.medianProgress === null,
     'lessons that cannot be counted: no progress at all, never a progress against a made-up number', show(r2))
  for (const [table, word] of [['students', 'the students could not be read'], ['student_progress_counts', 'the lesson counts could not be read']]) {
    const bad = new FakeDb({ students, lessons, student_progress_counts: counts })
    bad.fail[`${table}.select`] = { message: 'timeout' }
    const r3 = await INSIGHTS.loadSprinters(fakeClient(bad), NOW)
    ok(!r3.ok && r3.error === `${word}: timeout`, `a failed read of ${table} says so; the card showed 0 students or 0%`, show(r3))
  }
}

console.log('\n=== The words the team reads ===')
{
  const files = ['src/components/admin/insights/InsightsView.tsx', 'src/lib/admin/insights-data.ts',
    'src/app/admin/(authenticated)/insights/progress/InsightsPage.tsx', 'src/app/dev/admin/insights-fixtures.ts']
  const bad = files.filter((f) => /—|\bunlock|ecomtalent/i.test(fromSrc(f)))
  ok(bad.length === 0, 'no em dash, "unlock" or "EcomTalent" in the Insights page\'s files', bad.join(', '))
  const old = fromBase('src/app/admin/(authenticated)/insights/progress/page.tsx')
  ok(old.includes('{loading ? "—" : value}'), `control: at ${BASE} a number still loading showed an em dash`)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
