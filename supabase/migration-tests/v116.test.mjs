// v116 and its undo (T-137, the 30% applies itself, 2026-10-26: the history
// of every 30% request in discount_request_events, the trigger that fills
// it, and the four columns the automatic 30% writes on discount_requests),
// with the read supabase/diagnostics/thirty-waiting.sql and the hand fix
// supabase/hand-fixes/thirty-close-request.sql, on a real Postgres (PGlite),
// in a file of its own as v111.test.mjs is.
//
//   cd supabase/migration-tests && npm install && node v116.test.mjs
//
// THE DATABASE is base.sql with the API roles' grants and the service role's
// bypass as Supabase has them (run.mjs, section 25), and auth.role() read
// from the test's own setting test.role, which stands for the role in the
// request's token (empty: the SQL editor, which sends none). Then the files
// production ran on discount_requests: v21 and v106 as they are, v29's two
// tables, function and grant lifted verbatim (as run.mjs lifts them), v107
// as it is, and the table's row level security as production has it after
// v105 (lifted from schema.sql and the team policy's fix). Then v116 is
// pasted as the owner pastes it, twice; every writer the app has, a team
// member's own session and the SQL editor write requests; the history is
// read and written as each role; the read and the hand fix run on made-up
// rows; the undo is pasted twice, v116 once more, and the undo again. Every
// student, team member, code and Whop id here is made up.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const migration = (f) => read('../migrations/' + f)
const V116 = migration('2026_v116_discount_request_history.sql')
const UNDO = read('../undo/2026_v116_undo.sql')
const WAITING = read('../diagnostics/thirty-waiting.sql')
const CLOSE = read('../hand-fixes/thirty-close-request.sql')
const V29F = '2026_v29_discount_feedback.sql'

// Lift a statement verbatim out of a real migration file, as run.mjs does: anchored at a line start, ending at the
// first ';' in code (or at endMarker).
function lift(file, startMarker, endMarker = ';') {
  const s = migration(file)
  const i = s.indexOf('\n' + startMarker) + 1
  if (i < 1) throw new Error(`marker not found in ${file}: ${startMarker}`)
  if (endMarker !== ';') {
    const j = s.indexOf(endMarker, i)
    if (j < 0) throw new Error(`end not found in ${file}`)
    return s.slice(i, j + endMarker.length)
  }
  const out = []
  for (const line of s.slice(i).split('\n')) {
    out.push(line)
    if (line.replace(/--.*$/, '').includes(';')) return out.join('\n')
  }
  throw new Error(`end not found in ${file}`)
}

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? Number(x) : x))
/** Objects with their keys sorted, all the way down: jsonb keeps keys in an order of its own (shorter first). */
const canon = (v) => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v)
const same = (a, b) => show(canon(a)) === show(canon(b))

// ── Made-up ids ──────────────────────────────────────────────────────────────
const T = 'c5000000-0000-4000-8000-000000000001' // a team member
const T2 = 'c5000000-0000-4000-8000-000000000002' // another team member
const X = '11111111-1111-4111-8111-111111111111' // one action's correlation id
const X2 = '22222222-2222-4222-8222-222222222222'
let made = 0
/** A made-up student, with a login id of their own. */
async function student(db) {
  made++
  const id = `00000000-0000-4000-8000-${String(made).padStart(12, '0')}`
  const login = `aa000000-0000-4000-8000-${String(made).padStart(12, '0')}`
  await db.query('insert into public.students (id, email, supabase_user_id) values ($1, $2, $3)', [id, `student-${made}@example.test`, login])
  return { id, login }
}

// ── The database ─────────────────────────────────────────────────────────────
async function database({ v21 = true } = {}) {
  const db = new PGlite()
  await db.exec(read('base.sql'))
  // The seam, as on Supabase (run.mjs, section 25): the API roles hold the table privileges, row level security does
  // the filtering, the service role skips it, and a new table is born open to the API roles.
  await db.exec(`
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    alter role service_role bypassrls;
    alter default privileges grant all on tables to anon, authenticated, service_role;
    alter default privileges grant usage on schemas to anon, authenticated, service_role;`)
  // auth.role(): the role in the request's token. Here the test's setting; empty is the SQL editor.
  await db.exec(`create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;`)
  if (v21) await db.exec(migration('2026_v21_discount_applied_state.sql'))
  await db.exec(migration('2026_v106_one_pending_discount_request.sql'))
  // The feedback form (v29): its two tables, its function and its grant; then v107 as production has it.
  for (const sql of [lift(V29F, 'create table if not exists discount_feedback_questions ('),
                     lift(V29F, 'create table if not exists discount_feedback_responses ('),
                     lift(V29F, 'create or replace function public.submit_discount_with_feedback(', '$func$;'),
                     lift(V29F, 'grant execute on function public.submit_discount_with_feedback(uuid, jsonb) to authenticated;')]) {
    await db.exec(sql)
  }
  await db.exec(migration('2026_v107_feedback_function_server_only.sql'))
  // discount_requests' row level security as production has it after v105: students read their own, the team all.
  for (const sql of [lift('../schema.sql', 'alter table discount_requests enable row level security;'),
                     lift('../schema.sql', 'create policy "Students can read own discount requests"'),
                     lift('2026_fix_team_members_recursion.sql', 'create policy "Team can manage all discount requests"')]) {
    await db.exec(sql)
  }
  await db.exec(`insert into public.team_members (id, email) values ('${T}', 'team-one@example.test'), ('${T2}', 'team-two@example.test');`)
  return db
}

/** A file run as the SQL editor runs it: the whole text, as the owner with no token; its last rows, or its error. */
async function paste(db, sql, notices = null) {
  try {
    const last = (await db.exec(sql, notices ? { onNotice: (n) => notices.push(n) } : undefined)).at(-1)
    return { rows: last?.rows ?? [] }
  } catch (e) {
    await db.exec('rollback;').catch(() => {})
    return { code: e.code, message: e.message }
  }
}
/**
 * `statements` as `role` (null: the SQL editor, the owner with no token), each on its own as PostgREST sends them, with
 * the seams set: test.role is what auth.role() answers, test.uid auth.uid(), test.is_team current_user_is_team().
 * The rows of the last, or the error; `notices` gathers the warnings.
 */
async function as(db, role, statements, { team = false, uid = '', notices = null } = {}) {
  await db.exec(`${role ? `set role ${role};` : ''}
    select set_config('test.role', '${role ?? ''}', false), set_config('test.is_team', '${team}', false), set_config('test.uid', '${uid}', false);`)
  try {
    let last = null
    for (const s of [].concat(statements)) last = await db.query(s, [], notices ? { onNotice: (n) => notices.push(n) } : undefined)
    return { rows: last?.rows ?? [], n: last?.affectedRows ?? 0 }
  } catch (e) {
    return { code: e.code, message: e.message }
  } finally {
    await db.exec(`reset role; select set_config('test.role', '', false), set_config('test.is_team', '', false), set_config('test.uid', '', false);`)
  }
}
const server = (db, statements, opts) => as(db, 'service_role', statements, opts)
const sqlEditor = (db, statements, opts) => as(db, null, statements, opts)
const teamSession = (db, statements, uid = T) => as(db, 'authenticated', statements, { team: true, uid })

const eventsOf = async (db, id) =>
  (await db.query(`select event, from_status, to_status, actor, team_member_id, correlation_id, reason, detail
                     from public.discount_request_events where request_id = $1 order by id`, [id])).rows
const last = async (db, id) => (await eventsOf(db, id)).at(-1) ?? null
const rowOf = async (db, id) =>
  (await db.query(`select status, promo_code, whop_promo_id, promo_claimed_at, audit_actor, audit_correlation_id, audit_team_member_id,
                          reviewed_by, applied_by from public.discount_requests where id = $1`, [id])).rows[0] ?? null
const countEvents = async (db) => (await db.query('select count(*)::int as n from public.discount_request_events')).rows[0].n
/** A pending request, inserted as the plain request route inserts it (the service role, the student alone). */
async function request(db, studentId) {
  const r = await server(db, `insert into public.discount_requests (student_id) values ('${studentId}') returning id`)
  if (r.code) throw new Error(`could not make a request: ${r.message}`)
  return r.rows[0].id
}
const said = (r) => (r.code ? `${r.code}: ${(r.message ?? '').slice(0, 140)}` : show(r.rows?.[0] ?? {}).slice(0, 200))
const refused = (r, sentence) => r.code === 'P0001' && (r.message ?? '').includes(sentence) && /Nothing was changed\.$/.test(r.message ?? '')

