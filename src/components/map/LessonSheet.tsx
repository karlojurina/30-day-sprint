"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
    completions,
    completedLessonIds,
    watchedLessonIds,
    actionShippedLessonIds,
    skippedLessonIds,
    discountAllLessonsDone,
    discountRequest,
    bountyAccessClaimedAt,
    toggleLesson,
    toggleLessonAction,
    saveDiscordLink,
    skipLesson,
    openDiscountFeedback,
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
  // v59 - mission block hidden when the bounty-access panel handles
  // its own dedicated CTA copy (l057). Avoids the double-render the
  // user reported.
  const isBountyClaimLesson = lesson.id === "l057";
  const showMissionBlock =
    (!isWatchType || isCompound) && !isBountyClaimLesson;
  const hasWhopLesson = Boolean(lesson.whop_lesson_id);
  const whopUrl = hasWhopLesson ? WHOP_LESSON_URL(lesson.whop_lesson_id!) : null;

  const isFullyCompleted = completedLessonIds.has(lesson.id);
  const isWatched = watchedLessonIds.has(lesson.id);
  const isShipped = actionShippedLessonIds.has(lesson.id);
  // Pure action lessons (l049 "Action Item: Static Ads") are marked
  // complete via the single "Mark complete" button. Compound lessons
  // (l018/l020/l022/l024) need the "shipped" half. Either way, the
  // Discord link block appears once the action has been recorded.
  const isActionType = lesson.type === "action";
  const actionRecorded = isCompound ? isShipped : isActionType && isFullyCompleted;
  const completionRow = completions.find((c) => c.lesson_id === lesson.id);
  const savedDiscordLink = completionRow?.discord_message_link ?? null;

  // Discount gate special case
  const isGate = lesson.is_gate === true;
  const canClaimDiscount = isGate && discountAllLessonsDone && !discountRequest;
  const discountClaimed = isGate && Boolean(discountRequest);

  // v42 (v2): l057 — Bounty Access claim. Mirrors the gate-claim
  // pattern but is purely one-click (no eligibility window, no
  // request queue). Claimable once; collapses to a confirmation
  // panel after.
  const isBountyClaim = lesson.id === "l057";
  const canClaimBounty = isBountyClaim && !bountyAccessClaimedAt;
  const bountyClaimed = isBountyClaim && Boolean(bountyAccessClaimedAt);

  // v50 — the old "Finish Program" panel that lived on l058 is gone.
  // l058 itself was dropped as a lesson (its concept moved into the
  // Playbook). v72.8 — the Bounty Access claim celebration overlay
  // was also removed; the lesson sheet's "Claimed on …" panel below
  // is the only post-claim affordance now.

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
        className="fixed inset-0 z-[50] flex items-center justify-center p-0 sm:p-4"
        style={{ pointerEvents: "none" }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="lesson-sheet-title"
          className="flex flex-col w-full sm:w-[min(840px,92vw)] h-full sm:h-auto max-h-[100dvh] sm:max-h-[92vh] rounded-none sm:rounded-2xl"
          style={{
            pointerEvents: "auto",
            background:
              "linear-gradient(180deg, var(--color-bg-card) 0%, var(--color-bg-secondary) 100%)",
            border: "1px solid var(--color-border-hover)",
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
                {region.name} · {LESSON_TYPE_LABELS[lesson.type]}
                {isCompound && " · 2 parts"}
                {lesson.is_optional && " · Optional"}
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
            {/* Description (plain). v59 - hidden for l057 (Bounty
                Access panel below carries the full copy). v74 - also
                hidden for non-watch types (setup / action / quiz)
                because the "Your mission" block below uses
                `lesson.description` as its content - showing both was
                a duplicate Karlo flagged on l001 (the Discord join
                step had identical greyed copy and mission copy). The
                greyed description still shows for pure watch lessons
                (where there's no mission block) and for compound
                lessons (where mission uses action_brief, not
                description). */}
            {lesson.description && isWatchType && !isCompound && !isBountyClaim && (
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
                {/* v74.1 - dropped the standalone "#ad-review" gold
                    tag. The mission description above already mentions
                    "Submit to #ad-review" in its text, so the tag was
                    a visible duplicate Karlo flagged. lesson
                    .discord_channel is still consulted by the
                    DiscordLinkInput below for paste-link validation. */}
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
                  onClick={() => {
                    // Open the 6-question feedback form. The form's submit
                    // path creates the discount_requests row atomically
                    // with the responses — clicking Apply alone no longer
                    // creates a row.
                    openDiscountFeedback();
                    if (!isFullyCompleted) {
                      void toggleLesson(lesson.id);
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
                  {discountRequest.status === "approved" || discountRequest.status === "applied"
                    ? "Discount approved"
                    : discountRequest.status === "rejected"
                      ? "Discount rejected"
                      : "Discount pending review"}
                </p>
                <p
                  style={{
                    color: "var(--color-text-secondary)",
                    fontSize: 14,
                    lineHeight: 1.5,
                    letterSpacing: "-0.005em",
                  }}
                >
                  {discountRequest.status === "approved" || discountRequest.status === "applied"
                    ? "Our team has applied the 30% discount to your Whop subscription. You'll see it on your next renewal, nothing else to do."
                    : discountRequest.status === "rejected"
                      ? discountRequest.rejection_reason ||
                        "The team didn't approve this. Reach out in Discord."
                      : "Thanks for applying. Our team will review it within 48 hours and apply your discount directly to your Whop subscription."}
                </p>
              </div>
            )}

            {/* === Bounty Access application - l057 - v50.5 ===
                Replaces the old self-claim button (v42). Bounty
                Access is now gated by application + approval:
                  1. Student clicks the CTA → Tally form opens
                  2. Karlo/team review the submission
                  3. On approval, Zak's webhook fires our
                     /api/webhooks/adbounty endpoint with the
                     enrollment payload
                  4. We stamp bounty_access_claimed_at, which both
                     unlocks the Playbook (Map 2) AND collapses
                     this panel to the "Claimed" confirmation
                     below.
                There's no pending state on our side - the student
                sees the same Apply CTA until the webhook lands.
                That's intentional: we don't want a stuck "pending"
                that depends on the student's word. */}
            {isBountyClaim && canClaimBounty && (
              <div
                style={{
                  padding: 20,
                  borderRadius: 12,
                  background: "rgba(34, 197, 94, 0.10)",
                  border: "1px solid rgba(34, 197, 94, 0.35)",
                }}
              >
                <p
                  className="section-label"
                  style={{
                    color: "#4ADE80",
                    marginBottom: 8,
                  }}
                >
                  Bounty Access opens here
                </p>
                <p
                  style={{
                    color: "var(--color-text-primary)",
                    fontSize: 16,
                    lineHeight: 1.45,
                    marginBottom: 12,
                    fontWeight: 500,
                    letterSpacing: "-0.011em",
                  }}
                >
                  You&apos;re at the last step of the sprint. Apply for
                  the bounty program below — once our team approves
                  you, you can start getting paid for the ads you make.
                </p>
                <a
                  href="https://tally.so/r/7RxaWR"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    height: 44,
                    borderRadius: 10,
                    background: "#22C55E",
                    color: "#0F1115",
                    fontSize: 14,
                    fontWeight: 600,
                    letterSpacing: "-0.011em",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    textDecoration: "none",
                    transition: "background 150ms cubic-bezier(0.22,1,0.36,1)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#16A34A";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#22C55E";
                  }}
                >
                  Apply for Bounty Access
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M7 17L17 7M9 7h8v8" />
                  </svg>
                </a>
                <p
                  style={{
                    marginTop: 12,
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "rgba(230,220,200,0.55)",
                    letterSpacing: "-0.003em",
                  }}
                >
                  Approval usually takes under 48 hours. This page
                  flips to <span style={{ color: "rgba(230,220,200,0.85)" }}>Claimed</span>{" "}
                  automatically once you&apos;re in — no need to
                  refresh manually.
                </p>
              </div>
            )}

            {isBountyClaim && bountyClaimed && bountyAccessClaimedAt && (
              <div
                className="p-5 rounded-lg"
                style={{
                  background: "rgba(6,12,26,0.6)",
                  border: "1px solid rgba(34, 197, 94, 0.4)",
                }}
              >
                <p
                  className="section-label"
                  style={{
                    color: "#4ADE80",
                    marginBottom: 8,
                  }}
                >
                  Bounty Access claimed
                </p>
                <p
                  style={{
                    color: "var(--color-text-secondary)",
                    fontSize: 14,
                    lineHeight: 1.5,
                    letterSpacing: "-0.005em",
                  }}
                >
                  Claimed on{" "}
                  {new Date(bountyAccessClaimedAt).toLocaleDateString(
                    undefined,
                    {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    },
                  )}
                  . You&apos;re in the program. Head into Discord and pick
                  your first bounty when you&apos;re ready.
                </p>
              </div>
            )}

            {/* v74.3 - Discord link block ALWAYS renders for ad-review
                action items now (was gated on actionRecorded), and the
                Mark shipped button is gated on the link being saved.
                Karlo's call: "they always need to paste it in before
                they can mark it as shipped." Bounty claim (l057) is
                excluded - it has its own Tally CTA, no shipped flow. */}
            {isCompound && !isBountyClaim && (
              <DiscordLinkBlock
                lessonId={lesson.id}
                savedLink={savedDiscordLink}
                onSave={(link) => saveDiscordLink(lesson.id, link)}
              />
            )}

            {/* === Action buttons row === */}
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Compound: ship-the-ad toggle. Bounty claim (l057)
                  uses the Tally CTA above instead. Disabled until the
                  student has saved their #ad-review link. */}
              {isCompound && !isBountyClaim && (() => {
                const canShip = isShipped || Boolean(savedDiscordLink);
                return (
                  <div className="flex-1">
                    <button
                      onClick={() => canShip && toggleLessonAction(lesson.id)}
                      disabled={!canShip}
                      className="w-full px-6 py-3.5 rounded-lg font-semibold transition-colors"
                      style={
                        isShipped
                          ? {
                              background: "rgba(230,192,122,0.14)",
                              color: "rgba(230,220,200,0.88)",
                              border: "1px solid rgba(230,192,122,0.35)",
                              cursor: "pointer",
                            }
                          : canShip
                            ? {
                                background: "var(--color-gold)",
                                color: "var(--color-bg-primary)",
                                fontSize: 15,
                                cursor: "pointer",
                              }
                            : {
                                background: "rgba(255,255,255,0.06)",
                                color: "rgba(255,255,255,0.45)",
                                border: "1px solid rgba(255,255,255,0.12)",
                                fontSize: 15,
                                cursor: "not-allowed",
                              }
                      }
                    >
                      {isShipped ? "Unmark shipped" : "Mark ad shipped"}
                    </button>
                    {!canShip && (
                      <p
                        style={{
                          marginTop: 8,
                          fontSize: 12,
                          color: "var(--color-text-tertiary)",
                          textAlign: "center",
                          letterSpacing: "-0.003em",
                        }}
                      >
                        Paste your #ad-review link above and click Save
                        first.
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Non-compound action/setup: standard mark-complete.
                  Hidden for the bounty-claim lesson (l057) — the
                  Claim button above is the only way to complete it. */}
              {!isCompound && !isWatchType && !canClaimDiscount && !isBountyClaim && (
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

              {/* Optional lesson: SKIP button so the student can bypass
                  it without forfeiting path progress. Skipped lessons
                  still count toward unlock via skipped_at. Only shows
                  when the lesson is flagged is_optional AND the
                  student hasn't already completed/skipped it. */}
              {lesson.is_optional && !isFullyCompleted && (
                <button
                  onClick={() => skipLesson(lesson.id)}
                  className="px-6 py-3.5 rounded-lg font-medium transition-colors"
                  style={{
                    background: skippedLessonIds.has(lesson.id)
                      ? "rgba(255,255,255,0.08)"
                      : "transparent",
                    color: "var(--color-text-secondary)",
                    border: "1px solid var(--color-border-hover)",
                    fontSize: 14,
                    letterSpacing: "-0.005em",
                  }}
                  title="This lesson is optional - skip without losing progress."
                >
                  {skippedLessonIds.has(lesson.id) ? "Un-skip" : "Skip - it's optional"}
                </button>
              )}
            </div>

            {/* v74.3 - DiscordLinkBlock moved ABOVE the action button
                row + always renders for compound ad-review lessons.
                The mark-shipped button is now gated on the saved link,
                not the other way around. */}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Inline form letting the student paste the Discord #ad-review message
 * link after they shipped their ad. See lovro-brief/04-link-capture.md.
 */
function DiscordLinkBlock({
  lessonId,
  savedLink,
  onSave,
}: {
  lessonId: string;
  savedLink: string | null;
  onSave: (link: string | null) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(!savedLink);
  const [draft, setDraft] = useState(savedLink ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Reset when lesson changes
  useEffect(() => {
    setDraft(savedLink ?? "");
    setEditing(!savedLink);
    setError(null);
  }, [lessonId, savedLink]);

  const saved = savedLink != null && savedLink.length > 0;

  async function handleSave() {
    setError(null);
    setSaving(true);
    const trimmed = draft.trim();
    const result = await onSave(trimmed.length === 0 ? null : trimmed);
    setSaving(false);
    if (result) {
      setError(result);
    } else {
      setEditing(false);
    }
  }

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        background: "var(--color-fill-secondary)",
        marginTop: 4,
      }}
    >
      <p className="section-label" style={{ marginBottom: 6 }}>
        Discord submission link{" "}
        <span
          style={{
            color: "var(--color-text-tertiary)",
            fontWeight: 400,
            textTransform: "none",
            letterSpacing: 0,
          }}
        >
          (optional)
        </span>
      </p>

      {saved && !editing ? (
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={savedLink ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--color-gold-light)",
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "underline",
              wordBreak: "break-all",
              flex: 1,
              minWidth: 0,
            }}
          >
            ✓ Link saved · open in Discord
          </a>
          <button
            onClick={() => {
              setEditing(true);
              setDraft(savedLink ?? "");
            }}
            style={{
              fontSize: 12,
              padding: "6px 12px",
              background: "transparent",
              border: "1px solid var(--color-border-hover)",
              borderRadius: 6,
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            Edit link
          </button>
        </div>
      ) : (
        <>
          <p
            style={{
              fontSize: 12,
              color: "var(--color-text-secondary)",
              marginBottom: 8,
              lineHeight: 1.4,
            }}
          >
            Paste the link to your message in #ad-review so the team can
            find your submission without scrolling.{" "}
            <button
              onClick={() => setShowHelp((s) => !s)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: "var(--color-gold-light)",
                fontSize: 12,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {showHelp ? "Hide steps" : "How do I get the link?"}
            </button>
          </p>
          {showHelp && (
            <ol
              style={{
                margin: "0 0 8px 16px",
                padding: 0,
                fontSize: 12,
                color: "var(--color-text-secondary)",
                lineHeight: 1.55,
              }}
            >
              <li>Right-click (or long-press on mobile) your message in #ad-review</li>
              <li>Click &quot;Copy Message Link&quot;</li>
              <li>Paste it below and hit Save</li>
            </ol>
          )}
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://discord.com/channels/…"
              style={{
                flex: 1,
                minWidth: 200,
                padding: "8px 10px",
                fontSize: 12.5,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                color: "var(--color-text-primary)",
              }}
            />
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 6,
                background: "var(--color-gold)",
                border: "none",
                color: "var(--color-bg-primary)",
                cursor: saving ? "wait" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : "Save link"}
            </button>
            {saved && editing && (
              <button
                onClick={() => {
                  setDraft(savedLink ?? "");
                  setEditing(false);
                  setError(null);
                }}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  background: "transparent",
                  border: "1px solid var(--color-border-hover)",
                  borderRadius: 6,
                  color: "var(--color-text-tertiary)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            )}
          </div>
          {error && (
            <p
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "var(--color-danger, #c84a4a)",
              }}
            >
              {error}
            </p>
          )}
        </>
      )}
    </div>
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
        className="fixed inset-0 z-[50] flex items-center justify-center p-0 sm:p-4"
        style={{ pointerEvents: "none" }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-sheet-title"
          className="flex flex-col w-full sm:w-[min(720px,92vw)] h-full sm:h-auto max-h-[100dvh] sm:max-h-[92vh] rounded-none sm:rounded-2xl"
          style={{
            pointerEvents: "auto",
            background:
              "linear-gradient(180deg, var(--color-bg-card) 0%, var(--color-bg-secondary) 100%)",
            border: "1px solid var(--color-border-hover)",
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
                      {(watched || skipped) && (
                        <p
                          style={{
                            color: "var(--color-text-tertiary)",
                            fontSize: 12,
                            letterSpacing: "-0.005em",
                          }}
                        >
                          {watched ? "Watched" : "Skipped"}
                        </p>
                      )}
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
