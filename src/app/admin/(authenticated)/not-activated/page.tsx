"use client";

/**
 * /admin/not-activated — Phase 4 of brief v3.
 *
 * Lists every student who paid for Whop but never signed in to the
 * dashboard (joined_at IS NULL). Shows the cohort split (A: has
 * Discord, B: no Discord), the day-since-signup tier that will fire
 * next, the suggested template, and a one-click copy action. Once
 * a Day-10 NA task fires, the NA cron sets `high_churn_risk = true`
 * and the student drops out of this list.
 *
 * Source data:
 *   - students (joined_at, membership_status, discord_username, csm_exempt,
 *     created_at as the days-since-signup proxy, high_churn_risk)
 *   - student_whop_sync.last_sync_fetched (>0 = "watching in Whop but
 *     not in our app" - shown as a hint, not a cohort gate)
 *
 * Cohort derivation (Phase 3 simplification - no form webhook):
 *   discord_username NOT NULL → Cohort A → stalled.discord.day{tier} via Discord DM
 *   discord_username IS  NULL → Cohort B → stalled.whop.day{tier} via Whop DM
 *
 * Filters: cohort, current tier, "watching in Whop" hint.
 */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { ADMIN_STUDENT_JOIN_CUTOFF } from "@/lib/constants";

interface NotActivatedRow {
  id: string;
  name: string | null;
  email: string | null;
  discord_username: string | null;
  created_at: string;
  high_churn_risk: boolean;
  // Optional whop watch-fetched count (>0 means "watching in Whop
  // but not in our app"). Best-effort - missing if the sibling row
  // doesn't exist yet.
  whop_fetched_count: number | null;
}

const TIER_DAYS = [3, 5, 7, 10] as const;
type Tier = (typeof TIER_DAYS)[number];

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function nextTierForDay(days: number): Tier | null {
  // Map "current day" to the next-firing tier. Used to highlight what
  // Astrid should be ready to send.
  for (const t of TIER_DAYS) {
    if (days <= t) return t;
  }
  return null;
}

function cohortFor(row: NotActivatedRow): "A" | "B" {
  return row.discord_username ? "A" : "B";
}

