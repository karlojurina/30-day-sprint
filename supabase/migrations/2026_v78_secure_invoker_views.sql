-- ============================================================
-- v78: Lock down two over-permissive views (security_invoker = on).
--
-- Problem flagged by Supabase Advisor as CRITICAL:
--   `student_progress_counts`, `student_current_region`, and
--   `achievement_unlock_stats` were created in v48 / v49 / v53
--   without the `security_invoker` clause. In Postgres that
--   defaults to OFF — the view runs as its OWNER (postgres in
--   Supabase), which silently BYPASSES Row-Level Security on the
--   underlying tables. Combined with `grant select to authenticated`,
--   that means any logged-in student could SELECT from these views
--   and see every OTHER student's progress / region data.
--
-- Verified before flipping:
--   * student_lesson_completions RLS policy (v3) grants team full
--     read + grants students read on their own rows only. Once the
--     view is security_invoker, admin queries (createClient browser
--     client) keep working via the team policy; student queries
--     see only their own group. SAFE.
--   * lessons RLS policy allows any authenticated user to read, so
--     the view's JOIN on lessons still works for both audiences.
--   * Server-side callers (day28-embed cron, etc) use the service
--     client which bypasses RLS regardless. Unaffected.
--
-- INTENTIONALLY NOT FLIPPED: `achievement_unlock_stats`.
--   That view aggregates `count(distinct student_id)` across ALL
--   `student_achievements` rows to compute the global "X% of
--   students unlocked Y" number shown to students in the
--   AchievementsButton modal. With security_invoker=on the
--   student would only see their own student_achievements row and
--   the aggregate would collapse to 0%/100% — broken UI.
--
--   The data this view exposes IS intended to be public (it's
--   shown to all students). The advisor's "critical" flag is a
--   false positive for this specific view; we keep the bypass
--   behavior and document the reason.
--
-- All three views also get their `anon` grant revoked. None of
-- them are meant for anonymous (unauthenticated) access — keep
-- the surface as small as possible.
--
-- Idempotent. Safe to re-run.
-- ============================================================


-- ─────────────── 1. student_progress_counts ───────────────

alter view public.student_progress_counts set (security_invoker = on);
revoke select on public.student_progress_counts from anon;

comment on view public.student_progress_counts is
  'Per-student completion count. v78: runs as security_invoker so '
  'RLS on student_lesson_completions applies — students see only '
  'their own row, team sees all (via current_user_is_team() policy).';


-- ─────────────── 2. student_current_region ───────────────

alter view public.student_current_region set (security_invoker = on);
revoke select on public.student_current_region from anon;

comment on view public.student_current_region is
  'Per-student highest-region with at least one completion. v78: '
  'runs as security_invoker so RLS on student_lesson_completions '
  'applies — students see only their own row, team sees all.';


-- ─────────────── 3. achievement_unlock_stats — anon revoke only ───────────────
--
-- security_invoker INTENTIONALLY left off; this view aggregates
-- across all students and the data is public-by-design. See the
-- migration header for the full rationale.

revoke select on public.achievement_unlock_stats from anon;

comment on view public.achievement_unlock_stats is
  'Per-achievement unlock counts + global percentage. Intentionally '
  'runs with security_invoker=off so the aggregate spans all '
  'students — the global % is shown to students in the achievements '
  'modal for social proof. Supabase Advisor flags this as a critical '
  'security issue; in this view''s case the warning is a known false '
  'positive (the data is intended to be public).';
