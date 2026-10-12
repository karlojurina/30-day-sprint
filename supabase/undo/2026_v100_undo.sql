-- ============================================================
-- UNDO for v100 (supabase/migrations/2026_v100_lesson_videos_and_speed.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v100 back.
--
-- ⚠ IT REFUSES WHILE lesson_videos HOLDS A ROW. Those rows are the only
--   record of which Tella video belongs to which lesson: they are in no
--   other table, and never in the repository, which is public. With even one
--   row in the table the file stops, says how many there are, and changes
--   nothing. To go on:
--     1. save them:    select lesson_id, tella_video_id
--                        from public.lesson_videos order by lesson_id;
--        (keep the result somewhere private; never commit it)
--     2. delete them:  delete from public.lesson_videos;
--     3. run this file again.
--
-- WHAT IT DOES, once the table is empty
--   1. Puts record_lesson_heartbeat back to v97's text. The function below was
--      copied by a script out of
--      supabase/migrations/2026_v97_heartbeat_trust_nothing.sql, from its
--      `create or replace function` line through its three revoke/grant
--      lines. Nothing in it was typed again. The harness
--      (supabase/migration-tests/run.mjs, section 18) checks that this copy
--      matches the v97 file, and that the database ends up with exactly the
--      function it had straight after v97.
--   2. Drops public.lesson_videos, with its trigger and its constraints.
--
-- WHAT YOU LOSE
--   * Watching faster than 1x stops counting in full. v97 credits at most one
--     second of video per second of clock and at most 20 s a beat, so the 80%
--     played rule cannot be met above 1.25x.
--   * v97 has no lock: calls fired at the same instant are each credited in
--     full again, 20 s a call.
--   * The heartbeat goes back to asking for lessons.bunny_video_id. A lesson
--     that only has a Tella video is refused with 22023 on every beat, so it
--     cannot be completed by watching. The Tella build's server routes read
--     lesson_videos, which is gone. Run this only together with putting the
--     app back on the build from before Tella.
--
-- WHAT IT LEAVES ALONE
--   student_lesson_watch and student_lesson_completions. Every watch row and
--   every completion written while v100 was live stays as it is.
--
-- Safe to run again: a second run finds no table, skips the check, and ends
-- in the same state. v100 can be run again after it.
-- ============================================================

-- ─────────────── 0. Refuse while the table holds a row ───────────────
--
-- On its own, ahead of the transaction: when it stops the file, nothing has
-- been started and nothing is left open. The message gives the count and
-- never a video id.
do $guard$
declare
  v_rows bigint;
begin
  if to_regclass('public.lesson_videos') is not null then
    execute 'select count(*) from public.lesson_videos' into v_rows;
    if v_rows > 0 then
      raise exception 'public.lesson_videos holds % row(s), and this file will not drop them: they are the only record of which video belongs to which lesson. Save them first (select lesson_id, tella_video_id from public.lesson_videos order by lesson_id). Then delete them (delete from public.lesson_videos) and run this file again. Nothing was changed.', v_rows;
    end if;
  end if;
end
$guard$;

begin;

-- ─────────────── 1. v97's record_lesson_heartbeat, copied by script ───────────────

create or replace function public.record_lesson_heartbeat(
  p_lesson_id         text,
  p_position_seconds  numeric,
  p_reported_duration numeric default null,
  p_delta_seconds     numeric default 0,
  p_force             boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The 0.95 lives HERE and nowhere else. The API route re-reads this table
  -- rather than re-deciding the threshold.
  v_threshold  constant numeric := 0.95;
  v_max_delta  constant numeric := 20;
  v_min_gap    constant numeric := 5;

  v_student_id uuid;
  v_lesson_dur numeric;
  v_existing   public.student_lesson_watch%rowtype;
  v_had_row    boolean := false;
  v_had_thresh boolean := false;
  v_duration   numeric;
  v_position   numeric;
  v_elapsed    numeric;
  v_delta      numeric;
  v_new_max    numeric;
  v_crosses    boolean := false;
  v_result     public.student_lesson_watch%rowtype;
begin
  -- 1. Who is this, really.
  select s.id into v_student_id
    from public.students s
   where s.supabase_user_id = auth.uid();

  if v_student_id is null then
    raise exception 'record_lesson_heartbeat: no student for the current user'
      using errcode = '42501';
  end if;

  -- 2. Is this a real, playable watch lesson? (Blocks telemetry spam against
  --    arbitrary ids, and stops a non-watch lesson being completed this way.)
  select l.duration_seconds into v_lesson_dur
    from public.lessons l
   where l.id = p_lesson_id
     and l.type = 'watch'
     and l.bunny_video_id is not null;

  if not found then
    raise exception 'record_lesson_heartbeat: % is not a playable watch lesson', p_lesson_id
      using errcode = '22023';
  end if;

  select * into v_existing
    from public.student_lesson_watch
   where student_id = v_student_id and lesson_id = p_lesson_id;
  v_had_row := found;
  v_had_thresh := v_had_row and v_existing.threshold_met_at is not null;

  -- 3. Duration: the catalog is trusted over the player, but either will do.
  v_duration := coalesce(
    v_lesson_dur,
    nullif(p_reported_duration, 0),
    case when v_had_row then v_existing.reported_duration_seconds end
  );

  -- 4. Clamp the position into the real timeline.
  v_position := greatest(0, coalesce(p_position_seconds, 0));
  if v_duration is not null and v_duration > 0 then
    v_position := least(v_position, v_duration);
  end if;

  -- 5. Clamp the played-seconds delta to wall-clock reality.
  if v_had_row then
    v_elapsed := extract(epoch from (now() - v_existing.last_heartbeat_at));
    -- v97: NO grace term. The old `v_elapsed + 2` was meant to tolerate clock
    -- skew, but p_force bypasses the 5s limiter, so a replay loop saw
    -- v_elapsed ~= 0 and banked the full 2s on EVERY call — inflating
    -- watched_seconds far past real time at whatever rate the attacker could
    -- POST. Clamped to the wall clock alone, a replay gains ~0. Honest
    -- clients lose a fraction of a second per beat, which is nothing against
    -- an 80% floor.
    v_delta   := greatest(0, least(coalesce(p_delta_seconds, 0), v_elapsed, v_max_delta));
    v_new_max := greatest(v_existing.max_position_seconds, v_position);
  else
    v_elapsed := null;
    v_delta   := greatest(0, least(coalesce(p_delta_seconds, 0), v_max_delta));
    v_new_max := v_position;
  end if;

  -- v97: the 95% decision uses v_lesson_dur — the CATALOG's duration — and
  -- never v_duration, which coalesces in p_reported_duration from the client.
  --
  -- The hole that closes: lessons.duration_seconds is NULL for every lesson
  -- until the Bunny sync fills it, which is the normal state for months while
  -- the course is being filmed. In that window the client's own number was the
  -- denominator, so one call with p_reported_duration = 1 and
  -- p_position_seconds = 1 stamped threshold_met_at instantly.
  --
  -- Consequence, stated plainly: a lesson with a video but no duration_seconds
  -- CANNOT be completed. That is the correct failure — blocking a completion
  -- is recoverable, forging one is not — but it makes duration_seconds an
  -- operational requirement, not a nicety. p_reported_duration is still stored
  -- for display and still clamps the position; it just cannot decide anything.
  v_crosses := (not v_had_thresh)
               and v_lesson_dur is not null and v_lesson_dur > 0
               and v_new_max >= v_threshold * v_lesson_dur;

  -- 6. Rate limit — never at the cost of the completing beat.
  if v_had_row and v_elapsed < v_min_gap and not coalesce(p_force, false) and not v_crosses then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'rate_limited',
      'max_position_seconds', v_existing.max_position_seconds,
      'watched_seconds', v_existing.watched_seconds,
      'threshold_met', v_had_thresh,
      'threshold_crossed', false
    );
  end if;

  -- 7. One statement. greatest() on the max means out-of-order beats (a
  --    retried request, a backgrounded tab flushing late) can never rewind it.
  insert into public.student_lesson_watch as w (
    student_id, lesson_id,
    max_position_seconds, last_position_seconds, watched_seconds,
    reported_duration_seconds, heartbeat_count,
    first_played_at, last_heartbeat_at, threshold_met_at
  )
  values (
    v_student_id, p_lesson_id,
    v_position, v_position, v_delta,
    v_duration, 1,
    now(), now(),
    case when v_crosses then now() end
  )
  on conflict (student_id, lesson_id) do update
    set max_position_seconds      = greatest(w.max_position_seconds, excluded.max_position_seconds),
        last_position_seconds     = excluded.last_position_seconds,
        watched_seconds           = w.watched_seconds + v_delta,
        reported_duration_seconds = coalesce(excluded.reported_duration_seconds,
                                             w.reported_duration_seconds),
        heartbeat_count           = w.heartbeat_count + 1,
        last_heartbeat_at         = now(),
        threshold_met_at          = coalesce(w.threshold_met_at,
                                             case when v_crosses then now() end)
  returning * into v_result;

  return jsonb_build_object(
    'accepted', true,
    'max_position_seconds', v_result.max_position_seconds,
    'last_position_seconds', v_result.last_position_seconds,
    'watched_seconds', v_result.watched_seconds,
    'duration_seconds', v_result.reported_duration_seconds,
    'threshold_met', v_result.threshold_met_at is not null,
    -- True on exactly ONE call per lesson: the beat that crossed 95%. The
    -- client uses this edge to fire the completion POST once.
    'threshold_crossed', (v_result.threshold_met_at is not null) and not v_had_thresh
  );
end;
$$;

-- The grants v93 set are preserved by CREATE OR REPLACE; re-asserted so a
-- fresh-database rebuild that ran this file without v93 cannot land the
-- default PUBLIC execute grant.
revoke all on function public.record_lesson_heartbeat(text, numeric, numeric, numeric, boolean) from public;
revoke all on function public.record_lesson_heartbeat(text, numeric, numeric, numeric, boolean) from anon;
grant execute on function public.record_lesson_heartbeat(text, numeric, numeric, numeric, boolean) to authenticated;

-- ─────────────── 2. The table v100 added ───────────────
--
-- After the function, so nothing still points at the table when it goes. Its
-- trigger and its constraints go with it. It is empty: step 0 saw to that.
drop table if exists public.lesson_videos;

commit;

-- ============================================================
-- POST-CHECKS
-- ============================================================
--
-- 1. One query. The table is gone and the function is v97's again.
--
--    select
--      to_regclass('public.lesson_videos') is null                          as table_gone,
--      pg_get_functiondef('public.record_lesson_heartbeat'::regproc)
--        like '%and l.bunny_video_id is not null%'                          as bunny_rule_back,
--      pg_get_functiondef('public.record_lesson_heartbeat'::regproc)
--        like '%v_elapsed, v_max_delta%'                                    as v97_clamp_back,
--      pg_get_functiondef('public.record_lesson_heartbeat'::regproc)
--        not like '%v_speed_cap%'                                           as speed_cap_gone,
--      pg_get_functiondef('public.record_lesson_heartbeat'::regproc)
--        not like '%pg_advisory_xact_lock%'                                 as lock_gone,
--      not has_function_privilege('anon',
--        'public.record_lesson_heartbeat(text,numeric,numeric,numeric,boolean)',
--        'execute')                                                         as anon_cannot_call,
--      has_function_privilege('authenticated',
--        'public.record_lesson_heartbeat(text,numeric,numeric,numeric,boolean)',
--        'execute')                                                         as student_can_call;
--    EXPECT: every column true.
--
--  If the file stopped with "holds N row(s)", nothing was changed, and this
--  query comes back with every one of the first five columns false.
-- ============================================================
