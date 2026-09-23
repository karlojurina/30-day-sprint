import { createHash } from "node:crypto";

/**
 * Bunny Stream embed signing.
 *
 * SERVER ONLY. `BUNNY_STREAM_TOKEN_KEY` is the library's token authentication
 * key — anyone holding it can mint a valid URL for any video in the library,
 * so it must never reach the browser, a client component, or a log line.
 *
 * The formula is Bunny's, verified against the live library on 2026-09-22
 * (see _admin/research/video_hosting_2026-09-22.md): six embed endpoints all
 * returned 403 without a token, a valid token played, and a single tampered
 * byte was rejected.
 *
 *     token = sha256_hex(tokenKey + videoId + expiryUnixSeconds)
 */

/**
 * 4 hours. Long enough that nobody's token dies mid-lesson — the longest
 * lesson measured is 24 minutes, and a student who pauses to actually do the
 * work can leave the tab open for hours. Short enough that a URL pasted into
 * Discord stops working the same day.
 *
 * Note this bounds the EMBED page, not the video segments: a session already
 * playing keeps its HLS segments loading past expiry (measured in W2), which
 * is why the player does not need to re-mint mid-lesson.
 */
export const EMBED_TTL_SECONDS = 4 * 60 * 60;

export interface SignedEmbed {
  embedUrl: string;
  /** Unix seconds. The client uses this only to decide when to re-mint. */
  expires: number;
}

export function signBunnyEmbed(
  libraryId: string,
  videoId: string,
  tokenKey: string,
  ttlSeconds: number = EMBED_TTL_SECONDS,
  now: number = Date.now(),
): SignedEmbed {
  const expires = Math.floor(now / 1000) + ttlSeconds;
  const token = createHash("sha256")
    .update(`${tokenKey}${videoId}${expires}`)
    .digest("hex");

  const url = new URL(
    `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}`,
  );
  url.searchParams.set("token", token);
  url.searchParams.set("expires", String(expires));
  // The app draws its own chrome and its own progress line; Bunny's controls
  // stay for scrubbing and fullscreen, but nothing else from its UI.
  url.searchParams.set("autoplay", "false");
  url.searchParams.set("preload", "false");

  return { embedUrl: url.toString(), expires };
}
