"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { DiscountApprovedCelebration } from "@/components/map/DiscountApprovedCelebration";
import {
  approvalToCelebrate,
  DISCOUNT_APPROVED_LAST_SEEN_KEY,
  renewalStillAhead,
  streakLastSeenKey,
  streakToCelebrate,
} from "@/lib/world/celebrations";

/**
 * The old dashboard's two moments, on the map (2026-10-14; the streak's made
 * quiet on 2026-10-15). The same browser keys as src/app/dashboard/page.tsx
 * and, but for a streak after a break (below), the same triggers
 * (src/lib/world/celebrations.ts holds the rules), so one already seen on the
 * dashboard is not shown again here, and the other way round.
 *
 * THE DISCOUNT. The dashboard's full-screen celebration
 * (DiscountApprovedCelebration), the first time this browser sees the
 * student's application approved: WorldCelebrations, mounted beside the map.
 * The approval is the map's own discount state (useWorldDiscount.ts),
 * approved or applied since (celebrations.ts approvalOnMap, 2026-10-20: the
 * team often applies it in the same sitting, before the student is back on
 * the map); applied, its line says the 30% is on the next payment, so it
 * plays only within 5 days of the application, while that renewal is sure to
 * be still ahead (the same day's review: a second device or a wiped browser
 * key would replay it months later). An
 * application made before the launch, on the old dashboard (madeBeforeLaunch,
 * of a student who first paid from 1 October until the launch, which the map
 * shows since T-080), is not celebrated
 * here (WorldMap.tsx passes null): its 30% may already be on a past payment,
 * so the map's words, you'll see it on your next renewal, may not hold, and
 * the panel says where it stands in its own words. The old dashboard had its
 * own moment for it, under this same key.
 *
 * ITS LINE (R6 of the 30% that applies itself, the owner's words of
 * 2026-10-26) comes from the discount state as it is when the moment opens,
 * which WorldMap.tsx hands over beside approvalOnMap's request: applied, now
 * or when the moment fell due, "Your 30% is on your next payment." within 5
 * days of the application (renewalStillAhead, on the discount's clock) and
 * "The discount has been approved." after them; approved, "You'll see it on
 * your map once it's on your Whop subscription." A moment already due keeps
 * its place when approvalOnMap stops naming it (an applied request from day
 * 5), so one that fell due while approved, behind a lesson page, and opens
 * after the request was applied says it is on, never that it is still to
 * come. approvalOnMap itself is unchanged: no new moment starts for an
 * applied request from day 5.
 *
 * Since 2026-10-17 the celebration opens only once the map is up (useMapUp,
 * below) and no lesson page is over it (`paused`), and the browser
 * key is written as it opens: it opened as soon as it was decided, over the
 * map's loading picture, and its own 5 s timer could close it before a slow
 * laptop's map was there (the release check's v6-celebrations rows 4 and 5).
 *
 * THE STREAK. No full-screen moment (Lovro, 2026-10-15, brand_fit.md
 * decision 11, B: a daily tick is routine; the full-screen moment is kept for
 * an approved discount, and later a finished place). When the streak goes past
 * the one last marked in this browser, or a new streak starts after a break,
 * the number in the header's pill changes with a moment of STREAK_MOMENT_MS:
 * useStreakMoment, below, which the pill (WorldCorner.tsx) calls. The streak
 * is StudentContext's, which a finished video refreshes (markWatched), and
 * the map hides its whole header under a lesson page, so the moment waits for
 * the map, as the corner's toast does. Since 2026-10-16 it plays only where
 * the number can be seen: not under the map's loading screen (useMapUp), not
 * through Creative Strategy's telescope, where the header's group steps out,
 * not under a phone's sheet nor on a phone's list scrolled past the header
 * (covered, below; a review found the telescope, the other three played
 * unseen too, and were marked seen). One at a time, as before: it waits while
 * the discount's full-screen moment is due or up too. The dashboard keeps its
 * full-screen StreakCelebration.
 *
 * AFTER A BREAK (2026-10-17). A broken streak shows 0 (currentStreakAsOf,
 * src/lib/streak.ts), and the map then forgets the number marked in this
 * browser (writes the key's 0), so the next streak gets its moment from its
 * first day, even one that stops where the old one did. A streak below the
 * one marked is a new one too (a streak only goes up until it breaks), for a
 * break this browser never saw at 0. It used to wait until the new streak
 * passed the old number, so on the release day most returning students, whose
 * browsers hold the old dashboard's numbers, would have had no moment for days.
 *
 * The moments that time themselves, the discount's 5 s, the streak's 600 ms
 * and the corner's achievement toast (WorldCorner.tsx, 6.5 s), each wait for
 * useMapUp too: the map built, its loading screen gone, the tab in front.
 *
 * The dashboard's two test events fire them too and record nothing:
 * `et:test:streak` plays the header's moment on the number shown (the event's
 * number is not shown: the header shows the real streak), and
 * `et:test:discount-approved` the discount's celebration, once the map is up.
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

// Whether the discount's full-screen celebration is due or up, so the header's
// streak moment can wait for it. The two live apart (beside the map, inside its
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
 * The map (WorldV6's root, `main[data-view]`) is not up yet: its view not
 * known, or its world still building under the loading screen (`data-loading`;
 * a phone's list has neither). Once built, the world view's loading screen
 * still fades for LOADER_FADE_MS, and a fading screen takes no pointer.
 */
