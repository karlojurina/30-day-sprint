// The 30%'s "next payment" after that payment (the 2026-10-20 review of
// streak-2): the applied moment, and the checkpoint panel's "next renewal",
// only while the renewal the 30% goes on is sure to be still ahead.
//
// WHAT WAS WRONG. An applied request stays applied for good, and the browser
// key was the only guard against the full-screen moment playing again. On a
// second device, after Safari's 7-day storage wipe, or with storage blocked,
// "30% OFF / Discount approved / Your 30% is on your next payment." played
// again months after that payment had used the 30%, and the panel said
// "You'll see 30% off on your next renewal." for good. celebrations.ts now
// plays an applied one only within RENEWAL_AHEAD_DAYS of the application
// (renewalStillAhead), and the panel says "next renewal" only as long, then
// "You got your 30%. The team put it on your Whop subscription."
//
//   1  The reviewer's student, through the real discountState and
//      approvalOnMap (the _gen copies): first paid 10 October, applied for on
//      15 October and applied. On 17 October the moment plays; on 20
//      November and 1 February 2027 it does not, and the map hands
//      WorldCelebrations no request. The edge: 1 ms before 5 days it plays,
//      at 5 days it does not. Approved keeps no limit.
//   2  RENEWAL_AHEAD_DAYS against the offer's own dates. For every first
//      payment from DISCOUNT_ELIGIBLE_FROM to a year after the launch, hour
//      by hour: the last application the routes accept (discountWindow's end
//      plus REQUEST_GRACE_MS) and the renewal (a month on the UTC calendar or
//      30 days, whichever is sooner). The limit must leave at least a day
//      before the shortest of those gaps, so moving a date closer fails here.
//   3  The source: WorldMap.tsx gives approvalOnMap the discount's clock, the
//      one the panel gets too (WorldDiscount.now), and the panel's applied
//      line reads renewalStillAhead with it, with both lines.
//
//   node client-tests/build.mjs && node --experimental-strip-types client-tests/discount-next-renewal.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const C = await import('./_gen/celebrations.ts')
const D = await import('./_gen/discount.ts')
const S = await import('./_gen/discount-server.ts')
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const DAY = 86_400_000
const HOUR = 3_600_000
const span = (ms) => `${Math.floor(ms / DAY)} d ${Math.floor((ms % DAY) / HOUR)} h ${Math.round((ms % HOUR) / 60_000)} min`

ok(typeof C.renewalStillAhead === 'function' && typeof C.RENEWAL_AHEAD_DAYS === 'number', 'celebrations.ts has renewalStillAhead and RENEWAL_AHEAD_DAYS', show(C.RENEWAL_AHEAD_DAYS))
const LIMIT = (C.RENEWAL_AHEAD_DAYS ?? NaN) * DAY
// Missing (the code before the review), every row below fails on its own instead of the run stopping here.
const ahead = typeof C.renewalStillAhead === 'function' ? C.renewalStillAhead : () => undefined

// ── 1. The reviewer's student ───────────────────────────────────────────────
const lessons = [
  { id: 'l1', type: 'watch', counts_toward_progress: true, is_gate: false, has_video: true, duration_seconds: 600 },
  { id: 'l2', type: 'watch', counts_toward_progress: true, is_gate: true, has_video: true, duration_seconds: 600 },
]
const PAID = '2026-10-10T10:00:00.000Z'
const ASKED = '2026-10-15T10:00:00.000Z'
const stateAt = (status, now) =>
  D.discountState({ now: new Date(now), firstPaidAt: PAID, lessons, videoDoneIds: new Set(['l1', 'l2']), requests: [{ id: 'req-1', status, created_at: ASKED }] })

