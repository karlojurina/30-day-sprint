import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = authHeader.slice(7);

  // Create a client with the service role to bypass RLS
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Verify the token and get the user
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Check if team member (service role bypasses RLS)
  const { data: teamMember } = await supabase
    .from("team_members")
    .select("*")
    .eq("id", user.id)
    .single();

  if (teamMember) {
    return NextResponse.json({ role: "team", profile: teamMember });
  }

  // Check if student
  const { data: student } = await supabase
    .from("students")
    .select("*")
    .eq("supabase_user_id", user.id)
    .single();

  if (student) {
    return NextResponse.json({ role: "student", profile: student });
  }

  return NextResponse.json({ role: "none", profile: null });
}
