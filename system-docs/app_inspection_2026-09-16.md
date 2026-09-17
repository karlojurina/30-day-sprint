# Whole-app inspection — 2026-09-16

> ## CORRECTION, 2026-09-16 (same day, after publication)
>
> **Several findings below are wrong.** They were derived from local `.env.local`, which holds
> `WHOP_PRODUCT_ID=plan_4ZrwR4PmBsVsx,plan_BIVTAaTBLVSaD` (two PLAN ids in a `product_id` slot).
> Production was afterwards read from Vercel and holds the real product id
> `prod_eE7r6SXa3H0MX`. The plan-ids-in-a-product-filter situation is a LOCAL-ONLY artifact.
>
> **Retracted, do not rely on any of these:**
> - "`students` is an account-wide mirror of the whole Whop account"
> - "widening PAYING_WHOP_PLAN_IDS turns 3,310 account rows into students"
> - "the sync pages the account twice, 1,000 requests, ~200s of sleep against a 300s ceiling"
> - "the product gate can never match because it compares `prod_` against `plan_`"
> - any figure derived from the 8,291 account-wide membership list
>
> **Verified true in production instead (live, 2026-09-16):** the sync is scoped to the course
> product and reads 3,881 of 3,881 memberships across 389 pages, inside the 500-page cap.
> Coverage is 100% and there is no blind spot. `per_page=` is still ignored, so it uses 389
> pages where 78 would do, leaving roughly 1,119 memberships of headroom before the cap
> truncates silently. Valid members by plan: `plan_4ZrwR4PmBsVsx` ($97/30d) 843,
> `plan_VFDntXQf9cYMo` ($700/365d) 32, `plan_fMMqxAljrzu75` ($970/365d) 7,
> `plan_S14vx1rNMBZdw` (free) 57.
>
> Individually affected findings are marked inline below. Findings not marked were not
> derived from the env var and stand as written. Nothing here is deleted: the errors are
> part of the record.



**Method:** 27 agents over six areas of the platform; every critical/high
finding then attacked by an independent verifier instructed to refute it.
48 raw findings, 21 verified. **Every verdict returned PARTIAL** — no finding
survived at its claimed severity, and none was outright refuted. The mechanisms
are real; the consequences were consistently overstated. Where a verifier ran,
the severity below is the CORRECTED one and the original is shown beside it.

**Read-only.** No network calls, no DB access — local Supabase credentials are
placeholders. Code reading plus live Whop facts established earlier this week.
Anything needing a live check to settle says so.

Excluded on purpose: the six already-known defects, except where this pass
quantifies their present cost; and /admin/etfb, which had three passes already.

---

## CRITICAL  (2)

### Cancelled students keep dashboard access forever: the "surviving membership" check has no product or plan gate

> **PARTLY RETRACTED.** The stated mechanism assumed the product gate could never match. In production it does match, and strategy 2's `product_id=` filter is honoured because the id is valid, so Apex and ETfB memberships cannot leak in. A narrower version of this finding SURVIVES and is still worth fixing: the gate checks the PRODUCT but not whether the PLAN is paid, and the course product carries a free plan (`plan_S14vx1rNMBZdw`, 57 valid members). A student who cancels the $97 while holding that free plan would still be read as entitled. Severity drops from critical; re-verify before acting.
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/app/api/webhooks/whop/route.ts:198 · fix: hours* · not independently verified

**What happens:** A student on plan_4ZrwR4PmBsVsx ($97/mo) cancels. Whop sends membership.deactivated. Line 198 calls fetchActiveMembershipForUser(user.id) to ask whether anything else still grants access. Strategy 2 (whop-members.ts:328-371) queries `?product_id=<id>&user_id=<id>`, and per the verified traps the product_id filter is silently ignored — and WHOP_PRODUCT_ID holds `plan_4ZrwR4PmBsVsx,plan_BIVTAaTBLVSaD`, which are PLAN ids, so it could never have matched a product anyway. Strategy 2 then applies NO product check of its own (whop-members.ts:340 filters on user only) and returns the first membership with valid=true. If that student also holds a free ecomtalent Apex membership (554 valid members) or the archived free ETFB plan (204 valid memberships), `surviving` is truthy. Line 203-211 then writes membership_status='active', canceled_at=null, and re-points whop_plan_id to the free plan. Strategy 1 and 3 do have a product gate, but it compares Whop's `prod_` values against the `plan_` values in WHOP_PRODUCT_ID, so it never matches either. The nightly sync does not correct it: fetchAllMemberships sees the same free membership, grantsAccess() returns true, and it re-confirms 'active' every run. The same unguarded call runs on every login at auth/whop/callback/route.ts:146.

**Cost:** A student who stopped paying keeps full dashboard access indefinitely (MembershipBlockOverlay reads students.membership_status, per the comment at callback/route.ts:139). Because whop_plan_id is now a free plan, they are simultaneously dropped from all 13 `.in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY)` read sites — admin dashboard, students list, insights, journey, not-activated, and all four CSM crons — so nobody ever sees them. canceled_at stays null, so the churn number Karlo reads under-reports the loss at the same time. Direct revenue leak, self-concealing.

**Fix:** Gate the surviving-membership decision on the plan, not on the product. Change the WHOP_PRODUCT_ID-based filter in fetchActiveMembershipForUser to a check against the live paid-plan set (the 46 paid plan ids from system-docs/whop_plan_inventory_2026-09-03.md), applied inside strategy 2 and 3 as well as strategy 1 — a membership only counts as 'surviving' if its plan is a PAID plan on a product we actually sell. Until the live plan read exists, the two-line stopgap is to reject any surviving row whose `plan` is not in PAYING_WHOP_PLAN_IDS, and log it rather than silently keeping the student active.

---

### A signed-in student whose token refresh fails is bounced to a bare /login with no explanation
*src/lib/supabase-browser.ts:121 · fix: minutes* · not independently verified

**What happens:** Student returns to /dashboard after an hour; the stored access token is past auth-js's 90s expiry margin, so getSession() refreshes. The refresh fails — a network blip, an auth-host 5xx, or the app's own 429→503 shim during its 60s cooldown (supabase-browser.ts:70-77). auth-js returns { data: { session: null }, error } (GoTrueClient.js:2361-2364). getSharedSession does .then(({ data }) => data.session) and discards the error. AuthContext.tsx:177-180 sees a null session, takes the branch commented 'Genuinely signed out. Not an error — no reason attached', and calls finish() with no reason. authError stays null, so StudentGuard.tsx:27-29 takes the else branch: router.replace('/login'). No code, no detail, nothing on screen.

**Cost:** This is the exact incident shape the workspace has chased for a month and recorded as unresolved: a correctly signed-in paying student lands on a clean login screen that looks identical to a normal logout, with zero diagnostic. The entire v85.11 authError mechanism was built to prevent this and it is bypassed on the single path that produces it. It also destroys the evidence needed to settle the open 'what makes a just-refreshed session read as expired' question — the AuthError object naming the real cause is thrown away one line before anyone could log it.

**Fix:** Make getSharedSession return the error, not swallow it: resolve to { session, error } (or reject when error is set and session is null), then in AuthContext's bootstrap pass that reason into finish() instead of calling the bare finish(). StudentGuard already routes any non-null authError to /login?error=profile_load_failed&detail=…, and login/page.tsx:106-107 already renders code + detail — so one change turns the silent bounce into a screenshot that names the cause. While there, log the same reason to /api/client-event so it lands in Vercel logs.

---

## HIGH  (13)

### The env inventory documents 10 of 23 vars, omits every secret, and lists one that no code reads
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/CONTEXT.md · fix: hours* · not independently verified

