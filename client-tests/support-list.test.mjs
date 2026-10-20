// support-list.test.mjs: who is on Today, why, and what the page counts
// (admin rebuild PRD, _admin/prds/admin-rebuild/admin_rebuild_prd.md in the
// workspace, work item 4, calls C3 to C8, C12 to C14).
//
// buildSupportRows (src/lib/admin/support-list.ts, copied by build.mjs) is
// pure: every case hands it a made-up input and a moment, and reads the rows
// and the Handled list it answers. The 30% part is the student app's own rule
// on a small made-up course (4 videos, the 4th the checkpoint).
//
// Made-up people only: this repository is public.
import { isDeepStrictEqual } from 'node:util'
import {
  COOLDOWN_DAYS,
  DEFAULT_FILTER,
  REASON_ORDER,
  SUPPORT_SCENARIO,
  buildSupportRows,
  cancelText,
  chipCounts,
  heroCount,
  inTodayPopulation,
  isReasonKind,
  visibleRows,
} from './_gen/support-list.ts'
import { daysOnCourse } from './_gen/curriculum-reset.ts'
import { sprintDayNumber } from './_gen/constants.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

/** Words the team never reads (the PRD's rule for every sentence a page shows). */
const BANNED = [/—/, /\bunlock/i, /ecomtalent/i]
const plain = (s) => typeof s === 'string' && s.trim().length > 0 && BANNED.every((re) => !re.test(s))

// ── The clock and the course ───────────────────────────────────────────────
const RESET = '2026-10-19T14:33:00.000Z' // the course switch
const NOW = '2026-10-28T08:30:00.000Z' // Wed 28 Oct, 09:30 in Croatia
const DAY = 86_400_000
const ago = (days, hours = 0) => new Date(Date.parse(NOW) - days * DAY - hours * 3_600_000).toISOString()
const minutesAgo = (m) => new Date(Date.parse(NOW) - m * 60_000).toISOString()
const MONTHLY = 'plan_4ZrwR4PmBsVsx'
const YEARLY = 'plan_VFDntXQf9cYMo'
const OTHER = 'plan_made_up_free'
const ME = 'tm-robin'
const JAMIE = 'tm-jamie'

const CATALOG = ['w1', 'w2', 'w3', 'w4'].map((id, i) => ({
  id, type: 'watch', counts_toward_progress: true, is_gate: i === 3, duration_seconds: 600,
}))
const VIDEOS = CATALOG.map((l) => ({ lesson_id: l.id, created_at: '2026-10-19T10:00:00.000Z' }))
/** One student's five 30% reads, as loadDiscountReads (and loadThirtyData) hand them. */
function reads(paid, done = [], doneAt = ago(2), requests = []) {
  return {
    student: { data: { first_paid_at: paid }, error: null },
    lessons: { data: CATALOG, error: null },
    videos: { data: VIDEOS, error: null },
    completions: { data: done.map((lesson_id) => ({ lesson_id, completed_at: doneAt })), error: null },
    requests: { data: requests, error: null },
  }
}

/**
 * A made-up world, one entry per student. By default a student is an active
 * monthly member with a Whop membership, first paid on 1 September (before
 * the 30% offer), opened the app, did a counted lesson yesterday (so nothing
 * applies), and had a Whop backfill after the switch.
 */
