"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { sortQuestions } from "@/lib/discount-feedback";
import { createClient, getSharedSession } from "@/lib/supabase-browser";
import { discountState, type DiscountLesson, type DiscountRequestRow, type DiscountState } from "@/lib/world/discount";
import type { DiscountFeedbackAnswer, DiscountFeedbackQuestion } from "@/types/database";

/**
 * The student's early-finish discount, for the map (WorldMap.tsx passes it on
 * as WorldSource.discount).
 *
 * The state is discountState() (src/lib/world/discount.ts) over what the app
 * already holds: AuthContext's student (first_paid_at), StudentContext's
 * discount request and its membershipDiscounted (a discount already on the
 * student's next Whop renewal, admin rebuild 2 D5), the catalog's lessons (is_gate, has_video,
 * duration_seconds, counts_toward_progress, in course order) and the lessons
 * whose video is done (watchedLessonIds: completed_at set, action half or
 * not). It is worked out again every minute, so "11 days left" and the
 * window's end keep up with the clock.
 *
 * APPLY OPENS THE QUESTIONS (2026-10-14). The old dashboard sent every
 * application through its 6-question form (DiscountFeedbackModal), and the
 * team reads the answers. So does the map: Apply opens the form
 * (WorldDiscountForm.tsx, mounted by WorldMap.tsx, its open state here as
 * `form`) with the active questions StudentContext already loads
 * (discountFeedbackQuestions), and the form sends them with the application
 * through StudentContext.submitDiscountFeedback (/api/discounts/submit-feedback,
 * which on the new course checks the same rule as a plain request). On
 * success the form closes and the state turns to "in review".
 *
 * WITH NONE HELD Apply first reads them again
 * (StudentContext.loadDiscountFeedbackQuestions): the visit's own read may
 * have failed, and a plain request carries no answers (since the owner's
 * review of 2026-10-21 /api/discounts/request refuses one while a required
 * question is active; before, it took one whether or not there were
 * questions). A read that fails sends nothing and says so; one that finds
 * some opens the form.
 *
 * WITH NO ACTIVE QUESTIONS Apply sends the plain request: it posts to
 * /api/discounts/request exactly as the old dashboard's
 * StudentContext.requestDiscount does (the session's Bearer token, the
 * student's id in the body; the route derives the student from the token).
 * It does not call requestDiscount itself: that one returns at once unless the
 * old course's R1 + R2 are done (StudentContext discountEligible), so on the
 * new course it would never send anything, and it reports failures with
 * window.alert.
 *
 * EITHER WAY, what went in is kept here (`sent`) until StudentContext brings
 * a request it did not have before, so the panel turns to "in review" at once
 * and a later approval read from StudentContext is never hidden behind it.
 *
 * THE DEVELOPMENT PAGE provides DiscountStandInContext (its first payment,
 * its requests, its questions, an Apply and a submit that resolve in memory,
 * and for an expired student a clock past the 14 days) and this hook then
 * reads no student and calls no route.
 */

export interface DiscountStandIn {
  firstPaidAt: string | null;
  /** The pretend student's Whop membership already has a discount on its next renewal (D5). Left out: none. */
  membershipDiscounted?: boolean;
  /**
   * The pretend student's clock (ms), when it is not the real one: a student
   * whose 14 days are over can only be shown on a clock past them, and until
   * 2026-10-23 no first payment since the launch is 14 days old.
   */
  now?: number;
  requests: readonly DiscountRequestRow[];
  /** The plain request. Resolves null when the application went in, else the words to show. */
  apply(): Promise<string | null>;
  /** The active questions, any order. None: Apply sends the plain request. */
  questions: readonly DiscountFeedbackQuestion[];
  /** The application with the answers. Resolves null when it went in, else the words to show. */
  submit(answers: DiscountFeedbackAnswer[]): Promise<string | null>;
}

/** The development page's pretend student's discount. /world provides nothing. */
export const DiscountStandInContext = createContext<DiscountStandIn | null>(null);

/** The questions' form, as WorldDiscountForm.tsx reads it. */
export interface DiscountFormState {
  open: boolean;
  /** The active questions in the team's order. */
  questions: readonly DiscountFeedbackQuestion[];
  close(): void;
  /** Sends the application with the answers. Null when it went in (the form then closes), else the words to show. */
  submit(answers: DiscountFeedbackAnswer[]): Promise<string | null>;
}

