// The closed doors before the new course (T-078): src/lib/student-app-gate.ts,
// the one rule every closed door asks, and where the doors sit.
//
// The module has no import Node has to resolve (its imports are TYPES, which
// --experimental-strip-types erases), so this test imports the real file
// straight from src/, with no copy. The database is a small stand-in that
// records every read, so "open asks nothing of the database" is checked, not
// assumed. The second half reads the source of the routes and pages: every
// student route asks the gate before any read or write, the team's surfaces
// never ask it, and the allowlist lives in one server file.
//
//   node --experimental-strip-types client-tests/student-app-gate.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as gate from '../src/lib/student-app-gate.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

// ── The two Vercel values, set case by case ─────────────────────────────────
const KEYS = ['STUDENT_APP_CLOSED', 'STUDENT_APP_OPEN_FOR']
function env(values) {
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, values)
}

// ── A database stand-in: students and team_members, every read recorded ─────
function fakeDb({ students = [], team = [], fail = {}, throwOn = null } = {}) {
  const reads = []
  return {
    reads,
    from(table) {
      const q = { table, cols: '', filters: [] }
      const b = {
        select(cols) { q.cols = cols; return b },
        eq(col, value) { q.filters.push(`${col}=${value}`); return b },
        async maybeSingle() {
          reads.push(q)
          if (throwOn === table) throw new Error('network down')
          if (fail[table]) return { data: null, error: { message: fail[table] } }
          const source = table === 'students' ? students : table === 'team_members' ? team : []
          const rows = source.filter((r) => q.filters.every((f) => {
            const [col, value] = f.split('=')
            return String(r[col]) === value
          }))
          if (rows.length > 1) return { data: null, error: { message: 'multiple rows' } }
          if (!rows[0]) return { data: null, error: null }
          const cols = q.cols.split(',').map((c) => c.trim())
          return { data: Object.fromEntries(cols.map((c) => [c, rows[0][c] ?? null])), error: null }
        },
      }
      return b
    },
  }
}

const LISTED = 'user_TEST1'
const OTHER = 'user_OTHER'
const STAFF = 'user_STAFF'
const students = [
  { supabase_user_id: 'auth-test', whop_user_id: LISTED },
  { supabase_user_id: 'auth-other', whop_user_id: OTHER },
  { supabase_user_id: 'auth-staff', whop_user_id: STAFF },
]
const team = [{ id: 'auth-staff' }]

async function refusalOf(res) {
  if (res === null) return null
  return { status: res.status, body: await res.json() }
}

console.log('\n=== Lovro\'s words, exactly ===')
ok(gate.COMING_SOON_MESSAGE === 'We are updating to the new course. It will be released soon.',
  'the coming-soon sentence is his, word for word', show(gate.COMING_SOON_MESSAGE))
ok(gate.COMING_SOON_WHOP_LINE === 'Keep watching the course on Whop in the meantime.',
  'the smaller line', show(gate.COMING_SOON_WHOP_LINE))