function world(people, { tasks = [], templates = [], callerId = ME, names = [] } = {}) {
  const input = {
    resetAt: RESET,
    callerId,
    lessonsTotal: 140,
    students: [],
    progress: new Map(),
    lastLesson: new Map(),
    currentArea: new Map(),
    areas: new Map([['a1', 'First steps'], ['a2', 'Ad basics']]),
    firstLogin: new Set(),
    lastSyncAt: new Map(),
    lastHeartbeat: new Map(),
    tasks,
    templates,
    team: new Map([[ME, 'Robin Hale'], [JAMIE, 'Jamie Rowe']]),
    names: new Map(names),
    config: { program_login_link: 'https://example.com/start', discord_invite_link: '' },
    thirty: {
      reads: new Map(), catalog: { data: CATALOG, error: null }, videos: { data: VIDEOS, error: null }, students: [],
      completions: new Map(), requests: [], questions: [], answers: new Map(), team: new Map(), lastSyncAt: new Map(), contacts: new Map(),
    },
  }
  for (const p of people) {
    input.students.push({
      id: p.id, name: p.name ?? `Student ${p.id}`, email: `${p.id}@example.com`,
      discord_user_id: p.discordId ?? null, discord_username: p.discord ?? null,
      whop_plan_id: p.plan === undefined ? MONTHLY : p.plan, whop_membership_id: p.membership === false ? null : `mem_${p.id}`,
      membership_status: p.status ?? 'active', cancel_scheduled_at: p.cancelAt ?? null,
      first_paid_at: p.paid === undefined ? '2026-09-01T09:00:00.000Z' : p.paid, joined_at: p.joined ?? p.paid ?? '2026-09-01T09:00:00.000Z',
      csm_exempt: p.exempt ?? false, high_churn_risk: p.highChurn ?? false,
    })
    if (p.opened !== false) input.firstLogin.add(p.id)
    const last = p.last === undefined ? ago(1) : p.last
    if (last) input.lastLesson.set(p.id, last)
    if (p.lessons !== undefined) input.progress.set(p.id, p.lessons)
    if (p.area) input.currentArea.set(p.id, p.area)
    if (p.heartbeat) input.lastHeartbeat.set(p.id, p.heartbeat)
    if (p.synced !== null) input.lastSyncAt.set(p.id, p.synced ?? ago(1))
    if (p.thirty) input.thirty.reads.set(p.id, p.thirty)
  }
  return input
}
const build = (input, now = NOW) => buildSupportRows(input, new Date(now))
const rowOf = (out, id) => out.rows.find((r) => r.studentId === id)
const headline = (out, id) => rowOf(out, id)?.reasons[0]

/** A task row, closed by `by` at `at` (completed), or open. */
function taskRow(t) {
  return {
    template_id: null, behavior_summary: null, completed_at: null, completed_by: null, dismissed_at: null,
    dismissed_by: null, notes: null, outcome: null, created_at: t.completed_at ?? t.dismissed_at ?? ago(3), ...t,
  }
}
const support = (studentId, kind, at, by = ME, status = 'completed', more = {}) =>
  taskRow({
    id: `sup-${studentId}-${kind}-${at}`, student_id: studentId, scenario_id: SUPPORT_SCENARIO[kind], status, created_at: at,
    ...(status === 'completed' ? { completed_at: at, completed_by: by } : { dismissed_at: at, dismissed_by: by }), ...more,
  })

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Each reason of C4, with its words ===')
{
  const out = build(world([
    { id: 'cancel', cancelAt: ago(2, 1) },
    { id: 'pastdue', status: 'past_due' },
    // Own window: first paid 15 Oct, deadline Thu 29 Oct 09:00 UTC (10:00 in Croatia), two videos left.
    { id: 'closing', paid: '2026-10-15T09:00:00.000Z', thirty: reads('2026-10-15T09:00:00.000Z', ['w1', 'w2']) },
    // Every video done; deadline Tue 3 Nov.
    { id: 'ready', paid: '2026-10-20T09:00:00.000Z', thirty: reads('2026-10-20T09:00:00.000Z', ['w1', 'w2', 'w3', 'w4'], ago(2)) },
    { id: 'stopped', last: ago(5) },
    { id: 'nostart', last: null },
    { id: 'noopen', opened: false, last: null, paid: ago(6, 2) },
    { id: 'task', last: ago(0, 3) },
  ], {
    tasks: [taskRow({ id: 'q-task', student_id: 'task', scenario_id: 'welcome.day1', template_id: 'tpl-w', status: 'open',
      behavior_summary: 'Joined yesterday: send the welcome message', created_at: ago(1) })],
  }))
  const expect = [
    ['cancel', 'cancelling', 'Clicked cancel 2 days ago'],
    ['pastdue', 'past_due', 'Payment failed'],
    ['closing', 'thirty_closing', '30% closes Thu 29 Oct, 10:00: 2 videos left (about 1 h)'],
    ['ready', 'thirty_ready', 'Can apply for the 30% now, until Tue 3 Nov, 10:00'],
    ['stopped', 'stopped', 'No lesson for 5 days'],
    ['nostart', 'not_started', 'No lesson on the new course yet (course day 9)'],
    ['noopen', 'never_opened', 'Paid 7 days ago, never opened the app'],
    ['task', 'open_task', 'Joined yesterday: send the welcome message'],
  ]
  for (const [id, kind, text] of expect) {
    const h = headline(out, id)
    ok(h?.kind === kind && h?.text === text && rowOf(out, id).reasons.length === 1, `${kind}: "${text}"`, show(rowOf(out, id)?.reasons))
  }
  ok(out.rows.length === 8, 'one row each, nobody else', String(out.rows.length))
  ok(isDeepStrictEqual(out.rows.map((r) => r.reasons[0].kind), [...REASON_ORDER]), 'the rows come most urgent reason first, in C4\'s order', out.rows.map((r) => r.reasons[0].kind).join(', '))
  ok(out.rows.every((r) => r.reasons.every((x) => plain(x.text))), 'no em dash, "unlock" or "EcomTalent" in any reason')
  ok(headline(out, 'stopped').waitDays === 5 && headline(out, 'nostart').waitDays === 9 && headline(out, 'cancel').waitDays === 2,
     'the wait in whole days: 5 without a lesson, course day 9, 2 days since the cancel')
  ok(cancelText(0) === 'Clicked cancel less than 1 day ago' && cancelText(1) === 'Clicked cancel 1 day ago',
     'Clicked cancel under a day ago, and 1 day ago, in plain words')
  ok(headline(out, 'pastdue').waitDays === null, 'Payment failed has no date in the database, so no wait')
  // C8: course day from the later of the first payment and the switch, as the crons count.
  const noopen = rowOf(out, 'noopen')
  ok(noopen.courseDay === daysOnCourse(ago(6, 2), Date.parse(NOW)) && rowOf(out, 'nostart').courseDay === 9,
     'course day counts from the first payment after the switch, from the switch before it', `${noopen.courseDay}, ${rowOf(out, 'nostart').courseDay}`)
  // Never opened counts days as sprintDayNumber does, at the same moment.
  const RealNow = Date.now
  Date.now = () => Date.parse(NOW)
  const sprint = sprintDayNumber(ago(6, 2))
  Date.now = RealNow
  ok(noopen.reasons[0].text === `Paid ${sprint} days ago, never opened the app`, 'never opened: sprintDayNumber\'s day count', String(sprint))
}

