"use client";

/**
 * /admin/not-activated — Phase 4 of brief v3.
 *
 * Lists every student who paid for Whop but never signed in to the
 * dashboard. Cohort A has Discord (we DM them there); Cohort B
 * doesn't (we DM them on Whop). Day-10 marks them as high-churn
 * and removes them from the list.
 *
 * Source data:
 *   - students (joined_at, membership_status, discord_username,
 *     csm_exempt, created_at as the days-since-signup proxy,
 *     high_churn_risk)
 *   - student_whop_sync.last_sync_fetched (>0 = "watching in Whop
 *     but not in our app" - shown as a hint, not a cohort gate)
 *
 * v75.9 - chrome rebuilt. Was a bespoke page outside the
 * AdminPage/PageHeader/Card shell with hardcoded Tailwind hex
 * sky/red/green colors; now uses the same shell + design tokens
 * as the rest of the admin so it visually belongs to the product.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import { ADMIN_STUDENT_JOIN_CUTOFF } from "@/lib/constants";
import { PAYING_WHOP_PLAN_IDS_ARRAY } from "@/lib/admin/metrics-definitions";
import { useAdminScope } from "@/contexts/AdminScopeContext";
import {
  AdminPage,
  PageHeader,
  Card,
  Pill,
  EmptyState,
  T,
} from "@/components/admin/ui";

interface NotActivatedRow {
  id: string;
  name: string | null;
  email: string | null;
  discord_username: string | null;
  created_at: string;
  high_churn_risk: boolean;
  whop_fetched_count: number | null;
}

const TIER_DAYS = [3, 5, 7, 10] as const;
type Tier = (typeof TIER_DAYS)[number];

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function nextTierForDay(days: number): Tier | null {
  for (const t of TIER_DAYS) {
    if (days <= t) return t;
  }
  return null;
}

function cohortFor(row: NotActivatedRow): "A" | "B" {
  return row.discord_username ? "A" : "B";
}

function templateIdFor(cohort: "A" | "B", tier: Tier): string {
  const channel = cohort === "A" ? "discord" : "whop";
  return `stalled.${channel}.day${tier}`;
}

export default function NotActivatedPage() {
  const [rows, setRows] = useState<NotActivatedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cohortFilter, setCohortFilter] = useState<"all" | "A" | "B">("all");
  const [tierFilter, setTierFilter] = useState<"all" | Tier>("all");
  const [watchingFilter, setWatchingFilter] = useState<
    "all" | "watching" | "silent"
  >("all");

  const { scope } = useAdminScope();

  useEffect(() => {
    void load();
    // Re-fetch when scope toggle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    // v75.27: paginated to bypass PostgREST's ~1000-row server cap.
    const buildQuery = () => {
      let q = supabase
        .from("students")
        .select(
          "id, name, email, discord_username, created_at, high_churn_risk",
        )
        .eq("membership_status", "active")
        .eq("high_churn_risk", false)
        .eq("csm_exempt", false)
        .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[]);
      if (scope === "cohort") {
        // v75.18: first_paid_at (original signup), not joined_at.
        q = q.gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF);
      }
      return q.order("created_at", { ascending: true });
    };
    const { data: studentsRaw } = await fetchAllRowsPaginated<{
      id: string;
      name: string | null;
      email: string | null;
      discord_username: string | null;
      created_at: string;
      high_churn_risk: boolean;
    }>(buildQuery);

    const allIds = (studentsRaw ?? []).map((s) => s.id);
    let activatedIds = new Set<string>();
    if (allIds.length > 0) {
      const { data: activated } = await supabase
        .from("student_milestones")
        .select("student_id")
        .in("student_id", allIds)
        .not("first_sprint_login_at", "is", null);
      activatedIds = new Set(
        (activated ?? []).map((r) => r.student_id as string),
      );
    }
    const students = (studentsRaw ?? []).filter(
      (s) => !activatedIds.has(s.id as string),
    );

    const ids = students.map((s) => s.id);
    let syncBy = new Map<string, number>();
    if (ids.length > 0) {
      const { data: sync } = await supabase
        .from("student_whop_sync")
        .select("student_id, last_sync_fetched")
        .in("student_id", ids);
      syncBy = new Map(
        (sync ?? []).map((r) => [
          r.student_id as string,
          (r.last_sync_fetched as number | null) ?? 0,
        ]),
      );
    }

    const merged: NotActivatedRow[] = (students ?? []).map((s) => ({
      id: s.id as string,
      name: (s.name as string | null) ?? null,
      email: (s.email as string | null) ?? null,
      discord_username: (s.discord_username as string | null) ?? null,
      created_at: s.created_at as string,
      high_churn_risk: (s.high_churn_risk as boolean | null) ?? false,
      whop_fetched_count: syncBy.get(s.id as string) ?? null,
    }));
    setRows(merged);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const c = cohortFor(r);
      if (cohortFilter !== "all" && cohortFilter !== c) return false;
      const days = daysSince(r.created_at);
      const nextTier = nextTierForDay(days);
      if (tierFilter !== "all" && nextTier !== tierFilter) return false;
      if (watchingFilter === "watching") {
        if ((r.whop_fetched_count ?? 0) <= 0) return false;
      } else if (watchingFilter === "silent") {
        if ((r.whop_fetched_count ?? 0) > 0) return false;
      }
      return true;
    });
  }, [rows, cohortFilter, tierFilter, watchingFilter]);

  const cohortACount = rows.filter((r) => cohortFor(r) === "A").length;
  const cohortBCount = rows.filter((r) => cohortFor(r) === "B").length;
  const watchingCount = rows.filter(
    (r) => (r.whop_fetched_count ?? 0) > 0,
  ).length;

  return (
    <AdminPage>
      <PageHeader
        title="Not Activated"
        description="Students who paid for Whop but haven't signed in to the dashboard yet. Cohort A has Discord (we DM there); Cohort B doesn't (we DM on Whop). Day-10 tier marks them as high-churn and removes them from this list."
      />

      {/* Summary tiles */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4"
        style={{ gap: 12, marginBottom: 16 }}
      >
        <SummaryTile label="Total" value={rows.length} />
        <SummaryTile label="Cohort A · Discord" value={cohortACount} />
        <SummaryTile label="Cohort B · Whop" value={cohortBCount} />
        <SummaryTile
          label="Watching in Whop"
          value={watchingCount}
          accent={watchingCount > 0}
        />
      </div>

      {/* Filters */}
      <div
        className="flex flex-wrap"
        style={{ gap: 14, marginBottom: 14 }}
      >
        <Filter
          label="Cohort"
          value={cohortFilter}
          onChange={(v) => setCohortFilter(v as "all" | "A" | "B")}
          options={[
            ["all", "All"],
            ["A", "A · Discord"],
            ["B", "B · Whop"],
          ]}
        />
        <Filter
          label="Tier"
          value={String(tierFilter)}
          onChange={(v) =>
            setTierFilter(v === "all" ? "all" : (Number(v) as Tier))
          }
          options={[
            ["all", "All"],
            ["3", "Day 3"],
            ["5", "Day 5"],
            ["7", "Day 7"],
            ["10", "Day 10"],
          ]}
        />
        <Filter
          label="Whop activity"
          value={watchingFilter}
          onChange={(v) =>
            setWatchingFilter(v as "all" | "watching" | "silent")
          }
          options={[
            ["all", "All"],
            ["watching", "Watching"],
            ["silent", "Silent"],
          ]}
        />
      </div>

      {loading ? (
        <Card padding={28}>
          <div
            className="flex items-center"
            style={{ gap: 10, color: "var(--color-text-tertiary)" }}
          >
            <Spinner />
            <span style={{ fontSize: 13 }}>Loading not-activated cohort…</span>
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card padding={0}>
          <EmptyState
            title="No students match the current filters."
            description={
              rows.length === 0
                ? "Nobody's stalled right now — either everyone's signed in, or the launch cohort is still small."
                : "Try widening the cohort or tier."
            }
          />
        </Card>
      ) : (
        <Card padding={0}>
          {/* Header row */}
          <div
            className="flex items-center"
            style={{
              height: 40,
              padding: "0 16px",
              borderBottom: "1px solid var(--color-border)",
              background: "var(--color-bg-elevated)",
              borderTopLeftRadius: 10,
              borderTopRightRadius: 10,
            }}
          >
            <div style={{ flex: "2 1 0", minWidth: 0 }}>
              <span style={T.eyebrow}>Student</span>
            </div>
            <div style={{ width: 60, flexShrink: 0 }}>
              <span style={T.eyebrow}>Day</span>
            </div>
            <div style={{ width: 110, flexShrink: 0 }}>
              <span style={T.eyebrow}>Cohort</span>
            </div>
            <div
              className="hidden md:block"
              style={{ flex: "1 1 0", minWidth: 0 }}
            >
              <span style={T.eyebrow}>Suggested send</span>
            </div>
            <div
              className="hidden lg:block"
              style={{ width: 110, flexShrink: 0 }}
            >
              <span style={T.eyebrow}>Whop watch</span>
            </div>
            <div style={{ width: 60, flexShrink: 0 }} />
          </div>

          {filtered.map((r) => {
            const days = daysSince(r.created_at);
            const cohort = cohortFor(r);
            const nextTier = nextTierForDay(days);
            const scenarioId = nextTier
              ? templateIdFor(cohort, nextTier)
              : "—";
            const channel = cohort === "A" ? "Discord DM" : "Whop DM";
            const watching = (r.whop_fetched_count ?? 0) > 0;
            return (
              <Link
                key={r.id}
                href={`/admin/students/${r.id}`}
                className="list-row flex items-center"
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--color-border)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div style={{ flex: "2 1 0", minWidth: 0 }}>
                  <div
                    className="truncate"
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      letterSpacing: "-0.005em",
                      lineHeight: 1.3,
                    }}
                  >
                    {r.name ?? "Unnamed"}
                  </div>
                  <div
                    className="truncate"
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-tertiary)",
                      letterSpacing: "-0.003em",
                      lineHeight: 1.3,
                    }}
                  >
                    {r.email ?? "—"}
                  </div>
                </div>
                <div
                  style={{
                    width: 60,
                    flexShrink: 0,
                    fontSize: 13,
                    color: "var(--color-text-primary)",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 500,
                  }}
                >
                  D{days}
                </div>
                <div style={{ width: 110, flexShrink: 0 }}>
                  <Pill tone={cohort === "A" ? "accent" : "warning"}>
                    {cohort} · {channel.split(" ")[0]}
                  </Pill>
                </div>
                <div
                  className="hidden md:block"
                  style={{ flex: "1 1 0", minWidth: 0 }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-primary)",
                      fontWeight: 500,
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    {scenarioId}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    via {channel}
                  </div>
                </div>
                <div
                  className="hidden lg:block"
                  style={{ width: 110, flexShrink: 0 }}
                >
                  {watching ? (
                    <Pill tone="success">
                      Yes · {r.whop_fetched_count}
                    </Pill>
                  ) : (
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-tertiary)",
                      }}
                    >
                      Silent
                    </span>
                  )}
                </div>
                <div
                  style={{
                    width: 60,
                    flexShrink: 0,
                    textAlign: "right",
                    fontSize: 12,
                    color: "var(--color-text-tertiary)",
                  }}
                >
                  →
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </AdminPage>
  );
}

function SummaryTile({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <p style={{ ...T.eyebrow, marginBottom: 4 }}>{label}</p>
      <p
        style={{
          fontSize: 24,
          fontWeight: 600,
          color: accent
            ? "var(--color-success)"
            : "var(--color-text-primary)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.022em",
          lineHeight: 1,
        }}
      >
        {value}
      </p>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      <span style={T.eyebrow}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "7px 10px",
          fontSize: 13,
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          color: "var(--color-text-primary)",
          letterSpacing: "-0.005em",
          cursor: "pointer",
        }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="animate-spin"
      style={{
        width: 12,
        height: 12,
        borderRadius: 999,
        border: "1.5px solid var(--color-border)",
        borderTopColor: "var(--color-text-secondary)",
        display: "inline-block",
      }}
    />
  );
}
