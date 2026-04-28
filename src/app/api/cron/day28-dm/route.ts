import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { dmStudent, postTeamAlert } from "@/lib/discord";

/**
 * Day-28 student summary DM cron.
 *
 * Runs daily. Picks students whose `joined_at` is between 28 and 30
 * days ago AND whose `day28_dm_sent_at` is null. For each, builds a
 * personal stats payload and tries to DM them via the Discord bot.
 * Falls back to a public team-channel post if the DM fails (no
 * discord_user_id, DMs disabled, bot not mutual, etc.).
 *
 * Idempotent — stamps `day28_dm_sent_at` on success or fallback so
 * the same student isn't messaged twice.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const minJoined = new Date(now.getTime() - 30 * 86_400_000); // ≥30d ago
  const maxJoined = new Date(now.getTime() - 28 * 86_400_000); // ≤28d ago

  const { data: candidates } = await supabase
    .from("students")
    .select(
      "id, name, joined_at, current_streak, longest_streak, discord_user_id, day28_dm_sent_at"
    )
    .eq("membership_status", "active")
    .is("day28_dm_sent_at", null)
    .gte("joined_at", minJoined.toISOString())
    .lte("joined_at", maxJoined.toISOString());

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ checked: 0, sent: 0 });
  }

  // Per-student lesson counts and discount status — fetched in batch
  const studentIds = candidates.map((s) => s.id);

  const [
    { data: completions },
    { data: discountReqs },
    { data: notes },
  ] = await Promise.all([
    supabase
      .from("student_lesson_completions")
      .select("student_id, lesson_id, completed_at, action_completed_at")
      .in("student_id", studentIds),
    supabase
      .from("discount_requests")
      .select("student_id, status, promo_code")
      .in("student_id", studentIds),
    supabase
      .from("lesson_notes")
      .select("student_id")
      .in("student_id", studentIds),
  ]);

  // Need lesson totals + region grouping for the embed
  const { data: lessonsTable } = await supabase
    .from("lessons")
    .select("id, region_id, requires_action");

  const totalLessons = lessonsTable?.length ?? 0;

  let sent = 0;
  let fallback = 0;
  let failed = 0;
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://30-day-sprint-smkv.vercel.app";

  for (const student of candidates) {
    const studentCompletions = (completions ?? []).filter(
      (c) => c.student_id === student.id
    );
    const lessonsDone = studentCompletions.filter((c) => {
      const lesson = lessonsTable?.find((l) => l.id === c.lesson_id);
      if (!lesson) return false;
      if (lesson.requires_action) {
        return c.completed_at != null && c.action_completed_at != null;
      }
      return c.completed_at != null;
    }).length;

    const discountReq = discountReqs?.find((d) => d.student_id === student.id);
    const discountState =
      discountReq?.status === "approved"
        ? `✅ ${discountReq.promo_code ?? "approved"}`
        : discountReq?.status === "pending"
          ? "⏳ pending review"
          : discountReq?.status === "rejected"
            ? "❌ rejected"
            : "—";

    const notesCount = (notes ?? []).filter(
      (n) => n.student_id === student.id
    ).length;

    const firstName = student.name?.split(" ")[0] ?? "there";
    const embed = {
      title: `🎯 Your 30 days, ${firstName}`,
      description: `Here's the receipt for the last month — keep going from here.\n\n[Open your map](${baseUrl}/dashboard-mockup)`,
      color: 0xe6c07a,
      fields: [
        {
          name: "Lessons completed",
          value: `${lessonsDone} / ${totalLessons}`,
          inline: true,
        },
        {
          name: "Longest streak",
          value: `${student.longest_streak ?? 0} days`,
          inline: true,
        },
        {
          name: "Notes written",
          value: `${notesCount}`,
          inline: true,
        },
        {
          name: "Discount",
          value: discountState,
          inline: false,
        },
      ],
      footer: { text: "EcomTalent · 30-day sprint" },
      timestamp: new Date().toISOString(),
    };

    let delivered = false;
    if (student.discord_user_id) {
      const result = await dmStudent(student.discord_user_id, [embed]);
      if (result.ok) {
        delivered = true;
        sent++;
      } else {
        console.warn(
          `[day28-dm] DM failed for ${student.id}: ${result.reason}`
        );
      }
    }

    // Fallback — post to the team channel asking them to share
    if (!delivered) {
      const fallbackEmbed = {
        ...embed,
        title: `🎯 Day-28 summary for ${student.name ?? "Student"}`,
        description: `${embed.description}\n\n_(Couldn't DM directly — share this with them.)_`,
      };
      const r = await postTeamAlert([fallbackEmbed]);
      if (r.ok) {
        fallback++;
      } else {
        failed++;
      }
    }

    // Stamp regardless (we don't want infinite retries on a broken
    // discord_user_id; team can manually re-send if needed)
    await supabase
      .from("students")
      .update({ day28_dm_sent_at: new Date().toISOString() })
      .eq("id", student.id);
  }

  return NextResponse.json({
    checked: candidates.length,
    sent,
    fallback,
    failed,
  });
}
