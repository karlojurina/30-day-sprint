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
// v78 hardening, as it stands in production today. Kept in a constant:
// sections 23 and 24 build a second database with it.
const V78_HARDENING = `
alter view public.student_progress_counts set (security_invoker = on);
revoke select on public.student_progress_counts from anon;
grant select on public.student_progress_counts to authenticated;
alter view public.student_current_region set (security_invoker = on);
revoke select on public.student_current_region from anon;
grant select on public.student_current_region to authenticated;
revoke select on public.achievement_unlock_stats from anon;
grant select on public.achievement_unlock_stats to authenticated;
grant execute on function public.rebuild_daily_snapshots(date, date) to authenticated;`
await exec(V78_HARDENING, 'v78 hardening')

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
  // Action items: the PRD's 9, and a3l17 since 2026-10-19 (Lovro), so 10.
  const THE_COURSE = { n: 141, counting: 140, lo: 1, hi: 141, orders: 141, sizes: '8,11,25,17,26,22,19,13', crossings: 0, gates: 'a4l17',
                       special: 'a7l19/bounty_access/false', actions: 10, no_brief: 0, setups: 5, placeholders: 0 }
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
         'the post-conditions hold: 141 rows, 140 counting, sort_order 1 to 141 and rising with the areas, 8/11/25/17/26/22/19/13, gate a4l17, a7l19 the one feature row, 10 action items with briefs, 5 setup, no placeholder title',
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

// ════════════════════════════════════════════════════════════════════
// 23 and 24: the cutover. v103 (expand), v104 (the switch), their undos,
// and the two diagnostics (_admin/prds/cutover/cutover_prd.md, WI-2).
// ════════════════════════════════════════════════════════════════════
// Both sections are one function run twice: on this harness's own database,
// in the state section 22 left it, then on a second database built from
// base.sql and the chain of real migration files, with none of the leftovers
// of sections 10 to 22. Every fixture below is added on top of what is there,
// and every assertion is about the fixtures or about a count taken first.

const V103F = '2026_v103_cutover_expand.sql'
const V104F = '2026_v104_course_switch.sql'
const undoText = f => fs.readFileSync(fileURLToPath(new URL('../undo/' + f, import.meta.url)), 'utf8')
const RETIRED = ['r1_clear', 'r2_clear', 'r3_clear', 'r4_clear', 'early_finisher', 'speedrun']
const ARCHIVED_WHOLE = ['regions', 'lessons', 'student_lesson_completions', 'lesson_notes', 'student_lesson_ratings', 'quizzes',
                        'quiz_questions', 'student_quiz_attempts', 'student_region_quiz', 'student_achievements', 'achievements',
                        'student_milestones']
const WIPED = ['student_quiz_attempts', 'quiz_questions', 'quizzes', 'student_region_quiz', 'student_lesson_ratings', 'lesson_notes',
               'student_lesson_completions', 'student_achievements']
const LESSON_COPY = 'id, region_id, type, title, description, sort_order, requires_action, action_brief, is_optional, is_gate, '
                  + 'lesson_group_id, discord_channel, counts_toward_progress, feature_key, bunny_video_id, duration_seconds, '
                  + 'video_ready_at, whop_lesson_id, created_at, updated_at'
const REGION_COPY = 'id, order_num, name, subtitle, tagline, terrain, landmark_label, rail_at, quiz_format, is_discount_gate, created_at'
const SIX = ['fk_lesson_notes_lesson_id', 'fk_lessons_region_id', 'fk_quizzes_region_id', 'fk_student_lesson_completions_lesson_id',
             'fk_student_lesson_ratings_lesson_id', 'fk_student_region_quiz_region_id']
const SWITCH_COLS = 'line,name,lessons,counting,action_items,with_video,with_whop_id,value'
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
// Well-formed FAKE video ids, as in sections 18 to 21. Never a real one.
const CUTFAKE = n => `vid_cutoverfake${'a'.repeat(6)}${String(n).padStart(2, '0')}`
// lesson_is_complete() (v92), written a second time in JavaScript.
const doneJs = r => r.skipped_at !== null || (!r.requires_action && r.completed_at !== null)
                 || (r.requires_action && r.completed_at !== null && r.action_completed_at !== null)
const asJson = v => JSON.stringify(v, (k, x) => typeof x === 'bigint' ? x.toString() : x)

