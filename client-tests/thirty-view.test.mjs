// thirty-view.test.mjs: the 30% for every listed student at once, behind the
// admin's 30% page (admin rebuild PRD, work item 2; admin rebuild 2, D4 and
// D5: _admin/prds/admin-rebuild-2/admin_rebuild_2_prd.md in the workspace).
//
// loadThirtyData (src/lib/admin/thirty-data.ts) reads every request made from
// 1 October, the students holding them, their 30% facts in pages and in
// batches of 100 ids, and the coupons stored for them, and hands each student
// the DiscountReads object loadDiscountReads would have made for them;
// buildThirtyView (thirty-view.ts) runs the student app's own rule over them,
// the stored coupon first. Every fixture here runs both ways on the same
// stand-in database: the bulk path, and loadDiscountReads's five reads for one
// student at a time, which is what the approve route and the request routes
// read. The stand-in answers at most 1000 rows a read, as PostgREST does, and
// with `shuffle` on it hands rows back in no fixed order wherever a read's
// order leaves them open. The reads, the state, the counts and the verdict
// must come out the same both ways, for every listed student.
//
// The paths are the PRD's table (A to W, and J: 250 students with 15,250
// completions, each with a request waiting), on the real course: the catalog
// from course_catalog.json and a video for each lesson the development page
// has a length for (61 up to the gate, as on production). Students, names,
// dates and links are made up. Two controls then show the parity check can
// fail: the loader with a read that skips paging, and with its completions
// ordered on a key that is not unique.
import fs from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'
import { loadThirtyData } from './_gen/thirty-data.ts'
import {
  VERDICT_TEXT, buildThirtyView, couponOf, judgeRequest, studentAppView, whopPulled,
} from './_gen/thirty-view.ts'
import { approvalVerdict, couponApprovalRefusal, explainOldCourseRequest, factsFromReads, loadDiscountReads, videoDoneIds } from './_gen/discount-server.ts'
import { DISCOUNT_ELIGIBLE_FROM, DISCOUNT_SHARED_DEADLINE, discountState, requiredLessons } from './_gen/discount.ts'
import { clockLabel, dayLabel, dayTimeLabel, deadlineLabel } from './_gen/croatia-dates.ts'
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
  const f = { people: [], done: [], asked: [], answers: [], tasks: [], synced: [], coupons: [] }
  f.person = (id, name, paid, more = {}) => {
    f.people.push({
      id, name, email: `${id}@example.com`, whop_user_id: `user_${id}`, whop_plan_id: MONTHLY, whop_membership_id: `mem_dev${id.replace(/[^a-z0-9]/g, '')}`,
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
    student_membership_discounts: f.coupons,
  })
  db.shuffle = shuffle
  return db
}

// ── The PRD's paths ────────────────────────────────────────────────────────
const main = fixtures()
{
  const { person, watched, request } = main
  // A: shared window (first payment 2 Oct), all 61 done, pending, the ads ticked (since 2026-10-20 the tick decides nothing).
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
    // Two open tasks in the Tasks queue: Mark messaged on Can still earn closes them (C5).
    { id: 't-b-open-2', student_id: 's-b', scenario_id: 'stalled.discord.day5', template_id: 'tpl-s5', status: 'open', behavior_summary: 'Paid 5 days ago, never logged in', created_at: '2026-10-20T09:00:00.000Z' },
    { id: 't-b-open-1', student_id: 's-b', scenario_id: 'nolessons.day7', template_id: 'tpl-n7', status: 'open', behavior_summary: null, created_at: '2026-10-19T09:00:00.000Z' },
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
  // Q: asked two days after the deadline. R: everything done, the ads never ticked.
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
    // Each J asks the evening after: 250 requests waiting, so the bulk path reads them all.
    request(id, `r-${id}`, `2026-10-20T17:${String(n % 60).padStart(2, '0')}:00.000Z`)
  }
  // X: a request still pending from before 1 October: not listed (the page lists from 1 October, D4).
  person('s-x', 'Xi Example', '2026-09-10T10:00:00.000Z')
  request('s-x', 'r-x', '2026-09-28T10:00:00.000Z')
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
const KEEP = new Set(REQUIRED)
const sortBy = (k) => (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0)
const sorted = (list, k) => (list ? [...list].sort(sortBy(k)) : list)
const views = []

