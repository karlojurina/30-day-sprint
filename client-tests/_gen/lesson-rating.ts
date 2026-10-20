/**
 * Which lessons a student can rate, and what a rating may hold (admin
 * rebuild 2, D10). One file for both sides: the lesson page shows its "How
 * was this lesson?" block by it (src/components/world/LessonScreen.tsx) and
 * the route that saves a rating refuses by it (POST /api/student/rate-lesson),
 * so the page never offers a rating the route would turn down.
 *
 * A lesson can be rated when all three hold:
 *   1. It is a video lesson (type "watch"). A setup step has no video.
 *   2. It is not the Ad Bounty lesson (feature_key "bounty_access", the same
 *      key as BOUNTY_KEY in src/components/world-v6/source.ts). It is the Ad
 *      Bounty checkpoint's own page, not a lesson of the course.
 *   3. The student has finished it, as the map counts it: the video is
 *      watched (completed_at, in the app or from Whop) and the lesson is done
 *      (isLessonComplete in src/lib/progress.ts, the lesson page's "Done.").
 *      On an action item that means the hand-in is in too. A skip alone is
 *      never a watch, so a skipped lesson can't be rated.
 *
 * A rating is 1 to 5 whole stars and a comment of at most 1000 characters
 * once the spaces around it are cut, or no comment. One per student and
 * lesson; saving again changes it.
 *
 * No imports, so client-tests/build.mjs copies this file as it is.
 */

/** The longest comment, counted after trimming, as the textarea counts it. */
export const RATING_COMMENT_MAX = 1000;

/** The Ad Bounty lesson's feature key (lessons.feature_key). */
export const RATING_BOUNTY_KEY = "bounty_access";

/** Why a lesson can't be rated. */
export type RatingRefusal = "not_video" | "bounty" | "not_finished";

/** What a lesson row has to say for the rule. */
export interface RateableLesson {
  type: string;
  feature_key: string | null;
}

/**
 * Where the student is with the lesson. `watched`: the video half is in
 * (completed_at set; StudentContext's watchedLessonIds). `done`: the lesson
 * is finished as the map counts it (isLessonComplete; completedLessonIds).
 */
export interface RatingProgress {
  watched: boolean;
  done: boolean;
}

/** Null when the student can rate the lesson, otherwise why not. */
export function ratingRefusal(lesson: RateableLesson, progress: RatingProgress): RatingRefusal | null {
  if (lesson.type !== "watch") return "not_video";
  if (lesson.feature_key === RATING_BOUNTY_KEY) return "bounty";
  if (!progress.watched || !progress.done) return "not_finished";
  return null;
}

/** Can a lesson of this kind be rated at all, by anyone who finishes it? The admin page lists these. */
export function isRateableLesson(lesson: RateableLesson): boolean {
  return ratingRefusal(lesson, { watched: true, done: true }) === null;
}

/**
 * Every sentence the route answers with, which the lesson page shows as it
 * is. Plain words: no dash, digits for numbers.
 */
export const RATING_WORDS = {
  not_video: "Only video lessons can be rated.",
  bounty: "The Ad Bounty lesson can't be rated.",
  not_finished: "Finish this lesson first, then rate it.",
  stars: "Pick 1 to 5 stars.",
  commentTooLong: `A comment can be up to ${RATING_COMMENT_MAX} characters.`,
  commentNotText: "A comment has to be text.",
  noLesson: "Say which lesson this rating is for.",
  unreadable: "Couldn't read that request. Try again.",
  lessonNotFound: "That lesson isn't in the course.",
  studentNotFound: "Your student account wasn't found. Sign in again.",
  readFailed: "Couldn't check this lesson just now. Try again.",
  saveFailed: "Couldn't save your rating. Try again.",
} as const;

/** The route's refusal code beside each rule's sentence. */
export const RATING_REFUSAL_CODE: Record<RatingRefusal, string> = {
  not_video: "not_a_video_lesson",
  bounty: "ad_bounty_lesson",
  not_finished: "lesson_not_finished",
};

/** A request body, checked: what to save, or the sentence to answer with. */
export type RatingInput =
  | { ok: true; lessonId: string; stars: number; comment: string | null }
  | { ok: false; error: string };

/**
 * The body of POST /api/student/rate-lesson, checked before anything is read:
 * a lesson id, whole stars from 1 to 5, and a comment that is text of at most
 * RATING_COMMENT_MAX characters once trimmed (empty or missing: no comment).
 * Nothing is rounded or cut: a value that does not fit is refused, so what is
 * saved is what the student sent.
 */
export function checkRatingInput(body: unknown): RatingInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: RATING_WORDS.unreadable };
  const b = body as { lessonId?: unknown; stars?: unknown; comment?: unknown };
  if (typeof b.lessonId !== "string" || b.lessonId.trim() === "") return { ok: false, error: RATING_WORDS.noLesson };
  if (typeof b.stars !== "number" || !Number.isInteger(b.stars) || b.stars < 1 || b.stars > 5) {
    return { ok: false, error: RATING_WORDS.stars };
  }
  let comment: string | null = null;
  if (b.comment !== undefined && b.comment !== null) {
    if (typeof b.comment !== "string") return { ok: false, error: RATING_WORDS.commentNotText };
    const trimmed = b.comment.trim();
    if (trimmed.length > RATING_COMMENT_MAX) return { ok: false, error: RATING_WORDS.commentTooLong };
    comment = trimmed === "" ? null : trimmed;
  }
  return { ok: true, lessonId: b.lessonId.trim(), stars: b.stars, comment };
}
