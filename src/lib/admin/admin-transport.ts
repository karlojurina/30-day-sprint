"use client";

import { createClient, getSharedSession } from "@/lib/supabase-browser";
import type { ThirtyView } from "@/lib/admin/thirty-view";

/**
 * The rebuilt admin pages' calls to the server, behind one interface (admin
 * rebuild PRD, section 9).
 *
 * WHY THIS EXISTS. The pages are client components that fetch with the
 * team member's bearer token. With every call gathered here, the dev pages
 * under /dev/admin hand the very same components a stand-in for the server
 * (src/app/dev/admin/fixtures.ts), and every state of a page can be looked
 * at with no login and no database.
 *
 * The 30% page's calls (work item 3): its read and the three discount
 * routes. The ads tick's call went with the tick (2026-10-20). Today's
 * calls, and the 30% page's "Mark messaged" and its Undo through Today's
 * mark route, went with Today (admin rebuild 2, D2).
 *
 * No call throws. Every answer is `{ ok: true, data }` or `{ ok: false,
 * error }`, where `error` is a sentence the page can show: the route's own
 * words, or, for a signed-out session or no connection, this file's. A
 * refusal can also carry the route's `code`, for a page that treats one
 * refusal apart.
 */

export type Answer<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; code?: string };

/** What the 30% page (src/components/admin/thirty/ThirtyView.tsx) calls. */
export interface ThirtyTransport {
  /** GET /api/admin/thirty. */
  loadThirty(): Promise<Answer<ThirtyView>>;
  /** POST /api/discounts/approve. `override` is "Approve anyway": it skips the 30% rule. */
  approve(requestId: string, override: boolean): Promise<Answer<{ promoCode: string | null }>>;
  /** POST /api/discounts/reject. The student sees the reason. */
  reject(requestId: string, reason: string | null): Promise<Answer<null>>;
  /** POST /api/discounts/mark-applied: the code is on the student's membership in Whop. */
  markApplied(requestId: string): Promise<Answer<null>>;
}

const NO_SERVER = "Couldn't reach the server. Check the connection and try again.";
const SIGNED_OUT = "You are signed out. Sign in again to go on.";
const NOT_ALLOWED = "Your team account can't do this.";

type Json = Record<string, unknown> | null;

/**
 * One call with the session's bearer token. `body` is handed the signed-in
 * member's id: the discount routes of tonight's fix lane (G1) record the
 * member from the login and ignore the id, and the routes before that fix
 * record the id sent, so sending it keeps both right. Exported for the other
 * rebuilt pages' transports (lesson-feedback-transport.ts).
 */
export async function send<T>(
  method: "GET" | "POST",
  path: string,
  body?: (memberId: string) => unknown,
): Promise<Answer<T>> {
  let token: string;
  let memberId: string;
  try {
    const session = await getSharedSession(createClient());
    if (!session) return { ok: false, status: 401, error: SIGNED_OUT };
    token = session.access_token;
    memberId = session.user.id;
  } catch {
    return { ok: false, status: 0, error: NO_SERVER };
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body(memberId)) : undefined,
    });
  } catch {
    return { ok: false, status: 0, error: NO_SERVER };
  }
  const json = (await res.json().catch(() => null)) as Json;
  if (res.ok) return { ok: true, status: res.status, data: json as T };
  if (res.status === 401) return { ok: false, status: 401, error: SIGNED_OUT };
  if (res.status === 403) return { ok: false, status: 403, error: NOT_ALLOWED };
  const said = json && typeof json.error === "string" ? json.error.trim() : "";
  const code = json && typeof json.code === "string" ? json.code : undefined;
  return {
    ok: false,
    status: res.status,
    error: said || `The server answered with an error (${res.status}). Try again.`,
    ...(code ? { code } : {}),
  };
}

/** The real calls, with the signed-in team member's session. */
export const adminTransport: ThirtyTransport = {
  loadThirty: () => send<ThirtyView>("GET", "/api/admin/thirty"),

  async approve(requestId, override) {
    const r = await send<{ promoCode?: string }>("POST", "/api/discounts/approve", (me) => ({
      requestId,
      override,
      reviewerId: me,
    }));
    return r.ok ? { ...r, data: { promoCode: r.data?.promoCode ?? null } } : r;
  },

  async reject(requestId, reason) {
    const r = await send<unknown>("POST", "/api/discounts/reject", () => ({ requestId, reason }));
    return r.ok ? { ...r, data: null } : r;
  },

  async markApplied(requestId) {
    const r = await send<unknown>("POST", "/api/discounts/mark-applied", (me) => ({
      requestId,
      appliedBy: me,
    }));
    return r.ok ? { ...r, data: null } : r;
  },
};
