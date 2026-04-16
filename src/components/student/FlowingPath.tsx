"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import type { PathNode } from "@/lib/path-layout";

interface FlowingPathProps {
  nodes: PathNode[];
  containerWidth: number;
  totalHeight: number;
  /** Index up to which the path should be "completed" (highlighted) */
  completedThroughIndex: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

interface Point {
  x: number;
  y: number;
}

/**
 * SVG path drawn through all nodes (checkpoints AND lessons) on the
 * path container. Renders two strokes:
 *   1. A muted dashed base line (all nodes).
 *   2. A bright accent overlay that draws via scroll progress — so
 *      as the user scrolls the page, the path fills in behind them.
 *
 * Receives computed (x, y) from path-layout.ts instead of measuring
 * DOM refs. This keeps the path guaranteed aligned with the nodes.
 */
export function FlowingPath({
  nodes,
  containerWidth,
  totalHeight,
  completedThroughIndex,
  scrollContainerRef,
}: FlowingPathProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const completedPathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(0);

  // Scroll-driven progress: 0 at top of container, 1 at bottom of viewport reaching container bottom
  const { scrollYProgress } = useScroll({
    target: scrollContainerRef,
    offset: ["start end", "end start"],
  });

  // We want the path to "fill in" from top to bottom as the user scrolls.
  // At scrollYProgress=0 (not yet visible): dashoffset = full length (hidden)
  // At scrollYProgress=0.5ish (middle visible): dashoffset = ~half (drawing)
  // At scrollYProgress=1 (past): dashoffset = 0 (fully drawn)
  const rawScrollDash = useTransform(
    scrollYProgress,
    [0, 0.2, 0.9],
    [pathLength, pathLength * 0.85, 0]
  );

  // "Completion" dashoffset — reveal path up through `completedThroughIndex`
  // Each node is 1 / (nodes.length - 1) of the way along.
  const completedFraction =
    nodes.length <= 1
      ? 0
      : Math.max(0, completedThroughIndex + 1) / nodes.length;
  const completedDash = pathLength - pathLength * completedFraction;

  // Combine: completed segment always drawn, scrolling segment draws ahead
  // Use the smaller dashoffset (more visible) of the two.
  const effectiveDash = useTransform(rawScrollDash, (v) =>
    Math.min(v, completedDash)
  );

  // Measure path length on mount / resize
  useEffect(() => {
    if (pathRef.current) {
      setPathLength(pathRef.current.getTotalLength());
    }
  }, [nodes, containerWidth]);

  if (nodes.length < 2 || !containerWidth) return null;

  const centerX = containerWidth / 2;
  const points: Point[] = nodes.map((n) => ({
    x: centerX + n.x,
    y: n.y + 60, // center of a 120px checkpoint shape (lesson pills are smaller; approx ok)
  }));

  const fullPath = buildBezier(points);

  return (
    <svg
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      width={containerWidth}
      height={totalHeight}
      viewBox={`0 0 ${containerWidth} ${totalHeight}`}
      style={{ zIndex: 0 }}
    >
      <defs>
        <linearGradient id="flow-muted" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(245,242,237,0.18)" />
          <stop offset="100%" stopColor="rgba(245,242,237,0.06)" />
        </linearGradient>
        <linearGradient id="flow-active" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent-light)" />
          <stop offset="100%" stopColor="var(--color-accent)" />
        </linearGradient>
      </defs>

      {/* Base path — muted dashed line through all nodes */}
      <path
        ref={pathRef}
        d={fullPath}
        fill="none"
        stroke="url(#flow-muted)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="8 10"
      />

      {/* Bright overlay — uses stroke-dashoffset on full length for scroll-draw */}
      <motion.path
        ref={completedPathRef}
        d={fullPath}
        fill="none"
        stroke="url(#flow-active)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={pathLength}
        strokeDashoffset={effectiveDash}
        style={{
          filter: "drop-shadow(0 0 8px var(--color-accent-glow))",
        }}
      />
    </svg>
  );
}

/**
 * Build an organic cubic-bezier path through a series of points with
 * handles offset alternately for a gentle flowing snake feel.
 */
function buildBezier(pts: Point[]): string {
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dy = b.y - a.y;
    const curveOffset = Math.max(20, dy * 0.4);
    const sideA = i % 2 === 0 ? 1 : -1;
    const sideB = -sideA;
    const cx1 =
      a.x + sideA * Math.min(60, Math.abs(b.x - a.x) * 0.5 + 20);
    const cy1 = a.y + curveOffset;
    const cx2 =
      b.x + sideB * Math.min(60, Math.abs(b.x - a.x) * 0.5 + 20);
    const cy2 = b.y - curveOffset;
    d += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${b.x} ${b.y}`;
  }
  return d;
}
