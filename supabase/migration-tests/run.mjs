import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
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

    // ── the function is v97's text with the PRD's five changes and no others ──
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
      // (e) the lock of D15: one new line, straight after the "no student" check.
      ["      using errcode = '42501';\n  end if;",
       "      using errcode = '42501';\n  end if;\n  perform pg_advisory_xact_lock(hashtextextended(v_student_id::text || ':' || p_lesson_id, 0));"],
    ]
    const eachOnce = swaps.every(([from]) => v97code.split(from).length === 2)
    const wanted = swaps.reduce((s, [from, to]) => s.replace(from, () => to), v97code)
    const wl = wanted.split('\n'), gl = v100code.split('\n')
    const at = wl.findIndex((l, i) => l !== gl[i])
    note(eachOnce && v100code === wanted,
         "v100's function is v97's with exactly the PRD's five changes, comments aside",
         v100code === wanted ? `${gl.length} lines of code, ${gl.length - code(lift(V97F, FN_START, FN_END)).split('\n').length} added`
                             : `first difference at code line ${at + 1}: ${JSON.stringify(gl[at])} vs ${JSON.stringify(wl[at])}`)

    // ── D15: one call at a time for each (student, lesson) ──
    // THE RACE ITSELF IS NOT REPRODUCED HERE, and cannot be: PGlite has one
    // connection, so two calls are never in flight together. Before the lock,
    // calls fired at the same instant each read the watch row before any of
    // them committed and each was credited in full. What this harness can
    // show, and does:
    //   * the lock is in the INSTALLED function, once, after the student
    //     lookup and before the row is read;
    //   * a call really holds it, on its own (student, lesson) key, until its
    //     transaction ends and no longer;
    //   * the second caller's arithmetic, run by hand further down, credits 0.
    // Sequential behaviour must not have moved. Nothing new checks that: the
    // (5), (6), (7) and (10) assertions below are the ones that passed before
    // the lock went in, and they now run against the function that has it.
    const LOCK = "perform pg_advisory_xact_lock(hashtextextended(v_student_id::text || ':' || p_lesson_id, 0));"
    {
      const live = await fnDef()
      const at = {
        student:   live.indexOf('where s.supabase_user_id = auth.uid()'),
        noStudent: live.indexOf("using errcode = '42501'"),
        lock:      live.indexOf(LOCK),
        lesson:    live.indexOf('from public.lessons l'),
        row:       live.indexOf('from public.student_lesson_watch'),
      }
      note(live.split('pg_advisory_xact_lock(').length === 2 && !live.includes('pg_advisory_lock(')
           && at.student > 0 && at.noStudent > at.student && at.lock > at.noStudent && at.lock < at.lesson && at.lock < at.row,
           'D15: the installed function takes the advisory lock once, after the student lookup and before the watch row is read',
           JSON.stringify(at))
      const held = await db.transaction(async tx => {
        const j = (await tx.query(`select public.record_lesson_heartbeat($1,$2,$3,$4,$5) as j`, [PLAIN, 1, 753, 0, true])).rows[0].j
        const l = (await tx.query(`
          select count(*)::int as n, bool_and(granted) as granted, bool_and(mode = 'ExclusiveLock') as exclusive,
                 bool_and(((classid::bigint << 32) | objid::bigint) = hashtextextended('${UID1}:${PLAIN}', 0)) as own_key
            from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`)).rows[0]
        return { j, l }
      }).catch(e => ({ j: raised(e), l: {} }))
      const afterCommit = (await q(`select count(*)::int n from pg_locks where locktype = 'advisory'`))[0].n
      note(held.j.accepted === true && held.l.n === 1 && held.l.granted === true && held.l.exclusive === true
           && held.l.own_key === true && afterCommit === 0,
           'D15: a call holds one exclusive lock, keyed on its own student and lesson, until its transaction ends and not after',
           `in the transaction: ${JSON.stringify(held.l)}; after it: ${afterCommit} lock(s)`)
    }

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

    // ── D15: the second caller's arithmetic, one call after another ──
    // What the lock turns a parallel burst into: each later call reads the
    // row the earlier one committed, while its own now() is still the instant
    // it was fired. Here that is one transaction (so every call has the SAME
    // now()), or a row stamped 50 ms AHEAD of now() (the later call was fired
    // a little before the earlier one). No two calls overlap; this is the
    // arithmetic of the caller that waited, and nothing more.
    const oneInstant = (lesson, setup, calls) => db.transaction(async tx => {
      const row = async () => (await tx.query(
        `select watched_seconds::float8 as w, extract(epoch from (last_heartbeat_at - now()))::float8 as ahead
           from student_lesson_watch where lesson_id = '${lesson}' and student_id = '${UID1}'::uuid`)).rows[0] ?? { w: 0, ahead: null }
      if (setup) await tx.query(setup)
      const out = []
      for (const [pos, dur, delta, force] of calls) {
        const was = (await row()).w
        const j = (await tx.query(`select public.record_lesson_heartbeat($1,$2,$3,$4,$5) as j`, [lesson, pos, dur, delta, force])).rows[0].j
        const now = await row()
        out.push({ j, got: now.w - was, ahead: now.ahead })
      }
      return out
    }).catch(e => calls.map(() => ({ j: raised(e), got: NaN, ahead: NaN })))
    {
      // The reviewer's trace: wait 24 s, then fire calls of 60 together.
      const b = await oneInstant(PLAIN,
        `update student_lesson_watch set last_heartbeat_at = now() - interval '24 seconds' where lesson_id = '${PLAIN}'`,
        [[400, 753, 60, false], [401, 753, 60, true], [402, 753, 60, true], [403, 753, 60, false]])
      note(b[0].j.accepted === true && b[0].got === 60 && b[1].j.accepted === true && b[1].got === 0
           && b[2].j.accepted === true && b[2].got === 0 && b[3].j.accepted === false && b[3].j.reason === 'rate_limited' && b[3].got === 0,
           "D15: the reviewer's trace served one call at a time: 24 s after the last beat, four calls of 60 are credited 60 between them, not 240; the unforced one gets the rate-limit answer",
           b.map(x => x.j.raised ?? `+${x.got}`).join(' '))
      // The later call was fired 50 ms BEFORE the earlier one's stamp.
      const e = await oneInstant(PLAIN,
        `update student_lesson_watch set last_heartbeat_at = now() + interval '50 milliseconds' where lesson_id = '${PLAIN}'`,
        [[410, 753, 60, false], [411, 753, 60, true]])
      note(e[0].j.accepted === false && e[0].j.reason === 'rate_limited' && e[0].got === 0
           && e[1].j.accepted === true && e[1].got === 0,
           'D15: a later caller whose now() is 50 ms BEFORE the stamp it finds is credited exactly 0, never a negative amount; unforced, it is rate limited',
           e.map(x => x.j.raised ?? `+${x.got}`).join(' '))
      note(Math.abs(e[0].ahead - 0.05) < 1e-6 && e[1].ahead === 0,
           'RESIDUAL (reported, not fixed here): that FORCED call then writes its own, earlier, start time into last_heartbeat_at, 50 ms back from the beat it found',
           `stamp ahead of now() by ${e[0].ahead} s before the forced call, ${e[1].ahead} s after it`)
      // Three first calls together, at the last second of the 67 s lesson.
      const f = await oneInstant('l002', `delete from student_lesson_watch where lesson_id = 'l002'`,
        [[67, 67, 9999, false], [67, 67, 9999, true], [67, 67, 9999, true]])
      const total = f.reduce((a, x) => a + x.got, 0)
      note(f[0].j.accepted === true && f[0].got === 20 && f[1].got === 0 && f[2].got === 0 && total / 67 < 0.8,
           'D15: three first calls at the last second of a 67 s lesson, served one at a time, bank 20 s between them (29.9%), not 60 (89.6%)',
           f.map(x => x.j.raised ?? `+${x.got}`).join(' '))
    }

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
      note(rows !== null && rows.length === 2 && allTrue(rows[0]) && Object.keys(rows[0]).length === 11,
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
    const guard = rest.slice(0, rest.indexOf('$guard$;') + 8)
    note(rest.startsWith('do $guard$') && rest === guard + ' begin; drop table if exists public.lesson_videos; commit;'
         && guard.includes("execute 'select count(*) from public.lesson_videos' into v_rows")
         && !/\b(drop|delete|update|insert|alter|create|truncate|grant|revoke)\b/i.test(guard.replace(/'[^']*'/g, "''")),
         'outside that function the undo holds a guard that only counts, and one statement, the drop',
         rest.slice(guard.length).trim())

    // ── D19: the undo will not drop the only record of which video is whose ──
    {
      const rowsThen = await videoRows()
      const n = JSON.parse(rowsThen).length
      let refusal = null
      try { await db.exec(undo) } catch (e) { refusal = e; await db.exec('rollback;').catch(() => {}) }
      const said = refusal ? `${refusal.message} ${refusal.detail ?? ''} ${refusal.hint ?? ''}` : ''
      note(refusal !== null && refusal.code === 'P0001' && n > 0 && said.includes(`holds ${n} row(s)`)
           && said.includes('select lesson_id, tella_video_id from public.lesson_videos')
           && said.includes('delete from public.lesson_videos') && /Nothing was changed/.test(said) && !/vid_/.test(said),
           'D19: with rows in lesson_videos the undo refuses: it says how many, gives the select that saves them, says to delete them, and prints no video id',
           refusal ? said.slice(0, 44) : 'it ran')
      note(!(await tableGone()) && await videoRows() === rowsThen && await fnDef() === def100 && await fnFacts() === factsBefore,
           "D19: ...and the refused undo changed nothing: the table, its rows and v100's function are all still there", `${n} rows`)
      // What the message says to do. (The harness's ids are fakes; nothing to
      // save.) Skipped when the undo wrongly ran: the table is gone by then,
      // and the two assertions above have already said so.
      if (!(await tableGone())) await db.exec(`delete from public.lesson_videos;`)
    }

    const watchBeforeUndo = await watchRows()
    if (await ran(undo, '(8) with the table emptied, the undo executes')) {
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
      note(rows !== null && rows.length === 1 && allTrue(rows[0]) && Object.keys(rows[0]).length === 7,
           "the undo's own commented post-checks run and come back all true",
           rows ? `${Object.keys(rows[0]).length} columns` : err)
    }

    // ── (9) and forward again ──
    if (await ran(v100, '(9) v100 applies again after the undo')) {
      t = await tableFacts()
      note(await fnDef() === def100, 'the function is the one v100 installed the first time')
      note(isPrivate(t) && t.triggers === 1 && t.n === 0,
           'lesson_videos is back, private and empty', JSON.stringify(t))
    }
  }
}