/**
 * Every listed student both ways at `nowIso`: the reads, the state and every
 * pending request's verdict. Returns the differences, which must be none, the
 * view and the number of reads the bulk path made. `skip`: students whose bulk
 * reads failed on purpose, left out of the comparison. `reads`: false where a
 * read failed for everyone on purpose, so the bulk path made no read after it
 * (the answers are still compared).
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
    // The page's verdict is that answer alone: no ads check since 2026-10-20 (Lovro).
    const rule = jp.said
    const reason = rule.ok ? null : rule.status === 500 ? 'read-failed' : (rule.reason ?? 'unknown')
    // The coupon decides first (D5); with none stored, the page's verdict is the rule's.
    const coupon = r.coupon?.discounted === true
    if (coupon ? r.verdict.reason !== 'has-discount' || r.verdict.ok
        : r.verdict.ok !== rule.ok || r.verdict.reason !== reason || r.verdict.oldCourse !== (!jp.raw.ok && rule.error !== jp.raw.error)) {
      differences.push(`${r.id} the page's verdict`)
    }
  }
  return { view, data, differences, bulkCalls, per }
}

const request = (view, id) => view.requests.find((r) => r.id === id)

/** "The verdict says yes exactly when the shown count is full", but for the two refusals about how the request was made. */
function countMatchesVerdict(view) {
  return view.requests.filter((r) => r.status === 'pending' && !['late-request', 'another-request'].includes(r.verdict.reason))
    .filter((r) => r.verdict.ok !== (r.facts.videosTotal > 0 && r.facts.videosDone === r.facts.videosTotal))
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
ok(wv.requiredCount === 61 && wv.sharedDeadline === DISCOUNT_SHARED_DEADLINE && wv.generatedAt === WED && wv.listedFrom === DISCOUNT_ELIGIBLE_FROM && wv.couponsUnread === false,
   'the course asks for 61 videos, the shared deadline, listed from 1 October, the coupons read, the moment it was built', show({ n: wv.requiredCount, from: wv.listedFrom }))
ok(Object.keys(wv).sort().join() === 'couponsUnread,generatedAt,listedFrom,requests,requiredCount,sharedDeadline',
   'no Can still earn, no survey questions, nothing unchecked in the answer (D4)', Object.keys(wv).sort().join())
const own = wv.requests.filter((r) => !r.id.startsWith('r-j-')).map((r) => r.id).join()
ok(own === 'r-h2,r-h1,r-t,r-u,r-p1,r-n,r-a,r-g,r-r,r-e2,r-p2',
   'listed: every request made from 1 October, whatever its status, oldest first; r-w (29 September), r-v (August) and r-x (pending since 28 September) are not', own)
ok(wv.requests.every((r, i) => i === 0 || Date.parse(wv.requests[i - 1].askedAt) <= Date.parse(r.askedAt)) && wv.requests.length === 261,
   'all 261 rows (the 250 J requests included) run oldest first')
ok(!W.data.students.some((s) => ['s-e', 's-v', 's-w', 's-x', 's-b', 's-m'].includes(s.id)) && W.data.students.some((s) => s.id === 's-e2') && W.data.students.some((s) => s.id === 's-n'),
   'read: only the students holding a listed request (one with a first payment before 1 October or none included), nobody else')

{
  const a = request(wv, 'r-a')
  ok(a.status === 'pending' && a.verdict.ok && a.verdict.reason === null && a.verdict.text === VERDICT_TEXT.yes && !a.verdict.oldCourse,
     'A: shared window, all 61 done, pending: the verdict is yes', show(a.verdict))
  ok(a.facts.videosDone === 61 && a.facts.videosTotal === 61 && a.facts.window === 'shared' && a.facts.deadline === DISCOUNT_SHARED_DEADLINE
       && !a.facts.deadlinePassed && !a.facts.countedByDeadline && a.facts.secondsLeft === 0 && a.facts.firstPaidAt === '2026-10-02T10:00:00.000Z',
     'A: "Videos 61 of 61", deadline Fri 23 Oct, not passed', show(a.facts))
  ok(!('submissions' in a) && !('answers' in a) && a.coupon === null,
     'A: no action items, no survey answers on the row (D4), and no coupon stored', Object.keys(a).join())
  ok(show(a.student) === show({ id: 's-a', name: 'Ana Example', email: 's-a@example.com', username: 'ana.example', status: 'active', whopPulled: true }),
     'A: the student as the row\'s top line shows them: name, @username, membership; no plan, no ads tick', show(a.student))
}
{
  // B, C, D, E and M hold no request: Can still earn went with D4, so nobody without one is read.
  const b = studentAppView(W.per.get('s-b'), new Date(WED))
  ok(b.state.kind === 'locked' && b.facts.videosDone === 50 && b.facts.videosTotal === 61 && b.facts.secondsLeft === secondsOf(REQUIRED.slice(50))
       && !request(wv, 'r-b'), 'B: 50 of 61 by the rule, no request, on no tab')
}
ok(studentAppView(W.per.get('s-c'), new Date(WED)).state.kind === 'ready' && studentAppView(W.per.get('s-d'), new Date(WED)).state.kind === 'locked',
   'C ready and D locked by the rule, neither listed')
ok(app(W.per.get('s-e'), new Date(WED)).reason === 'before-launch', 'E: first payment 20 September: not eligible, on no list')
{
  const e2 = request(wv, 'r-e2')
  ok(e2.verdict.reason === 'before-launch' && !e2.verdict.ok && e2.verdict.text === 'The first payment was before Thu 1 Oct, so this student cannot earn the 30%.'
       && e2.facts.window === null && e2.facts.deadline === null,
     'E2: the same with a pending request: Applied says the first payment was before Thu 1 Oct', e2.verdict.text)
}
ok(request(wv, 'r-g').verdict.ok && approve(W.per.get('s-g'), new Date(WED), request(wv, 'r-g')).said.ok && request(wv, 'r-g').student.status === 'canceled',
   'G: a canceled member\'s request after every video: yes both ways, the row saying the membership is canceled')
{
  const h1 = request(wv, 'r-h1')
  ok(h1.status === 'rejected' && h1.verdict === null && h1.facts === null && show(h1.reviewedBy) === show({ id: 'tm-1', name: 'Robin Test' })
       && h1.rejectionReason === 'Ads not handed in' && app(W.per.get('s-h1'), new Date(WED)).kind === 'rejected',
     'H1: rejected after the launch: on the Rejected list with who decided it and the reason; a decided row carries no verdict and no facts')
}
ok(request(wv, 'r-h2')?.status === 'rejected' && request(wv, 'r-h2').askedAt === '2026-10-06T10:00:00.000Z',
   'H2: a request of 6 October, rejected: listed (it is from 1 October)')
ok(app(W.per.get('s-m'), new Date(WED)).kind === 'locked' && !W.data.students.some((s) => s.id === 's-m'), 'M: no request, not read')
ok(request(wv, 'r-n').verdict.reason === 'no-payment' && request(wv, 'r-n').verdict.text === VERDICT_TEXT.noPayment, 'no first payment on file: the verdict says so')
ok(request(wv, 'r-p2').verdict.reason === 'another-request' && request(wv, 'r-p2').facts.videosDone === 61,
   'a second request after a rejected one: refused as another request, every video done')
ok(request(wv, 'r-r').verdict.ok && request(wv, 'r-r').verdict.reason === null && request(wv, 'r-r').verdict.text === VERDICT_TEXT.yes,
   'R: every video done, the ads never ticked: the verdict is yes, as the rule says (it waited for the ads tick until 2026-10-20)', show(request(wv, 'r-r').verdict))
{
  const t = request(wv, 'r-t')
  const u = request(wv, 'r-u')
  ok(t.status === 'approved' && t.promoCode === 'ECOM30-TEST01' && u.status === 'applied' && u.appliedAt === '2026-10-20T08:00:00.000Z'
       && show(u.appliedBy) === show({ id: 'tm-1', name: 'Robin Test' }) && t.verdict === null,
     'approved with its code; code applied in Whop with who marked it')
}
ok(app(W.per.get('s-w'), new Date(WED)).kind === 'approved' && !request(wv, 'r-w'),
   'W: an approved request from 29 September still decides where the student stands, and is not listed (the page lists from 1 October)')
{
  const jays = wv.requests.filter((r) => r.id.startsWith('r-j-'))
  ok(jays.length === 250 && jays.filter((r) => r.verdict.ok).length === 125
       && jays.filter((r) => !r.verdict.ok).every((r) => r.verdict.reason === 'locked' && r.facts.videosDone === 60 && r.facts.videosTotal === 61),
     'J: all 250 requests judged, 125 yes and 125 at 60 of 61, read from 15,250 completion rows in pages')
}
ok(countMatchesVerdict(wv).length === 0, 'every pending row: the verdict says yes exactly when the count shown is full (but for another-request and late-request)')

// ── Friday 23 October, the shared deadline's day ───────────────────────────
console.log('\n=== Fri 23 Oct at 10:00 in Croatia: D\'s 14 days end this very moment ===')
const F = await bothWays(world(main, FRI), FRI)
ok(F.differences.length === 0, 'both ways agree for every student', F.differences.slice(0, 6).join(', '))
ok(studentAppView(F.per.get('s-d'), new Date(FRI)).state.kind === 'locked' && studentAppView(F.per.get('s-d'), new Date(FRI)).facts.deadlinePassed === false,
   'D at its deadline to the millisecond: still open (the window\'s end counts as inside it)')
ok(countMatchesVerdict(F.view).length === 0, 'the verdict says yes exactly when the count shown is full')

// ── Monday 26 October ──────────────────────────────────────────────────────
console.log('\n=== Mon 26 Oct: past the shared deadline ===')
const M = await bothWays(world(main, MON), MON)
ok(M.differences.length === 0, 'both ways agree for every student', M.differences.slice(0, 6).join(', '))
const mv = M.view
ok(app(M.per.get('s-d'), new Date(MON)).kind === 'expired' && app(M.per.get('s-b'), new Date(MON)).kind === 'expired',
   'D: deadline passed, nothing asked: expired (B too: the shared deadline passed)')
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
  const o4 = studentAppView(L2.per.get('s-o4'), new Date(THU))
  ok(o4.facts.videosTotal === 61 && o4.facts.videosDone === 60 && v.requiredCount === 61,
     'the student app counts the late video: 60 of 61, and the page asks for 61')
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
  // The read of completions that holds A (as many students as fit in one page, A among them).
  // Only the bulk read is failed (`student_id in (...)`); one student's read (`student_id=...`)
  // still answers.
  let covered = []
  db.failWhen = (q) => {
    const f = q.table === 'student_lesson_completions' ? q.filters.find((x) => x.startsWith('student_id in (')) : null
    const ids = f ? f.slice('student_id in ('.length, -1).split(',') : []
    if (!ids.includes('s-a')) return null
    covered = ids
    return { message: 'canceling statement due to statement timeout' }
  }
  const loaded = await loadThirtyData(fakeClient(db))
  const others = loaded.data.students.map((s) => s.id).filter((id) => !covered.includes(id))
  ok(covered.length > 1
       && covered.every((id) => loaded.data.reads.get(id).completions.data === null && /statement timeout/.test(loaded.data.reads.get(id).completions.error.message))
       && others.every((id) => Array.isArray(loaded.data.reads.get(id).completions.data)) && loaded.data.reads.get('j-001').completions.data.length === 61,
     `the failed read is a failed read for each of the ${covered.length} students it covered, never an empty list; the ${others.length} others are read`)
  const view = buildThirtyView(loaded.data, new Date(WED), RESET)
  const a = request(view, 'r-a')
  ok(a.verdict.reason === 'read-failed' && !a.verdict.ok && a.verdict.text === VERDICT_TEXT.readFailed && a.facts.videosDone === null
       && a.facts.deadline === DISCOUNT_SHARED_DEADLINE,
     'A: a read-failed verdict, no count (never "0 of 61"), the deadline still shown', show({ v: a.verdict.reason, f: a.facts }))
  const coveredPending = view.requests.filter((r) => r.status === 'pending' && covered.includes(r.student.id))
  ok(coveredPending.length > 1 && coveredPending.every((r) => r.verdict.reason === 'read-failed'),
     `every pending request of the ${covered.length} it covered says there is no verdict, none says no`)
  const rest = await bothWays(db, WED, { skip: new Set(covered) })
  ok(rest.differences.length === 0, 'everyone outside the failed read: the same both ways', rest.differences.slice(0, 6).join(', '))
}
{
  const db = world(main, WED)
  db.fail['lessons.select'] = { message: 'relation "lessons" does not exist' }
  const R = await bothWays(db, WED, { reads: false })
  const pending = R.view.requests.filter((r) => r.status === 'pending')
  ok(R.differences.length === 0 && pending.length > 0 && pending.every((r) => r.verdict.reason === 'read-failed') && R.view.requiredCount === null,
     'no catalog: every verdict is read-failed both ways, and the page is told the course could not be read')
}
{
  const db = world(main, WED)
  db.failWhen = (q) => q.table === 'discount_requests' && q.filters.some((f) => f.startsWith('student_id in (') && f.split(',').includes('s-a'))
    ? { message: 'connection reset' } : null
  const loaded = await loadThirtyData(fakeClient(db))
  const view = buildThirtyView(loaded.data, new Date(WED), RESET)
  ok(loaded.data.reads.get('s-a').requests.data === null && request(view, 'r-a').verdict.reason === 'read-failed'
       && request(view, 'r-j-001').verdict.ok === true,
     'a failed batch of every request a student has: their verdict is read-failed (never judged without their other requests); another batch is judged')
}
for (const table of ['students', 'discount_requests', 'team_members', 'student_whop_sync']) {
  const db = world(main, WED)
  db.fail[`${table}.select`] = { message: 'permission denied' }
  const loaded = await loadThirtyData(fakeClient(db))
  ok(loaded.ok === false && loaded.failed.some((f) => f.startsWith(table) && f.includes('permission denied')),
     `${table} cannot be read: the load fails and names it, so the page shows an error, never a list with people missing`, show(loaded.failed))
}
for (const table of ['discount_feedback_questions', 'discount_feedback_responses', 'tasks']) {
  const db = world(main, WED)
  db.fail[`${table}.select`] = { message: 'permission denied' }
  const loaded = await loadThirtyData(fakeClient(db))
  ok(loaded.ok && db.calls(table).length === 0, `${table} is not read any more (the survey and Can still earn went with D4), so it cannot fail the page`)
}
{
  const db = world(main, WED)
  db.fail['student_membership_discounts.select'] = { message: 'relation "student_membership_discounts" does not exist' }
  const loaded = await loadThirtyData(fakeClient(db))
  const view = loaded.ok ? buildThirtyView(loaded.data, new Date(WED), RESET) : null
  ok(loaded.ok && view.couponsUnread === true && view.requests.every((r) => r.coupon === null) && request(view, 'r-a').verdict.ok,
     'the stored coupons cannot be read (a database without v111): the list still comes, it says so, no row shows a coupon, the rule still judges')
}