console.log('\n=== The thresholds: day 3, 3 days without a lesson, a deadline 3 days away ===')
{
  const out = build(world([
    // 2 days 23 hours without a lesson: still moving.
    { id: 'moving', last: ago(2, 23) },
    // Exactly 3 whole days: slipping.
    { id: 'three', last: ago(3) },
    // Over 7 days: stalled.
    { id: 'eight', last: ago(8, 5) },
    // First paid after the switch, 2 days ago: course day 3? No, 2 days and 23 hours is day 3, 1 day 23 hours is day 2.
    { id: 'day2', last: null, paid: ago(1, 23) },
    { id: 'day3', last: null, paid: ago(2, 1) },
    // A deadline 3 days and 1 hour away: not closing yet.
    { id: 'far', paid: '2026-10-17T09:30:00.000Z', thirty: reads('2026-10-17T09:30:00.000Z', ['w1']) },
    // Never opened, paid 1 day 23 hours ago: day 2.
    { id: 'noopen2', opened: false, last: null, paid: ago(1, 23) },
  ]))
  ok(!rowOf(out, 'moving'), 'under 3 whole days without a lesson: not on the list')
  ok(headline(out, 'three')?.text === 'No lesson for 3 days', '3 whole days: "No lesson for 3 days"')
  ok(headline(out, 'eight')?.text === 'No lesson for 8 days' && headline(out, 'eight')?.waitDays === 8, 'over 7 days: "No lesson for 8 days" (Stalled)')
  ok(!rowOf(out, 'day2') && headline(out, 'day3')?.kind === 'not_started', 'Not started from course day 3, not before', show(headline(out, 'day3')))
  ok(!rowOf(out, 'far'), 'a 30% deadline more than 3 days away is no reason')
  ok(!rowOf(out, 'noopen2'), 'Never opened from the third day after the first payment, not before')
}

console.log('\n=== Two reasons on one student: one row, the more urgent headline, the other a chip ===')
{
  const out = build(world([
    { id: 'both', status: 'past_due', last: ago(4) },
    { id: 'three', status: 'past_due', cancelAt: ago(1, 2), last: ago(9) },
    // The 30% closes and the student stopped: the 30% first.
    { id: 'thirtystop', paid: '2026-10-15T09:00:00.000Z', last: ago(4), thirty: reads('2026-10-15T09:00:00.000Z', ['w1', 'w2', 'w3']) },
    // A student listed twice by a read: still one row.
    { id: 'twice', last: ago(5) }, { id: 'twice', last: ago(5) },
  ]))
  const both = rowOf(out, 'both')
  ok(out.rows.filter((r) => r.studentId === 'both').length === 1, 'one row for the student')
  ok(both.reasons[0].kind === 'past_due' && both.reasons[1].kind === 'stopped' && both.reasons[1].text === 'No lesson for 4 days',
     'headline Payment failed, chip "No lesson for 4 days"', show(both.reasons))
  ok(isDeepStrictEqual(rowOf(out, 'three').reasons.map((r) => r.kind), ['cancelling', 'past_due', 'stopped']),
     'three reasons, most urgent first: Cancelling, Payment failed, Stopped')
  ok(isDeepStrictEqual(rowOf(out, 'thirtystop').reasons.map((r) => r.kind), ['thirty_closing', 'stopped']), '30% closing before Stopped')
  ok(out.rows.filter((r) => r.studentId === 'twice').length === 1, 'a student read twice is one row')
}

