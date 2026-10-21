import type { CatalogLessonLike, CatalogRegionLike } from "@/lib/world/catalog";
import catalog from "../../../../supabase/catalog/course_catalog.json";
import lengths from "./course-lengths.fixture.json";
import sampleText from "./course-sample-text.fixture.json";

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
 * that has a length. `description` is null unless a text is put on the lesson
 * (THE LESSONS' TEXT, below).
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

/**
 * THE LESSONS' TEXT (the `description` column; src/lib/world/lesson-text.ts).
 * The course rows above have none, as the database had none before the loader.
 * Two sources can put some on them, both in one shape,
 * {"lessons": {"<lesson id>": {"title": "...", "text": "..."}}}, and a text
 * goes on a lesson only when the title beside it is that lesson's title:
 *
 *   ?text=sample            course-sample-text.fixture.json, made up and
 *                           tracked here, on a5l22 (a setup action item, no
 *                           video) and a5l08 (a watch action item with one).
 *                           world-tests/v6-course.mjs reads it too.
 *   DEV_COURSE_TEXT_FILE    a private file outside the repository, read on the
 *                           server by layout.tsx. Used when ?text=sample is not
 *                           given.
 */
export interface CourseTextMatch {
  /** Lesson id to text, for the entries whose title matched. */
  texts: Record<string, string>;
  /** One line per entry left out, and why. Titles only: never the text. */
  skipped: string[];
}

export function matchCourseTexts(file: unknown): CourseTextMatch {
  const texts: Record<string, string> = {};
  const skipped: string[] = [];
  const lessons = isObject(file) ? file.lessons : undefined;
  if (!isObject(lessons)) {
    skipped.push('the file has no "lessons" object');
    return { texts, skipped };
  }
  for (const [id, entry] of Object.entries(lessons)) {
    const row = COURSE.lessons.find((l) => l.id === id);
    if (!isObject(entry) || typeof entry.title !== "string" || typeof entry.text !== "string") {
      skipped.push(`${id}: skipped, the entry is not {"title": "...", "text": "..."}`);
    } else if (!row) {
      skipped.push(`${id}: skipped, the course has no such lesson`);
    } else if (entry.title.trim() !== row.title.trim()) {
      skipped.push(`${id}: skipped, its title in the file is "${entry.title}" and in the course "${row.title}"`);
    } else {
      texts[id] = entry.text;
    }
  }
  return { texts, skipped };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The course rows with these texts as the lessons' descriptions. */
export function withCourseTexts(texts: Readonly<Record<string, string>>): CourseRows {
  return {
    regions: COURSE.regions,
    lessons: COURSE.lessons.map((l) => (texts[l.id] === undefined ? l : { ...l, description: texts[l.id] })),
  };
}

/** The course under ?catalog=course&text=sample. */
export const COURSE_WITH_SAMPLE_TEXT: CourseRows = withCourseTexts(matchCourseTexts(sampleText).texts);

/** In the mid preset: the first three areas, and lessons 1 to 9 of the fourth. */
const MID_AREAS: ReadonlySet<string> = new Set(["a1", "a2", "a3"]);
const MID_LESSONS: ReadonlySet<string> = new Set(
  Array.from({ length: 9 }, (_, n) => `a4l0${n + 1}`),
);

/** In the partial preset: this many lessons of every place. */
const PARTIAL_EACH = 6;

/** In the loom preset: Lovro's own test in the map review Loom (6:16), lessons watched per area. */
const LOOM_EACH: Readonly<Record<string, number>> = { a3: 3, a4: 7 };

/** In the lake preset: the areas done, so the student's place is the Mirror Lake (Static Ads). */
const LAKE_AREAS: ReadonlySet<string> = new Set(["a1", "a2", "a3", "a4"]);

/**
 * What ?p= means in course mode. The other presets of the harness count
 * lessons of the placeholder course, so here any name but these five is a
 * student who has watched nothing.
 *
 *   ?p=mid      every counting lesson of areas 1 to 3, and a4l01 to a4l09
 *   ?p=partial  the first 6 counting lessons of every area, so every place
 *               has lit and dark lanterns (world-tests/v6-review-shots.mjs)
 *   ?p=loom     Lovro's test at 6:16 in the map review Loom: lessons 1 to 3
 *               of Video Ads I and 1 to 7 of Video Ads II, nothing else
 *   ?p=all      every lesson that counts toward progress
 *   ?p=lake     every counting lesson of areas 1 to 4: the student is at the
 *               Mirror Lake (the phone's picture of the student's place, at
 *               night, for the night prototype of 2026-10-20)
 */
export function coursePresetIds(name: string | null): string[] {
  const counting = COURSE.lessons.filter((l) => l.counts_toward_progress);
  switch (name) {
    case "mid":
      return counting.filter((l) => MID_AREAS.has(l.region_id) || MID_LESSONS.has(l.id)).map((l) => l.id);
    case "partial":
      return COURSE.regions.flatMap((r) => counting.filter((l) => l.region_id === r.id).slice(0, PARTIAL_EACH).map((l) => l.id));
    case "loom":
      return COURSE.regions.flatMap((r) => counting.filter((l) => l.region_id === r.id).slice(0, LOOM_EACH[r.id] ?? 0).map((l) => l.id));
    case "all":
      return counting.map((l) => l.id);
    case "lake":
      return counting.filter((l) => LAKE_AREAS.has(l.region_id)).map((l) => l.id);
    default:
      return [];
  }
}
