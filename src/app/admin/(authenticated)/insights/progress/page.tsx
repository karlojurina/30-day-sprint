"use client";

/**
 * /admin/insights/progress — "deep dive" insights surface.
 *
 * v75.45 aggressive trim: the dashboard already shows everything that
 * used to live here (Bounty hero, M2 hero, Active/Churned/Avg progress
 * trend tiles) and the journey kanban shows pace breakdown. The only
 * thing this page has that nothing else does is "Current sprinters"
 * — average progress for students still INSIDE their 30-day window
 * (the dashboard's avg_progress includes graduates and trends upward
 * forever).
 *
 * Previously this page was 1637 lines: 4 MetricCards duplicating the
 * dashboard trend row, a BountyAccessCard duplicating the dashboard
 * Bounty hero (with worse data — unbounded fetch + no scope filter
 * leaking v50 backfilled stamps), a PaceBreakdownCard duplicating the
 * journey header + sidebar badge, range controls + CalcTransparency
 * docs that only existed to support the duplicated cards, plus the
 * /api/admin/insights/progress route they fed. All gone.
 *
 * Net: file went from 1637 → ~150 lines, one fewer unbounded fetch,
 * one fewer free-plan/legacy leak, zero metric loss (every retained
 * number is still surfaced somewhere with the canonical filter stack).
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { AdminPage, PageHeader } from "@/components/admin/ui";
import { ADMIN_STUDENT_JOIN_CUTOFF } from "@/lib/constants";
import { PAYING_WHOP_PLAN_IDS_ARRAY } from "@/lib/admin/metrics-definitions";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";

export default function InsightsProgressPage() {
  const sprinters = useCurrentSprinterProgress();

  return (
    <AdminPage>
      <PageHeader
        title="Insights"
        description="Deeper-dive metrics that don't fit on the main dashboard."
      />

      <CurrentSprintersCard data={sprinters} />
    </AdminPage>
  );
}

interface SprinterProgress {
  loading: boolean;
  count: number;
  avgProgress: number;
  medianProgress: number;
}

function useCurrentSprinterProgress(): SprinterProgress {
  const supabase = createClient();
  const [data, setData] = useState<SprinterProgress>({
    loading: true,
    count: 0,
    avgProgress: 0,
    medianProgress: 0,
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const thirtyDaysAgo = new Date(
        Date.now() - 30 * 86_400_000,
      ).toISOString();
      // v75.32: cohort filter uses first_paid_at (real platform
      // tenure) instead of joined_at (current cycle, breaks for
      // returners). Adds paying-plan filter + ACTIVE_STATUSES.
      // Lessons count excludes l057 (sprint denominator = 64, not 65).
      // Paginates student_progress_counts to bypass PostgREST cap.
      //
      // v75.45: dropped the unused `joined_at` field from the select.
      // The hook only reads student.id into the completionMap lookup;
      // joined_at was a footgun (typed but never used).
      const [studentsRes, lessonsRes, completionsRes] = await Promise.all([
        supabase
          .from("students")
          .select("id, membership_status")
          .in("membership_status", ["active", "past_due"])
          .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[])
          .gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF)
          .gte("first_paid_at", thirtyDaysAgo),
        supabase
          .from("lessons")
          .select("id", { count: "exact", head: true })
          .neq("id", "l057"),
        fetchAllRowsPaginated<{
          student_id: string;
          completed_count: number;
        }>(() =>
          supabase
            .from("student_progress_counts")
            .select("student_id, completed_count"),
        ),
      ]);

      const students = (studentsRes.data ?? []) as Array<{ id: string }>;
      const totalLessons =
        typeof lessonsRes.count === "number" && lessonsRes.count > 0
          ? lessonsRes.count
          : 64;
      const completionMap = new Map<string, number>();
      for (const r of (completionsRes.data ?? []) as Array<{
        student_id: string;
        completed_count: number;
      }>) {
        completionMap.set(r.student_id, r.completed_count);
      }

      const pcts = students.map((s) => {
        const done = completionMap.get(s.id) ?? 0;
        return Math.max(0, Math.min(100, Math.round((done / totalLessons) * 100)));
      });

      const avg =
        pcts.length > 0
          ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
          : 0;
      const sorted = [...pcts].sort((a, b) => a - b);
      const median =
        sorted.length === 0
          ? 0
          : sorted.length % 2 === 1
            ? sorted[(sorted.length - 1) / 2]
            : Math.round(
                (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
              );

      if (cancelled) return;
      setData({
        loading: false,
        count: students.length,
        avgProgress: avg,
        medianProgress: median,
      });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return data;
}

function CurrentSprintersCard({ data }: { data: SprinterProgress }) {
  return (
    <div
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "20px 22px",
      }}
    >
      <div className="flex items-baseline" style={{ marginBottom: 14, gap: 8 }}>
        <h3
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.012em",
          }}
        >
          Current sprinters
        </h3>
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
          Active members within 30 days of joining
          {data.loading ? "" : ` · ${data.count}`}
        </span>
      </div>
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}
      >
        <StatCell
          label="Mean progress"
          value={data.avgProgress}
          sublabel="Average completion % across the cohort"
          color="var(--color-accent-dark)"
          loading={data.loading}
          suffix="%"
        />
        <StatCell
          label="Median progress"
          value={data.medianProgress}
          sublabel="Half the cohort is above this number"
          color="var(--color-text-secondary)"
          loading={data.loading}
          suffix="%"
        />
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  sublabel,
  color,
  loading,
  suffix,
}: {
  label: string;
  value: number;
  sublabel: string;
  color: string;
  loading: boolean;
  suffix?: string;
}) {
  return (
    <div>
      <p
        style={{
          fontSize: 12,
          color: "var(--color-text-tertiary)",
          marginBottom: 6,
          letterSpacing: "-0.005em",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 32,
          fontWeight: 600,
          color,
          letterSpacing: "-0.020em",
          lineHeight: 1.0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {loading ? "—" : `${value}${suffix ?? ""}`}
      </p>
      <p
        style={{
          fontSize: 11,
          color: "var(--color-text-tertiary)",
          marginTop: 4,
          letterSpacing: "-0.003em",
        }}
      >
        {sublabel}
      </p>
    </div>
  );
}