// A second database: base.sql, the lifted pre-v92 objects and v78's hardening
// (section 2), the old-course seed (section 3), then every migration file from
// v92 to v101 in order, with section 18's seam before v100.
const chainDatabase = async () => {
  const d = new PGlite()
  await d.exec(fs.readFileSync(new URL('base.sql', import.meta.url), 'utf8'))
  for (const sql of [v81view, v49view, v90view, v89fn, V78_HARDENING, seed]) await d.exec(sql)
  for (const f of ['2026_v92_progress_predicate_and_lessons_v2_columns.sql', '2026_v93_lesson_watch_telemetry.sql',
                   '2026_v94_catalog_next_staging.sql', '2026_v95_discount_window_config.sql',
                   '2026_v96_lock_down_rebuild_snapshots.sql', '2026_v97_heartbeat_trust_nothing.sql',
                   '2026_v98_current_region_counts_toward_progress.sql', V99F]) await d.exec(read(f))
  await d.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`)
  await d.exec(read('2026_v100_lesson_videos_and_speed.sql'))
  await d.exec(read(V101F))
  return d
}

const cutover = async (d, where) => {
  const tag = where ? ` [${where}]` : ''
  const say = (pass, label, detail = '') => note(pass, label + tag, detail)
  const Q = async (sql, params) => (await d.query(sql, params)).rows
  const one = async (sql, params) => (await Q(sql, params))[0]
  const said = r => r.ok ? 'it ran' : `${r.code}: ${r.said.slice(0, 90)}`
  const refused = (r, sentence) => !r.ok && r.code === 'P0001' && r.said.includes(sentence) && /Nothing was changed\.$/.test(r.said)
  const raisesOn = async (dd, sql) => { try { await dd.query(sql); return null } catch (e) { return e } }

  // Every row of every table in public, as sorted JSON. `skip` drops a table
  // (true) or some of its columns (a list).
  const dataDump = async (dd = d, skip = {}) => {
    const out = {}
    for (const { tablename: t } of (await dd.query(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows) {
      if (skip[t] === true) continue
      out[t] = (await dd.query(`select * from public."${t}"`)).rows
        .map(r => { const o = { ...r }; for (const c of skip[t] ?? []) delete o[c]; return asJson(o) }).sort()
    }
    return asJson(out)
  }
  // Every column with its type, not-null flag and default, every constraint as
  // Postgres states it, every index, view, function and trigger in public.
  const objectDump = async (dd = d) => asJson({
    columns:     (await dd.query(`select table_name, column_name, data_type, is_nullable, column_default
                                    from information_schema.columns where table_schema = 'public' order by 1, 2`)).rows,
    constraints: (await dd.query(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as d
                                    from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`)).rows,
    indexes:     (await dd.query(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`)).rows,
    views:       (await dd.query(`select viewname, definition from pg_views where schemaname = 'public' order by 1`)).rows,
    functions:   (await dd.query(`select proname, pg_get_function_identity_arguments(oid) as a from pg_proc
                                   where pronamespace = 'public'::regnamespace order by 1, 2`)).rows,
    triggers:    (await dd.query(`select tgrelid::regclass::text as t, tgname from pg_trigger where not tgisinternal order by 1, 2`)).rows,
  })
  const archives = async (dd = d) => (await dd.query(`select nspname from pg_namespace where nspname like 'archive%' order by 1`)).rows.map(r => r.nspname)
  const everything = async (dd = d) => await dataDump(dd) + await objectDump(dd) + asJson(await archives(dd))
  const theKey = async (dd = d) => (await dd.query(`select value from admin_config where key = 'curriculum_reset_at'`)).rows[0]?.value ?? null

  // ════════════════════════════ 23 ════════════════════════════
  console.log(`\n=== 23. v103: what the switch needs, added beside what exists${tag} ===`)
  const v103 = read(V103F)
  const undo103 = undoText('2026_v103_undo.sql')
  const SNAPSKIP = { daily_progress_snapshots: ['created_at'] }
  const viewRows = async () => asJson({
    counts: await Q(`select student_id::text, completed_count from student_progress_counts order by 1`),
    region: await Q(`select student_id::text, current_region from student_current_region order by 1`) })
  const snapNumbers = async () => {
    await d.query(`select public.rebuild_daily_snapshots(current_date - 1, current_date)`)
    return asJson(await Q(`select snapshot_date::text, active_students, total_completions, avg_progress::text,
                                  avg_progress_cohort::text, active_count, joined_count, churned_count, total_lessons
                             from daily_progress_snapshots where snapshot_date >= current_date - 1 order by 1`))
  }
  const facts103 = async () => one(`select
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_milestones'
                and column_name = 'playbook_unlocked_at' and data_type = 'timestamp with time zone') as playbook,
      (select string_agg(column_name || ':' || data_type, ',' order by column_name) from information_schema.columns
        where table_schema = 'public' and table_name = 'regions' and column_name in ('landmark_label', 'rail_at')) as area_cols,
      (select data_type from information_schema.columns where table_schema = 'public'
          and table_name = 'student_last_counted_completion' and column_name = 'last_completed_at') as view_type,
      (select reloptions::text from pg_class where oid = to_regclass('public.student_last_counted_completion')) as view_opts,
      has_table_privilege('anon', 'public.student_last_counted_completion', 'select') as anon_reads,
      has_table_privilege('authenticated', 'public.student_last_counted_completion', 'select') as students_read,
      (select tgtype from pg_trigger where tgname = 'trg_daily_snapshots_reset_floor' and not tgisinternal) as tgtype,
      (select prosecdef from pg_proc where proname = 'daily_snapshots_reset_floor') as definer`)

  const start = await one(`select (select count(*)::int from lessons_next) as staged,
                                  exists (select 1 from lessons where id = 'l078') as old_live,
                                  (select count(*)::int from admin_config where key = 'curriculum_reset_at') as keys`)
  if (!(start.staged === 141 && start.old_live && start.keys === 0)) {
    say(false, 'section 23 needs v101 applied, the old course live and no switch', asJson(start))
    return
  }

  const numbersBefore = await snapNumbers()
  const viewsBefore = await viewRows()
  const objectsBefore103 = await objectDump()
  const dataBefore103 = await dataDump(d, SNAPSKIP)

  let r = await runFile(d, v103)
  say(r.ok && r.rows.length === 1 && ['playbook_column', 'area_columns', 'last_counted_view', 'view_security_invoker', 'snapshot_floor']
        .every(c => r.rows[0][c] === true) && r.rows[0].switch === 'not yet: the switch has not run',
      'v103 first run: its result row says the four are there and the switch has not run', r.ok ? asJson(r.rows[0]) : said(r))
  let f = await facts103()
  // tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update.
  say(f.playbook && f.area_cols === 'landmark_label:text,rail_at:numeric' && f.view_type === 'timestamp with time zone'
        && f.tgtype === (1 | 2 | 4 | 8 | 16) && f.definer === true,
      'the four objects: playbook_unlocked_at timestamptz, regions.landmark_label text and rail_at numeric, the view, the floor (before insert, update or delete, for each row, security definer)',
      asJson(f))
  say(f.view_opts === '{security_invoker=on}' && f.anon_reads === false && f.students_read === true,
      'the view is hardened like student_progress_counts: security_invoker on, authenticated reads it, anon does not', asJson(f))
  say(await viewRows() === viewsBefore, 'every row of student_progress_counts and student_current_region is identical after v103')
  say(await snapNumbers() === numbersBefore, 'the snapshot RPC returns the same numbers after v103')

  {
    const objects = await objectDump(), data = await dataDump(d, SNAPSKIP)
    r = await runFile(d, v103)
    say(r.ok && await objectDump() === objects && await dataDump(d, SNAPSKIP) === data,
        'v103 run again: every object and every row unchanged', said(r))
  }

  // v103 alters live tables: each lock waits 5 seconds at most, and the
  // setting ends with its transaction. (A held lock cannot be staged here:
  // PGlite is one session, and a wait on a prepared transaction hangs it.)
  {
    const c = await d.clone()
    const at = v103.indexOf('\ncommit;\n')
    const rr = await runFile(c, v103.slice(0, at) + `\nselect set_config('test.v103_lock_timeout', current_setting('lock_timeout'), false);` + v103.slice(at))
    const lt = (await c.query(`select current_setting('test.v103_lock_timeout', true) as inside, current_setting('lock_timeout') as after`)).rows[0]
    await c.close()
    say(at > 0 && rr.ok && lt.inside === '5s' && lt.after === '0',
        "v103's transaction runs with lock_timeout 5s, and the setting is gone after its commit", rr.ok ? asJson(lt) : said(rr))
  }

  // The view's value, on fixtures inside a transaction that is rolled back.
  {
    const V = n => `c2000000-0000-0000-0000-00000000000${n}`
    const got = await d.transaction(async tx => {
      await tx.exec(`
        insert into students (id, supabase_user_id, first_paid_at, whop_plan_id, membership_status)
        select ('c2000000-0000-0000-0000-00000000000' || n)::uuid, ('c2000000-0000-0000-0000-00000000000' || n)::uuid,
               '2026-06-01 10:00:00+00', 'plan_4ZrwR4PmBsVsx', 'active' from generate_series(1, 4) n;
        insert into student_lesson_completions (student_id, lesson_id, completed_at, action_completed_at, skipped_at) values
          ('${V(1)}', 'l001', '2026-07-01 10:00:00+00', null, null),
          ('${V(1)}', 'l002', '2026-07-03 10:00:00+00', null, null),
          ('${V(1)}', 'l057', '2026-07-09 10:00:00+00', null, null),
          ('${V(2)}', 'l004', null, null, '2026-07-05 10:00:00+00'),
          ('${V(3)}', 'l008', '2026-07-06 10:00:00+00', null, null),
          ('${V(4)}', 'l008', '2026-07-06 10:00:00+00', '2026-07-08 10:00:00+00', null);`)
      const rows = (await tx.query(`select student_id::text as s, last_completed_at from student_last_counted_completion
                                     where student_id::text like 'c2000000%' order by 1`)).rows
      await tx.rollback()
      return rows
    }).catch(e => [{ s: e.message }])
    say(got.length === 2 && got[0].s === V(1) && got[0].last_completed_at?.toISOString() === '2026-07-03T10:00:00.000Z'
          && got[1].s === V(4) && got[1].last_completed_at?.toISOString() === '2026-07-08T10:00:00.000Z',
        "the view: the latest completed_at of counting done lessons (a later l057 does not count); a skipped-only student and a compound lesson half done give no row; both halves done gives the later of the two (the action shipped 2 days after the watch)",
        got.map(x => `${x.s.slice(-1)}:${x.last_completed_at?.toISOString?.() ?? x.s}`).join(' '))
  }

  // The undo of v103: refuses while the switch is in place, else takes it all back.
  {
    await d.exec(`insert into admin_config (key, value) values ('curriculum_reset_at', '2026-10-20T18:25:00.000Z');`)
    const was = await everything()
    r = await runFile(d, undo103)
    say(refused(r, 'Run the undo of v104 first') && await everything() === was,
        'the undo of v103 refuses while curriculum_reset_at exists, and changes nothing', said(r))
    await d.exec(`delete from admin_config where key = 'curriculum_reset_at';`)
    r = await runFile(d, undo103)
    say(r.ok && r.rows.length === 1 && Object.values(r.rows[0]).every(v => v === true)
          && await objectDump() === objectsBefore103 && await dataDump(d, SNAPSKIP) === dataBefore103,
        'the undo of v103: every object and every row equals the dump taken before v103, and its result row is all true', said(r))
    r = await runFile(d, undo103)
    say(r.ok && await objectDump() === objectsBefore103, 'a second undo changes nothing', said(r))
    r = await runFile(d, v103)
    say(r.ok, 'v103 applies again after its undo', said(r))
  }

  // ── the floor (the backstop of cutover WI-6) ──
  {
    const D = (await one(`select (now() at time zone 'UTC')::date::text as d`)).d
    const snaps = async () => asJson(await Q(`select * from daily_progress_snapshots order by snapshot_date`))
    const rpc = (from, to) => raisesOn(d, `select public.rebuild_daily_snapshots(${from}, ${to})`)
    // Without the key: every write as before, today and earlier.
    let e = await rpc('current_date - 2', 'current_date')
    say(e === null && (await one(`select count(*)::int as n from daily_progress_snapshots where snapshot_date >= current_date - 2`)).n === 3,
        'without the key the floor does nothing: a rebuild over the last 3 days runs and writes its 3 rows', e?.message ?? '')
    e = await raisesOn(d, `update daily_progress_snapshots set active_students = active_students where snapshot_date = current_date - 1`)
    const e2 = await raisesOn(d, `delete from daily_progress_snapshots where snapshot_date = current_date - 30`)
    say(e === null && e2 === null, '...and an update of yesterday\'s row and a delete of an older one go through', (e ?? e2)?.message ?? '')

    // The key at day D (today, UTC).
    await d.exec(`insert into admin_config (key, value) values ('curriculum_reset_at', '${D}T00:00:01.000Z');`)
    let before = await snaps()
    e = await rpc('current_date - 2', 'current_date')
    say(e?.code === '22023' && /from before the course switch of/.test(e.message) && /Nothing was changed\.$/.test(e.message)
          && await snaps() === before,
        'with the key at day D: a rebuild from D-2 raises 22023 and leaves every row as it was', e ? `${e.code}: ${e.message.slice(0, 80)}` : 'it ran')
    e = await rpc('current_date', 'current_date')
    const today = await one(`select count(*)::int as n, max(created_at) > now() - interval '1 minute' as fresh
                               from daily_progress_snapshots where snapshot_date = current_date`)
    say(e === null && today.n === 1 && today.fresh === true,
        '...a rebuild from D runs and writes the row for D', e?.message ?? asJson(today))
    before = await snaps()
    const upd = await raisesOn(d, `update daily_progress_snapshots set active_students = active_students where snapshot_date = current_date - 1`)
    const del = await raisesOn(d, `delete from daily_progress_snapshots where snapshot_date = current_date - 1`)
    const gap = (await one(`select min(g)::date::text as g from generate_series(current_date - 29, current_date - 3, interval '1 day') g
                             where not exists (select 1 from daily_progress_snapshots s where s.snapshot_date = g::date)`)).g
    const ins = gap ? await raisesOn(d, `insert into daily_progress_snapshots (snapshot_date, active_students, total_completions, avg_progress)
                                          values ('${gap}', 0, 0, 0)`) : { code: 'no day free' }
    const moveIn = await raisesOn(d, `update daily_progress_snapshots set snapshot_date = current_date - 5 where snapshot_date = current_date`)
    say([upd, del, ins, moveIn].every(x => x?.code === '22023') && await snaps() === before,
        '...an update and a delete of the row for D-1, an insert for a missing earlier day, and moving the row of D back in time each raise 22023, and change nothing',
        [upd, del, ins, moveIn].map(x => x?.code ?? 'went through').join(' '))
    e = await raisesOn(d, `update daily_progress_snapshots set active_students = active_students where snapshot_date = current_date`)
    say(e === null, '...and the row for D itself can still be changed', e?.message ?? '')
    await d.exec(`delete from admin_config where key = 'curriculum_reset_at';`)
    e = await rpc('current_date - 2', 'current_date')
    say(e === null, 'with the key gone the floor is inert again: the rebuild from D-2 runs', e?.message ?? '')
  }

  // ════════════════════════════ 24 ════════════════════════════
  console.log(`\n=== 24. v104: the switch, its guards, its undo, and the two diagnostics${tag} ===`)
  const v104 = read(V104F)
  const undo104 = undoText('2026_v104_undo.sql')
  const preflight = diagnostic('cutover-preflight.sql')
  const postcheck = diagnostic('cutover-postcheck.sql')

  // The seam, widened: on Supabase a new table is born readable by the API
  // roles. Here every new table and schema is, wherever it is made, so the
  // assertions on archive_v1 measure v104's REVOKE and nothing else.
  await d.exec(`alter default privileges grant all on tables to anon, authenticated, service_role;
                alter default privileges grant usage on schemas to anon, authenticated, service_role;
                create schema _born_open; create table _born_open.t (id int);`)
  {
    const b = await one(`select has_schema_privilege('anon', '_born_open', 'usage') as s, has_table_privilege('anon', '_born_open.t', 'select') as t`)
    await d.exec(`drop schema _born_open cascade;`)
    say(b.s === true && b.t === true, 'harness seam: a new schema and a new table outside public are born open to anon', asJson(b))
  }

  // ── fixtures ──
  const G = n => `c1000000-0000-0000-0000-00000000000${n}`
  const counting = (await one(`select count(*)::int as n from lessons where counts_toward_progress`)).n
  const need = Math.ceil(0.8 * counting)
  const pool = (await Q(`select id from lessons where id <> 'l078' order by id`)).map(x => x.id)
  const TEMPLATE = { region: 'c3000000-0000-0000-0000-000000000001', days: 'c3000000-0000-0000-0000-000000000002',
                     override: 'c3000000-0000-0000-0000-000000000003', plain: 'c3000000-0000-0000-0000-000000000004' }
  const doneRows = (st, ids) => ids.map(id => `('${st}', '${id}', '2026-07-01 10:00:00+00', '2026-07-01 11:00:00+00', null)`).join(',\n')
  await d.exec(`
    insert into students (id, supabase_user_id, first_paid_at, whop_plan_id, membership_status)
    select ('c1000000-0000-0000-0000-00000000000' || n)::uuid, ('c1000000-0000-0000-0000-00000000000' || n)::uuid,
           case when n = 2 then now() - interval '10 days' else '2026-06-01 10:00:00+00' end,
           'plan_4ZrwR4PmBsVsx', 'active' from generate_series(1, 4) n;
    -- G1 graduates by l078; G2 at 80% on day 10; G3 one lesson short; G4 is in
    -- none of that and has no first login.
    insert into student_lesson_completions (student_id, lesson_id, completed_at, action_completed_at, skipped_at) values
      ('${G(1)}', 'l078', '2026-07-02 10:00:00+00', null, null),
      ('${G(1)}', 'l001', '2026-07-01 10:00:00+00', null, null),
      ${doneRows(G(2), pool.slice(0, need))},
      ${doneRows(G(3), pool.slice(0, need - 1))},
      ('${G(4)}', 'l002', '2026-06-20 10:00:00+00', null, null),
      ('${G(4)}', 'l003', null, null, '2026-06-15 09:00:00+00');
    insert into student_milestones (student_id, first_sprint_login_at, first_dashboard_login_at) values
      ('${G(1)}', '2026-06-01 12:00:00+00', null),
      ('${G(3)}', '2026-06-01 12:00:00+00', null),
      ('${G(4)}', null, '2026-06-14 08:00:00+00');
    insert into lesson_notes (student_id, lesson_id, content) values ('${G(1)}', 'l001', 'a note on the old course');
    insert into student_lesson_ratings (student_id, lesson_id, stars, comment) values ('${G(3)}', 'l002', 4, 'good');
    insert into quizzes (id, region_id, title) values ('cut_quiz_r1', 'r1', 'Foundation quiz');
    insert into quiz_questions (quiz_id, sort_order, question, options, correct_index) values
      ('cut_quiz_r1', 1, 'Which?', '["a","b"]', 0);
    insert into student_quiz_attempts (student_id, quiz_id, score, total, passed, answers) values
      ('${G(1)}', 'cut_quiz_r1', 1, 1, true, '[]');
    insert into student_region_quiz (student_id, region_id, quiz_passed_at, quiz_attempts) values ('${G(1)}', 'r1', now(), 1);
    insert into templates (id, scenario_id, bucket, title, trigger_description, is_custom, trigger_config) values
      ('${TEMPLATE.region}',   'custom.cut_region', 'at_risk',  'Region custom',   'x', true,
         '{"all":[{"metric":"region_lessons_watched","region":"r1","op":"at_least","value":3}]}'),
      ('${TEMPLATE.days}',     'custom.cut_days',   'at_risk',  'Days custom',     'x', true,
         '{"all":[{"metric":"days_since_last_completion","op":"at_least","value":5}]}'),
      ('${TEMPLATE.override}', 'stalled.cut_mid',   'at_risk',  'Built-in, tuned', 'x', false,
         '{"all":[{"metric":"progress_ratio","op":"at_most","value":0.2}]}'),
      ('${TEMPLATE.plain}',    'nolessons.cut3',    'at_risk',  'Built-in',        'x', false, null);
    insert into tasks (student_id, scenario_id, template_id, status, notes) values
      ('${G(1)}', 'nolessons.day3',    null, 'open', null),
      ('${G(1)}', 'noship.r1.day7',    null, 'open', 'Called once.'),
      ('${G(2)}', 'pace.day7',         null, 'open', null),
      ('${G(3)}', 'welcome.day1',      null, 'open', null),
      ('${G(4)}', 'custom.cut_region', '${TEMPLATE.region}', 'open', null),
      ('${G(3)}', 'custom.cut_days',   '${TEMPLATE.days}',   'open', null);
    insert into disengagement_alerts (student_id, alert_type, message) values
      ('${G(1)}', 'no_tasks_7d', 'x'), ('${G(2)}', 'no_lessons_3d', 'x'), ('${G(3)}', 'no_login_5d', 'x');
    insert into student_lesson_watch (student_id, lesson_id) values ('${G(1)}', 'l004');
    insert into lesson_videos (lesson_id, tella_video_id) values ('l004', '${CUTFAKE(1)}'), ('a1l01', '${CUTFAKE(2)}')
      on conflict (lesson_id) do nothing;
    update lessons_next set duration_seconds = coalesce(duration_seconds, 756) where id = 'a1l01';
    insert into achievements (id, name) values ('first_lesson', 'First Lesson'), ('r1_clear', 'R1 Clear') on conflict (id) do nothing;
    insert into student_achievements (student_id, achievement_id) values ('${G(1)}', 'first_lesson'), ('${G(1)}', 'r1_clear');`)

  // What the switch should do, worked out here from the rows and not from its SQL.
  const countsNow = async () => {
    const out = {}
    for (const t of ARCHIVED_WHOLE) out[t] = (await one(`select count(*)::int as n from public."${t}"`)).n
    out.student_lesson_watch = (await one(`select count(*)::int as n from student_lesson_watch where lesson_id not in (select id from lessons_next)`)).n
    out.lesson_videos = (await one(`select count(*)::int as n from lesson_videos where lesson_id not in (select id from lessons_next)`)).n
    return out
  }
  const expectations = async () => {
    const rows = await Q(`select c.student_id::text as s, c.completed_at, c.action_completed_at, c.skipped_at, l.requires_action, l.feature_key
                            from student_lesson_completions c join lessons l on l.id = c.lesson_id`)
    const n = (await one(`select count(*)::int as n from lessons where counts_toward_progress`)).n
    const per = {}, first = {}
    for (const x of rows) {
      const p = per[x.s] ??= { done: 0, l078: false }
      if (doneJs(x)) { p.done++; if (x.feature_key === 'playbook_unlock') p.l078 = true }
      const ts = [x.completed_at, x.skipped_at, x.action_completed_at].filter(Boolean).map(t => t.getTime())
      if (ts.length) first[x.s] = Math.min(first[x.s] ?? Infinity, ...ts)
    }
    const ms = Object.fromEntries((await Q(`select student_id::text as s, first_sprint_login_at as f from student_milestones`)).map(m => [m.s, m.f]))
    const grads = Object.keys(per).filter(s => per[s].l078 || per[s].done >= Math.ceil(0.8 * n)).sort()
    const logins = Object.fromEntries(Object.keys(first).filter(s => !ms[s]).sort().map(s => [s, first[s]]))
    const offTemplates = (await Q(`select id::text from templates where is_active and exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(trigger_config -> 'all') = 'array' then trigger_config -> 'all' else '[]' end) e
         where e ? 'lesson_id' or e ? 'region' or e ->> 'metric' in ('progress_ratio', 'progress_label', 'region_pace')) order by 1`)).map(x => x.id)
    const tasks = (await Q(`select id::text, scenario_id, template_id::text as t from tasks where status = 'open'`))
      .filter(k => /^(nolessons|noship|pace)\./.test(k.scenario_id) || offTemplates.includes(k.t)).map(k => k.id).sort()
    const alerts = (await Q(`select id::text from disengagement_alerts
                              where not is_dismissed and alert_type in ('no_tasks_7d', 'no_lessons_3d')`)).map(a => a.id).sort()
    const videosByArea = Object.fromEntries((await Q(`select n.region_id as a, count(v.lesson_id)::int as k from lessons_next n
        left join lesson_videos v on v.lesson_id = n.id group by 1`)).map(x => [x.a, x.k]))
    // Fixture students the switch stamps and who have no milestone row yet.
    const created = [...new Set([...grads, ...Object.keys(logins)])].filter(s => !(s in ms) && s.startsWith('c1')).sort()
    return { grads, logins, offTemplates, tasks, alerts, videosByArea, created, counts: await countsNow() }
  }
  const milestoneOf = async s => await one(`select playbook_unlocked_at, first_sprint_login_at from student_milestones where student_id = $1`, [s])

  // ── the two diagnostics, before the switch ──
  {
    const was = await everything()
    const pre = await runFile(d, preflight)
    const post = await runFile(d, postcheck)
    const want = await expectations()
    const row = item => pre.rows.find(x => x.item === item)?.found
    say(pre.ok && post.ok && await everything() === was,
        'before the switch: the preflight and the postcheck both run, and change nothing (every table, object and schema identical)',
        pre.ok ? (post.ok ? '' : said(post)) : said(pre))
    say(pre.ok && pre.rows.filter(x => x.part === 'a. keys' && x.expect === 'one of the six').length === 6
          && row('keys into lessons and regions') === '6, of them the six: 6'
          && row('not-null columns the copy leaves empty') === 'none'
          && row('graduates the switch stamps') === String(want.grads.length)
          && row('first logins the switch fills in') === String(Object.keys(want.logins).length)
          && row('open tasks the switch dismisses') === String(want.tasks.length)
          && row('open alerts the switch dismisses') === String(want.alerts.length)
          && row('templates the switch turns off') === String(want.offTemplates.length)
          && row('student_lesson_completions') === String(want.counts.student_lesson_completions)
          && row('lesson_videos (old lessons)') === String(want.counts.lesson_videos)
          && row('the gate') === 'a4l17' && row('with a Whop lesson id / distinct') === '141 / 141'
          && row('v103 ran (the column, the two area columns, the view, the floor)') === 'yes'
          && row('schema archive_v1') === 'absent' && row('admin_config curriculum_reset_at') === 'absent',
        "the preflight's rows: the six keys, nothing left empty, and graduates, logins, tasks, alerts, templates and archive counts as worked out here",
        pre.ok ? `grads ${row('graduates the switch stamps')}/${want.grads.length}, tasks ${row('open tasks the switch dismisses')}/${want.tasks.length}` : said(pre))
    say(post.ok && post.rows.length > 0 && post.rows.every(x => x.verdict === 'NOT SWITCHED'),
        'the postcheck before the switch says NOT SWITCHED on every row', post.ok ? [...new Set(post.rows.map(x => x.verdict))].join(',') : said(post))
  }

  // The preflight's lists h to k, on a copy: pending requests, rejections
  // either side of the launch (taken from discount.ts, so the SQL's cutoff
  // cannot drift from the app's), templates with day_number, and triggers on
  // the tables the switch writes (one made the way a dashboard webhook is).
  {
    const KNOWN_TRIGGERS = ['daily_progress_snapshots.trg_daily_snapshots_reset_floor', 'lesson_notes.lesson_notes_updated_at',
      'lesson_videos.trg_lesson_videos_updated_at', 'lessons.trg_lessons_updated_at',
      'student_lesson_ratings.trg_bump_student_lesson_ratings_updated_at', 'templates.trg_templates_updated_at']
    const LAUNCH = /DISCOUNT_LAUNCH_DATE = "([^"]+)"/.exec(
      fs.readFileSync(fileURLToPath(new URL('../../src/lib/world/discount.ts', import.meta.url)), 'utf8'))?.[1]
    const justBefore = new Date(Date.parse(LAUNCH) - 1).toISOString()
    const c = await d.clone()
    await c.exec(`
      insert into discount_requests (student_id, status, created_at, rejection_reason) values
        ('${G(1)}', 'pending',  '2026-10-12 10:00:00+00', null),
        ('${G(2)}', 'pending',  '2026-07-01 10:00:00+00', null),
        ('${G(3)}', 'rejected', '2026-10-13 10:00:00+00', 'not every video'),
        ('${G(4)}', 'rejected', '${LAUNCH}', null),
        ('${G(4)}', 'rejected', '${justBefore}', 'old course'),
        ('${G(1)}', 'approved', '2026-10-13 10:00:00+00', null);
      insert into templates (scenario_id, bucket, title, trigger_description, is_custom, is_active, trigger_config) values
        ('custom.cut_day_lessons', 'at_risk', 'Day and lessons', 'x', true, true,
           '{"all":[{"metric":"day_number","op":"at_least","value":5},{"metric":"total_lessons_watched","op":"is","value":0}]}'),
        ('custom.cut_day_region',  'at_risk', 'Day and region',  'x', true, true,
           '{"all":[{"metric":"day_number","op":"at_least","value":7},{"metric":"region_complete","region":"r1","op":"is_not"}]}'),
        ('custom.cut_day_off',     'at_risk', 'Day, inactive',   'x', true, false,
           '{"all":[{"metric":"day_number","op":"at_least","value":3}]}');
      -- base.sql leaves out v75's trigger on the ratings; production has it.
      create trigger trg_bump_student_lesson_ratings_updated_at before update on public.student_lesson_ratings
        for each row execute function public.set_updated_at();
      create function public._cut_hook() returns trigger language plpgsql as $$ begin return null; end $$;
      create trigger dashboard_webhook after delete on public.student_lesson_completions
        for each row execute function public._cut_hook();
      create trigger elsewhere_hook after insert on public.students
        for each row execute function public._cut_hook();`)
    const pre = await runFile(c, preflight)
    const ids = (await c.query(`select id::text, student_id::text as s, status, created_at from discount_requests`)).rows
    await c.close()
    const idOf = (s, status, at) => ids.find(x => x.s === s && x.status === status && x.created_at.getTime() === Date.parse(at))?.id
    const part = p => pre.rows.filter(x => x.part === p)
    const listed = p => part(p).filter(x => !/^(discount requests|active templates)/.test(x.item))
    const count = (p, item) => part(p).find(x => x.item === item)?.found
    const h = listed('h. pending'), i = listed('i. rejected'), j = listed('j. day_number')
    say(pre.ok && !!LAUNCH && h.length === 2 && count('h. pending', 'discount requests still pending') === '2'
          && h[0].item === `made 2026-07-01 10:00 UTC: request ${idOf(G(2), 'pending', '2026-07-01T10:00:00Z')}, student ${G(2)}`
          && h[1].item.includes(`request ${idOf(G(1), 'pending', '2026-10-12T10:00:00Z')}, student ${G(1)}`)
          && h.every(x => x.found === 'pending' && /before v104/.test(x.expect)),
        "the preflight's h. pending: every pending request, oldest first, with its id and student, and the count",
        pre.ok ? asJson(h.map(x => x.item)) : said(pre))
    say(pre.ok && i.length === 2 && count('i. rejected', 'discount requests rejected since the launch') === '2'
          && i.some(x => x.item.includes(idOf(G(3), 'rejected', '2026-10-13T10:00:00Z')) && x.found === 'rejected: not every video')
          && i.some(x => x.item.includes(idOf(G(4), 'rejected', LAUNCH)) && x.found === 'rejected: no reason given')
          && !!idOf(G(4), 'rejected', justBefore) && !i.some(x => x.item.includes(idOf(G(4), 'rejected', justBefore))),
        `the preflight's i. rejected: rejections from the launch instant on (${LAUNCH}, discount.ts), not one a millisecond before it, nor an approved request`,
        pre.ok ? asJson(i.map(x => `${x.item} | ${x.found}`)) : said(pre))
    say(pre.ok && j.length === 2 && count('j. day_number', 'active templates using day_number') === '2'
          && j.find(x => x.item === 'custom.cut_day_lessons: Day and lessons')?.expect.startsWith('stays on')
          && j.find(x => x.item === 'custom.cut_day_lessons: Day and lessons')?.found.includes('"total_lessons_watched"')
          && j.find(x => x.item === 'custom.cut_day_region: Day and region')?.expect === 'turned off by the switch'
          && !j.some(x => x.item.startsWith('custom.cut_day_off')),
        "the preflight's j. day_number: every active template with a day_number condition, its conditions in full, and which the switch turns off",
        pre.ok ? asJson(j.map(x => `${x.item} | ${x.expect}`)) : said(pre))
    const k = part('k. triggers').filter(x => x.item !== 'triggers on the tables the switch writes')
    const hook = k.find(x => x.item === 'student_lesson_completions.dashboard_webhook')
    const known = k.filter(x => x.expect === 'expected').map(x => x.item).sort()
    say(pre.ok && sameJson(known, KNOWN_TRIGGERS)
          && hook?.expect.startsWith('NOT expected') && /AFTER DELETE ON public\.student_lesson_completions/.test(hook.found)
          && k.length === 7 && !k.some(x => x.item.includes('elsewhere_hook'))
          && count('k. triggers', 'triggers on the tables the switch writes') === '7, of them expected: 6',
        "the preflight's k. triggers: the 6 the migrations make marked expected, a dashboard-made one on a wiped table NOT expected, one on a table the switch does not write left out",
        pre.ok ? asJson(k.map(x => `${x.item} | ${x.expect}`)) : said(pre))
  }

  // ── the guards: one copy of the database per broken starting point ──
  {
    const idx = (await one(`select indexdef from pg_indexes where indexname = 'lessons_next_whop_lesson_id_key'`))?.indexdef
    const cases = [
      ['v103 absent',                    undo103, 'Migration 2026_v103_cutover_expand.sql has not run here'],
      ['lesson_videos absent (v100)',    `alter table lesson_videos rename to lesson_videos_aside;`, 'public.lesson_videos does not exist'],
      ['a placeholder title in lessons_next', `update lessons_next set title = 'Introduction · lesson 1' where id = 'a1l01';`,
                                         'placeholder lessons'],
      ['a lesson without its Whop id',   `update lessons_next set whop_lesson_id = null where id = 'a3l07';`,
                                         'have no Whop lesson id: a3l07.'],
      ['one Whop id on two lessons',     `drop index lessons_next_whop_lesson_id_key;
                                          update lessons_next set whop_lesson_id = (select whop_lesson_id from lessons_next where id = 'a3l07') where id = 'a3l08';`,
                                         'are on more than one lesson of public.lessons_next'],
      ['7 areas',                        `delete from regions_next where id = 'a8';`,
                                         'it holds: a1:1, a2:2, a3:3, a4:4, a5:5, a6:6, a7:7.'],
      ['lessons already holding a1l01',  `insert into lessons (id, region_id, day, type, title, sort_order) values ('a1l01', 'r1', 1, 'watch', 'Early copy', 500);`,
                                         'already holds lessons of the new course (a1l01)'],
      ['a seventh key into lessons',     `create table public.lesson_bookmarks (student_id uuid, lesson_id text references lessons (id));`,
                                         'Found: lesson_bookmarks.lesson_id, lesson_notes.lesson_id, lessons.region_id'],
      ['archive_v1 present',             `create schema archive_v1;`, 'An archive from an earlier switch is still here'],
      ['a not-null column the copy leaves empty', `alter table lessons add column must_say text not null default 'x';
                                                   alter table lessons alter column must_say drop default;`, 'the copy does not fill them: lessons.must_say.'],
    ]
    for (const [what, breakIt, sentence] of cases) {
      const c = await d.clone()
      const broke = await runFile(c, breakIt)
      const was = await everything(c)
      const rr = await runFile(c, v104)
      say(broke.ok && refused(rr, sentence) && await everything(c) === was
            && sameJson(await archives(c), what === 'archive_v1 present' ? ['archive_v1'] : []),
          `v104 refuses with ${what}: it says so, and every table, object and schema is identical afterwards`,
          broke.ok ? said(rr) : `the break failed: ${said(broke)}`)
      await c.close()
    }
    say(!!idx, '(the unique index on lessons_next.whop_lesson_id was there to be dropped in the copy)', idx ?? 'missing')
  }

  // ── the lock: every table the file writes, locked before it reads one ──
  // A row a student commits between the archive copy and the wipe would be
  // lost without it. A second session cannot be staged here (PGlite is one
  // session, and a wait on a prepared transaction hangs it), so this proves
  // the list and the sentence, never a real wait. Three runs per file, each
  // on a copy: as written, with probes after the lock and before the commit;
  // with the lock taken out, to see which tables its own statements write;
  // and with the lock replaced by the error a timeout raises.
  {
    const LOCK_HEAD = '-- ─────────────── The lock ───────────────'
    const LOCK_SQL = `execute 'lock table ' || v_list || ' in access exclusive mode';`
    const relsIn = modes => `(select coalesce(string_agg(distinct c.relname::text, ',' order by c.relname::text), '')
        from pg_locks l join pg_class c on c.oid = l.relation
       where l.pid = pg_backend_pid() and l.locktype = 'relation' and c.relnamespace = 'public'::regnamespace
         and c.relkind in ('r', 'p') and ${modes})`
    const WRITE_MODES = `l.mode not in ('AccessShareLock', 'RowShareLock')`
    const probe = (sql, marker, name, what) => {
      const i = sql.indexOf(marker)
      return i < 0 ? sql : sql.slice(0, i) + `\nselect set_config('test.${name}', ${what}, false);\n` + sql.slice(i)
    }
    const unlocked = (sql, next) => { const a = sql.indexOf(LOCK_HEAD), b = sql.indexOf(next); return a < 0 || b < a ? sql : sql.slice(0, a) + sql.slice(b) }
    const setting = async (c, n) => (await c.query(`select coalesce(current_setting('test.${n}', true), '') as v`)).rows[0].v
    const list = s => s ? s.split(',').sort() : []
    const lockCase = async (base, sql, first) => {
      const out = {}
      let c = await base.clone()
      let rr = await runFile(c, probe(probe(probe(sql, first, 'locked_first', relsIn(`l.mode = 'AccessExclusiveLock'`)),
                                            first, 'timeout_first', `current_setting('lock_timeout')`),
                                      '\ncommit;\n', 'written', relsIn(WRITE_MODES)))
      out.ran = rr.ok ? 'ok' : said(rr)
      out.lockedFirst = list(await setting(c, 'locked_first'))
      out.timeout = await setting(c, 'timeout_first')
      out.writtenAsIs = list(await setting(c, 'written'))
      out.after = (await c.query(`select current_setting('lock_timeout') as v`)).rows[0].v
      await c.close()
      c = await base.clone()
      rr = await runFile(c, probe(unlocked(sql, first), '\ncommit;\n', 'written', relsIn(WRITE_MODES)))
      out.ranBare = rr.ok ? 'ok' : said(rr)
      out.writtenBare = list(await setting(c, 'written'))
      await c.close()
      c = await base.clone()
      const was = await everything(c)
      out.busy = await runFile(c, sql.replace(LOCK_SQL, `raise exception 'canceling statement due to lock timeout' using errcode = '55P03';`))
      out.busyUnchanged = await everything(c) === was
      await c.close()
      return out
    }
    const report = x => `locked first ${x.lockedFirst.length} [${x.timeout}], written ${x.writtenBare.length}`
                      + `${x.ran === 'ok' ? '' : ' / ' + x.ran}${x.ranBare === 'ok' ? '' : ' / bare: ' + x.ranBare}`
                      + `, missing ${x.writtenBare.filter(t => !x.lockedFirst.includes(t)).join(',') || 'none'}`
    const holds = x => x.ran === 'ok' && x.ranBare === 'ok' && x.writtenBare.length === 18 && sameJson(x.lockedFirst, x.writtenBare)
                       && x.writtenAsIs.every(t => x.lockedFirst.includes(t)) && x.timeout === '5s' && x.after === '0'
    const busySays = (x, who) => x.busy.code === '55P03' && x.busyUnchanged
                       && x.busy.said.includes(`so the ${who} did not start. Nothing was changed. Paste it again in a minute.`)

    const sw = await lockCase(d, v104, '-- ─────────────── 0. Already switched? ───────────────')
    say(holds(sw),
        'v104 locks, before its first read and with lock_timeout 5s, exactly the 18 tables its own statements write or alter (found by running it without the lock); nothing gets a write lock it did not take first',
        report(sw))
    say(busySays(sw, 'switch'),
        'v104 with its lock timing out (55P03, raised in place of the lock): "Nothing was changed. Paste it again in a minute.", and every table, object and schema identical',
        sw.busy.ok ? 'it ran' : `${sw.busy.code}: ${sw.busy.said.slice(0, 90)}`)

    const switched = await d.clone()
    const ran = await runFile(switched, v104)
    const un = await lockCase(switched, undo104, '-- ─────────────── 1. It can be undone ───────────────')
    await switched.close()
    say(ran.ok && holds(un),
        'the undo of v104 locks, before its first read and with lock_timeout 5s, exactly the 18 tables its own statements write or alter; nothing gets a write lock it did not take first',
        ran.ok ? report(un) : said(ran))
    say(ran.ok && busySays(un, 'undo'),
        'the undo with its lock timing out (55P03): "Nothing was changed. Paste it again in a minute.", and every table, object and schema identical',
        un.busy.ok ? 'it ran' : `${un.busy.code}: ${un.busy.said.slice(0, 90)}`)
  }

  // ── the switch ──
  // Checked after the first run and again after the switch that follows the
  // undo. `want` is worked out before each run.
  const switchHolds = async (r, want, labelOf) => {
    const reset = await theKey()
    const meta = await one(`select to_char(reset_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at, ran_by, counts from archive_v1.meta`)
    say(r.ok && r.cols.join(',') === SWITCH_COLS && r.rows.length === 20 && r.rows[0].value === `The switch ran now, at ${reset}.`,
        labelOf('its result table: 20 rows, the first saying the switch ran now'), r.ok ? r.rows[0].value : said(r))
    const areaWant = COURSE.areas.map(a => {
      const ls = COURSE.lessons.filter(l => l.area === a.id)
      return [a.id, a.name, ls.length, ls.filter(l => l.counts !== false).length, ls.filter(l => 'action_brief' in l).length,
              want.videosByArea[a.id] ?? 0, ls.length]
    })
    const areaGot = r.ok ? r.rows.slice(1, 9).map(x => [x.line, x.name, x.lessons, x.counting, x.action_items, x.with_video, x.with_whop_id]) : []
    const tot = r.rows[9] ?? {}
    say(sameJson(areaGot, areaWant) && tot.line === 'total' && tot.lessons === 141 && tot.counting === 140 && tot.action_items === 10 && tot.with_whop_id === 141,
        labelOf("...one row per area as the data file has it, with a Whop id on every lesson, and a total of 141, 140 counting, 10 action items"),
        areaGot.map(x => `${x[0]}:${x[2]}/${x[5]}v`).join(' '))
    const sum = Object.fromEntries((r.rows ?? []).slice(10).map(x => [x.line, x.value]))
    say(sum.reset_at === reset && sum.archived_completions === String(want.counts.student_lesson_completions)
          && sum.archived_notes === String(want.counts.lesson_notes) && sum.archived_ratings === String(want.counts.student_lesson_ratings)
          && sum.archived_badges === String(want.counts.student_achievements) && sum.graduates_stamped === String(want.grads.length)
          && sum.logins_backfilled === String(Object.keys(want.logins).length) && sum.tasks_dismissed === String(want.tasks.length)
          && sum.alerts_dismissed === String(want.alerts.length) && sum.templates_deactivated === String(want.offTemplates.length),
        labelOf('...and its summary rows are the counts worked out here before the run'), asJson(sum))
    say(ISO_Z.test(reset ?? '') && meta?.at === reset && Math.abs(Date.parse(reset) - Date.now()) < 120000 && !!meta.ran_by,
        labelOf('admin_config curriculum_reset_at holds the moment in UTC (like 2026-10-20T18:25:00.000Z), the same as archive_v1.meta'), `${reset} ran_by=${meta?.ran_by}`)
    const metaCounts = meta?.counts ?? {}
    const archived = {}
    for (const t of Object.keys(want.counts)) archived[t] = (await one(`select count(*)::int as n from archive_v1."${t}"`)).n
    say(sameJson(archived, want.counts) && Object.keys(want.counts).every(t => Number(metaCounts[t]) === want.counts[t]),
        labelOf('every archive copy holds what the live table held before the run, and meta says the same'), asJson(archived))
    say(asJson(await Q(`select ${LESSON_COPY} from lessons order by id`)) === asJson(await Q(`select ${LESSON_COPY} from lessons_next order by id`))
          && asJson(await Q(`select ${REGION_COPY} from regions order by id`)) === asJson(await Q(`select ${REGION_COPY} from regions_next order by id`)),
        labelOf('lessons and regions equal lessons_next and regions_next on every copied column: Whop ids, lengths, texts, gate and feature keys'))
    const left = {}
    for (const t of WIPED) left[t] = (await one(`select count(*)::int as n from public."${t}"`)).n
    say(Object.values(left).every(n => n === 0), labelOf('every progress table is empty'), asJson(left))
    const ach = (await Q(`select id from achievements order by id`)).map(x => x.id)
    say(!ach.some(a => RETIRED.includes(a)) && sameJson(ach, want.achievements.filter(a => !RETIRED.includes(a))),
        labelOf('achievements lacks the six retired badges and keeps every other'), ach.join(','))
    // stamps
    const stamped = (await Q(`select student_id::text as s from student_milestones where playbook_unlocked_at is not null order by 1`)).map(x => x.s)
    const stampAt = (await Q(`select distinct playbook_unlocked_at from student_milestones where playbook_unlocked_at is not null`))
    const g = await Promise.all([1, 2, 3, 4].map(n => milestoneOf(G(n))))
    say(sameJson(stamped, want.grads) && stamped.includes(G(1)) && stamped.includes(G(2)) && !stamped.includes(G(3)) && !stamped.includes(G(4))
          && stampAt.length === 1 && stampAt[0].playbook_unlocked_at.toISOString() === reset,
        labelOf('the Playbook is stamped at the moment on exactly the graduates worked out here: the one by l078 and the one at 80% on day 10, not the one at 79%'),
        `${stamped.length} stamped`)
    const loginsGot = Object.fromEntries((await Q(`select m.student_id::text as s, m.first_sprint_login_at as f from student_milestones m
                                                    join archive_v1.stamps s on s.student_id = m.student_id where s.set_first_login order by 1`))
                                          .map(x => [x.s, x.f.getTime()]))
    say(sameJson(loginsGot, want.logins) && g[3]?.first_sprint_login_at?.toISOString() === '2026-06-15T09:00:00.000Z'
          && g[0]?.first_sprint_login_at?.toISOString() === '2026-06-01T12:00:00.000Z' && g[2]?.first_sprint_login_at?.toISOString() === '2026-06-01T12:00:00.000Z',
        labelOf("first logins filled in on exactly the students worked out here; the fourth gets the earliest of its times (a skip at 09:00 on 15 June); the two who had one keep theirs"),
        `${Object.keys(loginsGot).length} filled`)
    const created = (await one(`select string_agg(student_id::text, ',' order by student_id::text) as s from archive_v1.stamps
                                 where not row_existed and student_id::text like 'c1%'`)).s
    say(created === (want.created.join(',') || null),
        labelOf('of the fixtures, a milestone row is created only for a stamped student who had none, as worked out here'), created ?? 'none')
    // CSM
    const tasks = Object.fromEntries((await Q(`select scenario_id, status, notes, dismissed_at from tasks where student_id::text like 'c1%'`))
                                     .map(k => [k.scenario_id, k]))
    const NOTE = "Dismissed by the course switch: the old course's progress was reset."
    const gone = ['nolessons.day3', 'noship.r1.day7', 'pace.day7', 'custom.cut_region']
    say(gone.every(s => tasks[s]?.status === 'dismissed' && tasks[s].dismissed_at?.toISOString() === reset && tasks[s].notes?.endsWith(NOTE))
          && tasks['noship.r1.day7']?.notes === `Called once.\n${NOTE}` && tasks['nolessons.day3']?.notes === NOTE
          && tasks['welcome.day1']?.status === 'open' && tasks['custom.cut_days']?.status === 'open',
        labelOf('tasks: nolessons, noship, pace and the one of the region template dismissed at the moment with the note (after a note that was there); welcome.day1 and the days-only template\'s task open'),
        Object.entries(tasks).map(([s, k]) => `${s}:${k.status}`).join(' '))
    const tmpl = Object.fromEntries((await Q(`select id::text, is_active from templates where id::text like 'c3%'`)).map(t => [t.id, t.is_active]))
    say(tmpl[TEMPLATE.region] === false && tmpl[TEMPLATE.override] === false && tmpl[TEMPLATE.days] === true && tmpl[TEMPLATE.plain] === true,
        labelOf('templates: the region one and the built-in with a progress_ratio override off; the days-only one and a built-in with no trigger on'), asJson(tmpl))
    const alerts = Object.fromEntries((await Q(`select alert_type, is_dismissed, dismissed_at from disengagement_alerts where student_id::text like 'c1%'`))
                                      .map(a => [a.alert_type, a]))
    say(alerts.no_tasks_7d?.is_dismissed && alerts.no_lessons_3d?.is_dismissed && alerts.no_tasks_7d.dismissed_at?.toISOString() === reset
          && alerts.no_login_5d?.is_dismissed === false,
        labelOf('alerts: no_tasks_7d and no_lessons_3d dismissed, no_login_5d open'))
    const l004 = await one(`select (select count(*)::int from student_lesson_watch where lesson_id = 'l004') as watch,
                                   (select count(*)::int from lesson_videos where lesson_id = 'l004') as video,
                                   (select count(*)::int from archive_v1.student_lesson_watch where lesson_id = 'l004') as watch_kept,
                                   (select count(*)::int from archive_v1.lesson_videos where lesson_id = 'l004') as video_kept`)
    say(l004.watch === 0 && l004.video === 0 && l004.watch_kept === 1 && l004.video_kept === 1
          && asJson(await Q(`select * from lesson_videos where lesson_id = 'a1l01'`)) === want.a1l01video,
        labelOf('the watch row and the video row on l004 are archived and gone; the video row on a1l01 is untouched'), asJson(l004))
    // keys
    const keys = await Q(`select conname, confdeltype, conrelid::regclass::text as t from pg_constraint
                           where contype = 'f' and confrelid in ('public.lessons'::regclass, 'public.regions'::regclass) order by conname collate "C"`)
    say(sameJson(keys.map(k => k.conname), SIX) && keys.every(k => k.confdeltype === 'r'),
        labelOf('the keys: exactly the six names, all ON DELETE RESTRICT, and nothing else points at lessons or regions'), keys.map(k => k.conname).join(','))
    const priv = await one(`select
        bool_or(has_schema_privilege(r, 'archive_v1', 'usage')) as usage,
        (select count(*)::int from pg_class c, aclexplode(c.relacl) a
          where c.relnamespace = 'archive_v1'::regnamespace and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)) as grants,
        (select count(*)::int from pg_class where relnamespace = 'archive_v1'::regnamespace and relkind = 'r') as tables
      from unnest(array['anon', 'authenticated', 'service_role']) r`)
    // 14 copies, then meta, stamps, csm_changes, constraints, not_nulls.
    say(priv.usage === false && priv.grants === 0 && priv.tables === 19,
        labelOf('archive_v1: 19 tables, and anon, authenticated and service_role hold no usage on the schema and no grant on any table'), asJson(priv))
    // no other archive got made
    say(sameJson((await archives()).filter(n => n === 'archive_v1'), ['archive_v1']), labelOf('the schema archive_v1 exists'))
  }

  const wantFirst = await expectations()
  wantFirst.achievements = (await Q(`select id from achievements order by id`)).map(x => x.id)
  wantFirst.a1l01video = asJson(await Q(`select * from lesson_videos where lesson_id = 'a1l01'`))
  // student_milestones is compared on its own after the undo: the first
  // logins the switch fills in stay.
  const dataBefore104 = await dataDump(d, { daily_progress_snapshots: true, templates: ['updated_at'], student_milestones: true })
  const msBefore104 = Object.fromEntries((await Q(`select * from student_milestones`)).map(m => [m.student_id, m]))
  const objectsBefore104 = await objectDump()

  r = await runFile(d, v104)
  say(r.ok, 'v104 first run executes', said(r))
  if (!r.ok) return
  await switchHolds(r, wantFirst, l => l)

  // The keys and the index at work.
  {
    const e = await d.transaction(async tx => {
      await tx.exec(`insert into student_lesson_completions (student_id, lesson_id, completed_at) values ('${G(1)}', 'a1l02', now());`)
      const err = await tx.query(`delete from lessons where id = 'a1l02'`).then(() => null, x => x)
      await tx.rollback()
      return err
    }).catch(x => x)
    say(e?.code === '23503' && /fk_student_lesson_completions_lesson_id/.test(e.message ?? ''),
        'deleting a lesson that has a completion is refused by fk_student_lesson_completions_lesson_id (RESTRICT)', e ? `${e.code}: ${e.message?.slice(0, 70)}` : 'it went through')
    const w = await raisesOn(d, `update lessons set whop_lesson_id = (select whop_lesson_id from lessons where id = 'a3l07') where id = 'a3l08'`)
    say(w?.code === '23505' && /lessons_whop_lesson_id_key/.test(w.message), 'an update giving two lessons one Whop id is refused by lessons_whop_lesson_id_key',
        w ? `${w.code}` : 'it went through')
  }

  // The app's SQL after the switch.
  {
    const views = await one(`select (select count(*)::int from student_progress_counts) as counts,
                                    (select count(*)::int from student_current_region) as regions`)
    const e = await raisesOn(d, `select public.rebuild_daily_snapshots(current_date, current_date)`)
    const snap = await one(`select total_lessons, total_completions, avg_progress::text as avg from daily_progress_snapshots where snapshot_date = current_date`)
    await d.exec(`select set_config('test.uid', '${G(1)}', false);`)
    const beat = await d.query(`select public.record_lesson_heartbeat('a1l01', 0, 756, 0, false) as j`).then(x => x.rows[0].j, x => ({ raised: x.message }))
    const lesson = await one(`select type, duration_seconds from lessons where id = 'a1l01'`)
    say(views.counts === 0 && views.regions === 0, 'after the switch student_progress_counts and student_current_region are empty', asJson(views))
    say(e === null && snap?.total_lessons === 140 && snap.total_completions === 0,
        'the snapshot RPC for today runs on the new catalog: 140 lessons count, 0 completions', e?.message ?? asJson(snap))
    say(beat.accepted === true && lesson.type === 'watch' && lesson.duration_seconds > 0,
        'the heartbeat RPC accepts a beat on a new watch lesson with a video row and a length (a1l01)', beat.raised ?? `accepted=${beat.accepted}`)
  }

  // admin-health.sql, INVARIANT 6, after the switch.
  {
    const health = diagnostic('admin-health.sql')
    const at = health.indexOf('WITH total_lessons AS (', health.indexOf('-- INVARIANT 6'))
    const END = 'FROM live_avg la CROSS JOIN snap;'
    const inv6 = health.slice(at, health.indexOf(END, at) + END.length)
    const total = inv6.slice(0, inv6.indexOf('),\ncohort AS')) + ')\nSELECT n::int AS n FROM total_lessons'
    const v = await Q(inv6).catch(x => [{ verdict: x.message }])
    const n = await Q(total).catch(() => [{ n: null }])
    say(at > 0 && !inv6.includes("'l057'") && n[0]?.n === 140 && v[0]?.verdict === 'OK',
        'admin-health.sql INVARIANT 6 after the switch: its denominator reads counts_toward_progress (140), and live and snapshot agree (OK)',
        `${n[0]?.n} lessons, ${v[0]?.verdict}`)
  }

  // Run again.
  {
    const was = await everything()
    const key = await theKey()
    const rr = await runFile(d, v104)
    say(rr.ok && rr.rows[0]?.value === `The switch is already in place since ${key}. This run changed nothing.` && rr.rows.length === 20
          && await everything() === was,
        'v104 run again: "The switch is already in place since <time>", the same table, and every table, object and schema identical', rr.ok ? rr.rows[0].value : said(rr))
  }

  // v101 after the switch (C20).
  {
    const was = await everything()
    const rr = await runFile(d, read(V101F))
    say(refused(rr, `The course is live in public.lessons since the switch of ${await theKey()}; this file changes only the staging tables.`)
          && await everything() === was,
        'v101 after the switch refuses: the course is live in public.lessons, and it changes nothing', said(rr))
  }

  // The two diagnostics after the switch, and the hand stamp.
  {
    const was = await everything()
    const pre = await runFile(d, preflight)
    const post = await runFile(d, postcheck)
    say(pre.ok && post.ok && await everything() === was,
        'after the switch: the preflight and the postcheck both run, and change nothing', pre.ok ? said(post) : said(pre))
    const checks = post.rows.filter(x => x.verdict !== 'INFO')
    say(post.ok && checks.length === 12 && checks.every(x => x.verdict === 'PASS') && post.rows.some(x => x.verdict === 'INFO')
          && post.rows.find(x => x.item === 'watch rows with a heartbeat since / of them past 95%')?.found === '1 / 0',
        "the postcheck's 12 checks all PASS, and its INFO rows count since the switch (the one heartbeat above)",
        post.ok ? checks.filter(x => x.verdict !== 'PASS').map(x => `${x.item}: ${x.found}`).join(' | ') : said(post))
    const optional = postcheck.slice(postcheck.indexOf('\n-- OPTIONAL')).split('\n').filter(l => /^--    /.test(l)).map(l => l.slice(2)).join('\n')
    const c = await d.clone()
    const blank = await runFile(c, optional)
    const stampsOf = async () => asJson(await c.query(`select student_id::text, playbook_unlocked_at from student_milestones order by 1`).then(x => x.rows))
    const before = await stampsOf()
    const filled = await runFile(c, optional.replace('REPLACE_WITH_STUDENT_ID', G(3)))
    const g3 = (await c.query(`select playbook_unlocked_at from student_milestones where student_id = '${G(3)}'`)).rows[0]?.playbook_unlocked_at
    const g1Before = (await c.query(`select playbook_unlocked_at from student_milestones where student_id = '${G(1)}'`)).rows[0]?.playbook_unlocked_at
    const again = await runFile(c, optional.replace('REPLACE_WITH_STUDENT_ID', G(1)))
    const g1After = (await c.query(`select playbook_unlocked_at from student_milestones where student_id = '${G(1)}'`)).rows[0]?.playbook_unlocked_at
    const others = asJson(JSON.parse(await stampsOf()).filter(x => x.student_id !== G(3)))
    say(!blank.ok && filled.ok && again.ok && g3 instanceof Date && g1After?.getTime() === g1Before?.getTime()
          && others === asJson(JSON.parse(before).filter(x => x.student_id !== G(3))),
        "the postcheck's hand stamp: with its placeholder it fails; filled, it stamps that one student, keeps a stamp already there, and touches no other",
        `blank ${said(blank)}`)
    await c.close()
  }

  // Progress made after the switch, then the undo.
  await d.exec(`
    insert into student_lesson_completions (student_id, lesson_id, completed_at) values ('${G(1)}', 'a1l01', now());
    insert into lesson_notes (student_id, lesson_id, content) values ('${G(1)}', 'a1l02', 'a note on the new course');
    insert into student_achievements (student_id, achievement_id) values ('${G(1)}', 'first_lesson');`)

  // A CSM note written after the switch survives the undo (on a copy).
  {
    const NOTE = "Dismissed by the course switch: the old course's progress was reset."
    const c = await d.clone()
    await c.exec(`update tasks set notes = notes || E'\\nCalled her again after the switch.'
                   where student_id = '${G(1)}' and scenario_id = 'noship.r1.day7';`)
    const rr = await runFile(c, undo104)
    const t = Object.fromEntries((await c.query(`select scenario_id, status, notes from tasks where student_id::text like 'c1%'`)).rows
                                   .map(k => [k.scenario_id, k]))
    await c.close()
    say(rr.ok && rr.rows[0]?.task_notes_kept === 1 && rr.rows[0]?.tasks_reopened === wantFirst.tasks.length
          && t['noship.r1.day7']?.status === 'open' && t['noship.r1.day7'].notes === `Called once.\n${NOTE}\nCalled her again after the switch.`
          && t['nolessons.day3']?.status === 'open' && t['nolessons.day3'].notes === null && t['pace.day7']?.notes === null,
        "the undo reopens a task whose notes the team changed after the switch and keeps the team's notes word for word (task_notes_kept 1); the other reopened tasks get their notes back exactly",
        rr.ok ? `kept ${rr.rows[0]?.task_notes_kept}: ${asJson(t['noship.r1.day7']?.notes)}` : said(rr))
  }

  {
    const rr = await runFile(d, undo104)
    const row = rr.rows[0] ?? {}
    say(rr.ok && /^archive_v1_undone_\d{8}_\d{4}$/.test(row.archive_renamed_to ?? '') && row.moved_completions === 1 && row.moved_notes === 1
          && row.moved_badges === 1 && row.moved_watch_rows === 1 && row.restored_completions === wantFirst.counts.student_lesson_completions
          && row.restored_notes === wantFirst.counts.lesson_notes && row.restored_badges === wantFirst.counts.student_achievements
          && row.not_restored_student_gone === 0 && row.not_restored_video_taken === 0 && row.tasks_left_dismissed === 0
          && row.task_notes_kept === 0
          && row.tasks_reopened === wantFirst.tasks.length && row.alerts_reopened === wantFirst.alerts.length
          && row.templates_reactivated === wantFirst.offTemplates.length,
        'the undo runs: its row names the renamed archive, what moved to archive_v2 and what came back, with nothing left behind',
        rr.ok ? asJson(row) : said(rr))
    const v2 = await one(`select
        (select count(*)::int from archive_v2.student_lesson_completions where lesson_id = 'a1l01' and student_id = '${G(1)}') as completion,
        (select count(*)::int from archive_v2.lesson_notes where lesson_id = 'a1l02') as note,
        (select count(*)::int from archive_v2.student_achievements where achievement_id = 'first_lesson' and student_id = '${G(1)}') as badge,
        (select count(*)::int from archive_v2.student_lesson_watch where lesson_id = 'a1l01') as watch`).catch(x => ({ error: x.message }))
    say(v2.completion === 1 && v2.note === 1 && v2.badge === 1 && v2.watch === 1,
        'the completion, the note, the badge and the watch row made after the switch are in archive_v2', asJson(v2))
    const dataNow = await dataDump(d, { daily_progress_snapshots: true, templates: ['updated_at'], student_milestones: true })
    let firstOff = ''
    if (dataNow !== dataBefore104) {
      const a = JSON.parse(dataBefore104), b = JSON.parse(dataNow)
      firstOff = Object.keys({ ...a, ...b }).find(t => asJson(a[t]) !== asJson(b[t])) ?? ''
    }
    say(dataNow === dataBefore104,
        'after the undo every table in public equals the dump taken before v104 (snapshot rows aside, templates.updated_at, which its trigger stamps, and student_milestones, checked next)',
        firstOff ? `first difference in ${firstOff}` : '')
    // student_milestones: as before v104, plus the first logins the switch
    // filled in, on the rows that had none and on the rows it created.
    {
      const now = Object.fromEntries((await Q(`select * from student_milestones`)).map(m => [m.student_id, m]))
      const logins = wantFirst.logins
      const withoutLogin = m => { const o = { ...m }; delete o.first_sprint_login_at; return asJson(o) }
      const off = []
      for (const [s, b] of Object.entries(msBefore104)) {
        const a = now[s]
        if (!a) { off.push(`${s.slice(-2)} gone`); continue }
        const want = b.first_sprint_login_at?.getTime() ?? logins[s] ?? null
        if ((a.first_sprint_login_at?.getTime() ?? null) !== want) off.push(`${s.slice(-2)} login`)
        if (withoutLogin(a) !== withoutLogin(b)) off.push(`${s.slice(-2)} other columns`)
      }
      const added = Object.keys(now).filter(s => !(s in msBefore104)).sort()
      for (const s of added) {
        if (now[s].first_sprint_login_at?.getTime() !== logins[s] || now[s].playbook_unlocked_at !== null) off.push(`${s.slice(-2)} added`)
      }
      say(off.length === 0 && sameJson(added, Object.keys(logins).filter(s => !(s in msBefore104)).sort()) && added.includes(G(2))
            && now[G(4)]?.first_sprint_login_at?.toISOString() === '2026-06-15T09:00:00.000Z',
          "the undo keeps every first login the switch filled in (the student's earliest completion) and the rows created to hold one; every other column of student_milestones is as before v104",
          `${Object.keys(logins).length} logins, ${added.length} rows added${off.length ? ', off: ' + off.join(' ') : ''}`)
    }
    say(await objectDump() === objectsBefore104,
        '...and every column with its not-null flag and default, every constraint definition (the six keys under their old names, the day and terrain checks), every index, view, function and trigger')
    const sch = await archives()
    say(!sch.includes('archive_v1') && sch.includes('archive_v2') && sch.some(n => /^archive_v1_undone_\d{8}_\d{4}$/.test(n)) && await theKey() === null,
        'archive_v1 is renamed, archive_v2 holds the new-course rows, and curriculum_reset_at is gone', sch.join(','))
  }

  // The undo refuses.
  {
    let was = await everything()
    let rr = await runFile(d, undo104)
    say(refused(rr, 'admin_config holds no curriculum_reset_at') && await everything() === was,
        'the undo refuses with no curriculum_reset_at, and changes nothing', said(rr))
  }

  // Switch again after the undo.
  {
    const wantAgain = await expectations()
    wantAgain.achievements = (await Q(`select id from achievements order by id`)).map(x => x.id)
    wantAgain.a1l01video = asJson(await Q(`select * from lesson_videos where lesson_id = 'a1l01'`))
    const rr = await runFile(d, v104)
    say(rr.ok && sameJson(wantAgain.grads, wantFirst.grads) && wantAgain.tasks.length === wantFirst.tasks.length
          && sameJson(wantFirst.created, [G(2)]) && sameJson(wantAgain.created, []),
        'v104 runs again after the undo, on the same graduates and the same open tasks; the row the first switch created for the graduate on day 10 is still there, so none is created', said(rr))
    if (rr.ok) await switchHolds(rr, wantAgain, l => `switch again: ${l}`)

    let was = await everything()
    let ur = await runFile(d, undo104)
    say(refused(ur, 'The schema archive_v2 exists') && await everything() === was,
        'the undo refuses while archive_v2 is present, and changes nothing', said(ur))
    const c = await d.clone()
    await c.exec(`alter schema archive_v1 rename to archive_v1_set_aside;`)
    was = await everything(c)
    ur = await runFile(c, undo104)
    say(refused(ur, 'archive_v1.meta is missing') && await everything(c) === was,
        'the undo refuses with archive_v1 missing, and changes nothing', said(ur))
    await c.close()
  }
}

