-- PRD 1 preconditions — run in the Supabase SQL editor, paste the whole file.
-- Returns ONE table. Read the `result` column back to Claude.
--
-- Why this exists: the local .env.local holds placeholder Supabase creds, so no
-- migration can be tested from a laptop. Migration v92 rewrites three shared
-- database objects with CREATE OR REPLACE, and CREATE OR REPLACE VIEW *cannot*
-- change a column's data type — a bigint/int mismatch fails the whole file on
-- first run. These checks are what make v92 a one-shot.

select 'A1 · lessons columns' as item,
       string_agg(column_name, ', ' order by ordinal_position) as result
  from information_schema.columns
 where table_schema = 'public' and table_name = 'lessons'

union all
select 'A2 · v92 target columns already present (want: none)',
       coalesce(string_agg(column_name, ', ' order by column_name), 'none — good')
  from information_schema.columns
 where table_schema = 'public' and table_name = 'lessons'
   and column_name in ('counts_toward_progress','feature_key','bunny_video_id',
                       'duration_seconds','video_ready_at','updated_at')

union all
select 'A3 · regions columns',
       string_agg(column_name, ', ' order by ordinal_position)
  from information_schema.columns
 where table_schema = 'public' and table_name = 'regions'

union all
-- THE ONE THAT CAN BREAK v92: exact column types of the view v92 recreates.
select 'B1 · achievement_unlock_stats column types',
       coalesce(string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position),
                'VIEW MISSING')
  from information_schema.columns
 where table_schema = 'public' and table_name = 'achievement_unlock_stats'

union all
select 'B2 · student_progress_counts column types',
       coalesce(string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position),
                'VIEW MISSING')
  from information_schema.columns
 where table_schema = 'public' and table_name = 'student_progress_counts'

union all
select 'B3 · student_current_region column types',
       coalesce(string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position),
                'VIEW MISSING')
  from information_schema.columns
 where table_schema = 'public' and table_name = 'student_current_region'

union all
select 'C1 · rebuild_daily_snapshots(date,date)',
       coalesce(to_regprocedure('public.rebuild_daily_snapshots(date,date)')::text, 'MISSING')

union all
select 'C2 · rebuild_daily_snapshots(date) — v81 leftover, want absent',
       coalesce(to_regprocedure('public.rebuild_daily_snapshots(date)')::text, 'absent — good')

union all
select 'C3 · set_updated_at() helper (v92 reuses it)',
       coalesce(to_regprocedure('public.set_updated_at()')::text, 'MISSING')

union all
select 'C4 · current_user_is_team() helper (v93 RLS reuses it)',
       coalesce(to_regprocedure('public.current_user_is_team()')::text, 'MISSING')

union all
-- Migration-state proxy: there is no ledger, so infer from what v90/v91 left behind.
select 'D1 · achievements count + rarities (v91 retier proxy)',
       (select count(*)::text from achievements) || ' rows; rarities: ' ||
       coalesce((select string_agg(distinct rarity, ', ' order by rarity) from achievements), 'none')

union all
select 'D2 · achievement_unlock_stats security_invoker (want: false/absent)',
       coalesce((select array_to_string(c.reloptions, ', ')
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'achievement_unlock_stats'),
                'no reloptions — security_invoker off (correct)')

union all
select 'D3 · l057 / l078 present (v92 stamps feature_key on these)',
       coalesce((select string_agg(id, ', ' order by id) from lessons where id in ('l057','l078')),
                'NEITHER FOUND')

union all
select 'D4 · catalog size today',
       (select count(*)::text from lessons) || ' lessons, ' ||
       (select count(*)::text from regions) || ' regions'

union all
select 'D5 · staging tables already exist? (want: neither)',
       coalesce(nullif(concat_ws(', ',
              to_regclass('public.lessons_next')::text,
              to_regclass('public.regions_next')::text), ''),
            'neither — good')

union all
select 'E1 · live progress sanity (must be non-zero)',
       (select count(*)::text from student_lesson_completions) || ' completions, ' ||
       (select count(*)::text from student_progress_counts) || ' rows in progress view'

order by item;
