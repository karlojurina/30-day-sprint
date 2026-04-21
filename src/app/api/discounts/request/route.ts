import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { DISCOUNT_WINDOW_DAYS } from "@/lib/constants";

/**
 * V4: Discount = complete ALL Region 1 + Region 2 lessons within
 * DISCOUNT_WINDOW_DAYS (14) of the student's Whop join date.
 * Measured server-side. No partial discount, no do-overs.
 */
export async function POST(request: NextRequest) {
  const { studentId } = await request.json();

  if (!studentId) {
    return NextResponse.json({ error: "Missing studentId" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Duplicate check
  const { data: existing } = await supabase
    .from("discount_requests")
    .select("id, status")
    .eq("student_id", studentId)
    .in("status", ["pending", "approved"])
    .limit(1)
    .single();

  if (existing) {
    return NextResponse.json(
      { error: "You already have a discount request" },
      { status: 400 }
    );
  }

  // Student join date (from Whop membership, set at OAuth)
  const { data: student } = await supabase
    .from("students")
    .select("joined_at")
    .eq("id", studentId)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const joinedAt = new Date(student.joined_at);
  const deadline = new Date(
    joinedAt.getTime() + DISCOUNT_WINDOW_DAYS * 86_400_000
  );
  const now = new Date();

  if (now > deadline) {
    return NextResponse.json(
      {
        error: `The discount window closed ${Math.floor(
          (now.getTime() - deadline.getTime()) / 86_400_000
        )} days ago. The 30% is only for students who finish R1 + R2 inside the first ${DISCOUNT_WINDOW_DAYS} days.`,
      },
      { status: 400 }
    );
  }

  // Eligibility: every lesson in R1 + R2 must be complete
  const [{ data: requiredLessons }, { data: completions }] = await Promise.all(
    [
      supabase
        .from("lessons")
        .select("id")
        .in("region_id", ["r1", "r2"]),
      supabase
        .from("student_lesson_completions")
        .select("lesson_id, completed_at")
        .eq("student_id", studentId),
    ]
  );

  const requiredIds = new Set((requiredLessons ?? []).map((l) => l.id));
  const completionMap = new Map<string, string>();
  for (const c of completions ?? []) {
    completionMap.set(c.lesson_id, c.completed_at);
  }

  const missing: string[] = [];
  let latestCompletion = joinedAt;
  for (const id of requiredIds) {
    const at = completionMap.get(id);
    if (!at) {
      missing.push(id);
      continue;
    }
    const d = new Date(at);
    if (d > latestCompletion) latestCompletion = d;
  }

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `Not yet eligible — ${requiredIds.size - missing.length}/${requiredIds.size} required lessons complete.`,
      },
      { status: 400 }
    );
  }

  // All R1+R2 lessons done — but did they finish them inside the window?
  if (latestCompletion > deadline) {
    return NextResponse.json(
      {
        error: `You finished after the ${DISCOUNT_WINDOW_DAYS}-day window. The 30% is only for students who complete R1 + R2 within the first ${DISCOUNT_WINDOW_DAYS} days.`,
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("discount_requests")
    .insert({ student_id: studentId })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create request" }, { status: 500 });
  }

  return NextResponse.json(data);
}
