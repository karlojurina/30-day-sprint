"use client";

/**
 * Final 30-day graduation modal. Renders the existing `monthReview`
 * data that the StudentContext already fetches but didn't have a UI
 * for. Shows once when the student crosses day-28 with non-null
 * monthReview data; persistence stamps a flag so it doesn't re-fire.
 */

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SPEC_EASE } from "@/lib/motion";
import { useFocusTrap } from "@/lib/useFocusTrap";

interface MonthReview {
  total_lessons_completed: number;
  total_lessons: number;
  longest_streak: number;
  ad_submissions: number;
  discount_earned: boolean;
  notes_count: number;
  days_to_finish: number | null;
}

interface Props {
  open: boolean;
  studentName: string;
  monthReview: MonthReview | null;
  onDismiss: () => void;
  onDownloadJournal?: () => void;
}

export function GraduationModal({
  open,
  studentName,
  monthReview,
  onDismiss,
  onDownloadJournal,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [open, onDismiss]);

  return (
    <AnimatePresence>
      {open && monthReview && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="fixed inset-0 z-[80]"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(6,12,26,0.92) 0%, rgba(6,12,26,1) 100%)",
              backdropFilter: "blur(14px)",
            }}
          />

          {/* Animated background path */}
          <svg
            aria-hidden
            className="fixed inset-0 z-[81] pointer-events-none"
            width="100%"
            height="100%"
            viewBox="0 0 1200 600"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <linearGradient id="grad-path" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(230, 192, 122, 0.0)" />
                <stop offset="50%" stopColor="rgba(230, 192, 122, 0.6)" />
                <stop offset="100%" stopColor="rgba(230, 192, 122, 0.0)" />
              </linearGradient>
            </defs>
            <motion.path
              d="M 50 480 Q 250 280, 450 360 T 850 320 T 1150 200"
              fill="none"
              stroke="url(#grad-path)"
              strokeWidth={2}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.7 }}
              transition={{ duration: 2.5, delay: 0.4, ease: SPEC_EASE }}
            />
          </svg>

          <div
            className="fixed inset-0 z-[85] flex items-center justify-center p-4 overflow-y-auto"
            style={{ pointerEvents: "none" }}
          >
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="graduation-title"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{
                duration: 0.7,
                delay: 0.2,
                ease: SPEC_EASE,
              }}
              style={{
                pointerEvents: "auto",
                width: "min(640px, 92vw)",
                maxHeight: "92vh",
                background:
                  "linear-gradient(180deg, var(--color-bg-card) 0%, var(--color-bg-secondary) 100%)",
                border: "1px solid var(--color-gold)",
                borderRadius: 20,
                padding: "44px 36px 32px",
                boxShadow:
                  "0 50px 100px rgba(0,0,0,0.7), 0 0 80px rgba(230,192,122,0.16)",
              }}
              className="text-center"
            >
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.6 }}
                className="font-mono uppercase block mb-3"
                style={{
                  color: "var(--color-gold)",
                  letterSpacing: "0.32em",
                  fontSize: 11,
                }}
              >
                30 days · expedition complete
              </motion.span>

              <motion.h2
                id="graduation-title"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.6,
                  delay: 0.8,
                  ease: SPEC_EASE,
                }}
                className="italic mb-4"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--color-ink)",
                  fontSize: 44,
                  fontWeight: 500,
                  lineHeight: 1.05,
                }}
              >
                You finished{studentName ? `, ${studentName}` : ""}.
              </motion.h2>

              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.95 }}
                style={{
                  color: "rgba(230,220,200,0.7)",
                  fontSize: 15,
                  lineHeight: 1.6,
                  marginBottom: 28,
                  maxWidth: 460,
                  marginLeft: "auto",
                  marginRight: "auto",
                }}
              >
                Here&rsquo;s what 30 days looked like for you. Take the work,
                the receipts, and keep going.
              </motion.p>

              {/* Stats grid */}
              <motion.div
                initial="hidden"
                animate="visible"
                variants={{
                  hidden: {},
                  visible: { transition: { staggerChildren: 0.1, delayChildren: 1.05 } },
                }}
                className="grid grid-cols-3 gap-3 mb-7"
              >
                <Stat
                  label="Lessons"
                  value={`${monthReview.total_lessons_completed}/${monthReview.total_lessons}`}
                />
                <Stat
                  label="Longest streak"
                  value={`${monthReview.longest_streak}d`}
                />
                <Stat label="Ads shipped" value={`${monthReview.ad_submissions}`} />
                <Stat
                  label="Notes written"
                  value={`${monthReview.notes_count}`}
                />
                <Stat
                  label="Discount"
                  value={monthReview.discount_earned ? "Earned" : "—"}
                  highlight={monthReview.discount_earned}
                />
                <Stat
                  label="Days to finish"
                  value={
                    monthReview.days_to_finish != null
                      ? `${monthReview.days_to_finish}d`
                      : "—"
                  }
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 1.7 }}
                className="flex flex-col sm:flex-row gap-3"
              >
                {onDownloadJournal && (
                  <button
                    onClick={onDownloadJournal}
                    className="flex-1 px-5 py-3 rounded-lg font-semibold"
                    style={{
                      background: "var(--color-gold)",
                      color: "var(--color-bg-primary)",
                      fontSize: 14,
                    }}
                  >
                    Download my Field Journal
                  </button>
                )}
                <button
                  onClick={onDismiss}
                  className="flex-1 px-5 py-3 rounded-lg font-mono uppercase"
                  style={{
                    background: "rgba(230,192,122,0.1)",
                    color: "rgba(230,220,200,0.85)",
                    border: "1px solid rgba(230,192,122,0.32)",
                    fontSize: 12,
                    letterSpacing: "0.16em",
                  }}
                >
                  Back to map
                </button>
              </motion.div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.45, ease: SPEC_EASE }}
      style={{
        padding: "14px 12px",
        background: highlight
          ? "rgba(230,192,122,0.16)"
          : "rgba(6,12,26,0.5)",
        border: highlight
          ? "1px solid var(--color-gold)"
          : "1px solid rgba(230,192,122,0.16)",
        borderRadius: 10,
      }}
    >
      <div
        className="font-mono"
        style={{
          color: highlight
            ? "var(--color-gold-light)"
            : "var(--color-ink)",
          fontSize: 22,
          fontWeight: 600,
          fontFeatureSettings: '"tnum"',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        className="font-mono uppercase mt-1"
        style={{
          color: "rgba(230,220,200,0.5)",
          letterSpacing: "0.14em",
          fontSize: 9,
        }}
      >
        {label}
      </div>
    </motion.div>
  );
}
