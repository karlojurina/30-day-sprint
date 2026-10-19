// thirty-view.test.mjs: the 30% for every student at once, behind the admin's
// 30% page and Today (admin rebuild PRD, work item 2:
// _admin/prds/admin-rebuild/admin_rebuild_prd.md in the workspace).
//
// loadThirtyData (src/lib/admin/thirty-data.ts) reads everyone's 30% facts in
// pages and in batches of 100 ids, and hands each student the DiscountReads
// object loadDiscountReads would have made for them; buildThirtyView
// (thirty-view.ts) runs the student app's own rule over them. Every fixture
// here runs both ways on the same stand-in database: the bulk path, and
// loadDiscountReads's five reads for one student at a time, which is what the
// approve route and the request routes read. The stand-in answers at most 1000
// rows a read, as PostgREST does, and with `shuffle` on it hands rows back in
// no fixed order wherever a read's order leaves them open. The reads, the
// state, the counts and the verdict must come out the same both ways, for
// every student.
//
// The paths are the PRD's table (A to M, J the 250 students with 15,250
// completions), on the real course: the catalog from course_catalog.json and a
// video for each lesson the development page has a length for (61 up to the
// gate, as on production). Students, names, dates and links are made up.
// Two controls then show the parity check can fail: the loader with a read
// that skips paging, and with its completions ordered on a key that is not
// unique.
import fs from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'
import { loadThirtyData } from './_gen/thirty-data.ts'
import { VERDICT_TEXT, buildThirtyView, studentAppView, whopPulled } from './_gen/thirty-view.ts'
import { approvalVerdict, explainOldCourseRequest, factsFromReads, loadDiscountReads, videoDoneIds } from './_gen/discount-server.ts'
import { DISCOUNT_ELIGIBLE_FROM, DISCOUNT_SHARED_DEADLINE, discountState, requiredLessons } from './_gen/discount.ts'
import { YEARLY_WHOP_PLAN_IDS, planLabel } from './_gen/plans.ts'
import { dayLabel, deadlineLabel } from './_gen/croatia-dates.ts'
import { FakeDb, MAX_ROWS, fakeClient, setCatalog } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

// ── The course, as the switch left it ──────────────────────────────────────
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const json = (rel) => JSON.parse(fs.readFileSync(here(rel), 'utf8'))
const catalog = json('../supabase/catalog/course_catalog.json')
const lengths = json('../src/app/dev/world-app/course-lengths.fixture.json')
const LESSONS = catalog.lessons.map((l, i) => ({
  id: l.id, region_id: l.area, type: l.type, title: l.title, sort_order: i + 1,
  requires_action: l.action_brief !== undefined, counts_toward_progress: l.counts !== false,
  is_gate: l.gate === true, duration_seconds: lengths[l.id] ?? null,
}))
const REQUIRED = requiredLessons(LESSONS.map((l) => ({ ...l, has_video: l.id in lengths }))).map((l) => l.id)
const ACTION = LESSONS.filter((l) => l.requires_action).map((l) => l.id)
const SECONDS = Object.fromEntries(LESSONS.map((l) => [l.id, l.duration_seconds ?? 0]))
const secondsOf = (ids) => ids.reduce((s, id) => s + SECONDS[id], 0)

const MONTHLY = 'plan_4ZrwR4PmBsVsx'
const YEARLY = 'plan_VFDntXQf9cYMo'
/** The switch (v104), as admin_config holds it. */
const RESET = '2026-10-19T14:33:00.000Z'
/** The videos, loaded the morning of the switch. */
const LOADED = '2026-10-19T10:00:00.000Z'
/** The first Whop backfill after the switch: the lessons a student finished on Whop come in with this moment. */
const FROM_WHOP = '2026-10-19T16:00:00.000Z'
const WED = '2026-10-21T09:00:00.000Z' // Wed 21 Oct, 11:00 in Croatia
const FRI = '2026-10-23T08:00:00.000Z' // the shared deadline's day, 10:00 in Croatia
const MON = '2026-10-26T09:00:00.000Z' // after it, 10:00 in Croatia (winter time)
const TEAM = [{ id: 'tm-1', email: 'robin@example.com', full_name: 'Robin Test', role: 'csm' }]
const QUESTIONS = [
  { id: 'q2', order_num: 2, question_text: 'What should the course add?', question_type: 'open_text' },
  { id: 'q1', order_num: 1, question_text: 'How likely are you to recommend the course?', question_type: 'scale', scale_min: 0, scale_max: 10 },
  { id: 'q3', order_num: 3, question_text: 'Where did you hear about us?', question_type: 'multi_choice' },
]

/** A set of made-up students and everything they did, each row with its moment. */
function fixtures() {
  const f = { people: [], done: [], asked: [], answers: [], tasks: [], synced: [] }
  f.person = (id, name, paid, more = {}) => {
    f.people.push({
      id, name, email: `${id}@example.com`, whop_user_id: `user_${id}`, whop_plan_id: MONTHLY,
      membership_status: 'active', first_paid_at: paid, joined_at: paid ?? '2026-09-01T00:00:00.000Z', ...more,
    })
    // A Whop backfill since the switch, unless the fixture says otherwise.
    if (more.synced !== null) f.synced.push({ student_id: id, last_sync_at: more.synced ?? FROM_WHOP })
    delete f.people.at(-1).synced
  }
  /** Lessons whose video the student finished at `at`; `extra` adds columns to one lesson's row. */
  f.watched = (student, ids, at, extra = {}) => {
    for (const lesson_id of ids) f.done.push({ student_id: student, lesson_id, completed_at: at, ...(extra[lesson_id] ?? {}) })
  }
  f.request = (student, id, created_at, status = 'pending', more = {}) => {
    f.asked.push({ id, student_id: student, status, created_at, promo_code: null, rejection_reason: null, ...more })
  }
  return f
}