console.log('\n=== Who is never on it (C3) ===')
{
  const stopped = { last: ago(6) }
  const out = build(world([
    { id: 'exempt', exempt: true, ...stopped },
    { id: 'canceled', status: 'canceled', ...stopped },
    { id: 'expired', status: 'expired', ...stopped },
    { id: 'nomember', membership: false, ...stopped },
    // Never opened, and the never-logged-in sequence marked them at its day 10: left out (C3).
    { id: 'churn', opened: false, last: null, highChurn: true, paid: ago(14) },
    { id: 'control', ...stopped },
  ]))
  for (const id of ['exempt', 'canceled', 'expired', 'nomember']) ok(!rowOf(out, id), `${id}: absent`)
  ok(!rowOf(out, 'churn'), 'high_churn_risk and never opened: absent (and not Not started either: it is for students who opened the app)')
  ok(!!rowOf(out, 'control'), 'the same student, active and not exempt: present')
  ok(!inTodayPopulation({ membership_status: 'active', whop_membership_id: null, csm_exempt: false })
     && inTodayPopulation({ membership_status: 'past_due', whop_membership_id: 'mem', csm_exempt: false }),
     'the population rule on its own: a Whop membership needed, past due counts')
  // High churn risk only leaves out Never opened: such a student who cancels is still listed.
  const out2 = build(world([{ id: 'churncancel', opened: false, last: null, highChurn: true, paid: ago(14), cancelAt: ago(1) }]))
  ok(isDeepStrictEqual(rowOf(out2, 'churncancel')?.reasons.map((r) => r.kind), ['cancelling']), 'high churn risk and cancelling: listed for the cancel only')
  // Every plan is listed, with its name (C3).
  const out3 = build(world([{ id: 'y', plan: YEARLY, last: ago(4) }, { id: 'o', plan: OTHER, last: ago(4) }, { id: 'none', plan: null, last: ago(4) }]))
  ok(rowOf(out3, 'y')?.plan === 'Yearly' && rowOf(out3, 'o')?.plan === 'Other plan' && rowOf(out3, 'none')?.plan === 'Other plan',
     'yearly and other plans are listed and labelled')
}

console.log('\n=== An app heartbeat in the last 3 days holds back Stopped and Not started ===')
{
  const out = build(world([
    { id: 'hb2', last: ago(6), heartbeat: ago(2) },
    { id: 'hb4', last: ago(6), heartbeat: ago(4) },
    { id: 'hbnew', last: null, heartbeat: ago(0, 5) },
    // A heartbeat does not hold back the other reasons.
    { id: 'hbcancel', last: ago(6), heartbeat: ago(1), cancelAt: ago(1) },
  ]))
  ok(!rowOf(out, 'hb2'), 'heartbeat 2 days ago, otherwise Stopped: absent')
  ok(headline(out, 'hb4')?.kind === 'stopped', 'heartbeat 4 days ago: Stopped again')
  ok(!rowOf(out, 'hbnew'), 'heartbeat today, no lesson yet: not Not started')
  ok(isDeepStrictEqual(rowOf(out, 'hbcancel')?.reasons.map((r) => r.kind), ['cancelling']), 'with a heartbeat, a cancel still shows (Stopped held back)')
}

