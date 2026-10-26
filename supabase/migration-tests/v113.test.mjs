// v113 and its undo (T-122, 2026-10-21: the coupon check answers every
// student and records which step answered; since its fifth fix round,
// 2026-10-22, THE RULE STAMP: the rule's version in `source`, and
// `source_checked_at`; since the owner's paid plan and payment, 2026-10-26,
// the r6 values beside the r5 ones) on a real Postgres (PGlite), in a file of
// its own as v111.test.mjs is.
//
//   cd supabase/migration-tests && npm install && node v113.test.mjs
//
// The database is base.sql with Supabase's default privileges on new tables
// in public put in first, as v111.test.mjs makes it, then v111 as the owner
// pasted it. A row is written before v113; v113 is pasted twice; the columns
// are written and read as each role; the writes of the older builds are
// made as PostgREST makes them (an upsert setting the payload's columns
// alone); the undo is pasted twice; then v113 once more. v113 is also pasted
// on a database that holds an earlier copy of it, on one that holds the copy
// taking the r5 values alone (production's tree until the paid plan and
// payment), and on a database without v111. Every student here is made up.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const V111 = read('../migrations/2026_v111_student_membership_discounts.sql')
const V113 = read('../migrations/2026_v113_membership_discount_source.sql')
const UNDO = read('../undo/2026_v113_undo.sql')
// The earlier copy of v113 (T-122's first four rounds, never pasted on production): the steps' words alone.
const V113_EARLIER = `
  alter table public.student_membership_discounts add column if not exists source text;
  alter table public.student_membership_discounts add constraint student_membership_discounts_source_check
    check (source is null or source in ('membership', 'user', 'payment'));`
// The copy of v113 in the tree production runs (cac0c07, T-122's fifth fix round): the r5 values alone.
const V113_R5 = V113
  .replace("and source not in ('r5-membership', 'r5-user', 'r5-payment', 'r6-membership', 'r6-user', 'r6-payment');", "and source not in ('r5-membership', 'r5-user', 'r5-payment');")
  .replace("check (source is null or source in ('r5-membership', 'r5-user', 'r5-payment', 'r6-membership', 'r6-user', 'r6-payment'));", "check (source is null or source in ('r5-membership', 'r5-user', 'r5-payment'));")
/** The six values the check takes: the r6 rule's (this build's, since 2026-10-26) and the r5 rule's (production's build). */
const WORDS = ['r5-membership', 'r5-user', 'r5-payment', 'r6-membership', 'r6-user', 'r6-payment']

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
  await db.exec(`insert into students (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com'), ('${C}', 'c@example.com');`)
  if (withV111) await db.exec(V111)
  return db
}
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const db = await database()

/** Runs the file as the SQL editor does: every statement, the last select's rows handed back. */
async function paste(sql, on = db) {
  const results = await on.exec(sql)
  return results.at(-1)?.rows ?? []
}
/** `sql` as `role`, with the test seams set; the error's code, or the rows. */
async function as(role, sql, { team = false, uid = '' } = {}, on = db) {
  await on.exec(`set role ${role}; select set_config('test.is_team', '${team}', false), set_config('test.uid', '${uid}', false);`)
  try {
    const r = await on.query(sql)
    return { rows: r.rows }
  } catch (e) {
    return { code: e.code, message: e.message }
  } finally {
    await on.exec(`reset role; select set_config('test.is_team', '', false), set_config('test.uid', '', false);`)
  }
}
const columns = async (on = db) =>
  (await on.query(`select column_name, data_type, is_nullable from information_schema.columns where table_name = 'student_membership_discounts' order by ordinal_position`)).rows
    .map((c) => `${c.column_name} ${c.data_type} ${c.is_nullable}`)
const V111_COLUMNS = [
  'student_id uuid NO', 'whop_membership_id text YES', 'promo_code_id text YES', 'promo_code text YES',
  'renewal_price numeric YES', 'plan_renewal_price numeric YES', 'discounted boolean NO', 'checked_at timestamp with time zone NO',
]
const V113_COLUMNS = [...V111_COLUMNS, 'source text YES', 'source_checked_at timestamp with time zone YES']
/** What the cron wrote before v113: evolve10 read from the membership on file. */
const before = `insert into public.student_membership_discounts (student_id, whop_membership_id, promo_code_id, promo_code, renewal_price, plan_renewal_price, discounted, checked_at)
  values ('${A}', 'mem_devA', 'promo_devEvolve', 'evolve10', 87.30, 97.00, true, '2026-10-21T06:40:00Z')`
