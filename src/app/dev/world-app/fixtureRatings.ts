"use client";

import { useEffect, useMemo, useState } from "react";
import type { StudentContextType } from "@/contexts/StudentContext";
import type { CatalogLessonLike } from "@/lib/world/catalog";
import { RATING_WORDS, checkRatingInput, ratingRefusal } from "@/lib/world/lesson-rating";

/**
 * The pretend student's lesson ratings, for /dev/world-app
 * (FixtureStudentProvider.tsx; admin rebuild 2, D10). In memory, no request
 * of any kind: rateLesson answers a moment later the way POST
 * /api/student/rate-lesson does, by the same checks and in the same words
 * (src/lib/world/lesson-rating.ts), with the provider's own watched and done
 * sets standing in for the student's completions.
 *
 *   ?rating=saved    a1l01 comes rated 4 stars with a comment, and a1l02 5
 *                    stars with none (they show where the ?p= preset has
 *                    them done, as on /world)
 *   ?rating=refuse   every save is refused with the route's 500 sentence
 *   ?rating=offline  every save gets StudentContext's "no answer" sentence
 *   ?rating=slow     every save takes 4 seconds, so "Saving…" can be seen
 *
 * Without it nothing is rated and every save that the rule allows is kept.
 *
 * For the browser run (world-tests/lesson-rating.mjs):
 * window.__fixtureRatings.saved() is every rating held now, by lesson id, and
 * window.__fixtureRatings.calls every save asked for, oldest first.
 */

type Rating = { stars: number; comment: string | null };
type Mode = "plain" | "saved" | "refuse" | "offline" | "slow";

/** StudentContext's own sentence when the route never answered. */
const NO_ANSWER = "Couldn't reach the server. Nothing was saved, so try again.";

const SAVED: ReadonlyArray<[string, Rating]> = [
  ["a1l01", { stars: 4, comment: "Clear and short. The example ad at the end helped the most." }],
  ["a1l02", { stars: 5, comment: null }],
];

function modeOf(search: string | null): Mode {
  const v = search === null ? null : new URLSearchParams(search).get("rating");
  return v === "saved" || v === "refuse" || v === "offline" || v === "slow" ? v : "plain";
}

export interface FixtureRatingCall {
  lessonId: string;
  stars: number;
  comment: string | null;
  answer: string | null;
}

type FixtureRatingsWindow = Window & {
  __fixtureRatings?: { saved(): Record<string, Rating>; calls: FixtureRatingCall[] };
};

export interface FixtureRatings {
  lessonRatings: Map<string, Rating>;
  /** The context's rateLesson, given the catalog and the student's watched and done lessons. */
  rateFor(
    lessons: readonly CatalogLessonLike[],
    watched: ReadonlySet<string>,
    done: ReadonlySet<string>,
  ): StudentContextType["rateLesson"];
}

export function useFixtureRatings(search: string | null): FixtureRatings {
  const mode = modeOf(search);
  const [changes, setChanges] = useState<ReadonlyMap<string, Rating>>(() => new Map());
  const [calls] = useState<FixtureRatingCall[]>(() => []);

  const lessonRatings = useMemo(
    () => new Map<string, Rating>([...(mode === "saved" ? SAVED : []), ...changes]),
    [mode, changes],
  );

  useEffect(() => {
    const w = window as FixtureRatingsWindow;
    w.__fixtureRatings = { saved: () => Object.fromEntries(lessonRatings), calls };
    return () => {
      delete w.__fixtureRatings;
    };
  }, [lessonRatings, calls]);

  return useMemo(
    () => ({
      lessonRatings,
      rateFor(lessons, watched, done) {
        const byId = new Map(lessons.map((l) => [l.id, l]));
        return async (lessonId, stars, comment) => {
          await new Promise((r) => setTimeout(r, mode === "slow" ? 4000 : 300));
          const answer = (() => {
            if (mode === "refuse") return RATING_WORDS.saveFailed;
            if (mode === "offline") return NO_ANSWER;
            const checked = checkRatingInput({ lessonId, stars, comment });
            if (!checked.ok) return checked.error;
            const lesson = byId.get(checked.lessonId);
            if (!lesson) return RATING_WORDS.lessonNotFound;
            const refusal = ratingRefusal(lesson, { watched: watched.has(lesson.id), done: done.has(lesson.id) });
            if (refusal) return RATING_WORDS[refusal];
            setChanges((prev) => new Map(prev).set(lesson.id, { stars: checked.stars, comment: checked.comment }));
            return null;
          })();
          calls.push({ lessonId, stars, comment, answer });
          return answer;
        };
      },
    }),
    [lessonRatings, mode, calls],
  );
}
