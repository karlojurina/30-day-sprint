# EcomTalent Student Platform — Current State

The Next.js + Supabase app behind EcomTalent's 30-day sprint.
For *how we work* see [CLAUDE.md](CLAUDE.md).
For *table dependencies* see [system_contracts.md](system_contracts.md).
For *the product / what each surface does for the user* see
[PLATFORM_OVERVIEW.md](PLATFORM_OVERVIEW.md).

This document is **the live map** of the app. Updated at the moment any
structure changes.

## What this is

Two surfaces in one Next.js app:

- **Student-facing** — `/dashboard` (the 30-day sprint map: 4 painted
  regions, lessons, action items, streaks, discount window, region
  to-dos) and `/dashboard/playbook` (Map 2: post-sprint hub with 4
  always-on activities + the "first client landed" milestone).
- **Team-facing** — `/admin` (Karlo + CSM team): kanban, students,
  templates, discounts, alerts, insights, discord settings.

## Tech Stack

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind v4**
- **Supabase** — Postgres + RLS + Auth + real-time
- **Whop** — OAuth 2.1 + PKCE, membership webhooks, promo codes,
  watch-history sync (direct HTTP, no SDK)
- **GSAP** — map camera animation
- **Framer Motion** — celebrations, overlays
- **Vercel** — hosting + cron jobs + Analytics

## Student Surfaces

| Path | What it is |
|------|------------|
| `/login` | Whop OAuth entry |
| `/auth/callback` + `/auth/complete` | OAuth callback + post-auth landing |
| `/dashboard` | The map (overview + 4 regions, gated by `sprint_completed_at`) |
| `/dashboard/playbook` | Map 2 hub (post-sprint, after Finish Program) |

**State:** `AuthContext` (session + student row), `StudentContext`
(lessons, completions, streaks, discount, sprint milestones, playbook
welcome, first-client landed, etc.).

## Admin Surfaces

| Path | What it is |
|------|------------|
| `/admin/login` | Email/password (Supabase Auth, `team_members` table) |
| `/admin` | KPI overview |
| `/admin/journey` | Student journey board (per-week columns, pace overview, drawer detail) |
| `/admin/students` + `/admin/students/[id]` | Table view + detail |
| `/admin/templates` | CSM DM template editor (built-ins + custom, with TriggerBuilder) |
| `/admin/tasks` | CSM task queue (open / completed / dismissed) |
| `/admin/discounts` | Pending discount review |
| `/admin/alerts` | Auto-generated churn alerts |
| `/admin/insights` | Progress + retention insights |
| `/admin/discord` | Day-28 DM toggles, preview |
| `/admin/settings` | Admin config (booking link, program link, etc.) |
| `/journal/[studentId]` | Student daily-notes journal (read-only for team) |

## API Routes

**Auth**
- `POST /api/auth/whop/authorize` — start OAuth + PKCE
- `GET /api/auth/whop/callback` — complete OAuth, upsert student
- `GET /api/auth/me` — current session
- `POST /api/auth/team/login` — admin password login

**Student mutations** (Bearer token, RLS-respecting)
- `POST /api/student/toggle-lesson` — mark/unmark watch completion
- `POST /api/student/mark-action-shipped` — toggle `action_completed_at`
- `POST /api/student/skip-lesson` — mark optional lesson skipped
- `POST /api/student/save-action-link` — Discord submission URL
- `POST /api/student/submit-quiz` — quiz attempt
- `POST /api/student/claim-bounty-access` — l057 claim (v2)
- `POST /api/student/finish-program` — l058 → `sprint_completed_at` (v2)
- `POST /api/student/mark-first-client` — Map 2 milestone (v2)
- `POST /api/student/dismiss-playbook-welcome` — Map 2 intro (v2)
- `POST /api/student/celebration-seen` — dismiss celebration overlays
- `POST /api/student/complete-onboarding` — finish first-time onboarding
- `POST /api/student/refresh-watch-sync` — force a Whop watch-history pull
- `GET  /api/student/data` — full snapshot for the dashboard

