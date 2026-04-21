export const WHOP_AUTHORIZE_URL = "https://api.whop.com/oauth/authorize";
export const WHOP_TOKEN_URL = "https://api.whop.com/oauth/token";
export const WHOP_USERINFO_URL = "https://api.whop.com/oauth/userinfo";
export const WHOP_API_BASE = "https://api.whop.com/api/v1";

// V3: 33 lessons across 4 regions (30-day sprint)
export const TOTAL_LESSONS = 33;
export const TOTAL_DAYS = 30;
export const TOTAL_REGIONS = 4;

// The discount unlocks on the final lesson of Region 2 (l18, day 15)
export const DISCOUNT_GATE_LESSON_ID = "l18";

export const LESSON_TYPE_LABELS: Record<string, string> = {
  setup: "Setup",
  watch: "Watch",
  action: "Action",
};
