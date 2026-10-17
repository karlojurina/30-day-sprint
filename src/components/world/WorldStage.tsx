"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useOptimistic,
  type ReactNode,
} from "react";
import { preconnect } from "react-dom";
import { useRouter, useSelectedLayoutSegments } from "next/navigation";
import { WorldMap } from "@/components/world/WorldMap";
import { LessonScreen } from "@/components/world/LessonScreen";
import { TELLA_ORIGIN } from "@/lib/world/tella";

/** Where Tella's player streams the video from, from inside its frame. */
const TELLA_STREAM_ORIGIN = "https://prod-stream.tella.tv";

/**
 * Owns the map, and lives in the LAYOUT rather than a page.
 *
 * App Router does not remount layouts on navigation, so the world survives the
 * trip into an area and into a lesson and back. The alternative — the map on
 * the page — would rebuild the scene and its whole WebGL context on every
 * back-press.
 *
 * THE ADDRESS IS THE SOURCE OF TRUTH FOR WHAT IS OPEN. This reads the route
 * segments below the layout it sits in: the first names the open place, the
 * second the open lesson. No page sets either through an effect, so a page
 * mounting and unmounting can never flicker the map. The one thing ahead of
 * the address is a lesson the map has just opened (below).
 *
 * THE STAGE DRAWS THE LESSON PAGE, AND IT OPENS AT THE CLICK. The lesson
 * routes render nothing; the page is drawn here, after the map, for the lesson
 * the address names. open() shows a lesson at once and pushes its address in
 * the same transition (useOptimistic): until the router has the route, the
 * page stands on that open, and when the address lands it names the same
 * lesson, so the page and its player stay as they are (nothing is put in
 * twice). The wait it saves is the route's own: under `next dev` every route
 * change is a request to the dev server (nothing is prefetched there), and a
 * phone has no hover to prefetch on. A navigation that takes its place (Esc,
 * the back button) ends the open with it.
 *
 * `base` is where the layout is mounted. Every link under the stage is built
 * with href(), never with a literal "/world", so the same screens run under
 * another path. `devComplete` is the development harness's "Mark watched
 * (dev)" button on the lesson page (src/app/dev/world-app/layout.tsx).
 */

export interface WorldStageValue {
  base: string;
  /** The place the address names (or the lesson open() is showing), or null on the map itself. */
  openAreaId: string | null;
  /** The lesson the address names (or open() is showing), or null. */
  lessonId: string | null;
  /** href() is the map, href(a) a place, href(a, l) a lesson. */
  href(areaId?: string | null, lessonId?: string | null): string;
  /** Show lesson l of place a now, and change the address to it: the page does not wait for the route. */
  open(areaId: string, lessonId: string): void;
}

/** The lesson open() is showing while its address is on its way. */
interface Opening {
  areaId: string;
  lessonId: string;
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
  open: (areaId, lessonId) => window.location.assign(hrefFor("/world")(areaId, lessonId)),
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
  devComplete = false,
}: {
  children: ReactNode;
  base?: string;
  devComplete?: boolean;
}) {
  const segments = useSelectedLayoutSegments();
  const router = useRouter();
  // Reverts to null when the transition that pushed the address commits.
  const [opening, setOpening] = useOptimistic<Opening | null>(null);

  // Warm the connections a lesson video needs, once, when the world first
  // mounts in the browser: a preconnect to Tella saved about 0.5 s on a cold
  // first load (measured 2026-10-14). React keeps one hint per address.
  useEffect(() => {
    preconnect(TELLA_ORIGIN);
    preconnect(TELLA_STREAM_ORIGIN);
  }, []);

  const openAreaId = opening ? opening.areaId : (segments[0] ?? null);
  const lessonId = opening ? opening.lessonId : (segments[1] ?? null);
  const href = useMemo(() => hrefFor(base), [base]);
  // scroll: false, as on every address change under the stage: the page scroll is the camera.
  const open = useCallback(
    (areaId: string, lessonId: string) => {
      startTransition(() => {
        setOpening({ areaId, lessonId });
        router.push(href(areaId, lessonId), { scroll: false });
      });
    },
    [router, href, setOpening],
  );
  const value = useMemo(
    () => ({ base, openAreaId, lessonId, href, open }),
    [base, openAreaId, lessonId, href, open],
  );

  return (
    <WorldStageContext.Provider value={value}>
      <WorldMap />
      {children}
      {/* Keyed as Next keys the route's segments: another lesson is a new page. */}
      {openAreaId !== null && lessonId !== null && (
        <LessonScreen key={`${openAreaId}/${lessonId}`} areaId={openAreaId} lessonId={lessonId} devComplete={devComplete} />
      )}
    </WorldStageContext.Provider>
  );
}