function templateIdFor(cohort: "A" | "B", tier: Tier): string {
  // v57 renamed NA-A.{idx} / NA-B.{idx} to stalled.{channel}.day{tier}.
  // Cohort A (has Discord) -> Discord DM channel, Cohort B (no Discord) -> Whop DM.
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

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    // v59 - "Not activated" means PAID but never opened OUR app.
    // The Whop sync sets students.joined_at to the Whop membership
    // creation date the moment a student appears in Whop, so it
    // doesn't actually mean "logged into the dashboard". The real
    // "logged in to our app" signal is
    // student_milestones.first_sprint_login_at - stamped only on
    // first OAuth success against our auth callback. Pull the
    // active pool first, then exclude anyone whose milestones row
    // has first_sprint_login_at set.
    const { data: studentsRaw } = await supabase
      .from("students")
      .select(
        "id, name, email, discord_username, created_at, high_churn_risk",
      )
      .eq("membership_status", "active")
      .eq("high_churn_risk", false)
      .eq("csm_exempt", false)
      // v72.9 - apply the same launch-date cutoff every other admin
      // page uses. Without this filter the page was returning ~270
      // pre-launch test accounts (Karlo's bug report 2026-05-29).
      .gte("joined_at", ADMIN_STUDENT_JOIN_CUTOFF)
      .order("created_at", { ascending: true });

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

  if (loading) {
    return (
      <div className="p-6">
        <p style={{ color: "var(--color-text-tertiary)" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6" style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.018em",
            color: "var(--color-text-primary)",
            marginBottom: 6,
          }}
        >
          Not Activated
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--color-text-secondary)",
            lineHeight: 1.5,
            maxWidth: 720,
          }}
        >
          Students who paid for Whop but haven&rsquo;t signed in to
          the dashboard yet. Cohort A (has Discord) gets{" "}
          <code>stalled.discord.day&#123;tier&#125;</code> via Discord
          DM. Cohort B (no Discord) gets{" "}
          <code>stalled.whop.day&#123;tier&#125;</code> via Whop DM.
          Day-10 tier flips <code>high_churn_risk</code> and drops
          them from this list.
        </p>
      </div>

      {/* Summary chips */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <SummaryChip
          label="Total"
          value={rows.length}
          color="var(--color-text-primary)"
        />
        <SummaryChip
          label="Cohort A"
          value={rows.filter((r) => cohortFor(r) === "A").length}
          color="#7DD3FC"
        />
        <SummaryChip
          label="Cohort B"
          value={rows.filter((r) => cohortFor(r) === "B").length}
          color="#FCA5A5"
        />
        <SummaryChip
          label="Watching in Whop"
          value={
            rows.filter((r) => (r.whop_fetched_count ?? 0) > 0).length
          }
          color="#86EFAC"
        />
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
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
            ["watching", "Watching in Whop"],
            ["silent", "Silent (no activity)"],
          ]}
        />
      </div>

      {/* Table */}
      <div
        style={{
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(160px, 1.4fr) 80px 110px minmax(140px, 1fr) 110px 140px",
            padding: "10px 14px",
            background: "var(--color-bg-primary)",
            borderBottom: "1px solid var(--color-border)",
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-text-tertiary)",
          }}
        >
          <div>Student</div>
          <div>Day</div>
          <div>Cohort</div>
          <div>Suggested send</div>
          <div>Whop watch</div>
          <div></div>
        </div>
        {filtered.length === 0 && (
          <p
            style={{
              padding: "32px 14px",
              textAlign: "center",
              color: "var(--color-text-tertiary)",
              fontSize: 13,
            }}
          >
            No students match the current filters.
          </p>
        )}
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
            <div
              key={r.id}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(160px, 1.4fr) 80px 110px minmax(140px, 1fr) 110px 140px",
                padding: "10px 14px",
                borderBottom: "1px solid var(--color-border)",
                fontSize: 13,
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    color: "var(--color-text-primary)",
                    fontWeight: 500,
                  }}
                >
                  {r.name ?? "Unnamed"}
                </div>
                <div
                  style={{
                    color: "var(--color-text-tertiary)",
                    fontSize: 11,
                  }}
                >
                  {r.email ?? "—"}
                </div>
              </div>
              <div
                style={{
                  color: "var(--color-text-primary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                D{days}
              </div>
              <div>
                <span
                  style={{
                    padding: "3px 8px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    background:
                      cohort === "A"
                        ? "rgba(125, 211, 252, 0.16)"
                        : "rgba(252, 165, 165, 0.16)",
                    color: cohort === "A" ? "#7DD3FC" : "#FCA5A5",
                    border:
                      cohort === "A"
                        ? "1px solid rgba(125, 211, 252, 0.3)"
                        : "1px solid rgba(252, 165, 165, 0.3)",
                  }}
                >
                  {cohort}
                </span>
              </div>
              <div
                style={{
                  color: "var(--color-text-primary)",
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 500 }}>{scenarioId}</div>
                <div
                  style={{
                    color: "var(--color-text-tertiary)",
                    fontSize: 11,
                  }}
                >
                  via {channel}
                </div>
              </div>
              <div>
                {watching ? (
                  <span
                    style={{
                      color: "#86EFAC",
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                  >
                    Yes · {r.whop_fetched_count}
                  </span>
                ) : (
                  <span
                    style={{
                      color: "var(--color-text-tertiary)",
                      fontSize: 11,
                    }}
                  >
                    Silent
                  </span>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <a
                  href={`/admin/students/${r.id}`}
                  style={{
                    color: "var(--color-accent)",
                    fontSize: 12,
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  Open →
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      style={{
        padding: "10px 14px",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        minWidth: 110,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.018em",
        }}
      >
        {value}
      </div>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary)",
        }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "6px 10px",
          fontSize: 13,
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          color: "var(--color-text-primary)",
        }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
