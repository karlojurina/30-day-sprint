"use client";

/**
 * Phase 2 - Intro Video Gate.
 *
 * Full-screen modal that plays Karlo's welcome video the first time
 * a student loads /dashboard post-OAuth. The Continue button stays
 * disabled until the video's native `ended` event fires (full watch).
 *
 * Hard "must watch" enforcement (v72.6):
 *  - Native player chrome is HIDDEN (`controls={false}`). The student
 *    can't drag a scrubber, can't right-click "Save as", can't
 *    Picture-in-Picture, can't download.
 *  - We render our own minimal control bar: play/pause, volume,
 *    fullscreen. No timeline scrub. The progress bar is visual only.
 *  - `onSeeking` is still wired as a belt-and-suspenders catch (keyboard
 *    shortcuts, fullscreen-mode native controls, anything else that
 *    might attempt a seek) - if currentTime exceeds the furthest point
 *    ever played, snap back.
 *
 * Persistence: parent fires `onContinue` only after the student
 * clicks the Continue button (which is only enabled post-`ended`).
 * Parent then writes `student_milestones.intro_video_threshold_met`
 * and dismisses the gate. No auto-advance.
 *
 * No rewatch mode anymore — once watched, the gate stays dormant
 * forever. The DB column name still says "threshold_met" for back
 * compat; the semantic is "watched end to end."
 *
 * Video URL: NEXT_PUBLIC_INTRO_VIDEO_URL. Unset → placeholder so dev
 * environments don't 500.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SEEK_TOLERANCE_S = 0.5;

interface IntroVideoGateProps {
  /** True the first time a student loads the dashboard AND hasn't
   *  yet finished the video. When false, the gate is dormant. */
  open: boolean;
  /** Fired when the student clicks Continue (which is only enabled
   *  after the video's `ended` event). Parent persists the milestone
   *  + dismisses the gate. */
  onContinue: () => void;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function IntroVideoGate({ open, onContinue }: IntroVideoGateProps) {
  const videoUrl = process.env.NEXT_PUBLIC_INTRO_VIDEO_URL ?? "";
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const endedFiredRef = useRef(false);
  const maxReachedRef = useRef(0);

  const [unlocked, setUnlocked] = useState(false);
  const [watchedPct, setWatchedPct] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Reset internal state every time the gate opens fresh.
  useEffect(() => {
    if (open) {
      setUnlocked(false);
      setWatchedPct(0);
      setCurrentTime(0);
      endedFiredRef.current = false;
      maxReachedRef.current = 0;
    }
  }, [open]);

  // Track fullscreen state (the browser owns this transition; we just
  // react to it so the icon stays accurate).
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const el = videoRef.current;
    if (!el || !el.duration || !isFinite(el.duration)) return;
    const t = el.currentTime;
    if (t > maxReachedRef.current) maxReachedRef.current = t;
    setCurrentTime(t);
    setWatchedPct(t / el.duration);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const el = videoRef.current;
    if (!el || !isFinite(el.duration)) return;
    setDuration(el.duration);
  }, []);

  // Belt-and-suspenders seek block. Native controls are off so this
  // mostly catches keyboard shortcuts and fullscreen-mode controls.
  const handleSeeking = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.currentTime > maxReachedRef.current + SEEK_TOLERANCE_S) {
      el.currentTime = maxReachedRef.current;
    }
  }, []);

  const handleEnded = useCallback(() => {
    if (endedFiredRef.current) return;
    endedFiredRef.current = true;
    setUnlocked(true);
    setWatchedPct(1);
    setPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused || el.ended) {
      void el.play();
    } else {
      el.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  }, []);

  const handleVolumeChange = useCallback((v: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.volume = v;
    el.muted = v === 0;
    setVolume(v);
    setMuted(v === 0);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    if (!document.fullscreenElement) {
      void c.requestFullscreen?.();
    } else {
      void document.exitFullscreen?.();
    }
  }, []);

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
              Welcome
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

          {/* Video frame with custom controls */}
          <div
            ref={containerRef}
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
              <>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  autoPlay
                  playsInline
                  controls={false}
                  controlsList="nodownload"
                  disablePictureInPicture
                  onContextMenu={(e) => e.preventDefault()}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onSeeking={handleSeeking}
                  onEnded={handleEnded}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onVolumeChange={() => {
                    const el = videoRef.current;
                    if (!el) return;
                    setVolume(el.volume);
                    setMuted(el.muted);
                  }}
                  onClick={togglePlay}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    background: "#000",
                    cursor: "pointer",
                  }}
                />

                {/* Big center play button overlay - shown when paused */}
                {!playing && !endedFiredRef.current && (
                  <button
                    onClick={togglePlay}
                    aria-label="Play video"
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: 72,
                      height: 72,
                      borderRadius: "50%",
                      background: "rgba(0,0,0,0.55)",
                      border: "1px solid rgba(255,255,255,0.24)",
                      backdropFilter: "blur(8px)",
                      WebkitBackdropFilter: "blur(8px)",
                      color: "rgba(255,255,255,0.95)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "auto",
                    }}
                  >
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <polygon points="7 4 20 12 7 20 7 4" />
                    </svg>
                  </button>
                )}

                {/* Bottom control bar */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: "10px 14px 12px",
                    background:
                      "linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    pointerEvents: "auto",
                  }}
                >
                  {/* Visual-only progress bar */}
                  <div
                    aria-hidden="true"
                    style={{
                      height: 3,
                      background: "rgba(255,255,255,0.18)",
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(100, watchedPct * 100)}%`,
                        height: "100%",
                        background: unlocked
                          ? "rgba(74,222,128,0.85)"
                          : "rgba(255,255,255,0.85)",
                        transition: "width 0.2s linear",
                      }}
                    />
                  </div>

                  {/* Controls row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      color: "rgba(255,255,255,0.92)",
                    }}
                  >
                    {/* Play/pause */}
                    <button
                      onClick={togglePlay}
                      aria-label={playing ? "Pause" : "Play"}
                      style={iconBtnStyle}
                    >
                      {playing ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="4" width="4" height="16" rx="1" />
                          <rect x="14" y="4" width="4" height="16" rx="1" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="7 4 20 12 7 20 7 4" />
                        </svg>
                      )}
                    </button>

                    {/* Time display */}
                    <span
                      style={{
                        fontSize: 12,
                        fontVariantNumeric: "tabular-nums",
                        color: "rgba(255,255,255,0.85)",
                        minWidth: 86,
                      }}
                    >
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>

                    <div style={{ flex: 1 }} />

                    {/* Volume */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <button
                        onClick={toggleMute}
                        aria-label={muted ? "Unmute" : "Mute"}
                        style={iconBtnStyle}
                      >
                        {muted || volume === 0 ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                            <line x1="23" y1="9" x2="17" y2="15" />
                            <line x1="17" y1="9" x2="23" y2="15" />
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                          </svg>
                        )}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={muted ? 0 : volume}
                        onChange={(e) =>
                          handleVolumeChange(parseFloat(e.target.value))
                        }
                        aria-label="Volume"
                        style={{
                          width: 72,
                          accentColor: "rgba(255,255,255,0.85)",
                          cursor: "pointer",
                        }}
                      />
                    </div>

                    {/* Fullscreen */}
                    <button
                      onClick={toggleFullscreen}
                      aria-label={
                        isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
                      }
                      style={iconBtnStyle}
                    >
                      {isFullscreen ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </>
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
                  Karlo&rsquo;s intro video lands here once{" "}
                  <code style={{ color: "rgba(255,255,255,0.95)" }}>
                    NEXT_PUBLIC_INTRO_VIDEO_URL
                  </code>{" "}
                  is set. Dev fallback only — production must have the
                  URL configured.
                </p>
              </div>
            )}
          </div>

          {/* Status text + Continue */}
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
              {!videoUrl
                ? "No video configured — press Continue to proceed."
                : unlocked
                  ? "Continue is unlocked."
                  : "Watch the full video to continue."}
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
              Continue
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
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "rgba(255,255,255,0.92)",
  cursor: "pointer",
  padding: 4,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 0,
};