function mapLoading(root: HTMLElement): boolean {
  return root.dataset.view === "unknown" || root.hasAttribute("data-loading");
}

// Whether the tab is in front: a moment in a hidden tab is never seen.
function watchTab(w: () => void) {
  document.addEventListener("visibilitychange", w);
  return () => document.removeEventListener("visibilitychange", w);
}
const tabShown = () => document.visibilityState === "visible";
const tabOnServer = () => false;

/**
 * Whether the map is up for a moment that times itself (2026-10-17): its root
 * in the page, its view known, its world built and the loading screen faded
 * (mapLoading, LOADER_FADE_MS), and the tab in front. A lesson page over the
 * map is the caller's `paused`. Looked at only while `wanted`: a task later,
 * then at each change of the page's elements or the root's view and loading
 * (the world view can load later, after a phone's list is widened), and up
 * only once looked at in this wait, never left over from an earlier one. Used
 * by the discount's celebration (5 s), the streak's moment (600 ms) and the
 * corner's achievement toast (WorldCorner.tsx, 6.5 s): before, the 30%
 * approved could open over the loading picture and close on its own timer
 * before a slow laptop's map was there.
 */
export function useMapUp(wanted: boolean): boolean {
  const tab = useSyncExternalStore(watchTab, tabShown, tabOnServer);
  const [up, setUp] = useState(false);
  if (!wanted && up) setUp(false);

  useEffect(() => {
    if (!wanted) return;
    const dom = new MutationObserver(look);
    let fade = 0;
    let loaded = false;
    function look() {
      const root = document.querySelector<HTMLElement>("main[data-view]");
      if (!root || mapLoading(root)) {
        loaded = true;
        window.clearTimeout(fade);
        fade = 0;
        setUp(false);
        return;
      }
      if (fade) return;
      if (loaded && root.dataset.view === "world") {
        // The loading screen fades out over the map first (a phone's list has none).
        loaded = false;
        fade = window.setTimeout(() => {
          fade = 0;
          setUp(true);
        }, LOADER_FADE_MS);
        return;
      }
      setUp(true);
    }
    dom.observe(document.body, { subtree: true, childList: true, attributeFilter: ["data-view", "data-loading"] });
    const t = window.setTimeout(look, 0);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(fade);
      dom.disconnect();
    };
  }, [wanted]);

  return wanted && up && tab;
}

/**
 * The streak's number cannot be seen though the map is up: the top of the
 * page at the number's centre is not the pill's button it sits in, or that
 * point is off the screen. Through Creative Strategy's telescope
 * (corner.module.css steps the group out), under a phone's place or
 * checkpoint sheet, on a phone's list scrolled past the header. A moment
 * played then would go unseen.
 */
function covered(seg: HTMLElement | null): boolean {
  if (!seg) return false;
  const r = seg.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !(top !== null && (seg.closest("button") ?? seg).contains(top));
}

