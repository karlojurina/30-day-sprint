import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { refreshWhopTokens } from "@/lib/whop";
import { syncWatchProgress } from "../_lib/watch-sync";

/**
 * Authenticated POST. Rotates the student's Whop access token using the
 * stored refresh_token, then re-runs the watch progress sync.
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

  // Get the student (by supabase_user_id)
  const { data: student } = await supabase
    .from("students")
    .select("id, whop_user_id, whop_refresh_token")
    .eq("supabase_user_id", user.id)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  if (!student.whop_refresh_token) {
    return NextResponse.json(
      {
        error: "No Whop refresh token on file. Sign out and back in with Whop.",
      },
      { status: 400 }
    );
  }

  // Rotate the access token
  let accessToken: string;
  try {
    const tokens = await refreshWhopTokens(student.whop_refresh_token);
    accessToken = tokens.access_token;
    // Persist the new refresh_token if Whop rotated it
    if (tokens.refresh_token && tokens.refresh_token !== student.whop_refresh_token) {
      await supabase
        .from("students")
        .update({ whop_refresh_token: tokens.refresh_token })
        .eq("id", student.id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Token refresh failed: ${message}` },
      { status: 500 }
    );
  }

  // Run the sync
  try {
    const result = await syncWatchProgress({
      studentId: student.id,
      whopUserId: student.whop_user_id,
      accessToken,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Sync failed: ${message}` },
      { status: 500 }
    );
  }
}
