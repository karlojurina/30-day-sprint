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
  `membership_status`, `discord_user_id`, `current_title`,
  `csm_exempt`, `ad_submissions_verified`
- **Note:** As of v46/v47, students is identity + admin-flag only.
  Per-function state (streaks, milestones, Whop sync, celebrations,
  DM log) lives in sibling tables below — read CLAUDE.md
  "Table-level bounded contexts" before adding any column here.

### `student_milestones`
- **Depends on:** `students`
- **Depended on by:** `StudentContext` (`bountyAccessClaimedAt`,
  `firstClientLandedAt`, `playbookWelcomeSeenAt`,
  `onboardingCompletedAt`), milestone API routes,
  `src/lib/csm-triggers.ts` (`has_logged_into_app` reads
  `first_sprint_login_at`), `/api/auth/whop/callback` (stamps
  `first_sprint_login_at` on first login),
  `/api/cron/check-csm-tasks` (joins for the snapshot),
  `/api/webhooks/adbounty` (sole writer of `bounty_access_claimed_at`)
- **Stable contract:** `student_id`, `onboarding_completed_at`,
  `first_sprint_login_at`, `bounty_access_claimed_at`,
  `first_client_landed_at`, `playbook_welcome_seen_at`

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
  `RegionTodoWidget`, `StudentContext`, `src/lib/csm-triggers.ts`
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
  (`/api/cron/check-csm-tasks`), `/admin/templates` UI,
  `src/lib/templates.ts` (renderer), `src/lib/csm-triggers.ts`
  (evaluator reads `trigger_config`)
- **Stable contract:** `id`, `scenario_id`, `bucket`, `body`,
  `trigger_config`, `is_active`, `is_custom`, `intent`, `tone`

### `admin_config`
- **Depends on:** —
- **Depended on by:** `src/lib/templates.ts` (variable substitution),
  `/admin/settings`, day-28 DM
- **Stable contract:** keys `astrid_booking_link`,
  `program_login_link`, `karlo_walkthrough_video_link`

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
  `created_at`, `completed_at`
- **Note:** Not to be confused with the legacy curriculum `tasks`
  table (`student_task_completions`'s parent, predates `lessons`).
  The CSM `tasks` table is a *queue*.

### `daily_progress_snapshots`
- **Depends on:** `students`, `lessons`
- **Depended on by:** `/admin/insights`, pace metric math,
  retention analysis
- **Stable contract:** `student_id`, `snapshot_date`, completion
  counts per region

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
