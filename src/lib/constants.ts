export const WHOP_AUTHORIZE_URL = "https://api.whop.com/oauth/authorize";
export const WHOP_TOKEN_URL = "https://api.whop.com/oauth/token";
export const WHOP_USERINFO_URL = "https://api.whop.com/oauth/userinfo";
export const WHOP_API_BASE = "https://api.whop.com/api/v1";

// V4: 63 lessons across 4 regions (30-day sprint, every real Whop video as a node)
export const TOTAL_LESSONS = 63;
export const TOTAL_DAYS = 30;
export const TOTAL_REGIONS = 4;

// The discount unlocks on the final lesson of Region 2 (l046, day 15)
export const DISCOUNT_GATE_LESSON_ID = "l046";

// Time window for the 30% discount: complete all of R1 + R2 within
// this many days of joining Whop. Measured server-side at claim time.
export const DISCOUNT_WINDOW_DAYS = 14;

export const LESSON_TYPE_LABELS: Record<string, string> = {
  setup: "Setup",
  watch: "Watch",
  action: "Action",
};
