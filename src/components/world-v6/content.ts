/**
 * What the map's words and counts are read from: the course's content, apart
 * from the world's geometry.
 *
 * On /dev/world-v6 (WorldV6 with no source) it is the fixture in study.ts. In
 * the app it is the host's WorldSource (source.ts). WorldV6 builds one
 * WorldContent and hands it down through WorldContentContext, so the card,
 * the chip, the panel and the list never read STUDY_AREAS for a name, a count,
 * a title or a duration. Geometry (N, the anchors, the rail depths) stays on
 * STUDY_AREAS in WorldV6.tsx: the scene has eight places whatever the catalog
 * says.
 */
import { createContext, useContext } from "react";
import type { WorldProgress } from "@/lib/world-v6/progress";
import type { WorldSource } from "./source";
import { STUDY_AREAS, TOTAL_LESSONS, isAction, lessonMinutes, type Study, type StudyArea } from "./study";

export interface WorldContent {
  /** Content per place, in route order. Always eight. */
  areas: readonly StudyArea[];
  /** Lessons in the whole course. */
  total: number;
  /** Minutes lesson i of place k runs; null when nobody knows (then no minutes are shown). */
  minutes(k: number, i: number): number | null;
  /** Is lesson i of place k done? null on the dev page: the fixture's rule, the first `done` lessons of a place. */
  isDone: ((k: number, i: number) => boolean) | null;
  /** Open the page of place k's feature row. null on the dev page, where the row is a plain line. */
  onFeature: ((k: number) => void) | null;
}

export const FIXTURE_CONTENT: WorldContent = {
  areas: STUDY_AREAS,
  total: TOTAL_LESSONS,
  // The fixture's action items are milestones with no length of their own.
  minutes: (k, i) => (isAction(STUDY_AREAS[k], i) ? null : lessonMinutes(k, i)),
  isDone: null,
  onFeature: null,
};

export function contentOf(source: WorldSource | undefined): WorldContent {
  if (!source) return FIXTURE_CONTENT;
  return {
    areas: source.areas,
    total: source.total,
    minutes: (k, i) => source.minutes(k, i),
    isDone: (k, i) => source.isDone(k, i),
    onFeature: (k) => source.onFeature(k),
  };
}

export const WorldContentContext = createContext<WorldContent>(FIXTURE_CONTENT);

export function useContent(): WorldContent {
  return useContext(WorldContentContext);
}

/** Is lesson i of place k done? `done` is the place's count, which is all the fixture knows. */
export function lessonDone(c: WorldContent, k: number, i: number, done: number): boolean {
  return c.isDone ? c.isDone(k, i) : i < done;
}

/** What stands where a lesson's length goes: "Action", "12 min", or null when the minutes are not known. */
export function lessonLength(c: WorldContent, k: number, i: number): string | null {
  if (isAction(c.areas[k], i)) return "Action";
  const m = c.minutes(k, i);
  return m === null ? null : `${m} min`;
}

/**
 * Total minutes of a place: every watch lesson's, and an action item's when the
 * catalog has its length (a watch action item with a video; a hand-in alone
 * has none). null when a watch lesson's is not known.
 */
export function placeMinutes(c: WorldContent, k: number): number | null {
  const a = c.areas[k];
  let m = 0;
  for (let i = 0; i < a.lessons; i++) {
    const one = c.minutes(k, i);
    if (one === null) {
      if (isAction(a, i)) continue;
      return null;
    }
    m += one;
  }
  return m;
}

/** Lesson i of a place can't be finished in the app yet: "Not recorded yet" where Watch would be. */
export function notRecorded(a: StudyArea, i: number): boolean {
  return a.unrecorded?.includes(i) ?? false;
}

/**
 * What the scene gets (progress.ts): study.ts's worldProgressOf(), with the
 * lesson counts taken from the areas in use, so the scene lays out one lantern
 * per lesson of the catalog it is shown.
 */
export function progressOf(areas: readonly StudyArea[], st: Study): WorldProgress {
  const place = st.place;
  return {
    lessons: areas.map((a) => a.lessons),
    done: st.done.slice(),
    current: place,
    next: place < areas.length ? st.done[place] + 1 : 0,
  };
}
