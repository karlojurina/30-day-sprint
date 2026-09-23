
import { createClient } from "./stub-supabase.ts";
import { createCallGate } from "./stub-call-gate.ts";

/**
 * Turns the player's firehose into a survivable number of database writes.
 *
 * MEASURED, not guessed: the Bunny player emits timeupdate ~3.7 times a
 * second, which is ~2,817 events for one 12-minute lesson. Writing those would
 * be 2,817 rows of pressure per lesson view, per student. At a 15s throttle it
 * is ~50 writes, and a student who loses power mid-lesson loses at most 15
 * seconds of position. Normal exits (pause, ended, tab hidden, navigation)
 * force an immediate write, so only a crash costs anything at all.
 *
 * WHAT THE SERVER DOES WITH THIS, so the numbers here are not misread:
 * `record_lesson_heartbeat` treats every field as hostile. It re-derives the
 * student from auth.uid(), clamps position into [0, duration], clamps the
 * played-seconds delta to the wall-clock time that actually elapsed, and
 * refuses beats less than 5s apart unless they are forced or would cross the
 * 95% threshold. Nothing here can make a lesson complete that was not watched;
 * this module's job is fidelity and frugality, not trust.
 */

/**
 * A timeupdate gap larger than this is a SEEK, not watching. The player fires
 * ~3.7×/s, so a real gap is ~0.27s; 1.5s leaves generous room for a stuttering
 * tab without ever counting a scrub as watch time. Ported from IntroVideoGate.
 */
const MAX_TICK_DELTA_S = 1.5;

/** ~50 writes per full lesson. See the table in the research doc. */
const THROTTLE_MS = 15_000;

/**
 * Hard backstop against a runaway loop, independent of what calls us. Module
 * level on purpose — a per-instance gate resets on every remount and never
 * holds, which is exactly how the 2026-08-27 refresh storm got through.
 * 400ms cannot block anything real: routine beats are 15s apart and forced
 * beats are event-driven and rare.
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

export interface WatchHeartbeatOptions {
  lessonId: string;
  /** Catalog duration, when known. Trusted over whatever the player reports. */
  durationSeconds?: number | null;
  onResult?: (result: HeartbeatResult) => void;
  /** Fired once, on the beat the server says crossed the threshold. */
  onThresholdCrossed?: () => void;
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
  const supabase = createClient();

  let destroyed = false;
  let inFlight = false;
  /**
   * A beat asked for while another is in flight. Without this it was silently
   * DROPPED, and the beat most likely to be dropped is the forced one on
   * pause or tab-hide — the exact write whose whole job is recording the final
   * position. Queue it and run it when the current one lands.
   */
  let pending: { force: boolean; reason: string } | null = null;

  let position = 0;
  let duration: number | null = opts.durationSeconds ?? null;
  let lastTickPosition: number | null = null;

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
  let crossedFired = false;

  async function write(force: boolean, reason: string) {
    if (destroyed) return;
    if (inFlight) {
      // ONLY forced beats are queued. A throttled one that arrives mid-flight
      // is simply dropped: the next timeupdate is ~270ms away and re-checks
      // the throttle, so nothing is lost. Queueing them instead doubled the
      // write count — the ~0.27s of playback that accrues during the in-flight
      // window reads as "something changed", and every write drew a second one
      // straight after it.
      if (force) pending = { force: true, reason };
      return;
    }

    // Nothing new to say. Skips the duplicate beats that pause +
    // visibilitychange + pagehide fire within the same few milliseconds.
    const nothingChanged =
      lastSentPosition !== null &&
      Math.abs(position - lastSentPosition) < 0.25 &&
      playedSinceWrite < 0.25;
    // Forced too: pause, visibilitychange and pagehide can all fire within a
    // few milliseconds of each other, and after the first there is genuinely
    // nothing left to tell the server.
    if (nothingChanged) return;

    if (!heartbeatGate.allow(reason)) return;

    const sentDelta = playedSinceWrite;
    const sentPosition = position;
    inFlight = true;
    try {
      const { data, error } = await supabase.rpc("record_lesson_heartbeat", {
        p_lesson_id: opts.lessonId,
        p_position_seconds: sentPosition,
        p_reported_duration: duration,
        p_delta_seconds: sentDelta,
        p_force: force,
      });

      if (error || !data) {
        // Losing a beat is survivable by design — the next one carries the
        // same position and the accumulated delta. Deliberately silent: a
        // toast on every transient network blip would be worse than the blip.
        return;
      }

      const result = data as HeartbeatResult;
      // Moved on ANY completed round trip, accepted or refused. Leaving it
      // unmoved on a refusal meant the throttle stayed satisfied and the next
      // timeupdate (~270ms later) tried again immediately — a retry storm of
      // roughly a dozen calls against the server's own 5s limiter. Nothing is
      // lost by waiting: the delta stays banked and the position is retained,
      // so the next beat carries everything the refused one did.
      lastWriteAt = Date.now();
      if (result.accepted) {
        lastSentPosition = sentPosition;
        // Only now is the delta safely banked. A refused beat keeps it, so a
        // rate-limited write never silently discards watch time.
        playedSinceWrite = Math.max(0, playedSinceWrite - sentDelta);
      }

      opts.onResult?.(result);

      if (result.threshold_crossed && !crossedFired) {
        crossedFired = true;
        opts.onThresholdCrossed?.();
      }
    } catch {
      // Same reasoning as the error branch.
    } finally {
      inFlight = false;
      const queued = pending;
      pending = null;
      // Terminates: the retry runs with pending already cleared, and only a
      // forced beat can re-queue.
      if (queued && !destroyed) void write(true, queued.reason);
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

      if (lastTickPosition !== null) {
        const delta = positionSeconds - lastTickPosition;
        // Forward, and small enough to be real playback rather than a jump.
        // Backwards deltas are scrubs and contribute nothing.
        if (delta > 0 && delta <= MAX_TICK_DELTA_S) {
          playedSinceWrite += delta;
        }
      }
      lastTickPosition = positionSeconds;
      position = positionSeconds;

      if (Date.now() - lastWriteAt >= THROTTLE_MS) {
        void write(false, "throttle");
      }
    },

    noteSeek(positionSeconds: number) {
      if (destroyed) return;
      if (!isFinite(positionSeconds) || positionSeconds < 0) return;
      // Re-anchor so the jump itself is never counted as watch time.
      lastTickPosition = positionSeconds;
      position = positionSeconds;
    },

    flush(reason: string) {
      if (destroyed) return;
      void write(true, reason);
    },

    destroy() {
      destroyed = true;
    },
  };
}
