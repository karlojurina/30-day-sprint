"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Card, EmptyState, T } from "@/components/admin/ui";
import { FailedMeta, ListHeader, ListPage, LoadError, PILL_ROW, TAP, pressPill } from "@/components/admin/list-parts";
import { FoldSummary, ReadFailure } from "@/components/admin/review-parts";
import { TrendChart, pointDay } from "@/components/admin/dashboard/TrendChart";
import { ACTIVITY_ORDER, ACTIVITY_TEXT } from "@/lib/useJourneyPaceCounts";
import type { PaceCounts } from "@/lib/useJourneyPaceCounts";
import type { ActivityLabel } from "@/lib/curriculum-reset";
import type { Answer } from "@/lib/admin/admin-transport";
import { clockLabel } from "@/lib/admin/croatia-dates";
import { deltaOf } from "@/lib/admin/dashboard-metrics";
import { axisTicks, claimsLine, metricLine, snapshotDays } from "@/lib/admin/insights-data";
import type { ChartPoint, InsightsMetric, InsightsTransport, SprinterProgress } from "@/lib/admin/insights-data";

/**
 * /admin/insights/progress (admin rebuild 2, WI-9: the brand kit's dark
 * look). Three trend charts from daily_progress_snapshots (Avg progress,
 * Active students, Churned), the pace (or, after the course switch, the
 * activity) of the students right now, the current sprinters, and the
 * Bounty Program claims, over one range (7, 14, 30 or 90 days, all, or two
 * dates).
 *
 * `transport` holds the page's reads (src/lib/admin/insights-data.ts) and
 * `pace` the shared pace count (useJourneyPaceCounts), so the dev page
 * /dev/admin/insights renders this same component with made-up answers. A
 * read that fails says so on its card, in plain words; nothing shows 0 for
 * a failed read.
 *
 * The charts are the Dashboard's (TrendChart): Airy Blue marks, bars for a
 * count per day, a line for a running number, dates like "Wed 7 Oct", a day
 * with no snapshot a gap, and labelled gridlines whose labels are their own
 * values (axisTicks). Avg progress starts on the course switch's date
 * (curriculum_reset_at), the floor the Dashboard uses: the old course's 36%
 * never sits beside the new course's near 3%, and its change, in points,
 * never crosses the switch (admin rebuild 2, D3; the review's fix round).
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

interface MetricDef {
  label: string;
  description: string;
  /** "running" = the latest snapshot's value; "flow" = the sum across the range. */
  mode: "running" | "flow";
  /** A count (whole gridlines) or a share. */
  integer: boolean;
  format: (v: number) => string;
  guideFormat: (v: number) => string;
  /** The change, in its unit: ["pt", "pts"] for a share, none for a count. */
  unit: [string, string] | null;
  /** The change's decimals. */
  decimals: number;
  upIsGood: boolean;
}

const int = (v: number) => Math.round(v).toLocaleString("en-US");
/** A snapshot number as it reads: at most 2 decimals, so 2.71 stays 2.71 and a float's tail goes. */
const fmt = (v: number) => String(Math.round(v * 100) / 100);

const METRICS: Record<InsightsMetric, MetricDef> = {
  avg_progress: {
    label: "Avg progress",
    description: "Average completion across active students, in percent, from the course switch on.",
    mode: "running",
    integer: false,
    format: (v) => `${fmt(v)}%`,
    guideFormat: (v) => `${fmt(v)}%`,
    unit: ["pt", "pts"],
    decimals: 2,
    upIsGood: true,
  },
  active_count: {
    label: "Active students",
    description: "Launch-cohort paying members with an active or failed-payment membership.",
    mode: "running",
    integer: true,
    format: int,
    guideFormat: int,
    unit: null,
    decimals: 0,
    upIsGood: true,
  },
  churned_count: {
    label: "Churned",
    description: "Memberships canceled per day.",
    mode: "flow",
    integer: true,
    format: int,
    guideFormat: int,
    unit: null,
    decimals: 0,
    upIsGood: false,
  },
};

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** The gutter the gridlines' labels sit in, left of the plot. */
const GUTTER = 44;

type Read<T> = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; data: T; at: string };