**Admin**
- CRUD on templates (`/api/admin/templates`, `/api/admin/templates/[id]`),
  tasks (`/api/admin/tasks`, `/api/admin/tasks/[id]`, plus
  copy/dismiss/refire/transition), discord toggles, admin_config
- Sync triggers (`/api/admin/sync-whop`, `/api/admin/rebuild-snapshots`,
  `/api/admin/backfill-discord-ids`)
- Day-28 DM preview (`/api/admin/preview-day28-dm`)
- Ad-submissions verification gate
  (`/api/admin/verify-ad-submissions`)
- KPIs + insights (`/api/admin/kpis`, `/api/admin/insights/progress`)

**Discounts**
- `POST /api/discounts/request` — student opens flow
- `POST /api/discounts/submit-feedback` — 6-question form
- `POST /api/discounts/approve` — creates Whop promo
- `POST /api/discounts/reject`
- `POST /api/discounts/mark-applied`

**Webhooks**
- `POST /api/webhooks/whop` — HMAC-verified Whop events

**Cron** (Vercel scheduled)
- `GET /api/cron/sync-whop` — pull Whop watch history into completions
- `GET /api/cron/check-engagement` — engagement scan → `disengagement_alerts`
- `GET /api/cron/check-csm-tasks` — evaluate triggers, create CSM tasks
- `GET /api/cron/snapshot-progress` — write `daily_progress_snapshots`
- `GET /api/cron/day28-dm` — fire day-28 Discord DM

**Public**
- `GET /api/tasks/[taskId]` — public task lookup (CSM dashboard links)

## Database — Active Tables

See [system_contracts.md](system_contracts.md) for who depends on whom.

**Identity / accounts**
- `team_members` — founder/admin/CSM accounts (Supabase auth-linked)
- `students` — student row (Whop user + Supabase auth bridge).
  Identity-only after v46/v47: id, whop_user_id, name, email,
  membership_status, etc. Per-function state lives in the sibling
  tables below.

**Curriculum (read-mostly)**
- `regions` — R1–R4 metadata
- `lessons` — canonical lesson list (id, region, day, sort_order,
  watch vs action, `whop_lesson_id`, etc.)
- `quizzes` + `quiz_questions` — per-region quizzes
- `playbook_nodes` — Map 2 hub cards
- `templates` — CSM DM templates (built-in + custom, with `trigger_config`)
- `admin_config` — key/value app config (booking link, program link, etc.)

**Student state (per-student rows — one table per function, v46)**
- `student_milestones` — onboarding + sprint progression timestamps
  (onboarding_completed_at, first_sprint_login_at,
  bounty_access_claimed_at, sprint_completed_at,
  first_client_landed_at, playbook_welcome_seen_at)
- `student_streaks` — current_streak, longest_streak, last_streak_date
- `student_whop_sync` — Whop OAuth tokens + watch-history sync diagnostics
- `student_celebrations` — last_streak_milestone_shown,
  month_review_seen_at, celebrated_region_ids
- `student_dm_log` — outbound DM-sent flags (day28_dm_sent_at; extend
  as new DM flows ship)
- `student_lesson_completions` — watch + action shipping state per lesson
- `daily_notes` — one row per student per day
- `lesson_notes` — per-lesson note
- `student_quiz_attempts` — quiz attempts
- `student_rewards` + `hidden_rewards` — surprise reward system
- `month_reviews` — month-end student review
- `discount_requests` + `discount_feedback_questions` +
  `discount_feedback_responses` — discount flow
- `disengagement_alerts` — auto-generated churn alerts
- `tasks` — CSM task queue (per-student, per-scenario, links to `templates`)
- `daily_progress_snapshots` — frozen daily progress per student

**Legacy / archive (do not extend)**
- `lessons_archive` — frozen pre-migration copy
- `student_task_completions` — predates `lessons`; new code uses
  `student_lesson_completions`
- `checkpoints` — older waypoint model; superseded by `regions`/`lessons`

## Cron Jobs (Vercel)

