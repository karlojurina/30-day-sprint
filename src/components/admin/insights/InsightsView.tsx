"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Card, EmptyState, T } from "@/components/admin/ui";
import { ListHeader, ListPage, LoadError, TAP, pressPill } from "@/components/admin/list-parts";
import { ACTIVITY_ORDER, ACTIVITY_TEXT } from "@/lib/useJourneyPaceCounts";
import type { PaceCounts } from "@/lib/useJourneyPaceCounts";
import type { ActivityLabel } from "@/lib/curriculum-reset";
import type { Answer } from "@/lib/admin/admin-transport";
import { bucketByDay } from "@/lib/admin/insights-data";
import type { InsightsTransport, SnapshotRow, SprinterProgress } from "@/lib/admin/insights-data";

/**
 * /admin/insights/progress (admin rebuild 2, WI-9: the brand kit's dark
 * look). The page as it was, in the kit's tokens and parts, and laid out for
 * a phone: three trend charts from daily_progress_snapshots (Avg progress,
 * Active students, Churned), the pace (or, after the course switch, the
 * activity) of the students right now, the current sprinters, and the
 * Bounty Program claims, over one range (7, 14, 30 or 90 days, all, or two
 * dates).
 *
 * `transport` holds the page's three reads (src/lib/admin/insights-data.ts)
 * and `pace` the shared pace count (useJourneyPaceCounts), so the dev page
 * /dev/admin/insights renders this same component with made-up answers. A
 * read that fails says so on its card; nothing shows 0 for a failed read.
 *
 * Avg progress is drawn as the snapshot holds it: the old course's 36% ran
 * to 18 October and the new course's count started near 3% on 19 October,
 * so the line drops there (the Dashboard's tile is the place that reads it
 * from the switch on, admin rebuild 2 D3).
 */

type RangePreset = "7" | "14" | "30" | "90" | "all" | "custom";

const PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All" },
  { value: "custom", label: "Dates" },
];

type MetricKey = "avg_progress" | "active_count" | "churned_count";

interface MetricDef {
  label: string;
  description: string;
  suffix: string;
  color: string;
  /** "running" = latest snapshot value; "flow" = sum across the range. */
  mode: "running" | "flow";
}

const METRICS: Record<MetricKey, MetricDef> = {
  avg_progress: {
    label: "Avg progress",
    description: "Average completion across active students, in percent.",
    suffix: "%",
    color: "var(--color-accent-dark)",
    mode: "running",
  },
  active_count: {
    label: "Active students",
    description: "Launch-cohort paying members with an active or failed-payment membership.",
    suffix: "",
    color: "var(--color-success)",
    mode: "running",
  },
  churned_count: {
    label: "Churned",
    description: "Memberships canceled per day.",
    suffix: "",
    color: "var(--color-danger)",
    mode: "flow",
  },
};

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Read<T> = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; data: T };

/** One read, run again whenever `run` changes; its answer is dropped when a newer read started. */
function useRead<T>(run: () => Promise<Answer<T>>): [Read<T>, () => void] {
  const [state, setState] = useState<Read<T>>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    void run().then((r) => {
      if (mine !== seq.current) return;
      setState(r.ok ? { kind: "ready", data: r.data } : { kind: "error", error: r.error });
    });
  }, [run, tick]);
  return [state, () => setTick((t) => t + 1)];
}

