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
  to-dos) and `/dashboard/playbook` (Map 2: post-sprint hub with 3
  always-on cards, each opening a full HTML article in an iframe —
  v72).
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
| `/dashboard` | The map (overview + 4 regions). Auto-redirects to `/dashboard/playbook` once the student has completed `PLAYBOOK_UNLOCK_LESSON_ID` (l078, the last R4 watch lesson) unless `?map=1` is passed. |
| `/dashboard/playbook` | Map 2 hub. Two unlock paths (v75.16, see `isPlaybookUnlocked` in `src/lib/progress.ts`): standard sprint completion of l078 ("How I Approach Research / Coming Up With Ad Ideas"), OR legacy auto-unlock (`joined_at >= 30 days ago` AND completion ratio >= 0.80) — for older customers who passed the action-item phase before our platform existed. Bounty Access (`bounty_access_claimed_at`) is a SEPARATE milestone and does NOT unlock the Playbook. |

**State:** `AuthContext` (session + student row), `StudentContext`
(lessons, completions, streaks, discount, sprint milestones, playbook
welcome, first-client landed, etc.).

**Auth failure codes (v85.9).** Every auth path exits through
`/login?error=<code>&detail=<what actually happened>`, and the login
screen now renders the raw code unconditionally — a screenshot of that
line is enough to route a ticket without asking the student for logs.
Codes: `no_membership`, `session_expired` (the 60s `pending_session`
handoff cookie was gone — usually a reloaded `/auth/complete` tab),
`session_timeout` (auth host never answered), `session_failed`,
`auth_failed`, `state_invalid`, `missing_params`, `callback_failed`,
`access_denied`, `profile_load_failed`. Details are prefixed `server:`
or `client:` so the two sides that both emit `session_failed` stay
distinguishable. **Add a map entry in `src/app/login/page.tsx` whenever
you add a code** — an unmapped code falls through to a generic sentence
and the branch is lost. Both spinner gates (`auth/complete`,
`AuthContext`) now have hard 15s watchdogs; neither can hang
indefinitely again.

**⚠️ The 429 logout — ROOT CAUSE, confirmed by source-level trace
(v85.13, 2026-08-28).** Two independent defects, both now fixed:

**1. One 429 deletes the session.** auth-js treats only 502/503/504 as
retryable (`auth-js lib/fetch.js:16`). A 429 becomes a fatal
`AuthApiError`, and `_callRefreshToken` responds by calling
`_removeSession()` (`GoTrueClient.js:3897-3898`) — wiping the auth
cookie and emitting SIGNED_OUT. The next read returns null, which is
the `session was cleared mid-load` message students saw. **There is no
volume requirement: a single rate-limited refresh is enough.** Fixed by
a `global.fetch` interceptor in `lib/supabase-browser.ts` that rewrites
a 429 on `/auth/v1/token` to a 503 (retryable, session preserved) with
a 60s cooldown so retries cost no network.

**2. A TOKEN_REFRESHED feedback loop generated the 429.**
`onAuthStateChange` re-fetched the profile on token events.
TOKEN_REFRESHED fires after EVERY refresh (`GoTrueClient.js:3888`) and
is replayed into every other tab over a BroadcastChannel
(`:193-196`). Each one called `fetchProfile` → `getSession` → refresh
if the stored session still read as expired (`:2333-2335`) →
TOKEN_REFRESHED again. Unbounded, RTT-paced, and enough to drain
Supabase's 30-token burst bucket. Fixed by re-fetching only on
**identity** change, never on a token event.

**CORRECTION — v85.12's premise was false.** It claimed concurrent
`getSession()` calls each fire their own refresh. They never did:
`@supabase/ssr` caches one browser client
(`createBrowserClient.js:8,11-15`), `GoTrueClient` single-flights
refresh (`:3875-3877`), and `__loadSession` re-reads storage inside
the lock (`:2307-2337`). N concurrent calls produce at most ONE POST to
`/token`. `getSharedSession` is kept (it saves redundant cookie reads)
but does NOT prevent refresh storms. Do not re-derive that theory.

**STILL UNPROVEN — what makes a just-refreshed session read as
expired.** Every expiry check uses the LOCAL clock against
`EXPIRY_MARGIN_MS` = 90s (`GoTrueClient.js:2333-2335`,
`lib/constants.js:6,9,13`). Two candidates: (a) the student's device
clock runs fast by more than `jwt_exp − 90s`, which also explains why
login succeeds — `setSession` uses NO margin (`:2795-2802`) while
`__loadSession` uses 90s; or (b) `jwt_exp` is configured at or under
~90s, making every token born expired. Settled by reading
Supabase → Authentication → Sessions, and by asking the student what
time his device says.

