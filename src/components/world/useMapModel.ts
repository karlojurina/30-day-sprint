"use client";

import { createContext, useContext, useMemo } from "react";
import { useStudent } from "@/contexts/StudentContext";
import { buildMapModel, type MapModel } from "@/lib/world/map-model";
import { useWorldCatalog } from "@/lib/world/useWorldCatalog";

/**
 * Development harness only: every lesson can be finished here, video or not
 * (the placeholder course of /dev/world-app, whose lesson page has a "Mark
 * watched (dev)" button), so the map passes none over (map-model.ts). The app
 * never provides it.
 */
export const AnyLessonFinishesContext = createContext(false);

/**
 * Whether the world has something to show, read the same way by the map's
 * host and by the routes that paint over it.
 *
 *   loading  the catalog has not arrived
 *   error    it failed to load
 *   empty    it arrived with no areas or no lessons. A failed catalog query and
 *            a refused data request both arrive like this today (the data
 *            route answers 500 for a failed catalog query, and StudentContext
 *            sets no error on a non-OK response), so "empty" is treated as
 *            "may have failed" wherever it is shown
 *   shape    it is a real catalog, but not the eight-area one the map draws
 *   ready    the map can be mounted
 *
 * The routes over the map show nothing in the first three: a "that lesson
 * isn't here" over a "your course didn't load" would blame the address for
 * what the load did. In "shape" a lesson page still opens, because the lesson
 * exists and the player works on any catalog.
 */
export type MapStatus = "loading" | "error" | "empty" | "shape" | "ready";
export type ReadyMapModel = Extract<MapModel, { ok: true }>;

export function useMapModel(): { status: MapStatus; model: ReadyMapModel | null } {
  const { areas, lessonsByArea, loading, loadError } = useWorldCatalog();
  const { completedLessonIds, watchedLessonIds } = useStudent();
  const anyLessonFinishes = useContext(AnyLessonFinishesContext);

  const model = useMemo(
    () => buildMapModel({ areas, lessonsByArea, completedLessonIds, watchedLessonIds, anyLessonFinishes }),
    [areas, lessonsByArea, completedLessonIds, watchedLessonIds, anyLessonFinishes],
  );

  if (loading) return { status: "loading", model: null };
  if (loadError) return { status: "error", model: null };
  if (!model.ok) return { status: model.reason, model: null };
  return { status: "ready", model };
}

/** The routes over the map stay silent in these: the host's card is the whole message. */
export function mapIsSilent(status: MapStatus): boolean {
  return status === "loading" || status === "error" || status === "empty";
}