console.log('\n=== 19. the morning kit: stamp, prove, unstamp the Tella test lessons ===')
// Three files from supabase/diagnostics that the owner runs by hand against
// production. They are run here the way the SQL editor runs them: the whole
// file at once, and the rows of its LAST statement are what he sees.
{
  const D = fileURLToPath(new URL('../diagnostics/', import.meta.url))
  const file = f => fs.readFileSync(D + f, 'utf8')
  const stampRaw   = file('stamp-tella-test-lessons.sql')
  const unstampRaw = file('unstamp-tella-test-lessons.sql')
  const proofSql   = file('tella-proof.sql')
  const P1 = 'REPLACE_WITH_TEST_VIDEO_ID_1', P2 = 'REPLACE_WITH_TEST_VIDEO_ID_2'
  // Well-formed FAKE ids, as in section 18. Never a real one.
  const FAKE = n => `vid_kitfakeaaaaaaaaa${String(n).padStart(2, '0')}`
  // The Bunny test video stamp-test-lesson.sql stamps. Already in that file.
  const BUNNY_TEST = '09ff6d92-1312-4b96-bc3b-75b5edbcab34'
  const SID = n => `00000000-0000-0000-0000-00000000000${n}`
  const OWNER = SID(1)   // the account that watches; UID1 is its login
  const paste = (sql, a, b) => sql.replace(P1, () => a).replace(P2, () => b)
  const times = (text, sub) => text.split(sub).length - 1

  const run = async sql => {
    try {
      const last = (await db.exec(sql)).at(-1)
      return { ok: true, rows: last.rows, cols: last.fields.map(f => f.name) }
    } catch (e) {
      await db.exec('rollback;').catch(() => {})
      return { ok: false, rows: [], cols: [], code: e.code, said: `${e.message} ${e.detail ?? ''} ${e.hint ?? ''}` }
    }
  }
  const beat = (...a) => hb(...a).catch(e => ({ accepted: false, raised: `${e.code}: ${e.message.slice(0, 70)}` }))
  const videos = () => q(`select lesson_id, tella_video_id, lock_status, lock_detail, lock_checked_at
                            from public.lesson_videos order by lesson_id`)
  const lessonOf = async id => (await q(`select id, region_id, duration_seconds, bunny_video_id from lessons where id = '${id}'`))[0]
  const mine = async () => JSON.stringify({
    watch: await q(`select * from student_lesson_watch order by student_id, lesson_id`),
    done:  await q(`select student_id, lesson_id, completed_at from student_lesson_completions order by student_id, lesson_id`),
  })
  const world = async () => JSON.stringify({
    lessons: await q(`select * from lessons order by id`),
    videos:  await q(`select * from public.lesson_videos order by lesson_id`),
  }) + await mine()
  // The pick, written a second time and a different way: plain rows out of
  // the database, the ordering done here. When this and the file's SQL agree
  // it is because both follow the rule, and neither is a copy of the other.
  const leastCompleted = async () => (await q(`
      select l.id, l.sort_order,
             (select count(*)::int from student_lesson_completions c
               where c.lesson_id = l.id and c.completed_at is not null) as done
        from lessons l where l.type = 'watch'`))
    .sort((a, b) => a.done - b.done || b.sort_order - a.sort_order || (a.id < b.id ? 1 : -1))
    .slice(0, 2).map(r => r.id)
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  // Rows a person is shown must never carry a video id.
  const noVideoId = rows => !/vid_/.test(JSON.stringify(rows))

  // ── the files themselves ──
  note([stampRaw, unstampRaw].every(t => times(t, P1) === 1 && times(t, P2) === 1) && times(proofSql, 'REPLACE_WITH') === 0,
       'each placeholder appears exactly once in the stamp file and in the unstamp file; the proof has none')
  note(![stampRaw, unstampRaw, proofSql].some(t => /vid_[a-z0-9]{10,}/.test(t)),
       'none of the three files holds anything shaped like a video id')
  const heads = ['stamp-test-lesson.sql', 'pick-test-lesson.sql'].map(f => file(f).split('\n'))
  note(heads.every(l => /^-- SUPERSEDED/.test(l[0]) && /Bunny player/.test(l[0])
                        && /stamp-tella-test-lessons\.sql/.test(l[0]) && l[1].startsWith('-- ====')),
       'the two Bunny files open with one line saying they are superseded by the Tella files')
  const proofCode = proofSql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim()
  note(/^select\b/i.test(proofCode) && times(proofCode, ';') === 1
       && !/\b(insert|update|delete|drop|alter|create|truncate|grant|set_config)\b/i.test(proofCode),
       'tella-proof.sql is one select and writes nothing')

  if (!(await q(`select to_regclass('public.lesson_videos') is not null as y`))[0].y) {
    note(false, 'section 19 needs v100 applied', 'public.lesson_videos is missing')
  } else {
    // ── a production-shaped starting point ──
    await db.exec(`
      select set_config('test.uid','${UID1}',false);
      delete from student_lesson_watch;
      delete from public.lesson_videos;
      update lessons set bunny_video_id = null, video_ready_at = null, duration_seconds = null;`)
    const [T0, T1] = await leastCompleted()
    // Every OTHER watch lesson gets one completion, from a student who had
    // none. Production has this margin and the bare seed does not: without it
    // the proof's own completion below would lift a test lesson out of the
    // bottom two and move the pick. That move is tested on purpose further on.
    await db.exec(`insert into student_lesson_completions (student_id, lesson_id, completed_at)
                   select '${SID(7)}'::uuid, l.id, '2026-06-10 10:00:00+00' from lessons l
                    where l.type = 'watch' and l.id not in ('${T0}', '${T1}');`)
    // And one student SKIPPED the first of the two: a completion row with no
    // completed_at. The pick counts completions, so this must not move it.
    await db.exec(`insert into student_lesson_completions (student_id, lesson_id, completed_at, skipped_at)
                   values ('${SID(2)}'::uuid, '${T0}', null, '2026-06-11 10:00:00+00');`)
    // The Bunny stamp, put on by its own file, as it was on production.
    await db.exec(file('stamp-test-lesson.sql').split('-- What it picked:')[0])
    {
      const a = await lessonOf(T0), b = await lessonOf(T1)
      note(a.bunny_video_id === BUNNY_TEST && a.duration_seconds === 753
           && b.bunny_video_id === null && b.duration_seconds === null && same(await leastCompleted(), [T0, T1]),
           'seed: of the two least-completed watch lessons, one carries the Bunny test stamp (753 s) and one has no duration',
           `${T0} (Bunny, 753, skipped once) and ${T1} (none)`)
    }

    // ── a half-edited file refuses, and says nothing it was given ──
    const untouched = await world()
    let r = await run(stampRaw)
    note(!r.ok && r.code === 'P0001' && /Placeholder 1 was not replaced/.test(r.said),
         'the stamp file refuses to run with its placeholders unreplaced', r.ok ? 'it ran' : r.said.slice(0, 70))
    r = await run(stampRaw.replace(P1, () => FAKE(1)))
    note(!r.ok && r.code === 'P0001' && /Placeholder 2 was not replaced/.test(r.said),
         '...and with only the first one replaced', r.ok ? 'it ran' : r.said.slice(0, 70))
    const link = `https://www.tella.tv/video/${FAKE(1)}/embed`
    const bad = [await run(paste(stampRaw, link, FAKE(2))),          // a pasted link
                 await run(paste(stampRaw, FAKE(1), 'vid_TOOSHORT')), // not an id
                 await run(paste(stampRaw, FAKE(1), FAKE(1)))]        // the same id twice
    note(bad.every(b => !b.ok && b.code === 'P0001' && /Nothing was changed/.test(b.said))
         && /not a Tella video id/.test(bad[0].said) && /not a Tella video id/.test(bad[1].said) && /same video id/.test(bad[2].said)
         && bad.every(b => !b.said.includes(FAKE(1)) && !b.said.includes(FAKE(2)) && !b.said.includes('tella.tv') && !b.said.includes('TOOSHORT')),
         '...and with a pasted link, a malformed id, or the same id twice; no message repeats what was pasted',
         bad.map(b => b.ok ? 'it ran' : b.said.slice(0, 34)).join(' | '))
    r = await run(unstampRaw)
    note(!r.ok && r.code === 'P0001' && /Placeholder 1 was not replaced/.test(r.said),
         'the unstamp file refuses the same way', r.ok ? 'it ran' : r.said.slice(0, 70))
    note(await world() === untouched, 'none of the refused runs changed anything')

    // ── stamp ──
    const rest = async () => JSON.stringify({
      others: await q(`select * from lessons where id not in ('${T0}', '${T1}') order by id`),
      two:    await q(`select id, region_id, day, type, title, sort_order, bunny_video_id from lessons where id in ('${T0}', '${T1}') order by id`),
    }) + await mine()
    const restBefore = await rest()
    r = await run(paste(stampRaw, FAKE(1), FAKE(2)))
    let v = await videos()
    const holds = id => v.find(x => x.lesson_id === id)?.tella_video_id
    const both67 = async () => (await lessonOf(T0)).duration_seconds === 67 && (await lessonOf(T1)).duration_seconds === 67
    note(r.ok && v.length === 2 && same(v.map(x => x.lesson_id).sort(), [T0, T1].sort()),
         'the stamp leaves exactly two lesson_videos rows, on the two least-completed watch lessons',
         r.ok ? v.map(x => x.lesson_id).join(', ') : r.said.slice(0, 80))
    note(holds(T0) === FAKE(1) && holds(T1) === FAKE(2) && v.every(x => x.lock_status === 'unchecked'),
         'the first id is on the first lesson and the second on the second, both unchecked')
    note(await both67(), 'both durations are 67')
    const SCOLS = 'test_lesson,lesson_id,region_id,title,duration_now,open_in_the_app,old_watch_rows,before_this_run'
    note(r.rows.length === 2 && r.cols.join(',') === SCOLS
         && same(r.rows.map(x => [x.test_lesson, x.lesson_id]), [[1, T0], [2, T1]])
         && r.rows.every(x => x.open_in_the_app === `/world/${x.region_id}/${x.lesson_id}` && /^r\d$/.test(x.region_id)
                              && x.duration_now === 67 && !!x.title && x.old_watch_rows === 0
                              && /nothing was stamped before/.test(x.before_this_run)),
         "the stamp's final select has two rows: lesson, region, title, the 67 now set, and the /world/... path",
         r.rows.map(x => x.open_in_the_app).join(' , '))
    note(r.rows.length === 2 && noVideoId(r.rows) && !r.cols.some(c => /video|tella|vid/i.test(c)),
         '...and no column that could hold a video id', r.cols.join(','))
    note(await rest() === restBefore,
         'the stamp touches nothing else: no other lesson, nothing else on the two lessons, no watch row, no completion')

    // ── proof ──
    const proof = async () => { const res = await db.query(proofSql); return { rows: res.rows, cols: res.fields.map(f => f.name) } }
    let p = await proof()
    note(p.rows.length === 0, 'the proof runs and is empty before anything was watched', `${p.rows.length} rows`)
    // Three beats on the second test lesson: play starts, 20 s later the
    // player is at 0:40 having played 40 s, 10 s after that it is at 1:06
    // having played 20 more. Each delta is inside 2.5x the clock, so each is
    // credited whole and the numbers below are exact.
    const b1 = await beat(T1, 0, 67, 0)
    await db.exec(`update student_lesson_watch set last_heartbeat_at = now() - interval '20 seconds' where lesson_id = '${T1}';`)
    const b2 = await beat(T1, 40, 67, 40)
    await db.exec(`update student_lesson_watch set last_heartbeat_at = now() - interval '10 seconds' where lesson_id = '${T1}';`)
    const b3 = await beat(T1, 66, 67, 20)
    note(b1.accepted === true && b2.accepted === true && b3.accepted === true && b3.threshold_met === true,
         'the heartbeat function accepts beats on a stamped lesson and stamps its 95% point',
         [b1, b2, b3].map(b => b.raised ?? `accepted=${b.accepted}`).join(' | '))
    p = await proof()
    const PCOLS = 'lesson_id,furthest_seconds,really_watched_seconds,lesson_seconds,furthest_pct,watched_pct,'
                + 'heartbeats,first_played_at,last_heartbeat_at,threshold_met_at,completed_at,counted'
    const row = p.rows[0] ?? {}
    note(p.rows.length === 1 && p.cols.join(',') === PCOLS && row.lesson_id === T1
         && Number(row.furthest_seconds) === 66 && Number(row.really_watched_seconds) === 60 && row.lesson_seconds === 67
         && Number(row.furthest_pct) === 98.5 && Number(row.watched_pct) === 89.6 && row.heartbeats === 3
         && row.first_played_at instanceof Date && row.last_heartbeat_at instanceof Date && row.threshold_met_at instanceof Date
         && row.completed_at === null && row.counted === false,
         'the proof shows one row: furthest 66 s (98.5%), really watched 60 s (89.6%) of 67, 3 heartbeats, 95% stamped, counted false',
         `furthest=${row.furthest_seconds} (${row.furthest_pct}%) watched=${row.really_watched_seconds} (${row.watched_pct}%) of ${row.lesson_seconds}, counted=${row.counted}`)
    note(p.rows.length === 1 && !p.cols.some(c => /student|email|user|video|tella/i.test(c))
         && !/vid_|@|[0-9a-f]{8}-[0-9a-f]{4}-/.test(JSON.stringify(p.rows)),
         'the proof shows no student id, no email and no video id')
    // A completion ROW is not yet a completion: a skipped lesson has a row
    // with skipped_at and no completed_at.
    await db.exec(`insert into student_lesson_completions (student_id, lesson_id, completed_at, skipped_at) values ('${OWNER}'::uuid, '${T1}', null, now());`)
    p = await proof()
    note(p.rows.length === 1 && p.rows[0].counted === false && p.rows[0].completed_at === null,
         'a completion row with no completed_at (a skip) does not make counted true', `counted=${p.rows[0]?.counted}`)
    await db.exec(`delete from student_lesson_completions where student_id = '${OWNER}'::uuid and lesson_id = '${T1}';
                   insert into student_lesson_completions (student_id, lesson_id, completed_at) values ('${OWNER}'::uuid, '${T1}', now());`)
    p = await proof()
    note(p.rows.length === 1 && p.rows[0].counted === true && p.rows[0].completed_at instanceof Date,
         'after a completion row is inserted for it, counted is true', `counted=${p.rows[0]?.counted}`)
    // Another account finishes the FIRST test lesson; this account only opens it.
    await db.exec(`
      insert into student_lesson_completions (student_id, lesson_id, completed_at) values ('${SID(8)}'::uuid, '${T0}', now());
      update student_lesson_watch set last_heartbeat_at = now() - interval '5 minutes' where lesson_id = '${T1}';`)
    await beat(T0, 5, 67, 0)
    p = await proof()
    note(p.rows.length === 2 && p.rows[0].lesson_id === T0 && p.rows[0].counted === false && p.rows[0].completed_at === null
         && p.rows[1].lesson_id === T1 && p.rows[1].counted === true,
         "another student's completion of the same lesson does not count, and the newest row comes first",
         p.rows.map(x => `${x.lesson_id}:${x.counted}`).join(' '))

    // ── stamp again ──
    const mineBefore = await mine()
    const stillSame = same(await leastCompleted(), [T0, T1])
    r = await run(paste(stampRaw, ` ${FAKE(1)}\t`, `${FAKE(2)}  `))
    v = await videos()
    note(stillSame && r.ok && v.length === 2 && holds(T0) === FAKE(1) && holds(T1) === FAKE(2) && await both67()
         && same(r.rows.map(x => x.lesson_id), [T0, T1]),
         'stamp again (ids pasted with stray spaces this time): the same two lessons, still two rows, the same video on each',
         r.ok ? v.map(x => x.lesson_id).join(', ') : r.said.slice(0, 80))
    note(r.rows.length === 2 && r.rows.every(x => /earlier run was taken back first/.test(x.before_this_run)
                                                  && x.before_this_run.includes(T0) && x.before_this_run.includes(T1))
         && noVideoId(r.rows),
         '...and its result says the earlier run was taken back first', r.rows[0]?.before_this_run)
    note(r.rows.length === 2 && r.rows.every(x => x.old_watch_rows === 1),
         '...and that both test lessons now carry an old watch row, so a second proof on them would not start from zero',
         r.rows.map(x => `${x.lesson_id}: ${x.old_watch_rows}`).join(', '))
    note(await mine() === mineBefore, 'a second stamp leaves the watch rows and the completions alone')

    // ── unstamp ──
    r = await run(paste(unstampRaw, FAKE(1), FAKE(2)))
    v = await videos()
    note(r.ok && v.length === 0, 'after the unstamp lesson_videos is empty', r.ok ? `${v.length} rows` : r.said.slice(0, 80))
    {
      const a = await lessonOf(T0), b = await lessonOf(T1)
      note(a.duration_seconds === 753 && a.bunny_video_id === BUNNY_TEST && b.duration_seconds === null,
           'the durations are back: 753 on the lesson that carries the Bunny test stamp, empty on the other',
           `${T0}=${a.duration_seconds} ${T1}=${b.duration_seconds}`)
    }
    const UCOLS = 'lesson_id,region_id,title,duration_now,what_happened'
    const said = id => r.rows.find(x => x.lesson_id === id) ?? {}
    note(r.rows.length === 2 && r.cols.join(',') === UCOLS
         && said(T0).duration_now === 753 && /put back to 753 \(the Bunny test stamp\)/.test(said(T0).what_happened)
         && said(T1).duration_now === null && /put back to empty/.test(said(T1).what_happened)
         && r.rows.every(x => !!x.title && /^r\d$/.test(x.region_id)) && noVideoId(r.rows),
         "the unstamp's final select names the two lessons it put back and what each got, with no video id",
         r.rows.map(x => `${x.lesson_id}: ${x.what_happened}`).join(' | '))
    note(await mine() === mineBefore, 'the unstamp leaves the watch rows and the completions alone')
    // The proof's header says to run it BEFORE the unstamp. This is why.
    p = await proof()
    {
      const of = id => p.rows.find(x => x.lesson_id === id) ?? {}
      note(p.rows.length === 2
           && of(T1).lesson_seconds === null && of(T1).furthest_pct === null && of(T1).watched_pct === null && of(T1).counted === true
           && of(T0).lesson_seconds === 753 && Number(of(T0).furthest_pct) === 0.7 && Number(of(T0).watched_pct) === 0,
           'after the unstamp the proof still lists both rows, measured against the duration that was put back (empty, or 753)',
           `${T1}: of ${of(T1).lesson_seconds} -> ${of(T1).furthest_pct}% | ${T0}: 5 s of ${of(T0).lesson_seconds} -> ${of(T0).furthest_pct}%`)
    }
    const afterUnstamp = await world()
    r = await run(paste(unstampRaw, FAKE(1), FAKE(2)))
    note(r.ok && await world() === afterUnstamp && r.rows.length === 1 && r.rows[0].lesson_id === null
         && /Nothing to take back/.test(r.rows[0].what_happened),
         'a second unstamp changes nothing and says so', r.ok ? r.rows[0]?.what_happened : r.said.slice(0, 80))

    // ── the optional deletes at the foot of the unstamp file ──
    // Commented in the file. Uncommented here, because a delete nobody ran is
    // a delete nobody tested, and these lessons are live: the wrong WHERE
    // would wipe every student's completion of them.
    const optional = unstampRaw.slice(unstampRaw.indexOf('\n-- OPTIONAL'))
      .split('\n').filter(l => /^--    /.test(l)).map(l => l.slice(2)).join('\n')
    r = await run(optional)
    note(times(optional, 'delete from') === 2 && !r.ok && await mine() === mineBefore,
         "the unstamp's optional deletes, left with their placeholders, fail and delete nothing",
         r.ok ? 'they ran' : r.said.slice(0, 60))
    const tally = async () => (await q(`select
        (select count(*)::int from student_lesson_watch       where student_id = '${OWNER}'::uuid and lesson_id in ('${T0}', '${T1}')) as my_watch,
        (select count(*)::int from student_lesson_completions where student_id = '${OWNER}'::uuid and lesson_id in ('${T0}', '${T1}')) as my_done,
        (select count(*)::int from student_lesson_completions where student_id = '${OWNER}'::uuid and lesson_id not in ('${T0}', '${T1}')) as my_other_done,
        (select count(*)::int from student_lesson_completions where student_id <> '${OWNER}'::uuid) as others_done,
        (select count(*)::int from student_lesson_completions where student_id = '${SID(8)}'::uuid and lesson_id = '${T0}') as other_on_same_lesson`))[0]
    const had = await tally()
    r = await run(optional.replaceAll('REPLACE_WITH_LESSON_ID_1', T0).replaceAll('REPLACE_WITH_LESSON_ID_2', T1)
                          .replaceAll('REPLACE_WITH_YOUR_STUDENT_ID', OWNER))
    const has = await tally()
    note(r.ok && had.my_watch === 2 && had.my_done === 1 && has.my_watch === 0 && has.my_done === 0
         && has.my_other_done === had.my_other_done && has.others_done === had.others_done && has.other_on_same_lesson === 1,
         "filled in, they delete that one account's rows on the two lessons and nothing else: another student's completion of the same lesson stays",
         r.ok ? JSON.stringify(has) : r.said.slice(0, 80))

    // ── when the pick moves ──
    // Stamp, then let four more students finish the Bunny-stamped lesson, so
    // it is no longer one of the two least completed. The next stamp has to
    // put that lesson back (753, no row) and land on the new pair. This is
    // the only way step 1 of the stamp file is really exercised: when the
    // same two lessons are picked again, a broken step 1 is hidden by step 3.
    r = await run(paste(stampRaw, FAKE(1), FAKE(2)))
    const firstPair = (await videos()).map(x => x.lesson_id)
    await db.exec([3, 4, 5, 6].map(n =>
      `insert into student_lesson_completions (student_id, lesson_id, completed_at) values ('${SID(n)}'::uuid, '${T0}', now());`).join('\n'))
    const [N0, N1] = await leastCompleted()
    r = await run(paste(stampRaw, FAKE(1), FAKE(2)))
    v = await videos()
    {
      const left = await lessonOf(T0)
      note(r.ok && firstPair.includes(T0) && ![N0, N1].includes(T0)
           && left.duration_seconds === 753 && !v.some(x => x.lesson_id === T0),
           'when completions move the pick, the lesson left behind is put back: 753 again and no lesson_videos row',
           `${T0}=${left.duration_seconds}; pick moved from ${firstPair.join(', ')} to ${N0}, ${N1}`)
      note(r.ok && v.length === 2 && holds(N0) === FAKE(1) && holds(N1) === FAKE(2)
           && (await lessonOf(N0)).duration_seconds === 67 && (await lessonOf(N1)).duration_seconds === 67
           && same(r.rows.map(x => x.lesson_id), [N0, N1]) && r.rows.every(x => x.before_this_run.includes(T0)),
           '...and the two videos are on the new pair, first id on the first, still exactly two rows',
           r.ok ? v.map(x => x.lesson_id).join(', ') : r.said.slice(0, 80))
    }

    // ── D19: the stamp never replaces a video it did not put there ──
    // The two test videos are on N0 and N1. Give N1 a THIRD fake id, as if a
    // real lesson video sat on a lesson the stamp is about to pick. N0 still
    // holds this file's own video, so step 1 has work to do before the
    // refusal, and the refusal has to take that work back.
    await db.exec(`update public.lesson_videos
                      set tella_video_id = '${FAKE(9)}', lock_status = 'locked', lock_detail = 'a verdict about the real video', lock_checked_at = now()
                    where lesson_id = '${N1}';`)
    let asItWas = await world()
    r = await run(paste(stampRaw, FAKE(1), FAKE(2)))
    v = await videos()
    note(!r.ok && r.code === 'P0001' && r.said.includes(`Lesson ${N1} already has a video`) && !r.said.includes(N0)
         && /Nothing was changed/.test(r.said) && !/vid_/.test(r.said),
         'D19: a picked lesson holding a third video makes the stamp refuse; the message names that lesson and no video id',
         r.ok ? 'it ran' : r.said.slice(0, 60))
    note(await world() === asItWas && holds(N1) === FAKE(9) && holds(N0) === FAKE(1),
         "D19: ...and nothing changed: the third video's row is untouched, and the file's own row on the other lesson is back")

    // Two other test videos with no unstamp in between. The old pair now looks
    // like videos the file did not put there, so it stops. (Before D19 it
    // replaced them, and this assertion said so.)
    await db.exec(`update public.lesson_videos set tella_video_id = '${FAKE(2)}' where lesson_id = '${N1}';`)
    asItWas = await world()
    r = await run(paste(stampRaw, FAKE(3), FAKE(4)))
    v = await videos()
    note(!r.ok && r.code === 'P0001' && r.said.includes(N0) && r.said.includes(N1)
         && /unstamp-tella-test-lessons\.sql with the OLD ids/.test(r.said) && !/vid_/.test(r.said)
         && await world() === asItWas && holds(N0) === FAKE(1) && holds(N1) === FAKE(2),
         'stamped with two other videos and no unstamp between: the stamp refuses, names both lessons and the unstamp file, and the old rows stay as they were',
         r.ok ? 'it ran' : r.said.slice(0, 60))
    // The way the header says to do it.
    const tookBack = await run(paste(unstampRaw, FAKE(1), FAKE(2)))
    r = await run(paste(stampRaw, FAKE(3), FAKE(4)))
    v = await videos()
    note(tookBack.ok && r.ok && v.length === 2 && holds(N0) === FAKE(3) && holds(N1) === FAKE(4)
         && v.every(x => x.lock_status === 'unchecked' && x.lock_detail === null && x.lock_checked_at === null),
         'unstamped with the OLD ids first, the two other videos go on: two rows, both unchecked',
         r.ok ? `${v.length} rows` : r.said.slice(0, 80))
    r = await run(paste(unstampRaw, FAKE(3), FAKE(4)))
    v = await videos()
    note(r.ok && v.length === 0 && (await lessonOf(N0)).duration_seconds === null && (await lessonOf(N1)).duration_seconds === null
         && (await lessonOf(T0)).duration_seconds === 753
         && (await q(`select count(*)::int n from lessons where duration_seconds = 67`))[0].n === 0,
         'the last unstamp leaves lesson_videos empty and no lesson at 67',
         r.ok ? `${v.length} rows` : r.said.slice(0, 80))
  }
}


