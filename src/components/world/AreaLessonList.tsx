"use client";

import Link from "next/link";
import type { CatalogLessonLike } from "@/lib/world/catalog";

/**
 * The lesson rows for one area.
 *
 * Split out from AreaScreen so it can be rendered with plain data and no
 * session. THE SIZE QUESTION IS A REAL DESIGN RISK: the locked catalog runs
 * from 8 lessons (Introduction) to 25 (Static Ads), a 3.1x spread that gets
 * exercised on day one. Neither end may read as crammed or as empty, and that
 * is only answerable by looking at both.
 */

export interface LessonRowState {
  done: boolean;
  /** Furthest position reached, seconds. */
  position: number;
  /** Player-reported duration when the catalog has none. */
  reportedDuration: number | null;
  hasVideo: boolean;
}

export function AreaLessonList({
  areaId,
  lessons,
  stateFor,
}: {
  areaId: string;
  lessons: CatalogLessonLike[];
  stateFor: (lessonId: string) => LessonRowState;
}) {
  if (lessons.length === 0) {
    return (
      <p style={{ opacity: 0.6, font: "400 13px ui-sans-serif, system-ui, sans-serif", padding: "10px 2px", margin: 0 }}>
        Nothing here yet.
      </p>
    );
  }

  return (
    <ul style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "grid", gap: 6 }}>
      {lessons.map((l) => {
        const s = stateFor(l.id);
        const dur = l.duration_seconds ?? s.reportedDuration ?? 0;
        const started = !s.done && s.position > 0;
        const pct = dur > 0 ? Math.min(1, s.position / dur) : 0;

        return (
          <li key={l.id}>
            <Link
              href={`/world/${areaId}/${l.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 13px",
                borderRadius: 9,
                border: "1px solid rgba(246,239,230,.10)",
                background: s.done ? "rgba(232,168,106,.07)" : "rgba(246,239,230,.03)",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  background: s.done
                    ? "rgba(232,168,106,1)"
                    : started
                      ? "rgba(232,168,106,.5)"
                      : "transparent",
                  border: s.done ? "none" : "1px solid rgba(246,239,230,.3)",
                }}
              />
              <span style={{ flex: 1, minWidth: 0, font: "500 14px/1.35 ui-sans-serif, system-ui, sans-serif" }}>
                {l.title}
                {/* requires_action is THE action-item flag. The old map read
                    this off a /^Action Item:/i regex over the title. */}
                {l.requires_action && (
                  <span style={badgeStyle} title="This one has something to ship">
                    milestone
                  </span>
                )}
                {!s.hasVideo && l.type === "watch" && (
                  <span style={{ ...badgeStyle, opacity: 0.5 }}>not recorded yet</span>
                )}
              </span>
              <span style={{ opacity: 0.5, font: "400 12px ui-sans-serif, system-ui, sans-serif", flexShrink: 0 }}>
                {started ? `${Math.round(pct * 100)}%` : dur > 0 ? fmt(dur) : ""}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function fmt(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const badgeStyle: React.CSSProperties = {
  marginLeft: 8,
  padding: "2px 6px",
  borderRadius: 5,
  border: "1px solid rgba(246,239,230,.18)",
  font: "600 10px/1 ui-sans-serif, system-ui, sans-serif",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  opacity: 0.75,
  whiteSpace: "nowrap",
};
