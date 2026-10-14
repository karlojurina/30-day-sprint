"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HudStandInContext, type HudStandIn } from "@/components/world/useWorldBadges";
import type { Achievement } from "@/types/database";

/**
 * The pretend student's streak, achievements and Sign out on /dev/world-app
 * (FixtureStudentProvider.tsx), so every state of the map's top-left corner
 * (src/components/world/WorldCorner.tsx) can be seen and tested with no
 * server: ?hud=<preset>.
 *
 *   no ?hud      a new student: no streak, no achievements
 *   ?hud=cold    the streak broke: 0 days, best 12; 3 achievements
 *   ?hud=some    a 4-day streak, best 9; 4 achievements
 *   ?hud=long    a 128-day streak; 8 achievements
 *   ?hud=all     a 30-day streak; every achievement
 *   ?hud=fresh   a 7-day streak and 2 achievements; Habit Builder unlocks
 *                1.5 s after the map is ready, and the corner toasts it
 *
 * The catalog is the ten achievements the course switch keeps (cutover PRD,
 * C3: the six tied to the old four regions or the 30-day clock are deleted),
 * with the names, words, tiers and order the database has after v91, and the
 * shares of students measured on 2026-09-18 (v91's header). Pretend numbers
 * for a review page; the real ones are read from achievement_unlock_stats.
 *
 * Sign out is counted and does nothing else: no request leaves the page.
 *
 * window.__fixtureHud, for the browser run: the preset, unlock(id) (the
 * student earns it now), held() (what they hold) and signOuts() (how many
 * times Sign out was pressed).
 */

export type HudPreset = "cold" | "some" | "long" | "all" | "fresh";
const PRESETS: readonly HudPreset[] = ["cold", "some", "long", "all", "fresh"];

const CATALOG: readonly Achievement[] = [
  { id: "first_lesson", name: "First Steps", description: "Complete your first lesson.", icon: "", rarity: "common", sort_order: 1 },
  { id: "triple_play", name: "Triple Threat", description: "Complete 3 lessons in a day.", icon: "", rarity: "common", sort_order: 2 },
  { id: "region_sweep", name: "Region Sweep", description: "Complete 5 lessons from the same region in a single day.", icon: "", rarity: "common", sort_order: 3 },
  { id: "first_action_shipped", name: "Took the Shot", description: "Ship your first action item.", icon: "", rarity: "common", sort_order: 4 },
  { id: "bounty_access_claimed", name: "Through the Gate", description: "Get approved for Bounties.", icon: "", rarity: "uncommon", sort_order: 5 },
  { id: "streak_7", name: "Habit Builder", description: "Reach a 7-day streak.", icon: "", rarity: "uncommon", sort_order: 8 },
  { id: "discount_earned", name: "Discount Earned", description: "Earn the 30% off month two.", icon: "", rarity: "rare", sort_order: 11 },
  { id: "streak_14", name: "Two Weeks Strong", description: "Reach a 14-day streak.", icon: "", rarity: "rare", sort_order: 12 },
  { id: "perfect_run", name: "Perfectionist", description: "Finish with zero skipped lessons.", icon: "", rarity: "legendary", sort_order: 13 },
  { id: "unbroken", name: "Unbroken", description: "Finish the whole sprint without ever breaking your streak.", icon: "", rarity: "legendary", sort_order: 16 },
];

const STATS: ReadonlyMap<string, number> = new Map([
  ["first_lesson", 98.1],
  ["triple_play", 91.6],
  ["region_sweep", 82.7],
  ["first_action_shipped", 24.7],
  ["bounty_access_claimed", 21.7],
  ["streak_7", 13.1],
  ["discount_earned", 5.7],
  ["streak_14", 3.9],
  ["perfect_run", 4.2],
  ["unbroken", 0],
]);

const HELD: Record<HudPreset, readonly string[]> = {
  cold: ["first_lesson", "triple_play", "streak_7"],
  some: ["first_lesson", "triple_play", "region_sweep", "first_action_shipped"],
  long: ["first_lesson", "triple_play", "region_sweep", "first_action_shipped", "bounty_access_claimed", "streak_7", "streak_14", "discount_earned"],
  all: CATALOG.map((a) => a.id),
  fresh: ["first_lesson", "triple_play"],
};

const STREAK: Record<HudPreset, { current: number; longest: number }> = {
  cold: { current: 0, longest: 12 },
  some: { current: 4, longest: 9 },
  long: { current: 128, longest: 128 },
  all: { current: 30, longest: 41 },
  fresh: { current: 7, longest: 7 },
};

/** ?hud=fresh: what unlocks, and how long after the map is ready. */
const FRESH_ID = "streak_7";
const FRESH_AFTER_MS = 1500;
const DAY_MS = 86_400_000;

export function hudPresetOf(search: string | null): HudPreset | null {
  if (search === null) return null;
  const v = new URLSearchParams(search).get("hud");
  return PRESETS.includes(v as HudPreset) ? (v as HudPreset) : null;
}

/** The streak the pretend student's StudentContext carries. */
export function hudStreak(search: string | null): { current: number; longest: number } {
  const preset = hudPresetOf(search);
  return preset ? STREAK[preset] : { current: 0, longest: 0 };
}

type FixtureHudWindow = Window & {
  __fixtureHud?: { preset: HudPreset | null; unlock(id: string): void; held(): string[]; signOuts(): number };
  __worldReady?: boolean;
};

export function FixtureHud({ search, children }: { search: string | null; children: ReactNode }) {
  const preset = hudPresetOf(search);
  // The page's load time: the unlock dates count back from it.
  const [boot] = useState(() => Date.now());
  /** Earned since the page loaded, on top of the preset. */
  const [earned, setEarned] = useState<ReadonlyMap<string, string>>(() => new Map());
  const signOutsRef = useRef(0);

  const mine = useMemo(() => {
    const out = new Map<string, string>();
    (preset ? HELD[preset] : []).forEach((id, i) => out.set(id, new Date(boot - (i + 1) * DAY_MS).toISOString()));
    for (const [id, at] of earned) out.set(id, at);
    return out;
  }, [preset, boot, earned]);

  const unlock = useCallback((id: string) => {
    if (!CATALOG.some((a) => a.id === id)) return;
    setEarned((prev) => (prev.has(id) ? prev : new Map(prev).set(id, new Date().toISOString())));
  }, []);

  const signOut = useCallback(() => {
    signOutsRef.current += 1;
  }, []);

  const value = useMemo<HudStandIn>(
    () => ({ badges: { catalog: CATALOG, mine, stats: STATS }, signOut }),
    [mine, signOut],
  );

  // ?hud=fresh: the unlock lands once the map is up (the 3D ready, or the
  // phone's list, which loads no 3D), as one would after a lesson.
  useEffect(() => {
    if (preset !== "fresh") return;
    let timer = 0;
    const poll = window.setInterval(() => {
      if (!(window as FixtureHudWindow).__worldReady && !document.querySelector('main[data-view="list"]')) return;
      window.clearInterval(poll);
      timer = window.setTimeout(() => unlock(FRESH_ID), FRESH_AFTER_MS);
    }, 200);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(timer);
    };
  }, [preset, unlock]);

  useEffect(() => {
    const w = window as FixtureHudWindow;
    w.__fixtureHud = { preset, unlock, held: () => [...mine.keys()], signOuts: () => signOutsRef.current };
    return () => {
      delete w.__fixtureHud;
    };
  }, [preset, unlock, mine]);

  return <HudStandInContext.Provider value={value}>{children}</HudStandInContext.Provider>;
}
