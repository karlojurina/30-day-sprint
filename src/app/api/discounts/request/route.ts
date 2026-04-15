import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

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

  // Verify eligibility
  const { data: discountTasks } = await supabase
    .from("tasks")
    .select("id")
    .eq("is_discount_required", true);

  const taskIds = (discountTasks || []).map((t) => t.id);

  const { count } = await supabase
    .from("student_task_completions")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .in("task_id", taskIds);

  if ((count || 0) < 13) {
    return NextResponse.json(
      { error: "Not all required tasks are completed" },
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
