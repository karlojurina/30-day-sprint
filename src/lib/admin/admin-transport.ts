"use client";

import { createClient, getSharedSession } from "@/lib/supabase-browser";
import type { ThirtyView } from "@/lib/admin/thirty-view";
import type { ReasonKind, TodayView } from "@/lib/admin/support-list";

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
 * The 30% page's half (work item 3): its read, the three discount routes,
 * and Today's mark route, which "Mark messaged" on Can still earn calls,
 * with its Undo. The ads tick's call went with the tick (2026-10-20).
 * Today's half (work item 4): its read, the mark route's POST and DELETE
 * (Undo), and the task outcome route (Replied / No reply).
 *
 * No call throws. Every answer is `{ ok: true, data }` or `{ ok: false,
 * error }`, where `error` is a sentence the page can show: the route's own
 * words, or, for a signed-out session or no connection, this file's. A
 * refusal can also carry the route's `code`, for a page that treats one
 * refusal apart (the mark route's "marked-otherwise").
 */

export type Answer<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; code?: string };

/** The reasons a student can need a message for (admin rebuild PRD, C4 and section 8), defined in support-list.ts. */
export type { ReasonKind };

/** POST /api/admin/today/mark (section 8). */
export interface MarkBody {
  studentId: string;
  action: "messaged" | "not_needed";
  headlineKind: ReasonKind;
  /** Every reason on the row, in words: it becomes the record's behavior_summary. */
  reasonsText: string;
  /** Required for not_needed. */
  note?: string;
  /** The open queue tasks on the row, which the mark closes with the same actor and time. */
  openTaskIds: string[];
}

export interface MarkAnswer {
  supportId: string | null;
  movedIds: string[];
  at: string;
}

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
  /** POST /api/admin/today/mark. */
  mark(body: MarkBody): Promise<Answer<MarkAnswer>>;
  /** DELETE /api/admin/today/mark: the Undo beside Mark messaged's notice. */
  undo(ids: string[]): Promise<Answer<{ results: UndoResult[] }>>;
}

/** One entry of an Undo: done, or why not (403 another member's, 409 too old or a newer open task, 404 nothing to undo). */
export interface UndoResult {
  id: string;
  ok: boolean;
  status: number;
  error?: string;
}

/** What Today (src/components/admin/today/TodayView.tsx) calls. */
export interface TodayTransport {
  /** GET /api/admin/today. */
  loadToday(): Promise<Answer<TodayView>>;
  /** POST /api/admin/today/mark: Mark messaged or Not needed, closing the row's open queue tasks with it. */
  mark(body: MarkBody): Promise<Answer<MarkAnswer>>;
  /** DELETE /api/admin/today/mark: undo a mark (its support record and the queue tasks it closed). */
  undo(ids: string[]): Promise<Answer<{ results: UndoResult[] }>>;
  /** POST /api/admin/tasks/[id]/outcome: Replied, No reply, or null to clear it, on a completed task. */
  setOutcome(taskId: string, outcome: "replied" | "no_reply" | null): Promise<Answer<null>>;
}

const NO_SERVER = "Couldn't reach the server. Check the connection and try again.";
const SIGNED_OUT = "You are signed out. Sign in again to go on.";
const NOT_ALLOWED = "Your team account can't do this.";

type Json = Record<string, unknown> | null;

/**
 * One call with the session's bearer token. `body` is handed the signed-in
 * member's id: the discount routes of tonight's fix lane (G1) record the
 * member from the login and ignore the id, and the routes before that fix
 * record the id sent, so sending it keeps both right.
 */
async function send<T>(
  method: "GET" | "POST" | "DELETE",
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
export const adminTransport: ThirtyTransport & TodayTransport = {
  loadThirty: () => send<ThirtyView>("GET", "/api/admin/thirty"),

  loadToday: () => send<TodayView>("GET", "/api/admin/today"),

  undo: (ids) => send<{ results: UndoResult[] }>("DELETE", "/api/admin/today/mark", () => ({ ids })),

  async setOutcome(taskId, outcome) {
    const r = await send<unknown>("POST", `/api/admin/tasks/${encodeURIComponent(taskId)}/outcome`, () => ({ outcome }));
    return r.ok ? { ...r, data: null } : r;
  },

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

  mark: (body) => send<MarkAnswer>("POST", "/api/admin/today/mark", () => body),
};
