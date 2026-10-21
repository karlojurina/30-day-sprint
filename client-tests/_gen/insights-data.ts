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
import { getCurriculumResetAt, resetDateUtc } from "./curriculum-reset.ts";
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
  /** admin_config.curriculum_reset_at: the course switch, null before it. Avg progress's line starts there. */
  loadResetAt(): Promise<Answer<string | null>>;
}

/** The course switch, as getCurriculumResetAt reads it, or why it could not be read. */
export async function loadResetAt(supabase: SupabaseClient): Promise<Answer<string | null>> {
  try {
    return { ok: true, status: 200, data: await getCurriculumResetAt(supabase) };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
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

/* ─── The charts (admin rebuild 2, the review's fix round) ─────────────────
 * Insights draws its lines and bars with the Dashboard's chart
 * (src/components/admin/dashboard/TrendChart.tsx): the same marks, the same
 * day labels, a day with no snapshot a gap. These helpers hand it its days,
 * its points, its value range and its labelled gridlines.
 */

/** One day of a chart. `value` is null on a day with no snapshot: a gap, never 0. */
export interface ChartPoint {
  date: string;
  value: number | null;
}

const DAY_MS = 86_400_000;

/** Every UTC date from `from` to `to` (YYYY-MM-DD, both included), oldest first. Empty when `to` is before `from`. */
export function snapshotDays(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const out: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export type InsightsMetric = "avg_progress" | "active_count" | "churned_count";

/** The launch cohort's column, or the old one for a row from before v77. */
function metricValue(r: SnapshotRow, key: InsightsMetric): number | null {
  const cohort = key === "avg_progress" ? r.avg_progress_cohort : key === "active_count" ? r.active_count_cohort : r.churned_count_cohort;
  const legacy = r[key];
  const v = cohort ?? legacy;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * A metric's line over the range: from the first snapshot in it to `to`, a
 * day with no row a gap. Avg progress starts on the switch's date at the
 * earliest (`resetAt`, the date the snapshot writers use): the old course's
 * rows (36%) never sit beside the new course's (near 3%), so the line has no
 * cliff and its change never crosses the switch. Throws when `resetAt` is not
 * a date (resetDateUtc does), as the Dashboard's Avg progress does.
 */
export function metricLine(
  rows: SnapshotRow[],
  key: InsightsMetric,
  to: string,
  resetAt: string | null,
): ChartPoint[] {
  const floor = key === "avg_progress" ? resetDateUtc(resetAt) : null;
  const shown = rows.filter((r) => !floor || r.snapshot_date.slice(0, 10) >= floor);
  if (shown.length === 0) return [];
  const byDate = new Map(shown.map((r) => [r.snapshot_date.slice(0, 10), r] as const));
  const first = [...byDate.keys()].sort()[0];
  return snapshotDays(first, to).map((date) => {
    const r = byDate.get(date);
    return { date, value: r ? metricValue(r, key) : null };
  });
}

/** Claims per UTC day over `days`, 0 on a day with none (a count, so 0 is a reading here). */
export function claimsLine(claimedAts: string[], days: string[]): ChartPoint[] {
  const counts = new Map<string, number>();
  for (const ts of claimedAts) counts.set(ts.slice(0, 10), (counts.get(ts.slice(0, 10)) ?? 0) + 1);
  return days.map((date) => ({ date, value: counts.get(date) ?? 0 }));
}

/**
 * The value range a chart draws and its three labelled gridlines, each
 * labelled with its own value: a label is never rounded away from its line.
 *
 *   bars   0 to the top, for a count per day.
 *   line   the readings' own spread, never narrower than 10% of their size
 *          (and at least 1): the Dashboard's rule (TrendChart's range), so a
 *          flat 269 is a flat line in the middle, not a block filling the chart.
 *
 * The ends then go out to a whole step: a whole number for a count, a tenth
 * for a share; and the top one more step when that leaves the middle off the
 * grid, so all three lines are on it. A count with a top of 1 gets 0, 1 and
 * 2; a top of 3 gets 0, 2 and 4; Avg progress at 36.4 gets 0, 18.2 and 36.4.
 */
export function axisTicks(
  values: number[],
  kind: "line" | "bars",
  integer: boolean,
): { domain: [number, number]; ticks: [number, number, number] } {
  const read = values.filter((v) => Number.isFinite(v));
  let lo: number;
  let hi: number;
  if (kind === "bars" || read.length === 0) {
    lo = 0;
    hi = Math.max(1, ...read.map((v) => Math.max(0, v)));
  } else {
    const min = Math.min(...read);
    const max = Math.max(...read);
    const span = Math.max(max - min, 1, 0.1 * Math.max(Math.abs(min), Math.abs(max)));
    const mid = (min + max) / 2;
    lo = mid - span / 2;
    hi = mid + span / 2;
    if (min >= 0 && lo < 0) {
      hi -= lo;
      lo = 0;
    }
  }
  // In whole steps: 1 for a count, 0.1 for a share. Counted in steps, so no float tail creeps in.
  const per = integer ? 1 : 10;
  const a = Math.floor(lo * per + 1e-9);
  let b = Math.ceil(hi * per - 1e-9);
  if (b <= a) b = a + 2;
  if ((b - a) % 2 === 1) b += 1;
  const at = (steps: number) => Math.round(steps) / per;
  return { domain: [at(a), at(b)], ticks: [at(a), at((a + b) / 2), at(b)] };
}