/** The database as it stood at `at`: completions, requests, tasks and Whop backfills from after it are not there yet. */
function world(f, at, { shuffle = 7, videos } = {}) {
  setCatalog({ v2: true, lessonsTable: 'lessons' })
  const t = Date.parse(at)
  const by = (iso) => iso != null && Date.parse(iso) <= t
  const requests = f.asked.filter((r) => by(r.created_at))
  const db = new FakeDb({
    students: f.people,
    lessons: LESSONS,
    // The Tella id is on the row; the loader must never read it.
    lesson_videos: videos ?? Object.keys(lengths).map((lesson_id) => ({ lesson_id, created_at: LOADED, tella_video_id: `tella-${lesson_id}` })),
    student_lesson_completions: f.done.filter((c) => by(c.completed_at ?? c.skipped_at)),
    discount_requests: requests,
    discount_feedback_questions: QUESTIONS,
    discount_feedback_responses: f.answers.filter((a) => requests.some((r) => r.id === a.discount_request_id)),
    team_members: TEAM,
    student_whop_sync: f.synced.filter((s) => by(s.last_sync_at)),
    tasks: f.tasks.filter((x) => by(x.completed_at ?? x.created_at)),
  })
  db.shuffle = shuffle
  return db
}

// ── The PRD's paths ────────────────────────────────────────────────────────
const main = fixtures()
{
  const { person, watched, request } = main
  // A: shared window (first payment 2 Oct), all 61 done, pending, ads verified.
  // Two action items among the 61: one handed in with its Discord link, one only watched.
  person('s-a', 'Ana Example', '2026-10-02T10:00:00.000Z', {
    ad_submissions_verified: true, discord_user_id: '100000000000000001', discord_username: 'ana.example',
  })
  watched('s-a', REQUIRED, FROM_WHOP, {
    a3l17: { action_completed_at: '2026-10-20T08:00:00.000Z', discord_message_link: 'https://discord.com/channels/1/2/3' },
  })
  request('s-a', 'r-a', '2026-10-20T10:00:00.000Z')
  main.answers.push(
    { discount_request_id: 'r-a', question_id: 'q3', answer_choice: 'A friend' },
    { discount_request_id: 'r-a', question_id: 'q1', answer_scale: 9 },
    { discount_request_id: 'r-a', question_id: 'q2', answer_text: 'More examples of hooks' },
  )
  // B: shared window, 50 done, nothing asked. Its Whop backfill ran before the switch.
  person('s-b', 'Bo Example', '2026-10-03T10:00:00.000Z', { synced: '2026-10-18T10:00:00.000Z', discord_username: 'bo.example' })
  watched('s-b', REQUIRED.slice(0, 50), FROM_WHOP)
  main.tasks.push(
    { student_id: 's-b', scenario_id: 'nolessons.day3', status: 'completed', created_at: '2026-10-11T08:00:00.000Z', completed_at: '2026-10-12T09:00:00.000Z', completed_by: 'tm-1', outcome: 'no_reply' },
    { student_id: 's-b', scenario_id: 'support.30close', status: 'completed', created_at: '2026-10-20T14:00:00.000Z', completed_at: '2026-10-20T14:00:00.000Z', completed_by: 'tm-1' },
  )
  // C: own window (first payment 15 Oct, after the launch), all 61 done. A dismissed task is no contact.
  person('s-c', 'Cy Example', '2026-10-15T12:00:00.000Z')
  watched('s-c', REQUIRED, '2026-10-20T18:00:00.000Z')
  main.tasks.push({ student_id: 's-c', scenario_id: 'stalled.a.day3', status: 'dismissed', created_at: '2026-10-18T08:00:00.000Z', dismissed_at: '2026-10-18T09:00:00.000Z' })
  // D: own window ending Fri 23 Oct at 10:00 in Croatia, 20 done, nothing asked.
  person('s-d', 'Di Example', '2026-10-09T08:00:00.000Z')
  watched('s-d', REQUIRED.slice(0, 20), FROM_WHOP)
  // E: first payment before 1 October, every video done. E2: the same, with a pending request.
  person('s-e', 'Ed Example', '2026-09-20T10:00:00.000Z')
  watched('s-e', REQUIRED, FROM_WHOP)
  person('s-e2', 'Em Example', '2026-09-15T10:00:00.000Z')
  request('s-e2', 'r-e2', '2026-10-21T07:30:00.000Z')
  // F: a yearly plan, shared window, 30 done.
  person('s-f', 'Fa Example', '2026-10-06T10:00:00.000Z', { whop_plan_id: YEARLY, synced: null })
  watched('s-f', REQUIRED.slice(0, 30), FROM_WHOP)
  // G: a canceled member, every video done, a pending request.
  person('s-g', 'Gi Example', '2026-10-04T10:00:00.000Z', { membership_status: 'canceled', ad_submissions_verified: true })
  watched('s-g', REQUIRED, FROM_WHOP)
  request('s-g', 'r-g', '2026-10-20T12:00:00.000Z')
  // H1: a request made after the launch, rejected. H2: a 1-8 Oct payer whose only request, made before the launch, was rejected.
  person('s-h1', 'Ha Example', '2026-10-12T09:00:00.000Z')
  watched('s-h1', REQUIRED, FROM_WHOP)
  request('s-h1', 'r-h1', '2026-10-14T10:00:00.000Z', 'rejected', { reviewed_at: '2026-10-15T09:00:00.000Z', reviewed_by: 'tm-1', rejection_reason: 'Ads not handed in' })
  person('s-h2', 'Hu Example', '2026-10-05T10:00:00.000Z')
  watched('s-h2', REQUIRED.slice(0, 40), FROM_WHOP)
  request('s-h2', 'r-h2', '2026-10-06T10:00:00.000Z', 'rejected', { reviewed_at: '2026-10-07T09:00:00.000Z', reviewed_by: 'tm-1', rejection_reason: 'Old course rule' })
  // I: own window ending Fri 23 Oct at 12:00 in Croatia; 60 done by then, the gate the next morning, then a request.
  person('s-i', 'Ivy Example', '2026-10-09T10:00:00.000Z', { ad_submissions_verified: true })
  watched('s-i', REQUIRED.slice(0, 60), '2026-10-20T10:00:00.000Z')
  watched('s-i', REQUIRED.slice(60), '2026-10-24T08:00:00.000Z')
  request('s-i', 'r-i', '2026-10-24T08:05:00.000Z')
  // K: own window ending Fri 23 Oct at 14:00 in Croatia; everything done and asked before it, judged after it.
  person('s-k', 'Kai Example', '2026-10-09T12:00:00.000Z', { ad_submissions_verified: true })
  watched('s-k', REQUIRED, '2026-10-22T18:00:00.000Z')
  request('s-k', 'r-k', '2026-10-22T18:30:00.000Z')
  // M: exempt from the team's messages, shared window, 10 done.
  person('s-m', 'Mo Example', '2026-10-07T10:00:00.000Z', { csm_exempt: true })
  watched('s-m', REQUIRED.slice(0, 10), FROM_WHOP)
  // The rule's other answers. N: no first payment on file. P: a second request after a rejected one.
  // Q: asked two days after the deadline. R: everything done, the ads not verified.
  person('s-n', 'Ny Example', null)
  request('s-n', 'r-n', '2026-10-20T09:00:00.000Z')
  person('s-p', 'Pe Example', '2026-10-03T11:00:00.000Z', { ad_submissions_verified: true })
  watched('s-p', REQUIRED, FROM_WHOP)
  request('s-p', 'r-p1', '2026-10-20T08:00:00.000Z', 'rejected', { reviewed_at: '2026-10-20T15:00:00.000Z', reviewed_by: 'tm-1', rejection_reason: 'Duplicate account' })
  request('s-p', 'r-p2', '2026-10-21T08:00:00.000Z')
  person('s-q', 'Qi Example', '2026-10-09T13:00:00.000Z', { ad_submissions_verified: true })
  watched('s-q', REQUIRED, '2026-10-22T12:00:00.000Z')
  request('s-q', 'r-q', '2026-10-25T10:00:00.000Z')
  person('s-r', 'Ro Example', '2026-10-08T10:00:00.000Z')
  watched('s-r', REQUIRED, FROM_WHOP)
  request('s-r', 'r-r', '2026-10-20T15:00:00.000Z')
  // The other tabs: T approved, U with the code added in Whop. V: approved in August, before the offer: never listed.
  person('s-t', 'Ti Example', '2026-10-02T11:00:00.000Z')
  watched('s-t', REQUIRED, FROM_WHOP)
  request('s-t', 'r-t', '2026-10-19T17:00:00.000Z', 'approved', { promo_code: 'ECOM30-TEST01', reviewed_at: '2026-10-19T18:00:00.000Z', reviewed_by: 'tm-1' })
  person('s-u', 'Ul Example', '2026-10-02T12:00:00.000Z')
  watched('s-u', REQUIRED, FROM_WHOP)
  request('s-u', 'r-u', '2026-10-19T17:30:00.000Z', 'applied', {
    promo_code: 'ECOM30-TEST02', reviewed_at: '2026-10-19T18:00:00.000Z', reviewed_by: 'tm-1', applied_at: '2026-10-20T08:00:00.000Z', applied_by: 'tm-1',
  })
  person('s-v', 'Va Example', '2026-08-15T10:00:00.000Z')
  request('s-v', 'r-v', '2026-08-20T10:00:00.000Z', 'approved', { promo_code: 'ECOM30-TEST03', reviewed_at: '2026-08-21T10:00:00.000Z' })
  // W: a shared-window student holding an approved request dated before 1 October. It is on no list, and
  // it still decides where they stand (requestCounts), so the loader must read every request a student has.
  person('s-w', 'Wu Example', '2026-10-02T12:30:00.000Z')
  watched('s-w', REQUIRED, FROM_WHOP)
  request('s-w', 'r-w', '2026-09-29T10:00:00.000Z', 'approved', { promo_code: 'ECOM30-TEST04', reviewed_at: '2026-09-29T12:00:00.000Z' })
  // J: 250 students, 61 completion rows each (15,250). The odd ones finished every video; the even ones
  // skipped one (its row has no completed_at), so they are 60 of 61. First payments 2 to 18 October.
  for (let n = 1; n <= 250; n++) {
    const id = `j-${String(n).padStart(3, '0')}`
    person(id, `Jay Example ${n}`, `2026-10-${String(2 + (n % 17)).padStart(2, '0')}T09:00:00.000Z`)
    const at = `2026-10-19T16:${String(n % 60).padStart(2, '0')}:00.000Z`
    const skipped = n % 2 === 0 ? REQUIRED[n % REQUIRED.length] : null
    watched(id, REQUIRED, at, skipped ? { [skipped]: { completed_at: null, skipped_at: at } } : {})
  }
}

