/**
 * POST /api/admin/tasks/:id/dismiss
 *
 * Body: { notes: string }    — required, free-text reason
 *
 * Marks the task dismissed and stamps who dismissed it. The reason
 * goes into tasks.notes so we can audit why tasks get skipped (useful
 * signal for trigger quality).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;
  const { id } = await ctx.params;

  const body = await request.json().catch(() => null);
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

  if (!notes) {
    return NextResponse.json(
      { error: "notes is required when dismissing a task" },
      { status: 400 },
    );
  }

  const { data, error } = await auth.supabase
    .from("tasks")
    .update({
      status: "dismissed",
      dismissed_at: new Date().toISOString(),
      dismissed_by: auth.teamMember.id,
      notes,
    })
    .eq("id", id)
    .eq("status", "open")
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Task not found or not open" },
      { status: 404 },
    );
  }

  return NextResponse.json({ task: data });
}
