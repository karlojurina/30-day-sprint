import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const alerts: { student_id: string; alert_type: string; message: string }[] = [];

  // Fetch all active students
  const { data: students } = await supabase
    .from("students")
    .select("*")
    .eq("membership_status", "active");

  if (!students || students.length === 0) {
    return NextResponse.json({ checked: 0, alerts: 0 });
  }

  // Fetch all completions for active students
  const studentIds = students.map((s) => s.id);
  const { data: allCompletions } = await supabase
    .from("student_task_completions")
    .select("student_id, task_id, completed_at")
    .in("student_id", studentIds);

  // Fetch tasks (for activation point checks)
  const { data: tasks } = await supabase.from("tasks").select("id, activation_point_id");

  const ap1TaskIds = new Set(
    (tasks || []).filter((t) => t.activation_point_id === "AP1").map((t) => t.id)
  );

  // Build per-student completion data
  const completionsByStudent: Record<string, { taskIds: Set<string>; latestAt: Date | null }> = {};
  for (const c of allCompletions || []) {
    if (!completionsByStudent[c.student_id]) {
      completionsByStudent[c.student_id] = { taskIds: new Set(), latestAt: null };
    }
    completionsByStudent[c.student_id].taskIds.add(c.task_id);
    const cDate = new Date(c.completed_at);
    if (!completionsByStudent[c.student_id].latestAt || cDate > completionsByStudent[c.student_id].latestAt!) {
      completionsByStudent[c.student_id].latestAt = cDate;
    }
  }

  // Fetch existing undismissed alerts to avoid duplicates
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
      Math.ceil((now.getTime() - new Date(student.joined_at).getTime()) / 86400000)
    );
    const studentData = completionsByStudent[student.id];
    const completedTaskIds = studentData?.taskIds || new Set();
    const latestCompletion = studentData?.latestAt;
    const lastActive = new Date(student.last_active_at);
    const daysSinceActive = Math.floor(
      (now.getTime() - lastActive.getTime()) / 86400000
    );

    // Check: no tasks in 7 days
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
            message: `${student.name || "Student"} hasn't completed any tasks in ${daysSinceCompletion} days`,
          });
        }
      }
    } else if (dayNumber >= 7 && completedTaskIds.size === 0) {
      // Never completed anything and it's been 7+ days
      const key = `${student.id}:no_tasks_7d`;
      if (!existingAlertSet.has(key)) {
        alerts.push({
          student_id: student.id,
          alert_type: "no_tasks_7d",
          message: `${student.name || "Student"} has never completed any tasks (Day ${dayNumber})`,
        });
      }
    }

    // Check: approaching day 14 with no AP1
    if (dayNumber >= 14) {
      const hasAP1 = [...completedTaskIds].some((id) => ap1TaskIds.has(id));
      if (!hasAP1) {
        const key = `${student.id}:no_activation_14d`;
        if (!existingAlertSet.has(key)) {
          alerts.push({
            student_id: student.id,
            alert_type: "no_activation_14d",
            message: `${student.name || "Student"} is on Day ${dayNumber} with no content engagement (AP1)`,
          });
        }
      }
    }

    // Check: no login in 5 days
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

    // Check: past day 8 with zero week 2 tasks
    if (dayNumber >= 8) {
      const week2TaskIds = (tasks || [])
        .filter((t) => t.id.startsWith("w2_"))
        .map((t) => t.id);
      const hasWeek2 = week2TaskIds.some((id) => completedTaskIds.has(id));
      if (!hasWeek2 && completedTaskIds.size > 0) {
        // Only alert if they've done some tasks but not started Week 2
        const key = `${student.id}:week2_no_start`;
        if (!existingAlertSet.has(key)) {
          alerts.push({
            student_id: student.id,
            alert_type: "week2_no_start",
            message: `${student.name || "Student"} is on Day ${dayNumber} but hasn't started Week 2`,
          });
        }
      }
    }
  }

  // Insert alerts
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
