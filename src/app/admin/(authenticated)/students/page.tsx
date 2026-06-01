"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Student } from "@/types/database";
import { getDayNumber } from "@/types/database";
import {
  progressPercent,
  TOTAL_LESSONS,
  ADMIN_STUDENT_JOIN_CUTOFF,
} from "@/lib/constants";
import { useAdminScope } from "@/contexts/AdminScopeContext";
import Link from "next/link";
import {
  AdminPage,
  PageHeader,
  Card,
  Pill,
  PacePill,
  Avatar,
  EmptyState,
  T,
  type PillTone,
} from "@/components/admin/ui";
import { buildPaceSummary } from "@/lib/csm-triggers";

type SortKey = "name" | "joined_at" | "day" | "progress" | "last_active_at";
type SortDir = "asc" | "desc";

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [completionCounts, setCompletionCounts] = useState<Record<string, number>>({});
  const [totalLessons, setTotalLessons] = useState<number>(TOTAL_LESSONS);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("joined_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  const { scope } = useAdminScope();

  useEffect(() => {
    async function fetchStudents() {
      // Scope toggle: 'cohort' filters to launch-cohort joiners;
      // 'all' shows every paying member including legacy customers.
      let studentsQuery = supabase
        .from("students")
        .select("*")
        .not("whop_membership_id", "is", null)
        .in("membership_status", ["active", "past_due", "canceled"]);
      if (scope === "cohort") {
        studentsQuery = studentsQuery.gte(
          "joined_at",
          ADMIN_STUDENT_JOIN_CUTOFF,
        );
      }
      studentsQuery = studentsQuery.order("joined_at", { ascending: false });

      const [studentsRes, completionsRes, lessonsRes] = await Promise.all([
        studentsQuery,
        // Pre-aggregated per-student counts via a view. Querying
        // student_lesson_completions directly returns one row per
        // completion and silently truncates at the 1000-row cap once
        // the community is large.
        supabase
          .from("student_progress_counts")
          .select("student_id, completed_count"),
        // v75.1 - exclude l057 (bounty onboarding) so the list's
        // per-student % matches the 64-lesson sprint denominator.
        supabase
          .from("lessons")
          .select("id", { count: "exact", head: true })
          .neq("id", "l057"),
      ]);

      if (studentsRes.data) setStudents(studentsRes.data);

      const counts: Record<string, number> = {};
      for (const r of completionsRes.data || []) {
        counts[r.student_id] = r.completed_count;
      }
      setCompletionCounts(counts);

      if (typeof lessonsRes.count === "number" && lessonsRes.count > 0) {
        setTotalLessons(lessonsRes.count);
      }

      setLoading(false);
    }

    fetchStudents();
  }, [supabase, scope]);

  const filtered = useMemo(() => {
    let list = students;

    if (statusFilter !== "all") {
      list = list.filter((s) => s.membership_status === statusFilter);
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name?.toLowerCase().includes(q) ||
          s.email?.toLowerCase().includes(q) ||
          s.discord_username?.toLowerCase().includes(q)
      );
    }

    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = (a.name || "").localeCompare(b.name || "");
          break;
        case "joined_at":
          cmp = a.joined_at.localeCompare(b.joined_at);
          break;
        case "day":
          cmp = getDayNumber(a.joined_at) - getDayNumber(b.joined_at);
          break;
        case "progress":
          cmp =
            (completionCounts[a.id] || 0) - (completionCounts[b.id] || 0);
          break;
        case "last_active_at":
          cmp = a.last_active_at.localeCompare(b.last_active_at);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [students, search, sortKey, sortDir, statusFilter, completionCounts]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortHeader({ label, sortKeyName }: { label: string; sortKeyName: SortKey }) {
    const isActive = sortKey === sortKeyName;
    return (
      <button
        onClick={() => handleSort(sortKeyName)}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 500,
          color: isActive
            ? "var(--color-accent-dark)"
            : "var(--color-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
        }}
      >
        {label}
        {isActive && (
          <span style={{ fontSize: 10 }}>{sortDir === "asc" ? "↑" : "↓"}</span>
        )}
      </button>
    );
  }

  function relativeTime(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "just now";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <AdminPage>
      <PageHeader
        title="Students"
        description={`${filtered.length} ${filtered.length === 1 ? "student" : "students"}`}
      />

      {/* Filters */}
      <div
        className="flex items-center gap-2"
        style={{ marginBottom: 16 }}
      >
        <input
          type="text"
          placeholder="Search by name, email, or Discord"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 transition-colors"
          style={{
            height: 38,
            padding: "0 12px",
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            fontSize: 13,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.005em",
            outline: "none",
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="transition-colors"
          style={{
            height: 38,
            padding: "0 28px 0 12px",
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            fontSize: 13,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.005em",
            outline: "none",
          }}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="canceled">Canceled</option>
          <option value="past_due">Past due</option>
        </select>
      </div>

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
            <SortHeader label="Name" sortKeyName="name" />
          </div>
          <div className="hidden md:block" style={{ flex: "1 1 0", minWidth: 0 }}>
            <span style={T.eyebrow}>Discord</span>
          </div>
          <div style={{ width: 60, flexShrink: 0 }}>
            <SortHeader label="Day" sortKeyName="day" />
          </div>
          <div style={{ width: 100, flexShrink: 0 }}>
            <span style={T.eyebrow}>Pace</span>
          </div>
          <div style={{ width: 160, flexShrink: 0 }}>
            <SortHeader label="Progress" sortKeyName="progress" />
          </div>
          <div
            className="hidden lg:block"
            style={{ width: 110, flexShrink: 0 }}
          >
            <SortHeader label="Last active" sortKeyName="last_active_at" />
          </div>
          <div style={{ width: 90, flexShrink: 0 }}>
            <span style={T.eyebrow}>Status</span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="No students match these filters"
            description="Try clearing the search or status filter."
          />
        ) : (
          filtered.map((student) => {
            const day = getDayNumber(student.joined_at);
            const completed = completionCounts[student.id] || 0;
            const percent = progressPercent(completed, totalLessons);
            const dayColor =
              day > 25
                ? "var(--color-danger)"
                : day > 14
                  ? "var(--color-warning)"
                  : "var(--color-text-primary)";

            return (
              <Link
                key={student.id}
                href={`/admin/students/${student.id}`}
                className="list-row transition-colors"
                style={{ textDecoration: "none" }}
              >
                <div
                  className="flex items-center gap-3"
                  style={{ flex: "2 1 0", minWidth: 0 }}
                >
                  <Avatar src={student.avatar_url} name={student.name} />
                  <div className="min-w-0">
                    <p
                      style={{
                        ...T.body,
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {student.name || "—"}
                    </p>
                    <p
                      className="hidden sm:block"
                      style={{
                        ...T.meta,
                        marginTop: 1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {student.email}
                    </p>
                  </div>
                </div>
                <div
                  className="hidden md:block"
                  style={{ flex: "1 1 0", minWidth: 0 }}
                >
                  <span style={T.bodyDim}>
                    {student.discord_username || "—"}
                  </span>
                </div>
                <div style={{ width: 60, flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: dayColor,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {day}
                  </span>
                </div>
                <div style={{ width: 100, flexShrink: 0 }}>
                  <PacePill
                    label={
                      buildPaceSummary(
                        student.joined_at,
                        completed,
                        totalLessons,
                        "r1",
                      ).progressLabel
                    }
                  />
                </div>
                <div
                  style={{ width: 160, flexShrink: 0, paddingRight: 12 }}
                >
                  <div className="flex items-center" style={{ gap: 10 }}>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        height: 4,
                        borderRadius: 2,
                        background: "rgba(20,20,24,0.06)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${percent}%`,
                          background: "var(--color-accent-dark)",
                          transition:
                            "width 250ms cubic-bezier(0.25,0.1,0.25,1)",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        ...T.meta,
                        flexShrink: 0,
                        minWidth: 36,
                        textAlign: "right",
                      }}
                    >
                      {percent}%
                    </span>
                  </div>
                </div>
                <div
                  className="hidden lg:block"
                  style={{ width: 110, flexShrink: 0 }}
                >
                  <span style={T.meta}>
                    {relativeTime(student.last_active_at)}
                  </span>
                </div>
                <div style={{ width: 90, flexShrink: 0 }}>
                  <StatusPill status={student.membership_status} />
                </div>
              </Link>
            );
          })
        )}
      </Card>
    </AdminPage>
  );
}

function STATUS_TONE(status: Student["membership_status"]): PillTone {
  if (status === "active") return "success";
  if (status === "canceled") return "danger";
  if (status === "past_due") return "warning";
  return "neutral";
}

function StatusPill({ status }: { status: Student["membership_status"] }) {
  return (
    <Pill tone={STATUS_TONE(status)}>
      <span style={{ textTransform: "capitalize" }}>
        {status.replace("_", " ")}
      </span>
    </Pill>
  );
}
