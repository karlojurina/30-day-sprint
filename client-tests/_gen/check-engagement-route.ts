import { NextRequest, NextResponse } from "./stub-cron.ts";
import { createServiceClient } from "./supabase-server.ts";
import { postTeamAlert, buildAlertsEmbeds } from "./discord.ts";
import { isDmEnabled } from "./dm-toggles.ts";
import { PAYING_WHOP_PLAN_IDS_ARRAY } from "./metrics-definitions.ts";
import { csmSprintWindowCutoffIso } from "./constants.ts";
import {
  courseAnchorIso,
  daysOnCourse,
  getCurriculumResetAt,
} from "./curriculum-reset.ts";
import {
  verifyCronAuth,
  cronUnauthorizedResponse,
  logCronStart,
  logCronFinish,
} from "./cron-auth.ts";

// v75.32: raised from Vercel's 60s default. Per-student completion
// fetches in waves of 20 can take 30-60s as pool grows.
export const maxDuration = 300;

const ROUTE_NAME = "check-engagement";

// Ids per .in() read, as outreach-insights.ts reads them (ID_BATCH = 100).
const ID_BATCH = 100;

/**
 * V3 engagement cron: detect disengaged students and queue alerts for the team.
 * Simplified from V2 since we no longer have activation points or week buckets.
 *
 * V10 (2026-04-28): added `no_lessons_3d` (early-warning) plus a Discord
 * webhook post to DISCORD_TEAM_WEBHOOK_URL listing all NEW alerts
 * produced this run. Since 2026-10-20 (cron-1) the list goes out as one
 * message per embed, each within Discord's 4096 characters, and a post
 * that fails marks the run failed.
 */
