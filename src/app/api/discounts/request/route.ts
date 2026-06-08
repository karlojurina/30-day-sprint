import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DISCOUNT_WINDOW_DAYS } from "@/lib/constants";
import { onDiscountRequested } from "@/lib/csm-events";

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
    return NextResponse.json({ error: "Failed to create request" }, { status: 500 });
  }

  // CSM W2.6 admin task (best-effort).
  await onDiscountRequested(supabase, studentId);

  return NextResponse.json(data);
}
