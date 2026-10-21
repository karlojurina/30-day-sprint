/**
 * Made-up data for /dev/admin/survey (admin rebuild 2, WI-9). Development
 * only: the dev layout calls notFound() anywhere else.
 *
 * MADE-UP PEOPLE ONLY. This repository is public: every student, email and
 * answer below is invented.
 *
 *   ?state=full | empty | loading | error   (default full)
 *
 * In full, 7 applications from 1 October on and 2 from before it (hidden
 * until "Show them"), with some questions left unanswered.
 */

import type { Answer } from "@/lib/admin/admin-transport";
import type { SurveyAnswer, SurveyApplication, SurveyData, SurveyQuestion } from "@/lib/admin/survey-data";

export type SurveyFixtureState = "full" | "empty" | "loading" | "error";

const STATES: SurveyFixtureState[] = ["full", "empty", "loading", "error"];

export function parseSurveyState(value: string | null): SurveyFixtureState {
  return STATES.find((s) => s === value) ?? "full";
}

const QUESTIONS: SurveyQuestion[] = [
  { id: "q1", order_num: 1, question_text: "How likely are you to recommend the course to a friend, from 1 to 10?", question_type: "scale", scale_min: 1, scale_max: 10, is_active: true },
  {
    id: "q2",
    order_num: 2,
    question_text: "Has the pace of the course felt right?",
    question_type: "multi_choice",
    options: ["Way too fast", "A bit too fast", "Just right", "A bit too slow", "Way too slow"],
    scale_min: null,
    scale_max: null,
    is_active: true,
  },
  { id: "q3", order_num: 3, question_text: "What has been your biggest win so far?", question_type: "open_text", scale_min: null, scale_max: null, is_active: true },
  { id: "q4", order_num: 4, question_text: "What should the course change?", question_type: "open_text", scale_min: null, scale_max: null, is_active: true },
];

type Seed = [id: string, name: string | null, status: string, createdAt: string, answers: Array<string | number | null>];

const SEEDS: Seed[] = [
  ["r-maya", "Maya Lindqvist", "pending", "2026-10-19T18:00:00.000Z", [9, "Just right", "My first ad got approved by a brand.", "More examples of hooks for beauty brands."]],
  ["r-jonah", "Jonah Pereira", "pending", "2026-10-20T06:00:00.000Z", [7, "A bit too fast", null, "Nothing, it was great."]],
  ["r-ethan", "Ethan Cole", "approved", "2026-10-17T08:00:00.000Z", [10, "Just right", "I understand what makes a hook work now.", null]],
  ["r-omar", "Omar Haddad", "applied", "2026-10-13T08:00:00.000Z", [8, "Just right", "Finished every video in 9 days.", "A checklist for each area."]],
  ["r-lena", "Lena Vogel", "applied", "2026-10-15T08:00:00.000Z", [6, "A bit too slow", null, null]],
  ["r-ruby", "Ruby Okafor", "rejected", "2026-10-14T10:00:00.000Z", [5, "Way too fast", "Not yet.", "Shorter videos, please. Some of them run past 20 minutes and I lose the thread."]],
  ["r-gone", null, "applied", "2026-10-05T10:00:00.000Z", [9, null, null, null]],
  // From before 1 October: hidden until "Show them".
  ["r-noah", "Noah Brandt", "applied", "2026-09-22T10:00:00.000Z", [8, "Just right", null, null]],
  ["r-priya", "Priya Nair", "rejected", "2026-08-30T10:00:00.000Z", [3, "Way too fast", null, "More live calls, please."]],
];

function data(): SurveyData {
  const applications: SurveyApplication[] = SEEDS.map(([id, name, status, created_at, values]) => {
    const answers: SurveyAnswer[] = QUESTIONS.map((q, i) => {
      const v = values[i];
      return {
        id: `${id}-${q.id}`,
        discount_request_id: id,
        question_id: q.id,
        answer_scale: q.question_type === "scale" && typeof v === "number" ? v : null,
        answer_choice: q.question_type === "multi_choice" && typeof v === "string" ? v : null,
        answer_text: q.question_type === "open_text" && typeof v === "string" ? v : null,
        created_at,
      };
    });
    return {
      id,
      status,
      created_at,
      student: name ? { id: `p-${id.slice(2)}`, name, email: `${id.slice(2)}@example.com` } : null,
      answers,
    };
  }).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { questions: QUESTIONS, applications };
}

/** The Survey page's one read, answered a moment later, as a real one would be. */
export function fixtureSurveyLoad(state: SurveyFixtureState): () => Promise<Answer<SurveyData>> {
  return () => {
    if (state === "loading") return new Promise(() => {});
    const answer: Answer<SurveyData> =
      state === "error"
        ? { ok: false, status: 500, error: "The applications could not be read: canceling statement due to statement timeout" }
        : { ok: true, status: 200, data: state === "empty" ? { questions: QUESTIONS, applications: [] } : data() };
    return new Promise((resolve) => setTimeout(() => resolve(answer), 250));
  };
}
