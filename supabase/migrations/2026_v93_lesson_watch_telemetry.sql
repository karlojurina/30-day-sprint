-- ============================================================
-- v93 — watch telemetry: student_lesson_watch + record_lesson_heartbeat
--
-- Part of PRD 1 (the engine). Depends on v92 (lessons.bunny_video_id,
-- lessons.duration_seconds).
--
-- WHY A SEPARATE TABLE, NOT MORE COLUMNS ON student_lesson_completions
--   Completions are a DECISION ("this student is done with this lesson") that
--   eight subsystems read. Watch telemetry is a MEASUREMENT that arrives ~50
--   times per lesson. Widening the completions row would put a high-frequency
--   write path through the table the CSM queue, achievements, streaks, the
--   discount gate and every admin trend line depend on. Separate bounded
--   context; completions stay a decision.
--
-- WHAT WRITES HERE
--   ONLY record_lesson_heartbeat(). There is deliberately NO insert/update/
--   delete RLS policy, so a logged-in student cannot write these rows even
--   with a valid JWT and the anon key — they can only go through the RPC,
--   which re-derives the student from auth.uid() and clamps every input.
--
-- ⚠ THE OTHER HALF OF THE v92 TYPE TRAP
--   This file recreates achievement_unlock_stats, whose counts are BIGINT.
--   v92's student_progress_counts needs `count(*)::int`; this one must have
--   NO cast, and must keep `with (security_invoker = false)`. Casting here,
--   or dropping that clause, aborts the file. See the v78 and v90 headers —
--   the security_invoker=off is deliberate and documented, not an oversight.
--
-- NO FOREIGN KEY ON lesson_id — on purpose, and it is not laziness:
--   the cutover (v98) empties and refills `lessons`. A RESTRICT FK would make
--   telemetry rows BLOCK the catalog swap; a CASCADE FK would delete them
--   silently as a side effect. v98 deletes them explicitly instead, so the
--   cleanup is visible in the migration rather than implied by a constraint.
--   The RPC validates the id against `lessons` on every call, so nothing
--   unvalidated can get in.
--
-- Wrapped in a transaction: a first-run failure leaves nothing behind.
-- Idempotent. Safe to re-run.
-- ============================================================

begin;

-- ─────────────── 1. The telemetry table ───────────────

create table if not exists public.student_lesson_watch (
  student_id uuid not null references public.students(id) on delete cascade,
  lesson_id  text not null,

  -- Furthest point reached. THIS is what the 95% rule reads — it only ever
  -- moves forward (greatest() in the RPC), so a student who scrubs back to
  -- rewatch a section does not lose their position.
  max_position_seconds      numeric(10,2) not null default 0,
  -- Where the playhead was on the last beat. THIS is what "resume where you
  -- left off" reads. Moves both ways.
  last_position_seconds     numeric(10,2) not null default 0,
  -- Seconds ACTUALLY played, accumulated from clamped deltas. Free scrubbing
  -- means max_position alone can be reached by dragging the bar; this is the
  -- honesty floor that says they were really there.
  watched_seconds           numeric(10,2) not null default 0,
  -- What the player reported. lessons.duration_seconds is the trusted value;
  -- this is the fallback before a Bunny sync has filled that in.
  reported_duration_seconds numeric(10,2),

  heartbeat_count           int not null default 0,
  first_played_at           timestamptz not null default now(),
  last_heartbeat_at         timestamptz not null default now(),
  -- Stamped ONCE, the moment 95% is first reached. Never cleared.
  threshold_met_at          timestamptz,

  primary key (student_id, lesson_id)
);

comment on table public.student_lesson_watch is
  'Per-student-per-lesson video watch telemetry, written only by '
  'record_lesson_heartbeat(). A measurement, not a decision — the decision '
  'lives in student_lesson_completions.';

-- Admin "who is actually watching" reads, and the recency signal that
-- replaces the retired Whop last_sync_at column after cutover.
create index if not exists idx_student_lesson_watch_recent
  on public.student_lesson_watch (last_heartbeat_at desc);

