/**
 * GET /api/admin/tasks — list tasks with optional filters.
 *
 * Query params:
 *   ?status=open|completed|dismissed|all   (default: open)
 *   ?bucket=at_risk|crushing|...
 *   ?week=W1|W2|W3|W4|D1|X
 *   ?student=<search>                       case-insensitive substring against
 *                                           student name / email / discord_username
 *   ?limit=N                                cap on the Sent (completed) and
 *                                           Dismissed lists (default 100, max 500)
 *
 * Open tasks are read in full, page by page past PostgREST's row cap: the
 * queue is the only place a task is sent or dismissed, so none may fall off
 * it. Sent and Dismissed keep the cap, newest first by when they were sent
 * or dismissed. Until fix lane G1 (admin-5) one capped read of every status
 * held them all, so once 500 newer tasks of any status existed, an older
 * open task left To do and every tab count stopped at 500.
 *
 * Returns { tasks, counts }: each task joined with its student row +
 * template metadata so the queue can render avatar / discord username /
 * scenario title without a second roundtrip, and the exact number of open,
 * completed and dismissed tasks (head count queries, same filters) for the
 * tabs.
 */

import { NextRequest, NextResponse } from "./stub-server.ts";
import { requireTeam, isAuthFailure } from "./stub-admin.ts";
import { TASKS_STUDENT_JOIN_CUTOFF } from "./constants.ts";
import { fetchAllRowsPaginated } from "./supabase-pagination.ts";

const STATUSES = ["open", "completed", "dismissed"] as const;

const TASK_COLUMNS = `
      *,
      student:students!inner(*),
      template:templates!inner(scenario_id, bucket, week, title, body, is_admin_only, variables, word_count)
    `;
/** For the counts: the joins only, so their filters apply. */
const COUNT_COLUMNS = "id, student:students!inner(id), template:templates!inner(id)";

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

  /**
   * Every filter is in the query itself, before any limit and in every
   * count:
   *   - A task needs a template. One without has nothing to copy: its
   *     template was deleted (tasks.template_id is ON DELETE SET NULL), or
   *     it is a support record the admin rebuild writes (scenario
   *     "support.*", no template, completed or dismissed). Filtered here it
   *     never takes a slot under the limit or a count. `templates!inner`
   *     also makes a bucket or week filter drop the task, where a plain
   *     join only blanked its template.
   *   - Tasks of csm_exempt accounts (the team's own dummy students) and of
   *     pre-launch joiners are hidden: only students who joined on/after the
   *     dedicated tasks cutoff (decoupled from the wider ADMIN cutoff so CSM
   *     could launch later). v75.18: filter on first_paid_at (original
   *     signup).
   */
  const tasksQuery = (columns: string, head = false) => {
    let q = auth.supabase
      .from("tasks")
      .select(columns, head ? { count: "exact", head: true } : undefined)
      .not("template_id", "is", null)
      .eq("student.csm_exempt", false)
      .gte("student.first_paid_at", TASKS_STUDENT_JOIN_CUTOFF);
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
    return q;
  };

  const wanted = STATUSES.filter((s) => status === "all" || s === status);
  const [lists, countAnswers] = await Promise.all([
    Promise.all(
      wanted.map((s) =>
        s === "open"
          ? // Every open task, in a stable order for the paging.
            fetchAllRowsPaginated<Record<string, unknown>>(() =>
              tasksQuery(TASK_COLUMNS)
                .eq("status", "open")
                .order("created_at")
                .order("id"),
            )
          : tasksQuery(TASK_COLUMNS)
              .eq("status", s)
              .order(s === "completed" ? "completed_at" : "dismissed_at", {
                ascending: false,
                nullsFirst: false,
              })
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .limit(limit),
      ),
    ),
    Promise.all(
      STATUSES.map((s) => tasksQuery(COUNT_COLUMNS, true).eq("status", s)),
    ),
  ]);

  const failed = [...lists, ...countAnswers].find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }
  if (countAnswers.some((r) => typeof r.count !== "number")) {
    return NextResponse.json(
      { error: "Couldn't count the tasks. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    tasks: lists.flatMap((r) => (r.data ?? []) as Record<string, unknown>[]),
    counts: {
      open: countAnswers[0].count,
      completed: countAnswers[1].count,
      dismissed: countAnswers[2].count,
    },
  });
}
