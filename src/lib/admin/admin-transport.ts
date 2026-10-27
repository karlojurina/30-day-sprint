"use client";

import { createClient, getSharedSession } from "@/lib/supabase-browser";
import type { ThirtyView } from "@/lib/admin/thirty-view";
import { THIRTY_REASONS } from "@/lib/thirty-words";
import type { ThirtyReason } from "@/lib/thirty-words";

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
 * The 30% page's calls (work item 3): its read, Approve (and Try again, the
 * same route on an approved request) and Reject, and since the render
 * review's second round of admin rebuild 2 "Check Whop again" (POST
 * /api/admin/thirty/check-coupon). Mark code applied's call went with its
 * route in the 30% that applies itself (T-137): Try again marks a request
 * applied once Whop shows its code on the student's membership. The ads
 * tick's call went with the tick (2026-10-20). Today's calls, and the 30%
 * page's "Mark messaged" and its Undo through Today's mark route, went with
 * Today (admin rebuild 2, D2).
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

/**
 * Approve's and Try again's answer when the route answered 2xx (PRD §9.4):
 * where the request ended, its code, and why the code is not on the
 * membership yet when it is not (an attempt_failed event's reason, the step
 * that said so, the membership's status and Whop's words).
 */
export interface ApproveAnswer {
  promoCode: string | null;
  status: "pending" | "approved" | "applied" | "rejected" | null;
  reason: ThirtyReason | null;
  step: string | null;
  membershipStatus: string | null;
  message: string | null;
}

/**
 * Reject's answer (PRD §9.4): the request's code when one was made, and its
 * state: "usable" (made, on nobody's membership: it works at checkout until
 * someone switches it off in Whop), "may_exist" (a code the app could not ask
 * Whop about) or null (no code made).
 */
export interface RejectAnswer {
  code: string | null;
  codeState: "usable" | "may_exist" | null;
}

/** What the 30% page (src/components/admin/thirty/ThirtyView.tsx) calls. */
export interface ThirtyTransport {
  /** GET /api/admin/thirty. */
  loadThirty(): Promise<Answer<ThirtyView>>;
  /**
   * POST /api/discounts/approve: Approve on a pending request, Try again on an
   * approved one. "Approve anyway" (a founder's or an admin's, the owner's
   * review of 2026-10-21): `override` skips the 30% rule, and
   * `overrideCoupon` the coupon check too, on a row the coupon refuses. The
   * route refuses either from a csm.
   */
  approve(requestId: string, override: boolean, overrideCoupon: boolean): Promise<Answer<ApproveAnswer>>;
  /** POST /api/discounts/reject. The student sees the reason. */
  reject(requestId: string, reason: string | null): Promise<Answer<RejectAnswer>>;
  /**
   * POST /api/admin/thirty/check-coupon ("Check Whop again" on a pending
   * row the stored coupon refuses, or the stored row says the student is
   * unpaid): Whop now for that one student, stored. `code` names the code on
   * the membership, when there is one; `unpaid`, no coupon and no paid course
   * plan with a payment that went through (2026-10-26).
   */
  checkCoupon(requestId: string): Promise<Answer<{ discounted: boolean; code: string | null; unpaid: boolean }>>;
}

const NO_SERVER = "Couldn't reach the server. Check the connection and try again.";
const SIGNED_OUT = "You are signed out. Sign in again to go on.";
const NOT_ALLOWED = "Your team account can't do this.";

type Json = Record<string, unknown> | null;

/**
 * One call with the session's bearer token. `body` is handed the signed-in
 * member's id: the discount routes of tonight's fix lane (G1) record the
 * member from the login and ignore the id, and the routes before that fix
 * record the id sent, so sending it keeps both right. Exported for the
 * other rebuilt pages' transports: the Tasks and students pages' calls
 * (src/lib/admin/people-transport.ts) and Lesson feedback's
 * (lesson-feedback-transport.ts).
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

  async approve(requestId, override, overrideCoupon) {
    const r = await send<Record<string, unknown> | null>("POST", "/api/discounts/approve", (me) => ({
      requestId,
      override,
      overrideCoupon,
      reviewerId: me,
    }));
    if (!r.ok) return r;
    const d = r.data ?? {};
    const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
    const status = ["pending", "approved", "applied", "rejected"].includes(String(d.status)) ? (d.status as ApproveAnswer["status"]) : null;
    return {
      ...r,
      data: {
        promoCode: text(d.promoCode),
        status,
        reason: (THIRTY_REASONS as readonly string[]).includes(String(d.reason)) ? (d.reason as ThirtyReason) : null,
        step: text(d.step),
        membershipStatus: text(d.membershipStatus),
        message: text(d.message),
      },
    };
  },

  async reject(requestId, reason) {
    const r = await send<{ code?: unknown; codeState?: unknown } | null>("POST", "/api/discounts/reject", () => ({ requestId, reason }));
    if (!r.ok) return r;
    const state = r.data?.codeState;
    return {
      ...r,
      data: {
        code: typeof r.data?.code === "string" && r.data.code !== "" ? r.data.code : null,
        codeState: state === "usable" || state === "may_exist" ? state : null,
      },
    };
  },

  async checkCoupon(requestId) {
    const r = await send<{ discounted?: unknown; code?: unknown; unpaid?: unknown }>("POST", "/api/admin/thirty/check-coupon", () => ({ requestId }));
    return r.ok
      ? {
          ...r,
          data: {
            discounted: r.data?.discounted === true,
            code: typeof r.data?.code === "string" ? r.data.code : null,
            unpaid: r.data?.unpaid === true,
          },
        }
      : r;
  },
};
