import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Missing email or password" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Sign in the user
  const { data: signInData, error: signInError } =
    await supabase.auth.signInWithPassword({ email, password });

  if (signInError) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Check if they're a team member (using service role — bypasses RLS)
  const { data: teamMember } = await supabase
    .from("team_members")
    .select("id, role, full_name")
    .eq("id", signInData.user.id)
    .single();

  if (!teamMember) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Return the session tokens for the client to store
  return NextResponse.json({
    session: signInData.session,
    teamMember,
  });
}
