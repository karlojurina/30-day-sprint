"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";

interface CloudTransitionProps {
  /** Bump this number to trigger a fresh transition. */
  trigger: number;
  /** Called at the peak (fully covered) so parent can swap scenes. */
  onPeak?: () => void;
  /** Total duration of the in→peak→out sequence in seconds. */
  duration?: number;
}

/**
 * Clash-of-Clans style cloud/mist transition.
 *
 * 8 organic cloud blobs fly in from the edges, scale up, and fully cover the
 * screen. At peak coverage `onPeak` fires so the parent can swap scene. Then
 * the clouds scale down and drift back out, revealing the new scene.
 *
 * Trigger by bumping the `trigger` number (any changing value works).
 * Respects prefers-reduced-motion — degrades to a quick white fade.
 */
export function CloudTransition({
  trigger,
  onPeak,
  duration = 1.5,
}: CloudTransitionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cloudRefs = useRef<(HTMLDivElement | null)[]>([]);
  const whiteFlashRef = useRef<HTMLDivElement>(null);
  const prevTrigger = useRef(trigger);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    if (trigger === prevTrigger.current) return;
    prevTrigger.current = trigger;

    const container = containerRef.current;
    if (!container) return;

    // Kill any in-flight timeline
    if (timelineRef.current) {
      timelineRef.current.kill();
      timelineRef.current = null;
    }

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      // Simple flash + swap
      gsap.set(container, { pointerEvents: "auto" });
      gsap.fromTo(
        whiteFlashRef.current,
        { opacity: 0 },
        {
          opacity: 1,
          duration: 0.18,
          ease: "power2.out",
          onComplete: () => {
            onPeak?.();
            gsap.to(whiteFlashRef.current, {
              opacity: 0,
              duration: 0.22,
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

    const clouds = cloudRefs.current.filter((r): r is HTMLDivElement => r != null);
    if (clouds.length === 0) return;

    const half = duration / 2;
    const inDur = half * 0.75;
    const outDur = half * 0.95;
    const coverageHold = 0.12;

    // Reset clouds to off-screen entry positions
    const entryPositions = [
      { x: "-70vw", y: "-30vh", rot: -20 },   // from top-left
      { x: "70vw",  y: "-35vh", rot: 25 },    // from top-right
      { x: "-80vw", y: "20vh",  rot: 12 },    // from left
      { x: "75vw",  y: "-10vh", rot: -15 },   // from right (upper)
      { x: "80vw",  y: "40vh",  rot: 8 },     // from right (lower)
      { x: "-60vw", y: "50vh",  rot: -8 },    // from bottom-left
      { x: "30vw",  y: "75vh",  rot: 14 },    // from bottom
      { x: "-20vw", y: "75vh",  rot: -6 },    // from bottom
    ];

    clouds.forEach((el, i) => {
      const p = entryPositions[i % entryPositions.length];
      gsap.set(el, {
        x: p.x,
        y: p.y,
        rotation: p.rot,
        scale: 0.5,
        opacity: 0,
      });
    });
    gsap.set(whiteFlashRef.current, { opacity: 0 });
    gsap.set(container, { pointerEvents: "auto" });

    const tl = gsap.timeline({
      onComplete: () => {
        gsap.set(container, { pointerEvents: "none" });
        timelineRef.current = null;
      },
    });

    // Phase 1 — clouds rush in
    clouds.forEach((el, i) => {
      tl.to(
        el,
        {
          x: `${(i - clouds.length / 2) * 6}vw`, // settle around the center
          y: `${((i % 3) - 1) * 10}vh`,
          rotation: 0,
          scale: 1.6,
          opacity: 1,
          duration: inDur,
          ease: "power3.out",
        },
        i * 0.035
      );
    });

    // White-flash building up to full coverage
    tl.to(
      whiteFlashRef.current,
      {
        opacity: 1,
        duration: inDur * 0.7,
        ease: "power2.in",
      },
      inDur * 0.3
    );

    // Peak hold + scene swap
    tl.add(() => {
      onPeak?.();
    }, inDur + coverageHold * 0.4);

    // Phase 2 — clouds drift out in opposing directions, flash fades
    const exitPositions = [
      { x: "80vw",  y: "-30vh", rot: 20 },
      { x: "-70vw", y: "-25vh", rot: -15 },
      { x: "70vw",  y: "40vh",  rot: -10 },
      { x: "-80vw", y: "30vh",  rot: 18 },
      { x: "-60vw", y: "-30vh", rot: -20 },
      { x: "80vw",  y: "50vh",  rot: 10 },
      { x: "-40vw", y: "80vh",  rot: -14 },
      { x: "60vw",  y: "85vh",  rot: 8 },
    ];

    clouds.forEach((el, i) => {
      const p = exitPositions[i % exitPositions.length];
      tl.to(
        el,
        {
          x: p.x,
          y: p.y,
          rotation: p.rot,
          scale: 0.7,
          opacity: 0,
          duration: outDur,
          ease: "power2.in",
        },
        inDur + coverageHold + i * 0.03
      );
    });

    tl.to(
      whiteFlashRef.current,
      {
        opacity: 0,
        duration: outDur * 0.8,
        ease: "power2.out",
      },
      inDur + coverageHold
    );

    timelineRef.current = tl;

    return () => {
      if (timelineRef.current) {
        timelineRef.current.kill();
        timelineRef.current = null;
      }
    };
  }, [trigger, onPeak, duration]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0"
      style={{
        zIndex: 60,
        pointerEvents: "none",
        overflow: "hidden",
      }}
      aria-hidden
    >
      {/* White-flash layer — peak brightness behind clouds. Fully opaque at
          peak so nothing bleeds through during the scene swap. */}
      <div
        ref={whiteFlashRef}
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, #FFFAF0 0%, #E6DCC8 100%)",
          opacity: 0,
        }}
      />

      {/* Cloud layer */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          ref={(el) => {
            cloudRefs.current[i] = el;
          }}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: CLOUD_SIZES[i % CLOUD_SIZES.length],
            height: CLOUD_SIZES[i % CLOUD_SIZES.length],
            opacity: 0,
            willChange: "transform, opacity",
          }}
        >
          <Cloud seed={i} />
        </div>
      ))}
    </div>
  );
}

const CLOUD_SIZES = ["80vmax", "70vmax", "75vmax", "85vmax", "65vmax", "72vmax", "78vmax", "68vmax"];

/**
 * An organic cloud blob SVG. Uses turbulence + soft edge blur for a
 * believable mist look. Different seed = different turbulence offset.
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
          <stop offset="0%" stopColor="rgba(255,252,248,0.98)" />
          <stop offset="55%" stopColor="rgba(245,238,225,0.9)" />
          <stop offset="85%" stopColor="rgba(225,210,185,0.45)" />
          <stop offset="100%" stopColor="rgba(210,190,160,0)" />
        </radialGradient>
      </defs>
      <g filter={`url(#${filterId})`}>
        <ellipse cx="0" cy="0" rx="78" ry="58" fill={`url(#cloud-grad-${seed})`} />
        <ellipse cx="-15" cy="-10" rx="40" ry="30" fill={`url(#cloud-grad-${seed})`} opacity="0.85" />
        <ellipse cx="20" cy="10" rx="45" ry="25" fill={`url(#cloud-grad-${seed})`} opacity="0.85" />
      </g>
    </svg>
  );
}