console.log('\n=== Already handled (C5): a support record or a queue send keeps the headline hidden for a while ===')
{
  const people = [
    { id: 's2', last: ago(6) }, { id: 's8', last: ago(9) },
    { id: 'c2', cancelAt: ago(3) }, { id: 'c4', cancelAt: ago(5) },
    { id: 'r1', paid: '2026-10-20T09:00:00.000Z', thirty: reads('2026-10-20T09:00:00.000Z', ['w1', 'w2', 'w3', 'w4']) },
    { id: 'r3', paid: '2026-10-20T09:00:00.000Z', thirty: reads('2026-10-20T09:00:00.000Z', ['w1', 'w2', 'w3', 'w4']) },
    { id: 'other', cancelAt: ago(1), last: ago(5) },
    { id: 'byapp', last: ago(6) },
    { id: 'jamie', last: ago(6) },
    { id: 'notneeded', last: ago(6) },
  ]
  const tasks = [
    support('s2', 'stopped', ago(2)),
    support('s8', 'stopped', ago(8)),
    support('c2', 'cancelling', ago(2)),
    support('c4', 'cancelling', ago(4)),
    support('r1', 'thirty_ready', ago(1)),
    support('r3', 'thirty_ready', ago(3)),
    // Messaged for Stopped yesterday, cancelling since: a different headline shows the row.
    support('other', 'stopped', ago(1)),
    // A record nobody on the team wrote (the app closing it): never counts.
    support('byapp', 'stopped', ago(1), null, 'dismissed'),
    // Another member's send counts the same.
    support('jamie', 'stopped', ago(1), JAMIE),
    // Not needed counts as handled too.
    support('notneeded', 'stopped', ago(1), ME, 'dismissed', { notes: 'Away this week' }),
  ]
  const out = build(world(people, { tasks }))
  ok(!rowOf(out, 's2') && !!rowOf(out, 's8'), 'support record 2 days ago (Stopped): absent; 8 days ago: present')
  ok(!rowOf(out, 'c2') && !!rowOf(out, 'c4'), 'Cancelling: hidden 3 days (2 days ago absent, 4 days ago present)')
  ok(!rowOf(out, 'r1') && !!rowOf(out, 'r3'), '30% ready: hidden 2 days (1 day ago absent, 3 days ago present)')
  ok(headline(out, 'other')?.kind === 'cancelling', 'a different headline shows the row')
  ok(headline(out, 'byapp')?.kind === 'stopped', 'a record the app closed, with no team member, does not hide the row')
  ok(!rowOf(out, 'jamie') && !rowOf(out, 'notneeded'), 'another member\'s send hides it too, and so does Not needed')
  ok(COOLDOWN_DAYS.stopped === 7 && COOLDOWN_DAYS.cancelling === 3 && COOLDOWN_DAYS.past_due === 3 && COOLDOWN_DAYS.thirty_closing === 2
     && COOLDOWN_DAYS.not_started === 7 && COOLDOWN_DAYS.never_opened === 7 && COOLDOWN_DAYS.thirty_ready === 2, 'the waits are C5\'s 7, 3 and 2 days')
}
{
  // Stopped, messaged 6 days ago, then a counted lesson 4 days ago, then nothing: stopped again.
  const again = build(world([{ id: 'again', last: ago(4) }], { tasks: [support('again', 'stopped', ago(6))] }))
  ok(headline(again, 'again')?.kind === 'stopped', 'Stopped record, then a counted lesson, then stopped again: present')
  // The last lesson was before the record: still the same stop, still hidden.
  const same = build(world([{ id: 'same', last: ago(6, 1) }], { tasks: [support('same', 'stopped', ago(6))] }))
  ok(!rowOf(same, 'same'), 'no lesson since the record: still hidden')
}
{
  // The queue's own sends (C5): nolessons.* hides Not started, stalled.* hides Never opened.
  const cron = (id, student, scenario, at, by = ME, status = 'completed') =>
    taskRow({ id, student_id: student, scenario_id: scenario, template_id: 'tpl', status, ...(status === 'completed' ? { completed_at: at, completed_by: by } : { dismissed_at: at, dismissed_by: by }) })
  const out = build(world([
    { id: 'ns', last: null },
    { id: 'ns-app', last: null },
    { id: 'no', opened: false, last: null, paid: ago(6) },
    { id: 'ns-old', last: null },
  ], {
    tasks: [
      cron('t1', 'ns', 'nolessons.day7', ago(1)),
      cron('t2', 'ns-app', 'nolessons.day3', ago(1), null, 'dismissed'),
      cron('t3', 'no', 'stalled.discord.day5', ago(1)),
      cron('t4', 'ns-old', 'nolessons.day3', ago(8)),
    ],
  }))
  ok(!rowOf(out, 'ns'), 'cron nolessons.* completed yesterday, headline Not started: absent')
  ok(headline(out, 'ns-app')?.kind === 'not_started', 'the same task dismissed by the app (19 October\'s switch did that): present')
  ok(!rowOf(out, 'no'), 'cron stalled.* completed yesterday, headline Never opened: absent')
  ok(headline(out, 'ns-old')?.kind === 'not_started', 'a nolessons.* send 8 days ago: present')
}

