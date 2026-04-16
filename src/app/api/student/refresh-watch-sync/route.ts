import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { refreshWhopTokens } from "@/lib/whop";
import { syncWatchProgress } from "../_lib/watch-sync";

/**
 * Authenticated POST. Runs the watch progress sync for the student,
 * trying tokens in order:
 *   1. Stored Whop access_token (fast path — no token round-trip)
 *   2. Stored Whop refresh_token → rotate → use new access_token
 *   3. Fail with a "re-auth" message if neither is present
 *
 * Returns sync counts and the last persisted Whop error (if any) so
 * the UI can surface actual failure reasons instead of swallowing them.
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

  // Load student
  const { data: student } = await supabase
    .from("students")
    .select(
      "id, whop_user_id, whop_access_token, whop_refresh_token, whop_last_sync_error"
    )
    .eq("supabase_user_id", user.id)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const tryRunSync = async (accessToken: string) => {
    return syncWatchProgress({
      studentId: student.id,
      whopUserId: student.whop_user_id,
      accessToken,
    });
  };

  // Path 1: try the stored access_token first (if present)
  if (student.whop_access_token) {
    try {
      const result = await tryRunSync(student.whop_access_token);
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // If the error looks like auth expired (401), fall through to refresh.
      // Otherwise return the actual message so the UI can show it.
      if (!/401|expired|invalid_token/i.test(message)) {
        return NextResponse.json(
          { error: `Sync failed: ${message}`, reAuth: false },
          { status: 500 }
        );
      }
      // access_token might be expired — try refreshing below
    }
  }

  // Path 2: rotate via refresh_token
  if (student.whop_refresh_token) {
    try {
      const rotated = await refreshWhopTokens(student.whop_refresh_token);
      // Persist new tokens
      await supabase
        .from("students")
        .update({
          whop_access_token: rotated.access_token,
          whop_refresh_token:
            rotated.refresh_token ?? student.whop_refresh_token,
        })
        .eq("id", student.id);

      const result = await tryRunSync(rotated.access_token);
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          error: `Sync failed after token refresh: ${message}`,
          reAuth: true,
        },
        { status: 500 }
      );
    }
  }

  // Path 3: no token on file — user must re-authenticate
  return NextResponse.json(
    {
      error:
        "No Whop token on file. Sign out and back in to reconnect your course progress.",
      reAuth: true,
    },
    { status: 400 }
  );
}
