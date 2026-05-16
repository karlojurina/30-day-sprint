/**
 * POST /api/admin/tasks/:id/transition
 *
 * Body: { to: "open" | "completed" | "dismissed", notes?: string }
 *
 * Manually moves a task between columns. Used by the Kanban's
 * "Mark sent", "Dismiss", and "Move to To do" buttons.
 *
 * Notes are required when transitioning to dismissed (matches
 * /dismiss endpoint behavior). The dedicated /dismiss + /copy
 * endpoints stay around for back-compat but the Kanban now uses
 * this single endpoint.
 *
 * Stamps the matching {completed,dismissed}_{at,by} columns and
 * clears the opposite column's stamps when reopening.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type Target = "open" | "completed" | "dismissed";

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;
  const { id } = await ctx.params;

  const body = await request.json().catch(() => null);
  const to = body?.to as Target | undefined;
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

  if (!to || !["open", "completed", "dismissed"].includes(to)) {
    return NextResponse.json(
      { error: "Invalid target status" },
      { status: 400 },
    );
  }
  if (to === "dismissed" && !notes) {
    return NextResponse.json(
      { error: "notes is required when dismissing" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const teamId = auth.teamMember.id;

  const update: Record<string, unknown> = { status: to };
  if (to === "completed") {
    update.completed_at = now;
    update.completed_by = teamId;
    update.dismissed_at = null;
    update.dismissed_by = null;
  } else if (to === "dismissed") {
    update.dismissed_at = now;
    update.dismissed_by = teamId;
    update.notes = notes;
    update.completed_at = null;
    update.completed_by = null;
  } else {
    // Reopening — clear both timestamps.
    update.completed_at = null;
    update.completed_by = null;
    update.dismissed_at = null;
    update.dismissed_by = null;
    update.notes = null;
  }

  const { data, error } = await auth.supabase
    .from("tasks")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    // 23505 = unique_violation; reopening when an open task for this
    // (student, scenario) already exists.
    if ((error as { code?: string } | null)?.code === "23505") {
      return NextResponse.json(
        {
          error:
            "Another open task for this student + scenario already exists. Dismiss that one first.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error?.message ?? "Task not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ task: data });
}
