"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useStudent } from "@/contexts/StudentContext";
import { LESSON_TYPE_LABELS } from "@/lib/constants";
import { useFocusTrap } from "@/lib/useFocusTrap";

interface LessonSheetProps {
  lessonId: string | null;
  onClose: () => void;
}

const WHOP_LESSON_URL = (lessonId: string) =>
  `https://whop.com/joined/ecomtalent/knowledge-KBhMkENW27qoZB/app/courses/cors_6cYEj5qoUcmbcpSryUrfiR/lessons/${lessonId}/`;

/**
 * Centered modal for a single lesson.
 * - Pure watch: Whop link card. Auto-completes via Whop sync.
 * - Pure action/setup: description + mark-complete button.
 * - Compound (requires_action=true): BOTH the Whop watch card AND a
 *   "Ship the ad" section with its own toggle for the action half.
 * - Discount gate (is_gate=true): when prerequisites met, swaps the
 *   mark-complete button for a "Claim my 30% discount" CTA that calls
 *   requestDiscount().
 * - All types: notes textarea (auto-saving).
 */
export function LessonSheet({ lessonId, onClose }: LessonSheetProps) {
  const {
    lessons,
    regions,
    completedLessonIds,
    watchedLessonIds,
    actionShippedLessonIds,
    discountAllLessonsDone,
    discountRequest,
    lessonNotes,
    toggleLesson,
    toggleLessonAction,
    saveLessonNote,
    requestDiscount,
  } = useStudent();

  const lesson = useMemo(
    () => lessons.find((l) => l.id === lessonId) ?? null,
    [lessons, lessonId]
  );
  const region = useMemo(
    () => (lesson ? regions.find((r) => r.id === lesson.region_id) ?? null : null),
    [regions, lesson]
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, lessonId != null);

  // Close on Escape
  useEffect(() => {
    if (!lessonId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lessonId, onClose]);

  // Prevent body scroll
  useEffect(() => {
    if (lessonId) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [lessonId]);

  if (!lesson || !region) return null;

  const isCompound = lesson.requires_action;
  const isWatchType = lesson.type === "watch";
  const showWatchCard = isWatchType; // includes compound (which is type='watch' + requires_action)
  const showMissionBlock = !isWatchType || isCompound;
  const hasWhopLesson = Boolean(lesson.whop_lesson_id);
  const whopUrl = hasWhopLesson ? WHOP_LESSON_URL(lesson.whop_lesson_id!) : null;

  const isFullyCompleted = completedLessonIds.has(lesson.id);
  const isWatched = watchedLessonIds.has(lesson.id);
  const isShipped = actionShippedLessonIds.has(lesson.id);

  // Discount gate special case
  const isGate = lesson.is_gate === true;
  const canClaimDiscount = isGate && discountAllLessonsDone && !discountRequest;
  const discountClaimed = isGate && Boolean(discountRequest);

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close lesson"
        className="fixed inset-0 z-[45] cursor-default"
        style={{
          background: "rgba(6,12,26,0.78)",
          backdropFilter: "blur(6px)",
          animation: "overlay-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
          border: "none",
          padding: 0,
        }}
      />

      <div
        className="fixed inset-0 z-[50] flex items-center justify-center p-4"
        style={{ pointerEvents: "none" }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="lesson-sheet-title"
          className="flex flex-col"
          style={{
            pointerEvents: "auto",
            width: "min(840px, 92vw)",
            maxHeight: "92vh",
            background:
              "linear-gradient(180deg, var(--color-bg-card) 0%, var(--color-bg-secondary) 100%)",
            border: "1px solid var(--color-border-hover)",
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: "0 40px 80px rgba(0,0,0,0.6)",
            animation: "fade-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
          }}
        >
          {/* Header */}
          <div
            className="flex items-start justify-between p-5 sm:p-6 shrink-0"
            style={{ borderBottom: "1px solid rgba(230,192,122,0.18)" }}
          >
            <div className="min-w-0">
              <p
                className="font-mono uppercase tracking-widest mb-1"
                style={{
                  color: "rgba(230,192,122,0.85)",
                  letterSpacing: "0.18em",
                  fontSize: 11,
                }}
              >
                Day {lesson.day} · {region.name} · {LESSON_TYPE_LABELS[lesson.type]}
                {isCompound && " · 2 parts"}
                {isGate && " · Discount gate"}
              </p>
              <h2
                id="lesson-sheet-title"
                className="italic leading-tight"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--color-ink)",
                  fontWeight: 500,
                  fontSize: 28,
                }}
              >
                {lesson.title}
              </h2>
              {lesson.duration_label && (
                <p
                  className="font-mono mt-1.5"
                  style={{
                    color: "var(--color-ink-dim)",
                    fontSize: 12,
                    letterSpacing: "0.06em",
                  }}
                >
                  Duration · {lesson.duration_label}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="btn-tinted w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              style={{
                color: "rgba(230,220,200,0.7)",
                border: "1px solid rgba(230,192,122,0.2)",
                background: "transparent",
              }}
              aria-label="Close lesson"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div
            className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5"
            style={{ overscrollBehavior: "contain" }}
          >
            {/* Description (plain) */}
            {lesson.description && !isCompound && (
              <p
                className="leading-relaxed"
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  color: "rgba(230,220,200,0.88)",
                  fontSize: 15,
                }}
              >
                {lesson.description}
              </p>
            )}

            {/* === Compound lesson: Part 1 — Watch === */}
            {isCompound && (
              <CompoundPartHeader
                index={1}
                title="Watch the briefing"
                done={isWatched}
              />
            )}

            {/* Watch card (also used for non-compound watch lessons) */}
            {showWatchCard && hasWhopLesson && (
              <a
                href={whopUrl!}
                target="_blank"
                rel="noopener"
                className="watch-link relative rounded-lg overflow-hidden flex items-center justify-center group"
                style={{
                  aspectRatio: "16 / 9",
                  background:
                    "radial-gradient(ellipse 50% 55% at 50% 50%, rgba(77,206,196,0.14) 0%, transparent 70%), linear-gradient(135deg, var(--color-bg-secondary) 0%, var(--color-bg-elevated) 100%)",
                  border: "1px solid rgba(230,192,122,0.3)",
                  textDecoration: "none",
                  transition: "border-color 200ms cubic-bezier(0.22,1,0.36,1)",
                }}
              >
                <div
                  className="absolute inset-0 pointer-events-none opacity-30"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(77,206,196,0.04) 3px, rgba(77,206,196,0.04) 4px)",
                  }}
                />
                <div className="relative text-center px-6 z-10">
                  <div
                    className="mx-auto mb-4 w-20 h-20 rounded-full flex items-center justify-center transition-transform"
                    style={{
                      background: "rgba(230,192,122,0.22)",
                      border: "2px solid var(--color-gold)",
                      boxShadow: "0 0 40px rgba(230,192,122,0.3)",
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="w-9 h-9 ml-1"
                      fill="var(--color-gold-light)"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                  <p
                    className="font-mono uppercase mb-1"
                    style={{
                      color: "var(--color-gold)",
                      letterSpacing: "0.22em",
                      fontSize: 11,
                    }}
                  >
                    Watch on Whop
                  </p>
                  <p
                    className="italic"
                    style={{
                      fontFamily: "var(--font-display)",
                      color: "var(--color-ink-dim)",
                      fontSize: 13,
                    }}
                  >
                    Opens in a new tab · auto-syncs when you come back
                  </p>
                </div>
                {lesson.duration_label && (
                  <span
                    className="absolute bottom-3 right-3 font-mono text-[11px] px-2 py-1 rounded"
                    style={{
                      background: "rgba(6,12,26,0.9)",
                      color: "var(--color-gold)",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {lesson.duration_label}
                  </span>
                )}
              </a>
            )}

            {showWatchCard && !hasWhopLesson && (
              <div
                className="relative rounded-lg overflow-hidden flex items-center justify-center"
                style={{
                  aspectRatio: "16 / 9",
                  background: "rgba(6,12,26,0.9)",
                  border: "1px solid rgba(230,192,122,0.2)",
                }}
              >
                <div className="text-center px-6">
                  <p
                    className="italic"
                    style={{
                      fontFamily: "var(--font-display)",
                      color: "var(--color-ink-dim)",
                      fontSize: 14,
                    }}
                  >
                    Video content coming soon.
                  </p>
                </div>
              </div>
            )}

            {/* === Compound lesson: Part 2 — Ship === */}
            {isCompound && (
              <CompoundPartHeader
                index={2}
                title="Ship the ad"
                done={isShipped}
              />
            )}

            {/* Mission block — for any non-watch OR compound lesson */}
            {showMissionBlock && (
              <div
                className="p-4 rounded-lg"
                style={{
                  background: "rgba(6,12,26,0.55)",
                  border: "1px solid rgba(230,192,122,0.16)",
                }}
              >
                <p
                  className="font-mono uppercase tracking-widest mb-2"
                  style={{
                    color: "var(--color-gold-light)",
                    letterSpacing: "0.18em",
                    fontSize: 11,
                  }}
                >
                  {isCompound ? "Your action item" : "Your mission"}
                </p>
                <p
                  style={{
                    color: "var(--color-ink)",
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}
                >
                  {isCompound
                    ? lesson.action_brief ??
                      "Finish this on your own, then check it off below."
                    : lesson.description ??
                      "Finish this on your own, then mark it done below."}
                </p>
                {lesson.discord_channel && (
                  <p
                    className="mt-2 font-mono"
                    style={{ color: "var(--color-gold)", fontSize: 13 }}
                  >
                    #{lesson.discord_channel}
                  </p>
                )}
              </div>
            )}

            {/* === Discount gate special CTA === */}
            {isGate && canClaimDiscount && (
              <div
                className="p-5 rounded-lg"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(230,192,122,0.18), rgba(230,192,122,0.06))",
                  border: "1px solid var(--color-gold)",
                  boxShadow: "0 0 30px rgba(230,192,122,0.18)",
                }}
              >
                <p
                  className="font-mono uppercase tracking-widest mb-2"
                  style={{
                    color: "var(--color-gold)",
                    letterSpacing: "0.2em",
                    fontSize: 11,
                  }}
                >
                  Discount unlocked
                </p>
                <p
                  className="italic mb-4"
                  style={{
                    fontFamily: "var(--font-display)",
                    color: "var(--color-ink)",
                    fontSize: 18,
                    lineHeight: 1.4,
                  }}
                >
                  R1 and R2 done. You earned it. Claim your 30% off the
                  next month before the window closes.
                </p>
                <button
                  onClick={async () => {
                    await requestDiscount();
                    // Auto-mark the gate lesson complete on claim
                    if (!isFullyCompleted) {
                      await toggleLesson(lesson.id);
                    }
                  }}
                  className="w-full px-6 py-3.5 rounded-lg font-semibold transition-colors"
                  style={{
                    background: "var(--color-gold)",
                    color: "var(--color-bg-primary)",
                    fontSize: 15,
                  }}
                >
                  Claim my 30% discount
                </button>
              </div>
            )}

            {isGate && discountClaimed && discountRequest && (
              <div
                className="p-5 rounded-lg"
                style={{
                  background: "rgba(6,12,26,0.6)",
                  border: "1px solid rgba(230,192,122,0.4)",
                }}
              >
                <p
                  className="font-mono uppercase tracking-widest mb-2"
                  style={{
                    color: "var(--color-gold)",
                    letterSpacing: "0.2em",
                    fontSize: 11,
                  }}
                >
                  {discountRequest.status === "approved"
                    ? "Discount approved"
                    : discountRequest.status === "rejected"
                      ? "Discount rejected"
                      : "Discount pending review"}
                </p>
                {discountRequest.status === "approved" &&
                discountRequest.promo_code ? (
                  <div className="flex items-center gap-3">
                    <code
                      className="px-3 py-2 rounded font-mono text-sm flex-1"
                      style={{
                        background: "rgba(230,192,122,0.12)",
                        color: "var(--color-gold-light)",
                        letterSpacing: "0.08em",
                      }}
                    >
                      {discountRequest.promo_code}
                    </code>
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(
                          discountRequest.promo_code ?? ""
                        )
                      }
                      className="px-3 py-2 rounded font-mono text-xs"
                      style={{
                        background: "var(--color-gold)",
                        color: "var(--color-bg-primary)",
                      }}
                    >
                      Copy
                    </button>
                  </div>
                ) : (
                  <p
                    className="italic"
                    style={{
                      fontFamily: "var(--font-display)",
                      color: "var(--color-ink-dim)",
                      fontSize: 14,
                    }}
                  >
                    {discountRequest.status === "rejected"
                      ? discountRequest.rejection_reason ||
                        "The team didn't approve this — reach out in Discord."
                      : "We'll review it within 24 hours and your code will appear here."}
                  </p>
                )}
              </div>
            )}

            {/* === Action buttons row === */}
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Compound: ship-the-ad toggle */}
              {isCompound && (
                <button
                  onClick={() => toggleLessonAction(lesson.id)}
                  className="flex-1 px-6 py-3.5 rounded-lg font-semibold transition-colors"
                  style={
                    isShipped
                      ? {
                          background: "rgba(230,192,122,0.14)",
                          color: "rgba(230,220,200,0.88)",
                          border: "1px solid rgba(230,192,122,0.35)",
                        }
                      : {
                          background: "var(--color-gold)",
                          color: "var(--color-bg-primary)",
                          fontSize: 15,
                        }
                  }
                >
                  {isShipped ? "Unmark shipped" : "Mark ad shipped"}
                </button>
              )}

              {/* Non-compound action/setup: standard mark-complete */}
              {!isCompound && !isWatchType && !canClaimDiscount && (
                <button
                  onClick={() => toggleLesson(lesson.id)}
                  className="flex-1 px-6 py-3.5 rounded-lg font-semibold transition-colors"
                  style={
                    isFullyCompleted
                      ? {
                          background: "rgba(230,192,122,0.14)",
                          color: "rgba(230,220,200,0.88)",
                          border: "1px solid rgba(230,192,122,0.35)",
                        }
                      : {
                          background: "var(--color-gold)",
                          color: "var(--color-bg-primary)",
                          fontSize: 15,
                        }
                  }
                >
                  {isFullyCompleted ? "Undo completion" : "Mark complete"}
                </button>
              )}
            </div>

            {/* Lesson notes */}
            <LessonNotes
              lessonId={lesson.id}
              initial={lessonNotes[lesson.id] ?? ""}
              onSave={saveLessonNote}
            />
          </div>
        </div>
      </div>
    </>
  );
}

