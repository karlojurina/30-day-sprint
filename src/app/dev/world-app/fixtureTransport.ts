"use client";

import { createContext, useContext } from "react";
import { tellaEmbedUrl, WATCH_SPEED_CAP } from "@/lib/world/tella";
import {
  judgeWatch,
  WATCH_PLAYED_FLOOR,
  WATCH_POSITION_THRESHOLD,
} from "@/lib/world/watch-rules";
import type { LessonTransport } from "@/lib/world/lesson-transport";
import type { HeartbeatResult } from "@/lib/world/watch-heartbeat";

/**
 * The stand-in server behind /dev/world-app's lesson page
 * (tella_player_prd.md, section 9 "Harness" and Work Item 4; driven by
 * world-tests/tella-watch.mjs).
 *
 * The real LessonPlayer makes three calls: where is the video, here is how
 * far I am, please count this lesson. Under /world they go to a route, a
 * database function and a route. Here all three are answered in the page,
 * from memory, so the real component can play a real Tella video with no
 * login, no database and no request to this app.
 *
 * WHAT IS A COPY. `heartbeat` is the arithmetic of record_lesson_heartbeat
 * (supabase/migrations/2026_v100_lesson_videos_and_speed.sql), retyped in
 * JavaScript. Nothing pins the two: a change to the SQL has to be made here
 * by hand. `claim` is not a copy. It calls the real judgeWatch.
 *
 * THE VIDEO IDS ARE NOT IN THIS FILE. They come from .env.local through the
 * harness layout (a server component), as a prop. The one id written here is
 * made up and matches no video: it is what "Tella refuses this one" is tested
 * with.
 *
 * COURSE MODE (?catalog=course; course_catalog_prd.md, section 9.H). The
 * three video lessons below are not special there: every lesson of the real
 * course that has a video plays test video 1, when the harness was given the
 * ids. The stand-in holds each of those lessons to the TEST video's length
 * wherever it judges (the heartbeat's 95% point, the claim), because that 67
 * second clip is what plays, so a course lesson watched to the clip's end is
 * done. The catalog rows keep the course's real lengths, so a card, a panel
 * or the lesson page's eyebrow reading "13 min" over a 67 second clip is the
 * course's own number and no fault.
 */

/** The two real test videos and their length, as the layout read them from the environment. */
export interface DevVideos {
  a: string;
  b: string;
  seconds: number;
}

/** The three fixture lessons that get a video when the harness is given two ids. */
export const VIDEO_LESSON_A = "a2l01";
export const VIDEO_LESSON_B = "a2l02";
export const VIDEO_LESSON_MISSING = "a2l03";
export const VIDEO_LESSON_IDS: readonly string[] = [
  VIDEO_LESSON_A,
  VIDEO_LESSON_B,
  VIDEO_LESSON_MISSING,
];

/** Well formed, and no video has it. Tella answers a frame that never speaks. */
const MISSING_VIDEO_ID = "vid_doesnotexist0000000000";

/** record_lesson_heartbeat's constants (v100). */
const MAX_DELTA_S = 60;
const FIRST_DELTA_S = 20;
const MIN_GAP_S = 5;

/** One row of student_lesson_watch, as the stand-in keeps it. */
export interface FixtureWatchRow {
  lesson_id: string;
  max_position_seconds: number;
  last_position_seconds: number;
  watched_seconds: number;
  reported_duration_seconds: number | null;
  heartbeat_count: number;
  first_played_at: string;
  last_heartbeat_at: string;
  threshold_met_at: string | null;
}

/** One call the player made, for the proof script. `at` is Date.now(). */
export type FixtureCall =
  | { at: number; call: "getEmbed"; lessonId: string; ok: boolean }
  | {
      at: number;
      call: "heartbeat";
      lessonId: string;
      position: number;
      delta: number;
      force: boolean;
      accepted: boolean;
      credited: number;
      watched: number;
      met: boolean;
    }
  | {
      at: number;
      call: "claim";
      lessonId: string;
      completed: boolean;
      reason: string;
      playedRatio: number;
    };