// ── The shape of the database, and everything in it ────────────────────────
/** History tables an undo kept (and their own names), left out of a shape when asked. */
const KEPT = /^discount_request_events_v116_undone/
async function shapeOf(db, { leaveOutKept = false } = {}) {
  const q = async (sql) => (await db.query(sql)).rows
  const keep = (rows) => (leaveOutKept ? rows.filter((r) => !KEPT.test(r.t ?? '') && !KEPT.test(r.n ?? '')) : rows)
  return show({
    // In their order, without ordinal_position: a column added again after the undo takes a new one.
    columns: keep(await q(`select table_name::text as t, column_name::text as c, data_type, is_nullable, column_default
                             from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`)),
    constraints: keep(await q(`select conrelid::regclass::text as t, conname::text as n, pg_get_constraintdef(oid) as def
                                 from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`)),
    indexes: keep(await q(`select tablename::text as t, indexname::text as n, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`)),
    triggers: keep(await q(`select tgrelid::regclass::text as t, tgname::text as n, pg_get_triggerdef(oid) as def, tgenabled
                              from pg_trigger where not tgisinternal order by 1, 2`)),
    policies: keep(await q(`select tablename::text as t, policyname::text as n, cmd, roles::text as roles, qual, with_check
                              from pg_policies where schemaname = 'public' order by 1, 2`)),
    relations: keep(await q(`select relname::text as t, relkind::text as k, relrowsecurity as rls, coalesce(relacl::text, '') as acl,
                                    obj_description(oid, 'pg_class') as comment
                               from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'S', 'v') order by 1`)),
    columnComments: keep(await q(`select c.relname::text as t, a.attname::text as c, col_description(c.oid, a.attnum) as d
                                    from pg_class c join pg_attribute a on a.attrelid = c.oid
                                   where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped
                                     and col_description(c.oid, a.attnum) is not null order by 1, 2`)),
    functions: await q(`select oid::regprocedure::text as f, prosecdef, md5(prosrc) as src, coalesce(array_to_string(proconfig, ','), '') as config
                          from pg_proc where pronamespace = 'public'::regnamespace order by 1`),
  })
}
/** Every row of every table in public, as sorted JSON. */
async function rowsIn(db) {
  const out = {}
  for (const { t } of (await db.query(`select tablename::text as t from pg_tables where schemaname = 'public' order by 1`)).rows) {
    out[t] = (await db.query(`select * from public."${t}"`)).rows.map((x) => show(x)).sort()
  }
  return show(out)
}
const stateOf = async (db) => (await shapeOf(db)) + (await rowsIn(db))

// ── A statement put into a file just before `marker`, keeping a value in a session setting ──
const probeAt = (sql, marker, name, what) => {
  const i = sql.indexOf(marker)
  if (i < 0) throw new Error(`marker not found: ${marker}`)
  return sql.slice(0, i) + `select set_config('test.${name}', ${what}, false);\n` + sql.slice(i)
}
const probed = async (db, name) =>
  (await db.query(`select coalesce(current_setting('test.${name}', true), '') as v, current_setting('lock_timeout') as after`)).rows[0]
const lockedIn = (mode) => `(select coalesce(string_agg(distinct c.relname::text, ',' order by c.relname::text), '')
    from pg_locks l join pg_class c on c.oid = l.relation
   where l.pid = pg_backend_pid() and l.locktype = 'relation' and c.relnamespace = 'public'::regnamespace
     and c.relkind = 'r' and l.mode = '${mode}')`
const TIMED_OUT = `raise exception 'canceling statement due to lock timeout' using errcode = '55P03';`

const NEW_COLUMNS = ['audit_actor text YES', 'audit_correlation_id uuid YES', 'audit_team_member_id uuid YES', 'promo_claimed_at timestamp with time zone YES']
const EVENT_COLUMNS = [
  'id bigint NO', 'request_id uuid NO', 'student_id uuid NO', 'event text NO', 'from_status text YES', 'to_status text YES',
  'actor text NO', 'team_member_id uuid YES', 'correlation_id uuid YES', 'reason text YES', 'detail jsonb NO',
  'created_at timestamp with time zone NO',
]
const columnsOf = async (db, table) =>
  (await db.query(`select column_name, data_type, is_nullable from information_schema.columns
                    where table_schema = 'public' and table_name = $1 order by ordinal_position`, [table])).rows
    .map((c) => `${c.column_name} ${c.data_type} ${c.is_nullable}`)
const EVENTS = ['requested', 'code_made', 'applied', 'rejected', 'reopened', 'code_changed', 'attempt_failed', 'override']
const ACTORS = ['student', 'auto', 'job', 'team', 'sql']
const REASONS = ['check_refused', 'no_membership', 'membership_not_active', 'membership_has_code', 'whop_no_answer', 'key_not_allowed',
                 'code_not_made', 'apply_refused', 'landed_elsewhere', 'write_failed', 'old_code', 'code_unknown']
const FIRST_RUN = 'v116 ran now: discount_requests has its four columns, and every change of a request is recorded in discount_request_events from here on.'
const AGAIN = 'v116 was already in place. This run changed nothing.'

// ═════════════════════════════════════════════════════════════════════════════
const db = await database()
const v114Shape = await shapeOf(db)

console.log('\n=== Before v116: production\'s discount_requests ===')
{
  ok(show(await columnsOf(db, 'discount_requests')).includes('applied_by uuid YES')
       && !(await columnsOf(db, 'discount_requests')).some((c) => /^(audit_|promo_claimed_at)/.test(c)),
     'v21\'s columns are there and none of v116\'s', show(await columnsOf(db, 'discount_requests')))
  const triggers = (await db.query(`select count(*)::int as n from pg_trigger where tgrelid = 'public.discount_requests'::regclass and not tgisinternal`)).rows[0].n
  ok(triggers === 0 && (await db.query(`select to_regclass('public.discount_request_events') as t`)).rows[0].t === null,
     'no trigger on discount_requests and no history table: nothing records a request\'s history', String(triggers))
}

console.log('\n=== v116, pasted ===')
let v116Shape = null
{
  // The lock, read from inside the file: discount_requests in ACCESS EXCLUSIVE before the checks, with lock_timeout 5s.
  const MARK = '-- ─────────────── 2. It can ───────────────'
  const c = await db.clone()
  const probedFile = probeAt(probeAt(V116, MARK, 'v116_locked', lockedIn('AccessExclusiveLock')), MARK, 'v116_timeout', `current_setting('lock_timeout')`)
  const rr = await paste(c, probedFile)
  const locked = await probed(c, 'v116_locked')
  const timeout = await probed(c, 'v116_timeout')
  ok(V116.includes(MARK) && !rr.code && locked.v === 'discount_requests' && timeout.v === '5s' && timeout.after === '0',
     'it holds discount_requests in ACCESS EXCLUSIVE mode before it reads anything, with lock_timeout 5s, and the setting ends with its commit',
     `${locked.v}, ${timeout.v}, after ${timeout.after}`)
  const second = await paste(c, probedFile)
  const lockedAgain = await probed(c, 'v116_locked')
  ok(!second.code && same(lockedAgain.v.split(',').sort(), ['discount_request_events', 'discount_requests']),
     'pasted again, it holds discount_request_events too, which the first paste made', lockedAgain.v)
  await c.close()
}
{
  const r = await paste(db, V116)
  ok(same(r.rows, [{ v116: FIRST_RUN, new_columns: 4, events_table: true, trigger_on_requests: 1, events_now: 0, row_level_security: true,
                     policies: 1, visitor_can_read: false, signed_in_can_insert: false, signed_in_can_select: true }]),
     'its own row: "v116 ran now", the 4 columns, the table, the trigger, 0 events, row level security on with 1 policy, a visitor cannot read, a signed-in user may select and not insert',
     said(r))
  const cols = await columnsOf(db, 'discount_requests')
  ok(same(cols.slice(-4), NEW_COLUMNS) && cols.length === 15,
     'discount_requests gains audit_actor, audit_correlation_id, audit_team_member_id and promo_claimed_at, each nullable, after its 11 columns', show(cols.slice(-4)))
  const defaults = (await db.query(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'discount_requests'
                                      and column_name in ('audit_actor', 'audit_correlation_id', 'audit_team_member_id', 'promo_claimed_at') and column_default is not null`)).rows[0].n
  const keyed = (await db.query(`select count(*)::int as n from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
                                   where c.conrelid = 'public.discount_requests'::regclass and a.attname in ('audit_actor', 'audit_correlation_id', 'audit_team_member_id', 'promo_claimed_at')`)).rows[0].n
  ok(defaults === 0 && keyed === 0, 'no default, check or key on the four (the trigger guards and empties the audit columns)', `${defaults} defaults, ${keyed} constraints`)
  ok(same(await columnsOf(db, 'discount_request_events'), EVENT_COLUMNS), 'discount_request_events has its 12 columns, their types, and which may be empty',
     show(await columnsOf(db, 'discount_request_events')))
  const defs = Object.fromEntries((await db.query(`select conname::text as n, pg_get_constraintdef(oid) as d from pg_constraint
                                                    where conrelid = 'public.discount_request_events'::regclass`)).rows.map((x) => [x.n, x.d]))
  const valuesOf = (d) => [...(d ?? '').matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1])
  ok(same(valuesOf(defs.discount_request_events_event_check), EVENTS) && same(valuesOf(defs.discount_request_events_actor_check), ACTORS)
       && same(valuesOf(defs.discount_request_events_reason_check), REASONS) && /reason IS NULL/.test(defs.discount_request_events_reason_check ?? ''),
     'its three checks take the PRD\'s lists: 8 events, 5 actors, 12 reasons (or none)', show([defs.discount_request_events_event_check?.length, defs.discount_request_events_actor_check?.length]))
  ok(/REFERENCES discount_requests\(id\) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED/.test(defs.discount_request_events_request_id_fkey ?? '')
       && /REFERENCES students\(id\) ON DELETE CASCADE/.test(defs.discount_request_events_student_id_fkey ?? '')
       && /REFERENCES team_members\(id\)$/.test(defs.discount_request_events_team_member_id_fkey ?? '')
       && /PRIMARY KEY \(id\)/.test(defs.discount_request_events_pkey ?? ''),
     'its keys: the request (on delete cascade, checked at the commit, so a request\'s first event can be written before its row), the student (on delete cascade), the team member, and its own id',
     show([defs.discount_request_events_request_id_fkey, defs.discount_request_events_team_member_id_fkey]))
  const idx = (await db.query(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'discount_request_events_request_idx'`)).rows[0]?.indexdef
  ok(/ON public\.discount_request_events USING btree \(request_id, created_at DESC\)$/.test(idx ?? ''), 'the index on (request_id, created_at desc)', idx)
  const policies = (await db.query(`select policyname, cmd, roles::text as roles, qual from pg_policies where tablename = 'discount_request_events'`)).rows
  ok(same(policies, [{ policyname: 'Team can read discount request events', cmd: 'SELECT', roles: '{authenticated}', qual: 'current_user_is_team()' }]),
     'its one policy: "Team can read discount request events", select, to authenticated, using current_user_is_team()', show(policies))
  const trig = (await db.query(`select pg_get_triggerdef(oid) as d from pg_trigger where tgrelid = 'public.discount_requests'::regclass and tgname = 'discount_request_history'`)).rows[0]?.d
  const fn = (await db.query(`select prosecdef, proconfig from pg_proc where oid = 'public.discount_request_history()'::regprocedure`)).rows[0]
  ok(/BEFORE INSERT OR UPDATE ON public\.discount_requests FOR EACH ROW EXECUTE FUNCTION discount_request_history\(\)/.test(trig ?? '')
       && fn?.prosecdef === true && same(fn?.proconfig, ['search_path=public']),
     'the trigger: before insert or update on discount_requests, for each row, its function security definer with search_path public', trig)
  const commented = (await db.query(`select count(*)::int as n from pg_attribute where attrelid = 'public.discount_requests'::regclass
                                       and attname in ('audit_actor', 'audit_correlation_id', 'audit_team_member_id', 'promo_claimed_at')
                                       and col_description(attrelid, attnum) like 'v116:%'`)).rows[0].n
  ok(commented === 4 && /^v116: the history/.test((await db.query(`select obj_description('public.discount_request_events'::regclass, 'pg_class') as d`)).rows[0].d ?? ''),
     'the four columns and the table say what they are for', String(commented))
  v116Shape = await shapeOf(db)
}
{
  const before = await stateOf(db)
  const r = await paste(db, V116)
  ok(same(r.rows.map((x) => x.v116), [AGAIN]) && r.rows[0].events_now === 0 && (await stateOf(db)) === before,
     'a second paste: "already in place", and every table, column, constraint, index, policy, grant, function and row as it was', said(r))
}

