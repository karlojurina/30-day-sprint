export const WHOP_AUTHORIZE_URL = "https://api.whop.com/oauth/authorize";
export const WHOP_TOKEN_URL = "https://api.whop.com/oauth/token";
export const WHOP_USERINFO_URL = "https://api.whop.com/oauth/userinfo";
export const WHOP_API_BASE = "https://api.whop.com/api/v1";

export const TOTAL_TASKS = 23;
export const DISCOUNT_REQUIRED_TASKS = 13; // Legacy — superseded by checkpoint-based eligibility (Phase B)

export const WEEK_TITLES: Record<number, string> = {
  1: "Foundation + First Ads",
  2: "Level Up Your Editing",
  3: "Creative Strategy + Job Board",
  4: "Ad Bounties — The Activation Point",
};

export const TASK_TYPE_LABELS: Record<string, string> = {
  setup: "Setup",
  watch: "Watch",
  action: "Action",
};
