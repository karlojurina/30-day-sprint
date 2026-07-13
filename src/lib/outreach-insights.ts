/**
 * Outreach insights — the Phase 0 measurement engine (v85.2).
 *
 * Computes per-template effectiveness over the CSM task history.
 * Single source of truth: BOTH /api/admin/tasks/insights (the
 * Outreach insights page) and /api/admin/templates/stats (the inline
 * strip on /admin/templates) call this, so the two surfaces can never
 * disagree (the v81 lesson applied to outreach).
 *
 * Definitions (mirrored in the methodology box on the insights page):
 *
 *   activity        — student marked a lesson watched, shipped an
 *                     action, or wrote/edited a daily note.
 *   re_engaged_72h  — sent DMs where the student had ANY activity in
 *                     the 72h AFTER the send (task.completed_at).
 *                     Inflated by already-active students; kept for
 *                     continuity with the v85 strip.
 *   revival         — the honest metric. Only sends to DORMANT
 *                     students (zero activity in the 72h BEFORE the
 *                     send) are eligible; revived = of those, the
 *                     student had activity within 72h after.
 *   time_to_send    — created_at → completed_at per sent task
 *                     (median). Queue latency, not message quality.
 *
 * Range semantics: each metric filters on ITS OWN timestamp —
 * created on created_at, send-based metrics on completed_at,
 * dismissals on dismissed_at. A task created before the range but
 * sent inside it counts as a send, not a creation.
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

export const OUTREACH_WINDOW_MS = 72 * 3_600_000;
// .in() id batches — keeps PostgREST GET URLs well under length limits.
const ID_BATCH = 100;

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
}

export interface TemplateInsightRow {
  template_id: string;
  scenario_id: string | null;
  title: string | null;
  bucket: string | null;
  created: number;
  open: number;
  sent: number;
  dismissed: number;
  dismissed_auto: number;
  replied: number;
  no_reply: number;
  unmarked: number;
  re_engaged_72h: number;
  revival_eligible: number;
  revived: number;
  median_time_to_send_ms: number | null;
}

export interface OutreachInsights {
  totals: Omit<TemplateInsightRow, "template_id" | "scenario_id" | "title" | "bucket">;
  templates: TemplateInsightRow[];
  info: {
    admin_only_tasks: number;
    untemplated_tasks: number;
  };
  since: string | null;
  computed_at: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function blankStats(): Omit<
  TemplateInsightRow,
  "template_id" | "scenario_id" | "title" | "bucket" | "median_time_to_send_ms"
> & { time_to_send_samples: number[] } {
  return {
    created: 0,
    open: 0,
    sent: 0,
    dismissed: 0,
    dismissed_auto: 0,
    replied: 0,
    no_reply: 0,
    unmarked: 0,
    re_engaged_72h: 0,
    revival_eligible: 0,
    revived: 0,
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
    fetchAllRowsPaginated<TaskLite>(() =>
      supabase.from("tasks").select("*"),
    ),
    fetchAllRowsPaginated<TemplateLite>(() =>
      supabase
        .from("templates")
        .select("id, scenario_id, title, bucket, is_admin_only"),
    ),
  ]);
  if (tasksRes.error) throw tasksRes.error;
  if (templatesRes.error) throw templatesRes.error;

  const templateById = new Map(templatesRes.data.map((t) => [t.id, t]));

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

  // Activity events (lesson watch/ship + daily notes) for every
  // student who received an in-range DM. Lower bound = earliest send
  // minus the window, so dormancy-before checks are covered too.
  // Minimal columns, batched ids, paginated pages (v75.27 discipline).
  const eventsByStudent = new Map<string, number[]>();
  if (sentTasks.length > 0) {
    let minSendMs = new Date(sentTasks[0].completed_at as string).getTime();
    for (const t of sentTasks) {
      const ms = new Date(t.completed_at as string).getTime();
      if (ms < minSendMs) minSendMs = ms;
    }
    const lowerBoundIso = new Date(minSendMs - OUTREACH_WINDOW_MS).toISOString();
    const studentIds = [...new Set(sentTasks.map((t) => t.student_id))];

    const pushEvent = (studentId: string, iso: string | null) => {
      if (!iso) return;
      const arr = eventsByStudent.get(studentId) ?? [];
      arr.push(new Date(iso).getTime());
      eventsByStudent.set(studentId, arr);
    };

    for (let i = 0; i < studentIds.length; i += ID_BATCH) {
      const batch = studentIds.slice(i, i + ID_BATCH);
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
        pushEvent(r.student_id, r.completed_at);
        pushEvent(r.student_id, r.action_completed_at);
      }
      for (const r of notesRes.data) {
        pushEvent(r.student_id, r.created_at);
        pushEvent(r.student_id, r.updated_at);
      }
    }
  }

  // Aggregate.
  const byTemplate = new Map<string, ReturnType<typeof blankStats>>();
  const totals = blankStats();
  const bump = (
    templateId: string,
    fn: (s: ReturnType<typeof blankStats>) => void,
  ) => {
    let s = byTemplate.get(templateId);
    if (!s) {
      s = blankStats();
      byTemplate.set(templateId, s);
    }
    fn(s);
    fn(totals);
  };

  for (const t of outreach) {
    const tid = t.template_id as string;
    if (inRange(t.created_at)) {
      bump(tid, (s) => s.created++);
      if (t.status === "open") bump(tid, (s) => s.open++);
    }
    if (t.status === "dismissed" && inRange(t.dismissed_at)) {
      const auto = (t.notes ?? "").startsWith("Auto-dismissed");
      bump(tid, (s) => {
        s.dismissed++;
        if (auto) s.dismissed_auto++;
      });
    }
    if (t.status === "completed" && inRange(t.completed_at)) {
      const sendMs = new Date(t.completed_at as string).getTime();
      const createdMs = new Date(t.created_at).getTime();
      const events = eventsByStudent.get(t.student_id) ?? [];
      const activeBefore = events.some(
        (e) => e >= sendMs - OUTREACH_WINDOW_MS && e < sendMs,
      );
      const activeAfter = events.some(
        (e) => e > sendMs && e <= sendMs + OUTREACH_WINDOW_MS,
      );
      bump(tid, (s) => {
        s.sent++;
        if (sendMs >= createdMs) {
          s.time_to_send_samples.push(sendMs - createdMs);
        }
        if (t.outcome === "replied") s.replied++;
        else if (t.outcome === "no_reply") s.no_reply++;
        else s.unmarked++;
        if (activeAfter) s.re_engaged_72h++;
        if (!activeBefore) {
          s.revival_eligible++;
          if (activeAfter) s.revived++;
        }
      });
    }
  }

  const rows: TemplateInsightRow[] = [...byTemplate.entries()].map(
    ([templateId, s]) => {
      const tpl = templateById.get(templateId);
      const { time_to_send_samples, ...stats } = s;
      return {
        template_id: templateId,
        scenario_id: tpl?.scenario_id ?? null,
        title: tpl?.title ?? null,
        bucket: tpl?.bucket ?? null,
        ...stats,
        median_time_to_send_ms: median(time_to_send_samples),
      };
    },
  );
  rows.sort((a, b) => b.sent - a.sent || b.created - a.created);

  const { time_to_send_samples: totalSamples, ...totalStats } = totals;

  return {
    totals: {
      ...totalStats,
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