// ── One snapshot per student ───────────────────────────────────────────────
console.log('\n=== One snapshot per student: each read of completions is a single query, and a request decided between reads is listed once ===')
/** The completions reads of a load, by their students: how many queries each list of students took. */
function completionQueries(db, from = 0) {
  const counts = new Map()
  for (const q of db.log.slice(from)) {
    if (q.table !== 'student_lesson_completions' || q.op !== 'select') continue
    const students = q.filters.find((f) => f.startsWith('student_id in ('))
    if (students) counts.set(students, (counts.get(students) ?? 0) + 1)
  }
  return counts
}
{
  const db = world(main, WED)
  await loadThirtyData(fakeClient(db))
  const counts = completionQueries(db)
  const perRead = Math.max(...[...counts.keys()].map((f) => f.split(',').length))
  const lessonFilter = db.calls('student_lesson_completions', 'select').map((q) => q.filters.find((f) => f.startsWith('lesson_id in ('))).find(Boolean)
  const lessons = lessonFilter ? lessonFilter.split(',').length : 0
  ok(counts.size > 0 && [...counts.values()].every((n) => n === 1),
     `the ${counts.size} reads of completions are one query each: no page of one read is asked for after another student's row was deleted`, show([...counts.values()]))
  ok(lessons > 60 && perRead * lessons < MAX_ROWS,
     `${perRead} students a read, at one row per student and each of the ${lessons} lessons read, fit in one page (${perRead * lessons} rows at most)`)
}
{
  // A request decided between the read of the pending ones and the read of the decided ones.
  const db = world(main, WED)
  db.failWhen = (q) => {
    if (q.table === 'discount_requests' && q.op === 'select' && q.filters.includes('status!=pending')) {
      const r = db.rows('discount_requests').find((x) => x.id === 'r-a')
      if (r.status === 'pending') Object.assign(r, { status: 'approved', promo_code: 'ECOM30-TEST05', reviewed_at: WED, reviewed_by: 'tm-1' })
    }
    return null
  }
  const loaded = await loadThirtyData(fakeClient(db))
  const view = buildThirtyView(loaded.data, new Date(WED), RESET)
  const rows = view.requests.filter((r) => r.id === 'r-a')
  ok(rows.length === 1 && rows[0].status === 'approved' && rows[0].promoCode === 'ECOM30-TEST05',
     'r-a, decided after the pending read and before the decided one: one row, as decided (never on Applied and Approved at once)', show(rows.map((r) => r.status)))
}

