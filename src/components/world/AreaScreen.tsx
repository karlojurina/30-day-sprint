"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorldCatalog } from "@/lib/world/useWorldCatalog";
import { useWorldStage } from "@/components/world/WorldStage";
import { useStudent } from "@/contexts/StudentContext";
import { AreaLessonList } from "@/components/world/AreaLessonList";

/**
 * One place, and the lessons inside it.
 *
 * A fixed layer over the parked canvas rather than a new page: the world stays
 * behind you while you read, which is the whole point of travelling into it.
 *
 * THE TWO SIZES THIS HAS TO SURVIVE are 8 lessons and 25 — the real spread of
 * the locked catalog. Neither may read as crammed or as empty, which is why
 * the list is a plain scrolling column with a fixed row height rather than
 * anything that stretches to fill.
 *
 * Styling is structural only. The design system (W9) and the art-direction
 * conversation set the actual look; nothing here encodes a palette decision
 * that talk has not made yet.
 */
export function AreaScreen({ areaId }: { areaId: string }) {
  const router = useRouter();
  const { parkAt } = useWorldStage();
  const { areas, lessonsByArea, areaProgress, hasVideo, loading } =
    useWorldCatalog();
  const { completedLessonIds, watchProgress } = useStudent();

  const area = areas.find((a) => a.id === areaId);

  // Park the camera here while this screen is open; hand the rail back on exit.
  useEffect(() => {
    parkAt(areaId);
    return () => parkAt(null);
  }, [areaId, parkAt]);

  // Escape closes, like every other overlay in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push("/world");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  if (loading) return null;

  if (!area) {
    return (
      <Panel>
        <p style={{ margin: 0, opacity: 0.8 }}>That place isn&apos;t on the map.</p>
        <Link href="/world" style={linkStyle}>
          Back to the world
        </Link>
      </Panel>
    );
  }

  const lessons = lessonsByArea.get(area.id) ?? [];
  const p = areaProgress(area.id);

  return (
    <Panel>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, font: "700 24px/1.15 ui-sans-serif, system-ui, sans-serif", letterSpacing: "-0.02em" }}>
          {area.name}
        </h1>
        <span style={{ opacity: 0.6, font: "400 13px ui-sans-serif, system-ui, sans-serif" }}>
          {p.done} of {p.total} done
        </span>
      </div>

      {area.landmarkLabel && (
        <p style={{ margin: "6px 0 0", opacity: 0.55, font: "400 12px ui-sans-serif, system-ui, sans-serif" }}>
          {area.landmarkLabel}
        </p>
      )}

      {/* One honest line about readiness, instead of a badge on every row.
          Shown only while some of the area is unrecorded, so it disappears by
          itself once filming catches up rather than needing to be removed. */}
      {(() => {
        const watchable = lessons.filter((l) => l.type === "watch");
        const ready = watchable.filter((l) => hasVideo(l.id)).length;
        if (watchable.length === 0 || ready === watchable.length) return null;
        return (
          <p style={{ margin: "10px 0 0", opacity: 0.5, font: "400 12px ui-sans-serif, system-ui, sans-serif" }}>
            {ready === 0
              ? "None of these are recorded yet."
              : `${ready} of ${watchable.length} recorded so far.`}
          </p>
        );
      })()}

      <div style={{ height: 3, borderRadius: 2, background: "rgba(246,239,230,.12)", margin: "16px 0 4px" }}>
        <div style={{ height: "100%", width: `${p.ratio * 100}%`, borderRadius: 2, background: "rgba(232,168,106,.85)" }} />
      </div>

      <AreaLessonList
        areaId={area.id}
        lessons={lessons}
        stateFor={(id) => {
          const w = watchProgress.get(id);
          return {
            done: completedLessonIds.has(id),
            position: Number(w?.max_position_seconds ?? 0),
            reportedDuration: w?.reported_duration_seconds ?? null,
            hasVideo: hasVideo(id),
          };
        }}
      />

      <Link href="/world" style={{ ...linkStyle, marginTop: 18 }}>
        ← Back to the world
      </Link>
    </Panel>
  );
}



const linkStyle: React.CSSProperties = {
  display: "inline-block",
  color: "rgba(246,239,230,.75)",
  font: "500 13px ui-sans-serif, system-ui, sans-serif",
  textDecoration: "none",
};

export function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 6,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "clamp(16px, 5vh, 64px) 16px",
        overflowY: "auto",
        background:
          "linear-gradient(to bottom, rgba(29,24,38,.55), rgba(29,24,38,.86))",
      }}
    >
      <div
        style={{
          width: "min(100%, 620px)",
          background: "rgba(20,15,18,.80)",
          border: "1px solid rgba(246,239,230,.14)",
          borderRadius: 14,
          padding: "22px 22px 20px",
          backdropFilter: "blur(10px)",
          color: "#F6EFE6",
          boxShadow: "0 30px 80px rgba(0,0,0,.5)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
