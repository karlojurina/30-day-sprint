"use client";

/**
 * DiscountFeedbackModal — the 6-question form the student fills out
 * when they click "Apply for 30% discount" on the dashboard widget.
 *
 * Flow:
 *   1. Apply opens the modal
 *   2. Step through 6 questions, one per screen, Back + Continue
 *   3. Submit on the last screen creates the discount_requests row +
 *      the 6 response rows atomically (server-side RPC)
 *   4. Confirmation screen, then auto-close
 *
 * State lives in this component; the only context-coupling is
 * submitDiscountFeedback + the question list.
 */

import { useEffect, useMemo, useState } from "react";
import { useStudent } from "@/contexts/StudentContext";
import type {
  DiscountFeedbackAnswer,
  DiscountFeedbackQuestion,
} from "@/types/database";

type AnswerValue =
  | { kind: "scale"; value: number | null }
  | { kind: "choice"; value: string | null }
  | { kind: "text"; value: string };

function defaultValue(q: DiscountFeedbackQuestion): AnswerValue {
  if (q.question_type === "scale") return { kind: "scale", value: null };
  if (q.question_type === "multi_choice") return { kind: "choice", value: null };
  return { kind: "text", value: "" };
}

function isAnswered(q: DiscountFeedbackQuestion, a: AnswerValue): boolean {
  if (!q.is_required) return true;
  if (a.kind === "scale") return a.value != null;
  if (a.kind === "choice") return a.value != null && a.value.length > 0;
  return a.value.trim().length > 0;
}

