export const WHOP_AUTHORIZE_URL = "https://api.whop.com/oauth/authorize";
export const WHOP_TOKEN_URL = "https://api.whop.com/oauth/token";
export const WHOP_USERINFO_URL = "https://api.whop.com/oauth/userinfo";
export const WHOP_API_BASE = "https://api.whop.com/api/v1";

// Whop plan IDs that count as "paying customers" — i.e., students
// that SHOULD get CSM tasks, day-28 DMs, and count in dashboard
// metrics. Allowlist design: any plan_id NOT in this set is
// treated as non-paying (free / promo / partner) and skipped by
// every operational surface, regardless of membership_status.
//
// Free-plan users still get FULL student-side access (login,
// dashboard, lessons, achievements) — they're just invisible to
// admin and don't trigger outreach.
//
// If you add a new PAID plan in Whop, add its ID here AND update
// the matching list in supabase/migrations/2026_v79_whop_plan_id.sql
// (rebuild_daily_snapshots RPC). The sync runner logs a warning
// each night for any plan_id outside this set so we notice if a
// new paid plan slips by un-listed.
export const PAYING_WHOP_PLAN_IDS = new Set<string>([
  "plan_4ZrwR4PmBsVsx",
  "plan_fMMqxAljrzu75",
]);

/**
 * CSM tasks (pace / stalled / no-ship / not-activated / engagement
 * alerts) only fire for students currently inside their 30-day sprint
 * window. Students past day 30 are graduates or deeply lapsed —
 * generating "you're stalled" tasks for someone on day 153 makes
 * no sense; they've either completed enough or aren't coming back.
 *
 * v75.15 — added after Karlo reported a stalled-task generated for a
 * 5-month-old student. Returns the ISO cutoff for "joined_at >= X"
 * filters on the CSM crons.
 */
export const CSM_SPRINT_WINDOW_DAYS = 30;
export function csmSprintWindowCutoffIso(): string {
  return new Date(
    Date.now() - CSM_SPRINT_WINDOW_DAYS * 86_400_000,
  ).toISOString();
}

/**
 * Canonical sprint day counter, 1-indexed: Day 1 starts the moment the
 * anchor timestamp (first_paid_at, with joined_at fallback) is stamped.
 *
 * v75.57 — extracted so every producer AND consumer of "Day N" uses the
 * exact same anchor + rounding. Before this, check-na-tasks created
 * stalled.*.dayN tasks from floor(days since students.created_at) while
 * check-csm-tasks section 3c auto-dismissed them from ceil(days since
 * first_paid_at) — for any student whose first_paid_at preceded their
 * row creation by >3 days (every backfilled student), the task was born
 * and auto-dismissed within the same cron window, silently neutralizing
 * the Not-Activated pipeline. One helper, one definition, no drift.
 */
export function sprintDayNumber(anchorIso: string): number {
  return Math.max(
    1,
    Math.ceil((Date.now() - new Date(anchorIso).getTime()) / 86_400_000),
  );
}

// Approximate lesson count used as a fallback denominator when the
// actual lessons array isn't available (e.g. in admin views where
// we only fetch student records). Kept in sync with the live DB
// after each content migration:
//   v4 seeded 63, v6 deleted 4 (l034, l040, l043, l044) → 59,
//   v13 deleted 2 (l006, l012) → 57,
//   v20-v24 expanded the R3+R4 curriculum and v26+v50 dropped l058-
//   l063 → 65 rows in the DB,
//   v74 excludes l057 (bounty onboarding) from the sprint count →
//   64 is the canonical "lessons in the sprint" number.
// Always prefer the live filtered count over this constant when
// you have it. Always clamp displayed percentages at 100%.
export const TOTAL_LESSONS = 64;
export const TOTAL_DAYS = 30;
export const TOTAL_REGIONS = 4;

/**
 * Clamp a raw 0–N completion / total to a 0–100 integer percentage.
 * Defends against denominator drift (constant out of sync with DB)
 * + division-by-zero. Always use this for any % shown to a user.
 */
export function progressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  const raw = (completed / total) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// The discount unlocks on the final lesson of Region 2 (l046, day 15)
// v17 moved the gate from l046 (now "Static Ad Safezone Guidelines",
// a 3m info video) → l049 ("Action Item: Static Ads"), the natural
// "you've shipped your static ad, here's your discount" moment.
export const DISCOUNT_GATE_LESSON_ID = "l049";

// The Playbook (Map 2) unlocks the moment the student finishes l078
// "How I Approach Research / Coming Up With Ad Ideas" - the last
// watch lesson in R4 (day 28). Everything after l078 (l057 bounty
// onboarding, l058-l063 action lessons) is post-Playbook material.
// Bounty Access is a SEPARATE milestone and does NOT unlock the
// Playbook on its own (corrected v72.7 - prior gate was
// `r4Complete || bountyAccessClaimedAt` which both let bounty alone
// unlock it AND required ALL R4 lessons including post-Playbook
// action items, neither matching product intent).
export const PLAYBOOK_UNLOCK_LESSON_ID = "l078";

