// The map's two celebrations (src/lib/world/celebrations.ts, read by
// src/components/world/WorldCelebrations.tsx): the same browser keys as the
// old dashboard, so one seen there is not shown again on the map, and the
// dashboard's rules for when each fires.
//
// The dashboard's rules live inside its page component (src/app/dashboard/
// page.tsx), which Node cannot run. So the keys are read out of that file's
// text and must match the module's exactly, and the rules are asked the
// questions the dashboard's two effects answer.
import fs from 'node:fs'

const C = await import('./_gen/celebrations.ts')
const dashboard = fs.readFileSync(new URL('../src/app/dashboard/page.tsx', import.meta.url), 'utf8')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

console.log('\nThe browser keys are the dashboard\'s')
const discountKey = /const DISCOUNT_APPROVED_LAST_SEEN_KEY = "([^"]+)";/.exec(dashboard)?.[1]
ok(discountKey === C.DISCOUNT_APPROVED_LAST_SEEN_KEY, 'the approval key', `${show(discountKey)} = ${show(C.DISCOUNT_APPROVED_LAST_SEEN_KEY)}`)
const streakTemplate = /const streakLastSeenKey = \(studentId: string\) =>\s*`([^`]+)`;/.exec(dashboard)?.[1]
ok(streakTemplate === 'et.streak.lastSeen.${studentId}' && C.streakLastSeenKey('s-1') === 'et.streak.lastSeen.s-1',
   'the streak key, per student', `${show(streakTemplate)} → ${show(C.streakLastSeenKey('s-1'))}`)
ok(dashboard.includes('if (streak.current > lastSeen) {') && dashboard.includes('if (lastSeen === id) return;'),
   'the dashboard still decides with the two comparisons these rules copy')

console.log('\nThe streak: above the one last celebrated here, never 0, never twice')
const cases = [
  [0, null, null, 'no streak: nothing'],
  [-1, null, null, 'a negative streak: nothing'],
  [1, null, 1, 'day one, nothing stored (a new browser): 1'],
  [4, null, 4, 'a 4-day streak earned elsewhere, first seen here: 4'],
  [4, '4', null, 'the same count again (a reload): nothing'],
  [5, '4', 5, 'one more day: 5'],
  [3, '5', null, 'below the stored one (the streak broke and restarts): nothing until it passes it'],
  [6, '5', 6, '... and once it does: 6'],
  [3, '', 3, 'an empty stored value counts as 0: 3'],
  [3, 'abc', null, 'a stored value that is not a number: nothing, as on the dashboard'],
]
for (const [current, raw, want, name] of cases) {
  const got = C.streakToCelebrate(current, raw)
  ok(got === want, name, `streakToCelebrate(${current}, ${show(raw)}) = ${show(got)}`)
}

console.log('\nThe approval: once per approved request in this browser')
ok(C.approvalToCelebrate(null, null) === false, 'nothing approved: nothing')
ok(C.approvalToCelebrate('req-1', null) === true, 'approved, never celebrated here: celebrate')
ok(C.approvalToCelebrate('req-1', 'req-1') === false, 'already celebrated (here or on the dashboard): nothing')
ok(C.approvalToCelebrate('req-2', 'req-1') === true, 'another request approved later: celebrate it')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
