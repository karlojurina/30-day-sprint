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
  /**
   * Title card content shown during the dark moment. Pass null to
   * just do a plain fade with no card (e.g. region → overview).
   */
  title?: { numeral: string; label: string } | null;
}

/**
 * Fade-through-dark transition with an optional title card during
 * the dark moment. The destination's Roman numeral + name fades in
 * AFTER the overlay reaches full coverage, holds for ~1s of read
 * time, then fades out as the scene reveals.
 *
 * Timeline (duration=2.0s):
 *   0.00s  overlay opacity 0, scene = old
 *   0.25s  overlay opacity 1 (fully covered) — fast fade-in so the
 *          map is hidden before the title card shows
 *   0.25s  onPeak fires — parent swaps scene under cover
 *   0.30s  title card starts fading in (no overlap with visible map)
 *   0.45s  title card at full opacity
 *   1.45s  title card starts fading out (~1s of read time)
 *   1.50s  overlay starts fading out
 *   1.65s  title card fully invisible
 *   2.00s  overlay fully invisible, scene = new
 *
 * The overlay is a fully-opaque warm-dark radial (alpha=1 at every
 * stop). The "warm" comes from color variation, not transparency.
 */
export function CinematicDive({
  trigger,
  onPeak,
  duration = 2.0,
  title = null,
}: CinematicDiveProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const prevTrigger = useRef(trigger);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  const onPeakRef = useRef(onPeak);
  useEffect(() => {
    onPeakRef.current = onPeak;
  }, [onPeak]);

  // Hold the title in a ref so it's always the latest at peak — if the
  // user triggers another transition mid-flight, the parent re-renders
  // with new title props before the timeline reads them.
  const titleHoldRef = useRef(title);
  useEffect(() => {
    titleHoldRef.current = title;
  }, [title]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (trigger === prevTrigger.current) return;
    prevTrigger.current = trigger;

    const container = containerRef.current;
    const overlay = overlayRef.current;
    const titleEl = titleRef.current;
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
          duration: 0.16,
          ease: SPEC_EASE_GSAP,
          onComplete: () => {
            onPeakRef.current?.();
            gsap.to(overlay, {
              opacity: 0,
              duration: 0.18,
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
    if (titleEl) gsap.set(titleEl, { opacity: 0, y: 10 });
    gsap.set(container, { pointerEvents: "auto" });

    // Fixed timing — fade-in is intentionally short so the overlay
    // hits 100% before any title text appears (no map bleed-through
    // behind text). Hold is variable to fit the requested total
    // duration; fade-out is generous so the destination scene
    // reveals smoothly.
    const fadeInDur = 0.25;
    const fadeOutDur = 0.50;
    const holdDur = Math.max(0.4, duration - fadeInDur - fadeOutDur);
    const peakAt = fadeInDur; // peak = exactly when fully covered

    const tl = gsap.timeline({
      onComplete: () => {
        gsap.set(container, { pointerEvents: "none" });
        timelineRef.current = null;
      },
    });

    // Overlay fade IN — fast, hits 100% by peakAt
    tl.to(
      overlay,
      {
        opacity: 1,
        duration: fadeInDur,
        ease: SPEC_EASE_GSAP,
      },
      0
    );

    // Peak — swap scene under cover. Fires at the START of the hold
    // (not in the middle) so the new scene is in place from t=peakAt.
    tl.add(() => {
      onPeakRef.current?.();
    }, peakAt);

    // Title card — fades in shortly after peak (so overlay is fully
    // opaque first), holds for ~1s of read time, fades out before
    // the overlay starts revealing the destination.
    if (titleEl && titleHoldRef.current) {
      const titleInDelay = 0.05;       // tiny breath after peak
      const titleInDur = 0.15;          // snappy fade-in
      const titleOutDur = 0.20;         // fade out before overlay reveals
      const titleInStart = peakAt + titleInDelay;
      const titleOutStart = peakAt + holdDur - 0.05;

      tl.to(
        titleEl,
        {
          opacity: 1,
          y: 0,
          duration: titleInDur,
          ease: SPEC_EASE_GSAP,
        },
        titleInStart
      );
      tl.to(
        titleEl,
        {
          opacity: 0,
          y: -6,
          duration: titleOutDur,
          ease: SPEC_EASE_GSAP_IN,
        },
        titleOutStart
      );
    }

    // Overlay fade OUT — starts at end of hold
    tl.to(
      overlay,
      {
        opacity: 0,
        duration: fadeOutDur,
        ease: SPEC_EASE_GSAP_IN,
      },
      peakAt + holdDur
    );

    timelineRef.current = tl;

    return () => {
      if (timelineRef.current) {
        timelineRef.current.kill();
        timelineRef.current = null;
      }
    };
    // onPeak intentionally excluded — read via onPeakRef.
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
      {/* Neutral-dark backdrop. Slight gradient variation for depth,
          all stops alpha=1 so coverage is fully opaque at peak. */}
      <div
        ref={overlayRef}
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, rgb(20, 22, 26) 0%, rgb(10, 12, 16) 50%, rgb(0, 0, 0) 100%)",
          opacity: 0,
          willChange: "opacity",
        }}
      />

      {/* Title card — rendered on top of overlay, only visible when
          title prop is set. Stamp layout: numeral large, hairline gold
          rule, region name tracked below. */}
      {title && (
        <div
          ref={titleRef}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0,
            willChange: "opacity, transform",
          }}
        >
          <div
            style={{
              fontFamily:
                'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontWeight: 600,
              fontSize: 88,
              letterSpacing: "-0.045em",
              lineHeight: 1,
              color: "#FFFFFF",
              fontFeatureSettings: '"cv11", "ss01"',
              textShadow: "0 0 60px rgba(255, 255, 255, 0.28)",
            }}
          >
            {title.numeral}
          </div>
          <div
            aria-hidden="true"
            style={{
              width: 56,
              height: 1,
              background:
                "linear-gradient(90deg, transparent 0%, rgba(245,245,240,0.5) 50%, transparent 100%)",
              margin: "20px 0 16px",
            }}
          />
          <div
            style={{
              fontFamily:
                'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontWeight: 500,
              fontSize: 14,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "rgba(255, 247, 235, 0.82)",
            }}
          >
            {title.label}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
