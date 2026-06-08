import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PLAYBOOK_UNLOCK_LESSON_ID } from "@/lib/constants";

/**
 * GET /api/student/cohort-stats
 *
 * Returns the calling student's rank among all finishers (students
 * who've completed l078, the Playbook-unlock lesson), plus the size
 * of the finisher cohort and the calling student's days_to_finish.
 *
 * Feeds the GraduationModal's "Cohort rank" stat that replaced
 * "Notes Written" in v75. Only meaningful for the student whose
 * graduation modal is firing - that's the one calling this endpoint
 * via the standard Bearer-token auth.
 *
 * Computation (single query against student_lesson_completions
 * joined to students for joined_at):
 *   1. Pull every (student_id, completed_at) row where lesson_id =
 *      'l078' AND completed_at IS NOT NULL.
 *   2. Join to students for joined_at + filter by ADMIN_STUDENT_JOIN
 *      _CUTOFF so pre-launch test rows don't pollute the rank.
 *   3. For each finisher compute days = (completed_at - joined_at) /
 *      86_400_000, rounded down.
 *   4. Sort ascending by days (fastest first); the caller's index +
 *      1 is their rank.
 *
 * Caller who hasn't finished l078 themselves gets days_to_finish:
 * null and their rank field is null too (the modal handles that
 * branch with a fallback stat).
 *
 * v75.5 - new.
 */
export async function GET(request: NextRequest) {
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

  const { data: callerStudent } = await supabase
    .from("students")
    .select("id, joined_at")
    .eq("supabase_user_id", user.id)
    .single();
  if (!callerStudent) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Pull every l078 completion + the joined_at of each completer.
  // Filter to post-launch cohort so pre-launch test accounts don't
  // skew the rank.
  const { data: rows, error: rowsError } = await supabase
    .from("student_lesson_completions")
    .select("student_id, completed_at, students!inner(joined_at, first_paid_at)")
    .eq("lesson_id", PLAYBOOK_UNLOCK_LESSON_ID)
    .not("completed_at", "is", null);
  if (rowsError) {
    return NextResponse.json({ error: rowsError.message }, { status: 500 });
  }

  type FinishRow = {
    student_id: string;
    completed_at: string;
    students: { joined_at: string; first_paid_at: string | null };
  };
  const finishers = (rows as unknown as FinishRow[])
    .map((r) => {
      // v75.20: anchor sprint duration on first_paid_at (true Day 1).
      const anchor = r.students.first_paid_at ?? r.students.joined_at;
      const joined = new Date(anchor).getTime();
      const finished = new Date(r.completed_at).getTime();
      const days = Math.max(0, Math.floor((finished - joined) / 86_400_000));
      return { student_id: r.student_id, days };
    })
    .sort((a, b) => a.days - b.days);

  const total = finishers.length;
  const callerIdx = finishers.findIndex(
    (f) => f.student_id === callerStudent.id,
  );
  const isFinisher = callerIdx >= 0;
  const callerDays = isFinisher ? finishers[callerIdx].days : null;
  const rank = isFinisher ? callerIdx + 1 : null;

  return NextResponse.json({
    rank,
    total,
    days_to_finish: callerDays,
    is_finisher: isFinisher,
  });
}