for (const [name, text] of [
  ['the message', gate.COMING_SOON_MESSAGE],
  ['the Whop line', gate.COMING_SOON_WHOP_LINE],
  ['ComingSoon.tsx', read('src/components/auth/ComingSoon.tsx')],
]) {
  ok(!/[—–]/.test(text) && !/unlock/i.test(text), `${name}: no em dash, no "unlock"`)
}
ok(!/https?:\/\//.test(read('src/components/auth/ComingSoon.tsx')), 'the page holds no link (no course address in a public repo)')

console.log('\n=== Values unset: open, exactly as before, and the database is never asked ===')
for (const values of [{}, { STUDENT_APP_OPEN_FOR: LISTED }, { STUDENT_APP_CLOSED: '' }, { STUDENT_APP_CLOSED: 'false' }]) {
  env(values)
  const db = fakeDb({ students, team })
  const r = await refusalOf(await gate.refuseWhileClosed(db, 'auth-other'))
  const asStudent = await gate.studentMayEnterAs(db, 'auth-other')
  const login = await gate.whopLoginMayProceed(db, OTHER)
  ok(gate.studentAppClosed() === false && gate.studentMayEnter(OTHER) && gate.studentMayEnter(null)
     && r === null && asStudent === true && login === true && db.reads.length === 0,
     `${show(values)}: open to everyone, no read`, `reads ${db.reads.length}`)
}
for (const raw of [undefined, '', ' ', 'false', '0', '1', 'yes', 'closed', 'tru', 'true false']) {
  ok(gate.isClosedValue(raw) === false, `STUDENT_APP_CLOSED=${show(raw)} leaves it open`)
}
for (const raw of ['true', 'TRUE', ' True ', 'true\n']) {
  ok(gate.isClosedValue(raw) === true, `STUDENT_APP_CLOSED=${show(raw)} closes it`)
}

console.log('\n=== Closed, nobody on the list ===')
env({ STUDENT_APP_CLOSED: 'true' })
{
  ok(gate.studentAppClosed() === true, 'the app reads as closed')
  ok(gate.studentMayEnter(OTHER) === false && gate.studentMayEnter(LISTED) === false, 'no student gets in')
  ok(gate.studentMayEnter(null) === false && gate.studentMayEnter(undefined) === false && gate.studentMayEnter('') === false,
     'a missing Whop id is refused too')
  const db = fakeDb({ students, team })
  const r = await refusalOf(await gate.refuseWhileClosed(db, 'auth-other'))
  ok(r?.status === 503 && r.body.error === gate.COMING_SOON_MESSAGE && r.body.code === 'student_app_closed',
     'a student route answers 503 with Lovro\'s words', show(r))
  ok(db.reads.length === 0, 'with an empty list it refuses without a read', `reads ${db.reads.length}`)
  ok(await gate.studentMayEnterAs(fakeDb({ students }), 'auth-test') === false, 'studentMayEnterAs: no')
}
{
  const db = fakeDb({ students, team })
  ok(await gate.whopLoginMayProceed(db, OTHER) === false, 'the Whop login refuses a plain student',
     db.reads.map((q) => q.table).join(','))
  const db2 = fakeDb({ students, team })
  ok(await gate.whopLoginMayProceed(db2, 'user_NEW') === false && db2.reads.length === 1,
     'and someone with no student row yet (one read, then refused)')
}

console.log('\n=== Closed, the list names the test accounts ===')
env({ STUDENT_APP_CLOSED: 'true', STUDENT_APP_OPEN_FOR: ` ${LISTED} , user_TEST2,, ` })
{
  ok(show(gate.parseWhopIds(process.env.STUDENT_APP_OPEN_FOR)) === show([LISTED, 'user_TEST2']),
     'the list: spaces and empty entries dropped', show(gate.parseWhopIds(process.env.STUDENT_APP_OPEN_FOR)))
  ok(gate.studentMayEnter(LISTED) && gate.studentMayEnter('user_TEST2'), 'both listed ids get in')
  ok(!gate.studentMayEnter(OTHER), 'an unlisted id does not')
  ok(!gate.studentMayEnter('user_TEST') && !gate.studentMayEnter(`${LISTED}x`) && !gate.studentMayEnter(LISTED.toLowerCase()),
     'exact match only: a prefix, a longer id or another case is refused')
  ok(!gate.studentMayEnter(null), 'a missing id is still refused')
}
{
  const db = fakeDb({ students, team })
  const r = await gate.refuseWhileClosed(db, 'auth-test')
  ok(r === null, 'a student route lets a listed student through')
  ok(db.reads.length === 1 && db.reads[0].table === 'students' && db.reads[0].cols === 'whop_user_id'
     && show(db.reads[0].filters) === show(['supabase_user_id=auth-test']),
     'with one read: the Whop id of the signed-in student', show(db.reads))
}
for (const [label, db, who] of [
  ['an unlisted student', fakeDb({ students, team }), 'auth-other'],
  ['a session with no student row', fakeDb({ students, team }), 'auth-nobody'],
  ['a read that fails', fakeDb({ students, team, fail: { students: 'boom' } }), 'auth-test'],
  ['a read that throws', fakeDb({ students, team, throwOn: 'students' }), 'auth-test'],
]) {
  const r = await refusalOf(await gate.refuseWhileClosed(db, who))
  ok(r?.status === 503 && r.body.error === gate.COMING_SOON_MESSAGE, `${label}: refused`, show(r?.status))
}
{
  const db = fakeDb({ students, team })
  ok(await gate.whopLoginMayProceed(db, LISTED) === true && db.reads.length === 0,
     'the Whop login lets a listed id through, with no read')
  ok(await gate.whopLoginMayProceed(fakeDb({ students, team }), OTHER) === false, 'and refuses an unlisted one')
}

console.log('\n=== The team ===')
env({ STUDENT_APP_CLOSED: 'true' })
ok(gate.mayEnter({ closed: true, whopUserId: null, openFor: [], isTeam: true }) === true, 'the rule always lets the team in')
{
  const db = fakeDb({ students, team })
  const through = await gate.whopLoginMayProceed(db, STAFF)
  ok(through === true, 'a Whop account a team_members row points at gets through the Whop login',
     db.reads.map((q) => `${q.table}(${q.filters.join(',')})`).join(' then '))
}
for (const [label, db] of [
  ['the team read fails', fakeDb({ students, team, fail: { team_members: 'boom' } })],
  ['the team read throws', fakeDb({ students, team, throwOn: 'team_members' })],
  ['no team row for it', fakeDb({ students, team: [] })],
  ['its student row has no auth id', fakeDb({ students: [{ whop_user_id: STAFF, supabase_user_id: null }], team })],
]) {
  ok(await gate.whopLoginMayProceed(db, STAFF) === false, `${label}: refused (closed by default)`)
}
env({})
ok(await gate.whopLoginMayProceed(fakeDb(), STAFF) === true, 'open: the Whop login asks nothing about the team')

console.log('\n=== The tab and a link preview: the new name while closed, the root\'s own otherwise ===')
for (const values of [{}, { STUDENT_APP_CLOSED: 'false' }, { STUDENT_APP_OPEN_FOR: LISTED }]) {
  env(values)
  ok(show(gate.comingSoonMetadata()) === '{}', `${show(values)}: nothing, so the root layout's title and description stand`,
     show(gate.comingSoonMetadata()))
}
for (const values of [{ STUDENT_APP_CLOSED: 'true' }, { STUDENT_APP_CLOSED: 'true', STUDENT_APP_OPEN_FOR: LISTED }]) {
  env(values)
  const m = gate.comingSoonMetadata()
  ok(m.title === 'Ecom University' && m.description === gate.COMING_SOON_MESSAGE && Object.keys(m).length === 2,
     `${show(values)}: "Ecom University" and Lovro's sentence`, show(m))
  ok(!/[—–]/.test(show(m)), `${show(values)}: no em dash in the tab or the preview`)
}
env({})

// ── The source: where the doors are, and where they are not ─────────────────
function walk(rel) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [rel]
  return fs.readdirSync(abs).flatMap((name) => walk(path.join(rel, name)))
}
const DB_CALLS = ['.from(', '.rpc(', '.insert(', '.upsert(', '.update(', '.delete(']
const firstDbCall = (s) => Math.min(...DB_CALLS.map((p) => s.indexOf(p)).filter((i) => i >= 0), Infinity)
const GATE_CALL = 'const closed = await refuseWhileClosed(supabase, user.id);\n  if (closed) return closed;'
// The token check's refusal, then the gate on the very next lines.
const RIGHT_AFTER_TOKEN = 'return NextResponse.json({ error: "Invalid token" }, { status: 401 });\n  }\n\n' +
  '  // T-078: closed to students until the new course (lib/student-app-gate.ts).\n  ' + GATE_CALL