alter table public.student_lesson_watch enable row level security;

-- Read-only policies. The absence of a write policy IS the security model.
drop policy if exists "Students read own watch rows" on public.student_lesson_watch;
create policy "Students read own watch rows"
  on public.student_lesson_watch for select
  using (student_id in (select id from public.students where supabase_user_id = auth.uid()));

drop policy if exists "Team reads all watch rows" on public.student_lesson_watch;
create policy "Team reads all watch rows"
  on public.student_lesson_watch for select
  using (public.current_user_is_team());

-- ─────────────── 2. The only writer ───────────────
--
-- Called directly from the browser via supabase.rpc() every ~15s of playback
-- plus forced beats on pause / ended / tab-hidden / unmount (~50 calls per
-- lesson, against ~2,800 raw player events — measured on a real lesson).
--
-- THE CATALOG IT VALIDATES AGAINST IS `lessons`, NOT `lessons_next`, and that
-- is forced by a constraint rather than chosen: student_lesson_completions.
-- lesson_id has `references lessons(id)` (v3:60). A completion can therefore
-- ONLY ever be written for a row that exists in `lessons` — so the end-to-end
-- proof has to run on a real `lessons` row regardless. After cutover
-- `lessons` IS the new catalog, so this needs no re-point, ever.
--
-- EVERY INPUT IS TREATED AS HOSTILE. The client is a browser; a student can
-- open devtools and call this by hand:
--   * student is re-derived from auth.uid(), never passed in
--   * the lesson must be a real, playable watch lesson
--   * position is clamped into [0, duration]
--   * the watched-seconds delta is clamped to the WALL-CLOCK time actually
--     elapsed since the last beat (+2s grace), capped at 20s — so replaying
--     the call in a loop cannot inflate watched_seconds past real time
--   * beats closer than 5s apart are refused
--
-- The refusal has a deliberate exception: a beat that would CROSS the 95%
-- threshold is always accepted. Without it, pausing or closing the tab within
-- 5s of the previous beat could drop the one beat that completes the lesson.
-- p_force (set by the client on pause/ended/pagehide) is the second exception,
-- so the final position is never lost to the rate limiter either.

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
    v_delta   := greatest(0, least(coalesce(p_delta_seconds, 0), v_elapsed + 2, v_max_delta));
    v_new_max := greatest(v_existing.max_position_seconds, v_position);
  else
    v_elapsed := null;
    v_delta   := greatest(0, least(coalesce(p_delta_seconds, 0), v_max_delta));
    v_new_max := v_position;
  end if;

  v_crosses := (not v_had_thresh)
               and v_duration is not null and v_duration > 0
               and v_new_max >= v_threshold * v_duration;

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

comment on function public.record_lesson_heartbeat(text, numeric, numeric, numeric, boolean) is
  'The only writer of student_lesson_watch. Student from auth.uid(); every '
  'input clamped; 5s rate limit bypassed for the threshold-crossing beat. '
  'Returns threshold_crossed exactly once per lesson.';

-- Security definer + the default PUBLIC execute grant is the classic hole.
-- Close it explicitly: anon has no auth.uid() and would raise anyway, but
-- the surface should not exist in the first place.
revoke all on function public.record_lesson_heartbeat(text, numeric, numeric, numeric, boolean) from public;
revoke all on function public.record_lesson_heartbeat(text, numeric, numeric, numeric, boolean) from anon;
grant execute on function public.record_lesson_heartbeat(text, numeric, numeric, numeric, boolean) to authenticated;

-- ─────────────── 3. achievement_unlock_stats survives the reset ───────────────
--
-- THE BUG THIS FIXES, BEFORE IT HAPPENS: v90's eligibility requires a student
-- to have a milestone login stamp OR at least one completion row. The cutover
-- deletes every completion row. Students whose only evidence of using the app
-- was a completion therefore fall OUT of the denominator on cutover day, and
-- every "X% of students unlocked this" number in the achievements modal
-- collapses toward 0 — a believable wrong number, which is this project's
-- documented failure mode.
--
-- Watch rows are NOT deleted by the reset for the students who keep watching,
-- and more importantly a student who watches anything post-cutover re-enters
-- the denominator immediately. v97 additionally backfills first_sprint_login_at
-- from the earliest completion BEFORE the wipe, so history is preserved too.
--
-- ⚠ Reproduced from v90 with ONE added `or exists`. Everything else —
--   the bigint counts with NO cast, `with (security_invoker = false)`, the
--   left join scoped in the JOIN rather than a WHERE — is load-bearing and
--   deliberate. Do not "tidy" any of it.