// ── Both ways ──────────────────────────────────────────────────────────────
/** A verdict without its log line, which names the failed reads and is for the server's log only. */
const plain = (v) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'log'))
/** discountState as the request routes compute it, from one student's reads. */
function app(reads, now) {
  const f = factsFromReads(reads)
  if (!f.ok) return 'read-failed'
  const { firstPaidAt, lessons, completions, requests } = f.facts
  return discountState({ now, firstPaidAt, lessons, videoDoneIds: videoDoneIds(completions), requests })
}
/** The approve route's judgment of a request from one student's reads: approvalVerdict, then explainOldCourseRequest. */
function approve(reads, now, request) {
  const raw = approvalVerdict(reads, now, request.askedAt, request.id, RESET)
  return { raw: plain(raw), said: plain(!raw.ok && raw.status === 400 ? explainOldCourseRequest(raw, request.askedAt, RESET) : raw) }
}
/** The PRD's population for Can still earn, written out here rather than taken from the code under test. */
const inOffer = (s) => s.first_paid_at != null && Date.parse(s.first_paid_at) >= Date.parse(DISCOUNT_ELIGIBLE_FROM)
  && (s.membership_status === 'active' || s.membership_status === 'past_due') && s.csm_exempt !== true
const KEEP = new Set([...REQUIRED, ...ACTION])
const sortBy = (k) => (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0)
const sorted = (list, k) => (list ? [...list].sort(sortBy(k)) : list)
const views = []

/**
 * Every student both ways at `nowIso`: the reads, the state, every pending
 * request's verdict, and Can still earn. Returns the differences, which must be
 * none, the view and the number of reads the bulk path made. `skip`: students
 * whose bulk reads failed on purpose, left out of the comparison. `reads`:
 * false where a read failed for everyone on purpose, so the bulk path made no
 * read after it (the answers are still compared).
 */
