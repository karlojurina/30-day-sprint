# Rebuild capability map — 2026-09-21

_Ground truth for the 30-day-sprint rebuild (self-hosted video, game-like progression).
Produced by 6 investigator agents over the live repo, with the top 5 load-bearing facts per
area adversarially re-verified: 0 refuted, 30 sharpened. Feeds the Gate 1 memo at
`_admin/memos/sprint_rebuild.md`. All paths relative to `30-day-sprint/`. The live database
was NOT queried (local creds are placeholders); every DB fact comes from schema.sql and
migrations._

Pulled: the six investigator reports plus the CORRECTED list (no refutations); no new repo reads, all citations below are from the verified reports, relative to `/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint`.

# CAPABILITY MAP: EcomTalent student platform, rebuild groundwork

## 1. WHAT THE APP IS TODAY

A student logs in with Whop, lands on a painted world map with four regions, and sees numbered dots for lessons. Clicking a "watch" lesson does not play anything: it opens the lesson on whop.com in a new tab (`src/components/map/LessonSheet.tsx:22-23`, `:406-408`). When the student comes back, the app asks Whop "which lessons has this person finished" and copies the answer into its own database (`src/app/api/student/_lib/watch-sync.ts:116-126`). Everything else the app does (streaks, 16 badges, region quizzes with four mini-games, the 14-day discount, the Playbook unlock, the CSM outreach queue, every admin chart) reads from that one copied table. So today the app is a progress mirror with a nice map on top; the course itself lives on Whop, and the app never sees a second of watching.

## 2. KEEP

| Asset | Why keep |
|---|---|
| **The completion predicate** `isLessonComplete` (`src/lib/progress.ts:42-55`) and its SQL mirrors (`migrations/2026_v81…sql:49-57`, `v49:32-46`, `v89:135-143`) | Single "done" rule that ~30 consumers read. A self-hosted player becomes a new writer of `completed_at`; nothing downstream changes. |
| **`student_lesson_completions`** row shape: unique (student, lesson), three nullable timestamps + Discord link (`v3:70-76`, `v6:22-23`, `v15:85-86`, `v28:15-16`) | Idempotent upserts from many writers already work. Add telemetry as a sibling table, don't widen this one. |
| **toggle-lesson's post-write chain** streak → CSM reactivation → achievements → task re-eval (`src/app/api/student/toggle-lesson/route.ts:70-86`) | The only place all side effects run in order. Copy it into the new "watched" route. |
| **Achievements engine** (`src/lib/achievements.ts:71-176`, `student_achievements` append-only `v53:35-40`, `achievement_unlock_stats` `v90:74-92`, backfill route) | Sticky, idempotent, re-runnable, already has the day-bucket "combo" primitive (`:325-331`). New badges = one rule + one migration. |
| **Streak math** `computeStreakUpdate` (`src/lib/streak.ts:33-40`), pure, no I/O | Testable; only its inputs (UTC, login ticks) need changing. |
| **Four quiz mini-games + QuizModal portal slots** (`src/components/quiz/*`, `QuizModal.tsx:61-66`), server-scored (`submit-region-quiz/route.ts:128-129`) | The most game-shaped thing in the app. Boss fights already exist. |
| **Map camera engine**: `applyTransform` writing `style.transform` off-React (`MapMockup.tsx:617-627`), cover-fit/clamp/wheel math (`:784-845`, `:973-1071`) | Ports unchanged to a canvas/WebGL renderer; only `applyTransform` changes. |
| **CinematicDive** (`src/components/mockup/CinematicDive.tsx`) | Region-entry transition with reduced-motion path. Restyle the title card only. |
| **Hand-traced scene data**: `REGION_ZONES` polygons (`MapMockup.tsx:209-280`), `SCENES` waypoints (`:333-432`), the `/dashboard-mockup/edit-regions` picker | Only encoded art-placement labour in the repo. Re-trace with the picker if art changes. |
| **Call gates + pagination + cron auth** (`src/lib/call-gate.ts`, `supabase-pagination.ts`, `cron-auth.ts`) | Built after real outages (800 queries in 72s; 1000-row silent truncation). Any new poll/heartbeat/leaderboard must go through them. |
| **Optimistic toggle + 3s merge window** (`StudentContext.tsx:337-338`, `:851-885`) | Pattern for every game write. |
| **`student_celebrations` + `celebration-seen`** (`v46:77-83`) | "Already shown" dedupe for any one-shot reward moment. |
| **Whop auth bridge** (`callback/route.ts:251-252`, `whop.ts:300-304`), **membership webhook** (`webhooks/whop/route.ts:132-320`), **community sync** (`whop-sync-runner.ts:298-320`), **promo minting** (`whop.ts:419`) | Entitlement + billing survive the video move untouched. Replacing the IdP would mean migrating 738 auth identities keyed on Whop `sub`. |
| **IntroVideoGate** (`src/components/onboarding/IntroVideoGate.tsx:93-160`, `:238-250`) | Seed of the lesson player: custom chrome, seek-lock, ended-gate already written. |
| **Design token structure** in `globals.css` (`:96-100`, `:111-119`) and the admin `ui.tsx` primitive pattern | Keep the scale, change the values, build a student `ui.tsx`. |

