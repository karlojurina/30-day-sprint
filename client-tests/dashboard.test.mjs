// dashboard.test.mjs: the Dashboard, /admin (admin rebuild 2, WI-2, D3).
//
// What each tile counts is src/lib/admin/dashboard-metrics.ts, run here as it
// is (build.mjs copies it with its imports pointed at the real copies of
// metrics-definitions.ts, curriculum-reset.ts, discount.ts and constants.ts,
// so run that first; `npm run test:client` does):
//   - Month 2 conversion counts only the students who first paid on or after
//     the launch, and waits (with the dates) until the first of them resolves:
//     never 0%, never the rate of the students from before the launch;
//   - Bounty, Active, Canceling and Churned keep their definitions; Churned
//     adds up exactly 14 days, and a day with no snapshot is a gap, not a 0;
//   - Avg progress is one metric: the number is the line's last point, and
//     the line starts on the switch's date;
//   - a read that failed is never a number: every tile it feeds fails, and
//     the page's list names it once;
//   - Refresh's line says which step failed inside a 200.
// The page's reads (readDashboard in src/app/admin/(authenticated)/page.tsx)
// are taken from the source with TypeScript's parser and run on a client that
// records every call and answers it: the open tasks get the tasks reset's
// floor, and a count that did not come back is a failure. The two 30% reads
// (the 30% that applies itself, T-137, R5) run on stub-server.ts's database:
// "30% needs a hand" counts exactly the requests the 30% page lists
// (readNeedsHand, the page's own reads, against loadThirtyData's list on the
// same rows at the same moment), and "30% off applied" the applied requests
// from 1 October; a failed read is a failure, never 0.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')

const M = await import('./_gen/dashboard-metrics.ts')
const { isInMonth2Cohort, PAYING_WHOP_PLAN_IDS_ARRAY } = await import('./_gen/metrics-definitions.ts')
const { DISCOUNT_ELIGIBLE_FROM, DISCOUNT_LAUNCH_DATE } = await import('./_gen/discount.ts')
const { ADMIN_STUDENT_JOIN_CUTOFF, TASKS_STUDENT_JOIN_CUTOFF } = await import('./_gen/constants.ts')
const { CURRICULUM_RESET_KEY } = await import('./_gen/curriculum-reset.ts')
const { checkTasksResetAt } = await import('./_gen/tasks-reset.ts')
const { fetchAllRowsByKey } = await import('./_gen/supabase-pagination.ts')
const { readNeedsHand, loadThirtyData } = await import('./_gen/thirty-data.ts')
const { FakeDb, fakeClient } = await import('./_gen/stub-server.ts')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const DAY = 86_400_000
const MONTHLY = PAYING_WHOP_PLAN_IDS_ARRAY[0]
const at = (iso) => Date.parse(iso)
const iso = (ms) => new Date(ms).toISOString()

/** A student as the page reads them. */
const student = (id, paid, more = {}) => ({
  id, membership_status: 'active', whop_plan_id: MONTHLY, first_paid_at: paid, canceled_at: null, cancel_scheduled_at: null, ...more,
})
const read = (data) => ({ ok: true, data })
const failed = (error) => ({ ok: false, error })
/** Every read fine and empty, the switch on 19 Oct: each test changes what it is about. */
const reads = (over = {}) => ({
  students: read([]), bounty: read([]), openTasks: read(0), tasksResetAt: read(null), needsHand: read(0), thirtyApplied: read(0),
  snapshots: read([]), canceling: read([]), resetAt: read('2026-10-19T14:33:33.972Z'), ...over,
})

const NOW_OCT = at('2026-10-20T08:30:00.000Z')
const NOW_NOV = at('2026-11-24T09:00:00.000Z')

console.log('\n=== The 14 days ===')
{
  const days = M.trendDays(NOW_OCT)
  ok(days.length === 14 && days[0] === '2026-10-07' && days[13] === '2026-10-20', 'today (UTC) and the 13 days before it, oldest first', show([days[0], days[13]]))
  ok(M.trendDays(at('2026-10-20T23:59:59.000Z'))[13] === '2026-10-20' && M.trendDays(at('2026-10-21T00:00:00.000Z'))[13] === '2026-10-21',
     'the day turns at midnight UTC, the date the snapshot tables use')
}

