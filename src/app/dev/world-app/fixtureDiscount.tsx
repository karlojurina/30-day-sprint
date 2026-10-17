"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DiscountStandInContext, type DiscountStandIn } from "@/components/world/useWorldDiscount";
import { DISCOUNT_LAUNCH_DATE, requiredLessons, type DiscountLesson, type DiscountRequestRow } from "@/lib/world/discount";
import type { CatalogLessonLike } from "@/lib/world/catalog";
import type { DiscountFeedbackAnswer, DiscountFeedbackQuestion } from "@/types/database";

const NO_QUESTIONS: readonly DiscountFeedbackQuestion[] = [];

/**
 * The pretend student's early-finish discount on /dev/world-app
 * (FixtureStudentProvider.tsx), so every state of the checkpoint can be seen
 * and tested with no server: ?discount=<preset>, best with ?catalog=course.
 *
 *   ?discount=locked         first payment 3 days ago (11 days left), videos
 *                            as the ?p= preset has them
 *   ?discount=ready          first payment 5 days ago, every video the offer
 *                            asks for watched (added to the ?p= preset)
 *   ?discount=pending        as ready, and an application sent 2 hours ago
 *   ?discount=approved       as ready, and the application approved
 *   ?discount=applied        as ready, and the 30% on the Whop subscription
 *   ?discount=rejected       as ready, and the application not approved, with
 *                            the team's reason
 *   ?discount=expired        first payment 20 days ago, nothing applied for
 *                            (never before the launch: until 2026-10-29 the
 *                            payment is the day after it and this student's
 *                            clock runs on to day 20)
 *   ?discount=before-launch  first payment on 2026-09-05, before 9 September,
 *                            the earliest first payment that can earn it
 *   ?discount=september      first payment on 2026-09-15, after 9 September
 *                            and before the launch, so the deadline is the
 *                            shared one, the end of 23 October (discount.ts);
 *                            videos as ?p= has them. This student's clock is
 *                            held at 19 October, 10:00 in Croatia (the morning
 *                            the app reopens), so on any day the panel reads
 *                            "Apply by Fri 23 Oct" and "5 days left"
 *   ?discount=september-expired  the same student on 24 October, 10:00 in
 *                            Croatia: the shared deadline has passed
 *   ?discount=no-payment     no first payment on record
 *   no ?discount             as locked: a first payment 3 days ago, videos as
 *                            ?p= has them, so the 30% shows with no parameter
 *                            (2026-10-16, Lovro's second Loom: he reviewed
 *                            the plain page, where it showed nothing). Mark
 *                            every video the offer asks for watched and it
 *                            turns ready, as for a real student.
 *
 * THE QUESTIONS. Apply opens the application's questions
 * (src/components/world/WorldDiscountForm.tsx), as on /world. They are the
 * six the database was seeded with (supabase/migrations/2026_v29, a scale, two
 * choices, three optional texts), unless:
 *
 *   ?questions=none          no active questions: Apply sends the plain
 *                            request, as /world does then
 *   ?questions=fail          the six, and sending them is refused with the
 *                            words a failed request shows
 *
 * Sending resolves in memory after 600 ms: the application turns pending, as
 * the route's row would, and the answers are kept. So does the plain Apply. No
 * request leaves the page. The clock is the page's load time, so the days
 * left do not drift while a test runs.
 *
 * window.__fixtureDiscount, for the browser run: the preset, the requests,
 * the answers sent (one array per application) and how many plain requests
 * went in.
 */

export type DiscountPreset =
  | "locked"
  | "ready"
  | "pending"
  | "approved"
  | "applied"
  | "rejected"
  | "expired"
  | "before-launch"
  | "september"
  | "september-expired"
  | "no-payment";
