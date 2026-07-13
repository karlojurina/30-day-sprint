/**
 * POST /api/admin/tasks/:id/outcome
 *
 * Body: { outcome: "replied" | "no_reply" | null }
 *
 * Phase 0 of the retention overhaul: one-tap reply tracking on sent
 * tasks (/admin/tasks Sent tab). Null clears a previous tap. Only
 * valid on status='completed' rows — an outcome describes a DM that
 * was actually sent.
 *
 * Requires the v85 migration (tasks.outcome / outcome_at / outcome_by).
 * Pre-migration writes fail with a self-explaining 400.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import type { TaskOutcome } from "@/types/database";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;
  const { id } = await ctx.params;

  const body = await request.json().catch(() => null);
  const outcome = body?.outcome as TaskOutcome | null | undefined;

  if (outcome !== null && outcome !== "replied" && outcome !== "no_reply") {
    return NextResponse.json(
      { error: 'outcome must be "replied", "no_reply", or null' },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const update = {
    outcome,
    outcome_at: outcome ? now : null,
    outcome_by: outcome ? auth.teamMember.id : null,
  };

  const { data, error } = await auth.supabase
    .from("tasks")
    .update(update)
    .eq("id", id)
    .eq("status", "completed")
    .select()
    .single();

  if (error || !data) {
    // PGRST204 = column missing from PostgREST schema cache; 42703 =
    // undefined column at the PG layer. Both mean v85 isn't applied.
    const code = (error as { code?: string } | null)?.code;
    if (code === "PGRST204" || code === "42703") {
      return NextResponse.json(
        {
          error:
            "Outcome columns don't exist yet — apply supabase/migrations/2026_v85_task_outcomes.sql, then retry.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: error?.message ?? "Task not found or not in Sent" },
      { status: 404 },
    );
  }

  return NextResponse.json({ task: data });
}
