# v75 changelog — June 2026 admin stabilization

A multi-day push that reshaped how the admin tracks the launch cohort.
Read this top-to-bottom before making structural changes to admin
metrics, sync logic, or CSM tasks — many of the v75 commits established
invariants that look arbitrary but are load-bearing.

Latest: **v75.58** — June 11 2026 (v75.53 `first_paid_at` sync self-heal,
v75.54 backfill `CRON_SECRET` trim, v75.55–.58 audit must-fixes: token
leak, pagination caps, NA-task anchor unification, no-fallback writes).

## TL;DR — invariants now true

1. **Launch cohort is the only admin view.** Every metric on `/admin/*`
   filters to `first_paid_at >= '2026-05-25'`. The scope toggle that
   existed v75.13–v75.50 was removed in v75.51. **Do not re-introduce
   an "all members" mode without explicit discussion.**

2. **`first_paid_at` is THE foundation field.** Drives cohort filtering,
   discount eligibility, M2 conversion, sprint-window math, and the
   day-N counter on student-facing screens. NEVER moves on renewal.
   **NULL is treated as out-of-cohort everywhere — no `joined_at`
   fallback** (the fallback was the leak that motivated v75.18–v75.42).

3. **`isLessonComplete` is the canonical "done" formula.** Lives in
   `src/lib/progress.ts`. Skipped lessons count as done. The
   `student_progress_counts` view, the snapshot cron, the rebuild RPC,
   `buildStudentSnapshot` in csm-triggers, and the admin dashboard
   all use this exact formula. **If you add a fourth completion-aware
   surface, route it through the view, not raw rows.**

4. **`canceled_at` = access ended. `cancel_scheduled_at` = intent to
   cancel, still has access.** They are different columns with
   different semantics. **Do not stamp `canceled_at` when a student
   is in Whop's "Canceling" state** — it breaks the snapshot churn
   count, the M2 helper, and the journey kanban's churned column.

5. **All bulk fetches must use pagination.** PostgREST silently caps
   responses at ~1000 rows (project-level `max-rows`). Use
   `fetchAllRowsPaginated` from `src/lib/supabase-pagination.ts` for
   any admin surface that lists students, milestones, completions,
   tasks, or ratings. The cron-side equivalent is per-student
   batching (see check-csm-tasks completions fetch, v75.25).

6. **All 6 crons use `verifyCronAuth` + write to `cron_runs`.** Defends
   against `CRON_SECRET` whitespace drift (the silent-401 incident
   that motivated v75.37) and provides an audit trail separable from
   `sync_runs`. **If you add a new cron, wire both helpers — do not
   inline an `authHeader !== Bearer ${process.env.CRON_SECRET}`
   check.**

## Themes

### Cohort filter consolidation (v75.18 → v75.51)
Multi-week effort to switch every admin surface from `joined_at` to
`first_paid_at`. The journey was:
- v75.18: column added + initial filter switches
- v75.20: caught 7 more sites the audit missed
- v75.24/.25: cron snapshot logic alignment
- v75.26: NULL `first_paid_at` discount leak plugged + INSERT paths
  populate it
- v75.28: removed `joined_at` fallback in `isInLaunchCohort`
- v75.34: backfill endpoint for ~400 legacy NULL students
- v75.42: M2 helper restricted to launch cohort (98.5% noise → 0/0)
- v75.51: scope toggle deleted; cohort becomes only mode

### PostgREST row-cap (v75.25 → v75.48)
Same bug class hit 5 times: bulk fetches silently truncated at
~1000 rows.
- v75.25: per-student fetch in check-csm-tasks (the milicevic incident)
- v75.27: 5 admin pages paginated
- v75.32: pagination error contract — empty data on error, not partial
- v75.45: insights useBountyInsights identified as same class
- v75.48: dashboard milestones fetch (the 16 vs 65 gap Karlo caught)

### Discount integrity (v75.26 + v75.31)
- v75.26: NULL `first_paid_at` blocks claim at all 4 gates (request,
  submit-feedback, approve, UI)
- v75.31: all 5 routes require auth (was anonymous) — `/approve`
  could mint Whop promo codes anonymously before this
- v75.35: discounts page UI sends Bearer token to the v75.31 routes
  (the bug Karlo saw)