await cutover(db, '')
{
  const d2 = await chainDatabase()
  await cutover(d2, 'second database')
  await d2.close()
}

// ════════════════════════════════════════════════════════════════════
// 25 and 26: the database fixes of the backend audit of 15 October
// (_admin/prds/map-review-2026-10-15/backend_readiness.md, section 5 items
// 1, 2 and 27, section 6 steps 2 and 3) and T-057: v105, v106, their undos,
// and diagnostics/backend-readiness-read.sql.
// ════════════════════════════════════════════════════════════════════
// A database of their own: base.sql and the chain v92 to v101
// (chainDatabase), then the policies production has on the three tables,
// lifted verbatim from v3, schema.sql, the team_members recursion fix, v53
// and v55, and the feedback form's two tables and function from v29.
// The seam, widened as on Supabase: the API roles hold the table
// privileges, row level security does the filtering, service_role bypasses
// it, and a new schema or table anywhere is born open to the API roles.
// What a student's session could send is run for real, under SET ROLE
// authenticated with auth.uid() set, inside a transaction that is rolled
// back. These sections test what the policies do, not only that they exist.

const V105F = '2026_v105_close_student_write_policies.sql'
const V106F = '2026_v106_one_pending_discount_request.sql'
const V107F = '2026_v107_feedback_function_server_only.sql'
// Section 26's database as it ends (v105 and v106 in), kept for section 27.
let feedbackDb = null
const READ_OWN = 'Students can read own lesson completions'
const DOORS = [['student_lesson_completions', 'Students can manage own lesson completions'],
               ['discount_requests', 'Students can create discount requests'],
               ['student_achievements', 'student_achievements: student writes own']]
const UID = n => `00000000-0000-0000-0000-00000000000${n}`
const TEAM_ID = 'c5000000-0000-0000-0000-000000000001'
const ONE_PENDING = `CREATE UNIQUE INDEX discount_requests_one_pending_per_student ON public.discount_requests USING btree (student_id) WHERE (status = 'pending'::text)`
const LOCK105 = `execute 'lock table ' || v_list || ' in access exclusive mode';`
const LOCK106 = 'lock table public.discount_requests in share mode;'
const TIMED_OUT = `raise exception 'canceling statement due to lock timeout' using errcode = '55P03';`