console.log('\n1. First paid 10 October, applied for on 15 October and applied (the reviewer\'s student)')
for (const [day, plays] of [['2026-10-17T10:00:00.000Z', true], ['2026-11-20T10:00:00.000Z', false], ['2027-02-01T10:00:00.000Z', false]]) {
  const now = Date.parse(day)
  const st = stateAt('applied', now)
  const got = C.approvalOnMap(st, now)
  // What WorldMap.tsx hands WorldCelebrations, and what it then asks with a browser that holds no key.
  const handed = got?.requestId ?? null
  const celebrates = C.approvalToCelebrate(handed, null)
  const want = plays ? { requestId: 'req-1', applied: true } : null
  ok(st.kind === 'applied' && show(got) === show(want) && celebrates === plays,
     `${day.slice(0, 10)}: ${plays ? 'the moment plays, with the applied line' : 'no moment, on a second device or a wiped browser key too'}`,
     `${st.kind} → ${show(got)}, approvalToCelebrate(${show(handed)}, null) = ${celebrates}`)
  ok(ahead(st.at, now) === plays, `${day.slice(0, 10)}: the panel ${plays ? 'says "on your next renewal"' : 'says what stays true'}`, `renewalStillAhead = ${ahead(st.at, now)}`)
}
{
  const t = Date.parse(ASKED)
  const before = C.approvalOnMap(stateAt('applied', t + LIMIT - 1), t + LIMIT - 1)
  const at = C.approvalOnMap(stateAt('applied', t + LIMIT), t + LIMIT)
  ok(before?.applied === true && at === null, `the edge: 1 ms before ${C.RENEWAL_AHEAD_DAYS} days it plays, at ${C.RENEWAL_AHEAD_DAYS} days it does not`, show({ before, at }))
  const late = Date.parse('2026-11-20T10:00:00.000Z')
  const approved = C.approvalOnMap(stateAt('approved', late), late)
  ok(show(approved) === show({ requestId: 'req-1', applied: false }), 'approved keeps no limit, as before (the team marks it applied in the same sitting)', show(approved))
  ok(ahead('not a date', t) === false, 'a date that does not parse: not ahead', String(ahead('not a date', t)))
}

// ── 2. The limit against the offer's own dates ──────────────────────────────
/** One month later on the UTC calendar, the time of day kept, the 31st held to a shorter month's last day. */
function addUtcMonth(t) {
  const d = new Date(t)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + 1)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.getTime()
}
const renewalOf = (paid) => Math.min(addUtcMonth(paid), paid + 30 * DAY)

console.log('\n2. The limit against the shortest time from an application to its renewal')
ok(typeof S.REQUEST_GRACE_MS === 'number', 'discount-server.ts has REQUEST_GRACE_MS', show(S.REQUEST_GRACE_MS))
let shortest = { gap: Infinity, paid: null, window: null }
let firstPayments = 0
const from = Date.parse(D.DISCOUNT_ELIGIBLE_FROM)
const until = Date.parse(D.DISCOUNT_LAUNCH_DATE) + 400 * DAY
for (let paid = from; paid < until; paid += HOUR) {
  const w = D.discountWindow(new Date(paid).toISOString())
  if ('closed' in w) continue
  firstPayments++
  const lastApplication = w.endsAt.getTime() + S.REQUEST_GRACE_MS
  const gap = renewalOf(paid) - lastApplication
  if (gap < shortest.gap) shortest = { gap, paid: new Date(paid).toISOString(), window: w.window }
}
ok(firstPayments > 9000, 'every hour of first payments from 1 October to a year after the launch is open to the offer', `${firstPayments} first payments`)
ok(shortest.window === 'shared' && shortest.paid === new Date(from).toISOString(),
   'the shortest gap is the shared window\'s: a first payment at the start of 1 October in Croatia, applied for at the end of 23 October',
   show({ ...shortest, gap: span(shortest.gap) }))
ok(LIMIT < shortest.gap, `${C.RENEWAL_AHEAD_DAYS} days is shorter than that gap (${span(shortest.gap)})`)
ok(LIMIT + DAY <= shortest.gap, 'and leaves at least a day spare, for a wrong clock on the student\'s device or a charge taken early', `spare ${span(shortest.gap - LIMIT)}`)

// ── 3. The source ───────────────────────────────────────────────────────────
console.log('\n3. The map and the panel read it on the discount\'s clock')
const host = read('src/components/world/WorldMap.tsx')
ok(/const approval = approvalOnMap\(discountNow, discountClock\);/.test(host), 'WorldMap.tsx asks approvalOnMap on the discount\'s clock')
ok(/return \{ state: discountNow, now: discountClock, next, apply: applyDiscount \};/.test(host), 'and hands the map the same clock (WorldDiscount.now)')
const map = read('src/components/world-v6/WorldV6.tsx')
ok(/import \{ renewalStillAhead \} from "@\/lib\/world\/celebrations";/.test(map), 'WorldV6.tsx reads renewalStillAhead from celebrations.ts')
ok(/\) : renewalStillAhead\(st\.at, discount\.now\) \? \(\s*<p className=\{s\.desc\}>It&apos;s on your Whop subscription\. You&apos;ll see \{DISCOUNT_PERCENT\}% off on your next renewal\.<\/p>\s*\) : \(\s*<p className=\{s\.desc\}>You got your \{DISCOUNT_PERCENT\}%\. The team put it on your Whop subscription\.<\/p>/.test(map),
   'the panel\'s applied line: "next renewal" while it is ahead, then "You got your 30%. The team put it on your Whop subscription."')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
