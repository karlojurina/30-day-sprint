/**
 * When is a watch lesson done?
 *
 * TWO numbers, deliberately kept in DIFFERENT places, because they answer
 * different questions and are trusted differently:
 *
 *   POSITION >= 95%   lives in SQL, inside record_lesson_heartbeat. The
 *                     database stamps threshold_met_at itself so the browser
 *                     never gets to assert "I reached the end".
 *
 *   PLAYED   >= 80%   lives here, and is applied by the completion route
 *                     after it RE-READS the telemetry server-side.
 *
 * Why two at all: Lovro's call is FREE SCRUBBING. Across ~145 lessons a
 * seek-lock is friction on every honest student in order to inconvenience a
 * dishonest one for ten seconds. So position alone is trivially satisfiable by
 * dragging the bar to the end. The played-seconds floor is what makes the
 * completion mean something, and it costs an honest viewer nothing: they
 * played the video, so they already have the seconds.
 *
 * The floor is an env var because it is a policy dial, not a constant. If the
 * CSM team finds honest students tripping it (a lesson with a long static
 * intro they legitimately skip, say), it moves without a code change. Setting
 * it to 0 disables the floor entirely, which is how the preview proves the
 * chain quickly without sitting through a 12-minute video.
 */

/** Matches the 0.95 inside record_lesson_heartbeat. Changing one without the other is a bug. */
export const WATCH_POSITION_THRESHOLD = 0.95;

export const WATCH_PLAYED_FLOOR = (() => {
  const raw = process.env.WATCH_PLAYED_FLOOR;
  if (raw === undefined || raw.trim() === "") return 0.8;
  const n = Number(raw);
  // A malformed value must not silently become 0 and disable the floor.
  if (!isFinite(n) || n < 0 || n > 1) {
    console.error(
      `[watch-rules] WATCH_PLAYED_FLOOR=${JSON.stringify(raw)} is not a number in [0,1]; using 0.8`,
    );
    return 0.8;
  }
  return n;
})();

/**
 * Float slack on both comparisons.
 *
 * Not theoretical: (753 * 0.8) / 753 evaluates to 0.7999999999999999 in IEEE
 *754, so a student sitting EXACTLY on the floor is denied the lesson by
 * binary representation alone. A ratio is a float and the thresholds are
 * decimal; the two do not meet cleanly. A nanosecond of slack costs nothing
 * and removes a support conversation nobody could diagnose.
 */
const RATIO_EPSILON = 1e-9;

export interface WatchRow {
  max_position_seconds: number | string | null;
  watched_seconds: number | string | null;
  reported_duration_seconds: number | string | null;
  threshold_met_at: string | null;
}

export interface WatchVerdict {
  complete: boolean;
  /** Why not, for the client and for the logs. Never shown as an error. */
  reason:
    | "complete"
    | "no_watch_row"
    | "no_duration"
    | "position_short"
    | "played_short";
  positionRatio: number;
  playedRatio: number;
  durationSeconds: number | null;
}

/**
 * PostgREST serialises `numeric` as a JSON number, but a driver or a future
 * column-type change could hand back a string. Coercing here means the
 * comparisons below can never become string comparisons, where "9" > "80".
 */
function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : null;
}

/**
 * The server's own reckoning. Takes the catalog duration where it exists,
 * because the player reports its own and the player is the client.
 */
export function judgeWatch(
  row: WatchRow | null,
  catalogDurationSeconds: number | null,
): WatchVerdict {
  if (!row) {
    return { complete: false, reason: "no_watch_row", positionRatio: 0, playedRatio: 0, durationSeconds: null };
  }

  // v97: the CATALOG's duration only. `reported_duration_seconds` is written
  // by the browser through the heartbeat RPC, so falling back to it let the
  // client choose its own denominator — send 1, play 1 second, complete a
  // 24-minute lesson. It is kept on the row for display and diagnostics and
  // is deliberately not consulted here.
  //
  // This means a lesson with a video but no duration_seconds cannot be
  // completed. That is the correct failure: blocking a completion is
  // recoverable, forging one is not. PRD 2's Bunny sync is what fills it.
  const duration = catalogDurationSeconds;
  if (duration === null || duration <= 0) {
    return { complete: false, reason: "no_duration", positionRatio: 0, playedRatio: 0, durationSeconds: null };
  }

  const maxPos = num(row.max_position_seconds) ?? 0;
  const played = num(row.watched_seconds) ?? 0;
  const positionRatio = maxPos / duration;
  const playedRatio = played / duration;

  // threshold_met_at is the database's own stamp. Trust it over recomputing
  // the position ratio, so a later duration correction cannot un-complete a
  // lesson a student already finished.
  const positionOk =
    row.threshold_met_at !== null ||
    positionRatio >= WATCH_POSITION_THRESHOLD - RATIO_EPSILON;

  if (!positionOk) {
    return { complete: false, reason: "position_short", positionRatio, playedRatio, durationSeconds: duration };
  }
  if (playedRatio < WATCH_PLAYED_FLOOR - RATIO_EPSILON) {
    return { complete: false, reason: "played_short", positionRatio, playedRatio, durationSeconds: duration };
  }
  return { complete: true, reason: "complete", positionRatio, playedRatio, durationSeconds: duration };
}
