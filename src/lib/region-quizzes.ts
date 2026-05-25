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

// v66 - tier_ranking killed per brief v2 (Karlo decision: too much
// ambiguity in S/A/B/C ordering). All three live formats use the
// same SwipeCardQuestion shape underneath; only the visual wrapper
// differs.
export type QuizFormat =
  | "swipe_cards"
  | "stack_builder"
  | "vault_tumblers";

export interface SwipeCardsQuiz {
  format: "swipe_cards";
  cards: SwipeCardQuestion[];
}

export interface StackBuilderQuiz {
  format: "stack_builder";
  cards: SwipeCardQuestion[];
}

export interface VaultTumblersQuiz {
  format: "vault_tumblers";
  /** Brief v2 §08: 5 dials × 3 questions = 15 cards in fixed
   *  1→15 order (no shuffle). Questions are themed by dial. */
  cards: SwipeCardQuestion[];
}

export type RegionQuiz =
  | SwipeCardsQuiz
  | StackBuilderQuiz
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

// ─── Region 2 content (brief v2 §05, final - Stack Builder) ──────────
const R2_CARDS: SwipeCardQuestion[] = [
  // VSLs
  {
    id: "r2-q1",
    region_id: 2,
    question_type: "true_false",
    question_text:
      "VSLs (Video Sales Letters) work best when targeting younger audiences who can binge longer content.",
    correct_answer: "false",
    why_text:
      "Older audiences are the ones willing to sit through a 5-15 minute ad. Brain rot kids scroll.",
  },
  {
    id: "r2-q2",
    region_id: 2,
    question_type: "ab_pick",
    question_text:
      "You just got the assets for a VSL. What do you fix FIRST before anything else?",
    option_a:
      "Find b-roll that matches the script and lay it under the voiceover",
    option_b:
      "Clean up the audio - remove silences, fix levels, polish the a-roll",
    correct_answer: "b",
    why_text:
      "If the audio sounds like a washing machine, nothing else matters. Foundation first.",
  },
  {
    id: "r2-q3",
    region_id: 2,
    question_type: "ab_pick",
    question_text:
      "You're writing the hook for a sleep supplement VSL. Stronger opening?",
    option_a:
      "Sleep better tonight with our science-backed formula trusted by thousands.",
    option_b:
      "The real reason you're still awake at 3am isn't what your doctor told you.",
    correct_answer: "b",
    why_text:
      "Hooks have to grab attention AND qualify the audience. Specific beats generic.",
  },
  {
    id: "r2-q4",
    region_id: 2,
    question_type: "true_false",
    question_text:
      "When you introduce your solution in a VSL, dump every ingredient, study, and benefit upfront so people know it works.",
    correct_answer: "false",
    why_text:
      "Drop breadcrumbs. Think Netflix - every reveal should make them need the next one.",
  },
  {
    id: "r2-q5",
    region_id: 2,
    question_type: "true_false",
    question_text:
      "Save all your social proof (testimonials, experts, press) for the end of the VSL for maximum impact.",
    correct_answer: "false",
    why_text:
      "Layer it in where doubts arise. Dumping at the end is what amateurs do.",
  },
  // Video Hooks
  {
    id: "r2-q6",
    region_id: 2,
    question_type: "true_false",
    question_text:
      "Most people scroll social media with sound on, so audio is your primary hook tool.",
    correct_answer: "false",
    why_text:
      "Sound is off by default. Visual is primary - audio just enhances what they're seeing.",
  },
  {
    id: "r2-q7",
    region_id: 2,
    question_type: "true_false",
    question_text:
      "Animate your hook text so it slides in cleanly after 2 seconds for a polished look.",
    correct_answer: "false",
    why_text:
      "Hook text from frame 1. By the time your fancy animation finishes, they're 3 videos away.",
  },
  {
    id: "r2-q8",
    region_id: 2,
    question_type: "ab_pick",
    question_text:
      "You're writing hook text for blue light glasses targeting gamers. Better choice?",
    option_a: "The best eye protection on the market",
    option_b:
      "I stopped getting headaches and still grind Minecraft 5 hours a night",
    correct_answer: "b",
    why_text:
      "Specific + relatable beats generic. Speaks directly to the exact audience.",
  },
  {
    id: "r2-q9",
    region_id: 2,
    question_type: "true_false",
    question_text:
      "Confusion and intrigue are the same thing - both make people stop and watch.",
    correct_answer: "false",
    why_text:
      "Confusion = 'what am I looking at' = scroll. Intrigue = 'I need to know how' = stop.",
  },
  // Mr. Beast Retention
  {
    id: "r2-q10",
    region_id: 2,
    question_type: "ab_pick",
    question_text:
      "You're making a weight loss ad showing a 50lb transformation. Stronger structure?",
    option_a:
      "Reveal the product at second 5, then explain ingredients, then show before-after",
    option_b:
      "Stack 3-4 reveals first (50lbs lost, eats pizza, photos from just 90 days, others got results), THEN show the product",
    correct_answer: "b",
    why_text:
      "Show product too early = skeptic mode. Stack open loops first, then they're ready to hear it.",
  },
  {
    id: "r2-q11",
    region_id: 2,
    question_type: "true_false",
    question_text:
      "In a video ad, something visual should change every 2-3 seconds (or faster for younger audiences).",
    correct_answer: "true",
    why_text:
      "Never let eyes get comfortable. New angle, new shot, new text - something every couple seconds.",
  },
  {
    id: "r2-q12",
    region_id: 2,
    question_type: "ab_pick",
    question_text:
      "You're editing an ad for a joint supplement targeting men 60+. What editing pace?",
    option_a:
      "Fast cuts, hectic pace, something flashing every single second",
    option_b:
      "Slower pacing, longer shots, breathing room between visuals",
    correct_answer: "b",
    why_text:
      "Match the edit to how your audience naturally consumes content. 60yos aren't Gen Z.",
  },
  // Asset Management
  {
    id: "r2-q13",
    region_id: 2,
    question_type: "true_false",
    question_text:
      "When a client drops new content in Slack or Discord, leave it there - you can grab it later when you actually need it.",
    correct_answer: "false",
    why_text:
      "Download immediately to your local SSD. If you don't, you'll forget it exists.",
  },
  // Music & SFX
  {
    id: "r2-q14",
    region_id: 2,
    question_type: "ab_pick",
    question_text:
      "You're hitting the most important line of your ad - the customer's 'holy shit' moment. What should the music do?",
    option_a: "Cut/pause right before that line to let it land in silence",
    option_b:
      "Layer in extra instruments and sound effects to amplify the moment",
    correct_answer: "a",
    why_text:
      "Pausing music creates tension and makes the key line hit harder than any SFX stack.",
  },
  {
    id: "r2-q15",
    region_id: 2,
    question_type: "true_false",
    question_text:
      "Using a trending TikTok sound your target audience listens to can actually help an ad perform better than generic copyright-free music.",
    correct_answer: "true",
    why_text:
      "Familiar sounds catch ears mid-scroll. Match the music to what the audience already consumes.",
  },
  // AI Tools
  {
    id: "r2-q16",
    region_id: 2,
    question_type: "true_false",
    question_text:
      "Paste your script into ElevenLabs, hit generate, and you'll get an AI voiceover that sounds authentic on the first try.",
    correct_answer: "false",
    why_text:
      "First takes always sound AI. You have to tweak punctuation, emphasis, regenerate until it's right.",
  },
  {
    id: "r2-q17",
    region_id: 2,
    question_type: "true_false",
    question_text:
      "If you find a piece of 360p product footage that's perfect for your ad but the quality is unusable, AI upscaling tools like Topaz can make it usable for social.",
    correct_answer: "true",
    why_text:
      "Topaz Video AI / Gigapixel can turn crap footage into something you can actually run.",
  },
  // Editing Workflow
  {
    id: "r2-q18",
    region_id: 2,
    question_type: "ab_pick",
    question_text: "Fastest way to edit a video ad?",
    option_a:
      "Work section by section - finish hook fully (cut, b-roll, text, SFX), then move to scene 2, then scene 3",
    option_b:
      "Work in layers across the whole video - first cut all a-roll, then all music, then all b-roll, then all captions, then all SFX",
    correct_answer: "b",
    why_text:
      "Layered = flow state, one task at a time. Section-by-section = constant context switching.",
  },
];

