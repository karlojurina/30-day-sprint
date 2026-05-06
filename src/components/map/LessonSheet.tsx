"use client";

import { useEffect, useMemo, useRef } from "react";
import { useStudent } from "@/contexts/StudentContext";
import { LESSON_TYPE_LABELS, LESSON_GROUPS } from "@/lib/constants";
import { useFocusTrap } from "@/lib/useFocusTrap";

interface LessonSheetProps {
  lessonId: string | null;
  onClose: () => void;
  /**
   * Optional handler that switches the lesson without closing the
   * sheet. When provided, the header shows ←/→ chevrons and the
   * sheet listens for arrow keys. Useful for reading lessons
   * sequentially without bouncing back to the map between each.
   */
  onSelectLesson?: (id: string) => void;
}

const GROUP_ID_PREFIX = "group:";

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
export function LessonSheet({ lessonId, onClose, onSelectLesson }: LessonSheetProps) {
  // Group sheet has its own scaffolding (no compound logic, no
  // single-lesson scroll memory). Branch out early.
  if (lessonId && lessonId.startsWith(GROUP_ID_PREFIX)) {
    return (
      <GroupSheet groupId={lessonId.slice(GROUP_ID_PREFIX.length)} onClose={onClose} />
    );
  }

  return <SingleLessonSheet lessonId={lessonId} onClose={onClose} onSelectLesson={onSelectLesson} />;
}

