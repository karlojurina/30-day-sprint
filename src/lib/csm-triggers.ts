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

import type {
  Student,
  Condition,
  ConditionOp,
  TriggerConfig,
} from "@/types/database";

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

  /** Watched state for every lesson (true if completed_at is set),
   *  keyed by lesson_id. Used by the custom-trigger lesson_watched
   *  condition. */
  watched: Record<string, boolean>;

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
  const watched: Record<string, boolean> = {};
  let latestCompletionAt: number | null = null;

  for (const c of completions) {
    const lesson = lessonsById.get(c.lesson_id);
    if (!lesson) continue;
    const region = regions[lesson.region_id];
    if (!region) continue;

    if (c.completed_at) {
      region.watchedComplete += 1;
      watched[c.lesson_id] = true;
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
    watched,
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

/* ─────────────────────────────────────────────────────────────────
 * Custom triggers (v34) — built from the JSON DSL Karlo edits via
 * /admin/templates. The metric registry below is the single source
 * of truth for which metrics exist + what their labels look like.
 * Frontend imports it for the dropdown options; backend imports it
 * to evaluate conditions.
 * ──────────────────────────────────────────────────────────────── */

export type MetricInputType = "number" | "boolean" | "enum" | "param-number" | "param-boolean";

export interface MetricDef {
  /** Stable internal id — what lands in the trigger_config JSON. */
  id: import("@/types/database").ConditionMetric;
  /** What the user sees in the metric dropdown. */
  label: string;
  /** "number" → numeric input + the six numeric ops.
   *  "param-number" → also has a sub-param (region/lesson).
   *  "boolean" → only "is" / "is not", value implied (true/false).
   *  "param-boolean" → boolean + a sub-param (region/lesson).
   *  "enum" → "is" / "is not" + a value dropdown. */
  input: "number" | "boolean" | "enum";
  /** When the metric has a sub-param like region or lesson_id. */
  param?: "region" | "lesson";
  /** For enum metrics — list of allowed values. */
  enumValues?: ReadonlyArray<string>;
  /** Suffix shown next to numeric inputs (e.g. "%"). */
  unit?: string;
  /** Compact natural-language renderer used in behavior summaries +
   *  the live preview line on the template editor. */
  describe: (cond: Condition) => string;
}

/** Friendly labels for region ids — keep in sync with the v20 region names. */
export const REGION_LABEL: Record<string, string> = {
  r1: "Region 1 (Foundation)",
  r2: "Region 2 (Strategy)",
  r3: "Region 3 (Production)",
  r4: "Region 4 (Gate of Possibilities)",
};

/** Lessons that students explicitly ship an ad for. Used by the
 *  lesson_shipped dropdown in the condition builder. */
export const ACTION_LESSONS: Array<{ id: string; label: string }> = [
  { id: "l018", label: "Organic Ad (l018)" },
  { id: "l020", label: "UGC Ad (l020)" },
  { id: "l022", label: "VSL Ad (l022)" },
  { id: "l024", label: "High-Production Ad (l024)" },
  { id: "l049", label: "Static Ads (l049)" },
];

const opPhrase: Record<ConditionOp, string> = {
  is: "is",
  is_not: "is not",
  at_least: "is at least",
  more_than: "is more than",
  at_most: "is at most",
  less_than: "is less than",
};

function describeNumeric(label: string, c: Condition, unit = ""): string {
  if ("value" in c && typeof c.value === "number") {
    return `${label} ${opPhrase[c.op]} ${c.value}${unit}`;
  }
  return label;
}

function describeBoolean(label: string, c: Condition, posVerb = "is"): string {
  return `${label} ${c.op === "is" ? posVerb : `is not ${posVerb.replace(/^is\s+/, "")}`}`.trim();
}

export const METRICS: Record<import("@/types/database").ConditionMetric, MetricDef> = {
  day_number: {
    id: "day_number",
    label: "Day in the program",
    input: "number",
    describe: (c) => describeNumeric("Day in the program", c),
  },
  total_lessons_watched: {
    id: "total_lessons_watched",
    label: "Total lessons watched",
    input: "number",
    describe: (c) => describeNumeric("Total lessons watched", c),
  },
  region_lessons_watched: {
    id: "region_lessons_watched",
    label: "Lessons watched in a region",
    input: "number",
    param: "region",
    describe: (c) => {
      if ("region" in c) {
        return describeNumeric(
          `Lessons watched in ${REGION_LABEL[c.region] ?? c.region}`,
          c,
        );
      }
      return "Lessons watched in a region";
    },
  },
  region_completion_pct: {
    id: "region_completion_pct",
    label: "Region completion %",
    input: "number",
    param: "region",
    unit: "%",
    describe: (c) => {
      if ("region" in c) {
        return describeNumeric(
          `${REGION_LABEL[c.region] ?? c.region} completion`,
          c,
          "%",
        );
      }
      return "Region completion %";
    },
  },
  region_complete: {
    id: "region_complete",
    label: "Region is fully complete",
    input: "boolean",
    param: "region",
    describe: (c) => {
      if ("region" in c) {
        return c.op === "is"
          ? `${REGION_LABEL[c.region] ?? c.region} is complete`
          : `${REGION_LABEL[c.region] ?? c.region} is not complete`;
      }
      return "Region completion";
    },
  },
  lesson_shipped: {
    id: "lesson_shipped",
    label: "Shipped action item",
    input: "boolean",
    param: "lesson",
    describe: (c) => {
      if ("lesson_id" in c) {
        const lesson =
          ACTION_LESSONS.find((l) => l.id === c.lesson_id)?.label ?? c.lesson_id;
        return c.op === "is"
          ? `Shipped: ${lesson}`
          : `Not shipped: ${lesson}`;
      }
      return "Action item shipped";
    },
  },
  lesson_watched: {
    id: "lesson_watched",
    label: "Watched a specific lesson",
    input: "boolean",
    param: "lesson",
    describe: (c) => {
      if ("lesson_id" in c) {
        const lesson =
          ACTION_LESSONS.find((l) => l.id === c.lesson_id)?.label ?? c.lesson_id;
        return c.op === "is"
          ? `Watched lesson ${lesson}`
          : `Did not watch lesson ${lesson}`;
      }
      return "Lesson watched";
    },
  },
  days_since_last_completion: {
    id: "days_since_last_completion",
    label: "Days since last lesson",
    input: "number",
    describe: (c) => describeNumeric("Days since last lesson", c),
  },
  days_since_last_login: {
    id: "days_since_last_login",
    label: "Days since last login",
    input: "number",
    describe: (c) => describeNumeric("Days since last login", c),
  },
  membership_status: {
    id: "membership_status",
    label: "Subscription status",
    input: "enum",
    enumValues: ["active", "canceled", "past_due", "expired"] as const,
    describe: (c) => {
      if ("value" in c && typeof c.value === "string") {
        return `Subscription status ${c.op === "is" ? "is" : "is not"} ${c.value}`;
      }
      return "Subscription status";
    },
  },
};

/* ─────────────────────────────────────────────────────────────────
 * Condition evaluation. Pulls the value out of the snapshot, then
 * compares against the user-set value using the user-chosen op.
 * ──────────────────────────────────────────────────────────────── */

function compareNumber(actual: number, op: ConditionOp, target: number): boolean {
  switch (op) {
    case "is":
      return actual === target;
    case "is_not":
      return actual !== target;
    case "at_least":
      return actual >= target;
    case "more_than":
      return actual > target;
    case "at_most":
      return actual <= target;
    case "less_than":
      return actual < target;
    default:
      return false;
  }
}

function getNumericValue(snap: StudentSnapshot, c: Condition): number | null {
  switch (c.metric) {
    case "day_number":
      return snap.day;
    case "total_lessons_watched":
      return Object.values(snap.regions).reduce(
        (sum, r) => sum + r.watchedComplete,
        0,
      );
    case "region_lessons_watched":
      return "region" in c
        ? snap.regions[c.region]?.watchedComplete ?? 0
        : null;
    case "region_completion_pct":
      if ("region" in c) {
        const r = snap.regions[c.region];
        if (!r || r.total === 0) return 0;
        return Math.round((r.fullyComplete / r.total) * 100);
      }
      return null;
    case "days_since_last_completion":
      return snap.daysSinceLastCompletion ?? 999;
    case "days_since_last_login":
      return snap.daysSinceLastActive;
    default:
      return null;
  }
}

function evalCondition(snap: StudentSnapshot, c: Condition): boolean {
  switch (c.metric) {
    case "region_complete":
      if (!("region" in c)) return false;
      {
        const r = snap.regions[c.region];
        const complete = r ? r.fullyComplete >= r.total && r.total > 0 : false;
        return c.op === "is" ? complete : !complete;
      }
    case "lesson_shipped":
      if (!("lesson_id" in c)) return false;
      {
        const shipped = Boolean(snap.shipped[c.lesson_id]);
        return c.op === "is" ? shipped : !shipped;
      }
    case "lesson_watched":
      if (!("lesson_id" in c)) return false;
      {
        const watched = Boolean(snap.watched[c.lesson_id]);
        return c.op === "is" ? watched : !watched;
      }
    case "membership_status":
      if (!("value" in c) || typeof c.value !== "string") return false;
      return c.op === "is"
        ? snap.student.membership_status === c.value
        : snap.student.membership_status !== c.value;
    default: {
      const actual = getNumericValue(snap, c);
      if (actual == null) return false;
      const target =
        "value" in c && typeof c.value === "number" ? c.value : 0;
      return compareNumber(actual, c.op, target);
    }
  }
}

/**
 * Evaluate a TriggerConfig against a student snapshot.
 *
 * Returns:
 *   match   — true when EVERY condition in `config.all` passes
 *   summary — concrete behavior summary for tasks.behavior_summary,
 *             e.g. "Day 7 · 12 R1 lessons watched · l018 not shipped"
 */
export function evaluateCustomTrigger(
  snap: StudentSnapshot,
  config: TriggerConfig,
): { match: boolean; summary: string } {
  if (!Array.isArray(config?.all) || config.all.length === 0) {
    return { match: false, summary: "" };
  }
  for (const c of config.all) {
    if (!evalCondition(snap, c)) return { match: false, summary: "" };
  }
  const pieces = config.all.map((c) => METRICS[c.metric].describe(c));
  return { match: true, summary: pieces.join(" · ") };
}

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
