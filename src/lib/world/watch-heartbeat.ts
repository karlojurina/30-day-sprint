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
 * WATCH_SPEED_CAP times the seconds since the last report, plus a little
 * slack. Anything larger is a skip, and anything backwards is a scrub.
 *
 * It used to be "a step of at most 1.5s", which counts VIDEO seconds with no
 * clock in it. That was right at 1x and silently wrong above it: the server
 * credited at most the clock seconds that had passed, so a lesson watched at
 * 2x banked half of itself and could never reach the played floor.
 *
 * Measured on Tella's player (2026-10-12), reports 250 ms apart:
 *   1x    step 0.25 s
 *   2x    step 0.503 s (largest 0.521)
 *   2.5x  step 0.621 s (largest 0.643)
 * The rule allows 0.25 * 2.5 + 0.35 = 0.975 s at that gap, so every speed on
 * the player's menu counts and a +20 s skip, which arrives as one step, does
 * not.
 *
 * The gap is capped at 2 s. A tab that was throttled or asleep reports late
 * and in one large step; whatever it says, at most 2 * 2.5 + 0.35 = 5.35 s of
 * it is taken as played.
 */
const MAX_TICK_GAP_S = 2;
/** Room for timer jitter: a report that lands a few milliseconds early. */
const TICK_SLACK_S = 0.35;

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
  let pending: { force: boolean; reason: string } | null = null;

  let position = 0;
  let duration: number | null = opts.durationSeconds ?? null;
  let lastTickPosition: number | null = null;
  /** The clock at the last position report (or seek). What the per-report rule measures from. */
  let lastTickAt = 0;

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
      // is simply dropped: the next timeupdate is ~250ms away and re-checks
      // the throttle, so nothing is lost. Queueing them instead doubled the
      // write count — the ~0.25s of playback that accrues during the in-flight
      // window reads as "something changed", and every write drew a second one
      // straight after it.
      if (force) pending = { force: true, reason };
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
    if (nothingChanged) return;

    if (!heartbeatGate.allow(reason)) return;

    const sentDelta = playedSinceWrite;
    const sentPosition = position;
    inFlight = true;
    try {
      const { data, error } = await rpc({
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

      const result = data;
      // Moved on ANY completed round trip, accepted or refused. Leaving it
      // unmoved on a refusal meant the throttle stayed satisfied and the next
      // timeupdate (~250ms later) tried again immediately — a retry storm of
      // roughly a dozen calls against the server's own 5s limiter. Nothing is
      // lost by waiting: the delta stays banked and the position is retained,
      // so the next beat carries everything the refused one did.
      lastWriteAt = now();
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

      const at = now();
      if (lastTickPosition !== null) {
        const delta = positionSeconds - lastTickPosition;
        // Forward, and no further than the clock allows at the top speed.
        // Backwards deltas are scrubs and contribute nothing.
        const allowed =
          Math.min((at - lastTickAt) / 1000, MAX_TICK_GAP_S) * WATCH_SPEED_CAP +
          TICK_SLACK_S;
        if (delta > 0 && delta <= allowed) {
          playedSinceWrite += delta;
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
      // clock is re-anchored with it: the next report is measured from the
      // seek, not from the last report before it, so a long pause before a
      // seek cannot lend its gap to whatever comes after.
      lastTickPosition = positionSeconds;
      lastTickAt = now();
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
