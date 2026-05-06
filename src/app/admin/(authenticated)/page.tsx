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
      <header style={{ marginBottom: 48 }}>
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
              ? "No cohort past 30 days yet"
              : `${Math.round(
                  (data.monthTwoConversionRate ?? 0) * data.monthTwoCohortSize
                )} of ${data.monthTwoCohortSize} active`
          }
          accent
        />
        <BigStat
          label="AdValue onboarded"
          value="—"
          sublabel="Pending integration with Zak"
        />
      </section>

      {/* Supporting stats */}
      <section style={{ marginBottom: 48 }}>
        <p className="section-label" style={{ marginBottom: 12 }}>
          This week
        </p>
        <div
          className="grid grid-cols-2 lg:grid-cols-4"
          style={{ gap: 12 }}
        >
          <SmallStat label="Active students" value={data.activeStudents} />
          <SmallStat
            label="Joined"
            value={data.joinedThisWeek}
            accent="success"
          />
          <SmallStat label="Avg progress" value={`${data.avgProgress}%`} />
          <SmallStat
            label="Churned 30d"
            value={data.canceledThisMonth}
            accent="danger"
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
            href="/admin/kanban"
            label="Open Kanban"
            sublabel="Sweep students by cohort"
          />
          <ListLink
            href="/admin/discounts"
            label="Pending discounts"
            sublabel={`${data.pendingDiscounts} to review`}
            badge={data.pendingDiscounts > 0 ? data.pendingDiscounts : undefined}
            badgeTone="warm"
          />
          <ListLink
            href="/admin/alerts"
            label="Active alerts"
            sublabel={`${data.activeAlerts} unaddressed`}
            badge={data.activeAlerts > 0 ? data.activeAlerts : undefined}
            badgeTone="danger"
          />
        </div>
      </section>

      {/* Recent alerts — same Settings list pattern */}
      <section>
        <div
          className="flex items-baseline justify-between"
          style={{ marginBottom: 12 }}
        >
          <p className="section-label">Recent alerts</p>
          <Link
            href="/admin/alerts"
            style={{
              fontSize: 13,
              color: "var(--color-accent-dark)",
              textDecoration: "none",
              letterSpacing: "-0.005em",
            }}
          >
            View all →
          </Link>
        </div>
        {recentAlerts.length === 0 ? (
          <div
            className="surface-resting"
            style={{
              background: "var(--color-bg-card)",
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
              fontSize: 14,
              color: "var(--color-text-secondary)",
            }}
          >
            No active alerts. All students are on track.
          </div>
        ) : (
          <div
            className="surface-resting"
            style={{
              background: "var(--color-bg-card)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {recentAlerts.map((alert) => (
              <Link
                key={alert.id}
                href={`/admin/students/${alert.student_id}`}
                className="list-row"
                style={{
                  textDecoration: "none",
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <p
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      letterSpacing: "-0.011em",
                    }}
                  >
                    {alert.student?.name || "Unknown"}
                  </p>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                      marginTop: 1,
                    }}
                  >
                    {alert.message}
                  </p>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-tertiary)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  Day{" "}
                  {alert.student
                    ? getDayNumber(alert.student.joined_at)
                    : "?"}
                </span>
              </Link>
            ))}
          </div>
        )}
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
  return (
    <div
      className="surface-resting"
      style={{
        background: "var(--color-bg-card)",
        borderRadius: 16,
        padding: 28,
      }}
    >
      <p
        style={{
          fontSize: 12,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
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
          lineHeight: 1.05,
          letterSpacing: "-0.025em",
          color: accent
            ? "var(--color-accent-dark)"
            : "var(--color-text-quaternary)",
          marginTop: 12,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </p>
      <p
        style={{
          fontSize: 13,
          color: "var(--color-text-tertiary)",
          marginTop: 14,
          letterSpacing: "-0.005em",
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
        : "var(--color-text-primary)";
  return (
    <div
      className="surface-resting"
      style={{
        background: "var(--color-bg-card)",
        borderRadius: 12,
        padding: 18,
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
      <p
        style={{
          fontSize: 28,
          fontWeight: 600,
          color,
          marginTop: 6,
          letterSpacing: "-0.022em",
          lineHeight: 1.05,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </p>
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
