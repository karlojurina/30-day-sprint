"use client";

/**
 * /admin — top-level dashboard.
 *
 * Stacks three sections in priority order:
 *   1. North-star KPI: Month 2 conversion (Karlo's headline number).
 *   2. Today: count tiles for open tasks + pending discounts — the
 *      two things that actually demand attention right now.
 *   3. Trends · last 14 days: four sparkline tiles fed by the
 *      daily_progress_snapshots table.
 *
 * Refresh button runs Whop sync + snapshot rebuild + dashboard
 * reload in sequence; partial failures surface inline but don't
 * block the other steps.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Student } from "@/types/database";
import {
  TOTAL_LESSONS,
  progressPercent,
  ADMIN_STUDENT_JOIN_CUTOFF,
  TASKS_STUDENT_JOIN_CUTOFF,
} from "@/lib/constants";
import Link from "next/link";
import {
  AdminPage,
  PageHeader,
  Section,
  Card,
  Button,
  T,
} from "@/components/admin/ui";

interface MetricPoint {
  snapshot_date: string;
  avg_progress: number;
  active_count: number;
  joined_count: number;
  churned_count: number;
}

interface DashboardData {
  totalStudents: number;
  activeStudents: number;
  joinedThisWeek: number;
  avgProgress: number;
  canceledThisMonth: number;
  pendingDiscounts: number;
  openTasks: number;
  monthTwoConversionRate: number | null;
  monthTwoCohortSize: number;
  /** # of students who have joined the Bounty Program (Zak's webhook
   *  stamps bounty_access_claimed_at). */
  bountyAccessCount: number;
  /** Last 14 days of nightly snapshots (oldest first) — feeds the sparkline tiles. */
  trend: MetricPoint[];
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const supabase = createClient();

  const fetchDashboard = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);

      const now = Date.now();
      const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
      const thirtyDaysAgo = new Date(now - 30 * 86_400_000).toISOString();

      const fourteenDaysAgo = new Date(now - 14 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const [
        studentsRes,
        completionsRes,
        lessonsRes,
        discountsRes,
        tasksRes,
        snapshotsRes,
        milestonesRes,
      ] = await Promise.all([
        supabase
          .from("students")
          .select("*")
          .not("whop_membership_id", "is", null)
          .in("membership_status", ["active", "past_due", "canceled"])
          .gte("joined_at", ADMIN_STUDENT_JOIN_CUTOFF),
        // Per-student counts via a pre-aggregated view. Querying
        // student_lesson_completions directly truncates at the
        // 1000-row PostgREST cap once the community is large.
        supabase
          .from("student_progress_counts")
          .select("student_id, completed_count"),
        supabase.from("lessons").select("id", { count: "exact", head: true }),
        supabase.from("discount_requests").select("id").eq("status", "pending"),
        // Mirror /api/admin/tasks filtering exactly so the dashboard
        // count and the Tasks page count agree. !inner forces the
        // join; the eq + gte on the joined columns hides tasks for
        // csm_exempt students and pre-launch joiners.
        supabase
          .from("tasks")
          .select(
            "id, student:students!inner(csm_exempt, joined_at)",
            { count: "exact", head: true },
          )
          .eq("status", "open")
          .eq("student.csm_exempt", false)
          .gte("student.joined_at", TASKS_STUDENT_JOIN_CUTOFF),
        supabase
          .from("daily_progress_snapshots")
          .select(
            "snapshot_date, avg_progress, active_count, joined_count, churned_count",
          )
          .gte("snapshot_date", fourteenDaysAgo)
          .order("snapshot_date", { ascending: true }),
        // Bounty count - feeds the "Bounty Program · joined" hero stat.
        supabase
          .from("student_milestones")
          .select("student_id, bounty_access_claimed_at"),
      ]);

      const students = (studentsRes.data || []) as Student[];
      const completions = completionsRes.data || [];
      const totalLessons =
        typeof lessonsRes.count === "number" && lessonsRes.count > 0
          ? lessonsRes.count
          : TOTAL_LESSONS;

      const completionMap: Record<string, number> = {};
      for (const r of completions) {
        completionMap[r.student_id] = r.completed_count;
      }

      const activeStudents = students.filter(
        (s) => s.membership_status === "active",
      );
      const joinedThisWeek = students.filter(
        (s) => s.joined_at >= weekAgo,
      ).length;
      const canceledThisMonth = students.filter(
        (s) =>
          s.membership_status === "canceled" && s.updated_at >= thirtyDaysAgo,
      ).length;

      const avgProgress =
        activeStudents.length > 0
          ? Math.round(
              activeStudents.reduce(
                (sum, s) =>
                  sum +
                  progressPercent(completionMap[s.id] || 0, totalLessons),
                0,
              ) / activeStudents.length,
            )
          : 0;

      const matureCohort = students.filter(
        (s) => s.joined_at <= thirtyDaysAgo,
      );
      const matureActive = matureCohort.filter(
        (s) => s.membership_status === "active",
      ).length;
      const monthTwoConversionRate =
        matureCohort.length > 0 ? matureActive / matureCohort.length : null;

      const trend = (snapshotsRes.data ?? []).map((r) => ({
        snapshot_date: r.snapshot_date as string,
        avg_progress: Number(r.avg_progress),
        active_count: Number(r.active_count ?? 0),
        joined_count: Number(r.joined_count ?? 0),
        churned_count: Number(r.churned_count ?? 0),
      }));

      // Bounty count - just "how many people joined the bounty program."
      // No funnel, no rate, no first-client overlay - those aren't bounty
      // signals.
      const milestoneRows = (milestonesRes.data ?? []) as Array<{
        student_id: string;
        bounty_access_claimed_at: string | null;
      }>;
      const bountyAccessCount = milestoneRows.filter(
        (m) => m.bounty_access_claimed_at,
      ).length;

      setData({
        totalStudents: students.length,
        activeStudents: activeStudents.length,
        joinedThisWeek,
        avgProgress,
        canceledThisMonth,
        pendingDiscounts: discountsRes.data?.length || 0,
        openTasks: tasksRes.count ?? 0,
        monthTwoConversionRate,
        monthTwoCohortSize: matureCohort.length,
        bountyAccessCount,
        trend,
      });

      setLastRefreshed(new Date());
      setLoading(false);
    },
    [supabase],
  );

  useEffect(() => {
    void fetchDashboard(false);
  }, [fetchDashboard]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
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
    );
  }

  return (
    <AdminPage>
      <PageHeader
        title="Dashboard"
        description="The numbers that matter for the next month."
        actions={
          <>
            {lastRefreshed && (
              <span style={{ ...T.meta, marginRight: 4 }}>
                Updated {lastRefreshed.toLocaleTimeString()}
              </span>
            )}
            <RefreshEverything onDone={() => void fetchDashboard(true)} />
          </>
        }
      />

      {/* ─── Hero: Month 2 conversion + AdValue placeholder ─── */}
      <Section>
        <div
          className="grid grid-cols-1 md:grid-cols-2"
          style={{ gap: 16 }}
        >
          <HeroStat
            label="Month 2 conversion"
            value={
              data.monthTwoConversionRate == null
                ? "—"
                : `${Math.round(data.monthTwoConversionRate * 100)}%`
            }
            sublabel={
              data.monthTwoConversionRate == null
                ? "No platform cohort past 30 days yet."
                : `${Math.round(
                    (data.monthTwoConversionRate ?? 0) *
                      data.monthTwoCohortSize,
                  )} of ${data.monthTwoCohortSize} platform signups past day 30 still active. Whop-wide churn not yet counted.`
            }
            accent
          />
          <HeroStat
            label="Bounty Program · joined"
            value={String(data.bountyAccessCount)}
            sublabel="Students who finished the course and onboarded to the Bounty Program (Zak's webhook)."
          />
        </div>
      </Section>

      {/* ─── Today — what's waiting ─── */}
      <Section eyebrow="Today">
        <div
          className="grid grid-cols-1 sm:grid-cols-2"
          style={{ gap: 12 }}
        >
          <AttentionTile
            href="/admin/tasks"
            label="Open tasks"
            count={data.openTasks}
            zeroLabel="All caught up"
            actionLabel="Open queue"
          />
          <AttentionTile
            href="/admin/discounts"
            label="Pending discounts"
            count={data.pendingDiscounts}
            zeroLabel="None to review"
            actionLabel="Open queue"
          />
        </div>
      </Section>

      {/* ─── Trends · last 14 days ─── */}
      <Section eyebrow="Trends · last 14 days">
        <div
          className="grid grid-cols-2 lg:grid-cols-4"
          style={{ gap: 12 }}
        >
          <SparklineTile
            label="Active on platform"
            current={data.activeStudents}
            points={data.trend.map((p) => p.active_count)}
            mode="running"
            color="var(--color-success)"
          />
          <SparklineTile
            label="Joined"
            current={data.trend.reduce((s, p) => s + p.joined_count, 0)}
            currentSuffix=" / 14d"
            points={data.trend.map((p) => p.joined_count)}
            mode="running"
            color="var(--color-accent-dark)"
          />
          <SparklineTile
            label="Churned"
            current={data.trend.reduce((s, p) => s + p.churned_count, 0)}
            currentSuffix=" / 14d"
            points={data.trend.map((p) => p.churned_count)}
            mode="running"
            color="var(--color-danger)"
            inverseDelta
          />
          <SparklineTile
            label="Avg progress"
            current={data.avgProgress}
            currentSuffix="%"
            points={data.trend.map((p) => p.avg_progress)}
            mode="running"
            color="var(--color-accent-dark)"
            deltaSuffix="%"
          />
          {/* v74.1 - bounty sparkline tile removed from here per
              Karlo's clarification: bounty is one of the TWO hero
              stats (month 2 conversion + bounty joined), not a
              14d-trend tile. The hero card above is the canonical
              place; this row is for the daily-snapshot trend
              metrics only. */}
        </div>
      </Section>
    </AdminPage>
  );
}