async function bothWays(db, nowIso, { load = loadThirtyData, skip = new Set(), reads = true } = {}) {
  const now = new Date(nowIso)
  const before = db.log.length
  const loaded = await load(fakeClient(db))
  const bulkCalls = db.log.length - before
  if (!loaded.ok) return { differences: [`the load failed: ${loaded.failed.join('; ')}`] }
  const data = loaded.data
  const view = buildThirtyView(data, now, RESET)
  views.push(view)
  const differences = []
  const per = new Map()
  for (const s of db.rows('students')) per.set(s.id, await loadDiscountReads(fakeClient(db), s.id, 'lessons'))
  for (const s of data.students) {
    if (skip.has(s.id)) continue
    const b = data.reads.get(s.id)
    const p = per.get(s.id)
    const same = (name, x, y) => { if (!isDeepStrictEqual(x, y)) differences.push(`${s.id} ${name}`) }
    if (reads) {
      same('student read', b.student, p.student)
      same('lessons read', b.lessons, p.lessons)
      same('videos read', sorted(b.videos.data, 'lesson_id'), sorted(p.videos.data, 'lesson_id'))
      same('requests read', sorted(b.requests.data, 'id'), sorted(p.requests.data, 'id'))
      same('completions read', sorted(b.completions.data, 'lesson_id'), sorted(p.completions.data?.filter((c) => KEEP.has(c.lesson_id)), 'lesson_id'))
    }
    same('state', app(b, now), app(p, now))
  }
  for (const r of view.requests.filter((x) => x.status === 'pending')) {
    if (skip.has(r.student.id)) continue
    const jb = approve(data.reads.get(r.student.id), now, r)
    const jp = approve(per.get(r.student.id), now, r)
    if (!isDeepStrictEqual(jb, jp)) differences.push(`${r.id} verdict`)
    // The page's verdict is that answer, then the ads check.
    const rule = jp.said
    const reason = rule.ok ? (r.student.adsVerified ? null : 'ads') : rule.status === 500 ? 'read-failed' : (rule.reason ?? 'unknown')
    if (r.verdict.ok !== (rule.ok && r.student.adsVerified) || r.verdict.reason !== reason
        || r.verdict.oldCourse !== (!jp.raw.ok && rule.error !== jp.raw.error)) {
      differences.push(`${r.id} the page's verdict`)
    }
  }
  const expected = db.rows('students').filter(inOffer).filter((s) => !skip.has(s.id))
    .filter((s) => ['locked', 'ready'].includes(app(per.get(s.id), now).kind)).map((s) => s.id).sort()
  const listed = view.canStillEarn.map((r) => r.student.id).sort()
  if (!isDeepStrictEqual(listed, expected)) differences.push(`can still earn: ${listed.length} listed, ${expected.length} expected`)
  for (const row of view.canStillEarn) {
    const st = app(per.get(row.student.id), now)
    if (!st.kind) continue
    const left = st.kind === 'locked' ? st.lessonsLeft : 0
    if (row.state !== st.kind || row.facts.videosTotal !== st.lessonsTotal || row.facts.videosDone !== st.lessonsTotal - left
        || row.facts.secondsLeft !== (st.kind === 'locked' ? st.secondsLeft : 0) || row.facts.deadline !== st.endsAt || row.facts.window !== st.window) {
      differences.push(`${row.student.id} can still earn row`)
    }
  }
  return { view, data, differences, bulkCalls, per }
}

const request = (view, id) => view.requests.find((r) => r.id === id)
const earning = (view, id) => view.canStillEarn.find((r) => r.student.id === id)

/** "The verdict says yes exactly when the shown count is full", but for the two refusals about how the request was made. */
function countMatchesVerdict(view) {
  return view.requests.filter((r) => r.status === 'pending' && !['late-request', 'another-request'].includes(r.verdict.reason))
    .filter((r) => (r.verdict.ok || r.verdict.reason === 'ads') !== (r.facts.videosTotal > 0 && r.facts.videosDone === r.facts.videosTotal))
    .map((r) => r.id)
}

// ── The helpers the page uses ──────────────────────────────────────────────
console.log('\n=== Dates in Croatia, plans ===')
ok(dayLabel('2026-10-16T10:00:00.000Z') === 'Fri 16 Oct', 'a day reads "Fri 16 Oct"')
ok(dayLabel(DISCOUNT_ELIGIBLE_FROM) === 'Thu 1 Oct', 'the first day of the offer reads Thu 1 Oct, where UTC says 30 September', DISCOUNT_ELIGIBLE_FROM)
ok(deadlineLabel(DISCOUNT_SHARED_DEADLINE) === 'Fri 23 Oct, 23:59 (Croatia time)', 'the shared deadline reads "Fri 23 Oct, 23:59 (Croatia time)", where UTC says 21:59', deadlineLabel(DISCOUNT_SHARED_DEADLINE))
ok(deadlineLabel('2026-10-26T15:30:27.000Z') === 'Mon 26 Oct, 16:30 (Croatia time)' && deadlineLabel('2026-10-25T22:30:00.000Z') === 'Sun 25 Oct, 23:30 (Croatia time)',
   'after the clocks go back on 25 October, Croatia is one hour ahead of UTC, not two')
ok(dayLabel('2026-09-15T10:00:00.000Z') === 'Tue 15 Sep', 'September is "Sep" on every machine (Intl\'s en-GB says "Sept")')
ok(dayLabel(null) === '' && dayLabel('not a date') === '' && deadlineLabel(undefined) === '', 'no date, or one that does not parse: an empty string')
ok(planLabel(MONTHLY) === 'Monthly' && planLabel('plan_fMMqxAljrzu75') === 'Yearly' && planLabel(YEARLY) === 'Yearly'
     && planLabel('plan_somethingelse') === 'Other plan' && planLabel(null) === 'Other plan' && YEARLY_WHOP_PLAN_IDS.size === 2,
   'Monthly, the two yearly plans, and every other plan or none')
ok(!whopPulled(null, RESET) && !whopPulled('2026-10-19T14:32:59.000Z', RESET) && whopPulled(RESET, RESET) && whopPulled('2026-10-01T00:00:00.000Z', null),
   'Whop progress pulled: a backfill at or after the switch; none, or one before it, is not')

