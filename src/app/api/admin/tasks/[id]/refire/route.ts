/**
 * POST /api/admin/tasks/:id/refire — admin debug.
 *
 * Inserts a fresh open task for the same (student, scenario_id, template_id)
 * combo. Useful when a task was dismissed and Astrid wants to try again,
 * or when QA-ing the queue UI.
 *
 * Founder + admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;
  const { id } = await ctx.params;

  const { data: existing, error: fetchErr } = await auth.supabase
    .from("tasks")
    .select("student_id, scenario_id, template_id, behavior_summary")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const { data: inserted, error } = await auth.supabase
    .from("tasks")
    .insert({
      student_id: existing.student_id,
      scenario_id: existing.scenario_id,
      template_id: existing.template_id,
      behavior_summary: existing.behavior_summary,
      status: "open",
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation; the partial unique-when-open index
    // means an open task for this (student, scenario_id) already exists.
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "An open task already exists for this student + scenario" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ task: inserted });
}