/**
 * When the number in the header's pill gets its moment: the streak differs
 * from the one last marked in this browser (streakToCelebrate: it went up, or
 * a new streak started after a break), or the dashboard's `et:test:streak`
 * came. `paused`: a lesson page is open, where the map hides its header; the
 * moment waits until the map is back, and the browser key is written only once
 * it has played. `seg`: the streak's segment in the pill (its flame and
 * number), which must be in sight (useMapUp, covered).
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
  // browser key is only read here and only written once the moment plays, or
  // when the streak shows broken (below).
  const sig = ready ? `${studentId}:${current}` : null;
  if (sig !== null && sig !== asked) {
    setAsked(sig);
    const n = streakToCelebrate(current, readKey(streakLastSeenKey(studentId!)));
    if (n !== null) setDue({ n, record: true });
    // The streak changed to one with nothing to mark (it broke, or this browser
    // has marked it since): a moment still due for the old number goes.
    else if (due?.record) setDue(null);
  }

  // A broken streak (0): the number marked here is forgotten (the key's 0), so
  // the next streak gets its moment from its first day, even one that stops
  // where the old one did (Lovro, 2026-10-16: a day counts once a lesson is
  // watched in full or a task finished, T-079).
  const broken = ready && current === 0;
  useEffect(() => {
    if (!broken || !studentId) return;
    const key = streakLastSeenKey(studentId);
    if (readKey(key) !== "0") writeKey(key, "0");
  }, [broken, studentId]);

  // Played once the number can be seen: no lesson page over the map, no
  // full-screen celebration due or over it, the map up (useMapUp) and nothing
  // else over the number (covered). A task later, so a celebration decided in
  // the same commit (WorldCelebrations comes after the map) holds this by then
  // and this waits for it to close. While something covers the number, the
  // moment stays due, and the page's elements, its scroll and its size are
  // watched until nothing does; nothing is watched the rest of the time.
  const waiting = due !== null && !paused && !held;
  const mapUp = useMapUp(waiting);
  const canPlay = waiting && mapUp;
  useEffect(() => {
    if (!canPlay || due === null) return;
    const el = seg.current;
    const dom = new MutationObserver(play);
    let watching = false;
    function watch(on: boolean) {
      if (on === watching) return;
      watching = on;
      if (on) {
        // The whole page, since what covers the number may live beside the map (a dialog, the discount form).
        dom.observe(document.body, { subtree: true, childList: true, attributeFilter: ["data-view", "data-tel"] });
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
      if (covered(el)) {
        watch(true);
        return;
      }
      watch(false);
      setDue(null);
      setMoment((m) => ({ seq: (m?.seq ?? 0) + 1, on: true, n: due.n ?? current, record: due.record }));
    }
    const t = window.setTimeout(play, 0);
    return () => {
      window.clearTimeout(t);
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

export function WorldCelebrations({
  approvedRequestId,
  applied = false,
  at = null,
  now,
  paused,
}: {
  /** The approved application to celebrate (approved, or applied since: approvalOnMap), or null: none, or one made on the old dashboard (madeBeforeLaunch). */
  approvedRequestId: string | null;
  /** The discount state is applied (its own kind, whatever approvalOnMap answers): the 30% is on the student's subscription, and the moment's line says so. */
  applied?: boolean;
  /** The discount state's request date (created_at), or null when it has none: the moment's line counts the 5 days from it. */
  at?: string | null;
  /** The discount's clock, ms: the one approvalOnMap and the checkpoint's panel read (useWorldDiscount's `now`). */
  now: number;
  /** A lesson page is open over the map: the celebration waits until the student is back on it. */
  paused: boolean;
}) {
  const stand = useContext(CelebrationStandInContext);
  const { student } = useAuth();
  const { loading } = useStudent();
  const studentId = stand ? stand.studentId : (student?.id ?? null);
  const ready = !loading && studentId !== null;

  /** Due, until it closes. `id` null: a test event's, not recorded. `applied` and `at`: the discount state when it fell due. */
  const [approval, setApproval] = useState<{ id: string | null; applied: boolean; at: string | null } | null>(null);
  /** The input last decided on, so each change is looked at once. */
  const [approvalAsked, setApprovalAsked] = useState<string | null>(null);
  /** On screen: it opened once the map was up, and stays until it closes, whatever opens over the map after. */
  const [open, setOpen] = useState(false);

  // Decided while rendering, as useWorldBadges decides what is fresh: the
  // browser key is only read here and only written once it opens, below.
  const approvalSig = ready ? approvedRequestId : null;
  if (approvalSig !== null && approvalSig !== approvalAsked) {
    setApprovalAsked(approvalSig);
    if (approvalToCelebrate(approvalSig, readKey(DISCOUNT_APPROVED_LAST_SEEN_KEY))) setApproval({ id: approvalSig, applied, at });
  }

  // Opened once the map is up and no lesson page is over it, so its 5 s
  // safety net (DiscountApprovedCelebration) starts where it can be seen.
  const due = approval !== null;
  const mapUp = useMapUp(due && !open && !paused);
  if (due && !open && !paused && mapUp) setOpen(true);
  if (!due && open) setOpen(false);

  // Recorded as it opens (the dashboard's key).
  useEffect(() => {
    if (open && approval?.id) writeKey(DISCOUNT_APPROVED_LAST_SEEN_KEY, approval.id);
  }, [open, approval]);

  // While it is due or up, the header's streak moment waits (useStreakMoment).
  useEffect(() => {
    setFullScreenUp(due);
    return () => setFullScreenUp(false);
  }, [due]);

  // The dashboard's test event (DevTestPanel), heard here too; it waits for
  // the map as well. A real one already due keeps its place.
  useEffect(() => {
    const onApproved = () => setApproval((a) => a ?? { id: null, applied: false, at: null });
    window.addEventListener("et:test:discount-approved", onApproved);
    return () => window.removeEventListener("et:test:discount-approved", onApproved);
  }, []);

  // The map's words (R6): applied now or when the moment fell due, on the next payment while the renewal is still ahead,
  // else "The discount has been approved."; approved, that it shows on the map once it is on (the dashboard's say it is applied).
  const lineApplied = applied || approval?.applied === true;
  const renewalAhead = renewalStillAhead(at ?? approval?.at ?? "", now);
  return (
    <DiscountApprovedCelebration
      show={open}
      onDismiss={() => setApproval(null)}
      where="map"
      applied={lineApplied}
      renewalAhead={renewalAhead}
    />
  );
}
