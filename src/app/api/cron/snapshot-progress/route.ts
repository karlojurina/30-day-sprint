/**
 * Nightly average-progress snapshot — runs at 00:30 UTC daily.
 *
 * Writes one row into daily_progress_snapshots for today's date:
 *   active_students   — students with membership_status = 'active'
 *   total_completions — completed lessons across those students (today)
 *   avg_progress      — total_completions / (active × total_lessons) × 100
 *
 * Idempotent via the snapshot_date primary key — re-running just keeps
 * the existing row.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const [{ count: lessonCount }, { data: activeStudents }] = await Promise.all([
    supabase.from("lessons").select("id", { count: "exact", head: true }),
    supabase
      .from("students")
      .select("id")
      .eq("membership_status", "active"),
  ]);

  const totalLessons = lessonCount ?? 0;
  const studentCount = activeStudents?.length ?? 0;

  let totalCompletions = 0;
  if (studentCount > 0) {
    const { count: cc } = await supabase
      .from("student_lesson_completions")
      .select("id", { count: "exact", head: true })
      .in("student_id", activeStudents!.map((s) => s.id))
      .not("completed_at", "is", null);
    totalCompletions = cc ?? 0;
  }

  const avg =
    studentCount > 0 && totalLessons > 0
      ? Math.round(((totalCompletions / (studentCount * totalLessons)) * 100) * 100) / 100
      : 0;

  const { error } = await supabase
    .from("daily_progress_snapshots")
    .upsert(
      {
        snapshot_date: today,
        active_students: studentCount,
        total_completions: totalCompletions,
        avg_progress: avg,
      },
      { onConflict: "snapshot_date" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    snapshot_date: today,
    active_students: studentCount,
    total_completions: totalCompletions,
    avg_progress: avg,
  });
}
