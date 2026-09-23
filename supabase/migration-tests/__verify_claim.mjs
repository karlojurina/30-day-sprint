import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const M = fileURLToPath(new URL('../migrations/', import.meta.url))
const read = f => fs.readFileSync(M + f, 'utf8')
const db = new PGlite()

await db.exec(fs.readFileSync(new URL('base.sql', import.meta.url), 'utf8'))
await db.exec(`
insert into regions (id, order_num, name, terrain) values ('r1',1,'Foundation','shore');
insert into lessons (id,region_id,day,type,title,requires_action,sort_order)
  values ('a1l01','r1',1,'watch','L1',false,1);
`)
const UID = '00000000-0000-0000-0000-000000000001'
await db.exec(`insert into students (id, supabase_user_id, email, csm_exempt, first_paid_at)
  values ('11111111-1111-1111-1111-111111111111','${UID}','a@b.c',false, now());`)

await db.exec(read('2026_v92_progress_predicate_and_lessons_v2_columns.sql'))
await db.exec(read('2026_v93_lesson_watch_telemetry.sql'))

// THE CLAIMED PRODUCTION STATE: GUID uploaded, duration NOT synced.
await db.exec(`update lessons set bunny_video_id='bv-guid-1' where id='a1l01';`)
const dur = await db.query(`select bunny_video_id, duration_seconds from lessons where id='a1l01'`)
console.log('lesson row:', dur.rows[0])

await db.exec(`select set_config('test.uid','${UID}',false);`)

// THE EXACT CALL FROM THE CLAIM
const r = await db.query(
  `select public.record_lesson_heartbeat($1,$2,$3,$4) as j`,
  ['a1l01', 1, 1, 1])
console.log('RPC returned:', JSON.stringify(r.rows[0].j))

const w = await db.query(`select max_position_seconds::text mx, watched_seconds::text ws,
  reported_duration_seconds::text rd, threshold_met_at is not null met
  from student_lesson_watch`)
console.log('stored row:', w.rows[0])

// variant: 0.01 duration
await db.exec(`delete from student_lesson_watch;`)
const r2 = await db.query(`select public.record_lesson_heartbeat($1,$2,$3,$4) as j`, ['a1l01', 0.01, 0.01, 0.01])
console.log('0.01 variant:', JSON.stringify(r2.rows[0].j))

// variant: honest-ish real duration reported by player, no catalog duration
await db.exec(`delete from student_lesson_watch;`)
const r3 = await db.query(`select public.record_lesson_heartbeat($1,$2,$3,$4) as j`, ['a1l01', 10, 753, 15])
console.log('honest player 753s:', JSON.stringify(r3.rows[0].j))
const w3 = await db.query(`select reported_duration_seconds::text rd from student_lesson_watch`)
console.log('   stored rd:', w3.rows[0].rd)

// can the poisoned duration be RAISED later by an honest beat? (coalesce(excluded, w) -> excluded wins)
await db.exec(`delete from student_lesson_watch;`)
await db.query(`select public.record_lesson_heartbeat($1,$2,$3,$4)`, ['a1l01', 1, 1, 1])
await db.exec(`update student_lesson_watch set last_heartbeat_at = now() - interval '30 seconds';`)
await db.query(`select public.record_lesson_heartbeat($1,$2,$3,$4)`, ['a1l01', 10, 753, 15])
const w4 = await db.query(`select reported_duration_seconds::text rd, threshold_met_at is not null met, max_position_seconds::text mx, watched_seconds::text ws from student_lesson_watch`)
console.log('after honest beat over poisoned row:', w4.rows[0])
