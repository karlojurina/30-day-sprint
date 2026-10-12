"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { useStudent } from "@/contexts/StudentContext";
import {
  attachTellaPlayer,
  type TellaPlayerHandle,
} from "@/lib/world/tella-player";
import {
  createWatchHeartbeat,
  type HeartbeatResult,
  type WatchHeartbeat,
} from "@/lib/world/watch-heartbeat";
import {
  realLessonTransport,
  type ClaimAnswer,
  type EmbedAnswer,
  type LessonTransport,
} from "@/lib/world/lesson-transport";
import type { StudentLessonWatch } from "@/types/database";
import u from "@/components/world/world-ui.module.css";

/**
 * A lesson video, played in the app, measured while it plays.
 *
 * This replaces the single most-repeated interaction in the old product: a
 * card that opened whop.com in a new tab. The app has never played a second of
 * video or measured a second of watching, which is why "did they actually do
 * the course" has only ever been answerable from Whop's own sync.
 *
 * Three jobs, in order of how badly each fails if it is wrong:
 *
 *   1. Never show a video to someone who should not see it. The address comes
 *      from /api/student/lesson-video, which checks membership and reads the
 *      video's id from a table no browser can read. This component is handed
 *      one address, for one lesson, and knows no id of its own.
 *   2. Resume where the student left off. Anything else is a tax on every
 *      lesson longer than one sitting.
 *   3. Report what was watched, honestly and cheaply. See watch-heartbeat.ts.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: decide that a lesson is complete. Once a
 * heartbeat comes back saying the 95% point is reached, it asks a route that
 * re-reads the telemetry server-side and applies the played-seconds floor. A
 * component cannot be trusted with that and is not asked to be. It keeps
 * asking until the answer is yes, and when the answer is no it says so under
 * the progress line.
 *
 * IT NEVER TAKES A VIDEO DOWN. A player that has said nothing 12 seconds after
 * its frame was put on the page gets a line under it saying it did not load,
 * and the frame stays where it is. On a slow connection that player may still
 * arrive, and the first thing it says removes the line.
 *
 * Seeking is FREE — Lovro's call. Across ~145 lessons a seek-lock is friction
 * on every honest student to inconvenience a dishonest one for ten seconds.
 * The honesty floor lives server-side instead, where it costs nobody anything.
 *
 * The three calls it makes (the address, the heartbeat, the claim) go through
 * a `LessonTransport`, so the login-free harness can stand in for the server.
 */

const RESUME_THRESHOLD_S = 10;

/**
 * How long the player may stay silent, from the moment its frame is put on the
 * page, before the page says the video did not load. A refused video never
 * says anything.
 *
 * Counted from the frame's mount and not from its `load` event. Measured on
 * the real player over 21 loads: "ready" came BEFORE the frame's `load` in 20
 * of them (by 0.07 to 3.67 s), so `load` is no starting line, and a frame
 * whose `load` never fires (Tella unreachable, a blocker extension) would
 * never have been told on.
 */
const NO_LOAD_MS = 12_000;

/** The least time between two requests to count the same lesson. */
const CLAIM_COOLDOWN_MS = 10_000;

const NO_LOAD_TEXT =
  "This video didn't load. Refresh the page. If it keeps happening, tell the team.";

export interface LessonPlayerProps {
  lessonId: string;
  /** Catalog duration when known. The player reports its own as a fallback. */
  durationSeconds?: number | null;
  /**
   * False when the catalog already knows there is no video behind this lesson.
   * The player then shows "Not recorded yet." and asks the server for nothing.
   */
  recorded?: boolean;
  /**
   * Fires after the SERVER has confirmed the lesson complete — never on the
   * player's own reckoning. `newAchievements` is whatever the completion chain
   * unlocked, for the caller to celebrate.
   */
  onCompleted?: (lessonId: string, newAchievements: string[]) => void;
  /**
   * What the player talks to. Left out everywhere but the development
   * harness, which passes a stand-in for the server.
   */
  transport?: LessonTransport;
  className?: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; embedUrl: string }
  | { kind: "not-recorded" }
  | { kind: "blocked" }
  | { kind: "error"; message: string };

/** What the server said when it would not count the lesson for too little played. */
interface Refusal {
  playedRatio: number;
  playedFloor: number;
}

/** Where to pick up: the last position, unless it is near the start or the lesson is past 95%. */
function resumePoint(row: StudentLessonWatch | undefined): number {
  if (!row || row.threshold_met_at) return 0;
  const last = Number(row.last_position_seconds ?? 0);
  return isFinite(last) && last > RESUME_THRESHOLD_S ? last : 0;
}

