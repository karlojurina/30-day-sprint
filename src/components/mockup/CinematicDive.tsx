"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";
import { SPEC_EASE_GSAP, SPEC_EASE_GSAP_IN } from "@/lib/motion";

interface CinematicDiveProps {
  /** Bump this number to trigger a fresh transition. */
  trigger: number;
  /** Called at the peak (fully covered) so parent can swap scenes. */
  onPeak?: () => void;
  /** Total duration in seconds. */
  duration?: number;
}

/**
 * Cinematic dive transition — replaces the cloud cover.
 *
 * Three stacked layers, all in a portal at z-index 9999:
 *   1. Vignette layer — full-screen dark radial gradient that fades in
 *      from transparent edges, providing peak coverage during the swap.
 *   2. Warm flash — a soft golden-hour gradient that flashes through
 *      the middle of the dive, giving a "camera caught the light"
 *      feel that matches the painted scenes' palette.
 *   3. Speed streaks — radial lines emanating from center, briefly
 *      visible during the dive-in to suggest forward motion.
 *
 * Timeline for duration=1.0s (default):
 *   0.00 → all layers at 0%, scene = old
 *   0.40 → vignette + flash at peak (fully covered + warm flash hot)
 *   0.50 → onPeak fires, parent swaps scene under cover
 *   0.55 → flash starts retreating
 *   1.00 → fully revealed, all layers at 0%, scene = new
 *
 * Reads as "we flew through a portal of warm light" rather than "we
 * waited for clouds to clear." Fits the explorer/expedition voice.
 */
