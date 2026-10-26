// discount-eighty.test.mjs: the 80% rule for the 30% (the owner, 2026-10-26:
// "They have to watch 80% of the 61 videos, or whatever amount of videos we
// have, until the end of video ads 2. 80% of those, if they have watched
// them, they are eligible for the discount."), and no 30% without a real
// payment ("by his username, he never had a membership. I see one payment,
// but it has failed ... he watched the course even though he never paid").
//
//   1. the number      videosNeeded (discount.ts), the one place it is worked
//                      out: ceil(0.8 x N), held to a count made here for N
//                      from 0 to 300; 61 needs 49
//   2. the edges       48, 49 and 61 of the real course's 61: the map
//                      (discountState), the request routes' rule
//                      (decideDiscountRequest) and the approve rule
//                      (approvalVerdict) give one answer; any 49 count,
//                      nothing past the gate does
//   3. the window      49 watched and the window closed: expired, refused;
//                      the approval counts only the videos done by the deadline;
//                      a window that ended before the 80% rule (DISCOUNT_EIGHTY_FROM)
//                      keeps every video (the owner's B, 2026-10-26: "the 80%
//                      counts from today"), through approvalVerdict, the real
//                      approve route and the 30% page: the shared window's 57 of
//                      61 with an old-dashboard request, the launch's own window
//                      with a request from before it, and the window ending at
//                      the rule's first moment, which has the 80%
//   4. N other than 61 the count follows the catalog: 10 videos need 8, 5 need
//                      4, a lesson with no video loaded is not counted, and the
//                      approval counts the videos there were when the student
//                      applied
//   5. the routes      POST /api/discounts/request, POST
//                      /api/discounts/submit-feedback and POST
//                      /api/discounts/approve, the real routes on stub-server.ts's
//                      stand-in database: at 48 both request routes refuse and
//                      write nothing, at 49 and 61 each writes one request and
//                      Approve makes its one code and puts it on the student's
//                      membership (since the 30% that applies itself, T-137)
//   6. no payment      first_paid_at empty (since the first-paid fix, no real
//                      payment): no window at all, so the map offers no Apply,
//                      both request routes refuse in the map's own sentence and
//                      write nothing however much was watched, the normal
//                      Approve refuses with code "rule", Approve anyway by a
//                      founder or an admin approves it, a csm's is refused.
//                      Since the review of 2026-10-26 the owner's applicant too:
//                      first_paid_at filled (from before the first-paid fix)
//                      while Whop shows no real payment, the coupon check's
//                      stored row saying so (membership-discount.test.mjs runs
//                      Whop's live answer): refused too, nothing written,
//                      since the owner's answers of the same day in the one
//                      sentence for no paid course plan and payment ("The 30%
//                      needs a paid course plan and a payment that went
//                      through."), and the 30% page's verdict says it
//   7. the map's words discountRule and checkpointCounts: the one line, "49 of
//                      61 needed", Apply's reason; no em dash, no "unlock"; a
//                      window that closed before the 80% rule reads the rule it
//                      had (expiredRuleLine, the review of 2026-10-26), a first
//                      payment before 1 October "Your 2 weeks have passed." alone,
//                      and no closed line of a deadline before the rule names
//                      the 80%
//   8. the 30% page    the row's video line (videoLine), what Copy Discord ID
//                      and Copy username copy (studentCopies; "Copy ID" and
//                      "Copy @" until the review of 2026-10-26) with and
//                      without an id or a username, a stored "@" never
//                      doubled, the username's tip that it can be the Whop
//                      one, the line in their place with neither, and the
//                      greyed button rendered with its tip
//
// build.mjs copies the modules and the two request routes (run it first; `npm
// run test:client` does). The approve route is copied here with the team's
// login pointed at stub-admin.ts, as admin-discounts.test.mjs does, so a
// founder, an admin and a csm can press it; since the 30% that applies itself
// (T-137) its step (thirty-apply.ts, build.mjs's copy) makes the code with
// stub-admin.ts's stand-in and attaches it on a stand-in for Whop's API (the
// student's membership read and the attach; every other read gets a 503, so
// the coupon check's stored row answers it, as before). Every student, id and
// code here is made up.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  DISCOUNT_EIGHTY_FROM, DISCOUNT_SHARED_DEADLINE, DISCOUNT_VIDEO_SHARE, DISCOUNT_WINDOW_DAYS, discountState, discountWindow,
  requiredLessons, videosNeeded, videosNeededFor,
} from './_gen/discount.ts'
import { UNPAID_APPROVAL, approvalVerdict, decideDiscountRequest, discountRefusalMessage, toDiscountLessons, videoDoneIds } from './_gen/discount-server.ts'
import { checkpointCounts, checkpointView, discountRule, expiredRuleLine, liveRuleLine } from './_gen/checkpointView.ts'
import {
  NO_DISCORD_ID, NO_DISCORD_LINE, NO_USERNAME, USERNAME_NOTE, USERNAME_TIP, VERDICT_TEXT, anywaySkip, buildThirtyView, judgeRequest, studentCopies, videoLine,
} from './_gen/thirty-view.ts'
import { POST as requestRoute } from './_gen/discount-request-route.ts'
import { POST as feedbackRoute } from './_gen/discount-submit-feedback-route.ts'
import { loadThirtyData } from './_gen/thirty-data.ts'
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
import { FakeDb, fakeClient, setCatalog, steps, useDb as installDb } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
/** Words no student reads (the brief's rule for every sentence a student sees). */
const BANNED = /—|\bunlock|ecomtalent/i

/** Runs `fn` with the routes' log lines kept off the test's output. */
async function hush(fn) {
  const real = [console.info, console.warn, console.error]
  console.info = console.warn = console.error = () => {}
  try { return await fn() } finally { [console.info, console.warn, console.error] = real }
}
const RealDate = Date
/** Runs `fn` with the clock at `iso`: `new Date()` and `Date.now()` answer it. */
async function at(iso, fn) {
  const t = RealDate.parse(iso)
  class Clock extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(t)
      else super(...args)
    }
    static now() { return t }
  }
  globalThis.Date = Clock
  try { return await fn() } finally { globalThis.Date = RealDate }
}

