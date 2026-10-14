/**
 * What the map shows of the discount, from the student's DiscountState
 * (src/lib/world/discount.ts): the header's chip, the timeline's tag, the
 * marker's label in the world, the panel's deadline, and the trail cache's
 * look (src/lib/world-v6/checkpoint.ts). Pure, so node can test it.
 *
 * WHEN IT SHOWS (Claude's call, 2026-10-14, in morning_review.md):
 *   not eligible  nothing: no chip, no tag, no marker. A student who joined
 *                 before the new course, or whose first payment is not on
 *                 record, never had this offer; the cache stands closed as
 *                 scenery.
 *   expired       the same, quietly: the window passed with no application.
 *   locked        the chip counts the days down ("11 days left").
 *   ready         the chip says to apply, with the days left.
 *   pending       the chip says it is in review; approved, that it is approved.
 *   applied       no chip (it is done); the tag and the marker stay, claimed.
 *   rejected      no chip; the tag and the marker stay, so the panel can say
 *                 why.
 */
import { DISCOUNT_PERCENT, type DiscountState } from "@/lib/world/discount";
import type { CheckpointLook } from "@/lib/world-v6/checkpoint";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** A student this many videos away (or in Video Ads II itself) sees the cache's lantern lit. */
export const NEAR_LESSONS = 3;

export type CheckpointTag = "locked" | "ready" | "pending" | "done" | "closed";

export interface CheckpointView {
  /** The marker in the world and the tag on the timeline show at all. */
  shown: boolean;
  /** The header's chip ("30% off" and its tail), or null when it is hidden. */
  chip: { lead: string; tail: string; ready: boolean } | null;
  /** The marker's plaque: "30% off" and a short state beside it. */
  label: { lead: string; tail: string };
  tag: CheckpointTag;
  look: CheckpointLook;
  /** "11 days left", "5 hours left", or null when the clock does not apply. */
  left: string | null;
  /** The last day to apply, "Fri 23 Oct", or null. */
  deadline: string | null;
}

/** "11 days left", "1 day left", "5 hours left", "Under an hour left"; null once it has passed. */
export function timeLeft(endsAt: string, now: number): string | null {
  const ms = Date.parse(endsAt) - now;
  if (!(ms > 0)) return null;
  if (ms < HOUR_MS) return "Under an hour left";
  if (ms < DAY_MS) {
    const h = Math.ceil(ms / HOUR_MS);
    return `${h} hour${h === 1 ? "" : "s"} left`;
  }
  const d = Math.ceil(ms / DAY_MS);
  return `${d} day${d === 1 ? "" : "s"} left`;
}

/** The same, short, for the marker's plaque: "11d", "5h", "<1h"; "" once it has passed. */
export function timeLeftShort(endsAt: string, now: number): string {
  const ms = Date.parse(endsAt) - now;
  if (!(ms > 0)) return "";
  if (ms < HOUR_MS) return "<1h";
  if (ms < DAY_MS) return `${Math.ceil(ms / HOUR_MS)}h`;
  return `${Math.ceil(ms / DAY_MS)}d`;
}

/** "Fri 23 Oct", in the student's own time zone. */
export function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * The view for a state. `place` is the student's place on the map (0..8),
 * `after` the place the checkpoint follows (checkpoint.ts CHECKPOINT.after):
 * a locked student at that place, or a few videos away, sees the lantern lit.
 */
export function checkpointView(state: DiscountState, now: number, place: number, after: number): CheckpointView {
  const lead = `${DISCOUNT_PERCENT}% off`;
  switch (state.kind) {
    case "locked": {
      const left = timeLeft(state.endsAt, now);
      const near = place >= after || state.lessonsLeft <= NEAR_LESSONS;
      return {
        shown: true,
        chip: left ? { lead, tail: left, ready: false } : null,
        label: { lead, tail: timeLeftShort(state.endsAt, now) },
        tag: "locked",
        look: near ? "near" : "closed",
        left,
        deadline: shortDate(state.endsAt),
      };
    }
    case "ready": {
      const left = timeLeft(state.endsAt, now);
      return {
        shown: true,
        chip: { lead, tail: left ? `Apply · ${left}` : "Apply", ready: true },
        label: { lead, tail: "Apply" },
        tag: "ready",
        look: "ready",
        left,
        deadline: shortDate(state.endsAt),
      };
    }
    case "pending":
      return { shown: true, chip: { lead, tail: "In review", ready: false }, label: { lead, tail: "In review" }, tag: "pending", look: "claimed", left: null, deadline: null };
    case "approved":
      return { shown: true, chip: { lead, tail: "Approved", ready: false }, label: { lead, tail: "Approved" }, tag: "pending", look: "claimed", left: null, deadline: null };
    case "applied":
      return { shown: true, chip: null, label: { lead, tail: "Yours" }, tag: "done", look: "claimed", left: null, deadline: null };
    case "rejected":
      return { shown: true, chip: null, label: { lead, tail: "" }, tag: "closed", look: "closed", left: null, deadline: null };
    case "expired":
      return { shown: false, chip: null, label: { lead, tail: "" }, tag: "closed", look: "closed", left: null, deadline: shortDate(state.endsAt) };
    default:
      return { shown: false, chip: null, label: { lead, tail: "" }, tag: "closed", look: "closed", left: null, deadline: null };
  }
}