// Statements sent as an API role, inside a transaction that is rolled back:
// what they would do, never kept. uid is auth.uid(), team is
// current_user_is_team(). `check` runs after them as the owner, still inside.
const asRole = async (d, role, statements, { uid = '', team = false, check = null } = {}) => {
  await d.exec('begin;')
  try {
    await d.exec(`set local role ${role};
                  select set_config('test.uid', '${uid}', true), set_config('test.is_team', '${team}', true);`)
    let last = null
    for (const s of [].concat(statements)) last = await d.query(s)
    let checked = null
    if (check) { await d.exec('reset role;'); checked = (await d.query(check)).rows }
    return { ok: true, rows: last?.rows ?? [], n: last?.affectedRows ?? 0, checked }
  } catch (e) {
    return { ok: false, code: e.code, said: e.message }
  } finally {
    await d.exec('rollback;')
  }
}
const asStudent = (d, n, statements, opts = {}) => asRole(d, 'authenticated', statements, { uid: UID(n), ...opts })
const rlsRefused = r => !r.ok && r.code === '42501' && /row-level security/.test(r.said)
const stopped = (r, sentence) => !r.ok && r.code === 'P0001' && r.said.includes(sentence) && /Nothing was changed\.$/.test(r.said)
const told = r => r.ok ? asJson(r.rows?.[0] ?? {}).slice(0, 110) : `${r.code}: ${(r.said ?? '').slice(0, 110)}`
// The policies on the three tables, with their comments.
const policiesOn = async d => asJson((await d.query(`
  select p.tablename::text as t, p.policyname::text as n, p.permissive, p.roles::text as roles, p.cmd, p.qual, p.with_check,
         obj_description(pol.oid, 'pg_policy') as comment
    from pg_policies p
    join pg_policy pol on pol.polrelid = format('%I.%I', p.schemaname, p.tablename)::regclass and pol.polname = p.policyname
   where p.schemaname = 'public' and p.tablename in ('student_lesson_completions', 'discount_requests', 'student_achievements')
   order by 1, 2`)).rows)
