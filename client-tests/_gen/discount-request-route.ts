import { NextRequest, NextResponse } from "./stub-server.ts";
import { createClient, type SupabaseClient } from "./stub-server.ts";
import { refuseWhileClosed } from "./student-app-gate.ts";
import { DISCOUNT_WINDOW_DAYS } from "./constants.ts";
import { onDiscountRequested } from "./stub-server.ts";
import { CATALOG_IS_V2, LESSONS_TABLE } from "./stub-server.ts";
import { checkMembershipDiscount } from "./membership-discount.ts";
import { requiredAnswersRefusal } from "./discount-feedback.ts";
import {
  SAVE_FAILED,
  decideDiscountRequest,
  loadDiscountReads,
  membershipDiscountRefusal,
  membershipUncheckedRefusal,
  secondPendingRequest,
} from "./discount-server.ts";

/**
 * The new course (2026-10-14): on a deployment that reads the v2 catalog
 * (CATALOG_IS_V2, true on staging and after cutover), the request is decided
 * by src/lib/world/discount.ts, the same rule the map shows: every video up to
 * the gate lesson, by the student's deadline (14 days from a first payment
 * made on or after 2026-10-09; the end of 2026-10-23 for one from 2026-10-01
 * until then; never for an earlier one). It grants only on `ready` and fails
 * closed on any read error.
 * Then the coupon (admin rebuild 2, D5): a student who already has a coupon
 * gets no 30%. Whop is asked now (checkMembershipDiscount; since T-122's
 * third fix round the owner's rule as he put it: a promo code other than the
 * student's own 30% on the membership on file, on any course membership found
 * through their Whop user (since its fourth, those that no longer grant
 * access too) or on any course payment, the $0 ones too, is a coupon, and
 * since its fifth so is a course payment naming no code that came to less
 * than its subtotal; with neither anywhere, the student's first real course
 * payment in dollars under 97.00 that is no plan change is one, a later
 * charge never). When Whop does not answer, the stored row decides if it
 * says a coupon, or says none, this rule wrote it and nothing since (its
 * source carrying this rule's version and source_checked_at its checked_at,
 * which needs v113 and since the fifth fix round; a row with no source, as
 * every row written before v113 is, an earlier round's source, a row written
 * over since, and without v113 any stored "no coupon", do not answer), it
 * names no code but the student's own by the promo id on their own request
 * (since the fourth fix round), and the student's row could be read (since
 * the fifth). With neither, since the owner's review (2026-10-21) nothing is
 * written and the student reads "We couldn't check your membership just now.
 * Try again in a minute." (membershipUncheckedRefusal, a 503); the request
 * used to go through and leave the coupon to the approve route.
 * The old rule below runs everywhere else, unchanged, so the live app on the
 * v1 catalog behaves exactly as before.
 */
async function requestUnderNewCourse(supabase: SupabaseClient, studentId: string) {
  const reads = await loadDiscountReads(supabase, studentId, LESSONS_TABLE);
  const decision = decideDiscountRequest(reads, new Date());
  if (!decision.grant) {
    if (decision.log) console.error(`[discounts/request] student ${studentId}: ${decision.log}`);
    return NextResponse.json(
      { error: decision.error, state: decision.state },
      { status: decision.status },
    );
  }

  const coupon = await checkMembershipDiscount(supabase, studentId);
  if (coupon.discounted) {
    const refusal = membershipDiscountRefusal();
    return NextResponse.json({ error: refusal.error, state: refusal.state }, { status: refusal.status });
  }
  if (coupon.source === "none") {
    console.error(
      `[discounts/request] student ${studentId}: nothing written, the coupon check could not run (${coupon.liveFail ?? "no answer"}) and nothing is stored`,
    );
    const refusal = membershipUncheckedRefusal();
    return NextResponse.json({ error: refusal.error, state: refusal.state }, { status: refusal.status });
  }

  const { data, error } = await supabase
    .from("discount_requests")
    .insert({ student_id: studentId })
    .select()
    .single();

  if (error) {
    // A second Apply sent with the first (v106 refuses it): the first stands.
    const twice = secondPendingRequest(error);
    if (twice) return NextResponse.json(twice, { status: 400 });
    // Anything else: one plain sentence for the student, the real error for the log.
    console.error(`[discounts/request] student ${studentId}: saving the request failed`, error);
    return NextResponse.json({ error: SAVE_FAILED }, { status: 500 });
  }

  // CSM W2.6 admin task (best-effort).
  await onDiscountRequested(supabase, studentId);

  return NextResponse.json(data);
}

