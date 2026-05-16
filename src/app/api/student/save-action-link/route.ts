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

  // Existing row required.
  const { data: existing } = await supabase
    .from("student_lesson_completions")
    .select("id")
    .eq("student_id", student.id)
    .eq("lesson_id", lessonId)
    .single();
  if (!existing) {
    return NextResponse.json(
      { error: "Mark the action shipped before adding the Discord link." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("student_lesson_completions")
    .update({ discord_message_link: link })
    .eq("id", existing.id)
    .select()
    .single();

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
