-- ============================================================
-- v97 — SECURITY: the heartbeat RPC stops trusting the client
--
-- Fixes two holes in v93's record_lesson_heartbeat, both found by adversarial
-- review on 2026-09-23. Neither is exploitable yet — the player is not
-- deployed — which is exactly why they are worth fixing now.
--
-- HOLE 1 · a forced-beat replay inflated watched_seconds.
--   v93 clamped the played-seconds delta to `v_elapsed + 2`, a grace term for
--   clock skew. But p_force (which the client sets, and must, so that the beat
--   on pause and tab-close is never lost) bypasses the 5s rate limit. A loop
--   of forced calls therefore saw v_elapsed ~= 0 and banked the full 2 seconds
--   every single call, at whatever rate the attacker could POST. The "cannot
--   inflate past real time" guarantee in v93's header was not true.
--   -> The grace is gone. Clamped to the wall clock alone, a replay gains ~0.
--
-- HOLE 2 · the client supplied its own denominator for the 95% check.
--   v93 computed the threshold against `v_duration`, which coalesces the
--   catalog's duration_seconds with the CLIENT's p_reported_duration. Since
--   duration_seconds is NULL for every lesson until the Bunny sync fills it —
--   the normal state for months while the course is filmed — one call with
--   p_reported_duration = 1 and p_position_seconds = 1 stamped threshold_met_at.
--   Combined with hole 1, two calls produced a completable lesson.
--   -> The decision now uses the catalog's duration ONLY.
--
-- OPERATIONAL CONSEQUENCE, stated plainly rather than buried: a lesson that
-- has a Bunny video but no duration_seconds can no longer be completed by
-- anyone. Blocking a completion is recoverable; forging one is not. PRD 2's
-- Bunny sync route is what fills duration_seconds, and it is now load-bearing
-- rather than a nicety.
--
-- RESIDUAL, measured rather than assumed: the FIRST beat for a
-- (student, lesson) pair has no previous timestamp to clamp against, so it can
-- still bank up to the 20s cap. Every beat after it is clamped to the wall
-- clock, and the row cannot be deleted by a client, so the entire attack is
-- worth ONE 20-second allowance per lesson — 2.7% of the 12-minute test
-- lesson, against an 80% floor. Left as is deliberately: clamping the first
-- beat to zero would cost an honest student whose opening beat is delayed, and
-- 20 seconds cannot approach the floor. (Harness section 14 asserts both the
-- bound and that it does not accumulate.)
--
-- The function is otherwise byte-identical to v93's.
-- Idempotent. Wrapped in a transaction.
-- ============================================================

begin;

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

commit;

-- ============================================================
-- POST-CHECKS
-- ============================================================
--
-- 1. Grants unchanged from v93:
--    select has_function_privilege('anon',
--      'public.record_lesson_heartbeat(text,numeric,numeric,numeric,boolean)','execute') as anon,
--           has_function_privilege('authenticated',
--      'public.record_lesson_heartbeat(text,numeric,numeric,numeric,boolean)','execute') as student;
--    EXPECT: false, true
--
-- 2. Telemetry written so far is untouched (should still be 0 rows until the
--    player ships):
--    select count(*) from student_lesson_watch;
--
-- 3. The grace term is gone:
--    select pg_get_functiondef(oid) like '%v_elapsed, v_max_delta%'
--      from pg_proc where proname = 'record_lesson_heartbeat';
--    EXPECT: true
-- ============================================================
