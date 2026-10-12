-- ============================================================
-- v100 — lesson videos move to Tella: a private table for the video ids,
--        and a heartbeat that counts watching at up to 2.5x
--
-- Part of the tella-player PRD (_admin/prds/tella-player/tella_player_prd.md,
-- section 9). Karlo decided on 2026-10-12 that lesson videos are Tella embeds.
--
-- WHAT THIS FILE DOES
--   1. Creates public.lesson_videos: one row per lesson that has a video,
--      holding the Tella video id and what the last lock check found.
--   2. Replaces record_lesson_heartbeat. The text is v97's with four changes:
--      (a) a lesson is playable when it has a lesson_videos row
--          (v97 asked for lessons.bunny_video_id);
--      (b) the cap on one beat goes from 20 to 60 seconds, and a new constant
--          v_speed_cap = 2.5 is added;
--      (c) a beat after the first is credited
--          least(delta, elapsed * 2.5, 60). v97 credited
--          least(delta, elapsed, 20);
--      (d) the first beat for a student and lesson keeps v97's cap of 20
--          seconds, in a new constant v_first_delta, so it does not inherit
--          the 60 of (b).
--      The signature, the keys it returns and its grants are unchanged.
--
-- WHY THE ID GETS ITS OWN TABLE
--   A Tella video id is the embed address. A Bunny id was useless without
--   the signing key. A Tella id has only Tella's own domain lock in front of
--   it, and that lock is a Referer check. Every account that is logged in can
--   read every column of lessons and lessons_next (policy "Authenticated can
--   read lessons": using (auth.uid() is not null)), so an id stored there
--   reaches every account, lapsed members included. lesson_videos has RLS on
--   and no policy at all, and anon and authenticated hold no privilege on it.
--   The service role reads it for the app's server routes, and the function
--   below reads it because it is security definer.
--
--   ⚠ NEVER COMMIT A REAL VIDEO ID. The GitHub repository is public. Rows go
--   into this table by hand in the SQL editor.
--
-- WHY THE SPEED CAP
--   The player adds up VIDEO seconds. v97 credited at most one second per
--   CLOCK second. At 2x the client sends twice what v97 will credit, so the
--   80% played rule could not be met above 1.25x. Measured on Tella's player
--   on 2026-10-12: at 2.0x the video moved 12.0 s in 6.0 clock seconds.
--   Tella's speed menu tops out at 2.5x, so the cap is 2.5.
--   The cap on one beat had to rise with it. Beats are 15 s apart, which is
--   37.5 s of video at 2.5x, and the old cap of 20 would have cut every one
--   of them. 60 lets through a beat that arrives up to 24 clock seconds after
--   the one before it at top speed. The first beat is left at 20 (see
--   RESIDUALS).
--
-- OPERATIONAL CONSEQUENCES, stated plainly
--   1. From the moment this runs the heartbeat stops reading bunny_video_id.
--      A build that still plays Bunny (the preview deployed before the Tella
--      build) can no longer record a watch: every beat is refused with 22023.
--      /dashboard and main never call this function.
--   2. A lesson becomes watchable by INSERTING its lesson_videos row. v97's
--      rule still holds on top of that: a lesson with a video row and no
--      lessons.duration_seconds cannot be completed by anyone. Nothing fills
--      duration_seconds for a Tella video automatically. Set it by hand with
--      the row.
--   3. The Bunny columns (bunny_video_id, video_ready_at) stay where they are,
--      unread. They are dropped with the cutover's cleanup.
--   4. lesson_videos.lesson_id has no foreign key, on purpose. The heartbeat
--      still looks the lesson up in public.lessons, so a row for a staging
--      lesson (lessons_next) makes nothing playable before cutover.
--
-- RESIDUALS, measured in the harness (supabase/migration-tests/run.mjs,
-- section 18)
--   * The first beat for a (student, lesson) pair has no previous timestamp to
--     clamp against, so one forged first call still banks 20 s, exactly as
--     under v97. It is once per lesson, and a client cannot delete the row to
--     earn it again. 20 s is 2.7% of the 753 s lesson the harness uses and
--     29.9% of a 67 s one, under the 80% floor in both.
--     Why the first beat has its own constant (v_first_delta): the cap for
--     later beats had to rise to 60, and in v97 the first beat read the same
--     constant. At 60, ONE forged call with position = duration passed both
--     the 95% rule and the 80% rule on any lesson of 75 s or less, and the
--     PRD's two test videos are 67 s. An honest player sends about zero on
--     its first beat (it writes the row the moment playback starts), so 20
--     shorts an honest student only when that first write is more than 8 s
--     late at 2.5x (20 s late at 1x), and then once.
--   * After the first beat, watched_seconds can grow at 2.5 times the clock
--     and no faster. A client that sends a delta on every beat while playing
--     nothing is credited the same as an honest student at top speed, so
--     forging 80% of a lesson costs 32% of its length in waiting, less the
--     20 s above. That is by design: it is the price of counting 2.5x at all.
--
-- UNDO: supabase/undo/2026_v100_undo.sql. It is never run in sequence with the
-- migrations. It puts v97's function back and DROPS lesson_videos with every
-- id in it.
--
-- Idempotent. Wrapped in a transaction.
-- ============================================================

begin;

-- ─────────────── 1. Which Tella video belongs to which lesson ───────────────
--
-- One row per lesson that has a video. No row means "not recorded yet".
-- lock_status is what the last lock check found on Tella's side: unchecked
-- (set on insert), locked, open, missing or error. lock_detail says why in
-- plain sentences and is null when the video is locked and clean.
--
-- No foreign key on lesson_id, on purpose: until cutover the table holds ids
-- from both lessons and lessons_next, the same way student_lesson_watch does.
-- The primary key allows one video per lesson and the unique constraint allows
-- one lesson per video.

create table if not exists public.lesson_videos (
  lesson_id       text primary key,
  tella_video_id  text not null,
  lock_status     text not null default 'unchecked',
  lock_detail     text,
  lock_checked_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint lesson_videos_tella_id_format check (tella_video_id ~ '^vid_[a-z0-9]{10,64}$'),
  constraint lesson_videos_tella_id_unique unique (tella_video_id),
  constraint lesson_videos_lock_status_check check (lock_status in ('unchecked','locked','open','missing','error'))
);

comment on table public.lesson_videos is
  'Which Tella video plays for which lesson, and what the last lock check '
  'found. PRIVATE: a Tella id is the embed address. RLS is on with no policy '
  'and anon/authenticated hold no privilege. Read by the service role and by '
  'record_lesson_heartbeat() only. Never add a policy, and never send '
  'tella_video_id to a browser except through the member-only route, one '
  'lesson at a time.';

-- RLS on and NO policy. With no policy a browser query finds no rows, for any
-- account. The REVOKE takes away the table privileges Supabase hands anon and
-- authenticated on every new table in public, so the same query is refused
-- outright.
alter table public.lesson_videos enable row level security;
revoke all on table public.lesson_videos from anon, authenticated;

drop trigger if exists trg_lesson_videos_updated_at on public.lesson_videos;
create trigger trg_lesson_videos_updated_at before update on public.lesson_videos
  for each row execute function public.set_updated_at();

-- ─────────────── 2. The heartbeat: v97's text, four changes ───────────────

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
  -- v100: the most video one beat AFTER THE FIRST may bank. It was 20 through
  -- v97. At 2.5x a 15 s beat carries 37.5 s of video, so 20 would cut every
  -- beat of a fast viewer.
  v_max_delta  constant numeric := 60;
  -- v100: video seconds credited per clock second, at most. 2.5 is the top of
  -- Tella's speed menu. The client holds the same number as WATCH_SPEED_CAP
  -- (src/lib/world/tella.ts). Changing one without the other is a bug.
  v_speed_cap  constant numeric := 2.5;
  -- v100: the most the FIRST beat for a student and lesson may bank. This is
  -- v97's 20, kept in a constant of its own. A first beat has no earlier
  -- timestamp, so the clock cannot clamp it, and at v_max_delta's 60 one
  -- forged call passed both rules on any lesson of 75 s or less.
  v_first_delta constant numeric := 20;
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
  --    v100: playable means the lesson has a row in lesson_videos. Through v97
  --    this line read lessons.bunny_video_id. The lesson itself is still
  --    looked up in public.lessons, so a lesson_videos row for a staging
  --    lesson (lessons_next) plays nothing before cutover.
  select l.duration_seconds into v_lesson_dur
    from public.lessons l
   where l.id = p_lesson_id
     and l.type = 'watch'
     and exists (select 1 from public.lesson_videos v where v.lesson_id = l.id);

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

  -- 5. Clamp the played-seconds delta to wall-clock reality: at most
  --    v_speed_cap seconds of video for each second of clock.
  if v_had_row then
    v_elapsed := extract(epoch from (now() - v_existing.last_heartbeat_at));
    -- v97: NO grace term. The old `v_elapsed + 2` was meant to tolerate clock
    -- skew, but p_force bypasses the 5s limiter, so a replay loop saw
    -- v_elapsed ~= 0 and banked the full 2s on EVERY call — inflating
    -- watched_seconds far past real time at whatever rate the attacker could
    -- POST.
    -- v100: the clamp is v_elapsed * v_speed_cap. The client counts VIDEO
    -- seconds, and at 2x a video second takes half a clock second, so v97's
    -- clamp to v_elapsed alone credited a 2x viewer half of what they played.
    -- There is still no added term: a replay sees v_elapsed ~= 0, and 2.5
    -- times ~0 is ~0. A viewer at the full 2.5x can lose a fraction of a
    -- second on a beat that arrives early, which is nothing against an 80%
    -- floor.
    v_delta   := greatest(0, least(coalesce(p_delta_seconds, 0), v_elapsed * v_speed_cap, v_max_delta));
    v_new_max := greatest(v_existing.max_position_seconds, v_position);
  else
    v_elapsed := null;
    -- v100: a first beat has no earlier timestamp, so the clock cannot clamp
    -- it. It is capped by v_first_delta, which is v97's 20 s, once per
    -- lesson. See RESIDUALS in the header.
    v_delta   := greatest(0, least(coalesce(p_delta_seconds, 0), v_first_delta));
    v_new_max := v_position;
  end if;

  -- v97: the 95% decision uses v_lesson_dur — the CATALOG's duration — and
  -- never v_duration, which coalesces in p_reported_duration from the client.
  --
  -- The hole that closes: lessons.duration_seconds is NULL for a lesson until
  -- someone sets it. In that window the client's own number was the
  -- denominator, so one call with p_reported_duration = 1 and
  -- p_position_seconds = 1 stamped threshold_met_at instantly.
  --
  -- Consequence, stated plainly: a lesson with a video but no duration_seconds
  -- CANNOT be completed. That is the correct failure — blocking a completion
  -- is recoverable, forging one is not — but it makes duration_seconds an
  -- operational requirement, not a nicety. p_reported_duration is still stored
  -- for display and still clamps the position; it just cannot decide anything.
  -- v100: nothing fills duration_seconds for a Tella video automatically. It
  -- is set by hand when the lesson's lesson_videos row goes in.
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
    -- True on exactly ONE call per lesson: the beat that crossed 95%.
    -- v100: a client should claim the completion on threshold_met, on later
    -- beats too. A claim hung on this edge alone is made once, and if that one
    -- is refused nothing asks again.
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
-- 1. One query. The table is private and the function is the new one.
--
--    select
--      (select c.relrowsecurity from pg_class c
--        where c.oid = 'public.lesson_videos'::regclass)                    as rls_on,
--      (select count(*) = 0 from pg_policies p
--        where p.schemaname = 'public' and p.tablename = 'lesson_videos')   as no_policy,
--      not has_table_privilege('anon', 'public.lesson_videos',
--        'select, insert, update, delete, truncate, references, trigger')   as anon_has_nothing,
--      not has_table_privilege('authenticated', 'public.lesson_videos',
--        'select, insert, update, delete, truncate, references, trigger')   as student_has_nothing,
--      has_table_privilege('service_role', 'public.lesson_videos', 'select')
--        and has_table_privilege('service_role', 'public.lesson_videos', 'insert')
--        and has_table_privilege('service_role', 'public.lesson_videos', 'update')
--        and has_table_privilege('service_role', 'public.lesson_videos', 'delete')
--                                                                           as service_reads_and_writes,
--      pg_get_functiondef('public.record_lesson_heartbeat'::regproc)
--        like '%from public.lesson_videos v where v.lesson_id = l.id%'      as reads_lesson_videos,
--      pg_get_functiondef('public.record_lesson_heartbeat'::regproc)
--        like '%v_elapsed * v_speed_cap, v_max_delta%'                      as has_speed_cap,
--      pg_get_functiondef('public.record_lesson_heartbeat'::regproc)
--        like '%coalesce(p_delta_seconds, 0), v_first_delta))%'             as first_beat_has_own_cap,
--      not has_function_privilege('anon',
--        'public.record_lesson_heartbeat(text,numeric,numeric,numeric,boolean)',
--        'execute')                                                         as anon_cannot_call,
--      has_function_privilege('authenticated',
--        'public.record_lesson_heartbeat(text,numeric,numeric,numeric,boolean)',
--        'execute')                                                         as student_can_call;
--    EXPECT: every column true.
--
--  If service_reads_and_writes is false, this project no longer grants new
--  tables to the service role by default and the server routes cannot see the
--  table. Fix:
--  grant select, insert, update, delete on table public.lesson_videos to service_role;
--
-- 2. The table starts empty and the telemetry is untouched.
--
--    select (select count(*) from public.lesson_videos)        as lesson_videos,
--           (select count(*) from public.student_lesson_watch) as watch_rows;
--    EXPECT: 0 on the first run, and the same watch_rows as before the run.
-- ============================================================