// Every policy, row level security flag, schema, table, index, grant and
// public function, outside the system schemas.
const catalogOf = async d => asJson({
  policies:  (await d.query(`select p.schemaname::text as s, p.tablename::text as t, p.policyname::text as n, p.permissive, p.roles::text as roles,
                                    p.cmd, p.qual, p.with_check, obj_description(pol.oid, 'pg_policy') as comment
                               from pg_policies p
                               join pg_policy pol on pol.polrelid = format('%I.%I', p.schemaname, p.tablename)::regclass and pol.polname = p.policyname
                              order by 1, 2, 3`)).rows,
  rls:       (await d.query(`select oid::regclass::text as t, relrowsecurity as rls_on, relforcerowsecurity as rls_forced from pg_class
                              where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).rows,
  schemas:   (await d.query(`select nspname::text as n from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema' order by 1`)).rows,
  tables:    (await d.query(`select schemaname::text as s, tablename::text as t from pg_tables
                              where schemaname !~ '^pg_' and schemaname <> 'information_schema' order by 1, 2`)).rows,
  indexes:   (await d.query(`select schemaname::text as s, indexname::text as n, indexdef from pg_indexes
                              where schemaname !~ '^pg_' and schemaname <> 'information_schema' order by 1, 2`)).rows,
  grants:    (await d.query(`select table_schema::text as s, table_name::text as t, grantee::text as g, privilege_type::text as p
                               from information_schema.role_table_grants
                              where table_schema !~ '^pg_' and table_schema <> 'information_schema' order by 1, 2, 3, 4`)).rows,
  functions: (await d.query(`select oid::regprocedure::text as f, prosecdef, pg_get_userbyid(proowner)::text as owner from pg_proc
                              where pronamespace = 'public'::regnamespace order by 1`)).rows,
})
// Every row of every table in public, as sorted JSON.
const rowsOf = async d => {
  const out = {}
  for (const { t } of (await d.query(`select tablename::text as t from pg_tables where schemaname = 'public' order by 1`)).rows)
    out[t] = (await d.query(`select * from public."${t}"`)).rows.map(x => asJson(x)).sort()
  return asJson(out)
}
const stateOf = async d => await catalogOf(d) + await rowsOf(d)
// A statement put into a file just before `marker`, keeping a value in a
// session setting; and what is in it afterwards, with lock_timeout as it is
// after the file.
const probeAt = (sql, marker, name, what) => {
  const i = sql.indexOf(marker)
  return i < 0 ? sql : sql.slice(0, i) + `select set_config('test.${name}', ${what}, false);\n` + sql.slice(i)
}
const probed = async (d, name) => (await d.query(`select coalesce(current_setting('test.${name}', true), '') as v,
                                                         current_setting('lock_timeout') as after`)).rows[0]
const lockedIn = mode => `(select coalesce(string_agg(distinct c.relname::text, ',' order by c.relname::text), '')
    from pg_locks l join pg_class c on c.oid = l.relation
   where l.pid = pg_backend_pid() and l.locktype = 'relation' and c.relnamespace = 'public'::regnamespace
     and c.relkind = 'r' and l.mode = '${mode}')`

console.log('\n=== 25. v105: students only read their completions, discount requests and badges; its undo; the backend read ===')
const policyDb = await chainDatabase()
{
  const d = policyDb
  const v105 = read(V105F)
  const undo105 = undoText('2026_v105_undo.sql')
  const readSql = diagnostic('backend-readiness-read.sql')
  const V29F = '2026_v29_discount_feedback.sql'

  // The seam, as on Supabase.
  await d.exec(`
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    alter role service_role bypassrls;
    alter default privileges grant all on tables to anon, authenticated, service_role;
    alter default privileges grant usage on schemas to anon, authenticated, service_role;`)
  // The feedback form (v29): its two tables, its function and its grant.
  for (const sql of [lift(V29F, 'create table if not exists discount_feedback_questions ('),
                     lift(V29F, 'create table if not exists discount_feedback_responses ('),
                     lift(V29F, 'create or replace function public.submit_discount_with_feedback(', '$func$;'),
                     lift(V29F, 'grant execute on function public.submit_discount_with_feedback(uuid, jsonb) to authenticated;')]) {
    await d.exec(sql)
  }
  // discount_requests and student_achievements as production has them.
  for (const sql of [lift('../schema.sql', 'alter table discount_requests enable row level security;'),
                     lift('../schema.sql', 'create policy "Students can read own discount requests"'),
                     lift('../schema.sql', 'create policy "Students can create discount requests"'),
                     lift('2026_fix_team_members_recursion.sql', 'create policy "Team can manage all discount requests"'),
                     lift('2026_v53_phase5_achievements.sql', 'alter table student_achievements enable row level security;'),
                     lift('2026_v53_phase5_achievements.sql', 'create policy "student_achievements: student reads own"'),
                     lift('2026_v53_phase5_achievements.sql', 'create policy "student_achievements: team reads all"'),
                     lift('2026_v55_audit_security_cleanup.sql', 'create policy "student_achievements: student writes own"')]) {
    await d.exec(sql)
  }
  // A comment on one policy, to see the undo put comments back too.
  await d.exec(`comment on policy "Students can create discount requests" on discount_requests is 'A comment, to see the undo put it back.';
    insert into team_members (id, email) values ('${TEAM_ID}', 'team@example.test');
    insert into discount_requests (student_id, status, created_at) values
      ('${UID(1)}', 'pending',  '2026-10-12 10:00:00+00'),
      ('${UID(2)}', 'rejected', '2026-10-12 11:00:00+00');`)
  const questionId = (await d.query(`insert into discount_feedback_questions (order_num, question_text, question_type, scale_min, scale_max, is_required)
                                      values (1, 'How likely are you to recommend us?', 'scale', 1, 10, true) returning id::text as id`)).rows[0].id
  // base.sql's spelling of the student policy, set aside for the last check.
  const harnessSpelling = await d.clone()
  // student_lesson_completions as production has it: v3's spelling.
  await d.exec(`drop policy "Students manage own lesson completions" on student_lesson_completions;`)
  await d.exec(lift('2026_v3_expedition_restructure.sql', 'create policy "Students can manage own lesson completions"'))

  {
    const s = (await d.query(`select
        has_table_privilege('authenticated', 'public.student_lesson_completions', 'insert')
          and has_table_privilege('authenticated', 'public.discount_requests', 'insert')
          and has_table_privilege('authenticated', 'public.student_achievements', 'insert') as granted,
        (select rolbypassrls from pg_roles where rolname = 'service_role') as service_bypasses,
        (select rolbypassrls or rolsuper from pg_roles where rolname = 'authenticated') as students_bypass,
        (select count(*)::int from pg_class where relrowsecurity and oid in ('public.student_lesson_completions'::regclass,
           'public.discount_requests'::regclass, 'public.student_achievements'::regclass)) as rls_on`)).rows[0]
    await d.exec(`create schema _born_open; create table _born_open.t (id int);`)
    const open = (await d.query(`select has_schema_privilege('anon', '_born_open', 'usage') and has_table_privilege('anon', '_born_open.t', 'select') as o`)).rows[0].o
    await d.exec(`drop schema _born_open cascade;`)
    note(s.granted && s.service_bypasses && !s.students_bypass && s.rls_on === 3 && open,
         'harness seam: students hold the table privileges and row level security is on for the three tables, service_role bypasses it, and a new schema and table are born open to anon',
         asJson({ ...s, open }))
  }

  const policiesBefore = await policiesOn(d)
  const catalogBefore = await catalogOf(d)
  const rowsBefore = await rowsOf(d)
  const ownRows = `select lesson_id from student_lesson_completions order by lesson_id`
  const s1Rows = (await d.query(`select lesson_id from student_lesson_completions where student_id = '${UID(1)}' order by lesson_id`)).rows
  const readBefore = await asStudent(d, 1, ownRows)

  // ── the hole, before v105 ──
  {
    const ins = await asStudent(d, 1, `insert into student_lesson_completions (student_id, lesson_id, completed_at)
                                       values ('${UID(1)}', 'l003', '2026-01-01 00:00:00+00')`)
    const upd = await asStudent(d, 1, `update student_lesson_completions set completed_at = '2026-01-01 00:00:00+00' where lesson_id = 'l001'`)
    const del = await asStudent(d, 1, `delete from student_lesson_completions where lesson_id = 'l002'`)
    note(ins.ok && ins.n === 1 && upd.ok && upd.n === 1 && del.ok && del.n === 1,
         'before v105 (the hole): a student, with their own session, inserts a completion at any date, moves the date of another and deletes a third',
         `insert ${told(ins)}, update ${upd.n}, delete ${del.n}`)
    const req = await asStudent(d, 3, `insert into discount_requests (student_id, status) values ('${UID(3)}', 'approved')`)
    const badge = await asStudent(d, 1, `insert into student_achievements (student_id, achievement_id) values ('${UID(1)}', 'r4_clear')`)
    note(req.ok && req.n === 1 && badge.ok && badge.n === 1,
         'before v105: a student creates their own discount request already "approved", and gives themselves a badge',
         `${told(req)} / ${told(badge)}`)
    const other = await asStudent(d, 1, `insert into student_lesson_completions (student_id, lesson_id) values ('${UID(2)}', 'l003')`)
    note(rlsRefused(other) && readBefore.ok && sameJson(readBefore.rows, s1Rows) && s1Rows.length === 5,
         "...but never for another student, and reads only their own rows: the policies are applied, as the student",
         `${told(other)}; reads ${readBefore.rows?.length} of their ${s1Rows.length}`)
    note(await rowsOf(d) === rowsBefore, '...and every attempt above was rolled back: no row changed')
  }

  // ── the read, before v105 ──
  const partsOf = x => [...new Set(x.rows.map(y => y.part))]
  const itemsOf = (x, p) => x.rows.filter(y => y.part === p).map(y => y.item)
  const foundIn = (x, p) => x.rows.filter(y => y.part === p).map(y => `${y.item}=${y.detail}`)
  {
    const was = await stateOf(d)
    const rd = await runFile(d, readSql)
    note(rd.ok && sameJson(partsOf(rd), ['a. policy', 'b. template', 'f. watch rows recorded by the app', 'g. course videos with no length',
                                         'h. setting', 'i. students who paid since 9 Oct'])
         && await stateOf(d) === was,
         'the read (diagnostics/backend-readiness-read.sql) runs here and changes nothing; it shows parts a, b, f, g, h and i (c, d and e have nothing to count on this database)',
         rd.ok ? partsOf(rd).map(p => p.slice(0, 2)).join('') : told(rd))
    const a = itemsOf(rd, 'a. policy')
    note(rd.ok && a.length === 8 && a.includes('student_lesson_completions · Students can manage own lesson completions · ALL')
         && a.includes('discount_requests · Students can create discount requests · INSERT')
         && a.includes('student_achievements · student_achievements: student writes own · INSERT'),
         "the read's part a before v105: every policy on the three tables, the three back doors among them (ALL, INSERT, INSERT)", `${a.length} rows`)
    note(rd.ok && sameJson(foundIn(rd, 'b. template'), ['W2.2=MISSING', 'W2.6=MISSING', 'X.1=MISSING'])
         && sameJson(foundIn(rd, 'h. setting'), ['discount_window_days=14'])
         && sameJson(foundIn(rd, 'f. watch rows recorded by the app'), ['student_lesson_watch=0'])
         && sameJson(foundIn(rd, 'g. course videos with no length'), ['lesson_videos on a lessons_next row with no duration=0'])
         && foundIn(rd, 'i. students who paid since 9 Oct')[0]?.endsWith('=0 / 0 / 0 / 0 / 0'),
         "the read's other parts on this database: b all MISSING, h discount_window_days and no curriculum_reset_at, f and g 0, i five zeros",
         rd.ok ? [...foundIn(rd, 'b. template'), ...foundIn(rd, 'h. setting')].join(' ') : told(rd))
  }

  // ── its lock, its guards ──
  {
    const MARK = '-- ─────────────── 1. It can ───────────────'
    const c = await d.clone()
    const rr = await runFile(c, probeAt(probeAt(v105, MARK, 'v105_locked', lockedIn('AccessExclusiveLock')),
                                        MARK, 'v105_timeout', `current_setting('lock_timeout')`))
    const locked = await probed(c, 'v105_locked'), timeout = await probed(c, 'v105_timeout')
    await c.close()
    note(v105.includes(MARK) && rr.ok && locked.v === 'discount_requests,student_achievements,student_lesson_completions'
         && timeout.v === '5s' && timeout.after === '0',
         'v105 holds its three tables in ACCESS EXCLUSIVE before step 1 reads anything, with lock_timeout 5s, and the setting ends with its commit',
         `${locked.v} [${timeout.v}, after ${timeout.after}] ${rr.ok ? '' : told(rr)}`)
    const c2 = await d.clone()
    const was = await stateOf(c2)
    const busy = await runFile(c2, v105.replace(LOCK105, TIMED_OUT))
    note(v105.includes(LOCK105) && busy.code === '55P03'
         && busy.said.includes('so v105 did not start. Nothing was changed. Paste it again in a minute.') && await stateOf(c2) === was,
         'v105 with its lock timing out (55P03, raised in place of the lock): "Nothing was changed. Paste it again in a minute.", and nothing changed', told(busy))
    await c2.close()
  }
  for (const [what, breakIt, sentence] of [
    ['row level security off on discount_requests', `alter table discount_requests disable row level security;`,
     'Row level security is off on discount_requests'],
    [`a policy already named "${READ_OWN}"`, `create policy "${READ_OWN}" on student_lesson_completions for select using (true);`,
     'and v105 did not make it'],
    ['the feedback form\'s function made security invoker', `alter function public.submit_discount_with_feedback(uuid, jsonb) security invoker;`,
     'is not security definer'],
    ['the feedback form\'s function owned by a role that row level security applies to',
     `create role feedback_owner; alter function public.submit_discount_with_feedback(uuid, jsonb) owner to feedback_owner;`,
     'runs as feedback_owner'],
    ['student_achievements missing', `alter table student_achievements rename to student_achievements_aside;`,
     'they are missing: student_achievements.'],
  ]) {
    const c = await d.clone()
    const broke = await runFile(c, breakIt)
    const was = await stateOf(c)
    const rr = await runFile(c, v105)
    note(broke.ok && stopped(rr, sentence) && await stateOf(c) === was,
         `v105 refuses with ${what}: it says so, and nothing changed`, broke.ok ? told(rr) : `the break failed: ${told(broke)}`)
    await c.close()
  }

  // ── v105 ──
  let r = await runFile(d, v105)
  note(r.ok && r.rows[0]?.v105 === 'v105 ran now: 3 dropped (kept in v105_record.policies), 1 added.' && r.rows.length === 10
       && r.rows.filter(x => x.v105 === 'dropped by v105').length === 3 && r.rows.filter(x => x.v105 === 'added by v105').length === 1,
       'v105 first run: "3 dropped, 1 added", then one row per policy: 5 kept, 1 added, 3 dropped', told(r))
  const policiesAfter = await policiesOn(d)
  const before = JSON.parse(policiesBefore), after = JSON.parse(policiesAfter)
  const isDoor = p => DOORS.some(([t, n]) => p.t === t && p.n === n)
  const added = after.find(p => p.t === 'student_lesson_completions' && p.n === READ_OWN)
  const forAll = before.find(p => p.n === 'Students can manage own lesson completions')
  note(sameJson(after.filter(p => p.n !== READ_OWN), before.filter(p => !isDoor(p))) && before.filter(isDoor).length === 3,
       'v105: the three back doors are gone, and every other policy on the three tables is as it was, character for character',
       after.map(p => `${p.t.slice(0, 8)}:${p.cmd}`).join(' '))
  note(added?.cmd === 'SELECT' && added.roles === '{public}' && added.permissive === 'PERMISSIVE' && added.with_check === null
       && !!forAll && added.qual === forAll.qual,
       `v105: "${READ_OWN}" is FOR SELECT, for every role, with the using of the policy it replaces and no check`, added?.qual ?? 'missing')
  const recordOf = async dd => asJson((await dd.query(`select tablename::text as t, policyname::text as n, permissive, roles::text as roles, cmd, qual,
                                                              with_check, description as comment from v105_record.policies order by 1, 2`)).rows)
  const recordAfter = await recordOf(d)
  note(recordAfter === asJson(before.filter(isDoor)),
       'v105_record.policies holds the three, as the catalogue stated them before v105, the comment included',
       JSON.parse(recordAfter).map(p => p.n).join(', '))
  {
    const acc = (await d.query(`select bool_or(has_schema_privilege(r, 'v105_record', 'usage')) as usage,
        (select count(*)::int from pg_class c, aclexplode(c.relacl) a
          where c.relnamespace = 'v105_record'::regnamespace
            and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)) as grants
      from unnest(array['anon', 'authenticated', 'service_role']) r`)).rows[0]
    note(acc.usage === false && acc.grants === 0,
         'v105_record: anon, authenticated and service_role hold no usage on the schema and no grant on its table', asJson(acc))
  }

  // ── after v105, as a student, the server, the team and the feedback form ──
  {
    const readAfter = await asStudent(d, 1, ownRows)
    note(readAfter.ok && sameJson(readAfter.rows, s1Rows) && sameJson(readAfter.rows, readBefore.rows),
         'after v105: a student reads exactly their own completions, the same rows as before', `${readAfter.rows?.length} rows`)
    const ins = await asStudent(d, 1, `insert into student_lesson_completions (student_id, lesson_id, completed_at)
                                       values ('${UID(1)}', 'l003', '2026-01-01 00:00:00+00')`)
    const ups = await asStudent(d, 1, `insert into student_lesson_completions (student_id, lesson_id, completed_at)
                                       values ('${UID(1)}', 'l001', '2026-01-01 00:00:00+00')
                                       on conflict (student_id, lesson_id) do update set completed_at = excluded.completed_at`)
    const upd = await asStudent(d, 1, `update student_lesson_completions set completed_at = '2026-01-01 00:00:00+00' where lesson_id = 'l001'`)
    const del = await asStudent(d, 1, `delete from student_lesson_completions where lesson_id = 'l002'`)
    note(rlsRefused(ins) && rlsRefused(ups) && upd.ok && upd.n === 0 && del.ok && del.n === 0,
         'after v105: a student cannot insert or upsert a completion (row level security, 42501), and their update and delete touch no row',
         `${told(ins)}; upsert ${ups.code}; update ${upd.n}, delete ${del.n}`)
    const pending = await asStudent(d, 3, `insert into discount_requests (student_id) values ('${UID(3)}')`)
    const approved = await asStudent(d, 3, `insert into discount_requests (student_id, status) values ('${UID(3)}', 'approved')`)
    const approve = await asStudent(d, 1, `update discount_requests set status = 'approved'`)
    const own = await asStudent(d, 1, `select student_id::text as s, status from discount_requests`)
    note(rlsRefused(pending) && rlsRefused(approved) && approve.ok && approve.n === 0 && sameJson(own.rows, [{ s: UID(1), status: 'pending' }]),
         'after v105: a student cannot create a discount request, pending or approved (42501), nor approve their own; they still read their own request and no one else\'s',
         `${pending.code}/${approved.code}; approve ${approve.n}; reads ${asJson(own.rows)}`)
    const badge = await asStudent(d, 1, `insert into student_achievements (student_id, achievement_id) values ('${UID(1)}', 'r4_clear')`)
    const badges = await asStudent(d, 1, `select achievement_id from student_achievements order by 1`)
    note(rlsRefused(badge) && sameJson(badges.rows.map(x => x.achievement_id), ['first_steps']),
         'after v105: a student cannot give themselves a badge (42501), and still reads their own', `${badge.code}; ${asJson(badges.rows)}`)
    const svc = await asRole(d, 'service_role', [
        `insert into student_lesson_completions (student_id, lesson_id, completed_at) values ('${UID(1)}', 'l003', now())`,
        `update student_lesson_completions set completed_at = now() where student_id = '${UID(1)}' and lesson_id = 'l001'`,
        `delete from student_lesson_completions where student_id = '${UID(1)}' and lesson_id = 'l002'`,
        `insert into discount_requests (student_id, status) values ('${UID(3)}', 'pending')`,
        `update discount_requests set status = 'approved' where student_id = '${UID(3)}'`,
        `insert into student_achievements (student_id, achievement_id) values ('${UID(1)}', 'r4_clear')`],
      { check: `select (select count(*)::int from student_lesson_completions where student_id = '${UID(1)}') as c,
                       (select string_agg(status, ',') from discount_requests where student_id = '${UID(3)}') as s,
                       (select count(*)::int from student_achievements where student_id = '${UID(1)}') as a` })
    note(svc.ok && svc.checked?.[0]?.c === s1Rows.length && svc.checked[0].s === 'approved' && svc.checked[0].a === 2,
         'after v105: the service role (every route and cron) still inserts, updates and deletes on all three', svc.ok ? asJson(svc.checked) : told(svc))
    const totals = (await d.query(`select (select count(*)::int from student_lesson_completions) as c, (select count(*)::int from student_achievements) as a,
                                          (select count(*)::int from discount_requests) as r`)).rows[0]
    const teamC = await asRole(d, 'authenticated', `select count(*)::int as n from student_lesson_completions`, { uid: TEAM_ID, team: true })
    const teamA = await asRole(d, 'authenticated', `select count(*)::int as n from student_achievements`, { uid: TEAM_ID, team: true })
    const teamD = await asRole(d, 'authenticated', `update discount_requests set rejection_reason = 'seen'`, { uid: TEAM_ID, team: true })
    note(teamC.rows[0]?.n === totals.c && teamA.rows[0]?.n === totals.a && teamD.ok && teamD.n === totals.r,
         'after v105: the team still reads every completion and badge and still changes every discount request, through its own policies',
         `${teamC.rows[0]?.n}/${totals.c} ${teamA.rows[0]?.n}/${totals.a} ${teamD.n}/${totals.r}`)
    const form = await asStudent(d, 3, `select public.submit_discount_with_feedback('${UID(3)}', '[{"question_id": "${questionId}", "answer_scale": 8}]'::jsonb)::text as id`,
      { check: `select r.status, (select count(*)::int from discount_feedback_responses f where f.discount_request_id = r.id) as answers
                  from discount_requests r where r.student_id = '${UID(3)}'` })
    const forOther = await asStudent(d, 3, `select public.submit_discount_with_feedback('${UID(4)}', '[]'::jsonb)`)
    note(form.ok && /^[0-9a-f-]{36}$/.test(form.rows[0]?.id ?? '') && sameJson(form.checked, [{ status: 'pending', answers: 1 }])
         && !forOther.ok && /Not authorized/.test(forOther.said),
         "after v105: the feedback form's function, called with a student's own session, still creates their request and its answer (it runs as its owner), and still refuses a request for another student",
         form.ok ? asJson(form.checked) : told(form))
    note(await rowsOf(d) === rowsBefore, '...and every one of those statements was rolled back: no row changed')
  }

  // ── the read, after v105 ──
  {
    const rd = await runFile(d, readSql)
    const a = itemsOf(rd, 'a. policy')
    const writes = a.filter(i => !i.endsWith(' · SELECT'))
    note(rd.ok && !DOORS.some(([t, n]) => a.some(i => i.startsWith(`${t} · ${n} · `)))
         && a.includes(`student_lesson_completions · ${READ_OWN} · SELECT`)
         && sameJson(writes, ['discount_requests · Team can manage all discount requests · ALL']),
         "the read after v105: part a has no student write row left; the one policy that is not SELECT is the team's ALL on discount_requests",
         rd.ok ? asJson(writes) : told(rd))
  }

  // ── run again ──
  {
    const was = await stateOf(d)
    const rr = await runFile(d, v105)
    note(rr.ok && rr.rows[0]?.v105 === 'v105 was already in place. This run changed nothing.' && rr.rows.length === 10
         && await stateOf(d) === was && await recordOf(d) === recordAfter,
         'v105 run again: "already in place", and every policy, schema, grant, row and the record unchanged', told(rr))
  }

  // ── the undo ──
  {
    const c = await d.clone()
    const broke = await runFile(c, `create policy "Students can create discount requests" on discount_requests for insert with check (false);`)
    const was = await stateOf(c)
    const rr = await runFile(c, undo105)
    note(broke.ok && stopped(rr, 'with a definition other than the one v105 recorded: "Students can create discount requests" on discount_requests')
         && await stateOf(c) === was,
         'the undo refuses when a policy it would put back is there already with another definition, names it, and changes nothing',
         broke.ok ? told(rr) : `the break failed: ${told(broke)}`)
    await c.close()
  }
  {
    const MARK = '-- ─────────────── 1. It can ───────────────'
    const c = await d.clone()
    const rr = await runFile(c, probeAt(probeAt(undo105, MARK, 'u105_locked', lockedIn('AccessExclusiveLock')),
                                        MARK, 'u105_timeout', `current_setting('lock_timeout')`))
    const locked = await probed(c, 'u105_locked'), timeout = await probed(c, 'u105_timeout')
    await c.close()
    const c2 = await d.clone()
    const was = await stateOf(c2)
    const busy = await runFile(c2, undo105.replace(LOCK105, TIMED_OUT))
    const same = await stateOf(c2) === was
    await c2.close()
    note(undo105.includes(MARK) && rr.ok && locked.v === 'discount_requests,student_achievements,student_lesson_completions'
         && timeout.v === '5s' && timeout.after === '0' && undo105.includes(LOCK105) && busy.code === '55P03'
         && busy.said.includes('so the undo did not start. Nothing was changed. Paste it again in a minute.') && same,
         'the undo of v105 holds the three tables before it reads anything, with lock_timeout 5s; with its lock timing out it says "Nothing was changed. Paste it again in a minute." and nothing changed',
         `${locked.v} [${timeout.v}] / ${told(busy)}`)
  }
  r = await runFile(d, undo105)
  note(r.ok && r.rows[0]?.undo?.startsWith('The undo of v105 ran now: 3 put back') && r.rows.filter(x => x.undo === 'put back').length === 3,
       'the undo of v105 runs: "3 put back", and marks the three it put back', told(r))
  note(await policiesOn(d) === policiesBefore,
       'after the undo every policy on the three tables is back exactly as before v105: command, roles, using, check and comment')
  note(await catalogOf(d) === catalogBefore && await rowsOf(d) === rowsBefore,
       '...and nothing else differs from before v105: every policy, table, index, grant, function and schema (v105_record is gone), and every row')
  {
    const back = await asStudent(d, 1, `insert into student_lesson_completions (student_id, lesson_id) values ('${UID(1)}', 'l003')`)
    note(back.ok && back.n === 1,
         'after the undo a student can insert their own completion again: the undo puts back what the policies do, not only their names', told(back))
    const was = await stateOf(d)
    const rr = await runFile(d, undo105)
    note(stopped(rr, 'v105_record.policies is missing') && await stateOf(d) === was,
         'a second undo refuses (v105_record.policies is missing) and changes nothing', told(rr))
  }
  r = await runFile(d, v105)
  note(r.ok && r.rows[0]?.v105 === 'v105 ran now: 3 dropped (kept in v105_record.policies), 1 added.'
       && await policiesOn(d) === policiesAfter && await recordOf(d) === recordAfter,
       'v105 applies again after its undo, with the same policies and the same record as its first run', told(r))

  // ── base.sql's spelling ──
  {
    const c = harnessSpelling
    const was = await policiesOn(c)
    const rr = await runFile(c, v105)
    const pol = JSON.parse(await policiesOn(c))
    const rec = rr.ok ? (await c.query(`select policyname::text as n from v105_record.policies`)).rows.map(x => x.n).sort() : []
    const un = await runFile(c, undo105)
    note(rr.ok && rr.rows[0]?.v105 === 'v105 ran now: 3 dropped (kept in v105_record.policies), 1 added.'
         && sameJson(rec, ['Students can create discount requests', 'Students manage own lesson completions', 'student_achievements: student writes own'])
         && !pol.some(p => p.n === 'Students manage own lesson completions') && pol.some(p => p.n === READ_OWN)
         && un.ok && await policiesOn(c) === was,
         'with base.sql\'s spelling, "Students manage own lesson completions": v105 drops and records it too, adds the read policy, and its undo puts it back exactly',
         rr.ok ? asJson(rec) : told(rr))
    await c.close()
  }
}

console.log('\n=== 26. v106: one pending discount request per student (T-057), and its undo ===')
{
  const v106 = read(V106F)
  const undo106 = undoText('2026_v106_undo.sql')
  // After v105, as production will be. S1 has one pending request, S2 a
  // rejected one (section 25); S3 and S5 get two pending, S4 an approved and
  // a pending.
  const d = await policyDb.clone()
  await policyDb.close()
  await d.exec(`
    insert into discount_requests (student_id, status, created_at) values
      ('${UID(3)}', 'pending',  '2026-10-12 10:00:00+00'),
      ('${UID(3)}', 'pending',  '2026-10-13 10:00:00+00'),
      ('${UID(4)}', 'approved', '2026-10-11 10:00:00+00'),
      ('${UID(4)}', 'pending',  '2026-10-14 10:00:00+00'),
      ('${UID(5)}', 'rejected', '2026-10-10 10:00:00+00'),
      ('${UID(5)}', 'pending',  '2026-10-11 10:00:00+00'),
      ('${UID(5)}', 'pending',  '2026-10-14 10:00:00+00');`)
  const indexDef = async (dd = d) => (await dd.query(`select pg_get_indexdef(to_regclass('public.discount_requests_one_pending_per_student')) as def`)).rows[0].def

  {
    const was = await stateOf(d)
    const r = await runFile(d, v106)
    const listed = r.ok ? r.rows.slice(1).map(x => `${x.student_id.slice(-1)}:${x.created_at.toISOString().slice(0, 10)}:${x.do.split(' ')[0]}`) : []
    note(r.ok && r.rows[0]?.v106?.startsWith('Not added: 2 students have more than one pending request, listed below. Nothing was changed.')
         && sameJson(listed, ['3:2026-10-13:keep', '3:2026-10-12:reject', '5:2026-10-14:keep', '5:2026-10-11:reject'])
         && await indexDef() === null && await stateOf(d) === was,
         'v106 with two students holding two pending requests each: it does not fail, adds nothing, and lists their pending requests, the newest of each to keep',
         r.ok ? asJson(listed) : told(r))
  }
  {
    const MARK = '-- ─────────────── 1 to 3.'
    const c = await d.clone()
    const rr = await runFile(c, probeAt(probeAt(v106, MARK, 'v106_locked', lockedIn('ShareLock')), MARK, 'v106_timeout', `current_setting('lock_timeout')`))
    const locked = await probed(c, 'v106_locked'), timeout = await probed(c, 'v106_timeout')
    await c.close()
    const c2 = await d.clone()
    const was = await stateOf(c2)
    const busy = await runFile(c2, v106.replace(LOCK106, TIMED_OUT))
    const same = await stateOf(c2) === was
    await c2.close()
    note(v106.includes(MARK) && rr.ok && locked.v === 'discount_requests' && timeout.v === '5s' && timeout.after === '0',
         'v106 holds discount_requests in SHARE mode (reads go on, writes wait) before it looks, with lock_timeout 5s, and the setting ends with its commit',
         `${locked.v} [${timeout.v}, after ${timeout.after}]`)
    note(v106.includes(LOCK106) && busy.code === '55P03'
         && busy.said.includes('so v106 did not start. Nothing was changed. Paste it again in a minute.') && same,
         'v106 with its lock timing out (55P03): "Nothing was changed. Paste it again in a minute.", and nothing changed', told(busy))
  }

  // The team keeps the newest of each and rejects the other.
  await d.exec(`update discount_requests set status = 'rejected', rejection_reason = 'a second request'
                 where (student_id, created_at) in (('${UID(3)}', '2026-10-12 10:00:00+00'), ('${UID(5)}', '2026-10-11 10:00:00+00'));`)
  const catalogBefore106 = await catalogOf(d)
  let r = await runFile(d, v106)
  note(r.ok && r.rows.length === 1 && r.rows[0].v106.startsWith('v106 added the index discount_requests_one_pending_per_student now.')
       && await indexDef() === ONE_PENDING,
       'with no student holding two, v106 adds the unique index on discount_requests (student_id) where status is pending', told(r))
  {
    const dup = await asRole(d, 'service_role', `insert into discount_requests (student_id) values ('${UID(1)}')`)
    const reopen = await asRole(d, 'service_role', `update discount_requests set status = 'pending' where student_id = '${UID(3)}' and status = 'rejected'`)
    const first = (await d.query(`select count(*)::int as n from discount_requests where student_id = '${UID(1)}' and status = 'pending'`)).rows[0].n
    note(dup.code === '23505' && /discount_requests_one_pending_per_student/.test(dup.said) && reopen.code === '23505' && first === 1,
         'from v106 on, a second pending request for a student is refused (23505), inserted (the request route\'s path) or set back to pending from rejected; the first one stands',
         `${told(dup)} / ${reopen.code}`)
    const others = await asRole(d, 'service_role', [
        `insert into discount_requests (student_id, status) values ('${UID(1)}', 'approved'), ('${UID(1)}', 'rejected')`,
        `update discount_requests set status = 'rejected' where student_id = '${UID(1)}' and status = 'pending'`,
        `insert into discount_requests (student_id) values ('${UID(1)}')`],
      { check: `select status, count(*)::int as n from discount_requests where student_id = '${UID(1)}' group by status order by status` })
    note(others.ok && sameJson(others.checked, [{ status: 'approved', n: 1 }, { status: 'pending', n: 1 }, { status: 'rejected', n: 2 }]),
         'requests in other states are not limited, and once the pending one is decided the student can apply again',
         others.ok ? asJson(others.checked) : told(others))
  }
  {
    const was = await stateOf(d)
    const rr = await runFile(d, v106)
    note(rr.ok && rr.rows.length === 1 && rr.rows[0].v106 === 'The index discount_requests_one_pending_per_student was already there. This run changed nothing.'
         && await stateOf(d) === was,
         'v106 run again: "already there", and nothing changed', told(rr))
  }
  {
    const c = await d.clone()
    const broke = await runFile(c, `drop index if exists discount_requests_one_pending_per_student;
                                    create index discount_requests_one_pending_per_student on discount_requests (student_id);`)
    const was = await stateOf(c)
    const rr = await runFile(c, v106)
    note(broke.ok && stopped(rr, 'exists and is not the one this file makes') && await stateOf(c) === was,
         'v106 refuses an index of that name that is not its own (here not unique), shows it, and changes nothing',
         broke.ok ? told(rr) : `the break failed: ${told(broke)}`)
    await c.close()
  }
  {
    const MARK = 'drop index if exists public.discount_requests_one_pending_per_student;'
    const c = await d.clone()
    const rr = await runFile(c, probeAt(undo106, MARK, 'u106_timeout', `current_setting('lock_timeout')`))
    const timeout = await probed(c, 'u106_timeout')
    await c.close()
    r = await runFile(d, undo106)
    note(undo106.includes(MARK) && rr.ok && timeout.v === '5s' && timeout.after === '0'
         && r.ok && r.rows[0]?.index_gone === true && await indexDef() === null && await catalogOf(d) === catalogBefore106,
         'the undo of v106 drops the index with lock_timeout 5s, and everything is as before v106', told(r))
    const was = await stateOf(d)
    r = await runFile(d, undo106)
    note(r.ok && r.rows[0]?.index_gone === true && await stateOf(d) === was, 'a second undo of v106 changes nothing', told(r))
    r = await runFile(d, v106)
    note(r.ok && r.rows[0]?.v106?.startsWith('v106 added the index') && await indexDef() === ONE_PENDING,
         'v106 applies again after its undo', told(r))
  }

  // Production gets v105 and v106 before the switch: the switch still runs.
  {
    const c = await d.clone()
    const pol = await policiesOn(c)
    const r3 = await runFile(c, read(V103F))
    const r4 = await runFile(c, read(V104F))
    note(r3.ok && r4.ok && r4.rows[0]?.value?.startsWith('The switch ran now') && await policiesOn(c) === pol && await indexDef(c) === ONE_PENDING,
         'v103 and the switch (v104) still run after v105 and v106, and leave the policies and the index as they were',
         r3.ok ? (r4.ok ? r4.rows[0]?.value : told(r4)) : told(r3))
    await c.close()
  }

  // T-080: the database's own rule that the map and the request routes mirror
  // (src/lib/world/discount.ts, requestCounts). A student who first paid from
  // 1 October (9 September until 2026-10-19) can hold a request from the old
  // dashboard, made before the launch on 9 October. The feedback form's
  // function refuses another request
  // while that one is pending, approved or applied, whatever its date, and
  // writes one after a rejected one. Run with the student's own session, and
  // rolled back. base.sql predates v21, which gave production the 'applied'
  // status, so v21 runs first.
  {
    const c = await d.clone()
    await c.exec(read('2026_v21_discount_applied_state.sql'))
    const got = []
    for (const status of ['pending', 'approved', 'applied', 'rejected']) {
      await c.exec(`delete from discount_requests where student_id = '${UID(6)}';
                    insert into discount_requests (student_id, status, created_at) values ('${UID(6)}', '${status}', '2026-10-06 10:00:00+00');`)
      const r = await asStudent(c, 6, `select public.submit_discount_with_feedback('${UID(6)}', '[]'::jsonb)::text as id`,
        { check: `select string_agg(status, ',' order by created_at) as s from discount_requests where student_id = '${UID(6)}'` })
      got.push(`${status}: ${r.ok ? `written (${r.checked?.[0]?.s})` : r.said}`)
    }
    await c.close()
    const REFUSED = 'A discount request already exists for this student'
    note(sameJson(got, [`pending: ${REFUSED}`, `approved: ${REFUSED}`, `applied: ${REFUSED}`, 'rejected: written (rejected,pending)']),
         'T-080: with a request from before the launch (6 October), the feedback form\'s function refuses another while that one is pending, approved or applied, and writes one after a rejected one: the rule discount.ts requestCounts mirrors',
         asJson(got))
  }
  feedbackDb = await d.clone()
  await d.close()
}

console.log('\n=== 27. v107: only the server calls the feedback form\'s function, and its undo ===')
{
  const v107 = read(V107F)
  const undo107 = undoText('2026_v107_undo.sql')
  // Section 26's database: v105 and v106 in, as production will be. S1 holds
  // a pending request; S7 has none.
  const d = feedbackDb
  feedbackDb = null
  const FN = 'public.submit_discount_with_feedback(uuid, jsonb)'
  const NOT_AUTHORIZED = 'Not authorized to submit feedback for this student'
  // auth.role() as Supabase defines it: the role in the request's own token.
  // base.sql has only auth.uid().
  await d.exec(`create or replace function auth.role() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
  $$;`)
  // A call as PostgREST makes it: the role, and the token's claims beside it.
  const claims = (role, uid = '') => `select set_config('request.jwt.claims', '${JSON.stringify(uid ? { role, sub: uid } : { role })}', true)`
  const QID = (await d.query(`select id::text as id from discount_feedback_questions order by order_num limit 1`)).rows[0].id
  const callFor = n => `select public.submit_discount_with_feedback('${UID(n)}', '[{"question_id": "${QID}", "answer_scale": 8}]'::jsonb)::text as id`
  const madeFor = n => `select r.status, (select count(*)::int from discount_feedback_responses f where f.discount_request_id = r.id) as answers
                          from discount_requests r where r.student_id = '${UID(n)}' order by r.created_at`
  const studentCalls = (dd, n) => asRole(dd, 'authenticated', [claims('authenticated', UID(n)), callFor(n)], { uid: UID(n), check: madeFor(n) })
  const serverCalls = (dd, n) => asRole(dd, 'service_role', [claims('service_role'), callFor(n)], { check: madeFor(n) })
  const visitorCalls = (dd, n) => asRole(dd, 'anon', [claims('anon'), callFor(n)])
  const can = async (dd = d) => asJson((await dd.query(`select has_function_privilege('anon', '${FN}', 'execute') as visitor,
      has_function_privilege('authenticated', '${FN}', 'execute') as student,
      has_function_privilege('service_role', '${FN}', 'execute') as server`)).rows[0])
  const defOf = async (dd = d) => (await dd.query(`select pg_get_functiondef('${FN}'::regprocedure) as def`)).rows[0].def
  // The body from the duplicate check on, which v107 keeps word for word.
  const tailOf = async (dd = d) => {
    const src = (await dd.query(`select prosrc from pg_proc where oid = '${FN}'::regprocedure`)).rows[0].prosrc
    return src.slice(src.indexOf('-- Duplicate check'))
  }
  const denied = r => !r.ok && r.code === '42501' && /permission denied for function submit_discount_with_feedback/.test(r.said)
  const ONLY_SERVER = asJson({ visitor: false, student: false, server: true })
  const PENDING_ONE = [{ status: 'pending', answers: 1 }]

  // ── before v107 (v29, as production has it) ──
  const v29Def = await defOf(), v29Tail = await tailOf()
  {
    const student = await studentCalls(d, 7)
    const server = await serverCalls(d, 7)
    note(student.ok && sameJson(student.checked, PENDING_ONE) && !server.ok && server.said.includes(NOT_AUTHORIZED),
         "before v107 (v29): a student's own session writes a pending request and its answer through the function, with nothing checked but who they are; the service role is refused",
         `${student.ok ? asJson(student.checked) : told(student)} / server ${told(server)}`)
  }

  // ── v107, first run ──
  const catalogBefore = await catalogOf(d), rowsBefore = await rowsOf(d)
  {
    const MARK = '-- ─────────────── 2. The function, for the server only'
    const c = await d.clone()
    const rr = await runFile(c, probeAt(v107, MARK, 'v107_timeout', `current_setting('lock_timeout')`))
    const timeout = await probed(c, 'v107_timeout')
    await c.close()
    note(v107.includes(MARK) && rr.ok && timeout.v === '5s' && timeout.after === '0',
         'v107 runs with lock_timeout 5s, and the setting ends with its commit', `${timeout.v}, after ${timeout.after}`)
  }
  let r = await runFile(d, v107)
  const v107Def = await defOf()
  note(r.ok && r.rows.length === 1 && r.rows[0].v107?.startsWith('v107 ran now: only the server can call submit_discount_with_feedback.')
       && r.rows[0].visitor_can === false && r.rows[0].student_can === false && r.rows[0].server_can === true
       && await can() === ONLY_SERVER,
       'v107 runs: only the service role may call the function, a visitor and a student may not, and its one row says so', told(r))
  note(await catalogOf(d) === catalogBefore && await rowsOf(d) === rowsBefore && await tailOf() === v29Tail
       && /SECURITY DEFINER/.test(v107Def) && /SET search_path TO 'public'/.test(v107Def)
       && v107Def.includes("if coalesce(auth.role(), '') <> 'service_role' then") && !v107Def.includes('auth.uid()'),
       "v107 keeps the name, arguments, result, security definer, search_path, owner, and v29's duplicate check and inserts word for word; every policy, table grant and row is as before",
       v107Def.split('\n').slice(0, 7).join(' '))
  {
    const student = await studentCalls(d, 7)
    const visitor = await visitorCalls(d, 7)
    note(denied(student) && denied(visitor) && await rowsOf(d) === rowsBefore,
         "after v107: a student's own session and a visitor are refused before the function runs (42501), and nothing is written",
         `${told(student)} / ${visitor.code}`)
    const server = await serverCalls(d, 7)
    note(server.ok && /^[0-9a-f-]{36}$/.test(server.rows[0]?.id ?? '') && sameJson(server.checked, PENDING_ONE),
         'after v107: the service role (the route) writes the request and its answer, and gets the request id back',
         server.ok ? asJson(server.checked) : told(server))
    const pendingAlready = (await d.query(`select count(*)::int as n from discount_requests where student_id = '${UID(1)}' and status = 'pending'`)).rows[0].n
    const dup = await asRole(d, 'service_role', [claims('service_role'), callFor(1)])
    note(pendingAlready === 1 && !dup.ok && dup.code === 'P0001' && dup.said === 'A discount request already exists for this student',
         "after v107: v29's duplicate check still refuses another request while one is pending, in v29's words", told(dup))
    // T-090's check on production, right after the paste: one call with the
    // app's own key for a student id no row has. Past the server check, the
    // request's insert fails on its foreign key, so it writes nothing. The two
    // other answers are what the route would meet too: the key's token
    // carrying no service_role (the function's own refusal), or the call not
    // made as service_role at all (no EXECUTE).
    const NOBODY = `select public.submit_discount_with_feedback('00000000-0000-0000-0000-000000000000', '[]'::jsonb)::text as id`
    const ghost = await asRole(d, 'service_role', [claims('service_role'), NOBODY])
    const noClaim = await asRole(d, 'service_role', [NOBODY])
    const notServer = await asRole(d, 'anon', [claims('service_role'), NOBODY])
    note(!ghost.ok && ghost.code === '23503' && /discount_requests/.test(ghost.said)
           && !noClaim.ok && noClaim.code === 'P0001' && noClaim.said === NOT_AUTHORIZED && denied(notServer),
         "T-090's check: the service role's call for a student id no row has fails on the request's foreign key (23503); with no service_role in its token the function refuses it (P0001), and as another role it is refused before it runs (42501)",
         `${told(ghost)} / ${told(noClaim)} / ${notServer.code}`)
  }
  {
    // The seatbelt, should a later file grant it again.
    const c = await d.clone()
    await c.exec(`grant execute on function ${FN} to authenticated;`)
    const regranted = await studentCalls(c, 7)
    await c.close()
    note(!regranted.ok && regranted.code === 'P0001' && regranted.said === NOT_AUTHORIZED,
         "the seatbelt: with EXECUTE granted to authenticated again, the function itself refuses a student's session in v29's words, and writes nothing",
         told(regranted))
  }
  {
    // The SQL editor runs as the owner and sends no request token.
    const owner = await runFile(d, `select public.submit_discount_with_feedback('${UID(7)}', '[]'::jsonb) as id`)
    note(!owner.ok && owner.code === 'P0001' && owner.said.includes(NOT_AUTHORIZED) && await rowsOf(d) === rowsBefore,
         "a call from the SQL editor (the owner, no request token) is refused too: only the route's calls go through", told(owner))
  }

  // ── run again ──
  {
    const was = await stateOf(d)
    r = await runFile(d, v107)
    note(r.ok && r.rows[0]?.v107 === 'v107 was already in place. This run changed nothing.'
         && await stateOf(d) === was && await defOf() === v107Def && await can() === ONLY_SERVER,
         'v107 run again: "already in place", and nothing changed', told(r))
  }
  {
    const c = await d.clone()
    const rr = await runFile(c, read(V105F))
    await c.close()
    note(rr.ok && rr.rows[0]?.v105 === 'v105 was already in place. This run changed nothing.',
         "v105 pasted again after v107: its check of the feedback form's function (security definer, run as its owner) still passes, and it changes nothing",
         told(rr))
  }

  // ── refusals ──
  for (const [what, breakSql, sentence] of [
    ['the function missing', `drop function ${FN};`, 'does not exist, so there is nothing to give to the server alone'],
    ['auth.role() missing', 'drop function auth.role();', 'auth.role() does not exist'],
  ]) {
    const c = await d.clone()
    await c.exec(breakSql)
    const was = await stateOf(c)
    const rr = await runFile(c, v107)
    note(stopped(rr, sentence) && await stateOf(c) === was, `v107 refuses with ${what}, says so, and changes nothing`, told(rr))
    await c.close()
  }

  // ── the undo ──
  {
    r = await runFile(d, undo107)
    note(r.ok && r.rows[0]?.student_can === true && r.rows[0]?.v29_body === true
         && await defOf() === v29Def && await catalogOf(d) === catalogBefore
         && await can() === asJson({ visitor: false, student: true, server: true }),
         "the undo of v107 puts back v29's function exactly (pg_get_functiondef as before v107) and its grant to authenticated; a visitor stays without EXECUTE",
         told(r))
    const student = await studentCalls(d, 7)
    const server = await serverCalls(d, 7)
    note(student.ok && sameJson(student.checked, PENDING_ONE) && !server.ok && server.said.includes(NOT_AUTHORIZED),
         "after the undo: a student's own session writes through the function again and the service role is refused, so the undo goes only with the old route, as its header says",
         `${student.ok ? asJson(student.checked) : told(student)} / server ${told(server)}`)
    const was = await stateOf(d)
    r = await runFile(d, undo107)
    note(r.ok && await stateOf(d) === was && await defOf() === v29Def, 'a second undo of v107 changes nothing', told(r))
    r = await runFile(d, v107)
    note(r.ok && r.rows[0]?.v107?.startsWith('v107 ran now') && await defOf() === v107Def && await can() === ONLY_SERVER,
         'v107 applies again after its undo: the same function and grants as its first run', told(r))
  }
  await d.close()
}

// ════════════════════════════════════════════════════════════════════
// 28: diagnostics/whop-sync-proof.sql, the read behind the first point of
// Lovro's preview review (19 October): two lessons he finished on Whop that
// the app didn't show. Before the switch the lookup both Whop paths run (the
// webhook and the backfill, lessons by whop_lesson_id) finds no lesson of the
// new course in `lessons`, and the key into `lessons` refuses a completion
// for one; after v104 the same lookup finds them and the completion writes.
// The read runs the way the SQL editor runs it, on one database before the
// switch and after it, and changes nothing.
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 28. the Whop sync read (diagnostics/whop-sync-proof.sql), before the switch and after v104 ===')
{
  const d = await chainDatabase()
  const raw = diagnostic('whop-sync-proof.sql')
  const PLACE = 'REPLACE_WITH_THE_TEST_ACCOUNTS_EMAIL'
  const EMAIL = 'whop-sync-one@example.test'
  const [T1, T2] = [1, 2].map(n => `c2800000-0000-0000-0000-00000000000${n}`)
  const [A, B] = ['a1l01', 'a1l02'].map(id => COURSE.lessons.find(l => l.id === id))
  const OTHER = 'lesn_notinthiscourse01'
  const LOOKUP = `select id from lessons where whop_lesson_id in ('${A.whop_lesson_id}', '${B.whop_lesson_id}') order by id`
  const dump = async () => {
    const out = {}
    for (const { tablename: t } of await rowsOn(d, `select tablename from pg_tables where schemaname = 'public' order by 1`)) {
      out[t] = (await rowsOn(d, `select * from public."${t}"`)).map(asJson).sort()
    }
    return asJson(out)
  }
  // The file as the owner runs it, with `email` on the line marked HERE.
  const readFor = async email => {
    const was = await dump()
    const r = await runFile(d, raw.replace(PLACE, email))
    return { ...r, same: await dump() === was, part: p => r.rows.filter(x => x.part.startsWith(p)).map(x => [x.item, x.detail]) }
  }
  const told = r => r.ok ? asJson(r.rows.map(x => [x.part, x.item, x.detail])) : `${r.code}: ${r.said.slice(0, 120)}`
  // A moment as the read writes it: Croatia time.
  const at = async (sql, fmt = 'Dy DD Mon HH24:MI:SS') =>
    (await rowsOn(d, `select to_char((${sql}) at time zone 'Europe/Zagreb', '${fmt}') as t`))[0].t

  note(countOf(raw, PLACE) === 1, 'the Whop sync read holds its placeholder once, on the line marked HERE',
       raw.split('\n').find(l => l.includes(PLACE))?.trim())

  // ── before the switch ──
  await d.exec(`
    insert into students (id, supabase_user_id, email, first_paid_at, whop_plan_id, membership_status) values
      ('${T1}', '${T1}', '${EMAIL}',                    '2026-10-02 10:00:00+00', 'plan_4ZrwR4PmBsVsx', 'active'),
      ('${T2}', '${T2}', 'whop-sync-two@example.test', '2026-10-03 10:00:00+00', 'plan_4ZrwR4PmBsVsx', 'active');
    -- The check at the account's login: Whop gave 3 finished lessons, 2 of
    -- them the new course's, and none matched the old course in lessons.
    insert into student_whop_sync (student_id, last_sync_at, last_sync_fetched, last_sync_matched, last_sync_unmatched) values
      ('${T1}', '2026-10-19 08:30:00+00', 3, 0, array['${A.whop_lesson_id}', '${B.whop_lesson_id}', '${OTHER}']);`)

  let r = await readFor(PLACE)
  note(r.ok && r.same && sameJson(r.part('b.'), [['none', 'No student has an email like the one on the line marked HERE.']])
       && r.rows.every(x => x.part < 'c'),
       'left as it is, the read finds no account, says to fix the email, and shows no check', told(r))
  r = await readFor('whop-sync-')
  note(r.ok && r.same && sameJson(r.part('b.').map(x => x[1].endsWith(' · one of 2, write the whole address')), [true, true])
       && r.rows.every(x => x.part < 'c'),
       'an email that finds two accounts lists both, asks for the whole address and shows nothing of either', told(r))
  r = await readFor('whop-sync-two@example.test')
  note(r.ok && r.same && sameJson(r.part('c.'), [['never', 'No check has run for this account.']]),
       'an account with no check reads "never"', told(r))

  r = await readFor(EMAIL)
  note(r.ok && r.same, 'before the switch the read runs and changes nothing', told(r))
  note(sameJson(r.part('a.').map(x => [x[0], x[1].endsWith(' with a Whop lesson id · the switch has not run')]), [['the old course', true]]),
       'part a: the old course, the switch has not run', asJson(r.part('a.')))
  note(sameJson(r.part('b.'), [[EMAIL, `student ${T1} · active`]]), 'part b: the one account', asJson(r.part('b.')))
  note(sameJson(r.part('c.'), [['Mon 19 Oct 10:30:00', 'Whop sent 3 · matched 0 · unmatched 3']]),
       'part c: the check in Croatia time, and what Whop gave it', asJson(r.part('c.')))
  note(sameJson(r.part('d.').sort(), [[A.whop_lesson_id, `new course a1l01 · ${A.title}`],
                                      [B.whop_lesson_id, `new course a1l02 · ${B.title}`],
                                      [OTHER, 'not in the new course']].sort()),
       "part d: each unmatched Whop lesson by its place in the new course, or 'not in the new course'", asJson(r.part('d.')))
  note(r.part('e.').length === 0, 'part e: nothing done in the app')

  note(sameJson(await rowsOn(d, LOOKUP), []),
       'before the switch the lookup the webhook and the backfill run (lessons by whop_lesson_id) finds neither a1l01 nor a1l02')
  {
    const e = await d.query(`insert into student_lesson_completions (student_id, lesson_id) values ('${T1}', 'a1l01')`).then(() => null, x => x)
    note(e?.code === '23503', "before the switch a completion of a1l01 is refused by the key into lessons, so nothing finished on the new course can be recorded",
         e ? `${e.code}: ${e.message.slice(0, 80)}` : 'it went through')
  }

  // ── the switch ──
  let s = await runFile(d, read(V103F))
  note(s.ok, 'v103 runs here', s.ok ? '' : `${s.code}: ${s.said.slice(0, 120)}`)
  s = await runFile(d, read(V104F))
  note(s.ok, 'v104 runs here', s.ok ? '' : `${s.code}: ${s.said.slice(0, 120)}`)

  // ── after the switch ──
  note(sameJson((await rowsOn(d, LOOKUP)).map(x => x.id), ['a1l01', 'a1l02']),
       'after v104 the same lookup finds a1l01 and a1l02 by the Whop lesson ids of the catalog')
  const SWITCH = `(select value::timestamptz from admin_config where key = 'curriculum_reset_at')`
  // What the webhook writes for lesson A, two minutes after the switch.
  await d.exec(`insert into student_lesson_completions (student_id, lesson_id, completed_at) values ('${T1}', 'a1l01', ${SWITCH} + interval '2 minutes');`)
  r = await readFor(EMAIL)
  note(r.ok && r.same, 'after v104 the read runs and changes nothing', told(r))
  note(sameJson(r.part('a.'), [['the new course', `141 lessons, 141 with a Whop lesson id · the switch ran ${await at(SWITCH, 'Dy DD Mon HH24:MI')}`]]),
       'part a: the new course, 141 lessons with their Whop lesson ids, and when the switch ran', asJson(r.part('a.')))
  note(sameJson(r.part('c.'), [['Mon 19 Oct 10:30:00', 'Whop sent 3 · matched 0 · unmatched 3 · before the switch']]),
       "part c: a check from before the switch says so", asJson(r.part('c.')))
  note(sameJson(r.part('e.'), [[`a1l01 · ${A.title}`, `watched ${await at(`${SWITCH} + interval '2 minutes'`)} · later than the last check`]]),
       'part e: the completion the webhook wrote reads "later than the last check"', asJson(r.part('e.')))

  // The check on the next visit: B, finished on Whop, now matched too.
  await d.exec(`
    insert into student_lesson_completions (student_id, lesson_id, completed_at) values ('${T1}', 'a1l02', ${SWITCH} + interval '3 minutes');
    update student_whop_sync set last_sync_at = ${SWITCH} + interval '3 minutes 1 second', last_sync_fetched = 2,
           last_sync_matched = 2, last_sync_unmatched = '{}' where student_id = '${T1}';`)
  r = await readFor(EMAIL)
  note(r.ok && r.same && sameJson(r.part('c.'), [[await at(`${SWITCH} + interval '3 minutes 1 second'`), 'Whop sent 2 · matched 2 · unmatched 0']])
       && r.part('d.').length === 0
       && sameJson(r.part('e.'), [[`a1l01 · ${A.title}`, `watched ${await at(`${SWITCH} + interval '2 minutes'`)}`],
                                  [`a1l02 · ${B.title}`, `watched ${await at(`${SWITCH} + interval '3 minutes'`)}`]]),
       'after a check: matched 2, unmatched 0, nothing in part d, and both lessons in part e, neither later than the check', told(r))

  // The two sentences the check writes in place of a count.
  await d.exec(`update student_whop_sync set last_sync_error = 'Whop returned 2 interactions but 0 marked completed',
                last_sync_error_at = last_sync_at where student_id = '${T1}';`)
  r = await readFor(EMAIL)
  const checkAt = await at(`${SWITCH} + interval '3 minutes 1 second'`)
  note(r.ok && sameJson(r.part('c.'), [[checkAt, `Whop sent 2 · matched 2 · unmatched 0 · note ${checkAt}: Whop returned 2 interactions but 0 marked completed`]]),
       'part c: the "0 marked completed" sentence, written with the check, reads as a note', asJson(r.part('c.')))
  await d.exec(`update student_whop_sync set last_sync_error = 'Whop user_id filter ignored for user_x, refusing to write',
                last_sync_error_at = last_sync_at + interval '1 minute' where student_id = '${T1}';`)
  r = await readFor(EMAIL)
  const errAt = await at(`${SWITCH} + interval '4 minutes 1 second'`)
  note(r.ok && sameJson(r.part('c.'), [[checkAt, `Whop sent 2 · matched 2 · unmatched 0 · error ${errAt}: Whop user_id filter ignored for user_x, refusing to write`]]),
       'part c: a failure after the last check reads as an error, with its own time', asJson(r.part('c.')))
  await d.close()
}

// ════════════════════════════════════════════════════════════════════
// 29: v108 and its undo (bug hunt of 19 October, cron-3). v55 made
// increment_region_quiz_attempts security definer, with no check of who
// calls it and no grant line, so it kept the grants a new function gets:
// Postgres's to public, which anon and authenticated inherit, and on
// Supabase the API roles' own (default privileges). Each world on a
// database of its own: base.sql, a region and two students, and v55's
// function and comment lifted verbatim. Calls are made as the API roles,
// inside a transaction that is rolled back.
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 29. v108: only the server calls increment_region_quiz_attempts, and its undo ===')
{
  const V55F = '2026_v55_audit_security_cleanup.sql'
  const v108 = read('2026_v108_revoke_region_quiz_function.sql')
  const undo108 = undoText('2026_v108_undo.sql')
  const v55fn = lift(V55F, 'create or replace function increment_region_quiz_attempts(', '$$;')
  const v55comment = lift(V55F, 'comment on function increment_region_quiz_attempts(uuid, text) is')
  const FN = 'public.increment_region_quiz_attempts(uuid, text)'
  const ONLY_SERVER = asJson({ visitor: false, student: false, server: true })
  const EVERYONE = asJson({ visitor: true, student: true, server: true })
  note(undo108.includes(`drop function if exists ${FN};`) && undo108.includes(`${v55fn}\n\n${v55comment}`),
       "the undo drops the function and makes it again from v55's function and comment, word for word")

  for (const [world, seam] of [
    ['as on Supabase', 'alter default privileges in schema public grant all on functions to anon, authenticated, service_role;'],
    ['on plain Postgres', null],
  ]) {
    const say = (pass, label, detail = '') => note(pass, `${label} [${world}]`, detail)
    const d = new PGlite()
    await d.exec(fs.readFileSync(new URL('base.sql', import.meta.url), 'utf8'))
    if (seam) await d.exec(seam)
    await d.exec(v55fn)
    await d.exec(v55comment)
    await d.exec(`insert into regions (id, order_num, name, terrain) values ('r1', 1, 'Foundation', 'shore');
                  insert into students (id, supabase_user_id) values ('${UID(1)}', '${UID(1)}'), ('${UID(2)}', '${UID(2)}');`)
    // The function as the catalog holds it: its ACL as stored (null is the
    // default grant to public), its definition, comment and owner.
    const fnState = async (dd = d) => asJson((await dd.query(`select p.proacl::text as acl, pg_get_functiondef(p.oid) as def,
        obj_description(p.oid, 'pg_proc') as comment, pg_get_userbyid(p.proowner)::text as owner
      from pg_proc p where p.oid = to_regprocedure('${FN}')`)).rows)
    // Everything but the ACL: what v108 must leave as it was.
    const shape = async () => asJson(JSON.parse(await fnState()).map(x => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'acl'))))
    const aclOf = async () => {
      const s = JSON.parse(await fnState())
      return s.length === 0 ? 'no function' : s[0].acl ?? 'null (the default grant to public)'
    }
    const can = async () => asJson((await d.query(`select has_function_privilege('anon', '${FN}', 'execute') as visitor,
        has_function_privilege('authenticated', '${FN}', 'execute') as student,
        has_function_privilege('service_role', '${FN}', 'execute') as server`)).rows[0])
    // Student 2's quiz row written by someone else's call: a visitor, student 1, or the server.
    const callFor2 = role => asRole(d, role, `select public.increment_region_quiz_attempts('${UID(2)}', 'r1') as n`,
      { uid: role === 'authenticated' ? UID(1) : '', check: `select quiz_attempts from student_region_quiz where student_id = '${UID(2)}'` })
    const denied = r => !r.ok && r.code === '42501' && /permission denied for function increment_region_quiz_attempts/.test(r.said)

    // ── before v108 (v55, as production has it) ──
    const before = await fnState(), shapeBefore = await shape(), stateBefore = await stateOf(d)
    {
      const visitor = await callFor2('anon')
      const student = await callFor2('authenticated')
      say(await can() === EVERYONE && visitor.ok && sameJson(visitor.checked, [{ quiz_attempts: 1 }]) && student.ok && sameJson(student.checked, [{ quiz_attempts: 1 }]),
          "before v108: a visitor with only the public key, and student 1, can each create student 2's quiz row with one call",
          `${await can()} acl ${await aclOf()}`)
    }

    // ── v108, first run ──
    {
      const MARK = '-- ─────────────── 1 to 3. Who may call it'
      const c = await d.clone()
      const rr = await runFile(c, probeAt(v108, MARK, 'v108_timeout', `current_setting('lock_timeout')`))
      const timeout = await probed(c, 'v108_timeout')
      await c.close()
      say(v108.includes(MARK) && rr.ok && timeout.v === '5s' && timeout.after === '0',
          'v108 runs with lock_timeout 5s, and the setting ends with its commit', `${timeout.v}, after ${timeout.after}`)
    }
    let r = await runFile(d, v108)
    const after = await fnState()
    say(r.ok && r.rows.length === 1 && r.rows[0].v108?.startsWith('v108 ran now: only the server can call increment_region_quiz_attempts.')
        && r.rows[0].visitor_can === false && r.rows[0].student_can === false && r.rows[0].server_can === true && await can() === ONLY_SERVER,
        'v108 runs: anon and authenticated lose EXECUTE, the service role keeps it, and its one row says so', `${told(r)} acl ${await aclOf()}`)
    {
      const visitor = await callFor2('anon')
      const student = await callFor2('authenticated')
      const server = await callFor2('service_role')
      say(denied(visitor) && denied(student) && server.ok && sameJson(server.checked, [{ quiz_attempts: 1 }]),
          'after v108: a visitor and a student are refused before the function runs (42501); the service role still calls it',
          `${visitor.code} / ${student.code} / server ${server.ok ? 'ok' : told(server)}`)
    }
    {
      const acl = await aclOf()
      const owner = (await d.query(`select has_function_privilege('postgres', '${FN}', 'execute') as o`)).rows[0].o
      say(seam ? acl === '{postgres=X/postgres,service_role=X/postgres}' && JSON.parse(before)[0].acl.includes('service_role=X/postgres')
               : acl === '{postgres=X/postgres,service_role=X/postgres}' && JSON.parse(before)[0].acl === null,
          seam ? "the service role keeps its own grant from Supabase's defaults, as it was; the owner keeps EXECUTE"
               : 'the service role held EXECUTE through public and now holds it directly; the owner keeps EXECUTE',
          `${JSON.parse(before)[0].acl} -> ${acl}`)
      // stateOf: every policy, table grant, function (name, security
      // definer, owner) and row; the function's ACL is the one thing apart.
      say(owner && await shape() === shapeBefore && await stateOf(d) === stateBefore,
          "v108 changes only who may call it: the function's body, comment and owner, every other grant and every row are as they were")
    }

    // ── run again ──
    {
      const was = await stateOf(d)
      r = await runFile(d, v108)
      say(r.ok && r.rows[0]?.v108 === 'v108 was already in place. This run changed nothing.'
          && await stateOf(d) === was && await fnState() === after && await can() === ONLY_SERVER,
          'v108 run again: "already in place", and nothing changed', told(r))
    }

    // ── the undo ──
    {
      const MARK = `drop function if exists ${FN};`
      const c = await d.clone()
      const rr = await runFile(c, probeAt(undo108, MARK, 'u108_timeout', `current_setting('lock_timeout')`))
      const timeout = await probed(c, 'u108_timeout')
      await c.close()
      say(rr.ok && timeout.v === '5s' && timeout.after === '0', 'the undo runs with lock_timeout 5s, and the setting ends with its commit')
    }
    r = await runFile(d, undo108)
    say(r.ok && r.rows[0]?.visitor_can === true && r.rows[0]?.student_can === true && r.rows[0]?.server_can === true
        && await fnState() === before && await stateOf(d) === stateBefore,
        "the undo puts the grants back exactly as v55 left them (the ACL as stored, byte for byte), with v55's body, comment and owner, and every row as before",
        `acl ${await aclOf()}`)
    {
      const visitor = await callFor2('anon')
      say(visitor.ok && sameJson(visitor.checked, [{ quiz_attempts: 1 }]), 'after the undo a visitor can call it again: it reopens the door, as its header says')
      const was = await stateOf(d)
      r = await runFile(d, undo108)
      say(r.ok && await fnState() === before && await stateOf(d) === was, 'a second undo changes nothing', told(r))
      r = await runFile(d, v108)
      say(r.ok && r.rows[0]?.v108?.startsWith('v108 ran now') && await fnState() === after && await can() === ONLY_SERVER,
          'v108 applies again after its undo: the same grants as its first run', told(r))
    }

    // ── nothing to close, and a refusal ──
    {
      const c = await d.clone()
      await c.exec(`drop function ${FN};`)
      const was = await stateOf(c)
      const rr = await runFile(c, v108)
      say(rr.ok && rr.rows[0]?.v108 === 'increment_region_quiz_attempts does not exist, so there was nothing to close. This run changed nothing.'
          && rr.rows[0].visitor_can === null && await stateOf(c) === was,
          'with the function gone, v108 says there was nothing to close, and changes nothing', told(rr))
      await c.close()
    }
    if (!seam) {
      const c = await d.clone()
      await runFile(c, undo108)
      await c.exec('drop role anon;')
      const was = await stateOf(c), fnWas = await fnState(c)
      const rr = await runFile(c, v108)
      say(stopped(rr, 'These roles are missing: anon.') && await stateOf(c) === was && await fnState(c) === fnWas,
          'with the role anon missing, v108 refuses, says so, and changes nothing', told(rr))
      await c.close()
    }
    await d.close()
  }
}