**What happens:** CONTEXT.md:518-526 is the repo's only env-var inventory. It names 10. The code reads 23 distinct `process.env.*` values. Undocumented and load-bearing: `WHOP_BYPASS_USER_IDS` and `WHOP_BYPASS_EMAILS`, which at callback/route.ts:58-74 skip the active-membership check entirely — an access bypass allowlist whose only mention in any doc is one parenthetical in PLATFORM_OVERVIEW.md:158, a file that is four months stale. Also undocumented: `STUDENT_AUTH_SECRET` (the HMAC deriving every student's Supabase password), `PKCE_COOKIE_SECRET`, `CRON_SECRET`, `ADBOUNTY_WEBHOOK_SECRET`, `WHOP_COURSE_ID`, `WHOP_DISCOUNT_PLAN_IDS`, `DISCORD_TEAM_WEBHOOK_URL`, `DISCORD_TEST_DM_RECIPIENT`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_KARLO_INTRO_VIDEO_URL`. In the other direction, `WHOP_CLIENT_SECRET` is documented as required and sits in .env.local, but zero code reads it — the OAuth flow is pure PKCE (whop.ts:27-33 and :317-321 send client_id and code_verifier, never a secret). And .env.local carries `DISCORD_WEBHOOK_URL`, a near-miss for the `DISCORD_TEAM_WEBHOOK_URL` the code actually reads, which is the concrete mechanism behind known item 5.

**Cost:** Two distinct harms. First, a provisioning or rotation pass driven off this table will miss STUDENT_AUTH_SECRET — and drift there locks out every student at once, because the deterministic password no longer matches. Second, the bypass allowlist is a documented-nowhere path to platform access without a paid membership; nobody auditing access can find it from the docs, and nobody reviewing it will know to check whether stale test accounts are still listed. The WHOP_CLIENT_SECRET entry actively misleads in the opposite direction: a login outage will send someone chasing a secret that has no consumer.

**Fix:** Replace the Integrations table's env column with a full inventory generated from `grep -rhoE 'process\.env\.[A-Z_0-9]+' src/`, grouped as required / optional, with one line each on what breaks when it is missing. Mark WHOP_CLIENT_SECRET as unused (PKCE flow) rather than deleting it silently. Give WHOP_BYPASS_USER_IDS / WHOP_BYPASS_EMAILS their own short subsection naming who is currently on them. Fix the DISCORD_WEBHOOK_URL / DISCORD_TEAM_WEBHOOK_URL name mismatch in .env.local.

---

### PLATFORM_OVERVIEW.md is Karlo's source of truth, four months stale, and wrong about the cohort filter
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/PLATFORM_OVERVIEW.md · fix: hours* · not independently verified

**What happens:** Header: "Last regenerated: 2026-05-12" against today's 2026-09-16 and v88. Line 617 states the operative rule for every number Karlo reads: "All admin views filter to `joined_at >= 2026-05-01`." The code filters on a different column and a different date — `constants.ts:150` sets LAUNCH_DATE = 2026-05-25 and `:159` aliases ADMIN_STUDENT_JOIN_CUTOFF to it, and every admin surface applies `.gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF)` (admin/page.tsx:127, insights/progress/page.tsx:1136 and :1540), with CONTEXT.md noting "NO joined_at fallback post-v75.28" precisely because the two diverge for returning customers. Section 5 documents 7 admin surfaces of which 2 are phantom (§5.5 `/admin/kanban`, which is `/admin/journey`; §5.7 `/admin/alerts`, which does not exist) and omits 11 live ones: tasks, tasks/insights, templates, stats, etfb, feedback/lessons, feedback/survey, insights/progress, discord, settings, team. Lines 126, 139 and 509 describe `hidden_rewards` / `student_rewards` as live schema tables. §1 says "Cron jobs run on Vercel on a daily schedule."

**Cost:** This is the doc CLAUDE.md hands Karlo for product decisions and KPI definitions, and CONTEXT.md's own header points to it for 'what each surface does for the user'. A founder reasoning about cohort size from 'joined_at >= 2026-05-01' will scope 24 extra days and the wrong population — joined_at moves on renewal, first_paid_at does not, so the two sets genuinely differ for every returning customer. Three of the four surfaces built since May (Stats, Brand Owners, Tasks Insights) are invisible in the only doc written for him.

**Fix:** Two separable moves. Immediately: correct line 617 to `first_paid_at >= 2026-05-25`, delete §5.5 and §5.7, and strike the reward-table paragraphs — that is the misleading half and takes minutes. Then schedule a real regeneration of §5 covering the 11 missing surfaces, or demote the file to an explicitly dated snapshot with a banner pointing to CONTEXT.md for anything after 2026-05-12.

---

### Five paginated scans page through unordered data — including the dashboard's students query and the nightly snapshot cron's progress read
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/app/admin/(authenticated)/page.tsx · fix: minutes* · not independently verified

**What happens:** fetchAllRowsPaginated issues one separate .range() round trip per 1000 rows (supabase-pagination.ts:63-89). Without ORDER BY, PostgREST/Postgres gives no guarantee the same rows land on the same pages between calls — and student_progress_counts is a GROUP BY view with no inherent order at all. Unordered multi-page scans: page.tsx:116-127 (students, no .order() whatsoever), page.tsx:144-149 (student_progress_counts), page.tsx:189-196 (student_milestones), snapshot-progress/route.ts:173-178 (student_progress_counts), useJourneyPaceCounts.ts:62-88 (students + progress counts + current_region, all three), insights/progress/page.tsx:1131-1137 and :1546-1553, journey/page.tsx:116-126. The repo wrote the rule down three times — students/page.tsx:76-79 ("Stable order required for .range() pagination — view output has no inherent order; without this, rows can be skipped across page boundaries"), feedback/lessons/page.tsx:96-100, outreach-insights.ts:225-227 — and applied it in only those three places. The view is known to exceed 1000 rows: that is exactly the v75.56 incident recorded at students/page.tsx:66-70.

**Cost:** Avg progress on /admin, the avg_progress and avg_progress_cohort values written to daily_progress_snapshots every night at 00:30 UTC, the Behind/On-pace/Ahead counts in the sidebar badge and on the insights Pace card, and the dashboard's totalStudents / activeStudents / Month-2 numerator and denominator / cancelingCount / bounty intersection can all silently double-count or drop students on any given load. The dashboard's students query is the worst of them: 1000+ rows, zero ordering, and the Whop sync is updating those same rows on a 2-hour cycle while the page pages through them. The error is a few percent and renders as a completely ordinary number — refreshing gives a slightly different one, which is precisely the "how is hitting Refresh changing the number?" complaint v81 was written to kill.

**Fix:** Add a stable, unique .order() to every fetchAllRowsPaginated thunk: .order("id") on students and student_milestones, .order("student_id") on student_progress_counts and student_current_region. One line each, eight call sites. Consider making fetchAllRowsPaginated refuse (or console.warn loudly) when the built query carries no order clause, so the next one can't be added without it.

---

### The snapshot cron silently writes joined=0 / churned=0 into the metrics history and calls it a success
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/app/api/cron/snapshot-progress/route.ts:201 · fix: minutes* · not independently verified

**What happens:** joinChurnCounts() runs four count queries in a Promise.all at line 201 and reads them at lines 236-239 as `joinAll.count ?? 0`. No `.error` is ever destructured or checked. If any of the four errors (RLS hiccup, connection blip, statement timeout), count is null and becomes 0. Those zeros go straight into the daily_progress_snapshots upsert at lines 287-317 for both yesterday and today, and then logCronFinish(runId, "success") fires at line 327. The same pattern sits at line 122: `const { count: lessonCount }` discards its error, giving totalLessons=0, which makes computeAvg return 0 and writes avg_progress=0.00 for both dates. A given calendar date gets exactly two chances to be written (once as 'today', once as 'yesterday' the next morning) and is then frozen forever unless someone manually calls rebuild_daily_snapshots.

**Cost:** A permanent hole in the join/churn trend that looks completely normal — plenty of real days genuinely have 0 joins and 0 churns, so there is no way to distinguish a zeroed day from a quiet day by looking. Karlo reads this table on /admin/insights to judge whether the cohort is growing or bleeding. The cron_runs row says success. Nobody is told.

**Fix:** Destructure `.error` on all four count queries in joinChurnCounts (and on the lessonCount query at line 122), and on any error call logCronFinish(runId, "failed", ...) and return 500 before the upsert — the same short-circuit shape already used correctly for activeErr at line 146 and progressErr at line 179. Never write a snapshot row from a partially-failed read.

---

### The Whop webhook clobbers whop_plan_id to null on every activation and every renewal
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/app/api/webhooks/whop/route.ts:161 · fix: minutes* · not independently verified

**What happens:** Lines 161 and 294 write `whop_plan_id: membership.plan_id ?? null` into a bulk upsert keyed on whop_user_id, so the column is always in the ?columns= set and is always overwritten. Three things make the value suspect: `plan_id` is declared optional at types/whop.ts:37 and was added speculatively in v79; the repo's own note at whop-members.ts:70-75 states the webhook payload uses nested objects while flat id fields belong to the v2 list shape — where the field is named `plan`, not `plan_id`; and line 207 in this very same handler writes `surviving.plan`, the other name, for the same column. Nothing logs the resolved value. Whichever way the shape question resolves, the write is unguarded: the pre-fetch at line 143 selects only `first_paid_at`, so there is no stored value available to preserve, and a missing field becomes null rather than leaving the existing plan id alone. payment.succeeded fires on every recurring renewal, so this runs against established students, not just new ones.

**Cost:** whop_plan_id gates 13+ read sites: /admin dashboard, students list, insights/progress (twice), journey, not-activated, useJourneyPaceCounts, and all of snapshot-progress, day28-dm, check-engagement, check-csm-tasks, check-na-tasks. A student nulled here vanishes from every admin surface and every CSM cron until the next sync re-stamps them. This is the same class of wipe as the 2026-06-11 incident the sync runner documents at lines 268-278, and the sync runner has a hard tripwire at lines 400-407 to make it impossible there — the webhook bypasses that invariant entirely. Verify in 60 seconds with no risk: grep Vercel logs for `[whop-webhook] eventName=membership.activated data_keys=` (already logged at line 124) and read whether plan_id is in the list.

**Fix:** Add whop_plan_id to the pre-fetch selects at lines 145 and 281, then write `whop_plan_id: membership.plan_id ?? (membership as any).plan ?? existingStudent?.whop_plan_id ?? null` — preserve by value, never clobber to null, exactly the rule whop-sync-runner.ts:279-280 states. Log the resolved value once so the shape question is settled from production data rather than from the type file.

---

### DISCOUNT_GATE_LESSON_ID is dead, documented as live, and its comment vouches for a gate that no longer exists
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/lib/constants.ts · fix: minutes* · not independently verified

**What happens:** constants.ts:95 exports `DISCOUNT_GATE_LESSON_ID = "l049"` under a four-line comment explaining that "v17 moved the gate from l046 → l049 ... the natural 'you've shipped your static ad, here's your discount' moment." Nothing imports it. Grepping the whole of src/ for the symbol returns exactly one hit: its own definition. The real gate is 'every R1 and R2 lesson complete' — client side StudentContext.tsx:805 `discountAllLessonsDone = r1?.isComplete && r2?.isComplete` feeding :836 `discountEligible`, and server side discounts/request/route.ts:152-181 walking a `required` list and rejecting with "Not yet eligible — N/M required lessons complete." CONTEXT.md:507 lists the constant by name in the constants.ts row as though it were load-bearing.

**Cost:** Money path. Karlo asks to move the 30% discount gate earlier or later; a dev reads CONTEXT.md, finds the named constant, edits l049 to another lesson, deploys, and nothing changes. The most likely next step is concluding the deploy failed or the cache is stale, rather than that the constant was severed from the logic. This is the workspace's documented house failure mode exactly — a stale comment vouching for behaviour that moved.

**Fix:** Delete the constant and its comment, and replace CONTEXT.md:507's mention with the real gate: 'discount unlocks on full R1+R2 completion — client StudentContext.tsx:805/836, server discounts/request/route.ts:152-181.' If a single-lesson gate is ever wanted again, reintroduce it wired to both call sites in the same commit.

---

### A Whop sync where every batch upsert failed still writes status='success' with a fabricated rows_affected
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/lib/whop-sync-runner.ts:426 · fix: minutes* · not independently verified

**What happens:** Supabase has a transient outage during the :00 sync. Every batch upsert at line 417 returns an error. Lines 422-426 run: `result.errors += batch.length`, `result.inserted = Math.max(0, result.inserted - batch.length)`, and then `result.updated = Math.max(0, result.updated)` — which is a no-op, it decrements nothing and was clearly meant to mirror the line above it. Execution falls through to line 526, `logSyncRun(supabase, source, startedAt, t0, "success", result)`, which is unconditional. The route then calls logCronFinish(runId, "success", { rowsAffected: result.updated ?? 0 }) at sync-whop/route.ts:41-43, where result.updated is still the full intended count (~3,300) because nothing ever decremented it.

**Cost:** sync_runs and cron_runs both record a successful sync that moved ~3,300 rows when zero rows moved. The students table is stale, and every downstream surface — the dashboard, churn counts, CSM task generation — runs on stale membership data with a green audit trail behind it. This is precisely the 98%-KPI pattern: the failure renders a believable number, not an error. admin-health.sql does check latest_errors=0, but it is a file someone has to remember to open, and the status column it also checks is lying.

**Fix:** Two changes in whop-sync-runner.ts: (1) replace the dead line 426 with a real decrement of the update counter for the failed chunk, and (2) make line 526 conditional — `logSyncRun(..., result.errors > 0 ? "failed" : "success", result, result.errors > 0 ? `${result.errors} rows failed to upsert` : null)`. Then have sync-whop/route.ts read the returned result and call logCronFinish with "failed" when result.errors > 0.

---

### "Refresh everything" rewrites the whole snapshot history from today's surviving students — every trend chart is a survivor curve
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/supabase/migrations/2026_v81_canonical_progress_alignment.sql · fix: hours* · **verified PARTIAL** — claimed critical, corrected to high

**What happens:** Karlo presses Refresh on /admin or /admin/tasks. refresh-everything/route.ts:92-94 calls rebuild_daily_snapshots(p_start_date='2026-01-01'), which deletes every daily_progress_snapshots row from Jan 1 forward (:99) and recomputes each historical day as `count(*) from students where membership_status in ('active','past_due') and joined_at::date <= d.day and first_paid_at >= cutoff and whop_plan_id = any(paying)` (:157-163 for the _cohort family the UI actually reads, :116-121 for the legacy family). membership_status is evaluated at REBUILD time, so every student who has ever churned is erased from every past day. Compounding it: joined_at::date <= d.day, where joined_at is overwritten on every renewal by the webhook (webhooks/whop/route.ts:156 and :292 — only first_paid_at is protected) and is documented at metrics-definitions.ts:48-49 as "current cycle start [which] moves on each renewal"; if that comment is right, a monthly subscriber counts as active only from her latest renewal onward, so any day more than ~30 back counts almost nobody.

**Cost:** The "Active on platform" 14-day sparkline on /admin (page.tsx:558-561) and the "Active students" chart on /admin/insights/progress both read daily_progress_snapshots.active_count_cohort. TODAY they render a monotone non-decreasing line that can only go up, because every past day is filtered to people who are still here. They SHOULD render the real active count as it stood on each day, which falls whenever churn exceeds joins. The insights delta pill ("↑ +N vs start of range") overstates net growth by exactly the number of students who joined AND left inside the window — invisible on the chart. avg_progress_cohort history is inflated the same way: churners complete the fewest lessons, so deleting them from past days raises the historical mean and the progress curve looks flatter and healthier than it was. The team understood this mechanism precisely — CONTEXT.md:391-396 says canceling_snapshots is "DELIBERATELY separate... the rebuild RPC deletes+reinserts that table and point-in-time canceling state can't be recomputed — a column there would be wiped on every Refresh everything" — and then left four columns with that identical property inside the wiped table. The invariant suite does not catch it: supabase/diagnostics/admin-health.sql:158-190 and :193-230 compare only the LATEST snapshot row against live state, and that one row is the single day where the RPC and reality agree, so the checks pass green while the history is fabricated.

**Fix:** Stop rebuilding history on a refresh. In refresh-everything/route.ts:92-94 pass p_start_date = yesterday's date instead of '2026-01-01' (the nightly cron already writes yesterday+today correctly and point-in-time correctly), and make /api/admin/rebuild-snapshots require an explicit start date rather than defaulting to the full year. The durable fix is to treat active_count/avg_progress the way v84 treated canceling_count — a rebuild-proof table written only forward by the cron — or add a membership transitions log so the RPC can reconstruct a day honestly. Until one of those lands, put a note on the insights page that the chart is survivor-filtered before anyone makes a retention call on it.

> **Verifier:** CORE MECHANISM — CONFIRMED, line-exact, could not break it.

v81 is the live definition of rebuild_daily_snapshots (grep across supabase/migrations shows v82-v88 never redefine it; v84 only references it in a comment). supabase/migrations/2026_v81_canonical_progress_alignment.sql:99 is literally `delete from daily_progress_snapshots where snapshot_date >= p_start_date;`. Line :157-163 recomputes each historical day as `select count(*) from students s where s.membership_status in ('active','past_due') and s.joined_at::date <= d.day and s.first_paid_at >= v_cohort_cutoff and s.whop_plan_id = any(v_paying_plans)`. membership_status is evaluated at REBUILD time. The only day-dependent term is `joined_at::date <= d.day`, whose satisfying set grows monotonically with d, so active_count_cohort is

---

### CLAUDE.md routes every new session to architecture_summary.md, which describes the April product
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/system-docs/architecture_summary.md · fix: hours* · not independently verified

**What happens:** The workspace CLAUDE.md routing table says "30-day-sprint — system architecture → system-docs/architecture_summary.md for the shape." A session loads it and gets five verifiable falsehoods. Line 62: "Team manages them at /admin/alerts" — no such route exists on disk (only src/app/admin/(authenticated)/{discord,discounts,etfb,feedback,insights,journey,lessons,not-activated,settings,stats,students,tasks,team,templates}). Churn section: "Runs daily at 9am via Vercel cron" — vercel.json schedules it "10 */2 * * *", every 2 hours, since v85.5. Its alert table lists `no_activation_14d` and `week2_no_start`; check-engagement/route.ts emits neither, and emits `no_lessons_3d` (lines 177, 197) which the doc omits. Discount flow: "Student completes 13/13 required tasks" — the student `tasks` table was dropped in 2026_v3_expedition_restructure.sql:145 and the name repurposed for the CSM queue; eligibility is now every R1+R2 lesson (discounts/request/route.ts:152-181). And "Bridges Whop identity to Supabase auth without storing tokens" while supabase/migrations/2026_whop_access_token.sql:8 adds `students.whop_access_token`.

**Cost:** This is the first architecture doc a new session or a new dev reads, and it is the one the workspace routing table blesses. Someone debugging churn alerts looks for a 9am daily run and a /admin/alerts page; neither exists. Someone changing discount eligibility looks for a 13-task counter. Every wrong lead costs a session and, worse, invites a 'fix' aimed at a system that was deleted in April.

**Fix:** Either regenerate it against the code or replace its body with a one-line pointer to CONTEXT.md and delete the stale sections. The cheapest correct move is deletion plus a redirect stub — CONTEXT.md already covers auth, crons, and the discount flow accurately. Then update the CLAUDE.md routing row so it no longer names this file first.

---

### past_due students are treated as paying everywhere except the one screen that decides whether they can use the product
*src/components/onboarding/MembershipBlockOverlay.tsx:32 · fix: minutes* · not independently verified

**What happens:** `mapStatus` maps Whop's `valid=true, status=past_due` to `'past_due'` (whop-members.ts:127-128) — Whop still grants access during the card-retry window. `ACTIVE_STATUSES` includes it and metrics-definitions.ts:26-30 says so explicitly: "they are functionally active members". `isPayingMember` counts them. Every admin surface counts them. But MembershipBlockOverlay.tsx:32 returns null only for `'active'`, so a past_due student gets the full-screen "your subscription isn't active right now" block. Worse, the login gate at auth/whop/callback/route.ts:86-88 sets `dbHasActive = true` for past_due, which gates the self-heal branch at :147 — so the repair added in v85.6 to fix exactly this class of DB/Whop divergence is skipped for these students by construction. They log in successfully and are then blocked inside, every time, with no path out.

**Cost:** A customer whose card bounced once — still charged, still inside Whop's dunning retry, still counted as paying in the month-2 KPI and still generating CSM tasks — is locked out of the dashboard until the retry clears. They see a Renew button and are pushed toward buying a second membership they do not need. This is a live, ongoing lockout of people who are paying, not a corner case: card retries are routine at 8,269 memberships.

**Fix:** Decide once and encode it once. If past_due keeps access (which is what metrics-definitions.ts:26-30 and Whop itself already assert), change MembershipBlockOverlay.tsx:32 to `if (isActiveMember(student)) return null;` and import the canonical predicate rather than re-deriving it. If Karlo genuinely wants past_due blocked, then `isPayingMember` must stop counting them and the login gate must stop treating them as active — but do not leave the two definitions disagreeing.

---

### PAYING_WHOP_PLAN_IDS is the only product filter `students` actually has — widening it before fixing WHOP_PRODUCT_ID turns 3,310 account rows into students

> **RETRACTED IN FULL.** Production is scoped to the course product, so `students` is not an account-wide mirror and the 3,310-rows-flood scenario cannot happen. The stated ordering constraint (fix the env var before the plan list) does not apply in production. The plan list is still worth narrowing, but for a different and much smaller reason.
*src/lib/constants.ts:21 · fix: day+* · not independently verified

**What happens:** Because `product_id` is invalid and silently ignored, `students` is an account-wide mirror: brand owners, Apex members, bounty-only members, free claimers. The only thing keeping them out of every operational surface is `.in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY)`, applied at 17 query sites — admin dashboard (page.tsx:122), students roster (students/page.tsx:54), journey (journey/page.tsx:99), not-activated (:106), insights (progress/page.tsx:1135 and :1539), useJourneyPaceCounts.ts:70, snapshot-progress (5 sites, :143-233), day28-dm (:69), check-engagement (:47), check-csm-tasks (:162), check-na-tasks (:119). The obvious remediation for known-defect #3 is "add the other 44 paid plans." Do that while `WHOP_PRODUCT_ID` still holds plan ids and the filter that was accidentally doing the product's job disappears. Note the existing evidence of drift: `plan_BIVTAaTBLVSaD` is configured as a product to sync students FROM, yet is absent from the paying allowlist — so anyone on it is written into `students` and then filtered out of every surface and every cron that would ever contact them.

**Cost:** Two directions, both bad. Today: students on legitimate sprint plans outside the 2-id allowlist are invisible on /admin/students, absent from the month-2 conversion numerator AND denominator, excluded from snapshots, and get no CSM task, no engagement alert and no day-28 DM — they are paying and nobody on the team can see them. After a naive widening: Astrid's task queue and the day-28 Discord DM cron start firing at $997/month ETFB brand owners with "Day 28 of your 30-day sprint", and the founder-facing month-2 KPI denominator swells with people who never bought the course. That is a CSM contacting the wrong person, at scale, on the first cron tick after deploy.

**Fix:** Order matters and must be stated in the PRD: fix `WHOP_PRODUCT_ID` to real `prod_` ids and prove the filter is honoured (assert `total_count != account total`, the rule etfb.ts already follows) BEFORE touching the plan allowlist. Then derive paying status from a live plan read with `priceOf(plan) > 0`, the way `deriveOwners` in etfb.ts:632 already does, instead of any static list — the account has 46 paid plans and one-off per-user "Waitlist" plans that no hardcoded list can ever track.

---

### The entitlement lookup that guards login and cancellation has no entitlement check in the branch that actually returns a row

> **RETRACTED AS STATED.** `productIds.includes(m.product)` compares `prod_eE7r6SXa3H0MX` against a `prod_` value in production and matches correctly, so strategies 1 and 3 do not always fall through. The residual point about strategy 2 applying no plan check is folded into the correction on the first finding above.
*src/lib/whop-members.ts:355 · fix: hours* · not independently verified

**What happens:** fetchActiveMembershipForUser filters candidate memberships with productIds.includes(m.product) at :303-304 (strategy 1) and :398-399 (strategy 3). productIds comes from WHOP_PRODUCT_ID, which holds plan ids (.env.local: plan_4ZrwR4PmBsVsx,plan_BIVTAaTBLVSaD — both plans of prod_eE7r6SXa3H0MX per system-docs/whop_plan_inventory_2026-09-03.md), while m.product is a prod_ id. That comparison can never be true for any row carrying a product, so strategies 1 and 3 always fall through. Strategy 2 (:326-365) then queries with product_id=plan_… — an invalid product_id filter that Whop silently ignores — post-filters only by user, and picks the first row whose mapStatus is active/past_due with NO product or plan check at all. Two live callers: the OAuth callback's self-heal (callback/route.ts:148), where a match sets selfHealed=true and bypasses the no_membership block at :229; and the membership.deactivated webhook (webhooks/whop/route.ts:194-205), where a match re-points the student and writes membership_status active + canceled_at null.

**Cost:** Entitlement is granted on the existence of ANY valid membership anywhere in the company. On login: a $0 Apex member (110 free plans, 554 valid members) or an ecomtalent-for-brands owner who hits /login is stamped an active sprint student and gets the paid course. On cancellation: a churning $97/mo student who holds any free membership is kept active with canceled_at cleared — they never lose dashboard access and never appear in churn. If instead Whop ignores user_id on that call too, the opposite breaks: no legacy customer is ever self-healed and the v75.10 fix does nothing. Either way the function does not do what both callers believe it does. (Whether prod values differ from .env.local is unverified from here — no network calls made.)

**Fix:** Match on plan OR product, the way checkActiveMembershipDiagnostic already does at whop.ts:168-171 (it accepts either, which is why the login gate itself works). Apply that same predicate inside strategy 2's find() so the fallback that actually returns rows is gated too, and add strategy 1's 'filter appears ignored' guard to strategy 2. Separately, split the env var into WHOP_PRODUCT_IDS and WHOP_PLAN_IDS so no future comparison can be silently type-mismatched.

---

### The 2-hourly sync makes 1,000 sequential requests with ~200s of hardcoded sleep against a 300s ceiling, and writes nothing if it times out

> **RETRACTED IN FULL.** One product id is configured in production, not two, so there is one pass and not two. The real figure is 389 pages, about 78s of throttle sleep inside a 300s ceiling. This is consistent with `cron_runs` showing 801 successes. The sync does not time out. The underlying `per_page=` inefficiency is real and the 500-page cap is a genuine future limit, but the timeout scenario described here is not happening.
*src/lib/whop-sync-runner.ts:65 · fix: hours* · **verified PARTIAL** — claimed critical, corrected to high

**What happens:** `WHOP_PRODUCT_ID` = `plan_4ZrwR4PmBsVsx,plan_BIVTAaTBLVSaD` (.env.local) — two entries, so `fetchAllMemberships` (whop-members.ts:536) runs the page loop twice. Both are PLAN ids in a `product_id` slot, so Whop silently ignores the filter and BOTH passes return the identical, unfiltered 8,269-membership account list. With `per_page=` ignored (whop-members.ts:194) Whop serves 10 rows/page, so `pagination.total_page` comes back ~827 and the loop never hits its `currentPage >= totalPage` break — it runs the full `maxPages = 500` (whop-members.ts:180) on each pass. That is 1,000 requests and 998 × 200ms of deliberate throttle sleep (whop-members.ts:191) = ~199.6s of pure waiting before counting any network time. `maxDuration` is 300 (cron/sync-whop/route.ts:21). Every DB write in the runner is downstream of `const members = await fetchAllMemberships()` at whop-sync-runner.ts:65 — the upsert loop is at :412 — so a timeout at 300s discards the entire run: no upsert, no `logSyncRun` (:526), no `logCronFinish`. Compounding it, `whopFetchWithRetry` honours `Retry-After` UNCAPPED (whop-members.ts:49-51 — the `Math.min(30_000, …)` cap the comment at :43-44 advertises only wraps the `else` branch), and 1,000 requests at ~5/sec will draw Cloudflare 1015s.

**Cost:** If it is timing out, `membership_status`, `cancel_scheduled_at` and `first_paid_at` have been webhook-only for however long, and every "the nightly sync will backfill this within 24h" promise in the codebase (discounts/request/route.ts:86, metrics-definitions.ts:103) is false. `cancel_scheduled_at` has NO other writer — the entire Canceling / save-the-sale pipeline, which is the stated reason the cadence went from daily to 2-hourly (CONTEXT.md:456), produces nothing. Churned students keep dashboard access. And `/api/admin/refresh-everything` awaits sync-whop as its step 1 inside its own 300s budget (refresh-everything/route.ts:41,73) while its header comment still estimates "~80s" (:20), so Karlo's ↻ Refresh everything button burns its whole budget on step 1 and never reaches the snapshot rebuild or the three CSM crons. Nothing surfaces any of this: `sync_runs` is written at whop-sync-runner.ts:568 and read by zero UI surfaces.

**Fix:** Verify first, it is one query: `select status, count(*), max(started_at) from cron_runs where route_name='sync-whop' group by status` — rows stuck at 'running', or a `sync_runs` table with no recent rows, confirms it. Then fix the fetch: swap `per_page=` to `per=` (max 50, verified in system-docs/etfb_access_audit_2026-09-10.md:155) which cuts pages 5x, and collapse the duplicate pass — both product ids return the same unfiltered list today, so one pass is strictly equivalent until a real `prod_` id is configured. Follow etfb.ts's rule (etfb.ts:632 area) and THROW when `total_count` equals the unfiltered account total instead of proceeding on a filter you cannot prove worked.

> **Verifier:** The MECHANISM is real and every line reference checks out. The TIMEOUT is an inference I could not confirm, and one of the three headline consequences is flatly wrong.

WHAT I CONFIRMED (code, not inference)

- `whop-members.ts:180` `maxPages = 500`, `:194` `&per_page=${perPage}` (the ignored param), `:191` `if (page > 1) await new Promise(r => setTimeout(r, 200))`. `fetchAllMemberships` (`:525`, loop at `:536`) calls `listMembershipsForProduct(pid)` with NO opts, so both defaults stand. No caller anywhere overrides them.
- `.env.local` `WHOP_PRODUCT_ID=plan_4ZrwR4PmBsVsx,plan_BIVTAaTBLVSaD` — two entries, verified.
- Sleep arithmetic is right: 499 sleeps per pass (page 1 is skipped), 998 across two passes = 199.6s before any network time.
- No early break on an empty page (`whop-members.t

