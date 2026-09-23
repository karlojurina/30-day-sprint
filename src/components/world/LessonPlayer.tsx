"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "@/lib/supabase-browser";
import { useStudent } from "@/contexts/StudentContext";
import {
  attachBunnyPlayer,
  type BunnyPlayerHandle,
} from "@/lib/world/bunny-player";
import {
  createWatchHeartbeat,
  type WatchHeartbeat,
} from "@/lib/world/watch-heartbeat";

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
 *   1. Never show a video to someone who should not see it. The URL is minted
 *      server-side per request by /api/student/video-token, which checks
 *      membership. This component cannot construct a playable URL on its own
 *      and does not hold the key that would let it.
 *   2. Resume where the student left off. Anything else is a tax on every
 *      lesson longer than one sitting.
 *   3. Report what was watched, honestly and cheaply. See watch-heartbeat.ts.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: decide that a lesson is complete. It
 * reports the server's own `threshold_crossed` upward via onThresholdCrossed;
 * the completion decision is made by a route that re-reads the telemetry
 * server-side and applies the played-seconds floor. A component cannot be
 * trusted with that and is not asked to be.
 *
 * Seeking is FREE — Lovro's call. Across ~145 lessons a seek-lock is friction
 * on every honest student to inconvenience a dishonest one for ten seconds.
 * The honesty floor lives server-side instead, where it costs nobody anything.
 */

const RESUME_THRESHOLD_S = 10;

export interface LessonPlayerProps {
  lessonId: string;
  /** Catalog duration when known. The player reports its own as a fallback. */
  durationSeconds?: number | null;
  /**
   * Fires after the SERVER has confirmed the lesson complete — never on the
   * player's own reckoning. `newAchievements` is whatever the completion chain
   * unlocked, for the caller to celebrate.
   */
  onCompleted?: (lessonId: string, newAchievements: string[]) => void;
  className?: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; embedUrl: string }
  | { kind: "not-recorded" }
  | { kind: "blocked" }
  | { kind: "error"; message: string };

