"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { SPEC_EASE } from "@/lib/motion";
import type { Quiz, QuizQuestion } from "@/types/database";

interface QuizViewProps {
  quiz: Quiz;
  questions: QuizQuestion[];
  open: boolean;
  onClose: () => void;
  onSubmit: (
    quizId: string,
    selections: Record<string, number>
  ) => Promise<{
    score: number;
    total: number;
    passed: boolean;
    answers: { questionId: string; selectedIndex: number; correct: boolean }[];
  }>;
}

type Phase = "answering" | "feedback" | "results";

export function QuizView({
  quiz,
  questions,
  open,
  onClose,
  onSubmit,
}: QuizViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<Phase>("answering");
  const [result, setResult] = useState<{
    score: number;
    total: number;
    passed: boolean;
    answers: { questionId: string; selectedIndex: number; correct: boolean }[];
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset state when quiz changes
  useEffect(() => {
    if (open) {
      setCurrentIndex(0);
      setSelections({});
      setPhase("answering");
      setResult(null);
    }
  }, [open, quiz.id]);

  // Prevent body scroll
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  const currentQuestion = questions[currentIndex];
  const selectedAnswer = currentQuestion ? selections[currentQuestion.id] : undefined;
  const isLastQuestion = currentIndex === questions.length - 1;

  const handleSelect = useCallback(
    (optionIndex: number) => {
      if (phase !== "answering" || !currentQuestion) return;
      setSelections((prev) => ({
        ...prev,
        [currentQuestion.id]: optionIndex,
      }));
      // Show feedback immediately
      setPhase("feedback");
    },
    [phase, currentQuestion]
  );

  const handleNext = useCallback(async () => {
    if (isLastQuestion) {
      // Submit quiz
      setSubmitting(true);
      try {
        const res = await onSubmit(quiz.id, selections);
        setResult(res);
        setPhase("results");
      } catch {
        // Still show results locally
        setPhase("results");
      }
      setSubmitting(false);
    } else {
      setCurrentIndex((i) => i + 1);
      setPhase("answering");
    }
  }, [isLastQuestion, selections, quiz.id, onSubmit]);

  const handleRetry = useCallback(() => {
    setCurrentIndex(0);
    setSelections({});
    setPhase("answering");
    setResult(null);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-[var(--color-bg-primary)]/70 backdrop-blur-md"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.35, ease: SPEC_EASE }}
            className="
              fixed left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2
              z-50 w-[95%] sm:w-[560px] max-h-[85vh] overflow-y-auto
              bg-[var(--color-bg-card)] border border-[var(--color-border-strong)]
              rounded-2xl shadow-[0_0_60px_rgba(0,0,0,0.5)]
            "
          >
            <div className="p-6 sm:p-8">
              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {phase === "results" ? (
                <ResultsView
                  quiz={quiz}
                  result={result}
                  onRetry={handleRetry}
                  onClose={onClose}
                />
              ) : (
                <>
                  {/* Header */}
                  <div className="mb-6">
                    <span className="mono-label-accent">{quiz.title}</span>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="mono-label">
                        Question {currentIndex + 1} / {questions.length}
                      </span>
                      {/* Progress dots */}
                      <div className="flex gap-1 ml-auto">
                        {questions.map((_, i) => (
                          <div
                            key={i}
                            className="w-2 h-2 rounded-full transition-colors"
                            style={{
                              backgroundColor:
                                i < currentIndex
                                  ? "var(--color-accent)"
                                  : i === currentIndex
                                    ? "var(--color-text-primary)"
                                    : "var(--color-bg-elevated)",
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Question */}
                  {currentQuestion && (
                    <div>
                      <h3 className="text-[18px] font-semibold text-[var(--color-text-primary)] mb-6 leading-relaxed">
                        {currentQuestion.question}
                      </h3>

                      {/* Options */}
                      <div className="space-y-3">
                        {currentQuestion.options.map((option: string, i: number) => {
                          const isSelected = selectedAnswer === i;
                          const showFeedback = phase === "feedback";
                          const isCorrect = i === currentQuestion.correct_index;

                          let borderColor = "var(--color-border)";
                          let bgColor = "transparent";
                          if (showFeedback && isSelected && isCorrect) {
                            borderColor = "var(--color-success)";
                            bgColor = "rgba(107, 198, 110, 0.1)";
                          } else if (showFeedback && isSelected && !isCorrect) {
                            borderColor = "var(--color-danger)";
                            bgColor = "rgba(240, 84, 84, 0.1)";
                          } else if (showFeedback && isCorrect) {
                            borderColor = "var(--color-success)";
                            bgColor = "rgba(107, 198, 110, 0.05)";
                          } else if (isSelected) {
                            borderColor = "var(--color-accent)";
                          }

                          return (
                            <button
                              key={i}
                              onClick={() => handleSelect(i)}
                              disabled={phase === "feedback"}
                              className="
                                w-full text-left p-4 rounded-xl
                                border transition-all duration-200
                                text-[14px] leading-relaxed
                              "
                              style={{
                                borderColor,
                                backgroundColor: bgColor,
                                color: "var(--color-text-primary)",
                              }}
                            >
                              <span className="font-mono text-[12px] font-semibold text-[var(--color-text-tertiary)] mr-2">
                                {String.fromCharCode(65 + i)}.
                              </span>
                              {option}
                            </button>
                          );
                        })}
                      </div>

                      {/* Feedback + explanation */}
                      {phase === "feedback" && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-4"
                        >
                          {selectedAnswer === currentQuestion.correct_index ? (
                            <p className="text-[14px] font-semibold" style={{ color: "var(--color-success)" }}>
                              Correct!
                            </p>
                          ) : (
                            <p className="text-[14px] font-semibold" style={{ color: "var(--color-danger)" }}>
                              Not quite.
                            </p>
                          )}
                          {currentQuestion.explanation && (
                            <p className="text-[13px] text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                              {currentQuestion.explanation}
                            </p>
                          )}

                          <button
                            onClick={handleNext}
                            disabled={submitting}
                            className="
                              mt-4 w-full px-6 py-3 rounded-xl
                              bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)]
                              text-[var(--color-bg-primary)] font-semibold text-[15px]
                              transition-colors disabled:opacity-60
                            "
                          >
                            {submitting
                              ? "Submitting..."
                              : isLastQuestion
                                ? "See results"
                                : "Next question"}
                          </button>
                        </motion.div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function ResultsView({
  quiz,
  result,
  onRetry,
  onClose,
}: {
  quiz: Quiz;
  result: { score: number; total: number; passed: boolean } | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const score = result?.score ?? 0;
  const total = result?.total ?? 0;
  const passed = result?.passed ?? false;
  const percent = total > 0 ? Math.round((score / total) * 100) : 0;

  return (
    <div className="text-center py-4">
      <p className="mono-label-accent mb-4">
        {quiz.title} — Results
      </p>

      <h2
        className="display-heading text-[48px] mb-2"
        style={{
          color: passed ? "var(--color-success)" : "var(--color-danger)",
        }}
      >
        {score}/{total}
      </h2>
      <p className="text-[14px] text-[var(--color-text-secondary)] mb-2">
        {percent}%
      </p>

      <p
        className="text-[16px] font-semibold mb-6"
        style={{
          color: passed ? "var(--color-success)" : "var(--color-text-secondary)",
        }}
      >
        {passed ? "You passed!" : `You need ${quiz.passing_percent}% to pass.`}
      </p>

      {passed ? (
        <button
          onClick={onClose}
          className="
            w-full px-6 py-3.5 rounded-xl
            bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)]
            text-[var(--color-bg-primary)] font-semibold text-[15px]
            transition-colors
          "
        >
          Continue &rarr;
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            Not quite &mdash; review the section and try again. No rush.
          </p>
          <button
            onClick={onRetry}
            className="
              w-full px-6 py-3.5 rounded-xl
              bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)]
              text-[var(--color-bg-primary)] font-semibold text-[15px]
              transition-colors
            "
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