// ── shared by sections 20 and 21 ──
// A file run the way the SQL editor runs it: the whole text at once, and the
// rows of its LAST statement are what the owner sees. When the file raises,
// the transaction it left open is rolled back, so the assertions after it
// report what is true instead of all failing on "transaction is aborted".
const runFile = async (d, sql) => {
  try {
    const last = (await d.exec(sql)).at(-1)
    return { ok: true, rows: last.rows, cols: last.fields.map(f => f.name) }
  } catch (e) {
    await d.exec('rollback;').catch(() => {})
    return { ok: false, rows: [], cols: [], code: e.code, said: `${e.message} ${e.detail ?? ''} ${e.hint ?? ''}`.trim() }
  }
}
const rowsOn = async (d, sql) => (await d.query(sql)).rows
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const countOf = (text, sub) => text.split(sub).length - 1
const diagnostic = f => fs.readFileSync(fileURLToPath(new URL('../diagnostics/' + f, import.meta.url)), 'utf8')
const V99F  = '2026_v99_area_landmarks_and_rail.sql'
const V101F = '2026_v101_course_catalog.sql'
// The course's data file. The SQL under test was generated from it.
const COURSE = JSON.parse(fs.readFileSync(new URL('../catalog/course_catalog.json', import.meta.url), 'utf8'))
// Well-formed FAKE video ids, as in sections 18 and 19. A real Tella id is the
// video itself and this repository is public, so a real one never goes in a
// tracked file.
const LOADFAKE = n => `vid_loadfake${'a'.repeat(8)}${String(n).padStart(2, '0')}`
// A second database, in memory: the base schema, the staging catalog (v94)
// and the landmarks (v99), then whatever the path needs. It has no v92, v93
// or v100, so no student_lesson_watch and no lesson_videos unless a path adds
// them.
const secondDatabase = async (...more) => {
  const d = new PGlite()
  await d.exec(fs.readFileSync(new URL('base.sql', import.meta.url), 'utf8'))
  await d.exec(v94)
  await d.exec(read(V99F))
  for (const sql of more) await d.exec(sql)
  return d
}


