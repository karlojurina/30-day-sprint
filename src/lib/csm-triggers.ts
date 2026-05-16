/**
 * CSM scenario trigger logic.
 *
 * Each scenario lives in [lovro-brief/context/scenarios.md] and has a
 * trigger spec in [lovro-brief/02-triggers.md]. This module:
 *
 *   1. Defines a per-student `StudentSnapshot` — everything a trigger
 *      needs to decide whether to fire (region progress, specific
 *      lesson ship state, recency).
 *
 *   2. Builds the snapshot from bulk-fetched data so the cron does
 *      one round-trip to the DB instead of N (for N students).
 *
 *   3. Exposes pure trigger functions: `(snapshot) → null | { reason }`.
 *      The cron loops scenarios over snapshots and inserts tasks for
 *      every non-null result.
 *
 * Day windows in the trigger conditions are kept because they're how
 * the cron filters internally. The user-facing templates already speak
 * region/task language, never "Day N" (see lovro-brief/context/templates.md).
 */

import type { Student } from "@/types/database";

// ───────── Inputs ─────────

interface CompletionRow {
  student_id: string;
  lesson_id: string;
  completed_at: string | null;
  action_completed_at: string | null;
}

interface LessonRow {
  id: string;
  region_id: string;
  requires_action: boolean;
}

interface ExistingTask {
  student_id: string;
  scenario_id: string;
  status: string;
}

// ───────── Snapshot ─────────

export interface StudentSnapshot {
  student: Pick<
    Student,
    "id" | "name" | "joined_at" | "membership_status" | "last_active_at"
  >;
  /** Day counter, 1-indexed, computed from joined_at. */
  day: number;

  /**
   * Region progress map. For each region:
   *   total              — number of lessons in the region
   *   watchedComplete    — lessons with completed_at NOT NULL
   *   fullyComplete      — lessons that count as "done" (watched, plus action_completed if requires_action)
   */
  regions: Record<string, { total: number; watchedComplete: number; fullyComplete: number }>;

  /** Per-action-lesson ship state, keyed by lesson_id. */
  shipped: Record<string, boolean>;

  /** Days since last completion (rounded down). null if no completion exists. */
  daysSinceLastCompletion: number | null;
  /** Days since last_active_at. */
  daysSinceLastActive: number;
  /** Set of scenarios with an OPEN or recently-COMPLETED task — used by X.1 reactivation. */
  recentTaskScenarios: Set<string>;
}

export function buildStudentSnapshot(
  student: Student,
  completions: CompletionRow[],
  lessons: LessonRow[],
  regionTotals: Record<string, number>,
  existingTasks: ExistingTask[],
): StudentSnapshot {
  const now = Date.now();
  const day = Math.max(
    1,
    Math.ceil((now - new Date(student.joined_at).getTime()) / 86_400_000),
  );

  const lessonsById = new Map(lessons.map((l) => [l.id, l]));

  // Aggregate per-region progress.
  const regions: StudentSnapshot["regions"] = {};
  for (const rid of ["r1", "r2", "r3", "r4"]) {
    regions[rid] = { total: regionTotals[rid] ?? 0, watchedComplete: 0, fullyComplete: 0 };
  }

  const shipped: Record<string, boolean> = {};
  let latestCompletionAt: number | null = null;

  for (const c of completions) {
    const lesson = lessonsById.get(c.lesson_id);
    if (!lesson) continue;
    const region = regions[lesson.region_id];
    if (!region) continue;

    if (c.completed_at) {
      region.watchedComplete += 1;
      const t = new Date(c.completed_at).getTime();
      if (latestCompletionAt === null || t > latestCompletionAt) {
        latestCompletionAt = t;
      }
    }

    const fullyDone = lesson.requires_action
      ? Boolean(c.action_completed_at)
      : Boolean(c.completed_at);
    if (fullyDone) region.fullyComplete += 1;

    if (lesson.requires_action) {
      shipped[c.lesson_id] = Boolean(c.action_completed_at);
    }
  }

  const daysSinceLastCompletion =
    latestCompletionAt === null
      ? null
      : Math.floor((now - latestCompletionAt) / 86_400_000);
  const daysSinceLastActive = Math.floor(
    (now - new Date(student.last_active_at).getTime()) / 86_400_000,
  );

  const recentTaskScenarios = new Set(
    existingTasks
      .filter((t) => t.student_id === student.id)
      .map((t) => t.scenario_id),
  );

  return {
    student: {
      id: student.id,
      name: student.name,
      joined_at: student.joined_at,
      membership_status: student.membership_status,
      last_active_at: student.last_active_at,
    },
    day,
    regions,
    shipped,
    daysSinceLastCompletion,
    daysSinceLastActive,
    recentTaskScenarios,
  };
}

// ───────── Trigger helpers ─────────

function regionComplete(snap: StudentSnapshot, rid: string): boolean {
  const r = snap.regions[rid];
  if (!r || r.total === 0) return false;
  return r.fullyComplete >= r.total;
}

function regionIncomplete(snap: StudentSnapshot, rid: string): boolean {
  const r = snap.regions[rid];
  if (!r || r.total === 0) return false;
  return r.fullyComplete < r.total;
}

function totalCompletedAcrossRegions(snap: StudentSnapshot): number {
  return Object.values(snap.regions).reduce(
    (sum, r) => sum + r.watchedComplete,
    0,
  );
}

// ───────── Triggers (P1) ─────────
//
// Each returns a behavior summary string (concrete state at fire time)
// when the trigger condition is met, or null otherwise. The cron uses
// these results verbatim as tasks.behavior_summary.

export type TriggerCheck = (snap: StudentSnapshot) => string | null;

