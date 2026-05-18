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
import { buildPaceSummary } from "@/lib/csm-triggers";
import type { RegionId } from "@/types/database";

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

/** The five action items students ship on Map 1. */
const ACTION_ITEMS: { id: string; label: string }[] = [
  { id: "l018", label: "Organic" },
  { id: "l020", label: "UGC" },
  { id: "l022", label: "VSL" },
  { id: "l024", label: "High-prod" },
  { id: "l049", label: "Static" },
];

const REGION_LABEL: Record<RegionId, string> = {
  r1: "Foundation",
  r2: "Strategy",
  r3: "Production",
  r4: "Gate of Possibilities",
};

export interface Day28EmbedInput {
  studentName: string | null;
  /** Day number at fire time (28 normally, 29 if the cron caught a slip). */
  dayNumber: number;
  lessonsDone: number;
  totalLessons: number;
  longestStreak: number;
  notesCount: number;
  /** Pre-formatted string: "✅ CODE" / "⏳ pending review" / "❌ rejected" / "—" */
  discountState: string;
  /** Each action item flagged shipped or not. */
  actionShips: { label: string; shipped: boolean }[];
  /** Highest region with at least one fully-complete lesson. */
  furthestRegion: RegionId;
  /** "behind" / "on_pace" / "ahead" from buildPaceSummary. */
  paceLabel: "behind" | "on_pace" | "ahead";
  /** Lesson delta from expected pace, rounded. Positive = ahead. */
  paceDelta: number;
  /** Best single day's completion count + ISO date, null if zero data. */
  bestDay: { date: string; count: number } | null;
  /** Percentile (0–100) within ±7-day cohort, null if cohort too small. */
  cohortPercentile: number | null;
  /** Total students in the cohort comparison. */
  cohortSize: number;
  baseUrl: string;
}

/**
 * Pure function: same inputs always produce the same embed.
 */
