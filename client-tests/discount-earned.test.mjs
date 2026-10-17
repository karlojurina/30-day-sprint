// Discount Earned (src/lib/achievements.ts, the discount_earned rule) counts,
// once the new course is live, the approvals the map shows (discount.ts
// requestCounts): one made on or after the day the course launched, and since
// T-080 one from before it for a student who first paid from 9 September
// until the launch (backend_readiness.md section 5, item 21). A June
// student's June approval re-awarded the badge after the switch while the map
// told them the offer was not for them. Before the switch any approval counts,
// as it always did.
// achievements.ts and the map's discount.ts are the real source (build.mjs
// copies them); the database is stub-server.ts's stand-in.
import { buildAchievementSnapshot, evaluateAchievements } from './_gen/achievements.ts'
import { discountState, DISCOUNT_LAUNCH_DATE } from './_gen/discount.ts'
import { FakeDb, fakeClient } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

const RESET = '2026-10-20T18:30:00.000Z'
const JUNE = '2026-06-03T10:00:00.000Z'
const OCT_12 = '2026-10-12T10:00:00.000Z'
const LAUNCH = DISCOUNT_LAUNCH_DATE
const JUST_BEFORE = new Date(Date.parse(LAUNCH) - 1).toISOString()

/** A student and their discount requests, as [status, created_at]. */
function dbFor(requests, { reset = null, paid = JUNE } = {}) {
  return new FakeDb({
    students: [{ id: 's1', joined_at: paid, first_paid_at: paid }],
    lessons: [{ id: 'a1l01', region_id: 'a1', sort_order: 1 }],
    discount_requests: requests.map(([status, created_at], i) => ({ id: `d${i}`, student_id: 's1', status, created_at })),
    admin_config: reset ? [{ key: 'curriculum_reset_at', value: reset }] : [],
    student_achievements: [],
  })
}
async function earned(requests, opts) {
  const snap = await buildAchievementSnapshot(fakeClient(dbFor(requests, opts)), 's1')
  return snap?.discountEarnedAt ?? null
}
/** What the map shows for the same requests: approved or applied is the offer earned. */
const mapSays = (requests, paid = JUNE) => discountState({
  now: new Date(Date.parse(RESET) + 86_400_000), firstPaidAt: paid, lessons: [], videoDoneIds: new Set(),
  requests: requests.map(([status, created_at], i) => ({ id: `d${i}`, status, created_at })),
}).kind

console.log('\n=== Before the switch: any approval, as always ===')
{
  ok(await earned([['approved', JUNE]]) === JUNE, 'a June approval earns it', JUNE)
  ok(await earned([['rejected', JUNE]]) === null, 'a rejection does not')
  ok(await earned([['approved', JUNE], ['applied', OCT_12]]) === JUNE, 'the earliest approval is the date', JUNE)
}

console.log('\n=== The new course is live: only requests made from its launch ===')
const live = { reset: RESET }
{
  const at = await earned([['approved', JUNE]], live)
  ok(at === null, 'a June approval alone: not earned (it was re-awarded after the switch)', show(at))
  ok(mapSays([['approved', JUNE]]) !== 'approved', 'and the map does not show it either', mapSays([['approved', JUNE]]))
}
for (const [label, requests, want] of [
  ['an approval on 12 October', [['approved', OCT_12]], OCT_12],
  ['applied on 12 October', [['applied', OCT_12]], OCT_12],
  ['a request made at the launch to the millisecond', [['approved', LAUNCH]], LAUNCH],
  ['a request one millisecond before it', [['approved', JUST_BEFORE]], null],
  ['a June approval and an October one: the October one', [['approved', JUNE], ['applied', OCT_12]], OCT_12],
  ['a June approval and an October rejection', [['approved', JUNE], ['rejected', OCT_12]], null],
  ['an October request still pending', [['pending', OCT_12]], null],
]) {
  const at = await earned(requests, live)
  const map = mapSays(requests)
  const mapEarned = map === 'approved' || map === 'applied'
  ok(at === want && (at !== null) === mapEarned, `${label}: ${want ? 'earned' : 'not earned'}, as the map shows it`, show({ badge: at, map }))
}

console.log('\n=== The new course is live: a September joiner\'s approval from the old course (T-080) ===')
{
  // First paid from 9 September until the launch: the map shows an old
  // approval as theirs (discount.ts requestCounts), so the badge counts it.
  const SEPT_5 = '2026-09-05T10:00:00.000Z'
  const SEPT_10 = '2026-09-10T10:00:00.000Z'
  const SEPT_15 = '2026-09-15T10:00:00.000Z'
  const SEPT_25 = '2026-09-25T10:00:00.000Z'
  for (const [label, requests, paid, want] of [
    ['first paid 15 September, approved on 25 September', [['approved', SEPT_25]], SEPT_15, SEPT_25],
    ['first paid 15 September, applied on 25 September', [['applied', SEPT_25]], SEPT_15, SEPT_25],
    ['first paid 15 September, rejected on 25 September', [['rejected', SEPT_25]], SEPT_15, null],
    ['first paid 15 September, approved on 25 September and applied on 12 October', [['approved', SEPT_25], ['applied', OCT_12]], SEPT_15, SEPT_25],
    ['first paid 5 September (before 9 September), approved on 10 September', [['approved', SEPT_10]], SEPT_5, null],
  ]) {
    const at = await earned(requests, { reset: RESET, paid })
    const map = mapSays(requests, paid)
    const mapEarned = map === 'approved' || map === 'applied'
    ok(at === want && (at !== null) === mapEarned, `${label}: ${want ? 'earned' : 'not earned'}, as the map shows it`, show({ badge: at, map }))
  }
}

console.log('\n=== Through evaluateAchievements ===')
{
  const db = dbFor([['approved', JUNE]], live)
  const got = await evaluateAchievements(fakeClient(db), 's1')
  ok(!got.includes('discount_earned') && !db.rows('student_achievements').some((r) => r.achievement_id === 'discount_earned'),
     'a June student after the switch: the badge is not inserted', show(got))
  const db2 = dbFor([['approved', OCT_12]], { reset: RESET, paid: OCT_12 })
  const got2 = await evaluateAchievements(fakeClient(db2), 's1')
  ok(got2.includes('discount_earned'), 'an October approval after the switch: inserted', show(got2))
  const db3 = dbFor([['approved', JUNE]])
  const got3 = await evaluateAchievements(fakeClient(db3), 's1')
  ok(got3.includes('discount_earned'), 'and before the switch, the June approval still earns it', show(got3))
  const db4 = dbFor([['applied', '2026-09-25T10:00:00.000Z']], { reset: RESET, paid: '2026-09-15T10:00:00.000Z' })
  const got4 = await evaluateAchievements(fakeClient(db4), 's1')
  ok(got4.includes('discount_earned'), 'a September joiner whose 30% was applied in September, after the switch: inserted, as the map shows it', show(got4))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
