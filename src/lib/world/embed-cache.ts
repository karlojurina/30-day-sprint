import type { EmbedAnswer, LessonTransport } from "./lesson-transport";

/**
 * A lesson's video address, asked for before the click.
 *
 * WHY. After a click the lesson page used to show its loading box, only then
 * ask the server for the lesson's embed address, and only after that answer
 * put the video's frame on the page. With this in front of the transport the
 * map asks while the student is still choosing (a place opening, the card
 * showing the next lesson, the pointer on a row), and the lesson page's own
 * ask is answered from here, so the frame goes up at once.
 *
 * THE RULES.
 *   - One request per lesson at a time: a second ask while one is on its way
 *     gets the same promise.
 *   - A `ready` answer is kept: the 40 lessons asked for last, the oldest
 *     dropped first.
 *   - Any other answer (not recorded, blocked, an error, a request that threw)
 *     is not kept, so the next ask goes to the server again.
 *   - At most 3 prefetches on their way at once. One beyond that is skipped,
 *     never queued: the student's own click always goes through.
 *   - Everything else on the transport (the heartbeat, the claim) passes
 *     straight through.
 *
 * A KEPT ADDRESS NEVER OUTLIVES THE RIGHT TO IT. With Tella the address is
 * the video (tella.ts), and the server hands it out only to an active member.
 * So the cache empties itself completely, requests on their way included
 * (their answers are then never kept), when:
 *   - the student changes, or signs out (setAccess with another id, or null);
 *   - the membership is anything but active (setAccess with active false).
 *     While it is not active nothing is kept and nothing is prefetched; a
 *     click still asks the server, which answers "blocked";
 *   - its oldest address is more than 30 minutes old. Then every lesson is
 *     asked for again.
 * It starts with no student and not active: until setAccess says otherwise it
 * keeps nothing and prefetches nothing. useLessonTransport.ts calls it.
 *
 * It holds no React and reads no window, so client-tests/embed-cache.test.mjs
 * runs it under Node as it is.
 */

/** Ready answers kept, at most. */
export const EMBED_CACHE_SIZE = 40;

/** Prefetches on their way at once, at most. */
export const PREFETCH_IN_FLIGHT = 3;

/** The oldest a kept address may be before the whole cache is emptied. */
export const EMBED_MAX_AGE_MS = 30 * 60 * 1000;

export interface CachedLessonTransport extends LessonTransport {
  /**
   * Ask for a lesson's address ahead of the click and keep it if it is ready.
   * Nothing to wait for and nothing thrown: it is skipped when the address is
   * already kept or on its way, when 3 prefetches are already out, and while
   * the membership is not active.
   */
  prefetch(lessonId: string): void;
  /**
   * Who is signed in (null: nobody) and whether their membership is active.
   * Another student, or none, empties the cache; not active empties it and
   * keeps it empty. Telling it the same thing again changes nothing.
   */
  setAccess(studentId: string | null, active: boolean): void;
}

export function withEmbedCache(
  transport: LessonTransport,
  /** The clock the 30 minutes are measured on. A test hands in its own. */
  { now = Date.now }: { now?: () => number } = {},
): CachedLessonTransport {
  /** Ready answers and when they were kept, oldest first (a Map keeps the order they were put in). */
  const kept = new Map<string, { answer: EmbedAnswer; at: number }>();
  /** Requests on their way, by lesson. */
  const asking = new Map<string, Promise<EmbedAnswer>>();
  let prefetching = 0;
  /** Whose addresses these are. undefined until the first setAccess. */
  let student: string | null | undefined = undefined;
  let active = false;
  /** Moves on every emptying: an answer to a request made before it is never kept. */
  let generation = 0;

  function empty() {
    kept.clear();
    asking.clear();
    generation += 1;
  }

  /** Empty everything once the oldest kept address is past 30 minutes. */
  function expire() {
    const oldest = kept.values().next().value;
    if (oldest !== undefined && now() - oldest.at > EMBED_MAX_AGE_MS) empty();
  }

  function keep(lessonId: string, answer: EmbedAnswer) {
    kept.delete(lessonId);
    kept.set(lessonId, { answer, at: now() });
    while (kept.size > EMBED_CACHE_SIZE) {
      const oldest = kept.keys().next().value;
      if (oldest === undefined) break;
      kept.delete(oldest);
    }
  }

  function request(lessonId: string): Promise<EmbedAnswer> {
    const made = generation;
    // Only this request's own entry: one made after an emptying may be there now.
    const forget = () => {
      if (asking.get(lessonId) === pending) asking.delete(lessonId);
    };
    // The call is made one microtask later, so a transport that throws as it
    // is called is a rejected promise like any other, and is never left
    // behind in `asking`.
    const pending: Promise<EmbedAnswer> = Promise.resolve()
      .then(() => transport.getEmbed(lessonId))
      .then(
        (answer) => {
          forget();
          if (answer.ok && active && made === generation) keep(lessonId, answer);
          return answer;
        },
        (error: unknown) => {
          forget();
          throw error;
        },
      );
    asking.set(lessonId, pending);
    return pending;
  }

  function ask(lessonId: string): Promise<EmbedAnswer> {
    expire();
    const have = kept.get(lessonId);
    if (have) return Promise.resolve(have.answer);
    return asking.get(lessonId) ?? request(lessonId);
  }

  const release = () => {
    prefetching -= 1;
  };

  return {
    getEmbed: ask,
    heartbeat: transport.heartbeat,
    claim: (lessonId) => transport.claim(lessonId),
    prefetch(lessonId) {
      expire();
      if (!active) return;
      if (kept.has(lessonId) || asking.has(lessonId)) return;
      if (prefetching >= PREFETCH_IN_FLIGHT) return;
      prefetching += 1;
      // Both ways: a failed prefetch is forgotten, never an unhandled rejection.
      request(lessonId).then(release, release);
    },
    setAccess(studentId, isActive) {
      if (studentId !== student || !isActive) empty();
      student = studentId;
      active = isActive;
    },
  };
}
