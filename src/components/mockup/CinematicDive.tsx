"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";
import { SPEC_EASE_GSAP, SPEC_EASE_GSAP_IN } from "@/lib/motion";

interface CinematicDiveProps {
  /** Bump this number to trigger a fresh transition. */
  trigger: number;
  /** Called at peak (fully covered) so parent can swap scenes. */
  onPeak?: () => void;
  /** Total duration in seconds. */
  duration?: number;
}

/**
 * Minimal fade-through-dark transition. The classic film cut: source
 * fades to black, scene swaps under cover, destination fades up.
 * Zero gimmicks — just a single black overlay.
 *
 * Timeline for duration=0.7s:
 *   0.00 → overlay opacity 0, scene = old
 *   0.28 → opacity 1 (fully covered)
 *   0.35 → onPeak fires, parent swaps scene
 *   0.42 → fade out begins
 *   0.70 → opacity 0, scene = new
 *
 * Bump `trigger` to replay. prefers-reduced-motion → quick fade only.
 */
export function CinematicDive({
  trigger,
  onPeak,
  duration = 0.7,
}: CinematicDiveProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const prevTrigger = useRef(trigger);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

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
    const overlay = overlayRef.current;
    if (!container || !overlay) return;

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
        overlay,
        { opacity: 0 },
        {
          opacity: 1,
          duration: 0.12,
          ease: SPEC_EASE_GSAP,
          onComplete: () => {
            onPeakRef.current?.();
            gsap.to(overlay, {
              opacity: 0,
              duration: 0.16,
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

    gsap.set(overlay, { opacity: 0 });
    gsap.set(container, { pointerEvents: "auto" });

    const fadeIn = duration * 0.4;
    const hold = duration * 0.2;
    const fadeOut = duration * 0.4;

    const tl = gsap.timeline({
      onComplete: () => {
        gsap.set(container, { pointerEvents: "none" });
        timelineRef.current = null;
      },
    });

    // Fade in to full black
    tl.to(
      overlay,
      {
        opacity: 1,
        duration: fadeIn,
        ease: SPEC_EASE_GSAP,
      },
      0
    );

    // Peak — swap scene mid-hold
    tl.add(() => {
      onPeakRef.current?.();
    }, fadeIn + hold * 0.5);

    // Fade out reveal
    tl.to(
      overlay,
      {
        opacity: 0,
        duration: fadeOut,
        ease: SPEC_EASE_GSAP_IN,
      },
      fadeIn + hold
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
      <div
        ref={overlayRef}
        style={{
          position: "absolute",
          inset: 0,
          background: "#000000",
          opacity: 0,
          willChange: "opacity",
        }}
      />
    </div>,
    document.body
  );
}
