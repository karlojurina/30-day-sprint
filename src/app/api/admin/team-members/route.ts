import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

/**
 * GET  /api/admin/team-members - list every team_members row.
 * POST /api/admin/team-members - invite a new team member by email.
 *
 * Both endpoints are founder-only. Lower roles get 403. The invite
 * flow uses Supabase's built-in admin.inviteUserByEmail so the new
 * person receives a magic-link email; clicking it walks them through
 * setting a password. After the auth user is created we insert the
 * team_members row pointing at their auth id with the requested
 * role + name.
 *
 * v75.2 - introduced.
 */
const ALLOWED_ROLES = ["founder", "admin", "csm"] as const;
type Role = (typeof ALLOWED_ROLES)[number];

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request, ["founder"]);
  if (isAuthFailure(auth)) return auth.error;
  const { supabase } = auth;
  const { data, error } = await supabase
    .from("team_members")
    .select("id, email, full_name, role, created_at")
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ teamMembers: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireTeam(request, ["founder"]);
  if (isAuthFailure(auth)) return auth.error;
  const { supabase, teamMember: actor } = auth;

  const body = (await request.json()) as {
    email?: string;
    full_name?: string;
    role?: string;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  const full_name = (body.full_name ?? "").trim();
  const role = body.role as Role;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Invalid email address" },
      { status: 400 },
    );
  }
  if (!full_name) {
    return NextResponse.json({ error: "Full name required" }, { status: 400 });
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json(
      { error: `Role must be one of ${ALLOWED_ROLES.join(", ")}` },
      { status: 400 },
    );
  }

  // Guard against duplicate team_members rows. If the email is
  // already in our table return a friendly conflict.
  const { data: existing } = await supabase
    .from("team_members")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: `${email} is already a team member` },
      { status: 409 },
    );
  }

  // Supabase invite: creates the auth user + emails a magic link.
  // Clicking the link confirms the email + creates a session; we
  // redirect to /admin/set-password (v75.4) so the invitee can set
  // a real password. Without that step they'd be logged in via the
  // magic link but with no password set, so any future logout would
  // strand them.
  const { data: inviteData, error: inviteError } =
    await supabase.auth.admin.inviteUserByEmail(email, {
      data: { full_name },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/admin/set-password`,
    });
  if (inviteError || !inviteData?.user) {
    return NextResponse.json(
      { error: inviteError?.message ?? "Failed to invite user" },
      { status: 500 },
    );
  }

  const { data: row, error: insertError } = await supabase
    .from("team_members")
    .insert({
      id: inviteData.user.id,
      email,
      full_name,
      role,
    })
    .select("id, email, full_name, role, created_at")
    .single();
  if (insertError || !row) {
    // Roll back the auth user so we don't leave a dangling
    // half-created account.
    await supabase.auth.admin.deleteUser(inviteData.user.id);
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create team member" },
      { status: 500 },
    );
  }

  void actor;
  return NextResponse.json({ teamMember: row });
}
