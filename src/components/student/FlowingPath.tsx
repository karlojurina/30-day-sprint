"use client";

import { useEffect, useLayoutEffect, useRef, useState, RefObject } from "react";

interface FlowingPathProps {
  /** Refs to the checkpoint node wrappers, in order */
  nodeRefs: RefObject<HTMLDivElement | null>[];
  /** Container ref so we measure relative to it */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Which index is the first INCOMPLETE checkpoint — everything before glows */
  completedThroughIndex: number;
}

interface Point {
  x: number;
  y: number;
}

export function FlowingPath({
  nodeRefs,
  containerRef,
  completedThroughIndex,
}: FlowingPathProps) {
  const [points, setPoints] = useState<Point[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const recompute = () => {
    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const newPoints: Point[] = [];
    for (const ref of nodeRefs) {
      const el = ref.current;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      newPoints.push({
        x: r.left + r.width / 2 - cRect.left,
        y: r.top + r.height / 2 - cRect.top,
      });
    }
    setPoints(newPoints);
    setSize({ width: cRect.width, height: cRect.height });
  };

  useLayoutEffect(() => {
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeRefs.length]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const observer = new ResizeObserver(() => recompute());
    if (containerRef.current) observer.observe(containerRef.current);
    for (const ref of nodeRefs) {
      if (ref.current) observer.observe(ref.current);
    }
    window.addEventListener("resize", recompute);
    // Recompute periodically for the first 2 seconds to catch expansion transitions
    const id = setInterval(recompute, 200);
    const stop = setTimeout(() => clearInterval(id), 2000);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recompute);
      clearInterval(id);
      clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (points.length < 2) return null;

  // Build the full flowing path
  const fullPath = buildBezier(points);

  // Build the "completed so far" segment
  const completedPath =
    completedThroughIndex > 0
      ? buildBezier(points.slice(0, Math.min(completedThroughIndex + 1, points.length)))
      : null;

  return (
    <svg
      ref={svgRef}
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      preserveAspectRatio="none"
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

      {/* Base muted path (all segments) */}
      <path
        d={fullPath}
        fill="none"
        stroke="url(#flow-muted)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="8 10"
      />

      {/* Completed overlay path — bright accent */}
      {completedPath && (
        <path
          d={completedPath}
          fill="none"
          stroke="url(#flow-active)"
          strokeWidth={3}
          strokeLinecap="round"
          style={{
            filter:
              "drop-shadow(0 0 8px var(--color-accent-glow))",
          }}
        />
      )}
    </svg>
  );
}

/**
 * Build an organic cubic-bezier path through a series of points, with control
 * handles offset alternately to create a gentle S-curve flow between nodes.
 */
function buildBezier(pts: Point[]): string {
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dy = b.y - a.y;
    const curveOffset = Math.max(40, dy * 0.45);
    // Alternate control-point side for organic feel
    const sideA = i % 2 === 0 ? 1 : -1;
    const sideB = -sideA;
    const cx1 = a.x + sideA * Math.min(80, Math.abs(b.x - a.x) * 0.5 + 40);
    const cy1 = a.y + curveOffset;
    const cx2 = b.x + sideB * Math.min(80, Math.abs(b.x - a.x) * 0.5 + 40);
    const cy2 = b.y - curveOffset;
    d += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${b.x} ${b.y}`;
  }
  return d;
}