**⚠️ Call gates — the cap that does NOT depend on knowing the cause
(v85.14).** `src/lib/call-gate.ts`. A student's tab called `/api/auth/me`
and `/api/student/data` roughly **once per second for 72 seconds** on
2026-08-27 — about **800 Supabase queries from one tab** (each
`/api/student/data` fans out to ~11 table reads). The refresh storm
drained Supabase's token bucket, the 429 deleted his session, and he was
bounced to `/login`.

**Five fixes chased the TRIGGER of that loop and none was confirmed.**
This one doesn't try. `fetchProfile` is capped at once per 10s and the
background `refreshFromServer` at once per 5s, whatever calls them. A
runaway becomes one call per interval instead of seventy. Gates are
MODULE-level, never refs — a remount-driven loop would reset a ref and
the cap would never hold.

`refreshFromServer` throttles **by default**; user-initiated callers
(`toggle-lesson`, `toggle-action`, `submit-quiz`, `force-sync`) pass
`{ throttled: false }` because capping those would visibly stall the UI.
Default-on means a new automatic caller is capped without anyone
remembering to.

**Blocked calls report themselves** to `POST /api/client-event` (one line
per 30s per gate, never per call), which logs to Vercel as
`[client-event]`. **This is the first client-side visibility this app has
ever had** — every diagnosis before it depended on a student sending
screenshots. If the loop survives the cap, that log line names the
trigger.

**STILL UNKNOWN: what drives the loop.** Candidate worth checking first —
`StudentContext.tsx:509` calls `setStudent(fresh.student)` with a fresh
object on every refresh, and the data effect depends on `[student]`, so
each refresh re-triggers a full fetch. A closed cycle was never traced.

**A failed auth load is NOT the same as being signed out (v85.11).**
`AuthContext` exposes `authError`. A null student with a null
`authError` means genuinely signed out; a null student WITH an
`authError` means the load broke and we could not tell. `StudentGuard`
routes the second case to `/login?error=profile_load_failed&detail=…`
instead of a bare `/login`. Before this, `fetchProfile` had **four**
silent exits — an unguarded `getSession()`, two bare `return`s, and a
swallowing `catch` — and every one bounced the student to a clean login
screen that looked exactly like a normal logout. A student who was
correctly signed in but whose profile fetch failed was indistinguishable
from one who simply wasn't logged in. **Any new early return in
`fetchProfile` must return a reason string, never a bare `return`.**

**⚠️ The auth lock steal — root cause of the 2026-08 login failures
(diagnosed + fixed 2026-08-27, v85.10).** Any login whose `setSession`
round-trip exceeded **5 seconds** failed outright. Mechanism:

1. `/auth/complete` calls `setSession()`, which grabs the shared Web Lock
   `lock:sb-<project-ref>-auth-token` and **holds it across a network
   round-trip**.
2. `AuthProvider` (mounted in the ROOT layout, so it runs on that page
   too) calls `getSession()` and waits on the same lock.
3. At `lockAcquireTimeout` — **5000ms**, `GoTrueClient.js:28` — the waiter
   gives up and *steals* the lock (`locks.js:203`).
4. `setSession` sees it lost the lock and throws
   `Lock "…" was released because another request stole it`
   (`locks.js:243`).

React runs child effects before parent effects, so `setSession` always
grabbed the lock first and `AuthProvider` was always the thief. Not a
race — deterministic above 5s. The error is a plain `Error`, NOT an
`AuthError`, so `setSession` **rethrows** it instead of returning it in
`{ error }` — which is why it was an unhandled rejection and the page
hung silently rather than reporting anything.

Fixed by taking `AuthProvider` off the lock on `/auth/complete` (nothing
there reads auth state; it hard-redirects, which remounts the provider
clean), plus a retry on lock-contention errors.

**Do not add a Supabase auth call to any component that renders on
`/auth/complete`.** It will reintroduce the steal. And note the residual:
Web Locks are **per-origin, not per-page**, so a second tab open on the
app can still contend. The retry covers it; it is not a guarantee.

Two earlier diagnoses of this were WRONG and are recorded so nobody
re-derives them: it is not ISP/network blocking of Supabase (the
symptom "server-side works, client-side hangs" fits both), and it is
not duplicate Supabase clients (`@supabase/ssr` v0.10.2 already
singletons in the browser — `createBrowserClient.js:8-14`).

## Admin Surfaces

