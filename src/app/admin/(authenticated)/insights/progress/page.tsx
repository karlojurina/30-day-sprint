"use client";

/**
 * /admin/insights/progress — platform health insights.
 *
 * Four trend charts driven by daily_progress_snapshots:
 *   - Avg progress (%)
 *   - Active students
 *   - Joined per day
 *   - Churned per day
 *
 * Plus a pace breakdown card (behind / on pace / ahead counts) for
 * students currently on the 30-day journey, sourced from the same
 * useJourneyPaceCounts hook the sidebar badge uses.
 *
 * UX:
 *   - Range presets (7/30/90/all) AND custom from/to date pickers
 *   - Hover anywhere on a chart → vertical scrubber + tooltip with
 *     exact value + date at that x position
 *   - Charts are 1-up full width (was 2x2 small grid) so the trend
 *     is actually readable
 *
 * Data sources: nightly cron at /api/cron/snapshot-progress writes
 * one row per day. Migrations v31 + v32 seeded the first 14 days.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import {
  AdminPage,
  PageHeader,
  Card,
  EmptyState,
  T,
} from "@/components/admin/ui";
import { useJourneyPaceCounts } from "@/lib/useJourneyPaceCounts";
import { ADMIN_STUDENT_JOIN_CUTOFF } from "@/lib/constants";

interface SnapshotRow {
  snapshot_date: string;
  active_students: number;
  total_completions: number;
  avg_progress: number;
  active_count: number | null;
  joined_count: number | null;
  churned_count: number | null;
}

type RangePreset = "7" | "30" | "90" | "all" | "custom";

const PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "all", label: "All" },
];

type MetricKey =
  | "avg_progress"
  | "active_count"
  | "joined_count"
  | "churned_count";

interface MetricDef {
  label: string;
  description: string;
  suffix: string;
  color: string;
  /** "running" = latest snapshot value; "flow" = sum across window. */
  mode: "running" | "flow";
  chartMode?: "running" | "flow";
}

