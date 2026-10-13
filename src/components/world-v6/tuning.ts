/**
 * The dev tuning state for /dev/world-v6: which locking mode, where the
 * student is, how many places are finished, and the scroll budget of every
 * stretch. Lovro tunes these on his own screen, so they persist in this
 * browser (localStorage) until he presses Reset. The defaults are the route
 * designer's first guesses in layout.ts; "Copy values" hands back JSON in the
 * same shape, ready to paste into PLACES[].scrollVh and TAIL_VH.
 */
import { FLIGHT_VH, PLACES, TAIL_VH } from "@/lib/world-v6/layout";
import type { LockMode } from "./study";

export interface Tuning {
  lock: LockMode;
  /** Index of the place the student is at (0..7). */
  frontier: number;
  /** Places finished (0..8). */
  finished: number;
  /** Lessons done in the place the student is at (V3's fixture had 4: lesson 05 next). */
  partial: number;
  /** Scroll budget of the stretch that ENDS at each place, in vh. */
  scrollVh: number[];
  /** Scroll after the last place, in vh. */
  tailVh: number;
  /**
   * Scroll the airship flight takes, in vh. It sits inside the stretch that
   * ends at 08, on top of 08's own budget (layout FLIGHT_VH).
   */
  flightVh: number;
}

export const VH_MIN = 60;
// 800: the Video Ads I stretch holds the whole dive and the cave and starts at
// 330, so Lovro needs room to slow it well past 400.
export const VH_MAX = 800;
export const TAIL_MIN = 10;

export const DEFAULT_TUNING: Tuning = {
  lock: "open",
  frontier: 2,
  finished: 2,
  partial: 4,
  scrollVh: PLACES.map((p) => p.scrollVh),
  tailVh: TAIL_VH,
  flightVh: FLIGHT_VH,
};

// Grey pass 3 changed what the stretches hold (the cave, the mine, the flight
// on its own), so pass-2 budgets would mean something else now. The new key
// starts pacing from the defaults; the lock and the progress carry over.
// Round 1 (2026-09-28) moved what the stretches hold again (a3 outside the
// falls, the cave in a4's stretch) and evened out the pacing, so p3 budgets
// would hide that pass: r1 starts pacing from the defaults, and the lock and
// the progress carry over from p3 or the older key.
// The final pass (2026-09-28 night) rebuilt a3 to a4 again, so pacing restarts
// from the defaults under :final; the lock and progress still carry over from
// r1 (Lovro's round 1 save), then p3, then the oldest key.
// Final pass B moved the pacing again (a5's stretch 230 -> 280 for the slower
// turn after the Trail Hut, the tail 110 -> 60 now that it ends at the arch),
// so pacing restarts from the defaults under :finalB; lock and progress carry
// over from :final first.
// 2026-10-13 (Lovro: no cave between Video Ads 1 and 2): the Video Ads II
// stretch is one move across the gorge now, a quarter shorter, and its budget
// went 200 -> 150 (1,990 -> 1,940 vh in all), so a :finalB save would spend
// the old budget on the new stretch: pacing restarts from the defaults under
// :direct; lock and progress carry over from :finalB first.
// 2026-10-13, later (decision 67: the camera walks the trail to the Trail
// Hut): the Video Ads II stretch is a quarter longer and its budget went
// 150 -> 280 (1,940 -> 2,070 vh in all), so a :direct save would spend the
// flight's budget on the walk: pacing restarts from the defaults under
// :trail; lock and progress carry over from :direct first.
const KEY = "world-v6:tuning:trail";
const OLD_KEYS = ["world-v6:tuning:direct", "world-v6:tuning:finalB", "world-v6:tuning:final", "world-v6:tuning:r1", "world-v6:tuning:p3", "world-v6:tuning"] as const;
const LOCKS: readonly LockMode[] = ["open", "look", "locked"];
const N = PLACES.length;

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return n < lo ? lo : n > hi ? hi : n;
};

/** Anything read back from storage or handed to the harness goes through here. */
export function sanitize(raw: Partial<Tuning> | null | undefined, base: Tuning = DEFAULT_TUNING): Tuning {
  const r = raw ?? {};
  const vh = Array.isArray(r.scrollVh) && r.scrollVh.length === N ? r.scrollVh : base.scrollVh;
  return {
    lock: LOCKS.includes(r.lock as LockMode) ? (r.lock as LockMode) : base.lock,
    frontier: clampInt(r.frontier, 0, N - 1, base.frontier),
    finished: clampInt(r.finished, 0, N, base.finished),
    // Clamped to the place's lesson count where it is used (studyFor).
    partial: clampInt(r.partial, 0, 99, base.partial),
    scrollVh: vh.map((v, k) => clampInt(v, VH_MIN, VH_MAX, base.scrollVh[k])),
    // The rail ignores a budget of 1 vh or less, so the tail keeps at least 10.
    tailVh: clampInt(r.tailVh, TAIL_MIN, VH_MAX, base.tailVh),
    flightVh: clampInt(r.flightVh, VH_MIN, VH_MAX, base.flightVh),
  };
}

export function loadTuning(): Tuning {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return sanitize(JSON.parse(s) as Partial<Tuning>);
    for (const k of OLD_KEYS) {
      const old = localStorage.getItem(k);
      if (!old) continue;
      const o = JSON.parse(old) as Partial<Tuning>;
      return sanitize({ lock: o.lock, frontier: o.frontier, finished: o.finished, partial: o.partial });
    }
    return DEFAULT_TUNING;
  } catch {
    return DEFAULT_TUNING;
  }
}

export function saveTuning(t: Tuning): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* private window or blocked storage: the values last until reload */
  }
}

export function clearTuning(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}

/**
 * Scroll position, in vh, of each stop: the running sum of the stretches.
 * The flight sits in the last stretch, so 08 also carries its budget.
 */
export function stopVh(t: Tuning): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let k = 0; k < N; k++) {
    acc += t.scrollVh[k] + (k === N - 1 ? t.flightVh : 0);
    out.push(acc);
  }
  return out;
}

/** The whole route's scroll length, in vh, with the tail. */
export function routeVh(t: Tuning): number {
  return stopVh(t)[N - 1] + t.tailVh;
}

/** The JSON "Copy values" puts on the clipboard. */
export function pacingJson(t: Tuning): string {
  const byPlace: Record<string, number> = {};
  PLACES.forEach((p, k) => (byPlace[p.id] = t.scrollVh[k]));
  return JSON.stringify({ scrollVh: byPlace, flightVh: t.flightVh, tailVh: t.tailVh, totalVh: routeVh(t) }, null, 2);
}

export function sameTuning(a: Tuning, b: Tuning): boolean {
  return (
    a.lock === b.lock &&
    a.frontier === b.frontier &&
    a.finished === b.finished &&
    a.partial === b.partial &&
    a.tailVh === b.tailVh &&
    a.flightVh === b.flightVh &&
    a.scrollVh.every((v, k) => v === b.scrollVh[k])
  );
}