| Path | What it is |
|------|------------|
| `/admin/login` | Email/password (Supabase Auth, `team_members` table) |
| `/admin` | KPI overview. **Month 2 conversion produced no usable reading before 2026-08-07** — see the warning under this table before citing any historical M2 figure. |
| `/admin/journey` | Student journey board (per-week columns, pace overview, drawer detail) |
| `/admin/students` + `/admin/students/[id]` | Table view + detail |
| `/admin/templates` | CSM DM template editor (built-ins + custom, with TriggerBuilder). v85: per-template effectiveness strip on each row (sent · % re-engaged within 72h · replied) from `/api/admin/templates/stats`. |
| `/admin/tasks` | CSM task queue (open / completed / dismissed). Open tab is priority-first: Canceling (derived from the STUDENT row via `isCanceling`, pinned on top regardless of template) → Cancel path → At risk → Events & wins, oldest-first with waiting-time chips; cards carry behavior summary + @discord / No-Discord + Canceling / Past-due pills; queue-health strip (open by tier, oldest wait, sent today). Sent/Dismissed keep recency grouping. Queue \| Insights sub-nav (v85.2). |
| `/admin/tasks/insights` | Outreach insights (v85.3, Phase 0 measurement surface). Range selector (30d / all-time), KPI row (students reached, sent, median task→send, SAVES, SUCCESS RATE), unmarked-outcomes nudge, sortable per-template table (sent, time→send, per-family success with definition under each title, replied), plain-language methodology box. PER-FAMILY SUCCESS: stalled→logged in ≤72h, nolessons→started a lesson, noship→shipped an action, pace/custom→came back (dormant sends only), canceling→currently active with cancel withdrawn (current-state, no timing attribution until cancel_rescinded_at exists), events→not graded. All numbers from `src/lib/outreach-insights.ts`. |
| `/admin/discounts` | Pending discount review |
| `/admin/alerts` | Auto-generated churn alerts |
| `/admin/insights` | Progress + retention insights |
| `/admin/discord` | Day-28 DM toggles, preview |
| `/admin/settings` | Admin config (booking link, program link, etc.) |
| `/admin/stats` | **Whop revenue, FOUNDER-ONLY (v86).** The per-product money tracking Whop removed from their own dashboard UI. Catalog-driven: any of Whop's 64 Stats metrics as a tile, 23 of them filterable by product, 20 months of history (from 2025-02), date-range presets + previous-period delta + daily/weekly/monthly, saved layouts. **The only dynamic (`ƒ`) page under `(authenticated)`** — it awaits `cookies()` and checks `isStatsOwner(user.id)`, so it is not prerendered and not client-gated like the other 17. Nothing is stored; every figure is read live. See `system-docs/plan_2026-09-03_revenue-stats-page.md`. |
| `/journal/[studentId]` | Student daily-notes journal (read-only for team) |

**Launch cohort only (v75.51):** every admin metric surface (dashboard, /admin/students, /admin/journey, /admin/not-activated, /admin/insights, /admin/discounts) filters to the LAUNCH COHORT — students whose `first_paid_at >= ADMIN_STUDENT_JOIN_CUTOFF` (2026-05-25). Pre-launch / legacy customers are excluded from operational surfaces. The previous "All members | New students" scope toggle (v75.13–v75.50) was removed because it produced inconsistent reads across surfaces and obscured the actual launch-retention signal. CSM crons and the day-28 DM also filter via their own (independent) day-30 sprint-window filter (`csmSprintWindowCutoffIso()`).

**Canceling state (v75.46–v75.47):** Whop emits a "Canceling" status when a student clicks cancel but still has access through the end of their billing cycle. The sync runner stamps `students.cancel_scheduled_at` for these students. The dashboard surfaces a "Canceling" early-warning tile; the journey kanban shows an amber pill on the student card. The M2 conversion helper (`isMonth2Converted`) counts Canceling students as NOT converted if the cancel was scheduled on/before the end of the first cycle.

**⚠️ Month 2 conversion produced NO usable reading before 2026-08-07. Do not cite any historical M2 figure.** Two separate defects ran back to back:

1. *Launch → 2026-08-06 (fixed in 8e9c9cd, v85.7).* The denominator called `isInMonth2Cohort` bare inside `.filter()`, so the array index landed in the helper's optional `asOfMs` param and the day-30 check compared a timestamp against `0, 1, 2…`. Denominator permanently 0, rate permanently null, card stuck on "Waiting on the first month-2 cohort." **through month 3.**
2. *2026-08-06 → 2026-08-07 (fixed in 71ba058, v85.8).* With the denominator restored the card printed **98%** — a tautology. `canceled_at` is an access-END/observation stamp, and on a monthly plan access always ends AT the cycle boundary, so `canceled_at > first_paid_at + 30d` was true for every ordinary non-renewal. 133 of 144 churned students scored as retained. Corrected to cycle-end + 7d grace: **284/291 = 98% → 140/247 = 57%**, verified against production counts.

Both failed into *plausible* states rather than errors, and in both cases a stale code comment vouched for the wrong behaviour — which is why neither was caught for months. Before trusting any metric here, check whether its value has ever actually moved. The full derivation, the calibration histogram, and the arity warning live in the `RENEWAL_GRACE_MS` docstring in `src/lib/admin/metrics-definitions.ts` — read it before editing either helper.

