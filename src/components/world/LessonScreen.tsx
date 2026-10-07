"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorldCatalog } from "@/lib/world/useWorldCatalog";
import { useWorldStage } from "@/components/world/WorldStage";
import { useStudent } from "@/contexts/StudentContext";
import { LessonPlayer } from "@/components/world/LessonPlayer";
import { Panel } from "@/components/world/AreaScreen";
import { mapIsSilent, useMapModel } from "@/components/world/useMapModel";

/**
 * A lesson: the video, and what happens when it finishes.
 *
 * THE WHOLE CHAIN MEETS HERE. The player asks the server to ratify the 95%
 * crossing; the route re-reads the telemetry, applies the played-seconds floor,
 * writes the completion and runs streak -> CSM reactivation -> achievements ->
 * task re-evaluation. This component only reflects the answer.
 *
 * It never decides completion itself, and deliberately has no way to.
 *
 * It opens over the map, which holds still underneath: the stage reads the
 * same address and pauses it. Every link here is built by the stage and leaves
 * the page scroll alone, because the page scroll is the map's camera.
 */
export function LessonScreen({
  areaId,
  lessonId,
  devComplete = false,
}: {
  areaId: string;
  lessonId: string;
  /**
   * Development harness only: a button that marks the lesson watched with no
   * video and no server. The real routes never pass it.
   */
  devComplete?: boolean;
}) {
  const router = useRouter();
  const stage = useWorldStage();
  const { areas, lessonsByArea, lessonById, hasVideo } = useWorldCatalog();
  const { status } = useMapModel();
  // While the course is loading, or did not arrive, the host's card says so.
  const silent = mapIsSilent(status);
  const { completedLessonIds, markWatched } = useStudent();
  const [justCompleted, setJustCompleted] = useState<string[] | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const placeHref = stage.href(areaId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(placeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, placeHref]);

  const onCompleted = useCallback((_id: string, achievements: string[]) => {
    setJustCompleted(achievements);
  }, []);

  const area = areas.find((a) => a.id === areaId);
  const lesson = lessonById(lessonId);
  const shown = !silent && !!area && !!lesson;

  // The map behind this page is inert while it is open, so the keyboard starts
  // here. preventScroll: a focus must never move the page, and so the camera.
  useEffect(() => {
    if (shown) headingRef.current?.focus({ preventScroll: true });
  }, [shown, lessonId]);

  if (silent) return null;

  if (!area || !lesson) {
    return (
      <Panel>
        <p style={{ margin: 0, opacity: 0.8 }}>That lesson isn&apos;t here.</p>
        <Link href={placeHref} scroll={false} style={backStyle}>
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
        <Link href={stage.href()} scroll={false} style={{ color: "inherit", textDecoration: "none" }}>
          World
        </Link>
        {" / "}
        <Link href={placeHref} scroll={false} style={{ color: "inherit", textDecoration: "none" }}>
          {area.name}
        </Link>
      </nav>

      <h1 ref={headingRef} tabIndex={-1} style={{ margin: "0 0 14px", font: "700 20px/1.2 ui-sans-serif, system-ui, sans-serif", letterSpacing: "-0.015em" }}>
        {lesson.title}
      </h1>

      {lesson.type === "watch" ? (
        <LessonPlayer
          lessonId={lesson.id}
          durationSeconds={lesson.duration_seconds}
          recorded={hasVideo(lesson.id)}
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
        <Link href={placeHref} scroll={false} style={backStyle}>
          ← {area.name}
        </Link>
        <span style={{ flex: 1 }} />
        {devComplete && (
          <button
            type="button"
            onClick={() => markWatched(lesson.id)}
            style={{
              padding: "10px 12px",
              borderRadius: 9,
              font: "500 12px ui-sans-serif, system-ui, sans-serif",
              border: "1px dashed rgba(246,239,230,.3)",
              background: "transparent",
              color: "rgba(246,239,230,.7)",
              cursor: "pointer",
            }}
          >
            Mark watched (dev)
          </button>
        )}
        {/* Enabled by the SERVER's completion, read back through the context —
            never by the player's own reckoning. */}
        {next && (
          <Link
            href={done ? stage.href(areaId, next.id) : "#"}
            scroll={false}
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
