export interface TeamMember {
  id: string;
  email: string;
  full_name: string;
  role: "founder" | "csm" | "admin";
  created_at: string;
}

// V3 title system — 5 ranks based on completed regions (0-4)
export type StudentTitle =
  | "recruit"
  | "explorer"
  | "ad_creator"
  | "strategist"
  | "et_pro";

/**
 * v46 — students table is now identity-only. State that used to live
 * here was split into 5 sibling tables (one per function):
 *
 *   - student_milestones    — onboarding + sprint progression
 *   - student_streaks       — streak counters
 *   - student_whop_sync     — Whop tokens + watch-sync diagnostics
 *   - student_celebrations  — which celebration overlays have been shown
 *   - student_dm_log        — outbound DM-sent flags
 *
 * If you're tempted to add another column here, read CLAUDE.md →
 * "Table-level bounded contexts" first. New state probably belongs
 * in its own table, not on `students`.
 */
export interface Student {
  id: string;
  supabase_user_id: string | null;
  whop_user_id: string;
  whop_membership_id: string | null;
  email: string | null;
  name: string | null;
  discord_username: string | null;
  discord_user_id: string | null;
  avatar_url: string | null;
  membership_status: "active" | "canceled" | "past_due" | "expired";
  joined_at: string;
  last_active_at: string;
  /** v75.13: set on the transition INTO canceled/expired by the
   *  Whop webhook and sync runner. The snapshot cron reads this for
   *  churned_count; previously it used updated_at which fires on
   *  every sync run (so every canceled student counted as "churned
   *  today" every day). Null for active / past_due / never-canceled. */
  canceled_at: string | null;
  /** v79: the Whop plan_id this membership belongs to. Drives the
   *  paying / free classification via PAYING_WHOP_PLAN_IDS — any
   *  plan_id NOT in that allowlist is treated as non-paying and
   *  excluded from CSM tasks, dashboard metrics, etc. Populated by
   *  the webhook + sync runner + OAuth callback self-heal. */
  whop_plan_id: string | null;
  /** v75.18: original Whop signup date across ALL of this user's
   *  memberships, not just the current one. Never moves on renewal.
   *  joined_at = current subscription cycle start (could be recent
   *  even for a 6-month customer who just renewed).
   *  first_paid_at = first-ever membership creation = "true Day 1."
   *  Used by every "is this a launch-cohort student / first-time
   *  joiner?" check across the app. */
  first_paid_at: string | null;
  /** Computed/derived from the streak count. Cached here for the UI. */
  current_title: StudentTitle;
  // Admin gates (stay on students — they're identity-adjacent admin flags)
  ad_submissions_verified: boolean;
  ad_submissions_verified_at: string | null;
  ad_submissions_verified_by: string | null;
  /** v38: exclude this student from CSM task generation + Day-28 DM.
   *  Used for the team's own dummy accounts. */
  csm_exempt: boolean;
  /** v51 (Phase 1, brief v3): set true when the NA cron's Day-10
   *  escalation fires. Stops further NA pings. UI badge optional. */
  high_churn_risk: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * v46 → v51 — onboarding + sprint progression milestones. One row per
 * student. Each column null/false = "not reached yet".
 *
 *   onboarding_completed_at         — first-run onboarding finished
 *                                      (legacy 3-step OnboardingFlow,
 *                                       superseded by the v51 video
 *                                       gate + WYH panel)
 *   first_sprint_login_at           — first authenticated visit to the
 *                                      app (powers has_logged_into_app)
 *   first_dashboard_login_at        — v51: first /dashboard load
 *                                      post-OAuth. Drives the intro
 *                                      video auto-play gate.
 *   intro_video_threshold_met       — v51: intro video watched end
 *                                      to end (column name kept for
 *                                      back-compat — v72.4 dropped
 *                                      the % threshold for a full
 *                                      `ended` event). Sticky.
 *   why_youre_here_panel_dismissed  — v51: clicked Let's go on the
 *                                      final WYH panel card. Sticky.
 *   bounty_access_claimed_at        — Bounty Access webhook fired.
 *                                      Stamp comes from Zak's system
 *                                      only (v50). Unlocks the
 *                                      Playbook.
 *   first_client_landed_at          — self-reported on Map 2 (v2)
 *   playbook_welcome_seen_at        — saw the Map 2 intro once (v2)
 */
export interface StudentMilestones {
  student_id: string;
  onboarding_completed_at: string | null;
  first_sprint_login_at: string | null;
  first_dashboard_login_at: string | null;
  intro_video_threshold_met: boolean;
  why_youre_here_panel_dismissed: boolean;
  bounty_access_claimed_at: string | null;
  first_client_landed_at: string | null;
  playbook_welcome_seen_at: string | null;
  updated_at: string;
}

/** v54 - per-student per-region quiz gate state. One row per pair;
 *  null = no row yet (never opened the quiz). v65 - added scoring
 *  fields so the region card can show best/last % and the gate
 *  can use a 50% threshold instead of 100%-deck-clear. */
export interface StudentRegionQuiz {
  student_id: string;
  region_id: string;
  quiz_passed_at: string | null;
  quiz_attempts: number;
  /** Best percentage ever scored on this region's quiz (0-100).
   *  Null until first attempt. v65. */
  best_score_pct: number | null;
  /** Most recent attempt's percentage (0-100). Null until first
   *  attempt. v65. */
  last_score_pct: number | null;
  /** Timestamp of the most recent attempt. v65. */
  last_attempt_at: string | null;
}

/** v53 (Phase 5) - achievement catalog row. */
export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: "common" | "uncommon" | "rare" | "legendary";
  sort_order: number;
}

