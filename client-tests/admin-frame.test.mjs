// admin-frame.test.mjs: the admin's frame and what admin rebuild 2 removed
// (WI-1; _admin/prds/admin-rebuild-2/admin_rebuild_2_prd.md in the
// workspace, D1, D2, D11 and D12 for the frame).
//
//   D1   the top bar's entries for each role, in order, with no "More"; the
//        Dashboard as the home every sign-in, set-password and the lockup
//        go to; which pages wear the dark look, "/admin" covering itself only
//   D2   Today, Brand Owners, Stats, Settings and Discord test gone: their
//        files, their vercel.json pins, and every link, fetch and import of
//        them in src/
//   D11  the 2 Whop product ids, moved from etfb.ts to whop-products.ts with
//        the values etfb.ts held, in the form login-1's test reads
//   D12  no plan or subscription in the frame
//
// The frame's rules are src/lib/admin/admin-frame.ts, copied by build.mjs
// (run it first; `npm run test:client` does). The pages that use them are
// read as source: no browser runs here. world-tests/admin-pages.mjs draws
// the bar in Chrome for each role.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ADMIN_HOME, ADMIN_NAV, entriesFor, isActive, isRebuiltPage } from './_gen/admin-frame.ts'
import { ETFB_PRODUCT_ID, TEAM_SEAT_PRODUCT_ID } from './_gen/whop-products.ts'

/** world-engine when admin rebuild 2 started: etfb.ts as it was before it was deleted. */
const BASE = 'd0ebe76'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

/** A role's bar as words: "Students[All students, Student journey]" for a group. */
const barOf = (role) => entriesFor(role).map((e) => (e.type === 'leaf' ? e.label : `${e.label}[${e.children.map((c) => c.label).join(', ')}]`))
const leavesOf = (entries) => entries.flatMap((e) => (e.type === 'leaf' ? [e] : e.children))

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== D1: the bar for each role ===')
{
  const founder = barOf('founder')
  ok(show(founder) === show(['Dashboard', '30% off', 'Tasks', 'Students[All students, Student journey]', 'Feedback[Lesson feedback, Survey]', 'Templates', 'Insights', 'Team']),
     'a founder: Dashboard · 30% off · Tasks · Students ▾ · Feedback ▾ · Templates · Insights · Team', show(founder))
  const admin = barOf('admin')
  ok(show(admin) === show(['Dashboard', '30% off', 'Tasks', 'Students[All students, Student journey]', 'Feedback[Lesson feedback, Survey]', 'Templates', 'Insights']),
     'an admin: the same without Team (founder only, as before)', show(admin))
  const csm = barOf('csm')
  ok(show(csm) === show(['Dashboard', '30% off', 'Tasks', 'Students[All students, Student journey]', 'Templates', 'Insights']),
     'a csm: no Feedback (both its pages are hidden from the csm role, as they were) and no Team', show(csm))
  ok(show(barOf(undefined)) === show(admin), 'no member read yet: the founder-only entry stays hidden')
  ok(ADMIN_NAV[0].type === 'leaf' && ADMIN_NAV[0].label === 'Dashboard' && ADMIN_NAV[0].href === ADMIN_HOME,
     'Dashboard is the first entry, and it is the home')
  ok(!ADMIN_NAV.some((e) => e.label === 'More'), 'no "More"')
  const labels = leavesOf(ADMIN_NAV).map((l) => l.label).concat(ADMIN_NAV.map((e) => e.label))
  ok(!labels.some((l) => /plan|subscri/i.test(l)), 'D12: no entry speaks of a plan or a subscription', show(labels))
  ok(['Today', 'Brand Owners', 'Stats', 'Settings', 'Discord test'].every((gone) => !labels.includes(gone)), 'D2: none of the 5 removed pages is in the bar')
}

console.log('\n=== D1: every entry opens a page that exists ===')
for (const leaf of leavesOf(ADMIN_NAV)) {
  const file = `src/app/admin/(authenticated)${leaf.href.slice('/admin'.length)}/page.tsx`
  ok(exists(file), `${leaf.label}: ${leaf.href} is ${file}`)
}

