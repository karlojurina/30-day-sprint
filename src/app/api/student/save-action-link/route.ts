/**
 * POST /api/student/save-action-link
 *
 * Saves (or clears) the Discord message link the student pastes after
 * shipping an action-item ad to #ad-review.
 *
 * Body: { lessonId: string, link: string | null }
 *
 * Constraints:
 *   - Lesson must be an action-item (requires_action = true OR type = 'action').
 *   - A completion row must already exist for (student, lesson). The link
 *     is metadata on the shipped submission, not a way to mark complete.
 *   - link must match the Discord message URL format, else 400.
 *   - Passing null/'' clears the link.
 *
 * The DB CHECK constraint (v28) double-validates as a defense in depth.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DISCORD_LINK_RE =
  /^https:\/\/discord\.com\/channels\/[0-9]+\/[0-9]+\/[0-9]+\/?$/;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const token = authHeader.slice(7);
  const body = await request.json().catch(() => null);
  const lessonId =
    typeof body?.lessonId === "string" ? body.lessonId.trim() : "";
  const linkRaw = typeof body?.link === "string" ? body.link.trim() : "";
  const link = linkRaw.length === 0 ? null : linkRaw;

  if (!lessonId) {
    return NextResponse.json({ error: "Missing lessonId" }, { status: 400 });
  }
  if (link !== null && !DISCORD_LINK_RE.test(link)) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like a Discord message link. Right-click the message in #ad-review and click \"Copy Message Link.\"",
      },
      { status: 400 },
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser(token);
  if (userErr || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("supabase_user_id", user.id)
    .single();
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Lesson must be an action-item (compound or pure action).
  const { data: lesson } = await supabase
    .from("lessons")
    .select("id, requires_action, type")
    .eq("id", lessonId)
    .single();
  if (!lesson || !(lesson.requires_action || lesson.type === "action")) {
    return NextResponse.json(
      { error: "Only action-item lessons can have a Discord link" },
      { status: 400 },
    );
  }

  // v75.33: support the v74.3 UI flow ("paste link first, then mark
  // shipped"). The LessonSheet UI disables the Mark shipped button
  // until the link is saved — but this route was rejecting the save
  // when no completion row existed yet, leaving the student stuck:
  // can't save link without prior row, can't mark shipped without
  // saved link. The UI was redesigned in v74.3 but the route was
  // never updated.
  //
  // Fix: maybeSingle + insert-or-update. If no row exists, INSERT
  // a row with the link and null completion fields. If row exists,
  // UPDATE the link column.
  //
  // Clearing (link === null) on a non-existent row is a no-op:
  // nothing to clear.
  const { data: existing } = await supabase
    .from("student_lesson_completions")
    .select("id")
    .eq("student_id", student.id)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  let data;
  let error;

  if (existing) {
    const result = await supabase
      .from("student_lesson_completions")
      .update({ discord_message_link: link })
      .eq("id", existing.id)
      .select()
      .single();
    data = result.data;
    error = result.error;
  } else {
    if (link === null) {
      // Nothing to clear; not an error.
      return NextResponse.json({ completion: null });
    }
    const result = await supabase
      .from("student_lesson_completions")
      .insert({
        student_id: student.id,
        lesson_id: lessonId,
        completed_at: null,
        action_completed_at: null,
        skipped_at: null,
        discord_message_link: link,
      })
      .select()
      .single();
    data = result.data;
    error = result.error;
  }

  if (error) {
    // CHECK constraint failure → friendly error
    return NextResponse.json(
      {
        error: error.message.includes("discord_message_link_format_chk")
          ? "Invalid Discord message link format."
          : error.message,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ completion: data });
}
