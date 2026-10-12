"use client";

import { getAccessToken } from "@/lib/supabase-browser";
import type { WatchHeartbeatOptions } from "@/lib/world/watch-heartbeat";

/**
 * The three calls the lesson player makes, behind one small interface.
 *
 * WHY THIS EXISTS. The player's behaviour (which message it shows, when it
 * asks for the completion, what it does with a refusal) could only be watched
 * by logging in as a paying member against a real database. With the calls
 * gathered here, the login-free harness hands the player a stand-in for the
 * server and the same component runs with a real video and no account.
 *
 * `/world` passes nothing and gets `realLessonTransport`.
 */

export type EmbedAnswer =
  | { ok: true; embedUrl: string }
  | { ok: false; kind: "not-recorded" | "blocked" | "error"; message?: string };

export interface ClaimAnswer {
  completed: boolean;
  /** Why not, in the completion route's own words ("played_short", ...). */
  reason?: string;
  playedRatio?: number;
  playedFloor?: number;
  newAchievements?: string[];
}

export interface LessonTransport {
  /** Where the lesson's video is embedded from, or why there is nothing to play. */
  getEmbed(lessonId: string): Promise<EmbedAnswer>;
  /** The heartbeat's database call. undefined = the real RPC. */
  heartbeat?: WatchHeartbeatOptions["rpc"];
  /** Ask the server to count the lesson as watched. null = the request failed. */
  claim(lessonId: string): Promise<ClaimAnswer | null>;
}

const COULD_NOT_LOAD = "Could not load the video.";

async function post(path: string, token: string, lessonId: string): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ lessonId }),
  });
}

/**
 * POST /api/student/lesson-video and POST /api/student/lesson-watched with the
 * session token; heartbeat undefined.
 *
 * Neither call throws. A failure is an answer the player can show or wait on.
 */
export const realLessonTransport: LessonTransport = {
  async getEmbed(lessonId) {
    try {
      const token = await getAccessToken();
      if (!token) return { ok: false, kind: "error", message: "Not signed in." };

      const res = await post("/api/student/lesson-video", token, lessonId);

      // The membership check. Anything but an active member gets no address.
      if (res.status === 403) return { ok: false, kind: "blocked" };
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Not an error state: this is every lesson that has not been filmed.
        if (body?.notRecorded) return { ok: false, kind: "not-recorded" };
        return {
          ok: false,
          kind: "error",
          message: typeof body?.error === "string" ? body.error : COULD_NOT_LOAD,
        };
      }

      const body = await res.json();
      if (typeof body?.embedUrl !== "string" || !body.embedUrl) {
        return { ok: false, kind: "error", message: COULD_NOT_LOAD };
      }
      return { ok: true, embedUrl: body.embedUrl };
    } catch {
      return { ok: false, kind: "error", message: COULD_NOT_LOAD };
    }
  },

  async claim(lessonId) {
    try {
      const token = await getAccessToken();
      if (!token) return null;

      const res = await post("/api/student/lesson-watched", token, lessonId);
      if (!res.ok) return null;

      const body = await res.json();
      if (!body || typeof body !== "object") return null;
      return {
        completed: body.completed === true,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        playedRatio: typeof body.playedRatio === "number" ? body.playedRatio : undefined,
        playedFloor: typeof body.playedFloor === "number" ? body.playedFloor : undefined,
        newAchievements: Array.isArray(body.newAchievements)
          ? (body.newAchievements as string[])
          : undefined,
      };
    } catch {
      return null;
    }
  },
};