export interface WorldDiscountHook {
  state: DiscountState;
  now: number;
  /** Opens the questions, or with none sends the plain request. Null unless there are words to show. */
  apply(): Promise<string | null>;
  form: DiscountFormState;
}

/** What went in from this page, and the request StudentContext had at that moment. */
interface Sent {
  row: DiscountRequestRow;
  /** StudentContext's request id when it was sent (null: none). Once it holds another, it has caught up. */
  over: string | null;
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
  const { lessons, discountRequest, watchedLessonIds: videoDone } = ctx;

  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), MINUTE_MS);
    return () => window.clearInterval(id);
  }, []);
  // The development page's clock when it has one (an expired student), else the real one.
  const now = stand?.now ?? tick;

  /** What this page sent, until StudentContext has a request it did not have then. */
  const [sent, setSent] = useState<Sent | null>(null);
  const [formOpen, setFormOpen] = useState(false);

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
  // D5: the stored flag /api/student/data carries (StudentContext), or the stand-in's.
  const membershipDiscounted = stand ? stand.membershipDiscounted === true : ctx.membershipDiscounted === true;
  const requestId = discountRequest?.id ?? null;
  const requests = useMemo<readonly DiscountRequestRow[]>(() => {
    if (stand) return stand.requests;
    const out: DiscountRequestRow[] = [];
    if (discountRequest) out.push(discountRequest);
    // Until StudentContext holds a request it did not hold when this was sent.
    if (sent && requestId === sent.over && sent.row.id !== requestId) out.push(sent.row);
    return out;
  }, [stand, discountRequest, requestId, sent]);

  const state = useMemo(
    () =>
      discountState({ now: new Date(now), firstPaidAt, lessons: courseLessons, videoDoneIds: videoDone, requests, membershipDiscounted }),
    [now, firstPaidAt, courseLessons, videoDone, requests, membershipDiscounted],
  );

  // The questions: the stand-in's, or the active ones StudentContext loaded
  // (the development page's context has none of its own).
  const { discountFeedbackQuestions, loadDiscountFeedbackQuestions, submitDiscountFeedback } = ctx;
  const questions = useMemo(
    () => sortQuestions(stand ? stand.questions : (discountFeedbackQuestions ?? [])),
    [stand, discountFeedbackQuestions],
  );

  const studentId = student?.id ?? null;

  /** The plain request, for a course with no active questions. */
  const sendPlain = useCallback(async (): Promise<string | null> => {
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
      setSent({ row: row ?? pendingNow(), over: requestId });
      return null;
    } catch {
      return NO_REACH;
    }
  }, [stand, studentId, requestId]);

  const apply = useCallback(async (): Promise<string | null> => {
    if (questions.length === 0 && !stand) {
      // None held: StudentContext's read may have failed, or never run (a
      // failed first load). Read them now, so an application never goes in
      // without the form while the team has questions (map-1, 2026-10-20).
      const read = await loadDiscountFeedbackQuestions?.();
      if (!read) return NO_REACH;
      if (read.length > 0) {
        setFormOpen(true);
        return null;
      }
    }
    if (questions.length === 0) return sendPlain();
    setFormOpen(true);
    return null;
  }, [questions.length, stand, loadDiscountFeedbackQuestions, sendPlain]);

  const close = useCallback(() => setFormOpen(false), []);

  const submit = useCallback(
    async (answers: DiscountFeedbackAnswer[]): Promise<string | null> => {
      let said: string | null;
      if (stand) {
        said = await stand.submit(answers);
      } else if (!studentId || !submitDiscountFeedback) {
        said = SIGNED_OUT;
      } else {
        // StudentContext's submit reads the new request back before it
        // resolves; when that read fails, `sent` shows it until it arrives.
        const over = requestId;
        try {
          said = await submitDiscountFeedback(answers);
        } catch {
          said = NO_REACH;
        }
        if (said === null) setSent({ row: pendingNow(), over });
      }
      if (said === null) setFormOpen(false);
      return said;
    },
    [stand, studentId, submitDiscountFeedback, requestId],
  );

  const form = useMemo<DiscountFormState>(
    () => ({ open: formOpen, questions, close, submit }),
    [formOpen, questions, close, submit],
  );

  return { state, now, apply, form };
}

/** An application sent just now, before its row is known. */
function pendingNow(): DiscountRequestRow {
  return { id: "sent", status: "pending", created_at: new Date().toISOString() };
}
