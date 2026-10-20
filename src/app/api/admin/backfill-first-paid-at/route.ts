/**
 * POST /api/admin/backfill-first-paid-at
 *
 * One-time (re-runnable) backfill of students.first_paid_at for every
 * active or past_due member whose first_paid_at is NULL.
 *
 * Background: the membership/payment webhooks insert students with no
 * first_paid_at, and the sync only fills the empty ones on the paying
 * plan, 25 a run; a member who never logs in keeps an empty one. This
 * clears any such backlog in one pass.
 *
 * Strategy (the first-paid fix, 2026-10-20): for each NULL student, read
 * their first real Whop payment (src/lib/first-payment.ts: paid, above 0,
 * not fully refunded, any product) and write it to first_paid_at. Until
 * then this wrote the earliest membership created_at on any product,
 * which a free membership could hold.
 *
 * Rate limit: Whop caps at ~10 req/sec. We throttle to 200ms between
 * students (5 req/sec); the payments read also waits out a 429 (twice,
 * at most 30 s each), so a throttled run can take meaningfully longer
 * than the ~70s nominal for ~350 students and may approach
 * maxDuration=300. That's fine — it's idempotent, so if it dies mid-pass
 * just re-run; each run resumes from the remaining NULLs.
 *
 * Idempotent. Safe to re-run — only touches NULL rows. Existing
 * first_paid_at values are NEVER overwritten: only
 * /api/admin/first-paid-repair corrects a stored date. A member with no
 * real payment (a free member, a comp) stays NULL and is counted in
 * no_payment.
 *
 * Founder + admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { fetchFirstPaymentForUser } from "@/lib/first-payment";

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
    // v75.58: rows with no real payment stay NULL (no joined_at
    // fallback): a free member, a seat given away, a comp.
    no_payment: 0,
    api_errors: 0,
    // The reason is the read's failure kind, never Whop's message, which
    // can carry the member's Whop id.
    errors: [] as Array<{ student_id: string; reason: string }>,
  };

  const t0 = Date.now();

  for (const c of candidatesList) {
    if (!c.whop_user_id) continue;

    try {
      const { firstPaidIso, error: readError } = await fetchFirstPaymentForUser(
        c.whop_user_id as string,
      );
      if (readError) {
        summary.api_errors += 1;
        summary.errors.push({ student_id: c.id as string, reason: `payments read failed: ${readError}` });
        continue;
      }

      // v75.58: NO joined_at fallback. first_paid_at is the cohort
      // anchor AND the discount-window anchor, and the live writers only
      // fill it — writing a fabricated date (joined_at is a renewal/login
      // date, not a payment date) would mislabel the student and could
      // re-open a discount window. Leave NULL: the student stays
      // out-of-cohort (correct for missing data), keeps showing in the
      // NULL-first_paid_at diagnostics, and is retried on every re-run +
      // by the sync recovery pass — we PULL from Whop's API, so no
      // webhook is needed for the real date to eventually land.
      if (!firstPaidIso) {
        summary.no_payment += 1;
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
    } finally {
      // Throttle: 5 req/sec to stay well under Whop's 10 req/sec cap,
      // after every student, a `continue` included (a member with no
      // payment used to skip it).
      await new Promise((r) => setTimeout(r, 200));
    }
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
