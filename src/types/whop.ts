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

export interface WhopWebhookPayload {
  event: string;
  data: WhopMembership;
}

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
