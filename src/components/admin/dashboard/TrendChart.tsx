"use client";

import { useState } from "react";
import { dayLabel } from "@/lib/admin/croatia-dates";
import type { Point } from "@/lib/admin/dashboard-metrics";

/**
 * The Dashboard's chart (admin rebuild 2, D3): one series, as a line or as
 * daily bars, in the brand kit's one accent (Airy Blue, the colour the kit
 * names for charts) on a hairline baseline.
 *
 * No gradient and no SVG ids: the old hero chart's gradient lost its id to a
 * colour's brackets and Chrome filled the area black (cf22c36). Here the wash
 * under a line that starts at 0 is the kit's accent tint (--color-accent-glow,
 * 16% Airy Blue), flat, and every dot, bar, hairline and readout is plain HTML
 * over a path-only SVG.
 *
 *   pointer and touch  a hairline at the nearest day, its dot, and a readout
 *   keyboard           Tab to the chart, the arrows move day by day,
 *                      Home and End jump, Escape hides the readout
 *   screen reader      the readout is spoken, and a table holds every day
 *
 * A day with no reading is a gap in the line (and "No reading" in the
 * readout and the table), never a 0.
 *
 * Insights draws its charts with this one too (admin rebuild 2, the review's
 * fix round), with labelled gridlines (`guides`, from axisTicks in
 * src/lib/admin/insights-data.ts) in a gutter left of the plot (`gutter`),
 * so a label never covers a bar. With no gutter, a guide's label sits on its
 * line, as Month 2's 50% and 100% do.
 */

const ACCENT = "var(--color-accent-dark)";
/** Room kept free at both ends of the plot, so the end dots stay inside it. */
const INSET = 6;

/** "Tue 20 Oct" for a UTC date of the snapshots: noon UTC is that same date in Croatia. */
export function pointDay(date: string): string {
  return dayLabel(`${date}T12:00:00.000Z`);
}

/** The value range drawn: a fixed one, 0 to the top for bars, or the readings' own spread, never narrower than 10% of their size. */
function range(values: number[], kind: "line" | "bars", domain?: [number, number]): [number, number] {
  if (domain) return domain;
  if (kind === "bars") return [0, Math.max(1, ...values)];
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A move of 6 on 1,000 stays a small move: the drawn spread is at least
  // 10% of the size of the numbers (and at least 1).
  const span = Math.max(max - min, 1, 0.1 * Math.max(Math.abs(min), Math.abs(max)));
  const mid = (min + max) / 2;
  let lo = mid - span / 2;
  let hi = mid + span / 2;
  if (min >= 0 && lo < 0) {
    hi -= lo;
    lo = 0;
  }
  return [lo, hi];
}

const dotStyle = (left: string, top: number): React.CSSProperties => ({
  position: "absolute",
  left,
  top,
  width: 8,
  height: 8,
  marginLeft: -4,
  marginTop: -4,
  borderRadius: 999,
  background: ACCENT,
  // The kit's 2px surface ring, so a dot reads where it sits on the line.
  boxShadow: "0 0 0 2px var(--color-bg-card)",
  pointerEvents: "none",
});

