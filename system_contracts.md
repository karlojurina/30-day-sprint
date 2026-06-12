# System Contracts — Table Dependency Map

Every table has a small footprint AND a set of consumers (other tables,
API routes, cron jobs, contexts, UI) that depend on it. When you change
a table's columns or constraints, this doc tells you what else moves.

For *what each table is for* see [CONTEXT.md](CONTEXT.md).
For *the principle this enforces* see CLAUDE.md → "Bounded Contexts".

## How to read this

For each table:
- **Depends on** — other tables this one references (foreign keys, or
  semantic dependency)
- **Depended on by** — what reads from or writes to this table
- **Stable contract** — fields outside parties rely on. Changing these
  fields is a contract break — update consumers in the same PR.

When adding a new table, append it here. When deleting a field, scan
"Stable contract" first.

## Identity layer

### `team_members`
- **Depends on:** `auth.users` (Supabase auth)
- **Depended on by:** `src/lib/admin-auth.ts` (role gate), all
  `/api/admin/*` routes
- **Stable contract:** `id`, `email`, `role` (founder/admin/csm)

### `students`
- **Depends on:** `auth.users` (Supabase auth)
- **Depended on by:** essentially everything student-related —
  `AuthContext`, `StudentContext`, all student API routes, all CSM
  cron jobs, admin UI
