/**
 * POST /api/admin/backfill-first-paid-at
 *
 * One-time (re-runnable) backfill of students.first_paid_at for every
 * paying member whose first_paid_at is NULL.
 *
 * Background: the v75.10 self-heal OAuth path + the membership/payment
 * webhooks insert students with whop_plan_id but the sync runner only
 * computes first_paid_at for users whose memberships are in products
 * listed in WHOP_PRODUCT_ID. Students on products NOT in that env var
 * never get first_paid_at populated (350 such students as of 2026-06-09).
 *
 * Strategy: for each NULL student, hit Whop's v2 API at
 * /api/v2/memberships?user_id=USER_ID to fetch ALL their memberships
 * (regardless of product), compute min(created_at) across the set, and
 * write that to first_paid_at. This is the TRUE original signup date
 * — stable across renewals, correct for returning customers, and
 * sufficient for cohort filtering + discount eligibility.
 *
 * Rate limit: Whop caps at ~10 req/sec. We throttle to 200ms between
 * calls (5 req/sec); the shared fetchEarliestMembershipDateForUser also
 * retries on 429 via whopFetchWithRetry, so a throttled run can take
 * meaningfully longer than the ~70s nominal for ~350 students and may
 * approach maxDuration=300. That's fine — it's idempotent, so if it
 * dies mid-pass just re-run; each run resumes from the remaining NULLs.
 *
 * Idempotent. Safe to re-run — only touches NULL rows. Existing
 * first_paid_at values are NEVER overwritten (preserves the v75.18+
 * "first paid never moves" invariant).
 *
 * Founder + admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { fetchEarliestMembershipDateForUser } from "@/lib/whop-members";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  // v75.34: dual auth — accept CRON_SECRET for service-level one-time
  // backfill (so the founder can trigger it from terminal without
  // extracting a Supabase JWT), OR a team-member session for in-app
  // triggering. CRON_SECRET path stays restricted to this route only
  // and is intended for one-time operations.
  //
  // v75.54: whitespace-trim BOTH sides, mirroring verifyCronAuth
  // (cron-auth.ts). Was a raw `=== \`Bearer ${cronSecret}\`` compare —
  // the exact untrimmed-inline check v75.37 warned against. A trailing
  // newline on the Vercel env var (the CRON_SECRET-drift incident) or
  // on the pasted curl header made this fall through to team auth and
  // return "Invalid token" even with the correct secret, while the
  // crons (which trim) authenticated fine.
  const authHeader = (request.headers.get("authorization") ?? "").trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  let supabase;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    supabase = createServiceClient();
  } else {
    const auth = await requireTeam(request, ["founder", "admin"]);
    if (isAuthFailure(auth)) return auth.error;
    supabase = auth.supabase;
  }

  if (!process.env.WHOP_API_KEY) {
    return NextResponse.json(
      { error: "WHOP_API_KEY not set" },
      { status: 500 },
    );
  }

  // Fetch the candidate set. We backfill any paying member missing
  // first_paid_at — both currently-active and past_due. Canceled
  // members are skipped (their first_paid_at history only matters
  // for re-enrollment, and they'd get backfilled on re-OAuth).
  const { data: candidates, error: candErr } = await supabase
    .from("students")
    .select("id, whop_user_id, email")
    .is("first_paid_at", null)
    .in("membership_status", ["active", "past_due"])
    .not("whop_user_id", "is", null);

  if (candErr) {
    return NextResponse.json({ error: candErr.message }, { status: 500 });
  }

  const candidatesList = candidates ?? [];
  const summary = {
    total_candidates: candidatesList.length,
    backfilled: 0,
    // v75.58: rows Whop has no record for stay NULL (no joined_at
    // fallback) — they show up here and need manual review.
    no_whop_record: 0,
    api_errors: 0,
    errors: [] as Array<{ student_id: string; reason: string }>,
  };

  const t0 = Date.now();

  for (const c of candidatesList) {
    if (!c.whop_user_id) continue;

    try {
      const { firstPaidIso } = await fetchEarliestMembershipDateForUser(
        c.whop_user_id as string,
      );

      // v75.58: NO joined_at fallback. first_paid_at is the cohort
      // anchor AND the discount-window anchor, and it never moves once
      // set — writing a fabricated date (joined_at is a renewal/login
      // date, not a payment date) would permanently mislabel the
      // student and could re-open a discount window. Leave NULL: the
      // student stays out-of-cohort (correct for missing data), keeps
      // showing in the NULL-first_paid_at diagnostics, and is retried
      // on every re-run + by the nightly sync recovery pass — we PULL
      // from Whop's API, so no webhook is needed for the real date to
      // eventually land.
      if (!firstPaidIso) {
        summary.no_whop_record += 1;
        continue;
      }

      // .is("first_paid_at", null) — fill-only-if-still-NULL, so a
      // racing writer (sync recovery / webhook) can never be
      // overwritten. Mirrors the sync recovery pass guard.
      const { error: updateErr } = await supabase
        .from("students")
        .update({ first_paid_at: firstPaidIso })
        .eq("id", c.id)
        .is("first_paid_at", null);

      if (updateErr) {
        summary.api_errors += 1;
        summary.errors.push({
          student_id: c.id as string,
          reason: `update failed: ${updateErr.message}`,
        });
        continue;
      }

      summary.backfilled += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.api_errors += 1;
      summary.errors.push({ student_id: c.id as string, reason: msg });
    }

    // Throttle: 5 req/sec to stay well under Whop's 10 req/sec cap.
    await new Promise((r) => setTimeout(r, 200));
  }

  const durationMs = Date.now() - t0;

  // Truncate errors so the response stays a sane size; full list is
  // in Vercel logs.
  if (summary.errors.length > 20) {
    summary.errors = summary.errors.slice(0, 20);
  }

  return NextResponse.json({
    ok: true,
    ...summary,
    duration_ms: durationMs,
  });
}