console.log('\n=== Every student route asks the gate first ===')
const studentRoutes = [
  ...walk('src/app/api/student').filter((f) => f.endsWith('route.ts') && !f.includes('_lib')),
  'src/app/api/discounts/request/route.ts',
  'src/app/api/discounts/submit-feedback/route.ts',
].sort()
const ungated = []
for (const f of studentRoutes) {
  const s = read(f)
  const handlers = (s.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? []).length
  const calls = s.split('refuseWhileClosed(').length - 1
  // Only the handler's own body counts: a helper defined above it runs when
  // the handler calls it, which is after the gate.
  const handler = s.slice(Math.max(0, s.search(/export async function (GET|POST|PUT|PATCH|DELETE)\b/)))
  const iUser = handler.indexOf('getUser(token)')
  const iGate = handler.indexOf(GATE_CALL)
  const good = s.includes('import { refuseWhileClosed } from "@/lib/student-app-gate";')
    && handlers === 1 && calls === 1 && iUser >= 0 && iGate > iUser
    && handler.includes(RIGHT_AFTER_TOKEN) && iGate < firstDbCall(handler)
  if (!good) ungated.push(`${f} (handlers ${handlers}, calls ${calls}, token ${iUser}, gate ${iGate}, first db ${firstDbCall(handler)})`)
}
ok(ungated.length === 0, `all ${studentRoutes.length} student routes refuse right after the token check, before any read or write`,
   ungated.join('; '))
