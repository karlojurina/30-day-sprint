"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { createClient, getSharedSession } from "@/lib/supabase-browser";
import { discountState, type DiscountLesson, type DiscountRequestRow, type DiscountState } from "@/lib/world/discount";

/**
 * The student's early-finish discount, for the map (WorldMap.tsx passes it on
 * as WorldSource.discount).
 *
 * The state is discountState() (src/lib/world/discount.ts) over what the app
 * already holds: AuthContext's student (first_paid_at), StudentContext's
 * discount request, the catalog's lessons (is_gate, has_video,
 * duration_seconds, counts_toward_progress, in course order) and the lessons
 * whose video is done (watchedLessonIds: completed_at set, action half or
 * not). It is worked out again every minute, so "11 days left" and the
 * window's end keep up with the clock.
 *
 * APPLY posts to /api/discounts/request exactly as the old dashboard's
 * StudentContext.requestDiscount does (the session's Bearer token, the
 * student's id in the body; the route derives the student from the token).
 * It does not call requestDiscount itself: that one returns at once unless the
 * old course's R1 + R2 are done (StudentContext discountEligible), so on the
 * new course it would never send anything, and it reports failures with
 * window.alert. The row the route returns is kept here until StudentContext's
 * own refresh brings the same row, so the panel turns to "in review" at once.
 *
 * THE DEVELOPMENT PAGE provides DiscountStandInContext (its first payment,
 * its requests, an Apply that resolves in memory) and this hook then reads no
 * student and calls no route.
 */

export interface DiscountStandIn {
  firstPaidAt: string | null;
  requests: readonly DiscountRequestRow[];
  /** Resolves null when the application went in, else the words to show. */
  apply(): Promise<string | null>;
}

/** The development page's pretend student's discount. /world provides nothing. */
export const DiscountStandInContext = createContext<DiscountStandIn | null>(null);

export interface WorldDiscountHook {
  state: DiscountState;
  now: number;
  apply(): Promise<string | null>;
}

const MINUTE_MS = 60_000;

/** Words for a failed request that the route did not explain. */
const NO_REACH = "Couldn't reach the server. Try again in a moment.";
const SIGNED_OUT = "You're signed out. Sign in again, then apply.";

/** The row the route returns, as discountState reads it; null when it is not one. */
function rowOf(data: unknown): DiscountRequestRow | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  const status = r.status;
  if (typeof r.id !== "string" || typeof r.created_at !== "string") return null;
  if (status !== "pending" && status !== "approved" && status !== "rejected" && status !== "applied") return null;
  return {
    id: r.id,
    status,
    created_at: r.created_at,
    promo_code: typeof r.promo_code === "string" ? r.promo_code : null,
    rejection_reason: typeof r.rejection_reason === "string" ? r.rejection_reason : null,
  };
}

export function useWorldDiscount(): WorldDiscountHook {
  const stand = useContext(DiscountStandInContext);
  const { student } = useAuth();
  const ctx = useStudent();
  const { lessons, discountRequest, completions, completedLessonIds, watchedLessonIds } = ctx;
  // The development page's provider has no watchedLessonIds: there it is its
  // completed lessons plus any completion row with its video done (an action
  // item whose link is not in yet).
  const videoDone = useMemo<ReadonlySet<string>>(() => {
    if (watchedLessonIds) return watchedLessonIds;
    const out = new Set(completedLessonIds);
    for (const c of completions ?? []) if (c.completed_at) out.add(c.lesson_id);
    return out;
  }, [watchedLessonIds, completedLessonIds, completions]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(id);
  }, []);

  /** The row this page's own Apply got back, until StudentContext has it too. */
  const [sent, setSent] = useState<DiscountRequestRow | null>(null);

  const courseLessons = useMemo<DiscountLesson[]>(
    () =>
      [...lessons]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((l) => ({
          id: l.id,
          type: l.type,
          counts_toward_progress: l.counts_toward_progress !== false,
          is_gate: l.is_gate === true,
          has_video: l.has_video === true,
          duration_seconds: l.duration_seconds ?? null,
        })),
    [lessons],
  );

  const firstPaidAt = stand ? stand.firstPaidAt : (student?.first_paid_at ?? null);
  const requests = useMemo<readonly DiscountRequestRow[]>(() => {
    if (stand) return stand.requests;
    const out: DiscountRequestRow[] = [];
    if (discountRequest) out.push(discountRequest);
    if (sent && sent.id !== discountRequest?.id) out.push(sent);
    return out;
  }, [stand, discountRequest, sent]);

  const state = useMemo(
    () => discountState({ now: new Date(now), firstPaidAt, lessons: courseLessons, videoDoneIds: videoDone, requests }),
    [now, firstPaidAt, courseLessons, videoDone, requests],
  );

  const studentId = student?.id ?? null;
  const apply = useCallback(async (): Promise<string | null> => {
    if (stand) return stand.apply();
    if (!studentId) return SIGNED_OUT;
    let token: string | null = null;
    try {
      token = (await getSharedSession(createClient()))?.access_token ?? null;
    } catch {
      token = null;
    }
    if (!token) return SIGNED_OUT;
    try {
      const res = await fetch("/api/discounts/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ studentId }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const said = data && typeof data === "object" ? (data as { error?: unknown }).error : null;
        return typeof said === "string" && said.trim() ? said : `That didn't go through (HTTP ${res.status}). Try again in a moment.`;
      }
      const row = rowOf(data);
      // A success with no row: show it as sent; StudentContext's next refresh brings the real one.
      setSent(row ?? { id: "sent", status: "pending", created_at: new Date().toISOString() });
      return null;
    } catch {
      return NO_REACH;
    }
  }, [stand, studentId]);

  return { state, now, apply };
}
