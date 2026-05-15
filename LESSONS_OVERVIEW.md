# Lessons Overview — the 30-Day Sprint

**For:** Karlo. A flat, plain-English list of every lesson in the platform, what it contains, and how the program is structured.
**Source of truth:** matches `supabase/migrations/2026_v20_canonical_lesson_state.sql` (run that file once and your Supabase will look exactly like this).
**Last regenerated:** 2026-05-12.

---

## Does the 30-day sprint cover the whole course?

**Short answer: yes — from the very first intro video through the last Creative Strategy video.** Specifically:

- **Whop intro module** (Karlo's welcome, mindset, proof, "your first 30 days," course overview) → in our **R1**.
- **Fundamentals module** (How Ads Work, Direct Response, Understanding Your Customer, Buying Psychology) → in our **R1**.
- **Video Ads Master module** (intro, Organic, Safezones, UGC, VSL, High-Production, Hooks, Mr. Beast retention, asset management, music/SFX, tech stack, AI upscaling, AI voiceovers, all 9 Editing Breakdowns) → split across **R1 day 5–7** and **R2 days 8–14**.
- **Static Ads module** (Art of 1 Frame, Safezones, Tech Stack, Templates, Action Item) → **R3 days 15–17**.
- **"How To Make Money" module** (Karlo Method, Become an Affiliate, Private Marketplace, Ad Bounties deep dive) → **R3 days 18–20**.
- **Creative Strategy module** (Overview, Market Awareness, Market Sophistication — the three videos that exist as of today) → **R3 days 21–23**.

Anything **after** Creative Strategy on Whop (ongoing ad-bounty content, weekly call recordings, anything new that gets added later) is **not** part of the 30-day sprint by design — R4 (days 24–30) is action-only: the student onboards to bounties, ships their first 3 bounties, checks performance, attends a call, writes a final reflection.

**Stuff intentionally NOT included in the 30-day sprint:**
- Pure community content (Discord threads, off-topic).
- Recorded weekly call archives (live call attendance is part of R4 instead).
- Any "miscellaneous" or "extras" sections on Whop that aren't part of the linear curriculum.

If you ever add a brand-new module to the Whop course (e.g. a new section after Creative Strategy), it will need to be inserted into the sprint manually — there's no auto-sync from "what's on Whop" → "what's in the platform." Lessons are explicitly defined in our DB.

---

## Where the discount gate sits

**The gate is `l049` — "Action Item: Static Ads," day 17, in R3.** This is the **only** lesson with `is_gate = true`. When a student opens it AND has completed R1+R2 within 14 days of joining AND has the team's "ad submissions verified" tick, the **"Apply for my 30% discount"** button appears.

If Carlo (or anyone else) reads an export and thinks the gate is on l047 or l046, that export is stale. l047 is "My Tech Stack For Doing Static Ads" — a watch video, not a gate.

---

## Where the "boss" sits

**l063 — "The Final Reflection," day 30.** Only lesson with `is_boss = true`. Renders as an 8-point crimson star on the map. Completing it = graduating the 30-day sprint.

---

## Structure at a glance

| Region | Name | Days | Lessons | What it is |
|---|---|---|---|---|
| **R1** | Foundation | 1–7 | 18 | Welcome + fundamentals + the first 2 compound action items (Organic, UGC). Builds the mental model. |
| **R2** | Strategy | 8–14 | 20 | The skill stack — VSL, High-Prod, Hooks, retention, tech stack, AI tools, plus the 9 Editing Breakdowns (optional, grouped into one map node). |
| **R3** | Production | 15–23 | 12 | Static Ads (5) + Money Making (4) + Creative Strategy (3). **Day 17 = the discount gate.** |
| **R4** | Gate of Possibilities | 24–30 | 7 | Ad bounty onboarding + 3 bounty submissions + performance review + weekly call + final reflection. Action-only. |

**Total: 57 lessons. 30 days.**

---

# R1 — Foundation (Days 1–7) — 18 lessons

**What this region is:** Welcome, mindset, fundamentals, the mechanics of ads, the first two compound action items. The student should leave R1 with two shipped ads (organic + UGC) and a working mental model of direct response.

### Day 1 — Welcome + mindset
| ID | Type | Title | Duration | What's in it |
|---|---|---|---|---|
| l001 | Setup | Join Discord + Confirm Access | 0m | Join EcomTalent's Discord via Whop, say hi in #general. Optional intro encouraged. |
| l002 | Watch | My Goal Is To Change Your Life | 13m | Karlo's welcome — what the program intends to do and what it doesn't. |
| l003 | Watch | How You Will Turn Into a Top 5% | 17m 30s | The mindset and habits that separate students who make it. |

### Day 2 — Proof + the plan
| ID | Type | Title | Duration | What's in it |
|---|---|---|---|---|
| l004 | Watch | Proof This Works & What You Can Expect | 27m 40s | Case studies, realistic expectations, timelines for first wins. |
| l005 | Watch | Your First 30 Days Here (The Game Plan) | 11m 10s | The full 30-day plan laid out. The map. |

### Day 3 — How ads actually work
| ID | Type | Title | Duration | What's in it |
|---|---|---|---|---|
| l007 | Watch | Course Overview | 13m 20s | Bird's-eye view of every module on Whop. |
| l008 | Watch | How Do Ads Work? | 6m | Mechanics of paid ads — delivery, auctions, what the algorithm wants. |
| l009 | Watch | Direct Response Advertising | 16m | What DR is, why it's 99% of what brands pay for, how it's measured. |

### Day 4 — The customer
| ID | Type | Title | Duration | What's in it |
|---|---|---|---|---|
| l010 | Watch | Understanding Your Customer | 6m | The single most important skill — seeing the customer clearly. |
| l011 | Watch | Buying Psychology | 12m | The triggers and patterns behind every purchase decision. |

### Day 5 — The ad creation process
| ID | Type | Title | Duration | What's in it |
|---|---|---|---|---|
| l013 | Watch | Ad Creation Process | 8m | Step-by-step process to go from idea to shipped ad every time. |
| l014 | Watch | Ad Inspiration System | 24m | Where to look, what to save, how to steal like an artist. |
| l015 | Watch | Video Ads Master — Introduction | 3m | What makes a video ad work in 2025. Formats, rules, pitfalls. |

### Day 6 — Organic ad fundamentals
| ID | Type | Title | Duration | What's in it |
|---|---|---|---|---|
| l016 | Watch | Organic Ads | 14m | The "feels like content" format — when it works, when it doesn't. |
| l017 | Watch | Video Ad Safezone Guidelines | 13m | What placements require so the ad isn't cropped. |

### Day 7 — First action items: ship an organic ad + ship a UGC ad
| ID | Type | Title | Duration | What's in it |
|---|---|---|---|---|
| **l018** | **Watch + Action** | **Action Item: Organic Ads** | 9m + ship | Briefing video + the student must ship an organic-style ad to `#ad-review`. Compound — both halves required. |
| l019 | Watch | UGC | 11m | User-Generated Content style. Lo-fi, high-converting, authentic. |
| **l020** | **Watch + Action** | **Action Item: UGC Ad** | 7m + ship | Briefing video + the student must ship a UGC ad to `#ad-review`. Compound. |

---

# R2 — Strategy (Days 8–14) — 20 lessons

**What this region is:** The skill stack. VSLs and High-Production ads (with action items), Hooks, retention techniques, asset management, music/SFX, the tech stack, AI tools, and the 9 Editing Breakdowns. The Editing Breakdowns collapse into a single map node and can be skipped per-part — they're the "long, deep" part of the program.

### Day 8 — VSLs + High-Production
| ID | Type | Title | Duration | What's in it |
|---|---|---|---|---|
| l021 | Watch | VSLs | 16m | Video Sales Letters — long-form problem-agitation-solution format. |
| **l022** | **Watch + Action** | **Action Item: VSL Ad** | 9m + ship | Briefing + student must ship a VSL to `#ad-review`. Compound. |
| l023 | Watch | High-Production Ads | 9m | Studio lighting, real set, polished edit — when to reach for it. |
| **l024** | **Watch + Action** | **Action Item: High-Production Ad** | 3m + ship | Briefing + student must ship a high-prod ad. Compound. |
| l025 | Watch | Video Hooks | 17m | Anatomy of a hook. Stopping the scroll in 1.5 seconds. |

### Day 9 — Retention + assets + sound
| ID | Type | Title | Duration | What's in it |
|---|---|---|---|---|
| l026 | Watch | Mr. Beast Retention Techniques | 12m | The pacing tricks the best creators use to keep eyes glued. |
| l027 | Watch | Asset Management | 7m | Organize clips, fonts, music, templates so you can work fast. |
| l028 | Watch | Music & SFX | 20m | Where to find them legally, how to layer them so they add. |

### Day 10 — Tech + AI
| ID | Type | Title | Duration | What's in it |
|---|---|---|---|---|
| l029 | Watch | My Tech Stack For Editing Video Ads | 30m | Karlo's exact editing setup. Apps, plugins, workflow. |
| l030 | Watch | AI Content Upscaling | 10m | Turn low-res footage into usable ad footage with AI tools. |
| l031 | Watch | AI Voiceovers | 42m | When to use AI voice, when not to, what tools sound human. |

### Days 11–14 — The Editing Breakdowns (grouped node, optional per-part)
All 9 lessons below render as **one node** on the map titled "Editing Breakdowns." The student opens the group and picks Watch or Skip per part. Both Watch and Skip count toward unlocking R3 — students can keep momentum.

| ID | Day | Title | Duration | What's in it |
|---|---|---|---|---|
| l032 | 11 | Editing Breakdowns — Intro | 2m | Why we study edits frame-by-frame. The "you can skip but you'll need to come back" disclaimer lives here. |
| l033 | 11 | LIVE Example: Editing a Video Ad | 54m | Watch Karlo edit a real ad from scratch in one sitting. |
| l035 | 12 | Video Editing Breakdown: Part 1 | 1h 25m | Part 1 of the four-part deep dive on ad editing. |
| l036 | 12 | Video Editing Breakdown: Part 1 (cont.) | 1h 20m | Continuation of Part 1 — cuts and pacing. |
| l037 | 12 | Video Editing Breakdown: Part 1 (final) | 50m | Finishing Part 1 — sound design and final polish. |
| l038 | 13 | Video Editing Breakdown: Part 2 | 38m | A different ad format, different challenges. |
| l039 | 13 | Video Editing Breakdown: Part 3 | 20m | Breaking down a top-performing UGC ad. |
| l041 | 14 | Video Editing Breakdown: Part 4 | 52m | Editing a high-production ad. |
| l042 | 14 | Video Editing Breakdown: Part 5 — VSL Ad | 22m | Editing a VSL — hardest format, highest payoff. |

---

# R3 — Production (Days 15–23) — 12 lessons

**What this region is:** Static Ads, the Money Making methods, and Creative Strategy. **The discount gate lives here, on day 17.** This region is also where the student's path bends from "consume content" to "apply content."

### Days 15–17 — Static Ads block (5 lessons) ★ contains the gate
| ID | Day | Type | Title | Duration | What's in it |
|---|---|---|---|---|---|
| l045 | 15 | Watch | The Art Of 1 Frame | 29m | How to make a single static frame do the work of a 30-second ad. |
| l046 | 15 | Watch | Static Ad Safezone Guidelines | 3m | Where eye + thumb naturally land. Design inside the safe zones. |
| l047 | 16 | Watch | My Tech Stack For Doing Static Ads | 15m | The exact apps + plugins Karlo uses for every static. |
| l048 | 16 | Watch | Static Ad Templates + LIVE Example | 13m | Walk-through of the template files + a live build of one ad. |
| **l049** ★ | 17 | Watch + Action | **Action Item: Static Ads** | 8m + ship | **THE DISCOUNT GATE.** Watch the briefing, ship a static ad to `#ad-review`. The team manually reviews each submission before approving the 30% discount. |

### Days 18–20 — Money Making (4 lessons)
| ID | Day | Type | Title | Duration | What's in it |
|---|---|---|---|---|---|
| l050 | 18 | Watch (optional) | "The Karlo Method" | 1h 5m | The income system Karlo built to make money outside of bounties. Skippable. |
| l051 | 18 | Watch (optional) | Become an Affiliate | 14m | How affiliate income works + how to set it up. Skippable. |
| l052 | 19 | Watch | Private Marketplace Cheat | 21m | Inside access to the private marketplace + how to use it. |
| l053 | 20 | Watch | Ad Bounties (Insane Passive Income) | 1h 42m | Deep dive on the bounty system + the income it produces. |

### Days 21–23 — Creative Strategy (3 lessons)
| ID | Day | Type | Title | Duration | What's in it |
|---|---|---|---|---|---|
| l054 | 21 | Watch | Overview (Creative Strategy Workflow) | 34m | How a winning creative strategy gets built from scratch. |
| l055 | 22 | Watch | Market Awareness | 24m | The 5 levels of market awareness + how to recognize each. |
| l056 | 23 | Watch | Market Sophistication | 18m | The 5 levels of market sophistication + how they shape angle. |

> ⚠ **l054, l055, l056 currently have no Whop lesson ID set.** The v20 canonical SQL cleared them on purpose — they were inheriting collision IDs from earlier `Strategy Lesson 8/9` rows that v19 reassigned. **Paste the real Whop URLs for these three Creative Strategy videos and I'll patch them in** (one UPDATE per row — same pattern as v19 did for l047–l053).

---

# R4 — Gate of Possibilities (Days 24–30) — 7 lessons

**What this region is:** All action, no new content. The student already has the knowledge — now they ship real bounty work, see the performance, attend a live call, and write a final reflection. The "graduation" arc.

| ID | Day | Type | Title | Duration | What's in it |
|---|---|---|---|---|---|
| l057 | 24 | Setup | Complete Ad Bounty Onboarding | 20m | Read the bounty brief process. Understand how submissions are judged. |
| l058 | 25 | Action | Submit Your First Ad Bounty | 3h | Pick a brief. Build it. Submit it. First real client work. |
| l059 | 26 | Action | Submit Ad Bounty #2 | 3h | Different brief, different format. Stack up the portfolio. |
| l060 | 27 | Action | Submit Ad Bounty #3 | 3h | Third bounty. Iterate on what's working from feedback on 1 & 2. |
| l061 | 28 | Action | Check Ad Performance Dashboard | 15m | See the real numbers your submitted ads produced. The scoreboard. |
| l062 | 29 | Action | Attend Weekly Call | 1h | Live weekly call. Bring a question, screen, work. |
| **l063** ★ | 30 | Action | **The Final Reflection** | 20m | Write down what you learned, what you'll do next, what you wish you knew on day 1. **THE BOSS.** |

---

## What the canonical SQL fixes

Running [`supabase/migrations/2026_v20_canonical_lesson_state.sql`](supabase/migrations/2026_v20_canonical_lesson_state.sql) once in Supabase's SQL editor will:

1. **Move the discount gate to l049 if it's anywhere else.** Sets `is_gate = false` on every other row and `is_gate = true` only on l049.
2. **Delete the 6 retired lessons** (l006, l012, l034, l040, l043, l044) if any of them are still in the table.
3. **Fix the v19 Whop-ID collision bug.** l054 and l055 were sharing IDs with l052 and l053 — would have caused watch-sync to mark two lessons complete every time the student watched one. Now cleared to NULL.
4. **Upsert every other lesson** with the exact title, day, duration, type, Whop link, action brief, optional/grouped flags from the canonical state above.
5. **Refresh region names + day ranges** (r1: 1–7, r2: 8–14, r3: 15–23, r4: 24–30).

It's idempotent — safe to run as many times as needed.

After running, the verification queries at the bottom of the SQL file should return:
- `r1=18, r2=20, r3=12, r4=7` (total 57)
- Exactly **1** row with `is_gate = true` (l049)
- Exactly **1** row with `is_boss = true` (l063)
- Exactly **5** rows with `requires_action = true` (l018, l020, l022, l024, l049)
- Exactly **2** rows with `is_optional = true` (l050, l051)
- Exactly **9** rows in the `editing_breakdowns` group
- **0** duplicate `whop_lesson_id` values

---

## What's still missing (to-do for Karlo)

| Lesson | What's needed |
|---|---|
| l054 — Overview (Creative Strategy Workflow) | Whop lesson ID (URL) |
| l055 — Market Awareness | Whop lesson ID (URL) |
| l056 — Market Sophistication | Whop lesson ID (URL) |
| l019 — UGC | Duration (currently `11m` from the original seed — confirm against Whop) |
| l020 — Action Item: UGC Ad | Duration (currently `7m` — confirm against Whop) |
| l042 — Editing Breakdown Part 5 — VSL Ad | Duration (currently `22m` — confirm against Whop) |

Drop me the Whop URLs and I'll add a small `v21` migration that fills these in.
