
import { NextRequest, NextResponse } from "./stub-cron.ts";
import { createServiceClient } from "./supabase-server.ts";
import { fetchAllRowsPaginated } from "./supabase-pagination.ts";
import { postTeamAlert } from "./discord.ts";
import {
  verifyCronAuth,
  cronUnauthorizedResponse,
  logCronStart,
  logCronFinish,
} from "./cron-auth.ts";
import { isDmEnabled } from "./dm-toggles.ts";
import {
  buildStudentSnapshot,
  triggers,
  evaluateCustomTrigger,
  snapshotIsCanceling,
  alertTask,
  SCENARIO_BUCKET,
} from "./csm-triggers.ts";
import {
  TASKS_STUDENT_JOIN_CUTOFF,
  csmSprintWindowCutoffIso,
  sprintDayNumber,
} from "./constants.ts";
import { getCurriculumResetAt } from "./curriculum-reset.ts";
import { PAYING_WHOP_PLAN_IDS_ARRAY } from "./metrics-definitions.ts";
import { discountWindowOpen } from "./discount.ts";
import {
  HAD_TASKS_FILTER,
  THIRTY_APPLIED_STATUSES,
  WHOP_WATCHER,
  messagesHad,
  type QueueTask,
} from "./dm-queue.ts";
import type { Student, TriggerConfig } from "./types-erased.ts";

export const maxDuration = 300;

const ALERT_LABEL: Record<string, string> = {
  no_login_5d: "no platform login in 5 days",
  no_lessons_7d: "no lessons completed in 7 days",
};

interface AlertRow {
  id: string;
  student_id: string;
  alert_type: string;
  message: string;
  created_at: string;
}


function priorityFor(bucket: string): number {
  if (bucket === "cancel_path") return 1;
  if (bucket === "at_risk") return 2;
  return 99;
}


const ROUTE_NAME = "check-csm-tasks";