export function TrendChart({
  points,
  kind,
  height,
  label,
  format,
  axis = false,
  domain,
  guides = [],
  guideFormat,
  gutter = 0,
  emptyText = "No reading",
}: {
  /** Oldest first. */
  points: Point[];
  kind: "line" | "bars";
  /** The plot's height in px (the axis labels sit under it). */
  height: number;
  /** What a value is, for the table and the screen reader: "Active on platform". */
  label: string;
  /** A value as the readout shows it: "1,031", "58%". */
  format: (v: number) => string;
  /** The first and the last day under the plot. */
  axis?: boolean;
  /** A fixed value range (Month 2's 0 to 100). */
  domain?: [number, number];
  /** Values to mark with a labelled hairline (Month 2's 50% and 100%), so a line on a fixed range can be read without hovering. Bars take them too. */
  guides?: number[];
  /** A guide's label, when it reads differently from a value (Insights' "2.7%" beside a readout of "2.71%"). */
  guideFormat?: (v: number) => string;
  /** Room in px left of the plot for the guides' labels; 0 puts each label on its line. */
  gutter?: number;
  /** The readout for a day with no reading, or the words for each such day (Avg progress: "Before the switch"). */
  emptyText?: string | ((date: string) => string);
}) {
  const [active, setActive] = useState<number | null>(null);
  const n = points.length;
  const emptyOf = (date: string) => (typeof emptyText === "function" ? emptyText(date) : emptyText);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const [lo, hi] = range(values, kind, domain);
  const padTop = kind === "bars" ? 20 : 6;
  const padBottom = kind === "bars" ? 0 : 6;
  const plotH = Math.max(1, height - padTop - padBottom);

  /** Where day i sits across the plot, 0 to 1. */
  const frac = (i: number) => (kind === "bars" ? (i + 0.5) / n : n === 1 ? 0.5 : i / (n - 1));
  const padL = INSET + gutter;
  const left = (i: number) => `calc(${padL}px + (100% - ${padL + INSET}px) * ${frac(i)})`;
  const y = (v: number) => padTop + (1 - (v - lo) / (hi - lo)) * plotH;
  /** The top of a bar of value v, or the line's height for v: where a guide at v is drawn. */
  const guideTop = (v: number) => (kind === "bars" ? height - 1 - (v / hi) * (height - padTop - 1) : y(v));
  const labelOf = guideFormat ?? format;

  let lastRead = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (points[i].value !== null) {
      lastRead = i;
      break;
    }
  }

  // The line, broken at every day with no reading; and the flat wash under it
  // when the range starts at 0, so its height means something.
  const segments: Array<Array<{ i: number; v: number }>> = [];
  if (kind === "line") {
    let cur: Array<{ i: number; v: number }> = [];
    points.forEach((p, i) => {
      if (p.value === null) {
        if (cur.length) segments.push(cur);
        cur = [];
      } else cur.push({ i, v: p.value });
    });
    if (cur.length) segments.push(cur);
  }
  const sx = (i: number) => frac(i) * 100;
  const linePath = segments
    .filter((s) => s.length > 1)
    .map((s) => s.map((p, k) => `${k === 0 ? "M" : "L"} ${sx(p.i).toFixed(3)} ${y(p.v).toFixed(2)}`).join(" "))
    .join(" ");
  const base = y(Math.max(lo, 0));
  const areaPath =
    lo === 0
      ? segments
          .filter((s) => s.length > 1)
          .map(
            (s) =>
              `M ${sx(s[0].i).toFixed(3)} ${base.toFixed(2)} ` +
              s.map((p) => `L ${sx(p.i).toFixed(3)} ${y(p.v).toFixed(2)}`).join(" ") +
              ` L ${sx(s[s.length - 1].i).toFixed(3)} ${base.toFixed(2)} Z`,
          )
          .join(" ")
      : "";
  // A reading with no neighbour has no line to sit on: it gets its own dot.
  const lone = segments.filter((s) => s.length === 1).map((s) => s[0]);

  // The tallest bar carries its value (the latest, when several tie).
  let tallest = -1;
  if (kind === "bars") {
    points.forEach((p, i) => {
      if (p.value !== null && p.value > 0 && (tallest < 0 || p.value >= (points[tallest].value ?? 0))) tallest = i;
    });
  }

  const readout = (i: number) => {
    const p = points[i];
    return `${pointDay(p.date)}: ${p.value === null ? emptyOf(p.date) : format(p.value)}`;
  };

  const nearest = (clientX: number, el: HTMLElement): number | null => {
    if (n === 0) return null;
    const r = el.getBoundingClientRect();
    const inner = r.width - padL - INSET;
    if (inner <= 0) return null;
    const rel = (clientX - r.left - padL) / inner;
    const i = kind === "bars" ? Math.floor(rel * n) : Math.round(rel * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  };

  const shown = active !== null && active < n ? active : null;
  const shownPoint = shown !== null ? points[shown] : null;

  return (
    <figure style={{ margin: 0, minWidth: 0 }}>
      <div
        role="group"
        aria-roledescription="chart"
        aria-label={`${label}, ${n ? `${pointDay(points[0].date)} to ${pointDay(points[n - 1].date)}` : "no days"}. The arrow keys read each day.`}
        tabIndex={n ? 0 : -1}
        style={{ position: "relative", height, touchAction: "pan-y", outlineOffset: 4, borderRadius: 4, cursor: n ? "crosshair" : "default" }}
        onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget))}
        onPointerDown={(e) => setActive(nearest(e.clientX, e.currentTarget))}
        onPointerLeave={(e) => {
          // A finger lifting also leaves: its readout stays until the next tap elsewhere.
          if (e.pointerType === "mouse") setActive(null);
        }}
        onFocus={() => setActive((a) => (a === null ? (lastRead >= 0 ? lastRead : n - 1) : a))}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (n === 0) return;
          const cur = shown ?? (lastRead >= 0 ? lastRead : n - 1);
          let next: number;
          if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
          else if (e.key === "ArrowRight") next = Math.min(n - 1, cur + 1);
          else if (e.key === "Home") next = 0;
          else if (e.key === "End") next = n - 1;
          else if (e.key === "Escape") {
            setActive(null);
            return;
          } else return;
          e.preventDefault();
          setActive(next);
        }}
      >
        {/* The baseline: a hairline one step off the surface. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: gutter,
            right: 0,
            top: kind === "bars" ? height - 1 : Math.round(base),
            height: 1,
            background: "var(--color-border)",
            display: kind === "bars" || lo === 0 ? "block" : "none",
          }}
        />

        {gutter === 0 &&
          kind === "line" &&
          guides
            .filter((g) => g > lo && g <= hi)
            .map((g) => (
              <div key={g} aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: Math.round(y(g)), height: 1, background: "var(--color-border)" }}>
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    bottom: 3,
                    paddingRight: 4,
                    fontSize: 11,
                    lineHeight: "13px",
                    color: "var(--color-text-secondary)",
                    background: "var(--color-bg-card)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {labelOf(g)}
                </span>
              </div>
            ))}

        {/* With a gutter: each guide's hairline across the plot (none over the baseline) and its label in the gutter, on its line. */}
        {gutter > 0 &&
          guides
            .filter((g) => g >= lo && g <= hi)
            .map((g) => {
              const top = Math.round(guideTop(g));
              const onBaseline = g === lo && (kind === "bars" || lo === 0);
              return (
                <div key={g} aria-hidden="true" data-guide={labelOf(g)}>
                  {!onBaseline && (
                    <div style={{ position: "absolute", left: gutter, right: 0, top, height: 1, background: "var(--color-border)" }} />
                  )}
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      width: gutter - 6,
                      top: top - 7,
                      textAlign: "right",
                      fontSize: 11,
                      lineHeight: "14px",
                      color: "var(--color-text-secondary)",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {labelOf(g)}
                  </span>
                </div>
              );
            })}

        {kind === "line" && (
          <svg
            aria-hidden="true"
            viewBox={`0 0 100 ${height}`}
            preserveAspectRatio="none"
            style={{ position: "absolute", left: padL, right: INSET, top: 0, width: `calc(100% - ${padL + INSET}px)`, height, overflow: "visible" }}
          >
            {/* The kit's own accent tint (16% Airy Blue), flat. */}
            {areaPath && <path d={areaPath} style={{ fill: "var(--color-accent-glow)", stroke: "none" }} />}
            {linePath && (
              <path
                d={linePath}
                vectorEffect="non-scaling-stroke"
                style={{ fill: "none", stroke: ACCENT, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}
              />
            )}
          </svg>
        )}

        {kind === "bars" && (
          <div
            aria-hidden="true"
            style={{ position: "absolute", left: padL, right: INSET, top: padTop, bottom: 1, display: "flex", alignItems: "flex-end", gap: 2 }}
          >
            {points.map((p, i) => (
              <div
                key={p.date}
                style={{ flex: "1 1 0", minWidth: 0, height: "100%", position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
              >
                {p.value !== null && p.value > 0 && (
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 24,
                      height: `${(p.value / hi) * 100}%`,
                      borderRadius: "4px 4px 0 0",
                      background: ACCENT,
                      opacity: shown === null || shown === i ? 1 : 0.45,
                      transition: "opacity 150ms var(--ease-default)",
                    }}
                  />
                )}
                {i === tallest && p.value !== null && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: `calc(${(p.value / hi) * 100}% + 4px)`,
                      left: "50%",
                      transform: "translateX(-50%)",
                      fontSize: 12,
                      lineHeight: "14px",
                      color: "var(--color-text-secondary)",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {format(p.value)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {kind === "line" && lone.map((p) => <div key={p.i} aria-hidden="true" style={dotStyle(left(p.i), y(p.v))} />)}
        {kind === "line" && lastRead >= 0 && shown === null && (
          <div aria-hidden="true" style={dotStyle(left(lastRead), y(points[lastRead].value!))} />
        )}

        {shown !== null && (
          <>
            {kind === "line" && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: left(shown),
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: "var(--color-border-strong)",
                  pointerEvents: "none",
                }}
              />
            )}
            {kind === "line" && shownPoint?.value != null && (
              <div aria-hidden="true" style={dotStyle(left(shown), y(shownPoint.value))} />
            )}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: left(shown),
                bottom: "calc(100% + 6px)",
                transform: `translateX(-${frac(shown) * 100}%)`,
                zIndex: 3,
                pointerEvents: "none",
                whiteSpace: "nowrap",
                padding: "6px 10px",
                borderRadius: "var(--radius-chip)",
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border-strong)",
                fontSize: 12,
                lineHeight: "16px",
                color: "var(--color-text-secondary)",
              }}
            >
              <strong style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
                {shownPoint!.value === null ? emptyOf(shownPoint!.date) : format(shownPoint!.value)}
              </strong>{" "}
              {pointDay(shownPoint!.date)}
            </div>
          </>
        )}
      </div>

      {axis && n > 0 && (
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 8,
            paddingLeft: gutter,
            fontSize: 12,
            color: "var(--color-text-secondary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>{pointDay(points[0].date)}</span>
          {n > 1 && <span>{pointDay(points[n - 1].date)}</span>}
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {shown !== null ? readout(shown) : ""}
      </p>
      {/* In a div: sr-only cannot shrink a table itself (a table ignores the
          1px box and its overflow), and the full table stretched the page. */}
      <div className="sr-only">
        <table>
          <caption>{label}, per day</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">{label}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date}>
                <td>{pointDay(p.date)}</td>
                <td>{p.value === null ? emptyOf(p.date) : format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
