"use client";

/**
 * Renders one discount application's feedback answers (question → answer),
 * sorted by the question order. Shared by the per-request card on
 * /admin/discounts and the grouped list on /admin/feedback/survey so the
 * two surfaces never drift.
 */

import type {
  DiscountFeedbackQuestion,
  DiscountFeedbackResponse,
} from "@/types/database";

export function DiscountFeedbackResponses({
  responses,
  questions,
}: {
  responses: DiscountFeedbackResponse[];
  questions: DiscountFeedbackQuestion[];
}) {
  const byId = new Map<string, DiscountFeedbackResponse>();
  for (const r of responses) byId.set(r.question_id, r);
  const sortedQs = [...questions].sort((a, b) => a.order_num - b.order_num);
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 8,
        background: "var(--color-fill-secondary)",
        marginBottom: 12,
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary)",
          marginBottom: 8,
        }}
      >
        Feedback responses
      </p>
      <div className="flex flex-col gap-3">
        {sortedQs.map((q) => {
          const r = byId.get(q.id);
          if (!r) return null;
          let valueNode: React.ReactNode;
          if (q.question_type === "scale" && r.answer_scale != null) {
            valueNode = (
              <strong
                style={{
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--color-text-primary)",
                }}
              >
                {r.answer_scale}
              </strong>
            );
          } else if (q.question_type === "multi_choice" && r.answer_choice) {
            valueNode = (
              <span style={{ color: "var(--color-text-primary)" }}>
                {r.answer_choice}
              </span>
            );
          } else if (r.answer_text && r.answer_text.trim().length > 0) {
            valueNode = (
              <span
                style={{
                  color: "var(--color-text-primary)",
                  whiteSpace: "pre-wrap",
                }}
              >
                &ldquo;{r.answer_text}&rdquo;
              </span>
            );
          } else {
            valueNode = (
              <span
                style={{
                  color: "var(--color-text-tertiary)",
                  fontStyle: "italic",
                }}
              >
                (no answer)
              </span>
            );
          }
          return (
            <div key={q.id} style={{ fontSize: 12, lineHeight: 1.5 }}>
              <div
                style={{
                  color: "var(--color-text-tertiary)",
                  marginBottom: 2,
                }}
              >
                {q.question_text}
              </div>
              <div>{valueNode}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
