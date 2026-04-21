import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * V3 engagement cron: detect disengaged students and queue alerts for the team.
 * Simplified from V2 since we no longer have activation points or week buckets.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const alerts: { student_id: string; alert_type: string; message: string }[] = [];

  const { data: students } = await supabase
    .from("students")
    .select("*")
    .eq("membership_status", "active");

  if (!students || students.length === 0) {
    return NextResponse.json({ checked: 0, alerts: 0 });
  }

  const studentIds = students.map((s) => s.id);
  const { data: allCompletions } = await supabase
    .from("student_lesson_completions")
    .select("student_id, lesson_id, completed_at")
    .in("student_id", studentIds);

  // Build per-student completion data
  const completionsByStudent: Record<
    string,
    { lessonIds: Set<string>; latestAt: Date | null }
  > = {};
  for (const c of allCompletions || []) {
    if (!completionsByStudent[c.student_id]) {
      completionsByStudent[c.student_id] = {
        lessonIds: new Set(),
        latestAt: null,
      };
    }
    completionsByStudent[c.student_id].lessonIds.add(c.lesson_id);
    const cDate = new Date(c.completed_at);
    if (
      !completionsByStudent[c.student_id].latestAt ||
      cDate > completionsByStudent[c.student_id].latestAt!
    ) {
      completionsByStudent[c.student_id].latestAt = cDate;
    }
  }

  const { data: existingAlerts } = await supabase
    .from("disengagement_alerts")
    .select("student_id, alert_type")
    .eq("is_dismissed", false)
    .in("student_id", studentIds);

  const existingAlertSet = new Set(
    (existingAlerts || []).map((a) => `${a.student_id}:${a.alert_type}`)
  );

  for (const student of students) {
    const dayNumber = Math.max(
      1,
      Math.ceil(
        (now.getTime() - new Date(student.joined_at).getTime()) / 86400000
      )
    );
    const studentData = completionsByStudent[student.id];
    const completedLessonIds = studentData?.lessonIds || new Set();
    const latestCompletion = studentData?.latestAt;
    const lastActive = new Date(student.last_active_at);
    const daysSinceActive = Math.floor(
      (now.getTime() - lastActive.getTime()) / 86400000
    );

    // Alert: no lesson activity in 7 days
    if (latestCompletion) {
      const daysSinceCompletion = Math.floor(
        (now.getTime() - latestCompletion.getTime()) / 86400000
      );
      if (daysSinceCompletion >= 7) {
        const key = `${student.id}:no_tasks_7d`;
        if (!existingAlertSet.has(key)) {
          alerts.push({
            student_id: student.id,
            alert_type: "no_tasks_7d",
            message: `${student.name || "Student"} hasn't completed any lessons in ${daysSinceCompletion} days`,
          });
        }
      }
    } else if (dayNumber >= 7 && completedLessonIds.size === 0) {
      const key = `${student.id}:no_tasks_7d`;
      if (!existingAlertSet.has(key)) {
        alerts.push({
          student_id: student.id,
          alert_type: "no_tasks_7d",
          message: `${student.name || "Student"} has never completed any lessons (Day ${dayNumber})`,
        });
      }
    }

    // Alert: no login in 5 days
    if (daysSinceActive >= 5) {
      const key = `${student.id}:no_login_5d`;
      if (!existingAlertSet.has(key)) {
        alerts.push({
          student_id: student.id,
          alert_type: "no_login_5d",
          message: `${student.name || "Student"} hasn't been active for ${daysSinceActive} days`,
        });
      }
    }
  }

  if (alerts.length > 0) {
    const { error } = await supabase
      .from("disengagement_alerts")
      .insert(alerts);

    if (error) {
      console.error("Failed to insert alerts:", error);
    }
  }

  return NextResponse.json({
    checked: students.length,
    alerts: alerts.length,
  });
}