console.log('\n=== D1: which entry is marked ===')
{
  const marked = (pathname) => leavesOf(entriesFor('founder')).filter((l) => isActive(l, pathname)).map((l) => l.label)
  const cases = [
    ['/admin', ['Dashboard']],
    ['/admin/discounts', ['30% off']],
    ['/admin/tasks', ['Tasks']],
    ['/admin/tasks/insights', ['Tasks']],
    ['/admin/students', ['All students']],
    ['/admin/students/s-123', ['All students']],
    ['/admin/journey', ['Student journey']],
    ['/admin/feedback/lessons', ['Lesson feedback']],
    ['/admin/feedback/survey', ['Survey']],
    ['/admin/templates', ['Templates']],
    ['/admin/insights/progress', ['Insights']],
    ['/admin/team', ['Team']],
    ['/admin/cutover', []],
    ['/admin/not-activated', []],
  ]
  for (const [pathname, want] of cases) {
    const got = marked(pathname)
    ok(show(got) === show(want), `${pathname}: ${want.length ? want.join(', ') : 'nothing'} marked`, show(got))
  }
}

console.log('\n=== D1: the dark look, "/admin" covering itself only ===')
{
  const cases = [
    [['/admin/discounts'], '/admin/discounts', true],
    [['/admin/discounts'], '/admin/discounts/anything', true],
    [['/admin/discounts'], '/admin/discountsx', false],
    [['/admin/discounts'], '/admin', false],
    [['/admin'], '/admin', true],
    [['/admin'], '/admin/tasks', false],
    [['/admin'], '/admin/discounts', false],
    [['/admin', '/admin/tasks'], '/admin/tasks/insights', true],
    [['/admin', '/admin/tasks'], '/admin/students', false],
    [[], '/admin', false],
  ]
  for (const [pages, pathname, want] of cases) {
    ok(isRebuiltPage(pathname, pages) === want, `${show(pages)} and ${pathname}: ${want ? 'dark' : 'light'}`)
  }
  const layout = src('src/app/admin/(authenticated)/layout.tsx')
  const listed = layout.match(/const REBUILT_PAGES[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? null
  const pages = listed === null ? [] : [...listed.matchAll(/^\s*"([^"]+)",?\s*$/gm)].map((m) => m[1])
  // Each lane of admin rebuild 2 adds its own pages here, so this holds whatever they add.
  ok(pages.includes('/admin/discounts') && !pages.includes('/admin/today'), 'layout.tsx lists the 30% page as dark, and no longer Today', show(pages))
  ok(pages.length > 0 && pages.every((p) => exists(`src/app/admin/(authenticated)${p.slice('/admin'.length)}/page.tsx`)),
     'every address it lists is an admin page that exists', show(pages))
  ok(/isRebuiltPage\(pathname, REBUILT_PAGES\)/.test(layout), 'and asks isRebuiltPage, so "/admin" added later stays exact')
  ok(layout.includes('className="admin-shell'), 'the frame keeps the .admin-shell class')
}

console.log('\n=== D1: every way in lands on the Dashboard ===')
{
  ok(ADMIN_HOME === '/admin', `the home is /admin (${ADMIN_HOME})`)
  const login = src('src/app/admin/login/page.tsx')
  const setPassword = src('src/app/admin/set-password/page.tsx')
  const bar = src('src/components/admin/AdminTopNav.tsx')
  ok(/window\.location\.href = ADMIN_HOME;/.test(login) && login.includes('from "@/lib/admin/admin-frame"'),
     'signing in sends the browser to ADMIN_HOME')
  ok(/window\.location\.href = ADMIN_HOME;/.test(setPassword) && setPassword.includes('from "@/lib/admin/admin-frame"'),
     'setting a password after an invite does too')
  ok(/<Link\s+href=\{ADMIN_HOME\}/.test(bar), 'the lockup links to ADMIN_HOME')
  // The other ways a team member reaches the admin, which already went to /admin.
  for (const [file, re] of [
    ['src/app/page.tsx', /router\.replace\("\/admin"\)/],
    ['src/components/auth/StudentGuard.tsx', /router\.replace\("\/admin"\)/],
    ['src/app/admin/(authenticated)/error.tsx', /window\.location\.href = "\/admin"/],
  ]) ok(re.test(src(file)), `${file} sends the team to /admin`)
  const code = bar.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  ok(!/<(Pill|MembershipPill|PacePill)\b/.test(code) && !/\b(plans?|subscriptions?|subscribed)\b/i.test(code),
     'D12: the bar draws no pill and names no plan or subscription')
}

console.log('\n=== D2: the 5 pages, their routes and their modules are gone ===')
{
  const gone = [
    'src/app/admin/(authenticated)/today', 'src/components/admin/today', 'src/app/api/admin/today',
    'src/lib/admin/today-data.ts', 'src/lib/admin/support-list.ts', 'src/app/dev/admin/today',
    'src/app/admin/(authenticated)/etfb', 'src/app/api/admin/etfb', 'src/lib/etfb.ts',
    'src/app/admin/(authenticated)/stats', 'src/app/api/admin/stats', 'src/lib/whop-stats.ts', 'src/lib/whop-stats-catalog.ts',
    'src/app/admin/(authenticated)/settings',
    'src/app/admin/(authenticated)/discord', 'src/app/api/admin/dm-toggles', 'src/app/api/admin/preview-day28-dm',
  ]
  const still = gone.filter(exists)
  ok(still.length === 0, `${gone.length} files and folders removed`, still.join(', '))
  ok(exists('src/app/api/admin/config/route.ts'), 'PUT /api/admin/config stays, for the Templates page (D6)')
  ok(exists('src/lib/dm-toggles.ts') && /export async function isDmEnabled/.test(src('src/lib/dm-toggles.ts')) && /export async function readDmEnabled/.test(src('src/lib/dm-toggles.ts')),
     'the switches\' readers stay (isDmEnabled, readDmEnabled)')
  const admin = src('src/lib/admin-auth.ts')
  ok(!/STATS_ALLOWED_USER_IDS|isStatsOwner|requireStatsOwner/.test(admin) && /export async function requireTeam/.test(admin),
     'admin-auth.ts keeps requireTeam and drops the Stats allowlist')
  const vercel = JSON.parse(src('vercel.json'))
  const pinned = Object.keys(vercel.functions ?? {})
  ok(!pinned.some((k) => /\/api\/admin\/(etfb|stats|today|dm-toggles|preview-day28-dm)\//.test(k)), 'vercel.json pins none of their routes', show(pinned))
}

console.log('\n=== D2: nothing in src/ links to, fetches or imports them ===')
{
  const files = []
  const walk = (dir) => {
    for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, d.name)
      if (d.isDirectory()) walk(rel)
      else if (/\.(ts|tsx|js|jsx|mjs|css|json)$/.test(d.name)) files.push(rel)
    }
  }
  walk('src')
  ok(files.length > 300, 'every source file under src is read', `${files.length} files`)
  // An address in quotes or backticks is a link, a redirect or a fetch; one in a comment is history.
  const PAGE = /["'`]\/admin\/(today|etfb|stats|settings|discord)(?=["'`/?#])/
  const API = /["'`]\/api\/admin\/(today|etfb|stats|dm-toggles|preview-day28-dm)(?=["'`/?#])/
  const MODULE = /from\s+["']@\/lib\/(etfb|whop-stats|whop-stats-catalog|admin\/support-list|admin\/today-data)["']|from\s+["']@\/components\/admin\/today\//
  const hits = []
  for (const rel of files) {
    const lines = src(rel).split('\n')
    lines.forEach((line, i) => {
      if (PAGE.test(line) || API.test(line) || MODULE.test(line)) hits.push(`${rel}:${i + 1}`)
    })
  }
  ok(hits.length === 0, 'no address of a removed page or route, and no import of a removed module', hits.slice(0, 5).join(', '))
}

console.log('\n=== D11: the Whop product ids, moved out of etfb.ts ===')
{
  const before = execFileSync('git', ['show', `${BASE}:src/lib/etfb.ts`], { cwd: ROOT, encoding: 'utf8' })
  // The form login-1's whop-product-setting.test.mjs reads, applied to both files.
  const declared = (text, name) => text.match(new RegExp(`export const ${name} = "([^"]+)";`))?.[1] ?? null
  const now = src('src/lib/whop-products.ts')
  for (const name of ['ETFB_PRODUCT_ID', 'TEAM_SEAT_PRODUCT_ID']) {
    ok(declared(before, name) !== null && declared(now, name) === declared(before, name),
       `${name}: whop-products.ts holds the value etfb.ts held at ${BASE}, in the form login-1's test reads`, `${declared(before, name)} -> ${declared(now, name)}`)
  }
  ok(ETFB_PRODUCT_ID === declared(before, 'ETFB_PRODUCT_ID') && TEAM_SEAT_PRODUCT_ID === declared(before, 'TEAM_SEAT_PRODUCT_ID'),
     'and the module exports exactly those values')
  const first = now.split('\n')[0]
  ok(first.startsWith('//') && /login-1/.test(first) && /night\/login1-main/.test(first) && /etfb\.ts/.test(first) && /this file/.test(first),
     'its first line says login-1 (night/login1-main) has its own copy and its test reads etfb.ts, so the merge must point at this file', first.slice(0, 120))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
