export interface WhopTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
}

export interface WhopUserInfo {
  sub: string;
  name: string;
  email: string;
  email_verified: boolean;
  picture: string;
  username: string;
}

export interface WhopMembership {
  id: string;
  product: { id: string; name: string };
  user: {
    id: string;
    username: string;
    name: string;
    email: string;
  };
  status: string;
  status_reason: string;
  cancel_at_period_end: boolean;
  created_at: string;
  joined_at: string;
  renewal_period_start: string;
  renewal_period_end: string;
  metadata: Record<string, unknown>;
}

/**
 * Single lesson interaction record from Whop.
 * GET /api/v1/course_lesson_interactions
 */
export interface WhopLessonInteraction {
  id: string;
  completed: boolean;
  created_at: string;
  lesson: {
    id: string;
    title: string;
    chapter?: { id: string };
  };
  user: {
    id: string;
    name?: string;
  };
}

export interface WhopLessonInteractionsResponse {
  data: WhopLessonInteraction[];
  page_info?: {
    end_cursor?: string;
    has_next_page?: boolean;
  };
}

/**
 * Webhook payload for lesson completion events.
 * Event: course_lesson_interaction.completed
 */
export interface WhopLessonInteractionWebhookData {
  user: { id: string };
  lesson?: { id: string };
  lesson_id?: string;
  completed?: boolean;
  completed_at?: string;
}

export type WhopWebhookPayload =
  | { event: "membership.activated"; data: WhopMembership }
  | { event: "membership.went_valid"; data: WhopMembership }
  | { event: "membership.deactivated"; data: WhopMembership }
  | { event: "membership.went_invalid"; data: WhopMembership }
  | { event: "payment.succeeded"; data: WhopMembership }
  | {
      event: "course_lesson_interaction.completed";
      data: WhopLessonInteractionWebhookData;
    }
  | { event: string; data: unknown };

export interface WhopPromoCodeRequest {
  code: string;
  amount_off: number;
  promo_type: "percentage" | "flat_amount";
  base_currency: string;
  company_id: string;
  new_users_only: boolean;
  one_per_customer: boolean;
  stock: number;
  promo_duration_months: number;
  plan_ids?: string[];
  product_id?: string;
}

export interface WhopPromoCodeResponse {
  id: string;
  code: string;
  amount_off: number;
  promo_type: string;
  created_at: string;
}
