"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase-browser";
import type { Achievement, AchievementUnlockStats, StudentAchievement } from "@/types/database";

/**
 * The student's achievements and the sign-out, for the map's corner
 * (WorldCorner.tsx). The streak is StudentContext's own (useStudent().streak).
 *
 * The data is the old dashboard's (src/components/map/AchievementsButton.tsx,
 * which stays as it is until the cutover deletes it): three reads straight
 * from Supabase in the browser, the catalog (`achievements`, in sort_order),
 * the student's own unlocks (`student_achievements`) and the share of
 * students holding each (`achievement_unlock_stats`). The window event
 * `et:achievements-changed` (LessonPlayer fires it when a lesson is counted,
 * StudentContext after its own writes and after each Whop sync) reads the
 * student's unlocks again.
 *
 * An unlock that arrives while the page is open goes into `fresh`, oldest
 * first, for the corner's toast, and into `newIds`, for the list's "New" mark.
 * What the student held when the page loaded is never announced.
 *
 * THE DEVELOPMENT PAGE provides HudStandInContext (its catalog, its unlocks,
 * its shares and a sign-out that only records the click), and these hooks then
 * read no student, call no Supabase and send no request. The same seam as
 * useWorldDiscount.ts's DiscountStandInContext.
 */

export interface BadgeBook {
  /** Every achievement, in sort_order. */
  catalog: readonly Achievement[];
  /** The student's: achievement id to unlocked_at. */
  mine: ReadonlyMap<string, string>;
  /** The share of students who hold each one, 0 to 100. Empty when unknown. */
  stats: ReadonlyMap<string, number>;
}

export interface HudStandIn {
  badges: BadgeBook;
  signOut(): Promise<void> | void;
}

/** The development page's pretend student. /world provides nothing. */
export const HudStandInContext = createContext<HudStandIn | null>(null);

export type BadgeStatus = "loading" | "ready" | "error";

export interface WorldBadges {
  status: BadgeStatus;
  book: BadgeBook;
  /** Unlocked while this page is open and not yet announced, oldest first. */
  fresh: readonly Achievement[];
  /** Every achievement unlocked while this page is open. */
  newIds: ReadonlySet<string>;
  /** fresh[0] has been announced. */
  announced(): void;
  /** Read everything again after a failed load. */
  retry(): void;
}

const EMPTY_BOOK: BadgeBook = { catalog: [], mine: new Map(), stats: new Map() };
const NO_IDS: ReadonlySet<string> = new Set();

type MineRow = Pick<StudentAchievement, "achievement_id" | "unlocked_at">;
type StatRow = Pick<AchievementUnlockStats, "id" | "unlock_pct">;

function mineOf(rows: readonly MineRow[] | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows ?? []) out.set(r.achievement_id, r.unlocked_at);
  return out;
}

/** The three reads, for a signed-in student, when no stand-in is provided. */
function useLiveBook(studentId: string | null, enabled: boolean) {
  const [book, setBook] = useState<BadgeBook>(EMPTY_BOOK);
  const [status, setStatus] = useState<BadgeStatus>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !studentId) return;
    let alive = true;
    const supabase = createClient();
    Promise.all([
      supabase.from("achievements").select("*").order("sort_order", { ascending: true }),
      supabase.from("student_achievements").select("achievement_id, unlocked_at").eq("student_id", studentId),
      supabase.from("achievement_unlock_stats").select("id, unlock_pct"),
    ])
      .then(([catalogRes, mineRes, statsRes]) => {
        if (!alive) return;
        if (catalogRes.error || mineRes.error) {
          setStatus("error");
          return;
        }
        const stats = new Map<string, number>();
        // The shares are a nicety: a failed read leaves them out.
        for (const r of (statsRes.data as StatRow[] | null) ?? []) stats.set(r.id, Number(r.unlock_pct));
        setBook({
          catalog: (catalogRes.data as Achievement[] | null) ?? [],
          mine: mineOf(mineRes.data as MineRow[] | null),
          stats,
        });
        setStatus("ready");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [enabled, studentId, attempt]);

  // Something may have unlocked: read the student's own again.
  useEffect(() => {
    if (!enabled || !studentId) return;
    let alive = true;
    const onChange = () => {
      createClient()
        .from("student_achievements")
        .select("achievement_id, unlocked_at")
        .eq("student_id", studentId)
        .then(({ data, error }) => {
          if (!alive || error || !data) return;
          setBook((b) => ({ ...b, mine: mineOf(data as MineRow[]) }));
        });
    };
    window.addEventListener("et:achievements-changed", onChange);
    return () => {
      alive = false;
      window.removeEventListener("et:achievements-changed", onChange);
    };
  }, [enabled, studentId]);

  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  }, []);

  return { book, status, retry };
}

export function useWorldBadges(): WorldBadges {
  const stand = useContext(HudStandInContext);
  const { student } = useAuth();
  const live = useLiveBook(student?.id ?? null, stand === null);

  const book = stand ? stand.badges : live.book;
  const status: BadgeStatus = stand ? "ready" : live.status;

  // What the student held when the book first arrived: never announced.
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);
  const [first, setFirst] = useState<ReadonlySet<string> | null>(null);
  const [fresh, setFresh] = useState<readonly Achievement[]>([]);
  if (status === "ready") {
    if (seen === null) {
      const ids = new Set(book.mine.keys());
      setSeen(ids);
      setFirst(ids);
    } else {
      let added: Achievement[] | null = null;
      for (const id of book.mine.keys()) {
        if (seen.has(id)) continue;
        const a = book.catalog.find((x) => x.id === id);
        if (a) (added ??= []).push(a);
      }
      if (added) {
        setSeen(new Set([...seen, ...book.mine.keys()]));
        const more = added;
        setFresh((f) => [...f, ...more]);
      }
    }
  }

  const newIds = useMemo<ReadonlySet<string>>(() => {
    if (!first) return NO_IDS;
    const out = new Set<string>();
    for (const id of book.mine.keys()) if (!first.has(id)) out.add(id);
    return out;
  }, [book, first]);

  const announced = useCallback(() => setFresh((f) => f.slice(1)), []);

  return { status, book, fresh, newIds, announced, retry: live.retry };
}

/** The app's sign-out, or the development page's stand-in. */
export function useWorldSignOut(): () => Promise<void> {
  const stand = useContext(HudStandInContext);
  const { signOut } = useAuth();
  return useCallback(async () => {
    if (stand) await stand.signOut();
    else await signOut();
  }, [stand, signOut]);
}
