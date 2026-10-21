/**
 * The student's own clock: whether it is night where they are (Lovro,
 * 2026-10-20: "if they're watching at night, it's going to be all dark").
 * Option D of _admin/prds/map-review-2026-10-15/real_time_light.md: the clock
 * decides one thing, a night factor from 0 (day) to 1 (night). light.ts lays
 * its night layer over the opening and the first six places by that factor;
 * from morning to evening the map is exactly what it was.
 *
 * The time is the student's computer clock with fixed hours (no location, no
 * permission prompt). Every number lives in NIGHT_HOURS and CLOCK below.
 *
 * Where the clock runs: only on the students' map (/world). Every other page
 * (the dev pages, every world test, the poster pipeline) is pinned to day
 * unless its address asks otherwise, so a test run at 2 am grades the frame
 * it always graded. The address can ask, on /world and the dev pages alike:
 *   ?tod=day | night    pinned (day: factor 0, night: factor 1)
 *   ?tod=clock          the computer's clock, as on /world
 *   ?hour=HH | HH.MM    pinned to that hour on the clock (23, 20.30, 05.15)
 * ?tod wins over ?hour; a value that does not parse is ignored.
 *
 * The loading posters follow the same clock (2026-10-21): poster.ts has a
 * night twin of the opening's and the first six places' posters, and the
 * page shows the set nearer to what the live map shows (posterNight). The
 * page's head picks it before the first paint (CLOCK_BOOT, in
 * src/app/layout.tsx) and writes it on <html> (POSTER_TOD_ATTR), where the
 * stylesheets read it; the map's code writes it again as it mounts and when
 * the clock moves it (markPosterTod, writePosterTod).
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

/** The hour on a date's local clock, with minutes and seconds as a fraction. */
export function hourOf(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

/** What decides the night factor on this page. */
export type ClockSetting =
  | { kind: "clock" }
  | { kind: "hour"; hour: number }
  | { kind: "day" }
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
  if (tod === "day" || tod === "night") return { kind: tod };
  if (tod === "clock") return { kind: "clock" };
  const hour = parseHour(q.get("hour"));
  if (hour !== null) return { kind: "hour", hour };
  return live ? { kind: "clock" } : { kind: "day" };
}

/** The night factor a setting gives at `now`. */
export function nightFor(s: ClockSetting, now: Date): number {
  switch (s.kind) {
    case "day":
      return 0;
    case "night":
      return 1;
    case "hour":
      return nightAt(s.hour);
    default:
      return nightAt(hourOf(now));
  }
}

/**
 * Calls `onNight` with the factor now, then again whenever it changes: read
 * every CLOCK.everyMs and when the tab becomes visible again (a laptop shut
 * overnight). A pinned setting is read once. `now` is for tests. Returns the
 * stop function.
 */
export function watchClock(setting: ClockSetting, onNight: (night: number) => void, now: () => Date = () => new Date()): () => void {
  let last = nightFor(setting, now());
  onNight(last);
  if (setting.kind !== "clock" || typeof window === "undefined") return () => {};
  const check = () => {
    const n = nightFor(setting, now());
    if (Math.abs(n - last) < 1e-4) return;
    last = n;
    onNight(n);
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

// ── The posters' day or night ───────────────────────────────────────────────

/**
 * While the clock fades, the live map is a blend of its day and its night,
 * and the page opens on the poster nearer to it: the night set from this
 * night factor on. Measured 2026-10-21 on the M2, the live 3D at factors 0 to
 * 1 at 1280 x 720, each frame's mean distance to the factor 0 frame and the
 * factor 1 frame: the night frame is the nearer from 0.25 (Base Camp to the
 * Mirror Lake), 0.29 (the Landing) and 0.34 (the opening, the frame nearly
 * every visit opens on). Halfway through the fade (0.5) the light is already
 * 82% night (light.ts nightWeight), so the night poster. On the clock: the
 * night posters from 20:23:30 to 05:36:30.
 */
export const POSTER_NIGHT_FROM = 0.34;

/** Whether the night posters show at night factor f (0..1). */
export function posterNight(f: number): boolean {
  return f >= POSTER_NIGHT_FROM;
}

/**
 * The attribute on <html> that says which posters show, "night" or "day":
 * the stylesheets pick the loading card's still, the poster layer's first
 * picture and its blurred preview by it (world-ui.module.css .groundPoster,
 * world.module.css .posterLanding and .poster::before). Absent, the day's.
 */
export const POSTER_TOD_ATTR = "data-world-tod";

/** The students' map: the page, and the pages under it, that follow the clock when the address says nothing (WorldMap's liveClock). */
export const CLOCK_LIVE_BASE = "/world";

/** Writes which posters show to <html> (POSTER_TOD_ATTR). Nothing on the server. */
export function writePosterTod(night: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(POSTER_TOD_ATTR, night ? "night" : "day");
}

/**
 * Which posters this page shows now, by the same rule as the head's script,
 * written to <html> and returned (true: night). `live` is the page's own
 * (WorldMap: under CLOCK_LIVE_BASE). For a visit that came in by a link
 * (the login's redirect to /world), where the head's script ran on another
 * page. Nothing on the server.
 */
export function markPosterTod(live: boolean, now: Date = new Date()): boolean {
  if (typeof window === "undefined") return false;
  const night = posterNight(nightFor(clockSetting(window.location.search, live), now));
  writePosterTod(night);
  return night;
}

interface ClockBootArgs {
  attr: string;
  live: string;
  hours: NightHours;
  from: number;
}

/**
 * The page head's script: clockSetting, nightFor and posterNight on this
 * page's address and the computer's clock, before the first paint, written to
 * <html>. `kind` is clockSetting's, in its order (?tod, then ?hour, then
 * whether the page follows the clock), `f` is nightFor's. Its night hours and
 * hour reading are nightAtHours, parseHour and hourOf themselves, passed in as
 * their source; its numbers come in `a`. Self-contained, as they are: it runs
 * as its own source text (CLOCK_BOOT), with no comment inside, so it stays
 * small in a build that keeps comments. Should it throw, nothing is written
 * and the stylesheets show their default, the day posters.
 * client-tests/night-posters.test.mjs runs the emitted script against
 * clockSetting, nightFor and posterNight at every minute of the day.
 */
function clockBoot(
  nightAtHours: (hour: number, H: NightHours) => number,
  parseHour: (v: string | null) => number | null,
  hourOf: (d: Date) => number,
  a: ClockBootArgs,
): void {
  try {
    const q = new URLSearchParams(location.search);
    const path = location.pathname;
    const tod = q.get("tod");
    const hour = parseHour(q.get("hour"));
    const kind =
      tod === "day" || tod === "night" || tod === "clock"
        ? tod
        : hour !== null
          ? "hour"
          : path === a.live || path.indexOf(a.live + "/") === 0
            ? "clock"
            : "day";
    const f = kind === "night" ? 1 : kind === "hour" ? nightAtHours(hour as number, a.hours) : kind === "clock" ? nightAtHours(hourOf(new Date()), a.hours) : 0;
    document.documentElement.setAttribute(a.attr, f >= a.from ? "night" : "day");
  } catch {}
}

/** The inline script src/app/layout.tsx puts in every page's head. Its numbers are this file's constants, never copies. */
export const CLOCK_BOOT = `(${clockBoot})(${nightAtHours},${parseHour},${hourOf},${JSON.stringify({
  attr: POSTER_TOD_ATTR,
  live: CLOCK_LIVE_BASE,
  hours: NIGHT_HOURS,
  from: POSTER_NIGHT_FROM,
} satisfies ClockBootArgs)})`;