export function InsightsView({ transport, pace }: { transport: InsightsTransport; pace: PaceCounts }) {
  const fromId = useId();
  const toId = useId();
  const [preset, setPreset] = useState<RangePreset>("14");
  const [today] = useState(() => isoDay(Date.now()));
  const [customFrom, setCustomFrom] = useState(() => isoDay(Date.now() - 30 * DAY));
  const [customTo, setCustomTo] = useState(() => isoDay(Date.now()));

  const range = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    if (preset === "all") return { from: "2026-01-01", to: today };
    return { from: isoDay(Date.parse(today) - Number(preset) * DAY), to: today };
  }, [preset, customFrom, customTo, today]);

  const snapshotsRun = useCallback(() => transport.loadSnapshots(range.from, range.to), [transport, range]);
  const bountyRun = useCallback(() => transport.loadBountyClaims(), [transport]);
  const sprintersRun = useCallback(() => transport.loadSprinters(), [transport]);
  const [snapshots, retrySnapshots] = useRead(snapshotsRun);
  const [bounty, retryBounty] = useRead(bountyRun);
  const [sprinters, retrySprinters] = useRead(sprintersRun);

  // The launch cohort's columns, falling back to the old ones for rows from before v77.
  const points = useMemo<SnapshotRow[]>(
    () =>
      snapshots.kind === "ready"
        ? snapshots.data.map((p) => ({
            ...p,
            avg_progress: p.avg_progress_cohort ?? p.avg_progress,
            active_count: p.active_count_cohort ?? p.active_count,
            joined_count: p.joined_count_cohort ?? p.joined_count,
            churned_count: p.churned_count_cohort ?? p.churned_count,
          }))
        : [],
    [snapshots],
  );

  const windowDays =
    preset === "all"
      ? null
      : preset === "custom"
        ? Math.max(1, Math.round((Date.parse(customTo) - Date.parse(customFrom)) / DAY) + 1)
        : Number(preset);

  return (
    <ListPage>
      <ListHeader
        title="Insights"
        description="How the course is going, from a snapshot written every night at 00:30 UTC."
      />

      <div className="flex flex-wrap items-end" style={{ gap: 12, marginBottom: 20 }}>
        <div role="group" aria-label="Range" className="flex flex-wrap" style={{ gap: 8 }}>
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={preset === p.value}
              onClick={() => setPreset(p.value)}
              style={pressPill(preset === p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap items-end" style={{ gap: 8 }}>
            <DateField id={fromId} label="From" value={customFrom} max={customTo} onChange={setCustomFrom} />
            <DateField id={toId} label="To" value={customTo} max={today} onChange={setCustomTo} />
          </div>
        )}
      </div>

      <PaceCard counts={pace} />
      <SprintersCard read={sprinters} onRetry={retrySprinters} />
      <BountyCard read={bounty} windowDays={windowDays} today={today} onRetry={retryBounty} />

      {snapshots.kind === "loading" ? (
        <Card padding={20}>
          <p role="status" style={T.bodyDim}>
            Loading the snapshots
          </p>
        </Card>
      ) : snapshots.kind === "error" ? (
        <LoadError title="Couldn't load the snapshots." detail={snapshots.error} onRetry={retrySnapshots} />
      ) : points.length === 0 ? (
        <Card>
          <EmptyState title="No snapshots in this range." description="The nightly job writes one row a day." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2" style={{ gap: 16 }}>
          {(Object.keys(METRICS) as MetricKey[]).map((key) => (
            <MetricCard key={key} def={METRICS[key]} points={points} valueKey={key} />
          ))}
        </div>
      )}

      <CalcNotes courseIsNew={pace.courseIsNew} />
    </ListPage>
  );
}

function DateField({
  id,
  label,
  value,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  max?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label htmlFor={id} style={{ ...T.eyebrow, color: "var(--color-text-secondary)" }}>
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        max={max}
        onChange={(e) => {
          if (e.currentTarget.value) onChange(e.currentTarget.value);
        }}
        style={{
          minHeight: TAP,
          padding: "0 12px",
          fontSize: 16,
          borderRadius: "var(--radius-control)",
          border: "1px solid var(--color-border-strong)",
          background: "var(--color-bg-card)",
          color: "var(--color-text-primary)",
          fontVariantNumeric: "tabular-nums",
        }}
      />
    </div>
  );
}

/* ─── Cards ─── */

const CARD: React.CSSProperties = { marginBottom: 12 };

function CardHead({ title, note }: { title: string; note?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline" style={{ gap: "4px 10px", marginBottom: 12 }}>
      <h2 style={{ ...T.cardTitle }}>{title}</h2>
      {note && <span style={{ ...T.bodyDim, fontSize: 12 }}>{note}</span>}
    </div>
  );
}

/** What each activity cell says after the course switch (cutover PRD, C4). */
const ACTIVITY_CELL: Record<ActivityLabel, { tone: CellTone; description: string }> = {
  not_started: { tone: "plain", description: "No counted lesson finished on the new course yet." },
  moving: { tone: "success", description: "Last counted lesson under 3 days ago." },
  slipping: { tone: "warning", description: "Last counted lesson 3 to 7 days ago." },
  stalled: { tone: "danger", description: "Last counted lesson over 7 days ago. Worth a check-in." },
};