const rowsNow = async () =>
  (await db.query(`select student_id, whop_membership_id, promo_code_id, promo_code, renewal_price::text, plan_renewal_price::text, discounted, checked_at::text from public.student_membership_discounts order by student_id`)).rows
/** A row's stamp: its source, and whether source_checked_at is its checked_at (what the stored fallback asks). */
const stampOf = async (student, on = db) =>
  (await on.query(`select source, source_checked_at is not null and source_checked_at = checked_at as same_write from public.student_membership_discounts where student_id = '${student}'`)).rows[0] ?? null
/**
 * An upsert as PostgREST makes it for supabase-js's upsert(rows, { onConflict: 'student_id' }): the payload's columns
 * inserted, and on a conflict those columns alone set from the proposed row.
 */
const upsert = (row) => {
  const cols = Object.keys(row)
  const value = (v) => (v === null ? 'null' : typeof v === 'string' ? `'${v}'` : String(v))
  return `insert into public.student_membership_discounts (${cols.join(', ')}) values (${cols.map((c) => value(row[c])).join(', ')})
    on conflict (student_id) do update set ${cols.filter((c) => c !== 'student_id').map((c) => `${c} = excluded.${c}`).join(', ')}`
}

console.log('\n=== Before v113: the code writes the row without the columns ===')
{
  const written = await as('service_role', before)
  ok(!written.code, 'the service role writes a row as v111 has it', show(written))
  const withSource = await as('service_role', `insert into public.student_membership_discounts (student_id, discounted, checked_at, source, source_checked_at) values ('${B}', false, now(), 'r6-payment', now())`)
  ok(withSource.code === '42703', 'a row carrying the stamp is refused (42703, the column does not exist): the code then writes it again without', show(withSource))
}

console.log('\n=== v113, pasted twice ===')
const kept = await rowsNow()
{
  const first = await paste(V113)
  ok(show(first) === show([{ source_type: 'text', source_checked_at_type: 'timestamp with time zone', source_checks: 1, rows_now: 1, rows_without_source: 1 }]),
     'its own check: source is text, source_checked_at a timestamp, one check, the row written before has no source', show(first))
  ok(show(await columns()) === show(V113_COLUMNS), 'v111\'s 8 columns as they were, then source and source_checked_at, both of which may be empty', show(await columns()))
  ok(show(await rowsNow()) === show(kept), 'the row written before is unchanged in every column')
  const comment = async (col) => (await db.query(`select col_description(attrelid, attnum) as c from pg_attribute where attrelid = 'public.student_membership_discounts'::regclass and attname = '${col}'`)).rows[0]?.c
  const sourceComment = await comment('source')
  const timeComment = await comment('source_checked_at')
  ok(typeof sourceComment === 'string' && [...WORDS, 'source_checked_at'].every((w) => sourceComment.includes(w))
       && typeof timeComment === 'string' && /checked_at of the write that set source/.test(timeComment),
     'the columns say what each value means, and what the time is for', show([sourceComment, timeComment]))
  const second = await paste(V113)
  const checks = (await db.query(`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.student_membership_discounts'::regclass and contype = 'c'`)).rows
  ok(show(second) === show(first) && checks.length === 1 && /'r5-membership'::text, 'r5-user'::text, 'r5-payment'::text, 'r6-membership'::text, 'r6-user'::text, 'r6-payment'::text/.test(checks[0].def),
     'a second paste changes nothing: the same check, one constraint naming the six values, this rule\'s and the r5 rule\'s', show(checks))
  const policies = (await db.query(`select policyname, cmd, roles::text from pg_policies where tablename = 'student_membership_discounts'`)).rows
  ok(show(policies) === show([{ policyname: 'Team reads membership discounts', cmd: 'SELECT', roles: '{authenticated}' }]),
     'v111\'s one policy is still the only one', show(policies))
}

