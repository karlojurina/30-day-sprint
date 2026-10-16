/**
 * What the map shows of the discount, from the student's DiscountState
 * (src/lib/world/discount.ts): the header's chip, the timeline's tag, the
 * marker's label in the world, the panel's deadline, and the trail cache's
 * look (src/lib/world-v6/checkpoint.ts). Pure, so node can test it.
 *
 * IT SHOWS AT ALL TIMES (Lovro's second Loom, 2026-10-16: "it should be
 * clickable at all times, but the actual button to click on apply for the
 * discount ... should be locked"). The chip, the tag and the marker show for
 * every student and state, and each opens the panel, which says where the
 * student stands. This replaces the 2026-10-14 call (morning_review.md M7),
 * which hid all three when the offer was closed for the student. What they
 * say:
 *   locked        "11 days left"; the plaque says "30% off" alone (its "11d"
 *                 read as "110" at the plaque's size, and the chip above has
 *                 the days).
 *   ready         "Apply · 9 days left" (the plaque "Apply").
 *   pending       "In review"; approved, "Approved".
 *   applied       "Yours".
 *   rejected      "Not approved".
 *   expired       "Closed": the 14 days passed with no application.
 *   not eligible  "Closed": joined before the new course, or no first payment
 *                 on record. "Not open yet" when the course has no gate.
 * Closed, rejected and not eligible take the grey look (tag "closed").
 */
import { DISCOUNT_PERCENT, type DiscountState } from "@/lib/world/discount";
import type { CheckpointLook } from "@/lib/world-v6/checkpoint";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** A student this many videos away (or in Video Ads II itself) sees the cache's lantern lit. */
export const NEAR_LESSONS = 3;

export type CheckpointTag = "locked" | "ready" | "pending" | "done" | "closed";

export interface CheckpointView {
  /** The header's chip: "30% off" and where it stands. */
  chip: { lead: string; tail: string; ready: boolean };
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
        // No time left on this clock: the window ends within the minute, so it reads as closed.
        chip: { lead, tail: left ?? "Closed", ready: false },
        label: { lead, tail: "" },
        tag: "locked",
        look: near ? "near" : "closed",
        left,
        deadline: shortDate(state.endsAt),
      };
    }
    case "ready": {
      const left = timeLeft(state.endsAt, now);
      return {
        chip: { lead, tail: left ? `Apply · ${left}` : "Apply", ready: true },
        label: { lead, tail: "Apply" },
        tag: "ready",
        look: "ready",
        left,
        deadline: shortDate(state.endsAt),
      };
    }
    case "pending":
      return noClock(lead, "In review", "pending", "claimed");
    case "approved":
      return noClock(lead, "Approved", "pending", "claimed");
    case "applied":
      return noClock(lead, "Yours", "done", "claimed");
    case "rejected":
      return noClock(lead, "Not approved", "closed", "closed");
    case "expired":
      return { ...noClock(lead, "Closed", "closed", "closed"), deadline: shortDate(state.endsAt) };
    default:
      return noClock(lead, state.reason === "no-gate" ? "Not open yet" : "Closed", "closed", "closed");
  }
}

/** A state with no clock: the chip and the plaque say the same word. */
function noClock(lead: string, tail: string, tag: CheckpointTag, look: CheckpointLook): CheckpointView {
  return { chip: { lead, tail, ready: false }, label: { lead, tail }, tag, look, left: null, deadline: null };
}