export async function GET(request: NextRequest) {
  // v75.37: shared cron auth + audit.
  const auth = verifyCronAuth(request);
  if (!auth.ok) {
    await logCronStart(ROUTE_NAME, auth.reason);
    return cronUnauthorizedResponse(auth.reason);
  }
  const runId = await logCronStart(ROUTE_NAME, "ok");

  const supabase = createServiceClient();
  const now = new Date();
  const alerts: { student_id: string; alert_type: string; message: string }[] = [];

  // Cutover WI-3: the course switch's moment, null while the old course
  // is live. A failed read stops the run and shows in cron_runs:
  // guessing "no switch" would alert every student who paid before the
  // switch as "never completed" on the old clock.
  let resetAt: string | null;
  try {
    resetAt = await getCurriculumResetAt(supabase);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[check-engagement] reset read failed:", message);
    await logCronFinish(runId, "failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data: students, error: studentsErr } = await supabase
    .from("students")
    .select("*")
    .eq("membership_status", "active")
    // v79: skip free-plan members — they shouldn't trigger
    // engagement alerts or team-channel posts.
    .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[])
    // v75.18: filter on first_paid_at (original signup), not joined_at.
    // Stops legacy customers who recently renewed from leaking into
    // engagement alerts.
    .gte("first_paid_at", csmSprintWindowCutoffIso());

  if (studentsErr) {
    // v75.32: surface DB errors instead of returning {checked: 0}
    // like everything succeeded. Without this, a query error would
    // silently stop disengagement alerts for the day.
    console.error("[check-engagement] students fetch failed:", studentsErr);
    await logCronFinish(runId, "failed", { error: studentsErr.message });
    return NextResponse.json(
      { error: `Students fetch failed: ${studentsErr.message}` },
      { status: 500 },
    );
  }

  if (!students || students.length === 0) {
    await logCronFinish(runId, "success", { rowsAffected: 0 });
    return NextResponse.json({ checked: 0, alerts: 0 });
  }

  // v75.25: per-student fetch. Supabase has a project-level
  // max-rows cap (~1000) that silently truncates bulk fetches even
  // with .limit(). With 8000+ completions in the table, the bulk
  // .in(studentIds) query silently dropped most rows. Per-student
  // queries return ≤64 rows each (TOTAL_LESSONS cap) so they're
  // always under any server cap. 20-way parallelism keeps wall-clock
  // under 1s for the engagement pool.
  type EngagementCompletion = {
    student_id: string;
    lesson_id: string;
    completed_at: string | null;
    skipped_at: string | null;
  };
  const allCompletions: EngagementCompletion[] = [];
  const completionErrors: string[] = [];
  const CONCURRENT = 20;
  for (let i = 0; i < students.length && completionErrors.length === 0; i += CONCURRENT) {
    const wave = students.slice(i, i + CONCURRENT);
    await Promise.all(
      wave.map(async (s) => {
        const { data, error } = await supabase
          .from("student_lesson_completions")
          .select("student_id, lesson_id, completed_at, skipped_at")
          .eq("student_id", s.id);
        if (error) completionErrors.push(error.message);
        else if (data) allCompletions.push(...(data as EngagementCompletion[]));
      }),
    );
  }
  // A failed read stops the run before anything is written, and shows in
  // cron_runs: read as "no completions", it would alert a student who
  // watched lessons as never having started.
  if (completionErrors.length > 0) {
    const message = `Completions fetch failed: ${completionErrors[0]}`;
    console.error(`[check-engagement] ${message}`);
    await logCronFinish(runId, "failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }

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
    // v75.24: only count rows that satisfy canonical "done" — either
    // watched (completed_at) OR skipped (skipped_at). Skipped lessons
    // count toward "engagement" the same way the student profile
    // counts them.
    const isDone = Boolean(c.completed_at) || Boolean(c.skipped_at);
    if (!isDone) continue;
    completionsByStudent[c.student_id].lessonIds.add(c.lesson_id);
    // latestAt tracks watch activity specifically (for "no lessons
    // watched in 3d" detection) — skips don't qualify as fresh
    // platform activity for that signal.
    if (c.completed_at) {
      const cDate = new Date(c.completed_at);
      if (
        !completionsByStudent[c.student_id].latestAt ||
        cDate > completionsByStudent[c.student_id].latestAt!
      ) {
        completionsByStudent[c.student_id].latestAt = cDate;
      }
    }
  }

  // The open alerts, read in batches of ID_BATCH ids: one .in() list for
  // the whole pool makes a request URL past a gateway's limit at about
  // 200 students. A failed read stops the run: read as "no open alerts",
  // it would insert and post every live alert again, every run.
  const studentIds = students.map((s) => s.id);
  const existingAlertSet = new Set<string>();
  for (let i = 0; i < studentIds.length; i += ID_BATCH) {
    const { data: existingAlerts, error: alertsErr } = await supabase
      .from("disengagement_alerts")
      .select("student_id, alert_type")
      .eq("is_dismissed", false)
      .in("student_id", studentIds.slice(i, i + ID_BATCH));
    if (alertsErr) {
      const message = `Open alerts fetch failed: ${alertsErr.message}`;
      console.error(`[check-engagement] ${message}`);
      await logCronFinish(runId, "failed", { error: message });
      return NextResponse.json({ error: message }, { status: 500 });
    }
    for (const a of existingAlerts ?? []) {
      existingAlertSet.add(`${a.student_id}:${a.alert_type}`);
    }
  }

  for (const student of students) {
    // Cutover WI-3: Day N on the course, counted from the later of first
    // payment and the switch. With no switch this is the old formula
    // (first_paid_at ?? joined_at, max(1, ceil(days))). After it, the
    // "never completed" branches below start again from the switch for
    // a student who paid before it.
    const dayNumber = daysOnCourse(
      courseAnchorIso(student.first_paid_at ?? null, student.joined_at, resetAt),
      now.getTime(),
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
      } else if (daysSinceCompletion >= 3) {
        // Earlier-warning tier — flags slipping before the 7-day mark
        const key = `${student.id}:no_lessons_3d`;
        if (!existingAlertSet.has(key)) {
          alerts.push({
            student_id: student.id,
            alert_type: "no_lessons_3d",
            message: `${student.name || "Student"} hasn't completed a lesson in ${daysSinceCompletion} days (Day ${dayNumber})`,
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
    } else if (dayNumber >= 3 && completedLessonIds.size === 0) {
      // Brand-new student who hasn't started anything by day 3
      const key = `${student.id}:no_lessons_3d`;
      if (!existingAlertSet.has(key)) {
        alerts.push({
          student_id: student.id,
          alert_type: "no_lessons_3d",
          message: `${student.name || "Student"} still hasn't started (Day ${dayNumber})`,
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

  let discordOk: boolean | null = null;
  let discordReason: string | null = null;
  // Set when the toggle is on and a post did not go out.
  let discordFailure: string | null = null;
  if (alerts.length > 0) {
    const { error } = await supabase
      .from("disengagement_alerts")
      .insert(alerts);

    if (error) {
      console.error("Failed to insert alerts:", error);
    }

    // Post these new alerts to the team's Discord channel, one message
    // per embed: Discord refuses an embed over 4096 characters, which one
    // embed for every alert passed at about 22. Gated by /admin/discord
    // toggle; default off until launch. On the new course this post is
    // the only place the team sees no_login_5d and no_tasks_7d, and an
    // open alert is never sent again, so a post that fails marks the run
    // failed in cron_runs.
    if (await isDmEnabled(supabase, "engagement_alerts_enabled")) {
      const studentsById = new Map(students.map((s) => [s.id, s]));
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "https://30-day-sprint-smkv.vercel.app";
      const embeds = buildAlertsEmbeds(
        alerts.map((a) => ({
          studentId: a.student_id,
          studentName: studentsById.get(a.student_id)?.name ?? "Student",
          alertType: a.alert_type,
          message: a.message,
        })),
        baseUrl,
      );
      const failed: string[] = [];
      for (let i = 0; i < embeds.length; i++) {
        const result = await postTeamAlert([embeds[i]]);
        if (!result.ok) {
          failed.push(`part ${i + 1}: ${result.reason ?? "no reason given"}`);
        }
      }
      discordOk = failed.length === 0;
      if (failed.length > 0) {
        discordFailure = `${failed.length} of ${embeds.length} Discord posts not delivered (${failed.join("; ")})`;
        discordReason = discordFailure;
      }
    } else {
      discordOk = false;
      discordReason = "paused-by-toggle";
    }
  }

  await logCronFinish(runId, discordFailure ? "failed" : "success", {
    rowsAffected: alerts.length,
    error: discordFailure ?? undefined,
  });
  return NextResponse.json({
    checked: students.length,
    alerts: alerts.length,
    discord_posted: discordOk,
    discord_reason: discordReason,
  });
}