// ── The controls ───────────────────────────────────────────────────────────
console.log('\n=== The controls: the same checks on loaders that read completions 100 students at a time (in pages), skip paging, or page without a unique order ===')
{
  // Made here from the copy build.mjs wrote, as outreach-cutover.test.mjs makes its copies.
  const copy = fs.readFileSync(here('./_gen/thirty-data.ts'), 'utf8')
  const PAGES = 'from "./supabase-pagination.ts"'
  const ORDER = '.order("student_id")\n              .order("lesson_id"),'
  // The students a read of completions holds: as many as fit in one page. The controls put back 100,
  // which takes several pages, so paging, its order and a write between pages matter again.
  const PER_READ = 'Math.floor((PAGE_ROWS - 1) / lessonIds.length)'
  ok(copy.split(PAGES).length === 2 && copy.split(ORDER).length === 2 && copy.split(PER_READ).length === 2,
     'the loader has one pages import, one completions order and one size of read to swap')
  const hundred = copy.replace(PER_READ, 'BATCH')
  fs.writeFileSync(here('./_gen/one-page.ts'), [
    '// Written by thirty-view.test.mjs for its control: a read that skips paging.',
    '// One call and no .range(), so the stand-in\'s 1000-row cap cuts it short, as PostgREST would.',
    'export async function fetchAllRowsPaginated(buildQuery: () => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {',
    '  const r = await buildQuery()',
    '  return r.error ? { data: [], error: new Error(r.error.message) } : { data: r.data ?? [], error: null }',
    '}',
    '',
  ].join('\n'))
  fs.writeFileSync(here('./_gen/thirty-data.one-page.ts'), hundred.replace(PAGES, 'from "./one-page.ts"'))
  fs.writeFileSync(here('./_gen/thirty-data.no-order.ts'), hundred.replace(ORDER, '.order("student_id"),'))
  fs.writeFileSync(here('./_gen/thirty-data.hundred.ts'), hundred)
  const { loadThirtyData: onePage } = await import('./_gen/thirty-data.one-page.ts')
  const { loadThirtyData: noOrder } = await import('./_gen/thirty-data.no-order.ts')
  const { loadThirtyData: byHundred } = await import('./_gen/thirty-data.hundred.ts')
  const skipped = await bothWays(world(main, WED), WED, { load: onePage })
  ok(skipped.differences.length > 100, `a loader whose reads skip paging: the check fails, ${skipped.differences.length} differences`, skipped.differences.slice(0, 3).join(', '))
  const loose = await bothWays(world(main, WED), WED, { load: noOrder })
  ok(loose.differences.length > 0, `completions paged in an order that is not unique: the check fails, ${loose.differences.length} differences`, loose.differences.slice(0, 3).join(', '))
  const steady = await bothWays(world(main, WED, { shuffle: 12345 }), WED)
  ok(steady.differences.length === 0, 'the real loader on a different shuffle: no difference')

  // A completion deleted while the completions are read (skip-lesson, toggle-lesson and
  // mark-action-shipped delete rows): the first row of a read is deleted when that read is
  // asked for a second time, that is, between its pages. The student whose row went is
  // read before the delete and compared after it, so only they may differ.
  const deleteBetweenPages = (db) => {
    const seen = new Map()
    let gone = null
    db.failWhen = (q) => {
      const students = q.table === 'student_lesson_completions' && q.op === 'select' ? q.filters.find((f) => f.startsWith('student_id in (')) : null
      if (!students || gone) return null
      seen.set(students, (seen.get(students) ?? 0) + 1)
      if (seen.get(students) === 2) {
        const ids = students.slice('student_id in ('.length, -1).split(',')
        const first = db.rows('student_lesson_completions')
          .filter((c) => ids.includes(c.student_id))
          .sort((a, b) => (a.student_id < b.student_id ? -1 : a.student_id > b.student_id ? 1 : a.lesson_id < b.lesson_id ? -1 : 1))[0]
        db.tables.student_lesson_completions = db.rows('student_lesson_completions').filter((c) => c !== first)
        gone = first.student_id
      }
      return null
    }
    return () => gone
  }
  const paged = world(main, WED)
  const pagedGone = deleteBetweenPages(paged)
  const before = paged.log.length
  const P = await bothWays(paged, WED, { load: byHundred })
  const deleted = pagedGone()
  const others = P.differences.filter((d) => !d.startsWith(`${deleted} `))
  ok(deleted !== null && others.length > 0 && [...completionQueries(paged, before).values()].some((n) => n > 1),
     `read 100 students at a time in pages, a row deleted between two pages drops another student's row: the check fails for someone else, ${others.length} differences`,
     `${deleted}; ${others.slice(0, 3).join(', ')}`)
  const single = world(main, WED)
  const singleGone = deleteBetweenPages(single)
  const S = await bothWays(single, WED)
  ok(singleGone() === null && S.differences.length === 0,
     'the real loader: no read is asked for twice, so no delete lands between its pages, and every student is the same both ways', S.differences.slice(0, 3).join(', '))
}