console.log('\n=== Month 2: only the students who paid from the launch ===')
{
  ok(M.paidSinceLaunch({ first_paid_at: '2026-10-08T22:00:00+00:00' }) && M.paidSinceLaunch({ first_paid_at: DISCOUNT_LAUNCH_DATE }),
     'a first payment at the launch second counts, written either way')
  ok(!M.paidSinceLaunch({ first_paid_at: '2026-10-08T21:59:59.999Z' }) && !M.paidSinceLaunch({ first_paid_at: null }) && !M.paidSinceLaunch({ first_paid_at: 'soon' }),
     'one a millisecond before it, none and an unreadable one do not')
  // PostgREST writes "+00:00", the constant "Z": as strings, the same second sorts apart.
  ok('2026-10-08T22:00:00+00:00' < DISCOUNT_LAUNCH_DATE, 'control: compared as strings, the launch second would sort before the launch')

  // Before the first renewals: students from before the launch who renewed, and the new ones.
  const before = [
    student('old-1', '2026-09-01T10:00:00.000Z'),
    student('old-2', '2026-08-20T10:00:00.000Z'),
    student('old-3', '2026-08-25T10:00:00.000Z', { membership_status: 'canceled', canceled_at: '2026-09-24T10:00:00.000Z' }),
  ]
  const launch = [
    student('new-1', '2026-10-09T08:00:00.000Z'),
    student('new-2', '2026-10-12T15:00:00.000Z'),
    student('new-3', '2026-10-15T09:00:00.000Z', { whop_plan_id: 'plan_yearly' }),
  ]
  const days = M.trendDays(NOW_OCT)
  const waiting = M.monthTwo([...before, ...launch], days, NOW_OCT)
  ok(waiting.kind === 'waiting', 'on 20 Oct the tile waits: nobody who paid since the launch has had a renewal', show(waiting))
  ok(before.every((s) => isInMonth2Cohort(s, NOW_OCT)), 'control: without the launch floor, the 3 students from before it would make a rate (2 of 3)')
  ok(waiting.paid === 2, 'it counts the students on the monthly plan who paid since the launch: 2 (the yearly plan has no month 2)', String(waiting.paid))
  ok(waiting.firstPaidAt === '2026-10-09T08:00:00.000Z' && waiting.firstRenewalDay === '2026-11-09',
     'the first renewals: a calendar month after the first payment, Mon 9 Nov', `${waiting.firstPaidAt} ${waiting.firstRenewalDay}`)
  ok(waiting.firstRateAt === '2026-11-15T08:00:00.000Z', 'the first rate: when that first payment has resolved, 30 days and a week of grace later', waiting.firstRateAt)
  const nobody = M.monthTwo(before, days, NOW_OCT)
  ok(nobody.kind === 'waiting' && nobody.paid === 0 && nobody.firstPaidAt === null && nobody.firstRateAt === null && nobody.firstRenewalDay === '2026-11-09',
     'with no payment since the launch: nobody waiting, no date for a rate, first renewals a month after the launch', show(nobody))
  ok(M.oneMonthLater('2026-01-31') === '2026-02-28' && M.oneMonthLater('2026-12-09') === '2027-01-09',
     'a month after 31 Jan is 28 Feb, after 9 Dec is 9 Jan')
  ok(M.croatiaDate('2026-10-08T22:00:00.000Z') === '2026-10-09', 'the launch is 9 Oct in Croatia, the evening of the 8th in UTC')
}

console.log('\n=== Month 2: the rate, once renewals resolve ===')
{
  const cycleEnd = (paid) => iso(at(paid) + 30 * DAY)
  const students = [
    student('a', '2026-10-09T08:00:00.000Z'),
    student('b', '2026-10-10T08:00:00.000Z'),
    student('c', '2026-10-11T08:00:00.000Z', { membership_status: 'past_due' }),
    // Did not renew: access ended at the end of the month paid for.
    student('d', '2026-10-12T08:00:00.000Z', { membership_status: 'canceled', canceled_at: cycleEnd('2026-10-12T08:00:00.000Z') }),
    // Booked a cancel before the renewal, still has access for a moment: not converted.
    student('e', '2026-10-13T08:00:00.000Z', { cancel_scheduled_at: '2026-11-05T08:00:00.000Z' }),
    // Renewed, then left in month 2: converted.
    student('f', '2026-10-14T08:00:00.000Z', { membership_status: 'canceled', canceled_at: '2026-11-22T08:00:00.000Z' }),
    // Paid on 20 Oct: resolves on 26 Nov, not yet.
    student('g', '2026-10-20T08:00:00.000Z'),
    // From before the launch, renewed: never in it.
    student('h', '2026-09-20T08:00:00.000Z'),
  ]
  const days = M.trendDays(NOW_NOV)
  const m = M.monthTwo(students, days, NOW_NOV)
  ok(m.kind === 'rate' && m.resolved === 6 && m.converted === 4, 'on 24 Nov: 4 of the 6 who paid 9 to 14 Oct still pay (d did not renew, e booked a cancel)', show({ r: m.resolved, c: m.converted }))
  ok(Math.abs(m.rate - 4 / 6) < 1e-12, 'the rate is 4 / 6', String(m.rate))
  ok(m.line.length === 14 && m.line[0].date === '2026-11-11' && m.line[13].date === '2026-11-24', 'the line covers the 14 days')
  const firstDay = m.line.findIndex((p) => p.value !== null)
  ok(firstDay === 4 && m.line.slice(0, 4).every((p) => p.value === null),
     'before 15 Nov nobody had resolved: those days are gaps, never 0%', show(m.line.slice(0, 5)))
  ok(m.line[13].value === m.rate * 100, 'the last point is the big number: today is judged now, as the number is', `${m.line[13].value} ${m.rate * 100}`)
  ok(m.line[4].value === 100, 'on 15 Nov only a had resolved, and still paid: 100%', String(m.line[4].value))

  // The review's fix round: Whop can end a membership as expired, and the sync keeps its canceled_at as for a
  // cancel. The page reads expired for Month 2 alone; Month 2 judges the row by its dates, as it judges d.
  const expired = student('x', '2026-10-12T08:00:00.000Z', { membership_status: 'expired', canceled_at: cycleEnd('2026-10-12T08:00:00.000Z') })
  const withExpired = M.buildDashboard(reads({ students: read([...students, expired]) }), NOW_NOV)
  ok(withExpired.monthTwo.ok && withExpired.monthTwo.value.resolved === 7 && withExpired.monthTwo.value.converted === 4,
     'an expired student who did not renew is in Month 2\'s denominator: 4 of 7, never 4 of 6', show(withExpired.monthTwo.value && { r: withExpired.monthTwo.value.resolved, c: withExpired.monthTwo.value.converted }))
  const renewedThenExpired = student('y', '2026-10-12T08:00:00.000Z', { membership_status: 'expired', canceled_at: '2026-11-23T08:00:00.000Z' })
  const both = M.buildDashboard(reads({ students: read([...students, renewedThenExpired]) }), NOW_NOV)
  ok(both.monthTwo.ok && both.monthTwo.value.resolved === 7 && both.monthTwo.value.converted === 5,
     'one whose access ended as expired after the renewal and its week is converted, as a cancel after it is', show(both.monthTwo.value && { r: both.monthTwo.value.resolved, c: both.monthTwo.value.converted }))
  ok(M.DASH_STUDENT_STATUSES.join() === 'active,past_due,canceled,expired' && show(M.sharedPopulation([...students, expired]).map((s) => s.id)) === show(students.map((s) => s.id)),
     'the read takes the 4 statuses; every tile but Month 2 gets the 3 it always had')
}