## 3. REBUILD

What exists and reads as low effort, concretely:

- **The lesson experience is a link.** `LessonSheet.tsx:405-465` renders "Watch on Whop · Opens in a new tab · auto-syncs when you come back". Lessons without a Whop id show "Video content coming soon." (`:485`). There is no player, no progress bar, no resume.
- **Markers are flat white stickers on a painting.** Circle = watch, rotated square = action, hairline stroke, "no gradient, no bevel" (`MapMockup.tsx:3748-3749`); the file admits the earlier size "read as small stickers" (`:3582-3584`). There is deliberately **no path line** (`:3328`) even though waypoints exist; the design-reference spec'd a growing completed-path overlay that never shipped.
- **Ambient life is 4 bird glyphs, 3 blurred ellipses, 5 sparkles**, anchored on a hard-coded region-center guess (`MapAmbience.tsx:51-103`, `MapMockup.tsx:1591-1602`), disabled under 640px. Plus 22 always-on SMIL `<animate>` loops. This is decoration, not a world.
- **No rendering layer for anything "high-effort."** DOM + SVG + CSS only; no canvas, WebGL, Lottie, Rive, Pixi anywhere (grep in `src` returns nothing). Particles, lighting, parallax, characters have no engine.
- **The stats card is a floating glass rectangle**, 51 inline styles, 0 classNames (`StatsWidget.tsx`), re-rendering itself and its child every second for a countdown (`:66-71`). Achievement icons are **emoji characters stored in the DB** (`v53:112` `'🎬'`).
- **The design system is nominal.** MapMockup: 3 `var(--color` vs 74 `rgba(255` hard-codes; `--color-gold*` tokens hold pearl values (`globals.css:16-22`); no student component imports `admin/ui`. Three docs describe three aesthetics (sea chart in `.impeccable.md:37-39`, Duolingo-amber in `SKILL.md:36,88`, neutral pearl in code), and `.impeccable.md:41` explicitly forbids "gamer, arcade, neon".
- **MapMockup is one 4,371-line file** mixing camera, scene data, quiz/discount/playbook gating, the side panel, and every marker renderer (`:519-2487`, `:2493-3173`, `:3232-4371`). A visual rebuild touches business gating in the same file.
- **Touch is incomplete.** Single-pointer drag, wheel-only zoom, `touchAction: none` (`:989-1071`, `:1306`); `react-zoom-pan-pinch` installed and never imported (`package.json:20`).
- **Onboarding** = native video gate then a 3-card text flipbook. **Playbook** = three cards iframing static HTML from `public/` (`PlaybookNodeSheet.tsx:161-171`), readable logged-out.
- **Region-clear moment and inventory are dead code.** `RegionCompleteCelebration` is mockup-only; `WorkshopCabinet` (522 lines) has no importers; `hidden_rewards`/`student_rewards` were dropped in v3 (`v3:136-137`).
- **Failure looks like zero.** A failed `/api/student/data` renders an empty dashboard, all regions locked, no error, no retry (`StudentContext.tsx:376-379`; route returns 200 with empty arrays `data/route.ts:133-151`).
- **Gating inconsistencies**: overview region click ignores the quiz gate the side panel enforces (`MapMockup.tsx:1107-1110` vs `StudentContext.tsx:754-756`); `toggle-lesson` accepts any lesson id including watch lessons (`toggle-lesson/route.ts:60-62`).
- **Performance debt already documented**: backdrop-filter over the panning map "tanking pan smoothness" on phone (`StatsWidget.tsx:638-640`), five stacked scene layers "make pans crawl" (`MapMockup.tsx:1336-1340`), 50 backdrop-filter usages remain, an 18MB PNG referenced by dead code and ~211MB of unreferenced originals shipping in `public/`.
- **`/dashboard-mockup` is live in production** without the membership overlay and with dev panels (`dashboard-mockup/layout.tsx:10-12`).