// ─── Region 3 content (brief v2 §07, final - Stack Builder reused) ───
const R3_CARDS: SwipeCardQuestion[] = [
  // Static Ad Fundamentals
  {
    id: "r3-q1",
    region_id: 3,
    question_type: "true_false",
    question_text:
      "A static ad has more time than a video ad to make an impact because viewers can study it longer.",
    correct_answer: "false",
    why_text:
      "Your brain processes a static in 13ms. Same scroll speed. The advantage isn't time - it's that you don't have to earn 3 seconds first.",
  },
  {
    id: "r3-q2",
    region_id: 3,
    question_type: "true_false",
    question_text:
      "With static ads, your headline is worth about 80% of your advertising effort.",
    correct_answer: "true",
    why_text: "Ogilvy's rule. Visual stops the eye, headline closes the loop.",
  },
  {
    id: "r3-q3",
    region_id: 3,
    question_type: "ab_pick",
    question_text:
      "You're making a static ad for a $400 ceramic coffee cup that keeps coffee hot for 6 hours. Better visual structure?",
    option_a:
      "Big product photo at the top, 'KEEPS COFFEE HOT FOR 6 HOURS' headline below",
    option_b:
      "Big headline at the top 'Your last sip should still be hot', product photo below",
    correct_answer: "b",
    why_text:
      "Lead with the emotional payoff. The product photo proves it after.",
  },
  {
    id: "r3-q4",
    region_id: 3,
    question_type: "true_false",
    question_text:
      "The fastest way to get good at static ads is to study Schwartz, Ogilvy, and the direct-response books before you ever make one.",
    correct_answer: "false",
    why_text: "Study + reps. You only learn by doing. Make one a day.",
  },
  // Static Ad Types
  {
    id: "r3-q5",
    region_id: 3,
    question_type: "ab_pick",
    question_text:
      "Customer objection is 'Is this product worth my money?' Better static ad TYPE?",
    option_a:
      "Product-focused close-up showing premium details and craftsmanship",
    option_b: "Customer testimonial screenshot",
    correct_answer: "a",
    why_text:
      "Product-focused. They need to SEE the value to believe the price.",
  },
  {
    id: "r3-q6",
    region_id: 3,
    question_type: "ab_pick",
    question_text:
      "Customer objection is 'Does this actually work?' Better static ad TYPE?",
    option_a: "Lifestyle shot showing the customer's aspirational future",
    option_b: "Transformation before-and-after photos",
    correct_answer: "b",
    why_text: "Transformation. Show it working. Proof beats promise.",
  },
  {
    id: "r3-q7",
    region_id: 3,
    question_type: "ab_pick",
    question_text:
      "Customer objection is 'Is this for people like me?' Better static ad TYPE?",
    option_a:
      "Lifestyle shot showing someone like them living the aspirational version",
    option_b: "Problem-solution split image",
    correct_answer: "a",
    why_text:
      "Lifestyle. Sell the identity. They need to see themselves in it.",
  },
  {
    id: "r3-q8",
    region_id: 3,
    question_type: "true_false",
    question_text:
      "For testimonial static ads, you should redesign the customer review on a clean branded background so it looks polished.",
    correct_answer: "false",
    why_text:
      "Leave the raw Facebook/Instagram comment screenshot as-is. The authenticity IS the conversion.",
  },
  {
    id: "r3-q9",
    region_id: 3,
    question_type: "true_false",
    question_text:
      "For a transformation ad, the bigger and more dramatic the change, the better the ad performs.",
    correct_answer: "false",
    why_text:
      "Believable beats dramatic. Photoshopped afters kill trust. Show an achievable transformation.",
  },
  // Headlines & Visual Hierarchy
  {
    id: "r3-q10",
    region_id: 3,
    question_type: "ab_pick",
    question_text:
      "You're advertising a weight loss supplement in a saturated market full of 'lose 10 lbs fast' claims. Which headline angle?",
    option_a: "Lose 10 pounds in 30 days (quick solution angle)",
    option_b:
      "Why your morning jog is making you gain weight (controversy angle)",
    correct_answer: "b",
    why_text:
      "Controversy challenges beliefs in a saturated market. The audience is tired of 'quick solution' claims.",
  },
  {
    id: "r3-q11",
    region_id: 3,
    question_type: "true_false",
    question_text:
      "If someone reads only the BIGGEST text on your ad, they should still get the main message.",
    correct_answer: "true",
    why_text:
      "Visual hierarchy rule one. The biggest text IS the message.",
  },
  {
    id: "r3-q12",
    region_id: 3,
    question_type: "true_false",
    question_text:
      "A cool, hand-drawn font is fine for your static ad even if it's slightly harder to read.",
    correct_answer: "false",
    why_text:
      "Readability beats aesthetics every time. If they squint, they're gone.",
  },
  // Market Awareness
  {
    id: "r3-q13",
    region_id: 3,
    question_type: "true_false",
    question_text:
      "For an Unaware audience, the right ad is a '60% off this weekend' offer.",
    correct_answer: "false",
    why_text:
      "Unaware audiences don't know they have a problem. You can't sell a discount to someone who doesn't think they need anything. Educate first.",
  },
  {
    id: "r3-q14",
    region_id: 3,
    question_type: "ab_pick",
    question_text:
      "You're advertising to a Product-Aware audience (they know your product + competitors). Which approach works best?",
    option_a: "An ad that opens by explaining the problem",
    option_b:
      "A comparative ad showing why your product beats the other ones they're considering",
    correct_answer: "b",
    why_text:
      "Product aware = they already know the problem. You need to differentiate.",
  },
  // Market Sophistication
  {
    id: "r3-q15",
    region_id: 3,
    question_type: "true_false",
    question_text:
      "When the market is Level 4 sophistication (mechanism fatigue), the right move is to make even crazier feature claims than your competitors.",
    correct_answer: "false",
    why_text:
      "At Level 4, claims are burned out. You need to reimagine - shift to identity, niche, status. That's Level 5.",
  },
  {
    id: "r3-q16",
    region_id: 3,
    question_type: "ab_pick",
    question_text:
      "You're entering a brand new market where no competitor exists yet (Level 1 sophistication). Best ad approach?",
    option_a: "Simple, clear claim about what your product does",
    option_b:
      "Identity-driven, status-positioning ad ('for those who understand')",
    correct_answer: "a",
    why_text:
      "Level 1 doesn't need exaggeration or reimagining. Just tell them what it is.",
  },
  // Creative Strategy / Research
  {
    id: "r3-q17",
    region_id: 3,
    question_type: "true_false",
    question_text:
      "Before you do anything else when starting with a new brand, you should do deep market research to understand who you're selling to.",
    correct_answer: "true",
    why_text:
      "Skip research = make ads for the wrong audience = waste money. Research first.",
  },
  {
    id: "r3-q18",
    region_id: 3,
    question_type: "true_false",
    question_text:
      "You only need to look at your DIRECT competitors when assessing market sophistication.",
    correct_answer: "false",
    why_text:
      "Look at all solutions to the same problem, not just same product type. An umbrella competes with raincoats too.",
  },
];