/** v53 (Phase 5) - per-student unlock row. */
export interface StudentAchievement {
  student_id: string;
  achievement_id: string;
  unlocked_at: string;
}

/** v53 (Phase 5) - aggregated stats from achievement_unlock_stats
 *  view. unlock_pct is 0-100 (1 decimal). */
export interface AchievementUnlockStats {
  id: string;
  unlocked_count: number;
  total_count: number;
  unlock_pct: number;
}

/** v46 — streak counters, one row per student. */
export interface StudentStreaks {
  student_id: string;
  current_streak: number;
  longest_streak: number;
  last_streak_date: string | null;
  updated_at: string;
}

/** v46 — Whop OAuth tokens + watch-history sync diagnostics. */
export interface StudentWhopSync {
  student_id: string;
  access_token: string | null;
  refresh_token: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_sync_error_at: string | null;
  last_sync_unmatched: string[] | null;
  last_sync_fetched: number | null;
  last_sync_matched: number | null;
  updated_at: string;
}

/** v46 — celebration overlay state. Tracks which one-shot overlays
 *  have already played so we don't re-fire them. */
export interface StudentCelebrations {
  student_id: string;
  last_streak_milestone_shown: number;
  month_review_seen_at: string | null;
  celebrated_region_ids: string[];
  updated_at: string;
}

/** v46 — outbound DM log. Add a column per DM type as new DM
 *  flows ship. */
export interface StudentDmLog {
  student_id: string;
  day28_dm_sent_at: string | null;
  updated_at: string;
}

/**
 * v42 / v72: One row per always-on node on Map 2 (the Playbook hub).
 * v72 collapsed to 3 rows: pb_submit_bounties, pb_build_portfolio,
 * pb_apply_job_board. The pb_land_first_client milestone node was
 * dropped. Each node's sheet body now renders a standalone HTML
 * article (public/playbook/<article_slug>/index.html) inside an
 * iframe; doc_content is no longer rendered. is_milestone stays on
 * the table but all 3 nodes are always-on (false).
 */
export interface PlaybookNode {
  id: string;
  position: number;
  title: string;
  subtitle: string | null;
  doc_content: string;
  video_url: string | null;
  is_milestone: boolean;
  /** v72 - folder under public/playbook/ whose index.html the node
   *  sheet renders in an iframe. Null only on legacy rows. */
  article_slug: string | null;
  created_at: string;
  updated_at: string;
}

// V3: Regions replace Checkpoints
export type RegionId = "r1" | "r2" | "r3" | "r4";
export type Terrain = "shore" | "forest" | "mountains" | "city";

export interface Region {
  id: RegionId;
  order_num: 1 | 2 | 3 | 4;
  name: string;
  subtitle: string;
  tagline: string;
  terrain: Terrain;
  days_label: string;
  day_start: number;
  day_end: number;
  is_discount_gate: boolean;
  created_at: string;
}

// V3: Lessons replace Tasks
export type LessonType = "watch" | "action" | "setup";

