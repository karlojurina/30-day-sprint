"use client";

/**
 * /admin/insights/progress — average-progress trend over time.
 *
 * Data comes from daily_progress_snapshots, written nightly by the
 * /api/cron/snapshot-progress cron. Karlo's ask: see whether the
 * avg-progress number is climbing or sliding over time so we know
 * if the program is helping students or stalling them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

interface SnapshotRow {
  snapshot_date: string;
  active_students: number;
  total_completions: number;
  avg_progress: number;
}

type RangeKey = "7" | "30" | "90" | "365";
const RANGE_LABELS: Record<RangeKey, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  "365": "Last year",
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

  const stats = useMemo(() => {
    if (points.length === 0) return null;
    const first = points[0];
    const last = points[points.length - 1];
    const max = points.reduce(
      (m, p) => (p.avg_progress > m.avg_progress ? p : m),
      points[0],
    );
    return {
      first,
      last,
      max,
      delta: Math.round((last.avg_progress - first.avg_progress) * 100) / 100,
    };
  }, [points]);

  return (
    <div className="p-8 max-w-6xl">
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
          Average progress
        </h1>
        <p style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>
          Nightly snapshot of avg lesson-completion % across active
          students. The cron writes one row per day at 00:30 UTC.
        </p>
      </header>

      {/* Range selector */}
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
            The nightly cron runs at 00:30 UTC. The migration backfilled
            the last 14 days at install — pick a shorter window if you
            don&rsquo;t see data here.
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          {stats && (
            <div
              className="grid grid-cols-3 gap-3 mb-6"
              style={{ maxWidth: 640 }}
            >
              <Stat label="Today" value={`${stats.last.avg_progress}%`} />
              <Stat
                label="Δ vs start of range"
                value={`${stats.delta > 0 ? "+" : ""}${stats.delta}%`}
                tone={
                  stats.delta > 0
                    ? "good"
                    : stats.delta < 0
                      ? "bad"
                      : "neutral"
                }
              />
              <Stat
                label="Peak in window"
                value={`${stats.max.avg_progress}%`}
                sub={stats.max.snapshot_date}
              />
            </div>
          )}

          {/* Chart */}
          <ProgressChart points={points} />
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const color =
    tone === "good"
      ? "var(--color-success)"
      : tone === "bad"
        ? "var(--color-danger)"
        : "var(--color-text-primary)";
  return (
    <div
      style={{
        background: "var(--color-bg-card)",
        borderRadius: 10,
        padding: "12px 16px",
      }}
    >
      <p
        style={{
          fontSize: 10,
          fontWeight: 500,
          color: "var(--color-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 20,
          fontWeight: 600,
          color,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.018em",
          marginTop: 4,
        }}
      >
        {value}
      </p>
      {sub && (
        <p
          style={{
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            marginTop: 2,
          }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

function ProgressChart({ points }: { points: SnapshotRow[] }) {
  const W = 900;
  const H = 280;
  const PAD = 40;
  if (points.length < 2) {
    return (
      <div
        className="surface-resting"
        style={{
          background: "var(--color-bg-card)",
          borderRadius: 12,
          padding: 40,
          textAlign: "center",
          fontSize: 13,
          color: "var(--color-text-tertiary)",
        }}
      >
        Need at least 2 days of data to draw a line.
      </div>
    );
  }
  const ys = points.map((p) => p.avg_progress);
  const minY = Math.max(0, Math.floor(Math.min(...ys) - 2));
  const maxY = Math.min(100, Math.ceil(Math.max(...ys) + 2));
  const rangeY = Math.max(1, maxY - minY);
  const stepX = (W - PAD * 2) / (points.length - 1);

  const toXY = (i: number, v: number) => {
    const x = PAD + i * stepX;
    const y = H - PAD - ((v - minY) / rangeY) * (H - PAD * 2);
    return { x, y };
  };

  const pathPts = points.map((p, i) => toXY(i, p.avg_progress));
  const linePath = pathPts
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");
  const areaPath =
    `M ${pathPts[0].x} ${H - PAD} ` +
    pathPts.map((p) => `L ${p.x} ${p.y}`).join(" ") +
    ` L ${pathPts[pathPts.length - 1].x} ${H - PAD} Z`;

  // Y-axis ticks
  const ticks = [minY, Math.round((minY + maxY) / 2), maxY];

  // X-axis labels (first, middle, last)
  const xLabels = [
    { i: 0, label: points[0].snapshot_date },
    {
      i: Math.floor((points.length - 1) / 2),
      label: points[Math.floor((points.length - 1) / 2)].snapshot_date,
    },
    {
      i: points.length - 1,
      label: points[points.length - 1].snapshot_date,
    },
  ];

  return (
    <div
      className="surface-resting"
      style={{
        background: "var(--color-bg-card)",
        borderRadius: 12,
        padding: 20,
        overflowX: "auto",
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", maxHeight: 360 }}
      >
        {/* Grid lines */}
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
                fontSize={10}
                fill="var(--color-text-tertiary)"
                textAnchor="end"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {t}%
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path
          d={areaPath}
          fill="var(--color-accent-dark)"
          fillOpacity={0.10}
        />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke="var(--color-accent-dark)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Dots */}
        {pathPts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={2.5}
            fill="var(--color-accent-dark)"
          />
        ))}

        {/* X-axis labels */}
        {xLabels.map((x, idx) => {
          const px = PAD + x.i * stepX;
          return (
            <text
              key={idx}
              x={px}
              y={H - PAD + 16}
              fontSize={10}
              fill="var(--color-text-tertiary)"
              textAnchor={idx === 0 ? "start" : idx === 2 ? "end" : "middle"}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {x.label.slice(5)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