console.log('\n=== The stand-in caps a read at 1000 rows, as PostgREST does ===')
{
  const db = world(main, WED)
  const all = db.rows('student_lesson_completions').length
  const plainRead = await fakeClient(db).from('student_lesson_completions').select('student_id, lesson_id')
  const pageOf = (from, to) => fakeClient(db).from('student_lesson_completions').select('student_id').order('student_id').order('lesson_id').range(from, to)
  const last = await pageOf(all - 30, all + 969)
  const wide = await pageOf(0, 1999)
  ok(all > 15250 && plainRead.data.length === MAX_ROWS && MAX_ROWS === 1000, `${all} completions in the table, a read without pages gets ${plainRead.data.length}`)
  ok(last.data.length === 30 && wide.data.length === MAX_ROWS, `the last page gets the ${last.data.length} rows left; a page asking for 2000 gets ${wide.data.length}`)
}

// ── Wednesday 21 October ───────────────────────────────────────────────────
console.log('\n=== Wed 21 Oct: every student both ways ===')
const wedDb = world(main, WED)
const W = await bothWays(wedDb, WED)
ok(W.differences.length === 0, `the bulk path and loadDiscountReads agree on the reads, the state and every verdict, for all ${W.data?.students.length} students`,
   W.differences.slice(0, 6).join(', '))
ok(W.bulkCalls < 60, `the bulk path made ${W.bulkCalls} reads, where one student at a time makes ${5 * W.data.students.length}`)
const wv = W.view
ok(wv.requiredCount === 61 && wv.sharedDeadline === DISCOUNT_SHARED_DEADLINE && wv.unchecked === 0 && wv.generatedAt === WED,
   'the course asks for 61 videos, the shared deadline, nobody unread, the moment it was built', show({ n: wv.requiredCount, unchecked: wv.unchecked }))
ok(show(wv.questions) === show([
  { id: 'q1', orderNum: 1, text: 'How likely are you to recommend the course?' },
  { id: 'q2', orderNum: 2, text: 'What should the course add?' },
  { id: 'q3', orderNum: 3, text: 'Where did you hear about us?' },
]), 'the survey\'s questions, in their order')
ok(wv.requests.map((r) => r.id).join() === 'r-p2,r-e2,r-r,r-g,r-a,r-n,r-p1,r-u,r-t,r-h1,r-h2',
   'listed: every pending request and every decided one from 1 October on, newest first (r-v from August and r-w from September are not)', wv.requests.map((r) => r.id).join())
ok(!W.data.students.some((s) => s.id === 's-e' || s.id === 's-v') && W.data.students.some((s) => s.id === 's-e2') && W.data.students.some((s) => s.id === 's-n'),
   'read: everyone with a first payment from 1 October, and the holders of listed requests from before it or with none')

{
  const a = request(wv, 'r-a')
  ok(a.status === 'pending' && a.verdict.ok && a.verdict.reason === null && a.verdict.text === VERDICT_TEXT.yes && !a.verdict.oldCourse,
     'A: shared window, all 61 done, pending: the verdict is yes', show(a.verdict))
  ok(a.facts.videosDone === 61 && a.facts.videosTotal === 61 && a.facts.window === 'shared' && a.facts.deadline === DISCOUNT_SHARED_DEADLINE
       && !a.facts.deadlinePassed && !a.facts.countedByDeadline && a.facts.secondsLeft === 0 && a.facts.firstPaidAt === '2026-10-02T10:00:00.000Z',
     'A: "Videos 61 of 61", deadline Fri 23 Oct, not passed', show(a.facts))
  ok(show(a.submissions) === show([
    { lessonId: 'a3l17', title: 'Your First Boss Battle', handedIn: true, link: 'https://discord.com/channels/1/2/3' },
    { lessonId: 'a3l25', title: "[ACTION ITEM] Congrats! Here's another one", handedIn: false, link: null },
  ]), 'A: the action items it has a row for: one handed in with its link, one watched and not handed in', show(a.submissions))
  ok(show(a.answers) === show([{ questionId: 'q1', answer: 9 }, { questionId: 'q2', answer: 'More examples of hooks' }, { questionId: 'q3', answer: 'A friend' }]),
     'A: the survey answers in the questions\' order, the scale as a number', show(a.answers))
  ok(show(a.student) === show({
    id: 's-a', name: 'Ana Example', email: 's-a@example.com', discord: { userId: '100000000000000001', username: 'ana.example' },
    plan: 'Monthly', status: 'active', csmExempt: false, adsVerified: true, whopPulled: true,
  }), 'A: the student as the row shows them', show(a.student))
}
{
  const b = earning(wv, 's-b')
  const left = REQUIRED.slice(50)
  ok(b?.state === 'locked' && b.facts.videosDone === 50 && b.facts.videosTotal === 61 && b.facts.secondsLeft === secondsOf(left)
       && b.facts.deadline === DISCOUNT_SHARED_DEADLINE && b.facts.window === 'shared',
     `B: shared window, 11 videos left before the deadline: can still earn, locked, 50 of 61, ${secondsOf(left)} seconds left`, show(b?.facts))
  ok(b?.student.whopPulled === false && b.student.discord.username === 'bo.example' && b.student.discord.userId === null,
     'B: its only Whop backfill ran before the switch: "Whop progress not pulled yet"; reached by @name')
  ok(show(b?.lastContact) === show({ at: '2026-10-20T14:00:00.000Z', by: { id: 'tm-1', name: 'Robin Test' }, scenarioId: 'support.30close', outcome: null }),
     'B: the last contact is its newest completed task, with who sent it, no reply yet', show(b?.lastContact))
}
{
  const c = earning(wv, 's-c')
  ok(c?.state === 'ready' && c.facts.window === 'own' && c.facts.deadline === '2026-10-29T12:00:00.000Z' && c.facts.videosDone === 61
       && c.facts.secondsLeft === 0 && c.lastContact === null,
     'C: own window (first payment 15 Oct), every video done: can still earn, ready, deadline 29 Oct; a dismissed task is no contact', show(c))
}
ok(earning(wv, 's-d')?.state === 'locked', 'D on Wednesday: 20 of 61, its 14 days still open: can still earn')
ok(app(W.per.get('s-e'), new Date(WED)).reason === 'before-launch' && !earning(wv, 's-e'),
   'E: first payment 20 September: not eligible, on no list')
{
  const e2 = request(wv, 'r-e2')
  ok(e2.verdict.reason === 'before-launch' && !e2.verdict.ok && e2.verdict.text === 'The first payment was before Thu 1 Oct, so this student cannot earn the 30%.'
       && e2.facts.window === null && e2.facts.deadline === null,
     'E2: the same with a pending request: To decide says the first payment was before Thu 1 Oct', e2.verdict.text)
}
ok(earning(wv, 's-f')?.student.plan === 'Yearly' && earning(wv, 's-f')?.state === 'locked' && earning(wv, 's-f')?.student.whopPulled === false,
   'F: a yearly plan is listed, labelled "Yearly"; no Whop backfill at all: not pulled')
