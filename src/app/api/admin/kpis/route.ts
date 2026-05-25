import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-server";
import { ADMIN_STUDENT_JOIN_CUTOFF } from "@/lib/constants";

/**
 * Team-only KPI rollups for the /admin home dashboard.
 *
 * Returns:
 *   - activeStudents          number of students with membership_status='active'
 *   - churnedThisCohort       canceled within the last 30 days
 *   - monthTwoConversionRate  fraction of cohort >30d ago who are still active
 *                             (null if denominator is 0)
 *   - monthTwoConversionDenom raw count >30d ago (so the UI can hide the rate
 *                             when the cohort is too small to be meaningful)
 *   - bountyAccessCount       students with bounty_access_claimed_at set
 *                             (replaces the old adValueOnboardedRate placeholder
 *                             since Zak's webhook is live)
 *   - bountyAccessRate        bountyAccessCount / activeStudents
 *   - firstClientCount        students who have self-reported first_client_landed_at
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7);

  // Verify the requester is a team member
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
  );
  const {
    data: { user },
  } = await userClient.auth.getUser(token);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: teamMember } = await supabase
    .from("team_members")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (!teamMember) {
    return NextResponse.json({ error: "Team only" }, { status: 403 });
  }

  // Pull all paying students + their milestone rows in parallel. Cohort
  // sizes are small enough that this is cheap. Filter mirrors the
  // admin pages: only students with a real Whop membership and a
  // tracked status (drop 'expired' and null statuses).
  const [studentsRes, milestonesRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, membership_status, joined_at, updated_at")
      .not("whop_membership_id", "is", null)
      .in("membership_status", ["active", "past_due", "canceled"])
      .gte("joined_at", ADMIN_STUDENT_JOIN_CUTOFF),
    supabase
      .from("student_milestones")
      .select("student_id, bounty_access_claimed_at, first_client_landed_at"),
  ]);

  const all = studentsRes.data ?? [];
  const milestones = milestonesRes.data ?? [];
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 86_400_000;

  const activeIds = new Set(
    all.filter((s) => s.membership_status === "active").map((s) => s.id as string),
  );
  const activeStudents = activeIds.size;

  const churnedThisCohort = all.filter(
    (s) =>
      s.membership_status === "canceled" &&
      new Date(s.updated_at).getTime() >= thirtyDaysAgo
  ).length;

  const cohortPastMonth = all.filter(
    (s) => new Date(s.joined_at).getTime() <= thirtyDaysAgo
  );
  const monthTwoConversionDenom = cohortPastMonth.length;
  const monthTwoActive = cohortPastMonth.filter(
    (s) => s.membership_status === "active"
  ).length;
  const monthTwoConversionRate =
    monthTwoConversionDenom > 0
      ? monthTwoActive / monthTwoConversionDenom
      : null;

  // Bounty Access rollups - sourced from Zak's webhook (live since v50).
  // Only count students who are still in the active pool so we don't
  // pollute the rate with churned bounty members.
  const bountyAccessCount = milestones.filter(
    (m) => m.bounty_access_claimed_at && activeIds.has(m.student_id as string),
  ).length;
  const firstClientCount = milestones.filter(
    (m) => m.first_client_landed_at && activeIds.has(m.student_id as string),
  ).length;
  const bountyAccessRate =
    activeStudents > 0 ? bountyAccessCount / activeStudents : null;

  return NextResponse.json({
    activeStudents,
    churnedThisCohort,
    monthTwoConversionRate,
    monthTwoConversionDenom,
    bountyAccessCount,
    bountyAccessRate,
    firstClientCount,
  });
}