console.log('\n=== Who may write and read the columns ===')
{
  for (const [word, student] of [['r5-membership', A], ['r5-user', A], ['r5-payment', B], ['r6-membership', A], ['r6-user', A], ['r6-payment', B]]) {
    const at = '2026-10-22T10:00:00.123Z'
    const r = await as('service_role', upsert({ student_id: student, whop_membership_id: `mem_dev${word}`, discounted: word.endsWith('-payment'), checked_at: at, source: word, source_checked_at: at }))
    const now = await stampOf(student)
    ok(!r.code && now?.source === word && now?.same_write === true, `the service role writes source '${word}' with its time (one row per student, an upsert replaces it)`, show(r.code ?? now))
  }
  for (const word of ['membership', 'user', 'payment', 'stored', 'r7-membership']) {
    const wrong = await as('service_role', `update public.student_membership_discounts set source = '${word}' where student_id = '${A}'`)
    ok(wrong.code === '23514', `'${word}' is refused (23514, the check): ${word === 'stored' || word === 'r7-membership' ? 'no word but the six' : 'the word an earlier round\'s build writes'}`, show(wrong))
  }
  const empty = await as('service_role', `update public.student_membership_discounts set source = null, source_checked_at = null where student_id = '${A}' returning source`)
  ok(!empty.code && empty.rows.length === 1 && empty.rows[0].source === null,
     'an empty source is allowed (the rows written before v113, and a no coupon judged without the user\'s list)', show(empty))
  const team = await as('authenticated', 'select student_id, source, source_checked_at from public.student_membership_discounts order by student_id', { team: true, uid: A })
  ok(team.rows?.length === 2 && team.rows[1].source === 'r6-payment' && team.rows[1].source_checked_at !== null, 'a team member reads the columns', show(team))
  const student = await as('authenticated', 'select source, source_checked_at from public.student_membership_discounts', { team: false, uid: A })
  ok(Array.isArray(student.rows) && student.rows.length === 0, 'a signed-in student still reads nothing', show(student))
  const teamWrite = await as('authenticated', `update public.student_membership_discounts set source = 'r6-user'`, { team: true, uid: A })
  const visitor = await as('anon', 'select source from public.student_membership_discounts')
  ok(teamWrite.code === '42501' && visitor.code === '42501', 'a team member\'s update and a visitor\'s read are refused (42501), as before v113', show([teamWrite.code, visitor.code]))
}