function PaceCard({ counts }: { counts: PaceCounts }) {
  if (counts.error) {
    return (
      <Card padding={16} style={CARD}>
        <CardHead title="Pace right now" />
        <p role="alert" style={{ ...T.body, lineHeight: 1.5 }}>
          Couldn&apos;t count: {counts.error}
        </p>
      </Card>
    );
  }
  if (counts.courseIsNew) {
    return (
      <Card padding={16} style={CARD}>
        <CardHead title="Activity right now" note={counts.loading ? "Loading" : `Active members on the course, ${counts.total} in all`} />
        <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 12 }}>
          {ACTIVITY_ORDER.map((label) => (
            <Cell
              key={label}
              label={ACTIVITY_TEXT[label]}
              value={counts.loading ? null : counts.activity[label]}
              total={counts.total}
              tone={ACTIVITY_CELL[label].tone}
              description={ACTIVITY_CELL[label].description}
            />
          ))}
        </div>
      </Card>
    );
  }
  return (
    <Card padding={16} style={CARD}>
      <CardHead title="Pace right now" note={counts.loading ? "Loading" : `Students on the 30-day plan, ${counts.total} in all`} />
      <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: 12 }}>
        <Cell label="Behind" value={counts.loading ? null : counts.behind} total={counts.total} tone="danger" description="Under half the expected pace. Worth a check-in." />
        <Cell label="On pace" value={counts.loading ? null : counts.on_pace} total={counts.total} tone="plain" description="Half to one and a half times the expected pace." />
        <Cell label="Ahead" value={counts.loading ? null : counts.ahead} total={counts.total} tone="success" description="Over one and a half times the expected pace." />
      </div>
    </Card>
  );
}

/**
 * The kit's status colours as a cell shows them. Red measures 4.2:1 on the
 * raised surface (under the 4.5 words need), so a red cell's number is in
 * the text colour and its dot carries the red, as the pills do
 * (admin-tokens.module.css); the other colours measure over 4.5 and colour
 * the number too.
 */
const CELL_TONE = {
  plain: { dot: null, number: "var(--color-text-primary)" },
  success: { dot: "var(--color-success)", number: "var(--color-success)" },
  warning: { dot: "var(--color-warning)", number: "var(--color-warning)" },
  danger: { dot: "var(--color-danger)", number: "var(--color-text-primary)" },
  accent: { dot: null, number: "var(--color-accent-dark)" },
} as const;

type CellTone = keyof typeof CELL_TONE;

function Cell({
  label,
  value,
  total,
  tone,
  description,
  suffix = "",
}: {
  label: string;
  /** Null while loading. */
  value: number | null;
  total?: number;
  tone: CellTone;
  description: string;
  suffix?: string;
}) {
  const pct = value != null && total && total > 0 ? Math.round((value / total) * 100) : null;
  const { dot, number } = CELL_TONE[tone];
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: "var(--radius-control)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      <p className="flex items-center" style={{ ...T.eyebrow, color: "var(--color-text-secondary)", marginBottom: 6, gap: 6 }}>
        {dot && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: dot, flex: "none" }} />}
        {label}
      </p>
      <p className="flex items-baseline" style={{ gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, color: number, fontVariantNumeric: "tabular-nums" }}>
          {value == null ? "…" : `${value}${suffix}`}
        </span>
        {pct != null && <span style={{ ...T.bodyDim, fontSize: 12 }}>{pct}%</span>}
      </p>
      <p style={{ ...T.bodyDim, fontSize: 12, lineHeight: 1.45 }}>{description}</p>
    </div>
  );
}

function SprintersCard({ read, onRetry }: { read: Read<SprinterProgress>; onRetry: () => void }) {
  if (read.kind === "error") {
    return <ReadFailed title="Current sprinters" error={read.error} onRetry={onRetry} />;
  }
  const d = read.kind === "ready" ? read.data : null;
  const value = (v: number | null | undefined) => (d == null ? null : v ?? null);
  return (
    <Card padding={16} style={CARD}>
      <CardHead title="Current sprinters" note={d ? `Active members within 30 days of their first payment, ${d.count} in all` : "Loading"} />
      {d && d.avgProgress == null ? (
        <p style={{ ...T.body, lineHeight: 1.5 }}>Couldn&apos;t count the lessons, so no progress is shown.</p>
      ) : (
        <div className="grid grid-cols-2" style={{ gap: 12 }}>
          <Cell label="Mean progress" value={value(d?.avgProgress)} suffix="%" tone="accent" description="Average completion across them." />
          <Cell label="Median progress" value={value(d?.medianProgress)} suffix="%" tone="plain" description="Half of them are above this." />
        </div>
      )}
    </Card>
  );
}

