"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useSelectedLayoutSegments } from "next/navigation";
import { WorldMap } from "@/components/world/WorldMap";

/**
 * Owns the map, and lives in the LAYOUT rather than a page.
 *
 * App Router does not remount layouts on navigation, so the world survives the
 * trip into an area and into a lesson and back. The alternative — the map on
 * the page — would rebuild the scene and its whole WebGL context on every
 * back-press.
 *
 * THE ADDRESS IS THE ONLY SOURCE OF TRUTH FOR WHAT IS OPEN. This reads the
 * route segments below the layout it sits in: the first names the open place,
 * the second the open lesson. No page sets either through an effect, so a page
 * mounting and unmounting can never flicker the map.
 *
 * `base` is where the layout is mounted. Every link under the stage is built
 * with href(), never with a literal "/world", so the same screens run under
 * another path.
 */

export interface WorldStageValue {
  base: string;
  /** The place the address names, or null on the map itself. */
  openAreaId: string | null;
  /** The lesson the address names, or null. */
  lessonId: string | null;
  /** href() is the map, href(a) a place, href(a, l) a lesson. */
  href(areaId?: string | null, lessonId?: string | null): string;
}

function hrefFor(base: string): WorldStageValue["href"] {
  return (areaId, lessonId) => {
    if (!areaId) return base;
    if (!lessonId) return `${base}/${areaId}`;
    return `${base}/${areaId}/${lessonId}`;
  };
}

const WorldStageContext = createContext<WorldStageValue | null>(null);

const NO_STAGE: WorldStageValue = {
  base: "/world",
  openAreaId: null,
  lessonId: null,
  href: hrefFor("/world"),
};

export function useWorldStage(): WorldStageValue {
  const ctx = useContext(WorldStageContext);
  // Not a throw: a screen rendered with no stage above it still gets working
  // links, and a missing stage there is normal, not a bug.
  return ctx ?? NO_STAGE;
}

export function WorldStage({
  children,
  base = "/world",
}: {
  children: ReactNode;
  base?: string;
}) {
  const segments = useSelectedLayoutSegments();
  const openAreaId = segments[0] ?? null;
  const lessonId = segments[1] ?? null;
  const href = useMemo(() => hrefFor(base), [base]);
  const value = useMemo(
    () => ({ base, openAreaId, lessonId, href }),
    [base, openAreaId, lessonId, href],
  );

  return (
    <WorldStageContext.Provider value={value}>
      <WorldMap />
      {children}
    </WorldStageContext.Provider>
  );
}