// ─── Region 4 content (brief v2 §09, final - Vault Tumblers) ─────────
// Fixed 1→15 order, themed by dial (3 questions per dial × 5 dials).
const R4_CARDS: SwipeCardQuestion[] = [
  // Dial 1 - AI foundations + 3 I's hierarchy
  {
    id: "r4-q1",
    region_id: 4,
    question_type: "true_false",
    question_text:
      "Pasting your script into a blank ChatGPT chat gives you ad copy just as good as feeding the AI a brand-specific knowledge base first.",
    correct_answer: "false",
    why_text:
      "Brand AI loaded with knowledge (research, comments, brand context) produces dramatically better output. Blank chats are blind chats.",
  },
  {
    id: "r4-q2",
    region_id: 4,
    question_type: "ab_pick",
    question_text:
      "You have time for one ad swing this week. Best approach for the highest chance of a winning ad?",
    option_a: "Imitation - replicate a winning competitor ad for your brand",
    option_b:
      "Ideation - develop a fresh idea grounded in your brand's market research",
    correct_answer: "b",
    why_text:
      "Imitations rarely win - you're only ever second-best to the original. Ideation = hardest path, highest hit rate.",
  },
  {
    id: "r4-q3",
    region_id: 4,
    question_type: "true_false",
    question_text:
      "For ad inspiration, you should focus on what your DIRECT competitors are running.",
    correct_answer: "false",
    why_text:
      "Find sick ads OUTSIDE your niche. Copying direct competitors keeps you second-best.",
  },
  // Dial 2 - Signal vs noise
  {
    id: "r4-q4",
    region_id: 4,
    question_type: "ab_pick",
    question_text:
      "You're sorting competitor ads on Atria/AdSpy to find what's actually working. Strongest signal that an ad is winning?",
    option_a: "How long the ad has been running",
    option_b: "How many shares the ad has",
    correct_answer: "b",
    why_text:
      "Long-running ≠ winning. Shares correlate with the ads that print money. That's the filter.",
  },
  {
    id: "r4-q5",
    region_id: 4,
    question_type: "true_false",
    question_text:
      "Coming up with good ad ideas is a muscle. If you suck at it now, you just haven't done enough reps.",
    correct_answer: "true",
    why_text:
      "Skinny at the gym on day one is normal. Reps build the skill. Same with creative strategy.",
  },
  {
    id: "r4-q6",
    region_id: 4,
    question_type: "true_false",
    question_text:
      "When you build target avatars and mass desires for a brand, you should base them on your gut feeling about who the customer is.",
    correct_answer: "false",
    why_text:
      "Avatars and desires come from the DATA - customer comments, surveys, market research. Not your gut.",
  },
  // Dial 3 - Mining + iteration craft
  {
    id: "r4-q7",
    region_id: 4,
    question_type: "true_false",
    question_text:
      "The best customer language for ad headlines usually comes from the comment sections under top-performing ads.",
    correct_answer: "true",
    why_text:
      "Comment mining is gold. Customer language beats marketer language every time.",
  },
  {
    id: "r4-q8",
    region_id: 4,
    question_type: "ab_pick",
    question_text:
      "You have a video ad that's getting decent spend but not winning. Smartest iteration move?",
    option_a: "Kill it and develop a completely new concept from scratch",
    option_b:
      "Extract the specific line or angle that's resonating, then turn it into static ads, organic versions, different hooks",
    correct_answer: "b",
    why_text:
      "Iteration extracts the heat and amplifies it across formats. That's how decent becomes winning.",
  },
  {
    id: "r4-q9",
    region_id: 4,
    question_type: "true_false",
    question_text:
      "A long, detailed AI prompt with multiple example ads gives you better headlines than a short 'write me a headline for X' prompt.",
    correct_answer: "true",
    why_text:
      "Generic prompts = generic output. The 14-page prompt with examples is what separates Brand AI users from people who say 'AI doesn't work.'",
  },
  // Dial 4 - AI + research synergy
  {
    id: "r4-q10",
    region_id: 4,
    question_type: "true_false",
    question_text:
      "AI tools like Claude/ChatGPT can replace the work of doing your own market research.",
    correct_answer: "false",
    why_text:
      "AI accelerates research, doesn't replace it. You need to know the market to judge which AI outputs are actually good.",
  },
  {
    id: "r4-q11",
    region_id: 4,
    question_type: "ab_pick",
    question_text:
      "You drop your prompt into Brand AI and get 10 headline options. Better next step?",
    option_a: "Pick the headline that has the most 'wow' factor and run it",
    option_b:
      "Cross-reference each headline against your customer research - pick the one that hits a desire you've confirmed customers actually have",
    correct_answer: "b",
    why_text:
      "AI gives you options; research tells you which option matters.",
  },
  {
    id: "r4-q12",
    region_id: 4,
    question_type: "true_false",
    question_text:
      "Your best ad ideas usually come when you're actively sitting at your desk brainstorming.",
    correct_answer: "false",
    why_text:
      "Best ideas come in random moments - shower, walking, before sleep. Write them down IMMEDIATELY or you'll forget.",
  },
  // Dial 5 - Inspiration mastery
  {
    id: "r4-q13",
    region_id: 4,
    question_type: "ab_pick",
    question_text:
      "You see a viral hook in a non-niche TikTok that has nothing to do with the brand you're working on. Best move?",
    option_a: "Skip it - it's not your niche, so it won't apply",
    option_b:
      "Save it to an ad-inspo folder for later, when you're doing strategy for a brand it could fit",
    correct_answer: "b",
    why_text: "Inspiration crosses niches. Save now, apply later.",
  },
  {
    id: "r4-q14",
    region_id: 4,
    question_type: "true_false",
    question_text:
      "When you give the AI example ads in your prompt, the AI should mimic those examples directly when generating new headlines.",
    correct_answer: "false",
    why_text:
      "Take inspiration from the examples (psychological principles, structures) - don't copy them verbatim. Apply principles to fresh headlines for YOUR brand.",
  },
  {
    id: "r4-q15",
    region_id: 4,
    question_type: "true_false",
    question_text:
      "Once you have a winning ad, the only valid iteration is to slap a different hook on it.",
    correct_answer: "false",
    why_text:
      "Iteration also means trying the same angle in NEW formats: static versions, organic versions, VSL versions, different creators delivering the same script.",
  },
];

export const REGION_QUIZ_REGISTRY: Partial<Record<RegionId, RegionQuiz>> = {
  r1: { format: "swipe_cards", cards: R1_CARDS },
  r2: { format: "stack_builder", cards: R2_CARDS },
  r3: { format: "stack_builder", cards: R3_CARDS },
  r4: { format: "vault_tumblers", cards: R4_CARDS },
};

export function getRegionQuiz(regionId: RegionId): RegionQuiz | undefined {
  return REGION_QUIZ_REGISTRY[regionId];
}