console.log('\n=== Who writes, and what the history records ===')
const S = {}
const R = {}
{
  // 1. The plain request route's insert, and the feedback form's function: the student's request.
  S.plain = await student(db)
  R.plain = await request(db, S.plain.id)
  ok(same(await eventsOf(db, R.plain), [{ event: 'requested', from_status: null, to_status: 'pending', actor: 'student', team_member_id: null,
                                          correlation_id: R.plain, reason: null, detail: {} }]),
     'the plain route\'s insert (the service role, no actor named): one requested event, actor student, its correlation the request\'s own id',
     show(await eventsOf(db, R.plain)))
  S.form = await student(db)
  const fromForm = await server(db, `select public.submit_discount_with_feedback('${S.form.id}', '[]'::jsonb)::text as id`)
  R.form = fromForm.rows?.[0]?.id
  ok(!fromForm.code && same(await eventsOf(db, R.form), [{ event: 'requested', from_status: null, to_status: 'pending', actor: 'student',
                                                           team_member_id: null, correlation_id: R.form, reason: null, detail: {} }]),
     'the feedback form\'s function (v107, called by the service role): one requested event, actor student, correlation the request\'s id',
     fromForm.code ? said(fromForm) : show(await eventsOf(db, R.form)))
  const twice = await server(db, `select public.submit_discount_with_feedback('${S.form.id}', '[]'::jsonb)::text as id`)
  const second = await server(db, `insert into public.discount_requests (student_id) values ('${S.form.id}')`)
  ok(twice.code === 'P0001' && second.code === '23505' && (await eventsOf(db, R.form)).length === 1
       && (await db.query(`select count(*)::int as n from public.discount_request_events where student_id = '${S.form.id}'`)).rows[0].n === 1,
     'a second request refused (the function\'s own check, then v106\'s index, 23505) takes its event back with it: still one event for the student',
     `${twice.code} / ${second.code}`)

  // 2. The automatic path in one action: the claim, the approved write, the applied write.
  const NAME = 'ECOM30-TESTAA'
  const PROMO = 'promo_testAuto1'
  const claim = await server(db, `update public.discount_requests set promo_code = '${NAME}', promo_claimed_at = now(), audit_actor = 'auto', audit_correlation_id = '${X}'
                                   where id = '${R.plain}' and status = 'pending' and promo_code is null`)
  const approved = await server(db, `update public.discount_requests set status = 'approved', whop_promo_id = '${PROMO}', reviewed_at = now(), reviewed_by = null,
                                       audit_actor = 'auto', audit_correlation_id = '${X}'
                                      where id = '${R.plain}' and status = 'pending' and promo_code = '${NAME}' and whop_promo_id is null`)
  const applied = await server(db, `update public.discount_requests set status = 'applied', applied_at = now(), applied_by = null, audit_actor = 'auto', audit_correlation_id = '${X}'
                                     where id = '${R.plain}' and status = 'approved' and whop_promo_id = '${PROMO}'`)
  const e = await eventsOf(db, R.plain)
  ok(claim.n === 1 && approved.n === 1 && applied.n === 1
       && same(e.slice(1).map((x) => [x.event, x.from_status, x.to_status, x.actor, x.team_member_id, x.correlation_id]),
               [['code_changed', 'pending', 'pending', 'auto', null, X], ['code_made', 'pending', 'approved', 'auto', null, X], ['applied', 'approved', 'applied', 'auto', null, X]]),
     'the claim, the approved write and the applied write in one action: code_changed, code_made, applied, each by auto, one correlation, no team member',
     show(e.map((x) => [x.event, x.actor, x.correlation_id === X])))
  ok(same(e[1].detail, { from: { promo_code: null, whop_promo_id: null }, to: { promo_code: NAME, whop_promo_id: null } })
       && same(e[2].detail, { promo_code: NAME, whop_promo_id: PROMO }) && same(e[3].detail, { promo_code: NAME, whop_promo_id: PROMO }),
     'code_changed holds the code before and after; code_made and applied the code the request holds', show(e.slice(1).map((x) => x.detail)))
  const row = await rowOf(db, R.plain)
  ok(row.audit_actor === null && row.audit_correlation_id === null && row.audit_team_member_id === null && row.promo_claimed_at !== null && row.status === 'applied',
     'the three audit columns are empty after every write; promo_claimed_at is kept', show(row))

  // 3. Each actor.
  S.job = await student(db)
  R.job = await request(db, S.job.id)
  await server(db, `update public.discount_requests set promo_code = 'ECOM30-JBAAAA', promo_claimed_at = now(), audit_actor = 'job', audit_correlation_id = '${X2}' where id = '${R.job}'`)
  let ev = await last(db, R.job)
  ok(ev.event === 'code_changed' && ev.actor === 'job' && ev.team_member_id === null && ev.correlation_id === X2, 'the job: actor job, no team member, its correlation', show(ev))

  await server(db, `update public.discount_requests set status = 'approved', whop_promo_id = 'promo_testJob1', reviewed_at = now(), reviewed_by = '${T}',
                      audit_actor = 'team', audit_team_member_id = '${T2}', audit_correlation_id = '${X}' where id = '${R.job}'`)
  ev = await last(db, R.job)
  ok(ev.event === 'code_made' && ev.actor === 'team' && ev.team_member_id === T2,
     'the team through the service role with audit_team_member_id: actor team, that member (over reviewed_by)', show(ev))

  S.rev = await student(db)
  R.rev = await request(db, S.rev.id)
  await server(db, `update public.discount_requests set status = 'approved', promo_code = 'ECOM30-RVAAAA', whop_promo_id = 'promo_testRev1', reviewed_at = now(),
                      reviewed_by = '${T}', audit_actor = 'team', audit_correlation_id = '${X}' where id = '${R.rev}'`)
  const byReviewer = await last(db, R.rev)
  await server(db, `update public.discount_requests set status = 'applied', applied_at = now(), applied_by = '${T2}', audit_actor = 'team', audit_correlation_id = '${X}'
                     where id = '${R.rev}'`)
  const byApplier = await last(db, R.rev)
  ok(byReviewer.event === 'code_made' && byReviewer.team_member_id === T && byApplier.event === 'applied' && byApplier.team_member_id === T2,
     'the team through the service role with only reviewed_by and applied_by: the reviewer for code_made, the one who applied for applied',
     show([byReviewer.team_member_id, byApplier.team_member_id]))
  S.rej = await student(db)
  R.rej = await request(db, S.rej.id)
  await server(db, `update public.discount_requests set status = 'rejected', reviewed_at = now(), reviewed_by = '${T}', rejection_reason = 'Two accounts.',
                      audit_actor = 'team', audit_correlation_id = '${X2}' where id = '${R.rej}'`)
  ev = await last(db, R.rej)
  ok(ev.event === 'rejected' && ev.actor === 'team' && ev.team_member_id === T && ev.from_status === 'pending' && ev.to_status === 'rejected',
     'a team Reject through the service role: rejected, from pending, the reviewer named', show(ev))

  S.sess = await student(db)
  R.sess = await request(db, S.sess.id)
  const own = await teamSession(db, `update public.discount_requests set status = 'approved', promo_code = 'ECOM30-SSAAAA', whop_promo_id = 'promo_testSess1',
                                       reviewed_at = now(), reviewed_by = '${T}' where id = '${R.sess}'`)
  ev = await last(db, R.sess)
  ok(!own.code && own.n === 1 && ev.event === 'code_made' && ev.actor === 'team' && ev.team_member_id === T,
     'a team member\'s own session (authenticated, under the team\'s policy): actor team, the session\'s own user (auth.uid())', own.code ? said(own) : show(ev))
  const other = await teamSession(db, `update public.discount_requests set status = 'applied', applied_at = now(), applied_by = '${T2}',
                                         audit_actor = 'auto', audit_team_member_id = '${T2}' where id = '${R.sess}'`)
  ev = await last(db, R.sess)
  ok(!other.code && ev.event === 'applied' && ev.actor === 'team' && ev.team_member_id === T,
     'a team session sending another member\'s id (and the actor auto): still team, still its own user, never the member it sent', show(ev))

  S.sql = await student(db)
  R.sql = await request(db, S.sql.id)
  await sqlEditor(db, `update public.discount_requests set status = 'rejected', rejection_reason = 'By hand.' where id = '${R.sql}'`)
  const bySql = await last(db, R.sql)
  await sqlEditor(db, `update public.discount_requests set status = 'pending', audit_actor = 'team', audit_team_member_id = '${T}' where id = '${R.sql}'`)
  const sqlNamingTeam = await last(db, R.sql)
  ok(bySql.event === 'rejected' && bySql.actor === 'sql' && bySql.team_member_id === null
       && sqlNamingTeam.event === 'reopened' && sqlNamingTeam.actor === 'sql' && sqlNamingTeam.team_member_id === null,
     'the SQL editor (the owner, no token): actor sql and no member, even when it names team and a member; back to pending is reopened',
     show([bySql, sqlNamingTeam].map((x) => [x.event, x.actor, x.team_member_id])))
  await server(db, `update public.discount_requests set status = 'approved', promo_code = 'ECOM30-SQAAAA', whop_promo_id = 'promo_testSql1', reviewed_at = now(),
                      reviewed_by = '${T}' where id = '${R.sql}'`)
  const oldBuild = await last(db, R.sql)
  ok(oldBuild.event === 'code_made' && oldBuild.actor === 'sql' && oldBuild.team_member_id === null && oldBuild.correlation_id === null
       && (await rowOf(db, R.sql)).reviewed_by === T,
     'the build from before v116 (the service role, no actor named, its Approve\'s write): actor sql, its member left on the row\'s reviewed_by', show(oldBuild))
  S.mix = await student(db)
  R.mix = await request(db, S.mix.id)
  await server(db, `update public.discount_requests set promo_code = 'ECOM30-MXAAAA', promo_claimed_at = now(), audit_actor = 'auto', audit_team_member_id = '${T}',
                      audit_correlation_id = '${X}' where id = '${R.mix}'`)
  ev = await last(db, R.mix)
  ok(ev.actor === 'auto' && ev.team_member_id === null, 'a member id sent with a non-team actor (auto): not recorded', show(ev))

  // 4. A misspelled actor stops the write.
  const n0 = await countEvents(db)
  const misspelt = []
  for (const word of ['Auto', 'sql', 'robot', 'team ']) {
    misspelt.push(await server(db, `update public.discount_requests set status = 'rejected', audit_actor = '${word}' where id = '${R.mix}'`))
  }
  const fromSession = await teamSession(db, `update public.discount_requests set status = 'rejected', audit_actor = 'Team' where id = '${R.mix}'`)
  const onInsert = await server(db, `insert into public.discount_requests (student_id, audit_actor) values ('${(await student(db)).id}', 'student!')`)
  ok(misspelt.every((r, i) => refused(r, `audit_actor ${['Auto', 'sql', 'robot', 'team '][i]} is not one of student, auto, job, team.`))
       && refused(fromSession, 'audit_actor Team is not one of') && refused(onInsert, 'audit_actor student! is not one of')
       && (await rowOf(db, R.mix)).status === 'pending' && (await countEvents(db)) === n0,
     'a misspelled actor (Auto, sql, robot, "team ", from a team session too, on an insert too) refuses the write, says so ending "Nothing was changed.", and nothing is written',
     said(misspelt[0]))

  // 5. No status or code change: no event.
  const n1 = await countEvents(db)
  await server(db, `update public.discount_requests set rejection_reason = 'x', audit_actor = 'job', audit_correlation_id = '${X}' where id = '${R.mix}'`)
  await server(db, `update public.discount_requests set promo_claimed_at = now() where id = '${R.mix}'`)
  await server(db, `update public.discount_requests set audit_actor = 'auto', audit_team_member_id = '${T}' where id = '${R.mix}'`)
  const quiet = await rowOf(db, R.mix)
  ok((await countEvents(db)) === n1 && quiet.audit_actor === null && quiet.audit_team_member_id === null && quiet.audit_correlation_id === null,
     'a write that changes neither the status nor the code (the reason, the claim time, the audit columns alone): no event, and the audit columns emptied', String(n1))

  // 6. The status and the code in one write: one event, the status's.
  S.both = await student(db)
  R.both = await request(db, S.both.id)
  await server(db, `update public.discount_requests set status = 'approved', promo_code = 'ECOM30-BTAAAA', whop_promo_id = 'promo_testBoth1', reviewed_at = now(),
                      reviewed_by = '${T}', audit_actor = 'team', audit_team_member_id = '${T}', audit_correlation_id = '${X}' where id = '${R.both}'`)
  const both = await eventsOf(db, R.both)
  ok(same(both.map((x) => x.event), ['requested', 'code_made']) && same(both[1].detail, { promo_code: 'ECOM30-BTAAAA', whop_promo_id: 'promo_testBoth1' }),
     'a write that changes the status and the code together: one event, the status\'s (code_made), its detail naming the new code', show(both.map((x) => [x.event, x.detail])))
  const badStatus = await server(db, `update public.discount_requests set status = 'gone', audit_actor = 'job' where id = '${R.both}'`)
  ok(badStatus.code === '23514' && (await eventsOf(db, R.both)).length === 2, 'a status the check refuses (23514) takes its event back with it', said(badStatus))

  // 7. The app's own events, and the lists.
  const override = await server(db, `insert into public.discount_request_events (request_id, student_id, event, actor, team_member_id, correlation_id, detail)
                                      values ('${R.sess}', '${S.sess.id}', 'override', 'team', '${T}', '${X2}', '{"rule": true, "coupon": false}'::jsonb) returning id, detail, reason, created_at`)
  ok(!override.code && same(override.rows[0]?.detail, { rule: true, coupon: false }) && override.rows[0]?.created_at instanceof Date,
     'an override event inserted by the service role (Approve anyway): accepted, with its detail and its own time', said(override))
  const failed = []
  for (const reason of REASONS) {
    failed.push(await server(db, `insert into public.discount_request_events (request_id, student_id, event, actor, correlation_id, reason, detail)
                                   values ('${R.job}', '${S.job.id}', 'attempt_failed', 'job', '${X}', '${reason}', '{"step": "attach"}'::jsonb)`))
  }
  const eventsTaken = []
  for (const event of EVENTS) eventsTaken.push(await server(db, `insert into public.discount_request_events (request_id, student_id, event, actor) values ('${R.mix}', '${S.mix.id}', '${event}', 'auto')`))
  const actorsTaken = []
  for (const actor of ACTORS) actorsTaken.push(await server(db, `insert into public.discount_request_events (request_id, student_id, event, actor) values ('${R.mix}', '${S.mix.id}', 'attempt_failed', '${actor}')`))
  ok(failed.every((r) => !r.code) && eventsTaken.every((r) => !r.code) && actorsTaken.every((r) => !r.code),
     'every reason (12), every event (8) and every actor (5) of the lists is taken', said(failed.find((r) => r.code) ?? eventsTaken.find((r) => r.code) ?? actorsTaken.find((r) => r.code) ?? { rows: [] }))
  const outside = [
    await server(db, `insert into public.discount_request_events (request_id, student_id, event, actor) values ('${R.mix}', '${S.mix.id}', 'paid', 'auto')`),
    await server(db, `insert into public.discount_request_events (request_id, student_id, event, actor) values ('${R.mix}', '${S.mix.id}', 'override', 'robot')`),
    await server(db, `insert into public.discount_request_events (request_id, student_id, event, actor, reason) values ('${R.mix}', '${S.mix.id}', 'attempt_failed', 'job', 'whop_down')`),
  ]
  const noDetail = (await db.query(`select detail from public.discount_request_events where request_id = '${R.mix}' and event = 'requested' order by id desc limit 1`)).rows[0]?.detail
  const ghost = await server(db, `insert into public.discount_request_events (request_id, student_id, event, actor) values ('00000000-0000-4000-8000-0000000000ff', '${S.mix.id}', 'attempt_failed', 'job')`)
  ok(outside.every((r) => r.code === '23514') && same(noDetail, {}) && ghost.code === '23503',
     'an event, an actor or a reason outside the lists is refused (23514); detail is {} when none is given; an event for no request is refused at the commit (23503)',
     show([...outside, ghost].map((r) => r.code)))

  // 8. An event that cannot be written never blocks the request's own write.
  await db.exec(`alter table public.discount_request_events add constraint force_fail check (event <> 'requested') not valid;`)
  const warnings = []
  S.lost = await student(db)
  const lost = await server(db, `insert into public.discount_requests (student_id) values ('${S.lost.id}') returning id`, { notices: warnings })
  R.lost = lost.rows?.[0]?.id
  await db.exec(`alter table public.discount_request_events drop constraint force_fail;`)
  const warned = warnings.find((w) => /discount_request_history: no event for request/.test(w.message ?? ''))
  ok(!lost.code && (await rowOf(db, R.lost))?.status === 'pending' && (await eventsOf(db, R.lost)).length === 0
       && warned?.severity === 'WARNING' && warned.message.includes(R.lost) && /\(23514: /.test(warned.message),
     'an event that cannot be written (a NOT VALID check refusing it): the request is written all the same, with a warning naming it and the reason', warned?.message ?? said(lost))

  // 9. A student still reads their own requests, the new columns with them; the history is the team's.
  const mine = await as(db, 'authenticated', `select id, status, audit_actor, audit_correlation_id, audit_team_member_id, promo_claimed_at from public.discount_requests`,
                        { team: false, uid: S.plain.login })
  ok(mine.rows?.length === 1 && mine.rows[0].id === R.plain && mine.rows[0].audit_actor === null && mine.rows[0].promo_claimed_at !== null,
     'a student\'s own session reads their own request alone, the audit columns empty and the claim\'s time with it', said(mine))
}

console.log('\n=== Who may read and write the history ===')
{
  const all = await countEvents(db)
  const team = await teamSession(db, 'select count(*)::int as n from public.discount_request_events')
  const studentReads = await as(db, 'authenticated', 'select count(*)::int as n from public.discount_request_events', { team: false, uid: S.plain.login })
  ok(team.rows?.[0]?.n === all && all > 0, 'a team member reads every event', `${team.rows?.[0]?.n} of ${all}`)
  ok(studentReads.rows?.[0]?.n === 0, 'a signed-in student reads none, not even their own request\'s', said(studentReads))
  const writes = [
    ['insert', `insert into public.discount_request_events (request_id, student_id, event, actor) values ('${R.plain}', '${S.plain.id}', 'override', 'team')`],
    ['update', `update public.discount_request_events set reason = 'old_code'`],
    ['delete', 'delete from public.discount_request_events'],
    ['truncate', 'truncate public.discount_request_events'],
  ]
  for (const [what, sql] of writes) {
    const r = await teamSession(db, sql)
    ok(r.code === '42501', `a team member's own session cannot ${what} (42501): only the service role writes`, said(r))
  }
  for (const [what, sql] of [['select', 'select * from public.discount_request_events'], ...writes.filter(([w]) => w !== 'update' && w !== 'delete')]) {
    const r = await as(db, 'anon', sql)
    ok(r.code === '42501', `a visitor cannot ${what} (42501)`, said(r))
  }
  ok((await countEvents(db)) === all, 'after all of that every event is still there', String(all))
  const viaServer = await server(db, 'select count(*)::int as n from public.discount_request_events')
  ok(viaServer.rows?.[0]?.n === all, 'the service role reads every event (it skips row level security)', said(viaServer))
}

console.log('\n=== A request or a student deleted takes the history with it ===')
{
  const s = await student(db)
  const id = await request(db, s.id)
  await server(db, `update public.discount_requests set promo_code = 'ECOM30-DLAAAA', audit_actor = 'auto' where id = '${id}'`)
  const had = (await eventsOf(db, id)).length
  await db.exec(`delete from public.discount_requests where id = '${id}'`)
  const s2 = await student(db)
  const id2 = await request(db, s2.id)
  const had2 = (await eventsOf(db, id2)).length
  await db.exec(`delete from public.students where id = '${s2.id}'`)
  ok(had === 2 && (await eventsOf(db, id)).length === 0 && had2 === 1 && (await eventsOf(db, id2)).length === 0
       && (await db.query(`select count(*)::int as n from public.discount_requests where id = '${id2}'`)).rows[0].n === 0,
     'deleting a request deletes its events; deleting a student deletes their requests and their events (on delete cascade)', `${had}, ${had2}`)
}

console.log('\n=== The hand fix: supabase/hand-fixes/thirty-close-request.sql ===')
/** The hand fix with its values filled in, as Claude fills them in on the owner's word. */
function filled(values) {
  let sql = CLOSE
  for (const [name, value] of Object.entries(values)) {
    const re = new RegExp(`(\\b${name}\\s+constant text := )'';`)
    if (!re.test(sql)) throw new Error(`no value ${name} in the hand fix`)
    sql = sql.replace(re, `$1'${String(value).replace(/'/g, "''")}';`)
  }
  return sql
}
{
  // A code unknown: approved by the build from before, its code with no Whop id. Linked to the replacement the team made.
  const s = await student(db)
  const id = await request(db, s.id)
  await server(db, `update public.discount_requests set status = 'approved', promo_code = 'ECOM30-LKAAAA', reviewed_at = now(), reviewed_by = '${T}' where id = '${id}'`)
  const n0 = (await eventsOf(db, id)).length
  const link = filled({ c_mode: 'link', c_request: id, c_promo_read: '', c_new_promo: 'promo_testLink1', c_new_code: 'ECOM30-LKBBBB' })
  const r = await paste(db, link)
  const ev = (await eventsOf(db, id)).slice(n0)
  ok(!r.code && same(ev.map((x) => [x.event, x.from_status, x.to_status, x.actor, x.team_member_id]),
                     [['code_changed', 'approved', 'approved', 'sql', null], ['applied', 'approved', 'applied', 'sql', null]])
       && same(ev[0].detail, { from: { promo_code: 'ECOM30-LKAAAA', whop_promo_id: null }, to: { promo_code: 'ECOM30-LKBBBB', whop_promo_id: 'promo_testLink1' } }),
     'link on a code unknown: the code first, then applied; the trigger records code_changed then applied, both by sql', r.code ? said(r) : show(ev.map((x) => x.event)))
  const row = r.rows?.[0] ?? {}
  ok(row.thirty_close === 'Linked: its code is now ECOM30-LKBBBB (promo_testLink1), then it was marked applied.' && row.request_id === id && row.status === 'applied'
       && row.whop_promo_id === 'promo_testLink1' && row.applied_at instanceof Date && (await rowOf(db, id)).applied_by === null && (await rowOf(db, id)).reviewed_by === T,
     'it shows the row it changed, applied with the replacement; applied_by empty (no team member pressed it), the approver kept', show(row))
  const was = await stateOf(db)
  const again = await paste(db, link)
  ok(!again.code && /^Nothing was changed: the request is applied with whop_promo_id promo_testLink1, not approved with empty as read\./.test(again.rows?.[0]?.thirty_close ?? '')
       && (await stateOf(db)) === was,
     'run a second time: "Nothing was changed", and nothing is', again.rows?.[0]?.thirty_close ?? said(again))

  // A code on the wrong membership: approved with its Whop id. The read id does not match, then it does.
  const s2 = await student(db)
  const id2 = await request(db, s2.id)
  await server(db, `update public.discount_requests set status = 'approved', promo_code = 'ECOM30-LEAAAA', whop_promo_id = 'promo_testElse1', reviewed_at = now(),
                      reviewed_by = '${T}', audit_actor = 'job' where id = '${id2}'`)
  const wasWrong = await stateOf(db)
  const wrongRead = await paste(db, filled({ c_mode: 'link', c_request: id2, c_promo_read: 'promo_testOther', c_new_promo: 'promo_testElse2', c_new_code: 'ECOM30-LEBBBB' }))
  ok(/^Nothing was changed: the request is approved with whop_promo_id promo_testElse1, not approved with promo_testOther as read\./.test(wrongRead.rows?.[0]?.thirty_close ?? '')
       && (await stateOf(db)) === wasWrong,
     'link with a Whop id that is not the one stored: nothing is changed, and it says what the request holds', wrongRead.rows?.[0]?.thirty_close ?? said(wrongRead))
  const rightRead = await paste(db, filled({ c_mode: 'link', c_request: id2, c_promo_read: 'promo_testElse1', c_new_promo: 'promo_testElse2', c_new_code: 'ECOM30-LEBBBB' }))
  ok(rightRead.rows?.[0]?.status === 'applied' && same((await eventsOf(db, id2)).slice(-2).map((x) => [x.event, x.actor]), [['code_changed', 'sql'], ['applied', 'sql']]),
     'link with the stored id as read: code_changed then applied', show(rightRead.rows?.[0]))

  // Reject, while the row is as read.
  const s3 = await student(db)
  const id3 = await request(db, s3.id)
  await server(db, `update public.discount_requests set status = 'approved', promo_code = 'ECOM30-RJAAAA', whop_promo_id = 'promo_testRej1', reviewed_at = now() - interval '2 days',
                      reviewed_by = '${T}', audit_actor = 'team' where id = '${id3}'`)
  const rejectIt = filled({ c_mode: 'reject', c_request: id3, c_status_read: 'approved', c_code_read: 'ECOM30-RJAAAA', c_promo_read: 'promo_testRej1',
                            c_reason: 'Two accounts on one card.' })
  const rj = await paste(db, rejectIt)
  const after = await db.query(`select status, rejection_reason, reviewed_by, reviewed_at > now() - interval '1 minute' as now_reviewed from public.discount_requests where id = '${id3}'`)
  const rev = await last(db, id3)
  ok(!rj.code && rj.rows?.[0]?.thirty_close === 'Rejected (it was approved). The code ECOM30-RJAAAA stays usable at checkout until someone switches it off in Whop.'
       && same(after.rows[0], { status: 'rejected', rejection_reason: 'Two accounts on one card.', reviewed_by: null, now_reviewed: true })
       && rev.event === 'rejected' && rev.actor === 'sql' && rev.from_status === 'approved',
     'reject: the request rejected with the reason, reviewed now by no team member; the trigger records rejected by sql; the code left usable is named',
     rj.rows?.[0]?.thirty_close ?? said(rj))
  const wasRejected = await stateOf(db)
  const rjAgain = await paste(db, rejectIt)
  ok(/^Nothing was changed: the request is rejected/.test(rjAgain.rows?.[0]?.thirty_close ?? '') && (await stateOf(db)) === wasRejected,
     'reject run a second time: nothing is changed', rjAgain.rows?.[0]?.thirty_close ?? said(rjAgain))
  const s4 = await student(db)
  const id4 = await request(db, s4.id)
  const pendingNoCode = await paste(db, filled({ c_mode: 'reject', c_request: id4, c_status_read: 'pending', c_reason: '' }))
  ok(pendingNoCode.rows?.[0]?.thirty_close === 'Rejected (it was pending).' && pendingNoCode.rows?.[0]?.rejection_reason === null,
     'reject on a pending request with no code and no reason: rejected, no code to name, no reason stored', show(pendingNoCode.rows?.[0]))

  // Its refusals, each changing nothing.
  const none = await paste(db, CLOSE)
  const unknownId = await paste(db, filled({ c_mode: 'link', c_request: '00000000-0000-4000-8000-0000000000fe', c_new_promo: 'promo_testX', c_new_code: 'ECOM30-XXXXXX' }))
  ok(refused(none, 'Fill in the mode at the top of the block') && /^Nothing was changed: no request has the id/.test(unknownId.rows?.[0]?.thirty_close ?? ''),
     'pasted with nothing filled in it refuses; with an id no request has it changes nothing and says so', `${said(none)} / ${unknownId.rows?.[0]?.thirty_close}`)
  const cases = [
    ['a request id that is not one', { c_mode: 'link', c_request: 'the request', c_new_promo: 'promo_testX', c_new_code: 'ECOM30-XXXXXX' }, 'Fill in the request\'s id'],
    ['link with a name where the Whop id goes', { c_mode: 'link', c_request: id4, c_new_promo: 'ECOM30-XXXXXX', c_new_code: 'ECOM30-XXXXXX' }, 'link needs the replacement code\'s Whop id'],
    ['link with no name', { c_mode: 'link', c_request: id4, c_new_promo: 'promo_testX', c_new_code: ' ' }, 'link needs the replacement code\'s Whop id'],
    ['reject on a status read as applied', { c_mode: 'reject', c_request: id4, c_status_read: 'applied' }, 'reject takes a pending or an approved request'],
    ['a reason that shows a code', { c_mode: 'reject', c_request: id4, c_status_read: 'pending', c_reason: 'Your code ECOM30-TESTAA was a mistake.' }, 'The student reads the reason on the map'],
    ['a reason with an em dash', { c_mode: 'reject', c_request: id4, c_status_read: 'pending', c_reason: `Not this time ${String.fromCharCode(8212)} sorry.` }, 'The student reads the reason on the map'],
    ['a reason with "unlock"', { c_mode: 'reject', c_request: id4, c_status_read: 'pending', c_reason: 'Unlock it later.' }, 'The student reads the reason on the map'],
  ]
  for (const [what, values, sentence] of cases) {
    const was2 = await stateOf(db)
    const r2 = await paste(db, filled(values))
    ok(refused(r2, sentence) && (await stateOf(db)) === was2, `it refuses ${what}, says so, and changes nothing`, said(r2))
  }
  const bare = await database()
  const s5 = await student(bare)
  const id5 = await request(bare, s5.id)
  const noV116 = await paste(bare, filled({ c_mode: 'reject', c_request: id5, c_status_read: 'pending' }))
  ok(refused(noV116, 'v116 is not in this database'), 'on a database without v116 it refuses: the fix would be recorded nowhere', said(noV116))
  await bare.close()
}

console.log('\n=== The read: supabase/diagnostics/thirty-waiting.sql ===')
{
  // Its statements: the text without its comments and its string literals, cut at each ';'.
  const statements = WAITING.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''").split(';').map((s) => s.trim()).filter(Boolean)
  ok(statements.length === 1 && /^with\b/i.test(statements[0]), 'it is one select and nothing else', String(statements.length))

  const dg = await database()
  const at = (sql) => `(${sql})`
  // Before v116 (no history yet), the requests the build from before made, at times of their own.
  const old = {}
  const oldRow = async (name, status, made, extra = {}) => {
    const s = await student(dg)
    const cols = { student_id: s.id, status, created_at: made, ...extra }
    const names = Object.keys(cols)
    const values = names.map((k) => (cols[k] === null ? 'null' : /^\(/.test(cols[k]) ? cols[k] : `'${cols[k]}'`))
    old[name] = (await dg.query(`insert into public.discount_requests (${names.join(', ')}) values (${values.join(', ')}) returning id`)).rows[0].id
  }
  await oldRow('pending30h', 'pending', at("now() - interval '30 hours'"))
  await oldRow('approvedWithId', 'approved', at("now() - interval '3 days'"), { promo_code: 'ECOM30-W2AAAA', whop_promo_id: 'promo_testW2', reviewed_at: at("now() - interval '3 days'") })
  await oldRow('codeUnknown', 'approved', at("now() - interval '10 days'"), { promo_code: 'ECOM30-W3AAAA', reviewed_at: at("now() - interval '9 days'") })
  await oldRow('pendingSeptember', 'pending', '2026-09-20T10:00:00Z')
  await oldRow('applied', 'applied', at("now() - interval '5 days'"), { promo_code: 'ECOM30-W5AAAA', whop_promo_id: 'promo_testW5' })
  await oldRow('rejectedClaim', 'rejected', at("now() - interval '6 days'"), { promo_code: 'ECOM30-W6AAAA' })
  await oldRow('codeUnknownSeptember', 'approved', '2026-09-15T10:00:00Z', { promo_code: 'ECOM30-W7AAAA' })
  await oldRow('justBefore1Oct', 'pending', '2026-09-30T21:59:59Z')
  await oldRow('at1Oct', 'pending', '2026-09-30T22:00:00Z')

  ok(!(await paste(dg, V116)).code, 'v116 pasted on this database')
  const empty = await paste(dg, WAITING)
  ok(!empty.code && same([...new Set(empty.rows.map((x) => x.part))], ['a. waiting', 'b. claimed name, no Whop id', 'f. approved, code unknown']),
     'right after the paste: no event yet, so parts c, d and e are empty; a, b and f list the requests from before', said(empty))

  // After v116, the app's writes, each through the trigger.
  const fresh = {}
  for (const name of ['claimed', 'twoFailures', 'lostEvent', 'approved', 'applied', 'rejected', 'reopened', 'triggerOff', 'lostThenReopened']) {
    const s = await student(dg)
    if (name === 'lostEvent' || name === 'lostThenReopened') {
      await dg.exec(`alter table public.discount_request_events add constraint force_fail check (event <> 'requested') not valid;`)
      fresh[name] = (await server(dg, `insert into public.discount_requests (student_id) values ('${s.id}') returning id`)).rows[0].id
      await dg.exec(`alter table public.discount_request_events drop constraint force_fail;`)
    } else {
      fresh[name] = await request(dg, s.id)
    }
  }
  await server(dg, `update public.discount_requests set promo_code = 'ECOM30-CLAAAA', promo_claimed_at = now() - interval '10 minutes', audit_actor = 'auto' where id = '${fresh.claimed}'`)
  const studentOf = async (id) => (await dg.query(`select student_id from public.discount_requests where id = '${id}'`)).rows[0].student_id
  await server(dg, `insert into public.discount_request_events (request_id, student_id, event, actor, reason, detail)
                    values ('${fresh.twoFailures}', '${await studentOf(fresh.twoFailures)}', 'attempt_failed', 'auto', 'whop_no_answer', '{"step": "attach"}')`)
  await server(dg, `insert into public.discount_request_events (request_id, student_id, event, actor, reason, detail)
                    values ('${fresh.twoFailures}', '${await studentOf(fresh.twoFailures)}', 'attempt_failed', 'job', 'membership_not_active', '{"step": "candidates", "membership_status": "past_due"}')`)
  await server(dg, `update public.discount_requests set status = 'approved', promo_code = 'ECOM30-APAAAA', whop_promo_id = 'promo_testAp1', audit_actor = 'job' where id = '${fresh.approved}'`)
  await server(dg, `update public.discount_requests set status = 'approved', promo_code = 'ECOM30-AQAAAA', whop_promo_id = 'promo_testAq1', audit_actor = 'job' where id = '${fresh.applied}'`)
  await server(dg, `update public.discount_requests set status = 'applied', applied_at = now(), audit_actor = 'job' where id = '${fresh.applied}'`)
  await server(dg, `update public.discount_requests set status = 'rejected', reviewed_by = '${T}', audit_actor = 'team' where id = '${fresh.rejected}'`)
  await server(dg, `update public.discount_requests set status = 'approved', promo_code = 'ECOM30-RPAAAA', whop_promo_id = 'promo_testRp1', audit_actor = 'job' where id = '${fresh.reopened}'`)
  await sqlEditor(dg, `update public.discount_requests set status = 'pending' where id = '${fresh.reopened}'`)
  // Its requested event lost, then approved and reopened: the reopened event explains its pending status.
  await server(dg, `update public.discount_requests set status = 'approved', promo_code = 'ECOM30-LRAAAA', whop_promo_id = 'promo_testLr1', audit_actor = 'job' where id = '${fresh.lostThenReopened}'`)
  await sqlEditor(dg, `update public.discount_requests set status = 'pending' where id = '${fresh.lostThenReopened}'`)
  await dg.exec(`alter table public.discount_requests disable trigger discount_request_history;`)
  await dg.exec(`update public.discount_requests set status = 'approved', promo_code = 'ECOM30-TOAAAA', whop_promo_id = 'promo_testTo1' where id = '${fresh.triggerOff}';`)
  await dg.exec(`alter table public.discount_requests enable trigger discount_request_history;`)
  await server(dg, `insert into public.discount_request_events (request_id, student_id, event, actor, reason, detail)
                    values ('${old.applied}', '${await studentOf(old.applied)}', 'attempt_failed', 'auto', 'write_failed', '{"step": "attach_after_reject", "code": "ECOM30-W5AAAA", "confirmed": false}')`)
  await server(dg, `insert into public.discount_request_events (request_id, student_id, event, actor, reason, detail)
                    values ('${fresh.rejected}', '${await studentOf(fresh.rejected)}', 'attempt_failed', 'job', 'whop_no_answer', '{"step": "create"}')`)

  const wasDg = await stateOf(dg)
  const r = await paste(dg, WAITING)
  ok(!r.code && (await stateOf(dg)) === wasDg, 'it runs, and every table and row is as it was (read only)', said(r))
  const part = (p) => r.rows.filter((x) => x.part === p)
  const ids = (p) => part(p).map((x) => x.request_id).sort()
  const byId = (p, id) => part(p).find((x) => x.request_id === id)
  ok(same(Object.keys(r.rows[0] ?? {}), ['part', 'request_id', 'student_id', 'status', 'at_croatia', 'age_hours', 'what', 'n']),
     'its columns: part, request_id, student_id, status, at_croatia, age_hours, what, n', show(Object.keys(r.rows[0] ?? {})))

  const waiting = [old.pending30h, old.approvedWithId, old.codeUnknown, old.at1Oct, fresh.claimed, fresh.twoFailures, fresh.lostEvent, fresh.approved, fresh.reopened,
                   fresh.triggerOff, fresh.lostThenReopened]
  ok(same(ids('a. waiting'), [...waiting].sort()),
     'a: every pending or approved request from 1 October (2026-09-30 22:00 UTC on), none before it, none applied or rejected', show(part('a. waiting').map((x) => x.status)))
  const madeOrder = (await dg.query(`select id from public.discount_requests where id = any ($1::uuid[]) order by created_at, id`, [waiting])).rows.map((x) => x.id)
  ok(same(part('a. waiting').map((x) => x.request_id), madeOrder), 'a: oldest first')
  const two = byId('a. waiting', fresh.twoFailures)
  const p30 = byId('a. waiting', old.pending30h)
  ok(two?.n === 2 && /^newest failure membership_not_active \(step candidates\) at \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(two.what)
       && p30?.what === 'no failed attempt yet' && p30.n === 0 && Number(p30.age_hours) >= 29.9 && Number(p30.age_hours) < 31,
     'a: the newest failed attempt with its reason, step and time, and how many failed; "no failed attempt yet" and the age in hours otherwise',
     show([two, p30].map((x) => [x?.what, x?.n, x?.age_hours])))

  ok(same(ids('b. claimed name, no Whop id'), [fresh.claimed, old.codeUnknown, old.rejectedClaim, old.codeUnknownSeptember].sort()),
     'b: every request of any status holding a code name with no Whop id (a claim, a code unknown, a rejected one written by hand)', show(part('b. claimed name, no Whop id').map((x) => x.status)))
  const claimRow = byId('b. claimed name, no Whop id', fresh.claimed)
  ok(/^code ECOM30-CLAAAA, claimed \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(claimRow?.what ?? '') && Number(claimRow.age_hours) >= 0.1 && Number(claimRow.age_hours) < 0.3
       && byId('b. claimed name, no Whop id', old.rejectedClaim)?.what === 'code ECOM30-W6AAAA, no claim time',
     'b: the claimed name, when it was claimed and the claim\'s age in hours ("no claim time" when the row has none)', show(claimRow))

  ok(same(ids('c. status with no event'), [fresh.lostEvent, fresh.triggerOff].sort()),
     'c: a request whose event could not be written, and one moved with the trigger off; never one made before the first event, nor one whose status has its event (a reopened event for a pending one whose requested event was lost)',
     show(part('c. status with no event').map((x) => x.what)))
  ok(byId('c. status with no event', fresh.lostEvent)?.what === 'no requested or reopened event; its events: none'
       && byId('c. status with no event', fresh.triggerOff)?.what === 'no code_made event; its events: requested',
     'c: which event is missing, and the events it has', show(part('c. status with no event').map((x) => x.what)))

  const today = (await dg.query(`select to_char((now() at time zone 'Europe/Zagreb')::date, 'YYYY-MM-DD') as d`)).rows[0].d
  const counted = Object.fromEntries(part('d. events per day').map((x) => [`${x.at_croatia} ${x.what}`, x.n]))
  const expected = (await dg.query(`select event, count(*)::int as n from public.discount_request_events group by event`)).rows
  ok(expected.every((x) => counted[`${today} ${x.event}`] === x.n) && part('d. events per day').length === expected.length,
     'd: each event counted for today, in Croatia', show(counted))

  ok(same(ids('e. write_failed, last 30 days'), [old.applied]) && byId('e. write_failed, last 30 days', old.applied)?.what === 'step attach_after_reject, code ECOM30-W5AAAA, confirmed false'
       && byId('e. write_failed, last 30 days', old.applied)?.status === 'applied',
     'e: the write_failed attempt with its step, its code and "confirmed false", the request\'s status now; other failures are not listed', show(part('e. write_failed, last 30 days')))

  ok(same(ids('f. approved, code unknown'), [old.codeUnknown, old.codeUnknownSeptember].sort())
       && /^code ECOM30-W3AAAA, no Whop id, approved \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(byId('f. approved, code unknown', old.codeUnknown)?.what ?? ''),
     'f: every approved request with no Whop id, of any date, with its code', show(part('f. approved, code unknown').map((x) => x.what)))

  // Days in Croatia, and the 30 days of part e, on events of fixed times.
  const dd = await dg.clone()
  const evAt = async (iso, event, reason = null, step = null) =>
    server(dd, `insert into public.discount_request_events (request_id, student_id, event, actor, reason, detail, created_at)
                values ('${old.applied}', '${await studentOf(old.applied)}', '${event}', 'job', ${reason ? `'${reason}'` : 'null'},
                        '${step ? JSON.stringify({ step }) : '{}'}', '${iso}')`)
  // Winter (UTC+1) and summer (UTC+2) days, far from any day the test runs on.
  await evAt('2026-01-10T10:00:00Z', 'code_made')
  await evAt('2026-01-10T23:30:00Z', 'code_made')
  await evAt('2026-07-10T21:59:00Z', 'applied')
  await evAt('2026-07-10T22:30:00Z', 'applied')
  await evAt('2026-07-11T08:00:00Z', 'applied')
  const thirtyOneDays = (await dd.query(`select (now() - interval '31 days')::text as t`)).rows[0].t
  const twentyNineDays = (await dd.query(`select (now() - interval '29 days')::text as t`)).rows[0].t
  await evAt(thirtyOneDays, 'attempt_failed', 'write_failed', 'decided_meanwhile')
  await evAt(twentyNineDays, 'attempt_failed', 'write_failed', 'approved_write_error')
  const r2 = await paste(dd, WAITING)
  const d2 = Object.fromEntries(r2.rows.filter((x) => x.part === 'd. events per day').map((x) => [`${x.at_croatia} ${x.what}`, x.n]))
  ok(d2['2026-01-10 code_made'] === 1 && d2['2026-01-11 code_made'] === 1 && d2['2026-07-10 applied'] === 1 && d2['2026-07-11 applied'] === 2,
     'd: days are Croatia\'s (23:30 UTC on 10 January is the 11th there, 22:30 UTC on 10 July the 11th, 21:59 UTC on 10 July still the 10th)',
     show(Object.fromEntries(Object.entries(d2).filter(([k]) => k.startsWith('2026-0')))))
  const dOrder = r2.rows.filter((x) => x.part === 'd. events per day').map((x) => x.at_croatia)
  ok(same(dOrder, [...dOrder].sort().reverse()), 'd: newest day first', show([...new Set(dOrder)]))
  const e2 = r2.rows.filter((x) => x.part === 'e. write_failed, last 30 days').map((x) => x.what)
  ok(same(e2, ['step approved_write_error', 'step attach_after_reject, code ECOM30-W5AAAA, confirmed false']),
     'e: a write_failed of 29 days ago is listed, one of 31 days ago is not; oldest first', show(e2))
  await dd.close()
  await dg.close()
}

console.log('\n=== The undo, pasted twice, then v116 again, then the undo again ===')
{
  const requestsBefore = (await db.query(`select id, student_id, status, promo_code, whop_promo_id, reviewed_by, reviewed_at, rejection_reason, applied_at, applied_by, created_at
                                            from public.discount_requests order by id`)).rows
  const eventsBefore = (await db.query('select * from public.discount_request_events order by id')).rows
  // The lock, read from inside the file.
  {
    const MARK = '-- ─────────────── 2 to 4. The trigger, the history, the columns ───────────────'
    const c = await db.clone()
    const rr = await paste(c, probeAt(probeAt(UNDO, MARK, 'undo_locked', lockedIn('AccessExclusiveLock')), MARK, 'undo_timeout', `current_setting('lock_timeout')`))
    const locked = await probed(c, 'undo_locked')
    const timeout = await probed(c, 'undo_timeout')
    ok(UNDO.includes(MARK) && !rr.code && same(locked.v.split(',').sort(), ['discount_request_events', 'discount_requests']) && timeout.v === '5s' && timeout.after === '0',
       'the undo holds discount_requests and discount_request_events in ACCESS EXCLUSIVE mode first, with lock_timeout 5s', `${locked.v}, ${timeout.v}`)
    await c.close()
  }
  const r = await paste(db, UNDO)
  ok(same(r.rows, [{ v116_undo: `The v116 undo ran now: the history is kept as discount_request_events_v116_undone (${eventsBefore.length} events), and the trigger and the four columns are gone.`,
                     history_kept_as: 'discount_request_events_v116_undone', events_kept: eventsBefore.length, trigger_left: 0, function_left: false,
                     events_table_left: false, columns_left: 0 }]),
     'the undo: its own row says the history is kept as discount_request_events_v116_undone with every event, and the trigger, its function, the table\'s name and the four columns are gone',
     said(r))
  ok((await shapeOf(db, { leaveOutKept: true })) === v114Shape,
     'discount_requests and everything else are back to their shape before v116 (v114\'s): columns, constraints, indexes, triggers, policies, grants, functions (the kept table left out)')
  const kept = (await db.query('select * from public.discount_request_events_v116_undone order by id')).rows
  ok(same(kept, eventsBefore), 'the kept table holds every event, as it was', `${kept.length} events`)
  const names = (await db.query(`select relname::text as n from pg_class where relnamespace = 'public'::regnamespace and relname like 'discount_request_events%'`)).rows.map((x) => x.n).sort()
  const keptConstraints = (await db.query(`select conname::text as n from pg_constraint where conrelid = 'public.discount_request_events_v116_undone'::regclass`)).rows.map((x) => x.n).sort()
  ok(same(names, ['discount_request_events_v116_undone', 'discount_request_events_v116_undone_id_seq', 'discount_request_events_v116_undone_pkey', 'discount_request_events_v116_undone_request_idx'])
       && keptConstraints.every((n) => n.startsWith('discount_request_events_v116_undone_')) && keptConstraints.length === 7,
     'its index, primary key, identity sequence and 7 constraints are renamed with it, so no name of v116\'s is left taken', show({ names, keptConstraints }))
  const teamReadsKept = await teamSession(db, 'select count(*)::int as n from public.discount_request_events_v116_undone')
  const visitorReadsKept = await as(db, 'anon', 'select count(*)::int as n from public.discount_request_events_v116_undone')
  ok(teamReadsKept.rows?.[0]?.n === eventsBefore.length && visitorReadsKept.code === '42501', 'its policy and grants went with it: the team reads it, a visitor cannot', `${said(teamReadsKept)} / ${visitorReadsKept.code}`)
  const requestsAfter = (await db.query(`select id, student_id, status, promo_code, whop_promo_id, reviewed_by, reviewed_at, rejection_reason, applied_at, applied_by, created_at
                                           from public.discount_requests order by id`)).rows
  ok(same(requestsAfter, requestsBefore), 'every request is as it was, row for row, but the four columns')

  // The build from before v116 writes as it always did, and nothing is recorded.
  const s = await student(db)
  const oldInsert = await server(db, `insert into public.discount_requests (student_id) values ('${s.id}') returning id`)
  const oldApprove = await server(db, `update public.discount_requests set status = 'approved', promo_code = 'ECOM30-OBAAAA', whop_promo_id = 'promo_testOld1',
                                         reviewed_at = now(), reviewed_by = '${T}' where id = '${oldInsert.rows?.[0]?.id}'`)
  ok(!oldInsert.code && oldApprove.n === 1 && (await db.query('select count(*)::int as n from public.discount_request_events_v116_undone')).rows[0].n === eventsBefore.length,
     'after it, the build from before v116 inserts and approves as before, and nothing is recorded', `${said(oldInsert)} / ${oldApprove.n}`)
  const newBuild = await server(db, `update public.discount_requests set audit_actor = 'auto' where id = '${oldInsert.rows?.[0]?.id}'`)
  ok(newBuild.code === '42703', 'and the build of v116 would fail on the missing columns (42703): its header says to redeploy the build before first', said(newBuild))

  const was = await stateOf(db)
  const again = await paste(db, UNDO)
  ok(same(again.rows.map((x) => [x.v116_undo, x.history_kept_as, x.events_kept, x.trigger_left, x.function_left, x.events_table_left, x.columns_left]),
          [['Nothing of v116 was left to undo. This run changed nothing.', null, null, 0, false, false, 0]]) && (await stateOf(db)) === was,
     'a second undo: "Nothing of v116 was left to undo", and nothing changes', said(again))

  const back = await paste(db, V116)
  ok(back.rows?.[0]?.v116 === FIRST_RUN && back.rows[0].events_now === 0 && back.rows[0].trigger_on_requests === 1,
     'v116 pastes again after the undo: "ran now", a new and empty history', said(back))
  ok((await shapeOf(db, { leaveOutKept: true })) === v116Shape,
     'and everything is as the first paste left it, every name included (the kept table left out)')
  const s2 = await student(db)
  const id2 = await request(db, s2.id)
  ok(same((await eventsOf(db, id2)).map((x) => [x.event, x.actor]), [['requested', 'student']]), 'the trigger records again', show(await eventsOf(db, id2)))

  const second = await paste(db, UNDO)
  ok(second.rows?.[0]?.history_kept_as === 'discount_request_events_v116_undone_2' && second.rows[0].events_kept === 1
       && (await db.query('select count(*)::int as n from public.discount_request_events_v116_undone')).rows[0].n === eventsBefore.length,
     'the undo again: the new history is kept as discount_request_events_v116_undone_2, the first one untouched', said(second))
  ok((await shapeOf(db, { leaveOutKept: true })) === v114Shape, 'and discount_requests is back to v114\'s shape again')
}

console.log('\n=== v116 refuses, and changes nothing ===')
{
  const cases = [
    ['without discount_requests', async (d) => d.exec('drop table public.discount_requests cascade;'), 'v116 needs these tables and they are missing: discount_requests.'],
    ['without team_members', async (d) => d.exec('drop table public.team_members cascade;'), 'v116 needs these tables and they are missing: team_members.'],
    ['with discount_requests as it was before v21', null, 'discount_requests is not as v21 leaves it: these columns are missing: applied_at, applied_by.'],
    ['with a status check that does not take applied', async (d) => d.exec(`alter table public.discount_requests drop constraint discount_requests_status_check;
        alter table public.discount_requests add constraint discount_requests_status_check check (status in ('pending', 'approved', 'rejected'));`),
     'discount_requests is not as v21 leaves it: no check on its status takes exactly pending, approved, rejected and applied.'],
    ['without auth.role()', async (d) => d.exec('drop function auth.role();'), 'auth.role() does not exist'],
    ['without auth.uid()', async (d) => d.exec('drop function auth.uid() cascade;'), 'auth.uid() does not exist'],
    ['without current_user_is_team()', async (d) => d.exec('drop function public.current_user_is_team() cascade;'), 'public.current_user_is_team() does not exist'],
    ['without the role anon', async (d) => d.exec('drop owned by anon; drop role anon;'), 'These roles are missing: anon.'],
    ['with a discount_request_events of its own', async (d) => d.exec('create table public.discount_request_events (id int primary key, note text);'),
     'A table discount_request_events exists and is not the one this file makes (its columns: id integer not null, note text).'],
  ]
  for (const [what, breakIt, sentence] of cases) {
    const d = breakIt ? await database() : await database({ v21: false })
    if (breakIt) await breakIt(d)
    const was = await stateOf(d)
    const r = await paste(d, V116)
    ok(refused(r, sentence) && (await stateOf(d)) === was, `v116 ${what}: it refuses, says so, and changes nothing`, said(r))
    await d.close()
  }
  {
    const d = await database()
    const was = await stateOf(d)
    const busy = await paste(d, V116.replace('lock table public.discount_requests in access exclusive mode;', TIMED_OUT))
    ok(V116.includes('lock table public.discount_requests in access exclusive mode;') && busy.code === '55P03'
         && (busy.message ?? '').includes('Another session held public.discount_requests for more than 5 seconds (canceling statement due to lock timeout), so v116 did not start. Nothing was changed. Paste it again in a minute.')
         && (await stateOf(d)) === was,
       'v116 with its lock timing out (55P03): "Another session held public.discount_requests ... Paste it again in a minute.", and nothing changed', said(busy))
    const undoBusy = await paste(d, UNDO.replace('lock table public.discount_requests in access exclusive mode;', TIMED_OUT))
    ok(undoBusy.code === '55P03' && (undoBusy.message ?? '').includes('so the v116 undo did not start. Nothing was changed. Paste it again in a minute.'),
       'the undo with its lock timing out says the same of itself', said(undoBusy))
    await d.close()
  }
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
