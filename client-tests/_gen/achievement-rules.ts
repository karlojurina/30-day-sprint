/**
 * The rules of the badges that need more than a line (migration v112, the
 * owner's decisions of 2026-10-21). No imports, so the client tests and the
 * migration's own test (supabase/migration-tests/v112.test.mjs) run this very
 * file. src/lib/achievements.ts awards Triple Threat and Habit Builder with the
 * first three; the last two are what the view achievement_unlock_stats
 * counts, written once here so the migration's test can hold the view to them.
 *
 *   finishedAt             when a lesson was really finished, or null
 *   mostFinishedInOneDay   Triple Threat: the most lessons really finished on one UTC day
 *   streakDaysSinceSwitch  Habit Builder: the streak's days counted from the course switch
 *   countsInShare          who the share beside each badge divides by
 *   sharePercent           that share, rounded as the view rounds it
 *
 * v112 writes the same two badge rules in SQL, to take away the badges that
 * do not meet them; its test checks the SQL against these functions.
 */

const DAY_MS = 86_400_000;

/** A completion row as Triple Threat reads it. */
export interface FinishRow {
  lesson_id: string;
  completed_at: string | null;
  action_completed_at: string | null;
  /**
   * student_lesson_completions.completed_at_real (v112): completed_at is the
   * moment the lesson was really finished. True when the lesson page's player
   * wrote it (lesson-watched, once the watch telemetry says the video was
   * watched), when Whop's event did (the webhook, as it arrives), or when the
   * Whop catch-up did with Whop's own time. A login or visit sync stamps every
   * row it adds with the sync's own time, so lessons finished on Whop over
   * several days arrive with one time: those rows are null or false.
   */
  completed_at_real: boolean | null;
}

/**
 * When the lesson was really finished, in milliseconds, or null when nobody
 * knows.
 *
 * A lesson with no action item is finished when its video is: completed_at,
 * when completed_at_real says it is the real moment. A lesson with an action
 * item is finished when its second half is done: the later of the two halves
 * when the video half's time is real; the action's own time
 * (action_completed_at, the student's own press) when the video half was
 * already in by then, whatever stamped it; unknown when the video half
 * arrived after the action from a sync. A skip, a half done or a time that
 * does not read as a time is no finish.
 *
 * One action half is not a press: the Whop writers give an action item
 * finished with Done alone (isDoneOnly in world/action-items.ts) that Whop
 * lists as finished its action half: the webhook at its watch half's moment,
 * the backfill and the catch-up at Whop's own time for the lesson
 * (whopActionTime there). Such a row counts on the day of its watch half when
 * that half is a real finish or carries the same time, and on no day when a
 * login or visit sync stamped its watch half, as every row a sync brings in.
 */
export function finishedAt(row: FinishRow, requiresAction: boolean): number | null {
  if (row.completed_at == null) return null;
  const watched = Date.parse(row.completed_at);
  if (!Number.isFinite(watched)) return null;
  const watchedKnown = row.completed_at_real === true;
  if (!requiresAction) return watchedKnown ? watched : null;
  if (row.action_completed_at == null) return null;
  const acted = Date.parse(row.action_completed_at);
  if (!Number.isFinite(acted)) return null;
  if (watchedKnown) return Math.max(watched, acted);
  return watched <= acted ? acted : null;
}

/**
 * Triple Threat's count: the most lessons really finished (finishedAt) on one
 * calendar day in UTC, the streak's own day. `requiresAction` holds every
 * lesson of the course (lesson id to requires_action); a row for a lesson not
 * in it is left out, as the evaluator has always left out rows it has no
 * lesson for. Each lesson counts once.
 */
export function mostFinishedInOneDay(
  rows: readonly FinishRow[],
  requiresAction: ReadonlyMap<string, boolean>,
): number {
  const byDay = new Map<string, Set<string>>();
  for (const row of rows) {
    const needsAction = requiresAction.get(row.lesson_id);
    if (needsAction === undefined) continue;
    const at = finishedAt(row, needsAction);
    if (at === null) continue;
    const day = new Date(at).toISOString().slice(0, 10);
    let lessons = byDay.get(day);
    if (!lessons) byDay.set(day, (lessons = new Set()));
    lessons.add(row.lesson_id);
  }
  let most = 0;
  for (const lessons of byDay.values()) most = Math.max(most, lessons.size);
  return most;
}

/**
 * Habit Builder's count: how many days of the student's current streak fall
 * on or after the course switch's date (UTC, `YYYY-MM-DD`, the date
 * resetDateUtc gives). The streak (student_streaks) is a run of consecutive
 * days ending at last_streak_date, current_streak long; the days before the
 * switch's date are cut off. The flame keeps the whole run; this count is
 * only what the badge reads. No streak, no last date, a last date before the
 * switch or a date that does not read as one: 0.
 *
 * The stored run is the one the student last ticked: the badge is judged on
 * every tick (every lesson, action item and sync that ticks the streak runs
 * the evaluator after it), so a run that reaches 7 is seen at its 7th day.
 */
export function streakDaysSinceSwitch(
  streak: { current_streak: number | null; last_streak_date: string | null } | null,
  switchDate: string,
): number {
  const current = streak?.current_streak ?? 0;
  const last = streak?.last_streak_date ?? null;
  if (!(current > 0) || last == null) return 0;
  const lastMs = Date.parse(`${last.slice(0, 10)}T00:00:00Z`);
  const switchMs = Date.parse(`${switchDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(lastMs) || !Number.isFinite(switchMs) || lastMs < switchMs) return 0;
  return Math.min(current, Math.round((lastMs - switchMs) / DAY_MS) + 1);
}

/** A student as the share reads them. */
export interface ShareMember {
  membership_status: string | null;
  csm_exempt: boolean | null;
  /** A team_members row has this student's sign-in (team_members.id = students.supabase_user_id). */
  is_team: boolean;
}

/**
 * Who the share beside each badge divides by (v112): every active member
 * right now, membership active or past_due, not a team member and not CSM
 * exempt, whether or not they have opened the app. New members count from
 * the day they join; a member who left (canceled, expired, no status) does
 * not. The holders counted are the holders among these.
 */
export function countsInShare(m: ShareMember): boolean {
  return (m.membership_status === "active" || m.membership_status === "past_due") && m.csm_exempt !== true && !m.is_team;
}

/**
 * The share, 0 to 100, to one decimal, half up: Postgres's
 * round(100.0 * holders / members, 1), in whole numbers so no float decides
 * a half. 0 when there are no members.
 */
export function sharePercent(holders: number, members: number): number {
  if (!(members > 0)) return 0;
  return Math.floor((2000 * holders + members) / (2 * members)) / 10;
}