// ── What the 30% page adds (work item 3) ───────────────────────────────────
console.log('\n=== The 30% page: no ads tick since 2026-10-20 (Lovro), C4\'s words ===')
{
  // Approve opens on the rule's yes alone: students.ad_submissions_verified is
  // not read, so the same database with every student's tick flipped builds
  // the very same answer, and every pending verdict is the rule's.
  const kept = world(main, WED)
  const flipped = world(main, WED)
  for (const s of flipped.rows('students')) s.ad_submissions_verified = s.ad_submissions_verified !== true
  const ticks = (db) => db.rows('students').map((s) => s.ad_submissions_verified === true)
  const a = await loadThirtyData(fakeClient(kept))
  const b = await loadThirtyData(fakeClient(flipped))
  const va = buildThirtyView(a.data, new Date(WED), RESET)
  const vb = buildThirtyView(b.data, new Date(WED), RESET)
  const pending = va.requests.filter((r) => r.status === 'pending')
  ok(ticks(kept).some(Boolean) && ticks(kept).some((t) => !t) && ticks(kept).every((t, i) => t !== ticks(flipped)[i]),
     'the fixtures hold ticked and unticked students, and the second database has every tick the other way')
  ok(a.ok && b.ok && isDeepStrictEqual(va, vb) && pending.length >= 5,
     `every tick flipped: the same answer, all ${pending.length} pending verdicts included`)
  const notRule = pending.filter((r) => r.verdict.ok !== approve(a.data.reads.get(r.student.id), new Date(WED), r).said.ok
    || r.verdict.ok !== judgeRequest(a.data.reads.get(r.student.id), new Date(WED), { id: r.id, created_at: r.askedAt }, RESET).verdict.ok)
  ok(notRule.length === 0 && pending.some((r) => r.verdict.ok) && pending.some((r) => !r.verdict.ok),
     'every pending verdict says yes exactly when the rule does (yes and no both among them)', notRule.map((r) => r.id).join(', '))
  const sent = show(va)
  ok(!sent.includes('adsVerified') && !sent.includes('ad_submissions') && !/\bads (are )?(not )?verified|Ads verified/i.test(sent),
     'the answer carries no ads tick and no sentence about one')
  ok(Object.values(VERDICT_TEXT).every((t) => !/\bads?\b/i.test(t)), 'no verdict sentence mentions the ads', show(Object.keys(VERDICT_TEXT)))
}
{
  const shared = { deadline: DISCOUNT_SHARED_DEADLINE, videosDone: 57, videosTotal: 61, secondsLeft: 2400 }
  ok(dayTimeLabel(DISCOUNT_SHARED_DEADLINE) === 'Fri 23 Oct, 23:59' && clockLabel('2026-10-20T08:30:00.000Z') === '10:30'
       && clockLabel('2026-10-26T09:00:00.000Z') === '10:00' && dayTimeLabel(null) === '' && clockLabel('nope') === '',
     'the deadline without the zone, and the clock, in Croatia on both sides of the clocks going back')
  // The C4 reasons and the hours left (thirtyReasonText, aboutHours and the rest) went in the review's fix round: no page showed them.
  ok(shared.videosTotal === 61, 'the shared deadline\'s facts, for the clock above')
}

