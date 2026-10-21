/**
 * The student's own clock: whether it is night where they are, and since
 * 2026-10-21 whether it is morning (the owner, 2026-10-20: "if they're
 * watching at night, it's going to be all dark"; 2026-10-21: the night and
 * the morning both, after seeing them). Option D of
 * _admin/prds/map-review-2026-10-15/real_time_light.md, with option B's
 * morning on top: the clock decides two numbers, a night factor and a
 * morning factor, each 0 to 1 (ClockLook). light.ts lays its morning layer
 * and its night layer over the opening and the first six places by them;
 * from 10:00 to 20:00 the map is exactly what it was.
 *
 * On the clock (local time; the numbers live in NIGHT_HOURS and
 * MORNING_HOURS):
 *   05:00 to 06:00   the night fades out onto the morning
 *   06:00 to 09:00   the morning
 *   09:00 to 10:00   the morning fades into the day
 *   10:00 to 20:00   the day, exactly as before the night and the morning
 *   20:00 to 21:00   the night fades in over the day
 *   21:00 to 05:00   the night
 * The morning factor is what lies under the night: 1 from 05:00 to 09:00, so
 * the dawn is the night going off the morning, and 0 from 10:00 to 05:00, so
 * the dusk and the night are the night over the day, as they were. Its one
 * jump, 0 to 1 at 05:00, falls under the full night, where nothing shows it.
 *
 * The time is the student's computer clock with fixed hours (no location, no
 * permission prompt).
 *
 * Where the clock runs: only on the students' map (/world). Every other page
 * (the dev pages, every world test, the poster pipeline) is pinned to day
 * unless its address asks otherwise, so a test run at 2 am grades the frame
 * it always graded. The address can ask, on /world and the dev pages alike:
 *   ?tod=day | morning | night   pinned (day: both 0; morning: the morning 1;
 *                                night: the night 1, over the day)
 *   ?tod=clock                   the computer's clock, as on /world
 *   ?hour=HH | HH.MM             pinned to that hour on the clock (23, 07.30, 20.30)
 * ?tod wins over ?hour; a value that does not parse is ignored.
 *
 * The loading posters follow the same clock: poster.ts has a night twin
 * (2026-10-21) and a morning twin (later the same day) of the opening's and
 * the first six places' posters, and the page shows the set nearest to what
 * the live map shows (posterTod). The page's head picks it before the first
 * paint (CLOCK_BOOT, in src/app/layout.tsx) and writes it on <html>
 * (POSTER_TOD_ATTR), where the stylesheets read it; the map's code writes it
 * again as it mounts and when the clock moves it (markPosterTod,
 * writePosterTod).
 */

/**
 * The night's hours, local time (24 h): 0 by day, rising from duskFrom to
 * duskTo, 1 from duskTo to dawnFrom, falling from dawnFrom to dawnTo. The
 * rise and the fall are smoothsteps, so the dusk deepens slowly at first.
 */
export const NIGHT_HOURS = { duskFrom: 20, duskTo: 21, dawnFrom: 5, dawnTo: 6 } as const;
export type NightHours = { readonly duskFrom: number; readonly duskTo: number; readonly dawnFrom: number; readonly dawnTo: number };

export const CLOCK = {
  /** How often the page reads the clock while it is open (and on becoming visible again). */
  everyMs: 5 * 60 * 1000,
  /**
   * A change eases in over this long when the map is awake (one step of the
   * hour's fade is a twelfth of it); a map asleep takes the new light in the
   * one frame the change wakes.
   */
  easeMs: 1500,
} as const;

/**
 * The night factor at an hour on the clock (0..24, wraps), for night hours
 * `H`. Self-contained (it reads no name from outside itself): the page head's
 * script runs this same source (CLOCK_BOOT).
 */