export function DiscountFeedbackModal() {
  const {
    discountFeedbackOpen,
    discountFeedbackQuestions,
    closeDiscountFeedback,
    submitDiscountFeedback,
  } = useStudent();

  const sortedQuestions = useMemo(
    () =>
      [...discountFeedbackQuestions].sort(
        (a, b) => a.order_num - b.order_num,
      ),
    [discountFeedbackQuestions],
  );

  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // Reset state every time the modal opens
  useEffect(() => {
    if (discountFeedbackOpen) {
      setStepIdx(0);
      setAnswers(
        Object.fromEntries(sortedQuestions.map((q) => [q.id, defaultValue(q)])),
      );
      setError(null);
      setConfirmed(false);
    }
  }, [discountFeedbackOpen, sortedQuestions]);

  // Escape closes the modal
  useEffect(() => {
    if (!discountFeedbackOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDiscountFeedback();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [discountFeedbackOpen, closeDiscountFeedback]);

  if (!discountFeedbackOpen) return null;
  if (sortedQuestions.length === 0) {
    // No questions available — fall back to closing.
    return null;
  }

  const question = sortedQuestions[stepIdx];
  const total = sortedQuestions.length;
  const isLast = stepIdx === total - 1;
  const value = answers[question.id] ?? defaultValue(question);
  const canAdvance = isAnswered(question, value);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    const payload: DiscountFeedbackAnswer[] = sortedQuestions.map((q) => {
      const v = answers[q.id] ?? defaultValue(q);
      return {
        question_id: q.id,
        answer_scale: v.kind === "scale" ? v.value : null,
        answer_choice: v.kind === "choice" ? v.value : null,
        answer_text: v.kind === "text" ? v.value : null,
      };
    });
    const errMsg = await submitDiscountFeedback(payload);
    setSubmitting(false);
    if (errMsg) {
      setError(errMsg);
    } else {
      setConfirmed(true);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="discount-feedback-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(0, 0, 0, 0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={() => {
        // Click outside cancels (only when not confirmed/submitting)
        if (!submitting && !confirmed) closeDiscountFeedback();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          background: "var(--color-bg-card)",
          borderRadius: 16,
          border: "1px solid var(--color-border-hover)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
          padding: 28,
        }}
      >
        {confirmed ? (
          <ConfirmationScreen onClose={closeDiscountFeedback} />
        ) : (
          <>
            <div
              className="flex items-center justify-between mb-4"
              style={{
                paddingBottom: 12,
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <h2
                id="discount-feedback-title"
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  letterSpacing: "-0.02em",
                }}
              >
                Apply for 30% discount
              </h2>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--color-text-tertiary)",
                  fontVariantNumeric: "tabular-nums",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                Q{stepIdx + 1} of {total}
              </span>
            </div>

            {/* Progress bar */}
            <div
              style={{
                height: 3,
                width: "100%",
                background: "var(--color-fill-secondary)",
                borderRadius: 99,
                overflow: "hidden",
                marginBottom: 22,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${((stepIdx + 1) / total) * 100}%`,
                  background: "var(--color-gold)",
                  transition: "width 220ms cubic-bezier(0.22,1,0.36,1)",
                }}
              />
            </div>

            <p
              style={{
                fontSize: 16,
                fontWeight: 500,
                color: "var(--color-text-primary)",
                marginBottom: 16,
                lineHeight: 1.45,
                letterSpacing: "-0.005em",
              }}
            >
              {question.question_text}
              {!question.is_required && (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-tertiary)",
                    fontWeight: 400,
                    marginLeft: 6,
                  }}
                >
                  (optional)
                </span>
              )}
            </p>

            <QuestionInput
              question={question}
              value={value}
              onChange={(next) =>
                setAnswers((prev) => ({ ...prev, [question.id]: next }))
              }
            />

            {error && (
              <p
                style={{
                  marginTop: 16,
                  fontSize: 13,
                  color: "var(--color-danger, #c84a4a)",
                }}
              >
                {error}
              </p>
            )}

            <div className="flex items-center gap-2 mt-6">
              <button
                type="button"
                onClick={() => setStepIdx((s) => Math.max(0, s - 1))}
                disabled={stepIdx === 0 || submitting}
                style={{
                  padding: "10px 16px",
                  fontSize: 13,
                  background: "transparent",
                  border: "1px solid var(--color-border-hover)",
                  borderRadius: 8,
                  color: "var(--color-text-secondary)",
                  cursor: stepIdx === 0 ? "not-allowed" : "pointer",
                  opacity: stepIdx === 0 ? 0.5 : 1,
                }}
              >
                Back
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  closeDiscountFeedback();
                }}
                style={{
                  padding: "10px 14px",
                  fontSize: 13,
                  background: "transparent",
                  border: "none",
                  color: "var(--color-text-tertiary)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              {isLast ? (
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!canAdvance || submitting}
                  style={primaryBtn(!canAdvance || submitting)}
                >
                  {submitting ? "Submitting…" : "Submit application"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStepIdx((s) => s + 1)}
                  disabled={!canAdvance}
                  style={primaryBtn(!canAdvance)}
                >
                  Continue
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: DiscountFeedbackQuestion;
  value: AnswerValue;
  onChange: (next: AnswerValue) => void;
}) {
  if (question.question_type === "scale") {
    const min = question.scale_min ?? 1;
    const max = question.scale_max ?? 10;
    const cur = value.kind === "scale" ? value.value : null;
    const options = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    return (
      <div className="flex flex-wrap gap-2">
        {options.map((n) => {
          const active = cur === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange({ kind: "scale", value: n })}
              style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                border: active
                  ? "1.5px solid var(--color-gold)"
                  : "1px solid var(--color-border-hover)",
                background: active
                  ? "rgba(230,192,122,0.16)"
                  : "transparent",
                color: active
                  ? "var(--color-gold-light, var(--color-gold))"
                  : "var(--color-text-secondary)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
    );
  }
  if (question.question_type === "multi_choice") {
    const opts = Array.isArray(question.options) ? question.options : [];
    const cur = value.kind === "choice" ? value.value : null;
    return (
      <div className="flex flex-col gap-2">
        {opts.map((opt) => {
          const active = cur === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange({ kind: "choice", value: opt })}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "12px 14px",
                borderRadius: 8,
                border: active
                  ? "1.5px solid var(--color-gold)"
                  : "1px solid var(--color-border-hover)",
                background: active
                  ? "rgba(230,192,122,0.10)"
                  : "var(--color-bg-elevated)",
                color: active
                  ? "var(--color-text-primary)"
                  : "var(--color-text-secondary)",
                fontSize: 14,
                cursor: "pointer",
                lineHeight: 1.4,
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }
  // open_text
  const cur = value.kind === "text" ? value.value : "";
  return (
    <textarea
      autoFocus
      value={cur}
      onChange={(e) => onChange({ kind: "text", value: e.target.value })}
      placeholder="Type your answer here…"
      rows={4}
      style={{
        width: "100%",
        padding: "10px 12px",
        fontSize: 14,
        fontFamily: "inherit",
        lineHeight: 1.5,
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-hover)",
        borderRadius: 8,
        color: "var(--color-text-primary)",
        resize: "vertical",
      }}
    />
  );
}

function ConfirmationScreen({ onClose }: { onClose: () => void }) {
  return (
    <div className="text-center py-6">
      <div style={{ fontSize: 36, marginBottom: 10 }}>🎉</div>
      <h2
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "var(--color-text-primary)",
          marginBottom: 6,
          letterSpacing: "-0.02em",
        }}
      >
        Application submitted
      </h2>
      <p
        style={{
          fontSize: 14,
          color: "var(--color-text-secondary)",
          lineHeight: 1.55,
          marginBottom: 20,
        }}
      >
        The team will review it within 48 hours. You&rsquo;ll see the
        discount on your dashboard once it&rsquo;s approved.
      </p>
      <button
        type="button"
        onClick={onClose}
        style={primaryBtn(false)}
      >
        Got it
      </button>
    </div>
  );
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    background: disabled
      ? "rgba(230,192,122,0.30)"
      : "var(--color-gold)",
    color: disabled ? "rgba(0,0,0,0.45)" : "var(--color-bg-primary)",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    letterSpacing: "-0.005em",
  };
}
