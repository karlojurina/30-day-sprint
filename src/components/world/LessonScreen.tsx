"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorldCatalog } from "@/lib/world/useWorldCatalog";
import { useWorldStage } from "@/components/world/WorldStage";
import { useStudent } from "@/contexts/StudentContext";
import { LessonPlayer } from "@/components/world/LessonPlayer";
import { LessonText } from "@/components/world/LessonText";
import type { LessonTransport } from "@/lib/world/lesson-transport";
import { parseLessonText } from "@/lib/world/lesson-text";
import { Panel } from "@/components/world/AreaScreen";
import { mapIsSilent, useMapModel } from "@/components/world/useMapModel";
import { pad2 } from "@/components/world-v6/study";
import u from "@/components/world/world-ui.module.css";

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
 *
 * It wears the map's own panel, type and shapes (world-ui.module.css). The
 * eyebrow says where the lesson sits: the place's number in route order, then
 * "Lesson i of n" among the place's lessons that count toward progress, the
 * minutes when the catalog has a length, and the action mark on an action
 * item. A lesson that does not count (the Ad Bounty row) gets the place's
 * number and name only.
 *
 * UNDER THE TITLE. A watch lesson with a video: the player, the Milestone box
 * when the lesson is an action item, then the lesson's text when it has one.
 * A lesson with no video (a setup step, or a watch lesson not filmed yet) has
 * no video-sized box at all: the Milestone box, then the text in the video's
 * place. With no text either, a watch lesson says "Not recorded yet." on one
 * short line and a setup step says nothing. Which of the two layouts it is,
 * is read from the catalog (`hasVideo` and the type) before anything is asked
 * of the server; the player is not mounted for a lesson with no video.
 *
 * Once the player is up for a lesson it stays up for that lesson. A refresh
 * of the student's data whose read of the videos failed answers "no video"
 * for every lesson, and that must not take a playing video off the page: the
 * player keeps it and handles `recorded` turning false itself.
 */
export function LessonScreen({
  areaId,
  lessonId,
  devComplete = false,
  transport,
}: {
  areaId: string;
  lessonId: string;
  /**
   * Development harness only: a button that marks the lesson watched with no
   * video and no server. The real routes never pass it.
   */
  devComplete?: boolean;
  /**
   * Development harness only: what the player talks to in place of the
   * server. The real routes never pass it, and the player then uses the real
   * calls.
   */
  transport?: LessonTransport;
}) {
  const router = useRouter();
  const stage = useWorldStage();
  const { areas, lessonsByArea, lessonById, hasVideo } = useWorldCatalog();
  const { status } = useMapModel();
  // While the course is loading, or did not arrive, the host's card says so.
  const silent = mapIsSilent(status);
  const { completedLessonIds, markWatched } = useStudent();
  const [justCompleted, setJustCompleted] = useState<string[] | null>(null);
  // The lesson the player was put up for. It stays up for that lesson.
  const [playerFor, setPlayerFor] = useState<string | null>(null);
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

  // Whether this lesson gets the player, from the catalog alone, before any
  // request. Once it has, `hasVideo` turning false under it changes nothing.
  const recorded = !!lesson && hasVideo(lesson.id);
  const watch = lesson?.type === "watch";
  if (watch && recorded && playerFor !== lessonId) setPlayerFor(lessonId);
  const withPlayer = watch && (recorded || playerFor === lessonId);

  // The map behind this page is inert while it is open, so the keyboard starts
  // here. preventScroll: a focus must never move the page, and so the camera.
  useEffect(() => {
    if (shown) headingRef.current?.focus({ preventScroll: true });
  }, [shown, lessonId]);

  if (silent) return null;

  if (!area || !lesson) {
    return (
      <Panel note>
        <p className={u.message}>That lesson isn&apos;t here.</p>
        <Link href={placeHref} scroll={false} className={u.link}>
          <span aria-hidden="true">←</span>
          Back
        </Link>
      </Panel>
    );
  }

  const siblings = lessonsByArea.get(areaId) ?? [];
  const index = siblings.findIndex((l) => l.id === lessonId);
  const next = index >= 0 ? siblings[index + 1] : undefined;
  const done = completedLessonIds.has(lessonId);

  // The eyebrow. `position` stays 0 for a lesson that is not one of the place's
  // counting lessons, and the eyebrow then names the place.
  const areaNumber = areas.indexOf(area) + 1;
  const counting = siblings.filter((l) => l.counts_toward_progress);
  const position = counting.findIndex((l) => l.id === lessonId) + 1;
  const minutes = position > 0 ? minutesOf(lesson.duration_seconds) : null;
  const text = parseLessonText(lesson.description);

  return (
    <Panel>
      <div className={u.top}>
        <Link href={placeHref} scroll={false} className={u.back}>
          <span aria-hidden="true">←</span>
          {area.name}
        </Link>
        <kbd className={u.esc}>Esc</kbd>
      </div>

      <p className={u.eyebrow}>
        <span className={u.num}>{pad2(areaNumber)}</span>
        <span aria-hidden="true">·</span>
        {position > 0 ? (
          <span>
            Lesson {position} of {counting.length}
          </span>
        ) : (
          <span>{area.name}</span>
        )}
        {minutes !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span>{minutes} min</span>
          </>
        )}
        {position > 0 && lesson.requires_action && (
          <span className={u.action}>
            <span className={u.diamond} aria-hidden="true" />
            Action
          </span>
        )}
      </p>

      <h1 ref={headingRef} tabIndex={-1} className={u.title}>
        {lesson.title}
      </h1>

      {withPlayer && (
        <LessonPlayer
          lessonId={lesson.id}
          durationSeconds={lesson.duration_seconds}
          recorded={recorded}
          onCompleted={onCompleted}
          transport={transport}
          className={u.player}
        />
      )}

      {lesson.requires_action && (
        <div className={u.milestone}>
          <p className={u.milestoneLabel}>
            <span className={u.diamond} aria-hidden="true" />
            Milestone
          </p>
          <p className={u.milestoneBrief}>{lesson.action_brief}</p>
        </div>
      )}

      {text.length > 0 ? (
        <LessonText blocks={text} />
      ) : (
        !withPlayer && watch && <p className={u.muted}>Not recorded yet.</p>
      )}

      {(done || devComplete || next) && (
        <div className={u.foot}>
          {done && (
            <p className={u.done}>
              <span className={u.doneDot} aria-hidden="true" />
              <span>
                Done.
                {justCompleted && justCompleted.length > 0 && (
                  <span className={u.gained}>
                    {" "}
                    You unlocked {justCompleted.length} achievement{justCompleted.length === 1 ? "" : "s"}.
                  </span>
                )}
              </span>
            </p>
          )}
          <div className={u.actions}>
            {devComplete && (
              <button type="button" onClick={() => markWatched(lesson.id)} className={u.dev}>
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
                className={u.primary}
              >
                Next lesson
                <span aria-hidden="true">→</span>
              </Link>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * Whole minutes, rounded the way the map rounds them (minutesOf in
 * lib/world/map-model.ts, which is private to that file), so the eyebrow and
 * the map's card agree. Null when the catalog has no length: none is invented.
 */
function minutesOf(durationSeconds: number | null): number | null {
  if (durationSeconds === null || !(durationSeconds > 0)) return null;
  return Math.max(1, Math.round(durationSeconds / 60));
}