**M2 is a PROXY, permanently, until a payment signal exists.** No payments/invoices/transactions table exists in the schema; conversion is inferred from access surviving the renewal point. Win-backs (`canceled_at` is cleared on reactivation) and `past_due` students mid-dunning both still read as converted. The real signal is Whop's `renewal_period_start` — it is declared at `src/types/whop.ts:32` but MISSING from `WhopMembershipRow` (`src/lib/whop-members.ts`), so TypeScript erases it from every sync read and it has been silently discarded since launch. Identical class to the `cancel_at_period_end` miss fixed in v75.46. Adding it (plus a `students.current_period_start` column) turns M2 from an inference into an observation.

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
- `POST /api/student/dismiss-playbook-welcome` — Map 2 intro (v2)
- `POST /api/student/celebration-seen` — dismiss celebration overlays
- `POST /api/student/complete-onboarding` — finish first-time onboarding
- `POST /api/student/mark-dashboard-login` — stamp first /dashboard load (v51)
- `POST /api/student/mark-intro-video-threshold` — intro video watched end-to-end (v51; v72.5/72.6 dropped the ~65% threshold for a full-`ended` requirement, column name kept for back-compat)
- `POST /api/student/dismiss-why-youre-here` — final WYH card dismissed (v51)
- `POST /api/student/submit-region-quiz` — region-quiz attempt (v65). One round-trip per completed attempt: updates last/best score, increments attempts, stamps `quiz_passed_at` on first attempt at ≥ 50%. Replaces v54's mark-region-quiz-passed + increment-region-quiz-attempts split.
- `POST /api/student/refresh-watch-sync` — force a Whop watch-history pull
- `GET  /api/student/data` — full snapshot for the dashboard

**Admin**
- CRUD on templates (`/api/admin/templates`, `/api/admin/templates/[id]`),
  tasks (`/api/admin/tasks`, `/api/admin/tasks/[id]`, plus
  copy/dismiss/refire/transition/outcome), discord toggles, admin_config
- `GET /api/admin/tasks/insights?since=<ISO>` (v85.2) — full outreach
  payload for /admin/tasks/insights: totals + per-template rows
  (revival rate, re-engagement, reply outcomes, dismissal split, median
  time-to-send). Computed by `src/lib/outreach-insights.ts`.
- `GET /api/admin/templates/stats` (v85, Phase 0 retention) — thin
  all-time projection over the SAME `outreach-insights.ts` computation
  (v85.2 refactor) for the inline strip on /admin/templates: per
  template created/open/sent/dismissed, replied/no_reply,
  re_engaged_72h. The strip and the insights page can never disagree.
- `POST /api/admin/tasks/[id]/outcome` (v85) — one-tap replied/no_reply
  on sent tasks; null clears; requires the v85 migration.
- Sync triggers (`/api/admin/sync-whop`, `/api/admin/rebuild-snapshots`,
  `/api/admin/backfill-discord-ids`, `/api/admin/backfill-first-paid-at` v75.34,
  `/api/admin/refresh-everything` v75.22)
- Day-28 DM preview (`/api/admin/preview-day28-dm`)
- Ad-submissions verification gate
  (`/api/admin/verify-ad-submissions`)
- `GET /api/admin/stats` (v86) — **founder-only** revenue proxy for
  /admin/stats. Gated by `requireStatsOwner()` (id allowlist, NOT role).
  Params: `range` (named preset only — raw from/to is deliberately not
  accepted), `granularity`, `metrics` (max 12), optional `product`.
  Returns per-tile discriminated unions (`ok` / `no_data` / `error` with a
  closed-union reason), the resolved window, both windows' values, and a
  `credentialFailure` rollup. `no-store` + `Vary: Authorization` on every
  response including the 401s. `maxDuration = 30` (deliberately NOT the
  house 300 — this is an interactive page load).
- `GET/PUT/DELETE /api/admin/stats/views` (v86) — founder-only saved tile
  layouts in `stats_saved_views`. Views are archived, never deleted.
- v75.38 + v75.45: `/api/admin/kpis` and `/api/admin/insights/progress` routes deleted (the M2 helper centralized + insights now fetches snapshots client-direct)

**Discounts** (all require auth post-v75.31)
- `POST /api/discounts/request` — student-self auth; opens flow
- `POST /api/discounts/submit-feedback` — student-self auth; 6-question form
- `POST /api/discounts/approve` — team auth (founder/admin/csm); creates Whop promo
- `POST /api/discounts/reject` — team auth
- `POST /api/discounts/mark-applied` — team auth
- All four gates (`request`, `submit-feedback`, `approve`, UI) treat NULL `first_paid_at` as ineligible (v75.26 closed a discount-leak that let returning customers get a fresh 14-day window via the `joined_at` fallback).

