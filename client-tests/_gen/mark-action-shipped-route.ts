import { NextRequest, NextResponse } from "./stub-server.ts";
import { createClient } from "./stub-server.ts";
import { refuseWhileClosed } from "./student-app-gate.ts";
import { markStudentActive, tickStudentStreak } from "./stub-server.ts";
import { evaluateAchievements } from "./stub-server.ts";
import { checkR2CompoundsShipped, onLessonCompleted } from "./stub-server.ts";
import { reEvaluateStudentOpenTasks } from "./stub-server.ts";
import { CATALOG_IS_V2, LESSONS_TABLE } from "./stub-server.ts";
import {
  PASTE_LINK_FIRST,
  actionWrite,
  hasActionHalf,
  isDoneOnly,
  plainWriteError,
  watchHalfIsSeparate,
} from "./action-items.ts";

/**
 * POST /api/student/mark-action-shipped
 *
 * Toggles the action_completed_at column on a compound lesson's
 * completion row. Used when the student manually clicks "I shipped
 * the ad" (or undoes it) on a compound lesson in the LessonSheet. On the
 * new course's catalog an undo is refused (T-079): its lesson page has no
 * undo button.
 *
 * Safe to call on a row that doesn't yet exist (creates it with only
 * action_completed_at set, completed_at=null) or that already has the
 * watch part stored.
 *
 * The lesson is read from the active catalog (LESSONS_TABLE). On the new
 * course's catalog (CATALOG_IS_V2) an action item with no video half (a
 * setup lesson) has nothing else to complete it, so the button sets BOTH
 * halves and the lesson is done (src/lib/progress.ts isLessonComplete). The
 * live app's catalog is not v2, so there it writes what it always wrote. The
 * decision is actionWrite() in src/lib/world/action-items.ts.
 *
 * On the new course it completes an action item only once its Discord link
 * is saved, except a Done-only one (isDoneOnly, the list in action-items.ts
 * since 2026-10-22), whose page has a Done button and no link field. On one
 * with a video Done writes the action half alone, as the button of any watch
 * lesson does: the video's half comes only from watching it.
 *
 * A write that fails is answered as a failure, never as a success. Before
 * the cutover the completions table references `lessons(id)` only, so a
 * new-course lesson's insert fails its foreign key: 409 with plain words.
 *
 * Body: { lessonId: string, shipped: boolean }
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const { lessonId, shipped } = await request.json();
  if (!lessonId || typeof shipped !== "boolean") {
    return NextResponse.json(
      { error: "Missing lessonId or shipped" },
      { status: 400 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // T-078: closed to students until the new course (lib/student-app-gate.ts).
  const closed = await refuseWhileClosed(supabase, user.id);
  if (closed) return closed;

  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("supabase_user_id", user.id)
    .single();
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Verify the lesson is actually compound — refuse to set action state
  // on a non-compound lesson so we don't end up with weird half-rows.
  const { data: lesson } = await supabase
    .from(LESSONS_TABLE)
    .select("id, requires_action, type")
    .eq("id", lessonId)
    .single();
  if (!lesson || !hasActionHalf(lesson)) {
    return NextResponse.json(
      { error: "Not a compound lesson" },
      { status: 400 }
    );
  }

  // On the new course a completed action item stays completed. The lesson
  // page has no undo, and an undo followed by a new press would count a
  // streak day with no new work (T-079). The old course keeps its undo.
  if (!shipped && CATALOG_IS_V2) {
    return NextResponse.json(
      { error: "A completed action item can't be undone." },
      { status: 400 }
    );
  }

  // Check existing row
  const { data: existing, error: existingError } = await supabase
    .from("student_lesson_completions")
    .select("id, completed_at, action_completed_at, discord_message_link")
    .eq("student_id", student.id)
    .eq("lesson_id", lessonId)
    .single();

  // On the new course an action item is completed only once its Discord link
  // is saved (backend_readiness.md item 15, morning review A3). The page asks
  // for the link first; this holds the same rule here, so a request made
  // without the page cannot complete one. The old course is left exactly as
  // it was, and there undoing needs no link.
  //
  // Except the Done-only action items (the owner, 2026-10-22: isDoneOnly and
  // DONE_ONLY_ACTION_ITEMS in action-items.ts): nothing is posted for them,
  // so they complete with no link saved. A link on their row, or one sent in
  // the body, is never read here: the write below is the same either way, and
  // the row keeps whatever link it had.
  if (shipped && CATALOG_IS_V2) {
    // .single() answers "no row" with PGRST116, which is not a failure.
    if (existingError && existingError.code !== "PGRST116") {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (!isDoneOnly(lesson.id) && !existing?.discord_message_link) {
      return NextResponse.json({ error: PASTE_LINK_FIRST }, { status: 400 });
    }
  }

  // Watch lessons: the action half alone, and unshipping a row whose video
  // was never watched drops the row (as before). A v2 setup action item:
  // both halves (action-items.ts, actionWrite).
  const write = actionWrite({
    separateWatchHalf: watchHalfIsSeparate(lesson, CATALOG_IS_V2),
    shipped,
    existing: existing ?? null,
    now: new Date().toISOString(),
  });

  let result;
  if (write.kind === "delete" && existing) {
    const { error } = await supabase
      .from("student_lesson_completions")
      .delete()
      .eq("id", existing.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    result = null;
  } else if (write.kind === "update" && existing) {
    const { data, error } = await supabase
      .from("student_lesson_completions")
      .update(write.fields)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    result = data;
  } else if (write.kind === "insert") {
    const { data, error } = await supabase
      .from("student_lesson_completions")
      .insert({
        student_id: student.id,
        lesson_id: lessonId,
        ...write.fields,
      })
      .select()
      .single();
    if (error) {
      const plain = plainWriteError(error);
      return NextResponse.json(
        { error: plain ?? error.message },
        { status: plain ? 409 : 500 },
      );
    }
    result = data;
  } else {
    // No existing row and unshipping: nothing to unship.
    return NextResponse.json({ completion: null });
  }

  // A task done is a streak day (T-079): the action half newly done, on
  // both courses, whether or not the lesson's video is watched yet (watching
  // it is a streak day of its own, lesson-watched). Pressing it again on a
  // done action, or undoing one, is no new work.
  if (shipped && !existing?.action_completed_at && result?.action_completed_at) {
    await tickStudentStreak(supabase, student.id);
  }
  // "Last active" moves where it always did: a shipped action that leaves
  // both halves done.
  if (shipped && result?.completed_at && result?.action_completed_at) {
    await markStudentActive(supabase, student.id);
  }

  // CSM event hooks (best-effort — failures here never break the
  // student-facing response):
  if (shipped && result?.action_completed_at) {
    await checkR2CompoundsShipped(supabase, student.id, lessonId);
    await onLessonCompleted(supabase, student.id);
  }

  // v53 (Phase 5) - achievements.
  const newAchievements = await evaluateAchievements(supabase, student.id);

  // v75.21 - real-time CSM task dismissal. Shipping an action can
  // invalidate noship.*/pace.* tasks. Best-effort.
  await reEvaluateStudentOpenTasks(supabase, student.id);

  return NextResponse.json({ completion: result, newAchievements });
}
