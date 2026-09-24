import { isAllowed } from './_gen/access.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const ME = '11111111-1111-1111-1111-111111111111'
const SOMEONE = '22222222-2222-2222-2222-222222222222'

console.log('\n=== closed by default — the property that matters ===')
// If this inverts, 845 students walk into a half-built UI the moment it
// deploys. Forgetting to configure the variable must HIDE the world.
ok(isAllowed(ME, [], false) === false, 'empty allowlist admits nobody, not everybody')
ok(isAllowed(SOMEONE, [], false) === false, '...including a real, logged-in student')
ok(isAllowed(null, [], false) === false, 'a logged-out visitor is refused')
ok(isAllowed(undefined, [], false) === false, 'so is an undefined id')

console.log('\n=== the allowlist ===')
ok(isAllowed(ME, [ME], false) === true, 'a listed id gets in')
ok(isAllowed(SOMEONE, [ME], false) === false, 'an unlisted id does not')
ok(isAllowed(ME, [SOMEONE, ME], false) === true, 'order does not matter')
ok(isAllowed(null, [ME], false) === false, 'a null id is never admitted by a non-empty list')
// Exact match only: a prefix or a substring must not slip through.
ok(isAllowed('1111', [ME], false) === false, 'a PREFIX of a listed id is refused')
ok(isAllowed(ME, ['1111'], false) === false, 'and a listed prefix does not admit the full id')

console.log('\n=== the cutover switch ===')
ok(isAllowed(SOMEONE, [], true) === true, 'WORLD_LIVE opens it to everyone')
ok(isAllowed(null, [], true) === true, '...even before the student row is known')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
