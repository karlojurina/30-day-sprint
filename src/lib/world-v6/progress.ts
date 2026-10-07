/**
 * The student's progress as the world shows it: the lesson lanterns, the
 * places that wake up as they are worked through, the arrival card and the
 * place panel (Lovro's picks, 2026-09-28, world_overnight_log.md 46).
 *
 * One value per course area, in route order (layout.PLACES). The interface
 * builds it from the student's data (on /dev/world-v6 the fixture in
 * components/world-v6/study.ts) and hands it to scene.setWorldProgress(),
 * which passes it to every module that has setWorldProgress(p).
 * scene.setProgress(finished) keeps working for modules that only need whole
 * places finished.
 *
 * When the app is wired to real students, this is the only shape the map
 * needs: lessons per area, lessons watched per area, and where they are.
 */
export interface WorldProgress {
  /** Lessons per area, in route order (8 entries). */
  lessons: readonly number[];
  /** Lessons watched per area, 0..lessons[k], in route order. */
  done: readonly number[];
  /** The area the student is working through, 0..7; 8 once every area is done. */
  current: number;
  /** 1-based number of the next lesson inside `current`; 0 when there is none. */
  next: number;
}

/** Before the page says anything: nothing watched, the first lesson next. */
export const NO_PROGRESS: WorldProgress = { lessons: [], done: [], current: 0, next: 1 };

/** Share of area k watched, 0..1 (0 for an unknown area). */
export function areaShare(p: WorldProgress, k: number): number {
  const n = p.lessons[k] ?? 0;
  if (n <= 0) return 0;
  return Math.min(1, Math.max(0, (p.done[k] ?? 0) / n));
}

/** Areas whose every lesson is watched. */
export function areasFinished(p: WorldProgress): number {
  let f = 0;
  for (let k = 0; k < p.lessons.length; k++) if (areaShare(p, k) >= 1) f++;
  return f;
}

/** Lessons watched in total, and the course's lesson count. */
export function totals(p: WorldProgress): { done: number; lessons: number } {
  let done = 0;
  let lessons = 0;
  for (let k = 0; k < p.lessons.length; k++) {
    lessons += p.lessons[k] ?? 0;
    done += Math.min(p.done[k] ?? 0, p.lessons[k] ?? 0);
  }
  return { done, lessons };
}

/** Two progress values say the same thing (so the scene can skip a no-op update). */
export function sameProgress(a: WorldProgress, b: WorldProgress): boolean {
  if (a.current !== b.current || a.next !== b.next) return false;
  if (a.lessons.length !== b.lessons.length || a.done.length !== b.done.length) return false;
  for (let k = 0; k < a.lessons.length; k++) if (a.lessons[k] !== b.lessons[k]) return false;
  for (let k = 0; k < a.done.length; k++) if (a.done[k] !== b.done[k]) return false;
  return true;
}
