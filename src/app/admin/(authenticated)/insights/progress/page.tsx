"use client";

/**
 * /admin/insights/progress — admin metrics trend dashboard.
 *
 * Four charts side-by-side, fed by daily_progress_snapshots:
 *   - Avg progress (%)
 *   - Active students
 *   - Joined per day
 *   - Churned per day
 *
 * Data sources: nightly cron at /api/cron/snapshot-progress writes one
 * row per day. Migrations v31 + v32 seeded the first 14 days from
 * existing student rows.
 *
 * Time-range selector: 7 / 30 / 90 / 365 days.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

interface SnapshotRow {
  snapshot_date: string;
  active_students: number;
  total_completions: number;
  avg_progress: number;
  active_count: number | null;
  joined_count: number | null;
  churned_count: number | null;
}

type RangeKey = "7" | "30" | "90" | "365";
const RANGE_LABELS: Record<RangeKey, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  "365": "Last year",
};

type MetricKey = "avg_progress" | "active_count" | "joined_count" | "churned_count";

interface MetricDef {
  label: string;
  description: string;
  suffix: string;
  color: string;
  /** "running" = current value is the latest snapshot (e.g. active count).
   *  "flow"    = sum across the window (joined / churned per day). */
  mode: "running" | "flow";
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
    description: "Students with active sprint membership (post-cutoff cohort).",
    suffix: "",
    color: "#5bb88e",
    mode: "running",
  },
  joined_count: {
    label: "Joined",
    description: "New students per day.",
    suffix: "",
    color: "#7d8be8",
    mode: "flow",
  },
  churned_count: {
    label: "Churned",
    description: "Memberships canceled per day.",
    suffix: "",
    color: "var(--color-danger)",
    mode: "flow",
  },
};

