/**
 * POST /api/admin/first-paid-repair (the first-paid fix, 2026-10-20)
 *
 * Sets every student's first_paid_at to their first real Whop payment, once.
 * The live writers (the login, the sync, the backfill) only fill an empty
 * value, so a wrong date stored before the fix, a free membership's, is
 * corrected here and nowhere else. The run is src/lib/first-paid-repair.ts;
 * this file is its door.
 *
 * Body: {"mode": "dry" | "snapshot" | "write", "lanes": 1 | 4}
 *   dry       walks Whop's paid payments, reads the students, writes nothing,
 *             answers counts, and the students behind the counts that open
 *             the 30% (thirty_students, by student id).
 *   snapshot  the same reads, and [student id, first_paid_at,
 *             new_first_paid_at] for every row the write would change, saved
 *             to bulk_ops/ right before it.
 *   write     the same reads, then each change with its guard; the answer
 *             carries its change log [student id, old, new].
 *   lanes     1 when left out: the walk is one chain of pages. 4: the
 *             account's history in 4 stretches by created_at, read side by
 *             side inside the same 4 requests a second, for when one chain
 *             does not finish in time. A lane given a payment outside its
 *             stretch stops the walk (filter_ignored).
 * One call does the whole pass. No page of the walk starts after 240 s, and a
 * walk that did not finish answers 500, ok: false, kind walk_incomplete, with
 * nothing written, its pages and Whop's time per page (walk.ms_per_page). No
 * write starts after 280 s; one left over answers kind write_incomplete, and
 * the next write call finishes it.
 *
 * After a deploy the dry run comes first. It passes when walk.payments.kept
 * is above 0, skipped.no_user and skipped.bad_total are about 0 (Whop's
 * payments came back in the shape this code reads) and
 * walk.payments.oldest_kept_paid_at is about February 2025, the account's
 * first month of sales (the list was read to its end).
 *
 * Founder or admin session, or CRON_SECRET from a terminal, as the Whop
 * catch-up (both sides trimmed). Refuses: 400 for another mode or another
 * number of lanes, 500 without WHOP_API_KEY. No answer names a student, an
 * email or a Whop id: student ids only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { runFirstPaidRepair } from "@/lib/first-paid-repair";

export const maxDuration = 300;
// Pinned to iad1, next to Whop, by this file's entry under `functions` in
// vercel.json, while the project's functions run in dub1 next to the
// database: the walk is a chain of Whop pages, each waiting for the one
// before, against a few database reads, and a walk that has not ended by
// 240 s writes nothing; a write's updates go 8 at a time, and the next call
// finishes any left over. Vercel takes a Node route's region only from
// vercel.json, and a moved file loses the pin. The counts: CONTEXT.md,
// "Where the functions run".

export async function POST(request: NextRequest) {
  const startedAtMs = Date.now();

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

  let body: { mode?: unknown; lanes?: unknown } = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object") body = parsed as typeof body;
  } catch {
    // No body, or one that is not JSON: the mode check below answers it.
  }
  const mode = body.mode;
  if (mode !== "dry" && mode !== "snapshot" && mode !== "write") {
    return NextResponse.json(
      { ok: false, error: 'mode must be "dry", "snapshot" or "write". Nothing ran.' },
      { status: 400 },
    );
  }

  const lanes = body.lanes ?? 1;
  if (lanes !== 1 && lanes !== 4) {
    return NextResponse.json(
      { ok: false, error: "lanes must be 1 or 4 (left out, it is 1). Nothing ran." },
      { status: 400 },
    );
  }

  if (!process.env.WHOP_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "WHOP_API_KEY is not set on this deployment. Nothing ran." },
      { status: 500 },
    );
  }

  const answer = await runFirstPaidRepair(supabase, { mode, startedAtMs, lanes });
  return NextResponse.json(answer, { status: answer.ok === true ? 200 : 500 });
}
