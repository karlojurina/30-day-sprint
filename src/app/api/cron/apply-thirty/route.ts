/**
 * GET /api/cron/apply-thirty (the 30% that applies itself, T-137)
 *
 * Every 10 minutes (vercel.json, at minutes 3, 13, 23, 33, 43 and 53, which
 * no other cron uses): finishes what the student's own Apply could not. The
 * step is the one the request routes and the team's Approve run
 * (putThirtyOn, src/lib/thirty-apply.ts), with the job as its actor and one
 * correlation id for the run.
 *
 * WHO IS TAKEN. Requests made from 1 October (DISCOUNT_ELIGIBLE_FROM) and at
 * least 2 minutes ago (the student's own request has had its 26 seconds),
 * oldest first, up to 200: every pending request made in the last 48 hours,
 * every pending request holding a code name whatever its age (a claim that
 * may have lost its answer, or a request reopened by hand), every approved
 * request whatever its age. A request whose last failure (an attempt_failed
 * event) is under 9 minutes old, or under 55 minutes once it failed 3 times
 * or more, waits for a later run, and so does one whose last failure is a
 * code on someone else's membership (landed_elsewhere: nothing the job does
 * changes it). The first 25 left are worked on, none started after 240 s,
 * each inside 20 seconds (270 s from the run's start at most).
 *
 * WHAT IS DONE. A new code is made only for a request from the last 48 hours,
 * and only after Approve's own checks pass (thirtyApprovalChecks: the coupon
 * check, the paid plan and the payment, the 30% rule): run first for a
 * request with no code yet (a refusal is recorded as attempt_failed
 * check_refused with its sentence), and for a lost claim only once its code
 * is known not to exist on Whop. Claims are settled and made codes attached
 * whatever their age. Everything the app leaves to the team (a trial, a
 * request reopened by hand whose code is on nobody's membership, a code with
 * no Whop id or with the old per-student name, a second 30%) is left, its
 * reason recorded.
 *
 * ?mode=dry reads only: nothing is claimed, made, attached, stored or
 * recorded (the coupon check's answer is not stored either), and `planned`
 * says what a real run would do for each request: [{ requestId, status,
 * would, reason }].
 *
 * THE ANSWER names request ids only: { ok, paused, mode, examined (requests
 * read), applied, waiting (requests that ended pending or approved), skipped
 * (passed over by the wait or the landed_elsewhere rule), gaveUp (requests
 * with no code whose 48 hours ended in the 10 minutes before the run: they
 * wait for the team now), byReason (each failure's reason, counted), planned,
 * failed (requests whose step threw: a database read or write that failed,
 * which makes the run a failure) }.
 *
 * Auth: CRON_SECRET as a bearer, like every cron (src/lib/cron-auth.ts), with
 * a cron_runs row whose rows_affected is the number applied. THIRTY_AUTO_APPLY
 * set to off, false, 0 or no pauses it: { ok: true, paused: true }, nothing
 * read. A failed run, nothing asked of Whop: a mode other than dry or write
 * (400), v116 not pasted ("v116 is not pasted"), no WHOP_API_KEY on the
 * deployment, a read of the requests or their events that failed (500).
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase-server";
import { verifyCronAuth, cronUnauthorizedResponse, logCronStart, logCronFinish } from "@/lib/cron-auth";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import { DISCOUNT_ELIGIBLE_FROM } from "@/lib/world/discount";
import { JOB_NEW_CODE_WINDOW_MS } from "@/lib/thirty-words";
import { putThirtyOn, requestShape, thirtyApprovalChecks, thirtyAutoApplyPaused, type ThirtyResult } from "@/lib/thirty-apply";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const ROUTE_NAME = "apply-thirty";
/** A request younger than this is still the student's own request's to finish. */
const MIN_AGE_MS = 2 * 60_000;
const CANDIDATES_MAX = 200;
const TAKE_MAX = 25;
/** No request is started after this, and none runs past RUN_MS from the run's start. */
const START_BY_MS = 240_000;
const RUN_MS = 270_000;
const ITEM_MS = 20_000;
/** The wait after a failure: 1 or 2 failures, then 3 or more. */
const SHORT_WAIT_MS = 9 * 60_000;
const LONG_WAIT_MS = 55 * 60_000;
const LONG_WAIT_AFTER = 3;
/** gaveUp: requests whose 48 hours ended in this long before the run. */
const GAVE_UP_MS = 10 * 60_000;
/** Request ids per events read (the admin pages read 100 at a time). */
const ID_BATCH = 100;
const COLUMNS = "id, student_id, status, promo_code, promo_claimed_at, whop_promo_id, created_at";
const JOB = { kind: "job" } as const;

