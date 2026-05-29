import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

/**
 * PATCH  /api/admin/team-members/[id] - update role and/or full_name.
 * DELETE /api/admin/team-members/[id] - remove the row + Supabase auth
 *                                       user. Founder cannot remove
 *                                       themselves or demote themselves.
 *
 * Both endpoints are founder-only.
 *
 * v75.2 - introduced.
 */
const ALLOWED_ROLES = ["founder", "admin", "csm"] as const;
type Role = (typeof ALLOWED_ROLES)[number];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireTeam(request, ["founder"]);
  if (isAuthFailure(auth)) return auth.error;
  const { supabase, teamMember: actor } = auth;
  const { id } = await params;

  const body = (await request.json()) as {
    role?: string;
    full_name?: string;
  };
  const patch: { role?: Role; full_name?: string } = {};
  if (body.role !== undefined) {
    if (!ALLOWED_ROLES.includes(body.role as Role)) {
      return NextResponse.json(
        { error: `Role must be one of ${ALLOWED_ROLES.join(", ")}` },
        { status: 400 },
      );
    }
    patch.role = body.role as Role;
  }
  if (typeof body.full_name === "string") {
    const trimmed = body.full_name.trim();
    if (trimmed.length === 0) {
      return NextResponse.json(
        { error: "Full name cannot be empty" },
        { status: 400 },
      );
    }
    patch.full_name = trimmed;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Prevent the founder from demoting themselves into a non-founder
  // role - they could lock themselves out of /admin/team management.
  if (id === actor.id && patch.role && patch.role !== "founder") {
    return NextResponse.json(
      { error: "Cannot demote your own founder role" },
      { status: 400 },
    );
  }

  const { data: row, error } = await supabase
    .from("team_members")
    .update(patch)
    .eq("id", id)
    .select("id, email, full_name, role, created_at")
    .single();
  if (error || !row) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update team member" },
      { status: 500 },
    );
  }
  return NextResponse.json({ teamMember: row });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireTeam(request, ["founder"]);
  if (isAuthFailure(auth)) return auth.error;
  const { supabase, teamMember: actor } = auth;
  const { id } = await params;

  if (id === actor.id) {
    return NextResponse.json(
      { error: "Cannot remove yourself" },
      { status: 400 },
    );
  }

  // Delete the team_members row first so the membership disappears
  // even if the auth.users delete fails (cascade FK on auth.users
  // would also nuke the row anyway).
  const { error: deleteError } = await supabase
    .from("team_members")
    .delete()
    .eq("id", id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }
  const { error: authError } = await supabase.auth.admin.deleteUser(id);
  if (authError) {
    // The team_members row is already gone; surface a soft warning.
    return NextResponse.json(
      {
        warning: `team_members row removed, but auth user delete failed: ${authError.message}`,
      },
      { status: 200 },
    );
  }
  return NextResponse.json({ ok: true });
}