/* ─── Hero stat (full-card) ─── */

/**
 * Big display-tier hero stat used in the dashboard's top section.
 * Two of these sit side-by-side in the hero row. `accent` paints
 * the label + value in the brand sage so the primary KPI carries
 * a touch more visual weight than its neighbour.
 */
function HeroStat({
  label,
  value,
  sublabel,
  accent = false,
}: {
  label: string;
  value: string;
  sublabel: string;
  accent?: boolean;
}) {
  return (
    <Card padding={32}>
      <p
        style={{
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "-0.005em",
          color: accent
            ? "var(--color-accent-dark)"
            : "var(--color-text-tertiary)",
        }}
      >
        {label}
      </p>
      <p
        className="stat-value"
        style={{
          fontSize: 56,
          fontWeight: 600,
          lineHeight: 1.0,
          letterSpacing: "-0.028em",
          color: accent
            ? "var(--color-accent-dark)"
            : "var(--color-text-primary)",
          marginTop: 12,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </p>
      <p
        style={{
          ...T.bodyDim,
          marginTop: 14,
          lineHeight: 1.4,
        }}
      >
        {sublabel}
      </p>
    </Card>
  );
}

/* ─── Attention tile ─── */

/**
 * Big count tile that doubles as a call-to-action card. When the
 * count is zero we soften the visual (no warm pill) so the eye
 * doesn't get pulled to nothing.
 */
function AttentionTile({
  href,
  label,
  count,
  zeroLabel,
  actionLabel,
}: {
  href: string;
  label: string;
  count: number;
  zeroLabel: string;
  actionLabel: string;
}) {
  const isPositive = count > 0;
  return (
    <Card href={href} padding={20}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p style={T.eyebrow}>{label}</p>
          <p
            className="stat-value"
            style={{
              fontSize: 36,
              fontWeight: 600,
              letterSpacing: "-0.024em",
              lineHeight: 1.0,
              marginTop: 10,
              color: isPositive
                ? "var(--color-text-primary)"
                : "var(--color-text-tertiary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {count}
          </p>
          <p style={{ ...T.bodyDim, fontSize: 12, marginTop: 8 }}>
            {isPositive ? actionLabel : zeroLabel}
          </p>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-text-tertiary)"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ marginTop: 4, flexShrink: 0 }}
        >
          <path d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Card>
  );
}

/* ─── Sparkline tile ─── */

function SparklineTile({
  label,
  current,
  currentSuffix,
  points,
  mode,
  color,
  inverseDelta = false,
  deltaSuffix = "",
}: {
  label: string;
  current: number;
  currentSuffix?: string;
  points: number[];
  mode: "running" | "flow";
  color: string;
  /** When true, an upward delta is "bad" (e.g. churn). */
  inverseDelta?: boolean;
  /** Optional suffix appended to the delta number ("%" for avg progress). */
  deltaSuffix?: string;
}) {
  const last = points[points.length - 1];
  const first = points[0];
  const delta =
    mode === "running" && first != null && last != null
      ? Math.round((last - first) * 10) / 10
      : null;
  const goodColor = "var(--color-success)";
  const badColor = "var(--color-danger)";
  return (
    <Link
      href="/admin/insights/progress"
      className="surface-resting transition-colors"
      style={{
        background: "var(--color-bg-card)",
        borderRadius: 10,
        padding: "14px 16px",
        textDecoration: "none",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        cursor: "pointer",
      }}
    >
      <p style={T.eyebrow}>{label}</p>
      <div className="flex items-baseline justify-between gap-3">
        <p
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.022em",
            lineHeight: 1.05,
          }}
        >
          {current}
          {currentSuffix ?? ""}
        </p>
        <SparklineSVG points={points} mode={mode} color={color} />
      </div>
      {delta !== null && (
        <p
          style={{
            fontSize: 11,
            color:
              delta > 0
                ? inverseDelta
                  ? badColor
                  : goodColor
                : delta < 0
                  ? inverseDelta
                    ? goodColor
                    : badColor
                  : "var(--color-text-tertiary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {delta > 0 ? "↑ " : delta < 0 ? "↓ " : "→ "}
          {Math.abs(delta)}
          {deltaSuffix} vs 14d ago
        </p>
      )}
    </Link>
  );
}

function SparklineSVG({
  points,
  mode,
  color,
}: {
  points: number[];
  mode: "running" | "flow";
  color: string;
}) {
  const W = 88;
  const H = 28;
  const PAD = 2;
  if (points.length < 2) {
    return (
      <span
        style={{
          fontSize: 10,
          color: "var(--color-text-tertiary)",
          fontStyle: "italic",
        }}
      >
        no data yet
      </span>
    );
  }
  const minY = Math.min(...points);
  const maxY = Math.max(...points);
  const range = Math.max(1, maxY - minY);
  const stepX = (W - PAD * 2) / Math.max(1, points.length - 1);
  const ys = points.map(
    (v) => H - PAD - ((v - minY) / range) * (H - PAD * 2),
  );

  if (mode === "flow") {
    const bw = Math.max(1, stepX * 0.7);
    const baseline = H - PAD;
    return (
      <svg width={W} height={H} aria-hidden="true">
        {points.map((v, i) => {
          const x = PAD + i * stepX;
          const yTop = ys[i];
          const h = Math.max(0, baseline - yTop);
          if (v === 0) return null;
          return (
            <rect
              key={i}
              x={x - bw / 2}
              y={yTop}
              width={bw}
              height={h}
              fill={color}
              opacity={0.7}
            />
          );
        })}
      </svg>
    );
  }

  const path = points
    .map((_, i) => `${i === 0 ? "M" : "L"} ${PAD + i * stepX} ${ys[i]}`)
    .join(" ");
  return (
    <svg width={W} height={H} aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ─── Refresh-everything button ─── */

/**
 * One button to rule them all. Runs the Whop community sync, then
 * rebuilds the snapshot trend table, then reloads dashboard data.
 * A failure in any one step is surfaced inline but doesn't block
 * the rest — so the dashboard still refreshes even if Whop is down.
 */
function RefreshEverything({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"ok" | "warn" | "err">("ok");

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    const auth = { Authorization: `Bearer ${token}` };

    const parts: string[] = [];
    let worst: "ok" | "warn" | "err" = "ok";

    setPhase("Syncing Whop…");
    try {
      const res = await fetch("/api/admin/sync-whop", {
        method: "POST",
        headers: auth,
      });
      const json = await res.json();
      if (!res.ok) {
        parts.push(`Whop: ${json.error ?? res.statusText}`);
        worst = "warn";
      } else {
        parts.push(`Whop +${json.inserted}/${json.updated} (${json.fetched})`);
      }
    } catch (e) {
      parts.push(`Whop: ${e instanceof Error ? e.message : String(e)}`);
      worst = "warn";
    }

    setPhase("Rebuilding trends…");
    try {
      const res = await fetch("/api/admin/rebuild-snapshots", {
        method: "POST",
        headers: auth,
      });
      const json = await res.json();
      if (!res.ok) {
        parts.push(`Trends: ${json.error ?? res.statusText}`);
        worst = "err";
      } else {
        parts.push(`Trends ${json.rows} rows`);
      }
    } catch (e) {
      parts.push(`Trends: ${e instanceof Error ? e.message : String(e)}`);
      worst = "err";
    }

    setPhase("Reloading…");
    onDone();

    setMsg(parts.join(" · "));
    setMsgTone(worst);
    setPhase(null);
    setBusy(false);
    setTimeout(() => setMsg(null), 10_000);
  };

  return (
    <>
      <Button
        variant="subtle"
        size="md"
        busy={busy}
        onClick={() => void run()}
        title="Re-pull Whop community, rebuild trend snapshots, reload data"
      >
        {busy ? phase ?? "Refreshing…" : "↻ Refresh"}
      </Button>
      {msg && (
        <span
          style={{
            fontSize: 11,
            color:
              msgTone === "err"
                ? "var(--color-danger)"
                : msgTone === "warn"
                  ? "var(--color-warning)"
                  : "var(--color-text-tertiary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {msg}
        </span>
      )}
    </>
  );
}
