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
  `/api/admin/*` routes, `src/lib/student-app-gate.ts` (T-078: reads
  `id`, only while `STUDENT_APP_CLOSED=true`, to let a team member's
  Whop account through the Whop login); `/api/auth/me` answers the team
  before it asks the gate
- **Stable contract:** `id`, `email`, `role` (founder/admin/csm)

### `students`
- **Depends on:** `auth.users` (Supabase auth)
- **Depended on by:** essentially everything student-related —
  `AuthContext`, `StudentContext`, all student API routes, all CSM
  cron jobs, admin UI, and `src/lib/student-app-gate.ts` (T-078, only
  while `STUDENT_APP_CLOSED=true`: `whop_user_id` by `supabase_user_id`
  for a student route or the Field Journal, `supabase_user_id` by
  `whop_user_id` for the Whop login)
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
  `first_paid_at` (the student's FIRST REAL WHOP PAYMENT since the
  first-paid fix, 2026-10-20: the earliest payment by that user with
  status paid, `paid_at` set, a total above 0 and not fully refunded
  (substatus `refunded` or `auto_refunded`, or `refunded_amount` at or
  above the total; a partial refund counts) nor lost in a dispute
  (substatus `dispute_lost`, a chargeback the buyer won; a reading taken
  on 2026-10-20 that Lovro has not ruled on), for any product of the
  company; NULL when there is none: a free member, a seat given away, a
  comp. A read that comes back in another shape than the one pinned (no
  buyer on any row of a page, or no total that reads) is a failed read,
  never "no payment", so no writer fills or moves anything from it.
  The rule and both reads are `src/lib/first-payment.ts`. Until
  the fix it was a Whop membership date (v80: the earliest
  membership.created_at; v75.26: the webhook's and the login's
  `joined_at` on insert), which a free membership could hold, so a
  free member who bought later carried the free date. NEVER moves on
  renewal. THE foundation field for cohort filtering and discount
  eligibility.
  Writers since the fix, each filling an EMPTY value only, never moving
  a stored one: the login (`auth/whop/callback`, one read of at most
  2.5 s when the row holds none, written `.is("first_paid_at", null)`;
  the self-heal no longer stamps the membership's `created_at`); the
  2-hour sync's recovery pass (active students on a
  `PAYING_WHOP_PLAN_IDS` plan, 25 a run, same guard; the sync's upsert
  carries no `first_paid_at` at all); `/api/admin/backfill-first-paid-at`
  (every active or past_due row with a NULL, by hand, in id order, a pass
  followed by its `next_after` cursor). The webhook writes
  none: a row it inserts starts NULL. `POST /api/admin/first-paid-repair`
  is the one writer that moves a stored date (dry, snapshot, write; each
  write guarded on the value read; a student with no payment is left as
  is), run once after the fix. A payer on a plan outside the paying list
  who never logs in stays NULL until the backfill or the repair is run.
  Post-v75.28
  NULL is treated as out-of-cohort everywhere — no joined_at fallback.
  On the new course it decides the discount window (T-080,
  `discountWindow` in `src/lib/world/discount.ts`): before 2026-09-30
  22:00 UTC (midnight on 1 October in Croatia; 2026-09-08 22:00 UTC
  until Lovro moved it on 2026-10-19) never; from then until the
  launch, the shared deadline at the end of 23 October 2026 (Croatia);
  from the launch on, 14 days
  from itself. It also decides whether an old-dashboard request still
  counts (`requestCounts`).
  Distinct from `joined_at` which is the CURRENT subscription cycle
  start and moves on each renewal.),
  `cancel_scheduled_at` (v83 — set when Whop's
  `cancel_at_period_end=true` AND membership is still active/past_due
  i.e. "Canceling" state. Distinct from `canceled_at` (access ended):
  this fires the moment the student clicks cancel, well before access
  actually ends. Used by journey kanban + dashboard early-warning
  surfaces + the v75.47 isMonth2Converted helper. Stamped/cleared by
  sync runner from `WhopMembershipRow.cancel_at_period_end`.)
- **`last_active_at`:** written by the login callback (every login) and
  by `markStudentActive` / `updateStudentStreak` in
  `src/app/api/student/_lib/update-streak.ts`: a lesson finished, the
  backfill adding rows, mark-action-shipped leaving both halves done,
  every toggle-lesson tick and untick that goes through, and every quiz
  attempt. The 2-hour Whop sync keeps it. Read by the engagement cron
  (`no_login_5d`), `csm-triggers.ts` (`days_since_last_login`) and the
  admin pages. It is not the streak; T-079 left it as it was.
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
  `bounty_access_claimed_at`, `playbook_welcome_seen_at`, and from v103
  `playbook_unlocked_at`
- **`playbook_unlocked_at` (v103, timestamptz, branch `world-engine`,
  not on production).** Written only by SQL run by hand: v104 sets it
  to the switch's moment for every graduate of the old course (a done
  l078, or done lessons numbering at least `ceil(0.8 x` the counting
  lessons`)`, every done lesson counted as the Playbook page counts
  them, no 30-day wait), inserting a milestone row where none existed;
  the undo of v104 clears only the stamps it made (`archive_v1.stamps`)
  and deletes a row it created when nothing else on it was filled in
  since; the commented statement at the foot of
  `supabase/diagnostics/cutover-postcheck.sql` stamps one named student
  by hand. The app never writes it. As committed, nothing in `src/`
  reads it: `GET /api/student/data` selects `*` from this table, so it
  reaches the browser, and the Playbook gate that honours it is cutover
  WI-8, not merged at the time of writing. Until then the switch would
  lock every graduate out. The undo of v103 drops the column.
- **`first_sprint_login_at` and the switch:** v104 fills it from the
  earliest of `completed_at`, `skipped_at` and `action_completed_at`
  for every student who has a completion and no stamp, so the team's
  "never opened the app" lists do not count those students; recorded in
  `archive_v1.stamps` and taken back by the undo while it still holds
  that value.
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
- **Depended on by:** written only by `tickStudentStreak`
  (`src/app/api/student/_lib/update-streak.ts`, with
  `computeStreakUpdate` from `src/lib/streak.ts`), on counted work
  (T-079): `afterCompletionWrite` (lesson-watched, the Whop webhook);
  the backfill's callers when it added rows (refresh-watch-sync, the
  login callback, which hands a slow sync to `after()`);
  mark-action-shipped (action half newly done); toggle-lesson (a task
  with no action half ticked); the Whop catch-up (`src/lib/whop-catchup.ts`,
  T-089), for a lesson it adds that Whop says was opened that day (UTC),
  with no "last active", and only when the streak does not count that day
  yet (it reads `last_streak_date` first, so its change log leaves out a
  member whose day already counted). A failed read writes nothing. Read by the
  data route (`current_streak` through `currentStreakAsOf`), and so by
  `StudentContext` (`streak`); `src/lib/achievements.ts`;
  `src/lib/day28-embed.ts` and the journal page (longest only); and the
  admin student page and Journey drawer (through `currentStreakAsOf`).
- **Rule:** `current_streak` means nothing without `last_streak_date`;
  show it through `currentStreakAsOf` (`src/lib/streak.ts`).
- **Stable contract:** `student_id`, `current_streak`,
  `longest_streak`, `last_streak_date`

### `student_whop_sync`
- **Depends on:** `students`
- **Depended on by:** `/api/auth/whop/callback` (token write),
  `src/app/api/student/_lib/watch-sync.ts` (all sync diagnostics),
  `StudentContext` (`syncDiagnostics`), admin student detail page,
  `src/lib/whop-catchup.ts` (T-089, 2026-10-20: writes the same
  diagnostics columns with the same values as the backfill for every
  member it reads from Whop, and nothing for a member whose read
  failed; never names the token columns; its snapshot reads the
  diagnostics columns, with the Whop ids in an old error hidden)
  `GET /api/admin/thirty` (admin rebuild, branch `night/admin`:
  `student_id` and `last_sync_at` only, never the tokens, for "Whop
  progress not pulled yet", call C14; `GET /api/admin/today` read the
  same until admin rebuild 2 removed it)
- **Stable contract:** `student_id`, `access_token`, `refresh_token`,
  `last_sync_at`, `last_sync_error`, `last_sync_error_at`,
  `last_sync_unmatched`, `last_sync_fetched`, `last_sync_matched`
- **Note:** Team-read RLS only — tokens are sensitive, students don't
  need to read this themselves.
