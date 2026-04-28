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

export interface Student {
  id: string;
  supabase_user_id: string | null;
  whop_user_id: string;
  whop_membership_id: string | null;
  email: string | null;
  name: string | null;
  discord_username: string | null;
  avatar_url: string | null;
  membership_status: "active" | "canceled" | "past_due" | "expired";
  joined_at: string;
  last_active_at: string;
  whop_access_token: string | null;
  whop_refresh_token: string | null;
  last_watch_sync_at: string | null;
  whop_last_sync_error: string | null;
  whop_last_sync_error_at: string | null;
  whop_last_sync_unmatched: string[] | null;
  whop_last_sync_fetched_count: number | null;
  whop_last_sync_matched_count: number | null;
  current_streak: number;
  longest_streak: number;
  last_streak_date: string | null;
  current_title: StudentTitle;
  onboarding_completed_at: string | null;
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
  status: "pending" | "approved" | "rejected";
  promo_code: string | null;
  whop_promo_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
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