**Webhooks**
- `POST /api/webhooks/whop` — HMAC-verified Whop events
- `POST /api/webhooks/adbounty` — Zak's ad-bounty system fires here on
  enrollment → stamps `student_milestones.bounty_access_claimed_at`
  (sole source of that timestamp)

**Cron** (Vercel scheduled)
- `GET /api/cron/sync-whop` — pull Whop watch history into completions
- `GET /api/cron/check-engagement` — engagement scan → `disengagement_alerts`
- `GET /api/cron/check-csm-tasks` — evaluate triggers, create CSM tasks
- `GET /api/cron/check-na-tasks` — Not-Activated escalation (Day 3/5/7/10) (v51)
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
  - **`membership_status` is the sole dashboard access gate.**
    `MembershipBlockOverlay` (mounted on `/dashboard/layout.tsx`) hard-
    blocks on anything other than `'active'` and never asks Whop. So a
    stale value here locks out a fully paid student while every Whop-
    native module keeps working. One row, but a Whop user may hold
    SEVERAL memberships (re-subscribe, refund + rebuy, free-plan claim,
    or a duplicate from clicking Renew on the overlay). Every writer
    must resolve "does this user still have access anywhere?", never
    "what did this one membership just do?". Three writers: the
    `membership.deactivated` webhook (re-points to a surviving
    membership instead of revoking, v85.6), `sync-whop`, and the OAuth
    callback self-heal (runs whenever the row isn't active, so any
    DB/Whop divergence self-corrects on next login, v85.6).
  - `canceled_at` is OUR observation timestamp, written with
    `new Date()` when our code decides a student is terminal. It is not
    Whop's cancellation date and must never be read as one.

**Curriculum (read-mostly)**
- `regions` — R1–R4 metadata
- `lessons` — canonical lesson list (id, region, day, sort_order,
  watch vs action, `whop_lesson_id`, etc.)
- `quizzes` + `quiz_questions` — per-region quizzes
- `playbook_nodes` — Map 2 hub cards (3 rows as of v72:
  pb_submit_bounties, pb_build_portfolio, pb_apply_job_board). Each
  row's `article_slug` points at `public/playbook/<slug>/index.html`,
  a standalone HTML article the node sheet renders in an iframe.
  doc_content is no longer rendered. The pb_land_first_client
  milestone node was dropped (v72).
- `templates` — CSM DM templates (built-in + custom, with `trigger_config`)
- `admin_config` — key/value app config (program link, Discord invite, etc.)

**Student state (per-student rows — one table per function, v46)**
- `student_milestones` — onboarding + sprint progression
  (onboarding_completed_at, first_sprint_login_at,
  first_dashboard_login_at, intro_video_threshold_met,
  why_youre_here_panel_dismissed, bounty_access_claimed_at,
  first_client_landed_at, playbook_welcome_seen_at).
  Note: `first_client_landed_at` is dormant - the column persists but
  the API route, celebration component, and milestone node were all
  removed in v72.4. Safe to drop in a future migration if reclaimed.
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
- `tasks` — CSM task queue (per-student, per-scenario, links to
  `templates`). v85 added `outcome` (replied/no_reply/NULL, manual CSM
  tap on the Sent tab) + `outcome_at` + `outcome_by` — Phase 0 of the
  retention overhaul's feedback loop.
- `daily_progress_snapshots` — frozen daily progress per student. v77 added cohort columns (`active_count_cohort`, `joined_count_cohort`, `churned_count_cohort`, `avg_progress_cohort`). After v75.51 (scope toggle removed), only the `_cohort` columns are read by the UI; the legacy non-cohort columns are still written by the snapshot cron for historical continuity. v81 aligned the cron + RPC + dashboard avg_progress formula on the canonical isLessonComplete + l057 exclusion (single source of truth).
- `sync_runs` — audit log for the Whop community sync (v77). One row per attempt with source (cron / admin-button), status (success/failed), counts (fetched/inserted/updated/skipped/errors), duration_ms, error_message. Team-read RLS. Use to answer "did sync run last night?" without digging Vercel logs.
- `canceling_snapshots` (v84) — one row per day: how many launch-cohort
  paying students were in Whop's "Canceling" state at snapshot time.
  Written by the snapshot-progress cron; feeds the dashboard Canceling
  tile's trend line. DELIBERATELY separate from
  `daily_progress_snapshots`: the rebuild RPC deletes+reinserts that
  table and point-in-time canceling state can't be recomputed — a
  column there would be wiped on every "Refresh everything".

