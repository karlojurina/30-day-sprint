"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Student, DisengagementAlert } from "@/types/database";
import { getDayNumber } from "@/types/database";
import { TOTAL_LESSONS, progressPercent } from "@/lib/constants";
import Link from "next/link";

interface DashboardData {
  totalStudents: number;
  activeStudents: number;
  joinedThisWeek: number;
  avgProgress: number;
  canceledThisMonth: number;
  pendingDiscounts: number;
  activeAlerts: number;
  // The KPI Karlo cares about most: of students who joined more than
  // 30 days ago, what fraction are still active?
  monthTwoConversionRate: number | null;
  monthTwoCohortSize: number;
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [recentAlerts, setRecentAlerts] = useState<
    (DisengagementAlert & { student: Student })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function fetchDashboard() {
      const now = Date.now();
      const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
      const thirtyDaysAgo = new Date(now - 30 * 86_400_000).toISOString();

      const [
        studentsRes,
        completionsRes,
        lessonsRes,
        discountsRes,
        alertsRes,
        recentAlertsRes,
      ] = await Promise.all([
        // Filter to actual paying students — see /admin/students for rationale.
        supabase
          .from("students")
          .select("*")
          .not("whop_membership_id", "is", null)
          .in("membership_status", ["active", "past_due", "canceled"]),
        supabase.from("student_lesson_completions").select("student_id"),
        supabase.from("lessons").select("id", { count: "exact", head: true }),
        supabase.from("discount_requests").select("id").eq("status", "pending"),
        supabase
          .from("disengagement_alerts")
          .select("id")
          .eq("is_dismissed", false),
        supabase
          .from("disengagement_alerts")
          .select("*, student:students(*)")
          .eq("is_dismissed", false)
          .order("created_at", { ascending: false })
          .limit(5),
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
        (s) => s.membership_status === "active"
      );
      const joinedThisWeek = students.filter(
        (s) => s.joined_at >= weekAgo
      ).length;
      const canceledThisMonth = students.filter(
        (s) =>
          s.membership_status === "canceled" && s.updated_at >= thirtyDaysAgo
      ).length;

      const avgProgress =
        activeStudents.length > 0
          ? Math.round(
              activeStudents.reduce(
                (sum, s) =>
                  sum +
                  progressPercent(completionMap[s.id] || 0, totalLessons),
                0
              ) / activeStudents.length
            )
          : 0;

      // Month-2 conversion: of the students whose joined_at is older
      // than 30 days, what fraction are still 'active'? Single most
      // important retention number.
      const matureCohort = students.filter(
        (s) => s.joined_at <= thirtyDaysAgo
      );
      const matureActive = matureCohort.filter(
        (s) => s.membership_status === "active"
      ).length;
      const monthTwoConversionRate =
        matureCohort.length > 0 ? matureActive / matureCohort.length : null;

      setData({
        totalStudents: students.length,
        activeStudents: activeStudents.length,
        joinedThisWeek,
        avgProgress,
        canceledThisMonth,
        pendingDiscounts: discountsRes.data?.length || 0,
        activeAlerts: alertsRes.data?.length || 0,
        monthTwoConversionRate,
        monthTwoCohortSize: matureCohort.length,
      });

      setRecentAlerts(
        (recentAlertsRes.data as (DisengagementAlert & { student: Student })[]) ||
          []
      );
      setLoading(false);
    }

    fetchDashboard();
  }, [supabase]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-8 pt-8 pb-12 space-y-10 max-w-7xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-text-secondary mt-1">
          The numbers that matter for the next month.
        </p>
      </div>