export function LessonPlayer({
  lessonId,
  durationSeconds = null,
  onCompleted,
  className,
}: LessonPlayerProps) {
  const { watchProgress, patchWatchProgress, markWatched } = useStudent();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [playedPct, setPlayedPct] = useState(0);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<BunnyPlayerHandle | null>(null);
  const beatRef = useRef<WatchHeartbeat | null>(null);
  // Read once at mount so a refresh mid-lesson cannot move the resume point
  // under the student's feet.
  const resumeAtRef = useRef<number>(0);
  const resumedRef = useRef(false);
  const completedRef = useRef(false);

  /**
   * Ask the server to ratify the crossing.
   *
   * The player does NOT decide this. The route re-reads student_lesson_watch —
   * the table no browser can write — and applies the played-seconds floor
   * itself. All this does is ask, and reflect the answer.
   */
  const claimCompletion = useCallback(async () => {
    if (completedRef.current) return;
    completedRef.current = true;
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch("/api/student/lesson-watched", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lessonId }),
      });
      if (!res.ok) {
        completedRef.current = false;
        return;
      }
      const body = await res.json();
      if (!body?.completed) {
        // The floor was not met — usually the student scrubbed to the end.
        // Not an error and not worth a message: they can keep watching and
        // the next crossing will ask again.
        completedRef.current = false;
        return;
      }
      markWatched(lessonId);
      onCompleted?.(lessonId, (body.newAchievements as string[]) ?? []);
      // The achievements modal listens for this already.
      window.dispatchEvent(new CustomEvent("et:achievements-changed"));
    } catch {
      completedRef.current = false;
    }
  }, [lessonId, markWatched, onCompleted]);

  // ── 1. Mint the URL ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    resumedRef.current = false;
    completedRef.current = false;

    const existing = watchProgress.get(lessonId);
    const last = Number(existing?.last_position_seconds ?? 0);
    resumeAtRef.current =
      existing && !existing.threshold_met_at && isFinite(last) && last > RESUME_THRESHOLD_S
        ? last
        : 0;

    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          if (!cancelled) setState({ kind: "error", message: "Not signed in." });
          return;
        }
        const res = await fetch("/api/student/video-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ lessonId }),
        });
        if (cancelled) return;

        if (res.status === 403) {
          setState({ kind: "blocked" });
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          // Not an error state: this is every lesson that has not been filmed.
          if (body?.notRecorded) {
            setState({ kind: "not-recorded" });
            return;
          }
          setState({
            kind: "error",
            message: typeof body?.error === "string" ? body.error : "Could not load the video.",
          });
          return;
        }
        const body = await res.json();
        setState({ kind: "ready", embedUrl: body.embedUrl as string });
      } catch {
        if (!cancelled) {
          setState({ kind: "error", message: "Could not load the video." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // watchProgress is intentionally NOT a dependency: re-minting the URL on
    // every heartbeat would be a request storm, and the resume point is meant
    // to be read once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  // ── 2. Attach the protocol + the heartbeat ───────────────────────────
  const attach = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const beat = createWatchHeartbeat({
      lessonId,
      durationSeconds,
      onResult: (r) => {
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
      },
      onThresholdCrossed: () => {
        void claimCompletion();
      },
    });
    beatRef.current = beat;

    playerRef.current = attachBunnyPlayer(iframe, {
      onReady: () => {
        if (!resumedRef.current && resumeAtRef.current > 0) {
          resumedRef.current = true;
          playerRef.current?.seekTo(resumeAtRef.current);
        }
      },
      onTimeUpdate: (seconds, playerDuration) => {
        beat.tick(seconds, playerDuration);
        const d = durationSeconds ?? playerDuration;
        if (d && d > 0) setPlayedPct(Math.min(1, seconds / d));
      },
      onSeeked: (seconds) => beat.noteSeek(seconds),
      onPause: () => beat.flush("pause"),
      onEnded: () => beat.flush("ended"),
    });
  }, [lessonId, durationSeconds, claimCompletion, patchWatchProgress]);

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

  useEffect(() => {
    return () => {
      beatRef.current?.flush("unmount");
      beatRef.current?.destroy();
      beatRef.current = null;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [lessonId]);

  // ── Render ───────────────────────────────────────────────────────────
  // Styling here is structural only. The design system (W9) and the
  // art-direction conversation set the actual look; nothing below encodes a
  // palette decision that talk has not made yet.
  const frame: React.CSSProperties = {
    position: "relative",
    width: "100%",
    aspectRatio: "16 / 9",
    borderRadius: 12,
    overflow: "hidden",
    background: "rgba(0,0,0,0.6)",
  };

  if (state.kind === "loading") {
    return (
      <div className={className} style={frame}>
        <Centered>Loading…</Centered>
      </div>
    );
  }

  if (state.kind === "not-recorded") {
    return (
      <div className={className} style={frame}>
        <Centered>Not recorded yet.</Centered>
      </div>
    );
  }

  if (state.kind === "blocked") {
    return (
      <div className={className} style={frame}>
        <Centered>Your membership is inactive, so this lesson is locked.</Centered>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className={className} style={frame}>
        <Centered>{state.message}</Centered>
      </div>
    );
  }

  return (
    <div className={className}>
      <div style={frame}>
        <iframe
          ref={iframeRef}
          src={state.embedUrl}
          onLoad={attach}
          title="Lesson video"
          loading="lazy"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        />
      </div>
      {/* The app's own progress line. Bunny's scrub bar is inside the iframe
          and says nothing about how much of the LESSON is done. */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(playedPct * 100)}
        aria-label="Lesson progress"
        style={{ height: 3, marginTop: 8, borderRadius: 2, background: "rgba(255,255,255,0.12)" }}
      >
        <div
          style={{
            height: "100%",
            width: `${playedPct * 100}%`,
            borderRadius: 2,
            background: "currentColor",
            transition: "width 200ms linear",
          }}
        />
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        padding: 16,
        textAlign: "center",
        fontSize: 14,
        opacity: 0.75,
      }}
    >
      {children}
    </div>
  );
}
