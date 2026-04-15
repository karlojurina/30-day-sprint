"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { DisengagementAlert, Student } from "@/types/database";
import { getDayNumber } from "@/types/database";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";

type AlertWithStudent = DisengagementAlert & { student: Student };

const alertTypeLabels: Record<string, string> = {
  no_tasks_7d: "No tasks in 7 days",
  no_activation_14d: "No activation by Day 14",
  no_login_5d: "Inactive for 5+ days",
  week2_no_start: "Week 2 not started",
};

const alertTypeColors: Record<string, string> = {
  no_tasks_7d: "bg-warning/15 text-warning",
  no_activation_14d: "bg-danger/15 text-danger",
  no_login_5d: "bg-warning/15 text-warning",
  week2_no_start: "bg-danger/15 text-danger",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertWithStudent[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  const { teamMember } = useAuth();

  useEffect(() => {
    fetchAlerts();
  }, [showDismissed]);

  async function fetchAlerts() {
    setLoading(true);
    let query = supabase
      .from("disengagement_alerts")
      .select("*, student:students(*)")
      .order("created_at", { ascending: false });

    if (!showDismissed) {
      query = query.eq("is_dismissed", false);
    }

    const { data } = await query;
    setAlerts((data as AlertWithStudent[]) || []);
    setLoading(false);
  }

  async function dismissAlert(alertId: string) {
    const { error } = await supabase
      .from("disengagement_alerts")
      .update({
        is_dismissed: true,
        dismissed_by: teamMember?.id,
        dismissed_at: new Date().toISOString(),
      })
      .eq("id", alertId);

    if (!error) {
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Alerts</h1>
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
            className="rounded"
          />
          Show dismissed
        </label>
      </div>

      {alerts.length === 0 ? (
        <p className="text-sm text-text-secondary bg-bg-card border border-border rounded-xl p-8 text-center">
          {showDismissed
            ? "No alerts found"
            : "No active alerts. All students are on track!"}
        </p>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`bg-bg-card border border-border rounded-xl p-4 flex items-start justify-between gap-4 ${
                alert.is_dismissed ? "opacity-50" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded mt-0.5 shrink-0 ${
                    alertTypeColors[alert.alert_type] || "bg-bg-elevated text-text-secondary"
                  }`}
                >
                  {alertTypeLabels[alert.alert_type] || alert.alert_type}
                </span>
                <div>
                  <Link
                    href={`/admin/students/${alert.student_id}`}
                    className="text-sm font-medium hover:text-accent-light transition-colors"
                  >
                    {alert.student?.name || "Unknown"}
                  </Link>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {alert.message}
                  </p>
                  <p className="text-[10px] text-text-tertiary mt-1">
                    Day{" "}
                    {alert.student
                      ? getDayNumber(alert.student.joined_at)
                      : "?"}{" "}
                    —{" "}
                    {new Date(alert.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {!alert.is_dismissed && (
                <button
                  onClick={() => dismissAlert(alert.id)}
                  className="text-xs text-text-tertiary hover:text-text-secondary transition-colors shrink-0"
                >
                  Dismiss
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
