/**
 * Phase 3 (brief v3 §03) - Not Activated cohort cron.
 *
 * Runs once daily at 09:20 UTC (5 minutes after check-csm-tasks so
 * the team Discord post order reads: engagement alerts → CSM tasks
 * → NA tasks). Generates Astrid tasks for paying members who never
 * signed in to the dashboard.
 *
 * Trigger logic (per the 23-05-2026 simplification - no form
 * webhook):
 *
 *   activated = students.joined_at IS NOT NULL
 *   in_pool  = members where membership_status='active'
 *              AND joined_at IS NULL
 *              AND high_churn_risk = false
 *              AND csm_exempt = false
 *
 *   days_since_signup = today - whop_subscription_start_date (using
 *     students.created_at as the proxy when Whop start isn't stored
 *     separately)
 *
 *   tier (Day 3/5/7/10) maps to template index 1/2/3/4
 *
 *   cohort = 'A' (has discord_username) → NA-A.{tier}, Discord DM
 *   cohort = 'B' (no  discord_username) → NA-B.{tier}, Whop DM
 *
 *   At tier 4 (Day 10), after creating the task, set
 *   high_churn_risk = true so subsequent passes skip the student.
 *
 * Cohort is re-evaluated every pass - if a Cohort B student joins
 * Discord between triggers, the next tier fires NA-A.
 *
 * Dedupe relies on the partial unique index
 *   idx_tasks_unique_open ON tasks(student_id, scenario_id) WHERE status='open'
 * so re-running the cron is a no-op.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { postTeamAlert } from "@/lib/discord";

interface NotActivatedRow {
  id: string;
  name: string | null;
  email: string | null;
  discord_username: string | null;
  created_at: string;
  high_churn_risk: boolean;
}

const TIER_DAYS = [3, 5, 7, 10] as const;
type Tier = (typeof TIER_DAYS)[number];

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function templateIdFor(cohort: "A" | "B", tier: Tier): string {
  const idx = TIER_DAYS.indexOf(tier) + 1; // 1..4
  return `NA-${cohort}.${idx}`;
}

function suggestedChannel(cohort: "A" | "B"): string {
  return cohort === "A" ? "Discord DM" : "Whop DM";
}

export async function GET(request: NextRequest) {
  // v55 - hardened to match check-csm-tasks. Previously the
  // CRON_SECRET check was conditional on the env var being set,
  // which meant a missing env var silently disabled the auth gate.
  // Now the check is unconditional - if CRON_SECRET isn't set the
  // header can never match, so the route stays locked.
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const started = Date.now();

  // Pull the "not activated" pool.
  const { data: studentsRaw, error: studentsErr } = await supabase
    .from("students")
    .select(
      "id, name, email, discord_username, created_at, high_churn_risk",
    )
    .eq("membership_status", "active")
    .is("joined_at", null)
    .eq("high_churn_risk", false)
    .eq("csm_exempt", false);

  if (studentsErr) {
    console.error("[check-na-tasks] students query failed:", studentsErr);
    return NextResponse.json(
      { error: studentsErr.message },
      { status: 500 },
    );
  }

  const pool = (studentsRaw ?? []) as NotActivatedRow[];

  // Resolve template ids for all 8 NA scenarios in one query.
  const allNaIds = TIER_DAYS.flatMap((t) => {
    const idx = TIER_DAYS.indexOf(t) + 1;
    return [`NA-A.${idx}`, `NA-B.${idx}`];
  });
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
    const days = daysSince(s.created_at) as Tier | number;
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

    // The channel is derivable from scenario_id (NA-A.* = Discord,
    // NA-B.* = Whop) so we don't add a tasks column for it. Encode
    // a hint in the summary instead so it surfaces in the existing
    // task views without a schema change.
    const summary = `Day ${tier} - Cohort ${cohort} (${suggestedChannel(cohort)}). No dashboard login since signup.`;

    const { error: insertErr } = await supabase.from("tasks").insert({
      student_id: s.id,
      scenario_id: scenarioId,
      template_id: templateId,
      behavior_summary: summary,
      status: "open",
    });

    if (insertErr) {
      // 23505 = unique violation on the partial open-task index -
      // means we already have an open NA task for this student.
      // Safe to skip.
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

    // Day-10 tier flips high_churn_risk and exits the queue.
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

  // Discord summary (best-effort).
  if (created.length > 0) {
    const byTier = new Map<Tier, number>();
    for (const c of created) byTier.set(c.tier, (byTier.get(c.tier) ?? 0) + 1);
    const summary = TIER_DAYS.map((t) =>
      byTier.has(t) ? `Day ${t}: ${byTier.get(t)}` : null,
    )
      .filter(Boolean)
      .join(" · ");
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

  return NextResponse.json({
    ok: true,
    pool_size: pool.length,
    created: created.length,
    errors: errors.length > 0 ? errors : undefined,
    duration_ms: Date.now() - started,
  });
}
