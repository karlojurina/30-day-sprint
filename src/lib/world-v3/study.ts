/**
 * Fixture data for /dev/world-v3. Preview only: no student record, no fetch,
 * no completion writes. The dev page must never mount StudentProvider (it
 * POSTs /api/student/refresh-watch-sync on mount, focus and visibilitychange),
 * so everything the interface shows comes from this file.
 *
 * Names, order, landmark meshes and lesson counts are the locked values from
 * .impeccable.md and check_geom.py. Rail depths are the check_geom.py stops;
 * the scene may refine them through depthFor(), and the interface asks the
 * scene first.
 */

export interface StudyArea {
  /** Anchor id shared with the scene. */
  id: string;
  /** Plain module name. The only name a student sees. */
  name: string;
  /** Landmark word for navigation by memory ("the viaduct one"). */
  landmark: string;
  /** Landmark mesh in the glb the marker pins to. */
  mesh: string;
  /** Rail depth, in the scene's 0..0.88 unit. */
  depth: number;
  /** Lessons in the whole area. */
  lessons: number;
  /** Lessons done. */
  done: number;
  /** One line, what the area teaches. */
  description: string;
  /** The first few lesson titles, in order. Lesson n is sample[n - 1]. */
  sample: readonly string[];
  /** A feature row that sits outside the lesson count (the Ad Bounty pond). */
  feature?: { key: "bounty_access"; title: string };
}

export const STUDY_AREAS: readonly StudyArea[] = [
  {
    id: "a1", name: "Introduction", landmark: "Lighthouse", mesh: "LM_Lighthouse", depth: 0.0708,
    lessons: 8, done: 8,
    description: "How the course works and what you'll be able to do by the end.",
    sample: ["Welcome to EcomTalent", "How the course works", "Setting up your workspace", "What a good ad looks like", "How to get feedback"],
  },
  {
    id: "a2", name: "Fundamentals", landmark: "Windmill", mesh: "LM_Windmill", depth: 0.1934,
    lessons: 10, done: 10,
    description: "Why people buy, and what every ad that works has in common.",
    sample: ["What an ad has to do", "Who you're selling to", "Offers and angles", "Reading ad account numbers", "Hook, body and call to action"],
  },
  {
    id: "a3", name: "Video Ads I", landmark: "Stone bridge", mesh: "LM_Bridge", depth: 0.3,
    lessons: 22, done: 4,
    description: "Plan, script and edit your first video ad.",
    sample: ["What makes a video ad work", "Researching the product", "Finding your angle", "Building a swipe file", "Writing a hook that lands", "Scripting the body"],
  },
  {
    id: "a4", name: "Video Ads II", landmark: "Viaduct", mesh: "LM_Viaduct", depth: 0.4151,
    lessons: 22, done: 0,
    description: "Make more versions of an ad, test them and improve the edit.",
    sample: ["Editing for attention", "Pacing and cuts", "Sound and music", "Making variations", "Testing hooks"],
  },
  {
    id: "a5", name: "Static Ads", landmark: "Watchtower", mesh: "LM_Watchtower", depth: 0.5236,
    lessons: 25, done: 0,
    description: "Single image ads with one message that reads in a second.",
    sample: ["One image, one message", "Layout and hierarchy", "Writing the headline", "Using product photos", "Your first static ad"],
  },
  {
    id: "a6", name: "AI Ads & Content", landmark: "Cairn", mesh: "LM_Cairn", depth: 0.6321,
    lessons: 22, done: 0,
    description: "Use AI tools to make ads and content faster.",
    sample: ["Where AI fits in your process", "Writing prompts for images", "Making AI video", "Editing AI output", "Keeping it looking real"],
  },
  {
    id: "a7", name: "Creative Strategy", landmark: "Jetty", mesh: "LM_Jetty", depth: 0.6863,
    lessons: 22, done: 0,
    description: "Decide what to make next from research and results.",
    sample: ["From research to a plan", "Writing a creative brief", "Planning a test", "Reading the results", "Deciding what to make next"],
    feature: { key: "bounty_access", title: "Ad Bounty access" },
  },
  {
    id: "a8", name: "Job Board", landmark: "Obelisk", mesh: "LM_Obelisk", depth: 0.8302,
    lessons: 14, done: 0,
    description: "Build a portfolio and find paid client work.",
    sample: ["Building your portfolio", "Finding brands to work with", "Your first outreach message", "Pricing your work", "Working with a client"],
  },
];

/** Index into STUDY_AREAS of the area the student is working through. */
export const CURRENT_AREA = 2;

/** Zero-based lesson index of the next lesson in the current area (lesson 05). */
export const NEXT_LESSON = STUDY_AREAS[CURRENT_AREA].done;

export const TOTAL_LESSONS = STUDY_AREAS.reduce((sum, a) => sum + a.lessons, 0);
export const DONE_LESSONS = STUDY_AREAS.reduce((sum, a) => sum + a.done, 0);

export type AreaState = "done" | "current" | "todo";

export function areaState(index: number): AreaState {
  const a = STUDY_AREAS[index];
  if (a.done >= a.lessons) return "done";
  return index === CURRENT_AREA ? "current" : "todo";
}

/** Two-digit number as shown in mono labels: 3 -> "03". */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
