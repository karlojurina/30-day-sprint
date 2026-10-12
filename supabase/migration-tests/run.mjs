import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const M = fileURLToPath(new URL('../migrations/', import.meta.url))
const read = f => fs.readFileSync(M + f, 'utf8')

// Lift a statement verbatim out of a real migration file.
function lift(file, startMarker, endMarker = ';') {
  const s = read(file)
  // Anchor at a line start, else the marker matches the header COMMENT that
  // describes the statement and we lift prose instead of SQL.
  const i = s.indexOf('\n' + startMarker) + 1
  if (i < 1) throw new Error(`marker not found in ${file}: ${startMarker}`)
  if (endMarker !== ';') {
    const j = s.indexOf(endMarker, i)
    if (j < 0) throw new Error(`end not found in ${file}`)
    return s.slice(i, j + endMarker.length)
  }
  // Terminating ';' must be found in CODE, not in a '--' comment. v90's own
  // comment about the bigint trap ends in a semicolon and truncated the lift.
  const lines = s.slice(i).split('\n')
  const out = []
  for (const line of lines) {
    out.push(line)
    if (line.replace(/--.*$/, '').includes(';')) return out.join('\n')
  }
  throw new Error(`end not found in ${file}`)
}

const db = new PGlite()
const fail = []
const ok = []
const note = (pass, label, detail = '') => {
  ;(pass ? ok : fail).push(label + (detail ? ` — ${detail}` : ''))
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function exec(sql, label) {
  try { await db.exec(sql); return true }
  catch (e) { note(false, label, e.message); return false }
}

console.log('\n=== 1. base schema ===')
await exec(fs.readFileSync(new URL('base.sql', import.meta.url), 'utf8'), 'base schema')

console.log('\n=== 2. real pre-v92 objects, lifted verbatim ===')
const v81view = lift('2026_v81_canonical_progress_alignment.sql', 'create or replace view public.student_progress_counts as')
const v49view = lift('2026_v49_student_current_region_view.sql', 'create or replace view public.student_current_region as')
const v90view = lift('2026_v90_achievement_stats_and_copy.sql', 'create or replace view achievement_unlock_stats')
const v89fn   = lift('2026_v89_point_in_time_snapshots.sql', 'create or replace function public.rebuild_daily_snapshots(', '$$;')
for (const [sql, l] of [[v81view,'v81 student_progress_counts'],[v49view,'v49 student_current_region'],[v90view,'v90 achievement_unlock_stats'],[v89fn,'v89 rebuild_daily_snapshots']]) {
  if (await exec(sql, `lift+run ${l}`)) console.log(`         (${sql.split('\n').length} lines)`)
}
// v78 hardening, as it stands in production today
await exec(`
alter view public.student_progress_counts set (security_invoker = on);
revoke select on public.student_progress_counts from anon;
grant select on public.student_progress_counts to authenticated;
alter view public.student_current_region set (security_invoker = on);
revoke select on public.student_current_region from anon;
grant select on public.student_current_region to authenticated;
revoke select on public.achievement_unlock_stats from anon;
grant select on public.achievement_unlock_stats to authenticated;
grant execute on function public.rebuild_daily_snapshots(date, date) to authenticated;`, 'v78 hardening')

console.log('\n=== 3. seed (65 lessons incl. l057 + l078, 8 students) ===')
let seed = `
insert into regions (id, order_num, name, terrain) values
 ('r1',1,'Foundation','shore'),('r2',2,'Production','forest'),
 ('r3',3,'Strategy','mountains'),('r4',4,'Gate of Possibilities','city');
`
const regionOf = n => n <= 16 ? 'r1' : n <= 32 ? 'r2' : n <= 48 ? 'r3' : 'r4'
for (let n = 1; n <= 64; n++) {
  const id = 'l' + String(n).padStart(3, '0')
  const type = n % 7 === 0 ? 'setup' : n % 3 === 0 ? 'action' : 'watch'
  const ra = (n % 8 === 0) ? 'true' : 'false'
  seed += `insert into lessons (id,region_id,day,type,title,requires_action,action_brief,sort_order) values ('${id}','${regionOf(n)}',${Math.min(30, Math.ceil(n/2.2))},'${type}','Lesson ${n}',${ra},${ra==='true'?"'brief'":'null'},${n});\n`
}
seed += `insert into lessons (id,region_id,day,type,title,sort_order) values ('l078','r4',30,'action','Playbook unlock',78);\n`
// l057 is the bounty-access lesson
seed += `update lessons set type='action', requires_action=false where id='l057';\n`

const S = n => `('00000000-0000-0000-0000-00000000000${n}'::uuid)`
seed += `insert into students (id, supabase_user_id, first_paid_at, whop_plan_id, membership_status, csm_exempt) values\n`
seed += [1,2,3,4,5,6,7,8].map(n =>
  `(${S(n)}, ${S(n)}, '2026-06-0${n} 10:00:00+00'::timestamptz, 'plan_4ZrwR4PmBsVsx','active', false)`).join(',\n') + ';\n'

const comp = (st, les, done = true, action = null, skip = null) =>
  `insert into student_lesson_completions (student_id, lesson_id, completed_at, action_completed_at, skipped_at) values (${S(st)}, '${les}', ${done ? `'2026-06-10 10:00:00+00'` : 'null'}, ${action ? `'${action}'` : 'null'}, ${skip ? `'${skip}'` : 'null'});\n`
// S1: 5 plain watch lessons
for (const l of ['l001','l002','l004','l005','l007']) seed += comp(1, l)
// S2: one SKIPPED (no completed_at) — must still count
seed += comp(2, 'l001', false, null, '2026-06-11 10:00:00+00')
// S3: requires_action lesson, watch half only — must NOT count
seed += comp(3, 'l008')
// S4: requires_action lesson, BOTH halves — must count
seed += comp(4, 'l008', true, '2026-06-12 10:00:00+00')
// S5: ONLY l057 (bounty access). THE DECISION-D1 CASE.
seed += comp(5, 'l057')
// S6: 20 lessons → region r2
for (let n = 1; n <= 20; n++) seed += comp(6, 'l' + String(n).padStart(3,'0'))
// S7: nothing at all
// S8: one r1 + one r4
seed += comp(8, 'l001'); seed += comp(8, 'l049')
seed += `insert into achievements (id,name) values ('first_steps','First Steps'),('r4_clear','R4 Clear'),('unbroken','Unbroken');\n`
seed += `insert into student_achievements (student_id, achievement_id) values (${S(1)},'first_steps'),(${S(6)},'first_steps'),(${S(6)},'unbroken');\n`
seed += `insert into student_milestones (student_id, first_sprint_login_at) values (${S(7)}, '2026-06-07 10:00:00+00');\n`
await exec(seed, 'seed')

const q = async sql => (await db.query(sql)).rows
const snap = async () => ({
  counts: await q(`select student_id::text, completed_count from student_progress_counts order by 1`),
  region: await q(`select student_id::text, current_region from student_current_region order by 1`),
  stats:  await q(`select id, unlocked_count::text, total_count::text, unlock_pct::text from achievement_unlock_stats order by 1`),
})
const types = async () => await q(`
  select table_name||'.'||column_name as col, data_type from information_schema.columns
   where table_name in ('student_progress_counts','student_current_region','achievement_unlock_stats')
   order by 1`)
const opts = async () => await q(`select relname, reloptions::text from pg_class where relname in
  ('student_progress_counts','student_current_region','achievement_unlock_stats') order by 1`)

if (fail.length) { console.log('\nharness failed to build — stopping\n'); process.exit(1) }
console.log('\n=== 4. BEFORE snapshot ===')
const before = await snap(); const beforeTypes = await types(); const beforeOpts = await opts()
console.log('  student_progress_counts:', JSON.stringify(before.counts.map(r=>[r.student_id.slice(-1), r.completed_count])))
console.log('  student_current_region :', JSON.stringify(before.region.map(r=>[r.student_id.slice(-1), r.current_region])))
await exec(`select public.rebuild_daily_snapshots('2026-06-09'::date, '2026-06-14'::date);`, 'v89 RPC runs')
const beforeSnaps = await q(`select snapshot_date::text, active_students, total_completions, avg_progress::text, avg_progress_cohort::text from daily_progress_snapshots order by 1`)
console.log('  snapshots:', JSON.stringify(beforeSnaps.map(r=>[r.snapshot_date.slice(5), r.total_completions, r.avg_progress])))

console.log('\n=== 5. RUN v92 ===')
const v92 = read('2026_v92_progress_predicate_and_lessons_v2_columns.sql')
const v92ok = await exec(v92, 'v92 executes')

if (v92ok) {
  console.log('\n=== 6. v92 assertions ===')
  const after = await snap()
  note(JSON.stringify(after.counts) === JSON.stringify(before.counts),
       'student_progress_counts IDENTICAL', `${before.counts.length} rows`)
  note(JSON.stringify(after.region) === JSON.stringify(before.region),
       'student_current_region IDENTICAL (Decision D1)', `${before.region.length} rows`)
  const s5 = after.region.find(r => r.student_id.endsWith('5'))
  note(!!s5 && s5.current_region === 'r4',
       'D1: the l057-only student is STILL in student_current_region', s5 ? s5.current_region : 'MISSING')
  note(!after.counts.find(r => r.student_id.endsWith('5')),
       'D1: that same student is correctly ABSENT from progress_counts')
  const at = await types()
  note(JSON.stringify(at) === JSON.stringify(beforeTypes), 'column types UNCHANGED')
  console.log('    ', JSON.stringify(at.filter(r=>r.col.includes('count'))))
  const ao = await opts()
  note(JSON.stringify(ao) === JSON.stringify(beforeOpts), 'security_invoker options UNCHANGED')
  console.log('    ', JSON.stringify(ao))
  const flags = await q(`select id, counts_toward_progress, feature_key from lessons where not counts_toward_progress or feature_key is not null order by id`)
  note(flags.length === 2 && flags[0].id === 'l057' && flags[0].counts_toward_progress === false
       && flags[0].feature_key === 'bounty_access' && flags[1].id === 'l078' && flags[1].feature_key === 'playbook_unlock',
       'flags seeded correctly', JSON.stringify(flags))
  await exec(`select public.rebuild_daily_snapshots('2026-06-09'::date, '2026-06-14'::date);`, 'v92 RPC runs')
  const afterSnaps = await q(`select snapshot_date::text, active_students, total_completions, avg_progress::text, avg_progress_cohort::text from daily_progress_snapshots order by 1`)
  note(JSON.stringify(afterSnaps) === JSON.stringify(beforeSnaps), 'snapshot numbers IDENTICAL')
  const tl = await q(`select distinct total_lessons from daily_progress_snapshots`)
  note(tl.length === 1 && tl[0].total_lessons === 64, 'total_lessons recorded = 64', JSON.stringify(tl))
  // the predicate itself
  const pred = await q(`select
     public.lesson_is_complete(false, now(), null, null) as a,
     public.lesson_is_complete(true , now(), null, null) as b,
     public.lesson_is_complete(true , now(), now(), null) as c,
     public.lesson_is_complete(false, null, null, now()) as d,
     public.lesson_is_complete(false, null, null, null) as e,
     public.lesson_is_complete(false, '2026-06-10'::timestamptz, null, null, '2026-06-09'::date) as f,
     public.lesson_is_complete(false, '2026-06-10'::timestamptz, null, null, '2026-06-11'::date) as g`)
  const p = pred[0]
  note(p.a===true&&p.b===false&&p.c===true&&p.d===true&&p.e===false&&p.f===false&&p.g===true,
       'lesson_is_complete matches isLessonComplete() truth table', JSON.stringify(p))
  const vol = await q(`select provolatile from pg_proc where proname='lesson_is_complete'`)
  note(vol[0].provolatile === 's', 'predicate is STABLE not IMMUTABLE', vol[0].provolatile)
}

console.log('\n=== 7. RUN v93 ===')
const v93 = read('2026_v93_lesson_watch_telemetry.sql')
const v93ok = await exec(v93, 'v93 executes')

if (v93ok) {
  console.log('\n=== 8. v93 assertions ===')
  const pol = await q(`select cmd, policyname from pg_policies where tablename='student_lesson_watch' order by policyname`)
  note(pol.length === 2 && pol.every(p => p.cmd === 'SELECT'),
       'exactly 2 policies, both SELECT (no client write path)', JSON.stringify(pol.map(p=>p.cmd)))
  const st = await q(`select column_name, data_type from information_schema.columns where table_name='achievement_unlock_stats' order by ordinal_position`)
  note(st.find(c=>c.column_name==='unlocked_count')?.data_type === 'bigint'
    && st.find(c=>c.column_name==='total_count')?.data_type === 'bigint',
       'achievement_unlock_stats counts still BIGINT', JSON.stringify(st.map(c=>`${c.column_name}:${c.data_type}`)))
  const ro = await q(`select reloptions::text from pg_class where relname='achievement_unlock_stats'`)
  note(ro[0].reloptions === '{security_invoker=false}', 'security_invoker=false preserved', ro[0].reloptions)
  const dn = await q(`select distinct total_count::text from achievement_unlock_stats`)
  note(dn.length===1 && dn[0].total_count === String(before.stats[0].total_count),
       'denominator unchanged today', `${dn[0].total_count} vs ${before.stats[0].total_count}`)
  const priv = await q(`select
     has_function_privilege('anon','public.record_lesson_heartbeat(text,numeric,numeric,numeric,boolean)','execute') as anon,
     has_function_privilege('authenticated','public.record_lesson_heartbeat(text,numeric,numeric,numeric,boolean)','execute') as auth`)
  note(priv[0].anon === false && priv[0].auth === true, 'RPC: anon denied, authenticated allowed', JSON.stringify(priv[0]))
}

console.log('\n=== 9. IDEMPOTENCY (re-run both) ===')
const r1 = await exec(v92, 'v92 re-run')
const r2 = await exec(v93, 'v93 re-run')
if (r1 && r2) {
  const after2 = await snap()
  note(JSON.stringify(after2.counts) === JSON.stringify(before.counts), 're-run left progress_counts identical')
  note(JSON.stringify(after2.region) === JSON.stringify(before.region), 're-run left current_region identical')
  const t2 = await types()
  note(JSON.stringify(t2) === JSON.stringify(beforeTypes), 're-run left types identical')
}


console.log('\n=== 10. record_lesson_heartbeat behaviour (hostile client) ===')
const UID1 = '00000000-0000-0000-0000-000000000001'
await db.exec(`update lessons set bunny_video_id='09ff6d92-1312-4b96-bc3b-75b5edbcab34', duration_seconds=753 where id='l001';`)
const hb = async (lesson, pos, dur, delta, force = false) => {
  const r = await db.query(`select public.record_lesson_heartbeat($1,$2,$3,$4,$5) as j`, [lesson, pos, dur, delta, force])
  return r.rows[0].j
}
const raises = async (fn, label, wantCode) => {
  try { await fn(); note(false, label, 'did NOT raise') }
  catch (e) { note(!wantCode || e.code === wantCode, label, `${e.code}: ${e.message.slice(0,60)}`) }
}
const watch = async () => (await db.query(
  `select max_position_seconds::text mx, last_position_seconds::text lastp, watched_seconds::text w,
          heartbeat_count hc, threshold_met_at is not null met
     from student_lesson_watch where lesson_id='l001'`)).rows[0]

// --- no session ---
await db.exec(`select set_config('test.uid','',false);`)
await raises(() => hb('l001', 10, 753, 15), 'no auth.uid() -> refuses', '42501')

await db.exec(`select set_config('test.uid','${UID1}',false);`)
// --- bad lessons ---
await raises(() => hb('does-not-exist', 10, 753, 15), 'unknown lesson -> refuses', '22023')
await raises(() => hb('l003', 10, 753, 15), "non-watch lesson (type='action') -> refuses", '22023')
await raises(() => hb('l002', 10, 753, 15), 'watch lesson with no bunny_video_id -> refuses', '22023')

// --- beat 1 ---
let j = await hb('l001', 10, 753, 15)
let w = await watch()
note(j.accepted === true && Number(w.mx) === 10 && Number(w.w) === 15 && w.hc === 1,
     'first beat accepted', `max=${w.mx} watched=${w.w}`)

// --- beat 2, immediately: rate limited ---
j = await hb('l001', 20, 753, 15)
w = await watch()
note(j.accepted === false && j.reason === 'rate_limited' && Number(w.mx) === 10 && w.hc === 1,
     'second beat <5s later is REFUSED and writes nothing', `max still ${w.mx}`)

// --- beat 3, forced: accepted, but delta clamped to wall clock ---
j = await hb('l001', 20, 753, 15, true)
w = await watch()
note(j.accepted === true && Number(w.mx) === 20 && Number(w.w) < 18,
     'p_force bypasses the limiter; delta clamped to real elapsed time', `watched=${w.w} (not 30)`)

// --- forged delta ---
await db.exec(`update student_lesson_watch set last_heartbeat_at = now() - interval '30 seconds';`)
const wBefore = Number((await watch()).w)
j = await hb('l001', 100, 753, 9999)
w = await watch()
// Compared in hundredths, the column's own precision. As floats this failed
// about one run in forty: when the forced beat above landed 5 ms late it left
// watched_seconds at 17.01, and 37.01 - 17.01 is 19.999999999999996 in IEEE 754.
note(j.accepted === true && Math.round((Number(w.w) - wBefore) * 100) === 2000,
     'forged delta 9999 grows watched_seconds by exactly the 20s cap', `+${(Number(w.w)-wBefore).toFixed(2)}`)

// --- threshold crossing, immediately (must bypass the limiter) ---
j = await hb('l001', 900, 753, 5)
w = await watch()
note(j.accepted === true && j.threshold_crossed === true && Number(w.mx) === 753 && w.met === true,
     'crossing beat accepted <5s later; position clamped to duration', `max=${w.mx} crossed=${j.threshold_crossed}`)

// --- crossed fires exactly once ---
await db.exec(`update student_lesson_watch set last_heartbeat_at = now() - interval '30 seconds';`)
j = await hb('l001', 753, 753, 10)
note(j.accepted === true && j.threshold_crossed === false && j.threshold_met === true,
     'threshold_crossed fires EXACTLY once per lesson', `crossed=${j.threshold_crossed} met=${j.threshold_met}`)

// --- scrubbing back never rewinds max ---
await db.exec(`update student_lesson_watch set last_heartbeat_at = now() - interval '30 seconds';`)
j = await hb('l001', 5, 753, 3)
w = await watch()
note(Number(w.mx) === 753 && Number(w.lastp) === 5,
     'scrubbing back moves last_position but never max_position', `max=${w.mx} last=${w.lastp}`)

// --- a student cannot write the table directly (no write policy exists) ---
const wp = await q(`select count(*)::int n from pg_policies where tablename='student_lesson_watch' and cmd <> 'SELECT'`)
note(wp[0].n === 0, 'still no INSERT/UPDATE/DELETE policy after all writes', `${wp[0].n} write policies`)


console.log('\n=== 11. RUN v94 (staging catalog) + v95 (discount config) ===')
const liveLessonsBefore = (await q(`select count(*)::int n from lessons`))[0].n
const v94 = read('2026_v94_catalog_next_staging.sql')
const v95 = read('2026_v95_discount_window_config.sql')
const v94ok = await exec(v94, 'v94 executes')
const v95ok = await exec(v95, 'v95 executes')

if (v94ok) {
  const areas = await q(`select r.id, r.name, count(l.id)::int n from regions_next r
                          join lessons_next l on l.region_id = r.id
                         group by r.id, r.name order by r.order_num`)
  const counts = areas.map(a => a.n)
  note(areas.length === 8, '8 areas', JSON.stringify(areas.map(a=>`${a.id}:${a.n}`)))
  note(JSON.stringify(counts) === JSON.stringify([8,10,22,22,25,22,22,14]),
       'area sizes match the locked structure', JSON.stringify(counts))
  const tot = (await q(`select count(*)::int n, count(*) filter (where counts_toward_progress)::int c from lessons_next`))[0]
  note(tot.n === 145 && tot.c === 144, '145 lessons, 144 count toward progress', `${tot.n}/${tot.c}`)
  const so = (await q(`select min(sort_order)::int lo, max(sort_order)::int hi, count(distinct sort_order)::int d from lessons_next`))[0]
  note(so.lo === 1 && so.hi === 145 && so.d === 145, 'global sort_order is 1..145, contiguous and unique', JSON.stringify(so))
  const mono = (await q(`select count(*)::int n from (
      select l.region_id, r.order_num, min(l.sort_order) mn, max(l.sort_order) mx
        from lessons_next l join regions_next r on r.id = l.region_id
       group by 1,2) t1
     join (select 1) z on true
     where exists (select 1 from (
       select r2.order_num o2, min(l2.sort_order) mn2 from lessons_next l2
         join regions_next r2 on r2.id = l2.region_id group by 1) t2
       where t2.o2 > t1.order_num and t2.mn2 < t1.mx)`))[0].n
  note(mono === 0, 'sort_order never interleaves between areas', `${mono} violations`)
  const gate = await q(`select id from lessons_next where is_gate`)
  note(gate.length === 1 && gate[0].id === 'a5l25', 'exactly one gate', JSON.stringify(gate))
  const ai = await q(`select count(*)::int n, count(*) filter (where action_brief is null)::int nobrief from lessons_next where requires_action`)
  note(ai[0].n === 9 && ai[0].nobrief === 0, '9 action items, all with briefs', JSON.stringify(ai[0]))
  const aiAreas = await q(`select distinct region_id from lessons_next where requires_action order by 1`)
  note(JSON.stringify(aiAreas.map(r=>r.region_id)) === JSON.stringify(['a3','a4','a5']),
       'action items only in the video + static areas', JSON.stringify(aiAreas.map(r=>r.region_id)))
  const pond = await q(`select id, type, counts_toward_progress c, feature_key f from lessons_next where feature_key is not null`)
  note(pond.length === 1 && pond[0].id === 'a7l22' && pond[0].type === 'setup' && pond[0].c === false
       && pond[0].f === 'bounty_access', 'bounty pond is a7l22, setup, outside the denominator', JSON.stringify(pond))
  const noAction = (await q(`select count(*)::int n from lessons_next where type not in ('watch','setup')`))[0].n
  note(noAction === 0, "type 'action' is retired", `${noAction} rows`)

  // constraints actually fire
  await raises(() => db.query(`insert into lessons_next (id,region_id,type,title,sort_order,requires_action) values ('zz','a1','watch','x',999,true)`),
               'CHECK rejects an action item with no brief', '23514')
  await raises(() => db.query(`insert into lessons_next (id,region_id,type,title,sort_order,is_gate) values ('zz2','a1','watch','x',998,true)`),
               'partial unique index rejects a SECOND gate', '23505')
  await raises(() => db.query(`insert into lessons_next (id,region_id,type,title,sort_order) values ('zz3','a1','action','x',997)`),
               "type CHECK rejects 'action'", '23514')
  await raises(() => db.query(`insert into lessons_next (id,region_id,type,title,sort_order) values ('zz4','a1','watch','x',1)`),
               'sort_order collision rejected', '23505')

  // THE POINT OF _next: the live app must not have moved
  const liveAfter = (await q(`select count(*)::int n from lessons`))[0].n
  note(liveAfter === liveLessonsBefore, 'the LIVE lessons table is untouched', `${liveAfter} rows`)
  const liveCounts = await q(`select student_id::text, completed_count from student_progress_counts order by 1`)
  note(JSON.stringify(liveCounts) === JSON.stringify(before.counts), 'live progress still identical after v94')
}

if (v95ok) {
  const cfg = await q(`select value from admin_config where key='discount_window_days'`)
  note(cfg.length === 1 && cfg[0].value === '14', 'discount_window_days = 14', JSON.stringify(cfg))
  await db.exec(`update admin_config set value='21' where key='discount_window_days';`)
  await exec(v95, 'v95 re-run')
  const cfg2 = await q(`select value from admin_config where key='discount_window_days'`)
  note(cfg2[0].value === '21', 're-running v95 does NOT clobber a tuned value', cfg2[0].value)
  const col = await q(`select data_type, is_nullable from information_schema.columns
                        where table_name='discount_requests' and column_name='gate_lesson_id'`)
  note(col.length === 1 && col[0].data_type === 'text' && col[0].is_nullable === 'YES',
       'discount_requests.gate_lesson_id added, nullable', JSON.stringify(col))
}

console.log('\n=== 12. IDEMPOTENCY of v94 ===')
if (await exec(v94, 'v94 re-run')) {
  const t = (await q(`select count(*)::int n from lessons_next`))[0].n
  const g = (await q(`select count(*)::int n from lessons_next where is_gate`))[0].n
  const a = (await q(`select count(*)::int n from lessons_next where requires_action`))[0].n
  note(t === 145 && g === 1 && a === 9, 're-run adds no duplicates', `${t} lessons, ${g} gate, ${a} actions`)
}


console.log('\n=== 13. v96 SECURITY: lock down rebuild_daily_snapshots ===')
// The hole, demonstrated BEFORE the fix.
const before96 = await q(`select
  has_function_privilege('anon','public.rebuild_daily_snapshots(date,date)','execute') a,
  has_function_privilege('authenticated','public.rebuild_daily_snapshots(date,date)','execute') u`)
note(before96[0].a === true && before96[0].u === true,
     'PRE-v96: anon AND every student can execute the destructive RPC',
     JSON.stringify(before96[0]))

// And that it really is destructive over an arbitrary range.
await exec(`select public.rebuild_daily_snapshots('2026-06-01'::date, '2026-06-20'::date);`, 'pre-v96 wide rebuild runs')
const wiped = await q(`select count(*)::int n from daily_progress_snapshots where snapshot_date between '2026-06-09' and '2026-06-14'`)
note(true, 'PRE-v96: a wide call rewrote collected days', `${wiped[0].n} rows in the window it reached`)

const v96 = read('2026_v96_lock_down_rebuild_snapshots.sql')
const v96ok = await exec(v96, 'v96 executes')

if (v96ok) {
  const after = await q(`select
    has_function_privilege('anon','public.rebuild_daily_snapshots(date,date)','execute') a,
    has_function_privilege('authenticated','public.rebuild_daily_snapshots(date,date)','execute') u,
    has_function_privilege('service_role','public.rebuild_daily_snapshots(date,date)','execute') s`)
  note(after[0].a === false, 'anon can no longer execute it', `anon=${after[0].a}`)
  note(after[0].u === false, 'students can no longer execute it', `authenticated=${after[0].u}`)
  note(after[0].s === true, 'service_role still can (every real caller)', `service_role=${after[0].s}`)

  const sigs = await q(`select pg_get_function_identity_arguments(oid) args from pg_proc where proname='rebuild_daily_snapshots'`)
  note(sigs.length === 1, 'exactly one signature (the old unbounded one stays dropped)', JSON.stringify(sigs.map(r=>r.args)))

  // It still works for the range the real callers use.
  const okRun = await q(`select public.rebuild_daily_snapshots(current_date - 1, current_date) n`)
  note(okRun[0].n === 2, 'a 2-day rebuild still works', `returned ${okRun[0].n}`)

  // THE GUARD.
  let raised = false, msg = ''
  try { await db.query(`select public.rebuild_daily_snapshots('2026-01-01'::date, current_date)`) }
  catch (e) { raised = true; msg = e.message }
  note(raised && /more than 30 days back/.test(msg),
       'THE GUARD: a wide range is REFUSED, not silently clamped', msg.slice(0, 80))

  // And the refusal wrote nothing.
  const still = await q(`select count(*)::int n from daily_progress_snapshots`)
  note(still[0].n > 0, 'the refused call destroyed nothing', `${still[0].n} snapshot rows intact`)
}


console.log('\n=== 14. v97: the heartbeat stops trusting the client ===')
await db.exec(`select set_config('test.uid','${UID1}',false);`)

// ── ATTACK A: forced-beat replay, against the v93 function ──
await db.exec(`delete from student_lesson_watch;`)
{
  // 30 forced calls in ~0 wall-clock time. Honest watch time: ~0 seconds.
  for (let i = 0; i < 30; i++) await hb('l001', 10 + i, 753, 20, true)
  const w = await watch()
  note(Number(w.w) > 20,
       'PRE-v97: 30 replayed forced beats inflate watched_seconds past real time',
       `watched=${Number(w.w).toFixed(1)}s of ~0s actually elapsed`)
}

// ── ATTACK B: client supplies its own denominator, against v93 ──
await db.exec(`delete from student_lesson_watch; update lessons set duration_seconds = null where id='l001';`)
{
  const r = await hb('l001', 1, 1, 0)      // "the video is 1 second long and I'm at the end"
  note(r.threshold_met === true,
       'PRE-v97: one call with a forged duration stamps threshold_met_at',
       `threshold_met=${r.threshold_met}`)
}

const v97 = read('2026_v97_heartbeat_trust_nothing.sql')
const v97ok = await exec(v97, 'v97 executes')
// Captured the moment v97 has run, for section 18: the v100 undo has to put
// back exactly this, character for character.
const defAfterV97 = v97ok
  ? (await q(`select pg_get_functiondef('public.record_lesson_heartbeat'::regproc) as d`))[0].d
  : null

if (v97ok) {
  // ── ATTACK A, again ──
  await db.exec(`delete from student_lesson_watch;`)
  for (let i = 0; i < 30; i++) await hb('l001', 10 + i, 753, 20, true)
  const w = await watch()
  // The residual: the FIRST beat for a (student, lesson) has no previous
  // timestamp to clamp against, so it can bank up to the 20s cap. Every beat
  // after it is clamped to the wall clock. So the whole attack is worth ONE
  // 20s allowance per lesson, not 20s per call.
  note(Number(w.w) <= 20,
       'POST-v97: 30 replayed beats bank at most ONE first-beat allowance',
       `watched=${Number(w.w).toFixed(2)}s (was 78s)`)
  // Prove it does not accumulate: another 30 calls add ~nothing.
  const wBefore97 = Number(w.w)
  for (let i = 0; i < 30; i++) await hb('l001', 200 + i, 753, 20, true)
  const w2 = await watch()
  note(Number(w2.w) - wBefore97 < 1,
       'POST-v97: ...and the allowance is once-only, it does not accumulate',
       `+${(Number(w2.w) - wBefore97).toFixed(3)}s over 30 more calls`)
  // 20s cannot approach the 80% floor of any real lesson.
  note(20 / 753 < 0.8,
       'POST-v97: that residual is 2.7% of the test lesson, far under the 80% floor',
       `${((20/753)*100).toFixed(1)}% vs 80%`)

  // ── ATTACK B, again (duration_seconds still null) ──
  await db.exec(`delete from student_lesson_watch;`)
  const r = await hb('l001', 1, 1, 0)
  note(r.threshold_met === false,
       'POST-v97: a forged duration can no longer stamp the threshold',
       `threshold_met=${r.threshold_met}`)
  const r2 = await hb('l001', 99999, 1, 0, true)
  note(r2.threshold_met === false,
       'POST-v97: nor can an absurd position while the catalog has no duration',
       `threshold_met=${r2.threshold_met}`)

  // ── the honest path still works once the catalog knows the duration ──
  await db.exec(`delete from student_lesson_watch; update lessons set duration_seconds = 753 where id='l001';`)
  await hb('l001', 10, 753, 10)
  await db.exec(`update student_lesson_watch set last_heartbeat_at = now() - interval '20 seconds';`)
  const good = await hb('l001', 750, 753, 20)
  note(good.threshold_met === true && good.threshold_crossed === true,
       'POST-v97: a real viewer still crosses the threshold normally',
       `crossed=${good.threshold_crossed}`)

  // ── and honest watch time is still banked at the real rate ──
  await db.exec(`delete from student_lesson_watch;`)
  await hb('l001', 5, 753, 5)
  await db.exec(`update student_lesson_watch set last_heartbeat_at = now() - interval '15 seconds';`)
  await hb('l001', 20, 753, 15)
  const hw = await watch()
  note(Number(hw.w) >= 14 && Number(hw.w) <= 21,
       'POST-v97: 15s of real elapsed time still banks ~15s of watch time',
       `watched=${Number(hw.w).toFixed(2)}s`)
}


console.log('\n=== 15. D1, tested properly (the check I got wrong) ===')
{
  const D1SQL = fs.readFileSync(fileURLToPath(new URL('../diagnostics/d1-region-shift.sql', import.meta.url)), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

  // The seed already contains S5, whose ONLY completion is l057 — the
  // membership case row 92 CAN see.
  let r = await q(D1SQL)
  const baseline = Number(r[0].affected_students)
  const row92Baseline = (await q(`select count(*)::int n from student_current_region r
     where not exists (select 1 from student_progress_counts c where c.student_id = r.student_id)`))[0].n
  note(baseline === 1 && row92Baseline === 1,
       'baseline: one l057-only student, visible to BOTH checks',
       `corrected=${baseline} row92=${row92Baseline}`)

  // Now construct the EXACT case prd1-postchecks row 92 is blind to: a student
  // with r1..r3 completions AND l057 (which lives in r4), but no other r4
  // lesson. They are in BOTH views, so a membership check cannot see them —
  // but their current_region moves from r4 to r3 under the filter.
  await db.exec(`
    insert into students (id, supabase_user_id, first_paid_at, whop_plan_id, membership_status)
    values ('00000000-0000-0000-0000-0000000000d1'::uuid,
            '00000000-0000-0000-0000-0000000000d1'::uuid,
            '2026-06-01 10:00:00+00'::timestamptz, 'plan_4ZrwR4PmBsVsx', 'active');
    insert into student_lesson_completions (student_id, lesson_id, completed_at) values
      ('00000000-0000-0000-0000-0000000000d1'::uuid, 'l001', '2026-06-10 10:00:00+00'),
      ('00000000-0000-0000-0000-0000000000d1'::uuid, 'l033', '2026-06-10 10:00:00+00'),
      ('00000000-0000-0000-0000-0000000000d1'::uuid, 'l057', '2026-06-10 10:00:00+00');
  `)

  // THE POINT: row 92 does not move, because this student is in BOTH views.
  const blind = (await q(`select count(*)::int n from student_current_region r
     where not exists (select 1 from student_progress_counts c where c.student_id = r.student_id)`))[0].n
  note(blind === row92Baseline,
       'row 92 does NOT move — the new student is in both views, so it is blind to them',
       `row92 ${row92Baseline} -> ${blind}`)

  r = await q(D1SQL)
  note(Number(r[0].affected_students) === baseline + 1,
       'the corrected query DOES move, catching the region shift',
       `corrected ${baseline} -> ${r[0].affected_students}`)
  note(/r4 -> r3/.test(r[0].shifts), 'and names the actual shift', r[0].shifts)

  // Clean up so later assertions are unaffected.
  await db.exec(`delete from students where id = '00000000-0000-0000-0000-0000000000d1'::uuid;`)
}


console.log('\n=== 16. v98: the filter D1 wrongly withheld ===')
{
  const regionBefore = await q(`select student_id::text, current_region from student_current_region order by 1`)
  const v98 = read('2026_v98_current_region_counts_toward_progress.sql')
  const v98ok = await exec(v98, 'v98 executes')
  if (v98ok) {
    const regionAfter = await q(`select student_id::text, current_region from student_current_region order by 1`)
    // In THIS seed, S5's only completion is l057 — so the filter DOES move
    // them here, which is exactly the population production turned out not to
    // have. That difference is the point: the safety case for v98 is the
    // MEASUREMENT against production (0 affected), not an assumption.
    const gone = regionBefore.filter(b => !regionAfter.some(a => a.student_id === b.student_id))
    note(gone.length === 1 && gone[0].student_id.endsWith('5'),
         'harness seed HAS an l057-only student, so the filter drops them here',
         `dropped ${gone.length} (production measured 0)`)
    const moved = regionAfter.filter(a => {
      const b = regionBefore.find(x => x.student_id === a.student_id)
      return b && b.current_region !== a.current_region
    })
    note(moved.length === 0, 'nobody else moved region', `${moved.length} moved`)

    const opts98 = await q(`select reloptions::text from pg_class where relname='student_current_region'`)
    note(opts98[0].reloptions === '{security_invoker=on}', 'security_invoker preserved', opts98[0].reloptions)
    const anon98 = await q(`select has_table_privilege('anon','public.student_current_region','select') a`)
    note(anon98[0].a === false, 'anon still revoked', `anon=${anon98[0].a}`)

    // The two progress views now agree on which lessons count.
    const disagree = await q(`select count(*)::int n from student_current_region r
       where not exists (select 1 from student_progress_counts c where c.student_id = r.student_id)`)
    note(disagree[0].n === 0,
         'the two progress views no longer disagree about what counts', `${disagree[0].n} disagreements`)
  }
}

console.log('\n=== 17. the self-selecting test-lesson stamp ===')
{
  const stampSql = fs.readFileSync(fileURLToPath(new URL('../diagnostics/stamp-test-lesson.sql', import.meta.url)), 'utf8')
  const stampOnly = stampSql.split('-- What it picked:')[0]
  const s1 = await exec(stampOnly, 'stamp runs')
  if (s1) {
    const r = await q(`select id, type, duration_seconds from lessons where bunny_video_id is not null`)
    note(r.length === 1, 'exactly one lesson stamped', JSON.stringify(r))
    note(r[0].type === 'watch', 'and it is a WATCH lesson (the RPC requires it)', r[0].type)
    note(r[0].duration_seconds === 753, 'with the real duration (required since v97)', `${r[0].duration_seconds}s`)
    // Idempotent: re-running must not violate the partial unique index.
    const s2 = await exec(stampOnly, 'stamp re-runs without a unique violation')
    if (s2) {
      const r2 = await q(`select count(*)::int n from lessons where bunny_video_id is not null`)
      note(r2[0].n === 1, 're-run still leaves exactly one', `${r2[0].n}`)
    }
    // And the RPC accepts it end to end.
    await db.exec(`select set_config('test.uid','${UID1}',false); delete from student_lesson_watch;`)
    const beat = await hb(r[0].id, 10, 753, 5)
    note(beat.accepted === true, 'the heartbeat RPC accepts the stamped lesson', `accepted=${beat.accepted}`)
  }
}


console.log('\n=== 18. v100: lesson_videos (private) + the heartbeat counts up to 2.5x, and the undo ===')
// Runs LAST on purpose. From v100 on a lesson is playable only when it has a
// lesson_videos row, so every heartbeat test above (which stamps
// bunny_video_id) has to finish first. Tests below insert lesson_videos rows.
{
  const V97F  = '2026_v97_heartbeat_trust_nothing.sql'
  const V100F = '2026_v100_lesson_videos_and_speed.sql'
  // lift() and read() resolve against migrations/, and the undo folder sits
  // beside it. A file in undo/ is never run in sequence with the migrations.
  const UNDOF = '../undo/2026_v100_undo.sql'
  // "The function", in v97's own extent: from its create line through the
  // last of its three revoke/grant lines.
  const FN_START = 'create or replace function public.record_lesson_heartbeat('
  const FN_END   = 'to authenticated;'
  const SIG   = 'public.record_lesson_heartbeat(text,numeric,numeric,numeric,boolean)'
  const EVERY = 'select, insert, update, delete, truncate, references, trigger'
  // Well-formed FAKE ids. A real Tella id is the video itself and this
  // repository is public, so a real one never goes in a tracked file.
  const VID = n => `vid_testaaaaaaaaaaaa${String(n).padStart(2, '0')}`
  const BUNNY = 'l064'   // a watch lesson that carries a bunny_video_id: playable under v97
  const PLAIN = 'l001'   // a watch lesson with no bunny_video_id: playable only under v100

  // exec() records a failure and stays quiet on success. These runs are
  // themselves on the PRD's list, so a success is recorded too.
  // A file that fails inside its own begin/commit leaves the session in an
  // aborted transaction. Roll it back, so the assertions after it report what
  // is true instead of all failing on "transaction is aborted".
  const ran = async (sql, label) => {
    const done = await exec(sql, label)
    if (done) note(true, label); else await db.exec('rollback;').catch(() => {})
    return done
  }
  const fnDef = async () => (await q(`select pg_get_functiondef('public.record_lesson_heartbeat'::regproc) as d`))[0].d
  const fnFacts = async () => JSON.stringify((await q(`select
       has_function_privilege('anon', '${SIG}', 'execute') as anon,
       has_function_privilege('authenticated', '${SIG}', 'execute') as authenticated,
       (select count(*)::int from pg_proc where proname = 'record_lesson_heartbeat') as signatures,
       (select bool_and(prosecdef) from pg_proc where proname = 'record_lesson_heartbeat') as definer`))[0])
  const watchRows = async () => JSON.stringify(await q(`select * from student_lesson_watch order by student_id, lesson_id`))
  const videoRows = async () => JSON.stringify(await q(`select * from public.lesson_videos order by lesson_id`))
  const tableGone = async () => (await q(`select to_regclass('public.lesson_videos') is null as gone`))[0].gone
  const tableFacts = async () => (await q(`select
       (select relrowsecurity from pg_class where oid = 'public.lesson_videos'::regclass) as rls,
       (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'lesson_videos') as policies,
       has_table_privilege('anon', 'public.lesson_videos', '${EVERY}') as anon,
       has_table_privilege('authenticated', 'public.lesson_videos', '${EVERY}') as authenticated,
       (select count(*)::int from pg_class c, aclexplode(c.relacl) a
         where c.oid = 'public.lesson_videos'::regclass
           and a.grantee in ('anon'::regrole, 'authenticated'::regrole)) as acl_rows,
       (select count(*)::int from pg_trigger
         where tgrelid = 'public.lesson_videos'::regclass and not tgisinternal) as triggers,
       (select count(*)::int from public.lesson_videos) as n`))[0]
  const isPrivate = t => t.rls === true && t.policies === 0 && t.anon === false && t.authenticated === false && t.acl_rows === 0
  const watchOf = async lesson => (await db.query(
    `select max_position_seconds::float8 mx, watched_seconds::float8 w, heartbeat_count hc,
            threshold_met_at is not null met
       from student_lesson_watch
      where lesson_id = $1 and student_id = '${UID1}'::uuid`, [lesson])).rows[0] ?? { mx: NaN, w: NaN, hc: 0, met: false }
  // hb() for the calls that are EXPECTED to go through. A raise comes back as
  // a value, so it fails its own assertion instead of ending the whole run.
  const raised = e => ({ accepted: false, raised: `${e.code}: ${e.message.slice(0, 70)}` })
  const beat = (...a) => hb(...a).catch(raised)
  const show = r => r.raised ?? `accepted=${r.accepted}`
  // One transaction, so now() does not move between the two statements: the
  // beat lands EXACTLY `seconds` after the one before it, and the credit can
  // be asserted to the hundredth instead of inside a tolerance.
  const hbAfter = (seconds, lesson, pos, dur, delta, force = false) => db.transaction(async tx => {
    await tx.query(`update student_lesson_watch set last_heartbeat_at = now() - interval '${Number(seconds)} seconds'
                     where lesson_id = $1`, [lesson])
    return (await tx.query(`select public.record_lesson_heartbeat($1,$2,$3,$4,$5) as j`, [lesson, pos, dur, delta, force])).rows[0].j
  }).catch(raised)
  // What one call added to watched_seconds.
  const credit = async (lesson, fn) => {
    const was = (await watchOf(lesson)).w
    const r = await fn()
    return { r, got: (await watchOf(lesson)).w - was }
  }
  const asRole = async (role, fn) => {
    await db.exec(`set role ${role};`)
    try { return await fn() } finally { await db.exec(`reset role;`) }
  }
  const rejects = async (sql, label, code, constraint) => {
    try { await db.query(sql); note(false, label, 'did NOT raise') }
    catch (e) { note(e.code === code && e.constraint === constraint, label, `${e.code} ${e.constraint ?? e.message.slice(0, 60)}`) }
  }
  // Code only: comments and blank lines out, so two versions of the function
  // can be compared on what they DO.
  const code = s => s.split('\n').map(l => l.replace(/--.*$/, '').trimEnd()).filter(l => l.trim()).join('\n')
  // The commented post-checks at the foot of a file, as runnable statements:
  // every line under POST-CHECKS that starts with `--` and four spaces, minus
  // the EXPECT lines. Run here so Lovro is never handed a query that errors.
  const postChecks = text => text.slice(text.indexOf('\n-- POST-CHECKS'))
    .split('\n').filter(l => /^--    (?!EXPECT)/.test(l)).map(l => l.slice(2)).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean)
  const runPostChecks = async text => {
    const out = []
    for (const s of postChecks(text)) out.push((await q(s))[0])
    return out
  }
  const allTrue = row => !!row && Object.values(row).length > 0 && Object.values(row).every(v => v === true)

  // ── the seam ──
  // Supabase grants ALL on every new table in public to anon, authenticated
  // and service_role (default privileges). The harness roles are bare, so
  // without this the "no privilege" assertions below would pass on a table
  // nobody was ever granted anything on. With it, they measure v100's REVOKE.
  await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
                 create table public._born_open (id int);`)
  const born = (await q(`select has_table_privilege('anon','public._born_open','select') anon,
                                has_table_privilege('authenticated','public._born_open','select') authenticated`))[0]
  await db.exec(`drop table public._born_open;`)
  note(born.anon === true && born.authenticated === true,
       'harness seam: a new public table is born readable by anon and authenticated, as on Supabase', JSON.stringify(born))

  // ── fixtures of this section's own, so it does not lean on what 17 left ──
  await db.exec(`
    select set_config('test.uid','${UID1}',false);
    update lessons set bunny_video_id = null, video_ready_at = null where bunny_video_id is not null;
    update lessons set bunny_video_id = '00000000-0000-4000-8000-0000000000b1', duration_seconds = 753 where id = '${BUNNY}';
    update lessons set duration_seconds = 753 where id = '${PLAIN}';`)

  // ── BEFORE ──
  const defBefore = await fnDef()
  note(defAfterV97 !== null && defBefore === defAfterV97,
       'nothing between v97 and v100 touched record_lesson_heartbeat', `${defBefore.length} characters`)
  const factsBefore = await fnFacts()
  const watchBefore = await watchRows()
  const lessonsBefore = JSON.stringify(await q(`select * from lessons order by id`))

  const v100 = read(V100F)
  const undo = read(UNDOF)

  if (await ran(v100, '(1) v100 executes')) {
    // ── what must not move ──
    note(await fnFacts() === factsBefore,
         'the RPC keeps its one signature, its grants and security definer', factsBefore)
    note(await watchRows() === watchBefore,
         'v100 leaves student_lesson_watch untouched', `${JSON.parse(watchBefore).length} row(s)`)
    note(JSON.stringify(await q(`select * from lessons order by id`)) === lessonsBefore,
         'v100 leaves lessons untouched (the Bunny columns stay, D7)', `${JSON.parse(lessonsBefore).length} rows`)

    // ── (2) the table is private ──
    let t = await tableFacts()
    note(t.rls === true && t.policies === 0,
         '(2) lesson_videos has RLS on and zero policies', `rls=${t.rls} policies=${t.policies}`)
    note(t.anon === false && t.authenticated === false && t.acl_rows === 0,
         '(2) anon and authenticated hold no privilege of any kind on it',
         `anon=${t.anon} authenticated=${t.authenticated} acl rows=${t.acl_rows}`)
    const shape = (await q(`select column_name c, data_type t, is_nullable n from information_schema.columns
                             where table_schema = 'public' and table_name = 'lesson_videos' order by ordinal_position`))
      .map(c => `${c.c}:${c.t}:${c.n}`).join(' ')
    note(shape === 'lesson_id:text:NO tella_video_id:text:NO lock_status:text:NO lock_detail:text:YES '
                 + 'lock_checked_at:timestamp with time zone:YES created_at:timestamp with time zone:NO '
                 + 'updated_at:timestamp with time zone:NO',
         'lesson_videos has the seven columns of the PRD', shape)

    // ── (4) playable now means "has a lesson_videos row" ──
    await db.exec(`delete from student_lesson_watch;`)
    await raises(() => hb(BUNNY, 10, 753, 5),
                 '(4) a watch lesson with a bunny_video_id and NO lesson_videos row is refused', '22023')
    await db.exec(`insert into public.lesson_videos (lesson_id, tella_video_id) values ('${BUNNY}', '${VID(1)}');`)
    const born100 = (await q(`select lock_status, lock_detail, lock_checked_at from public.lesson_videos where lesson_id = '${BUNNY}'`))[0]
    note(born100.lock_status === 'unchecked' && born100.lock_detail === null && born100.lock_checked_at === null,
         'a new lesson_videos row starts as unchecked', JSON.stringify(born100))
    const withRow = await beat(BUNNY, 10, 753, 5)
    note(withRow.accepted === true, '(4) ...and with a lesson_videos row the same lesson is accepted', show(withRow))

    await db.exec(`insert into public.lesson_videos (lesson_id, tella_video_id) values ('${PLAIN}', '${VID(2)}');`)
    const plainBunny = (await q(`select bunny_video_id from lessons where id = '${PLAIN}'`))[0].bunny_video_id
    // An honest first beat: the player writes the row the moment playback
    // starts, with nothing banked yet.
    const first = await beat(PLAIN, 0, 753, 0)
    note(plainBunny === null && first.accepted === true,
         'a watch lesson with a lesson_videos row and NO bunny_video_id is accepted (the Bunny column is no longer read)',
         `bunny_video_id=${plainBunny} ${show(first)}`)

    await db.exec(`insert into public.lesson_videos (lesson_id, tella_video_id) values ('l003', '${VID(3)}');`)
    await raises(() => hb('l003', 10, 753, 5),
                 "a non-watch lesson (type='action') is still refused, lesson_videos row or not", '22023')
    if (v94ok) {
      // No foreign key: the table takes a staging id. The heartbeat still
      // looks the lesson up in public.lessons, so the row plays nothing.
      const stg = (await q(`select id from lessons_next where type = 'watch' and id not in (select id from lessons)
                             order by sort_order limit 1`))[0].id
      await db.exec(`insert into public.lesson_videos (lesson_id, tella_video_id) values ('${stg}', '${VID(4)}');`)
      await raises(() => hb(stg, 10, 753, 5),
                   `a staging lesson (${stg}, in lessons_next only) is still refused, lesson_videos row or not (engine D2)`, '22023')
    }

    // ── (3) the constraints fire ──
    await rejects(`insert into public.lesson_videos (lesson_id, tella_video_id) values ('l005', 'abc')`,
                  "(3) a bad id ('abc') is rejected by the format check", '23514', 'lesson_videos_tella_id_format')
    const malformed = ['https://www.tella.tv/video/vid_testaaaaaaaaaaaa09/embed', 'vid_TESTAAAAAAAAAAAA09',
                       '00000000-0000-4000-8000-0000000000b1', 'vid_short', ' vid_testaaaaaaaaaaaa09',
                       'vid_testaaaaaaaaaaaa09\n', 'vid_testaaaaaaaaaaaa09/embed', '']
    let refused = 0
    for (const bad of malformed) {
      try { await db.query(`insert into public.lesson_videos (lesson_id, tella_video_id) values ('l005', $1)`, [bad]) }
      catch (e) { if (e.code === '23514' && e.constraint === 'lesson_videos_tella_id_format') refused++ }
    }
    note(refused === malformed.length,
         '(3) ...and so are a URL, an upper-case id, a Bunny GUID, a short id, stray whitespace, a trailing path and an empty string',
         `${refused}/${malformed.length} refused`)
    await rejects(`insert into public.lesson_videos (lesson_id, tella_video_id) values ('l005', '${VID(1)}')`,
                  '(3) a duplicate id is rejected by the unique constraint', '23505', 'lesson_videos_tella_id_unique')
    await rejects(`insert into public.lesson_videos (lesson_id, tella_video_id, lock_status) values ('l005', '${VID(9)}', 'public')`,
                  '(3) a bad lock_status is rejected by its check', '23514', 'lesson_videos_lock_status_check')
    await rejects(`insert into public.lesson_videos (lesson_id, tella_video_id) values ('${BUNNY}', '${VID(9)}')`,
                  'a second video for the same lesson is rejected by the primary key', '23505', 'lesson_videos_pkey')

    // ── the trigger: what the lock check's write does to the row ──
    await db.exec(`
      insert into public.lesson_videos (lesson_id, tella_video_id, updated_at) values ('l004', '${VID(5)}', '2000-01-01 00:00:00+00');
      update public.lesson_videos set lock_status = 'locked', lock_checked_at = now() where lesson_id = 'l004';`)
    const trg = (await q(`select lock_status, updated_at > '2020-01-01'::timestamptz as moved
                            from public.lesson_videos where lesson_id = 'l004'`))[0]
    note(trg.lock_status === 'locked' && trg.moved === true,
         'an update moves updated_at (the trigger on set_updated_at())', JSON.stringify(trg))

    // ── (2) again, by trying it ──
    for (const role of ['anon', 'authenticated']) {
      await asRole(role, () => raises(() => db.query(`select tella_video_id from public.lesson_videos`),
                                      `(2) as ${role}: reading lesson_videos directly is refused`, '42501'))
    }

    // ── the function is v97's text with the PRD's four changes and no others ──
    const v97code  = code(lift(V97F, FN_START, FN_END))
    const v100code = code(lift(V100F, FN_START, FN_END))
    const swaps = [
      ['and l.bunny_video_id is not null;',
       'and exists (select 1 from public.lesson_videos v where v.lesson_id = l.id);'],
      ['  v_max_delta  constant numeric := 20;',
       '  v_max_delta  constant numeric := 60;\n  v_speed_cap  constant numeric := 2.5;'],
      ['least(coalesce(p_delta_seconds, 0), v_elapsed, v_max_delta)',
       'least(coalesce(p_delta_seconds, 0), v_elapsed * v_speed_cap, v_max_delta)'],
      // (d), in its two halves: the new constant, declared just above
      // v_min_gap, and the first-beat branch reading it instead of v_max_delta.
      ['  v_min_gap    constant numeric := 5;',
       '  v_first_delta constant numeric := 20;\n  v_min_gap    constant numeric := 5;'],
      ['least(coalesce(p_delta_seconds, 0), v_max_delta)',
       'least(coalesce(p_delta_seconds, 0), v_first_delta)'],
    ]
    const eachOnce = swaps.every(([from]) => v97code.split(from).length === 2)
    const wanted = swaps.reduce((s, [from, to]) => s.replace(from, () => to), v97code)
    const wl = wanted.split('\n'), gl = v100code.split('\n')
    const at = wl.findIndex((l, i) => l !== gl[i])
    note(eachOnce && v100code === wanted,
         "v100's function is v97's with exactly the PRD's four changes, comments aside",
         v100code === wanted ? `${gl.length} lines of code, ${gl.length - code(lift(V97F, FN_START, FN_END)).split('\n').length} added`
                             : `first difference at code line ${at + 1}: ${JSON.stringify(gl[at])} vs ${JSON.stringify(wl[at])}`)

    // ── (5) the clock, at up to 2.5x ──
    let c = await credit(PLAIN, () => hbAfter(15, PLAIN, 15, 753, 15))
    note(c.r.accepted === true && c.got === 15,
         'normal speed is unchanged: 15 s after the last beat, a delta of 15 is credited 15', `+${c.got}`)
    c = await credit(PLAIN, () => hbAfter(15, PLAIN, 52.5, 753, 37.5))
    note(c.r.accepted === true && c.got === 37.5,
         '(5) at 2.5x: 15 s after the last beat, a delta of 37.5 is credited in full', `+${c.got}`)
    c = await credit(PLAIN, () => hbAfter(15, PLAIN, 97.5, 753, 45))
    note(c.r.accepted === true && c.got === 37.5,
         '(5) faster than 2.5x: 15 s after the last beat, a delta of 45 is credited 37.5', `+${c.got}`)
    c = await credit(PLAIN, () => hbAfter(60, PLAIN, 300, 753, 500))
    note(c.r.accepted === true && c.got === 60,
         '(5) the cap on one beat: 60 s after the last beat, a delta of 500 is credited 60', `+${c.got}`)

    // ── (6) a faker gains nothing ──
    // The bound on the 30 replays is the rule itself, 2.5x the clock that
    // really passed, plus a hundredth of rounding per beat (0.3 s). A fixed
    // number of seconds would be a guess at how fast this machine is.
    const t6 = performance.now()
    c = await credit(PLAIN, () => beat(PLAIN, 310, 753, 60, true))
    note(c.r.accepted === true && c.got < 0.5,
         '(6) a forced replay with no time passed is credited under 0.5 s', `+${c.got.toFixed(3)} of the 60 it asked for`)
    c = await credit(PLAIN, async () => { let r; for (let i = 0; i < 30; i++) r = await beat(PLAIN, 311 + i, 753, 60, true); return r })
    const wall6 = (performance.now() - t6) / 1000
    note(c.r.accepted === true && c.got <= 2.5 * wall6 + 0.3,
         '(6) ...and 30 more forced replays, asking for 1800 s, add no more than 2.5x the clock they took',
         `+${c.got.toFixed(3)} s in ${(wall6 * 1000).toFixed(0)} ms`)

    // ── (7) the result is the contract of PRD section 8 ──
    const keys = o => Object.keys(o).sort().join(',')
    const ACCEPTED = 'accepted,duration_seconds,last_position_seconds,max_position_seconds,threshold_crossed,threshold_met,watched_seconds'
    const LIMITED  = 'accepted,max_position_seconds,reason,threshold_crossed,threshold_met,watched_seconds'
    const limited = await beat(PLAIN, 350, 753, 5)
    note(first.accepted === true && keys(first) === ACCEPTED && c.r.accepted === true && keys(c.r) === ACCEPTED,
         '(7) an accepted result carries exactly the seven keys of PRD section 8 (first beat and later beat)', keys(c.r))
    note(limited.accepted === false && limited.reason === 'rate_limited' && keys(limited) === LIMITED,
         '(7) a rate-limited result carries exactly the six keys of PRD section 8', keys(limited))

    // ── the private table does not lock the student out of the RPC ──
    await db.exec(`update student_lesson_watch set last_heartbeat_at = now() - interval '15 seconds' where lesson_id = '${PLAIN}';`)
    const asStudent = await asRole('authenticated', () => beat(PLAIN, 360, 753, 10))
    note(asStudent.accepted === true,
         'as authenticated: the RPC still works, because security definer reads the private table for it',
         show(asStudent))

    // ── (10) the first beat keeps v97's 20 s and does not inherit the 60 ──
    // A first beat has no earlier timestamp, so the clock cannot clamp it. Read
    // from v_max_delta (60) it let ONE forged call pass both rules on any
    // lesson of 75 s or less. v_first_delta holds it at 20, as under v97.
    await db.exec(`delete from student_lesson_watch where lesson_id = '${PLAIN}';`)
    const tR = performance.now()
    await beat(PLAIN, 10, 753, 9999)
    const banked = (await watchOf(PLAIN)).w
    for (let i = 0; i < 30; i++) await beat(PLAIN, 11 + i, 753, 9999, true)
    const banked30 = (await watchOf(PLAIN)).w
    const wallR = (performance.now() - tR) / 1000
    note(banked === 20 && banked30 - banked <= 2.5 * wallR + 0.3,
         '(10) a forged first beat (no row yet, a delta of 9999) is credited exactly 20 s, once; 30 replays after it add no more than 2.5x the clock',
         `first=${banked} s (${((banked / 753) * 100).toFixed(1)}% of this 753 s lesson), then +${(banked30 - banked).toFixed(3)} s in ${(wallR * 1000).toFixed(0)} ms`)
    await db.exec(`update lessons set duration_seconds = 67 where id = 'l002';
                   insert into public.lesson_videos (lesson_id, tella_video_id) values ('l002', '${VID(6)}');`)
    const forged = await beat('l002', 67, 67, 9999)
    const fw = await watchOf('l002')
    note(forged.threshold_met === true && fw.w === 20 && fw.w / 67 < 0.8,
         '(10) on a 67 s lesson one forged call at the last second reaches the 95% point but NOT the 80% played floor (20/67 = 29.9%)',
         `threshold_met=${forged.threshold_met} played=${fw.w} s = ${((fw.w / 67) * 100).toFixed(1)}% (at the 60 s cap it was 89.6%)`)

    // ── (1) hand-run files get re-run ──
    const rowsBefore = await videoRows()
    const def100 = await fnDef()
    if (await ran(v100, '(1) v100 re-executes')) {
      t = await tableFacts()
      note(await videoRows() === rowsBefore && t.triggers === 1 && await fnDef() === def100,
           're-run keeps every lesson_videos row, one trigger and the same function', `${t.n} rows, ${t.triggers} trigger`)
      note(isPrivate(t) && await fnFacts() === factsBefore,
           're-run leaves the table private and the RPC grants as they were', JSON.stringify(t))
    }
    {
      let rows = null, err = ''
      try { rows = await runPostChecks(v100) } catch (e) { err = e.message }
      note(rows !== null && rows.length === 2 && allTrue(rows[0]) && Object.keys(rows[0]).length === 10,
           "v100's own commented post-checks run, and the first comes back all true",
           rows ? `${Object.keys(rows[0]).length} columns; ${JSON.stringify(rows[1])}` : err)
    }

    // ── (8) the undo ──
    const v97fn  = lift(V97F, FN_START, FN_END)
    const undoFn = lift(UNDOF, FN_START, FN_END)
    note(undoFn === v97fn && v97fn.includes('and l.bunny_video_id is not null;') && v97fn.endsWith(FN_END),
         "(8) the undo file's function text equals the text lift() takes from the v97 file",
         `${v97fn.split('\n').length} lines, ${v97fn.length} characters`)
    const rest = code(undo.replace(undoFn, () => '')).replace(/\s+/g, ' ').trim()
    note(rest === 'begin; drop table if exists public.lesson_videos; commit;',
         'outside that function the undo holds one statement, the drop', rest)

    const watchBeforeUndo = await watchRows()
    if (await ran(undo, '(8) the undo executes')) {
      note(await tableGone(), '(8) lesson_videos is gone')
      const defUndone = await fnDef()
      note(defAfterV97 !== null && defUndone === defAfterV97,
           '(8) record_lesson_heartbeat is character for character what it was right after v97',
           `${defUndone.length} characters`)
      note(await fnFacts() === factsBefore, 'the undo leaves the signature and the grants as they were', factsBefore)
      note(await watchRows() === watchBeforeUndo,
           'the undo leaves student_lesson_watch untouched', `${JSON.parse(watchBeforeUndo).length} row(s)`)

      // v97's behaviour is back, not just its text.
      await db.exec(`update student_lesson_watch set last_heartbeat_at = now() - interval '30 seconds';`)
      const back = await beat(BUNNY, 20, 753, 5)
      note(back.accepted === true,
           'after the undo the Bunny rule is back: the stamped lesson is accepted with no lesson_videos table',
           show(back))
      await raises(() => hb(PLAIN, 20, 753, 5), '...and the lesson with no bunny_video_id is refused again', '22023')
      c = await credit(BUNNY, () => hbAfter(15, BUNNY, 60, 753, 37.5))
      note(c.r.accepted === true && c.got === 15,
           '...and a 2.5x beat is credited at clock speed again (15 of 37.5)', `+${c.got}`)

      if (await ran(undo, 'the undo re-executes')) {
        note(await tableGone() && await fnDef() === defAfterV97, 'a second undo changes nothing')
      }
      let rows = null, err = ''
      try { rows = await runPostChecks(undo) } catch (e) { err = e.message }
      note(rows !== null && rows.length === 1 && allTrue(rows[0]) && Object.keys(rows[0]).length === 6,
           "the undo's own commented post-checks run and come back all true",
           rows ? `${Object.keys(rows[0]).length} columns` : err)
    }

    // ── (9) and forward again ──
    if (await ran(v100, '(9) v100 applies again after the undo')) {
      t = await tableFacts()
      note(await fnDef() === def100, 'the function is the one v100 installed the first time')
      note(isPrivate(t) && t.triggers === 1 && t.n === 0,
           'lesson_videos is back, private, and EMPTY: the undo dropped its rows', JSON.stringify(t))
    }
  }
}

console.log(`\n${'='.repeat(60)}\n  PASS ${ok.length}   FAIL ${fail.length}`)
if (fail.length) { console.log('\nFAILURES:'); fail.forEach(f => console.log('  - ' + f)); process.exit(1) }
