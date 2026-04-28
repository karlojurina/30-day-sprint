"use client";

/**
 * First-time onboarding overlay. Three steps:
 *   1. "You're in" — high-level framing + placeholder for Karlo's
 *      90s explainer video (env var driven; renders an iframe when
 *      the URL is set, falls back to a still illustration otherwise)
 *   2. "How it works" — 3-bullet visual walkthrough
 *   3. "Day 1 starts here" — points the student at their first
 *      lesson with a "Start" CTA
 *
 * Persists via /api/student/complete-onboarding which stamps
 * students.onboarding_completed_at. Dashboard reads that timestamp
 * and only mounts the flow when it's null.
 *
 * Accessibility: real <dialog> semantics via role="dialog", focus
 * trap, Escape closes and stamps the flag.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useFocusTrap } from "@/lib/useFocusTrap";

interface OnboardingFlowProps {
  studentFirstName: string;
  /** Called when the flow is dismissed (completed or skipped). The
   * caller should fire the API to persist + remove the modal. */
  onDismiss: () => void;
}

const VIDEO_URL = process.env.NEXT_PUBLIC_KARLO_INTRO_VIDEO_URL;

export function OnboardingFlow({
  studentFirstName,
  onDismiss,
}: OnboardingFlowProps) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onDismiss]);

  // Lock scroll while open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const next = () => {
    if (step < 2) setStep((s) => (s + 1) as 0 | 1 | 2);
    else onDismiss();
  };
  const back = () => {
    if (step > 0) setStep((s) => (s - 1) as 0 | 1 | 2);
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="fixed inset-0 z-[60]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(6,12,26,0.92) 0%, rgba(6,12,26,0.98) 100%)",
          backdropFilter: "blur(8px)",
        }}
      />

      {/* Centered dialog */}
      <div
        className="fixed inset-0 z-[65] flex items-center justify-center p-4"
        style={{ pointerEvents: "none" }}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-title"
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            duration: 0.45,
            delay: 0.1,
            ease: [0.22, 1, 0.36, 1],
          }}
          style={{
            pointerEvents: "auto",
            width: "min(720px, 92vw)",
            maxHeight: "92vh",
            background:
              "linear-gradient(180deg, var(--color-bg-card) 0%, var(--color-bg-secondary) 100%)",
            border: "1px solid rgba(230, 192, 122, 0.4)",
            borderRadius: 20,
            overflow: "hidden",
            boxShadow:
              "0 40px 80px rgba(0,0,0,0.7), 0 0 60px rgba(230,192,122,0.12) inset",
          }}
        >
          {/* Step indicator */}
          <div className="flex items-center justify-between p-5 sm:p-6">
            <span
              className="font-mono uppercase"
              style={{
                color: "var(--color-gold)",
                letterSpacing: "0.22em",
                fontSize: 11,
              }}
            >
              {step + 1} / 3
            </span>
            <button
              onClick={onDismiss}
              className="font-mono uppercase"
              style={{
                color: "rgba(230,220,200,0.45)",
                letterSpacing: "0.16em",
                fontSize: 10,
              }}
            >
              Skip
            </button>
          </div>

          {/* Step content */}
          <div className="px-5 sm:px-8 pb-2 min-h-[360px]">
            <AnimatePresence mode="wait">
              {step === 0 && (
                <motion.div
                  key="step0"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <h2
                    id="onboarding-title"
                    className="italic leading-tight mb-3"
                    style={{
                      fontFamily: "var(--font-display)",
                      color: "var(--color-ink)",
                      fontWeight: 500,
                      fontSize: 36,
                    }}
                  >
                    {studentFirstName ? `${studentFirstName}, ` : ""}you&rsquo;re in.
                  </h2>
                  <p
                    style={{
                      color: "rgba(230,220,200,0.78)",
                      fontSize: 15,
                      lineHeight: 1.6,
                      maxWidth: 540,
                    }}
                    className="mb-6"
                  >
                    This is your map. The next 30 days will take you through
                    learning the craft, shipping your first ads, and earning
                    real bounties from real brands. You&rsquo;ll see one node
                    at a time. We&rsquo;ll guide you the rest of the way.
                  </p>
                  {VIDEO_URL ? (
                    <div
                      className="relative rounded-lg overflow-hidden"
                      style={{
                        aspectRatio: "16/9",
                        border: "1px solid rgba(230,192,122,0.3)",
                      }}
                    >
                      <iframe
                        src={VIDEO_URL}
                        title="Karlo&rsquo;s welcome"
                        allow="autoplay; encrypted-media"
                        allowFullScreen
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      className="rounded-lg flex items-center justify-center"
                      style={{
                        aspectRatio: "16/9",
                        background:
                          "radial-gradient(ellipse at center, rgba(230,192,122,0.18) 0%, transparent 65%), rgba(6,12,26,0.55)",
                        border: "1px solid rgba(230,192,122,0.18)",
                      }}
                    >
                      <p
                        className="italic"
                        style={{
                          fontFamily: "var(--font-display)",
                          color: "rgba(230,220,200,0.45)",
                          fontSize: 14,
                        }}
                      >
                        Karlo&rsquo;s welcome video drops here soon
                      </p>
                    </div>
                  )}
                </motion.div>
              )}

              {step === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <h2
                    className="italic leading-tight mb-5"
                    style={{
                      fontFamily: "var(--font-display)",
                      color: "var(--color-ink)",
                      fontWeight: 500,
                      fontSize: 32,
                    }}
                  >
                    How it works.
                  </h2>
                  <ul className="space-y-4">
                    <Step
                      n="01"
                      title="Tap a node, open a lesson"
                      body="Each node on the map is one lesson. Some you watch on Whop, some you ship from the action page."
                    />
                    <Step
                      n="02"
                      title="Watch lessons sync automatically"
                      body="Finish a video on Whop and we mark it complete here. Action items you check off yourself."
                    />
                    <Step
                      n="03"
                      title="Finish R1 + R2 in 14 days, claim your discount"
                      body="Region 1 + Region 2 + the action items unlock 30% off your next month. There&rsquo;s a marker for it on the map."
                    />
                  </ul>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  className="text-center"
                >
                  <div
                    className="mx-auto mb-5 w-20 h-20 rounded-full flex items-center justify-center"
                    style={{
                      background:
                        "radial-gradient(circle, rgba(230,192,122,0.32) 0%, rgba(230,192,122,0.08) 60%, transparent 100%)",
                      border: "2px solid var(--color-gold)",
                      boxShadow: "0 0 50px rgba(230,192,122,0.32)",
                    }}
                  >
                    <span
                      className="font-mono"
                      style={{
                        color: "var(--color-gold)",
                        fontSize: 11,
                        letterSpacing: "0.2em",
                      }}
                    >
                      DAY 1
                    </span>
                  </div>
                  <h2
                    className="italic leading-tight mb-3"
                    style={{
                      fontFamily: "var(--font-display)",
                      color: "var(--color-ink)",
                      fontWeight: 500,
                      fontSize: 36,
                    }}
                  >
                    Day 1 starts here.
                  </h2>
                  <p
                    style={{
                      color: "rgba(230,220,200,0.78)",
                      fontSize: 15,
                      lineHeight: 1.6,
                      maxWidth: 460,
                    }}
                    className="mx-auto"
                  >
                    Hit the button below — your first node will be highlighted
                    on the map. Tap it, watch the briefing, ship the action,
                    keep moving.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer nav */}
          <div className="flex items-center justify-between p-5 sm:p-6">
            {step > 0 ? (
              <button
                onClick={back}
                className="font-mono uppercase"
                style={{
                  color: "rgba(230,220,200,0.6)",
                  letterSpacing: "0.16em",
                  fontSize: 11,
                }}
              >
                ← Back
              </button>
            ) : (
              <span />
            )}

            <button
              onClick={next}
              className="px-6 py-3 rounded-lg font-semibold transition-colors"
              style={{
                background: "var(--color-gold)",
                color: "var(--color-bg-primary)",
                fontSize: 14,
              }}
            >
              {step === 2 ? "Take me to the map" : "Continue →"}
            </button>
          </div>
        </motion.div>
      </div>
    </>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-4">
      <span
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-mono"
        style={{
          background: "rgba(230,192,122,0.14)",
          color: "var(--color-gold)",
          border: "1px solid rgba(230,192,122,0.4)",
          fontSize: 11,
          letterSpacing: "0.08em",
        }}
      >
        {n}
      </span>
      <div>
        <h3
          className="italic mb-1"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--color-ink)",
            fontSize: 18,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            color: "rgba(230,220,200,0.7)",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          {body}
        </p>
      </div>
    </li>
  );
}