console.log('\n=== The older builds, writing as PostgREST does ===')
{
  // This rule's row for A: no coupon, stamped by the write that set it.
  const at = '2026-10-22T10:00:00.123Z'
  await as('service_role', upsert({ student_id: A, whop_membership_id: 'mem_devA', promo_code_id: null, promo_code: null, renewal_price: 97, plan_renewal_price: null, discounted: false, checked_at: at, source: 'r6-membership', source_checked_at: at }))
  const ours = await stampOf(A)
  ok(ours?.source === 'r6-membership' && ours.same_write === true, 'this rule\'s write: the stamp, and source_checked_at the row\'s checked_at', show(ours))
  // A build of T-122's earlier rounds (the world-engine preview, a89ff1c): its row carries a step's word.
  const earlier = await as('service_role', upsert({ student_id: A, whop_membership_id: 'mem_devA', promo_code_id: 'promo_devW50', promo_code: 'welcome50', renewal_price: 97, plan_renewal_price: 97, discounted: false, checked_at: '2026-10-22T11:00:00Z', source: 'membership' }))
  const afterEarlier = (await db.query(`select promo_code, checked_at::text from public.student_membership_discounts where student_id = '${A}'`)).rows[0]
  ok(earlier.code === '23514' && afterEarlier.promo_code === null && show(await stampOf(A)) === show(ours),
     'an earlier round\'s build: its upsert refused whole (23514), this rule\'s row as it was (that build logs the failed write and keeps its live answer)', show({ earlier: earlier.code, row: afterEarlier }))
  const earlierNew = await as('service_role', upsert({ student_id: C, discounted: false, checked_at: '2026-10-22T11:00:00Z', source: 'user' }))
  ok(earlierNew.code === '23514' && (await stampOf(C)) === null, 'and a new row of its own refused too: it stores nothing at all', show(earlierNew))
  // The build from before T-122 (production's cron until the deploy): the eight columns alone.
  const pre = await as('service_role', upsert({ student_id: A, whop_membership_id: 'mem_devA', promo_code_id: null, promo_code: null, renewal_price: 97, plan_renewal_price: 97, discounted: false, checked_at: '2026-10-22T12:40:00Z' }))
  const afterPre = await stampOf(A)
  ok(!pre.code && afterPre?.source === 'r6-membership' && afterPre.same_write === false,
     'the build from before T-122 writes over this rule\'s row: the stamp kept (its upsert leaves the column alone) with a new checked_at, so the two times differ and the fallback does not answer with it', show(afterPre))
  const preNew = await as('service_role', upsert({ student_id: C, whop_membership_id: 'mem_devC', promo_code_id: null, promo_code: null, renewal_price: 97, plan_renewal_price: 97, discounted: false, checked_at: '2026-10-22T12:40:00Z' }))
  ok(!preNew.code && show(await stampOf(C)) === show({ source: null, same_write: false }), 'a row it adds holds no source', show(await stampOf(C)))
  const again = await as('service_role', upsert({ student_id: A, whop_membership_id: 'mem_devA', promo_code_id: null, promo_code: null, renewal_price: 97, plan_renewal_price: null, discounted: false, checked_at: '2026-10-22T14:40:00Z', source: 'r6-membership', source_checked_at: '2026-10-22T14:40:00Z' }))
  ok(!again.code && (await stampOf(A))?.same_write === true, 'this rule\'s next write stamps the row again', show(await stampOf(A)))
  // Production's build (the r5 rule) writes its own stamp over this rule's row, and this rule's next write over it.
  const r5 = await as('service_role', upsert({ student_id: A, whop_membership_id: 'mem_devA', promo_code_id: null, promo_code: null, renewal_price: 97, plan_renewal_price: null, discounted: false, checked_at: '2026-10-22T16:40:00Z', source: 'r5-membership', source_checked_at: '2026-10-22T16:40:00Z' }))
  const afterR5 = await stampOf(A)
  const r6 = await as('service_role', upsert({ student_id: A, whop_membership_id: 'mem_devA', promo_code_id: null, promo_code: null, renewal_price: 97, plan_renewal_price: null, discounted: false, checked_at: '2026-10-22T18:40:00Z', source: 'r6-membership', source_checked_at: '2026-10-22T18:40:00Z' }))
  ok(!r5.code && afterR5?.source === 'r5-membership' && afterR5.same_write === true && !r6.code && (await stampOf(A))?.source === 'r6-membership',
     'the r5 build\'s write is taken, its stamp an older rule\'s for the r6 build (which never answers a no coupon with it), and the r6 build\'s next write stamps the row again', show({ afterR5, now: await stampOf(A) }))
}

console.log('\n=== The undo, pasted twice, then v113 again ===')
{
  const others = async () =>
    (await db.query(`select student_id, whop_membership_id, discounted from public.student_membership_discounts order by student_id`)).rows
  const had = await others()
  const undone = await paste(UNDO)
  ok(show(undone) === show([{ source_left: 0 }]), 'the undo drops both columns: its own check says 0', show(undone))
  ok(show(await columns()) === show(V111_COLUMNS) && show(await others()) === show(had), 'v111\'s 8 columns and every row are left as they were', show(await others()))
  const checks = (await db.query(`select count(*)::int as n from pg_constraint where conrelid = 'public.student_membership_discounts'::regclass and contype = 'c'`)).rows[0].n
  ok(checks === 0, 'and the check went with the column', String(checks))
  ok(show(await paste(UNDO)) === show([{ source_left: 0 }]), 'a second undo changes nothing')
  const back = await paste(V113)
  ok(back[0]?.source_type === 'text' && back[0]?.source_checked_at_type === 'timestamp with time zone' && back[0]?.source_checks === 1
       && back[0]?.rows_now === 3 && back[0]?.rows_without_source === 3,
     'v113 pastes again after it: the columns are back, empty on the 3 rows', show(back))
}

