/**
 * Outreach insights — the Phase 0 measurement engine (v85.3).
 *
 * Computes per-template effectiveness over the CSM task history.
 * Single source of truth: BOTH /api/admin/tasks/insights (the
 * Outreach insights page) and /api/admin/templates/stats (the inline
 * strip on /admin/templates) call this, so the two surfaces can never
 * disagree (the v81 lesson applied to outreach).
 *
 * v85.3 — PER-FAMILY SUCCESS (Karlo 2026-07-13: "it makes no sense to
 * calculate revival for canceling students; we need to know if they
 * are subscribing again"). Each template family is graded on the
 * thing its message actually asks for:
 *
 *   stalled.*    — asks: open the dashboard.
 *                  success = first login within 72h of the send
 *                  (student_milestones.first_sprint_login_at).
 *   nolessons.*  — asks: start one lesson.
 *                  success = lesson watched/shipped within 72h.
 *   noship.*     — asks: ship the action item.
 *                  success = an ACTION shipped within 72h (watching
 *                  more lessons does NOT count).
 *   pace.*       — asks: get back to work.
 *                  success = lesson activity within 72h, counted only
 *                  for sends to DORMANT students (no lesson/note
 *                  activity in the 72h before) — attribution filter.
 *   canceling    — (custom templates whose trigger references
 *                  is_canceling) asks: stay subscribed.
 *                  success = student is CURRENTLY active with the
 *                  cancel withdrawn. Current-state check — timing not
 *                  attributable until cancel_rescinded_at stamping
 *                  exists in the sync (future hardening).
 *   custom       — other custom templates: generic revival (dormant
 *                  sends that had any activity within 72h after).
 *   event        — welcome / month2 / crushing / on_track: not graded.
 *
 * Range semantics: each metric filters on ITS OWN timestamp —
 * created on created_at, send-based metrics on completed_at,
 * dismissals on dismissed_at.
 *
 * Excluded from all outreach numbers (reported in `info` instead):
 * tasks on admin-only templates (discount reviews — no DM exists) and
 * tasks with no template link.
 *
 * Correlation, not causation — students also come back on their own.
 * Rank templates against each other; don't read any cell as proof.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import type { TriggerConfig } from "@/types/database";

export const OUTREACH_WINDOW_MS = 72 * 3_600_000;
// .in() id batches — keeps PostgREST GET URLs well under length limits.
const ID_BATCH = 100;

export type OutreachFamily =
  | "stalled"
  | "nolessons"
  | "noship"
  | "pace"
  | "canceling"
  | "custom"
  | "event";

export const FAMILY_SUCCESS_LABEL: Record<OutreachFamily, string> = {
  stalled: "logged in within 72h",
  nolessons: "started a lesson within 72h",
  noship: "shipped an action within 72h",
  pace: "came back within 72h (dormant sends only)",
  canceling: "still subscribed, cancel withdrawn",
  custom: "came back within 72h (dormant sends only)",
  event: "not graded",
};

interface TaskLite {
  id: string;
  template_id: string | null;
  student_id: string;
  status: "open" | "completed" | "dismissed";
  created_at: string;
  completed_at: string | null;
  dismissed_at: string | null;
  notes: string | null;
  outcome?: "replied" | "no_reply" | null;
}

interface TemplateLite {
  id: string;
  scenario_id: string;
  title: string;
  bucket: string;
  is_admin_only: boolean;
  trigger_config: TriggerConfig | null;
}

export interface TemplateInsightRow {
  template_id: string;
  scenario_id: string | null;
  title: string | null;
  bucket: string | null;
  family: OutreachFamily;
  success_label: string;
  created: number;
  open: number;
  sent: number;
  dismissed: number;
  dismissed_auto: number;
  replied: number;
  no_reply: number;
  unmarked: number;
  /** Sends eligible for grading under this family's definition. */
  success_eligible: number;
  /** Of the eligible sends, how many did what the message asked. */
  success: number;
  median_time_to_send_ms: number | null;
}

export interface OutreachInsights {
  totals: {
    /** Unique students who received at least one DM in range. */
    students_reached: number;
    created: number;
    open: number;
    sent: number;
    dismissed: number;
    dismissed_auto: number;
    replied: number;
    no_reply: number;
    unmarked: number;
    /** Canceling family only: sends where the student is saved. */
    saves: number;
    saves_eligible: number;
    /** All other graded families pooled. */
    success: number;
    success_eligible: number;
    median_time_to_send_ms: number | null;
  };
  templates: TemplateInsightRow[];
  info: {
    admin_only_tasks: number;
    untemplated_tasks: number;
  };
  since: string | null;
  computed_at: string;
}

