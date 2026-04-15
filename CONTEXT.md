# EcomTalent Student Platform

A Next.js web app for EcomTalent, Karlo's $97/month ecommerce education community hosted on Whop. Students follow a 30-day interactive playbook (23 tasks across 4 weeks), track progress with daily notes, and earn a 30% discount by completing 13 required tasks. The team (Karlo + Astrid) monitors engagement, manages discount approvals, and gets automatic churn alerts.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Supabase (auth + PostgreSQL + RLS), Whop API (OAuth 2.1 + PKCE, webhooks, promo codes), Vercel (hosting + cron)

---

## Student Flow

Students authenticate via Whop OAuth and land on `/dashboard`.

| Page | What it does |
|------|-------------|
| `/login` | "Sign in with Whop" button — starts OAuth flow |
| `/dashboard` | Main view: progress bar, 4-week playbook checklist, discount tracker, daily note input |
| `/dashboard/notes` | Archive of all daily notes |

**State management:** `StudentContext.tsx` fetches tasks, completions, today's note, and discount status. Provides `toggleTask()`, `saveNote()`, `requestDiscount()` actions. Updates `last_active_at` on every action.

**Key components:** `PlaybookChecklist`, `TaskItem`, `WeekSection`, `ProgressBar`, `DailyNoteInput`, `DiscountTracker`

---

## Team Flow

Team members authenticate via Supabase email/password and access `/admin`.

| Page | What it does |
|------|-------------|
| `/admin` | KPI dashboard: active students, joined this week, avg progress, churn rate |
| `/admin/login` | Email/password login for team |
| `/admin/students` | Sortable/filterable student table with search |
| `/admin/students/[id]` | Detailed student view: progress, activation points, notes, DM templates |
| `/admin/discounts` | Pending discount requests — approve (creates Whop promo) or reject |
| `/admin/alerts` | Auto-generated churn alerts with dismiss toggle |

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/whop/authorize` | GET | Start Whop OAuth + PKCE flow |
| `/api/auth/whop/callback` | GET | Complete OAuth, create/sign-in Supabase user, upsert student |
| `/api/discounts/request` | POST | Student requests discount (requires 13/13 tasks) |
| `/api/discounts/approve` | POST | Team approves — creates Whop promo code |
| `/api/discounts/reject` | POST | Team rejects with optional reason |
| `/api/webhooks/whop` | POST | Membership events (HMAC verified) — sync student status |
| `/api/cron/check-engagement` | GET | Daily 9am — scan for churn signals, create alerts |

---

## Database

7 tables in Supabase with RLS. Schema at `supabase/schema.sql`, seed data at `supabase/seed.sql`.

| Table | Purpose |
|-------|---------|
| `team_members` | Founder/CSM accounts (role: founder, csm, admin) |
| `students` | Student profiles — Whop data, membership status, activity timestamps |
| `tasks` | Master list of 23 playbook tasks (seeded once, read-only) |
| `student_task_completions` | Which student completed which task |
| `daily_notes` | One note per student per day (upsert) |
| `discount_requests` | Track promo code requests (pending/approved/rejected) |
| `disengagement_alerts` | Auto-generated churn warnings for team |

---

## State Management

| Context | Scope | What it provides |
|---------|-------|-----------------|
| `AuthContext` | Global | `user`, `session`, `student`, `teamMember`, `isStudent`, `isTeam`, `signOut()` |
| `StudentContext` | `/dashboard` | Tasks, completions, notes, discount status, `toggleTask()`, `saveNote()`, `requestDiscount()` |

---

## Components

| Component | Used in | Purpose |
|-----------|---------|---------|
| `StudentGuard` | Dashboard layout | Redirects non-students to `/login` |
| `TeamGuard` | Admin layout | Redirects non-team to `/login` |
| `ProgressBar` | Dashboard | Visual progress (0-100%) |
| `PlaybookChecklist` | Dashboard | 4-week grouped task list |
| `WeekSection` | PlaybookChecklist | Tasks grouped by week |
| `TaskItem` | WeekSection | Single task with checkbox |
| `DailyNoteInput` | Dashboard | Textarea for today's note |
| `DiscountTracker` | Dashboard | Shows 13/13 progress + request button |

---

## Integrations

| System | Purpose | Config |
|--------|---------|--------|
| Supabase | Auth, database, RLS | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Whop | OAuth login, membership webhooks, promo codes | `WHOP_CLIENT_ID`, `WHOP_CLIENT_SECRET`, `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_COMPANY_ID`, `WHOP_PRODUCT_ID` |
| Vercel | Hosting, cron jobs | `vercel.json` defines daily cron at 9am |
| Discord | Phase 2 — webhook notifications | `DISCORD_WEBHOOK_URL` (not yet active) |

---

## Business Rules

1. **30-Day Playbook:** 23 tasks across 4 weeks. Progress = completed / 23.
2. **Activation Points:** AP1 (content engagement), AP2 (ad creation), AP3 (bounty submissions).
3. **Discount Eligibility:** Complete 13 specific required tasks from Weeks 1-2 to unlock 30% promo request.
4. **Promo Code Format:** `ECOM30-{studentId[:6]}` — 30% off, single-use, 1-month duration.
5. **Churn Alerts (auto):** No tasks in 7d, no AP1 by day 14, inactive 5d, Week 2 not started by day 8.
6. **day_number:** Always computed from `joined_at`, never stored.
7. **Mutations:** All go through API routes, never direct client-side Supabase writes.