- `stats_saved_views` (v86) — saved tile layouts for the founder-only
  `/admin/stats` page. Holds only WHICH metrics are on screen and how
  they are arranged; **no revenue figure is stored here or anywhere
  else in this schema.** `layout` is `jsonb` (not text) so a corrupt
  payload is rejected by Postgres at write time rather than surfacing
  as a render crash. Views are archived (`status`), never deleted, so a
  layout that broke the page stays inspectable.
  **The only table in this schema whose RLS is NOT role-blind:** its
  policy is `public.current_user_is_stats_owner()`, which keys on the
  immutable `auth.users` id. Every other table grants read via
  `current_user_is_team()`, meaning a CSM's JWT can select from it —
  copy the stats-owner predicate, not `current_user_is_team()`, for
  anything that ever holds or describes money.
  Rejected reusing `admin_config` for this: its read policy is
  team-wide AND `/admin/settings:55` does an unfiltered `select("*")`
  with the browser client and renders every row as an editable
  `<input>`, so a layout blob would have been readable and corruptible
  by the CSM.
- `cron_runs` (v82) — audit log for ALL six cron invocations. Captures route_name, started_at, finished_at, auth_status, status (running/success/failed/auth_failed), error_message, rows_affected. Written by every cron handler via `src/lib/cron-auth.ts`. Use to answer "did Vercel fire this cron in the last 24h?" — separable from sync_runs which only covers sync-whop.
- `achievements` — catalog of 17 unlockable achievements (v53)
- `student_achievements` — per-student unlock rows + `achievement_unlock_stats`
  view exposing global unlock % (v53)
- `student_region_quiz` — per-(student, region) quiz_passed_at +
  quiz_attempts + best_score_pct + last_score_pct + last_attempt_at
  (v54 + v65). regions.quiz_format controls which mini-game wrapper
  to render (v70: r1 → `swipe_cards`, r2 → `stack_builder`,
  r3 → `constellation`, r4 → `vault_tumblers`). v65 - quiz_passed_at
  now stamps on first attempt at ≥ 50% (was: 100% deck clear).
  Sub-50% scores leave the Onward gate locked until a passing
  attempt. All four formats share the same v65 drain-through
  contract, plug into the shared QuizModal + ResultScreen.
**Legacy / archive (do not extend)**
- `lessons_archive` — frozen pre-migration copy
- `student_task_completions` — predates `lessons`; new code uses
  `student_lesson_completions`
- `checkpoints` — older waypoint model; superseded by `regions`/`lessons`

## Cron Jobs (Vercel)

| Job | Cadence | What it does |
|-----|---------|-------------|
| `sync-whop` | every 2h at :00 (v85.5, was daily) | Pull Whop watch history → `student_lesson_completions`. Also stamps `students.cancel_scheduled_at` from Whop's `cancel_at_period_end` field (v75.46). 2h cadence exists FOR the cancel flag: cancel click → save task within ~2h15m instead of up to 24h. **v85.6:** a user holding several memberships is deduped by ACCESS first, `created_at` recency only as a tiebreak within the same access class (`grantsAccess` in `src/lib/whop-members.ts`). Was recency-only, which let a dead duplicate outrank a live membership and hard-block a paid student on every run. |
| `snapshot-progress` | daily 00:30 UTC (deliberately NOT 2h) | Writes yesterday+today rows to `daily_progress_snapshots` + the daily Canceling count to `canceling_snapshots` (v76). Daily-grain by design — one row per day. Reads canonical `student_progress_counts` view (v75.28) so dashboard live values match snapshot trend values. |
| `check-engagement` | every 2h at :10 (v85.5) | Detect churn signals → `disengagement_alerts` |
| `check-csm-tasks` | every 2h at :15 (v85.5) | Evaluate `templates.trigger_config` → `tasks`. Includes auto-dismiss for orphan tasks (v75.19). v85.1: 3c also dismisses any non-canceling-aware open task for a canceling student ("save-the-sale flow owns this student"). |
| `check-na-tasks` | every 2h at :20 (v85.5) | Not-Activated escalation (Day 3/5/7/10) |
| `day28-dm` | NO cron trigger (removed pre-v85; route retained) | Day-28 Discord DM route still exists for manual/preview fire, but nothing schedules it — the platform currently sends zero automated student DMs. |

v85.5 chain each 2h cycle: sync :00 (fresh cancel flags + completions,
worst case done ~:05) → engagement :10 (alerts) → csm-tasks :15 →
na-tasks :20. Offsets are load-bearing — csm-tasks needs the sync's
cancel flags and engagement's alerts from the SAME cycle.

