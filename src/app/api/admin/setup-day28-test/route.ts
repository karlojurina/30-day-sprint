import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * Temporary test helper — preps one student to be picked up by the
 * day-28 DM cron on its next run. Sets joined_at to 29 days ago,
 * discord_user_id to the provided Discord snowflake, and clears
 * day28_dm_sent_at so the cron treats it as fresh.
 *
 * Saves the original values in a header on the response so we can
 * restore them after the test. Delete this route once verified.
 *
 * Usage:
 *   curl -X POST "https://YOUR-DOMAIN/api/admin/setup-day28-test?discord_id=260329753721044992&student_id=UUID" \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * If student_id is omitted, picks the first active student.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const discordId = url.searchParams.get("discord_id");
  const studentId = url.searchParams.get("student_id");

  if (!discordId) {
    return NextResponse.json(
      { error: "Pass ?discord_id=YOUR_DISCORD_SNOWFLAKE" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // Find target student
  let target;
  if (studentId) {
    const { data } = await supabase
      .from("students")
      .select("id, name, email, joined_at, discord_user_id, day28_dm_sent_at")
      .eq("id", studentId)
      .single();
    target = data;
  } else {
    const { data } = await supabase
      .from("students")
      .select("id, name, email, joined_at, discord_user_id, day28_dm_sent_at")
      .eq("membership_status", "active")
      .limit(1)
      .single();
    target = data;
  }

  if (!target) {
    return NextResponse.json({ error: "No student found" }, { status: 404 });
  }

  const newJoinedAt = new Date(
    Date.now() - 29 * 86_400_000
  ).toISOString();

  const { error } = await supabase
    .from("students")
    .update({
      joined_at: newJoinedAt,
      discord_user_id: discordId,
      day28_dm_sent_at: null,
    })
    .eq("id", target.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    prepared: {
      id: target.id,
      name: target.name,
      email: target.email,
      joined_at: newJoinedAt,
      discord_user_id: discordId,
    },
    original: {
      joined_at: target.joined_at,
      discord_user_id: target.discord_user_id,
      day28_dm_sent_at: target.day28_dm_sent_at,
    },
    next_step: "Now call GET /api/cron/day28-dm to trigger the DM",
  });
}

/**
 * Restore the original values for a student after testing.
 *
 * Usage:
 *   curl -X DELETE "https://YOUR-DOMAIN/api/admin/setup-day28-test?student_id=UUID&joined_at=ISO&discord_user_id=ORIGINAL_OR_null&day28_dm_sent_at=ISO_OR_null" \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const studentId = url.searchParams.get("student_id");
  const joinedAt = url.searchParams.get("joined_at");
  const discordUserId = url.searchParams.get("discord_user_id");
  const day28DmSentAt = url.searchParams.get("day28_dm_sent_at");

  if (!studentId || !joinedAt) {
    return NextResponse.json(
      { error: "Pass ?student_id=UUID&joined_at=ISO" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("students")
    .update({
      joined_at: joinedAt,
      discord_user_id: discordUserId === "null" ? null : discordUserId,
      day28_dm_sent_at: day28DmSentAt === "null" ? null : day28DmSentAt,
    })
    .eq("id", studentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ restored: studentId });
}
