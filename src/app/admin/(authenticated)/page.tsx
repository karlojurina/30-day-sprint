"use client";

/**
 * /admin, the Dashboard: the admin's home (admin rebuild 2, D1).
 *
 * This file is the loader: the reads, with the signed-in team member's
 * browser client (so the tables' rules for the team apply), and the Refresh
 * call. What the numbers mean is src/lib/admin/dashboard-metrics.ts; how they
 * look is src/components/admin/dashboard/DashboardView.tsx, which the dev page
 * /dev/admin/dashboard renders with made-up reads and no login.
 *
 * Every read is handed on as its data or its error (rowsRead, countRead,
 * configReads), never as an empty list or a 0 standing in for a failure.
 * Paged reads go by key (fetchAllRowsByKey): pages read by offset with no
 * stable order can repeat some rows and skip others.
 */

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DashboardView } from "@/components/admin/dashboard/DashboardView";
import type { DashboardSource } from "@/components/admin/dashboard/DashboardView";
import { useAuth } from "@/contexts/AuthContext";
import { ADMIN_STUDENT_JOIN_CUTOFF, TASKS_STUDENT_JOIN_CUTOFF } from "@/lib/constants";
import { CURRICULUM_RESET_KEY } from "@/lib/curriculum-reset";
import {
  DASH_STUDENT_COLUMNS,
  SNAPSHOT_COLUMNS,
  TASKS_RESET_KEY,
  configReads,
  countRead,
  rowsRead,
  trendDays,
} from "@/lib/admin/dashboard-metrics";
import type {
  BountyStamp,
  CancelingRow,
  DashRead,
  DashStudent,
  DashboardReads,
  SnapshotRow,
} from "@/lib/admin/dashboard-metrics";
import { PAYING_WHOP_PLAN_IDS_ARRAY } from "@/lib/admin/metrics-definitions";
import { createClient, getSharedSession } from "@/lib/supabase-browser";
import { fetchAllRowsByKey } from "@/lib/supabase-pagination";
import { DISCOUNT_ELIGIBLE_FROM } from "@/lib/world/discount";

/** Every read the Dashboard makes, at once (the open tasks after the settings, whose reset date is their floor). */
async function readDashboard(supabase: SupabaseClient, nowMs: number): Promise<DashboardReads> {
  const days = trendDays(nowMs);
  const first = days[0];
  const last = days[days.length - 1];

  const config = (async () =>
    configReads(
      await supabase.from("admin_config").select("key, value").in("key", [CURRICULUM_RESET_KEY, TASKS_RESET_KEY]),
    ))();

  // The same population as before admin rebuild 2: a Whop membership, active,
  // past due or canceled, on a paying plan, first paid since the cutoff.
  // first_paid_at, never joined_at: a renewal moves joined_at.
  const students = (async (): Promise<DashRead<DashStudent[]>> =>
    rowsRead(
      await fetchAllRowsByKey<DashStudent>(
        () =>
          supabase
            .from("students")
            .select(DASH_STUDENT_COLUMNS)
            .not("whop_membership_id", "is", null)
            .in("membership_status", ["active", "past_due", "canceled"])
            .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[])
            .gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF)
            .order("id"),
        "id",
      ),
    ))();

  // Only the rows with a stamp: the tile counts nothing else.
  const bounty = (async (): Promise<DashRead<BountyStamp[]>> =>
    rowsRead(
      await fetchAllRowsByKey<BountyStamp>(
        () =>
          supabase
            .from("student_milestones")
            .select("student_id, bounty_access_claimed_at")
            .not("bounty_access_claimed_at", "is", null)
            .order("student_id"),
        "student_id",
      ),
    ))();

  // Open tasks: what the Tasks page lists, mirrored from GET /api/admin/tasks
  // (a template, a student who is not exempt and first paid since the tasks'
  // cutoff), from the tasks reset on once it has run (D7). Without its floor
  // the count is not asked for: the settings' error stands in for it.
  const openTasks = config.then(async ({ tasksResetAt }): Promise<DashRead<number>> => {
    if (!tasksResetAt.ok) return tasksResetAt;
    let query = supabase
      .from("tasks")
      .select(
        "id, student:students!inner(csm_exempt, joined_at)",
        { count: "exact", head: true },
      )
      .eq("status", "open")
      .not("template_id", "is", null)
      .eq("student.csm_exempt", false)
      .gte("student.first_paid_at", TASKS_STUDENT_JOIN_CUTOFF);
    if (tasksResetAt.data) query = query.gte("created_at", tasksResetAt.data);
    return countRead(await query);
  });

  // 30% to decide: the 30% page's Applied tab, the pending requests made from
  // DISCOUNT_ELIGIBLE_FROM on (D4: older ones stay in the database, unlisted).
  const toDecide = (async () =>
    countRead(
      await supabase
        .from("discount_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .gte("created_at", DISCOUNT_ELIGIBLE_FROM),
    ))();

  // The 14 days of each snapshot table: 14 rows at most, no paging needed.
  const snapshots = (async (): Promise<DashRead<SnapshotRow[]>> =>
    rowsRead(
      await supabase
        .from("daily_progress_snapshots")
        .select(SNAPSHOT_COLUMNS)
        .gte("snapshot_date", first)
        .lte("snapshot_date", last)
        .order("snapshot_date"),
    ))();
  const canceling = (async (): Promise<DashRead<CancelingRow[]>> =>
    rowsRead(
      await supabase
        .from("canceling_snapshots")
        .select("snapshot_date, canceling_count_cohort")
        .gte("snapshot_date", first)
        .lte("snapshot_date", last)
        .order("snapshot_date"),
    ))();

  const [c, s, b, o, t, snaps, cancel] = await Promise.all([
    config,
    students,
    bounty,
    openTasks,
    toDecide,
    snapshots,
    canceling,
  ]);
  return {
    students: s,
    bounty: b,
    openTasks: o,
    tasksResetAt: c.tasksResetAt,
    toDecide: t,
    snapshots: snaps,
    canceling: cancel,
    resetAt: c.resetAt,
  };
}

/** POST /api/admin/refresh-everything with the session's token: its status (0 for no answer) and its JSON. */
async function refreshEverything(supabase: ReturnType<typeof createClient>): Promise<{ status: number; body: unknown }> {
  let token: string | undefined;
  try {
    token = (await getSharedSession(supabase))?.access_token;
  } catch {
    return { status: 0, body: null };
  }
  if (!token) return { status: 401, body: { error: "You are signed out. Sign in again to go on." } };
  try {
    const res = await fetch("/api/admin/refresh-everything", {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}

export default function AdminDashboard() {
  // The roles POST /api/admin/refresh-everything accepts: a csm was once shown
  // the button and got "Founder or admin role required" back.
  const { teamMember } = useAuth();
  const canRefresh = teamMember?.role === "founder" || teamMember?.role === "admin";
  const [source] = useState<DashboardSource>(() => {
    const supabase = createClient();
    return {
      load: (nowMs) => readDashboard(supabase, nowMs),
      refresh: () => refreshEverything(supabase),
    };
  });
  return <DashboardView source={source} canRefresh={canRefresh} />;
}
