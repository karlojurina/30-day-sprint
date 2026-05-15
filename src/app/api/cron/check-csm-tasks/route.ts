/**
 * Daily CSM tasks cron — runs at 09:15 UTC, 15 minutes after the
 * existing engagement cron at 09:00.
 *
 * P0 scope: convert the 4 existing-alert scenarios produced by
 * /api/cron/check-engagement into rows in `tasks`:
 *
 *   no_login_5d   + day  ≤ 7  → W1.4
 *   no_lessons_7d + day  8–14 → W2.7   (intersected with no_login_5d)
 *   no_login_5d   + day  8–14 → W2.7
 *   no_lessons_7d + day 15–23 → W3.3
 *   no_login_5d   + day 24–30 → W4.3
 *
 * The 5th existing-alert scenario (W4.4 — churned) doesn't fire from
 * disengagement_alerts; it fires from the Whop membership.deactivated
 * webhook. See src/app/api/webhooks/whop/route.ts.
 *
 * New-trigger and event-driven scenarios (W1.1–3, W1.2, W2.1–6, W3.1–2,
 * W4.1–2, X.1) are P1 and not in this cron yet.
 *
 * Dedupe: insert relies on the partial unique index
 *   idx_tasks_unique_open ON tasks(student_id, scenario_id) WHERE status = 'open'
 * so re-running the cron is a no-op for open tasks. Errors with code
 * 23505 are swallowed.
 *
 * Notify: at end, post a single summary embed to the team Discord
 * webhook with the count of new tasks per bucket and a link to /admin/tasks.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { postTeamAlert } from "@/lib/discord";

interface AlertRow {
  id: string;
  student_id: string;
  alert_type: string;
  message: string;
  created_at: string;
}

interface StudentSlim {
  id: string;
  name: string | null;
  joined_at: string;
  membership_status: string;
  discord_username: string | null;
}

function dayNumber(joinedAt: string): number {
  return Math.max(
    1,
    Math.ceil((Date.now() - new Date(joinedAt).getTime()) / 86_400_000),
  );
}

/**
 * Pick the right CSM scenario for an existing disengagement alert
 * based on the student's day window.
 */
function pickScenario(alertType: string, day: number): string | null {
  if (alertType === "no_login_5d") {
    if (day <= 7) return "W1.4";
    if (day <= 14) return "W2.7";
    if (day <= 23) return null; // no W3 cancel-path from login alone
    if (day <= 30) return "W4.3";
    return null;
  }
  if (alertType === "no_lessons_7d") {
    if (day >= 8 && day <= 14) return "W2.7";
    if (day >= 15 && day <= 23) return "W3.3";
    return null;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // 1. Pull open alerts produced anytime in the last 24 hours.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: alertsData, error: alertsErr } = await supabase
    .from("disengagement_alerts")
    .select("id, student_id, alert_type, message, created_at")
    .eq("is_dismissed", false)
    .gte("created_at", since);
  if (alertsErr) {
    return NextResponse.json({ error: alertsErr.message }, { status: 500 });
  }
  const alerts = (alertsData ?? []) as AlertRow[];

  if (alerts.length === 0) {
    return NextResponse.json({ alerts_seen: 0, tasks_created: 0 });
  }

  // 2. Hydrate the student rows for these alerts.
  const studentIds = Array.from(new Set(alerts.map((a) => a.student_id)));
  const { data: studentsData } = await supabase
    .from("students")
    .select("id, name, joined_at, membership_status, discord_username")
    .in("id", studentIds);
  const students = new Map<string, StudentSlim>(
    ((studentsData as StudentSlim[] | null) ?? []).map((s) => [s.id, s]),
  );

  // 3. Pull template ids keyed by scenario_id so we can attach them.
  const { data: templatesData } = await supabase
    .from("templates")
    .select("id, scenario_id")
    .in("scenario_id", ["W1.4", "W2.7", "W3.3", "W4.3"]);
  const templateBy = new Map<string, string>(
    (templatesData ?? []).map((t: { id: string; scenario_id: string }) => [
      t.scenario_id,
      t.id,
    ]),
  );

  // 4. For each alert, figure out the matching scenario + create a task
  //    (skip if not active, skip if no scenario maps).
  let createdCount = 0;
  const perBucket: Record<string, number> = {};

  for (const alert of alerts) {
    const student = students.get(alert.student_id);
    if (!student) continue;
    if (student.membership_status !== "active") continue;

    const day = dayNumber(student.joined_at);
    const scenarioId = pickScenario(alert.alert_type, day);
    if (!scenarioId) continue;
    const templateId = templateBy.get(scenarioId);
    if (!templateId) continue;

    // Concrete behavior summary for the card.
    const behaviorSummary = `Day ${day} · alert "${alert.alert_type}" · ${alert.message}`;

    const { error } = await supabase.from("tasks").insert({
      student_id: student.id,
      scenario_id: scenarioId,
      template_id: templateId,
      status: "open",
      behavior_summary: behaviorSummary,
    });

    if (error) {
      // 23505 = unique_violation from idx_tasks_unique_open — already an
      // open task for this (student, scenario). Skip silently.
      if ((error as { code?: string }).code !== "23505") {
        console.error(
          `[csm-tasks-cron] insert failed for student ${student.id} scenario ${scenarioId}:`,
          error,
        );
      }
      continue;
    }

    createdCount++;
    const bucket =
      scenarioId === "W1.4"
        ? "cancel_path"
        : scenarioId === "W2.7"
          ? "cancel_path"
          : scenarioId === "W3.3"
            ? "cancel_path"
            : "cancel_path"; // W4.3
    perBucket[bucket] = (perBucket[bucket] ?? 0) + 1;
  }

  // 5. Post a single team-channel embed if we created anything.
  let discordPosted: boolean | null = null;
  if (createdCount > 0) {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      "https://30-day-sprint-smkv.vercel.app";
    const lines = Object.entries(perBucket).map(
      ([bucket, count]) => `• ${count} ${bucket.replace("_", " ")}`,
    );
    const result = await postTeamAlert([
      {
        title: "📋 Astrid Task Queue update",
        description:
          `**${createdCount}** new task${createdCount === 1 ? "" : "s"} today:\n` +
          `${lines.join("\n")}\n\n→ ${baseUrl}/admin/tasks`,
      },
    ]);
    discordPosted = result.ok;
  }

  return NextResponse.json({
    alerts_seen: alerts.length,
    tasks_created: createdCount,
    discord_posted: discordPosted,
  });
}
