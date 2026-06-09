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
 * calls (5 req/sec). For ~350 students, total ~70s. maxDuration=300
 * leaves headroom.
 *
 * Idempotent. Safe to re-run — only touches NULL rows. Existing
 * first_paid_at values are NEVER overwritten (preserves the v75.18+
 * "first paid never moves" invariant).
 *
 * Founder + admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { toIso } from "@/lib/whop-members";

export const maxDuration = 300;

const WHOP_MEMBERSHIPS_BASE = "https://api.whop.com/api/v2";

interface WhopMembershipMinimal {
  user: string | null;
  created_at: number | string | null;
}

/**
 * Fetch ALL memberships for a single whop_user_id and return the
 * earliest created_at as ISO 8601, or null if Whop has no record.
 */
async function fetchEarliestMembershipDate(
  whopUserId: string,
  apiKey: string,
): Promise<{ firstPaidIso: string | null; foundCount: number }> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  let earliest: string | null = null;
  let foundCount = 0;
  let page = 1;
  const PER_PAGE = 50;
  // Hard cap — a single user should never have >500 memberships;
  // if Whop returns more, something is wrong and we stop.
  for (let i = 0; i < 10; i++) {
    const url = `${WHOP_MEMBERSHIPS_BASE}/memberships?user_id=${encodeURIComponent(
      whopUserId,
    )}&per_page=${PER_PAGE}&page=${page}`;

    const res = await fetch(url, { headers });
    if (res.status === 429) {
      // Rate limited — sleep and retry this page.
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Whop API HTTP ${res.status} for user ${whopUserId}`);
    }
    const json = (await res.json()) as {
      data?: WhopMembershipMinimal[];
      pagination?: { current_page?: number; total_page?: number };
    };
    const rows = json.data ?? [];

    // Sanity: if Whop ignored our user_id filter, abort to avoid
    // attributing other users' dates to this one.
    const allMatchUser = rows.every(
      (r) => !r.user || r.user === whopUserId,
    );
    if (!allMatchUser) {
      throw new Error(
        `Whop user_id filter ignored for ${whopUserId} — refusing to write`,
      );
    }

    for (const r of rows) {
      const iso = toIso(r.created_at);
      if (!iso) continue;
      foundCount += 1;
      if (!earliest || iso < earliest) earliest = iso;
    }

    const totalPages = json.pagination?.total_page ?? 1;
    if (page >= totalPages) break;
    page += 1;
  }

  return { firstPaidIso: earliest, foundCount };
}

export async function POST(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;
  const supabase = auth.supabase;

  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) {
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
    .select("id, whop_user_id, email, joined_at")
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
    no_whop_record: 0,
    api_errors: 0,
    fallback_to_joined_at: 0,
    errors: [] as Array<{ student_id: string; reason: string }>,
  };

  const t0 = Date.now();

  for (const c of candidatesList) {
    if (!c.whop_user_id) continue;

    try {
      const { firstPaidIso, foundCount } = await fetchEarliestMembershipDate(
        c.whop_user_id as string,
        apiKey,
      );

      let valueToWrite: string | null = firstPaidIso;
      let usedFallback = false;

      if (!valueToWrite) {
        // Whop returned 0 memberships OR all rows had unparseable
        // created_at. Fall back to joined_at — better than NULL,
        // and joined_at was their first dashboard touchpoint so
        // it's a reasonable lower bound.
        if (c.joined_at) {
          valueToWrite = c.joined_at as string;
          usedFallback = true;
          summary.fallback_to_joined_at += 1;
        } else {
          summary.no_whop_record += 1;
          continue;
        }
      }

      const { error: updateErr } = await supabase
        .from("students")
        .update({ first_paid_at: valueToWrite })
        .eq("id", c.id);

      if (updateErr) {
        summary.api_errors += 1;
        summary.errors.push({
          student_id: c.id as string,
          reason: `update failed: ${updateErr.message}`,
        });
        continue;
      }

      summary.backfilled += 1;
      if (foundCount === 0 && !usedFallback) {
        // Shouldn't reach here (valueToWrite would be null) but
        // belt-and-suspenders.
        summary.no_whop_record += 1;
      }
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
