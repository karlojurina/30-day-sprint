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
note(j.accepted === true && (Number(w.w) - wBefore) === 20,
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

console.log(`\n${'='.repeat(60)}\n  PASS ${ok.length}   FAIL ${fail.length}`)
if (fail.length) { console.log('\nFAILURES:'); fail.forEach(f => console.log('  - ' + f)); process.exit(1) }
