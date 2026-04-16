---
name: ecomtalent-student-design
description: Design the EcomTalent STUDENT-SIDE interface — a dark, premium, path-based learning experience inspired by React.gg warmth, Duolingo path UX, Framer's premium feel, and Cursor's micro-animations. Use for student-facing pages (/, /login, /dashboard, /dashboard/*, /auth/*) to create a course experience that feels designed, confident, and guided by Karlo — not a generic SaaS dashboard. DO NOT use for admin pages.
---

# EcomTalent Student Design Skill

This skill shapes how to build and refine the STUDENT side of EcomTalent — the pages that actual course members see. The goal: students open the app and feel like they're inside a well-crafted course with a mentor guiding them, not a productivity tool.

## When to Invoke This Skill

**USE for student-facing surfaces:**
- `/` (landing / onboarding)
- `/login` (sign in with Whop)
- `/dashboard` and all `/dashboard/*` routes
- `/auth/complete` (session handoff)
- Any component in `src/components/student/`
- The path/journey visualization (the spine of the student experience)
- Celebration moments, progress visualizations, daily notes

**DO NOT USE for:**
- `/admin` and any `/admin/*` routes — the admin side follows dashboard conventions (Linear/Vercel style), not course-experience conventions
- API route handlers — backend logic, not design
- Auth flow logic (the functionality, not the visible pages)

If in doubt: is a paying student going to see this? Use the skill. Is Karlo/Astrid doing CRM work? Don't.

## Core Aesthetic Direction

**The mood:** Premium creative-industry course experience. Students are aspiring ad creatives in their 20s — they want to feel they're inside something as well-designed as the ads they aspire to make.

**Commit to these choices. Do not drift toward generic SaaS.**

### Base palette
- **Dark-first.** Pure black or deep dark blue/navy base. No light mode for student surfaces.
- **One warm accent** — something in the amber/orange/gold/peach family. This is Karlo's color. Use it for:
  - Current/active state on the journey path
  - Primary CTAs
  - Progress fills
  - Celebration moments
- **Secondary accent** (optional) — a cool contrast for activation points / milestones (deep teal, electric purple, or ice blue). Used sparingly.
- **Neutrals** — warm off-whites, not pure white. Text-primary around `#F5F2ED`, text-secondary with some warmth.
- **NEVER** use default Tailwind `blue-500`, `indigo-500`, `purple-500`, `violet-500`. Always define custom CSS variables.

### Typography
- **Pair two fonts.** One display font with character (serif or distinctive sans) for hero headings and moments. One clean, readable sans for body/UI.
  - Display options: a warm serif (like PP Editorial New, GT Alpina, Tiempos Headline), or a characterful sans (Söhne, GT America, Geist Mono for accents)
  - Body options: Geist, Söhne, Inter Display (NOT plain Inter), Manrope
- **Never use:** default Inter, Arial, Roboto, system fonts, or Space Grotesk (overused)
- Hero/page titles: large and confident (48-72px), tight tracking (-0.02 to -0.03em)
- Body: 15-16px, generous line-height (1.6-1.7)
- Small caps for section labels ("WEEK 01 • FOUNDATION") with letterspacing 0.15em+

### Voice (THIS MATTERS AS MUCH AS VISUAL)

Every string of text in the student app should sound like **Karlo talking to the student directly**. Voice adjectives:
- **Direct** — no fluff, no corporate hedging
- **Unfiltered** — real, not sanitized
- **Mentor** — he's done this, you can too
- **Honest** — call out hard parts, don't promise easy wins
- **Sharp** — precise, not verbose
- **Sometimes playful/witty** — when it fits, not forced

**Voice examples:**

| Generic SaaS | Karlo's voice |
|---|---|
| "Welcome to your dashboard!" | "You're in. Let's go." |
| "You've completed 5 of 23 tasks." | "5 down. Keep moving." |
| "Your next task is..." | "Next up:" or "Do this:" |
| "Congratulations on completing Week 1!" | "Week 1 done. That was the setup. Now the real work." |
| "Click to mark as complete" | "Done? Check it off." |
| "Please watch the video and complete the task" | "Watch it. Do it. Check it off." |
| "Great job! Keep up the momentum." | "Momentum's the whole game. Don't lose it." |
| "You need to complete X more tasks" | "X more to unlock the discount." |
| "No notes yet today" | "What did you work on today?" |
| "Error: something went wrong" | "Something broke. Try again." |

Rules:
- No exclamation points unless Karlo would genuinely yell the line
- No emoji unless they replace a word efficiently (🔥 for streaks is fine, 🎉 for completion is generic — avoid)
- Contractions always ("you're," "it's," "don't")
- Second person ("you," "your")
- Short sentences. Very short when it matters.

## The Path (Core UX Pattern)

The spine of the student experience is a **Duolingo-style vertical path** showing all 23 tasks as nodes the student travels. Tasks are NOT locked by date — students can complete at their own pace. The 15-day discount deadline is a visible waypoint, not a gate.

### Path structure
- Vertical scroll (mobile-first). Path snakes — alternating left/right curve.
- **4 week zones.** Each week has its own visual identity (subtle background shift, zone title, maybe a decorative element). Think chapter breaks in a book.
- **Nodes are tasks.** Each node shows:
  - Task title
  - Type badge (Setup / Watch / Action) — small, subtle
  - Completion state (checked / current / upcoming)
  - Activation point marker if applicable (AP1, AP2, AP3) — distinctive visual, different from regular nodes

### Node states
- **Completed** — filled with accent color, checkmark, subtle glow, slightly desaturated
- **Current** (next up) — pulsing outline, full brightness, "Start" or "Do this" label hovering
- **Upcoming** — outlined, muted, still clearly visible and clickable (never locked)
- **Activation point** — distinct shape or badge, shows AP1/AP2/AP3 label
- **Discount gate** (after 13 required tasks) — visible milestone marker with "UNLOCK 30% DISCOUNT" label, transforms when reached
- **Watch-type tasks** — currently non-checkable (synced from Whop later). Shows a play icon instead of a checkbox. On click, opens the Whop course.

### Path interactions
- Clicking a node: opens that task's detail (description, Whop course link, check-off action)
- Hovering a node (desktop): subtle lift, preview text
- Completing a node: animation plays (see Celebrations below), path flows forward
- Week zone enters viewport: subtle reveal animation for the zone title

### Progress visual at top (always visible)
- Overall progress bar or ring
- Days into the journey (Day 4 of 30 — informational only, not limiting)
- Next milestone countdown ("3 tasks to discount unlock")

## Celebrations (Micro-moments)

These are the dopamine. Without them, the app is a checklist. With them, it's addictive.

### Completing a task
- Check mark animates in (spring scale, not linear fade)
- Node fills with accent color
- Small burst effect (subtle particles or light flash — NOT confetti explosion)
- The next node pulses gently, inviting forward motion
- Subtle sound? (optional — default off, togglable)

### Completing an activation point
- Larger moment. Full-screen soft flash, AP badge animates to dock position
- Single-line Karlo message slides in: "AP1 done. Content's the foundation. Now ads."

### Unlocking the discount (13 required tasks)
- Significant moment. Path visually transforms — the discount gate opens
- Modal or slide-in with Karlo's voice: "You earned it. 30% off your next month. Claim it."
- Single button: "Claim Discount"

### Completing Week X
- Week zone gets "sealed" visually (subtle change — maybe a stamp or completion mark)
- Brief transition to next week zone
- One line from Karlo per week

### 30-day completion
- This is the graduation moment. Full-screen. The entire path collapses into a single "you finished" state.
- Karlo's voice: Direct, earned, no sap.

## Motion Rules

Inspired by Cursor and Framer's feel — motion is always meaningful, never decorative.

- **Only animate `transform` and `opacity`.** Never `width`, `height`, `margin`, `padding`.
- **Never `transition-all`.** Specify properties.
- **Easing:** spring-style or cubic-bezier(0.22, 1, 0.36, 1). Never linear except for loops.
- **Durations:** 150-250ms for micro-interactions, 400-600ms for moments, 800ms+ only for significant transitions.
- **Stagger:** When revealing multiple elements, stagger 60-100ms.
- **Motion library:** Use Framer Motion (`framer-motion` package) for complex sequences. CSS transitions are fine for simple hovers.

### Specific rules
- Hero page load: sequence is label → heading → body → CTA with staggered reveals
- Scroll-into-view: subtle fade + translate-y(8px), not large movements
- Node hover: 2-4px lift max, 150ms
- Button press: scale(0.98), 100ms
- Page transitions: fade through, 300ms

## Layout Rules

- **Mobile-first.** Students will check this on their phone during lunch breaks.
- **Max content width:** 720px for text-heavy areas, but the path can go wider with decorative space on sides (desktop only).
- **Generous vertical rhythm.** Minimum 80px between major sections, 120px+ at week boundaries.
- **No dense text walls.** If a paragraph is more than 3 lines, rewrite it shorter or break it visually.
- **One focal point per scroll position.** Students should always know the one thing they can do right now.
- **Sticky "Today's focus" or "Next up" element** on the dashboard — always visible even if they scroll the path.

## Background and Depth

- Dark base color, but never flat. Layer subtle:
  - Noise/grain texture (very subtle SVG noise filter, 2-4% opacity)
  - Soft radial gradient(s) — one warm radial glow suggesting Karlo's color, positioned behind the current-task area
  - Subtle border-color shifts to create depth (card surfaces slightly lighter than base)
- **Three depth layers:**
  - Base (background)
  - Elevated (cards, nodes)
  - Floating (modals, sticky headers)
- Each layer slightly lighter than the one below. No flat uniform dark.

## Anti-Patterns (DO NOT DO)

- ❌ Default Tailwind `bg-gray-900` + `text-white` — this is the generic dark mode everyone uses. Custom your dark.
- ❌ Emoji confetti on task completion (🎉✨🎊) — cheap, not premium.
- ❌ "Motivational" quotes or fortune-cookie wisdom.
- ❌ Progress bars as the ONLY visualization of progress — combine with the path.
- ❌ Text-heavy explanation pages — if it needs a paragraph, make it a single bold sentence.
- ❌ Cards with `shadow-md` or `shadow-lg` — use layered color-tinted shadows or none.
- ❌ Generic circular avatars — if showing Karlo, use a distinctive frame/treatment.
- ❌ Icon libraries used generically (Feather icons, Heroicons) without custom treatment.
- ❌ "Welcome! We're excited to have you!" corporate onboarding tone.
- ❌ Dashboard-style metric cards ("23 Tasks • 5 Complete • 22% Progress") stacked horizontally — this is what we're trying to AVOID being.
- ❌ Long text blocks on any page.
- ❌ Treating "watch" tasks as checkable — they're Whop-synced (play icon, not checkbox).
- ❌ Locking future tasks. Everything is always accessible.
- ❌ Cute mascots, characters, or gamification stickers that feel childish. This is premium, not Duolingo-for-kids.

## Component Patterns Specific to This App

### Week Zones
Each of the 4 weeks is a distinct "chapter" on the path:
- **Week 1 — Foundation + First Ads** (setup energy — building the base)
- **Week 2 — Level Up Your Editing** (skill acquisition — sharpening)
- **Week 3 — Creative Strategy + Job Board** (expansion — branching out)
- **Week 4 — Ad Bounties — The Activation Point** (payoff — the real thing)

Each zone should have:
- A title treatment using the display font
- Small cap label ("CHAPTER 01" or "WEEK 01")
- Brief one-sentence framing from Karlo
- Visual identity (maybe accent color shifts subtly, or background element changes)

### Daily Notes
- Not a separate page buried in nav. Surface on the main path view, near today's active node.
- Prompt uses Karlo's voice: "What did you work on today?" not "Add your daily journal entry"
- Saves with subtle confirmation (checkmark beside the field, not a toast).
- Past notes shown as a collapsed reel/timeline accessible but not in-the-way.

### Activation Points (AP1, AP2, AP3)
Treat these like boss fights or checkpoints. Visually distinct from regular task nodes:
- Larger node size
- Special shape (maybe diamond vs. circle) or frame
- Badge showing AP1 / AP2 / AP3
- On completion: bigger celebration, stays visually prominent on the path permanently

### Discount Gate (13 required tasks)
- Clearly visible on the path from day 1 as an upcoming milestone
- Locked visual: treasure/gate/vault imagery (but premium, not game-y)
- "3 more to unlock" countdown on the main dashboard
- Unlocked state: transforms, becomes a CTA to claim

## Required Reading Before Designing

Before building or refining any student-side surface, mentally check these references:
- [React.gg](https://react.gg) — warmth, stickers, course structure, conversational tone
- [Duolingo](https://duolingo.com) — path UX, node states, week zones, celebrations
- [Framer](https://framer.com) — premium feel, confident creative energy
- [Cursor](https://cursor.com) — micro-animations, dark theme done right
- [Linear](https://linear.app) — for MOTION quality, not dashboard structure

If a design choice doesn't feel like it belongs alongside these references, reconsider it.

## Implementation Checklist

When I build or refine any student-facing component, verify:

- [ ] Does it feel like Karlo made it, not a generic SaaS template?
- [ ] Is the copy short, direct, in Karlo's voice?
- [ ] Are custom colors used (not default Tailwind palette)?
- [ ] Is typography pairing distinctive (not Inter + Inter)?
- [ ] Is motion constrained to `transform` and `opacity`?
- [ ] Is there ONE clear next action visible at current scroll?
- [ ] Are interactive states (hover, focus-visible, active) present?
- [ ] Is the dark base non-flat (grain, gradients, or depth layers)?
- [ ] Are celebrations subtle but satisfying (not confetti emoji)?
- [ ] Are "watch" tasks shown as play-icon (not checkbox)?
- [ ] Would a student overwhelmed on Day 1 feel guided, not flooded?

## Starting Point

If starting a new student-side page from scratch:
1. Commit to the aesthetic direction (pure black vs. dark blue — pick one, document in project CSS vars)
2. Set up CSS variables for the full palette before writing any component
3. Load the font pairing
4. Build one focal element first (the path, or the hero) — get it feeling right
5. Only then expand outward to supporting elements
6. Check against the reference sites at every step