/**
 * How full the progress line starts: where a reopened lesson will pick up, as
 * a share of its length. The catalog's length, or failing that the one the
 * player reported on the earlier visit, which is the order the line uses once
 * the video plays. 0 when there is nothing to resume or no length is known.
 */
function resumeFraction(
  resumeAt: number,
  durationSeconds: number | null,
  row: StudentLessonWatch | undefined,
): number {
  const d = durationSeconds ?? Number(row?.reported_duration_seconds ?? 0);
  return resumeAt > 0 && isFinite(d) && d > 0 ? Math.min(1, resumeAt / d) : 0;
}

function notCountedText({ playedRatio, playedFloor }: Refusal): string {
  // Rounded down, so it can never read "80%" against a floor of 80% it has not met.
  const watched = Math.floor(playedRatio * 100);
  const needed = Math.round(playedFloor * 100);
  return `Not marked as watched yet. You've watched ${watched}% of this lesson and it needs ${needed}%. Skipped parts don't count.`;
}

export function LessonPlayer(props: LessonPlayerProps) {
  // Keyed on the lesson: a different lesson is a different player. Nothing
  // carries over from the last one (the load state, the resume point, what
  // was already asked of the server), and no effect has to reset it.
  return <LessonVideo key={props.lessonId} {...props} />;
}