// ── The coupon (admin rebuild 2, D5) ──────────────────────────────────────
console.log('\n=== The coupon decides first: a discount already on the next renewal ===')
{
  const f = fixtures()
  const mem = (id) => `mem_dev${id.replace(/[^a-z0-9]/g, '')}`
  const stored = (student, more = {}) => ({
    student_id: student, whop_membership_id: mem(student), promo_code_id: 'promo_devEvolve', promo_code: 'evolve10',
    renewal_price: '87.30', plan_renewal_price: '97.00', discounted: true, checked_at: '2026-10-21T06:40:00.000Z', ...more,
  })
  // C1: every video done, evolve10 on the membership. C2: the same, its row read from a membership it no longer has.
  // C3: a used-up code (not discounted). C4: evolve10 and 20 videos left. C5: approved before the rule, evolve10 on it.
  // C6: evolve10 whose name Whop would not give.
  for (const [id, done] of [['s-c1', 61], ['s-c2', 61], ['s-c3', 61], ['s-c4', 41], ['s-c5', 61], ['s-c6', 61]]) {
    f.person(id, `${id} Example`, '2026-10-10T10:00:00.000Z')
    f.watched(id, REQUIRED.slice(0, done), FROM_WHOP)
  }
  for (const id of ['s-c1', 's-c2', 's-c3', 's-c4', 's-c6']) f.request(id, `r-${id.slice(2)}`, '2026-10-20T10:00:00.000Z')
  f.request('s-c5', 'r-c5', '2026-10-19T10:00:00.000Z', 'approved', { promo_code: 'ECOM30-TEST06', reviewed_at: '2026-10-19T12:00:00.000Z', reviewed_by: 'tm-1' })
  f.coupons.push(
    stored('s-c1'),
    stored('s-c2', { whop_membership_id: 'mem_devSomeoneOld' }),
    stored('s-c3', { promo_code_id: 'promo_devUsed50', promo_code: 'welcome50', renewal_price: '97.00', discounted: false }),
    stored('s-c4'),
    stored('s-c5'),
    stored('s-c6', { promo_code: null, promo_code_id: 'promo_devYear10' }),
  )
  const C = await bothWays(world(f, WED), WED)
  ok(C.differences.length === 0, 'both ways agree for every student, the coupon read beside them', C.differences.join(', '))
  const c1 = request(C.view, 'r-c1')
  ok(!c1.verdict.ok && c1.verdict.reason === 'has-discount' && c1.verdict.text === 'This student already has a discount on their membership (evolve10).' && !c1.verdict.oldCourse,
     'C1: every video done, evolve10 on the membership: no, in the approve route\'s own words', show(c1.verdict))
  ok(show(c1.coupon) === show({ code: 'evolve10', promoCodeId: 'promo_devEvolve', discounted: true, ours: false, renewalPrice: 87.3, planRenewalPrice: 97, checkedAt: '2026-10-21T06:40:00.000Z' }),
     'C1: the coupon on the row, its code\'s id, not the team\'s own code, its prices as numbers (Postgres numeric reaches the route as a string)', show(c1.coupon))
  ok(approve(C.per.get('s-c1'), new Date(WED), c1).said.ok, 'C1: (the rule alone would have said yes: the coupon is what refuses)')
  ok(request(C.view, 'r-c2').verdict.ok && request(C.view, 'r-c2').coupon === null, 'C2: a row read from another membership says nothing: the rule\'s yes, no coupon')
  ok(request(C.view, 'r-c3').verdict.ok && request(C.view, 'r-c3').coupon?.discounted === false && request(C.view, 'r-c3').coupon?.code === 'welcome50',
     'C3: a used-up code: the rule\'s yes, the coupon kept on the row as not discounted')
  ok(request(C.view, 'r-c4').verdict.reason === 'has-discount' && request(C.view, 'r-c4').facts.videosDone === 41,
     'C4: videos left and evolve10: the coupon\'s no, ahead of the videos\' (the count still judged)')
  ok(request(C.view, 'r-c5').status === 'approved' && request(C.view, 'r-c5').verdict === null && request(C.view, 'r-c5').coupon?.discounted === true,
     'C5: approved before the rule, evolve10 on the membership: the coupon on the row for the page to warn about')
  ok(request(C.view, 'r-c6').verdict.text === couponApprovalRefusal('promo_devYear10') && request(C.view, 'r-c6').verdict.text.endsWith('(promo_devYear10).'),
     'C6: no name from Whop: the verdict names the code\'s id')
  ok(couponOf(undefined, { whop_membership_id: 'mem_x' }) === null && couponOf(stored('s'), { whop_membership_id: 'mem_devOther' }) === null
       && couponOf(stored('s'), { whop_membership_id: null })?.discounted === true && couponOf(stored('s'), { whop_membership_id: 'pay_devX' })?.code === 'evolve10',
     'couponOf: no row, or a row from another membership: no coupon; with no membership id on file (none, or a payment\'s), the student\'s row counts (T-122: the cron wrote it through the Whop user or a payment)')
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
