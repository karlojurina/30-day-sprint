"use client";

import { useId, useMemo, useState } from "react";
import type { MetricPoint } from "@/lib/whop-stats-catalog";

/**
 * Time-series chart for a revenue tile.
 *
 * Built to the dataviz procedure, not by eye. The decisions that are NOT
 * matters of taste:
 *
 * COLOUR. One categorical hue, chosen last and validated by script rather
 * than reasoned about: `#2a78d6` against this card's real surface (#FFFFFF)
 * passes the lightness band, chroma floor and 3:1 contrast checks. The admin
 * accent (--color-accent, a pearl #8E8E84) is deliberately NOT used for data
 * — it is a low-chroma chrome colour and fails the chroma floor, which is
 * correct for chrome and wrong for a line someone reads numbers off.
 *
 * The comparison period is a NEUTRAL REFERENCE, not a second series, so it
 * gets mid-grey (#7E7E80, 4.05:1 on white) plus a dash pattern — never a
 * second hue. Measured separation from the current line: ΔE 14.7 protan /
 * 10.1 tritan / 16.1 normal, all above target. Identity is carried by hue
 * AND dash AND the legend label, so it never rests on colour alone.
 *
 * THE LINE IS NOT COLOURED BY TREND. Colour follows the entity, never its
 * rank — a line that turns red when the number falls repaints on the data
 * and makes six tiles read as an alarm panel. Direction lives in the delta
 * pill, which is signed and labelled.
 *
 * GRIDLINES ARE SOLID HAIRLINES, NOT DOTTED. Whop's dashboard dots them and
 * that is the one thing not worth copying: dashing a grid reads as
 * "projection" or "threshold" when it is just a grid.
 *
 * The container height INCLUDES the x-axis band. A fixed height that fits
 * only the plot gives the card a tiny nested scrollbar.
 *
 * Nulls BREAK the line. Whop has two separate gap mechanisms (omitted
 * buckets and literal value:null) and both mean absence, not zero.
 *
 * ALL LABELS ARE HTML, NOT SVG <text>. The plot uses
 * preserveAspectRatio="none" so the line fills any card width, which scales
 * the viewBox NON-UNIFORMLY (1000 units into ~420px across, height fixed).
 * Any <text> inside it would be squashed to ~42% width. So the SVG carries
 * geometry only and every label is absolutely-positioned HTML over it.
 */

const PLOT_H = 132;
const AXIS_H = 18;
const PAD_T = 10;
const GUTTER = 48; // CSS px reserved for the y-label column (HTML, not SVG)
const W = 1000; // viewBox units; the SVG scales to its container

type Props = {
  points: MetricPoint[];
  previous?: MetricPoint[];
  format: (v: number | null) => string;
  /** Compact form for axis ticks, e.g. $12K. */
  formatTick: (v: number) => string;
  labelAt: (t: number) => string;
  /** Period captions for the legend. */
  currentLabel: string;
  previousLabel?: string;
  currentTotal: string;
  previousTotal?: string;
  /** Final bucket covers an incomplete period. */
  trailingPartial?: boolean;
};

const CURRENT = "#2a78d6";
const REFERENCE = "#7E7E80";

/**
 * Nice round tick values across a domain, targeting `target` intervals.
 *
 * Snaps to the NEAREST nice step rather than the first step >= raw. Taking
 * the first larger step overshoots and collapses most domains to two ticks
 * (just a floor and a ceiling), which is not a scale — it is two labels.
 */
function ticks(min: number, max: number, target = 3): number[] {
  if (max === min) return [min];
  const raw = (max - min) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * mag);
  const step = candidates.reduce((best, c) =>
    Math.abs(c - raw) < Math.abs(best - raw) ? c : best,
  );
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.01; v += step) {
    out.push(Number(v.toFixed(6)));
  }
  return out.length >= 2 ? out : [min, max];
}