export function familyOf(tpl: TemplateLite): OutreachFamily {
  if (tpl.trigger_config?.all?.some((c) => c.metric === "is_canceling")) {
    return "canceling";
  }
  const sid = tpl.scenario_id ?? "";
  if (sid.startsWith("stalled.")) return "stalled";
  if (sid.startsWith("nolessons.")) return "nolessons";
  if (sid.startsWith("noship.")) return "noship";
  if (sid.startsWith("pace.")) return "pace";
  if (sid.startsWith("welcome.") || sid.startsWith("month2.")) return "event";
  if (
    tpl.bucket === "event" ||
    tpl.bucket === "crushing" ||
    tpl.bucket === "on_track"
  ) {
    return "event";
  }
  return "custom";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

interface Acc {
  created: number;
  open: number;
  sent: number;
  dismissed: number;
  dismissed_auto: number;
  replied: number;
  no_reply: number;
  unmarked: number;
  success_eligible: number;
  success: number;
  time_to_send_samples: number[];
}

function blankAcc(): Acc {
  return {
    created: 0,
    open: 0,
    sent: 0,
    dismissed: 0,
    dismissed_auto: 0,
    replied: 0,
    no_reply: 0,
    unmarked: 0,
    success_eligible: 0,
    success: 0,
    time_to_send_samples: [],
  };
}

export async function computeOutreachInsights(
  supabase: SupabaseClient,
  opts: { sinceIso?: string | null } = {},
): Promise<OutreachInsights> {
  const since = opts.sinceIso ?? null;
  const sinceMs = since ? new Date(since).getTime() : null;

  // tasks is a narrow queue table (no blob columns) — select * so this
  // works both before and after the v85 outcome migration (an explicit
  // "outcome" in the select would 400 pre-migration).
  const [tasksRes, templatesRes] = await Promise.all([
    fetchAllRowsPaginated<TaskLite>(() => supabase.from("tasks").select("*")),
    fetchAllRowsPaginated<TemplateLite>(() =>
      supabase
        .from("templates")
        .select("id, scenario_id, title, bucket, is_admin_only, trigger_config"),
    ),
  ]);
  if (tasksRes.error) throw tasksRes.error;
  if (templatesRes.error) throw templatesRes.error;

  const templateById = new Map(templatesRes.data.map((t) => [t.id, t]));
  const familyByTemplate = new Map(
    templatesRes.data.map((t) => [t.id, familyOf(t)]),
  );

  // Partition: outreach tasks vs excluded (admin-only / untemplated).
  let adminOnlyTasks = 0;
  let untemplatedTasks = 0;
  const outreach: TaskLite[] = [];
  for (const t of tasksRes.data) {
    const tpl = t.template_id ? templateById.get(t.template_id) : null;
    if (!t.template_id || !tpl) {
      untemplatedTasks++;
      continue;
    }
    if (tpl.is_admin_only) {
      adminOnlyTasks++;
      continue;
    }
    outreach.push(t);
  }

  const inRange = (iso: string | null) =>
    iso !== null && (sinceMs === null || new Date(iso).getTime() >= sinceMs);

  const sentTasks = outreach.filter(
    (t) => t.status === "completed" && inRange(t.completed_at),
  );

  // ── Per-family evidence fetches ─────────────────────────────────
  // All minimal-column, batched, paginated (v75.27 discipline).

  const lessonEvents = new Map<string, number[]>(); // watch + ship
  const actionEvents = new Map<string, number[]>(); // ship only
  const noteEvents = new Map<string, number[]>(); // daily notes
  const firstLoginMs = new Map<string, number>(); // milestones
  const savedNow = new Map<string, boolean>(); // canceling students

  if (sentTasks.length > 0) {
    let minSendMs = new Date(sentTasks[0].completed_at as string).getTime();
    for (const t of sentTasks) {
      const ms = new Date(t.completed_at as string).getTime();
      if (ms < minSendMs) minSendMs = ms;
    }
    const lowerBoundIso = new Date(
      minSendMs - OUTREACH_WINDOW_MS,
    ).toISOString();

    const push = (map: Map<string, number[]>, id: string, iso: string | null) => {
      if (!iso) return;
      const arr = map.get(id) ?? [];
      arr.push(new Date(iso).getTime());
      map.set(id, arr);
    };

    const familyOfTask = (t: TaskLite): OutreachFamily =>
      familyByTemplate.get(t.template_id as string) ?? "custom";

    const activityStudents = new Set<string>();
    const stalledStudents = new Set<string>();
    const cancelingStudents = new Set<string>();
    for (const t of sentTasks) {
      const fam = familyOfTask(t);
      if (fam === "stalled") stalledStudents.add(t.student_id);
      else if (fam === "canceling") cancelingStudents.add(t.student_id);
      else if (fam !== "event") activityStudents.add(t.student_id);
    }

    // Lesson + note events for activity-graded families.
    const activityIds = [...activityStudents];
    for (let i = 0; i < activityIds.length; i += ID_BATCH) {
      const batch = activityIds.slice(i, i + ID_BATCH);
      const [completionsRes, notesRes] = await Promise.all([
        fetchAllRowsPaginated<{
          student_id: string;
          completed_at: string | null;
          action_completed_at: string | null;
        }>(() =>
          supabase
            .from("student_lesson_completions")
            .select("student_id, completed_at, action_completed_at")
            .in("student_id", batch)
            .or(
              `completed_at.gte.${lowerBoundIso},action_completed_at.gte.${lowerBoundIso}`,
            ),
        ),
        fetchAllRowsPaginated<{
          student_id: string;
          created_at: string | null;
          updated_at: string | null;
        }>(() =>
          supabase
            .from("daily_notes")
            .select("student_id, created_at, updated_at")
            .in("student_id", batch)
            .or(
              `created_at.gte.${lowerBoundIso},updated_at.gte.${lowerBoundIso}`,
            ),
        ),
      ]);
      if (completionsRes.error) throw completionsRes.error;
      if (notesRes.error) throw notesRes.error;
      for (const r of completionsRes.data) {
        push(lessonEvents, r.student_id, r.completed_at);
        push(lessonEvents, r.student_id, r.action_completed_at);
        push(actionEvents, r.student_id, r.action_completed_at);
      }
      for (const r of notesRes.data) {
        push(noteEvents, r.student_id, r.created_at);
        push(noteEvents, r.student_id, r.updated_at);
      }
    }

    // First-login milestone for the stalled family.
    const stalledIds = [...stalledStudents];
    for (let i = 0; i < stalledIds.length; i += ID_BATCH) {
      const batch = stalledIds.slice(i, i + ID_BATCH);
      const { data, error } = await fetchAllRowsPaginated<{
        student_id: string;
        first_sprint_login_at: string | null;
      }>(() =>
        supabase
          .from("student_milestones")
          .select("student_id, first_sprint_login_at")
          .in("student_id", batch)
          .not("first_sprint_login_at", "is", null),
      );
      if (error) throw error;
      for (const r of data) {
        if (r.first_sprint_login_at) {
          firstLoginMs.set(
            r.student_id,
            new Date(r.first_sprint_login_at).getTime(),
          );
        }
      }
    }

    // Current subscription state for the canceling family.
    // "Saved" = active AND cancel withdrawn, as of NOW (no history
    // table exists — timing attribution needs cancel_rescinded_at
    // stamping in the sync, a future hardening).
    const cancelingIds = [...cancelingStudents];
    for (let i = 0; i < cancelingIds.length; i += ID_BATCH) {
      const batch = cancelingIds.slice(i, i + ID_BATCH);
      const { data, error } = await fetchAllRowsPaginated<{
        id: string;
        membership_status: string;
        cancel_scheduled_at: string | null;
      }>(() =>
        supabase
          .from("students")
          .select("id, membership_status, cancel_scheduled_at")
          .in("id", batch),
      );
      if (error) throw error;
      for (const r of data) {
        savedNow.set(
          r.id,
          r.membership_status === "active" && r.cancel_scheduled_at === null,
        );
      }
    }
  }

  // ── Aggregate ───────────────────────────────────────────────────
  const byTemplate = new Map<string, Acc>();
  const totals = blankAcc();
  let saves = 0;
  let savesEligible = 0;
  const reachedStudents = new Set<string>();

  const bump = (templateId: string, fn: (s: Acc) => void) => {
    let s = byTemplate.get(templateId);
    if (!s) {
      s = blankAcc();
      byTemplate.set(templateId, s);
    }
    fn(s);
  };

  const anyIn = (arr: number[] | undefined, from: number, to: number) =>
    (arr ?? []).some((e) => e > from && e <= to);

  for (const t of outreach) {
    const tid = t.template_id as string;
    const fam = familyByTemplate.get(tid) ?? "custom";

    if (inRange(t.created_at)) {
      bump(tid, (s) => s.created++);
      totals.created++;
      if (t.status === "open") {
        bump(tid, (s) => s.open++);
        totals.open++;
      }
    }
    if (t.status === "dismissed" && inRange(t.dismissed_at)) {
      const auto = (t.notes ?? "").startsWith("Auto-dismissed");
      bump(tid, (s) => {
        s.dismissed++;
        if (auto) s.dismissed_auto++;
      });
      totals.dismissed++;
      if (auto) totals.dismissed_auto++;
    }
    if (t.status !== "completed" || !inRange(t.completed_at)) continue;

    // ── A sent DM ──
    reachedStudents.add(t.student_id);
    const sendMs = new Date(t.completed_at as string).getTime();
    const createdMs = new Date(t.created_at).getTime();
    const outcome = t.outcome ?? null;

    let eligible = false;
    let succeeded = false;
    switch (fam) {
      case "stalled": {
        eligible = true;
        const login = firstLoginMs.get(t.student_id);
        succeeded =
          login !== undefined &&
          login > sendMs &&
          login <= sendMs + OUTREACH_WINDOW_MS;
        break;
      }
      case "nolessons": {
        eligible = true;
        succeeded = anyIn(
          lessonEvents.get(t.student_id),
          sendMs,
          sendMs + OUTREACH_WINDOW_MS,
        );
        break;
      }
      case "noship": {
        eligible = true;
        succeeded = anyIn(
          actionEvents.get(t.student_id),
          sendMs,
          sendMs + OUTREACH_WINDOW_MS,
        );
        break;
      }
      case "pace":
      case "custom": {
        // Attribution filter: only dormant-before sends are graded.
        const before = (from: number, to: number) =>
          anyIn(lessonEvents.get(t.student_id), from, to) ||
          anyIn(noteEvents.get(t.student_id), from, to);
        const dormant = !before(sendMs - OUTREACH_WINDOW_MS, sendMs - 1);
        eligible = dormant;
        succeeded =
          dormant &&
          (anyIn(
            lessonEvents.get(t.student_id),
            sendMs,
            sendMs + OUTREACH_WINDOW_MS,
          ) ||
            anyIn(
              noteEvents.get(t.student_id),
              sendMs,
              sendMs + OUTREACH_WINDOW_MS,
            ));
        break;
      }
      case "canceling": {
        eligible = true;
        succeeded = savedNow.get(t.student_id) === true;
        break;
      }
      case "event":
        break;
    }

    bump(tid, (s) => {
      s.sent++;
      if (sendMs >= createdMs) s.time_to_send_samples.push(sendMs - createdMs);
      if (outcome === "replied") s.replied++;
      else if (outcome === "no_reply") s.no_reply++;
      else s.unmarked++;
      if (eligible) {
        s.success_eligible++;
        if (succeeded) s.success++;
      }
    });
    totals.sent++;
    if (sendMs >= createdMs) {
      totals.time_to_send_samples.push(sendMs - createdMs);
    }
    if (outcome === "replied") totals.replied++;
    else if (outcome === "no_reply") totals.no_reply++;
    else totals.unmarked++;
    if (fam === "canceling") {
      if (eligible) {
        savesEligible++;
        if (succeeded) saves++;
      }
    } else if (eligible) {
      totals.success_eligible++;
      if (succeeded) totals.success++;
    }
  }

  const rows: TemplateInsightRow[] = [...byTemplate.entries()].map(
    ([templateId, s]) => {
      const tpl = templateById.get(templateId);
      const fam = familyByTemplate.get(templateId) ?? "custom";
      const { time_to_send_samples, ...stats } = s;
      return {
        template_id: templateId,
        scenario_id: tpl?.scenario_id ?? null,
        title: tpl?.title ?? null,
        bucket: tpl?.bucket ?? null,
        family: fam,
        success_label: FAMILY_SUCCESS_LABEL[fam],
        ...stats,
        median_time_to_send_ms: median(time_to_send_samples),
      };
    },
  );
  rows.sort((a, b) => b.sent - a.sent || b.created - a.created);

  const { time_to_send_samples: totalSamples, ...totalStats } = totals;

  return {
    totals: {
      students_reached: reachedStudents.size,
      ...totalStats,
      saves,
      saves_eligible: savesEligible,
      median_time_to_send_ms: median(totalSamples),
    },
    templates: rows,
    info: {
      admin_only_tasks: adminOnlyTasks,
      untemplated_tasks: untemplatedTasks,
    },
    since,
    computed_at: new Date().toISOString(),
  };
}