export const triggers: Record<string, TriggerCheck> = {
  // W1.1 — R1 complete. No day-window restriction.
  "W1.1": (s) => {
    if (!regionComplete(s, "r1")) return null;
    if (s.recentTaskScenarios.has("W1.1")) return null;
    return `Day ${s.day} · R1 complete (${s.regions.r1.fullyComplete}/${s.regions.r1.total} lessons, both action items shipped).`;
  },

  // W1.2 — Watched ≥10 R1 lessons but l018 + l020 not shipped, Day 7-8.
  "W1.2": (s) => {
    if (s.day < 7 || s.day > 8) return null;
    if (s.regions.r1.watchedComplete < 10) return null;
    if (s.shipped["l018"] || s.shipped["l020"]) return null;
    if (s.recentTaskScenarios.has("W1.2")) return null;
    return `Day ${s.day} · ${s.regions.r1.watchedComplete} R1 lessons watched but neither l018 (Organic) nor l020 (UGC) shipped.`;
  },

  // W1.3 — Slow start: <3 lessons completed by Day 4-5.
  "W1.3": (s) => {
    if (s.day < 4 || s.day > 5) return null;
    if (totalCompletedAcrossRegions(s) >= 3) return null;
    if (s.recentTaskScenarios.has("W1.3")) return null;
    const count = totalCompletedAcrossRegions(s);
    return `Day ${s.day} · only ${count} lesson${count === 1 ? "" : "s"} completed so far.`;
  },

  // W2.1 — R2 complete. No day-window restriction.
  "W2.1": (s) => {
    if (!regionComplete(s, "r2")) return null;
    if (s.recentTaskScenarios.has("W2.1")) return null;
    return `Day ${s.day} · R2 complete (${s.regions.r2.fullyComplete}/${s.regions.r2.total}) — discount widget unlocked.`;
  },

  // W2.3 — Day 10-11, ≥5 R2 lessons watched, l022 + l024 not shipped.
  "W2.3": (s) => {
    if (s.day < 10 || s.day > 11) return null;
    if (s.regions.r2.watchedComplete < 5) return null;
    if (s.shipped["l022"] || s.shipped["l024"]) return null;
    if (s.recentTaskScenarios.has("W2.3")) return null;
    return `Day ${s.day} · ${s.regions.r2.watchedComplete} R2 lessons watched but neither l022 (VSL) nor l024 (High-Prod) shipped.`;
  },

  // W2.4 — Behind pace: R1 < 100% on Day 9-11.
  "W2.4": (s) => {
    if (s.day < 9 || s.day > 11) return null;
    if (!regionIncomplete(s, "r1")) return null;
    if (s.recentTaskScenarios.has("W2.4")) return null;
    return `Day ${s.day} · R1 still incomplete (${s.regions.r1.fullyComplete}/${s.regions.r1.total}).`;
  },

  // W2.5 — Day 12-14, R1 still incomplete (winning-mindset reframe).
  "W2.5": (s) => {
    if (s.day < 12 || s.day > 14) return null;
    if (!regionIncomplete(s, "r1")) return null;
    if (s.recentTaskScenarios.has("W2.5")) return null;
    return `Day ${s.day} · R1 still incomplete (${s.regions.r1.fullyComplete}/${s.regions.r1.total}) — discount window approaching.`;
  },

  // W3.1 — R3 complete.
  "W3.1": (s) => {
    if (!regionComplete(s, "r3")) return null;
    if (s.recentTaskScenarios.has("W3.1")) return null;
    return `Day ${s.day} · R3 complete (${s.regions.r3.fullyComplete}/${s.regions.r3.total}).`;
  },

  // W3.2 — Day 21-23, R2 still incomplete.
  "W3.2": (s) => {
    if (s.day < 21 || s.day > 23) return null;
    if (!regionIncomplete(s, "r2")) return null;
    if (s.recentTaskScenarios.has("W3.2")) return null;
    return `Day ${s.day} · R2 still incomplete (${s.regions.r2.fullyComplete}/${s.regions.r2.total}) — significant intervention.`;
  },

  // W4.1 — Day 25-30, R3 still incomplete.
  "W4.1": (s) => {
    if (s.day < 25 || s.day > 30) return null;
    if (!regionIncomplete(s, "r3")) return null;
    if (s.recentTaskScenarios.has("W4.1")) return null;
    return `Day ${s.day} · R3 still incomplete (${s.regions.r3.fullyComplete}/${s.regions.r3.total}) — last stretch before R4.`;
  },

  // W4.2 — Day 30 exactly, R4 incomplete, still active.
  "W4.2": (s) => {
    if (s.day !== 30) return null;
    if (s.student.membership_status !== "active") return null;
    if (!regionIncomplete(s, "r4")) return null;
    if (s.recentTaskScenarios.has("W4.2")) return null;
    return `Day 30 · R4 ${s.regions.r4.fullyComplete}/${s.regions.r4.total} — sprint incomplete but still paying.`;
  },
};

/** Bucket label used in the cron's Discord summary. */
export const SCENARIO_BUCKET: Record<string, string> = {
  "W1.1": "crushing",
  "W1.2": "at_risk",
  "W1.3": "at_risk",
  "W1.4": "cancel_path",
  "W2.1": "crushing",
  "W2.2": "crushing",
  "W2.3": "at_risk",
  "W2.4": "at_risk",
  "W2.5": "at_risk",
  "W2.6": "admin",
  "W2.7": "cancel_path",
  "W3.1": "crushing",
  "W3.2": "at_risk",
  "W3.3": "cancel_path",
  "W4.1": "at_risk",
  "W4.2": "at_risk",
  "W4.3": "cancel_path",
  "W4.4": "cancel_path",
  "X.1": "event",
};
