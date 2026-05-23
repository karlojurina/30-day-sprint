/**
 * GET /api/admin/tasks — list tasks with optional filters.
 *
 * Query params:
 *   ?status=open|completed|dismissed|all   (default: open)
 *   ?bucket=at_risk|crushing|...
 *   ?week=W1|W2|W3|W4|D1|X
 *   ?student=<search>                       case-insensitive substring against
 *                                           student name / email / discord_username
 *   ?limit=N                                page size (default 100, max 500)
 *
 * Returns each task joined with its student row + template metadata so
 * the queue can render avatar / discord username / scenario title without
 * a second roundtrip.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { TASKS_STUDENT_JOIN_CUTOFF } from "@/lib/constants";

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "open";
  const bucket = url.searchParams.get("bucket");
  const week = url.searchParams.get("week");
  const studentSearch = url.searchParams.get("student")?.trim();
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1),
    500,
  );

  let q = auth.supabase
    .from("tasks")
    .select(
      `
      *,
      student:students!inner(*),
      template:templates(scenario_id, bucket, week, title, body, is_admin_only, variables, word_count)
    `,
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status !== "all") q = q.eq("status", status);

  // Hide tasks for csm_exempt accounts (team's own dummy students)
  // and pre-launch joiners — only show tasks for students who
  // joined on/after the dedicated tasks cutoff. Decoupled from the
  // wider ADMIN cutoff so we can launch CSM later than the rest.
  q = q
    .eq("student.csm_exempt", false)
    .gte("student.joined_at", TASKS_STUDENT_JOIN_CUTOFF);

  // Bucket/week filters apply to the joined template — Supabase supports
  // filtering on FK columns via the `template.column` path.
  if (bucket) q = q.eq("template.bucket", bucket);
  if (week) q = q.eq("template.week", week);

  if (studentSearch && studentSearch.length > 0) {
    // Match name / email / discord_username on the joined student row.
    const term = studentSearch.replace(/[%_]/g, "");
    q = q.or(
      [
        `name.ilike.%${term}%`,
        `email.ilike.%${term}%`,
        `discord_username.ilike.%${term}%`,
      ].join(","),
      { foreignTable: "student" },
    );
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // v59 - always drop tasks whose template is null. Two cases produce
  // these:
  //   1. The task pointed at a template that's since been deleted
  //      (ON DELETE SET NULL on tasks.template_id). v57 leaving the
  //      W-series template-id-nulled tasks behind was the trigger
  //      for this.
  //   2. A bucket/week filter is applied and this task's template
  //      doesn't match. Same outcome - render nothing.
  // Either way, a "(no template)" task is noise - Astrid has nothing
  // to copy.
  const tasks = (data ?? []).filter((t) =>
    Boolean((t as { template?: unknown }).template),
  );

  return NextResponse.json({ tasks });
}
