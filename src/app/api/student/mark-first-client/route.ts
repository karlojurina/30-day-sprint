/**
 * POST /api/student/mark-first-client
 *
 * Fires when the student clicks "I just landed my first client" on
 * the pb_land_first_client node sheet on Map 2. Per
 * lovro-brief-v2/02-triggers.md trigger 3 + 04-map2-playbook.md §5:
 *
 *   • Pure self-report — no upload, no admin review, no attestation
 *   • Single-use — guarded by IS NULL on the SQL update
 *   • Precondition: sprint_completed_at IS NOT NULL (student must
 *     be on Map 2 to fire this). Enforced here as a guard.
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
    .select("id, sprint_completed_at, first_client_landed_at")
    .eq("supabase_user_id", user.id)
    .single();
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Map-2-only — if the student hasn't finished the sprint, the
  // milestone shouldn't be reachable. Reject defensively.
  if (!student.sprint_completed_at) {
    return NextResponse.json(
      { error: "Sprint not finished yet" },
      { status: 400 },
    );
  }

  // Idempotency — already landed? return the existing timestamp so
  // the client can render the post-state without firing another
  // celebration.
  if (student.first_client_landed_at) {
    return NextResponse.json({
      ok: true,
      already_landed: true,
      first_client_landed_at: student.first_client_landed_at,
    });
  }

  const landedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("students")
    .update({ first_client_landed_at: landedAt })
    .eq("id", student.id)
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
