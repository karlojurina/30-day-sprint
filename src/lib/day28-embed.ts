/**
 * Shared Day-28 DM embed builder.
 *
 * Used by:
 *   • /api/cron/day28-dm — the nightly cron that fires for students
 *     exactly 28 days into their sprint.
 *   • /api/admin/preview-day28-dm — the admin "test fire" button on
 *     /admin/discord, which sends the same embed to DISCORD_TEST_DM_RECIPIENT
 *     so the team can preview formatting without mutating real students.
 *
 * Pulling this out means changes to the embed (fields, color, footer,
 * copy) land in both places at once and never drift.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

export interface Day28EmbedInput {
  studentName: string | null;
  lessonsDone: number;
  totalLessons: number;
  longestStreak: number;
  notesCount: number;
  /** Pre-formatted string: "✅ CODE" / "⏳ pending review" / "❌ rejected" / "—" */
  discountState: string;
  baseUrl: string;
}

/**
 * Pure function: same inputs always produce the same embed. Both the
 * cron and the preview build their inputs separately (different
 * sources) but call this to render the final payload.
 */
export function buildDay28Embed(input: Day28EmbedInput): DiscordEmbed {
  const firstName = input.studentName?.split(" ")[0] ?? "there";
  return {
    title: `🎯 Your 30 days, ${firstName}`,
    description: `Here's the receipt for the last month — keep going from here.\n\n[Open your map](${input.baseUrl}/dashboard-mockup)`,
    color: 0xe6c07a,
    fields: [
      {
        name: "Lessons completed",
        value: `${input.lessonsDone} / ${input.totalLessons}`,
        inline: true,
      },
      {
        name: "Longest streak",
        value: `${input.longestStreak} days`,
        inline: true,
      },
      {
        name: "Notes written",
        value: `${input.notesCount}`,
        inline: true,
      },
      {
        name: "Discount",
        value: input.discountState,
        inline: false,
      },
    ],
    footer: { text: "EcomTalent · 30-day sprint" },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Loads the data needed for a single student's Day-28 embed and
 * returns it ready to render. Pulled out of the cron loop so the
 * preview endpoint can reuse it for one specific student without
 * the cron's batch logic.
 */
export async function loadDay28EmbedInput(
  supabase: SupabaseClient,
  studentId: string,
  baseUrl: string,
): Promise<Day28EmbedInput | { error: string }> {
  const [
    { data: student },
    { data: completions },
    { data: discountReq },
    { count: notesCount },
    { data: lessonsTable },
  ] = await Promise.all([
    supabase
      .from("students")
      .select("name, longest_streak")
      .eq("id", studentId)
      .single(),
    supabase
      .from("student_lesson_completions")
      .select("lesson_id, completed_at, action_completed_at")
      .eq("student_id", studentId),
    supabase
      .from("discount_requests")
      .select("status, promo_code")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("lesson_notes")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId),
    supabase.from("lessons").select("id, requires_action"),
  ]);

  if (!student) return { error: "Student not found" };

  const totalLessons = lessonsTable?.length ?? 0;
  const lessonsDone = (completions ?? []).filter((c) => {
    const lesson = lessonsTable?.find((l) => l.id === c.lesson_id);
    if (!lesson) return false;
    if (lesson.requires_action) {
      return c.completed_at != null && c.action_completed_at != null;
    }
    return c.completed_at != null;
  }).length;

  const discountState =
    discountReq?.status === "approved"
      ? `✅ ${discountReq.promo_code ?? "approved"}`
      : discountReq?.status === "pending"
        ? "⏳ pending review"
        : discountReq?.status === "rejected"
          ? "❌ rejected"
          : "—";

  return {
    studentName: student.name,
    lessonsDone,
    totalLessons,
    longestStreak: student.longest_streak ?? 0,
    notesCount: notesCount ?? 0,
    discountState,
    baseUrl,
  };
}
