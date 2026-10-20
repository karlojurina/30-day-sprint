"use client";

/**
 * One 30% application's survey answers (question, then answer), in the
 * questions' order. The Survey page (/admin/feedback/survey) is the only
 * user since the 30% page reads its answers itself (src/lib/admin/
 * thirty-data.ts). In the brand kit's dark look since admin rebuild 2
 * (WI-9).
 */

import type {
  DiscountFeedbackQuestion,
  DiscountFeedbackResponse,
} from "@/types/database";

type Question = Pick<DiscountFeedbackQuestion, "id" | "order_num" | "question_text" | "question_type">;
type Response = Pick<DiscountFeedbackResponse, "question_id" | "answer_scale" | "answer_choice" | "answer_text">;

export function DiscountFeedbackResponses({
  responses,
  questions,
}: {
  responses: Response[];
  questions: Question[];
}) {
  const byId = new Map<string, Response>();
  for (const r of responses) byId.set(r.question_id, r);
  const sortedQs = [...questions].sort((a, b) => a.order_num - b.order_num);
  const answered = sortedQs.filter((q) => byId.has(q.id));
  return (
    <div
      style={{
        padding: 14,
        borderRadius: "var(--radius-control)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      {answered.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          No answer matches a question the survey has now.
        </p>
      ) : (
        <dl className="flex flex-col" style={{ gap: 12 }}>
          {answered.map((q) => {
            const r = byId.get(q.id)!;
            let value: React.ReactNode;
            if (q.question_type === "scale" && r.answer_scale != null) {
              value = (
                <strong style={{ fontVariantNumeric: "tabular-nums", fontSize: 15 }}>{r.answer_scale}</strong>
              );
            } else if (q.question_type === "multi_choice" && r.answer_choice) {
              value = r.answer_choice;
            } else if (r.answer_text && r.answer_text.trim().length > 0) {
              value = <span style={{ whiteSpace: "pre-wrap" }}>&ldquo;{r.answer_text}&rdquo;</span>;
            } else {
              value = <span style={{ color: "var(--color-text-secondary)" }}>No answer</span>;
            }
            return (
              <div key={q.id} style={{ fontSize: 13, lineHeight: 1.5 }}>
                <dt style={{ color: "var(--color-text-secondary)", marginBottom: 2 }}>{q.question_text}</dt>
                <dd style={{ color: "var(--color-text-primary)", overflowWrap: "anywhere" }}>{value}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
