"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorldCatalog } from "@/lib/world/useWorldCatalog";
import { useWorldStage } from "@/components/world/WorldStage";
import { useStudent } from "@/contexts/StudentContext";
import { LessonPlayer } from "@/components/world/LessonPlayer";
import { Panel } from "@/components/world/AreaScreen";

/**
 * A lesson: the video, and what happens when it finishes.
 *
 * THE WHOLE CHAIN MEETS HERE. The player asks the server to ratify the 95%
 * crossing; the route re-reads the telemetry, applies the played-seconds floor,
 * writes the completion and runs streak -> CSM reactivation -> achievements ->
 * task re-evaluation. This component only reflects the answer.
 *
 * It never decides completion itself, and deliberately has no way to.
 */
export function LessonScreen({
  areaId,
  lessonId,
}: {
  areaId: string;
  lessonId: string;
}) {
  const router = useRouter();
  const { parkAt } = useWorldStage();
  const { areas, lessonsByArea, lessonById, loading } = useWorldCatalog();
  const { completedLessonIds } = useStudent();
  const [justCompleted, setJustCompleted] = useState<string[] | null>(null);

  useEffect(() => {
    parkAt(areaId);
    return () => parkAt(null);
  }, [areaId, parkAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(`/world/${areaId}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, areaId]);

  const onCompleted = useCallback((_id: string, achievements: string[]) => {
    setJustCompleted(achievements);
  }, []);

  if (loading) return null;

  const area = areas.find((a) => a.id === areaId);
  const lesson = lessonById(lessonId);

  if (!area || !lesson) {
    return (
      <Panel>
        <p style={{ margin: 0, opacity: 0.8 }}>That lesson isn&apos;t here.</p>
        <Link href={`/world/${areaId}`} style={backStyle}>
          ← Back
        </Link>
      </Panel>
    );
  }

  const siblings = lessonsByArea.get(areaId) ?? [];
  const index = siblings.findIndex((l) => l.id === lessonId);
  const next = index >= 0 ? siblings[index + 1] : undefined;
  const done = completedLessonIds.has(lessonId);

  return (
    <Panel>
      <nav style={{ opacity: 0.55, font: "500 12px ui-sans-serif, system-ui, sans-serif", marginBottom: 10 }}>
        <Link href="/world" style={{ color: "inherit", textDecoration: "none" }}>
          World
        </Link>
        {" / "}
        <Link href={`/world/${areaId}`} style={{ color: "inherit", textDecoration: "none" }}>
          {area.name}
        </Link>
      </nav>

      <h1 style={{ margin: "0 0 14px", font: "700 20px/1.2 ui-sans-serif, system-ui, sans-serif", letterSpacing: "-0.015em" }}>
        {lesson.title}
      </h1>

      {lesson.type === "watch" ? (
        <LessonPlayer
          lessonId={lesson.id}
          durationSeconds={lesson.duration_seconds}
          onCompleted={onCompleted}
        />
      ) : (
        <p style={{ margin: 0, opacity: 0.7, font: "400 14px/1.6 ui-sans-serif, system-ui, sans-serif" }}>
          {lesson.description ?? "Nothing to watch here — this one is a setup step."}
        </p>
      )}

      {lesson.requires_action && (
        <div
          style={{
            marginTop: 16,
            padding: "13px 15px",
            borderRadius: 10,
            border: "1px solid rgba(232,168,106,.3)",
            background: "rgba(232,168,106,.07)",
          }}
        >
          <p style={{ margin: "0 0 6px", font: "700 11px/1 ui-sans-serif, system-ui, sans-serif", letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(232,168,106,.95)" }}>
            Milestone
          </p>
          <p style={{ margin: 0, font: "400 13px/1.55 ui-sans-serif, system-ui, sans-serif", opacity: 0.85 }}>
            {lesson.action_brief}
          </p>
        </div>
      )}

      <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href={`/world/${areaId}`} style={backStyle}>
          ← {area.name}
        </Link>
        <span style={{ flex: 1 }} />
        {/* Enabled by the SERVER's completion, read back through the context —
            never by the player's own reckoning. */}
        {next && (
          <Link
            href={done ? `/world/${areaId}/${next.id}` : "#"}
            aria-disabled={!done}
            onClick={(e) => {
              if (!done) e.preventDefault();
            }}
            style={{
              padding: "10px 16px",
              borderRadius: 9,
              textDecoration: "none",
              font: "600 13px ui-sans-serif, system-ui, sans-serif",
              border: "1px solid rgba(232,168,106,.45)",
              background: done ? "rgba(232,168,106,.9)" : "transparent",
              color: done ? "#1d1826" : "rgba(246,239,230,.4)",
              cursor: done ? "pointer" : "not-allowed",
            }}
          >
            Next lesson
          </Link>
        )}
      </div>

      {done && (
        <p style={{ margin: "14px 0 0", font: "500 13px ui-sans-serif, system-ui, sans-serif", color: "rgba(232,168,106,.95)" }}>
          Done.
          {justCompleted && justCompleted.length > 0 && (
            <> You unlocked {justCompleted.length} achievement{justCompleted.length === 1 ? "" : "s"}.</>
          )}
        </p>
      )}
    </Panel>
  );
}

const backStyle: React.CSSProperties = {
  display: "inline-block",
  color: "rgba(246,239,230,.75)",
  font: "500 13px ui-sans-serif, system-ui, sans-serif",
  textDecoration: "none",
};