type HeartbeatArgs = Parameters<NonNullable<LessonTransport["heartbeat"]>>[0];

export interface FixtureServer {
  transport: LessonTransport;
  /** The watch rows, by lesson id. Live: the same object for as long as the page lives. */
  watch: Record<string, FixtureWatchRow>;
  /** Every call, oldest first. */
  calls: FixtureCall[];
}

export function createFixtureServer(opts: {
  /** null: no lesson has a video, and every question is answered "not recorded". */
  videos: DevVideos | null;
  /** The fixture's own "this lesson is watched" (FixtureStudentProvider). */
  markWatched: (lessonId: string) => void;
  /**
   * Course mode: the ids of the course lessons that have a video. null in
   * every other mode. Asked on each call, because the server is made before
   * the page has read its query string.
   */
  courseVideoLessons?: () => ReadonlySet<string> | null;
}): FixtureServer {
  const { videos, markWatched, courseVideoLessons } = opts;
  const watch: Record<string, FixtureWatchRow> = {};
  const calls: FixtureCall[] = [];

  const videoIds: ReadonlyMap<string, string> = new Map(
    videos
      ? [
          [VIDEO_LESSON_A, videos.a],
          [VIDEO_LESSON_B, videos.b],
          [VIDEO_LESSON_MISSING, MISSING_VIDEO_ID],
        ]
      : [],
  );
  /** The course's video lessons, in course mode with test videos. null otherwise. */
  const course = (): ReadonlySet<string> | null => (videos ? (courseVideoLessons?.() ?? null) : null);
  /** The video behind a lesson, or undefined when it has none. In course mode it is always test video 1. */
  const videoIdOf = (lessonId: string): string | undefined => {
    const lessons = course();
    if (videos && lessons) return lessons.has(lessonId) ? videos.a : undefined;
    return videoIds.get(lessonId);
  };
  /**
   * The length a lesson is held to, never what the player says. The fixture
   * lesson's duration_seconds in the default catalog; the test video's in
   * course mode, for every lesson that plays it (COURSE MODE, at the top).
   */
  const catalogDuration = (lessonId: string): number | null => {
    const lessons = course();
    if (videos && lessons) return lessons.has(lessonId) ? videos.seconds : null;
    return videos && videoIds.has(lessonId) ? videos.seconds : null;
  };

  function beat(a: HeartbeatArgs): { result: HeartbeatResult; credited: number } {
    const now = Date.now();
    const lessonDur = catalogDuration(a.p_lesson_id);
    const prev = watch[a.p_lesson_id];
    const hadThresh = prev !== undefined && prev.threshold_met_at !== null;

    // 3. Duration: the catalog first, then the player's, then what was stored.
    const duration =
      lessonDur ?? (a.p_reported_duration || null) ?? prev?.reported_duration_seconds ?? null;

    // 4. The position, inside the real timeline.
    let position = Math.max(0, a.p_position_seconds);
    if (duration !== null && duration > 0) position = Math.min(position, duration);

    // 5. The played seconds, held to the clock. The first beat for a lesson
    //    has no earlier time to be held by, so it has its own, smaller, cap.
    let elapsed: number | null = null;
    let delta: number;
    let newMax: number;
    if (prev) {
      elapsed = (now - Date.parse(prev.last_heartbeat_at)) / 1000;
      delta = Math.max(0, Math.min(a.p_delta_seconds, elapsed * WATCH_SPEED_CAP, MAX_DELTA_S));
      newMax = Math.max(prev.max_position_seconds, position);
    } else {
      delta = Math.max(0, Math.min(a.p_delta_seconds, FIRST_DELTA_S));
      newMax = position;
    }

    // The 95% point, against the catalog's length only.
    const crosses =
      !hadThresh &&
      lessonDur !== null &&
      lessonDur > 0 &&
      newMax >= WATCH_POSITION_THRESHOLD * lessonDur;

    // 6. The rate limit, never at the cost of the beat that crosses.
    if (prev && elapsed !== null && elapsed < MIN_GAP_S && !a.p_force && !crosses) {
      return {
        credited: 0,
        result: {
          accepted: false,
          reason: "rate_limited",
          max_position_seconds: prev.max_position_seconds,
          watched_seconds: prev.watched_seconds,
          threshold_met: hadThresh,
          threshold_crossed: false,
        },
      };
    }

    // 7. The row.
    const stamp = new Date(now).toISOString();
    const row: FixtureWatchRow = {
      lesson_id: a.p_lesson_id,
      max_position_seconds: newMax,
      last_position_seconds: position,
      watched_seconds: (prev?.watched_seconds ?? 0) + delta,
      reported_duration_seconds: duration ?? prev?.reported_duration_seconds ?? null,
      heartbeat_count: (prev?.heartbeat_count ?? 0) + 1,
      first_played_at: prev?.first_played_at ?? stamp,
      last_heartbeat_at: stamp,
      threshold_met_at: prev?.threshold_met_at ?? (crosses ? stamp : null),
    };
    watch[a.p_lesson_id] = row;

    return {
      credited: delta,
      result: {
        accepted: true,
        max_position_seconds: row.max_position_seconds,
        last_position_seconds: row.last_position_seconds,
        watched_seconds: row.watched_seconds,
        duration_seconds: row.reported_duration_seconds,
        threshold_met: row.threshold_met_at !== null,
        threshold_crossed: row.threshold_met_at !== null && !hadThresh,
      },
    };
  }

  const transport: LessonTransport = {
    async getEmbed(lessonId) {
      const videoId = videoIdOf(lessonId);
      calls.push({ at: Date.now(), call: "getEmbed", lessonId, ok: videoId !== undefined });
      if (videoId === undefined) return { ok: false, kind: "not-recorded" };
      return { ok: true, embedUrl: tellaEmbedUrl(videoId) };
    },

    async heartbeat(args) {
      // The function refuses a lesson with no video (errcode 22023).
      if (videoIdOf(args.p_lesson_id) === undefined) {
        return {
          data: null,
          error: {
            code: "22023",
            message: `record_lesson_heartbeat: ${args.p_lesson_id} is not a playable watch lesson`,
          },
        };
      }
      const { result, credited } = beat(args);
      calls.push({
        at: Date.now(),
        call: "heartbeat",
        lessonId: args.p_lesson_id,
        position: args.p_position_seconds,
        delta: args.p_delta_seconds,
        force: args.p_force,
        accepted: result.accepted,
        credited,
        watched: result.watched_seconds,
        met: result.threshold_met,
      });
      return { data: result, error: null };
    },

    async claim(lessonId) {
      const verdict = judgeWatch(watch[lessonId] ?? null, catalogDuration(lessonId));
      const playedRatio = Number(verdict.playedRatio.toFixed(4));
      calls.push({
        at: Date.now(),
        call: "claim",
        lessonId,
        completed: verdict.complete,
        reason: verdict.reason,
        playedRatio,
      });
      if (!verdict.complete) {
        return {
          completed: false,
          reason: verdict.reason,
          playedRatio,
          playedFloor: WATCH_PLAYED_FLOOR,
        };
      }
      markWatched(lessonId);
      return { completed: true, newAchievements: [] };
    },
  };

  return { transport, watch, calls };
}

/** The harness's transport, handed down by FixtureStudentProvider. */
export const FixtureTransportContext = createContext<LessonTransport | null>(null);

/** undefined outside the harness provider, where the player would use the real calls. */
export function useFixtureTransport(): LessonTransport | undefined {
  return useContext(FixtureTransportContext) ?? undefined;
}
