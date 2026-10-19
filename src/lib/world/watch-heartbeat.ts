"use client";

import { createClient } from "@/lib/supabase-browser";
import { createCallGate } from "@/lib/call-gate";
import { WATCH_SPEED_CAP } from "./tella";

/**
 * Turns the player's firehose into a survivable number of database writes.
 *
 * MEASURED, not guessed: Tella's player reports its position every 250 ms
 * while it plays (2026-10-12, longest gap 252 ms), which is ~2,880 reports
 * for one 12-minute lesson. Writing those would be 2,880 rows of pressure per
 * lesson view, per student. At a 15s throttle it is ~50 writes, and a student
 * who loses power mid-lesson loses at most 15 seconds of position. Normal
 * exits (pause, ended, tab hidden, navigation) force an immediate write, so
 * only a crash costs anything at all.
 *
 * WHAT THE SERVER DOES WITH THIS, so the numbers here are not misread:
 * `record_lesson_heartbeat` treats every field as hostile. It re-derives the
 * student from auth.uid(), clamps position into [0, duration], clamps the
 * played-seconds delta to WATCH_SPEED_CAP times the wall-clock time that
 * actually elapsed, and refuses beats less than 5s apart unless they are
 * forced or would cross the 95% threshold. Nothing here can make a lesson
 * complete that was not watched; this module's job is fidelity and frugality,
 * not trust.
 */

/**
 * THE PER-REPORT RULE. A forward step between two position reports is played
 * time when the clock allows it: the video may not move faster than
 * WATCH_SPEED_CAP times the clock. Anything larger is a skip, and anything
 * backwards is a scrub.
 *
 * It is kept as an ALLOWANCE THAT CARRIES OVER. Every report adds the clock
 * seconds since the last one, times the speed cap, to a budget. A forward
 * step counts when it fits in the budget, and then uses it up. A step that
 * does not fit counts for nothing and leaves the budget as it is.
 *
 * The first version judged each gap alone ("this step against this gap").
 * That fails the moment the page is busy: when the main thread is held for
 * more than a quarter second, two queued reports are handled back to back,
 * the second sees a gap near 0 and an allowance of only the slack, and its
 * step is refused. Reproduced with this module: at 1.5x with a 1 s stall
 * every 5 s, 80.4% of the watching was credited. The clock time of the stall
 * was real; with a budget it is still there for the reports that follow.
 *
 * Before that it was "a step of at most 1.5s", which counts VIDEO seconds
 * with no clock in it. That was right at 1x and silently wrong above it: the
 * server credited at most the clock seconds that had passed, so a lesson
 * watched at 2x banked half of itself and could never reach the played floor.
 *
 * Measured on Tella's player (2026-10-12), reports 250 ms apart:
 *   1x    step 0.25 s
 *   2x    step 0.503 s (largest 0.521)
 *   2.5x  step 0.621 s (largest 0.643)
 * A report adds 0.25 * 2.5 = 0.625 s to the budget, so every speed on the
 * player's menu counts, and a +20 s skip, which arrives as one step, does not.
 *
 * The budget starts at 0.35 s with the first report and after a seek: room
 * for a report that lands a little early. It never holds more than 5.35 s
 * (2 s of clock at the top speed, plus that start), however long nothing was
 * reported. A tab that was asleep, or a long pause, cannot be turned into a
 * skip of more than that.
 */
const BUDGET_START_S = 0.35;
const BUDGET_MAX_S = 5.35;
/** Float slack on "does the step fit": 0.1 + 0.2 is not 0.3. */
const BUDGET_EPSILON_S = 1e-9;

/**
 * A FORCED beat that fails is sent again after these waits, then given up.
 * Forced beats are the ones nothing follows (the pause, the end of the video,
 * the tab going away), so a failed one used to be the last word: the beat at
 * the end of a short lesson is usually the one that crosses 95%, and when it
 * failed nothing was sent again while the student stayed on the page.
 */
const RETRY_AFTER_MS = [2_000, 5_000, 10_000];

