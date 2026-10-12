import type { TellaVideoFacts } from "./tella-lock";

/**
 * Tella's API, the one read the lock check needs.
 *
 * SERVER ONLY. `TELLA_API_KEY` can read and change every video in the
 * workspace, so it must never reach the browser, a client component or a log
 * line. Its only caller is api/cron/check-lesson-videos.
 *
 * Measured on the live API on 2026-10-12: `GET /v1/videos/{id}` answers 200
 * with the video's length and its `settings`; the list endpoint carries
 * neither, so the check is one request per video; the limit is 100 requests
 * a minute, and the caller spaces its calls.
 *
 * NOTHING THROWN FROM HERE NAMES THE VIDEO OR THE KEY. The caller writes the
 * message on the `lesson_videos` row and posts it to Discord, and a Tella id
 * is the video's address. Every message below is written here; an error from
 * the network layer is never passed on in its own words.
 */

const TELLA_API = "https://api.tella.com/v1";

/**
 * One request may take this long, reading the answer included. Without a
 * limit a single stuck request holds the whole lock check until Vercel kills
 * the function, and the check ends having told nobody anything.
 */
const TELLA_TIMEOUT_MS = 10_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * GET https://api.tella.com/v1/videos/{id}, Authorization: Bearer. null on
 * 404; throws on any other non-200. Reads video.durationSeconds and
 * video.settings.{linkScope, allowedEmbedDomains, downloadsEnabled,
 * rawDownloadsEnabled}.
 *
 * Throws after 10 s without a complete answer, and when Tella cannot be
 * reached at all. To the caller these are errors like any other.
 *
 * A 200 this cannot read never comes out as "locked". A missing access level
 * or domain list is handed on as null or empty, which `judgeLock` reports as
 * open. A missing `settings` object or a download switch that is not a
 * boolean throws, because the only other reading is "downloads are off", and
 * that would be a clean verdict about a setting nobody saw.
 */
export async function fetchTellaVideoFacts(
  videoId: string,
  apiKey: string,
): Promise<TellaVideoFacts | null> {
  // One signal for the request and for reading the body: a server that sends
  // its headers and then stalls is cut off by the same 10 s.
  const signal = AbortSignal.timeout(TELLA_TIMEOUT_MS);
  let status: number;
  let body: unknown = null;
  try {
    const res = await fetch(
      `${TELLA_API}/videos/${encodeURIComponent(videoId)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal,
      },
    );
    status = res.status;
    if (status === 200) body = await res.json();
  } catch (err) {
    if (signal.aborted) {
      throw new Error(
        `Tella did not answer within ${TELLA_TIMEOUT_MS / 1000} s.`,
      );
    }
    if (err instanceof SyntaxError) {
      throw new Error("Tella's API answered with something that is not JSON.");
    }
    // Node's own code for the failure (ENOTFOUND, ECONNRESET...) when it has
    // one. Never the error's message, which this file did not write.
    const cause = err instanceof Error ? err.cause : undefined;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? cause.code
        : undefined;
    throw new Error(
      typeof code === "string" && /^[A-Z0-9_]{3,40}$/.test(code)
        ? `Tella could not be reached (${code}).`
        : "Tella could not be reached.",
    );
  }

  if (status === 404) return null;
  if (status !== 200) {
    throw new Error(`Tella's API answered ${status}.`);
  }

  // The video sits under `video`. An answer that is the video itself is read
  // the same way, so a change of envelope does not turn into a false verdict.
  const video = isRecord(body) && isRecord(body.video) ? body.video : body;
  if (!isRecord(video) || !isRecord(video.settings)) {
    throw new Error("Tella's API answered without the video's settings.");
  }
  const settings = video.settings;
  const { downloadsEnabled, rawDownloadsEnabled } = settings;
  if (
    typeof downloadsEnabled !== "boolean" ||
    typeof rawDownloadsEnabled !== "boolean"
  ) {
    throw new Error("Tella's API answered without the video's download settings.");
  }

  return {
    linkScope: typeof settings.linkScope === "string" ? settings.linkScope : null,
    allowedEmbedDomains: Array.isArray(settings.allowedEmbedDomains)
      ? settings.allowedEmbedDomains.filter(
          (d): d is string => typeof d === "string",
        )
      : [],
    downloadsEnabled,
    rawDownloadsEnabled,
    durationSeconds:
      typeof video.durationSeconds === "number" &&
      isFinite(video.durationSeconds) &&
      video.durationSeconds > 0
        ? video.durationSeconds
        : null,
  };
}
