/**
 * Fixture data for /dev/world-v6. Preview only: no student record, no fetch,
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
import { PLACES, TRAIL } from "@/lib/world-v6/layout";
import type { WorldProgress } from "@/lib/world-v6/progress";

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
  /**
   * Every lesson title, in order (2026-09-28: the card and the place panel
   * name the next lesson and list the rest, so the fixture needs them all).
   */
  sample: readonly string[];
  /** Zero-based indices of the action items (the milestone diamonds). */
  actions: readonly number[];
  /** A feature row outside the lesson count (the Ad Bounty isle). */
  feature?: { key: "bounty_access"; title: string };
}

const CONTENT: ReadonlyArray<Pick<StudyArea, "lessons" | "description" | "sample" | "actions" | "feature">> = [
  {
    lessons: 8,
    description: "How the course works and what you'll be able to do by the end.",
    sample: [
      "Welcome to EcomTalent", "How the course works", "Setting up your workspace", "What a good ad looks like",
      "How to get feedback", "The tools you'll use", "How brands pay creators", "Your plan for the next 30 days",
    ],
    actions: [7],
  },
  {
    lessons: 10,
    description: "Why people buy, and what every ad that works has in common.",
    sample: [
      "What an ad has to do", "Who you're selling to", "Offers and angles", "Reading ad account numbers",
      "Hook, body and call to action", "Awareness levels", "Why people buy", "Writing for one person",
      "Breaking down a winning ad", "Your first ad breakdown",
    ],
    actions: [9],
  },
  {
    lessons: 22,
    description: "Plan, script and edit your first video ad.",
    sample: [
      "What makes a video ad work", "Researching the product", "Finding your angle", "Building a swipe file",
      "Writing a hook that lands", "Scripting the body", "Writing the call to action", "Planning your shots",
      "Filming on your phone", "Lighting at home", "Recording clean audio", "Working with creators",
      "Briefing a creator", "Setting up your edit", "The first cut", "Captions that get read", "Adding b-roll",
      "Music and sound effects", "Colour and exposure", "Exporting for every placement", "Reviewing your own edit",
      "Your first video ad",
    ],
    actions: [21],
  },
  {
    lessons: 22,
    description: "Make more versions of an ad, test them and improve the edit.",
    sample: [
      "Editing for attention", "Pacing and cuts", "Sound and music", "Making variations", "Testing hooks",
      "Writing 10 hooks from one script", "Changing the first 3 seconds", "Testing formats", "UGC or studio",
      "Green screen ads", "Podcast style ads", "Street interview ads", "Before and after ads", "Comment reply ads",
      "Setting up a test", "How long to run a test", "Reading the numbers", "Hook rate and hold rate",
      "Reading hook test results", "Cutting what didn't work", "Scaling the winning edit", "Your second video ad",
    ],
    actions: [21],
  },
  {
    lessons: 25,
    description: "Single image ads with one message that reads in a second.",
    sample: [
      "One image, one message", "Layout and hierarchy", "Writing the headline", "Using product photos",
      "Your first static ad", "Colour and contrast", "Fonts that read on a phone", "Testimonial ads",
      "Comparison ads", "Us against them", "Feature callouts", "Problem and solution", "Offer ads",
      "Founder note ads", "Native looking ads", "Screenshot ads", "Meme ads", "Designing in Figma",
      "Designing in Canva", "Resizing for every placement", "Writing ad copy", "Headlines and descriptions",
      "Testing statics", "Reading static results", "Your static ad pack",
    ],
    actions: [4, 24],
  },
  {
    lessons: 22,
    description: "Use AI tools to make ads and content faster.",
    sample: [
      "Where AI fits in your process", "Writing prompts for images", "Making AI video", "Editing AI output",
      "Keeping it looking real", "AI voiceovers", "AI avatars", "Product shots with AI", "Scenes and backgrounds",
      "Keeping a character the same", "Writing scripts with AI", "Research with AI", "Hooks with AI",
      "Turning one ad into ten", "AI b-roll", "Upscaling and cleanup", "Lip sync", "What platforms allow",
      "Saying when it's AI", "Building an AI workflow", "Faster without looking cheap", "Your first AI ad",
    ],
    actions: [21],
  },
  {
    lessons: 22,
    description: "Decide what to make next from research and results.",
    sample: [
      "From research to a plan", "Writing a creative brief", "Planning a test", "Reading the results",
      "Deciding what to make next", "Customer research", "Reading reviews", "Mining comments",
      "Competitor research", "The ad library", "Building angles", "Messaging and positioning", "Creative variety",
      "Account structure", "Budgets and testing", "Creative fatigue", "Iterating on winners", "Reporting to a brand",
      "Monthly creative plans", "Working with a media buyer", "Presenting your strategy",
      "Your first creative strategy",
    ],
    actions: [21],
    feature: { key: "bounty_access", title: "Ad Bounty access" },
  },
  {
    lessons: 14,
    description: "Build a portfolio and find paid client work.",
    sample: [
      "Building your portfolio", "Finding brands to work with", "Your first outreach message", "Pricing your work",
      "Working with a client", "Writing a pitch", "Following up", "Discovery calls", "Scoping a project",
      "Contracts and invoices", "Delivering on time", "Getting repeat work", "Getting referrals",
      "Apply to your first job",
    ],
    actions: [13],
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
  /**
   * 2026-09-28: the place the student is working through (WorldProgress.current):
   * the frontier, or the first unfinished place after it once the frontier's
   * lessons are all watched; 8 when every place is done. The card, the chip
   * and the "current" marker follow this.
   */
  place: number;
  /** Zero-based index of the next lesson at `place`; -1 when place is 8. */
  placeNext: number;
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
  let place = current;
  while (place < n && done[place] >= STUDY_AREAS[place].lessons) place++;
  const state: AreaState[] = [];
  const locked: boolean[] = [];
  const unreachable: boolean[] = [];
  for (let k = 0; k < n; k++) {
    state.push(done[k] >= STUDY_AREAS[k].lessons ? "done" : k === place ? "current" : "todo");
    locked.push(lock !== "open" && k > current);
    unreachable.push(lock === "locked" && k > current);
  }
  return {
    current,
    finished,
    progress,
    done,
    nextLesson,
    place,
    placeNext: place < n ? done[place] : -1,
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

/** Minutes a lesson runs. Fixture only: a steady spread of 6 to 16 minutes. */
export function lessonMinutes(k: number, i: number): number {
  return 6 + ((k * 7 + i * 13 + i * i) % 11);
}

/** Is lesson i of area k an action item (a milestone, not a watch lesson)? */
export function isAction(a: StudyArea, i: number): boolean {
  return a.actions.includes(i);
}

/**
 * What the scene gets (progress.ts): lessons and lessons watched per place,
 * the place the student is working through, and its next lesson (1-based).
 */
export function worldProgressOf(st: Study): WorldProgress {
  const place = st.place;
  return {
    lessons: STUDY_AREAS.map((a) => a.lessons),
    done: st.done.slice(),
    current: place,
    next: place < STUDY_AREAS.length ? st.done[place] + 1 : 0,
  };
}
