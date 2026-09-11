/**
 * POST /api/admin/etfb/seats/:membershipId/decision
 *
 * Record a human decision about ONE seat.
 * Body: { decision: "keep" | "snoozed" | null, reason?: string, snoozeUntil?: string }
 *
 * PER-SEAT, NEVER PER-LINK. plan_P9yx1m1HdHfMt holds 29 seats on a 10-seat plan
 * and they do not all belong to that link's owner, so a link-level decision
 * would be wrong by construction.
 *
 * `null` clears a previous decision and the seat returns to the review list.
 *
 * This route does NOT revoke anything. Revocation is done by a human in Whop.
 * The 'revoked' state exists in the schema so the future revoke button needs no
 * migration, but nothing here writes it.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ membershipId: string }>;
}

const ALLOWED = new Set(["keep", "snoozed"]);

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  const { membershipId } = await ctx.params;
  if (!membershipId.startsWith("mem_")) {
    return NextResponse.json({ error: "Invalid membership id" }, { status: 400 });
  }

  let decision: string | null;
  let reason: string | null = null;
  let snoozeUntil: string | null = null;
  let planId: string | null = null;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    decision = body.decision === null ? null : String(body.decision ?? "");
    if (decision !== null && !ALLOWED.has(decision)) {
      return NextResponse.json(
        { error: `decision must be one of keep, snoozed, or null` },
        { status: 400 },
      );
    }
    if (typeof body.reason === "string") reason = body.reason.slice(0, 500);
    if (typeof body.snoozeUntil === "string") snoozeUntil = body.snoozeUntil;
    if (typeof body.planId === "string") planId = body.planId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (decision === null) {
    const { error } = await auth.supabase
      .from("etfb_seat_decisions")
      .delete()
      .eq("membership_id", membershipId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, membershipId, decision: null });
  }

  if (decision === "snoozed" && !snoozeUntil) {
    return NextResponse.json(
      { error: "snoozeUntil is required when decision is 'snoozed'" },
      { status: 400 },
    );
  }
  if (!planId?.startsWith("plan_")) {
    return NextResponse.json(
      { error: "planId (the link this seat came through) is required" },
      { status: 400 },
    );
  }

  const { error } = await auth.supabase.from("etfb_seat_decisions").upsert(
    {
      membership_id: membershipId,
      plan_id: planId,
      decision,
      reason,
      snooze_until: snoozeUntil,
      decided_by: auth.teamMember.id,
      decided_at: new Date().toISOString(),
    },
    { onConflict: "membership_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, membershipId, decision });
}