console.log('\n=== Bounty Program, unchanged ===')
{
  const students = [student('s1', '2026-06-01T00:00:00.000Z'), student('s2', '2026-07-01T00:00:00.000Z')]
  const stamps = [
    { student_id: 's1', bounty_access_claimed_at: '2026-10-20T07:00:00.000Z' },
    { student_id: 's2', bounty_access_claimed_at: '2026-10-07T00:00:00.000Z' },
    // The day before the window: all time only.
    { student_id: 's1', bounty_access_claimed_at: '2026-10-06T23:59:59.000Z' },
    // Not in the population (a free seat): never counted.
    { student_id: 'outside', bounty_access_claimed_at: '2026-10-19T09:00:00.000Z' },
    { student_id: 's2', bounty_access_claimed_at: null },
  ]
  const b = M.bounty(students, stamps, M.trendDays(NOW_OCT))
  ok(b.last14 === 2 && b.allTime === 3, 'the 14 days hold 2 stamps, all time 3; a stamp outside the population counts nowhere', show({ l: b.last14, a: b.allTime }))
  ok(b.line[0].value === 1 && b.line[13].value === 1 && b.line.every((p) => p.value !== null), 'per UTC day, every day a count', show(b.line.map((p) => p.value)))
  // The review's fix round reads expired students for Month 2; the Bounty Program keeps the population it had (D3: unchanged).
  const gone = student('s3', '2026-07-01T00:00:00.000Z', { membership_status: 'expired', canceled_at: '2026-08-01T00:00:00.000Z' })
  const dash = M.buildDashboard(reads({ students: read([...students, gone]), bounty: read([...stamps, { student_id: 's3', bounty_access_claimed_at: '2026-10-18T07:00:00.000Z' }]) }), NOW_OCT)
  ok(dash.bounty.ok && dash.bounty.value.last14 === 2 && dash.bounty.value.allTime === 3,
     'an expired student\'s stamp is in no Bounty count, as before the Month 2 read took expired', show(dash.bounty.ok && { l: dash.bounty.value.last14, a: dash.bounty.value.allTime }))
}

console.log('\n=== The reads: a failure is never a number ===')
{
  ok(show(M.countRead({ count: 3, error: null })) === show({ ok: true, data: 3 }) && M.countRead({ count: 0, error: null }).ok,
     'a count is its number, 0 included')
  const none = M.countRead({ count: null, error: null })
  ok(!none.ok && none.error === 'no count came back', 'a count that did not come back is a failure: the old tile read it as 0, "All caught up"', show(none))
  const err = M.countRead({ count: null, error: { message: 'permission denied for table tasks' } })
  ok(!err.ok && err.error === 'permission denied for table tasks', 'a failed count carries its reason')
  const paged = M.rowsRead({ data: [], error: new Error('canceling statement due to statement timeout') })
  ok(!paged.ok && paged.error === 'canceling statement due to statement timeout', "the paged reads' [] with an error is a failure, never no rows")
  ok(M.rowsRead({ data: [], error: null }).ok && !M.rowsRead({ data: null, error: null }).ok, 'no rows is fine; null with no error is not')

  ok(M.momentMs('2026-10-19T14:33:33.972Z') === at('2026-10-19T14:33:33.972Z'), 'a date as v104 writes it')
  ok(M.momentMs('2026-10-21 05:00:00.123456+00') === at('2026-10-21T05:00:00.123Z'), "Postgres's own text for a moment")
  ok(M.momentMs('2026-10-21T07:00:00+0200') === at('2026-10-21T05:00:00.000Z') && M.momentMs('2026-10-21T05:00Z') === at('2026-10-21T05:00:00.000Z'),
     'a zone with or without its colon, a time with no seconds')
  ok(M.momentMs('2026-10-21') === null && M.momentMs('2026-10-21T05:00:00') === null && M.momentMs('yesterday') === null,
     'a date alone, a time with no zone and words are not moments')

  const both = M.configReads({ data: [{ key: CURRICULUM_RESET_KEY, value: '2026-10-19T14:33:33.972Z' }, { key: M.TASKS_RESET_KEY, value: '2026-10-21T05:00:00.123Z' }], error: null })
  ok(both.resetAt.ok && both.resetAt.data === '2026-10-19T14:33:33.972Z' && both.tasksResetAt.ok && both.tasksResetAt.data === '2026-10-21T05:00:00.123Z',
     'both keys, as written (tasks_reset_at as v109 writes it)', show(both))
  // The review's fix round: tasks_reset_at is held to tasks-reset.ts's check, as the Tasks page and its insights hold it.
  const pgText = M.configReads({ data: [{ key: M.TASKS_RESET_KEY, value: '2026-10-21 05:00:00.123456+00' }], error: null })
  let tasksPage = null
  try { checkTasksResetAt('2026-10-21 05:00:00.123456+00') } catch (e) { tasksPage = e.message }
  ok(!pgText.tasksResetAt.ok && tasksPage !== null && pgText.tasksResetAt.error === tasksPage,
     "Postgres's own text for tasks_reset_at is refused with the Tasks page's own sentence, so the Dashboard and the Tasks page draw the line alike", show(pgText.tasksResetAt))
  const absent = M.configReads({ data: [], error: null })
  ok(absent.resetAt.ok && absent.resetAt.data === null && absent.tasksResetAt.ok && absent.tasksResetAt.data === null,
     'no row is no date: before the switch, before the tasks reset (v109 is another lane\'s)')
  const broken = M.configReads({ data: [{ key: M.TASKS_RESET_KEY, value: 'tomorrow' }], error: null })
  ok(!broken.tasksResetAt.ok && broken.tasksResetAt.error.includes('admin_config.tasks_reset_at') && broken.resetAt.ok,
     'a value that is no date fails its own key only: guessing "no reset" would count the archived tasks again', show(broken))
  const down = M.configReads({ data: null, error: { message: 'permission denied for table admin_config' } })
  ok(!down.resetAt.ok && !down.tasksResetAt.ok && down.tasksResetAt.error === 'admin_config: permission denied for table admin_config',
     'a failed read fails both keys, with the reason')
}

