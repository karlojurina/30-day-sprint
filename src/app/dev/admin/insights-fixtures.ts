/**
 * Made-up data for /dev/admin/insights (admin rebuild 2, WI-9). Development
 * only: the dev layout calls notFound() anywhere else.
 *
 * MADE-UP NUMBERS ONLY. The 90 days of snapshots end today, so every range
 * has rows; the snapshots' Avg progress drops on the day 2 days ago, as the
 * live one dropped at the course switch, and the course switch is that day
 * (loadResetAt), so the page's line starts there.
 *
 *   ?state=full | empty | loading | error   (default full)
 *          partial   the snapshots load, the sprinters', the Bounty
 *                    Program's and the 30% codes' reads fail
 *          noreset   everything loads but the course switch's date
 *
 * The 30% codes applied (the 30% that applies itself, T-137, R5): one to four
 * a day over the last 25 days, none on some days, ending today.
 *   ?course=new | old   activity or pace in the first card (default new)
 */

import type { Answer } from "@/lib/admin/admin-transport";
import type { InsightsTransport, SnapshotRow, SprinterProgress } from "@/lib/admin/insights-data";
import type { PaceCounts } from "@/lib/useJourneyPaceCounts";

export type InsightsFixtureState = "full" | "empty" | "loading" | "error" | "partial" | "noreset";

const STATES: InsightsFixtureState[] = ["full", "empty", "loading", "error", "partial", "noreset"];

export function parseInsightsState(value: string | null): InsightsFixtureState {
  return STATES.find((s) => s === value) ?? "full";
}

const DAY = 86_400_000;

function snapshots(): SnapshotRow[] {
  const today = Math.floor(Date.now() / DAY) * DAY;
  const rows: SnapshotRow[] = [];
  for (let i = 89; i >= 0; i--) {
    const date = new Date(today - i * DAY).toISOString().slice(0, 10);
    const switched = i <= 2;
    const avg = switched ? 2.6 + (2 - i) * 0.05 : 20 + Math.round(((89 - i) / 89) * 160) / 10;
    const active = 180 + Math.round(Math.sin(i / 9) * 12) + (89 - i);
    const churned = i % 6 === 0 ? 3 : i % 4 === 0 ? 1 : 0;
    rows.push({
      snapshot_date: date,
      active_students: active,
      total_completions: 4000 + (89 - i) * 37,
      avg_progress: avg,
      active_count: active,
      joined_count: 2,
      churned_count: churned,
      avg_progress_cohort: avg,
      active_count_cohort: active,
      joined_count_cohort: 2,
      churned_count_cohort: churned,
    });
  }
  return rows;
}

function claims(): string[] {
  const today = Math.floor(Date.now() / DAY) * DAY;
  const out: string[] = [];
  for (let i = 60; i >= 0; i--) {
    const n = i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0;
    for (let k = 0; k < n; k++) out.push(new Date(today - i * DAY + (k + 9) * 3_600_000).toISOString());
  }
  return out;
}

/** The moments 30% codes went on students' memberships: made up, ending today. */
function thirtyApplied(): Array<{ at: string }> {
  const today = Math.floor(Date.now() / DAY) * DAY;
  const out: Array<{ at: string }> = [];
  for (let i = 24; i >= 0; i--) {
    const n = i % 7 === 3 ? 0 : 1 + ((i * 5) % 4);
    for (let k = 0; k < n; k++) out.push({ at: new Date(today - i * DAY + (k + 8) * 3_600_000 + 17 * 60_000).toISOString() });
  }
  return out;
}

export function fixturePace(course: string | null): PaceCounts {
  const old = course === "old";
  return {
    behind: old ? 21 : 0,
    on_pace: old ? 48 : 0,
    ahead: old ? 12 : 0,
    total: old ? 81 : 213,
    loading: false,
    courseIsNew: !old,
    activity: old
      ? { not_started: 0, moving: 0, slipping: 0, stalled: 0 }
      : { not_started: 96, moving: 71, slipping: 30, stalled: 16 },
    error: null,
  };
}

const READ_FAILED = "canceling statement due to statement timeout";

/** The Insights page's reads, answered from the made-up numbers a moment later. */
export function fixtureInsightsTransport(state: InsightsFixtureState): InsightsTransport {
  const later = <T>(answer: Answer<T>) =>
    state === "loading"
      ? new Promise<Answer<T>>(() => {})
      : new Promise<Answer<T>>((resolve) => setTimeout(() => resolve(answer), 250));
  return {
    loadSnapshots(fromIso, toIso) {
      if (state === "error") return later<SnapshotRow[]>({ ok: false, status: 500, error: READ_FAILED });
      const rows = state === "empty" ? [] : snapshots().filter((r) => r.snapshot_date >= fromIso && r.snapshot_date <= toIso);
      return later({ ok: true, status: 200, data: rows });
    },
    loadBountyClaims() {
      if (state === "error" || state === "partial") {
        return later<string[]>({ ok: false, status: 500, error: `the Bounty Program claims could not be read: ${READ_FAILED}` });
      }
      return later({ ok: true, status: 200, data: state === "empty" ? [] : claims() });
    },
    loadResetAt() {
      if (state === "error" || state === "noreset") {
        return later<string | null>({
          ok: false,
          status: 500,
          error: `admin_config.curriculum_reset_at could not be read: ${READ_FAILED}`,
        });
      }
      // The course switch: 2 days ago, at the live switch's time of day.
      const today = Math.floor(Date.now() / DAY) * DAY;
      return later<string | null>({ ok: true, status: 200, data: `${new Date(today - 2 * DAY).toISOString().slice(0, 10)}T14:33:33.972Z` });
    },
    loadThirtyApplied() {
      if (state === "error" || state === "partial") {
        return later<Array<{ at: string }>>({ ok: false, status: 500, error: `the applied 30% requests could not be read: ${READ_FAILED}` });
      }
      return later({ ok: true, status: 200, data: state === "empty" ? [] : thirtyApplied() });
    },
    loadSprinters() {
      if (state === "error" || state === "partial") {
        return later<SprinterProgress>({ ok: false, status: 500, error: `the students could not be read: ${READ_FAILED}` });
      }
      return later({
        ok: true,
        status: 200,
        data: state === "empty" ? { count: 0, avgProgress: 0, medianProgress: 0 } : { count: 64, avgProgress: 23, medianProgress: 17 },
      });
    },
  };
}