// The approve route, its login and Whop's promo code at stub-admin.ts, as admin-discounts.test.mjs copies it.
function copyRoute(rel, out, rewrites) {
  let s = fromSrc(rel)
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${rel} has no ${from}`)
    s = s.split(from).join(to)
  }
  if (s.includes('@/')) throw new Error(`an unrewritten @/ import remains in ${rel}`)
  fs.writeFileSync(here(`./_gen/${out}`), s)
}
// Since T-137 the route's checks and its promo code live in thirty-apply.ts (build.mjs's copy, its create at stub-admin.ts).
copyRoute('src/app/api/discounts/approve/route.ts', 'eighty-approve-route.ts', [
  ['from "next/server"', 'from "./stub-server.ts"'],
  ['from "@/lib/admin-auth"', 'from "./stub-admin.ts"'],
  ['from "@/lib/thirty-apply"', 'from "./thirty-apply.ts"'],
])
const { POST: approveRoute } = await import('./_gen/eighty-approve-route.ts')
const { setTeam, promoCodes } = await import('./_gen/stub-admin.ts')

// Whop, standing in (T-137: Approve makes the code and attaches it). The student's course membership answers its
// pinned read and takes a code by its name, the code's id the one stub-admin.ts's create gave it; every other read
// (the coupon check's user list and payments) gets a 503, so the coupon check gives no answer and the stored row this
// rule wrote answers it, as it did here before. No request leaves the machine.
process.env.WHOP_API_KEY = 'whop-test-key'
process.env.WHOP_COMPANY_ID = 'biz_devCompany'
process.env.WHOP_PRODUCT_ID = 'prod_devCourse'
const whopApi = { members: new Map(), applies: [] }
const whopJson = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
/** The membership as Whop's pinned read gives it. */
const pinned = (m) => ({ id: m.id, status: 'active', user_id: 'user_1', product_id: 'prod_devCourse', plan_id: 'plan_devMonthly97', promo_code_id: m.promo, renewal_price: { amount: '97.00', currency: 'usd' }, cancel_at_period_end: false })
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  if (u.hostname !== 'api.whop.com') throw new Error(`the suite let a request go to ${u.hostname}`)
  const attach = u.pathname.match(/^\/api\/v1\/memberships\/([^/]+)\/apply_promo_code$/)
  if ((init.method ?? 'GET') === 'POST' && attach) {
    const m = whopApi.members.get(decodeURIComponent(attach[1]))
    if (!m) return whopJson(404, { error: { message: 'Membership not found.' } })
    const name = String(JSON.parse(init.body).promo_code).toLowerCase()
    const made = promoCodes.findLastIndex((p) => String(p.code).toLowerCase() === name)
    if (made < 0) return whopJson(400, { error: { message: 'Promo code not found.' } })
    m.promo = `promo_${made + 1}`
    whopApi.applies.push({ membership: m.id, promo: m.promo })
    return whopJson(200, pinned(m))
  }
  const one = u.pathname.match(/^\/api\/v1\/memberships\/([^/]+)$/)
  if (one && whopApi.members.has(decodeURIComponent(one[1]))) return whopJson(200, pinned(whopApi.members.get(decodeURIComponent(one[1]))))
  return whopJson(503, { error: { message: 'Service unavailable' } })
}

// The admin's copy button, compiled as Next compiles it (types out, JSX to react/jsx-runtime).
function compile(rel, out, rewrites = []) {
  let s = ts.transpileModule(fromSrc(rel), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${rel} has no ${from}`)
    s = s.split(from).join(to)
  }
  if (/(?:from|import)\s*["']@\//.test(s)) throw new Error(`an unrewritten @/ import remains in ${rel}`)
  fs.writeFileSync(here(`./_gen/${out}`), s)
}
const LINK = ['import Link from "next/link";', 'import { createElement as __ce } from "react"; const Link = ({ href, children, ...rest }) => __ce("a", { href, ...rest }, children);']
const UI = ['from "@/components/admin/ui"', 'from "./e8-ui.mjs"']
compile('src/components/admin/ui.tsx', 'e8-ui.mjs', [LINK])
compile('src/components/admin/review-parts.tsx', 'e8-review-parts.mjs', [LINK, UI, ['from "@/lib/admin/read-failure"', 'from "./read-failure.ts"']])
compile('src/components/admin/list-parts.tsx', 'e8-list-parts.mjs', [UI, ['from "@/components/admin/review-parts"', 'from "./e8-review-parts.mjs"']])
const { CopyButton } = await import('./_gen/e8-list-parts.mjs')

// ── The real course, as the switch leaves it in `lessons` ─────────────────
const json = (rel) => JSON.parse(fs.readFileSync(here(rel), 'utf8'))
const catalog = json('../supabase/catalog/course_catalog.json')
const lengths = json('../src/app/dev/world-app/course-lengths.fixture.json')
const LESSONS = catalog.lessons.map((l, i) => ({
  id: l.id, type: l.type, sort_order: i + 1, counts_toward_progress: l.counts !== false,
  is_gate: l.gate === true, duration_seconds: lengths[l.id] ?? null,
}))
const COURSE = toDiscountLessons(LESSONS, new Set(Object.keys(lengths)))
const REQUIRED = requiredLessons(COURSE).map((l) => l.id)
const AFTER_GATE = COURSE.slice(COURSE.findIndex((l) => l.is_gate) + 1).map((l) => l.id)

const okRead = (data) => ({ data, error: null })
/** One student's five reads (loadDiscountReads's shape), on the real course unless told otherwise. */
const reads = ({ paid, done = [], lessons = LESSONS, videos = Object.keys(lengths).map((lesson_id) => ({ lesson_id, created_at: '2026-10-12T00:00:00.000Z' })), requests = [] }) => ({
  student: okRead({ first_paid_at: paid }),
  lessons: okRead(lessons.map(({ id, type, counts_toward_progress, is_gate, duration_seconds }) => ({ id, type, counts_toward_progress, is_gate, duration_seconds }))),
  videos: okRead(videos),
  completions: okRead(done),
  requests: okRead(requests),
})
/** Completion rows for `ids`, done at `when`. */
const rowsOf = (ids, when) => ids.map((lesson_id) => ({ lesson_id, completed_at: when }))
/** What the map shows for those reads at `now` (useWorldDiscount: discountState over the same facts). */
function mapOf(r, now) {
  const videos = new Set(r.videos.data.map((v) => v.lesson_id))
  return discountState({
    now, firstPaidAt: r.student.data.first_paid_at, lessons: toDiscountLessons(r.lessons.data, videos),
    videoDoneIds: videoDoneIds(r.completions.data), requests: r.requests.data,
  })
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 1. The number: videosNeeded, 80% of the videos rounded up ===')
{
  // Counted here another way: the least k with k / n at or above 80%.
  const least = (n) => { let k = 0; while (k * 100 < n * 80) k++; return k }
  const off = []
  for (let n = 0; n <= 300; n++) if (videosNeeded(n) !== least(n)) off.push(`${n}: ${videosNeeded(n)} not ${least(n)}`)
  ok(off.length === 0, 'for every N from 0 to 300 it is the least count at or above 80%', off.slice(0, 5).join(', '))
  ok(DISCOUNT_VIDEO_SHARE === 80, 'the share is 80, one constant')
  ok(videosNeeded(61) === 49 && videosNeeded(60) === 48 && videosNeeded(10) === 8 && videosNeeded(5) === 4 && videosNeeded(3) === 3 && videosNeeded(1) === 1,
     '61 needs 49 (48.8 up), 60 needs 48, 10 need 8, 5 need 4, 3 need 3, 1 needs 1')
  ok(videosNeeded(0) === 0 && videosNeeded(-4) === 0 && videosNeeded(2.5) === 0 && videosNeeded(Number.NaN) === 0,
     'nothing for no videos, or a count that is not a whole number')
  ok(REQUIRED.length === 61 && REQUIRED.at(-1) === 'a4l17', 'the real course counts 61 videos, up to its gate a4l17', `${REQUIRED.length}`)
  // Every reader takes the number from videosNeededFor, the window's rule (the owner's B, 2026-10-26): discount.ts
  // through discountState, the 30% page through countFacts; videosNeededFor alone works out the 80%, by videosNeeded.
  const discountSrc = fromSrc('src/lib/world/discount.ts')
  const viewSrc = fromSrc('src/lib/admin/thirty-view.ts')
  ok(/const needed = videosNeededFor\(required\.length, open\.endsAt\);/.test(discountSrc)
       && /const needed = endsAt \? videosNeededFor\(required\.length, endsAt\) : videosNeeded\(required\.length\);/.test(viewSrc)
       && /export function videosNeededFor[\s\S]*?\? total : videosNeeded\(total\);\n}/.test(discountSrc)
       && !/0\.8\b|\* 80\b/.test(discountSrc.replace(/export function videosNeeded\([\s\S]*?\n}\n/, '')) && !/0\.8\b/.test(viewSrc),
     'in the source: the rule and the 30% page both call videosNeededFor at the window\'s end, and no other line works out 80%')
  const at = (iso) => new RealDate(iso)
  ok(videosNeededFor(61, at(DISCOUNT_EIGHTY_FROM)) === 49 && videosNeededFor(61, at('2026-10-25T22:59:59.999Z')) === 61
       && videosNeededFor(61, at(DISCOUNT_SHARED_DEADLINE)) === 61 && videosNeededFor(61, at('2026-11-05T09:00:00.000Z')) === 49
       && videosNeededFor(3, at('2026-11-05T09:00:00.000Z')) === 3 && videosNeededFor(0, at(DISCOUNT_SHARED_DEADLINE)) === 0 && videosNeededFor(2.5, at(DISCOUNT_SHARED_DEADLINE)) === 0,
     'videosNeededFor: a window ending at the rule\'s first moment or later needs 49 of 61; the millisecond before it, and the shared deadline, all 61; none for no videos')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 2. The edges on the real course: 48, 49 and 61 of 61, map, request rule and approval agree ===')
const PAID = '2026-10-15T12:00:00.000Z' // own window: until 29 October, 12:00 UTC
const WATCHED = '2026-10-21T10:00:00.000Z'
const NOW = new RealDate('2026-10-22T10:00:00.000Z')
const ASKED = '2026-10-22T09:00:00.000Z'
for (const [n, want] of [[48, 'locked'], [49, 'ready'], [61, 'ready']]) {
  const r = reads({ paid: PAID, done: rowsOf(REQUIRED.slice(0, n), WATCHED) })
  const map = mapOf(r, NOW)
  const d = decideDiscountRequest(r, NOW)
  const v = approvalVerdict(reads({ paid: PAID, done: rowsOf(REQUIRED.slice(0, n), WATCHED), requests: [{ id: 'q', status: 'pending', created_at: ASKED }] }), NOW, ASKED, 'q')
  const yes = want === 'ready'
  ok(map.kind === want && d.grant === yes && v.ok === yes, `${n} of 61: the map ${want}, the request ${yes ? 'granted' : 'refused'}, the approval ${yes ? 'yes' : 'no'}`,
     show({ map: map.kind, grant: d.grant, approve: v.ok }))
  if (n === 48) {
    ok(map.lessonsDone === 48 && map.lessonsNeeded === 49 && map.lessonsLeft === 1 && map.lessonsTotal === 61 && map.nextLessonId === REQUIRED[48],
       '48: 1 more needed, the next video the 49th in course order', show(map))
    // Any of the 13 left counts. The shortest is a4l06, 136 seconds on the development page; the next in course order,
    // a4l05, an editing breakdown, is 10,602, which the refusal named ("about 2.9 hours") until the review of 2026-10-26.
    ok(map.secondsLeft === 136 && d.status === 400 && d.state === 'locked' && d.error === discountRefusalMessage(map)
         && d.error === 'You need 1 more video to reach 80%, about 2 minutes of video if you pick the shortest. Watch it before your deadline and apply again.',
       '48: the refusal says one more video, in the singular, with the length of the shortest one left (any counts)', d.error)
    ok(!v.ok && v.status === 400 && v.reason === 'locked' && v.error === 'Student has not watched 80% of the videos up to the discount checkpoint inside the 14 days: 48 of 61 watched, 49 needed.',
       '48: the approval refuses in the team\'s words, the count and what is needed', v.error)
  } else {
    ok(map.lessonsDone === n && map.lessonsNeeded === 49 && map.lessonsTotal === 61, `${n}: ready, ${n} watched of 61, 49 needed`, show(map))
  }
}
{
  // Any 49 count: the last 49 in course order, and 49 spread through the course.
  const last49 = reads({ paid: PAID, done: rowsOf(REQUIRED.slice(-49), WATCHED) })
  const spread = reads({ paid: PAID, done: rowsOf(REQUIRED.filter((_, i) => i % 5 !== 0 || i >= 60), WATCHED) })
  ok(mapOf(last49, NOW).kind === 'ready' && decideDiscountRequest(last49, NOW).grant,
     'the last 49 in course order, the first 12 never opened: ready and granted')
  ok(spread.completions.data.length === 49 && mapOf(spread, NOW).kind === 'ready' && decideDiscountRequest(spread, NOW).grant,
     '49 spread through the course (every fifth one skipped): ready and granted', `${spread.completions.data.length}`)
  // The review of 2026-10-26: one minute is said in the singular. a3l25, the action item before the gate, is the
  // shortest video (38 seconds): 48 watched with it among the 13 left, the refusal read "about 1 minutes" until then.
  const shortLeft = reads({ paid: PAID, done: rowsOf(REQUIRED.filter((id) => id !== 'a3l25').slice(0, 48), WATCHED) })
  const oneMinute = decideDiscountRequest(shortLeft, NOW)
  ok(mapOf(shortLeft, NOW).secondsLeft === 38 && oneMinute.state === 'locked'
       && oneMinute.error === 'You need 1 more video to reach 80%, about 1 minute of video if you pick the shortest. Watch it before your deadline and apply again.',
     '48 watched, a3l25 (38 seconds) among the 13 left: "about 1 minute of video", in the singular', oneMinute.error)
  const past = reads({ paid: PAID, done: rowsOf([...REQUIRED.slice(0, 48), ...AFTER_GATE], WATCHED) })
  ok(mapOf(past, NOW).kind === 'locked' && !decideDiscountRequest(past, NOW).grant && !approvalVerdict(past, NOW, ASKED).ok,
     `48 up to the gate and all ${AFTER_GATE.length} lessons after it: locked, refused, not approved (nothing past Video Ads II counts)`)
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 3. A window that has closed ===')
{
  // A window that ends after the 80% rule began: paid 13 October, 10:00 UTC, its 14 days ending 27 October.
  const OCT_13 = '2026-10-13T10:00:00.000Z'
  const AFTER = new RealDate('2026-10-28T08:00:00.000Z')
  const r = reads({ paid: OCT_13, done: rowsOf(REQUIRED.slice(0, 49), '2026-10-26T10:00:00.000Z') })
  const map = mapOf(r, AFTER)
  const d = decideDiscountRequest(r, AFTER)
  ok(map.kind === 'expired' && map.lessonsLeft === 0 && d.state === 'expired' && d.error === 'Your deadline for the 30% has passed.',
     '49 watched by 26 October, applied on 28 October, the window over on the 27th: expired on the map and refused by the route, however much was watched', show({ map, d }))
  const asked = '2026-10-27T08:00:00.000Z'
  ok(approvalVerdict(reads({ paid: OCT_13, done: r.completions.data, requests: [{ id: 'q', status: 'pending', created_at: asked }] }), AFTER, asked, 'q').ok,
     'a request made before the deadline with 49 done by it: approved after the deadline (judged as of it)')
  const late = rowsOf(REQUIRED.slice(0, 49), '2026-10-26T10:00:00.000Z').map((c, i) => (i === 48 ? { ...c, completed_at: '2026-10-27T10:00:00.001Z' } : c))
  const v = approvalVerdict(reads({ paid: OCT_13, done: late }), AFTER, asked)
  ok(!v.ok && v.error === 'Student has not watched 80% of the videos up to the discount checkpoint inside the 14 days: 48 of 61 watched, 49 needed.',
     'the 49th finished a millisecond after the deadline: not counted, so 48 by it and the approval refuses', v.error)
  const own = reads({ paid: '2026-10-09T12:00:00.000Z', done: rowsOf(REQUIRED, '2026-10-20T10:00:00.000Z') })
  ok(mapOf(own, new RealDate('2026-10-23T12:00:00.001Z')).kind === 'expired' && mapOf(own, new RealDate('2026-10-23T12:00:00.000Z')).kind === 'ready',
     'own 14 days from 9 October, 12:00 UTC, all 61 done: ready at the window\'s last millisecond, expired one millisecond later')
}
{
  // The owner's B (2026-10-26): "the 80% counts from today". A window that ended before 00:00 on 26 October in Croatia
  // keeps the rule it had, every video, and no request of it is judged by the 80% (the branch before the review of
  // that day judged them by it, so the normal Approve passed 49 to 60 of 61 for windows that had closed).
  const OCT_2 = '2026-10-02T10:00:00.000Z' // the shared deadline: the end of 23 October in Croatia
  const AFTER = new RealDate('2026-10-27T08:00:00.000Z')
  const asked = '2026-10-23T20:00:00.000Z'
  const by21 = rowsOf(REQUIRED.slice(0, 49), '2026-10-21T10:00:00.000Z')
  const v = approvalVerdict(reads({ paid: OCT_2, done: by21, requests: [{ id: 'q', status: 'pending', created_at: asked }] }), AFTER, asked, 'q')
  ok(!v.ok && v.reason === 'locked'
       && v.error === 'Student has not watched every video up to the discount checkpoint by the end of October 23 (Croatia time), the deadline for a first payment before the launch (a deadline before October 26 asks for every one; the 80% counts from then on): 49 of 61 watched, 61 needed.',
     'the shared deadline, 49 done by it, a request made before it: refused, every video, in words that say why', v.error)
  ok(mapOf(reads({ paid: OCT_2, done: by21 }), AFTER).lessonsLeft === 12, 'and the map\'s closed state counts the 12 the window still needed')
  // The edge: a window ending at the rule's first moment has the 80%; one ending the millisecond before keeps every video.
  const atRule = new RealDate(Date.parse(DISCOUNT_EIGHTY_FROM) - DISCOUNT_WINDOW_DAYS * 86_400_000).toISOString()
  const before = new RealDate(Date.parse(atRule) - 1).toISOString()
  const edge = (paid) => approvalVerdict(reads({ paid, done: rowsOf(REQUIRED.slice(0, 49), '2026-10-24T10:00:00.000Z') }), AFTER, '2026-10-25T10:00:00.000Z')
  ok(atRule === '2026-10-11T23:00:00.000Z' && edge(atRule).ok && !edge(before).ok && edge(before).error.endsWith('49 of 61 watched, 61 needed.'),
     'paid 11 October 23:00 UTC, the window ending at 00:00 on 26 October in Croatia: 49 of 61 approved; paid a millisecond earlier: refused, every video', show({ at: edge(atRule), before: edge(before).error }))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 4. N other than 61: the count follows the catalog ===')
{
  /** A stand-in course of `n` counting watch lessons with a video, the last its gate. */
  const course = (n) => Array.from({ length: n }, (_, i) => ({ id: `z${String(i + 1).padStart(2, '0')}`, type: 'watch', sort_order: i + 1, counts_toward_progress: true, is_gate: i === n - 1, duration_seconds: 300 }))
  const videosOf = (ls) => ls.map((l) => ({ lesson_id: l.id, created_at: '2026-10-12T00:00:00.000Z' }))
  for (const [n, need] of [[10, 8], [5, 4], [3, 3], [62, 50]]) {
    const ls = course(n)
    const short = reads({ paid: PAID, lessons: ls, videos: videosOf(ls), done: rowsOf(ls.slice(0, need - 1).map((l) => l.id), WATCHED) })
    const enough = reads({ paid: PAID, lessons: ls, videos: videosOf(ls), done: rowsOf(ls.slice(0, need).map((l) => l.id), WATCHED) })
    const m = mapOf(short, NOW)
    ok(m.kind === 'locked' && m.lessonsNeeded === need && m.lessonsTotal === n && !decideDiscountRequest(short, NOW).grant
         && mapOf(enough, NOW).kind === 'ready' && decideDiscountRequest(enough, NOW).grant && approvalVerdict(enough, NOW, ASKED).ok,
       `a course of ${n} videos needs ${need}: ${need - 1} refused, ${need} granted and approved`, show({ needed: m.lessonsNeeded, total: m.lessonsTotal }))
  }
  {
    // 12 lessons up to the gate, 2 with no video loaded: 10 counted, so 8 needed.
    const ls = course(12)
    const loaded = videosOf(ls.filter((l) => l.id !== 'z03' && l.id !== 'z07'))
    const r = reads({ paid: PAID, lessons: ls, videos: loaded, done: rowsOf(['z01', 'z02', 'z04', 'z05', 'z06', 'z08', 'z09'], WATCHED) })
    const m = mapOf(r, NOW)
    ok(m.kind === 'locked' && m.lessonsTotal === 10 && m.lessonsNeeded === 8 && m.lessonsDone === 7,
       '12 lessons, 2 with no video yet: 10 counted, 8 needed, 7 of them watched', show(m))
  }
  {
    // The real course, one video loaded after the request: the approval counts the 60 there were (48 needed),
    // while the map, counting 61 now, asks for 49.
    const lateId = REQUIRED[30]
    const videos = Object.keys(lengths).map((lesson_id) => ({ lesson_id, created_at: lesson_id === lateId ? '2026-10-22T12:00:00.000Z' : '2026-10-12T00:00:00.000Z' }))
    const done = rowsOf(REQUIRED.filter((id) => id !== lateId).slice(0, 48), WATCHED)
    const asked = '2026-10-22T09:00:00.000Z'
    const r = reads({ paid: PAID, videos, done, requests: [{ id: 'q', status: 'pending', created_at: asked }] })
    const later = new RealDate('2026-10-23T10:00:00.000Z')
    ok(approvalVerdict(r, later, asked, 'q').ok && mapOf(reads({ paid: PAID, videos, done }), later).kind === 'locked'
         && mapOf(reads({ paid: PAID, videos, done }), later).lessonsNeeded === 49,
       'a video loaded after the request: the approval counts the 60 there were, 48 of them is enough; the map, counting 61 now, needs 49')
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 5. The real routes: request, submit-feedback and approve agree at 48, 49 and 61 ===')
/**
 * The stand-in database: the real course in `lessons` with its videos, one
 * student (first payment `paid`), the lessons in `done` finished at
 * `doneAt`, their Whop membership checked with no coupon by the rule's own
 * stamp (with no Whop key here, the stored row answers), and `requests`.
 * `whop` "no-payment" (the review of 2026-10-26): no membership on file, and
 * the stored row is the check's unpaid answer, no code and no price (the
 * owner's applicant: "he never had a membership. I see one payment, but it
 * has failed"). Both rows carry the stamp of the rule since the owner's paid
 * plan and payment (2026-10-26, r6): an r5 row is an older rule's.
 */
/** The course switch (v104) as admin_config holds it: a request made before it is judged by the videos loaded by then. */
const SWITCH = '2026-10-17T10:00:00.000Z'
function freshDb(paid, done = [], doneAt = WATCHED, requests = [], whop = 'clean') {
  setCatalog({ v2: true, lessonsTable: 'lessons' })
  const noPayment = whop === 'no-payment'
  const db = new FakeDb({
    students: [{
      id: 's1', name: 'Made Up', email: 's1@example.com', whop_user_id: 'user_1', supabase_user_id: 'auth-1', first_paid_at: paid,
      joined_at: paid ?? '2026-10-01T00:00:00.000Z', whop_membership_id: noPayment ? null : 'mem_devEighty', membership_status: 'active',
    }],
    student_membership_discounts: [noPayment
      ? {
          student_id: 's1', whop_membership_id: null, promo_code_id: null, promo_code: null,
          renewal_price: null, plan_renewal_price: null, discounted: false, checked_at: '2026-10-14T08:00:00.000Z',
          source: 'r6-payment', source_checked_at: '2026-10-14T08:00:00.000Z',
        }
      : {
          student_id: 's1', whop_membership_id: 'mem_devEighty', promo_code_id: null, promo_code: null,
          renewal_price: 97, plan_renewal_price: 97, discounted: false, checked_at: '2026-10-14T08:00:00.000Z',
          source: 'r6-membership', source_checked_at: '2026-10-14T08:00:00.000Z',
        }],
    lessons: LESSONS,
    lesson_videos: Object.keys(lengths).map((lesson_id) => ({ lesson_id, created_at: '2026-10-12T00:00:00.000Z' })),
    student_lesson_completions: done.map((lesson_id) => ({ student_id: 's1', lesson_id, completed_at: doneAt })),
    discount_requests: requests.map((r) => ({ student_id: 's1', promo_code: null, rejection_reason: null, ...r })),
    admin_config: [{ key: 'curriculum_reset_at', value: SWITCH }],
  }, { 'tok-1': 'auth-1' })
  installDb(db)
  // Their membership on Whop, holding no code yet (none for the student Whop shows no payment for).
  whopApi.members = new Map(noPayment ? [] : [['mem_devEighty', { id: 'mem_devEighty', promo: null }]])
  whopApi.applies = []
  // submit_discount_with_feedback (v29), standing in as discount-september.test.mjs has it.
  db.functions.submit_discount_with_feedback = async (args, client) => {
    const { data: existing } = await client.from('discount_requests').select('id')
      .eq('student_id', args.p_student_id).in('status', ['pending', 'approved', 'applied']).limit(1).maybeSingle()
    if (existing) return { data: null, error: { code: 'P0001', message: 'A discount request already exists for this student' } }
    const { data: row, error } = await client.from('discount_requests').insert({ student_id: args.p_student_id }).select('id').single()
    if (error) return { data: null, error }
    return { data: row.id, error: null }
  }
  steps.length = 0
  return db
}
const post = (route, path, body) => hush(async () => {
  const res = await route(new Request(`http://app${path}`, {
    method: 'POST', headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { status: res.status, body: await res.json() }
})
const apply = () => post(requestRoute, '/api/discounts/request', { studentId: 's1' })
const submit = () => post(feedbackRoute, '/api/discounts/submit-feedback', { studentId: 's1', answers: [{ question_id: 'q1', answer_scale: 9 }] })
/**
 * The team presses Approve (or Approve anyway, `override`) on `id` as `role`. `codes`: the codes asked of Whop;
 * `attached`: whether the one code went on the student's membership, by the id the request holds (T-137).
 */
const press = (db, id, role, override = false) => hush(async () => {
  setTeam({ id: `team-${role}`, role })
  const codes = promoCodes.length
  const applies = whopApi.applies.length
  const res = await approveRoute(new Request('http://app/api/discounts/approve', {
    method: 'POST', headers: { authorization: 'Bearer team', 'content-type': 'application/json' }, body: JSON.stringify({ requestId: id, override }),
  }))
  const row = db.rows('discount_requests').find((r) => r.id === id)
  const on = whopApi.applies.slice(applies)
  return {
    status: res.status, body: await res.json(), codes: promoCodes.length - codes, row,
    attached: on.length === 1 && on[0].membership === 'mem_devEighty' && on[0].promo === row?.whop_promo_id,
  }
})
const SENT = '2026-10-22T10:00:00.000Z'
for (const n of [48, 49, 61]) {
  for (const [way, send] of [['the plain request', apply], ['the questions form', submit]]) {
    const db = freshDb(PAID, REQUIRED.slice(0, n))
    const r = await at(SENT, send)
    const made = db.rows('discount_requests')
    if (n === 48) {
      ok(r.status === 400 && r.body.state === 'locked' && /^You need 1 more video to reach 80%/.test(r.body.error) && made.length === 0
           && db.calls('submit_discount_with_feedback', 'rpc').length === 0 && !steps.some((s) => s.step === 'discount-requested'),
         `48 of 61, ${way}: refused (locked, 1 more video), nothing written, no team task`, show(r.body))
    } else {
      ok((r.status === 200) && made.length === 1 && made[0].status === 'pending' && steps.some((s) => s.step === 'discount-requested'),
         `${n} of 61, ${way}: one request written, in review, the team's task made`, show({ status: r.status, made: made.length }))
      const approved = await at('2026-10-23T09:00:00.000Z', () => press(db, made[0].id, 'csm'))
      ok(approved.status === 200 && approved.codes === 1 && approved.row.status === 'applied' && approved.attached && approved.body.status === 'applied',
         `${n} of 61, ${way}: the normal Approve (a csm's) makes one code and puts it on their membership: applied (T-137)`, show(approved.body))
    }
  }
}
{
  // The approval of a request at 48 (one the app could not have made: straight in the table).
  const db = freshDb(PAID, REQUIRED.slice(0, 48), WATCHED, [{ id: 'q48', status: 'pending', created_at: SENT }])
  const r = await at('2026-10-23T09:00:00.000Z', () => press(db, 'q48', 'csm'))
  ok(r.status === 400 && r.body.code === 'rule' && r.body.error === 'Student has not watched 80% of the videos up to the discount checkpoint inside the 14 days: 48 of 61 watched, 49 needed.'
       && r.codes === 0 && r.row.status === 'pending',
     'a request at 48 of 61: the normal Approve refuses it (code "rule"), no code, still pending', show(r.body))
}

{
  // The review of 2026-10-26 through the real approve route and the 30% page: windows that closed before the 80% rule
  // keep every video (the owner's B), where the branch before the review approved these requests at the 80%.
  const OCT_27 = '2026-10-27T09:00:00.000Z'
  // The shared window: first paid 2 October, 57 of 61 by 23 October, an old-dashboard request of 5 October still
  // pending (it counts, requestCounts), judged by the videos loaded by the switch.
  const shared = () => freshDb('2026-10-02T10:00:00.000Z', REQUIRED.slice(0, 57), '2026-10-21T10:00:00.000Z', [{ id: 'old5', status: 'pending', created_at: '2026-10-05T10:00:00.000Z' }])
  {
    const db = shared()
    const r = await at(OCT_27, () => press(db, 'old5', 'csm'))
    ok(r.status === 400 && r.body.code === 'rule' && r.codes === 0 && r.row.status === 'pending'
         && r.body.error.startsWith('This request was made on the old course, before the switch.') && r.body.error.endsWith('57 of 61 watched, 61 needed.'),
       'the shared window, 57 of 61 by its deadline, an old-dashboard request: the normal Approve refuses it, every video, no code (it approved on the branch before the review)', show(r.body))
    const load = await loadThirtyData(fakeClient(db))
    const row = load.ok ? buildThirtyView(load.data, new RealDate(OCT_27), SWITCH).requests.find((x) => x.id === 'old5') : null
    ok(row && !row.verdict.ok && row.verdict.reason === 'locked' && row.verdict.text === `${VERDICT_TEXT.oldCourse} ${VERDICT_TEXT.lockedClosedEvery}`
         && row.facts.everyVideo === true
         && show(videoLine(row, row.verdict)) === show(['57 of 61 videos by the deadline', '61 needed, every video for a deadline before Mon 26 Oct', 'Whop progress not pulled since the switch']),
       'its row on the 30% page: not every video by the deadline, "61 needed, every video for a deadline before Mon 26 Oct", no Approve (it read "At least 80% ... watched in time")', show({ v: row?.verdict, line: row && videoLine(row, row.verdict) }))
  }
  {
    // The same student with every video by the deadline: approved as before.
    const db = freshDb('2026-10-02T10:00:00.000Z', REQUIRED, '2026-10-21T10:00:00.000Z', [{ id: 'old5', status: 'pending', created_at: '2026-10-05T10:00:00.000Z' }])
    const r = await at(OCT_27, () => press(db, 'old5', 'csm'))
    ok(r.status === 200 && r.codes === 1 && r.row.status === 'applied' && r.attached, 'the same with all 61 by the deadline: approved, one code, on their membership (applied)', show(r.body))
  }
  {
    // A first payment at the launch (its own window, over on 22 October) and a pending request from before it, which
    // requestCounts leaves out of the map but the 30% page lists: 50 of 61 by the deadline.
    const db = freshDb('2026-10-08T22:00:00.000Z', REQUIRED.slice(0, 50), '2026-10-20T10:00:00.000Z', [{ id: 'pre7', status: 'pending', created_at: '2026-10-07T10:00:00.000Z' }])
    const r = await at(OCT_27, () => press(db, 'pre7', 'csm'))
    ok(r.status === 400 && r.body.code === 'rule' && r.codes === 0 && r.row.status === 'pending' && r.body.error.endsWith('50 of 61 watched, 61 needed.'),
       'paid at the launch, its window over on 22 October, 50 of 61, a pending request from before the launch: refused, every video (approved on the branch before the review)', show(r.body))
  }
  {
    // A window ending at the 80% rule's first moment (paid 11 October 23:00 UTC), 49 of 61, applied before its end: approved.
    const db = freshDb('2026-10-11T23:00:00.000Z', REQUIRED.slice(0, 49), '2026-10-24T10:00:00.000Z', [{ id: 'edge', status: 'pending', created_at: '2026-10-25T10:00:00.000Z' }])
    const r = await at(OCT_27, () => press(db, 'edge', 'csm'))
    ok(r.status === 200 && r.codes === 1 && r.row.status === 'applied' && r.attached, 'a window ending at 00:00 on 26 October in Croatia, 49 of 61: approved and on their membership, the 80% is its rule', show(r.body))
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 6. No 30% without a real payment (first_paid_at empty) ===')
{
  ok(show(discountWindow(null)) === show({ closed: 'no-payment' }) && show(discountWindow('')) === show({ closed: 'no-payment' }),
     'today\'s window with first_paid_at empty: closed, "no-payment" (no deadline at all)')
  const st = discountState({ now: NOW, firstPaidAt: null, lessons: COURSE, videoDoneIds: new Set(REQUIRED), requests: [] })
  const cv = checkpointView(st, NOW.getTime(), 3, 3)
  ok(show(st) === show({ kind: 'not-eligible', reason: 'no-payment' }) && cv.chip.tail === 'Ask the team' && cv.tag === 'locked' && !cv.header,
     'every video watched, no first payment: the map says "Ask the team", no chip in the header, and the panel has no Apply (it shows Apply only locked or ready)', show({ st, chip: cv.chip.tail }))
  const words = discountRefusalMessage(st)
  ok(words === "We can't see your first payment yet. Tell the team and they'll sort it out." && !BANNED.test(words),
     'the student\'s sentence, plain, no em dash, no "unlock"', words)
  for (const [way, send] of [['the plain request', apply], ['the questions form', submit]]) {
    for (const n of [0, 49, 61]) {
      const db = freshDb(null, REQUIRED.slice(0, n))
      const r = await at(SENT, send)
      ok(r.status === 400 && r.body.state === 'not-eligible' && r.body.error === words && db.rows('discount_requests').length === 0
           && db.calls('submit_discount_with_feedback', 'rpc').length === 0 && !steps.some((s) => s.step === 'discount-requested'),
         `no first payment, ${n} of 61 watched, ${way}: refused in that sentence, nothing written, no team task`, show(r.body))
    }
  }
  // A pending request a student with no payment holds anyway (written straight into the table, as the database
  // function could before v107, or from before the first-paid fix emptied nothing): the approve route.
  const pending = () => freshDb(null, REQUIRED, WATCHED, [{ id: 'np', status: 'pending', created_at: SENT }])
  {
    const db = pending()
    const r = await at('2026-10-23T09:00:00.000Z', () => press(db, 'np', 'admin'))
    ok(r.status === 400 && r.body.code === 'rule' && r.body.error.startsWith('Cannot approve: student has no first_paid_at on file.') && r.codes === 0 && r.row.status === 'pending',
       'every video watched, no first payment: the normal Approve refuses (code "rule", so the page offers Approve anyway), no code, still pending', show(r.body))
  }
  for (const role of ['admin', 'founder']) {
    const db = pending()
    const r = await at('2026-10-23T09:00:00.000Z', () => press(db, 'np', role, true))
    ok(r.status === 200 && r.codes === 1 && r.row.status === 'applied' && r.attached && r.row.reviewed_by === `team-${role}` && r.row.applied_by === `team-${role}`,
       `Approve anyway by ${role === 'admin' ? 'an admin' : 'a founder'}: approved past it, one code on their membership, the row naming the login as reviewer and as who applied it`, show(r.body))
  }
  {
    const db = pending()
    const r = await at('2026-10-23T09:00:00.000Z', () => press(db, 'np', 'csm', true))
    ok(r.status === 403 && r.body.error === 'Only a founder or an admin can approve past a check.' && r.codes === 0 && r.row.status === 'pending',
       'Approve anyway by a csm: refused (403), no code, still pending', show(r.body))
  }
  {
    // The 30% page's row for that request: its verdict and Approve anyway.
    const j = judgeRequest(reads({ paid: null, done: rowsOf(REQUIRED, WATCHED), requests: [{ id: 'np', status: 'pending', created_at: SENT }] }), NOW, { id: 'np', created_at: SENT }, null)
    ok(!j.verdict.ok && j.verdict.reason === 'no-payment' && j.verdict.text === 'There is no real payment on file for this student, and the 30% needs one.'
         && VERDICT_TEXT.noPayment === j.verdict.text && anywaySkip(j.verdict, null) === 'rule' && j.facts.window === null,
       'the 30% page: "There is no real payment on file for this student, and the 30% needs one.", no Approve, Approve anyway skips the rule', show(j.verdict))
  }

  // The gap the review of 2026-10-26 closed: first_paid_at filled (a date written before the first-paid fix from a
  // membership's creation, which the repair never empties) while Whop shows no real payment. The rule alone says
  // ready, so until the review both request routes wrote the request and the normal Approve approved it at 49 of 61.
  // Since the owner's answers of the same day the refusal says the paid plan and the payment, one sentence for every
  // unpaid student; the empty first_paid_at above keeps its own.
  const unpaidWords = discountRefusalMessage({ kind: 'not-eligible', reason: 'unpaid' })
  ok(unpaidWords === 'The 30% needs a paid course plan and a payment that went through.' && unpaidWords !== words && !BANNED.test(unpaidWords),
     'the unpaid student\'s sentence, plain, and not the one for an empty first_paid_at', unpaidWords)
  for (const [way, send] of [['the plain request', apply], ['the questions form', submit]]) {
    for (const n of [49, 61]) {
      const db = freshDb(PAID, REQUIRED.slice(0, n), WATCHED, [], 'no-payment')
      const r = await at(SENT, send)
      ok(r.status === 400 && r.body.state === 'not-eligible' && r.body.error === unpaidWords && db.rows('discount_requests').length === 0
           && db.calls('submit_discount_with_feedback', 'rpc').length === 0 && !steps.some((s) => s.step === 'discount-requested'),
         `a first payment on file but Whop showing none, ${n} of 61 watched, ${way}: refused in the unpaid sentence, nothing written, no team task (it went in until the review)`, show(r.body))
    }
  }
  const gap = () => freshDb(PAID, REQUIRED.slice(0, 49), WATCHED, [{ id: 'gp', status: 'pending', created_at: SENT }], 'no-payment')
  {
    const db = gap()
    const r = await at('2026-10-23T09:00:00.000Z', () => press(db, 'gp', 'csm'))
    ok(r.status === 400 && r.body.code === 'rule' && r.body.error === UNPAID_APPROVAL
         && r.body.error === 'Cannot approve: the 30% needs a paid course plan and a payment that went through, and Whop doesn\'t show both for this student.' && r.codes === 0 && r.row.status === 'pending',
       'its request (made before the review): the normal Approve refused, code "rule", the team\'s sentence, no code, still pending (approved at 49 until the review)', show(r.body))
  }
  for (const role of ['admin', 'founder']) {
    const db = gap()
    const r = await at('2026-10-23T09:00:00.000Z', () => press(db, 'gp', role, true))
    ok(r.status === 200 && r.codes === 1 && r.row.status === 'approved' && !r.attached && r.body.reason === 'no_membership',
       `Approve anyway by ${role === 'admin' ? 'an admin' : 'a founder'}: approved past it, one code, left approved (Whop shows no membership to put it on)`, show(r.body))
  }
  {
    const db = gap()
    const r = await at('2026-10-23T09:00:00.000Z', () => press(db, 'gp', 'csm', true))
    ok(r.status === 403 && r.codes === 0 && r.row.status === 'pending', 'Approve anyway by a csm: refused (403), no code, still pending', show(r.body))
  }
  {
    // The 30% page's own list over the same database: the verdict says it, with the count; no Approve, Approve anyway.
    const db = gap()
    const load = await loadThirtyData(fakeClient(db))
    const row = load.ok ? buildThirtyView(load.data, new RealDate('2026-10-23T09:00:00.000Z'), null).requests.find((x) => x.id === 'gp') : null
    ok(row && !row.verdict.ok && row.verdict.reason === 'unpaid' && row.verdict.text === 'The 30% needs a paid course plan and a payment that went through, and Whop doesn\'t show both for this student.'
         && row.verdict.text === VERDICT_TEXT.unpaid && anywaySkip(row.verdict, null) === 'rule' && row.coupon?.unpaid === true
         && show(videoLine(row, row.verdict)) === show(['49 of 61 videos', '49 needed for 80%']),
       'the 30% page: "The 30% needs a paid course plan and a payment that went through, and Whop doesn\'t show both for this student.", the count beside it, no Approve, Approve anyway skips it', show(row?.verdict))
    ok(!BANNED.test(UNPAID_APPROVAL + VERDICT_TEXT.unpaid), 'its words plain: no em dash, no "unlock"')
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 7. The map\'s words: the one line, and every count says what is needed ===')
{
  const rule = discountRule('Video Ads II')
  ok(rule.open === 'Watch 80% of the videos through Video Ads II within 2 weeks of joining to apply.', 'the line, word for word', rule.open)
  const locked = (done) => discountState({ now: NOW, firstPaidAt: PAID, lessons: COURSE, videoDoneIds: new Set(REQUIRED.slice(0, done)), requests: [] })
  const c12 = checkpointCounts(locked(12))
  ok(c12.why === 'Watch 49 of 61 videos to apply' && c12.done === 12 && c12.needed === '49 of 61 needed' && Math.abs(c12.fill - 12 / 49) < 1e-12,
     '12 watched: Apply\'s reason "Watch 49 of 61 videos to apply", "12 watched", "49 of 61 needed", the bar 12/49 full', show(c12))
  const c48 = checkpointCounts(locked(48))
  ok(c48.needed === '49 of 61 needed' && c48.done === 48 && c48.fill < 1 && c48.fill > 0.97, '48 watched: the bar a hair short of full', show(c48))
  ok(locked(49).kind === 'ready', '49 watched: the panel turns ready (no counts to show)')
  // The lantern: lit within 3 videos of the 80%, as it was within 3 of every video.
  ok(checkpointView(locked(46), NOW.getTime(), 1, 3).look === 'near' && checkpointView(locked(45), NOW.getTime(), 1, 3).look === 'closed',
     'the cache\'s lantern: lit 3 short of the 49 (46 watched), dark 4 short, for a student before Video Ads II')
  ok(checkpointView(locked(44), NOW.getTime(), 3, 3).look === 'near',
     'in Video Ads II itself (place 3), 5 short: lit, as for any locked student there')
  // The review of 2026-10-26: a window that closed before the 80% rule asked for every video. The student who had 55 of
  // 61 by 20 October read "The 30% is for watching 80% ..." under "This closed on Fri 23 Oct", a rule the app never
  // asked of them. The owner's call of the same day (B: the 80% counts from 26 October, a window that closed before it
  // stays closed, and the map never tells it the 80% rule): the line says what that window asked.
  ok(rule.closedBefore === 'The 30% was for finishing every video through Video Ads II within 2 weeks of joining.', 'the rule a window before the 80% had, in the past', rule.closedBefore)
  const closedLine = (paid, doneBy, now) => {
    const st = discountState({ now, firstPaidAt: paid, lessons: COURSE, videoDoneIds: new Set(REQUIRED.slice(0, doneBy)), requests: [] })
    return { kind: st.kind, line: st.kind === 'expired' ? expiredRuleLine(st.endsAt, 'Video Ads II') : null }
  }
  const TODAY = new RealDate('2026-10-26T12:00:00.000Z')
  const shared = closedLine('2026-10-02T10:00:00.000Z', 55, TODAY)
  const own = closedLine('2026-10-10T10:00:00.000Z', 55, TODAY)
  const since = closedLine('2026-10-12T10:00:00.000Z', 55, new RealDate('2026-10-27T12:00:00.000Z'))
  ok(shared.kind === 'expired' && shared.line === rule.closedBefore && own.kind === 'expired' && own.line === rule.closedBefore,
     'paid 2 October (the shared deadline, 23 October) or 10 October (24 October), 55 of 61 watched, read on 26 October: expired, and the line says the window was for every video', show({ shared, own }))
  ok(since.kind === 'expired' && since.line === rule.closed && Date.parse('2026-10-26T10:00:00.000Z') > Date.parse(DISCOUNT_EIGHTY_FROM),
     'paid 12 October, its 14 days ending 26 October 10:00 UTC, after the rule began: the 80% line', show(since))
  ok(expiredRuleLine(DISCOUNT_SHARED_DEADLINE, 'Video Ads II') === rule.closedBefore, 'the shared deadline itself: before the rule')
  // The review of 2026-10-26: every closed line the panel shows for a deadline before the 80% rule names no 80% (the
  // owner's B: the map does not tell a window the 80% rule it did not have). A first payment before 1 October reads
  // "Your 2 weeks have passed." alone, where it went on with the 80% line; its 2 weeks all ended before 15 October.
  ok(rule.beforeLaunch === 'Your 2 weeks have passed.', 'a first payment before 1 October: "Your 2 weeks have passed." alone', rule.beforeLaunch)
  const shown = []
  const lastBefore = Date.parse(DISCOUNT_EIGHTY_FROM) - 14 * 86_400_000
  for (let t = Date.parse('2026-08-20T10:00:00.000Z'); t < lastBefore; t += 6 * 3_600_000) {
    const paid = new RealDate(t).toISOString()
    const st = discountState({ now: TODAY, firstPaidAt: paid, lessons: COURSE, videoDoneIds: new Set(REQUIRED.slice(0, 55)), requests: [] })
    const line = st.kind === 'expired' ? expiredRuleLine(st.endsAt, 'Video Ads II') : st.kind === 'not-eligible' && st.reason === 'before-launch' ? rule.beforeLaunch : null
    shown.push({ paid, kind: st.kind, line })
  }
  ok(shown.length > 200 && shown.every((x) => x.line !== null && !x.line.includes('80%'))
       && shown.filter((x) => x.kind === 'not-eligible').length > 100 && shown.filter((x) => x.kind === 'expired').length > 30,
     `every first payment from 20 August until the last whose window ends before the rule, read on 26 October with 55 of 61 watched: closed, and none of the ${shown.length} lines names the 80%`,
     show(shown.filter((x) => x.line === null || x.line.includes('80%')).slice(0, 3)))
  const atRule = closedLine(new RealDate(lastBefore).toISOString(), 55, TODAY)
  ok(atRule.kind === 'expired' && atRule.line === rule.closed, 'the first window that ends at the rule itself (paid 11 October, 23:00 UTC): the 80% line, its rule', show(atRule))
  // A window still open says its own rule too (liveRuleLine): the 80% for every window open today; every video for one
  // that ends before the rule, which only a clock before 26 October sees open (the dev page's ?discount=october).
  const live = (paid, now, doneBy) => {
    const st = discountState({ now: new RealDate(now), firstPaidAt: paid, lessons: COURSE, videoDoneIds: new Set(REQUIRED.slice(0, doneBy)), requests: [] })
    return { kind: st.kind, line: liveRuleLine(st, 'Video Ads II'), counts: st.kind === 'locked' ? checkpointCounts(st) : null }
  }
  const openNow = live(PAID, '2026-10-26T12:00:00.000Z', 12)
  const readyNow = live(PAID, '2026-10-26T12:00:00.000Z', 49)
  const openThen = live('2026-10-02T10:00:00.000Z', '2026-10-19T08:00:00.000Z', 12)
  const readyThen = live('2026-10-02T10:00:00.000Z', '2026-10-19T08:00:00.000Z', 61)
  ok(openNow.kind === 'locked' && openNow.line === rule.open && openNow.counts.needed === '49 of 61 needed' && readyNow.kind === 'ready' && readyNow.line === rule.ready,
     'a window open on 26 October: the 80% line, "49 of 61 needed", and at 49 ready with the 80%\'s words', show({ openNow, readyNow }))
  ok(openThen.kind === 'locked' && openThen.line === rule.openEvery && openThen.counts.needed === '61 of 61 needed' && openThen.counts.why === 'Watch 61 of 61 videos to apply'
       && readyThen.kind === 'ready' && readyThen.line === rule.readyEvery && live('2026-10-02T10:00:00.000Z', '2026-10-19T08:00:00.000Z', 60).kind === 'locked',
     'the shared window seen on 19 October: every video, its line and its counts saying so, ready only at 61', show({ openThen, readyThen }))
  const all = [rule.open, rule.closed, rule.closedBefore, rule.beforeLaunch, rule.ready, rule.openEvery, rule.readyEvery, c12.why, c12.needed]
  ok(all.every((w) => !BANNED.test(w)), 'no em dash, no "unlock", no "EcomTalent" in any of them', show(all))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== 8. The 30% page: the video line, Copy Discord ID and Copy username ===')
{
  const student = (o = {}) => ({ id: 's', name: 'Made Up', email: null, username: null, discordId: null, status: 'active', whopPulled: true, ...o })
  const facts = (o = {}) => ({ firstPaidAt: PAID, window: 'own', deadline: '2026-10-29T12:00:00.000Z', deadlinePassed: false, videosDone: 48, videosTotal: 61, videosNeeded: 49, countedByDeadline: false, secondsLeft: 300, ...o })
  ok(show(videoLine({ facts: facts(), student: student() }, { reason: 'locked' })) === show(['48 of 61 videos', '49 needed for 80%']),
     'open: "48 of 61 videos · 49 needed for 80%"')
  ok(show(videoLine({ facts: facts({ countedByDeadline: true, deadlinePassed: true }), student: student({ whopPulled: false }) }, { reason: 'locked' }))
       === show(['48 of 61 videos by the deadline', '49 needed for 80%', 'Whop progress not pulled since the switch']),
     'the deadline passed: "48 of 61 videos by the deadline · 49 needed for 80%", and Whop progress not in')
  ok(show(videoLine({ facts: facts({ videosDone: 49 }), student: student({ whopPulled: false }) }, { reason: null })) === show(['49 of 61 videos', '49 needed for 80%']),
     'the yes at 49: the count and the 49, no Whop line beside a yes')
  ok(videoLine({ facts: facts(), student: student() }, { reason: 'has-discount' }).length === 0 && videoLine({ facts: null, student: student() }, { reason: 'locked' }).length === 0
       && videoLine({ facts: facts({ videosDone: null, videosTotal: null, videosNeeded: null }), student: student() }, { reason: 'read-failed' }).length === 0,
     'no line beside the coupon\'s verdict, or with no count (never "0 of 61")')

  // The review of 2026-10-26: students.discord_username is the Whop username after every Whop sign-in and every
  // payment (the login and the webhook write it) and the Discord one only once the 2-hour sync wrote it since, so the
  // button is "Copy username", its tip says it can be the Whop name, and "Copy Discord ID" comes first (the owner: "I
  // think ID might be best"). They read "Copy @" and "Copy ID" until then.
  const both = studentCopies(student({ username: 'maya.lq', discordId: '100000000000000101' }))
  ok(show(both) === show({ id: { text: '100000000000000101', unavailable: null, tip: null }, username: { text: '@maya.lq', unavailable: null, tip: USERNAME_TIP }, none: null, note: null }),
     'an id and a username: Copy Discord ID copies the id, Copy username "@maya.lq" with its tip', show(both))
  ok(USERNAME_TIP === "The username on file. It can be the student's Whop username, and on Discord that name may belong to someone else.",
     'the username\'s tip, word for word: never called Discord', USERNAME_TIP)
  ok(studentCopies(student({ username: '@lena.v', discordId: '1' })).username.text === '@lena.v' && studentCopies(student({ username: '  @x  ' })).username.text === '@x',
     'a username stored with its "@": copied with one, never "@@"')
  const none = studentCopies(student({ username: '   ', discordId: '  ' }))
  ok(show(none) === show({ id: { text: '', unavailable: NO_DISCORD_ID, tip: null }, username: { text: '', unavailable: NO_USERNAME, tip: null }, none: NO_DISCORD_LINE, note: null })
       && NO_USERNAME === 'No username on file for this student.' && NO_DISCORD_ID === 'No Discord ID on file for this student.' && NO_DISCORD_LINE === 'No Discord ID or username on file.',
     'neither on file (blank counts as none): the line "No Discord ID or username on file." in their place (a phone shows no tip)', show(none))
  ok(studentCopies(student({ username: 'hugo.l' })).id.unavailable === NO_DISCORD_ID && studentCopies(student({ username: 'hugo.l' })).none === null
       && studentCopies(student({ discordId: '7' })).username.unavailable === NO_USERNAME && studentCopies(student({ discordId: '7' })).none === null,
     'one without the other: only that button greyed, with its tip, and no line in their place')
  // The review of 2026-10-26: the username's warning was only a hover tip, which a phone never shows. With a username and
  // no Discord ID, the username is what the team would search Discord by, so a short line beside them says it.
  ok(studentCopies(student({ username: 'hugo.l' })).note === USERNAME_NOTE && USERNAME_NOTE === 'This username may be their Whop one.'
       && studentCopies(student({ discordId: '7' })).note === null && studentCopies(student({ username: 'maya.lq', discordId: '7' })).note === null && !BANNED.test(USERNAME_NOTE),
     'a username and no Discord ID: the line "This username may be their Whop one." beside them; with an id, or no username, none')

  // The button itself, rendered.
  const on = renderToString(createElement(CopyButton, { text: '100000000000000101', label: 'Copy Discord ID' }))
  const named = renderToString(createElement(CopyButton, { text: '@maya.lq', label: 'Copy username', tip: USERNAME_TIP }))
  const off = renderToString(createElement(CopyButton, { text: '', label: 'Copy Discord ID', unavailable: NO_DISCORD_ID }))
  ok(/>Copy Discord ID</.test(on) && !/aria-disabled/.test(on) && !/title=/.test(on) && !/disabled=""/.test(on) && /opacity:1/.test(on),
     'with something to copy: a plain raised button', on)
  ok(/>Copy username</.test(named) && !/aria-disabled/.test(named) && named.includes(`title="The username on file. It can be the student&#x27;s Whop username`),
     'Copy username carries its tip as its title while it can copy', named)
  ok(/>Copy Discord ID</.test(off) && /aria-disabled="true"/.test(off) && off.includes(`title="${NO_DISCORD_ID}"`) && !/ disabled=""/.test(off) && /opacity:0\.4/.test(off) && /cursor:not-allowed/.test(off),
     'with nothing: greyed, aria-disabled (still in the keyboard\'s path), its tip as its title', off)

  // Where the page puts them (ThirtyView.tsx): beside "Copy code" on a row with a code, and on every Applied row.
  const page = fromSrc('src/components/admin/thirty/ThirtyView.tsx')
  ok(/<CopyButton text=\{code\} label="Copy code" \/>\s*<StudentCopies student=\{student\} \/>/.test(page)
       && /\{row\.promoCode && row\.status !== "rejected" && <CodeWithCopy code=\{row\.promoCode\} student=\{row\.student\} \/>\}/.test(page),
     'in the source: Copy Discord ID and Copy username beside "Copy code" (it said "Copy"), on every Approved and Code Applied row with a code')
  const pendingRow = page.slice(page.indexOf('function PendingRow('), page.indexOf('function CodeWithCopy('))
  ok(/<StudentCopies student=\{row\.student\} \/>/.test(pendingRow) && /const detail = videoLine\(row, verdict\);/.test(pendingRow),
     'in the source: every Applied row has them, and its verdict line is videoLine\'s')
  const copies = page.slice(page.indexOf('function StudentCopies('), page.indexOf('function PendingRow('))
  ok(copies.indexOf('label="Copy Discord ID"') > 0 && copies.indexOf('label="Copy Discord ID"') < copies.indexOf('label="Copy username"') && /if \(none\) \{/.test(copies)
       && copies.indexOf('label="Copy username"') < copies.indexOf('data-username-note')
       && !/label="Copy @"|label="Copy ID"/.test(page) && !BANNED.test(NO_USERNAME + NO_DISCORD_ID + NO_DISCORD_LINE + USERNAME_TIP),
     'the labels "Copy Discord ID", first, then "Copy username" (no "Copy @" or "Copy ID" left), the line in their place with neither; the tips plain')
}

ok(Date === RealDate, 'the clock is the real one again')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
