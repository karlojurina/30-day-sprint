"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import tokens from "@/components/admin/admin-tokens.module.css";
import { ListHeader, ListPage, TAP } from "@/components/admin/list-parts";
import { FailureList } from "@/components/admin/review-parts";
import { Button, Card, T } from "@/components/admin/ui";
import { clockLabel, dayLabel, dayTimeLabel } from "@/lib/admin/croatia-dates";
import {
  allFailed,
  buildDashboard,
  deltaOf,
  momentMs,
  refreshSummary,
} from "@/lib/admin/dashboard-metrics";
import type {
  AvgProgress,
  Bounty,
  Churned,
  DashboardModel,
  DashboardReads,
  Delta,
  MonthTwo,
  RefreshSummary,
  Tile,
  WithLine,
} from "@/lib/admin/dashboard-metrics";
import { DISCOUNT_LAUNCH_DATE } from "@/lib/world/discount";
import { TrendChart, pointDay } from "./TrendChart";

/**
 * The Dashboard, /admin, the admin's home (admin rebuild 2, D1 and D3), in
 * the brand kit's dark look.
 *
 * Top: Today, what waits for the team (open tasks, 30% requests to decide),
 * each tile a link to its page. Then the program's two numbers, Month 2
 * conversion and the Bounty Program: until the first Month 2 rate is in,
 * Month 2 is a compact tile beside the Bounty Program's chart (when the
 * first renewals come and how many paid since the launch); from then on, its
 * full tile with its chart. Then the trends of the last 14 days. Every tile
 * says where its number comes from, and the ones with a chart have "How it's
 * counted" with the whole rule.
 *
 * The numbers are worked out by src/lib/admin/dashboard-metrics.ts from what
 * `source` reads: the page (src/app/admin/(authenticated)/page.tsx) reads the
 * database, and the dev page /dev/admin/dashboard hands made-up reads, so
 * every state renders with no login. A read that failed shows "Couldn't
 * load" on each tile it feeds, and one line at the top says why in plain
 * words (read-failure.ts), with the database's own text behind Details and
 * Retry beside it; no failed read is ever shown as 0.
 *
 * Refresh reads every number again. "Sync Whop and rebuild" (founders and
 * admins, as POST /api/admin/refresh-everything allows) syncs Whop, rebuilds
 * the snapshots and runs the task checks, about 2 minutes; then the numbers
 * are read again, and what each step did shows for 12 seconds. While a read
 * failed, Retry in the line at the top is the reload.
 */

/** What the Dashboard reads and calls. */
export interface DashboardSource {
  /**
   * Every read, for the 14 days up to `nowMs` (the moment the numbers are
   * then worked out at, so the reads and the tiles agree on the days). Never
   * throws on a failed read: each failure is that read's DashRead error.
   */
  load(nowMs: number): Promise<DashboardReads>;
  /** POST /api/admin/refresh-everything: its status (0 for no answer) and its JSON. */
  refresh(): Promise<{ status: number; body: unknown }>;
}

const ACCENT = "var(--color-accent-dark)";
/** How long Refresh's line stays (the old page's 12 seconds). */
const NOTE_MS = 12_000;

const LAUNCH_DAY = dayLabel(DISCOUNT_LAUNCH_DATE);

const int = (n: number) => n.toLocaleString("en-US");
const pct0 = (v: number) => `${Math.round(v)}%`;
const pct1 = (v: number) => `${v.toFixed(1)}%`;
const pct2 = (v: number) => `${v.toFixed(2)}%`;
const plural = (n: number, one: string, many: string) => `${int(n)} ${n === 1 ? one : many}`;
/** "Wed 21 Oct" for a moment as admin_config holds it (ISO, or Postgres's own text, which browsers parse differently). */
const momentDay = (value: string) => {
  const ms = momentMs(value);
  return ms === null ? value : dayLabel(new Date(ms).toISOString());
};

