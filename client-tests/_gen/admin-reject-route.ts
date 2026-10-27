import { NextRequest, NextResponse } from "./stub-server.ts";
import { randomUUID } from "crypto";
import { requireTeam, isAuthFailure } from "./stub-admin.ts";
import { newReadContext, type WhopReadContext } from "./membership-discount.ts";
import { readThirtyStudent, requestShape, settleClaim, whereIsCode, type WhereAnswer } from "./thirty-apply.ts";
import { thirtyWords } from "./thirty-words.ts";

/**
 * Reject a discount request. Team-only.
 *
 * v75.31: was anonymous — anyone with a requestId could mark a row
 * rejected. Now requires founder/admin/csm.
 *
 * The 30% that applies itself (T-137, the PRD's §9.4 reject table): a request
 * whose code may exist is rejected only once Whop shows the code on nobody's
 * membership, by a founder or an admin (a csm is refused with a 403), and the
 * answer names the code left usable at checkout. By the row as it is read
 * (requestShape, src/lib/thirty-apply.ts):
 *   - pending with no code (unclaimed): any team role, rejected.
 *   - pending, claimed under 5 minutes ago (the app is making its code): 409,
 *     nothing done.
 *   - pending, claimed 5 minutes ago or more (a claim that lost its answer):
 *     its code looked for on Whop by its name first (settleClaim). Not made:
 *     rejected and the claim given back. Made: where it is (whereIsCode); on
 *     nobody's membership, rejected with its Whop id stored (usable at
 *     checkout); on the student's own, the 30% is theirs (409, the job marks
 *     it applied, or Approve anyway while the app is paused); elsewhere, the
 *     words for it (409); Whop not answering, 503.
 *   - pending reopened by hand, or approved with the app's code id: where the
 *     code is first; on nobody's membership, rejected (usable at checkout);
 *     anything else, nothing done, in the same words.
 *   - approved with no Whop id the app can ask about (code unknown, from
 *     before this build or hand SQL): rejected, the code named as one Whop may
 *     have made.
 *   - applied or rejected: 409 "This request was already decided."
 * A request whose code Whop answered with another code of the same name on
 * the student's membership (an attempt_failed write_failed, step
 * attach_other_code, in its history) is never rejected here: that 30% is on
 * their membership, and only the hand fix closes it (409, the words of its
 * Why line; the build's review of 2026-10-27).
 * Every write is conditional on the row as it was read (a value read as NULL
 * matched with .is()), carries audit_actor team, the member and one
 * correlation id per press (v116's trigger records the change), and a write
 * that finds the row changed answers 409 "This request changed meanwhile.
 * Refresh the list." A 200 answers { success: true, code, codeState }: the
 * code's name and "usable" (made, on nobody's membership), "may_exist" (code
 * unknown) or null (no code made). A usable code's name then comes off the
 * rejected row, which the student can read, and the request stays on the
 * team's 30% page for 30 days (an attempt_failed write_failed, step
 * rejected_usable, naming the code), as its notice says (the same review).
 */

// Whop is asked at most twice (the code by its name, then where it sits), inside the press's own time limit.
export const maxDuration = 30;

const ALREADY_DECIDED = "This request was already decided.";
const CHANGED = "This request changed meanwhile. Refresh the list.";
const NOT_ASKED = "Couldn't ask Whop. Try again.";
/** The columns the reject reads (v116's promo_claimed_at among them). */
const ROW_COLUMNS = "id, student_id, status, promo_code, promo_claimed_at, whop_promo_id, created_at";
/** Under this much time left, no Whop call starts; each one waits at most the time left less a second, and 8 seconds. */
const LAST_CALL_MS = 2_000;
const CALL_MS = 8_000;
/** A detail field as a string, or null. */
const textOf = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

type Row = {
  id: string;
  student_id: string;
  status: string;
  promo_code: string | null;
  promo_claimed_at: string | null;
  whop_promo_id: string | null;
  created_at: string;
};