const PRESETS: readonly DiscountPreset[] = [
  "locked", "ready", "pending", "approved", "applied", "rejected", "expired",
  "before-launch", "september", "september-expired", "no-payment",
];
/** The presets with an application in, and its status. Their student has watched every video the offer asks for. */
const APPLIED: Partial<Record<DiscountPreset, DiscountRequestRow["status"]>> = {
  pending: "pending",
  approved: "approved",
  applied: "applied",
  rejected: "rejected",
};
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** The pretend Apply's wait, so the button's sending state can be seen. */
const APPLY_MS = 600;
/** ?questions=fail: what the form shows (the words useWorldDiscount gives a request that never arrived). */
const SEND_REFUSED = "Couldn't reach the server. Try again in a moment.";
/** ?discount=rejected: the team's reason, as the admin's reject box would send it. */
const FIXTURE_REJECTION = "Several of the videos were skipped through in under a minute.";
/** ?discount=september and september-expired: a first payment between 9 September and the launch. */
const SEPTEMBER_PAID = "2026-09-15T10:00:00.000Z";
/** Their clocks: 19 October, 10:00 in Croatia (CEST, UTC+2), the morning the app reopens; and 24 October, 10:00. */
const SEPTEMBER_CLOCK = Date.parse("2026-10-19T08:00:00.000Z");
const SEPTEMBER_EXPIRED_CLOCK = Date.parse("2026-10-24T08:00:00.000Z");

/** The six questions v29 seeded, as discount_feedback_questions rows. */
const QUESTIONS: readonly DiscountFeedbackQuestion[] = [
  question(1, "On a scale of 1-10, how likely are you to recommend EcomTalent to a friend?", "scale", { min: 1, max: 10, required: true }),
  question(2, "Has the pace of the program felt right?", "multi_choice", {
    options: ["Way too fast", "A bit too fast", "Just right", "A bit too slow", "Way too slow"],
    required: true,
  }),
  question(3, "How would you rate the feedback you've gotten from the coaches on your ads?", "multi_choice", {
    options: ["Haven't gotten feedback yet", "Not helpful", "Somewhat helpful", "Very helpful", "Game-changing"],
    required: true,
  }),
  question(4, "What's been your biggest win in the program so far?", "open_text"),
  question(5, "What's been the most frustrating or confusing part?", "open_text"),
  question(6, "If you could change ONE thing about the program, what would it be?", "open_text"),
];

function question(
  n: number,
  text: string,
  type: DiscountFeedbackQuestion["question_type"],
  o: { options?: string[]; min?: number; max?: number; required?: boolean } = {},
): DiscountFeedbackQuestion {
  return {
    id: `fixture-q${n}`,
    order_num: n,
    question_text: text,
    question_type: type,
    options: o.options ?? null,
    scale_min: o.min ?? null,
    scale_max: o.max ?? null,
    is_required: o.required ?? false,
    is_active: true,
    created_at: "2026-05-01T00:00:00.000Z",
  };
}

type QuestionsPreset = "six" | "none" | "fail";

function questionsPresetOf(search: string | null): QuestionsPreset {
  const v = search === null ? null : new URLSearchParams(search).get("questions");
  return v === "none" || v === "fail" ? v : "six";
}

export function discountPresetOf(search: string | null): DiscountPreset | null {
  if (search === null) return null;
  const v = new URLSearchParams(search).get("discount");
  return PRESETS.includes(v as DiscountPreset) ? (v as DiscountPreset) : null;
}

/**
 * The videos a preset needs watched on top of ?p=: for ready and every preset
 * with an application in, every lesson the offer asks for (discount.ts
 * requiredLessons), so the map's lanterns and counts agree with the panel.
 */
export function discountPresetIds(search: string | null, lessons: readonly CatalogLessonLike[]): string[] {
  const preset = discountPresetOf(search);
  if (preset === null || (preset !== "ready" && !APPLIED[preset])) return [];
  const course: DiscountLesson[] = [...lessons]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((l) => ({
      id: l.id,
      type: l.type,
      counts_toward_progress: l.counts_toward_progress !== false,
      is_gate: l.is_gate === true,
      has_video: l.has_video === true,
      duration_seconds: l.duration_seconds ?? null,
    }));
  return requiredLessons(course).map((l) => l.id);
}

type FixtureDiscountWindow = Window & {
  __fixtureDiscount?: {
    preset: DiscountPreset | null;
    requests: () => DiscountRequestRow[];
    answers: () => DiscountFeedbackAnswer[][];
    plain: () => number;
  };
};