/**
 * How many reports in a row may fail before the caller is told the watching
 * isn't being saved (onSaveTrouble). One or two are a blip the next beat
 * covers, since nothing banked is dropped. Three in a row is a connection or
 * a database call that stays down: 30 seconds of routine beats, or a pause
 * and its first two retries. It used to be silent forever, so a student could
 * watch a whole lesson that never counted and see nothing.
 */
const FAILS_BEFORE_TROUBLE = 3;

/** ~50 writes per full lesson. See the table in the research doc. */
const THROTTLE_MS = 15_000;

/**
 * The most v100's record_lesson_heartbeat credits one beat: 60 s of video
 * (v_max_delta), and 20 s on a lesson's first stored beat (v_first_delta). It
 * also credits no more than 2.5 times the clock since the beat it stored
 * before. So after beats have failed for a while the bank holds more than one
 * beat can deliver, and everything sent used to leave the bank on an accepted
 * answer, credited or not: a lesson watched through a minute of failed beats
 * stopped counting (lessons-1, 2026-10-20). A beat now carries at most these,
 * and only what the answer's total shows was credited leaves the bank. The
 * same numbers live in the migration; changing one without the other is a
 * bug, as for WATCH_SPEED_CAP.
 */
const MAX_BEAT_DELTA_S = 60;
const FIRST_BEAT_DELTA_S = 20;

