import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase-server";
import { JournalView } from "./JournalView";

interface JournalPageProps {
  params: Promise<{ studentId: string }>;
}

/**
 * Field Journal — the takeaway artifact at the end of 30 days.
 *
 * Server-rendered with all the student's data. Print stylesheet makes
 * it look like a proper document when the user hits Cmd+P.
 *
 * Note: this route is currently auth-bypassed (anyone with a student
 * UUID can render). Acceptable for v1 since UUIDs aren't enumerable.
 * Tighten with a signed-link or session check before public launch.
 */
export default async function JournalPage(props: JournalPageProps) {
  const { studentId } = await props.params;
  const supabase = createServiceClient();

  const { data: student } = await supabase
    .from("students")
    .select("id, name, joined_at, longest_streak")
    .eq("id", studentId)
    .single();

  if (!student) {
    notFound();
  }

  const [
    { data: regions },
    { data: lessons },
    { data: completions },
    { data: discountReq },
    { data: monthReview },
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
  ]);

  return (
    <JournalView
      student={student}
      regions={regions ?? []}
      lessons={lessons ?? []}
      completions={completions ?? []}
      discountRequest={discountReq ?? null}
      monthReview={monthReview ?? null}
    />
  );
}