console.log('\n=== An open queue task (C5, C6) ===')
{
  const templates = [
    { id: 'tpl-nl7', scenario_id: 'nolessons.day7', title: 'No lesson yet', body: 'Hey {firstName}, the first lesson is short. Start here: {programLink}', is_active: true },
    { id: 'tpl-old', scenario_id: 'welcome.day1', title: 'Welcome', body: 'Welcome {firstName}! Book a call: {bookingLink}', is_active: false },
    { id: 'tpl-sup-ns', scenario_id: 'support.nostart', title: 'Not started', body: 'Hi {firstName}, can I help you start?', is_active: true },
    { id: 'tpl-sup-stop', scenario_id: 'support.stopped', title: 'Stopped', body: 'Hi {fullName}, how are you getting on?', is_active: false },
    { id: 'tpl-sup-cancel', scenario_id: 'support.cancel', title: 'Cancel', body: '   ', is_active: true },
  ]
  const open = (id, student, scenario, template, created = ago(2)) =>
    taskRow({ id, student_id: student, scenario_id: scenario, template_id: template, status: 'open', behavior_summary: `Summary of ${id}`, created_at: created })
  const out = build(world([
    { id: 'both', name: 'Ana Example', last: null },
    { id: 'cool', name: 'Bo Example', last: null },
    { id: 'plain', name: 'Cy Example', last: null },
    { id: 'old', name: 'Di Example' },
    { id: 'stop', name: 'Ed Example', last: ago(5) },
    { id: 'blank', name: 'Fay Example', cancelAt: ago(1) },
    { id: 'gone', name: 'Gus Example', last: null },
  ], {
    templates,
    tasks: [
      open('q-both', 'both', 'nolessons.day7', 'tpl-nl7'),
      // Handled yesterday for Not started, and the queue opened a task since: an open task always shows its row.
      support('cool', 'not_started', ago(1)),
      open('q-cool', 'cool', 'nolessons.day7', 'tpl-nl7', ago(0, 2)),
      open('q-old', 'old', 'welcome.day1', 'tpl-old'),
      // A task whose template was deleted (template_id set null).
      open('q-gone', 'gone', 'nolessons.day7', null),
    ],
  }))
  const both = rowOf(out, 'both')
  ok(out.rows.filter((r) => r.studentId === 'both').length === 1 && both.reasons[0].kind === 'not_started',
     'open cron task + computed reason: one row, the computed headline', show(both?.reasons))
  ok(both.openTasks.length === 1 && both.openTasks[0].id === 'q-both'
     && both.openTasks[0].message === 'Hey Ana, the first lesson is short. Start here: https://example.com/start'
     && both.openTasks[0].unresolved.length === 0, 'the row copies the task\'s message, filled in', show(both.openTasks[0]))
  ok(both.supportMessage === null, 'and not the support.nostart template, though one is active (C6: the task\'s template first)')
  ok(!!rowOf(out, 'cool') && rowOf(out, 'cool').reasons[0].kind === 'not_started', 'handled yesterday, but an open task in the queue: the row shows')
  ok(rowOf(out, 'plain')?.supportMessage === 'Hi Cy, can I help you start?' && rowOf(out, 'plain').openTasks.length === 0,
     'no open task: the active support.<kind> template, filled in')
  const old = rowOf(out, 'old')
  ok(old?.reasons[0].kind === 'open_task' && old.reasons[0].text === 'Summary of q-old', 'only an open task: the headline is its summary')
  ok(old?.openTasks[0].message === 'Welcome Di! Book a call: {bookingLink}' && isDeepStrictEqual(old.openTasks[0].unresolved, ['bookingLink']),
     'an open task copies its own template even when that template is off, with what could not be filled in named')
  ok(rowOf(out, 'stop')?.supportMessage === null, 'an inactive support template: no text')
  ok(rowOf(out, 'blank')?.supportMessage === null, 'a template with no words: no text')
  ok(rowOf(out, 'gone')?.openTasks[0].message === null && rowOf(out, 'gone').supportMessage === 'Hi Gus, can I help you start?',
     'a task with no template: no task message, so the support template steps in')
}