console.log('\n=== v113 on a database that holds an earlier copy of it ===')
{
  const dev = await database()
  await dev.exec(V113_EARLIER)
  await dev.exec(`insert into public.student_membership_discounts (student_id, discounted, checked_at, source) values ('${A}', false, now(), 'membership'), ('${B}', true, now(), 'payment'), ('${C}', false, now(), null)`)
  const out = await paste(V113, dev)
  const words = (await dev.query(`select source from public.student_membership_discounts order by student_id`)).rows.map((r) => r.source)
  const checks = (await dev.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.student_membership_discounts'::regclass and contype = 'c'`)).rows
  ok(out[0]?.source_checks === 1 && out[0]?.rows_without_source === 3 && show(words) === show([null, null, null])
       && checks.length === 1 && /'r5-membership'::text/.test(checks[0].def) && /'r6-membership'::text/.test(checks[0].def) && !/'membership'::text/.test(checks[0].def),
     'the earlier copy\'s words are emptied, so no row carries a step\'s word alone, and the check takes the six values alone (the r6 rule\'s and the r5 rule\'s)', show({ out, words, checks }))
  ok(show(await columns(dev)) === show(V113_COLUMNS), 'with source_checked_at added beside the column it had', show(await columns(dev)))
}

console.log('\n=== v113 on a database that holds the copy taking the r5 values alone ===')
{
  // The copy in the tree production runs: pasted there before this one, the r6 build's stamp is refused until this
  // copy is pasted over it, which takes the six and keeps the r5 rows. Since the review of 2026-10-26 the r6 build
  // writes the row again without the stamp on that refusal (membership-discount.ts refusesThisStamp, which reads the
  // code and the check's name in the message, as Postgres gives them here); its writes failed until then.
  const prod = await database()
  await paste(V113_R5, prod)
  const at = '2026-10-26T10:40:00Z'
  const r5Row = await as('service_role', upsert({ student_id: A, whop_membership_id: 'mem_devA', discounted: false, renewal_price: 97, checked_at: at, source: 'r5-membership', source_checked_at: at }), {}, prod)
  const r6Refused = await as('service_role', upsert({ student_id: B, whop_membership_id: 'mem_devB', discounted: false, checked_at: at, source: 'r6-payment', source_checked_at: at }), {}, prod)
  ok(V113_R5 !== V113 && !r5Row.code && r6Refused.code === '23514' && /\bstudent_membership_discounts_source_check\b/.test(r6Refused.message ?? ''),
     'on the r5-only copy: production\'s r5 build writes, and the r6 build\'s stamp is refused (23514, the message naming student_membership_discounts_source_check, which the build reads)', show({ r5: r5Row.code ?? 'ok', r6: r6Refused.code, message: r6Refused.message }))
  const unstamped = await as('service_role', upsert({ student_id: B, whop_membership_id: 'mem_devB', promo_code_id: null, promo_code: null, renewal_price: null, plan_renewal_price: null, discounted: false, checked_at: at }), {}, prod)
  const unstampedRow = (await prod.query(`select discounted, promo_code_id, renewal_price, source from public.student_membership_discounts where student_id = '${B}'`)).rows[0]
  ok(!unstamped.code && show(unstampedRow) === show({ discounted: false, promo_code_id: null, renewal_price: null, source: null }),
     'and its write again without the stamp is taken: the row is stored (the map and the 30% page read it) with no source, so no stored no coupon answers with it', show({ code: unstamped.code ?? 'ok', row: unstampedRow }))
  const out = await paste(V113, prod)
  const kept = (await prod.query(`select source from public.student_membership_discounts where student_id = '${A}'`)).rows[0]?.source
  const r6Now = await as('service_role', upsert({ student_id: B, whop_membership_id: 'mem_devB', discounted: false, checked_at: at, source: 'r6-payment', source_checked_at: at }), {}, prod)
  const checks = (await prod.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.student_membership_discounts'::regclass and contype = 'c'`)).rows
  ok(out[0]?.source_checks === 1 && kept === 'r5-membership' && !r6Now.code && (await stampOf(B, prod))?.source === 'r6-payment' && checks.length === 1 && /'r6-payment'::text/.test(checks[0].def),
     'this copy pasted over it: one check taking the six, the r5 row kept, and the r6 build\'s write taken', show({ out, kept, r6: r6Now.code ?? 'ok', checks }))
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
