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

/**
 * REVENUE VISIBILITY — the single allowlist for /admin/stats.
 *
 * Deliberately NOT a role check. `team_members.role` is mutable:
 * PATCH /api/admin/team-members/[id] lets any founder grant
 * role='founder' to anyone, which would silently widen access to
 * gross revenue, MRR and net figures with no error and no signal to
 * the person who cares. These ids are auth.users primary keys and
 * cannot change.
 *
 * ONE definition, consumed by BOTH gates (the page's server component
 * and the API route). If this list ever appears in a second file,
 * that is the bug — one copy will eventually be updated alone.
 * Mirrored in SQL by public.current_user_is_stats_owner()
 * (supabase/migrations/2026_v86_stats_saved_views.sql); change both
 * together.
 */
export const STATS_ALLOWED_USER_IDS: readonly string[] = [
  "2ba35d07-fdf3-41ee-87c2-4fa2e7711dfb", // jurinakarlo2@gmail.com
];

export function isStatsOwner(id: string | null | undefined): boolean {
  return !!id && STATS_ALLOWED_USER_IDS.includes(id);
}

/**
 * Gate for the revenue API routes. Runs requireTeam first so an
 * unauthenticated or non-team caller gets the standard 401/403, then
 * applies the id allowlist. Returns the same discriminated union as
 * requireTeam, so callers keep using isAuthFailure().
 *
 * The 403 body says "Not found" rather than naming the surface: a
 * caller who is not the owner should not learn that a revenue
 * endpoint exists here.
 */
export async function requireStatsOwner(
  request: NextRequest,
): Promise<AuthedTeam | AuthFailure> {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth;

  if (!isStatsOwner(auth.teamMember.id)) {
    return {
      error: NextResponse.json({ error: "Not found" }, { status: 403 }),
    };
  }

  return auth;
}
