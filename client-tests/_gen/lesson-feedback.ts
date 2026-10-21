import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsPaginated } from "./supabase-pagination.ts";
import { getCurriculumResetAt } from "./curriculum-reset.ts";
import { isRateableLesson } from "./lesson-rating.ts";

/**
 * Lesson feedback for the team: /admin/feedback/lessons (admin rebuild 2,
 * D10 and WI-7). Two halves, like the 30% page's thirty-data.ts and
 * thirty-view.ts:
 *
 *   loadLessonFeedback   the reads, with the service role, behind GET
 *                        /api/admin/lesson-feedback. Every read is checked:
 *                        one that fails fails the whole answer, so the page
 *                        never shows a believable "no ratings".
 *   buildLessonFeedback  pure: the ratings grouped by area, then lesson, in
 *                        course order, each with its average, its count and
 *                        its comments newest first.
 *
 * WHAT IS READ. The ratings given since the course switch
 * (admin_config.curriculum_reset_at, which v104 wrote): created_at on or
 * after it, or every rating while there is no switch. The live catalog,
 * `lessons` and `regions` (the ratings' foreign key points at `lessons`).
 * The name and email of each student who rated, in batches of 100 ids.
 *
 * WHICH LESSONS ARE LISTED. Every lesson a student can rate
 * (isRateableLesson, src/lib/world/lesson-rating.ts: a video lesson that is
 * not the Ad Bounty's), whether rated or not, and any other lesson that has
 * a rating anyway (one written before the route checked the lesson), so no
 * rating is left out. A rating for a lesson the catalog read does not have
 * is counted in `unplaced`, which the page says out loud, never dropped.
 */

export interface FeedbackArea {
  id: string;
  name: string;
  order_num: number;
}

export interface FeedbackLesson {
  id: string;
  region_id: string;
  title: string;
  type: string;
  sort_order: number;
  feature_key: string | null;
}