console.log('\n=== The whole page: what a failed read takes with it ===')
{
  const students = [student('s1', '2026-10-10T08:00:00.000Z')]
  const fine = M.buildDashboard(reads({ students: read(students), openTasks: read(31), needsHand: read(3), thirtyApplied: read(27), tasksResetAt: read('2026-10-21T05:00:00.000Z') }), NOW_OCT)
  ok(fine.failed.length === 0 && fine.openTasks.ok && fine.openTasks.value.count === 31 && fine.openTasks.value.since === '2026-10-21T05:00:00.000Z',
     'open tasks: the count, and the reset it counts from')
  ok(fine.needsHand.ok && fine.needsHand.value.count === 3 && fine.needsHand.value.since === DISCOUNT_ELIGIBLE_FROM,
     '30% needs a hand: the count of the 30% page\'s list, from 1 October')
  ok(fine.thirtyApplied.ok && fine.thirtyApplied.value.count === 27 && fine.thirtyApplied.value.since === DISCOUNT_ELIGIBLE_FROM,
     '30% off applied: the count, from 1 October')
  ok(!('toDecide' in fine), 'no "30% to decide" any more (T-137, R5)')
  ok(fine.active.ok && fine.active.value.count === 1 && fine.canceling.ok && fine.canceling.value.count === 0, 'Active and Canceling from the students')

  const noStudents = M.buildDashboard(reads({ students: failed('canceling statement due to statement timeout') }), NOW_OCT)
  const studentTiles = ['monthTwo', 'bounty', 'active', 'canceling'].map((k) => noStudents[k])
  ok(studentTiles.every((t) => !t.ok && t.error === 'canceling statement due to statement timeout'),
     'no students read: Month 2, Bounty, Active and Canceling all fail, with the reason; none shows a number')
  ok(noStudents.openTasks.ok && noStudents.needsHand.ok && noStudents.thirtyApplied.ok, 'the counts that do not need it stand')
  const noThirty = M.buildDashboard(reads({ needsHand: failed('discount_request_events (write_failed): JWT expired'), thirtyApplied: failed('JWT expired') }), NOW_OCT)
  ok(!noThirty.needsHand.ok && !noThirty.thirtyApplied.ok && noThirty.openTasks.ok
       && show(noThirty.failed.map((f) => f.read)) === show(['30% needs a hand', '30% off applied']),
     'a 30% read that failed: its tile fails, never 0, and the list names the read', show(noThirty.failed))

  const settingsDown = 'admin_config: permission denied for table admin_config'
  const noSettings = M.buildDashboard(reads({ tasksResetAt: failed(settingsDown), resetAt: failed(settingsDown), openTasks: failed(settingsDown) }), NOW_OCT)
  ok(!noSettings.openTasks.ok && !noSettings.avgProgress.ok, 'no settings: the open tasks (no floor) and Avg progress (no switch date) fail')
  ok(noSettings.failed.length === 1 && noSettings.failed[0].read === 'Admin config',
     'and the list names that one read once', show(noSettings.failed))

  const twoTimeouts = M.buildDashboard(reads({ students: failed('timeout'), snapshots: failed('timeout') }), NOW_OCT)
  ok(show(twoTimeouts.failed.map((f) => f.read)) === show(['Students', 'Daily snapshots']),
     'two different reads that failed alike stay two lines', show(twoTimeouts.failed))

  const reasons = M.buildDashboard(M.allFailed('Failed to fetch'), NOW_OCT)
  const tiles = ['monthTwo', 'bounty', 'openTasks', 'needsHand', 'thirtyApplied', 'active', 'canceling', 'churned', 'avgProgress']
  ok(tiles.every((k) => !reasons[k].ok), 'a loader that threw: every tile fails, none shows a number')
}