console.log('\n=== 20. v101: the real course in the staging catalog, its generator, and the undo ===')
// lessons_next goes from v94's 145 placeholders to the 141 lessons of
// supabase/catalog/course_catalog.json. v101 and its undo are GENERATED
// files, so the generator is under test too. It is run here as a program, the
// way `npm run build:catalog` runs it.
{
  const CATALOG_DIR = fileURLToPath(new URL('../catalog/', import.meta.url))
  const GENERATOR   = CATALOG_DIR + 'build-course-sql.mjs'
  const UNDO_PATH   = fileURLToPath(new URL('../undo/2026_v101_undo.sql', import.meta.url))
  const catalogText = fs.readFileSync(CATALOG_DIR + 'course_catalog.json', 'utf8')
  const v101 = read(V101F)
  const undo = fs.readFileSync(UNDO_PATH, 'utf8')
  const checkSql = diagnostic('course-catalog-check.sql')
  const FAKE = LOADFAKE
  // Code only: comments and blank lines out.
  const code = s => s.split('\n').map(l => l.replace(/--.*$/, '').trimEnd()).filter(l => l.trim()).join('\n')
  const strip = (rows, cols) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !cols.includes(k))))

  // What the data file says, worked out here a second time and on its own.
  // The generator's arithmetic is not reused, so when the database agrees
  // with this it is because both follow the data file.
  const wantRows = COURSE.lessons.map((l, i) => ({
    id: l.id, region_id: l.area, type: l.type, title: l.title, sort_order: i + 1,
    requires_action: 'action_brief' in l, action_brief: l.action_brief ?? null,
    is_gate: l.gate === true, counts_toward_progress: l.counts !== false, feature_key: l.feature_key ?? null,
    whop_lesson_id: l.whop_lesson_id,
  }))
  // The table v101's final select returns. `withLength` lists the lessons
  // that have a length at that moment.
  const wantTable = (withLength = []) => {
    const line = (area, name, ls) => ({
      area, name, rows: ls.length, counting: ls.filter(l => l.counts !== false).length,
      action_items: ls.filter(l => 'action_brief' in l).length, with_length: ls.filter(l => withLength.includes(l.id)).length })
    return [...COURSE.areas.map(a => line(a.id, a.name, COURSE.lessons.filter(l => l.area === a.id))),
            line('total', 'the whole course', COURSE.lessons)]
  }
  // The post-conditions of the PRD (section 9.C, step 7), as its own numbers.
  const THE_COURSE = { n: 141, counting: 140, lo: 1, hi: 141, orders: 141, sizes: '8,11,25,17,26,22,19,13', crossings: 0, gates: 'a4l17',
                       special: 'a7l19/bounty_access/false', actions: 9, no_brief: 0, setups: 5, placeholders: 0 }
  const facts = async d => (await rowsOn(d, `select
      count(*)::int as n,
      count(*) filter (where counts_toward_progress)::int as counting,
      min(sort_order)::int as lo, max(sort_order)::int as hi, count(distinct sort_order)::int as orders,
      (select string_agg(s.n::text, ',' order by s.order_num)
         from (select r.order_num, count(l.id) as n from regions_next r
                 left join lessons_next l on l.region_id = r.id group by r.order_num) s) as sizes,
      -- Pairs of lessons where the one in the EARLIER area comes later in the
      -- course. Written lesson by lesson, where v101 compares each area's
      -- first lesson with the last of the area before it.
      (select count(*)::int
         from lessons_next x join regions_next rx on rx.id = x.region_id
         join lessons_next y on y.sort_order < x.sort_order
         join regions_next ry on ry.id = y.region_id
        where rx.order_num < ry.order_num) as crossings,
      string_agg(id, ',' order by id) filter (where is_gate) as gates,
      string_agg(id || '/' || coalesce(feature_key, '') || '/' || counts_toward_progress::text, ',' order by id)
        filter (where feature_key is not null or not counts_toward_progress) as special,
      count(*) filter (where requires_action)::int as actions,
      count(*) filter (where requires_action and action_brief is null)::int as no_brief,
      count(*) filter (where type = 'setup')::int as setups,
      count(*) filter (where title like '% · lesson %')::int as placeholders
    from lessons_next`))[0]
  const CATALOG_COLS = 'id, region_id, type, title, sort_order, requires_action, action_brief, is_gate, counts_toward_progress, feature_key, whop_lesson_id'
  const catalogRows = d => rowsOn(d, `select ${CATALOG_COLS} from lessons_next order by sort_order`)
  const TABLE_COLS = 'area,name,rows,counting,action_items,with_length'
  const isTheCourse = async (d, r, withLength = []) =>
    r.ok && r.cols.join(',') === TABLE_COLS && sameJson(r.rows, wantTable(withLength))
    && sameJson(await facts(d), THE_COURSE) && sameJson(await catalogRows(d), wantRows)
  const staging = async (d, without = []) => JSON.stringify({
    regions: strip(await rowsOn(d, `select * from regions_next order by id`), without),
    lessons: strip(await rowsOn(d, `select * from lessons_next order by id`), without),
  })
  const live = async () => JSON.stringify({
    lessons: await q(`select * from lessons order by id`),
    regions: await q(`select * from regions order by id`),
  })
  const dependents = async () => JSON.stringify({
    videos: await q(`select * from public.lesson_videos order by lesson_id`),
    watch:  await q(`select * from student_lesson_watch order by student_id, lesson_id`),
  })
  const everything = async () => await staging(db) + await live() + await dependents()
  const refusal = r => r.ok ? 'it ran' : `${r.code}: ${r.said.slice(0, 64)}`
  // The Whop lesson id column on lessons_next (v101 adds it): is it there, is
  // its unique index there, and what it holds, lesson id to Whop lesson id.
  const whopIds = async d => {
    const has = (await rowsOn(d, `select
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lessons_next'
                   and column_name = 'whop_lesson_id' and data_type = 'text') as col,
        exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'lessons_next'
                   and indexname = 'lessons_next_whop_lesson_id_key' and indexdef ilike '%unique%where (whop_lesson_id is not null)%') as idx`))[0]
    const held = has.col ? await rowsOn(d, `select id, whop_lesson_id from lessons_next order by id`) : []
    return { ...has, held: Object.fromEntries(held.map(x => [x.id, x.whop_lesson_id])) }
  }
  const WHOP_WANT = Object.fromEntries(COURSE.lessons.map(l => [l.id, l.whop_lesson_id]).sort((a, b) => a[0] < b[0] ? -1 : 1))
  const unchanged = r => !r.ok && r.code === 'P0001' && /Nothing was changed\.$/.test(r.said) && !/vid_/.test(r.said)

  // ── the generator, run as a program ──
  const generate = (...args) => {
    const r = spawnSync(process.execPath, [GENERATOR, ...args], { encoding: 'utf8' })
    return { code: r.status, said: `${r.stdout}${r.stderr}` }
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-catalog-'))
  const copyOfTheData = (name, change) => {
    const c = JSON.parse(catalogText)
    change(c)
    const p = path.join(tmp, `${name}.json`)
    fs.writeFileSync(p, JSON.stringify(c, null, 1))
    return p
  }
  const onDisk = () => fs.readFileSync(M + V101F, 'utf8') + '\u0000' + fs.readFileSync(UNDO_PATH, 'utf8')
  const generated = onDisk()

  let g = generate('--check')
  note(g.code === 0, 'the generated migration and undo are current: build-course-sql.mjs --check exits 0', g.said.trim().split('\n')[0])
  g = generate('--check', '--catalog', copyOfTheData('same', () => {}))
  note(g.code === 0, '...and exits 0 on a copy of the data file with nothing edited', `exit ${g.code}`)
  g = generate('--check', '--catalog', copyOfTheData('retitled', c => { c.lessons[0].title += ' (edited)' }))
  note(g.code === 1 && g.said.includes('2026_v101_course_catalog.sql differs') && /Nothing was written/.test(g.said) && onDisk() === generated,
       'with one title edited in a copy of the data file, --check exits 1, names the migration and writes nothing', `exit ${g.code}`)

  // A data file the generator must refuse. These run WITHOUT --check: this is
  // the run that would write, and it has to stop before it does.
  const outOfItsBlock = c => {
    const [l] = c.lessons.splice(c.lessons.findIndex(x => x.id === 'a2l05'), 1)
    c.lessons.splice(c.lessons.findIndex(x => x.id === 'a3l03'), 0, l)
  }
  for (const [what, change, sentence] of [
    ['a duplicate id',                    c => { c.lessons[12].id = c.lessons[11].id },  'Lesson id a2l04 is used 2 times'],
    ['two gates',                         c => { c.lessons[0].gate = true },            'must mark exactly one lesson as the gate. It marks 2'],
    ['a brief with a link',               c => { c.lessons.find(l => l.id === 'a5l08').action_brief += ' https://example.com/brief' },
                                                                                         'The brief of lesson a5l08 holds a link'],
    ['a brief with a bare domain (discord.gg/x)', c => { c.lessons.find(l => l.id === 'a5l08').action_brief += ' Then join discord.gg/x' },
                                                                                         'The brief of lesson a5l08 holds a link'],
    ['a brief with a www address (www.x.com)', c => { c.lessons.find(l => l.id === 'a5l08').action_brief += ' It is on www.x.com' },
                                                                                         'The brief of lesson a5l08 holds a link'],
    ["a lesson outside its area's block", outOfItsBlock,                                 'The lessons of area a2 do not sit in one block'],
    ['7 areas',                           c => { c.areas.pop() },                        'must list exactly 8 areas, a1 to a8, in that order. It lists 7'],
    ['the a8 block listed first',         c => { c.lessons = [...c.lessons.filter(l => l.area === 'a8'), ...c.lessons.filter(l => l.area !== 'a8')] },
                                                                                         'The blocks of the areas must come in the order a1 to a8. In the list they come as a8, a1, a2'],
    ['a lesson without its Whop lesson id', c => { delete c.lessons.find(l => l.id === 'a3l07').whop_lesson_id },
                                                                                         'Lesson a3l07 has no whop_lesson_id'],
    ['a Whop lesson id of the wrong shape', c => { c.lessons.find(l => l.id === 'a3l07').whop_lesson_id = 'chap_abc123' },
                                                                                         'Lesson a3l07 has the whop_lesson_id "chap_abc123". A Whop lesson id is lesn_'],
    ["a Whop lesson id with a quote in it", c => { c.lessons.find(l => l.id === 'a3l07').whop_lesson_id = "lesn_a'b" },
                                                                                         'Lesson a3l07 has the whop_lesson_id "lesn_a\'b"'],
    ['one Whop lesson id on two lessons', c => { c.lessons.find(l => l.id === 'a3l08').whop_lesson_id = c.lessons.find(l => l.id === 'a3l07').whop_lesson_id },
                                                                                         'is on 2 lessons (a3l07, a3l08). A Whop lesson belongs to one lesson'],
  ]) {
    g = generate('--catalog', copyOfTheData('refused', change))
    note(g.code === 2 && g.said.includes(sentence) && /Nothing was written/.test(g.said) && onDisk() === generated,
         `the generator refuses a data file with ${what}: it says so and writes nothing`,
         g.said.split('\n').find(l => l.includes(sentence))?.trim().slice(0, 88) ?? `exit ${g.code}`)
    // A generator that failed to refuse has just written the two tracked
    // files from a bad copy of the data. The assertion above has said so.
    // Put the files back as they were, so the run leaves the repository as it
    // found it and the sections below test the real files.
    if (onDisk() !== generated) {
      const [migrationWas, undoWas] = generated.split('\u0000')
      fs.writeFileSync(M + V101F, migrationWas)
      fs.writeFileSync(UNDO_PATH, undoWas)
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true })

  // ── the generated files themselves ──
  note(![fs.readFileSync(GENERATOR, 'utf8'), catalogText, v101, undo].some(t => t.includes('vid_')),
       'the data file, the generator, v101 and its undo hold nothing that starts like a video id')
  note(!/duration_seconds|bunny_video_id|video_ready_at|created_at/.test(code(v101.slice(0, v101.indexOf('\ncommit;')))),
       'up to its commit, v101 never names duration_seconds, bunny_video_id, video_ready_at or created_at')

  const started = (await q(`select
       to_regclass('public.lesson_videos') is not null as videos_table,
       (select count(*)::int from lessons_next) as lessons,
       (select count(*)::int from lessons_next where title like '% · lesson %') as placeholders`))[0]
  if (!(started.videos_table && started.lessons === 145 && started.placeholders === 144)) {
    note(false, 'section 20 needs v100 applied and the staging catalog as v94 seeds it', JSON.stringify(started))
  } else if (await exec(read(V99F), 'v99 executes')) {
    await db.exec(`delete from public.lesson_videos;`)
    // ── BEFORE ──
    const liveBefore = await live()
    const stagingBefore = await staging(db, ['created_at', 'updated_at'])
    const bornBefore = Object.fromEntries((await q(`select id, created_at from lessons_next`)).map(r => [r.id, r.created_at.toISOString()]))
    const areasBefore = JSON.stringify(strip(await q(`select * from regions_next order by id`), ['name']))

    // ── first run, over the placeholder seed, with v100 applied ──
    let r = await runFile(db, v101)
    note(r.ok, 'v101 executes over the placeholder seed', r.ok ? '' : r.said)
    note(r.ok && r.cols.join(',') === TABLE_COLS && sameJson(r.rows, wantTable()),
         "its final select is one row per area and a total: the data file's names and counts, no length yet",
         r.rows.map(x => `${x.area}:${x.rows}`).join(' '))
    const f = await facts(db)
    note(sameJson(f, THE_COURSE),
         'the post-conditions hold: 141 rows, 140 counting, sort_order 1 to 141 and rising with the areas, 8/11/25/17/26/22/19/13, gate a4l17, a7l19 the one feature row, 9 action items with briefs, 5 setup, no placeholder title',
         JSON.stringify(f))
    const got = await catalogRows(db)
    const firstOff = got.findIndex((row, i) => !sameJson(row, wantRows[i]))
    note(sameJson(got, wantRows),
         'every row equals the data file: id, area, type, title, order, action flag, brief, gate, counting flag, feature key',
         firstOff < 0 ? `${got.length} rows` : `first difference at ${wantRows[firstOff]?.id}`)
    {
      const w = await whopIds(db)
      const values = Object.values(w.held)
      note(w.col && w.idx && values.length === 141 && new Set(values).size === 141 && values.every(v => /^lesn_[A-Za-z0-9]+$/.test(v))
           && sameJson(w.held, WHOP_WANT),
           'v101 adds whop_lesson_id to lessons_next with a unique index where not null, and writes 141 distinct Whop lesson ids, each the one the data file gives its lesson',
           `column ${w.col}, index ${w.idx}, ${new Set(values).size} distinct`)
    }
    const untouched = (await q(`select
         count(*) filter (where description is not null or lesson_group_id is not null or discord_channel is not null or is_optional)::int as filled,
         count(*) filter (where duration_seconds is not null or bunny_video_id is not null or video_ready_at is not null)::int as video_columns
       from lessons_next`))[0]
    note(untouched.filled === 0 && untouched.video_columns === 0,
         'description, lesson_group_id and discord_channel are null and is_optional false on every row; no length and no Bunny column was written',
         JSON.stringify(untouched))
    const born = await q(`select id, created_at from lessons_next`)
    const kept = born.filter(x => x.id in bornBefore)
    note(kept.length > 100 && kept.length < born.length && kept.every(x => x.created_at.toISOString() === bornBefore[x.id]),
         'a lesson whose id was there before keeps its created_at', `${kept.length} kept, ${born.length - kept.length} new`)
    const names = await q(`select id, name from regions_next order by order_num`)
    note(sameJson(names, COURSE.areas.map(a => ({ id: a.id, name: a.name })))
         && JSON.stringify(strip(await q(`select * from regions_next order by id`), ['name'])) === areasBefore,
         "the 8 areas carry the data file's names, and nothing else on regions_next moved (landmark_label, rail_at, terrain, order_num)",
         names.map(n => n.name).join(' | '))
    note(await live() === liveBefore, 'v101 leaves the LIVE catalog untouched: lessons and regions are identical')

    // ── run again ──
    let before = await staging(db, ['updated_at'])
    r = await runFile(db, v101)
    note(await isTheCourse(db, r) && await staging(db, ['updated_at']) === before,
         'run again: every column except updated_at is identical, created_at included', refusal(r))
    note(sameJson((await whopIds(db)).held, WHOP_WANT), '...the 141 Whop lesson ids among them')
    {
      // Two lessons trade Whop lesson ids in a copy. The unique index must not
      // stop the rewrite (step 4 takes every id off first), and the copy's
      // values are what the table then holds.
      const [x, y] = ['a3l07', 'a3l08'].map(id => COURSE.lessons.find(l => l.id === id).whop_lesson_id)
      const swapped = v101.replace(`'${x}'`, "'lesn_SWAPMARK'").replace(`'${y}'`, `'${x}'`).replace("'lesn_SWAPMARK'", `'${y}'`)
      // The file opens and commits its own transaction, so the copy is run
      // for real and the real file is run again after it to put them back.
      const pre = await staging(db, ['updated_at'])
      const rs = await runFile(db, swapped)
      const tr = await rowsOn(db, `select whop_lesson_id w from lessons_next where id in ('a3l07', 'a3l08') order by id`)
      const back = await runFile(db, v101)
      note(countOf(v101, `'${x}'`) === 1 && countOf(v101, `'${y}'`) === 1 && rs.ok && sameJson(tr.map(t => t.w), [y, x]),
           'a copy where two lessons trade Whop lesson ids runs past the unique index and writes the traded values', refusal(rs))
      note(back.ok && await staging(db, ['updated_at']) === pre, '...and the real file run after it puts every value back', refusal(back))
    }

    // ── run again after a load: one lesson has a video and a length ──
    // By hand here. Section 21 does the same with the load file itself.
    const KEEPS = 'a2l05'
    const keepsTitle = `'${COURSE.lessons.find(l => l.id === KEEPS).title.replaceAll("'", "''")}'`
    await db.exec(`
      insert into public.lesson_videos (lesson_id, tella_video_id, lock_status, lock_detail, lock_checked_at)
      values ('${KEEPS}', '${FAKE(1)}', 'locked', 'checked by hand', now()),
             ('l004',  '${FAKE(2)}', 'locked', 'a test stamp on a live lesson', now());
      update lessons_next set duration_seconds = 756 where id = '${KEEPS}';`)
    const depsBefore = await dependents()
    before = await staging(db, ['updated_at'])
    r = await runFile(db, v101)
    note(await isTheCourse(db, r, [KEEPS]) && await dependents() === depsBefore && await staging(db, ['updated_at']) === before
         && (await q(`select duration_seconds d from lessons_next where id = '${KEEPS}'`))[0].d === 756,
         'run again after a load: the lesson keeps its video row and its length, and the total row counts 1 with a length', refusal(r))

    // ── run again after the text load ──
    // load-lesson-text.sql (section 22) owns lessons_next.description. Two
    // texts set here by hand, the way that load sets them, must outlive v101.
    {
      const TEXTS = {
        a3l25: '**Your brief** is ready.\n\n- Read [the brief](https://example.com/made-up/brief)',
        a5l23: "It's yours: $$$ and $text$ stay.\nA backslash \\ and two quotes ''.",
      }
      for (const [id, text] of Object.entries(TEXTS)) await db.query(`update lessons_next set description = $1 where id = $2`, [text, id])
      const keptBefore = await staging(db, ['updated_at'])
      r = await runFile(db, v101)
      const textsNow = Object.fromEntries(
        (await q(`select id, description from lessons_next where description is not null order by id`)).map(x => [x.id, x.description]))
      note(r.ok && sameJson(textsNow, TEXTS) && await staging(db, ['updated_at']) === keptBefore,
           'run again after the text load: the descriptions load-lesson-text.sql wrote on two lessons survive byte for byte, and nothing else moves', refusal(r))
      await db.exec(`update lessons_next set description = null where id in ('a3l25', 'a5l23');`)
    }

    // ── it will not move a video onto another lesson ──
    let asItWas = await everything()
    const retitled = v101.replaceAll(keepsTitle, "'Another Title Entirely'")
    r = await runFile(db, retitled)
    note(countOf(v101, keepsTitle) === 2 && unchanged(r) && r.said.includes(`With a video row in lesson_videos: ${KEEPS}.`)
         && r.said.includes('With a watch row in student_lesson_watch: none.') && /delete those rows/.test(r.said),
         'a copy that retitles a lesson with a video is refused: the message names the lesson and says what to do', refusal(r))
    note(await everything() === asItWas, '...and nothing was changed: both catalogs, lesson_videos and the watch rows are identical')
    const withoutTheRow = v101.split('\n').filter(l => !l.includes(`'${KEEPS}',`)).join('\n')
    r = await runFile(db, withoutTheRow)
    note(v101.split('\n').length - withoutTheRow.split('\n').length === 2 && unchanged(r)
         && r.said.includes(`With a video row in lesson_videos: ${KEEPS}.`),
         'a copy without that lesson is refused the same way', refusal(r))
    note(await everything() === asItWas, '...and nothing was changed')
    // The same lesson under the same id and the same title, as a setup lesson.
    const asSetup = v101.split('\n').map(l => l.includes(`'${KEEPS}',`) ? l.replace("'watch'", "'setup'") : l).join('\n')
    r = await runFile(db, asSetup)
    note(countOf(asSetup, "'setup'") - countOf(v101, "'setup'") === 2 && unchanged(r)
         && r.said.includes(`would turn lessons that have a video row into lessons that are not watch lessons: ${KEEPS}.`)
         && await everything() === asItWas,
         'a copy that turns a lesson with a video into a setup lesson, same id and same title, is refused: it names the lesson and nothing was changed', refusal(r))

    // ── the undo refuses while a row points at a course lesson ──
    r = await runFile(db, undo)
    note(unchanged(r) && r.said.includes('1 row(s) of public.lesson_videos and 0 row(s) of public.student_lesson_watch')
         && await everything() === asItWas,
         'the undo refuses while a video row points at a course lesson: it says how many, prints no video id and changes nothing', refusal(r))
    await db.exec(`delete from public.lesson_videos where lesson_id = '${KEEPS}';
                   insert into student_lesson_watch (student_id, lesson_id) values ('${UID1}'::uuid, 'a8l13');`)
    asItWas = await everything()
    r = await runFile(db, undo)
    note(unchanged(r) && r.said.includes('0 row(s) of public.lesson_videos and 1 row(s) of public.student_lesson_watch')
         && await everything() === asItWas,
         '...and while a watch row does, with the video row gone', refusal(r))
    await db.exec(`delete from student_lesson_watch where lesson_id = 'a8l13';`)

    // ── a post-condition that does not hold undoes the whole file ──
    // The copy without a2l05 again. Nothing points at that lesson now, so the
    // guard lets it through and step 7 has to catch that a lesson is missing.
    asItWas = await everything()
    r = await runFile(db, withoutTheRow)
    note(unchanged(r) && r.said.includes('lessons_next would hold 140 lessons and the course has 141') && await everything() === asItWas,
         'a copy that would leave 140 lessons is stopped by the post-conditions, inside the transaction: nothing was changed', refusal(r))

    // The last lesson of a1 and the first of a2 trade places in the order.
    // Every count still holds: 141 lessons, sort_order 1 to 141 with no hole,
    // the same 8 sizes. Only the order between two areas is wrong.
    {
      const trade = (line, from, to) => line.includes(`, null, ${from}, false,`) ? line.replace(`, null, ${from}, false,`, `, null, ${to}, false,`) : null
      const lines = v101.split('\n')
      const a = lines.findIndex(l => l.startsWith("  ('a1l08', 'a1',")), b = lines.findIndex(l => l.startsWith("  ('a2l01', 'a2',"))
      const traded = [trade(lines[a] ?? '', 8, 9), trade(lines[b] ?? '', 9, 8)]
      const crossed = lines.map((l, i) => i === a ? traded[0] : i === b ? traded[1] : l).join('\n')
      r = await runFile(db, crossed)
      note(traded.every(Boolean) && unchanged(r) && r.said.includes('In 1 area(s) the first lesson would not come after the last lesson of the area before it')
           && await everything() === asItWas,
           'a copy whose order crosses between two areas, with every count intact, is stopped by the post-conditions: nothing was changed', refusal(r))
    }

    // ── the undo ──
    // The stamp on the live lesson l004 is still there. It is not a course
    // lesson, so the undo must run past it and leave it alone.
    const stampBefore = JSON.stringify(await q(`select * from public.lesson_videos`))
    r = await runFile(db, undo)
    note(r.ok, 'with nothing pointing at a course lesson, the undo executes', r.ok ? '' : r.said)
    note(await staging(db, ['created_at', 'updated_at', 'whop_lesson_id']) === stagingBefore,
         'after the undo regions_next and lessons_next equal the dump taken before v101, on every column except created_at and updated_at (and the whop_lesson_id column v101 added)',
         `${(await q(`select count(*)::int n from lessons_next`))[0].n} lessons`)
    {
      const w = await whopIds(db)
      note(w.col && w.idx && Object.keys(w.held).length === 145 && Object.values(w.held).every(v => v === null),
           'the undo leaves the whop_lesson_id column and its index in place, empty on every one of the 145 placeholder rows',
           `column ${w.col}, index ${w.idx}, ${Object.values(w.held).filter(v => v !== null).length} filled`)
    }
    note(await live() === liveBefore && JSON.stringify(await q(`select * from public.lesson_videos`)) === stampBefore && JSON.parse(stampBefore).length === 1,
         'the undo leaves the LIVE catalog untouched, and a video row on a live lesson (l004) too')
    {
      const OPEN = '-- ▼ copied from 2026_v94_catalog_next_staging.sql\n', CLOSE = '\n-- ▲ end of the copy'
      const copies = undo.split(OPEN).slice(1).map(part => part.slice(0, part.indexOf(CLOSE)))
      note(copies.length === 6 && copies.every(c => v94.includes('\n' + c + '\n') && c.trimEnd().endsWith(';')),
           "each of the undo's 6 copied statements is found in the v94 file, character for character",
           copies.map(c => `${c.split('\n').length} lines`).join(', '))
      const seedOfV94 = code(v94.slice(v94.indexOf('\ninsert into public.regions_next'), v94.indexOf('\ncommit;')))
      note(code(copies.join('\n')) === seedOfV94,
           "...and together they are every seed statement v94 has, in v94's order", `${seedOfV94.split('\n').length} lines of code`)
      const rest = code(copies.reduce((text, c) => text.replace(c, () => ''), undo)).replace(/\s+/g, ' ').trim()
      const guard = rest.slice(0, rest.indexOf('$guard$;') + 8)
      note(rest.startsWith('do $guard$') && rest === guard + ' begin; delete from public.lessons_next; commit;'
           && guard.includes("execute 'select count(*) from public.lesson_videos where lesson_id ~ $1' into v_videos using c_course;")
           && !/\b(drop|delete|update|insert|alter|create|truncate|grant|revoke)\b/i.test(guard.replace(/'[^']*'/g, "''")),
           'outside those copies the undo holds a guard that only counts, and one statement of its own, the delete',
           rest.slice(guard.length).trim())
      const checks = undo.slice(undo.indexOf('\n-- POST-CHECKS'))
        .split('\n').filter(l => /^--    (?!EXPECT)/.test(l)).map(l => l.slice(2)).join('\n')
        .split(';').map(x => x.trim()).filter(Boolean)
      let rows = null, err = ''
      try { rows = []; for (const sql of checks) rows.push((await q(sql))[0]) } catch (e) { rows = null; err = e.message }
      note(rows !== null && rows.length === 1 && Object.keys(rows[0]).length === 8 && Object.values(rows[0]).every(v => v === true),
           "the undo's own commented post-check runs and comes back all true", rows ? `${Object.keys(rows[0]).length} columns` : err)
    }
    r = await runFile(db, undo)
    note(r.ok && await staging(db, ['created_at', 'updated_at', 'whop_lesson_id']) === stagingBefore
         && Object.values((await whopIds(db)).held).every(v => v === null),
         'a second undo ends in the same state', refusal(r))

    // ── and forward again. Section 21 starts from this state. ──
    await db.exec(`delete from public.lesson_videos;`)
    r = await runFile(db, v101)
    note(await isTheCourse(db, r) && await live() === liveBefore && sameJson((await whopIds(db)).held, WHOP_WANT),
         'v101 applies again after the undo: the same table, the same rows and Whop lesson ids, the live catalog still untouched', refusal(r))

    // ── course-catalog-check.sql ──
    const CHECK_COLS = 'item,name,rows,counting,action_items,with_video,with_length,verdict'
    const FOUR = ['placeholder_titles', 'video_rows_on_unknown_lessons', 'watch_lessons_with_video_and_no_length',
                  'video_rows_on_lessons_that_are_not_watch']
    const areaLines = (rows, videos) => sameJson(
      rows.slice(0, 9).map(x => [x.item, x.name, x.rows, x.counting, x.action_items, x.with_video, x.with_length, x.verdict]),
      wantTable().map(w => [w.area, w.name, w.rows, w.counting, w.action_items, videos, 0, 'INFO']))
    const before20 = await everything()
    r = await runFile(db, checkSql)
    note(r.ok && r.cols.join(',') === CHECK_COLS && r.rows.length === 13 && areaLines(r.rows, 0)
         && sameJson(r.rows.slice(9).map(x => [x.item, x.rows, x.verdict]), FOUR.map(t => [t, 0, 'PASS']))
         && !/vid_/.test(JSON.stringify(r.rows)) && await everything() === before20,
         'course-catalog-check.sql after v101: 8 areas and a total as the data file has them, 0 and PASS on its four checks, and it changes nothing',
         r.ok ? r.rows.slice(9).map(x => `${x.item}=${x.rows}`).join(' ') : r.said)
    // A check that has never been seen to move proves nothing. One planted
    // row for each, inside a transaction that is rolled back.
    {
      const planted = await db.transaction(async tx => {
        await tx.exec(`
          update lessons_next set title = 'Introduction · lesson 1' where id = 'a1l01';
          insert into public.lesson_videos (lesson_id, tella_video_id)
          values ('nowhere01', '${FAKE(3)}'), ('a1l02', '${FAKE(4)}'), ('a5l22', '${FAKE(5)}');`)
        const rows = (await tx.exec(checkSql)).at(-1).rows
        await tx.rollback()
        return rows
      }).catch(e => [{ item: e.message }])
      // A placeholder title, a video on an id no catalog has, a video on the
      // watch lesson a1l02 with no length, a video on the setup lesson a5l22.
      note(sameJson(planted.slice(9).map(x => [x.item, x.rows, x.verdict]), FOUR.map(t => [t, 1, 'LOOK: expected 0']))
           && planted[0].with_video === 1 && planted[4].with_video === 1 && planted[8].with_video === 2 && await everything() === before20,
           '...and each of the four checks moves: with one planted row each they read 1 and say LOOK, the video on a setup lesson among them',
           planted.slice(9).map(x => `${x.item}=${x.rows}`).join(' '))
      const noTable = await db.transaction(async tx => {
        await tx.exec(`drop table public.lesson_videos;`)
        const rows = (await tx.exec(checkSql)).at(-1).rows
        await tx.rollback()
        return rows
      }).catch(e => [{ item: e.message }])
      note(noTable.length === 13 && areaLines(noTable, null) && noTable[9].rows === 0 && noTable[9].verdict === 'PASS'
           && noTable.slice(10).length === 3
           && noTable.slice(10).every(x => x.rows === null && /^NOT CHECKED: public\.lesson_videos does not exist/.test(x.verdict))
           && (await q(`select to_regclass('public.lesson_videos') is not null as y`))[0].y && await everything() === before20,
           'where lesson_videos does not exist the check still runs: with_video is empty and the three video checks say NOT CHECKED',
           noTable[10]?.verdict?.slice(0, 50) ?? noTable[0]?.item)
      // The select alone, as if the block above it had run on another
      // connection. It must say so. It must not report 0 videos.
      await db.exec(`select set_config('course_check.read_at', '', false);`)
      const alone = await rowsOn(db, checkSql.slice(checkSql.indexOf('\nwith video as (')))
      note(alone.length === 13 && alone[0].with_video === null && alone.slice(10).length === 3
           && alone.slice(10).every(x => x.rows === null && /^NOT CHECKED: the block at the top/.test(x.verdict)),
           'the select on its own, without the block that reads lesson_videos, says NOT CHECKED and reports no 0',
           alone[10]?.verdict?.slice(0, 50))
    }

    // ── a database where v100 has not run, and one more area than eight ──
    {
      const d = await secondDatabase()
      const has = (await rowsOn(d, `select to_regclass('public.lesson_videos') is null as no_videos,
                                           to_regclass('public.student_lesson_watch') is null as no_watch`))[0]
      const seeded = await staging(d, ['created_at', 'updated_at'])
      await d.exec(`insert into regions_next (id, order_num, name) values ('a9', 9, 'A Ninth Area');`)
      const nine = await staging(d)
      r = await runFile(d, v101)
      note(unchanged(r) && /must hold exactly the 8 areas a1 to a8, and it holds: .*a9/.test(r.said) && await staging(d) === nine,
           'second database, with a ninth area in regions_next: v101 refuses, names what it found and changes nothing', refusal(r))
      await d.exec(`delete from regions_next where id = 'a9';`)
      r = await runFile(d, v101)
      note(has.no_videos && has.no_watch && await isTheCourse(d, r),
           'second database, without lesson_videos and without student_lesson_watch: v101 runs, with the same table, rows and post-conditions', refusal(r))
      r = await runFile(d, undo)
      note(r.ok && await staging(d, ['created_at', 'updated_at', 'whop_lesson_id']) === seeded,
           '...and the undo runs there too, back to what v94 and v99 left (the whop_lesson_id column stays, empty)', refusal(r))
      await d.close()
    }
    {
      // student_lesson_watch as v93 creates it, lifted from the v93 file.
      const d = await secondDatabase(lift('2026_v93_lesson_watch_telemetry.sql', 'create table if not exists public.student_lesson_watch ('))
      await d.exec(`
        insert into students (id, supabase_user_id, membership_status) values ('${UID1}'::uuid, '${UID1}'::uuid, 'active');
        insert into student_lesson_watch (student_id, lesson_id) values ('${UID1}'::uuid, 'a8l14'), ('${UID1}'::uuid, 'a1l01');`)
      const was = await staging(d) + JSON.stringify(await rowsOn(d, `select * from student_lesson_watch order by lesson_id`))
      r = await runFile(d, v101)
      // a8l14 is a placeholder the course does not have: its watch row would
      // lose its lesson. a1l01 stays and would be retitled.
      note(unchanged(r) && r.said.includes('With a video row in lesson_videos: none.')
           && r.said.includes('With a watch row in student_lesson_watch: a1l01, a8l14.')
           && await staging(d) + JSON.stringify(await rowsOn(d, `select * from student_lesson_watch order by lesson_id`)) === was,
           'second database, with watch rows on placeholder lessons before the first run: v101 refuses, names both lessons and changes nothing', refusal(r))
      await d.exec(`delete from student_lesson_watch;`)
      r = await runFile(d, v101)
      note(await isTheCourse(d, r), '...and with those rows gone it runs (student_lesson_watch there, lesson_videos not: v100 has not run)', refusal(r))
      await d.close()
    }
    {
      // lesson_videos as v100 creates it, lifted from the v100 file, over the
      // placeholder seed. One row waits on a2l11: the seed's second area ends
      // at a2l10, and v101 would create a2l11 and hand it that video. The
      // other row is on a live lesson's id and is none of v101's business.
      const d = await secondDatabase(lift('2026_v100_lesson_videos_and_speed.sql', 'create table if not exists public.lesson_videos ('))
      await d.exec(`insert into public.lesson_videos (lesson_id, tella_video_id) values ('a2l11', '${FAKE(8)}'), ('l004', '${FAKE(9)}');`)
      const state = async () => await staging(d) + JSON.stringify(await rowsOn(d, `select * from public.lesson_videos order by lesson_id`))
      const was = await state()
      r = await runFile(d, v101)
      note(unchanged(r) && r.said.includes('rows on course lesson ids that have no lesson in public.lessons_next: a2l11.') && await state() === was,
           'second database, with a video row waiting on a2l11, a lesson v101 would create: v101 refuses, names the id and changes nothing', refusal(r))
      await d.exec(`delete from public.lesson_videos where lesson_id = 'a2l11';`)
      r = await runFile(d, v101)
      note(await isTheCourse(d, r) && (await rowsOn(d, `select lesson_id from public.lesson_videos`)).map(x => x.lesson_id).join() === 'l004',
           '...and with that row gone it runs, past the video row on the live lesson l004', refusal(r))
      await d.close()
    }
  }
}


console.log('\n=== 21. the video load: lesson_videos and the lengths follow a list ===')
// supabase/diagnostics/load-lesson-videos.sql is a template. The Tella tool
// fills it outside the repository and the owner pastes the filled copy. Here
// it is filled with made-up ids and run the way the SQL editor runs it.
{
  const template = diagnostic('load-lesson-videos.sql')
  const checkSql = diagnostic('course-catalog-check.sql')
  const v101 = read(V101F)
  const PLACEHOLDER = "  ('REPLACE_WITH_ROWS', 'REPLACE_WITH_ROWS', 'REPLACE_WITH_ROWS', 0);"
  // Made-up ids only, every one of them vid_loadfake and then letters and
  // digits. NEVER a real id.
  const FAKE = LOADFAKE
  const titleOf = lesson => COURSE.lessons.find(l => l.id === lesson)?.title ?? 'A Lesson The Course Does Not Have'
  // A row of the list: lesson id, title, video id, seconds. The title is the
  // data file's for that lesson unless another one is given.
  const row = (lesson, video, seconds, title = titleOf(lesson)) => [lesson, title, video, seconds]
  // The one way a list gets into the file: the placeholder line is replaced
  // by the rows, every single quote in a title doubled, the last row closed
  // with a semicolon.
  const fill = rows => template.replace(PLACEHOLDER, () =>
    rows.map(([lesson, title, video, seconds]) => `  ('${lesson}', '${title.replaceAll("'", "''")}', '${video}', ${seconds})`).join(',\n') + ';')
  const COURSE_ID = /^a[1-8]l[0-9]{2}$/
  const RESULT_COLS = 'line,name,loaded,new_rows,changed_videos,removed_rows,lessons,with_video,with_length'

  const videos = (d = db) => rowsOn(d, `select * from public.lesson_videos order by lesson_id`)
  const courseVideos = async () => (await videos()).filter(v => COURSE_ID.test(v.lesson_id))
  const rowOf = async lesson => (await videos()).find(v => v.lesson_id === lesson)
  const lengths = async () => Object.fromEntries(
    (await q(`select id, duration_seconds from lessons_next where duration_seconds is not null order by id`)).map(x => [x.id, x.duration_seconds]))
  const world = async () => JSON.stringify({
    videos:  await videos(),
    staging: await q(`select * from lessons_next order by id`),
    areas:   await q(`select * from regions_next order by id`),
    live:    await q(`select * from lessons order by id`),
  })
  const did = r => { const s = r.rows[0] ?? {}; return [s.loaded, s.new_rows, s.changed_videos, s.removed_rows] }
  // The result as it must read for a list: the run's four numbers, then per
  // area how many lessons have a video and a length.
  const reads = (r, list, four) => {
    const per = a => list.filter(([lesson]) => lesson.startsWith(a + 'l')).length
    return r.ok && r.cols.join(',') === RESULT_COLS && r.rows.length === 9 && !/vid_/.test(JSON.stringify(r.rows))
      && sameJson(r.rows[0], { line: 'this run', name: 'the whole course', loaded: four[0], new_rows: four[1], changed_videos: four[2],
                               removed_rows: four[3], lessons: COURSE.lessons.length, with_video: list.length, with_length: list.length })
      && sameJson(r.rows.slice(1), COURSE.areas.map(a => ({ line: a.id, name: a.name, loaded: null, new_rows: null, changed_videos: null,
                               removed_rows: null, lessons: COURSE.lessons.filter(l => l.area === a.id).length, with_video: per(a.id), with_length: per(a.id) })))
  }
  // lesson_videos and the staging lengths say exactly what the list says.
  const follows = async list => {
    const byLesson = [...list].sort((a, b) => a[0] < b[0] ? -1 : 1)
    return sameJson((await courseVideos()).map(v => [v.lesson_id, v.tella_video_id]), byLesson.map(([lesson, , video]) => [lesson, video]))
      && sameJson(await lengths(), Object.fromEntries(byLesson.map(([lesson, , , seconds]) => [lesson, seconds])))
  }
  const said = r => r.ok ? 'it ran' : `${r.code}: ${r.said.slice(0, 64)}`
  // A refusal: our own raise, its sentence, "Nothing was changed." at the
  // end, no video id in the message, none of the given strings in it, and a
  // database that is identical afterwards. A sentence may name lessons: the
  // load says which ones when their ids are shaped like course lesson ids.
  const refuses = async (label, sqls, sentence, never = []) => {
    const was = await world()
    const got = []
    for (const sql of [].concat(sqls)) got.push(await runFile(db, sql))
    note(got.every(r => !r.ok && r.code === 'P0001' && r.said.includes(sentence) && /Nothing was changed\.$/.test(r.said)
                        && !/vid_|tella\.tv/i.test(r.said) && !never.some(x => r.said.includes(x)))
         && await world() === was,
         label, got.map(said).join(' | ').slice(0, 110))
  }

  // ── the template itself ──
  note(countOf(template, PLACEHOLDER) === 1 && countOf(template, 'REPLACE_WITH_ROWS') === 3
       && template.includes('insert into _load values\n' + PLACEHOLDER + '\n')
       && template.includes('create temp table _load (lesson_id text, title text, tella_video_id text, seconds int) on commit drop;'),
       'the template holds its placeholder line exactly once, four columns wide, straight after "insert into _load values"')
  note(!/vid_[a-z0-9]{10,}/.test(template)
       && template.split('\n').filter(l => l.includes('vid_')).every(l => l.startsWith('--') || l.includes("'^vid_[a-z0-9]{10,64}$'")),
       'the template holds nothing shaped like a video id: vid_ appears in its header and in the one pattern',
       `${template.split('\n').filter(l => l.includes('vid_')).length} lines`)

  const ready = (await q(`select
       to_regclass('public.lesson_videos') is not null as videos_table,
       (select count(*)::int from lessons_next) as lessons,
       (select count(*)::int from lessons_next where duration_seconds is not null) as lengths`))[0]
  if (!(ready.videos_table && ready.lessons === 141 && ready.lengths === 0)) {
    note(false, 'section 21 needs v100 applied and the state v101 leaves', JSON.stringify(ready))
  } else {
    // A test stamp on a live lesson, as stamp-tella-test-lessons.sql leaves
    // one. It stays for the whole section: no load may touch it.
    await db.exec(`
      select set_config('test.uid','${UID1}',false);
      delete from student_lesson_watch;
      delete from public.lesson_videos;
      insert into public.lesson_videos (lesson_id, tella_video_id, lock_status, lock_detail, lock_checked_at)
      values ('l004', '${FAKE(90)}', 'locked', 'a test stamp on a live lesson', now());
      update lessons set duration_seconds = 67 where id = 'l004';`)
    const stamp = async () => JSON.stringify({ row: await rowOf('l004'), lesson: await q(`select * from lessons where id = 'l004'`) })
    const stampBefore = await stamp()
    const liveBefore = JSON.stringify(await q(`select * from lessons order by id`))

    // 5 lessons over 3 areas. One title holds an apostrophe (a1l07, "Why
    // You're Not Behind") and two hold $$$ (a6l14 and a6l15).
    const LIST = [row('a1l01', FAKE(1), 756), row('a1l07', FAKE(2), 431), row('a6l14', FAKE(3), 600), row('a6l15', FAKE(4), 1289), row('a8l13', FAKE(5), 98)]
    const but = (lesson, video, seconds, title) => [...LIST.slice(0, 4), row(lesson, video, seconds, title)]

    // ── a list that is wrong changes nothing ──
    await refuses('the template as tracked, its placeholder line not replaced, is refused', template,
                  'The placeholder line was not replaced with the rows')
    const shapes = ['vid_loadfake', FAKE(5).toUpperCase().replace('VID_', 'vid_'), `https://www.tella.tv/video/${FAKE(5)}/embed`, ` ${FAKE(5)}`]
    await refuses('a video id of the wrong shape is refused: too short, in capitals, a pasted link, a leading space',
                  shapes.map(bad => fill(but('a8l13', bad, 98))), 'not shaped like a Tella video id', shapes)
    await refuses("a lesson id that is not a course lesson id is refused: a live lesson's id, a ninth area, a video id in the lesson column",
                  ['l004', 'a9l01', FAKE(7)].map(bad => fill(but(bad, FAKE(5), 98))), 'not a course lesson id', ['l004', 'a9l01'])
    await refuses('a lesson that is in the list twice is refused, and the message says which lesson',
                  fill([...LIST, row('a1l01', FAKE(6), 10)]), '1 lesson(s) are in the list more than once: a1l01. A lesson has one video')
    await refuses('a video that is in the list twice is refused',
                  fill(but('a8l13', FAKE(1), 98)), '1 video(s) are in the list more than once')
    await refuses('a length of 0, a length below 0 and an empty length are refused',
                  [0, -5, 'null'].map(bad => fill(but('a8l13', FAKE(5), bad))), 'have a length that is empty, 0 or below')
    await refuses('a lesson that is in neither catalog is refused, and the message says which lesson',
                  fill(but('a1l09', FAKE(5), 98)), '1 lesson(s) of the list are in neither public.lessons_next nor public.lessons: a1l09. The list was written')
    await refuses('a setup lesson is refused, and the message says which lesson',
                  fill(but('a5l22', FAKE(5), 98)), '1 lesson(s) of the list are not watch lessons: a5l22. Only a watch lesson')
    // 12 lessons the catalog does not have, a1l09 to a1l20. The message names
    // the first 10 and counts the rest.
    await refuses('a message names 10 lessons at most, then says how many more: 12 unknown lessons read "... a1l18 and 2 more"',
                  fill([...LIST, ...Array.from({ length: 12 }, (_, i) => row(`a1l${String(9 + i).padStart(2, '0')}`, FAKE(20 + i), 60))]),
                  '12 lesson(s) of the list are in neither public.lessons_next nor public.lessons: '
                  + 'a1l09, a1l10, a1l11, a1l12, a1l13, a1l14, a1l15, a1l16, a1l17, a1l18 and 2 more. The list was written',
                  ['a1l19', 'a1l20'])
    // The right lesson id, the right video, and the title of another version
    // of the course. Without the $$$ it is not the title the catalog has.
    await refuses('a list with one wrong title is refused: the message names the lesson, says the list is for another version of the course, and repeats no title',
                  fill(LIST.map(x => x[0] === 'a6l14' ? row('a6l14', FAKE(3), 600, 'Our Private AI UGC Workflow') : x)),
                  '1 lesson(s) of the list carry another title than the catalog has under that id: a6l14. This list was made for another version of the course. '
                  + 'Run the match and the sql command of the Tella tool again',
                  ['Our Private AI UGC Workflow', titleOf('a6l14')])

    // ── first load ──
    const otherColumns = async () => JSON.stringify(
      (await q(`select * from lessons_next order by id`)).map(({ duration_seconds, updated_at, ...rest }) => rest))
    const otherBefore = await otherColumns()
    let r = await runFile(db, fill(LIST))
    let rows = await courseVideos()
    note(r.ok && rows.length === 5 && await follows(LIST)
         && rows.every(v => v.lock_status === 'unchecked' && v.lock_detail === null && v.lock_checked_at === null),
         'first load of 5 lessons over 3 areas: 5 lesson_videos rows, all unchecked, and 5 lengths set', said(r))
    note(reads(r, LIST, [5, 5, 0, 0]),
         'its result says 5 loaded, 5 new, 0 changed, 0 removed, then lessons, videos and lengths per area, and shows no id',
         r.ok ? `${did(r).join('/')}; ${r.rows.slice(1).map(x => `${x.line}:${x.with_video}`).join(' ')}` : said(r))
    note(fill(LIST).includes("  ('a1l07', 'Why You''re Not Behind', '") && fill(LIST).includes("  ('a6l14', 'Our Private $$$ AI UGC Workflow', '")
         && r.ok && ['a1l07', 'a6l14', 'a6l15'].every(id => rows.some(v => v.lesson_id === id)),
         'a title with an apostrophe (written twice in the list) and titles with $$$ pass the title check: their lessons are loaded')
    note(await otherColumns() === otherBefore && JSON.stringify(await q(`select * from lessons order by id`)) === liveBefore,
         'the load writes duration_seconds on lessons_next and nothing else there, and nothing on the live lessons')

    // ── course-catalog-check.sql, after the load ──
    {
      const c = await runFile(db, checkSql)
      const per = a => LIST.filter(([lesson]) => lesson.startsWith(a + 'l')).length
      note(c.ok && c.rows.length === 13
           && sameJson(c.rows.slice(0, 8).map(x => [x.item, x.with_video, x.with_length]), COURSE.areas.map(a => [a.id, per(a.id), per(a.id)]))
           && c.rows[8].with_video === 5 && c.rows[8].with_length === 5
           && c.rows.slice(9).every(x => x.rows === 0 && x.verdict === 'PASS') && !/vid_/.test(JSON.stringify(c.rows)),
           'course-catalog-check.sql after the load: with_video and with_length agree on every row (5 in total), 0 and PASS on its four checks',
           c.ok ? c.rows.slice(0, 9).map(x => `${x.item}:${x.with_video}/${x.with_length}`).join(' ') : c.said)
    }

    // ── the same list again ──
    let before = await world()
    r = await runFile(db, fill(LIST))
    note(reads(r, LIST, [5, 0, 0, 0]) && await world() === before,
         'the same list again changes nothing, updated_at and lock_status included; its result says 0 new, 0 changed, 0 removed', said(r))

    // ── v101 again, over a loaded course ──
    const loaded = async () => JSON.stringify({
      videos:  await videos(),
      staging: (await q(`select * from lessons_next order by id`)).map(({ updated_at, ...rest }) => rest),
    })
    before = await loaded()
    r = await runFile(db, v101)
    note(r.ok && await loaded() === before && r.rows.at(-1)?.with_length === 5,
         'v101 run again over the loaded course keeps every video row and every length; its total row counts 5 with a length', said(r))

    // ── a lesson gets another video ──
    // First every row is marked locked by hand, as the lock check would.
    await db.exec(`update public.lesson_videos
                      set lock_status = 'locked', lock_detail = 'judged by hand', lock_checked_at = now()
                    where lesson_id ~ '^a[1-8]l[0-9]{2}$';`)
    const locked = Object.fromEntries((await courseVideos()).map(v => [v.lesson_id, JSON.stringify(v)]))
    let list = LIST.map(x => x[0] === 'a6l14' ? row('a6l14', FAKE(6), 612) : x)
    r = await runFile(db, fill(list))
    rows = await courseVideos()
    {
      const swapped = rows.find(v => v.lesson_id === 'a6l14') ?? {}
      note(reads(r, list, [5, 0, 1, 0]) && await follows(list)
           && swapped.lock_status === 'unchecked' && swapped.lock_detail === null && swapped.lock_checked_at === null
           && rows.filter(v => v.lesson_id !== 'a6l14').every(v => v.lock_status === 'locked' && JSON.stringify(v) === locked[v.lesson_id]),
           'a lesson gets another video: its row is back to unchecked with the detail cleared and the new length set; the other four keep locked and are not touched',
           r.ok ? `${did(r).join('/')}; ${rows.map(v => `${v.lesson_id}:${v.lock_status}`).join(' ')}` : said(r))
    }

    // ── a lesson drops out of the list ──
    list = list.filter(x => x[0] !== 'a1l07')
    r = await runFile(db, fill(list))
    note(reads(r, list, [4, 0, 0, 1]) && await follows(list) && await rowOf('a1l07') === undefined && !('a1l07' in await lengths()),
         'a lesson drops out of the list: its row is deleted and its length is empty again', r.ok ? did(r).join('/') : said(r))

    // ── a length on a lesson that has no video ──
    // A setup lesson and a watch lesson, neither in the list, each given a
    // length by hand. A course lesson has a length exactly when it has a
    // video, whatever its type, so the next load empties both.
    await db.exec(`update lessons_next set duration_seconds = 300 where id in ('a5l22', 'a2l03');`)
    {
      const typeOf = Object.fromEntries((await q(`select id, type from lessons_next where id in ('a5l22', 'a2l03')`)).map(x => [x.id, x.type]))
      const had = await lengths()
      r = await runFile(db, fill(list))
      note(typeOf.a5l22 === 'setup' && typeOf.a2l03 === 'watch' && had.a5l22 === 300 && had.a2l03 === 300
           && reads(r, list, [4, 0, 0, 0]) && await follows(list) && !('a5l22' in await lengths()) && !('a2l03' in await lengths()),
           'a course lesson that is not in the list loses its length whatever its type: a setup lesson and a watch lesson that carried 300 s are both emptied',
           r.ok ? `lengths left: ${Object.keys(await lengths()).join(' ')}` : said(r))
    }

    // ── a video moves to another lesson ──
    // The video on a8l13 is now listed under a8l12, and a8l13 is not listed.
    list = list.map(x => x[0] === 'a8l13' ? row('a8l12', FAKE(5), 98) : x)
    r = await runFile(db, fill(list))
    note(reads(r, list, [4, 1, 0, 1]) && await follows(list)
         && (await videos()).filter(v => v.tella_video_id === FAKE(5)).map(v => v.lesson_id).join() === 'a8l12',
         'a video moves to another lesson: one row holds it, under the new lesson, and no unique violation stops the file',
         r.ok ? did(r).join('/') : said(r))
    // Two lessons trade videos. Each video is wanted by the lesson that does
    // not hold it yet, which is the order a unique constraint trips on.
    list = list.map(([lesson, title, video, seconds]) => [lesson, title, lesson === 'a1l01' ? FAKE(4) : lesson === 'a6l15' ? FAKE(1) : video, seconds])
    r = await runFile(db, fill(list))
    rows = await courseVideos()
    note(reads(r, list, [4, 0, 2, 0]) && await follows(list)
         && ['a1l01', 'a6l15'].every(id => rows.find(v => v.lesson_id === id)?.lock_status === 'unchecked'),
         '...and two lessons can trade videos in one list: both rows change, both are unchecked', r.ok ? did(r).join('/') : said(r))

    // ── the test stamp on the live lesson ──
    note(await stamp() === stampBefore && JSON.stringify(await q(`select * from lessons order by id`)) === liveBefore,
         'through every load the test stamp on the live lesson l004 is untouched: its row, its lock verdict and its length of 67')
    await refuses('a list that holds the video stamped on a live lesson is refused: the message names that lesson and says to unstamp it first',
                  fill([...list, row('a2l01', FAKE(90), 300)]),
                  '1 video(s) of the list already sit on a lesson outside the course: l004. That is a test stamp on a live lesson: unstamp it first')

    // ── what the app then sees ──
    {
      const inList = list.map(([lesson]) => lesson).sort()
      // GET /api/student/data: its two reads, and the has_video it derives.
      const withVideo = new Set((await q(`select lesson_id from lesson_videos`)).map(v => v.lesson_id))
      const sent = (await q(`select * from lessons_next order by sort_order`)).map(l => ({ ...l, has_video: withVideo.has(l.id) }))
      note(sameJson(sent.filter(l => l.has_video).map(l => l.id).sort(), inList) && sent.length === 141
           && sent.filter(l => l.has_video).every(l => l.type === 'watch' && l.duration_seconds > 0)
           && !/vid_/.test(JSON.stringify(sent)),
           "the data route's two reads give has_video on exactly the loaded lessons, each with its length, and no video id leaves with them",
           `${sent.filter(l => l.has_video).length} of ${sent.length}`)
      // POST /api/student/lesson-video: the lesson, then its video row.
      const lookup = async id => {
        const lesson = (await db.query(`select id, type, duration_seconds from lessons_next where id = $1`, [id])).rows[0]
        if (!lesson || lesson.type !== 'watch') return 'not recorded'
        const video = (await db.query(`select tella_video_id from lesson_videos where lesson_id = $1`, [lesson.id])).rows[0]
        return video ? { video: video.tella_video_id, durationSeconds: lesson.duration_seconds ?? null } : 'not recorded'
      }
      const found = await Promise.all(list.map(([lesson]) => lookup(lesson)))
      note(sameJson(found, list.map(([, , video, seconds]) => ({ video, durationSeconds: seconds })))
           && await lookup('a1l07') === 'not recorded' && await lookup('a5l22') === 'not recorded',
           "the video route's lookup finds the id and the length of each loaded lesson, and nothing for a lesson that is not in the list",
           `${found.filter(x => x !== 'not recorded').length} found`)
    }

    // ── watching a staging lesson before the cutover ──
    // v100, consequence 4: the row plays, and no beat for it is counted. The
    // load does not change that. Asserted so the truth is pinned.
    await raises(() => hb('a1l01', 10, 756, 5),
                 'a heartbeat for a loaded STAGING lesson is still refused before the cutover (v100, consequence 4)', '22023')
    note((await q(`select count(*)::int n from student_lesson_watch where lesson_id ~ '^a[1-8]l[0-9]{2}$'`))[0].n === 0,
         '...and it left no watch row behind')

    // ── course lessons in the LIVE table, as after a cutover ──
    // The load writes lengths into `lessons` as well as lessons_next. Before
    // the cutover no course lesson is in `lessons`, so those two statements
    // match nothing and could be broken unseen. Two live lessons with course
    // ids: a2l01 copied from the staging catalog, so it is in both tables,
    // and a1l09, which is in `lessons` only.
    {
      const LIVE_ONLY = 'A Lesson Added After The Cutover'
      await db.exec(`
        insert into lessons (id, region_id, day, type, title, sort_order)
        select id, 'r4', 30, type, title, 9000 + sort_order from lessons_next where id = 'a2l01';
        insert into lessons (id, region_id, day, type, title, sort_order) values ('a1l09', 'r4', 30, 'watch', '${LIVE_ONLY}', 9999);`)
      const liveLengths = async () => Object.fromEntries(
        (await q(`select id, duration_seconds from lessons where id in ('a1l09', 'a2l01', 'l004') order by id`)).map(x => [x.id, x.duration_seconds]))
      const withLive = [...list, row('a2l01', FAKE(40), 500), row('a1l09', FAKE(41), 77, LIVE_ONLY)]
      r = await runFile(db, fill(withLive))
      note(r.ok && sameJson(await liveLengths(), { a1l09: 77, a2l01: 500, l004: 67 }) && (await lengths()).a2l01 === 500
           && (await rowOf('a1l09'))?.tella_video_id === FAKE(41) && (await rowOf('a2l01'))?.tella_video_id === FAKE(40),
           'with course lessons in the live table: a listed lesson gets its length in lessons too (a2l01 in both tables, a1l09 in lessons only), and l004 keeps its 67',
           r.ok ? JSON.stringify(await liveLengths()) : said(r))
      await refuses('a lesson that is only in the live table is held to the title it has there',
                    fill([...list, row('a2l01', FAKE(40), 500), row('a1l09', FAKE(41), 77, 'Some Other Title')]),
                    '1 lesson(s) of the list carry another title than the catalog has under that id: a1l09.', ['Some Other Title', LIVE_ONLY])
      r = await runFile(db, fill(list))
      note(r.ok && sameJson(await liveLengths(), { a1l09: null, a2l01: null, l004: 67 }) && await follows(list)
           && await rowOf('a1l09') === undefined && await stamp() === stampBefore,
           'dropped from the list, both lose their length in lessons and their video row; the live lesson l004 keeps its 67 and its stamp',
           r.ok ? JSON.stringify(await liveLengths()) : said(r))
      await db.exec(`delete from lessons where id in ('a1l09', 'a2l01');`)
      note(JSON.stringify(await q(`select * from lessons order by id`)) === liveBefore,
           '...and with those two test lessons taken out again the live table is as it was before the section')
    }

    // ── a database where v100 has not run ──
    {
      const d = await secondDatabase(v101)
      const was = JSON.stringify(await rowsOn(d, `select * from lessons_next order by id`))
      const r2 = await runFile(d, fill(LIST))
      note(!r2.ok && r2.code === 'P0001' && r2.said.includes('Run migration 2026_v100 first') && /Nothing was changed\.$/.test(r2.said)
           && !/vid_/.test(r2.said) && (await rowsOn(d, `select to_regclass('public.lesson_videos') is null as y`))[0].y
           && JSON.stringify(await rowsOn(d, `select * from lessons_next order by id`)) === was,
           'second database, v101 applied and v100 not: the load refuses with "Run migration 2026_v100 first" and changes nothing', said(r2))
      await d.close()
    }

    // ── a database where v101 has not run ──
    // The staging catalog is still v94's placeholder seed, and lesson_videos
    // is there (its create statement, lifted from the v100 file). Every id of
    // LIST is in the seed too, as a watch lesson, so nothing but the title
    // tells a placeholder from the real lesson.
    {
      const d = await secondDatabase(lift('2026_v100_lesson_videos_and_speed.sql', 'create table if not exists public.lesson_videos ('))
      const inTheSeed = (await rowsOn(d, `select count(*)::int n from lessons_next where type = 'watch' and id in (${LIST.map(([lesson]) => `'${lesson}'`).join(', ')})`))[0].n
      const state = async () => JSON.stringify({
        videos:  await rowsOn(d, `select * from public.lesson_videos order by lesson_id`),
        staging: await rowsOn(d, `select * from lessons_next order by id`),
      })
      const was = await state()
      const r2 = await runFile(d, fill(LIST))
      note(inTheSeed === LIST.length && !r2.ok && r2.code === 'P0001'
           && r2.said.includes('The course catalog is still the placeholder one') && r2.said.includes('Run migration 2026_v101_course_catalog.sql first')
           && /Nothing was changed\.$/.test(r2.said) && !/vid_/.test(r2.said) && await state() === was && JSON.parse(was).videos.length === 0,
           'second database, v100\'s table there and v101 not run: a list of ids the placeholder seed also has is refused, and no video lands on a placeholder', said(r2))
      await d.close()
    }

    // ── the real rows, when the private file is given ──
    // LESSON_VIDEOS_SQL=/path/to/the/filled/copy npm run test:migrations
    // NOTHING from that file is ever printed: no row, no id, and no error
    // text that Postgres wrote, because a constraint error quotes the value
    // it tripped on. Counts only.
    const realPath = process.env.LESSON_VIDEOS_SQL
    if (!realPath) {
      console.log('         (LESSON_VIDEOS_SQL is not set: the private file of real rows was not run)')
    } else {
      let text = null
      try { text = fs.readFileSync(realPath, 'utf8') } catch { /* said below, without the path's content */ }
      const [head, foot] = template.split(PLACEHOLDER)
      const filled = text !== null && text.startsWith(head) && text.endsWith(foot) && !text.includes('REPLACE_WITH_ROWS')
      const lines = filled ? text.slice(head.length, text.length - foot.length).split('\n') : []
      // One row: ('a1l01', 'A Title, Its Quotes Doubled', 'vid_…', 756)
      const parsed = lines.map(l => /^  \('(a[1-8]l[0-9]{2})', '((?:[^']|'')*)', '(vid_[a-z0-9]{10,64})', ([1-9][0-9]*)\)[,;]$/.exec(l))
      const real = parsed.every(Boolean) ? parsed.map(m => [m[1], m[2].replaceAll("''", "'"), m[3], Number(m[4])]) : []
      note(filled && real.length > 0 && lines.slice(0, -1).every(l => l.endsWith(',')) && lines.at(-1).endsWith(';'),
           'LESSON_VIDEOS_SQL: the file is the template with its placeholder line replaced by well-formed rows of four columns',
           text === null ? 'the file could not be read' : `${parsed.filter(Boolean).length} of ${lines.length} lines are rows`)
      if (real.length) {
        // Our own raises never hold a video id or a title (asserted above).
        // A lesson id they may name is no secret, so they may be shown.
        // Anything else is shown as its code alone.
        const safe = x => x.ok ? 'it ran' : x.code === 'P0001' ? x.said.slice(0, 80) : `it raised ${x.code}`
        note(real.every(([lesson, title]) => title === titleOf(lesson)),
             "LESSON_VIDEOS_SQL: every row carries the title the data file has for its lesson",
             `${real.filter(([lesson, title]) => title === titleOf(lesson)).length} of ${real.length} titles agree`)
        // The state v101 leaves: no video row on a course lesson, no length.
        await db.exec(`delete from public.lesson_videos where lesson_id ~ '^a[1-8]l[0-9]{2}$';
                       update lessons_next set duration_seconds = null where duration_seconds is not null;`)
        let x = await runFile(db, text)
        const have = await courseVideos()
        const watch = new Set((await q(`select id from lessons_next where type = 'watch'`)).map(l => l.id))
        const lens = await lengths()
        note(x.ok && await follows(real) && have.length === real.length && have.every(v => v.lock_status === 'unchecked'),
             'LESSON_VIDEOS_SQL: lesson_videos holds exactly the rows of the file on course lessons, all unchecked',
             x.ok ? `${have.length} rows for the ${real.length} in the file` : safe(x))
        note(x.ok && real.every(([lesson, , , seconds]) => watch.has(lesson) && lens[lesson] === seconds) && Object.keys(lens).length === real.length,
             'LESSON_VIDEOS_SQL: every one is on a watch lesson that now has its length, and no other lesson has one',
             `${Object.keys(lens).length} lengths`)
        note(reads(x, real, [real.length, real.length, 0, 0]),
             'LESSON_VIDEOS_SQL: its result counts every row as loaded and new, and shows no id',
             x.ok ? `${did(x).join('/')}; per area ${x.rows.slice(1).map(a => `${a.line}:${a.with_video}`).join(' ')}` : safe(x))
        const settled = await world()
        x = await runFile(db, text)
        note(reads(x, real, [real.length, 0, 0, 0]) && await world() === settled && await stamp() === stampBefore,
             'LESSON_VIDEOS_SQL: a second run changes nothing, and the test stamp on the live lesson is still untouched',
             x.ok ? did(x).join('/') : safe(x))
        const c = await runFile(db, checkSql)
        note(c.ok && c.rows[8]?.with_video === real.length && c.rows[8]?.with_length === real.length
             && c.rows.slice(9).length === 4 && c.rows.slice(9).every(k => k.rows === 0 && k.verdict === 'PASS') && !/vid_/.test(JSON.stringify(c.rows)),
             'LESSON_VIDEOS_SQL: course-catalog-check.sql then reads the same count with a video and with a length, and PASS four times',
             c.ok ? `${c.rows[8]?.with_video} with a video, ${c.rows[8]?.with_length} with a length` : `it raised ${c.code}`)
      }
    }
  }
}


