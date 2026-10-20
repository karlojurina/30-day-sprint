/**
 * The Insights page's reads (/admin/insights/progress; admin rebuild 2,
 * WI-9). They were three hooks inside the page; here they are plain async
 * functions so the page's view renders in the dev page /dev/admin/insights
 * with made-up answers, and client-tests/insights-page.test.mjs runs them
 * on the stand-in database.
 *
 * The queries and their filters are the page's own, so a read that works
 * gives the numbers it gave. Two things changed with the move:
 *   - a read that fails says so (`{ ok: false, error }`): the bounty card
 *     and the current sprinters card showed 0 for a read that failed;
 *   - the long reads page on a unique key (fetchAllRowsByKey: students by
 *     id, the milestones and the progress counts by student_id), where the
 *     milestones were paged on their claim time, which two rows can share.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Answer } from "./types-erased.ts";
import { ADMIN_STUDENT_JOIN_CUTOFF } from "./constants.ts";
import { PAYING_WHOP_PLAN_IDS_ARRAY } from "./metrics-definitions.ts";
import { fetchAllRowsByKey } from "./supabase-pagination.ts";

export interface SnapshotRow {
  snapshot_date: string;
  active_students: number;
  total_completions: number;
  avg_progress: number;
  active_count: number | null;
  joined_count: number | null;
  churned_count: number | null;
  /** The launch cohort's columns (v77 on); older rows have null. */
  avg_progress_cohort: number | null;
  active_count_cohort: number | null;
  joined_count_cohort: number | null;
  churned_count_cohort: number | null;
}

/** Students still within 30 days of their first payment, with an active membership. */
export interface SprinterProgress {
  count: number;
  /** Null when the lessons that count could not be counted. */
  avgProgress: number | null;
  medianProgress: number | null;
}

export interface InsightsTransport {
  /** daily_progress_snapshots from `fromIso` to `toIso` (dates, both included), oldest first. */
  loadSnapshots(fromIso: string, toIso: string): Promise<Answer<SnapshotRow[]>>;
  /** Every Bounty Program claim of the launch cohort's paying students, oldest first. */
  loadBountyClaims(): Promise<Answer<string[]>>;
  /** The current sprinters' progress. */
  loadSprinters(): Promise<Answer<SprinterProgress>>;
}

const SNAPSHOT_COLUMNS =
  "snapshot_date, avg_progress, active_students, total_completions, " +
  "active_count, joined_count, churned_count, " +
  "avg_progress_cohort, active_count_cohort, joined_count_cohort, churned_count_cohort";

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export async function loadSnapshots(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
): Promise<Answer<SnapshotRow[]>> {
  const { data, error } = await supabase
    .from("daily_progress_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .gte("snapshot_date", fromIso)
    .lte("snapshot_date", toIso)
    .order("snapshot_date", { ascending: true });
  if (error) return { ok: false, status: 500, error: error.message };
  const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map(
    (r): SnapshotRow => ({
      snapshot_date: String(r.snapshot_date),
      avg_progress: Number(r.avg_progress),
      active_students: Number(r.active_students),
      total_completions: Number(r.total_completions),
      active_count: num(r.active_count),
      joined_count: num(r.joined_count),
      churned_count: num(r.churned_count),
      avg_progress_cohort: num(r.avg_progress_cohort),
      active_count_cohort: num(r.active_count_cohort),
      joined_count_cohort: num(r.joined_count_cohort),
      churned_count_cohort: num(r.churned_count_cohort),
    }),
  );
  return { ok: true, status: 200, data: rows };
}

export async function loadBountyClaims(supabase: SupabaseClient): Promise<Answer<string[]>> {
  // The launch cohort's paying students, then every claim, intersected (v75.50).
  const [studentsRes, milestonesRes] = await Promise.all([
    fetchAllRowsByKey<{ id: string }>(
      () =>
        supabase
          .from("students")
          .select("id")
          .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[])
          .gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF)
          .order("id"),
      "id",
    ),
    fetchAllRowsByKey<{ student_id: string; bounty_access_claimed_at: string | null }>(
      () =>
        supabase
          .from("student_milestones")
          .select("student_id, bounty_access_claimed_at")
          .not("bounty_access_claimed_at", "is", null)
          .order("student_id"),
      "student_id",
    ),
  ]);
  if (studentsRes.error) return { ok: false, status: 500, error: `the students could not be read: ${studentsRes.error.message}` };
  if (milestonesRes.error) {
    return { ok: false, status: 500, error: `the Bounty Program claims could not be read: ${milestonesRes.error.message}` };
  }
  const cohort = new Set(studentsRes.data.map((s) => s.id));
  const claims = milestonesRes.data
    .filter((m) => cohort.has(m.student_id) && m.bounty_access_claimed_at)
    .map((m) => m.bounty_access_claimed_at as string)
    .sort();
  return { ok: true, status: 200, data: claims };
}

export async function loadSprinters(supabase: SupabaseClient, now: number = Date.now()): Promise<Answer<SprinterProgress>> {
  const thirtyDaysAgo = new Date(now - 30 * 86_400_000).toISOString();
  // v75.32: first_paid_at (real tenure), paying plans, active and past_due;
  // only the lessons that count toward progress divide.
  const [studentsRes, lessonsRes, completionsRes] = await Promise.all([
    fetchAllRowsByKey<{ id: string }>(
      () =>
        supabase
          .from("students")
          .select("id")
          .in("membership_status", ["active", "past_due"])
          .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[])
          .gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF)
          .gte("first_paid_at", thirtyDaysAgo)
          .order("id"),
      "id",
    ),
    supabase.from("lessons").select("id", { count: "exact", head: true }).eq("counts_toward_progress", true),
    fetchAllRowsByKey<{ student_id: string; completed_count: number }>(
      () => supabase.from("student_progress_counts").select("student_id, completed_count").order("student_id"),
      "student_id",
    ),
  ]);
  if (studentsRes.error) return { ok: false, status: 500, error: `the students could not be read: ${studentsRes.error.message}` };
  if (completionsRes.error) {
    return { ok: false, status: 500, error: `the lesson counts could not be read: ${completionsRes.error.message}` };
  }
  const students = studentsRes.data;
  const totalLessons =
    !lessonsRes.error && typeof lessonsRes.count === "number" && lessonsRes.count > 0 ? lessonsRes.count : null;
  if (totalLessons == null) {
    return { ok: true, status: 200, data: { count: students.length, avgProgress: null, medianProgress: null } };
  }
  const done = new Map(completionsRes.data.map((r) => [r.student_id, r.completed_count]));
  const pcts = students.map((s) => Math.max(0, Math.min(100, Math.round(((done.get(s.id) ?? 0) / totalLessons) * 100))));
  const avg = pcts.length > 0 ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
  const sorted = [...pcts].sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
  return { ok: true, status: 200, data: { count: students.length, avgProgress: avg, medianProgress: median } };
}

/** Claims bucketed by date (YYYY-MM-DD), zero-filled from `fromDay` to `toDay` (UTC midnights, ms). */
export function bucketByDay(claimedAts: string[], fromDay: number, toDay: number): Array<{ date: string; count: number }> {
  const counts = new Map<string, number>();
  for (const ts of claimedAts) {
    const day = ts.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const out: Array<{ date: string; count: number }> = [];
  for (let t = fromDay; t <= toDay; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ date: day, count: counts.get(day) ?? 0 });
  }
  return out;
}
