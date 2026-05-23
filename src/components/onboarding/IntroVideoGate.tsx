"use client";

/**
 * Phase 2 - Intro Video Gate (brief v3 §02).
 *
 * Renders as a full-screen modal that auto-plays Karlo's intro video
 * the first time a student loads /dashboard post-OAuth. The Continue
 * button is locked until ~65% of the video has been watched -
 * tracked from the player's timeupdate events. Once unlocked, click
 * advances the chain to the Why You're Here panel.
 *
 * Threshold state is persisted via POST /api/student/mark-intro-
 * video-threshold so the gate stays open for the student forever
 * after they cross it once (re-watches don't flip it back).
 *
 * Video URL comes from NEXT_PUBLIC_INTRO_VIDEO_URL (placeholder
 * until Karlo records). If unset, the component renders a gentle
 * notice instead of a broken player so dev / staging environments
 * don't 500.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const WATCH_THRESHOLD = 0.65;

interface IntroVideoGateProps {
  /** True the first time a student loads the dashboard AND hasn't yet
   *  crossed the watch threshold. When false, the gate is dormant. */
  open: boolean;
  /** Re-watch mode. Mounts the gate from the persistent button in
   *  StatsWidget. Threshold is already met, so Continue is unlocked
   *  from the start - we just play the video again. */
  rewatchMode?: boolean;
  /** Called when the student crosses the watch threshold for the
   *  first time. Parent fires POST /api/student/mark-intro-video-
   *  threshold to persist. No-op in rewatch mode. */
  onThresholdReached: () => void;
  /** Called when Continue clicks. Parent advances to WYH panel. */
  onContinue: () => void;
  /** Called when re-watch mode dismisses. (Re-watch only - the
   *  first-pass gate has no Close affordance.) */
  onClose?: () => void;
}

export function IntroVideoGate({
  open,
  rewatchMode = false,
  onThresholdReached,
  onContinue,
  onClose,
}: IntroVideoGateProps) {
  const videoUrl = process.env.NEXT_PUBLIC_INTRO_VIDEO_URL ?? "";
  const videoRef = useRef<HTMLVideoElement>(null);
  const [unlocked, setUnlocked] = useState(rewatchMode);
  const [watchedPct, setWatchedPct] = useState(0);
  const thresholdFiredRef = useRef(false);

  // Reset internal state when the gate opens fresh.
  useEffect(() => {
    if (open && !rewatchMode) {
      setUnlocked(false);
      setWatchedPct(0);
      thresholdFiredRef.current = false;
    }
    if (open && rewatchMode) {
      setUnlocked(true);
    }
  }, [open, rewatchMode]);

  const handleTimeUpdate = useCallback(() => {
    const el = videoRef.current;
    if (!el || !el.duration || !isFinite(el.duration)) return;
    const pct = el.currentTime / el.duration;
    setWatchedPct(pct);
    if (
      !rewatchMode &&
      !thresholdFiredRef.current &&
      pct >= WATCH_THRESHOLD
    ) {
      thresholdFiredRef.current = true;
      setUnlocked(true);
      onThresholdReached();
    }
  }, [onThresholdReached, rewatchMode]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="intro-video-gate"
        role="dialog"
        aria-modal="true"
        aria-label="Welcome video"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-[180] flex items-center justify-center"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(8,12,22,0.92) 0%, rgba(4,8,16,0.98) 100%)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
        }}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          style={{
            width: "min(960px, 92vw)",
            maxHeight: "92vh",
            display: "flex",
            flexDirection: "column",
            gap: 20,
            padding: 24,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div>
              <p
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.45)",
                  marginBottom: 6,
                }}
              >
                {rewatchMode ? "Re-watch" : "Welcome"}
              </p>
              <h2
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  letterSpacing: "-0.018em",
                  color: "rgba(255,255,255,0.96)",
                  lineHeight: 1.2,
                }}
              >
                A quick word from Karlo before you start
              </h2>
            </div>
            {rewatchMode && onClose && (
              <button
                onClick={onClose}
                aria-label="Close"
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.16)",
                  borderRadius: 8,
                  color: "rgba(255,255,255,0.65)",
                  cursor: "pointer",
                  width: 32,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: 18,
                }}
              >
                ×
              </button>
            )}
          </div>

          {/* Video frame */}
          <div
            style={{
              position: "relative",
              borderRadius: 14,
              overflow: "hidden",
              background: "rgba(0,0,0,0.6)",
              aspectRatio: "16 / 9",
              boxShadow:
                "0 30px 80px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.06) inset",
            }}
          >
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                autoPlay={!rewatchMode}
                controls
                playsInline
                onTimeUpdate={handleTimeUpdate}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  background: "#000",
                }}
              />
            ) : (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  gap: 10,
                  textAlign: "center",
                  padding: 24,
                  color: "rgba(255,255,255,0.78)",
                }}
              >
                <p
                  style={{
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.45)",
                  }}
                >
                  Placeholder
                </p>
                <p style={{ fontSize: 15, lineHeight: 1.5, maxWidth: 480 }}>
                  Karlo&rsquo;s intro video lands here once recorded.
                  Set <code style={{ color: "rgba(255,255,255,0.95)" }}>
                    NEXT_PUBLIC_INTRO_VIDEO_URL
                  </code>{" "}
                  to swap it in. For now you can continue without
                  watching.
                </p>
              </div>
            )}
          </div>

          {/* Progress + Continue */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {/* Progress bar - hidden in rewatch mode */}
            {!rewatchMode && videoUrl && (
              <div
                aria-hidden="true"
                style={{
                  height: 3,
                  background: "rgba(255,255,255,0.10)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, (watchedPct / WATCH_THRESHOLD) * 100)}%`,
                    height: "100%",
                    background:
                      unlocked
                        ? "rgba(74,222,128,0.85)"
                        : "rgba(255,255,255,0.7)",
                    transition: "width 0.3s cubic-bezier(0.22,1,0.36,1)",
                  }}
                />
              </div>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
              }}
            >
              <p
                style={{
                  fontSize: 12,
                  color: unlocked
                    ? "rgba(74,222,128,0.85)"
                    : "rgba(255,255,255,0.45)",
                  letterSpacing: "-0.003em",
                }}
              >
                {rewatchMode
                  ? "Re-watching - no progress saved."
                  : !videoUrl
                    ? "No video configured - press Continue to proceed."
                    : unlocked
                      ? "Continue is unlocked."
                      : "Watch the video to unlock the next step."}
              </p>
              <button
                onClick={onContinue}
                disabled={!unlocked && !!videoUrl}
                style={{
                  padding: "12px 22px",
                  borderRadius: 10,
                  background:
                    unlocked || !videoUrl
                      ? "rgba(255,255,255,0.94)"
                      : "rgba(255,255,255,0.12)",
                  color:
                    unlocked || !videoUrl
                      ? "rgba(15,17,21,0.92)"
                      : "rgba(255,255,255,0.4)",
                  border: "none",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: "-0.011em",
                  cursor:
                    unlocked || !videoUrl ? "pointer" : "not-allowed",
                  transition: "all 200ms cubic-bezier(0.22,1,0.36,1)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {rewatchMode ? "Done" : "Continue"}
                {!rewatchMode && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
