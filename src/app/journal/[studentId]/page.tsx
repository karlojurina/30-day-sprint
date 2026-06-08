import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase-server";
import { JournalView } from "./JournalView";

interface JournalPageProps {
  params: Promise<{ studentId: string }>;
}

/**
 * Field Journal — the takeaway artifact at the end of 30 days.
 *
 * Server-rendered with all the student's data. Print stylesheet
 * makes it look like a proper document when the user hits Cmd+P.
 *
 * v75.31 auth: previously this route was completely public — anyone
 * with a studentId UUID could view another student's full lesson
 * history, discount status, promo code, and name. The route's own
 * docstring flagged this as a TODO; v75.31 honors it.
 *
 * Access now requires the request to come from EITHER:
 *   * the student themselves (their authed user_id matches the
 *     row's supabase_user_id), OR
 *   * any logged-in team member (founder / admin / csm / readonly)
 *
 * Anyone else gets bounced to /login.
 */
export default async function JournalPage(props: JournalPageProps) {
  const { studentId } = await props.params;

  // v75.31: pull the Supabase session from cookies. We use the SSR
  // helper so the existing cookie-based session is honored.
  const cookieStore = await cookies();
  const ssrSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // No-op — we don't refresh the session here. If it's expired,
          // getUser returns null and we redirect to /login.
        },
      },
    },
  );

  const {
    data: { user },
  } = await ssrSupabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Two valid access paths: student-self OR team member.
  // Service-role client to bypass RLS for the membership/student check.
  const supabase = createServiceClient();

  const { data: teamMember } = await supabase
    .from("team_members")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  const isTeam = teamMember !== null;

  const { data: student } = await supabase
    .from("students")
    .select("id, name, joined_at, first_paid_at, supabase_user_id")
    .eq("id", studentId)
    .single();

  if (!student) {
    notFound();
  }

  const isStudentSelf = student.supabase_user_id === user.id;

  if (!isTeam && !isStudentSelf) {
    // Logged in but not authorized for this journal.
    redirect("/dashboard");
  }

  const [
    { data: regions },
    { data: lessons },
    { data: completions },
    { data: discountReq },
    { data: monthReview },
    { data: streaks },
  ] = await Promise.all([
    supabase.from("regions").select("*").order("order_num"),
    supabase.from("lessons").select("*").order("day").order("sort_order"),
    supabase
      .from("student_lesson_completions")
      .select("*")
      .eq("student_id", studentId),
    supabase
      .from("discount_requests")
      .select("status, promo_code")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("month_reviews")
      .select("*")
      .eq("student_id", studentId)
      .single(),
    supabase
      .from("student_streaks")
      .select("longest_streak")
      .eq("student_id", studentId)
      .maybeSingle(),
  ]);

  return (
    <JournalView
      student={{
        ...student,
        longest_streak: streaks?.longest_streak ?? 0,
      }}
      regions={regions ?? []}
      lessons={lessons ?? []}
      completions={completions ?? []}
      discountRequest={discountReq ?? null}
      monthReview={monthReview ?? null}
    />
  );
}
