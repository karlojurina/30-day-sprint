"use client";

import { useId, useMemo, useState } from "react";
import type { MetricPoint } from "@/lib/whop-stats-catalog";

/**
 * Sparkline for a revenue tile.
 *
 * Deliberately NOT a reuse of the existing chart code, for two reasons
 * recorded in the PRD:
 *
 *  - `Chart` (insights/progress/page.tsx:722) is hard-wired to
 *    `points: SnapshotRow[]` + `valueKey: MetricKey`, i.e. literal
 *    daily_progress_snapshots columns, and it coerces null to 0 at :746
 *    behind a filter at :748 that can never fire. Rendering a gap as
 *    zero is exactly the class of silent wrongness this page exists to
 *    avoid: a day Whop has no data for would draw a revenue crash.
 *
 *  - `HeroSparkline` (admin/(authenticated)/page.tsx:762) keys its SVG
 *    gradient id on the colour string, and colour comes from a helper
 *    with only 4 possible return values — so ids collide in any grid of
 *    more than 4 tiles and the fills cross-wire. Here every instance
 *    gets its own id from useId().
 *
 * Renders ONE <path> per series. No per-point <rect> or <circle>: a
 * 20-month daily range is ~600 points per tile and a dozen tiles of
 * per-point nodes is what freezes a browser.
 */

const W = 320;
const H = 64;
const PAD_Y = 6;

type Props = {
  points: MetricPoint[];
  /** Previous-period series, drawn as a flat grey reference line. */
  previous?: MetricPoint[];
  /** Trend colour for the current series. */
  color: string;
  /** Marks the final point as covering an incomplete period. */
  trailingPartial?: boolean;
  format: (v: number | null) => string;
  /** Label for the x position under the cursor. */
  labelAt?: (t: number) => string;
};

/**
 * Build an SVG path, BREAKING the line wherever a point is null.
 * A null is a hole in Whop's data, not a zero. Two separate gap
 * mechanisms exist in that API — omitted buckets and literal
 * value:null — and both must read as absence.
 */
function buildPath(
  pts: MetricPoint[],
  min: number,
  max: number,
): string {
  if (pts.length === 0) return "";
  const span = max - min || 1;
  const x = (i: number) => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W);
  const y = (v: number) => H - PAD_Y - ((v - min) / span) * (H - PAD_Y * 2);

  let d = "";
  let open = false;
  pts.forEach((p, i) => {
    if (p.v == null) {
      open = false; // gap — stop drawing
      return;
    }
    d += `${open ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`;
    open = true;
  });
  return d;
}

export function Sparkline({
  points,
  previous,
  color,
  trailingPartial,
  format,
  labelAt,
}: Props) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const { min, max, path, prevPath, area } = useMemo(() => {
    const vals = points.filter((p) => p.v != null).map((p) => p.v as number);
    const prevVals = (previous ?? [])
      .filter((p) => p.v != null)
      .map((p) => p.v as number);
    const all = [...vals, ...prevVals];
    // Include 0 in the domain for value metrics so a small series does not
    // look dramatic, but never force it for a series that lives far from 0.
    const lo = Math.min(...all, 0);
    const hi = Math.max(...all, 0);
    const p = buildPath(points, lo, hi);
    // Close the area only when the line is unbroken; a shaded region under
    // a gapped line implies data that is not there.
    const unbroken = points.length > 0 && points.every((q) => q.v != null);
    return {
      min: lo,
      max: hi,
      path: p,
      prevPath: previous?.length ? buildPath(previous, lo, hi) : "",
      area: unbroken && p ? `${p}L${W},${H}L0,${H}Z` : "",
    };
  }, [points, previous]);

  if (points.length === 0 || !path) {
    return (
      <div
        style={{
          height: H,
          display: "flex",
          alignItems: "center",
          fontSize: 11,
          color: "var(--color-text-tertiary)",
        }}
      >
        no series
      </div>
    );
  }

  const hoveredPoint = hover != null ? points[hover] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: H, display: "block", overflow: "visible" }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const frac = (e.clientX - r.left) / r.width;
          const i = Math.round(frac * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
        role="img"
        aria-label={`${points.length} points, latest ${format(
          points[points.length - 1]?.v ?? null,
        )}`}
      >
        <defs>
          {/* id from useId() — unique per component instance, so tiles in a
              grid cannot cross-wire their fills. */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {area && <path d={area} fill={`url(#${gradientId})`} stroke="none" />}

        {prevPath && (
          <path
            d={prevPath}
            fill="none"
            stroke="var(--color-border-strong)"
            strokeWidth={1.25}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}

        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* The final bucket of a trailing range is an incomplete period.
            Hatching it stops a partial period reading as a downtrend. */}
        {trailingPartial && points.length > 1 && (
          <rect
            x={W - W / (points.length - 1) / 2}
            y={0}
            width={W / (points.length - 1) / 2}
            height={H}
            fill="var(--color-text-tertiary)"
            opacity={0.09}
          />
        )}

        {hover != null && hoveredPoint?.v != null && (
          <>
            <line
              x1={(hover / (points.length - 1)) * W}
              x2={(hover / (points.length - 1)) * W}
              y1={0}
              y2={H}
              stroke="var(--color-border-strong)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={(hover / (points.length - 1)) * W}
              cy={
                H -
                PAD_Y -
                ((hoveredPoint.v - min) / (max - min || 1)) * (H - PAD_Y * 2)
              }
              r={2.5}
              fill={color}
            />
          </>
        )}
      </svg>

      {hover != null && hoveredPoint && (
        <div
          style={{
            position: "absolute",
            top: -4,
            left: `${(hover / Math.max(1, points.length - 1)) * 100}%`,
            transform: "translate(-50%, -100%)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 11,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 5,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span style={{ color: "var(--color-text-tertiary)" }}>
            {labelAt ? labelAt(hoveredPoint.t) : ""}
          </span>{" "}
          <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>
            {/* A null hovers as an explicit gap, never as 0. */}
            {hoveredPoint.v == null ? "no data" : format(hoveredPoint.v)}
          </span>
        </div>
      )}
    </div>
  );
}