## 4. NEW SPINE

### (a) Self-hosted video with real watch telemetry

| Capability | What it needs | What it replaces |
|---|---|---|
| Video hosting/delivery for ~66 long-form lessons (up to 1h+, `v23:44,116`) | A streaming provider (Mux / Cloudflare Stream / Bunny) or private Supabase Storage + HLS; an HLS-capable player dep. None exists: `package.json:12-21`, `next.config.ts:3-5` empty, zero `storage.` calls in src. | The single public progressive MP4 pattern (`.env.local:21-23`). |
| Media entitlement | A server route that checks JWT **and** `membership_status` before minting a signed/expiring URL. No student API route checks membership today (inspection `:623`); `public/` is unauthenticated (`:376`). | Nothing; this is net new. |
| Video reference on lessons | `video_asset_id` / `duration_seconds` column or sibling table; lessons has only `whop_lesson_id` + display-only `duration_label` (`v3:43-57`). | `whop_lesson_id` (`v3:53`). |
| In-app player | Generalised IntroVideoGate: per-lesson src, resume, fullscreen, seek policy. | `WHOP_LESSON_URL` card (`LessonSheet.tsx:22-23`, `:405-465`). |
| Watch telemetry | New per-(student, lesson) table: max position, seconds watched, last heartbeat, pct; a heartbeat route behind a call gate; read via a view (PostgREST 1000-row cap). Nothing stores more than one boolean today (`mark-intro-video-threshold/route.ts:49-58`). | `/api/client-event`, which logs and drops (`client-event/route.ts:12-13`). |
| Server-verified "watched" completion | A POST route that validates `lesson.type === 'watch'` (pattern: `skip-lesson/route.ts:60-85`), checks server-held telemetry against a threshold, writes `completed_at` **at watch time**, then runs the toggle-lesson chain. | `syncWatchProgress` (`watch-sync.ts`), the `course_lesson_interaction.completed` webhook case (`webhooks/whop/route.ts:322-434`), the three client sync triggers (`StudentContext.tsx:641-672`), the callback race (`callback/route.ts:412-441`). |
| Whop reduced to entitlement | Delete `fetchCompletedLessonsAsAdmin` (`whop.ts:351-411`), `WHOP_COURSE_ID`, `student_whop_sync` sync columns, `SyncDebugPanel`; keep OAuth, membership webhook cases, community sync, promo codes. | The course half of Whop. |

### (b) Game-like progression

