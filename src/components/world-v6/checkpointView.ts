/**
 * What the map shows of the discount, from the student's DiscountState
 * (src/lib/world/discount.ts): the header's chip, the timeline's tag, the
 * marker's label in the world, the panel's deadline, and the trail cache's
 * look (src/lib/world-v6/checkpoint.ts). Pure, so node can test it.
 *
 * IT SHOWS AT ALL TIMES (Lovro's second Loom, 2026-10-16: "it should be
 * clickable at all times, but the actual button to click on apply for the
 * discount ... should be locked"). The tag on the timeline, the marker over
 * the cache and the phone's row show for every student and state, and each
 * opens the panel, which says where the student stands. This replaces the
 * 2026-10-14 call (morning_review.md M7), which hid them when the offer was
 * closed for the student.
 *
 * THE HEADER'S CHIP KEEPS M7's RULE (`header`): it shows only while the offer
 * is open to the student (locked, ready) or their application is in (in
 * review, approved). Applied, rejected, the student's deadline passed, a first
 * payment before 1 October, or no first payment on record: no chip, so a
 * student never carries a dead offer in the header for good (the fix round of
 * 2026-10-16; Lovro's words were about the hut and the timeline's dot line,
 * not the header).
 *
 * What they say (the chip, the tag's tip, the plaque, the phone's row and
 * the panel's eyebrow, one word per state):
 *   locked        "11 days left"; the plaque says "30% off" alone (its "11d"
 *                 read as "110" at the plaque's size, and the chip above has
 *                 the days).
 *   ready         "Apply · 9 days left" (the plaque "Apply").
 *   pending       "In review"; approved, "Approved".
 *   applied       "Yours".
 *   rejected      "Not approved".
 *   expired       "Closed": the student's deadline passed with no application.
 *   not eligible  "Closed": a first payment before 1 October. "Not open yet" when
 *                 the course has no gate. "Ask the team" with no first payment
 *                 on record, in the open (locked) look: it may be a new student
 *                 whose payment has not reached the app, and the panel asks
 *                 them to tell the team, so it never reads "Closed".
 * Closed, rejected and the other not eligible take the grey look (tag "closed").
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
  /** The header shows the chip: the offer is open to the student, or their application is in. */
  header: boolean;
  /** The marker's plaque: "30% off" and a short state beside it. */
  label: { lead: string; tail: string };
  tag: CheckpointTag;
  look: CheckpointLook;
  /** "11 days left", "5 hours left", or null when the clock does not apply. */
  left: string | null;
  /** The last moment to apply, "Fri 23 Oct, 23:59" in the student's own time zone (deadlineAt), or null. */
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
 * A deadline with its hour, "Fri 23 Oct, 23:59", in the student's own time
 * zone (T-080). The date alone misled: the shared deadline, the end of 23
 * October in Croatia, is Fri 23 Oct, 17:59 in New York and Sat 24 Oct, 05:59
 * in Manila, where it read "Sat 24 Oct" with no hour. The hour also fits the
 * own 14 days, which end at the hour of the first payment.
 */
export function deadlineAt(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
        header: true,
        label: { lead, tail: "" },
        tag: "locked",
        look: near ? "near" : "closed",
        left,
        deadline: deadlineAt(state.endsAt),
      };
    }
    case "ready": {
      const left = timeLeft(state.endsAt, now);
      return {
        chip: { lead, tail: left ? `Apply · ${left}` : "Apply", ready: true },
        header: true,
        label: { lead, tail: "Apply" },
        tag: "ready",
        look: "ready",
        left,
        deadline: deadlineAt(state.endsAt),
      };
    }
    case "pending":
      return noClock(lead, "In review", "pending", "claimed", true);
    case "approved":
      return noClock(lead, "Approved", "pending", "claimed", true);
    case "applied":
      return noClock(lead, "Yours", "done", "claimed");
    case "rejected":
      return noClock(lead, "Not approved", "closed", "closed");
    case "expired":
      return { ...noClock(lead, "Closed", "closed", "closed"), deadline: deadlineAt(state.endsAt) };
    default:
      // No first payment on record: what the panel asks of them, in the open look (above).
      if (state.reason === "no-payment") return noClock(lead, "Ask the team", "locked", "closed");
      return noClock(lead, state.reason === "no-gate" ? "Not open yet" : "Closed", "closed", "closed");
  }
}

/** A state with no clock: the chip and the plaque say the same word. The header shows it only when `header`. */
function noClock(lead: string, tail: string, tag: CheckpointTag, look: CheckpointLook, header = false): CheckpointView {
  return { chip: { lead, tail, ready: false }, header, label: { lead, tail }, tag, look, left: null, deadline: null };
}