ok(request(wv, 'r-g').verdict.ok && approve(W.per.get('s-g'), new Date(WED), request(wv, 'r-g')).said.ok && !earning(wv, 's-g'),
   'G: a canceled member\'s request after every video: yes both ways, and not on Can still earn')
{
  const h1 = request(wv, 'r-h1')
  ok(h1.status === 'rejected' && h1.verdict === null && h1.submissions === null && show(h1.reviewedBy) === show({ id: 'tm-1', name: 'Robin Test' })
       && h1.rejectionReason === 'Ads not handed in' && app(W.per.get('s-h1'), new Date(WED)).kind === 'rejected' && !earning(wv, 's-h1'),
     'H1: rejected after the launch: on the Rejected list with who decided it, and not on Can still earn')
  ok(h1.facts.videosDone === 61 && h1.facts.countedByDeadline === false, 'H1: its row still shows the videos, as the student app counts them')
}
ok(earning(wv, 's-h2')?.state === 'locked' && earning(wv, 's-h2')?.facts.videosDone === 40 && request(wv, 'r-h2')?.status === 'rejected',
   'H2: a 1-8 Oct payer whose only request (before the launch) was rejected: listed by progress, 40 of 61')
ok(app(W.per.get('s-m'), new Date(WED)).kind === 'locked' && !earning(wv, 's-m'), 'M: exempt: locked by the rule, and not on Can still earn')
ok(request(wv, 'r-n').verdict.reason === 'no-payment' && request(wv, 'r-n').verdict.text === VERDICT_TEXT.noPayment, 'no first payment on file: the verdict says so')
ok(request(wv, 'r-p2').verdict.reason === 'another-request' && request(wv, 'r-p2').facts.videosDone === 61,
   'a second request after a rejected one: refused as another request, every video done')
ok(request(wv, 'r-r').verdict.reason === 'ads' && !request(wv, 'r-r').verdict.ok && request(wv, 'r-r').verdict.text === VERDICT_TEXT.ads,
   'every video done, ads not verified: the rule says yes, the verdict waits for the ads tick')
{
  const t = request(wv, 'r-t')
  const u = request(wv, 'r-u')
  ok(t.status === 'approved' && t.promoCode === 'ECOM30-TEST01' && u.status === 'applied' && u.appliedAt === '2026-10-20T08:00:00.000Z'
       && show(u.appliedBy) === show({ id: 'tm-1', name: 'Robin Test' }) && t.verdict === null,
     'approved with its code; code added in Whop with who marked it')
}
ok(app(W.per.get('s-w'), new Date(WED)).kind === 'approved' && app(W.data.reads.get('s-w'), new Date(WED)).kind === 'approved' && !earning(wv, 's-w'),
   'W: an approved request from before 1 October still decides, both ways: the loader reads every request a student has, not only the listed ones')
{
  const jays = wv.canStillEarn.filter((r) => r.student.id.startsWith('j-'))
  ok(jays.length === 250 && jays.filter((r) => r.state === 'ready').length === 125
       && jays.filter((r) => r.state === 'locked').every((r) => r.facts.videosDone === 60 && r.facts.videosTotal === 61),
     'J: all 250 listed, 125 ready and 125 at 60 of 61, read from 15,250 completion rows in pages')
}
{
  const list = wv.canStillEarn
  const inOrder = list.every((r, i) => i === 0 || Date.parse(list[i - 1].facts.deadline) < Date.parse(r.facts.deadline)
    || (list[i - 1].facts.deadline === r.facts.deadline
        && list[i - 1].facts.videosTotal - list[i - 1].facts.videosDone <= r.facts.videosTotal - r.facts.videosDone))
  ok(inOrder && list[0].facts.deadline === '2026-10-23T08:00:00.000Z', 'Can still earn runs by deadline, then fewest videos left (D first: its 14 days end Friday morning)', list[0].student.id)
}
ok(countMatchesVerdict(wv).length === 0, 'every pending row: the verdict says yes exactly when the count shown is full (but for another-request and late-request)')

// ── Friday 23 October, the shared deadline's day ───────────────────────────
console.log('\n=== Fri 23 Oct at 10:00 in Croatia: D\'s 14 days end this very moment ===')
const F = await bothWays(world(main, FRI), FRI)
ok(F.differences.length === 0, 'both ways agree for every student', F.differences.slice(0, 6).join(', '))
ok(earning(F.view, 's-d')?.state === 'locked' && earning(F.view, 's-d')?.facts.deadlinePassed === false,
   'D at its deadline to the millisecond: still open (the window\'s end counts as inside it)')
ok(countMatchesVerdict(F.view).length === 0, 'the verdict says yes exactly when the count shown is full')