export default function ProgressInsightsPage() {
  const supabase = createClient();
  const [range, setRange] = useState<RangeKey>("30");
  const [points, setPoints] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/insights/progress?range=${range}`, {
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
  }, [range, supabase]);

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
      // flow: sum
      const total = points.reduce((sum, p) => sum + ((p[key] as number | null) ?? 0), 0);
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
    <div className="p-8 max-w-7xl">
      <header className="mb-6">
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "-0.022em",
            color: "var(--color-text-primary)",
            marginBottom: 4,
          }}
        >
          Insights
        </h1>
        <p style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>
          Daily snapshots of platform health. Cron writes one row at
          00:30 UTC; ranges past the backfilled 14 days will be sparse
          until more data accumulates.
        </p>
      </header>

      <div className="flex gap-2 mb-6 flex-wrap">
        {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setRange(k)}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: range === k ? 600 : 500,
              borderRadius: 8,
              background:
                range === k
                  ? "var(--color-bg-elevated)"
                  : "transparent",
              border:
                range === k
                  ? "1px solid var(--color-accent-dark)"
                  : "1px solid var(--color-border)",
              color:
                range === k
                  ? "var(--color-text-primary)"
                  : "var(--color-text-tertiary)",
              cursor: "pointer",
            }}
          >
            {RANGE_LABELS[k]}
          </button>
        ))}
      </div>

      {error && (
        <div
          className="mb-4 p-3 rounded"
          style={{
            background: "rgba(200,74,74,0.10)",
            border: "1px solid rgba(200,74,74,0.30)",
            fontSize: 13,
            color: "var(--color-danger)",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div
            className="rounded-full animate-spin"
            style={{
              width: 24,
              height: 24,
              border: "2px solid var(--color-accent)",
              borderTopColor: "transparent",
            }}
          />
        </div>
      ) : points.length === 0 ? (
        <EmptyHint />
      ) : (
        <>
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
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

          <CalcTransparency />
        </>
      )}
    </div>
  );
}

/**
 * Explains exactly what each chart is measuring + the caveats Karlo
 * should know about. Mirrors the comments in the v31–v33 migrations.
 */
function CalcTransparency() {
  return (
    <details
      className="surface-resting mt-6"
      style={{
        background: "var(--color-bg-card)",
        borderRadius: 12,
        padding: 16,
        border: "1px solid var(--color-border)",
      }}
    >
      <summary
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--color-text-primary)",
          cursor: "pointer",
        }}
      >
        How are these numbers calculated?
      </summary>
      <div
        style={{
          marginTop: 12,
          fontSize: 12,
          color: "var(--color-text-secondary)",
          lineHeight: 1.6,
        }}
      >
        <p className="mb-3">
          One row is written into{" "}
          <code style={{ color: "var(--color-text-primary)" }}>
            daily_progress_snapshots
          </code>{" "}
          every night at <strong>00:30 UTC</strong>. The cron uses the same
          formulas the dashboard tiles use:
        </p>
        <ul
          style={{
            paddingLeft: 16,
            marginBottom: 12,
            listStyle: "disc",
          }}
        >
          <li>
            <strong style={{ color: "var(--color-text-primary)" }}>
              Avg progress
            </strong>{" "}
            = total lessons completed by active students ÷ (active count ×
            total lessons in the curriculum) × 100. Active students =
            membership_status = &lsquo;active&rsquo;.
          </li>
          <li>
            <strong style={{ color: "var(--color-text-primary)" }}>
              Active students
            </strong>{" "}
            = count of students with{" "}
            <code style={{ color: "var(--color-text-primary)" }}>
              membership_status = &lsquo;active&rsquo;
            </code>{" "}
            and joined_at on or before this day. Restricted to the admin
            cutoff (currently <strong>2026-01-01</strong>).
          </li>
          <li>
            <strong style={{ color: "var(--color-text-primary)" }}>
              Joined
            </strong>{" "}
            = students whose <code>joined_at::date</code> equals this day.
          </li>
          <li>
            <strong style={{ color: "var(--color-text-primary)" }}>
              Churned
            </strong>{" "}
            = students with status &lsquo;canceled&rsquo; whose{" "}
            <code>updated_at::date</code> equals this day. This is the
            best proxy without a status-change audit log —{" "}
            <code>updated_at</code> also fires on other column changes, so
            the count can be slightly noisy.
          </li>
        </ul>
        <p>
          The first 14 days were backfilled at install (migrations v31 +
          v32) and everything since Jan 1 was backfilled by v33. From the
          install date forward, the cron writes the canonical row each
          night and never overwrites a manually-edited one.
        </p>
      </div>
    </details>
  );
}

function EmptyHint() {
  return (
    <div
      className="surface-resting"
      style={{
        background: "var(--color-bg-card)",
        borderRadius: 12,
        padding: 40,
        textAlign: "center",
        color: "var(--color-text-tertiary)",
      }}
    >
      <p style={{ fontSize: 14, marginBottom: 4 }}>
        No snapshots in this window yet.
      </p>
      <p style={{ fontSize: 12 }}>
        Migrations v31 + v32 backfill the last 14 days; the nightly cron at
        00:30 UTC takes over from there.
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
        padding: 16,
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.012em",
          }}
        >
          {def.label}
        </h3>
        {current != null && (
          <p
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--color-text-primary)",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.018em",
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
          fontSize: 11,
          color: "var(--color-text-tertiary)",
          marginBottom: 4,
        }}
      >
        {def.description}
      </p>

      {def.mode === "running" && delta != null && (
        <p
          style={{
            fontSize: 11,
            color:
              (valueKey === "churned_count" ? -delta : delta) > 0
                ? "var(--color-success)"
                : (valueKey === "churned_count" ? -delta : delta) < 0
                  ? "var(--color-danger)"
                  : "var(--color-text-tertiary)",
            fontVariantNumeric: "tabular-nums",
            marginBottom: 10,
          }}
        >
          {delta > 0 ? "↑ +" : delta < 0 ? "↓ " : "→ "}
          {Math.abs(delta).toFixed(valueKey === "avg_progress" ? 1 : 0)}
          {def.suffix} vs start of range
        </p>
      )}
      {def.mode === "flow" && (
        <p
          style={{
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            marginBottom: 10,
          }}
        >
          Daily counts shown below; total above is the window sum.
        </p>
      )}

      <Chart
        points={points}
        valueKey={valueKey}
        color={def.color}
        suffix={def.suffix}
        mode={def.mode}
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
  const W = 600;
  const H = 180;
  const PAD = 32;

  const series = points
    .map((p) => ({
      date: p.snapshot_date,
      v: (p[valueKey] as number | null) ?? 0,
    }))
    .filter((p) => p.v != null);

  if (series.length < 2) {
    return (
      <div
        style={{
          padding: 24,
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
  const minY = Math.max(0, Math.min(...ys) - 1);
  const maxY = Math.max(...ys);
  const rangeY = Math.max(1, maxY - minY);
  const stepX = (W - PAD * 2) / (series.length - 1);

  const toXY = (i: number, v: number) => {
    const x = PAD + i * stepX;
    const y = H - PAD - ((v - minY) / rangeY) * (H - PAD * 2);
    return { x, y };
  };

  const pathPts = series.map((p, i) => toXY(i, p.v));
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

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
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
              x={PAD - 6}
              y={y + 3}
              fontSize={9}
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

      {mode === "flow" ? (
        // Bar chart for flow metrics (joined/churned per day)
        series.map((p, i) => {
          const { x, y } = toXY(i, p.v);
          const w = Math.max(1, stepX * 0.7);
          return (
            <rect
              key={i}
              x={x - w / 2}
              y={y}
              width={w}
              height={H - PAD - y}
              fill={color}
              opacity={0.7}
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
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {pathPts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={2.2} fill={color} />
          ))}
        </>
      )}

      {/* X-axis: first / mid / last (dedupe when series is tiny so the
          labels don't pile on top of each other) */}
      {(() => {
        const lastIdx = series.length - 1;
        const midIdx = Math.floor(lastIdx / 2);
        const unique = Array.from(new Set([0, midIdx, lastIdx]));
        const slots: Array<{ i: number; anchor: "start" | "middle" | "end" }> =
          [];
        for (let k = 0; k < unique.length; k++) {
          const i = unique[k];
          const anchor: "start" | "middle" | "end" =
            i === 0 ? "start" : i === lastIdx ? "end" : "middle";
          slots.push({ i, anchor });
        }
        return slots;
      })().map((x) => {
        const px = PAD + x.i * stepX;
        return (
          <text
            key={x.i}
            x={px}
            y={H - PAD + 14}
            fontSize={9}
            fill="var(--color-text-tertiary)"
            textAnchor={x.anchor}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {series[x.i].date.slice(5)}
          </text>
        );
      })}
    </svg>
  );
}
