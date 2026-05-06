import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * Admin endpoint to toggle a student's `ad_submissions_verified` flag.
 *
 * Required for discount approval (see /api/discounts/approve).
 * Auth: must be an authenticated team member.
 *
 * Body: { studentId: string, verified: boolean }
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice(7);

  // Verify the requester is a team member
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
  );

  const {
    data: { user },
  } = await userClient.auth.getUser(token);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: teamMember } = await supabase
    .from("team_members")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!teamMember) {
    return NextResponse.json({ error: "Team only" }, { status: 403 });
  }

  const body = await request.json();
  const { studentId, verified } = body as {
    studentId?: string;
    verified?: boolean;
  };

  if (!studentId || typeof verified !== "boolean") {
    return NextResponse.json(
      { error: "Missing studentId or verified flag" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("students")
    .update({
      ad_submissions_verified: verified,
      ad_submissions_verified_at: verified ? new Date().toISOString() : null,
      ad_submissions_verified_by: verified ? user.id : null,
    })
    .eq("id", studentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, verified });
}