console.log(`        ${studentRoutes.map((f) => f.replace('src/app/api/', '').replace('/route.ts', '')).join(', ')}`)

console.log('\n=== The team\'s surfaces never ask it ===')
const NAMES = ['student-app-gate', 'refuseWhileClosed', 'studentMayEnter', 'studentAppClosed', 'whopLoginMayProceed']
const teamFiles = [
  ...walk('src/app/admin'),
  ...walk('src/components/admin'),
  ...walk('src/app/api/admin'),
  ...walk('src/app/api/cron'),
  ...walk('src/app/api/webhooks'),
  ...walk('src/app/api/auth/team'),
  ...walk('src/app/api/auth/whop/authorize'),
  ...walk('src/app/api/client-event'),
  'src/app/api/discounts/approve/route.ts',
  'src/app/api/discounts/reject/route.ts',
  'src/app/api/discounts/mark-applied/route.ts',
  'src/lib/admin-auth.ts',
  'src/components/auth/TeamGuard.tsx',
].filter((f) => /\.(ts|tsx)$/.test(f))
const touching = teamFiles.filter((f) => NAMES.some((n) => read(f).includes(n)))
ok(touching.length === 0, `none of ${teamFiles.length} team, cron, webhook and Whop-start files asks the gate`, touching.join(', '))

console.log('\n=== The Whop login refuses before it writes anything ===')
{
  const s = read('src/app/api/auth/whop/callback/route.ts')
  const iInfo = s.indexOf('fetchWhopUserInfo(tokens.access_token)')
  const iGate = s.indexOf('whopLoginMayProceed(createServiceClient(), userInfo.sub)')
  const later = ['.from(', '.upsert(', 'checkActiveMembershipDiagnostic(', 'signInWithPassword(', 'createUser(', 'syncWatchProgress(']
    .map((p) => [p, s.indexOf(p)])
  ok(iInfo >= 0 && iGate > iInfo, 'it asks right after Whop says who this is')
  ok(later.every(([, i]) => i > iGate), 'and before the membership check, any read, write, account or sync',
     `gate@${iGate} ` + later.map(([p, i]) => `${p}@${i}`).join(' '))
  ok(s.includes('return NextResponse.redirect(`${appUrl}/login?error=app_closed`);'), 'a refusal goes to /login?error=app_closed')
  const iWarn = s.indexOf('console.warn(`[whop-callback] student app closed, refused ${userInfo.sub}`);\n')
  const iRefused = s.indexOf('return NextResponse.redirect(`${appUrl}/login?error=app_closed`);')
  ok(iWarn > iGate && iRefused > iWarn && s.slice(iWarn, iRefused).split('\n').length === 2,
     'and is logged first, with the Whop id Whop sent and nothing else', `warn@${iWarn} redirect@${iRefused}`)
  ok(read('src/app/login/page.tsx').includes('app_closed: COMING_SOON_MESSAGE'), 'and the login page knows that code')
}

