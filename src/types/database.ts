export interface TeamMember {
  id: string;
  email: string;
  full_name: string;
  role: "founder" | "csm" | "admin";
  created_at: string;
}

export type StudentTitle =
  | "recruit"
  | "explorer"
  | "apprentice"
  | "ad_creator"
  | "strategist"
  | "bounty_hunter"
  | "ecomtalent_pro";

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
  current_streak: number;
  longest_streak: number;
  last_streak_date: string | null;
  current_title: StudentTitle;
  created_at: string;
  updated_at: string;
}

export interface Checkpoint {
  id: string;
  sort_order: number;
  title: string;
  subtitle: string | null;
  theme_key: string;
  is_discount_gate: boolean;
  created_at: string;
}

export interface Task {
  id: string;
  week: number;
  sort_order: number;
  title: string;
  description: string | null;
  task_type: "setup" | "watch" | "action";
  is_activation_point: boolean;
  activation_point_id: "AP1" | "AP2" | "AP3" | null;
  is_discount_required: boolean;
  checkpoint_id: string;
  whop_lesson_id: string | null;
  created_at: string;
}

export interface StudentTaskCompletion {
  id: string;
  student_id: string;
  task_id: string;
  completed_at: string;
}

export interface DailyNote {
  id: string;
  student_id: string;
  note_date: string;
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

// V2 types

export interface LessonNote {
  id: string;
  student_id: string;
  task_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface Quiz {
  id: string;
  checkpoint_id: string;
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

export interface HiddenReward {
  id: string;
  trigger_type: string;
  trigger_value: Record<string, unknown>;
  reward_type: "personal_note" | "exclusive_resource" | "secret_task" | "early_access" | "shoutout";
  title: string;
  description: string;
  content: string | null;
  icon_path: string | null;
  sort_order: number;
  created_at: string;
}

export interface StudentReward {
  id: string;
  student_id: string;
  reward_id: string;
  unlocked_at: string;
  seen: boolean;
}

export interface MonthReview {
  id: string;
  student_id: string;
  snapshot_data: {
    tasks_completed: number;
    tasks_total: number;
    current_title: StudentTitle;
    longest_streak: number;
    current_streak: number;
    notes_written: number;
    quizzes_passed: number;
    quizzes_total: number;
    rewards_unlocked: number;
    checkpoints_completed: number;
    checkpoints_total: number;
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
