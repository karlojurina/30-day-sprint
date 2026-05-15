/**
 * GET /api/admin/tasks/:id — single task joined with student + template,
 * plus the body pre-rendered with this student's variables substituted.
 *
 * Response shape:
 *   {
 *     task,
 *     student,
 *     template,
 *     rendered: { body, unresolved },
 *     config: { astrid_booking_link, program_login_link, karlo_walkthrough_video_link }
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { renderTemplate, loadAdminConfig } from "@/lib/templates";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;
  const { id } = await ctx.params;

  const { data, error } = await auth.supabase
    .from("tasks")
    .select(
      `*,
       student:students(*),
       template:templates(*)`,
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const config = await loadAdminConfig(auth.supabase);

  type JoinedRow = {
    student: { name: string | null; joined_at: string } | null;
    template: { body: string } | null;
  };
  const joined = data as unknown as JoinedRow;

  let rendered: { body: string; unresolved: string[] } = {
    body: "",
    unresolved: [],
  };
  if (joined.template && joined.student) {
    rendered = renderTemplate(joined.template.body, {
      student: {
        name: joined.student.name,
        joined_at: joined.student.joined_at,
      },
      config,
    });
  }

  return NextResponse.json({
    task: data,
    rendered,
    config,
  });
}
