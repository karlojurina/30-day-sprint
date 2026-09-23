"use client";

import { useMemo } from "react";
import { useStudent } from "@/contexts/StudentContext";
import {
  buildWorldCatalog,
  type CatalogLessonLike,
  type CatalogRegionLike,
  type WorldCatalog,
} from "@/lib/world/catalog";

/**
 * The world's only view of the curriculum.
 *
 * The cast is the one place the two catalog shapes are reconciled.
 * StudentContext types its rows as the v1 `Lesson`/`Region`, but the staging
 * catalog returns the v2 shape through the same field. `catalog.ts` reads only
 * the fields both carry — never `day` — so the cast is sound for everything
 * this module exposes, and it is confined to these two lines rather than
 * spreading through every component.
 */
export function useWorldCatalog(): WorldCatalog & { loading: boolean; loadError: string | null } {
  const { lessons, regions, completedLessonIds, watchProgress, loading, loadError } =
    useStudent();

  const catalog = useMemo(
    () =>
      buildWorldCatalog({
        lessons: lessons as unknown as CatalogLessonLike[],
        regions: regions as unknown as CatalogRegionLike[],
        completedLessonIds,
        watchProgress,
      }),
    [lessons, regions, completedLessonIds, watchProgress],
  );

  return { ...catalog, loading, loadError };
}