- **`last_sync_error` holds two kinds of text:** a failure, or the note
  `whopNoneFinishedNote(N)` from `src/lib/constants.ts`, "Whop returned
  N interactions but 0 marked completed" (lessons opened on Whop, none
  finished). Readers tell them apart with `isWhopNoneFinishedNote`: the
  admin student page shows the note plainly and only a failure in red.
  Whop returning nothing writes no error at all (2026-10-16).

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
  `src/lib/world/catalog.ts` (sorts areas by `order_num`). Added by the
  cutover work (branch `world-engine`): `quizzes.region_id` and
  `student_region_quiz.region_id` by key; `/api/cron/check-csm-tasks`
  and `src/lib/csm-task-evaluation.ts` (`id, order_num`, ordered: the
  CSM's areas; an empty table fails the cron); the admin pages
  `/admin/journey` (chips, default area, the drawer),
  `/admin/students/[id]` (the current area) and the trigger editor
  (`id, name, order_num`); `/journal/[studentId]`;
  `GET /api/admin/cutover-status` (the ids)
- **Stable contract:** `id` (r1–r4; `a1`–`a8` after v104), `name`,
  `order_num`
- **Note:** before v103 this table has no `landmark_label` or `rail_at`
  column. v103 adds both, empty, so v104 can copy them from
  `regions_next`.
- **After v104** (2026-10-14 code, not on production): the eight rows
  of `regions_next` (`id, order_num, name, subtitle, tagline, terrain,
  landmark_label, rail_at, quiz_format, is_discount_gate, created_at`).
  The not-nulls on `subtitle`, `tagline`, `terrain`, `days_label`,
  `day_start` and `day_end` and the check on `terrain` are dropped,
  each recorded in `archive_v1` as Postgres stated it, for the undo.
  Three keys point here, all `ON DELETE RESTRICT`: an area with
  lessons, quizzes or quiz results cannot be deleted
  ([The course switch](#the-course-switch-v103-v104)).

### `lessons`
- **Depends on:** `regions`
- **Depended on by:** `student_lesson_completions.lesson_id`,
  `MapMockup`, `ScenePathOverlay`, `LessonSheet`, `RegionSidePanel`,
  `StudentContext`, `src/lib/csm-triggers.ts`
  (`lesson_shipped`, `lesson_watched`, `region_completion_pct`),
  discount eligibility (action items). Added by v92 to v100: the SQL
  function `record_lesson_heartbeat` (the id must exist here as a
  `watch` lesson, and since v100 it must also have a row in
  `lesson_videos`; it reads `duration_seconds`),
  the views `student_progress_counts` and `student_current_region` and
  the function `rebuild_daily_snapshots` (they read `requires_action`
  and filter on `counts_toward_progress`, the second view from v98),
  `POST /api/student/toggle-lesson` (reads `type` to refuse a `watch`
  lesson, and `requires_action`: on the new course's catalog a lesson
  with an action half is refused, and a tick counts as a streak day
  only on a lesson with no action half, T-079),
  `GET /api/cron/check-lesson-videos` (reads `id`, `type` and
  `duration_seconds`, by name), and, while the catalog switch names
  this table, `GET /api/student/data`,
  `POST /api/student/lesson-video`,
  `POST /api/student/lesson-watched`, `save-action-link`,
  `mark-action-shipped` and, on the v2 shape, the discount routes.
  Added by the cutover work, all by name: the view
  `student_last_counted_completion` (v103); the CSM cron and
  `csm-task-evaluation.ts` (`id, region_id, requires_action,
  counts_toward_progress`); `src/lib/achievements.ts` (`region_id`,
  `counts_toward_progress`: the areas it counts); the snapshot cron and
  every admin page that divides by a lesson count (`.eq("counts_toward_progress",
  true)`, never the constant 64); `/admin/students/[id]` (the `is_gate`
  lesson's title); the trigger editor (lessons with `requires_action`);
  `GET /api/admin/cutover-status` (three counts); the Whop webhook and
  `src/app/api/student/_lib/watch-sync.ts` (`whop_lesson_id`, below)
- **Stable contract:** `id`, `region_id`, `day`, `sort_order`, `type`
  (`watch` / `action` / `setup`, the CHECK constraint from v3),
  `requires_action`, `whop_lesson_id`, `title`, `is_gate`,
  `is_optional`, and from v92: `counts_toward_progress` (boolean,
  default true), `feature_key` (text, unique where set),
  `duration_seconds` (int, null or above 0), `updated_at`
- **After v104** (2026-10-14 code, not on production): the 141 rows of
  `lessons_next`, copied column for column (`id, region_id, type,
  title, description, sort_order, requires_action, action_brief,
  is_optional, is_gate, lesson_group_id, discord_channel,
  counts_toward_progress, feature_key, bunny_video_id,
  duration_seconds, video_ready_at, whop_lesson_id, created_at,
  updated_at`). `day` is null on every row: its not-null and its check
  (1 to 30) are dropped and recorded in `archive_v1` for the undo, so
  every `.order("day")` falls through to `.order("sort_order")`, which
  the readers that order by day now add. `type` is `watch` or `setup`.
  The three keys that point here are `ON DELETE RESTRICT`: a lesson
  with a completion, a note or a rating cannot be deleted at all
  ([The course switch](#the-course-switch-v103-v104)).
- **`whop_lesson_id` and the Whop sync** (kept by Lovro's word,
  2026-10-14). The webhook (`POST /api/webhooks/whop`, a lesson
  completed on Whop) looks the lesson up by `whop_lesson_id` with
  `.maybeSingle()` and upserts a completion; no row means the Whop
  lesson is not in the course and the event is ignored with a 200.
  Since 2026-10-16 a completion row that already exists (a skip, a
  saved Discord link, an action done first) is finished too:
  `completed_at` now, `skipped_at` cleared, the link and the action half
  kept, a watched row left alone. On the delivery that finished the
  lesson, and never on a retry, it then runs `afterCompletionWrite`
  (`src/lib/complete-lesson.ts`, lesson-watched's chain: the streak, the
  "came back" check, the badges, the CSM tasks). A failed write answers
  500 so Whop retries.
  `syncWatchProgress` (`watch-sync.ts`, run at login, by
  `refresh-watch-sync` and on tab focus) reads the student's
  `course_lesson_interactions` for `WHOP_COURSE_ID` and matches the
  completed ones the same way; the ones it cannot match go to
  `student_whop_sync.last_sync_unmatched`. Its `syncedCount` is the rows
  it added (new lessons, and rows it finished the same way), and its
  callers move the streak only when that is above 0; a failed lessons
  read is an error, never "nothing matched". Before the switch the column
  has only a non-unique index, so a doubled id would make the
  webhook's `.maybeSingle()` error. v104 adds the unique index
  `lessons_whop_lesson_id_key` (where not null), and every new-course
  row carries its own id (v101 refuses otherwise). After the switch
  `WHOP_COURSE_ID` has to name the new course on Whop, or the backfill
  fetches the old course's lessons and matches nothing.
- **Dormant columns (do not extend):** `bunny_video_id` (text, unique
  where set) and `video_ready_at`, both from v92. They still exist and
  the app has not read them since 2026-10-12, when lesson video moved
  to Tella. `GET /api/student/data` selects every column, so their
  values still travel in the lessons payload with no reader. They are
  kept: the cutover drops no column, now or in its week-later
  deletion (call C19), because a dropped column that one forgotten
  select still names returns an empty course with no error.
- **No video id lives here, on purpose.** Every account that is signed
  in can read every column of this table (its select policy is
  `auth.uid() is not null`), and a Tella id is the video's address. The
  id is in `lesson_videos`.
- **`duration_seconds` decides completion (v97).** A `watch` lesson
  with a video (a row in `lesson_videos`) and no `duration_seconds`
  cannot be completed by watching: `record_lesson_heartbeat` and
  `judgeWatch` (`src/lib/world/watch-rules.ts`) both measure against
  the catalog's duration and nothing else. No code in the app fills
  it. For a lesson whose id is shaped like `a3l07` (a course id) the
  video load sets it, in the same transaction as the lesson's
  `lesson_videos` row, and empties it when the lesson is not in the
  load's list. Only for any other id is it set by hand when the row
  goes in. The lock check reports a lesson that has a video and no length,
  and a length that differs from Tella's by more than 2 seconds. On the
  lesson page, a video that plays to its end on a lesson with no
  length, or with one too long for its 95% point to be reached, gets
  the line "This lesson finished but didn't register. Tell the team so
  we can fix it."
- **`counts_toward_progress` and `feature_key` (v92).** v92 set
  `counts_toward_progress` false and `feature_key` `bounty_access` on
  `l057`, and `feature_key` `playbook_unlock` on `l078`. The SQL views
  and the snapshot function read `counts_toward_progress`; the world's
  catalog and map model read both columns; since the cutover work the
  admin pages, the snapshot cron, the CSM and the achievements read
  `counts_toward_progress` too. The dashboard code still uses the
  lesson ids in `src/lib/constants.ts` (`SPRINT_EXCLUDED_LESSON_IDS`,
  `PLAYBOOK_UNLOCK_LESSON_ID`), so a change to one must be made in the
  other, until the week-later deletion removes those constants. On the
  new course `a7l19` (the pond) is the one row outside the count and no
  row holds `playbook_unlock`.

### `regions_next` (v94)
- **Owner:** the course rebuild (branch `world-engine`). The staging
  copy of `regions` for the eight-area course.
- **Depends on:** nothing
- **Written by:** migrations, each on its own columns, and one undo
  file. v94 creates and seeds it; v99 sets `landmark_label`, `rail_at`
  and `terrain`; v101 sets `name` on the 8 rows and no other column (the
  course's own names: Introduction, Marketing Fundamentals, Video Ads
  I, Video Ads II, Static Ads, AI Ads + Content, Creative Strategy, How
  To Land Clients). `supabase/undo/2026_v101_undo.sql` puts v94's names
  back by running v94's own seed statement again, which sets `name` and
  `order_num`. Nothing in `src/` writes it. v101 has not been run on
  production (2026-10-13): until it is, production holds v94's names
  (Fundamentals, AI Ads & Content and Job Board for a2, a6 and a8).
- **Depended on by:** `lessons_next.region_id`. While
  `CATALOG_TABLE_SUFFIX` is `_next`: `GET /api/student/data` returns
  these rows as `regions`, and through it `StudentContext` (so
  `/dashboard` as well as `/world`), `src/lib/world/catalog.ts` and the
  world map. Whatever the switch says: v104 copies every row into
  `regions` and refuses unless this table is exactly `a1` to `a8` with
  `order_num` 1 to 8. It is kept after the switch and still read by
  v101's guards.
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
- **Written by:** SQL pasted into the Supabase SQL editor, and nothing
  in `src/`. v94 created and seeded it. Two files write it now, each
  on its own columns, and an undo file takes the first back.
  - **Migration v101** (`2026_v101_course_catalog.sql`, generated from
    `supabase/catalog/course_catalog.json` by `npm run build:catalog`)
    rewrites the rows in place over v94's placeholder seed. It owns
    `id`, `region_id`, `type`, `title`, `sort_order`,
    `requires_action`, `action_brief`, `is_optional`, `is_gate`,
    `lesson_group_id`, `discord_channel`, `counts_toward_progress`,
    `feature_key` and, since 2026-10-14, `whop_lesson_id` (it adds the
    column and the unique index `lessons_next_whop_lesson_id_key`, and
    refuses unless all 141 rows carry an id of their own). Since the
    same day it refuses to run at all once `curriculum_reset_at`
    exists: after the switch it would change only this table. It never writes `duration_seconds`, `description`
    (on a row that exists), `bunny_video_id`, `video_ready_at` or
    `created_at`, so a row that exists keeps its own. A row whose id the course does not have is
    deleted. After it the table holds the data file's 141 rows, 140 of
    them counting toward progress, in 8 areas of 8, 11, 25, 17, 26, 22,
    19 and 13.
  - **The text load** (`supabase/diagnostics/load-lesson-text.sql`,
    added 2026-10-14) owns `description` for course-shaped ids, in
    `lessons_next` and `lessons`. As tracked it is a template that
    holds no text; a private filled copy, written by the tool in
    `clients/ecom-university/tools/lesson-text/` from the lesson
    pages on Whop, is pasted into the SQL editor. The list is the
    whole truth: a listed lesson gets its text, every other course
    lesson's `description` is emptied, rows on other ids are never
    written. It refuses a title that differs from the catalog's. The
    text is plain text in a small format (paragraphs, lists, bold,
    https links) that `src/lib/world/lesson-text.ts` reads. The texts
    stay out of the repository because they carry links to course
    assets.
  - **The video load** (`supabase/diagnostics/load-lesson-videos.sql`,
    run as a filled private copy) owns `duration_seconds` on every
    lesson whose id is shaped like `a3l07`: it sets it on a listed
    lesson, which is always a `watch` lesson, and empties it on every
    one that is not listed, whatever its type. It writes no other
    column here. It reads `title`: it refuses a list in which a title
    differs from the title the lesson has here.
  - `supabase/undo/2026_v101_undo.sql` deletes every row and runs v94's
    seed statements again.
  - Neither v101 nor the load has been run on production (2026-10-13).
    Until v101 is, production holds v94's 145 placeholder lessons.
- **Depended on by:** while `CATALOG_TABLE_SUFFIX` is `_next`:
  `GET /api/student/data` (returns these rows as `lessons`),
  `POST /api/student/lesson-video` and `POST /api/student/lesson-watched`
  (both look the lesson up here), and through the data route
  `StudentContext`, `src/lib/world/catalog.ts`,
  `src/lib/world/map-model.ts` and the world map. Whatever the switch
  says, `GET /api/cron/check-lesson-videos` reads `id`, `type` and
  `duration_seconds` here by name. v104 copies every row into
  `lessons` and refuses unless this table holds 100 to 200 rows, every
  id shaped like `a3l07` in an area of `regions_next`, no placeholder
  title, exactly one `is_gate`, and a distinct `whop_lesson_id` on
  every row; it archives and deletes the `lesson_videos` and
  `student_lesson_watch` rows whose id is not here. The table is kept
  after the switch, and the two private loads still write it.
- **Stable contract:** `id`, `region_id`, `type` (`watch` / `setup`
  only; `action` is not allowed here), `title`, `description`,
  `sort_order` (unique, 1 to N across the whole course),
  `requires_action`, `action_brief` (required when `requires_action`
  is true), `is_optional`, `is_gate` (at most one row may be true),
  `lesson_group_id`, `discord_channel`, `counts_toward_progress`,
  `feature_key` (unique where set), `duration_seconds` (null or above
  0), `whop_lesson_id` (since 2026-10-14, unique where set, all 141
  set), `created_at`, `updated_at`. It has no `day`, `duration_label`
  or `is_boss`.
- **Dormant columns (do not extend):** `bunny_video_id` (unique where
  set) and `video_ready_at`. Still columns here, and unread by the app
  since 2026-10-12, as on `lessons`.
- **Note:** nothing can complete a lesson that exists only here.
  `student_lesson_completions.lesson_id` references `lessons(id)`, and
  `record_lesson_heartbeat` looks the lesson up in `lessons`. A
  `lesson_videos` row for such a lesson does not change that: while the
  switch names this table, `lesson-video` would give out the address
  and the video would play, and every heartbeat would be refused with
  `22023`, so nothing is recorded (read from the code; the refusal is
  in the migration tests, the route was never run).
- **Note:** `lesson_videos` and `student_lesson_watch` name a lesson by
  its `id` with no foreign key. v101 refuses, changing nothing, to
  retitle or delete a lesson that a row of either table points at, to
  turn a lesson that has a `lesson_videos` row into a lesson that is
  not a `watch` lesson, and to run while a `lesson_videos` row sits on
  a course-shaped id that has no lesson here. Its undo refuses while a
  row of either table points at any id shaped like `a3l07`.
- **Note:** RLS on, with one select policy for any signed-in user, so
  every column stored here is readable by any account that is signed
  in. That is why a Tella video id is kept in `lesson_videos`.

### `lesson_videos` (v100)
- **Owner:** the lesson video player under `/world` (branch
  `world-engine`). It holds which Tella video plays for which lesson,
  and what the last lock check found. One row per lesson that has a
  video; no row means "not recorded yet". v100 has not been run on
  production.
- **Depends on:** nothing by constraint. `lesson_id` has no foreign
  key, on purpose: until the cutover the table may hold ids from both
  `lessons` and `lessons_next`. The cutover did not add one (its PRD:
  "no key, by design"): v104 copies the rows on ids the new course
  does not have into `archive_v1` and deletes them (call C11), and
  leaves the course's own rows alone, so after the switch every row
  names a lesson in `lessons`, with nothing in the database holding it
  there.
- **Written by:** three writers. No route a student can reach writes
  it.
  - **The video load** (`supabase/diagnostics/load-lesson-videos.sql`)
    owns the rows whose `lesson_id` is shaped like `a3l07`, the
    course's lessons. The tracked file is a template that holds no id
    and refuses to run. A tool outside this repository
    (`clients/ecom-university/tools/tella/` in the owner's workspace)
    writes a filled private copy, and a person pastes that into the
    Supabase SQL editor. A row of its list has four columns: lesson
    id, the lesson's title, video id, seconds. It refuses a list in
    which a title differs from the title that lesson has in the
    catalog, so a list made for another version of the course cannot
    go in. Its list is the whole truth for those ids: it
    inserts a row for a listed lesson, and when the list gives a lesson
    another video it replaces `tella_video_id`, sets `lock_status` back
    to `unchecked` and empties `lock_detail` and `lock_checked_at`. A
    row that already holds the listed video is not touched. A course
    lesson that is not listed loses its row. It never writes a row on
    any other id. In the same transaction it writes `duration_seconds`
    on `lessons_next` and `lessons` for the same ids, so a course
    lesson has a length exactly when it has a video. It has not been
    run on production (2026-10-13).
  - **A person, by hand** in the Supabase SQL editor, inserts, changes
    and deletes rows on any other id (`lesson_id`, `tella_video_id`);
    the morning kit's stamp and unstamp files are that same hand, for
    the two test lessons.
  - **`GET /api/cron/check-lesson-videos`** updates `lock_status`,
    `lock_detail` and `lock_checked_at` and no other column, and its
    update is filtered on `lesson_id` AND `tella_video_id`, so a
    verdict lands only on a row that still holds the video Tella was
    asked about.
- **Guarded against the two files that could erase a row:** the rows
  are the database's only record of which video belongs to which
  lesson (no other table has it, and the repository never does). For
  the course's lessons the same pairs are also in the Tella tool's
  private files, outside this repository.
  `supabase/undo/2026_v100_undo.sql` refuses to run while the table
  holds any row: it raises before its transaction starts, gives the
  count and the select that saves the rows, and changes nothing.
  `supabase/diagnostics/stamp-tella-test-lessons.sql` refuses when a
  lesson it picked already holds a video that is not one of the two
  test ids; it inserts and no longer overwrites. Neither message holds
  a video id.
- **Depended on by:** `POST /api/student/lesson-video` (reads
  `tella_video_id` for one lesson), `GET /api/student/data` (reads
  `lesson_id` only, to attach `has_video`), the SQL function
  `record_lesson_heartbeat` (a lesson is playable only when it has a
  row here), `GET /api/cron/check-lesson-videos` (reads `lesson_id` and
  `tella_video_id` of every row, ordered by `lock_checked_at` with the
  rows never checked first). Three SQL files read `lesson_id` when the
  table exists: migration v101 and `supabase/undo/2026_v101_undo.sql`
  (v101 refuses while a row points at a lesson it would retitle,
  delete or turn into a lesson that is not a `watch` lesson, or sits
  on a course-shaped id that has no lesson in `lessons_next`; the undo
  refuses while a row points at any course-shaped id) and
  `supabase/diagnostics/course-catalog-check.sql` (read only; three of
  its four checks read the video rows, the newest one counting video
  rows on lessons that are not `watch` lessons). The admin rebuild
  (branch `night/admin`): `GET /api/admin/thirty` (and
  `GET /api/admin/today` until admin rebuild 2), through `loadThirtyData`
  (`src/lib/admin/thirty-data.ts`), read `lesson_id` and `created_at`
  of every row, never `tella_video_id`, with the service role's client
  `requireTeam` hands them; `supabase/diagnostics/admin-today-spotcheck.sql`
  (read only) reads `lesson_id` to know which lessons the 30% asks for
- **Stable contract:** `lesson_id` (text, primary key, so one video per
  lesson), `tella_video_id` (text, not null, unique, so one lesson per
  video; it must match `^vid_[a-z0-9]{10,64}$`, the same pattern as
  `isTellaVideoId()` in `src/lib/world/tella.ts`), `lock_status`,
  `lock_detail` (the check's sentences joined by ` | `, null when it
  has none), `lock_checked_at` (null until the first check),
  `created_at`, `updated_at` (kept by the trigger
  `trg_lesson_videos_updated_at`)
- **`lock_status` values** (a CHECK constraint allows these five):
  - `unchecked`: set on insert. No check has looked at this video.
  - `locked`: access is "Embed only", the video has a domain list,
    every site on that list is an expected one, and downloads are off.
    A `locked` row can still carry sentences in `lock_detail`: an
    expected site missing from the list (the lesson will not play
    there), a length more than 2 seconds away from the catalog's (the
    95% rule measures the wrong length), a `watch` lesson the catalog
    has no length for (it can never be counted), or a row whose
    `lesson_id` no `watch` lesson has. The last two are about the
    catalog. They are added whatever Tella answered, a 404 included,
    so an `open` or `missing` row can carry them too. An `error` row
    carries only the reason Tella could not be asked.
  - `open`: Tella serves the video more widely than the rule allows.
    Its access is something other than "Embed only", or it has no
    domain list, or a site on the list is not an expected one
    (`localhost` counts), or downloads are on.
  - `missing`: Tella answered 404 for the id. It no longer has the
    video.
  - `error`: Tella could not be asked on that run (no answer within 10
    seconds, a failed request, an answer that was not a 200 or a 404,
    or a 200 without the video's settings or its download switches).
    It says nothing about the video itself.
- **Private:** RLS is on with NO policy, and every privilege is
  revoked from `anon` and `authenticated`, so a browser query is
  refused for any account. The service role reads it for the
  routes above, and `record_lesson_heartbeat` reads it because it is
  security definer. Never add a policy, and never select
  `tella_video_id` in a route that answers a browser, except
  `lesson-video`.
- **Note:** a real video id is never written into a tracked file, a
  commit message, a log line or an error message. The repository is
  public and the id is the video's address. `CONTEXT.md` has the rule
  and its reason ("Lesson videos on Tella: the rules").
- **Note:** a row does not make a lesson completable by itself. The
  lesson's `duration_seconds` has to be set with it. The video load
  does that for a course lesson; for any other lesson
  `lessons.duration_seconds` is set by hand. Before the cutover a
  course lesson cannot be completed either way (the `lessons_next`
  entry says why).
- **Unproven:** whether production grants a new table to `service_role`
  by default. The routes and the lock check need it. v100's commented
  post-check has a column for it (`service_reads_and_writes`) and the
  grant that fixes it.

### `quizzes` + `quiz_questions`
- **Depends on:** `regions` (after v104 the key is
  `fk_quizzes_region_id`, `ON DELETE RESTRICT`)
- **Depended on by:** `student_quiz_attempts`, quiz UI
- **Stable contract:** quiz schema is mostly internal — only quiz IDs
  travel outside
- **Note:** v104 archives and empties both tables, with
  `student_quiz_attempts` and `student_region_quiz`: the new course has
  no region quizzes. Only `/dashboard` reads them, and it forwards
  after the switch.

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
- **At the course switch (v104):** every active template whose
  `trigger_config -> 'all'` has an element naming `lesson_id` or
  `region`, or the metric `progress_ratio`, `progress_label` or
  `region_pace`, is set `is_active = false`, with a copy of the row in
  `archive_v1.csm_changes`; the undo turns back on the ones still off.
  `cutover-preflight.sql` part b lists them beforehand. Turning a
  template off does not stop a built-in: the built-ins fire whenever a
  template row exists for their scenario (`check-csm-tasks`), which is
  why the clock built-ins are stopped in code (`courseIsNew`) and not
  here. After the switch the trigger editor offers areas from
  `regions` and no clock metric.
- **From the admin (admin rebuild 2, WI-8, branch `night/a2-templates`):**
  a built-in row (`is_custom = false`) is never deleted:
  `DELETE /api/admin/templates/:id` deletes only `is_custom = true` and
  answers 400 for a built-in, so `check-na-tasks` and `check-csm-tasks`
  always find their scenarios. The Templates page's Save writes only the
  fields that changed, and an emptied condition list as `null`, never
  `{"all": []}`: `check-csm-tasks`' auto-dismiss evaluates any
  `trigger_config` it finds, and an empty list never matches, so a
  `stalled.*` or `welcome.day1` row saved that way would have its open
  tasks dismissed. Rows a page saved before this may hold `{"all": []}`:
  on 20 October only `nolessons.day14` and the custom `C-42c1aa` had a
  non-null `trigger_config` (whether `nolessons.day14`'s is an empty list
  or conditions was not read). The auto-dismiss judges a `nolessons.*`
  task by its built-in rule first, so an empty list there dismisses
  nothing.

### `admin_config`
- **Depends on:** —
- **Depended on by:** `src/lib/templates.ts` (variable substitution),
  the crons through `src/lib/dm-toggles.ts` (the 4 Discord switches),
  day-28 DM, `GET`/`PUT /api/admin/config`
- **Stable contract:** keys `program_login_link`, `discord_invite_link`
  (v51 dropped `astrid_booking_link` + `karlo_walkthrough_video_link`
  when D1.A/D1.B were merged into a single D1)
- **Written from the admin (admin rebuild 2, branch `night/admin2`,
  D6):** only through `PUT /api/admin/config` (founder and admin), and
  only the 6 keys of `src/lib/admin/config-keys.ts`:
  `program_login_link`, `discord_invite_link`, `dms_master_enabled`,
  `day28_dm_enabled`, `engagement_alerts_enabled`,
  `csm_task_summary_enabled`, a switch only as "true" or "false"; every
  other key, a value that is not text and a switch set to anything else
  is a 400 with nothing written. `/admin/settings` (every row as a text
  field), `/admin/discord` and `/api/admin/dm-toggles` were removed; the
  Templates page's Message settings panel (WI-8) is the page for these 6.
  Proven in `client-tests/admin-routes.test.mjs`.
- **A key with no reader (v95):** `discount_window_days`, seeded `14`.
  No code reads it; the discount routes use `DISCOUNT_WINDOW_DAYS` in
  `src/lib/constants.ts`. `/admin/settings` listed every row of this
  table as an editable field until admin rebuild 2 removed it, and
  `PUT /api/admin/config` now refuses this key (400).
- **`curriculum_reset_at` (cutover, branch `world-engine`, not on
  production).** The moment of the course switch, a string in UTC
  like `2026-10-20T18:25:00.000Z`. No row means the old course is
  live; a row means the new one is.
  - **Written by** v104 only, in the same transaction as the archive,
    the wipe and the copy, and equal to `archive_v1.meta.reset_at`.
    **Deleted by** the undo of v104, in its transaction. Nothing in
    `src/` writes it: `PUT /api/admin/config` refuses its key with a
    400 (and no admin page shows it since `/admin/settings` went). A founder can
    still change it in the Supabase editor, which would move every
    course day, CSM window and snapshot floor counted from it.
  - **Read in the app** through `getCurriculumResetAt()`
    (`src/lib/curriculum-reset.ts`), which throws on a read error or a
    value that is not a date and time with its zone. Each reader, and
    what it does when the read fails:
    - `/api/cron/check-csm-tasks`: course days, the live areas, the
      clock built-ins off; the run fails in `cron_runs`.
    - `src/lib/csm-task-evaluation.ts` (`reEvaluateStudentOpenTasks`,
      after a lesson write): the same; it returns an error and
      dismisses nothing.
    - `/api/cron/check-engagement`: course days in its "Day N" texts;
      the run fails in `cron_runs`.
    - `src/lib/achievements.ts` (`buildAchievementSnapshot`): the day
      number from the later of first payment and the switch; the check
      is skipped that once.
    - `/api/cron/snapshot-progress`, `/api/admin/rebuild-snapshots`,
      `/api/admin/refresh-everything`: the rebuild's start clamped to
      the switch's date; the cron fails in `cron_runs`,
      `rebuild-snapshots` answers 500, `refresh-everything` reports it
      under `rebuild` and still runs the three crons.
    - `src/lib/useJourneyPaceCounts.ts` (`useJourneyPaceCounts`,
      `loadCourseActivity`), and through it `/admin/journey`,
      `/admin/students`, `/admin/students/[id]` and
      `/admin/insights/progress`: activity in place of pace; "—".
    - `src/components/admin/TriggerBuilder.tsx`: no clock metric
      offered after the switch.
    - `GET /api/admin/cutover-status`: the phase and the problem list;
      500.
    - `POST /api/admin/whop-catchup` (T-089): runs only after the
      switch, since before it `lessons` holds the old course; no row
      answers 409, a failed read 500, and nothing runs.
    - `PUT /api/admin/config` compares the key
      (`CURRICULUM_RESET_KEY`) to lock it, and reads nothing.
  - **Read in SQL:** the trigger function `daily_snapshots_reset_floor()`
    (v103, the snapshot floor); v104 (it skips everything when the row
    exists, and checks the row against `archive_v1.meta`); the undo of
    v104 (refuses without it); the undo of v103 (refuses with it); v101
    (refuses with it); `cutover-preflight.sql` (expects it absent) and
    `cutover-postcheck.sql` (expects it to agree with
    `archive_v1.meta`); `whop-catchup-proof.sql` (counts the watched
    lessons dated before it).
  - Readable by any team member and writable by founders and admins
    (v27's policies); the crons read it with the service role. A
    student's client reads no row and gets null, so no student-side
    code reads it: the world tells the courses apart by
    `CATALOG_IS_V2`.

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
  exists only in `lessons_next` cannot have a row here. After v104 the
  key is `fk_student_lesson_completions_lesson_id`, `ON DELETE
  RESTRICT` (it was `CASCADE` under Postgres's default name).
- **Added by the cutover work:** the view
  `student_last_counted_completion` (v103) reads `completed_at` of
  complete rows on counting lessons; `src/lib/world/discount-server.ts`
  reads `lesson_id, completed_at` (a video is done when `completed_at`
  is set). Writers it already had and keeps: the Whop webhook and
  `watch-sync.ts` upsert a row for a lesson matched by
  `whop_lesson_id`, and both finish a row that is already there
  (`completed_at` set, `skipped_at` cleared, `discord_message_link` and
  `action_completed_at` kept; the webhook since 2026-10-16). v104
  archives every row into `archive_v1` and
  empties the table; its undo moves the rows made since into
  `archive_v2` and puts the archived ones back.
- **The Whop catch-up writes here too (T-089, 2026-10-20):**
  `src/lib/whop-catchup.ts`, run by `POST /api/admin/whop-catchup`, for
  every active or past_due member, matched by `whop_lesson_id` as the
  backfill does. It sends a time where the others let the database stamp
  now(): `completed_at` is Whop's `created_at` (when the member opened
  the lesson on Whop), or the run's clock when Whop's is later or
  missing. A new row goes in with `ignoreDuplicates`, so a row that
  exists keeps its time; a row with no `completed_at` is finished
  (`completed_at` set, `skipped_at` cleared, `.is("completed_at", null)`
  on the update). Every row it adds or finishes is in its write answer's
  change log (`changes.inserted`, `changes.promoted`), for an undo. It
  never writes `discord_message_link` or `action_completed_at`.
- **Who may write (v105, built 2026-10-16, not on production):** a
  student reads their own rows ("Students can read own lesson
  completions", FOR SELECT) and writes none; v3's FOR ALL policy is
  dropped and recorded for the undo. Every writer above uses the
  service role. `mark-action-shipped` completes a new-course action item
  only once `discord_message_link` is saved on the row (400 with
  `PASTE_LINK_FIRST` otherwise), and `skip-lesson` writes no
  `skipped_at` for a new-course `watch` lesson. On the new course's
  catalog `mark-action-shipped` never clears an action item:
  `shipped: false` is refused (T-079), and `toggle-lesson` writes no
  new-course action item.

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
  `LessonPlayer` (resumes from `last_position_seconds`, and on opening
  a lesson whose row has `threshold_met_at` it asks once for the
  completion),
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
- **Depends on:** `students`, `lessons` (after v104 the key is
  `fk_lesson_notes_lesson_id`, `ON DELETE RESTRICT`)
- **Depended on by:** `LessonSheet` (per-lesson note), journal
- **Stable contract:** `student_id`, `lesson_id`, `body`
- **Note:** v104 archives and empties it, as it does
  `student_lesson_ratings` (key `fk_student_lesson_ratings_lesson_id`,
  RESTRICT): both name old-course lessons.

### `student_quiz_attempts`
- **Depends on:** `students`, `quizzes`
- **Depended on by:** quiz UI, region unlock logic
- **Stable contract:** `student_id`, `quiz_id`, `passed`, `score`

### `discount_requests`
- **Depends on:** `students`
- **Depended on by:** `StudentContext`, `/admin/discounts` (since the
  admin rebuild, branch `night/admin`, through `GET /api/admin/thirty`:
  every pending request whatever its date, and the others made from
  `DISCOUNT_ELIGIBLE_FROM` on; Today's 30% reasons read the same through
  `loadThirtyData` until admin rebuild 2 removed Today), Whop promo flow, `src/lib/csm-triggers.ts`
  (membership/discount status checks where applicable),
  `src/lib/first-paid-repair.ts` (reads `student_id`, `status`,
  `created_at` of the students whose `first_paid_at` it would move, to
  count `thirty.requests_change` and `thirty.open_with_old_request`)
- **Stable contract:** `student_id`, `status`
  (pending/approved/rejected/applied), `promo_code`, `created_at`
- **Added in v95, unused:** `gate_lesson_id` (text, nullable, no
  foreign key on purpose): the lesson that was the discount gate when
  the request was decided. Nothing in `src/` reads or writes it.
- **The new course's rule (branch `world-engine`):**
  `src/lib/world/discount-server.ts` reads the student's requests
  (status, `created_at`, `promo_code`, `rejection_reason`) and the map
  reads them through `StudentContext`, which since 2026-10-17 gets only
  `id`, `status`, `created_at` and `rejection_reason` from
  `/api/student/data`, never the promo code; `discountState()` lets the
  latest request that counts decide what the student sees.
  `requestCounts()` (T-080) counts every request from 2026-10-08 22:00
  UTC (the launch) on. An earlier one counts only for a student whose
  `first_paid_at` is from 2026-09-30 22:00 UTC (1 October in Croatia;
  2026-09-08 22:00 UTC until 2026-10-19) until the launch, and
  only while pending, approved or applied, because v29's
  `submit_discount_with_feedback` refuses another request while one of
  those exists, whatever its date, so the map must never offer Apply
  then. Discount Earned (`achievements.ts`) reads the same function. The
  course switch leaves the table untouched (call C10), so a request
  still pending at the switch has to be decided before it.
  The first-paid repair (2026-10-20) can change which requests count,
  because it moves `first_paid_at`: a date moved into 1 to 8 October
  makes an old pending, approved or applied request count; a date moved
  out of that window makes one stop counting. And a date that opens the
  30% (from before 1 October to the launch or later, the reported case)
  leaves an old request from before the launch uncounted: the map ignores
  it and can offer Apply to a student who already asked for, or got, a
  30% on the old dashboard. `POST /api/discounts/request` on the new
  course grants on `ready` and inserts; the one refusal below it is
  v106's index, which stops only a second pending row (and v106 is not on
  production, below). Its dry run counts both before anything is written
  (`thirty.requests_change`, `thirty.open_with_old_request`).
- **One pending request per student (v106, built 2026-10-16, not on
  production):** the unique index `discount_requests_one_pending_per_student`
  on `student_id` where `status = 'pending'`. A second pending row, inserted
  or set back to pending, is refused with 23505 and the first stands;
  other statuses are not limited. `POST /api/discounts/request` and
  `POST /api/discounts/submit-feedback` answer that refusal like a request
  in review, 400 `{ error: ALREADY_APPLIED, state: "pending" }`
  (`secondPendingRequest`, `src/lib/world/discount-server.ts`).
  `SAVE_FAILED` (2026-10-17) is both routes' answer to any other failed
  write, a 23505 on another index included, logged with the real error
  under `[discounts/request]` or `[discounts/submit-feedback]`. v105 drops
  the student insert policy, so only the server and
  `submit_discount_with_feedback` (security definer) write rows.
- **Only the server calls `submit_discount_with_feedback` (v107, built
  2026-10-17, not on production):** EXECUTE for `service_role` alone,
  and the function refuses any caller whose token is not the service
  role's (`auth.role()`). `POST /api/discounts/submit-feedback` calls it
  with its service-role client and the student id from the token, so the
  route and v107 go live together (Monday, after the merge into `main`):
  before v107, v29's own check refuses the service role. On the new
  course the approve route also refuses a request no route could have
  made, where the rule would approve: one created more than 5 minutes
  after the student's deadline, or one beside another counted request
  (`requestCounts`) that was rejected, approved or applied
  (`madeOutsideApply`, `src/lib/world/discount-server.ts`).
- **No ads check on approve (2026-10-20, Lovro's decision):**
  `POST /api/discounts/approve` no longer reads
  `students.ad_submissions_verified`, on either course: the 30% already
  asks for 61 videos, so the rule alone decides, and Generate anyway
  (`override`) skips it. Before, it refused with "Ad submissions not
  verified yet..." while the column was false. The column is still set
  from the student page and the journey drawer
  (`POST /api/admin/verify-ad-submissions`) and gates nothing.

### `discount_feedback_questions` + `discount_feedback_responses`
- **Depends on:** `discount_requests`
- **Depended on by:** discount review UI, analytics
- **Stable contract:** question id, response shape (scale / choice / text)

### `disengagement_alerts`
- **Depends on:** `students`
- **Depended on by:** CSM cron (alert → task mapping
  via `pickExistingAlertScenario` in
  `/api/cron/check-csm-tasks/route.ts`), the team's Discord post from
  `/api/cron/check-engagement` (`buildAlertsEmbeds` in
  `src/lib/discord.ts`: one message per embed of at most 4096
  characters; a post that fails marks the run failed). No admin page
  lists these rows (`/admin/alerts` was removed on 2026-05-25). An open
  alert of a type blocks a new one and nothing in the app closes it
  (v104 did once, below), so an alert is posted at most once.
- **Stable contract:** `student_id`, `alert_type`, `created_at`,
  `dismissed_at`
- **At the course switch (v104):** open `no_tasks_7d` and
  `no_lessons_3d` alerts are set `is_dismissed = true` with
  `dismissed_at` = the moment (each in `archive_v1.csm_changes`; the
  undo opens them again); `no_login_5d` stays open. After the switch
  `pickExistingAlertScenario` maps `no_tasks_7d` and `no_login_5d` to
  no task, and `no_lessons_3d` to `nolessons.day{N}` by course day only
  for a student with 0 lessons.

### `tasks` (CSM task queue)
- **Depends on:** `students`, `templates`
- **Depended on by:** `/admin/tasks`, the 30% page's last contact
  (`GET /api/admin/thirty`), (`/admin/today` through `GET
  /api/admin/today` and `POST`/`DELETE /api/admin/today/mark`, admin
  rebuild, branch `night/admin`, until admin rebuild 2 removed them), `src/lib/csm-events.ts`
  (`recentTaskScenarios` dedupe), optional ops digest. (`/admin/kanban`,
  listed here until 2026-10-20, does not exist.)
- **Support records (admin rebuild, branch `night/admin`, not on
  production; nothing writes them since admin rebuild 2 removed Today
  and its mark route, branch `night/admin2`, and the rows already
  written stay):** a mark on Today wrote a row with `scenario_id`
  `support.<kind>` (`support.cancel`, `support.pastdue`,
  `support.30close`, `support.30ready`, `support.stopped`,
  `support.nostart`, `support.noopen`), `template_id` null, `status`
  `completed` (Messaged, with `completed_at` and `completed_by`) or
  `dismissed` (Not needed, with `dismissed_at`, `dismissed_by` and the
  reason in `notes`), `created_at` equal to that moment, and
  `behavior_summary` holding every reason the row had. Never open, so the
  crons and the one-open-task index never meet one. They were written
  only by `POST /api/admin/today/mark` (from Today, or Mark messaged on
  the 30% page's Can still earn) and deleted only by
  `DELETE /api/admin/today/mark`, both removed in admin rebuild 2; the
  30% loader still reads a completed one as the last contact.
  `GET /api/admin/tasks` drops every task with no
  template after its query (v59), so a support record never shows in the
  Tasks tabs; on this branch it still takes one of that query's 100 rows,
  until lane G1's change (`night/hf-admin`, `5bc5e27`) moves the filter
  into the query. Merge G1 before this branch or with it, then run
  `npm run test:client` again: without it a busy day of marks pushes
  older sends off the Sent tab and the Tasks page's "N sent today"
  undercounts (review of 2026-10-20). Outreach insights count template sends only, so a mark
  for a reason the app computed is not in them either.
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
- **At the course switch (v104):** every open task whose `scenario_id`
  starts `nolessons.`, `noship.` or `pace.`, or whose template the
  switch turned off, is set `status = 'dismissed'`, `dismissed_at` =
  the moment, with "Dismissed by the course switch: the old course's
  progress was reset." appended to `notes`, and a copy of the row in
  `archive_v1.csm_changes`. The undo reopens a task only where no open
  task now exists for the same student and scenario.

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
  `/api/admin/refresh-everything`. Since the cutover work each reads
  `curriculum_reset_at` and moves its start up to the switch's UTC
  date (`clampStartToReset`); when nothing is left it does not call
  the function and says "nothing to rebuild before the course switch".
  The snapshot cron counts lessons by `counts_toward_progress`.
- **The floor (v103):** the trigger `trg_daily_snapshots_reset_floor`
  (`before insert or update or delete`, for each row, function
  `daily_snapshots_reset_floor()`, security definer) raises `22023`
  for any row dated before the UTC date of
  `admin_config.curriculum_reset_at`, so no writer, the function
  included, can recompute a day from archived progress or fill in a
  day missing from before the switch. Without the key it lets every
  write through; the switch's own day stays writable. A
  `curriculum_reset_at` Postgres cannot read as a time makes every
  write to the table fail until the row is fixed. The undo of v103
  drops it.
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
  "did Vercel fire any of the cron routes?" question, see `cron_runs`.

### `cron_runs` (v82)
- **Depends on:** —
- **Depended on by:** team-read RLS only; queried ad-hoc to confirm
  scheduler health
- **Stable contract:** `id`, `route_name` (`sync-whop` /
  `snapshot-progress` / `check-engagement` / `check-csm-tasks` /
  `check-na-tasks` / `day28-dm` / `check-lesson-videos`, the last one
  from the unscheduled lock check, which has never run for real),
  `started_at`, `finished_at`,
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
  failures don't break business logic. Since 2026-10-20 `failed` also
  means, for `check-engagement`, a Discord post of new alerts that did
  not go out (`error_message` names each part and Discord's answer) or
  a failed read of its two Discord toggles (the run wrote nothing),
  and for the three CSM crons a failed read of the student pool, the
  milestones or the completions (the run wrote nothing).

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

**No reader since admin rebuild 2 (2026-10-20, branch `night/admin2`)
removed Stats, its routes and `src/lib/whop-stats*.ts`; the table, its
policy and `current_user_is_stats_owner()` stay, with no migration.
What follows is the contract as it was.**

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

**No reader or writer since admin rebuild 2 (2026-10-20, branch
`night/admin2`) removed Brand Owners, its 5 routes and `src/lib/etfb.ts`;
this table and `etfb_seat_decisions` stay, with no migration. The ETfB
and Apex product ids are in `src/lib/whop-products.ts`. What follows is
the contract as it was.**

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
(two owners).

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

Defined by migrations v92 to v98, v100 and v103, whose files exist
only on branch `world-engine`. Whether v98 is applied to production is
unconfirmed; `supabase/diagnostics/v6-wiring-preflight.sql` is the
read-only query that settles it. v100 has not been run on production
by this document's record (the course-catalog state file says it
has). v103 has not.

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

### `record_lesson_heartbeat` (function, v93, tightened in v97, changed in v100)
- **What it is:** the only writer of `student_lesson_watch`. This
  entry describes it as v100 leaves it. v100 has not been run on
  production.
- **Signature (unchanged by v100):** `record_lesson_heartbeat(p_lesson_id text,
  p_position_seconds numeric, p_reported_duration numeric default null,
  p_delta_seconds numeric default 0, p_force boolean default false)
  returns jsonb`. Security definer. Execute is granted to
  `authenticated` and revoked from `public` and `anon`.
- **Called by:** the browser, through `supabase.rpc()` in
  `src/lib/world/watch-heartbeat.ts`. Nothing else calls it.
- **Depends on:** `students` (it finds the caller's row from
  `auth.uid()`; no student id is passed in), `lessons` (the id must
  exist there with `type = 'watch'`; it reads `duration_seconds`) and,
  since v100, `lesson_videos` (the lesson must have a row there). It
  looks in `lessons` and never in `lessons_next`.
- **What changed inside in v100** (v97's text with five changes):
  - Playable now means "has a `lesson_videos` row". Through v97 it
    meant "has a `bunny_video_id`", which the function no longer reads.
  - A beat after the first is credited at most 2.5 seconds of video
    for each second of clock since the beat before it (`v_speed_cap`).
    v97 credited one second per second, so a lesson watched faster
    than 1.25x could not reach the 80% played floor.
  - The most one beat after the first may bank went from 20 to 60
    seconds (`v_max_delta`). At 2.5x a 15 second beat carries 37.5
    seconds of video.
  - The first beat for a student and lesson keeps v97's 20 seconds in
    a constant of its own (`v_first_delta`). It has no earlier beat for
    the clock to measure from, and at 60 one forged call would have
    passed both rules on any lesson of 75 seconds or less.
  - Each call takes a lock on its own student and lesson, right after
    the student lookup and before the watch row is read:
    `pg_advisory_xact_lock(hashtextextended(v_student_id::text || ':'
    || p_lesson_id, 0))`. It is held to the end of the transaction, so
    calls fired at the same instant are served one at a time. The
    later call reads the row only after the earlier one has committed.
    Its `now()` is still the instant it was fired, so the clock it is
    measured by comes out at about zero and it is credited about
    nothing. Without the lock each call read the row before any had
    committed and each was credited in full: three first calls fired
    together banked 60 seconds, which completes a 67 second lesson.
    v97 has the same race at 20 seconds a call.
- **What is proven about the lock, and what is not** (migration
  tests, section 18): the installed function takes the lock once, in
  that place; a call holds one exclusive lock keyed on its own student
  and lesson until its transaction ends and none after it; and callers
  served one at a time are credited as one (four calls of 60 seconds,
  24 seconds after the last beat, get 60 between them; a later caller
  whose `now()` is 50 ms before the stamp it finds gets exactly 0;
  three first calls at the end of a 67 second lesson bank 20 seconds,
  29.9%). NOT proven: the race itself. The harness has one connection
  and cannot fire two calls at the same instant, so no test shows two
  real callers waiting on each other, and nothing has run on
  production.
- **Known and left open** (v100's header): the lock and the clamp are
  per lesson, so several lessons run side by side are each credited
  2.5 times the clock. A forced call that started a few milliseconds
  before the beat stored ahead of it is credited nothing and then
  writes its own, earlier, start time into `last_heartbeat_at`, so the
  next beat is credited 2.5 times those milliseconds a second time.
- **What it does with its inputs:** clamps the position into
  `[0, duration]`; clamps the played-seconds delta as above; refuses a
  beat less than 5 seconds after the last one unless `p_force` is true
  or the beat crosses the threshold. It stamps `threshold_met_at` when
  the furthest position reaches 95% of `lessons.duration_seconds`, and
  uses only that catalog duration for the decision (v97). A lesson
  with no `duration_seconds` never crosses.
- **One number in two places:** `v_speed_cap` here and
  `WATCH_SPEED_CAP` in `src/lib/world/tella.ts` are both 2.5, the top
  of Tella's speed menu. `client-tests/tella.test.mjs` reads the v100
  file and fails when they differ.
- **Returns (stable contract, unchanged by v100, typed as
  `HeartbeatResult` in `watch-heartbeat.ts`):** `accepted`, `reason`
  (`rate_limited` on a refusal), `max_position_seconds`,
  `last_position_seconds`, `watched_seconds`, `duration_seconds` (the
  row's `reported_duration_seconds`), `threshold_met`,
  `threshold_crossed` (true on exactly one call per lesson, the beat
  that crossed 95%). A refusal carries `accepted`, `reason`,
  `max_position_seconds`, `watched_seconds`, `threshold_met` and
  `threshold_crossed` only. Since 2026-10-12 the player asks
  `POST /api/student/lesson-watched` on every accepted result with
  `threshold_met`. It used to ask on the `threshold_crossed` edge,
  which made one request and stopped at a refusal.
- **Raises:** `42501` when the caller has no student row; `22023` when
  the lesson is not a playable watch lesson.
- **Undo:** `supabase/undo/2026_v100_undo.sql` puts v97's text back
  (with no lock and no 2.5x credit) and drops `lesson_videos`. It
  refuses to do either while that table holds a row. It is run by hand
  and never in sequence with the migrations.

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

### `student_last_counted_completion` (view, v103)
- **What it is:** one row per student who has finished at least one
  lesson that counts toward progress: `student_id`,
  `last_completed_at` (timestamptz), the latest `completed_at` among
  them. The same lessons and the same "done" as
  `student_progress_counts` (`counts_toward_progress`,
  `lesson_is_complete`), plus one condition the PRD did not write:
  `completed_at` is set. A lesson that was only skipped is done but is
  not activity, and gives no row (morning review B2).
- **Depends on:** `student_lesson_completions`, `lessons`
  (`counts_toward_progress`, `requires_action`), `lesson_is_complete`
- **Written by:** nobody; it is a view. Not on production.
- **Depended on by:** `loadCourseActivity` in
  `src/lib/useJourneyPaceCounts.ts`, and through it the activity pills
  and counts of `/admin/journey`, `/admin/students`,
  `/admin/students/[id]` and `/admin/insights/progress`. It is read
  only when `curriculum_reset_at` exists, so before v103 runs nothing
  asks for it. The CSM works out the same date from its own snapshot
  (`lastCountedCompletionAt` in `csm-triggers.ts`), by the same rule.
- **Stable contract:** `student_id`, `last_completed_at`.
  `security_invoker = on` (a team member's policies decide what it
  shows); select is granted to `authenticated` and revoked from `anon`,
  as for `student_progress_counts`.
- **Undo:** the undo of v103 drops it.

### `daily_snapshots_reset_floor` (trigger function, v103)
- The floor under `daily_progress_snapshots`; its entry above says what
  it refuses. Trigger `trg_daily_snapshots_reset_floor`. Reads only
  `admin_config` key `curriculum_reset_at`. Security definer,
  `search_path = public`.

---

## The course switch (v103, v104)

Two migrations on branch `world-engine` (2026-10-14), neither on
production. v103 (`2026_v103_cutover_expand.sql`) is additive and can
run any day: `student_milestones.playbook_unlocked_at`,
`regions.landmark_label` and `rail_at`, the view
`student_last_counted_completion`, the snapshot floor. v104
(`2026_v104_course_switch.sql`) is the switch, in one transaction.
Their undos are `supabase/undo/2026_v103_undo.sql` and
`2026_v104_undo.sql`. CONTEXT.md, "The course switch", says what each
part of the app does after it; this section is what the database
holds.

### The six keys into the catalog
Before the switch they are `ON DELETE CASCADE` under Postgres's
default names, so one `delete from regions` would erase every
student's progress. v104 looks them up in `pg_constraint` (never by
name), refuses unless they are exactly these six, records each
definition in `archive_v1.constraints`, drops them, and after the copy
adds them back as RESTRICT under names of its own:

| Key | Column | Points at |
|-----|--------|-----------|
| `fk_lessons_region_id` | `lessons.region_id` | `regions` |
| `fk_student_lesson_completions_lesson_id` | `student_lesson_completions.lesson_id` | `lessons` |
| `fk_lesson_notes_lesson_id` | `lesson_notes.lesson_id` | `lessons` |
| `fk_student_lesson_ratings_lesson_id` | `student_lesson_ratings.lesson_id` | `lessons` |
| `fk_quizzes_region_id` | `quizzes.region_id` | `regions` |
| `fk_student_region_quiz_region_id` | `student_region_quiz.region_id` | `regions` |

All six `ON DELETE RESTRICT`: deleting a lesson or an area that
anything points at is refused. No other key may point at `lessons` or
`regions` (the post-checks of v104 and `cutover-postcheck.sql` check
it). The chained keys (`quiz_questions.quiz_id`,
`student_quiz_attempts.quiz_id`) are untouched. `lesson_videos`,
`student_lesson_watch` and `discount_requests.gate_lesson_id` have no
key, by design. With the keys, v104 adds the unique partial index
`lessons_whop_lesson_id_key` on `lessons (whop_lesson_id) where
whop_lesson_id is not null`. The undo drops the six and the index and
re-adds the old keys from the recorded definitions, under their old
names.

### The schema `archive_v1`
- **Written by** v104 only, before any delete. One table per archived
  table, made with `create table ... as table` (same columns, no
  constraints): `regions`, `lessons`, `student_lesson_completions`,
  `lesson_notes`, `student_lesson_ratings`, `quizzes`,
  `quiz_questions`, `student_quiz_attempts`, `student_region_quiz`,
  `student_achievements`, `achievements`, `student_milestones`, and
  only the `student_lesson_watch` and `lesson_videos` rows whose
  `lesson_id` is not in `lessons_next`. Then the switch's record:
  - `meta (reset_at, ran_by, counts jsonb)`: one row; `reset_at`
    equals `admin_config.curriculum_reset_at`, `ran_by` is
    `current_user`, `counts` the row count of every archived table.
  - `stamps (student_id, row_existed, set_playbook, set_first_login)`:
    every student whose Playbook stamp or first login the switch set.
  - `csm_changes (kind, id, before jsonb)`: every template, task and
    alert it changed, `kind` one of `template`, `task`, `alert`, with
    the whole row as it was (`before` is the builder's addition to
    the PRD, so the undo puts back exactly that).
  - `constraints (table_name, conname, definition)` and
    `not_nulls (table_name, column_name)`: the keys, checks and
    not-nulls it dropped, as `pg_get_constraintdef` stated them.
- **Access:** every privilege on the schema and its tables is revoked
  from `public`, `anon`, `authenticated` and `service_role` (the PRD
  named the first three), so no API key reaches it. Only the owner,
  in the SQL editor, reads it.
- **Read by** the undo of v104, `cutover-postcheck.sql` (in a block
  before its select, only when the schema exists) and v104's own
  post-checks and final table.
- **Lifecycle:** absent, written by v104, renamed
  `archive_v1_undone_<yyyymmdd_hh24mi>` (UTC) by the undo, dropped by
  hand after at least 90 days (call C18; tasks.md). v104 refuses while
  a schema `archive_v1` exists. The undo also makes `archive_v2`, the
  rows done on the new course before the undo, and refuses while one
  exists.

### What v104 relaxes, and what it leaves
- Dropped, recorded, put back by the undo: `lessons.day` not-null and
  its check; `regions.subtitle`, `tagline`, `terrain`, `days_label`,
  `day_start`, `day_end` not-nulls and the `terrain` check.
- No column is dropped (call C19).
- `lessons_next` and `regions_next` stay, and the two private loads
  still write both catalogs.
- Not touched: `discount_requests`, `student_streaks`,
  `student_celebrations`, `daily_progress_snapshots` rows,
  `daily_notes`, the DM logs, `student_whop_sync`, `lesson_videos`
  rows on new-course ids.

---

## Lesson video routes (branch `world-engine`)

The three routes that touch a lesson's video, added or changed on
2026-10-12 when lesson video moved from Bunny Stream to Tella.
`POST /api/student/video-token` is deleted, and no code on this branch
calls it. The two new routes and the `has_video` change have not been
called against a database or run on a deployment.

### `POST /api/student/lesson-video`
- **What it is:** the only place a video's address leaves the server.
  It gives one lesson's Tella embed address to an active member.
- **Called by:** `realLessonTransport.getEmbed()` in
  `src/lib/world/lesson-transport.ts`, for `LessonPlayer`. Nothing else
  calls it.
- **Consumes:** `Authorization: Bearer <session token>` and the body
  `{ lessonId: string }`. No environment value beyond the Supabase
  ones.
- **Depends on:** `students` (`id`, `membership_status`), the catalog
  table the switch names (`id`, `type`, `duration_seconds`),
  `lesson_videos` (`tella_video_id`), `tellaEmbedUrl()` in
  `src/lib/world/tella.ts`
- **Produces**, every answer:
  - 200 `{ embedUrl: string, durationSeconds: number | null }` with
    `Cache-Control: no-store`. `embedUrl` is
    `https://www.tella.tv/video/{id}/embed?title=0&b=0&wt=0&a=0&o=1`.
    `durationSeconds` is the catalog's; no caller reads it today.
  - 401 `{ error: "Not authenticated" }` with no bearer token, and
    401 `{ error: "Invalid token" }` with a bad one.
  - 400 `{ error: "Malformed body" }` when the body is not JSON, and
    400 `{ error: "Missing lessonId" }`.
  - 503 `{ error: "We are updating to the new course. It will be
    released soon.", code: "student_app_closed" }` while
    `STUDENT_APP_CLOSED=true` (T-078, `refuseWhileClosed` in
    `src/lib/student-app-gate.ts`), right after the token check and
    before the student row is read, unless the student's Whop id is in
    `STUDENT_APP_OPEN_FOR`. It is 503, not 403, because the player
    reads a 403 as "membership inactive".
  - 404 `{ error: "Student not found" }` when the account has no
    student row.
  - 403 `{ error: "Membership inactive" }` when
    `students.membership_status` is anything other than `active`. The
    player shows "Your membership is inactive, so this lesson is
    locked."
  - 404 `{ error: "Lesson not found" }` when the catalog has no such
    lesson.
  - 404 `{ error: "Lesson has no video", notRecorded: true }` when the
    lesson is not a `watch` lesson or has no `lesson_videos` row. This
    is the normal answer for a lesson not filmed yet, and the player
    shows "Not recorded yet."
  - 500 `{ error: "Video lookup failed" }` when the `lesson_videos`
    read errors, so a missing or unreachable table does not pass for
    "not recorded".
  - 500 `{ error: "Video not configured" }` when the stored id is
    malformed. The table's check constraint makes this unreachable.
- **Writes:** nothing.
- **Rules its caller relies on:** the membership check runs before the
  id is read. The answer is never cached. No log line and no error
  body holds a video id. The client reads a 403 as "blocked", any
  other failure with `notRecorded` as "not recorded", and anything
  else as an error whose `error` text it shows.

### `GET /api/student/data`: a failed read
- **What changed (2026-10-20, progress-1, map-1):** the route reads
  about 17 things at once and answered 200 whatever came back. It now
  answers 500 with `{ "error": "Could not load your data. Try again." }`
  when the read of the regions, the lessons, or the student's
  completions, streak or milestones fails, or when the discount read
  fails with anything but `PGRST116`. That code is what `.single()`
  says for a student who never applied for the 30%, the usual case, so
  it is let through. The server log names each failed read
  (`[student/data] reads failed: ...`). 500 is what the other student
  routes answer; 503 is the closed doors' gate (T-078).
- **What it does not cover:** a failed `lesson_videos` read is answered
  200 and marked (`lessonVideosFailed`, below). The other reads
  (quizzes, quiz questions and attempts, the month review, the Whop
  sync row, celebrations, the DM log, region quizzes, ratings, the
  watch rows) are answered as before when they fail: empty, or null.
- **Why:** each of those reads, failed, answered as a believable empty
  state: no completions as every lantern out and all 61 videos left for
  the 30%, no streak row as a streak of 0, no milestones as a
  graduate's Playbook link gone, no discount row as an in-review
  request back to Apply, no lessons as "There are no lessons here
  yet.". postgrest-js retries a GET only after a network error or a
  503/520, so a pool timeout or a 500 under load comes back as an
  error with no data.
- **Read by:** `StudentContext.refreshFromServer`, which is the first
  load and every refresh: on a non-OK answer it applies nothing. A
  first load is asked again after 1 s and 3 s, then sets `loadError`;
  a refresh answered later loads everything and clears it. The
  toggles' own reads after a failed write keep their rows on a non-OK
  answer.
- **Proven:** `client-tests/student-data-errors.test.mjs` runs the real
  route on stub-server's FakeDb (18 checks on 2026-10-20);
  `client-tests/student-context.test.mjs` runs the provider's side.
  Neither meets a real database.

### `GET /api/student/data`: the `has_video` field
- **What changed:** every object in the `lessons` array carries
  `has_video: boolean`, true when a `lesson_videos` row exists for the
  lesson's id. It is attached by the route and is not a column. The
  rest of the payload is as before.
- **Depends on:** `lesson_videos` (`lesson_id` only, one more query;
  the route never selects `tella_video_id`)
- **Read by:** `StudentContext` (as part of each lesson),
  `src/lib/world/catalog.ts` (`hasVideo(id)`),
  `src/lib/world/map-model.ts` (`MapLesson.hasVideo`), `LessonScreen`
  (the player's `recorded` prop). `/dashboard` receives the field and
  does not use it.
- **No video id is ever in this payload.** The reason: this route has
  no membership check, so its payload reaches every account that is
  signed in, lapsed members included, and with Tella the id is the
  video's address. The types match: `Lesson` and `CatalogLessonLike` have
  `has_video` and no field for a Tella id.
- **On a failed read:** the route logs one error, every lesson gets
  `has_video: false`, and since 2026-10-20 the answer carries
  `lessonVideosFailed: true` (false when the read worked). A refresh
  in `StudentContext` then keeps each lesson's earlier `has_video`, so
  a map that is open does not turn its lessons into "Not recorded yet"
  (map-1). A first load has none to keep: every lesson shows "Not
  recorded yet." until a refresh reads the table. That is the state of
  any deployment whose database does not have v100.

### `GET /api/cron/check-lesson-videos` (the lesson video lock check)
- **What it is:** a job that asks Tella whether every lesson video is
  still locked, and whether the catalog can count the lesson it belongs
  to. NOT scheduled: `vercel.json` has no line for it, and it runs only
  when someone calls it. It has never run for real. Its route file has
  run against stand-ins (`node world-tests/lock-check-sim.mjs`).
- **Consumes:** `Authorization: Bearer <CRON_SECRET>` (through
  `verifyCronAuth`), and the environment values `TELLA_API_KEY` and
  `TELLA_EMBED_DOMAINS` (hosts a real lesson may be embedded on, comma
  separated; trimmed and compared in lower case).
- **Depends on:** `lesson_videos` (every row: `lesson_id`,
  `tella_video_id`, read in the order of `lock_checked_at`, the rows
  never checked first, then `lesson_id`), `lessons_next` and `lessons`
  (`id`, `type`, `duration_seconds`, both by name, the live table read
  last so it wins a shared id), Tella's API through
  `fetchTellaVideoFacts()` (`GET https://api.tella.com/v1/videos/{id}`
  with the key as a bearer token, given up after 10 seconds; it reads
  `video.durationSeconds` and `video.settings.{linkScope,
  allowedEmbedDomains, downloadsEnabled, rawDownloadsEnabled}`),
  `judgeLock()` and `watchLessonSeconds()` in
  `src/lib/world/tella-lock.ts`, `cron_runs`, and `postTeamAlert()`
  (`DISCORD_TEAM_WEBHOOK_URL`)
- **The judging contract** (`src/lib/world/tella-lock.ts`, pure):
  ```ts
  export type LockStatus = "locked" | "open" | "missing" | "error";
  export type CatalogLesson = "watch" | "none" | "unread";
  export interface LockVerdict { status: LockStatus; problems: string[]; }
  export interface TellaVideoFacts {
    linkScope: string | null;
    allowedEmbedDomains: string[];
    downloadsEnabled: boolean;
    rawDownloadsEnabled: boolean;
    durationSeconds: number | null;
  }
  export interface CatalogLessonRow {
    id: string;
    type: string | null;
    duration_seconds: number | string | null;
  }

  export function judgeLock(
    facts: TellaVideoFacts | null,          // null: Tella answered 404
    expectedDomains: readonly string[],
    catalogDurationSeconds: number | null,
    catalogLesson: CatalogLesson = "watch",
  ): LockVerdict

  export function watchLessonSeconds(
    tables: readonly (readonly CatalogLessonRow[])[],
  ): Map<string, number | null>
  ```
  `catalogLesson` is what the catalog says about the row's lesson.
  `"watch"`: a `watch` lesson has this id, and its length is passed
  beside it (null when the catalog has none). `"none"`: no `watch`
  lesson has this id, in either catalog table. `"unread"`: a catalog
  table could not be read and the id was not found in the other, so
  nothing is said about the catalog. Two sentences come from it and
  neither changes the status: "No watch lesson has this id." and "The
  catalog has no length for this lesson, so it can never be counted."
  `watchLessonSeconds` holds an entry for every `watch` lesson, null
  when it has no length, and no entry for any other id.
- **Produces:**
  - 200 `{ checked, locked, open, missing, error, notReached,
    problems: [{ lessonId, status, problems: string[] }] }`. `locked`,
    `open`, `missing` and `error` are counts and `checked` is their
    sum. `notReached` is the videos that got no verdict this run: the
    ones not asked about before the 270 seconds were up, and the rows
    that changed while the run was on. `checked + notReached` is the
    number of rows read at the start. `problems` lists every lesson
    whose verdict has at least one sentence, a `locked` one included.
    No video id is in the body.
  - 401 `{ error: "Unauthorized", reason }` without the right secret.
  - 500 `{ error: "Lock check not configured" }` when either
    environment value is missing or the domain list is empty.
  - 500 `{ error: <message> }` when the `lesson_videos` read fails or
    the run throws.
- **Side effects:**
  - One update per video asked about (`lock_status`, `lock_detail`,
    `lock_checked_at`), filtered on `lesson_id` AND `tella_video_id`.
    When that update touches no row, the row was changed or deleted
    during the run: the verdict is dropped whole, counted under
    `notReached`, and the row keeps what it had.
  - One `cron_runs` row per call. It ends as `success` only when every
    video got a verdict, every verdict was written, the catalog was
    read in full and any alert went out. It ends as `failed`, with a
    message naming each cause, when the run stopped asking at 270
    seconds, when a row changed during the run, when a catalog table
    could not be read, when a verdict could not be written, or when
    the alert could not be delivered. `cron_runs` has no status
    between the two, so a partial run is a failed one.
    `rows_affected` is the verdicts written. A refused call (no
    secret, a wrong one) is recorded with its reason.
  - One `postTeamAlert` call when any lesson has a problem, and also
    when the run has something to say about itself: videos not
    reached, or a catalog table it could not read. The title is
    "Lesson videos need attention". The run's own lines come first and
    are never cut; then one line per lesson, cut at whole lines to
    stay under 3,800 characters.
- **Rules its readers rely on:** it trusts nothing it stored; every
  run asks Tella about every video again, so a second run writes the
  same verdicts. One request starts at least 700 ms after the one
  before it started (86 a minute at most; Tella allows 100). No
  request starts later than 270 seconds after the run began, which
  leaves 30 seconds before Vercel's 300 second limit for the request
  under way, its write, the alert and the `cron_runs` row. What one
  run did not reach, the next run asks about first. A video Tella
  could not be asked about becomes `error` and the run goes on. While
  a catalog table is unread, a lesson the run cannot find is not
  called unknown. The body, the Discord message and the logs identify
  a video by its lesson id only.
- **Limits:** it sees a video's settings and cannot see whether Tella
  still acts on them (`CONTEXT.md`, rule 4, is the manual check for
  that). How many videos fit in one run is arithmetic in the route's
  header and was never measured on Vercel: about 385 at 0.7 seconds a
  video, about 190 at 1.4 seconds a video (the pace two requests from
  a laptop suggest), and 27 on a day when every request runs into its
  10 second limit. The header reckons with 145 videos, the size of
  v94's placeholder course, and 145 fit as long as Tella answers in
  about 1.6 seconds or less on average. The real course has 141
  lessons and 115 of them have a video in Tella (2026-10-13), so a
  full load is fewer rows than that.
- **Proven and unproven:** `node world-tests/lock-check-sim.mjs` runs
  this route file, `tella-lock.ts`, `tella-api.ts`, `cron-auth.ts` and
  `discord.ts` as they are against stand-ins for `fetch`, the Supabase
  client, `NextResponse` and the clock: 89 checks passed on
  2026-10-12. They cover the refusals, one row of every kind, a row
  swapped or deleted during a run, the 270 second budget and
  `notReached`, the pace, the alert and its cut, a catalog table that
  cannot be read, a write that fails, an alert that does not go out,
  what `cron_runs` says after each, and that no video id or key is in
  any answer, alert, `cron_runs` row or log line.
  Unproven: everything a stand-in stands for. How supabase-js and
  PostgREST treat the order and the two filters, row level security,
  how long a write takes, Tella's real answers from Vercel, Discord
  accepting the message, and Vercel's own clock have never been
  exercised, because the route has never run for real.

---

## Admin routes of the rebuild (branch `night/admin`)

The route behind the rebuilt 30% page (`/admin/discounts`), built on
2026-10-20 (admin rebuild PRD, milestone 1, in the owner's workspace
under `_admin/prds/admin-rebuild/`), and `PUT /api/admin/config` as
admin rebuild 2 limited it (D6, `_admin/prds/admin-rebuild-2/`). Local
commits only: none has run on a deployment or against a real database.
Every route takes `Authorization: Bearer <session token>` and checks the
login through `requireTeam`, which answers 401
`{ error: "Not authenticated" }` with no token, 401
`{ error: "Invalid token" }` with a bad one, and 403
`{ error: "Not a team member" }` for a login with no `team_members` row
(a student's). Every error is `{ error: <one plain sentence> }`, with no
em dash, "unlock" or "EcomTalent" in it. The 30% page calls its route
through `src/lib/admin/admin-transport.ts`.

Today's routes, `GET /api/admin/today` and `POST`/`DELETE
/api/admin/today/mark`, were removed with Today in admin rebuild 2 (D2,
branch `night/admin2`), with `src/lib/admin/today-data.ts` and
`support-list.ts`. The support records they wrote stay in `tasks` (see
`tasks` above).

### `GET /api/admin/thirty`
- **What it is:** the 30% page's whole list in one answer.
- **Called by:** `ThirtyView` (`src/components/admin/thirty/ThirtyView.tsx`)
  on load, on Refresh and after each decision.
- **Depends on:** `getCurriculumResetAt`, then `loadThirtyData`
  (`src/lib/admin/thirty-data.ts`): the catalog (`LESSONS_TABLE`, by
  `sort_order`), `lesson_videos` (`lesson_id, created_at`; the service
  role alone can read it), `discount_requests` (every pending or approved one,
  whatever its date, and the applied and rejected ones made from
  `DISCOUNT_ELIGIBLE_FROM` on), `students` (every
  first payment from `DISCOUNT_ELIGIBLE_FROM`, and everyone holding a
  listed request), their completions of the lessons the 30% asks for and
  of the action items (each read holds as many students as fit in one
  page, so it is one query), their requests, `student_whop_sync`
  (`student_id, last_sync_at`), `discount_feedback_questions` and the
  listed requests' answers, the completed and the open `tasks` of the
  members who can still earn it (the last message, and their open queue
  tasks, which Mark messaged closed until admin rebuild 2 removed it),
  `team_members`. The decided requests are read
  after the pending ones, and a request on both is kept once, decided.
  Then `buildThirtyView` (`src/lib/admin/thirty-view.ts`,
  pure), which calls the student app's rule (`discount.ts`,
  `discount-server.ts`) unchanged.
- **Produces:**
  - 200 `{ generatedAt, sharedDeadline, requiredCount, questions,
    requests, canStillEarn, unchecked }`, the types `ThirtyRequestRow`
    and `ThirtyEarnRow` in `thirty-view.ts` (PRD section 8, plus
    `ThirtyEarnRow.openTasks`, the student's open queue tasks oldest
    first, `{ id, scenarioId, summary, createdAt }`, and
    `unchecked`: how many members are left out of Can still earn because
    their progress could not be read). Since admin rebuild 2 the page
    shows no Can still earn, so `canStillEarn` and `unchecked` are sent
    and not shown. A pending row's `verdict` is the
    approve route's (`approvalVerdict`, then `explainOldCourseRequest`;
    the ads check after them is gone since 2026-10-20), and its facts are
    the ones that verdict judged. `StudentBrief` carries no ads tick
    since then. A pending row's `submissions` (its action items and their
    hand-ins) is still sent, and no page shows it.
  - 500 "Couldn't read the date of the course switch, so the 30% list
    was not made. Try again."
  - 500 "Couldn't read everything the 30% list needs, so nothing is
    shown. Try again." with `failed`. One student's unreadable progress
    is not a failure of the page: that row says there is no verdict.
- **Writes:** nothing. `maxDuration` 60, `force-dynamic`.
- **Rules its caller relies on:** the page decides through the existing
  routes (`POST /api/discounts/approve`, `/reject`, `/mark-applied`),
  which decide with their own read of the one student; this route only
  shows.

### `PUT /api/admin/config` (admin rebuild 2, D6)
- **What it is:** the one way the admin writes `admin_config`: the 2
  links the message templates fill in and the 4 automated-Discord
  switches. `GET /api/admin/config` (any team role) lists every row.
- **Called by:** the Templates page's Message settings panel
  (`src/components/admin/templates/MessageSettings.tsx`, through
  `templatesTransport.saveSetting`; WI-8, branch `night/a2-templates`),
  since `/admin/settings` was removed. It sends one key and its value per
  save; a switch as "true" or "false".
- **Consumes:** `{ key: string, value: string }`, founder and admin only
  (a csm gets 403).
- **Produces:**
  - 200 `{ row }`, the row as saved, with `updated_at` and `updated_by`
    (the login, never the body).
  - 400, with nothing written: "Missing key"; "The course switch date is
    set by the switch and cannot be changed here." for
    `curriculum_reset_at`; "Only the 2 message links and the 4 Discord
    switches can be changed here." for any key outside
    `EDITABLE_CONFIG_KEYS` (`src/lib/admin/config-keys.ts`:
    `program_login_link`, `discord_invite_link`, `dms_master_enabled`,
    `day28_dm_enabled`, `engagement_alerts_enabled`,
    `csm_task_summary_enabled`); "The new value must be text." for a
    missing, null, number or boolean value; 'A Discord switch is either
    "true" or "false".' for a switch set to anything else.
  - 404 "This setting has no row in the database, so nothing was saved."
    for one of the 6 with no row (it makes none).
  - 500 "Couldn't save the setting. Try again." when the write fails,
    the database's words in the server log only.
- **Writes:** one `admin_config` row's `value`, `updated_at`,
  `updated_by`.

### The Templates, Survey, Team and Insights pages (admin rebuild 2, WI-8 and WI-9)
- **Branch:** `night/a2-templates`, not on production.
- **Templates (`/admin/templates`):** reads, with the team member's
  client, `templates` (`*`), `regions`, `lessons`,
  `admin_config.curriculum_reset_at` and the 6 keys of
  `src/lib/admin/config-keys.ts` (`loadTemplatesData`,
  `src/lib/admin/templates-data.ts`), and `GET /api/admin/templates/stats`.
  Writes through `PUT /api/admin/templates/:id` (the fields that changed,
  or `{ is_active }` alone), `POST /api/admin/templates` (a custom
  template), `DELETE /api/admin/templates/:id` (a custom one only: 400
  "A built-in template can't be deleted. Only a custom one can." for a
  built-in, 404 for an id that is not there) and `PUT /api/admin/config`.
  A failed read of the templates fails the page with Retry; a failed read
  of the course, the catalog or the settings leaves the templates shown
  and says why where it is needed.
- **Survey (`/admin/feedback/survey`):** reads
  `discount_feedback_questions` and `discount_feedback_responses` paged on
  `id`, then `discount_requests` (`id, student_id, status, created_at`) and
  `students` (`id, name, email`) by id, at most 100 ids per `.in()`
  (`loadSurveyData`, `src/lib/admin/survey-data.ts`). Any failed read
  fails the page with what failed. Writes nothing.
- **Team (`/admin/team`):** the existing founder-only routes,
  unchanged: `GET`/`POST /api/admin/team-members`, `PATCH`/`DELETE
  /api/admin/team-members/:id` (`src/lib/admin/team-transport.ts`).
- **Insights (`/admin/insights/progress`):** reads
  `daily_progress_snapshots`, `students`, `student_milestones`, `lessons`
  (a count) and `student_progress_counts` with the page's own filters
  (`src/lib/admin/insights-data.ts`), the long reads paged on a unique
  key; a failed read is `{ ok: false }` and its card says so. Writes
  nothing.
- **Proven** on stand-ins: `client-tests/templates-page.test.mjs`,
  `survey-page.test.mjs`, `team-page.test.mjs`, `insights-page.test.mjs`
  (the loaders on `stub-server.ts`'s database capped at 1000 rows a read
  and shuffled, the transports through copies of the real routes with the
  real `requireTeam` where the route has one, the components rendered by
  React's server renderer), and `world-tests/admin-pages.mjs --only
  templates,survey,team,insights` on the dev pages. **Unproven:** a team
  login against production's rows.

### Proven and unproven
- **Proven** on stand-ins: `client-tests/admin-routes.test.mjs` (until
  admin rebuild 2 `admin-today-routes.test.mjs`, with Today's routes)
  runs both handlers with the real `requireTeam` on a stand-in database
  capped at 1000 rows a read: for the 30% route 401, 403 and 200 by
  role, the answer equal to the loader and builder run at the same
  moment, nothing written, every failure in plain words; for the config
  route each of the 6 keys saved by a founder and an admin with who and
  when, every refusal above with nothing written and no update sent, a
  csm, a student and no token refused, a missing row and a failed write
  in plain words (run against the route before the limit, 12 of its
  checks fail). `thirty-view.test.mjs` proves the bulk 30% equal to the
  student app's one-student path on every fixture, past 1000 rows;
  `world-tests/admin-pages.mjs` renders the 30% page with made-up data
  and holds every error sentence the route suite gets back to the words
  above.
- **Unproven:** real PostgREST paging over about 1,000 members, the
  time the reads take on Vercel with the database in another region, and
  production's own rows. The owner's read-only spot check
  (`supabase/diagnostics/admin-today-spotcheck.sql`, section 30 of
  `supabase/migration-tests/run.mjs`) compares 5 random members' numbers
  with the 30% page.
---

## The world's in-memory contracts (branch `world-engine`)

TypeScript shapes passed between modules in the browser. Nothing here
is stored. Each has one writer. The path from the database to the map
is: `GET /api/student/data`, `StudentContext`, `useWorldCatalog()`,
`buildMapModel()`, `sourceData()`, `WorldMap`, `WorldV6`. The last
three entries belong to the lesson player: `LessonTransport`, the
watch heartbeat, and the messages it trades with Tella's frame.

### `MapModel` (`src/lib/world/map-model.ts`)
- **Written by:** `buildMapModel()` and nothing else.
- **Built from:** `{ areas, lessonsByArea, completedLessonIds,
  watchedLessonIds, anyLessonFinishes? }`: the catalog's areas in route
  order, its lessons per area, the student's completed lesson ids, the
  ids whose watch half is in (`StudentContext.watchedLessonIds`:
  `completed_at` set), and (the dev page's placeholder course only,
  `AnyLessonFinishesContext` in `useMapModel.ts`) whether every lesson
  can be finished there.
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
    passed: boolean;
    hasVideo: boolean;
    finishable: boolean;
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
  catalog does not have exactly eight areas. `finishable` is true for
  a lesson the student can finish in the app: a `watch` lesson with a
  video, or an action item (`requires_action`); for every lesson when
  no lesson of the catalog has a video (a failed read of the videos
  looks the same) or `anyLessonFinishes` is set. `passed` is true for
  a done lesson, and for an action item that is a `watch` lesson once
  its watch half is in (`watchedLessonIds`: watched in the app or
  synced from Whop) while its hand-in is still open (`isPassed()`,
  2026-10-19); a setup action item has no watch half, so it is passed
  only once done. `done`, every count and whether a place is done
  never read `passed`. `place` is the index of the first area with a
  counting lesson that is `finishable` and not `passed`, and
  `placeNext` the index of the first such lesson there (the second
  Loom, 2026-10-16: a lesson with no video never holds a student, and
  still counts in every total; 2026-10-19: nor does an action item
  whose video is watched). When only other lessons are left, `place`
  is the first area with any lesson left and `placeNext` its first
  undone lesson (an open hand-in, or a lesson with no video).
  `LessonScreen` lights "Next lesson" by the same `isPassed()`. `place` is 8 and
  `placeNext` -1 when none is left. `minutes` is null when the catalog has no `duration_seconds`,
  otherwise whole minutes with a floor of 1. `hasVideo` is true only
  for a `watch` lesson whose `has_video` is true (the boolean
  `GET /api/student/data` attaches). The model holds no video id.

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
  lesson count, titles, action items, the lessons that are not
  `finishable` (`unrecorded`: the map says "Not recorded yet" there)
  and feature row from the model. `study.finished` and
  `study.progress` count the places finished in a row from the start,
  which can be fewer than `study.place`.
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
  opens. A load that failed arrives as `error` (T-026, 2026-10-20):
  `GET /api/student/data` answers 500 when one of its reads fails, and
  `StudentContext` asks a failed first load twice more (after 1 s and
  3 s), then sets `loadError`. Any refresh answered after that loads
  everything and clears it. `empty` is a course with no places or no
  lessons.

### `LessonTransport` (`src/lib/world/lesson-transport.ts`)
- **What it is:** the three calls the lesson player makes (the
  address, the heartbeat, the completion), behind one interface, so a
  test or the development harness can stand in for the server.
- **Written by:** `realLessonTransport`, in the same file, and nothing
  else in the app. `/world` gets it behind the page's embed cache
  (`withEmbedCache` in `src/lib/world/embed-cache.ts`, handed out by
  `useLessonTransport()` in `src/lib/world/useLessonTransport.ts`).
  The development harness under `/dev/world-app` provides a stand-in
  of its own (`fixtureTransport.ts`) behind the same cache, which no
  student route can reach.
- **Read by:** `LessonPlayer`, which receives it through
  `LessonScreen`, and the map's host `WorldMap`, which asks for a
  lesson's address before the click (`prefetch`) into the same cache.
  A `ready` address is kept, so the lesson page's own ask is answered
  without a request, but never past the right to it: the cache empties
  itself when the signed-in student changes or signs out, when
  `students.membership_status` (AuthContext's `student`) is anything
  but `"active"`, and when its oldest address is 30 minutes old.
- **Shape:**
  ```ts
  export type EmbedAnswer =
    | { ok: true; embedUrl: string }
    | { ok: false; kind: "not-recorded" | "blocked" | "error"; message?: string };

  export interface ClaimAnswer {
    completed: boolean;
    reason?: string;
    playedRatio?: number;
    playedFloor?: number;
    newAchievements?: string[];
  }

  export interface LessonTransport {
    getEmbed(lessonId: string): Promise<EmbedAnswer>;
    heartbeat?: WatchHeartbeatOptions["rpc"];
    claim(lessonId: string): Promise<ClaimAnswer | null>;
  }

  export const realLessonTransport: LessonTransport;
  ```
- **Rules its reader relies on:** neither `getEmbed` nor `claim`
  throws; a failure comes back as an answer. `getEmbed` of the real
  transport calls `POST /api/student/lesson-video`: a 403 is `blocked`,
  any other failure whose body has `notRecorded` is `not-recorded`,
  and everything else is `error` with a message to show. `heartbeat`
  left undefined means the real
  `supabase.rpc("record_lesson_heartbeat")`; when one is given, the
  heartbeat module creates no Supabase client. `claim` of the real
  transport calls `POST /api/student/lesson-watched` and returns null
  when the request failed. The player shows nothing for a null and
  makes the request again when its 10 seconds between claims are up,
  three times at most, and starts that count again on the next
  heartbeat past 95%.
  A refusal is `completed: false` with the route's `reason`; the
  player shows its "not marked as watched" line only for
  `played_short` with both `playedRatio` and `playedFloor` present.
  The interface itself did not change with decisions D14 to D19.

### The watch heartbeat (`src/lib/world/watch-heartbeat.ts`)
- **What it is:** the object that turns the player's position reports
  into calls to `record_lesson_heartbeat`, and the answers it hands
  back to its caller.
- **Written by:** `createWatchHeartbeat()` and nothing else. It is the
  only code that calls the database function.
- **Read by:** `LessonPlayer`, which feeds it `tick` and `flush` and
  reads every answer through `onResult`
- **Shape:**
  ```ts
  export interface HeartbeatResult {
    accepted: boolean;
    reason?: string;
    max_position_seconds: number;
    last_position_seconds?: number;
    watched_seconds: number;
    duration_seconds?: number | null;
    threshold_met: boolean;
    threshold_crossed: boolean;
  }

  export interface HeartbeatBeat {
    reason: string;      // "throttle", or the reason handed to flush()
    force: boolean;
    repeated?: boolean;  // nothing was sent; the last accepted answer again
  }

  export interface WatchHeartbeatOptions {
    lessonId: string;
    durationSeconds?: number | null;
    onResult?: (result: HeartbeatResult, beat: HeartbeatBeat) => void;
    onThresholdCrossed?: () => void;
    rpc?: (args: {
      p_lesson_id: string;
      p_position_seconds: number;
      p_reported_duration: number | null;
      p_delta_seconds: number;
      p_force: boolean;
    }) => Promise<{ data: HeartbeatResult | null; error: unknown }>;
    now?: () => number;
  }

  export interface WatchHeartbeat {
    tick(positionSeconds: number, playerDuration: number | null): void;
    noteSeek(positionSeconds: number): void;
    flush(reason: string): void;
    destroy(): void;
  }

  export function createWatchHeartbeat(opts: WatchHeartbeatOptions): WatchHeartbeat
  ```
- **Rules its caller relies on:**
  - `onResult` has a second argument since 2026-10-12. `beat.reason`
    says which beat the answer belongs to: `throttle` for a routine
    one, or the reason given to `flush` (`LessonPlayer` uses `pause`,
    `ended`, `visibilitychange`, `pagehide`, `unmount`). A retry keeps
    the reason of the beat it retries. `LessonPlayer` reads
    `beat.reason === "ended"` to know the answer is about the end of
    the video.
  - A forced beat with nothing new to say since the last accepted
    beat sends nothing, and `onResult` gets that last accepted answer
    again with `beat.repeated` true. With no accepted beat yet, it is
    sent. The caller must not act twice on a repeated answer;
    `LessonPlayer` uses it only for the "finished but didn't register"
    line.
  - A routine beat goes out once per 15 seconds of reports, and the
    first report writes at once. A beat asked for while another is on
    its way is queued when it is forced and dropped when it is routine.
  - A forced beat whose call fails or throws, or that the 400 ms call
    gate holds back, is sent again after 2, 5 and 10 seconds and then
    given up. Each retry carries whatever is banked by then. A beat
    that lands, or `destroy()`, ends the retries. A routine beat that
    fails sets no timer: the throttle sends the next one.
  - Any completed call moves the throttle clock, a failed one
    included, so a database call that keeps failing is tried every 15
    seconds. A refused or failed beat keeps its played seconds banked,
    and the next beats carry them.
  - A beat carries at most what v100's `record_lesson_heartbeat`
    credits one: 20 seconds of played time until a beat of this visit
    has been accepted, 60 seconds after (`FIRST_BEAT_DELTA_S` and
    `MAX_BEAT_DELTA_S`; the same numbers live in the migration, and
    changing one without the other is a bug). The rest stays banked.
    Since 2026-10-20 (lessons-1).
  - On an accepted answer only what it shows was credited leaves the
    bank: its `watched_seconds` less the last accepted answer's. The
    first accepted answer counts what it carried, and one whose
    `watched_seconds` is not a number counts the whole beat. The server
    also credits no more than 2.5 times the clock since the beat it
    stored before, so after a run of failed beats the backlog goes out
    over the next beats instead of leaving the bank uncredited. Before
    this a lesson watched through a minute or two of failed beats was
    refused at the end ("Skipped parts don't count.").
  - Nothing is written before a position has been reported.
  - Played seconds are counted as an allowance that carries over:
    each report adds 2.5 times the clock seconds since the last one to
    a budget capped at 5.35 seconds, and a forward step counts when it
    fits in the budget, which it then uses up. The budget starts at
    0.35 seconds with the first report and after `noteSeek`. `noteSeek`
    has no caller today.
  - A callback that throws does not stop the heartbeat and is not
    taken for a failed beat.
- **Proven and unproven:** `client-tests/watch-heartbeat.test.mjs`, 91
  checks on 2026-10-12, runs this file from the real source with a
  stand-in for the database call and the clock; since 2026-10-20 its
  stand-ins answer an accepted beat with the row's running total, as
  v100 does. `client-tests/watch-heartbeat-credit.test.mjs` (15
  checks, 2026-10-20) gives the heartbeat a stand-in with v100's own
  arithmetic and asserts on what was credited, judged by the real
  `judgeWatch`: lessons watched at 1x through 2 and 3.5 minutes of
  failed beats are credited in full, and so is 600 s at 2x through a
  minute of them; healthy watches at 1x to 2.5x are credited once. At
  2.5x the server's clock rule leaves no room to make up a backlog
  while the video plays (75.7% at the end of a 370 s lesson after 45 s
  of failed beats); the heartbeat keeps it for a later beat (91.9% once
  the tab is hidden), and closing that fully needs a change to the
  SQL, which is Lovro's call. Neither suite has ever called the real
  database function on production.

### The Tella player messages (`src/lib/world/tella-player.ts`)
- **What it is:** what Tella's player and the lesson page say to each
  other over `postMessage`. Three messages come in and three commands
  go out. Measured on Tella's real player on 2026-10-12 (the
  tella-player PRD, validation rows 1 to 6).
- **Written by:** the messages are written by Tella's player, inside
  the iframe on `https://www.tella.tv`, and by nothing else:
  `attachTellaPlayer()` drops any message unless `e.origin` equals
  `TELLA_ORIGIN` and `e.source` is that iframe's own window. The
  commands are written by `attachTellaPlayer()` and nothing else, and
  are posted to `TELLA_ORIGIN` only.
- **Read by:** `parseTellaMessage()` (pure), then
  `attachTellaPlayer()`, which hands them to `LessonPlayer` as
  `onReady`, `onState` and `onTimeUpdate`. Tella's player reads the
  commands.
- **Shape:**
  ```ts
  export type TellaState =
    | "idle" | "playing" | "paused" | "stopped" | "seeking" | "stalled";

  // In, from Tella's player. An object or a JSON string.
  export type TellaMessage =
    | { type: "ready" }
    | { type: "playbackState"; state: TellaState; currentTime: number | null; duration: number | null }
    | { type: "timeUpdate"; currentTime: number; duration: number | null };

  // Out, to Tella's player.
  //   { type: "play" }   { type: "pause" }   { type: "seek", time: number }

  export interface TellaPlayerEvents {
    onReady?: () => void;
    onState?: (state: TellaState, seconds: number | null) => void;
    onTimeUpdate?: (seconds: number, duration: number | null) => void;
  }

  export interface TellaPlayerHandle {
    play(): void;
    pause(): void;
    seekTo(seconds: number): void;
    destroy(): void;
  }

  export function parseTellaMessage(data: unknown): TellaMessage | null
  export function attachTellaPlayer(iframe: HTMLIFrameElement, events: TellaPlayerEvents): TellaPlayerHandle
  ```
- **Rules its readers rely on:** `timeUpdate` comes every 250 ms while
  the video plays, with a step of 0.25 s at 1x, 0.50 s at 2x and 0.62 s
  at 2.5x; the heartbeat's rule is built on those numbers. `ready`
  came 0.8 to 3.8 s after the frame was put on the page, before the
  frame's own `load` event in 20 of 21 measured loads, and is passed
  on once. No `timeUpdate` arrives before play. The end
  is a last `timeUpdate` just short of the duration, then
  `playbackState` `stopped` carrying `duration: 0`, so a duration of 0
  or less is read as null and never replaces the last real one.
  The page does NOT take the word `stopped` for the end of the video:
  on one replay the real player's last message was `paused` at the end
  position and no `stopped` followed. A `stopped` or a `paused` is the
  end when both its own position and the last position reported are
  within 1.5 s of the player's own last reported length (never the
  catalog's, which is the thing that may be wrong). That one forces a
  heartbeat with the reason `ended`, and the answer to that beat
  decides whether the "finished but didn't register" line shows. A
  `stopped` or `paused` anywhere else forces an ordinary heartbeat. A
  video Tella refuses sends no message at all, which is why the page
  waits 12 seconds from the moment the frame is on it and reads
  silence as "didn't load". No "seeked"
  message was seen: a skip showed up as `stalled`, `playing` and then
  one large step between two `timeUpdate`s. A `timeUpdate` with no usable position is dropped
  whole, and an unknown type or state parses to null. A `seekTo`
  before `ready` is held and sent when `ready` arrives, and a seek
  sent after `ready` does not start playback: when play is pressed,
  playback starts there (measured against the real player). The real
  player also sends `pointerDown` on a click inside it, which parses
  to null.
  `seeking` is in the type and was not among the states seen in the
  measurement.
- **Proven and unproven:** the component met Tella's real player in
  the development harness on 2026-10-12, and all nine rows of
  `world-tests/tella-watch.mjs` passed, also on the code as it stands
  after decisions D14 to D19 (`PASS 9  FAIL 0  NOT COVERED 5`, 23:38 to
  23:45). It has never run through a real login, on another
  browser or device, or in a background tab. Tella can change a
  message name without notice; that script is the check written to
  catch it.

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