export interface FeedbackRating {
  id: string;
  student_id: string;
  lesson_id: string;
  stars: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackStudent {
  id: string;
  name: string | null;
  email: string | null;
  /** A Whop or a Discord username, shown after the name as on every admin page (the render review's fix round). */
  discord_username?: string | null;
}

/** Everything the page is built from, as the reads hand it over. */
export interface LessonFeedbackData {
  /** The course switch, or null while there is none (then every rating counts). */
  since: string | null;
  areas: FeedbackArea[];
  lessons: FeedbackLesson[];
  ratings: FeedbackRating[];
  students: FeedbackStudent[];
}

export type LessonFeedbackLoad =
  | { ok: true; data: LessonFeedbackData }
  | { ok: false; failed: string[] };

/** How many student ids go into one `.in()` read: the address stays short. */
const STUDENT_BATCH = 100;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Every read the page needs, with the service role. Any failed read fails the load and is named. */
export async function loadLessonFeedback(supabase: SupabaseClient): Promise<LessonFeedbackLoad> {
  let since: string | null;
  try {
    since = await getCurriculumResetAt(supabase);
  } catch (e) {
    return { ok: false, failed: [message(e)] };
  }

  const [areas, lessons, ratings] = await Promise.all([
    fetchAllRowsPaginated<FeedbackArea>(() =>
      supabase.from("regions").select("id, name, order_num").order("order_num").order("id"),
    ),
    fetchAllRowsPaginated<FeedbackLesson>(() =>
      supabase
        .from("lessons")
        .select("id, region_id, title, type, sort_order, feature_key")
        .order("sort_order")
        .order("id"),
    ),
    fetchAllRowsPaginated<FeedbackRating>(() => {
      const q = supabase
        .from("student_lesson_ratings")
        .select("id, student_id, lesson_id, stars, comment, created_at, updated_at");
      // updated_at moves on every edit, so the id keeps the pages stable.
      return (since ? q.gte("created_at", since) : q).order("updated_at", { ascending: false }).order("id");
    }),
  ]);
  const failed: string[] = [];
  if (areas.error) failed.push(`regions: ${areas.error.message}`);
  if (lessons.error) failed.push(`lessons: ${lessons.error.message}`);
  if (ratings.error) failed.push(`student_lesson_ratings: ${ratings.error.message}`);
  if (failed.length > 0) return { ok: false, failed };

  const ids = [...new Set(ratings.data.map((r) => r.student_id))].sort();
  const students: FeedbackStudent[] = [];
  for (let i = 0; i < ids.length; i += STUDENT_BATCH) {
    const batch = ids.slice(i, i + STUDENT_BATCH);
    const { data, error } = await supabase.from("students").select("id, name, email, discord_username").in("id", batch);
    if (error) return { ok: false, failed: [`students: ${error.message}`] };
    students.push(...((data ?? []) as FeedbackStudent[]));
  }

  return { ok: true, data: { since, areas: areas.data, lessons: lessons.data, ratings: ratings.data, students } };
}

// ── The page's shape ────────────────────────────────────────────────────────

/** One rating with a comment, as the page lists it. */
export interface FeedbackComment {
  id: string;
  stars: number;
  comment: string;
  /** When it was last saved (updated_at): a rating edited later moves up. */
  at: string;
  /** Null when the students read had no such row. */
  student: FeedbackStudent | null;
}

export interface FeedbackLessonRow {
  id: string;
  title: string;
  /** Can a student rate it (a video lesson that is not the Ad Bounty's)? False only for one listed because it has ratings anyway. */
  rateable: boolean;
  ratings: number;
  /** The mean of its stars, or null with no rating. Unrounded: the page rounds. */
  average: number | null;
  /** When its newest rating was last saved (updated_at), or null with no rating: the page lists the rated lessons newest first. */
  latestAt: string | null;
  /** Its ratings with a comment, newest first. */
  comments: FeedbackComment[];
}

export interface FeedbackAreaRow {
  id: string;
  /** Its place in route order, 1 to 8; null for an area the regions read did not have. */
  number: number | null;
  name: string;
  ratings: number;
  average: number | null;
  /** How many of its lessons have at least one rating. */
  lessonsRated: number;
  /** Its listed lessons, in course order. */
  lessons: FeedbackLessonRow[];
}

/** What GET /api/admin/lesson-feedback answers, and the page draws. */
export interface LessonFeedbackView {
  generatedAt: string;
  since: string | null;
  totals: {
    ratings: number;
    comments: number;
    average: number | null;
    lessonsRated: number;
    /** The listed lessons: every one a student can rate, and any other with a rating. */
    lessons: number;
  };
  areas: FeedbackAreaRow[];
  /** Ratings of a lesson the catalog read did not have: in no count above, named on the page. */
  unplaced: number;
}

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Newest first by the time it was last saved, then by id, so the order is the same on every read. */
function newestFirst(a: FeedbackRating, b: FeedbackRating): number {
  if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function courseOrder(a: FeedbackLesson, b: FeedbackLesson): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The page's answer: ratings grouped by area, then lesson, in course order. */
export function buildLessonFeedback(data: LessonFeedbackData, now: Date): LessonFeedbackView {
  const studentById = new Map(data.students.map((s) => [s.id, s]));
  const lessonIds = new Set(data.lessons.map((l) => l.id));
  const byLesson = new Map<string, FeedbackRating[]>();
  let unplaced = 0;
  for (const r of data.ratings) {
    if (!lessonIds.has(r.lesson_id)) {
      unplaced++;
      continue;
    }
    const list = byLesson.get(r.lesson_id) ?? [];
    list.push(r);
    byLesson.set(r.lesson_id, list);
  }

  const listed = data.lessons
    .filter((l) => isRateableLesson(l) || byLesson.has(l.id))
    .sort(courseOrder);

  const rowOf = (l: FeedbackLesson): FeedbackLessonRow => {
    const ratings = [...(byLesson.get(l.id) ?? [])].sort(newestFirst);
    return {
      id: l.id,
      title: l.title,
      rateable: isRateableLesson(l),
      ratings: ratings.length,
      average: mean(ratings.map((r) => r.stars)),
      latestAt: ratings[0]?.updated_at ?? null,
      comments: ratings
        .filter((r) => (r.comment ?? "").trim() !== "")
        .map((r) => ({
          id: r.id,
          stars: r.stars,
          comment: (r.comment as string).trim(),
          at: r.updated_at,
          student: studentById.get(r.student_id) ?? null,
        })),
    };
  };

  const areasInOrder = [...data.areas].sort((a, b) => a.order_num - b.order_num || (a.id < b.id ? -1 : 1));
  const known = new Set(areasInOrder.map((a) => a.id));
  // A lesson under a region the read did not have still shows, under its region's id.
  const strays = [...new Set(listed.map((l) => l.region_id).filter((id) => !known.has(id)))].sort();
  const groups: Array<{ id: string; number: number | null; name: string }> = [
    ...areasInOrder.map((a, i) => ({ id: a.id, number: i + 1, name: a.name })),
    ...strays.map((id) => ({ id, number: null, name: id })),
  ];

  const areas: FeedbackAreaRow[] = [];
  for (const g of groups) {
    const lessons = listed.filter((l) => l.region_id === g.id).map(rowOf);
    if (lessons.length === 0) continue;
    const stars = lessons.flatMap((l) => (byLesson.get(l.id) ?? []).map((r) => r.stars));
    areas.push({
      ...g,
      ratings: stars.length,
      average: mean(stars),
      lessonsRated: lessons.filter((l) => l.ratings > 0).length,
      lessons,
    });
  }

  const placed = areas.flatMap((a) => a.lessons);
  const allStars = placed.flatMap((l) => (byLesson.get(l.id) ?? []).map((r) => r.stars));
  return {
    generatedAt: now.toISOString(),
    since: data.since,
    totals: {
      ratings: allStars.length,
      comments: placed.reduce((n, l) => n + l.comments.length, 0),
      average: mean(allStars),
      lessonsRated: placed.filter((l) => l.ratings > 0).length,
      lessons: placed.length,
    },
    areas,
    unplaced,
  };
}

/**
 * An area's lessons as the page lists them (admin rebuild 2, the review's fix
 * round): the rated ones, newest rating first (the same moment in course
 * order, which `lessons` already holds), and the ones with no rating, in
 * course order, which the page folds into one line.
 */
export function splitRated(lessons: FeedbackLessonRow[]): { rated: FeedbackLessonRow[]; unrated: FeedbackLessonRow[] } {
  const isRated = (l: FeedbackLessonRow) => l.ratings > 0 && l.average !== null;
  const rated = lessons
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => isRated(l))
    .sort((a, b) => {
      if (a.l.latestAt !== b.l.latestAt) {
        if (a.l.latestAt === null) return 1;
        if (b.l.latestAt === null) return -1;
        return a.l.latestAt < b.l.latestAt ? 1 : -1;
      }
      return a.i - b.i;
    })
    .map(({ l }) => l);
  return { rated, unrated: lessons.filter((l) => !isRated(l)) };
}