- **Stable contract:** `id`, `whop_user_id`, `supabase_user_id`,
  `email`, `name`, `joined_at`, `last_active_at`,
  `membership_status`, `discord_username`, `discord_user_id`,
  `current_title`, `csm_exempt`, `ad_submissions_verified`,
  `high_churn_risk` (v51), `canceled_at` (v77 — stamped on transition
  into canceled/expired; powers snapshot churn counts. Mixed
  semantics: webhook + sync transitions stamp `now()` real-time;
  historical backfill via `renewal_period_end` for members already
  canceled when first synced — approximate to actual decision date
  by up to 30 days. Future-dated values are always rejected.),
  `whop_plan_id` (v79 — drives paying / free classification via
  `PAYING_WHOP_PLAN_IDS` allowlist. Free-plan members keep full
  student-side access but are excluded from CSM tasks, dashboard
  metrics, and operational surfaces.),
  `first_paid_at` (v80 — EARLIEST membership.created_at across all of
  this user's Whop memberships. NEVER moves on renewal. THE foundation
  field for cohort filtering and discount eligibility. v75.26 stamps it
  on every INSERT path (OAuth callback, membership.activated webhook,
  payment.succeeded webhook). v75.34 endpoint backfilled the column
  for ~400 legacy students whose first_paid_at was NULL. v75.53 — the
  sync runner (`runWhopCommunitySync`) self-heals NULL first_paid_at for
  active paying students each run via a bounded cross-product
  `fetchEarliestMembershipDateForUser` lookup, so members on products
  outside `WHOP_PRODUCT_ID` (which the per-product sync can't see) no
  longer stay NULL. Post-v75.28
  NULL is treated as out-of-cohort everywhere — no joined_at fallback.
  Distinct from `joined_at` which is the CURRENT subscription cycle
  start and moves on each renewal.),
  `cancel_scheduled_at` (v83 — set when Whop's
  `cancel_at_period_end=true` AND membership is still active/past_due
  i.e. "Canceling" state. Distinct from `canceled_at` (access ended):
  this fires the moment the student clicks cancel, well before access
  actually ends. Used by journey kanban + dashboard early-warning
  surfaces + the v75.47 isMonth2Converted helper. Stamped/cleared by
  sync runner from `WhopMembershipRow.cancel_at_period_end`.)
- **Note:** As of v46/v47, students is identity + admin-flag only.
  Per-function state (streaks, milestones, Whop sync, celebrations,
  DM log) lives in sibling tables below — read CLAUDE.md
  "Table-level bounded contexts" before adding any column here.

### `student_milestones`
- **Depends on:** `students`
- **Depended on by:** `StudentContext` (`bountyAccessClaimedAt`,
  `playbookWelcomeSeenAt`, `onboardingCompletedAt`), milestone API
  routes, `src/lib/csm-triggers.ts` (`has_logged_into_app` reads
  `first_sprint_login_at`), `/api/auth/whop/callback` (stamps
  `first_sprint_login_at` on first login),
  `/api/cron/check-csm-tasks` (joins for the snapshot),
  `/api/webhooks/adbounty` (sole writer of `bounty_access_claimed_at`),
  `/dashboard` intro-video gate + WYH panel (v51 — read/write
  `intro_video_threshold_met`, `why_youre_here_panel_dismissed`,
  `first_dashboard_login_at`)
- **Stable contract:** `student_id`, `onboarding_completed_at`,
  `first_sprint_login_at`, `first_dashboard_login_at`,
  `intro_video_threshold_met`, `why_youre_here_panel_dismissed`,
  `bounty_access_claimed_at`, `playbook_welcome_seen_at`
- **Dormant column (do not extend):** `first_client_landed_at` — the
  API route, celebration component, and Map 2 milestone node were
  all removed in v72.4. Column persists for back-compat; safe to
  drop in a future migration.
- **Note on `intro_video_threshold_met`:** column name kept for
  back-compat; semantic is now "watched end to end" (v72.5/72.6
  dropped the original ~65% threshold).
- **Note on `bounty_access_claimed_at`:** stamping this does NOT
  unlock the Playbook (Map 2). The Playbook gate is `l078` lesson
  completion (see `PLAYBOOK_UNLOCK_LESSON_ID` in
  `src/lib/constants.ts`). Bounty Access is a separate parallel
  milestone (drives the "Bounty Apprentice" chip + l057 claim CTA).

### `student_streaks`
- **Depends on:** `students`
- **Depended on by:** `StudentContext` (`streak`), `src/lib/streak.ts`
  + `src/app/api/student/_lib/update-streak.ts` (write),
  `src/lib/day28-embed.ts` (read), admin student detail +
  kanban drawer
- **Stable contract:** `student_id`, `current_streak`,
  `longest_streak`, `last_streak_date`

### `student_whop_sync`
- **Depends on:** `students`
- **Depended on by:** `/api/auth/whop/callback` (token write),
  `src/app/api/student/_lib/watch-sync.ts` (all sync diagnostics),
  `StudentContext` (`syncDiagnostics`), admin student detail page
- **Stable contract:** `student_id`, `access_token`, `refresh_token`,
  `last_sync_at`, `last_sync_error`, `last_sync_error_at`,
  `last_sync_unmatched`, `last_sync_fetched`, `last_sync_matched`
- **Note:** Team-read RLS only — tokens are sensitive, students don't
  need to read this themselves.

### `student_celebrations`
- **Depends on:** `students`
- **Depended on by:** `/api/student/celebration-seen` (write),
  `StudentContext` (`celebrations`), dashboard-mockup page (region
  + streak + month-review one-shot logic)
- **Stable contract:** `student_id`, `last_streak_milestone_shown`,
  `month_review_seen_at`, `celebrated_region_ids`

### `student_dm_log`
- **Depends on:** `students`
- **Depended on by:** `/api/cron/day28-dm` (read + write — the
  "not yet sent" filter joins this table)
- **Stable contract:** `student_id`, `day28_dm_sent_at`
- **Note:** Add a column per DM type as new DM flows ship (don't
  collapse into a generic events table — each DM type is its own
  function with its own retry / dedupe / preview semantics).

## Curriculum (read-mostly)

### `regions`
- **Depends on:** —
- **Depended on by:** `lessons.region_id`, `MapMockup`, `StudentContext`,
  any region-aware UI
- **Stable contract:** `id` (r1–r4), `name`, `order_num`

### `lessons`
- **Depends on:** `regions`
- **Depended on by:** `student_lesson_completions.lesson_id`,
  `MapMockup`, `ScenePathOverlay`, `LessonSheet`, `RegionSidePanel`,
  `StudentContext`, `src/lib/csm-triggers.ts`
  (`lesson_shipped`, `lesson_watched`, `region_completion_pct`),
  discount eligibility (action items)
- **Stable contract:** `id`, `region_id`, `day`, `sort_order`, `type`
  (watch/action/quiz), `requires_action`, `whop_lesson_id`, `title`,
  `is_gate`, `is_optional`

### `quizzes` + `quiz_questions`
- **Depends on:** `regions`
- **Depended on by:** `student_quiz_attempts`, quiz UI
- **Stable contract:** quiz schema is mostly internal — only quiz IDs
  travel outside

### `playbook_nodes` (Map 2)
- **Depends on:** —
- **Depended on by:** `PlaybookHub`, `PlaybookNodeSheet`
- **Stable contract:** `id`, `position`, `is_milestone`, `title`,
  `subtitle`, `doc_content`, `video_url`

### `templates`
- **Depends on:** —
- **Depended on by:** `tasks.template_id`, CSM cron
  (`/api/cron/check-csm-tasks`), NA cron (`/api/cron/check-na-tasks`),
  `/admin/templates` UI, `src/lib/templates.ts` (renderer),
  `src/lib/csm-triggers.ts` (evaluator reads `trigger_config`)
- **Stable contract:** `id`, `scenario_id`, `bucket`, `body`,
  `trigger_config`, `is_active`, `is_custom`, `intent`, `tone`
- **Naming convention** (v57): `{situation}.{sub?}.{day|entry}`
  where `situation` = `welcome` / `stalled` / `nolessons` /
  `noship` / `pace` / `month2`, and `sub` is a cohort (`discord` /
  `whop`) or region (`r1` / `r2`) where relevant. 18 rows after
  v57: `welcome.day1`, `stalled.discord.day{3|5|7|10}`,
  `stalled.whop.day{3|5|7|10}`, `nolessons.day{3|7|14}`,
  `noship.r1.day7`, `noship.r2.day14`, `pace.day{7|14|21}`,
  `month2.entry`. Legacy W-series + X.1 deleted in v57.

### `admin_config`
- **Depends on:** —
- **Depended on by:** `src/lib/templates.ts` (variable substitution),
  `/admin/settings`, day-28 DM
- **Stable contract:** keys `program_login_link`, `discord_invite_link`
  (v51 dropped `astrid_booking_link` + `karlo_walkthrough_video_link`
  when D1.A/D1.B were merged into a single D1)

## Student state

### `student_lesson_completions`
- **Depends on:** `students`, `lessons`
- **Depended on by:** `StudentContext` (`completedLessonIds`,
  `actionShippedLessonIds`), `src/lib/csm-triggers.ts`
  (`region_completion_pct`, `lesson_shipped`, `lesson_watched`,
  `progress_ratio`), `src/lib/streak.ts`, discount eligibility,
  CSM cron snapshot builder
- **Stable contract:** `student_id`, `lesson_id`, `completed_at`,
  `action_completed_at`, `discord_message_link`, `skipped_at`

### `daily_notes`
- **Depends on:** `students`
- **Depended on by:** journal page, `StudentContext` today's-note
- **Stable contract:** `student_id`, `note_date`, `body`

### `lesson_notes`
- **Depends on:** `students`, `lessons`
- **Depended on by:** `LessonSheet` (per-lesson note), journal
- **Stable contract:** `student_id`, `lesson_id`, `body`

### `student_quiz_attempts`
- **Depends on:** `students`, `quizzes`
- **Depended on by:** quiz UI, region unlock logic
- **Stable contract:** `student_id`, `quiz_id`, `passed`, `score`

### `discount_requests`
- **Depends on:** `students`
- **Depended on by:** `StudentContext`, `/admin/discounts`, Whop
  promo flow, `src/lib/csm-triggers.ts` (membership/discount
  status checks where applicable)
- **Stable contract:** `student_id`, `status`
  (pending/approved/rejected/applied), `promo_code`, `created_at`

### `discount_feedback_questions` + `discount_feedback_responses`
- **Depends on:** `discount_requests`
- **Depended on by:** discount review UI, analytics
- **Stable contract:** question id, response shape (scale / choice / text)

### `disengagement_alerts`
- **Depends on:** `students`
- **Depended on by:** `/admin/alerts`, CSM cron (alert → task mapping
  via `pickExistingAlertScenario` in
  `/api/cron/check-csm-tasks/route.ts`)
- **Stable contract:** `student_id`, `alert_type`, `created_at`,
  `dismissed_at`

### `tasks` (CSM task queue)
- **Depends on:** `students`, `templates`
- **Depended on by:** `/admin/tasks`, `/admin/kanban`,
  `src/lib/csm-events.ts` (`recentTaskScenarios` dedupe),
  optional ops digest
- **Stable contract:** `student_id`, `scenario_id`, `template_id`,
  `status` (open/completed/dismissed), `behavior_summary`,
  `created_at`, `completed_at`, `dismissed_at`, `dismissed_by`,
  `notes`
- **CSM cron filters (v75.15+):** `check-csm-tasks`,
  `check-engagement`, `check-na-tasks` all gate on
  `joined_at >= csmSprintWindowCutoffIso()` (= `now() - 30d`) AND
  `whop_plan_id IN PAYING_WHOP_PLAN_IDS`. So no task fires for a
  student past day 30 of their sprint or on a free plan. Day-28 DM
  has its own tight 1-day window.
- **Note:** Not to be confused with the legacy curriculum `tasks`
  table (`student_task_completions`'s parent, predates `lessons`).
  The CSM `tasks` table is a *queue*.

### `daily_progress_snapshots`
- **Depends on:** `students`, `lessons`
- **Depended on by:** `/admin/insights`, `/admin` dashboard sparklines,
  pace metric math, retention analysis
- **Stable contract:** `snapshot_date` (primary key, daily grain),
  all-paying-members counts (`active_count`, `joined_count`,
  `churned_count`, `avg_progress`) AND cohort-only counts
  (`active_count_cohort`, `joined_count_cohort`,
  `churned_count_cohort`, `avg_progress_cohort`, added v77). The
  scope toggle in admin picks which column family to render.
- **Filter rules** applied by `snapshot-progress` cron + the
  `rebuild_daily_snapshots()` RPC:
  - "active" = `membership_status IN ('active', 'past_due')`
  - paying = `whop_plan_id IN PAYING_WHOP_PLAN_IDS` (v79; the
    plan-IDs are duplicated in the RPC since SQL can't read TS
    constants — when you change one, change the other)
  - cohort = `joined_at >= ADMIN_STUDENT_JOIN_CUTOFF`
  - churned_count = `canceled_at::date = day` (NOT `updated_at` —
    that fires on every sync)

### `canceling_snapshots` (v84)
- **Depends on:** `students` (`cancel_scheduled_at`, status, plan,
  `first_paid_at`)
- **Depended on by:** `/admin` dashboard Canceling tile trend line
- **Stable contract:** `snapshot_date` (primary key, daily grain),
  `canceling_count_cohort` (launch-cohort paying students in Whop's
  "Canceling" state at snapshot time)
- **Note:** Written ONLY by the `snapshot-progress` cron. DELIBERATELY
  separate from `daily_progress_snapshots`: the `rebuild_daily_snapshots()`
  RPC deletes+reinserts that table, and point-in-time canceling state
  cannot be recomputed for past dates — keeping it here makes the
  history rebuild-proof. History starts at the v76 ship date; the
  dashboard renders missing dates as 0.

### `sync_runs` (v77)
- **Depends on:** —
- **Depended on by:** team-read RLS only; queried ad-hoc to confirm
  cron health
- **Stable contract:** `id`, `started_at`, `finished_at`, `source`
  (`cron` / `admin-button`), `status` (`success` / `failed` /
  `running`), counts (`fetched`, `inserted`, `updated`, `skipped`,
  `errors`), `error_message`, `duration_ms`
- **Note:** Written by `runWhopCommunitySync()` in
  `src/lib/whop-sync-runner.ts` — every sync attempt produces one
  row regardless of outcome. SCOPE: only sync-whop. For the broader
  "did Vercel fire any of the 6 crons?" question, see `cron_runs`.

### `cron_runs` (v82)
- **Depends on:** —
- **Depended on by:** team-read RLS only; queried ad-hoc to confirm
  scheduler health
- **Stable contract:** `id`, `route_name` (`sync-whop` /
  `snapshot-progress` / `check-engagement` / `check-csm-tasks` /
  `check-na-tasks` / `day28-dm`), `started_at`, `finished_at`,
  `auth_status` (`ok` / `no_secret_configured` / `missing_header` /
  `mismatch`), `status` (`running` / `success` / `failed` /
  `auth_failed`), `error_message`, `rows_affected`
- **Note:** Written by every cron handler via
  `src/lib/cron-auth.ts` (`logCronStart` on entry,
  `logCronFinish` on every exit path including throws). The
  separation of `auth_status` from `status` lets you distinguish
  "Vercel scheduled this cron but the secret was wrong" from
  "Vercel didn't schedule it at all" from "scheduled + auth ok but
  the work errored." Best-effort writes — never throw, so audit
  failures don't break business logic.

### `student_rewards` + `hidden_rewards`
- **Depends on:** `students`
- **Depended on by:** reward reveal UI

### `month_reviews`
- **Depends on:** `students`
- **Depended on by:** month review modal

## Legacy / archive (do not extend)

### `lessons_archive`
- Frozen pre-migration copy. Read-only. Don't write here.

### `student_task_completions`
- Predates `lessons`. Kept for historical reference. New code uses
  `student_lesson_completions`.

### `checkpoints`
- Older waypoint model. Superseded by `regions`/`lessons`. Kept for
  archived dashboards.

## How to use this when making a change

1. Find the table you're changing.
2. Look at "Depended on by" — every entry there is a consumer to check.
3. If you're adding a field, no contract break — but update the table's
   entry here.
4. If you're removing or renaming a field listed under "Stable contract",
   that's a breaking change — update every consumer in the same PR.
5. If you're adding a new state field to `students`, stop. Read CLAUDE.md
   "table-level bounded contexts" first — it likely belongs in its own
   table.
