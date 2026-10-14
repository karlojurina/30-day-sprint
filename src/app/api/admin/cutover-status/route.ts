/**
 * GET /api/admin/cutover-status — what the RUNNING build and the database
 * hold, for the course switch evening (cutover PRD, WI-10, C15).
 *
 * The build half is the only way to see a build-time value after a
 * redeploy: NEXT_PUBLIC_STUDENT_HOME and NEXT_PUBLIC_WORLD_LIVE are baked
 * into the bundle when it is built, and CATALOG_TABLE_SUFFIX, CATALOG_SHAPE
 * and WHOP_COURSE_ID are the values this deployment was given. None of them
 * is visible to a client page, and a Vercel setting changed without a
 * redeploy is not in any of them.
 *
 * The database half reads the LIVE tables (`regions`, `lessons`), which the
 * switch fills, and the reset key the switch writes.
 *
 * WHOP_COURSE_ID is never sent whole: whether it is set, and its last 4
 * characters when it is long enough for 4 to give nothing away.
 *
 * Auth: founder + admin only. UI: /admin/cutover.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { cutoverProblems, getCurriculumResetAt } from "@/lib/curriculum-reset";
import {
  CATALOG_IS_V2,
  CATALOG_TABLE_SUFFIX,
  LESSONS_TABLE,
} from "@/lib/catalog-tables";
import { STUDENT_HOME, WORLD_IS_LIVE } from "@/lib/world/access";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;
  const { supabase } = auth;

  // A read that fails answers 500 with the reason. A status page that
  // guessed a number here would say "All good" about something it never saw.
  let resetAt: string | null;
  try {
    resetAt = await getCurriculumResetAt(supabase);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const [regionsRes, allRes, countingRes, whopRes] = await Promise.all([
    supabase.from("regions").select("id").order("order_num"),
    supabase.from("lessons").select("id", { count: "exact", head: true }),
    supabase
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .eq("counts_toward_progress", true),
    supabase
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .not("whop_lesson_id", "is", null),
  ]);
  if (regionsRes.error) {
    return NextResponse.json(
      { error: `regions could not be read: ${regionsRes.error.message}` },
      { status: 500 },
    );
  }
  const counts = { all: allRes, counting: countingRes, whop: whopRes };
  for (const [name, res] of Object.entries(counts)) {
    if (res.error || typeof res.count !== "number") {
      return NextResponse.json(
        {
          error: `lessons (${name}) could not be counted${res.error ? `: ${res.error.message}` : ""}`,
        },
        { status: 500 },
      );
    }
  }

  const rawCourseId = (process.env.WHOP_COURSE_ID ?? "").trim();
  const whopCourseIdSet = rawCourseId.length > 0;
  const regionIds = (regionsRes.data ?? []).map((r) => r.id as string);
  const db = {
    resetAt,
    regionIds,
    lessons: allRes.count as number,
    countingLessons: countingRes.count as number,
    lessonsWithWhopId: whopRes.count as number,
  };
  const build = {
    studentHome: STUDENT_HOME,
    worldLive: WORLD_IS_LIVE,
    catalogIsV2: CATALOG_IS_V2,
    catalogTable: LESSONS_TABLE,
    tableSuffix: CATALOG_TABLE_SUFFIX,
    whopCourseIdSet,
    whopCourseIdTail: rawCourseId.length > 8 ? rawCourseId.slice(-4) : null,
    // Which deployment answered, so a look taken before the redeploy is
    // Ready can be told apart from one taken after it. Vercel's own
    // system values; null where they are not exposed (a local run).
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  };
  const problems = cutoverProblems({
    resetAt,
    catalogTable: LESSONS_TABLE,
    catalogIsV2: CATALOG_IS_V2,
    studentHome: STUDENT_HOME,
    worldLive: WORLD_IS_LIVE,
    whopCourseIdSet,
    regionIds: db.regionIds,
    lessons: db.lessons,
    countingLessons: db.countingLessons,
    lessonsWithWhopId: db.lessonsWithWhopId,
  });

  return NextResponse.json(
    {
      ok: problems.length === 0,
      phase: resetAt == null ? "before" : "after",
      problems,
      build,
      db,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