export interface Lesson {
  id: string;
  region_id: RegionId;
  day: number;
  type: LessonType;
  title: string;
  description: string | null;
  duration_label: string | null;
  is_gate: boolean;
  is_boss: boolean;
  whop_lesson_id: string | null;
  discord_channel: string | null;
  sort_order: number;
  /**
   * Compound lesson: requires BOTH the briefing video to be watched
   * (auto-synced via whop_lesson_id) AND the action to be manually
   * checked off ("I shipped the ad"). Lesson is fully complete only
   * when both conditions are met.
   */
  requires_action: boolean;
  /** Brief shown in the LessonSheet's "Ship the ad" section */
  action_brief: string | null;
  /**
   * Solo-optional lesson — the LessonSheet renders a "Skip" button
   * alongside the normal watch/complete actions. Skipping still
   * counts toward path advancement (via the skipped_at column),
   * letting students bypass non-essential content without forfeiting
   * progress. Distinct from group-collapsed lessons (lesson_group_id):
   * those render as a single map node; is_optional lessons render
   * individually.
   */
  is_optional: boolean;
  /**
   * Group id for collapsing this lesson into a shared map node. Used
   * for the optional "Editing Breakdowns" set in R2 — see
   * src/lib/constants.ts:LESSON_GROUPS. Null = standalone.
   */
  lesson_group_id: string | null;
  created_at: string;
}

export interface StudentLessonCompletion {
  id: string;
  student_id: string;
  lesson_id: string;
  /** Timestamp when the watch part (or non-compound lesson) was completed */
  completed_at: string | null;
  /** Timestamp when the manual action was checked off (compound lessons only) */
  action_completed_at: string | null;
  /**
   * Timestamp when the student deliberately *skipped* this lesson
   * (only meaningful for grouped/optional lessons). A skipped lesson
   * counts toward path progression so the student can keep moving,
   * but it's flagged so the journal/workshop can show it differently.
   */
  skipped_at: string | null;
  /**
   * Discord message URL the student pastes after shipping an action item
   * to #ad-review. Only meaningful for action-item lessons (l018, l020,
   * l022, l024, l049). Format:
   *   https://discord.com/channels/<guild>/<channel>/<message>
   * Validated by the DB CHECK constraint added in v28.
   */
  discord_message_link: string | null;
}

export interface DailyNote {
  id: string;
  student_id: string;
  note_date: string;
  content: string;
  created_at: string;
  updated_at: string;
}

