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
 * the dark moment. Reads as a film chapter card — the destination's
 * Roman numeral + name fades in over the dark backdrop, holds, then
 * fades out as the new scene reveals.
 *
 * Timeline (duration=1.2s):
 *   0.00s  overlay opacity 0, scene = old
 *   0.48s  overlay opacity 1 (fully covered), title card 0%
 *   0.36s  title card starts fading in (slightly before peak so the
 *          card is already settling when the swap happens)
 *   0.55s  title card at full opacity
 *   0.60s  onPeak fires — parent swaps scene under cover
 *   0.78s  title card starts fading out
 *   0.72s  overlay starts fading out
 *   0.96s  title card fully invisible
 *   1.20s  overlay fully invisible, scene = new
 *
 * The overlay is a slightly warm-dark gradient (not pure black) so
 * the moment doesn't read as a hard cut — feels atmospheric.
 */
export function CinematicDive({
  trigger,
  onPeak,
  duration = 1.2,
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
    if (titleEl) gsap.set(titleEl, { opacity: 0, y: 12 });
    gsap.set(container, { pointerEvents: "auto" });

    const fadeInDur = duration * 0.40;
    const holdDur = duration * 0.20;
    const fadeOutDur = duration * 0.40;
    const peakAt = fadeInDur + holdDur * 0.5;

    const tl = gsap.timeline({
      onComplete: () => {
        gsap.set(container, { pointerEvents: "none" });
        timelineRef.current = null;
      },
    });

    // Overlay fade in
    tl.to(
      overlay,
      {
        opacity: 1,
        duration: fadeInDur,
        ease: SPEC_EASE_GSAP,
      },
      0
    );

    // Title card fades in just before peak coverage, holds, fades out
    if (titleEl && titleHoldRef.current) {
      const titleInStart = fadeInDur * 0.65;
      const titleInDur = fadeInDur * 0.45 + holdDur * 0.5;
      const titleHold = holdDur * 0.5 + fadeOutDur * 0.4;
      const titleOutDur = fadeOutDur * 0.45;

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
          y: -8,
          duration: titleOutDur,
          ease: SPEC_EASE_GSAP_IN,
        },
        titleInStart + titleInDur + titleHold
      );
    }

    // Peak — swap scene under cover
    tl.add(() => {
      onPeakRef.current?.();
    }, peakAt);

    // Overlay fade out
    tl.to(
      overlay,
      {
        opacity: 0,
        duration: fadeOutDur,
        ease: SPEC_EASE_GSAP_IN,
      },
      fadeInDur + holdDur
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
      {/* Slightly warm-dark backdrop. NOT pure black — a faint warm
          radial keeps the moment atmospheric instead of feeling like
          a hard cut to nothing. */}
      <div
        ref={overlayRef}
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, rgba(18, 12, 6, 0.97) 0%, rgba(8, 6, 4, 1) 70%, rgba(0, 0, 0, 1) 100%)",
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
              color: "#F0D595",
              fontFeatureSettings: '"cv11", "ss01"',
              textShadow: "0 0 60px rgba(230, 192, 122, 0.32)",
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
                "linear-gradient(90deg, transparent 0%, rgba(230,192,122,0.5) 50%, transparent 100%)",
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
