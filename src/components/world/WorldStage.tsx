"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";

/**
 * Owns the canvas, and lives in the LAYOUT rather than a page.
 *
 * App Router does not remount layouts on navigation, so the world survives the
 * trip into an area and into a lesson and back. The alternative — canvas on the
 * page — would re-download and re-parse 4 MB of glb on every back-press, and
 * rebuild the whole WebGL context with it.
 *
 * The context exists so a child ROUTE can tell the canvas where to hold. The
 * area screen parks the camera at its own stop; leaving hands the rail back to
 * the scroll position.
 */

const WorldCanvas = dynamic(
  () => import("@/components/world/WorldCanvas").then((m) => m.WorldCanvas),
  {
    // Required, not preferred: WebGLRenderer touches window and document in its
    // constructor, so any server render of this tree throws.
    ssr: false,
  },
);

interface WorldStageValue {
  /** Hold the camera at this area's stop. null hands control back to scroll. */
  parkAt: (areaId: string | null) => void;
  parkedAreaId: string | null;
}

const WorldStageContext = createContext<WorldStageValue | null>(null);

export function useWorldStage(): WorldStageValue {
  const ctx = useContext(WorldStageContext);
  // Not a throw: the phone path view (W10) renders the same routes with no
  // canvas behind them, and a missing stage there is normal, not a bug.
  return ctx ?? { parkAt: () => {}, parkedAreaId: null };
}

export function WorldStage({ children }: { children: ReactNode }) {
  const [parkedAreaId, setParkedAreaId] = useState<string | null>(null);
  const parkAt = useCallback((areaId: string | null) => {
    setParkedAreaId(areaId);
  }, []);
  const value = useMemo(
    () => ({ parkAt, parkedAreaId }),
    [parkAt, parkedAreaId],
  );

  return (
    <WorldStageContext.Provider value={value}>
      <WorldCanvas parkedAreaId={parkedAreaId} />
      {children}
    </WorldStageContext.Provider>
  );
}