Schedules live in `vercel.json`. All six routes use the shared `verifyCronAuth` helper from `src/lib/cron-auth.ts` (v75.37) which trims whitespace from CRON_SECRET (defense against env-var-drift silent 401s) and writes audit rows to the `cron_runs` table on every invocation. Use `cron_runs` to answer "did Vercel fire this cron in the last N hours?" — separable from "did the work succeed?".

**Manual triggers** (Karlo/team):
- "↻ Refresh everything" button (dashboard + `/admin/tasks`) → `/api/admin/refresh-everything` runs sync-whop, rebuild_daily_snapshots RPC, then 3 CSM crons in parallel (v75.22)
- One-time first_paid_at backfill: `/api/admin/backfill-first-paid-at` (v75.34) — accepts CRON_SECRET fallback auth for terminal use.

## Key Libraries (`src/lib/`)

| File | Owns |
|------|------|
| `supabase-browser.ts` / `supabase-server.ts` | Client construction |
| `admin-auth.ts` | Team auth gate for API routes. v86: also `STATS_ALLOWED_USER_IDS` / `isStatsOwner()` / `requireStatsOwner()` — the revenue-visibility allowlist, keyed on the **immutable** `auth.users` id, never on `team_members.role` (role is mutable: any founder can grant `founder` via `PATCH /api/admin/team-members/[id]`). One definition, consumed by both the page gate and the API gate. |
| `whop.ts` / `whop-members.ts` / `whop-sync-runner.ts` | Whop HTTP + sync. v75.53: the sync self-heals NULL `first_paid_at` via a bounded cross-product lookup (shared with the backfill). **v75.59 LOAD-BEARING: every upsert row carries the IDENTICAL full column set, preserving by VALUE — never reintroduce a conditional row key.** postgrest-js unions batch keys and PostgREST NULLs omitted columns on conflict-update (the 2026-06-11 wipe: 638 `first_paid_at` + 67 `whop_plan_id` + ~48 `cancel_scheduled_at` erased); a tripwire aborts the sync on any non-uniform key set. v75.60/61: `canceled_at` backfill tries past cycle-end, then past `expires_at` (refund revocations), then stamps the observation moment — a churned student can never stay invisible to the churn trend. |
| `pkce.ts` | OAuth PKCE helpers |
| `csm-triggers.ts` | Trigger metric registry + evaluator. v76: `is_canceling` condition (cancel_scheduled_at + still active) available in the /admin/templates TriggerBuilder — powers the save-the-sale "Canceling" task template. v85.1: CANCELING SUPPRESSION — for canceling students every built-in trigger returns null (`snapshotIsCanceling` wrap on the registry) and `evaluateCustomTrigger` only matches configs referencing `is_canceling`; check-csm-tasks 3c + check-na-tasks reinforce it, so canceling students hold exactly one task: the save-the-sale one. |
| `csm-events.ts` | CSM event hooks (called from mark-* routes). v85.4: W2.2 + X.1 skip canceling students at creation; W2.6 (discount review) deliberately unguarded AND exempt from the 3c canceling sweep — a canceling student applying for the discount is a save signal. |
| `templates.ts` | DM template renderer (variable substitution) |
| `dm-toggles.ts` | Day-28 DM enable/disable |
| `streak.ts` | Streak math |
| `quiz.ts` | Quiz scoring (legacy single quiz) |
| `region-quizzes.ts` | Region-quiz scoring + format dispatch (v54/v65/v69/v70) |
| `progress.ts` | Shared progress / completion derivations + `isPlaybookUnlocked` (gate helper, v75.16) |
| `whop-stats-catalog.ts` (v86) | The live-probed spec for all 64 Whop Stats metrics (`unit`, `agg`, `intervals`, `degradesToDay`, `product`, `maxWindowDays`, `historyStart`, `sparse`, `nullable`, `hasTotals`, `usable`, `note`) + `aggregate()` — **the ONLY place a Whop series collapses to a number**, and it throws on an unknown key. Also `formatMetric()` (percent values are PRE-SCALED; there is no scaling factor in the file), `WHOP_PICKABLE_METRICS` (52), `WHOP_WITHHELD_METRICS` (12 — `churned_revenue` is unreproducible, `partner_*` 403, `trial_conversion_rate`/`ad_spend` always empty). |
| `whop-stats.ts` (v86) | Whop Stats client. **Only ever requests `interval=day`** — every coarser interval in that API has a verified bucket-semantics bug that fails into a plausible number (partial bucket labelled as a whole period; MRR/ARR bucket = FIRST day of period; `paid_active_members` = LAST day; 3 metrics silently downgrade `hour`→day). Week/month rollup happens here in `rollupPoints()`. Also `resolveRange()` (UTC-only, named presets), `coerceGranularity()`, `pooled()` (concurrency 8). Status is checked before parsing and `JSON.parse` is guarded — `whopFetchWithRetry` returns a failed Response rather than throwing, and Whop's envelope is intermittently non-JSON HTML. |
| `admin/metrics-definitions.ts` | Canonical predicates for admin metrics: `isActiveMember` (active + past_due), `isPayingMember` (active member on a `PAYING_WHOP_PLAN_IDS` plan), `isInLaunchCohort` (first_paid_at >= cutoff, NO joined_at fallback post-v75.28), `isMonth2Converted` (cohort student who reached day 30 and didn't cancel before then, v75.38/v75.42), `isInMonth2Cohort` (denominator companion), `isCanceling` (cancel_scheduled_at set + still active, v75.47). Scope-toggle helpers deleted in v75.51. |
| `supabase-pagination.ts` (v75.27) | `fetchAllRowsPaginated(thunk)` — calls `.range(0,999)`, `.range(1000,1999)`, etc. until a page returns less than 1000 rows. Bypasses PostgREST's silent server-side max-rows cap. Returns empty data on error (not partial) so silent truncation can't sneak through. EVERY bulk fetch on admin surfaces should use this. |
| `cron-auth.ts` (v75.37) | `verifyCronAuth(request)` + `logCronStart`/`logCronFinish` — shared auth check (whitespace-trimmed against drift) + audit-log writes to `cron_runs`. All 6 cron handlers use this; replaces the per-route inline `Bearer ${process.env.CRON_SECRET}` check. |
| `csm-task-evaluation.ts` (v75.21) | `reEvaluateStudentOpenTasks(supabase, studentId)` — real-time auto-dismiss helper called from toggle-lesson / mark-action-shipped / skip-lesson API routes. Re-evaluates each open task's trigger against the student's CURRENT state and dismisses any that no longer apply. Same evaluation logic as check-csm-tasks section 3c but scoped to one student. |
| `outreach-insights.ts` (v85.3) | `computeOutreachInsights(supabase, {sinceIso})` — single source of truth for outreach effectiveness. `familyOf(template)` maps scenario prefix / is_canceling trigger / bucket → family; each family graded on what its message asks (see /admin/tasks/insights row above). Evidence: lesson+note events (activity families), student_milestones.first_sprint_login_at (stalled), current students state (canceling saves). Also: replied/no_reply/unmarked, median time-to-send, students_reached (unique). Excludes admin-only + untemplated tasks. Per-metric range filtering. Used by /api/admin/tasks/insights + /api/admin/templates/stats (strip shows "% success"). |
| `achievements.ts` | Achievement catalog + unlock evaluation (v53) |
| `discord.ts` | Discord HTTP helpers |
| `day28-embed.ts` | Day-28 DM embed builder |
| `titles.ts` | Student title progression |
| `constants.ts` | Lesson groups, discount window, `DISCOUNT_GATE_LESSON_ID`, `PLAYBOOK_UNLOCK_LESSON_ID` (l078), launch date, `PAYING_WHOP_PLAN_IDS` allowlist (v79), `csmSprintWindowCutoffIso()` (v75.15 — `now - 30d` for CSM cron filters), etc. |
| `motion.ts` | GSAP / Framer easing constants |
| `useMediaQuery.ts` | SSR-safe phone-detection hook |
| `useFocusTrap.ts` | Modal a11y |
| `useJourneyPaceCounts.ts` | Admin Journey pace tile data |
| `map/` | Map geometry (path math, region bounds) |
| `sop-templates.ts` | SOP scaffolding |

## State Management

| Context | Scope | What it provides |
|---------|-------|-----------------|
| `AuthContext` | Global | `user`, `session`, `student`, `teamMember`, `isStudent`, `isTeam`, `signOut()`, `setStudent()` |
| `StudentContext` | `/dashboard`, `/dashboard/playbook` | Lessons, completions, streaks, discount state (NULL `first_paid_at` blocks claim post-v75.26), sprint milestones, playbook welcome, first-client landed, action-shipped toggles, etc. |
| ~~`AdminScopeContext`~~ | — | Removed in v75.51. Cohort is the only admin view; no toggle. |

## Integrations

| Integration | Used for | Env vars |
|-------------|----------|----------|
| Supabase | DB + auth + RLS | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Whop | OAuth, promo codes, watch sync, membership webhooks | `WHOP_CLIENT_ID`, `WHOP_CLIENT_SECRET`, `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_COMPANY_ID`, `WHOP_PRODUCT_ID` |
| Discord | Day-28 DM, churn DMs | `DISCORD_BOT_TOKEN` |
| Vercel | Hosting + cron + analytics | `vercel.json` |

## Other docs in this repo

- [CHANGELOG_v75.md](CHANGELOG_v75.md) — invariants established by the
  v75 June 2026 admin push. **Read this before touching admin metrics,
  sync logic, CSM tasks, or anything related to cohort filtering.**
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
