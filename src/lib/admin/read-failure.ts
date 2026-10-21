/**
 * A read that failed, in plain words for the team (admin rebuild 2, the
 * review's fix round). The loaders hand on the database's own text, as
 * PostgREST answers it ("permission denied for table tasks", "canceling
 * statement due to statement timeout"), so the log and the Details keep it
 * exactly. The pages say what it means instead, once, and keep the raw text
 * behind a small "Details" (ReadFailure in src/components/admin/review-parts.tsx).
 *
 *   plainReadError(raw)    one plain sentence for the kind of failure
 *   plainReadErrors(raws)  each sentence once, in the order first met
 *
 * A raw text that is already a sentence of ours (a capital first, a full
 * stop last, no database words in it) is said as it is: the routes answer
 * those on purpose ("Couldn't read the date of the course switch, so the 30%
 * list was not made. Try again.").
 *
 * No React, no Next, no database: client-tests/admin-review.test.mjs runs it
 * as it is.
 */

/** A table or view the pages read, in the words the team uses for it. */
const TABLE_WORDS: Record<string, string> = {
  admin_config: "the admin settings",
  canceling_snapshots: "the canceling snapshots",
  daily_progress_snapshots: "the daily snapshots",
  discount_feedback_questions: "the survey questions",
  discount_feedback_responses: "the survey answers",
  discount_requests: "the 30% requests",
  lesson_videos: "the lesson videos",
  lessons: "the lessons",
  regions: "the areas",
  student_lesson_completions: "the finished lessons",
  student_lesson_ratings: "the lesson ratings",
  student_last_counted_completion: "the students' last lessons",
  student_membership_discounts: "the membership coupons",
  student_milestones: "the Bounty Program stamps",
  student_progress_counts: "the students' progress",
  student_streaks: "the streaks",
  student_whop_sync: "the Whop sync",
  students: "the students",
  tasks: "the tasks",
  team_members: "the team",
  templates: "the templates",
};

/** "the tasks" for tasks, "the outreach log" for a table this file does not know (its own name, in words). */
export function tableWords(name: string): string {
  const bare = name.replace(/^public\./, "").replace(/"/g, "");
  return TABLE_WORDS[bare] ?? `the ${bare.replace(/_/g, " ")}`;
}

/** The sentences, so a test and a page name the same ones. */
export const PLAIN = {
  timeout: "The database took too long to answer.",
  signedOut: "The sign-in has run out. Sign in again.",
  network: "Couldn't reach the server. Check the connection and try again.",
  missingTable: "A table this page reads is missing from the database.",
  missingColumn: "The database is missing a column this page reads.",
  busy: "The database is busy. Try again in a minute.",
  server: "The server ran into a problem.",
  notADate: "A setting in the database holds something that is not a date and time.",
  unknown: "The read failed.",
} as const;

/** Words that only the database or the network writes: a text holding one is never shown as it is. */
const RAW_MARKERS =
  /\b(permission denied|statement|relation|column|jwt|pgrst|postgres|sqlstate|syntax error|violates|duplicate key|null value|ECONN|ENOTFOUND|fetch failed|undefined|NaN)\b/i;

export function plainReadError(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return PLAIN.unknown;
  if (/statement timeout|canceling statement|timed? ?out|timeout|took too long/i.test(text)) return PLAIN.timeout;
  const denied = text.match(/permission denied for (?:table|relation|view|sequence|schema|function) "?([\w.]+)"?/i);
  if (denied) return `This account can't read ${tableWords(denied[1])}.`;
  if (/permission denied|insufficient[_ ]privilege|forbidden|\b403\b|role required/i.test(text)) {
    return "This account can't read this.";
  }
  if (/jwt|not authenticated|unauthori[sz]ed|\b401\b|signed out|session (has )?expired|sign in again/i.test(text)) {
    return PLAIN.signedOut;
  }
  if (/failed to fetch|networkerror|load failed|fetch failed|network|econn|enotfound|couldn't reach/i.test(text)) {
    return PLAIN.network;
  }
  if (/is not a date/i.test(text)) return PLAIN.notADate;
  if (/relation "?[\w.]+"? does not exist|could not find the table|schema cache/i.test(text)) return PLAIN.missingTable;
  if (/column "?[\w.]+"? (of relation "?[\w.]+"? )?does not exist|could not find the '?[\w.]+'? column/i.test(text)) {
    return PLAIN.missingColumn;
  }
  if (/too many requests|rate limit|\b429\b/i.test(text)) return PLAIN.busy;
  if (/\b5\d\d\b|internal server error|bad gateway|service unavailable/i.test(text)) return PLAIN.server;
  // Already one of our own sentences: say it as it is.
  if (/^[A-Z]/.test(text) && /[.!?]$/.test(text) && !RAW_MARKERS.test(text)) return text;
  return PLAIN.unknown;
}

/** Each plain sentence once, in the order first met: the banner of a page whose reads failed alike says it once. */
export function plainReadErrors(raws: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const r of raws) {
    const p = plainReadError(r);
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** True when the raw text says more than its plain sentence: the page then keeps it behind Details. */
export function hasDetails(raw: string | null | undefined): boolean {
  const text = (raw ?? "").trim();
  return text !== "" && text !== plainReadError(text);
}
