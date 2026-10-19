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
 *    lesson left that the student can finish in the app. The next lesson is
 *    the first such lesson there. (Loom 2, 2026-10-16: a watch lesson with no
 *    video yet can't be finished, so it must never hold a student. It still
 *    counts in every total, and the place it is in stays not done.) When only
 *    such lessons are left, the place and next lesson are the first undone
 *    ones, and the map says "Not recorded yet" where Watch would be.
 *  - An action item holds the student only until its video is watched
 *    (2026-10-19, isPassed): once its watch half is in, from the app or from
 *    Whop, the next lesson is found past it. Its hand-in stays open: the lesson
 *    is not done until that is in too, nor is its place, and every count stays
 *    as it was. With only such hand-ins and lessons not recorded yet left, the
 *    first undone one is next, as above. An action item with no video (a setup
 *    step) has no watch half to pass, so it is next until its hand-in is in.
 *  - A lesson can be finished in the app when it is a watch lesson with a
 *    video (watched to the end) or an action item (its hand-in). A course
 *    with no video at all (a failed read of the videos looks the same,
 *    api/student/data) and the dev page's placeholder course (its "Mark
 *    watched (dev)" button finishes any lesson) count every lesson as one.
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
  /**
   * The student is past it when the next lesson is found: done, or an action
   * item whose video is watched while its hand-in is still open (isPassed).
   * What is shown and counted is `done`.
   */
  passed: boolean;
  /** A watch lesson with a video behind it. */
  hasVideo: boolean;
  /** The student can finish it in the app (see the rules above). False: "Not recorded yet". */
  finishable: boolean;
}

export interface MapFeature {
  id: string;
  title: string;
  key: string | null;
  done: boolean;
  /** A watch lesson (not a setup step). */
  watch: boolean;
  /** A watch lesson with a video behind it (the Ad Bounty checkpoint's panel shows Watch). */
  hasVideo: boolean;
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
  /**
   * The lessons whose watch half is in: completed_at set, watched in the app
   * or arrived from Whop (StudentContext's watchedLessonIds). An action item
   * in it no longer holds the student (isPassed).
   */
  watchedLessonIds: ReadonlySet<string>;
  /**
   * Every lesson can be finished here, video or not: the dev page's
   * placeholder course, whose "Mark watched (dev)" button finishes any lesson
   * (AnyLessonFinishesContext in components/world/useMapModel.ts). Absent in
   * the app.
   */
  anyLessonFinishes?: boolean;
}

/** Can the student finish this lesson in the app: a watch lesson with a video, or an action item. */
export function canFinishInApp(l: CatalogLessonLike): boolean {
  return (l.type === "watch" && Boolean(l.has_video)) || l.requires_action;
}

/**
 * Is the student past this lesson when the next one is found (the map's next
 * lesson, and "Next lesson" on the lesson's page)? Yes once it is done. An
 * action item that is a watch lesson is passed as soon as its watch half is in
 * (`watched`: completed_at set, watched in the app or arrived from Whop): its
 * hand-in stays open, and it is done only once that is in too. An action item
 * with no video (a setup step) has no watch half, so it waits for its hand-in.
 */
export function isPassed(
  l: Pick<CatalogLessonLike, "type" | "requires_action">,
  done: boolean,
  watched: boolean,
): boolean {
  return done || (l.requires_action && l.type === "watch" && watched);
}

function minutesOf(durationSeconds: number | null): number | null {
  if (durationSeconds === null || !(durationSeconds > 0)) return null;
  return Math.max(1, Math.round(durationSeconds / 60));
}

export function buildMapModel(input: MapModelInput): MapModel {
  const { areas, lessonsByArea, completedLessonIds, watchedLessonIds } = input;

  let rows = 0;
  let videos = 0;
  for (const a of areas) {
    for (const l of lessonsByArea.get(a.id) ?? []) {
      rows++;
      if (l.has_video) videos++;
    }
  }
  if (areas.length === 0 || rows === 0) return { ok: false, reason: "empty" };
  if (areas.length !== MAP_PLACES) return { ok: false, reason: "shape" };
  // With no video anywhere nothing tells a lesson that is not recorded from
  // one whose video did not load: then nothing is passed over.
  const anyFinishes = input.anyLessonFinishes === true || videos === 0;

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
          passed: isPassed(l, isDone, watchedLessonIds.has(l.id)),
          hasVideo: l.type === "watch" && Boolean(l.has_video),
          finishable: anyFinishes || canFinishInApp(l),
        });
        if (isDone) done++;
      } else {
        features.push({
          id: l.id,
          title: l.title,
          key: l.feature_key,
          done: isDone,
          watch: l.type === "watch",
          hasVideo: l.type === "watch" && Boolean(l.has_video),
        });
      }
    }
    total += lessons.length;
    doneTotal += done;
    out.push({ id: a.id, name: a.name, lessons, features, done });
  }

  // An area with no counting lessons has nothing left to do, so it never holds
  // the student; nor does one whose lessons left can't be finished in the app,
  // or are action items whose video is watched (their hand-ins still open).
  // With only those left anywhere, the first undone lesson is the next one.
  const left = (l: MapLesson) => !l.passed && l.finishable;
  let place = out.findIndex((a) => a.lessons.some(left));
  let placeNext = place >= 0 ? out[place].lessons.findIndex(left) : -1;
  if (place < 0) {
    place = out.findIndex((a) => a.done < a.lessons.length);
    placeNext = place >= 0 ? out[place].lessons.findIndex((l) => !l.done) : -1;
  }
  if (place < 0) place = MAP_PLACES;

  return { ok: true, areas: out, place, placeNext, doneTotal, total };
}

/**
 * Can the student finish lesson `id` in the app, as the model counts it (the
 * dev page's placeholder course and a course with no video say yes to all).
 * null when the model has no such counting lesson (a feature row, another
 * course): the caller then asks canFinishInApp().
 */
export function finishableIn(model: Extract<MapModel, { ok: true }>, id: string): boolean | null {
  for (const a of model.areas) {
    const l = a.lessons.find((x) => x.id === id);
    if (l) return l.finishable;
  }
  return null;
}
