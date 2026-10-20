/**
 * The Survey page's data (admin rebuild 2, WI-9): every 30% application's
 * answers to the survey, grouped by application, newest first.
 *
 * Read so it holds at any size (the page sent every request id in one
 * `.in()`, paged its answers on created_at alone and checked no error):
 *   - the questions and the answers are read page by page on their id
 *     (fetchAllRowsByKey), a unique key, so a page boundary never repeats
 *     or skips a row. The 6 answers of one application are written in one
 *     call and share one created_at, which is why created_at alone was not
 *     enough;
 *   - the applications and their students are read by id in batches of at
 *     most 100 ids (SURVEY_BATCH) per `.in()`, as the 30% loader does
 *     (src/lib/admin/thirty-data.ts): one `.in()` with every id outgrows the
 *     gateway's address limit at about 200 ids;
 *   - a read that fails fails the load with what could not be read, so the
 *     page shows the error and Retry instead of "No answers yet" or a list
 *     with applications missing.
 *
 * No React and no browser client here: client-tests/survey-page.test.mjs
 * runs it on the stand-in database. The page hands it the team member's
 * client (RLS lets the team read all four tables).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Answer } from "@/lib/admin/admin-transport";
import { fetchAllRowsByKey } from "@/lib/supabase-pagination";

/** The most ids in one `.in()`. */
export const SURVEY_BATCH = 100;

export interface SurveyQuestion {
  id: string;
  order_num: number;
  question_text: string;
  question_type: "scale" | "multi_choice" | "open_text";
  scale_min: number | null;
  scale_max: number | null;
  is_active: boolean;
}

export interface SurveyAnswer {
  id: string;
  discount_request_id: string;
  question_id: string;
  answer_scale: number | null;
  answer_choice: string | null;
  answer_text: string | null;
  created_at: string;
}

export interface SurveyApplication {
  id: string;
  /** discount_requests.status: pending, approved, rejected or applied. */
  status: string;
  created_at: string;
  /** Null when the student's row could not be found. */
  student: { id: string; name: string | null; email: string | null } | null;
  /** In question order. */
  answers: SurveyAnswer[];
}

export interface SurveyData {
  /** In order_num order, active or not (an old answer keeps its question). */
  questions: SurveyQuestion[];
  /** Newest application first. */
  applications: SurveyApplication[];
}

const QUESTION_COLUMNS = "id, order_num, question_text, question_type, scale_min, scale_max, is_active";
const ANSWER_COLUMNS = "id, discount_request_id, question_id, answer_scale, answer_choice, answer_text, created_at";