/** Small heading row showing a numbered step + a checkmark when done */
function CompoundPartHeader({
  index,
  title,
  done,
}: {
  index: number;
  title: string;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="w-6 h-6 rounded-full flex items-center justify-center font-mono shrink-0"
        style={{
          background: done
            ? "var(--color-gold)"
            : "rgba(230,192,122,0.14)",
          color: done ? "var(--color-bg-primary)" : "var(--color-gold)",
          border: done
            ? "1px solid var(--color-gold)"
            : "1px solid rgba(230,192,122,0.4)",
          fontSize: 11,
        }}
      >
        {done ? (
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        ) : (
          index
        )}
      </span>
      <h3
        className="font-mono uppercase tracking-widest"
        style={{
          color: done ? "var(--color-gold)" : "var(--color-ink-dim)",
          letterSpacing: "0.16em",
          fontSize: 12,
        }}
      >
        Part {index} · {title}
      </h3>
    </div>
  );
}

interface LessonNotesProps {
  lessonId: string;
  initial: string;
  onSave: (lessonId: string, content: string) => Promise<void>;
}

function LessonNotes({ lessonId, initial, onSave }: LessonNotesProps) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initial);

  useEffect(() => {
    setValue(initial);
    lastSaved.current = initial;
  }, [lessonId, initial]);

  const handleChange = useCallback(
    (v: string) => {
      setValue(v);
      if (timer.current) clearTimeout(timer.current);
      if (v.trim() === lastSaved.current.trim()) return;
      setStatus("saving");
      timer.current = setTimeout(async () => {
        await onSave(lessonId, v);
        lastSaved.current = v;
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 1600);
      }, 800);
    },
    [lessonId, onSave]
  );

  const notesId = `lesson-notes-${lessonId}`;
  const statusId = `${notesId}-status`;
  return (
    <div
      className="p-4 rounded-lg"
      style={{
        background: "rgba(6,12,26,0.55)",
        border: "1px solid rgba(230,192,122,0.16)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <label
          htmlFor={notesId}
          className="font-mono uppercase tracking-widest"
          style={{
            color: "var(--color-ink-dim)",
            letterSpacing: "0.16em",
            fontSize: 11,
          }}
        >
          Your notes
        </label>
        <span
          id={statusId}
          role="status"
          aria-live="polite"
          className="font-mono"
          style={{
            color:
              status === "saved" ? "var(--color-gold)" : "var(--color-ink-dim)",
            fontSize: 11,
            minHeight: 14,
          }}
        >
          {status === "saving" ? "saving…" : status === "saved" ? "saved" : ""}
        </span>
      </div>
      <textarea
        id={notesId}
        rows={4}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Write down what stood out, what you'll try next, or anything to remember."
        aria-describedby={statusId}
        className="w-full resize-none outline-none bg-transparent leading-relaxed"
        style={{ color: "var(--color-ink)", fontSize: 14 }}
      />
    </div>
  );
}
