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
        className={`text-xs font-medium flex items-center gap-1 ${
          isActive ? "text-accent-light" : "text-text-secondary"
        }`}
      >
        {label}
        {isActive && (
          <span className="text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>
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
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Students</h1>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search by name, email, or Discord..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 min-h-10 bg-bg-card border border-border rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent focus-visible:outline-2 focus-visible:outline-[var(--color-gold)] focus-visible:outline-offset-2 transition-colors"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 min-h-10 bg-bg-card border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent focus-visible:outline-2 focus-visible:outline-[var(--color-gold)] focus-visible:outline-offset-2 transition-colors"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="canceled">Canceled</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3">
                  <SortHeader label="Name" sortKeyName="name" />
                </th>
                <th className="text-left px-4 py-3 hidden md:table-cell">
                  <span className="text-xs font-medium text-text-secondary">Discord</span>
                </th>
                <th className="text-left px-4 py-3">
                  <SortHeader label="Day" sortKeyName="day" />
                </th>
                <th className="text-left px-4 py-3">
                  <SortHeader label="Progress" sortKeyName="progress" />
                </th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">
                  <SortHeader label="Last Active" sortKeyName="last_active_at" />
                </th>
                <th className="text-left px-4 py-3">
                  <span className="text-xs font-medium text-text-secondary">Status</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((student) => {
                const day = getDayNumber(student.joined_at);
                const completed = completionCounts[student.id] || 0;
                const percent = progressPercent(completed, totalLessons);

                return (
                  <tr
                    key={student.id}
                    className="border-b border-border last:border-0 hover:bg-bg-elevated/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/students/${student.id}`}
                        className="flex items-center gap-2 hover:text-accent-light transition-colors"
                      >
                        <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center text-accent text-xs font-bold shrink-0">
                          {(student.name || "?")[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {student.name || "—"}
                          </p>
                          <p className="text-xs text-text-tertiary hidden sm:block">
                            {student.email}
                          </p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-text-secondary">
                        {student.discord_username || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-sm font-medium ${
                          day > 25 ? "text-danger" : day > 14 ? "text-warning" : "text-text-primary"
                        }`}
                      >
                        {day}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent rounded-full"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className="text-xs text-text-secondary">
                          {percent}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-text-secondary">
                        {relativeTime(student.last_active_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                          student.membership_status === "active"
                            ? "bg-success/15 text-success"
                            : "bg-danger/15 text-danger"
                        }`}
                      >
                        {student.membership_status}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center text-text-secondary text-sm py-8"
                  >
                    No students found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-text-tertiary">
        {filtered.length} student{filtered.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
