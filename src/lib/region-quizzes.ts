/**
 * Region-end quiz content registry (brief: lovro-brief-region-quiz).
 *
 * Karlo updates these rarely + the brief explicitly says no CMS
 * needed for now, so content lives in code. New regions plug in by
 * adding to REGION_QUIZ_REGISTRY with the format-specific card
 * shape.
 *
 * The data MODEL is per-format (no single universal shape) because
 * the brief flags that future formats (Tier Ranking, Vault Tumblers)
 * carry materially different data than Swipe Cards. Trying to force
 * one schema gets ugly fast.
 */

import type { RegionId } from "@/types/database";

// ─── Swipe Cards (Region 1) ───────────────────────────────────────────
export type SwipeCardQuestion =
  | {
      id: string;
      region_id: number;
      question_type: "true_false";
      question_text: string;
      correct_answer: "true" | "false";
      why_text: string;
    }
  | {
      id: string;
      region_id: number;
      question_type: "ab_pick";
      question_text: string;
      option_a: string;
      option_b: string;
      correct_answer: "a" | "b";
      why_text: string;
    };

export type QuizFormat =
  | "swipe_cards"
  | "stack_builder"
  | "tier_ranking"
  | "vault_tumblers";

export interface SwipeCardsQuiz {
  format: "swipe_cards";
  cards: SwipeCardQuestion[];
}

// Future-region types (placeholders so the union exists)
export interface StackBuilderQuiz {
  format: "stack_builder";
  cards: SwipeCardQuestion[];
}
export interface TierRankingQuiz {
  format: "tier_ranking";
  items: Array<{ id: string; label: string }>;
  correct_tiers: Record<string, "S" | "A" | "B" | "C">;
}
export interface VaultTumblersQuiz {
  format: "vault_tumblers";
  cards: SwipeCardQuestion[];
}

export type RegionQuiz =
  | SwipeCardsQuiz
  | StackBuilderQuiz
  | TierRankingQuiz
  | VaultTumblersQuiz;

