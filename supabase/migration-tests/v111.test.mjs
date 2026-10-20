// v111 and its undo (admin rebuild 2, D5) on a real Postgres (PGlite), apart
// from run.mjs so the lanes that add v109 and v110 there merge without
// touching this file.
//
//   cd supabase/migration-tests && npm install && node v111.test.mjs
//
// The database is base.sql (the harness's roles anon, authenticated and
// service_role, auth.uid() and current_user_is_team() as test seams, the
// students table) with Supabase's default privileges on new tables in public
// put in first, as the hosted database has them: every API role gets every
// privilege on a table v111 makes, and the service role skips row level
// security. Then v111 is pasted as the owner pastes it, twice; the table is
// written and read as each role; the undo is pasted twice; and v111 once
// more. Every student here is made up.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const V111 = read('../migrations/2026_v111_student_membership_discounts.sql')
const UNDO = read('../undo/2026_v111_undo.sql')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

const db = new PGlite()
await db.exec(read('base.sql'))
// Supabase's defaults for a new table in public, and the service role's bypass.
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
`)
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
await db.exec(`insert into students (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');`)

/** Runs the file as the SQL editor does: every statement, the last select's rows handed back. */
async function paste(sql) {
  const results = await db.exec(sql)
  return results.at(-1)?.rows ?? []
}
/** `sql` as `role`, with the test seams set; the error's code, or the rows. */
async function as(role, sql, { team = false, uid = '' } = {}) {
  await db.exec(`set role ${role}; select set_config('test.is_team', '${team}', false), set_config('test.uid', '${uid}', false);`)
  try {
    const r = await db.query(sql)
    return { rows: r.rows }
  } catch (e) {
    return { code: e.code, message: e.message }
  } finally {
    await db.exec(`reset role; select set_config('test.is_team', '', false), set_config('test.uid', '', false);`)
  }
}
const row = (student, discounted = true) =>
  `insert into public.student_membership_discounts (student_id, whop_membership_id, promo_code_id, promo_code, renewal_price, plan_renewal_price, discounted, checked_at)
   values ('${student}', 'mem_devA', 'promo_devEvolve', 'evolve10', 87.30, 97.00, ${discounted}, '2026-10-21T06:40:00Z')`

console.log('\n=== v111, pasted ===')
{
  const first = await paste(V111)
  ok(show(first) === show([{ row_level_security: true, policies: 1, rows_now: 0, visitor_can_read: false, signed_in_can_insert: false, signed_in_can_select: true }]),
     'its own check: row level security on, 1 policy, no rows, a visitor cannot read, a signed-in user cannot insert but may select', show(first))
  const cols = (await db.query(`select column_name, data_type, is_nullable from information_schema.columns where table_name = 'student_membership_discounts' order by ordinal_position`)).rows
  ok(show(cols.map((c) => `${c.column_name} ${c.data_type} ${c.is_nullable}`)) === show([
    'student_id uuid NO', 'whop_membership_id text YES', 'promo_code_id text YES', 'promo_code text YES',
    'renewal_price numeric YES', 'plan_renewal_price numeric YES', 'discounted boolean NO', 'checked_at timestamp with time zone NO',
  ]), 'the 8 columns, their types, and which may be empty', show(cols.map((c) => c.column_name)))
  const second = await paste(V111)
  const policies = (await db.query(`select policyname, cmd, roles::text from pg_policies where tablename = 'student_membership_discounts'`)).rows
  ok(show(second) === show(first) && show(policies) === show([{ policyname: 'Team reads membership discounts', cmd: 'SELECT', roles: '{authenticated}' }]),
     'a second paste changes nothing: the same check, still one select policy', show(policies))
}

console.log('\n=== Who may do what ===')
{
  const service = [await as('service_role', row(A)), await as('service_role', row(B, false).replace('mem_devA', 'mem_devB'))]
  ok(service.every((r) => !r.code), 'the service role writes (the cron and the discount routes)', show(service))
  const upsert = await as('service_role', `${row(A, false)} on conflict (student_id) do update set discounted = excluded.discounted, checked_at = now()`)
  const one = (await db.query(`select count(*)::int as n, bool_or(discounted) as any from public.student_membership_discounts where student_id = '${A}'`)).rows[0]
  ok(!upsert.code && one.n === 1 && one.any === false, 'one row per student: a later read replaces it (upsert on student_id)', show(one))
  const twice = await as('service_role', row(A))
  ok(twice.code === '23505', 'a second plain insert for a student is refused (23505)', show(twice))
  const noFlag = await as('service_role', `insert into public.student_membership_discounts (student_id, checked_at) values ('${B}', now())`)
  ok(noFlag.code === '23505' || noFlag.code === '23502', 'a row with no discounted is refused', show(noFlag))
  const team = await as('authenticated', 'select student_id, discounted from public.student_membership_discounts order by student_id', { team: true, uid: A })
  ok(team.rows?.length === 2, 'a team member reads every row', show(team))
  const student = await as('authenticated', 'select student_id from public.student_membership_discounts', { team: false, uid: A })
  ok(Array.isArray(student.rows) && student.rows.length === 0, 'a signed-in student reads nothing, not even their own row', show(student))
  for (const [what, sql] of [
    ['insert', row(B)],
    ['update', `update public.student_membership_discounts set discounted = false`],
    ['delete', `delete from public.student_membership_discounts`],
    ['truncate', `truncate public.student_membership_discounts`],
  ]) {
    const asTeam = await as('authenticated', sql, { team: true, uid: A })
    ok(asTeam.code === '42501', `a team member's ${what} is refused (42501): only the service role writes`, show(asTeam))
  }
  for (const sql of ['select * from public.student_membership_discounts', row(B), 'truncate public.student_membership_discounts']) {
    const visitor = await as('anon', sql)
    ok(visitor.code === '42501', `a visitor is refused: ${sql.trim().split(/\s+/).slice(0, 2).join(' ')}`, show(visitor))
  }
  const left = (await db.query('select count(*)::int as n from public.student_membership_discounts')).rows[0].n
  ok(left === 2, 'after all of that the 2 rows the service role wrote are there', String(left))
  const had = (await db.query(`select count(*)::int as n from public.student_membership_discounts where student_id = '${B}'`)).rows[0].n
  await db.exec(`delete from students where id = '${B}'`)
  const gone = (await db.query(`select count(*)::int as n from public.student_membership_discounts where student_id = '${B}'`)).rows[0].n
  ok(had === 1 && gone === 0, 'a student deleted takes their row along (on delete cascade)', `${had} then ${gone}`)
  const orphan = await as('service_role', row('00000000-0000-4000-8000-0000000000ff'))
  ok(orphan.code === '23503', 'no row for a student that does not exist (23503)', show(orphan))
}

console.log('\n=== The undo, pasted twice, then v111 again ===')
{
  const undone = await paste(UNDO)
  ok(show(undone) === show([{ table_left: null }]), 'the undo drops the table: its own check says null', show(undone))
  const again = await paste(UNDO)
  ok(show(again) === show([{ table_left: null }]), 'a second undo changes nothing')
  const back = await paste(V111)
  ok(back[0]?.row_level_security === true && back[0]?.rows_now === 0 && back[0]?.policies === 1, 'v111 pastes again after it, empty', show(back))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