console.log('\n=== Active, Canceling, Churned: unchanged, over exactly 14 days ===')
{
  const days = M.trendDays(NOW_OCT)
  const row = (d, more = {}) => ({
    snapshot_date: d, created_at: `${d}T00:30:00.000Z`, active_count: 900, churned_count: 9, avg_progress: 30,
    active_count_cohort: 1000, churned_count_cohort: 2, avg_progress_cohort: 36.5, ...more,
  })
  const rows = [row('2026-10-06', { churned_count_cohort: 50 }), ...days.filter((d) => d !== '2026-10-12').map((d) => row(d))]
  const c = M.churned(rows, days)
  ok(c.total === 26 && c.daysRead === 13, 'Churned adds up the 14 days only (the 15th, 50, stays out), and says 13 had a snapshot', show({ t: c.total, d: c.daysRead }))
  ok(c.line[5].value === null, 'a day with no snapshot is a gap, not a 0')
  const legacy = M.churned([row('2026-10-20', { churned_count_cohort: null, churned_count: 7 })], days)
  ok(legacy.total === 7, 'a row from before the cohort columns falls back to the legacy one')

  const students = [
    student('p', '2026-06-01T00:00:00.000Z'),
    student('q', '2026-06-01T00:00:00.000Z', { membership_status: 'past_due' }),
    student('r', '2026-06-01T00:00:00.000Z', { membership_status: 'canceled', canceled_at: '2026-07-01T00:00:00.000Z' }),
    student('s', '2026-06-01T00:00:00.000Z', { cancel_scheduled_at: '2026-10-15T00:00:00.000Z' }),
  ]
  const a = M.active(students, read(rows), days)
  ok(a.count === 3 && a.line.ok && a.line.value[13].value === 1000, 'Active: active and payment failed now; the line is the snapshot\'s cohort count', show({ n: a.count }))
  const aDown = M.active(students, failed('timeout'), days)
  ok(aDown.count === 3 && !aDown.line.ok, 'the snapshots failing takes the line, not the number')
  const k = M.canceling(students, read([{ snapshot_date: '2026-10-19', canceling_count_cohort: 4 }, { snapshot_date: '2026-10-20', canceling_count_cohort: '5' }]), days)
  ok(k.count === 1 && k.line.ok && k.line.value[13].value === 5 && k.line.value[12].value === 4 && k.line.value[0].value === null,
     'Canceling: booked a cancel and still in; a day with no row is a gap (the old page drew it as 0)', show(k.line.value.slice(11)))
}

console.log('\n=== Avg progress: one metric, from the switch ===')
{
  const days = M.trendDays(NOW_OCT)
  const rows = days.map((d) => ({
    snapshot_date: d,
    created_at: `${d}T00:30:12.000Z`,
    active_count: 1000, churned_count: 1, avg_progress: 10,
    active_count_cohort: 1031, churned_count_cohort: 1,
    avg_progress_cohort: d < '2026-10-19' ? 36.47 : d === '2026-10-19' ? '2.66' : 2.71,
  }))
  const a = M.avgProgress(rows, days, '2026-10-19T14:33:33.972Z')
  const readings = a.line.filter((p) => p.value !== null)
  // The render review's fix round: the line is on the 14 days' axis, as the other lines are, with no reading
  // before the switch's date; it used to hold the 2 days alone, stretched across the whole tile.
  ok(a.kind === 'value' && show(a.line.map((p) => p.date)) === show(days) && show(readings.map((p) => p.date)) === show(['2026-10-19', '2026-10-20']),
     'the line holds the 14 days; its readings start on the switch\'s date: no old-course point, so no cliff', show(a.line))
  ok(a.line.slice(0, 12).every((p) => p.value === null) && a.from === '2026-10-19',
     'the 12 days before the switch are empty (never the old course\'s 36%), and the tile says the line is from 19 October', show({ from: a.from }))
  ok(a.value === 2.71 && a.line[a.line.length - 1].value === a.value && a.date === '2026-10-20',
     'the number is the line\'s last point: one metric', show({ v: a.value }))
  ok(a.line.find((p) => p.date === '2026-10-19').value === 2.66, 'a numeric column that arrives as a string is read')
  ok(a.builtAt === '2026-10-20T00:30:12.000Z', 'it carries when that row was written')
  const gap = M.avgProgress(rows.filter((r) => r.snapshot_date !== '2026-10-20'), days, '2026-10-19T14:33:33.972Z')
  ok(gap.kind === 'value' && gap.value === 2.66 && gap.date === '2026-10-19' && gap.line.at(-1).value === null && gap.line.length === 14,
     'with no row today, the number is the newest row there is, and today is a gap')
  const none = M.avgProgress(rows.filter((r) => r.snapshot_date < '2026-10-19'), days, '2026-10-19T14:33:33.972Z')
  ok(none.kind === 'none' && none.since === '2026-10-19', 'no row since the switch: no number, and the day it waits from', show(none))
  const noSwitch = M.avgProgress(rows, days, null)
  ok(noSwitch.kind === 'value' && noSwitch.line.length === 14 && noSwitch.line.every((p) => p.value !== null) && noSwitch.from === null,
     'before any switch, the whole 14 days, every one read, and no "from"')
  const old = M.avgProgress(rows, M.trendDays(at('2026-11-24T09:00:00.000Z')), '2026-10-19T14:33:33.972Z')
  ok(old.kind === 'none' && old.since === '2026-11-11', 'a switch before the window floors nothing (and these rows are all older)')
  const novDays = M.trendDays(at('2026-11-24T09:00:00.000Z'))
  const nov = M.avgProgress(novDays.map((d) => ({ snapshot_date: d, created_at: null, avg_progress: 9, avg_progress_cohort: 9 })), novDays, '2026-10-19T14:33:33.972Z')
  ok(nov.kind === 'value' && nov.from === null && nov.line.every((p) => p.value === 9),
     'a switch before the 14 days: every day read, and no "from" on the tile', show({ from: nov.from }))
  const legacy = M.avgProgress([{ snapshot_date: '2026-10-20', created_at: null, avg_progress: 4.2, avg_progress_cohort: null }], days, null)
  ok(legacy.kind === 'value' && legacy.value === 4.2 && legacy.builtAt === null, 'a row with no cohort column falls back to the legacy one')

  const broken = M.buildDashboard(reads({ snapshots: read(rows), resetAt: read('2026-10-19') }), NOW_OCT)
  ok(!broken.avgProgress.ok && broken.churned.ok, 'a switch date that is no moment fails Avg progress only (curriculum-reset.ts refuses it)', show(broken.avgProgress))
  const noSnaps = M.buildDashboard(reads({ snapshots: failed('timeout') }), NOW_OCT)
  ok(!noSnaps.avgProgress.ok && !noSnaps.churned.ok, 'no snapshots: Avg progress and Churned fail')
}