// ─── Region 1 content (lovro-brief-region-quiz §03, final) ───────────
const R1_CARDS: SwipeCardQuestion[] = [
  // Mindset
  {
    id: "r1-q1",
    region_id: 1,
    question_type: "true_false",
    question_text:
      "Money should be your #1 focus when starting in Ecom Talent.",
    correct_answer: "false",
    why_text: "Money is a lagging indicator. Chase skills. Money follows.",
  },
  {
    id: "r1-q2",
    region_id: 1,
    question_type: "true_false",
    question_text:
      "If you watch every Ecom Talent video but skip the action items, you've still learned the material.",
    correct_answer: "false",
    why_text:
      "You entertained yourself. Skill comes from reps, not playback.",
  },
  {
    id: "r1-q3",
    region_id: 1,
    question_type: "true_false",
    question_text:
      "Stacking multiple skills can outperform being world-class at just one.",
    correct_answer: "true",
    why_text:
      "Skills compound. Editor + strategist + AI + copy = irreplaceable.",
  },

  // How Ads Work
  {
    id: "r1-q4",
    region_id: 1,
    question_type: "ab_pick",
    question_text:
      "An ad spent $100 and brought in $400 in sales. What's the ROAS?",
    option_a: "4x",
    option_b: "0.25x",
    correct_answer: "a",
    why_text: "Revenue ÷ spend. $400 / $100 = 4x.",
  },
  {
    id: "r1-q5",
    region_id: 1,
    question_type: "true_false",
    question_text:
      "An ad with high engagement (likes, shares, comments) actually costs LESS to show on Meta.",
    correct_answer: "true",
    why_text:
      "Meta lowers CPM for engaging content. They want people to stay on the platform.",
  },
  {
    id: "r1-q6",
    region_id: 1,
    question_type: "true_false",
    question_text:
      "If an ad performs badly on day 1, kill it immediately.",
    correct_answer: "false",
    why_text: "Test 3-7 days. Some winners look weak on day 1.",
  },

  // Direct Response
  {
    id: "r1-q7",
    region_id: 1,
    question_type: "true_false",
    question_text:
      "A cinematic high-production ad will usually outperform a raw iPhone ad on social media.",
    correct_answer: "false",
    why_text: "Pattern interrupt + authenticity wins. Ugly ads print.",
  },
  {
    id: "r1-q8",
    region_id: 1,
    question_type: "ab_pick",
    question_text:
      "You're making an ad for a back-pain relief device. Where should the ad OPEN?",
    option_a:
      "Someone wincing trying to get up from the couch, hand on lower back",
    option_b:
      "A clean studio shot of the device with a feature callout",
    correct_answer: "a",
    why_text:
      "Open with the problem. Get them nodding before you show the product.",
  },

  // Customer
  {
    id: "r1-q9",
    region_id: 1,
    question_type: "true_false",
    question_text:
      "Most editors spend 80% editing, 20% understanding the customer. Flip that.",
    correct_answer: "true",
    why_text:
      "When you know who you're selling to, the ad practically writes itself.",
  },

  // Desire / Buying Psychology
  {
    id: "r1-q10",
    region_id: 1,
    question_type: "true_false",
    question_text:
      "Your job as a marketer is to CREATE desire in your customer.",
    correct_answer: "false",
    why_text: "You can't create desire. You channel what's already there.",
  },
  {
    id: "r1-q11",
    region_id: 1,
    question_type: "ab_pick",
    question_text:
      "You're advertising a teeth-whitening kit. Which visual structure pulls harder?",
    option_a:
      "Smiling person on a white background with caption '5 shades whiter'",
    option_b:
      "Old photos where they smile mouth-closed, then new photos laughing wide open",
    correct_answer: "b",
    why_text:
      "Show the desire fulfilled. The before-after IS the proof.",
  },
  {
    id: "r1-q12",
    region_id: 1,
    question_type: "ab_pick",
    question_text:
      "Your phone case ad claims it's 'unbreakable.' Stronger way to prove it?",
    option_a:
      "Footage of throwing the phone against a brick wall, zero damage",
    option_b: "Bold caption: 'Military-grade. Unbreakable.'",
    correct_answer: "a",
    why_text:
      "Demonstrate the claim, don't state it. Show beats tell.",
  },
  {
    id: "r1-q13",
    region_id: 1,
    question_type: "ab_pick",
    question_text:
      "You're making an ad for a robot vacuum. Where's the stronger ENDING shot?",
    option_a:
      "The vacuum docked on its charging station, lights blinking",
    option_b:
      "Mom getting home from work, walking into a spotless living room, sitting down with a glass of wine",
    correct_answer: "b",
    why_text:
      "They're not buying the vacuum. They're buying the relief. Show that.",
  },
  {
    id: "r1-q14",
    region_id: 1,
    question_type: "ab_pick",
    question_text:
      "You're advertising a luxury wristwatch. What's the better central visual?",
    option_a:
      "A confident, well-dressed man walking into a high-end restaurant, watch visible",
    option_b:
      "A close-up of the watch showing craftsmanship and movement detail",
    correct_answer: "a",
    why_text:
      "They don't buy the watch. They buy the identity that comes with it.",
  },

  // Inspiration
  {
    id: "r1-q15",
    region_id: 1,
    question_type: "true_false",
    question_text:
      "Fastest way to win: find a winning ad on Atria and copy it for your brand.",
    correct_answer: "false",
    why_text:
      "Copying = you're only ever second best. Inspiration, not replication.",
  },

  // Safe Zones
  {
    id: "r1-q16",
    region_id: 1,
    question_type: "true_false",
    question_text:
      "If you put text near the top or bottom of a 9:16 ad, Reels UI might cover it.",
    correct_answer: "true",
    why_text:
      "Safe zones exist. Keep critical text and product inside the green zone.",
  },

  // UGC
  {
    id: "r1-q17",
    region_id: 1,
    question_type: "ab_pick",
    question_text:
      "You're making a UGC ad for a posture-correcting back brace targeting men 55+ with chronic back pain. Which creator should record?",
    option_a:
      "A 28yo fitness influencer with great production and a toned body",
    option_b:
      "A man in his late 50s who actually has back pain and uses the product",
    correct_answer: "b",
    why_text:
      "Match the creator to the audience. Trust beats production.",
  },
  {
    id: "r1-q18",
    region_id: 1,
    question_type: "ab_pick",
    question_text:
      "Your customer testimonial has slightly uneven lighting and one 'um' the customer said mid-sentence. Better choice?",
    option_a: "Run it as-is. Imperfection = real",
    option_b: "Re-record with proper lighting and a clean take",
    correct_answer: "a",
    why_text:
      "For testimonials, polish kills the authentic feel.",
  },
  {
    id: "r1-q19",
    region_id: 1,
    question_type: "ab_pick",
    question_text: "Your UGC ad needs more B-roll. Better fix?",
    option_a: "Generic corporate stock footage",
    option_b: "UGC-style stock that matches the iPhone-shot vibe",
    correct_answer: "b",
    why_text: "Corporate stock kills authenticity. UGC stock blends in.",
  },
];

export const REGION_QUIZ_REGISTRY: Partial<Record<RegionId, RegionQuiz>> = {
  r1: { format: "swipe_cards", cards: R1_CARDS },
  // r2, r3, r4 - awaiting Karlo's content drop. The registry lookup
  // falls through to undefined for these so the Onward button keeps
  // its current "jump straight" behavior. Once content lands, drop
  // a new entry here AND set regions.quiz_format in a migration.
};

export function getRegionQuiz(regionId: RegionId): RegionQuiz | undefined {
  return REGION_QUIZ_REGISTRY[regionId];
}
