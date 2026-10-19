// The 30%'s full-screen moment on the map (bug hunt 2026-10-19, streak-2):
// which application it plays for, through the real rules.
//
// The moment was kept for an approved discount (Lovro, decision 11 B), but the
// map passed a request only while its state was "approved". The team presses
// Approve and Mark applied in one sitting, so a student who is next on the map
// after that finds it "applied", and the moment never played. Since the fix the
// map asks celebrations.ts approvalOnMap: approved, or applied since, not made
// on the old dashboard before the launch. The browser key is still the request
// id, so one celebrated while approved does not play again once applied.
//
// The states come from the real discountState (the _gen copy of
// src/lib/world/discount.ts) for a student who paid after the launch and one
// who paid in early October and applied on the old dashboard, so the test
// follows the rule the map itself runs. The second half reads the map's
// source: WorldMap.tsx hands the celebration approvalOnMap's answer, and the
// celebration's line for an applied one is the plain one asked for.
//
//   node client-tests/build.mjs && node --experimental-strip-types client-tests/discount-celebration.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const C = await import('./_gen/celebrations.ts')
const D = await import('./_gen/discount.ts')
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

// ── A catalog with a gate, and the two students ─────────────────────────────
const lessons = [
  { id: 'l1', type: 'watch', counts_toward_progress: true, is_gate: false, has_video: true, duration_seconds: 600 },
  { id: 'l2', type: 'watch', counts_toward_progress: true, is_gate: true, has_video: true, duration_seconds: 600 },
]
const LAUNCH = Date.parse(D.DISCOUNT_LAUNCH_DATE)
const DAY = 86_400_000
/** Paid five days after the launch, applied two days later (on the new course). */
const NEW_PAID = new Date(LAUNCH + 5 * DAY).toISOString()
const NEW_ASKED = new Date(LAUNCH + 7 * DAY).toISOString()
/** Paid on 2 October (the shared window), applied on 6 October, before the launch, on the old dashboard. */
const OLD_PAID = '2026-10-02T10:00:00.000Z'
const OLD_ASKED = '2026-10-06T10:00:00.000Z'
const NOW = new Date(LAUNCH + 9 * DAY)

const stateOf = (firstPaidAt, requests) =>
  D.discountState({ now: NOW, firstPaidAt, lessons, videoDoneIds: new Set(['l1', 'l2']), requests })
const newCourse = (status) => stateOf(NEW_PAID, [{ id: 'req-new', status, created_at: NEW_ASKED }])
const oldCourse = (status) => stateOf(OLD_PAID, [{ id: 'req-old', status, created_at: OLD_ASKED }])

console.log('\nThe states are the real discountState\'s')
ok(newCourse('applied').kind === 'applied' && newCourse('applied').madeBeforeLaunch === false, 'an application on the new course, applied', show({ kind: newCourse('applied').kind, madeBeforeLaunch: newCourse('applied').madeBeforeLaunch }))
ok(oldCourse('applied').kind === 'applied' && oldCourse('applied').madeBeforeLaunch === true, 'an application on the old dashboard, applied, still counts for an October payer (requestCounts)', show({ kind: oldCourse('applied').kind, madeBeforeLaunch: oldCourse('applied').madeBeforeLaunch }))

console.log('\nWhich application the map\'s moment plays for (approvalOnMap)')
ok(typeof C.approvalOnMap === 'function', 'celebrations.ts has approvalOnMap')
if (typeof C.approvalOnMap === 'function') {
  const cases = [
    ['approved on the new course: plays, its line the team is putting it on', newCourse('approved'), { requestId: 'req-new', applied: false }],
    ['applied on the new course before the student is back on the map (Approve and Mark applied in one sitting): plays, its line says it is on', newCourse('applied'), { requestId: 'req-new', applied: true }],
    ['pending: nothing', newCourse('pending'), null],
    ['rejected: nothing', newCourse('rejected'), null],
    ['approved on the old dashboard before the launch: nothing (its 30% may already be on a past payment)', oldCourse('approved'), null],
    ['applied on the old dashboard before the launch: nothing', oldCourse('applied'), null],
    ['in review on the old dashboard: nothing', oldCourse('pending'), null],
    ['every video watched, nothing applied for (ready): nothing', stateOf(NEW_PAID, []), null],
    ['no first payment on record: nothing', stateOf(null, []), null],
  ]
  for (const [name, state, want] of cases) {
    const got = C.approvalOnMap(state)
    ok(show(got) === show(want), name, `${state.kind} → ${show(got)}`)
  }

  console.log('\nOnce per application in this browser, approved or applied')
  const approved = C.approvalOnMap(newCourse('approved'))
  const applied = C.approvalOnMap(newCourse('applied'))
  ok(C.approvalToCelebrate(applied.requestId, null) === true, 'applied, never celebrated here: it plays')
  ok(approved.requestId === applied.requestId && C.approvalToCelebrate(applied.requestId, approved.requestId) === false,
     'celebrated while approved (the key is the request id), then applied: it does not play again', show({ key: approved.requestId, now: applied.requestId }))
}

console.log('\nThe map hands the celebration this rule, and the applied line')
const host = read('src/components/world/WorldMap.tsx')
ok(/const approval = approvalOnMap\(discountNow\);/.test(host), 'WorldMap.tsx asks approvalOnMap with its discount state')
ok(/approvedRequestId=\{approval\?\.requestId \?\? null\}/.test(host) && /applied=\{approval\?\.applied \?\? false\}/.test(host),
   'and passes its request id and whether it is applied to WorldCelebrations')
ok(!/discountNow\.kind === "approved"/.test(host), 'no copy of the old approved-only test is left in WorldMap.tsx')
const moment = read('src/components/map/DiscountApprovedCelebration.tsx')
ok(/where === "map" && applied \? \(\s*<>Your 30% is on your next payment\.<\/>/.test(moment), 'the map\'s line for an applied one: "Your 30% is on your next payment."')
ok(/applied=\{applied\}/.test(read('src/components/world/WorldCelebrations.tsx')), 'WorldCelebrations passes it on')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
