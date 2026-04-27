import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncWatchProgress } from "../_lib/watch-sync";
import { updateStudentStreak } from "../_lib/update-streak";

/**
 * Authenticated POST. Runs the watch progress sync for the signed-in
 * student. Auth happens server-side using the app's WHOP_API_KEY — the
 * student's stored Whop tokens are no longer needed for this endpoint.
 *
 * Returns sync counts so the UI can show what changed.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Verify the Supabase session
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Load the student so we can get their whop_user_id (the filter for
  // the admin-side fetch).
  const { data: student } = await supabase
    .from("students")
    .select("id, whop_user_id")
    .eq("supabase_user_id", user.id)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  try {
    const result = await syncWatchProgress({
      studentId: student.id,
      whopUserId: student.whop_user_id,
    });
    if (result.syncedCount > 0) {
      await updateStudentStreak(supabase, student.id);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Sync failed: ${message}` },
      { status: 500 }
    );
  }
}
