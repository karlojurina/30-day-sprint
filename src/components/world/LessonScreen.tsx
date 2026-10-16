"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorldCatalog } from "@/lib/world/useWorldCatalog";
import { useWorldStage } from "@/components/world/WorldStage";
import { useStudent } from "@/contexts/StudentContext";
import { LessonPlayer } from "@/components/world/LessonPlayer";
import { LessonText } from "@/components/world/LessonText";
import { ActionItemBlock } from "@/components/world/ActionItemBlock";
import type { CachedLessonTransport } from "@/lib/world/embed-cache";
import { useLessonTransport } from "@/lib/world/useLessonTransport";
import { parseLessonText } from "@/lib/world/lesson-text";
import { Panel } from "@/components/world/AreaScreen";
import { AnyLessonFinishesContext, mapIsSilent, useMapModel } from "@/components/world/useMapModel";
import { canFinishInApp, finishableIn } from "@/lib/world/map-model";
import { pad2 } from "@/components/world-v6/study";
import { BOUNTY_KEY, BOUNTY_NAME } from "@/components/world-v6/source";
import type { CatalogLessonLike } from "@/lib/world/catalog";
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
 * It wears the map's own panel, type and shapes (world-ui.module.css), in the
 * middle of the screen (Panel centred). The eyebrow says where the lesson
 * sits: the place's number in route order, then
 * "Lesson i of n" among the place's lessons that count toward progress, the
 * minutes when the catalog has a length, and the action mark on an action
 * item. A lesson that does not count gets the place's number and name only.
 * The Ad Bounty's lesson is its checkpoint's (map review 2026-10-15, plan
 * item 18): "Checkpoint · Ad Bounty", a back link to the map, where the
 * checkpoint's panel is, and no place's "Next lesson" leads into it.
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
 *
 * AN ACTION ITEM (requires_action) gets its hand-in last, under the text (or
 * under the Milestone box when there is no text): the Discord link, Save, and
 * the complete button (ActionItemBlock.tsx). On a lesson with no video the
 * button completes the lesson; on a video lesson it completes the action
 * half, and the lesson is done once the video is watched too. Either way
 * "Next lesson" lights the moment the context says the lesson is done, as it
 * does after a video. A lesson that can't be finished here at all (a watch
 * lesson with no video yet, map-model.ts) has "Next lesson" on from the start,
 * so it never holds a student (Loom 2, 2026-10-16).
 *
 * AN ADDRESS THAT DOESN'T MATCH THE COURSE says "That lesson isn't here.": a
 * lesson id the course doesn't have, or one filed under another place than
 * the address names. Its Back goes to that place, or to the map when the
 * course doesn't have the place either.
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
   * calls, through the page's embed cache (useLessonTransport.ts).
   */
  transport?: CachedLessonTransport;
}) {
  const router = useRouter();
  const stage = useWorldStage();
  // The same cache the map asked into before the click, so a lesson asked for
  // there opens with its frame at once.
  const shared = useLessonTransport();
  const lessonTransport = transport ?? shared;
  const { areas, lessonsByArea, lessonById, hasVideo } = useWorldCatalog();
  const { status, model } = useMapModel();
  const anyLessonFinishes = useContext(AnyLessonFinishesContext);
  // While the course is loading, or did not arrive, the host's card says so.
  const silent = mapIsSilent(status);
  const { completedLessonIds, markWatched, completions, saveDiscordLink, toggleLessonAction } = useStudent();
  const [justCompleted, setJustCompleted] = useState<string[] | null>(null);
  // The lesson the player was put up for. It stays up for that lesson.
  const [playerFor, setPlayerFor] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  // The Ad Bounty's lesson is its own checkpoint's, not the place's it is
  // filed under (map review 2026-10-15, plan item 18). Back and Esc go to the
  // map, where the checkpoint's panel is still up (it has no address of its
  // own; the browser's back lands there too), and the page names the
  // checkpoint, not the place.
  const bounty = isBountyLesson(lessonById(lessonId));
  // An address naming a place the course doesn't have goes back to the map.
  const placeKnown = areas.some((a) => a.id === areaId);
  const placeHref = bounty || !placeKnown ? stage.href() : stage.href(areaId);

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
  // A lesson under another place's address isn't here either: its eyebrow,
  // its "Next lesson" and the panel under it would all be that other place's.
  const found = lessonById(lessonId);
  const lesson = found && found.region_id === areaId ? found : null;
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
  // The place's own lessons for "Next lesson": the Ad Bounty's is the
  // checkpoint's, so the place's last lesson does not lead into it.
  const own = siblings.filter((l) => !isBountyLesson(l));
  const index = own.findIndex((l) => l.id === lessonId);
  const next = index >= 0 ? own[index + 1] : undefined;
  const done = completedLessonIds.has(lessonId);
  // A lesson the student can't finish here (a watch lesson with no video yet)
  // never holds them: its "Next lesson" is on (map-model.ts, Loom 2).
  const finishable = anyLessonFinishes || ((model && finishableIn(model, lesson.id)) ?? canFinishInApp(lesson));
  const nextOn = done || !finishable;

  // The eyebrow. `position` stays 0 for a lesson that is not one of the place's
  // counting lessons, and the eyebrow then names the place.
  const areaNumber = areas.indexOf(area) + 1;
  const counting = siblings.filter((l) => l.counts_toward_progress);
  const position = counting.findIndex((l) => l.id === lessonId) + 1;
  const minutes = position > 0 ? minutesOf(lesson.duration_seconds) : null;
  const text = parseLessonText(lesson.description);

  return (
    <Panel centred>
      <div className={u.top}>
        <Link href={placeHref} scroll={false} className={u.back}>
          <span aria-hidden="true">←</span>
          {bounty ? BOUNTY_NAME : area.name}
        </Link>
        <kbd className={u.esc}>Esc</kbd>
      </div>

      <p className={u.eyebrow}>
        <span className={u.num}>{bounty ? "Checkpoint" : pad2(areaNumber)}</span>
        <span aria-hidden="true">·</span>
        {position > 0 ? (
          <span>
            Lesson {position} of {counting.length}
          </span>
        ) : (
          <span>{bounty ? BOUNTY_NAME : area.name}</span>
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
          transport={lessonTransport}
          // This video is up: ask for the next lesson's address while it plays.
          onReady={() => {
            if (next && next.type === "watch" && hasVideo(next.id)) lessonTransport.prefetch(next.id);
          }}
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

      {lesson.requires_action && (
        <ActionItemBlock
          key={lesson.id}
          separateWatchHalf={watch}
          row={(completions ?? []).find((c) => c.lesson_id === lesson.id) ?? null}
          onSave={(link) => saveDiscordLink(lesson.id, link)}
          onComplete={() => toggleLessonAction(lesson.id)}
        />
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
                    You earned {justCompleted.length} achievement{justCompleted.length === 1 ? "" : "s"}.
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
                never by the player's own reckoning. Or at once on a lesson
                that can't be finished here (not recorded yet). */}
            {next && (
              <Link
                href={nextOn ? stage.href(areaId, next.id) : "#"}
                scroll={false}
                aria-disabled={!nextOn}
                onClick={(e) => {
                  if (!nextOn) e.preventDefault();
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
 * The Ad Bounty's lesson, the one the map shows as its own checkpoint's: the
 * row with the bounty key that does not count toward progress (map-model.ts
 * makes such a row a feature, and source.ts takes the one with this key).
 */
function isBountyLesson(lesson: CatalogLessonLike | null | undefined): boolean {
  return !!lesson && lesson.feature_key === BOUNTY_KEY && !lesson.counts_toward_progress;
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
