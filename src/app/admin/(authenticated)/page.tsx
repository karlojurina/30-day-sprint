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
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import type { Student } from "@/types/database";
import {
  TOTAL_LESSONS,
  progressPercent,
  ADMIN_STUDENT_JOIN_CUTOFF,
  TASKS_STUDENT_JOIN_CUTOFF,
} from "@/lib/constants";
import {
  isPayingMember,
  isMonth2Converted,
  isInMonth2Cohort,
  PAYING_WHOP_PLAN_IDS_ARRAY,
} from "@/lib/admin/metrics-definitions";
import { useAdminScope } from "@/contexts/AdminScopeContext";
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
  /** Per-day month-2 conversion rate (0-100) for the last 14 days,
   *  oldest first. Reconstructed from students.joined_at +
   *  membership_status + updated_at, so it's an approximation but
   *  curves on real numbers. */
  monthTwoTrend: number[];
  /** All-time # of students who have joined the Bounty Program. */
  bountyAccessAllTime: number;
  /** # of bounty enrollments in the last 14 days (the hero number). */
  bountyAccessLast14d: number;
  /** Per-day bounty enrollments, last 14 days oldest first. */
  bountyTrend: number[];
  /** Last 14 days of nightly snapshots (oldest first) — feeds the sparkline tiles. */
  trend: MetricPoint[];
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const supabase = createClient();
  const { scope } = useAdminScope();

  const fetchDashboard = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);

      const now = Date.now();
      const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
      const thirtyDaysAgo = new Date(now - 30 * 86_400_000).toISOString();

      const fourteenDaysAgo = new Date(now - 14 * 86_400_000)
        .toISOString()
        .slice(0, 10);

      // Scope toggle: 'cohort' applies the launch-date filter so we
      // exclude legacy / pre-launch students from every count on
      // this page. 'all' drops it so the team sees everyone.
      // v79: PAYING_WHOP_PLAN_IDS filter excludes free-plan users
      // from every operational surface, regardless of scope.
      //
      // v75.27: wrapped in a thunk + fetchAllRowsPaginated to bypass
      // PostgREST's ~1000-row server cap. With 750+ paying members
      // (and growing), the unwrapped query silently truncated and
      // the "Active on platform" tile was pinned at ≤1000. Same
      // shape as the milicevic bug (v75.25) but on a different table.
      const buildStudentsQuery = () => {
        let q = supabase
          .from("students")
          .select("*")
          .not("whop_membership_id", "is", null)
          .in("membership_status", ["active", "past_due", "canceled"])
          .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[]);
        if (scope === "cohort") {
          // v75.18: filter by first_paid_at (original Whop signup),
          // NOT joined_at (current cycle start). Returning customers
          // who re-subscribed post-launch have a recent joined_at but
          // their first_paid_at is pre-launch → correctly excluded.
          q = q.gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF);
        }
        return q;
      };

      const [
        studentsRes,
        completionsRes,
        lessonsRes,
        discountsRes,
        tasksRes,
        snapshotsRes,
        milestonesRes,
      ] = await Promise.all([
        fetchAllRowsPaginated<Student>(buildStudentsQuery),
        // Per-student counts via a pre-aggregated view. Querying
        // student_lesson_completions directly truncates at the
        // 1000-row PostgREST cap once the community is large.
        // v75.27: even the VIEW hits the same cap — paginate.
        fetchAllRowsPaginated<{ student_id: string; completed_count: number }>(
          () =>
            supabase
              .from("student_progress_counts")
              .select("student_id, completed_count"),
        ),
        // v75.1 - excludes l057 (bounty onboarding) so the avg-progress
        // denominator matches the 64-lesson sprint.
        supabase
          .from("lessons")
          .select("id", { count: "exact", head: true })
          .neq("id", "l057"),
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
          // v75.18: filter on first_paid_at (original signup).
          .gte("student.first_paid_at", TASKS_STUDENT_JOIN_CUTOFF),
        // Fetch both column families so the sparkline can flip
        // instantly when scope toggles, without refetching.
        supabase
          .from("daily_progress_snapshots")
          .select(
            "snapshot_date, avg_progress, active_count, joined_count, churned_count, avg_progress_cohort, active_count_cohort, joined_count_cohort, churned_count_cohort",
          )
          .gte("snapshot_date", fourteenDaysAgo)
          .order("snapshot_date", { ascending: true }),
        // Bounty count - feeds the "Bounty Program · joined" hero stat.
        supabase
          .from("student_milestones")
          .select("student_id, bounty_access_claimed_at"),
      ]);

      // v75.32: surface pagination errors. Helper returns empty data
      // on error (v75.32 change), so an empty list signals a problem.
      // Log + show a console-visible warning rather than silently
      // rendering missing rows as if everything was fine.
      if (studentsRes.error) {
        console.error("[admin/dashboard] students fetch failed:", studentsRes.error);
      }
      if (completionsRes.error) {
        console.error("[admin/dashboard] progress counts fetch failed:", completionsRes.error);
      }

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

      // "Active" = active + past_due on a PAYING plan (Whop's grace
      // window keeps past-due users on the platform; they're still
      // paying members). isPayingMember combines both checks.
      const activeStudents = students.filter(isPayingMember);
      const joinedThisWeek = students.filter(
        (s) => s.joined_at >= weekAgo,
      ).length;
      // v75.36: switch from the broken updated_at proxy to canceled_at.
      // updated_at fires on every sync, so "canceled AND updated_at
      // >= 30d ago" was matching every legacy canceled student on every
      // run — the canceledThisMonth count was monotonically increasing.
      // The snapshot cron and v81 RPC both correctly use canceled_at
      // (v75.13 + v77 fix); this was the last surface still using the
      // updated_at hack.
      const canceledThisMonth = students.filter(
        (s) =>
          s.membership_status === "canceled" &&
          s.canceled_at !== null &&
          s.canceled_at >= thirtyDaysAgo,
      ).length;

      // v75.28: avgProgress now uses the SAME formula as the snapshot
      // cron and the rebuild_daily_snapshots RPC (v81 migration):
      // Σ completions / (active × total_lessons) × 100. Previously
      // computed mean-of-rounded-per-student-percentages which gave a
      // 0-2pt jitter vs the snapshot row. With this fix, hitting
      // Refresh truly doesn't change the dashboard's number.
      const totalCompletions = activeStudents.reduce(
        (sum, s) => sum + (completionMap[s.id] || 0),
        0,
      );
      const avgProgress =
        activeStudents.length > 0 && totalLessons > 0
          ? Math.round(
              (totalCompletions / (activeStudents.length * totalLessons)) *
                100,
            )
          : 0;

      // v75.38: Month-2 conversion now flows through ONE canonical
      // helper (isMonth2Converted + isInMonth2Cohort) in metrics-
      // definitions.ts. Same formula here, same formula in the trend
      // loop below — the hero stat and the sparkline's last point
      // can no longer drift apart. The matureCohort/matureActive
      // names are kept for the data payload field but the underlying
      // computation is now centralized.
      const matureCohort = students.filter(isInMonth2Cohort);
      const matureActive = students.filter((s) => isMonth2Converted(s)).length;
      const monthTwoConversionRate =
        matureCohort.length > 0 ? matureActive / matureCohort.length : null;

      // Reconstruct per-day month-2 conversion rate for the last 14
      // days. For each day D, use the canonical helper as-of D's end-
      // of-day (midnight UTC the following day) so a student who
      // crossed day 30 mid-day still counts at the right snapshot.
      const todayMidnight =
        Math.floor(Date.now() / 86_400_000) * 86_400_000;
      const monthTwoTrend: number[] = [];
      const fourteenDaysAgoMs = todayMidnight - 13 * 86_400_000;
      for (let i = 0; i < 14; i++) {
        const dayStart = fourteenDaysAgoMs + i * 86_400_000;
        const dayEnd = dayStart + 86_400_000;
        const cohortAtDay = students.filter((s) =>
          isInMonth2Cohort(s, dayEnd),
        );
        const convertedAtDay = students.filter((s) =>
          isMonth2Converted(s, dayEnd),
        ).length;
        monthTwoTrend.push(
          cohortAtDay.length > 0
            ? Math.round((convertedAtDay / cohortAtDay.length) * 100)
            : 0,
        );
      }

      // Pick the column family that matches the active scope. Cohort
      // columns may be null on legacy snapshot rows that haven't been
      // rebuilt yet — fall back to the "all" columns so the sparkline
      // doesn't blank out during the transition window.
      const pickScopedColumn = (
        r: Record<string, unknown>,
        cohortCol: string,
        allCol: string,
      ): number => {
        if (scope === "cohort" && r[cohortCol] != null) {
          return Number(r[cohortCol]);
        }
        return Number(r[allCol] ?? 0);
      };
      const trend = (snapshotsRes.data ?? []).map((r) => ({
        snapshot_date: (r as { snapshot_date: string }).snapshot_date,
        avg_progress: pickScopedColumn(
          r as Record<string, unknown>,
          "avg_progress_cohort",
          "avg_progress",
        ),
        active_count: pickScopedColumn(
          r as Record<string, unknown>,
          "active_count_cohort",
          "active_count",
        ),
        joined_count: pickScopedColumn(
          r as Record<string, unknown>,
          "joined_count_cohort",
          "joined_count",
        ),
        churned_count: pickScopedColumn(
          r as Record<string, unknown>,
          "churned_count_cohort",
          "churned_count",
        ),
      }));

      // Bounty count - "how many people joined the bounty program."
      //
      // v75.44: scope-aware. Previously this counted EVERY non-null
      // bounty_access_claimed_at across student_milestones, including:
      //   * Legacy customers (pre-launch) with bounty stamps from
      //     before the platform tracking went live
      //   * v50 migration-backfilled stamps (sprint_completed_at proxy)
      //     for test-cohort students — synthetic, not real bounty signups
      //   * Students whose plan dropped to non-paying after stamping
      //
      // None of those should count for "is the LAUNCH COHORT converting
      // to the bounty program?" — Karlo's second north-star KPI. Fix:
      // filter milestoneRows to only include students in `students`
      // (which is already scope-filtered + paying-plan-filtered).
      const studentIdSet = new Set(students.map((s) => s.id));
      const milestoneRowsAll = (milestonesRes.data ?? []) as Array<{
        student_id: string;
        bounty_access_claimed_at: string | null;
      }>;
      const milestoneRows = milestoneRowsAll.filter((m) =>
        studentIdSet.has(m.student_id),
      );
      const bountyAccessAllTime = milestoneRows.filter(
        (m) => m.bounty_access_claimed_at,
      ).length;

      // v74.2 - per-day bounty enrollments for the last 14 days
      // (oldest first). Feeds the hero-stat sparkline + the headline
      // number is now the 14d count, not the all-time total.
      const todayStartMs =
        Math.floor(Date.now() / 86_400_000) * 86_400_000;
      const bountyTrend: number[] = [];
      let bountyAccessLast14d = 0;
      for (let i = 13; i >= 0; i--) {
        const dayStart = todayStartMs - i * 86_400_000;
        const dayEnd = dayStart + 86_400_000;
        const count = milestoneRows.filter((m) => {
          if (!m.bounty_access_claimed_at) return false;
          const t = new Date(m.bounty_access_claimed_at).getTime();
          return t >= dayStart && t < dayEnd;
        }).length;
        bountyTrend.push(count);
        bountyAccessLast14d += count;
      }

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
        monthTwoTrend,
        bountyAccessAllTime,
        bountyAccessLast14d,
        bountyTrend,
        trend,
      });

      setLastRefreshed(new Date());
      setLoading(false);
    },
    [supabase, scope],
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
        meta={
          lastRefreshed
            ? `Updated ${lastRefreshed.toLocaleTimeString()}`
            : undefined
        }
        actions={
          <RefreshEverything onDone={() => void fetchDashboard(true)} />
        }
      />

      {/* ─── Hero: Month 2 conversion + Bounty Program ─── */}
      {/* v75.41: widened gap to give the hero row more breathing
          room from the secondary tiles below. */}
      <Section>
        <div
          className="grid grid-cols-1 md:grid-cols-2"
          style={{ gap: 24 }}
        >
          <HeroStat
            label="Month 2 conversion"
            value={
              data.monthTwoConversionRate == null
                ? "—"
                : `${Math.round(data.monthTwoConversionRate * 100)}%`
            }
            valueSuffix={
              data.monthTwoConversionRate == null
                ? undefined
                : `of ${data.monthTwoCohortSize} past day 30`
            }
            sublabel={
              data.monthTwoConversionRate == null
                ? "Waiting on the first month-2 cohort."
                : undefined
            }
            // v75.5 - real per-day trend, reconstructed from the
            // students table client-side. See fetchDashboard.
            // When there's no cohort yet pass an empty array so the
            // HeroSparkline hides instead of drawing a flat line at 0.
            trendPoints={
              data.monthTwoConversionRate == null
                ? []
                : data.monthTwoTrend
            }
            accent
          />
          <HeroStat
            label="Bounty Program · joined"
            value={String(data.bountyAccessLast14d)}
            valueSuffix={`/ 14d · ${data.bountyAccessAllTime} all-time`}
            trendPoints={data.bountyTrend}
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
      {/* v75.43: removed the "Joined" tile per Karlo: 'I don't think
          Joined is relevant for us, because we see that in the Whop
          dashboard.' Three tiles instead of four — grid stays at
          lg:grid-cols-4 so each tile gets more breathing room. */}
      <Section eyebrow="Trends · last 14 days">
        <div
          className="grid grid-cols-2 lg:grid-cols-3"
          style={{ gap: 12 }}
        >
          <SparklineTile
            label="Active on platform"
            current={data.activeStudents}
            points={data.trend.map((p) => p.active_count)}
            mode="running"
          />
          <SparklineTile
            label="Churned"
            current={data.trend.reduce((s, p) => s + p.churned_count, 0)}
            currentSuffix=" / 14d"
            points={data.trend.map((p) => p.churned_count)}
            mode="running"
            inverseDelta
          />
          <SparklineTile
            label="Avg progress"
            current={data.avgProgress}
            currentSuffix="%"
            points={data.trend.map((p) => p.avg_progress)}
            mode="running"
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
  trendPoints,
  valueSuffix,
  inverseDelta = false,
}: {
  label: string;
  value: string;
  /** Optional context line under the value. Omit to render none. */
  sublabel?: string;
  accent?: boolean;
  /** Optional 14d sparkline. Renders BELOW the value, full-width. */
  trendPoints?: number[];
  /** Small text appended next to the value (e.g. "/ 14d"). */
  valueSuffix?: string;
  /** When true, an upward delta is "bad" (e.g. churn). Affects the
   *  trend line + delta text color. */
  inverseDelta?: boolean;
}) {
  // v75.1 - derive the trend color from the delta direction so green/
  // red carries semantic meaning ("things are getting better/worse")
  // not just brand color. Sparkline + delta text use the same hue.
  const sparkColor = computeTrendColor(trendPoints, inverseDelta, accent);
  const delta = computeDelta(trendPoints);
  const hasTrend = trendPoints && trendPoints.length > 1;
  // v75.41: increased padding + value font-size to give the M2 +
  // Bounty hero stats real visual dominance over the secondary
  // trend tiles below. They're the platform's two north-star KPIs;
  // they should LOOK like it.
  return (
    <Card padding={36}>
      <p
        style={{
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "-0.005em",
          color: accent
            ? "var(--color-accent-dark)"
            : "var(--color-text-tertiary)",
          marginBottom: 16,
        }}
      >
        {label}
      </p>
      <div
        className="flex items-baseline"
        style={{ gap: 10, flexWrap: "wrap" }}
      >
        <p
          className="stat-value"
          style={{
            fontSize: 68,
            fontWeight: 600,
            lineHeight: 1.0,
            letterSpacing: "-0.030em",
            color: accent
              ? "var(--color-accent-dark)"
              : "var(--color-text-primary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </p>
        {valueSuffix && (
          <span
            style={{
              fontSize: 14,
              color: "var(--color-text-tertiary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {valueSuffix}
          </span>
        )}
        {delta !== null && hasTrend && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 12,
              fontWeight: 600,
              color: sparkColor,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.005em",
            }}
          >
            {delta > 0 ? "↑ " : delta < 0 ? "↓ " : "→ "}
            {Math.abs(delta)}
          </span>
        )}
      </div>
      <div style={{ marginTop: hasTrend ? 18 : 0 }}>
        {hasTrend && (
          <HeroSparkline
            points={trendPoints!}
            color={sparkColor}
            height={80}
          />
        )}
      </div>
      {sublabel && (
        <p
          style={{
            ...T.bodyDim,
            marginTop: 14,
            lineHeight: 1.4,
          }}
        >
          {sublabel}
        </p>
      )}
    </Card>
  );
}

function HeroSparkline({
  points,
  color,
  height = 64,
}: {
  points: number[];
  color: string;
  height?: number;
}) {
  const W = 600;
  const H = height;
  const PAD = 4;
  const max = Math.max(1, ...points);
  const stepX = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const coords = points.map((v, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (1 - v / max) * (H - PAD * 2);
    return { x, y };
  });
  const line = coords
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
  const area =
    coords.length > 0
      ? `${line} L ${coords[coords.length - 1].x.toFixed(2)} ${H - PAD} L ${coords[0].x.toFixed(2)} ${H - PAD} Z`
      : "";
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ width: "100%", height, display: "block" }}
    >
      <defs>
        <linearGradient id={`hero-spark-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={area} fill={`url(#hero-spark-${color})`} stroke="none" />}
      {line && (
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

/** Returns the running delta (last - first) for a sparkline series,
 *  rounded to 1 decimal place. Null if the series is empty. */
function computeDelta(points: number[] | undefined): number | null {
  if (!points || points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (first == null || last == null) return null;
  return Math.round((last - first) * 10) / 10;
}

/** Returns the trend color for a sparkline given the delta + the
 *  inverseDelta flag. Green = "things are getting better"; red =
 *  worse; tertiary = flat or no signal. */
function computeTrendColor(
  points: number[] | undefined,
  inverseDelta: boolean,
  accent: boolean,
): string {
  const delta = computeDelta(points);
  if (delta == null || delta === 0) {
    return accent
      ? "var(--color-accent-dark)"
      : "var(--color-text-secondary)";
  }
  const good = "var(--color-success)";
  const bad = "var(--color-danger)";
  if (delta > 0) return inverseDelta ? bad : good;
  return inverseDelta ? good : bad;
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
  inverseDelta = false,
  deltaSuffix = "",
}: {
  label: string;
  current: number;
  currentSuffix?: string;
  points: number[];
  mode: "running" | "flow";
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
  // v75.1 - line color + delta text both derive from delta sign +
  // inverseDelta. Was a static prop which made e.g. Churned always
  // red even when churn was dropping (which is a *good* signal).
  const sparkColor = computeTrendColor(points, inverseDelta, false);
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
        <SparklineSVG points={points} mode={mode} color={sparkColor} />
      </div>
      {delta !== null && (
        <p
          style={{
            fontSize: 11,
            color: sparkColor,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {delta > 0 ? "↑ " : delta < 0 ? "↓ " : "→ "}
          {Math.abs(delta)}
          {deltaSuffix}
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

    // v75.22: one call does it all — sync Whop, rebuild snapshots,
    // re-run all three CSM crons (auto-dismiss + create). Takes
    // ~100-130s.
    setPhase("Syncing Whop + refreshing tasks…");
    try {
      const res = await fetch("/api/admin/refresh-everything", {
        method: "POST",
        headers: auth,
      });
      const json = await res.json();
      if (!res.ok) {
        parts.push(`Refresh: ${json.error ?? res.statusText}`);
        worst = "err";
      } else {
        const sync = json.sync;
        if (sync && typeof sync === "object" && "fetched" in sync) {
          parts.push(`Whop +${sync.inserted ?? 0}/${sync.updated ?? 0} (${sync.fetched ?? 0})`);
        }
        if (json.rebuild?.ok) parts.push("Snapshots rebuilt");
        const csm = json.csm_tasks;
        if (csm && typeof csm === "object" && "tasks_created" in csm) {
          parts.push(`+${csm.tasks_created} tasks`);
        }
        const eng = json.engagement;
        if (eng && typeof eng === "object" && "alerts" in eng) {
          parts.push(`${eng.alerts} alerts`);
        }
      }
    } catch (e) {
      parts.push(`Refresh: ${e instanceof Error ? e.message : String(e)}`);
      worst = "err";
    }

    setPhase("Reloading…");
    onDone();

    setMsg(parts.join(" · "));
    setMsgTone(worst);
    setPhase(null);
    setBusy(false);
    setTimeout(() => setMsg(null), 12_000);
  };

  return (
    <>
      <Button
        variant="subtle"
        size="md"
        busy={busy}
        onClick={() => void run()}
        title="Sync Whop, rebuild snapshots, re-evaluate all CSM tasks (auto-dismiss stale + create new). ~2 min."
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
