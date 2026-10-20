/**
 * POST /api/admin/first-paid-repair (the first-paid fix, 2026-10-20)
 *
 * Sets every student's first_paid_at to their first real Whop payment, once.
 * The live writers (the login, the sync, the backfill) only fill an empty
 * value, so a wrong date stored before the fix, a free membership's, is
 * corrected here and nowhere else. The run is src/lib/first-paid-repair.ts;
 * this file is its door.
 *
 * Body: {"mode": "dry" | "snapshot" | "write"}
 *   dry       walks Whop's paid payments, reads the students, writes nothing,
 *             answers counts.
 *   snapshot  the same reads, and [student id, first_paid_at] for every row
 *             the write would change, saved to bulk_ops/ right before it.
 *   write     the same reads, then each change with its guard; the answer
 *             carries its change log [student id, old, new].
 * One call does the whole pass. No page of the walk starts after 240 s, and a
 * walk that did not finish answers 500, ok: false, kind walk_incomplete, with
 * nothing written. No write starts after 280 s; one left over answers kind
 * write_incomplete, and the next write call finishes it.
 *
 * Founder or admin session, or CRON_SECRET from a terminal, as the Whop
 * catch-up (both sides trimmed). Refuses: 400 for another mode, 500 without
 * WHOP_API_KEY. No answer names a student, an email or a Whop id: student ids
 * only.
 */

import { NextRequest, NextResponse } from "./stub-server.ts";
import { createServiceClient } from "./stub-server.ts";
import { requireTeam, isAuthFailure } from "./admin-auth.ts";
import { runFirstPaidRepair } from "./first-paid-repair.ts";

export const maxDuration = 300;

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

  let body: { mode?: unknown } = {};
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

  if (!process.env.WHOP_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "WHOP_API_KEY is not set on this deployment. Nothing ran." },
      { status: 500 },
    );
  }

  const answer = await runFirstPaidRepair(supabase, { mode, startedAtMs });
  return NextResponse.json(answer, { status: answer.ok === true ? 200 : 500 });
}
