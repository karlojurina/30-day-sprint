import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-server";

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
 *   - adValueOnboardedRate    placeholder until Zak's data source lands (null)
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

  // Pull all paying students once, do the math in memory. Cohort
  // sizes are small enough that this is cheap. Filter mirrors the
  // admin pages: only students with a real Whop membership and a
  // tracked status (drop 'expired' and null statuses).
  const { data: students } = await supabase
    .from("students")
    .select("membership_status, joined_at, updated_at")
    .not("whop_membership_id", "is", null)
    .in("membership_status", ["active", "past_due", "canceled"]);

  const all = students ?? [];
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 86_400_000;

  const activeStudents = all.filter(
    (s) => s.membership_status === "active"
  ).length;

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

  return NextResponse.json({
    activeStudents,
    churnedThisCohort,
    monthTwoConversionRate,
    monthTwoConversionDenom,
    adValueOnboardedRate: null, // pending Zak's data source
  });
}
