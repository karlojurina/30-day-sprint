"use client";

/**
 * /admin/feedback/lessons - lesson ratings overview.
 * (Moved from /admin/lessons when the Feedback nav group was added;
 * /admin/lessons now redirects here.)
 *
 * Lists every lesson with: title, region, type, average stars, number
 * of ratings. Sortable by lowest average (to surface weak content) or
 * by volume. Click a row to expand the per-lesson comment thread:
 * each rating with the student's name + email + date + comment.
 *
 * Reads two tables:
 *   - lessons (the catalog)
 *   - student_lesson_ratings (one row per (student, lesson))
 *
 * RLS on student_lesson_ratings already permits team SELECT, so the
 * page hits Supabase directly from the browser via the team session.
 *
 * v75 - new with the rating feature.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import { useAuth } from "@/contexts/AuthContext";
import {
  AdminPage,
  PageHeader,
  RestrictedPage,
  T,
} from "@/components/admin/ui";

interface LessonRow {
  id: string;
  title: string;
  region_id: string;
  type: string;
}

interface RatingRow {
  id: string;
  student_id: string;
  lesson_id: string;
  stars: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

interface StudentRow {
  id: string;
  name: string | null;
  email: string | null;
}

type SortMode = "lowest_avg" | "highest_avg" | "most_ratings" | "lesson_order";

export default function AdminLessonsPage() {
  const { teamMember } = useAuth();
  if (teamMember?.role === "csm") {
    return <RestrictedPage title="Lessons" />;
  }
  return <AdminLessonsBody />;
}

function AdminLessonsBody() {
  const supabase = createClient();
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  const [studentsById, setStudentsById] = useState<Map<string, StudentRow>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>("lowest_avg");

  const load = useCallback(async () => {
    setLoading(true);
    const [lessonsRes, ratingsRes] = await Promise.all([
      supabase
        .from("lessons")
        .select("id, title, region_id, type")
        .order("region_id")
        .order("day")
        .order("sort_order"),
      // v75.56: one row per (student, lesson) rating — past ~1000 rows
      // PostgREST silently truncates to the newest 1000, skewing the
      // averages/counts this page exists to surface. Paginated.
      fetchAllRowsPaginated<RatingRow>(() =>
        supabase
          .from("student_lesson_ratings")
          .select(
            "id, student_id, lesson_id, stars, comment, created_at, updated_at",
          )
          // .order("id") tiebreaker: updated_at is mutable + non-unique,
          // so alone it's not a stable order for .range() pagination —
          // boundary rows could be skipped/duplicated between pages.
          .order("updated_at", { ascending: false })
          .order("id"),
      ),
    ]);
    if (ratingsRes.error) {
      console.error("[admin/lessons] ratings fetch failed:", ratingsRes.error);
    }
    const lessonRows = (lessonsRes.data ?? []) as LessonRow[];
    const ratingRows = (ratingsRes.data ?? []) as RatingRow[];
    setLessons(lessonRows);
    setRatings(ratingRows);
    const studentIds = Array.from(new Set(ratingRows.map((r) => r.student_id)));
    if (studentIds.length > 0) {
      const { data: studentRows } = await supabase
        .from("students")
        .select("id, name, email")
        .in("id", studentIds);
      const map = new Map<string, StudentRow>();
      for (const s of (studentRows ?? []) as StudentRow[]) {
        map.set(s.id, s);
      }
      setStudentsById(map);
    } else {
      setStudentsById(new Map());
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  // Per-lesson aggregate. avg / count / list of ratings.
  const aggByLesson = useMemo(() => {
    const map = new Map<
      string,
      { ratings: RatingRow[]; avg: number; count: number }
    >();
    for (const lesson of lessons) {
      map.set(lesson.id, { ratings: [], avg: 0, count: 0 });
    }
    for (const r of ratings) {
      const entry = map.get(r.lesson_id);
      if (!entry) continue;
      entry.ratings.push(r);
    }
    for (const entry of map.values()) {
      entry.count = entry.ratings.length;
      entry.avg =
        entry.count === 0
          ? 0
          : entry.ratings.reduce((s, r) => s + r.stars, 0) / entry.count;
    }
    return map;
  }, [lessons, ratings]);

  const overall = useMemo(() => {
    if (ratings.length === 0) {
      return { avg: 0, count: 0, rated: 0, total: lessons.length };
    }
    const avg = ratings.reduce((s, r) => s + r.stars, 0) / ratings.length;
    const ratedLessons = new Set(ratings.map((r) => r.lesson_id)).size;
    return {
      avg,
      count: ratings.length,
      rated: ratedLessons,
      total: lessons.length,
    };
  }, [ratings, lessons]);

  const sortedLessons = useMemo(() => {
    const list = [...lessons];
    if (sortMode === "lesson_order") return list;
    list.sort((a, b) => {
      const aAgg = aggByLesson.get(a.id);
      const bAgg = aggByLesson.get(b.id);
      const aCount = aAgg?.count ?? 0;
      const bCount = bAgg?.count ?? 0;
      const aAvg = aAgg?.avg ?? 0;
      const bAvg = bAgg?.avg ?? 0;
      if (sortMode === "most_ratings") return bCount - aCount;
      // Unrated lessons sink to the bottom of avg-sorted views so they
      // don't artificially dominate "lowest_avg" with their 0/0.
      if (aCount === 0 && bCount === 0) return 0;
      if (aCount === 0) return 1;
      if (bCount === 0) return -1;
      if (sortMode === "highest_avg") return bAvg - aAvg;
      return aAvg - bAvg; // lowest_avg
    });
    return list;
  }, [lessons, aggByLesson, sortMode]);

  function toggleExpanded(lessonId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(lessonId)) next.delete(lessonId);
      else next.add(lessonId);
      return next;
    });
  }

  return (
    <AdminPage>
      <PageHeader
        title="Lessons"
        description="Student ratings + comments per lesson. Click a row to read every comment."
      />

      {/* Overview tiles */}
      <div
        className="grid grid-cols-1 sm:grid-cols-3"
        style={{ gap: 12, marginBottom: 16 }}
      >
        <SummaryTile
          label="Average rating"
          value={
            overall.count === 0
              ? "—"
              : `${overall.avg.toFixed(2)} / 5`
          }
        />
        <SummaryTile
          label="Total ratings"
          value={loading ? "…" : `${overall.count}`}
        />
        <SummaryTile
          label="Lessons rated"
          value={
            loading
              ? "…"
              : `${overall.rated} / ${overall.total}`
          }
        />
      </div>

      {/* Sort */}
      <div
        className="flex items-center"
        style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            marginRight: 4,
          }}
        >
          Sort
        </span>
        {(
          [
            { v: "lowest_avg" as const, label: "Lowest rated" },
            { v: "highest_avg" as const, label: "Highest rated" },
            { v: "most_ratings" as const, label: "Most ratings" },
            { v: "lesson_order" as const, label: "Lesson order" },
          ]
        ).map((opt) => {
          const active = sortMode === opt.v;
          return (
            <button
              key={opt.v}
              type="button"
              onClick={() => setSortMode(opt.v)}
              style={{
                padding: "5px 10px",
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                borderRadius: 7,
                border: "1px solid",
                borderColor: active
                  ? "var(--color-border)"
                  : "transparent",
                background: active ? "var(--color-bg-card)" : "transparent",
                color: active
                  ? "var(--color-text-primary)"
                  : "var(--color-text-secondary)",
                cursor: "pointer",
                letterSpacing: "-0.005em",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p style={T.bodyDim}>Loading…</p>
      ) : (
        <div
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {sortedLessons.map((lesson, idx) => {
            const agg = aggByLesson.get(lesson.id);
            const isOpen = expanded.has(lesson.id);
            const ratingList = agg?.ratings ?? [];
            return (
              <div
                key={lesson.id}
                style={{
                  borderTop:
                    idx === 0
                      ? "none"
                      : "1px solid var(--color-border)",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(lesson.id)}
                  className="flex items-center"
                  style={{
                    width: "100%",
                    gap: 16,
                    padding: "12px 16px",
                    background: "transparent",
                    border: "none",
                    cursor: ratingList.length > 0 ? "pointer" : "default",
                    textAlign: "left",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 3,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                          color: "var(--color-text-tertiary)",
                          background: "var(--color-fill-secondary)",
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        {lesson.region_id.toUpperCase()}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--color-text-tertiary)",
                        }}
                      >
                        {lesson.id} · {lesson.type}
                      </span>
                    </div>
                    <p
                      className="truncate"
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--color-text-primary)",
                        letterSpacing: "-0.008em",
                      }}
                    >
                      {lesson.title}
                    </p>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      flexShrink: 0,
                    }}
                  >
                    <StarBar value={agg?.avg ?? 0} />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--color-text-primary)",
                        fontVariantNumeric: "tabular-nums",
                        minWidth: 36,
                        textAlign: "right",
                      }}
                    >
                      {agg && agg.count > 0
                        ? agg.avg.toFixed(2)
                        : "—"}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-tertiary)",
                        minWidth: 60,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {agg?.count ?? 0}{" "}
                      {agg?.count === 1 ? "rating" : "ratings"}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--color-text-tertiary)",
                        transform: isOpen ? "rotate(180deg)" : "none",
                        transition: "transform var(--duration-quick) var(--ease-default)",
                        display: "inline-block",
                        opacity: ratingList.length > 0 ? 1 : 0.3,
                      }}
                      aria-hidden="true"
                    >
                      ▾
                    </span>
                  </div>
                </button>
                {isOpen && ratingList.length > 0 && (
                  <div
                    style={{
                      padding: "0 16px 14px 16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {ratingList.map((r) => {
                      const student = studentsById.get(r.student_id);
                      return (
                        <div
                          key={r.id}
                          style={{
                            padding: "10px 12px",
                            background: "var(--color-fill-secondary)",
                            borderRadius: 8,
                            border: "1px solid var(--color-border)",
                          }}
                        >
                          <div
                            className="flex items-center"
                            style={{
                              gap: 10,
                              marginBottom: r.comment ? 6 : 0,
                            }}
                          >
                            <StarBar value={r.stars} small />
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: "var(--color-text-primary)",
                                letterSpacing: "-0.005em",
                              }}
                            >
                              {student?.name ?? "—"}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--color-text-tertiary)",
                              }}
                            >
                              {student?.email ?? r.student_id}
                            </span>
                            <span
                              style={{
                                marginLeft: "auto",
                                fontSize: 11,
                                color: "var(--color-text-tertiary)",
                              }}
                            >
                              {new Date(r.updated_at).toLocaleDateString(
                                undefined,
                                {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                },
                              )}
                            </span>
                          </div>
                          {r.comment && (
                            <p
                              style={{
                                fontSize: 13,
                                color: "var(--color-text-secondary)",
                                lineHeight: 1.5,
                                letterSpacing: "-0.003em",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                            >
                              {r.comment}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AdminPage>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <p
        style={{
          ...T.eyebrow,
          marginBottom: 4,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 28,
          fontWeight: 600,
          color: "var(--color-text-primary)",
          letterSpacing: "-0.022em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {value}
      </p>
    </div>
  );
}

function StarBar({
  value,
  small = false,
}: {
  value: number;
  small?: boolean;
}) {
  const size = small ? 12 : 14;
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const lit = n <= Math.round(value);
        return (
          <svg
            key={n}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={lit ? "var(--color-gold)" : "none"}
            stroke={lit ? "var(--color-gold)" : "rgba(255,255,255,0.18)"}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" />
          </svg>
        );
      })}
    </div>
  );
}