| Job | Cadence | What it does |
|-----|---------|-------------|
| `sync-whop` | hourly | Pull Whop watch history → `student_lesson_completions` |
| `check-engagement` | daily | Detect churn signals → `disengagement_alerts` |
| `check-csm-tasks` | daily | Evaluate `templates.trigger_config` → `tasks` |
| `snapshot-progress` | daily | Freeze today's progress per student |
| `day28-dm` | daily | Fire day-28 Discord DM |

Schedules live in `vercel.json`.

## Key Libraries (`src/lib/`)

| File | Owns |
|------|------|
| `supabase-browser.ts` / `supabase-server.ts` | Client construction |
| `admin-auth.ts` | Team auth gate for API routes |
| `whop.ts` / `whop-members.ts` / `whop-sync-runner.ts` | Whop HTTP + sync |
| `pkce.ts` | OAuth PKCE helpers |
| `csm-triggers.ts` | Trigger metric registry + evaluator |
| `csm-events.ts` | CSM event hooks (called from mark-* routes) |
| `templates.ts` | DM template renderer (variable substitution) |
| `dm-toggles.ts` | Day-28 DM enable/disable |
| `streak.ts` | Streak math |
| `quiz.ts` | Quiz scoring |
| `discord.ts` | Discord HTTP helpers |
| `day28-embed.ts` | Day-28 DM embed builder |
| `titles.ts` | Student title progression |
| `constants.ts` | Lesson groups, discount window, etc. |
| `motion.ts` | GSAP / Framer easing constants |
| `useMediaQuery.ts` | SSR-safe phone-detection hook |
| `useFocusTrap.ts` | Modal a11y |
| `map/` | Map geometry (path math, region bounds) |
| `sop-templates.ts` | SOP scaffolding |

## State Management

| Context | Scope | What it provides |
|---------|-------|-----------------|
| `AuthContext` | Global | `user`, `session`, `student`, `teamMember`, `isStudent`, `isTeam`, `signOut()`, `setStudent()` |
| `StudentContext` | `/dashboard`, `/dashboard/playbook` | Lessons, completions, streaks, discount state, sprint milestones, playbook welcome, first-client landed, action-shipped toggles, etc. |

## Integrations

| Integration | Used for | Env vars |
|-------------|----------|----------|
| Supabase | DB + auth + RLS | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Whop | OAuth, promo codes, watch sync, membership webhooks | `WHOP_CLIENT_ID`, `WHOP_CLIENT_SECRET`, `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_COMPANY_ID`, `WHOP_PRODUCT_ID` |
| Discord | Day-28 DM, churn DMs | `DISCORD_BOT_TOKEN` |
| Vercel | Hosting + cron + analytics | `vercel.json` |

## Other docs in this repo

- [PLATFORM_OVERVIEW.md](PLATFORM_OVERVIEW.md) — Karlo-facing product
  description (what each surface does for the user). Regenerated when
  the product changes meaningfully.
- [LESSONS_OVERVIEW.md](LESSONS_OVERVIEW.md) — lesson-by-region
  canonical order.
- [AGENTS.md](AGENTS.md) — Next.js 16 agent rules (read for any
  Next.js-API-specific work).
- `README.md` — repo intro for new devs.

## How to do common things

| Want to | Read |
|---------|------|
| Add a new lesson | `supabase/migrations/2026_v20_canonical_lesson_state.sql` for canonical shape, then write a new migration |
| Add a new CSM trigger metric | `src/lib/csm-triggers.ts` (`METRICS` registry + `evalCondition`) + type union in `src/types/database.ts` |
| Add a new student-state field | First check CLAUDE.md "table-level bounded contexts" — it probably belongs in its own table, not on `students` |
| Touch the map's camera | `src/components/mockup/MapMockup.tsx` (`transformRef` + `applyTransform`) |
| Add a new DM template | `/admin/templates` (UI, not migration) |
| Run a one-off DB change | New migration in `supabase/migrations/`, idempotent |
| Update CONTEXT.md | When you add/rename/delete a route, table, context, or lib module |
| Update system_contracts.md | When you add a table, or change which fields outside callers depend on |
