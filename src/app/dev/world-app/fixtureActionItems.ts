"use client";

import { useMemo, useState } from "react";
import type { StudentContextType } from "@/contexts/StudentContext";
import type { CatalogLessonLike } from "@/lib/world/catalog";
import type { StudentLessonCompletion } from "@/types/database";
import { isLessonComplete } from "@/lib/progress";
import {
  actionWrite,
  applyActionWrite,
  checkDiscordLink,
  hasActionHalf,
  takesDiscordLink,
  watchHalfIsSeparate,
  type CompletionHalves,
} from "@/lib/world/action-items";

/**
 * The pretend student's action items, for /dev/world-app
 * (FixtureStudentProvider.tsx). In memory, no request of any kind: the
 * Discord link, the action half and the watch half of each action item, kept
 * the way the two routes and StudentProvider keep them, by the same rules
 * (src/lib/world/action-items.ts):
 *
 *   saveDiscordLink(id, link)  save-action-link: the link checked by
 *                              checkDiscordLink, a row made when there is none.
 *   toggleLessonAction(id)     mark-action-shipped on the new course's catalog
 *                              (this page's catalogs are the staging shape):
 *                              a video lesson gets its action half, a setup
 *                              lesson both halves.
 *   markWatched(id)            on an action item, the watch half only, as
 *                              StudentProvider's markWatched stamps
 *                              `completed_at`; any other lesson is done, as
 *                              before.
 *
 * Two ways to be done stay as they were, and count as both halves here:
 * the preset (?p=), and window.__fixture.complete(id), which the browser
 * scripts use to put the student somewhere. So does the stand-in server's
 * own "watched" for a lesson played to its end (fixtureTransport.ts), which
 * still marks the whole lesson done: a known shortcut of this page, not of
 * the app.
 */

/** One action item's row, with whether it is complete (worked out when it changes). */
interface FixtureActionRow extends CompletionHalves {
  discord_message_link: string | null;
  done: boolean;
}

type Rows = ReadonlyMap<string, FixtureActionRow>;

/** The time stamped on an action item the preset or __fixture.complete() made done. */
const DONE_BEFORE = "2026-10-01T09:00:00.000Z";

export interface FixtureActionItems {
  /** Action items whose own row is complete: the provider adds them to the done set. */
  doneIds: ReadonlySet<string>;
  /** Action items whose own row has its watch half (`completed_at`), done or not: the provider adds them to the watched set. */
  watchedIds: ReadonlySet<string>;
  /**
   * The context's fields for them, given the catalog, the done set and the
   * provider's own markWatched (which marks a whole lesson done).
   */
  contextFor(
    lessons: readonly CatalogLessonLike[],
    done: ReadonlySet<string>,
    markDone: (id: string) => void,
  ): Pick<StudentContextType, "completions" | "saveDiscordLink" | "toggleLessonAction" | "markWatched">;
}

export function useFixtureActionItems(): FixtureActionItems {
  const [rows, setRows] = useState<Rows>(() => new Map());

  return useMemo(() => {
    const doneIds = new Set([...rows].filter(([, r]) => r.done).map(([id]) => id));
    const watchedIds = new Set([...rows].filter(([, r]) => r.completed_at).map(([id]) => id));

    /** Change one lesson's row with `next`, and work out again whether it is complete. */
    const change = (lesson: CatalogLessonLike, next: (cur: FixtureActionRow | null) => FixtureActionRow | null) =>
      setRows((prev) => {
        const row = next(prev.get(lesson.id) ?? null);
        const out = new Map(prev);
        if (row === null) out.delete(lesson.id);
        else
          out.set(lesson.id, {
            ...row,
            done: isLessonComplete({ lesson_id: lesson.id, skipped_at: null, ...row }, lesson),
          });
        return out;
      });

    return {
      doneIds,
      watchedIds,
      contextFor(lessons, done, markDone) {
        const byId = new Map(lessons.map((l) => [l.id, l]));

        const completions: StudentLessonCompletion[] = [];
        for (const lesson of lessons) {
          if (!lesson.requires_action) continue;
          const own = rows.get(lesson.id) ?? null;
          const whole = done.has(lesson.id);
          if (!own && !whole) continue;
          completions.push({
            id: `fixture-${lesson.id}`,
            student_id: "fixture-student",
            lesson_id: lesson.id,
            completed_at: own?.completed_at ?? (whole ? DONE_BEFORE : null),
            action_completed_at: own?.action_completed_at ?? (whole ? DONE_BEFORE : null),
            skipped_at: null,
            discord_message_link: own?.discord_message_link ?? null,
          });
        }

        const saveDiscordLink = async (lessonId: string, link: string | null): Promise<string | null> => {
          const lesson = byId.get(lessonId);
          if (!lesson || !takesDiscordLink(lesson)) return "Only action-item lessons can have a Discord link";
          const checked = checkDiscordLink(link);
          if (!checked.ok) return checked.error;
          change(lesson, (cur) => {
            if (!cur && checked.link === null) return null;
            return { completed_at: null, action_completed_at: null, ...cur, done: false, discord_message_link: checked.link };
          });
          return null;
        };

        const toggleLessonAction = async (lessonId: string): Promise<string | null> => {
          const lesson = byId.get(lessonId);
          if (!lesson || !hasActionHalf(lesson)) return "Not a compound lesson";
          change(lesson, (cur) => {
            const halves = applyActionWrite(
              cur,
              actionWrite({
                separateWatchHalf: watchHalfIsSeparate(lesson, true),
                shipped: !cur?.action_completed_at,
                existing: cur,
                now: new Date().toISOString(),
              }),
            );
            return halves ? { done: false, discord_message_link: cur?.discord_message_link ?? null, ...halves } : null;
          });
          return null;
        };

        const markWatched = (lessonId: string) => {
          const lesson = byId.get(lessonId);
          if (!lesson || !hasActionHalf(lesson)) {
            markDone(lessonId);
            return;
          }
          change(lesson, (cur) => ({
            action_completed_at: null,
            discord_message_link: null,
            done: false,
            ...cur,
            completed_at: cur?.completed_at ?? new Date().toISOString(),
          }));
        };

        return { completions, saveDiscordLink, toggleLessonAction, markWatched };
      },
    };
  }, [rows]);
}