export function DashboardView({
  source,
  canRefresh,
  now = Date.now,
}: {
  source: DashboardSource;
  /** Founders and admins: the roles the refresh route accepts. */
  canRefresh: boolean;
  /** The clock (the dev page pins it). */
  now?: () => number;
}) {
  const [model, setModel] = useState<DashboardModel | null>(null);
  const [reloading, setReloading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<RefreshSummary | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  /** Every read, then every tile, at one moment. */
  const compute = useCallback(async (): Promise<DashboardModel> => {
    const nowMs = now();
    let reads: DashboardReads;
    try {
      reads = await source.load(nowMs);
    } catch (e) {
      reads = allFailed(e instanceof Error ? e.message : String(e));
    }
    return buildDashboard(reads, nowMs);
  }, [source, now]);

  useEffect(() => {
    // Set here as well as cleared: React's development mode mounts twice.
    alive.current = true;
    return () => {
      alive.current = false;
      if (noteTimer.current) clearTimeout(noteTimer.current);
    };
  }, []);

  useEffect(() => {
    let current = true;
    void compute().then((m) => {
      if (current) setModel(m);
    });
    return () => {
      current = false;
    };
  }, [compute]);

  /** Reads again; the numbers on screen stay until the new ones are in. */
  const read = async () => {
    const m = await compute();
    if (alive.current) setModel(m);
  };

  const reload = async () => {
    if (reloading) return;
    setReloading(true);
    await read();
    if (alive.current) setReloading(false);
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setNote(null);
    let answer: { status: number; body: unknown };
    try {
      answer = await source.refresh();
    } catch {
      answer = { status: 0, body: null };
    }
    if (!alive.current) return;
    setNote(refreshSummary(answer.status, answer.body));
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), NOTE_MS);
    setReloading(true);
    await read();
    if (!alive.current) return;
    setReloading(false);
    setRefreshing(false);
  };

  /** Reads every number again: the ordinary reload, for every role. */
  const reloadButton = (
    <Button key="reload" variant="raised" size="md" busy={reloading && !refreshing} disabled={!model || refreshing} onClick={() => void reload()}>
      Refresh
    </Button>
  );
  const syncButton = canRefresh ? (
    <Button
      key="sync"
      variant="raised"
      size="md"
      busy={refreshing}
      onClick={() => void refresh()}
      title="Syncs Whop, rebuilds the snapshots and runs the task checks, then reads every number again. Takes about 2 minutes."
    >
      {refreshing ? "Syncing, about 2 minutes" : "Sync Whop and rebuild"}
    </Button>
  ) : null;

  // While a read failed, Retry in the line at the top is the reload: no Refresh beside it.
  const failed = model ? model.failed.length > 0 : false;
  const header = (meta: React.ReactNode) => (
    <ListHeader
      title="Dashboard"
      description="How the program is doing, and what is waiting for the team."
      meta={meta}
      actions={[failed ? null : reloadButton, syncButton].filter((b): b is React.JSX.Element => b !== null)}
    />
  );

  if (!model) {
    return (
      <ListPage>
        {header("Loading")}
        <DashboardSkeleton />
      </ListPage>
    );
  }

  const meta = [
    `Updated ${clockLabel(model.generatedAt)}`,
    refreshing ? "Syncing Whop and rebuilding, about 2 minutes" : reloading ? "Updating" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const waiting = model.monthTwo.ok && model.monthTwo.value.kind === "waiting" ? model.monthTwo.value : null;

  return (
    <ListPage>
      {header(meta)}

      {note && <RefreshNote note={note} />}
      {failed && <FailedReads model={model} onRetry={() => void reload()} busy={reloading} />}

      <section aria-labelledby="dash-today">
        <SectionTitle id="dash-today">Today</SectionTitle>
        <div className="grid grid-cols-2" style={{ gap: 12 }}>
          <CountTile
            tileName="open-tasks"
            href="/admin/tasks"
            title="Open tasks"
            tile={model.openTasks}
            go="Open the queue"
            none="All caught up"
            source={(v) => (v.since ? `Created since the reset, ${momentDay(v.since)}` : "Every open task in the queue")}
          />
          <CountTile
            tileName="to-decide"
            href="/admin/discounts"
            title="30% to decide"
            tile={model.toDecide}
            go="Open the 30% page"
            none="Nothing to decide"
            source={(v) => `Applied since ${dayLabel(v.since)}, waiting for a yes or no`}
          />
        </div>
      </section>

      <section style={{ marginTop: 40 }} aria-labelledby="dash-program">
        <SectionTitle id="dash-program">The program</SectionTitle>
        {waiting ? (
          // Until the first Month 2 rate: the Bounty Program's chart, and Month 2 as a compact tile beside it.
          <div className="grid grid-cols-1 md:grid-cols-3 items-start" style={{ gap: 16 }}>
            <div className="md:col-span-2" style={{ minWidth: 0 }}>
              <BountyCard tile={model.bounty} />
            </div>
            <MonthTwoCompact m={waiting} nowMs={Date.parse(model.generatedAt)} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 16 }}>
            <MonthTwoCard tile={model.monthTwo} />
            <BountyCard tile={model.bounty} />
          </div>
        )}
      </section>

      <section style={{ marginTop: 40 }} aria-labelledby="dash-trends">
        <div className="flex items-center justify-between" style={{ gap: 12, marginBottom: 4 }}>
          <SectionTitle id="dash-trends" flush>
            Trends · last 14 days
          </SectionTitle>
          <Link
            href="/admin/insights/progress"
            style={{
              minHeight: TAP,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              color: ACCENT,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Open Insights <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 12 }}>
          <ActiveTile tile={model.active} />
          <CancelingTile tile={model.canceling} />
          <ChurnedTile tile={model.churned} />
          <AvgProgressTile tile={model.avgProgress} />
        </div>
      </section>
    </ListPage>
  );
}