type Candidate = {
  id: string;
  student_id: string;
  status: string;
  promo_code: string | null;
  promo_claimed_at: string | null;
  whop_promo_id: string | null;
  created_at: string;
};
type Planned = { requestId: string; status: string | null; would: string | null; reason: string | null };

/** Oldest first; the id breaks a tie, so every read gives one order. */
const byAge = (a: Candidate, b: Candidate) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function GET(request: NextRequest) {
  const startedAtMs = Date.now();
  const auth = verifyCronAuth(request);
  if (!auth.ok) {
    await logCronStart(ROUTE_NAME, auth.reason);
    return cronUnauthorizedResponse(auth.reason);
  }
  const runId = await logCronStart(ROUTE_NAME, "ok");

  const asked = new URL(request.url).searchParams.get("mode");
  if (asked !== null && asked !== "dry" && asked !== "write") {
    await logCronFinish(runId, "failed", { error: "bad mode" });
    return NextResponse.json({ ok: false, error: 'mode must be "dry" or "write" (left out, it is "write"). Nothing ran.' }, { status: 400 });
  }
  const mode = asked === "dry" ? "dry" : "write";
  const dry = mode === "dry";

  if (thirtyAutoApplyPaused()) {
    await logCronFinish(runId, "success", { rowsAffected: 0 });
    return NextResponse.json({ ok: true, paused: true });
  }

  /** A run that stopped before any request was worked on, Whop never asked. */
  const failedRun = async (error: string) => {
    await logCronFinish(runId, "failed", { error });
    console.error(`[${ROUTE_NAME}] ${error}`);
    return NextResponse.json({ ok: false, paused: false, mode, error }, { status: 500 });
  };

  const db = createServiceClient();
  // v116 adds the audit columns every write of the step sets: without them nothing is done.
  const probe = await db.from("discount_requests").select("audit_actor").limit(1);
  if (probe.error) {
    return failedRun(probe.error.code === "42703" ? "v116 is not pasted" : `the requests could not be read: ${probe.error.message}`);
  }
  if (!process.env.WHOP_API_KEY) return failedRun("WHOP_API_KEY is not set on this deployment. Nothing ran.");

  // The candidates: three reads, each the oldest 200 of its kind, so the oldest 200 of all three are among them.
  const nowMs = Date.now();
  const madeBy = new Date(nowMs - MIN_AGE_MS).toISOString();
  const newFrom = new Date(nowMs - JOB_NEW_CODE_WINDOW_MS).toISOString();
  const read = () =>
    db.from("discount_requests").select(COLUMNS).gte("created_at", DISCOUNT_ELIGIBLE_FROM).lte("created_at", madeBy);
  const [made48, claimed, approved] = await Promise.all([
    read().eq("status", "pending").gt("created_at", newFrom).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(CANDIDATES_MAX),
    read().eq("status", "pending").not("promo_code", "is", null).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(CANDIDATES_MAX),
    read().eq("status", "approved").order("created_at", { ascending: true }).order("id", { ascending: true }).limit(CANDIDATES_MAX),
  ]);
  const readFailed = made48.error ?? claimed.error ?? approved.error;
  if (readFailed) return failedRun(`the requests could not be read: ${readFailed.message}`);
  const byId = new Map<string, Candidate>();
  for (const r of [...(made48.data ?? []), ...(claimed.data ?? []), ...(approved.data ?? [])] as Candidate[]) byId.set(r.id, r);
  const candidates = [...byId.values()].sort(byAge).slice(0, CANDIDATES_MAX);

  // Each candidate's failures: how many, the newest's time and reason.
  const failures = new Map<string, { count: number; at: number; reason: string | null }>();
  const ids = candidates.map((c) => c.id);
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH);
    const events = await fetchAllRowsPaginated<{ request_id: string; reason: string | null; created_at: string }>(() =>
      db
        .from("discount_request_events")
        .select("request_id, reason, created_at")
        .eq("event", "attempt_failed")
        .in("request_id", batch)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
    );
    if (events.error) return failedRun(`the requests' failures could not be read: ${events.error.message}`);
    for (const e of events.data) {
      const at = Date.parse(e.created_at);
      const had = failures.get(e.request_id);
      if (!had) failures.set(e.request_id, { count: 1, at, reason: e.reason });
      else {
        had.count += 1;
        if (at > had.at) Object.assign(had, { at, reason: e.reason });
      }
    }
  }
  /** Whether a candidate waits for a later run: its last failure too recent, or a code on someone else's membership. */
  const waitsLonger = (id: string) => {
    const f = failures.get(id);
    if (!f) return false;
    if (f.reason === "landed_elsewhere") return true;
    return nowMs - f.at < (f.count >= LONG_WAIT_AFTER ? LONG_WAIT_MS : SHORT_WAIT_MS);
  };
  const left = candidates.filter((c) => !waitsLonger(c.id));
  const skipped = candidates.length - left.length;
  const taken = left.slice(0, TAKE_MAX);

  // The requests with no code whose 48 hours just ended: the team's now.
  const gave = await db
    .from("discount_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .is("promo_code", null)
    .is("whop_promo_id", null)
    .gte("created_at", DISCOUNT_ELIGIBLE_FROM)
    .gt("created_at", new Date(nowMs - JOB_NEW_CODE_WINDOW_MS - GAVE_UP_MS).toISOString())
    .lte("created_at", newFrom);
  if (gave.error) return failedRun(`the requests whose 48 hours ended could not be counted: ${gave.error.message}`);
  const gaveUp = gave.count ?? 0;

  const correlationId = randomUUID();
  let applied = 0;
  let waiting = 0;
  const byReason: Record<string, number> = {};
  const planned: Planned[] = [];
  const failed: string[] = [];
  for (const row of taken) {
    if (Date.now() - startedAtMs >= START_BY_MS) break;
    const deadlineMs = Math.min(Date.now() + ITEM_MS, startedAtMs + RUN_MS);
    const allowNewCode = Date.parse(row.created_at) > Date.now() - JOB_NEW_CODE_WINDOW_MS;
    // Approve's own checks, before any new code: the coupon check's answer stored in a real run, as Approve stores it.
    const checks = () => thirtyApprovalChecks(db, row, { override: false, overrideCoupon: false, store: !dry });
    let result: ThirtyResult;
    try {
      const shape = requestShape(row, Date.now());
      if (shape === "unclaimed") {
        const c = await checks();
        if (c.ok) {
          result = await putThirtyOn(db, row.id, {
            actor: JOB,
            correlationId,
            membershipId: c.coupon?.membershipId ?? null,
            couponSource: c.coupon?.source,
            deadlineMs,
            allowNewCode,
            dry,
          });
        } else {
          if (!dry) await recordRefusal(db, row, correlationId, c.body.error);
          result = {
            status: "pending",
            outcome: dry ? "planned" : "waiting",
            promoCode: null,
            whopPromoId: null,
            reason: "check_refused",
            step: null,
            message: c.body.error,
            membershipStatus: null,
          };
        }
      } else if (shape === "settling") {
        // Its code is looked up by name first; the checks run only before a new code, once the lost one is not on Whop.
        result = await putThirtyOn(db, row.id, { actor: JOB, correlationId, deadlineMs, allowNewCode, freshChecks: checks, dry });
      } else {
        result = await putThirtyOn(db, row.id, { actor: JOB, correlationId, deadlineMs, dry });
      }
    } catch (e) {
      failed.push(row.id);
      console.error(`[${ROUTE_NAME}] request ${row.id}: the step failed: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (result.outcome === "applied") applied += 1;
    if (result.status === "pending" || result.status === "approved") waiting += 1;
    if (result.reason) byReason[result.reason] = (byReason[result.reason] ?? 0) + 1;
    if (dry) planned.push({ requestId: row.id, status: result.status, would: result.would ?? null, reason: result.reason });
  }

  const ok = failed.length === 0;
  if (ok) await logCronFinish(runId, "success", { rowsAffected: applied });
  else {
    const error = `the step failed for ${failed.length} of ${taken.length} requests: ${failed.join(", ")}`;
    await logCronFinish(runId, "failed", { error, rowsAffected: applied });
    console.error(`[${ROUTE_NAME}] ${error}`);
  }
  return NextResponse.json(
    { ok, paused: false, mode, examined: candidates.length, applied, waiting, skipped, gaveUp, byReason, planned, failed },
    { status: ok ? 200 : 500 },
  );
}

/** A check that refused before a new code, in the request's history: attempt_failed check_refused, the check's sentence. */
async function recordRefusal(db: ReturnType<typeof createServiceClient>, row: Candidate, correlationId: string, sentence: string) {
  try {
    const { error } = await db.from("discount_request_events").insert({
      request_id: row.id,
      student_id: row.student_id,
      event: "attempt_failed",
      actor: "job",
      team_member_id: null,
      correlation_id: correlationId,
      reason: "check_refused",
      detail: {
        step: null,
        http: null,
        message: sentence.length > 300 ? sentence.slice(0, 300) : sentence,
        membership_status: null,
        code: null,
        product: null,
      },
    });
    if (error) console.error(`[${ROUTE_NAME}] request ${row.id}: the check_refused event was not written: ${error.message}`);
  } catch (e) {
    console.error(`[${ROUTE_NAME}] request ${row.id}: the check_refused event was not written: ${e instanceof Error ? e.message : String(e)}`);
  }
}
