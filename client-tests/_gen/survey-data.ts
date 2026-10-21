/**
 * The Survey page's data (admin rebuild 2, WI-9): every 30% application's
 * answers to the survey, grouped by application, newest first. The page
 * shows the applications from 1 October (DISCOUNT_ELIGIBLE_FROM, the 30%
 * page's first day) and counts the older ones in a line with a toggle; its
 * summary on top (the recommend average, the scores' spread, how many picked
 * each pace answer) is worked out over the applications it shows, so the old
 * course's answers never mix into the new course's (the review's fix round).
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
import type { Answer } from "./types-erased.ts";
import { DISCOUNT_STATUS, DISCOUNT_STATUS_ORDER, discountStatusWords } from "./discount-status.ts";
import { fetchAllRowsByKey } from "./supabase-pagination.ts";
import { DISCOUNT_ELIGIBLE_FROM } from "./discount.ts";

/** The most ids in one `.in()`. */
export const SURVEY_BATCH = 100;

export interface SurveyQuestion {
  id: string;
  order_num: number;
  question_text: string;
  question_type: "scale" | "multi_choice" | "open_text";
  /** A multi_choice question's answers, in the form's order (jsonb); null for the other types. */
  options?: string[] | null;
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

const QUESTION_COLUMNS = "id, order_num, question_text, question_type, options, scale_min, scale_max, is_active";
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

/**
 * The status words and tones: the one map every admin page uses
 * (src/lib/admin/discount-status.ts). "Applied" is a request waiting for a
 * decision (pending), "Code Applied" is a code on the student's membership
 * in Whop (applied).
 */
export const STATUS_WORDS = DISCOUNT_STATUS;

export const statusWords = discountStatusWords;

/** How many applications are in each status, in the 30% page's tab order. */
export function statusCounts(applications: SurveyApplication[]): Array<{ label: string; count: number }> {
  return DISCOUNT_STATUS_ORDER.map((s) => ({ label: DISCOUNT_STATUS[s].label, count: applications.filter((a) => a.status === s).length })).filter(
    (c) => c.count > 0,
  );
}

/** The first day the page lists by default: the 30% page's (DISCOUNT_ELIGIBLE_FROM, 1 October in Croatia). */
export const SURVEY_LISTED_FROM = DISCOUNT_ELIGIBLE_FROM;

/** The applications made from SURVEY_LISTED_FROM on, and the older ones, each newest first. */
export function splitByListedFrom(applications: SurveyApplication[]): { listed: SurveyApplication[]; older: SurveyApplication[] } {
  const from = Date.parse(SURVEY_LISTED_FROM);
  const listed: SurveyApplication[] = [];
  const older: SurveyApplication[] = [];
  for (const a of applications) (Date.parse(a.created_at) >= from ? listed : older).push(a);
  return { listed, older };
}

/** An answer that says something: a score, a choice, or words. A row with none of them is no answer. */
export function isAnswered(a: Pick<SurveyAnswer, "answer_scale" | "answer_choice" | "answer_text">): boolean {
  return typeof a.answer_scale === "number" || (typeof a.answer_choice === "string" && a.answer_choice.trim() !== "") || (a.answer_text ?? "").trim() !== "";
}

/**
 * How many gave each score of the scale question (the recommend question),
 * from its lowest to its highest, over `applications`. Null when the survey
 * has no scale question.
 */
export function scoreSpread(
  questions: SurveyQuestion[],
  applications: SurveyApplication[],
): { question: SurveyQuestion; counts: Array<{ score: number; count: number }> } | null {
  const q = questions.find((x) => x.question_type === "scale");
  if (!q) return null;
  const tally = new Map<number, number>();
  for (const app of applications) {
    for (const a of app.answers) {
      if (a.question_id === q.id && typeof a.answer_scale === "number") tally.set(a.answer_scale, (tally.get(a.answer_scale) ?? 0) + 1);
    }
  }
  const scores = [...tally.keys()];
  const lo = Math.min(q.scale_min ?? 1, ...scores);
  const hi = Math.max(q.scale_max ?? 10, ...scores);
  const counts: Array<{ score: number; count: number }> = [];
  for (let score = lo; score <= hi; score++) counts.push({ score, count: tally.get(score) ?? 0 });
  return { question: q, counts };
}

/**
 * How many picked each answer of the pace question (the multi_choice
 * question that asks about the pace), in the form's order, over
 * `applications`; an answer the form no longer offers comes after them.
 * Null when the survey has no such question.
 */
export function paceTally(
  questions: SurveyQuestion[],
  applications: SurveyApplication[],
): { question: SurveyQuestion; counts: Array<{ choice: string; count: number }> } | null {
  const q = questions.find((x) => x.question_type === "multi_choice" && /\bpace\b/i.test(x.question_text));
  if (!q) return null;
  const tally = new Map<string, number>();
  for (const app of applications) {
    for (const a of app.answers) {
      if (a.question_id === q.id && typeof a.answer_choice === "string" && a.answer_choice.trim() !== "") {
        tally.set(a.answer_choice, (tally.get(a.answer_choice) ?? 0) + 1);
      }
    }
  }
  const offered = Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === "string") : [];
  const extra = [...tally.keys()].filter((c) => !offered.includes(c));
  return { question: q, counts: [...offered, ...extra].map((choice) => ({ choice, count: tally.get(choice) ?? 0 })) };
}

/**
 * The mean of every answer to a scale question (the recommend question):
 * a plain average, not an NPS score. The scale's ends are named when every
 * scale question shares them. Over `applications` (every one by default).
 */
export function recommendAverage(
  data: SurveyData,
  applications: SurveyApplication[] = data.applications,
): { value: number | null; count: number; scale: string | null } {
  const scale = data.questions.filter((q) => q.question_type === "scale");
  const ids = new Set(scale.map((q) => q.id));
  let sum = 0;
  let count = 0;
  for (const app of applications) {
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
