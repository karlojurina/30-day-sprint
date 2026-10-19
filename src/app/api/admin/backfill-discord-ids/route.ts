import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { fetchWhopDiscordId } from "@/lib/whop";

/**
 * One-shot backfill — populates students.discord_user_id from Whop's
 * /api/v2/members/{id} endpoint for any active student that has a
 * whop_user_id but no discord_user_id yet.
 *
 * Idempotent. Safe to re-run. Skips students who already have an ID.
 *
 * Auth: Bearer CRON_SECRET (same as the cron routes).
 *
 * Usage:
 *   curl "https://YOUR-DOMAIN/api/admin/backfill-discord-ids" \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
// Runs in iad1, next to Whop, while the project's functions run in dub1 next
// to the database (vercel.json): each student costs one Whop call and at most
// one database write. The counts: CONTEXT.md, "Where the functions run".
export const preferredRegion = "iad1";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: students, error } = await supabase
    .from("students")
    .select("id, whop_user_id, discord_username")
    .eq("membership_status", "active")
    .is("discord_user_id", null)
    .not("whop_user_id", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!students || students.length === 0) {
    return NextResponse.json({ checked: 0, filled: 0, skipped: 0 });
  }

  let filled = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const student of students) {
    const discordId = await fetchWhopDiscordId(student.whop_user_id);
    if (!discordId) {
      skipped++;
      continue;
    }
    const { error: updateErr } = await supabase
      .from("students")
      .update({ discord_user_id: discordId })
      .eq("id", student.id);
    if (updateErr) {
      failures.push(`${student.id}: ${updateErr.message}`);
    } else {
      filled++;
    }
  }

  return NextResponse.json({
    checked: students.length,
    filled,
    skipped,
    failures: failures.length > 0 ? failures : undefined,
  });
}
