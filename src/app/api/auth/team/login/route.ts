import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Missing email or password" }, { status: 400 });
  }

  // Use a throwaway anon client for sign-in (so it doesn't taint the service client)
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: signInData, error: signInError } =
    await anonClient.auth.signInWithPassword({ email, password });

  if (signInError) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Use a separate service role client for the team_members check (bypasses RLS)
  const serviceClient = createServiceClient();

  const { data: teamMember } = await serviceClient
    .from("team_members")
    .select("id, role, full_name")
    .eq("id", signInData.user.id)
    .single();

  if (!teamMember) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  return NextResponse.json({
    session: signInData.session,
    teamMember,
  });
}
