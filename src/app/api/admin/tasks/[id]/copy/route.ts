/**
 * POST /api/admin/tasks/:id/copy
 *
 * Called from the task queue UI after the rendered template has been
 * copied to the clipboard client-side. Marks the task completed and
 * stamps who closed it.
 *
 * No body required.
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

  const { data, error } = await auth.supabase
    .from("tasks")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by: auth.teamMember.id,
    })
    .eq("id", id)
    .eq("status", "open") // only transition from open
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