console.log('\n=== No Whop backfill since the switch (C14) ===')
{
  const out = build(world([
    { id: 'stop-nopull', last: ago(5), synced: '2026-10-18T10:00:00.000Z' },
    { id: 'ns-never', last: null, synced: null },
    { id: 'cancel-nopull', cancelAt: ago(1), synced: null },
    { id: 'stop-pulled', last: ago(5) },
  ]))
  const s = rowOf(out, 'stop-nopull')
  ok(s?.whopPulled === false && s.group === 'whop-not-pulled', 'Stopped with the last backfill before the switch: the chip and the folded group')
  ok(rowOf(out, 'ns-never')?.group === 'whop-not-pulled', 'Not started with no backfill ever: the folded group')
  const c = rowOf(out, 'cancel-nopull')
  ok(c?.whopPulled === false && c.group === 'main', 'Cancelling with no backfill: the chip, but the main list (C14 folds only Stopped and Not started)')
  ok(rowOf(out, 'stop-pulled')?.group === 'main' && rowOf(out, 'stop-pulled').whopPulled === true, 'a backfill after the switch: the main list')
  ok(heroCount(out.rows, DEFAULT_FILTER) === 2, 'outside the hero count: 2 to message, not 4', String(heroCount(out.rows, DEFAULT_FILTER)))
  const v = visibleRows(out.rows, DEFAULT_FILTER)
  ok(v.whopNotPulled.length === 2 && v.main.length === 2, 'the page shows them in their own group')
  const chips = chipCounts(out.rows, DEFAULT_FILTER)
  ok(chips.stopped === 1 && chips.not_started === 0 && chips.cancelling === 1, 'the chips count the main list only', show(chips))
}

console.log('\n=== The last message (C12) and the row\'s facts ===')
{
  const out = build(world([
    { id: 'a', last: ago(5), lessons: 12, area: 'a2', discord: 'a.example', discordId: '100000000000000001' },
    { id: 'b', last: ago(5) },
  ], {
    tasks: [
      taskRow({ id: 'c1', student_id: 'a', scenario_id: 'nolessons.day3', template_id: 't', status: 'completed', completed_at: ago(20), completed_by: JAMIE, outcome: 'replied' }),
      taskRow({ id: 'c2', student_id: 'a', scenario_id: 'support.pastdue', status: 'completed', completed_at: ago(12), completed_by: ME }),
      taskRow({ id: 'c3', student_id: 'a', scenario_id: 'welcome.day1', template_id: 't', status: 'dismissed', dismissed_at: ago(9), dismissed_by: ME }),
    ],
  }))
  const a = rowOf(out, 'a')
  ok(isDeepStrictEqual(a.lastContact, { at: ago(12), by: { id: ME, name: 'Robin Hale' }, scenarioId: 'support.pastdue', outcome: null }),
     'the newest COMPLETED task, any scenario, with the member\'s name (a dismissal is no message)', show(a.lastContact))
  ok(rowOf(out, 'b').lastContact === null, 'none: null')
  ok(a.lessonsDone === 12 && isDeepStrictEqual(a.area, { id: 'a2', name: 'Ad basics' }) && a.lastLessonAt === ago(5), 'lessons done, the area by name, the last lesson')
  ok(isDeepStrictEqual(a.discord, { userId: '100000000000000001', username: 'a.example' }), 'C7: the Discord id and name')
  ok(rowOf(out, 'b').lessonsDone === 0 && rowOf(out, 'b').area === null, 'no progress row: 0 lessons and no area')
}