const METRICS: Record<MetricKey, MetricDef> = {
  avg_progress: {
    label: "Avg progress",
    description: "Average completion % across active students.",
    suffix: "%",
    color: "var(--color-accent-dark)",
    mode: "running",
  },
  active_count: {
    label: "Active students",
    description:
      "Students with active sprint membership (post-cutoff cohort).",
    suffix: "",
    color: "#5bb88e",
    mode: "running",
  },
  joined_count: {
    label: "Joined",
    description: "New students per day.",
    suffix: "",
    color: "var(--color-accent-dark)",
    mode: "flow",
    chartMode: "running",
  },
  churned_count: {
    label: "Churned",
    description: "Memberships canceled per day.",
    suffix: "",
    color: "var(--color-danger)",
    mode: "flow",
    chartMode: "running",
  },
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

export default function ProgressInsightsPage() {
  const supabase = createClient();
  const [preset, setPreset] = useState<RangePreset>("30");
  const [customFrom, setCustomFrom] = useState(daysAgoIso(30));
  const [customTo, setCustomTo] = useState(todayIso());
  const [points, setPoints] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const paceCounts = useJourneyPaceCounts();
  const bounty = useBountyInsights();
  const sprinters = useCurrentSprinterProgress();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const url =
        preset === "custom"
          ? `/api/admin/insights/progress?from=${customFrom}&to=${customTo}`
          : `/api/admin/insights/progress?range=${preset}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { points: pts } = await res.json();
      setPoints(
        (pts as SnapshotRow[]).map((r) => ({
          ...r,
          avg_progress: Number(r.avg_progress),
          active_students: Number(r.active_students),
          total_completions: Number(r.total_completions),
          active_count: r.active_count == null ? null : Number(r.active_count),
          joined_count: r.joined_count == null ? null : Number(r.joined_count),
          churned_count:
            r.churned_count == null ? null : Number(r.churned_count),
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [preset, customFrom, customTo, supabase]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const summary = useMemo(() => {
    if (points.length === 0) return null;
    const last = points[points.length - 1];
    const first = points[0];
    function metric(key: MetricKey, mode: "running" | "flow") {
      if (mode === "running") {
        const lastV = (last[key] as number | null) ?? null;
        const firstV = (first[key] as number | null) ?? null;
        const delta = lastV != null && firstV != null ? lastV - firstV : null;
        return { current: lastV, delta };
      }
      const total = points.reduce(
        (sum, p) => sum + ((p[key] as number | null) ?? 0),
        0,
      );
      return { current: total, delta: null };
    }
    return {
      avg_progress: metric("avg_progress", "running"),
      active_count: metric("active_count", "running"),
      joined_count: metric("joined_count", "flow"),
      churned_count: metric("churned_count", "flow"),
    } as Record<MetricKey, { current: number | null; delta: number | null }>;
  }, [points]);

  return (
    <AdminPage>
      <PageHeader
        title="Insights"
        description="Daily snapshots of platform health. Cron writes one row at 00:30 UTC."
      />

      {/* Range controls — presets on the left, custom from/to on the right */}
      <div
        className="flex items-center"
        style={{
          gap: 12,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        <div
          className="inline-flex items-center"
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            padding: 3,
            gap: 2,
          }}
        >
          {PRESETS.map((p) => {
            const active = preset === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setPreset(p.value)}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 7,
                  border: "none",
                  background: active
                    ? "var(--color-bg-elevated)"
                    : "transparent",
                  color: active
                    ? "var(--color-text-primary)"
                    : "var(--color-text-secondary)",
                  cursor: "pointer",
                  letterSpacing: "-0.005em",
                }}
              >
                {p.label}
              </button>
            );
          })}
          <span
            aria-hidden="true"
            style={{
              width: 1,
              alignSelf: "stretch",
              background: "var(--color-border)",
              margin: "2px 4px",
            }}
          />
          <button
            type="button"
            onClick={() => setPreset("custom")}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 7,
              border: "none",
              background:
                preset === "custom"
                  ? "var(--color-bg-elevated)"
                  : "transparent",
              color:
                preset === "custom"
                  ? "var(--color-text-primary)"
                  : "var(--color-text-secondary)",
              cursor: "pointer",
              letterSpacing: "-0.005em",
            }}
          >
            Custom
          </button>
        </div>

        {preset === "custom" && (
          <div className="flex items-center" style={{ gap: 8 }}>
            <DateInput
              value={customFrom}
              onChange={setCustomFrom}
              label="From"
            />
            <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>
              →
            </span>
            <DateInput
              value={customTo}
              onChange={setCustomTo}
              label="To"
              max={todayIso()}
            />
          </div>
        )}
      </div>

      {/* Pace breakdown card — uses the same source as the journey nav badge */}
      <PaceBreakdownCard counts={paceCounts} />

      {/* Current sprinters card - avg progress for students still WITHIN
          their 30-day window. The chart below ("Avg progress") includes
          graduates and so trends upward forever; this number is the
          honest "are people in the sprint progressing" signal. */}
      <CurrentSprintersCard data={sprinters} />

      {/* Bounty Access funnel — sourced from student_milestones (Zak's
          webhook stamps bounty_access_claimed_at; students self-report
          first_client_landed_at on Map 2). */}
      <BountyAccessCard data={bounty} />

      {error && (
        <div
          style={{
            background: "rgba(200,74,74,0.10)",
            border: "1px solid rgba(200,74,74,0.30)",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--color-danger)",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div
          className="flex items-center justify-center"
          style={{ padding: 64 }}
        >
          <div
            className="rounded-full animate-spin"
            style={{
              width: 22,
              height: 22,
              border: "2px solid var(--color-accent-dark)",
              borderTopColor: "transparent",
            }}
          />
        </div>
      ) : points.length === 0 ? (
        <Card>
          <EmptyState
            title="No snapshots yet."
            description="Once the nightly cron writes a few rows you'll see trends here."
          />
        </Card>
      ) : (
        <div
          className="grid"
          style={{ gridTemplateColumns: "minmax(0, 1fr)", gap: 16 }}
        >
          {(Object.keys(METRICS) as MetricKey[]).map((key) => (
            <MetricCard
              key={key}
              def={METRICS[key]}
              points={points}
              valueKey={key}
              summary={summary?.[key]}
            />
          ))}
        </div>
      )}

      <CalcTransparency />
    </AdminPage>
  );
}

function DateInput({
  value,
  onChange,
  label,
  max,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  max?: string;
}) {
  return (
    <label
      className="inline-flex items-center"
      style={{
        gap: 6,
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: "5px 10px",
        fontSize: 12,
      }}
    >
      <span
        style={{
          color: "var(--color-text-tertiary)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        max={max}
        style={{
          border: "none",
          background: "transparent",
          color: "var(--color-text-primary)",
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          padding: 0,
          minWidth: 110,
        }}
      />
    </label>
  );
}

/** Three-way pace stat card — same data as the sidebar badge but in
 *  big detailed numbers with descriptions. */
function PaceBreakdownCard({
  counts,
}: {
  counts: ReturnType<typeof useJourneyPaceCounts>;
}) {
  return (
    <div
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "18px 20px",
        marginBottom: 16,
      }}
    >
      <div className="flex items-baseline" style={{ marginBottom: 12, gap: 8 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.012em",
          }}
        >
          Pace right now
        </h3>
        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-tertiary)",
          }}
        >
          Students currently on the 30-day journey
          {counts.loading ? "" : ` · ${counts.total} total`}
        </span>
      </div>
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}
      >
        <PaceCell
          label="Behind"
          value={counts.behind}
          total={counts.total}
          color="var(--color-danger)"
          description="< 0.5× expected pace. Worth a check-in."
          loading={counts.loading}
        />
        <PaceCell
          label="On pace"
          value={counts.on_pace}
          total={counts.total}
          color="var(--color-text-primary)"
          description="Within 0.5× – 1.5× of expected. Healthy."
          loading={counts.loading}
        />
        <PaceCell
          label="Ahead"
          value={counts.ahead}
          total={counts.total}
          color="var(--color-success)"
          description="> 1.5× expected pace. Crushing it."
          loading={counts.loading}
        />
      </div>
    </div>
  );
}

function PaceCell({
  label,
  value,
  total,
  color,
  description,
  loading,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  description: string;
  loading: boolean;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div
      style={{
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <p
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary)",
          marginBottom: 6,
        }}
      >
        {label}
      </p>
      <div className="flex items-baseline" style={{ gap: 8, marginBottom: 6 }}>
        <span
          style={{
            fontSize: 28,
            fontWeight: 600,
            color,
            letterSpacing: "-0.022em",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {loading ? "—" : value}
        </span>
        {!loading && total > 0 && (
          <span
            style={{
              fontSize: 12,
              color: "var(--color-text-tertiary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {pct}%
          </span>
        )}
      </div>
      <p
        style={{
          fontSize: 11,
          color: "var(--color-text-tertiary)",
          lineHeight: 1.4,
        }}
      >
        {description}
      </p>
    </div>
  );
}

function MetricCard({
  def,
  points,
  valueKey,
  summary,
}: {
  def: MetricDef;
  points: SnapshotRow[];
  valueKey: MetricKey;
  summary: { current: number | null; delta: number | null } | undefined;
}) {
  const current = summary?.current;
  const delta = summary?.delta;
  return (
    <section
      style={{
        background: "var(--color-bg-card)",
        borderRadius: 12,
        padding: 20,
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.014em",
          }}
        >
          {def.label}
        </h3>
        {current != null && (
          <p
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "var(--color-text-primary)",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.022em",
            }}
          >
            {def.mode === "running"
              ? `${current}${def.suffix}`
              : `${current} total`}
          </p>
        )}
      </div>

      <p
        style={{
          fontSize: 12,
          color: "var(--color-text-tertiary)",
          marginBottom: 6,
        }}
      >
        {def.description}
      </p>

      {def.mode === "running" && delta != null && (
        <p
          style={{
            fontSize: 12,
            color:
              (valueKey === "churned_count" ? -delta : delta) > 0
                ? "var(--color-success)"
                : (valueKey === "churned_count" ? -delta : delta) < 0
                  ? "var(--color-danger)"
                  : "var(--color-text-tertiary)",
            fontVariantNumeric: "tabular-nums",
            marginBottom: 14,
          }}
        >
          {delta > 0 ? "↑ +" : delta < 0 ? "↓ " : "→ "}
          {Math.abs(delta).toFixed(valueKey === "avg_progress" ? 1 : 0)}
          {def.suffix} vs start of range
        </p>
      )}

      <Chart
        points={points}
        valueKey={valueKey}
        color={def.color}
        suffix={def.suffix}
        mode={def.chartMode ?? def.mode}
      />
    </section>
  );
}

function Chart({
  points,
  valueKey,
  color,
  suffix,
  mode,
}: {
  points: SnapshotRow[];
  valueKey: MetricKey;
  color: string;
  suffix: string;
  mode: "running" | "flow";
}) {
  const W = 1000;
  const H = 280;
  const PAD = 40;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const series = useMemo(
    () =>
      points
        .map((p) => ({
          date: p.snapshot_date,
          v: (p[valueKey] as number | null) ?? 0,
        }))
        .filter((p) => p.v != null),
    [points, valueKey],
  );

  if (series.length < 2) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: "center",
          fontSize: 12,
          color: "var(--color-text-tertiary)",
          fontStyle: "italic",
        }}
      >
        Not enough data points yet.
      </div>
    );
  }

  const ys = series.map((p) => p.v);
  const minY = 0;
  const maxY = Math.max(...ys, 1);
  const rangeY = Math.max(1, maxY - minY);
  const lineStepX = (W - PAD * 2) / Math.max(1, series.length - 1);
  const slotW = (W - PAD * 2) / series.length;
  const barW = Math.min(slotW * 0.7, 36);

  const linePoint = (i: number, v: number) => ({
    x: PAD + i * lineStepX,
    y: H - PAD - ((v - minY) / rangeY) * (H - PAD * 2),
  });
  const barPoint = (i: number, v: number) => ({
    x: PAD + (i + 0.5) * slotW - barW / 2,
    y: H - PAD - ((v - minY) / rangeY) * (H - PAD * 2),
  });

  const pathPts = series.map((p, i) => linePoint(i, p.v));
  const linePath = pathPts
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");
  const areaPath =
    `M ${pathPts[0].x} ${H - PAD} ` +
    pathPts.map((p) => `L ${p.x} ${p.y}`).join(" ") +
    ` L ${pathPts[pathPts.length - 1].x} ${H - PAD} Z`;

  const ticks = [
    minY,
    Math.round(((minY + maxY) / 2) * 10) / 10,
    maxY,
  ];

  /** Map a clientX (relative to SVG) to the nearest series index. */
  function clientXToIndex(e: React.MouseEvent<SVGSVGElement>) {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const scale = W / rect.width;
    const svgX = (e.clientX - rect.left) * scale;
    const inner = Math.max(0, Math.min(W - PAD * 2, svgX - PAD));
    const step = mode === "flow" ? slotW : lineStepX;
    const i = Math.round(inner / step);
    return Math.max(0, Math.min(series.length - 1, i));
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseMove={(e) => setHoverIdx(clientXToIndex(e))}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Y-axis grid + labels */}
        {ticks.map((t) => {
          const y = H - PAD - ((t - minY) / rangeY) * (H - PAD * 2);
          return (
            <g key={t}>
              <line
                x1={PAD}
                x2={W - PAD}
                y1={y}
                y2={y}
                stroke="var(--color-border)"
                strokeWidth={0.5}
              />
              <text
                x={PAD - 8}
                y={y + 3}
                fontSize={10}
                fill="var(--color-text-tertiary)"
                textAnchor="end"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {Math.round(t)}
                {suffix}
              </text>
            </g>
          );
        })}

        {/* Series */}
        {mode === "flow" ? (
          series.map((p, i) => {
            const { x, y } = barPoint(i, p.v);
            const h = Math.max(0, H - PAD - y);
            if (p.v === 0) return null;
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={3}
                fill={color}
                opacity={hoverIdx === i ? 1 : 0.7}
              />
            );
          })
        ) : (
          <>
            <path d={areaPath} fill={color} fillOpacity={0.10} />
            <path
              d={linePath}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {pathPts.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={hoverIdx === i ? 4 : 2.5}
                fill={color}
              />
            ))}
          </>
        )}

        {/* Scrubber — vertical guide at the hovered index */}
        {hoverIdx != null &&
          (() => {
            const p =
              mode === "flow"
                ? PAD + (hoverIdx + 0.5) * slotW
                : PAD + hoverIdx * lineStepX;
            return (
              <line
                x1={p}
                x2={p}
                y1={PAD - 6}
                y2={H - PAD}
                stroke="var(--color-text-tertiary)"
                strokeWidth={1}
                strokeDasharray="3 3"
                pointerEvents="none"
              />
            );
          })()}

        {/* X-axis labels: first / mid / last */}
        {(() => {
          const lastIdx = series.length - 1;
          const midIdx = Math.floor(lastIdx / 2);
          const unique = Array.from(new Set([0, midIdx, lastIdx]));
          return unique.map((i, k) => {
            const anchor: "start" | "middle" | "end" =
              i === 0 ? "start" : i === lastIdx ? "end" : "middle";
            const px =
              mode === "flow"
                ? PAD + (i + 0.5) * slotW
                : PAD + i * lineStepX;
            return (
              <text
                key={k}
                x={px}
                y={H - PAD + 18}
                fontSize={10}
                fill="var(--color-text-tertiary)"
                textAnchor={anchor}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {series[i].date.slice(5)}
              </text>
            );
          });
        })()}
      </svg>

      {/* Tooltip — absolutely positioned over the chart at hover x */}
      {hoverIdx != null && (
        <ChartTooltip
          date={series[hoverIdx].date}
          value={series[hoverIdx].v}
          suffix={suffix}
          xPercent={
            (mode === "flow"
              ? PAD + (hoverIdx + 0.5) * slotW
              : PAD + hoverIdx * lineStepX) / W
          }
        />
      )}
    </div>
  );
}

function ChartTooltip({
  date,
  value,
  suffix,
  xPercent,
}: {
  date: string;
  value: number;
  suffix: string;
  xPercent: number;
}) {
  // Clamp left edge so the tooltip never spills past the chart.
  const leftPct = Math.min(Math.max(xPercent * 100, 4), 92);
  return (
    <div
      style={{
        position: "absolute",
        top: 6,
        left: `${leftPct}%`,
        transform: "translateX(-50%)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 11,
        pointerEvents: "none",
        boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
        whiteSpace: "nowrap",
      }}
    >
      <div
        style={{
          color: "var(--color-text-tertiary)",
          fontSize: 10,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {date}
      </div>
      <div
        style={{
          color: "var(--color-text-primary)",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          fontSize: 14,
          marginTop: 1,
        }}
      >
        {value}
        {suffix}
      </div>
    </div>
  );
}

function CalcTransparency() {
  return (
    <section
      style={{
        marginTop: 32,
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: 18,
      }}
    >
      <h3
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          letterSpacing: "-0.005em",
          marginBottom: 8,
        }}
      >
        How these are calculated
      </h3>
      <ul
        style={{
          listStyle: "disc",
          paddingLeft: 18,
          fontSize: 12,
          color: "var(--color-text-tertiary)",
          lineHeight: 1.7,
        }}
      >
        <li>
          <strong>Avg progress</strong> &mdash; mean of completion % across
          every active student (including graduates at 100%). Trends upward
          monotonically until churn or new joiners drag it down. For a
          cleaner "are current sprinters progressing" signal, see the
          live current-sprinters tile above the trends.
        </li>
        <li>
          <strong>Active students</strong> &mdash; <code>membership_status</code>{" "}
          in (<code>active</code>, <code>past_due</code>) at snapshot time.
        </li>
        <li>
          <strong>Joined</strong> / <strong>Churned</strong> &mdash; new /
          canceled memberships for that day; bars show daily counts and the
          summary number is the window sum.
        </li>
        <li>
          <strong>Pace right now</strong> &mdash; live count of students on the
          30-day journey grouped by pace label (
          <code>completedLessons / expectedLessons</code> per{" "}
          <code>buildPaceSummary</code>). Behind = ratio &lt; 0.5, Ahead =
          ratio &gt; 1.5.
        </li>
        <li>
          <strong>Bounty Program · joined</strong> &mdash; live count of
          students who completed the course and onboarded to the Bounty
          Program. Sourced from <code>student_milestones.bounty_access_claimed_at</code>,
          stamped exclusively by Zak&rsquo;s{" "}
          <code>/api/webhooks/adbounty</code>.
        </li>
      </ul>
    </section>
  );
}

/* ─── Bounty insights ─── */
//
// Trendline + range comparison: are more people joining the Bounty
// Program this period vs the previous one? That's the whole point of
// tracking it. The card pulls every enrollment timestamp once, then
// the range toggle re-windows the same data in JS.

type BountyRange = "7" | "30" | "90" | "all";

interface BountyInsights {
  loading: boolean;
  /** All enrollment claim timestamps (ISO), sorted ascending. */
  claimedAts: string[];
}

function useBountyInsights(): BountyInsights {
  const supabase = createClient();
  const [data, setData] = useState<BountyInsights>({
    loading: true,
    claimedAts: [],
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const { data: rows } = await supabase
        .from("student_milestones")
        .select("bounty_access_claimed_at")
        .not("bounty_access_claimed_at", "is", null)
        .order("bounty_access_claimed_at", { ascending: true });
      if (cancelled) return;
      const claimedAts = (rows ?? [])
        .map((r) => r.bounty_access_claimed_at as string)
        .filter(Boolean);
      setData({ loading: false, claimedAts });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return data;
}

/** Bucket enrollments by date (YYYY-MM-DD), zero-filled between
 *  the from/to bounds so the sparkline doesn't collapse empty days. */
function bucketByDay(
  claimedAts: string[],
  fromDay: number,
  toDay: number,
): Array<{ date: string; count: number }> {
  const counts = new Map<string, number>();
  for (const ts of claimedAts) {
    const day = ts.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const out: Array<{ date: string; count: number }> = [];
  // fromDay/toDay are ms timestamps (UTC midnight).
  for (let t = fromDay; t <= toDay; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ date: day, count: counts.get(day) ?? 0 });
  }
  return out;
}

function BountyAccessCard({ data }: { data: BountyInsights }) {
  const [range, setRange] = useState<BountyRange>("30");

  const totalAllTime = data.claimedAts.length;

  // Window math: "current" is the last N days inclusive of today,
  // "prior" is the N days immediately before that.
  const todayMidnight =
    Math.floor(Date.now() / 86_400_000) * 86_400_000;
  const days =
    range === "all" ? null : Number.parseInt(range, 10);

  const currentFrom =
    days != null ? todayMidnight - (days - 1) * 86_400_000 : null;
  const priorFrom =
    days != null ? todayMidnight - (2 * days - 1) * 86_400_000 : null;
  const priorTo =
    days != null ? todayMidnight - days * 86_400_000 : null;

  const currentCount =
    days == null
      ? totalAllTime
      : data.claimedAts.filter(
          (ts) => new Date(ts).getTime() >= (currentFrom ?? 0),
        ).length;
  const priorCount =
    days == null || priorFrom == null || priorTo == null
      ? null
      : data.claimedAts.filter((ts) => {
          const t = new Date(ts).getTime();
          return t >= priorFrom && t <= priorTo;
        }).length;

  const delta =
    priorCount == null ? null : currentCount - priorCount;
  const deltaPct =
    priorCount == null || priorCount === 0
      ? null
      : Math.round(((currentCount - priorCount) / priorCount) * 100);

  // Sparkline series: zero-filled per day across the current range
  // (or all-time bucketed by week when range = all).
  const series = useMemo(() => {
    if (data.loading) return [];
    if (range === "all") {
      if (data.claimedAts.length === 0) return [];
      const first =
        Math.floor(new Date(data.claimedAts[0]).getTime() / 86_400_000) *
        86_400_000;
      return bucketByDay(data.claimedAts, first, todayMidnight);
    }
    if (currentFrom == null) return [];
    return bucketByDay(data.claimedAts, currentFrom, todayMidnight);
  }, [data.claimedAts, data.loading, range, currentFrom, todayMidnight]);

  return (
    <div
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "18px 20px",
        marginBottom: 16,
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 12, gap: 12, flexWrap: "wrap" }}
      >
        <div>
          <p style={{ ...T.eyebrow, marginBottom: 4 }}>
            Bounty Program · joined
          </p>
          <p
            style={{
              fontSize: 11,
              color: "var(--color-text-tertiary)",
            }}
          >
            {data.loading
              ? ""
              : `${totalAllTime} total all-time · stamped by Zak's webhook`}
          </p>
        </div>
        <BountyRangeToggle value={range} onChange={setRange} />
      </div>

      <div
        className="flex items-baseline"
        style={{ gap: 14, flexWrap: "wrap", marginBottom: 14 }}
      >
        <p
          style={{
            fontSize: 40,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.024em",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {data.loading ? "—" : currentCount}
        </p>
        {!data.loading && delta != null && (
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color:
                delta > 0
                  ? "var(--color-success)"
                  : delta < 0
                    ? "var(--color-danger)"
                    : "var(--color-text-tertiary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {delta > 0 ? "↑ +" : delta < 0 ? "↓ " : "→ "}
            {Math.abs(delta)}
            {deltaPct != null && ` (${deltaPct > 0 ? "+" : ""}${deltaPct}%)`}
            <span style={{ color: "var(--color-text-tertiary)" }}>
              {" "}
              vs prior {range === "7"
                ? "week"
                : range === "30"
                  ? "month"
                  : range === "90"
                    ? "3 months"
                    : ""}
            </span>
          </span>
        )}
        {!data.loading && delta == null && range !== "all" && (
          <span
            style={{
              fontSize: 12,
              color: "var(--color-text-tertiary)",
            }}
          >
            No prior-period baseline yet
          </span>
        )}
      </div>

      <BountySparkline series={series} loading={data.loading} />

      <p
        style={{
          fontSize: 11,
          color: "var(--color-text-tertiary)",
          marginTop: 10,
          lineHeight: 1.4,
        }}
      >
        Students who finished the course and onboarded to the Bounty
        Program. Compare windows side-by-side to spot momentum.
      </p>
    </div>
  );
}

function BountyRangeToggle({
  value,
  onChange,
}: {
  value: BountyRange;
  onChange: (v: BountyRange) => void;
}) {
  const opts: Array<{ v: BountyRange; label: string }> = [
    { v: "7", label: "Week" },
    { v: "30", label: "Month" },
    { v: "90", label: "3 months" },
    { v: "all", label: "All" },
  ];
  return (
    <div
      className="inline-flex items-center"
      style={{
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: 2,
        gap: 2,
      }}
    >
      {opts.map((o) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            style={{
              padding: "5px 10px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 6,
              border: "none",
              background: active ? "var(--color-bg-card)" : "transparent",
              color: active
                ? "var(--color-text-primary)"
                : "var(--color-text-secondary)",
              cursor: "pointer",
              letterSpacing: "-0.005em",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function BountySparkline({
  series,
  loading,
}: {
  series: Array<{ date: string; count: number }>;
  loading: boolean;
}) {
  if (loading) return null;
  if (series.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          fontSize: 12,
          color: "var(--color-text-tertiary)",
          fontStyle: "italic",
          border: "1px dashed var(--color-border)",
          borderRadius: 8,
        }}
      >
        No bounty enrollments yet.
      </div>
    );
  }
  const W = 1000;
  const H = 100;
  const PAD = 12;
  const max = Math.max(1, ...series.map((p) => p.count));
  const slotW = (W - PAD * 2) / series.length;
  const barW = Math.min(slotW * 0.7, 20);
  const baseline = H - PAD;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: 100, display: "block" }}
      aria-label="Bounty enrollments per day"
    >
      <line
        x1={PAD}
        x2={W - PAD}
        y1={baseline}
        y2={baseline}
        stroke="var(--color-border)"
        strokeWidth={0.5}
      />
      {series.map((p, i) => {
        const x = PAD + (i + 0.5) * slotW - barW / 2;
        const h = (p.count / max) * (H - PAD * 2);
        const y = baseline - h;
        if (p.count === 0) return null;
        return (
          <rect
            key={`${p.date}-${i}`}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={2}
            fill="var(--color-accent-dark)"
          >
            <title>
              {p.date}: {p.count} enrollment{p.count === 1 ? "" : "s"}
            </title>
          </rect>
        );
      })}
      {/* First / last date labels */}
      <text
        x={PAD}
        y={H - 1}
        fontSize={9}
        fill="var(--color-text-tertiary)"
        textAnchor="start"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {series[0].date.slice(5)}
      </text>
      <text
        x={W - PAD}
        y={H - 1}
        fontSize={9}
        fill="var(--color-text-tertiary)"
        textAnchor="end"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {series[series.length - 1].date.slice(5)}
      </text>
    </svg>
  );
}

function BountyCell({
  label,
  value,
  sublabel,
  color,
  loading,
  suffix = "",
}: {
  label: string;
  value: number;
  sublabel: string;
  color: string;
  loading: boolean;
  suffix?: string;
}) {
  return (
    <div
      style={{
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <p
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary)",
          marginBottom: 6,
        }}
      >
        {label}
      </p>
      <div className="flex items-baseline" style={{ gap: 8, marginBottom: 6 }}>
        <span
          style={{
            fontSize: 28,
            fontWeight: 600,
            color,
            letterSpacing: "-0.022em",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {loading ? "—" : `${value}${suffix}`}
        </span>
      </div>
      <p
        style={{
          fontSize: 11,
          color: "var(--color-text-tertiary)",
          lineHeight: 1.4,
        }}
      >
        {sublabel}
      </p>
    </div>
  );
}

/* ─── Current-sprinters progress (live) ─── */

interface SprinterProgress {
  loading: boolean;
  /** Students still within 30 days of joining + membership active. */
  count: number;
  /** Mean completion % across that pool. */
  avgProgress: number;
  /** Median completion % across that pool. Catches the case where a few
   *  high performers pull the mean up. */
  medianProgress: number;
}

function useCurrentSprinterProgress(): SprinterProgress {
  const supabase = createClient();
  const [data, setData] = useState<SprinterProgress>({
    loading: true,
    count: 0,
    avgProgress: 0,
    medianProgress: 0,
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const thirtyDaysAgo = new Date(
        Date.now() - 30 * 86_400_000,
      ).toISOString();
      const [studentsRes, lessonsRes, completionsRes] = await Promise.all([
        supabase
          .from("students")
          .select("id, joined_at, membership_status")
          .eq("membership_status", "active")
          .gte("joined_at", ADMIN_STUDENT_JOIN_CUTOFF)
          .gte("joined_at", thirtyDaysAgo),
        supabase.from("lessons").select("id", { count: "exact", head: true }),
        supabase
          .from("student_progress_counts")
          .select("student_id, completed_count"),
      ]);

      const students = (studentsRes.data ?? []) as Array<{
        id: string;
        joined_at: string;
      }>;
      const totalLessons =
        typeof lessonsRes.count === "number" && lessonsRes.count > 0
          ? lessonsRes.count
          : 57;
      const completionMap = new Map<string, number>();
      for (const r of (completionsRes.data ?? []) as Array<{
        student_id: string;
        completed_count: number;
      }>) {
        completionMap.set(r.student_id, r.completed_count);
      }

      const pcts = students.map((s) => {
        const done = completionMap.get(s.id) ?? 0;
        return Math.max(0, Math.min(100, Math.round((done / totalLessons) * 100)));
      });

      const avg =
        pcts.length > 0
          ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
          : 0;
      const sorted = [...pcts].sort((a, b) => a - b);
      const median =
        sorted.length === 0
          ? 0
          : sorted.length % 2 === 1
            ? sorted[(sorted.length - 1) / 2]
            : Math.round(
                (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
              );

      if (cancelled) return;
      setData({
        loading: false,
        count: students.length,
        avgProgress: avg,
        medianProgress: median,
      });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return data;
}

function CurrentSprintersCard({ data }: { data: SprinterProgress }) {
  return (
    <div
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "18px 20px",
        marginBottom: 16,
      }}
    >
      <div className="flex items-baseline" style={{ marginBottom: 12, gap: 8 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.012em",
          }}
        >
          Current sprinters
        </h3>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          Active members within 30 days of joining
          {data.loading ? "" : ` · ${data.count}`}
        </span>
      </div>
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}
      >
        <BountyCell
          label="Mean progress"
          value={data.avgProgress}
          sublabel="Average completion % across the cohort"
          color="var(--color-accent-dark)"
          loading={data.loading}
          suffix="%"
        />
        <BountyCell
          label="Median progress"
          value={data.medianProgress}
          sublabel="Half the cohort is above this number"
          color="var(--color-text-secondary)"
          loading={data.loading}
          suffix="%"
        />
      </div>
    </div>
  );
}