console.log('\n=== The change over the window ===')
{
  ok(M.deltaOf([{ date: 'a', value: null }, { date: 'b', value: 2.66 }, { date: 'c', value: null }, { date: 'd', value: 2.71 }]).change === 0.05,
     'last reading minus first, gaps skipped, rounded clean (2.71 - 2.66 is 0.05)')
  ok(M.deltaOf([{ date: 'b', value: 2.66 }]) === null && M.deltaOf([]) === null, 'one reading has no change')
  ok(M.deltaOf([{ date: 'x', value: 900 }, { date: 'y', value: 879 }]).from === 'x', 'it says which day it is counted from')
}

console.log('\n=== Sync Whop and rebuild: what each step did ===')
{
  const refused = M.refreshSummary(403, { error: 'Founder or admin role required' })
  ok(refused.tone === 'err' && refused.text === 'Sync failed: Founder or admin role required', 'a refusal, in the route\'s words', refused.text)
  ok(M.refreshSummary(0, null).text === "Sync failed: couldn't reach the server" && M.refreshSummary(500, null).text === 'Sync failed: the server answered 500',
     'no answer, and an answer with no words')
  const all = M.refreshSummary(200, { ok: true, sync: { fetched: 1031, inserted: 3, updated: 118 }, rebuild: { ok: true }, engagement: { alerts: 1 }, csm_tasks: { tasks_created: 4 }, na_tasks: { ok: true } })
  ok(all.tone === 'ok' && all.text === 'Whop synced, 3 new and 118 updated · snapshots rebuilt · 4 new tasks · 1 alert', 'every step went through', all.text)
  const sync = M.refreshSummary(200, { ok: true, sync: { error: 'HTTP 502' }, rebuild: { ok: true }, csm_tasks: { tasks_created: 0 } })
  ok(sync.tone === 'warn' && sync.text.startsWith('Whop sync failed: HTTP 502'), 'a step that failed inside a 200 says so (the old line read as a success)', sync.text)
  const skipped = M.refreshSummary(200, { ok: true, rebuild: { skipped: 'nothing to rebuild before the course switch' } })
  ok(skipped.tone === 'ok' && skipped.text === 'No snapshot to rebuild yet', 'a rebuild with nothing to do', skipped.text)
}