// ── Page pieces ─────────────────────────────────────────────────────────────

function SectionTitle({ id, children, flush = false }: { id: string; children: React.ReactNode; flush?: boolean }) {
  return (
    <h2 id={id} style={{ ...T.eyebrow, marginBottom: flush ? 0 : 12 }}>
      {children}
    </h2>
  );
}

const DOT: Record<RefreshSummary["tone"], string> = {
  ok: "var(--color-success)",
  warn: "var(--color-warning)",
  err: "var(--color-danger)",
};

/** What Refresh did, under the header, for 12 seconds. */
function RefreshNote({ note }: { note: RefreshSummary }) {
  return (
    <p
      role={note.tone === "err" ? "alert" : "status"}
      style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 16, ...T.body, lineHeight: 1.5 }}
    >
      <span aria-hidden="true" style={{ flex: "none", width: 8, height: 8, marginTop: 6, borderRadius: 999, background: DOT[note.tone] }} />
      <span style={{ overflowWrap: "anywhere" }}>{note.text}</span>
    </p>
  );
}

/**
 * The reads that failed, with Retry: why, in plain words, each reason once;
 * the reads by name with the database's own words behind Details. The tiles
 * they feed say "Couldn't load" and nothing more.
 */
function FailedReads({ model, onRetry, busy }: { model: DashboardModel; onRetry: () => void; busy: boolean }) {
  const tiles = [model.monthTwo, model.bounty, model.openTasks, model.toDecide, model.active, model.canceling, model.churned, model.avgProgress];
  const everything = tiles.every((t) => !t.ok);
  return (
    <Card padding={0} style={{ marginBottom: 24, borderColor: "var(--color-border-strong)" }}>
      <div role="alert" className="flex flex-wrap items-start" style={{ gap: 12, padding: 16 }}>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <p style={{ display: "flex", gap: 10, alignItems: "center", ...T.body, fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
            <span aria-hidden="true" style={{ flex: "none", width: 8, height: 8, borderRadius: 999, background: "var(--color-warning)" }} />
            {everything ? "Couldn't load the dashboard." : "Some numbers couldn't load."}
          </p>
          <FailureList failures={model.failed} />
        </div>
        <Button variant="raised" size="md" busy={busy} onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

/** "Couldn't load" in place of a number. Why is said once, in the line at the top of the page. */
function Failed({ big = false }: { big?: boolean }) {
  return (
    <div data-failed="" style={{ marginTop: big ? 14 : 10 }}>
      <p style={{ display: "flex", gap: 8, alignItems: "center", fontSize: big ? 22 : 17, fontWeight: 600, color: "var(--color-text-primary)", lineHeight: 1.2 }}>
        <span aria-hidden="true" style={{ flex: "none", width: 8, height: 8, borderRadius: 999, background: "var(--color-warning)" }} />
        Couldn&apos;t load
      </p>
    </div>
  );
}

/** A tile's header: its name, and the "How it's counted" button when it has one. */
function TileHead({
  title,
  level = 3,
  info,
}: {
  title: string;
  level?: 2 | 3;
  info?: Info;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="flex items-center justify-between" style={{ gap: 8, minHeight: 20 }}>
      <H style={{ ...T.eyebrow, minWidth: 0 }}>{title}</H>
      {info && (
        <button
          id={`${info.id}-button`}
          type="button"
          className={tokens.dashInfo}
          aria-expanded={info.open}
          aria-controls={info.id}
          aria-label={`How ${title} is counted`}
          title="How it's counted"
          onClick={(e) => info.onToggle(e.currentTarget)}
          style={{
            flex: "none",
            width: TAP,
            height: TAP,
            // A 44px target that takes no more room than its 20px ring.
            margin: -12,
            marginLeft: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            borderRadius: 999,
            background: "transparent",
            cursor: "pointer",
            color: "var(--color-text-secondary)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 20,
              height: 20,
              borderRadius: 999,
              border: "1px solid var(--color-border-strong)",
              fontSize: 12,
              fontWeight: 600,
              lineHeight: "18px",
              textAlign: "center",
              transition: "color var(--duration-quick) var(--ease-default), border-color var(--duration-quick) var(--ease-default)",
            }}
          >
            i
          </span>
        </button>
      )}
    </div>
  );
}

/** The rule behind a tile, open under it while its button is pressed. */
/**
 * The rule behind a tile, floating over the tile under its header while its
 * button is pressed: in the page's flow it would stretch the whole row and
 * drop the other tiles' lines to their feet. Escape or a press outside it
 * closes it. The kit allows a shadow on what floats. Its width and side are
 * set when it opens (useInfo), so on a phone's narrow tile it is still wide
 * enough to read and stays inside the window.
 */
function HowCounted({ info, top, children }: { info: Info; top: number; children: React.ReactNode }) {
  const place: React.CSSProperties = info.place
    ? { width: info.place.width, [info.place.side]: 12 }
    : { left: 12, right: 12 };
  return (
    <div
      id={info.id}
      hidden={!info.open}
      style={{
        position: "absolute",
        ...place,
        top,
        zIndex: 4,
        padding: "12px 14px",
        borderRadius: "var(--radius-control)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-strong)",
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
        ...T.bodyDim,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}

interface Info {
  /** The panel's id; its button's is this with "-button". */
  id: string;
  open: boolean;
  /** Where the panel sits, worked out when it opened: its width, and the tile edge it hangs from. */
  place: { width: number; side: "left" | "right" } | null;
  /** Opens or closes it; `button` is the button pressed, measured to place the panel. */
  onToggle: (button: HTMLElement) => void;
}

/** The panel's width: its tile's inside, or 340px when the tile is narrower (and never wider than the window allows). */
const PANEL_MAX = 340;

/** A tile's "How it's counted": open or not, closed by Escape (focus back on its button) or a press outside. */
function useInfo(): Info {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Info["place"]>(null);
  useEffect(() => {
    if (!open) return;
    // Found by id when an event comes: the panel and its button.
    const panel = () => document.getElementById(id);
    const button = () => document.getElementById(`${id}-button`);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button()?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (panel()?.contains(t) || button()?.contains(t))) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, id]);
  const onToggle = (button: HTMLElement) => {
    if (open) {
      setOpen(false);
      return;
    }
    const tile = button.closest("[data-tile]");
    if (tile) {
      const r = tile.getBoundingClientRect();
      const room = document.documentElement.clientWidth;
      const width = Math.max(r.width - 24, Math.min(PANEL_MAX, room - 32));
      setPlace({ width, side: r.left + 12 + width <= room - 16 ? "left" : "right" });
    }
    setOpen(true);
  };
  return { id, open, place, onToggle };
}

/** The line under a chart that says where its number comes from. */
function SourceLine({ children }: { children: React.ReactNode }) {
  return <p style={{ marginTop: 12, fontSize: 12, lineHeight: 1.45, color: "var(--color-text-secondary)" }}>{children}</p>;
}

/** A big number, in proportional figures (the kit's rule for a number that stands alone). */
function BigNumber({ children, size }: { children: React.ReactNode; size: number }) {
  return (
    <p
      data-number=""
      style={{
        fontSize: size,
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: "-0.03em",
        color: "var(--color-text-primary)",
        fontVariantNumeric: "proportional-nums",
      }}
    >
      {children}
    </p>
  );
}

/**
 * The change from the first reading of a line to its last: the arrow in the
 * status colour (green when the move is good, red when it is bad, grey when
 * flat), the words in the readable grey, so the colour is never alone.
 */
function DeltaLine({
  delta,
  upIsGood,
  decimals = 0,
  unit = null,
}: {
  delta: Delta | null;
  upIsGood: boolean;
  decimals?: number;
  /** [one, many]: ["pt", "pts"]; none for a count. */
  unit?: [string, string] | null;
}) {
  if (!delta) return null;
  const f = 10 ** decimals;
  const size = Math.round(Math.abs(delta.change) * f) / f;
  const since = `since ${pointDay(delta.from)}`;
  if (size === 0) {
    return (
      <p style={{ marginTop: 8, fontSize: 12, lineHeight: "16px", color: "var(--color-text-secondary)" }}>
        <span aria-hidden="true" style={{ color: "var(--color-neutral)", marginRight: 4 }}>→</span>
        No change {since}
      </p>
    );
  }
  const up = delta.change > 0;
  const good = up === upIsGood;
  const amount = decimals > 0 ? String(size) : int(size);
  return (
    <p style={{ marginTop: 8, fontSize: 12, lineHeight: "16px", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
      <span aria-hidden="true" style={{ color: good ? "var(--color-success)" : "var(--color-danger)", marginRight: 4 }}>
        {up ? "↑" : "↓"}
      </span>
      <span className="sr-only">{up ? "Up " : "Down "}</span>
      {amount}
      {unit ? ` ${size === 1 ? unit[0] : unit[1]}` : ""} {since}
    </p>
  );
}

// ── The two north-star numbers ──────────────────────────────────────────────

/** A hero card: the kit's card, 20px of air on a phone, 24px on a wide screen. */
function HeroCard({ tile, children }: { tile?: string; children: React.ReactNode }) {
  return (
    <Card padding={0} style={{ minWidth: 0 }}>
      <div data-tile={tile} className="p-5 sm:p-6" style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
        {children}
      </div>
    </Card>
  );
}

/** Month 2's rule, the same words on its full tile and its compact one. */
function MonthTwoHow() {
  return (
    <>
      Of the students on the monthly plan who first paid on or after {LAUNCH_DAY}, the share still paying after their
      first renewal: a week after it they still have access, or it ended later, and they had not booked a cancel by the
      renewal. Students who paid before {LAUNCH_DAY} are not counted. Nothing in the app records payments, so this reads
      the access Whop gives. The line is the rate at the end of each day.
    </>
  );
}

/** Month 2's full tile: its rate and its chart, or "Couldn't load". Until the first rate, MonthTwoCompact stands in. */
function MonthTwoCard({ tile }: { tile: Tile<MonthTwo> }) {
  const info = useInfo();
  return (
    <HeroCard tile="month2">
      <TileHead title="Month 2 conversion" level={2} info={info} />
      {!tile.ok ? <Failed big /> : tile.value.kind === "rate" ? <MonthTwoRate m={tile.value} /> : null}
      <SourceLine>Students on the monthly plan who first paid from {LAUNCH_DAY}.</SourceLine>
      <HowCounted info={info} top={56}>
        <MonthTwoHow />
      </HowCounted>
    </HeroCard>
  );
}

function MonthTwoRate({ m }: { m: Extract<MonthTwo, { kind: "rate" }> }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline" style={{ gap: "6px 12px", marginTop: 14 }}>
        <BigNumber size={56}>{pct0(m.rate * 100)}</BigNumber>
        <p style={{ ...T.bodyDim, fontSize: 13 }}>
          {int(m.converted)} of {plural(m.resolved, "student", "students")} still paying after their first renewal
        </p>
      </div>
      <DeltaLine delta={deltaOf(m.line)} upIsGood decimals={0} unit={["pt", "pts"]} />
      <div style={{ marginTop: 40 }}>
        <TrendChart
          points={m.line}
          kind="line"
          height={112}
          label="Month 2 conversion"
          format={pct0}
          axis
          domain={[0, 100]}
          guides={[50, 100]}
          emptyText="Nobody past a renewal yet"
        />
      </div>
    </>
  );
}

/**
 * Month 2 before its first rate: a compact tile beside the Bounty Program,
 * with no headline of its own. When the first renewals come, the 2 small
 * numbers (paid since the launch, days until the first rate) and the
 * countdown line from the launch to the first rate. With no payment since
 * the launch yet, one line says so.
 */
function MonthTwoCompact({ m, nowMs }: { m: Extract<MonthTwo, { kind: "waiting" }>; nowMs: number }) {
  const info = useInfo();
  return (
    <HeroCard tile="month2">
      <TileHead title="Month 2 conversion" level={2} info={info} />
      <MonthTwoWaiting m={m} nowMs={nowMs} />
      <SourceLine>Students on the monthly plan who first paid from {LAUNCH_DAY}.</SourceLine>
      <HowCounted info={info} top={56}>
        <MonthTwoHow />
      </HowCounted>
    </HeroCard>
  );
}

function MonthTwoWaiting({ m, nowMs }: { m: Extract<MonthTwo, { kind: "waiting" }>; nowMs: number }) {
  const renewal = dayLabel(`${m.firstRenewalDay}T12:00:00.000Z`);
  if (m.paid === 0 || !m.firstRateAt) {
    return (
      <p style={{ ...T.bodyDim, marginTop: 12, lineHeight: 1.5 }}>
        No first payment since {LAUNCH_DAY} yet. The rate shows about 5 weeks after the first one, once its first renewal
        has had a week to go through.
      </p>
    );
  }
  const startMs = Date.parse(DISCOUNT_LAUNCH_DATE);
  const endMs = Date.parse(m.firstRateAt);
  const done = Math.max(0, Math.min(1, (nowMs - startMs) / Math.max(1, endMs - startMs)));
  const daysLeft = Math.max(0, Math.ceil((endMs - nowMs) / 86_400_000));
  const rateDay = dayLabel(m.firstRateAt);
  const renewalPassed = nowMs >= Date.parse(`${m.firstRenewalDay}T00:00:00.000Z`);
  const stat: React.CSSProperties = { marginTop: 6, fontSize: 12, lineHeight: 1.4, color: "var(--color-text-secondary)" };
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", flex: 1 }}>
      <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>
        {renewalPassed ? "First renewals since " : "First renewals from "}
        <span style={{ whiteSpace: "nowrap" }}>{renewal}</span>. The rate shows from{" "}
        <span style={{ whiteSpace: "nowrap" }}>{rateDay}</span>.
      </p>
      <div className="grid grid-cols-2" style={{ marginTop: 16 }}>
        <div style={{ paddingRight: 12 }}>
          <BigNumber size={24}>{int(m.paid)}</BigNumber>
          <p style={stat}>paid since {LAUNCH_DAY}</p>
        </div>
        <div style={{ paddingLeft: 12, borderLeft: "1px solid var(--color-border)" }}>
          <BigNumber size={24}>{daysLeft === 0 ? "Today" : int(daysLeft)}</BigNumber>
          <p style={stat}>{daysLeft === 0 ? "the first rate shows" : `${daysLeft === 1 ? "day" : "days"} until the first rate`}</p>
        </div>
      </div>
      <div style={{ paddingTop: 20 }}>
        <div
          role="meter"
          aria-label="Time until the first Month 2 rate"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(done * 100)}
          aria-valuetext={`${plural(daysLeft, "day", "days")} until ${rateDay}`}
          style={{ position: "relative", height: 6, borderRadius: 999, background: "var(--color-fill-secondary)" }}
        >
          <div style={{ width: `${done * 100}%`, height: "100%", borderRadius: 999, background: ACCENT }} />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "50%",
              left: `${done * 100}%`,
              width: 12,
              height: 12,
              marginLeft: -6,
              marginTop: -6,
              borderRadius: 999,
              background: ACCENT,
              boxShadow: "0 0 0 2px var(--color-bg-card)",
            }}
          />
        </div>
        <div className="flex justify-between" style={{ gap: 12, marginTop: 10, fontSize: 12, color: "var(--color-text-secondary)" }}>
          <span>{LAUNCH_DAY}</span>
          <span>{rateDay}</span>
        </div>
      </div>
    </div>
  );
}

function BountyCard({ tile }: { tile: Tile<Bounty> }) {
  const info = useInfo();
  return (
    <HeroCard tile="bounty">
      <TileHead title="Bounty Program · joined" level={2} info={info} />
      {!tile.ok ? (
        <Failed big />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline" style={{ gap: "6px 12px", marginTop: 14 }}>
            <BigNumber size={56}>{int(tile.value.last14)}</BigNumber>
            <p style={{ ...T.bodyDim, fontSize: 13 }}>
              in the last 14 days · {int(tile.value.allTime)} all time
            </p>
          </div>
          <p style={{ marginTop: 8, fontSize: 12, lineHeight: "16px", color: "var(--color-text-secondary)" }}>
            {tile.value.last14 === 0 ? "Nobody joined in these 14 days." : "Joined per day"}
          </p>
          <div style={{ marginTop: 16 }}>
            <TrendChart points={tile.value.line} kind="bars" height={124} label="Joined the Bounty Program" format={int} axis />
          </div>
        </>
      )}
      <SourceLine>Students on the monthly plan since Mon 25 May who joined on the bounty site.</SourceLine>
      <HowCounted info={info} top={56}>
        Students who joined the Bounty Program, by the day the bounty site stamped them (in UTC), among the students on
        the monthly plan who first paid on or after Mon 25 May. The same count as before the new program.
      </HowCounted>
    </HeroCard>
  );
}

// ── Today ───────────────────────────────────────────────────────────────────

function CountTile<V extends { count: number }>({
  tileName,
  href,
  title,
  tile,
  go,
  none,
  source,
}: {
  /** For world-tests: data-tile. */
  tileName: string;
  href: string;
  title: string;
  tile: Tile<V>;
  /** What the tile does, when there is something to do. */
  go: string;
  /** What a 0 means. */
  none: string;
  /** Where the number comes from. */
  source: (v: V) => string;
}) {
  return (
    <Link href={href} data-tile={tileName} className={tokens.dashLinkTile} style={{ minWidth: 0 }}>
      <div className="p-4 sm:p-5" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div className="flex items-center justify-between" style={{ gap: 8 }}>
          <h3 style={{ ...T.eyebrow, minWidth: 0 }}>{title}</h3>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flex: "none", color: "var(--color-text-secondary)" }}
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
        </div>
        {!tile.ok ? (
          <Failed />
        ) : (
          <>
            <div style={{ marginTop: 12 }}>
              <BigNumber size={44}>{int(tile.value.count)}</BigNumber>
            </div>
            <p style={{ marginTop: 10, ...T.body, fontWeight: 600, color: tile.value.count > 0 ? ACCENT : "var(--color-text-secondary)" }}>
              {tile.value.count > 0 ? go : none}
            </p>
            <p style={{ marginTop: "auto", paddingTop: 10, fontSize: 12, lineHeight: 1.45, color: "var(--color-text-secondary)" }}>
              {source(tile.value)}
            </p>
          </>
        )}
      </div>
    </Link>
  );
}

// ── Trends ──────────────────────────────────────────────────────────────────

/**
 * A trend tile: its name, the number and its change, where they come from,
 * then the line at the foot of the tile, so the four lines of a row sit level
 * whatever the words above them take.
 */
function TrendCard({
  tile,
  title,
  info,
  how,
  source,
  chart,
  children,
}: {
  /** For world-tests: data-tile. */
  tile: string;
  title: string;
  info: Info;
  how: React.ReactNode;
  /** Where the number and the line come from, in a few words. */
  source: React.ReactNode;
  /** The line, or why there is none. */
  chart?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card padding={0} style={{ minWidth: 0 }}>
      <div data-tile={tile} className="p-4" style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
        <TileHead title={title} info={info} />
        {children}
        <SourceLine>{source}</SourceLine>
        {chart}
        <HowCounted info={info} top={46}>
          {how}
        </HowCounted>
      </div>
    </Card>
  );
}

/** A trend tile's line at the foot of the tile, or why there is none. */
function Spark({
  line,
  label,
  format,
  kind = "line",
}: {
  line: Tile<{ date: string; value: number | null }[]>;
  label: string;
  format: (v: number) => string;
  kind?: "line" | "bars";
}) {
  const note: React.CSSProperties = { marginTop: "auto", paddingTop: 14, fontSize: 12, lineHeight: 1.45, color: "var(--color-text-secondary)", overflowWrap: "anywhere" };
  if (!line.ok) return <p style={note}>Couldn&apos;t load the line</p>;
  if (!line.value.some((p) => p.value !== null)) return <p style={note}>No snapshot in these 14 days</p>;
  return (
    <div style={{ marginTop: "auto", paddingTop: 22 }}>
      <TrendChart points={line.value} kind={kind} height={44} label={label} format={format} emptyText="No snapshot" />
    </div>
  );
}

function TrendNumber({ children, unit }: { children: React.ReactNode; unit?: string }) {
  return (
    <div className="flex flex-wrap items-baseline" style={{ gap: "2px 6px", marginTop: 12, minWidth: 0 }}>
      <BigNumber size={30}>{children}</BigNumber>
      {unit && <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{unit}</span>}
    </div>
  );
}

function ActiveTile({ tile }: { tile: Tile<WithLine> }) {
  const info = useInfo();
  return (
    <TrendCard
      tile="active"
      title="Active on platform"
      info={info}
      source="Whop status now, the line from the nightly snapshot"
      chart={tile.ok ? <Spark line={tile.value.line} label="Active on platform" format={int} /> : null}
      how={
        <>
          The number: students on the monthly plan who first paid on or after Mon 25 May, whose Whop status is active
          or payment failed, now. The line: the nightly snapshot&apos;s count for each day, which counts every student of
          that group whose access had not ended that day. The two are counted differently, so they can differ.
        </>
      }
    >
      {!tile.ok ? (
        <Failed />
      ) : (
        <>
          <TrendNumber>{int(tile.value.count)}</TrendNumber>
          <DeltaLine delta={tile.value.line.ok ? deltaOf(tile.value.line.value) : null} upIsGood />
        </>
      )}
    </TrendCard>
  );
}

function CancelingTile({ tile }: { tile: Tile<WithLine> }) {
  const info = useInfo();
  return (
    <TrendCard
      tile="canceling"
      title="Canceling"
      info={info}
      source="Whop now, the line from the nightly snapshot"
      chart={tile.ok ? <Spark line={tile.value.line} label="Canceling" format={int} /> : null}
      how={
        <>
          Students on the monthly plan since Mon 25 May who pressed cancel in Whop and still have access until the end of
          what they paid for, now. The line: the count the snapshot took each night.
        </>
      }
    >
      {!tile.ok ? (
        <Failed />
      ) : (
        <>
          <TrendNumber unit="pressed cancel">{int(tile.value.count)}</TrendNumber>
          <DeltaLine delta={tile.value.line.ok ? deltaOf(tile.value.line.value) : null} upIsGood={false} />
        </>
      )}
    </TrendCard>
  );
}

function ChurnedTile({ tile }: { tile: Tile<Churned> }) {
  const info = useInfo();
  const read = tile.ok && tile.value.daysRead > 0 ? tile.value : null;
  return (
    <TrendCard
      tile="churned"
      title="Churned"
      info={info}
      source="The nightly snapshot"
      chart={read ? <Spark line={{ ok: true, value: read.line }} label="Churned" format={int} kind="bars" /> : null}
      how={
        <>
          Students on the monthly plan since Mon 25 May whose access ended, per day, from the nightly snapshot. The number
          adds up the days of the last 14 that have a snapshot.
        </>
      }
    >
      {!tile.ok ? (
        <Failed />
      ) : !read ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--color-text-secondary)" }}>No snapshot in these 14 days</p>
      ) : (
        <>
          <TrendNumber unit={read.daysRead === 14 ? "in 14 days" : `in ${plural(read.daysRead, "day", "days")} with a snapshot`}>
            {int(read.total)}
          </TrendNumber>
          <p style={{ marginTop: 8, fontSize: 12, lineHeight: "16px", color: "var(--color-text-secondary)" }}>Access ended, per day</p>
        </>
      )}
    </TrendCard>
  );
}

