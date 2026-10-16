"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { DiscountApprovedCelebration } from "@/components/map/DiscountApprovedCelebration";
import {
  approvalToCelebrate,
  DISCOUNT_APPROVED_LAST_SEEN_KEY,
  streakLastSeenKey,
  streakToCelebrate,
} from "@/lib/world/celebrations";

/**
 * The old dashboard's two moments, on the map (2026-10-14; the streak's made
 * quiet on 2026-10-15). Same triggers and same browser keys as
 * src/app/dashboard/page.tsx (src/lib/world/celebrations.ts holds the rules),
 * so one already seen on the dashboard is not shown again here, and the other
 * way round.
 *
 * THE DISCOUNT. The dashboard's full-screen celebration
 * (DiscountApprovedCelebration), the first time this browser sees the
 * student's application approved: WorldCelebrations, mounted beside the map.
 * The approval is the map's own discount state (useWorldDiscount.ts), so a
 * request from before the new course, which the map never shows, is not
 * celebrated either.
 *
 * THE STREAK. No full-screen moment (Lovro, 2026-10-15, brand_fit.md
 * decision 11, B: a daily tick is routine; the full-screen moment is kept for
 * an approved discount, and later a finished place). When the streak goes past
 * the one last celebrated in this browser, the number in the header's pill
 * changes with a moment of STREAK_MOMENT_MS: useStreakMoment, below, which the
 * pill (WorldCorner.tsx) calls. The streak is StudentContext's, which a
 * finished video refreshes (markWatched), and the map hides its whole header
 * under a lesson page, so the moment waits for the map, as the corner's toast
 * does. Since 2026-10-16 it plays only where the number can be seen (unseen,
 * below): not under the map's loading screen, not through Creative Strategy's
 * telescope, where the header's group steps out, not under a phone's sheet
 * nor on a phone's list scrolled past the header (a review found the
 * telescope; the other three played unseen too, and were marked seen). One at
 * a time, as before: it waits while the discount's full-screen moment is up
 * too. The dashboard keeps its full-screen StreakCelebration.
 *
 * The dashboard's two test events fire them too and record nothing:
 * `et:test:streak` plays the header's moment on the number shown (the event's
 * number is not shown: the header shows the real streak), and
 * `et:test:discount-approved` the discount's celebration.
 *
 * Nothing fires until the student's data has loaded. THE DEVELOPMENT PAGE has
 * no signed-in student, so nothing fires there unless it provides
 * CelebrationStandInContext (?celebrate=1), whose pretend student stands in.
 */

/** The development page's pretend student, for the triggers. /world provides nothing. */
export const CelebrationStandInContext = createContext<{ studentId: string } | null>(null);

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or storage off: it may show again on the next load, as on the dashboard.
  }
}

/** How long the streak's moment in the header lasts, ms (Lovro: 600 at most). corner.module.css's tickIn runs as long. */
export const STREAK_MOMENT_MS = 600;

// Whether the discount's full-screen celebration is up, so the header's streak
// moment can wait for it. The two live apart (beside the map, inside its
// header), so the one flag is a store of this module's.
let fullScreenUp = false;
const fullScreenWatchers = new Set<() => void>();
function setFullScreenUp(up: boolean) {
  if (fullScreenUp === up) return;
  fullScreenUp = up;
  for (const w of fullScreenWatchers) w();
}
function watchFullScreen(w: () => void) {
  fullScreenWatchers.add(w);
  return () => {
    fullScreenWatchers.delete(w);
  };
}
const fullScreenNow = () => fullScreenUp;
const fullScreenOnServer = () => false;

/** The streak's moment, for the number in the header's pill (WorldCorner.tsx). */
export interface StreakMoment {
  /** Counts the moments; a new one starts the number's animation again. */
  seq: number;
  /** Playing now, for STREAK_MOMENT_MS. */
  on: boolean;
  /** For the pill's status line: what the last moment said, "" before the first. */
  say: string;
}