/**
 * V4: Discount = complete ALL Region 1 + Region 2 lessons within
 * DISCOUNT_WINDOW_DAYS (14) of the student's Whop join date.
 * Measured server-side. No partial discount, no do-overs.
 *
 * v75.31: student-self auth. Previously this route was anonymous
 * and trusted body.studentId. Anyone on the internet (knowing a
 * studentId UUID) could POST a request for that student. Now we
 * require a valid student session and DERIVE studentId from the JWT.
 * The body.studentId is ignored.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const token = authHeader.slice(7);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // T-078: closed to students until the new course (lib/student-app-gate.ts).
  const closed = await refuseWhileClosed(supabase, user.id);
  if (closed) return closed;

  const { data: authedStudent } = await supabase
    .from("students")
    .select("id")
    .eq("supabase_user_id", user.id)
    .single();
  if (!authedStudent) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  // Server-derived; body.studentId (if any) is ignored.
  const studentId = authedStudent.id;

  // The survey (the owner's review, 2026-10-21): a plain request carries no
  // answers, so while the team has a required question it is refused and the
  // application goes through the form (POST /api/discounts/submit-feedback).
  // The map sends a plain request only when it finds no active question.
  const unanswered = await requiredAnswersRefusal(supabase, []);
  if (unanswered) {
    console.error(`[discounts/request] student ${studentId}: ${unanswered.log}`);
    return NextResponse.json({ error: unanswered.error }, { status: unanswered.status });
  }

  if (CATALOG_IS_V2) return requestUnderNewCourse(supabase, studentId);

  // Duplicate check
  const { data: existing } = await supabase
    .from("discount_requests")
    .select("id, status")
    .eq("student_id", studentId)
    .in("status", ["pending", "approved", "applied"])
    .limit(1)
    .single();

  if (existing) {
    return NextResponse.json(
      { error: "You already have a discount request" },
      { status: 400 }
    );
  }

  // v75.18: anchor the discount window on first_paid_at (original
  // signup), NOT joined_at (current cycle start). A returning customer
  // whose first Whop signup was 6 months ago shouldn't be eligible
  // for a "first 14 days" discount even if they just renewed.
  const { data: student } = await supabase
    .from("students")
    .select("joined_at, first_paid_at")
    .eq("id", studentId)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // v75.26: NULL first_paid_at is no longer treated as 'fall back to
  // joined_at' for discount eligibility. A returning customer whose
  // first_paid_at was never backfilled would otherwise get a fresh
  // 14-day window anchored on their RENEWAL joined_at — exactly the
  // leak v75.18/v75.20 was meant to prevent (F14 audit confirmed 18
  // students at risk). NULL → ineligible, contact support. The
  // nightly Whop sync will backfill first_paid_at for any legitimate
  // first-timer caught by this guard within 24h.
  if (!student.first_paid_at) {
    return NextResponse.json(
      {
        error:
          "We can't verify your signup date right now — please contact support and we'll sort it out within 24h.",
      },
      { status: 400 },
    );
  }

  const joinedAt = new Date(student.first_paid_at);
  const deadline = new Date(
    joinedAt.getTime() + DISCOUNT_WINDOW_DAYS * 86_400_000
  );
  const now = new Date();

  if (now > deadline) {
    return NextResponse.json(
      {
        error: `The discount window closed ${Math.floor(
          (now.getTime() - deadline.getTime()) / 86_400_000
        )} days ago. The 30% is only for students who finish R1 + R2 inside the first ${DISCOUNT_WINDOW_DAYS} days.`,
      },
      { status: 400 }
    );
  }

  // Eligibility: every lesson in R1 + R2 must be "done" on the path.
  // Definition matches what the map shows the student:
  //   - Compound action items (requires_action=true): need BOTH
  //     completed_at (briefing watched) AND action_completed_at (ad shipped).
  //     These are real work and can't be skipped.
  //   - All other lessons: completed_at OR skipped_at is set. Skipped rows
  //     count toward path progression so the student's region progress bar
  //     and the server's eligibility check stay in sync.
  const [{ data: requiredLessons }, { data: completions }] = await Promise.all(
    [
      supabase
        .from("lessons")
        .select("id, requires_action")
        .in("region_id", ["r1", "r2"]),
      supabase
        .from("student_lesson_completions")
        .select("lesson_id, completed_at, action_completed_at, skipped_at")
        .eq("student_id", studentId),
    ]
  );

  const required = requiredLessons ?? [];
  // Fails closed (cutover PRD, C22, WI-9). On the old course r1 + r2 always
  // hold lessons, so an empty list means the new course's data met a build
  // without CATALOG_SHAPE=v2, or the read failed. Every lesson in an empty
  // list is "done", so carrying on would grant the request to anyone.
  if (required.length === 0) {
    return NextResponse.json(
      { error: "The course changed and this check cannot run. Nothing was requested." },
      { status: 409 },
    );
  }
  const completionMap = new Map<
    string,
    {
      completed_at: string | null;
      action_completed_at: string | null;
      skipped_at: string | null;
    }
  >();
  for (const c of completions ?? []) {
    completionMap.set(c.lesson_id, {
      completed_at: c.completed_at,
      action_completed_at: c.action_completed_at,
      skipped_at: c.skipped_at,
    });
  }

  const missing: string[] = [];
  let latestCompletion = joinedAt;
  for (const lesson of required) {
    const c = completionMap.get(lesson.id);
    const watchDone = c?.completed_at != null;
    const actionDone = c?.action_completed_at != null;
    const skipped = c?.skipped_at != null;
    const fullyDone = lesson.requires_action
      ? watchDone && actionDone
      : watchDone || skipped;
    if (!fullyDone) {
      missing.push(lesson.id);
      continue;
    }
    // Track the latest of any timestamp for window enforcement
    for (const ts of [c?.completed_at, c?.action_completed_at, c?.skipped_at]) {
      if (ts) {
        const d = new Date(ts);
        if (d > latestCompletion) latestCompletion = d;
      }
    }
  }

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `Not yet eligible — ${required.length - missing.length}/${required.length} required lessons complete.`,
      },
      { status: 400 }
    );
  }

  // All R1+R2 lessons done — but did they finish them inside the window?
  if (latestCompletion > deadline) {
    return NextResponse.json(
      {
        error: `You finished after the ${DISCOUNT_WINDOW_DAYS}-day window. The 30% is only for students who complete R1 + R2 within the first ${DISCOUNT_WINDOW_DAYS} days.`,
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("discount_requests")
    .insert({ student_id: studentId })
    .select()
    .single();

  if (error) {
    // Two Apply clicks can both pass the duplicate check above; v106 refuses
    // the second insert, and the first stands.
    const twice = secondPendingRequest(error);
    if (twice) return NextResponse.json(twice, { status: 400 });
    // Anything else: one plain sentence for the student, the real error for the log.
    console.error(`[discounts/request] student ${studentId}: saving the request failed`, error);
    return NextResponse.json({ error: SAVE_FAILED }, { status: 500 });
  }

  // CSM W2.6 admin task (best-effort).
  await onDiscountRequested(supabase, studentId);

  return NextResponse.json(data);
}
