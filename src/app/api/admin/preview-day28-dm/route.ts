/**
 * POST /api/admin/preview-day28-dm
 *
 * Sends the Day-28 embed for a chosen student to the test recipient
 * (DISCORD_TEST_DM_RECIPIENT env var). Used by /admin/discord — the
 * team-facing test page — so the team can preview formatting without
 * waiting for a real student to hit Day 28.
 *
 * Difference vs the cron:
 *   • Doesn't touch the student row (no day28_dm_sent_at stamp).
 *   • Always sends to the test recipient, never to the actual student.
 *   • Doesn't fall back to the team channel — failure surfaces as a
 *     JSON error so the UI can show it.
 *
 * Body: { studentId: string }
 * Auth: requireTeam ["founder", "admin"]
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { dmStudent } from "@/lib/discord";
import { buildDay28Embed, loadDay28EmbedInput } from "@/lib/day28-embed";

export async function POST(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;

  const recipient = process.env.DISCORD_TEST_DM_RECIPIENT;
  if (!recipient) {
    return NextResponse.json(
      {
        error:
          "DISCORD_TEST_DM_RECIPIENT not set on Vercel. Set it to a Discord user ID first.",
      },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    studentId?: string;
  };
  if (!body.studentId) {
    return NextResponse.json({ error: "studentId required" }, { status: 400 });
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://30-day-sprint-smkv.vercel.app";

  const input = await loadDay28EmbedInput(auth.supabase, body.studentId, baseUrl);
  if ("error" in input) {
    return NextResponse.json({ error: input.error }, { status: 404 });
  }

  const embed = buildDay28Embed(input);
  const result = await dmStudent(recipient, [embed]);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason ?? "Discord DM failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    recipient,
    student_name: input.studentName,
    preview: {
      lessons_done: input.lessonsDone,
      total_lessons: input.totalLessons,
      longest_streak: input.longestStreak,
      notes: input.notesCount,
      discount: input.discountClaimed ? "Claimed" : "Not claimed",
    },
  });
}
