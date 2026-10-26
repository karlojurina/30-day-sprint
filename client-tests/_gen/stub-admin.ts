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
// team member can decide the same request while Whop makes the code. Since
// the 30% that applies itself (T-137) it is the one stand-in for the code
// Whop makes: build.mjs points thirty-apply.ts's copy here, stub-server.ts
// hands out this same function and list, so a suite counts every code asked
// for in `promoCodes` whichever copy asked. It throws whop.ts's WhopCallError
// (its status, or null for no answer) after setWhopCreateError, and answers a
// body of the test's own after setWhopCreateBody (a 2xx naming no code id).

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

/** whop.ts's typed error, as the real createWhopPromoCode throws it: Whop's HTTP status, or null for no answer. */
export class WhopCallError extends Error {
  readonly status: number | null;
  constructor(status: number | null, message: string) {
    super(message);
    this.name = "WhopCallError";
    this.status = status;
  }
}

/** The promo codes the routes and the 30%'s step asked Whop for, in order (a refused one too). */
export const promoCodes: Array<Record<string, unknown>> = [];
/** Whether each of those asks was handed an AbortSignal (the step's time limit), in the same order. */
export const createSignals: boolean[] = [];
let during: ((params: Record<string, unknown>) => unknown) | null = null;
let createError: { status: number | null } | null = null;
let createBody: Record<string, unknown> | null = null;

/** Runs `fn` inside every Whop call from now on (null: nothing). */
export function whileWhopAnswers(fn: ((params: Record<string, unknown>) => unknown) | null) {
  during = fn;
}

/** From now on every create throws a WhopCallError with this status (null: Whop gave no answer); undefined makes codes again. */
export function setWhopCreateError(status: number | null | undefined) {
  createError = status === undefined ? null : { status };
}

/** From now on every create answers this body instead of a made code (a 2xx naming no promo_ id, say); null makes codes again. */
export function setWhopCreateBody(body: Record<string, unknown> | null) {
  createBody = body;
}

export async function createWhopPromoCode(params: Record<string, unknown>, opts: { signal?: AbortSignal } = {}) {
  promoCodes.push(structuredClone(params));
  createSignals.push(opts.signal instanceof AbortSignal);
  if (during) await during(params);
  if (createError) {
    throw new WhopCallError(createError.status, `Whop promo code creation failed: ${createError.status === null ? "no answer" : `HTTP ${createError.status}`}`);
  }
  if (createBody) return structuredClone(createBody);
  return { id: `promo_${promoCodes.length}` };
}