export function FixtureDiscount({ search, children }: { search: string | null; children: ReactNode }) {
  const preset = discountPresetOf(search);
  const questionsPreset = questionsPresetOf(search);
  // The page's load time: the presets count from it.
  const [boot] = useState(() => Date.now());
  const [sent, setSent] = useState<DiscountRequestRow[]>([]);
  /** What each application carried, and how many went in with no questions. */
  const answersRef = useRef<DiscountFeedbackAnswer[][]>([]);
  const plainRef = useRef(0);

  // Expired: 20 days in, never before the launch (20 days back from today was,
  // until 2026-10-29, so the panel said "joined before the new course"). When
  // that puts the payment later than 20 days ago, this student's clock runs
  // ahead to day 20 (DiscountStandIn.now); the rest of the page keeps the real one.
  const expiredPaid = Math.max(boot - 20 * DAY_MS, Date.parse(DISCOUNT_LAUNCH_DATE) + DAY_MS);
  const now =
    preset === "expired" && expiredPaid + 20 * DAY_MS > boot
      ? expiredPaid + 20 * DAY_MS
      : preset === "september"
        ? SEPTEMBER_CLOCK
        : preset === "september-expired"
          ? SEPTEMBER_EXPIRED_CLOCK
          : undefined;

  const firstPaidAt = useMemo(() => {
    switch (preset) {
      case "ready":
        return new Date(boot - 5 * DAY_MS).toISOString();
      case "pending":
      case "approved":
      case "applied":
      case "rejected":
        return new Date(boot - 6 * DAY_MS).toISOString();
      case "expired":
        return new Date(expiredPaid).toISOString();
      case "before-launch":
        return "2026-09-05T10:00:00.000Z";
      case "september":
      case "september-expired":
        return SEPTEMBER_PAID;
      case "no-payment":
        return null;
      default:
        // locked, and the page with no ?discount.
        return new Date(boot - 3 * DAY_MS).toISOString();
    }
  }, [preset, boot, expiredPaid]);

  const requests = useMemo<DiscountRequestRow[]>(() => {
    const at = new Date(boot - 2 * HOUR_MS).toISOString();
    const status = preset === null ? undefined : APPLIED[preset];
    const base: DiscountRequestRow[] = status
      ? [{ id: "fixture-request", status, created_at: at, rejection_reason: status === "rejected" ? FIXTURE_REJECTION : null }]
      : [];
    return [...base, ...sent];
  }, [preset, boot, sent]);

  const apply = useCallback(async (): Promise<string | null> => {
    await new Promise((r) => setTimeout(r, APPLY_MS));
    plainRef.current += 1;
    setSent((prev) => (prev.length ? prev : [{ id: "fixture-sent", status: "pending", created_at: new Date().toISOString() }]));
    return null;
  }, []);

  const questions = questionsPreset === "none" ? NO_QUESTIONS : QUESTIONS;
  const submit = useCallback(
    async (answers: DiscountFeedbackAnswer[]): Promise<string | null> => {
      await new Promise((r) => setTimeout(r, APPLY_MS));
      if (questionsPreset === "fail") return SEND_REFUSED;
      answersRef.current.push(answers);
      setSent((prev) => (prev.length ? prev : [{ id: "fixture-sent", status: "pending", created_at: new Date().toISOString() }]));
      return null;
    },
    [questionsPreset],
  );

  const value = useMemo<DiscountStandIn>(
    () => ({ firstPaidAt, now, requests, apply, questions, submit }),
    [firstPaidAt, now, requests, apply, questions, submit],
  );

  useEffect(() => {
    const w = window as FixtureDiscountWindow;
    w.__fixtureDiscount = {
      preset,
      requests: () => value.requests.slice(),
      answers: () => answersRef.current.map((a) => a.slice()),
      plain: () => plainRef.current,
    };
    return () => {
      delete w.__fixtureDiscount;
    };
  }, [preset, value]);

  return <DiscountStandInContext.Provider value={value}>{children}</DiscountStandInContext.Provider>;
}