---

## MEDIUM  (24)

### Documented routes that do not exist, and live routes documented nowhere
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/CONTEXT.md · fix: minutes* · not independently verified

**What happens:** CONTEXT.md's API Routes section lists under **Public**: "`GET /api/tasks/[taskId]` — public task lookup (CSM dashboard links)." src/app/api/ contains only admin, auth, client-event, cron, discounts, student, webhooks — there is no tasks directory, and grepping src/ for `api/tasks/` returns zero hits. Its Admin Surfaces table lists `/admin/alerts` (nonexistent) and `/admin/insights` (only /admin/insights/progress exists; the nav at layout.tsx links the full path). Going the other way, four live API routes are absent from the doc — `/api/admin/run-task-crons`, `/api/admin/config`, `/api/student/cohort-stats`, `/api/student/rate-lesson` — as are six live pages: /admin/feedback/lessons, /admin/feedback/survey, /admin/team, /admin/set-password, /admin/lessons (a redirect shim), and /dashboard-mockup plus /dashboard-mockup/edit-regions, which render the real student map wrapped in SyncDebugPanel and PlaybookTestPanel and are linked from JournalView.tsx:102.

**Cost:** The phantom /api/tasks/[taskId] line is the sharpest: it describes a public, unauthenticated endpoint for CSM dashboard links. Anyone auditing the public attack surface will hunt for it, and anyone building CSM deep-links will assume it exists. /dashboard-mockup going undocumented cuts the other way — a dev-tooling surface with test override panels is reachable in production and appears in no route inventory, so no security or access review would ever cover it.

**Fix:** Delete the /api/tasks/[taskId] bullet and the /admin/alerts row; change /admin/insights to /admin/insights/progress. Add the four missing API routes and six missing pages, with /dashboard-mockup explicitly flagged as a dev surface so its production reachability is a recorded decision rather than an oversight.

---

### /admin/not-activated resolves "has logged in" with one unbatched .in() over the whole cohort and discards the error
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/app/admin/(authenticated)/not-activated/page.tsx · fix: minutes* · not independently verified

**What happens:** studentsRaw is fetched with fetchAllRowsPaginated and no upper bound — every active, non-exempt, paying, launch-cohort student, which is 1000+. Line 121-132 then runs `supabase.from("student_milestones").select("student_id").in("student_id", allIds).not("first_sprint_login_at","is",null)` exactly once, unpaginated, and destructures only `data` — the error is thrown away. Two silent failures stack: PostgREST caps that result at ~1000 rows regardless of how many ids went in, and 1000+ UUIDs is a ~40KB GET URL, past typical proxy limits (this repo already batches .in() at 100 for that exact reason — outreach-insights.ts:54-55, "keeps PostgREST GET URLs well under length limits"). The sibling read at :141-145 (student_whop_sync .in(ids)) has the identical shape.

**Cost:** If the result is capped, activatedIds is incomplete and students who HAVE logged in are listed as never-activated. If the URL is rejected, `data` is null, the error is swallowed, activatedIds is empty, and the page lists the ENTIRE active paying launch cohort as "Not Activated" — the Total / Cohort A / Cohort B tiles at :183-194 count the unfiltered list, so they render a large, plausible number with no error anywhere. Astrid then manually DMs "you haven't signed in yet" to paying students who use the dashboard daily. The cron twin (check-na-tasks/route.ts:109-146) is far less exposed because it bounds its pool to csmSprintWindowCutoffIso() (last 30 days) — but its own students query at :109-125 is unpaginated, so it would silently skip joiners past 1000 rows and simply never create their NA tasks.

**Fix:** Batch both .in() lookups at 100 ids the way outreach-insights.ts does, and check the error — on failure render an explicit "couldn't determine activation" state rather than an empty activatedIds set. Add the same batching to check-na-tasks/route.ts:118-126 and wrap its students query in fetchAllRowsPaginated.

---

### Month-2 conversion silently drops 'expired' memberships from both numerator and denominator, inflating the north-star KPI
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/app/admin/(authenticated)/page.tsx · fix: minutes* · not independently verified

**What happens:** The dashboard's only students query filters .in("membership_status", ["active","past_due","canceled"]) at page.tsx:121 — the VISIBLE_STATUSES set, which metrics-definitions.ts:36-38 deliberately defines as excluding 'expired' because it is "a hard end-of-life state". But mapStatus (whop-members.ts:131-133) returns 'expired' whenever Whop reports valid=false and status='expired', which is the ordinary end state for a subscription that simply ran out. Those students never enter `students` on this page at all, so a launch-cohort non-renewer who landed in 'expired' rather than 'canceled' is removed from the Month-2 DENOMINATOR instead of being counted as a non-conversion. isMonth2Converted / isInMonth2Cohort themselves never look at membership_status — the loss happens upstream in the query, which is why it is invisible when reading the helper.

**Cost:** Month 2 conversion (the 68px hero number on /admin, page.tsx:486-513) reads HIGHER than reality by roughly expired_non_renewers / (cohort + expired_non_renewers), and so does the "of N past renewal" subtitle and the 14-day M2 sparkline. This is the same shape as the 98% bug v85.8 fixed — the number is believable, it moves, and nothing errors. Note the asymmetry it creates: the snapshot cron's churned_count (snapshot-progress/route.ts:220-233) filters on canceled_at alone and DOES include expired students, so the Churned tile and the M2 denominator are measuring different populations of the same cohort. I could not count the expired rows without DB access, so the magnitude is unverified — but the code path is not.

**Fix:** Run `select membership_status, count(*) from students where first_paid_at >= '2026-05-25' and whop_plan_id in ('plan_4ZrwR4PmBsVsx','plan_fMMqxAljrzu75') group by 1` first — if the expired bucket is non-zero the KPI is wrong today. Then either add 'expired' to the .in() at page.tsx:121 (it is a churn outcome, and isPayingMember already keeps it out of the Active tile), or compute Month-2 from a dedicated query that does not filter membership_status at all, since the predicate keys off first_paid_at / canceled_at / cancel_scheduled_at and does not need the status column.

---

### The one-button Refresh returns ok:true when every step failed, and the toast reports success
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/app/api/admin/refresh-everything/route.ts:129 · fix: minutes* · **verified PARTIAL** — claimed high, corrected to medium

**What happens:** Each step in refresh-everything catches its own failure into summary.sync / summary.rebuild / summary.engagement etc. as `{error: ...}`, then line 129 returns `NextResponse.json({ ok: true, ...summary })` unconditionally — HTTP 200 regardless. On /admin/tasks, generateTasksNow checks only `res.ok` (tasks/page.tsx:259), which passes, then reads `payload.sync?.fetched ?? 0` and `payload.csm_tasks?.tasks_created ?? 0` (lines 269-272) and sets the toast at line 273. On the /admin dashboard (page.tsx:1077-1089) it is worse: if `sync` has no `fetched` key the code simply doesn't push a message part, so a total sync failure produces no error text at all and `worst` is never set to "err".

**Cost:** Astrid or Karlo presses Refresh, waits two minutes, and gets "Refreshed everything · Whop 0 members · +0 tasks · 0 alerts." That is the exact string a genuinely quiet, fully successful refresh produces. They then act on a queue and a dashboard that were never updated. On /admin the failure is fully invisible.

**Fix:** In refresh-everything, track whether any step produced an error and return `{ ok: false, failed: [...], ...summary }` with a 207 or 500 when so. In both UI callers, check for an `error` key on each sub-result and surface it in the toast in red rather than falling back to `?? 0`.

