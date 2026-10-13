import type { CatalogLessonLike, CatalogRegionLike } from "@/lib/world/catalog";
import catalog from "../../../../supabase/catalog/course_catalog.json";
import lengths from "./course-lengths.fixture.json";

/**
 * The real course as catalog rows, for /dev/world-app?catalog=course
 * (course_catalog_prd.md, section 9.H and Work Item 3; driven by
 * world-tests/v6-course.mjs).
 *
 * TWO FILES ARE READ AND NEITHER IS COPIED HERE.
 * supabase/catalog/course_catalog.json is the course: 8 areas and 141 lessons
 * in order, the file migration 2026_v101 is generated from, so the
 * development page and the database cannot tell two different courses.
 * course-lengths.fixture.json is lesson id to seconds, for the lessons that
 * have a video in Tella. It holds lengths and no video id.
 *
 * The rows are what GET /api/student/data hands the map once v101 and the
 * video load have run: the JSON's type, title, brief, gate, counting flag and
 * feature key; `sort_order` is the lesson's position in the whole course,
 * from 1; a lesson is an action item exactly when it has a brief; a length
 * exactly when the lengths file has one; and `has_video` on a watch lesson
 * that has a length.
 */

/** One lesson of course_catalog.json. The last four are left out when they do not apply. */
interface CourseLesson {
  id: string;
  area: string;
  title: string;
  type: string;
  action_brief?: string;
  gate?: boolean;
  counts?: boolean;
  feature_key?: string;
}

const AREAS: readonly { id: string; name: string }[] = catalog.areas;
const LESSONS: readonly CourseLesson[] = catalog.lessons;
const SECONDS: Readonly<Record<string, number | undefined>> = lengths;

export interface CourseRows {
  regions: CatalogRegionLike[];
  lessons: CatalogLessonLike[];
}

export const COURSE: CourseRows = {
  regions: AREAS.map((a, i) => ({ id: a.id, order_num: i + 1, name: a.name })),
  lessons: LESSONS.map((l, i) => {
    const seconds = SECONDS[l.id] ?? null;
    return {
      id: l.id,
      region_id: l.area,
      type: l.type,
      title: l.title,
      description: null,
      sort_order: i + 1,
      requires_action: l.action_brief !== undefined,
      action_brief: l.action_brief ?? null,
      is_optional: false,
      is_gate: l.gate === true,
      counts_toward_progress: l.counts !== false,
      feature_key: l.feature_key ?? null,
      has_video: seconds !== null && l.type === "watch",
      duration_seconds: seconds,
    };
  }),
};

/**
 * The course lessons that have a video. The stand-in server
 * (fixtureTransport.ts) plays the test video for exactly these in course mode.
 */
export const COURSE_VIDEO_LESSON_IDS: ReadonlySet<string> = new Set(
  COURSE.lessons.filter((l) => l.has_video).map((l) => l.id),
);

/** In the mid preset: the first three areas, and lessons 1 to 9 of the fourth. */
const MID_AREAS: ReadonlySet<string> = new Set(["a1", "a2", "a3"]);
const MID_LESSONS: ReadonlySet<string> = new Set(
  Array.from({ length: 9 }, (_, n) => `a4l0${n + 1}`),
);

/**
 * What ?p= means in course mode. The other presets of the harness count
 * lessons of the placeholder course, so here any name but these two is a
 * student who has watched nothing.
 *
 *   ?p=mid   every counting lesson of areas 1 to 3, and a4l01 to a4l09
 *   ?p=all   every lesson that counts toward progress
 */
export function coursePresetIds(name: string | null): string[] {
  const counting = COURSE.lessons.filter((l) => l.counts_toward_progress);
  switch (name) {
    case "mid":
      return counting.filter((l) => MID_AREAS.has(l.region_id) || MID_LESSONS.has(l.id)).map((l) => l.id);
    case "all":
      return counting.map((l) => l.id);
    default:
      return [];
  }
}
