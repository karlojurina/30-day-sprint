"use client";

import { send } from "@/lib/admin/admin-transport";
import type { Answer } from "@/lib/admin/admin-transport";
import type { LessonFeedbackView } from "@/lib/admin/lesson-feedback";

/**
 * The Lesson feedback page's one call (admin rebuild 2, WI-7), behind an
 * interface as the 30% page's are (admin-transport.ts): the dev page
 * /dev/admin/feedback/lessons hands the same view a stand-in for it
 * (src/app/dev/admin/feedback/lesson-fixtures.ts). It never throws: the
 * answer is the route's data, or a sentence the page shows.
 */
export interface LessonFeedbackTransport {
  /** GET /api/admin/lesson-feedback. */
  loadLessonFeedback(): Promise<Answer<LessonFeedbackView>>;
}

/** The real call, with the signed-in team member's session. */
export const lessonFeedbackTransport: LessonFeedbackTransport = {
  loadLessonFeedback: () => send<LessonFeedbackView>("GET", "/api/admin/lesson-feedback"),
};