### M2 conversion (v75.38 + v75.42 + v75.47)
- v75.38: canonical `isMonth2Converted` helper centralized; deleted
  unused `/api/admin/kpis` route
- v75.42: launch-cohort restriction (excludes legacy customers' M1→M2
  transition noise — was reading 98.5%)
- v75.47: Canceling students excluded from numerator when scheduled
  cancel is on/before day 30

### Whop "Canceling" visibility (v75.46 + v75.47)
- v75.46: added `cancel_at_period_end` to `WhopMembershipRow`
  interface; v83 migration adds `students.cancel_scheduled_at`;
  sync runner stamps/clears it
- v75.47: amber "Canceling" pill on journey kanban + M2 helper update
- v75.49: dashboard "Canceling" tile (early-warning churn signal)

### first_paid_at population leak (v75.53)
The 91-NULL-`first_paid_at` finding (Jun 11): active paying students were
left `first_paid_at`=NULL — invisible to every cohort surface AND
uncovered by the CSM crons (NULL fails the `gte('first_paid_at', …)`
filters). 27 of the 91 joined post-launch and belonged in the cohort;
the most recent landed the same day, so it was live and accumulating.
- Root cause: the company sync (`fetchAllMemberships`) only fetches
  memberships under products in `WHOP_PRODUCT_ID`, so `_firstPaidAt`
  comes through null for students whose paying membership sits under a
  different product. The sync's UPDATE branch only heals NULL when it
  computed a date, so those stayed NULL forever. The v75.34 backfill
  (cross-product per-user lookup) was the ONLY path that fixed them —
  a one-time job, so new arrivals kept leaking.
- Fix: extracted the per-user cross-product lookup into
  `fetchEarliestMembershipDateForUser` in `whop-members.ts` (reused by
  the backfill), and added a bounded (cap 25), throttled (200ms),
  time-budgeted (240s) recovery pass to `runWhopCommunitySync` that
  fills NULL `first_paid_at` for active paying students each run. Guards:
  `.is('first_paid_at', null)` (never moves a set value), skips entirely
  when an upsert batch failed, counts only real fills.
- NOT closed for students on a paid plan outside `PAYING_WHOP_PLAN_IDS`
  (treated as non-paying platform-wide until the plan is allowlisted).

### Cron audit + auth hardening (v75.37)
- New `src/lib/cron-auth.ts` helper
- New `cron_runs` audit table (v82 migration)
- All 6 cron routes updated to use shared verifyCronAuth (whitespace-
  trimmed) + log start/finish

### Insights page (v75.45 → v75.50)
- v75.45: aggressive trim from 1637 → 230 lines (deleted 4 MetricCards,
  PaceBreakdownCard, BountyAccessCard, range controls, CalcTransparency,
  /api/admin/insights/progress route)
