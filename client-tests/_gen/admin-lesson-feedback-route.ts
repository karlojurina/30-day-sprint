/**
 * GET /api/admin/lesson-feedback: everything /admin/feedback/lessons shows,
 * in one answer (admin rebuild 2, D10 and WI-7).
 *
 * The students' ratings since the course switch, grouped by area, then
 * lesson, in course order: each lesson's average, its count and its
 * comments newest first, with the name of who wrote each. loadLessonFeedback
 * (src/lib/admin/lesson-feedback.ts) reads it all, paged; buildLessonFeedback
 * groups it.
 *
 * Why a route: the reads run with the service role, as the 30% page's do,
 * so the page does not depend on how the team's own session is let into
 * each table, and the tests run it through the real team check.
 *
 * Auth: founders and admins. The csm role does not see Lesson feedback in the
 * top bar (src/lib/admin/admin-frame.ts) and gets 403 here. Writes nothing.
 *
 * A read that fails answers 500 with a plain sentence, never an empty page:
 * an empty page reads as "no student rated anything", which is a believable
 * wrong answer.
 */

import { NextRequest, NextResponse } from "./stub-server.ts";
import { requireTeam, isAuthFailure } from "./admin-auth.ts";
import { buildLessonFeedback, loadLessonFeedback } from "./lesson-feedback.ts";

export const dynamic = "force-dynamic";

/** The page's sentence when a read failed. (A route file exports only its handlers.) */
const LESSON_FEEDBACK_READ_FAILED = "Couldn't read the lesson ratings, so nothing is shown. Try again.";

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;

  const load = await loadLessonFeedback(auth.supabase);
  if (!load.ok) {
    console.error(`[admin lesson-feedback] reads failed: ${load.failed.join("; ")}`);
    return NextResponse.json({ error: LESSON_FEEDBACK_READ_FAILED, failed: load.failed }, { status: 500 });
  }

  return NextResponse.json(buildLessonFeedback(load.data, new Date()));
}
