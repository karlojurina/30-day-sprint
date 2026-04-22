"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";

interface CloudTransitionProps {
  /** Bump this number to trigger a fresh transition. */
  trigger: number;
  /** Called at the peak (fully covered) so parent can swap scenes. */
  onPeak?: () => void;
  /** Total duration of the in→hold→out sequence in seconds. */
  duration?: number;
}

/**
 * Clash-of-Clans style cloud transition.
 *
 * Three layers stack on top of the viewport (z-index 9999):
 *   1. Solid parchment backdrop — fades in to 100%, holds, fades out.
 *      This is the reliable full-screen cover; nothing bleeds through.
 *   2. Cloud SVGs — 12 of them pre-spread across the screen, fade in/out
 *      with a subtle scale-up for texture on top of the backdrop.
 *   3. (Scene swap happens in the middle of the hold, while fully covered.)
 *
 * Timeline for duration=2.0s:
 *   t=0.00 → clouds & backdrop opacity 0, scene = old
 *   t=0.70 → backdrop & clouds at opacity 1 (fully covered)
 *   t=0.85 → onPeak fires, parent swaps scene (hidden behind cover)
 *   t=1.20 → fade out begins
 *   t=2.00 → fully revealed, scene = new
 *
 * Bump `trigger` to replay. Respects prefers-reduced-motion → quick fade.
 */
export function CloudTransition({
  trigger,
  onPeak,
  duration = 2.0,
}: CloudTransitionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const cloudRefs = useRef<(HTMLDivElement | null)[]>([]);
  const prevTrigger = useRef(trigger);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  // Portal mount guard — createPortal needs a document.body, which only
  // exists in the browser. Delay mounting one tick past hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (trigger === prevTrigger.current) return;
    prevTrigger.current = trigger;

    const container = containerRef.current;
    const backdrop = backdropRef.current;
    if (!container || !backdrop) return;

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
        backdrop,
        { opacity: 0 },
        {
          opacity: 1,
          duration: 0.2,
          ease: "power2.out",
          onComplete: () => {
            onPeak?.();
            gsap.to(backdrop, {
              opacity: 0,
              duration: 0.25,
              ease: "power2.in",
              onComplete: () => {
                gsap.set(container, { pointerEvents: "none" });
              },
            });
          },
        }
      );
      return;
    }

    const clouds = cloudRefs.current.filter(
      (r): r is HTMLDivElement => r != null
    );

    // Initial state — everything invisible, clouds pre-sized down and
    // lightly rotated for a bit of organic variation.
    gsap.set(backdrop, { opacity: 0 });
    clouds.forEach((el, i) => {
      gsap.set(el, {
        opacity: 0,
        scale: 0.7,
        rotation: (i % 2 === 0 ? 1 : -1) * (2 + (i * 1.7) % 6),
      });
    });
    gsap.set(container, { pointerEvents: "auto" });

    // Durations relative to total
    const fadeInDur = duration * 0.35; // 0 → covered
    const holdDur = duration * 0.25; //     covered hold (swap happens)
    const fadeOutDur = duration * 0.4; //    covered → revealed

    const tl = gsap.timeline({
      onComplete: () => {
        gsap.set(container, { pointerEvents: "none" });
        timelineRef.current = null;
      },
    });

    // ── Phase 1: fade in to full coverage ────────────────────────
    tl.to(
      backdrop,
      {
        opacity: 1,
        duration: fadeInDur,
        ease: "power2.out",
      },
      0
    );

    clouds.forEach((el, i) => {
      tl.to(
        el,
        {
          opacity: 1,
          scale: 1.15,
          duration: fadeInDur * 1.05,
          ease: "power2.out",
        },
        i * 0.025
      );
    });

    // ── Phase 2: hold at full coverage, swap scene mid-hold ──────
    // onPeak fires ~halfway through the hold so the scene is already
    // in place when clouds start retreating.
    tl.add(() => {
      onPeak?.();
    }, fadeInDur + holdDur * 0.5);

    // ── Phase 3: fade out, reveal new scene ──────────────────────
    const outStart = fadeInDur + holdDur;

    tl.to(
      backdrop,
      {
        opacity: 0,
        duration: fadeOutDur,
        ease: "power2.in",
      },
      outStart
    );

    clouds.forEach((el, i) => {
      tl.to(
        el,
        {
          opacity: 0,
          scale: 1.45,
          duration: fadeOutDur,
          ease: "power2.in",
        },
        outStart + i * 0.02
      );
    });

    timelineRef.current = tl;

    return () => {
      if (timelineRef.current) {
        timelineRef.current.kill();
        timelineRef.current = null;
      }
    };
  }, [trigger, onPeak, duration]);

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
      {/* Solid backdrop — reliable full-screen coverage at peak */}
      <div
        ref={backdropRef}
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, #FFFAF0 0%, #EFE5D0 45%, #D9CAB0 100%)",
          opacity: 0,
        }}
      />

      {/* 12 cloud SVGs pre-spread across the screen — they're texture
          on top of the backdrop, not what's providing coverage. Their
          rough grid positions are staggered so no two look aligned. */}
      {CLOUD_POSITIONS.map((pos, i) => (
        <div
          key={i}
          ref={(el) => {
            cloudRefs.current[i] = el;
          }}
          style={{
            position: "absolute",
            top: pos.top,
            left: pos.left,
            transform: "translate(-50%, -50%)",
            width: pos.size,
            height: pos.size,
            opacity: 0,
            willChange: "transform, opacity",
          }}
        >
          <Cloud seed={i} />
        </div>
      ))}
    </div>,
    document.body
  );
}