function SingleLessonSheet({ lessonId, onClose, onSelectLesson }: LessonSheetProps) {
  const {
    lessons,
    regions,
    completedLessonIds,
    watchedLessonIds,
    actionShippedLessonIds,
    discountAllLessonsDone,
    discountRequest,
    toggleLesson,
    toggleLessonAction,
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

  // Adjacent lessons for prev/next nav (when onSelectLesson is provided)
  const { prevLesson, nextLesson } = useMemo(() => {
    if (!lesson || !onSelectLesson) {
      return { prevLesson: null, nextLesson: null };
    }
    const sorted = [...lessons].sort(
      (a, b) => a.day - b.day || a.sort_order - b.sort_order
    );
    const idx = sorted.findIndex((l) => l.id === lesson.id);
    return {
      prevLesson: idx > 0 ? sorted[idx - 1] : null,
      nextLesson: idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null,
    };
  }, [lessons, lesson, onSelectLesson]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, lessonId != null);

  // Restore scroll position when reopening a lesson, save on scroll.
  // Per-lesson key in sessionStorage so positions are remembered for
  // the duration of the tab but don't persist across full reloads.
  useEffect(() => {
    if (!lessonId || typeof window === "undefined") return;
    const key = `et.lesson-scroll.${lessonId}`;
    const saved = window.sessionStorage.getItem(key);
    // Wait one frame for the body to mount + render
    const restoreId = window.requestAnimationFrame(() => {
      if (bodyRef.current && saved != null) {
        bodyRef.current.scrollTop = Number(saved);
      }
    });

    const onScroll = () => {
      if (!bodyRef.current) return;
      window.sessionStorage.setItem(key, String(bodyRef.current.scrollTop));
    };
    const node = bodyRef.current;
    node?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(restoreId);
      node?.removeEventListener("scroll", onScroll);
    };
  }, [lessonId]);

  // Keyboard: Esc to close, ←/→ to navigate (when handler provided)
  useEffect(() => {
    if (!lessonId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Don't intercept arrows while typing in textarea/input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.key === "ArrowLeft" && prevLesson && onSelectLesson) {
        e.preventDefault();
        onSelectLesson(prevLesson.id);
      } else if (e.key === "ArrowRight" && nextLesson && onSelectLesson) {
        e.preventDefault();
        onSelectLesson(nextLesson.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lessonId, onClose, prevLesson, nextLesson, onSelectLesson]);

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
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <div className="min-w-0">
              <p
                style={{
                  color: "var(--color-text-tertiary)",
                  fontSize: 12,
                  fontWeight: 500,
                  marginBottom: 6,
                  letterSpacing: "-0.005em",
                }}
              >
                Day {lesson.day} · {region.name} · {LESSON_TYPE_LABELS[lesson.type]}
                {isCompound && " · 2 parts"}
                {isGate && " · Discount gate"}
              </p>
              <h2
                id="lesson-sheet-title"
                style={{
                  color: "var(--color-text-primary)",
                  fontWeight: 600,
                  fontSize: 24,
                  lineHeight: 1.2,
                  letterSpacing: "-0.022em",
                }}
              >
                {lesson.title}
              </h2>
              {lesson.duration_label && (
                <p
                  style={{
                    color: "var(--color-text-tertiary)",
                    fontSize: 13,
                    marginTop: 6,
                    letterSpacing: "-0.005em",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  Duration · {lesson.duration_label}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onSelectLesson && (
                <>
                  <button
                    onClick={() => prevLesson && onSelectLesson(prevLesson.id)}
                    disabled={!prevLesson}
                    className="btn-tinted w-10 h-10 rounded-full flex items-center justify-center"
                    style={{
                      color: "rgba(230,220,200,0.7)",
                      border: "1px solid rgba(230,192,122,0.2)",
                      background: "transparent",
                      opacity: prevLesson ? 1 : 0.3,
                      cursor: prevLesson ? "pointer" : "not-allowed",
                    }}
                    aria-label={
                      prevLesson
                        ? `Previous lesson: ${prevLesson.title}`
                        : "No previous lesson"
                    }
                    title={prevLesson ? `← ${prevLesson.title}` : "Start of expedition"}
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
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => nextLesson && onSelectLesson(nextLesson.id)}
                    disabled={!nextLesson}
                    className="btn-tinted w-10 h-10 rounded-full flex items-center justify-center"
                    style={{
                      color: "rgba(230,220,200,0.7)",
                      border: "1px solid rgba(230,192,122,0.2)",
                      background: "transparent",
                      opacity: nextLesson ? 1 : 0.3,
                      cursor: nextLesson ? "pointer" : "not-allowed",
                    }}
                    aria-label={
                      nextLesson
                        ? `Next lesson: ${nextLesson.title}`
                        : "No next lesson"
                    }
                    title={nextLesson ? `${nextLesson.title} →` : "End of expedition"}
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
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </>
              )}
              <button
                onClick={onClose}
                className="btn-tinted w-10 h-10 rounded-full flex items-center justify-center"
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
          </div>

          {/* Body */}
          <div
            ref={bodyRef}
            className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5"
            style={{ overscrollBehavior: "contain" }}
          >
            {/* Description (plain) */}
            {lesson.description && !isCompound && (
              <p
                style={{
                  color: "var(--color-text-secondary)",
                  fontSize: 15,
                  lineHeight: 1.55,
                  letterSpacing: "-0.006em",
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
                    style={{
                      color: "var(--color-text-primary)",
                      fontWeight: 600,
                      fontSize: 14,
                      marginBottom: 4,
                      letterSpacing: "-0.011em",
                    }}
                  >
                    Watch on Whop
                  </p>
                  <p
                    style={{
                      color: "var(--color-text-tertiary)",
                      fontSize: 13,
                      letterSpacing: "-0.005em",
                    }}
                  >
                    Opens in a new tab · auto-syncs when you come back
                  </p>
                </div>
                {lesson.duration_label && (
                  <span
                    className="absolute bottom-3 right-3 px-2 py-1 rounded"
                    style={{
                      background: "rgba(15,17,21,0.9)",
                      color: "var(--color-gold)",
                      fontSize: 11,
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                      letterSpacing: "-0.005em",
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
                  background: "var(--color-fill-secondary)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <div className="text-center px-6">
                  <p
                    style={{
                      color: "var(--color-text-tertiary)",
                      fontSize: 14,
                      letterSpacing: "-0.005em",
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
                style={{
                  padding: 16,
                  borderRadius: 12,
                  background: "var(--color-fill-secondary)",
                }}
              >
                <p
                  className="section-label"
                  style={{ marginBottom: 8 }}
                >
                  {isCompound ? "Your action item" : "Your mission"}
                </p>
                <p
                  style={{
                    color: "var(--color-text-primary)",
                    fontSize: 14,
                    lineHeight: 1.55,
                    letterSpacing: "-0.006em",
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
                    style={{
                      marginTop: 8,
                      color: "var(--color-gold)",
                      fontSize: 13,
                      fontWeight: 500,
                      letterSpacing: "-0.005em",
                    }}
                  >
                    #{lesson.discord_channel}
                  </p>
                )}
              </div>
            )}

            {/* === Discount gate special CTA === */}
            {isGate && canClaimDiscount && (
              <div
                style={{
                  padding: 20,
                  borderRadius: 12,
                  background: "rgba(200, 157, 85, 0.10)",
                  border: "1px solid rgba(200, 157, 85, 0.30)",
                }}
              >
                <p
                  className="section-label"
                  style={{
                    color: "var(--color-gold-light)",
                    marginBottom: 8,
                  }}
                >
                  Discount unlocked
                </p>
                <p
                  style={{
                    color: "var(--color-text-primary)",
                    fontSize: 16,
                    lineHeight: 1.45,
                    marginBottom: 16,
                    fontWeight: 500,
                    letterSpacing: "-0.011em",
                  }}
                >
                  R1 and R2 done. Apply for your 30% off the next month
                  before the window closes.
                </p>
                <button
                  onClick={async () => {
                    await requestDiscount();
                    if (!isFullyCompleted) {
                      await toggleLesson(lesson.id);
                    }
                  }}
                  className="w-full transition-colors"
                  style={{
                    height: 44,
                    borderRadius: 10,
                    border: "none",
                    background: "var(--color-gold)",
                    color: "#0F1115",
                    fontSize: 14,
                    fontWeight: 600,
                    letterSpacing: "-0.011em",
                    cursor: "pointer",
                  }}
                >
                  Apply for my 30% discount
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
                  className="section-label"
                  style={{
                    color: "var(--color-gold-light)",
                    marginBottom: 8,
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
                  <div className="flex items-center gap-2">
                    <code
                      className="flex-1"
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        background: "rgba(200, 157, 85, 0.12)",
                        color: "var(--color-gold-light)",
                        fontSize: 14,
                        fontFamily: "var(--font-mono)",
                        fontWeight: 600,
                        letterSpacing: "0.04em",
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
                      style={{
                        padding: "8px 14px",
                        borderRadius: 8,
                        border: "none",
                        background: "var(--color-gold)",
                        color: "#0F1115",
                        fontSize: 13,
                        fontWeight: 600,
                        letterSpacing: "-0.005em",
                        cursor: "pointer",
                      }}
                    >
                      Copy
                    </button>
                  </div>
                ) : (
                  <p
                    style={{
                      color: "var(--color-text-secondary)",
                      fontSize: 14,
                      lineHeight: 1.5,
                      letterSpacing: "-0.005em",
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
        style={{
          color: done ? "var(--color-gold)" : "var(--color-text-primary)",
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: "-0.011em",
        }}
      >
        Part {index} · {title}
      </h3>
    </div>
  );
}

/**
 * Group sheet — shown when LessonSheet receives a `group:<id>` lessonId.
 * Lists every sub-lesson in the group with two actions per row:
 *   - Watch  → opens that lesson on Whop in a new tab
 *   - Skip   → marks it skipped (counts toward path; flagged separately)
 * Already-watched lessons show a "Watched" pill; already-skipped show
 * "Skipped" with an undo affordance.
 */
function GroupSheet({
  groupId,
  onClose,
}: {
  groupId: string;
  onClose: () => void;
}) {
  const {
    lessons,
    watchedLessonIds,
    skippedLessonIds,
    completedLessonIds,
    skipLesson,
  } = useStudent();

  const group = LESSON_GROUPS[groupId];

  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const subLessons = useMemo(() => {
    if (!group) return [];
    const byId = new Map(lessons.map((l) => [l.id, l]));
    return group.lessonIds
      .map((id) => byId.get(id))
      .filter((l): l is NonNullable<typeof l> => l != null);
  }, [group, lessons]);

  const totalCount = subLessons.length;
  const decidedCount = subLessons.filter(
    (l) => completedLessonIds.has(l.id)
  ).length;

  if (!group) return null;

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close group"
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
          aria-labelledby="group-sheet-title"
          className="flex flex-col"
          style={{
            pointerEvents: "auto",
            width: "min(720px, 92vw)",
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
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <div className="min-w-0">
              <p
                style={{
                  color: "var(--color-text-tertiary)",
                  fontSize: 12,
                  fontWeight: 500,
                  marginBottom: 6,
                  letterSpacing: "-0.005em",
                }}
              >
                Optional · {totalCount} parts · {decidedCount} of {totalCount} decided
              </p>
              <h2
                id="group-sheet-title"
                style={{
                  color: "var(--color-text-primary)",
                  fontWeight: 600,
                  fontSize: 24,
                  lineHeight: 1.2,
                  letterSpacing: "-0.022em",
                }}
              >
                {group.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--color-text-tertiary)",
                cursor: "pointer",
                fontSize: 20,
                lineHeight: 1,
                padding: 6,
              }}
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div
            ref={bodyRef}
            className="px-5 sm:px-6 py-5 overflow-y-auto"
            style={{ flex: 1 }}
          >
            {group.description && (
              <p
                style={{
                  color: "var(--color-text-secondary)",
                  fontSize: 14,
                  lineHeight: 1.55,
                  letterSpacing: "-0.005em",
                  marginBottom: 20,
                }}
              >
                {group.description}
              </p>
            )}

            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {subLessons.map((sub, i) => {
                const watched = watchedLessonIds.has(sub.id);
                // Watched wins over skipped if both timestamps exist
                const skipped = !watched && skippedLessonIds.has(sub.id);
                const decided = watched || skipped;
                const whopUrl = sub.whop_lesson_id
                  ? WHOP_LESSON_URL(sub.whop_lesson_id)
                  : null;

                return (
                  <li
                    key={sub.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 0",
                      borderBottom:
                        i < subLessons.length - 1
                          ? "1px solid var(--color-border)"
                          : "none",
                    }}
                  >
                    {/* Status indicator */}
                    <div
                      aria-hidden="true"
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: watched
                          ? "var(--color-gold)"
                          : skipped
                            ? "rgba(255,247,235,0.06)"
                            : "transparent",
                        border: watched
                          ? "1px solid var(--color-gold)"
                          : "1px solid var(--color-border-hover)",
                        color: watched
                          ? "var(--color-bg-primary)"
                          : "var(--color-text-tertiary)",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {watched ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : skipped ? (
                        "→"
                      ) : (
                        i + 1
                      )}
                    </div>

                    {/* Title + meta */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          color: decided
                            ? "var(--color-text-secondary)"
                            : "var(--color-text-primary)",
                          fontSize: 15,
                          fontWeight: 500,
                          letterSpacing: "-0.011em",
                          lineHeight: 1.3,
                          marginBottom: 2,
                          textDecoration: skipped ? "line-through" : "none",
                          textDecorationColor: "var(--color-text-quaternary)",
                        }}
                      >
                        {sub.title}
                      </p>
                      <p
                        style={{
                          color: "var(--color-text-tertiary)",
                          fontSize: 12,
                          letterSpacing: "-0.005em",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {sub.duration_label ?? "—"}
                        {watched && " · Watched"}
                        {skipped && " · Skipped"}
                      </p>
                    </div>

                    {/* Per-part actions */}
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      {!watched && (
                        <a
                          href={whopUrl ?? "#"}
                          target={whopUrl ? "_blank" : undefined}
                          rel={whopUrl ? "noopener noreferrer" : undefined}
                          aria-disabled={!whopUrl}
                          style={{
                            padding: "8px 14px",
                            borderRadius: 8,
                            background: "var(--color-gold)",
                            color: "var(--color-bg-primary)",
                            fontSize: 12,
                            fontWeight: 600,
                            letterSpacing: "-0.005em",
                            textDecoration: "none",
                            cursor: whopUrl ? "pointer" : "not-allowed",
                            opacity: whopUrl ? 1 : 0.5,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Watch
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => skipLesson(sub.id)}
                        disabled={watched}
                        style={{
                          padding: "8px 14px",
                          borderRadius: 8,
                          background: skipped
                            ? "rgba(255,247,235,0.10)"
                            : "transparent",
                          color: watched
                            ? "var(--color-text-quaternary)"
                            : skipped
                              ? "var(--color-text-secondary)"
                              : "var(--color-text-secondary)",
                          border: "1px solid var(--color-border-hover)",
                          fontSize: 12,
                          fontWeight: 500,
                          letterSpacing: "-0.005em",
                          cursor: watched ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap",
                        }}
                        aria-label={
                          skipped
                            ? `Un-skip ${sub.title}`
                            : `Skip ${sub.title}`
                        }
                      >
                        {skipped ? "Un-skip" : "Skip"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Footer */}
          <div
            className="px-5 sm:px-6 py-4 shrink-0"
            style={{ borderTop: "1px solid var(--color-border)" }}
          >
            <p
              style={{
                color: "var(--color-text-tertiary)",
                fontSize: 12,
                lineHeight: 1.5,
                letterSpacing: "-0.005em",
              }}
            >
              Watched and skipped both count toward path progress, so the
              region unlocks once you&rsquo;ve made a call on each part.
              You can come back and watch any skipped video later.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
