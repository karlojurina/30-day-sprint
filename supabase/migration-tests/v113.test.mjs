// v113 and its undo (T-122, 2026-10-21: the coupon check answers every
// student and records which step answered) on a real Postgres (PGlite), in a
// file of its own as v111.test.mjs is.
//
//   cd supabase/migration-tests && npm install && node v113.test.mjs
//
// The database is base.sql with Supabase's default privileges on new tables
// in public put in first, as v111.test.mjs makes it, then v111 as the owner
// pasted it. A row is written before v113; v113 is pasted twice; the column
// is written and read as each role; the undo is pasted twice; then v113 once
// more. v113 is also pasted on a database without v111. Every student here is
// made up.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const V111 = read('../migrations/2026_v111_student_membership_discounts.sql')
const V113 = read('../migrations/2026_v113_membership_discount_source.sql')
const UNDO = read('../undo/2026_v113_undo.sql')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

async function database({ withV111 = true } = {}) {
  const db = new PGlite()
  await db.exec(read('base.sql'))
  // Supabase's defaults for a new table in public, and the service role's bypass.
  await db.exec(`
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
  `)
  await db.exec(`insert into students (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');`)
  if (withV111) await db.exec(V111)
  return db
}
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const db = await database()

/** Runs the file as the SQL editor does: every statement, the last select's rows handed back. */
async function paste(sql, on = db) {
  const results = await on.exec(sql)
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
const columns = async () =>
  (await db.query(`select column_name, data_type, is_nullable from information_schema.columns where table_name = 'student_membership_discounts' order by ordinal_position`)).rows
    .map((c) => `${c.column_name} ${c.data_type} ${c.is_nullable}`)
const V111_COLUMNS = [
  'student_id uuid NO', 'whop_membership_id text YES', 'promo_code_id text YES', 'promo_code text YES',
  'renewal_price numeric YES', 'plan_renewal_price numeric YES', 'discounted boolean NO', 'checked_at timestamp with time zone NO',
]
/** What the cron wrote before v113: evolve10 read from the membership on file. */
const before = `insert into public.student_membership_discounts (student_id, whop_membership_id, promo_code_id, promo_code, renewal_price, plan_renewal_price, discounted, checked_at)
  values ('${A}', 'mem_devA', 'promo_devEvolve', 'evolve10', 87.30, 97.00, true, '2026-10-21T06:40:00Z')`
const rowsNow = async () =>
  (await db.query(`select student_id, whop_membership_id, promo_code_id, promo_code, renewal_price::text, plan_renewal_price::text, discounted, checked_at::text from public.student_membership_discounts order by student_id`)).rows

console.log('\n=== Before v113: the code writes the row without the column ===')
{
  const written = await as('service_role', before)
  ok(!written.code, 'the service role writes a row as v111 has it', show(written))
  const withSource = await as('service_role', `insert into public.student_membership_discounts (student_id, discounted, checked_at, source) values ('${B}', false, now(), 'payment')`)
  ok(withSource.code === '42703', 'a row carrying source is refused (42703, the column does not exist): the code then writes it again without', show(withSource))
}

console.log('\n=== v113, pasted twice ===')
const kept = await rowsNow()
{
  const first = await paste(V113)
  ok(show(first) === show([{ source_type: 'text', source_checks: 1, rows_now: 1, rows_without_source: 1 }]),
     'its own check: source is text, one check, the row written before has no source', show(first))
  ok(show(await columns()) === show([...V111_COLUMNS, 'source text YES']), 'v111\'s 8 columns as they were, and source after them, which may be empty', show(await columns()))
  ok(show(await rowsNow()) === show(kept), 'the row written before is unchanged in every column')
  const comment = (await db.query(`select col_description(attrelid, attnum) as c from pg_attribute where attrelid = 'public.student_membership_discounts'::regclass and attname = 'source'`)).rows[0]?.c
  ok(typeof comment === 'string' && /membership/.test(comment) && /user/.test(comment) && /payment/.test(comment) && /97\.00/.test(comment),
     'the column says what each word means', comment)
  const second = await paste(V113)
  const checks = (await db.query(`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.student_membership_discounts'::regclass and contype = 'c'`)).rows
  ok(show(second) === show(first) && checks.length === 1 && /'membership'::text, 'user'::text, 'payment'::text/.test(checks[0].def),
     'a second paste changes nothing: the same check, one constraint naming the three words', show(checks))
  const policies = (await db.query(`select policyname, cmd, roles::text from pg_policies where tablename = 'student_membership_discounts'`)).rows
  ok(show(policies) === show([{ policyname: 'Team reads membership discounts', cmd: 'SELECT', roles: '{authenticated}' }]),
     'v111\'s one policy is still the only one', show(policies))
}

console.log('\n=== Who may write and read the column ===')
{
  for (const [word, student] of [['membership', A], ['user', A], ['payment', B]]) {
    const r = await as('service_role', `insert into public.student_membership_discounts (student_id, whop_membership_id, discounted, checked_at, source)
      values ('${student}', 'mem_dev${word}', ${word === 'payment'}, now(), '${word}')
      on conflict (student_id) do update set source = excluded.source, whop_membership_id = excluded.whop_membership_id, discounted = excluded.discounted`)
    const now = (await db.query(`select source from public.student_membership_discounts where student_id = '${student}'`)).rows[0]?.source
    ok(!r.code && now === word, `the service role writes source '${word}' (one row per student, an upsert replaces it)`, show(r.code ?? now))
  }
  const wrong = await as('service_role', `update public.student_membership_discounts set source = 'stored' where student_id = '${A}'`)
  ok(wrong.code === '23514', 'a word that is not one of the three is refused (23514, the check)', show(wrong))
  const empty = await as('service_role', `update public.student_membership_discounts set source = null where student_id = '${A}'`)
  ok(!empty.code, 'an empty source is allowed (the rows written before v113)', show(empty))
  const team = await as('authenticated', 'select student_id, source from public.student_membership_discounts order by student_id', { team: true, uid: A })
  ok(team.rows?.length === 2 && team.rows[1].source === 'payment', 'a team member reads the column', show(team))
  const student = await as('authenticated', 'select source from public.student_membership_discounts', { team: false, uid: A })
  ok(Array.isArray(student.rows) && student.rows.length === 0, 'a signed-in student still reads nothing', show(student))
  const teamWrite = await as('authenticated', `update public.student_membership_discounts set source = 'user'`, { team: true, uid: A })
  const visitor = await as('anon', 'select source from public.student_membership_discounts')
  ok(teamWrite.code === '42501' && visitor.code === '42501', 'a team member\'s update and a visitor\'s read are refused (42501), as before v113', show([teamWrite.code, visitor.code]))
}

console.log('\n=== The undo, pasted twice, then v113 again ===')
{
  const others = async () =>
    (await db.query(`select student_id, whop_membership_id, discounted from public.student_membership_discounts order by student_id`)).rows
  const had = await others()
  const undone = await paste(UNDO)
  ok(show(undone) === show([{ source_left: 0 }]), 'the undo drops the column: its own check says 0', show(undone))
  ok(show(await columns()) === show(V111_COLUMNS) && show(await others()) === show(had), 'v111\'s 8 columns and every row are left as they were', show(await others()))
  const checks = (await db.query(`select count(*)::int as n from pg_constraint where conrelid = 'public.student_membership_discounts'::regclass and contype = 'c'`)).rows[0].n
  ok(checks === 0, 'and the check went with the column', String(checks))
  ok(show(await paste(UNDO)) === show([{ source_left: 0 }]), 'a second undo changes nothing')
  const back = await paste(V113)
  ok(back[0]?.source_type === 'text' && back[0]?.source_checks === 1 && back[0]?.rows_now === 2 && back[0]?.rows_without_source === 2,
     'v113 pastes again after it: the column is back, empty on the 2 rows', show(back))
}

console.log('\n=== v113 on a database without v111 ===')
{
  const bare = await database({ withV111: false })
  let code = null
  try {
    await paste(V113, bare)
  } catch (e) {
    code = e.code
    // The SQL editor ends the failed transaction; PGlite's one session has to be told.
    await bare.exec('rollback')
  }
  const made = (await bare.query(`select to_regclass('public.student_membership_discounts') as t`)).rows[0].t
  ok(code === '42P01' && made === null, 'it stops at its first statement (42P01) and makes nothing', show({ code, made }))
  const undo = await paste(UNDO, bare)
  ok(show(undo) === show([{ source_left: 0 }]), 'the undo on it changes nothing and says 0', show(undo))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
