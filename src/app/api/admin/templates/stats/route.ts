/**
 * GET /api/admin/templates/stats
 *
 * Phase 0 of the retention overhaul: per-template effectiveness over
 * the FULL task history, so the team can see which DMs actually move
 * behavior. Returns, keyed by template_id:
 *
 *   created / open / sent / dismissed — queue counts
 *   replied / no_reply               — manual outcome taps (v85)
 *   re_engaged_72h                   — sent tasks where the student
 *     marked a watch OR shipped an action within 72h AFTER the send
 *     (task.completed_at). Computed live from
 *     student_lesson_completions, so it grades pre-v85 history too.
 *
 * Correlation, not causation — students also re-engage on their own.
 * Use it to compare templates against each other, not as absolute
 * proof a DM worked.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";

const RE_ENGAGE_WINDOW_MS = 72 * 3_600_000;
// .in() id batches — keeps PostgREST GET URLs well under length limits.
const ID_BATCH = 100;

interface TaskLite {
  id: string;
  template_id: string | null;
  student_id: string;
  status: "open" | "completed" | "dismissed";
  completed_at: string | null;
  outcome?: "replied" | "no_reply" | null;
}

interface CompletionLite {
  student_id: string;
  completed_at: string | null;
  action_completed_at: string | null;
}

interface TemplateStat {
  created: number;
  open: number;
  sent: number;
  dismissed: number;
  replied: number;
  no_reply: number;
  re_engaged_72h: number;
}

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  // tasks is a narrow queue table (no blob columns) — select * so this
  // route works both before and after the v85 outcome migration (an
  // explicit "outcome" in the select would 400 pre-migration).
  const { data: tasks, error: tasksError } =
    await fetchAllRowsPaginated<TaskLite>(() =>
      auth.supabase.from("tasks").select("*"),
    );
  if (tasksError) {
    return NextResponse.json({ error: tasksError.message }, { status: 500 });
  }

  const sentTasks = tasks.filter(
    (t) => t.status === "completed" && t.completed_at && t.student_id,
  );

  // Completion events (watch marks + action ships) for every student
  // who ever received a DM, server-filtered to >= the earliest send so
  // we never pull irrelevant history. Minimal columns, batched ids,
  // paginated pages (v75.27 discipline).
  const eventsByStudent = new Map<string, number[]>();
  if (sentTasks.length > 0) {
    let minSendIso = sentTasks[0].completed_at as string;
    for (const t of sentTasks) {
      if ((t.completed_at as string) < minSendIso) {
        minSendIso = t.completed_at as string;
      }
    }
    const studentIds = [...new Set(sentTasks.map((t) => t.student_id))];
    for (let i = 0; i < studentIds.length; i += ID_BATCH) {
      const batch = studentIds.slice(i, i + ID_BATCH);
      const { data: rows, error } =
        await fetchAllRowsPaginated<CompletionLite>(() =>
          auth.supabase
            .from("student_lesson_completions")
            .select("student_id, completed_at, action_completed_at")
            .in("student_id", batch)
            .or(
              `completed_at.gte.${minSendIso},action_completed_at.gte.${minSendIso}`,
            ),
        );
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      for (const r of rows) {
        const arr = eventsByStudent.get(r.student_id) ?? [];
        if (r.completed_at) arr.push(new Date(r.completed_at).getTime());
        if (r.action_completed_at) {
          arr.push(new Date(r.action_completed_at).getTime());
        }
        eventsByStudent.set(r.student_id, arr);
      }
    }
  }

  const stats: Record<string, TemplateStat> = {};
  const blank = (): TemplateStat => ({
    created: 0,
    open: 0,
    sent: 0,
    dismissed: 0,
    replied: 0,
    no_reply: 0,
    re_engaged_72h: 0,
  });

  for (const t of tasks) {
    if (!t.template_id) continue;
    const s = (stats[t.template_id] ??= blank());
    s.created++;
    if (t.status === "open") {
      s.open++;
    } else if (t.status === "completed") {
      s.sent++;
      if (t.outcome === "replied") s.replied++;
      else if (t.outcome === "no_reply") s.no_reply++;
      if (t.completed_at) {
        const sendMs = new Date(t.completed_at).getTime();
        const events = eventsByStudent.get(t.student_id) ?? [];
        if (
          events.some(
            (e) => e > sendMs && e <= sendMs + RE_ENGAGE_WINDOW_MS,
          )
        ) {
          s.re_engaged_72h++;
        }
      }
    } else if (t.status === "dismissed") {
      s.dismissed++;
    }
  }

  return NextResponse.json({
    stats,
    computed_at: new Date().toISOString(),
  });
}
