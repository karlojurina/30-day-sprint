"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Student } from "@/types/database";
import {
  TOTAL_LESSONS,
  progressPercent,
  ADMIN_STUDENT_JOIN_CUTOFF,
} from "@/lib/constants";
import Link from "next/link";

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
  /** Last 14 days of nightly snapshots (oldest first) — feeds the sparkline tiles. */
  trend: MetricPoint[];
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const supabase = createClient();

  const fetchDashboard = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);

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
      ] = await Promise.all([
        supabase
          .from("students")
          .select("*")
          .not("whop_membership_id", "is", null)
          .in("membership_status", ["active", "past_due", "canceled"])
          .gte("joined_at", ADMIN_STUDENT_JOIN_CUTOFF),
        // completed_at filter so skipped / action-only rows don't
        // inflate the avg-progress denominator.
        supabase
          .from("student_lesson_completions")
          .select("student_id")
          .not("completed_at", "is", null),
        supabase.from("lessons").select("id", { count: "exact", head: true }),
        supabase.from("discount_requests").select("id").eq("status", "pending"),
        supabase.from("tasks").select("id").eq("status", "open"),
        supabase
          .from("daily_progress_snapshots")
          .select(
            "snapshot_date, avg_progress, active_count, joined_count, churned_count",
          )
          .gte("snapshot_date", fourteenDaysAgo)
          .order("snapshot_date", { ascending: true }),
      ]);

      const students = (studentsRes.data || []) as Student[];
      const completions = completionsRes.data || [];
      const totalLessons =
        typeof lessonsRes.count === "number" && lessonsRes.count > 0
          ? lessonsRes.count
          : TOTAL_LESSONS;

      const completionMap: Record<string, number> = {};
      for (const c of completions) {
        completionMap[c.student_id] = (completionMap[c.student_id] || 0) + 1;
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

      setData({
        totalStudents: students.length,
        activeStudents: activeStudents.length,
        joinedThisWeek,
        avgProgress,
        canceledThisMonth,
        pendingDiscounts: discountsRes.data?.length || 0,
        openTasks: tasksRes.data?.length || 0,
        monthTwoConversionRate,
        monthTwoCohortSize: matureCohort.length,
        trend,
      });

      setLastRefreshed(new Date());
      setLoading(false);
      setRefreshing(false);
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
            width: 24,
            height: 24,
            border: "2px solid var(--color-accent)",
            borderTopColor: "transparent",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="px-12 pt-12 pb-16"
      style={{ maxWidth: 1180, margin: "0 auto" }}
    >
      {/* Page header */}
      <header
        className="flex items-start justify-between gap-4 flex-wrap"
        style={{ marginBottom: 48 }}
      >
        <div>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: "-0.025em",
              color: "var(--color-text-primary)",
              lineHeight: 1.15,
            }}
          >
            Dashboard
          </h1>
          <p
            style={{
              fontSize: 15,
              color: "var(--color-text-secondary)",
              marginTop: 4,
              letterSpacing: "-0.006em",
            }}
          >
            The numbers that matter for the next month.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span
              style={{
                fontSize: 11,
                color: "var(--color-text-tertiary)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              Updated {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={() => void fetchDashboard(true)}
            disabled={refreshing}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 8,
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
              cursor: refreshing ? "wait" : "pointer",
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
      </header>

      {/* Hero KPIs — the two we steer on */}
      <section
        className="grid grid-cols-1 md:grid-cols-2"
        style={{ gap: 16, marginBottom: 48 }}
      >
        <BigStat
          label="Month 2 conversion"
          value={
            data.monthTwoConversionRate == null
              ? "—"
              : `${Math.round(data.monthTwoConversionRate * 100)}%`
          }
          sublabel={
            data.monthTwoConversionRate == null
              ? "No platform cohort past 30 days yet"
              : `${Math.round(
                  (data.monthTwoConversionRate ?? 0) * data.monthTwoCohortSize
                )} of ${data.monthTwoCohortSize} platform signups past day 30 still active. Whop-wide churn not yet counted.`
          }
          accent
        />
        <BigStat
          label="AdValue onboarded"
          value="—"
          sublabel="Pending integration with Zak"
        />
      </section>

      {/* Supporting stats — four sparkline tiles. Click any → Insights. */}
      <section style={{ marginBottom: 48 }}>
        <p className="section-label" style={{ marginBottom: 12 }}>
          Trends · last 14 days
        </p>
        <div
          className="grid grid-cols-2 lg:grid-cols-4"
          style={{ gap: 12 }}
        >
          <SparklineTile
            label="Active on platform"
            current={data.activeStudents}
            metric="active_count"
            mode="running"
            trend={data.trend}
            color="#5bb88e"
          />
          <SparklineTile
            label="Joined"
            current={data.trend.reduce((s, p) => s + p.joined_count, 0)}
            currentSuffix=" / 14d"
            metric="joined_count"
            mode="flow"
            trend={data.trend}
            color="#7d8be8"
          />
          <SparklineTile
            label="Churned"
            current={data.trend.reduce((s, p) => s + p.churned_count, 0)}
            currentSuffix=" / 14d"
            metric="churned_count"
            mode="flow"
            trend={data.trend}
            color="var(--color-danger)"
          />
          <SparklineTile
            label="Avg progress"
            current={data.avgProgress}
            currentSuffix="%"
            metric="avg_progress"
            mode="running"
            trend={data.trend}
            color="var(--color-accent-dark)"
          />
        </div>
      </section>

      {/* Quick links — Settings-style list */}
      <section style={{ marginBottom: 48 }}>
        <p className="section-label" style={{ marginBottom: 12 }}>
          Quick actions
        </p>
        <div
          className="surface-resting"
          style={{
            background: "var(--color-bg-card)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <ListLink
            href="/admin/tasks"
            label="Open task queue"
            sublabel={
              data.openTasks > 0
                ? `${data.openTasks} waiting in To do`
                : "All caught up"
            }
            badge={data.openTasks > 0 ? data.openTasks : undefined}
            badgeTone="warm"
          />
          <ListLink
            href="/admin/discounts"
            label="Pending discounts"
            sublabel={`${data.pendingDiscounts} to review`}
            badge={data.pendingDiscounts > 0 ? data.pendingDiscounts : undefined}
            badgeTone="warm"
          />
        </div>
      </section>
    </div>
  );
}

function BigStat({
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
  // apple.com hero stat: tracked lowercase eyebrow + display-tier numeral
  // + sentence-case secondary line. No uppercase on the eyebrow — Apple
  // doesn't yell at you to read it.
  return (
    <div
      className="surface-resting"
      style={{
        background: "var(--color-bg-card)",
        borderRadius: 16,
        padding: 32,
      }}
    >
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
          fontSize: 64,
          fontWeight: 600,
          lineHeight: 1.0,
          letterSpacing: "-0.028em",
          color: accent
            ? "var(--color-accent-dark)"
            : "var(--color-text-primary)",
          marginTop: 16,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </p>
      <p
        style={{
          fontSize: 14,
          color: "var(--color-text-secondary)",
          marginTop: 16,
          letterSpacing: "-0.006em",
          lineHeight: 1.4,
        }}
      >
        {sublabel}
      </p>
    </div>
  );
}

function SmallStat({
  label,
  value,
  accent,
  sublabel,
}: {
  label: string;
  value: string | number;
  accent?: "success" | "danger";
  sublabel?: string;
}) {
  const color =
    accent === "success"
      ? "var(--color-success)"
      : accent === "danger"
        ? "var(--color-danger)"
        : "var(--color-text-primary)";
  return (
    <div
      className="surface-resting"
      style={{
        background: "var(--color-bg-card)",
        borderRadius: 12,
        padding: 20,
      }}
    >
      <p
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--color-text-tertiary)",
          letterSpacing: "-0.005em",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 30,
          fontWeight: 600,
          color,
          marginTop: 8,
          letterSpacing: "-0.024em",
          lineHeight: 1.0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </p>
      {sublabel && (
        <p
          style={{
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            marginTop: 6,
          }}
        >
          {sublabel}
        </p>
      )}
    </div>
  );
}

function ListLink({
  href,
  label,
  sublabel,
  badge,
  badgeTone = "neutral",
}: {
  href: string;
  label: string;
  sublabel: string;
  badge?: number;
  badgeTone?: "neutral" | "warm" | "danger";
}) {
  const badgeColor =
    badgeTone === "warm"
      ? "var(--color-warning)"
      : badgeTone === "danger"
        ? "var(--color-danger)"
        : "var(--color-text-tertiary)";
  return (
    <Link
      href={href}
      className="list-row"
      style={{ textDecoration: "none" }}
    >
      <div className="flex-1">
        <p
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.011em",
          }}
        >
          {label}
        </p>
        <p
          style={{
            fontSize: 12,
            color: "var(--color-text-secondary)",
            marginTop: 1,
          }}
        >
          {sublabel}
        </p>
      </div>
      {badge !== undefined && (
        <span
          style={{
            minWidth: 22,
            height: 22,
            padding: "0 8px",
            borderRadius: 11,
            background: `${badgeColor}1f`,
            color: badgeColor,
            fontSize: 12,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontVariantNumeric: "tabular-nums",
            marginRight: 8,
          }}
        >
          {badge}
        </span>
      )}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-text-tertiary)"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

/**
 * Sparkline tile shown on the dashboard for each daily-snapshot
 * metric. Clicks through to /admin/insights/progress.
 *
 *   metric    — column key in MetricPoint to chart
 *   mode      — "running" draws a line (good for active count / avg %);
 *               "flow"    draws bars (good for joined/churned per day)
 *   current   — big number shown on the left
 *   color     — stroke / bar color
 */
function SparklineTile({
  label,
  current,
  currentSuffix,
  metric,
  mode,
  trend,
  color,
}: {
  label: string;
  current: number;
  currentSuffix?: string;
  metric: "avg_progress" | "active_count" | "joined_count" | "churned_count";
  mode: "running" | "flow";
  trend: MetricPoint[];
  color: string;
}) {
  const points = trend.map((p) => p[metric] as number);
  const last = points[points.length - 1];
  const first = points[0];
  const delta =
    mode === "running" && first != null && last != null
      ? Math.round((last - first) * 10) / 10
      : null;
  return (
    <Link
      href="/admin/insights/progress"
      className="surface-resting transition-colors"
      style={{
        background: "var(--color-bg-card)",
        borderRadius: 10,
        padding: "12px 16px",
        textDecoration: "none",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        cursor: "pointer",
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "var(--color-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </p>
      <div className="flex items-baseline justify-between gap-3">
        <p
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.018em",
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
                ? metric === "churned_count"
                  ? "var(--color-danger)"
                  : "var(--color-success)"
                : delta < 0
                  ? metric === "churned_count"
                    ? "var(--color-success)"
                    : "var(--color-danger)"
                  : "var(--color-text-tertiary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {delta > 0 ? "↑ " : delta < 0 ? "↓ " : "→ "}
          {Math.abs(delta)}
          {metric === "avg_progress" ? "%" : ""} vs 14d ago
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
    // Bar mode for joined/churned per day. Baseline = bottom of svg.
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

  // Running mode = line
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