> **Verifier:** MECHANISM — CONFIRMED, I could not break it.

src/app/api/admin/refresh-everything/route.ts:
- 76-83  summary.sync = res.ok ? json : { error: `HTTP ${res.status}` }; catch → { error: msg }
- 95     summary.rebuild = error ? { error: error.message } : { ok: true }
- 121-122 unwrap(): !r.value.ok → { error: `${label} HTTP ${r.value.status}` }
- 131    return NextResponse.json({ ok: true, ...summary });   ← unconditional, no status arg

The claim cited :129 for the return. Line 129 is `summary.total_duration_ms = Date.now() - t0;`; the return is :131. Off by two, quoted content correct. Every other cited line is exact.

REACHABLE. src/app/api/cron/sync-whop/route.ts:45-54 returns HTTP 500 on any throw from runWhopCommunitySync (whop-sync-runner.ts:528-540 rethrows). listMembershipsForProduct 

---

### /admin/tasks shows only the 500 newest tasks of any status and counts its tabs from that truncated set
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/app/api/admin/tasks/route.ts · fix: hours* · **verified PARTIAL** — claimed high, corrected to medium

**What happens:** tasks/page.tsx:220-223 fetches with status=all and limit=500 to "pull all statuses in one round-trip so the tabs can show their counts". The route applies .order("created_at", desc).limit(limit) at :44-45, so it returns the 500 most recently CREATED tasks across open+completed+dismissed combined. tasks/page.tsx:296-303 then computes counts.open / counts.completed / counts.dismissed by filtering `rows` — the truncated 500. With 3,310 students, four scenario families and crons firing every 2 hours since May, total task rows are far past 500 (I could not count them without DB access, so treat the exact overflow as inferred, not measured).

**Cost:** Right now the "To do", "Sent" and "Dismissed" tab counts read whatever share of the newest 500 rows happens to be in that status. They should read the true totals. Worse than a wrong count: any open task older than the 500th-newest row is absent from Astrid's queue entirely — it is never worked, never dismissed, and stays open forever while still being counted on the dashboard. The dashboard's Open tasks tile (page.tsx:161-170) does an exact head-count with no limit, so the two surfaces disagree despite the comment at page.tsx:157-158 claiming it "Mirror[s] /api/admin/tasks filtering exactly". There is a second divergence in the same pair: the route drops tasks whose template is null (route.ts:91-93) but the dashboard count does not, and templates/[id]/route.ts:88-90 sets tasks.template_id to NULL when Karlo deletes a template — so every open task belonging to a deleted template is permanently invisible in the queue and permanently counted on the tile.

**Fix:** Fetch the queue with fetchAllRowsPaginated (with a stable .order("id") tiebreaker) instead of limit=500, or keep the page limit and get the tab counts from three separate {count:'exact', head:true} queries so they are never derived from a truncated page. Add .not("template_id","is",null) to the dashboard's Open tasks count so it matches the queue, and have check-csm-tasks auto-dismiss open tasks whose template_id went NULL.

> **Verifier:** CONFIRMED MECHANICS. src/app/api/admin/tasks/route.ts:30-33 caps limit at 500; :44-45 applies .order("created_at",{ascending:false}).limit(limit) to the whole set, and :47 only adds .eq("status", …) when status !== "all". src/app/admin/(authenticated)/tasks/page.tsx:221-223 sends status=all&limit=500, so the page holds the 500 most recently CREATED rows across open+completed+dismissed. :296-303 reduces that same truncated `rows` into counts.open/completed/dismissed, rendered as the tab badges at :569-574. fetchTasks' deps are [studentSearch, supabase] — `status` is never a query param, so switching tabs never refetches. No pagination, no "load more", and grep shows /api/admin/tasks has exactly one consumer. The dashboard divergence is also real: src/app/admin/(authenticated)/page.tsx:161-1

---

### A cron killed at the 300s ceiling leaves no trace, and nothing gates the :10/:15/:20 crons on the sync having worked

> **PARTLY RETRACTED.** The observability gap is real and stands: no top-level try/catch means a killed cron leaves `cron_runs` at status='running' forever. But the sync is NOT the likely victim, because the 1,000-page arithmetic this finding leaned on was wrong. Keep the finding, discard its named cause.
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/app/api/cron/check-csm-tasks/route.ts:127 · fix: hours* · not independently verified

**What happens:** check-csm-tasks (910 lines), check-na-tasks, check-engagement and day28-dm have no top-level try/catch — only snapshot-progress does, at line 118. Any throw, or a hard kill at maxDuration=300, skips logCronFinish entirely and leaves the cron_runs row at status='running' with finished_at null and error_message null, forever. The sync is the most likely victim: WHOP_PRODUCT_ID holds two PLAN ids so the product filter is ignored and the whole account is paged twice; with per_page ignored at 10 rows/page and maxPages=500, that is 1,000 pages and 998 mandated 200ms sleeps — 199.6s of pure sleep inside a 300s budget, before a single millisecond of HTTP latency. The recovery loop's own RECOVERY_DEADLINE_MS=240_000 shows the code already expects to be past 240s. (The "sync ~80s, ~110-130s total" estimate in refresh-everything's header is inconsistent with that arithmetic.) Separately, grep confirms no cron reads sync_runs or cron_runs before running: check-engagement at :10, check-csm-tasks at :15 and check-na-tasks at :20 fire on the clock regardless of what happened at :00.

**Cost:** Answering the question directly: the offsets are not load-bearing, because there is no dependency to be load-bearing about. A sync that dies does not delay the downstream crons — it silently feeds them stale membership state, and they generate real outreach tasks and Discord alerts off it. Meanwhile the death itself is invisible: no sync_runs row at all (logSyncRun is never reached), a permanently 'running' cron_runs row, and no alert. The only detector is supabase/diagnostics/admin-health.sql, which is a file a human has to remember to run.

**Fix:** Three things. (1) Wrap each cron body in try/catch that calls logCronFinish(runId, "failed", {error}) before rethrowing, matching snapshot-progress. (2) Add a startup guard to the :10/:15/:20 crons that reads the most recent sync_runs row and short-circuits to logCronFinish("failed", {error:"upstream sync stale/failed"}) if it is not a success within the last ~3 hours — better to generate nothing than to generate outreach off stale data. (3) Add a sweeper (or a check at the top of logCronStart) that marks any cron_runs row still 'running' after 10 minutes as 'timed_out', so the kill leaves a mark.

---

### check-na-tasks can tell paying students who log in daily that they never logged in
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/app/api/cron/check-na-tasks/route.ts:138 · fix: minutes* · not independently verified

**What happens:** Line 138 is `const { data: activated } = await supabase.from("student_milestones")...` — the error is not destructured. This query is the only thing that removes students who HAVE logged in from the Not-Activated pool. If it errors, `activated` is null, activatedIds is empty, and line 148 keeps everyone. Any student whose sprintDayNumber lands on exactly 3, 5, 7 or 10 that run gets a task created with behavior_summary "No dashboard login since signup" (line 227), and at tier 10 line 254 also flips high_churn_risk=true on them. The same unchecked pattern is at line 158 for the templates query — if that errors, templateIdByScenario is empty, every student falls into the errors[] array, 0 tasks are created, and line 300 still logs cron_runs status='success' with rows_affected=0.

**Cost:** Astrid works the queue and DMs active, engaged, paying students telling them they never signed in. That is a credibility hit with the exact customers you least want to annoy, and a day-10 student additionally gets silently flagged high_churn_risk which removes them from future NA passes. The templates-error variant is the quieter one: the Not-Activated pipeline stops producing anything at all and the audit trail says it ran fine.

**Fix:** Destructure and check `.error` on both queries. On the student_milestones error, logCronFinish("failed") and return 500 — running the pool without it is worse than not running. On the templates error, same. Also treat a non-empty errors[] at line 300 as a failed run rather than a success with rows_affected=0.

---

### The deactivation webhook has no maxDuration but makes up to 4 sequential Whop calls with uncapped Retry-After
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/app/api/webhooks/whop/route.ts:186 · fix: minutes* · not independently verified

**What happens:** webhooks/whop/route.ts declares no `export const maxDuration` (grep confirms it appears only in the cron routes), so it runs on the platform default, which is short. The membership.deactivated branch calls fetchActiveMembershipForUser, which issues strategy 1 (1 request), strategy 2 (one per configured id, currently 2), and strategy 3 (1 request) — four sequential calls to api.whop.com. Each goes through whopFetchWithRetry, which at whop-members.ts:45-51 honours Retry-After with no cap and retries up to 5 times. A single Cloudflare 429 with a large Retry-After parks the handler past the function ceiling. Vercel kills it, Whop sees a 5xx, Whop retries on backoff, and the retry hits the same rate limit.

**Cost:** The cancellation is never recorded. membership_status stays 'active' and canceled_at stays null, so the student keeps dashboard access and churn under-reports — the same end state as the critical finding above, reached by a different route. Nothing writes an audit row for a webhook, so the only trace is a 504 in the Vercel log that nobody is watching.

**Fix:** Add `export const maxDuration = 60` to the webhook route, and cap the Retry-After honoured in whopFetchWithRetry (e.g. `Math.min(retryAfterSec * 1000, 10_000)` with a caller-supplied budget) so a webhook can never wait longer than the function has. Better still: have the deactivate branch write the status change first and queue the surviving-membership check for the next sync, so a slow Whop can never cost you the event.

---

### students.whop_access_token: a column holding OAuth tokens that nothing reads, writes, or types
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/supabase/migrations/2026_whop_access_token.sql · fix: minutes* · not independently verified

**What happens:** Line 8 adds `alter table students add column if not exists whop_access_token text;`. Grepping all of src/ for `whop_access_token` returns zero hits — no reader, no writer. It is absent from the `Student` interface in src/types/database.ts (which lists 24 columns, ending at updated_at), so TypeScript would erase it from any select anyway. Its only plausible consumer, `refreshWhopTokens()` in whop.ts (~line 310), is itself exported and imported by nothing. Meanwhile system-docs/architecture_summary.md's auth section states the deterministic-password design exists to bridge Whop to Supabase "without storing tokens." Whether any rows are actually populated is UNVERIFIED — this is a read-only, no-network pass and the column may be empty.

**Cost:** If the column was ever written to, it holds Whop OAuth access tokens for some subset of 3,310 student rows, with no expiry policy, no owner, and an architecture doc that tells any reviewer they don't exist. Nobody auditing the table would think to look, because the doc says there is nothing to look for. If it was never written, it is harmless clutter — but the doc contradiction stands either way and is the thing that makes the question hard to ask.

**Fix:** Run `select count(*) from students where whop_access_token is not null;` first. If zero, drop the column in the next migration and delete `refreshWhopTokens`. If non-zero, that is a separate incident: null the column, then drop it. Either way, correct architecture_summary.md's 'without storing tokens' claim or delete that file per finding 1.

---

### Open items in system-docs and _admin/prds that were never closed and are still real
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/system-docs/ship_review_2026-08-27_auth-error-legibility.md · fix: hours* · not independently verified

**What happens:** Five carried-forward items verified as still open. (1) ship_review_2026-08-27_auth-error-legibility.md:104, residual R3 — "Two password grants per login doubles rate-limit consumption. Accept, pre-existing, out of scope. Separate fix, flagged." Still true: callback/route.ts:255 and callback/route.ts:419 are two separate `signInWithPassword` calls in one login, against the same Supabase auth rate limit whose exhaustion caused the 429-logout incident documented at length in CONTEXT.md. (2) Same file, R2 — no alerting on auth failure rate; none has been added. (3) ship_review_2026-08-27_auth-lock-steal.md:32 and :82, R7 — "/auth/complete handoff architecture retained ... real fix is /prd-scoped (server-side cookies, delete the route). Logged." No such PRD exists; _admin/prds/ holds only etfb-brand-owners, moc-map-analytics, revenue-stats. (4) _admin/prds/revenue-stats/project_log.md:5-17 declares "Status: Implemented — HALTED at the blast-radius router, awaiting /ship", with blockers "Migration 2026_v86 is written but UNAPPLIED" and "Nothing is committed or pushed" — while the tail of the same file records commit a3b9521 pushed to main and a passing production smoke test. Whether v86 ever ran is genuinely unresolved: the log's own final line makes the saved-views strip reading "No saved views yet" rather than "Saved views unavailable." the sole test, and nothing records it passing. (5) system-docs/etfb_access_audit_2026-09-10.md:251-254 lists four blocking questions for Lovro, and line 58 records an unnamed firehose link (plan_t4VXohAMYT669) carrying 383 redemptions, 68% of all free seats, still taking them on 2026-09-09. Separately, system-docs/change_log.md stops at [0.1.0] - 2026-04-15 while CHANGELOG_v75.md runs to v88, with no pointer between them.

**Cost:** The revenue-stats log is the costliest: its 'Current State' block — the section the doc format exists to be read first — says the feature never shipped and the migration never ran, while the feature is live and founder-visible. Anyone picking up that thread starts from a false premise. The double password grant matters because it silently halves the headroom on the exact rate limit that logged students out in August; the fix was flagged and then dropped. The etfb blocking questions gate a list Astrid is supposed to work, and the tap is still open.

**Fix:** Rewrite the revenue-stats project_log 'Current State' header to match its own footer, and run the one saved-views check that resolves whether v86 applied. File the /auth/complete server-side-cookie rewrite as an actual /build-memo so R7 stops being 'logged' with nowhere to be logged. Fold the double-grant fix into the next auth touch. Close or re-escalate the four etfb blocking questions. Delete system-docs/change_log.md or point it at CHANGELOG_v75.md.

---

### day28-dm is orphaned but /admin/discord still shows a live switch for it
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/vercel.json:1 · fix: minutes* · not independently verified

**What happens:** vercel.json lists five crons; day28-dm is not one of them. Grep across src/ finds no internal caller either — refresh-everything runs sync + rebuild + the three CSM crons, and run-task-crons runs two. The route is reachable only by hand with the CRON_SECRET bearer. Its own header at line 23 says "Runs daily." Meanwhile /admin/discord renders a `day28_dm_enabled` toggle (discord/page.tsx:229, dm-toggles.ts:18) and the route's first action is to check it (line 49). Separately, day28-dm line 64 discards the error on its candidate query, so even when run manually a failed read produces `{checked: 0, sent: 0}` and cron_runs status='success'.

**Cost:** Karlo flips day28_dm_enabled on expecting students to start receiving their Day-28 summary, and nothing happens, ever. There is no error and no log line to notice. The product feature described in PLATFORM_OVERVIEW.md simply does not run. Whether this is a deliberate pause or an accidental omission is not recorded anywhere I could find.

**Fix:** Decide and make the code say it. Either add `{"path": "/api/cron/day28-dm", "schedule": "0 9 * * *"}` to vercel.json, or remove the toggle from /admin/discord and mark the route as manual-only in its header so the switch stops lying. Either way, destructure the error at line 64.

---

### Paid Playbook articles are static files in public/ — readable logged-out, by anyone with the URL
*public/playbook/01-submit-ad-bounties/index.html · fix: hours* · **verified PARTIAL** — claimed high, corrected to medium

