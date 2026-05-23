/**
 * POST /api/student/mark-first-client
 *
 * Fires when the student clicks "I just landed my first client" on
 * the pb_land_first_client node sheet on Map 2.
 *
 *   • Pure self-report — no upload, no admin review, no attestation
 *   • Single-use — guarded by IS NULL on the SQL update
 *   • Precondition: bounty_access_claimed_at IS NOT NULL (student
 *     must be on Map 2 to fire this). Enforced here as a guard.
 *
 * v46 — milestone fields live on student_milestones, not students.
 * v50 — bounty_access_claimed_at replaced sprint_completed_at as the
 * Map 2 unlock signal (sprint_completed_at column dropped). v55
 * updates this route to read the new field.
 *
 * No external side effects. The crowned celebration is purely
 * client-side; this endpoint just flips the timestamp.
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

  const { data: milestones } = await supabase
    .from("student_milestones")
    .select("bounty_access_claimed_at, first_client_landed_at")
    .eq("student_id", student.id)
    .maybeSingle();

  // Map-2-only — if the student hasn't claimed Bounty Access, the
  // milestone shouldn't be reachable. Reject defensively.
  if (!milestones?.bounty_access_claimed_at) {
    return NextResponse.json(
      { error: "Bounty Access not claimed yet" },
      { status: 400 },
    );
  }

  // Idempotency — already landed? return the existing timestamp so
  // the client can render the post-state without firing another
  // celebration.
  if (milestones.first_client_landed_at) {
    return NextResponse.json({
      ok: true,
      already_landed: true,
      first_client_landed_at: milestones.first_client_landed_at,
    });
  }

  const landedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("student_milestones")
    .update({ first_client_landed_at: landedAt, updated_at: landedAt })
    .eq("student_id", student.id)
    .is("first_client_landed_at", null)
    .select("first_client_landed_at")
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: "Failed to mark first client landed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    already_landed: false,
    first_client_landed_at: updated.first_client_landed_at,
  });
}