export function nightAtHours(hour: number, H: NightHours): number {
  if (!Number.isFinite(hour)) return 0;
  const h = ((hour % 24) + 24) % 24;
  const smooth = (t: number) => {
    const x = t < 0 ? 0 : t > 1 ? 1 : t;
    return x * x * (3 - 2 * x);
  };
  if (h >= H.duskTo || h < H.dawnFrom) return 1;
  if (h >= H.dawnTo && h < H.duskFrom) return 0;
  if (h >= H.duskFrom) return smooth((h - H.duskFrom) / (H.duskTo - H.duskFrom));
  return 1 - smooth((h - H.dawnFrom) / (H.dawnTo - H.dawnFrom));
}

/** The night factor at an hour on the clock (0..24, wraps). */
export function nightAt(hour: number): number {
  return nightAtHours(hour, NIGHT_HOURS);
}

/**
 * The morning's hours, local time (24 h). It starts with the night's dawn
 * (NIGHT_HOURS.dawnFrom: the night fades out onto it), is full until
 * fadeFrom and falls to 0 by fadeTo (a smoothstep, as the night's fades).
 */
export const MORNING_HOURS = { fadeFrom: 9, fadeTo: 10 } as const;
export type MorningHours = { readonly fadeFrom: number; readonly fadeTo: number };

/**
 * The morning factor at an hour on the clock (0..24, wraps), for night hours
 * `H` and morning hours `M`: 1 from H.dawnFrom to M.fadeFrom, falling to 0 by
 * M.fadeTo, 0 from there to the next dawn. Self-contained, as nightAtHours:
 * the page head's script runs this same source (CLOCK_BOOT).
 */
export function morningAtHours(hour: number, H: NightHours, M: MorningHours): number {
  if (!Number.isFinite(hour)) return 0;
  const h = ((hour % 24) + 24) % 24;
  if (h < H.dawnFrom || h >= M.fadeTo) return 0;
  if (h < M.fadeFrom) return 1;
  const x = Math.min(1, Math.max(0, (h - M.fadeFrom) / (M.fadeTo - M.fadeFrom)));
  return 1 - x * x * (3 - 2 * x);
}

/** The morning factor at an hour on the clock (0..24, wraps). */
export function morningAt(hour: number): number {
  return morningAtHours(hour, NIGHT_HOURS, MORNING_HOURS);
}

/**
 * What the clock asks of the map: the night factor, and the morning factor
 * under it (0..1 each). The day is { night: 0, morning: 0 }.
 */
export interface ClockLook {
  night: number;
  morning: number;
}

/** The look at an hour on the clock (0..24, wraps). */
export function lookAt(hour: number): ClockLook {
  return { night: nightAt(hour), morning: morningAt(hour) };
}

/** The hour on a date's local clock, with minutes and seconds as a fraction. */
export function hourOf(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

/** What decides the clock's look on this page. */
export type ClockSetting =
  | { kind: "clock" }
  | { kind: "hour"; hour: number }
  | { kind: "day" }
  | { kind: "morning" }
  | { kind: "night" };

/** "23", "8", "20.30", "05.15" (and "20:30"): the hour as a number, or null. Minutes are always two digits. */
export function parseHour(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const m = /^\s*(\d{1,2})(?:[.:](\d{2}))?\s*$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return (h + min / 60) % 24;
}

/**
 * The page's setting from its address. `live` says whether this page follows
 * the computer's clock when the address says nothing (the students' map) or
 * stays pinned to day (every other page).
 */
export function clockSetting(search: string, live: boolean): ClockSetting {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search);
  } catch {
    return live ? { kind: "clock" } : { kind: "day" };
  }
  const tod = q.get("tod");
  if (tod === "day" || tod === "night" || tod === "morning") return { kind: tod };
  if (tod === "clock") return { kind: "clock" };
  const hour = parseHour(q.get("hour"));
  if (hour !== null) return { kind: "hour", hour };
  return live ? { kind: "clock" } : { kind: "day" };
}

/** The look a setting gives at `now`. */
export function lookFor(s: ClockSetting, now: Date): ClockLook {
  switch (s.kind) {
    case "day":
      return { night: 0, morning: 0 };
    case "morning":
      return { night: 0, morning: 1 };
    case "night":
      return { night: 1, morning: 0 };
    case "hour":
      return lookAt(s.hour);
    default:
      return lookAt(hourOf(now));
  }
}