function ReadFailed({ title, error, onRetry }: { title: string; error: string; onRetry: () => void }) {
  return (
    <div style={CARD}>
      <LoadError title={`${title}: couldn't load.`} detail={error} onRetry={onRetry} />
    </div>
  );
}

function BountyCard({
  read,
  windowDays,
  today,
  onRetry,
}: {
  read: Read<string[]>;
  /** null = all time; otherwise the number of days, today included. */
  windowDays: number | null;
  today: string;
  onRetry: () => void;
}) {
  const claims = read.kind === "ready" ? read.data : null;
  const todayMidnight = Date.parse(today);
  const series = useMemo(() => {
    if (!claims) return [];
    if (windowDays == null) {
      if (claims.length === 0) return [];
      return bucketByDay(claims, Math.floor(Date.parse(claims[0]) / DAY) * DAY, todayMidnight);
    }
    return bucketByDay(claims, todayMidnight - (windowDays - 1) * DAY, todayMidnight);
  }, [claims, windowDays, todayMidnight]);

  if (read.kind === "error") return <ReadFailed title="Onboarded to the Bounty Program" error={read.error} onRetry={onRetry} />;

  let current: number | null = null;
  let delta: number | null = null;
  let deltaPct: number | null = null;
  if (claims) {
    if (windowDays == null) current = claims.length;
    else {
      const from = todayMidnight - (windowDays - 1) * DAY;
      const priorFrom = todayMidnight - (2 * windowDays - 1) * DAY;
      current = claims.filter((ts) => Date.parse(ts) >= from).length;
      const prior = claims.filter((ts) => {
        const t = Date.parse(ts);
        return t >= priorFrom && t < from;
      }).length;
      delta = current - prior;
      deltaPct = prior > 0 ? Math.round(((current - prior) / prior) * 100) : null;
    }
  }

  return (
    <Card padding={16} style={CARD}>
      <CardHead title="Onboarded to the Bounty Program" note={claims ? `${claims.length} in all time` : "Loading"} />
      <div className="flex flex-wrap items-baseline" style={{ gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
          {current == null ? "…" : current}
        </span>
        {delta != null && (
          <span style={{ ...T.body, fontVariantNumeric: "tabular-nums", color: delta > 0 ? "var(--color-success)" : delta < 0 ? "var(--color-danger)" : "var(--color-text-secondary)" }}>
            {delta === 0 ? "The same as" : `${Math.abs(delta)} ${delta > 0 ? "more" : "fewer"}`}
            {delta !== 0 && deltaPct != null && ` (${deltaPct > 0 ? "+" : ""}${deltaPct}%)`}
            <span style={{ color: "var(--color-text-secondary)" }}>
              {delta === 0 ? " the period before" : " than the period before"}
            </span>
          </span>
        )}
      </div>
      {claims && (series.length === 0 ? (
        <p style={{ ...T.bodyDim, padding: "16px 0" }}>No Bounty Program claims in this range.</p>
      ) : (
        <Sparkline series={series} />
      ))}
    </Card>
  );
}

/* ─── Charts ─── */

/** The box's width in CSS pixels, so a chart draws at its real size and its labels stay 11px on a phone. */
function useWidth(fallback: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const AXIS_FONT = 11;

/** A snapshot number as it reads: at most 2 decimals, so 2.71 stays 2.71 and a float's tail goes. */
const fmt = (v: number) => String(Math.round(v * 100) / 100);

function MetricCard({ def, points, valueKey }: { def: MetricDef; points: SnapshotRow[]; valueKey: MetricKey }) {
  const values = points.map((p) => (p[valueKey] as number | null) ?? null);
  const last = values[values.length - 1] ?? null;
  const first = values[0] ?? null;
  const total = values.reduce<number>((s, v) => s + (v ?? 0), 0);
  const delta = def.mode === "running" && last != null && first != null ? last - first : null;
  const good = delta == null ? 0 : valueKey === "churned_count" ? -delta : delta;
  return (
    <Card padding={20}>
      <div className="flex flex-wrap items-baseline justify-between" style={{ gap: 8, marginBottom: 4 }}>
        <h2 style={T.cardTitle}>{def.label}</h2>
        <p style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
          {def.mode === "running" ? (last == null ? "No value" : `${fmt(last)}${def.suffix}`) : `${fmt(total)} in the range`}
        </p>
      </div>
      <p style={{ ...T.bodyDim, fontSize: 12, lineHeight: 1.45, marginBottom: 6 }}>{def.description}</p>
      {delta != null && (
        <p
          style={{
            fontSize: 12,
            marginBottom: 12,
            fontVariantNumeric: "tabular-nums",
            color: good > 0 ? "var(--color-success)" : good < 0 ? "var(--color-danger)" : "var(--color-text-secondary)",
          }}
        >
          {delta > 0 ? "Up " : delta < 0 ? "Down " : "No change "}
          {delta !== 0 && `${Math.abs(delta).toFixed(valueKey === "avg_progress" ? 1 : 0)}${def.suffix}`} since the start of the range
        </p>
      )}
      <Chart points={points} valueKey={valueKey} color={def.color} suffix={def.suffix} mode={def.mode} />
    </Card>
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
  const [box, W] = useWidth(640);
  const H = 220;
  const PAD_L = 40;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 28;
  const [hover, setHover] = useState<number | null>(null);
  const series = points.map((p) => ({ date: p.snapshot_date, v: (p[valueKey] as number | null) ?? 0 }));

  if (series.length < 2) {
    return (
      <div ref={box} style={{ padding: 24, textAlign: "center", ...T.bodyDim }}>
        Not enough snapshots in this range to draw a line.
      </div>
    );
  }

  const maxY = Math.max(...series.map((p) => p.v), 1);
  const innerW = Math.max(1, W - PAD_L - PAD_R);
  const innerH = H - PAD_T - PAD_B;
  const step = innerW / Math.max(1, series.length - 1);
  const slot = innerW / series.length;
  const barW = Math.max(2, Math.min(slot * 0.7, 28));
  const y = (v: number) => PAD_T + innerH - (v / maxY) * innerH;
  const x = (i: number) => (mode === "flow" ? PAD_L + (i + 0.5) * slot : PAD_L + i * step);
  const pts = series.map((p, i) => ({ x: x(i), y: y(p.v) }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `M ${pts[0].x} ${PAD_T + innerH} ${pts.map((p) => `L ${p.x} ${p.y}`).join(" ")} L ${pts[pts.length - 1].x} ${PAD_T + innerH} Z`;
  const ticks = [0, Math.round((maxY / 2) * 10) / 10, maxY];
  const lastIdx = series.length - 1;
  const labels = Array.from(new Set([0, Math.floor(lastIdx / 2), lastIdx]));

  function indexAt(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W - PAD_L;
    const i = Math.round(mode === "flow" ? px / slot - 0.5 : px / step);
    return Math.max(0, Math.min(lastIdx, i));
  }

  return (
    <div ref={box} style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`${valueKey.replace(/_/g, " ")}, ${series.length} days`}
        style={{ display: "block" }}
        onPointerMove={(e) => setHover(indexAt(e))}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={1} />
            <text x={PAD_L - 6} y={y(t) + 4} fontSize={AXIS_FONT} fill="var(--color-text-secondary)" textAnchor="end">
              {Math.round(t)}
              {suffix}
            </text>
          </g>
        ))}
        {mode === "flow" ? (
          series.map((p, i) =>
            p.v === 0 ? null : (
              <rect
                key={p.date}
                x={x(i) - barW / 2}
                y={y(p.v)}
                width={barW}
                height={Math.max(0, PAD_T + innerH - y(p.v))}
                rx={2}
                fill={color}
                opacity={hover === i ? 1 : 0.8}
              />
            ),
          )
        ) : (
          <>
            <path d={area} fill={color} fillOpacity={0.12} />
            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {pts.map((p, i) => (
              <circle key={series[i].date} cx={p.x} cy={p.y} r={hover === i ? 4 : 2.5} fill={color} />
            ))}
          </>
        )}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + innerH} stroke="var(--color-text-secondary)" strokeWidth={1} strokeDasharray="3 3" pointerEvents="none" />
        )}
        {labels.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            fontSize={AXIS_FONT}
            fill="var(--color-text-secondary)"
            textAnchor={i === 0 ? "start" : i === lastIdx ? "end" : "middle"}
          >
            {series[i].date.slice(5)}
          </text>
        ))}
      </svg>
      {hover != null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: `${Math.min(Math.max((x(hover) / W) * 100, 12), 88)}%`,
            transform: "translateX(-50%)",
            padding: "6px 10px",
            borderRadius: "var(--radius-chip)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-strong)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          <p style={{ ...T.bodyDim, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{series[hover].date}</p>
          <p style={{ ...T.body, fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {fmt(series[hover].v)}
            {suffix}
          </p>
        </div>
      )}
    </div>
  );
}