| Capability | What it needs | What it replaces |
|---|---|---|
| Append-only activity log (opened, progress tick, completed, quiz attempt, login, un-check) | New events table written from every student route + the player; current tables become projections. Today un-check hard-deletes the row (`toggle-lesson/route.ts:51-54`), `last_active_at` is overwritten (`update-streak.ts:52-55`), one login stamp ever (`callback:383-384`). | Nothing; there is no history. |
| XP / levels / spendable economy | Ledger table + catalog + aggregate view; a decision on cosmetic vs feeding pace/CSM. `current_title` derives client-side from regions (`StudentContext.tsx:797-799`); rewards tables dropped (`v3:136-137`). | The 5-rank title ladder (`titles.ts:10-16`) as the only progression. |
| Per-student daily history (XP/day, heatmap, weekly recap) | `student_day_stats` keyed (student, date); `daily_progress_snapshots` is one aggregate row per day (`v31:17-18`). | Nothing. |
| Learning streak with local days | Per-student timezone or client-supplied local date; a qualifying-activity rule that excludes bare login (`callback:415-423`) and un-check (`toggle-lesson:56`); a lapse rule (never decays today). | The current UTC login streak (`streak.ts:58-60`). |
| High-effort rendering | A canvas/WebGL layer (Pixi/Three, or Rive/Lottie for authored animation), code-split from the 314KB gsap+framer+MapMockup chunk; art authored for it; a decision on composing with the CSS-transform camera. | The `<img>` stack + SVG overlay (`MapMockup.tsx:1317-1327`, `:1566-1568`, `:3315-3316`). |
| Asset pipeline | Build step (sharp/AVIF, tiled map art, sprite sheets); remove ~211MB of originals; `sharp` is used by a script but undeclared. | `scripts/optimize-scene-images.mjs` one-off. |
| Student-side design system | One chosen direction (resolve `.impeccable.md` vs `SKILL.md` vs code); honest token names; a student `ui.tsx`; migration off inline rgba. | Nominal tokens nobody consumes. |
| Student-visible "others" data (leaderboard, week-mates) | Service-role routes (`cohort-stats` pattern) or invoker-off views (`achievement_unlock_stats` pattern); RLS forbids direct cross-student reads (`v78:48,59`). A group/cohort entity if week-mates are real. | Ad-hoc ±7-day cohort in `day28-embed.ts:356-365`. |
| Realtime presence (optional) | Supabase Realtime channels (in supabase-js 2.103, unused); design against the 30-token auth bucket and per-origin Web Lock (`supabase-browser.ts:74-87`). | Polling, which is deliberately capped. |
| Sound | Assets, preloader, persisted per-student toggle; no audio code or column exists. | Nothing. |
| Editable curriculum | Quiz content out of `region-quizzes.ts:4-6`, `LESSON_GROUPS` out of `constants.ts:192-213`, into tables; a v20-style canonical lessons migration. | Hard-coded TS. |
| Async work | A job mechanism (pg_cron/pg_net or a queue); today only 2-hourly crons (`vercel.json:2-23`) and inline request work inside a 2.5s login race. | Nothing. |

## 5. BLAST RADIUS

Everything reads `student_lesson_completions` or a view over it; nothing downstream imports Whop.

**Keeps working unchanged** (if the new writer keeps the row shape, lesson IDs, and r1..r4):
`student_progress_counts` (`v81:39-59`), `student_current_region` (`v49:32-46`), `rebuild_daily_snapshots` RPC + snapshot cron (`v89`, `snapshot-progress/route.ts:176-177, 301-303`), check-engagement (`:114-221`), check-csm-tasks + `buildStudentSnapshot` (`check-csm-tasks/route.ts:286-291`, `csm-triggers.ts:209-266`), `reEvaluateStudentOpenTasks` (`csm-task-evaluation.ts:69-72`), discount request/approve (`discounts/request/route.ts:124-185`, `approve/route.ts:78-198`), Playbook gate (`progress.ts:135-144`), region unlock (`StudentContext.tsx:752-756`), achievements evaluator (`achievements.ts:194-199`), admin dashboard/insights/journey/roster/detail/drawer/discounts/journal, cohort-stats (`:67-71`), outreach grading (`outreach-insights.ts:321-326`), Discord transports + toggles (`discord.ts`, `dm-toggles.ts`), check-na-tasks (reads milestones only, `:138-142`). Note: accurate watch-time `completed_at` **improves** achievements' day buckets and check-engagement's recency signal, which currently see sync time (`achievements.ts:160-164`).

