// Runs diagnostics/non-course-members-read.sql (login-1, 2026-10-20) on the
// harness's Postgres, so the owner is never handed a query that errors in the
// production SQL editor, and proves what its header says: one read that
// changes nothing, counts and plans only, and "older than the last successful
// sync" picks out the rows the sync did not rewrite.
//
//   cd supabase/migration-tests && npm install   # once
//   node supabase/migration-tests/check-non-course-members.mjs
//
// The tables are the harness's base.sql (students), with the students
// updated_at trigger lifted from schema.sql and cron_runs lifted from v82,
// both verbatim. Every row below is made up here.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => fs.readFileSync(here(rel), 'utf8')

/** The statement starting at `start` in a real file, up to `end` or the first line ending a statement. */
function lift(rel, start, end = ';') {
  const s = read(rel)
  const i = s.indexOf('\n' + start) + 1
  if (i < 1) throw new Error(`"${start}" not found in ${rel}`)
  if (end !== ';') return s.slice(i, s.indexOf(end, i) + end.length)
  const out = []
  for (const line of s.slice(i).split('\n')) {
    out.push(line)
    if (line.replace(/--.*$/, '').includes(';')) return out.join('\n')
  }
  throw new Error(`end of "${start}" not found in ${rel}`)
}

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const SQL = read('../diagnostics/non-course-members-read.sql')
const db = new PGlite()
await db.exec(read('base.sql'))
await db.exec(lift('../schema.sql', 'create trigger students_updated_at'))
await db.exec(lift('../migrations/2026_v82_cron_runs_audit.sql', 'create table if not exists cron_runs ('))

/** The rows of the file's last statement, as the SQL editor shows them. */
const run = async () => {
  const last = (await db.exec(SQL)).at(-1)
  return { cols: last.fields.map((f) => f.name), rows: last.rows }
}
const everything = async () => JSON.stringify({
  students: (await db.query('select * from students order by id')).rows,
  cron_runs: (await db.query('select * from cron_runs order by id')).rows,
})

console.log('\n=== No successful sync on record ===')
await db.exec(`insert into students (id, email, membership_status, whop_plan_id, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'made-up-1@example.com', 'active', 'plan_paid', now() - interval '3 days')`)
{
  const r = await run()
  ok(r.rows.length === 1 && Number(r.rows[0].not_in_last_sync) === 0 && /no successful sync on record/.test(r.rows[0].last_sync),
     'it runs, and says not_in_last_sync means nothing yet', JSON.stringify(r.rows))
}

console.log('\n=== A sync two hours ago, and rows on each side of it ===')
await db.exec(`
  insert into cron_runs (route_name, started_at, finished_at, auth_status, status) values
    ('sync-whop', now() - interval '2 hours', now() - interval '119 minutes', 'ok', 'success'),
    ('sync-whop', now() - interval '30 minutes', now() - interval '29 minutes', 'ok', 'failed'),
    ('check-engagement', now() - interval '10 minutes', now() - interval '9 minutes', 'ok', 'success');
  delete from students;
  insert into students (id, email, membership_status, whop_plan_id, updated_at) values
    -- rewritten by the sync: course members
    ('00000000-0000-0000-0000-000000000001', 'made-up-1@example.com', 'active',   'plan_paid', now() - interval '119 minutes'),
    ('00000000-0000-0000-0000-000000000002', 'made-up-2@example.com', 'active',   'plan_paid', now() - interval '119 minutes'),
    ('00000000-0000-0000-0000-000000000003', 'made-up-3@example.com', 'past_due', 'plan_paid', now() - interval '119 minutes'),
    -- not rewritten by it: no course membership when it ran
    ('00000000-0000-0000-0000-000000000004', 'made-up-4@example.com', 'active',   null,        now() - interval '5 days'),
    ('00000000-0000-0000-0000-000000000005', 'made-up-5@example.com', 'active',   'plan_apex', now() - interval '3 hours'),
    -- written after the sync by the webhook or a login: counted, not flagged (the floor)
    ('00000000-0000-0000-0000-000000000006', 'made-up-6@example.com', 'active',   null,        now() - interval '5 minutes'),
    -- not let in: never counted
    ('00000000-0000-0000-0000-000000000007', 'made-up-7@example.com', 'canceled', 'plan_paid', now() - interval '5 days'),
    ('00000000-0000-0000-0000-000000000008', 'made-up-8@example.com', 'expired',  null,        now() - interval '5 days');`)
{
  const before = await everything()
  const r = await run()
  const after = await everything()
  ok(after === before, 'read only: no row of students or cron_runs changed')
  ok(JSON.stringify(r.cols) === JSON.stringify(['plan', 'status', 'students', 'not_in_last_sync', 'last_sync']),
     'five columns: plan, status, students, not_in_last_sync, last_sync', r.cols.join(', '))
  const text = JSON.stringify(r.rows)
  ok(!/made-up|@example\.com|00000000-0000/.test(text), 'no email and no student id in what it shows')
  const got = r.rows.map((x) => `${x.plan}/${x.status}: ${x.students}, ${x.not_in_last_sync}`)
  const want = ['(none)/active: 2, 1', 'plan_apex/active: 1, 1', 'plan_paid/active: 2, 0', 'plan_paid/past_due: 1, 0']
  ok(JSON.stringify(got) === JSON.stringify(want), 'the counts per plan and status, the rows to look at first', got.join(' | '))
  const lastSync = (await db.query(`select to_char((now() - interval '2 hours') at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC' as t`)).rows[0].t
  ok(r.rows.every((x) => x.last_sync === lastSync), 'last_sync is the last SUCCESSFUL sync-whop run, not the later failed one or another cron', r.rows[0].last_sync)
}

console.log('\n=== What the header relies on: a rewrite moves updated_at ===')
{
  await db.exec(`update students set updated_at = now() - interval '5 days' where id = '00000000-0000-0000-0000-000000000001'`)
  // The sync's write: PostgREST's upsert, an INSERT ... ON CONFLICT DO UPDATE with the same values.
  await db.exec(`insert into students (id, membership_status, whop_plan_id) values
    ('00000000-0000-0000-0000-000000000001', 'active', 'plan_paid')
    on conflict (id) do update set membership_status = excluded.membership_status, whop_plan_id = excluded.whop_plan_id`)
  const moved = (await db.query(`select updated_at > now() - interval '1 minute' as fresh from students where id = '00000000-0000-0000-0000-000000000001'`)).rows[0].fresh
  ok(moved === true, 'an upsert that changes nothing still stamps updated_at (the students_updated_at trigger)')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
