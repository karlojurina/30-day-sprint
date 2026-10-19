/**
 * POST /api/admin/whop-catchup (T-089)
 *
 * Pulls every active member's finished Whop lessons into the app once, so a
 * member who watches on Whop and has not opened the app since the course
 * switch is not listed as "still hasn't started". The run is
 * src/lib/whop-catchup.ts; this file is its door.
 *
 * Body: {"mode": "snapshot" | "dry" | "write", "after": null | "<cursor>"}
 *   snapshot  no Whop request: the rows the write pass can change, for every
 *             member, saved to bulk_ops/ right before the write.
 *   dry       reads Whop and the app, writes nothing, answers counts.
 *   write     the same reads, then the rows, the sync rows and the streak
 *             rule; the answer carries its change log.
 * A call starts no member after 240 s and answers `this_call.next_after`;
 * call again with it as `after` until `this_call.remaining` is 0. A pass
 * run again adds nothing, so every pass is safe to repeat.
 *
 * Founder or admin session, or CRON_SECRET from a terminal, as
 * backfill-achievements (both sides trimmed). Refuses: 400 for another mode
 * or a cursor that does not read; 500 without WHOP_API_KEY or
 * WHOP_COURSE_ID; 409 before the course switch, while `lessons` holds the
 * old course. A run that stopped on a guard answers 500 with `ok: false`,
 * its `kind` and the counts so far; once its cause is fixed, that pass
 * starts again from the beginning (`next_after` resumes only after a time
 * budget or a 429, since a failed member counts as done for its pass).
 *
 * No answer names a member, an email, a Whop id or the course: failures are
 * counted by kind, because the Whop read's message carries the member's Whop
 * id and the course id.
 */

import { NextRequest, NextResponse } from "./stub-server.ts";
import { createServiceClient } from "./stub-server.ts";
import { requireTeam, isAuthFailure } from "./admin-auth.ts";
import { getCurriculumResetAt } from "./curriculum-reset.ts";
import {
  parseCatchupCursor,
  readCatchupMembers,
  runWhopCatchup,
  takeWhopCatchupSnapshot,
} from "./whop-catchup.ts";

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

  let body: { mode?: unknown; after?: unknown } = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object") body = parsed as typeof body;
  } catch {
    // No body, or one that is not JSON: the mode check below answers it.
  }
  const mode = body.mode;
  if (mode !== "snapshot" && mode !== "dry" && mode !== "write") {
    return NextResponse.json(
      { ok: false, error: 'mode must be "snapshot", "dry" or "write". Nothing ran.' },
      { status: 400 },
    );
  }
  const after = parseCatchupCursor(body.after);
  if (after === "invalid") {
    return NextResponse.json(
      { ok: false, error: 'after must be null or a this_call.next_after from an earlier answer, like "0:<student id>". Nothing ran.' },
      { status: 400 },
    );
  }

  const missing = ["WHOP_API_KEY", "WHOP_COURSE_ID"].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, error: `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set on this deployment. Nothing ran.` },
      { status: 500 },
    );
  }

  // Before the switch `lessons` holds the old course: a match there would
  // light old lessons, so nothing runs.
  let resetAt: string | null;
  try {
    resetAt = await getCurriculumResetAt(supabase);
  } catch (e) {
    console.error(`[whop-catchup] ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json(
      { ok: false, error: "The course switch's date could not be read. Nothing ran. Try again." },
      { status: 500 },
    );
  }
  if (!resetAt) {
    return NextResponse.json(
      { ok: false, error: "The course switch has not run, so lessons still holds the old course. Nothing ran." },
      { status: 409 },
    );
  }

  let members;
  try {
    members = await readCatchupMembers(supabase);
  } catch (e) {
    console.error(`[whop-catchup] ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json(
      { ok: false, error: "The members could not be read. Nothing ran. Try again." },
      { status: 500 },
    );
  }

  if (mode === "snapshot") {
    try {
      return NextResponse.json(await takeWhopCatchupSnapshot(supabase, members));
    } catch (e) {
      console.error(`[whop-catchup] snapshot: ${e instanceof Error ? e.message : String(e)}`);
      return NextResponse.json(
        { ok: false, error: "A read for the snapshot failed, so there is no snapshot. Nothing was written. Try again." },
        { status: 500 },
      );
    }
  }

  const answer = await runWhopCatchup(supabase, members, { mode, after, startedAtMs });
  return NextResponse.json(answer, { status: answer.ok === true ? 200 : 500 });
}