/** How long the map's loading screen fades once the world is ready, ms (world.module.css, `.loading`'s opacity transition). */
const LOADER_FADE_MS = 700;

/**
 * Why the streak's number cannot be seen now, or null when it can. "loading":
 * the map's loading screen covers the page while the view is not known yet
 * and while the world builds (`data-loading` on WorldV6's root); in the world
 * view it then fades for LOADER_FADE_MS, and a fading screen takes no pointer,
 * so the test below would pass under it. "covered": the top of the page at the
 * number's centre is not the pill's button it sits in, or that point is off
 * the screen: through Creative Strategy's telescope (corner.module.css steps
 * the group out), under a phone's place or checkpoint sheet, on a phone's list
 * scrolled past the header. A moment played then would go unseen.
 */
function unseen(seg: HTMLElement | null): "loading" | "covered" | null {
  if (!seg) return null;
  const root = seg.closest<HTMLElement>("main[data-view]");
  if (root && (root.dataset.view === "unknown" || root.hasAttribute("data-loading"))) return "loading";
  const r = seg.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return top !== null && (seg.closest("button") ?? seg).contains(top) ? null : "covered";
}

/**
 * When the number in the header's pill gets its moment: the streak went past
 * the one last celebrated in this browser (streakToCelebrate), or the
 * dashboard's `et:test:streak` came. `paused`: a lesson page is open, where the
 * map hides its header; the moment waits until the map is back, and the
 * browser key is written only once it has played. `seg`: the streak's segment
 * in the pill (its flame and number), which must be in sight (unseen).
 */
export function useStreakMoment(paused: boolean, seg: RefObject<HTMLElement | null>): StreakMoment {
  const stand = useContext(CelebrationStandInContext);
  const { student } = useAuth();
  const { loading, streak } = useStudent();
  const studentId = stand ? stand.studentId : (student?.id ?? null);
  const ready = !loading && studentId !== null;
  const current = streak?.current ?? 0;
  const held = useSyncExternalStore(watchFullScreen, fullScreenNow, fullScreenOnServer);

  /** Due and not played yet. `n` null: a test event's, on the number shown then. `record`: write the browser key as it plays (a test event does not). */
  const [due, setDue] = useState<{ n: number | null; record: boolean } | null>(null);
  const [moment, setMoment] = useState<{ seq: number; on: boolean; n: number; record: boolean } | null>(null);
  /** The input last decided on, so each change is looked at once. */
  const [asked, setAsked] = useState<string | null>(null);

  // Decided while rendering, as useWorldBadges decides what is fresh: the
  // browser key is only read here and only written once the moment plays.
  const sig = ready ? `${studentId}:${current}` : null;
  if (sig !== null && sig !== asked) {
    setAsked(sig);
    const n = streakToCelebrate(current, readKey(streakLastSeenKey(studentId!)));
    if (n !== null) setDue({ n, record: true });
  }

  // Played once the number can be seen: no lesson page over the map, no
  // full-screen celebration over it, and nothing else (unseen). A task later,
  // so a celebration decided in the same commit (WorldCelebrations comes after
  // the map) is up by then and this waits for it to close. While something
  // hides the number, the moment stays due, and the page's elements, its
  // scroll and its size are watched until nothing does; nothing is watched the
  // rest of the time.
  const canPlay = due !== null && !paused && !held;
  useEffect(() => {
    if (!canPlay || due === null) return;
    const el = seg.current;
    const root = el?.closest<HTMLElement>("main[data-view]") ?? null;
    const dom = new MutationObserver(play);
    let watching = false;
    let fade = 0;
    let loaded = false;
    function watch(on: boolean) {
      if (on === watching) return;
      watching = on;
      if (on) {
        // The whole page, since what covers the number may live beside the map (a dialog, the discount form).
        dom.observe(document.body, { subtree: true, childList: true, attributeFilter: ["data-view", "data-loading", "data-tel"] });
        window.addEventListener("scroll", play, { capture: true, passive: true });
        window.addEventListener("resize", play, { passive: true });
      } else {
        dom.disconnect();
        window.removeEventListener("scroll", play, { capture: true });
        window.removeEventListener("resize", play);
      }
    }
    function play() {
      if (fullScreenNow() || due === null) return;
      const why = unseen(el);
      if (why !== null) {
        if (why === "loading") loaded = true;
        watch(true);
        return;
      }
      watch(false);
      if (loaded && root?.dataset.view === "world") {
        // The loading screen fades out over the header first (a phone has none).
        loaded = false;
        fade = window.setTimeout(play, LOADER_FADE_MS);
        return;
      }
      setDue(null);
      setMoment((m) => ({ seq: (m?.seq ?? 0) + 1, on: true, n: due.n ?? current, record: due.record }));
    }
    const t = window.setTimeout(play, 0);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(fade);
      watch(false);
    };
  }, [canPlay, due, current, seg]);

  // Played: recorded (the dashboard's key), and over after STREAK_MOMENT_MS.
  useEffect(() => {
    if (!moment?.on) return;
    if (moment.record && studentId) writeKey(streakLastSeenKey(studentId), String(moment.n));
    const t = window.setTimeout(() => setMoment((m) => (m ? { ...m, on: false } : m)), STREAK_MOMENT_MS);
    return () => window.clearTimeout(t);
  }, [moment, studentId]);

  // The dashboard's test event (DevTestPanel): the moment on the number shown.
  // A real one already due keeps its place.
  useEffect(() => {
    const onTest = () => setDue((d) => d ?? { n: null, record: false });
    window.addEventListener("et:test:streak", onTest);
    return () => window.removeEventListener("et:test:streak", onTest);
  }, []);

  return {
    seq: moment?.seq ?? 0,
    on: moment?.on ?? false,
    say: moment ? `Streak: ${moment.n} ${moment.n === 1 ? "day" : "days"}.` : "",
  };
}

