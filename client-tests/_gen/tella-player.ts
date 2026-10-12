
import { TELLA_ORIGIN } from "./tella.ts";

/**
 * The Tella player protocol, spoken directly over postMessage.
 *
 * WHY NO LIBRARY. The protocol is three messages in and three commands out,
 * each a small object with a `type`, so it is written out here. Measured on
 * the real player on 2026-10-12 (tella_player_prd.md, section 11, rows 1 to
 * 6):
 *
 *   messages in   : ready, playbackState, timeUpdate (and a `pointerDown`
 *                   when the viewer clicks inside the player, which the
 *                   parser drops as an unknown type)
 *   timeUpdate    : every 250 ms while playing (longest gap 252 ms); the step
 *                   is 0.25 s at 1x, 0.50 s at 2x, 0.62 s at 2.5x. None
 *                   arrives before play, not even after a seek
 *   ready         : 1.4 to 3.8 s into the page, just after one
 *                   playbackState "idle" with `duration: 0`. It came BEFORE
 *                   the frame's own `load` event in 20 of 21 loads, so
 *                   nothing may be timed from `load`
 *   the end       : a last timeUpdate just short of the duration, then
 *                   playbackState "stopped" carrying `duration: 0`. NOT
 *                   ALWAYS: on one replay the last message was "paused" at
 *                   the end position and no "stopped" followed. Tell the end
 *                   by position, never by the word (LessonPlayer does)
 *   a refused video: no message at all (the frame shows "No access", or
 *                   Tella's 404 page for an id no video has)
 *   commands out  : play, pause, seek. A seek sent after `ready` does not
 *                   start playback; when play is pressed, playback starts
 *                   there
 *
 * NO "seeked" MESSAGE WAS SEEN. A skip showed up as "stalled", "playing" and
 * then one large step between two timeUpdates (2.96 s to 23.17 s). The
 * heartbeat's per-report rule is what refuses to count that step; nothing
 * here has to.
 *
 * TWO HARDENINGS, both of which matter on a page that will also host other
 * iframes one day:
 *
 *   1. The message must come from THIS iframe's contentWindow, not merely from
 *      a tella.tv origin. Without the source check, any Tella frame on the
 *      page could drive this player's callbacks.
 *   2. The origin is compared whole, with `===`, against TELLA_ORIGIN. A
 *      suffix test would let `https://www.tella.tv.example.com` through.
 */

export type TellaState =
  | "idle"
  | "playing"
  | "paused"
  | "stopped"
  | "seeking"
  | "stalled";

export type TellaMessage =
  | { type: "ready" }
  | {
      type: "playbackState";
      state: TellaState;
      currentTime: number | null;
      duration: number | null;
    }
  | { type: "timeUpdate"; currentTime: number; duration: number | null };

const TELLA_STATES: readonly string[] = [
  "idle",
  "playing",
  "paused",
  "stopped",
  "seeking",
  "stalled",
];

function isTellaState(value: unknown): value is TellaState {
  return typeof value === "string" && TELLA_STATES.includes(value);
}

function readSeconds(value: unknown): number | null {
  return typeof value === "number" && isFinite(value) ? value : null;
}

/** Tella sends `duration: 0` with "stopped", so a duration of 0 or less is no duration. */
function readDuration(value: unknown): number | null {
  return typeof value === "number" && isFinite(value) && value > 0 ? value : null;
}

/**
 * Pure. Accepts an object or a JSON string. Unknown types, non-finite numbers
 * → null. A duration ≤ 0 → null (Tella sends duration 0 with "stopped").
 *
 * A timeUpdate with no usable position is dropped whole: the position is the
 * message. A playbackState keeps its state and carries a null position.
 */
export function parseTellaMessage(data: unknown): TellaMessage | null {
  let raw: unknown = data;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;

  switch (m.type) {
    case "ready":
      return { type: "ready" };
    case "playbackState": {
      if (!isTellaState(m.state)) return null;
      return {
        type: "playbackState",
        state: m.state,
        currentTime: readSeconds(m.currentTime),
        duration: readDuration(m.duration),
      };
    }
    case "timeUpdate": {
      const currentTime = readSeconds(m.currentTime);
      if (currentTime === null) return null;
      return {
        type: "timeUpdate",
        currentTime,
        duration: readDuration(m.duration),
      };
    }
    default:
      return null;
  }
}

export interface TellaPlayerEvents {
  onReady?: () => void;
  onState?: (state: TellaState, seconds: number | null) => void;
  /** Fires every 250 ms while playing. */
  onTimeUpdate?: (seconds: number, duration: number | null) => void;
}

export interface TellaPlayerHandle {
  play(): void;
  pause(): void;
  /** Used once on ready, to resume where the student left off. */
  seekTo(seconds: number): void;
  destroy(): void;
}

/**
 * Listens on window. Accepts a message only when e.origin === TELLA_ORIGIN and
 * e.source === iframe.contentWindow. Commands are posted to TELLA_ORIGIN:
 * {type:"play"}, {type:"pause"}, {type:"seek", time}. A seekTo before "ready"
 * is sent when "ready" arrives.
 *
 * Call it when the frame element mounts, not on the frame's `load`: the
 * listener has to exist before the player can say anything.
 */
export function attachTellaPlayer(
  iframe: HTMLIFrameElement,
  events: TellaPlayerEvents,
): TellaPlayerHandle {
  let destroyed = false;
  let readyFired = false;
  let lastDuration: number | null = null;
  /** A seek asked for before the player was ready. Only the last one is kept. */
  let pendingSeek: number | null = null;

  function send(payload: Record<string, unknown>) {
    if (destroyed) return;
    const win = iframe.contentWindow;
    if (!win) return;
    try {
      // The embed host is fixed, so target it rather than "*": a wildcard
      // would post the message to whatever origin the frame navigated to.
      win.postMessage(payload, TELLA_ORIGIN);
    } catch {
      // A cross-origin frame that has not finished loading can throw here.
      // The next event will re-drive us; nothing to recover.
    }
  }

  function onMessage(e: MessageEvent) {
    if (destroyed) return;
    // Must be OUR frame, not just some Tella frame on the page. A frame with
    // no window yet matches nothing: a message can arrive with a null source,
    // and null would otherwise equal null.
    const win = iframe.contentWindow;
    if (!win || e.source !== win) return;
    if (e.origin !== TELLA_ORIGIN) return;

    const message = parseTellaMessage(e.data);
    if (!message) return;

    switch (message.type) {
      case "ready": {
        if (readyFired) return;
        readyFired = true;
        if (pendingSeek !== null) {
          send({ type: "seek", time: pendingSeek });
          pendingSeek = null;
        }
        events.onReady?.();
        return;
      }
      case "playbackState": {
        if (message.duration !== null) lastDuration = message.duration;
        events.onState?.(message.state, message.currentTime);
        return;
      }
      case "timeUpdate": {
        if (message.duration !== null) lastDuration = message.duration;
        events.onTimeUpdate?.(message.currentTime, lastDuration);
        return;
      }
    }
  }

  window.addEventListener("message", onMessage);

  return {
    play: () => send({ type: "play" }),
    pause: () => send({ type: "pause" }),
    seekTo: (seconds: number) => {
      const time = Math.max(0, seconds);
      if (!readyFired) {
        pendingSeek = time;
        return;
      }
      send({ type: "seek", time });
    },
    destroy: () => {
      destroyed = true;
      window.removeEventListener("message", onMessage);
    },
  };
}