// Lessons that exist in the lessons table but DON'T count toward
// the sprint (region progress, achievements, graduation tally).
// - l057 "Complete Ad Bounty Onboarding" is bounty-program
//   onboarding, not curriculum. Without this exclusion R4
//   displays 14/15 forever for any student who finishes the
//   curriculum but hasn't applied to bounty yet (Karlo's bug
//   2026-05-29 + 2026-05-30).
// Keep this set tight - most lessons should count. Add an entry
// only when the lesson is structurally non-curriculum (onboarding,
// setup steps that gate external integrations, etc.).
export const SPRINT_EXCLUDED_LESSON_IDS = new Set<string>(["l057"]);

// Time window for the 30% discount: complete all of R1 + R2 within
// this many days of joining Whop. Measured server-side at claim time.
// 14 days / 2 weeks from joining — once past day 14 there is no
// discount, and the claim checkpoint + sidebar block are hidden so a
// student can't fill out the form only to hit a server error.
export const DISCOUNT_WINDOW_DAYS = 14;

// Real launch date for the 30-Day Sprint platform. The single
// source of truth for "ignore everything that happened before this."
// Updating this one constant moves every admin surface + CSM task
// pipeline forward together (which is what you want — diverging
// cutoffs was a pre-launch artifact, not a feature).
//
// History:
//   2026-05-01 — first admin cutoff (cleared test accounts)
//   2026-05-18 — TASKS_STUDENT_JOIN_CUTOFF moved (CSM launched separately)
//   2026-06-01 — unified launch (admin + tasks both move here)
//   2026-05-25 — moved BACK 5 days (Monday) so Karlo has live data
//                to drive the admin dashboard during launch-week
//                testing. Real launch day is still ~2026-06-01 in
//                Karlo's head, but the cutoff is a testing tool now,
//                not a launch flag.
//   2026-05-30 — admin stays at 2026-05-25; TASKS_STUDENT_JOIN_CUTOFF
//                hardcoded to 2026-05-28 (real launch day) so CSM
//                tasks don't fire for the launch-week test cohort
//                between 5/25–5/27. See the constant below.
//
// If you ever need to diverge admin and tasks again, hardcode a
// different ISO string on the constant that needs to move, instead
// of pointing it at LAUNCH_DATE.
export const LAUNCH_DATE = "2026-05-25T00:00:00.000Z";

// Hard cutoff for admin list views — only show students who joined
// on or after the launch date. Filters Students list, dashboard
// tiles, month-2 conversion, Journey, Insights, Discord test page.
//
// The Insights `daily_progress_snapshots` table is backfilled to
// 2026-01-01 separately — it stays intact and shows pre-launch
// trend history. That backfill is NOT gated by this constant.
export const ADMIN_STUDENT_JOIN_CUTOFF = LAUNCH_DATE;

// Cutoff used ONLY by the CSM task pipeline (task generation cron
// + /api/admin/tasks read filter + dashboard "Open tasks" count).
// Decoupled by name so it can diverge from ADMIN_STUDENT_JOIN_CUTOFF
// when Karlo wants admin to surface a test cohort that the task
// system should ignore.
//
// 2026-05-30 — hardcoded to 2026-05-28 (real launch day). Admin
// stays at LAUNCH_DATE = 2026-05-25 so the live testing students
// from launch week still show up in /admin/students etc., but the
// CSM task pipeline doesn't manufacture stalled / pace / nolessons
// tasks for them.
export const TASKS_STUDENT_JOIN_CUTOFF = "2026-05-28T00:00:00.000Z";

// The "editing breakdowns" group: 9 R2 lessons that collapse into a
// single map node. The student opens the group and chooses Watch or
// Skip per part. Both Watch + Skip count toward path progression so
// they can keep moving. Grouped lessons are sorted by day/sort_order.
export const LESSON_GROUPS: Record<
  string,
  { id: string; title: string; description: string; lessonIds: string[] }
> = {
  editing_breakdowns: {
    id: "editing_breakdowns",
    title: "Editing Breakdowns",
    description:
      "Optional but extremely important — a couple of hours total. If you want to keep momentum, you can skip parts and come back later. This is where the craft lives.",
    lessonIds: [
      "l032",
      "l033",
      "l035",
      "l036",
      "l037",
      "l038",
      "l039",
      "l041",
      "l042",
    ],
  },
};

/** Convenience: map a lesson id → its group id, or null if ungrouped. */
export function lessonGroupOf(lessonId: string): string | null {
  for (const g of Object.values(LESSON_GROUPS)) {
    if (g.lessonIds.includes(lessonId)) return g.id;
  }
  return null;
}

export const LESSON_TYPE_LABELS: Record<string, string> = {
  setup: "Setup",
  watch: "Watch",
  action: "Action",
};