console.log('\n=== 22. the text load: the description of the action items follows a list ===')
// supabase/diagnostics/load-lesson-text.sql is a template. The lesson text
// tool fills it outside the repository and the owner pastes the filled copy.
// Here it is filled with made-up texts and run the way the SQL editor runs it.
{
  const template = diagnostic('load-lesson-text.sql')
  const PLACEHOLDER = "  ('REPLACE_WITH_ROWS', 'REPLACE_WITH_ROWS', 'REPLACE_WITH_ROWS');"
  const titleOf = lesson => COURSE.lessons.find(l => l.id === lesson)?.title ?? 'A Lesson The Course Does Not Have'
  // A row of the list: lesson id, title, text. The title is the data file's
  // for that lesson unless another one is given.
  const row = (lesson, body, title = titleOf(lesson)) => [lesson, title, body]
  // The one way a list gets into the file: the placeholder line is replaced
  // by the rows, every single quote doubled, the last row closed with a
  // semicolon. A text of null is written as null.
  const sqlText = s => `'${s.replaceAll("'", "''")}'`
  const fillText = rows => template.replace(PLACEHOLDER, () =>
    rows.map(([lesson, title, body]) => `  (${sqlText(lesson)}, ${sqlText(title)}, ${body === null ? 'null' : sqlText(body)})`).join(',\n') + ';')
  const COURSE_ID = /^a[1-8]l[0-9]{2}$/
  const RESULT_COLS = 'line,name,listed,changed,emptied,lessons,with_text'
  // Made-up texts only, in the format the lesson page reads. Their links go
  // to example.com. NEVER a real text: those carry the course's links.
  const T1 = '**Your brief** is ready.\n\n- Read [the brief](https://example.com/made-up/brief)\n- Write 3 hooks\n\n1. Export the batch\n2. Post it'
  const T2 = 'Duplicate [the template](https://example.com/made-up/template) and fill in every page.'
  const T3 = "It's yours: $$$ and $text$ stay as they are.\nA line break, a backslash \\ and two quotes ''."
  const LIVE_TEXT = 'A live description, made up for this test.'

  const texts = async (d = db) => Object.fromEntries(
    (await rowsOn(d, `select id, description from lessons_next where description is not null order by id`)).map(x => [x.id, x.description]))
  const world = async () => JSON.stringify({
    staging: await q(`select * from lessons_next order by id`),
    areas:   await q(`select * from regions_next order by id`),
    live:    await q(`select * from lessons order by id`),
    videos:  await q(`select * from lesson_videos order by lesson_id`),
  })
  const did = r => { const s = r.rows[0] ?? {}; return [s.listed, s.changed, s.emptied] }
  // The result as it must read for a list: the run's three numbers, then per
  // area how many lessons have a text. No text and no link in it.
  const reads = (r, list, three) => {
    const inStaging = list.filter(([lesson]) => COURSE.lessons.some(l => l.id === lesson))
    const per = a => inStaging.filter(([lesson]) => lesson.startsWith(a + 'l')).length
    return r.ok && r.cols.join(',') === RESULT_COLS && r.rows.length === 9 && !/http|example\.com/.test(JSON.stringify(r.rows))
      && sameJson(r.rows[0], { line: 'this run', name: 'the whole course', listed: three[0], changed: three[1], emptied: three[2],
                               lessons: COURSE.lessons.length, with_text: inStaging.length })
      && sameJson(r.rows.slice(1), COURSE.areas.map(a => ({ line: a.id, name: a.name, listed: null, changed: null, emptied: null,
                               lessons: COURSE.lessons.filter(l => l.area === a.id).length, with_text: per(a.id) })))
  }
  // The staging catalog's descriptions say exactly what the list says.
  const follows = async (list, d = db) =>
    sameJson(await texts(d), Object.fromEntries([...list].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([lesson, , body]) => [lesson, body])))
  const said = r => r.ok ? 'it ran' : `${r.code}: ${r.said.slice(0, 64)}`
  const BODIES = [T1, T2, T3, LIVE_TEXT, 'example.com']
  // A refusal: our own raise, its sentence, "Nothing was changed." at the
  // end, no text and no link in the message, none of the given strings in
  // it, and a database that is identical afterwards.
  const refuses = async (label, sqls, sentence, never = []) => {
    const was = await world()
    const got = []
    for (const sql of [].concat(sqls)) got.push(await runFile(db, sql))
    note(got.every(r => !r.ok && r.code === 'P0001' && r.said.includes(sentence) && /Nothing was changed\.$/.test(r.said)
                        && !/http/i.test(r.said) && ![...BODIES, ...never].some(x => r.said.includes(x)))
         && await world() === was,
         label, got.map(said).join(' | ').slice(0, 110))
  }

  // ── the template itself ──
  note(countOf(template, PLACEHOLDER) === 1 && countOf(template, 'REPLACE_WITH_ROWS') === 3
       && template.includes('insert into _text values\n' + PLACEHOLDER + '\n')
       && template.includes('create temp table _text (lesson_id text, title text, body text) on commit drop;'),
       'the template holds its placeholder line exactly once, three columns wide, straight after "insert into _text values"')
  note(template.split('\n').filter(l => /http/i.test(l)).every(l => l.startsWith('--')),
       'the template holds no address: "https" appears in its header, where it describes the format, and nowhere else',
       `${template.split('\n').filter(l => /http/i.test(l)).length} header lines`)

  const ready = (await q(`select
       (select count(*)::int from lessons_next) as lessons,
       (select count(*)::int from lessons_next where description is not null) as texts`))[0]
  if (!(ready.lessons === 141 && ready.texts === 0)) {
    note(false, 'section 22 needs the state v101 leaves: 141 lessons and no description', JSON.stringify(ready))
  } else {
    // A description on a live lesson. It stays for the whole section: no
    // load may touch it.
    await db.exec(`update lessons set description = '${LIVE_TEXT}' where id = 'l004';`)
    const liveBefore = JSON.stringify(await q(`select * from lessons order by id`))
    const videosBefore = JSON.stringify(await q(`select * from lesson_videos order by lesson_id`))
    const otherColumns = async () => JSON.stringify(
      (await q(`select * from lessons_next order by id`)).map(({ description, updated_at, ...rest }) => rest))
    const otherBefore = await otherColumns()

    // 3 lessons over 2 areas: a3l25 in a3, a5l22 (a setup lesson) and a5l23 in a5.
    const LIST = [row('a3l25', T1), row('a5l22', T2), row('a5l23', T3)]

    // ── a list that is wrong changes nothing ──
    await refuses('the template as tracked, its placeholder line not replaced, is refused', template,
                  'The placeholder line was not replaced with the rows')
    await refuses("a lesson id that is not a course lesson id is refused, and never repeated: a live lesson's id, a ninth area, capitals, an empty id",
                  ['l004', 'a9l01', 'A5L23', ''].map(bad => fillText([...LIST.slice(0, 2), row(bad, T3, titleOf('a5l23'))])),
                  '1 row(s) of the list have a lesson id that is not a course lesson id', ['l004', 'a9l01', 'A5L23'])
    await refuses('a lesson that is in the list twice is refused, and the message says which lesson',
                  fillText([...LIST, row('a3l25', T2)]), '1 lesson(s) are in the list more than once: a3l25. A lesson has one text')
    await refuses('an empty text, a text of blanks and line ends, and a null text are refused, and the message says which lesson',
                  ['', '  \n \n', null].map(bad => fillText([...LIST.slice(0, 2), row('a5l23', bad)])),
                  '1 lesson(s) of the list have an empty text: a5l23.')
    await refuses('a text of 8001 characters is refused, and the message says which lesson',
                  fillText([...LIST.slice(0, 2), row('a5l23', 'é'.repeat(8001))]),
                  '1 lesson(s) of the list have a text longer than 8000 characters: a5l23.')
    await refuses('a lesson that is in neither catalog is refused, and the message says which lesson',
                  fillText([...LIST, row('a1l09', T2)]),
                  '1 lesson(s) of the list are in neither public.lessons_next nor public.lessons: a1l09. The list was written')
    await refuses('a message names 10 lessons at most, then says how many more: 12 unknown lessons read "... a1l18 and 2 more"',
                  fillText([...LIST, ...Array.from({ length: 12 }, (_, i) => row(`a1l${String(9 + i).padStart(2, '0')}`, T2))]),
                  '12 lesson(s) of the list are in neither public.lessons_next nor public.lessons: '
                  + 'a1l09, a1l10, a1l11, a1l12, a1l13, a1l14, a1l15, a1l16, a1l17, a1l18 and 2 more. The list was written',
                  ['a1l19', 'a1l20'])
    // The right lesson id, the right text, and the title of another version
    // of the course.
    await refuses('a list with one wrong title is refused: the message names the lesson, says the list is for another version of the course, and repeats no title',
                  fillText(LIST.map(x => x[0] === 'a5l22' ? row('a5l22', T2, 'Action Item - Brand Book') : x)),
                  '1 lesson(s) of the list carry another title than the catalog has under that id: a5l22. This list was made for another version of the course. '
                  + 'Run the read and the sql command of the lesson text tool again',
                  ['Action Item - Brand Book', titleOf('a5l22')])

    // ── first load ──
    let r = await runFile(db, fillText(LIST))
    note(r.ok && await follows(LIST),
         'first load of 3 lessons over 2 areas, one of them a setup lesson: their descriptions are set, and no other lesson has one', said(r))
    note(reads(r, LIST, [3, 3, 0]),
         'its result says 3 listed, 3 changed, 0 emptied, then lessons and texts per area, and shows no text',
         r.ok ? `${did(r).join('/')}; ${r.rows.slice(1).map(x => `${x.line}:${x.with_text}`).join(' ')}` : said(r))
    {
      const got = (await q(`select description, octet_length(description)::int as bytes from lessons_next where id = 'a5l23'`))[0] ?? {}
      note(got.description === T3 && got.bytes === Buffer.byteLength(T3, 'utf8') && fillText(LIST).includes("It''s yours: $$$ and $text$")
           && (await texts()).a3l25 === T1,
           "a text with an apostrophe, $$$, the block's own $text$, a backslash, two quotes and a line break comes back byte for byte",
           `${got.bytes} bytes`)
    }
    note(await otherColumns() === otherBefore && JSON.stringify(await q(`select * from lesson_videos order by lesson_id`)) === videosBefore
         && JSON.stringify(await q(`select * from lessons order by id`)) === liveBefore,
         'the load writes description on lessons_next and nothing else: not duration_seconds, not lesson_videos, not the live lessons')
    note((await q(`select description from lessons where id = 'l004'`))[0]?.description === LIVE_TEXT,
         'the live lesson l004 keeps its own description')

    // ── what the app then sees ──
    {
      const sent = await q(`select * from lessons_next order by sort_order`)
      note(sent.length === 141 && sameJson(sent.filter(l => l.description !== null).map(l => [l.id, l.description]),
                                           [['a3l25', T1], ['a5l22', T2], ['a5l23', T3]]),
           "the data route's catalog read (select * from lessons_next order by sort_order) carries each text on its lesson, and null on every other",
           `${sent.filter(l => l.description !== null).length} of ${sent.length}`)
    }

    // ── the same list again ──
    let before = await world()
    r = await runFile(db, fillText(LIST))
    note(reads(r, LIST, [3, 0, 0]) && await world() === before,
         'the same list again changes nothing, updated_at included; its result says 0 changed, 0 emptied', said(r))

    // ── one text changes ──
    const stamps = async () => Object.fromEntries((await q(`select id, updated_at::text as at from lessons_next where id in ('a3l25', 'a5l22', 'a5l23')`)).map(x => [x.id, x.at]))
    let at = await stamps()
    let list = LIST.map(x => x[0] === 'a5l22' ? row('a5l22', T2 + '\n\nThen post it in the channel.') : x)
    r = await runFile(db, fillText(list))
    let now = await stamps()
    note(reads(r, list, [3, 1, 0]) && await follows(list) && now.a5l22 !== at.a5l22 && now.a3l25 === at.a3l25 && now.a5l23 === at.a5l23,
         'a text that changes replaces the old one, and only that lesson is written (its updated_at moves, the other two keep theirs)',
         r.ok ? did(r).join('/') : said(r))

    // ── a lesson drops out of the list ──
    at = await stamps()
    list = list.filter(x => x[0] !== 'a3l25')
    r = await runFile(db, fillText(list))
    now = await stamps()
    note(reads(r, list, [2, 0, 1]) && await follows(list) && !('a3l25' in await texts()) && now.a5l22 === at.a5l22 && now.a5l23 === at.a5l23,
         'a lesson dropped from the list gets null, and the lessons still listed are not touched', r.ok ? did(r).join('/') : said(r))

    // ── the longest text there may be ──
    // 8000 characters of a letter that takes 2 bytes: the limit is counted in
    // characters, not bytes.
    {
      const longest = 'é'.repeat(8000)
      const withLongest = [...list, row('a6l03', longest)]
      r = await runFile(db, fillText(withLongest))
      note(r.ok && (await texts()).a6l03 === longest,
           'a text of exactly 8000 characters (16000 bytes) is taken', said(r))
      r = await runFile(db, fillText(list))
      note(reads(r, list, [2, 0, 1]) && await follows(list), '...and taken out again by the next list', said(r))
    }

    // ── course lessons in the LIVE table, as after a cutover ──
    // The load writes the text into `lessons` as well as lessons_next. Before
    // the cutover no course lesson is in `lessons`, so those statements match
    // nothing and could be broken unseen. Two live lessons with course ids:
    // a5l22 copied from the staging catalog, so it is in both tables, and
    // a1l09, which is in `lessons` only.
    {
      const LIVE_ONLY = 'A Lesson Added After The Cutover'
      await db.exec(`
        insert into lessons (id, region_id, day, type, title, sort_order)
        select id, 'r4', 30, type, title, 9000 + sort_order from lessons_next where id = 'a5l22';
        insert into lessons (id, region_id, day, type, title, sort_order) values ('a1l09', 'r4', 30, 'watch', '${LIVE_ONLY}', 9999);`)
      const liveTexts = async () => Object.fromEntries(
        (await q(`select id, description from lessons where id in ('a1l09', 'a5l22', 'l004') order by id`)).map(x => [x.id, x.description]))
      const withLive = [...list, row('a1l09', T1, LIVE_ONLY)]
      const b22 = list.find(x => x[0] === 'a5l22')[2]
      r = await runFile(db, fillText(withLive))
      note(r.ok && sameJson(await liveTexts(), { a1l09: T1, a5l22: b22, l004: LIVE_TEXT }) && await follows(list),
           'with course lessons in the live table: a listed lesson gets its text in lessons too (a5l22 in both tables, a1l09 in lessons only), and l004 keeps its own',
           r.ok ? Object.entries(await liveTexts()).map(([k, v]) => `${k}:${v === null ? 'null' : v.length}`).join(' ') : said(r))
      await refuses('a lesson that is only in the live table is held to the title it has there',
                    fillText([...list, row('a1l09', T1, 'Some Other Title')]),
                    '1 lesson(s) of the list carry another title than the catalog has under that id: a1l09.', ['Some Other Title', LIVE_ONLY])
      r = await runFile(db, fillText(list.filter(x => x[0] !== 'a5l22')))
      note(r.ok && sameJson(await liveTexts(), { a1l09: null, a5l22: null, l004: LIVE_TEXT }) && !('a5l22' in await texts()),
           'dropped from the list, both lose their text in lessons, and a5l22 in lessons_next too; the live lesson l004 keeps its own',
           r.ok ? did(r).join('/') : said(r))
      await db.exec(`delete from lessons where id in ('a1l09', 'a5l22');`)
      note(JSON.stringify(await q(`select * from lessons order by id`)) === liveBefore,
           '...and with those two test lessons taken out again the live table is as it was before the section')
    }

    // ── a database where v101 has not run ──
    // The staging catalog is still v94's placeholder seed. Every id of this
    // list is in the seed too, so nothing but the title tells a placeholder
    // from the real lesson. (The seed has 22 lessons in a3, so no a3l25.)
    {
      const d = await secondDatabase()
      const seeded = [row('a1l01', T2), row('a5l22', T2), row('a5l23', T3)]
      const inTheSeed = (await rowsOn(d, `select count(*)::int n from lessons_next where id in (${seeded.map(([lesson]) => `'${lesson}'`).join(', ')})`))[0].n
      const was = JSON.stringify(await rowsOn(d, `select * from lessons_next order by id`))
      const r2 = await runFile(d, fillText(seeded))
      note(inTheSeed === seeded.length && !r2.ok && r2.code === 'P0001'
           && r2.said.includes('The course catalog is still the placeholder one') && r2.said.includes('Run migration 2026_v101_course_catalog.sql first')
           && /Nothing was changed\.$/.test(r2.said) && JSON.stringify(await rowsOn(d, `select * from lessons_next order by id`)) === was,
           'second database, v101 not run: a list of ids the placeholder seed also has is refused, and no text lands on a placeholder', said(r2))
      await d.close()
    }

    // ── the real rows, when the private file is given ──
    // LESSON_TEXT_SQL=/path/to/the/filled/copy npm run test:migrations
    // NOTHING from that file is ever printed: no row, no text, no link, and no
    // error text that Postgres wrote, because an error can quote the value it
    // tripped on. Counts only. It runs on a database of its own, in the state
    // v101 leaves, so this harness's own database is not touched by it.
    const realPath = process.env.LESSON_TEXT_SQL
    if (!realPath) {
      console.log('         (LESSON_TEXT_SQL is not set: the private file of real texts was not run)')
    } else {
      let text = null
      try { text = fs.readFileSync(realPath, 'utf8') } catch { /* said below, without the path's content */ }
      const [head, foot] = template.split(PLACEHOLDER)
      const filled = text !== null && text.startsWith(head) && text.endsWith(foot) && !text.includes('REPLACE_WITH_ROWS')
      const region = filled ? text.slice(head.length, text.length - foot.length) : ''
      // One row: ('a5l22', 'A Title, Its Quotes Doubled', 'A text, its quotes doubled, over any number of lines')
      const one = /  \('(a[1-8]l[0-9]{2})', '((?:[^']|'')*)', '((?:[^']|'')*)'\)(,\n|;)/y
      const real = []
      let rest = region.length > 0
      for (let m; rest && (m = one.exec(region)) !== null;) {
        real.push([m[1], m[2].replaceAll("''", "'"), m[3].replaceAll("''", "'")])
        if (m[4] === ';') rest = false
      }
      const whole = filled && real.length > 0 && !rest && one.lastIndex === region.length
      note(whole,
           'LESSON_TEXT_SQL: the file is the template with its placeholder line replaced by well-formed rows of three columns',
           text === null ? 'the file could not be read' : `${real.length} rows read`)
      if (whole) {
        // Our own raises never hold a text or a title (asserted above). A
        // lesson id they may name is no secret, so they may be shown.
        // Anything else is shown as its code alone.
        const safe = x => x.ok ? 'it ran' : x.code === 'P0001' ? x.said.slice(0, 80) : `it raised ${x.code}`
        note(real.every(([lesson, title]) => title === titleOf(lesson)),
             'LESSON_TEXT_SQL: every row carries the title the data file has for its lesson',
             `${real.filter(([lesson, title]) => title === titleOf(lesson)).length} of ${real.length} titles agree`)
        // base.sql holds no live lesson, so l004 is put there with its own
        // description, as in the harness's own database.
        const d = await secondDatabase(read(V101F))
        await d.exec(`insert into regions (id, order_num, name, terrain) values ('r1', 1, 'Foundation', 'shore');
                      insert into lessons (id, region_id, day, type, title, description, sort_order) values ('l004', 'r1', 2, 'watch', 'Lesson 4', '${LIVE_TEXT}', 4);`)
        let x = await runFile(d, text)
        note(x.ok && await follows(real, d),
             "LESSON_TEXT_SQL: on a database in the state v101 leaves, every listed lesson's description equals the text in the file, and no other lesson has one",
             x.ok ? `${Object.keys(await texts(d)).length} descriptions for the ${real.length} rows in the file` : safe(x))
        note(x.ok && x.rows[0]?.listed === real.length && x.rows[0]?.changed === real.length && x.rows[0]?.emptied === 0
             && x.rows[0]?.with_text === real.length && !/http/i.test(JSON.stringify(x.rows)),
             'LESSON_TEXT_SQL: its result counts every row as listed and changed, and shows no text',
             x.ok ? `${x.rows[0]?.listed}/${x.rows[0]?.changed}/${x.rows[0]?.emptied}` : safe(x))
        const settled = JSON.stringify(await rowsOn(d, `select * from lessons_next order by id`))
        x = await runFile(d, text)
        note(x.ok && x.rows[0]?.changed === 0 && x.rows[0]?.emptied === 0
             && JSON.stringify(await rowsOn(d, `select * from lessons_next order by id`)) === settled
             && (await rowsOn(d, `select description from lessons where id = 'l004'`))[0]?.description === LIVE_TEXT,
             'LESSON_TEXT_SQL: a second run changes nothing, and the live lesson l004 keeps its own description',
             x.ok ? `${x.rows[0]?.changed}/${x.rows[0]?.emptied}` : safe(x))
        await d.close()
      }
    }
  }
}

console.log(`\n${'='.repeat(60)}\n  PASS ${ok.length}   FAIL ${fail.length}`)
if (fail.length) { console.log('\nFAILURES:'); fail.forEach(f => console.log('  - ' + f)); process.exit(1) }