/** The row's played total in an answer, or null when it is not a number (read as watch-rules.ts reads it). */
function totalOf(r: HeartbeatResult): number | null {
  const v: unknown = r.watched_seconds;
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Hard backstop against a runaway loop, independent of what calls us. Module
 * level on purpose — a per-instance gate resets on every remount and never
 * holds, which is exactly how the 2026-08-27 refresh storm got through.
 * Routine beats are 15s apart and forced beats are event-driven and rare, so
 * 400ms seldom blocks anything real. It can, though: a video that ends within
 * 400ms of a routine beat has its end beat held back here. A forced beat the
 * gate holds back is therefore sent again like one that failed (see
 * RETRY_AFTER_MS), not dropped.
 */
const heartbeatGate = createCallGate("watch-heartbeat", 400);

export interface HeartbeatResult {
  accepted: boolean;
  reason?: string;
  max_position_seconds: number;
  last_position_seconds?: number;
  watched_seconds: number;
  duration_seconds?: number | null;
  threshold_met: boolean;
  /** True on exactly ONE beat per lesson: the one that crossed 95%. */
  threshold_crossed: boolean;
}

/** Which beat an answer belongs to. */
export interface HeartbeatBeat {
  /**
   * Why the beat was sent: "throttle", or the reason handed to `flush`
   * ("pause", "ended", "visibilitychange", "pagehide", "unmount"). A retry
   * keeps the reason of the beat it retries.
   */
  reason: string;
  force: boolean;
  /**
   * True when nothing was sent. A forced beat had nothing new to say since
   * the last accepted one, so that one's answer is given again under this
   * beat's name: it is still the answer.
   */
  repeated?: boolean;
}

export interface WatchHeartbeatOptions {
  lessonId: string;
  /** Catalog duration, when known. Trusted over whatever the player reports. */
  durationSeconds?: number | null;
  onResult?: (result: HeartbeatResult, beat: HeartbeatBeat) => void;
  /** Fired once, on the beat the server says crossed the threshold. */
  onThresholdCrossed?: () => void;
  /**
   * Fired with true once FAILS_BEFORE_TROUBLE reports in a row have failed
   * (the call answered an error or threw), and with false on the next report
   * that gets through after that. Any answer gets through, a refusal
   * included: the server heard it. A beat the gate held back, or one with
   * nothing to say, is no report.
   */
  onSaveTrouble?: (failing: boolean) => void;
  /**
   * Stands in for the database call. Default: the real
   * `supabase.rpc("record_lesson_heartbeat", args)`. When this is given, no
   * Supabase client is created at all, so a test or the login-free harness
   * can run the whole module with no network and no session.
   */
  rpc?: (args: {
    p_lesson_id: string;
    p_position_seconds: number;
    p_reported_duration: number | null;
    p_delta_seconds: number;
    p_force: boolean;
  }) => Promise<{ data: HeartbeatResult | null; error: unknown }>;
  /** The clock, in milliseconds. Default `Date.now`. */
  now?: () => number;
}

export interface WatchHeartbeat {
  /** Feed every timeupdate here. Cheap; it only writes on the throttle. */
  tick(positionSeconds: number, playerDuration: number | null): void;
  /** Tell it a seek happened, so the jump is not counted as watch time. */
  noteSeek(positionSeconds: number): void;
  /** Force a write now (pause / ended / tab hidden / unmount). */
  flush(reason: string): void;
  destroy(): void;
}

export function createWatchHeartbeat(
  opts: WatchHeartbeatOptions,
): WatchHeartbeat {
  // Read through, not captured: a test may swap Date.now after this runs.
  const now = opts.now ?? (() => Date.now());

  // The real call. The Supabase client is built on the first write, and only
  // on this path: a heartbeat that was handed its own `rpc` never makes one.
  let supabase: ReturnType<typeof createClient> | null = null;
  const rpc: NonNullable<WatchHeartbeatOptions["rpc"]> =
    opts.rpc ??
    (async (args) => {
      supabase ??= createClient();
      const { data, error } = await supabase.rpc("record_lesson_heartbeat", args);
      return { data: (data as HeartbeatResult | null) ?? null, error };
    });

  let destroyed = false;
  let inFlight = false;
  /**
   * A beat asked for while another is in flight. Without this it was silently
   * DROPPED, and the beat most likely to be dropped is the forced one on
   * pause or tab-hide — the exact write whose whole job is recording the final
   * position. Queue it and run it when the current one lands.
   */
  let pending: { reason: string; retry: boolean } | null = null;

  let position = 0;
  let duration: number | null = opts.durationSeconds ?? null;
  let lastTickPosition: number | null = null;
  /** The clock at the last position report (or seek). What the per-report rule measures from. */
  let lastTickAt = 0;
  /** Video seconds the clock has allowed and no step has used yet. See THE PER-REPORT RULE. */
  let budget = 0;

  /** Real seconds played since the last ACCEPTED write. Never reset on a refusal. */
  let playedSinceWrite = 0;
  /**
   * Starts at 0, so the FIRST timeupdate writes immediately rather than 15s
   * in. Kept deliberately after a test caught it happening by accident: the
   * player emits no timeupdate until playback actually starts, so this beat
   * creates the row and stamps first_played_at at the real moment the student
   * pressed play. It costs one write, carries a zero delta, and makes "did
   * they even start this lesson" answerable for someone who leaves after ten
   * seconds.
   */
  let lastWriteAt = 0;
  let lastSentPosition: number | null = null;
  /** The answer to the last accepted beat. Given again when a forced beat has nothing new to say. */
  let lastAccepted: HeartbeatResult | null = null;
  let crossedFired = false;

  /** The one timer for a failed forced beat, and how many retries that beat has had. */
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retriesUsed = 0;

  /** Reports in a row that failed. Back to 0 on any answer. */
  let failedInARow = 0;

  /** Tells the caller. The caller's trouble never stops the heartbeat. */
  function sayTrouble(failing: boolean) {
    if (destroyed) return;
    try {
      opts.onSaveTrouble?.(failing);
    } catch {
      // As for the other callbacks below: the caller's to handle.
    }
  }

  function stopRetrying() {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    retriesUsed = 0;
  }

  function retryLater(reason: string, wasRetry: boolean) {
    if (destroyed) return;
    // A forced beat of its own (a new pause, the end) starts its own count.
    // Only the retries of one beat are counted against the three.
    if (!wasRetry) retriesUsed = 0;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    if (retriesUsed >= RETRY_AFTER_MS.length) return;
    const wait = RETRY_AFTER_MS[retriesUsed];
    retriesUsed += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      // Whatever is banked by then goes with it: the position and the played
      // seconds are the module's, not the failed beat's.
      void write(true, reason, true);
    }, wait);
  }

  async function write(force: boolean, reason: string, retry = false) {
    if (destroyed) return;
    if (inFlight) {
      // ONLY forced beats are queued. A throttled one that arrives mid-flight
      // is simply dropped: the next timeupdate is ~250ms away and re-checks
      // the throttle, so nothing is lost. Queueing them instead doubled the
      // write count — the ~0.25s of playback that accrues during the in-flight
      // window reads as "something changed", and every write drew a second one
      // straight after it.
      if (force) pending = { reason, retry };
      return;
    }

    // Nothing to say at all: no position has been reported, so the player has
    // not played. Only a forced beat can get here (tab hidden, unmount, a
    // video that never loaded being taken down), and it used to write
    // position 0: a watch row for a lesson that was opened and never started,
    // and, on a lesson already begun, the stored resume point overwritten
    // with 0.
    if (lastTickPosition === null) return;

    // Nothing new to say. Skips the duplicate beats that pause +
    // visibilitychange + pagehide fire within the same few milliseconds.
    const nothingChanged =
      lastSentPosition !== null &&
      Math.abs(position - lastSentPosition) < 0.25 &&
      playedSinceWrite < 0.25;
    // Forced too: pause, visibilitychange and pagehide can all fire within a
    // few milliseconds of each other, and after the first there is genuinely
    // nothing left to tell the server.
    if (nothingChanged) {
      // A forced beat still gets its answer: the last accepted one, which is
      // what the server would say again. Without it the beat at the END of a
      // video has no answer at all when a write landed a moment before it,
      // and the caller cannot tell "the end is not past 95%" from "the end
      // has not been heard about yet".
      if (force && lastAccepted) {
        opts.onResult?.(lastAccepted, { reason, force, repeated: true });
      }
      return;
    }

    if (!heartbeatGate.allow(reason)) {
      if (force) retryLater(reason, retry);
      return;
    }

    // 20 s until a beat of this visit has been accepted (the lesson may have no
    // stored row yet, and the answer to the first has no earlier total to
    // measure against), 60 s after. The rest stays banked for the next beats.
    const sentDelta = Math.min(
      playedSinceWrite,
      lastAccepted ? MAX_BEAT_DELTA_S : FIRST_BEAT_DELTA_S,
    );
    const sentPosition = position;
    inFlight = true;

    let result: HeartbeatResult | null = null;
    try {
      const { data, error } = await rpc({
        p_lesson_id: opts.lessonId,
        p_position_seconds: sentPosition,
        p_reported_duration: duration,
        p_delta_seconds: sentDelta,
        p_force: force,
      });
      if (!error && data) result = data;
    } catch {
      // A call that throws is a call that failed. Handled with the error
      // answer, below.
    }

    try {
      // Moved on ANY completed round trip: accepted, refused or FAILED.
      // Leaving it unmoved on a refusal meant the throttle stayed satisfied
      // and the next timeupdate (~250ms later) tried again immediately — a
      // retry storm of roughly a dozen calls against the server's own 5s
      // limiter. Leaving it unmoved on a failure did the same against a
      // database call that kept erroring: measured, 120 calls in 60 s, held
      // to that only by the 400ms gate. Nothing is lost by waiting: the delta
      // stays banked and the position is retained, so the next beat carries
      // everything this one did.
      lastWriteAt = now();

      if (result === null) {
        // Losing a beat is survivable by design — the next one carries the
        // same position and the accumulated delta. Silent for a blip: a
        // toast on every transient network blip would be worse than the blip.
        // Only FAILS_BEFORE_TROUBLE in a row tell the caller, once.
        // An ordinary beat is tried again by the throttle, 15s on. A forced
        // one has nothing coming after it, so it gets its own retries.
        if (force) retryLater(reason, retry);
        failedInARow += 1;
        if (failedInARow === FAILS_BEFORE_TROUBLE) sayTrouble(true);
        return;
      }

      // The call got through, so whatever a failed forced beat still had to
      // say has now been said, or will be by the throttle.
      stopRetrying();
      if (failedInARow >= FAILS_BEFORE_TROUBLE) sayTrouble(false);
      failedInARow = 0;

      if (result.accepted) {
        // What the server credited: the row's total now, less its total at the
        // last accepted answer. It can be less than was sent (see
        // MAX_BEAT_DELTA_S), and the rest stays banked. The first accepted
        // answer has no earlier total, and what it carried (at most
        // FIRST_BEAT_DELTA_S) is what the server credits a first beat. A total
        // that is not a number counts the whole beat, as before.
        const totalBefore = lastAccepted ? totalOf(lastAccepted) : null;
        const totalNow = totalOf(result);
        const credited =
          totalBefore !== null && totalNow !== null
            ? Math.min(sentDelta, Math.max(0, totalNow - totalBefore))
            : sentDelta;
        lastSentPosition = sentPosition;
        lastAccepted = result;
        // Only now is the delta safely banked. A refused beat keeps it, so a
        // rate-limited write never silently discards watch time.
        playedSinceWrite = Math.max(0, playedSinceWrite - credited);
      }

      opts.onResult?.(result, { reason, force });

      if (result.threshold_crossed && !crossedFired) {
        crossedFired = true;
        opts.onThresholdCrossed?.();
      }
    } catch {
      // Only a callback can throw here. That is the caller's trouble, and it
      // must not stop the heartbeat or pass for a failed beat.
    } finally {
      inFlight = false;
      const queued = pending;
      pending = null;
      // Terminates: the retry runs with pending already cleared, and only a
      // forced beat can re-queue.
      if (queued && !destroyed) void write(true, queued.reason, queued.retry);
    }
  }

  return {
    tick(positionSeconds: number, playerDuration: number | null) {
      if (destroyed) return;
      if (!isFinite(positionSeconds) || positionSeconds < 0) return;

      // The catalog's duration wins; the player's fills in before it is known.
      if (
        duration === null &&
        playerDuration !== null &&
        isFinite(playerDuration) &&
        playerDuration > 0
      ) {
        duration = playerDuration;
      }

      const at = now();
      if (lastTickPosition === null) {
        budget = BUDGET_START_S;
      } else {
        // What the clock allows is added first, whatever the step turns out
        // to be. A clock that stepped backwards adds nothing.
        const gapSeconds = Math.max(0, (at - lastTickAt) / 1000);
        budget = Math.min(budget + gapSeconds * WATCH_SPEED_CAP, BUDGET_MAX_S);

        const delta = positionSeconds - lastTickPosition;
        // Forward, and no further than the budget. Backwards deltas are
        // scrubs and contribute nothing. A step that does not fit is a skip:
        // it counts for nothing, and the budget is left for real playing.
        if (delta > 0 && delta <= budget + BUDGET_EPSILON_S) {
          playedSinceWrite += delta;
          budget = Math.max(0, budget - delta);
        }
      }
      lastTickPosition = positionSeconds;
      lastTickAt = at;
      position = positionSeconds;

      if (at - lastWriteAt >= THROTTLE_MS) {
        void write(false, "throttle");
      }
    },

    noteSeek(positionSeconds: number) {
      if (destroyed) return;
      if (!isFinite(positionSeconds) || positionSeconds < 0) return;
      // Re-anchor so the jump itself is never counted as watch time. The
      // clock is re-anchored with it and the budget starts over: the next
      // report is measured from the seek, so neither a long pause before a
      // seek nor an allowance saved up before it can be spent on whatever
      // comes after.
      lastTickPosition = positionSeconds;
      lastTickAt = now();
      budget = BUDGET_START_S;
      position = positionSeconds;
    },

    flush(reason: string) {
      if (destroyed) return;
      void write(true, reason);
    },

    destroy() {
      destroyed = true;
      stopRetrying();
    },
  };
}
