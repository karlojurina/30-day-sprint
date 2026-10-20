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
 */

/**
 * The night's hours, local time (24 h): 0 by day, rising from duskFrom to
 * duskTo, 1 from duskTo to dawnFrom, falling from dawnFrom to dawnTo. The
 * rise and the fall are smoothsteps, so the dusk deepens slowly at first.
 */
export const NIGHT_HOURS = { duskFrom: 20, duskTo: 21, dawnFrom: 5, dawnTo: 6 } as const;

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

const smooth = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/** The night factor at an hour on the clock (0..24, wraps). */
export function nightAt(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  const h = ((hour % 24) + 24) % 24;
  const { duskFrom, duskTo, dawnFrom, dawnTo } = NIGHT_HOURS;
  if (h >= duskTo || h < dawnFrom) return 1;
  if (h >= dawnTo && h < duskFrom) return 0;
  if (h >= duskFrom) return smooth((h - duskFrom) / (duskTo - duskFrom));
  return 1 - smooth((h - dawnFrom) / (dawnTo - dawnFrom));
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
