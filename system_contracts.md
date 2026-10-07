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
  any region-aware UI, the `student_current_region` view (since v92 it
  joins `regions` and picks a student's furthest region by `order_num`),
  `src/lib/world/catalog.ts` (sorts areas by `order_num`)
- **Stable contract:** `id` (r1–r4), `name`, `order_num`
- **Note:** this table has no `landmark_label` or `rail_at` column.
  Only `regions_next` has them.

### `lessons`
- **Depends on:** `regions`
- **Depended on by:** `student_lesson_completions.lesson_id`,
  `MapMockup`, `ScenePathOverlay`, `LessonSheet`, `RegionSidePanel`,
  `StudentContext`, `src/lib/csm-triggers.ts`
  (`lesson_shipped`, `lesson_watched`, `region_completion_pct`),
  discount eligibility (action items). Added by v92 to v97: the SQL
  function `record_lesson_heartbeat` (the id must exist here as a
  `watch` lesson with a `bunny_video_id`; it reads `duration_seconds`),
  the views `student_progress_counts` and `student_current_region` and
  the function `rebuild_daily_snapshots` (they read `requires_action`
  and filter on `counts_toward_progress`, the second view from v98),
  `POST /api/student/toggle-lesson` (reads `type` to refuse a `watch`
  lesson), and, while the catalog switch names this table,
  `GET /api/student/data`, `POST /api/student/video-token` and
  `POST /api/student/lesson-watched`
- **Stable contract:** `id`, `region_id`, `day`, `sort_order`, `type`
  (`watch` / `action` / `setup`, the CHECK constraint from v3),
  `requires_action`, `whop_lesson_id`, `title`, `is_gate`,
  `is_optional`, and from v92: `counts_toward_progress` (boolean,
  default true), `feature_key` (text, unique where set),
  `bunny_video_id` (text, unique where set), `duration_seconds` (int,
  null or above 0), `video_ready_at`, `updated_at`
- **`duration_seconds` decides completion (v97).** A `watch` lesson
  with a `bunny_video_id` and no `duration_seconds` cannot be completed
  by watching: `record_lesson_heartbeat` and `judgeWatch`
  (`src/lib/world/watch-rules.ts`) both measure against the catalog's
  duration and nothing else.
- **`counts_toward_progress` and `feature_key` (v92).** v92 set
  `counts_toward_progress` false and `feature_key` `bounty_access` on
  `l057`, and `feature_key` `playbook_unlock` on `l078`. The SQL views
  and the snapshot function read `counts_toward_progress`; the world's
  catalog and map model read both columns. The dashboard code still
  uses the lesson ids in `src/lib/constants.ts`
  (`SPRINT_EXCLUDED_LESSON_IDS`, `PLAYBOOK_UNLOCK_LESSON_ID`), so a
  change to one must be made in the other.

### `regions_next` (v94)
- **Owner:** the course rebuild (branch `world-engine`). The staging
  copy of `regions` for the eight-area course.
- **Depends on:** nothing
- **Written by:** migrations only. v94 creates and seeds it; v99 sets
  `landmark_label`, `rail_at` and `terrain`. Nothing in `src/` writes
  it.
- **Depended on by:** `lessons_next.region_id`. While
  `CATALOG_TABLE_SUFFIX` is `_next`: `GET /api/student/data` returns
  these rows as `regions`, and through it `StudentContext` (so
  `/dashboard` as well as `/world`), `src/lib/world/catalog.ts` and the
  world map.
- **Stable contract:** `id` (`a1` to `a8`), `order_num` (unique; it is
  what orders the areas, the id text never is), `name`. Also present:
  `subtitle`, `tagline`, `terrain`, `landmark_label`, `rail_at`,
  `quiz_format`, `is_discount_gate`, `created_at`.
- **Note:** `landmark_label` and `rail_at` hold the first prototype
  map's values (v99: Lighthouse to Obelisk). `catalog.ts` still turns
  them into `landmarkLabel`, `landmarkMesh` and `railAt`, and the only
  reader of those is the unmounted `WorldCanvas.tsx`. The v6 map takes
  its landmark words and its stops from `src/lib/world-v6/layout.ts`.
- **Note:** RLS on, with one select policy for any signed-in user.

### `lessons_next` (v94)
- **Owner:** the course rebuild (branch `world-engine`). The staging
  copy of `lessons`.
- **Depends on:** `regions_next` (foreign key on `region_id`, cascade
  on delete)
- **Written by:** migrations only (v94). Nothing in `src/` writes it.
- **Depended on by:** while `CATALOG_TABLE_SUFFIX` is `_next`:
  `GET /api/student/data` (returns these rows as `lessons`),
  `POST /api/student/video-token` and `POST /api/student/lesson-watched`
  (both look the lesson up here), and through the data route
  `StudentContext`, `src/lib/world/catalog.ts`,
  `src/lib/world/map-model.ts` and the world map.
- **Stable contract:** `id`, `region_id`, `type` (`watch` / `setup`
  only; `action` is not allowed here), `title`, `description`,
  `sort_order` (unique, 1 to N across the whole course),
  `requires_action`, `action_brief` (required when `requires_action`
  is true), `is_optional`, `is_gate` (at most one row may be true),
  `lesson_group_id`, `discord_channel`, `counts_toward_progress`,
  `feature_key` (unique where set), `bunny_video_id` (unique where
  set), `duration_seconds` (null or above 0), `video_ready_at`,
  `created_at`, `updated_at`. It has no `day`, `duration_label`,
  `whop_lesson_id` or `is_boss`.
- **Note:** nothing can complete a lesson that exists only here.
  `student_lesson_completions.lesson_id` references `lessons(id)`, and
  `record_lesson_heartbeat` looks the lesson up in `lessons`.
- **Note:** RLS on, with one select policy for any signed-in user, so
  every `bunny_video_id` stored here is readable by any signed-in
  student.

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
- **A key with no reader (v95):** `discount_window_days`, seeded `14`.
  No code reads it; the discount routes use `DISCOUNT_WINDOW_DAYS` in
  `src/lib/constants.ts`. `/admin/settings` lists every row of this
  table as an editable field and saves through `PUT /api/admin/config`,
  so the key can be edited there and the edit changes nothing.

## Student state

### `student_lesson_completions`
- **Depends on:** `students`, `lessons`
- **Depended on by:** `StudentContext` (`completedLessonIds`,
  `actionShippedLessonIds`), `src/lib/csm-triggers.ts`
  (`region_completion_pct`, `lesson_shipped`, `lesson_watched`,
  `progress_ratio`), `src/lib/streak.ts`, discount eligibility,
  CSM cron snapshot builder. Added by v92 and v93:
  `POST /api/student/lesson-watched` (stamps `completed_at` through
  `stampWatchCompletion` in `src/lib/complete-lesson.ts`), and the SQL
  function `lesson_is_complete`, through which the views
  `student_progress_counts` and `student_current_region` and the
  function `rebuild_daily_snapshots` read `completed_at`,
  `action_completed_at` and `skipped_at`
- **Stable contract:** `student_id`, `lesson_id`, `completed_at`,
  `action_completed_at`, `discord_message_link`, `skipped_at`
- **Note:** `lesson_id` references `lessons(id)` (v3). A lesson that
  exists only in `lessons_next` cannot have a row here.

### `student_lesson_watch` (v93)
- **Owner:** the lesson video player under `/world` (branch
  `world-engine`). It holds a measurement of watching. The decision
  that a lesson is done stays in `student_lesson_completions`.
- **Depends on:** `students` (foreign key, cascade on delete). There
  is no foreign key on `lesson_id`, on purpose; the writer checks the
  id against `lessons` on every call.
- **Written by:** the SQL function `record_lesson_heartbeat` and
  nothing else. The table has two select policies (a student reads
  their own rows, the team reads all) and no insert, update or delete
  policy, so no browser can write a row even with a valid session.
- **Depended on by:** `GET /api/student/data` (returns the student's
  rows as `watchProgress`), `StudentContext` (`watchProgress`),
  `LessonPlayer` (resumes from `last_position_seconds`),
  `src/lib/world/catalog.ts` (an unfinished lesson with a row counts
  as in progress), `POST /api/student/lesson-watched` (re-reads the
  row and decides completion through `judgeWatch` in
  `src/lib/world/watch-rules.ts`), the `achievement_unlock_stats` view
  (v93: a row here is one of the three things that put a launch-cohort
  student in its denominator)
- **Stable contract:** `student_id` + `lesson_id` (primary key),
  `max_position_seconds` (the furthest point reached; it only moves
  forward), `last_position_seconds` (where the playhead was on the last
  beat), `watched_seconds` (seconds really played, summed from clamped
  deltas), `reported_duration_seconds` (what the player reported; kept
  for display and for clamping the position, and it decides nothing
  since v97), `heartbeat_count`, `first_played_at`,
  `last_heartbeat_at`, `threshold_met_at` (stamped once, when the
  furthest position first reaches 95% of the catalog's
  `duration_seconds`; never cleared)

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
- **Added in v95, unused:** `gate_lesson_id` (text, nullable, no
  foreign key on purpose): the lesson that was the discount gate when
  the request was decided. Nothing in `src/` reads or writes it.

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
  `notes`, `outcome` (v85 — replied/no_reply/NULL, written only by
  `POST /api/admin/tasks/[id]/outcome`, read by
  `GET /api/admin/templates/stats` for per-template reply rates)
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
- **Added in v92:** `total_lessons` (int): the number of `lessons` rows
  with `counts_toward_progress` that `avg_progress` was divided by on
  that date. Null on rows written before v92.
- **Writer (v92, v96):** the function
  `rebuild_daily_snapshots(p_start_date, p_end_date)`. Since v92 it
  counts only lessons with `counts_toward_progress` and decides "done"
  through `lesson_is_complete`. Since v96 only `service_role` may
  execute it, and it raises when `p_start_date` is more than 30 days
  back. Its three callers use the service-role key: the
  `snapshot-progress` cron, `/api/admin/rebuild-snapshots` and
  `/api/admin/refresh-everything`.
- **Filter rules** applied by `snapshot-progress` cron + the
  `rebuild_daily_snapshots()` RPC:
  - "active" = `membership_status IN ('active', 'past_due')`
  - paying = `whop_plan_id IN PAYING_WHOP_PLAN_IDS` (v79; the
    plan-IDs are duplicated in the RPC since SQL can't read TS
    constants — when you change one, change the other)
  - cohort = `first_paid_at >= ADMIN_STUDENT_JOIN_CUTOFF` (moved from `joined_at` in v80; `joined_at` is the CURRENT cycle start, so a returning customer would wrongly re-enter the cohort)
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

### `stats_saved_views` (v86)

**Owner:** the founder-only `/admin/stats` surface. Nothing else reads or
writes it.

**Stable contract:** `id` (uuid), `owner_id` (uuid → `team_members.id`),
`name` (text), `layout` (jsonb), `status` (`active` | `archived`),
`created_at`, `updated_at`, `archived_at`.

`layout` shape, validated on both write and read against
`src/lib/whop-stats-catalog.ts`:
```
{ metrics: [{ key: string, product: string | null }],
  granularity: "day" | "week" | "month",
  range: <one of STATS_RANGES> }
```
An unknown metric key is **rejected**, never silently dropped — quietly
discarding a tile would make a saved view lose a metric with no signal.

**Depended on by:** `GET/PUT/DELETE /api/admin/stats/views` only.

**Produces:** nothing consumed by another system. **Consumes:** nothing.
This is a leaf.

**RLS is deliberately different from every other table here:**
`public.current_user_is_stats_owner()` (immutable `auth.uid()` match),
NOT `public.current_user_is_team()`. Do not "fix" it to match the others.

---

### `etfb_team_links` (v87)

**Owner:** the `/admin/etfb` Brand Owners surface. Nothing else reads or
writes it.

**What it is for:** one row per free team-seat checkout link (a Whop plan
under the Apex product `prod_vCHZUO8dU4ts2`), recording which ETfB BRAND
OWNER it was minted for. That single fact exists nowhere else — Whop knows
the plans, the memberships and the money, but the owner→link relationship
lived only in a free-text `internal_notes` field until this table.

**Stable contract:** `plan_id` (text PK, the Whop plan id),
`owner_whop_user_id` (text, Whop user id), `owner_name`, `owner_email`,
`status` (`active` | `needs_owner` | `archived` | `out_of_scope` | `error`),
`attribution_method` (`minted_by_app` | `whop_username_label` |
`discord_handle_label` | `owner_redeemed_own_link` | `exact_owner_name` |
`manual` | `out_of_scope`), `attribution_confidence` (`certain` | `confirm`
| `manual`), `note`, `minted_by` (uuid → `team_members.id`), `created_at`,
`imported_at`, `confirmed_at`, `confirmed_by`, `archived_at`, `errored_at`,
`updated_at`.

**`owner_whop_user_id` is TEXT and is deliberately NOT a foreign key to
`students`.** Brand owners are not students. `students.whop_user_id` is
UNIQUE, so a person who is both would collapse into one row with one
membership — and every admin surface filters `students` by a join-date
cutoff and a 2-plan paying allowlist that has nothing to do with this
population.

**LOAD-BEARING: `etfb_team_links_one_active_per_owner`**, a partial unique
index on `owner_whop_user_id where status='active'`. One active link per
owner. Without it a retried or double-clicked mint creates a second Whop
plan, the owner's team splits across two links, and a later revocation
silently misses half of them. This has already happened by hand twice
(`liaoant18888`, `michael51ce`).

**An `archived` link can still hold live seats.** Archiving retires the link;
it does not revoke the people already on it. Any derivation over seats must
NOT filter by link status, or those people become invisible.

**Depended on by:** `GET /api/admin/etfb`, `POST /api/admin/etfb/links`,
`POST /api/admin/etfb/links/[planId]/owner`.

**Produces:** owner attribution consumed only by the ETfB surface.
**Consumes:** nothing. Owners, seats and subscription state are read LIVE
from Whop at request time and are deliberately not cached here.

---

### `etfb_seat_decisions` (v87)

**Owner:** the `/admin/etfb` Brand Owners surface.

**What it is for:** a human override on ONE seat — "leave this person alone"
or "hide them until a date". Absence of a row is the normal case; a seat
revoked in Whop simply stops being valid and drops out of the live read, so
"done" needs no row here.

**Stable contract:** `membership_id` (text PK, the Whop membership id),
`plan_id` (text → `etfb_team_links.plan_id`), `decision` (`keep` |
`snoozed` | `revoked`), `reason`, `snooze_until`, `decided_by` (uuid →
`team_members.id`), `decided_at`, `revoked_at`, `revoke_error`,
`created_at`, `updated_at`.

**PER-SEAT, NEVER PER-LINK.** `plan_P9yx1m1HdHfMt` holds 29 valid seats on a
10-seat plan and they do not all belong to that link's owner — one belongs
to a currently-paying owner. A link-level decision would be wrong by
construction.

**`revoked` is declared but never written by v1.** Revocation is done by a
human in Whop. The state exists so the future revoke button needs no
migration.

**Depended on by:** `GET /api/admin/etfb`,
`POST /api/admin/etfb/seats/[membershipId]/decision`.

---

### Whop Stats API (external, read-only) (v86)

**Owner:** Whop. **Interface:** `GET https://api.whop.com/api/v1/stats/{key}`.

**We consume:** `account_id`, `from`, `to`, `interval`, `product`.
**It produces:** `{ data: { points: [{ timestamp, value: number|null }],
currency?, totals? } }` — or `{ error: { type, message } }` — or,
intermittently, a non-JSON HTML 500 page.

**Load-bearing constraints (all verified live 2026-09-03):**
- We send `interval=day` and NOTHING ELSE. Coarser intervals mislabel
  partial buckets as whole periods and disagree on level semantics
  (MRR = first day of bucket, `paid_active_members` = last day).
  Rollup happens in `rollupPoints()`.
- `from`/`to` are INCLUSIVE on both ends.
- `data.totals` exists on only 2 of 64 metrics and is the correct
  whole-window figure for ratios — do not derive those from points.
- Percent values are PRE-SCALED (1.6 means 1.6%).
- No revenue from this API is ever persisted.

---

## SQL functions and views (progress and watching)

Defined by migrations v92 to v98, whose files exist only on branch
`world-engine`. Whether v98 is applied to production is unconfirmed;
`supabase/diagnostics/v6-wiring-preflight.sql` is the read-only query
that settles it.

### `lesson_is_complete` (function, v92)
- **What it is:** the one SQL rule for "is this lesson done", the twin
  of `isLessonComplete()` in `src/lib/progress.ts`. Change both or
  neither.
- **Signature:** `lesson_is_complete(p_requires_action boolean,
  p_completed_at timestamptz, p_action_completed_at timestamptz,
  p_skipped_at timestamptz, p_as_of date default null) returns boolean`
- **Rule:** done when skipped; or watched (`completed_at`) for a
  lesson with no action item; or watched and shipped
  (`action_completed_at`) for a lesson with one. With `p_as_of` set,
  every stamp must also fall on or before that date.
- **Depends on:** nothing. It takes values and reads no table.
- **Depended on by:** the views `student_progress_counts` and
  `student_current_region`, and `rebuild_daily_snapshots` (which passes
  the day as `p_as_of`)

### `record_lesson_heartbeat` (function, v93, tightened in v97)
- **What it is:** the only writer of `student_lesson_watch`.
- **Signature:** `record_lesson_heartbeat(p_lesson_id text,
  p_position_seconds numeric, p_reported_duration numeric default null,
  p_delta_seconds numeric default 0, p_force boolean default false)
  returns jsonb`. Security definer. Execute is granted to
  `authenticated` and revoked from `public` and `anon`.
- **Called by:** the browser, through `supabase.rpc()` in
  `src/lib/world/watch-heartbeat.ts`. Nothing else calls it.
- **Depends on:** `students` (it finds the caller's row from
  `auth.uid()`; no student id is passed in) and `lessons` (the id must
  exist there with `type = 'watch'` and a `bunny_video_id`; it reads
  `duration_seconds`). It looks in `lessons` and never in
  `lessons_next`.
- **What it does with its inputs:** clamps the position into
  `[0, duration]`; clamps the played-seconds delta to the wall-clock
  time since the last beat, 20 seconds at most; refuses a beat less
  than 5 seconds after the last one unless `p_force` is true or the
  beat crosses the threshold. It stamps `threshold_met_at` when the
  furthest position reaches 95% of `lessons.duration_seconds`, and
  uses only that catalog duration for the decision (v97). A lesson
  with no `duration_seconds` never crosses.
- **Returns (stable contract, typed as `HeartbeatResult` in
  `watch-heartbeat.ts`):** `accepted`, `reason` (`rate_limited` on a
  refusal), `max_position_seconds`, `last_position_seconds`,
  `watched_seconds`, `duration_seconds` (the row's
  `reported_duration_seconds`), `threshold_met`, `threshold_crossed`
  (true on exactly one call per lesson, the beat that crossed 95%; the
  player uses that edge to call `POST /api/student/lesson-watched`
  once). A refusal carries `accepted`, `reason`,
  `max_position_seconds`, `watched_seconds`, `threshold_met` and
  `threshold_crossed` only.
- **Raises:** `42501` when the caller has no student row; `22023` when
  the lesson is not a playable watch lesson.

### `student_progress_counts` (view)
- **What it is:** one row per student who has at least one completed
  lesson that counts toward progress: `student_id`, `completed_count`.
- **Depends on:** `student_lesson_completions`, `lessons`
  (`counts_toward_progress`, `requires_action`), `lesson_is_complete`
- **Written by:** nobody; it is a view. Its current definition is
  v92's.
- **Depended on by:** the admin pages `/admin`, `/admin/students`,
  `/admin/journey` and `/admin/insights/progress`,
  `src/lib/useJourneyPaceCounts.ts`, `src/lib/day28-embed.ts`,
  `/api/cron/snapshot-progress`, `/api/admin/backfill-achievements`.
  Nothing under `/world` reads it.
- **Stable contract:** `student_id`, `completed_count`.
  `completed_count` must stay `integer` (the `::int` cast in the view),
  because `create or replace view` cannot change a column's type.
  `security_invoker = on`; select is granted to `authenticated` and
  revoked from `anon`.

### `student_current_region` (view)
- **What it is:** one row per student: `student_id`, `current_region`,
  the furthest region by `regions.order_num` in which the student has
  a completed lesson that counts toward progress.
- **Depends on:** `student_lesson_completions`, `lessons`, `regions`
  (`order_num`), `lesson_is_complete`
- **Written by:** nobody; it is a view. v92 made it order by
  `regions.order_num` (it had sorted the region id as text) and use
  the shared rule. v98 added the `counts_toward_progress` filter.
- **Depended on by:** `/admin/journey`,
  `src/lib/useJourneyPaceCounts.ts`. Nothing under `/world` reads it.
- **Stable contract:** `student_id`, `current_region` (text).
  `security_invoker = on`; select is granted to `authenticated` and
  revoked from `anon`.
- **Unconfirmed:** until v98 is applied, the live view is v92's, which
  has no `counts_toward_progress` filter and so also counts `l057`.

---

## The world's in-memory contracts (branch `world-engine`)

TypeScript shapes passed between modules in the browser. Nothing here
is stored. Each has one writer. The path from the database to the map
is: `GET /api/student/data`, `StudentContext`, `useWorldCatalog()`,
`buildMapModel()`, `sourceData()`, `WorldMap`, `WorldV6`.

### `MapModel` (`src/lib/world/map-model.ts`)
- **Written by:** `buildMapModel()` and nothing else.
- **Built from:** `{ areas, lessonsByArea, completedLessonIds }`: the
  catalog's areas in route order, its lessons per area, and the
  student's completed lesson ids.
- **Read by:** `useMapModel()` (`src/components/world/useMapModel.ts`)
  and `sourceData()` (`src/components/world-v6/source.ts`). `WorldMap`
  gets it through those two.
- **Shape:**
  ```ts
  export const MAP_PLACES = 8;

  export interface MapLesson {
    id: string;
    title: string;
    minutes: number | null;
    action: boolean;
    done: boolean;
    hasVideo: boolean;
  }

  export interface MapFeature {
    id: string;
    title: string;
    key: string | null;
    done: boolean;
  }

  export interface MapArea {
    id: string;
    name: string;
    lessons: MapLesson[];
    features: MapFeature[];
    done: number;
  }

  export type MapModel =
    | {
        ok: true;
        areas: MapArea[];
        place: number;
        placeNext: number;
        doneTotal: number;
        total: number;
      }
    | { ok: false; reason: "empty" | "shape" };
  ```
- **Rules its readers rely on:** a lesson with
  `counts_toward_progress` is one of the area's `lessons`; any other
  is one of its `features` and is in no total. `reason` is `empty`
  when there are no areas or no lessons at all, and `shape` when the
  catalog does not have exactly eight areas. `place` is the index of
  the first area with a counting lesson left, or 8 when none is left.
  `placeNext` is the index of the first undone lesson in that area, or
  -1. `minutes` is null when the catalog has no `duration_seconds`,
  otherwise whole minutes with a floor of 1. `hasVideo` is true only
  for a `watch` lesson with a `bunny_video_id`.

### `WorldSource` (`src/components/world-v6/source.ts`)
- **Written by:** `WorldMap` (`src/components/world/WorldMap.tsx`) and
  nothing else. It joins `sourceData(model, WORLD_LOCK_MODE)` with the
  address from the stage and four callbacks.
- **Read by:** `WorldV6`, and `contentOf()` in
  `src/components/world-v6/content.ts`, which hands the names and
  counts down to the map's parts. With no source, `WorldV6` runs on
  its fixture (the development page).
- **Shape:**
  ```ts
  export interface WorldSource {
    areas: readonly StudyArea[];
    study: Study;
    total: number;
    lock: LockMode;
    minutes(k: number, i: number): number | null;
    isDone(k: number, i: number): boolean;
    openK: number | null;
    paused: boolean;
    onOpenArea(k: number): void;
    onCloseArea(): void;
    onWatch(k: number, i: number): void;
    onFeature(k: number): void;
  }

  export interface SourceData {
    areas: StudyArea[];
    study: Study;
    total: number;
    lessonIds: string[][];
    featureIds: (string | null)[];
    minutes: (number | null)[][];
    done: boolean[][];
  }

  export function sourceData(model: ReadyModel, lock: LockMode): SourceData
  ```
  `ReadyModel` is `Extract<MapModel, { ok: true }>`. `StudyArea`,
  `Study` and `LockMode` (`"open" | "look" | "locked"`) are declared in
  `src/components/world-v6/study.ts`.
- **Rules its reader relies on:** `areas` always has eight entries;
  each one's `id`, `landmark`, `mesh` and `depth` come from
  `STUDY_AREAS` (so from `src/lib/world-v6/layout.ts`) and its name,
  lesson count, titles, action items and feature row from the model.
  `k` is a place index 0 to 7 and `i` a lesson index inside it.
  `openK` is the place the address names, or null. `paused` is true
  while the address names a lesson. Only the first feature row of an
  area is shown.
- **What the callbacks may do:** the map changes no progress and never
  navigates by itself. `WorldMap` turns each callback into one address
  change with `router.push(..., { scroll: false })`: `onOpenArea(k)`
  to the place, `onCloseArea()` to the map, `onWatch(k, i)` and
  `onFeature(k)` to the lesson page.

### The stage context, `useWorldStage()` (`src/components/world/WorldStage.tsx`)
- **Written by:** `WorldStage` and nothing else, from
  `useSelectedLayoutSegments()` and its `base` prop (default
  `/world`). No page sets any of it.
- **Read by:** `WorldMap`, `PlaceRoute`, `LessonScreen`
- **Shape:**
  ```ts
  export interface WorldStageValue {
    base: string;
    openAreaId: string | null;
    lessonId: string | null;
    href(areaId?: string | null, lessonId?: string | null): string;
  }
  ```
- **Rules its readers rely on:** `openAreaId` is the first route
  segment below the layout and `lessonId` the second. `href()` is the
  map, `href(a)` a place, `href(a, l)` a lesson. With no `WorldStage`
  above it the hook returns `{ base: "/world", openAreaId: null,
  lessonId: null, href }` and does not throw.

### `useMapModel()` (`src/components/world/useMapModel.ts`)
- **Written by:** the hook itself, from `useWorldCatalog()` and
  `useStudent().completedLessonIds`.
- **Read by:** `WorldMap`, `PlaceRoute`, `LessonScreen`
- **Shape:**
  ```ts
  export type MapStatus = "loading" | "error" | "empty" | "shape" | "ready";
  export type ReadyMapModel = Extract<MapModel, { ok: true }>;

  export function useMapModel(): { status: MapStatus; model: ReadyMapModel | null }
  export function mapIsSilent(status: MapStatus): boolean
  ```
- **Rules its readers rely on:** `model` is set only when `status` is
  `ready`. `mapIsSilent` is true for `loading`, `error` and `empty`;
  in those three the routes drawn over the map render nothing, and the
  host's card is the whole message. In `shape` a lesson page still
  opens. A failed catalog query and a refused data request both arrive
  as `empty` today: the data route answers 200 with empty rows, and
  `StudentContext` sets no error on a non-OK response.

---

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
