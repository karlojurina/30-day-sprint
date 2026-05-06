/**
 * SOP message templates for Customer Success follow-ups.
 *
 * Astrid uses these from the Kanban view: clicking a "Day 7" chip
 * on a student card copies the templated message to the clipboard
 * with the student's name interpolated, ready to paste into Discord.
 *
 * Karlo + Astrid edit copy here. Single source of truth — change
 * the template, it's reflected everywhere it's used.
 *
 * Tokens supported:
 *   {firstName}   — student's first name (or "there" if absent)
 *   {fullName}    — student's full name (or "there")
 *   {dayNumber}   — current day-of-program (1..N)
 */

export interface SopTemplate {
  /** Stable id used as the React key + for analytics. */
  id: "day-1" | "day-7" | "day-14" | "day-21";
  /** Short label shown on the chip. */
  label: string;
  /** Multi-paragraph template. Use {firstName} / {fullName} / {dayNumber}. */
  body: string;
}

export const SOP_TEMPLATES: SopTemplate[] = [
  {
    id: "day-1",
    label: "Day 1",
    body: `Hey {firstName} — welcome to EcomTalent.

I'm Astrid, your guide through the next 30 days. Quick orientation:

- Your map lives at the dashboard. Each region is a week of work.
- Region 1 (Base Camp) is foundations. Don't skip it even if you've done ads before — Karlo's framing is non-obvious.
- The 30% discount on month two unlocks once you complete Region 2 within 14 days. The timer's already running.

If you're stuck on anything, DM me directly. No question is too small.`,
  },
  {
    id: "day-7",
    label: "Day 7",
    body: `Hey {firstName} — checking in at the end of week 1.

You're at Day {dayNumber}. Region 1 is supposed to wrap by now. If you haven't finished it, no judgment — just tell me what's blocking you and we'll move it.

A few things to make sure you're getting:
- The 30% discount window closes at Day 14. You need R1 + R2 done by then.
- Submit your action-item ads in #ad-review — that's how I confirm your discount eligibility.
- The video editing breakdowns in Region 2 are optional but extremely valuable. They take a few hours together. Don't skip them long-term.

What's the single thing that would unblock your week 2?`,
  },
  {
    id: "day-14",
    label: "Day 14",
    body: `Hey {firstName} — Day {dayNumber} check-in.

This week is pivotal. The 30% discount window closes at the end of week 2. To apply you need:
1. Region 1 + Region 2 fully completed
2. All your action-item ads submitted in #ad-review
3. Click "Apply for my 30% discount" on the gate node

I'll review submissions within 24 hours of your application. If you're behind, tell me where — sometimes it's a 30-minute fix to get back on track.

What does "done by Day 14" look like for you?`,
  },
  {
    id: "day-21",
    label: "Day 21",
    body: `Hey {firstName} — Day {dayNumber}, three weeks in.

Region 3 (Test Track) is where students start applying instead of consuming. By now you should have:
- A few ads shipped
- Real feedback (good or bad) on what's working
- A sense of which format clicks for you

Heads up: the 30-day mark is approaching. If you've been getting value, the natural next step is the second month — your discount code (if approved) is good for it.

What's working for you so far? What's the one thing you'd want me to help you sharpen this week?`,
  },
];

/** Render a template with the student's interpolated values. */
export function renderSopTemplate(
  template: SopTemplate,
  vars: { firstName: string; fullName: string; dayNumber: number }
): string {
  return template.body
    .replace(/\{firstName\}/g, vars.firstName)
    .replace(/\{fullName\}/g, vars.fullName)
    .replace(/\{dayNumber\}/g, String(vars.dayNumber));
}