export async function GET(request: NextRequest) {
  const auth = verifyCronAuth(request);
  if (!auth.ok) {
    await logCronStart(ROUTE_NAME, auth.reason);
    return cronUnauthorizedResponse(auth.reason);
  }
  const runId = await logCronStart(ROUTE_NAME, "ok");

  const supabase = createServiceClient();

  let resetAt: string | null;
  try {
    resetAt = await getCurriculumResetAt(supabase);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logCronFinish(runId, "failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }


  const [
    studentsRes,
    lessonsRes,
    tasksRes,
    templatesRes,
    alertsRes,
    milestonesRes,
    regionsRes,
  ] = await Promise.all([
    supabase
      .from("students")
      .select(
        "id, name, joined_at, first_paid_at, membership_status, last_active_at, discord_username, cancel_scheduled_at",
      )
      .eq("membership_status", "active")
      .eq("csm_exempt", false)
      .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[])
      .gte("first_paid_at", TASKS_STUDENT_JOIN_CUTOFF)
      .gte("first_paid_at", csmSprintWindowCutoffIso()),
    supabase
      .from("lessons")
      .select("id, region_id, requires_action, counts_toward_progress"),
    fetchAllRowsPaginated<QueueTask>(() =>
      supabase
        .from("tasks")
        .select("student_id, scenario_id, status, dismissed_by")
        .or(HAD_TASKS_FILTER)
        .order("id"),
    ),
    supabase
      .from("templates")
      .select(
        "id, scenario_id, bucket, is_custom, is_active, is_admin_only, trigger_config",
      )
      .limit(1000),
    supabase
      .from("disengagement_alerts")
      .select("id, student_id, alert_type, message, created_at")
      .eq("is_dismissed", false)
      .gte(
        "created_at",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      )
      .limit(10000),
    fetchAllRowsPaginated<{
      student_id: string;
      first_sprint_login_at: string | null;
    }>(() =>
      supabase
        .from("student_milestones")
        .select("student_id, first_sprint_login_at")
        .order("student_id"),
    ),
    supabase.from("regions").select("id, order_num").order("order_num"),
  ]);

  const studentsErr =
    studentsRes.error ??
    lessonsRes.error ??
    templatesRes.error ??
    tasksRes.error ??
    milestonesRes.error ??
    regionsRes.error;
  if (studentsErr) {
    await logCronFinish(runId, "failed", { error: studentsErr.message });
    return NextResponse.json({ error: studentsErr.message }, { status: 500 });
  }

  const regionOrder = ((regionsRes.data ?? []) as Array<{ id: string }>).map(
    (r) => r.id,
  );
  if (regionOrder.length === 0) {
    const message = "regions returned no rows; no student was judged";
    await logCronFinish(runId, "failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const course = { regionOrder, resetAt };

  const students = (studentsRes.data ?? []) as Student[];
  const lessons = lessonsRes.data ?? [];
  const hadTasks = tasksRes.data ?? [];
  const existingTasks = hadTasks.filter(
    (t) => t.status === "open" || t.status === "completed",
  );
  const templates = templatesRes.data ?? [];
  const alerts = (alertsRes.data ?? []) as AlertRow[];

  if (students.length === 0) {
    await logCronFinish(runId, "success", { rowsAffected: 0 });
    return NextResponse.json({ checked: 0, tasks_created: 0 });
  }

  type CompletionRow = {
    student_id: string;
    lesson_id: string;
    completed_at: string | null;
    action_completed_at: string | null;
    skipped_at: string | null;
  };
  const completionsByStudent = new Map<string, CompletionRow[]>();
  const completionErrors: string[] = [];
  const COMPLETION_FETCH_CONCURRENCY = 20;
  for (
    let i = 0;
    i < students.length && completionErrors.length === 0;
    i += COMPLETION_FETCH_CONCURRENCY
  ) {
    const wave = students.slice(i, i + COMPLETION_FETCH_CONCURRENCY);
    await Promise.all(
      wave.map(async (s) => {
        const { data, error } = await supabase
          .from("student_lesson_completions")
          .select(
            "student_id, lesson_id, completed_at, action_completed_at, skipped_at",
          )
          .eq("student_id", s.id);
        if (error) {
          completionErrors.push(error.message);
          return;
        }
        if (data && data.length > 0) {
          completionsByStudent.set(s.id, data as CompletionRow[]);
        }
      }),
    );
  }
  if (completionErrors.length > 0) {
    const message = `Completions fetch failed: ${completionErrors[0]}`;
    await logCronFinish(runId, "failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }


  const regionTotals: Record<string, number> = {};
  for (const l of lessons) {
    regionTotals[l.region_id] = (regionTotals[l.region_id] ?? 0) + 1;
  }

  type TemplateRow = {
    id: string;
    scenario_id: string;
    bucket: string;
    is_custom: boolean;
    is_active: boolean;
    trigger_config: TriggerConfig | null;
  };
  const templateBy = new Map<string, string>(
    (templates as TemplateRow[])
      .filter((t) => t.is_active)
      .map((t) => [t.scenario_id, t.id]),
  );
  const triggerConfigTemplates = (templates as TemplateRow[]).filter(
    (t) =>
      t.is_active &&
      t.trigger_config != null &&
      t.trigger_config.all.length > 0,
  );
  const overriddenScenarios = new Set<string>(
    triggerConfigTemplates
      .filter((t) => !t.is_custom)
      .map((t) => t.scenario_id),
  );

  const existingByStudent = new Map<string, typeof existingTasks>();
  for (const t of existingTasks) {
    const arr = existingByStudent.get(t.student_id) ?? [];
    arr.push(t);
    existingByStudent.set(t.student_id, arr);
  }

  const milestonesByStudent = new Map<
    string,
    { first_sprint_login_at: string | null }
  >();
  for (const m of (milestonesRes.data ?? []) as Array<{
    student_id: string;
    first_sprint_login_at: string | null;
  }>) {
    milestonesByStudent.set(m.student_id, {
      first_sprint_login_at: m.first_sprint_login_at,
    });
  }

  const snapByStudent = new Map<string, ReturnType<typeof buildStudentSnapshot>>();
  for (const student of students) {
    snapByStudent.set(
      student.id,
      buildStudentSnapshot(
        student,
        completionsByStudent.get(student.id) ?? [],
        lessons,
        regionTotals,
        existingByStudent.get(student.id) ?? [],
        milestonesByStudent.get(student.id) ?? null,
        course,
      ),
    );
  }

  const bucketByScenario = new Map<string, string>(
    Object.entries(SCENARIO_BUCKET),
  );
  for (const t of templates as TemplateRow[]) {
    if (!bucketByScenario.has(t.scenario_id)) {
      bucketByScenario.set(t.scenario_id, t.bucket);
    }
  }


  const toInsert: Array<{
    student_id: string;
    scenario_id: string;
    template_id: string;
    behavior_summary: string;
  }> = [];

  for (const alert of alerts) {
    const student = students.find((s) => s.id === alert.student_id);
    if (!student) continue;
    const snap = snapByStudent.get(student.id);
    if (!snap) continue;
    if (snapshotIsCanceling(snap)) continue;
    if (!snap.student.first_sprint_login_at) continue;
    const task = alertTask(
      alert.alert_type,
      ALERT_LABEL[alert.alert_type] ?? alert.message,
      snap,
    );
    if (!task) continue;
    const templateId = templateBy.get(task.scenarioId);
    if (!templateId) continue;

    toInsert.push({
      student_id: student.id,
      scenario_id: task.scenarioId,
      template_id: templateId,
      behavior_summary: task.summary,
    });
  }


  for (const student of students) {
    const snap = snapByStudent.get(student.id);
    if (!snap) continue;

    for (const [scenarioId, check] of Object.entries(triggers)) {
      if (overriddenScenarios.has(scenarioId)) continue;
      const result = check(snap);
      if (!result) continue;
      const templateId = templateBy.get(scenarioId);
      if (!templateId) continue;
      toInsert.push({
        student_id: student.id,
        scenario_id: scenarioId,
        template_id: templateId,
        behavior_summary: result,
      });
      snap.recentTaskScenarios.add(scenarioId);
    }

    for (const tpl of triggerConfigTemplates) {
      if (snap.recentTaskScenarios.has(tpl.scenario_id)) continue;
      const result = evaluateCustomTrigger(snap, tpl.trigger_config!);
      if (!result.match) continue;
      toInsert.push({
        student_id: student.id,
        scenario_id: tpl.scenario_id,
        template_id: tpl.id,
        behavior_summary: result.summary,
      });
    }
  }

  const had = messagesHad(hadTasks);
  const candidates = toInsert.filter((c) => {
    if (had.has(c.student_id, c.scenario_id)) return false;
    had.add(c.student_id, c.scenario_id);
    return true;
  });


  type OpenTaskRow = {
    id: string;
    student_id: string;
    scenario_id: string;
    template_id: string | null;
    template: { bucket: string } | { bucket: string }[] | null;
  };
  const { data: openTasksWithBucket, error: openTasksErr } =
    await fetchAllRowsPaginated<OpenTaskRow>(() =>
      supabase
        .from("tasks")
        .select(
          "id, student_id, scenario_id, template_id, template:templates(bucket)",
        )
        .eq("status", "open"),
    );
  if (openTasksErr) {
    await logCronFinish(runId, "failed", {
      error: `Open tasks fetch failed: ${openTasksErr.message}`,
    });
    return NextResponse.json(
      { error: `Open tasks fetch failed: ${openTasksErr.message}` },
      { status: 500 },
    );
  }

  const { data: pastDueCancelingRows, error: pastDueErr } = await supabase
    .from("students")
    .select("id")
    .eq("membership_status", "past_due")
    .not("cancel_scheduled_at", "is", null)
    .eq("csm_exempt", false);
  if (pastDueErr) {
    const message = `Past-due canceling students fetch failed: ${pastDueErr.message}`;
    await logCronFinish(runId, "failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const pastDueCancelingIds = new Set(
    ((pastDueCancelingRows ?? []) as Array<{ id: string }>).map((r) => r.id),
  );

  const watcherIds = [
    ...new Set(
      ((openTasksWithBucket ?? []) as unknown as OpenTaskRow[])
        .filter((t) => t.scenario_id === WHOP_WATCHER)
        .map((t) => t.student_id),
    ),
  ];
  const appliedForThirty = new Set<string>();
  for (let i = 0; i < watcherIds.length; i += 100) {
    const { data: appliedRows, error: appliedErr } = await supabase
      .from("discount_requests")
      .select("student_id")
      .in("student_id", watcherIds.slice(i, i + 100))
      .in("status", [...THIRTY_APPLIED_STATUSES]);
    if (appliedErr) {
      const message = `Discount requests fetch failed: ${appliedErr.message}`;
      await logCronFinish(runId, "failed", { error: message });
      return NextResponse.json({ error: message }, { status: 500 });
    }
    for (const r of (appliedRows ?? []) as Array<{ student_id: string }>) {
      appliedForThirty.add(r.student_id);
    }
  }

  type OpenSlot = { id: string; bucket: string };
  const negativeSlot = new Map<string, OpenSlot>();
  for (const t of (openTasksWithBucket ?? []) as unknown as OpenTaskRow[]) {
    const tpl = Array.isArray(t.template) ? t.template[0] : t.template;
    const bucket = tpl?.bucket ?? bucketByScenario.get(t.scenario_id) ?? "";
    if (bucket === "cancel_path" || bucket === "at_risk") {
      const existing = negativeSlot.get(t.student_id);
      if (!existing || priorityFor(bucket) < priorityFor(existing.bucket)) {
        negativeSlot.set(t.student_id, { id: t.id, bucket });
      }
    }
  }

  candidates.sort((a, b) => {
    const pa = priorityFor(bucketByScenario.get(a.scenario_id) ?? "");
    const pb = priorityFor(bucketByScenario.get(b.scenario_id) ?? "");
    return pa - pb;
  });

  const finalToInsert: typeof toInsert = [];
  const toDismiss: string[] = [];

  for (const c of candidates) {
    const bucket = bucketByScenario.get(c.scenario_id) ?? "";
    if (bucket !== "cancel_path" && bucket !== "at_risk") {
      finalToInsert.push(c);
      continue;
    }
    const slot = negativeSlot.get(c.student_id);
    if (!slot) {
      finalToInsert.push(c);
      negativeSlot.set(c.student_id, { id: "(pending)", bucket });
      continue;
    }
    if (priorityFor(bucket) < priorityFor(slot.bucket)) {
      if (slot.id !== "(pending)") toDismiss.push(slot.id);
      finalToInsert.push(c);
      negativeSlot.set(c.student_id, { id: "(pending)", bucket });
    }
  }

  for (const id of toDismiss) {
    await supabase
      .from("tasks")
      .update({
        status: "dismissed",
        dismissed_at: new Date().toISOString(),
        notes: "Superseded by a higher-priority CSM task.",
      })
      .eq("id", id);
  }


  const familyOf = (s: string): string | null => {
    const m = s.match(/^(.+)\.day\d+$/);
    return m ? m[1] : null;
  };

  const openByFamilyKey = new Map<string, OpenTaskRow[]>();
  for (const t of (openTasksWithBucket ?? []) as unknown as OpenTaskRow[]) {
    const family = familyOf(t.scenario_id);
    if (!family) continue;
    const key = `${t.student_id}|${family}`;
    const arr = openByFamilyKey.get(key) ?? [];
    arr.push(t);
    openByFamilyKey.set(key, arr);
  }

  const familySupersedeNotes = new Map<string, string>();
  for (const row of finalToInsert) {
    const family = familyOf(row.scenario_id);
    if (!family) continue;
    const existing = openByFamilyKey.get(`${row.student_id}|${family}`) ?? [];
    for (const t of existing) {
      if (t.scenario_id === row.scenario_id) continue;
      if (toDismiss.includes(t.id)) continue;
      if (familySupersedeNotes.has(t.id)) continue;
      familySupersedeNotes.set(
        t.id,
        `Superseded by ${row.scenario_id} (later stage in same family).`,
      );
    }
  }

  for (const [id, note] of familySupersedeNotes) {
    await supabase
      .from("tasks")
      .update({
        status: "dismissed",
        dismissed_at: new Date().toISOString(),
        notes: note,
      })
      .eq("id", id);
  }


  const STALE_DAYS = 3;
  const studentById = new Map(students.map((s) => [s.id, s]));
  const templateByScenario = new Map(templates.map((t) => [t.scenario_id, t]));
  const autoDismissals = new Map<string, string>();

  const isCancelingAwareScenario = (scenarioId: string): boolean => {
    const tpl = templateByScenario.get(scenarioId);
    return Boolean(
      tpl?.trigger_config?.all?.some(
        (c: { metric?: string }) => c.metric === "is_canceling",
      ),
    );
  };

  for (const t of (openTasksWithBucket ?? []) as unknown as OpenTaskRow[]) {
    if (toDismiss.includes(t.id)) continue;
    if (familySupersedeNotes.has(t.id)) continue;

    const student = studentById.get(t.student_id);
    if (!student) {
      if (
        pastDueCancelingIds.has(t.student_id) &&
        isCancelingAwareScenario(t.scenario_id)
      ) {
        continue;
      }
      autoDismissals.set(
        t.id,
        "Auto-dismissed: student no longer in eligible pool.",
      );
      continue;
    }

    const snap = snapByStudent.get(student.id);
    if (!snap) continue;

    if (snapshotIsCanceling(snap)) {
      const cancelingTpl = templateByScenario.get(t.scenario_id);
      if (
        !cancelingTpl?.is_admin_only &&
        !isCancelingAwareScenario(t.scenario_id)
      ) {
        autoDismissals.set(
          t.id,
          "Auto-dismissed: student is canceling, save-the-sale flow owns this student.",
        );
        continue;
      }
    }

    const cleanSnap = {
      ...snap,
      recentTaskScenarios: new Set<string>(),
    };

    let stillMatches: boolean | null = null;

    const triggerFn = triggers[t.scenario_id];
    if (triggerFn) {
      stillMatches = !!triggerFn(cleanSnap);
    }

    if (stillMatches === null) {
      const tpl = templateByScenario.get(t.scenario_id);
      if (tpl?.trigger_config) {
        stillMatches = evaluateCustomTrigger(
          cleanSnap,
          tpl.trigger_config,
        ).match;
      }
    }

    if (stillMatches === null && t.scenario_id === WHOP_WATCHER) {
      if (!discountWindowOpen(student.first_paid_at ?? null, Date.now())) {
        autoDismissals.set(
          t.id,
          "Auto-dismissed: whop.watcher, the student's 30% window has closed.",
        );
      } else if (appliedForThirty.has(student.id)) {
        autoDismissals.set(
          t.id,
          "Auto-dismissed: whop.watcher, the student applied for the 30%.",
        );
      }
      continue;
    }

    if (stillMatches === null) {
      const m = t.scenario_id.match(/\.day(\d+)$/);
      if (m) {
        const scenarioDay = parseInt(m[1], 10);
        const currentDay = sprintDayNumber(
          student.first_paid_at ?? student.joined_at,
        );
        if (currentDay > scenarioDay + STALE_DAYS) {
          autoDismissals.set(
            t.id,
            `Auto-dismissed: ${t.scenario_id} stage stale (current day ${currentDay}).`,
          );
          continue;
        }
      }
      continue;
    }

    if (stillMatches === false) {
      autoDismissals.set(
        t.id,
        `Auto-dismissed: ${t.scenario_id} trigger condition no longer met.`,
      );
    }
  }

  for (const [id, note] of autoDismissals) {
    await supabase
      .from("tasks")
      .update({
        status: "dismissed",
        dismissed_at: new Date().toISOString(),
        notes: note,
      })
      .eq("id", id);
  }


  let createdCount = 0;
  const perBucket: Record<string, number> = {};

  for (const row of finalToInsert) {
    const { error } = await supabase.from("tasks").insert({
      ...row,
      status: "open",
    });
    if (error) {
      if ((error as { code?: string }).code !== "23505") {
        console.error(
          `[csm-tasks-cron] insert failed for ${row.student_id} ${row.scenario_id}:`,
          error,
        );
      }
      continue;
    }
    createdCount++;
    const bucket = bucketByScenario.get(row.scenario_id) ?? "event";
    perBucket[bucket] = (perBucket[bucket] ?? 0) + 1;
  }


  let discordPosted: boolean | null = null;
  if (createdCount > 0) {
    if (await isDmEnabled(supabase, "csm_task_summary_enabled")) {
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ??
        "https://30-day-sprint-smkv.vercel.app";
      const lines = Object.entries(perBucket)
        .sort()
        .map(([bucket, count]) => `• ${count} ${bucket.replace("_", " ")}`);
      const result = await postTeamAlert([
        {
          title: "📋 Astrid Task Queue update",
          description:
            `**${createdCount}** new task${createdCount === 1 ? "" : "s"} today:\n` +
            `${lines.join("\n")}\n\n→ ${baseUrl}/admin/tasks`,
        },
      ]);
      discordPosted = result.ok;
    } else {
      discordPosted = false;
    }
  }

  await logCronFinish(runId, "success", { rowsAffected: createdCount });
  return NextResponse.json({
    checked: students.length,
    candidates: toInsert.length,
    already_had: toInsert.length - candidates.length,
    tasks_created: createdCount,
    bucket_dismissed: toDismiss.length,
    family_dismissed: familySupersedeNotes.size,
    auto_dismissed: autoDismissals.size,
    by_bucket: perBucket,
    discord_posted: discordPosted,
  });
}
