/**
 * Fixture data for /dev/world-v4. Preview only: no student record, no fetch,
 * no completion writes. The dev page must never mount StudentProvider (it
 * POSTs /api/student/refresh-watch-sync on mount, focus and visibilitychange).
 *
 * Names, order and landmark meshes come from layout.PLACES, so the interface
 * and the scene can never disagree about which place is which. Lesson counts,
 * titles and descriptions are V3's fixture values.
 *
 * Progress is not fixed here: the tuning panel sets where the student is (the
 * frontier), how many places are finished and how many lessons are done where
 * the student is, and studyFor() turns those into what every part of the
 * interface shows.
 */
import { PLACES, TRAIL } from "@/lib/world-v4/layout";

export interface StudyArea {
  /** Anchor id shared with the scene ("a1".."a8"). */
  id: string;
  /** Plain module name. The only name a student sees. */
  name: string;
  /** Landmark word, the database value (regions_next.landmark_label). */
  landmark: string;
  /** Landmark object name the marker pins to. */
  mesh: string;
  /**
   * First guess at the rail depth, before the scene answers depthFor(): the
   * stop's key index over the key count, which is the curve parameter the
   * route was built on.
   */
  depth: number;
  lessons: number;
  description: string;
  /** The first few lesson titles, in order. */
  sample: readonly string[];
  /** A feature row outside the lesson count (the Ad Bounty isle). */
  feature?: { key: "bounty_access"; title: string };
}

const CONTENT: ReadonlyArray<Pick<StudyArea, "lessons" | "description" | "sample" | "feature">> = [
  {
    lessons: 8,
    description: "How the course works and what you'll be able to do by the end.",
    sample: ["Welcome to EcomTalent", "How the course works", "Setting up your workspace", "What a good ad looks like", "How to get feedback"],
  },
  {
    lessons: 10,
    description: "Why people buy, and what every ad that works has in common.",
    sample: ["What an ad has to do", "Who you're selling to", "Offers and angles", "Reading ad account numbers", "Hook, body and call to action"],
  },
  {
    lessons: 22,
    description: "Plan, script and edit your first video ad.",
    sample: ["What makes a video ad work", "Researching the product", "Finding your angle", "Building a swipe file", "Writing a hook that lands", "Scripting the body"],
  },
  {
    lessons: 22,
    description: "Make more versions of an ad, test them and improve the edit.",
    sample: ["Editing for attention", "Pacing and cuts", "Sound and music", "Making variations", "Testing hooks"],
  },
  {
    lessons: 25,
    description: "Single image ads with one message that reads in a second.",
    sample: ["One image, one message", "Layout and hierarchy", "Writing the headline", "Using product photos", "Your first static ad"],
  },
  {
    lessons: 22,
    description: "Use AI tools to make ads and content faster.",
    sample: ["Where AI fits in your process", "Writing prompts for images", "Making AI video", "Editing AI output", "Keeping it looking real"],
  },
  {
    lessons: 22,
    description: "Decide what to make next from research and results.",
    sample: ["From research to a plan", "Writing a creative brief", "Planning a test", "Reading the results", "Deciding what to make next"],
    feature: { key: "bounty_access", title: "Ad Bounty access" },
  },
  {
    lessons: 14,
    description: "Build a portfolio and find paid client work.",
    sample: ["Building your portfolio", "Finding brands to work with", "Your first outreach message", "Pricing your work", "Working with a client"],
  },
];

const LAST_KEY = TRAIL.length - 1;

export const STUDY_AREAS: readonly StudyArea[] = PLACES.map((p, k) => ({
  id: p.id,
  name: p.module,
  landmark: p.landmark,
  mesh: p.mesh,
  depth: p.trail / LAST_KEY,
  ...CONTENT[k],
}));

export const TOTAL_LESSONS = STUDY_AREAS.reduce((sum, a) => sum + a.lessons, 0);

export type AreaState = "done" | "current" | "todo";
export type LockMode = "open" | "look" | "locked";

/** Everything the interface shows about the student, from the tuning. */
export interface Study {
  /** Index of the place the student is working through. */
  current: number;
  /** Places finished, 0..8. Lights the lanterns in the scene. */
  finished: number;
  /**
   * What the scene's setProgress() gets: places finished plus the share of
   * the next place's lessons done (3.18 = three places, 18% of the fourth).
   * The scene lights by whole places; the fraction is kept for later.
   */
  progress: number;
  /** Lessons done, per area. */
  done: readonly number[];
  /** Zero-based index of the next lesson in the current area. */
  nextLesson: number;
  doneTotal: number;
  state: readonly AreaState[];
  /** Past the frontier in look or locked mode: cannot be opened. */
  locked: readonly boolean[];
  /** Past the frontier in locked mode: the scroll cannot reach it either. */
  unreachable: readonly boolean[];
}

/** Lesson title by index; lessons past the fixture's sample get a plain placeholder. */
export function lessonTitle(a: StudyArea, i: number): string {
  return a.sample[i] ?? `Lesson ${i + 1}`;
}

/**
 * current: the place the student is at. finished: places finished.
 * partial: lessons done in the current place (clamped below its count).
 */
export function studyFor(current: number, finished: number, partial: number, lock: LockMode): Study {
  const n = STUDY_AREAS.length;
  const done = STUDY_AREAS.map((a, k) =>
    k < finished ? a.lessons : k === current ? Math.max(0, Math.min(partial, a.lessons - 1)) : 0,
  );
  const cur = STUDY_AREAS[current];
  const nextLesson = done[current] < cur.lessons ? done[current] : 0;
  const progress = finished + (finished < n ? Math.min(0.999, done[finished] / STUDY_AREAS[finished].lessons) : 0);
  const state: AreaState[] = [];
  const locked: boolean[] = [];
  const unreachable: boolean[] = [];
  for (let k = 0; k < n; k++) {
    state.push(done[k] >= STUDY_AREAS[k].lessons ? "done" : k === current ? "current" : "todo");
    locked.push(lock !== "open" && k > current);
    unreachable.push(lock === "locked" && k > current);
  }
  return {
    current,
    finished,
    progress,
    done,
    nextLesson,
    doneTotal: done.reduce((s, d) => s + d, 0),
    state,
    locked,
    unreachable,
  };
}

/** Two-digit number as shown in mono labels: 3 -> "03". */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