console.log("\n=== The page's reads (readDashboard in page.tsx) ===")
{
  const PAGE = 'src/app/admin/(authenticated)/page.tsx'
  const source = fromSrc(PAGE)
  const sf = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let fn = null
  ts.forEachChild(sf, (n) => { if (ts.isFunctionDeclaration(n) && n.name?.text === 'readDashboard') fn = n })
  if (!fn) throw new Error(`${PAGE} has no readDashboard`)
  const js = ts.transpileModule(fn.getText(sf), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const scope = {
    configReads: M.configReads, countRead: M.countRead, rowsRead: M.rowsRead, trendDays: M.trendDays,
    DASH_STUDENT_COLUMNS: M.DASH_STUDENT_COLUMNS, DASH_STUDENT_STATUSES: M.DASH_STUDENT_STATUSES, SNAPSHOT_COLUMNS: M.SNAPSHOT_COLUMNS, TASKS_RESET_KEY: M.TASKS_RESET_KEY,
    CURRICULUM_RESET_KEY, ADMIN_STUDENT_JOIN_CUTOFF, TASKS_STUDENT_JOIN_CUTOFF, PAYING_WHOP_PLAN_IDS_ARRAY,
    fetchAllRowsByKey, DISCOUNT_ELIGIBLE_FROM, readNeedsHand,
  }
  const names = Object.keys(scope)
  const readDashboard = new Function(...names, `${js}\nreturn readDashboard;`)(...names.map((n) => scope[n]))

  /**
   * A client that records every call of every query and answers it from `answer(table, calls)`. With `db`, the two
   * tables of the 30% (discount_requests, discount_request_events) are read from stub-server.ts's database instead, as
   * PostgREST answers them (its own log records those calls).
   */
  function recorder(answer, db = null) {
    const log = []
    return {
      log,
      client: {
        from(table) {
          if (db && (table === 'discount_requests' || table === 'discount_request_events')) return fakeClient(db).from(table)
          const calls = []
          log.push({ table, calls })
          const chain = new Proxy({}, {
            get(_, prop) {
              if (prop === 'then') return (res, rej) => Promise.resolve().then(() => answer(table, calls)).then(res, rej)
              return (...args) => { calls.push([prop, ...args]); return chain }
            },
          })
          return chain
        },
      },
    }
  }
  const config = (rows) => ({ data: rows, error: null })
  // As v109 writes it (the review's fix round holds tasks_reset_at to tasks-reset.ts's check).
  const RESET = '2026-10-21T05:00:00.123Z'
  const answers = (over = {}) => (table, calls) => {
    if (over[table]) return over[table](calls)
    if (table === 'admin_config') return config([{ key: CURRICULUM_RESET_KEY, value: '2026-10-19T14:33:33.972Z' }])
    if (table === 'tasks') return { data: null, count: 31, error: null }
    if (table === 'students') return { data: [student('s1', '2026-10-10T08:00:00.000Z')], error: null }
    return { data: [], error: null }
  }
  const has = (calls, ...want) => calls.some((c) => show(c) === show(want))
  const queries = (log, table) => log.filter((q) => q.table === table)

  {
    const { client, log } = recorder(answers())
    const r = await readDashboard(client, NOW_OCT)
    const [tasks] = queries(log, 'tasks')
    ok(r.openTasks.ok && r.openTasks.data === 31 && r.tasksResetAt.ok && r.tasksResetAt.data === null, 'no tasks reset yet: the open tasks counted, no floor')
    ok(has(tasks.calls, 'select', 'id, student:students!inner(csm_exempt, joined_at)', { count: 'exact', head: true })
       && has(tasks.calls, 'eq', 'status', 'open') && has(tasks.calls, 'not', 'template_id', 'is', null)
       && has(tasks.calls, 'eq', 'student.csm_exempt', false) && has(tasks.calls, 'gte', 'student.first_paid_at', TASKS_STUDENT_JOIN_CUTOFF),
       'with the Tasks page\'s own filters: a template, not exempt, first paid since the tasks\' cutoff', show(tasks.calls))
    ok(!tasks.calls.some((c) => c[0] === 'gte' && c[1] === 'created_at'), 'and no created_at floor before the reset')
    const [stu] = queries(log, 'students')
    ok(has(stu.calls, 'select', M.DASH_STUDENT_COLUMNS) && has(stu.calls, 'not', 'whop_membership_id', 'is', null)
       && has(stu.calls, 'in', 'membership_status', ['active', 'past_due', 'canceled', 'expired'])
       && has(stu.calls, 'in', 'whop_plan_id', [...PAYING_WHOP_PLAN_IDS_ARRAY]) && has(stu.calls, 'gte', 'first_paid_at', ADMIN_STUDENT_JOIN_CUTOFF)
       && has(stu.calls, 'order', 'id') && has(stu.calls, 'limit', 1000),
       'students: the population as before (a membership, the three statuses, the paying plan, since 25 May), and expired for Month 2 alone; the named columns only, paged by id', show(stu.calls))
    ok(!stu.calls.some((c) => c[0] === 'select' && c[1] === '*'), 'no select("*"): the tiles need 6 columns')
    const [mil] = queries(log, 'student_milestones')
    ok(has(mil.calls, 'not', 'bounty_access_claimed_at', 'is', null) && has(mil.calls, 'order', 'student_id'),
       'bounty: only the rows with a stamp, paged by student', show(mil.calls))
    const [snap] = queries(log, 'daily_progress_snapshots')
    const [canc] = queries(log, 'canceling_snapshots')
    ok(has(snap.calls, 'gte', 'snapshot_date', '2026-10-07') && has(snap.calls, 'lte', 'snapshot_date', '2026-10-20')
       && has(canc.calls, 'gte', 'snapshot_date', '2026-10-07') && has(canc.calls, 'lte', 'snapshot_date', '2026-10-20'),
       'both snapshot tables: the 14 days, no 15th', show(snap.calls))
    const [cfg] = queries(log, 'admin_config')
    ok(has(cfg.calls, 'in', 'key', [CURRICULUM_RESET_KEY, M.TASKS_RESET_KEY]) && r.resetAt.ok && r.resetAt.data === '2026-10-19T14:33:33.972Z',
       'the settings: one read of both keys')
  }
  {
    const { client, log } = recorder(answers({ admin_config: () => config([{ key: M.TASKS_RESET_KEY, value: RESET }]) }))
    const r = await readDashboard(client, NOW_OCT)
    const [tasks] = queries(log, 'tasks')
    ok(has(tasks.calls, 'gte', 'created_at', RESET) && r.openTasks.ok, 'after the tasks reset: only the tasks created from it, as the Tasks page lists them', show(tasks.calls))
  }
  {
    const down = { message: 'permission denied for table admin_config' }
    const { client, log } = recorder(answers({ admin_config: () => ({ data: null, error: down }) }))
    const r = await readDashboard(client, NOW_OCT)
    ok(queries(log, 'tasks').length === 0 && !r.openTasks.ok && r.openTasks.error === 'admin_config: permission denied for table admin_config',
       'no settings: the open tasks are not counted without their floor, and carry the reason', show(r.openTasks))
  }
  {
    const { client } = recorder(answers({ tasks: () => ({ data: null, count: null, error: null }) }))
    const r = await readDashboard(client, NOW_OCT)
    ok(!r.openTasks.ok, 'a count that did not come back: a failure, never 0')
  }
  {
    const { client } = recorder(answers({ students: () => ({ data: null, error: { message: 'canceling statement due to statement timeout' } }) }))
    const r = await readDashboard(client, NOW_OCT)
    ok(!r.students.ok && r.students.error === 'canceling statement due to statement timeout', 'a failed page of students is a failed read, never an empty list')
  }
  {
    // The two 30% reads (T-137, R5) on stub-server.ts's database, at one moment.
    const NOW = at('2026-10-21T09:00:00.000Z')
    const ago = (minutes) => iso(NOW - minutes * 60_000)
    const req = (id, status, created_at, more = {}) => ({ id, student_id: `s-${id}`, status, created_at, promo_code: null, rejection_reason: null, ...more })
    const ev = (request_id, event, created_at, reason = null) => ({ request_id, student_id: `s-${request_id}`, event, actor: 'job', reason, created_at })
    const rows = [
      req('p-31m', 'pending', ago(31)), // waiting 31 minutes: listed
      req('p-29m', 'pending', ago(29)), // 29 minutes: the app's own tries still come first
      req('a-old', 'approved', ago(60 * 50)), // approved, whatever its age: listed
      req('p-sept', 'pending', '2026-09-30T21:59:00.000Z'), // before 1 October: never listed
      req('x-app', 'applied', ago(600), { applied_at: ago(590) }), // applied: counted as applied, not listed
      req('x-wf', 'rejected', ago(600)), // its newest event a write_failed: listed
      req('x-wf-31d', 'rejected', ago(60 * 24 * 31)), // a write_failed 31 days ago: not
      req('x-wf-then', 'applied', ago(600)), // a write_failed, then applied: not listed, counted as applied
      req('x-app-sept', 'applied', '2026-09-20T10:00:00.000Z'), // applied before 1 October: not counted
    ]
    const events = [
      ev('x-wf', 'rejected', ago(500)), ev('x-wf', 'attempt_failed', ago(499), 'write_failed'),
      ev('x-wf-31d', 'attempt_failed', ago(60 * 24 * 31 - 10), 'write_failed'),
      ev('x-wf-then', 'attempt_failed', ago(500), 'write_failed'), ev('x-wf-then', 'applied', ago(490)),
      ev('p-31m', 'attempt_failed', ago(20), 'no_membership'),
    ]
    const seed = () => new FakeDb({
      discount_requests: rows,
      discount_request_events: events,
      students: rows.map((x) => ({ id: x.student_id, first_paid_at: '2026-10-10T08:00:00.000Z', membership_status: 'active' })),
    })
    const db = seed()
    const r = await readDashboard(recorder(answers(), db).client, NOW)
    const page = await loadThirtyData(fakeClient(db), NOW)
    const listed = page.ok ? page.data.requests.map((x) => x.id).sort() : null
    ok(r.needsHand.ok && r.needsHand.data === 3 && show(listed) === show(['a-old', 'p-31m', 'x-wf']) && r.needsHand.data === listed.length,
       '30% needs a hand counts the 30% page\'s own list at the same moment: pending or approved 30 minutes after applying (from 1 October), and a request whose newest event is a write_failed from the last 30 days; not one waiting 29 minutes, one from September, a write_failed 31 days old or one followed by its applied event',
       show({ hand: r.needsHand, listed }))
    const direct = await readNeedsHand(fakeClient(seed()), NOW)
    ok(direct.ok && show(direct.requests.map((x) => x.id).sort()) === show(listed), 'it is readNeedsHand\'s own answer, the reads the page makes', show(direct))
    const applied = db.log.filter((q) => q.table === 'discount_requests' && q.filters.includes('status=applied'))
    ok(r.thirtyApplied.ok && r.thirtyApplied.data === 2 && applied.length === 1 && applied[0].filters.includes(`created_at>=${DISCOUNT_ELIGIBLE_FROM}`),
       '30% off applied: the applied requests made from 1 October, counted by the database (not the one from September)', show({ applied: r.thirtyApplied, filters: applied[0]?.filters }))
    const noEvents = seed()
    noEvents.fail['discount_request_events.select'] = { message: 'permission denied for table discount_request_events' }
    const r2 = await readDashboard(recorder(answers(), noEvents).client, NOW)
    ok(!r2.needsHand.ok && r2.needsHand.error.includes('permission denied for table discount_request_events') && r2.thirtyApplied.ok,
       'the events unread: "30% needs a hand" is a failure with its reason, never fewer rows or 0; the applied count stands', show(r2.needsHand))
    const noRequests = seed()
    noRequests.fail['discount_requests.select'] = { message: 'JWT expired' }
    const r3 = await readDashboard(recorder(answers(), noRequests).client, NOW)
    ok(!r3.needsHand.ok && !r3.thirtyApplied.ok && r3.thirtyApplied.error === 'JWT expired', 'the requests unread: both 30% tiles fail, never 0', show([r3.needsHand, r3.thirtyApplied]))
  }
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
