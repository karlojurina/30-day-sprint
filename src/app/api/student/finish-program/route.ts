/**
 * POST /api/student/finish-program
 *
 * Fires when the student clicks "Finish Program" on the l058 sheet
 * after marking the lesson complete. Per lovro-brief-v2/02-triggers.md
 * trigger 2b, this is the moment that flips Map 2 on as the default
 * surface for the student — single-use, no external side effects.
 *
 * What it does:
 *   1. Sets student_milestones.sprint_completed_at = now() (NULL guard
 *      so a duplicate click is idempotent).
 *   2. Returns the new timestamp.
 *
 * v46 — sprint_completed_at lives on student_milestones, not students.
 * See CLAUDE.md → "Table-level bounded contexts".
 *
 * No Discord side effects. No DMs. No admin notification. The
 * Map 1 → Map 2 transition is purely client-driven.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("supabase_user_id", user.id)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Read existing milestones to honor idempotency.
  const { data: existingMs } = await supabase
    .from("student_milestones")
    .select("sprint_completed_at")
    .eq("student_id", student.id)
    .maybeSingle();

  if (existingMs?.sprint_completed_at) {
    return NextResponse.json({
      ok: true,
      already_finished: true,
      sprint_completed_at: existingMs.sprint_completed_at,
    });
  }

  const finishedAt = new Date().toISOString();
  const { data: upserted, error: upsertError } = await supabase
    .from("student_milestones")
    .upsert(
      {
        student_id: student.id,
        sprint_completed_at: finishedAt,
        updated_at: finishedAt,
      },
      { onConflict: "student_id" },
    )
    .select("sprint_completed_at")
    .single();

  if (upsertError || !upserted) {
    return NextResponse.json(
      { error: "Failed to finish program" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    already_finished: false,
    sprint_completed_at: upserted.sprint_completed_at,
  });
}
