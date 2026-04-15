# EcomTalent Student Platform

## What this is
A Next.js web app for EcomTalent ($97/month ecommerce education community on Whop). Two sides:
- **Student-facing:** 30-day interactive playbook with 23 checkable tasks, daily notes, discount tracker
- **Team-facing:** Dashboard for Karlo (founder) and Astrid (CSM) to track student progress and intervene before churn

## Tech Stack
- Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- Supabase (auth, PostgreSQL, RLS, real-time)
- Whop API (OAuth 2.1 + PKCE, webhooks, promo codes) — direct HTTP calls, no SDK
- Vercel (hosting + cron jobs)

## Key Architecture Decisions
- Students auth via Whop OAuth → deterministic password bridges to Supabase user
- Team auths via Supabase email/password
- Tasks stored in DB (not hardcoded) — enables SQL joins for progress and discount eligibility
- day_number computed from joined_at, never stored
- All mutations go through API routes (not direct Supabase calls from client)

## Database
- Schema: `supabase/schema.sql` (7 tables with RLS)
- Seed data: `supabase/seed.sql` (23 playbook tasks)

## Build Commands
```bash
npm run dev    # Start dev server
npm run build  # Production build
npm run lint   # ESLint
```

## User Context
- Built by Lovro (beginner developer — explain things simply)
- Project owner: Karlo (EcomTalent founder)
- Completely separate project from Map of Croatia (different repo, different Supabase project)

## Routing

| Task | Go to | Read first |
|------|-------|------------|
| Student UI / dashboard | src/app/dashboard/ | CONTEXT.md → Student Flow |
| Admin / team dashboard | src/app/admin/ | CONTEXT.md → Team Flow |
| Auth (Whop OAuth + PKCE) | src/app/api/auth/ | system-docs/architecture_summary.md |
| Discount flow | src/app/api/discounts/ | system-docs/architecture_summary.md |
| Churn detection / cron | src/app/api/cron/ | system-docs/architecture_summary.md |
| Webhooks (membership sync) | src/app/api/webhooks/ | system-docs/architecture_summary.md |
| Database changes | supabase/ | CONTEXT.md → Database |
| Shared state / contexts | src/contexts/ | CONTEXT.md → State Management |
| UI components | src/components/ | CONTEXT.md → Components |
| New feature | — | CONTEXT.md first |

## Build Principles

- **Diagnose deep, fix shallow.** Understand the root cause before changing anything. Fixes should be minimal and targeted.
- **Validate before build.** Check live systems and real data before writing code or making changes. Never assume from docs alone.
- **Go to the source.** When in doubt, check the actual system — not a summary, not a memory, not a guess.
- **Ceremony proportional to risk.** Simple changes get simple process. Complex changes get planning and verification.
- **One problem, one fix.** Don't bundle unrelated changes. Each change should solve one clear thing.

## Development Lifecycle

| Skill | When to use |
|-------|-------------|
| /quick-fix | Bug fixes, config tweaks, minor adjustments |
| /build | New features, significant changes, multi-step work |
| /audit | Verify docs match reality, check system integrity |
| /close-project | Wrap up a project — merge, archive, deploy |
| /identify-workflow | Find automation opportunities in your processes |

## Living Documentation Rule

CONTEXT.md and system-docs/ must reflect current state. When pages, API routes, or integrations change, update the docs. Outdated docs are worse than no docs.
