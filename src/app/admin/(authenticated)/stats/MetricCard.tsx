"use client";

import { Card, Pill, T } from "@/components/admin/ui";
import {
  WHOP_METRICS,
  WHOP_METRIC_NAMES,
  formatMetric,
} from "@/lib/whop-stats-catalog";
import type { TileResult, TileErrorReason } from "@/lib/whop-stats";
import { MetricChart } from "./MetricChart";

/**
 * One revenue tile: hero figure + delta + a two-series time chart.
 *
 * THE RULE THIS COMPONENT ENFORCES: a tile has three visually distinct
 * states and a failure can never look like a number.
 *
 *   ok       — figure, delta, chart, legend with both periods' values
 *   no_data  — an em-dash and "no data in this window", no chart
 *   error    — a warning pill naming the reason, no figure at all
 *
 * This platform already shipped a metric that printed 98% against a real
 * 57% for two months (CONTEXT.md:212-217). It did not crash — it printed a
 * believable number. $0 is a legal revenue figure and a legal chart
 * position, so there must be no code path from an absent value to a zero.
 *
 * Hero figures use PROPORTIONAL digits. tabular-nums on a large standalone
 * number makes it look loose; equal-width digits belong in axis ticks and
 * table rows, where numbers align vertically.
 */

const REASON_COPY: Record<TileErrorReason, string> = {
  auth: "Whop rejected the API key",
  scope: "API key is missing the stats:read scope",
  unknown_metric: "Whop no longer offers this metric",
  rate_limited: "Whop rate-limited this request",
  upstream_html: "Whop returned a malformed response",
  upstream_error: "Whop returned an error",
  unsupported: "Not available for the selected product",
  timeout: "Whop did not respond",
  not_renderable: "Withheld — this metric is not reproducible",
};

/** Compact axis tick: $12K, 1.2M, 24%. */
function tickFormatter(unit: "currency" | "count" | "percent") {
  return (v: number): string => {
    if (unit === "percent") return `${Math.round(v)}%`;
    const a = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    const pre = unit === "currency" ? "$" : "";
    if (a >= 1_000_000) return `${sign}${pre}${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
    if (a >= 1_000) return `${sign}${pre}${(a / 1_000).toFixed(a >= 10_000 ? 0 : 1)}K`;
    return `${sign}${pre}${unit === "currency" ? a.toFixed(0) : Math.round(a)}`;
  };
}

function deltaParts(
  value: number | null,
  previous: number | null,
): { text: string; tone: "success" | "danger" | "neutral" } | null {
  if (value == null || previous == null) return null;
  // A zero baseline has no meaningful percentage. "+100%" or "+∞%" for a
  // first sale is worse than showing nothing.
  if (previous === 0) return null;
  const diff = value - previous;
  const pct = (diff / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 0.05) return { text: "no change", tone: "neutral" };
  return {
    text: `${diff > 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`,
    tone: diff > 0 ? "success" : "danger",
  };
}

export function MetricCard({
  metricKey,
  tile,
  granularity,
  currentLabel,
  previousLabel,
  onRemove,
}: {
  metricKey: string;
  tile: TileResult;
  granularity: "day" | "week" | "month";
  currentLabel: string;
  previousLabel: string;
  onRemove?: () => void;
}) {
  const spec = WHOP_METRICS[metricKey];
  const title = WHOP_METRIC_NAMES[metricKey] ?? metricKey;

  const header = (
    <div className="flex items-start justify-between" style={{ gap: 8, marginBottom: 10 }}>
      <div style={{ ...T.eyebrow, minWidth: 0 }}>{title}</div>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-tertiary)",
            fontSize: 15,
            lineHeight: 1,
            padding: 0,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );

  if (tile.status === "error") {
    return (
      <Card padding={16}>
        {header}
        <div style={{ marginBottom: 8 }}>
          <Pill tone="warning">unavailable</Pill>
        </div>
        <div style={{ ...T.meta, lineHeight: 1.5 }}>{REASON_COPY[tile.reason]}</div>
      </Card>
    );
  }

  if (tile.status === "no_data") {
    return (
      <Card padding={16}>
        {header}
        <div
          style={{
            fontSize: 30,
            fontWeight: 600,
            color: "var(--color-text-tertiary)",
            letterSpacing: "-0.022em",
            lineHeight: 1.1,
          }}
        >
          —
        </div>
        <div style={{ ...T.meta, marginTop: 6 }}>no data in this window</div>
      </Card>
    );
  }

  const delta = deltaParts(tile.value, tile.previousValue);
  const fmt = (v: number | null) => formatMetric(metricKey, v);
  const labelAt = (t: number) => {
    const d = new Date(t * 1000);
    return granularity === "month"
      ? d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };

  return (
    <Card
      padding={16}
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      {header}

      <div className="flex items-baseline" style={{ gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: "-0.022em",
            color: "var(--color-text-primary)",
            lineHeight: 1.1,
            // Proportional digits, deliberately. See the header note.
          }}
        >
          {fmt(tile.value)}
        </span>
        {delta && <Pill tone={delta.tone}>{delta.text}</Pill>}
      </div>

      <div style={{ marginTop: 14 }}>
        <MetricChart
          points={tile.points}
          previous={tile.previousPoints}
          format={fmt}
          formatTick={tickFormatter(tile.unit)}
          labelAt={labelAt}
          currentLabel={currentLabel}
          previousLabel={previousLabel}
          currentTotal={fmt(tile.value)}
          previousTotal={tile.previousValue != null ? fmt(tile.previousValue) : undefined}
          trailingPartial={tile.trailingPartial}
        />
      </div>

      {/* METRIC-SPECIFIC caveats only. An unstated caveat is how a number
          gets trusted when it should not be — but a caveat repeated on every
          card is just noise, so window-level ones (an incomplete final
          period) live on the page header instead.
          marginTop:auto pins this block to the card bottom so it lines up
          across a row instead of floating under whichever chart is shortest. */}
      <div style={{ ...T.meta, marginTop: "auto", paddingTop: 10, lineHeight: 1.5 }}>
        {spec?.agg === "RATIO" && <div>Recomputed per window, not summed.</div>}
        {(spec?.agg === "LEVEL_FIRST" || spec?.agg === "LEVEL_LAST") && (
          <div>Point-in-time level — the latest day in range, never a total.</div>
        )}
        {tile.historyTruncated && (
          <div>
            Whop has no data before {tile.historyTruncated.actualFrom} (asked from{" "}
            {tile.historyTruncated.requestedFrom}).
          </div>
        )}
        {spec?.usable === "degraded" && spec.note && <div>{spec.note}</div>}
      </div>
    </Card>
  );
}