create or replace view public.achievement_unlock_stats
with (security_invoker = false) as
with eligible as (
  select s.id
  from students s
  where s.csm_exempt = false
    and s.first_paid_at >= '2026-05-25T00:00:00Z'::timestamptz
    and (
      exists (
        select 1 from student_milestones m
        where m.student_id = s.id
          and (m.first_sprint_login_at is not null
               or m.first_dashboard_login_at is not null)
      )
      or exists (
        select 1 from student_lesson_completions c
        where c.student_id = s.id
      )
      -- v93: added so the denominator survives the curriculum reset.
      or exists (
        select 1 from student_lesson_watch w
        where w.student_id = s.id
      )
    )
),
denom as (
  select count(*) as n from eligible
)
select
  a.id,
  -- Types must match v53's output EXACTLY. CREATE OR REPLACE VIEW cannot
  -- change a column's type, so these stay bigint (count()'s natural type);
  -- casting them to int makes the migration fail outright.
  count(distinct sa.student_id)                   as unlocked_count,
  (select n from denom)                           as total_count,
  case
    when (select n from denom) = 0 then 0
    else round(
      100.0 * count(distinct sa.student_id)::numeric
        / (select n from denom)::numeric,
      1
    )
  end                                             as unlock_pct
from achievements a
-- Scoped in the JOIN, not a WHERE: a WHERE would drop achievements that
-- nobody holds, and those still need to render as 0%.
left join student_achievements sa
       on sa.achievement_id = a.id
      and sa.student_id in (select id from eligible)
group by a.id;

-- v78 revoked this from anon; re-assert it so a replace can never widen it.
revoke select on public.achievement_unlock_stats from anon;

commit;

-- ============================================================
-- POST-CHECKS — run after the file, paste the output back.
-- ============================================================
--
-- 1. The table exists with no write policy (this is the security model):
--    select cmd, policyname from pg_policies where tablename = 'student_lesson_watch';
--    EXPECT: exactly 2 rows, both cmd = SELECT.
--
-- 2. Types did NOT move (the trap this file is written around):
--    select column_name, data_type from information_schema.columns
--     where table_name = 'achievement_unlock_stats' order by ordinal_position;
--    EXPECT: unlocked_count bigint, total_count bigint, unlock_pct numeric
--
--    select c.relname, c.reloptions from pg_class c
--     where c.relname in ('achievement_unlock_stats','student_progress_counts');
--    EXPECT: achievement_unlock_stats → {security_invoker=false}
--            student_progress_counts  → {security_invoker=on}
--
-- 3. The denominator did not move today (nothing is wiped yet, so the new
--    `or exists` should add zero students right now):
--    select total_count from achievement_unlock_stats limit 1;
--    EXPECT: the same number as before this file ran.
--
-- 4. The RPC exists and anon cannot call it:
--    select has_function_privilege('anon',
--      'public.record_lesson_heartbeat(text,numeric,numeric,numeric,boolean)', 'execute');
--    EXPECT: false
--    select has_function_privilege('authenticated',
--      'public.record_lesson_heartbeat(text,numeric,numeric,numeric,boolean)', 'execute');
--    EXPECT: true
--
-- 5. It refuses an unknown lesson (should RAISE, not write):
--    select public.record_lesson_heartbeat('nope', 10, 100, 5);
--    EXPECT: ERROR "nope is not a playable watch lesson"
--    (Run as a logged-in student, not the SQL editor's service role — the
--     editor has no auth.uid() and will raise the 42501 branch instead,
--     which is itself a valid pass.)
-- ============================================================