export function WorldCelebrations({ approvedRequestId }: { approvedRequestId: string | null }) {
  const stand = useContext(CelebrationStandInContext);
  const { student } = useAuth();
  const { loading } = useStudent();
  const studentId = stand ? stand.studentId : (student?.id ?? null);
  const ready = !loading && studentId !== null;

  /** On screen. `id` null: a test event's, not recorded. */
  const [approvalShown, setApprovalShown] = useState<{ id: string | null } | null>(null);
  /** The input last decided on, so each change is looked at once. */
  const [approvalAsked, setApprovalAsked] = useState<string | null>(null);

  // Decided while rendering, as useWorldBadges decides what is fresh: the
  // browser key is only read here and only written after the commit, below.
  const approvalSig = ready ? approvedRequestId : null;
  if (approvalSig !== null && approvalSig !== approvalAsked) {
    setApprovalAsked(approvalSig);
    if (approvalToCelebrate(approvalSig, readKey(DISCOUNT_APPROVED_LAST_SEEN_KEY))) setApprovalShown({ id: approvalSig });
  }

  useEffect(() => {
    if (approvalShown?.id) writeKey(DISCOUNT_APPROVED_LAST_SEEN_KEY, approvalShown.id);
  }, [approvalShown]);

  // While it is up, the header's streak moment waits (useStreakMoment).
  const up = approvalShown !== null;
  useEffect(() => {
    setFullScreenUp(up);
    return () => setFullScreenUp(false);
  }, [up]);

  // The dashboard's test event (DevTestPanel), heard here too.
  useEffect(() => {
    const onApproved = () => setApprovalShown({ id: null });
    window.addEventListener("et:test:discount-approved", onApproved);
    return () => window.removeEventListener("et:test:discount-approved", onApproved);
  }, []);

  return <DiscountApprovedCelebration show={up} onDismiss={() => setApprovalShown(null)} />;
}
