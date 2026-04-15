export interface TeamMember {
  id: string;
  email: string;
  full_name: string;
  role: "founder" | "csm" | "admin";
  created_at: string;
}

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
  created_at: string;
  updated_at: string;
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
