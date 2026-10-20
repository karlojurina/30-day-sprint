/**
 * POST /api/admin/backfill-first-paid-at
 *
 * One-time (re-runnable) backfill of students.first_paid_at for every
 * active or past_due member whose first_paid_at is NULL.
 *
 * Background: the membership/payment webhooks insert students with no
 * first_paid_at, and the sync only fills the empty ones on the paying
 * plan, 25 a run; a member who never logs in keeps an empty one. This
 * clears any such backlog.
 *
 * Strategy (the first-paid fix, 2026-10-20): for each NULL student, read
 * their first real Whop payment (src/lib/first-payment.ts: paid, above 0,
 * not fully refunded, any product) and write it to first_paid_at. Until
 * then this wrote the earliest membership created_at on any product,
 * which a free membership could hold.
 *
 * Body (optional): {"after": null | "<student id>"}. The students go in id
 * order. A call starts no student after 240 s and waits on no Whop read
 * past 280 s, then answers `checked`, `remaining` and `next_after`; call
 * again with {"after": <next_after>} until `remaining` is 0. So a long
 * backlog ends in answers instead of being cut off by Vercel at 300 s. A
 * member with no real payment (a free member, a comp) stays NULL and stays a
 * candidate, so a pass started over from the beginning reads them all
 * again: follow `next_after` to the end of a pass instead.
 *
 * Rate limit: Whop caps at ~10 req/sec. We throttle to 200ms between
 * students (5 req/sec); the payments read also waits out a 429 (twice,
 * at most 30 s each), inside the 280 s limit.
 *
 * Idempotent. Safe to re-run — only touches NULL rows. Existing
 * first_paid_at values are NEVER overwritten: only
 * /api/admin/first-paid-repair corrects a stored date. A member with no
 * real payment is counted in no_payment.
 *
 * Founder + admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { fetchFirstPaymentForUser } from "@/lib/first-payment";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";

export const maxDuration = 300;
// Pinned to iad1, next to Whop, by this file's entry under `functions` in
// vercel.json, while the project's functions run in dub1 next to the
// database: each student costs at least one Whop call and at most one
// database write. Vercel takes a Node route's region only from vercel.json,
// and a moved file loses the pin. The counts: CONTEXT.md, "Where the
// functions run".

/** No student is started after this, so a call answers before maxDuration (300 s). */
const BACKFILL_START_LIMIT_MS = 240_000;
/** No Whop read is waited on past this, its 429 waits included. */
const BACKFILL_READ_LIMIT_MS = 280_000;
/** A student id as the database writes it: a `next_after` from an earlier answer. */
const STUDENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function POST(request: NextRequest) {
  const t0 = Date.now();

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

  let body: { after?: unknown } = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object") body = parsed as typeof body;
  } catch {
    // No body, or one that is not JSON: from the first student.
  }
  const rawAfter = body.after ?? null;
  const after = typeof rawAfter === "string" ? rawAfter.trim().toLowerCase() : rawAfter;
  if (after !== null && (typeof after !== "string" || !STUDENT_ID.test(after))) {
    return NextResponse.json(
      { ok: false, error: "after must be null or the next_after of an earlier answer. Nothing ran." },
      { status: 400 },
    );
  }

  if (!process.env.WHOP_API_KEY) {
    return NextResponse.json(
      { error: "WHOP_API_KEY not set" },
      { status: 500 },
    );
  }

  // Fetch the candidate set, every page, in id order. We backfill any
  // paying member missing first_paid_at — both currently-active and
  // past_due. Canceled members are skipped (their first_paid_at history
  // only matters for re-enrollment, and they'd get backfilled on re-OAuth).
  const { data: candidatesList, error: candErr } = await fetchAllRowsPaginated<{
    id: string;
    whop_user_id: string | null;
  }>(() =>
    supabase
      .from("students")
      .select("id, whop_user_id")
      .is("first_paid_at", null)
      .in("membership_status", ["active", "past_due"])
      .not("whop_user_id", "is", null)
      .order("id", { ascending: true }),
  );

  if (candErr) {
    return NextResponse.json({ error: candErr.message }, { status: 500 });
  }

  const summary = {
    total_candidates: candidatesList.length,
    // Students this call read.
    checked: 0,
    backfilled: 0,
    // v75.58: rows with no real payment stay NULL (no joined_at
    // fallback): a free member, a seat given away, a comp.
    no_payment: 0,
    api_errors: 0,
    // The reason is the read's failure kind, never Whop's message, which
    // can carry the member's Whop id.
    errors: [] as Array<{ student_id: string; reason: string }>,
  };

  // The last student this pass has finished: where the next call starts.
  let nextAfter: string | null = after;
  for (const c of candidatesList) {
    if (after !== null && c.id <= after) continue;
    if (Date.now() - t0 > BACKFILL_START_LIMIT_MS) break;
    if (!c.whop_user_id) continue;

    let outOfTime = false;
    try {
      const { firstPaidIso, error: readError } = await fetchFirstPaymentForUser(
        c.whop_user_id,
        { deadlineAtMs: t0 + BACKFILL_READ_LIMIT_MS },
      );
      if (readError === "time_budget") {
        // Whop had not answered by 280 s: this student is the next call's first.
        outOfTime = true;
        break;
      }
      if (readError) {
        summary.api_errors += 1;
        summary.errors.push({ student_id: c.id, reason: `payments read failed: ${readError}` });
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
          student_id: c.id,
          reason: `update failed: ${updateErr.message}`,
        });
        continue;
      }

      summary.backfilled += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.api_errors += 1;
      summary.errors.push({ student_id: c.id, reason: msg });
    } finally {
      if (!outOfTime) {
        summary.checked += 1;
        nextAfter = c.id;
        // Throttle: 5 req/sec to stay well under Whop's 10 req/sec cap,
        // after every student, a `continue` included (a member with no
        // payment used to skip it).
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  const remaining = candidatesList.filter((c) => nextAfter === null || c.id > nextAfter).length;
  const durationMs = Date.now() - t0;

  // Truncate errors so the response stays a sane size; full list is
  // in Vercel logs.
  if (summary.errors.length > 20) {
    summary.errors = summary.errors.slice(0, 20);
  }

  return NextResponse.json({
    ok: true,
    ...summary,
    // Candidates after next_after, not read yet: call again with
    // {"after": next_after} until this is 0.
    remaining,
    next_after: remaining > 0 ? nextAfter : null,
    duration_ms: durationMs,
  });
}
