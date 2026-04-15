"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Student, DisengagementAlert } from "@/types/database";
import { getDayNumber } from "@/types/database";
import Link from "next/link";

interface DashboardStats {
  totalStudents: number;
  activeStudents: number;
  joinedThisWeek: number;
  avgProgress: number;
  canceledThisMonth: number;
  pendingDiscounts: number;
  activeAlerts: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentAlerts, setRecentAlerts] = useState<(DisengagementAlert & { student: Student })[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function fetchDashboard() {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
      const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

      const [
        studentsRes,
        completionsRes,
        discountsRes,
        alertsRes,
        recentAlertsRes,
      ] = await Promise.all([
        supabase.from("students").select("*"),
        supabase.from("student_task_completions").select("student_id"),
        supabase
          .from("discount_requests")
          .select("id")
          .eq("status", "pending"),
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

      // Compute per-student completion counts
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
        (s) => s.membership_status === "canceled" && s.updated_at >= monthAgo
      ).length;

      const avgProgress =
        activeStudents.length > 0
          ? Math.round(
              activeStudents.reduce(
                (sum, s) =>
                  sum + ((completionMap[s.id] || 0) / 23) * 100,
                0
              ) / activeStudents.length
            )
          : 0;

      setStats({
        totalStudents: students.length,
        activeStudents: activeStudents.length,
        joinedThisWeek,
        avgProgress,
        canceledThisMonth,
        pendingDiscounts: discountsRes.data?.length || 0,
        activeAlerts: alertsRes.data?.length || 0,
      });

      setRecentAlerts(
        (recentAlertsRes.data as (DisengagementAlert & { student: Student })[]) || []
      );
      setLoading(false);
    }

    fetchDashboard();
  }, [supabase]);

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const kpiCards = [
    { label: "Active Students", value: stats.activeStudents, color: "text-accent-light" },
    { label: "Joined This Week", value: stats.joinedThisWeek, color: "text-success" },
    { label: "Avg Progress", value: `${stats.avgProgress}%`, color: "text-accent-light" },
    { label: "Churned (30d)", value: stats.canceledThisMonth, color: "text-danger" },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((kpi) => (
          <div
            key={kpi.label}
            className="bg-bg-card border border-border rounded-xl p-4"
          >
            <p className="text-xs text-text-secondary">{kpi.label}</p>
            <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-4">
        <Link
          href="/admin/discounts"
          className="bg-bg-card border border-border rounded-xl p-4 hover:border-accent/30 transition-colors"
        >
          <p className="text-sm font-medium">Pending Discounts</p>
          <p className="text-2xl font-bold text-warning mt-1">
            {stats.pendingDiscounts}
          </p>
        </Link>
        <Link
          href="/admin/alerts"
          className="bg-bg-card border border-border rounded-xl p-4 hover:border-accent/30 transition-colors"
        >
          <p className="text-sm font-medium">Active Alerts</p>
          <p className="text-2xl font-bold text-danger mt-1">
            {stats.activeAlerts}
          </p>
        </Link>
      </div>

      {/* Recent Alerts */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Recent Alerts</h2>
          <Link
            href="/admin/alerts"
            className="text-xs text-accent-light hover:text-accent transition-colors"
          >
            View all
          </Link>
        </div>
        {recentAlerts.length === 0 ? (
          <p className="text-sm text-text-secondary bg-bg-card border border-border rounded-xl p-4">
            No active alerts. All students are on track!
          </p>
        ) : (
          <div className="space-y-2">
            {recentAlerts.map((alert) => (
              <div
                key={alert.id}
                className="bg-bg-card border border-border rounded-lg p-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-medium">
                    {alert.student?.name || "Unknown"}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {alert.message}
                  </p>
                </div>
                <span className="text-xs text-text-tertiary">
                  Day{" "}
                  {alert.student
                    ? getDayNumber(alert.student.joined_at)
                    : "?"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