function AvgProgressTile({ tile }: { tile: Tile<AvgProgress> }) {
  const info = useInfo();
  const v = tile.ok && tile.value.kind === "value" ? tile.value : null;
  return (
    <TrendCard
      tile="avg-progress"
      title="Avg progress"
      info={info}
      source={
        v
          ? v.builtAt
            ? `The nightly snapshot, built ${dayTimeLabel(v.builtAt)}`
            : `The nightly snapshot of ${pointDay(v.date)}`
          : "The nightly snapshot"
      }
      chart={v ? <Spark line={{ ok: true, value: v.line }} label="Avg progress" format={pct2} /> : null}
      how={
        <>
          One number for the tile and its line: the nightly snapshot&apos;s average progress. That is the lessons that
          count, finished by the students on the monthly plan since Mon 25 May whose access has not ended, divided by
          those students times the lessons that count. The number is the newest snapshot; the line starts on the day of
          the switch to the new course. Refresh rebuilds today&apos;s.
        </>
      }
    >
      {!tile.ok ? (
        <Failed />
      ) : tile.value.kind === "none" ? (
        <p style={{ marginTop: 12, fontSize: 13, lineHeight: 1.45, color: "var(--color-text-secondary)" }}>
          No snapshot since the switch, {pointDay(tile.value.since)}, yet
        </p>
      ) : (
        <>
          <TrendNumber>{pct1(tile.value.value)}</TrendNumber>
          <DeltaLine delta={deltaOf(tile.value.line)} upIsGood decimals={2} unit={["pt", "pts"]} />
        </>
      )}
    </TrendCard>
  );
}