export function buildDay28Embed(input: Day28EmbedInput): DiscordEmbed {
  const firstName = input.studentName?.split(" ")[0] ?? "there";
  const completionPct = Math.round(
    (input.lessonsDone / Math.max(1, input.totalLessons)) * 100,
  );
  const completedAll = input.lessonsDone >= input.totalLessons * 0.95;
  const shipsDone = input.actionShips.filter((a) => a.shipped).length;

  // Pace line — "↑ Ahead by 6" / "→ On pace" / "↓ Behind by 4"
  const paceLine =
    input.paceLabel === "ahead"
      ? `↑ Ahead by ${Math.abs(input.paceDelta)}`
      : input.paceLabel === "behind"
        ? `↓ Behind by ${Math.abs(input.paceDelta)}`
        : "→ On pace";

  // Action ships row — visual checklist
  const shipsLine = input.actionShips
    .map((a) => `${a.shipped ? "✓" : "○"} ${a.label}`)
    .join(" · ");

  // Best day formatted
  const bestDayLine = input.bestDay
    ? `best day: ${input.bestDay.count} lesson${input.bestDay.count === 1 ? "" : "s"} on ${formatDate(input.bestDay.date)}`
    : "no streak yet";

  // Cohort line
  const cohortLine =
    input.cohortPercentile != null && input.cohortSize >= 3
      ? `ahead of ${input.cohortPercentile}% of students who joined the same week (n=${input.cohortSize})`
      : `cohort too small to rank (n=${input.cohortSize})`;

  return {
    title: `🎯 Your 30 days, ${firstName}`,
    description: heroLine({
      firstName,
      completedAll,
      paceLabel: input.paceLabel,
      shipsDone,
      furthestRegion: input.furthestRegion,
    }),
    color: 0xe6c07a,
    fields: [
      {
        name: "🏔️ The climb",
        value: `**${input.lessonsDone} / ${input.totalLessons}** lessons (${completionPct}%) · ${paceLine}\nFurthest region: **${REGION_LABEL[input.furthestRegion]}**`,
        inline: false,
      },
      {
        name: "🎬 Ads shipped",
        value: `${shipsLine}  ·  **${shipsDone}/${input.actionShips.length}**`,
        inline: false,
      },
      {
        name: "🔥 Locked in",
        value: `${input.longestStreak}-day longest streak · ${bestDayLine}`,
        inline: true,
      },
      {
        name: "📓 Notes",
        value: `${input.notesCount} written`,
        inline: true,
      },
      {
        name: "📊 vs your cohort",
        value: cohortLine,
        inline: false,
      },
      {
        name: "🎁 Discount",
        value: input.discountState,
        inline: false,
      },
      {
        name: "💛 What's next",
        value: closingLine({
          completedAll,
          paceLabel: input.paceLabel,
          shipsDone,
          totalShips: input.actionShips.length,
        }),
        inline: false,
      },
    ],
    footer: { text: `EcomTalent · Day ${input.dayNumber}` },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Hero one-liner under the title. Voice-aligned to "what they became,"
 * varied by their state at fire time.
 */
function heroLine(args: {
  firstName: string;
  completedAll: boolean;
  paceLabel: "behind" | "on_pace" | "ahead";
  shipsDone: number;
  furthestRegion: RegionId;
}): string {
  if (args.completedAll) {
    return "30 days ago you were a beginner. Today you've climbed the whole map.";
  }
  if (args.shipsDone >= 4) {
    return `You walked in a beginner. Right now you've shipped ${args.shipsDone} ad formats.`;
  }
  if (args.shipsDone >= 2) {
    return "You walked in a beginner. You've shipped real ads.";
  }
  if (args.paceLabel === "behind") {
    return "Quick check-in — here's where you stand at the 30-day mark.";
  }
  return "Here's the receipt for the last month — keep going from here.";
}

function closingLine(args: {
  completedAll: boolean;
  paceLabel: "behind" | "on_pace" | "ahead";
  shipsDone: number;
  totalShips: number;
}): string {
  if (args.completedAll) {
    return "30 days. The full climb. You're the marketer now — go put it to work.";
  }
  if (args.paceLabel === "ahead") {
    return "You're flying. Don't break the rhythm — pick up where you left off tomorrow.";
  }
  if (args.paceLabel === "on_pace") {
    return "Solid pace. A handful of lessons left. Close the loop this week.";
  }
  // behind
  if (args.shipsDone >= 2) {
    return "You shipped real work even though the pace slipped. That counts. Pick the next lesson and go.";
  }
  return "Behind is fine. The lessons are right where you left them — one at a time is enough.";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
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
      .select("name, longest_streak, joined_at")
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
    supabase.from("lessons").select("id, region_id, requires_action"),
  ]);

  if (!student) return { error: "Student not found" };

  const totalLessons = lessonsTable?.length ?? 0;
  const lessonRegion = new Map<string, RegionId>(
    (lessonsTable ?? []).map((l) => [l.id, l.region_id as RegionId]),
  );
  const lessonRequiresAction = new Map<string, boolean>(
    (lessonsTable ?? []).map((l) => [l.id, Boolean(l.requires_action)]),
  );

  // Fully-complete = watched (and shipped, if the lesson needs an action).
  const completedRows = (completions ?? []).filter((c) => {
    const requires = lessonRequiresAction.get(c.lesson_id);
    if (requires) {
      return c.completed_at != null && c.action_completed_at != null;
    }
    return c.completed_at != null;
  });
  const lessonsDone = completedRows.length;

  // Furthest region — highest region order with any fully-complete lesson.
  const REGION_ORDER: RegionId[] = ["r1", "r2", "r3", "r4"];
  let furthestRegion: RegionId = "r1";
  for (const row of completedRows) {
    const rid = lessonRegion.get(row.lesson_id);
    if (
      rid &&
      REGION_ORDER.indexOf(rid) > REGION_ORDER.indexOf(furthestRegion)
    ) {
      furthestRegion = rid;
    }
  }

  // Pace
  const pace = buildPaceSummary(
    student.joined_at as string,
    lessonsDone,
    totalLessons,
    furthestRegion,
  );
  // Delta = actual completed − expected, rounded to whole lessons.
  const paceDelta = Math.round(pace.completedLessons - pace.expectedLessons);

  // Action ships — for each of the five Map-1 action items, did they
  // ship it? "Shipped" = action_completed_at set on the row.
  const shippedMap = new Map<string, boolean>();
  for (const c of completions ?? []) {
    if (c.action_completed_at != null) shippedMap.set(c.lesson_id, true);
  }
  const actionShips = ACTION_ITEMS.map((a) => ({
    label: a.label,
    shipped: shippedMap.get(a.id) === true,
  }));

  // Best day — group completed_at timestamps by date, pick max count.
  const dateCounts = new Map<string, number>();
  for (const c of completedRows) {
    if (!c.completed_at) continue;
    const d = (c.completed_at as string).slice(0, 10);
    dateCounts.set(d, (dateCounts.get(d) ?? 0) + 1);
  }
  let bestDay: { date: string; count: number } | null = null;
  for (const [d, n] of dateCounts) {
    if (!bestDay || n > bestDay.count) bestDay = { date: d, count: n };
  }

  // Cohort percentile — students who joined within ±7 days. We compare
  // against the COUNT of their student_progress_counts row (the
  // pre-aggregated view we built earlier — no 1000-row truncation).
  let cohortPercentile: number | null = null;
  let cohortSize = 0;
  {
    const joinedDate = new Date(student.joined_at as string);
    const start = new Date(joinedDate.getTime() - 7 * 86_400_000).toISOString();
    const end = new Date(joinedDate.getTime() + 7 * 86_400_000).toISOString();
    const { data: cohort } = await supabase
      .from("students")
      .select("id, csm_exempt, joined_at, membership_status")
      .gte("joined_at", start)
      .lte("joined_at", end)
      .eq("csm_exempt", false)
      .in("membership_status", ["active", "past_due", "canceled"]);

    const cohortIds = (cohort ?? []).map((s) => s.id as string);
    cohortSize = cohortIds.length;

    if (cohortIds.length >= 3) {
      const { data: counts } = await supabase
        .from("student_progress_counts")
        .select("student_id, completed_count")
        .in("student_id", cohortIds);

      const byId = new Map<string, number>(
        (counts ?? []).map((r) => [
          r.student_id as string,
          Number(r.completed_count) || 0,
        ]),
      );
      const myCount = byId.get(studentId) ?? lessonsDone;
      const belowOrEqual = cohortIds.filter(
        (id) => (byId.get(id) ?? 0) <= myCount,
      ).length;
      cohortPercentile = Math.round(
        (belowOrEqual / cohortIds.length) * 100,
      );
    }
  }

  const discountState =
    discountReq?.status === "approved"
      ? `✅ ${discountReq.promo_code ?? "approved"}`
      : discountReq?.status === "applied"
        ? `✅ applied`
        : discountReq?.status === "pending"
          ? "⏳ pending review"
          : discountReq?.status === "rejected"
            ? "❌ rejected"
            : "—";

  const dayNumber = pace.day;

  return {
    studentName: student.name as string | null,
    dayNumber,
    lessonsDone,
    totalLessons,
    longestStreak: Number(student.longest_streak ?? 0),
    notesCount: notesCount ?? 0,
    discountState,
    actionShips,
    furthestRegion,
    paceLabel: pace.progressLabel,
    paceDelta,
    bestDay,
    cohortPercentile,
    cohortSize,
    baseUrl,
  };
}