export async function POST(request: NextRequest) {
  const startedAtMs = Date.now();
  const auth = await requireTeam(request, ["founder", "admin", "csm"]);
  if (isAuthFailure(auth)) return auth.error;
  const supabase = auth.supabase;

  const { requestId, reason } = await request.json();

  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

  const read = await supabase.from("discount_requests").select(ROW_COLUMNS).eq("id", requestId).maybeSingle();
  if (read.error) {
    if (read.error.code === "42703") {
      return NextResponse.json({ error: "The 30% update isn't finished on the database (v116). Nothing was changed." }, { status: 503 });
    }
    console.error(`[discount reject] request ${requestId}: it could not be read: ${read.error.message}`);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  const row = read.data as Row | null;
  if (!row) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  const shape = requestShape(row, Date.now());
  if (shape === "decided") return NextResponse.json({ error: ALREADY_DECIDED }, { status: 409 });
  // A request whose code may exist is a founder's or an admin's to reject: the page shows a csm no Reject on it.
  const role = auth.teamMember.role;
  if (shape !== "unclaimed" && role !== "founder" && role !== "admin") {
    return NextResponse.json({ error: "Only a founder or an admin can reject this request." }, { status: 403 });
  }
  if (shape === "in_progress") {
    return NextResponse.json({ error: "The app is making this code right now. Try again in a few minutes." }, { status: 409 });
  }

  // One press: one correlation id on every write, the member who pressed it, and the rejection itself.
  const rejected = {
    status: "rejected",
    rejection_reason: reason || null,
    reviewed_at: new Date().toISOString(),
    // The logged-in team member, as approve records it.
    reviewed_by: auth.teamMember.id,
    audit_actor: "team",
    audit_correlation_id: randomUUID(),
    audit_team_member_id: auth.teamMember.id,
  };
  /**
   * A Reject that left a code usable at checkout: its name comes off the
   * rejected row (the student can read their own rows), and the request stays
   * on the team's list for 30 days through an attempt_failed write_failed,
   * step rejected_usable, naming the code (the list's own rule). The history
   * keeps the name: the trigger's rejected and code_changed events, and this
   * one, written last so it is the newest. Neither write changes the answer:
   * the rejection is saved, and a failure is logged.
   */
  const leftUsable = async (code: string, promoId: string) => {
    try {
      if (row.promo_code !== null) {
        const { error } = await supabase
          .from("discount_requests")
          .update({
            promo_code: null,
            audit_actor: "team",
            audit_correlation_id: rejected.audit_correlation_id,
            audit_team_member_id: auth.teamMember.id,
          })
          .eq("id", row.id)
          .eq("status", "rejected")
          .eq("promo_code", row.promo_code)
          .eq("whop_promo_id", promoId)
          .select("id");
        if (error) console.error(`[discount reject] request ${requestId}: rejected, but the name ${code} could not come off the row: ${error.message}`);
      }
      const { error } = await supabase.from("discount_request_events").insert({
        request_id: row.id,
        student_id: row.student_id,
        event: "attempt_failed",
        actor: "team",
        team_member_id: auth.teamMember.id,
        correlation_id: rejected.audit_correlation_id,
        reason: "write_failed",
        detail: { step: "rejected_usable", http: null, message: null, membership_status: null, code, product: null, whop_promo_id: promoId },
      });
      if (error) console.error(`[discount reject] request ${requestId}: rejected, but ${code} was not listed for the team: ${error.message}`);
    } catch (e) {
      console.error(`[discount reject] request ${requestId}: rejected, but ${code} was not seen to: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /**
   * A conditional write's answer: 200 with the code and its state, 409 when
   * the row changed, 500 on a database error. A code left usable (`promoId`
   * its Whop id) is seen to first (leftUsable).
   */
  const wrote = async (
    w: { data: unknown[] | null; error: { message: string } | null },
    code: string | null,
    codeState: "usable" | "may_exist" | null,
    promoId: string | null = null,
  ) => {
    if (w.error) {
      console.error(`[discount reject] request ${requestId}: the rejection was not saved: ${w.error.message}`);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
    if (!w.data || w.data.length === 0) return NextResponse.json({ error: CHANGED }, { status: 409 });
    if (codeState === "usable" && code !== null && promoId !== null) await leftUsable(code, promoId);
    return NextResponse.json({ success: true, code, codeState });
  };

  if (shape === "unclaimed") {
    const w = await supabase
      .from("discount_requests")
      .update(rejected)
      .eq("id", row.id)
      .eq("status", "pending")
      .is("promo_code", null)
      .select("id");
    return wrote(w, null, null);
  }

  if (shape === "code_unknown") {
    // The one Reject with no Whop answer: there is no id to ask about.
    let q = supabase.from("discount_requests").update(rejected).eq("id", row.id).eq("status", "approved");
    q = row.whop_promo_id === null ? q.is("whop_promo_id", null) : q.eq("whop_promo_id", row.whop_promo_id);
    return wrote(await q.select("id"), row.promo_code ?? row.whop_promo_id, "may_exist");
  }

  // Whop is asked from here on: inside min(15 s from now, 26 s from the start), as the 30% step's calls are.
  const deadlineMs = Math.min(Date.now() + 15_000, startedAtMs + 26_000);
  const ctx = newReadContext(process.env.WHOP_API_KEY ?? "");
  /** The read context for the next Whop call, or null when under 2 seconds are left. */
  const nextCall = (): WhopReadContext | null => {
    const left = deadlineMs - Date.now();
    if (left < LAST_CALL_MS) return null;
    const until = Date.now() + Math.min(left - 1_000, CALL_MS);
    ctx.startBy = until;
    ctx.answerBy = until;
    return ctx;
  };
  /** Where the code is, inside the deadline (null: no time left to ask). Throws only when the student cannot be read. */
  const where = async (promoId: string): Promise<WhereAnswer | null> => {
    const student = await readThirtyStudent(supabase, row.student_id);
    const c = nextCall();
    return c === null ? null : whereIsCode(promoId, student, c);
  };
  /** The code is somewhere a Reject must not go past: the words for it. */
  const refusedFor = (w: WhereAnswer | null, code: string, theirs: string): NextResponse => {
    if (w === null) return NextResponse.json({ error: NOT_ASKED }, { status: 503 });
    if (w.where === "on_theirs") return NextResponse.json({ error: theirs }, { status: 409 });
    if (w.where === "elsewhere") {
      return NextResponse.json(
        { error: thirtyWords("landed_elsewhere", w.step, { status: row.status, ageHours: 0, code, product: w.product }) },
        { status: 409 },
      );
    }
    if (w.where === "unknown" && (w.step === "where_filter" || w.step === "where_no_ids")) {
      return NextResponse.json({ error: `The app can't tell whose membership ${code} is on. Check it in Whop.` }, { status: 409 });
    }
    return NextResponse.json({ error: NOT_ASKED }, { status: 503 });
  };

  try {
    // Whop put another code of this request's name on their membership (attach_other_code, in its history): that 30%
    // is on, and only the hand fix closes the request. Asked of the database before Whop.
    const sameName = await supabase
      .from("discount_request_events")
      .select("detail")
      .eq("request_id", row.id)
      .eq("event", "attempt_failed")
      .eq("reason", "write_failed");
    if (sameName.error) throw new Error(`its history could not be read: ${sameName.error.message}`);
    const other = (sameName.data ?? []).find((e) => (e.detail as { step?: unknown } | null)?.step === "attach_other_code");
    if (other) {
      const code = textOf((other.detail as { code?: unknown }).code) ?? row.promo_code ?? row.whop_promo_id ?? "the code";
      return NextResponse.json(
        { error: thirtyWords("write_failed", "attach_other_code", { status: row.status, ageHours: 0, code }) },
        { status: 409 },
      );
    }

    if (shape === "settling") {
      // A claim that lost its answer: is its code on Whop? A read only; the write below is the rejection itself.
      const name = row.promo_code as string;
      const c = nextCall();
      const found = c === null ? { failed: "deadline" } : await settleClaim(supabase, { promo_code: name, promo_claimed_at: row.promo_claimed_at, created_at: row.created_at }, c);
      if ("failed" in found) return NextResponse.json({ error: "Couldn't ask Whop about this code. Try again." }, { status: 503 });
      if ("notFound" in found) {
        // Never made: rejected, and the claim given back, only as it was read.
        let q = supabase
          .from("discount_requests")
          .update({ ...rejected, promo_code: null, promo_claimed_at: null })
          .eq("id", row.id)
          .eq("status", "pending")
          .eq("promo_code", name)
          .is("whop_promo_id", null);
        q = row.promo_claimed_at === null ? q.is("promo_claimed_at", null) : q.eq("promo_claimed_at", row.promo_claimed_at);
        return await wrote(await q.select("id"), null, null);
      }
      const w = await where(found.found);
      if (w === null || w.where !== "nowhere") {
        // The claim stays for the job's settle; while the app is paused, Approve anyway marks it applied.
        return refusedFor(
          w,
          name,
          "The code is already on their membership, so the 30% is theirs. The app marks it applied within the hour; while the app is paused, press Approve anyway.",
        );
      }
      const q = supabase
        .from("discount_requests")
        .update({ ...rejected, whop_promo_id: found.found })
        .eq("id", row.id)
        .eq("status", "pending")
        .eq("promo_code", name)
        .is("whop_promo_id", null);
      return await wrote(await q.select("id"), name, "usable", found.found);
    }

    // Reopened by hand (pending with a Whop id), or approved with the app's code id.
    const promoId = row.whop_promo_id as string;
    const code = row.promo_code ?? promoId;
    const w = await where(promoId);
    if (w === null || w.where !== "nowhere") {
      const theirs =
        shape === "approved"
          ? "The code is already on their membership, so the 30% is theirs. Press Try again to mark it applied."
          : "The code is already on their membership, so the 30% is theirs. The app marks it applied within the hour; while the app is paused, press Approve anyway.";
      return refusedFor(w, code, theirs);
    }
    const q = supabase
      .from("discount_requests")
      .update(rejected)
      .eq("id", row.id)
      .eq("status", row.status)
      .eq("whop_promo_id", promoId);
    return await wrote(await q.select("id"), code, "usable", promoId);
  } catch (e) {
    console.error(`[discount reject] request ${requestId}: nothing was saved: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
