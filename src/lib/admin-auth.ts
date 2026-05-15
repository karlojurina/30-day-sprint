/**
 * Server-side auth helpers for admin API routes.
 *
 * Pattern (matches existing routes like /api/auth/me):
 *   1. Pull Bearer token from Authorization header
 *   2. Create a service-role Supabase client
 *   3. Verify the token with supabase.auth.getUser
 *   4. Look up the team_members row by user id
 *   5. (Optional) check the role is in an allowed set
 *
 * On any failure return a NextResponse and let the route bail.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TeamMember } from "@/types/database";

export interface AuthedTeam {
  supabase: SupabaseClient;
  teamMember: TeamMember;
}

export interface AuthFailure {
  error: NextResponse;
}

export function isAuthFailure(
  result: AuthedTeam | AuthFailure,
): result is AuthFailure {
  return (result as AuthFailure).error !== undefined;
}

/**
 * Resolve the current team member from the request. Returns either
 * a populated AuthedTeam or an AuthFailure containing the response
 * the caller should return.
 *
 * @param request   The incoming NextRequest
 * @param roles     Optional whitelist — if provided, the member's
 *                  role must be in this list (403 otherwise)
 */
export async function requireTeam(
  request: NextRequest,
  roles?: Array<TeamMember["role"]>,
): Promise<AuthedTeam | AuthFailure> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  const token = authHeader.slice(7);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return {
      error: NextResponse.json({ error: "Invalid token" }, { status: 401 }),
    };
  }

  const { data: teamMember } = await supabase
    .from("team_members")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!teamMember) {
    return {
      error: NextResponse.json(
        { error: "Not a team member" },
        { status: 403 },
      ),
    };
  }

  if (roles && !roles.includes(teamMember.role)) {
    return {
      error: NextResponse.json(
        { error: `Requires role: ${roles.join(" or ")}` },
        { status: 403 },
      ),
    };
  }

  return { supabase, teamMember: teamMember as TeamMember };
}
