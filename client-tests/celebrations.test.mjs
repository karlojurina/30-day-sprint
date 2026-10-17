// The map's two celebrations (src/lib/world/celebrations.ts, read by
// src/components/world/WorldCelebrations.tsx): the same browser keys as the
// old dashboard, so one seen there is not shown again on the map, and the
// dashboard's rules for when each fires, but for a streak after a break,
// which the map marks since 2026-10-17 and the dashboard does not.
//
// The dashboard's rules live inside its page component (src/app/dashboard/
// page.tsx), which Node cannot run. So the keys are read out of that file's
// text and must match the module's exactly, and the rules are asked the
// questions the dashboard's two effects answer, and the break's.
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
   'the dashboard still decides with the two comparisons these rules start from (the map adds a streak after a break, 2026-10-17)')

console.log('\nThe streak: any count other than the one last marked here, never 0, never twice')
const cases = [
  [0, null, null, 'no streak: nothing'],
  [-1, null, null, 'a negative streak: nothing'],
  [0, '5', null, 'a broken streak (0): nothing, whatever is stored'],
  [1, null, 1, 'day one, nothing stored (a new browser): 1'],
  [4, null, 4, 'a 4-day streak earned elsewhere, first seen here: 4'],
  [4, '4', null, 'the same count again (a reload): nothing'],
  [5, '4', 5, 'one more day: 5'],
  [3, '5', 3, 'below the stored one: a new streak after a break this browser did not see (a streak only goes up until it breaks): 3'],
  [1, '5', 1, 'a new streak\'s first day below an old 5: 1'],
  [1, '0', 1, 'the 0 the map stores when it shows a broken streak: the new streak\'s first day, 1'],
  [1, '1', null, 'a 1 already marked: nothing (the stored 0 above is what lets a new 1 after an old 1 through)'],
  [6, '5', 6, 'above the stored one: 6'],
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
