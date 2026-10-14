import { isAllowed, resolveHome, worldIsLive } from './_gen/access.ts'

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

// ---------------------------------------------------------------------------
// Where a student lands (cutover PRD, WI-7). The rows of its Paths table are
// asked of the REAL module as the build would load it: access.ts reads
// process.env at module load, so each case sets the variables and imports a
// fresh copy (a query on the specifier makes Node load it again).
const KEYS = ['NEXT_PUBLIC_STUDENT_HOME', 'NEXT_PUBLIC_WORLD_LIVE', 'NEXT_PUBLIC_WORLD_PREVIEW_IDS']
let loads = 0
async function build(env) {
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, env)
  const m = await import(`./_gen/access.ts?case=${++loads}`)
  for (const k of KEYS) delete process.env[k]
  return m
}

console.log('\n=== WI-7 paths, on the module as a build loads it ===')
{
  const m = await build({})
  ok(m.STUDENT_HOME === '/dashboard' && m.HOME_IS_DASHBOARD === true, 'nothing set: the home is /dashboard, as today', m.STUDENT_HOME)
  ok(m.canSeeWorld(SOMEONE) === false && m.WORLD_IS_LIVE === false, 'home /dashboard, live unset, not listed: closed, as today')
}
{
  const m = await build({ NEXT_PUBLIC_STUDENT_HOME: '/dashboard' })
  ok(m.canSeeWorld(SOMEONE) === false && m.HOME_IS_DASHBOARD === true, 'home set to /dashboard explicitly: still closed, no forward')
}
{
  const m = await build({ NEXT_PUBLIC_STUDENT_HOME: '/world' })
  ok(m.WORLD_IS_LIVE === true, 'home /world, live unset: the world is live (C14)')
  ok(m.canSeeWorld(SOMEONE) === true, '...so an unlisted student gets in', 'no /world -> /world loop')
  ok(m.canSeeWorld(null) === true, '...even before the student row is known')
  ok(m.HOME_IS_DASHBOARD === false && m.STUDENT_HOME === '/world', '...and /dashboard forwards to /world')
}
{
  const m = await build({ NEXT_PUBLIC_WORLD_PREVIEW_IDS: `${SOMEONE}, ${ME}` })
  ok(m.canSeeWorld(ME) === true, 'listed student, live unset: open, as today')
  ok(m.canSeeWorld('33333333-3333-3333-3333-333333333333') === false, '...and an unlisted one is still closed')
  ok(m.HOME_IS_DASHBOARD === true, '...and the home stays /dashboard')
}
{
  const m = await build({ NEXT_PUBLIC_WORLD_LIVE: 'true' })
  ok(m.canSeeWorld(SOMEONE) === true && m.HOME_IS_DASHBOARD === true, 'live set, home unset: open, home still /dashboard, as today')
}
{
  const m = await build({ NEXT_PUBLIC_STUDENT_HOME: ' /world/ ' })
  ok(m.STUDENT_HOME === '/world' && m.WORLD_IS_LIVE === true, 'a home typed as " /world/ " still opens the world', m.STUDENT_HOME)
}

console.log('\n=== no setting can make a loop ===')
// The gate sends a refused student to STUDENT_HOME, and /dashboard forwards to
// STUDENT_HOME when the home is not /dashboard. Neither may target itself.
const homes = [undefined, '', '  ', '/', '/dashboard', '/dashboard/', '/world', '/world/', ' /world ', '/world//']
const lives = [undefined, '', 'false', 'true']
let combos = 0, loops = []
for (const h of homes) for (const l of lives) {
  const env = {}
  if (h !== undefined) env.NEXT_PUBLIC_STUDENT_HOME = h
  if (l !== undefined) env.NEXT_PUBLIC_WORLD_LIVE = l
  const m = await build(env)
  combos++
  if (!m.WORLD_IS_LIVE && m.STUDENT_HOME === '/world') loops.push(`home ${JSON.stringify(h)} live ${JSON.stringify(l)}: /world -> /world`)
  if (!m.HOME_IS_DASHBOARD && m.STUDENT_HOME === '/dashboard') loops.push(`home ${JSON.stringify(h)}: /dashboard -> /dashboard`)
}
ok(loops.length === 0, `none of ${combos} home x live settings loops`, loops.join('; '))

console.log('\n=== the two rules, inputs passed in ===')
ok(resolveHome(undefined) === '/dashboard', 'unset home -> /dashboard')
ok(resolveHome('') === '/dashboard' && resolveHome('   ') === '/dashboard', 'empty or blank home -> /dashboard')
ok(resolveHome('/') === '/dashboard', '"/" is not a home -> /dashboard')
ok(resolveHome('/world') === '/world' && resolveHome('/world/') === '/world', '/world and /world/ -> /world')
ok(resolveHome('/dashboard/') === '/dashboard', '/dashboard/ -> /dashboard, so it never forwards to itself')
ok(worldIsLive(undefined, '/dashboard') === false, 'live unset + home /dashboard -> closed')
ok(worldIsLive('false', '/dashboard') === false, 'live "false" + home /dashboard -> closed')
ok(worldIsLive('true', '/dashboard') === true, 'live "true" -> open, whatever the home')
ok(worldIsLive(undefined, '/world') === true, 'home /world -> open, live or not')
ok(worldIsLive('TRUE', '/dashboard') === false, 'only the exact "true" opens it, as today')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
