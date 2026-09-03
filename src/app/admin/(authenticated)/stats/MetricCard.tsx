"use client";

import { Card, Pill, T } from "@/components/admin/ui";
import {
  WHOP_METRICS,
  WHOP_METRIC_NAMES,
  formatMetric,
} from "@/lib/whop-stats-catalog";
import type { TileResult, TileErrorReason } from "@/lib/whop-stats";
import { Sparkline } from "./Sparkline";

/**
 * One revenue tile.
 *
 * THE RULE THIS COMPONENT EXISTS TO ENFORCE: a tile has three visually
 * distinct states and a failure can never look like a number.
 *
 *   ok       — a value, a delta, a sparkline
 *   no_data  — "no data in this window", dimmed, no chart
 *   error    — a warning pill naming the reason, no value at all
 *
 * This platform has already shipped a metric that printed 98% against a
 * real 57% for two months (CONTEXT.md:212-217). The failure mode was not
 * a crash — it was a believable number. $0 is a legal revenue figure and
 * a legal chart position, so the renderer must never be able to produce
 * one from an absent value.
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

function deltaParts(
  value: number | null,
  previous: number | null,
): { text: string; tone: "success" | "danger" | "neutral" } | null {
  if (value == null || previous == null) return null;
  // A 0 baseline has no meaningful percentage. Showing "+∞%" or "+100%"
  // for a first sale is worse than showing nothing.
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
  onRemove,
}: {
  metricKey: string;
  tile: TileResult;
  granularity: "day" | "week" | "month";
  onRemove?: () => void;
}) {
  const spec = WHOP_METRICS[metricKey];
  const title = WHOP_METRIC_NAMES[metricKey] ?? metricKey;

  const header = (
    <div
      className="flex items-start justify-between"
      style={{ gap: 8, marginBottom: 10 }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ ...T.eyebrow, whiteSpace: "nowrap" }}>{title}</div>
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-tertiary)",
            fontSize: 14,
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

  // ── error ────────────────────────────────────────────────────────────
  if (tile.status === "error") {
    return (
      <Card padding={14}>
        {header}
        <div style={{ marginBottom: 8 }}>
          <Pill tone="warning">unavailable</Pill>
        </div>
        <div style={{ ...T.meta, lineHeight: 1.4 }}>
          {REASON_COPY[tile.reason]}
        </div>
      </Card>
    );
  }

  // ── no data ──────────────────────────────────────────────────────────
  if (tile.status === "no_data") {
    return (
      <Card padding={14}>
        {header}
        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: "var(--color-text-tertiary)",
            letterSpacing: "-0.02em",
          }}
        >
          —
        </div>
        <div style={{ ...T.meta, marginTop: 4 }}>no data in this window</div>
      </Card>
    );
  }

  // ── ok ───────────────────────────────────────────────────────────────
  const delta = deltaParts(tile.value, tile.previousValue);
  const trendColor =
    delta?.tone === "success"
      ? "var(--color-success, #16a34a)"
      : delta?.tone === "danger"
        ? "var(--color-danger, #dc2626)"
        : "var(--color-accent-dark)";

  const fmt = (v: number | null) => formatMetric(metricKey, v);
  const labelAt = (t: number) => {
    const d = new Date(t * 1000);
    return granularity === "month"
      ? d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };

  return (
    <Card padding={14}>
      {header}

      <div className="flex items-baseline" style={{ gap: 8, flexWrap: "wrap" }}>
        <span
          className="stat-value"
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "var(--color-text-primary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {fmt(tile.value)}
        </span>
        {delta && <Pill tone={delta.tone}>{delta.text}</Pill>}
      </div>

      <div style={{ marginTop: 10 }}>
        <Sparkline
          points={tile.points}
          color={trendColor}
          trailingPartial={tile.trailingPartial}
          format={fmt}
          labelAt={labelAt}
        />
      </div>

      {/* Every caveat is printed on the card. An unstated caveat is how a
          number becomes trusted when it should not be. */}
      <div style={{ ...T.meta, marginTop: 8, lineHeight: 1.5 }}>
        {spec?.agg === "RATIO" && <div>Recomputed per window, not summed.</div>}
        {spec?.agg === "LEVEL_FIRST" || spec?.agg === "LEVEL_LAST" ? (
          <div>Point-in-time level. Shows the latest day in range.</div>
        ) : null}
        {tile.trailingPartial && <div>Final period is incomplete (shaded).</div>}
        {tile.historyTruncated && (
          <div>
            Whop has no data before {tile.historyTruncated.actualFrom} (asked
            from {tile.historyTruncated.requestedFrom}).
          </div>
        )}
        {spec?.usable === "degraded" && spec.note && <div>{spec.note}</div>}
      </div>
    </Card>
  );
}