      {/* Hero KPI row — the two we actually steer on */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BigStat
          label="Month 2 conversion"
          value={
            data.monthTwoConversionRate == null
              ? "—"
              : `${Math.round(data.monthTwoConversionRate * 100)}%`
          }
          sublabel={
            data.monthTwoConversionRate == null
              ? "No cohort past 30 days yet"
              : `${Math.round(
                  (data.monthTwoConversionRate ?? 0) * data.monthTwoCohortSize
                )} of ${data.monthTwoCohortSize} active`
          }
          accent="gold"
        />
        <BigStat
          label="AdValue onboarded"
          value="—"
          sublabel="Pending integration with Zak"
          accent="muted"
        />
      </div>

      {/* Supporting KPIs */}
      <div>
        <p className="text-xs font-mono uppercase tracking-widest text-text-secondary mb-3">
          This week
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SmallStat label="Active students" value={data.activeStudents} />
          <SmallStat label="Joined" value={data.joinedThisWeek} accent="success" />
          <SmallStat label="Avg progress" value={`${data.avgProgress}%`} />
          <SmallStat
            label="Churned 30d"
            value={data.canceledThisMonth}
            accent="danger"
          />
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <QuickLink
          href="/admin/kanban"
          label="Open Kanban"
          sublabel="Sweep students by cohort"
        />
        <QuickLink
          href="/admin/discounts"
          label="Pending discounts"
          sublabel={`${data.pendingDiscounts} to review`}
          highlight={data.pendingDiscounts > 0 ? "warm" : "none"}
        />
        <QuickLink
          href="/admin/alerts"
          label="Active alerts"
          sublabel={`${data.activeAlerts} unaddressed`}
          highlight={data.activeAlerts > 0 ? "danger" : "none"}
        />
      </div>

      {/* Recent alerts */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Recent alerts</h2>
          <Link
            href="/admin/alerts"
            className="text-xs text-accent-light hover:text-accent transition-colors"
          >
            View all →
          </Link>
        </div>
        {recentAlerts.length === 0 ? (
          <p className="text-sm text-text-secondary bg-bg-card border border-border rounded-xl p-6">
            No active alerts. All students are on track.
          </p>
        ) : (
          <div className="space-y-2">
            {recentAlerts.map((alert) => (
              <Link
                key={alert.id}
                href={`/admin/students/${alert.student_id}`}
                className="bg-bg-card border border-border rounded-lg p-3 flex items-center justify-between hover:border-accent/40 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium">
                    {alert.student?.name || "Unknown"}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {alert.message}
                  </p>
                </div>
                <span className="text-xs text-text-tertiary font-mono">
                  Day{" "}
                  {alert.student
                    ? getDayNumber(alert.student.joined_at)
                    : "?"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BigStat({
  label,
  value,
  sublabel,
  accent,
}: {
  label: string;
  value: string;
  sublabel: string;
  accent: "gold" | "muted";
}) {
  return (
    <div
      className="bg-bg-card border rounded-2xl p-6"
      style={{
        borderColor:
          accent === "gold"
            ? "rgba(230,192,122,0.32)"
            : "var(--color-border)",
      }}
    >
      <p
        className="font-mono uppercase mb-2"
        style={{
          color:
            accent === "gold"
              ? "var(--color-gold)"
              : "var(--color-ink-dim)",
          letterSpacing: "0.16em",
          fontSize: 11,
        }}
      >
        {label}
      </p>
      <p
        className="font-semibold tabular-nums tracking-tight"
        style={{
          fontSize: 56,
          lineHeight: 1,
          color:
            accent === "gold"
              ? "var(--color-gold-light)"
              : "var(--color-ink-faint)",
        }}
      >
        {value}
      </p>
      <p className="text-xs text-text-tertiary mt-3">{sublabel}</p>
    </div>
  );
}

function SmallStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: "success" | "danger";
}) {
  const color =
    accent === "success"
      ? "var(--color-success)"
      : accent === "danger"
        ? "var(--color-danger)"
        : "var(--color-ink)";
  return (
    <div className="bg-bg-card border border-border rounded-xl p-4">
      <p className="text-[11px] text-text-tertiary font-mono uppercase tracking-widest">
        {label}
      </p>
      <p
        className="font-semibold tabular-nums mt-1"
        style={{ fontSize: 26, color, lineHeight: 1.05 }}
      >
        {value}
      </p>
    </div>
  );
}

function QuickLink({
  href,
  label,
  sublabel,
  highlight = "none",
}: {
  href: string;
  label: string;
  sublabel: string;
  highlight?: "none" | "warm" | "danger";
}) {
  const borderColor =
    highlight === "warm"
      ? "rgba(230,192,122,0.4)"
      : highlight === "danger"
        ? "rgba(196,74,84,0.45)"
        : "var(--color-border)";
  return (
    <Link
      href={href}
      className="bg-bg-card border rounded-xl p-4 hover:border-accent/40 transition-colors flex items-center justify-between"
      style={{ borderColor }}
    >
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-text-secondary mt-0.5">{sublabel}</p>
      </div>
      <svg
        className="w-4 h-4 text-text-tertiary"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.6}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}
