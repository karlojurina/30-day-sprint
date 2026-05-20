import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { dmStudent, postTeamAlert } from "@/lib/discord";
import { buildDay28Embed, loadDay28EmbedInput } from "@/lib/day28-embed";
import { isDmEnabled } from "@/lib/dm-toggles";

/**
 * Day-28 student summary DM cron.
 *
 * Runs daily. Picks students whose `joined_at` is exactly 28 days ago
 * (1 day window, midnight-to-midnight UTC) AND whose `day28_dm_sent_at`
 * is null. For each, builds a personal stats payload and tries to DM
 * them via the Discord bot. Falls back to a public team-channel post
 * if the DM fails (no discord_user_id, DMs disabled, bot not mutual,
 * etc.).
 *
 * Tightened from a 28–30d window to exactly Day 28 per the CSM brief
 * (06-open-questions.md §3): firing later than Day 28 loses the punch
 * because the student is already at the Day 30 fork.
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

  // Pause gate — controlled from /admin/discord. Default off.
  if (!(await isDmEnabled(supabase, "day28_dm_enabled"))) {
    return NextResponse.json({ paused: true, checked: 0, sent: 0 });
  }

  const now = new Date();
  // Exactly Day 28 — window is the 24-hour band 28 to 29 days after join.
  // A student joined exactly 28d ago at this moment satisfies
  //   joined_at <= (now - 28d)  AND  joined_at > (now - 29d)
  const minJoined = new Date(now.getTime() - 29 * 86_400_000); // > 29d ago is OUT
  const maxJoined = new Date(now.getTime() - 28 * 86_400_000); // ≤ 28d ago is IN

  // v46 — day28_dm_sent_at lives on student_dm_log. Join via left-join
  // semantics: any student with no dm_log row is "not yet sent" (null).
  const { data: rawCandidates } = await supabase
    .from("students")
    .select("id, name, discord_user_id, student_dm_log(day28_dm_sent_at)")
    .eq("membership_status", "active")
    .eq("csm_exempt", false)
    .gt("joined_at", minJoined.toISOString())
    .lte("joined_at", maxJoined.toISOString());

  // Filter out anyone who already has day28_dm_sent_at set.
  type DmLogJoin = { day28_dm_sent_at: string | null };
  type Candidate = {
    id: string;
    name: string | null;
    discord_user_id: string | null;
    student_dm_log: DmLogJoin | DmLogJoin[] | null;
  };
  const candidates = ((rawCandidates ?? []) as Candidate[]).filter((s) => {
    const log = Array.isArray(s.student_dm_log)
      ? s.student_dm_log[0]
      : s.student_dm_log;
    return !log?.day28_dm_sent_at;
  });

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ checked: 0, sent: 0 });
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://30-day-sprint-smkv.vercel.app";

  let sent = 0;
  let fallback = 0;
  let failed = 0;

  for (const student of candidates) {
    // Shared loader: pulls everything the embed needs (completions,
    // cohort, action ships, best day, pace). One round trip per
    // student — at most ~5 students hit Day 28 per cron run.
    const input = await loadDay28EmbedInput(supabase, student.id, baseUrl);
    if ("error" in input) {
      failed++;
      continue;
    }
    const embed = buildDay28Embed(input);

    let delivered = false;
    if (student.discord_user_id) {
      const result = await dmStudent(student.discord_user_id, [embed]);
      if (result.ok) {
        delivered = true;
        sent++;
      } else {
        console.warn(
          `[day28-dm] DM failed for ${student.id}: ${result.reason}`,
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
    // discord_user_id; team can manually re-send if needed).
    // v46 — day28_dm_sent_at lives on student_dm_log.
    const stampIso = new Date().toISOString();
    await supabase
      .from("student_dm_log")
      .upsert(
        {
          student_id: student.id,
          day28_dm_sent_at: stampIso,
          updated_at: stampIso,
        },
        { onConflict: "student_id" },
      );
  }

  return NextResponse.json({
    checked: candidates.length,
    sent,
    fallback,
    failed,
  });
}
