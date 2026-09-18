/**
 * POST /api/admin/backfill-achievements
 *
 * One-time (re-runnable) re-evaluation of achievements for every student
 * who has actually used the app.
 *
 * Background: until v90, achievements were only evaluated on four write
 * paths — toggle-lesson, mark-action-shipped, submit-quiz and the manual
 * refresh. They were NOT evaluated after the login watch-sync, which is the
 * only path that records progress for a student who never toggles anything
 * themselves. Measured 2026-09-18: 182 students in the launch cohort held a
 * real lesson completion with no First Steps badge — a quarter of everyone
 * who had completed anything. v90 closes the leak going forward; this route
 * pays off the historical debt.
 *
 * Strategy: call evaluateAchievements() per student. That is the SAME
 * function the live write paths use, deliberately — replicating the rules in
 * SQL would create a second definition free to drift from the first, which
 * is the exact failure class this whole pass was cleaning up.
 *
 * Idempotent. evaluateAchievements only inserts achievements the student
 * does not already hold, and nothing is ever revoked. Safe to re-run; each
 * run picks up wherever the last one stopped.
 *
 * Bounded: stops at DEADLINE_MS and reports how many students remain, rather
 * than being killed mid-write at maxDuration. Re-run until `remaining` is 0.
 *
 * Founder + admin, or CRON_SECRET for a terminal trigger.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { evaluateAchievements } from "@/lib/achievements";
import { LAUNCH_DATE } from "@/lib/constants";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";

export const maxDuration = 300;

/** Leaves headroom under maxDuration=300 so the run reports instead of dying. */
const DEADLINE_MS = 240_000;

export async function POST(request: NextRequest) {
  const authHeader = (request.headers.get("authorization") ?? "").trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  let supabase;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    supabase = createServiceClient();
  } else {
    const auth = await requireTeam(request, ["founder", "admin"]);
    if (isAuthFailure(auth)) return auth.error;
    supabase = auth.supabase;
  }

  const startedAt = Date.now();

  // The candidate set is the same population the achievement_unlock_stats
  // view counts (v90): joined since launch, not csm_exempt, and has actually
  // used the app. Evaluating someone who never opened the app would award
  // nothing anyway — we have no lesson rows for them — so this just avoids
  // the wasted round-trips.
  // Deliberately TWO paginated reads rather than one embedded join. Joining
  // student_lesson_completions returns a row PER COMPLETION, not per student,
  // so a few hundred students would blow past PostgREST's ~1000-row cap and
  // hand back a silently truncated candidate list — which would look exactly
  // like a successful partial backfill. student_progress_counts is one row
  // per student, so it stays small.
  //
  // Both reads are paginated AND ordered. An unordered .range() pager has no
  // stable row order between pages and can drop or duplicate rows at the
  // boundaries.
  const cohort = await fetchAllRowsPaginated<{ id: string }>(() =>
    supabase
      .from("students")
      .select("id")
      .eq("csm_exempt", false)
      .gte("first_paid_at", LAUNCH_DATE)
      .order("id", { ascending: true }),
  );
  const progress = await fetchAllRowsPaginated<{
    student_id: string;
    completed_count: number;
  }>(() =>
    supabase
      .from("student_progress_counts")
      .select("student_id, completed_count")
      .order("student_id", { ascending: true }),
  );

  const hasProgress = new Set(
    (progress.data ?? [])
      .filter((r) => (r.completed_count ?? 0) > 0)
      .map((r) => r.student_id),
  );
  const ids = (cohort.data ?? [])
    .map((s) => s.id)
    .filter((id) => hasProgress.has(id));

  let evaluated = 0;
  let awarded = 0;
  let failed = 0;
  const awardedBy: Record<string, number> = {};

  for (const id of ids) {
    if (Date.now() - startedAt > DEADLINE_MS) break;
    try {
      const newIds = await evaluateAchievements(supabase, id);
      evaluated += 1;
      awarded += newIds.length;
      for (const a of newIds) awardedBy[a] = (awardedBy[a] ?? 0) + 1;
    } catch (err) {
      failed += 1;
      console.error(`[backfill-achievements] student=${id} failed:`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: ids.length,
    evaluated,
    remaining: ids.length - evaluated,
    awarded,
    awarded_by_achievement: awardedBy,
    failed,
    duration_ms: Date.now() - startedAt,
    note:
      ids.length - evaluated > 0
        ? "Hit the time budget. Re-run until remaining is 0 — it is idempotent."
        : "Complete.",
  });
}