function batches<T>(items: readonly T[], size = SURVEY_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const failed = (what: string, message: string): Answer<SurveyData> => ({
  ok: false,
  status: 500,
  error: `${what} could not be read: ${message}`,
});

export async function loadSurveyData(supabase: SupabaseClient): Promise<Answer<SurveyData>> {
  const [questionsRes, answersRes] = await Promise.all([
    fetchAllRowsByKey<SurveyQuestion>(
      () => supabase.from("discount_feedback_questions").select(QUESTION_COLUMNS).order("id"),
      "id",
    ),
    fetchAllRowsByKey<SurveyAnswer>(
      () => supabase.from("discount_feedback_responses").select(ANSWER_COLUMNS).order("id"),
      "id",
    ),
  ]);
  if (questionsRes.error) return failed("The questions", questionsRes.error.message);
  if (answersRes.error) return failed("The answers", answersRes.error.message);

  const answersByRequest = new Map<string, SurveyAnswer[]>();
  for (const a of answersRes.data) {
    const list = answersByRequest.get(a.discount_request_id);
    if (list) list.push(a);
    else answersByRequest.set(a.discount_request_id, [a]);
  }

  type RequestRow = { id: string; student_id: string | null; status: string; created_at: string };
  const requestIds = [...answersByRequest.keys()].sort();
  const requestReads = await Promise.all(
    batches(requestIds).map((ids) =>
      fetchAllRowsByKey<RequestRow>(
        () => supabase.from("discount_requests").select("id, student_id, status, created_at").in("id", ids).order("id"),
        "id",
      ),
    ),
  );
  const requestError = requestReads.find((r) => r.error)?.error;
  if (requestError) return failed("The applications", requestError.message);
  const requests = requestReads.flatMap((r) => r.data);

  type StudentRow = { id: string; name: string | null; email: string | null };
  const studentIds = [...new Set(requests.map((r) => r.student_id).filter((id): id is string => !!id))].sort();
  const studentReads = await Promise.all(
    batches(studentIds).map((ids) =>
      fetchAllRowsByKey<StudentRow>(
        () => supabase.from("students").select("id, name, email").in("id", ids).order("id"),
        "id",
      ),
    ),
  );
  const studentError = studentReads.find((r) => r.error)?.error;
  if (studentError) return failed("The students", studentError.message);
  const studentById = new Map(studentReads.flatMap((r) => r.data).map((s) => [s.id, s]));

  const questions = [...questionsRes.data].sort((a, b) => a.order_num - b.order_num || cmp(a.id, b.id));
  const questionOrder = new Map(questions.map((q, i) => [q.id, i]));
  const rank = (a: SurveyAnswer) => questionOrder.get(a.question_id) ?? Number.MAX_SAFE_INTEGER;

  // An answer whose application did not come back (deleted between the two
  // reads; its answers go with it, ON DELETE CASCADE) is left out.
  const applications: SurveyApplication[] = requests
    .map((r) => ({
      id: r.id,
      status: r.status,
      created_at: r.created_at,
      student: r.student_id ? (studentById.get(r.student_id) ?? null) : null,
      answers: [...(answersByRequest.get(r.id) ?? [])].sort((a, b) => rank(a) - rank(b) || cmp(a.id, b.id)),
    }))
    .sort((a, b) => cmp(b.created_at, a.created_at) || cmp(b.id, a.id));

  return { ok: true, status: 200, data: { questions, applications } };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/* ─── What the page shows ─── */

type Tone = "success" | "warning" | "danger" | "accent" | "neutral";

/**
 * The status words, as the 30% page names them (admin rebuild 2, D4):
 * "Applied" is a request waiting for a decision (pending), "Code Applied" is
 * a code on the student's membership in Whop (applied).
 */
export const STATUS_WORDS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Applied", tone: "accent" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  applied: { label: "Code Applied", tone: "neutral" },
};

export function statusWords(status: string): { label: string; tone: Tone } {
  return STATUS_WORDS[status] ?? { label: status ? `Unknown status (${status})` : "No status", tone: "neutral" };
}

/** How many applications are in each status, in the 30% page's order. */
export function statusCounts(applications: SurveyApplication[]): Array<{ label: string; count: number }> {
  return ["pending", "approved", "applied", "rejected"]
    .map((s) => ({ label: STATUS_WORDS[s].label, count: applications.filter((a) => a.status === s).length }))
    .filter((c) => c.count > 0);
}

/**
 * The mean of every answer to a scale question (the recommend question):
 * a plain average, not an NPS score. The scale's ends are named when every
 * scale question shares them.
 */
export function recommendAverage(data: SurveyData): { value: number | null; count: number; scale: string | null } {
  const scale = data.questions.filter((q) => q.question_type === "scale");
  const ids = new Set(scale.map((q) => q.id));
  let sum = 0;
  let count = 0;
  for (const app of data.applications) {
    for (const a of app.answers) {
      if (ids.has(a.question_id) && typeof a.answer_scale === "number") {
        sum += a.answer_scale;
        count += 1;
      }
    }
  }
  const ends = new Set(scale.map((q) => `${q.scale_min ?? "?"} to ${q.scale_max ?? "?"}`));
  const only = ends.size === 1 ? [...ends][0] : null;
  return { value: count > 0 ? sum / count : null, count, scale: only && !only.includes("?") ? only : null };
}