// Cloud anchor positions — spread across the viewport so once faded in
// the clouds carpet the whole screen (not just the center). Sizes in
// vmax so they scale with viewport. Irregular on purpose.
const CLOUD_POSITIONS = [
  { top: "15%", left: "12%", size: "55vmax" },
  { top: "18%", left: "45%", size: "60vmax" },
  { top: "12%", left: "78%", size: "55vmax" },
  { top: "42%", left: "22%", size: "55vmax" },
  { top: "48%", left: "55%", size: "62vmax" },
  { top: "40%", left: "88%", size: "55vmax" },
  { top: "72%", left: "15%", size: "58vmax" },
  { top: "78%", left: "50%", size: "60vmax" },
  { top: "70%", left: "85%", size: "55vmax" },
  { top: "28%", left: "65%", size: "50vmax" },
  { top: "58%", left: "38%", size: "50vmax" },
  { top: "85%", left: "70%", size: "52vmax" },
];

/**
 * Organic cloud blob with turbulence + gradient. Seed varies the pattern.
 */
function Cloud({ seed }: { seed: number }) {
  const filterId = `cloud-fx-${seed}`;
  return (
    <svg viewBox="-100 -100 200 200" style={{ width: "100%", height: "100%" }}>
      <defs>
        <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012"
            numOctaves="3"
            seed={seed * 7 + 1}
          />
          <feDisplacementMap in="SourceGraphic" scale="22" />
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <radialGradient id={`cloud-grad-${seed}`} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="rgba(255,252,248,1)" />
          <stop offset="55%" stopColor="rgba(245,238,225,0.95)" />
          <stop offset="85%" stopColor="rgba(225,210,185,0.6)" />
          <stop offset="100%" stopColor="rgba(210,190,160,0)" />
        </radialGradient>
      </defs>
      <g filter={`url(#${filterId})`}>
        <ellipse cx="0" cy="0" rx="78" ry="58" fill={`url(#cloud-grad-${seed})`} />
        <ellipse cx="-15" cy="-10" rx="40" ry="30" fill={`url(#cloud-grad-${seed})`} opacity="0.9" />
        <ellipse cx="20" cy="10" rx="45" ry="25" fill={`url(#cloud-grad-${seed})`} opacity="0.9" />
      </g>
    </svg>
  );
}
