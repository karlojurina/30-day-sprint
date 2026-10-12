/**
 * Tella, the small shared facts.
 *
 * Pure and safe to import on both sides: no imports, no environment, no
 * network. The server uses it to build a lesson's embed address, the player
 * uses it to know which origin it may listen to, and the heartbeat uses the
 * speed cap.
 *
 * A REAL VIDEO ID IS NEVER WRITTEN IN A TRACKED FILE. With Bunny an id was
 * useless without the signing key. With Tella the id IS the embed address, and
 * this repository is public, so a committed id is a published video. Ids live
 * in `lesson_videos`, a table no browser can read, and leave the server only
 * through /api/student/lesson-video, one lesson at a time, to an active
 * member. They stay out of log lines and out of the lessons payload too.
 */

/** The only origin the player accepts messages from and posts commands to. */
export const TELLA_ORIGIN = "https://www.tella.tv";

/** Video time may not advance faster than this many times the clock. Also a constant in the SQL function; a test pins the two. */
export const WATCH_SPEED_CAP = 2.5;

/** Same pattern as the check constraint on `lesson_videos.tella_video_id`. */
const TELLA_VIDEO_ID = /^vid_[a-z0-9]{10,64}$/;

export function isTellaVideoId(v: unknown): v is string {
  return typeof v === "string" && TELLA_VIDEO_ID.test(v);
}

/**
 * https://www.tella.tv/video/{id}/embed?title=0&b=0&wt=0&a=0&o=1 — throws on a
 * malformed id.
 *
 * The five switches were measured on the real player (2026-10-12): together
 * they hide the creator's name, "Watch on Tella" and "Record your own". The
 * reactions row stays; no setting for it was found.
 *
 * The error never repeats the value it was given: this runs on the server
 * with a real id in hand, and an error message is one stray log line away
 * from a published video.
 */
export function tellaEmbedUrl(videoId: string): string {
  if (!isTellaVideoId(videoId)) {
    throw new Error("tellaEmbedUrl: malformed Tella video id");
  }
  return `${TELLA_ORIGIN}/video/${videoId}/embed?title=0&b=0&wt=0&a=0&o=1`;
}
