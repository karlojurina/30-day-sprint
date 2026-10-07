/**
 * What the world map shows for one student, derived from the catalog.
 *
 * Pure: no React, no DOM, nothing but types from the catalog boundary. The map
 * (src/components/world-v6) draws exactly eight places, so this is also where
 * a catalog that is not the eight-area one is refused, before any 3D loads.
 *
 * The rules, in one place (world_v6_wiring_prd.md §8):
 *  - A lesson that counts toward progress is one of the area's lessons: it
 *    gets a lantern and is in every total.
 *  - A lesson that does not count (today: the Ad Bounty row) is a feature of
 *    the area: no lantern, in no total, still shown and still openable.
 *  - The student's place is the first area, in route order, with a counting
 *    lesson left. The next lesson is the first undone counting lesson there.
 *  - Minutes exist only when the catalog knows the duration. Nothing is made up.
 */
import type { Area, CatalogLessonLike } from "./catalog";

/** The map draws eight places. A catalog with any other number of areas cannot be shown on it. */
export const MAP_PLACES = 8;

export interface MapLesson {
  id: string;
  title: string;
  /** Whole minutes, at least 1; null when the catalog has no duration. */
  minutes: number | null;
  /** An action item (the milestone diamond). */
  action: boolean;
  done: boolean;
  /** A watch lesson with a video behind it. */
  hasVideo: boolean;
}

export interface MapFeature {
  id: string;
  title: string;
  key: string | null;
  done: boolean;
}

export interface MapArea {
  id: string;
  name: string;
  /** The counting lessons, in catalog order. */
  lessons: MapLesson[];
  /** The lessons that do not count toward progress, in catalog order. */
  features: MapFeature[];
  /** How many of `lessons` are done. */
  done: number;
}

export type MapModel =
  | {
      ok: true;
      areas: MapArea[];
      /** Index of the student's place, 0..7; MAP_PLACES when every place is finished. */
      place: number;
      /** Index, within areas[place].lessons, of the next lesson; -1 when place is MAP_PLACES. */
      placeNext: number;
      /** Counting lessons done, over the whole course. */
      doneTotal: number;
      /** Counting lessons in the whole course. */
      total: number;
    }
  | { ok: false; reason: "empty" | "shape" };

export interface MapModelInput {
  /** The catalog's areas, already in route order (catalog.ts sorts by order_num). */
  areas: readonly Area[];
  lessonsByArea: ReadonlyMap<string, readonly CatalogLessonLike[]>;
  completedLessonIds: ReadonlySet<string>;
}

function minutesOf(durationSeconds: number | null): number | null {
  if (durationSeconds === null || !(durationSeconds > 0)) return null;
  return Math.max(1, Math.round(durationSeconds / 60));
}

export function buildMapModel(input: MapModelInput): MapModel {
  const { areas, lessonsByArea, completedLessonIds } = input;

  let rows = 0;
  for (const a of areas) rows += lessonsByArea.get(a.id)?.length ?? 0;
  if (areas.length === 0 || rows === 0) return { ok: false, reason: "empty" };
  if (areas.length !== MAP_PLACES) return { ok: false, reason: "shape" };

  const out: MapArea[] = [];
  let total = 0;
  let doneTotal = 0;
  for (const a of areas) {
    const lessons: MapLesson[] = [];
    const features: MapFeature[] = [];
    let done = 0;
    for (const l of lessonsByArea.get(a.id) ?? []) {
      const isDone = completedLessonIds.has(l.id);
      if (l.counts_toward_progress) {
        lessons.push({
          id: l.id,
          title: l.title,
          minutes: minutesOf(l.duration_seconds),
          action: l.requires_action,
          done: isDone,
          hasVideo: l.type === "watch" && !!l.bunny_video_id,
        });
        if (isDone) done++;
      } else {
        features.push({ id: l.id, title: l.title, key: l.feature_key, done: isDone });
      }
    }
    total += lessons.length;
    doneTotal += done;
    out.push({ id: a.id, name: a.name, lessons, features, done });
  }

  // An area with no counting lessons has nothing left to do, so it never holds the student.
  let place = MAP_PLACES;
  for (let k = 0; k < out.length; k++) {
    if (out[k].done < out[k].lessons.length) {
      place = k;
      break;
    }
  }
  const placeNext = place < MAP_PLACES ? out[place].lessons.findIndex((l) => !l.done) : -1;

  return { ok: true, areas: out, place, placeNext, doneTotal, total };
}