// ── Loading ─────────────────────────────────────────────────────────────────

function Bar({ w, h = 10, mt = 0 }: { w: string; h?: number; mt?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{ width: w, height: h, marginTop: mt, borderRadius: 6, background: "var(--color-fill-secondary)" }}
    />
  );
}

/** The page's shape in grey while it loads: the kit's skeletons, never a spinner. */
export function DashboardSkeleton() {
  return (
    <div>
      <p role="status" className="sr-only">
        Loading the dashboard
      </p>
      <div aria-hidden="true">
        <div>
          <Bar w="64px" h={11} />
          <div className="grid grid-cols-2" style={{ gap: 12, marginTop: 12 }}>
            {[0, 1].map((i) => (
              <Card key={i} padding={0}>
                <div className="p-4 sm:p-5">
                  <Bar w="45%" h={11} />
                  <Bar w="28%" h={40} mt={14} />
                  <Bar w="60%" mt={14} />
                </div>
              </Card>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 40 }}>
          <Bar w="120px" h={11} />
          <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 16, marginTop: 12 }}>
            {[0, 1].map((i) => (
              <HeroCard key={i}>
                <Bar w="38%" h={11} />
                <Bar w="30%" h={48} mt={18} />
                <Bar w="55%" mt={14} />
                <Bar w="100%" h={112} mt={32} />
              </HeroCard>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 40 }}>
          <Bar w="160px" h={11} />
          <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 12, marginTop: 12 }}>
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} padding={0}>
                <div className="p-4">
                  <Bar w="55%" h={11} />
                  <Bar w="40%" h={28} mt={14} />
                  <Bar w="70%" mt={12} />
                  <Bar w="100%" h={44} mt={24} />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
