/**
 * Made-up data for /dev/admin/feedback/lessons (admin rebuild 2, WI-7).
 * Development only: the page that imports this calls notFound() anywhere else
 * (src/app/dev/admin/layout.tsx).
 *
 * MADE-UP PEOPLE ONLY. This repository is public: every student, email and
 * comment below is invented. The course is the real one,
 * supabase/catalog/course_catalog.json (its areas, lessons, types and Ad
 * Bounty key), read here and not copied, so the page lists what the live
 * catalog lists.
 *
 * Every load runs the real buildLessonFeedback (src/lib/admin/lesson-feedback.ts),
 * the builder behind GET /api/admin/lesson-feedback, over the made-up rows:
 * the averages, counts and order on the dev page are the route's own work.
 *
 *   ?state=full      ratings in 5 of the 8 areas, a lesson with 6 comments,
 *                    a student with no name (the email shows), a rating whose
 *                    student row is gone, a long comment, an edited rating
 *   ?state=empty     no rating since the switch
 *   ?state=loading   the read never answers
 *   ?state=error     the read fails, with the route's sentence
 *   ?state=unplaced  full, plus 2 ratings for a lesson the catalog does not have
 *   ?state=stray     full, plus a rating on a setup step (written before the
 *                    route checked the lesson), so it is listed anyway
 *   ?reload=fail     the first read works, every later one fails
 */

import catalog from "../../../../../supabase/catalog/course_catalog.json";
import { buildLessonFeedback } from "@/lib/admin/lesson-feedback";
import type {
  FeedbackArea,
  FeedbackLesson,
  FeedbackRating,
  FeedbackStudent,
  LessonFeedbackData,
  LessonFeedbackView,
} from "@/lib/admin/lesson-feedback";
import type { Answer } from "@/lib/admin/admin-transport";
import type { LessonFeedbackTransport } from "@/lib/admin/lesson-feedback-transport";

/** Sat 24 Oct 2026, 11:00 in Croatia: the moment every dev load is read at. */
export const LESSON_FIXTURE_NOW = "2026-10-24T09:00:00.000Z";
/** The course switch, as admin_config holds it. */
const SWITCH = "2026-10-19T14:33:33.972Z";

interface CourseLesson {
  id: string;
  area: string;
  title: string;
  type: string;
  feature_key?: string;
}

const AREAS: FeedbackArea[] = (catalog.areas as { id: string; name: string }[]).map((a, i) => ({
  id: a.id,
  name: a.name,
  order_num: i + 1,
}));
const LESSONS: FeedbackLesson[] = (catalog.lessons as CourseLesson[]).map((l, i) => ({
  id: l.id,
  region_id: l.area,
  title: l.title,
  type: l.type,
  sort_order: i + 1,
  feature_key: l.feature_key ?? null,
}));

const STUDENTS: FeedbackStudent[] = [
  { id: "s-maya", name: "Maya Lindqvist", email: "s-maya@example.com", discord_username: "maya.lq" },
  { id: "s-jonah", name: "Jonah Pereira", email: "s-jonah@example.com", discord_username: "jonah_p" },
  { id: "s-priya", name: "Priya Raman", email: "s-priya@example.com" },
  { id: "s-omar", name: "Omar Haddad", email: "s-omar@example.com", discord_username: "@omar.h" },
  { id: "s-lena", name: "Lena Vogel", email: "s-lena@example.com" },
  { id: "s-theo", name: "Theo Marsh", email: "s-theo@example.com" },
  // No name on file: the page shows the email.
  { id: "s-noname", name: null, email: "s-noname@example.com" },
  { id: "s-ruby", name: "Ruby Okafor", email: "s-ruby@example.com" },
];

/** [lesson, student, stars, comment or null, hours after the switch, hours after that it was edited] */
type Made = [string, string, number, string | null, number, number?];