/** One read, run again whenever `run` changes or `again` is called; its answer is dropped when a newer read started. */
function useRead<T>(run: () => Promise<Answer<T>>): [Read<T>, () => void] {
  const [state, setState] = useState<Read<T>>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    void run().then((r) => {
      if (mine !== seq.current) return;
      setState(r.ok ? { kind: "ready", data: r.data, at: new Date().toISOString() } : { kind: "error", error: r.error });
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
    return { from: isoDay(Date.parse(today) - (Number(preset) - 1) * DAY), to: today };
  }, [preset, customFrom, customTo, today]);

  const snapshotsRun = useCallback(() => transport.loadSnapshots(range.from, range.to), [transport, range]);
  const bountyRun = useCallback(() => transport.loadBountyClaims(), [transport]);
  const sprintersRun = useCallback(() => transport.loadSprinters(), [transport]);
  const resetRun = useCallback(() => transport.loadResetAt(), [transport]);
  const [snapshots, retrySnapshots] = useRead(snapshotsRun);
  const [bounty, retryBounty] = useRead(bountyRun);
  const [sprinters, retrySprinters] = useRead(sprintersRun);
  const [reset, retryReset] = useRead(resetRun);

  const refreshAll = () => {
    retrySnapshots();
    retryBounty();
    retrySprinters();
    retryReset();
  };
  const loading = [snapshots, bounty, sprinters, reset].some((r) => r.kind === "loading");
  const updatedAt = snapshots.kind === "ready" ? snapshots.at : null;

  return (
    <ListPage>
      <ListHeader
        title="Insights"
        description="How the course is going, from a snapshot written every night at 00:30 UTC."
        meta={
          updatedAt ? (
            `Updated ${clockLabel(updatedAt)}${loading ? " · Updating" : ""}`
          ) : snapshots.kind === "error" ? (
            <FailedMeta text="Couldn't load the snapshots" />
          ) : (
            "Loading"
          )
        }
        action={
          <Button variant="raised" size="md" busy={loading} onClick={refreshAll}>
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-end" style={{ gap: 12, marginBottom: 20 }}>
        <div role="group" aria-label="Range" className={`${PILL_ROW} max-sm:w-[calc(100%+2rem)]`} style={{ gap: 8 }}>
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
      <BountyCard read={bounty} range={range} preset={preset} onRetry={retryBounty} />

      {snapshots.kind === "loading" ? (
        <Card padding={20}>
          <p role="status" style={T.bodyDim}>
            Loading the snapshots
          </p>
        </Card>
      ) : snapshots.kind === "error" ? (
        <LoadError title="Couldn't load the snapshots." detail={snapshots.error} onRetry={retrySnapshots} />
      ) : snapshots.data.length === 0 ? (
        <Card>
          <EmptyState title="No snapshots in this range." description="The nightly job writes one row a day." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2" style={{ gap: 16 }}>
          {reset.kind === "error" ? (
            <Card padding={20}>
              <h2 style={{ ...T.cardTitle, marginBottom: 8 }}>{METRICS.avg_progress.label}</h2>
              <ReadFailure raw={reset.error} lead="Couldn't read the date of the course switch, so the line is not drawn." />
            </Card>
          ) : reset.kind === "loading" ? (
            <Card padding={20}>
              <h2 style={T.cardTitle}>{METRICS.avg_progress.label}</h2>
              <p role="status" style={{ ...T.bodyDim, marginTop: 8 }}>
                Loading
              </p>
            </Card>
          ) : (
            <MetricCard metric="avg_progress" line={safeLine(snapshots.data, "avg_progress", range.to, reset.data)} />
          )}
          <MetricCard metric="active_count" line={safeLine(snapshots.data, "active_count", range.to, null)} />
          <div className="xl:col-span-2" style={{ minWidth: 0 }}>
            <MetricCard metric="churned_count" line={safeLine(snapshots.data, "churned_count", range.to, null)} />
          </div>
        </div>
      )}

      <CalcNotes courseIsNew={pace.courseIsNew} />
    </ListPage>
  );
}

/** The line, or the reason it cannot be drawn (a switch date that is no date: resetDateUtc throws). */
function safeLine(...args: Parameters<typeof metricLine>): { ok: true; points: ChartPoint[] } | { ok: false; error: string } {
  try {
    return { ok: true, points: metricLine(...args) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
        <div role="alert">
          <ReadFailure raw={counts.error} lead="Couldn't count." />
        </div>
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
 * The kit's status colours as a cell shows them: on the dot beside the
 * label, the number in the text colour, so green and red stay for the
 * changes' arrows and a status is never colour alone (its word is the
 * label). The Student journey's tiles show activity the same way (the
 * review's fix round). Mean progress was in Airy Blue until the render
 * review's fix round: Airy Blue marks a link, and no number here is one.
 */
const CELL_TONE = {
  plain: { dot: null, number: "var(--color-text-primary)" },
  success: { dot: "var(--color-success)", number: "var(--color-text-primary)" },
  warning: { dot: "var(--color-warning)", number: "var(--color-text-primary)" },
  danger: { dot: "var(--color-danger)", number: "var(--color-text-primary)" },
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
          <Cell label="Mean progress" value={value(d?.avgProgress)} suffix="%" tone="plain" description="Average completion across them." />
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

/**
 * The change from a line's first reading to its last, worked out by the
 * Dashboard's own deltaOf and written as the Dashboard writes it
 * (DashboardView's DeltaLine): the arrow in the status colour (green when
 * the move is good, red when it is bad), the words in the readable grey, so
 * the colour is never alone. A share changes in points, never in percent.
 */
function DeltaText({ line, def }: { line: ChartPoint[]; def: MetricDef }) {
  const delta = deltaOf(line);
  if (!delta) return null;
  const change = delta.change;
  const f = 10 ** def.decimals;
  const size = Math.round(Math.abs(change) * f) / f;
  const since = `since ${pointDay(delta.from)}`;
  const style: React.CSSProperties = { marginTop: 4, fontSize: 12, lineHeight: "16px", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" };
  if (size === 0) {
    return (
      <p style={style} data-delta="0">
        <span aria-hidden="true" style={{ color: "var(--color-neutral)", marginRight: 4 }}>→</span>
        No change {since}
      </p>
    );
  }
  const up = change > 0;
  const good = up === def.upIsGood;
  const amount = def.decimals > 0 ? String(size) : int(size);
  return (
    <p style={style} data-delta={up ? "up" : "down"}>
      <span aria-hidden="true" style={{ color: good ? "var(--color-success)" : "var(--color-danger)", marginRight: 4 }}>
        {up ? "↑" : "↓"}
      </span>
      <span className="sr-only">{up ? "Up " : "Down "}</span>
      {amount}
      {def.unit ? ` ${size === 1 ? def.unit[0] : def.unit[1]}` : ""} {since}
    </p>
  );
}

function MetricCard({ metric, line }: { metric: InsightsMetric; line: { ok: true; points: ChartPoint[] } | { ok: false; error: string } }) {
  const def = METRICS[metric];
  if (!line.ok) {
    return (
      <Card padding={20}>
        <h2 style={{ ...T.cardTitle, marginBottom: 8 }}>{def.label}</h2>
        <ReadFailure raw={line.error} lead="Couldn't draw the line." />
      </Card>
    );
  }
  const points = line.points;
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const last = [...points].reverse().find((p) => p.value !== null)?.value ?? null;
  const total = values.reduce((s, v) => s + v, 0);
  const kind = def.mode === "flow" ? "bars" : "line";
  const axis = axisTicks(values, kind, def.integer);
  return (
    <Card padding={20} style={{ minWidth: 0 }}>
      <div data-metric={metric}>
        <div className="flex flex-wrap items-baseline justify-between" style={{ gap: 8, marginBottom: 4 }}>
          <h2 style={T.cardTitle}>{def.label}</h2>
          <p style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
            {def.mode === "running" ? (last == null ? "No value" : def.format(last)) : `${int(total)} in the range`}
          </p>
        </div>
        <p style={{ ...T.bodyDim, fontSize: 12, lineHeight: 1.45 }}>{def.description}</p>
        {def.mode === "running" && <DeltaText line={points} def={def} />}
        <div style={{ marginTop: 24 }}>
          {values.length === 0 || (values.length < 2 && def.mode === "running") ? (
            <p style={{ ...T.bodyDim, padding: "24px 0", textAlign: "center" }}>
              {values.length === 0
                ? metric === "avg_progress"
                  ? "No snapshot since the course switch in this range."
                  : "No snapshot in this range."
                : metric === "avg_progress"
                  ? "One snapshot since the course switch in this range, so there is no line yet."
                  : "One snapshot in this range, so there is no line yet."}
            </p>
          ) : (
            <TrendChart
              points={points}
              kind={kind}
              height={180}
              label={def.label}
              format={def.format}
              guideFormat={def.guideFormat}
              axis
              domain={axis.domain}
              guides={axis.ticks}
              gutter={GUTTER}
              emptyText="No snapshot"
            />
          )}
        </div>
      </div>
    </Card>
  );
}

function BountyCard({
  read,
  range,
  preset,
  onRetry,
}: {
  read: Read<string[]>;
  range: { from: string; to: string };
  preset: RangePreset;
  onRetry: () => void;
}) {
  const claims = read.kind === "ready" ? read.data : null;
  // "All" starts on the first claim; any other range on its own first day.
  const days = useMemo(() => {
    if (!claims) return [];
    const from = preset === "all" ? (claims[0]?.slice(0, 10) ?? range.to) : range.from;
    return snapshotDays(from, range.to);
  }, [claims, preset, range]);
  const line = useMemo(() => (claims ? claimsLine(claims, days) : []), [claims, days]);

  if (read.kind === "error") return <ReadFailed title="Onboarded to the Bounty Program" error={read.error} onRetry={onRetry} />;

  let current: number | null = null;
  let delta: number | null = null;
  let deltaPct: number | null = null;
  if (claims && days.length > 0) {
    const fromMs = Date.parse(`${days[0]}T00:00:00.000Z`);
    current = claims.filter((ts) => Date.parse(ts) >= fromMs).length;
    if (preset !== "all") {
      const priorFrom = fromMs - days.length * DAY;
      const prior = claims.filter((ts) => {
        const t = Date.parse(ts);
        return t >= priorFrom && t < fromMs;
      }).length;
      delta = current - prior;
      deltaPct = prior > 0 ? Math.round(((current - prior) / prior) * 100) : null;
    }
  }
  const values = line.map((p) => p.value ?? 0);
  const axis = axisTicks(values, "bars", true);

  return (
    <Card padding={16} style={CARD}>
      <CardHead title="Onboarded to the Bounty Program" note={claims ? `${claims.length} in all time` : "Loading"} />
      <div className="flex flex-wrap items-baseline" style={{ gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
          {current == null ? "…" : current}
        </span>
        {delta != null && (
          <span style={{ ...T.body, fontVariantNumeric: "tabular-nums", color: "var(--color-text-secondary)" }}>
            <span aria-hidden="true" style={{ color: delta > 0 ? "var(--color-success)" : delta < 0 ? "var(--color-danger)" : "var(--color-neutral)", marginRight: 4 }}>
              {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}
            </span>
            {delta === 0 ? "The same as the period before" : `${Math.abs(delta)} ${delta > 0 ? "more" : "fewer"}`}
            {delta !== 0 && deltaPct != null && ` (${deltaPct > 0 ? "+" : ""}${deltaPct}%)`}
            {delta !== 0 && " than the period before"}
          </span>
        )}
      </div>
      {claims &&
        (line.length === 0 || values.every((v) => v === 0) ? (
          <p style={{ ...T.bodyDim, padding: "16px 0" }}>No Bounty Program claims in this range.</p>
        ) : (
          <div style={{ marginTop: 16 }}>
            <TrendChart
              points={line}
              kind="bars"
              height={120}
              label="Joined the Bounty Program"
              format={int}
              axis
              domain={axis.domain}
              guides={axis.ticks}
              gutter={GUTTER}
            />
          </div>
        ))}
    </Card>
  );
}

/** How the numbers are worked out, folded under one line. */
function CalcNotes({ courseIsNew }: { courseIsNew: boolean }) {
  const entries: Array<{ label: string; body: string }> = [
    {
      label: "Avg progress",
      body: "Mean completion across every active student, graduates at 100% included. It rises until churn or new joiners pull it down. The line starts on the day of the switch to the new course (19 October), as on the Dashboard, so the old course's 36% is not drawn beside the new course's near 3%; its change is in points. The Current sprinters card is the cleaner read of whether students who joined lately are moving.",
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
    { label: "Onboarded to the Bounty Program", body: "A live count of students who claimed the Bounty Program, stamped by its webhook, per UTC day." },
  ];
  return (
    <details style={{ marginTop: 24 }}>
      <FoldSummary>How these are worked out</FoldSummary>
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
