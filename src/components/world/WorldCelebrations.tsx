"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { StreakCelebration } from "@/components/map/StreakCelebration";
import { DiscountApprovedCelebration } from "@/components/map/DiscountApprovedCelebration";
import {
  approvalToCelebrate,
  DISCOUNT_APPROVED_LAST_SEEN_KEY,
  streakLastSeenKey,
  streakToCelebrate,
} from "@/lib/world/celebrations";

/**
 * The old dashboard's two celebrations, on the map (2026-10-14): the streak
 * one (StreakCelebration) when the student's streak goes past the one last
 * celebrated in this browser, and the discount one (DiscountApprovedCelebration)
 * the first time this browser sees their application approved. Same
 * components, same triggers, same browser keys as src/app/dashboard/page.tsx
 * (src/lib/world/celebrations.ts holds the rules), so one already seen on the
 * dashboard is not shown again here. The dashboard's two test events fire
 * them too: `et:test:streak` (detail: the number) and
 * `et:test:discount-approved`; neither records anything.
 *
 * The streak is StudentContext's, which a finished video now refreshes
 * (markWatched), so the celebration comes as the lesson page says "Done", as
 * it did on the dashboard after a toggle. The approval is the map's own
 * discount state (useWorldDiscount.ts), so a request from before the new
 * course, which the map never shows, is not celebrated either. One at a time:
 * the discount waits for the streak.
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

export function WorldCelebrations({ approvedRequestId }: { approvedRequestId: string | null }) {
  const stand = useContext(CelebrationStandInContext);
  const { student } = useAuth();
  const { loading, streak } = useStudent();
  const studentId = stand ? stand.studentId : (student?.id ?? null);
  const ready = !loading && studentId !== null;
  const current = streak?.current ?? 0;

  /** On screen. `record`: write it to the browser's key once shown (a test event does not). */
  const [streakShown, setStreakShown] = useState<{ n: number; record: boolean } | null>(null);
  const [approvalShown, setApprovalShown] = useState<{ id: string | null } | null>(null);
  /** The inputs last decided on, so each change is looked at once. */
  const [streakAsked, setStreakAsked] = useState<string | null>(null);
  const [approvalAsked, setApprovalAsked] = useState<string | null>(null);

  // Decided while rendering, as useWorldBadges decides what is fresh: the
  // browser key is only read here and only written after the commit, below.
  const streakSig = ready ? `${studentId}:${current}` : null;
  if (streakSig !== null && streakSig !== streakAsked) {
    setStreakAsked(streakSig);
    const n = streakToCelebrate(current, readKey(streakLastSeenKey(studentId!)));
    if (n !== null) setStreakShown({ n, record: true });
  }
  const approvalSig = ready ? approvedRequestId : null;
  if (approvalSig !== null && approvalSig !== approvalAsked) {
    setApprovalAsked(approvalSig);
    if (approvalToCelebrate(approvalSig, readKey(DISCOUNT_APPROVED_LAST_SEEN_KEY))) setApprovalShown({ id: approvalSig });
  }

  useEffect(() => {
    if (streakShown?.record && studentId) writeKey(streakLastSeenKey(studentId), String(streakShown.n));
  }, [streakShown, studentId]);
  useEffect(() => {
    if (approvalShown?.id) writeKey(DISCOUNT_APPROVED_LAST_SEEN_KEY, approvalShown.id);
  }, [approvalShown]);

  // The dashboard's test events (DevTestPanel), heard here too.
  useEffect(() => {
    const onStreak = (e: Event) => {
      const n = (e as CustomEvent<unknown>).detail;
      if (typeof n === "number") setStreakShown({ n, record: false });
    };
    const onApproved = () => setApprovalShown({ id: null });
    window.addEventListener("et:test:streak", onStreak);
    window.addEventListener("et:test:discount-approved", onApproved);
    return () => {
      window.removeEventListener("et:test:streak", onStreak);
      window.removeEventListener("et:test:discount-approved", onApproved);
    };
  }, []);

  return (
    <>
      <StreakCelebration streak={streakShown?.n ?? null} onDismiss={() => setStreakShown(null)} />
      <DiscountApprovedCelebration
        show={approvalShown !== null && streakShown === null}
        onDismiss={() => setApprovalShown(null)}
      />
    </>
  );
}