export function CinematicDive({
  trigger,
  onPeak,
  duration = 1.0,
}: CinematicDiveProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const streaksRef = useRef<HTMLDivElement>(null);
  const prevTrigger = useRef(trigger);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  // Stable ref for onPeak so re-renders during the parent's camera
  // tween don't restart the timeline.
  const onPeakRef = useRef(onPeak);
  useEffect(() => {
    onPeakRef.current = onPeak;
  }, [onPeak]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (trigger === prevTrigger.current) return;
    prevTrigger.current = trigger;

    const container = containerRef.current;
    const vignette = vignetteRef.current;
    const flash = flashRef.current;
    const streaks = streaksRef.current;
    if (!container || !vignette || !flash || !streaks) return;

    if (timelineRef.current) {
      timelineRef.current.kill();
      timelineRef.current = null;
    }

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      gsap.set(container, { pointerEvents: "auto" });
      gsap.fromTo(
        vignette,
        { opacity: 0 },
        {
          opacity: 1,
          duration: 0.18,
          ease: SPEC_EASE_GSAP,
          onComplete: () => {
            onPeakRef.current?.();
            gsap.to(vignette, {
              opacity: 0,
              duration: 0.22,
              ease: SPEC_EASE_GSAP_IN,
              onComplete: () => {
                gsap.set(container, { pointerEvents: "none" });
              },
            });
          },
        }
      );
      return;
    }

    // Initial state — invisible everything, slight scale on layers so
    // the dive-in feels like it's pushing outward toward the camera.
    gsap.set(vignette, { opacity: 0, scale: 0.92 });
    gsap.set(flash, { opacity: 0, scale: 0.85 });
    gsap.set(streaks, { opacity: 0, scale: 0.7, rotation: 0 });
    gsap.set(container, { pointerEvents: "auto" });

    const inDur = duration * 0.40; // 0.0 → 0.40 fade in
    const peakAt = duration * 0.50; // scene swap moment
    const outStart = duration * 0.55; // 0.55 → 1.00 fade out
    const outDur = duration - outStart;

    const tl = gsap.timeline({
      onComplete: () => {
        gsap.set(container, { pointerEvents: "none" });
        timelineRef.current = null;
      },
    });

    // ── Phase 1: dive in ─────────────────────────────────────────
    // Vignette darkens edges → middle.
    tl.to(
      vignette,
      {
        opacity: 1,
        scale: 1.05,
        duration: inDur,
        ease: SPEC_EASE_GSAP,
      },
      0
    );
    // Warm flash hits its peak just past mid-dive.
    tl.to(
      flash,
      {
        opacity: 1,
        scale: 1.15,
        duration: inDur * 1.05,
        ease: SPEC_EASE_GSAP,
      },
      0
    );
    // Speed streaks visible during the first 60% of the dive only.
    tl.to(
      streaks,
      {
        opacity: 0.55,
        scale: 1.4,
        rotation: 8,
        duration: inDur * 0.85,
        ease: "power2.out",
      },
      0
    );
    tl.to(
      streaks,
      {
        opacity: 0,
        scale: 1.7,
        rotation: 14,
        duration: peakAt - inDur * 0.85,
        ease: "power2.in",
      },
      inDur * 0.85
    );

    // ── Phase 2: peak — swap scene under full cover ──────────────
    tl.add(() => {
      onPeakRef.current?.();
    }, peakAt);

    // ── Phase 3: emerge ──────────────────────────────────────────
    tl.to(
      vignette,
      {
        opacity: 0,
        scale: 1.18,
        duration: outDur,
        ease: SPEC_EASE_GSAP_IN,
      },
      outStart
    );
    tl.to(
      flash,
      {
        opacity: 0,
        scale: 1.32,
        duration: outDur * 0.95,
        ease: SPEC_EASE_GSAP_IN,
      },
      outStart
    );

    timelineRef.current = tl;

    return () => {
      if (timelineRef.current) {
        timelineRef.current.kill();
        timelineRef.current = null;
      }
    };
    // onPeak intentionally excluded — read via onPeakRef so frequent
    // parent re-renders don't kill the in-flight timeline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, duration]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0"
      style={{
        zIndex: 9999,
        pointerEvents: "none",
        overflow: "hidden",
      }}
      aria-hidden
    >
      {/* Layer 1 — vignette. Dark edges, transparent center → grows
          to fully dark at peak, providing the actual coverage. */}
      <div
        ref={vignetteRef}
        style={{
          position: "absolute",
          inset: "-10%",
          background:
            "radial-gradient(ellipse at center, rgba(8,12,22,0.20) 0%, rgba(8,12,22,0.85) 45%, rgba(4,8,16,0.98) 80%, rgba(0,0,0,1) 100%)",
          willChange: "transform, opacity",
        }}
      />

      {/* Layer 2 — warm flash. A soft golden-hour radial that catches
          the camera at peak. Fits the painted scene palette. */}
      <div
        ref={flashRef}
        style={{
          position: "absolute",
          inset: "-10%",
          background:
            "radial-gradient(ellipse at center, rgba(255,231,178,0.55) 0%, rgba(220,184,118,0.35) 25%, rgba(160,118,62,0.12) 55%, transparent 80%)",
          mixBlendMode: "screen",
          willChange: "transform, opacity",
        }}
      />

      {/* Layer 3 — speed streaks. Pure SVG radial lines fading from
          center outward, suggesting forward motion. Briefly visible
          during dive-in. */}
      <div
        ref={streaksRef}
        style={{
          position: "absolute",
          inset: 0,
          willChange: "transform, opacity",
        }}
      >
        <svg
          viewBox="-100 -100 200 200"
          preserveAspectRatio="xMidYMid slice"
          style={{ width: "100%", height: "100%" }}
        >
          <defs>
            <radialGradient id="streak-fade" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(255,231,178,0)" />
              <stop offset="35%" stopColor="rgba(255,231,178,0)" />
              <stop offset="60%" stopColor="rgba(255,247,220,0.85)" />
              <stop offset="100%" stopColor="rgba(255,247,220,0)" />
            </radialGradient>
          </defs>
          {/* 24 radial streaks emanating from center, evenly spaced */}
          {Array.from({ length: 24 }).map((_, i) => {
            const angle = (i * 360) / 24;
            const rad = (angle * Math.PI) / 180;
            const x = Math.cos(rad) * 90;
            const y = Math.sin(rad) * 90;
            return (
              <line
                key={i}
                x1={Math.cos(rad) * 30}
                y1={Math.sin(rad) * 30}
                x2={x}
                y2={y}
                stroke="url(#streak-fade)"
                strokeWidth={0.7 + (i % 3) * 0.4}
                strokeLinecap="round"
              />
            );
          })}
        </svg>
      </div>
    </div>,
    document.body
  );
}
