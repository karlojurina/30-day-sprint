"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Student } from "@/types/database";
import { getDayNumber } from "@/types/database";
import { progressPercent, TOTAL_LESSONS } from "@/lib/constants";
import Link from "next/link";

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

  useEffect(() => {
    async function fetchStudents() {
      // Filter to actual paying students:
      //   - whop_membership_id IS NOT NULL: they had a real Whop membership
      //   - membership_status IN active|past_due|canceled: drop 'expired'
      //     and any null statuses (free-community joiners who slipped through)
      const [studentsRes, completionsRes, lessonsRes] = await Promise.all([
        supabase
          .from("students")
          .select("*")
          .not("whop_membership_id", "is", null)
          .in("membership_status", ["active", "past_due", "canceled"])
          .order("joined_at", { ascending: false }),
        supabase.from("student_lesson_completions").select("student_id"),
        supabase.from("lessons").select("id", { count: "exact", head: true }),
      ]);

      if (studentsRes.data) setStudents(studentsRes.data);

      const counts: Record<string, number> = {};
      for (const c of completionsRes.data || []) {
        counts[c.student_id] = (counts[c.student_id] || 0) + 1;
      }
      setCompletionCounts(counts);

      if (typeof lessonsRes.count === "number" && lessonsRes.count > 0) {
        setTotalLessons(lessonsRes.count);
      }

      setLoading(false);
    }

    fetchStudents();
  }, [supabase]);

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
    <div
      className="px-12 pt-12 pb-16"
      style={{ maxWidth: 1180, margin: "0 auto" }}
    >
      <header style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            lineHeight: 1.15,
            color: "var(--color-text-primary)",
          }}
        >
          Students
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--color-text-secondary)",
            marginTop: 4,
            letterSpacing: "-0.005em",
          }}
        >
          {filtered.length} {filtered.length === 1 ? "student" : "students"}
        </p>
      </header>

      {/* Filters */}
      <div
        className="flex items-center gap-2"
        style={{ marginBottom: 24 }}
      >
        <input
          type="text"
          placeholder="Search by name, email, or Discord"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 transition-colors"
          style={{
            height: 36,
            padding: "0 12px",
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            fontSize: 14,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.006em",
            outline: "none",
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="transition-colors"
          style={{
            height: 36,
            padding: "0 28px 0 12px",
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            fontSize: 14,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.006em",
            outline: "none",
          }}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="canceled">Canceled</option>
          <option value="past_due">Past due</option>
        </select>
      </div>

      {/* List — Settings-style hairline rows */}
      <div
        className="surface-resting"
        style={{
          background: "var(--color-bg-card)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {/* Header row */}
        <div
          className="flex items-center"
          style={{
            height: 36,
            padding: "0 16px",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-bg-elevated)",
          }}
        >
          <div style={{ flex: "2 1 0", minWidth: 0 }}>
            <SortHeader label="Name" sortKeyName="name" />
          </div>
          <div className="hidden md:block" style={{ flex: "1 1 0", minWidth: 0 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "var(--color-text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Discord
            </span>
          </div>
          <div style={{ width: 60 }}>
            <SortHeader label="Day" sortKeyName="day" />
          </div>
          <div style={{ width: 140 }}>
            <SortHeader label="Progress" sortKeyName="progress" />
          </div>
          <div className="hidden lg:block" style={{ width: 110 }}>
            <SortHeader label="Last active" sortKeyName="last_active_at" />
          </div>
          <div style={{ width: 90 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "var(--color-text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Status
            </span>
          </div>
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 48,
              textAlign: "center",
              color: "var(--color-text-secondary)",
              fontSize: 14,
            }}
          >
            No students found
          </div>
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
                <div className="flex items-center gap-3" style={{ flex: "2 1 0", minWidth: 0 }}>
                  <div
                    className="rounded-full flex items-center justify-center shrink-0"
                    style={{
                      width: 28,
                      height: 28,
                      background: "var(--color-accent-glow)",
                      color: "var(--color-accent-dark)",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {(student.name || "?")[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--color-text-primary)",
                        letterSpacing: "-0.011em",
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
                        fontSize: 12,
                        color: "var(--color-text-tertiary)",
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
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--color-text-secondary)",
                      letterSpacing: "-0.005em",
                    }}
                  >
                    {student.discord_username || "—"}
                  </span>
                </div>
                <div style={{ width: 60 }}>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: dayColor,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {day}
                  </span>
                </div>
                <div style={{ width: 140 }}>
                  <div className="flex items-center gap-2">
                    <div
                      style={{
                        flex: 1,
                        height: 4,
                        borderRadius: 2,
                        background: "var(--color-fill-secondary, rgba(20,20,24,0.06))",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${percent}%`,
                          background: "var(--color-accent)",
                          transition: "width 250ms cubic-bezier(0.25, 0.1, 0.25, 1)",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--color-text-secondary)",
                        fontVariantNumeric: "tabular-nums",
                        minWidth: 30,
                        textAlign: "right",
                      }}
                    >
                      {percent}%
                    </span>
                  </div>
                </div>
                <div className="hidden lg:block" style={{ width: 110 }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {relativeTime(student.last_active_at)}
                  </span>
                </div>
                <div style={{ width: 90 }}>
                  <StatusPill status={student.membership_status} />
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Student["membership_status"] }) {
  const tone =
    status === "active"
      ? { color: "var(--color-success)", bg: "rgba(46,139,87,0.10)" }
      : status === "canceled"
        ? { color: "var(--color-danger)", bg: "rgba(200,74,74,0.10)" }
        : status === "past_due"
          ? { color: "var(--color-warning)", bg: "rgba(212,162,76,0.12)" }
          : {
              color: "var(--color-text-tertiary)",
              bg: "rgba(20,20,24,0.06)",
            };
  return (
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
        textTransform: "capitalize",
      }}
    >
      {status.replace("_", " ")}
    </span>
  );
}
