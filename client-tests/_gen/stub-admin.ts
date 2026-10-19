// What the admin routes' copies import for the team's login and for Whop's
// promo code, standing in for @/lib/admin-auth and @/lib/whop in
// admin-discounts.test.mjs, admin-tasks.test.mjs and admin-pages.test.mjs
// (each makes its own copies of the routes and points those two imports
// here). Hand-written, like stub-server.ts; the routes are the real source.
//
// THE LOGIN. requireTeam answers as the real one does for the member set with
// setTeam: a role outside the route's list is a 403 in the real words, and
// otherwise the route gets that member and a database client: the one handed
// to setTeam, or else stub-server.ts's client on its current database
// (useDb), which is what the real requireTeam's service-role client is.
//
// WHOP. createWhopPromoCode records what it is asked for, then runs what the
// test set with whileWhopAnswers, if anything: the moment in which another
// team member can decide the same request while Whop makes the code.

import { NextResponse, createClient } from "./stub-server.ts";

type Member = { id: string; role: string };
let team: Member = { id: "team-1", role: "founder" };
let client: unknown = null;

/** Who is logged in from now on, and (optionally) the database client the routes get. */
export function setTeam(member: Member, supabase: unknown = null) {
  team = { ...member };
  client = supabase;
}

export async function requireTeam(_request: Request, roles?: string[]) {
  if (roles && !roles.includes(team.role)) {
    return { error: NextResponse.json({ error: `Requires role: ${roles.join(" or ")}` }, { status: 403 }) };
  }
  return { supabase: client ?? createClient(), teamMember: { ...team } };
}

export function isAuthFailure(result: { error?: unknown }) {
  return result.error !== undefined;
}

/** The promo codes the approve route asked Whop for, in order. */
export const promoCodes: Array<Record<string, unknown>> = [];
let during: ((params: Record<string, unknown>) => unknown) | null = null;

/** Runs `fn` inside every Whop call from now on (null: nothing). */
export function whileWhopAnswers(fn: ((params: Record<string, unknown>) => unknown) | null) {
  during = fn;
}

export async function createWhopPromoCode(params: Record<string, unknown>) {
  promoCodes.push(structuredClone(params));
  if (during) await during(params);
  return { id: `promo_${promoCodes.length}` };
}