console.log('\n=== The pages ===')
{
  const layout = read('src/app/login/layout.tsx')
  ok(layout.includes('if (studentAppClosed()) return <ComingSoon />;') && layout.includes('return children;'),
     'the login: the coming-soon page while closed, the login as before otherwise')
  const guard = read('src/components/auth/StudentGuard.tsx')
  const iNotStudent = guard.indexOf('if (!isStudent) return null;')
  const iClosed = guard.indexOf('if (studentAppClosed) return <ComingSoon />;')
  const iChildren = guard.indexOf('return <>{children}</>;')
  ok(iNotStudent >= 0 && iClosed > iNotStudent && iChildren > iClosed,
     'StudentGuard: a signed-in student the app is closed to gets the coming-soon page, and nothing under the guard mounts')
  const auth = read('src/contexts/AuthContext.tsx')
  ok(auth.includes('setStudentAppClosed(data.appClosed === true);') && (auth.match(/setStudentAppClosed\(true\)/g) ?? []).length === 0,
     'AuthContext takes the flag only from the server\'s answer')
  const me = read('src/app/api/auth/me/route.ts')
  const iTeam = me.indexOf('return NextResponse.json({ role: "team", profile: teamMember });')
  const iAsk = me.indexOf('studentMayEnter(student.whop_user_id)')
  ok(iTeam >= 0 && iAsk > iTeam, '/api/auth/me answers the team before it asks the gate')
  ok(me.includes('return NextResponse.json({ role: "student", profile: student });'),
     'and an open answer is word for word what it was (appClosed only when closed)')
  const journal = read('src/app/journal/[studentId]/page.tsx')
  ok(journal.includes('if (!isTeam && isStudentSelf && !(await studentMayEnterAs(supabase, user.id))) {'),
     'the Field Journal: a student\'s own journal is the coming-soon page, the team reads as before')
  // Every page or layout that can show the coming-soon page takes the new
  // name for its tab while closed. The root layout stays as it is (it differs
  // on world-engine); /world already names itself "Ecom University" there.
  const META = 'export function generateMetadata(): Metadata {\n  return comingSoonMetadata();\n}'
  const shows = walk('src/app').filter((f) => f.endsWith('.tsx') && /<(ComingSoon|StudentGuard)\b/.test(read(f)))
  const untitled = shows.filter((f) => !read(f).includes(META)
    && !(f === 'src/app/world/layout.tsx' && read(f).includes('title: "Ecom University"')))
  ok(shows.length >= 4 && untitled.length === 0,
     `every place the coming-soon page can show (${shows.length}) reads "Ecom University" in the tab while closed`,
     untitled.length ? `untitled: ${untitled.join(', ')}` : shows.map((f) => f.replace('src/app/', '')).join(', '))
}

console.log('\n=== The browser learns only a yes or no ===')
{
  const src = walk('src').filter((f) => /\.(ts|tsx)$/.test(f))
  const withList = src.filter((f) => read(f).includes('process.env.STUDENT_APP_OPEN_FOR'))
  const withClosed = src.filter((f) => read(f).includes('process.env.STUDENT_APP_CLOSED'))
  ok(show(withList) === show(['src/lib/student-app-gate.ts']), 'the allowlist is read in one file', show(withList))
  ok(show(withClosed) === show(['src/lib/student-app-gate.ts']), 'so is the closed value', show(withClosed))
  ok(!src.some((f) => read(f).includes('NEXT_PUBLIC_STUDENT_APP')), 'there is no NEXT_PUBLIC_ twin')
  ok(!read('src/lib/student-app-gate.ts').includes('"use client"'), 'the gate module is not a client module')
}

if (exists('src/app/world/layout.tsx')) {
  console.log('\n=== /world, its places and lessons, the phone list, the heartbeat (world-engine) ===')
  const layout = read('src/app/world/layout.tsx')
  const order = ['<StudentGuard>', '<StudentProvider>', '<WorldAccessGate>', '<WorldStage>'].map((t) => layout.indexOf(t))
  ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])),
     'StudentGuard wraps the world first: the coming-soon page renders before the provider, the access gate and the 3D stage', show(order))
  const pages = walk('src/app/world').filter((f) => f.endsWith('page.tsx'))
  ok(pages.length >= 3, `every page under /world sits inside that layout (${pages.length}: ${pages.map((p) => p.replace('src/app/world', '') || '/').join(', ')})`)
  const comingSoon = read('src/components/auth/ComingSoon.tsx')
  const imports = [...comingSoon.matchAll(/from "([^"]+)"/g)].map((m) => m[1])
  ok(imports.every((m) => m === '@/lib/student-app-gate'), 'the coming-soon page loads nothing but the gate\'s words (no three.js, no WebGL)', show(imports))
  const stageUsers = walk('src/app').filter((f) => /\.tsx$/.test(f) && read(f).includes('<WorldStage'))
  ok(stageUsers.every((f) => f === 'src/app/world/layout.tsx' || f.startsWith('src/app/dev/')),
     'the 3D stage and its phone list mount only in that layout (and the dev pages, notFound in production)', show(stageUsers))
  const beat = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && read(f).includes('rpc("record_lesson_heartbeat"'))
  ok(show(beat) === show(['src/lib/world/watch-heartbeat.ts']), 'the heartbeat is sent from one module', show(beat))
  for (const r of ['lesson-video', 'lesson-watched']) {
    ok(studentRoutes.includes(`src/app/api/student/${r}/route.ts`), `${r} is among the refused routes`)
  }
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