**Needs shim** (small, deliberate edits):
- Remove the five sync triggers (`StudentContext.tsx:641-672`, `callback/route.ts:412-441` keeping streak+achievements, `refresh-watch-sync` route) or they keep hitting Whop and writing diagnostics.
- Decide the webhook `course_lesson_interaction.completed` case: keep as secondary writer during transition (safe via `ignoreDuplicates`) or delete.
- `/admin/not-activated` "watching in Whop" hint and student detail sync panel (`not-activated/page.tsx:140-142`, `students/[id]/page.tsx:86-91`) go permanently empty.
- check-na-tasks Cohort B "Whop DM" routing (`:25-26`) still works but the Whop course no longer exists as a place to be stalled in.
- Streak: if "learning streak" is wanted, the login tick (`callback:415-423`) and un-check tick (`toggle-lesson:56`) must go.
- `toggle-lesson` needs a lesson-type guard or the new "watched" route is bypassable (`toggle-lesson/route.ts:60-62`).
- day28-embed drift (ignores `skipped_at`, anchors on `joined_at`, counts l057: `day28-embed.ts:254-257, 274, 331-332`).
- Docs: `PLATFORM_OVERVIEW.md:64,270`, `CONTEXT.md:27,244`, `system_contracts.md` describe the Whop-hosted model.

**Needs rework if lesson IDs, regions, or lesson count change:**
- `lessons.id` FK cascade deletes completions, notes, ratings for any dropped id (`v3:73`, `v3:103`, `v75:27`).
- Hard-coded IDs: `DISCOUNT_GATE_LESSON_ID="l049"`, `PLAYBOOK_UNLOCK_LESSON_ID="l078"`, `SPRINT_EXCLUDED "l057"`, `LESSON_GROUPS l032..l042` (`constants.ts:109,120,132,201-211`); noship triggers on l018/l020/l022/l024 (`csm-triggers.ts:442-452`), `ACTION_LESSONS` (`:562-568`), `R2_COMPOUND_LESSONS` (`csm-events.ts:82`), day-28 action list (`day28-embed.ts:29-35`), achievements keyed to l078/l057/l018-l024/l049.
- Team-authored `templates.trigger_config` JSON in the DB referencing `lesson_id` (`database.ts:528-532`) silently evaluates false on unknown ids (`csm-triggers.ts:829-835`).
- Pace model assumes r1..r4, 30 days, boundaries 7/14/21 (`csm-triggers.ts:142-147, 263`); `TOTAL_LESSONS=64` (`constants.ts:90-92`); `REGION_IDS` in achievements (`:60`); the l057 exclusion in the v81 view and v89 RPC.
- Region quiz content per region (`region-quizzes.ts`) and the R1+R2-in-14-days discount rule.
- `student_current_region` already diverged from `student_progress_counts` on l057 (v81 added the exclusion, v49 did not).

## 6. THE MIGRATION QUESTION

**What survives:** student identity. `students.id` and `whop_user_id` (unique not null, `schema.sql:19`) are stable, and the Supabase auth user is keyed on Whop `sub` (`callback:251-252`). Achievements (`student_achievements`), streaks, milestones, quiz passes (`student_region_quiz`), discount requests all key on `student_id` and survive regardless of curriculum.

**What links old progress to new lessons:** only our own text lesson id (`l001..l078`). Completions reference `lessons.id`, not Whop ids (`v3:73,75`). There is no curriculum version column, no old→new mapping table, no watch-time history.

- If the re-recorded course **reuses the same ids** (video swapped underneath, seeded via `on conflict (id) do update` as v20/v24 did), all 738 students' completions, notes, ratings, region unlocks and badges carry over with zero downstream changes.
- If ids are **dropped or renamed**, the FK cascade (`v3:73`) deletes those completions silently, exactly as v6/v13/v20/v24/v25/v26/v50 did before launch. Region unlocks, the 14-day discount progress, Playbook unlocks, and every lesson-keyed achievement would be lost for those ids unless a mapping migration runs first.
- If the **structure** changes (lesson count, region count, which lessons are action items), the hard-coded lists in section 5 must be re-pointed even when ids are reused.