const FULL: Made[] = [
  // Introduction: the welcome, rated by 7, 6 of them with a comment.
  ["a1l01", "s-maya", 5, "Clear and short. I knew what to do next.", 2],
  ["a1l01", "s-jonah", 4, "Good start, the sound was a bit quiet.", 5],
  ["a1l01", "s-priya", 5, "Loved the energy.", 9],
  ["a1l01", "s-omar", 3, "Too long for a welcome. Cut it to 3 minutes.", 20],
  ["a1l01", "s-lena", 5, null, 26],
  ["a1l01", "s-theo", 4, "Fine.", 40],
  ["a1l01", "s-noname", 2, "I already knew all of this from Whop.", 61, 30],
  ["a1l02", "s-maya", 4, null, 3],
  ["a1l02", "s-ruby", 5, null, 70],
  ["a1l04", "s-jonah", 3, "Which part do I watch on Whop and which here? Still not sure after this one.", 8],
  // Marketing Fundamentals.
  ["a2l01", "s-priya", 5, "The best lesson so far.", 30],
  ["a2l03", "s-omar", 4, null, 44],
  // A rating whose student row is gone (the read had no such student).
  ["a2l03", "s-gone", 1, "Didn't work for me.", 50],
  // Video Ads I.
  [
    "a3l05",
    "s-lena",
    4,
    "Really useful breakdown. I would add one more example of a hook that failed, and why it failed, because seeing only winners makes it look easy. " +
      "Also the part about pacing went fast, I watched it twice. Overall it made me rewrite my first script, so thank you.",
    55,
  ],
  ["a3l06", "s-theo", 5, null, 60],
  // Static Ads.
  ["a5l01", "s-ruby", 4, "Made me want to try Figma.", 80],
  // Creative Strategy.
  ["a7l02", "s-maya", 5, "Finally it clicked.", 100],
];

const hoursAfter = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

function rows(made: Made[]): FeedbackRating[] {
  return made.map(([lesson, student, stars, comment, h, edited], i) => {
    const created = hoursAfter(SWITCH, h);
    return {
      id: `r-${String(i + 1).padStart(3, "0")}`,
      student_id: student,
      lesson_id: lesson,
      stars,
      comment,
      created_at: created,
      updated_at: edited ? hoursAfter(created, edited) : created,
    };
  });
}

export type LessonFixtureState = "full" | "empty" | "loading" | "error" | "unplaced" | "stray";

const STATES: LessonFixtureState[] = ["full", "empty", "loading", "error", "unplaced", "stray"];

export function parseLessonFixtureState(value: string | null): LessonFixtureState {
  return STATES.find((s) => s === value) ?? "full";
}

/** The made-up rows a state stands for, in the loader's shape. */
export function lessonFixtureData(state: LessonFixtureState): LessonFeedbackData {
  let made: Made[] = state === "empty" ? [] : [...FULL];
  if (state === "unplaced") {
    made = [...made, ["zz-gone-1", "s-maya", 5, "A lesson that is no longer in the course.", 12], ["zz-gone-1", "s-jonah", 3, null, 13]];
  }
  if (state === "stray") {
    // a5l22 is a setup step (an action item with no video): no student can rate it now.
    made = [...made, ["a5l22", "s-priya", 4, "Rated before the route checked the lesson.", 15]];
  }
  const ratings = rows(made);
  const ids = new Set(ratings.map((r) => r.student_id));
  return {
    since: SWITCH,
    areas: AREAS,
    lessons: LESSONS,
    ratings,
    students: STUDENTS.filter((s) => ids.has(s.id)),
  };
}

/** One call the page made, for world-tests (window.__adminCalls on the dev page). */
export interface LessonFixtureCall {
  name: "loadLessonFeedback";
}

/** The route's sentence when a read fails (src/app/api/admin/lesson-feedback/route.ts). */
const READ_FAILED = "Couldn't read the lesson ratings, so nothing is shown. Try again.";

/** The page's transport, answered from the made-up rows a moment later, as a real answer comes. */
export function fixtureLessonFeedbackTransport(opts: {
  state: LessonFixtureState;
  reloadFails: boolean;
}): LessonFeedbackTransport & { calls: LessonFixtureCall[] } {
  const calls: LessonFixtureCall[] = [];
  let served = false;
  const later = <T>(answer: Answer<T>) => new Promise<Answer<T>>((resolve) => setTimeout(() => resolve(answer), 300));
  return {
    calls,
    loadLessonFeedback() {
      calls.push({ name: "loadLessonFeedback" });
      if (opts.state === "loading") return new Promise<Answer<LessonFeedbackView>>(() => {});
      if (opts.state === "error" || (opts.reloadFails && served)) {
        return later<LessonFeedbackView>({ ok: false, status: 500, error: READ_FAILED });
      }
      const answer = later<LessonFeedbackView>({
        ok: true,
        status: 200,
        data: buildLessonFeedback(lessonFixtureData(opts.state), new Date(LESSON_FIXTURE_NOW)),
      });
      void answer.then(() => {
        served = true;
      });
      return answer;
    },
  };
}