**What happens:** `PlaybookNodeSheet.tsx:163` renders the article as `<iframe src={`/playbook/${articleSlug}/index.html`}>`. Those files live in `public/` (`01-submit-ad-bounties/index.html` 84KB, `02-build-your-portfolio` 48KB, `03-apply-to-brands` 24KB, plus 7.2MB of images), so Vercel serves them as static assets with no auth check of any kind. Anyone — not logged in, never a customer — who requests `https://<app>/playbook/01-submit-ad-bounties/index.html` gets the complete article. The slugs are human-readable and enumerable, and any student who has unlocked the Playbook can read them out of their own devtools network tab and paste them anywhere. The in-app gate that is supposed to protect this (`isPlaybookUnlocked`, requiring l078 complete) is a client-side `useEffect` redirect at `src/app/dashboard/playbook/page.tsx:58-62` and never touches the file path. The same content has a second ungated path: `playbook_nodes.doc_content` holds the article bodies and its RLS policy is `using (auth.uid() is not null)` (`supabase/migrations/2026_v42_v2_data_model.sql:64-66`), so any authenticated user — day-1 student, canceled student — can `select *` from it with the browser anon key regardless of the redirect.

**Cost:** The post-sprint Playbook is the thing students finish 30 days to reach. It is currently free to anyone who knows a URL, and one leaked link distributes it permanently. Because it is a static asset there is no log, no rate limit, and no way to know it is happening.

**Fix:** Move the three article directories out of `public/` (e.g. `content/playbook/`) and serve them through an authenticated route handler — `GET /api/student/playbook-article/[slug]` that runs the same JWT + `supabase_user_id` derivation as the other student routes, checks `isPlaybookUnlocked` server-side, and streams the file. Point the iframe at that route. Separately, tighten the `playbook_nodes` policy from `auth.uid() is not null` to a predicate that checks the caller's l078 completion, or stop selecting `doc_content` from the browser and serve nodes through the gated route too.

> **Verifier:** WHAT I COULD NOT BREAK (confirmed):

1. The files are real and unauthenticated. `public/playbook/{01-submit-ad-bounties,02-build-your-portfolio,03-apply-to-brands}/index.html` exist (7.2M / 48K / 24K). There is NO middleware: `find . -name "middleware.*" -not -path "*/node_modules/*"` returns nothing. `next.config.ts` is the empty scaffold (no `headers()`, no `rewrites()`). `vercel.json` contains only the 5 cron entries, no `headers` block. Nothing shadows the path — the only app routes matching "playbook" are `src/app/dashboard/playbook/page.tsx` and `src/app/api/student/dismiss-playbook-welcome/route.ts`. Next serves `public/` at the root as static assets. The path is reachable logged-out.