export function MetricChart({
  points,
  previous,
  format,
  formatTick,
  labelAt,
  currentLabel,
  previousLabel,
  currentTotal,
  previousTotal,
  trailingPartial,
}: Props) {
  // useId, so two tiles in a grid can never cross-wire their fills. The
  // previous implementation keyed the gradient id on the colour string and
  // collided whenever two tiles shared a trend.
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const cur = points.filter((p) => p.v != null).map((p) => p.v as number);
    const prev = (previous ?? []).filter((p) => p.v != null).map((p) => p.v as number);
    const all = [...cur, ...prev];
    if (all.length === 0) return null;

    let lo = Math.min(...all);
    let hi = Math.max(...all);
    // Anchor value scales at zero so bar-height intuition is not violated,
    // but never force it for a series that genuinely lives away from zero.
    if (lo > 0 && lo < hi * 0.6) lo = 0;
    if (hi === lo) hi = lo + 1;

    const plotW = W;
    const x = (i: number, n: number) => (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v: number) =>
      PAD_T + (1 - (v - lo) / (hi - lo)) * (PLOT_H - PAD_T * 2);

    const build = (ps: MetricPoint[]) => {
      let d = "";
      let open = false;
      ps.forEach((p, i) => {
        if (p.v == null) {
          open = false;
          return;
        }
        d += `${open ? "L" : "M"}${x(i, ps.length).toFixed(1)},${y(p.v).toFixed(1)}`;
        open = true;
      });
      return d;
    };

    const path = build(points);
    const unbroken = points.length > 0 && points.every((p) => p.v != null);

    return {
      lo,
      hi,
      plotW,
      x,
      y,
      path,
      prevPath: previous?.length ? build(previous) : "",
      area: unbroken && path ? `${path}L${x(points.length - 1, points.length)},${PLOT_H}L0,${PLOT_H}Z` : "",
      yTicks: ticks(lo, hi, 3),
    };
  }, [points, previous]);

  if (!geo || !geo.path) {
    return (
      <div
        style={{
          height: PLOT_H + AXIS_H,
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

  const n = points.length;
  const hovered = hover != null ? points[hover] : null;
  const hoverX = hover != null ? geo.x(hover, n) : 0;

  return (
    <div>
      {/* paddingRight reserves the y-label column so the plot never runs
          under the labels. */}
      <div
        style={{
          position: "relative",
          height: PLOT_H + AXIS_H,
          paddingRight: GUTTER,
        }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const host = e.currentTarget;
          const r = host.getBoundingClientRect();
          const plotPx = r.width - GUTTER;
          const frac = (e.clientX - r.left) / plotPx;
          setHover(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))));
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${PLOT_H}`}
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: `0 ${GUTTER}px auto 0`,
            width: `calc(100% - ${GUTTER}px)`,
            height: PLOT_H,
            display: "block",
            overflow: "visible",
          }}
          role="img"
          aria-label={`${currentLabel}: ${currentTotal}${
            previousTotal ? `, versus ${previousLabel}: ${previousTotal}` : ""
          }. ${n} points.`}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CURRENT} stopOpacity="0.14" />
              <stop offset="100%" stopColor={CURRENT} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid: SOLID hairlines one shade off the surface. Never dotted. */}
          {geo.yTicks.map((v) => (
            <line
              key={v}
              x1={0}
              x2={W}
              y1={geo.y(v)}
              y2={geo.y(v)}
              stroke="var(--color-border)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {geo.area && <path d={geo.area} fill={`url(#${gid})`} stroke="none" />}

          {/* Comparison period: neutral reference, dashed, drawn UNDER the
              current period so the current line is never obscured. */}
          {geo.prevPath && (
            <path
              d={geo.prevPath}
              fill="none"
              stroke={REFERENCE}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          <path
            d={geo.path}
            fill="none"
            stroke={CURRENT}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Incomplete final period, so a partial bucket cannot read as a fall. */}
          {trailingPartial && n > 1 && (
            <rect
              x={W - W / (n - 1) / 2}
              y={0}
              width={W / (n - 1) / 2}
              height={PLOT_H}
              fill="var(--color-text-tertiary)"
              opacity={0.08}
            />
          )}

          {/* Crosshair only. A <circle> here would render as an ELLIPSE —
              preserveAspectRatio="none" scales x and y differently, so radii
              distort. The marker dot is HTML, below. */}
          {hover != null && hovered?.v != null && (
            <line
              x1={hoverX}
              x2={hoverX}
              y1={0}
              y2={PLOT_H}
              stroke="var(--color-border-strong)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Hover marker — HTML, so it stays circular at any card width.
            The white ring is the 2px surface gap that makes it read over
            the line rather than merging into it. */}
        {hover != null && hovered?.v != null && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              // The plot is calc(100% - GUTTER) wide; place the marker at
              // its fractional position within that, not within the card.
              left: `calc((100% - ${GUTTER}px) * ${(hoverX / W).toFixed(4)})`,
              top: geo.y(hovered.v),
              transform: "translate(-50%, -50%)",
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: CURRENT,
              boxShadow: "0 0 0 2px var(--color-bg-card)",
              pointerEvents: "none",
            }}
          />
        )}

        {/* y-axis labels — HTML, in the reserved gutter. */}
        {geo.yTicks.map((v) => (
          <div
            key={v}
            style={{
              position: "absolute",
              right: 0,
              top: geo.y(v),
              transform: "translateY(-50%)",
              width: GUTTER - 6,
              textAlign: "right",
              fontSize: 10,
              lineHeight: 1,
              color: "var(--color-text-tertiary)",
              fontVariantNumeric: "tabular-nums",
              pointerEvents: "none",
            }}
          >
            {formatTick(v)}
          </div>
        ))}

        {/* x-axis band — inside the container height, so it is never clipped. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: GUTTER,
            top: PLOT_H,
            height: AXIS_H,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 10,
            color: "var(--color-text-tertiary)",
            pointerEvents: "none",
          }}
        >
          {n > 1 &&
            [0, Math.floor((n - 1) / 2), n - 1]
              .filter((i, k, a) => a.indexOf(i) === k)
              .map((i) => <span key={i}>{labelAt(points[i].t)}</span>)}
        </div>
      </div>

      {/* LEGEND — always present for 2 series, and it carries the VALUES so a
          number is never reachable only by hovering. */}
      <div
        className="flex items-center"
        style={{ gap: 14, flexWrap: "wrap", marginTop: 8 }}
      >
        <span className="flex items-center" style={{ gap: 6 }}>
          <svg width="14" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="14" y2="4" stroke={CURRENT} strokeWidth={2} strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
            {currentLabel}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--color-text-primary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {currentTotal}
          </span>
        </span>
        {previousTotal && (
          <span className="flex items-center" style={{ gap: 6 }}>
            <svg width="14" height="8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="14"
                y2="4"
                stroke={REFERENCE}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                strokeLinecap="round"
              />
            </svg>
            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
              {previousLabel}
            </span>
            <span
              style={{
                fontSize: 11,
                color: "var(--color-text-secondary)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {previousTotal}
            </span>
          </span>
        )}
      </div>

      {hover != null && hovered && (
        <div style={{ fontSize: 11, marginTop: 6, color: "var(--color-text-secondary)" }}>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {labelAt(hovered.t)}
          </span>
          {" · "}
          <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>
            {hovered.v == null ? "no data" : format(hovered.v)}
          </span>
        </div>
      )}
    </div>
  );
}
