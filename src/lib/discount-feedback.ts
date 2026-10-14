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
  if (a.kind === "scale") return a.value != null;
  if (a.kind === "choice") return a.value != null && a.value.length > 0;
  return a.value.trim().length > 0;
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
