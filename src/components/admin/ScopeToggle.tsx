"use client";

/**
 * Small segmented toggle in the admin header. Two states:
 *
 *   [Sprint cohort]  — launch students only (default)
 *   [All members]    — every paying member, incl. legacy/pre-launch
 *
 * Visible from every admin page. Dashboard, /admin/students, and
 * /admin/insights respect the choice; other pages (tasks, lessons)
 * ignore it.
 *
 * State lives in AdminScopeContext, persisted in localStorage.
 */

import { useAdminScope } from "@/contexts/AdminScopeContext";
import type { Scope } from "@/lib/admin/metrics-definitions";

export function ScopeToggle() {
  const { scope, setScope } = useAdminScope();
  return (
    <div
      role="tablist"
      aria-label="Student scope"
      style={{
        display: "inline-flex",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 999,
        padding: 2,
        gap: 0,
        height: 28,
      }}
    >
      <ScopeButton
        active={scope === "cohort"}
        onClick={() => setScope("cohort")}
        label="Sprint cohort"
      />
      <ScopeButton
        active={scope === "all"}
        onClick={() => setScope("all")}
        label="All members"
      />
    </div>
  );
}

function ScopeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        background: active ? "var(--color-accent-dark)" : "transparent",
        color: active
          ? "var(--color-bg-elevated)"
          : "var(--color-text-secondary)",
        border: "none",
        padding: "0 12px",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "-0.005em",
        borderRadius: 999,
        cursor: "pointer",
        height: 24,
        lineHeight: 1,
        transition: "background-color 120ms, color 120ms",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

/**
 * Subtle badge that pages can render inside their PageHeader to show
 * the current scope alongside the page title. Keeps the user oriented
 * when the toggle has scrolled out of view.
 */
export function ScopeBadge({ scope }: { scope: Scope }) {
  const label = scope === "cohort" ? "Sprint cohort" : "All members";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--color-text-tertiary)",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 999,
        padding: "2px 8px",
        height: 18,
      }}
    >
      {label}
    </span>
  );
}