// 30: diagnostics/admin-today-spotcheck.sql, the read Lovro runs at the
// admin rebuild's ship step (admin rebuild PRD, validation row 15): 5
// members picked at random from the ones Today lists from, each with the
// numbers Today and the 30% page show. After v104, on a database of its
// own, with made-up members: the file runs the way the SQL editor runs it
// and changes nothing, picks only members Today can list, and every column
// equals the same fact worked out here separately: lesson_is_complete()
// and the two views' rules written again in JavaScript, the 30% rule of
// src/lib/world/discount.ts with its dates and its 14 days read from the
// source, the plan ids read from constants.ts and plans.ts, and the dates
// in Croatia time through Intl, as src/lib/admin/croatia-dates.ts reads
// them. A member is put on each edge of the rule, so a date in the file
// that drifts from the source fails here.
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 30. the admin spot check (diagnostics/admin-today-spotcheck.sql), after v104 ===')
{
  const d = await chainDatabase()
  const raw = diagnostic('admin-today-spotcheck.sql')
  const src = rel => fs.readFileSync(fileURLToPath(new URL('../../src/' + rel, import.meta.url)), 'utf8')
  const constOf = (text, name) => {
    const m = text.match(new RegExp(`export const ${name} = "([^"]+)";`))
    if (!m) throw new Error(`${name} is not in the source`)
    return m[1]
  }
  const idsIn = (text, decl) => {
    const at = text.indexOf(decl)
    if (at < 0) throw new Error(`${decl} is not in the source`)
    return [...text.slice(at, text.indexOf(']', at)).matchAll(/"(plan_[A-Za-z0-9]+)"/g)].map(m => m[1])
  }
  // The rule as the student app holds it (src/lib/world/discount.ts, src/lib/constants.ts).
  const discountTs = src('lib/world/discount.ts')
  const ELIGIBLE = Date.parse(constOf(discountTs, 'DISCOUNT_ELIGIBLE_FROM'))
  const LAUNCH = Date.parse(constOf(discountTs, 'DISCOUNT_LAUNCH_DATE'))
  const SHARED = constOf(discountTs, 'DISCOUNT_SHARED_DEADLINE')
  const WINDOW_DAYS = Number(src('lib/constants.ts').match(/export const DISCOUNT_WINDOW_DAYS = (\d+);/)?.[1])
  const MONTHLY = idsIn(src('lib/constants.ts'), 'export const PAYING_WHOP_PLAN_IDS')
  const YEARLY = idsIn(src('lib/admin/plans.ts'), 'export const YEARLY_WHOP_PLAN_IDS')
  note(Number.isFinite(ELIGIBLE) && Number.isFinite(LAUNCH) && WINDOW_DAYS > 0 && MONTHLY.length === 1 && YEARLY.length === 2,
       "the rule's two dates, its shared deadline and its days, the monthly plan and the two yearly ones, read from the source",
       asJson({ ELIGIBLE: new Date(ELIGIBLE).toISOString(), LAUNCH: new Date(LAUNCH).toISOString(), SHARED, WINDOW_DAYS, MONTHLY, YEARLY }))
  const iso = ms => new Date(ms).toISOString()
  const deadlineOf = paid => {
    if (!paid) return null
    const t = Date.parse(paid)
    if (t < ELIGIBLE) return null
    if (t < LAUNCH) return SHARED
    return iso(t + WINDOW_DAYS * 86_400_000)
  }
  const planOf = id => (MONTHLY.includes(id) ? 'Monthly' : YEARLY.includes(id) ? 'Yearly' : 'Other plan')
  // Croatia time, read the way croatia-dates.ts reads it: Intl for the numbers, the names from tables.
  const ZAGREB = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zagreb', year: 'numeric', month: 'numeric', day: 'numeric',
                                                     hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
  const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const zagreb = when => {
    const n = {}
    for (const p of ZAGREB.formatToParts(new Date(when))) if (p.type !== 'literal') n[p.type] = Number(p.value)
    return { ...n, hour: n.hour % 24 }
  }
  const dayOf = when => { const c = zagreb(when); return `${WEEKDAY[new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay()]} ${c.day} ${MONTH[c.month - 1]}` }
  const clockOf = when => { const c = zagreb(when); return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}` }
  const COLS = ['name', 'email', 'student_id', 'membership', 'lessons', 'last_lesson', 'area', 'first_payment', 'videos_30', 'deadline_30']
  const told = r => (r.ok ? asJson(r.rows) : `${r.code}: ${r.said.slice(0, 160)}`)
  const dump = async () => {
    const out = {}
    for (const { tablename: t } of await rowsOn(d, `select tablename from pg_tables where schemaname = 'public' order by 1`)) {
      out[t] = (await rowsOn(d, `select * from public."${t}"`)).map(asJson).sort()
    }
    return asJson(out)
  }

  // ── the file itself ──
  const code = raw.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
  note(/^\s*with\b/i.test(code) && countOf(code, ';') === 1 && code.trim().endsWith(';')
       && !/\b(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|copy|call|lock|vacuum|refresh)\b/i.test(code)
       && !/REPLACE_WITH|line marked HERE/.test(raw),
       'the file is one read: a single select, no statement that writes, no placeholder to fill in')

  // ── the switch ──
  let s = await runFile(d, read(V103F))
  note(s.ok, 'v103 runs here', s.ok ? '' : `${s.code}: ${s.said.slice(0, 120)}`)
  s = await runFile(d, read(V104F))
  note(s.ok, 'v104 runs here', s.ok ? '' : `${s.code}: ${s.said.slice(0, 120)}`)
  // Two columns of production's students table (schema.sql) that base.sql leaves out and the file reads.
  await d.exec(`alter table students add column if not exists name text,
                                     add column if not exists whop_membership_id text unique;`)

  // ── the course as v104 left it, and the videos ──
  const lessons = await rowsOn(d, `select l.id, l.type, l.sort_order, l.counts_toward_progress, l.requires_action, l.is_gate,
                                          r.order_num, r.name as area
                                     from lessons l join regions r on r.id = l.region_id order by l.sort_order`)
  const counting = lessons.filter(l => l.counts_toward_progress).length
  const gateAt = lessons.findIndex(l => l.is_gate === true)
  const upToGate = lessons.slice(0, gateAt + 1).filter(l => l.type === 'watch' && l.counts_toward_progress !== false)
  note(counting === 140 && upToGate.length === 61 && upToGate[0]?.id === 'a1l01' && upToGate.at(-1)?.id === 'a4l17',
       'after v104: 140 lessons count, and with a video on each the 30% would ask for 61, a1l01 to a4l17',
       `${counting} counting, ${upToGate.length} up to the checkpoint, ${upToGate[0]?.id} to ${upToGate.at(-1)?.id}`)
  // One of them has no video yet, and three lessons past the checkpoint have one.
  const NOVIDEO = upToGate[9].id
  const pastGate = lessons.slice(gateAt + 1).filter(l => l.type === 'watch' && l.counts_toward_progress).slice(0, 3)
  const ASKED = upToGate.filter(l => l.id !== NOVIDEO)
  const COMPOUND = ASKED.find(l => l.requires_action)
  // Well-formed FAKE video ids, as in sections 18 to 24. Never a real one.
  const SPOTFAKE = n => ['vid', `spotcheckfake${String(n).padStart(3, '0')}`].join('_')
  await d.exec(`insert into lesson_videos (lesson_id, tella_video_id) values
    ${[...ASKED, ...pastGate].map((l, i) => `('${l.id}', '${SPOTFAKE(i + 1)}')`).join(',\n    ')};`)

  // ── the members, all made up ──
  const ID = n => `c2900000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`
  const at = (base, minutes) => iso(Date.parse(base) + minutes * 60_000)
  const PEOPLE = [
    // In Today's population: active or past due, a Whop membership, not exempt.
    { n: 1, name: 'Ana Spot', status: 'active', plan: MONTHLY[0], paid: '2026-10-02T10:00:00.000Z',
      // Every lesson up to the checkpoint, the one with no video included; the last at 00:30 on Wed 21 Oct in Croatia.
      done: upToGate.map((l, i) => ({ id: l.id, at: l.id === 'a4l17' ? '2026-10-20T22:30:00.000Z' : at('2026-10-15T08:00:00.000Z', i),
                                      action: l.requires_action ? at('2026-10-15T09:00:00.000Z', i) : null })) },
    { n: 2, name: 'Bo Spot', status: 'past_due', plan: YEARLY[0], paid: iso(ELIGIBLE + 30 * 60_000),
      // 20 videos, a skip that is no video, and the lesson with no video.
      done: [...ASKED.slice(0, 20).map((l, i) => ({ id: l.id, at: at('2026-10-19T16:00:00.000Z', i),
                                                    action: l.requires_action ? at('2026-10-19T17:00:00.000Z', i) : null })),
             { id: ASKED[20].id, at: null, skipped: '2026-10-19T18:00:00.000Z' },
             { id: NOVIDEO, at: '2026-10-19T18:05:00.000Z' }] },
    { n: 3, name: 'Cy Spot', status: 'active', plan: 'plan_madeupfree', paid: iso(LAUNCH), done: [] },
    { n: 4, name: 'Di Spot', status: 'active', plan: MONTHLY[0], paid: '2026-10-12T09:15:00.000Z',
      // Two plain lessons, and an action item's video with its hand-in still open.
      done: [{ id: ASKED[0].id, at: '2026-10-19T15:00:00.000Z' }, { id: ASKED[1].id, at: '2026-10-19T15:20:00.000Z' },
             { id: COMPOUND.id, at: '2026-10-20T07:00:00.000Z' }] },
    { n: 5, name: 'Ed Spot', status: 'active', plan: MONTHLY[0], paid: iso(ELIGIBLE - 60_000),
      done: ASKED.slice(0, 5).map((l, i) => ({ id: l.id, at: at('2026-10-20T06:00:00.000Z', i) })) },
    { n: 6, name: 'Flo Spot', status: 'active', plan: YEARLY[1], paid: null,
      // A lesson past the checkpoint, with a video: progress, and nothing the 30% asks for.
      done: [{ id: pastGate[0].id, at: '2026-10-20T09:00:00.000Z' }] },
    { n: 7, name: 'Gus Spot', status: 'active', plan: MONTHLY[0], paid: iso(LAUNCH - 60_000),
      // The Ad Bounty lesson, which does not count.
      done: [{ id: 'a7l19', at: '2026-10-20T10:00:00.000Z' }] },
    // Not in it: each must never be picked.
    { n: 11, name: 'Hal Out', status: 'canceled', plan: MONTHLY[0], paid: '2026-10-03T10:00:00.000Z', done: [] },
    { n: 12, name: 'Ivy Out', status: 'expired', plan: MONTHLY[0], paid: '2026-10-03T10:00:00.000Z', done: [] },
    { n: 13, name: 'Jo Out', status: 'active', plan: MONTHLY[0], paid: '2026-10-03T10:00:00.000Z', done: [], noMembership: true },
    { n: 14, name: 'Kai Out', status: 'active', plan: MONTHLY[0], paid: '2026-10-03T10:00:00.000Z', done: [], exempt: true },
    { n: 15, name: 'Lu Out', status: null, plan: MONTHLY[0], paid: '2026-10-03T10:00:00.000Z', done: [] },
  ]
  const lit = v => (v == null ? 'null' : `'${v}'`)
  await d.exec(PEOPLE.map(p => `
    insert into students (id, supabase_user_id, name, email, membership_status, whop_plan_id, first_paid_at, csm_exempt, whop_membership_id)
    values ('${ID(p.n)}', '${ID(p.n)}', '${p.name}', 'spot-${p.n}@example.test', ${lit(p.status)}, '${p.plan}', ${lit(p.paid)},
            ${p.exempt ? 'true' : 'false'}, ${p.noMembership ? 'null' : `'mem_spot${p.n}'`});
    ${p.done.map(c => `insert into student_lesson_completions (student_id, lesson_id, completed_at, action_completed_at, skipped_at)
      values ('${ID(p.n)}', '${c.id}', ${lit(c.at)}, ${lit(c.action)}, ${lit(c.skipped)});`).join('\n')}`).join('\n'))

  // ── what each row must say, worked out here ──
  const byId = new Map(lessons.map(l => [l.id, l]))
  const asked = new Set(ASKED.map(l => l.id))
  const complete = (l, c) => doneJs({ requires_action: l.requires_action, completed_at: c.at ?? null,
                                      action_completed_at: c.action ?? null, skipped_at: c.skipped ?? null })
  const expected = new Map()
  for (const p of PEOPLE.filter(x => x.n < 10)) {
    const counted = p.done.filter(c => byId.get(c.id).counts_toward_progress && complete(byId.get(c.id), c))
    const moments = counted.filter(c => c.at).map(c => Math.max(Date.parse(c.at), c.action ? Date.parse(c.action) : -Infinity))
    const top = counted.map(c => byId.get(c.id)).sort((a, b) => b.order_num - a.order_num)[0]
    const last = moments.length ? iso(Math.max(...moments)) : null
    const ends = deadlineOf(p.paid)
    expected.set(ID(p.n), {
      name: p.name,
      email: `spot-${p.n}@example.test`,
      student_id: ID(p.n),
      membership: `${p.status.replace('_', ' ')}, ${planOf(p.plan)}`,
      lessons: `${counted.length} of ${counting} lessons`,
      last_lesson: last ? `${dayOf(last)}, ${clockOf(last)}` : 'No lesson yet',
      area: top ? top.area : 'none',
      first_payment: p.paid ? dayOf(p.paid) : 'No first payment on file',
      videos_30: `${new Set(p.done.filter(c => c.at && asked.has(c.id)).map(c => c.id)).size} of ${ASKED.length} videos`,
      deadline_30: ends ? `${dayOf(ends)}, ${clockOf(ends)} (Croatia time)` : 'No 30% deadline',
    })
  }
  const IN = new Set(expected.keys())
  const want = n => expected.get(ID(n))
  // The edges, written out by hand: the worked-out rule must say exactly this.
  note(want(1).videos_30 === '60 of 60 videos' && want(1).lessons === '61 of 140 lessons' && want(1).last_lesson === 'Wed 21 Oct, 00:30'
       && want(1).first_payment === 'Fri 2 Oct' && want(1).deadline_30 === 'Fri 23 Oct, 23:59 (Croatia time)'
       && want(2).first_payment === 'Thu 1 Oct' && want(2).deadline_30 === 'Fri 23 Oct, 23:59 (Croatia time)' && want(2).videos_30 === '20 of 60 videos'
       && want(2).membership === 'past due, Yearly'
       && want(3).first_payment === 'Fri 9 Oct' && want(3).deadline_30 === 'Fri 23 Oct, 00:00 (Croatia time)'
       && want(3).lessons === '0 of 140 lessons' && want(3).area === 'none' && want(3).last_lesson === 'No lesson yet' && want(3).membership === 'active, Other plan'
       && want(4).deadline_30 === 'Mon 26 Oct, 10:15 (Croatia time)' && want(4).videos_30 === '3 of 60 videos' && want(4).lessons === '2 of 140 lessons'
       && want(5).first_payment === 'Wed 30 Sep' && want(5).deadline_30 === 'No 30% deadline' && want(5).videos_30 === '5 of 60 videos'
       && want(6).first_payment === 'No first payment on file' && want(6).videos_30 === '0 of 60 videos' && want(6).lessons === '1 of 140 lessons'
       && want(7).first_payment === 'Thu 8 Oct' && want(7).deadline_30 === 'Fri 23 Oct, 23:59 (Croatia time)' && want(7).lessons === '0 of 140 lessons'
       && want(7).area === 'none',
       "the worked-out rows say what the edges must: 1 October and 9 October in Croatia, the shared and the own deadline (Mon 26 Oct after the clocks go back), a video with no lesson, a skip, a hand-in still open, a lesson past the checkpoint, the Ad Bounty",
       asJson([...expected.values()].map(e => [e.name, e.lessons, e.last_lesson, e.area, e.first_payment, e.videos_30, e.deadline_30])))

  // ── the file, as the owner runs it ──
  const was = await dump()
  let r = await runFile(d, raw)
  note(r.ok && sameJson(r.cols, COLS), 'it runs after v104, with its ten columns in order', r.ok ? r.cols.join(', ') : told(r))
  note(await dump() === was, 'it changes nothing: every table reads the same after it')
  note(r.ok && r.rows.length === 5 && new Set(r.rows.map(x => x.student_id)).size === 5 && r.rows.every(x => IN.has(x.student_id)),
       '5 members, each once, each one Today lists from', told(r))
  note(r.ok && sameJson(r.rows.map(x => x.name), r.rows.map(x => x.name).sort()), 'sorted by name')
  note(r.ok && !/vid_|tella/i.test(asJson(r.rows)), 'no video id in what it shows')

  // Many runs: every member of the population turns up, nobody else ever does, every row is right.
  const seen = new Set()
  const wrong = []
  const outsiders = []
  for (let i = 0; i < 40; i++) {
    const x = await runFile(d, raw)
    if (!x.ok) { wrong.push(told(x)); break }
    for (const row of x.rows) {
      seen.add(row.student_id)
      if (!IN.has(row.student_id)) outsiders.push(row.name)
      else if (!sameJson(row, expected.get(row.student_id))) wrong.push(asJson({ got: row, want: expected.get(row.student_id) }))
    }
  }
  note(seen.size === IN.size && outsiders.length === 0,
       'over 40 runs all 7 members of the population are picked, and never the canceled, expired, exempt, status-less or no-Whop-membership one, nor the seed\'s',
       `${seen.size} seen; outsiders: ${asJson([...new Set(outsiders)])}`)
  note(wrong.length === 0, "every row equals the row worked out here: the lessons, the last one, the area, the first payment, the 30%'s videos and deadline",
       wrong.slice(0, 2).join(' | '))

  // The session's time zone changes nothing: the same picks (one seed) read the same in UTC, Croatia and New York.
  const seeded = async zone => {
    await d.exec(`set timezone to '${zone}';`)
    const x = await runFile(d, `select setseed(0.29);\n${raw}`)
    await d.exec(`set timezone to 'UTC';`)
    return x
  }
  const inUtc = await seeded('UTC')
  const inZagreb = await seeded('Europe/Zagreb')
  const inNewYork = await seeded('America/New_York')
  note(inUtc.ok && inUtc.rows.length === 5 && sameJson(inZagreb.rows, inUtc.rows) && sameJson(inNewYork.rows, inUtc.rows),
       "the SQL editor's time zone changes nothing: the same 5 members read the same with the session in UTC, Europe/Zagreb and America/New_York",
       inUtc.ok ? `${inUtc.rows.map(x => `${x.name}: ${x.deadline_30}`).join('; ')}` : told(inUtc))
  {
    // Di's 14 days end after the clocks go back on 25 October. Pick her alone and read her under Croatia's clock.
    await d.exec(`set timezone to 'Europe/Zagreb';`)
    const alone = await runFile(d, raw.replace("s.membership_status in ('active', 'past_due')", `s.id = '${ID(4)}' and s.membership_status in ('active', 'past_due')`))
    await d.exec(`set timezone to 'UTC';`)
    note(countOf(raw, "s.membership_status in ('active', 'past_due')") === 1 && alone.ok && alone.rows.length === 1
         && alone.rows[0].deadline_30 === 'Mon 26 Oct, 10:15 (Croatia time)',
         "14 days from 11:15 on Mon 12 Oct end at 10:15 on Mon 26 Oct in Croatia, with the session on Croatia's clock too (336 hours, not 14 calendar days)",
         told(alone))
  }
  await d.close()
}

// ════════════════════════════════════════════════════════════════════
// 31: v109 and its undo (admin rebuild 2, D7): the Tasks queue starts fresh
// for the new program. On a database of its own: base.sql with v27's one
// open task per student and scenario lifted verbatim (the undo has to step
// around it), made-up students, templates and a team member, and tasks in
// every state. Open: two of a cron's scenario (one with notes, one
// without), one of a custom template, one of an exempt student, one with
// no template. Sent and dismissed ones, which must not move.
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 31. v109: the tasks reset (admin rebuild 2, D7), and its undo ===')
{
  const v109 = read('2026_v109_tasks_reset.sql')
  const undo109 = undoText('2026_v109_undo.sql')
  const MARK_NOTE = ' [reset for the new program]'
  const LOCK109 = 'lock table public.tasks in share row exclusive mode;'
  const S = n => `31000000-0000-0000-0000-${String(n).padStart(12, '0')}`
  const TK = n => `31a00000-0000-0000-0000-${String(n).padStart(12, '0')}`
  const TEAM31 = '31c00000-0000-0000-0000-000000000001'
  const d = new PGlite()
  await d.exec(fs.readFileSync(new URL('base.sql', import.meta.url), 'utf8'))
  await d.exec(lift('2026_v27_csm_layer.sql', 'create unique index if not exists idx_tasks_unique_open'))
  await d.exec(`
    insert into team_members (id, email) values ('${TEAM31}', 'robin@example.com');
    insert into students (id, email, csm_exempt, first_paid_at, membership_status) values
      ('${S(1)}', 'one@example.com', false, '2026-10-02 10:00:00+00', 'active'),
      ('${S(2)}', 'two@example.com', false, '2026-10-05 10:00:00+00', 'active'),
      ('${S(3)}', 'three@example.com', true, '2026-10-06 10:00:00+00', 'active'),
      ('${S(4)}', 'four@example.com', false, '2026-09-20 10:00:00+00', 'past_due');
    insert into templates (id, scenario_id, bucket, title, trigger_description, body) values
      ('31b00000-0000-0000-0000-000000000001', 'stalled.discord.day3', 'at_risk', 'Stalled day 3', 'No login by day 3', 'Hey {firstName}'),
      ('31b00000-0000-0000-0000-000000000002', 'C-42c1aa', 'cancel_path', 'Is cancelling', 'Canceling', 'Hey {firstName}');
    insert into tasks (id, student_id, scenario_id, template_id, status, behavior_summary, created_at, completed_at, completed_by,
                       dismissed_at, dismissed_by, notes, outcome, outcome_at, outcome_by) values
      ('${TK(1)}', '${S(1)}', 'stalled.discord.day3', '31b00000-0000-0000-0000-000000000001', 'open', 'No login (Day 3)',
       '2026-10-18 09:15:00+00', null, null, null, null, null, null, null, null),
      ('${TK(2)}', '${S(2)}', 'stalled.discord.day3', '31b00000-0000-0000-0000-000000000001', 'open', null,
       '2026-10-19 09:15:00+00', null, null, null, null, 'checked twice', null, null, null),
      ('${TK(3)}', '${S(2)}', 'C-42c1aa', '31b00000-0000-0000-0000-000000000002', 'open', 'Is cancelling',
       '2026-10-17 11:15:00+00', null, null, null, null, null, null, null, null),
      ('${TK(4)}', '${S(3)}', 'stalled.discord.day3', '31b00000-0000-0000-0000-000000000001', 'open', null,
       '2026-10-16 09:15:00+00', null, null, null, null, null, null, null, null),
      ('${TK(5)}', '${S(4)}', 'support.nostart', null, 'open', null,
       '2026-10-15 09:15:00+00', null, null, null, null, null, null, null, null),
      ('${TK(6)}', '${S(1)}', 'nolessons.day3', null, 'completed', 'No lesson (Day 3)',
       '2026-10-05 09:15:00+00', '2026-10-05 12:00:00+00', '${TEAM31}', null, null, null, 'replied', '2026-10-06 08:00:00+00', '${TEAM31}'),
      ('${TK(7)}', '${S(2)}', 'nolessons.day7', null, 'dismissed', null,
       '2026-10-07 09:15:00+00', null, null, '2026-10-07 15:00:00+00', '${TEAM31}', 'Already replied in Discord', null, null, null),
      ('${TK(8)}', '${S(4)}', 'pace.behind', null, 'dismissed', null,
       '2026-10-01 09:15:00+00', null, null, '2026-10-19 14:33:33.972+00', null,
       'Dismissed by the course switch: the old course''s progress was reset.', null, null, null);`)
  const OPEN = [1, 2, 3, 4, 5].map(TK)
  const tasksNow = async (dd = d) => (await dd.query(`select * from tasks order by id`)).rows
  const byId = rows => Object.fromEntries(rows.map(r => [r.id, r]))
  const copyOf = async (dd = d, table = 'reset_2026_10') => (await dd.query(`select * from archive_tasks."${table}" order by id`)).rows
  const configOf = async (dd = d) => (await dd.query(`select key, value, description from admin_config order by key`)).rows
  const tasksBefore = await tasksNow()
  const configBefore = await configOf()
  // Everything outside tasks, admin_config and the new schema: what v109 must not touch.
  const outsideOf = async (dd = d) => {
    const c = JSON.parse(await catalogOf(dd))
    const rows = JSON.parse(await rowsOf(dd))
    delete rows.tasks
    delete rows.admin_config
    const notArchive = x => x.s !== 'archive_tasks' && x.n !== 'archive_tasks'
    return asJson({ ...c, schemas: c.schemas.filter(notArchive), tables: c.tables.filter(notArchive),
                    indexes: c.indexes.filter(notArchive), grants: c.grants.filter(notArchive), rows })
  }
  const outsideBefore = await outsideOf()

  // ── its lock ──
  {
    const MARK = '-- ─────────────── 2. Already reset? ───────────────'
    const c = await d.clone()
    const rr = await runFile(c, probeAt(probeAt(v109, MARK, 'v109_locked', lockedIn('ShareRowExclusiveLock')),
                                        MARK, 'v109_timeout', `current_setting('lock_timeout')`))
    const locked = await probed(c, 'v109_locked'), timeout = await probed(c, 'v109_timeout')
    await c.close()
    note(v109.includes(MARK) && rr.ok && locked.v === 'tasks' && timeout.v === '5s' && timeout.after === '0',
         'v109 holds tasks in SHARE ROW EXCLUSIVE (reads go on, a cron\'s insert or a click waits) before it reads anything, with lock_timeout 5s, and the setting ends with its commit',
         `${locked.v} [${timeout.v}, after ${timeout.after}] ${rr.ok ? '' : told(rr)}`)
    const c2 = await d.clone()
    const was = await stateOf(c2)
    const busy = await runFile(c2, v109.replace(LOCK109, TIMED_OUT))
    note(v109.includes(LOCK109) && busy.code === '55P03'
         && busy.said.includes('Another session held the tasks table for more than 5 seconds')
         && busy.said.includes('so the reset did not start. Nothing was changed. Paste it again in a minute.') && await stateOf(c2) === was,
         'v109 with its lock timing out (55P03, raised in place of the lock): "Nothing was changed. Paste it again in a minute.", and nothing changed', told(busy))
    await c2.close()
  }

  // ── the first run ──
  let r = await runFile(d, v109)
  const moment = r.rows?.[0]?.tasks_reset_at
  const momentMs = Date.parse(moment ?? '')
  note(r.ok && r.rows.length === 1 && ISO_Z.test(moment ?? '')
       && r.rows[0].v109 === `The tasks reset ran now, at ${moment}: 5 open tasks were copied to archive_tasks.reset_2026_10 and dismissed.`
       && r.rows[0].tasks_in_the_copy === 5 && r.rows[0].open_now === 0,
       'v109 runs: one row says the reset ran now, at its moment (UTC, like 2026-10-20T21:30:00.000Z), with 5 open tasks copied and dismissed and none open now',
       told(r))
  const after = byId(await tasksNow())
  const before = byId(tasksBefore)
  {
    const wrong = OPEN.filter(id => {
      const t = after[id], b = before[id]
      return !(t.status === 'dismissed' && t.dismissed_at?.getTime() === momentMs && t.dismissed_by === null
               && t.notes === (b.notes ?? '') + MARK_NOTE
               && asJson({ ...t, status: b.status, dismissed_at: b.dismissed_at, dismissed_by: b.dismissed_by, notes: b.notes }) === asJson(b))
    })
    note(wrong.length === 0,
         "each open task is dismissed at the run's moment, by nobody, with \" [reset for the new program]\" after its notes (\"checked twice [reset for the new program]\"; no notes: \" [reset for the new program]\"), every other column as it was: a cron's, a custom template's, an exempt student's and one with no template alike",
         asJson(wrong.map(id => [id, after[id].status, after[id].notes])))
    const closed = [TK(6), TK(7), TK(8)]
    note(closed.every(id => asJson(after[id]) === asJson(before[id])),
         'the sent and dismissed tasks, the course switch\'s dismissal among them, are byte for byte as they were')
  }
  {
    const copy = await copyOf()
    const sameAsBefore = copy.every(row => {
      const { reset_at: at, ...rest } = row
      return at?.getTime() === momentMs && asJson(rest) === asJson(before[row.id])
    })
    note(sameJson(copy.map(x => x.id), OPEN) && sameAsBefore,
         'archive_tasks.reset_2026_10 holds the 5 tasks that were open, every column as it was before the run, with reset_at the moment',
         asJson(copy.map(x => x.id.slice(-2))))
    const cols = (await d.query(`select column_name::text as c from information_schema.columns
                                  where table_schema = 'archive_tasks' and table_name = 'reset_2026_10' order by ordinal_position`)).rows.map(x => x.c)
    const taskCols = (await d.query(`select column_name::text as c from information_schema.columns
                                      where table_schema = 'public' and table_name = 'tasks' order by ordinal_position`)).rows.map(x => x.c)
    note(sameJson(cols, ['reset_at', ...taskCols]), "the copy's columns are reset_at, then every column of tasks", cols.join(','))
    const reads = (await d.query(`select has_schema_privilege(r, 'archive_tasks', 'usage') as schema_use,
                                         has_table_privilege(r, 'archive_tasks.reset_2026_10', 'select') as can_read
                                    from unnest(array['anon', 'authenticated', 'service_role']) as x(r)`)).rows
    note(reads.length === 3 && reads.every(x => x.schema_use === false && x.can_read === false),
         'nobody but the owner reads the copy: no USAGE on archive_tasks and no SELECT on the table for anon, authenticated or service_role',
         asJson(reads))
  }
  {
    const cfg = await configOf()
    const row = cfg.find(x => x.key === 'tasks_reset_at')
    note(row?.value === moment && /Set by migration 2026_v109/.test(row?.description ?? '')
         && asJson(cfg.filter(x => x.key !== 'tasks_reset_at')) === asJson(configBefore),
         'admin_config gains tasks_reset_at = the moment, with a description naming v109, and nothing else in it moves', row?.value)
    note(await outsideOf() === outsideBefore, 'every other table, row, policy, index and grant is as it was')
    // The floor the app reads: created_at on or after tasks_reset_at. Every reset task falls before it.
    const floor = (await d.query(`select count(*) filter (where created_at >= (select value::timestamptz from admin_config where key = 'tasks_reset_at'))::int as after,
                                         count(*)::int as all_ from tasks`)).rows[0]
    note(floor.after === 0 && floor.all_ === 8, 'every task is now older than tasks_reset_at, so the app\'s To do, Sent and Dismissed start empty', asJson(floor))
  }

  // ── run again ──
  {
    const was = await stateOf(d)
    const copyWas = asJson(await copyOf())
    r = await runFile(d, v109)
    note(r.ok && r.rows[0]?.v109 === `The tasks reset already ran, at ${moment}. This run changed nothing.`
         && r.rows[0].tasks_in_the_copy === 5 && await stateOf(d) === was && asJson(await copyOf()) === copyWas,
         'v109 run again: "already ran", and nothing changed', told(r))
  }

  // ── the crons and the team after the reset ──
  // A cron opens stalled.discord.day3 again for student 1 (check-na-tasks
  // reads no tasks). The team moves the custom template's task back to To do
  // (the transition route nulls the stamps and the notes), and dismisses the
  // exempt student's with their own reason.
  await d.exec(`
    insert into tasks (id, student_id, scenario_id, template_id, status, created_at)
      values ('${TK(9)}', '${S(1)}', 'stalled.discord.day3', '31b00000-0000-0000-0000-000000000001', 'open', now() + interval '2 hours');
    update tasks set status = 'open', dismissed_at = null, dismissed_by = null, notes = null where id = '${TK(3)}';
    update tasks set dismissed_at = now() + interval '3 hours', dismissed_by = '${TEAM31}', notes = 'Team test account' where id = '${TK(4)}';`)
  const beforeUndo = byId(await tasksNow())

  // ── the undo ──
  {
    const MARK = '-- ─────────────── 1 and 2. Is the reset in place'
    const c = await d.clone()
    const rr = await runFile(c, probeAt(probeAt(undo109, MARK, 'u109_locked', lockedIn('ShareRowExclusiveLock')),
                                        MARK, 'u109_timeout', `current_setting('lock_timeout')`))
    const locked = await probed(c, 'u109_locked'), timeout = await probed(c, 'u109_timeout')
    await c.close()
    note(undo109.includes(MARK) && rr.ok && locked.v === 'tasks' && timeout.v === '5s' && timeout.after === '0',
         'the undo holds tasks in SHARE ROW EXCLUSIVE before it reads anything, with lock_timeout 5s', `${locked.v} [${timeout.v}]`)
    const c2 = await d.clone()
    const was = await stateOf(c2)
    const busy = await runFile(c2, undo109.replace(LOCK109, TIMED_OUT))
    note(undo109.includes(LOCK109) && busy.code === '55P03'
         && busy.said.includes('so the undo did not start. Nothing was changed. Paste it again in a minute.') && await stateOf(c2) === was,
         'the undo with its lock timing out: "Nothing was changed. Paste it again in a minute.", and nothing changed', told(busy))
    await c2.close()
  }
  {
    const c = await d.clone()
    await c.exec(`alter table archive_tasks.reset_2026_10 rename to kept_by_hand;`)
    const was = await stateOf(c)
    const rr = await runFile(c, undo109)
    note(stopped(rr, 'but archive_tasks.reset_2026_10 is missing, so nothing can be put back from it.') && await stateOf(c) === was,
         'the undo with the copy missing refuses, says so, and changes nothing', told(rr))
    await c.close()
  }
  {
    const c = await d.clone()
    await c.exec(`update archive_tasks.reset_2026_10 set reset_at = reset_at - interval '1 day' where id = '${TK(2)}';`)
    const was = await stateOf(c)
    const rr = await runFile(c, undo109)
    note(stopped(rr, 'Rows of archive_tasks.reset_2026_10 from another moment than tasks_reset_at') && rr.said.includes('): 1. Nothing was changed.') && await stateOf(c) === was,
         'the undo with a row of the copy from another moment refuses, and changes nothing', told(rr))
    await c.close()
  }
  r = await runFile(d, undo109)
  const renamed = r.rows?.[0]?.copy_renamed_to ?? ''
  note(r.ok && r.rows.length === 1 && /^archive_tasks\.reset_2026_10_undone_\d{8}_\d{4}$/.test(renamed)
       && r.rows[0].v109_undo === `The tasks reset is undone: 2 tasks are open again. The copy is now ${renamed}.`
       && r.rows[0].tasks_reopened === 2 && r.rows[0].changed_since === 2 && r.rows[0].newer_open_task === 1 && r.rows[0].student_gone === 0,
       'the undo runs: 2 tasks open again, 2 kept as the team changed them, 1 kept behind the newer open task, and the copy renamed',
       told(r))
  {
    const now = byId(await tasksNow())
    note(asJson(now[TK(2)]) === asJson(before[TK(2)]) && asJson(now[TK(5)]) === asJson(before[TK(5)]),
         'the two reset tasks nobody touched are back byte for byte as before v109: open, their notes ("checked twice", none) as they were')
    note(asJson(now[TK(1)]) === asJson(beforeUndo[TK(1)]) && now[TK(9)].status === 'open',
         'student 1\'s reset stalled task stays dismissed, since the cron\'s newer one of the same scenario is open (one open task per student and scenario)')
    note(asJson(now[TK(3)]) === asJson(beforeUndo[TK(3)]) && asJson(now[TK(4)]) === asJson(beforeUndo[TK(4)]),
         'the task the team moved back to To do and the one they dismissed with their own reason stay as the team left them')
    note([TK(6), TK(7), TK(8)].every(id => asJson(now[id]) === asJson(before[id])), 'the sent and dismissed tasks still have not moved')
    note(asJson(await configOf()) === asJson(configBefore), 'admin_config is as before v109: no tasks_reset_at')
    const tables = (await d.query(`select tablename::text as t from pg_tables where schemaname = 'archive_tasks' order by 1`)).rows.map(x => x.t)
    note(sameJson(tables, [renamed.split('.')[1]]) && sameJson((await copyOf(d, renamed.split('.')[1])).map(x => x.id), OPEN),
         'the copy, all 5 rows, is kept under its new name', tables.join(','))
  }
  {
    const was = await stateOf(d)
    r = await runFile(d, undo109)
    note(r.ok && r.rows[0]?.v109_undo === 'The tasks reset is not in place (admin_config has no tasks_reset_at). This run changed nothing.'
         && r.rows[0].tasks_reopened === null && await stateOf(d) === was,
         'a second undo: "not in place", and nothing changed', told(r))
  }

  // ── v109 again after its undo ──
  {
    const open = (await d.query(`select id from tasks where status = 'open' order by id`)).rows.map(x => x.id)
    r = await runFile(d, v109)
    note(r.ok && r.rows[0]?.v109?.startsWith('The tasks reset ran now') && r.rows[0].tasks_in_the_copy === open.length
         && r.rows[0].open_now === 0 && sameJson((await copyOf()).map(x => x.id), open),
         `v109 runs again after its undo: a new copy of the ${open.length} tasks open now, the first copy kept beside it`, told(r))
  }
  {
    // A copy left behind with no tasks_reset_at: v109 refuses rather than mix two resets.
    const c = await d.clone()
    await c.exec(`delete from admin_config where key = 'tasks_reset_at';`)
    const was = await stateOf(c)
    const rr = await runFile(c, v109)
    note(stopped(rr, 'The table archive_tasks.reset_2026_10 exists, but admin_config has no tasks_reset_at') && await stateOf(c) === was,
         'v109 with a copy left from an earlier reset and no tasks_reset_at refuses, says so, and changes nothing', told(rr))
    await c.close()
  }
  {
    // With nothing open, the reset still sets its moment, with an empty copy.
    const c = new PGlite()
    await c.exec(fs.readFileSync(new URL('base.sql', import.meta.url), 'utf8'))
    const rr = await runFile(c, v109)
    note(rr.ok && /^The tasks reset ran now, at .*: 0 open tasks were copied/.test(rr.rows[0]?.v109 ?? '') && rr.rows[0].tasks_in_the_copy === 0
         && ISO_Z.test(rr.rows[0].tasks_reset_at ?? ''),
         'on a queue with nothing open, v109 still writes tasks_reset_at, with an empty copy', told(rr))
    const ru = await runFile(c, undo109)
    note(ru.ok && ru.rows[0]?.tasks_reopened === 0 && (await c.query(`select count(*)::int as n from admin_config`)).rows[0].n === 0,
         'and its undo takes the moment back out', told(ru))
    await c.close()
  }
  await d.close()
}

// ════════════════════════════════════════════════════════════════════
// 32: v110 and its undo (admin rebuild 2, D10, lane WI-7). v75 gave a
// student two write policies on student_lesson_ratings, so their own browser
// session could rate any lesson past POST /api/student/rate-lesson. On a
// database of its own (base.sql and the chain v92 to v101), with the
// Supabase seam of section 25 and v75's trigger, row level security and four
// policies lifted verbatim. What a student's session could send is run for
// real under SET ROLE authenticated, inside a transaction rolled back.
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 32. v110: students read their lesson ratings and write none; its undo ===')
{
  const V75F = '2026_v75_lesson_ratings.sql'
  const v110 = read('2026_v110_lesson_ratings_route_only.sql')
  const undo110 = undoText('2026_v110_undo.sql')
  const WRITES = ['students_insert_own_ratings', 'students_update_own_ratings']
  const READS = ['students_select_own_ratings', 'team_select_all_ratings']
  const policyOf = n => lift(V75F, `create policy "${n}"`)
  const blockOf = n => `${lift(V75F, `drop policy if exists "${n}"`)}\n${policyOf(n)}`
  note(WRITES.every(n => undo110.includes(blockOf(n))),
       "the undo makes v75's two write policies from v75's own text, word for word, each with its drop-if-exists")
  const LOCK110 = 'lock table public.student_lesson_ratings in access exclusive mode;'
  const MARK = '-- ─────────────── 2 to 4. The two write policies go ───────────────'
  const FIRST = 'v110 ran now: 2 dropped. Students read their own ratings and write none; the server writes them.'
  const AGAIN = 'v110 was already in place. This run changed nothing.'

  const d = await chainDatabase()
  // The seam, as on Supabase (section 25).
  await d.exec(`
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    alter role service_role bypassrls;`)
  for (const sql of [lift(V75F, 'create or replace function bump_student_lesson_ratings_updated_at()', '$$;'),
                     lift(V75F, 'create trigger trg_bump_student_lesson_ratings_updated_at'),
                     lift(V75F, 'alter table student_lesson_ratings enable row level security;'),
                     ...[...READS, ...WRITES].map(policyOf)]) {
    await d.exec(sql)
  }
  await d.exec(`insert into team_members (id, email) values ('${TEAM_ID}', 'team@example.test');
    insert into student_lesson_ratings (student_id, lesson_id, stars, comment) values
      ('${UID(1)}', 'l001', 4, 'Fine.'), ('${UID(2)}', 'l001', 2, null), ('${UID(2)}', 'l002', 5, 'Great.');`)

  const ratingPolicies = async dd => asJson((await dd.query(`
    select p.policyname::text as n, p.permissive, p.roles::text as roles, p.cmd, p.qual, p.with_check,
           obj_description(pol.oid, 'pg_policy') as comment
      from pg_policies p
      join pg_policy pol on pol.polrelid = 'public.student_lesson_ratings'::regclass and pol.polname = p.policyname
     where p.schemaname = 'public' and p.tablename = 'student_lesson_ratings'
     order by 1`)).rows)
  const without = (json, names) => asJson(JSON.parse(json).filter(p => !names.includes(p.n)))
  // The whole catalogue (section 25's catalogOf) with this table's policies left out, and every row.
  const restOf = async dd => {
    const c = JSON.parse(await catalogOf(dd))
    c.policies = c.policies.filter(p => p.t !== 'student_lesson_ratings')
    return asJson(c) + await rowsOf(dd)
  }
  const ownRead = `select lesson_id, stars from student_lesson_ratings order by lesson_id`
  const studentOneRows = [{ lesson_id: 'l001', stars: 4 }]
  {
    const s = (await d.query(`select (select relrowsecurity from pg_class where oid = 'public.student_lesson_ratings'::regclass) as rls,
        has_table_privilege('authenticated', 'public.student_lesson_ratings', 'insert') as granted,
        (select count(*)::int from pg_policies where tablename = 'student_lesson_ratings') as policies`)).rows[0]
    note(s.rls && s.granted && s.policies === 4,
         "harness: student_lesson_ratings as v75 left it: row level security on, students granted the table, v75's 4 policies", asJson(s))
  }
  const policiesBefore = await ratingPolicies(d)
  const restBefore = await restOf(d)
  const stateBefore = await stateOf(d)

  // ── the hole, before v110 ──
  {
    const ins = await asStudent(d, 1, `insert into student_lesson_ratings (student_id, lesson_id, stars, comment) values ('${UID(1)}', 'l064', 5, 'never watched it')`)
    const upd = await asStudent(d, 1, `update student_lesson_ratings set stars = 1, comment = repeat('x', 5000) where lesson_id = 'l001'`)
    const other = await asStudent(d, 1, `insert into student_lesson_ratings (student_id, lesson_id, stars) values ('${UID(2)}', 'l003', 1)`)
    const read = await asStudent(d, 1, ownRead)
    note(ins.ok && ins.n === 1 && upd.ok && upd.n === 1,
         'before v110 (the hole): a student, with their own session, rates a lesson they never finished and rewrites their rating with a 5000-character comment',
         `insert ${told(ins)}, update ${upd.n}`)
    note(rlsRefused(other) && read.ok && sameJson(read.rows, studentOneRows),
         '...but never for another student, and reads only their own: the policies apply, as the student', `${told(other)}; ${asJson(read.rows)}`)
    note(await stateOf(d) === stateBefore, '...and every attempt above was rolled back: nothing changed')
  }

  // ── its lock, its refusals ──
  {
    const c = await d.clone()
    const rr = await runFile(c, probeAt(probeAt(v110, MARK, 'v110_locked', lockedIn('AccessExclusiveLock')),
                                        MARK, 'v110_timeout', `current_setting('lock_timeout')`))
    const locked = await probed(c, 'v110_locked'), timeout = await probed(c, 'v110_timeout')
    await c.close()
    note(v110.includes(MARK) && rr.ok && locked.v === 'student_lesson_ratings' && timeout.v === '5s' && timeout.after === '0',
         'v110 holds student_lesson_ratings in ACCESS EXCLUSIVE before it reads anything, with lock_timeout 5s, and the setting ends with its commit',
         `${locked.v} [${timeout.v}, after ${timeout.after}] ${rr.ok ? '' : told(rr)}`)
    const c2 = await d.clone()
    const was = await stateOf(c2)
    const busy = await runFile(c2, v110.replace(LOCK110, TIMED_OUT))
    note(v110.includes(LOCK110) && busy.code === '55P03'
         && busy.said.includes('so v110 did not start. Nothing was changed. Paste it again in a minute.') && await stateOf(c2) === was,
         'v110 with its lock timing out (55P03, raised in place of the lock): "Nothing was changed. Paste it again in a minute.", and nothing changed', told(busy))
    await c2.close()
  }
  for (const [what, breakIt, sentence] of [
    ['row level security off', `alter table student_lesson_ratings disable row level security;`,
     'Row level security is off on student_lesson_ratings'],
    ['the table missing', `alter table student_lesson_ratings rename to student_lesson_ratings_aside;`,
     'student_lesson_ratings is missing'],
    ['a third write policy under another name', `create policy "ratings_delete_own" on student_lesson_ratings for delete to authenticated using (true);`,
     'These policies still write to student_lesson_ratings after this file: "ratings_delete_own" (DELETE).'],
  ]) {
    const c = await d.clone()
    const broke = await runFile(c, breakIt)
    const was = await stateOf(c)
    const rr = await runFile(c, v110)
    note(broke.ok && stopped(rr, sentence) && await stateOf(c) === was,
         `v110 refuses with ${what}: it says so, and nothing changed (the two v75 write policies included)`, broke.ok ? told(rr) : `the break failed: ${told(broke)}`)
    await c.close()
  }

  // ── v110 ──
  let r = await runFile(d, v110)
  note(r.ok && r.rows[0]?.v110 === FIRST && r.rows.length === 3
       && sameJson(r.rows.slice(1).map(x => [x.policy, x.command, x.v110]), [['students_select_own_ratings', 'SELECT', 'kept'], ['team_select_all_ratings', 'SELECT', 'kept']]),
       'v110 first run: "2 dropped", then the two read policies, kept', told(r))
  const policiesAfter = await ratingPolicies(d)
  note(policiesAfter === without(policiesBefore, WRITES) && JSON.parse(policiesAfter).every(p => p.cmd === 'SELECT'),
       "v110: the student INSERT and UPDATE policies are gone, and the student's and the team's SELECT are as they were, character for character",
       JSON.parse(policiesAfter).map(p => `${p.n}:${p.cmd}`).join(' '))
  note(await restOf(d) === restBefore, '...and nothing else differs: every other policy, table, index, grant, function and schema, and every row')

  // ── after v110, as a student, the team and the server ──
  {
    const stateAfterV110 = await stateOf(d)
    const ins = await asStudent(d, 1, `insert into student_lesson_ratings (student_id, lesson_id, stars) values ('${UID(1)}', 'l064', 5)`)
    const ups = await asStudent(d, 1, `insert into student_lesson_ratings (student_id, lesson_id, stars) values ('${UID(1)}', 'l001', 1)
                                       on conflict (student_id, lesson_id) do update set stars = excluded.stars`)
    const upd = await asStudent(d, 1, `update student_lesson_ratings set stars = 1 where lesson_id = 'l001'`)
    const del = await asStudent(d, 1, `delete from student_lesson_ratings where lesson_id = 'l001'`)
    note(rlsRefused(ins) && rlsRefused(ups) && upd.ok && upd.n === 0 && del.ok && del.n === 0,
         'after v110: a student cannot insert or upsert a rating (row level security, 42501), and their update and delete touch no row',
         `${told(ins)}; upsert ${ups.code}; update ${upd.n}, delete ${del.n}`)
    const read = await asStudent(d, 1, ownRead)
    note(read.ok && sameJson(read.rows, studentOneRows), 'after v110: a student still reads their own ratings, and no one else\'s', asJson(read.rows))
    const team = await asRole(d, 'authenticated', `select count(*)::int as n from student_lesson_ratings`, { uid: TEAM_ID })
    note(team.ok && team.rows[0]?.n === 3, 'after v110: the team still reads every rating', told(team))
    const svc = await asRole(d, 'service_role', [
        `insert into student_lesson_ratings (student_id, lesson_id, stars, comment) values ('${UID(1)}', 'l002', 5, 'Saved by the route.')
           on conflict (student_id, lesson_id) do update set stars = excluded.stars, comment = excluded.comment`,
        `insert into student_lesson_ratings (student_id, lesson_id, stars) values ('${UID(1)}', 'l001', 3)
           on conflict (student_id, lesson_id) do update set stars = excluded.stars`],
      { check: `select lesson_id, stars, comment, updated_at > created_at as edited from student_lesson_ratings where student_id = '${UID(1)}' order by 1` })
    note(svc.ok && sameJson(svc.checked, [{ lesson_id: 'l001', stars: 3, comment: 'Fine.', edited: true }, { lesson_id: 'l002', stars: 5, comment: 'Saved by the route.', edited: false }]),
         "after v110: the service role (the route) still adds and changes ratings with the route's upsert, and v75's trigger moves updated_at on a change",
         svc.ok ? asJson(svc.checked) : told(svc))
    note(await stateOf(d) === stateAfterV110, '...and every one of those statements was rolled back: no row changed')
  }

  // ── run again ──
  {
    const was = await stateOf(d)
    const rr = await runFile(d, v110)
    note(rr.ok && rr.rows[0]?.v110 === AGAIN && rr.rows.length === 3 && await stateOf(d) === was,
         'v110 run again: "already in place", and every policy, grant and row unchanged', told(rr))
  }

  // ── the undo ──
  {
    const c = await d.clone()
    const rr = await runFile(c, probeAt(undo110, 'drop policy if exists "students_insert_own_ratings"', 'u110_timeout', `current_setting('lock_timeout')`))
    const timeout = await probed(c, 'u110_timeout')
    await c.close()
    note(rr.ok && timeout.v === '5s' && timeout.after === '0', 'the undo runs with lock_timeout 5s, and the setting ends with its commit', `${timeout.v}, after ${timeout.after}`)
  }
  r = await runFile(d, undo110)
  note(r.ok && sameJson(r.rows.map(x => [x.policy, x.command]), [['students_insert_own_ratings', 'INSERT'], ['students_select_own_ratings', 'SELECT'],
                                                                ['students_update_own_ratings', 'UPDATE'], ['team_select_all_ratings', 'SELECT']]),
       'the undo runs and lists the four policies, as before v110', told(r))
  note(await ratingPolicies(d) === policiesBefore && await stateOf(d) === stateBefore,
       'after the undo every policy on the table is back exactly as v75 made it (command, roles, using, check), and nothing else differs from before v110')
  {
    const back = await asStudent(d, 1, `insert into student_lesson_ratings (student_id, lesson_id, stars) values ('${UID(1)}', 'l064', 5)`)
    note(back.ok && back.n === 1, 'after the undo a student can write their own rating again: it reopens the door, as its header says', told(back))
    const was = await stateOf(d)
    const again = await runFile(d, undo110)
    note(again.ok && await stateOf(d) === was, 'a second undo changes nothing', told(again))
    r = await runFile(d, v110)
    note(r.ok && r.rows[0]?.v110 === FIRST && await ratingPolicies(d) === policiesAfter,
         'v110 applies again after its undo, with the same policies as its first run', told(r))
  }
  await d.close()
}

console.log(`\n${'='.repeat(60)}\n  PASS ${ok.length}   FAIL ${fail.length}`)
if (fail.length) { console.log('\nFAILURES:'); fail.forEach(f => console.log('  - ' + f)); process.exit(1) }
