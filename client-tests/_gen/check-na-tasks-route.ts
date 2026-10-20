
import { NextRequest, NextResponse } from "./stub-cron.ts";
import { createServiceClient } from "./supabase-server.ts";
import { postTeamAlert } from "./discord.ts";
import { isDmEnabled } from "./dm-toggles.ts";
import { PAYING_WHOP_PLAN_IDS_ARRAY } from "./metrics-definitions.ts";
import { csmSprintWindowCutoffIso, sprintDayNumber } from "./constants.ts";
import {
  verifyCronAuth,
  cronUnauthorizedResponse,
  logCronStart,
  logCronFinish,
} from "./cron-auth.ts";

export const maxDuration = 300;

const ROUTE_NAME = "check-na-tasks";

const ID_BATCH = 100;

interface NotActivatedRow {
  id: string;
  name: string | null;
  email: string | null;
  discord_username: string | null;
  created_at: string;
  first_paid_at: string | null;
  joined_at: string | null;
  high_churn_risk: boolean;
  cancel_scheduled_at: string | null;
}

const TIER_DAYS = [3, 5, 7, 10] as const;
type Tier = (typeof TIER_DAYS)[number];

function templateIdFor(cohort: "A" | "B", tier: Tier): string {
  const channel = cohort === "A" ? "discord" : "whop";
  return `stalled.${channel}.day${tier}`;
}

function suggestedChannel(cohort: "A" | "B"): string {
  return cohort === "A" ? "Discord DM" : "Whop DM";
}

export async function GET(request: NextRequest) {
  const auth = verifyCronAuth(request);
  if (!auth.ok) {
    await logCronStart(ROUTE_NAME, auth.reason);
    return cronUnauthorizedResponse(auth.reason);
  }
  const runId = await logCronStart(ROUTE_NAME, "ok");

  const supabase = createServiceClient();
  const started = Date.now();

  const { data: studentsRaw, error: studentsErr } = await supabase
    .from("students")
    .select(
      "id, name, email, discord_username, created_at, first_paid_at, joined_at, high_churn_risk, cancel_scheduled_at",
    )
    .eq("membership_status", "active")
    .eq("high_churn_risk", false)
    .eq("csm_exempt", false)
    .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[])
    .gte("first_paid_at", csmSprintWindowCutoffIso());

  if (studentsErr) {
    console.error("[check-na-tasks] students query failed:", studentsErr);
    await logCronFinish(runId, "failed", { error: studentsErr.message });
    return NextResponse.json(
      { error: studentsErr.message },
      { status: 500 },
    );
  }

  const allIds = (studentsRaw ?? []).map((s) => s.id as string);
  const activatedIds = new Set<string>();
  for (let i = 0; i < allIds.length; i += ID_BATCH) {
    const { data: activated, error: activatedErr } = await supabase
      .from("student_milestones")
      .select("student_id")
      .in("student_id", allIds.slice(i, i + ID_BATCH))
      .not("first_sprint_login_at", "is", null);
    if (activatedErr) {
      console.error("[check-na-tasks] milestones query failed:", activatedErr);
      await logCronFinish(runId, "failed", { error: activatedErr.message });
      return NextResponse.json(
        { error: activatedErr.message },
        { status: 500 },
      );
    }
    for (const r of activated ?? []) activatedIds.add(r.student_id as string);
  }

  const pool = (studentsRaw ?? []).filter(
    (s) => !activatedIds.has(s.id as string),
  ) as NotActivatedRow[];

  const allNaIds = TIER_DAYS.flatMap((t) => [
    `stalled.discord.day${t}`,
    `stalled.whop.day${t}`,
  ]);
  const { data: templates } = await supabase
    .from("templates")
    .select("id, scenario_id")
    .in("scenario_id", allNaIds)
    .eq("is_active", true);

  const templateIdByScenario = new Map<string, string>();
  for (const t of (templates ?? []) as Array<{
    id: string;
    scenario_id: string;
  }>) {
    templateIdByScenario.set(t.scenario_id, t.id);
  }

  const created: Array<{
    student_id: string;
    scenario_id: string;
    tier: Tier;
    cohort: "A" | "B";
  }> = [];
  const errors: string[] = [];

  for (const s of pool) {
    if (s.cancel_scheduled_at) continue;
    const rawDays = sprintDayNumber(
      s.first_paid_at ?? s.joined_at ?? s.created_at,
    );
    const days = (rawDays >= 10 && rawDays <= 13 ? 10 : rawDays) as
      | Tier
      | number;
    if (!TIER_DAYS.includes(days as Tier)) continue;

    const tier = days as Tier;
    const cohort: "A" | "B" = s.discord_username ? "A" : "B";
    const scenarioId = templateIdFor(cohort, tier);
    const templateId = templateIdByScenario.get(scenarioId);

    if (!templateId) {
      errors.push(
        `${s.id}: template ${scenarioId} not found in active templates`,
      );
      continue;
    }

    const summary = `Day ${tier} - Cohort ${cohort} (${suggestedChannel(cohort)}). No dashboard login since signup.`;

    const { error: insertErr } = await supabase.from("tasks").insert({
      student_id: s.id,
      scenario_id: scenarioId,
      template_id: templateId,
      behavior_summary: summary,
      status: "open",
    });

    if (insertErr) {
      if (
        insertErr.code === "23505" ||
        insertErr.message?.includes("duplicate key")
      ) {
        continue;
      }
      errors.push(`${s.id}/${scenarioId}: ${insertErr.message}`);
      continue;
    }

    created.push({
      student_id: s.id,
      scenario_id: scenarioId,
      tier,
      cohort,
    });

    if (tier === 10) {
      const { error: flagErr } = await supabase
        .from("students")
        .update({
          high_churn_risk: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", s.id);
      if (flagErr) {
        errors.push(
          `${s.id}: failed to set high_churn_risk=true: ${flagErr.message}`,
        );
      }
    }
  }

  if (created.length > 0) {
    const byTier = new Map<Tier, number>();
    for (const c of created) byTier.set(c.tier, (byTier.get(c.tier) ?? 0) + 1);
    const summary = TIER_DAYS.map((t) =>
      byTier.has(t) ? `Day ${t}: ${byTier.get(t)}` : null,
    )
      .filter(Boolean)
      .join(" · ");
    if (await isDmEnabled(supabase, "csm_task_summary_enabled")) {
      try {
        await postTeamAlert([
          {
            title: "NA tasks created",
            description: `${created.length} NA task${created.length === 1 ? "" : "s"} for Astrid. ${summary}`,
            color: 0x9aa0a6,
          },
        ]);
      } catch (e) {
        console.warn("[check-na-tasks] discord notify failed:", e);
      }
    }
  }

  await logCronFinish(runId, "success", { rowsAffected: created.length });
  return NextResponse.json({
    ok: true,
    pool_size: pool.length,
    created: created.length,
    errors: errors.length > 0 ? errors : undefined,
    duration_ms: Date.now() - started,
  });
}
