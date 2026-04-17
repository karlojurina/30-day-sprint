import type { QuizQuestion } from "@/types/database";

export interface QuizAnswer {
  questionId: string;
  selectedIndex: number;
  correct: boolean;
}

/**
 * Score a quiz attempt.
 * Returns the answers array with correctness, score, total, and pass/fail.
 */
export function scoreQuiz(
  questions: QuizQuestion[],
  selections: Record<string, number>, // questionId → selected option index
  passingPercent: number
): {
  answers: QuizAnswer[];
  score: number;
  total: number;
  passed: boolean;
} {
  const answers: QuizAnswer[] = [];
  let score = 0;

  for (const q of questions) {
    const selected = selections[q.id];
    const correct = selected === q.correct_index;
    if (correct) score++;
    answers.push({
      questionId: q.id,
      selectedIndex: selected ?? -1,
      correct,
    });
  }

  const total = questions.length;
  const percent = total > 0 ? (score / total) * 100 : 0;
  const passed = percent >= passingPercent;

  return { answers, score, total, passed };
}