// ── Monday 26 October ──────────────────────────────────────────────────────
console.log('\n=== Mon 26 Oct: past the shared deadline ===')
const M = await bothWays(world(main, MON), MON)
ok(M.differences.length === 0, 'both ways agree for every student', M.differences.slice(0, 6).join(', '))
const mv = M.view
ok(app(M.per.get('s-d'), new Date(MON)).kind === 'expired' && !earning(mv, 's-d') && !earning(mv, 's-b'),
   'D: deadline passed, nothing asked: expired, gone from Can still earn (B too: the shared deadline passed)')
{
  const i = request(mv, 'r-i')
  ok(i.verdict.reason === 'locked' && i.verdict.text === VERDICT_TEXT.lockedClosed && i.facts.videosDone === 60 && i.facts.videosTotal === 61
       && i.facts.countedByDeadline && i.facts.deadlinePassed,
     'I: the gate finished the morning after the deadline does not count: 60 of 61 "done by the deadline"', show({ v: i.verdict.text, f: i.facts }))
  const later = studentAppView(M.data.reads.get('s-i'), new Date(MON))
  ok(later.facts.videosDone === 61, 'I: while the student app, which counts every video watched, says 61', show(later.facts.videosDone))
}
{
  const k = request(mv, 'r-k')
  ok(k.verdict.ok && k.facts.videosDone === 61 && k.facts.countedByDeadline,
     'K: a pending request whose deadline passed before now: judged as of the deadline, yes', show(k.verdict))
  ok(app(M.per.get('s-k'), new Date(MON)).kind === 'pending' && studentAppView(M.data.reads.get('s-k'), new Date(MON)).state.kind === 'pending',
     'K: (the student app shows the request in review)')
  const unheld = discountState({ now: new Date(MON), firstPaidAt: '2026-10-09T12:00:00.000Z', lessons: LESSONS.map((l) => ({ ...l, has_video: l.id in lengths })), videoDoneIds: new Set(REQUIRED), requests: [] })
  ok(unheld.kind === 'expired', 'K: judged on Monday\'s clock without the hold, the same student is expired: the hold is what says yes')
}
ok(request(mv, 'r-q').verdict.reason === 'late-request' && request(mv, 'r-q').facts.videosDone === 61,
   'Q: every video done by the deadline, asked two days after it: refused as late, the count still full')
ok(request(mv, 'r-a').verdict.ok && request(mv, 'r-a').facts.countedByDeadline, 'A on Monday: still yes, its count now "done by the deadline"')
ok(countMatchesVerdict(mv).length === 0, 'the verdict says yes exactly when the count shown is full')

// ── A video loaded after the switch, and requests from the old course ──────
console.log('\n=== A video loaded after the switch, and requests made on the old course ===')
{
  const LATE = REQUIRED[20]
  const late = fixtures()
  late.person('s-o1', 'Ol Example', '2026-10-02T10:00:00.000Z', { ad_submissions_verified: true })
  late.request('s-o1', 'r-o1', '2026-10-06T10:00:00.000Z')
  late.person('s-o2', 'Oz Example', '2026-10-03T10:00:00.000Z', { ad_submissions_verified: true })
  late.watched('s-o2', REQUIRED.filter((id) => id !== LATE), FROM_WHOP)
  late.request('s-o2', 'r-o2', '2026-10-20T10:00:00.000Z')
  late.person('s-o3', 'Oa Example', '2026-10-02T11:00:00.000Z', { ad_submissions_verified: true })
  late.watched('s-o3', REQUIRED, FROM_WHOP)
  late.request('s-o3', 'r-o3', '2026-10-06T11:00:00.000Z')
  late.person('s-o4', 'Ob Example', '2026-10-04T10:00:00.000Z')
  late.watched('s-o4', REQUIRED.filter((id) => id !== LATE), FROM_WHOP)
  const THU = '2026-10-22T09:00:00.000Z'
  const videos = Object.keys(lengths).map((lesson_id) => ({ lesson_id, created_at: lesson_id === LATE ? '2026-10-21T12:00:00.000Z' : LOADED }))
  const L2 = await bothWays(world(late, THU, { videos }), THU)
  ok(L2.differences.length === 0, 'both ways agree for every student', L2.differences.join(', '))
  const v = L2.view
  const o1 = request(v, 'r-o1')
  ok(o1.verdict.reason === 'locked' && o1.verdict.oldCourse && o1.verdict.text === `${VERDICT_TEXT.oldCourse} ${VERDICT_TEXT.lockedOpen}`
       && o1.facts.videosTotal === 60 && o1.facts.videosDone === 0,
     'asked on the old dashboard, nothing watched: "Asked on the old course", judged by the 60 videos there were at the switch', show({ t: o1.verdict.text, f: o1.facts }))
  const o2 = request(v, 'r-o2')
  ok(o2.verdict.ok && o2.facts.videosTotal === 60 && o2.facts.videosDone === 60 && studentAppView(L2.data.reads.get('s-o2'), new Date(THU)).facts.videosTotal === 61,
     'asked before the late video was loaded, every other video done: yes, 60 of 60, while the student app now asks for 61')
  ok(request(v, 'r-o3').verdict.ok && !request(v, 'r-o3').verdict.oldCourse, 'asked on the old dashboard, every video done: yes')
  ok(earning(v, 's-o4')?.facts.videosTotal === 61 && earning(v, 's-o4')?.facts.videosDone === 60 && v.requiredCount === 61,
     'Can still earn counts the late video: 60 of 61')
  ok(countMatchesVerdict(v).length === 0, 'the verdict says yes exactly when the count shown is full')

  const early = fixtures()
  early.person('s-o5', 'Oc Example', '2026-10-02T10:00:00.000Z')
  early.watched('s-o5', REQUIRED, FROM_WHOP)
  early.request('s-o5', 'r-o5', '2026-10-06T10:00:00.000Z')
  const allLate = Object.keys(lengths).map((lesson_id) => ({ lesson_id, created_at: '2026-10-20T00:00:00.000Z' }))
  const L3 = await bothWays(world(early, THU, { videos: allLate }), THU)
  ok(L3.differences.length === 0 && request(L3.view, 'r-o5').verdict.reason === 'no-gate' && request(L3.view, 'r-o5').verdict.text === VERDICT_TEXT.oldCourseNoGate,
     'asked on the old dashboard when no video was loaded yet: the old-course sentence, judge it by hand', request(L3.view, 'r-o5').verdict.text)
}