2. The quoted lines are accurate, not invented. `src/components/playbook/PlaybookNodeSheet.tsx:163

---

### /admin/discounts renders approval rows as "Unknown" with ad verification silently reading false, on a money screen
*src/app/admin/(authenticated)/discounts/page.tsx:69 · fix: minutes* · not independently verified

**What happens:** The query is `.select("*, student:students(*)").gte("student.first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF)` — filtering an EMBEDDED resource without `!inner`. PostgREST does not drop the parent row for that; it returns the request with `student` set to null. The author knew the distinction — the dashboard's task count at admin/page.tsx:164 uses `students!inner` with a comment saying "!inner forces the join" — it is just missing here. So every discount request from a student whose `first_paid_at` is NULL or pre-launch still renders, and the UI reads it through optional chaining: `req.student?.name || "Unknown"` (:421) and `req.student?.ad_submissions_verified` (:451-460), which resolves `undefined` → falsy → the toggle displays as NOT verified.

**Cost:** Karlo sits on the approval screen looking at a 30%-off request from "Unknown", with the ad-submission verification flag rendering as unverified when the real stored value may be true. The cohort filter he believes is scoping this list is doing nothing to the row count. Either outcome is a wrong decision on a discount that costs real revenue, and neither looks like an error — it looks like a student with a missing name.

**Fix:** Change the embed to `student:students!inner(*)` so the cohort filter actually scopes rows, and render an explicit "data missing — do not approve" state rather than letting `undefined` collapse into a confident `false` on the verification toggle.

---

### OAuth callback treats ANY sign-in error as "new user", which hard-locks an existing student out
*src/app/api/auth/whop/callback/route.ts · fix: hours* · not independently verified

**What happens:** At line 254 the callback does `signInWithPassword({ email, password })` and then `if (signInError) { ...admin.createUser... }` — every failure mode is funnelled into the new-user branch. For a genuinely new student that is correct. For an EXISTING student whose sign-in fails for any other reason (Supabase auth rate limit / 429, a 5xx from the auth service, a transient network blip, or the student having changed their own password — see the set-password finding), `createUser` is then called with an email that already exists, Supabase returns "User already registered", and line 271-277 redirects to `/login?error=auth_failed`. The student retries, hits the identical path, and fails identically for as long as the condition holds. There is no distinction in the code between "wrong password" and "auth service is busy". Honest caveat: I cannot make network calls, so I have not confirmed which non-credential error shapes Supabase actually returns from this endpoint under load — the code path itself is unambiguous, the trigger frequency is what I can't verify.

**Cost:** A paying student cannot get into the product they paid for, and the screen blames them with a generic `auth_failed`. With 3,310 student rows and a shared Supabase auth project, a rate-limit burst during a launch-day login rush is the realistic trigger — exactly when the most people are logging in at once.

**Fix:** Branch on the error rather than its existence: only fall through to `createUser` when the error is the invalid-credentials code, and otherwise return a distinct `error=auth_unavailable` redirect that tells the student to retry in a minute. Better still, look the user up first (`admin.listUsers` filtered by the synthetic email) so "does this account exist" is answered by a query rather than inferred from a failed password attempt.

---

### The live discount Apply path never checks that R1+R2 are complete, and both eligibility checkers fail open if the lessons read returns nothing
*src/app/api/discounts/submit-feedback/route.ts:96 · fix: hours* · not independently verified

**What happens:** Two mechanisms. (a) submit-feedback is the endpoint the dashboard widget actually posts to (its own header says so at :23-25), and its 'Re-validate the eligibility window (server-side defense — same rule as /api/discounts/request)' comment is only half true: it checks first_paid_at and the 14-day deadline and then calls the RPC. It never runs the R1+R2 completion check that /api/discounts/request does at :122-182. The RPC (2026_v29_discount_feedback.sql:161-169) blocks duplicates but not incompleteness. A student inside their first 14 days can POST their own bearer token with any valid question_ids and land a pending request having watched nothing. (b) In both /request:135 and /approve:128, `required = requiredLessons ?? []`; the query error is never checked, so if the lessons read fails or returns empty the for-loop never executes, `missing` stays empty, and the student passes eligibility outright.

**Cost:** (a) puts ineligible requests into the pending queue with a W2.6 CSM task attached, in front of an admin whose UI offers a 'Generate anyway' override (approve/route.ts:40-44) — the money gate becomes one mis-click rather than a rule. (b) is the same failure class as finding 4 on a money path: a database hiccup silently converts 'has completed nothing' into 'fully eligible'. Neither leaks a promo code on its own — approve still re-checks and still requires the human ad_submissions_verified tick — but both weaken the last automated line before a real Whop discount is minted.

**Fix:** Lift the R1+R2 completion check out of /api/discounts/request into a shared helper and call it from submit-feedback before the RPC. In that helper, check the lessons query's .error and treat an empty required set as a hard failure (`if (required.length === 0) return ineligible`), never as a pass. Also swap LessonSheet.tsx:184 from discountAllLessonsDone to discountEligible so a student who finished R1+R2 after the window isn't shown an Apply button that answers 6 questions and then rejects them.

---

### /api/student/data returns HTTP 200 with plausible empty arrays when its queries fail, and the client shows them as real progress
*src/app/api/student/data/route.ts:135 · fix: hours* · **verified PARTIAL** — claimed high, corrected to medium

**What happens:** The route runs 15 queries in one Promise.all and never inspects a single .error — every field is serialised as `.data ?? []` or `?? null` (:134-151). A transient failure on the completions query returns 200 with completions: []. StudentContext.tsx:381 writes that straight into state, and refreshFromServer:483-520 does the same on every tab refocus. When the whole request fails, StudentContext.tsx:376-379 does `setLoading(false); return;` and the catch at :447 console.errors — there is no error state in the context at all, so the dashboard renders its normal success view.

**Cost:** A student with 40 lessons done opens the dashboard during a blip and sees zero completions, zero streak, every region locked, no error and no retry — the workspace's documented house failure, a wrong number that looks exactly like a right one. If the regions query is the one that fails, MapMockup.tsx:1657 maps over an empty array and they get the painted world with no regions drawn. Worst case is inside the 14-day discount window: the widget reads 'not eligible' while their clock runs out. It also silently corrupts support: the student reports lost progress, the DB says otherwise, and nothing was logged.

**Fix:** In the route, check .error on each result; if any of the structural reads (regions, lessons, completions) errored, return 500 with which one. In StudentContext, add an `error` to the context value, set it on !res.ok and in the catch, and render a retry state in dashboard/page.tsx instead of the success view. Cheap partial: post the failure to /api/client-event so it stops being invisible.

> **Verifier:** MECHANISM CONFIRMED, line for line.

route.ts:32-122 runs 15 queries in one Promise.all and inspects no .error. route.ts:133-151 serialises each as `.data ?? []` / `?? null`, e.g. :135 `regions: regionsRes.data ?? []`, :137 `completions: completionsRes.data ?? []`.

Verified this is a silent-null path, not a throw, in the vendored client: node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:400-434 — with shouldThrowOnError false (the default; the route never sets it) fetch failures resolve to `{ error: {...}, data: null, status: 0 }`; processResponse does the same for non-2xx. So one failed query yields HTTP 200 plus a plausible empty array.

Client: StudentContext.tsx:381-384 writes it straight into state (`const data = await res.json(); setRegions(data.regions ?? []); setLessons(

---

### submit-region-quiz still accepts a client-supplied score, bypassing the region gate
*src/app/api/student/submit-region-quiz/route.ts · fix: minutes* · not independently verified

**What happens:** Lines 139-155: when `body.selections` is absent, the route falls back to trusting `body.scorePct` verbatim — the exact hole v75.31 was written to close, left in deliberately as a transition-window fallback for old client bundles. But the shipped client at `src/contexts/StudentContext.tsx:1408-1411` now always sends `selections: selections ?? []`, and `MapMockup.tsx:2221` is the only call site and always passes `payload.selections`. So the legacy branch is no longer reachable by any real client — it survives purely as an attack surface. `curl -X POST /api/student/submit-region-quiz -H 'Authorization: Bearer <own token>' -d '{"regionId":"r4","scorePct":100}'` writes `best_score_pct=100` and stamps `quiz_passed_at` (line 175-190), which is sticky and never falls. The server-side scorer itself (`scoreServerSide`, lines 53-84) is correct — it divides by `cards.length` so a partial submission cannot inflate — the fallback is what undoes it.

**Cost:** The region gate stops being a gate for anyone who opens devtools. Secondary and more durable: `student_region_quiz` feeds the progress surfaces, so a faked pass quietly shifts the pace and stalled-task logic the CSM crons run on and the numbers on /admin/insights. A wrong progress number looks exactly like a right one.

**Fix:** Delete the `else` branch at lines 139-155 and return 400 when `selections` is not an array. The transition window is long over — v75.31 to v88 — and the `[region-quiz LEGACY]` console.warn that was added to monitor it can be checked in Vercel logs to confirm it has not fired before removing.

---

### toggle-lesson accepts any lesson id with no server-side validation, including watch-type lessons the UI deliberately hides the button for
*src/app/api/student/toggle-lesson/route.ts:42 · fix: minutes* · not independently verified

**What happens:** The route authenticates, derives the student from the JWT, and then inserts a student_lesson_completions row for whatever lessonId arrives — it never reads the lessons table. Its two sibling routes both do: skip-lesson/route.ts:61 refuses to skip requires_action lessons (added in v75.30 for exactly this reason) and mark-action-shipped/route.ts:62 validates too. LessonSheet.tsx:859 hides 'Mark complete' when `isWatchType` because video lessons are meant to arrive from the Whop watch sync — but nothing on the server enforces that. A student can POST every R1+R2 lesson id in a loop and be 100% complete in seconds, which also satisfies the sequential region unlock at StudentContext.tsx:740-752 (region quizzes allow unlimited retakes at a 50% bar).

**Cost:** Every progress number the team makes decisions on becomes self-reported: the kanban, /admin/insights/progress, the journey columns, the CSM task pool (nolessons.*/pace.* tasks get dismissed by reEvaluateStudentOpenTasks in the same request), and the automated half of discount eligibility. The human ad-verification tick still stands between this and a real discount, so this is a truth problem rather than a direct money leak — but it is the kind of truth problem that only shows up as a plausible number.

**Fix:** Mirror skip-lesson: fetch the lesson row first, 404 on unknown ids, and refuse to set completed_at when lesson.type === 'watch' (leave that column to the Whop sync and the course_lesson_interaction webhook). Keep the manual path for setup/action types where Karlo intends it.

---

### /dashboard-mockup ships to production without the membership gate
*src/app/dashboard-mockup/layout.tsx · fix: minutes* · not independently verified

**What happens:** `src/app/dashboard/layout.tsx` wraps its children in `StudentGuard` + `StudentProvider` + `MembershipBlockOverlay` (line 18). `src/app/dashboard-mockup/layout.tsx` wraps them in `StudentGuard` + `StudentProvider` and stops — no overlay. The page itself (`src/app/dashboard-mockup/page.tsx`) renders the real `MapMockup`, real `LessonSheet`, real student data from `useStudent()`, plus two dev panels: `SyncDebugPanel` and `PlaybookTestPanel`, the latter offering a `bountyAccessClaimedAt` override with `real | off | on`. It is a normal Next.js route, so it is live in production and reachable by typing the URL. Any student with a session — including a canceled one, per the membership finding — gets the full dashboard there with even the cosmetic block removed.

**Cost:** The single client-side gate that is supposed to stop non-paying students has a documented bypass one URL away. The debug panels only expose the caller's own sync metadata so nothing leaks there, but shipping a dev surface to 3,310 students is not what anyone intended.

**Fix:** Either delete the route (it is a dev mockup and `/dashboard` renders the same `MapMockup`), or add `<MembershipBlockOverlay />` to its layout and gate the two dev panels behind a team-member or allowlist check so they render for Karlo and Lovro only.

---

### past_due students are hard-blocked from a product they are still paying for, and the only exit offered charges them twice
*src/components/onboarding/MembershipBlockOverlay.tsx:32 · fix: hours* · **verified PARTIAL** — claimed high, corrected to medium

**What happens:** Whop marks a membership past_due during a failed renewal retry while valid stays true, so mapStatus (whop-members.ts:124) writes 'past_due'. The overlay blocks on anything !== 'active', so the dashboard is covered by a full-screen, non-dismissable panel. The student signs out and back in: the callback's dbHasActive (callback/route.ts:86-88) counts past_due as entitled, so login succeeds AND the v75.10/v85.6 self-heal at :147 is skipped entirely — nothing is written, the row stays past_due, the overlay fires again. The two buttons are Sign out and 'Renew on Whop' → a hardcoded checkout for plan_4ZrwR4PmBsVsx (:24). Clicking it buys a SECOND $97/mo membership while the first is still being retried. The codebase already documents this happening: whop-members.ts:554-557 lists 'a duplicate created by clicking Renew on the block overlay' as a known cause of multi-membership users.

**Cost:** A customer whose card hiccuped is locked out mid-cycle and the product's own UI walks them into a double charge. Recovery does not exist in-app: only a Whop payment.succeeded webhook, a sync run that actually reaches them (see known defect 1 — the newest ~5,000 of 8,269 memberships, so an older customer may never be reached), or Karlo editing the row by hand. The same row is simultaneously counted as an active paying student by admin/page.tsx:121, insights/progress/page.tsx:1538 and cron/snapshot-progress/route.ts:142 — the business says they are active, the product says they are not.

**Fix:** Decide one definition of entitled and use it in both places. Cheapest correct version: treat past_due as access-granting in the overlay (block only canceled/expired), matching the login gate and every admin surface. Then make the overlay's CTA a Whop billing/manage-payment link rather than a fresh checkout URL, and let the callback run the self-heal whenever the DB row is not 'active' rather than only when it is not active-or-past_due.

> **Verifier:** WHAT SURVIVED (I could not break the core defect)

The path is reachable end to end, and every cited line is real.

- `src/components/onboarding/MembershipBlockOverlay.tsx:32` — `if (student.membership_status === "active") return null;`. Anything else, `past_due` included, renders a `fixed inset-0 z-[200]` panel with no close button (`:39`, `:26-33`). The file's own header comment at `:8-9` states the intent outright: block when status is "anything other than active (i.e. canceled | past_due | expired)". Not a misread — a deliberate choice that contradicts the rest of the system.
- It is mounted over every student route: `src/app/dashboard/layout.tsx:18`, inside `StudentGuard` (which only checks auth, `src/components/auth/StudentGuard.tsx:12-31` — no status logic, no second guard).
- `stud

---

### The only throttle on the Whop-facing sync is a per-instance ref, so a remount resets it — the exact hole the module-level gates were built to close
*src/contexts/StudentContext.tsx:581 · fix: minutes* · not independently verified

**What happens:** call-gate.ts:17-18 states the rule: 'Gates are MODULE-level by design, never a ref or state: if the loop is driven by remounts, a per-instance gate resets each time and never holds.' Two gates follow it (profileGate, studentDataGate). The third path does not: runSilentSync's 30s throttle is `lastSyncAtRef = useRef(0)` (:581) and the once-per-mount guard is `hasAutoSyncedRef = useRef(false)` (:643). StudentProvider is mounted by dashboard/layout.tsx, so navigating /dashboard → /journal → /dashboard unmounts and remounts it, resetting both. On each remount it POSTs /api/student/refresh-watch-sync — the most expensive call in the app (outbound Whop course_lesson_interactions fetch, up to 5 pages, plus completion upserts, streak recalc and achievement evaluation) — and then calls refreshFromServer with { throttled: false } at :603, deliberately bypassing the 5s module gate, which in turn calls setStudent and re-triggers the ungated [student] effect at :463 for a second /api/student/data.

**Cost:** This is the honest answer to 'what drives the loop that the gates cap rather than fix': they do not cap this path at all. A remount-driven or navigation-driven loop produces uncapped Whop API calls plus two /api/student/data fetches per cycle, and because the burst is Whop-facing it can also trip Whop's ~10 req/s Cloudflare limit for the whole app, not just that student. The candidate CONTEXT.md names first (setStudent → [student] effect) is real but amplifies 1:1, not infinitely — fetchData never calls setStudent, so that cycle is not closed.

**Fix:** Move both refs to module-level createCallGate instances, the same way fetchProfile and refreshFromServer already are — createCallGate('silentSync', 30_000) and a module-level hasBootstrapped flag. That alone makes the remount case behave. Then have runSilentSync's follow-up refresh pass a longer-interval gate rather than { throttled: false }, so the one uncapped caller left is genuinely user-initiated (forceSync).

---

### The access safety net reads only 10 memberships, so a paying student can be hard-blocked with no self-service recovery
*src/lib/whop-members.ts:271 · fix: hours* · **verified PARTIAL** — claimed high, corrected to medium

**What happens:** `fetchActiveMembershipForUser` is the single function that answers "does this user still have access anywhere?" for the two writers that can revoke access. Strategy 1 (:271) requests `?user_id=…&per_page=50` with no `page` param and no loop — `per_page` is ignored, so it sees the user's newest 10 memberships, full stop. Strategy 2 (:330-332) adds `product_id=` with the same invalid plan ids, which Whop ignores, then post-filters on `r.user === whopUserId` (:340) — it is functionally a repeat of strategy 1, not an independent fallback. Now: `membership.deactivated` fires for a user (webhooks/whop/route.ts:198), their live EcomTalent membership is older than their 10 newest rows (a user who has claimed free products, a bounty product, or re-subscribed several times), so `surviving` comes back null and route.ts:226-234 writes `membership_status='canceled'`. `MembershipBlockOverlay` (MembershipBlockOverlay.tsx:32) then hard-blocks the dashboard. The student logs out and back in to fix it — and the OAuth self-heal calls the SAME truncated function (auth/whop/callback/route.ts:148), gets null again, and writes nothing.

**Cost:** A fully paid student is locked out of the dashboard, their streak, their map and their discount claim, and the documented escape hatch (re-login, added in v85.6 precisely for Kelvin Nguyen's 2026-07-29 lockout) cannot clear it. Their only remaining CTA is the overlay's Renew button, which per the v85.6 comment at whop-members.ts:561 is itself how duplicate memberships get created — so the student pays twice to escape a bug. Whop-native course content keeps working, which is exactly what makes this hard to diagnose from a support ticket: the student says "I can watch the videos but the dashboard says I'm cancelled."

**Fix:** Paginate strategy 1 properly — `per=50` plus the `page` / `total_page` loop that `fetchEarliestMembershipDateForUser` (:463-496) already implements correctly, and which already lives in this same file. Delete strategy 2 or give it a real `prod_` id; as written it adds latency and no coverage. Borrow the `allMatchUser` throw-rather-than-write discipline from :479-484 so a silently-ignored filter can never be read as "no access found".

> **Verifier:** MECHANISM — CONFIRMED, every line checks out.

MembershipBlockOverlay.tsx:32 `if (student.membership_status === "active") return null;` — past_due gets the full-screen, non-dismissable panel. Mounted dashboard/layout.tsx:18. The student row it reads is the live DB row (api/auth/me/route.ts:37-40 `select("*")` → AuthContext.fetchProfile → setStudent), so no staleness excuse.

callback/route.ts:86-88 `dbHasActive = active || past_due`; callback/route.ts:147 `if (!dbHasActive)` gates the v85.6 self-heal. A past_due row therefore logs in successfully AND skips repair — nothing is written, the row stays past_due, the overlay fires again. Re-login is a no-op. That is the claim's core and it is correct.

THE SHARPEST PART, which the claim under-sells: this directly contradicts the repo's own docu

---

### first_paid_at computed over a truncated membership history can open a fresh 14-day discount window for a long-tenured customer
*src/lib/whop-members.ts:546 · fix: hours* · not independently verified

**What happens:** `fetchAllMemberships` computes `_firstPaidAt` as the earliest `created_at` across the rows it SAW (:546-551). It only ever sees the newest ~5,000 of 8,269 memberships — the prior audit dates that boundary at roughly 2025-11-13 (system-docs/etfb_access_audit_2026-09-10.md:170). For a row the sync INSERTS fresh, whop-sync-runner.ts:287-288 writes that value verbatim as `first_paid_at`. So a customer who first paid in mid-2025, was never in `students` (never OAuth'd, webhook predates the wiring), and appears today gets `first_paid_at` = their earliest VISIBLE membership, which can be months late or even today's date. The monotonic guard at :289-296 only prevents the value moving FORWARD on later runs — it cannot detect that the initial value was already wrong.

**Cost:** Three downstream consumers read that date as truth. discounts/request/route.ts:97-112 anchors the 30% discount window on it, so a customer 10 months into their tenure can be handed a fresh 14-day window — the precise leak v75.18/v75.20 were written to close. `isInLaunchCohort` (metrics-definitions.ts:108) wrongly admits them to the launch cohort, polluting the founder-facing month-2 conversion KPI in both numerator and denominator. And `sprintDayNumber` (constants.ts:57) drives the day-28 DM and the CSM tier ladder off it, so a long-time customer can land in the not-activated pool and get a "you haven't started, day 3" nudge.

**Fix:** Falls out of the pagination fix — once the sync can see the whole account, `_firstPaidAt` is computed over the real history. Until then, do not let the sync be the INSERT-time author of `first_paid_at`: on a fresh insert, route through `fetchEarliestMembershipDateForUser` (whop-members.ts:447), which paginates correctly and throws rather than guessing.

---

### Sync health is written to two audit tables and read by nothing
*src/lib/whop-sync-runner.ts:568 · fix: hours* · not independently verified

**What happens:** `logSyncRun` writes `fetched / inserted / updated / skipped / errors / duration_ms` to `sync_runs` on every run, and `cron-auth.ts:81,116` writes start/finish rows to `cron_runs`. Grepping the whole of `src/` for either table name returns only the writers — no admin page, no API route, no alert reads them. The one number that WOULD expose the truncation, `result.fetched`, is a count of unique users (~3,310) against an account of 8,269 memberships, so even if it were displayed it reads as a plausible community size rather than a 40% shortfall. The unknown-plan signal is a `console.warn` in a Vercel log (whop-sync-runner.ts:185). And the failure mode that matters most — a 300s timeout — writes NO row to either table, so its signature is an absence, which no one is watching for.

**Cost:** Every defect in this area is silent by construction. The sync can stop working entirely and the admin dashboard keeps rendering the same confident numbers off a `students` table frozen at whenever the last successful run was. This is the documented house failure mode: the wrong number looks exactly like the right one, and there is no surface where anyone would notice.

**Fix:** One tile on /admin: last successful `sync_runs` row (age, fetched, errors), red past ~4h given the 2-hourly cadence. Add a `cron_runs` staleness check for rows stuck at `status='running'` — that is the timeout signature and it costs one query. If `DISCORD_TEAM_WEBHOOK_URL` is confirmed set, route a failed/stale sync through `postTeamAlert` alongside the existing engagement alerts.

---

## LOW  (9)

### DISCORD_TEAM_WEBHOOK_URL is missing from both the local env file and the documented env contract
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/CONTEXT.md:523 · fix: minutes* · not independently verified

**What happens:** .env.local defines `DISCORD_WEBHOOK_URL` (empty) — a name referenced by zero lines of code. The name the code actually reads, DISCORD_TEAM_WEBHOOK_URL (discord.ts:35), appears nowhere in .env.local. CONTEXT.md's Integrations table at line 523 lists only DISCORD_BOT_TOKEN for Discord, omitting DISCORD_TEAM_WEBHOOK_URL entirely (and also omitting CRON_SECRET, ADBOUNTY_WEBHOOK_SECRET, STUDENT_AUTH_SECRET and PKCE_COOKIE_SECRET). When unset, postTeamAlert returns {ok:false, reason:"env-var-missing"} after a console.warn, and every caller treats that as a non-event: check-engagement records it into a response field nobody reads, check-na-tasks wraps it in a try/catch that only warns, and all of them call logCronFinish("success") anyway.

**Cost:** If the variable is also missing or misnamed in Vercel, the team channel is silent and four crons alert nobody — with green cron_runs rows behind them. The wrong name sitting in the tracked env file is the most likely mechanism by which the production variable ended up wrong too. ADBOUNTY_WEBHOOK_SECRET has the same exposure: it is absent from .env.local and undocumented, and if unset in production the adbounty webhook 401s every delivery, so bounty_access_claimed_at is never stamped and the Playbook never unlocks via bounty.

**Fix:** Rename DISCORD_WEBHOOK_URL to DISCORD_TEAM_WEBHOOK_URL in .env.local, add both it and ADBOUNTY_WEBHOOK_SECRET to the CONTEXT.md Integrations table, and confirm both in the Vercel project settings. Then make the silence loud: have check-engagement call logCronFinish("failed") when it produced alerts but postTeamAlert returned reason "env-var-missing", so a mute channel shows up in the audit table instead of nowhere.

---

### Student-facing cohort rank never applies the launch cutoff its own docblock promises
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/app/api/student/cohort-stats/route.ts · fix: minutes* · not independently verified

**What happens:** The docblock at :20-22 states step 2 is "Join to students for joined_at + filter by ADMIN_STUDENT_JOIN_CUTOFF so pre-launch test rows don't pollute the rank". The actual query at :67-71 is `.from("student_lesson_completions").select("student_id, completed_at, students!inner(joined_at, first_paid_at)").eq("lesson_id", PLAYBOOK_UNLOCK_LESSON_ID).not("completed_at","is",null)` — there is no .gte on first_paid_at, no cutoff, no paying-plan filter, and no pagination.

**Cost:** A student finishing the sprint sees "Cohort rank N of M" in the graduation modal where M includes pre-launch and test accounts, and N is pushed down by any fast pre-launch finisher ahead of them. It reads as a perfectly normal rank. It will also silently truncate at 1000 once that many people have completed l078. Low blast radius — it is a vanity stat in a celebration modal, nothing downstream consumes it — but it is a student-visible number that does not match its own documented definition.

**Fix:** Add .gte("students.first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF) (and the paying-plan filter, to match every other cohort surface) to the query at :67-71, or correct the docblock to say the rank is all-time across every account. Wrap in fetchAllRowsPaginated while you are there.

---

### Genuinely dead code: one documented-as-live library, one orphaned API route, six unrendered components
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/src/lib/sop-templates.ts · fix: minutes* · not independently verified

**What happens:** Verified by grep across all of src/, excluding each symbol's own defining file. src/lib/sop-templates.ts exports SOP_TEMPLATES and renderSopTemplate; zero references anywhere, yet CONTEXT.md:508 lists it in the Key Libraries table as 'SOP scaffolding' alongside genuinely live modules. src/app/api/admin/run-task-crons/route.ts is correctly authed (requireTeam plus a founder/admin role check) but has no caller: tasks/page.tsx:246 says "Replaces the v59-era run-task-crons trigger" and refresh-everything/route.ts:15 says it replaced the same trio. Six components totalling 1,610 lines have zero imports and zero JSX references: QuizView.tsx (358), WorkshopCabinet.tsx (522), CloudTransition.tsx (308), MapLegend.tsx (275), ProgressDial.tsx (91), MapControls.tsx (56). Two dead exports in whop.ts: checkActiveMembership (superseded by checkActiveMembershipDiagnostic, which callback/route.ts:6 actually imports) and refreshWhopTokens. Note I checked and cleared several false positives — withLockRetry, isActiveMember, buildInternalNote and parseInternalNote are all consumed inside their own modules and are NOT dead.

**Cost:** Low. Nothing here can produce a wrong number or cut off a student. The one line that can mislead is CONTEXT.md:508, which presents a zero-consumer module as part of the live library set — a dev looking for SOP handling will read and try to extend code that runs nowhere. run-task-crons is a second, undocumented path that fires two production crons; harmless while authed, but it is a live endpoint nobody knows about.

**Fix:** Delete sop-templates.ts and its CONTEXT.md row together. Delete run-task-crons/route.ts, or document it as the deliberate manual fallback if Karlo still uses the URL directly. Leave the six components until someone is already in those files — they cost nothing but reading time, and QuizView in particular may be intentional dead stock for the legacy quiz that /api/student/submit-quiz still serves.

---

### system_contracts.md files the three newest live tables under "Legacy / archive (do not extend)"
*/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/system_contracts.md · fix: hours* · **verified PARTIAL** — claimed high, corrected to low

**What happens:** Line 340 opens `## Legacy / archive (do not extend)`. Every `###` after it inherits that heading: `lessons_archive` (342), `student_task_completions` (345), `checkpoints` (349), then `stats_saved_views` (v86, line 353), `etfb_team_links` (v87, line 383), `etfb_seat_decisions` (v87, line 431), and `Whop Stats API` (line 460). The last four are the most recently built and most actively changed surfaces in the repo — v86 through v88 are the last 20 commits. Separately, the same file describes four dropped tables in present tense: `student_rewards` + `hidden_rewards` (line 332) as "Depended on by: reward reveal UI", `student_task_completions` as "Kept for historical reference", `checkpoints` as "Kept for archived dashboards". All four were dropped in 2026_v3_expedition_restructure.sql lines 136, 137, 144, 146. And four live, actively-read tables have zero entry anywhere in the file: `achievements`, `student_achievements`, `student_region_quiz`, `student_lesson_ratings` (grep count for all four in system_contracts.md: 0).

**Cost:** The doc's own closing instruction is "Find the table you're changing. Look at 'Depended on by' — every entry there is a consumer to check." A dev changing `etfb_team_links` or `stats_saved_views` reads a 'do not extend' banner over a table they were told to extend, and a dev changing `student_lesson_ratings` or `student_region_quiz` finds no consumer list at all and ships a column change blind. The phantom-table entries are worse than known item 4's CONTEXT.md version because these ones carry a fabricated consumer ('reward reveal UI') that reads like a live dependency.

**Fix:** Move `stats_saved_views`, `etfb_team_links`, `etfb_seat_decisions` and the Whop Stats API block above line 340. Replace the four dropped tables' entries with a single 'Dropped in v3 — do not reference' line naming the migration. Add entries for `achievements`, `student_achievements`, `student_region_quiz`, `student_lesson_ratings` with their real consumers (achievements.ts + AchievementsButton.tsx; submit-region-quiz + student/data; rate-lesson + student/data + admin/feedback/lessons).

> **Verifier:** Every factual assertion in the claim verified exactly. Nothing invented, nothing misread. I could not break the facts — only the consequence and the novelty.

VERIFIED AS STATED
1. Heading inheritance is real. `system_contracts.md:340` is `## Legacy / archive (do not extend)`. The next `##` is `## How to use this when making a change` at :482. Every `###` between them inherits it: `lessons_archive` (:342), `student_task_completions` (:345), `checkpoints` (:349), `stats_saved_views (v86)` (:353), `etfb_team_links (v87)` (:383), `etfb_seat_decisions (v87)` (:431), `Whop Stats API ... (v86)` (:460). Confirmed by `grep -n "^#\{1,3\} "`. v86–v88 are indeed the last 20 commits (`git log --oneline -20` runs 92df507 v86.1 → 81f4cf2 etfb).
2. Phantom tables are real and the consumer is fabricated. 

---

### /admin/set-password has no team check — a student can brick their own login there
*src/app/admin/set-password/page.tsx · fix: minutes* · not independently verified

**What happens:** The page reads `supabase.auth.getSession()` and, if any session exists, shows a password form that calls `supabase.auth.updateUser({ password })`. It never checks `team_members` — it only checks that somebody is logged in. A student session satisfies that. If a student navigates there and sets a password, their synthetic auth user `<whop_user_id>@whop.ecomtalent.com` no longer matches `generateStudentPassword(whopUserId)` — the HMAC-SHA256 the OAuth callback computes at `src/lib/whop.ts:300-304`. On their next Whop login the callback's `signInWithPassword` fails, falls into the new-user branch, `createUser` errors with "already registered", and they get `/login?error=auth_failed` forever. There is no privilege escalation here — `team_members` membership is still the gate for everything admin — and the student cannot reach the admin UI. The damage is self-inflicted lockout with no self-service recovery.

**Cost:** A student who wanders into an admin URL permanently loses access to the product and the error gives Karlo nothing to diagnose from. Low likelihood (they have to find the route), but the recovery requires a manual Supabase password reset by hand.

**Fix:** Add a team check to the page: after `getSession()` succeeds, query `team_members` for the session user id and render "not authorized" otherwise. This is the same check `TeamGuard` already performs via `useAuth().isTeam`, so the page can simply be wrapped in `TeamGuard` — note it currently sits outside the `(authenticated)` route group, which is why it never inherited one.

---

### The OAuth handoff puts access + refresh tokens in a JS-readable cookie
*src/app/api/auth/whop/callback/route.ts · fix: hours* · not independently verified

**What happens:** Lines 437-450 set a `pending_session` cookie containing both `access_token` and `refresh_token` as JSON, with `httpOnly: false` and an explicit comment that client JS needs to read it. `/auth/complete` reads it at line 85-87 and clears it at line 126. The window is 60 seconds (`maxAge: 60`) and `secure: true` is set. But during that window the full session — including the refresh token, which as established above is never revoked on cancellation — sits in a cookie readable by any script running on the app origin, and is attached to every request to every path on the domain including `/playbook/*` static assets. Any XSS, any compromised npm dependency executing at page load, any future third-party tag added to the app, reads it.

**Cost:** A stolen refresh token is a permanent student session — nothing in the codebase expires or revokes one. This is a deliberate architectural tradeoff and the 60-second cap is a real mitigation, so I am rating it on the exposure rather than on an exploit I can demonstrate.

**Fix:** Hand the session over server-side instead: set the Supabase auth cookies directly in the callback response using `@supabase/ssr`'s cookie helpers (the journal page and stats page already use `createServerClient` with the cookie store, so the dependency and pattern are both present), and drop `/auth/complete` and the `pending_session` cookie entirely. If the client-side handoff must stay, shorten `maxAge` to 10 seconds and scope the cookie to `path: "/auth/complete"` so it is not attached to every other request.

---

### Membership is enforced only in the browser — a canceled student keeps full API access
*src/components/onboarding/MembershipBlockOverlay.tsx · fix: hours* · **verified PARTIAL** — claimed high, corrected to low

**What happens:** `membership_status` appears in exactly zero files under `src/app/api/student/` — I grepped the whole tree. Every one of the 16 student routes, plus `/api/auth/me`, authorizes on the Supabase JWT alone and never asks whether the person is still paying. The only enforcement in the product is `MembershipBlockOverlay.tsx:32` — `if (student.membership_status === "active") return null;` — a React component mounted at `src/app/dashboard/layout.tsx:18` that paints a `position: fixed` div over the page. Meanwhile the Whop webhook's cancellation branch (`src/app/api/webhooks/whop/route.ts`, `membership.deactivated` case) does exactly one thing: `UPDATE students SET membership_status='canceled', canceled_at=now()`. It never calls `auth.admin.signOut`, never deletes the auth user, never revokes the refresh token. So the student's session stays alive and refreshable indefinitely. Concretely: student cancels or refunds, webhook fires, they reload the dashboard, see the block overlay — and then hit `GET /api/student/data` with the token already in their localStorage and get the full payload back with a 200.

**Cost:** People who stopped paying keep the product. It reads as blocked to Karlo and to the student, which is why it would never surface as a complaint. Honest scoping: the lesson VIDEOS are Whop-hosted and Whop gates those independently, so the loss is not the whole course — it is the map, all progress state, the quizzes, the Playbook, and every route that writes to our DB. It is still a money path that silently does not close.

**Fix:** Add a `requireActiveStudent(request)` helper next to `requireTeam` that does the existing JWT → `supabase_user_id` lookup AND rejects when `membership_status !== 'active'`, then route all 16 `/api/student/*` handlers through it (they already share the identical 20-line preamble, so this is a mechanical swap). Decide deliberately how `past_due` should behave — today the overlay blocks it while the login callback lets it in, so those two disagree. Optionally also revoke the Supabase session in the webhook's cancel branch so the token dies with the subscription.

> **Verifier:** MECHANISM: CONFIRMED, every line quoted is real. CONSEQUENCE: overstated by a wide margin. Not a known-list item.

WHAT I COULD NOT BREAK (all verified):
- `grep -rn "membership_status" src/` returns zero hits anywhere under `src/app/api/student/`. All 16 student routes plus `src/app/api/auth/me/route.ts` use the identical pattern: Bearer header → `supabase.auth.getUser(token)` → service-role client (`SUPABASE_SERVICE_ROLE_KEY`, so RLS is bypassed) → `students` lookup by `supabase_user_id`. No route asks whether the person still pays. `src/app/api/student/data/route.ts:5-29` is the template.
- No `middleware.ts` exists anywhere in `src/` (`find src -maxdepth 2 -name "middleware*"` → empty). There is no edge guard.
- `src/components/onboarding/MembershipBlockOverlay.tsx:32` is verbatim `if 

---

### whopFetchWithRetry honours Retry-After uncapped, despite a comment claiming a 30s cap
*src/lib/whop-members.ts:49 · fix: minutes* · not independently verified

**What happens:** `let waitMs = !isNaN(retryAfterSec) ? retryAfterSec * 1000 : Math.min(30_000, 1_000 * Math.pow(2, attempt));` — the `Math.min(30_000, …)` guard applies only to the exponential-backoff `else` branch. The `Retry-After` branch multiplies Whop's header by 1,000 and sleeps for exactly that, with `maxRetries = 5` (:34). The comment directly above at :43-44 states "exponential backoff (1s, 2s, 4s, 8s, 16s) capped at 30s", which describes behaviour the code does not have on the path that actually fires. The sync drives ~1,000 requests per run through this wrapper at roughly 5/sec, which is the regime where Cloudflare 1015 responses appear.

**Cost:** A single `Retry-After: 60` inside a 300s function consumes a fifth of the budget; a few of them end the run. Because the sleep is inside the fetch loop that precedes every write (whop-sync-runner.ts:65), the cost is not a slow sync — it is a sync that produces nothing and logs nothing, indistinguishable from the timeout in finding 1. Fine in a 300s cron with headroom; there is no headroom here.

**Fix:** Apply the cap the comment already promises: `waitMs = Math.min(30_000, …)` across both branches, and bail out of the page loop with an explicit partial-run error when cumulative elapsed time crosses a budget, so a truncated fetch is recorded as a failure in `sync_runs` rather than silently upserting a partial view of the account as if it were complete.

---

### Watch-sync trusts Whop's v1 user_id filter with no verification that returned rows belong to the student
*src/lib/whop.ts:377 · fix: minutes* · not independently verified

**What happens:** fetchCompletedLessonsAsAdmin queries the v1 endpoint course_lesson_interactions with course_id + user_id filters and then maps straight to lesson ids (:398-405) without ever checking i.user.id, even though the type carries it (types/whop.ts:53-56). The same file family guards this exact risk everywhere else it matters: fetchActiveMembershipForUser aborts strategy 1 if it sees another user's rows (whop-members.ts:294-300), and fetchEarliestMembershipDateForUser throws rather than attribute another user's date (:465-470). Both guards exist because v1 list filters are known in this workspace to be silently ignored.

**Cost:** If that filter is ever ignored — a v1 API change, a deprecation, a malformed user id — syncWatchProgress would upsert every returned lesson as completed for whichever student triggered the sync, silently, with a plausible 'Synced N lessons' message. That marks work complete that was never done, unlocks regions, satisfies the automated half of discount eligibility, and corrupts every progress metric at once. UNVERIFIED: I made no network calls, so I cannot say whether v1 honours user_id here today. The evidence that it currently does is indirect — students are not all showing 100%. The finding is the missing guard, not a confirmed break.

**Fix:** One line in the filter at whop.ts:405: drop any interaction whose i.user?.id !== whopUserId, and if any were dropped, write that count into student_whop_sync.last_sync_error so it surfaces in the debug panel instead of failing silently. Same shape as the guard already in whop-members.ts:294-300.

---

## What the inspection found healthy

- The sync never deletes rows and never mass-cancels members it did not see. A membership that falls outside the 5,000-row window goes STALE, it does not go terminal — `upsertRows` is built only from rows actually returned (whop-sync-runner.ts:156-388). That single design choice is the reason the pagination ceiling has not mass-locked-out the entire pre-2025-11 back catalogue. It is the most important correct thing in this area.
- The v85.6 per-user dedupe in `fetchAllMemberships` (whop-members.ts:568-577) is right: access wins over recency, recency only breaks ties within the same access class. The matching webhook fix (webhooks/whop/route.ts:198-224) re-points the row at a surviving membership instead of revoking. The logic is correct — it is only the truncated lookup feeding it that is broken (finding 2).
- The v75.59 uniform-keys discipline plus the pre-write tripwire at whop-sync-runner.ts:395-407 is a genuinely good guard. It encodes a real, hard-won understanding of how postgrest-js computes `?columns=` as a union across the batch, and it fails the whole run loudly rather than letting a silent NULL wipe through. That is the right trade.
- The `first_paid_at` invariant is enforced in two independent places and both are correct: the monotonic "only ever moves earlier" comparison at :289-296, and the `.is("first_paid_at", null)` predicate on the recovery update at :501 so a no-op cannot inflate the recovered counter.
- `fetchEarliestMembershipDateForUser` (:447-499) is the one Whop call in this file that does it properly — it paginates on `total_page`, and it THROWS rather than writing when the `user_id` filter looks ignored (:479-484). That assert-the-filter-worked discipline is exactly what every other call in the module is missing.
- `mapStatus` trusting `row.valid` ahead of the status string (:120-145) is the correct trust order, and the `completed` → active handling for lifetime/free/one-time plans is right.
- The existing-row prefetch batches `.in()` at 500 and hard-aborts the whole sync on any batch error (:107-132) rather than treating missing rows as new. The comment explaining why (transition detection silently failing → churn under-reported) shows the failure was understood, not just patched.
- `src/lib/etfb.ts` deliberately refuses to share pagination code with `whop-members.ts`, uses the correct `per=` param, and throws on all three silent Whop traps including checking against a LIVE account total rather than a hardcoded one. It is the model the rest of the Whop layer should be rewritten against — the right answer already exists in this repo.
- `metrics-definitions.ts` genuinely succeeded at centralising the admin predicates, and the `RENEWAL_GRACE_MS` note (:132-183) is the best piece of documentation in the codebase: it shows the histogram, names the valley the threshold sits in, and tells the next reader to re-run the histogram before changing it. That is how a calibrated constant should be written down.
- CONTEXT.md's metrics and Whop sections are the best documentation in the repo and are accurate against the code. The Month-2 warning block, the two-defect post-mortem (arity bug, then the 98% tautology), the RENEWAL_GRACE_MS pointer, and the 'check whether its value has ever actually moved' instruction all check out and are written exactly the way this failure class needs to be written.
- The cron documentation is correct and non-obvious. vercel.json holds 5 schedules; CONTEXT.md lists 6 routes and explicitly states day28-dm has no trigger and the route is retained for manual fire. The v85.5 offset chain (:00 sync, :10 engagement, :15 csm-tasks, :20 na-tasks) is documented as load-bearing with the reason, and the code matches.
- src/lib/etfb.ts deliberately shares no pagination code with whop-members.ts, and CONTEXT.md documents exactly why — so the per_page truncation defect cannot be inherited. That is the right call recorded in the right place.
- system-docs/decision_log.md's 2026-08-27 and 2026-09-03 entries are accurate, specific, and carry the mechanism, not just the verdict. The call-gate entry ('cap the loop instead of hunting its trigger') matches src/lib/call-gate.ts line for line.
- The admin nav's role gates match their documented intent, with the reasoning inline: /admin/etfb is deliberately neither founderOnly nor csmHidden because Astrid is role='csm' and either flag would hide her own work queue (layout.tsx, v87 comment).
- /admin/lessons is a proper redirect shim to /admin/feedback/lessons with a comment explaining that old bookmarks shouldn't 404 — a deliberate compatibility artifact, not rot.
- The dead-code surface is genuinely small for a repo this size. Most of what my first automated sweep flagged (withLockRetry, isActiveMember, buildInternalNote, parseInternalNote) turned out to be consumed inside its own module. Real dead code is under 2,000 lines across 8 files.
- Cron auth is the best-built piece in this area. src/lib/cron-auth.ts:39-65 checks unconditionally (a missing CRON_SECRET locks the route rather than opening it), trims whitespace on both sides, returns a structured reason instead of a bare 401, writes a cron_runs row even on auth failure, and emits a greppable [CRON_AUTH_FAIL] marker so Vercel's log filter surfaces it when the DB write also fails. Every one of the six routes uses it identically.
- The v75.59 uniform-keys tripwire at src/lib/whop-sync-runner.ts:400-407 is exactly right: it proves every upsert row carries an identical key set and aborts the whole sync loudly rather than let postgrest-js's columns-union NULL a batch-mate's stored value. A failed sync is recoverable, a silent wipe is not, and the code says so. This is the correct response to the 2026-06-11 incident.
- PostgREST's ~1000-row server cap is handled deliberately rather than papered over with .limit(). check-csm-tasks pages tasks and student_milestones through fetchAllRowsPaginated with an explicit stable ORDER BY (route.ts:184-224), snapshot-progress does the same for the active pool and the progress view, and each site carries a comment naming what breaks without it. The reasoning about why .limit(50000) does not bypass a server cap is correct.
- The deliberate 500-on-DB-error choice in the Whop webhook (v75.30, at lines 176-182, 236-245, 306-318, 352-362, 418-429) is the right call — Whop's Standard Webhooks contract drives retries off HTTP status, and returning 200 on a transient Supabase error was silently losing lesson completions and renewals. The distinction between 'retry will help' (500) and 'retry cannot help' (200 + warn, for a student row that does not exist yet) is drawn correctly.
- first_paid_at is protected consistently across every writer. It is INSERT-only on both webhook paths via a pre-fetch (route.ts:143-170 and 279-300), never moves forward in the sync (whop-sync-runner.ts:284-295), is written under a `.is("first_paid_at", null)` guard in the recovery pass, and v75.58 explicitly refuses a joined_at fallback rather than fabricate a date that anchors both cohort membership and the discount window.
- The adbounty webhook is clean: timingSafeEqual with a length pre-check (route.ts:51-56), correct status-code semantics (401/400/404/200), and real idempotency via an already_claimed read plus an `.is(null)` conditional update that survives two parallel deliveries. It is the model the Whop webhook's signature comparison should copy.
- isDmEnabled (src/lib/dm-toggles.ts:45-47) fails closed — it requires both the master switch and the specific switch to read exactly "true", so a missing row, a broken query, or a typo'd value silences sends rather than blasting students. Correct default for anything that talks to a customer.
- check-csm-tasks short-circuits to logCronFinish("failed") on every bulk-fetch error including the paginated ones (route.ts:228-241 and 529-540), with comments naming the specific corruption avoided — running section 3c against an empty milestones set would make every student look never-logged-in and mass-dismiss valid tasks. It is the only cron that reasons about partial-read damage, and it reasons about it correctly.
- Every one of the 30 admin API handlers gates, with no exceptions and no weak siblings. 26 go through `requireTeam` / `requireStatsOwner`; `refresh-everything` (lines 47-55) and `run-task-crons` (lines 27-35) add an inline founder/admin check after `requireTeam` because CSM must not trigger production crons; `backfill-discord-ids` uses Bearer CRON_SECRET; `backfill-first-paid-at` accepts either and fails CLOSED when the secret is unset (line 57: `if (cronSecret && authHeader === ...)`); `verify-ad-submissions` does its own `team_members` lookup at lines 44-52. I checked every exported handler in every file, including the second and third methods in multi-method files like `templates/[id]` (GET/PUT/DELETE) and `stats/views` (GET/PUT/DELETE).
- No IDOR anywhere on the student surface. All 16 `/api/student/*` routes derive identity the same way — `supabase.auth.getUser(token)` then `.from("students").eq("supabase_user_id", user.id)` — and every write scopes on that derived `student.id`. Not one of them reads an id from the request body. The two routes that historically DID trust `body.studentId` were fixed and now say so explicitly in code: `discounts/request/route.ts:46-47` ("Server-derived; body.studentId (if any) is ignored") and `discounts/submit-feedback/route.ts:71`. `supabase_user_id` is UNIQUE in the schema, so the `.single()` lookups cannot return someone else's row.
- The `/admin/stats` founder gate is airtight in all three layers and they agree. Page: `stats/page.tsx:72` redirects on `!isStatsOwner(user.id)` and awaits `cookies()` specifically to force dynamic rendering so it cannot be prerendered like its siblings. API: `requireStatsOwner` in `admin-auth.ts:139-152`. Table: `stats_saved_views` RLS is `using (public.current_user_is_stats_owner())`. The uuid literal matches exactly between `STATS_ALLOWED_USER_IDS` (`admin-auth.ts:117`) and the SQL function (`2026_v86_stats_saved_views.sql:40`) — `2ba35d07-fdf3-41ee-87c2-4fa2e7711dfb`. Keying on the immutable `auth.users` id instead of the mutable `team_members.role` is the correct call, and the reasoning for it is written down in both files.
- Both webhooks verify signatures before touching anything. `/api/webhooks/whop` implements the Standard Webhooks scheme over `${id}.${timestamp}.${body}` and tries both the base64-decoded and raw-string key interpretations; `/api/webhooks/adbounty` uses HMAC-SHA256 with `timingSafeEqual` and a length pre-check. Both return 401 before parsing the payload.
- All 6 cron routes use the shared `verifyCronAuth`, which fails closed: `if (!secret) return { ok: false, reason: "no_secret_configured" }` (`cron-auth.ts:41-43`). This is the fix for the classic bug where a missing env var disables the gate — `check-na-tasks` line 85-89 documents that it used to have exactly that shape.
- No secret is reachable from the browser. Only five `NEXT_PUBLIC_` names exist in the whole tree: SUPABASE_URL, SUPABASE_ANON_KEY, APP_URL, and two video URLs. `SUPABASE_SERVICE_ROLE_KEY` is referenced only inside route handlers plus `lib/supabase-server.ts` and `lib/admin-auth.ts`, and no file beginning with `"use client"` imports `createServiceClient` — I checked every file that mentions either.
- Student auth passwords are not guessable: `generateStudentPassword` is `HMAC-SHA256(STUDENT_AUTH_SECRET, whop_user_id)` (`src/lib/whop.ts:300-304`). The synthetic email `<whop_user_id>@whop.ecomtalent.com` is a deliberate choice that prevents a Whop account from colliding with a team member's Supabase account when they share a real email address.
- RLS is enabled on every table that carries student or team data — 36 `enable row level security` statements across `schema.sql` and the migrations, covering all five tables the v46 split created. The only table without it is `lessons_archive`, which holds lesson copy and no personal data. `current_user_is_team()` is SECURITY DEFINER, STABLE, and `set search_path = public`, and the recursion bug it was written to fix is documented in `2026_fix_team_members_recursion.sql`.
- `/journal/[studentId]` — the one route shaped like a public leak — was properly hardened. `page.tsx:51-86` requires a session, then allows only a team member or the student whose `supabase_user_id` matches, and redirects everyone else. Its own docstring records that it used to be fully public.
- `POST /api/student/submit-quiz` scores server-side against the DB answer key (`scoreQuiz(questions, selections, quiz.passing_percent)` at line 65) and stores the computed result, not a client-supplied one.
- `POST /api/client-event` is deliberately unauthenticated and that is the right call — it exists to hear from sessions whose auth just broke. It stores nothing, caps the payload at 600 characters, and only writes to `console.error`.
- The v85.8 arity bug class is genuinely closed. I checked every call site of all five exported predicates: isPayingMember (page.tsx:235, snapshot-progress:151), isCanceling (page.tsx:417, tasks/page.tsx:144 and :824, journey/StudentCard.tsx:105) and isInLaunchCohort (snapshot-progress:152) each take exactly one parameter, so passing them bare to .filter() is harmless — the index and array arguments are discarded. The two helpers that DO take an optional asOfMs are wrapped in arrow functions at all four sites (page.tsx:286, :287, :302-304, :305-307). The warning at metrics-definitions.ts:228-230 and the post-mortem at :220-226 are both accurate and in the right place.
- isMonth2Converted's structure is the right fix for the drift it replaced: the numerator calls isInMonth2Cohort (metrics-definitions.ts:245) instead of re-stating the same four checks, so numerator ⊆ denominator holds by construction and the two can no longer diverge. RENEWAL_GRACE_MS at :184 is calibrated against a real histogram with the zero-density valley identified, the known soft edge (5 students at days 38-53) is written down rather than hidden, and the instruction to re-run the histogram before touching the constant is exactly right.
- /admin/stats is the best-built numeric surface in the repo and I found nothing wrong with it. interval=day only, with all five coarser-bucket traps documented at whop-stats.ts:8-30; aggregate() (whop-stats-catalog.ts:229-276) refuses to sum non-additive metrics and pulls ratios from the API's own data.totals; percentOutOfBand (:307-310) converts a scaled percent into a visible error instead of a believable one; deltaParts (MetricCard.tsx:57-72) returns null on a zero baseline rather than +∞%; fetchOne (whop-stats.ts:121-183) guards non-JSON bodies and refuses to let a non-200 become an empty series; and reconcileProducts runs a live account-vs-sum-of-parts invariant on every unfiltered load, reporting not-ok with nulls when a part fails rather than fabricating a difference. maxDuration is deliberately 30 here, not the house 300, with the reasoning written down.
- The live "Active on platform" definition really is single-sourced. The dashboard (page.tsx:116-127 + :235 via isPayingMember) and the snapshot cron (snapshot-progress/route.ts:135-152) apply the same four conditions — active/past_due, paying plan, launch cohort, whop_membership_id present — and the reconciliation query at supabase/diagnostics/admin-health.sql:158-190 checks them against each other with a sensible ±1 tolerance and a named RED-FLAG verdict. Same for the avg_progress invariant at :193-230. Both checks are well-built; they just only cover today's row.
- No naked division anywhere I read. progressPercent (constants.ts:85-89) clamps to 0-100 and guards total<=0; computeAvg (snapshot-progress:358-366) and both CASE branches in the RPC (v81 migration :211-234) guard zero denominators; PaceCell (insights/progress/page.tsx:571), BountyAccessCard's deltaPct (:1229-1232) and the M2 rate (page.tsx:288-289, which returns null not 0 on an empty cohort and renders "—") all handle the zero-baseline case explicitly rather than printing 0% or +100%.
- fetchAllRowsPaginated returning { data: [], error } instead of a partial set on mid-page failure (supabase-pagination.ts:38-44) is the correct trade. It converts a silently-truncated list into a visibly empty one, which is the right instinct for this codebase's failure mode — and the snapshot cron actually checks that error and aborts (route.ts:179-182) rather than writing a partial completion sum as the night's total.
- outreach-insights.ts is the single source for both /admin/tasks/insights and /admin/templates/stats, so those two can't disagree; it batches .in() at 100 ids, grades each template family on the thing its message actually asks for, applies a dormant-before attribution filter to pace/custom sends so revival isn't credited to students who were already active, and says "correlation, not causation" in the docblock. The stalled-family success test (first_sprint_login_at within 72h) is correct because the stalled pipeline targets students who have never logged in at all.
- The auth-error legibility work (v85.11) is real and well built everywhere except the one bootstrap branch in finding 1: fetchProfile returns a reason string from every exit including the two that used to be bare returns, StudentGuard routes a non-null authError to /login?error=profile_load_failed&detail=…, and login/page.tsx:92-107 renders the code plus the detail so a screenshot is enough to route a ticket.
- The 429 defence in supabase-browser.ts:46-79 is correct and correctly reasoned. I checked it against the installed auth-js: only 502/503/504 are retryable, and _callRefreshToken calls _removeSession on a fatal error — so rewriting a 429 on the refresh grant to a 503 genuinely preserves the session. Narrowing the match to grant_type=refresh_token (so an armed cooldown can't reject a correct password on /admin/login) is a subtle catch that was got right.
- Excluding TOKEN_REFRESHED and INITIAL_SESSION and refetching only on identity change (AuthContext.tsx:195-211) is the right cut for the feedback loop, and the 15s watchdog with a single terminal finish() that survives the whole load — not just getSession — closes the hang that stranded a student for 30 minutes. /auth/complete sitting out the shared auth lock, with a 20s budget and a lock-steal retry, is the correct fix for the setSession lock steal.
- Server-side quiz scoring holds on both surfaces. submit-quiz scores through scoreQuiz from the DB questions, and submit-region-quiz recomputes from REGION_QUIZ_REGISTRY rather than trusting body.scorePct — the DevTools {scorePct:100} hole is closed, and the remaining legacy fallback logs every use so it can be retired on evidence.
- Authorization on the discount flow is done properly. Every student route derives studentId from the JWT and explicitly ignores body.studentId; approve, reject and mark-applied all require a founder/admin/csm team member; and the v29 RPC is deliberately called through a user-JWT client so its internal auth.uid() guard can pass instead of being defeated by the service-role client. The reasoning is written down at submit-feedback/route.ts:132-140.
- The money gate itself is sound: approve re-validates ad_submissions_verified, first_paid_at, full R1+R2 completion and the window before minting anything, refuses to mark the row approved if the Whop call fails, and uses a deterministic per-student code so a re-run collides on Whop's side rather than quietly minting a second discount. Duplicate claims are blocked in two independent places (the route and the RPC).
- skip-lesson and mark-action-shipped both validate the lesson server-side — skip-lesson specifically refuses to skip a requires_action lesson because skipped_at would otherwise satisfy the canonical isLessonComplete formula. That is precisely the right instinct; toggle-lesson is the one route it was never applied to.
- The v74 recentlyToggled merge window (StudentContext.tsx:485-521) is a genuinely good fix: it preserves the local completion row for 3s after a toggle so a stale Supabase read-replica response cannot undo the student's action. Real problem, minimal solution, documented cause.
- The comments in this area are unusually load-bearing and mostly accurate — CONTEXT.md's own CORRECTION note about getSharedSession not preventing refresh storms is right, and the call-gate rationale (cap the rate rather than keep guessing the trigger) was the correct call after five unconfirmed fixes. The gates just need to cover the third path.