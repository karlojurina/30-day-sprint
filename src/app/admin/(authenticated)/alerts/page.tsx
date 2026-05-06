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

const alertTypeTones: Record<string, "warning" | "danger" | "neutral"> = {
  no_tasks_7d: "warning",
  no_activation_14d: "danger",
  no_login_5d: "warning",
  week2_no_start: "danger",
};

function alertTone(type: string) {
  const tone = alertTypeTones[type] ?? "neutral";
  if (tone === "warning")
    return {
      color: "var(--color-warning)",
      bg: "rgba(212,162,76,0.12)",
    };
  if (tone === "danger")
    return {
      color: "var(--color-danger)",
      bg: "rgba(200,74,74,0.10)",
    };
  return {
    color: "var(--color-text-tertiary)",
    bg: "rgba(20,20,24,0.06)",
  };
}

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
      <header
        className="flex items-end justify-between"
        style={{ marginBottom: 24 }}
      >
        <div>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: "-0.025em",
              lineHeight: 1.15,
              color: "var(--color-text-primary)",
            }}
          >
            Alerts
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--color-text-secondary)",
              marginTop: 4,
              letterSpacing: "-0.005em",
            }}
          >
            {alerts.length} {alerts.length === 1 ? "alert" : "alerts"}
            {showDismissed ? " (incl. dismissed)" : ""}
          </p>
        </div>
        <label
          className="flex items-center gap-2 cursor-pointer"
          style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
        >
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
            className="rounded accent-[var(--color-accent)]"
          />
          Show dismissed
        </label>
      </header>

      {alerts.length === 0 ? (
        <div
          className="surface-resting"
          style={{
            background: "var(--color-bg-card)",
            borderRadius: 12,
            padding: 48,
            textAlign: "center",
            fontSize: 14,
            color: "var(--color-text-secondary)",
          }}
        >
          {showDismissed
            ? "No alerts found."
            : "No active alerts. All students are on track."}
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
          {alerts.map((alert) => {
            const tone = alertTone(alert.alert_type);
            return (
              <div
                key={alert.id}
                className="list-row"
                style={{
                  padding: "14px 16px",
                  alignItems: "flex-start",
                  gap: 12,
                  opacity: alert.is_dismissed ? 0.5 : 1,
                }}
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 500,
                      color: tone.color,
                      background: tone.bg,
                      letterSpacing: "-0.005em",
                      marginTop: 2,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {alertTypeLabels[alert.alert_type] || alert.alert_type}
                  </span>
                  <div className="min-w-0">
                    <Link
                      href={`/admin/students/${alert.student_id}`}
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--color-text-primary)",
                        letterSpacing: "-0.011em",
                        textDecoration: "none",
                      }}
                    >
                      {alert.student?.name || "Unknown"}
                    </Link>
                    <p
                      style={{
                        fontSize: 12,
                        color: "var(--color-text-secondary)",
                        marginTop: 2,
                      }}
                    >
                      {alert.message}
                    </p>
                    <p
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-tertiary)",
                        marginTop: 4,
                      }}
                    >
                      Day{" "}
                      {alert.student
                        ? getDayNumber(alert.student.joined_at)
                        : "?"}{" "}
                      ·{" "}
                      {new Date(alert.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {!alert.is_dismissed && (
                  <button
                    onClick={() => dismissAlert(alert.id)}
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-tertiary)",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: "2px 6px",
                    }}
                  >
                    Dismiss
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