function Sparkline({ series }: { series: Array<{ date: string; count: number }> }) {
  const [box, W] = useWidth(640);
  const H = 96;
  const PAD = 8;
  const BASE = H - 22;
  const max = Math.max(1, ...series.map((p) => p.count));
  const step = series.length > 1 ? (W - PAD * 2) / (series.length - 1) : 0;
  const pts = series.map((p, i) => ({ x: PAD + i * step, y: BASE - (p.count / max) * (BASE - PAD), ...p }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${BASE} L ${pts[0].x.toFixed(1)} ${BASE} Z`;
  return (
    <div ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Bounty Program claims per day" style={{ display: "block" }}>
        <line x1={PAD} x2={W - PAD} y1={BASE} y2={BASE} stroke="var(--color-border)" strokeWidth={1} />
        <path d={area} fill="var(--color-accent-dark)" fillOpacity={0.14} />
        <path d={line} fill="none" stroke="var(--color-accent-dark)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p) =>
          p.count > 0 ? (
            <circle key={p.date} cx={p.x} cy={p.y} r={2.5} fill="var(--color-accent-dark)">
              <title>
                {p.date}: {p.count} {p.count === 1 ? "claim" : "claims"}
              </title>
            </circle>
          ) : null,
        )}
        <text x={PAD} y={H - 4} fontSize={AXIS_FONT} fill="var(--color-text-secondary)" textAnchor="start">
          {series[0].date.slice(5)}
        </text>
        <text x={W - PAD} y={H - 4} fontSize={AXIS_FONT} fill="var(--color-text-secondary)" textAnchor="end">
          {series[series.length - 1].date.slice(5)}
        </text>
      </svg>
    </div>
  );
}

/** How the numbers are worked out, folded under one line. */
function CalcNotes({ courseIsNew }: { courseIsNew: boolean }) {
  const entries: Array<{ label: string; body: string }> = [
    {
      label: "Avg progress",
      body: "Mean completion across every active student, graduates at 100% included. It rises until churn or new joiners pull it down. From 19 October the snapshot counts the new course, which started near 3%, so the line drops there. The Current sprinters card is the cleaner read of whether students who joined lately are moving.",
    },
    { label: "Active students", body: "Memberships that are active or have a failed payment, at the time of the snapshot." },
    { label: "Churned", body: "Memberships canceled per day. The chart shows each day; the number is the sum over the range." },
    courseIsNew
      ? {
          label: "Activity right now",
          body: "A live count of active members by how long ago they last finished a counted lesson on the new course: Moving under 3 days, Slipping 3 to 7, Stalled over 7, Not started when none yet.",
        }
      : {
          label: "Pace right now",
          body: "A live count of students on the 30-day plan, by lessons finished against lessons expected: Behind under half, Ahead over one and a half times.",
        },
    { label: "Onboarded to the Bounty Program", body: "A live count of students who claimed the Bounty Program, stamped by its webhook." },
  ];
  return (
    <details style={{ marginTop: 24 }}>
      <summary style={{ ...T.body, fontWeight: 600, minHeight: TAP, display: "flex", alignItems: "center", cursor: "pointer", color: "var(--color-text-secondary)" }}>
        How these are worked out
      </summary>
      <dl className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: "14px 24px", marginTop: 6 }}>
        {entries.map((e) => (
          <div key={e.label}>
            <dt style={{ ...T.body, fontWeight: 600, marginBottom: 2 }}>{e.label}</dt>
            <dd style={{ ...T.bodyDim, lineHeight: 1.5 }}>{e.body}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
