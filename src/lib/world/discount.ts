/**
 * The early-finish discount: where a student stands, in one pure function.
 *
 * The offer (Lovro, 2026-10-14): 30% off when the student has watched every
 * video up to the discount checkpoint, which sits between Video Ads II (the
 * Trail Hut) and Static Ads (the Boathouse), within 14 days of their first
 * payment. Only students whose first payment is on or after the day the new
 * course launched (9 October 2026, from midnight in Croatia) can earn it.
 *
 * "The videos up to the checkpoint" are the counting watch lessons, in course
 * order, up to and including the gate lesson (`is_gate`), that have a video.
 * A lesson with no video yet cannot be watched, so it is not asked for. An
 * action item with a video counts once its video is done; its link half is
 * not asked for here.
 *
 * Shared by the map (what the student sees) and the request route (what the
 * server allows), so the two can never disagree about who is ready.
 */

import { DISCOUNT_WINDOW_DAYS } from "@/lib/constants";

export const DISCOUNT_PERCENT = 30;
/** The 14 days. One source: constants.ts, re-exported here for the map. */
export { DISCOUNT_WINDOW_DAYS };
/**
 * The new course launched on Whop on 9 October 2026; earlier buyers bought the
 * old course. The cutoff is midnight that day in Croatia: 9 October 00:00 CEST
 * (UTC+2) is 8 October 22:00 UTC. Shown to students as a date in
 * Europe/Zagreb, never UTC, or it would read "October 8".
 */
export const DISCOUNT_LAUNCH_DATE = "2026-10-08T22:00:00.000Z";

const DAY_MS = 86_400_000;

export interface DiscountLesson {
  id: string;
  type: string;
  counts_toward_progress: boolean;
  is_gate: boolean;
  has_video: boolean;
  duration_seconds: number | null;
}

export interface DiscountRequestRow {
  id: string;
  status: "pending" | "approved" | "rejected" | "applied";
  created_at: string;
  promo_code?: string | null;
  rejection_reason?: string | null;
}

export type DiscountState =
  /** "no-gate" also covers a gate with no video up to it: there is nothing to reach. */
  | { kind: "not-eligible"; reason: "no-payment" | "before-launch" | "no-gate" }
  | { kind: "expired"; endsAt: string; lessonsLeft: number }
  | {
      kind: "locked";
      endsAt: string;
      lessonsLeft: number;
      lessonsTotal: number;
      secondsLeft: number;
      nextLessonId: string | null;
    }
  | { kind: "ready"; endsAt: string; lessonsTotal: number }
  | {
      kind: "pending" | "approved" | "applied" | "rejected";
      requestId: string;
      at: string;
      promoCode: string | null;
      rejectionReason: string | null;
    };

export interface DiscountInput {
  now: Date;
  firstPaidAt: string | null;
  /** The catalog's lessons in course order (all areas, `sort_order` ascending). */
  lessons: readonly DiscountLesson[];
  /** Lessons whose video is done (`completed_at` set), action half or not. */
  videoDoneIds: ReadonlySet<string>;
  /** The student's discount requests, any order. Those created before DISCOUNT_LAUNCH_DATE are ignored. */
  requests: readonly DiscountRequestRow[];
}

/** The gate lesson's id, or null when the catalog has none (the offer is then closed). */
export function gateLessonId(lessons: readonly DiscountLesson[]): string | null {
  return lessons.find((l) => l.is_gate)?.id ?? null;
}

/** The lessons the offer asks for, in course order. Empty when there is no gate. */
export function requiredLessons(lessons: readonly DiscountLesson[]): DiscountLesson[] {
  const gate = lessons.findIndex((l) => l.is_gate);
  if (gate < 0) return [];
  return lessons
    .slice(0, gate + 1)
    .filter((l) => l.type === "watch" && l.counts_toward_progress && l.has_video);
}

/** When the offer ends for this student, or null without a first payment. */
export function discountEndsAt(firstPaidAt: string | null): Date | null {
  if (!firstPaidAt) return null;
  const t = Date.parse(firstPaidAt);
  if (!Number.isFinite(t)) return null;
  return new Date(t + DISCOUNT_WINDOW_DAYS * DAY_MS);
}

export function discountState(input: DiscountInput): DiscountState {
  const { now, firstPaidAt, lessons, videoDoneIds, requests } = input;

  // A request already made decides the state, whatever the clock says now.
  // Only a request made on the new course: one created before the launch was
  // made on the old course (a June student's approved June request), and the
  // new map never shows it. A date that does not parse is not counted.
  const launch = Date.parse(DISCOUNT_LAUNCH_DATE);
  const latest = requests
    .filter((r) => Date.parse(r.created_at) >= launch)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (latest) {
    return {
      kind: latest.status,
      requestId: latest.id,
      at: latest.created_at,
      promoCode: latest.promo_code ?? null,
      rejectionReason: latest.rejection_reason ?? null,
    };
  }

  const endsAt = discountEndsAt(firstPaidAt);
  if (!firstPaidAt || !endsAt) return { kind: "not-eligible", reason: "no-payment" };
  if (Date.parse(firstPaidAt) < Date.parse(DISCOUNT_LAUNCH_DATE)) {
    return { kind: "not-eligible", reason: "before-launch" };
  }
  if (!gateLessonId(lessons)) return { kind: "not-eligible", reason: "no-gate" };

  const required = requiredLessons(lessons);
  // A gate with not one video up to it (the videos not loaded yet, or a
  // failed lesson_videos read upstream) would otherwise make every student
  // "ready" on day one. Nothing to reach is the same as no checkpoint.
  if (required.length === 0) return { kind: "not-eligible", reason: "no-gate" };
  const left = required.filter((l) => !videoDoneIds.has(l.id));

  if (now.getTime() > endsAt.getTime()) {
    return { kind: "expired", endsAt: endsAt.toISOString(), lessonsLeft: left.length };
  }
  if (left.length === 0) {
    return { kind: "ready", endsAt: endsAt.toISOString(), lessonsTotal: required.length };
  }
  return {
    kind: "locked",
    endsAt: endsAt.toISOString(),
    lessonsLeft: left.length,
    lessonsTotal: required.length,
    secondsLeft: left.reduce((sum, l) => sum + (l.duration_seconds ?? 0), 0),
    nextLessonId: left[0]?.id ?? null,
  };
}