// V3: lesson_notes now references lessons (lesson_id column)
export interface LessonNote {
  id: string;
  student_id: string;
  lesson_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface DiscountRequest {
  id: string;
  student_id: string;
  status: "pending" | "approved" | "rejected" | "applied";
  promo_code: string | null;
  whop_promo_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  applied_at: string | null;
  applied_by: string | null;
  created_at: string;
}

export interface DisengagementAlert {
  id: string;
  student_id: string;
  alert_type: "no_tasks_7d" | "no_activation_14d" | "no_login_5d" | "week2_no_start";
  message: string;
  is_dismissed: boolean;
  dismissed_by: string | null;
  dismissed_at: string | null;
  created_at: string;
}

// V3: Quiz now linked to region (not checkpoint)
export interface Quiz {
  id: string;
  region_id: string;
  title: string;
  passing_percent: number;
  sort_order: number;
  created_at: string;
}

export interface QuizQuestion {
  id: string;
  quiz_id: string;
  sort_order: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  created_at: string;
}

export interface StudentQuizAttempt {
  id: string;
  student_id: string;
  quiz_id: string;
  score: number;
  total: number;
  passed: boolean;
  answers: { questionId: string; selectedIndex: number; correct: boolean }[];
  completed_at: string;
}

export interface MonthReview {
  id: string;
  student_id: string;
  snapshot_data: {
    lessons_completed: number;
    lessons_total: number;
    current_title: StudentTitle;
    longest_streak: number;
    current_streak: number;
    notes_written: number;
    quizzes_passed: number;
    quizzes_total: number;
    regions_completed: number;
    regions_total: number;
    bounties_submitted: number;
  };
  generated_at: string;
}

// CSM layer (v27) — Astrid's task queue + DM templates + admin config

export type TemplateBucket =
  | "crushing"
  | "on_track"
  | "at_risk"
  | "cancel_path"
  | "event"
  | "admin";

// v58 - day-prefixed bucket labels (was W1/W2/W3/W4/X from the
// week-based v1 model). Strings stay free-form so a new bucket
// like 'D28' or 'M3' can land via migration without a type change.
export type TemplateWeek = string | null;

export interface Template {
  id: string;
  scenario_id: string;
  bucket: TemplateBucket;
  week: TemplateWeek;
  title: string;
  trigger_description: string;
  intent: string | null;
  tone: string | null;
  variables: string[];
  body: string;
  word_count: number | null;
  is_active: boolean;
  is_admin_only: boolean;
  /** True for templates Karlo created via /admin/templates. Built-ins
   *  (D1, W1.1, W1.2, …) have this set to false. */
  is_custom: boolean;
  /** DSL the CSM cron evaluates. Null for built-ins (hardcoded). */
  trigger_config: TriggerConfig | null;
  created_at: string;
  updated_at: string;
}

/* ───────── Custom-trigger DSL (v34) ─────────
 *
 * Flat AND of conditions. The UI on /admin/templates exposes this
 * as plain-English: "Send this DM when ALL of these are true:".
 * If Karlo needs OR logic, the workaround is to create a second
 * template with the alternative condition set.
 */

/** Operators presented to the user as plain-English chips. */
export type ConditionOp =
  | "is"          // = (number/enum) or true (boolean)
  | "is_not"      // ≠ (number/enum) or false (boolean)
  | "at_least"    // ≥
  | "more_than"   // >
  | "at_most"     // ≤
  | "less_than";  // <

export type ConditionMetric =
  | "day_number"
  | "total_lessons_watched"
  | "region_lessons_watched"
  | "region_completion_pct"
  | "region_complete"
  | "lesson_shipped"
  | "lesson_watched"
  | "days_since_last_completion"
  | "days_since_last_login"
  | "membership_status"
  // v39: pace metrics — completed-vs-expected.
  | "progress_ratio"
  | "progress_label"
  | "region_pace"
  // v44: has the student authenticated into the sprint app at all?
  // Distinguishes "bought on Whop but never showed up" from "actually
  // came over and logged in." Stored as students.first_sprint_login_at;
  // truthy = condition is true.
  | "has_logged_into_app";

/** Numeric / boolean / enum conditions all share the discriminator
 *  but have different shapes. Keep them as one union and let the
 *  evaluator pick based on metric type. */
export type Condition =
  | {
      metric: "day_number"
        | "total_lessons_watched"
        | "days_since_last_completion"
        | "days_since_last_login"
        | "progress_ratio";
      op: ConditionOp;
      value: number;
    }
  | {
      metric: "region_lessons_watched" | "region_completion_pct";
      region: RegionId;
      op: ConditionOp;
      value: number;
    }
  | {
      metric: "region_complete";
      region: RegionId;
      op: "is" | "is_not";
    }
  | {
      metric: "lesson_shipped" | "lesson_watched";
      lesson_id: string;
      op: "is" | "is_not";
    }
  | {
      metric: "membership_status";
      op: "is" | "is_not";
      value: "active" | "canceled" | "past_due" | "expired";
    }
  | {
      metric: "progress_label" | "region_pace";
      op: "is" | "is_not";
      value: "behind" | "on_pace" | "ahead";
    }
  | {
      // v44 — boolean: has the student ever authed into the sprint app?
      metric: "has_logged_into_app";
      op: "is" | "is_not";
    };

export interface TriggerConfig {
  all: Condition[];
}

export type TaskStatus = "open" | "completed" | "dismissed";

export interface Task {
  id: string;
  student_id: string;
  scenario_id: string;
  template_id: string | null;
  status: TaskStatus;
  behavior_summary: string | null;
  created_at: string;
  completed_at: string | null;
  completed_by: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  notes: string | null;
}

export interface AdminConfigRow {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

// Discount feedback form (v29)

export type FeedbackQuestionType = "scale" | "multi_choice" | "open_text";

export interface DiscountFeedbackQuestion {
  id: string;
  order_num: number;
  question_text: string;
  question_type: FeedbackQuestionType;
  options: string[] | null;
  scale_min: number | null;
  scale_max: number | null;
  is_required: boolean;
  is_active: boolean;
  created_at: string;
}

export interface DiscountFeedbackResponse {
  id: string;
  discount_request_id: string;
  question_id: string;
  answer_scale: number | null;
  answer_choice: string | null;
  answer_text: string | null;
  created_at: string;
}

/** Input shape sent to the submit-feedback endpoint. */
export interface DiscountFeedbackAnswer {
  question_id: string;
  answer_scale?: number | null;
  answer_choice?: string | null;
  answer_text?: string | null;
}

// Computed helpers (not stored in DB)
export function getDayNumber(joinedAt: string): number {
  const joined = new Date(joinedAt);
  const now = new Date();
  return Math.max(1, Math.ceil((now.getTime() - joined.getTime()) / 86400000));
}

export function getThirtyDayMark(joinedAt: string): Date {
  const joined = new Date(joinedAt);
  return new Date(joined.getTime() + 30 * 86400000);
}
