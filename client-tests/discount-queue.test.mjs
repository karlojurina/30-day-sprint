// discount-queue.test.mjs: which requests /admin/discounts lists
// (isListedDiscountRequest in src/lib/admin/metrics-definitions.ts).
// backend_readiness.md section 5, item 22: the page's cohort filter, a .gte()
// on the embedded student, never dropped a row; older requests showed as
// "Unknown". The page now drops them itself, and never a request the team
// still has to act on: the /admin tile and the course switch's preflight count
// every pending one, and an approved one waits for "Mark applied".
//
// The copies are made here rather than in build.mjs (see
// outreach-cutover.test.mjs): only the one import line is rewritten.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
function gen(srcRel, outRel, rewrites = []) {
  let s = fs.readFileSync(here(`../${srcRel}`), 'utf8')
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${srcRel} has no ${from}`)
    s = s.split(from).join(to)
  }
  if (s.includes('@/')) throw new Error(`an unrewritten @/ import remains in ${srcRel}`)
  fs.writeFileSync(here(outRel), s)
  console.log(`generated ${outRel} from ${srcRel}`)
}
// constants.ts has no imports; build.mjs makes the same copy.
gen('src/lib/constants.ts', './_gen/constants.ts')
gen('src/lib/admin/metrics-definitions.ts', './_gen/metrics-definitions.ts', [
  ['from "@/lib/constants"', 'from "./constants.ts"'],
])

const { isListedDiscountRequest, isInLaunchCohort } = await import('./_gen/metrics-definitions.ts')
const { ADMIN_STUDENT_JOIN_CUTOFF } = await import('./_gen/constants.ts')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

// first_paid_at as PostgREST returns a timestamptz.
const IN_COHORT = { first_paid_at: '2026-06-02T09:15:00+00:00' }
const BEFORE = { first_paid_at: '2026-04-11T17:40:00+00:00' }
const NO_DATE = { first_paid_at: null }
const STATUSES = ['pending', 'approved', 'applied', 'rejected']

console.log(`=== The rule (cutoff ${ADMIN_STUDENT_JOIN_CUTOFF}) ===`)
for (const status of STATUSES) {
  ok(isListedDiscountRequest(status, IN_COHORT) === true, `${status}, a student in the launch cohort: listed`)
}
for (const [who, student] of [['who first paid before the launch', BEFORE], ['with no first payment date', NO_DATE], ['whose row is missing', null], ['left undefined', undefined]]) {
  ok(isListedDiscountRequest('pending', student) === true, `pending, a student ${who}: listed (it waits for a decision)`)
  ok(isListedDiscountRequest('approved', student) === true, `approved, a student ${who}: listed (it waits for Mark applied)`)
  ok(isListedDiscountRequest('applied', student) === false, `applied, a student ${who}: dropped`)
  ok(isListedDiscountRequest('rejected', student) === false, `rejected, a student ${who}: dropped`)
}
ok(isListedDiscountRequest('applied', { first_paid_at: ADMIN_STUDENT_JOIN_CUTOFF }) === true,
  'applied, first paid at the cutoff written the app\'s way: listed (on or after)')
ok(isListedDiscountRequest('applied', BEFORE) === isInLaunchCohort(BEFORE) && isListedDiscountRequest('applied', IN_COHORT) === isInLaunchCohort(IN_COHORT),
  'a history row follows isInLaunchCohort, the cohort every other admin list uses')

console.log('=== A queue as the page filters it ===')
{
  // One request per status for each kind of student, as the "All" tab fetches them.
  const rows = []
  for (const [who, student] of [['in', IN_COHORT], ['before', BEFORE], ['nodate', NO_DATE], ['missing', null]]) {
    for (const status of STATUSES) rows.push({ id: `${who}-${status}`, status, student })
  }
  const listed = rows.filter((r) => isListedDiscountRequest(r.status, r.student)).map((r) => r.id)
  const expected = [
    'in-pending', 'in-approved', 'in-applied', 'in-rejected',
    'before-pending', 'before-approved', 'nodate-pending', 'nodate-approved', 'missing-pending', 'missing-approved',
  ]
  ok(JSON.stringify(listed) === JSON.stringify(expected), 'All: the cohort\'s whole history plus everything still waiting on the team', listed.join(','))
  const pending = rows.filter((r) => r.status === 'pending')
  ok(pending.every((r) => isListedDiscountRequest(r.status, r.student)),
    'every pending request is listed whoever made it, so the Pending tab, the /admin tile and the preflight agree',
    `${pending.length} of ${pending.length}`)
  ok(rows.filter((r) => r.status === 'applied' && isListedDiscountRequest(r.status, r.student)).length === 1,
    'Applied: only the launch cohort\'s (the rows that used to show as "Unknown" are gone)')
}

console.log(`\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length > 0) {
  for (const f of fails) console.log(`  - ${f}`)
  process.exit(1)
}