function LessonVideo({
  lessonId,
  durationSeconds = null,
  recorded = true,
  onCompleted,
  transport = realLessonTransport,
  className,
}: LessonPlayerProps) {
  const { watchProgress, completedLessonIds, patchWatchProgress, markWatched } =
    useStudent();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // Beside "ready", never in place of it: the frame loaded and the player has
  // said nothing for 12 seconds. The frame stays mounted.
  const [noLoad, setNoLoad] = useState(false);
  // The last answer to a claim, kept only while it is a refusal for too
  // little played. It is what the note under the progress line reads.
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // Read once at mount so a refresh mid-lesson cannot move the resume point
  // under the student's feet.
  const [resumeAt] = useState(() => resumePoint(watchProgress.get(lessonId)));
  // The line starts where the lesson will pick up. It used to start at 0 on a
  // reopened lesson and jump when play was pressed, which read as "nothing
  // watched" until then.
  const [playedPct, setPlayedPct] = useState(() =>
    resumeFraction(resumeAt, durationSeconds, watchProgress.get(lessonId)),
  );

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const beatRef = useRef<WatchHeartbeat | null>(null);
  const resumedRef = useRef(false);
  const completedRef = useRef(false);
  const claimInFlightRef = useRef(false);
  const lastClaimAtRef = useRef<number | null>(null);
  /**
   * The one timer for a claim that was held back. It is made, and ended, by
   * the mount effect below; null before that effect runs and after unmount, so
   * nothing can be scheduled then.
   */
  const claimTimerRef = useRef<{ arm(waitMs: number): void; clear(): void } | null>(null);
  /** That timer came due while an answer was still on its way. */
  const claimOwedRef = useRef(false);

  /**
   * Ask the server to count the lesson as watched.
   *
   * The player does NOT decide this. The route re-reads student_lesson_watch —
   * the table no browser can write — and applies the played-seconds floor
   * itself. All this does is ask, and reflect the answer.
   *
   * IT KEEPS ASKING. It used to ask once, on the single heartbeat the server
   * marked as the crossing. When that one answer was no (the usual cause: the
   * student dragged to the end first and watched properly afterwards) nothing
   * asked again, on that visit or after a reload. Now every accepted heartbeat
   * past the 95% point asks, and so does opening a lesson whose stored row is
   * already past it. Three things hold a request back: an answer still on its
   * way, a lesson already complete, and an attempt less than 10 seconds ago.
   *
   * A REQUEST HELD BACK IS OWED, NOT DROPPED. The heartbeat sent when a video
   * ends is the one most likely to land inside the 10 seconds, and nothing
   * comes after it. Dropped, that lesson stayed uncounted until it was
   * reopened, with the note still showing the earlier, lower figure. So a
   * request held back by an answer in flight or by the 10 seconds sets one
   * timer for the end of the 10 seconds, never a second one, and the request
   * is made then if the lesson is still not complete. The timer is cleared
   * when the lesson completes and when the player unmounts. (The timer itself
   * is in the mount effect, section 4.)
   */
  const claim = useEffectEvent(async () => {
    if (completedRef.current || completedLessonIds.has(lessonId)) return;
    const at = Date.now();
    const wait =
      lastClaimAtRef.current === null
        ? 0
        : lastClaimAtRef.current + CLAIM_COOLDOWN_MS - at;
    if (claimInFlightRef.current || wait > 0) {
      claimTimerRef.current?.arm(wait);
      return;
    }

    claimInFlightRef.current = true;
    lastClaimAtRef.current = at;
    let answer: ClaimAnswer | null = null;
    try {
      answer = await transport.claim(lessonId);
    } catch {
      // A transport that throws is a failed request.
    }
    // Deliberately not a `finally`: the React compiler gives up on a component
    // that has one, and its lint rules then pass this file without reading it.
    claimInFlightRef.current = false;
    const owed = claimOwedRef.current;
    claimOwedRef.current = false;

    if (answer?.completed) {
      completedRef.current = true;
      claimTimerRef.current?.clear();
      setRefusal(null);
      markWatched(lessonId);
      onCompleted?.(lessonId, answer.newAchievements ?? []);
      // The achievements modal listens for this already.
      window.dispatchEvent(new CustomEvent("et:achievements-changed"));
      return;
    }

    // A null answer is a failed request: nothing to show. Any other answer is
    // a refusal. When the floor was not met (usually the student skipped
    // ahead) the note says how far off it is, and they can keep watching.
    if (answer) {
      setRefusal(
        answer.reason === "played_short" &&
          typeof answer.playedRatio === "number" &&
          typeof answer.playedFloor === "number"
          ? { playedRatio: answer.playedRatio, playedFloor: answer.playedFloor }
          : null,
      );
    }

    // The timer came due while this answer was on its way, so the 10 seconds
    // are already up: the request that was owed is made now.
    if (owed) claimTimerRef.current?.arm(0);
  });

  // The callbacks below are Effect Events for one reason: each reads the props
  // and the context as they are when it runs, so none of them is a reason for
  // an effect to run again. An effect that re-ran here would ask for the
  // address a second time or tear the player down in the middle of a lesson.

  const askForEmbed = useEffectEvent(() => transport.getEmbed(lessonId));

  const onBeatResult = useEffectEvent((r: HeartbeatResult) => {
    if (!r.accepted) return;
    patchWatchProgress(lessonId, {
      lesson_id: lessonId,
      max_position_seconds: Number(r.max_position_seconds),
      last_position_seconds: Number(r.last_position_seconds ?? r.max_position_seconds),
      watched_seconds: Number(r.watched_seconds),
      reported_duration_seconds: r.duration_seconds ?? null,
      threshold_met_at: r.threshold_met ? new Date().toISOString() : null,
      last_heartbeat_at: new Date().toISOString(),
    });
    // `threshold_met`, not `threshold_crossed`: the crossing is true on one
    // heartbeat only, and a claim hung on it is made once.
    if (r.threshold_met) void claim();
  });

  const startBeat = useEffectEvent(() =>
    createWatchHeartbeat({
      lessonId,
      durationSeconds,
      rpc: transport.heartbeat,
      onResult: (r) => onBeatResult(r),
    }),
  );

  const showProgress = useEffectEvent(
    (seconds: number, playerDuration: number | null) => {
      const d = durationSeconds ?? playerDuration;
      if (d && d > 0) setPlayedPct(Math.min(1, seconds / d));
    },
  );

  const claimStoredCrossing = useEffectEvent(() => {
    if (!recorded) return;
    // React's development double mount runs this twice. The second run must
    // not read as a heartbeat held back, which would set the timer.
    if (lastClaimAtRef.current !== null) return;
    if (watchProgress.get(lessonId)?.threshold_met_at) void claim();
  });

  // ── 1. Ask for the address ───────────────────────────────────────────
  useEffect(() => {
    // Nothing to ask for a lesson that has not been filmed.
    if (!recorded) return;
    let cancelled = false;

    (async () => {
      let answer: EmbedAnswer;
      try {
        answer = await askForEmbed();
      } catch {
        answer = { ok: false, kind: "error" };
      }
      if (cancelled) return;

      if (answer.ok) {
        setState({ kind: "ready", embedUrl: answer.embedUrl });
      } else if (answer.kind === "error") {
        setState({
          kind: "error",
          message: answer.message ?? "Could not load the video.",
        });
      } else {
        // "not-recorded" is not an error state: it is every lesson that has
        // not been filmed. "blocked" is a membership that is not active.
        setState({ kind: answer.kind });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recorded]);

  // ── 2. Attach the protocol + the heartbeat ───────────────────────────
  // Keyed on the address, and a LAYOUT effect: it runs in the same commit
  // that puts the frame in the page, before the browser can deliver anything
  // the frame says. This used to happen on the frame's `load`, which left a
  // stretch of time in which the player could speak with nobody listening.
  const embedUrl = state.kind === "ready" ? state.embedUrl : null;
  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!embedUrl || !iframe) return;

    const beat = startBeat();
    beatRef.current = beat;

    // Tella says nothing at all when it refuses a video (a lost lock, a site
    // that is not on its list), so silence is the only signal there is. The
    // player has 12 seconds from here, the moment its frame is on the page,
    // to say something. If it has not, the line goes up under the progress
    // line. The frame is left alone: a slow player can still arrive.
    let spoke = false;
    let noLoadTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      noLoadTimer = null;
      setNoLoad(true);
    }, NO_LOAD_MS);

    // The player said something. Whatever it was, the video is there: the
    // 12 second timer is off, and the line it may already have put up goes.
    const heard = () => {
      if (spoke) return;
      spoke = true;
      if (noLoadTimer !== null) {
        clearTimeout(noLoadTimer);
        noLoadTimer = null;
      }
      setNoLoad(false);
    };

    const player: TellaPlayerHandle = attachTellaPlayer(iframe, {
      onReady: () => {
        heard();
        // Measured on the real player: the seek does not start playback by
        // itself. When the student presses play, it starts there.
        if (!resumedRef.current && resumeAt > 0) {
          resumedRef.current = true;
          player.seekTo(resumeAt);
        }
      },
      onState: (playback) => {
        heard();
        if (playback === "paused") beat.flush("pause");
        else if (playback === "stopped") beat.flush("ended");
      },
      onTimeUpdate: (seconds, playerDuration) => {
        heard();
        beat.tick(seconds, playerDuration);
        showProgress(seconds, playerDuration);
      },
    });

    return () => {
      if (noLoadTimer !== null) clearTimeout(noLoadTimer);
      // The last position, on the way out. A heartbeat that never heard a
      // position has nothing to say and writes nothing.
      beat.flush("unmount");
      beat.destroy();
      beatRef.current = null;
      player.destroy();
    };
  }, [embedUrl, resumeAt]);

  // ── 3. Never lose the last position to a tab close ───────────────────
  useEffect(() => {
    function onHidden() {
      if (document.visibilityState === "hidden") {
        beatRef.current?.flush("visibilitychange");
      }
    }
    function onPageHide() {
      beatRef.current?.flush("pagehide");
    }
    document.addEventListener("visibilitychange", onHidden);
    // iOS Safari is unreliable on visibilitychange; pagehide is the one that
    // actually fires when a phone is backgrounded mid-lesson.
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  // ── 4. A lesson already past 95% that was never counted ──────────────
  // Once, on mount. Without it a student whose only claim was refused on an
  // earlier visit would have to reach a new heartbeat before anything asked.
  // The same effect owns the timer for a claim that was held back: it makes
  // it, and ends it on the way out.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    claimTimerRef.current = {
      arm(waitMs) {
        // Never more than one. And none while a request is already owed to
        // the answer in flight.
        if (timer !== null || claimOwedRef.current) return;
        timer = setTimeout(() => {
          timer = null;
          // The 10 seconds are up and the last answer has still not landed.
          // No second request beside it: it is made the moment that lands.
          if (claimInFlightRef.current) claimOwedRef.current = true;
          else void claim();
        }, Math.max(0, waitMs));
      },
      clear() {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      },
    };
    claimStoredCrossing();
    return () => {
      claimTimerRef.current?.clear();
      claimTimerRef.current = null;
    };
  }, []);

  // ── Render ───────────────────────────────────────────────────────────
  // The frame and its type are the map's (world-ui.module.css). The tokens
  // they read are set on the lesson page's wrapper (Panel in AreaScreen.tsx).
  const frame = className ? `${u.frame} ${className}` : u.frame;

  if (!recorded || state.kind === "not-recorded") {
    return (
      <div className={frame}>
        <Centered>Not recorded yet.</Centered>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className={frame}>
        <Centered>Loading…</Centered>
      </div>
    );
  }

  if (state.kind === "blocked") {
    return (
      <div className={frame}>
        <Centered>Your membership is inactive, so this lesson is locked.</Centered>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className={frame}>
        <Centered>{state.message}</Centered>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className={u.frame}>
        <iframe
          ref={iframeRef}
          src={state.embedUrl}
          title="Lesson video"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          className={u.frameVideo}
        />
      </div>
      {/* The app's own progress line. Tella's scrub bar is inside the iframe
          and says nothing about how much of the LESSON is done. */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(playedPct * 100)}
        aria-label="Lesson progress"
        className={u.bar}
      >
        <div className={u.barFill} style={{ transform: `scaleX(${playedPct})` }} />
      </div>
      {/* The player has said nothing for 12 seconds. The frame above stays. */}
      {noLoad && (
        <p role="status" className={u.barNote}>
          {NO_LOAD_TEXT}
        </p>
      )}
      {/* Shown while the last answer to a claim is "not enough of it was
          played" and the lesson is still not complete. */}
      {refusal !== null && !completedLessonIds.has(lessonId) && (
        <p role="status" className={u.barNote}>
          {notCountedText(refusal)}
        </p>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className={u.frameNote}>{children}</div>;
}
