import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/student/celebration-seen
 *
 * One endpoint that handles all the celebration "I saw it" stamps so
 * we don't proliferate routes. Body shape:
 *   { kind: "region", regionId: "r1" }       → push regionId into celebrated_region_ids
 *   { kind: "streak", milestone: 7|14|30 }   → set last_streak_milestone_shown = milestone
 *   { kind: "month_review" }                  → set month_review_seen_at = now()
 *
 * v46 — celebration state lives on student_celebrations (was on students).
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const body = await request.json();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Look up the student id via supabase_user_id
  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("supabase_user_id", user.id)
    .single();
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const { data: celebrations } = await supabase
    .from("student_celebrations")
    .select("celebrated_region_ids, last_streak_milestone_shown")
    .eq("student_id", student.id)
    .maybeSingle();

  const nowIso = new Date().toISOString();

  if (body.kind === "region" && typeof body.regionId === "string") {
    const current = (celebrations?.celebrated_region_ids as string[]) ?? [];
    if (current.includes(body.regionId)) {
      return NextResponse.json({ ok: true, alreadyMarked: true });
    }
    const next = [...current, body.regionId];
    const { error } = await supabase
      .from("student_celebrations")
      .upsert(
        {
          student_id: student.id,
          celebrated_region_ids: next,
          updated_at: nowIso,
        },
        { onConflict: "student_id" },
      );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (
    body.kind === "streak" &&
    [7, 14, 30].includes(body.milestone as number)
  ) {
    if ((celebrations?.last_streak_milestone_shown ?? 0) >= body.milestone) {
      return NextResponse.json({ ok: true, alreadyMarked: true });
    }
    const { error } = await supabase
      .from("student_celebrations")
      .upsert(
        {
          student_id: student.id,
          last_streak_milestone_shown: body.milestone,
          updated_at: nowIso,
        },
        { onConflict: "student_id" },
      );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.kind === "month_review") {
    const { error } = await supabase
      .from("student_celebrations")
      .upsert(
        {
          student_id: student.id,
          month_review_seen_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "student_id" },
      );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
}
