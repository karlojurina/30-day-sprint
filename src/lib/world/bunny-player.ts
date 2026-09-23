"use client";

/**
 * The Bunny Stream player protocol, spoken directly over postMessage.
 *
 * WHY NO LIBRARY. Bunny's embed implements player.js. The npm packages for it
 * are a thicket of forks with different maintainers and different bugs, and
 * the Artifact-style CSP on this app blocks arbitrary CDNs anyway. The
 * protocol itself is a JSON envelope and four methods, so it is written out
 * here. Verified against the real library (759916) on 2026-09-22 and
 * re-verified on 2026-09-23 with token auth ON:
 *
 *   methods confirmed  : addEventListener, play, pause, getDuration, setCurrentTime
 *   timeupdate rate    : ~3.7 ticks/second
 *   duration read back : 753.321333s on the test lesson
 *
 * Full record: _admin/research/video_hosting_2026-09-22.md
 *
 * TWO HARDENINGS over the snippet in that document, both of which matter on a
 * page that will also host other iframes one day:
 *
 *   1. The message must come from THIS iframe's contentWindow, not merely from
 *      a mediadelivery.net origin. Without the source check, any
 *      mediadelivery.net frame on the page could drive this player's callbacks.
 *   2. The origin is matched against the exact host or a real subdomain, not with
 *      a bare `endsWith`. `evilmediadelivery.net` satisfies a naive suffix
 *      test; it does not satisfy this one.
 */

const PLAYER_JS_CONTEXT = "player.js";
const PLAYER_JS_VERSION = "0.0.11";

/** Events we subscribe to on ready. `seeked` is what tells the heartbeat a jump happened. */
const SUBSCRIBED_EVENTS = [
  "play",
  "pause",
  "ended",
  "timeupdate",
  "seeked",
] as const;

export interface BunnyPlayerEvents {
  onReady?: (duration: number | null) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  /** Fires ~3.7×/second while playing. */
  onTimeUpdate?: (seconds: number, duration: number | null) => void;
  onSeeked?: (seconds: number) => void;
}

export interface BunnyPlayerHandle {
  play(): void;
  pause(): void;
  /** Used once on ready, to resume where the student left off. */
  seekTo(seconds: number): void;
  destroy(): void;
}

function isBunnyOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "mediadelivery.net" || host.endsWith(".mediadelivery.net");
}

/** timeupdate carries {seconds, duration}; other shapes are tolerated defensively. */
function readSeconds(value: unknown): number | null {
  if (typeof value === "number" && isFinite(value)) return value;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.seconds === "number" && isFinite(v.seconds)) return v.seconds;
  }
  return null;
}

function readDuration(value: unknown): number | null {
  if (typeof value === "number" && isFinite(value) && value > 0) return value;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.duration === "number" && isFinite(v.duration) && v.duration > 0) {
      return v.duration;
    }
  }
  return null;
}

export function attachBunnyPlayer(
  iframe: HTMLIFrameElement,
  events: BunnyPlayerEvents,
): BunnyPlayerHandle {
  let destroyed = false;
  let readyFired = false;
  let lastDuration: number | null = null;

  function send(payload: Record<string, unknown>) {
    if (destroyed) return;
    const win = iframe.contentWindow;
    if (!win) return;
    try {
      win.postMessage(
        JSON.stringify({
          context: PLAYER_JS_CONTEXT,
          version: PLAYER_JS_VERSION,
          ...payload,
        }),
        // The embed host is fixed, so target it rather than "*": a wildcard
        // would post the message to whatever origin the frame navigated to.
        "https://iframe.mediadelivery.net",
      );
    } catch {
      // A cross-origin frame that has not finished loading can throw here.
      // The next event will re-drive us; nothing to recover.
    }
  }

  function onMessage(e: MessageEvent) {
    if (destroyed) return;
    // Must be OUR frame, not just some mediadelivery.net frame on the page.
    if (e.source !== iframe.contentWindow) return;
    if (!isBunnyOrigin(e.origin)) return;

    let data: { context?: string; event?: string; value?: unknown };
    try {
      data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (!data || data.context !== PLAYER_JS_CONTEXT) return;

    switch (data.event) {
      case "ready": {
        if (readyFired) return;
        readyFired = true;
        for (const name of SUBSCRIBED_EVENTS) {
          send({ method: "addEventListener", value: name, listener: `L_${name}` });
        }
        send({ method: "getDuration", listener: "L_getDuration" });
        events.onReady?.(lastDuration);
        return;
      }
      case "getDuration": {
        const d = readDuration(data.value);
        if (d !== null) lastDuration = d;
        return;
      }
      case "timeupdate": {
        const d = readDuration(data.value);
        if (d !== null) lastDuration = d;
        const s = readSeconds(data.value);
        if (s !== null) events.onTimeUpdate?.(s, lastDuration);
        return;
      }
      case "seeked": {
        const s = readSeconds(data.value);
        if (s !== null) events.onSeeked?.(s);
        return;
      }
      case "play":
        events.onPlay?.();
        return;
      case "pause":
        events.onPause?.();
        return;
      case "ended":
        events.onEnded?.();
        return;
      default:
        return;
    }
  }

  window.addEventListener("message", onMessage);

  return {
    play: () => send({ method: "play" }),
    pause: () => send({ method: "pause" }),
    seekTo: (seconds: number) =>
      send({ method: "setCurrentTime", value: Math.max(0, seconds) }),
    destroy: () => {
      destroyed = true;
      window.removeEventListener("message", onMessage);
    },
  };
}
