import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { DISCOUNT_GATE_LESSON_ID } from "@/lib/constants";

/**
 * V3: Discount eligibility = the gate lesson (l18) is complete.
 * The gate lesson is the final action item of Region 2 (Creative Lab).
 */
export async function POST(request: NextRequest) {
  const { studentId } = await request.json();

  if (!studentId) {
    return NextResponse.json({ error: "Missing studentId" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Check if student already has a pending/approved request
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

  // Verify eligibility: gate lesson must be complete
  const { data: gateCompletion } = await supabase
    .from("student_lesson_completions")
    .select("id")
    .eq("student_id", studentId)
    .eq("lesson_id", DISCOUNT_GATE_LESSON_ID)
    .single();

  if (!gateCompletion) {
    return NextResponse.json(
      { error: "Discount gate lesson not completed yet" },
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
