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
  r2: "Production",
  r3: "Strategy",
  r4: "Gate of Possibilities",
};

export interface Day28EmbedInput {
  studentName: string | null;
  lessonsDone: number;
  totalLessons: number;
  longestStreak: number;
  notesCount: number;
  /** Binary state: "Claimed" or "Not claimed". */
  discountClaimed: boolean;
  /** Each action item flagged shipped or not. */
  actionShips: { label: string; shipped: boolean }[];
  /** Highest region the student has FULLY completed (all watch +
   *  required actions done). Null if no region is fully complete. */
  furthestRegionCompleted: RegionId | null;
  /** Region currently in progress (any completion but not all). Used
   *  for the "Working through" line when no region is fully done. */
  currentRegion: RegionId | null;
  currentRegionDone: number;
  currentRegionTotal: number;
  /** "behind" / "on_pace" / "ahead" from buildPaceSummary. */
  paceLabel: "behind" | "on_pace" | "ahead";
  /** Lesson delta from expected pace, rounded. Positive = ahead. */
  paceDelta: number;
  /** Percentile (0–100) within ±7-day cohort, null if too small. */
  cohortPercentile: number | null;
  /** Total students in the cohort comparison. */
  cohortSize: number;
  baseUrl: string;
}

/**
 * Pure function: same inputs always produce the same embed.
 *
 * Field-level hiding rules:
 *   • Locked in: hidden if longestStreak is 0
 *   • Notes: hidden if notesCount is 0
 *   • vs your week: hidden if cohort is < 3 students
 */
