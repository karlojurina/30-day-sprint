/**
 * POST /api/student/claim-bounty-access
 *
 * Fires when the student clicks "Claim my Bounty spot" on the l057
 * lesson sheet. Per lovro-brief-v2/02-triggers.md trigger #1, this
 * is a purely platform-side moment with no external side effects:
 *
 *   • No Discord role grant
 *   • No DM
 *   • No admin notification
 *   • No Whop / Zak call
 *
 * What it does (atomic, in this order):
 *   1. Sets students.bounty_access_claimed_at = now() (single-use —
 *      the UPDATE is conditioned on the field being NULL so a
 *      duplicate click is a no-op).
 *   2. Marks l057 complete in student_lesson_completions.
 *   3. Returns the new student row so the client can update its
 *      state without a full refetch.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("supabase_user_id", user.id)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // v46 — bounty_access_claimed_at lives on student_milestones.
  const { data: milestones } = await supabase
    .from("student_milestones")
    .select("bounty_access_claimed_at")
    .eq("student_id", student.id)
    .maybeSingle();

  // Idempotency — if the flag is already set, return the existing
  // timestamp so the client can render the post-claim state without
  // a second celebration firing.
  if (milestones?.bounty_access_claimed_at) {
    return NextResponse.json({
      ok: true,
      already_claimed: true,
      bounty_access_claimed_at: milestones.bounty_access_claimed_at,
    });
  }

  // 1. Flip the flag via upsert on student_milestones. Conditional
  //    WHERE on the bounty_access_claimed_at update path prevents a
  //    race between two parallel calls.
  const claimedAt = new Date().toISOString();

  // If no milestones row exists yet, insert one. If it does, update.
  if (!milestones) {
    await supabase
      .from("student_milestones")
      .insert({
        student_id: student.id,
        bounty_access_claimed_at: claimedAt,
        updated_at: claimedAt,
      });
  } else {
    const { data: updated, error: updateError } = await supabase
      .from("student_milestones")
      .update({
        bounty_access_claimed_at: claimedAt,
        updated_at: claimedAt,
      })
      .eq("student_id", student.id)
      .is("bounty_access_claimed_at", null)
      .select("bounty_access_claimed_at")
      .single();

    if (updateError || !updated) {
      return NextResponse.json({ error: "Failed to claim" }, { status: 500 });
    }
  }

  // 2. Mark l057 complete. Mirrors what toggle-lesson would do —
  //    upsert the completion row with completed_at = now. Action
  //    fields are irrelevant here (l057 is a "setup" lesson, no
  //    ad-ship).
  await supabase
    .from("student_lesson_completions")
    .upsert(
      {
        student_id: student.id,
        lesson_id: "l057",
        completed_at: claimedAt,
      },
      { onConflict: "student_id,lesson_id" },
    );

  return NextResponse.json({
    ok: true,
    already_claimed: false,
    bounty_access_claimed_at: claimedAt,
  });
}