/** The night factor a setting gives at `now` (lookFor's night). */
export function nightFor(s: ClockSetting, now: Date): number {
  return lookFor(s, now).night;
}

/**
 * Calls `onLook` with the look now, then again whenever it changes: read
 * every CLOCK.everyMs and when the tab becomes visible again (a laptop shut
 * overnight). A pinned setting is read once. `now` is for tests. Returns the
 * stop function.
 */
export function watchClock(setting: ClockSetting, onLook: (look: ClockLook) => void, now: () => Date = () => new Date()): () => void {
  let last = lookFor(setting, now());
  onLook(last);
  if (setting.kind !== "clock" || typeof window === "undefined") return () => {};
  const check = () => {
    const l = lookFor(setting, now());
    if (Math.abs(l.night - last.night) < 1e-4 && Math.abs(l.morning - last.morning) < 1e-4) return;
    last = l;
    onLook(l);
  };
  const timer = window.setInterval(check, CLOCK.everyMs);
  const onVisible = () => {
    if (!document.hidden) check();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

// ── The posters' day, morning or night ──────────────────────────────────────

/** Which set of loading posters shows: the day's, the morning twins or the night twins (poster.ts). */
export type PosterTod = "day" | "morning" | "night";

/**
 * While the clock fades, the live map is a blend of two looks, and the page
 * opens on the poster nearest to it. Each line is a factor where the live
 * frame comes nearer the other look's poster, measured on the M2: the live
 * 3D at factors 0 to 1 at 1280 x 720, each frame's mean distance to the two
 * looks' frames. Each is set on the opening, the frame nearly every visit
 * opens on.
 *   night    the night over the day (the dusk, measured 2026-10-21): the
 *            night frame is the nearer from 0.25 (Base Camp to the Mirror
 *            Lake), 0.29 (the Landing) and 0.34 (the opening). Halfway
 *            through the fade (0.5) the light is already 82% night
 *            (light.ts nightWeight). On the clock: the night posters from
 *            20:23:30. Measured again the same way with the morning built
 *            (2026-10-21, steps of 0.02): the opening 0.36, the rest 0.24 to
 *            0.30.
 *   dawn     the night over the morning (05:00 to 06:00, measured the same
 *            day): the opening 0.38, the Landing 0.30, Base Camp to Video Ads
 *            II 0.26 to 0.28, the Mirror Lake 0.36, the forest 0.34. On the
 *            clock: the morning posters from 05:34:51.
 *   morning  the morning over the day (09:00 to 10:00): the opening 0.48
 *            and 0.46 (two runs; the line sits between), the Landing 0.44,
 *            Base Camp to Video Ads II 0.46 to 0.48, the Mirror Lake 0.34,
 *            the forest 0.38. On the clock: the day posters from 09:31:13.
 */
export const POSTER_FROM = { night: 0.34, dawn: 0.38, morning: 0.47 } as const;
export type PosterFrom = { readonly night: number; readonly dawn: number; readonly morning: number };
/** The night's line over the day (POSTER_FROM.night), as the night posters have used it since 2026-10-21. */
export const POSTER_NIGHT_FROM = POSTER_FROM.night;

/**
 * The set for a night factor and the morning factor under it, by the lines
 * `from`: the night's when the night is at its line (over the day the
 * night's, over the morning the dawn's, in between in proportion), else the
 * morning's when the morning is at its line, else the day's. Self-contained:
 * the page head's script runs this same source (CLOCK_BOOT).
 */
export function pickPosterTod(night: number, morning: number, from: PosterFrom): PosterTod {
  const m = Math.min(1, Math.max(0, morning));
  if (night > 0 && night >= from.night + (from.dawn - from.night) * m) return "night";
  return m >= from.morning ? "morning" : "day";
}

/** Which posters show for a look. */
export function posterTod(look: ClockLook): PosterTod {
  return pickPosterTod(look.night, look.morning, POSTER_FROM);
}

/**
 * The attribute on <html> that says which posters show, "day", "morning"
 * or "night": the stylesheets pick the loading card's still, the poster
 * layer's first picture and its blurred preview by it (world-ui.module.css
 * .groundPoster, world.module.css .posterLanding and .poster::before).
 * Absent, the day's.
 */
export const POSTER_TOD_ATTR = "data-world-tod";

/** The students' map: the page, and the pages under it, that follow the clock when the address says nothing (WorldMap's liveClock). */
export const CLOCK_LIVE_BASE = "/world";

/** Writes which posters show to <html> (POSTER_TOD_ATTR). Nothing on the server. */
export function writePosterTod(tod: PosterTod): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(POSTER_TOD_ATTR, tod);
}

/**
 * Which posters this page shows now, by the same rule as the head's script,
 * written to <html> and returned. `live` is the page's own (WorldMap: under
 * CLOCK_LIVE_BASE). For a visit that came in by a link (the login's redirect
 * to /world), where the head's script ran on another page. Nothing on the
 * server (the day there).
 */
export function markPosterTod(live: boolean, now: Date = new Date()): PosterTod {
  if (typeof window === "undefined") return "day";
  const tod = posterTod(lookFor(clockSetting(window.location.search, live), now));
  writePosterTod(tod);
  return tod;
}

interface ClockBootArgs {
  attr: string;
  live: string;
  hours: NightHours;
  morning: MorningHours;
  from: PosterFrom;
}

/**
 * The page head's script: clockSetting, lookFor and posterTod on this page's
 * address and the computer's clock, before the first paint, written to
 * <html>. `kind` is clockSetting's, in its order (?tod, then ?hour, then
 * whether the page follows the clock), `f` and `m` are lookFor's. Its hours
 * and its pick are nightAtHours, morningAtHours, parseHour, hourOf and
 * pickPosterTod themselves, passed in as their source; its numbers come in
 * `a`. Self-contained, as they are: it runs as its own source text
 * (CLOCK_BOOT), with no comment inside, so it stays small in a build that
 * keeps comments. Should it throw, nothing is written and the stylesheets
 * show their default, the day posters. client-tests/night-posters.test.mjs
 * runs the emitted script against clockSetting, lookFor and posterTod at
 * every minute of the day.
 */
function clockBoot(
  nightAtHours: (hour: number, H: NightHours) => number,
  morningAtHours: (hour: number, H: NightHours, M: MorningHours) => number,
  parseHour: (v: string | null) => number | null,
  hourOf: (d: Date) => number,
  pickPosterTod: (night: number, morning: number, from: PosterFrom) => PosterTod,
  a: ClockBootArgs,
): void {
  try {
    const q = new URLSearchParams(location.search);
    const path = location.pathname;
    const tod = q.get("tod");
    const hour = parseHour(q.get("hour"));
    const kind =
      tod === "day" || tod === "night" || tod === "morning" || tod === "clock"
        ? tod
        : hour !== null
          ? "hour"
          : path === a.live || path.indexOf(a.live + "/") === 0
            ? "clock"
            : "day";
    const h = kind === "hour" ? (hour as number) : kind === "clock" ? hourOf(new Date()) : NaN;
    const f = kind === "night" ? 1 : nightAtHours(h, a.hours);
    const m = kind === "morning" ? 1 : morningAtHours(h, a.hours, a.morning);
    document.documentElement.setAttribute(a.attr, pickPosterTod(f, m, a.from));
  } catch {}
}

/** The inline script src/app/layout.tsx puts in every page's head. Its numbers are this file's constants, never copies. */
export const CLOCK_BOOT = `(${clockBoot})(${nightAtHours},${morningAtHours},${parseHour},${hourOf},${pickPosterTod},${JSON.stringify({
  attr: POSTER_TOD_ATTR,
  live: CLOCK_LIVE_BASE,
  hours: NIGHT_HOURS,
  morning: MORNING_HOURS,
  from: POSTER_FROM,
} satisfies ClockBootArgs)})`;