**State plainly:** nothing links an old lesson to a new lesson except an id you choose to reuse. There is no mapping layer; you would have to write one before the cutover.

**Two data losses that are already baked in:** (1) `completed_at` for Whop-mirrored rows is sync time, not watch time (`watch-sync.ts:116-119`, default `now()` `v3:74`); Whop's `created_at` was never stored (`types/whop.ts:47`), so honest historical day buckets are unrecoverable from our DB and only recoverable from Whop while its course still exists. (2) The 467 buyers who never opened the app have no completion rows anywhere, and mid-course students' progress exists on Whop only until it is mirrored by a login.

## 7. CHEAP WINS AVAILABLE NOW

All additive on existing data, no new tables:

1. **Draw the trail.** A `<path>` through the existing `SCENES` waypoints (`MapMockup.tsx:333-432`) with a completed-segment overlay that grows: the design-reference spec that never shipped. Single SVG addition in `ScenePathOverlay`.
2. **Replace marker visuals.** `LessonMarker` (`:3610-3815`) and `EndMarker` (`:4125-4371`) are self-contained SVG functions with `isDone/isCurrent/isAction` props; game-piece styling swaps in without touching gating.
3. **Wire the region-clear moment.** `RegionCompleteCelebration` exists with Karlo's approved copy (`map/RegionCompleteCelebration.tsx:38-51`), mockup-only; `LessonCompleteEffects` already diffs completions (`:25-49`); dedupe via `student_celebrations`.
4. **Surface rank and pace on the map.** `/api/student/cohort-stats` (finisher rank) and `buildPaceSummary` (behind / on pace / ahead, `csm-triggers.ts:324`) exist; they are only shown at graduation and in the Day-28 DM.
5. **Client-side XP/level** derived from completions, streak, achievements, quiz best scores already in the `/api/student/data` payload; ranks from `titles.ts`.
6. **More badges**: append to `ACHIEVEMENT_RULES`, one migration, run `/api/admin/backfill-achievements`.
7. **Pinch-zoom + inertia** by wiring the already-installed `react-zoom-pan-pinch` or extending `onMapPointerDown` to multi-pointer.
8. **Stop failure-as-zero**: check `.error` in `data/route.ts:133-151`, add an error/retry state in `StudentContext.tsx:376-379`.
9. **GPU wins**: gate backdrop-filter to desktop, pause the 22 SMIL loops in region view, isolate the 1s countdown out of `StatsWidget` (`:66-71`).
10. **Delete dead weight**: MapCanvas (1,012), LessonNode (659), WorkshopCabinet, CloudTransition, MapChrome/Legend/Controls, ProgressDial, QuizView, the 18MB + 33MB + 1MB tracked PNGs and 170MB `_originals`; gate or delete `/dashboard-mockup`.
11. **Close two holes**: lesson-type guard on `toggle-lesson`; make the overview click respect the quiz gate (`MapMockup.tsx:1107-1110`).
12. **Fix day28-embed drift** so the one DM students get shows honest numbers.

## 8. QUESTIONS ONLY THE OWNER CAN ANSWER

**Product loop**
1. What marks a lesson "watched": the `ended` event, a % threshold, or minutes watched? (Fixes the predicate every XP formula and ~15 consumers inherit.)
2. Must scrubbing/skip-ahead be blocked on all ~66 lessons like the intro gate, or is that intro-only?
3. Should partial watch progress (resume, %) count toward streaks, pace, or engagement alerts, or only the final completion?
4. What is an "active day": does a bare login count (it does since v89.2)? Does un-checking a lesson? Local-time or UTC days?
5. Will anything be spendable (coins, chests, unlocks) or are sticky badges the whole economy?
6. Should students see other students' progress (leaderboard, week-mates, percentile)? Today RLS forbids it except the global badge %.
7. Is "game-like" Duolingo-style progression on the existing paintings, or a full game render (characters, particles, sound)?
8. Do the four region quizzes stay as the gates, with rewritten content? Should the overview click respect the quiz like the side panel?
9. Is the Playbook (three iframe articles) inside the game scope or unchanged?
10. Should past_due students be in or out (login admits, dashboard blocks)?