// ── L: a read that fails ───────────────────────────────────────────────────
console.log('\n=== L: a failed batch of completions ===')
{
  const db = world(main, WED)
  // The batch of 100 ids that holds A: j-201 to j-250 and every s- student. Only the bulk read is
  // failed (`student_id in (...)`); one student's read (`student_id=...`) still answers.
  db.failWhen = (q) => q.table === 'student_lesson_completions' && q.filters.some((f) => f.startsWith('student_id in (') && f.includes('s-a'))
    ? { message: 'canceling statement due to statement timeout' } : null
  const loaded = await loadThirtyData(fakeClient(db))
  const covered = loaded.data.students.map((s) => s.id).filter((id) => id >= 'j-201')
  ok(covered.length === 50 + loaded.data.students.filter((s) => s.id.startsWith('s-')).length
       && covered.every((id) => loaded.data.reads.get(id).completions.data === null && /statement timeout/.test(loaded.data.reads.get(id).completions.error.message))
       && loaded.data.reads.get('j-200').completions.data.length === 61,
     `the failed read is a failed read for each of the ${covered.length} students it covered, never an empty list; j-200, in the batch before, is read`)
  const view = buildThirtyView(loaded.data, new Date(WED), RESET)
  const a = request(view, 'r-a')
  ok(a.verdict.reason === 'read-failed' && !a.verdict.ok && a.verdict.text === VERDICT_TEXT.readFailed && a.facts.videosDone === null
       && a.facts.deadline === DISCOUNT_SHARED_DEADLINE && a.submissions === null,
     'A: a read-failed verdict, no count, the deadline still shown, no submissions (never "none handed in")', show({ v: a.verdict.reason, f: a.facts }))
  ok(!view.canStillEarn.some((r) => covered.includes(r.student.id)) && view.canStillEarn.length === 200,
     'no Can still earn row for anyone it covered; the 200 read before it are there')
  const candidates = loaded.data.students.filter((s) => covered.includes(s.id) && inOffer(s)).length
  ok(view.unchecked === candidates && candidates > 50, `the page is told ${view.unchecked} members could not be checked`)
  const rest = await bothWays(db, WED, { skip: new Set(covered) })
  ok(rest.differences.length === 0, 'everyone outside the failed batch: the same both ways', rest.differences.slice(0, 6).join(', '))
}
{
  const db = world(main, WED)
  db.fail['lessons.select'] = { message: 'relation "lessons" does not exist' }
  const R = await bothWays(db, WED, { reads: false })
  const pending = R.view.requests.filter((r) => r.status === 'pending')
  ok(R.differences.length === 0 && pending.length > 0 && pending.every((r) => r.verdict.reason === 'read-failed')
       && R.view.canStillEarn.length === 0 && R.view.requiredCount === null && R.view.unchecked === R.data.students.filter(inOffer).length,
     'no catalog: every verdict is read-failed both ways, Can still earn has nobody and says how many it could not check', show({ unchecked: R.view.unchecked }))
}
{
  const db = world(main, WED)
  db.failWhen = (q) => q.table === 'discount_requests' && q.filters.some((f) => f.startsWith('student_id in (') && f.includes('s-w'))
    ? { message: 'connection reset' } : null
  const loaded = await loadThirtyData(fakeClient(db))
  const view = buildThirtyView(loaded.data, new Date(WED), RESET)
  ok(loaded.data.reads.get('s-w').requests.data === null && !earning(view, 's-w') && request(view, 'r-a').verdict.reason === 'read-failed'
       && earning(view, 'j-001')?.state === 'ready',
     'a failed batch of every request a student has: their state is unknown, so they are on no list (W is not shown as ready)')
}
for (const table of ['students', 'discount_requests', 'discount_feedback_questions', 'discount_feedback_responses', 'team_members', 'student_whop_sync', 'tasks']) {
  const db = world(main, WED)
  db.fail[`${table}.select`] = { message: 'permission denied' }
  const loaded = await loadThirtyData(fakeClient(db))
  ok(loaded.ok === false && loaded.failed.some((f) => f.startsWith(table) && f.includes('permission denied')),
     `${table} cannot be read: the load fails and names it, so the page shows an error, never a list with people missing`, show(loaded.failed))
}

// ── The controls ───────────────────────────────────────────────────────────
console.log('\n=== The controls: the same check on a loader that skips paging, or pages without a unique order ===')
{
  // Made here from the copy build.mjs wrote, as outreach-cutover.test.mjs makes its copies.
  const copy = fs.readFileSync(here('./_gen/thirty-data.ts'), 'utf8')
  const PAGES = 'from "./supabase-pagination.ts"'
  const ORDER = '.order("student_id")\n            .order("lesson_id"),'
  ok(copy.split(PAGES).length === 2 && copy.split(ORDER).length === 2, 'the loader has one pages import and one completions order to swap')
  fs.writeFileSync(here('./_gen/one-page.ts'), [
    '// Written by thirty-view.test.mjs for its control: a read that skips paging.',
    '// One call and no .range(), so the stand-in\'s 1000-row cap cuts it short, as PostgREST would.',
    'export async function fetchAllRowsPaginated(buildQuery: () => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {',
    '  const r = await buildQuery()',
    '  return r.error ? { data: [], error: new Error(r.error.message) } : { data: r.data ?? [], error: null }',
    '}',
    '',
  ].join('\n'))
  fs.writeFileSync(here('./_gen/thirty-data.one-page.ts'), copy.replace(PAGES, 'from "./one-page.ts"'))
  fs.writeFileSync(here('./_gen/thirty-data.no-order.ts'), copy.replace(ORDER, '.order("student_id"),'))
  const { loadThirtyData: onePage } = await import('./_gen/thirty-data.one-page.ts')
  const { loadThirtyData: noOrder } = await import('./_gen/thirty-data.no-order.ts')
  const skipped = await bothWays(world(main, WED), WED, { load: onePage })
  ok(skipped.differences.length > 100, `a loader whose reads skip paging: the check fails, ${skipped.differences.length} differences`, skipped.differences.slice(0, 3).join(', '))
  const loose = await bothWays(world(main, WED), WED, { load: noOrder })
  ok(loose.differences.length > 0, `completions paged in an order that is not unique: the check fails, ${loose.differences.length} differences`, loose.differences.slice(0, 3).join(', '))
  const steady = await bothWays(world(main, WED, { shuffle: 12345 }), WED)
  ok(steady.differences.length === 0, 'the real loader on a different shuffle: no difference')
}

// ── Words ──────────────────────────────────────────────────────────────────
console.log('\n=== Words the team reads ===')
{
  const texts = Object.values(VERDICT_TEXT)
  ok(texts.every((t) => !/—|unlock|ecomtalent/i.test(t)), 'no verdict sentence holds an em dash, "unlock" or "EcomTalent"')
  const all = views.map((v) => show(v)).join('')
  ok(!/—|unlock|ecomtalent/i.test(all), `nor does any answer built here (${views.length} of them)`)
  ok(!all.includes('tella-'), 'and no answer carries a Tella id: lesson_videos is read for its lesson id and date only')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