export function buildDay28Embed(input: Day28EmbedInput): DiscordEmbed {
  const firstName = input.studentName?.split(" ")[0] ?? "there";
  const completionPct = Math.round(
    (input.lessonsDone / Math.max(1, input.totalLessons)) * 100,
  );
  const completedAll = input.lessonsDone >= input.totalLessons * 0.95;
  const shipsDone = input.actionShips.filter((a) => a.shipped).length;

  // Region line — only shown when at least one region is fully done.
  // We don't surface "Working through: X" when nothing's complete —
  // partial progress isn't a milestone worth calling out at Day 28.
  const regionLine = input.furthestRegionCompleted
    ? `Furthest region completed: **${REGION_LABEL[input.furthestRegionCompleted]}**`
    : "";

  // Action ships row — visual checklist
  const shipsLine = input.actionShips
    .map((a) => `${a.shipped ? "✓" : "○"} ${a.label}`)
    .join(" · ");

  // Build fields conditionally so empty / awkward states don't ship.
  const fields: { name: string; value: string; inline?: boolean }[] = [
    {
      name: "🏔️ The climb",
      value: `**${input.lessonsDone} / ${input.totalLessons}** lessons (${completionPct}%)${regionLine ? `\n${regionLine}` : ""}`,
      inline: false,
    },
    {
      name: "🎬 Ads shipped",
      value: `${shipsLine}  ·  **${shipsDone}/${input.actionShips.length}**`,
      inline: false,
    },
  ];

  if (input.longestStreak > 0) {
    fields.push({
      name: "🔥 Locked in",
      value: `${input.longestStreak}-day longest streak`,
      inline: false,
    });
  }

  if (input.notesCount > 0) {
    fields.push({
      name: "📓 Notes",
      value: `${input.notesCount} written`,
      inline: false,
    });
  }

  if (input.cohortPercentile != null && input.cohortSize >= 3) {
    fields.push({
      name: "📊 vs your week",
      value: `Ahead of **${input.cohortPercentile}%** of the ${input.cohortSize} students who joined the same week as you.`,
      inline: false,
    });
  }

  fields.push(
    {
      name: "🎁 Discount",
      value: input.discountClaimed ? "Claimed" : "Not claimed",
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
  );

  return {
    title: `🎯 Your 30 days, ${firstName}`,
    description: heroLine({
      completedAll,
      paceLabel: input.paceLabel,
      shipsDone,
      lessonsDone: input.lessonsDone,
    }),
    color: 0xe6c07a,
    fields,
    footer: { text: "EcomTalent · 30-day sprint" },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Hero one-liner under the title. Voice-aligned to "what they became,"
 * varied by their state at fire time. No "receipt," no "let's talk
 * about," none of the banned-phrase register per the brief.
 */
function heroLine(args: {
  completedAll: boolean;
  paceLabel: "behind" | "on_pace" | "ahead";
  shipsDone: number;
  lessonsDone: number;
}): string {
  if (args.completedAll) {
    return "30 days ago you were a beginner. Today you've climbed the whole map.";
  }
  if (args.shipsDone >= 4) {
    return `You walked in a beginner. You've shipped ${args.shipsDone} ad formats — that's a portfolio.`;
  }
  if (args.shipsDone >= 2) {
    return "You walked in a beginner. You've shipped real ads. That's the part that matters.";
  }
  if (args.lessonsDone >= 20 && args.shipsDone === 0) {
    // The most coachable state — lots of watching, no shipping.
    return `${args.lessonsDone} lessons in. Watching is half — the work starts the moment you ship.`;
  }
  if (args.paceLabel === "behind") {
    return "Quick look at where you stand at the 30-day mark.";
  }
  return "Where you started, where you stand now.";
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
    { data: streaks },
    { data: completions },
    { data: discountReq },
    { count: notesCount },
    { data: lessonsTable },
  ] = await Promise.all([
    supabase
      .from("students")
      .select("name, joined_at")
      .eq("id", studentId)
      .single(),
    // v46 — longest_streak lives on student_streaks (was on students).
    supabase
      .from("student_streaks")
      .select("longest_streak")
      .eq("student_id", studentId)
      .maybeSingle(),
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

  // Per-region totals + fully-complete counts. Used for both the
  // "furthest region completed" and "working through" lines.
  const REGION_ORDER: RegionId[] = ["r1", "r2", "r3", "r4"];
  const regionTotals = new Map<RegionId, number>();
  for (const l of lessonsTable ?? []) {
    const rid = l.region_id as RegionId;
    regionTotals.set(rid, (regionTotals.get(rid) ?? 0) + 1);
  }
  const regionDone = new Map<RegionId, number>();
  for (const row of completedRows) {
    const rid = lessonRegion.get(row.lesson_id);
    if (rid) regionDone.set(rid, (regionDone.get(rid) ?? 0) + 1);
  }

  // Furthest fully-completed region — highest in order where every
  // lesson is done (watched + shipped where required).
  let furthestRegionCompleted: RegionId | null = null;
  for (const rid of REGION_ORDER) {
    const total = regionTotals.get(rid) ?? 0;
    const done = regionDone.get(rid) ?? 0;
    if (total > 0 && done >= total) furthestRegionCompleted = rid;
  }

  // Region they're currently working through — highest region with
  // partial progress (some done, not all). Skips fully-complete ones.
  let currentRegion: RegionId | null = null;
  for (const rid of REGION_ORDER) {
    const total = regionTotals.get(rid) ?? 0;
    const done = regionDone.get(rid) ?? 0;
    if (done > 0 && done < total) currentRegion = rid;
  }
  const currentRegionTotal = currentRegion
    ? (regionTotals.get(currentRegion) ?? 0)
    : 0;
  const currentRegionDone = currentRegion
    ? (regionDone.get(currentRegion) ?? 0)
    : 0;

  // Pace — use the furthest-completed (or current) as the region anchor.
  const pace = buildPaceSummary(
    student.joined_at as string,
    lessonsDone,
    totalLessons,
    furthestRegionCompleted ?? currentRegion ?? "r1",
  );
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

  // Cohort percentile — students who joined within ±7 days. We compare
  // against the COUNT of their student_progress_counts row (the
  // pre-aggregated view — no 1000-row truncation).
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

  // Binary discount state: claimed = approved or applied. Everything
  // else (pending / rejected / no request) reads as "Not claimed."
  const discountClaimed =
    discountReq?.status === "approved" ||
    discountReq?.status === "applied";

  return {
    studentName: student.name as string | null,
    lessonsDone,
    totalLessons,
    longestStreak: Number(streaks?.longest_streak ?? 0),
    notesCount: notesCount ?? 0,
    discountClaimed,
    actionShips,
    furthestRegionCompleted,
    currentRegion,
    currentRegionDone,
    currentRegionTotal,
    paceLabel: pace.progressLabel,
    paceDelta,
    cohortPercentile,
    cohortSize,
    baseUrl,
  };
}