- v75.50: restored after Karlo asked for them back ("I don't think I
  specified at any point in time to remove everything"). Now cohort-
  only from the start, no scope toggle ever needed, paginated
  bounty fetch, no Joined card (consistent with v75.43 dashboard).

## Database migrations applied during v75 (cumulative)

| Version | What it does |
|---|---|
| v77 | Cohort columns on `daily_progress_snapshots` + `sync_runs` audit table + students.canceled_at |
| v78 | `security_invoker = on` on student_progress_counts view (Supabase Advisor critical fix) |
| v79 | `students.whop_plan_id` for paying/free classification |
| v80 | `students.first_paid_at` + `rebuild_daily_snapshots` RPC update |
| v81 | Canonical isLessonComplete formula in view + RPC (l057 excluded everywhere) |
| v82 | `cron_runs` audit table |
| v83 | `students.cancel_scheduled_at` |

**RUN ORDER:** apply in numeric order. Each is idempotent (CREATE TABLE
IF NOT EXISTS, CREATE OR REPLACE VIEW, etc).

## Files added in v75

- `src/lib/supabase-pagination.ts` (v75.27)
- `src/lib/cron-auth.ts` (v75.37)
- `src/lib/csm-task-evaluation.ts` (v75.21) — real-time auto-dismiss
- `src/app/api/admin/refresh-everything/route.ts` (v75.22) — one-button
  full refresh (sync + rebuild + 3 CSM crons)
- `src/app/api/admin/backfill-first-paid-at/route.ts` (v75.34) —
  one-time backfill endpoint; supports CRON_SECRET fallback auth

## Files DELETED in v75

- `src/contexts/AdminScopeContext.tsx` (v75.51)
- `src/components/admin/ScopeToggle.tsx` (v75.51)
- `src/app/api/admin/kpis/route.ts` (v75.38) — unused; M2 centralized
- `src/app/api/admin/insights/progress/route.ts` (v75.45) — page
  fetches direct from client now

## Common pitfalls — read this if you're about to:

### Add a new admin surface
1. NO scope toggle. Filter `gte('first_paid_at', ADMIN_STUDENT_JOIN_CUTOFF)`
   unconditionally.
2. Filter `in('whop_plan_id', PAYING_WHOP_PLAN_IDS_ARRAY)` for any
   "paying members" query.
3. Wrap ALL bulk fetches in `fetchAllRowsPaginated`.
4. Read completion counts from `student_progress_counts` view, NOT
   from raw `student_lesson_completions` rows.

### Add a new metric
1. Add a canonical helper to `src/lib/admin/metrics-definitions.ts`.
   Look at `isMonth2Converted` / `isCanceling` for the pattern.
2. Use the helper everywhere — never inline the predicate.
3. If the metric reads `first_paid_at`, NULL must short-circuit to
   false. NO `?? joined_at` fallback.

### Add a new cron
1. Use `verifyCronAuth` + `logCronStart` + `logCronFinish` from
   `src/lib/cron-auth.ts`.
2. Set `export const maxDuration = 300` if the cron does any
   per-student work.
3. Add the route to `vercel.json`.
4. Document in CONTEXT.md "Cron Jobs" table.

### Add a new column to `students`
1. STOP. Read CLAUDE.md "Table-level bounded contexts." If the column
   represents a function (a behavior, a state, a milestone), it
   probably belongs in a sibling table.
2. If it really does belong on students (identity / admin flag),
   document it in `system_contracts.md` under "Stable contract."
3. Update `Student` interface in `src/types/database.ts`.
4. Update `ExistingRow` type + select string in `whop-sync-runner.ts`
   if the sync runner needs to read it.

### Touch the M2 conversion helper
1. Both `isMonth2Converted` AND `isInMonth2Cohort` must move together
   — numerator and denominator stay coherent.
2. The launch-cohort gate is non-negotiable (pre-launch customers
   inflate the metric to 98.5% — see v75.42 commit message).
3. Add a unit test if changing boundary logic (the 30-day window).

### Touch sync-whop / whop-sync-runner
1. `first_paid_at` is `min(membership.created_at)` across all of a
   user's memberships. Never overwrite a populated value on UPDATE.
2. `canceled_at` only stamps on TRANSITION into terminal status, not
   while the student is still in `cancel_scheduled_at` limbo.
3. The existing-row pre-fetch batches in chunks of 500 (URL-cap
   defense) and THROWS on batch error (v75.32) — don't silently
   continue with partial existing map.

## Verification SQL pack

If you suspect any v75 invariant is violated, these queries diagnose:

```sql
-- Are there cohort students still with NULL first_paid_at?
-- Expected: 0. v75.34 backfill clears the backlog; v75.53 sync
-- self-heal keeps it at 0 as new members arrive. A non-zero result
-- now means either a plan outside PAYING_WHOP_PLAN_IDS (expected —
-- not recovered until allowlisted) or the sync hasn't run since they
-- joined (run the backfill or wait for the next sync).
SELECT count(*) FROM students
WHERE first_paid_at IS NULL
  AND membership_status IN ('active','past_due')
  AND whop_plan_id IN ('plan_4ZrwR4PmBsVsx', 'plan_fMMqxAljrzu75');

-- Are Canceling students being tracked?
-- Expected: count > 0 if any cohort members have cancel-clicked.
SELECT count(*) FROM students
WHERE cancel_scheduled_at IS NOT NULL
  AND membership_status IN ('active','past_due');

-- Did every cron fire today?
SELECT route_name, max(started_at) AS last_fired
FROM cron_runs WHERE started_at >= now() - interval '24 hours'
GROUP BY route_name ORDER BY last_fired DESC NULLS LAST;
-- Expected: 6 rows (all routes), most within the last few hours.
-- If only 1-2 routes, scheduler likely broken (rotate CRON_SECRET
-- + redeploy main).

-- Does the dashboard "active count" match the SQL truth?
SELECT count(*) FROM students
WHERE membership_status IN ('active','past_due')
  AND whop_plan_id IN ('plan_4ZrwR4PmBsVsx', 'plan_fMMqxAljrzu75')
  AND first_paid_at >= '2026-05-25'
  AND whop_membership_id IS NOT NULL;

-- Does dashboard avg_progress match the snapshot?
SELECT snapshot_date, avg_progress_cohort
FROM daily_progress_snapshots WHERE snapshot_date = current_date;
-- Then open /admin and compare the "Avg progress" tile.
-- After v75.28+v75.38 they should match by construction.
```

## What is NOT yet done

These are real but were explicitly deferred:

- **v75.40 dismissal logic refactor — PARTIALLY addressed by v75.57.**
  The stalled.\*.dayN flicker (anchor mismatch between NA creation and
  3c dismissal) is fixed. STILL OPEN, in scope for the full refactor:
  (a) pace.\*/nolessons.\* day-window triggers conflate "should I fire"
  with "does the problem still apply", so 3c/real-time re-eval can
  dismiss them as "trigger no longer met" when only the day window
  closed; (b) stalled.\* tiers progress via fresh NA-cron inserts, NOT
  3b family supersession (3b only sees the CSM cron's own inserts), so
  retirement of an old stalled tier is 3c staleness by design — day3
  and day5 can briefly coexist open; (c) OWNER DECISION PENDING: the
  terminal stalled.\*.day10 task is auto-dismissed by 3c once day > 13
  even if Astrid never actioned it — decide whether the highest tier
  should be exempt from 3c's day-tolerance path.

- **Day-28 DM timing precision.** Anchored on wall-clock time, not
  UTC midnight. Students who paid late in the UTC day can miss
  their day-28 firing. Affects maybe 1-3 students per launch
  cohort.

- **`/api/student/data` leaks `quiz_questions.correct_index`.** Quiz
  scoring is server-side post-v75.31, but the answer key still
  ships to the client (and is also readable via direct RLS query).
  Karlo explicitly accepted this risk 2026-06-11 ("if they're that
  determined, that's on them") — scores can't be faked either way.
  Don't re-raise unless the gate semantics change.

- **Dashboard "Canceling" tile has no historical sparkline.** Column
  is too new (v75.46). After ~14 days of sync runs, add a snapshot
  column for the historical signal.

## Index of v75 versions

| v | Date | What |
|---|---|---|
| v75.13–.17 | May | Scope toggle (now deleted), family supersession |
| v75.18 | Jun 8 | `first_paid_at` column + every operational filter switched |
| v75.19 | Jun 8 | Auto-dismiss orphan tasks (cron section 3c) |
| v75.20 | Jun 8 | 7 more `joined_at` → `first_paid_at` sites caught |
| v75.21 | Jun 8 | Real-time auto-dismiss helper (csm-task-evaluation.ts) |
| v75.22 | Jun 8 | One-button refresh (`/api/admin/refresh-everything`) |
| v75.23–.25 | Jun 8 | PostgREST row-cap incidents (milicevic case) |
| v75.26 | Jun 9 | NULL `first_paid_at` discount leak plug + INSERT paths |
| v75.27 | Jun 9 | 5 admin surfaces paginated |
| v75.28 | Jun 9 | Snapshot cron canonical formula alignment + v81 RPC |
| v75.29 | Jun 9 | check-csm-tasks open-tasks paginated |
| v75.30 | Jun 10 | Whop webhook 500-on-DB-error + self-heal `first_paid_at` + skip-lesson validation |
| v75.31 | Jun 10 | Discount routes require auth + region quiz scored server-side + journal page auth |
| v75.32 | Jun 10 | Pagination error contract + sync/engagement error surfacing + maxDuration + NA Discord toggle + insights hooks fix |
| v75.33 | Jun 10 | `save-action-link` UX fix (insert-or-update) |
| v75.34 | Jun 10 | `/api/admin/backfill-first-paid-at` endpoint |
| v75.35 | Jun 11 | Discounts page sends Bearer token |
| v75.36 | Jun 11 | Journey shows churned + pace `first_paid_at` + `canceled_at` proxy |
| v75.37 | Jun 11 | Cron shared auth helper + `cron_runs` audit (v82) |
| v75.38 | Jun 11 | `isMonth2Converted` canonical helper + deleted unused kpis route |
| v75.39 | Jun 11 | Journey strict cohort filter (372 legacy churns leak fixed) |
| v75.41 | Jun 11 | Hero KPI CSS emphasis |
| v75.42 | Jun 11 | M2 restricted to launch cohort (98.5% → 0/0 until Jun 24) |
| v75.43 | Jun 11 | Killed "Joined" tile + "Not activated" nav |
| v75.44 | Jun 11 | Bounty scope-aware + filter v50 legacy backfill |
| v75.45 | Jun 11 | Insights page trimmed 1637 → 230 lines |
| v75.46 | Jun 11 | `cancel_scheduled_at` column (v83) + sync runner stamps it |
| v75.47 | Jun 11 | Journey Canceling pill + M2 helper excludes Canceling |
| v75.48 | Jun 11 | Bounty milestones pagination fix (16 → 65) |
| v75.49 | Jun 11 | Dashboard Canceling tile |
| v75.50 | Jun 11 | Insights cards restored (cohort-only, no Joined) |
| v75.51 | Jun 11 | Scope toggle removed entirely |
| v75.52 | Jun 11 | Stale scope-comment cleanup |
| v75.53 | Jun 11 | `first_paid_at` sync self-heal — cross-product `fetchEarliestMembershipDateForUser` extracted + bounded recovery pass in the sync (closes the 91-NULL leak; the daily inflow now self-corrects) |
| v75.54 | Jun 11 | backfill route `CRON_SECRET` comparison now whitespace-trimmed (mirrors `verifyCronAuth`) — was the last inlined untrimmed `Bearer ${CRON_SECRET}` check; a trailing newline made it return "Invalid token" while the crons authenticated fine |
| v75.55 | Jun 11 | `/api/student/data` no longer ships Whop OAuth tokens — `student_whop_sync` read switched from `select(*)` to an explicit diagnostics-only column list (access/refresh tokens were readable in the browser network tab) |
| v75.56 | Jun 11 | three more PostgREST ~1000-row cap fixes: `/admin/students` progress-counts view read, `/admin/lessons` ratings read, and check-csm-tasks `tasks`+`student_milestones` bulk reads (raw `.limit(50000)` does NOT bypass the server cap) — all via `fetchAllRowsPaginated`, with error short-circuit in the cron |
| v75.57 | Jun 11 | canonical `sprintDayNumber` helper (constants.ts) — NA cron task CREATION, CSM 3c stale-DISMISSAL, snapshot day, and the /admin/not-activated page all share one day anchor (`first_paid_at`, ceil). Was: created on floor(created_at), dismissed on ceil(first_paid_at) → stalled.\*.dayN tasks for backfilled students flickered into existence and auto-dismissed within one cron window, silently neutralizing the NA pipeline. Note: floor→ceil means NA tiers + the day-10 high_churn_risk flag now fire ~24h earlier. Also: late-pool entrants at day 10–13 clamp to the day-10 tier (terminal touch + flag); day ≥ 14 entrants still get nothing (open question below) |
| v75.58 | Jun 11 | NO `joined_at` fallback writes to `first_paid_at` — backfill route + sync recovery pass leave NULL when Whop has no parseable membership date (retried every sync; we pull from Whop, no webhook dependency). Backfill UPDATE also gains the `.is(first_paid_at, null)` fill-only guard. Consequence to know: while a paying student's `first_paid_at` is NULL they receive ZERO NA/CSM outreach (NULL = out of every pool) — the H3 diagnostic query is the watchdog for that population |
| v75.59 | Jun 11 | **THE NULL-WIPE INCIDENT FIX.** postgrest-js bulk upsert computes `?columns=` as the UNION of keys across all rows in a batch, and PostgREST NULLs any unioned column a row omits on conflict-update — so the sync's "omit the key to preserve" pattern ERASED batch-mates' values. One afternoon of manual syncs NULLed `first_paid_at` on 638 active paying students (cohort vanished from every admin surface), `whop_plan_id` on 67, `cancel_scheduled_at` on ~48, and 3c then dismissed all open tasks as "no longer in eligible pool". This was ALSO the silent source of the creeping-NULL `first_paid_at` population all along. Fix: every upsert row now carries the IDENTICAL full column set, preserving by VALUE from the prefetched row; a tripwire aborts the sync on any non-uniform key set. NEVER reintroduce a conditional row key in `runWhopCommunitySync`. |