console.log('\n=== Handled: the last 7 days, one mark\'s record and its queue tasks together, Undo for 15 minutes ===')
{
  const at = minutesAgo(5)
  const tasks = [
    // One mark by the reader 5 minutes ago: the record and the queue task it closed.
    taskRow({ id: 'm-rec', student_id: 'x', scenario_id: 'support.nostart', status: 'completed', completed_at: at, completed_by: ME, created_at: at, behavior_summary: 'No lesson on the new course yet (course day 9)' }),
    taskRow({ id: 'm-task', student_id: 'x', scenario_id: 'nolessons.day7', template_id: 't', status: 'completed', completed_at: at, completed_by: ME, created_at: ago(2) }),
    // The reader, 20 minutes ago: too old to undo.
    taskRow({ id: 'old-mine', student_id: 'y', scenario_id: 'support.cancel', status: 'dismissed', dismissed_at: minutesAgo(20), dismissed_by: ME, notes: 'Spoke on a call' }),
    // Another member, a minute ago: not the reader's to undo.
    taskRow({ id: 'jamies', student_id: 'z', scenario_id: 'support.stopped', status: 'completed', completed_at: minutesAgo(1), completed_by: JAMIE, outcome: 'no_reply' }),
    // Closed by the app.
    taskRow({ id: 'app', student_id: 'gone', scenario_id: 'nolessons.day3', template_id: 't', status: 'dismissed', dismissed_at: ago(2), dismissed_by: null, notes: 'Replaced by a later stage' }),
    // 8 days ago: out of Handled. Open: not handled.
    taskRow({ id: 'week-old', student_id: 'x', scenario_id: 'support.stopped', status: 'completed', completed_at: ago(8), completed_by: ME }),
    taskRow({ id: 'still-open', student_id: 'x', scenario_id: 'welcome.day1', template_id: 't', status: 'open', created_at: ago(1) }),
  ]
  const out = build(world([{ id: 'x', name: 'Xia Example' }, { id: 'y', name: 'Yan Example' }, { id: 'z', name: 'Zoe Example' }],
    { tasks, names: [['gone', 'Gil Example']] }))
  const h = out.handled
  ok(isDeepStrictEqual(h.map((r) => r.taskId), ['jamies', 'm-rec', 'm-task', 'old-mine', 'app']),
     'newest first, the mark\'s record before the task it closed; nothing older than 7 days, nothing open', h.map((r) => r.taskId).join(', '))
  const rec = h.find((r) => r.taskId === 'm-rec')
  const task = h.find((r) => r.taskId === 'm-task')
  ok(rec.groupKey === `${ME}|${at}` && task.groupKey === rec.groupKey, 'one mark: one group key, "<by>|<at>"')
  ok(rec.undoable && task.undoable, 'the reader\'s mark 5 minutes ago: undoable')
  ok(!h.find((r) => r.taskId === 'old-mine').undoable && !h.find((r) => r.taskId === 'jamies').undoable && !h.find((r) => r.taskId === 'app').undoable,
     'not after 15 minutes, not another member\'s, not the app\'s')
  ok(isDeepStrictEqual(h.find((r) => r.taskId === 'jamies').by, { id: JAMIE, name: 'Jamie Rowe' }) && h.find((r) => r.taskId === 'app').by === null,
     'who did it, or null for the app')
  ok(h.find((r) => r.taskId === 'old-mine').note === 'Spoke on a call' && h.find((r) => r.taskId === 'jamies').outcome === 'no_reply'
     && rec.summary === 'No lesson on the new course yet (course day 9)', 'the note, the outcome and the summary')
  ok(h.find((r) => r.taskId === 'app').name === 'Gil Example' && rec.name === 'Xia Example', 'names, for students on the list and off it')
  const asJamie = build(world([{ id: 'x' }], { tasks, callerId: JAMIE })).handled
  ok(asJamie.find((r) => r.taskId === 'jamies').undoable && !asJamie.find((r) => r.taskId === 'm-rec').undoable, 'Undo follows the reader')
}

console.log('\n=== The page\'s filter and counts (C13) ===')
{
  const out = build(world([
    { id: 'm1', name: 'Mia Example', plan: MONTHLY, last: ago(5), discord: 'mia.ex' },
    { id: 'm2', name: 'Moe Example', plan: MONTHLY, cancelAt: ago(1) },
    { id: 'y1', name: 'Yul Example', plan: YEARLY, last: ago(9) },
    { id: 'o1', name: 'Oli Example', plan: OTHER, last: ago(5) },
    { id: 'o2', name: 'Ola Example', plan: OTHER, status: 'past_due' },
  ]))
  ok(heroCount(out.rows, DEFAULT_FILTER) === 3, 'default (Monthly and Yearly): 3 to message', String(heroCount(out.rows, DEFAULT_FILTER)))
  const all = { ...DEFAULT_FILTER, plan: 'all' }
  ok(heroCount(out.rows, all) === 5, 'All plans adds the other plans: 5')
  const chips = chipCounts(out.rows, DEFAULT_FILTER)
  ok(chips.stopped === 2 && chips.cancelling === 1 && chips.past_due === 0, 'chips by headline under the filter', show(chips))
  ok(chipCounts(out.rows, all).past_due === 1, 'and they follow All plans')
  ok(heroCount(out.rows, { ...DEFAULT_FILTER, kind: 'stopped' }) === 2, 'a chip narrows the list and the number')
  ok(heroCount(out.rows, { ...DEFAULT_FILTER, search: 'MIA' }) === 1 && heroCount(out.rows, { ...DEFAULT_FILTER, search: '@mia.ex' }) === 1
     && heroCount(out.rows, { ...DEFAULT_FILTER, search: 'm2@example' }) === 1 && heroCount(out.rows, { ...DEFAULT_FILTER, search: 'nobody' }) === 0,
     'search: name (any case), @discord, email')
  ok(REASON_ORDER.every((k) => chipCounts(out.rows, all)[k] >= 0) && isReasonKind('stopped') && !isReasonKind('stoped'), 'every reason has a count; unknown kinds are refused')
  ok(chips.stopped + chips.cancelling === heroCount(out.rows, DEFAULT_FILTER), 'each student once, under their headline: the chips add up to the number')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
