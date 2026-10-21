import type { SupabaseClient } from "@supabase/supabase-js";
import type { DiscountFeedbackAnswer, DiscountFeedbackQuestion } from "@/types/database";

/**
 * The discount application's questions (discount_feedback_questions, v29):
 * what an answer holds while the student fills the form in, whether a
 * question is answered enough to go on, and the answers as
 * /api/discounts/submit-feedback takes them.
 *
 * Two forms read this file and nothing else decides it: the old dashboard's
 * (src/components/map/DiscountFeedbackModal.tsx) and the map's
 * (src/components/world/WorldDiscountForm.tsx). It was the dashboard modal's
 * own code until the map needed the same rules (2026-10-14).
 *
 * Since the owner's review (2026-10-21) the server holds an application to
 * the same rule (requiredAnswersRefusal): both routes that make a request
 * refuse one that leaves a required question unanswered, so an application
 * sent past the form cannot skip the questions.
 */

export type AnswerValue =
  | { kind: "scale"; value: number | null }
  | { kind: "choice"; value: string | null }
  | { kind: "text"; value: string };

/** An unanswered question: no number, no choice, no words. */
export function defaultValue(q: DiscountFeedbackQuestion): AnswerValue {
  if (q.question_type === "scale") return { kind: "scale", value: null };
  if (q.question_type === "multi_choice") return { kind: "choice", value: null };
  return { kind: "text", value: "" };
}

/** True when the student can go on: an optional question always, a required one once answered (spaces are no answer). */
export function isAnswered(q: DiscountFeedbackQuestion, a: AnswerValue): boolean {
  if (!q.is_required) return true;
  return hasAnswer(a);
}

/** An answer is there: a number, a choice, or words that are not only spaces. */
function hasAnswer(a: AnswerValue): boolean {
  if (a.kind === "scale") return a.value != null;
  if (a.kind === "choice") return a.value != null && a.value.length > 0;
  return a.value.trim().length > 0;
}

/** One answer as an application sends it, its values as they came (anything not of the right kind is no answer). */
export interface SentAnswer {
  question_id?: unknown;
  answer_scale?: unknown;
  answer_choice?: unknown;
  answer_text?: unknown;
}

/** A sent answer as the form's value for a question of `type`: the field that type is answered in, nothing else. */
function sentValue(type: DiscountFeedbackQuestion["question_type"], a: SentAnswer): AnswerValue {
  if (type === "scale") {
    return { kind: "scale", value: typeof a.answer_scale === "number" && Number.isFinite(a.answer_scale) ? a.answer_scale : null };
  }
  if (type === "multi_choice") return { kind: "choice", value: typeof a.answer_choice === "string" ? a.answer_choice : null };
  return { kind: "text", value: typeof a.answer_text === "string" ? a.answer_text : "" };
}

/**
 * The ids of the required questions an application leaves unanswered: the
 * forms' rule (isAnswered) on what was sent. `required` are the active
 * questions marked is_required; a question counts as answered when some
 * answer to it holds the kind its type takes (a number for a scale, a
 * choice, or words for an open question).
 */
export function unansweredRequired(
  required: ReadonlyArray<Pick<DiscountFeedbackQuestion, "id" | "question_type">>,
  answers: readonly SentAnswer[],
): string[] {
  return required
    .filter((q) => !answers.some((a) => a.question_id === q.id && hasAnswer(sentValue(q.question_type, a))))
    .map((q) => q.id);
}

/** What the student reads when a required question has no answer. The forms mark every other question "Optional". */
export const UNANSWERED_REQUIRED = "Answer every question that is not marked Optional, then send it again.";
/** What the student reads when the questions could not be read, so the answers could not be checked. */
export const ANSWERS_UNCHECKED = "We couldn't check your answers just now, so nothing was sent. Try again in a minute.";

/**
 * Both routes that make a request (the owner's review, 2026-10-21): the
 * application's answers against the active required questions, read now.
 * Null when every one has an answer (or there is none); otherwise the
 * refusal, a status and the student's sentence, and nothing may be written:
 * a question left unanswered is a 400, and a read of the questions that
 * failed is a 503 (fails closed, never "no questions"). `sent` is what the
 * application carried: the feedback form's answers, or none for a plain
 * request.
 */
export async function requiredAnswersRefusal(
  db: SupabaseClient,
  sent: readonly SentAnswer[],
): Promise<{ status: number; error: string; log: string } | null> {
  let rows: unknown;
  try {
    const { data, error } = await db
      .from("discount_feedback_questions")
      .select("id, question_type")
      .eq("is_active", true)
      .eq("is_required", true);
    if (error) return { status: 503, error: ANSWERS_UNCHECKED, log: `nothing written, the required questions could not be read: ${error.message}` };
    rows = data;
  } catch (e) {
    return { status: 503, error: ANSWERS_UNCHECKED, log: `nothing written, the required questions could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!Array.isArray(rows)) return { status: 503, error: ANSWERS_UNCHECKED, log: "nothing written, the required questions read came back with no rows" };
  const missing = unansweredRequired(rows as Array<Pick<DiscountFeedbackQuestion, "id" | "question_type">>, sent);
  if (missing.length === 0) return null;
  return { status: 400, error: UNANSWERED_REQUIRED, log: `nothing written, ${missing.length} required ${missing.length === 1 ? "question" : "questions"} unanswered: ${missing.join(", ")}` };
}

/** The questions in the order the team set (order_num). */
export function sortQuestions(questions: readonly DiscountFeedbackQuestion[]): DiscountFeedbackQuestion[] {
  return [...questions].sort((a, b) => a.order_num - b.order_num);
}

/** One answer per question, in the questions' order; a question left alone sends its empty answer. */
export function toAnswers(
  questions: readonly DiscountFeedbackQuestion[],
  answers: Readonly<Record<string, AnswerValue>>,
): DiscountFeedbackAnswer[] {
  return questions.map((q) => {
    const v = answers[q.id] ?? defaultValue(q);
    return {
      question_id: q.id,
      answer_scale: v.kind === "scale" ? v.value : null,
      answer_choice: v.kind === "choice" ? v.value : null,
      answer_text: v.kind === "text" ? v.value : null,
    };
  });
}
