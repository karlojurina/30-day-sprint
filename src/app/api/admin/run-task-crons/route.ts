/**
 * POST /api/admin/run-task-crons
 *
 * Admin-authed manual trigger for the daily task generation crons.
 * Calls both:
 *   - /api/cron/check-csm-tasks  (nolessons / noship / pace + custom triggers)
 *   - /api/cron/check-na-tasks   (stalled.discord.* / stalled.whop.*)
 *
 * Returns the JSON each cron returned so the UI can show "N tasks
 * created" inline. Used by the "Generate tasks now" button in
 * /admin/tasks - lets Astrid/Karlo refresh the queue without
 * waiting for the next scheduled run or hitting the cron URL with
 * the secret manually.
 *
 * Admin/founder only (CSM has read-only access).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  // Founder + admin only - CSM shouldn't be able to trigger
  // production crons.
  if (
    auth.teamMember.role !== "founder" &&
    auth.teamMember.role !== "admin"
  ) {
    return NextResponse.json(
      { error: "Founder or admin role required" },
      { status: 403 },
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET env var not set" },
      { status: 500 },
    );
  }

  // Build base URL from the incoming request so this works on any
  // deploy + local dev.
  const baseUrl = new URL(request.url).origin;

  // Run both crons in parallel.
  const [csmRes, naRes] = await Promise.allSettled([
    fetch(`${baseUrl}/api/cron/check-csm-tasks`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    }),
    fetch(`${baseUrl}/api/cron/check-na-tasks`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    }),
  ]);

  const csmJson =
    csmRes.status === "fulfilled" && csmRes.value.ok
      ? await csmRes.value.json().catch(() => null)
      : { error: "csm cron failed" };
  const naJson =
    naRes.status === "fulfilled" && naRes.value.ok
      ? await naRes.value.json().catch(() => null)
      : { error: "na cron failed" };

  return NextResponse.json({
    ok: true,
    csm: csmJson,
    na: naJson,
  });
}