**Design direction**
11. Which aesthetic is canonical: sea-chart/parchment (`.impeccable.md`), Duolingo-amber (`SKILL.md`), or the current neutral pearl? Is "no gold" final?
12. Will `.impeccable.md:41` ("not gamer, not arcade, not neon", never bounce) be revised, or does "feel like a game" mean mechanics inside the chart look?
13. Desktop-first (`.impeccable.md:15`) or mobile-first (`SKILL.md:167`)? This decides whether canvas/WebGL is viable on target devices.
14. Are the five current paintings staying, or is art being re-commissioned with the re-record?

**Content and timeline**
15. Does the re-recorded course keep the same lesson ids (l001..l078), region ids, and count (18/20/12/14 + l057), or is it a new catalog?
16. Do existing students keep their old completions on the new curriculum, or does everyone restart?
17. Do the hard-coded gates survive: l049 discount gate, l078 Playbook unlock, l057 exclusion, l018/l020/l022/l024 action items, the l032-l042 editing group, the 14-day R1+R2 discount?
18. Total runtime, resolution, captions of the re-recorded course? (Sets storage, transcode, whether HLS is required.)
19. Should quiz content and lesson groups stay in code, or move to tables so non-engineers can edit?
20. Can `/dashboard-mockup`, the dead components, `react-zoom-pan-pinch`, and the tracked legacy PNGs be deleted before the rebuild starts?

**Whop boundary**
21. Does Whop stay the login identity provider? (Yes = auth untouched; no = migrate 738 identities keyed on Whop `sub`.)
22. Is the Whop course deleted or left up read-only? If deleted, should historical `completed_at` be back-dated from Whop's interaction `created_at` before it is gone?
23. During transition, does a Whop-side completion still count (keep webhook + sync as secondary writers) or is it a hard cut on a date?
24. What happens to the 467 buyers who never opened the app and mid-course students whose progress exists only on Whop?
25. Do free-plan and promo-plan members keep full access to in-house video?
26. Video hosting and budget: Mux / Cloudflare Stream / Bunny / Supabase Storage, and the monthly storage + egress ceiling?
27. Is anti-download / DRM required, or is signed-URL expiry enough?
28. Is the Vercel project on Pro with Fluid Compute? What Supabase plan/compute size? (Both are asserted in comments, not config.)
29. Do the manual "Whop DM" tasks for students without Discord continue, or must everyone link Discord in-app?
30. Which cron slot may a nightly game rollup take? The :00-:20 chain is load-bearing and 00:30 is taken.

## 9. WHAT YOU COULD NOT DETERMINE

- **Anything in the live database.** `.env.local` holds placeholders. Unverified: whether v81/v89 are applied in production; whether `hidden_rewards`/`student_rewards` still exist (schema.sql declares them, v3 drops them, CONTEXT.md lists them); which `templates.trigger_config` rows reference lesson ids; whether the W2.6 discount-review template exists (csm-events still tries to create it); actual `whop_lesson_id` coverage; real DAU or concurrent-online counts.
- **Vercel plan and Supabase plan/egress budget.** Only inferred from code comments (`sync-whop/route.ts:20`).
- **Whether the Whop-mirrored `completed_at` values can still be back-dated.** Depends on Whop's course_lesson_interactions still being queryable at cutover.
- **Real phone performance** of the current map. Jank is documented in comments, not measured.
- **The design-reference prototype's full spec.** It is gitignored and local-only; only its README was read.
- **Whether the 2.5s login race actually drops sync/achievement work in production**, and how often.
- **The live shape of the six investigator reports' one uncertainty**: the `.impeccable.md` precedence rule says "this file wins" while code has already drifted; which is authoritative is a decision, not a fact.